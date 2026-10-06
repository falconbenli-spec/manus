import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { notifySubject, dayName, dateRange } from './notices.mjs';
import * as benefits from './benefits.mjs';
import { riyadhYearRange } from './riyadh-time.mjs';
import { proposeAdjustment } from './payroll-extras.mjs';
import { requestLetter, letterRequestSummary, letterTypeReady } from './letters.mjs';
// مفتاح تفعيل الميزة (ترحيل 129): «تذكرة السفر السنوية» في مثال المالك هي air_ticket هنا، لا خدمة في الدليل.
import { visibleSql, hiddenBenefitKeys, lastDecision, refuseHidden, audiencesFor, gatesFor } from './service-availability.mjs';

// «مزاياي»: ما لدى الموظف من مزايا، وما هو مؤهل له ومتى، وطلب مزايا واحد بخيارات.
// القواعد:
// 1) كل ميزة في الكتالوج مسودة حتى يعتمدها حامل hr.policy.accept (مدير الموارد البشرية) شخصًا غير من اقترحها.
//    ما لم تنص عليه اللائحة (مصفوفة المزايا، مرفق 1، م70، غير موجودة في الملف) معلَّم «يحتاج اعتماد مصفوفة المزايا».
// 2) الطلب يمر: الموظف ← الموارد البشرية (hr.benefits.manage) ← المالية (benefits.finance.confirm) حين يكون فيه مال.
//    نهاية المسار المالي مقترح صرف أو خصم لا يُصرف؛ مُعد الرواتب يسلّمه إلى حركات المسير مقترحًا يعتمده معتمد الرواتب هناك.
// 3) لا يرى «مزاياي» إلا صاحبها وحامل تصريح المزايا. التابعون يُقرأون ويُكتبون في benefits.mjs وحده.
// 4) لا بيانات طبية: لا تشخيص ولا مطالبة علاجية. التابع صلة قرابة وتاريخ ميلاد ومستند إثبات فقط.

export const CATEGORY_NAMES={allowance:'البدلات',insurance:'التأمين',travel:'السفر',finance:'السلف',development:'التطوير',family:'الأسرة',recognition:'التقدير',wellbeing:'العافية'};
export const FREQUENCY_NAMES={monthly:'شهري',annual:'سنوي',once:'مرة واحدة',per_event:'عند الحاجة أو الحدث',per_academic_year:'لكل عام دراسي',daily:'يومي',policy_term:'طوال مدة وثيقة التأمين'};
export const CLAIM_NAMES={automatic:'تلقائي: مع الراتب أو بقرار الموارد البشرية',request:'بطلب منك',enrolment:'بالتسجيل في وثيقة التأمين',informational:'للاطلاع'};
export const VALUE_BASIS_NAMES={fixed:'مبلغ ثابت',percent_of_basic:'نسبة من الأجر الأساسي',months_of_basic:'أشهر من الأجر الأساسي',policy:'بحسب السياسة',contract:'بحسب العقد',informational:'للاطلاع'};
export const STATE_NAMES={held:'لديك الآن',eligible:'مؤهل',upcoming:'تصبح مؤهلًا لاحقًا',on_event:'تنطبق عند حدوثها',not_eligible:'لا تنطبق عليك',unknown:'بيانات ناقصة'};
export const CATALOG_STATUS={draft:'مسودة لم تُعتمد',accepted:'معتمدة',rejected:'مرفوضة',retired:'مستبدلة'};
export const MATRIX_LABEL='يحتاج اعتماد مصفوفة المزايا';
export const REQUEST_STATUS={pending_hr:'بانتظار الموارد البشرية',pending_finance:'بانتظار التأكيد المالي',completed:'مكتمل',rejected:'مرفوض',withdrawn:'مسحوب'};
export const TARGET_NAMES={payroll_addition:'إضافة في المسير',payroll_deduction:'خصم من المسير',company_expense:'مصروف على الشركة (حجز التذكرة)'};
export const PROPOSAL_STATUS={proposed:'مقترح — لم يُصرف',handed_to_payroll:'سُلّم إلى حركات الرواتب مقترحًا',withdrawn:'مسحوب'};
// D-08: مقترح «حجز التذكرة» كان ينتهي بلا قارئ ولا إجراء لأي دور. الحجز يجري لدى وكيل السفر خارج المنصة،
// ومالك الخطوة التالية حامل تصريح المزايا: يسجّل مرجع الحجز هنا فيُقفل المسار ويُبلَّغ الموظف.
export const BOOKING_OWNER_CAP='hr.benefits.manage';
export const BOOKING_OWNER_NAME='فريق المزايا في الموارد البشرية (تصريح التأمين الطبي ومزايا الموظفين)';
export const EVENTS={relocation:'تنطبق عند نقلك إلى مدينة أخرى لمدة سنة فأكثر بغير طلبك.',childbirth:'تنطبق بعد العودة من إجازة الوضع، لمدة 24 شهرًا من تاريخ الوضع.'};
export const CONTRACT_TYPE_NAMES={indefinite:'غير محدد المدة',fixed_term:'محدد المدة'};
export const PAY_COMPONENT_NAMES={basic:'الراتب الأساسي',housing:'بدل السكن',transport:'بدل النقل',other_allowance:'بدل آخر'};
export const TICKET_CLASSES=[['executive','الدرجة الأولى — الرئيس التنفيذي ونوابه'],['general_manager','درجة رجال الأعمال — المدراء العموم'],['staff','درجة الضيافة — باقي العاملين']].map(([key,name])=>({key,name}));
const CAP={manage:'hr.benefits.manage',prepare:'hr.policy.prepare',accept:'hr.policy.accept',finance:'benefits.finance.confirm',payroll:'payroll.prepare'};
const STAGES=['روضة','ابتدائي','متوسط','ثانوي'];
const LETTER_PURPOSES=[['insurance_proof','إثبات تغطية تأمينية'],['embassy','سفارة أو تأشيرة'],['bank','جهة مصرفية'],['school','مدرسة أو جامعة'],['other','جهة أخرى']].map(([key,name])=>({key,name}));
// نوع الخطاب في وحدة الخطابات (ترحيل 105) ونوع الجهة التي يُوجَّه إليها: اسم حر يكتبه الموظف، فتُطبَّق عليه قاعدة الاسم الحر هناك.
const LETTER_TYPE_CODE='benefit_letter';
const REMOVAL_REASONS=[['divorce','انفصال'],['married','زواج الابن أو الابنة'],['deceased','وفاة'],['left_kingdom','مغادرة نهائية'],['other','سبب آخر']].map(([key,name])=>({key,name}));

// خيارات طلب المزايا الواحد. عند وصول نموذج «خيارات الخدمة» إلى service-catalog.mjs (فرع تجربة الموظف 101)
// تُربط خيارات خدمة HR-BENEFIT-CLAIM بمفاتيح هذه القائمة: المفتاح هو option، والحقول والمستندات والمسار من هنا.
export const OPTIONS=[
  {key:'dependant_add',name:'إضافة تابع إلى التأمين',benefit:'medical_insurance',finance:false,chain:'أنت ← الموارد البشرية (تُضيفه لدى شركة التأمين وتسجّله)',
    description:'الزوج أو الزوجة، أو ابن أو ابنة غير متزوجين (تعريف أسرة العامل في اللائحة، م98). الوالدان فقط إن اعتُمدت ميزة تأمين الوالدين.',
    documents:['عقد الزواج أو شهادة الميلاد (مطلوب)']},
  {key:'dependant_remove',name:'حذف تابع من التأمين',benefit:'medical_insurance',finance:false,chain:'أنت ← الموارد البشرية (تحذفه لدى شركة التأمين وتسجّل الحذف)',
    description:'عند انفصال أو زواج الابن أو الابنة أو المغادرة النهائية.',documents:[]},
  {key:'class_upgrade',name:'ترقية فئة التأمين على حسابي',benefit:'medical_insurance',finance:true,chain:'أنت ← الموارد البشرية (تحدد فرق القسط) ← المالية (تؤكده خصمًا مقترحًا)',
    description:'فئة أعلى من فئتك على أن تتحمل فرق القسط خصمًا من راتبك بعد اعتماده. متاحة فقط إن سمحت السياسة المعتمدة بذلك.',documents:[]},
  {key:'ticket_claim',name:'تذكرة السفر السنوية أو قيمتها',benefit:'air_ticket',finance:true,chain:'أنت ← الموارد البشرية (تتحقق من العقد والدرجة) ← المالية (تؤكد المبلغ مقترحًا)',
    description:'تذكرة بالدرجة المستحقة (م41) أو قيمتها نقدًا. طلب واحد في السنة.',documents:['موافقة الإجازة أو تاريخ السفر (اختياري)','عرض سعر عند طلب القيمة نقدًا (اختياري)']},
  {key:'education_claim',name:'مطالبة بدل تعليم الأبناء',benefit:'children_education',finance:true,chain:'أنت ← الموارد البشرية (تتحقق من السقف) ← المالية (تؤكد المبلغ مقترحًا)',
    description:'مساهمة في رسوم الدراسة بحسب السقف المعتمد. متاحة فقط إن اعتمد المالك الميزة.',documents:['فاتورة المدرسة الرسمية (مطلوب)']},
  {key:'benefit_letter',name:'خطاب بالمزايا',benefit:null,finance:false,chain:'أنت ← الموارد البشرية (تعتمد الطلب) ← وحدة الخطابات (تُعدّه جهة وتُصدره جهة أخرى برقم مرجعي ورمز تحقق)',
    description:'خطاب يثبت مزاياك لجهة تحددها. يصدر من وحدة الخطابات بقالب معتمد ورمز تحقق QR.',documents:[]}
].map(o=>({...o,documents_required:['dependant_add','education_claim'].includes(o.key)}));
const OPTION=Object.fromEntries(OPTIONS.map(o=>[o.key,o]));

const id=()=>randomUUID();
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const lastDay=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
// إضافة أشهر تقويمية: 31 أغسطس + 6 أشهر = 28 فبراير (آخر يوم في الشهر الهدف).
export function addMonths(date,n){
  const [y,m,d]=date.split('-').map(Number),total=(y*12+(m-1))+n,ty=Math.floor(total/12),tm=total%12+1;
  return `${ty}-${String(tm).padStart(2,'0')}-${String(Math.min(d,lastDay(ty,tm))).padStart(2,'0')}`;
}
const dayDiff=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
// المدة من تاريخ إلى تاريخ لاحق بالأشهر الكاملة ثم الأيام.
export function monthsAndDays(from,to){
  if(to<=from)return {months:0,days:0};
  let months=0;while(addMonths(from,months+1)<=to)months++;
  return {months,days:dayDiff(addMonths(from,months),to)};
}
const monthsWord=n=>n===1?'شهر':n===2?'شهرين':n<=10?`${n} أشهر`:`${n} شهرًا`;
const daysWord=n=>n===1?'يوم':n===2?'يومين':n<=10?`${n} أيام`:`${n} يومًا`;
export function durationText({months,days}){
  if(!months&&!days)return 'اليوم';
  if(!days)return monthsWord(months);
  if(!months)return daysWord(days);
  return `${monthsWord(months)} و${daysWord(days)}`;
}
export function money(minor){
  if(minor===null||minor===undefined)return '—';
  const n=BigInt(minor),abs=n<0n?-n:n;
  return `${n<0n?'-':''}${(abs/100n).toLocaleString('en-US')}.${String(abs%100n).padStart(2,'0')} ريال`;
}
const minorToAmount=minor=>`${BigInt(minor)/100n}.${String(BigInt(minor)%100n).padStart(2,'0')}`;
// D-24: مبلغ غائب كان يُعلن كأنه مكتوب خطأ («مبلغ بخانتين عشريتين كحد أقصى»). الرسالة من مصدر واحد في validation.mjs.
const amount=(value,label)=>v.moneyMinor(value,label);
function pastDate(value,label,date=today()){const d=v.date(value);if(d>date)fail(400,'future_date',`${label}: لا يُسجَّل تاريخ لم يأتِ بعد`);return d;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة المزايا معاملة قاعدة بيانات');}
function actor(db,supplied){
  const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');
  u.caps=Object.fromEntries(Object.entries(CAP).map(([k,cap])=>[k,holds(db,u,cap)]));return u;
}
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

// ── الإشعارات ─────────────────────────────────────────────────────────────
// الإشعار يُكتب داخل معاملة الإجراء بنص من قالب لا يحمل مبلغًا ولا بيانًا عن التابع.
// فرع بلا شرط الشكل (الترحيل 099) يرفض موضوعات المزايا بقيد CHECK؛ نقطة الحفظ تجعل الإشعار يسقط وحده بدل أن يُسقط الإجراء.
function notify(db,userId,subjectKind,subjectId,kind,title,body){
  db.exec('SAVEPOINT benefit_notice');
  try{notifySubject(db,{userId,kind,subjectKind,subjectId,title,body});db.exec('RELEASE benefit_notice');}
  catch(error){db.exec('ROLLBACK TO benefit_notice');db.exec('RELEASE benefit_notice');if(!/CHECK constraint failed/.test(String(error?.message)))throw error;}
}
function holdersOf(db,tenantId,capability,exclude=[]){
  return db.prepare('SELECT * FROM users WHERE tenant_id=? AND active=1').all(tenantId).filter(p=>!exclude.includes(p.id)&&holds(db,p,capability)).map(p=>p.id);
}

// ── الكتالوج ─────────────────────────────────────────────────────────────
const unpack=row=>row&&({...row,rules:JSON.parse(row.rules),value_params:JSON.parse(row.value_params),documents:JSON.parse(row.documents)});
function catalogRows(db,tenantId){
  const rows=db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id=? AND status IN ('draft','accepted') ORDER BY sort_order,revision").all(tenantId).map(unpack);
  const byKey=new Map();
  for(const r of rows){const entry=byKey.get(r.benefit_key)??{key:r.benefit_key,sort_order:r.sort_order,accepted:null,draft:null};entry[r.status==='accepted'?'accepted':'draft']=r;byKey.set(r.benefit_key,entry);}
  return [...byKey.values()].sort((a,b)=>a.sort_order-b.sort_order);
}
export const acceptedBenefit=(db,tenantId,key)=>unpack(db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id=? AND benefit_key=? AND status='accepted'").get(tenantId,key));
export function citation(row){
  if(row.source_kind==='regulation')return `لائحة تنظيم العمل، ${row.article}`;
  return `${MATRIX_LABEL} (مرفق 1، م70)${row.article?` — ${row.article}`:''}`;
}

// ── حقائق الموظف والأهلية ──────────────────────────────────────────────────
// من سجل الموظف وعقده الساري وسجل التركيبة فقط. الدرجة الوظيفية لا سجل لها في المنصة بعد.
export function factsOf(db,tenantId,userId){
  const user=db.prepare('SELECT id,name,active,role FROM users WHERE id=? AND tenant_id=?').get(userId,tenantId);
  if(!user)return null;
  const profile=db.prepare('SELECT join_date,employment_type,status FROM employee_profiles WHERE user_id=? AND tenant_id=?').get(userId,tenantId);
  const contract=db.prepare("SELECT * FROM employment_contracts WHERE user_id=? AND tenant_id=? AND status='active'").get(userId,tenantId);
  const first=db.prepare("SELECT MIN(start_date) AS d FROM employment_contracts WHERE user_id=? AND tenant_id=? AND status IN ('active','ended')").get(userId,tenantId)?.d??null;
  const demo=db.prepare('SELECT nationality_group,gender FROM employee_demographics WHERE user_id=? AND tenant_id=?').get(userId,tenantId);
  const lines=contract?JSON.parse(contract.pay_lines):[];
  return {user_id:user.id,name:user.name,active:!!user.active,join_date:profile?.join_date??first??null,join_source:profile?.join_date?'profile':first?'contract':null,
    employment_type:profile?.employment_type??null,profile_status:profile?.status??null,contract_type:contract?.contract_type??null,contract_start:contract?.start_date??null,
    probation_end:contract?addDaysIso(contract.start_date,contract.probation_days):null,nationality:demo?.nationality_group??null,gender:demo?.gender??null,grade:null,
    pay_lines:lines,basic_minor:lines.find(l=>l.component==='basic')?.amount_minor??null,has_contract:!!contract};
}
function addDaysIso(date,n){return new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);}
// الأهلية من قواعد الميزة وحقائق الموظف في تاريخ. الترتيب: ما يمنع صراحة، ثم ما ينقص، ثم ما ينتظر تاريخًا، ثم ما ينتظر حدثًا.
export function evaluateEligibility(rules,facts,date=today()){
  const reasons=[],missing=[];let from=null,blocked=false;
  const later=d=>{if(!from||d>from)from=d;};
  if(Number.isInteger(rules.min_tenure_months)&&rules.min_tenure_months>0){
    if(!facts.join_date)missing.push('تاريخ الالتحاق');
    else later(addMonths(facts.join_date,rules.min_tenure_months));
  }
  if(rules.past_probation){if(!facts.probation_end)missing.push('العقد الساري وفترة التجربة');else later(facts.probation_end);}
  if(rules.nationality){
    if(!facts.nationality)missing.push('الجنسية في سجل تركيبة الموظفين');
    else if(facts.nationality!==rules.nationality){blocked=true;reasons.push(rules.nationality==='saudi'?'تخص العاملين السعوديين':'تخص غير السعوديين');}
  }
  if(rules.gender){
    if(!facts.gender)missing.push('الجنس في سجل تركيبة الموظفين');
    else if(facts.gender!==rules.gender){blocked=true;reasons.push(rules.gender==='female'?'تخص العاملات':'تخص العاملين');}
  }
  if(Array.isArray(rules.contract_types)&&rules.contract_types.length){
    if(!facts.contract_type)missing.push('العقد الساري');
    else if(!rules.contract_types.includes(facts.contract_type)){blocked=true;reasons.push(`تخص العقود: ${rules.contract_types.map(t=>CONTRACT_TYPE_NAMES[t]??t).join('، ')}`);}
  }
  if(Array.isArray(rules.employment_types)&&rules.employment_types.length){
    if(!facts.employment_type)missing.push('نوع التوظيف في السجل الوظيفي');
    else if(!rules.employment_types.includes(facts.employment_type)){blocked=true;reasons.push('لا تنطبق على نوع توظيفك');}
  }
  if(Array.isArray(rules.grades)&&rules.grades.length)missing.push('الدرجة الوظيفية (لا سجل للدرجات في المنصة بعد)');
  if(blocked)return {state:'not_eligible',reasons,text:reasons.join('؛ ')};
  if(missing.length)return {state:'unknown',missing,text:`تُحدد أهليتك بعد تسجيل: ${missing.join('، ')}`};
  if(from&&from>date){
    const wait=monthsAndDays(date,from);
    return {state:'upcoming',eligible_from:from,wait,text:`تصبح مؤهلًا بعد ${durationText(wait)} (في ${dayName(from,date)})`};
  }
  if(rules.event)return {state:'on_event',event:rules.event,eligible_from:from,text:EVENTS[rules.event]??'تنطبق عند حدوثها.'};
  return {state:'eligible',eligible_from:from,contract_clause:!!rules.contract_clause,
    text:from?`مؤهل منذ ${dayName(from,date)}`:'مؤهل'+(rules.contract_clause?'. يتحقق فريق المزايا من نص عقدك عند الطلب':'')};
}
function valueText(row,facts){
  const p=row.value_params,line=c=>facts?.pay_lines?.find(l=>l.component===c);
  if(row.value_basis==='percent_of_basic'){
    const pct=Number(p.percent)||0,base=facts?.basic_minor;
    return `${pct}% من الأجر الأساسي شهريًا${base?` = ${money(Math.round(base*pct/100))} على أساسي عقدك`:''}`;
  }
  if(row.value_basis==='months_of_basic'){const months=Number(p.months)||1,base=facts?.basic_minor;return `أجر أساسي ${months===1?'لشهر واحد':`لـ${monthsWord(months)}`}${base?` = ${money(base*months)}`:''}`;}
  if(row.value_basis==='contract'){const l=p.component&&line(p.component);return l?`كما في عقدك: ${money(l.amount_minor)} شهريًا`:'بحسب ما ينص عليه العقد';}
  if(row.value_basis==='fixed')return Number.isInteger(p.amount_minor)?money(p.amount_minor):'مبلغ ثابت يحدده القرار';
  if(p.classes)return `الدرجة بحسب المسمى (م41): ${Object.values(p.classes).join('، ')}${p.cash_equivalent?'؛ ويجوز صرف قيمتها نقدًا':''}`;
  return p.text??VALUE_BASIS_NAMES[row.value_basis];
}
// ما لدى الموظف فعلًا: بند في العقد الساري، أو تسجيل تأمين قائم.
function heldText(row,facts,coverage){
  if(['housing','transport'].includes(row.benefit_key)){
    const l=facts?.pay_lines?.find(x=>x.component===row.benefit_key&&x.amount_minor>0);
    return l?`في عقدك الساري: ${money(l.amount_minor)} شهريًا`:null;
  }
  if(row.benefit_key==='medical_insurance'&&coverage)return `${coverage.status_name} · الفئة ${coverage.tier}`;
  if(row.benefit_key==='social_insurance'&&facts?.has_contract)return 'تشترك المنشأة عنك لدى التأمينات الاجتماعية (يُتحقق من حالته لدى التأمينات)';
  return null;
}
// ── شرطٌ اختارته الشركة على ميزة مصدرها اللائحة ──────────────────────────────────
// م39/2 تحيل مصروفات إركاب العامل وأسرته عند تمتعه بإجازته السنوية إلى «ما يتفق عليه في عقد العمل»،
// ولا تذكر مدة خدمة قبل أول تذكرة؛ وم41/1 تحدد الدرجة لا المدة. فسنة الخدمة المسجلة على «تذكرة السفر
// السنوية» اختيار الشركة، لا ما تفرضه اللائحة. سُئل المالك في 22 سبتمبر 2026 أيُبقيها أم يُسقطها، فطلب
// مفتاحًا يفعّل الميزة ويخفيها بدل الجواب — فالشرط يبقى كما هو، ويُقال بوضوح من اختاره أينما عُرض.
// القاعدة عامة لا استثناءً لسطر واحد: أي ميزة مصدرها اللائحة وعليها شرط مدة خدمة فهذا الشرط من عند
// الشركة، لأن المواد المستند إليها لا تضع مدة. ولو أضاف المالك غدًا شرطًا كهذا لميزة أخرى قيل فيه الشيء نفسه.
export function companyChoiceNote(row){
  if(!row||row.source_kind!=='regulation')return null;
  // الصف يصل مفكوكًا من catalogRows وacceptedBenefit، وخامًا من استعلام مباشر على benefit_catalog.
  // النص يُقرأ في الحالين: ملاحظةٌ تسقط صامتة لأن المستدعي لم يفكّ الصف هي ملاحظة لا تُقال حين تلزم.
  const rules=typeof row.rules==='string'?(()=>{try{return JSON.parse(row.rules);}catch{return null;}})():row.rules;
  const months=rules?.min_tenure_months;
  if(!Number.isInteger(months)||months<=0)return null;
  return `شرط مدة الخدمة (${months} شهرًا) اختيار الشركة لا نص اللائحة: ${row.article||'المادة المستند إليها'} لا تحدد مدة خدمة قبل الاستحقاق. يبقى الشرط حتى يقرر المالك غيره، ويُعدَّل من «إدارة المزايا».`;
}
function benefitCard(db,row,facts,coverage,date,{accepted}){
  const eligibility=facts?evaluateEligibility(row.rules,facts,date):{state:'unknown',text:'لا سجل موظف'};
  const held=facts?heldText(row,facts,coverage):null;
  const state=held?'held':eligibility.state;
  return {company_choice:companyChoiceNote(row),
    key:row.benefit_key,catalog_id:row.id,name:row.name,summary:row.summary,category:row.category,category_name:CATEGORY_NAMES[row.category],
    source_kind:row.source_kind,article:row.article,citation:citation(row),source_note:row.source_note,matrix_label:row.source_kind==='needs_matrix'?MATRIX_LABEL:null,
    status:row.status,status_name:CATALOG_STATUS[row.status],accepted,draft_warning:accepted?null:'مسودة لم يعتمدها مدير الموارد البشرية بعد: لا تُعد استحقاقًا ولا تُطلب قبل اعتمادها.',
    value_basis:row.value_basis,value_basis_name:VALUE_BASIS_NAMES[row.value_basis],value_text:valueText(row,facts),frequency:row.frequency,frequency_name:FREQUENCY_NAMES[row.frequency],
    claim_method:row.claim_method,claim_name:CLAIM_NAMES[row.claim_method],request_option:row.request_option,documents:row.documents,
    state,state_name:STATE_NAMES[state],held_text:held,eligibility};
}

// ── «مزاياي» ────────────────────────────────────────────────────────────
function subjectOf(db,u,employeeId){
  if(employeeId===undefined||employeeId===null||employeeId===''||employeeId===u.id)return u.id;
  if(!u.caps.manage)fail(404,'not_found','مزايا هذا الموظف غير متاحة');
  if(typeof employeeId!=='string'||!db.prepare("SELECT 1 FROM users WHERE id=? AND tenant_id=? AND role<>'admin'").get(employeeId,u.tenant_id))fail(404,'not_found','الموظف غير متاح');
  return employeeId;
}
const docMeta=d=>({id:d.id,label:d.label,filename:d.filename,media_type:d.media_type,size:d.size,created_at:d.created_at,uploaded_by_name:d.uploaded_by_name});
function documentsOf(db,tenantId,kind,ownerId){
  return db.prepare('SELECT d.id,d.label,d.filename,d.media_type,d.size,d.created_at,x.name AS uploaded_by_name FROM benefit_documents d JOIN users x ON x.id=d.uploaded_by WHERE d.tenant_id=? AND d.owner_kind=? AND d.owner_id=? ORDER BY d.created_at').all(tenantId,kind,ownerId).map(docMeta);
}
// وصلة «مزاياي» إلى خدمة في الدليل (السلفة والتدريب): تُقفل بمفتاح الخدمة كما يُقفل الدليل نفسه،
// فلا يبقى في شاشة المزايا زرٌّ يقود إلى خدمة أوقفها المالك ويُردّ صاحبه بعد الضغط.
function serviceIdFor(db,u,code){
  return db.prepare(`SELECT s.id FROM services s WHERE s.tenant_id=? AND s.code=? AND s.active=1 AND ${visibleSql('s','code','service',audiencesFor(u),gatesFor(db,u))} ORDER BY s.version DESC LIMIT 1`).get(u.tenant_id,code)?.id??null;
}
// سبب واحد يُقرأ في «مزاياي» وفي رفض الطلب: الميزة موقوفة من الإعدادات، وهذا نص سبب الإيقاف كما كتبه صاحب القرار.
// مُصدَّر لأن وحدة المزايا الثلاث (app/secondment-benefits.mjs) تقول الجملة نفسها في لوحها: مفتاحٌ واحد على
// الميزة يُقرأ في بابيها معًا، فلا تُكتب له عبارتان تنحرف إحداهما عن الأخرى.
export const switchedOffReason=(db,tenantId,key)=>{const d=lastDecision(db,tenantId,'benefit',key);
  return `موقوفة من إعدادات الخدمات${d?`: ${d.reason}`:''}. يعيد تفعيلها من يملك «إعداد الخدمات» من شاشة «إعداد الاعتماد».`;};
function optionAvailability(db,u,subjectId,facts,coverage,date){
  const accepted=key=>acceptedBenefit(db,u.tenant_id,key);
  const out={};
  const parents=accepted('parents_insurance'),parentsOk=!!parents&&facts&&evaluateEligibility(parents.rules,facts,date).state==='eligible';
  out.dependant_add=!coverage?{available:false,reason:'لا تسجيل تأمين قائم لك. تواصل مع الموارد البشرية لتسجيلك أولًا.'}
    :{available:true,relations:[{key:'spouse',name:'زوج/زوجة'},{key:'child',name:'ابن/ابنة غير متزوج'},...(parentsOk?[{key:'parent',name:'والد/والدة'}]:[])]};
  const active=(coverage?.dependants??[]).filter(d=>!d.removed_on);
  out.dependant_remove=!active.length?{available:false,reason:'لا تابعين مسجلين على تأمينك.'}:{available:true,dependants:active.map(d=>({id:d.id,name:`${d.relation_name} — مواليد ${longDate(d.birth_date)}`}))};
  const medical=accepted('medical_insurance'),higher=(coverage?.policy_tiers??[]).filter(t=>t!==coverage?.tier);
  out.class_upgrade=!coverage?{available:false,reason:'لا تسجيل تأمين قائم لك.'}
    :!medical?{available:false,reason:'ميزة التأمين الطبي ما زالت مسودة لم يعتمدها مدير الموارد البشرية.'}
    :medical.value_params.upgrade_at_employee_cost!==true?{available:false,reason:'السياسة المعتمدة لا تسمح بترقية الفئة على حساب الموظف.'}
    :!higher.length?{available:false,reason:'لا فئة أخرى في وثيقتك.'}:{available:true,tiers:higher,current_tier:coverage.tier};
  const ticket=accepted('air_ticket');
  if(!ticket)out.ticket_claim={available:false,reason:'ميزة التذكرة ما زالت مسودة لم يعتمدها مدير الموارد البشرية.'};
  else{
    const e=facts?evaluateEligibility(ticket.rules,facts,date):{state:'unknown',text:'لا سجل موظف'};
    // «طلب تذكرة هذه السنة» بسنة الرياض: created_at طابع UTC، فيُقارَن بلحظتَي بداية السنة ونهايتها لا بأول أربعة أحرف منه
    // (طلبٌ في أول ثلاث ساعات من 1 يناير كان يُحسب على السنة الماضية، فيُفتح لصاحبه طلبٌ ثانٍ في السنة نفسها).
    const used=db.prepare("SELECT reference FROM benefit_requests WHERE tenant_id=? AND employee_id=? AND option='ticket_claim' AND status IN ('pending_hr','pending_finance','completed') AND created_at>=? AND created_at<?").get(u.tenant_id,subjectId,...riyadhYearRange(date.slice(0,4)));
    // D-08: نمط «حجز التذكرة» له الآن خطوة تالية ومالك، ويُقالان للموظف قبل التقديم لا بعده.
    out.ticket_claim=e.state!=='eligible'?{available:false,reason:e.text}:used?{available:false,reason:`لك طلب تذكرة هذه السنة (${used.reference}).`}
      :{available:true,cash_equivalent:ticket.value_params.cash_equivalent!==false,
        mode_notes:{cash:'القيمة نقدًا تصل حركات الرواتب مقترحًا يعتمده معتمد الرواتب، ولا تُصرف من هذه الشاشة.',
          ticket:`حجز التذكرة يجري لدى وكيل السفر خارج المنصة بعد التأكيد المالي، ويسجّل مرجعه ${BOOKING_OWNER_NAME}. المنصة لا تحجز ولا تدفع.`}};
  }
  const education=accepted('children_education');
  if(!education)out.education_claim={available:false,reason:`بدل التعليم ${MATRIX_LABEL} وقرار المالك؛ لم يُعتمد بعد.`};
  else{const e=facts?evaluateEligibility(education.rules,facts,date):{state:'unknown',text:'لا سجل موظف'};out.education_claim=e.state==='eligible'?{available:true,stages:STAGES}:{available:false,reason:e.text};}
  // خطاب المزايا: يفتح طلب خطاب حقيقيًا في وحدة الخطابات إن كان لنوع «خطاب بالمزايا» قالب معتمد (ترحيل 105).
  // قبل اعتماد القالب يبقى المسار القديم: الموارد البشرية تُصدر الخطاب خارج المنصة وتسجل مرجعه وترفعه.
  // طلب خطاب مفتوح لهذا النوع يمنع طلبًا ثانيًا كما تمنعه وحدة الخطابات نفسها، فلا يصل الموظف إلى رفض بعد التقديم.
  const letterReady=letterTypeReady(db,u.tenant_id,LETTER_TYPE_CODE);
  const openLetter=letterReady?db.prepare("SELECT 1 FROM letter_requests WHERE tenant_id=? AND user_id=? AND type_code=? AND status IN ('requested','prepared')").get(u.tenant_id,subjectId,LETTER_TYPE_CODE):null;
  // D-04: قبل اعتماد القالب لا يصدر من المنصة مستند، فيُقال ذلك هنا قبل التقديم بدل أن يُقال بعده «الخطاب مرفق» وهو غير موجود.
  out.benefit_letter=openLetter?{available:false,reason:'لديك طلب «خطاب بالمزايا» مفتوح في «خطاباتي». تابعه هناك أو ألغه قبل طلب خطاب آخر.',letter_ready:true}
    :{available:true,purposes:LETTER_PURPOSES,letter_ready:letterReady,
      note:letterReady?'يصدر الخطاب من وحدة الخطابات برقم مرجعي ورمز تحقق QR، ويصلك إشعار عند صدوره.'
        :'لا قالب معتمد لنوع «خطاب بالمزايا» بعد، فلن يصدر من المنصة مستند لهذا الطلب: تسجّل الموارد البشرية مرجع خطاب تُعدّه خارج المنصة وتسلّمه لك. اطلب من مالك إجراء الخطابات اعتماد القالب إن أردت مستندًا برقم مرجعي ورمز تحقق.'};
  // مفتاح المالك يعلو ما سبق: ميزة أوقفها لا يُفتح منها خيار مهما كانت أهلية الموظف أو حال الكتالوج.
  // يقع هنا لا في كل فرع أعلاه، فلا ينسى فرعٌ جديد المفتاحَ يومًا. والخيار الذي لا ميزة له (خطاب المزايا)
  // لا يمسّه: شيئه في وحدة الخطابات لا في كتالوج المزايا، ولا مفتاح له في هذا الترحيل.
  const switchedOff=hiddenBenefitKeys(db,u.tenant_id);
  for(const option of OPTIONS)if(option.benefit&&switchedOff.has(option.benefit))
    out[option.key]={available:false,reason:switchedOffReason(db,u.tenant_id,option.benefit),switched_off:true};
  // الشرط الذي اختارته الشركة يُقال عند الخيار نفسه لا في بطاقة الميزة وحدها: من فتح «تذكرة السفر السنوية»
  // ليطلبها فقُرئ له «تصبح مؤهلًا بعد سبعة أشهر» يستحق أن يعرف أن السنة قرار شركته لا حكم اللائحة.
  // ويُقرأ من المعتمدة أو من المسودة، كما تفعل بطاقة الميزة (entry.accepted??entry.draft) بالضبط: «تذكرة
  // السفر السنوية» ما زالت مسودة في هذا الكيان، فقراءة المعتمدة وحدها كانت تُسقط النص عن الخيار تمامًا —
  // فيُقال الشرط في البطاقة ويُسكت عنه في المكان الذي يقف فيه الموظف ليطلب. الشرط قائم في الحالين، فيُنسب
  // إلى من اختاره في الحالين.
  const latest=key=>accepted(key)??unpack(db.prepare('SELECT * FROM benefit_catalog WHERE tenant_id=? AND benefit_key=? ORDER BY revision DESC LIMIT 1').get(u.tenant_id,key));
  return OPTIONS.map(o=>({key:o.key,name:o.name,description:o.description,chain:o.chain,documents:o.documents,documents_required:o.documents_required,needs_finance:o.finance,
    company_choice:o.benefit?companyChoiceNote(latest(o.benefit)):null,...out[o.key]}));
}
// D-08: حالة الحجز ومالك خطوته التالية. مقترح غير «حجز التذكرة» لا حجز له، فلا يحمل شيئًا من هذا.
function bookingState(db,proposal){
  if(proposal.target!=='company_expense')return {};
  const booking=db.prepare('SELECT * FROM benefit_ticket_bookings WHERE proposal_id=?').get(proposal.id)??null;
  return {booking:booking?{reference:booking.reference,booked_on:booking.booked_on,note:booking.note,recorded_by_name:personName(db,booking.recorded_by)}:null,
    next_step:booking?null:'record_booking',next_step_name:booking?null:'تسجيل مرجع حجز التذكرة',
    next_step_owner:booking?null:BOOKING_OWNER_NAME,
    state_text:booking?`حُجزت التذكرة وسُجل مرجعها في ${dayName(booking.booked_on)}`
      :`بانتظار حجز التذكرة لدى وكيل السفر وتسجيل مرجعه. المنصة لا تحجز ولا تدفع؛ يتولاه ${BOOKING_OWNER_NAME}.`};
}
function requestView(db,u,r,{forAdmin=false}={}){
  const details=JSON.parse(r.details),hr=JSON.parse(r.hr_details),proposal=db.prepare('SELECT * FROM benefit_payout_proposals WHERE request_id=?').get(r.id);
  const own=r.employee_id===u.id,seesFamily=own||u.caps.manage;
  const actions=[];
  if(own&&['pending_hr','pending_finance'].includes(r.status))actions.push('withdraw_request');
  if(own&&r.status==='pending_hr')actions.push('upload_request_document');
  if(forAdmin&&!own&&u.caps.manage&&r.status==='pending_hr')actions.push('hr_approve','hr_reject');
  if(forAdmin&&!own&&u.caps.manage&&!['withdrawn','rejected'].includes(r.status))actions.push('upload_request_document');
  if(forAdmin&&!own&&u.caps.finance&&r.status==='pending_finance'&&r.hr_by!==u.id)actions.push('finance_approve','finance_reject');
  return {id:r.id,reference:r.reference,employee_id:r.employee_id,employee_name:personName(db,r.employee_id),option:r.option,option_name:OPTION[r.option].name,chain:OPTION[r.option].chain,
    status:r.status,status_name:REQUEST_STATUS[r.status],needs_finance:!!r.needs_finance,created_at:r.created_at,updated_at:r.updated_at,version:r.version,
    // تفاصيل التابع (صلة القرابة وتاريخ الميلاد) لصاحب الطلب وحامل تصريح المزايا فقط؛ المالية ترى المبلغ والمرجع.
    details:seesFamily?details:undefined,summary:summaryOf(r.option,details,seesFamily),hr_details:hr,
    hr_by_name:personName(db,r.hr_by),hr_at:r.hr_at,hr_note:r.hr_note,finance_by_name:personName(db,r.finance_by),finance_at:r.finance_at,finance_note:r.finance_note,
    amount_minor:r.amount_minor,outcome:JSON.parse(r.outcome),
    // الخطاب المولَّد: حالته ورقمه المرجعي فقط. نصه ورمز تحققه في «خطاباتي» بقاعدة الاطلاع هناك.
    letter:details.letter_request_id?letterRequestSummary(db,r.tenant_id,details.letter_request_id):null,
    proposal:proposal?{id:proposal.id,target:proposal.target,target_name:TARGET_NAMES[proposal.target],amount_minor:proposal.amount_minor,status:proposal.status,status_name:PROPOSAL_STATUS[proposal.status],
      ...bookingState(db,proposal)}:null,
    documents:documentsVisible(u,r)?documentsOf(db,u.tenant_id,'request',r.id):[],actions};
}
// نص الملخص بتواريخ عربية («2 أبريل 1993») لا ISO، فلا يقلبها اتجاه السطر.
const longDate=date=>dayName(date,'0000-01-01');
function summaryOf(option,d,family){
  if(option==='dependant_add')return family?`${d.relation_name??''} — مواليد ${longDate(d.birth_date)}`:'إضافة تابع';
  if(option==='dependant_remove')return family?`${d.dependant_name??'تابع'} — ${d.reason_name??''} من ${longDate(d.effective_date)}`:'حذف تابع';
  if(option==='class_upgrade')return `من ${d.current_tier} إلى ${d.target_tier}`;
  if(option==='ticket_claim')return `${d.mode==='cash'?'القيمة نقدًا':'حجز تذكرة'} · ${d.destination} · ${d.travel_to?dateRange(d.travel_from,d.travel_to,'0000-01-01'):`يوم ${longDate(d.travel_from)}`}`;
  if(option==='education_claim')return `${d.stage} · ${d.school} · ${d.academic_year} · الفاتورة ${money(d.invoice_minor)}`;
  if(option==='benefit_letter')return `${d.purpose_name} · إلى ${d.addressee} · ${d.language==='en'?'بالإنجليزية':'بالعربية'}`;
  return '';
}
const documentsVisible=(u,r)=>r.employee_id===u.id||u.caps.manage||(u.caps.finance&&r.needs_finance===1&&['pending_finance','completed'].includes(r.status)&&r.option!=='dependant_add');

export function myBenefits(db,supplied,employeeId){
  const u=actor(db,supplied),date=today(),subject=subjectOf(db,u,employeeId);
  const facts=factsOf(db,u.tenant_id,subject);
  const coverage=benefits.coverageOf(db,u,subject);
  const hr=u.caps.manage;
  const entries=catalogRows(db,u.tenant_id);
  // ما أوقفه المالك بمفتاح الإعدادات (ترحيل 129). حامل تصريح المزايا يراه ومعه سبب الإيقاف، فيعرف لماذا
  // اختفت الميزة عن موظفيه؛ والموظف لا يرى ميزة لا تُطلب ولا تُصرف، ويُقال عددها بدل أن تُطرح صامتة.
  const switchedOff=hiddenBenefitKeys(db,u.tenant_id);
  let hiddenPending=0,switchedOffCount=0;
  const cards=[];
  for(const entry of entries){
    const row=entry.accepted??entry.draft;if(!row)continue;
    if(switchedOff.has(entry.key)){
      switchedOffCount++;
      if(!hr)continue;
      cards.push({...benefitCard(db,row,facts,coverage,date,{accepted:!!entry.accepted}),switched_off:true,switched_off_reason:switchedOffReason(db,u.tenant_id,entry.key)});
      continue;
    }
    // ما لم يُعتمد مما أحالته اللائحة إلى المصفوفة لا يُعرض على الموظف: لا توقعات من ميزة قد لا تُقدَّم.
    if(!entry.accepted&&row.source_kind==='needs_matrix'&&!hr){hiddenPending++;continue;}
    cards.push(benefitCard(db,row,facts,coverage,date,{accepted:!!entry.accepted}));
  }
  const contract=facts?.has_contract?{lines:facts.pay_lines.map(l=>({component:l.component,name:PAY_COMPONENT_NAMES[l.component]??l.component,amount_minor:l.amount_minor})),
    total_minor:facts.pay_lines.reduce((n,l)=>n+l.amount_minor,0),contract_type_name:CONTRACT_TYPE_NAMES[facts.contract_type],start_date:facts.contract_start}:null;
  const notes=[];
  if(contract&&facts.basic_minor){
    const housing=facts.pay_lines.find(l=>l.component==='housing')?.amount_minor??0,expected=Math.round(facts.basic_minor*25/100);
    if(housing&&housing!==expected)notes.push(`بدل السكن في عقدك (${money(housing)}) يختلف عن 25% من الأساسي (${money(expected)}) في م67. قد يكون العقد نص على غير ذلك (م66) أو السكن مؤمَّن عينًا؛ استفسر من الموارد البشرية إن احتجت.`);
    if(!housing)notes.push('عقدك لا يتضمن بدل سكن نقديًا. قد توفر المنشأة السكن عينًا (م66، م72).');
  }
  const tenure=facts?.join_date?monthsAndDays(facts.join_date,date):null;
  const requests=db.prepare('SELECT * FROM benefit_requests WHERE tenant_id=? AND employee_id=? ORDER BY created_at DESC').all(u.tenant_id,subject).map(r=>requestView(db,u,r));
  // الطلب يقدمه صاحبه فقط: حامل التصريح الذي يطالع مزايا موظف آخر لا يرى خيارات الطلب.
  const options=subject===u.id?optionAvailability(db,u,subject,facts,coverage,date):[];
  const links={};
  for(const code of ['HR-SALARY-ADVANCE','TAL-TRAINING'])links[code]=serviceIdFor(db,u,code);
  return {today:date,user_id:u.id,subject_id:subject,viewing_self:subject===u.id,can_manage:hr,
    employee:facts?{id:facts.user_id,name:facts.name,join_date:facts.join_date,join_text:facts.join_date?`في الخدمة منذ ${dayName(facts.join_date,date)} (${durationText(tenure)})`:'تاريخ الالتحاق غير مسجل في السجل الوظيفي',
      contract_type_name:facts.contract_type?CONTRACT_TYPE_NAMES[facts.contract_type]:null,nationality:facts.nationality,gender_recorded:!!facts.gender}:null,
    insurance:coverage?{...coverage,cards:documentsOf(db,u.tenant_id,'enrolment',coverage.enrolment_id)}:null,
    allowances:contract,allowance_notes:notes,benefits:cards,hidden_pending_count:hiddenPending,switched_off_count:switchedOffCount,options,requests,service_links:links,
    counts:{held:cards.filter(c=>c.state==='held').length,eligible:cards.filter(c=>c.state==='eligible').length,upcoming:cards.filter(c=>c.state==='upcoming').length,open_requests:requests.filter(r=>['pending_hr','pending_finance'].includes(r.status)).length},
    note:'المزايا هنا من لائحة تنظيم العمل كما صيغت في المنصة، وكل ميزة مسودة حتى يعتمدها مدير الموارد البشرية. المال لا يُصرف من هذه الشاشة: المطالبة المعتمدة مقترح للمسير أو المصروفات فقط.',
    privacy_note:'لا يرى هذه الصفحة إلا أنت وفريق المزايا في الموارد البشرية. لا تُسجَّل أي معلومة طبية؛ بيانات التابعين صلة القرابة وتاريخ الميلاد فقط.'};
}

// ── تقديم الطلب ─────────────────────────────────────────────────────────
const SIGNATURES=[['application/pdf',Buffer.from('%PDF-')],['image/png',Buffer.from([137,80,78,71,13,10,26,10])],['image/jpeg',Buffer.from([0xFF,0xD8,0xFF])]];
function storeDocument(db,u,{kind,ownerId,employeeId,label,filename,content}){
  const name=v.text(filename,'اسم الملف',120);
  if([...name].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127||ch==='/'||ch==='\\')||name.includes('..'))fail(400,'filename','اسم الملف غير صالح');
  if(typeof content!=='string'||content.length>2800000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content))fail(400,'content','ترميز الملف غير صالح');
  const data=Buffer.from(content,'base64');
  if(data.length<1||data.length>2097152)fail(413,'file_size','الحد الأقصى للملف 2 ميغابايت');
  const media=SIGNATURES.find(([,s])=>data.subarray(0,s.length).equals(s))?.[0];
  if(!media)fail(400,'file_type','الأنواع المسموحة: PDF وPNG وJPEG بتوقيع محتوى مطابق');
  const digest=hash(data);
  if(db.prepare('SELECT 1 FROM benefit_documents WHERE tenant_id=? AND owner_kind=? AND owner_id=? AND digest=?').get(u.tenant_id,kind,ownerId,digest))fail(409,'duplicate_file','هذا الملف مرفوع مسبقًا');
  const docId=id();
  db.prepare('INSERT INTO benefit_documents(id,tenant_id,owner_kind,owner_id,employee_id,label,filename,media_type,size,digest,content,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(docId,u.tenant_id,kind,ownerId,employeeId,v.text(label,'وصف المستند',180,3),name,media,data.length,digest,data,u.id,now());
  audit(db,u,'benefit_document',docId,'benefit_document.uploaded',{}, {owner_kind:kind,owner_id:ownerId,size:data.length});
  return docId;
}
// مرجع مستند اختياري بصيغة مقنّعة: رقم هوية أو إقامة كامل (6 أرقام متتالية فأكثر) مرفوض.
function maskedReference(value){
  if(value===undefined||value==='')return '';
  const ref=v.text(value,'مرجع المستند',60,2);
  if(/\d{6,}/.test(ref.replace(/[\s-]/g,'')))fail(400,'full_identifier','لا تكتب رقم الهوية أو المستند كاملًا؛ آخر أربعة أرقام تكفي');
  return ref;
}
function optionDetails(db,u,option,input,facts,availability,date){
  const d=input.details;
  if(!d||typeof d!=='object'||Array.isArray(d))fail(400,'details','أدخل تفاصيل الطلب');
  if(option==='dependant_add'){
    v.object(d,['relation','birth_date','document_reference']);
    const relation=availability.relations.find(r=>r.key===d.relation);
    if(!relation)fail(400,'relation',d.relation==='parent'?'إضافة الوالدين تحتاج ميزة تأمين الوالدين معتمدة ومنطبقة عليك':'اختر صلة القرابة: زوج أو زوجة، أو ابن أو ابنة غير متزوجين');
    return {relation:relation.key,relation_name:relation.name,birth_date:pastDate(d.birth_date,'تاريخ الميلاد',date),document_reference:maskedReference(d.document_reference)};
  }
  if(option==='dependant_remove'){
    v.object(d,['dependant_id','reason','effective_date']);
    const dep=benefits.activeDependant(db,u.tenant_id,u.id,d.dependant_id);
    if(!dep)fail(400,'dependant','اختر تابعًا مسجلًا على تأمينك');
    const reason=REMOVAL_REASONS.find(r=>r.key===d.reason);if(!reason)fail(400,'reason','اختر سبب الحذف');
    return {dependant_id:dep.id,dependant_name:dep.relation_name,reason:reason.key,reason_name:reason.name,effective_date:v.date(d.effective_date)};
  }
  if(option==='class_upgrade'){
    v.object(d,['target_tier','consent']);
    if(!availability.tiers.includes(d.target_tier))fail(400,'tier','اختر فئة من فئات وثيقتك غير فئتك الحالية');
    if(d.consent!==true)fail(400,'consent','الترقية على حسابك: وافق على تحمل فرق القسط خصمًا من راتبك بعد اعتماده');
    return {current_tier:availability.current_tier,target_tier:d.target_tier,consent:true};
  }
  if(option==='ticket_claim'){
    v.object(d,['mode','destination','travel_from','travel_to']);
    if(!['ticket','cash'].includes(d.mode))fail(400,'mode','اختر: حجز تذكرة أو قيمتها نقدًا');
    if(d.mode==='cash'&&!availability.cash_equivalent)fail(400,'mode','السياسة المعتمدة لا تجيز صرف القيمة نقدًا');
    const from=v.date(d.travel_from),to=d.travel_to===undefined||d.travel_to===''?'':v.date(d.travel_to);
    if(to&&to<from)fail(400,'date_order','تاريخ العودة بعد تاريخ السفر');
    return {mode:d.mode,destination:v.text(d.destination,'الوجهة',120,2),travel_from:from,travel_to:to};
  }
  if(option==='education_claim'){
    v.object(d,['stage','school','academic_year','invoice_amount']);
    if(!STAGES.includes(d.stage))fail(400,'stage','اختر المرحلة الدراسية');
    if(typeof d.academic_year!=='string'||!/^(\d{4})[-/](\d{4})$/.test(d.academic_year)||Number(d.academic_year.slice(5))!==Number(d.academic_year.slice(0,4))+1)fail(400,'academic_year','العام الدراسي بصيغة 2026-2027');
    return {stage:d.stage,school:v.text(d.school,'اسم المدرسة',160,2),academic_year:d.academic_year.replace('/','-'),invoice_minor:amount(d.invoice_amount,'مبلغ الفاتورة')};
  }
  v.object(d,['purpose','addressee','language']);
  const purpose=LETTER_PURPOSES.find(p=>p.key===d.purpose);if(!purpose)fail(400,'purpose','اختر الغرض من الخطاب');
  if(!['ar','en'].includes(d.language))fail(400,'language','اختر لغة الخطاب');
  return {purpose:purpose.key,purpose_name:purpose.name,addressee:v.text(d.addressee,'الجهة الموجه إليها',180,2),language:d.language};
}
export function submitBenefitRequest(db,supplied,input){
  writing(db);const u=actor(db,supplied),date=today();
  v.object(input,['option','details','document']);
  const option=OPTION[input.option];if(!option)fail(400,'option','اختر خيارًا من خيارات طلب المزايا');
  if(u.role==='admin')fail(403,'forbidden','حساب إدارة المنصة لا يقدم طلبات مزايا');
  const facts=factsOf(db,u.tenant_id,u.id),coverage=benefits.coverageOf(db,u,u.id);
  const availability=optionAvailability(db,u,u.id,facts,coverage,date).find(o=>o.key===option.key);
  // الموقوفة بمفتاح الإعدادات تُرفض رفضًا مكتوبًا يسمّي من يعيد تفعيلها، لا برسالة سبب وحدها:
  // هذا هو الباب الذي يصطدم به الموظف إن فتح رابطًا قديمًا (‎#my-benefits/new?option=ticket_claim‎).
  if(availability.switched_off)refuseHidden(db,u.tenant_id,'benefit',option.benefit,option.name);
  // إضافة التابع وحذفه وخطاب المزايا تعمل على التسجيل القائم ولا تنتظر اعتماد الكتالوج؛ ما فيه مال ينتظره.
  if(!availability.available)fail(409,option.finance&&!acceptedBenefit(db,u.tenant_id,option.benefit)?'benefit_not_accepted':'option_unavailable',availability.reason);
  const details=optionDetails(db,u,option.key,input,facts,availability,date);
  if(option.documents_required&&!input.document)fail(400,'document_required',`أرفق ${option.documents[0].replace(' (مطلوب)','')}`);
  if(input.document!==undefined)v.object(input.document,['filename','content','label']);
  // الخطاب يُولَّد لا يُسجَّل: طلب خطاب حقيقي باسم الموظف نفسه في وحدة الخطابات، بقالبها المعتمد وفصل الإعداد عن الإصدار،
  // فيصل الموظف مستند بالرقم المرجعي ورمز التحقق QR. يُفتح قبل صف الطلب لأن التفاصيل مجمّدة بقادح المخطط بعد الإدراج.
  if(option.key===LETTER_TYPE_CODE&&availability.letter_ready){
    const opened=requestLetter(db,u,{type_code:LETTER_TYPE_CODE,addressee_kind:'other',addressee:details.addressee,purpose:details.purpose_name,
      language:details.language,delivery:'digital',copies:1});
    details.letter_request_id=opened.id;
  }
  const catalog=option.benefit?acceptedBenefit(db,u.tenant_id,option.benefit):null;
  const year=date.slice(0,4),n=db.prepare("SELECT COUNT(*) AS n FROM benefit_requests WHERE tenant_id=? AND reference LIKE ?").get(u.tenant_id,`BEN-${year}-%`).n+1;
  const requestId=id(),reference=`BEN-${year}-${String(n).padStart(4,'0')}`,time=now();
  db.prepare("INSERT INTO benefit_requests(id,tenant_id,reference,employee_id,option,catalog_id,details,needs_finance,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending_hr',?,?)")
    .run(requestId,u.tenant_id,reference,u.id,option.key,catalog?.id??null,JSON.stringify(details),option.finance?1:0,time,time);
  if(input.document)storeDocument(db,u,{kind:'request',ownerId:requestId,employeeId:u.id,label:input.document.label||option.documents[0]?.replace(' (مطلوب)','')||'مستند الطلب',filename:input.document.filename,content:input.document.content});
  // سجل التدقيق يحمل الخيار والمرجع فقط؛ تاريخ ميلاد التابع وصلته لا يدخلانه.
  audit(db,u,'benefit_request',requestId,'benefit_request.submitted',{}, {option:option.key,reference});
  notify(db,u.id,'benefit_request',requestId,'benefit_submitted',`استلمنا طلبك «${option.name}» ${reference}`,'الحالة: بانتظار الموارد البشرية. ستصلك رسالة عند كل قرار.');
  for(const person of holdersOf(db,u.tenant_id,CAP.manage,[u.id]))
    notify(db,person,'benefit_review',requestId,'benefit_review_needed',`طلب مزايا ينتظر قرارك: «${option.name}» ${reference}`,'افتح «إدارة المزايا» لاعتماده أو رفضه.');
  return {id:requestId,reference};
}
function requestRecord(db,u,requestId){
  const r=typeof requestId==='string'&&db.prepare('SELECT * FROM benefit_requests WHERE id=? AND tenant_id=?').get(requestId,u.tenant_id);
  if(!r)fail(404,'not_found','الطلب غير متاح');
  return r;
}
export function withdrawBenefitRequest(db,supplied,requestId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version']);
  const r=requestRecord(db,u,requestId);
  if(r.employee_id!==u.id)fail(404,'not_found','الطلب غير متاح');
  v.version(input.version,r.version);
  // D-14: الرفض يسمّي الحالة والسبب والمتاح بدل «الإجراء غير متاح».
  if(!['pending_hr','pending_finance'].includes(r.status))v.actionUnavailable('withdraw_request',{subject:`الطلب ${r.reference}`,state_name:REQUEST_STATUS[r.status],
    reason:'السحب قبل صدور القرار النهائي فقط',available:[],names:{withdraw_request:'سحب الطلب'},
    who:r.status==='completed'?'ما اكتمل لا يُسحب؛ لتغييره قدّم طلبًا جديدًا':null});
  db.prepare("UPDATE benefit_requests SET status='withdrawn',version=version+1,updated_at=? WHERE id=?").run(now(),r.id);
  audit(db,u,'benefit_request',r.id,'benefit_request.withdrawn',{status:r.status},{status:'withdrawn'});
  return {id:r.id,version:r.version+1};
}

// ── قرار الموارد البشرية ثم المالية ─────────────────────────────────────────
export function hrDecision(db,supplied,requestId,decision,input){
  writing(db);const u=actor(db,supplied),date=today();
  if(!u.caps.manage)fail(403,'not_permitted','قرار طلب المزايا لحامل تصريح التأمين الطبي والمزايا');
  if(!['approve','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  const r=requestRecord(db,u,requestId);
  if(r.employee_id===u.id)fail(409,'separation_of_duties','لا يقرر مسؤول المزايا في طلبه هو؛ يقرره مسؤول آخر');
  if(r.status!=='pending_hr')v.actionUnavailable(`hr_${decision}`,{subject:`الطلب ${r.reference}`,state_name:REQUEST_STATUS[r.status],
    reason:'خطوة الموارد البشرية مرّت أو لم يعد الطلب قائمًا',available:r.status==='pending_finance'?['finance_approve','finance_reject']:[],
    names:{hr_approve:'اعتماد الموارد البشرية',hr_reject:'رفض الموارد البشرية',finance_approve:'التأكيد المالي',finance_reject:'الرفض المالي'},
    who:r.status==='pending_finance'?'بقي التأكيد المالي لحامل تصريح التأكيد المالي لمطالبات المزايا (benefits.finance.confirm)':null});
  const option=OPTION[r.option],details=JSON.parse(r.details),time=now();
  if(decision==='reject'){
    v.object(input,['version','note']);v.version(input.version,r.version);
    const note=v.text(input.note,'سبب الرفض',1000,5);
    db.prepare("UPDATE benefit_requests SET status='rejected',hr_by=?,hr_at=?,hr_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,time,r.id);
    audit(db,u,'benefit_request',r.id,'benefit_request.hr_rejected',{status:r.status},{status:'rejected'});
    notify(db,r.employee_id,'benefit_request',r.id,'benefit_rejected',`رُفض طلبك «${option.name}» ${r.reference}`,'الحالة: مرفوض. السبب مكتوب في «مزاياي».');
    return {id:r.id,status:'rejected'};
  }
  // خطاب صار طلبًا في وحدة الخطابات لا يُسأل عن مرجع يدوي: مرجعه يأتي من الخطاب الصادر هناك.
  const fields={dependant_add:['added_on'],dependant_remove:['removed_on'],class_upgrade:['amount'],ticket_claim:['travel_class','amount'],education_claim:['amount'],
    benefit_letter:details.letter_request_id?[]:['letter_reference']}[r.option];
  v.object(input,['version','note',...fields]);v.version(input.version,r.version);
  const note=input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة القرار',1000,0);
  let hr={},outcome={},amountMinor=null;
  if(r.option==='dependant_add'){
    const added=pastDate(input.added_on,'تاريخ الإضافة لدى شركة التأمين',date);
    if(added<details.birth_date)fail(400,'date_order','تاريخ الإضافة قبل تاريخ الميلاد');
    // التطبيق في benefits.mjs: التسجيل من صاحب الطلب، والفصل بين المسؤول وصاحب التسجيل مفروض هناك وفي المخطط.
    const added_dependant=benefits.applyDependantAddition(db,u,r.employee_id,{relation:details.relation,birth_date:details.birth_date,added_on:added});
    hr={added_on:added};outcome={dependant_id:added_dependant.id};
  }else if(r.option==='dependant_remove'){
    const removed=pastDate(input.removed_on,'تاريخ الحذف لدى شركة التأمين',date);
    benefits.applyDependantRemoval(db,u,r.employee_id,details.dependant_id,removed);
    hr={removed_on:removed};outcome={dependant_id:details.dependant_id};
  }else if(r.option==='class_upgrade'){
    amountMinor=amount(input.amount,'فرق القسط');hr={tier:details.target_tier};
  }else if(r.option==='ticket_claim'){
    const cls=TICKET_CLASSES.find(c=>c.key===input.travel_class);if(!cls)fail(400,'travel_class','اختر الدرجة المستحقة بحسب م41');
    amountMinor=amount(input.amount,details.mode==='cash'?'قيمة التذكرة نقدًا':'تكلفة التذكرة');hr={travel_class:cls.key,travel_class_name:cls.name};
  }else if(r.option==='education_claim'){
    amountMinor=amount(input.amount,'المبلغ المعتمد');
    if(amountMinor>details.invoice_minor)fail(400,'amount_over_invoice','المبلغ المعتمد لا يزيد على مبلغ الفاتورة');
  }else if(details.letter_request_id){
    hr={letter_request_id:details.letter_request_id};outcome={letter_request_id:details.letter_request_id};
  }else{
    hr={letter_reference:v.text(input.letter_reference,'مرجع الخطاب',120,2)};
  }
  const next=option.finance?'pending_finance':'completed';
  db.prepare('UPDATE benefit_requests SET status=?,hr_by=?,hr_at=?,hr_note=?,hr_details=?,amount_minor=?,outcome=?,version=version+1,updated_at=? WHERE id=?')
    .run(next,u.id,time,note,JSON.stringify(hr),amountMinor,JSON.stringify(outcome),time,r.id);
  audit(db,u,'benefit_request',r.id,'benefit_request.hr_approved',{status:r.status},{status:next});
  if(next==='completed'){
    // D-04: كان الإشعار يقول «الخطاب مرفق» في مسار لا يُنشئ خطابًا ولا مرفقًا. لا يُقال «موجود» إلا لما وُجد فعلًا:
    // إما طلب خطاب حقيقي في وحدة الخطابات، وإما مرفق مرفوع على الطلب، وإلا فمرجع سجّلته الموارد البشرية ويُسلَّم خارج المنصة.
    const attached=r.option==='benefit_letter'&&!details.letter_request_id?documentsOf(db,u.tenant_id,'request',r.id).length:0;
    notify(db,r.employee_id,'benefit_request',r.id,'benefit_completed',`اكتمل طلبك «${option.name}» ${r.reference}`,
      r.option==='benefit_letter'
        ?(details.letter_request_id?'الحالة: مكتمل. خطابك يُعَدّ الآن في «خطاباتي»، ويصلك إشعار عند صدوره برقمه المرجعي ورمز التحقق.'
          :attached?'الحالة: مكتمل. الخطاب مرفق بطلبك في «مزاياي»؛ حمّله من صفحة الطلب.'
          :`الحالة: مكتمل. لم يصدر من المنصة مستند لهذا الخطاب لأن نوع «خطاب بالمزايا» بلا قالب معتمد بعد؛ سجّلت الموارد البشرية مرجعه (${hr.letter_reference}) ويُسلَّم إليك خارج المنصة. اطلبه من فريق الموارد البشرية.`)
        :'الحالة: مكتمل. سُجّل التغيير كما أجرته الموارد البشرية لدى شركة التأمين.');
  }else{
    notify(db,r.employee_id,'benefit_request',r.id,'benefit_progress',`اجتاز طلبك «${option.name}» ${r.reference} مراجعة الموارد البشرية`,'الحالة: بانتظار التأكيد المالي.');
    for(const person of holdersOf(db,u.tenant_id,CAP.finance,[r.employee_id,u.id]))
      notify(db,person,'benefit_review',r.id,'benefit_finance_needed',`طلب مزايا ينتظر التأكيد المالي: «${option.name}» ${r.reference}`,'افتح «إدارة المزايا» لتأكيد المبلغ مقترحًا أو رفضه.');
  }
  return {id:r.id,status:next};
}
export function financeDecision(db,supplied,requestId,decision,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.finance)fail(403,'not_permitted','التأكيد المالي لحامل تصريح التأكيد المالي لمطالبات المزايا');
  if(!['approve','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','note']);
  const r=requestRecord(db,u,requestId);v.version(input.version,r.version);
  if(r.employee_id===u.id)fail(409,'separation_of_duties','لا يؤكد صاحب الطلب طلبه');
  if(r.hr_by===u.id)fail(409,'separation_of_duties','من قرر في الموارد البشرية لا يؤكد ماليًا؛ يؤكده شخص آخر');
  if(r.status!=='pending_finance')v.actionUnavailable(`finance_${decision}`,{subject:`الطلب ${r.reference}`,state_name:REQUEST_STATUS[r.status],
    reason:'الطلب ليس عند الخطوة المالية',available:r.status==='pending_hr'?['hr_approve','hr_reject']:[],
    names:{finance_approve:'التأكيد المالي',finance_reject:'الرفض المالي',hr_approve:'اعتماد الموارد البشرية',hr_reject:'رفض الموارد البشرية'},
    who:r.status==='pending_hr'?'يقرر فيه أولًا حامل تصريح التأمين الطبي ومزايا الموظفين (hr.benefits.manage)':null});
  const option=OPTION[r.option],details=JSON.parse(r.details),time=now();
  if(decision==='reject'){
    const note=v.text(input.note,'سبب الرفض',1000,5);
    db.prepare("UPDATE benefit_requests SET status='rejected',finance_by=?,finance_at=?,finance_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,time,r.id);
    audit(db,u,'benefit_request',r.id,'benefit_request.finance_rejected',{status:r.status},{status:'rejected'});
    notify(db,r.employee_id,'benefit_request',r.id,'benefit_rejected',`رُفض طلبك «${option.name}» ${r.reference}`,'الحالة: مرفوض في التأكيد المالي. السبب مكتوب في «مزاياي».');
    return {id:r.id,status:'rejected'};
  }
  const note=input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة التأكيد',1000,0);
  const target=r.option==='class_upgrade'?'payroll_deduction':r.option==='ticket_claim'&&details.mode==='ticket'?'company_expense':'payroll_addition';
  // ترقية الفئة تُكتب في سجل التأمين نفسه هنا، لا في نص الطلب وحده: بعد اعتماد الموارد البشرية وتأكيد المالية
  // تصبح فئة التسجيل هي الفئة الجديدة، بقيد تدقيق. تبليغ شركة التأمين يبقى خارج المنصة (benefits.mjs CONNECTION_NOTE).
  let upgrade=null;
  if(r.option==='class_upgrade')upgrade=benefits.applyClassUpgrade(db,u,r.employee_id,details.target_tier,
    {reason:`ترقية فئة التأمين على حساب الموظف بعد اعتماد الموارد البشرية وتأكيد المالية — طلب المزايا ${r.reference}`,reference:r.reference});
  db.prepare("UPDATE benefit_requests SET status='completed',finance_by=?,finance_at=?,finance_note=?,outcome=?,version=version+1,updated_at=? WHERE id=?")
    .run(u.id,time,note,JSON.stringify(upgrade?{...JSON.parse(r.outcome),enrolment_id:upgrade.enrolment_id,from_tier:upgrade.from_tier,tier:upgrade.tier}:JSON.parse(r.outcome)),time,r.id);
  const proposalId=id();
  // المال مقترح فقط: الحالة الوحيدة المسموحة عند الإنشاء «proposed» (قادح في المخطط)، ولا حالة «صُرف» في الجدول.
  db.prepare("INSERT INTO benefit_payout_proposals(id,tenant_id,request_id,employee_id,target,amount_minor,status,proposed_by,created_at) VALUES(?,?,?,?,?,?,'proposed',?,?)")
    .run(proposalId,u.tenant_id,r.id,r.employee_id,target,r.amount_minor,u.id,time);
  audit(db,u,'benefit_request',r.id,'benefit_request.finance_confirmed',{status:r.status},{status:'completed',proposal_id:proposalId,target});
  notify(db,r.employee_id,'benefit_request',r.id,'benefit_completed',`اكتمل طلبك «${option.name}» ${r.reference}`,target==='payroll_deduction'?'الحالة: مكتمل. فرق القسط مقترح خصمًا في المسير ولم يُخصم بعد.'
    // D-08: «مقترح على المالية ولم يُنفذ بعد» كانت نهاية المسار بلا خطوة ولا مالك. الخطوة التالية ومالكها مذكوران الآن.
    :target==='company_expense'?`الحالة: مكتمل ماليًا. بقي حجز التذكرة لدى وكيل السفر وتسجيل مرجعه، ويتولاه ${BOOKING_OWNER_NAME}. يصلك إشعار بالمرجع عند الحجز.`
    :'الحالة: مكتمل. المبلغ مقترح للمسير ولم يُصرف بعد.');
  if(upgrade)notify(db,r.employee_id,'benefit_request',r.id,'benefit_class_upgraded',`سُجّلت ترقية فئة تأمينك إلى ${upgrade.tier}`,
    `تغيّرت فئتك في سجل التأمين من ${upgrade.from_tier} إلى ${upgrade.tier}. تبليغ شركة التأمين يجري لديها خارج المنصة، ويتولاه فريق المزايا.`);
  if(target!=='company_expense')for(const person of holdersOf(db,u.tenant_id,CAP.payroll,[r.employee_id]))
    notify(db,person,'benefit_review',r.id,'benefit_payout_proposed',`مقترح من المزايا بانتظار إدراجه في حركات الرواتب: ${r.reference}`,'افتح «إدارة المزايا» لتسليمه إلى حركات الرواتب مقترحًا.');
  // D-08: حجز التذكرة لم يكن يصل أحدًا. مالك الخطوة يُبلَّغ بها كما يُبلَّغ مُعد الرواتب بمقترحه.
  else for(const person of holdersOf(db,u.tenant_id,CAP.manage,[r.employee_id]))
    notify(db,person,'benefit_review',r.id,'benefit_booking_needed',`تذكرة بانتظار الحجز وتسجيل مرجعه: ${r.reference}`,'أُكد المبلغ ماليًا. احجز التذكرة لدى وكيل السفر ثم سجّل مرجع الحجز من «إدارة المزايا».');
  return {id:r.id,status:'completed',proposal_id:proposalId};
}
// D-08: الخطوة التالية لمقترح «حجز التذكرة». لا مال يُصرف هنا ولا حجز يجري: المنصة تسجّل مرجع حجز تمّ خارجها فيُقفل المسار،
// ويصل الموظف المرجع الذي يسافر به. صاحب الطلب لا يسجّل حجز نفسه (قيد في المخطط أيضًا).
export function recordTicketBooking(db,supplied,proposalId,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.manage)fail(403,'not_permitted',`تسجيل مرجع حجز التذكرة لحامل تصريح التأمين الطبي ومزايا الموظفين (${BOOKING_OWNER_CAP})`);
  v.object(input,['version','reference','booked_on','note']);
  const p=typeof proposalId==='string'&&db.prepare('SELECT * FROM benefit_payout_proposals WHERE id=? AND tenant_id=?').get(proposalId,u.tenant_id);
  if(!p)fail(404,'not_found','المقترح غير متاح');
  v.version(input.version,p.version);
  const r=db.prepare('SELECT reference,option FROM benefit_requests WHERE id=?').get(p.request_id);
  if(p.target!=='company_expense')v.actionUnavailable('record_booking',{subject:`المقترح ${r.reference}`,state_name:TARGET_NAMES[p.target],
    reason:'تسجيل مرجع الحجز لمقترح حجز تذكرة وحده؛ هذا المقترح حركة في المسير',available:['hand_to_payroll'],
    names:{record_booking:'تسجيل مرجع الحجز',hand_to_payroll:'التسليم إلى حركات الرواتب'},who:'يسلّمه مُعد الرواتب (payroll.prepare)'});
  if(p.employee_id===u.id)fail(409,'separation_of_duties','لا يسجّل صاحب الطلب مرجع حجز تذكرته');
  if(db.prepare('SELECT 1 FROM benefit_ticket_bookings WHERE proposal_id=?').get(p.id))fail(409,'already_booked','سُجل مرجع الحجز لهذا المقترح مسبقًا');
  const booked=pastDate(input.booked_on,'تاريخ الحجز'),reference=v.text(input.reference,'مرجع الحجز لدى وكيل السفر',120,3);
  const note=input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة الحجز',1000,0);
  db.prepare('INSERT INTO benefit_ticket_bookings(proposal_id,tenant_id,request_id,employee_id,reference,booked_on,note,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(p.id,u.tenant_id,p.request_id,p.employee_id,reference,booked,note,u.id,now());
  audit(db,u,'benefit_payout',p.id,'benefit_payout.booking_recorded',{}, {request_reference:r.reference,booked_on:booked});
  notify(db,p.employee_id,'benefit_request',p.request_id,'benefit_ticket_booked',`حُجزت تذكرتك في الطلب ${r.reference}`,
    `مرجع الحجز لدى وكيل السفر: ${reference} بتاريخ ${dayName(booked)}. تفاصيله في «مزاياي».`);
  return {proposal_id:p.id,reference,booked_on:booked};
}
// تسليم المقترح إلى حركات الرواتب: حركة «مقترحة» في payroll-extras يعتمدها معتمد الرواتب هناك. لا اعتماد ولا صرف هنا.
export function handToPayroll(db,supplied,proposalId,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.payroll)fail(403,'not_permitted','التسليم إلى حركات الرواتب لمُعد الرواتب');
  v.object(input,['version','month']);
  const p=typeof proposalId==='string'&&db.prepare('SELECT * FROM benefit_payout_proposals WHERE id=? AND tenant_id=?').get(proposalId,u.tenant_id);
  if(!p)fail(404,'not_found','المقترح غير متاح');
  v.version(input.version,p.version);
  const r=db.prepare('SELECT reference,option FROM benefit_requests WHERE id=?').get(p.request_id);
  if(p.status!=='proposed')v.actionUnavailable('hand_to_payroll',{subject:`المقترح ${r.reference}`,state_name:PROPOSAL_STATUS[p.status],
    reason:'المقترح يُسلَّم أو يُسحب مرة واحدة',available:[],names:{hand_to_payroll:'التسليم إلى حركات الرواتب'},
    who:p.payroll_adjustment_id?'الحركة المقترحة في «حركات الرواتب» يعتمدها معتمد الرواتب هناك':null});
  // D-08: الرفض صحيح، لكنه كان نهاية الطريق. يسمّي الآن الخطوة التالية الحقيقية ومالكها.
  if(p.target==='company_expense')v.actionUnavailable('hand_to_payroll',{subject:`المقترح ${r.reference}`,state_name:TARGET_NAMES[p.target],
    reason:'حجز التذكرة مصروف على الشركة لا حركة في المسير، فلا يمر بحركات الرواتب',
    available:db.prepare('SELECT 1 FROM benefit_ticket_bookings WHERE proposal_id=?').get(p.id)?[]:['record_booking'],
    names:{hand_to_payroll:'التسليم إلى حركات الرواتب',record_booking:'تسجيل مرجع حجز التذكرة'},
    who:`الحجز يجري لدى وكيل السفر خارج المنصة ويسجّل مرجعه ${BOOKING_OWNER_NAME}`,code:'not_payroll'});
  const adjustment=proposeAdjustment(db,u,{user_id:p.employee_id,kind:p.target==='payroll_deduction'?'deduction':'allowance',month:input.month,amount:minorToAmount(p.amount_minor),
    reason:`${OPTION[r.option].name} — طلب المزايا ${r.reference} بعد تأكيد المالية`});
  db.prepare("UPDATE benefit_payout_proposals SET status='handed_to_payroll',payroll_adjustment_id=?,handed_by=?,handed_at=?,version=version+1 WHERE id=?").run(adjustment.id,u.id,now(),p.id);
  audit(db,u,'benefit_payout',p.id,'benefit_payout.handed_to_payroll',{status:'proposed'},{status:'handed_to_payroll',payroll_adjustment_id:adjustment.id});
  return {id:p.id,payroll_adjustment_id:adjustment.id};
}

// ── المستندات ─────────────────────────────────────────────────────────────
export function uploadBenefitDocument(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['owner_kind','owner_id','label','filename','content']);
  if(input.owner_kind==='request'){
    const r=requestRecord(db,u,input.owner_id),own=r.employee_id===u.id;
    const allowed=own?r.status==='pending_hr':u.caps.manage&&!['withdrawn','rejected'].includes(r.status);
    if(!allowed)fail(own||u.caps.manage?409:404,own||u.caps.manage?'action_unavailable':'not_found',own||u.caps.manage?'رفع المستندات غير متاح في حالة الطلب':'الطلب غير متاح');
    return {id:storeDocument(db,u,{kind:'request',ownerId:r.id,employeeId:r.employee_id,label:input.label,filename:input.filename,content:input.content})};
  }
  if(input.owner_kind==='enrolment'){
    const owner=benefits.enrolmentOwner(db,u.tenant_id,input.owner_id);
    if(!owner||!u.caps.manage)fail(404,'not_found','التسجيل غير متاح');
    if(owner===u.id)fail(409,'separation_of_duties','لا يرفع مسؤول المزايا بطاقة تأمينه هو');
    return {id:storeDocument(db,u,{kind:'enrolment',ownerId:input.owner_id,employeeId:owner,label:input.label,filename:input.filename,content:input.content})};
  }
  fail(400,'owner_kind','نوع السجل غير صالح');
}
export function downloadBenefitDocument(db,supplied,documentId){
  const u=actor(db,supplied);
  const d=typeof documentId==='string'&&db.prepare('SELECT * FROM benefit_documents WHERE id=? AND tenant_id=?').get(documentId,u.tenant_id);
  if(!d)fail(404,'not_found','المستند غير متاح');
  let ok=d.employee_id===u.id||u.caps.manage;
  if(!ok&&d.owner_kind==='request'){const r=db.prepare('SELECT * FROM benefit_requests WHERE id=?').get(d.owner_id);ok=!!r&&documentsVisible(u,r);}
  if(!ok)fail(404,'not_found','المستند غير متاح');
  if(hash(Buffer.from(d.content))!==d.digest)fail(409,'file_corrupted','بصمة الملف لا تطابق محتواه');
  audit(db,u,'benefit_document',d.id,'benefit_document.downloaded',{}, {owner_kind:d.owner_kind});
  return {filename:d.filename,media_type:d.media_type,content:Buffer.from(d.content)};
}

// ── إدارة الكتالوج: اقتراح ثم اعتماد من شخص آخر ────────────────────────────────
const RULE_KEYS=['min_tenure_months','past_probation','nationality','gender','contract_types','employment_types','grades','event','contract_clause'];
function rulesInput(r){
  if(!r||typeof r!=='object'||Array.isArray(r))fail(400,'rules','قواعد الأهلية غير صالحة');
  v.object(r,RULE_KEYS);const out={};
  if(r.min_tenure_months!==undefined&&r.min_tenure_months!==null&&r.min_tenure_months!==0){if(!Number.isInteger(r.min_tenure_months)||r.min_tenure_months<0||r.min_tenure_months>120)fail(400,'min_tenure_months','مدة الخدمة بالأشهر من 0 إلى 120');out.min_tenure_months=r.min_tenure_months;}
  if(r.past_probation===true)out.past_probation=true;
  if(r.contract_clause===true)out.contract_clause=true;
  if(r.nationality){if(!['saudi','non_saudi'].includes(r.nationality))fail(400,'nationality','الجنسية: سعودي أو غير سعودي');out.nationality=r.nationality;}
  if(r.gender){if(!['female','male'].includes(r.gender))fail(400,'gender','الجنس غير صالح');out.gender=r.gender;}
  if(r.event){if(!EVENTS[r.event])fail(400,'event','الحدث غير معروف');out.event=r.event;}
  for(const [key,allowed] of [['contract_types',Object.keys(CONTRACT_TYPE_NAMES)],['employment_types',['full_time','part_time','contract','intern']]])
    if(Array.isArray(r[key])&&r[key].length){if(r[key].some(x=>!allowed.includes(x)))fail(400,key,'قيمة غير صالحة في قواعد الأهلية');out[key]=[...new Set(r[key])];}
  if(Array.isArray(r.grades)&&r.grades.length)out.grades=r.grades.map(g=>v.text(g,'الدرجة',40,1));
  return out;
}
function valueInput(basis,p,template){
  if(!VALUE_BASIS_NAMES[basis])fail(400,'value_basis','أساس القيمة غير صالح');
  if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'value_params','معاملات القيمة غير صالحة');
  const keep=JSON.parse(template.value_params),out={};
  if(basis==='percent_of_basic'){if(typeof p.percent!=='number'||p.percent<=0||p.percent>100)fail(400,'percent','النسبة من 1 إلى 100');out.percent=p.percent;}
  if(basis==='months_of_basic'){if(!Number.isInteger(p.months)||p.months<1||p.months>24)fail(400,'months','الأشهر من 1 إلى 24');out.months=p.months;}
  if(basis==='fixed')out.amount_minor=amount(p.amount,'المبلغ');
  if(p.text!==undefined&&p.text!=='')out.text=v.text(p.text,'نص القيمة',600,3);
  if(keep.component)out.component=keep.component;
  if(keep.classes)out.classes=keep.classes;
  if(template.benefit_key==='medical_insurance')out.upgrade_at_employee_cost=p.upgrade_at_employee_cost===true;
  if(template.benefit_key==='air_ticket')out.cash_equivalent=p.cash_equivalent!==false;
  if(keep.advance_after_probation!==undefined)out.advance_after_probation=keep.advance_after_probation;
  if(['policy','informational'].includes(basis)&&!out.text&&!out.classes)fail(400,'text','اكتب نص القيمة كما في السياسة');
  return out;
}
export function proposeBenefit(db,supplied,benefitKey,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.prepare&&!u.caps.manage)fail(403,'not_permitted','اقتراح المزايا لمُعد سياسات الموارد البشرية أو مسؤول المزايا');
  const template=typeof benefitKey==='string'&&db.prepare('SELECT * FROM benefit_templates WHERE benefit_key=?').get(benefitKey);
  if(!template)fail(404,'not_found','الميزة غير معروفة');
  v.object(input,['version','name','summary','source_kind','article','source_note','rules','value_basis','value_params','frequency','claim_method','documents','change_note']);
  if(!['regulation','needs_matrix'].includes(input.source_kind))fail(400,'source_kind','المصدر: مادة في اللائحة أو مصفوفة المزايا');
  const article=input.article===undefined?'':String(input.article).trim();
  if(input.source_kind==='regulation'&&article.length<2)fail(400,'article','اذكر رقم المادة');
  if(article.length>80)fail(400,'article','رقم المادة طويل');
  if(!FREQUENCY_NAMES[input.frequency])fail(400,'frequency','التكرار غير صالح');
  if(!CLAIM_NAMES[input.claim_method])fail(400,'claim_method','طريقة الاستحقاق غير صالحة');
  if(!Array.isArray(input.documents)||input.documents.length>10)fail(400,'documents','المستندات المطلوبة حتى 10');
  const values={name:v.text(input.name,'اسم الميزة',120,3),summary:v.text(input.summary,'وصف الميزة',600,10),source_kind:input.source_kind,article,
    source_note:v.text(input.source_note,'نص المصدر',3000,10),rules:JSON.stringify(rulesInput(input.rules)),value_basis:input.value_basis,
    value_params:JSON.stringify(valueInput(input.value_basis,input.value_params,template)),frequency:input.frequency,claim_method:input.claim_method,
    documents:JSON.stringify(input.documents.map(d=>v.text(d,'المستند',200,3))),change_note:v.text(input.change_note,'سبب التعديل ومصدره',1000,10)};
  const draft=db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id=? AND benefit_key=? AND status='draft'").get(u.tenant_id,template.benefit_key),time=now();
  let rowId;
  if(draft){
    v.version(input.version,draft.version);
    db.prepare('UPDATE benefit_catalog SET name=?,summary=?,source_kind=?,article=?,source_note=?,rules=?,value_basis=?,value_params=?,frequency=?,claim_method=?,documents=?,change_note=?,proposed_by=?,version=version+1,updated_at=? WHERE id=?')
      .run(values.name,values.summary,values.source_kind,values.article,values.source_note,values.rules,values.value_basis,values.value_params,values.frequency,values.claim_method,values.documents,values.change_note,u.id,time,draft.id);
    rowId=draft.id;
  }else{
    const base=db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id=? AND benefit_key=? ORDER BY revision DESC LIMIT 1").get(u.tenant_id,template.benefit_key);
    rowId=id();
    db.prepare("INSERT INTO benefit_catalog(id,tenant_id,benefit_key,revision,sort_order,category,name,summary,source_kind,article,source_note,rules,value_basis,value_params,frequency,claim_method,request_option,documents,status,proposed_by,change_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?)")
      .run(rowId,u.tenant_id,template.benefit_key,(base?.revision??0)+1,template.sort_order,template.category,values.name,values.summary,values.source_kind,values.article,values.source_note,values.rules,values.value_basis,values.value_params,values.frequency,values.claim_method,template.request_option,values.documents,u.id,values.change_note,time,time);
  }
  audit(db,u,'benefit_catalog',rowId,'benefit_catalog.proposed',{}, {benefit_key:template.benefit_key},values.change_note);
  for(const person of holdersOf(db,u.tenant_id,CAP.accept,[u.id]))
    notify(db,person,'benefit_catalog',rowId,'benefit_catalog_proposed',`ميزة مقترحة تنتظر اعتمادك: «${values.name}»`,'افتح «إدارة المزايا» لاعتمادها أو رفضها. من اقترحها لا يعتمدها.');
  return {id:rowId};
}
export function decideBenefit(db,supplied,catalogId,decision,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.accept)fail(403,'not_permitted','اعتماد المزايا لمدير الموارد البشرية (hr.policy.accept)');
  if(!['accept','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,decision==='accept'?['version','effective_from','note']:['version','note']);
  const row=typeof catalogId==='string'&&db.prepare("SELECT * FROM benefit_catalog WHERE id=? AND tenant_id=?").get(catalogId,u.tenant_id);
  if(!row)fail(404,'not_found','الميزة غير متاحة');
  v.version(input.version,row.version);
  if(row.status!=='draft')fail(409,'action_unavailable','صدر القرار في هذه المراجعة');
  if(row.proposed_by===u.id)fail(409,'separation_of_duties','من اقترح الميزة لا يعتمدها؛ يعتمدها شخص آخر');
  const time=now();
  if(decision==='reject'){
    const note=v.text(input.note,'سبب الرفض',1000,5);
    db.prepare("UPDATE benefit_catalog SET status='rejected',decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,time,row.id);
    audit(db,u,'benefit_catalog',row.id,'benefit_catalog.rejected',{status:'draft'},{status:'rejected'},note);
    return {id:row.id,status:'rejected'};
  }
  const effective=v.date(input.effective_from);
  const note=input.note===undefined||input.note===''?'':v.text(input.note,'أساس الاعتماد',1000,0);
  if(row.source_kind!=='regulation'&&note.length<10)fail(400,'decision_note',`${MATRIX_LABEL}: اكتب في أساس الاعتماد مصدر القرار (مصفوفة المزايا المعتمدة أو قرار المالك وتاريخه)`);
  const previous=db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id=? AND benefit_key=? AND status='accepted'").get(u.tenant_id,row.benefit_key);
  if(previous)db.prepare("UPDATE benefit_catalog SET status='retired',version=version+1,updated_at=? WHERE id=?").run(time,previous.id);
  db.prepare("UPDATE benefit_catalog SET status='accepted',decided_by=?,decided_at=?,decision_note=?,effective_from=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,effective,time,row.id);
  audit(db,u,'benefit_catalog',row.id,'benefit_catalog.accepted',{status:'draft',replaces:previous?.id??null},{status:'accepted',effective_from:effective},note);
  return {id:row.id,status:'accepted'};
}

// ── «إدارة المزايا» ──────────────────────────────────────────────────────
export function benefitsAdmin(db,supplied){
  const u=actor(db,supplied),date=today();
  if(!Object.values(u.caps).some(Boolean))fail(403,'not_permitted','هذه الشاشة لفريق المزايا والمالية والرواتب');
  const hrSide=u.caps.manage||u.caps.prepare||u.caps.accept;
  const catalog=hrSide?catalogRows(db,u.tenant_id).map(entry=>{
    // شرط مدة الخدمة على ميزة مصدرها اللائحة اختيار الشركة، ويُقال ذلك في الشاشة التي يُعدَّل منها الشرط
    // نفسه: هنا يقرؤه من يملك تغييره قبل أن يقرر إبقاءه، لا في «مزاياي» وحدها بعد أن صار أمرًا واقعًا.
    const view=row=>row&&{id:row.id,revision:row.revision,name:row.name,summary:row.summary,category_name:CATEGORY_NAMES[row.category],source_kind:row.source_kind,article:row.article,citation:citation(row),
      company_choice:companyChoiceNote(row),
      matrix_label:row.source_kind==='needs_matrix'?MATRIX_LABEL:null,source_note:row.source_note,rules:row.rules,value_basis:row.value_basis,value_basis_name:VALUE_BASIS_NAMES[row.value_basis],value_params:row.value_params,
      value_text:valueText(row,null),frequency:row.frequency,frequency_name:FREQUENCY_NAMES[row.frequency],claim_method:row.claim_method,claim_name:CLAIM_NAMES[row.claim_method],request_option:row.request_option,
      documents:row.documents,status:row.status,status_name:CATALOG_STATUS[row.status],proposed_by_name:row.proposed_by?personName(db,row.proposed_by):'مسودة المنصة من نص اللائحة',change_note:row.change_note,
      decided_by_name:personName(db,row.decided_by),decided_at:row.decided_at,decision_note:row.decision_note,effective_from:row.effective_from,version:row.version,
      actions:row.status==='draft'&&u.caps.accept&&row.proposed_by!==u.id?['accept_benefit','reject_benefit']:[]};
    return {key:entry.key,accepted:view(entry.accepted),draft:view(entry.draft),actions:u.caps.prepare||u.caps.manage?['propose_benefit']:[]};
  }):[];
  // الأهلية عبر الموظفين: حالة لكل ميزة، بلا مبالغ. لفريق الموارد البشرية فقط.
  let matrix=null;
  if(hrSide){
    const entries=catalogRows(db,u.tenant_id).map(e=>e.accepted??e.draft);
    const people=db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id);
    matrix={benefits:entries.map(r=>({key:r.benefit_key,name:r.name,accepted:r.status==='accepted'})),rows:people.map(person=>{
      // التأمين وتابعوه لحامل تصريح المزايا وحده؛ من يعتمد السياسات يرى الأهلية دون حالة التسجيل.
      const facts=factsOf(db,u.tenant_id,person.id),coverage=u.caps.manage?benefits.coverageOf(db,u,person.id):null;
      return {employee_id:person.id,name:person.name,join_date:facts?.join_date??null,cells:Object.fromEntries(entries.map(r=>{
        const card=benefitCard(db,r,facts,coverage,date,{accepted:r.status==='accepted'});
        const short=card.state==='upcoming'?`بعد ${durationText(card.eligibility.wait)}`:STATE_NAMES[card.state];
        return [r.benefit_key,{state:card.state,short,text:card.held_text??card.eligibility.text}];
      }))};
    })};
    if(!u.caps.manage)matrix.rows=matrix.rows.map(r=>({...r,cells:Object.fromEntries(Object.entries(r.cells).map(([k,c])=>[k,{state:c.state,short:c.short}]))}));
  }
  // المالية ترى ما وصلها من طلبات فيها مال فقط: ما ينتظر تأكيدها وما قررت فيه.
  const visible=r=>u.caps.manage||(u.caps.finance&&r.needs_finance===1&&(r.status==='pending_finance'||r.finance_by!==null));
  const rows=db.prepare('SELECT * FROM benefit_requests WHERE tenant_id=? ORDER BY created_at DESC LIMIT 300').all(u.tenant_id).filter(visible).map(r=>requestView(db,u,r,{forAdmin:true}));
  const proposals=u.caps.payroll||u.caps.finance||u.caps.manage?db.prepare('SELECT p.*,r.reference,r.option FROM benefit_payout_proposals p JOIN benefit_requests r ON r.id=p.request_id WHERE p.tenant_id=? ORDER BY p.created_at DESC').all(u.tenant_id).map(p=>({
    id:p.id,reference:p.reference,option_name:OPTION[p.option].name,employee_name:personName(db,p.employee_id),target:p.target,target_name:TARGET_NAMES[p.target],amount_minor:p.amount_minor,status:p.status,status_name:PROPOSAL_STATUS[p.status],
    proposed_by_name:personName(db,p.proposed_by),handed_by_name:personName(db,p.handed_by),payroll_adjustment_id:p.payroll_adjustment_id,version:p.version,created_at:p.created_at,
    ...bookingState(db,p),
    // D-08: لكل مقترح إجراء تالٍ ومالك: حركة المسير لمُعد الرواتب، وحجز التذكرة لحامل تصريح المزايا.
    actions:p.status!=='proposed'||p.employee_id===u.id?[]
      :p.target==='company_expense'?(u.caps.manage&&!db.prepare('SELECT 1 FROM benefit_ticket_bookings WHERE proposal_id=?').get(p.id)?['record_booking']:[])
      :(u.caps.payroll?['hand_to_payroll']:[])})):[];
  const enrolmentCards=u.caps.manage?db.prepare("SELECT e.id,e.employee_id,e.tier,x.name FROM medical_enrolments e JOIN users x ON x.id=e.employee_id WHERE e.tenant_id=? AND e.status<>'removed' ORDER BY x.name").all(u.tenant_id).map(e=>({enrolment_id:e.id,employee_name:e.name,tier:e.tier,cards:documentsOf(db,u.tenant_id,'enrolment',e.id),actions:e.employee_id===u.id?[]:['upload_card']})):[];
  return {today:date,user_id:u.id,permissions:u.caps,catalog,matrix,
    queue:{hr:rows.filter(r=>r.status==='pending_hr'),finance:rows.filter(r=>r.status==='pending_finance'),recent:rows.filter(r=>!['pending_hr','pending_finance'].includes(r.status)).slice(0,40)},
    proposals,enrolment_cards:enrolmentCards,ticket_classes:TICKET_CLASSES,month:date.slice(0,7),
    names:{frequency:FREQUENCY_NAMES,claim:CLAIM_NAMES,value_basis:VALUE_BASIS_NAMES,events:EVENTS,contract_types:CONTRACT_TYPE_NAMES},
    acceptance_owner:'مدير الموارد البشرية (hr.policy.accept) — شخص غير من اقترح الميزة',
    note:`كل ميزة مسودة حتى يعتمدها مدير الموارد البشرية. ما لم تنص عليه اللائحة معلَّم «${MATRIX_LABEL}» لأن المرفق 1 (م70) غير موجود في ملف اللائحة. المطالبات المالية تنتهي بمقترح لا يُصرف: مُعد الرواتب يسلّمه إلى حركات الرواتب مقترحًا يعتمده معتمد الرواتب.`};
}
