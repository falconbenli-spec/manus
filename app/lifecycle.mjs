import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { can, holds, userLevel, levelsEnabled, capabilitiesOfLevel, levelName, capabilityName } from './access.mjs';
import { roleName } from './static/vocabulary.mjs';
import { currentUser } from './delegations.mjs';
import { holidaySet, addWorkingDays } from './work-calendar.mjs';
import { outstandingAdvances } from './payroll-extras.mjs';
import { intakeObligations } from './project-intake.mjs';

// حزم التعيين والمغادرة: طلب واحد يولّد خطوات متوازية موزّعة على الإدارات، لكل خطوة مالك ومدة ومعيار قبول.
// ما تفعله المنصة هنا: تُظهر ما بقي، ولمن، وبأي دليل يُغلق. وما لا تفعله: لا تسحب صلاحية ولا تعطّل حسابًا
// ولا تُرجع عهدة — التنفيذ فعل بشري يُسجَّل في شاشته، والمنصة تعرض من يفعله.

const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const KINDS=[{key:'onboarding',name:'تعيين موظف'},{key:'offboarding',name:'مغادرة موظف'}];
// أدوار مالكي الخطوات = أدوار الحسابات نفسها عدا «مسؤول المنصة»، لأن مالك الخطوة يُحَل بـ
// `users.role` مباشرة في resolveStepOwner. فهذه ليست قائمة أسماء تُوسَّع بأسماء خانات النماذج:
// «مالية» و«رئيس تنفيذي» و«شؤون إدارية» — الخانات الثلاث في نموذج إخلاء الطرف — لو أُضيفت هنا لسقطت
// ثلاث مرات: قيد `owner_role` في الترحيل 072، وقيد `users.role` في المخطط (لا حساب يحمل دور «مالية»)،
// وقائمة الأسماء في lifecycle-ui فتُعرض المفاتيح الإنجليزية على شاشة عربية. والمحطة تُسمّى بإدارتها
// مع دورها لا بدورها وحده: «الإدارة المالية» = (finance, manager) وهي ممثَّلة اليوم؛ والست محطات
// تُحفَظ فعلًا (قِيس: القالب يقبلها). المحطة التي لا تُمثَّل هي الرئاسة، وسببها وعلاجها في
// docs/implementation/approval-chain-gap-20260930.md.
const OWNER_ROLES=['manager','hr','it','pm','employee'];
const kindName=key=>KINDS.find(k=>k.key===key)?.name??key;

function actor(db,u){const c=currentUser(db,u);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة رحلة الموظف معاملة قاعدة بيانات');}
const manages=(db,u)=>can(db,u,'people.manage');
// تصاريح الرواتب والمالية التي تقرأ الموانع المالية وتقرّ إغلاق التزام مالي لم يُقفل في مصدره. الفحص بـholds الصارم.
const PAYROLL_CAPS=['payroll.prepare','payroll.review','payroll.approve'];
const FINANCE_CAPS=[...PAYROLL_CAPS,'finance.use'];
const holdsAny=(db,u,caps)=>caps.some(cap=>holds(db,u,cap));
// من يرى مبالغ الإخلاء وبنوده المالية: مالك الحزمة وحامل تصريح التوظيف والتهيئة فقط، لا مالكو الخطوات ولا صاحب الرحلة.
const seesMoney=(db,u,b)=>b.owner_id===u.id||holds(db,u,'people.manage');
// مالك إجراء الإدارة يضع خطوات إدارته؛ ومن يملك التوظيف والتهيئة يضع خطوات أي إدارة.
const ownsProcess=(db,u,departmentId)=>manages(db,u)||(u.role==='manager'&&u.department_id===departmentId);
const person=(db,uid)=>uid?db.prepare('SELECT name FROM users WHERE id=?').get(uid)?.name??null:null;

// ————— قالب الخطوات: يبدأ فارغًا عمدًا —————

function templateRow(db,u,templateId){
  const t=db.prepare('SELECT * FROM lifecycle_step_templates WHERE id=? AND tenant_id=?').get(templateId,u.tenant_id);
  if(!t)fail(404,'not_found','خطوة القالب غير متاحة');
  return t;
}
// الحلقة: خطوة تعتمد على نفسها عبر سلسلة. كل خطوة لها اعتمادية واحدة، فالمشي لأعلى يكشف الحلقة قطعًا.
function assertNoCycle(db,tenantId,templateId,dependsOn){
  const seen=new Set([templateId]);
  for(let cursor=dependsOn;cursor;){
    if(seen.has(cursor))fail(409,'dependency_cycle','هذه الاعتمادية تُنشئ حلقة: الخطوة تعتمد على نفسها عبر سلسلة');
    seen.add(cursor);
    cursor=db.prepare('SELECT depends_on FROM lifecycle_step_templates WHERE id=? AND tenant_id=?').get(cursor,tenantId)?.depends_on??null;
  }
}
function templateInput(db,u,input,existing){
  const kind=existing?existing.kind:input.kind;
  if(!KINDS.some(k=>k.key===kind))fail(400,'kind','نوع الحزمة غير صالح');
  const department=db.prepare('SELECT id FROM departments WHERE id=? AND tenant_id=? AND active=1').get(input.department_id,u.tenant_id);
  if(!department)fail(400,'department','الإدارة غير موجودة أو مؤرشفة');
  if(!ownsProcess(db,u,department.id))fail(403,'not_permitted','خطوات الإدارة يضعها مالك إجراء تلك الإدارة أو من يملك تصريح التوظيف والتهيئة');
  if(!OWNER_ROLES.includes(input.owner_role))fail(400,'owner_role','دور مالك الخطوة غير صالح');
  if(!Number.isInteger(input.target_days)||input.target_days<0||input.target_days>120)fail(400,'target_days','المدة المستهدفة بأيام العمل من 0 إلى 120');
  let dependsOn=null;
  if(input.depends_on){
    const parent=templateRow(db,u,input.depends_on);
    if(parent.kind!==kind)fail(400,'depends_on','الاعتمادية تكون بين خطوتين في النوع نفسه');
    dependsOn=parent.id;
  }
  return {kind,department_id:department.id,owner_role:input.owner_role,target_days:input.target_days,depends_on:dependsOn,
    title:v.text(input.title,'عنوان الخطوة',180,3),
    acceptance:v.text(input.acceptance,'معيار قبول الخطوة',2000,10),
    basis:v.text(input.basis,'سند الخطوة: من قررها ومتى',2000,10)};
}
export function saveStepTemplate(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['kind','code','title','department_id','owner_role','target_days','acceptance','depends_on','basis']);
  const clean=templateInput(db,u,input),code=v.text(input.code,'رمز الخطوة',40,2);
  if(db.prepare('SELECT 1 FROM lifecycle_step_templates WHERE tenant_id=? AND kind=? AND code=?').get(u.tenant_id,clean.kind,code))fail(409,'code_exists','رمز الخطوة مستخدم في هذا النوع');
  const templateId=id(),time=now();
  assertNoCycle(db,u.tenant_id,templateId,clean.depends_on);
  db.prepare('INSERT INTO lifecycle_step_templates(id,tenant_id,kind,code,title,department_id,owner_role,target_days,acceptance,depends_on,basis,defined_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(templateId,u.tenant_id,clean.kind,code,clean.title,clean.department_id,clean.owner_role,clean.target_days,clean.acceptance,clean.depends_on,clean.basis,u.id,time,time);
  audit(db,u,'lifecycle_template',templateId,'lifecycle.template_added',{},{kind:clean.kind,code,department_id:clean.department_id,depends_on:clean.depends_on},clean.basis);
  return {id:templateId};
}
export function updateStepTemplate(db,supplied,templateId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','title','department_id','owner_role','target_days','acceptance','depends_on','active','basis']);
  const existing=templateRow(db,u,templateId);v.version(input.version,existing.version);
  if(!ownsProcess(db,u,existing.department_id))fail(403,'not_permitted','تعديل الخطوة لمالك إجراء إدارتها');
  const clean=templateInput(db,u,input,existing);
  if(typeof input.active!=='boolean')fail(400,'active','حدد إن كانت الخطوة مفعّلة');
  assertNoCycle(db,u.tenant_id,templateId,clean.depends_on);
  db.prepare('UPDATE lifecycle_step_templates SET title=?,department_id=?,owner_role=?,target_days=?,acceptance=?,depends_on=?,active=?,basis=?,version=version+1,updated_at=? WHERE id=?')
    .run(clean.title,clean.department_id,clean.owner_role,clean.target_days,clean.acceptance,clean.depends_on,input.active?1:0,clean.basis,now(),templateId);
  audit(db,u,'lifecycle_template',templateId,'lifecycle.template_updated',{version:existing.version,active:existing.active},{version:existing.version+1,active:input.active?1:0},clean.basis);
  return {id:templateId};
}

// ————— إخلاء الطرف: يُشتق مما تعرفه المنصة عن هذا الشخص، لا من قالب —————

// قراءة صرفة: تُستدعى من مسار التسوية داخل معاملة غيرها، فلا تكتب شيئًا.
export function deriveClearance(db,tenantId,employeeId){
  const rows=[];
  const add=(source,sourceId,title,detail,financial,amount,owner)=>rows.push({source,source_id:String(sourceId),title,detail,financial:financial?1:0,amount_minor:financial?amount:null,action_owner:owner});

  for(const c of db.prepare("SELECT id,amount_minor,returned_minor,purpose,status FROM custodies WHERE tenant_id=? AND holder_id=? AND status IN ('approved','issued')").all(tenantId,employeeId))
    add('custody',c.id,`عهدة نقدية — ${c.purpose}`,`الحالة: ${c.status==='issued'?'مصروفة':'معتمدة ولم تُصرف'}`,true,Math.max(0,c.amount_minor-c.returned_minor),'المالية: إقفال العهدة بمستند الإرجاع في شاشة المصروفات والعهد');

  for(const a of db.prepare("SELECT id,code,name,cost_minor FROM fixed_assets WHERE tenant_id=? AND custodian_id=? AND status='active'").all(tenantId,employeeId))
    add('fixed_asset',a.id,`أصل ثابت باسمه — ${a.code} ${a.name}`,'مسجل في سجل الأصول الثابتة',true,a.cost_minor,'المالية: نقل عهدة الأصل لمسؤول آخر في شاشة الأصول');

  for(const b of db.prepare(`SELECT b.id,b.purpose,i.code,i.name,i.asset_id FROM equipment_bookings b JOIN equipment_items i ON i.id=b.item_id
      WHERE b.tenant_id=? AND b.custodian_id=? AND b.status='out'`).all(tenantId,employeeId)){
    const value=b.asset_id?db.prepare('SELECT cost_minor FROM fixed_assets WHERE id=?').get(b.asset_id)?.cost_minor??0:0;
    add('equipment',b.id,`معدة مسلَّمة ولم تُرجع — ${b.code} ${b.name}`,value?`مرتبطة بأصل ثابت مسجل`:'قيمتها غير مسجلة في المنصة؛ البند مانع رغم ذلك',true,value,'مسؤول المعدات: تسجيل الاستلام في شاشة المعدات');
  }

  const advances=outstandingAdvances(db,employeeId);
  if(advances>0)add('advance',employeeId,'أقساط سلفة معتمدة غير مسددة','مجموع الأقساط التي لم يُعتمد مسيرها بعد',true,advances,'الرواتب: تسوية الرصيد ضمن التسوية النهائية');

  for(const g of db.prepare('SELECT id,capability,department_id FROM access_grants WHERE tenant_id=? AND user_id=? AND revoked_at IS NULL').all(tenantId,employeeId))
    add('access_grant',g.id,`صلاحية نشطة — ${g.capability}`,g.department_id?`محصورة بإدارة ${g.department_id}`:'غير محصورة بإدارة',false,null,'مسؤول الصلاحيات: السحب فعل بشري يُسجَّل في شاشة الصلاحيات؛ المنصة لا تسحبه آليًا');

  // مستوى الإدارة (ترحيل 130) مصدرٌ ثانٍ للصلاحية بعد المنح الفردية، فمن يغادر وهو على مستوى يحمل تصاريح
  // كان يخرج من هذه القائمة كأنه بلا صلاحية. البند يُعرض حين يحمل مستواه شيئًا فعلًا (بالمفتاح المشتعل
  // والقالب واستثناء إدارته)، فلا يُضاف سطرٌ فارغ لكل مغادر.
  const departing=db.prepare('SELECT id,tenant_id,role,department_id FROM users WHERE id=? AND tenant_id=?').get(employeeId,tenantId);
  if(departing){
    const level=userLevel(db,departing),carried=level&&levelsEnabled(db,tenantId)?[...capabilitiesOfLevel(db,tenantId,level,departing.department_id,departing.role)]:[];
    if(carried.length)add('permission_level',employeeId,`مستوى صلاحية نشط — ${levelName(level)}`,`يحمل ${carried.length} تصريحًا بمستواه في إدارة ${departing.department_id}: ${carried.map(capabilityName).join('، ')}`,
      false,null,'مسؤول الصلاحيات: خفض المستوى أو إعادة اشتقاقه من «مصفوفة الصلاحيات»؛ المنصة لا تخفضه آليًا');
  }

  if(db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND active=1').get(employeeId,tenantId))
    add('account',employeeId,'حساب المستخدم ما زال نشطًا','',false,null,'الموارد البشرية: تعطيل الحساب يتبع تسجيل حالة «غادر» في الملف الوظيفي؛ المنصة لا تعطّله آليًا');

  for(const r of db.prepare(`SELECT id,title,status,requester_id FROM requests WHERE tenant_id=? AND (requester_id=? OR assigned_to=?)
      AND status NOT IN ('completed','cancelled','rejected')`).all(tenantId,employeeId,employeeId))
    add('request',r.id,`طلب مفتوح — ${r.title}`,`${r.requester_id===employeeId?'قدّمه':'مسند إليه'} · الحالة ${r.status}`,false,null,'الإدارة المنفذة: إغلاق الطلب أو تحويله لمنفذ آخر');

  for(const t of db.prepare("SELECT t.id,t.title FROM request_tasks t WHERE t.tenant_id=? AND t.assignee_id=? AND t.status='open'").all(tenantId,employeeId))
    add('request_task',t.id,`مهمة طلب مفتوحة — ${t.title}`,'',false,null,'مسند المهمة: إعادة الإسناد أو الإغلاق بدليل');

  for(const t of db.prepare("SELECT t.id,t.title,p.name FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.tenant_id=? AND t.assignee_id=? AND t.status='open'").all(tenantId,employeeId))
    add('project_task',t.id,`مهمة مشروع مفتوحة — ${t.title}`,`المشروع ${t.name}`,false,null,'مدير المشروع: إعادة الإسناد');

  for(const s of db.prepare("SELECT s.id,r.title FROM approval_steps s JOIN requests r ON r.id=s.request_id WHERE r.tenant_id=? AND COALESCE((SELECT e.to_user_id FROM approval_step_escalations e WHERE e.step_id=s.id ORDER BY e.level DESC LIMIT 1),s.approver_id)=? AND s.status='pending' AND s.revision=r.revision").all(tenantId,employeeId))
    add('approval_step',s.id,`اعتماد معلّق باسمه — ${s.title}`,'',false,null,'صاحب الطلب أو المعتمد البديل: التصعيد أو التفويض في شاشة الطلب');

  const time=new Date(Date.now()).toISOString();
  for(const d of db.prepare('SELECT id,service_code,grantor_id FROM approval_delegations WHERE tenant_id=? AND (grantor_id=? OR delegate_id=?) AND revoked_at IS NULL AND ends_at>?').all(tenantId,employeeId,employeeId,time))
    add('delegation',d.id,`تفويض اعتماد سارٍ — ${d.service_code}`,d.grantor_id===employeeId?'هو المفوِّض':'هو المفوَّض إليه',false,null,'المفوِّض: إلغاء التفويض في شاشة التفويضات');

  for(const p of db.prepare('SELECT p.id,p.name FROM project_members m JOIN projects p ON p.id=m.project_id WHERE p.tenant_id=? AND m.user_id=?').all(tenantId,employeeId))
    add('project',p.id,`عضوية مشروع — ${p.name}`,'يحتاج تسليم ما بيده في المشروع',false,null,'مدير المشروع: توثيق التسليم وإخراج العضو');

  // سلسلة استلام المشاريع (ترحيل 109): محضر تسليم باسمه لم يُستلم، أو استلام مسجَّل باسمه، أو طلب تغيير رفعه ولم يُبت فيه.
  // بنود غير مالية، لكن تركها يترك مشروعًا بلا مدير مسمى في محضره.
  for(const row of intakeObligations(db,tenantId,employeeId))
    add(row.source,row.source_id,row.title,row.detail,false,null,row.action_owner);

  return rows;
}
function insertClearance(db,u,bundle,rows){
  let created=0;
  const time=now();
  for(const row of rows){
    if(db.prepare('SELECT 1 FROM lifecycle_clearance_items WHERE bundle_id=? AND source=? AND source_id=?').get(bundle.id,row.source,row.source_id))continue;
    db.prepare("INSERT INTO lifecycle_clearance_items(id,tenant_id,bundle_id,employee_id,source,source_id,title,detail,financial,amount_minor,action_owner,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'open',?,?)")
      .run(id(),u.tenant_id,bundle.id,bundle.employee_id,row.source,row.source_id,row.title,row.detail,row.financial,row.amount_minor,row.action_owner,time,time);
    created++;
  }
  return created;
}

// ————— الحزمة —————

function bundleRow(db,u,bundleId){
  const b=db.prepare('SELECT * FROM lifecycle_bundles WHERE id=? AND tenant_id=?').get(bundleId,u.tenant_id);
  if(!b)fail(404,'not_found','الحزمة غير متاحة');
  return b;
}
export function openBundle(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!manages(db,u))fail(403,'not_permitted','فتح حزمة التعيين أو المغادرة لمن يملك تصريح التوظيف والتهيئة');
  return createBundle(db,u,input);
}
// حزمة المغادرة التي يفتحها قبول الاستقالة (resignations.mjs): المستدعي تحقق من صلاحية القرار الذي نشأت عنه،
// والحزمة تُبنى من القالب نفسه وبقواعده نفسها (لا يفتحها صاحب الرحلة ولا يملكها).
export function openOffboardingFor(db,opener,input){
  writing(db);const u=actor(db,opener);
  return createBundle(db,u,{...input,kind:'offboarding'});
}
function createBundle(db,u,input){
  v.object(input,['kind','employee_id','owner_id','effective_date','date_basis']);
  if(!KINDS.some(k=>k.key===input.kind))fail(400,'kind','نوع الحزمة غير صالح');
  const employee=db.prepare("SELECT id,name FROM users WHERE id=? AND tenant_id=? AND role<>'admin'").get(input.employee_id,u.tenant_id);
  if(!employee)fail(400,'employee','الموظف غير موجود في الكيان');
  if(employee.id===u.id)fail(403,'separation_of_duties','لا تفتح حزمة رحلتك بنفسك');
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id);
  if(!owner)fail(400,'owner','مالك الحزمة يجب أن يكون حسابًا نشطًا في الكيان');
  if(owner.id===employee.id)fail(403,'separation_of_duties','لا يملك الشخص حزمة رحلته');
  if(db.prepare("SELECT 1 FROM lifecycle_bundles WHERE tenant_id=? AND employee_id=? AND kind=? AND status='open'").get(u.tenant_id,employee.id,input.kind))fail(409,'bundle_open','لهذا الموظف حزمة مفتوحة من النوع نفسه');
  // المنصة لا تفترض تاريخًا ولا مهلة: التاريخ وسنده إدخال بشري.
  const effective=v.date(input.effective_date),basis=v.text(input.date_basis,'سند التاريخ: القرار أو الخطاب ومن أكده ومتى',2000,10);
  const templates=db.prepare('SELECT * FROM lifecycle_step_templates WHERE tenant_id=? AND kind=? AND active=1 ORDER BY created_at,id').all(u.tenant_id,input.kind);
  if(!templates.length)fail(409,'no_template',`لا خطوات مسجلة لـ«${kindName(input.kind)}». تُبنى الحزمة من قالب يضعه مالك إجراء كل إدارة، والمنصة لا تخترع خطوات.`);
  const bundleId=id(),time=now();
  db.prepare("INSERT INTO lifecycle_bundles(id,tenant_id,kind,employee_id,owner_id,effective_date,date_basis,status,opened_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'open',?,?,?)")
    .run(bundleId,u.tenant_id,input.kind,employee.id,owner.id,effective,basis,u.id,time,time);
  const bundle=bundleRow(db,u,bundleId);
  const holidays=holidaySet(db,u.tenant_id),anchor=today(),mapping=new Map();
  // الاعتمادية تُنسخ إلى الحزمة، فتُدرج الخطوات بترتيب اعتمادياتها.
  const pending=[...templates];
  for(let guard=0;pending.length&&guard<=templates.length;guard++){
    for(const t of pending.splice(0,pending.length)){
      if(t.depends_on&&!mapping.has(t.depends_on)){
        // اعتمادية على خطوة معطّلة لا تُدرج: تسقط الاعتمادية ويبقى الأثر في سند الخطوة.
        if(templates.some(x=>x.id===t.depends_on)){pending.push(t);continue;}
      }
      const stepId=id(),ownerId=resolveStepOwner(db,u,t,employee.id);
      db.prepare("INSERT INTO lifecycle_steps(id,tenant_id,bundle_id,employee_id,template_id,title,department_id,owner_id,target_days,due_date,acceptance,depends_on,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)")
        .run(stepId,u.tenant_id,bundleId,employee.id,t.id,t.title,t.department_id,ownerId,t.target_days,addWorkingDays(anchor,t.target_days,holidays),t.acceptance,t.depends_on?mapping.get(t.depends_on)??null:null,time,time);
      mapping.set(t.id,stepId);
    }
  }
  if(pending.length)fail(409,'dependency_cycle','قالب هذا النوع يحوي حلقة اعتماديات؛ صحّحه قبل فتح الحزمة');
  const derived=input.kind==='offboarding'?insertClearance(db,u,bundle,deriveClearance(db,u.tenant_id,employee.id)):0;
  audit(db,u,'lifecycle_bundle',bundleId,'lifecycle.bundle_opened',{},{kind:input.kind,employee_id:employee.id,owner_id:owner.id,effective_date:effective,steps:mapping.size,clearance_items:derived},basis);
  return {id:bundleId,steps:mapping.size,clearance_items:derived};
}
// مالك الخطوة: حساب نشط واحد بالدور المطلوب في الإدارة المطلوبة. الغموض يُرفض ولا يُخمَّن.
// والرفض كان يقف عند العدّ: يقول «ووُجد 4» بالمفتاح الإنجليزي للدور، فلا يعرف من يقرؤه أيّ الأربعة
// يقصد ولا ما يفعله. وهو الرفض الذي تصطدم به محطات نموذج إخلاء الطرف بعينه: محطتا «الشؤون الإدارية»
// و«الرئيس التنفيذي» كلتاهما (مكتب الرئيس التنفيذي، مدير)، والمكتب فيه أربعة حسابات بهذا الدور.
// فالرسالة تسمّي الإدارة والدور بالعربية وتقول المخرجين: محطةٌ بإدارةٍ فيها صاحب الدور واحد، أو حسابٌ
// واحد نشط بالدور في هذه الإدارة. وما لا تحلّه الرسالة — تمييز محطتين في الإدارة نفسها بالدور نفسه —
// مكتوب في docs/implementation/approval-chain-gap-20260930.md لأنه يلزمه عمودٌ في القالب لا صياغة.
function resolveStepOwner(db,u,template,employeeId){
  const rows=db.prepare('SELECT id FROM users WHERE tenant_id=? AND department_id=? AND role=? AND active=1 AND id<>? ORDER BY id').all(u.tenant_id,template.department_id,template.owner_role,employeeId);
  if(rows.length===1)return rows[0].id;
  const department=db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(template.department_id,u.tenant_id)?.name??template.department_id;
  const role=roleName(template.owner_role);
  fail(409,'step_owner_unavailable',rows.length
    ?`خطوة «${template.title}»: في «${department}» ${rows.length} حسابات نشطة بدور «${role}»، والمنصة ما تخمّن أيّها مالك المحطة. خلّ المحطة بإدارةٍ صاحبُ الدور فيها واحد، أو أبقِ حسابًا واحدًا نشطًا بهذا الدور فيها`
    :`خطوة «${template.title}»: ما في حساب نشط بدور «${role}» في «${department}»، فما لها مالك. عيّن حسابًا بهذا الدور في الإدارة، أو حوّل المحطة إلى إدارةٍ فيها صاحبُ الدور`);
}
export function bundleAction(db,supplied,bundleId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields={close_bundle:['note'],cancel_bundle:['note'],refresh_clearance:[]}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const b=bundleRow(db,u,bundleId);v.version(input.version,b.version);
  if(!manages(db,u))fail(403,'not_permitted','قرارات الحزمة لمن يملك تصريح التوظيف والتهيئة');
  if(b.status!=='open')fail(409,'bundle_settled','الحزمة مغلقة أو ملغاة');
  if(b.employee_id===u.id)fail(403,'separation_of_duties','صاحب الرحلة لا يقرر فيها');
  const time=now();
  if(action==='refresh_clearance'){
    if(b.kind!=='offboarding')fail(409,'not_offboarding','إخلاء الطرف لحزم المغادرة');
    const created=insertClearance(db,u,b,deriveClearance(db,u.tenant_id,b.employee_id));
    db.prepare('UPDATE lifecycle_bundles SET version=version+1,updated_at=? WHERE id=?').run(time,b.id);
    audit(db,u,'lifecycle_bundle',b.id,'lifecycle.clearance_refreshed',{version:b.version},{version:b.version+1,added:created});
    return {id:b.id,added:created};
  }
  const note=v.text(input.note,action==='close_bundle'?'دليل إغلاق الحزمة':'سبب الإلغاء',2000,10);
  if(action==='close_bundle'){
    const open=db.prepare("SELECT COUNT(*) AS n FROM lifecycle_steps WHERE bundle_id=? AND status='open'").get(b.id).n;
    if(open)fail(409,'steps_open',`لا تُغلق الحزمة وبها ${open} خطوة مفتوحة`);
    const items=db.prepare("SELECT COUNT(*) AS n FROM lifecycle_clearance_items WHERE bundle_id=? AND status='open'").get(b.id).n;
    if(items)fail(409,'clearance_open',`لا تُغلق حزمة المغادرة و${items} بندًا من إخلاء الطرف مفتوح`);
    const live=b.kind==='offboarding'?deriveClearance(db,u.tenant_id,b.employee_id).filter(r=>r.financial).length:0;
    const cleared=db.prepare("SELECT COUNT(*) AS n FROM lifecycle_clearance_items WHERE bundle_id=? AND financial=1 AND status='cleared'").get(b.id).n;
    if(live>cleared)fail(409,'clearance_stale','ظهرت التزامات مالية جديدة بعد فتح الحزمة؛ حدّث قائمة الإخلاء أولًا');
  }
  const status=action==='close_bundle'?'closed':'cancelled';
  db.prepare('UPDATE lifecycle_bundles SET status=?,closed_by=?,closed_at=?,close_note=?,version=version+1,updated_at=? WHERE id=?').run(status,u.id,time,note,time,b.id);
  audit(db,u,'lifecycle_bundle',b.id,'lifecycle.bundle_'+status,{status:'open',version:b.version},{status,version:b.version+1},note);
  return {id:b.id,status};
}

// ————— الخطوة —————

function stepRow(db,u,stepId){
  const s=db.prepare('SELECT * FROM lifecycle_steps WHERE id=? AND tenant_id=?').get(stepId,u.tenant_id);
  if(!s)fail(404,'not_found','الخطوة غير متاحة');
  return s;
}
// خطوة معلّقة باعتمادية تُعرض بحالتها وسببها ولا تختفي. الاعتمادية الملغاة بسبب موثق لا تُجمّد الرحلة.
function blockedBy(db,step){
  if(!step.depends_on)return null;
  const parent=db.prepare('SELECT id,title,status FROM lifecycle_steps WHERE id=?').get(step.depends_on);
  return parent&&parent.status==='open'?parent:null;
}
export function stepAction(db,supplied,stepId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields={close_step:['evidence'],cancel_step:['evidence'],decide_late_step:['note','new_due_date','new_owner_id']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const s=stepRow(db,u,stepId);v.version(input.version,s.version);
  const b=bundleRow(db,u,s.bundle_id);
  if(b.status!=='open')fail(409,'bundle_settled','الحزمة مغلقة أو ملغاة');
  if(s.status!=='open')fail(409,'step_settled','الخطوة مغلقة أو ملغاة');
  if(s.employee_id===u.id)fail(403,'separation_of_duties','صاحب الرحلة لا يغلق خطوات رحلته');
  const time=now();
  if(action==='decide_late_step'){
    if(b.owner_id!==u.id&&!manages(db,u))fail(403,'not_permitted','قرار الخطوة المتأخرة لمالك الحزمة');
    if(s.due_date>=today())fail(409,'not_late','الخطوة لم تتجاوز مدتها المستهدفة');
    const note=v.text(input.note,'قرار مالك الحزمة في التأخر',2000,10);
    const due=input.new_due_date?v.date(input.new_due_date):null;
    if(due&&due<today())fail(400,'new_due_date','الموعد الجديد يسبق اليوم في الرياض');
    let owner=null;
    if(input.new_owner_id){
      const row=db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=? AND department_id=? AND role=? AND active=1 AND id<>?').get(input.new_owner_id,u.tenant_id,s.department_id,db.prepare('SELECT owner_role FROM lifecycle_step_templates WHERE id=?').get(s.template_id).owner_role,s.employee_id);
      if(!row)fail(400,'new_owner_id','المالك البديل يجب أن يكون حسابًا نشطًا بالدور نفسه في إدارة الخطوة، وليس صاحب الرحلة');
      owner=row.id;
    }
    db.prepare('INSERT INTO lifecycle_escalations(id,tenant_id,bundle_id,step_id,note,new_due_date,new_owner_id,decided_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id(),u.tenant_id,b.id,s.id,note,due,owner,u.id,time);
    db.prepare('UPDATE lifecycle_steps SET due_date=?,owner_id=?,version=version+1,updated_at=? WHERE id=?').run(due??s.due_date,owner??s.owner_id,time,s.id);
    audit(db,u,'lifecycle_step',s.id,'lifecycle.step_escalated',{due_date:s.due_date,owner_id:s.owner_id},{due_date:due??s.due_date,owner_id:owner??s.owner_id},note);
    return {id:s.id,due_date:due??s.due_date};
  }
  const evidence=v.text(input.evidence,action==='close_step'?'دليل إنجاز الخطوة ومطابقته لمعيار القبول':'سبب إلغاء الخطوة',3000,10);
  if(action==='cancel_step'){
    if(!manages(db,u))fail(403,'not_permitted','إلغاء خطوة لمن يملك تصريح التوظيف والتهيئة');
  }else{
    if(s.owner_id!==u.id)fail(403,'not_permitted','يغلق الخطوة مالكها المسمى فيها');
    const blocker=blockedBy(db,s);
    if(blocker)fail(409,'dependency_open',`هذه الخطوة تنتظر «${blocker.title}»؛ لا تبدأ قبل إغلاقها`);
  }
  const status=action==='close_step'?'done':'cancelled';
  db.prepare('UPDATE lifecycle_steps SET status=?,evidence=?,closed_by=?,closed_at=?,version=version+1,updated_at=? WHERE id=?').run(status,evidence,u.id,time,time,s.id);
  audit(db,u,'lifecycle_step',s.id,'lifecycle.step_'+status,{status:'open',version:s.version},{status,version:s.version+1},evidence);
  return {id:s.id,status};
}

// ————— بنود الإخلاء —————

export function clearItem(db,supplied,itemId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','evidence']);
  const item=db.prepare('SELECT * FROM lifecycle_clearance_items WHERE id=? AND tenant_id=?').get(itemId,u.tenant_id);
  if(!item)fail(404,'not_found','بند الإخلاء غير متاح');
  v.version(input.version,item.version);
  const b=bundleRow(db,u,item.bundle_id);
  if(b.status!=='open')fail(409,'bundle_settled','الحزمة مغلقة أو ملغاة');
  if(item.status!=='open')fail(409,'item_cleared','البند مغلق');
  // القاعدة الجوهرية، وهي مفروضة أيضًا بـCHECK في قاعدة البيانات.
  if(item.employee_id===u.id)fail(403,'self_clearance','لا يخلي أحد طرف نفسه');
  if(!manages(db,u)&&b.owner_id!==u.id)fail(403,'not_permitted','إغلاق بند الإخلاء لمالك الحزمة أو لمن يملك تصريح التوظيف والتهيئة');
  // البند المالي لا يُغلق بنص حر: مصدره يجب أن يكون مقفلًا فعلًا في المالية (العهدة مسوّاة، السلفة مسددة، الأصل منقول،
  // المعدة مستلمة) — أي أن اشتقاق الإخلاء الحي لم يعد يولّده — أو يقرّه حامل تصريح رواتب أو مالية بمسؤوليته.
  if(item.financial===1){
    const live=deriveClearance(db,u.tenant_id,item.employee_id).some(r=>r.financial&&r.source===item.source&&r.source_id===item.source_id);
    if(live&&!holdsAny(db,u,FINANCE_CAPS))fail(409,'source_open','الالتزام المالي ما زال قائمًا في مصدره. يُقفل أولًا في شاشته المالية، أو يقرّ إغلاقه حامل تصريح الرواتب أو المالية');
  }
  const evidence=v.text(input.evidence,'دليل إغلاق البند: المستند ومن نفّذ ومتى',3000,10),time=now();
  db.prepare("UPDATE lifecycle_clearance_items SET status='cleared',evidence=?,cleared_by=?,cleared_at=?,version=version+1,updated_at=? WHERE id=?").run(evidence,u.id,time,time,item.id);
  audit(db,u,'lifecycle_clearance_item',item.id,'lifecycle.clearance_cleared',{status:'open',version:item.version},{status:'cleared',version:item.version+1,source:item.source},evidence);
  return {id:item.id,status:'cleared'};
}

// موانع التسوية النهائية. قراءة صرفة يستدعيها المنسّق من مسار التسوية القائم قبل الاعتماد.
// تقارن الالتزامات المالية الحيّة الآن بما أُغلق فعلًا بدليله، فلا يُتجاوز المنع بترك القائمة قديمة.
export function clearanceBlockers(db,supplied,employeeId){
  const u=actor(db,supplied);
  // الموظف من كيان القارئ وإلا فهو غير موجود بالنسبة له.
  const employee=typeof employeeId==='string'&&db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=?').get(employeeId,u.tenant_id);
  if(!employee)fail(404,'not_found','الموظف غير متاح');
  const bundle=db.prepare("SELECT * FROM lifecycle_bundles WHERE tenant_id=? AND employee_id=? AND kind='offboarding' ORDER BY created_at DESC,id LIMIT 1").get(u.tenant_id,employeeId)??null;
  // الموانع المالية بيانات مالية شخصية: لمالك حزمة المغادرة، أو حامل تصريح التوظيف والتهيئة، أو حامل تصريح الرواتب.
  // غيرهم لا يعرف حتى أن للموظف حزمة: «غير متاح» لا «ممنوع».
  if(!(bundle&&bundle.owner_id===u.id)&&!holds(db,u,'people.manage')&&!holdsAny(db,u,PAYROLL_CAPS))fail(404,'not_found','الموظف غير متاح');
  if(!bundle)return {employee_id:employeeId,bundle_id:null,blocked:true,blockers:[{source:'bundle',source_id:employeeId,title:'لا حزمة مغادرة مفتوحة لهذا الموظف',reason:'no_bundle',amount_minor:null,action_owner:'الموارد البشرية: فتح حزمة المغادرة من شاشة «رحلة الموظف»'}],
    note:'لم تُفتح حزمة مغادرة لهذا الموظف، فلا إخلاء طرف تحقّقت منه المنصة. افتح الحزمة وأغلق بنودها المالية قبل اعتماد التسوية.'};
  const items=db.prepare('SELECT * FROM lifecycle_clearance_items WHERE bundle_id=?').all(bundle.id);
  const cleared=new Set(items.filter(i=>i.status==='cleared').map(i=>`${i.source}:${i.source_id}`));
  // الاشتقاق الحي يحمل مالك الفعل لكل بند: الرفض يقول ما بقي ومن يقفله، لا «هناك موانع» وحدها.
  const live=deriveClearance(db,u.tenant_id,employeeId).filter(r=>r.financial);
  const ownerOf=(source,sourceId)=>live.find(r=>r.source===source&&r.source_id===String(sourceId))?.action_owner??null;
  const blockers=[];
  for(const i of items.filter(i=>i.financial===1&&i.status==='open'))
    blockers.push({source:i.source,source_id:i.source_id,title:i.title,reason:'item_open',amount_minor:i.amount_minor,action_owner:ownerOf(i.source,i.source_id)});
  for(const row of live)
    if(!cleared.has(`${row.source}:${row.source_id}`)&&!blockers.some(b=>b.source===row.source&&b.source_id===row.source_id))
      blockers.push({source:row.source,source_id:row.source_id,title:row.title,reason:'not_recorded',amount_minor:row.amount_minor,action_owner:row.action_owner});
  return {employee_id:employeeId,bundle_id:bundle.id,blocked:blockers.length>0,blockers,
    note:blockers.length?'بنود إخلاء طرف مالية لم تُغلق بدليلها. التسوية النهائية لا تُعتمد قبل إغلاقها.':'كل البنود المالية في إخلاء الطرف مغلقة بدليلها.'};
}

// ————— اللوحات —————

function bundleView(db,u,b,capable){
  const steps=db.prepare('SELECT * FROM lifecycle_steps WHERE bundle_id=? ORDER BY created_at,id').all(b.id);
  const escalations=db.prepare('SELECT * FROM lifecycle_escalations WHERE bundle_id=? ORDER BY created_at').all(b.id);
  const day=today(),owner=b.owner_id===u.id;
  const view=steps.map(s=>{
    const blocker=blockedBy(db,s),late=s.status==='open'&&s.due_date<day,actions=[];
    if(b.status==='open'&&s.status==='open'&&s.employee_id!==u.id){
      if(s.owner_id===u.id&&!blocker)actions.push('close_step');
      if(capable)actions.push('cancel_step');
      if(late&&(owner||capable))actions.push('decide_late_step');
    }
    return {...s,owner_name:person(db,s.owner_id),closed_by_name:person(db,s.closed_by),
      blocked:!!blocker,blocked_reason:blocker?`بانتظار «${blocker.title}»`:'',late,
      escalations:escalations.filter(e=>e.step_id===s.id).map(e=>({...e,decided_by_name:person(db,e.decided_by)})),actions};
  });
  const counted=view.filter(s=>s.status!=='cancelled');
  const done=counted.filter(s=>s.status==='done').length;
  const money=seesMoney(db,u,b);
  const allItems=db.prepare('SELECT * FROM lifecycle_clearance_items WHERE bundle_id=? ORDER BY financial DESC,created_at').all(b.id);
  // مالكو الخطوات وصاحب الرحلة يرون البنود غير المالية فقط، بلا مبالغ.
  const items=allItems.filter(i=>money||i.financial!==1).map(i=>({
    ...i,amount_minor:money?i.amount_minor:null,cleared_by_name:person(db,i.cleared_by),
    actions:b.status==='open'&&i.status==='open'&&i.employee_id!==u.id&&(capable||owner)?['verify_clearance']:[]}));
  const actions=[];
  if(b.status==='open'&&capable&&b.employee_id!==u.id){
    if(b.kind==='offboarding')actions.push('refresh_clearance');
    if(!counted.some(s=>s.status==='open')&&!allItems.some(i=>i.status==='open'))actions.push('close_bundle');
    actions.push('cancel_bundle');
  }
  return {...b,kind_name:kindName(b.kind),employee_name:person(db,b.employee_id),owner_name:person(db,b.owner_id),
    opened_by_name:person(db,b.opened_by),closed_by_name:person(db,b.closed_by),
    steps:view,clearance:items,actions,
    progress:{total:counted.length,done,late:view.filter(s=>s.late).length,blocked:view.filter(s=>s.blocked&&s.status==='open').length,
      percent:counted.length?Math.round(done*100/counted.length):0,
      open_financial:money?allItems.filter(i=>i.financial===1&&i.status==='open').length:null}};
}
function visibleBundles(db,u,capable){
  const all=db.prepare('SELECT * FROM lifecycle_bundles WHERE tenant_id=? ORDER BY created_at DESC,id').all(u.tenant_id);
  if(capable)return all;
  return all.filter(b=>b.owner_id===u.id||b.employee_id===u.id
    ||db.prepare('SELECT 1 FROM lifecycle_steps WHERE bundle_id=? AND owner_id=?').get(b.id,u.id));
}
export function lifecycleBoard(db,supplied){
  const u=actor(db,supplied),capable=manages(db,u);
  const templates=db.prepare('SELECT * FROM lifecycle_step_templates WHERE tenant_id=? ORDER BY kind,created_at,id').all(u.tenant_id).map(t=>({
    ...t,department_name:db.prepare('SELECT name FROM departments WHERE id=?').get(t.department_id)?.name??t.department_id,
    defined_by_name:person(db,t.defined_by),depends_on_title:t.depends_on?db.prepare('SELECT title FROM lifecycle_step_templates WHERE id=?').get(t.depends_on)?.title??'':'',
    actions:ownsProcess(db,u,t.department_id)?['edit_template']:[]}));
  const bundles=visibleBundles(db,u,capable).map(b=>bundleView(db,u,b,capable));
  const departments=db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id);
  return {today:today(),user_id:u.id,kinds:KINDS,owner_roles:OWNER_ROLES,departments,
    can_manage:capable,can_define:departments.some(d=>ownsProcess(db,u,d.id)),
    templates,bundles,
    employees:capable?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id):[],
    totals:{open:bundles.filter(b=>b.status==='open').length,late:bundles.reduce((n,b)=>n+b.progress.late,0),
      templates:templates.filter(t=>t.active).length},
    note:'رحلة واحدة لموظف يبدأ أو يغادر، خطواتها قالب يضعه مالك إجراء كل إدارة — تبدأ فارغة لأن المنصة لا تعرف خطوات إدارتك. نسبة الاكتمال من الخطوات المغلقة بدليلها لا من تقدير. المنصة لا تسحب صلاحية ولا تعطّل حسابًا ولا تُرجع عهدة: تُظهر ما يجب فعله ومن يفعله، والتنفيذ فعل بشري يُسجَّل في شاشته. ولا تفترض مدة إشعار ولا مهلة نظامية: تاريخ المباشرة أو آخر يوم عمل إدخال بسنده.'};
}
export function clearanceBoard(db,supplied){
  const u=actor(db,supplied),capable=manages(db,u);
  const bundles=visibleBundles(db,u,capable).filter(b=>b.kind==='offboarding').map(b=>bundleView(db,u,b,capable));
  const open=bundles.filter(b=>b.status==='open');
  return {today:today(),user_id:u.id,can_manage:capable,bundles,
    sources:[{name:'العهد النقدية',table:'custodies'},{name:'الأصول الثابتة',table:'fixed_assets'},{name:'المعدات المسلَّمة',table:'equipment_bookings'},
      {name:'السلف غير المسددة',table:'salary_advances'},{name:'الصلاحيات النشطة',table:'access_grants'},{name:'الحساب',table:'users'},
      {name:'الطلبات والمهام والاعتمادات المعلقة',table:'requests / request_tasks / tasks / approval_steps'},{name:'التفويضات السارية',table:'approval_delegations'},{name:'عضوية المشاريع',table:'project_members'}],
    totals:{open_bundles:open.length,open_items:open.reduce((n,b)=>n+b.clearance.filter(i=>i.status==='open').length,0),
      open_financial:open.reduce((n,b)=>n+b.progress.open_financial,0)},
    note:'قائمة الإخلاء تُبنى آليًا مما تعرفه المنصة فعلًا عن هذا الشخص من جداولها القائمة، لا من قالب عام. كل بند يُغلق بدليل ومن شخص آخر غير المغادر — قاعدة مفروضة بـCHECK في قاعدة البيانات لا بالاتفاق. البنود المالية تمنع اعتماد التسوية النهائية حتى تُغلق. المنصة تُظهر الصلاحيات والحسابات النشطة ولا تسحب ولا تعطّل شيئًا آليًا.'};
}
