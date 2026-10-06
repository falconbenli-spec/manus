import { audit } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { serviceOf, handlingDepartmentId, isDepartmentHead, notifyUser, catalog, createRequest } from './workflow.mjs';
import { afterTransition, requestLink } from './service-routes.mjs';
import { holidaySet, workingDaysBetween, riyadhDate } from './work-calendar.mjs';
import { adoptedTimerRows, NOT_ADOPTED, isolated, clockStart } from './workflow-timers.mjs';
import { deliverSubject } from './notice-recipients.mjs';
// مفتاح تفعيل الخدمة (ترحيل 129): وحدة ورقية لا تستورد هذه، فلا دورة.
import { isHidden, refuseHidden } from './service-availability.mjs';

// الطلب المعاد لا يخرج من الوجود (الموجة 2، العطب 4). كانت ساعته تتوقف إلى الأبد، ويغيب عن إدارته، ولا يلتقطه صندوق ولا يذكّر به أحد.
// صار ظاهرًا في ثلاثة مواضع بالضبط — لا أكثر، فالطلب قبل اعتماده لا يُفتح لفريق الإدارة المنفذة:
//   (1) «ما ينتظر ردّي» عند صاحبه (obligations.returnedToMe، منذ الموجة 1)، ويُعدّ هناك،
//   (2) «أعدتُها وتنتظر» عند من أعاده (returnedByMe): يتابعه ولا يُعدّ عليه — الكرة ليست عنده،
//   (3) عمل الإدارة المفتوح عند مدير الإدارة المنفذة (departmentReturned): بيانات وصفية بلا حمولة.
// وله عمر في المواضع الثلاثة: أيام العمل منذ الإعادة. التذكير والانقضاء آليان بمهل متبناة وحدها (sweepReturned)؛ بلا مهلة لا يحدث
// شيء ويُقال ذلك. حالات الطلب قائمة مغلقة، فالمنقضي يُغلق «ملغى» وصفّه في request_lapses هو ما يقول إنه انقضى ولم يلغه صاحبه.
const nameOf=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??'':'';
const returnOf=(db,r)=>db.prepare("SELECT decided_at,decided_by,approver_id FROM approval_steps WHERE request_id=? AND revision=? AND status='returned' ORDER BY decided_at DESC LIMIT 1").get(r.id,r.revision)??null;
// العطل تُقرأ مرة لكل لوحة لا مرة لكل صف (كما تفعل sweepReturned أصلًا): قراءتها داخل الحلقة مسحٌ كامل لكل طلب معروض.
const waitedSince=(since,at,holidays)=>workingDaysBetween(riyadhDate(since),riyadhDate(at),holidays);
const lapseTimer=timers=>timers.returned_expiry??null;

// (2) ما أعدتُه وينتظر صاحبه. من أعاد الطلب يبقى قارئًا له (workflow.visible لا يشترط أن الخطوة معلقة)، فالرابط يفتح عنده.
// «من أعاده» هو من قرر (decided_by)، أو من كان يملك قرار الخطوة حين أُعيدت — أي deciderOf بلغة SQL: صاحب أعلى درجة
// تصعيد إن وُجدت، وإلا معتمد الخطوة. التصعيد لا يمس approver_id، فقراءةُ العمود وحده كانت تُري المعتمدَ الأصلي
// «أعدتُها وتنتظر صاحبها» عن طلب لم يعده ولم يعد قراره بيده.
export function returnedByMe(db,u,at=Date.now()){
  const timers=adoptedTimerRows(db,u.tenant_id),expiry=lapseTimer(timers),holidays=holidaySet(db,u.tenant_id);
  return db.prepare(`SELECT r.*,s.decided_at AS returned_at FROM approval_steps s JOIN requests r ON r.id=s.request_id AND s.revision=r.revision
    WHERE r.tenant_id=? AND r.status='returned' AND s.status='returned'
      AND (s.decided_by=? OR COALESCE((SELECT e.to_user_id FROM approval_step_escalations e WHERE e.step_id=s.id ORDER BY e.level DESC LIMIT 1),s.approver_id)=?)
      AND r.requester_id<>? ORDER BY s.decided_at,r.id`).all(u.tenant_id,u.id,u.id,u.id)
    .map(r=>{const waited=waitedSince(r.returned_at,at,holidays),since=clockStart(r.returned_at,expiry),counted=expiry?waitedSince(since,at,holidays):waited;
      return {id:r.id,title:r.title,service_name:serviceOf(db,r).name_ar,requester_name:nameOf(db,r.requester_id),returned_at:r.returned_at,age_days:waited,link:`#request/${r.id}`,
        // العمر الظاهر منذ الإعادة، والمعدود للانقضاء من لحظة الإعادة أو تبني المهلة أيهما لاحق.
        lapse_note:expiry?`ينقضي عند ${expiry.value} يوم عمل بلا رد (المعدود ${counted}${since!==r.returned_at?`، من تبني المهلة في ${String(since).slice(0,10)}`:''})`:`الانقضاء ${NOT_ADOPTED}؛ يبقى مفتوحًا حتى يرد صاحبه أو يلغيه`};});
}
// (3) عمل الإدارة المفتوح: الطلبات المعادة التي ستنفذها إدارتي حين تُعتمد، عند مدير الإدارة المنفذة وحده. لا حمولة، ولا عنوان لخدمة سرية.
// توسعة قراءة صغيرة ومقصودة: المدير يرى أن طلبًا معادًا موجود وكم انتظر، لا ما فيه. visible() لم تتسع: الرابط لا يفتح عنده ما لم يكن طرفًا.
export function departmentReturned(db,supplied,at=Date.now()){
  const u=actorOrRefuse(db,supplied);
  if(u.role!=='manager'||!isDepartmentHead(db,u,u.department_id))return [];
  const out=[],holidays=holidaySet(db,u.tenant_id);
  for(const r of db.prepare("SELECT * FROM requests WHERE tenant_id=? AND status='returned' ORDER BY updated_at,id").all(u.tenant_id)){
    if(handlingDepartmentId(db,r)!==u.department_id)continue;
    const service=serviceOf(db,r),back=returnOf(db,r),guarded=!!service.approval_policy.confidential||!!service.approval_policy.closed_circle;
    out.push({id:r.id,reference:r.id.slice(0,8).toUpperCase(),title:guarded?'':r.title,service_code:service.code,service_name:service.name_ar,confidential:guarded,
      requester_name:guarded?'':nameOf(db,r.requester_id),returned_by_name:nameOf(db,back?.decided_by??back?.approver_id),returned_at:back?.decided_at??null,
      age_days:back?waitedSince(back.decided_at,at,holidays):null});
  }
  return out;
}
export const lapseOf=(db,requestId)=>db.prepare('SELECT * FROM request_lapses WHERE request_id=?').get(requestId)??null;

// (4) المنقضي لا يُترك بلا باب. الطلب أُغلق «ملغى» بقرار لم يتخذه أحد، وحمولته قائمة كما كتبها صاحبه في request_versions،
// فكان عليه أن يعيد إدخال الطلب كله من الصفر لإغلاقٍ لم يطلبه. «إعادة التقديم من الطلب المنقضي» تنسخ نسخته الأخيرة إلى
// مسودة جديدة باسمه ورقمها. ولا يُفتح المنقضي نفسه: قائمة حالات الطلب مغلقة، وصفّ الانقضاء يُكتب مرة واحدة (مفتاح الجدول)،
// فيبقى الطلب المنقضي مغلقًا وسجله شاهدًا أنه انقضى ولم يلغه أحد بيده. حقلٌ حذفته نسخة الخدمة الجديدة لا يُنسخ ويُسمَّى،
// والمرفقات لا تُنسخ — الملف مربوط بطلبه — ويُقال ذلك بدل أن يُفترض.
export function resubmitLapsed(db,supplied,rid,input){
  if(!db.isTransaction)fail(500,'transaction_required','إعادة التقديم لازم داخل معاملة قاعدة بيانات');
  const u=actorOrRefuse(db,supplied);v.object(input,['version','note']);
  const r=typeof rid==='string'?db.prepare('SELECT * FROM requests WHERE id=? AND tenant_id=?').get(rid,u.tenant_id)??null:null;
  if(!r||r.requester_id!==u.id||r.status!=='cancelled'||!lapseOf(db,r.id))refuse(404,'not_lapsed',{what:'إعادة التقديم من طلب منقضٍ لعدم الرد، لصاحبه وحده',
    missing:[{document:'طلب لك أُغلق بانقضاء مهلة الرد',why:'الطلب الملغى بيد صاحبه لا يُعاد تقديمه: هو ألغاه',owner:'صاحب الطلب'}],next:'افتح «طلباتي» واختر الطلب المكتوب عليه «انقضى لعدم الرد»'});
  v.version(input.version,r.version);
  const service=serviceOf(db,r),code=service.code,live=catalog(db,u).find(s=>s.code===code);
  // الموقوفة قبل المسحوبة، كما في createRequest حرفًا بحرف (مراجعة 22 سبتمبر): catalog() صار يُسقط الموقوفة،
  // فكان صاحب الطلب المنقضي يُقال له «لم تعد منشورة» عن خدمة منشورة أوقفها المالك — بلا سبب الإيقاف ولا اسم
  // من يعيد تفعيلها، ويُرسَل يطلب نشرًا قائمًا أصلًا. refuseHidden يقول الثلاثة، والرفض القديم يبقى لحاله
  // الحقيقية وحدها: خدمة سُحبت نسختها من الدليل.
  if(!live&&isHidden(db,u.tenant_id,'service',code))refuseHidden(db,u.tenant_id,'service',code,service.name_ar);
  if(!live)refuse(409,'service_unavailable',{what:`خدمة ${code} لم تعد منشورة، فلا يُقدَّم عليها طلب جديد`,
    missing:[{document:`نسخة سارية من خدمة ${code} في دليل الخدمات`,owner:'من يدير دليل الخدمات',owner_role:'catalog.manage'}],next:'اطلب ممن يدير الدليل نشر الخدمة، أو اختر الخدمة البديلة من الدليل'});
  const stored=db.prepare('SELECT snapshot FROM request_versions WHERE request_id=? AND revision=?').get(r.id,r.revision);
  const was=stored?JSON.parse(stored.snapshot):{},old=was.payload??JSON.parse(r.payload),keys=new Set(live.fields.map(f=>f.key));
  const dropped=Object.keys(old).filter(key=>!keys.has(key));
  const fresh=createRequest(db,u,{service_id:live.id,title:was.title??r.title,payload:Object.fromEntries(Object.entries(old).filter(([key])=>keys.has(key))),project_id:r.project_id??null});
  audit(db,u,'request',fresh.id,'request.resubmitted_from_lapsed',{}, {from_request_id:r.id,from_revision:r.revision,service_code:code,dropped_fields:dropped},
    'أعاد صاحب الطلب تقديمه من طلبه الذي انقضى لعدم الرد؛ الطلب المنقضي باقٍ مغلقًا كما هو');
  return {...fresh,resubmitted_from:r.id,dropped_fields:dropped,
    resubmit_note:`نُسخت بيانات الطلب المنقضي إلى مسودة جديدة${dropped.length?`، عدا حقولًا لم تعد في الخدمة: ${dropped.join('، ')}`:''}. المرفقات لا تُنسخ: أعد إرفاق ما يلزم قبل التقديم.`};
}

// ── التشغيل اليومي: تذكير صاحب الطلب المعاد، ثم انقضاؤه — بمهل متبناة وحدها ────────────
// العمر من لحظة الإعادة (decided_at للخطوة المعادة)، بأيام العمل. لا يُقرأ requests.updated_at: المرفق والتعديل يغيّرانه.
// كل تذكير بمفتاح في reminder_log (returned:<الطلب>:<النسخة>:<المرحلة>)، فالتشغيل مرتين = مرة.
// لا ينقضي طلب لم يُذكَّر صاحبه: يلزم تذكير أول مسجَّل سبق يوم الانقضاء بيوم عمل على الأقل — فمهلة انقضاء تُتبنى اليوم لا تُسقط اليوم
// طلبًا قديمًا لم يسمع صاحبه عنها شيئًا. والجدول نفسه يرفض صف الانقضاء بلا مهلة متبناة بلغها الانتظار.
const logged=(db,tenantId,key)=>db.prepare('SELECT created_at FROM reminder_log WHERE tenant_id=? AND reminder_key=?').get(tenantId,key)?.created_at??null;
const once=(db,tenantId,key,time)=>db.prepare('INSERT INTO reminder_log(tenant_id,reminder_key,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(tenantId,key,time).changes===1;
export function sweepReturned(db,tenantId,auditor,timers=adoptedTimerRows(db,tenantId),at=Date.now()){
  if(!db.isTransaction)fail(500,'transaction_required','متابعة الطلبات المعادة لازم تشتغل داخل معاملة');
  const first=timers.returned_reminder_first??null,second=timers.returned_reminder_second??null,expiry=lapseTimer(timers);
  const out={reminded_first:0,reminded_second:0,lapsed:0,owner_gone:0};
  if(!first){out.note=`التذكير بالطلب المعاد ${NOT_ADOPTED}؛ لم يُذكَّر أحد ولم ينقضِ طلب`;return out;}
  if(!expiry)out.lapse_note=`انقضاء الطلب المعاد ${NOT_ADOPTED}؛ الطلبات المعادة تبقى مفتوحة`;
  const time=new Date(at).toISOString(),today=riyadhDate(at),holidays=holidaySet(db,tenantId),failures=[];
  for(const r of db.prepare("SELECT * FROM requests WHERE tenant_id=? AND status='returned' ORDER BY created_at,id").all(tenantId))isolated(db,failures,`request:${r.id}`,()=>{
    const back=returnOf(db,r);if(!back)return;
    const waited=workingDaysBetween(riyadhDate(back.decided_at),today,holidays),key=stage=>`returned:${r.id}:${r.revision}:${stage}`,returner=back.decided_by??back.approver_id;
    // المعدود لكل مهلة من لحظة الإعادة أو لحظة تبنيها أيهما لاحق (الساعة تبدأ من التبني)؛ waited العمر الحقيقي منذ الإعادة، يُقال في الرسائل.
    const started=timer=>clockStart(back.decided_at,timer),counted=timer=>workingDaysBetween(riyadhDate(started(timer)),today,holidays);
    const clock=timer=>started(timer)!==back.decided_at?{clock_started_at:started(timer)}:{};
    const owner=db.prepare('SELECT id,active,department_id FROM users WHERE id=?').get(r.requester_id);
    const remindedAt=logged(db,tenantId,key('first'));
    // الانقضاء أولًا: طلب بلغ المهلة وذُكِّر صاحبه قبل اليوم لا يُذكَّر مرة أخرى ثم يُغلق في التشغيل نفسه.
    if(expiry&&counted(expiry)>=expiry.value&&remindedAt&&workingDaysBetween(riyadhDate(remindedAt),today,holidays)>=1){
      db.prepare('INSERT INTO request_lapses(request_id,tenant_id,revision,returned_at,returned_by,reminded_at,waited_days,timer_row_id,lapsed_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(r.id,tenantId,r.revision,back.decided_at,returner,remindedAt,waited,expiry.id,time);
      db.prepare("UPDATE requests SET status='cancelled',version=version+1,updated_at=? WHERE id=? AND status='returned'").run(time,r.id);
      // للتماثل مع الإلغاء اليدوي: الخدمات الموجَّهة لا تفعل شيئًا عند الإلغاء، وسجلها النظامي (استقالة فُتحت عند التقديم) لا يُمس.
      afterTransition(db,auditor,r,'cancel','cancelled');
      const routed=requestLink(db,r.id);
      const recordNote=routed?'السجل الذي فُتح من هذا الطلب في وحدته لم يُمس بانقضاء الطلب؛ يبقى ساريًا في شاشته.':'';
      // صاحب الطلب موقوف الحساب: أُخبر مدير إدارته يوم التذكير الأول أن طلبًا ينتظر ردًّا لا يستطيع صاحبه أن يرده،
      // فلا يُترك بلا خبر يوم أُغلق. يمر الخبر بالسُلَّم نفسه، فإن لم يبقَ أحد سُجِّل في «بلا مستلم» ولم يسقط صامتًا.
      if(owner?.active)notifyUser(db,r.requester_id,r.id,'request_lapsed',{waited,timer_value:expiry.value,record_note:recordNote});
      else{deliverSubject(db,{tenantId,aboutUserId:r.requester_id,departmentId:owner?.department_id??null,kind:'request_lapsed_owner_gone',subjectKind:'department_work',subjectId:r.id,
        title:`انقضى طلب معاد صاحبه موقوف الحساب — ${serviceOf(db,r).code}`,
        body:`أُعيد الطلب إلى صاحبه ولم يستطع الرد، وانقضى بعد ${waited} يوم عمل ومهلة الانقضاء المعتمدة ${expiry.value}. أُغلق «ملغى» بلا قرار من أحد. ${recordNote}`.trim()});out.owner_gone++;}
      if(returner&&returner!==r.requester_id&&db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(returner))notifyUser(db,returner,r.id,'request_lapsed_returner',{timer_value:expiry.value});
      audit(db,auditor,'request',r.id,'request.lapsed',{status:'returned',revision:r.revision},
        {status:'cancelled',lapsed:true,waited_days:waited,counted_days:counted(expiry),...clock(expiry),timer_row_id:expiry.id,timer_value:expiry.value,reminded_at:remindedAt,returned_at:back.decided_at,routed_record_untouched:!!routed,by:'workflow-sweep'},
        `انقضى لعدم الرد: انتظر صاحبه ${waited} يوم عمل بعد إعادته وتذكيره، ومهلة الانقضاء المعتمدة ${expiry.value} يوم عمل`);
      out.lapsed++;return;
    }
    if(counted(first)>=first.value&&once(db,tenantId,key('first'),time)){
      // صاحب الطلب أُوقف حسابه: لا أحد يستطيع الرد. يُخبَر مدير إدارته (أو سُلَّمها)، ولا يسقط الخبر صامتًا.
      if(owner?.active)notifyUser(db,r.requester_id,r.id,'returned_reminder',{waited,expires_after:expiry?.value??null});
      else{deliverSubject(db,{tenantId,aboutUserId:r.requester_id,departmentId:owner?.department_id??null,kind:'returned_owner_gone',subjectKind:'department_work',subjectId:r.id,
        title:`طلب معاد صاحبه موقوف الحساب — ${serviceOf(db,r).code}`,body:`أُعيد الطلب قبل ${waited} يوم عمل ولا يستطيع صاحبه الرد. ${expiry?`ينقضي عند ${expiry.value} يوم عمل.`:'لا مهلة انقضاء معتمدة، فسيبقى مفتوحًا.'}`});out.owner_gone++;}
      audit(db,auditor,'request',r.id,'request.returned_reminded',{}, {stage:'first',waited_days:waited,counted_days:counted(first),...clock(first),timer_row_id:first.id,timer_value:first.value,by:'workflow-sweep'});
      out.reminded_first++;return;
    }
    if(second&&counted(second)>=second.value&&remindedAt&&once(db,tenantId,key('second'),time)){
      if(owner?.active)notifyUser(db,r.requester_id,r.id,'returned_reminder',{waited,expires_after:expiry?.value??null});
      if(returner&&returner!==r.requester_id)notifyUser(db,returner,r.id,'returned_still_waiting',{waited});
      audit(db,auditor,'request',r.id,'request.returned_reminded',{}, {stage:'second',waited_days:waited,counted_days:counted(second),...clock(second),timer_row_id:second.id,timer_value:second.value,by:'workflow-sweep'});
      out.reminded_second++;
    }
  });
  if(failures.length)out.failures=failures;
  return out;
}
