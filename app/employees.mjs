import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { returnDepartedWork } from './request-assignment.mjs';
import { refuse } from './refusal.mjs';
import { looksLikeIdentifier, NO_NATIONAL_ID } from './pii.mjs';
import { isPeopleOfficer, capabilityHolders } from './access.mjs';
import { personName, personPlacement, personProfile } from './people-read.mjs';

// السجل الوظيفي: ملف الموظف ووثائقه وتغييراته المؤرخة.
const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const riyadhDay=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
const EXPIRY_WINDOW=60;
const types=['national_id','iqama','work_permit','passport','contract','qualification','medical_insurance','other'];
const changeTypes=['job_title','department','manager','employment_type','status','contract_end'];
const employmentTypes=['full_time','part_time','contract','intern'];
const statuses=['active','on_notice','left'];
// مرجع الوثيقة تسمية مختصرة لا رقم كامل: لا تُخزَّن أرقام الهوية أو الإقامة في المنصة.
//
// الحارس القديم كان يعدّ الأرقام مرتين بطريقتين متناقضتين: يجمع خانات النص كلها ليقرر أن فيه ستًّا فأكثر، ثم يبحث عن
// ستٍّ **متلاصقة** في النص كما كُتب. فأي فاصل يمشي بالرقم كاملًا إلى القاعدة: «2 1 2 3 4 5 6 7 8 9» و«212-345-6789»
// و«١٠٩٨٧٦٥٤٣٢» و«１０９８７６５４３２» كلها كانت تمرّ، والمخزَّن رقم هوية أو إقامة كامل يعود بطيّ فاصله في أي قراءة أو تصدير.
// البديل هو الحارس الواحد في app/pii.mjs، وهو نفسه الذي يحرس الحقول المخصّصة (app/custom-fields.mjs) وملف الموظف
// (app/employee-profile.mjs): يُطبِّع NFKC، ويمحو كل ما ليس حرفًا ولا رقمًا — الفاصل الذي يُرى والذي لا يُرى — ويوحّد
// أرقام يونيكود لاتينيةً، ثم يعدّ. والحروف تبقى حاجزًا، فـ«آخر 4 أرقام 1234» و«عقد 2024» يمرّان كما كانا.
// وما يشدّ عمدًا: تاريخ مكتوب بفواصل («عقد 2024-01-15») صار يُرفض، لأن طيّ فاصله ثماني خانات متتالية. وهذا اتجاه
// الخطأ المقصود نفسه المكتوب في app/pii.mjs — الامتناع عن رقم الوثيقة قبل راحة الكتابة — ولخانتَي الإصدار والانتهاء
// حقلاهما في الجدول، فلا يُكتب التاريخ في المرجع أصلًا.
const reference=value=>{
  const text=v.text(value,'مرجع الوثيقة',40,2);
  if(looksLikeIdentifier(text))refuse(400,'reference_number',{what:'رُفض ما كُتب في «مرجع الوثيقة»: فيه رقم كامل يشبه رقم هوية أو إقامة أو وثيقة',
    missing:[{document:'تسمية مختصرة بلا أرقام متسلسلة طويلة، مثل «آخر 4 أرقام 1234»',why:NO_NATIONAL_ID,owner:'من يسجّل الوثيقة — الموظف نفسه أو فريق رأس المال البشري',owner_role:null}],
    next:'اكتب آخر أربع خانات أو اسم الوثيقة وحده. ستة أرقام متتالية فأكثر تُرفض بأي صورة كُتبت وبأي فاصل بينها، والتاريخ له خانتا الإصدار والانتهاء فلا يُكتب هنا'});
  return text;
};
function actor(db,u){const current=currentUser(db,u);if(!current)fail(403,'forbidden','الحساب غير متاح');return current;}
// التعريف الواحد في app/access.mjs. كان هنا تعريف ثانٍ بالاسم نفسه يقبل الدور hr وحده، ولا يقبل
// تصريح «السجل الوظيفي» الذي يقبله app/my-profile.mjs — فكان من يقرأ الملفات لا يحرّرها.
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','يلزم تنفيذ العملية داخل معاملة');}
function subject(db,u,userId){
  const person=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(userId,u.tenant_id);
  if(!person)fail(404,'not_found','الموظف غير موجود');
  const own=person.id===u.id,managed=person.manager_id===u.id;
  if(!own&&!managed&&!isPeopleOfficer(db,u))fail(403,'forbidden','ملف الموظف متاح له ولمديره المباشر ولرأس المال البشري');
  return {person,own,managed,officer:isPeopleOfficer(db,u)};
}
const documentState=row=>{
  const days=Math.round((Date.parse(row.expires_on)-Date.parse(today()))/86400000);
  return {...row,days_left:days,state:row.replaced_by?'replaced':days<0?'expired':days<=EXPIRY_WINDOW?'expiring':'valid'};
};
// حال التغيير المؤرخ كما يُقرأ: سرى، أو أُلغي، أو ينتظر اعتماده، أو اعتُمد وينتظر تاريخه، أو حلّ تاريخه ولم يسرِ بعد (إدارة أُرشفت، أو لا ملف وظيفي).
export const CHANGE_STATE_NAMES={applied:'سرى',cancelled:'ملغى',awaiting_approval:'ينتظر اعتماد زميل',scheduled:'معتمد — يسري في تاريخه',due:'معتمد وحلّ تاريخه — لم يسرِ بعد'};
const changeState=c=>c.applied_at?'applied':c.cancelled_at?'cancelled':!c.approved_by?'awaiting_approval':c.effective_from>today()?'scheduled':'due';
// من يعتمد تغييرًا: حامل «السجل الوظيفي» غير صاحب الملف وغير من سجّله. وحين لا يوجد غير من سجّله يعتمده هو بسبب مكتوب.
const approvers=(db,tenantId,change)=>capabilityHolders(db,tenantId,'employees.view').filter(p=>p.id!==change.user_id&&p.id!==change.created_by);
// تغييرات ملفٍ واحد كما يقرؤها من فتحه: حالها بكلمتها، وما يجوز له عليها، وهل يلزم اعتمادَها سببٌ مكتوب. قارئ واحد يقرؤه ملف الموظف
// (employeeRecord) وقائمة الموظفين (listEmployees)، فلا تقول شاشة الموظفين عن تغييرٍ غير ما يقوله ملفه، ولا تبني أزرارها من عدّاد.
function changesOf(db,u,officer,userId){
  return db.prepare('SELECT c.*,u.name AS created_by_name FROM employee_changes c JOIN users u ON u.id=c.created_by WHERE c.user_id=? ORDER BY c.effective_from DESC,c.created_at DESC').all(userId).map(c=>{
    const state=changeState(c),open=state!=='applied'&&state!=='cancelled',actions=[];
    if(officer&&open&&!c.approved_by&&u.id!==c.user_id&&(u.id!==c.created_by||!approvers(db,u.tenant_id,c).length))actions.push('approve_change');
    if(officer&&open)actions.push('cancel_change');
    return {...c,approved_by_name:personName(db,c.approved_by),state,state_name:CHANGE_STATE_NAMES[state],two_person:c.approved_by?c.approved_by!==c.created_by:null,
      // سبب الاعتماد بيد معدّه أثرُ تدقيق؛ يراه من يعمل على السجل الوظيفي وحده.
      self_approval_reason:officer?c.self_approval_reason:undefined,
      // الزر نفسه، ويطلب سببًا مكتوبًا حين يعتمد المسجِّل تغييره لأنه لا حامل غيره.
      needs_reason:actions.includes('approve_change')&&u.id===c.created_by,actions};
  });
}
// من أي مرشح جاء الموظف وبأي عقد: لمن يعمل على السجل الوظيفي، لا لصاحب الملف ولا لمديره.
const hireOf=(db,u,officer,userId)=>officer?db.prepare('SELECT candidate_id,contract_id,linked_at,contract_linked_at FROM employee_hires WHERE user_id=? AND tenant_id=?').get(userId,u.tenant_id)??null:null;
export function employeeRecord(db,supplied,userId){
  const u=actor(db,supplied),{person,own,officer,managed}=subject(db,u,userId);
  const profile=db.prepare('SELECT * FROM employee_profiles WHERE user_id=?').get(person.id)??null;
  const changes=changesOf(db,u,officer,person.id),hire=hireOf(db,u,officer,person.id);
  return {
    user:{id:person.id,name:person.name,username:person.username,role:person.role,department_id:person.department_id,manager_id:person.manager_id,active:!!person.active},
    profile,
    documents:db.prepare('SELECT * FROM employee_documents WHERE user_id=? ORDER BY expires_on').all(person.id).map(documentState),
    changes,hire,
    can:{edit_profile:officer,add_document:officer||own,record_change:officer,approve_change:officer,view_reason:officer||managed}
  };
}
export function listEmployees(db,supplied){
  const u=actor(db,supplied),officer=isPeopleOfficer(db,u);
  const scope=officer
    ?db.prepare('SELECT * FROM users WHERE tenant_id=? AND role<>? ORDER BY active DESC,name').all(u.tenant_id,'admin')
    :db.prepare('SELECT * FROM users WHERE tenant_id=? AND (id=? OR manager_id=?) ORDER BY name').all(u.tenant_id,u.id,u.id);
  const profiles=new Map(db.prepare('SELECT * FROM employee_profiles WHERE tenant_id=?').all(u.tenant_id).map(p=>[p.user_id,p]));
  const documents=db.prepare('SELECT * FROM employee_documents WHERE tenant_id=? AND replaced_by IS NULL').all(u.tenant_id).map(documentState);
  const pending=db.prepare('SELECT * FROM employee_changes WHERE tenant_id=? AND applied_at IS NULL AND cancelled_at IS NULL').all(u.tenant_id);
  // التغييرات بصفوفها ورابط التوظيف من قارئَي ملف الموظف نفسيهما (changesOf وhireOf): الشاشة ترسم حال كل تغيير وأزرار اعتماده
  // وإلغائه من هنا، والعدّادان باقيان كما كانا. والمدير المباشر معرّفه، ليُقرأ في الملف بجوار ما لا يتعدّل منه إلا بتغيير مؤرخ.
  const rows=scope.map(person=>({
    user:{id:person.id,name:person.name,department_id:person.department_id,manager_id:person.manager_id??null,role:person.role,active:!!person.active},
    profile:profiles.get(person.id)??null,
    attention:documents.filter(d=>d.user_id===person.id&&['expired','expiring'].includes(d.state)).map(d=>({doc_type:d.doc_type,state:d.state,expires_on:d.expires_on,days_left:d.days_left})),
    pending_changes:pending.filter(c=>c.user_id===person.id).length,
    awaiting_approval:pending.filter(c=>c.user_id===person.id&&!c.approved_by).length,
    changes:changesOf(db,u,officer,person.id),hire:hireOf(db,u,officer,person.id)
  }));
  return {
    scope:officer?'people':'team',
    rows,
    missing_profiles:rows.filter(r=>!r.profile&&r.user.active).length,
    expiring:rows.reduce((n,r)=>n+r.attention.length,0),
    awaiting_approval:rows.reduce((n,r)=>n+r.awaiting_approval,0),
    employment_types:employmentTypes,document_types:types,change_types:changeTypes,statuses,change_state_names:CHANGE_STATE_NAMES
  };
}
// الحقول التي لها تغيير مؤرخ (changeTypes) لا يعدّلها الملف الوظيفي بعد إنشائه: تغييرٌ بتاريخ سريانه وسببه يعتمده زميل.
// الملف الأول بداية سجل لا تغيير فيه، فيأخذ قيمه الابتدائية كلها. والإدارة والمدير ليسا من حقول الملف أصلًا، فذكرهما يُرد إلى مساره.
const DATED_FIELDS={job_title:'المسمى الوظيفي',employment_type:'نوع التعاقد',status:'حالة الموظف',contract_end:'نهاية العقد',department:'الإدارة',department_id:'الإدارة',manager:'المدير المباشر',manager_id:'المدير المباشر'};
function datedField(key){
  refuse(409,'dated_field',{what:`«${DATED_FIELDS[key]}» ما يتعدّل من الملف الوظيفي مباشرة`,
    missing:[{document:`تغيير وظيفي مؤرخ لـ«${DATED_FIELDS[key]}» بتاريخ سريانه وسببه`,why:'التغيير يمس المسير والصلاحيات وسجل الخدمة، فيُحفظ بتاريخه ويعتمده زميل ثاني',owner:'رأس المال البشري (السجل الوظيفي)',owner_role:'hr'}],
    next:'سجّله من «تغيير وظيفي مؤرخ» في ملف الموظف بتاريخ سريانه وسببه، ويعتمده زميل ثاني يحمل «السجل الوظيفي»، ويسري في تاريخه',link:'#employees'});
}
const endBeforeJoin=()=>refuse(400,'contract_end',{what:'نهاية العقد تسبق تاريخ المباشرة',next:'صحّح تاريخ المباشرة أو نهاية العقد؛ ونهاية عقد قائم تتغير بتغيير وظيفي مؤرخ'});
export function saveProfile(db,supplied,userId,input){
  writing(db);
  const u=actor(db,supplied);
  if(!isPeopleOfficer(db,u))fail(403,'forbidden','تحرير الملف الوظيفي متاح لرأس المال البشري');
  const {person}=subject(db,u,userId);
  if(input&&typeof input==='object')for(const key of ['department','department_id','manager','manager_id'])if(Object.hasOwn(input,key))datedField(key);
  v.object(input,['job_title','employment_type','join_date','contract_end','status','version']);
  const current=db.prepare('SELECT * FROM employee_profiles WHERE user_id=?').get(person.id);
  const time=now();
  if(current){
    v.version(input.version,current.version);
    // ما أُرسل من الحقول المؤرخة يطابق الحال أو يُرفض؛ وما لم يُرسل يبقى كما هو ولا يُعاد إلى افتراض.
    const sent=key=>Object.hasOwn(input,key);
    const proposed={job_title:sent('job_title')?v.text(input.job_title,'المسمى الوظيفي',120,2):current.job_title,employment_type:sent('employment_type')?input.employment_type:current.employment_type,
      status:sent('status')?input.status:current.status,contract_end:sent('contract_end')?(input.contract_end?v.date(input.contract_end):null):current.contract_end};
    for(const key of ['job_title','employment_type','status','contract_end'])if((proposed[key]??null)!==(current[key]??null))datedField(key);
    const join=sent('join_date')?v.date(input.join_date):current.join_date;
    if(current.contract_end&&current.contract_end<=join)endBeforeJoin();
    db.prepare('UPDATE employee_profiles SET join_date=?,version=version+1,updated_by=?,updated_at=? WHERE user_id=?').run(join,u.id,time,person.id);
    audit(db,u,'employee',person.id,'employee.profile_updated',{join_date:current.join_date},{join_date:join});
    return employeeRecord(db,u,person.id);
  }
  if(!employmentTypes.includes(input.employment_type))fail(400,'employment_type','نوع التعاقد غير صالح');
  const status=input.status??'active';
  if(!statuses.includes(status))fail(400,'status','حالة الموظف غير صالحة');
  const title=v.text(input.job_title,'المسمى الوظيفي',120,2),join=v.date(input.join_date);
  const end=input.contract_end?v.date(input.contract_end):null;
  if(end&&end<=join)endBeforeJoin();
  db.prepare('INSERT INTO employee_profiles(user_id,tenant_id,job_title,employment_type,join_date,contract_end,status,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(person.id,u.tenant_id,title,input.employment_type,join,end,status,u.id,time);
  audit(db,u,'employee',person.id,'employee.profile_created',{},{job_title:title,employment_type:input.employment_type,join_date:join,contract_end:end,status});
  return employeeRecord(db,u,person.id);
}
export function addDocument(db,supplied,userId,input){
  writing(db);
  const u=actor(db,supplied),{person,own,officer}=subject(db,u,userId);
  if(!officer&&!own)fail(403,'forbidden','إضافة الوثيقة متاحة للموظف نفسه أو لرأس المال البشري');
  v.object(input,['doc_type','reference','issued_on','expires_on','note','replaces']);
  if(!types.includes(input.doc_type))fail(400,'doc_type','نوع الوثيقة غير صالح');
  const expires=v.date(input.expires_on),issued=input.issued_on?v.date(input.issued_on):null;
  if(issued&&issued>=expires)fail(400,'issued_on','تاريخ الإصدار بعد الانتهاء');
  const docId=id();
  db.prepare('INSERT INTO employee_documents(id,tenant_id,user_id,doc_type,reference,issued_on,expires_on,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(docId,u.tenant_id,person.id,input.doc_type,reference(input.reference),issued,expires,input.note?v.text(input.note,'ملاحظة',500):'',u.id,now());
  if(input.replaces){
    const old=db.prepare('SELECT * FROM employee_documents WHERE id=? AND user_id=? AND replaced_by IS NULL').get(input.replaces,person.id);
    if(!old)fail(404,'not_found','الوثيقة المستبدَلة غير متاحة');
    db.prepare('UPDATE employee_documents SET replaced_by=? WHERE id=?').run(docId,old.id);
  }
  audit(db,u,'employee',person.id,'employee.document_added',{},{document_id:docId,doc_type:input.doc_type,expires_on:expires,replaces:input.replaces??null});
  // الرد هو سجل الموظف كاملًا، ومعه معرّف الوثيقة المنشأة وحدها: مفتاح التكرار يُربط بها لا بالسجل (الذي لا معرّف له).
  return {...employeeRecord(db,u,person.id),document_id:docId};
}
export function recordChange(db,supplied,userId,input){
  writing(db);
  const u=actor(db,supplied);
  if(!isPeopleOfficer(db,u))fail(403,'forbidden','تسجيل التغيير الوظيفي متاح لرأس المال البشري');
  const {person}=subject(db,u,userId);
  v.object(input,['change_type','to_value','effective_from','reason','request_id']);
  if(!changeTypes.includes(input.change_type))fail(400,'change_type','نوع التغيير غير صالح');
  const effective=v.date(input.effective_from),reason=v.text(input.reason,'سبب التغيير',1000,3);
  const profile=db.prepare('SELECT * FROM employee_profiles WHERE user_id=?').get(person.id);
  const from={job_title:profile?.job_title??'',department:person.department_id,manager:person.manager_id??'',employment_type:profile?.employment_type??'',status:profile?.status??'active',contract_end:profile?.contract_end??''}[input.change_type];
  const to=validateTarget(db,u,person,input.change_type,input.to_value);
  if(String(from)===String(to))fail(400,'no_change','القيمة الجديدة مطابقة للحالية');
  if(input.request_id&&!db.prepare('SELECT 1 FROM requests WHERE id=? AND tenant_id=?').get(input.request_id,u.tenant_id))fail(404,'not_found','الطلب المرجعي غير موجود');
  const changeId=id();
  db.prepare('INSERT INTO employee_changes(id,tenant_id,user_id,change_type,from_value,to_value,effective_from,reason,request_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(changeId,u.tenant_id,person.id,input.change_type,String(from),String(to),effective,reason,input.request_id??null,u.id,now());
  // يُسجَّل مفتوحًا ولا يسري قبل أن يعتمده زميل (approveChange)، ولو كان تاريخه قد حلّ.
  audit(db,u,'employee',person.id,'employee.change_recorded',{[input.change_type]:from},{[input.change_type]:to,effective_from:effective,change_id:changeId,awaiting_approval:true},reason);
  // كما في إضافة الوثيقة: السجل كاملًا ومعه معرّف التغيير المنشأ، ليُربط به مفتاح التكرار.
  return {...employeeRecord(db,u,person.id),change_id:changeId};
}
function validateTarget(db,u,person,type,value){
  if(type==='department'){
    const d=db.prepare('SELECT id FROM departments WHERE id=? AND tenant_id=? AND active=1').get(value,u.tenant_id);
    if(!d)fail(400,'department','الإدارة غير موجودة أو مؤرشفة');
    return d.id;
  }
  if(type==='manager'){
    if(value==='')return '';
    const m=db.prepare("SELECT id,department_id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role='manager'").get(value,u.tenant_id);
    if(!m)fail(400,'manager','المدير المباشر يجب أن يكون حسابًا نشطًا بدور مدير');
    if(m.id===person.id)fail(400,'manager','لا يكون الموظف مديرًا لنفسه');
    return m.id;
  }
  if(type==='employment_type'){if(!employmentTypes.includes(value))fail(400,'employment_type','نوع التعاقد غير صالح');return value;}
  if(type==='status'){if(!statuses.includes(value))fail(400,'status','حالة الموظف غير صالحة');return value;}
  if(type==='contract_end')return v.date(value);
  return v.text(value,'القيمة الجديدة',120,2);
}
// التغيير يسري في تاريخه بعد اعتماده، لا لحظة تسجيله. يُستدعى عند الاعتماد (للتغيير نفسه إن حلّ تاريخه)، وفي التشغيل اليومي
// (app/workflow-sweep.mjs)، وبطلب صريح من حامل السجل الوظيفي (applyDueChangesNow). لا يُستدعى من قراءة: فتح الشاشة لا يغيّر شيئًا.
export function applyDueChanges(db,tenantId,{changeId=null}={}){
  writing(db);
  const due=db.prepare(`SELECT * FROM employee_changes WHERE tenant_id=? AND applied_at IS NULL AND cancelled_at IS NULL AND approved_by IS NOT NULL AND effective_from<=?${changeId?' AND id=?':''} ORDER BY effective_from,created_at`)
    .all(tenantId,today(),...(changeId?[changeId]:[]));
  let applied=0;
  for(const change of due){
    const officer=db.prepare('SELECT * FROM users WHERE id=?').get(change.created_by);
    const person=db.prepare('SELECT * FROM users WHERE id=?').get(change.user_id);
    if(!person)continue;
    const profile=db.prepare('SELECT * FROM employee_profiles WHERE user_id=?').get(person.id);
    let priorManager=null;
    if(change.change_type==='department'){
      if(!db.prepare('SELECT 1 FROM departments WHERE id=? AND active=1').get(change.to_value))continue;
      // النقل يترك المدير السابق خلفه؛ يُحفظ اسمه مع التغيير ليُقرأ «المدير في تاريخ» قبل النقل (orgOn).
      priorManager=person.manager_id??null;
      db.prepare('UPDATE users SET department_id=?,manager_id=NULL WHERE id=?').run(change.to_value,person.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(person.id);
    }else if(change.change_type==='manager'){
      db.prepare('UPDATE users SET manager_id=? WHERE id=?').run(change.to_value||null,person.id);
    }else if(profile){
      const column={job_title:'job_title',employment_type:'employment_type',status:'status',contract_end:'contract_end'}[change.change_type];
      if(column)db.prepare(`UPDATE employee_profiles SET ${column}=?,version=version+1,updated_by=?,updated_at=? WHERE user_id=?`).run(change.to_value||null,change.created_by,now(),person.id);
      if(change.change_type==='status'&&change.to_value==='left'){
        db.prepare('UPDATE users SET active=0 WHERE id=?').run(person.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(person.id);
        // الموجة 2، العطب 8: من غادر لا يبقى عمله «قيد التنفيذ» عنده؛ يعود إلى طابور إدارته في المعاملة نفسها ويُخبَر مديرها.
        returnDepartedWork(db,{userId:person.id,actor:officer??null,auditor:officer??{id:change.created_by,tenant_id:tenantId}});
      }
    }else continue;
    db.prepare('UPDATE employee_changes SET applied_at=?,prior_manager=? WHERE id=?').run(now(),priorManager,change.id);
    audit(db,officer??{id:change.created_by,tenant_id:tenantId},'employee',person.id,'employee.change_applied',{change_id:change.id},{change_type:change.change_type,to_value:change.to_value,effective_from:change.effective_from,approved_by:change.approved_by});
    applied++;
  }
  return applied;
}
const notOfficer=what=>refuse(403,'forbidden',{what,missing:[{document:'تصريح «السجل الوظيفي» (employees.view)',why:'التغيير الوظيفي يعتمده ويطبّقه من يعمل على السجل الوظيفي',owner:'الأدمن الأول',owner_role:'admin'}],
  next:'اطلب التصريح من الأدمن الأول، أو اطلب ذلك من زميل يحمله'});
// اعتماد التغيير المؤرخ: حامل «السجل الوظيفي» غير صاحب الملف وغير من سجّله. وقاعدة الشخصين في شركة بهذا الحجم تعيش في الكود
// ويُتجاوز في موضع واحد مسجَّل: لا حامل آخر في الكيان، فيعتمده من سجّله بسبب مكتوب يُحفظ مع التغيير وفي سجل التدقيق (two_person:false)،
// باسمه هو — لا باسم مصطنع ولا بحساب النظام.
export function approveChange(db,supplied,changeId,input={}){
  writing(db);
  const u=actor(db,supplied);
  if(!isPeopleOfficer(db,u))notOfficer('اعتماد التغيير الوظيفي مو من صلاحية حسابك');
  v.object(input??{},['note','self_approval_reason']);
  const change=typeof changeId==='string'?db.prepare('SELECT * FROM employee_changes WHERE id=? AND tenant_id=?').get(changeId,u.tenant_id):null;
  if(!change)refuse(404,'not_found',{what:'ما لقينا هذا التغيير الوظيفي في كيانك',next:'افتح ملف الموظف واختر التغيير من قائمة تغييراته'});
  if(change.applied_at||change.cancelled_at)refuse(409,'change_settled',{what:change.applied_at?`هذا التغيير سرى في ${riyadhDay(change.applied_at)}`:'هذا التغيير ملغى',next:'ما استقر لا يُعتمد؛ سجّل تغييرًا جديدًا إن لزم'});
  if(change.approved_by)refuse(409,'already_approved',{what:`اعتمد هذا التغيير ${personName(db,change.approved_by)??change.approved_by} من قبل`,next:'يسري في تاريخه؛ وللتراجع عنه ألغه بسبب مكتوب ما دام ما سرى'});
  const others=approvers(db,u.tenant_id,change),names=others.map(p=>p.name).join('، ');
  if(change.user_id===u.id)refuse(409,'separation_of_duties',{what:'ما تعتمد تغييرًا على ملفك أنت',
    missing:[{document:'اعتماد زميل يحمل «السجل الوظيفي»',why:'صاحب الشأن ما يقرر لنفسه',owner:names||'زميل يحمل «السجل الوظيفي»',owner_role:'hr'}],
    next:names?`اطلب الاعتماد من: ${names}`:'اطلب من الأدمن الأول منح «السجل الوظيفي» لزميل يعتمده'});
  const reasonGiven=input?.self_approval_reason!==undefined&&input?.self_approval_reason!=='';
  let selfReason=null;
  if(change.created_by===u.id){
    if(others.length)refuse(409,'self_approval',{what:'سجّلت هذا التغيير بنفسك، فما تعتمده أنت',
      missing:[{document:'اعتماد زميل يحمل «السجل الوظيفي»',why:'التغيير الوظيفي يمس المسير والصلاحيات وسجل الخدمة، فيراه شخصان',owner:names,owner_role:'hr'}],
      next:`اطلب الاعتماد من: ${names}`});
    if(!reasonGiven)refuse(409,'self_approval_reason',{what:'سجّلت هذا التغيير بنفسك، وما في الكيان حامل ثاني لـ«السجل الوظيفي» يعتمده',
      missing:[{document:'سبب مكتوب للاعتماد بيد معدّه — 20 حرفًا على الأقل',why:'قاعدة الشخصين ما تُتجاوز إلا بسبب يُحفظ في سجل التدقيق باسم من تجاوزها',owner:u.name,owner_role:'hr'}],
      next:'اكتب السبب في «سبب الاعتماد بيد معدّه» وأعد الاعتماد، أو اطلب من الأدمن الأول منح «السجل الوظيفي» لزميل يعتمده'});
    selfReason=v.text(input.self_approval_reason,'سبب الاعتماد بيد معدّه',1000,20);
  }else if(reasonGiven)refuse(400,'self_approval_reason',{what:'سبب الاعتماد بيد معدّه يُكتب فقط حين تعتمد تغييرًا سجّلته أنت',next:'احذف السبب واعتمد'});
  const note=input?.note?v.text(input.note,'ملاحظة الاعتماد',1000):'';
  db.prepare('UPDATE employee_changes SET approved_by=?,approved_at=?,self_approval_reason=? WHERE id=?').run(u.id,now(),selfReason,change.id);
  audit(db,u,'employee',change.user_id,'employee.change_approved',{change_id:change.id,approved:false},
    {change_id:change.id,change_type:change.change_type,to_value:change.to_value,effective_from:change.effective_from,recorded_by:change.created_by,two_person:!selfReason},selfReason??note);
  const applied=applyDueChanges(db,u.tenant_id,{changeId:change.id})>0;
  return {...employeeRecord(db,u,change.user_id),change_id:change.id,applied};
}
// ما ينتظر قرار هذا الشخص من التغييرات الوظيفية: مفتوحة لم تُعتمد، في كيانه، ويجوز له اعتمادها بالقاعدة نفسها التي تحكم approveChange
// (غير صاحب الملف، وغير من سجّله ما دام في الكيان حامل آخر). هو المصدر الذي يقرؤه «بانتظار قراري» (app/inbox.mjs) كبقية اللوحات:
// صفٌّ له معرّف وعنوان واسم صاحب الملف وأفعاله. ولمن لا يحمل «السجل الوظيفي» قائمة فارغة لا رفض، كما تعيد اللوحات الأخرى.
const CHANGE_NAMES={job_title:'المسمى الوظيفي',department:'الإدارة',manager:'المدير المباشر',employment_type:'نوع التعاقد',status:'الحالة',contract_end:'نهاية العقد'};
export function changesAwaitingApproval(db,supplied){
  const u=actor(db,supplied);
  if(!isPeopleOfficer(db,u))return [];
  return db.prepare('SELECT * FROM employee_changes WHERE tenant_id=? AND applied_at IS NULL AND cancelled_at IS NULL AND approved_by IS NULL ORDER BY effective_from,created_at').all(u.tenant_id)
    .filter(c=>c.user_id!==u.id&&(c.created_by!==u.id||!approvers(db,u.tenant_id,c).length))
    .map(c=>({id:c.id,user_id:c.user_id,employee_name:personName(db,c.user_id),title:`تغيير ${CHANGE_NAMES[c.change_type]} يسري ${c.effective_from}`,change_type:c.change_type,
      effective_from:c.effective_from,created_at:c.created_at,recorded_by_name:personName(db,c.created_by),needs_reason:c.created_by===u.id,actions:['approve_change']}));
}
// الطلب الصريح: يطبّق ما اعتُمد وحلّ تاريخه الآن بدل انتظار التشغيل اليومي. لحامل السجل الوظيفي وحده.
export function applyDueChangesNow(db,supplied,input={}){
  writing(db);
  const u=actor(db,supplied);
  if(!isPeopleOfficer(db,u))notOfficer('تطبيق التغييرات الوظيفية المستحقة مو من صلاحية حسابك');
  v.object(input??{},[]);
  return {applied:applyDueChanges(db,u.tenant_id)};
}
// الحال الوظيفي في تاريخ (بتقويم الرياض): الإدارة والمدير المباشر والمسمى ونوع التعاقد والحالة ونهاية العقد كما كانت — أو ستكون —
// في ذلك اليوم، من التغييرات المعتمدة وحدها (سرت أو تنتظر تاريخها). ما لم يُعتمد ليس تاريخًا. قارئ داخلي يُحصر بكيان مَن يسأل:
// tenantId مطلوب، وشخصٌ من كيان آخر يعود null. والمدير قبل نقلٍ سرى قبل الترحيل 172 لا يُعرف (لم يُحفظ)، فيعود null بدل تخمينه.
const ORG_FIELDS={department:'department_id',manager:'manager_id',job_title:'job_title',employment_type:'employment_type',status:'status',contract_end:'contract_end'};
export function orgOn(db,userId,date,{tenantId}={}){
  if(typeof tenantId!=='string'||!tenantId)throw new TypeError('orgOn: tenantId مطلوب — القارئ يُحصر بكيان من يسأل ولا يقرأ عبر الكيانات');
  const day=v.date(date);
  const person=personPlacement(db,tenantId,userId);
  if(!person)return null;
  const profile=personProfile(db,person.id);
  const value={department:person.department_id,manager:person.manager_id??null,job_title:profile?.job_title??null,employment_type:profile?.employment_type??null,status:profile?.status??null,contract_end:profile?.contract_end??null};
  const history=db.prepare('SELECT * FROM employee_changes WHERE user_id=? AND tenant_id=? AND cancelled_at IS NULL AND (applied_at IS NOT NULL OR approved_by IS NOT NULL) ORDER BY effective_from,created_at').all(person.id,person.tenant_id);
  // المدير يتغير بتغيير المدير، وينقطع بالنقل: النقل يجعله فارغًا من تاريخه، وما قبله المدير الذي تركه خلفه.
  const moves=field=>field==='manager'?history.filter(c=>c.change_type==='manager'||c.change_type==='department'):history.filter(c=>c.change_type===field);
  const after=(c,field)=>field==='manager'&&c.change_type==='department'?null:(c.to_value===''?null:c.to_value);
  const before=(c,field)=>field==='manager'&&c.change_type==='department'?(c.applied_at?c.prior_manager:value.manager):(c.from_value===''?null:c.from_value);
  const out={user_id:person.id,date:day};
  for(const [field,key] of Object.entries(ORG_FIELDS)){
    const list=moves(field),last=list.filter(c=>c.effective_from<=day).at(-1),next=list.find(c=>c.effective_from>day);
    out[key]=last?after(last,field):next?before(next,field):value[field];
  }
  return out;
}
export function cancelChange(db,supplied,changeId,input){
  writing(db);
  const u=actor(db,supplied);
  if(!isPeopleOfficer(db,u))fail(403,'forbidden','إلغاء التغيير متاح لرأس المال البشري');
  v.object(input,['reason']);
  const change=db.prepare('SELECT * FROM employee_changes WHERE id=? AND tenant_id=? AND applied_at IS NULL AND cancelled_at IS NULL').get(changeId,u.tenant_id);
  if(!change)fail(404,'not_found','التغيير غير متاح للإلغاء');
  const reason=v.text(input.reason,'سبب الإلغاء',1000,3);
  db.prepare('UPDATE employee_changes SET cancelled_at=? WHERE id=?').run(now(),changeId);
  audit(db,u,'employee',change.user_id,'employee.change_cancelled',{change_id:changeId},{cancelled:true},reason);
  return employeeRecord(db,u,change.user_id);
}
export function expiringDocuments(db,supplied){
  const u=actor(db,supplied);
  if(!isPeopleOfficer(db,u))return [];
  return db.prepare('SELECT d.*,u.name AS employee_name FROM employee_documents d JOIN users u ON u.id=d.user_id WHERE d.tenant_id=? AND d.replaced_by IS NULL AND u.active=1 ORDER BY d.expires_on')
    .all(u.tenant_id).map(documentState).filter(d=>['expired','expiring'].includes(d.state));
}
