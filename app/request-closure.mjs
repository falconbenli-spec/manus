import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse, refusalMessage } from './refusal.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { getRequest, serviceOf, transition, notifyUser, executorsFor, actions as requestActions } from './workflow.mjs';
import { handlingDepartment } from './routing.mjs';
import { announceToExecutors } from './request-assignment.mjs';
import { holidaySet, addWorkingDays, riyadhDate } from './work-calendar.mjs';

// إغلاق الطلب وإعادة فتحه. ثلاث قواعد تحكم هذا الملف:
//   (1) لا يُغلق طلب إلا بوصف ما سُلِّم فعلًا. `transition(...,'complete')` في workflow.mjs يطلب ملاحظة قصيرة،
//       وهذه الوحدة تبني فوقه فتطلب وصفًا يصلح دليلًا بعد شهر، وتحفظه في سجل إغلاق مستقل لا يُعدَّل.
//   (2) الإغلاق الصامت خلل: طلب مكتمل بلا إشعار لصاحبه لا يُعد مكتملًا، ويُكشف في اللوحة لا يُفترض.
//   (3) إعادة الفتح لا تمحو الإغلاق الأول: جولة ثانية مرتبطة به، فيبقى ظاهرًا أن الخدمة لم تُنجز من أول مرة.

const id=()=>randomUUID();
const today=()=>riyadhDate(Date.now());
const ANY='*';

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','ما لقينا حسابك، ولا هو موقوف — كلّم مسؤول المنصة');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','الكتابة تبي معاملة قاعدة بيانات');}

// مالك الإجراء المسمى في بطاقة الخدمة المنشورة هو من يحدد مهلة إعادة الفتح لخدمته،
// والمهلة العامة لمن يدير دليل الخدمات. لا ثالث: الإعداد ليس رأيًا عامًا.
export function ownsProcedure(db,u,serviceCode){
  if(serviceCode===ANY)return false;
  return !!db.prepare("SELECT 1 FROM service_cards WHERE tenant_id=? AND service_code=? AND status='published' AND owner_id=?").get(u.tenant_id,serviceCode,u.id);
}
const canSetWindow=(db,u,scope)=>can(db,u,'catalog.manage')||ownsProcedure(db,u,scope);

export const liveWindow=(db,tenantId,serviceCode)=>
  db.prepare('SELECT * FROM reopen_settings WHERE tenant_id=? AND scope_code=? AND superseded_at IS NULL').get(tenantId,serviceCode)
  ??db.prepare('SELECT * FROM reopen_settings WHERE tenant_id=? AND scope_code=? AND superseded_at IS NULL').get(tenantId,ANY)
  ??null;

export function setReopenWindow(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['scope_code','window_days','basis','confirmed_on']);
  const raw=v.text(input.scope_code,'نطاق المهلة',40,1),scope=raw===ANY?ANY:raw.toUpperCase();
  if(!canSetWindow(db,u,scope))fail(403,'not_permitted','مهلة إعادة الفتح يحددها مالك الإجراء المسمّى في بطاقة الخدمة، ولا اللي يدير دليل الخدمات للمهلة العامة');
  if(scope!==ANY&&!db.prepare('SELECT 1 FROM services WHERE tenant_id=? AND code=?').get(u.tenant_id,scope))fail(404,'not_found','ما لقينا الخدمة هذي');
  const days=Number(input.window_days);
  if(!Number.isInteger(days)||days<1||days>120)fail(400,'window_days','المهلة بأيام العمل من 1 لين 120');
  const basis=v.text(input.basis,'سند المهلة ومن أقرّها',2000,10),confirmed=v.date(input.confirmed_on);
  if(confirmed>today())fail(400,'confirmed_on','تاريخ تأكيد المهلة ما يكون في المستقبل');
  const previous=db.prepare('SELECT * FROM reopen_settings WHERE tenant_id=? AND scope_code=? AND superseded_at IS NULL').get(u.tenant_id,scope),time=now();
  if(previous)db.prepare('UPDATE reopen_settings SET superseded_at=? WHERE id=?').run(time,previous.id);
  const row=id();
  db.prepare('INSERT INTO reopen_settings(id,tenant_id,scope_code,window_days,basis,confirmed_on,set_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(row,u.tenant_id,scope,days,basis,confirmed,u.id,time);
  audit(db,u,'reopen_setting',row,'closure.window_set',previous?{window_days:previous.window_days}:{},{scope_code:scope,window_days:days,confirmed_on:confirmed},basis);
  return closureBoard(db,u);
}

export const closuresOf=(db,requestId)=>db.prepare('SELECT * FROM request_closures WHERE request_id=? ORDER BY round').all(requestId);
export const reopeningsOf=(db,requestId)=>db.prepare('SELECT * FROM request_reopenings WHERE request_id=? ORDER BY round').all(requestId);

// إشعار صاحب الطلب عند الإغلاق ليس تفصيلًا تجميليًا: الطلب الذي يُغلق بلا علم صاحبه يعود مكالمةً أو طلبًا ثانيًا.
const closingNotice=(db,r,since)=>!!db.prepare("SELECT 1 FROM notifications WHERE request_id=? AND user_id=? AND kind='execution_completed' AND created_at>=?").get(r.id,r.requester_id,since);
// من أغلق الطلب فعلًا، من سجل التدقيق: الرفض يسمّي شخصًا يُسأل، لا «الجهة المختصة».
const closerName=(db,r)=>db.prepare(`SELECT x.name FROM audit_events a JOIN users x ON x.id=a.actor_id
  WHERE a.tenant_id=? AND a.entity_type='request' AND a.entity_id=? AND a.action='complete' ORDER BY a.seq DESC LIMIT 1`).get(r.tenant_id,r.id)?.name??null;
// الرفض الذي كان فخًّا: الطلب أُغلق من بابٍ ضعيف لم يكتب سجل إغلاق، ثم قيل لصاحبه «لا مرجع لإعادة فتحه» ووقف الأمر.
// الباب الضعيف أُغلق (POST /api/requests/:id/complete صار يمر بهذه الوحدة)، والتاريخ لم يُردَم بأثر رجعي —
// لا تُخترع أدلة تسليم لم يكتبها أحد. فبقي أن يشرح الطلبُ نفسَه: ما الناقص، ومن يملكه، وما الخطوة التالية.
// النص والشكل من معيار الرفض الواحد (app/refusal.mjs)، فتقرؤه الشاشة بـui.refusal كما تقرأ كل رفض.
const noClosureRefusal=(db,r)=>({
  what:'لا يُعاد فتح هذا الطلب لأنه أُغلق دون سجل إغلاق بدليل',
  missing:[{document:'سجل إغلاق بوصف ما سُلِّم فعلًا',
    why:'أُغلق هذا الطلب من المسار العام قبل أن يصير الإغلاق بدليل هو المسار الوحيد، فلا وصفَ تسليمٍ يُقاس عليه ما نقص',
    owner:closerName(db,r)??'الإدارة المنفذة للطلب',owner_role:'handler'}],
  next:'افتح طلبًا جديدًا لنفس الخدمة واذكر في نصه رقم هذا الطلب وما الذي لم يُنجز؛ وما يُغلق بعد اليوم يُغلق بدليل ويُعاد فتحه ضمن مهلته',
  link:`#request/${r.id}`});

export function closeWithEvidence(db,supplied,requestId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','delivered']);
  const before=getRequest(db,u,requestId);v.version(input.version,before.version);
  if(!requestActions(db,u,before).includes('complete'))fail(403,'transition_denied','الإغلاق لمن يباشر تنفيذ الطلب، وبعد ما يقفل مهامه');
  // الوصف هو ما سيقرؤه صاحب الطلب وما سيُحتج به بعد شهر: «تم» ليست وصفًا.
  const delivered=v.text(input.delivered,'وصف ما سُلِّم فعلًا',3000,20);
  const department=handlingDepartment(db,before),round=closuresOf(db,requestId).length+1,time=now();
  // الانتقال نفسه يبقى في workflow.mjs بلا تعديل؛ هذه الوحدة تشترط الدليل وتحفظه وتتحقق من الإشعار.
  const detail=transition(db,u,requestId,'complete',{version:input.version,note:delivered});
  const closure=id();
  db.prepare('INSERT INTO request_closures(id,tenant_id,request_id,round,delivered,closed_by,handling_department_id,closed_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(closure,u.tenant_id,requestId,round,delivered,u.id,department,time);
  if(!closingNotice(db,before,time))fail(500,'silent_closure','ما انسجّل إشعار الإغلاق لصاحب الطلب — وما نقفل طلب بلا ما نعلم صاحبه');
  audit(db,u,'request',requestId,'request.closed',{round:round-1},{round,delivered,closure_id:closure},delivered);
  return {...closureView(db,u,requestId),request:detail};
}

export function requestReopen(db,supplied,requestId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','reason']);
  const r=getRequest(db,u,requestId);v.version(input.version,r.version);
  if(r.requester_id!==u.id)fail(403,'forbidden','إعادة الفتح لصاحب الطلب وحده: اللي نفّذ ما يقرر إن تنفيذه ما كفى');
  if(r.status!=='completed')fail(409,'not_completed','إعادة الفتح تكون لطلب مكتمل وبس');
  const closures=closuresOf(db,requestId),last=closures.at(-1);
  if(!last)refuse(409,'no_closure_record',noClosureRefusal(db,r));
  const service=serviceOf(db,r),setting=liveWindow(db,r.tenant_id,service.code);
  if(!setting)fail(409,'window_unset','مالك الإجراء ما حدّد مهلة إعادة الفتح لين الحين، فما تقدر تعيد الفتح. والمنصة ما تفترض مهلة ما قررها أحد');
  const holidays=holidaySet(db,r.tenant_id),deadline=addWorkingDays(riyadhDate(last.closed_at),setting.window_days,holidays);
  if(today()>deadline)fail(409,'window_closed',`مهلة إعادة الفتح (${setting.window_days} أيام عمل) خلصت في ${deadline} — افتح طلب جديد يشير لهذا الطلب`);
  const reason=v.text(input.reason,'سبب إعادة الفتح: ما الذي لم يُنجز',3000,10),round=last.round+1,time=now();
  db.prepare('INSERT INTO request_reopenings(id,tenant_id,request_id,closure_id,round,reason,requested_by,window_days,deadline_on,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id(),u.tenant_id,requestId,last.id,round,reason,u.id,setting.window_days,deadline,time);
  // الطلب يعود للتنفيذ بجولة ثانية؛ سجل الإغلاق الأول يبقى كما هو ويظهر في الخط الزمني.
  db.prepare("UPDATE requests SET status='in_progress',version=version+1,updated_at=? WHERE id=?").run(time,requestId);
  // الموجة 2، العطب 8: من أغلق الطلب قد يكون غادر. إعادة الفتح لا تعيد الطلب «قيد التنفيذ» عند حساب موقوف — لا يستطيع أحد إغلاقه
  // ولا إعادته؛ يعود إلى طابور إدارته ويُخبَر منفذوها (أو مديرها إن خلت)، ويُسجَّل حدث المغادرة بسببه.
  const holder=db.prepare('SELECT u.id,u.name,u.active FROM requests r JOIN users u ON u.id=r.assigned_to WHERE r.id=?').get(requestId);
  if(holder&&!holder.active){
    db.prepare('INSERT INTO request_assignment_events(id,tenant_id,request_id,kind,from_user_id,to_user_id,handling_department_id,reason,actor_id,created_at) VALUES(?,?,?,?,?,NULL,?,?,?,?)')
      .run(id(),u.tenant_id,requestId,'departure',holder.id,handlingDepartment(db,r),`أُعيد فتح الطلب وحساب من أغلقه «${holder.name}» موقوف؛ عاد إلى طابور إدارته المنفذة`,u.id,time);
    db.prepare("UPDATE requests SET status='approved',assigned_to=NULL WHERE id=?").run(requestId);
    announceToExecutors(db,db.prepare('SELECT * FROM requests WHERE id=?').get(requestId),u.id,`أُعيد فتحه وحساب منفّذه السابق «${holder.name}» موقوف`);
  }
  const reopened=getRequest(db,u,requestId);
  for(const person of executorsFor(db,service,handlingDepartment(db,reopened),r.tenant_id))
    notifyUser(db,person.id,requestId,'request_reopened');
  if(reopened.assigned_to&&reopened.assigned_to!==u.id)notifyUser(db,reopened.assigned_to,requestId,'request_reopened');
  audit(db,u,'request',requestId,'request.reopened',{status:'completed',round:last.round},{status:'in_progress',round,closure_id:last.id},reason);
  return closureView(db,u,requestId);
}

export function closureView(db,supplied,requestId){
  const u=actor(db,supplied),r=getRequest(db,u,requestId),service=serviceOf(db,r);
  const closures=closuresOf(db,requestId).map(c=>({...c,closed_by_name:db.prepare('SELECT name FROM users WHERE id=?').get(c.closed_by)?.name??''}));
  const reopenings=reopeningsOf(db,requestId);
  const setting=liveWindow(db,r.tenant_id,service.code),last=closures.at(-1);
  const holidays=holidaySet(db,r.tenant_id);
  const deadline=setting&&last?addWorkingDays(riyadhDate(last.closed_at),setting.window_days,holidays):null;
  const mine=r.requester_id===u.id;
  const available=[];
  if(requestActions(db,u,r).includes('complete'))available.push('close_with_evidence');
  if(mine&&r.status==='completed'&&last&&setting&&today()<=deadline)available.push('reopen');
  return {
    request:{id:r.id,title:r.title,status:r.status,version:r.version,service:service.name_ar,service_code:service.code},
    closures,reopenings,rounds:closures.length,
    // «أُنجزت من أول مرة» ليست مجاملة: كل جولة بعد الأولى تعني أن الخدمة لم تُسلَّم كما ينبغي.
    first_time_right:r.status==='completed'&&closures.length===1&&reopenings.length===0,
    reopen:{window_days:setting?.window_days??null,deadline_on:deadline,basis:setting?.basis??'',confirmed_on:setting?.confirmed_on??null,
      available:available.includes('reopen'),
      // الشكل المهيكل بجوار النص، فترسمه الشاشة بعدّة الرفض نفسها بدل فقرة عادية.
      refusal:setting&&!last?noClosureRefusal(db,r):null,
      why:!setting?'مهلة إعادة الفتح لم يحددها مالك الإجراء بعد؛ لا تفترض المنصة مهلة لم يقررها أحد.'
        :!last?refusalMessage(noClosureRefusal(db,r))
        :r.status!=='completed'?'إعادة الفتح تكون لطلب مكتمل.'
        :!mine?'إعادة الفتح لصاحب الطلب وحده.'
        :today()>deadline?`انتهت المهلة في ${deadline}.`:''},
    actions:available,
    note:'إعادة الفتح لا تمحو الإغلاق السابق: تُنشئ جولة جديدة مرتبطة به، فيبقى في سجل الطلب أن الخدمة لم تُنجز من أول مرة. وهذه المعلومة هي المقصودة.'
  };
}

// لوحة الإغلاق: الإعدادات السارية، وجولات إعادة الفتح، وفجوتان لا تُفترض سلامتهما بل تُفحصان.
export function closureBoard(db,supplied){
  const u=actor(db,supplied);
  const settings=db.prepare(`SELECT s.*,x.name AS set_by_name FROM reopen_settings s JOIN users x ON x.id=s.set_by
    WHERE s.tenant_id=? AND s.superseded_at IS NULL ORDER BY s.scope_code`).all(u.tenant_id);
  const completed=db.prepare("SELECT r.id,r.title,r.requester_id,r.updated_at,s.code FROM requests r JOIN services s ON s.id=r.service_id WHERE r.tenant_id=? AND r.status='completed'").all(u.tenant_id);
  const visible=completed.filter(row=>{try{getRequest(db,u,row.id);return true;}catch{return false;}});
  const withoutEvidence=visible.filter(row=>!db.prepare('SELECT 1 FROM request_closures WHERE request_id=?').get(row.id));
  const silent=visible.filter(row=>!db.prepare("SELECT 1 FROM notifications WHERE request_id=? AND user_id=? AND kind='execution_completed'").get(row.id,row.requester_id));
  const reopened=db.prepare(`SELECT o.round,o.reason,o.created_at,r.id AS request_id,r.title,s.code FROM request_reopenings o
    JOIN requests r ON r.id=o.request_id JOIN services s ON s.id=r.service_id WHERE o.tenant_id=? ORDER BY o.created_at DESC`).all(u.tenant_id)
    .filter(row=>{try{getRequest(db,u,row.request_id);return true;}catch{return false;}});
  return {
    settings,can_manage_general:can(db,u,'catalog.manage'),
    services:db.prepare('SELECT DISTINCT code,name_ar FROM services WHERE tenant_id=? AND active=1 ORDER BY code').all(u.tenant_id)
      .filter(s=>canSetWindow(db,u,s.code)).map(s=>({code:s.code,name:s.name_ar})),
    totals:{completed:visible.length,closed_with_evidence:visible.length-withoutEvidence.length,reopened:reopened.length},
    gaps:{
      without_evidence:withoutEvidence.map(row=>({id:row.id,title:row.title,service_code:row.code})),
      silent:silent.map(row=>({id:row.id,title:row.title,service_code:row.code}))
    },
    reopened,
    // منذ 21 سبتمبر 2026 صار الإغلاق بابًا واحدًا يمر بـcloseWithEvidence، فما في «بلا دليل مسجل» تاريخٌ لا مجرى جديد.
    // التاريخ لم يُردَم — لا تُخترع أدلة تسليم لم يكتبها أحد — لكنه لا يُترك صامتًا: كل طلب منها يشرح نفسه لصاحبه برفض مكتوب.
    note:'هذه اللوحة تعرض ما تراه أنت من الطلبات لا كلها. «بلا دليل مسجل» طلبٌ أُغلق قبل أن يصير الإغلاق بدليل هو المسار الوحيد، فلا مرجع لإعادة فتحه؛ ولا يزداد عددها اليوم، فكل إغلاق جديد يكتب سجله. و«إغلاق صامت» طلبٌ لم يصل صاحبه إشعارُ إغلاقه.'
  };
}
