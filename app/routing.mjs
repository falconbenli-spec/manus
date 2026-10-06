import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { getRequest, catalog, serviceOf, notifyUser, isHandler, executorsFor, executionChain } from './workflow.mjs';
import { clockFor } from './work-calendar.mjs';
import { targetProvenance } from './service-target.mjs';
import { visibleSql, hiddenServiceCodes, lastDecision, audiencesFor, gatesFor, currentGates } from './service-availability.mjs';
export { clockFor };

// Routing between departments, task assignment inside a request, and the service level clock.
const id=()=>randomUUID();
const MAX_TRANSFERS=3;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const handlingDepartment=(db,r)=>r.handling_department_id??serviceOf(db,r).department_id;

function actor(db,u){const current=currentUser(db,u);if(!current)fail(403,'forbidden','الحساب غير متاح');return current;}
// من ينفّذ الطلب يقرره محرك الاعتماد وحده (workflow.isHandler): دور المنفذ في الإدارة المنفذة،
// و'member' يعني أي عضو نشط فيها، والمستفيد وصاحب الطلب مستبعدان. المقارنة الحرفية بالدور كانت تعطّل الاثنين.
const executing=(db,u,r)=>isHandler(db,u,r);
export function targetDays(db,r){
  const service=serviceOf(db,r);
  return db.prepare('SELECT target_days FROM service_directory WHERE tenant_id=? AND service_code=?').get(r.tenant_id,service.code)?.target_days??0;
}
// زمن الخدمة: أيام عمل، أو ساعات عمل لخدمة لا تحتمل التأجيل (ترحيل 115). الساعات، حين تُحدَّد، هي المقياس.
export function serviceTarget(db,r){
  const service=serviceOf(db,r);
  const row=db.prepare('SELECT target_days,target_hours FROM service_directory WHERE tenant_id=? AND service_code=?').get(r.tenant_id,service.code);
  return {days:row?.target_days??0,hours:row?.target_hours??0};
}
// الساعة ومصدرها معًا. تاريخ الاستحقاق وحده يُقرأ وعدًا، ولم يقطعه أحد ما دام الزمن مشتقًا من بادئة الرمز:
// فيسافر `target` مع كل ساعة إلى كل شاشة تعرضها (app/service-target.mjs).
export const serviceClock=(db,r)=>{
  const target=targetProvenance(db,r.tenant_id,serviceOf(db,r).code);
  return {...clockFor(db,r,{days:target.days,hours:target.hours}),target};
};

export function listTransfers(db,r){
  return db.prepare('SELECT t.*,u.name AS actor_name FROM request_transfers t JOIN users u ON u.id=t.actor_id WHERE request_id=? ORDER BY created_at,id').all(r.id);
}
export function transferRequest(db,supplied,rid,input){
  if(!db.isTransaction)fail(500,'transaction_required','يلزم تنفيذ التحويل داخل معاملة');
  const u=actor(db,supplied);
  v.object(input,['version','department_id','reason']);
  const r=getRequest(db,u,rid);v.version(input.version,r.version);
  if(!['approved','in_progress'].includes(r.status))fail(409,'transfer_unavailable','التحويل متاح بعد الاعتماد وقبل الإغلاق');
  if(!executing(db,u,r))fail(403,'forbidden','التحويل متاح للإدارة المنفذة الحالية');
  const from=handlingDepartment(db,r);
  if(input.department_id===from)fail(400,'same_department','اختر إدارة مختلفة');
  const target=db.prepare('SELECT * FROM departments WHERE id=? AND tenant_id=? AND active=1').get(input.department_id,u.tenant_id);
  if(!target)fail(400,'department','الإدارة غير موجودة أو مؤرشفة');
  const service=serviceOf(db,r);
  const receiver=executorsFor(db,service,target.id,u.tenant_id);
  if(!receiver.length)fail(409,'no_receiver','لا يوجد في الإدارة المستقبِلة حساب نشط بدور المنفذ لهذه الخدمة');
  if(listTransfers(db,r).length>=MAX_TRANSFERS)fail(409,'transfer_limit',`لا يحول الطلب أكثر من ${MAX_TRANSFERS} مرات؛ صعّده بدل تدويره`);
  if(db.prepare('SELECT 1 FROM request_tasks WHERE request_id=? AND status=?').get(r.id,'open'))fail(409,'open_tasks','أغلق المهام المفتوحة أو ألغها قبل التحويل');
  const reason=v.text(input.reason,'سبب التحويل',1000,3),time=now();
  db.prepare('INSERT INTO request_transfers VALUES(?,?,?,?,?,?,?,?)').run(id(),u.tenant_id,r.id,from,target.id,reason,u.id,time);
  db.prepare("UPDATE requests SET handling_department_id=?,assigned_to=NULL,status='approved',version=version+1,updated_at=? WHERE id=?").run(target.id,time,r.id);
  for(const person of receiver)notifyUser(db,person.id,r.id,'request_transferred');
  notifyUser(db,r.requester_id,r.id,'request_transferred');
  audit(db,u,'request',r.id,'request.transferred',{department_id:from,status:r.status},{department_id:target.id,status:'approved'},reason);
  return getRequest(db,u,r.id);
}

export function listRequestTasks(db,r){
  return db.prepare('SELECT t.*,u.name AS assignee_name FROM request_tasks t JOIN users u ON u.id=t.assignee_id WHERE request_id=? ORDER BY due_date,created_at').all(r.id);
}
export function assignRequestTask(db,supplied,rid,input){
  if(!db.isTransaction)fail(500,'transaction_required','يلزم تنفيذ الإسناد داخل معاملة');
  const u=actor(db,supplied);
  v.object(input,['version','title','assignee_id','due_date','acceptance']);
  const r=getRequest(db,u,rid);v.version(input.version,r.version);
  if(!['approved','in_progress'].includes(r.status))fail(409,'tasks_unavailable','إسناد المهام متاح بعد الاعتماد وقبل الإغلاق');
  if(!executing(db,u,r))fail(403,'forbidden','إسناد المهام متاح للإدارة المنفذة');
  const department=handlingDepartment(db,r);
  const assignee=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND department_id=? AND active=1').get(input.assignee_id,u.tenant_id,department);
  if(!assignee)fail(400,'assignee','المكلف يجب أن يكون حسابًا نشطًا في الإدارة المنفذة');
  if(db.prepare("SELECT COUNT(*) AS n FROM request_tasks WHERE request_id=? AND status='open'").get(r.id).n>=20)fail(409,'task_limit','الحد عشرون مهمة مفتوحة للطلب');
  const due=v.date(input.due_date);
  if(due<today())fail(400,'past_date','موعد المهمة يسبق اليوم في الرياض');
  const task=id(),time=now();
  db.prepare("INSERT INTO request_tasks(id,tenant_id,request_id,title,assignee_id,due_date,acceptance,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(task,u.tenant_id,r.id,v.text(input.title,'المهمة',180,3),assignee.id,due,v.text(input.acceptance,'معيار القبول',2000,3),u.id,time);
  // إسناد المهمة لا يجعل المُسنِد مباشرًا للطلب ما لم يكن هو ممن ينفّذه فعلًا.
  //
  // بوابة هذه الدالة isHandler — دورٌ وإدارة بلا فصل مهام — وهي أوسع من سلسلة التنفيذ التي تُبنى عليها
  // إتاحة «استلام» و«إنهاء» في workflow.actions. فمديرُ إدارةٍ اعتمد خدمةً معلَّمة sod يمر من هنا ولا يمر
  // من هناك؛ وكان COALESCE يسجّله مباشرًا للطلب ويخرجه من «معتمد»، فيسقط «استلام» (يشترط «معتمد») ويسقط
  // «إنهاء» (يشترط أن يكون المباشر داخل السلسلة). فلا هو ينهيه ولا غيره يستلمه: جمود لا فكاك منه إلا
  // بتحويل الطلب إلى إدارة أخرى — وهو آخر ما يُفعل بطلب معلَّم سريًا.
  //
  // فالمباشرة تُكتب لمن يملكها: إن كان المُسنِد في السلسلة بقي السلوك كما كان، وإلا بقي الطلب «معتمدًا»
  // قابلًا لاستلام من تسمّيه السلسلة، والمهمة مسندة ومُشعَرٌ بها كما هي.
  const mine=executionChain(db,serviceOf(db,r),r).people.some(p=>p.id===u.id);
  if(mine)db.prepare("UPDATE requests SET status='in_progress',assigned_to=COALESCE(assigned_to,?),version=version+1,updated_at=? WHERE id=?").run(u.id,time,r.id);
  else db.prepare("UPDATE requests SET version=version+1,updated_at=? WHERE id=?").run(time,r.id);
  notifyUser(db,assignee.id,r.id,'task_assigned');
  audit(db,u,'request',r.id,'request.task_assigned',{}, {task_id:task,assignee_id:assignee.id,due_date:due});
  return getRequest(db,u,r.id);
}
export function settleRequestTask(db,supplied,rid,taskId,input){
  if(!db.isTransaction)fail(500,'transaction_required','يلزم تنفيذ الإغلاق داخل معاملة');
  const u=actor(db,supplied);
  v.object(input,['version','evidence','action']);
  const r=getRequest(db,u,rid);v.version(input.version,r.version);
  const task=db.prepare("SELECT * FROM request_tasks WHERE id=? AND request_id=? AND status='open'").get(taskId,r.id);
  if(!task)fail(404,'not_found','المهمة غير متاحة');
  const action=['complete','cancel'].includes(input.action)?input.action:fail(400,'action','الفعل غير مسموح');
  if(action==='complete'&&task.assignee_id!==u.id)fail(403,'forbidden','يكمل المهمة من أُسندت إليه');
  if(action==='cancel'&&!(executing(db,u,r)||task.created_by===u.id))fail(403,'forbidden','يلغي المهمة من أسندها أو الإدارة المنفذة');
  const evidence=v.text(input.evidence,action==='complete'?'دليل الإنجاز':'سبب الإلغاء',3000,3),time=now();
  db.prepare('UPDATE request_tasks SET status=?,evidence=?,settled_at=? WHERE id=?').run(action==='complete'?'completed':'cancelled',evidence,time,taskId);
  db.prepare('UPDATE requests SET version=version+1,updated_at=? WHERE id=?').run(time,r.id);
  notifyUser(db,task.created_by,r.id,action==='complete'?'task_completed':'task_cancelled');
  audit(db,u,'request',r.id,`request.task_${action}`,{task_id:taskId,status:'open'},{task_id:taskId,status:action==='complete'?'completed':'cancelled'},evidence);
  return getRequest(db,u,r.id);
}
export const openTaskCount=(db,rid)=>db.prepare("SELECT COUNT(*) AS n FROM request_tasks WHERE request_id=? AND status='open'").get(rid).n;

export function myTasks(db,u){
  return db.prepare(`SELECT t.*,r.title AS request_title,r.id AS request_id FROM request_tasks t JOIN requests r ON r.id=t.request_id
    WHERE t.tenant_id=? AND t.assignee_id=? AND t.status='open' ORDER BY t.due_date`).all(u.tenant_id,u.id)
    .map(t=>({...t,overdue:t.due_date<today()}));
}

export function transferTargets(db,u,r){
  const service=serviceOf(db,r),current=handlingDepartment(db,r);
  // لا تُعرض إدارة لا منفذ فيها لهذه الخدمة؛ والمنفذ يحدده المحرك لا مقارنة الدور نصًا.
  return db.prepare('SELECT d.id,d.name FROM departments d WHERE d.tenant_id=? AND d.active=1 AND d.id<>? ORDER BY d.name')
    .all(u.tenant_id,current).filter(d=>executorsFor(db,service,d.id,u.tenant_id).length);
}
export function departmentTeam(db,u,r){
  return db.prepare('SELECT id,name,role FROM users WHERE tenant_id=? AND department_id=? AND active=1 ORDER BY name')
    .all(u.tenant_id,handlingDepartment(db,r));
}

// الخدمات التي طلبها هذا الشخص فعلًا، الأكثر فالأحدث. لا قائمة ثابتة في الكود: من لا تاريخ له لا يُقترح عليه شيء،
// والخدمة التي أُوقفت تبقى في تاريخه معلَّمة «غير متاحة» ولا يُفتح منها طلب.
export function usedServices(db,u,limit=5){
  // التجميع بالرمز وحده (الدفعة الثالثة من مركز الخدمات): بعد إعادة تسمية الخدمة يشير طلبٌ قديم إلى نسخةٍ اسمُها القديم،
  // فكان التجميع بالاسم يشقّ الرمز الواحد صفّين («طلبتها 3 مرات» تُقرأ 2+1). الاسم من أحدث نسخة وحدها.
  const history=db.prepare(`SELECT s.code,COUNT(*) AS uses,MAX(r.created_at) AS last_at
    FROM requests r JOIN services s ON s.id=r.service_id WHERE r.tenant_id=? AND r.requester_id=?
    GROUP BY s.code ORDER BY uses DESC,last_at DESC LIMIT ?`).all(u.tenant_id,u.id,limit)
    .map(h=>({...h,name:db.prepare('SELECT name_ar FROM services WHERE tenant_id=? AND code=? ORDER BY version DESC LIMIT 1').get(u.tenant_id,h.code)?.name_ar??h.code}));
  // مرشّح المفتاح (ترحيل 129) هنا كما هو في الدليل: هذا الاستعلام لا يمرّ بـcatalog، فبدونه يبقى الزر السريع
  // في الرئيسية وفي مساحة العمل يفتح طلبًا على خدمة أوقفها المالك، ولا يردّه إلا رفض الخادم بعد الضغط.
  const live=db.prepare(`SELECT s.id,s.department_id FROM services s WHERE s.tenant_id=? AND s.code=? AND s.active=1 AND ${visibleSql('s','code','service',audiencesFor(u),gatesFor(db,u))} ORDER BY s.version DESC LIMIT 1`);
  const hidden=hiddenServiceCodes(db,u.tenant_id);
  // وشرط الأهلية (138) سببٌ ثالث مستقل: خدمةٌ طلبها الموظف بالأمس ثم وُضع عليها شرطٌ ليس فيه ليست
  // «موقوفة» ولا «مسحوبة النسخة» — هي قائمة في الدليل ومشروطة، ويُقال له ذلك باسم الشرط لا بفراغ.
  const gates=currentGates(db,u.tenant_id);
  return history.map(h=>{const now=live.get(u.tenant_id,h.code)??null;
    // السبب يُقال لا يُترك فراغًا: «موقوفة» غير «سُحبت نسختها»، والفرق يهم من طلبها بالأمس.
    const stopped=hidden.has(h.code)?lastDecision(db,u.tenant_id,'service',h.code):null;
    const gate=!now&&!stopped?gates.get(h.code)??null:null;
    return {code:h.code,name:h.name,uses:h.uses,last_at:h.last_at,service_id:now?.id??null,department_id:now?.department_id??null,available:!!now,
      hidden:!!stopped,gated:!!gate,
      unavailable_reason:stopped?`موقوفة من إعدادات الخدمات: ${stopped.reason}`
        :gate?`مشروطة وما ينطبق عليك شرطها: ${gate.basis}`:now?null:'لم تعد في دليل الخدمات'};});
}
export function portal(db,supplied,{requests,projects,leave}){
  const u=actor(db,supplied);
  const services=catalog(db,u);
  const departmentNames=new Map(db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1').all(u.tenant_id).map(row=>[row.id,row.name]));
  const mine=requests.filter(r=>r.requester_id===u.id);
  const counts={};
  for(const r of mine)counts[r.status]=(counts[r.status]??0)+1;
  const department=db.prepare('SELECT id,name,sector FROM departments WHERE id=? AND tenant_id=?').get(u.department_id,u.tenant_id);
  const departmentServices=services.filter(s=>s.department_id===u.department_id);
  // الخدمات السريعة من تاريخ طلبات الشخص نفسه (كانت قائمة من ثمانية رموز مكتوبة هنا تُعرض على الجميع سواء).
  const quick=usedServices(db,u,6).filter(h=>h.available).map(h=>services.find(s=>s.id===h.service_id)).filter(Boolean);
  const statutoryLeave=leave?.statutory?.balances??[];
  const leaveBalances=statutoryLeave.length?statutoryLeave.map(balance=>({
    type:balance.name_ar,type_code:balance.code,remaining:balance.available_days,posted:balance.entitled_days,reserved:balance.reserved_days,
    year:leave.statutory.year,unit_name:balance.unit_name,color:balance.experience?.color??'#64748B',icon:balance.experience?.icon??'calendar',
    order:balance.experience?.order??999,source_link:balance.experience?.source_link??null,
    ...(balance.compensatory?{available_hours:balance.compensatory.available_hours,next_expiry:balance.compensatory.next_expiry}:{}),note:balance.note??null
  })):(leave?.balances?.filter(b=>b.employee_id===u.id).map(b=>({type:b.leave_type_name??b.leave_type,type_code:b.leave_type,remaining:b.available_days,posted:b.posted_days,reserved:b.reserved_days,year:b.balance_year,unit_name:'يوم',color:'#64748B',icon:'calendar',order:999,source_link:null,note:null}))??[]);
  const employeePortal=[
    {key:'profile',label:'بياناتي',description:'بياناتي الوظيفية والشخصية',href:'#profile',icon:'person'},
    {key:'attendance',label:'الحضور',description:'الدوام والتصحيحات والعمل الإضافي',href:'#attendance',icon:'clock'},
    {key:'leave',label:'الإجازات',description:'الأرصدة والطلبات ومسار الاعتماد',href:'#leave',icon:'calendar'},
    {key:'letters',label:'خطاباتي',description:'تعريف الراتب والعمل والخطابات',href:'#letters',icon:'document'},
    {key:'benefits',label:'مزاياي',description:'المزايا والتغطيات والاستحقاقات',href:'#my-benefits',icon:'heart'},
    {key:'payroll',label:'الراتب',description:'العقد والراتب والقسائم',href:'#payroll',icon:'wallet'},
    {key:'discipline',label:'السجل الوظيفي',description:'الإقرارات والمخالفات والجزاءات',href:'#my-discipline',icon:'shield'},
    {key:'requests',label:'طلباتي',description:'كل طلباتي وحالاتها',href:'#my-requests',icon:'list'}
  ];
  // واجهة HCM مرجعٌ لترتيب الطلبات وخياراتها فقط. كل بطاقة مشتقة من خدمة حقيقية مسموحة لهذا الحساب.
  const serviceByCode=new Map(services.map(service=>[service.code,service]));
  const choiceLabels=service=>{
    const select=(service?.fields??[]).find(field=>field.type==='select'||field.type==='radio'||field.type==='choice');
    return (select?.options??[]).slice(0,4).map(option=>typeof option==='string'?option:option.label??option.value).filter(Boolean);
  };
  const requestSpecs=[
    {key:'leave',label:'طلب إجازة',description:'اختر نوع الإجازة وشوف رصيدك قبل الإرسال.',icon:'calendar',href:'#leave/new',choices:leaveBalances.slice(0,4).map(balance=>balance.type)},
    {key:'attendance',code:'HR-ATTENDANCE-FIX',label:'تصحيح الحضور',description:'صحّح بصمة أو وقت دوام مع السبب والمرفق.',icon:'clock'},
    {key:'overtime',code:'HR-OVERTIME',label:'عمل إضافي',description:'سجّل الساعات وسبب التكليف، وتابع اعتمادها.',icon:'plus'},
    {key:'travel',code:'ADM-TRAVEL',label:'مهمة عمل أو سفر',description:'ارفع المهمة بتواريخها ووجهتها واحتياجها.',icon:'plane'},
    {key:'salary_letter',code:'HR-SALARY-CERT',label:'تعريف بالراتب',description:'اختر الجهة واللغة ونوع الخطاب من نفس الطلب.',icon:'doc'},
    {key:'advance',code:'HR-SALARY-ADVANCE',label:'سلفة راتب',description:'حدّد المبلغ وسبب السلفة وخطة الاستقطاع.',icon:'banknote'},
    {key:'profile',code:'HR-PROFILE-UPDATE',label:'تحديث بياناتي',description:'حدّث بياناتك وارفق ما يثبت التغيير.',icon:'person'},
    {key:'training',code:'TAL-TRAINING',label:'طلب تدريب',description:'اختر البرنامج واربطه باحتياجك في العمل.',icon:'book'},
    {key:'benefits',code:'HR-BENEFIT-CLAIM',label:'مطالبة ميزة',description:'ارفع مطالبتك بالمبلغ والمستندات المطلوبة.',icon:'heart'},
    {key:'hr_contact',code:'HR-GRIEVANCE',label:'تواصل مع الموارد البشرية',description:'استفسار أو شكوى بسرية ومسار متابعة واضح.',icon:'message'},
    {key:'confidential_feedback',label:'بلاغ مجهول',description:'ارفع بلاغًا ما ينربط بحسابك، واحتفظ برمز المتابعة.',icon:'shield',href:'#hr-cases/anonymous',choices:['ما يظهر اسمك','رمز متابعة','ردود آمنة']},
    {key:'suggestion',code:'EXP-SUGGESTION',label:'اقتراح تحسين',description:'شارك فكرة عملية ووضح أثرها المتوقع.',icon:'star'}
  ];
  const employeeRequests=requestSpecs.map(spec=>{
    if(!spec.code)return spec;
    const service=serviceByCode.get(spec.code);
    if(!service)return null;
    return {...spec,service_id:service.id,href:`#catalog/new?service=${encodeURIComponent(service.id)}`,section:service.section??'خدمات الموظف',choices:choiceLabels(service)};
  }).filter(Boolean);
  return {
    me:{id:u.id,name:u.name,role:u.role,department},
    counts,
    open:mine.filter(r=>!['completed','cancelled','rejected'].includes(r.status)).slice(0,6),
    decisions:requests.filter(r=>r.needs_me).slice(0,6),
    tasks:myTasks(db,u),
    // بلا سقف: مهمة المشروع السابعة كانت تسقط بصمت. من يريد قائمة مختصرة يقطعها عند العرض ويقول كم بقي.
    project_tasks:projects.flatMap(p=>p.tasks.filter(t=>t.assignee_id===u.id&&t.status==='open').map(t=>({...t,project_name:p.name}))),
    // B4: الرصيد المتاح اسمه available_days في leave.mjs (المقيد ناقص المحجوز)؛ remaining_days لم يوجد قط فظهر صفرًا أو فراغًا.
    leave:leaveBalances,
    leave_ready:!!leave?.statutory?.ready,
    employee_portal:employeePortal,
    employee_requests:employeeRequests,
    quick_services:quick.map(s=>({id:s.id,code:s.code,name:s.name_ar,section:s.section,department_id:s.department_id})),
    department_services:departmentServices.map(s=>({id:s.id,code:s.code,name:s.name_ar,section:s.section})),
    // البوابة لا تحفظ قائمة خدمات ثانية تتقادم: تحمل بالضبط إسقاط الدليل المصرح لهذا الحساب.
    // الخدمة المحجوبة أو الموقوفة لا تصل هنا أصلًا، والخدمة الجديدة تظهر فور نشرها بلا تعديل واجهة.
    all_services:services.map(s=>({id:s.id,code:s.code,name:s.name_ar,section:s.section??'خدمات الإدارة',department_id:s.department_id,
      department_name:departmentNames.get(s.department_id)??s.department_id})),
    unread:db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL').get(u.id).n,
    catalog_size:services.length,
    // العدد المعروض هو ما يراه هذا الحساب فعلًا؛ وما أُوقف يُقال عدده بجواره لا يُطرح صامتًا.
    // بلا خدمة موقوفة يبقى صفرًا، فالشاشة ترسم ما كانت ترسمه حرفًا بحرف.
    catalog_hidden:hiddenServiceCodes(db,u.tenant_id).size
  };
}
