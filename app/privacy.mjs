import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';

// سجلات حماية البيانات الشخصية. المنصة هي نظام السجل الوحيد للشركة وفيها بيانات موظفين ورواتب، فهي موضع الالتزام.
// القاعدة الحاكمة: لا مدة احتفاظ ولا أساس نظامي مكتوب هنا. كلاهما حقل يدخله صاحبه بمصدره وتاريخ تأكيده،
// ويبقى موسومًا «يحتاج مراجعة قانونية» مهما اكتمل. المنصة تسجّل وتذكّر ولا تفتي ولا تتلف ولا تحذف.
export const LEGAL_REVIEW='يحتاج مراجعة قانونية';
export const SUBJECT_CATEGORIES={employees:'موظفون',candidates:'مرشحون',client_contacts:'جهات اتصال العملاء',vendors:'موردون'};
export const REQUEST_TYPES={access:'اطلاع',correct:'تصحيح',delete:'حذف',port:'نقل',object:'اعتراض'};
export const REQUESTER_KINDS={employee:'موظف',candidate:'مرشح',client_contact:'جهة اتصال عميل',vendor:'مورد',other:'غير ذلك'};
export const TRANSFER_STATES={pending:'غير مُقيَّم — بانتظار قرار المالك',assessed:'مُقيَّم — بانتظار الاعتماد',approved:'معتمد',stopped:'موقوف'};
export const REQUEST_STATES={received:'مستلم — لم يُتحقق من الهوية',verified:'تحققت الهوية — قيد العمل',answered:'أُجيب',refused:'رُفض بسبب مسجل',closed:'مقفل'};
export const INCIDENT_STATES={open:'مفتوحة',contained:'محتواة',closed:'مقفلة'};
const REVIEW_LEAD_DAYS=30;

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const days=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
function allowed(db,u){if(!can(db,u,'privacy.manage'))fail(403,'not_permitted','سجلات حماية البيانات لحامل تصريحها');}
const list=value=>Array.isArray(value)?[...new Set(value.map(String))]:[];

/* ───── مسح جداول المنصة: ما تقوله القاعدة عن نفسها، لا ما نفترضه عنها ───── */
// أعمدة يكون صاحبها هو موضوع السجل، مقابل أعمدة تدل على من نفذ فعلًا. ما عداها من مراجع المستخدمين يُعد أثر فعل.
const SUBJECT_COLUMNS=new Set(['user_id','employee_id','claimant_id','subject_id','subject_user_id','custodian_id','holder_id']);
const SAFE=/^[a-z_][a-z0-9_]*$/;
const SCAN=new WeakMap();
// مسح واحد للقاعدة: أعمدة المستخدمين، وما يمنع الحذف من كل جدول، وكم جدولًا يشير إليه.
// كله مقروء من القاعدة نفسها كي يبقى صحيحًا كلما أضاف غيري جداول، ولا يُكتب هنا كقائمة ثابتة.
function schema(db){
  const cached=SCAN.get(db);if(cached)return cached;
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name).filter(t=>SAFE.test(t));
  const blocked=new Map(db.prepare("SELECT tbl_name,name FROM sqlite_master WHERE type='trigger' AND upper(sql) LIKE '%BEFORE DELETE%'").all().map(r=>[r.tbl_name,r.name]));
  const columns=[],referenced=new Map(tables.map(t=>[t,0]));
  for(const table of tables){
    const tenant=db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='tenant_id'),seen=new Set();
    for(const fk of db.prepare(`PRAGMA foreign_key_list(${table})`).all()){
      if(fk.table!==table&&referenced.has(fk.table)&&!seen.has('ref:'+fk.table)){seen.add('ref:'+fk.table);referenced.set(fk.table,referenced.get(fk.table)+1);}
      if(fk.table!=='users'||fk.from==='tenant_id'||!SAFE.test(fk.from)||table==='users'||seen.has(fk.from))continue;
      seen.add(fk.from);
      columns.push({table,column:fk.from,tenant,role:SUBJECT_COLUMNS.has(fk.from)?'subject':'actor'});
    }
  }
  const facts={tables:new Set(tables),columns,blocked,referenced};
  SCAN.set(db,facts);return facts;
}
const tableExists=(db,table)=>schema(db).tables.has(table);

/* ───── دالة اطلاع: أين تقع بيانات شخص واحد، بالأسماء والأعداد فقط ───── */
// لا يعيد محتوى أي سجل. المسؤول يحتاج أن يعرف أين يبحث، لا أن تفتح له الأداة بابًا لتصفح بيانات الناس.
export function subjectDataMap(db,supplied,userId){
  const u=actor(db,supplied);allowed(db,u);
  const person=typeof userId==='string'&&db.prepare('SELECT id,name,active FROM users WHERE id=? AND tenant_id=?').get(userId,u.tenant_id);
  if(!person)fail(404,'not_found','الحساب غير موجود في هذا الكيان');
  const facts=schema(db);
  const entry=(table,column,role,count)=>({table,column,role,rows:count,blocked_by:facts.blocked.get(table)??null,referenced_by:facts.referenced.get(table)??0});
  const rows=[entry('users','id','subject',1)];
  for(const {table,column,tenant,role} of facts.columns){
    const where=tenant?`WHERE ${column}=? AND tenant_id=?`:`WHERE ${column}=?`,args=tenant?[person.id,u.tenant_id]:[person.id];
    const count=db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...args).n;
    if(!count)continue;
    const existing=rows.find(r=>r.table===table);
    if(existing){existing.rows+=count;existing.column+=`، ${column}`;if(role==='subject')existing.role='subject';continue;}
    rows.push(entry(table,column,role,count));
  }
  rows.sort((a,b)=>b.rows-a.rows||a.table.localeCompare(b.table));
  return {user:{id:person.id,name:person.name,active:!!person.active},generated_at:now(),
    tables:rows,totals:{tables:rows.length,records:rows.reduce((sum,r)=>sum+r.rows,0),as_subject:rows.filter(r=>r.role==='subject').length,as_actor:rows.filter(r=>r.role==='actor').length},
    note:'أسماء الجداول وعدد السجلات فقط، بلا أي محتوى. «موضوع السجل» بيانات عن الشخص، و«أثر فعل» سجلات نفّذها هو (قرار، اعتماد، إدخال) وحذفها يمس سجل عمل غيره. البيانات نفسها تُقرأ من شاشتها المختصة بصلاحيتها، لا من هنا.'};
}

// ما يمكن حذفه وما لا يمكن ولماذا. لا حذف آليًا إطلاقًا: هذه قراءة تسبق قرارًا بشريًا.
export function deletionAssessment(db,supplied,userId){
  const {tables,...map}=subjectDataMap(db,supplied,userId);
  const entries=tables.map(t=>{
    const reasons=[];
    if(t.blocked_by)reasons.push(`قاعدة البيانات نفسها تمنع الحذف من هذا الجدول (قيد ${t.blocked_by}).`);
    if(t.role==='actor')reasons.push('السجلات هنا أثر فعل هذا الشخص في عمل غيره (قرار أو اعتماد أو إدخال)؛ حذفها يكسر سجلًا يخص آخرين.');
    if(t.referenced_by)reasons.push(`${t.referenced_by} جدولًا آخر يشير إلى هذا الجدول بمفتاح أجنبي.`);
    return {...t,removable:!reasons.length,reasons:reasons.length?reasons:['لا مانع تقني ظاهر. القرار بشري: يحتاج أساسًا مكتوبًا وموافقة مالك السجل قبل أي إجراء.']};
  });
  return {...map,entries,removable:entries.filter(e=>e.removable).length,blocked:entries.filter(e=>!e.removable).length,
    note:'المنصة لا تحذف شيئًا من هنا، لا الآن ولا لاحقًا. هذه قائمة يقرؤها إنسان قبل أن يقرر، وكل حذف يُنفذ في شاشته المختصة بيد صاحب الصلاحية مع سنده. الأثر المحاسبي والتدقيقي قد يمنع الحذف أصلًا.'};
}

/* ───── اشتقاق أنشطة المعالجة المرشحة من وحدات المنصة القائمة ───── */
// أسماء أعمدة حقيقية في القاعدة، بلغة يقرؤها المالك. ما لا اسم له هنا يظهر باسمه التقني كما هو.
const COLUMN_LABELS={name:'الاسم',contact:'وسيلة الاتصال',email:'البريد الإلكتروني',phone:'رقم الجوال',username:'اسم المستخدم',
  job_title:'المسمى الوظيفي',join_date:'تاريخ الالتحاق',employment_type:'نوع التعاقد',work_location:'مقر العمل',start_date:'تاريخ البداية',end_date:'تاريخ النهاية',
  iban:'رقم الحساب البنكي',iban_last4:'آخر أربعة من الحساب البنكي',bank_name:'اسم البنك',pay_lines:'بنود الأجر',monthly_total_minor:'إجمالي الأجر الشهري',
  gross_minor:'إجمالي الأجر',net_minor:'صافي الأجر',social_insurance_minor:'استقطاع التأمينات',advance_minor:'السلف',amount_minor:'المبلغ',
  check_in_at:'وقت الحضور',check_out_at:'وقت الانصراف',work_date:'يوم العمل',reason:'سبب الطلب',days:'أيام الإجازة',
  scores:'درجات التقييم',scores_json:'درجات التقييم',manager_summary:'ملخص المدير',self_text:'التقييم الذاتي',appeal_text:'نص التظلم',recommendation:'التوصية',
  offer_json:'تفاصيل العرض الوظيفي',consent_evidence:'دليل موافقة المرشح',interview_date:'موعد المقابلة',source:'مصدر المرشح',
  doc_type:'نوع الوثيقة',reference:'رقم الوثيقة',expires_on:'تاريخ انتهاء الوثيقة',issued_on:'تاريخ الإصدار',evidence:'دليل مرفق',evidence_reference:'مرجع الدليل',
  title:'العنوان',field:'التخصص',institution:'الجهة المانحة',year:'السنة',skills:'المهارات',years_total:'سنوات الخبرة',previous_roles:'أدوار سابقة',
  secret:'سر التحقق بخطوتين',recovery:'رموز الاسترجاع',password_hash:'بصمة كلمة المرور',ip:'عنوان الشبكة',
  description:'وصف حر',note:'ملاحظة حرة',decision_note:'سبب القرار',receipt_reference:'مرجع الإيصال'};
// أعمدة تستدعي نظرة المختص قبل وسم النشاط. الوسم اقتراح يراجعه إنسان، لا تصنيفًا نظاميًا.
const SENSITIVE_HINTS=new Set(['iban','iban_last4','bank_name','pay_lines','monthly_total_minor','gross_minor','net_minor','social_insurance_minor','advance_minor',
  'secret','recovery','password_hash','scores','scores_json','manager_summary','self_text','appeal_text','offer_json','recommendation','consent_evidence']);
const ACTIVITY_CANDIDATES=[
  {key:'payroll',name:'إعداد الرواتب وصرفها',purpose:'احتساب أجور الموظفين وبدلاتهم واستقطاعاتهم، وإصدار أوامر الدفع وقيدها في الدفتر المالي.',subjects:['employees'],
    tables:['payroll_runs','payroll_lines','payroll_adjustments','payroll_retro','employee_bank_accounts','salary_advances'],access:'من يُعِدّ المسير ومن يراجعه ومن يعتمده ومن ينفذ الدفع'},
  {key:'attendance',name:'الحضور والانصراف والإجازات',purpose:'تسجيل أوقات الحضور والانصراف والمهمات والإجازات، وما يترتب عليها في الأجر.',subjects:['employees'],
    tables:['attendance_records','attendance_corrections','attendance_absences','overtime_requests','shift_assignments','work_missions','leave_requests','leave_balances'],access:'الموظف نفسه ومديره المباشر وخدمات الموظف'},
  {key:'employee_file',name:'السجل الوظيفي وعقود العمل',purpose:'حفظ بيانات التوظيف والعقد وبنود الأجر والوثائق الرسمية والمؤهلات طوال علاقة العمل.',subjects:['employees'],
    tables:['employee_profiles','employment_contracts','employee_documents','employee_qualifications','employee_changes','employee_career'],access:'خدمات الموظف ومن يعتمد العقود، والموظف على ملفه هو'},
  {key:'hiring',name:'التوظيف واستقطاب المرشحين',purpose:'استقبال المرشحين وتقييمهم وتوثيق قرار التعيين والتهيئة.',subjects:['candidates'],
    tables:['people_candidates','people_evaluations','people_events','people_onboarding_tasks','people_requisitions'],access:'فريق التوظيف ومدير الإدارة الطالبة ولجنة المقابلة'},
  {key:'performance',name:'تقييم الأداء والتطوير',purpose:'إدارة دورات التقييم والتغذية الراجعة وأهداف التطوير وسجلات التدريب.',subjects:['employees'],
    tables:['performance_reviews','development_goals','training_records','succession_candidates','review_cycles'],access:'الموظف ومديره ومن يعاير التقييم ويبت في التظلمات'},
  {key:'procurement',name:'المشتريات والموردون',purpose:'تسجيل الموردين وجهات اتصالهم وتأهيلهم وتقييمهم وإقرارات تضارب المصالح.',subjects:['vendors','employees'],
    tables:['vendors','vendor_contacts','vendor_reviews','vendor_conflict_disclosures','procurement_quotes'],access:'المشتريات والمراجعة القانونية والمالية'},
  {key:'clients',name:'حسابات العملاء وجهات اتصالهم',purpose:'حفظ جهات اتصال العملاء وفرق الحسابات وما يرتبط بها من موافقات وتسليمات.',subjects:['client_contacts'],
    tables:['clients','client_contacts','client_members','client_brands'],access:'فريق الحساب ومدير الإدارة'},
  {key:'expenses',name:'المصروفات والعهد والمطالبات',purpose:'مطالبات الموظفين بالمصروفات والعهد وإيصالاتها وصرفها.',subjects:['employees'],
    tables:['expense_claims','custodies','service_settlements'],access:'صاحب المطالبة ومديره والمالية'},
  {key:'access_audit',name:'الدخول والتصاريح وسجل التدقيق',purpose:'إدارة الحسابات والتصاريح والتحقق بخطوتين، وحفظ سجل تدقيق غير قابل للتعديل لكل فعل.',subjects:['employees'],
    tables:['users','sessions','access_grants','user_totp','audit_events'],access:'مسؤول المنصة ومن يمنح التصاريح'}
];
// المشتق: الجداول الموجودة فعلًا وأعمدتها. غير المشتق (الأساس النظامي، مدة الاحتفاظ، الإتلاف) يبقى فارغًا حتى يملأه صاحبه.
function activitySuggestion(db,candidate){
  const tables=candidate.tables.filter(t=>tableExists(db,t));
  if(!tables.length)return null;
  const columns=new Set(),flagged=new Set();
  for(const table of tables)for(const c of db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name)){
    if(SENSITIVE_HINTS.has(c))flagged.add(COLUMN_LABELS[c]??c);
    if(COLUMN_LABELS[c])columns.add(COLUMN_LABELS[c]);
  }
  return {name:candidate.name,purpose:candidate.purpose,subject_categories:candidate.subjects,
    data_categories:[...columns].join('، ')||tables.join('، '),internal_access:candidate.access,
    sensitive:flagged.size?1:0,sensitive_note:flagged.size?`وسم مقترح من أعمدة قائمة فعلًا: ${[...flagged].join('، ')}. تصنيف البيانات حساسةً قرار المختص لا استنتاج المنصة.`:'',
    source_tables:tables.join(','),tables};
}
export function suggestedActivities(db,supplied){
  const u=actor(db,supplied);allowed(db,u);
  const taken=new Set(db.prepare("SELECT name FROM processing_activities WHERE tenant_id=? AND status<>'superseded'").all(u.tenant_id).map(r=>r.name));
  return ACTIVITY_CANDIDATES.map(c=>({key:c.key,...activitySuggestion(db,c),recorded:taken.has(c.name)})).filter(c=>c.name);
}
// مثل draftMissingCards: اقتراح يعتمده إنسان، لا سجل يُنشأ آليًا. كل مسودة تُنشأ ناقصة الأساس والمدة عمدًا.
export function draftSuggestedActivities(db,supplied,input){
  writing(db);const u=actor(db,supplied);allowed(db,u);
  v.object(input??{},['owner_id']);
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input?.owner_id,u.tenant_id);
  if(!owner)fail(400,'owner_id','اختر مالكًا للأنشطة المقترحة يراجعها ويعتمدها');
  if(owner.id===u.id)fail(409,'separation_of_duties','من يعد الاقتراح لا يكون مالكه الذي يعتمده');
  let created=0;const skipped=[];
  for(const candidate of ACTIVITY_CANDIDATES){
    const suggestion=activitySuggestion(db,candidate);
    if(!suggestion){skipped.push(`${candidate.name}: لا جدول من جداولها في هذه القاعدة`);continue;}
    if(db.prepare("SELECT 1 FROM processing_activities WHERE tenant_id=? AND name=? AND status<>'superseded'").get(u.tenant_id,suggestion.name))continue;
    insertActivity(db,u,{...suggestion,subject_categories:suggestion.subject_categories.join(','),owner_id:owner.id,next_review_date:null,supersedes_id:null},'suggested');
    created++;
  }
  audit(db,u,'processing_activity','bulk','privacy.activities_suggested',{}, {created,owner:owner.id});
  return {created,skipped};
}

/* ───── سجل أنشطة المعالجة ───── */
const ACTIVITY_FIELDS=['id','version','name','purpose','subject_categories','data_categories','sensitive','sensitive_note','legal_basis','legal_basis_source','legal_basis_confirmed_on','internal_access','retention_period','retention_source','retention_confirmed_on','disposal_action','owner_id','next_review_date','supersedes_id'];
function insertActivity(db,u,f,origin){
  const id=randomUUID(),time=now();
  db.prepare(`INSERT INTO processing_activities(id,tenant_id,name,purpose,subject_categories,data_categories,sensitive,sensitive_note,legal_basis,legal_basis_source,legal_basis_confirmed_on,internal_access,retention_period,retention_source,retention_confirmed_on,disposal_action,owner_id,next_review_date,origin,source_tables,status,supersedes_id,prepared_by,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,1,?,?)`)
    .run(id,u.tenant_id,f.name,f.purpose,f.subject_categories,f.data_categories,f.sensitive,f.sensitive_note,f.legal_basis??'',f.legal_basis_source??'',f.legal_basis_confirmed_on??null,f.internal_access??'',f.retention_period??'',f.retention_source??'',f.retention_confirmed_on??null,f.disposal_action??'',f.owner_id,f.next_review_date??null,origin,f.source_tables??'',f.supersedes_id??null,u.id,time,time);
  return id;
}
// الأساس النظامي والمدة: نص حر يملؤه المختص، ولا يُقبل بلا مصدر وتاريخ تأكيد. القاعدة تفرض الاقتران، والكود يشرحه.
function sourced(input,valueKey,sourceKey,dateKey,label){
  const value=input[valueKey]?v.text(input[valueKey],label,1000,3):'';
  if(!value)return {value:'',source:'',confirmed:null};
  const source=v.text(input[sourceKey]??'',`مصدر ${label} ومن أكده`,1000,10),confirmed=v.date(input[dateKey]??'');
  if(confirmed>today())fail(400,dateKey,`تاريخ تأكيد ${label} لا يكون في المستقبل`);
  return {value,source,confirmed};
}
function activityInput(db,u,input){
  const subjects=list(input.subject_categories);
  if(!subjects.length||subjects.some(k=>!Object.hasOwn(SUBJECT_CATEGORIES,k)))fail(400,'subject_categories','اختر فئة أصحاب البيانات');
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id);
  if(!owner)fail(400,'owner_id','مالك النشاط غير متاح');
  const basis=sourced(input,'legal_basis','legal_basis_source','legal_basis_confirmed_on','الأساس النظامي');
  const retention=sourced(input,'retention_period','retention_source','retention_confirmed_on','مدة الاحتفاظ');
  const sensitive=input.sensitive?1:0;
  return {name:v.text(input.name,'اسم النشاط',200,5),purpose:v.text(input.purpose,'الغرض',2000,10),
    subject_categories:subjects.join(','),data_categories:v.text(input.data_categories,'فئات البيانات',2000,2),
    sensitive,sensitive_note:sensitive?v.text(input.sensitive_note,'ما الحساس فيها ومن قرر ذلك',1000,5):'',
    legal_basis:basis.value,legal_basis_source:basis.source,legal_basis_confirmed_on:basis.confirmed,
    internal_access:input.internal_access?v.text(input.internal_access,'من يطلع عليها داخليًا',1000,3):'',
    retention_period:retention.value,retention_source:retention.source,retention_confirmed_on:retention.confirmed,
    disposal_action:input.disposal_action?v.text(input.disposal_action,'إجراء الإتلاف',1000,3):'',
    owner_id:owner.id,next_review_date:input.next_review_date?v.date(input.next_review_date):null};
}
export function saveActivity(db,supplied,input){
  writing(db);const u=actor(db,supplied);allowed(db,u);
  v.object(input,ACTIVITY_FIELDS);const f=activityInput(db,u,input);
  if(f.owner_id===u.id)fail(409,'separation_of_duties','من يُعِدّ السجل لا يكون مالكه الذي يعتمده');
  if(!input.id){
    if(input.supersedes_id)fail(400,'supersedes_id','الاستبدال يبدأ من النشاط المعتمد نفسه');
    const id=insertActivity(db,u,f,'manual');
    audit(db,u,'processing_activity',id,'privacy.activity_drafted',{}, {name:f.name});
    return {id};
  }
  const draft=db.prepare("SELECT * FROM processing_activities WHERE id=? AND tenant_id=? AND status='draft'").get(input.id,u.tenant_id);
  if(!draft)fail(404,'not_found','لا مسودة نشاط بهذا المعرف');
  v.version(input.version,draft.version);
  db.prepare('UPDATE processing_activities SET name=?,purpose=?,subject_categories=?,data_categories=?,sensitive=?,sensitive_note=?,legal_basis=?,legal_basis_source=?,legal_basis_confirmed_on=?,internal_access=?,retention_period=?,retention_source=?,retention_confirmed_on=?,disposal_action=?,owner_id=?,next_review_date=?,prepared_by=?,version=version+1,updated_at=? WHERE id=?')
    .run(f.name,f.purpose,f.subject_categories,f.data_categories,f.sensitive,f.sensitive_note,f.legal_basis,f.legal_basis_source,f.legal_basis_confirmed_on,f.internal_access,f.retention_period,f.retention_source,f.retention_confirmed_on,f.disposal_action,f.owner_id,f.next_review_date,u.id,now(),draft.id);
  audit(db,u,'processing_activity',draft.id,'privacy.activity_edited',{name:draft.name},{name:f.name});
  return {id:draft.id};
}
const activityGaps=a=>[!a.legal_basis.trim()&&'الأساس النظامي ومصدره',!a.retention_period.trim()&&'مدة الاحتفاظ ومصدرها',!a.disposal_action.trim()&&'إجراء الإتلاف',!a.internal_access.trim()&&'من يطلع عليها داخليًا',!a.next_review_date&&'تاريخ المراجعة التالية'].filter(Boolean);
function activityView(db,u,a){
  const gaps=activityGaps(a),actions=[];
  if(a.status==='draft'&&a.owner_id===u.id&&a.prepared_by!==u.id)actions.push('approve_activity');
  if(a.status==='draft')actions.push('edit_activity');
  if(a.status==='approved')actions.push('supersede_activity');
  const overdue=a.status==='approved'&&a.next_review_date&&a.next_review_date<today();
  return {...a,sensitive:!!a.sensitive,subject_categories:a.subject_categories.split(',').filter(Boolean),
    subject_names:a.subject_categories.split(',').filter(Boolean).map(k=>SUBJECT_CATEGORIES[k]??k),
    owner_name:name(db,a.owner_id),prepared_by_name:name(db,a.prepared_by),approved_by_name:name(db,a.approved_by),
    gaps,review_overdue:!!overdue,review_due_in:a.next_review_date?days(today(),a.next_review_date):null,
    legal_review:LEGAL_REVIEW,state_name:a.status==='approved'?(overdue?'معتمد — مراجعته متأخرة':'معتمد'):a.status==='superseded'?'حل محله سجل أحدث':'مسودة بانتظار اعتماد مالكها',actions};
}
export function activityAction(db,supplied,activityId,action,input){
  writing(db);const u=actor(db,supplied);allowed(db,u);
  if(action==='edit_activity')fail(400,'use_save','تعديل المسودة يتم من نموذج حفظ النشاط');
  const a=typeof activityId==='string'&&db.prepare('SELECT * FROM processing_activities WHERE id=? AND tenant_id=?').get(activityId,u.tenant_id);
  if(!a)fail(404,'not_found','النشاط غير متاح');
  const current=activityView(db,u,a);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة النشاط أو لحسابك');
  const time=now();
  if(action==='approve_activity'){
    v.object(input,['version','note']);v.version(input.version,a.version);
    if(a.prepared_by===u.id)fail(409,'separation_of_duties','من أعدّ السجل لا يعتمده');
    if(current.gaps.length)fail(409,'activity_incomplete',`ينقص النشاط: ${current.gaps.join('، ')}`);
    const note=v.text(input.note,'إقرارك بملكية النشاط',1000,10);
    db.prepare("UPDATE processing_activities SET status='approved',approved_by=?,approved_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,a.id);
    audit(db,u,'processing_activity',a.id,'privacy.activity_approved',{status:a.status},{status:'approved'},note);
    return {id:a.id};
  }
  if(action==='supersede_activity'){
    v.object(input,['version','note']);v.version(input.version,a.version);
    if(a.owner_id===u.id)fail(409,'separation_of_duties','مالك النشاط لا يُعِدّ بديله بنفسه ثم يعتمده؛ يبدأه معدّ آخر');
    const note=v.text(input.note,'سبب الاستبدال',1000,10);
    // المعتمد لا يُعدَّل: يُحال إلى «حل محله» بنصه كما هو، ثم تُفتح مسودة جديدة منه تحمل الاسم نفسه.
    db.prepare("UPDATE processing_activities SET status='superseded',version=version+1,updated_at=? WHERE id=?").run(time,a.id);
    const replacement=insertActivity(db,u,{...a,supersedes_id:a.id},a.origin);
    audit(db,u,'processing_activity',a.id,'privacy.activity_superseded',{status:'approved'},{replacement},note);
    return {id:replacement};
  }
  fail(409,'invalid_state','الإجراء غير معروف');
}

/* ───── نقل البيانات خارج المملكة ───── */
// نقل تفعله المنصة نفسها. لا يُنشأ سجله آليًا: يظهر «بانتظار قرار المالك» حتى يسجله ويقيّمه مختص.
const PLATFORM_TRANSFERS=[{slug:'ai_model_provider',title:'استدعاء نموذج لغوي مستضاف خارج المملكة',
  module:'وحدة المساعدين الذكيين (app/ai.mjs)',
  detail:'يرسل المساعد ما يجهزه من بيانات المنصة إلى واجهة مزود النموذج ليعيد مسودة نصية. ما يُرسل يعتمد على المساعد المستخدم: فقرات سياسات، أو تعريف خدمة، أو ملف مهني، أو صفوف تقرير، أو نص يلصقه الموظف.'}];
function aiTransferEvidence(db,u){
  if(!tableExists(db,'ai_settings')||!tableExists(db,'ai_runs'))return {enabled:false,external_runs:0,last_run:null,providers:[],evidence:'وحدة المساعدين غير مثبتة في هذه القاعدة.'};
  const enabled=!!db.prepare('SELECT enabled FROM ai_settings WHERE tenant_id=?').get(u.tenant_id)?.enabled;
  // «المزود المفعّل فعلًا» = تشغيلات خرجت إلى مزود خارجي بالفعل، لا ما هو مهيأ نظريًا.
  const runs=db.prepare("SELECT COUNT(*) AS n,MAX(created_at) AS last FROM ai_runs WHERE tenant_id=? AND provider<>'retrieval'").get(u.tenant_id);
  const providers=db.prepare("SELECT DISTINCT provider,model FROM ai_runs WHERE tenant_id=? AND provider<>'retrieval' ORDER BY provider").all(u.tenant_id);
  return {enabled,external_runs:runs.n,last_run:runs.last,providers,
    evidence:`المساعدون ${enabled?'مفعّلون من الأدمن الأول':'غير مفعّلين'}؛ عدد التشغيلات التي خرجت إلى مزود خارجي: ${runs.n}${runs.last?` وآخرها ${runs.last.slice(0,10)}`:''}.`};
}
function transferView(db,u,t){
  const actions=[];
  if(t.status==='pending')actions.push('assess_transfer');
  if(t.status==='assessed'&&t.assessed_by!==u.id)actions.push('approve_transfer');
  if(t.status!=='stopped')actions.push('stop_transfer');
  const overdue=t.next_review_date&&t.next_review_date<today();
  return {...t,state_name:overdue&&t.status==='approved'?'معتمد — مراجعته متأخرة':TRANSFER_STATES[t.status],review_overdue:!!overdue,
    recorded_by_name:name(db,t.recorded_by),assessed_by_name:name(db,t.assessed_by),approved_by_name:name(db,t.approved_by),legal_review:LEGAL_REVIEW,actions};
}
export function recordTransfer(db,supplied,input){
  writing(db);const u=actor(db,supplied);allowed(db,u);
  v.object(input,['slug','recipient','country','purpose','data_categories','safeguard','safeguard_source','next_review_date']);
  const platform=PLATFORM_TRANSFERS.find(p=>p.slug===input.slug);
  if(input.slug&&!platform)fail(400,'slug','النقل المشتق من المنصة غير معروف');
  const slug=platform?platform.slug:randomUUID();
  if(db.prepare('SELECT 1 FROM data_transfers WHERE tenant_id=? AND slug=?').get(u.tenant_id,slug))fail(409,'duplicate_transfer','هذا النقل مسجل');
  const safeguard=input.safeguard?v.text(input.safeguard,'الضمانة التعاقدية',1000,5):'';
  const id=randomUUID(),time=now();
  db.prepare('INSERT INTO data_transfers(id,tenant_id,slug,recipient,country,purpose,data_categories,safeguard,safeguard_source,next_review_date,status,origin,recorded_by,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)')
    .run(id,u.tenant_id,slug,v.text(input.recipient,'الجهة المستقبِلة',200,2),v.text(input.country,'البلد',120,2),v.text(input.purpose,'الغرض',2000,10),v.text(input.data_categories,'فئات البيانات',2000,2),
      safeguard,safeguard?v.text(input.safeguard_source,'مرجع الضمانة ومن أكدها',1000,10):'',input.next_review_date?v.date(input.next_review_date):null,'pending',platform?'platform':'manual',u.id,time,time);
  audit(db,u,'data_transfer',id,'privacy.transfer_recorded',{}, {slug,country:input.country});
  return {id};
}
export function transferAction(db,supplied,transferId,action,input){
  writing(db);const u=actor(db,supplied);allowed(db,u);
  const t=typeof transferId==='string'&&db.prepare('SELECT * FROM data_transfers WHERE id=? AND tenant_id=?').get(transferId,u.tenant_id);
  if(!t)fail(404,'not_found','سجل النقل غير متاح');
  const current=transferView(db,u,t);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة النقل أو لحسابك');
  const time=now();
  if(action==='assess_transfer'){
    v.object(input,['version','risk_assessment','safeguard','safeguard_source','next_review_date']);v.version(input.version,t.version);
    const risk=v.text(input.risk_assessment,'تقييم المخاطر',4000,20),safeguard=input.safeguard?v.text(input.safeguard,'الضمانة التعاقدية',1000,5):t.safeguard;
    if(!safeguard.trim())fail(400,'safeguard','اذكر الضمانة التعاقدية أو اكتب صراحة أنه لا ضمانة حتى الآن');
    db.prepare("UPDATE data_transfers SET risk_assessment=?,assessed_by=?,assessed_at=?,safeguard=?,safeguard_source=?,next_review_date=?,status='assessed',version=version+1,updated_at=? WHERE id=?")
      .run(risk,u.id,time,safeguard,input.safeguard?v.text(input.safeguard_source??'','مرجع الضمانة ومن أكدها',1000,10):t.safeguard_source,input.next_review_date?v.date(input.next_review_date):t.next_review_date,time,t.id);
    audit(db,u,'data_transfer',t.id,'privacy.transfer_assessed',{status:t.status},{status:'assessed'});
    return {id:t.id};
  }
  if(action==='approve_transfer'){
    v.object(input,['version','note']);v.version(input.version,t.version);
    if(t.assessed_by===u.id)fail(409,'separation_of_duties','من قيّم المخاطر لا يعتمد النقل');
    const note=v.text(input.note,'قرارك وما استندت إليه',1000,10);
    db.prepare("UPDATE data_transfers SET status='approved',approved_by=?,approved_at=?,approval_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,time,t.id);
    audit(db,u,'data_transfer',t.id,'privacy.transfer_approved',{status:t.status},{status:'approved'},note);
    return {id:t.id};
  }
  v.object(input,['version','note']);v.version(input.version,t.version);
  const note=v.text(input.note,'سبب الإيقاف',1000,10);
  db.prepare("UPDATE data_transfers SET status='stopped',version=version+1,updated_at=? WHERE id=?").run(time,t.id);
  audit(db,u,'data_transfer',t.id,'privacy.transfer_stopped',{status:t.status},{status:'stopped'},note);
  return {id:t.id};
}

/* ───── جدول الاحتفاظ: تنبيه لا تنفيذ ───── */
function ruleView(db,u,r){
  const left=days(today(),r.next_check_date),state=!r.active?'inactive':left<0?'overdue':left<=REVIEW_LEAD_DAYS?'due_soon':'scheduled',actions=[];
  if(r.active)actions.push('record_check','edit_rule','deactivate_rule');else actions.push('activate_rule');
  return {...r,active:!!r.active,owner_name:name(db,r.owner_id),last_checked_by_name:name(db,r.last_checked_by),days_left:left,state,
    state_name:{inactive:'موقوفة',overdue:'حان موعد المراجعة وتأخر',due_soon:'موعد المراجعة قريب',scheduled:'مجدولة'}[state],
    missing_period:!r.retention_period.trim(),legal_review:LEGAL_REVIEW,actions};
}
export function saveRetentionRule(db,supplied,input){
  writing(db);const u=actor(db,supplied);allowed(db,u);
  v.object(input,['id','version','data_category','retention_period','retention_source','confirmed_on','disposal_action','owner_id','next_check_date']);
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id);
  if(!owner)fail(400,'owner_id','مالك القاعدة غير متاح');
  const period=sourced(input,'retention_period','retention_source','confirmed_on','مدة الاحتفاظ');
  const category=v.text(input.data_category,'فئة البيانات',200,3),next=v.date(input.next_check_date),time=now();
  if(next<today())fail(400,'next_check_date','موعد التنبيه اليوم أو بعده');
  const disposal=input.disposal_action?v.text(input.disposal_action,'إجراء الإتلاف',1000,3):'';
  if(!input.id){
    if(db.prepare('SELECT 1 FROM retention_rules WHERE tenant_id=? AND data_category=?').get(u.tenant_id,category))fail(409,'duplicate_rule','فئة البيانات مسجلة');
    const id=randomUUID();
    db.prepare('INSERT INTO retention_rules(id,tenant_id,data_category,retention_period,retention_source,confirmed_on,disposal_action,owner_id,next_check_date,recorded_by,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)')
      .run(id,u.tenant_id,category,period.value,period.source,period.confirmed,disposal,owner.id,next,u.id,time,time);
    audit(db,u,'retention_rule',id,'privacy.retention_recorded',{}, {data_category:category,has_period:!!period.value});
    return {id};
  }
  const r=db.prepare('SELECT * FROM retention_rules WHERE id=? AND tenant_id=?').get(input.id,u.tenant_id);
  if(!r)fail(404,'not_found','القاعدة غير متاحة');
  v.version(input.version,r.version);
  db.prepare('UPDATE retention_rules SET data_category=?,retention_period=?,retention_source=?,confirmed_on=?,disposal_action=?,owner_id=?,next_check_date=?,version=version+1,updated_at=? WHERE id=?')
    .run(category,period.value,period.source,period.confirmed,disposal,owner.id,next,time,r.id);
  audit(db,u,'retention_rule',r.id,'privacy.retention_edited',{retention_period:r.retention_period},{retention_period:period.value});
  return {id:r.id};
}
export function retentionAction(db,supplied,ruleId,action,input){
  writing(db);const u=actor(db,supplied);allowed(db,u);
  const r=typeof ruleId==='string'&&db.prepare('SELECT * FROM retention_rules WHERE id=? AND tenant_id=?').get(ruleId,u.tenant_id);
  if(!r)fail(404,'not_found','القاعدة غير متاحة');
  const current=ruleView(db,u,r);
  if(!current.actions.includes(action)||action==='edit_rule')fail(409,'invalid_state','الإجراء غير متاح في حالة القاعدة');
  const time=now();
  if(action==='record_check'){
    v.object(input,['version','note','next_check_date']);v.version(input.version,r.version);
    const next=v.date(input.next_check_date);if(next<=today())fail(400,'next_check_date','موعد التنبيه التالي بعد اليوم');
    // توثيق ما فعله الإنسان بعد التنبيه. المنصة لم تتلف شيئًا ولن تفعل.
    db.prepare('UPDATE retention_rules SET last_checked_on=?,last_checked_by=?,last_check_note=?,next_check_date=?,version=version+1,updated_at=? WHERE id=?')
      .run(today(),u.id,v.text(input.note,'ما الذي روجع وما الذي تقرر',2000,10),next,time,r.id);
    audit(db,u,'retention_rule',r.id,'privacy.retention_checked',{}, {next_check_date:next});
    return {id:r.id};
  }
  v.object(input,['version','note']);v.version(input.version,r.version);
  const note=v.text(input.note,'السبب',1000,5);
  db.prepare('UPDATE retention_rules SET active=?,version=version+1,updated_at=? WHERE id=?').run(action==='activate_rule'?1:0,time,r.id);
  audit(db,u,'retention_rule',r.id,'privacy.retention_'+action,{active:!!r.active},{active:action==='activate_rule'},note);
  return {id:r.id};
}

/* ───── حوادث حماية البيانات ───── */
function incidentView(db,u,i){
  const actions=[];
  if(i.status!=='closed'){actions.push('update_incident');if(i.reported_by!==u.id&&i.remediation.trim()&&i.lessons.trim())actions.push('close_incident');}
  return {...i,owner_name:name(db,i.owner_id),reported_by_name:name(db,i.reported_by),closed_by_name:name(db,i.closed_by),
    state_name:INCIDENT_STATES[i.status],missing_deadline:!i.notification_deadline,legal_review:LEGAL_REVIEW,
    gaps:[!i.notification_deadline&&'مهلة الإبلاغ ومصدرها',!i.remediation.trim()&&'خطوات المعالجة',!i.lessons.trim()&&'الدروس المستفادة'].filter(Boolean),actions};
}
export function recordIncident(db,supplied,input){
  writing(db);const u=actor(db,supplied);allowed(db,u);
  v.object(input,['title','description','impact','affected_count','discovered_on','occurred_on','owner_id']);
  const owner=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id);
  if(!owner)fail(400,'owner_id','مالك الحادثة غير متاح');
  const discovered=v.date(input.discovered_on);if(discovered>today())fail(400,'discovered_on','تاريخ الاكتشاف لا يكون في المستقبل');
  const occurred=input.occurred_on?v.date(input.occurred_on):null;
  if(occurred&&occurred>discovered)fail(400,'occurred_on','تاريخ الوقوع قبل الاكتشاف أو مساوٍ له');
  const count=input.affected_count===''||input.affected_count===null||input.affected_count===undefined?null:Number(input.affected_count);
  if(count!==null&&(!Number.isInteger(count)||count<0))fail(400,'affected_count','عدد المتأثرين رقم صحيح أو اتركه فارغًا حتى يُعرف');
  const id=randomUUID(),time=now();
  db.prepare('INSERT INTO privacy_incidents(id,tenant_id,title,description,impact,affected_count,discovered_on,occurred_on,owner_id,status,reported_by,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?)')
    .run(id,u.tenant_id,v.text(input.title,'عنوان الحادثة',200,5),v.text(input.description,'وصف الحادثة',4000,20),v.text(input.impact,'الأثر ومن تأثر',2000,10),count,discovered,occurred,owner.id,'open',u.id,time,time);
  audit(db,u,'privacy_incident',id,'privacy.incident_recorded',{}, {discovered_on:discovered});
  return {id};
}
export function incidentAction(db,supplied,incidentId,action,input){
  writing(db);const u=actor(db,supplied);allowed(db,u);
  const i=typeof incidentId==='string'&&db.prepare('SELECT * FROM privacy_incidents WHERE id=? AND tenant_id=?').get(incidentId,u.tenant_id);
  if(!i)fail(404,'not_found','الحادثة غير متاحة');
  const current=incidentView(db,u,i);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة الحادثة أو لحسابك');
  const time=now();
  if(action==='update_incident'){
    v.object(input,['version','status','notification_deadline','notification_deadline_source','notified_on','notification_note','remediation','lessons']);
    v.version(input.version,i.version);
    if(!['open','contained'].includes(input.status))fail(400,'status','اختر حالة الحادثة');
    // مهلة الإبلاغ رقم نظامي: يدخلها المختص بمصدرها، والمنصة لا تعرفها ولا تحسبها.
    const deadline=input.notification_deadline?v.date(input.notification_deadline):null;
    const deadlineSource=deadline?v.text(input.notification_deadline_source,'مصدر المهلة ومن أكدها',1000,10):'';
    if(!deadline&&i.notification_deadline)fail(400,'notification_deadline','لا تُمسح مهلة مسجلة. صححها بمهلة ومصدر جديدين');
    const notified=input.notified_on?v.date(input.notified_on):null;
    db.prepare('UPDATE privacy_incidents SET status=?,notification_deadline=?,notification_deadline_source=?,notified_on=?,notification_note=?,remediation=?,lessons=?,version=version+1,updated_at=? WHERE id=?')
      .run(input.status,deadline,deadlineSource,notified,input.notification_note?v.text(input.notification_note,'ملاحظة الإبلاغ',2000,3):i.notification_note,
        input.remediation?v.text(input.remediation,'خطوات المعالجة',4000,10):i.remediation,input.lessons?v.text(input.lessons,'الدروس المستفادة',4000,10):i.lessons,time,i.id);
    audit(db,u,'privacy_incident',i.id,'privacy.incident_updated',{status:i.status},{status:input.status,deadline:!!deadline});
    return {id:i.id};
  }
  v.object(input,['version','note']);v.version(input.version,i.version);
  if(i.reported_by===u.id)fail(409,'separation_of_duties','من رفع الحادثة لا يقفلها');
  const note=v.text(input.note,'ما الذي تحققت منه قبل الإقفال',1000,10);
  db.prepare("UPDATE privacy_incidents SET status='closed',closed_by=?,closed_at=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,time,i.id);
  audit(db,u,'privacy_incident',i.id,'privacy.incident_closed',{status:i.status},{status:'closed'},note);
  return {id:i.id};
}

/* ───── طلبات أصحاب البيانات ───── */
function requestView(db,u,r,{map=false}={}){
  const actions=[];
  if(r.status==='received')actions.push('verify_identity','refuse_request');
  if(r.status==='verified'){actions.push('refuse_request');if(r.identity_verified_by!==u.id)actions.push('answer_request');}
  if(!r.due_date&&['received','verified'].includes(r.status))actions.push('set_due_date');
  if(['answered','refused'].includes(r.status))actions.push('close_request');
  const late=r.due_date&&r.due_date<today()&&['received','verified'].includes(r.status);
  const view={...r,type_name:REQUEST_TYPES[r.request_type],kind_name:REQUESTER_KINDS[r.requester_kind],state_name:REQUEST_STATES[r.status],
    recorded_by_name:name(db,r.recorded_by),identity_verified_by_name:name(db,r.identity_verified_by),answered_by_name:name(db,r.answered_by),refused_by_name:name(db,r.refused_by),
    subject_name:name(db,r.subject_user_id),days_left:r.due_date?days(today(),r.due_date):null,late:!!late,
    identity_required:!r.identity_verified_by,legal_review:LEGAL_REVIEW,actions};
  // الخريطة لا تُحسب إلا بعد التحقق من الهوية، ولطلب اطلاع أو نقل أو حذف. لا تُفتح لطلب لم يُتحقق منه.
  if(map&&r.identity_verified_by&&r.subject_user_id&&['access','port','delete'].includes(r.request_type))
    view.data_map=r.request_type==='delete'?deletionAssessment(db,u,r.subject_user_id):subjectDataMap(db,u,r.subject_user_id);
  return view;
}
export function createSubjectRequest(db,supplied,input){
  writing(db);const u=actor(db,supplied);allowed(db,u);
  v.object(input,['request_type','requester_name','requester_kind','subject_user_id','request_detail','received_on','due_date','due_source']);
  if(!Object.hasOwn(REQUEST_TYPES,input.request_type))fail(400,'request_type','اختر نوع الطلب');
  if(!Object.hasOwn(REQUESTER_KINDS,input.requester_kind))fail(400,'requester_kind','اختر صفة مقدم الطلب');
  const subject=input.subject_user_id?db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=?').get(input.subject_user_id,u.tenant_id):null;
  if(input.subject_user_id&&!subject)fail(400,'subject_user_id','الحساب غير موجود في هذا الكيان');
  const received=v.date(input.received_on);if(received>today())fail(400,'received_on','تاريخ الاستلام لا يكون في المستقبل');
  const due=input.due_date?v.date(input.due_date):null;
  const dueSource=due?v.text(input.due_source,'مصدر المهلة ومن أكدها',1000,10):'';
  if(due&&due<received)fail(400,'due_date','المهلة قبل تاريخ الاستلام');
  const count=db.prepare("SELECT COUNT(*) AS n FROM subject_requests WHERE tenant_id=? AND reference LIKE ?").get(u.tenant_id,`DSR-${received.slice(0,4)}-%`).n;
  const reference=`DSR-${received.slice(0,4)}-${String(count+1).padStart(4,'0')}`,id=randomUUID(),time=now();
  db.prepare('INSERT INTO subject_requests(id,tenant_id,reference,request_type,requester_name,requester_kind,subject_user_id,request_detail,received_on,due_date,due_source,status,recorded_by,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)')
    .run(id,u.tenant_id,reference,input.request_type,v.text(input.requester_name,'اسم مقدم الطلب',200,3),input.requester_kind,subject?.id??null,v.text(input.request_detail,'نص الطلب كما ورد',4000,10),received,due,dueSource,'received',u.id,time,time);
  audit(db,u,'subject_request',id,'privacy.request_received',{}, {reference,request_type:input.request_type});
  return {id,reference};
}
export function requestAction(db,supplied,requestId,action,input){
  writing(db);const u=actor(db,supplied);allowed(db,u);
  const r=typeof requestId==='string'&&db.prepare('SELECT * FROM subject_requests WHERE id=? AND tenant_id=?').get(requestId,u.tenant_id);
  if(!r)fail(404,'not_found','الطلب غير متاح');
  const current=requestView(db,u,r);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة الطلب أو لحسابك');
  const time=now();
  if(action==='verify_identity'){
    v.object(input,['version','identity_evidence']);v.version(input.version,r.version);
    // خطوة إلزامية لا تُتجاوز: لا رد قبلها، والقاعدة ترفض أي رد بدونها.
    db.prepare("UPDATE subject_requests SET identity_verified_by=?,identity_verified_at=?,identity_evidence=?,status='verified',version=version+1,updated_at=? WHERE id=?")
      .run(u.id,time,v.text(input.identity_evidence,'كيف تحققت من هويته وما الدليل',2000,5),time,r.id);
    audit(db,u,'subject_request',r.id,'privacy.identity_verified',{status:r.status},{status:'verified'});
    return {id:r.id};
  }
  if(action==='set_due_date'){
    v.object(input,['version','due_date','due_source']);v.version(input.version,r.version);
    const due=v.date(input.due_date);if(due<r.received_on)fail(400,'due_date','المهلة قبل تاريخ الاستلام');
    db.prepare('UPDATE subject_requests SET due_date=?,due_source=?,version=version+1,updated_at=? WHERE id=?').run(due,v.text(input.due_source,'مصدر المهلة ومن أكدها',1000,10),time,r.id);
    audit(db,u,'subject_request',r.id,'privacy.request_due_set',{}, {due_date:due});
    return {id:r.id};
  }
  if(action==='answer_request'){
    v.object(input,['version','response','response_evidence']);v.version(input.version,r.version);
    if(r.identity_verified_by===u.id)fail(409,'separation_of_duties','من تحقق من الهوية لا يرد على الطلب');
    db.prepare("UPDATE subject_requests SET status='answered',answered_by=?,answered_at=?,response=?,response_evidence=?,version=version+1,updated_at=? WHERE id=?")
      .run(u.id,time,v.text(input.response,'ملخص الرد',4000,10),v.text(input.response_evidence,'دليل الرد: ما أُرسل ومتى وأين حُفظ',2000,5),time,r.id);
    audit(db,u,'subject_request',r.id,'privacy.request_answered',{status:r.status},{status:'answered'});
    return {id:r.id};
  }
  if(action==='refuse_request'){
    v.object(input,['version','reason']);v.version(input.version,r.version);
    const reason=v.text(input.reason,'سبب الرفض وسنده',2000,10);
    db.prepare("UPDATE subject_requests SET status='refused',refused_by=?,refused_at=?,refusal_reason=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,reason,time,r.id);
    audit(db,u,'subject_request',r.id,'privacy.request_refused',{status:r.status},{status:'refused'},reason);
    return {id:r.id};
  }
  v.object(input,['version','note']);v.version(input.version,r.version);
  const note=v.text(input.note,'ما الذي أُقفل عليه الطلب',1000,5);
  db.prepare("UPDATE subject_requests SET status='closed',version=version+1,updated_at=? WHERE id=?").run(time,r.id);
  audit(db,u,'subject_request',r.id,'privacy.request_closed',{status:r.status},{status:'closed'},note);
  return {id:r.id};
}

/* ───── الفحص الذاتي: أعداد صادقة بلا درجة امتثال ───── */
export function privacyPosture(db,supplied){
  const u=actor(db,supplied);allowed(db,u);
  const date=today();
  const activities=db.prepare("SELECT * FROM processing_activities WHERE tenant_id=? AND status<>'superseded'").all(u.tenant_id);
  const transfers=db.prepare("SELECT * FROM data_transfers WHERE tenant_id=? AND status<>'stopped'").all(u.tenant_id);
  const rules=db.prepare('SELECT * FROM retention_rules WHERE tenant_id=? AND active=1').all(u.tenant_id);
  const requests=db.prepare('SELECT * FROM subject_requests WHERE tenant_id=?').all(u.tenant_id);
  const incidents=db.prepare("SELECT * FROM privacy_incidents WHERE tenant_id=? AND status<>'closed'").all(u.tenant_id);
  const recorded=new Set(transfers.map(t=>t.slug));
  return {as_of:date,
    activities:{total:activities.length,approved:activities.filter(a=>a.status==='approved').length,draft:activities.filter(a=>a.status==='draft').length,
      without_legal_basis:activities.filter(a=>!a.legal_basis.trim()).length,without_retention:activities.filter(a=>!a.retention_period.trim()).length,
      without_disposal:activities.filter(a=>!a.disposal_action.trim()).length,review_overdue:activities.filter(a=>a.next_review_date&&a.next_review_date<date).length,
      no_review_date:activities.filter(a=>!a.next_review_date).length},
    transfers:{total:transfers.length,unassessed:transfers.filter(t=>t.status==='pending').length,unapproved:transfers.filter(t=>t.status!=='approved').length,
      without_safeguard:transfers.filter(t=>!t.safeguard.trim()).length,review_overdue:transfers.filter(t=>t.next_review_date&&t.next_review_date<date).length,
      platform_unrecorded:PLATFORM_TRANSFERS.filter(p=>!recorded.has(p.slug)).length},
    retention:{rules:rules.length,without_period:rules.filter(r=>!r.retention_period.trim()).length,checks_overdue:rules.filter(r=>r.next_check_date<date).length,
      never_checked:rules.filter(r=>!r.last_checked_on).length},
    requests:{open:requests.filter(r=>['received','verified'].includes(r.status)).length,identity_pending:requests.filter(r=>r.status==='received').length,
      past_due:requests.filter(r=>r.due_date&&r.due_date<date&&['received','verified'].includes(r.status)).length,without_due_date:requests.filter(r=>!r.due_date&&['received','verified'].includes(r.status)).length},
    incidents:{open:incidents.length,without_deadline:incidents.filter(i=>!i.notification_deadline).length,without_remediation:incidents.filter(i=>!i.remediation.trim()).length},
    // نسبة مئوية هنا تمنح طمأنينة كاذبة: سجل واحد ناقص الأساس النظامي قد يساوي عشرة مكتملة.
    no_score:true,score_note:'لا توجد «درجة امتثال» ولا نسبة مئوية. الأعداد أعلاه هي الصورة، وقراءتها مسؤولية إنسان.'};
}

/* ───── اللوحات ───── */
export function privacyBoard(db,supplied){
  const u=actor(db,supplied);allowed(db,u);
  const date=today();
  const activities=db.prepare('SELECT * FROM processing_activities WHERE tenant_id=? ORDER BY status,name').all(u.tenant_id).map(a=>activityView(db,u,a));
  const transfers=db.prepare('SELECT * FROM data_transfers WHERE tenant_id=? ORDER BY created_at').all(u.tenant_id).map(t=>transferView(db,u,t));
  const rules=db.prepare('SELECT * FROM retention_rules WHERE tenant_id=? ORDER BY active DESC,next_check_date').all(u.tenant_id).map(r=>ruleView(db,u,r));
  const incidents=db.prepare('SELECT * FROM privacy_incidents WHERE tenant_id=? ORDER BY discovered_on DESC').all(u.tenant_id).map(i=>incidentView(db,u,i));
  const ai=aiTransferEvidence(db,u);
  const platform=PLATFORM_TRANSFERS.map(p=>{
    const record=transfers.find(t=>t.slug===p.slug)??null;
    return {...p,recorded:!!record,transfer_id:record?.id??null,evidence:p.slug==='ai_model_provider'?ai.evidence:'',
      active:p.slug==='ai_model_provider'?ai.enabled||ai.external_runs>0:false,
      state:record?record.state_name:'بانتظار قرار المالك — نقل تفعله المنصة ولم يُسجَّل ولم يُقيَّم بعد'};
  });
  return {today:date,user_id:u.id,legal_review:LEGAL_REVIEW,
    subject_categories:SUBJECT_CATEGORIES,transfer_states:TRANSFER_STATES,incident_states:INCIDENT_STATES,
    people:db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id),
    activities,transfers,platform_transfers:platform,retention_rules:rules,incidents,
    suggestions:suggestedActivities(db,u).filter(s=>!s.recorded),posture:privacyPosture(db,u),
    inbox:[...activities.filter(a=>a.actions.includes('approve_activity')).map(a=>({id:a.id,title:`نشاط معالجة بانتظار اعتمادك: ${a.name}`,due_date:a.next_review_date,created_at:a.created_at,actions:['approve_activity']})),
      ...transfers.filter(t=>t.actions.includes('approve_transfer')).map(t=>({id:t.id,title:`نقل بيانات خارج المملكة بانتظار اعتمادك: ${t.recipient}`,due_date:t.next_review_date,created_at:t.created_at,actions:['approve_transfer']})),
      ...rules.filter(r=>r.owner_id===u.id&&['overdue','due_soon'].includes(r.state)).map(r=>({id:r.id,title:`مراجعة احتفاظ مستحقة: ${r.data_category}`,due_date:r.next_check_date,created_at:r.created_at,actions:['record_check']})),
      ...incidents.filter(i=>i.owner_id===u.id&&i.status!=='closed').map(i=>({id:i.id,title:`حادثة حماية بيانات مفتوحة: ${i.title}`,due_date:i.notification_deadline,created_at:i.created_at,actions:['update_incident']}))],
    note:'المنصة تسجّل وتذكّر ولا تفتي. كل مدة احتفاظ وكل أساس نظامي هنا أدخله موظف بمصدره وتاريخ تأكيده، ويبقى بحاجة إلى مراجعة قانونية؛ لا شيء منه رأي المنصة. ولا تتلف المنصة بيانات ولا تحذفها من هذه الشاشة: التنبيه تنبيه، والتنفيذ قرار بشري في شاشته.'};
}
export function subjectRequestsBoard(db,supplied){
  const u=actor(db,supplied);allowed(db,u);
  const rows=db.prepare('SELECT * FROM subject_requests WHERE tenant_id=? ORDER BY received_on DESC,reference DESC').all(u.tenant_id).map(r=>requestView(db,u,r,{map:true}));
  return {today:today(),user_id:u.id,legal_review:LEGAL_REVIEW,
    types:REQUEST_TYPES,kinds:REQUESTER_KINDS,states:REQUEST_STATES,
    people:db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id),
    requests:rows,
    inbox:rows.filter(r=>r.actions.includes('verify_identity')||r.actions.includes('answer_request'))
      .map(r=>({id:r.id,title:`${r.reference} · ${r.type_name} — ${r.actions.includes('verify_identity')?'يحتاج تحققًا من الهوية':'يحتاج ردًا'}`,due_date:r.due_date,created_at:r.created_at,
        actions:[r.actions.includes('verify_identity')?'verify_identity':'answer_request']})),
    note:'التحقق من هوية مقدم الطلب خطوة إلزامية لا تُتجاوز، ومن يتحقق ليس من يرد. خريطة بيانات الشخص تظهر بعد التحقق فقط، وتعطي أسماء الجداول وأعدادها دون أي محتوى. لا حذف آليًا: طلب الحذف يعرض ما يمكن حذفه وما يمنعه قيد محاسبي أو تدقيقي، والقرار بشري في شاشته.'};
}
