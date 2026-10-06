import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { riyadhToday, addDays, roundMoney, acceptedRule } from './payroll-rules.mjs';
import { factsOf, switchedOffReason } from './benefits-portal.mjs';
import { proposeAdjustment } from './payroll-extras.mjs';
import { overtimeOnWorkingDays, ART77_9 } from './overtime-rules.mjs';
// مفتاح تفعيل الميزة (ترحيل 129): هذه الوحدة هي الباب الثاني للمزايا الثلاث، فيسري عليها المفتاح نفسه.
import { hiddenBenefitKeys, refuseHidden } from './service-availability.mjs';

// تعميم الانتداب والمزايا الثلاث (الترحيل 112). يمتد على وحدتي الانتداب (travel.mjs) والمزايا (benefits-portal.mjs)
// ولا يستبدل أيًا منهما:
//   * جدول البدل صار نسخًا مؤرخة: نسخة اللائحة (م65) سارية، ونسخة التعميم مسودة لا تسري حتى يُدخل صاحب الصلاحية
//     تاريخ سريانها؛ التعميم لا يذكر تاريخًا. الانتداب الذي بدأ قبل السريان يبقى على النسخة القديمة بقيمها.
//   * درجات التذاكر (م41) وقواعدها: نقدًا بأقل سعر للدرجة المستحقة، وتعويض فرق الدرجة الأدنى، ولا تذكرة مع سيارة
//     الشركة، وريال لكل كيلومتر ذهابًا وإيابًا حين لا مطار ولا سيارة، ودرجة أعلى عند مرافقة الرئيس التنفيذي أو الضيوف،
//     وقيمة تذكرة للسائق ومساعده، والدرجة بحسب العقد للمتعاونين والمستشارين والمنتدبين.
//   * المزايا الثلاث بأهلية مشتركة: دوام كامل نظامي، واجتياز فترة التجربة، وآخر تقييم لا يقل عن نسبة في الإعدادات.
// المنصة تحسب وتقترح وتعرض الحساب كاملًا، ولا تصرف ولا تخصم.

export const GRADE_NAMES={A:'الرئيس التنفيذي',B:'نواب الرئيس',C:'مدراء الإدارات / مدراء العموم',D:'العاملون'};
export const TICKET_CLASS_NAMES={first:'الدرجة الأولى',business:'درجة رجال الأعمال',economy:'الدرجة السياحية',per_contract:'بحسب العقد أو قرار صاحب الصلاحية'};
export const TICKET_MODES=[
  ['ticket','تذكرة تحجزها المنشأة بالدرجة المستحقة'],
  ['cash_lowest_fare','قيمة نقدية بأقل سعر متاح للدرجة المستحقة (م41)'],
  ['fare_difference','تعويض فرق السعر لأن الدرجة الصادرة أدنى من المستحقة لعدم التوفر (م41)'],
  ['company_car','سيارة من المنشأة: لا تذكرة، والوقود والصيانة على المنشأة (م41)'],
  ['mileage','لا سيارة ولا مطار في مدينة المهمة: ريال لكل كيلومتر ذهابًا وإيابًا (م41)'],
  ['contract_or_authority','متعاون أو مستشار أو منتدب: الدرجة بحسب العقد أو قرار صاحب الصلاحية']
].map(([key,name])=>({key,name}));
export const HIGHER_CLASS_REASONS=[['ceo','مرافقة الرئيس التنفيذي'],['official_guests','مرافقة ضيوف رسميين']].map(([key,name])=>({key,name}));
export const DRIVER_REASONS=[['materials','نقل مواد تخص المنشأة'],['ceo','مرافقة الرئيس التنفيذي']].map(([key,name])=>({key,name}));
export const MEASURED_FROM={workplace:'من مقر العمل',nearest_airport:'من أقرب مطار'};
export const EXTRA_KINDS=[
  ['parents_insurance','تأمين الوالدين'],
  ['children_education','دراسة الأبناء'],
  ['sports','الأندية الصحية والأجهزة الرياضية']
].map(([key,name])=>({key,name}));
// نوع المطالبة هنا ومفتاح الميزة في benefit_catalog ليسا اسمًا واحدًا في كل الحالات: «sports» مفتاحها «gym».
// المفتاح يُوضع على الميزة، فالجسر مكتوب مرة واحدة هنا ويُقرأ في اللوح وفي أبواب التقديم الثلاثة جميعًا.
// مصدره الوحيد: الصفوف الثلاثة التي يبذرها ترحيل 112 في benefit_catalog.
export const BENEFIT_KEY_OF=Object.freeze({parents_insurance:'parents_insurance',children_education:'children_education',sports:'gym'});
// «ما الذي أوقفه المالك من هذه الثلاث الآن» — مجموعة تُقرأ مرة لكل لوح لا مرة لكل صف.
const hiddenExtras=(db,tenantId)=>{const off=hiddenBenefitKeys(db,tenantId);
  return new Set(Object.entries(BENEFIT_KEY_OF).filter(([,key])=>off.has(key)).map(([kind])=>kind));};
// الرفض عند باب التقديم نفسه: العبارة واحدة مع «مزاياي» ومع دليل الخدمات (refuseHidden)، فمن أوقف الميزة
// من شاشة واحدة أوقفها في بابيها معًا، ولا يبقى بابٌ ثانٍ يقبل ما يرفضه الأول.
function refuseIfStopped(db,tenantId,kind){
  const key=BENEFIT_KEY_OF[kind];
  if(key&&hiddenBenefitKeys(db,tenantId).has(key))refuseHidden(db,tenantId,'benefit',key,EXTRA_KINDS.find(k=>k.key===kind)?.name??kind);
}
// مفتاح المالك يعلو كل فرع قبله: يُطبَّق على كتلة الإتاحة كاملةً بعد بنائها — كما يفعل optionAvailability في
// «مزاياي» بالضبط — لا داخل كل فرع، فلا ينسى نوعٌ جديدٌ يُضاف غدًا المفتاحَ. الأهلية والسقوف والرصيد
// السنوي كلها تسقط أمامه: ميزة أوقفها المالك لا تُعرض متاحة مهما استوفى الموظف شروطها.
function stoppedOver(db,tenantId,availability){
  const off=hiddenExtras(db,tenantId);
  for(const kind of off)if(availability[kind])
    availability[kind]={available:false,switched_off:true,reason:switchedOffReason(db,tenantId,BENEFIT_KEY_OF[kind])};
  return availability;
}
export const EXTRA_STATUS={pending_hr:'بانتظار الموارد البشرية',pending_employee:'بانتظار تأكيدك للمبلغ',pending_authority:'بانتظار صاحب الصلاحية',
  pending_finance:'بانتظار المالية',completed:'مكتمل',rejected:'مرفوض',withdrawn:'مسحوب'};
export const SPORTS_CATEGORIES=[['club','اشتراك نادٍ رياضي'],['equipment','أجهزة رياضية']].map(([key,name])=>({key,name}));
export const CONSENT_TEXT='أقر بموافقتي على خصم نصيبي من قيمة وثيقة تأمين الوالدين من راتبي بالمبلغ والطريقة الموضحين أعلاه، وأعلم أن المادة 51 تمنع الحسم من الأجر بغير موافقتي.';
const CAP={grades:'hr.contracts.manage',authority:'hr.contracts.approve',accept:'hr.policy.accept',benefits:'hr.benefits.manage',
  finance:'benefits.finance.confirm',payroll:'payroll.prepare'};

const id=()=>randomUUID();
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
function actor(db,supplied){
  const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','هذه الشاشات لحسابات الموظفين');
  u.caps=Object.fromEntries(Object.entries(CAP).map(([k,cap])=>[k,holds(db,u,cap)]));return u;
}
export function money(minor){
  if(minor===null||minor===undefined)return '—';
  const n=BigInt(minor),abs=n<0n?-n:n;
  return `${n<0n?'-':''}${(abs/100n).toLocaleString('en-US')}.${String(abs%100n).padStart(2,'0')} ريال`;
}
const minorToAmount=minor=>`${BigInt(minor)/100n}.${String(BigInt(minor)%100n).padStart(2,'0')}`;
export function amountMinor(value,label){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(minor<=0)fail(400,'invalid_money',`${label}: مبلغ موجب`);return minor;
}
// مرجع مستند مقنّع: رقم هوية كامل (ستة أرقام متتالية فأكثر) مرفوض، كما في وحدة المزايا.
function maskedReference(value,label){
  const ref=v.text(value,label,60,2);
  if(/\d{6,}/.test(ref.replace(/[\s-]/g,'')))fail(400,'full_identifier',`${label}: لا تكتب الرقم كاملًا؛ آخر أربعة أرقام تكفي`);
  return ref;
}
const monthEnd=month=>{const [y,m]=month.split('-').map(Number);return `${month}-${String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')}`;};
const addMonth=(month,n)=>{const [y,m]=month.split('-').map(Number),total=y*12+(m-1)+n;return `${Math.floor(total/12)}-${String(total%12+1).padStart(2,'0')}`;};

// ————— 1) الدرجات الوظيفية —————

export function jobGrades(db){
  return db.prepare('SELECT * FROM job_grades ORDER BY sort_order').all().map(g=>({...g,needs_confirmation:!!g.needs_confirmation}));
}
export const gradeOf=(db,tenantId,userId)=>db.prepare('SELECT grade_code FROM employee_job_grades WHERE user_id=? AND tenant_id=?').get(userId,tenantId)?.grade_code??null;
export const travelGradeOf=code=>({A:'ceo',B:'deputy',C:'gm',D:'employee'})[code]??null;
export const gradeCodeOf=grade=>({ceo:'A',deputy:'B',gm:'C',employee:'D'})[grade]??null;

export function recordEmployeeGrade(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.grades&&!holds(db,u,'people.manage'))fail(403,'not_permitted','تسجيل الدرجة الوظيفية لفريق العقود والسجل الوظيفي');
  v.object(input,['user_id','grade_code','note']);
  if(!GRADE_NAMES[input.grade_code])fail(400,'grade_code','اختر درجة من جدول الدرجات: A أو B أو C أو D');
  const person=typeof input.user_id==='string'&&db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id);
  if(!person)fail(404,'not_found','الموظف غير متاح');
  const note=input.note===undefined||input.note===''?'':v.text(input.note,'سند الدرجة',600,0),time=now();
  const before=gradeOf(db,u.tenant_id,person.id);
  db.prepare('INSERT INTO employee_job_grades(user_id,tenant_id,grade_code,note,recorded_by,recorded_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET grade_code=excluded.grade_code,note=excluded.note,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at')
    .run(person.id,u.tenant_id,input.grade_code,note,u.id,time);
  audit(db,u,'employee_job_grade',person.id,'employee_grade.recorded',{grade_code:before},{grade_code:input.grade_code},note);
  return {user_id:person.id,grade_code:input.grade_code};
}

// ————— 2) نسخ جدول البدل —————

const versionRow=row=>row&&({...row,articles:JSON.parse(row.articles),requires_attestation:!!row.requires_attestation});
export function allowanceVersions(db,tenantId){
  return db.prepare('SELECT * FROM secondment_allowance_versions WHERE tenant_id=? ORDER BY code').all(tenantId).map(r=>({
    ...versionRow(r),grades:db.prepare('SELECT * FROM secondment_allowance_grades WHERE version_id=? ORDER BY grade_code').all(r.id)}));
}
// النسخة السارية في تاريخ: الأحدث سريانًا من بين ما بدأ سريانه في ذلك التاريخ أو قبله، ولم ينته قبله.
export function versionInForce(db,tenantId,date=riyadhToday()){
  const row=db.prepare(`SELECT * FROM secondment_allowance_versions WHERE tenant_id=? AND status IN ('active','expired') AND effective_from<=?
    AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC LIMIT 1`).get(tenantId,date,date);
  if(!row)return null;
  const version=versionRow(row);
  version.grades=Object.fromEntries(db.prepare('SELECT * FROM secondment_allowance_grades WHERE version_id=?').all(row.id).map(g=>[g.grade,g]));
  return version;
}
export function ratesFor(db,tenantId,grade,date){
  const version=versionInForce(db,tenantId,date);
  const row=version?.grades[grade];
  return row?{version,domestic_minor:row.domestic_minor,abroad_minor:row.abroad_minor,ticket_class:row.ticket_class,
    ticket_class_source:row.ticket_class_source,ticket_class_conflict:row.ticket_class_conflict}:null;
}
// معاملات الانتداب بقيم النسخة السارية فوق السياسة المقبولة: العتبات والتخفيضات والتمديد من السياسة، والمبالغ من النسخة.
export function parametersWithVersion(params,version){
  if(!version)return params;
  const grades=Object.fromEntries(Object.entries(params.grades).map(([key,row])=>{
    const rate=version.grades[key];
    return [key,rate?{...row,domestic_minor:rate.domestic_minor,abroad_minor:rate.abroad_minor}:row];
  }));
  return {...params,grades};
}

// تفعيل نسخة: تاريخ السريان يدخله صاحب الصلاحية لأن التعميم لا يذكره، وتنتهي النسخة السارية في اليوم السابق له.
export function activateAllowanceVersion(db,supplied,versionId,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.accept)fail(403,'not_permitted','تفعيل نسخة جدول البدل لمدير الموارد البشرية (hr.policy.accept)');
  v.object(input,['version','effective_from','note']);
  const row=typeof versionId==='string'&&db.prepare('SELECT * FROM secondment_allowance_versions WHERE id=? AND tenant_id=?').get(versionId,u.tenant_id);
  if(!row)fail(404,'not_found','النسخة غير متاحة');
  v.version(input.version,row.version);
  if(row.status!=='draft')fail(409,'action_unavailable','النسخة سارية أو منتهية؛ لا تُفعَّل مرتين');
  if(input.effective_from===undefined||input.effective_from===null||input.effective_from==='')
    fail(400,'effective_from_required','التعميم لا يذكر تاريخ سريان: أدخل التاريخ الذي تقرره الإدارة. لا تُفعَّل النسخة قبله');
  const effective=v.date(input.effective_from),note=v.text(input.note,'أساس التفعيل وتاريخ قرار الإدارة',2000,10),time=now();
  const current=db.prepare("SELECT * FROM secondment_allowance_versions WHERE tenant_id=? AND status='active'").get(u.tenant_id);
  if(current&&effective<=current.effective_from)fail(409,'effective_order',`تاريخ السريان يجب أن يكون بعد ${current.effective_from}، تاريخ سريان النسخة الحالية`);
  if(current){
    db.prepare("UPDATE secondment_allowance_versions SET status='expired',effective_to=?,superseded_by=?,version=version+1 WHERE id=?").run(addDays(effective,-1),row.id,current.id);
    audit(db,u,'secondment_allowance_version',current.id,'secondment_version.expired',{status:'active'},{status:'expired',effective_to:addDays(effective,-1)});
  }
  db.prepare("UPDATE secondment_allowance_versions SET status='active',effective_from=?,activated_by=?,activated_at=?,activation_note=?,pending_note='',version=version+1 WHERE id=?")
    .run(effective,u.id,time,note,row.id);
  audit(db,u,'secondment_allowance_version',row.id,'secondment_version.activated',{status:'draft'},{status:'active',effective_from:effective},note);
  return {id:row.id,status:'active',effective_from:effective,expired:current?.id??null};
}

// ————— 3) حساب البدل مع خطواته كاملة —————

const SCOPE_NAMES={domestic:'داخل المملكة',abroad:'خارج المملكة'};
const ROUNDING_NAMES={halala:'بالهللة (بلا تقريب)',riyal_up:'إلى أقرب ريال بالزيادة (م50/5)'};
// م50/5 الموقعة (ص p020): «عند حساب كل من الأجور، والبدلات، والمكافآت، والتعويضات، والحسميات المنصوص عليها في
// هذه اللائحة؛ تُقرّب القيمة إلى أقرب ريال بالزيادة». وقد قبل المالك القاعدة في سياسة قواعد صرف الأجر
// (regulation_policies، kind=pay_rules) بسريان 22 سبتمبر 2026، والبدل بدل منصوص عليه في اللائحة فتشمله القاعدة.
// كان الانتداب يقرأ التقريب من حقل النسخة وحدها (halala في نسخة م65)، فلا تصل قاعدة اللائحة المقبولة إلى البدل
// ولا إلى التذكرة. صارت القاعدة المقبولة هي المرجع، وقيمة النسخة احتياطًا لنسخة سرت قبل قبول القاعدة وحدها،
// فلا يتغير أثر قرار مضى في زمن لم تكن القاعدة فيه مقبولة.
export function secondmentRounding(db,tenantId,date,version){
  const rule=acceptedRule(db,tenantId,'pay_rules',date);
  if(rule)return {mode:rule.parameters.rounding,source:'pay_rules',
    source_note:`التقريب من سياسة قواعد صرف الأجر المقبولة (م50/5)، سارية من ${rule.effective_from}`};
  return {mode:version?.rounding??'halala',source:'version',
    source_note:'لم تُقبل سياسة قواعد صرف الأجر في هذا التاريخ؛ التقريب من نسخة جدول البدل نفسها'};
}
// دالة صرفة: البدل اليومي × الأيام الفعلية × نسبة التخفيض، ثم التقريب. تُرجع الحساب وخطواته بنص يقرأه الموظف والمعتمد.
export function perDiemBreakdown({grade_code,grade_name,scope,daily_rate_minor,days,factor_bp,factor_reason,rounding,rounding_note='',version_title}){
  const raw=Number((BigInt(daily_rate_minor)*BigInt(days)*BigInt(factor_bp)+5000n)/10000n);
  const total=roundMoney(raw,rounding);
  const pct=factor_bp/100;
  const steps=[
    `الدرجة ${grade_code} — ${grade_name}${version_title?` (${version_title})`:''}`,
    `البدل اليومي ${SCOPE_NAMES[scope]}: ${money(daily_rate_minor)}`,
    `عدد أيام المهمة الفعلية: ${days}`,
    `نسبة الاستحقاق: ${pct}% — ${factor_reason}`,
    `${money(daily_rate_minor)} × ${days} يوم × ${pct}% = ${money(raw)}`,
    `التقريب ${ROUNDING_NAMES[rounding]}: ${money(total)}${rounding_note?` — ${rounding_note}`:''}`
  ];
  return {daily_rate_minor,days,factor_bp,factor_reason,raw_minor:raw,rounding,allowance_minor:total,
    formula:'البدل = البدل اليومي للدرجة × الأيام الفعلية × نسبة الاستحقاق، ثم التقريب',steps};
}
// حساب البدل من نسخة التاريخ مباشرة: يستعمله travel.mjs عند القرار، وتستعمله الشاشات للعرض قبل القرار.
export function perDiemFor(db,tenantId,{grade,scope,days,factor_bp,factor_reason,date}){
  const rates=ratesFor(db,tenantId,grade,date);
  if(!rates)fail(409,'no_allowance_version',`لا توجد نسخة سارية من جدول بدل الانتداب في ${date}`);
  return perDiemBreakdown({grade_code:gradeCodeOf(grade),grade_name:GRADE_NAMES[gradeCodeOf(grade)],scope,
    daily_rate_minor:scope==='abroad'?rates.abroad_minor:rates.domestic_minor,days,factor_bp,factor_reason,
    rounding:rates.version.rounding,version_title:rates.version.title});
}

// ————— 4) ضوابط الانتداب: الإقرار وازدواج العمل الإضافي —————

export const attestationOf=(db,travelId)=>db.prepare('SELECT * FROM secondment_attestations WHERE travel_id=?').get(travelId)??null;
export function recordAttestation(db,supplied,travelId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['statement']);
  const t=typeof travelId==='string'&&db.prepare('SELECT * FROM travel_decisions WHERE id=? AND tenant_id=?').get(travelId,u.tenant_id);
  if(!t)fail(404,'not_found','قرار الانتداب غير متاح');
  if(t.user_id===u.id)fail(409,'separation_of_duties','لا يقر المنتدب لنفسه بأنه لا بديل عنه؛ يقر مديره أو صاحب الصلاحية');
  const manager=db.prepare('SELECT manager_id FROM users WHERE id=?').get(t.user_id)?.manager_id??null;
  if(manager!==u.id&&!u.caps.authority)fail(403,'not_permitted','الإقرار من المدير المباشر للمنتدب أو من صاحب الصلاحية');
  if(attestationOf(db,t.id))fail(409,'already_attested','الإقرار مسجل لهذا الانتداب ولا يُعدَّل');
  const statement=v.text(input.statement,'إقرار بأنه لا يوجد في منطقة المهمة موظف يستطيع أداءها',2000,20),time=now();
  db.prepare('INSERT INTO secondment_attestations(travel_id,tenant_id,attested_by,statement,created_at) VALUES(?,?,?,?,?)').run(t.id,u.tenant_id,u.id,statement,time);
  audit(db,u,'travel_decision',t.id,'secondment.attested',{},{attested_by:u.id});
  return {travel_id:t.id};
}
// م77(9) (ص 27): لا يجتمع أجر عمل إضافي مع التكليف بمهمة رسمية خلال أيام العمل المعتادة وحدها. يُقرأ التكليف القائم والساعات المسجلة معًا،
// ولا يُعد تعارضًا إلا ما وقع منهما في يوم عمل معتاد (نوع اليوم من الطلب أو التكليف، وإلا يُحسب من السياسة المعتمدة أو أيام م73(1)).
export function overtimeOverlap(db,userId,from,to){
  const user=db.prepare('SELECT id,tenant_id FROM users WHERE id=?').get(userId);
  const clash=user?overtimeOnWorkingDays(db,user,from,to):null;
  if(!clash)return null;
  if(clash.kind==='assignment'){
    const assignment=db.prepare(`SELECT from_date,to_date FROM overtime_assignments WHERE user_id=? AND status IN ('proposed','authorised','budget_approved')
      AND from_date<=? AND to_date>=? ORDER BY from_date LIMIT 1`).get(userId,clash.date,clash.date);
    return {kind:'assignment',from:assignment.from_date,to:assignment.to_date};
  }
  return {kind:'request',from:clash.date,to:clash.date};
}
// تُستدعى من travel.mjs قبل اعتماد الانتداب. النسخة السارية تقرر هل الإقرار لازم (التعميم يلزمه، واللائحة لا تذكره).
export function assertSecondmentControls(db,travel,version){
  const clash=overtimeOverlap(db,travel.user_id,travel.start_date,travel.end_date);
  if(clash)fail(409,'overtime_overlap',`للموظف عمل إضافي ${clash.kind==='assignment'?'مكلف به':'مسجل'} في المدة ${clash.from}${clash.to!==clash.from?` إلى ${clash.to}`:''} يقع منه يوم عمل معتاد داخل الانتداب. ${ART77_9}`);
  if(version?.requires_attestation&&!attestationOf(db,travel.id))
    fail(409,'attestation_required','يلزم قبل القرار إقرار مكتوب من المدير المباشر بأنه لا يوجد في منطقة المهمة موظف يستطيع أداء المهمة');
  return true;
}

// ————— 5) التذاكر (م41) —————

export function computeTicket(input,{entitled_class,mileage_rate_minor,rounding,rounding_note=''}){
  const steps=[],mode=input.mode;
  let amount=0,payable='none';
  steps.push(`الدرجة المستحقة: ${TICKET_CLASS_NAMES[entitled_class]}`);
  if(mode==='ticket'){steps.push('تحجز المنشأة التذكرة بالدرجة المستحقة؛ لا مبلغ للموظف.');payable='company_expense';}
  else if(mode==='cash_lowest_fare'){
    amount=input.entitled_fare_minor;payable='payroll_proposal';
    steps.push(`أقل سعر متاح للدرجة المستحقة: ${money(amount)} (م41: تُصرف قيمة التذكرة نقدًا بأقل سعر للدرجة المستحقة).`);
  }else if(mode==='fare_difference'){
    amount=Math.max(0,input.entitled_fare_minor-input.issued_fare_minor);payable='payroll_proposal';
    steps.push(`سعر الدرجة المستحقة ${money(input.entitled_fare_minor)} − سعر الدرجة الصادرة (${TICKET_CLASS_NAMES[input.issued_class]}) ${money(input.issued_fare_minor)} = ${money(amount)}`,
      'تُعوَّض الفروق لأن الدرجة الصادرة أدنى من المستحقة لعدم توفرها (م41).');
  }else if(mode==='company_car'){
    steps.push('استُعملت سيارة من المنشأة: لا تُصرف تذكرة ولا قيمتها، وتتحمل المنشأة الوقود والصيانة (م41).');
  }else if(mode==='mileage'){
    amount=input.distance_km*2*mileage_rate_minor;payable='payroll_proposal';
    steps.push(`لا سيارة من المنشأة ولا مطار في مدينة المهمة: ${input.distance_km} كم × 2 (ذهابًا وإيابًا) × ${money(mileage_rate_minor)} للكيلومتر = ${money(amount)}`,
      `المسافة مقيسة ${MEASURED_FROM[input.measured_from]} (م41).`);
  }else{
    amount=input.entitled_fare_minor??0;payable=amount?'payroll_proposal':'none';
    steps.push('متعاون أو مستشار أو منتدب: الدرجة والقيمة بحسب العقد أو قرار صاحب الصلاحية، مكتوبين في سند القرار.');
  }
  if(input.higher_class){
    const reason=HIGHER_CLASS_REASONS.find(r=>r.key===input.higher_class_reason)?.name;
    steps.push(`سُمح بدرجة أعلى من المستحقة: ${reason} (م41).`);
  }
  if(input.driver){
    const seats=1+(input.driver_assistant?1:0),extra=seats*input.driver_value_minor;
    amount+=extra;if(extra)payable='payroll_proposal';
    steps.push(`قيمة تذكرة للسائق${input.driver_assistant?' ولمساعده':''} (${DRIVER_REASONS.find(r=>r.key===input.driver_reason)?.name}): ${seats} × ${money(input.driver_value_minor)} = ${money(extra)} (م41).`);
  }
  const total=roundMoney(amount,rounding);
  if(total!==amount)steps.push(`التقريب ${ROUNDING_NAMES[rounding]}: ${money(total)}${rounding_note?` — ${rounding_note}`:''}`);
  steps.push(`الإجمالي: ${money(total)}`);
  return {amount_minor:total,payable_via:total?payable:(mode==='ticket'?'company_expense':'none'),steps};
}
export function recordTicket(db,supplied,travelId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['mode','issued_class','entitled_fare','issued_fare','distance_km','measured_from','higher_class','higher_class_reason',
    'driver','driver_assistant','driver_reason','driver_value','contract_basis']);
  const t=typeof travelId==='string'&&db.prepare('SELECT * FROM travel_decisions WHERE id=? AND tenant_id=?').get(travelId,u.tenant_id);
  if(!t)fail(404,'not_found','قرار الانتداب غير متاح');
  const manager=db.prepare('SELECT manager_id FROM users WHERE id=?').get(t.user_id)?.manager_id??null;
  if(t.user_id!==u.id&&t.proposed_by!==u.id&&manager!==u.id&&!u.caps.authority&&!u.caps.benefits)fail(404,'not_found','قرار الانتداب غير متاح');
  if(!TICKET_MODES.some(m=>m.key===input.mode))fail(400,'mode','اختر وضع التذكرة من قائمة م41');
  if(!t.grade)fail(409,'grade_required','حدد درجة المنتدب في قرار الانتداب قبل تسجيل التذكرة');
  const version=versionInForce(db,u.tenant_id,t.start_date);
  if(!version)fail(409,'no_allowance_version','لا توجد نسخة سارية من جدول البدل ودرجات التذاكر في تاريخ الانتداب');
  const rate=version.grades[t.grade];
  const entitled=input.mode==='contract_or_authority'?'per_contract':rate.ticket_class;
  const clean={mode:input.mode,higher_class:input.higher_class===true?1:0,higher_class_reason:'',driver:input.driver===true?1:0,
    driver_assistant:input.driver_assistant===true?1:0,driver_reason:'',driver_value_minor:0,contract_basis:'',
    issued_class:null,entitled_fare_minor:null,issued_fare_minor:null,distance_km:null,rate_minor:null,measured_from:''};
  if(input.mode==='cash_lowest_fare')clean.entitled_fare_minor=amountMinor(input.entitled_fare,'أقل سعر متاح للدرجة المستحقة');
  if(input.mode==='fare_difference'){
    if(!['first','business','economy'].includes(input.issued_class))fail(400,'issued_class','اختر الدرجة التي صدرت فعلًا');
    clean.issued_class=input.issued_class;
    clean.entitled_fare_minor=amountMinor(input.entitled_fare,'سعر الدرجة المستحقة');
    clean.issued_fare_minor=amountMinor(input.issued_fare,'سعر الدرجة الصادرة');
    if(clean.issued_fare_minor>clean.entitled_fare_minor)fail(400,'fare_order','سعر الدرجة الصادرة أعلى من المستحقة: لا فرق يُعوَّض');
  }
  if(input.mode==='mileage'){
    if(!Number.isInteger(input.distance_km)||input.distance_km<1||input.distance_km>5000)fail(400,'distance_km','المسافة بالكيلومتر عدد صحيح موجب');
    if(!MEASURED_FROM[input.measured_from])fail(400,'measured_from','حدد القياس: من مقر العمل أو من أقرب مطار');
    // م41 فقرة (ح) الموقعة (ص p017) تنص على المعدل نفسه: «فإن المنشأة تصرف له ريالًا واحدًا عن الكيلو متر الواحد
    // ... ذهابًا وإيابًا». فالمعدل حكم لائحة لا شرط تعميم؛ والرفض هنا لا يقع إلا إذا كانت النسخة السارية فعلًا بلا معدل.
    if(!version.mileage_rate_minor)fail(409,'no_mileage_rate',`النسخة السارية «${version.title}» لا تحمل معدل الكيلومتر رغم أن م41 (ح) تنص عليه. يصححها مدير الموارد البشرية (hr.policy.accept) بنسخة تحمل المعدل قبل تسجيل هذا الوضع`);
    clean.distance_km=input.distance_km;clean.rate_minor=version.mileage_rate_minor;clean.measured_from=input.measured_from;
  }
  if(input.mode==='contract_or_authority'){
    clean.contract_basis=v.text(input.contract_basis,'نص العقد أو قرار صاحب الصلاحية بدرجة السفر',1000,10);
    if(input.entitled_fare!==undefined&&input.entitled_fare!=='')clean.entitled_fare_minor=amountMinor(input.entitled_fare,'القيمة بحسب العقد');
  }
  if(clean.higher_class){
    if(!HIGHER_CLASS_REASONS.some(r=>r.key===input.higher_class_reason))fail(400,'higher_class_reason','الدرجة الأعلى تُسمح عند مرافقة الرئيس التنفيذي أو الضيوف الرسميين فقط (م41)');
    clean.higher_class_reason=input.higher_class_reason;
  }
  if(clean.driver){
    if(!DRIVER_REASONS.some(r=>r.key===input.driver_reason))fail(400,'driver_reason','قيمة تذكرة السائق عند نقل مواد المنشأة أو مرافقة الرئيس التنفيذي (م41)');
    clean.driver_reason=input.driver_reason;
    clean.driver_value_minor=amountMinor(input.driver_value,'قيمة تذكرة السائق');
  }else if(input.driver_assistant===true)fail(400,'driver_assistant','مساعد السائق لا يُسجَّل بغير سائق');
  // التقريب من قاعدة م50/5 المقبولة إن كانت سارية في تاريخ الانتداب، لا من حقل النسخة (انظر secondmentRounding).
  const rounding=secondmentRounding(db,u.tenant_id,t.start_date,version);
  const result=computeTicket({...clean,mode:input.mode},{entitled_class:entitled,mileage_rate_minor:version.mileage_rate_minor,rounding:rounding.mode,rounding_note:rounding.source_note});
  const ticketId=id(),time=now();
  const basis={version_id:version.id,version_title:version.title,entitled_class:entitled,ticket_class_source:rate.ticket_class_source,
    ticket_class_conflict:rate.ticket_class_conflict,rounding:rounding.mode,rounding_source:rounding.source,rounding_note:rounding.source_note,
    steps:result.steps,articles:['م41',...(rounding.source==='pay_rules'?['م50/5']:[])]};
  db.prepare(`INSERT INTO secondment_tickets(id,tenant_id,travel_id,version_id,grade,entitled_class,mode,issued_class,entitled_fare_minor,issued_fare_minor,
    distance_km,rate_minor,measured_from,higher_class,higher_class_reason,driver,driver_assistant,driver_reason,driver_value_minor,contract_basis,
    amount_minor,payable_via,basis,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(ticketId,u.tenant_id,t.id,version.id,t.grade,entitled,input.mode,clean.issued_class,clean.entitled_fare_minor,clean.issued_fare_minor,
      clean.distance_km,clean.rate_minor,clean.measured_from,clean.higher_class,clean.higher_class_reason,clean.driver,clean.driver_assistant,
      clean.driver_reason,clean.driver_value_minor,clean.contract_basis,result.amount_minor,result.payable_via,JSON.stringify(basis),u.id,time);
  audit(db,u,'secondment_ticket',ticketId,'secondment_ticket.recorded',{},{travel_id:t.id,mode:input.mode,amount_minor:result.amount_minor});
  return {id:ticketId,amount_minor:result.amount_minor,payable_via:result.payable_via,entitled_class:entitled,steps:result.steps};
}
export const ticketsOf=(db,tenantId,travelId)=>db.prepare('SELECT * FROM secondment_tickets WHERE tenant_id=? AND travel_id=? ORDER BY created_at').all(tenantId,travelId)
  .map(r=>({...r,basis:JSON.parse(r.basis),mode_name:TICKET_MODES.find(m=>m.key===r.mode)?.name,entitled_class_name:TICKET_CLASS_NAMES[r.entitled_class]}));

// ————— 6) لوحة الانتداب والتعميم —————

export function secondmentBoard(db,supplied){
  const u=actor(db,supplied),today=riyadhToday();
  const versions=allowanceVersions(db,u.tenant_id).map(x=>({...x,
    activated_by_name:personName(db,x.activated_by),
    actions:x.status==='draft'&&u.caps.accept?['activate_version']:[]}));
  const live=versionInForce(db,u.tenant_id,today);
  return {today,user_id:u.id,permissions:u.caps,grades:jobGrades(db),ticket_classes:TICKET_CLASS_NAMES,
    ticket_modes:TICKET_MODES,higher_class_reasons:HIGHER_CLASS_REASONS,driver_reasons:DRIVER_REASONS,
    versions,version_in_force:live?{id:live.id,code:live.code,title:live.title,effective_from:live.effective_from,rounding:live.rounding,
      mileage_rate_minor:live.mileage_rate_minor,requires_attestation:live.requires_attestation}:null,
    open_decisions:openDecisions(db,u.tenant_id),
    note:'جدول البدل نسخ مؤرخة: الانتداب يُحسب بنسخة تاريخ بدايته، فلا يتغير أثر قرار مضى. نسخة التعميم لا تسري حتى يُدخل مدير الموارد البشرية تاريخ سريانها، لأن التعميم لا يذكر تاريخًا. المنصة تحسب وتقترح ولا تصرف.'};
}
// القرارات المعلقة التي لا تفترضها المنصة: تُعرض كما هي حتى يحسمها المالك.
export function openDecisions(db,tenantId){
  const out=[],settings=settingsOf(db,tenantId);
  const circular=db.prepare("SELECT * FROM secondment_allowance_versions WHERE tenant_id=? AND code='circular'").get(tenantId);
  if(circular&&circular.status==='draft')out.push({key:'circular_effective_from',title:'تاريخ سريان تعميم بدل الانتداب',
    detail:'التعميم لا يذكر تاريخ سريان. النسخة الجديدة موقوفة حتى يدخله صاحب الصلاحية؛ حتى ذلك الحين يسري جدول م65.'});
  const conflict=db.prepare("SELECT ticket_class_conflict FROM secondment_allowance_grades g JOIN secondment_allowance_versions v ON v.id=g.version_id WHERE v.tenant_id=? AND v.code='circular' AND g.grade='deputy'").get(tenantId);
  if(conflict?.ticket_class_conflict)out.push({key:'deputy_ticket_class',title:'درجة تذكرة نواب الرئيس',detail:conflict.ticket_class_conflict});
  out.push({key:'grade_c_naming',title:'«مدراء العموم» و«مدراء الإدارات»',
    detail:'اللائحة تسمي الدرجة C «مدراء العموم» والتعميم يسميها «مدراء الإدارات». المنصة تعاملهما درجة واحدة مؤقتًا، ويلزم تأكيد المالك.'});
  if(!db.prepare('SELECT 1 FROM education_grade_caps WHERE tenant_id=? LIMIT 1').get(tenantId)||!settings.education_cap_basis)
    out.push({key:'education_amounts',title:'مبالغ بدل دراسة الأبناء',
      detail:'المصدر لا يذكر المبلغ السنوي لكل درجة ولا هل السقف لكل طفل أو لكل موظف. الجدول فارغ والطلب ممنوع حتى تملأه الإدارة.'});
  if(!settings.parents_year_basis)out.push({key:'parents_year_basis',title:'«العام المالي» في تأمين الوالدين',
    detail:'السقف 2500 ريال لكل والد في «العام المالي». هل هو السنة الميلادية المستعملة في بقية المنصة؟ يلزم تأكيد قبل أن تُحسب السنة تلقائيًا.'});
  out.push({key:'benefits_deck_links',title:'روابط عرض المزايا',
    detail:'عرض المزايا المصدر يشير إلى موقع جهة أخرى؛ لم تُستعمل روابطه ولم يُنقل منها شيء إلى المنصة.'});
  return out;
}

// ————— 7) المزايا الثلاث: الإعدادات والأهلية —————

export const settingsOf=(db,tenantId)=>db.prepare('SELECT * FROM benefit_extra_settings WHERE tenant_id=?').get(tenantId)
  ??{tenant_id:tenantId,min_appraisal_bp:7000,parents_share_bp:500,parents_cap_minor:250000,parents_max_instalments:12,
     parents_year_basis:null,education_cap_basis:null,education_max_children:2,sports_default_cap_minor:550000};
export function saveBenefitSettings(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.accept)fail(403,'not_permitted','إعدادات المزايا لمدير الموارد البشرية (hr.policy.accept)');
  v.object(input,['min_appraisal_percent','education_cap_basis','parents_year_basis','note']);
  const current=settingsOf(db,u.tenant_id),next={...current};
  if(input.min_appraisal_percent!==undefined&&input.min_appraisal_percent!==null){
    if(typeof input.min_appraisal_percent!=='number'||!Number.isFinite(input.min_appraisal_percent)||input.min_appraisal_percent<0||input.min_appraisal_percent>100)
      fail(400,'min_appraisal_percent','نسبة التقييم من 0 إلى 100');
    next.min_appraisal_bp=Math.round(input.min_appraisal_percent*100);
  }
  if(input.education_cap_basis!==undefined&&input.education_cap_basis!==null&&input.education_cap_basis!==''){
    if(!['per_child','per_employee'].includes(input.education_cap_basis))fail(400,'education_cap_basis','أساس السقف: لكل طفل أو لكل موظف');
    next.education_cap_basis=input.education_cap_basis;
  }
  if(input.parents_year_basis!==undefined&&input.parents_year_basis!==null&&input.parents_year_basis!==''){
    if(!['gregorian','financial'].includes(input.parents_year_basis))fail(400,'parents_year_basis','العام: ميلادي أو مالي مستقل');
    next.parents_year_basis=input.parents_year_basis;
  }
  db.prepare('UPDATE benefit_extra_settings SET min_appraisal_bp=?,education_cap_basis=?,parents_year_basis=?,updated_by=?,updated_at=? WHERE tenant_id=?')
    .run(next.min_appraisal_bp,next.education_cap_basis,next.parents_year_basis,u.id,now(),u.tenant_id);
  audit(db,u,'benefit_extra_settings',u.tenant_id,'benefit_extra_settings.saved',
    {min_appraisal_bp:current.min_appraisal_bp,education_cap_basis:current.education_cap_basis,parents_year_basis:current.parents_year_basis},
    {min_appraisal_bp:next.min_appraisal_bp,education_cap_basis:next.education_cap_basis,parents_year_basis:next.parents_year_basis},
    input.note===undefined||input.note===''?'':v.text(input.note,'سند القرار',1000,0));
  return {tenant_id:u.tenant_id,min_appraisal_bp:next.min_appraisal_bp};
}
export function setGradeCap(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.accept&&!u.caps.benefits)fail(403,'not_permitted','سقوف المزايا لفريق المزايا ومدير الموارد البشرية');
  v.object(input,['table','grade_code','amount','note']);
  if(!['education','sports'].includes(input.table))fail(400,'table','الجدول: دراسة الأبناء أو الأندية الصحية');
  if(!GRADE_NAMES[input.grade_code])fail(400,'grade_code','اختر درجة من جدول الدرجات');
  const minor=amountMinor(input.amount,'السقف السنوي'),note=input.note===undefined||input.note===''?'':v.text(input.note,'سند السقف',600,0),time=now();
  const table=input.table==='education'?'education_grade_caps':'sports_grade_caps';
  db.prepare(`INSERT INTO ${table}(tenant_id,grade_code,annual_cap_minor,note,recorded_by,recorded_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(tenant_id,grade_code) DO UPDATE SET annual_cap_minor=excluded.annual_cap_minor,note=excluded.note,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at`)
    .run(u.tenant_id,input.grade_code,minor,note,u.id,time);
  audit(db,u,'benefit_grade_cap',`${input.table}:${input.grade_code}`,'benefit_grade_cap.recorded',{},{annual_cap_minor:minor},note);
  return {table:input.table,grade_code:input.grade_code,annual_cap_minor:minor};
}
export const educationCaps=(db,tenantId)=>db.prepare('SELECT * FROM education_grade_caps WHERE tenant_id=? ORDER BY grade_code').all(tenantId);
export const sportsCaps=(db,tenantId)=>db.prepare('SELECT * FROM sports_grade_caps WHERE tenant_id=? ORDER BY grade_code').all(tenantId);
const sportsCapFor=(db,tenantId,gradeCode)=>db.prepare('SELECT annual_cap_minor FROM sports_grade_caps WHERE tenant_id=? AND grade_code=?').get(tenantId,gradeCode)?.annual_cap_minor
  ??settingsOf(db,tenantId).sports_default_cap_minor;

// آخر تقييم أداء صادر للموظف، نسبةً مئوية بالنقاط الأساسية (10000 = 100%).
// درجة التقييم في وحدة الأداء رقم على سلم الدورة (final_score_bp = الدرجة × 100 من scale_max)، فتُحوَّل هنا إلى نسبة.
export function lastAppraisalBp(db,tenantId,userId){
  const row=db.prepare(`SELECT r.final_score_bp,c.scale_max FROM performance_reviews r JOIN review_cycles c ON c.id=r.cycle_id
    WHERE r.tenant_id=? AND r.user_id=? AND r.status IN ('released','acknowledged','appealed','appeal_decided')
    AND r.final_score_bp IS NOT NULL ORDER BY r.updated_at DESC LIMIT 1`).get(tenantId,userId);
  return row?Math.round(row.final_score_bp*100/row.scale_max):null;
}
// الأهلية المشتركة للمزايا الثلاث. الرفض يسمي الشرط غير المستوفى بنصه، لا «غير مؤهل» وحدها.
export function sharedEligibility(db,tenantId,userId,date=riyadhToday()){
  const settings=settingsOf(db,tenantId),facts=factsOf(db,tenantId,userId),unmet=[];
  if(!facts)return {ok:false,unmet:['لا سجل موظف'],text:'لا سجل موظف'};
  if(facts.employment_type!=='full_time')
    unmet.push(facts.employment_type?'الميزة للعاملين بدوام كامل نظامي، ونوع توظيفك في السجل ليس دوامًا كاملًا':'نوع التوظيف غير مسجل في سجلك الوظيفي: الميزة للعاملين بدوام كامل نظامي');
  if(facts.profile_status&&facts.profile_status!=='active')unmet.push('سجلك الوظيفي ليس على رأس العمل');
  if(!facts.probation_end)unmet.push('لا عقد ساري في سجلك، فلا يمكن التحقق من اجتياز فترة التجربة');
  else if(facts.probation_end>date)unmet.push(`لم تجتز فترة التجربة بعد: تنتهي في ${facts.probation_end}`);
  const appraisal=lastAppraisalBp(db,tenantId,userId);
  if(appraisal===null)unmet.push('لا يوجد تقييم أداء صادر لك بعد، والميزة تشترط آخر تقييم');
  else if(appraisal<settings.min_appraisal_bp)
    unmet.push(`آخر تقييم أداء لك ${appraisal/100}% وهو أقل من الحد المطلوب ${settings.min_appraisal_bp/100}%`);
  return {ok:!unmet.length,unmet,appraisal_bp:appraisal,min_appraisal_bp:settings.min_appraisal_bp,
    text:unmet.length?`لا تنطبق عليك الآن: ${unmet.join('؛ ')}`:'تنطبق عليك شروط الأهلية المشتركة'};
}
function requireEligible(db,tenantId,userId,date){
  const e=sharedEligibility(db,tenantId,userId,date);
  if(!e.ok)fail(409,'not_eligible',e.text);
  return e;
}
function requireGrade(db,tenantId,userId){
  const code=gradeOf(db,tenantId,userId);
  if(!code)fail(409,'grade_required','درجتك الوظيفية غير مسجلة في المنصة، وسقوف هذه المزايا بحسب الدرجة. اطلب من الموارد البشرية تسجيلها');
  return code;
}

// ————— 8) طلبات المزايا الثلاث —————

function nextReference(db,tenantId,year){
  const n=db.prepare('SELECT COUNT(*) AS n FROM benefit_extra_requests WHERE tenant_id=? AND reference LIKE ?').get(tenantId,`BEX-${year}-%`).n+1;
  return `BEX-${year}-${String(n).padStart(4,'0')}`;
}
function extraRecord(db,u,requestId){
  const r=typeof requestId==='string'&&db.prepare('SELECT * FROM benefit_extra_requests WHERE id=? AND tenant_id=?').get(requestId,u.tenant_id);
  if(!r)fail(404,'not_found','الطلب غير متاح');
  return r;
}
// الفاتورة الضريبية: رقمها مع الرقم الضريبي للمورد لا يتكرر في الكيان.
function storeInvoice(db,u,{requestId,kind,invoice}){
  v.object(invoice,['invoice_number','supplier_tax_number','supplier_name','invoice_date','amount']);
  const number=v.text(invoice.invoice_number,'رقم الفاتورة الضريبية',60,2),tax=v.text(invoice.supplier_tax_number,'الرقم الضريبي للمورد',40,5);
  if(db.prepare('SELECT reference FROM benefit_extra_invoices i JOIN benefit_extra_requests r ON r.id=i.request_id WHERE i.tenant_id=? AND i.invoice_number=? AND i.supplier_tax_number=?').get(u.tenant_id,number,tax))
    fail(409,'duplicate_invoice',`الفاتورة ${number} من المورد ذي الرقم الضريبي ${tax} مستعملة في مطالبة سابقة؛ لا تُصرف فاتورة مرتين`);
  const amount=amountMinor(invoice.amount,'مبلغ الفاتورة'),invoiceId=id();
  db.prepare('INSERT INTO benefit_extra_invoices(id,tenant_id,request_id,kind,invoice_number,supplier_tax_number,supplier_name,invoice_date,amount_minor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(invoiceId,u.tenant_id,requestId,kind,number,tax,v.text(invoice.supplier_name,'اسم المورد',160,2),v.date(invoice.invoice_date),amount,now());
  return {id:invoiceId,amount_minor:amount,invoice_number:number,supplier_tax_number:tax};
}

// 8/أ) تأمين الوالدين: الموظف ← الموارد البشرية (الأهلية والمستندات وقيمة العرض) ← إقرار الموظف بالخصم ← صاحب الصلاحية ← جدول أقساط مقترحة.
export function submitParentsInsurance(db,supplied,input){
  writing(db);const u=actor(db,supplied),date=riyadhToday();
  v.object(input,['parents','payment_mode','instalment_months','note']);
  refuseIfStopped(db,u.tenant_id,'parents_insurance');
  requireEligible(db,u.tenant_id,u.id,date);
  const gradeCode=requireGrade(db,u.tenant_id,u.id);
  const settings=settingsOf(db,u.tenant_id);
  if(!Array.isArray(input.parents)||!input.parents.length||input.parents.length>2)fail(400,'parents','أضف والدًا واحدًا أو كليهما');
  const parents=input.parents.map((p,index)=>{
    v.object(p,['relation','parent_name','id_reference','birth_date']);
    if(!['father','mother'].includes(p.relation))fail(400,'relation','صلة القرابة: والد أو والدة');
    const birth=v.date(p.birth_date);
    if(birth>date)fail(400,'future_date','تاريخ الميلاد: لا يُسجَّل تاريخ لم يأتِ بعد');
    return {seq:index+1,relation:p.relation,parent_name:v.text(p.parent_name,'اسم الوالد أو الوالدة',160,3),
      id_reference:maskedReference(p.id_reference,'مرجع الهوية'),birth_date:birth};
  });
  if(new Set(parents.map(p=>p.relation)).size!==parents.length)fail(400,'relation','لا يُضاف الوالد أو الوالدة مرتين في طلب واحد');
  if(!['one_off','instalments'].includes(input.payment_mode))fail(400,'payment_mode','اختر: خصم واحد أو أقساط');
  let months=null;
  if(input.payment_mode==='instalments'){
    months=input.instalment_months;
    if(!Number.isInteger(months)||months<2||months>settings.parents_max_instalments)fail(400,'instalment_months',`عدد الأقساط من 2 إلى ${settings.parents_max_instalments} شهرًا`);
  }
  const requestId=id(),year=date.slice(0,4),reference=nextReference(db,u.tenant_id,year),time=now();
  const details={parents_count:parents.length,note:input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة',1000,0)};
  db.prepare(`INSERT INTO benefit_extra_requests(id,tenant_id,reference,employee_id,grade_code,kind,benefit_year,status,details,payment_mode,instalment_months,created_at,updated_at)
    VALUES(?,?,?,?,?,'parents_insurance',?,'pending_hr',?,?,?,?,?)`)
    .run(requestId,u.tenant_id,reference,u.id,gradeCode,year,JSON.stringify(details),input.payment_mode,months,time,time);
  for(const p of parents)db.prepare('INSERT INTO benefit_extra_parents(id,tenant_id,request_id,seq,relation,parent_name,id_reference,birth_date,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id(),u.tenant_id,requestId,p.seq,p.relation,p.parent_name,p.id_reference,p.birth_date,time);
  audit(db,u,'benefit_extra_request',requestId,'benefit_extra.submitted',{},{kind:'parents_insurance',reference});
  return {id:requestId,reference};
}
// الموارد البشرية تدخل قيمة عرض شركة التأمين، فيحسب النظام نصيب الموظف: أقل من (القيمة × النسبة) والسقف لكل والد.
export function hrQuoteParents(db,supplied,requestId,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.benefits)fail(403,'not_permitted','التحقق من الأهلية والمستندات لحامل تصريح المزايا');
  v.object(input,['version','policy_value','documents_verified','note']);
  const r=extraRecord(db,u,requestId);v.version(input.version,r.version);
  if(r.kind!=='parents_insurance')fail(409,'action_unavailable','هذا الإجراء لطلب تأمين الوالدين');
  if(r.employee_id===u.id)fail(409,'separation_of_duties','لا يقرر مسؤول المزايا في طلبه هو');
  if(r.status!=='pending_hr')fail(409,'action_unavailable','الطلب ليس بانتظار الموارد البشرية');
  if(input.documents_verified!==true)fail(400,'documents_verified','أكد التحقق من مستندات صلة القرابة قبل إدخال قيمة العرض');
  const settings=settingsOf(db,u.tenant_id);
  const policyValue=amountMinor(input.policy_value,'قيمة عرض شركة التأمين');
  const parents=db.prepare('SELECT * FROM benefit_extra_parents WHERE request_id=? ORDER BY seq').all(r.id);
  const share=Math.ceil(policyValue*settings.parents_share_bp/10000);
  const cap=settings.parents_cap_minor*parents.length;
  const amount=Math.min(share,cap);
  const calculation={steps:[
    `قيمة وثيقة التأمين من عرض شركة التأمين: ${money(policyValue)}`,
    `نصيب الموظف ${settings.parents_share_bp/100}% من القيمة: ${money(share)}`,
    `السقف ${money(settings.parents_cap_minor)} لكل والد × ${parents.length} = ${money(cap)}`,
    `المستحق عليك = الأقل من الاثنين = ${money(amount)}`,
    r.payment_mode==='instalments'?`طريقة السداد: ${r.instalment_months} قسطًا شهريًا` : 'طريقة السداد: خصم واحد'
  ],policy_value_minor:policyValue,share_minor:share,cap_minor:cap,amount_minor:amount,
    formula:`نصيب الموظف = أقل من (قيمة الوثيقة × ${settings.parents_share_bp/100}%) و(${money(settings.parents_cap_minor)} لكل والد في السنة)`};
  const time=now(),note=input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة القرار',1000,0);
  db.prepare("UPDATE benefit_extra_requests SET status='pending_employee',policy_value_minor=?,cap_minor=?,amount_minor=?,calculation=?,hr_by=?,hr_at=?,hr_note=?,version=version+1,updated_at=? WHERE id=?")
    .run(policyValue,cap,amount,JSON.stringify(calculation),u.id,time,note,time,r.id);
  audit(db,u,'benefit_extra_request',r.id,'benefit_extra.quoted',{status:r.status},{status:'pending_employee',amount_minor:amount});
  return {id:r.id,status:'pending_employee',amount_minor:amount,calculation};
}
// م51: لا حسم من الأجر بغير موافقة العامل. الإقرار داخل النموذج، بنصه وتاريخه ومن أقر به، ولا يُعدَّل بعد تسجيله.
export function consentToDeduction(db,supplied,requestId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','consent','confirmed_amount']);
  const r=extraRecord(db,u,requestId);v.version(input.version,r.version);
  if(r.employee_id!==u.id)fail(404,'not_found','الطلب غير متاح');
  if(r.status!=='pending_employee')fail(409,'action_unavailable','الطلب ليس بانتظار تأكيدك');
  if(input.consent!==true)fail(400,'consent_required','الخصم من الأجر لا يجوز بغير موافقتك الكتابية (م51). أقر بالموافقة داخل النموذج لمتابعة الطلب');
  if(input.confirmed_amount!==undefined&&input.confirmed_amount!==''&&amountMinor(input.confirmed_amount,'المبلغ المؤكد')!==r.amount_minor)
    fail(409,'amount_changed','المبلغ المعروض تغيّر. أعد تحميل الطلب وأقر بالمبلغ الظاهر فيه');
  const text=`${CONSENT_TEXT} المبلغ: ${money(r.amount_minor)}. الطريقة: ${r.payment_mode==='instalments'?`${r.instalment_months} قسطًا شهريًا`:'خصم واحد'}.`;
  const time=now();
  db.prepare("UPDATE benefit_extra_requests SET status='pending_authority',consent_text=?,consent_at=?,consent_by=?,version=version+1,updated_at=? WHERE id=?")
    .run(text,time,u.id,time,r.id);
  audit(db,u,'benefit_extra_request',r.id,'benefit_extra.consented',{status:r.status},{status:'pending_authority',amount_minor:r.amount_minor});
  return {id:r.id,status:'pending_authority',consent_text:text};
}
// صاحب الصلاحية: بعد موافقته يُضاف الوالدان إلى الوثيقة (فعل بشري لدى شركة التأمين) ويُنشأ جدول أقساط مقترحة في الرواتب.
export function authorityApproveParents(db,supplied,requestId,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.authority)fail(403,'not_permitted','اعتماد تأمين الوالدين لصاحب الصلاحية');
  v.object(input,['version','first_month','added_on','note']);
  const r=extraRecord(db,u,requestId);v.version(input.version,r.version);
  if(r.kind!=='parents_insurance')fail(409,'action_unavailable','هذا الإجراء لطلب تأمين الوالدين');
  if(r.employee_id===u.id)fail(409,'separation_of_duties','لا يعتمد صاحب الطلب طلبه');
  if(r.hr_by===u.id)fail(409,'separation_of_duties','من تحقق في الموارد البشرية لا يعتمد؛ يعتمده شخص آخر');
  if(r.status!=='pending_authority')fail(409,'action_unavailable','الطلب ليس بانتظار صاحب الصلاحية');
  if(typeof input.first_month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.first_month))fail(400,'first_month','شهر أول قسط بصيغة 2026-10');
  const added=v.date(input.added_on),time=now(),note=input.note===undefined||input.note===''?'':v.text(input.note,'أساس الاعتماد',1000,0);
  const count=r.payment_mode==='instalments'?r.instalment_months:1;
  const each=Math.floor(r.amount_minor/count),remainder=r.amount_minor-each*count;
  const schedule=[];
  for(let i=1;i<=count;i++){
    const amount=each+(i===count?remainder:0);
    if(amount<=0)continue;
    const month=addMonth(input.first_month,i-1),instalmentId=id();
    db.prepare("INSERT INTO benefit_extra_instalments(id,tenant_id,request_id,seq,month,amount_minor,status,created_at) VALUES(?,?,?,?,?,?,'proposed',?)")
      .run(instalmentId,u.tenant_id,r.id,i,month,amount,time);
    schedule.push({seq:i,month,amount_minor:amount});
  }
  const outcome={added_on:added,instalments:schedule,
    note:'الأقساط خصوم «مقترحة» في حركات الرواتب؛ لم يُخصم شيء. إضافة الوالدين لدى شركة التأمين فعل بشري خارج المنصة.'};
  db.prepare("UPDATE benefit_extra_requests SET status='completed',authority_by=?,authority_at=?,authority_note=?,outcome=?,version=version+1,updated_at=? WHERE id=?")
    .run(u.id,time,note,JSON.stringify(outcome),time,r.id);
  audit(db,u,'benefit_extra_request',r.id,'benefit_extra.authority_approved',{status:r.status},{status:'completed',instalments:schedule.length},note);
  return {id:r.id,status:'completed',instalments:schedule};
}

// 8/ب) دراسة الأبناء: طفلان كحد أقصى، فاتورة ضريبية غير مكررة وإثبات قيد، والصرف في نهاية الشهر الميلادي مع المسير.
export function submitEducationClaim(db,supplied,input){
  writing(db);const u=actor(db,supplied),date=riyadhToday();
  v.object(input,['children','academic_year','note']);
  refuseIfStopped(db,u.tenant_id,'children_education');
  requireEligible(db,u.tenant_id,u.id,date);
  const gradeCode=requireGrade(db,u.tenant_id,u.id),settings=settingsOf(db,u.tenant_id);
  const cap=db.prepare('SELECT annual_cap_minor FROM education_grade_caps WHERE tenant_id=? AND grade_code=?').get(u.tenant_id,gradeCode);
  if(!cap||!settings.education_cap_basis)
    fail(409,'caps_not_set','مبالغ بدل دراسة الأبناء لكل درجة غير مقررة بعد: المصدر لا يذكرها، والجدول ينتظر أن تملأه الإدارة. لا يُقدَّم الطلب قبل ذلك');
  if(!Array.isArray(input.children)||!input.children.length)fail(400,'children','أضف ابنًا واحدًا على الأقل');
  if(input.children.length>settings.education_max_children)
    fail(400,'children_limit',`الميزة لطفلين كحد أقصى؛ أرسلت ${input.children.length}`);
  if(typeof input.academic_year!=='string'||!/^(\d{4})-(\d{4})$/.test(input.academic_year)||Number(input.academic_year.slice(5))!==Number(input.academic_year.slice(0,4))+1)
    fail(400,'academic_year','العام الدراسي بصيغة 2026-2027');
  const requestId=id(),year=date.slice(0,4),reference=nextReference(db,u.tenant_id,year),time=now();
  const details={academic_year:input.academic_year,cap_basis:settings.education_cap_basis,
    note:input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة',1000,0)};
  db.prepare(`INSERT INTO benefit_extra_requests(id,tenant_id,reference,employee_id,grade_code,kind,benefit_year,status,details,cap_minor,created_at,updated_at)
    VALUES(?,?,?,?,?,'children_education',?,'pending_hr',?,?,?,?)`)
    .run(requestId,u.tenant_id,reference,u.id,gradeCode,year,JSON.stringify(details),cap.annual_cap_minor,time,time);
  let claimed=0;
  input.children.forEach((child,index)=>{
    v.object(child,['child_name','birth_date','stage','school','enrolment_proof','invoice']);
    const invoice=storeInvoice(db,u,{requestId,kind:'children_education',invoice:child.invoice});
    claimed+=invoice.amount_minor;
    db.prepare('INSERT INTO benefit_extra_children(id,tenant_id,request_id,seq,child_name,birth_date,stage,school,enrolment_proof,invoice_id,claimed_minor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,requestId,index+1,v.text(child.child_name,'اسم الابن أو الابنة',160,3),v.date(child.birth_date),
        v.text(child.stage,'المرحلة الدراسية',60,3),v.text(child.school,'اسم المدرسة',160,2),
        v.text(child.enrolment_proof,'مرجع إثبات القيد',120,2),invoice.id,invoice.amount_minor,time);
  });
  const perChild=settings.education_cap_basis==='per_child';
  const total=perChild?cap.annual_cap_minor*input.children.length:cap.annual_cap_minor;
  const calculation={steps:[
    `الدرجة ${gradeCode} — ${GRADE_NAMES[gradeCode]}`,
    `السقف السنوي ${money(cap.annual_cap_minor)} ${perChild?'لكل طفل':'لكل موظف'}`,
    `عدد الأبناء في الطلب: ${input.children.length} (الحد ${settings.education_max_children})`,
    `السقف المتاح لهذا الطلب: ${money(total)}`,
    `مجموع الفواتير: ${money(claimed)}`,
    `المستحق المبدئي = الأقل من الاثنين = ${money(Math.min(claimed,total))}`,
    'الصرف في نهاية الشهر الميلادي مع مسير الرواتب بعد تأكيد المالية.'
  ],claimed_minor:claimed,cap_minor:total,amount_minor:Math.min(claimed,total)};
  db.prepare('UPDATE benefit_extra_requests SET calculation=?,cap_minor=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(calculation),total,time,requestId);
  audit(db,u,'benefit_extra_request',requestId,'benefit_extra.submitted',{},{kind:'children_education',reference,children:input.children.length});
  return {id:requestId,reference,calculation};
}

// 8/ج) الأندية الصحية والأجهزة الرياضية: طلب واحد في السنة الميلادية، والمصروف اشتراك نادٍ أو أجهزة رياضية فقط.
export function sportsBalance(db,tenantId,userId,year=riyadhToday().slice(0,4)){
  const gradeCode=gradeOf(db,tenantId,userId);
  const cap=gradeCode?sportsCapFor(db,tenantId,gradeCode):null;
  const used=db.prepare("SELECT reference,status,amount_minor FROM benefit_extra_requests WHERE tenant_id=? AND employee_id=? AND kind='sports' AND benefit_year=? AND status NOT IN ('rejected','withdrawn')").get(tenantId,userId,year);
  return {year,grade_code:gradeCode,cap_minor:cap,used,open:!used,
    warning:`لك طلب واحد فقط في سنة ${year}: ما إن تقدّمه حتى يُغلق رصيد السنة، ولو كان المبلغ أقل من السقف ${cap===null?'':`(${money(cap)})`}.`};
}
export function submitSportsClaim(db,supplied,input){
  writing(db);const u=actor(db,supplied),date=riyadhToday(),year=date.slice(0,4);
  v.object(input,['category','invoice','acknowledged_single_request','note']);
  refuseIfStopped(db,u.tenant_id,'sports');
  requireEligible(db,u.tenant_id,u.id,date);
  const gradeCode=requireGrade(db,u.tenant_id,u.id);
  if(!SPORTS_CATEGORIES.some(c=>c.key===input.category))fail(400,'category','المصروف المسموح: اشتراك نادٍ رياضي أو أجهزة رياضية فقط');
  const balance=sportsBalance(db,u.tenant_id,u.id,year);
  if(balance.used)fail(409,'yearly_limit',`لك طلب «الأندية الصحية والأجهزة الرياضية» في سنة ${year} (${balance.used.reference}). الرصيد مغلق حتى سنة ${Number(year)+1}`);
  if(input.acknowledged_single_request!==true)fail(400,'acknowledgement_required',balance.warning+' أقر بعلمك بذلك قبل التقديم');
  if(!input.invoice)fail(400,'invoice_required','الفاتورة الضريبية مطلوبة لهذه الميزة');
  const requestId=id(),reference=nextReference(db,u.tenant_id,year),time=now(),cap=balance.cap_minor;
  const details={category:input.category,category_name:SPORTS_CATEGORIES.find(c=>c.key===input.category).name,
    acknowledged_single_request:true,note:input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة',1000,0)};
  db.prepare(`INSERT INTO benefit_extra_requests(id,tenant_id,reference,employee_id,grade_code,kind,benefit_year,status,details,cap_minor,created_at,updated_at)
    VALUES(?,?,?,?,?,'sports',?,'pending_hr',?,?,?,?)`)
    .run(requestId,u.tenant_id,reference,u.id,gradeCode,year,JSON.stringify(details),cap,time,time);
  const invoice=storeInvoice(db,u,{requestId,kind:'sports',invoice:input.invoice});
  const amount=Math.min(invoice.amount_minor,cap);
  const calculation={steps:[
    `الدرجة ${gradeCode} — ${GRADE_NAMES[gradeCode]}`,
    `السقف السنوي: ${money(cap)} في السنة الميلادية ${year}`,
    `مبلغ الفاتورة (${details.category_name}): ${money(invoice.amount_minor)}`,
    `المستحق = الأقل من الاثنين = ${money(amount)}`,
    'طلب واحد في السنة: يُغلق الرصيد بعد هذا الطلب حتى السنة التالية.'
  ],claimed_minor:invoice.amount_minor,cap_minor:cap,amount_minor:amount};
  db.prepare('UPDATE benefit_extra_requests SET calculation=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(calculation),time,requestId);
  audit(db,u,'benefit_extra_request',requestId,'benefit_extra.submitted',{},{kind:'sports',reference});
  return {id:requestId,reference,calculation};
}

// 8/د) قرار الموارد البشرية على مطالبات الدراسة والرياضة، ثم تأكيد المالية بشهر الصرف.
export function hrDecideClaim(db,supplied,requestId,decision,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.benefits)fail(403,'not_permitted','قرار مطالبات المزايا لحامل تصريح المزايا');
  if(!['approve','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','amount','note']);
  const r=extraRecord(db,u,requestId);v.version(input.version,r.version);
  if(!['children_education','sports'].includes(r.kind))fail(409,'action_unavailable','هذا الإجراء لمطالبات الدراسة والرياضة');
  if(r.employee_id===u.id)fail(409,'separation_of_duties','لا يقرر مسؤول المزايا في طلبه هو');
  if(r.status!=='pending_hr')fail(409,'action_unavailable','الطلب ليس بانتظار الموارد البشرية');
  const time=now(),calculation=JSON.parse(r.calculation);
  if(decision==='reject'){
    const note=v.text(input.note,'سبب الرفض',1000,5);
    db.prepare("UPDATE benefit_extra_requests SET status='rejected',hr_by=?,hr_at=?,hr_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,time,r.id);
    audit(db,u,'benefit_extra_request',r.id,'benefit_extra.hr_rejected',{status:r.status},{status:'rejected'});
    return {id:r.id,status:'rejected'};
  }
  const proposed=input.amount===undefined||input.amount===''?calculation.amount_minor:amountMinor(input.amount,'المبلغ المعتمد');
  if(proposed>calculation.amount_minor)fail(400,'amount_over_cap',`المبلغ المعتمد لا يزيد على المحسوب ${money(calculation.amount_minor)} (الأقل من الفاتورة والسقف)`);
  const note=input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة القرار',1000,0);
  db.prepare("UPDATE benefit_extra_requests SET status='pending_finance',amount_minor=?,hr_by=?,hr_at=?,hr_note=?,version=version+1,updated_at=? WHERE id=?")
    .run(proposed,u.id,time,note,time,r.id);
  if(r.kind==='children_education'){
    const rows=db.prepare('SELECT id,claimed_minor FROM benefit_extra_children WHERE request_id=? ORDER BY seq').all(r.id);
    const totalClaimed=rows.reduce((n,x)=>n+x.claimed_minor,0)||1;
    for(const row of rows)db.prepare('UPDATE benefit_extra_children SET approved_minor=? WHERE id=?').run(Math.floor(proposed*row.claimed_minor/totalClaimed),row.id);
  }
  audit(db,u,'benefit_extra_request',r.id,'benefit_extra.hr_approved',{status:r.status},{status:'pending_finance',amount_minor:proposed});
  return {id:r.id,status:'pending_finance',amount_minor:proposed};
}
export function financeCompleteClaim(db,supplied,requestId,decision,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.finance)fail(403,'not_permitted','التأكيد المالي لحامل تصريح التأكيد المالي لمطالبات المزايا');
  if(!['approve','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','month','note']);
  const r=extraRecord(db,u,requestId);v.version(input.version,r.version);
  if(r.employee_id===u.id)fail(409,'separation_of_duties','لا يؤكد صاحب الطلب طلبه');
  if(r.status!=='pending_finance')fail(409,'action_unavailable','الطلب ليس بانتظار المالية');
  const time=now();
  if(decision==='reject'){
    const note=v.text(input.note,'سبب الرفض',1000,5);
    db.prepare("UPDATE benefit_extra_requests SET status='rejected',finance_by=?,finance_at=?,finance_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,time,r.id);
    audit(db,u,'benefit_extra_request',r.id,'benefit_extra.finance_rejected',{status:r.status},{status:'rejected'});
    return {id:r.id,status:'rejected'};
  }
  if(typeof input.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))fail(400,'month','شهر الصرف بصيغة 2026-10');
  const note=input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة التأكيد',1000,0);
  const outcome={reimbursement_month:input.month,paid_on_note:`الصرف مع مسير شهر ${input.month} في نهاية الشهر الميلادي (${monthEnd(input.month)}).`,
    amount_minor:r.amount_minor,note:'مبلغ مقترح للمسير؛ لم يُصرف بعد.'};
  db.prepare("UPDATE benefit_extra_requests SET status='completed',finance_by=?,finance_at=?,finance_note=?,reimbursement_month=?,outcome=?,version=version+1,updated_at=? WHERE id=?")
    .run(u.id,time,note,input.month,JSON.stringify(outcome),time,r.id);
  // سطر واحد في جدول المقترحات: المبلغ يُسلَّم إلى حركات الرواتب مقترحًا، والطلب نفسه لا يُعدَّل بعد اكتماله.
  db.prepare("INSERT INTO benefit_extra_instalments(id,tenant_id,request_id,seq,month,amount_minor,status,created_at) VALUES(?,?,?,1,?,?,'proposed',?)")
    .run(id(),u.tenant_id,r.id,input.month,r.amount_minor,time);
  audit(db,u,'benefit_extra_request',r.id,'benefit_extra.finance_confirmed',{status:r.status},{status:'completed',month:input.month});
  return {id:r.id,status:'completed',reimbursement_month:input.month,month_end:monthEnd(input.month)};
}
export function withdrawExtraRequest(db,supplied,requestId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version']);
  const r=extraRecord(db,u,requestId);v.version(input.version,r.version);
  if(r.employee_id!==u.id)fail(404,'not_found','الطلب غير متاح');
  if(['completed','rejected','withdrawn'].includes(r.status))fail(409,'action_unavailable','لا يُسحب طلب صدر فيه قرار نهائي');
  db.prepare("UPDATE benefit_extra_requests SET status='withdrawn',version=version+1,updated_at=? WHERE id=?").run(now(),r.id);
  audit(db,u,'benefit_extra_request',r.id,'benefit_extra.withdrawn',{status:r.status},{status:'withdrawn'});
  return {id:r.id,status:'withdrawn'};
}
// تسليم مبلغ مطالبة أو قسط إلى حركات الرواتب: حركة «مقترحة» يعتمدها معتمد الرواتب هناك. لا صرف ولا خصم هنا.
export function handExtraToPayroll(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.payroll)fail(403,'not_permitted','التسليم إلى حركات الرواتب لمُعد الرواتب');
  v.object(input,['request_id','instalment_seq','month']);
  const r=extraRecord(db,u,input.request_id);
  if(r.status!=='completed')fail(409,'action_unavailable','لا يُسلَّم إلى الرواتب إلا طلب مكتمل');
  if(r.employee_id===u.id)fail(409,'separation_of_duties','لا يسلّم مُعد الرواتب مبلغ طلبه هو');
  const seq=input.instalment_seq===undefined?1:input.instalment_seq;
  const row=db.prepare('SELECT * FROM benefit_extra_instalments WHERE request_id=? AND seq=?').get(r.id,seq);
  if(!row)fail(404,'not_found','القسط أو المبلغ المقترح غير متاح');
  if(row.status!=='proposed')fail(409,'action_unavailable','هذا المبلغ سُلّم إلى حركات الرواتب أو أُلغي');
  const parents=r.kind==='parents_insurance',kindName=EXTRA_KINDS.find(k=>k.key===r.kind).name;
  // م51: موافقة الموظف الخطية على الخصم مسجلة في طلبه بهويته ووقتها ونصها (consentToDeduction)؛ تُنقل إلى سند الحركة كما هي فلا تُطلب مرتين.
  const adjustment=proposeAdjustment(db,u,{user_id:r.employee_id,kind:parents?'deduction':'allowance',month:input.month??row.month,
    amount:minorToAmount(row.amount_minor),
    reason:parents?`نصيب الموظف في ${kindName} — قسط ${row.seq} من طلب المزايا ${r.reference} بموافقة كتابية مسجلة (م51)`
      :`${kindName} — طلب المزايا ${r.reference} بعد تأكيد المالية`},
    parents?{basis:{kind:'consent',reference:`طلب المزايا ${r.reference}`,consent_text:r.consent_text,consent_by:r.consent_by,consent_at:r.consent_at}}:{});
  db.prepare("UPDATE benefit_extra_instalments SET status='handed_to_payroll',payroll_adjustment_id=? WHERE id=?").run(adjustment.id,row.id);
  audit(db,u,'benefit_extra_instalment',row.id,'benefit_extra_instalment.handed',{status:'proposed'},{status:'handed_to_payroll',payroll_adjustment_id:adjustment.id});
  return {id:row.id,request_id:r.id,payroll_adjustment_id:adjustment.id};
}

// ————— 9) لوحة المزايا الثلاث —————

function extraView(db,u,r,{forAdmin=false}={}){
  const own=r.employee_id===u.id,actions=[];
  if(own&&!['completed','rejected','withdrawn'].includes(r.status))actions.push('withdraw_request');
  if(own&&r.status==='pending_employee')actions.push('consent_deduction');
  if(forAdmin&&!own&&u.caps.benefits&&r.status==='pending_hr')actions.push(r.kind==='parents_insurance'?'hr_quote':'hr_approve','hr_reject');
  if(forAdmin&&!own&&u.caps.authority&&r.status==='pending_authority'&&r.hr_by!==u.id)actions.push('authority_approve');
  if(forAdmin&&!own&&u.caps.finance&&r.status==='pending_finance')actions.push('finance_approve','finance_reject');
  if(forAdmin&&!own&&u.caps.payroll&&r.status==='completed')actions.push('hand_to_payroll');
  const family=own||u.caps.benefits;
  return {id:r.id,reference:r.reference,kind:r.kind,kind_name:EXTRA_KINDS.find(k=>k.key===r.kind).name,employee_id:r.employee_id,
    employee_name:personName(db,r.employee_id),grade_code:r.grade_code,grade_name:GRADE_NAMES[r.grade_code],benefit_year:r.benefit_year,
    status:r.status,status_name:EXTRA_STATUS[r.status],details:JSON.parse(r.details),calculation:JSON.parse(r.calculation),
    policy_value_minor:r.policy_value_minor,cap_minor:r.cap_minor,amount_minor:r.amount_minor,payment_mode:r.payment_mode,instalment_months:r.instalment_months,
    consent_text:r.consent_text,consent_at:r.consent_at,consent_by_name:personName(db,r.consent_by),
    hr_by_name:personName(db,r.hr_by),hr_at:r.hr_at,hr_note:r.hr_note,authority_by_name:personName(db,r.authority_by),authority_at:r.authority_at,authority_note:r.authority_note,
    finance_by_name:personName(db,r.finance_by),finance_at:r.finance_at,finance_note:r.finance_note,reimbursement_month:r.reimbursement_month,
    outcome:JSON.parse(r.outcome),version:r.version,created_at:r.created_at,
    // بيانات الأسرة لصاحب الطلب وفريق المزايا فقط؛ المالية ترى المبلغ والمرجع والحساب.
    parents:family&&r.kind==='parents_insurance'?db.prepare('SELECT seq,relation,parent_name,birth_date FROM benefit_extra_parents WHERE request_id=? ORDER BY seq').all(r.id):undefined,
    children:family&&r.kind==='children_education'?db.prepare('SELECT seq,child_name,stage,school,claimed_minor,approved_minor FROM benefit_extra_children WHERE request_id=? ORDER BY seq').all(r.id):undefined,
    invoices:db.prepare('SELECT invoice_number,supplier_name,invoice_date,amount_minor FROM benefit_extra_invoices WHERE request_id=? ORDER BY created_at').all(r.id),
    instalments:db.prepare('SELECT seq,month,amount_minor,status,payroll_adjustment_id FROM benefit_extra_instalments WHERE request_id=? ORDER BY seq').all(r.id),
    actions};
}
export function benefitExtrasBoard(db,supplied,employeeId){
  const u=actor(db,supplied),date=riyadhToday(),year=date.slice(0,4);
  const subject=employeeId&&employeeId!==u.id?(u.caps.benefits?employeeId:fail(404,'not_found','مزايا هذا الموظف غير متاحة')):u.id;
  const settings=settingsOf(db,u.tenant_id);
  const eligibility=sharedEligibility(db,u.tenant_id,subject,date);
  const gradeCode=gradeOf(db,u.tenant_id,subject);
  const education=gradeCode?db.prepare('SELECT annual_cap_minor FROM education_grade_caps WHERE tenant_id=? AND grade_code=?').get(u.tenant_id,gradeCode):null;
  const admin=u.caps.benefits||u.caps.finance||u.caps.authority||u.caps.payroll||u.caps.accept;
  const mine=db.prepare('SELECT * FROM benefit_extra_requests WHERE tenant_id=? AND employee_id=? ORDER BY created_at DESC').all(u.tenant_id,subject).map(r=>extraView(db,u,r));
  const queue=admin?db.prepare('SELECT * FROM benefit_extra_requests WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200').all(u.tenant_id)
    .filter(r=>u.caps.benefits||u.caps.accept||(u.caps.finance&&['pending_finance','completed'].includes(r.status))||(u.caps.authority&&r.status==='pending_authority')||(u.caps.payroll&&r.status==='completed'))
    .map(r=>extraView(db,u,r,{forAdmin:true})):[];
  const sports=sportsBalance(db,u.tenant_id,subject,year);
  return {today:date,user_id:u.id,subject_id:subject,permissions:u.caps,kinds:EXTRA_KINDS,status_names:EXTRA_STATUS,
    sports_categories:SPORTS_CATEGORIES,consent_text:CONSENT_TEXT,grade:gradeCode?{code:gradeCode,name:GRADE_NAMES[gradeCode]}:null,
    eligibility,settings:{min_appraisal_percent:settings.min_appraisal_bp/100,parents_share_percent:settings.parents_share_bp/100,
      parents_cap_minor:settings.parents_cap_minor,parents_max_instalments:settings.parents_max_instalments,
      parents_year_basis:settings.parents_year_basis,education_cap_basis:settings.education_cap_basis,education_max_children:settings.education_max_children},
    availability:stoppedOver(db,u.tenant_id,{
      parents_insurance:eligibility.ok&&gradeCode?{available:true}:{available:false,reason:gradeCode?eligibility.text:'درجتك الوظيفية غير مسجلة بعد'},
      children_education:!education||!settings.education_cap_basis
        ?{available:false,reason:'مبالغ بدل دراسة الأبناء لكل درجة غير مقررة بعد؛ الجدول ينتظر أن تملأه الإدارة.'}
        :eligibility.ok?{available:true,cap_minor:education.annual_cap_minor,max_children:settings.education_max_children}:{available:false,reason:eligibility.text},
      sports:!eligibility.ok?{available:false,reason:eligibility.text}
        :!gradeCode?{available:false,reason:'درجتك الوظيفية غير مسجلة بعد'}
        :sports.used?{available:false,reason:`لك طلب في سنة ${year} (${sports.used.reference}); الرصيد مغلق حتى السنة التالية.`,cap_minor:sports.cap_minor}
        :{available:true,cap_minor:sports.cap_minor,warning:sports.warning}}),
    switched_off_count:hiddenExtras(db,u.tenant_id).size,
    caps:{education:educationCaps(db,u.tenant_id),sports:sportsCaps(db,u.tenant_id)},
    requests:mine,queue,open_decisions:openDecisions(db,u.tenant_id),
    note:'المزايا الثلاث مسودات في كتالوج المزايا حتى يعتمدها مدير الموارد البشرية، وكل مبلغ هنا محسوب أو مقترح: لا تُصرف المنصة ولا تخصم. الخصم من الأجر لا يمضي بغير إقرار مكتوب من الموظف (م51).'};
}
