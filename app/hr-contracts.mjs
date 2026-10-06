import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { attendanceRuleParameters, RULE_KEYS } from './attendance-policy.mjs';

// سياسات الموارد البشرية وعقود الموظفين. مالك القبول مدير الموارد البشرية (DEC16):
// لا يُفعَّل عقد دون سياسة بنود راتب اعتمدها، ولا يرى الرواتب إلا حامل تصريح صريح وصاحب العقد.
export const POLICY_KINDS=[['pay_components','بنود الراتب المسموحة'],['working_time','ساعات العمل والحضور'],['payroll_cycle','دورة الرواتب'],['end_of_service','نهاية الخدمة']].map(([key,name])=>({key,name}));
export const PAY_COMPONENTS=[['basic','الراتب الأساسي'],['housing','بدل سكن'],['transport','بدل نقل'],['other_allowance','بدل آخر']].map(([key,name])=>({key,name}));
export const CONTRACT_TYPES=[['indefinite','غير محدد المدة'],['fixed_term','محدد المدة']].map(([key,name])=>({key,name}));
export const STATUS_NAMES={draft:'مسودة',pending:'بانتظار الاعتماد',active:'ساري',ended:'منتهٍ',rejected:'مرفوض'};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dayBefore=date=>new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
const id=()=>randomUUID();
const CAPS=['hr.policy.prepare','hr.policy.accept','hr.contracts.manage','hr.contracts.approve'];

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');u.caps=CAPS.filter(key=>holds(db,u,key));return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة سجل العقود معاملة قاعدة بيانات');}
function need(u,key,message){if(!u.caps.includes(key))fail(403,'not_permitted',message);}
function money(value,label){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ شهري بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.');return Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}
const seesPay=(u,contract)=>contract.user_id===u.id||u.caps.includes('hr.contracts.manage')||u.caps.includes('hr.contracts.approve');

// السياسة السارية في تاريخ: الأحدث سريانًا ثم الأحدث قرارًا. وفاصل التعادل (مراجعة 22 سبتمبر): نسختان بتاريخ سريان واحد قُبلتا في الملّي ثانية نفسها
// كانتا بلا ترتيب بينهما فيعود أيهما التقاه المسح، فتُنسخ مسودة رمضان أحيانًا من النسخة الأقدم — الأحدث إعدادًا ثم الصف الأحدث، فالقراءة ثابتة لا تتبدل.
export function acceptedPolicy(db,tenantId,kind,date){
  return db.prepare("SELECT * FROM hr_policies WHERE tenant_id=? AND kind=? AND status='accepted' AND effective_from<=? ORDER BY effective_from DESC,decided_at DESC,created_at DESC,rowid DESC LIMIT 1").get(tenantId,kind,date)??null;
}
function policyView(db,u,p){
  const name=userId=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
  return {...p,parameters:JSON.parse(p.parameters),kind_name:POLICY_KINDS.find(k=>k.key===p.kind).name,prepared_by_name:name(p.prepared_by),decided_by_name:name(p.decided_by),
    actions:p.status==='draft'&&p.prepared_by!==u.id&&u.caps.includes('hr.policy.accept')?['accept_policy','reject_policy']:[]};
}
function contractView(db,u,c){
  const name=userId=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
  const pay=seesPay(u,c),actions=[];
  if(c.status==='draft'&&c.prepared_by===u.id&&u.caps.includes('hr.contracts.manage'))actions.push('submit_contract');
  if(c.status==='pending'&&c.prepared_by!==u.id&&c.user_id!==u.id&&u.caps.includes('hr.contracts.approve'))actions.push('approve_contract','return_contract','reject_contract');
  if(c.status==='active'&&c.user_id!==u.id&&u.caps.includes('hr.contracts.manage')&&!db.prepare("SELECT 1 FROM employment_contracts WHERE user_id=? AND status IN ('draft','pending')").get(c.user_id))actions.push('amend_contract');
  if(c.status==='active'&&c.user_id!==u.id&&u.caps.includes('hr.contracts.approve'))actions.push('end_contract');
  return {...c,pay_lines:pay?JSON.parse(c.pay_lines):null,monthly_total_minor:pay?c.monthly_total_minor:null,pay_hidden:!pay,
    employee_name:name(c.user_id),prepared_by_name:name(c.prepared_by),decided_by_name:name(c.decided_by),status_name:STATUS_NAMES[c.status],
    type_name:CONTRACT_TYPES.find(t=>t.key===c.contract_type).name,own:c.user_id===u.id,actions};
}

export function listContracts(db,supplied){
  const u=actor(db,supplied),date=today(),hr=u.caps.some(c=>c.startsWith('hr.contracts.'));
  // الموظف يرى عقده فقط؛ المدير المباشر لا يرى رواتب فريقه بحكم دوره.
  const rows=hr?db.prepare('SELECT * FROM employment_contracts WHERE tenant_id=? ORDER BY updated_at DESC').all(u.tenant_id):db.prepare('SELECT * FROM employment_contracts WHERE tenant_id=? AND user_id=? ORDER BY start_date DESC').all(u.tenant_id,u.id);
  const policies=u.caps.length?db.prepare('SELECT * FROM hr_policies WHERE tenant_id=? ORDER BY created_at DESC').all(u.tenant_id).map(p=>policyView(db,u,p)):[];
  const employees=u.caps.includes('hr.contracts.manage')?db.prepare("SELECT u.id,u.name,d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id AND d.tenant_id=u.tenant_id WHERE u.tenant_id=? AND u.active=1 AND u.role<>'admin' AND u.id<>? AND NOT EXISTS(SELECT 1 FROM employment_contracts c WHERE c.user_id=u.id AND c.status IN ('draft','pending','active')) ORDER BY u.name").all(u.tenant_id,u.id):[];
  const active=acceptedPolicy(db,u.tenant_id,'pay_components',date);
  // تنبيهات مبنية على العقد نفسه: نهاية فترة التجربة خلال 14 يومًا، ونهاية العقد المحدد المدة خلال 60 يومًا.
  const plus=(from,days)=>new Date(Date.parse(from+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  const alerts=hr?rows.filter(c=>c.status==='active').flatMap(c=>{
    const name=db.prepare('SELECT name FROM users WHERE id=?').get(c.user_id)?.name,out=[],probationEnd=c.probation_days?plus(c.start_date,c.probation_days-1):null;
    if(probationEnd&&probationEnd>=date&&probationEnd<=plus(date,14))out.push({contract_id:c.id,employee_name:name,kind:'probation_ending',date:probationEnd,message:`تنتهي فترة تجربة ${name} في ${probationEnd}`});
    if(c.end_date&&c.end_date<=plus(date,60))out.push({contract_id:c.id,employee_name:name,kind:c.end_date<date?'contract_expired':'contract_ending',date:c.end_date,message:c.end_date<date?`انتهت مدة عقد ${name} في ${c.end_date} وما زال مسجلًا ساريًا`:`ينتهي عقد ${name} في ${c.end_date}`});
    return out;
  }).sort((a,b)=>a.date.localeCompare(b.date)):[];
  return {today:date,alerts,user_id:u.id,permissions:u.caps,policy_kinds:POLICY_KINDS,pay_components:PAY_COMPONENTS,contract_types:CONTRACT_TYPES,status_names:STATUS_NAMES,
    pay_policy:active?policyView(db,u,active):null,policies,contracts:rows.map(c=>contractView(db,u,c)),employees_without_contract:employees,
    acceptance_owner:'مدير الموارد البشرية (قرار المالك DEC16)'};
}
export function getContract(db,supplied,contractId){
  const u=actor(db,supplied),c=typeof contractId==='string'&&db.prepare('SELECT * FROM employment_contracts WHERE id=? AND tenant_id=?').get(contractId,u.tenant_id);
  if(!c||(c.user_id!==u.id&&!u.caps.some(k=>k.startsWith('hr.contracts.'))))fail(404,'not_found','العقد غير متاح');
  return contractView(db,u,c);
}

export function preparePolicy(db,supplied,input){
  writing(db);
  const u=actor(db,supplied);need(u,'hr.policy.prepare','إعداد السياسات متاح لموظفي الموارد البشرية المخولين');
  v.object(input,['kind','title','body','basis','effective_from','parameters']);
  if(!POLICY_KINDS.some(k=>k.key===input.kind))fail(400,'kind','اختر نوع السياسة');
  let parameters={};
  if(input.kind==='pay_components'){
    const allowed=Array.isArray(input.parameters?.components)?[...new Set(input.parameters.components)]:[];
    if(!allowed.includes('basic')||allowed.some(c=>!PAY_COMPONENTS.some(p=>p.key===c)))fail(400,'components','حدد البنود المسموحة من القائمة، ويلزم الراتب الأساسي');
    parameters={components:allowed};
  }else if(input.kind==='working_time'){
    // أيام العمل بأرقام أيام الأسبوع (0 الأحد … 6 السبت) وساعات الدوام؛ الحضور يقيس عليها ولا يخصم منها.
    const p=v.object(input.parameters,['workdays','start','end','grace_minutes',...RULE_KEYS]);
    const days=Array.isArray(p.workdays)?[...new Set(p.workdays)].sort():[];
    if(!days.length||days.length>7||days.some(d=>!Number.isInteger(d)||d<0||d>6))fail(400,'workdays','حدد أيام العمل من 0 (الأحد) إلى 6 (السبت)');
    for(const key of ['start','end'])if(typeof p[key]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p[key]))fail(400,'work_hours','وقت الدوام بصيغة 09:00');
    if(p.end<=p.start)fail(400,'work_hours','نهاية الدوام بعد بدايته');
    if(!Number.isInteger(p.grace_minutes)||p.grace_minutes<0||p.grace_minutes>120)fail(400,'grace_minutes','مهلة التأخير من 0 إلى 120 دقيقة');
    // قواعد اللائحة الاختيارية (رمضان، العمل الإضافي، سقف الاستئذان، الموقع) بمادتها؛ لا تسري إلا بقبول هذه السياسة.
    parameters={workdays:days,start:p.start,end:p.end,grace_minutes:p.grace_minutes,...attendanceRuleParameters(p,days)};
  }else if(input.kind==='payroll_cycle'){
    // التأمينات لم تعد نسبة واحدة هنا: صارت قاعدة مستقلة بالحالة والتاريخ (regulation_policies kind='social_insurance')
    // لأن النسبة تختلف بين السعودي والمشترك الجديد وغير السعودي، وتتدرج بالسنة. المفتاحان القديمان يبقيان مقبولين
    // اختيارًا فلا تنكسر سياسة اعتُمدت من قبل ولا الشهور التي حكمتها، ولا تطلبهما مسودة جديدة.
    const p=v.object(input.parameters,['pay_day','day_basis','social_insurance_employee_bp','social_insurance_base','review_threshold_bp']);
    if(!['thirty','calendar'].includes(p.day_basis))fail(400,'day_basis','اختر أساس اليوم: شهر من ثلاثين يومًا أو أيام الشهر الفعلية');
    if(!Number.isInteger(p.pay_day)||p.pay_day<1||p.pay_day>28)fail(400,'pay_day','يوم الصرف من 1 إلى 28');
    const legacyBp=p.social_insurance_employee_bp??null,hasLegacy=legacyBp!==null||p.social_insurance_base!==undefined;
    if(legacyBp!==null&&(!Number.isInteger(legacyBp)||legacyBp<0||legacyBp>2500))fail(400,'social_insurance','نسبة استقطاع الموظف بنقاط الأساس من 0 إلى 2500');
    const base=Array.isArray(p.social_insurance_base)?[...new Set(p.social_insurance_base)]:[];
    if(base.some(c=>!PAY_COMPONENTS.some(x=>x.key===c)))fail(400,'social_insurance_base','بنود الأجر الخاضع من قائمة بنود الراتب');
    if(!Number.isInteger(p.review_threshold_bp)||p.review_threshold_bp<0||p.review_threshold_bp>10000)fail(400,'review_threshold','حد الفرق الذي يستلزم تبريرًا بنقاط الأساس');
    parameters={pay_day:p.pay_day,day_basis:p.day_basis,...(hasLegacy?{social_insurance_employee_bp:legacyBp??0,social_insurance_base:base}:{}),review_threshold_bp:p.review_threshold_bp};
  }else if(input.kind==='end_of_service'){
    // معاملات المكافأة يدخلها معد السياسة بسندها النظامي ويعتمدها مدير الموارد البشرية؛ الكود لا يفترض نسبًا.
    const p=v.object(input.parameters,['wage_base','first_years','first_rate_bp','later_rate_bp','reason_factors_bp','resignation_tiers']);
    const base=Array.isArray(p.wage_base)?[...new Set(p.wage_base)]:[];
    if(!base.includes('basic')||base.some(c=>!PAY_COMPONENTS.some(x=>x.key===c)))fail(400,'wage_base','حدد بنود الأجر الداخلة في حساب المكافأة، ويلزم الراتب الأساسي');
    const bp=(value,label,max=20000)=>{if(!Number.isInteger(value)||value<0||value>max)fail(400,'rate',`${label}: نقاط أساس بين 0 و${max}`);return value;};
    if(!Number.isInteger(p.first_years)||p.first_years<0||p.first_years>40)fail(400,'first_years','عدد سنوات الشريحة الأولى غير صالح');
    const factors=v.object(p.reason_factors_bp,['employer_termination','contract_expiry','other']);
    const tiers=Array.isArray(p.resignation_tiers)?p.resignation_tiers.map(t=>{v.object(t,['min_years','factor_bp']);if(!Number.isInteger(t.min_years)||t.min_years<0||t.min_years>60)fail(400,'resignation_tiers','حد السنوات غير صالح');return {min_years:t.min_years,factor_bp:bp(t.factor_bp,'نسبة الاستقالة',10000)};}).sort((a,b)=>a.min_years-b.min_years):[];
    if(!tiers.length||tiers[0].min_years!==0)fail(400,'resignation_tiers','شرائح الاستقالة تبدأ من صفر سنة');
    parameters={wage_base:base,first_years:p.first_years,first_rate_bp:bp(p.first_rate_bp,'معدل الشريحة الأولى (شهر = 10000)'),later_rate_bp:bp(p.later_rate_bp,'معدل ما بعدها'),
      reason_factors_bp:{employer_termination:bp(factors.employer_termination,'إنهاء من صاحب العمل',10000),contract_expiry:bp(factors.contract_expiry,'انتهاء مدة العقد',10000),other:bp(factors.other,'حالات أخرى',10000)},resignation_tiers:tiers};
  }else if(input.parameters!==undefined)v.object(input.parameters,[]);
  const policyId=id();
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,created_at) VALUES(?,?,?,?,?,?,?,?,'draft',?,?)")
    .run(policyId,u.tenant_id,input.kind,v.text(input.title,'عنوان السياسة',180,3),v.text(input.body,'نص السياسة',8000,20),JSON.stringify(parameters),v.text(input.basis,'السند النظامي أو قرار الشركة',2000,10),v.date(input.effective_from),u.id,now());
  audit(db,u,'hr_policy',policyId,'hr_policy.prepared',{}, {kind:input.kind,effective_from:input.effective_from});
  return {id:policyId};
}
export function decidePolicy(db,supplied,policyId,decision,input){
  writing(db);
  const u=actor(db,supplied);need(u,'hr.policy.accept','اعتماد سياسات الموارد البشرية لمدير الموارد البشرية');
  v.object(input,['note']);
  if(!['accept','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  const policy=typeof policyId==='string'&&db.prepare("SELECT * FROM hr_policies WHERE id=? AND tenant_id=? AND status='draft'").get(policyId,u.tenant_id);
  if(!policy)fail(404,'not_found','السياسة غير متاحة للقرار');
  if(policy.prepared_by===u.id)fail(409,'separation_of_duties','من أعد السياسة لا يعتمدها');
  const status=decision==='accept'?'accepted':'rejected';
  db.prepare('UPDATE hr_policies SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),v.text(input.note,'أساس القرار',2000,10),policy.id);
  audit(db,u,'hr_policy',policy.id,'hr_policy.'+status,{status:'draft'},{status});
  return policyView(db,u,db.prepare('SELECT * FROM hr_policies WHERE id=?').get(policy.id));
}

const contractFields=['user_id','contract_type','job_title','work_location','start_date','end_date','weekly_hours','probation_days','notice_days','pay_lines','document_reference'];
function cleanContract(db,u,input,policy){
  if(!CONTRACT_TYPES.some(t=>t.key===input.contract_type))fail(400,'contract_type','اختر نوع العقد');
  const start=v.date(input.start_date),end=input.contract_type==='fixed_term'?v.date(input.end_date):null;
  if(end&&end<=start)fail(400,'date_order','نهاية العقد بعد بدايته');
  const integer=(value,label,min,max)=>{if(!Number.isInteger(value)||value<min||value>max)fail(400,'invalid_number',`${label}: عدد صحيح بين ${min} و${max}`);return value;};
  const allowed=JSON.parse(policy.parameters).components;
  if(!Array.isArray(input.pay_lines)||!input.pay_lines.length||input.pay_lines.length>PAY_COMPONENTS.length)fail(400,'pay_lines','أدخل بنود الراتب');
  const seen=new Set();let total=0;
  const lines=input.pay_lines.map(line=>{
    v.object(line,['component','amount']);
    if(!allowed.includes(line.component))fail(409,'component_not_allowed','بند غير مسموح في سياسة بنود الراتب المعتمدة');
    if(seen.has(line.component))fail(400,'pay_lines','البند مكرر');seen.add(line.component);
    const amount=money(line.amount,PAY_COMPONENTS.find(p=>p.key===line.component).name);total+=amount;
    return {component:line.component,amount_minor:amount};
  }).filter(line=>line.amount_minor>0);
  if(!lines.some(l=>l.component==='basic'))fail(400,'basic_required','الراتب الأساسي مطلوب وموجب');
  return {contract_type:input.contract_type,job_title:v.text(input.job_title,'المسمى الوظيفي',180,2),work_location:v.text(input.work_location,'مكان العمل',180,2),start_date:start,end_date:end,
    weekly_hours:integer(input.weekly_hours,'ساعات العمل الأسبوعية',1,48),probation_days:integer(input.probation_days,'مدة التجربة بالأيام',0,180),notice_days:integer(input.notice_days,'مهلة الإشعار بالأيام',0,180),
    pay_lines:JSON.stringify(lines),monthly_total_minor:total,document_reference:v.text(input.document_reference,'مرجع العقد الموقع ومكان حفظه',500,3)};
}
export function prepareContract(db,supplied,input,amendsId=null){
  writing(db);
  const u=actor(db,supplied);need(u,'hr.contracts.manage','إعداد العقود متاح لموظفي الموارد البشرية المخولين');
  v.object(input,[...contractFields,'change_reason']);
  let previous=null;
  if(amendsId){
    previous=db.prepare("SELECT * FROM employment_contracts WHERE id=? AND tenant_id=? AND status='active'").get(amendsId,u.tenant_id);
    if(!previous)fail(404,'not_found','العقد الساري غير متاح للتعديل');
    if(input.user_id!==undefined&&input.user_id!==previous.user_id)fail(400,'user_id','التعديل لصاحب العقد نفسه');
  }
  const employee=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(previous?.user_id??input.user_id,u.tenant_id);
  if(!employee)fail(404,'not_found','الموظف غير متاح');
  if(employee.id===u.id)fail(409,'separation_of_duties','لا يعد الموظف عقده بنفسه');
  if(db.prepare("SELECT 1 FROM employment_contracts WHERE user_id=? AND status IN ('draft','pending')").get(employee.id))fail(409,'open_contract','يوجد عقد قيد الإعداد أو الاعتماد لهذا الموظف');
  if(!previous&&db.prepare("SELECT 1 FROM employment_contracts WHERE user_id=? AND status='active'").get(employee.id))fail(409,'active_contract','للموظف عقد ساري؛ استخدم تعديل العقد');
  const policy=acceptedPolicy(db,u.tenant_id,'pay_components',v.date(input.start_date));
  if(!policy)fail(409,'policy_required','لا توجد سياسة بنود راتب معتمدة من مدير الموارد البشرية سارية في تاريخ بداية العقد');
  const c=cleanContract(db,u,input,policy),contractId=id(),time=now();
  if(previous&&c.start_date<=previous.start_date)fail(400,'start_date','يبدأ العقد المعدل بعد بداية العقد الساري');
  const reason=previous?v.text(input.change_reason,'سبب التعديل',2000,10):'';
  db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,supersedes_id,policy_id,contract_type,job_title,work_location,start_date,end_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,change_reason,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SAR',?,?,'draft',?,?,?)")
    .run(contractId,u.tenant_id,employee.id,previous?.id??null,policy.id,c.contract_type,c.job_title,c.work_location,c.start_date,c.end_date,c.weekly_hours,c.probation_days,c.notice_days,c.pay_lines,c.monthly_total_minor,c.document_reference,reason,u.id,time,time);
  // المبالغ لا تدخل سجل التدقيق العام؛ يكفي أثر الحدث.
  audit(db,u,'employment_contract',contractId,previous?'contract.amendment_prepared':'contract.prepared',{}, {user_id:employee.id,start_date:c.start_date});
  return {id:contractId};
}

export function contractAction(db,supplied,contractId,action,input){
  writing(db);
  const u=actor(db,supplied);
  const fields={submit_contract:[],approve_contract:['note'],return_contract:['note'],reject_contract:['note'],end_contract:['ended_on','reason']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const current=getContract(db,u,contractId);
  v.version(input.version,current.version);
  if(!current.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة العقد الحالية أو لصلاحيتك');
  const time=now(),date=today();
  if(action==='submit_contract')db.prepare("UPDATE employment_contracts SET status='pending',version=version+1,updated_at=? WHERE id=?").run(time,current.id);
  if(action==='return_contract'||action==='reject_contract')db.prepare('UPDATE employment_contracts SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(action==='return_contract'?'draft':'rejected',action==='reject_contract'?u.id:null,action==='reject_contract'?time:null,v.text(input.note,'سبب القرار',2000,10),time,current.id);
  if(action==='approve_contract'){
    if(!acceptedPolicy(db,u.tenant_id,'pay_components',current.start_date))fail(409,'policy_required','لا توجد سياسة بنود راتب معتمدة سارية في تاريخ بداية العقد');
    // العقد المعدل ينهي السابق في اليوم الذي يسبق بدايته، فلا يسري عقدان معًا.
    if(current.supersedes_id){
      const old=db.prepare("SELECT * FROM employment_contracts WHERE id=? AND status='active'").get(current.supersedes_id);
      if(!old)fail(409,'superseded_missing','العقد الساري الذي يعدله هذا العقد لم يعد ساريًا');
      db.prepare("UPDATE employment_contracts SET status='ended',ended_on=?,end_reason=?,version=version+1,updated_at=? WHERE id=?").run(dayBefore(current.start_date),`حل محله عقد معدل: ${current.change_reason}`,time,old.id);
    }
    db.prepare("UPDATE employment_contracts SET status='active',decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,input.note?v.text(input.note,'ملاحظة الاعتماد',2000):'',time,current.id);
  }
  if(action==='end_contract'){
    const ended=v.date(input.ended_on);
    if(ended<current.start_date||ended>date)fail(400,'ended_on','تاريخ الانتهاء بين بداية العقد واليوم');
    db.prepare("UPDATE employment_contracts SET status='ended',ended_on=?,end_reason=?,version=version+1,updated_at=? WHERE id=?").run(ended,v.text(input.reason,'سبب إنهاء العقد',2000,10),time,current.id);
  }
  audit(db,u,'employment_contract',current.id,'contract.'+action,{status:current.status},{version:current.version+1});
  return getContract(db,u,current.id);
}
