import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds, CAPABILITIES } from './access.mjs';
import { acceptedPolicy } from './hr-contracts.mjs';
import { holidaySet, isWorkingDay } from './work-calendar.mjs';
import { capBasis, capWageMinor, halfUp, PAY_COMPONENT_KEYS, settlementUnpaidShape, unpaidLeaveRule } from './hr-rule-basis.mjs';

// قواعد اللائحة التي تمس المال: سياسات مسودة تستشهد بالمادة، لا تسري إلا بقبول مدير الموارد البشرية (حامل hr.policy.accept).
// المسودات الأولى زرعها الترحيل 102 من نص اللائحة (بلا مُعد بشري)، ويتبناها القابل لكيانه بصف مقبول جديد يحسم فيه الاختيارات المعلقة.
// المنصة تحسب وتقترح وتمنع ما يخالف السقف، ولا تحرك مالًا.
export const RULE_KINDS=[['resignation','الاستقالة'],['settlement','المخالصة النهائية'],['deductions','سقوف الاستقطاع'],['pay_rules','قواعد صرف الأجر'],['travel_per_diem','الانتداب والبدل اليومي'],['social_insurance','التأمينات الاجتماعية']].map(([key,name])=>({key,name}));
// ما يلزم أن يحسمه القابل بنفسه عند القبول، بخياراته المسموحة.
export const CHOICES={
  settlement:{art36_reading:[['labor_law','قراءة نظام العمل: نصف شهر عن كل سنة من الخمس الأولى ثم شهر عما بعدها'],['literal','القراءة الحرفية للائحة: شهر عن كل سنة لمن بلغت خدمته خمس سنوات فأكثر']],
    unpaid_leave_mode:[['none','لا يُحسم من مدة الخدمة شيء'],['excess','يُحسم ما زاد على العشرين يومًا فقط'],['total_when_over','يُحسم المجموع كله متى تجاوز العشرين يومًا (ظاهر نص م91/3)']]},
  pay_rules:{rounding:[['halala','التقريب إلى الهللة (كما هو اليوم)'],['riyal_up','التقريب إلى أقرب ريال بالزيادة (م50/5)']]},
  resignation:{deferral_anchor:[['submission','الستون يومًا تُحسب من تاريخ تقديم الاستقالة'],['deemed_date','الستون يومًا تُحسب بعد انقضاء الثلاثين يومًا']]},
  // النظام يقول إن اشتراك شهر الالتحاق وشهر الترك «على أساس عدد أيام الخدمة» ولا يقول المقسوم، ولم يُعثر عليه في مصدر مفتوح.
  // فهو اختيار يحسمه مدير الموارد البشرية بنفسه عند القبول، لا رقم تخترعه المنصة.
  social_insurance:{partial_month_basis:[['thirty','أيام الخدمة ÷ 30 يومًا'],['calendar','أيام الخدمة ÷ أيام الشهر الفعلية']]}
};
export const GRADES=['ceo','deputy','gm','employee'];
const id=()=>randomUUID();
const DAY=86400000;
export const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const addDays=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*DAY).toISOString().slice(0,10);
export const daysBetween=(from,to)=>Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/DAY);
const kindName=key=>RULE_KINDS.find(k=>k.key===key)?.name??key;
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');u.caps=['hr.policy.prepare','hr.policy.accept'].filter(k=>holds(db,u,k));return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}

// ————— قراءة السياسة السارية —————

const parsed=row=>row?{...row,parameters:JSON.parse(row.parameters),articles:JSON.parse(row.articles),pending_choices:JSON.parse(row.pending_choices)}:null;
// السياسة المقبولة السارية في تاريخ بعينه لكيان. لا شيء يسري من المسودة المزروعة.
export function acceptedRule(db,tenantId,kind,date=riyadhToday()){
  return parsed(db.prepare("SELECT * FROM regulation_policies WHERE tenant_id=? AND kind=? AND status='accepted' AND effective_from<=? ORDER BY effective_from DESC,decided_at DESC LIMIT 1").get(tenantId,kind,date));
}
export const seededRule=(db,kind)=>parsed(db.prepare("SELECT * FROM regulation_policies WHERE tenant_id IS NULL AND kind=? ORDER BY created_at DESC LIMIT 1").get(kind));
// القيم المعروضة قبل القبول: المقبول إن وُجد، وإلا المسودة المزروعة موسومة بأنها غير سارية.
export function ruleOrDraft(db,tenantId,kind,date){
  const accepted=acceptedRule(db,tenantId,kind,date);
  return accepted?{...accepted,active:true}:{...seededRule(db,kind),active:false};
}

// ————— التحقق من المعاملات —————

const int=(value,label,min,max)=>{if(!Number.isInteger(value)||value<min||value>max)fail(400,'invalid_parameter',`${label}: عدد صحيح بين ${min} و${max}`);return value;};
const oneOf=(value,label,list,nullable=false)=>{if(nullable&&value===null)return null;if(!list.includes(value))fail(400,'invalid_parameter',`${label}: اختر من ${list.join('، ')}`);return value;};
const capability=value=>{if(!CAPABILITIES.some(c=>c.key===value&&!c.everyone))fail(400,'invalid_parameter','صاحب الصلاحية يُحدد بتصريح مسجل غير عام');return value;};
export function cleanParameters(kind,p){
  if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'invalid_parameter','معاملات السياسة كائن');
  const choice=(key,nullable=true)=>oneOf(p[key]??null,key,CHOICES[kind][key].map(([k])=>k),nullable);
  if(kind==='resignation'){
    v.object(p,['deemed_after_days','deferral_max_days','deferral_anchor','authority_capability','block_during_investigation']);
    if(typeof p.block_during_investigation!=='boolean')fail(400,'invalid_parameter','منع الاستقالة أثناء التحقيق: نعم أو لا');
    return {deemed_after_days:int(p.deemed_after_days,'مدة القبول الحكمي',1,90),deferral_max_days:int(p.deferral_max_days,'حد التأجيل',0,180),deferral_anchor:choice('deferral_anchor'),
      authority_capability:capability(p.authority_capability),block_during_investigation:p.block_during_investigation};
  }
  if(kind==='settlement'){
    v.object(p,['art36_reading','unpaid_leave_threshold_days','unpaid_leave_mode','unpaid_leave_types','dues_days_company','dues_days_worker','death_award_factor_bp']);
    const types=Array.isArray(p.unpaid_leave_types)?[...new Set(p.unpaid_leave_types)]:null;
    if(!types||!types.length||types.some(t=>typeof t!=='string'||!/^[a-z][a-z0-9_-]{1,59}$/.test(t)))fail(400,'invalid_parameter','رموز أنواع الإجازة بلا أجر');
    return {art36_reading:choice('art36_reading'),unpaid_leave_threshold_days:int(p.unpaid_leave_threshold_days,'حد الإجازة بلا أجر',0,365),unpaid_leave_mode:choice('unpaid_leave_mode'),unpaid_leave_types:types,
      dues_days_company:int(p.dues_days_company,'مهلة الصرف إن أنهت المنشأة العقد',1,60),dues_days_worker:int(p.dues_days_worker,'مهلة الصرف إن أنهى العامل العقد',1,60),death_award_factor_bp:int(p.death_award_factor_bp,'نسبة المكافأة عند الوفاة',0,10000)};
  }
  if(kind==='deductions'){
    // هنا يُقرَّر أساس الأجر الذي تُقاس عليه سقوف م51 وم116 مرة واحدة، فتقرأه وحدة الجزاءات وفحوص المسير معًا.
    v.object(p,['loan_cap_bp','court_cap_bp','fines_cap_days','day_basis_days','wage_components']);
    const list=Array.isArray(p.wage_components)?[...new Set(p.wage_components)]:PAY_COMPONENT_KEYS;
    if(!list.length||list.some(c=>!PAY_COMPONENT_KEYS.includes(c)))fail(400,'invalid_parameter','بنود الأجر في السقوف من قائمة بنود الراتب');
    // م116 سقفها أجر خمسة أيام؛ النطاق هنا هو نطاق جدول الجزاءات نفسه فلا يقبل موضع رقمًا يرفضه الآخر.
    return {loan_cap_bp:int(p.loan_cap_bp,'سقف قسط القرض',0,10000),court_cap_bp:int(p.court_cap_bp,'سقف الحكم القضائي',0,10000),fines_cap_days:int(p.fines_cap_days,'سقف الغرامات بالأيام (م116)',1,5),
      day_basis_days:int(p.day_basis_days,'أيام الشهر في الحساب',28,31),wage_components:list};
  }
  if(kind==='pay_rules'){
    v.object(p,['payday_shift','rounding','housing_bp_of_basic']);
    return {payday_shift:oneOf(p.payday_shift,'يوم الصرف',['previous_working_day','none']),rounding:choice('rounding'),housing_bp_of_basic:int(p.housing_bp_of_basic,'بدل السكن من الأساسي',0,10000)};
  }
  if(kind==='travel_per_diem'){
    v.object(p,['grades','distance_km','housing_and_transport_bp','housing_only_bp','extension_max_days','authority_capability']);
    v.object(p.grades,GRADES);
    const grades=Object.fromEntries(GRADES.map(g=>{const row=v.object(p.grades[g],['name','abroad_minor','domestic_minor']);return [g,{name:v.text(row.name,'اسم الدرجة',80,2),abroad_minor:int(row.abroad_minor,'بدل خارج المملكة',0,10000000),domestic_minor:int(row.domestic_minor,'بدل داخل المملكة',0,10000000)}];}));
    const d=v.object(p.distance_km,['paved','unpaved','rough']);
    return {grades,distance_km:{paved:int(d.paved,'مسافة الطرق المسفلتة',0,2000),unpaved:int(d.unpaved,'مسافة غير المسفلتة',0,2000),rough:int(d.rough,'مسافة الطرق الوعرة',0,2000)},
      housing_and_transport_bp:int(p.housing_and_transport_bp,'نسبة البدل مع السكن والنقل',0,10000),housing_only_bp:int(p.housing_only_bp,'نسبة البدل مع السكن فقط',0,10000),
      extension_max_days:int(p.extension_max_days,'حد التمديد',0,60),authority_capability:capability(p.authority_capability)};
  }
  if(kind==='social_insurance'){
    // جدول النسب بالحالة والتاريخ. الحالات ثلاث بقرار المالك ولا رابعة: مواطنو دول مجلس التعاون خارج الجدول.
    // كل درجة صف مؤرخ، فتصاعد نسب المشترك الجديد سنويًا لا يحتاج قبولًا جديدًا كل سنة، وشهرُ كلِّ مسير يأخذ درجته.
    v.object(p,['wage_components','max_wage_minor','floors_minor','new_law_effective_from','partial_month_basis','age_thresholds','employee_rounding','cases','open_questions']);
    const components=Array.isArray(p.wage_components)?[...new Set(p.wage_components)]:[];
    if(!components.length||components.some(c=>!PAY_COMPONENT_KEYS.includes(c)))fail(400,'invalid_parameter','بنود الأجر الخاضع للاشتراك من قائمة بنود الراتب');
    const floors=v.object(p.floors_minor,['annuities','hazards_only']);
    const cases=v.object(p.cases,['saudi_previous_law','saudi_new_entrant','non_saudi']);
    const clean=Object.fromEntries(Object.entries(cases).map(([key,row])=>{
      v.object(row,['name','floor','article','source_url','schedule']);
      if(!Array.isArray(row.schedule)||!row.schedule.length)fail(400,'invalid_parameter',`حالة ${key}: جدول النسب لا يكون فارغًا؛ كل درجة صف بتاريخ سريانها ونسبتيها`);
      const schedule=row.schedule.map(s=>{
        v.object(s,['from','employee_bp','employer_bp','note','source_url']);
        return {from:v.date(s.from),employee_bp:int(s.employee_bp,`نسبة الموظف في ${key}`,0,2500),employer_bp:int(s.employer_bp,`نسبة صاحب العمل في ${key}`,0,2500),
          note:v.text(s.note??'','سند الدرجة',400,0),source_url:v.text(s.source_url??'','رابط المصدر',400,0)};
      }).sort((a,b)=>a.from.localeCompare(b.from));
      return [key,{name:v.text(row.name,'اسم الحالة',120,3),floor:oneOf(row.floor,'الحد الأدنى المطبق',['annuities','hazards_only']),
        article:v.text(row.article,'مادة الحالة',300,3),source_url:v.text(row.source_url??'','رابط مصدر الحالة',400,0),schedule}];
    }));
    const questions=Array.isArray(p.open_questions)?p.open_questions.map(q=>v.text(q,'سؤال مفتوح',2000,10)):[];
    // حدود السن لأول تغطية: تبقى فارغة حتى يتحقق مدير الموارد البشرية من أعمارها في المصدر الرسمي (سؤال مفتوح لا قيمة).
    // متى كُتبت، امتنع اعتماد مسير من بلغ سنّ حالته عند تاريخ مباشرته بدل أن يُخصم منه بنسبة الجدول.
    const ages=p.age_thresholds??null;
    if(ages!==null){
      if(typeof ages!=='object'||Array.isArray(ages))fail(400,'invalid_parameter','حدود السن: كائن مفاتيحه أسماء الحالات، أو اتركه فارغًا سؤالًا مفتوحًا');
      v.object(ages,Object.keys(cases));
    }
    return {wage_components:components,max_wage_minor:int(p.max_wage_minor,'الحد الأعلى للأجر الخاضع بالهللة',100000,100000000),
      floors_minor:{annuities:int(floors.annuities,'الحد الأدنى لفرع المعاشات بالهللة',0,10000000),hazards_only:int(floors.hazards_only,'الحد الأدنى للأخطار المهنية وحدها بالهللة',0,10000000)},
      new_law_effective_from:v.date(p.new_law_effective_from),partial_month_basis:choice('partial_month_basis'),
      age_thresholds:ages===null?null:Object.fromEntries(Object.entries(ages).map(([key,years])=>[key,int(years,`سن أول تغطية في حالة ${key}`,15,100)])),
      // تقريب حصة الموظف: اتباع قاعدة م50/5 المقبولة كما هي اليوم، أو إبقاء الخصم بالهللة كما يوصي الموجز.
      employee_rounding:oneOf(p.employee_rounding??'pay_rules','تقريب حصة الموظف',['pay_rules','halala']),
      cases:clean,open_questions:questions};
  }
  fail(400,'kind','نوع السياسة غير معروف');
}
const pendingOf=(kind,params)=>Object.keys(CHOICES[kind]??{}).filter(key=>params[key]===null||params[key]===undefined);

// ————— لوحة السياسات —————

function ruleView(db,u,row){
  const r=parsed(row),actions=[];
  if(r.status==='draft'&&u.caps.includes('hr.policy.accept')&&r.prepared_by!==u.id)actions.push('accept_rule','reject_rule');
  if(r.tenant_id===null&&u.caps.includes('hr.policy.prepare'))actions.push('prepare_rule');
  return {...r,seeded:r.tenant_id===null,kind_name:kindName(r.kind),prepared_by_name:personName(db,r.prepared_by),decided_by_name:personName(db,r.decided_by),
    choices:Object.fromEntries(Object.entries(CHOICES[r.kind]??{}).map(([key,list])=>[key,list.map(([value,label])=>({value,label}))])),actions};
}
export function rulesBoard(db,supplied){
  const u=actor(db,supplied);
  if(!u.caps.length&&!['payroll.prepare','payroll.review','payroll.approve'].some(k=>holds(db,u,k)))fail(403,'not_permitted','سياسات اللائحة لموظفي السياسات والرواتب المخولين');
  const today=riyadhToday();
  // المسودة المزروعة تظهر ما دام الكيان لم يتبن قبولًا من نوعها بعد.
  const rows=db.prepare("SELECT * FROM regulation_policies WHERE tenant_id IS NULL OR tenant_id=? ORDER BY kind,created_at DESC").all(u.tenant_id).map(r=>ruleView(db,u,r));
  const active=Object.fromEntries(RULE_KINDS.map(k=>[k.key,acceptedRule(db,u.tenant_id,k.key,today)]));
  return {today,user_id:u.id,permissions:u.caps,kinds:RULE_KINDS,
    active:Object.fromEntries(Object.entries(active).map(([k,r])=>[k,r?{id:r.id,title:r.title,effective_from:r.effective_from,parameters:r.parameters,decided_by_name:personName(db,r.decided_by)}:null])),
    policies:rows,art36_example:art36Example(),
    awaiting_me:rows.filter(r=>r.actions.includes('accept_rule')).map(r=>({id:r.id,title:`${r.kind_name}: ${r.title}`,created_at:r.created_at,actions:['accept_rule']})),
    note:'قيم اللائحة مسودات تستشهد برقم المادة ولا تسري إلا بقبول مدير الموارد البشرية. النص مستخرج آليًا من PDF، فكل رقم يُطابق مع النسخة الموقعة قبل القبول. المنصة تحسب وتقترح وتمنع ما يتجاوز السقف، ولا تصرف مالًا.'};
}
// مثال م36/2 الثابت: 7 سنوات بأجر 10,000 ريال.
export function art36Example(){
  const wage=1000000,years=7,labor=wage*5/2+wage*(years-5),literal=wage*years;
  return {service_years:years,wage_minor:wage,literal_minor:literal,labor_law_minor:labor,
    note:'القراءة الحرفية للائحة (م36/2-ب): شهر عن كل سنة لمن بلغت خدمته خمس سنوات فأكثر = 70,000. قراءة نظام العمل: نصف شهر عن الخمس الأولى وشهر عما بعدها = 45,000. تختار القراءة في سياسة المخالصة قبل اعتماد أي مخالصة.'};
}

export function prepareRule(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.includes('hr.policy.prepare'))fail(403,'not_permitted','إعداد سياسات اللائحة لموظفي الموارد البشرية المخولين');
  v.object(input,['based_on','parameters','note']);
  const base=typeof input.based_on==='string'&&parsed(db.prepare('SELECT * FROM regulation_policies WHERE id=? AND (tenant_id IS NULL OR tenant_id=?)').get(input.based_on,u.tenant_id));
  if(!base)fail(404,'not_found','السياسة الأصل غير متاحة');
  const params=cleanParameters(base.kind,input.parameters),policyId=id();
  db.prepare("INSERT INTO regulation_policies(id,tenant_id,kind,title,articles,source,body,parameters,pending_choices,status,based_on,prepared_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?,?)")
    .run(policyId,u.tenant_id,base.kind,base.title,JSON.stringify(base.articles),base.source,base.body+`\n\nتعديل المُعد: ${v.text(input.note,'سبب تعديل القيم وسنده',2000,10)}`,JSON.stringify(params),JSON.stringify(pendingOf(base.kind,params)),base.id,u.id,now());
  audit(db,u,'regulation_policy',policyId,'regulation_policy.prepared',{}, {kind:base.kind,based_on:base.id});
  return {id:policyId};
}
// القبول: من يملك hr.policy.accept وليس مُعد المسودة. يحسم الاختيارات المعلقة بنفسه، ويحدد تاريخ السريان.
export function decideRule(db,supplied,policyId,decision,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.includes('hr.policy.accept'))fail(403,'not_permitted','قبول سياسات اللائحة لمدير الموارد البشرية');
  if(!['accept','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['effective_from','choices','note']);
  const row=typeof policyId==='string'&&db.prepare("SELECT * FROM regulation_policies WHERE id=? AND (tenant_id IS NULL OR tenant_id=?) AND status='draft'").get(policyId,u.tenant_id);
  if(!row)fail(404,'not_found','المسودة غير متاحة للقرار');
  if(row.prepared_by===u.id)fail(409,'separation_of_duties','من أعد السياسة لا يقبلها');
  // المستخرج المزروع يبقى مسودة بعد قبوله (القبول يكتب نسخة للكيان)، فبلا هذا الفحص يكتب القبول الثاني نسخة نافذة ثانية.
  if(row.tenant_id===null&&decision==='accept'&&db.prepare("SELECT 1 FROM regulation_policies WHERE tenant_id=? AND based_on=? AND status='accepted'").get(u.tenant_id,row.id))
    fail(409,'already_adopted','اعتمد كيانك نسخته من هذه المسودة من قبل. لتغيير القيم أعدّ مسودة معدلة من «قواعد اللائحة في الرواتب» ليعتمدها شخص آخر');
  const note=v.text(input.note,decision==='accept'?'إقرارك بمطابقة القيم مع اللائحة الموقعة':'سبب الرفض',2000,10),time=now();
  if(decision==='reject'){
    if(row.tenant_id===null)fail(409,'seeded_draft','المسودة المزروعة لا تُرفض؛ أعد مسودة معدلة لكيانك أو اتركها غير مقبولة');
    db.prepare("UPDATE regulation_policies SET status='rejected',decided_by=?,decided_at=?,decision_note=? WHERE id=?").run(u.id,time,note,row.id);
    audit(db,u,'regulation_policy',row.id,'regulation_policy.rejected',{status:'draft'},{status:'rejected'},note);
    return {id:row.id,status:'rejected'};
  }
  const choices=input.choices??{};
  if(typeof choices!=='object'||Array.isArray(choices))fail(400,'choices','الاختيارات كائن');
  const allowed=Object.keys(CHOICES[row.kind]??{});
  v.object(choices,allowed);
  const params={...JSON.parse(row.parameters),...choices};
  const effective=v.date(input.effective_from);
  // م91/3: حد الإجازة بلا أجر وطريقة حسمه قرار واحد موضعه سياسة أنواع الإجازات. إن كانت معتمدة وحاسمة، تُنسخ قيمتها
  // هنا بدل اختيار ثانٍ، فلا يبقى في المنصة رقمان لقرار واحد. وإن لم تكن، تبقى هذه السياسة هي الموضع (مسار الترحيل).
  let mirrored=null;
  if(row.kind==='settlement'){
    const unpaid=unpaidLeaveRule(db,u.tenant_id,effective);
    if(unpaid&&unpaid.threshold_source==='leave_policy'){
      params.unpaid_leave_threshold_days=unpaid.threshold_days;
      if(unpaid.mode_source==='leave_policy')params.unpaid_leave_mode=unpaid.mode;
      mirrored={threshold_days:unpaid.threshold_days,mode:params.unpaid_leave_mode,from_policy:unpaid.leave_policy_id};
    }
  }
  const clean=cleanParameters(row.kind,params),pending=pendingOf(row.kind,clean);
  if(pending.length)fail(409,'choice_required',`اختر بنفسك قبل القبول: ${pending.map(k=>k==='art36_reading'?'قراءة م36/2 لمكافأة نهاية الخدمة':k==='rounding'?'قاعدة التقريب (م50/5)':k==='unpaid_leave_mode'?'طريقة حسم الإجازة بلا أجر (م91/3) — أو احسمها مرة واحدة في سياسة أنواع الإجازات':k==='partial_month_basis'?'مقسوم شهر الالتحاق وشهر الترك في التأمينات: النظام يقول «أيام الخدمة» ولا يقول المقسوم':k).join('، ')}`);
  let acceptedId=row.id;
  if(row.tenant_id===null){
    acceptedId=id();
    db.prepare("INSERT INTO regulation_policies(id,tenant_id,kind,title,articles,source,body,parameters,pending_choices,status,based_on,effective_from,decided_by,decided_at,decision_note,created_at) VALUES(?,?,?,?,?,?,?,?,'[]','accepted',?,?,?,?,?,?)")
      .run(acceptedId,u.tenant_id,row.kind,row.title,row.articles,row.source,row.body,JSON.stringify(clean),row.id,effective,u.id,time,note,time);
  }else db.prepare("UPDATE regulation_policies SET status='accepted',parameters=?,pending_choices='[]',effective_from=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?").run(JSON.stringify(clean),effective,u.id,time,note,row.id);
  audit(db,u,'regulation_policy',acceptedId,'regulation_policy.accepted',{status:'draft',based_on:row.id},{status:'accepted',effective_from:effective,choices,...(mirrored?{unpaid_leave_from_leave_policy:mirrored}:{})},note);
  return {id:acceptedId,status:'accepted',...(mirrored?{unpaid_leave:mirrored}:{})};
}

// ————— المال: التقريب —————

// م50/5: التقريب إلى أقرب ريال بالزيادة إن قبله مدير الموارد البشرية؛ وإلا يبقى المبلغ بالهللة كما هو اليوم.
export const roundMoney=(minor,mode)=>mode==='riyal_up'?Math.ceil(minor/100)*100:minor;
export function roundingMode(db,tenantId,date){return acceptedRule(db,tenantId,'pay_rules',date)?.parameters.rounding??'halala';}

// ————— المخالصة —————

// أيام الإجازة بلا أجر المعتمدة داخل مدة الخدمة، بالأيام التقويمية.
export function unpaidLeaveDays(db,userId,from,to,types){
  if(!types?.length)return 0;
  const rows=db.prepare(`SELECT r.start_date,r.end_date FROM leave_requests r JOIN leave_balances b ON b.id=r.balance_id WHERE r.employee_id=? AND r.status='approved' AND b.leave_type IN (${types.map(()=>'?').join(',')})`).all(userId,...types);
  let days=0;
  for(const r of rows){const start=r.start_date>from?r.start_date:from,end=r.end_date<to?r.end_date:to;if(end>=start)days+=daysBetween(start,end)+1;}
  return days;
}
// م91/3: ما يُحسم من مدة الخدمة بحسب القراءة المقبولة. دالة صافية: القاعدة تأتيها محسومة من settlementUnpaidRule.
export function excludedServiceDays(unpaidDays,rule){
  // «لا يُحسم»: قرار الشركة ألا تنقص مدة الخدمة بالإجازة بلا أجر مهما طالت. النظام حد أدنى وهذا فوقه، فلا يُقاس بالحد.
  if(!rule||rule.unpaid_leave_mode==='none'||unpaidDays<=rule.unpaid_leave_threshold_days)return 0;
  return rule.unpaid_leave_mode==='total_when_over'?unpaidDays:unpaidDays-rule.unpaid_leave_threshold_days;
}
// القاعدة السارية للإجازة بلا أجر: سياسة أنواع الإجازات هي المرجع (م91/3 في بابها)، وسياسة المخالصة مسار الترحيل.
// تُرجع الشكل الذي تقرأه excludedServiceDays وunpaidLeaveDays، أو null إن لم تُحسم طريقة الحسم بعد.
export function settlementUnpaidRule(db,tenantId,date=riyadhToday()){
  return settlementUnpaidShape(unpaidLeaveRule(db,tenantId,date));
}
// م50/2: 7 أيام إن أنهت المنشأة العقد، و14 يومًا إن أنهاه العامل.
export const endedBy=reason=>reason==='resignation'?'worker':'company';
export function duesDueOn(serviceEnd,by,rule){
  const params=rule??seededParams('settlement');
  return addDays(serviceEnd,by==='worker'?params.dues_days_worker:params.dues_days_company);
}
function seededParams(kind){return SEED_FALLBACK[kind];}
// قيم المسودة المزروعة كما في الترحيل 102، لعرض المهلة قبل القبول دون قراءة إضافية.
const SEED_FALLBACK={settlement:{dues_days_company:7,dues_days_worker:14}};
export function duesCountdown(dueOn,paidOn,today=riyadhToday()){
  if(paidOn)return {state:'paid',days_left:null,label:`صُرفت المستحقات في ${paidOn}`};
  const left=daysBetween(today,dueOn);
  return {state:left<0?'overdue':left<=2?'due_soon':'open',days_left:left,label:left<0?`تجاوزت مهلة الصرف بـ${-left} يوم`:left===0?'آخر يوم لصرف المستحقات اليوم':`باقٍ ${left} يوم على مهلة صرف المستحقات`};
}

// ————— سقوف الاستقطاع (م51، م116) —————

// مصادر غرامات إضافية تسجلها وحدة الجزاءات عند تحميلها: fn(db,tenantId,userId,month) ← مجموع بالهللة.
const fineSources=new Map();
export function registerFineSource(key,fn){if(typeof fn!=='function')throw new Error('fine source must be a function');fineSources.set(key,fn);}
function classSum(db,tenantId,userId,month,classes,statuses=['approved']){
  return db.prepare(`SELECT COALESCE(SUM(a.amount_minor),0) AS n FROM payroll_adjustments a JOIN payroll_adjustment_classes c ON c.adjustment_id=a.id
    WHERE a.tenant_id=? AND a.user_id=? AND a.month=? AND a.status IN (${statuses.map(()=>'?').join(',')}) AND c.class IN (${classes.map(()=>'?').join(',')})`).get(tenantId,userId,month,...statuses,...classes).n;
}
export function monthDeductions(db,tenantId,userId,month,statuses=['approved']){
  const marks=statuses.map(()=>'?').join(',');
  const advances=db.prepare(`SELECT COALESCE(SUM(amount_minor),0) AS n FROM payroll_adjustments WHERE tenant_id=? AND user_id=? AND month=? AND status IN (${marks}) AND kind='advance_installment'`).get(tenantId,userId,month,...statuses).n;
  // نوع «fine» إن أضافته وحدة الجزاءات لجدول الحركات لاحقًا يُعد هنا تلقائيًا.
  const fineKind=db.prepare(`SELECT COALESCE(SUM(amount_minor),0) AS n FROM payroll_adjustments WHERE tenant_id=? AND user_id=? AND month=? AND status IN (${marks}) AND kind='fine'`).get(tenantId,userId,month,...statuses).n;
  let external=0;for(const fn of fineSources.values())external+=Number(fn(db,tenantId,userId,month))||0;
  return {loan_minor:advances+classSum(db,tenantId,userId,month,['employer_loan'],statuses),court_minor:classSum(db,tenantId,userId,month,['court_order'],statuses),
    fines_minor:fineKind+classSum(db,tenantId,userId,month,['fine'],statuses)+external};
}
export function capsFor(rule,monthlyWageMinor){
  return {loan_cap_minor:Math.floor(monthlyWageMinor*rule.loan_cap_bp/10000),court_cap_minor:Math.floor(monthlyWageMinor*rule.court_cap_bp/10000),
    fines_cap_minor:Math.floor(monthlyWageMinor*rule.fines_cap_days/rule.day_basis_days),daily_wage_minor:halfUp(monthlyWageMinor,rule.day_basis_days)};
}
const sar=minor=>`${(minor/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ريال`;
// مخالفات السقوف لموظف في شهر. wage: أجر الشهر (إجمالي العقد الشهري).
export function capBreaches(rule,wage,d){
  const caps=capsFor(rule,wage),out=[];
  if(d.loan_minor>caps.loan_cap_minor)out.push({cap:'loan',article:'م51/1',amount_minor:d.loan_minor,cap_minor:caps.loan_cap_minor,message:`أقساط القرض أو السلفة ${sar(d.loan_minor)} تتجاوز ${rule.loan_cap_bp/100}% من الأجر (${sar(caps.loan_cap_minor)})`});
  if(d.court_minor>caps.court_cap_minor)out.push({cap:'court',article:'م51/6',amount_minor:d.court_minor,cap_minor:caps.court_cap_minor,message:`حسم الحكم القضائي ${sar(d.court_minor)} يتجاوز ${rule.court_cap_bp/100}% من الأجر (${sar(caps.court_cap_minor)})`});
  if(d.fines_minor>caps.fines_cap_minor)out.push({cap:'fines',article:'م116',amount_minor:d.fines_minor,cap_minor:caps.fines_cap_minor,message:`الغرامات ${sar(d.fines_minor)} تتجاوز أجر ${rule.fines_cap_days} أيام في الشهر (${sar(caps.fines_cap_minor)})`});
  return out;
}
// أجر الشهر الذي تُقاس عليه سقوف م51 وم116: بنود العقد الداخلة في الأساس المقرر في سياسة سقوف الاستقطاع،
// وهي البنود نفسها التي تحسب بها وحدة الجزاءات الأجر اليومي، فلا يختلف السقفان على الشهر الواحد.
export const capWage=(db,tenantId,userId,date=riyadhToday())=>capWageMinor(db,tenantId,userId,capBasis(db,tenantId,date),date);
const activeWage=(db,tenantId,userId,date)=>capWage(db,tenantId,userId,date??riyadhToday());
// م51/1 عند طلب السلفة: القسط الشهري لا يتجاوز السقف من الأجر، محسوبًا مع أقساط أخرى قائمة في الشهر نفسه.
export function assertAdvanceWithinCap(db,tenantId,userId,amountMinor,installments,firstMonth){
  const rule=acceptedRule(db,tenantId,'deductions');if(!rule)return null;
  const wage=activeWage(db,tenantId,userId);if(!wage)return null;
  const each=Math.ceil(amountMinor/installments),cap=capsFor(rule.parameters,wage).loan_cap_minor;
  const existing=monthDeductions(db,tenantId,userId,firstMonth).loan_minor;
  if(each+existing>cap)fail(409,'advance_cap',`القسط الشهري ${sar(each)}${existing?` مع أقساط قائمة ${sar(existing)}`:''} يتجاوز ${rule.parameters.loan_cap_bp/100}% من الأجر (${sar(cap)}) بحسب م51/1. زد عدد الأقساط أو خفّض المبلغ`);
  return {each_minor:each,cap_minor:cap};
}
// حسم مصنف (حكم قضائي، غرامة، قرض لصاحب العمل): حركة خصم مقترحة عادية، مع صنفها وسندها، ويُرفض ما يتجاوز السقف من البداية.
export function assertClassWithinCap(db,tenantId,userId,month,cls,amountMinor){
  const rule=acceptedRule(db,tenantId,'deductions');if(!rule)return null;
  const wage=activeWage(db,tenantId,userId,`${month}-01`);if(!wage)fail(409,'contract_required','لا حسم مصنف لموظف بلا عقد ساري');
  const d=monthDeductions(db,tenantId,userId,month,['approved','proposed']);
  const key={court_order:'court_minor',fine:'fines_minor',employer_loan:'loan_minor'}[cls];
  d[key]+=amountMinor;
  const breach=capBreaches(rule.parameters,wage,d).find(b=>({court:'court_minor',fines:'fines_minor',loan:'loan_minor'})[b.cap]===key);
  if(breach)fail(409,'deduction_cap',`${breach.message} (${breach.article}). المقترح والمعتمد لهذا الشهر محسوبان معًا`);
  return true;
}

// فحوص المسير من اللائحة: «block» يمنع إرسال المسير للمراجعة واعتماده، والباقي تنبيه.
export function ruleChecks(db,tenantId,run){
  const out=[],add=(level,title,detail,article)=>out.push({level,title,detail,article});
  const {to}=monthBounds(run.month);
  const lines=db.prepare('SELECT l.user_id,l.gross_minor,l.contract_id,x.name FROM payroll_lines l JOIN users x ON x.id=l.user_id WHERE l.run_id=? ORDER BY x.name').all(run.id);
  const deductions=acceptedRule(db,tenantId,'deductions',to);
  if(deductions){
    // الأجر هنا هو الأجر نفسه الذي حسبت به وحدة الجزاءات الغرامة (بنود الأساس المقرر)، لا إجمالي العقد دائمًا،
    // وإلا اختلف سقف م116 قبل المسير عن السقف الذي فُحص به الاقتراح.
    const basis=capBasis(db,tenantId,to);
    for(const l of lines){
      const contract=db.prepare('SELECT pay_lines,monthly_total_minor FROM employment_contracts WHERE id=?').get(l.contract_id);
      const parts=contract?JSON.parse(contract.pay_lines):null;
      const wage=parts?parts.filter(x=>basis.wage_components.includes(x.component)).reduce((n,x)=>n+x.amount_minor,0):l.gross_minor;
      for(const b of capBreaches(deductions.parameters,wage,monthDeductions(db,tenantId,l.user_id,run.month)))add('block',`${l.name}: ${b.message}`,'لا يُرسل المسير للمراجعة ولا يُعتمد قبل تأجيل جزء من الحسم إلى شهر لاحق بقرار معتمد.',b.article);
    }
  }else add('info','سقوف الاستقطاع (م51، م116) مسودة لم يقبلها مدير الموارد البشرية بعد','لا تُفرض السقوف على المسير قبل القبول.','م51');
  // حصة موظف حُصرت بما تبقى من أجره بعد الغياب غير المدفوع: المنشأة تبقى مدينة للمؤسسة بالفرق، فلا يمر بلا قول.
  const capped=db.prepare('SELECT l.basis,x.name FROM payroll_lines l JOIN users x ON x.id=l.user_id WHERE l.run_id=? ORDER BY x.name').all(run.id)
    .map(l=>({name:l.name,insurance:JSON.parse(l.basis).insurance})).filter(l=>l.insurance?.capped_by_net);
  if(capped.length)add('warn',`${capped.length} موظف حُصرت حصته في التأمينات بما تبقى من أجره بعد الغياب غير المدفوع`,
    `${capped.map(l=>`${l.name}: المستحق ${sar(l.insurance.employee_uncapped_minor)} والمخصوم ${sar(l.insurance.employee_minor)}`).join('؛ ')}. لا يُحسم من أجر لم يُصرف، والاشتراك يستمر على الأجر المسجَّل: الفرق يبقى على المنشأة للمؤسسة.`,'م19/4');
  // التأمينات: قبل قبول قاعدة الحالات يبقى المطبَّق نسبةً واحدة على الجميع. يُقال صراحة كي لا يُقرأ المسير على أنه مطبِّق للنظام.
  if(!acceptedRule(db,tenantId,'social_insurance',to))
    add('info','خصم التأمينات بحسب الحالة لم يسرِ بعد: قاعدة التأمينات مسودة لم يقبلها مدير الموارد البشرية',
      'المطبَّق في هذا المسير نسبة واحدة من سياسة دورة الرواتب على كل موظف، وحصة المنشأة غير محتسبة. تُقبل القاعدة من «قواعد اللائحة في الرواتب».','م18 نظام التأمينات');
  const pay=acceptedRule(db,tenantId,'pay_rules',to),payday=paydayFor(db,tenantId,run.month);
  if(payday)add(payday.shifted?'warn':'info',payday.shifted?`يوم الصرف ${payday.nominal} يوافق ${payday.reason}، فيُصرف ${payday.actual}`:`يوم الصرف ${payday.actual}`,payday.active?'بحسب م48 المقبولة.':'م48 مسودة لم تُقبل بعد؛ التاريخ المعدل مقترح.','م48');
  if(pay){
    const bp=pay.parameters.housing_bp_of_basic;
    for(const l of lines){
      const c=db.prepare('SELECT pay_lines FROM employment_contracts WHERE id=?').get(l.contract_id);if(!c)continue;
      const parts=JSON.parse(c.pay_lines),basic=parts.find(p=>p.component==='basic')?.amount_minor??0,housing=parts.find(p=>p.component==='housing')?.amount_minor??0,expected=Math.round(basic*bp/10000);
      if(housing!==expected)add('warn',`${l.name}: بدل السكن ${sar(housing)} لا يساوي ${bp/100}% من الأساسي (${sar(expected)})`,'القيمة في العقد قرار اعتمده صاحب الصلاحية؛ التنبيه للمراجعة لا للتعديل الآلي.','م67/2');
    }
    if(pay.parameters.rounding==='riyal_up')add('info','التقريب إلى أقرب ريال بالزيادة مقبول','تُقرّب بنود الاستحقاق والحسم في سطور هذا المسير إلى الريال الأعلى.','م50/5');
  }
  // م77(9) (ص 27): لا يجتمع أجر عمل إضافي مع التكليف بمهمة رسمية خلال أيام العمل المعتادة وحدها؛ ساعات يوم راحة أو عطلة داخل الانتداب خارج نطاقها.
  // نوع اليوم من الطلب (day_type)؛ طلب قديم بلا نوع يُعدّ يوم عمل تحفظًا ويُقال ذلك.
  const clash=db.prepare(`SELECT DISTINCT x.name,o.day_type FROM overtime_requests o JOIN travel_decisions t ON t.user_id=o.user_id AND t.status='approved' AND o.work_date BETWEEN t.start_date AND t.end_date
    JOIN users x ON x.id=o.user_id WHERE o.tenant_id=? AND o.status='approved' AND o.work_date BETWEEN ? AND ? AND (o.day_type='working' OR o.day_type IS NULL)`).all(tenantId,`${run.month}-01`,to);
  if(clash.length)add('warn',`${clash.length} موظف له عمل إضافي معتمد في يوم عمل معتاد داخل انتداب`,`${[...new Set(clash.map(r=>r.name))].join('، ')}. لا يجتمع أجر العمل الإضافي مع التكليف بمهمة رسمية خلال أيام العمل المعتادة (م77(9))${clash.some(r=>r.day_type===null)?'؛ ومنها طلب لم يُسجل نوع يومه فعُدّ يوم عمل تحفظًا':''}.`,'م77(9)');
  const deaths=db.prepare(`SELECT x.name FROM settlement_rule_basis b JOIN service_settlements s ON s.id=b.settlement_id JOIN users x ON x.id=s.user_id WHERE b.tenant_id=? AND b.death=1 AND s.status<>'rejected' AND s.service_end BETWEEN ? AND ?`).all(tenantId,`${run.month}-01`,to);
  if(deaths.length)add('warn',`مخالصة وفاة في هذا الشهر: ${deaths.map(r=>r.name).join('، ')}`,'أجر شهر الوفاة يُصرف كاملًا للورثة ضمن المخالصة (م38/3)؛ تأكد ألا يُصرف سطر المسير للشهر نفسه مرة ثانية.','م38/3');
  return out;
}
export const blockingRuleChecks=(db,tenantId,run)=>ruleChecks(db,tenantId,run).filter(c=>c.level==='block');
function monthBounds(month){const [y,m]=month.split('-').map(Number),days=new Date(Date.UTC(y,m,0)).getUTCDate();return {from:`${month}-01`,to:`${month}-${String(days).padStart(2,'0')}`};}

// ————— يوم الصرف (م48) —————

// أيام العمل هنا أيام دوام الموظفين في سياسة «ساعات العمل والحضور» المقبولة إن وُجدت، لا أسبوع تقويم الخدمات.
// بدونها يبقى السلوك السابق (تقويم الخدمات: الأحد–الخميس) كما هو.
// مُصدَّرة: كل من يفحص تاريخ صرف (يوم اللائحة أو تاريخ صرف مبكر مقترح) يفحصه بأسبوع الدوام نفسه،
// وإلا حُكم على الاقتراح بأسبوع افتراضي غير أسبوع الكيان فقُبل يوم راحة ورُفض يوم عمل.
export const workdayWeek=(db,tenantId,date)=>{
  const policy=acceptedPolicy(db,tenantId,'working_time',date);
  const days=policy?JSON.parse(policy.parameters).workdays:null;
  return Array.isArray(days)&&days.length?new Set(days):null;
};
export function shiftToWorkingDay(date,holidays,workdays=null){
  const working=day=>holidays.has(day)?false:workdays?workdays.has(new Date(`${day}T00:00:00Z`).getUTCDay()):isWorkingDay(day,holidays);
  let day=date,reasons=[];
  for(let guard=0;guard<30&&!working(day);guard++){reasons.push(holidays.has(day)?'عطلة رسمية':'يوم راحة أسبوعية');day=addDays(day,-1);}
  return {date:day,shifted:day!==date,reason:reasons[0]??''};
}
export function paydayFor(db,tenantId,month){
  const {to}=monthBounds(month),cycle=acceptedPolicy(db,tenantId,'payroll_cycle',to);
  if(!cycle)return null;
  const nominal=`${month}-${String(JSON.parse(cycle.parameters).pay_day).padStart(2,'0')}`;
  const rule=ruleOrDraft(db,tenantId,'pay_rules',to);
  if(rule.parameters.payday_shift!=='previous_working_day')return {nominal,actual:nominal,shifted:false,reason:'',active:rule.active};
  const s=shiftToWorkingDay(nominal,holidaySet(db,tenantId),workdayWeek(db,tenantId,nominal));
  return {nominal,actual:s.date,shifted:s.shifted,reason:s.reason,active:rule.active};
}
