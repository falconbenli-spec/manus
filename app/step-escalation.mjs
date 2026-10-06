import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { can } from './access.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { serviceOf, beneficiaryOf, stepBasis, normalizeStep, escalationLadder, escalationOf, deciderOf, stepArrivedAt, currentPendingSteps,
  departmentName, notifyUser, ESCALATION_BASIS } from './workflow.mjs';
import { holidaySet, workingDaysBetween, riyadhDate } from './work-calendar.mjs';
import { adoptedTimerRows, NOT_ADOPTED, isolated, clockStart } from './workflow-timers.mjs';
import { notifySubject } from './notices.mjs';

// التصعيد الحقيقي (الموجة 2، العطب 6): ينقل القرار لا ينبّه المتأخر. كان «التصعيد» يشعر المعتمد المتأخر نفسه بنص «تأخر المعتمد
// السابق» ويسجّل authority_changed:false. هنا يُكتب صف في approval_step_escalations (معتمد الخطوة لا يُعدَّل)، فيقرؤه
// workflow.authorizedStep: القرار يصير لمن وصله وحده. ثلاثة أسباب تكتب صفًا:
//   timeout         التشغيل اليومي، ولا يكون إلا بمهلة «تصعيد خطوة الاعتماد» متبناة، وصفها يُسجَّل في الصف والتدقيق
//   unqualified     صاحب القرار أُوقف حسابه: خطوته كانت تبقى بلا من يقررها إلى الأبد
//   admin_override  من يدير الهيكل والتصعيد، بسبب مكتوب، وإلى درجة يسمّيها من السُلَّم المسجل
// إلى أين؟ إلى سُلَّم تصعيد إدارة الخطوة كما هو مسجل في department_escalation (workflow.escalationLadder): لا يُسمّى إنسان جديد.
// يُتخطى صاحب الطلب، والمستفيد، وصاحب القرار الحالي وكل من مرّ به، ومن يحمل خطوة أخرى في النسخة أو قررها (حتى لا يُحسب
// القرار الواحد اعتمادين — قاعدة B4). الخدمة السرية وخدمة الدائرة المغلقة لا تصعد آليًا أبدًا: مرجع التصعيد مرجع في كل شيء
// وقد يكون موضوع البلاغ؛ يُسجَّل التعذر ويُبلَّغ من يدير الهيكل ليسمّي صاحب قرار بيده وبسببه.
const id=()=>randomUUID();
const rawRequest=(db,tenantId,rid)=>db.prepare('SELECT * FROM requests WHERE id=? AND tenant_id=?').get(rid,tenantId)??null;
const nameOf=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??'':'';
const isActive=(db,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(userId);
const guarded=service=>!!service.approval_policy.confidential||!!service.approval_policy.closed_circle;

// إدارة الخطوة: من سند إسنادها (approval_step_basis)، وإلا إدارة الخطوة في السياسة، وللمدير المباشر إدارة صاحب الطلب.
function stepDepartment(db,r,step,service){
  const basis=stepBasis(db,step.id);if(basis?.department_id)return basis.department_id;
  const expected=normalizeStep(service.approval_policy.steps[step.position]);
  if(expected?.role==='manager')return db.prepare('SELECT department_id FROM users WHERE id=?').get(r.requester_id)?.department_id??service.department_id;
  return expected?.department??service.department_id;
}
// الدرجات الصالحة لاستلام القرار الآن، بالترتيب. كل درجة علاقة مسجلة أصلًا؛ المحرك لا يخترع اسمًا.
// actor: من يطلب النقل بيده. يُمنع من درجاته: نقل القرار قرارٌ، وكل قاعدة هويتين في المنصة (اقتراح المهلة وتبنيها،
// تسمية النائب وقبوله، المُعِدّ ليس المستلم) تُنفَّذ عند الكتابة لا بعدها في التدقيق. المسار الآلي يمرر actor=null فلا يتغير.
export function escalationCandidates(db,r,step,service=serviceOf(db,r),actor=null){
  const department=stepDepartment(db,r,step,service),beneficiary=beneficiaryOf(db,r);
  const barred=new Set([r.requester_id,beneficiary,step.approver_id,deciderOf(db,step),actor?.id].filter(Boolean));
  for(const hop of db.prepare('SELECT from_user_id,to_user_id FROM approval_step_escalations WHERE step_id=?').all(step.id)){barred.add(hop.from_user_id);barred.add(hop.to_user_id);}
  for(const other of db.prepare('SELECT * FROM approval_steps WHERE request_id=? AND revision=? AND id<>?').all(r.id,r.revision,step.id)){
    barred.add(other.approver_id);if(other.decided_by)barred.add(other.decided_by);barred.add(deciderOf(db,other));
  }
  const rungs=escalationLadder(db,r.tenant_id,department).filter(p=>!barred.has(p.id)&&db.prepare("SELECT 1 FROM users WHERE id=? AND active=1 AND role='manager'").get(p.id));
  return {department_id:department,department_name:departmentName(db,r.tenant_id,department),rungs};
}
const rungTitle=(rung,department)=>rung.depth===0?`مرجع تصعيد «${department}» المسجل`:`الدرجة ${rung.depth+1} في سُلَّم تصعيد «${department}»`;
// العطل تُقرأ مرة لكل جولة لا مرة لكل خطوة: قراءة الجدول كاملًا داخل حلقة تقيس مئات الخطوات مسحٌ كامل لكل صف.
const waitedFrom=(arrived,holidays)=>workingDaysBetween(riyadhDate(arrived),riyadhDate(Date.now()),holidays);
const waitedDays=(db,r,step,holidays=holidaySet(db,r.tenant_id))=>waitedFrom(stepArrivedAt(db,r,step),holidays);
// المعدود للمهلة: من وصول الخطوة أو تبني المهلة أيهما لاحق (الساعة تبدأ من التبني)؛ waitedDays العمر الحقيقي، يُقال في الرسائل.
const countedDays=(db,r,step,timer,holidays)=>waitedFrom(clockStart(stepArrivedAt(db,r,step),timer),holidays);

// تعذّر النقل لا يمر صامتًا: سطر تدقيق على الطلب، وإشعار لمن يدير الهيكل والتصعيد — مرة لكل (خطوة، درجة) بمفتاح في reminder_log.
function recordBlocked(db,r,step,auditor,{basis,why,level,by}){
  if(db.prepare('INSERT INTO reminder_log(tenant_id,reminder_key,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(r.tenant_id,`escalation-blocked:${step.id}:${level}`,now()).changes!==1)return false;
  audit(db,auditor,'request',r.id,'approval.escalation_blocked',{step_id:step.id,decider_id:deciderOf(db,step)},{step_id:step.id,basis,level,authority_changed:false,by},why);
  const service=serviceOf(db,r);
  for(const person of db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role='admin' ORDER BY id").all(r.tenant_id).filter(x=>can(db,x,'structure.manage')))
    notifySubject(db,{userId:person.id,kind:'escalation_blocked',subjectKind:'workflow_gap',subjectId:step.id,title:`خطوة اعتماد متأخرة لا درجة أعلى تستلم قرارها — ${service.code}`,
      body:`${why}. افتح «إعداد الاعتماد» ← «خطوات تنتظر من يسمّي صاحب قرارها» لنقل القرار بسبب مكتوب، أو سجّل مرجع تصعيد للإدارة.`});
  return true;
}

// ينقل قرار الخطوة. target=null وحدها تعني «اختر لي الدرجة التالية آليًا»؛ أي قيمة أخرى اسمٌ يجب أن يصلح درجة،
// فهدفٌ مُرسَل فارغ أو غير نصّي يُرفض ولا ينقلب صامتًا إلى اختيار المحرك باسم إنسان لم يسمِّ أحدًا.
// auditor: من يُسجَّل باسمه سطر التدقيق (الفاعل، أو صاحب مهمة التشغيل اليومي).
// يعيد {escalated:true,to_user_id,level} أو {escalated:false,blocked:'guarded'|'no_rung'|'not_a_rung',why}. لا يرمي عند التعذر: يسجّله.
export function escalateStep(db,{r,step,basis,reason,actor=null,auditor,timer=null,target=null}){
  if(!db.isTransaction)fail(500,'transaction_required','يلزم نقل القرار داخل معاملة قاعدة بيانات');
  const service=serviceOf(db,r),moved=escalationOf(db,step.id),holder=moved?.to_user_id??step.approver_id,level=(moved?.level??0)+1,by=actor?'user':'workflow-sweep';
  const {department_name:department,rungs}=escalationCandidates(db,r,step,service,actor);
  let rung=null;
  if(target!==null){rung=rungs.find(p=>p.id===target)??null;if(!rung)return {escalated:false,blocked:'not_a_rung',why:'المسمّى ليس درجة صالحة في سُلَّم تصعيد إدارة الخطوة'};}
  else if(guarded(service)){
    const why=`خطوة في خدمة ${service.code} السرية ${basis==='timeout'?'بلغت مهلة التصعيد':'فقد صاحب قرارها صفته'}؛ الخدمة السرية لا يصعد قرارها آليًا في سُلَّم الإدارة، ويلزم أن يسمّي من يدير الهيكل صاحب قرارها`;
    recordBlocked(db,r,step,auditor,{basis,why,level,by});return {escalated:false,blocked:'guarded',why};
  }else rung=rungs[0]??null;
  if(!rung||level>8){
    const why=`خطوة اعتماد في «${department}» ${basis==='timeout'?'بلغت مهلة التصعيد':'فقد صاحب قرارها صفته'} ولا درجة أعلى تصلح: كل درجات السُلَّم طرف في الطلب أو غير مسجلة`;
    recordBlocked(db,r,step,auditor,{basis,why,level,by});return {escalated:false,blocked:'no_rung',why};
  }
  const waited=waitedDays(db,r,step),time=now(),rowId=id();
  db.prepare('INSERT INTO approval_step_escalations(id,step_id,level,tenant_id,request_id,from_user_id,to_user_id,basis,reason,timer_row_id,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(rowId,step.id,level,r.tenant_id,r.id,holder,rung.id,basis,reason,timer?.id??null,actor?.id??null,time);
  db.prepare('UPDATE requests SET version=version+1,updated_at=? WHERE id=?').run(time,r.id);
  // إشعاران صادقان: لمن وصله القرار لماذا وصله، ولمن نُقل عنه أنه انتقل. المتأخر لا يُقال له «تأخر المعتمد السابق».
  const why=ESCALATION_BASIS[basis]??basis;
  notifyUser(db,rung.id,r.id,'approval_moved_to_you',{why,from_name:nameOf(db,holder),waited,rung:rungTitle(rung,department)});
  if(isActive(db,holder))notifyUser(db,holder,r.id,'approval_moved_away',{why,to_name:rung.name});
  audit(db,auditor,'request',r.id,'approval.escalated',{step_id:step.id,decider_id:holder},
    {step_id:step.id,escalation_id:rowId,level,from_user_id:holder,to_user_id:rung.id,basis,authority_changed:true,waited_working_days:waited,timer_row_id:timer?.id??null,timer_value:timer?.value??null,by},reason);
  return {escalated:true,to_user_id:rung.id,level,escalation_id:rowId};
}

// ── ما يفعله التشغيل اليومي ────────────────────────────────────────────────────
// (1) صاحب قرار أُوقف حسابه: تُنقل خطوته دائمًا — هذه حقيقة لا مهلة. (2) خطوة بلغت مهلة التصعيد المتبناة: تُنقل. بلا مهلة متبناة لا شيء.
// العمر من stepArrivedAt وحدها (وصول الخطوة إلى صاحب قرارها الحالي)، بأيام العمل، ولا يُقرأ requests.updated_at أبدًا.
export function sweepApprovals(db,tenantId,auditor,timers=adoptedTimerRows(db,tenantId)){
  const timer=timers.approval_escalation??null,out={timeout:{escalated:0,blocked:0},unqualified:{escalated:0,blocked:0}},failures=[];
  const holidays=holidaySet(db,tenantId);
  if(!timer)out.timeout.note=NOT_ADOPTED;
  for(const r of db.prepare("SELECT * FROM requests WHERE tenant_id=? AND status='pending' ORDER BY created_at,id").all(tenantId)){
    // الخطوات المعلقة كلها في النسخة الحالية لمن غاب (حتى لا تصل خطوة لاحقة إلى حساب موقوف)، والسارية وحدها لانقضاء المهلة.
    const current=new Set(currentPendingSteps(db,r).map(s=>s.id));
    for(const step of db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' ORDER BY position").all(r.id,r.revision))isolated(db,failures,`step:${step.id}`,()=>{
      const holder=deciderOf(db,step);
      if(!isActive(db,holder)){
        const done=escalateStep(db,{r,step,basis:'unqualified',reason:`حساب صاحب القرار «${nameOf(db,holder)}» موقوف؛ الخطوة لا يقررها أحد ما لم يُنقل قرارها`,auditor});
        out.unqualified[done.escalated?'escalated':'blocked']++;return;
      }
      if(!timer||!current.has(step.id))return;
      const waited=waitedDays(db,r,step,holidays),counted=countedDays(db,r,step,timer,holidays);if(counted<timer.value)return;
      const done=escalateStep(db,{r,step,basis:'timeout',timer,reason:`انتظرت الخطوة ${waited} يوم عمل عند «${nameOf(db,holder)}»${counted!==waited?` (المعدود من تبني المهلة ${counted})`:''}، ومهلة التصعيد المعتمدة ${timer.value} يوم عمل`,auditor});
      out.timeout[done.escalated?'escalated':'blocked']++;
    });
  }
  if(failures.length)out.failures=failures;
  return out;
}
// حساب أُوقف: خطواته المعلقة تُنقل في معاملة الإيقاف نفسها. يستدعيها request-assignment.returnDepartedWork.
export function escalateStepsOf(db,tenantId,userId,auditor,actor=null){
  const out={escalated:0,blocked:0};
  for(const step of db.prepare("SELECT s.* FROM approval_steps s JOIN requests r ON r.id=s.request_id WHERE r.tenant_id=? AND r.status='pending' AND s.revision=r.revision AND s.status='pending' ORDER BY s.request_id,s.position").all(tenantId)){
    if(deciderOf(db,step)!==userId)continue;
    const r=rawRequest(db,tenantId,step.request_id);
    // السبب «unqualified» يكتبه النظام حتى حين يوقف إنسانٌ الحساب: الفاعل في الصف من أوقفه، والأساس فقدان الصفة.
    const done=escalateStep(db,{r,step,basis:'unqualified',reason:`أُوقف حساب صاحب القرار «${nameOf(db,userId)}»؛ نُقل قرار خطوته حتى لا يقف الطلب`,actor,auditor});
    out[done.escalated?'escalated':'blocked']++;
  }
  return out;
}

// ── ما يراه ويفعله من يدير الهيكل والتصعيد ──────────────────────────────────────
// خطوات تنتظر من يسمّي صاحب قرارها: صاحب قرارها موقوف ولا درجة آلية، أو بلغت المهلة المتبناة وتعذر نقلها (سرية، أو لا درجة).
// بيانات وصفية فقط: رمز الخدمة والإدارة والدور ومن عنده القرار وكم انتظر. لا عنوان ولا حمولة ولا اسم صاحب الطلب
// — من يدير الهيكل لا يرى الطلبات، وصاحب بلاغ المخالفة لا يُكشف لمن يدير الهيكل.
export function stuckApprovals(db,supplied){
  const u=actorOrRefuse(db,supplied);
  if(!can(db,u,'structure.manage'))return {visible:false,rows:[],note:''};
  const timer=adoptedTimerRows(db,u.tenant_id).approval_escalation??null,rows=[],holidays=holidaySet(db,u.tenant_id);
  for(const r of db.prepare("SELECT * FROM requests WHERE tenant_id=? AND status='pending' ORDER BY created_at,id").all(u.tenant_id)){
    const service=serviceOf(db,r);
    for(const step of currentPendingSteps(db,r)){
      // العمر يُحسب بعد الحكم لا قبله: بلا مهلة متبناة لا يُقاس تأخر أصلًا، فلا سبب لقراءة وصول كل خطوة في المنصة.
      const holder=deciderOf(db,step),inactive=!isActive(db,holder);
      if(!inactive&&!timer)continue;
      const arrived=stepArrivedAt(db,r,step),waited=waitedFrom(arrived,holidays),late=!!timer&&waitedFrom(clockStart(arrived,timer),holidays)>=timer.value;
      if(!inactive&&!late)continue;
      const {department_name,rungs}=escalationCandidates(db,r,step,service,u);
      rows.push({step_id:step.id,reference:r.id.slice(0,8).toUpperCase(),service_code:service.code,service_name:service.name_ar,department_name,position:step.position+1,
        // arrived_at: لحظة وصول الخطوة إلى صاحب قرارها الحالي. الصندوق يشتق منها العمر كما يشتقه لكل بند آخر،
        // فلا يبقى الطابور الذي وُجد لأن شيئًا انتظر طويلًا هو البند الوحيد الذي لا يقول كم انتظر.
        arrived_at:arrived,decider_name:nameOf(db,holder),decider_active:!inactive,waited_working_days:waited,guarded:guarded(service),
        why:inactive?'حساب صاحب القرار موقوف':`بلغت مهلة التصعيد المعتمدة (${timer.value} يوم عمل)`,
        blocked:guarded(service)?'خدمة سرية: لا يصعد قرارها آليًا':rungs.length?'':'لا درجة أعلى تصلح في سُلَّم تصعيد الإدارة',
        candidates:rungs.map(p=>({id:p.id,name:p.name,title:rungTitle(p,department_name)})),actions:rungs.length?['override_escalation']:[]});
    }
  }
  return {visible:true,rows,timer_adopted:!!timer,
    note:timer?'خطوات صاحب قرارها موقوف، أو بلغت مهلة التصعيد المعتمدة وتعذّر نقلها آليًا. النقل اليدوي بسبب مكتوب وإلى درجة من السُلَّم المسجل.'
      :`مهلة «تصعيد خطوة الاعتماد»: ${NOT_ADOPTED}. لا تُعرض هنا إلا خطوات صاحب قرارها موقوف؛ التأخر وحده لا يُقاس بلا مهلة معتمدة.`};
}
export function overrideEscalation(db,supplied,stepId,input){
  if(!db.isTransaction)fail(500,'transaction_required','يلزم نقل القرار داخل معاملة قاعدة بيانات');
  const u=actorOrRefuse(db,supplied);v.object(input,['to_user_id','reason']);
  if(!can(db,u,'structure.manage'))refuse(403,'not_permitted',{what:'نقل قرار خطوة اعتماد يدويًا ليس لحسابك',
    missing:[{document:'تصريح الإدارات والهيكل والتصعيد',why:'نقل القرار تعديل على من يملك الصلاحية في طلب قائم',owner:'مسؤول الصلاحيات',owner_role:'admin'}],next:'اطلب ممن يدير الهيكل والتصعيد نقله بسبب مكتوب'});
  const step=typeof stepId==='string'?db.prepare('SELECT s.* FROM approval_steps s JOIN requests r ON r.id=s.request_id WHERE s.id=? AND r.tenant_id=?').get(stepId,u.tenant_id):null;
  const r=step?rawRequest(db,u.tenant_id,step.request_id):null;
  if(!step||!currentPendingSteps(db,r).some(s=>s.id===step.id))refuse(409,'step_not_waiting',{what:'هذه الخطوة لا تنتظر قرارًا الآن',next:'حدّث الصفحة: حُسمت الخطوة أو تغيّرت نسخة الطلب'});
  const reason=v.text(input.reason,'سبب نقل القرار',1000,10);
  // الهدف يُسمّى نصًّا: حقل غائب أو فارغ أو غير نصّي ليس «اختر لي»، بل طلبٌ ناقص يُرفض باسمه.
  const done=escalateStep(db,{r,step,basis:'admin_override',reason,actor:u,auditor:u,target:typeof input.to_user_id==='string'?input.to_user_id.trim():''});
  if(!done.escalated)refuse(409,'not_a_rung',{what:'لا يُنقل القرار إلى هذا الحساب',
    missing:[{document:'درجة صالحة في سُلَّم تصعيد إدارة الخطوة',why:'القرار لا يُنقل إلا إلى مرجع مسجل ليس طرفًا في الطلب',owner:'من يدير الهيكل والتصعيد',owner_role:'structure.manage'}],
    next:'اختر اسمًا من القائمة المعروضة مع الخطوة، أو سجّل مرجع تصعيد للإدارة أولًا'});
  return stuckApprovals(db,u);
}
