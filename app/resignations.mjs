import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail, AppError } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { registerHandler, enqueue } from './jobs.mjs';
import { riyadhDate } from './work-calendar.mjs';
import { openOffboardingFor } from './lifecycle.mjs';
import { resignationNotice, offboardingNotice } from './module-notices.mjs';
import { acceptedRule, ruleOrDraft, addDays, daysBetween, riyadhToday } from './payroll-rules.mjs';

// الاستقالة وفق اللائحة: خطاب مؤرخ إلى مدير الإدارة ونسخة إلى الموارد البشرية (م34/1)، تُعد مقبولة إذا مضى عليها أكثر من
// ثلاثين يومًا دون قبولها، ويجوز تأجيل قبولها حتى ستين يومًا لمصلحة العمل بسبب مكتوب (م34/2). صاحب الصلاحية يحدد آخر يوم عمل
// وله الإعفاء من الإشعار (م37/3)، ولا تُقبل استقالة المحال إلى التحقيق أو الموقوف حتى يُبت في أمره (م37/5).
// القبول (صريحًا أو حكميًا) يفتح حزمة المغادرة من lifecycle.mjs. المنصة لا تنهي العقد ولا تعطل حسابًا ولا تصرف مستحقات.
export const STATUS_NAMES={submitted:'مقدمة بانتظار الرد',deferred:'مؤجل قبولها لمصلحة العمل',accepted:'مقبولة',deemed_accepted:'مقبولة حكمًا بمضي المدة',withdrawn:'مسحوبة'};
export const JOB_TYPE='resignation.deemed_acceptance';
// م37/5: الوسم الذي يحمله الخطاب المسجَّل ما دام في حق صاحبه تحقيق أو إيقاف مفتوح. التقديم مسجَّل، والقبول وحده موقوف.
export const HOLD_NOTE='موقوف قبولها حتى يُبتَّ في التحقيق (م37/5)';
// من يُبت في أمره: الموارد البشرية تُنهي حالتها، وصاحب صلاحية توقيع الجزاء يقرر في قضية المخالفة، والإيقاف يرفعه من أوقفه.
export const HOLD_OWNER='يُبت في الأمر قبل القبول: الموارد البشرية تغلق حالتها، وصاحب صلاحية توقيع الجزاء (hr.discipline.decide) يقرر في قضية المخالفة، ومن أوقف عن العمل يرفع الإيقاف.';
const id=()=>randomUUID();
const OPEN=['submitted','deferred'];
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','الاستقالة لحسابات الموظفين');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}

// ————— خطاف التحقيق والإيقاف (م37/5) —————
// مصادر إضافية تسجلها وحدة الجزاءات عند تحميلها: fn(db,tenantId,userId) ← [{source,id,title}] للإجراءات المفتوحة فقط.
const investigationSources=new Map();
export function registerInvestigationSource(key,fn){if(typeof fn!=='function')throw new Error('investigation source must be a function');investigationSources.set(key,fn);}
// جداول الجزاءات المحتملة إن وُجدت بلا تسجيل صريح: يُقرأ منها ما لم يُغلق بعد، بأعمدتها إن طابقت.
const DISCIPLINE_TABLES=['disciplinary_cases','discipline_cases','discipline_investigations','employee_suspensions'];
// دمج 20260919: حالات discipline_cases (ترحيل 097) المنتهية: notified (أُبلغ بالجزاء) وnot_proven وlapsed لا تبقي تحقيقًا مفتوحًا؛
// المفتوح منها recorded وinvestigating وproven (قبل القرار).
const CLOSED=new Set(['closed','decided','cancelled','withdrawn','dismissed','rejected','completed','resolved','archived','ended','notified','not_proven','lapsed']);
function disciplineRows(db,tenantId,userId){
  const out=[];
  for(const table of DISCIPLINE_TABLES){
    if(investigationSources.size&&table!=='employee_suspensions')continue;
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    const cols=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
    const who=['employee_id','subject_id','user_id'].find(c=>cols.has(c));
    if(!who||!cols.has('status')||!cols.has('tenant_id'))continue;
    for(const r of db.prepare(`SELECT id,status FROM ${table} WHERE tenant_id=? AND ${who}=?`).all(tenantId,userId))
      if(!CLOSED.has(String(r.status)))out.push({source:table,id:r.id,title:table==='employee_suspensions'?'إيقاف عن العمل':'إجراء تأديبي أو تحقيق مفتوح'});
  }
  return out;
}
// التحقيقات والإيقافات المفتوحة بحق الموظف. الحالات السرية (hr_cases) يكون فيها الموظف مشكوًا منه؛ لا تُكشف تفاصيلها لصاحب الاستقالة.
export function openInvestigationsFor(db,tenantId,userId){
  const cases=db.prepare("SELECT id,subject FROM hr_cases WHERE tenant_id=? AND respondent_id=? AND status<>'closed' AND category IN ('complaint','violation_report','grievance')").all(tenantId,userId)
    .map(c=>({source:'hr_cases',id:c.id,title:`حالة موارد بشرية مفتوحة: ${c.subject}`}));
  const extra=[...investigationSources.values()].flatMap(fn=>fn(db,tenantId,userId)??[]);
  return [...cases,...extra,...disciplineRows(db,tenantId,userId)];
}

// ————— الحساب —————

const ruleFor=(db,tenantId,date)=>ruleOrDraft(db,tenantId,'resignation',date);
// يوم القبول الحكمي: أول يوم يكون فيه قد مضى أكثر من المدة على التقديم، أو نهاية التأجيل إن أُجِّل.
export function deemedOn(r,params){return r.status==='deferred'&&r.deferred_until?r.deferred_until:addDays(r.submitted_on,params.deemed_after_days+1);}
export function deferralLimit(r,params){return addDays(r.submitted_on,params.deferral_anchor==='deemed_date'?params.deemed_after_days+params.deferral_max_days:params.deferral_max_days);}
const authorityOf=(db,u,params)=>holds(db,u,params.authority_capability);
const noticeDays=(db,userId)=>db.prepare("SELECT notice_days FROM employment_contracts WHERE user_id=? AND status='active' ORDER BY start_date DESC LIMIT 1").get(userId)?.notice_days??0;
const departmentManager=(db,e)=>{
  if(e.manager_id)return e.manager_id;
  const rows=db.prepare("SELECT id FROM users WHERE tenant_id=? AND department_id=? AND role='manager' AND active=1 AND id<>?").all(e.tenant_id,e.department_id,e.id);
  return rows.length===1?rows[0].id:null;
};

function view(db,u,r,today){
  const rule=ruleFor(db,u.tenant_id,today),params=rule.parameters,own=r.user_id===u.id,authority=authorityOf(db,u,params);
  const staff=authority||holds(db,u,'people.manage')||u.role==='hr';
  const open=OPEN.includes(r.status),deemed=deemedOn(r,params),investigations=open||r.status==='accepted'?openInvestigationsFor(db,u.tenant_id,r.user_id):[];
  const actions=[];
  if(open&&own)actions.push('withdraw_resignation');
  if(open&&authority&&!own){
    if(!investigations.length)actions.push('accept_resignation');
    if(rule.active&&today<deemed)actions.push('defer_resignation');
  }
  if(['accepted','deemed_accepted'].includes(r.status)&&authority&&!own&&!r.last_day_set_by)actions.push('set_last_day');
  if(['accepted','deemed_accepted'].includes(r.status)&&!r.offboarding_bundle_id&&holds(db,u,'people.manage')&&!own)actions.push('open_offboarding');
  return {id:r.id,user_id:r.user_id,employee_name:personName(db,r.user_id),addressed_to_name:personName(db,r.addressed_to),hr_copied:true,letter_date:r.letter_date,submitted_on:r.submitted_on,
    reason:own||staff?r.reason:null,proposed_last_day:r.proposed_last_day,status:r.status,status_name:STATUS_NAMES[r.status],version:r.version,own,
    clock:open?{active:rule.active,deemed_on:deemed,days_left:daysBetween(today,deemed),deferral_limit:deferralLimit(r,params),
      label:rule.active?(daysBetween(today,deemed)>0?`تُعد مقبولة حكمًا في ${deemed} (باقٍ ${daysBetween(today,deemed)} يوم)`:`بلغت يوم القبول الحكمي ${deemed}`):`ساعة القبول الحكمي متوقفة حتى يقبل مدير الموارد البشرية قاعدة الاستقالة (المسودة: ${params.deemed_after_days} يومًا)`}:null,
    deferred_until:r.deferred_until,deferral_reason:staff||own?r.deferral_reason:null,deferred_by_name:personName(db,r.deferred_by),
    accepted_on:r.accepted_on,accepted_by_name:personName(db,r.accepted_by),last_working_day:r.last_working_day,notice_waived:!!r.notice_waived,last_day_set_by_name:personName(db,r.last_day_set_by),
    hold:investigations.length?(staff?{count:investigations.length,items:investigations.map(i=>i.title)}:{count:investigations.length,items:[]}):null,
    // م37/5 تمنع القبول لا التقديم: الخطاب مسجَّل بتاريخه وساعة الإشعار تجري، والوسم يقول إن القبول وحده موقوف.
    acceptance_held:open&&investigations.length>0,
    hold_label:open&&investigations.length?HOLD_NOTE:'',
    hold_owner:open&&investigations.length?HOLD_OWNER:'',
    hold_note:r.hold_note,offboarding_bundle_id:r.offboarding_bundle_id,offboarding_note:staff?r.offboarding_note:'',
    // D-12: القبول بلا حزمة حالة معلنة على السجل، لا ملاحظة مدفونة. تظهر لمن يملك فتحها وللموظفين المعنيين.
    offboarding_blocked:staff&&['accepted','deemed_accepted'].includes(r.status)&&!r.offboarding_bundle_id,
    offboarding_action_owner:!r.offboarding_bundle_id&&['accepted','deemed_accepted'].includes(r.status)?'حامل تصريح التوظيف والتهيئة (people.manage): «فتح حزمة المغادرة»':null,
    source_request_id:r.source_request_id,actions};
}
export function resignationsBoard(db,supplied){
  const u=actor(db,supplied),today=riyadhToday(),rule=ruleFor(db,u.tenant_id,today);
  const staff=authorityOf(db,u,rule.parameters)||holds(db,u,'people.manage')||u.role==='hr';
  const rows=staff?db.prepare('SELECT * FROM resignations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200').all(u.tenant_id)
    :db.prepare('SELECT * FROM resignations WHERE tenant_id=? AND (user_id=? OR addressed_to=?) ORDER BY created_at DESC').all(u.tenant_id,u.id,u.id);
  const list=rows.map(r=>view(db,u,r,today)),mine=list.find(r=>r.own&&OPEN.includes(r.status));
  return {today,user_id:u.id,status_names:STATUS_NAMES,rule:{active:rule.active,id:rule.id,articles:rule.articles,parameters:rule.parameters},
    can_submit:!mine&&!list.some(r=>r.own&&['accepted','deemed_accepted'].includes(r.status)),resignations:list,
    // D-12: ما قُبل ولم تُفتح حزمته يُعرض تنبيهًا في رأس اللوحة، فلا يمر القبول بلا أثر.
    alerts:list.filter(r=>r.offboarding_blocked).map(r=>({kind:'offboarding_blocked',resignation_id:r.id,
      message:`قُبلت استقالة ${r.employee_name} ولم تُفتح حزمة المغادرة${r.offboarding_note?`: ${r.offboarding_note}`:''}. ${r.offboarding_action_owner}`})),
    awaiting_me:list.filter(r=>r.actions.some(a=>['accept_resignation','defer_resignation','set_last_day','open_offboarding'].includes(a))).map(r=>({id:r.id,title:`استقالة ${r.employee_name}`,created_at:r.submitted_on,actions:r.actions.filter(a=>a!=='withdraw_resignation')})),
    note:'الاستقالة خطاب مؤرخ إلى مدير الإدارة ونسخة إلى الموارد البشرية. تُعد مقبولة إذا مضى عليها أكثر من ثلاثين يومًا دون قبول، ويجوز تأجيل قبولها حتى ستين يومًا لمصلحة العمل بسبب مكتوب. تُسجَّل بتاريخها دائمًا، ولا يُقبَل قبولها أثناء تحقيق أو إيقاف مفتوح حتى يُبت في الأمر (م37/5). القبول يفتح حزمة المغادرة، ولا ينهي العقد ولا يصرف مستحقات.'};
}

// ————— التقديم —————

export function submitResignation(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['letter_date','reason','proposed_last_day','source_request_id']);
  const today=riyadhToday(),letter=v.date(input.letter_date),last=v.date(input.proposed_last_day);
  if(letter>today||letter<addDays(today,-14))fail(400,'letter_date','تاريخ الخطاب اليوم أو قبله بما لا يزيد على أربعة عشر يومًا');
  if(last<today)fail(400,'proposed_last_day','آخر يوم عمل مقترح اليوم أو بعده');
  const rule=ruleFor(db,u.tenant_id,today);
  // م37/5 الموقعة: «لا يجوز قبول استقالة العامل المُحال إلى التحقيق، أو الموقوف عن العمل؛ حتى يُبتَّ في أمره».
  // هي تمنع القبول لا التقديم. وكان التقديم نفسه يُرفض، فلا يُسجَّل الخطاب ولا يبدأ الإشعار، فيخسر العامل مدةً تعطيه إياها
  // اللائحة. الآن يُسجَّل الخطاب بتاريخه ويوسم «موقوف قبولها»، والمنع في بابه: مسار القبول وساعة القبول الحكمي.
  if(db.prepare("SELECT 1 FROM resignations WHERE tenant_id=? AND user_id=? AND status IN ('submitted','deferred')").get(u.tenant_id,u.id))fail(409,'resignation_open','لديك استقالة مقدمة لم يُبت فيها');
  const employee=db.prepare('SELECT * FROM users WHERE id=?').get(u.id),resignationId=id(),time=now();
  const held=rule.parameters.block_during_investigation?openInvestigationsFor(db,u.tenant_id,u.id):[];
  db.prepare("INSERT INTO resignations(id,tenant_id,user_id,addressed_to,letter_date,submitted_on,reason,proposed_last_day,status,hold_note,policy_id,source_request_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'submitted',?,?,?,?,?)")
    .run(resignationId,u.tenant_id,u.id,departmentManager(db,employee),letter,today,input.reason?v.text(input.reason,'السبب',1500,3):'لم يذكر سببًا',last,held.length?HOLD_NOTE:'',rule.active?rule.id:null,input.source_request_id??null,time,time);
  audit(db,u,'resignation',resignationId,'resignation.submitted',{}, {letter_date:letter,submitted_on:today,proposed_last_day:last,acceptance_held:held.length>0});
  // إشعار الاستلام لصاحبها، وإشعار القرار لمدير الإدارة المخاطَب ولحاملي صلاحية القبول. لا يُذكر سبب الاستقالة.
  const deemed=deemedOn({submitted_on:today,status:'submitted'},rule.parameters);
  resignationNotice(db,u,'submitted',db.prepare('SELECT * FROM resignations WHERE id=?').get(resignationId),{deemed_on:rule.active?deemed:null,capability:rule.parameters.authority_capability});
  // ساعة القبول الحكمي: مهمة في الطابور تصحو في يوم القبول الحكمي، وتعيد جدولة نفسها يوميًا ما دام الأمر معلقًا.
  scheduleClock(db,u,{id:resignationId,submitted_on:today,status:'submitted'},deemed);
  return {id:resignationId,submitted_on:today,acceptance_held:held.length>0,hold_note:held.length?HOLD_NOTE:''};
}
function scheduleClock(db,u,r,date){
  ensureJobHandlers();
  // منتصف ليل الرياض لليوم المطلوب.
  const dueAt=new Date(Date.parse(`${date}T00:00:00+03:00`)).toISOString();
  return enqueue(db,u,{type:JOB_TYPE,payload:{resignation_id:r.id},idempotency_key:`resignation-deem:${r.id}:${date}`,source:{entity:'resignation',id:r.id},due_at:dueAt,max_attempts:5});
}

// ————— القرارات —————

function row(db,u,resignationId){
  const r=typeof resignationId==='string'&&db.prepare('SELECT * FROM resignations WHERE id=? AND tenant_id=?').get(resignationId,u.tenant_id);
  if(!r)fail(404,'not_found','الاستقالة غير متاحة');
  return r;
}
export function resignationAction(db,supplied,resignationId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields={withdraw_resignation:['note'],accept_resignation:['last_working_day','notice_waived','note'],defer_resignation:['deferred_until','reason'],set_last_day:['last_working_day','notice_waived','note'],open_offboarding:[]}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const r=row(db,u,resignationId),today=riyadhToday(),current=view(db,u,r,today);
  const staff=authorityOf(db,u,ruleFor(db,u.tenant_id,today).parameters)||holds(db,u,'people.manage')||u.role==='hr';
  if(!current.own&&r.addressed_to!==u.id&&!staff)fail(404,'not_found','الاستقالة غير متاحة');
  v.version(input.version,r.version);
  if(!current.actions.includes(action)){
    // م37/5: الرفض هنا يسمي ما هو مفتوح ومن يبت فيه، لا «الإجراء غير متاح». الخطاب يبقى مسجَّلًا بتاريخه.
    if(action==='accept_resignation'&&current.hold){
      const open=openInvestigationsFor(db,u.tenant_id,r.user_id);
      fail(409,'investigation_open',`${HOLD_NOTE}. المفتوح الآن: ${open.map(i=>i.title).join('؛ ')}. ${HOLD_OWNER} وتاريخ تقديم الاستقالة (${r.submitted_on}) مسجَّل ولا يتأثر بالوقف`);
    }
    fail(409,'action_unavailable','الإجراء غير متاح في حالة الاستقالة الحالية أو لصلاحيتك');
  }
  const rule=ruleFor(db,u.tenant_id,today),params=rule.parameters,time=now(),set=(sql,...args)=>db.prepare(`UPDATE resignations SET ${sql},version=version+1,updated_at=? WHERE id=?`).run(...args,time,r.id);
  let bundle=null;
  if(action==='withdraw_resignation'){
    set("status='withdrawn',decision_note=?",input.note?v.text(input.note,'ملاحظة',1000):'سحبها صاحبها');
  }else if(action==='defer_resignation'){
    const until=v.date(input.deferred_until),limit=deferralLimit(r,params),reason=v.text(input.reason,'سبب التأجيل المتعلق بمصلحة العمل',2000,10);
    if(until<=today)fail(400,'deferred_until','تاريخ نهاية التأجيل بعد اليوم');
    if(until>limit)fail(409,'deferral_limit',`لا يتجاوز التأجيل ${params.deferral_max_days} يومًا (${limit}) بحسب م34/2`);
    if(until<=deemedOn({...r,status:'submitted'},params)&&r.status==='submitted')fail(400,'deferred_until','التأجيل يمد القبول بعد يوم القبول الحكمي؛ اختر تاريخًا بعده');
    set("status='deferred',deferred_until=?,deferral_reason=?,deferred_by=?,policy_id=?",until,reason,u.id,rule.id);
    scheduleClock(db,u,r,until);
  }else if(action==='accept_resignation'||action==='set_last_day'){
    const last=lastDay(db,r,input),note=input.note?v.text(input.note,'ملاحظة القرار',2000):'';
    if(action==='accept_resignation')set("status='accepted',accepted_on=?,accepted_by=?,last_working_day=?,notice_waived=?,last_day_set_by=?,decision_note=?",today,u.id,last.date,last.waived,u.id,note);
    else set('last_working_day=?,notice_waived=?,last_day_set_by=?,decision_note=?',last.date,last.waived,u.id,note);
    // D-12: الفشل لم يعد يُبتلع. الحزمة تُفتح في نقطة حفظ (القبول نفسه لا يسقط بفشلها)، لكن نتيجتها تُعاد في الرد
    // وتصل حامل تصريح التوظيف والتهيئة إشعارًا قابلًا للتنفيذ.
    if(action==='accept_resignation')bundle=openOffboarding(db,u,db.prepare('SELECT * FROM resignations WHERE id=?').get(r.id),'قبول صاحب الصلاحية');
  }else if(action==='open_offboarding'){
    const opened=openOffboarding(db,u,r,'فتح يدوي بعد القبول',true);
    return {id:r.id,offboarding_bundle_id:opened};
  }
  audit(db,u,'resignation',r.id,'resignation.'+action,{status:r.status,version:r.version},{version:r.version+1});
  // الإشعار بعد الكتابة وبصف الاستقالة كما صار: القبول وتحديد آخر يوم والتأجيل تصل صاحبها، والسحب يصل من كان ينتظر القرار.
  const event={withdraw_resignation:'withdrawn',accept_resignation:'accepted',defer_resignation:'deferred',set_last_day:'last_day_set'}[action];
  const latest=db.prepare('SELECT * FROM resignations WHERE id=?').get(r.id);
  if(event)resignationNotice(db,u,event,latest,{capability:params.authority_capability});
  if(action!=='accept_resignation')return {id:r.id};
  // D-12: نتيجة فتح الحزمة جزء من رد القبول، لا ملاحظة صامتة. ومن يفتحها يُشعَر بأي الحالتين وقعت.
  offboardingNotice(db,u,latest,{bundle_id:bundle,note:latest.offboarding_note});
  return {id:r.id,offboarding_bundle_id:bundle,offboarding_opened:!!bundle,
    ...(bundle?{}:{offboarding_blocked:true,offboarding_note:latest.offboarding_note,
      offboarding_next:'قُبلت الاستقالة ولم تُفتح حزمة المغادرة. عالج السبب ثم استعمل «فتح حزمة المغادرة» من شاشة «الاستقالة»؛ أُشعِر بذلك حاملو تصريح التوظيف والتهيئة.'})};
}
// صاحب الصلاحية يحدد آخر يوم عمل شاملًا الإشعار، وله الإعفاء منه (م37/3).
function lastDay(db,r,input){
  const date=v.date(input.last_working_day);
  if(typeof input.notice_waived!=='boolean')fail(400,'notice_waived','حدد إن كان الإعفاء من فترة الإشعار ممنوحًا');
  if(date<r.submitted_on)fail(400,'last_working_day','آخر يوم عمل لا يسبق تقديم الاستقالة');
  const notice=noticeDays(db,r.user_id),earliest=addDays(r.submitted_on,notice);
  if(!input.notice_waived&&date<earliest)fail(409,'notice_period',`آخر يوم عمل قبل انتهاء فترة الإشعار (${notice} يومًا من التقديم = ${earliest}). اختر تاريخًا بعدها أو سجّل الإعفاء منها`);
  return {date,waived:input.notice_waived?1:0};
}

// ————— حزمة المغادرة —————

// مالك الحزمة: حساب نشط في الموارد البشرية يملك التوظيف والتهيئة وليس صاحب الرحلة. الأول بالترتيب إن تعدد.
function offboardingOwner(db,tenantId,employeeId,prefer){
  if(prefer&&prefer.id!==employeeId&&holds(db,prefer,'people.manage'))return prefer;
  return db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY role<>'hr',id").all(tenantId,employeeId).find(x=>holds(db,x,'people.manage'))??null;
}
// يُفتح في نقطة حفظ: فشل القالب أو غموض مالك خطوة لا يُسقط قبول الاستقالة، بل يُسجل سببه ويظهر إجراء «فتح حزمة المغادرة».
function openOffboarding(db,u,r,why,strict=false){
  const owner=offboardingOwner(db,r.tenant_id,r.user_id,u),effective=r.last_working_day??r.proposed_last_day;
  const note=reason=>{db.prepare('UPDATE resignations SET offboarding_note=?,version=version+1,updated_at=? WHERE id=?').run(reason,now(),r.id);if(strict)fail(409,'offboarding_unavailable',reason);return null;};
  if(!owner)return note('لا يوجد حساب في الموارد البشرية يملك التوظيف والتهيئة ليملك حزمة المغادرة');
  db.exec('SAVEPOINT resignation_offboarding');
  try{
    const bundle=openOffboardingFor(db,owner,{employee_id:r.user_id,owner_id:owner.id,effective_date:effective,
      date_basis:`${why}: استقالة مؤرخة ${r.letter_date}، آخر يوم ${r.last_working_day?'حدده صاحب الصلاحية':'مقترح من الموظف بانتظار صاحب الصلاحية'} ${effective}`});
    db.exec('RELEASE resignation_offboarding');
    db.prepare("UPDATE resignations SET offboarding_bundle_id=?,offboarding_note='',version=version+1,updated_at=? WHERE id=?").run(bundle.id,now(),r.id);
    return bundle.id;
  }catch(error){
    db.exec('ROLLBACK TO resignation_offboarding');db.exec('RELEASE resignation_offboarding');
    if(!(error instanceof AppError))throw error;
    return note(`لم تُفتح حزمة المغادرة: ${error.message}`);
  }
}

// ————— القبول الحكمي في الطابور —————

// المهمة لا تقرر: تطبق م34/1 كما قبلها مدير الموارد البشرية. إن لم تُقبل القاعدة أو كان تحقيق مفتوح، تُعلَّق وتعيد جدولة نفسها لليوم التالي.
export function deemedAcceptanceHandler(db,job,{user,now:at}){
  const today=riyadhDate(at),r=db.prepare('SELECT * FROM resignations WHERE id=? AND tenant_id=?').get(job.payload.resignation_id,job.tenant_id);
  if(!r||!OPEN.includes(r.status))return {outcome:'settled'};
  const hold=(text,next)=>{
    db.prepare('UPDATE resignations SET hold_note=?,version=version+1,updated_at=? WHERE id=?').run(text,now(),r.id);
    scheduleClock(db,user,r,next);return {outcome:'held',until:next,reason:text};
  };
  const rule=acceptedRule(db,r.tenant_id,'resignation',today);
  if(!rule)return hold('ساعة القبول الحكمي متوقفة: قاعدة الاستقالة لم يقبلها مدير الموارد البشرية بعد',addDays(today,1));
  const due=deemedOn(r,rule.parameters);
  if(today<due)return hold('',due);
  const open=openInvestigationsFor(db,r.tenant_id,r.user_id);
  if(rule.parameters.block_during_investigation&&open.length)return hold('بلغت مدة القبول الحكمي ولم تُقبل: تحقيق أو إيقاف مفتوح حتى يُبت فيه (م37/5)',addDays(today,1));
  db.prepare("UPDATE resignations SET status='deemed_accepted',accepted_on=?,policy_id=?,hold_note='',version=version+1,updated_at=? WHERE id=?").run(due,rule.id,now(),r.id);
  audit(db,user,'resignation',r.id,'resignation.deemed_accepted',{status:r.status},{status:'deemed_accepted',accepted_on:due,by:'job-worker',article:'م34/1'});
  // صاحبها يُخبَر، ومن كان ينتظر القرار يُخبَر ليحدد آخر يوم عمل. المهمة لا تقرر، فالإشعار يقول ما حدث فقط.
  resignationNotice(db,user,'deemed_accepted',db.prepare('SELECT * FROM resignations WHERE id=?').get(r.id),{deemed_on:due,capability:rule.parameters.authority_capability});
  const bundle=openOffboarding(db,user,db.prepare('SELECT * FROM resignations WHERE id=?').get(r.id),'قبول حكمي بمضي المدة (م34/1)');
  // D-12: القبول الحكمي يفتح الحزمة بلا فاعل بشري، فنتيجته تصل من يملك فتحها في الحالتين.
  const latest=db.prepare('SELECT * FROM resignations WHERE id=?').get(r.id);
  offboardingNotice(db,user,latest,{bundle_id:bundle,note:latest.offboarding_note});
  return {outcome:'deemed_accepted',accepted_on:due,offboarding_bundle_id:bundle,offboarding_opened:!!bundle,
    ...(bundle?{}:{offboarding_blocked:true,offboarding_note:latest.offboarding_note})};
}
// التسجيل آمن عند تكراره، ويُعاد بعد مسح المعالجات في الاختبارات.
export function ensureJobHandlers(){
  try{registerHandler(JOB_TYPE,deemedAcceptanceHandler,{sensitive:true,authorise:(db,job)=>!!db.prepare('SELECT 1 FROM resignations WHERE id=? AND tenant_id=?').get(job.payload?.resignation_id??JSON.parse(job.payload).resignation_id,job.tenant_id)});}
  catch(error){if(!/already registered/.test(error.message))throw error;}
}
ensureJobHandlers();
