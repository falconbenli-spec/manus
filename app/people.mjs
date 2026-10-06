import { randomUUID } from 'node:crypto';
import { audit,now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { refuse } from './refusal.mjs';
import { personName, personAssignment, personContract, openContracts } from './people-read.mjs';
import { STATUS_NAMES as CONTRACT_STATUS_NAMES } from './hr-contracts.mjs';

const activeStages=['applied','screened','interviewing','evaluated','offer_pending','offer_approved'];
const dateInRiyadh=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export const peopleToday=()=>dateInRiyadh(new Date());
function actor(db,u) {
  const current=u&&db.prepare("SELECT id,tenant_id,department_id,role,active,name FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(u.id,u.tenant_id);
  if(!current) fail(403,'forbidden','مساحة التوظيف غير متاحة لهذا الحساب');
  return current;
}
function writing(db) { if(!db.isTransaction) fail(500,'transaction_required','تتطلب كتابة التوظيف معاملة قاعدة بيانات'); }
const policy=(db,tenant,id)=>db.prepare('SELECT * FROM people_policies WHERE id=? AND tenant_id=?').get(id,tenant);
const isHr=(u,p)=>u.role==='hr'&&u.tenant_id===p.tenant_id&&u.department_id===p.hr_department_id;
const isOwner=(u,r,p)=>u.id===r.manager_id&&u.role==='manager'&&u.tenant_id===r.tenant_id&&u.department_id===p.department_id;
const scope=(db,u,r)=>{const p=policy(db,r.tenant_id,r.policy_id);return p&&(isHr(u,p)||isOwner(u,r,p));};
function requisition(db,u,id) {
  const r=db.prepare('SELECT * FROM people_requisitions WHERE id=? AND tenant_id=?').get(id,u.tenant_id);
  if(!r||!scope(db,u,r)) fail(404,'not_found','طلب التوظيف غير موجود أو غير متاح');
  return r;
}
function candidate(db,u,id) {
  const c=db.prepare('SELECT * FROM people_candidates WHERE id=? AND tenant_id=?').get(id,u.tenant_id);
  if(!c) fail(404,'not_found','ملف المرشح غير موجود أو غير متاح');
  requisition(db,u,c.requisition_id);
  if(c.retention_until<peopleToday()) fail(403,'retention_due','انتهت مدة عرض بيانات المرشح؛ يلزم إجراء احتفاظ مخول');
  return c;
}
function currentManager(db,r,p) {
  const manager=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND department_id=? AND role='manager' AND active=1").get(r.manager_id,r.tenant_id,p.department_id);
  if(!manager) fail(409,'manager_unavailable','مدير الاحتياج لم يعد نشطًا في نطاقه');
  return manager;
}
function currentPolicy(p) {
  const today=peopleToday();
  if(!p||p.synthetic!==1||p.effective_from>today||p.effective_to<today) fail(409,'policy_unavailable','يلزم نطاق توظيف مصطنع سارٍ');
}
function futureDate(value,label) {const date=v.date(value);if(date<peopleToday())fail(400,'past_date',`${label}: التاريخ يسبق اليوم في الرياض`);return date;}
function criteria(value) {
  if(!Array.isArray(value)||value.length<2||value.length>8) fail(400,'criteria','يلزم معياران إلى ثمانية معايير مرتبطة بالوظيفة');
  const keys=new Set(),clean=value.map(item=>{
    v.object(item,['key','label','weight','acceptance']);
    if(typeof item.key!=='string'||!/^[a-z][a-z0-9_]{1,29}$/.test(item.key)||keys.has(item.key))fail(400,'criteria','رمز معيار غير صالح أو مكرر');
    keys.add(item.key);
    if(!Number.isInteger(item.weight)||item.weight<1||item.weight>99)fail(400,'criteria','وزن المعيار يجب أن يكون عددًا صحيحًا بين1 و99');
    return {key:item.key,label:v.text(item.label,'المعيار',150,3),weight:item.weight,acceptance:v.text(item.acceptance,'دليل القبول المتوقع',1000,3)};
  });
  if(clean.reduce((sum,item)=>sum+item.weight,0)!==100)fail(400,'criteria','يجب أن تساوي أوزان معايير المقابلة100');
  return clean;
}
function versionRecord(db,u,id,kind,revision,snapshot) {
  db.prepare('INSERT INTO people_versions VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,u.tenant_id,kind,revision,JSON.stringify(snapshot),now());
}
function event(db,u,r,c,action,from,to,entityVersion,evidence) {
  db.prepare('INSERT INTO people_events(id,tenant_id,requisition_id,candidate_id,actor_id,action,from_status,to_status,entity_version,evidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),u.tenant_id,r.id,c?.id??null,u.id,action,from,to,entityVersion,evidence,now());
  audit(db,u,c?'people_candidate':'people_requisition',c?.id??r.id,`people.${action}`,{status:from},{status:to,version:entityVersion,requisition_id:r.id});
}
function reqActions(db,u,r) {
  const p=policy(db,r.tenant_id,r.policy_id),hr=isHr(u,p),owner=isOwner(u,r,p);
  if(r.status==='pending_need')return [...(hr&&u.id!==r.manager_id?['approve_need','reject_need']:[]),...(owner?['cancel_need']:[])];
  if(r.status==='open')return hr?['add_candidate']:[];
  return [];
}
function candidateActions(db,u,r,c) {
  const p=policy(db,r.tenant_id,r.policy_id),hr=isHr(u,p),owner=isOwner(u,r,p),actions=[];
  if(hr&&activeStages.includes(c.status))actions.push('reject_candidate');
  if(r.status==='open') {
    if(hr&&c.status==='applied')actions.push('screen');
    if(hr&&c.status==='screened')actions.push('schedule_interview');
    if(c.status==='interviewing'&&(owner||hr&&c.reviewer_hr_id===u.id)&&!db.prepare('SELECT 1 FROM people_evaluations WHERE candidate_id=? AND evaluator_id=?').get(c.id,u.id))actions.push('evaluate');
    if(hr&&['evaluated','offer_pending','offer_approved'].includes(c.status))actions.push('propose_offer');
    if(owner&&c.status==='offer_pending')actions.push('approve_offer','reject_offer');
    if(hr&&c.status==='offer_approved')actions.push('accept_offer');
  }
  if(hr&&c.status==='accepted')actions.push('start_onboarding');
  if(hr&&c.status==='onboarding')actions.push('complete_onboarding');
  // رابط التوظيف (الترحيل 172): بعد القبول يُربط المرشح بحسابه ثم بعقده، كلٌّ مرة واحدة.
  if(hr&&HIRED.includes(c.status)&&!hireOf(db,c.id)?.contract_id)actions.push('link_hire');
  return actions;
}
const HIRED=['accepted','onboarding','completed'];
const hireOf=(db,candidateId)=>db.prepare('SELECT * FROM employee_hires WHERE candidate_id=?').get(candidateId)??null;
const hireView=(db,h)=>h?{user_id:h.user_id,user_name:personName(db,h.user_id),contract_id:h.contract_id,linked_by_name:personName(db,h.linked_by),linked_at:h.linked_at,contract_linked_at:h.contract_linked_at}:null;
function taskDetail(db,u,id) {
  const task=db.prepare('SELECT * FROM people_onboarding_tasks WHERE id=? AND tenant_id=?').get(id,u.tenant_id);
  if(!task)fail(404,'not_found','عنصر التهيئة غير متاح');
  let full=false;
  const c=db.prepare('SELECT requisition_id,retention_until FROM people_candidates WHERE id=?').get(task.candidate_id);
  const r=db.prepare('SELECT * FROM people_requisitions WHERE id=?').get(c.requisition_id);
  full=scope(db,u,r)&&c.retention_until>=peopleToday();
  if(!full&&task.owner_id!==u.id)fail(404,'not_found','عنصر التهيئة غير متاح');
  const {candidate_id,...safe}=task;
  return {...safe,...(full?{candidate_id}:{}),can_complete:task.owner_id===u.id&&task.status==='open',owner_name:db.prepare('SELECT name FROM users WHERE id=?').get(task.owner_id).name};
}
export function getPeopleRecord(db,user,id) {
  const u=actor(db,user),raw=db.prepare('SELECT * FROM people_requisitions WHERE id=? AND tenant_id=?').get(id,u.tenant_id);
  if(raw) {
    const r=requisition(db,u,id);
    return {...r,criteria:JSON.parse(r.criteria_json),criteria_json:undefined,actions:reqActions(db,u,r),
      manager_name:db.prepare('SELECT name FROM users WHERE id=?').get(r.manager_id).name,
      events:db.prepare('SELECT e.*,u.name AS actor_name FROM people_events e JOIN users u ON u.id=e.actor_id WHERE requisition_id=? AND candidate_id IS NULL ORDER BY seq').all(r.id)};
  }
  const c=candidate(db,u,id),r=requisition(db,u,c.requisition_id),evaluations=db.prepare('SELECT e.*,u.name AS evaluator_name FROM people_evaluations e JOIN users u ON u.id=e.evaluator_id WHERE candidate_id=? ORDER BY created_at,id').all(c.id);
  const hasOwn=evaluations.some(e=>e.evaluator_id===u.id),canSee=evaluations.length===2||hasOwn;
  return {...c,offer_json:undefined,offer:c.offer_json?JSON.parse(c.offer_json):null,requisition_title:r.title,criteria:JSON.parse(r.criteria_json),actions:candidateActions(db,u,r,c),
    evaluation_count:evaluations.length,evaluations:(canSee?evaluations.filter(e=>hasOwn||evaluations.length===2):[]).map(e=>({...e,scores_json:undefined,scores:JSON.parse(e.scores_json)})),
    events:db.prepare("SELECT e.*,u.name AS actor_name FROM people_events e JOIN users u ON u.id=e.actor_id WHERE candidate_id=? AND (action<>'evaluate' OR actor_id=? OR ?=1) ORDER BY seq").all(c.id,u.id,canSee?1:0),
    versions:db.prepare('SELECT kind,revision,snapshot_json,created_at FROM people_versions WHERE entity_id=? ORDER BY kind,revision').all(c.id).map(x=>({...x,snapshot_json:undefined,snapshot:JSON.parse(x.snapshot_json)})),
    tasks:db.prepare('SELECT id FROM people_onboarding_tasks WHERE candidate_id=? ORDER BY due_date,id').all(c.id).map(t=>taskDetail(db,u,t.id)),
    hire:hireView(db,hireOf(db,c.id))};
}
// خيارات نموذج رابط التوظيف (الترحيل 172)، لمن عنده مرشح ينتظر الربط وحده: الحسابات التي يقبلها الربط — نشطة في الكيان، لا مسؤول منصة،
// لا حساب من يربط، ولا حسابٌ رُبط بمرشح آخر — وعقودها القائمة (مسودة أو بانتظار الاعتماد أو سارية) بحالتها وتواريخها بلا مبالغ.
// ومرشحٌ رُبط حسابه وبقي عقده تُعرض عقود حسابه هو. الخيارات عرضٌ لا حكم: linkHire يعيد الفحص كله عند الربط.
function hireOptions(db,u,candidates,assignees) {
  const waiting=candidates.filter(c=>c.actions.includes('link_hire'));
  if(!waiting.length)return null;
  const linked=new Set(db.prepare('SELECT user_id FROM employee_hires WHERE tenant_id=?').all(u.tenant_id).map(h=>h.user_id));
  const accounts=assignees.filter(p=>p.id!==u.id&&!linked.has(p.id)).map(({id,name,department_id})=>({id,name,department_id}));
  const owners=new Set([...accounts.map(p=>p.id),...waiting.filter(c=>c.hire).map(c=>c.hire.user_id)]);
  return {accounts,contracts:openContracts(db,u.tenant_id).filter(c=>owners.has(c.user_id)).map(c=>({...c,status_name:CONTRACT_STATUS_NAMES[c.status]}))};
}
export function listPeople(db,user) {
  const u=actor(db,user),all=db.prepare('SELECT * FROM people_requisitions WHERE tenant_id=? ORDER BY created_at DESC,id').all(u.tenant_id).filter(r=>scope(db,u,r));
  const ids=new Set(all.map(r=>r.id));
  const allCandidates=db.prepare('SELECT id,requisition_id,retention_until FROM people_candidates WHERE tenant_id=? ORDER BY created_at DESC,id').all(u.tenant_id).filter(c=>ids.has(c.requisition_id));
  const policies=db.prepare('SELECT * FROM people_policies WHERE tenant_id=? ORDER BY effective_from,id').all(u.tenant_id).filter(p=>isHr(u,p)||u.role==='manager'&&u.department_id===p.department_id);
  const assignees=u.role==='hr'&&policies.some(p=>isHr(u,p))?db.prepare("SELECT id,name,department_id,role FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name,id").all(u.tenant_id):[];
  const candidates=allCandidates.filter(c=>c.retention_until>=peopleToday()).map(c=>getPeopleRecord(db,u,c.id));
  return {timezone:'Asia/Riyadh',today:peopleToday(),user:{id:u.id,role:u.role,department_id:u.department_id},policies,
    requisitions:all.map(r=>getPeopleRecord(db,u,r.id)),candidates,
    retention_due:allCandidates.filter(c=>c.retention_until<peopleToday()),assignees,hire_options:hireOptions(db,u,candidates,assignees),
    tasks:db.prepare('SELECT id FROM people_onboarding_tasks WHERE tenant_id=? AND owner_id=? ORDER BY due_date,id').all(u.tenant_id,u.id).map(t=>taskDetail(db,u,t.id))};
}
export function createRequisition(db,user,input) {
  writing(db);const u=actor(db,user);
  if(u.role!=='manager')fail(403,'forbidden','طلب احتياج التوظيف متاح للمدير فقط');
  v.object(input,['policy_id','title','need','plan_reference','budget_evidence','target_date','criteria']);
  const p=policy(db,u.tenant_id,v.text(input.policy_id,'نطاق التوظيف',100));
  if(!p||u.department_id!==p.department_id)fail(403,'forbidden','نطاق التوظيف خارج إدارة المدير');
  currentPolicy(p);
  if(!db.prepare("SELECT 1 FROM users WHERE tenant_id=? AND department_id=? AND role='hr' AND active=1 AND id<>?").get(u.tenant_id,p.hr_department_id,u.id))fail(409,'hr_unavailable','لا يوجد HR نشط مستقل في النطاق');
  const title=v.text(input.title,'الوظيفة',180,3),need=v.text(input.need,'مبرر الاحتياج والمهارات',3000,3),plan=v.text(input.plan_reference,'مرجع الخطة المعتمدة المصطنعة',1000,3),budget=v.text(input.budget_evidence,'دليل المخصص المصطنع',1500,3),target=futureDate(input.target_date,'تاريخ الاحتياج'),matrix=criteria(input.criteria),id=randomUUID(),time=now();
  if(target>p.effective_to)fail(400,'policy_range','تاريخ الاحتياج خارج سريان النطاق');
  db.prepare("INSERT INTO people_requisitions VALUES(?,?,?,?,?,?,?,?,?,?,'pending_need',1,?,?)").run(id,u.tenant_id,p.id,u.id,title,need,plan,budget,target,JSON.stringify(matrix),time,time);
  const r=requisition(db,u,id);versionRecord(db,u,id,'requisition',1,{title,need,plan_reference:plan,budget_evidence:budget,target_date:target,criteria:matrix,policy_id:p.id,manager_id:u.id,vacancies:1});
  event(db,u,r,null,'requisition_submitted','','pending_need',1,'');return getPeopleRecord(db,u,id);
}
export function addCandidate(db,user,requisitionId,input) {
  writing(db);const u=actor(db,user),r=requisition(db,u,requisitionId),p=policy(db,u.tenant_id,r.policy_id);
  v.object(input,['version','name','contact','source','consent_evidence','retention_until']);v.version(input.version,r.version);
  if(!reqActions(db,u,r).includes('add_candidate'))fail(403,'transition_denied','إضافة المرشح تتطلب احتياجًا معتمدًا وصلاحية HR');
  currentPolicy(p);currentManager(db,r,p);
  const name=v.text(input.name,'اسم المرشح المصطنع',180,3),contact=v.text(input.contact,'اتصال المرشح المصطنع',254).toLowerCase();
  if(!/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.invalid$/.test(contact))fail(400,'synthetic_contact','استخدم بريد عينة ينتهي بـ.invalid دون بيانات اتصال حقيقية');
  const source=v.text(input.source,'مصدر الترشيح',1000,3),consent=v.text(input.consent_evidence,'دليل موافقة الخصوصية المصطنعة',1500,3),retention=futureDate(input.retention_until,'نهاية مدة عرض البيانات');
  if(db.prepare('SELECT 1 FROM people_candidates WHERE tenant_id=? AND contact=?').get(u.tenant_id,contact))fail(409,'candidate_exists','اتصال المرشح مسجل بالفعل؛ لم ينشأ ملف مكرر');
  const id=randomUUID(),time=now();
  db.prepare("INSERT INTO people_candidates(id,tenant_id,requisition_id,name,contact,source,consent_evidence,privacy_reference,retention_until,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'applied',?,?,?)")
    .run(id,u.tenant_id,r.id,name,contact,source,consent,p.privacy_reference,retention,u.id,time,time);
  db.prepare('UPDATE people_requisitions SET version=version+1,updated_at=? WHERE id=?').run(time,r.id);
  const c=candidate(db,u,id);versionRecord(db,u,id,'candidate',1,{name,contact,source,consent_evidence:consent,privacy_reference:p.privacy_reference,retention_until:retention});
  event(db,u,r,c,'candidate_added','','applied',1,'');return getPeopleRecord(db,u,id);
}
function offerInput(input) {
  const salary=v.text(input.monthly_base,'الأجر الأساسي المصطنع',30);
  if(!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(salary))fail(400,'invalid_money','الأجر المصطنع نص عشري غير سالب بمنزلتين كحد أقصى');
  const [whole,part='']=salary.split('.'),minor=BigInt(whole)*100n+BigInt(part.padEnd(2,'0'));
  if(minor<=0n)fail(400,'invalid_money','يلزم أجر مصطنع موجب');
  if(!['SAR','USD','EUR'].includes(input.currency))fail(400,'currency','عملة العرض غير صالحة');
  const start=futureDate(input.start_date,'تاريخ التحاق مقترح'),until=futureDate(input.valid_until,'صلاحية المقترح');
  return {monthly_base_minor:minor.toString(),currency:input.currency,start_date:start,valid_until:until,benefits:v.text(input.benefits,'المزايا المصطنعة',2000,3),conditions:v.text(input.conditions,'الشروط الداخلية',2000,3)};
}
// رابط التوظيف: المرشح المقبول ← حسابه في المنصة ← عقد ذلك الحساب. الحساب يفتحه مسؤول المنصة والعقد يُعتمد بيدين في «العقود»؛
// هنا يُربط ما فُتح وما اعتُمد ولا يُنشأ شيء. مرشح لحساب واحد وحساب لمرشح واحد، والحساب أولًا ثم العقد حين يُعتمد، كلٌّ مرة واحدة.
function ownContract(db,u,person,contractId){
  const contract=personContract(db,u.tenant_id,contractId);
  if(!contract||contract.user_id!==person.id||!['draft','pending','active'].includes(contract.status))refuse(409,'hire_contract',{what:'العقد المختار مو عقد هذا الموظف، أو انتهى أو رُفض',
    missing:[{document:`عقد ${person.name} نفسه (مسودة أو بانتظار الاعتماد أو ساري)`,why:'رابط التوظيف يحمل عقد الحساب الذي فُتح للمرشح',owner:'معدّ العقود في خدمات الموظف',owner_role:'hr'}],
    next:'اختر عقد الموظف نفسه من «العقود وبنود الراتب»',link:'#contracts'});
  return contract;
}
export function linkHire(db,user,candidateId,input) {
  writing(db);const u=actor(db,user),c=candidate(db,u,candidateId),r=requisition(db,u,c.requisition_id),p=policy(db,u.tenant_id,r.policy_id);
  v.object(input,['version','user_id','contract_id','evidence']);v.version(input.version,c.version);
  if(!isHr(u,p)||!HIRED.includes(c.status))refuse(403,'transition_denied',{what:'ربط المرشح بحسابه وعقده ما يتاح في هذه المرحلة أو لحسابك',
    missing:[{document:'مرشحٌ قَبِل العرض المعتمد، وموظف خدمات في نطاق التوظيف',why:'الرابط يوثّق من وُظّف فعلًا ويكتبه من يملك ملف التوظيف',owner:'خدمات الموظف في نطاق الاحتياج',owner_role:'hr'}],
    next:'يُربط بعد قبول العرض بيد موظف خدمات الموظف المسؤول عن الاحتياج'});
  const evidence=v.text(input.evidence,'دليل الربط: مرجع فتح الحساب والعقد',2000,3),time=now(),existing=hireOf(db,c.id),blank=value=>value===undefined||value===null||value==='';
  if(existing){
    if(existing.contract_id)refuse(409,'hire_linked',{what:'رابط هذا المرشح مكتمل: حسابه وعقده مربوطان',next:'الرابط ما يتغير بعد اكتماله؛ تعديل العقد يمر بـ«العقود وبنود الراتب»'});
    if(!blank(input.user_id)&&input.user_id!==existing.user_id)refuse(409,'hire_linked',{what:`هذا المرشح مربوط من قبل بحساب ${personName(db,existing.user_id)}، والحساب ما يتبدل`,next:'اربط العقد وحده'});
    if(blank(input.contract_id))refuse(400,'hire_contract',{what:'اختر عقد الموظف لإكمال الرابط',next:'يُعد العقد ويُعتمد من «العقود وبنود الراتب»، ثم يُربط هنا',link:'#contracts'});
    if(existing.user_id===u.id)refuse(409,'separation_of_duties',{what:'ما تربط عقدك أنت برابط توظيفك',next:'يربطه زميل آخر من خدمات الموظف'});
    const person=personAssignment(db,u.tenant_id,existing.user_id),contract=ownContract(db,u,person,input.contract_id);
    db.prepare('UPDATE employee_hires SET contract_id=?,contract_linked_by=?,contract_linked_at=? WHERE id=?').run(contract.id,u.id,time,existing.id);
    audit(db,u,'people_candidate',c.id,'people.hire_linked',{contract_id:null},{user_id:person.id,contract_id:contract.id,requisition_id:r.id});
    return getPeopleRecord(db,u,c.id);
  }
  if(blank(input.user_id))refuse(400,'hire_user',{what:'ما اخترت حساب الموظف الذي فُتح لهذا المرشح',next:'اختر الحساب من القائمة؛ وإن لم يُفتح بعد يفتحه مسؤول المنصة من «الحسابات»'});
  const person=typeof input.user_id==='string'?personAssignment(db,u.tenant_id,input.user_id):null;
  if(!person||!person.active||person.role==='admin')refuse(409,'hire_user',{what:'الحساب المختار مو حساب موظف نشط في كيانك',
    missing:[{document:'حساب موظف نشط في هذا الكيان، فُتح لهذا المرشح',why:'رابط التوظيف يصل المرشح بالحساب الذي يعمل به',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'يفتح مسؤول المنصة الحساب من «الحسابات»، ثم تربطه هنا'});
  if(person.id===u.id)refuse(409,'separation_of_duties',{what:'ما تربط مرشحًا بحسابك أنت',next:'يربطه زميل آخر من خدمات الموظف'});
  if(db.prepare('SELECT 1 FROM employee_hires WHERE user_id=?').get(person.id))refuse(409,'user_hired',{what:`حساب ${person.name} مربوط من قبل بمرشح آخر`,next:'لكل حساب مرشح واحد؛ اختر الحساب الذي فُتح لهذا المرشح'});
  const contract=blank(input.contract_id)?null:ownContract(db,u,person,input.contract_id);
  db.prepare('INSERT INTO employee_hires(id,tenant_id,candidate_id,user_id,contract_id,evidence,linked_by,linked_at,contract_linked_by,contract_linked_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),u.tenant_id,c.id,person.id,contract?.id??null,evidence,u.id,time,contract?u.id:null,contract?time:null);
  audit(db,u,'people_candidate',c.id,'people.hire_linked',{},{user_id:person.id,contract_id:contract?.id??null,requisition_id:r.id});
  return getPeopleRecord(db,u,c.id);
}
export function peopleAction(db,user,id,action,input) {
  if(action==='add_candidate')return addCandidate(db,user,id,input);
  if(action==='link_hire')return linkHire(db,user,id,input);
  writing(db);const u=actor(db,user);
  const isNeed=['approve_need','reject_need','cancel_need'].includes(action);
  const c=isNeed?null:candidate(db,u,id),r=requisition(db,u,isNeed?id:c.requisition_id),p=policy(db,u.tenant_id,r.policy_id),entity=c??r;
  const allowed={approve_need:['note'],reject_need:['note'],cancel_need:['note'],screen:['evidence'],schedule_interview:['interview_date','evidence'],evaluate:['scores','recommendation','evidence'],propose_offer:['monthly_base','currency','start_date','valid_until','benefits','conditions','evidence'],approve_offer:['evidence'],reject_offer:['evidence'],reject_candidate:['evidence'],accept_offer:['accepted_on','evidence'],start_onboarding:['items','evidence'],complete_onboarding:['evidence']}[action];
  if(!allowed)fail(400,'unknown_action','إجراء التوظيف غير معروف');
  v.object(input,['version',...allowed]);v.version(input.version,entity.version);
  if(!(isNeed?reqActions(db,u,r):candidateActions(db,u,r,c)).includes(action))fail(403,'transition_denied','الإجراء غير متاح في هذه المرحلة أو لهذا المستخدم');
  const evidence=v.text(input[isNeed?'note':'evidence'],'دليل الإجراء وسببه',2000,3);
  if(isNeed) {
    if(action==='approve_need'){currentPolicy(p);currentManager(db,r,p);}
    const next=action==='approve_need'?'open':action==='reject_need'?'rejected':'cancelled';
    db.prepare('UPDATE people_requisitions SET status=?,version=version+1,updated_at=? WHERE id=?').run(next,now(),r.id);
    event(db,u,r,null,action,r.status,next,r.version+1,evidence);return getPeopleRecord(db,u,r.id);
  }
  if(!['reject_candidate','reject_offer','complete_onboarding'].includes(action)){currentPolicy(p);currentManager(db,r,p);}
  let next=c.status,interviewDate=c.interview_date,reviewer=c.reviewer_hr_id,offerJson=c.offer_json,offerRevision=c.offer_revision;
  if(action==='screen') next='screened';
  if(action==='schedule_interview') {interviewDate=v.date(input.interview_date);reviewer=u.id;next='interviewing';}
  if(action==='evaluate') {
    if(c.interview_date>peopleToday())fail(409,'interview_not_due','لا يسجل تقييم مقابلة قبل تاريخها في الرياض');
    const matrix=JSON.parse(r.criteria_json);
    if(!Array.isArray(input.scores)||input.scores.length!==matrix.length)fail(400,'score_matrix','يلزم دليل ودرجة لكل معيار معتمد');
    const seen=new Set(),scores=input.scores.map(row=>{
      v.object(row,['key','score','evidence']);
      if(!matrix.some(x=>x.key===row.key)||seen.has(row.key)||!Number.isInteger(row.score)||row.score<0||row.score>5)fail(400,'score_matrix','درجات المصفوفة من0 إلى5 دون تكرار معيار');
      seen.add(row.key);return {key:row.key,score:row.score,evidence:v.text(row.evidence,'دليل معيار المقابلة',1500,3)};
    });
    if(!['proceed','do_not_proceed'].includes(input.recommendation))fail(400,'recommendation','يلزم تحديد توصية المقيم');
    db.prepare('INSERT INTO people_evaluations VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),u.tenant_id,c.id,u.id,JSON.stringify(scores),input.recommendation,evidence,now());
    next=db.prepare('SELECT COUNT(*) AS n FROM people_evaluations WHERE candidate_id=?').get(c.id).n===2?'evaluated':'interviewing';
  }
  if(action==='propose_offer') {
    const evaluations=db.prepare('SELECT evaluator_id FROM people_evaluations WHERE candidate_id=?').all(c.id);
    if(evaluations.length!==2||!evaluations.some(e=>e.evaluator_id===r.manager_id)||!evaluations.some(e=>e.evaluator_id===c.reviewer_hr_id))fail(409,'evaluations_incomplete','يلزم تقييم مستقل من المدير وHR');
    const hr=db.prepare("SELECT 1 FROM users WHERE id=? AND tenant_id=? AND department_id=? AND role='hr' AND active=1").get(c.reviewer_hr_id,u.tenant_id,p.hr_department_id);
    if(!hr)fail(409,'reviewer_unavailable','معتمد تقييم HR لم يعد نشطًا في نطاقه');
    const offer=offerInput(input);offerRevision++;offerJson=JSON.stringify({...offer,prepared_by:u.id,environment:'internal_proposal'});next='offer_pending';
    versionRecord(db,u,c.id,'offer',offerRevision,JSON.parse(offerJson));
  }
  if(action==='approve_offer') {
    const offer=JSON.parse(c.offer_json);
    if(offer.prepared_by===u.id)fail(403,'self_approval','لا يعتمد معد العرض مقترحه');
    if(offer.valid_until<peopleToday())fail(409,'offer_expired','انتهت صلاحية المقترح الداخلي');
    next='offer_approved';
  }
  if(action==='reject_offer'||action==='reject_candidate')next='rejected';
  if(action==='accept_offer') {
    const offer=JSON.parse(c.offer_json),accepted=v.date(input.accepted_on);
    if(offer.valid_until<peopleToday()||accepted>peopleToday()||accepted>offer.valid_until)fail(409,'offer_expired','تاريخ القبول أو صلاحية العرض غير صالح');
    const approval=db.prepare("SELECT created_at FROM people_events WHERE candidate_id=? AND action='approve_offer' ORDER BY seq DESC LIMIT 1").get(c.id);
    if(!approval||accepted<dateInRiyadh(approval.created_at))fail(400,'acceptance_date','لا يسبق القبول قرار اعتماد المقترح');
    versionRecord(db,u,c.id,'acceptance',1,{offer_revision:c.offer_revision,accepted_on:accepted,evidence,recorded_by:u.id});
    next='accepted';db.prepare("UPDATE people_requisitions SET status='filled',version=version+1,updated_at=? WHERE id=?").run(now(),r.id);
  }
  if(action==='start_onboarding') {
    if(!Array.isArray(input.items)||!input.items.length||input.items.length>30)fail(400,'onboarding_items','يلزم عنصر تهيئة واحد إلى30 عنصرًا');
    const unique=new Set(),items=input.items.map(item=>{
      v.object(item,['title','owner_id','due_date','acceptance']);
      const title=v.text(item.title,'عنصر التهيئة',180,3),ownerId=v.text(item.owner_id,'مالك العنصر',100),owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(ownerId,u.tenant_id);
      if(!owner)fail(403,'task_owner','مالك العنصر خارج الكيان أو غير نشط');
      const identity=`${owner.id}:${title}`;if(unique.has(identity))fail(400,'duplicate_item','عنصر تهيئة مكرر');unique.add(identity);
      return {id:randomUUID(),title,owner_id:owner.id,due_date:futureDate(item.due_date,'موعد عنصر التهيئة'),acceptance:v.text(item.acceptance,'معيار إكمال العنصر',1500,3)};
    });
    for(const item of items) db.prepare('INSERT INTO people_onboarding_tasks(id,tenant_id,candidate_id,title,owner_id,due_date,acceptance,created_at) VALUES(?,?,?,?,?,?,?,?)').run(item.id,u.tenant_id,c.id,item.title,item.owner_id,item.due_date,item.acceptance,now());
    versionRecord(db,u,c.id,'onboarding',1,{items,evidence});next='onboarding';
  }
  if(action==='complete_onboarding') {
    const count=db.prepare("SELECT COUNT(*) AS n,SUM(status='completed') AS completed FROM people_onboarding_tasks WHERE candidate_id=?").get(c.id);
    if(!count.n||count.n!==count.completed)fail(409,'onboarding_incomplete','لا تكتمل التهيئة قبل توثيق جميع عناصرها من ملاكها');
    next='completed';
  }
  db.prepare('UPDATE people_candidates SET status=?,interview_date=?,reviewer_hr_id=?,offer_json=?,offer_revision=?,version=version+1,updated_at=? WHERE id=?').run(next,interviewDate,reviewer,offerJson,offerRevision,now(),c.id);
  event(db,u,r,c,action,c.status,next,c.version+1,evidence);return getPeopleRecord(db,u,c.id);
}
export function completeOnboardingTask(db,user,id,input) {
  writing(db);const u=actor(db,user),task=taskDetail(db,u,id);
  v.object(input,['version','evidence']);v.version(input.version,task.version);
  if(!task.can_complete)fail(403,'forbidden','إكمال عنصر التهيئة متاح لمالكه مرة واحدة');
  const evidence=v.text(input.evidence,'دليل تنفيذ العنصر المحلي',2000,3);
  db.prepare("UPDATE people_onboarding_tasks SET status='completed',evidence=?,version=version+1,completed_at=? WHERE id=?").run(evidence,now(),id);
  audit(db,u,'people_onboarding_task',id,'people.task_completed',{status:'open'},{status:'completed',version:task.version+1});
  return taskDetail(db,u,id);
}
