import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { holds } from './access.mjs';
import { acceptedRule, riyadhToday } from './payroll-rules.mjs';
import { halfUp } from './hr-rule-basis.mjs';
import { normaliseDigits } from './pii.mjs';

// خصم التأمينات الاجتماعية بحسب حالة كل موظف (طلب المالك: «خذه من النظام بالضبط وطبق الخصم حسب كل حالة مذكورة»).
//
// ثلاث حالات لا غير بقرار المالك: سعودي خاضع للنظام السابق، وسعودي مشترك جديد، وغير سعودي. مواطنو دول مجلس التعاون
// مستثنون بقراره، ولا يُعاملون معاملة السعودي ولا غير السعودي بصمت: من سجلت له الموارد البشرية استثناء «مواطن خليجي»
// يمتنع اعتماد مسيره حتى يُقرَّر أمره، كأي موظف بلا حالة. وحقل الجنسية قيمتان لا غير، فسكوت الملف عن الخليج ليس جوابًا:
// كل غير سعودي يلزمه جواب مسجَّل («نعم» أو «لا») وإلا امتنع اعتماد مسيره — لا يُفترض أنه ليس خليجيًا لأن أحدًا لم يسأل.
//
// الحالة لا يكتبها أحد: تُشتق من الجنسية (employee_demographics) وتاريخ المباشرة، فلا نسخة ثانية لأيٍّ منهما.
// وتاريخ المباشرة يُقرأ بترتيب المنصة نفسه: السجل الوظيفي (employee_profiles.join_date) أولًا وبداية أقدم عقد بديلًا،
// وإن تعارضا على طرفي حدّ النظام الجديد لم يُرجَّح أحدهما بل سُمّي التعارض وامتنع الاعتماد.
// ما ينقص منهما يجعل السطر «غير متاح» ويمنع الاعتماد، ولا يُخمَّن ولا يُفترض له جنسية.
//
// الاستثناء الوحيد الذي لا تغطيه قاعدة المالك ويوجبه النظام: سعودي التحق بالشركة بعد 3 يوليو 2024 وله مدة اشتراك
// عند صاحب عمل سابق ليس مشتركًا جديدًا نظامًا — جدول التدرج لمن لا مدة اشتراك له. بلا الاستثناء يُخصم منه أكثر مما يجب.
//
// النسب معلمات سياسة مقبولة (kind='social_insurance' في regulation_policies)، لا ثوابت في هذا الملف.
// لا شيء يسري قبل قبول مدير الموارد البشرية، والمسير يقول ذلك صراحة بدل أن يخصم بنسبة قديمة بصمت.

export const CASE_NAMES={saudi_previous_law:'سعودي خاضع للنظام السابق',saudi_new_entrant:'سعودي مشترك جديد',non_saudi:'غير سعودي'};
export const OVERRIDE_KINDS=[['prior_contribution_period','له مدة اشتراك سابقة'],['gcc_national','مواطن خليجي — خارج جدول الخصم بقرار المالك'],
  ['not_gcc_national','ليس مواطنًا خليجيًا — جواب مسجَّل']].map(([key,name])=>({key,name}));
// سؤالا الخليج: أحدهما يوقف المسير والآخر يطلقه، وكلاهما جواب مسجَّل لا سكوت. لا يُعرضان إلا على غير السعودي.
const GCC_KINDS=['gcc_national','not_gcc_national'];
const OVERRIDE_NAMES=Object.fromEntries(OVERRIDE_KINDS.map(k=>[k.key,k.name]));
export const PARTIAL_MONTH_BASIS=[['thirty','أيام الخدمة ÷ 30 يومًا'],['calendar','أيام الخدمة ÷ أيام الشهر الفعلية']];
const id=()=>randomUUID();
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

// ————— السياسة المقبولة —————

// قاعدة التأمينات السارية في تاريخ بعينه. المسير يقرؤها بآخر يوم من الشهر المحتسب، لا بتاريخ اليوم.
export const insuranceRule=(db,tenantId,date)=>acceptedRule(db,tenantId,'social_insurance',date);

// درجة النسبة السارية في التاريخ لحالة بعينها: الصف الأحدث الذي بدأ سريانه قبل التاريخ أو فيه.
// درجات المشترك الجديد تصعد في 1 يوليو من كل سنة وتُطبَّق بالتاريخ على كل من في الفئة مهما كان تاريخ التحاقه.
export function rateFor(parameters,caseKey,date){
  const row=parameters.cases?.[caseKey];
  if(!row)return null;
  const step=[...row.schedule].filter(s=>s.from<=date).sort((a,b)=>b.from.localeCompare(a.from))[0];
  return step?{case_key:caseKey,case_name:row.name??CASE_NAMES[caseKey]??caseKey,floor_key:row.floor,article:row.article,source_url:step.source_url??row.source_url,
    from:step.from,employee_bp:step.employee_bp,employer_bp:step.employer_bp,note:step.note??''}:null;
}

// ————— اشتقاق الحالة —————

const OVERRIDE_SQL="SELECT * FROM employee_insurance_overrides WHERE tenant_id=? AND user_id=? AND withdrawn_by IS NULL AND effective_from<=? ORDER BY effective_from DESC,created_at DESC";
export const liveOverrides=(db,tenantId,userId,date)=>db.prepare(OVERRIDE_SQL).all(tenantId,userId,date);
// تاريخ المباشرة كما تقرؤه المنصة كلها: تاريخ الالتحاق في السجل الوظيفي أولًا (موضعه المقرر، ولا نسخة ثانية منه)،
// وبداية أقدم عقد سارٍ أو منتهٍ بديلًا عنه حين لا سجل وظيفي — الترتيب نفسه في benefits-portal.mjs وletters.mjs وملف الموظف.
// شركة تبنّت المنصة في 2025 تُدخل لكل موظف تاريخ التحاقه الحقيقي وعقده الجاري وحده، فقراءة العقد وحده
// تجعل كل سعودي التحق قبل 3 يوليو 2024 «مشتركًا جديدًا» ويُخصم منه أكثر مما يجب.
export function commencementDate(db,tenantId,userId){
  const join=db.prepare('SELECT join_date FROM employee_profiles WHERE user_id=? AND tenant_id=?').get(userId,tenantId)?.join_date??null;
  const first=db.prepare("SELECT MIN(start_date) AS d FROM employment_contracts WHERE tenant_id=? AND user_id=? AND status IN ('active','ended')").get(tenantId,userId)?.d??null;
  return {date:join??first,source:join?'profile':first?'contract':null,join_date:join,contract_start:first};
}
// السن عند تاريخ بعينه بالسنوات الكاملة.
const yearsAt=(birth,date)=>{const [y1,m1,d1]=birth.split('-').map(Number),[y2,m2,d2]=date.split('-').map(Number);
  return y2-y1-(m2<m1||(m2===m1&&d2<d1)?1:0);};

// من يملك الحقل الناقص ومن يُكمله: الرفض يسمّيه بدل أن يقول «بيانات ناقصة».
const MISSING_NATIONALITY={field:'nationality_group',document:'الجنسية في ملف الموظف (سعودي / غير سعودي)',owner:'الموارد البشرية',owner_role:'hr',
  why:'حالة التأمينات تُشتق من الجنسية وتاريخ المباشرة، ولا تُخمَّن'};
const MISSING_START={field:'start_date',document:'تاريخ المباشرة: تاريخ الالتحاق في السجل الوظيفي، أو بداية عقد معتمد إن لم يكن له سجل',owner:'الموارد البشرية',owner_role:'hr',
  why:'تاريخ المباشرة هو ما يفصل المشترك الجديد عن الخاضع للنظام السابق'};
// غير السعودي بلا جواب: لا يُفترض أنه ليس خليجيًا لمجرد أن أحدًا لم يسأل.
const MISSING_GCC_ANSWER={field:'gcc_answer',document:'جواب صريح عن «هل هو مواطن خليجي؟» — يُسجَّل حين تُسجَّل جنسيته أو من شاشة «حالات التأمينات»',owner:'الموارد البشرية',owner_role:'hr',
  why:'حقل الجنسية قيمتان لا غير، فالخليجي لا يتميز عن أي غير سعودي بغير جواب مسجَّل، وهو خارج جدول الخصم بقرار المالك'};
const startConflict=(join,contract)=>({field:'start_date',document:`حسم مدة الاشتراك الأولى: تاريخ المباشرة في السجل الوظيفي ${join} وبداية أقدم عقد ${contract}، والتاريخان على طرفي بداية النظام الجديد. سجّل استثناء «له مدة اشتراك سابقة» بوثيقته إن كان مشتركًا قبلها، أو صحّح تاريخ المباشرة في السجل الوظيفي`,
  owner:'الموارد البشرية',owner_role:'hr',why:'التاريخان يعطيان حالتين مختلفتين ونسبتين مختلفتين، فلا يُختار أحدهما بالقرعة'});
const ageCase=(age,threshold,caseName)=>({field:'age_case',document:`قرار مكتوب في شأن من بدأت تغطيته في سن ${age} سنة: حدُّ حالة «${caseName}» المسجَّل في القاعدة المقبولة ${threshold} سنة`,
  owner:'مدير الموارد البشرية',owner_role:'hr',why:'فرع المعاشات قد لا ينطبق على من بدأت تغطيته بعد هذه السن، فلا تُطبَّق عليه نسبة الجدول بصمت'});

// حالة موظف واحد كما تُقرأ في تاريخ بعينه: مشتقة من ملف الموظف، ويصححها استثناء مسجَّل إن وُجد.
export function caseOf(db,tenantId,userId,date=riyadhToday(),parameters=null){
  const overrides=liveOverrides(db,tenantId,userId,date),of=row=>({kind:row.kind,kind_name:OVERRIDE_NAMES[row.kind],effective_from:row.effective_from,basis:row.basis,recorded_by_name:personName(db,row.recorded_by)});
  const gcc=overrides.find(o=>o.kind==='gcc_national');
  if(gcc)return {case_key:null,missing:[],needs:[],nationality:null,blocked:'gcc_national',
    note:'مواطن خليجي: خارج جدول الخصم بقرار المالك، فلا حالة تنطبق عليه ولا يُعامل معاملة السعودي ولا غير السعودي.',override:of(gcc)};
  const nationality=db.prepare('SELECT nationality_group FROM employee_demographics WHERE user_id=? AND tenant_id=?').get(userId,tenantId)?.nationality_group??null;
  const commencement=commencementDate(db,tenantId,userId),start=commencement.date;
  const missing=[...(nationality?[]:[MISSING_NATIONALITY]),...(start?[]:[MISSING_START])];
  if(missing.length)return {case_key:null,missing,needs:[],nationality,blocked:'missing_fields',note:'',override:null};
  const derivedFrom={nationality_group:nationality,start_date:start,join_source:commencement.source};
  if(nationality==='non_saudi')return {case_key:'non_saudi',missing:[],nationality,blocked:null,note:'',override:null,derived_from:derivedFrom,
    needs:overrides.some(o=>o.kind==='not_gcc_national')?[]:[MISSING_GCC_ANSWER]};
  const prior=overrides.find(o=>o.kind==='prior_contribution_period');
  const boundary=parameters?.new_law_effective_from??null;
  if(!boundary)return {case_key:null,missing:[],needs:[],nationality,blocked:'no_rule',note:'',override:null};
  // تاريخان مسجلان يقعان على طرفي حدّ النظام الجديد: لا يُرجَّح أحدهما هنا؛ يُسمَّى التعارض ويُحسم في الملف.
  // والاستثناء المسجَّل يحسمه أصلًا (كلا التاريخين يصير معه النظام السابق)، فلا يُسأل عما أُجيب عنه بوثيقة.
  if(!prior&&commencement.join_date&&commencement.contract_start&&(commencement.join_date<boundary)!==(commencement.contract_start<boundary))
    return {case_key:null,missing:[startConflict(commencement.join_date,commencement.contract_start)],needs:[],nationality,blocked:'start_date_conflict',
      note:`تاريخ المباشرة في السجل الوظيفي ${commencement.join_date} وبداية أقدم عقد ${commencement.contract_start}، وهما على طرفي ${boundary}.`,override:null};
  const derived=start<boundary?'saudi_previous_law':'saudi_new_entrant';
  // الاستثناء ينقل من جدول التدرج إلى النظام السابق، ولا يعمل في الاتجاه الآخر: من باشر قبل التاريخ خاضع للسابق أصلًا.
  const key=prior?'saudi_previous_law':derived;
  // السن عند أول تغطية: لا تُطبَّق إلا بحدٍّ مسجَّل في القاعدة المقبولة (سؤال مفتوح ما لم يُحقَّق)، ومع تاريخ ميلاد مسجَّل.
  const birth=db.prepare('SELECT birth_date FROM employee_personal WHERE user_id=? AND tenant_id=?').get(userId,tenantId)?.birth_date??null;
  const age=birth?yearsAt(birth,start):null,threshold=parameters?.age_thresholds?.[key]??null;
  if(threshold!==null&&age!==null&&age>=threshold)
    return {case_key:null,missing:[ageCase(age,threshold,CASE_NAMES[key]??key)],needs:[],nationality,blocked:'age_case',
      note:`بدأت تغطيته في سن ${age} سنة، وحدُّ حالته في القاعدة المقبولة ${threshold} سنة.`,override:prior?of(prior):null};
  return {case_key:key,missing:[],needs:[],nationality,blocked:null,derived_from:{...derivedFrom,boundary,...(age===null?{}:{age_at_commencement:age})},
    note:prior?'نُقل إلى النظام السابق باستثناء مسجَّل: له مدة اشتراك سابقة عند صاحب عمل آخر.':'',override:prior?of(prior):null};
}

// ————— الاحتساب —————

// الأجر الخاضع: بنود العقد الشهرية الكاملة الداخلة في الأساس المقرر في القاعدة، محصورة بين الحد الأدنى والحد الأعلى.
export function contributoryWage(parameters,rate,payLines){
  const components=parameters.wage_components??[];
  const raw=payLines.filter(l=>components.includes(l.component)).reduce((n,l)=>n+l.amount_minor,0);
  const floor=parameters.floors_minor?.[rate.floor_key]??0,ceiling=parameters.max_wage_minor;
  const wage=Math.min(ceiling,Math.max(floor,raw));
  return {raw_minor:raw,wage_minor:wage,floor_minor:floor,ceiling_minor:ceiling,clamped:raw<floor?'floor':raw>ceiling?'ceiling':null};
}

// نسبة الشهر لمن لم يعمل الشهر كله: النظام يقول «على أساس عدد أيام الخدمة» ولا يقول المقسوم،
// فالمقسوم اختيار يحسمه مدير الموارد البشرية عند قبول القاعدة (partial_month_basis) ولا يُخترع هنا.
export function monthFraction(parameters,serviceDays,monthDays){
  if(serviceDays>=monthDays)return {fraction_bp:10000,basis:'full_month',divisor:monthDays};
  const basis=parameters.partial_month_basis,divisor=basis==='thirty'?30:monthDays;
  return {fraction_bp:Math.min(10000,halfUp(serviceDays*10000,divisor)),basis:basis??'calendar',divisor};
}

// سطر واحد: كم يُخصم من الموظف وكم تتحمل المنشأة، وكل رقم بمصدره في basis حتى يُفسَّر كل ريال دون الرجوع للكود.
// parts: جزء لكل عقد حكم جزءًا من الشهر، ببنوده وأيام خدمته. من عُدِّل عقده في منتصف الشهر يُحتسب اشتراكه
// على كل جزء بأجره وأيامه ثم يُجمع الجزءان — لا على أجر العقد الأحدث شهرًا كاملًا.
export function computeFor(db,tenantId,userId,{range,rule,parts,capMinor}){
  const parameters=rule.parameters,state=caseOf(db,tenantId,userId,range.to,parameters);
  const common={policy_id:rule.id,effective_from:rule.effective_from,wage_components:parameters.wage_components,
    override:state.override,missing:state.missing.map(m=>({document:m.document,owner:m.owner,owner_role:m.owner_role,why:m.why}))};
  if(!state.case_key)return {employee_minor:0,employer_minor:0,
    basis:{method:'unavailable',case:null,case_name:null,blocked:state.blocked,note:state.note,...common,
      rule:'لا حالة تأمينات لهذا الموظف، فلا يُخصم منه شيء ولا يُحتسب على المنشأة شيء، ولا يُعتمد المسير قبل حسم حالته.'}};
  const rate=rateFor(parameters,state.case_key,range.to);
  if(!rate)return {employee_minor:0,employer_minor:0,
    basis:{method:'unavailable',case:state.case_key,case_name:CASE_NAMES[state.case_key]??state.case_key,blocked:'no_rate',note:state.note,...common,
      rule:`لا نسبة سارية لحالة «${CASE_NAMES[state.case_key]??state.case_key}» في ${range.to} داخل القاعدة المقبولة.`}};
  const computed=parts.map(p=>{
    const wage=contributoryWage(parameters,rate,p.pay_lines),month=monthFraction(parameters,p.service_days,range.days);
    const scale=minor=>month.fraction_bp===10000?minor:halfUp(minor*month.fraction_bp,10000);
    return {wage,month,service_days:p.service_days,
      employee_minor:scale(halfUp(wage.wage_minor*rate.employee_bp,10000)),employer_minor:scale(halfUp(wage.wage_minor*rate.employer_bp,10000))};
  });
  const one=computed.length===1?computed[0]:null;
  const employeeFull=computed.reduce((n,c)=>n+c.employee_minor,0),employer=computed.reduce((n,c)=>n+c.employer_minor,0);
  const serviceDays=computed.reduce((n,c)=>n+c.service_days,0);
  // حصة الموظف لا تتجاوز ما يُصرف له فعلًا في الشهر؛ حصة المنشأة تكلفة عليها فلا يحدّها أجره.
  const employee=capMinor===null?employeeFull:Math.min(capMinor,employeeFull);
  const capped=employee<employeeFull;
  const wageSentence=one?`الأجر الخاضع (${one.wage.wage_minor/100} ريال)`
    :`جزأي الشهر (${computed.map(c=>`${c.wage.wage_minor/100} ريال عن ${c.service_days} يومًا`).join(' و')})`;
  const partSentence=one&&one.month.fraction_bp!==10000?`، بنسبة ${one.month.fraction_bp/100}% من الشهر عن ${serviceDays} يوم خدمة`:'';
  const capSentence=capped?` ثم حُصر المخصوم بما تبقى من أجره بعد الغياب غير المدفوع (${employee/100} ريال)، والفرق ${(employeeFull-employee)/100} ريال يبقى على المنشأة للمؤسسة ولم يُخصم منه.`:'';
  return {employee_minor:employee,employer_minor:employer,
    basis:{method:'per_case',case:rate.case_key,case_name:rate.case_name,blocked:null,note:state.note,
      derived_from:state.derived_from??null,rate_from:rate.from,employee_bp:rate.employee_bp,employer_bp:rate.employer_bp,
      article:rate.article,source_url:rate.source_url,rate_note:rate.note,
      contributory_wage_minor:one?one.wage.wage_minor:computed.reduce((n,c)=>n+(c.month.fraction_bp===10000?c.wage.wage_minor:halfUp(c.wage.wage_minor*c.month.fraction_bp,10000)),0),
      contract_wage_minor:one?one.wage.raw_minor:computed.reduce((n,c)=>n+c.wage.raw_minor,0),
      floor_minor:computed[0].wage.floor_minor,ceiling_minor:computed[0].wage.ceiling_minor,clamped:one?one.wage.clamped:computed.find(c=>c.wage.clamped)?.wage.clamped??null,
      service_days:serviceDays,month_days:range.days,partial_month_basis:computed[0].month.basis,fraction_bp:one?one.month.fraction_bp:10000,
      ...(one?{}:{parts:computed.map(c=>({contributory_wage_minor:c.wage.wage_minor,contract_wage_minor:c.wage.raw_minor,clamped:c.wage.clamped,
        service_days:c.service_days,fraction_bp:c.month.fraction_bp,employee_minor:c.employee_minor,employer_minor:c.employer_minor}))}),
      employee_minor:employee,employee_uncapped_minor:employeeFull,employer_minor:employer,...(capped?{capped_by_net:true,shortfall_minor:employeeFull-employee}:{}),...common,
      rule:`استقطاع التأمينات = ${wageSentence} × ${rate.employee_bp/100}% لحالة «${rate.case_name}» السارية من ${rate.from}${partSentence}.${capSentence} حصة المنشأة ${rate.employer_bp/100}% لا تُخصم من الموظف.`}};
}

// ————— بوابة الاعتماد —————

// آخر يوم من الشهر: التاريخ نفسه الذي يقرأ به المسير قاعدته، فلا تختلف البوابة عن الاحتساب في شهر تبدأ قاعدته في آخره.
const lastDayOf=month=>{const [y,m]=month.split('-').map(Number);return `${month}-${String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')}`;};
const NO_RATE={document:'نسبة سارية لحالته في قاعدة التأمينات المقبولة',owner:'مدير الموارد البشرية',owner_role:'hr',why:null};
const GCC_DECISION={document:'قرار مكتوب في شأن مواطني دول مجلس التعاون',owner:'مالك المنصة ومدير الموارد البشرية',owner_role:'hr',why:null};
const doc=m=>({document:m.document,owner:m.owner,owner_role:m.owner_role,why:m.why??null});

// فجوات التأمينات في مسير، محسوبةً من القاعدة السارية على الشهر وحالة كل موظف كما هي الآن — لا من سند السطر المخزَّن.
// سند السطر تاريخٌ لِما حُسب يوم حُسب؛ والبوابة تسأل سؤالًا آخر: هل ما حُسب هو ما يحكم هذا الشهر الآن؟
// بلا هذا السؤال كانت مسودة حُسبت قبل قبول القاعدة (أو قبل تسجيل استثناء) تمر إلى الاعتماد بأرقامها القديمة،
// والشاشة تقول إن الخصم بالحالة بينما السطور على النسبة الواحدة.
//   missing    — لا حالة له أصلًا (جنسية ناقصة، تاريخان متعارضان، خليجي، سن، أو لا نسبة لحالته)
//   unanswered — غير سعودي لم يُسأل عنه سؤال الخليج
//   stale      — له حالة، لكن السطر المخزَّن حُسب بغيرها أو بقاعدة أخرى: يلزمه إعادة احتساب لا تسجيل بيانات
export function insuranceGaps(db,tenantId,run){
  const date=lastDayOf(run.month),rule=insuranceRule(db,tenantId,date);
  if(!rule)return {missing:[],unanswered:[],stale:[]};
  const rows=db.prepare('SELECT l.user_id,l.basis,x.name FROM payroll_lines l JOIN users x ON x.id=l.user_id WHERE l.run_id=? ORDER BY x.name').all(run.id);
  const missing=[],unanswered=[],stale=[];
  for(const r of rows){
    const stored=JSON.parse(r.basis).insurance??null,person={user_id:r.user_id,name:r.name};
    const state=caseOf(db,tenantId,r.user_id,date,rule.parameters);
    if(!state.case_key){missing.push({...person,blocked:state.blocked,
      missing:state.missing.length?state.missing.map(doc):[{...(state.blocked==='gcc_national'?GCC_DECISION:NO_RATE),why:state.note||null}]});continue;}
    if(state.needs.length)unanswered.push({...person,blocked:'gcc_answer',missing:state.needs.map(doc)});
    const rate=rateFor(rule.parameters,state.case_key,date);
    if(!rate){missing.push({...person,blocked:'no_rate',missing:[{...NO_RATE,why:`لا درجة سارية لحالة «${CASE_NAMES[state.case_key]??state.case_key}» في ${date}`}]});continue;}
    if(stored?.method!=='per_case'||stored.case!==state.case_key||stored.policy_id!==rule.id)
      stale.push({...person,recorded:stored?.method==='per_case'?(stored.case_name??stored.case):stored?.method==='flat_policy'?'نسبة سياسة الدورة الواحدة':'غير متاح',now:rate.case_name});
  }
  return {missing,unanswered,stale};
}
// الرفض يسمّي من نقصت حالته وما نقص ومن يُكمله وأين — لا «الإجراء غير متاح».
export function assertCasesResolved(db,tenantId,run,gaps=null){
  const found=gaps??insuranceGaps(db,tenantId,run),blocked=[...found.missing,...found.unanswered];
  if(blocked.length)refuse(409,'insurance_case_required',{
    what:`لا يُعتمد مسير ${run.month}: ${blocked.length} موظف بلا حالة تأمينات محسومة، وسطورهم تعرض «غير متاح» لا صفرًا`,
    missing:blocked.flatMap(g=>g.missing.map(m=>({document:`${g.name} — ${m.document}`,why:m.why,owner:m.owner,owner_role:m.owner_role}))),
    next:'سجّل الناقص في ملف الموظف أو استثناءه في شاشة «حالات التأمينات»، ثم أعد احتساب المسودة',link:'#payroll-insurance'});
  if(found.stale.length)refuse(409,'insurance_recalculate_required',{
    what:`لا يُعتمد مسير ${run.month}: ${found.stale.length} سطر حُسب على غير القاعدة التي تحكم هذا الشهر الآن`,
    missing:found.stale.map(g=>({document:`${g.name} — السطر محسوب على «${g.recorded}» والقاعدة السارية تضعه في «${g.now}»`,
      why:'تغيّرت القاعدة أو حالة الموظف بعد احتساب المسودة، فالأرقام المخزَّنة ليست أرقام هذا الشهر',owner:'مُعد المسير',owner_role:'payroll'})),
    next:'أعد احتساب المسودة من زر «إعادة الاحتساب» ثم قدّمها',link:'#payroll'});
}

// ————— شاشة الموارد البشرية —————

const CAPS=['hr.workforce.view','payroll.prepare','payroll.review','payroll.approve'];
function actor(db,supplied){const u=actorOrRefuse(db,supplied);u.caps=CAPS.filter(key=>holds(db,u,key));return u;}
// الحالة تكشف الجنسية، فتُقرأ بقاعدة قراءة الجنسية نفسها: الموارد البشرية أو حامل تصريح رواتب. المدير المباشر لا يراها.
const sees=u=>u.caps.length>0;
// التسجيل: موظف موارد بشرية يحمل تصريح قراءة القوى العاملة أو إعداد المسير. لا يسجل أحد على نفسه.
const recorder=u=>u.role==='hr'&&(u.caps.includes('hr.workforce.view')||u.caps.includes('payroll.prepare'));
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة استثناءات التأمينات معاملة قاعدة بيانات');}

export function insuranceBoard(db,supplied){
  const u=actor(db,supplied),today=riyadhToday();
  if(!sees(u))refuse(403,'not_permitted',{what:'شاشة حالات التأمينات لا تُفتح بحسابك',
    missing:[{document:'تصريح قراءة بيانات القوى العاملة (hr.workforce.view) أو تصريح من تصاريح مسير الرواتب',why:'حالة التأمينات تكشف جنسية الموظف',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'اطلب التصريح من مسؤول المنصة، فالمدير المباشر لا يرى جنسية فريقه بحكم دوره'});
  const rule=insuranceRule(db,u.tenant_id,today),parameters=rule?.parameters??null;
  const people=db.prepare("SELECT u.id,u.name FROM users u WHERE u.tenant_id=? AND u.active=1 AND u.role<>'admin' ORDER BY u.name").all(u.tenant_id);
  const may=recorder(u);
  const rows=people.map(p=>{
    const state=caseOf(db,u.tenant_id,p.id,today,parameters),rate=state.case_key&&parameters?rateFor(parameters,state.case_key,today):null;
    const overrides=db.prepare('SELECT * FROM employee_insurance_overrides WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC').all(u.tenant_id,p.id)
      .map(o=>({id:o.id,kind:o.kind,kind_name:OVERRIDE_NAMES[o.kind],effective_from:o.effective_from,basis:o.basis,recorded_by_name:personName(db,o.recorded_by),
        withdrawn:!!o.withdrawn_by,withdrawn_by_name:personName(db,o.withdrawn_by),withdrawal_reason:o.withdrawal_reason,
        actions:may&&!o.withdrawn_by&&o.user_id!==u.id?['withdraw_override']:[]}));
    const live=new Set(overrides.filter(o=>!o.withdrawn).map(o=>o.kind));
    // سؤال الخليج لا يُعرض إلا على غير السعودي، ويختفي جوابه متى سُجِّل أحد الجوابين.
    const offered=OVERRIDE_KINDS.filter(k=>!live.has(k.key)&&(!GCC_KINDS.includes(k.key)||(state.nationality==='non_saudi'&&!GCC_KINDS.some(g=>live.has(g)))));
    return {user_id:p.id,name:p.name,case_key:state.case_key,case_name:state.case_key?(rate?.case_name??CASE_NAMES[state.case_key]):null,
      available:!!state.case_key,blocked:state.blocked,note:state.note,
      employee_bp:rate?.employee_bp??null,employer_bp:rate?.employer_bp??null,rate_from:rate?.from??null,
      derived_from:state.derived_from??null,missing:state.missing.map(m=>({document:m.document,owner:m.owner,why:m.why})),
      // ما ينقص ولا يمنع الاشتقاق لكنه يمنع الاعتماد: جواب الخليج لغير السعودي.
      needs:state.needs.map(m=>({document:m.document,owner:m.owner,why:m.why})),
      overrides,actions:may&&p.id!==u.id?offered.map(k=>`record_${k.key}`):[]};
  });
  return {today,user_id:u.id,permissions:u.caps,may_record:may,case_names:CASE_NAMES,override_kinds:OVERRIDE_KINDS,
    rule:rule?{id:rule.id,title:rule.title,effective_from:rule.effective_from,articles:rule.articles,source:rule.source,
      wage_components:parameters.wage_components,max_wage_minor:parameters.max_wage_minor,floors_minor:parameters.floors_minor,
      partial_month_basis:parameters.partial_month_basis,cases:parameters.cases,open_questions:parameters.open_questions??[]}:null,
    rows,unresolved:rows.filter(r=>!r.available).length,unanswered:rows.filter(r=>r.needs.length).length,
    gcc_note:'مواطنو دول مجلس التعاون خارج جدول الخصم بقرار المالك. حقل الجنسية في المنصة قيمتان لا غير، فالخليجي لا يتميز عن أي غير سعودي إلا بجواب مسجَّل. ولذلك يُسأل السؤال حيث تُسجَّل الجنسية: كل غير سعودي يلزمه جواب صريح — «نعم» يوقف مسيره حتى يُقرَّر أمره، و«لا» يُسجَّل جوابًا بسنده — ولا يُعتمد مسيره قبل الجواب.',
    note:rule?'النسب معلمات في قاعدة مقبولة من مدير الموارد البشرية، لا أرقام في الكود. الحالة تُشتق من الجنسية وتاريخ المباشرة ولا تُكتب بيد أحد.'
      :'قاعدة التأمينات مسودة مستخرجة لم يقبلها مدير الموارد البشرية بعد، فلا خصم بالحالة يسري. تُقبل من شاشة «قواعد اللائحة في الرواتب».'};
}

function target(db,u,userId){
  const person=typeof userId==='string'&&db.prepare("SELECT id,name FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(userId,u.tenant_id);
  if(!person)fail(404,'not_found','الموظف غير متاح في هذا الكيان أو حسابه موقوف');
  if(person.id===u.id)fail(409,'separation_of_duties','لا يسجل الموظف استثناء تأميناته بنفسه؛ يسجله موظف آخر في الموارد البشرية');
  return person;
}
function mayRecord(u){
  if(recorder(u))return;
  refuse(403,'not_permitted',{what:'تسجيل استثناء التأمينات خارج صلاحيتك',
    missing:[{document:'دور الموارد البشرية مع تصريح قراءة القوى العاملة (hr.workforce.view) أو إعداد المسير (payroll.prepare)',
      why:'الاستثناء يغيّر ما يُخصم من أجر إنسان',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'اطلب من الموارد البشرية تسجيله، أو اطلب التصريح من مسؤول المنصة'});
}

// استثناء مؤرخ بسند مكتوب، يسجله شخص واحد ولا يُعدَّل بعدها. الخطأ يُسحب بسبب مكتوب ويبقى في السجل.
export function recordOverride(db,supplied,userId,kind,input){
  writing(db);const u=actor(db,supplied);mayRecord(u);
  if(!OVERRIDE_KINDS.some(k=>k.key===kind))fail(404,'not_found','نوع الاستثناء غير معروف في هذه الشاشة');
  v.object(input,['effective_from','basis']);
  const person=target(db,u,userId),effective=v.date(input.effective_from);
  const basis=v.text(input.basis,'الوثيقة التي اطُّلع عليها وسند الاستثناء',500,10);
  // لا رقم هوية ولا رقم اشتراك: المنصة لا تخزّن ما يعرّف إنسانًا لدى الدولة، والسند نوع وثيقة لا رقمها.
  // الشاشة عربية من اليمين، فرقم الهوية يُكتب فيها بالأرقام العربية الهندية أو الفارسية كما يُكتب باللاتينية،
  // وقد يُفرَّق بمسافات أو نقاط أو شرطات. تُطبَّع الأرقام أولًا (app/pii.mjs) ثم يُفحص الستّ المتتالية.
  if(/\d{6,}/.test(normaliseDigits(basis).replace(/[\s.\-_/]/g,'')))fail(400,'reference_number','اكتب نوع الوثيقة وتاريخها دون رقم الهوية أو الإقامة أو رقم الاشتراك');
  if(db.prepare('SELECT 1 FROM employee_insurance_overrides WHERE tenant_id=? AND user_id=? AND kind=? AND withdrawn_by IS NULL').get(u.tenant_id,person.id,kind))
    fail(409,'override_exists',`لـ${person.name} استثناء قائم من هذا النوع. اسحبه بسبب مكتوب قبل تسجيل غيره`);
  const rowId=id(),time=now();
  db.prepare('INSERT INTO employee_insurance_overrides(id,tenant_id,user_id,kind,effective_from,basis,recorded_by,recorded_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(rowId,u.tenant_id,person.id,kind,effective,basis,u.id,time,time);
  audit(db,u,'employee_insurance_override',rowId,'insurance.override_recorded',{},{kind,effective_from:effective,user_id:person.id},basis);
  return {id:rowId};
}
export function withdrawOverride(db,supplied,overrideId,input){
  writing(db);const u=actor(db,supplied);mayRecord(u);
  v.object(input,['reason']);
  const row=typeof overrideId==='string'&&db.prepare('SELECT * FROM employee_insurance_overrides WHERE id=? AND tenant_id=? AND withdrawn_by IS NULL').get(overrideId,u.tenant_id);
  if(!row)fail(404,'not_found','الاستثناء غير متاح للسحب، أو سُحب من قبل');
  if(row.user_id===u.id)fail(409,'separation_of_duties','لا يسحب الموظف استثناء تأميناته بنفسه');
  const reason=v.text(input.reason,'سبب السحب وما الذي تبيّن',500,10),time=now();
  db.prepare('UPDATE employee_insurance_overrides SET withdrawn_by=?,withdrawn_at=?,withdrawal_reason=? WHERE id=?').run(u.id,time,reason,row.id);
  audit(db,u,'employee_insurance_override',row.id,'insurance.override_withdrawn',{kind:row.kind},{withdrawn:true},reason);
  return {id:row.id};
}
