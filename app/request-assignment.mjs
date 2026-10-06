import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { can } from './access.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { getRequest, serviceOf, handlingDepartmentId, executionChain, isDepartmentHead, notifyUser, departmentName } from './workflow.mjs';
import { escalateStepsOf } from './step-escalation.mjs';
import { deliverSubject } from './notice-recipients.mjs';
import { holidaySet, workingDaysBetween, riyadhDate } from './work-calendar.mjs';
import { isolated } from './workflow-timers.mjs';

// إسناد التنفيذ لا يعلق عند من غاب (الموجة 2، العطب 8). كان الطلب «قيد التنفيذ» عند موظف غادر أو طال غيابه نهائيًا: لا يُلغى
// إسناده ولا يُعاد ولا يتجاوزه أحد، ولا يسمع به مدير ولا أدمن — وcomplete يشترط assigned_to===أنا. أربع حركات، كل واحدة صف في
// request_assignment_events بسببها المكتوب، وسطر تدقيق، وإشعار لمن يعنيه:
//   releaseRequest      المنفّذ نفسه يعيد الطلب إلى طابور إدارته
//   reassignRequest     مدير الإدارة المنفذة (كما يعرفه محرك الطلبات) يسنده إلى منفّذ آخر
//   overrideAssignment  من يدير الهيكل والتصعيد، بسبب مكتوب، حين لا يبقى في الإدارة من يملك الحركة — بلا قراءة الطلب
//   returnDepartedWork  إيقاف الحساب يعيد عمله الجاري إلى طابور إدارته في المعاملة نفسها، ويُخبَر مدير الإدارة
// الهدف في الإسناد واحد من سلسلة التنفيذ (workflow.executionChain) لا غير: فصل المهام والمستفيد وصاحب الطلب مطبَّقة فيها،
// فلا يُفتح بإعادة الإسناد بابٌ أغلقته السلسلة.
const id=()=>randomUUID();
const writing=db=>{if(!db.isTransaction)fail(500,'transaction_required','يلزم تغيير إسناد الطلب داخل معاملة قاعدة بيانات');};
const nameOf=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??'':'';
const isActive=(db,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(userId);
const rawRequest=(db,tenantId,rid)=>typeof rid==='string'?db.prepare('SELECT * FROM requests WHERE id=? AND tenant_id=?').get(rid,tenantId)??null:null;
const event=(db,r,kind,from,to,reason,actorId,time)=>db.prepare('INSERT INTO request_assignment_events(id,tenant_id,request_id,kind,from_user_id,to_user_id,handling_department_id,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run(id(),r.tenant_id,r.id,kind,from,to,handlingDepartmentId(db,r),reason,actorId,time);
const toQueue=(db,r,time)=>db.prepare("UPDATE requests SET status='approved',assigned_to=NULL,version=version+1,updated_at=? WHERE id=? AND status='in_progress'").run(time,r.id);
const guarded=service=>!!service.approval_policy.confidential||!!service.approval_policy.closed_circle;

// من يُخبَر بأن طلبًا ينتظر في الطابور، بلا رمي أبدًا (workflow.handOverToExecutors يرفض حين تخلو السلسلة؛ هنا العمل عائد لا داخل،
// فلا يُرفض إيقاف حساب لأن إدارته بلا منفّذ آخر). إن خلت السلسلة، أو لم يبقَ فيها غير من قام بالفعل، وصل الخبر مدير الإدارة
// عبر سُلَّم المستلمين، فإن لم يوجد أحد سُجِّل «بلا مستلم» — ولا يسقط صامتًا.
export function announceToExecutors(db,r,actorId,why){
  const service=serviceOf(db,r),department=handlingDepartmentId(db,r),chain=executionChain(db,service,{...r,status:'approved',assigned_to:null},department);
  const told=(chain.told??chain.people.map(p=>p.id)).filter(p=>p!==actorId);
  for(const person of told)notifyUser(db,person,r.id,'execution_released',{why});
  if(told.length)return {told:told.length,basis:chain.basis};
  const sent=deliverSubject(db,{tenantId:r.tenant_id,departmentId:department,actorId,kind:'queue_without_executor',subjectKind:'department_work',subjectId:r.id,
    title:`طلب عاد إلى طابور «${departmentName(db,r.tenant_id,department)}» ولا منفّذ يستلمه — ${service.code}`,
    body:`${why}. ${chain.basis==='none'?'لا أحد يملك تنفيذه الآن: سمِّ نائبًا منفّذًا للخدمة من «إعداد الاعتماد».':'لم يبقَ في سلسلة تنفيذه غير من أعاده.'}`});
  return {told:0,basis:chain.basis,head:sent};
}

export function releaseRequest(db,supplied,rid,input){
  writing(db);const u=actorOrRefuse(db,supplied);v.object(input,['version','reason']);
  const r=getRequest(db,u,rid);v.version(input.version,r.version);
  if(r.status!=='in_progress'||r.assigned_to!==u.id)refuse(409,'not_your_work',{what:'إعادة الطلب إلى الطابور لمن يباشر تنفيذه الآن وحده',
    missing:[{document:'إسناد هذا الطلب إليك وهو «قيد التنفيذ»',owner:nameOf(db,r.assigned_to)||'الإدارة المنفذة'}],next:'إن كان عند غيرك فاطلب من مدير الإدارة المنفذة إعادة إسناده'});
  const reason=v.text(input.reason,'سبب إعادة الطلب إلى الطابور',1000,10),time=now();
  event(db,r,'released',u.id,null,reason,u.id,time);toQueue(db,r,time);
  const announced=announceToExecutors(db,r,u.id,`أعاده منفّذه «${u.name}» إلى الطابور`);
  notifyUser(db,r.requester_id,r.id,'execution_holder_changed',{why:'أعاد المنفّذ الطلب إلى طابور إدارته المنفذة ليستلمه غيره'});
  audit(db,u,'request',r.id,'request.released',{status:'in_progress',assigned_to:u.id},{status:'approved',assigned_to:null,told:announced.told,execution_basis:announced.basis},reason);
  return getRequest(db,u,rid);
}

// الهدف الصالح: من سلسلة تنفيذ الطلب، وليس من هو عنده الآن. السلسلة تُحسب والطلب كأنه في الطابور، فتعطي من يحق له استلامه.
function chainTargets(db,r){
  const service=serviceOf(db,r);
  return executionChain(db,service,{...r,status:'approved',assigned_to:null},handlingDepartmentId(db,r)).people.filter(p=>p.id!==r.assigned_to&&isActive(db,p.id));
}
const notATarget=()=>refuse(409,'not_an_executor',{what:'لا يُسند الطلب إلى هذا الحساب',
  missing:[{document:'اسم من سلسلة تنفيذ الطلب',why:'فصل المهام والمستفيد وصاحب الطلب مطبَّقة في السلسلة، وإعادة الإسناد لا تتجاوزها',owner:'مدير الإدارة المنفذة',owner_role:'manager'}],
  next:'اختر اسمًا من القائمة المعروضة مع الطلب، أو أعده إلى الطابور ليستلمه أحد منفذيه'});

export function reassignRequest(db,supplied,rid,input){
  writing(db);const u=actorOrRefuse(db,supplied);v.object(input,['version','to_user_id','reason']);
  const r=rawRequest(db,u.tenant_id,rid);
  // مدير الإدارة قد لا يكون منفّذًا للخدمة فلا يفتح الطلب (workflow.visible)؛ يعيد إسناده من لوحة إدارته ببياناته الوصفية.
  if(!r||u.role!=='manager'||!isDepartmentHead(db,u,handlingDepartmentId(db,r)))refuse(404,'not_found',{what:'الطلب غير متاح لإعادة الإسناد من حسابك',
    missing:[{document:'صفة مدير الإدارة المنفذة لهذا الطلب',owner:'من يدير الهيكل والتصعيد',owner_role:'structure.manage'}],next:'إعادة الإسناد لمدير الإدارة المنفذة؛ وإن غاب فلمن يدير الهيكل بتجاوز مسجَّل'});
  v.version(input.version,r.version);
  if(r.status!=='in_progress'||!r.assigned_to)refuse(409,'not_in_progress',{what:'إعادة الإسناد لطلب «قيد التنفيذ» عند منفّذ',next:'الطلب في الطابور يستلمه أحد منفذيه مباشرة'});
  const target=chainTargets(db,r).find(p=>p.id===input.to_user_id);if(!target)notATarget();
  const reason=v.text(input.reason,'سبب إعادة الإسناد',1000,10),time=now(),previous=r.assigned_to;
  event(db,r,'reassigned',previous,target.id,reason,u.id,time);
  db.prepare("UPDATE requests SET assigned_to=?,version=version+1,updated_at=? WHERE id=? AND status='in_progress'").run(target.id,time,r.id);
  notifyUser(db,target.id,r.id,'execution_reassigned',{why:`أسنده إليك مدير الإدارة المنفذة «${u.name}»`});
  if(isActive(db,previous))notifyUser(db,previous,r.id,'execution_moved_away',{why:`أسنده مدير الإدارة المنفذة إلى «${target.name}»`});
  audit(db,u,'request',r.id,'request.reassigned',{assigned_to:previous},{assigned_to:target.id,to_user_id:target.id,status:'in_progress'},reason);
  return departmentHeldWork(db,u);
}

// تجاوز مسجَّل: لمن يدير الهيكل والتصعيد (والأدمن الأول بحكمه). يقرأ الصف مباشرة ولا يفتح الطلب: الأدمن لا يرى طلبات الأعمال.
export function overrideAssignment(db,supplied,rid,input){
  writing(db);const u=actorOrRefuse(db,supplied);v.object(input,['to_user_id','reason']);
  if(!can(db,u,'structure.manage'))refuse(403,'not_permitted',{what:'تجاوز إسناد طلب ليس لحسابك',
    missing:[{document:'تصريح الإدارات والهيكل والتصعيد',why:'التجاوز يغيّر من يحمل عملًا قائمًا بلا مدير إدارته',owner:'مسؤول الصلاحيات',owner_role:'admin'}],next:'اطلب من مدير الإدارة المنفذة إعادة الإسناد، أو ممن يدير الهيكل تجاوزًا بسبب مكتوب'});
  const r=rawRequest(db,u.tenant_id,rid);
  if(!r||r.status!=='in_progress'||!r.assigned_to)refuse(409,'not_in_progress',{what:'التجاوز لطلب «قيد التنفيذ» عند منفّذ',next:'حدّث القائمة: الطلب أُغلق أو عاد إلى الطابور'});
  const reason=v.text(input.reason,'سبب التجاوز',1000,10),time=now(),previous=r.assigned_to;
  const wanted=input.to_user_id===undefined||input.to_user_id===null||input.to_user_id===''?null:input.to_user_id;
  const target=wanted?chainTargets(db,r).find(p=>p.id===wanted):null;if(wanted&&!target)notATarget();
  event(db,r,'admin_override',previous,target?.id??null,reason,u.id,time);
  let announced=null;
  if(target){
    db.prepare("UPDATE requests SET assigned_to=?,version=version+1,updated_at=? WHERE id=? AND status='in_progress'").run(target.id,time,r.id);
    notifyUser(db,target.id,r.id,'execution_reassigned',{why:'أسنده إليك من يدير الهيكل والتصعيد بتجاوز مسجَّل بسببه'});
  }else{toQueue(db,r,time);announced=announceToExecutors(db,r,u.id,'أعاده من يدير الهيكل والتصعيد إلى الطابور بتجاوز مسجَّل بسببه');}
  if(isActive(db,previous))notifyUser(db,previous,r.id,'execution_moved_away',{why:'نُقل بتجاوز مسجَّل ممن يدير الهيكل والتصعيد'});
  audit(db,u,'request',r.id,'request.assignment_overridden',{status:'in_progress',assigned_to:previous},{status:target?'in_progress':'approved',assigned_to:target?.id??null,to_user_id:target?.id??null,told:announced?.told??null},reason);
  return heldWorkBoard(db,u);
}

// حساب أُوقف: كل ما يباشره يعود إلى طابور إدارته، في معاملة الإيقاف نفسها. actor: من أوقفه (فارغ حين يكتشفه التشغيل اليومي)،
// auditor: من يُسجَّل باسمه سطر التدقيق (الفاعل، أو صاحب مهمة التشغيل). ومهامه المفتوحة يُخبَر بها مسندوها، وخطواته المعلقة يُنقل قرارها.
export function returnDepartedWork(db,{userId,actor=null,auditor}){
  writing(db);
  const person=db.prepare('SELECT * FROM users WHERE id=?').get(userId);if(!person)return {returned:0,tasks:0,steps:{escalated:0,blocked:0}};
  const time=now(),by=actor?'user':'workflow-sweep',out={returned:0,tasks:0,steps:{escalated:0,blocked:0}};
  for(const r of db.prepare("SELECT * FROM requests WHERE tenant_id=? AND status='in_progress' AND assigned_to=? ORDER BY created_at,id").all(person.tenant_id,userId)){
    const reason=`أُوقف حساب المنفّذ «${person.name}»؛ عاد الطلب إلى طابور إدارته المنفذة`,department=handlingDepartmentId(db,r),service=serviceOf(db,r);
    event(db,r,'departure',userId,null,reason,actor?.id??null,time);toQueue(db,r,time);
    const announced=announceToExecutors(db,r,actor?.id??null,`أُوقف حساب منفّذه «${person.name}»`);
    // مدير الإدارة يُخبَر دائمًا، ولو أُبلغ المنفذون: هو من يعرف ما كان جاريًا وإلى من يُسند. لا عنوان لخدمة سرية.
    deliverSubject(db,{tenantId:r.tenant_id,departmentId:department,actorId:actor?.id??null,aboutUserId:userId,kind:'executor_departed',subjectKind:'department_work',subjectId:r.id,
      title:`عاد طلب إلى طابور إدارتك: أُوقف حساب منفّذه — ${service.code}`,
      body:`كان «قيد التنفيذ» عند «${person.name}»${guarded(service)?'':`: «${r.title}»`}. عاد إلى الطابور ليستلمه أحد منفذيه؛ يظهر في «عمل إدارتي المفتوح» في الرئيسية.`});
    if(isActive(db,r.requester_id))notifyUser(db,r.requester_id,r.id,'execution_holder_changed',{why:'تغيّر من ينفّذ طلبك وعاد إلى طابور إدارته المنفذة ليستلمه غيره'});
    audit(db,auditor,'request',r.id,'request.executor_departed',{status:'in_progress',assigned_to:userId},{status:'approved',assigned_to:null,told:announced.told,execution_basis:announced.basis,by},reason);
    out.returned++;
  }
  // مهمة داخل طلب لا يكملها إلا من أُسندت إليه (routing.settleRequestTask)، ومن أسندها يملك إلغاءها: يُخبَر ليعيد إسنادها.
  for(const task of db.prepare("SELECT t.*,r.tenant_id AS rt FROM request_tasks t JOIN requests r ON r.id=t.request_id WHERE t.assignee_id=? AND t.status='open'").all(userId)){
    if(task.created_by!==userId&&isActive(db,task.created_by))notifyUser(db,task.created_by,task.request_id,'task_holder_departed',{task:task.title,name:person.name});
    out.tasks++;
  }
  out.steps=escalateStepsOf(db,person.tenant_id,userId,auditor,actor);
  return out;
}
// شبكة أمان التشغيل اليومي: حساب أُوقف من طريق لا يمر بالدالة أعلاه (SQL مباشر، أو تغيير وظيفي طُبّق كسولًا) وما زال يحمل عملًا.
export function sweepDepartedWork(db,tenantId,auditor){
  const out={accounts:0,returned:0,tasks_flagged:0},failures=[];
  for(const {assigned_to} of db.prepare("SELECT DISTINCT r.assigned_to FROM requests r JOIN users u ON u.id=r.assigned_to WHERE r.tenant_id=? AND r.status='in_progress' AND u.active=0").all(tenantId))isolated(db,failures,`account:${assigned_to}`,()=>{
    const done=returnDepartedWork(db,{userId:assigned_to,actor:null,auditor});out.accounts++;out.returned+=done.returned;out.tasks_flagged+=done.tasks;
  });
  if(failures.length)out.failures=failures;
  return out;
}

// ── ما يراه مدير الإدارة المنفذة: ما تنفّذه إدارته الآن، وعند من، ومنذ متى ─────────────────
// بيانات وصفية بلا حمولة (وبلا عنوان ولا اسم صاحب الطلب لخدمة سرية)، ومعها من يصح أن يُسند إليه. لا يوسّع visible().
// منذ متى يحمل هذا الشخصُ هذا الطلب: من آخر حركة غيّرت حاملَه فعلًا. إسناد مهمة داخل الطلب ليس منها — assignRequestTask
// تكتب assigned_to=COALESCE(assigned_to,?) فلا تنقل العمل من أحد إلى أحد — وكان إدخالها في هذه القائمة يعطي المنفّذَ
// الجالسَ على العمل زرًّا يصفّر عمره كلما أسند مهمة: عطب الموجة 1 نفسه («زر المتابعة يصفّر العمر») عائدًا على اللوحات
// التي بُنيت لكشف العمل الراكد. وطلبٌ صار «قيد التنفيذ» بإسناد مهمة وحده عمرُه من أول إسناد فيه لا من آخره.
const heldSince=(db,r)=>db.prepare("SELECT MAX(created_at) AS at FROM audit_events WHERE tenant_id=? AND entity_type='request' AND entity_id=? AND action IN ('claim','request.reassigned','request.assignment_overridden','request.reopened')").get(r.tenant_id,r.id)?.at
  ??db.prepare("SELECT MIN(created_at) AS at FROM audit_events WHERE tenant_id=? AND entity_type='request' AND entity_id=? AND action='request.task_assigned'").get(r.tenant_id,r.id)?.at
  ??r.updated_at;
// title: عنوان الطلب نصٌّ حرّ كتبه موظف، وقد يسمّي زميلًا أو يصف تظلّمًا. يُعرض لمدير الإدارة المنفذة — وهي التوسعة
// المعلنة في §3.4 من ملف التسليم — ولا يُعرض لمن يدير الهيكل: «الأدمن لا يرى طلبات الأعمال» كما يقول تعليق الوحدة
// نفسه، وgetRequest ترفض له الطلب نفسه بـ404. المرجع ورمز الخدمة يكفيان نموذج التجاوز.
function heldRow(db,r,actions,{holidays,title=true}){
  const service=serviceOf(db,r),since=heldSince(db,r),secret=guarded(service);
  return {id:r.id,version:r.version,reference:r.id.slice(0,8).toUpperCase(),service_code:service.code,service_name:service.name_ar,confidential:secret,title:title&&!secret?r.title:'',
    department_name:departmentName(db,r.tenant_id,handlingDepartmentId(db,r)),assignee_id:r.assigned_to,assignee_name:nameOf(db,r.assigned_to),assignee_active:isActive(db,r.assigned_to),
    held_since:since,held_working_days:workingDaysBetween(riyadhDate(since),riyadhDate(Date.now()),holidays),
    candidates:chainTargets(db,r).map(p=>({id:p.id,name:p.name})),actions};
}
export function departmentHeldWork(db,supplied){
  const u=actorOrRefuse(db,supplied);
  if(u.role!=='manager'||!isDepartmentHead(db,u,u.department_id))return [];
  const holidays=holidaySet(db,u.tenant_id);
  return db.prepare("SELECT * FROM requests WHERE tenant_id=? AND status='in_progress' AND assigned_to IS NOT NULL ORDER BY updated_at,id").all(u.tenant_id)
    .filter(r=>handlingDepartmentId(db,r)===u.department_id).map(r=>heldRow(db,r,['reassign_request'],{holidays}));
}
// ما يراه من يدير الهيكل: العمل الجاري عند حساب موقوف فقط — الحالة التي لا يملك أحد في الإدارة حركتها. غير ذلك شأن مدير الإدارة.
export function heldWorkBoard(db,supplied){
  const u=actorOrRefuse(db,supplied);
  if(!can(db,u,'structure.manage'))return {visible:false,rows:[],note:''};
  const holidays=holidaySet(db,u.tenant_id);
  const rows=db.prepare("SELECT r.* FROM requests r JOIN users x ON x.id=r.assigned_to WHERE r.tenant_id=? AND r.status='in_progress' AND x.active=0 ORDER BY r.updated_at,r.id").all(u.tenant_id).map(r=>heldRow(db,r,['override_assignment'],{holidays,title:false}));
  return {visible:true,rows,note:'طلبات «قيد التنفيذ» عند حساب موقوف. إيقاف الحساب من المنصة يعيدها إلى الطابور في لحظته، والتشغيل اليومي يلتقط ما فاته؛ ما يظهر هنا ينتظر أحدهما أو تجاوزك المسجَّل بسببه.'};
}
