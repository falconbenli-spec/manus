import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { normalize } from './arabic-text.mjs';
import { redact } from './pii.mjs';
import { retrieveHybrid, conflictsAmong, embeddingConfig, libraryName, usingStandIn, terms, stem } from './policy-retrieval.mjs';
import { listLeave } from './leave.mjs';
import { myBenefits, factsOf, money } from './benefits-portal.mjs';
import { computePerDiem } from './travel.mjs';
import { acceptedRule, roundMoney, roundingMode, riyadhToday, GRADES } from './payroll-rules.mjs';
import { catalog } from './workflow.mjs';
import { MODULE_SERVICES } from './static/module-services.mjs';
import { serviceCard } from './service-cards.mjs';
import { moduleRouteFor } from './module-routes.mjs';
import { careerProfile } from './career-profile.mjs';
import { growthBoard } from './talent.mjs';

// «اسأل عن السياسة» ودليل الموظف الشخصي. ما يفعله وما لا يفعله:
// • يجيب من نص المنصة وحده (app/policy-retrieval.mjs)، بسطر أو سطرين ثم المواد التي استند إليها باقتباس ورابط.
// • لا يجيب عن شخص آخر أبدًا. المنع في طبقة البيانات لا في التعليمات: كل قراءة شخصية هنا تمر بمعرّف السائل نفسه
//   (u.id) عبر دوال الوحدات بصلاحيته، ولا تقبل أي دالة هنا معرّف موظف آخر. سؤال يسمّي غيره يُرفض قبل أي استرجاع.
// • لا يخترع رقمًا: الحساب يستدعي دالة الوحدة نفسها (computePerDiem)، وإن لم تُقبل السياسة قال أي قرار ينقص.
// • لا يعتمد ولا يصرف ولا يرسل: ناتجه إجابة أو مسودة يراجعها صاحبها، ضمن حدود app/ai.mjs اليومية وسجل تشغيلاته.
// • الراتب والطبي والأسرة والجزاءات تُحجب قبل أي إرسال إلى مزود النموذج، وتعود إلى صاحبها وحده في الناتج.

export const KINDS={policy:'سؤال عن نص',personal:'سؤال عن بياناتك',calculation:'حساب ببياناتك',how_to:'كيف أقدّم طلبًا',eligibility:'أهلية واستحقاق',skills:'تطوير المهارات',other_person:'سؤال عن شخص آخر'};
export const SUGGESTED=['كم مدة إجازة الزواج؟','ما عقوبة التأخر 20 دقيقة للمرة الثانية؟','متى تعتبر الاستقالة مقبولة؟','كيف أطلب تأمين والدي؟','كم بدل الانتداب لمدير إدارة خارج المملكة؟','كم رصيد إجازاتي؟','متى أستحق تذكرة السفر السنوية؟','ما المهارات التي أطورها في دوري الحالي؟'];
const NO_TEXT='لا يوجد نص في سياسات المنصة يجيب عن هذا السؤال. لم أخترع إجابة ولم أستند إلى معرفة عامة بنظام العمل السعودي. اسأل الموارد البشرية من خدمة «الشكاوى والاستفسارات» (HR-GRIEVANCE)، وسؤالك مسجل في قائمة ما لا يجيب عنه النص ليضاف إليه.';
const NO_TEXT_EN='No text in the platform policies answers this question. Nothing was invented and no general knowledge of Saudi labour law was used. Ask HR through the enquiries service (HR-GRIEVANCE); your question is logged so the content can be improved.';
const OTHER_PERSON='أجيب عن بياناتك أنت وحدك. لا أعرض راتب زميل ولا رصيده ولا تقييمه ولو كنت مديره؛ بيانات فريقك تُفتح من شاشاتها بصلاحياتها وبأثر مسجل.';
const DRAFT_NOTE='هذا النص مسودة لم تُعتمد بعد، فلا يُبنى عليه قرار.';

/* ───── أدوات ───── */
const isArabic=text=>/[؀-ۿ]/.test(String(text??''));
export const languageOf=question=>isArabic(question)?'ar':'en';
// لغة الإجابة لغة السؤال. نص المادة نفسه لا يُترجَم: يُقتبس كما اعتُمد، ويُقال ذلك صراحة للسائل بالإنجليزية.
const say=(language,ar,en)=>language==='ar'?ar:en;
const norm=text=>normalize(text);
const roots=text=>new Set(terms(text).map(stem));
const hasAny=(set,words)=>words.some(w=>set.has(stem(normalize(w))));
function actor(db,supplied){const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','مساعد السياسات لحسابات الموظفين');return u;}

// حجب الحقائق الشخصية قبل أي إرسال: الراتب والمبالغ والأرصدة والطبي والأسرة والجزاءات تُستبدل برموز،
// وتعود إلى صاحبها في الناتج بعد عودة المزود (restoreFacts). الخريطة في الذاكرة لمدة الاستدعاء فقط.
export class FactMask{
  constructor(){this.map=new Map();this.counters={};}
  hide(kind,value){const k=kind.toUpperCase();this.counters[k]=(this.counters[k]??0)+1;const token=`[[${k}_${this.counters[k]}]]`;this.map.set(token,String(value));return token;}
  toJSON(){throw new Error('A fact mask is held in memory only and is never serialised.');}
}
export const restoreFacts=(text,map)=>!(map instanceof Map)||!map.size?String(text??''):String(text??'').replace(/\[\[[A-Z]+_\d+\]\]/g,token=>map.has(token)?map.get(token):token);

/* ───── تصنيف السؤال ───── */
// ضمير المتكلم هو ما يفصل «كم رصيد إجازاتي؟» عن «كم مدة إجازة الزواج؟». الفحص على النص المطبّع.
const MINE=/رصيدي|راتبي|اجرتي|اجازاتي|اجازتي|مزاياي|عقدي|ملفي|بدلي|انتدابي|مستحقاتي|تاميني|\bmy\b/;
export function classify(question){
  const words=roots(question),text=norm(question);
  if(hasAny(words,['مهارات','تطوير','مسار','اتعلم','كفاءه'])||/development path|skills/i.test(text))return 'skills';
  if(/كيف|طريقه|اجراءات|how do i|how to/i.test(text)&&hasAny(words,['اطلب','اقدم','طلب','تقديم','اسجل','request','submit']))return 'how_to';
  if(hasAny(words,['بدل'])&&hasAny(words,['انتداب','سفر','ايفاد'])&&(MINE.test(text)||/\d/.test(arabicDigits(text))))return 'calculation';
  // التطبيع يحوّل «متى» إلى «متي»، فالفحص على الصورتين.
  if((/مت[يى]/.test(text)&&(hasAny(words,['استحق','اصير','مؤهل','اهليه','اتاهل'])||/استحق|اهل/.test(text)))||/when.*eligible/i.test(text))return 'eligibility';
  if(MINE.test(text)||((hasAny(words,['رصيد'])||/باقي|متبقي/.test(text))&&!/زميل|الموظف/.test(text)))return 'personal';
  return 'policy';
}

/* ───── الحاجز: سؤال عن شخص آخر ───── */
// يُفحص قبل الاسترجاع وقبل أي قراءة. لا يعتمد على تصريح السائل: المدير يُمنع كما يُمنع غيره.
const PERSONAL_SUBJECT=/راتب|اجر|رصيد|اجاز|تقييم|جزاء|عقوب|تامين|مزاي|salary|balance|appraisal/;
const OTHER_MARKER=/زميل|زميله|فلان|الموظفه الاخري|موظف اخر|شخص اخر|احد الموظفين|فريقي|مرؤوس|colleague|someone else|another employee/;
export function otherPersonNamed(db,u,question){
  const text=norm(question);
  const people=db.prepare("SELECT id,name,username FROM users WHERE tenant_id=? AND id<>? AND role<>'admin'").all(u.tenant_id,u.id);
  // ما يميّز شخصًا بعينه يُقاس من دليل الأسماء نفسه لا من قائمة كلمات: «مدير» و«إدارة» تتكرر في أسماء كثيرة
  // فلا تدل على أحد، والكلمة التي لا ترد إلا في اسم واحد تدل عليه. بهذا لا يُرفض «بدل الانتداب لمدير إدارة».
  const frequency=new Map();
  for(const person of people)for(const word of new Set(norm(person.name).split(' ').filter(w=>w.length>=3)))frequency.set(word,(frequency.get(word)??0)+1);
  const subject=PERSONAL_SUBJECT.test(text);
  // المطابقة بالكلمة كاملة لا بجزء منها: «آخر» في اسم زميل لا تُطابق «التأخر» في سؤال عن الجزاءات.
  const asked=new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  for(const person of people){
    const full=norm(person.name);
    if(full.length>=4&&text.includes(full))return {reason:'named',person:person.id};
    const parts=[...new Set(full.split(' ').filter(w=>w.length>=3))].filter(w=>asked.has(w));
    const unique=parts.filter(w=>frequency.get(w)===1);
    if(parts.length>=2&&unique.length>=1)return {reason:'named',person:person.id};
    if(subject&&unique.some(w=>w.length>=4))return {reason:'named_subject',person:person.id};
    if(person.username.length>=4&&asked.has(norm(person.username)))return {reason:'username',person:person.id};
  }
  if(subject&&OTHER_MARKER.test(text))return {reason:'marker',person:null};
  return null;
}

/* ───── حقائق السائل وحده ───── */
const safe=(run,fallback=null)=>{try{return run();}catch(error){if(!error?.status)throw error;return fallback;}};
function leaveFacts(db,u,mask){
  const board=safe(()=>listLeave(db,u),{balances:[]});
  const mine=(board?.balances??[]).filter(b=>b.employee_id===u.id);
  if(!mine.length)return {lines:[],masked:[],sources:[],empty:'لا رصيد إجازات مسجلًا لك في المنصة بعد. يفتحه فريق الموارد البشرية برصيد افتتاحي.'};
  const lines=mine.map(b=>`${b.leave_type} ${b.balance_year}: المتاح ${b.available_days} يومًا (المرحّل ${b.posted_days}، المحجوز ${b.reserved_days}).`);
  const masked=mine.map(b=>`${b.leave_type} ${b.balance_year}: المتاح ${mask.hide('balance',b.available_days)} يومًا.`);
  return {lines,masked,sources:[{type:'leave_balance',count:mine.length}],empty:null};
}
function payFacts(db,u,mask){
  const facts=factsOf(db,u.tenant_id,u.id);
  if(!facts?.has_contract)return {lines:[],masked:[],sources:[],empty:'لا عقد ساريًا مسجلًا لك في المنصة، فلا بنود راتب تُقرأ. راجع الموارد البشرية.'};
  const total=facts.pay_lines.reduce((n,l)=>n+l.amount_minor,0);
  const lines=facts.pay_lines.map(l=>`${l.component}: ${money(l.amount_minor)} شهريًا.`);
  lines.push(`إجمالي بنود عقدك: ${money(total)} شهريًا، من عقدك الساري منذ ${facts.contract_start}.`);
  // المبلغ نفسه لا يغادر المنصة: يُرسل رمزًا، ويعود إلى صاحبه في الناتج.
  return {lines,masked:[`إجمالي بنود راتبك الشهرية في عقدك الساري: ${mask.hide('salary',money(total))} (${facts.pay_lines.length} بندًا: ${facts.pay_lines.map(l=>l.component).join('، ')}).`],
    sources:[{type:'own_contract',id:u.id,lines:facts.pay_lines.length}],empty:null};
}
function benefitFacts(db,u,question,mask,today){
  const board=safe(()=>myBenefits(db,u),null);
  if(!board)return {cards:[],lines:[],masked:[],sources:[]};
  const words=roots(question);
  const scored=board.benefits.map(c=>({c,hits:[...roots(`${c.name} ${c.summary??''}`)].filter(w=>words.has(w)).length})).filter(x=>x.hits>0).sort((a,b)=>b.hits-a.hits).slice(0,3);
  const cards=scored.map(x=>x.c);
  const lines=cards.map(c=>`${c.name}: ${c.state_name}${c.eligibility?.text?` — ${c.eligibility.text}`:''}${c.accepted===false?` (${DRAFT_NOTE})`:''}${c.citation?` [${c.citation}]`:''}`);
  return {cards,lines,masked:cards.map(c=>`${c.name}: ${c.state_name} — ${mask.hide('family',c.eligibility?.text??c.held_text??'')}`),
    sources:cards.map(c=>({type:'benefit',id:c.benefit_key??c.key,title:c.name,state:c.state})),board,today};
}

/* ───── الحساب: بدل الانتداب بدالة وحدة الانتداب نفسها ───── */
const arabicDigits=text=>String(text).replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x0660));
function perDiemCalculation(db,u,question,today){
  const text=arabicDigits(norm(question));
  const rule=acceptedRule(db,u.tenant_id,'travel_per_diem',today);
  if(!rule)return {blocked:'جدول بدل الانتداب مسودة لم يقبلها مدير الموارد البشرية بعد (hr.policy.accept). لا أحسب بدلًا من قيمة غير معتمدة؛ القرار الناقص هو قبول «الانتداب: البدل اليومي بالدرجة» في «قواعد اللائحة في الرواتب».',link:'#payroll-rules'};
  const scope=/خارج|برا|بره|دولي|abroad/.test(text)?'abroad':'domestic';
  const days=Number((text.match(/(\d{1,3})\s*(?:يوم|ايام|day)/)??text.match(/\b(\d{1,3})\b/)??[,'1'])[1])||1;
  // الدرجة لا تُسجَّل في ملف الموظف في المنصة بعد؛ تُقرأ من آخر قرار انتداب معتمد لصاحب السؤال نفسه إن وُجد.
  const mine=db.prepare("SELECT grade,housing,transport,distance_km,road_type FROM travel_decisions WHERE tenant_id=? AND user_id=? AND status='approved' AND grade IS NOT NULL ORDER BY decided_at DESC LIMIT 1").get(u.tenant_id,u.id);
  const asked=GRADES.find(g=>norm(rule.parameters.grades[g].name).split(' ').every(w=>w.length<3||text.includes(w)));
  const grade=asked??mine?.grade??null;
  const assumptions=[];
  if(!grade)return {blocked:`درجتك في جدول البدل غير مسجلة في المنصة (لا سجل للدرجات الوظيفية بعد)، ولا قرار انتداب معتمد سابق لك أقرأ منه درجتك. يحددها صاحب الصلاحية عند قرار الانتداب، فلا أفترضها. جدول الدرجات المعتمد: ${GRADES.map(g=>`${rule.parameters.grades[g].name} ${money(rule.parameters.grades[g][scope==='abroad'?'abroad_minor':'domestic_minor'])} يوميًا ${scope==='abroad'?'خارج المملكة':'داخلها'}`).join('، ')}.`,link:'#travel',rule};
  if(asked&&mine?.grade&&asked!==mine.grade)assumptions.push('الدرجة المحسوبة هي التي ورد ذكرها في سؤالك، لا الدرجة في قرارك السابق.');
  if(!asked&&mine)assumptions.push(`الدرجة من آخر قرار انتداب معتمد لك (${rule.parameters.grades[grade].name}).`);
  const housing=mine?.housing??'none',transport=mine?.transport??'none';
  if(!mine)assumptions.push('بافتراض ألا توفر المنشأة سكنًا ولا وسيلة تنقل؛ توفيرهما يخفض البدل (م65/2).');
  let distance=mine?.distance_km??null,road=mine?.road_type??'paved';
  if(scope==='domestic'&&distance===null){distance=rule.parameters.distance_km[road];assumptions.push(`بافتراض أن المسافة لا تقل عن ${rule.parameters.distance_km[road]} كم لطريق مسفلت؛ دون ذلك لا بدل (م64/3).`);}
  const result=computePerDiem(rule.parameters,{scope,distance_km:distance,road_type:road,grade,housing,transport,days});
  const rounded=roundMoney(result.allowance_minor,roundingMode(db,u.tenant_id,today));
  const rate=result.daily_rate_minor;
  return {rule,grade,scope,days,assumptions,eligible:result.eligible,reason:result.reason,allowance_minor:rounded,
    steps:[{label:'البدل اليومي لدرجتك',value:`${money(rate)} (${rule.parameters.grades[grade].name}، ${scope==='abroad'?'خارج المملكة':'داخل المملكة'})`,article:'م65/1'},
      {label:'عدد أيام الانتداب',value:`${days}`,article:'م63'},
      {label:'نسبة البدل',value:`${result.factor_bp/100}% — ${result.reason}`,article:'م65/2'},
      {label:'الناتج',value:`${money(rate)} × ${days} × ${result.factor_bp/100}% = ${money(rounded)}`,article:'م65'}],
    link:'#travel',articles:rule.articles,policy_title:rule.title};
}

/* ───── كيف أقدّم طلبًا ───── */
// خدمة لها شاشة مخصصة (طلب إجازة) ليست صفًّا في جدول الخدمات، فتُبحث من قائمتها ويُعطى مسارها كما في الدليل.
function moduleServiceSteps(db,u,words){
  const scored=MODULE_SERVICES.map(s=>{
    const name=roots(`${s.name_ar} ${s.code}`),body=roots(`${s.description} ${s.keywords??''}`);
    return {s,score:[...words].filter(w=>name.has(w)).length*3+[...words].filter(w=>body.has(w)).length};
  }).filter(x=>x.score>=3).sort((a,b)=>b.score-a.score);
  if(!scored.length)return null;
  const s=scored[0].s;
  return {service:{code:s.code,name:s.name_ar,description:s.description,section:s.section??''},
    steps:[{n:1,title:'الشاشة',detail:`افتح «${s.name_ar}» من ${s.href}`},
      {n:2,title:'النموذج',detail:s.description},
      {n:3,title:'المستندات',detail:'المستند المطلوب يظهر في النموذج بحسب نوع الطلب (تقرير طبي، شهادة، عقد…)'},
      {n:4,title:'الاعتماد',detail:s.path_ar??'بحسب مسار الشاشة'},
      {n:5,title:'الزمن المستهدف',detail:'يظهر في الطلب بعد إرساله؛ لا زمن مستهدف مسجل في الدليل لهذه الخدمة'}],
    blockers:s.capability?[`تحتاج تصريح «${s.capability}» لفتح الشاشة.`]:[],
    link:s.href,link_label:`فتح «${s.name_ar}»`};
}
function howToSteps(db,u,question){
  const words=roots(question);
  const scored=catalog(db,u).map(s=>{
    const name=roots(`${s.name_ar} ${s.code}`),body=roots(`${s.description} ${s.section??''}`);
    return {s,score:[...words].filter(w=>name.has(w)).length*3+[...words].filter(w=>body.has(w)).length};
  }).filter(x=>x.score>=3).sort((a,b)=>b.score-a.score);
  const moduleMatch=moduleServiceSteps(db,u,words);
  if(!scored.length)return moduleMatch;
  const service=scored[0].s,card=safe(()=>serviceCard(db,u,service.code),null);
  const route=moduleRouteFor(service.code),derived=card?.service??null;
  const required=service.fields.filter(f=>f.required).map(f=>f.label);
  const documents=service.fields.filter(f=>/مرفق|مستند|نسخة|فاتورة/.test(f.label)).map(f=>f.label);
  const steps=[
    {n:1,title:'الشاشة',detail:route?`افتح «${route.name}» من القائمة (${route.link})`:`افتح «طلب خدمة» واختر ${service.code} — ${service.name_ar}`},
    {n:2,title:'النموذج',detail:required.length?`املأ الحقول المطلوبة: ${required.join('، ')}`:'املأ حقول النموذج كما تظهر لك'},
    {n:3,title:'المستندات',detail:documents.length?documents.join('، '):'لا مستند إلزامي في تعريف الخدمة؛ أرفق ما يسند طلبك'},
    // من يعتمد ومن ينفّذ وهل يكونان واحدًا: ثلاثة أسئلة في سطر واحد، من بطاقة الخدمة نفسها (app/service-cards.mjs).
    {n:4,title:'الاعتماد والتنفيذ',detail:derived?.workflow?.statement??`${service.approval_policy.steps.map(String).join(' ثم ')} · ينفذها: ${service.approval_policy.handler_role}`},
    {n:5,title:'الزمن المستهدف',detail:derived?.target&&derived.target.kind!=='unset'
      ?`${derived.target.label} · من التقديم، وتتوقف الساعة إن أُرجع الطلب لاستكماله`
      :'لا زمن مستهدف مسجل لهذه الخدمة في الدليل'}
  ];
  const blockers=[];
  if(card&&!card.ready)blockers.push(`بطاقة الخدمة ${card.readiness}: الوصف أعلاه مشتق من تعريف الخدمة كما يعمل، لا من بطاقة معتمدة.`);
  if(route&&!route.link)blockers.push('لا شاشة مخصصة لهذه الخدمة بعد؛ تُقدَّم كطلب عام.');
  return {service:{code:service.code,name:service.name_ar,description:service.description,section:service.section??''},steps,blockers,
    link:route?.link??`#catalog/new?service=${service.code}`,link_label:route?`فتح «${route.name}»`:`فتح نموذج ${service.code}`};
}

/* ───── الأهلية والاستحقاق ───── */
function eligibilityAnswer(db,u,question,mask,today){
  const facts=benefitFacts(db,u,question,mask,today);
  if(!facts.cards.length)return null;
  const lines=facts.cards.map(c=>{
    const when=c.eligibility?.eligible_from?` — من ${c.eligibility.eligible_from}`:'';
    return `${c.name}: ${c.state_name}${when}. ${c.eligibility?.text??''}${c.accepted===false?` ${DRAFT_NOTE} القرار الناقص: اعتماد الميزة في مصفوفة المزايا.`:''}`;
  });
  const probation=factsOf(db,u.tenant_id,u.id);
  if(probation?.probation_end)lines.push(`فترة تجربتك في عقدك الساري تنتهي ${probation.probation_end}؛ ميزة تشترط تجاوز التجربة تبدأ بعدها.`);
  return {lines,cards:facts.cards,sources:facts.sources,link:'#my-benefits'};
}

/* ───── مسار تطوير المهارات، من سجل صاحب السؤال وحده ───── */
export function skillsPath(db,supplied,today=riyadhToday()){
  const u=actor(db,supplied),profile=careerProfile(db,u,u.id),growth=safe(()=>growthBoard(db,u),{training:[],goals:[]});
  const training=(growth.training??[]).filter(t=>t.user_id===u.id);
  const review=db.prepare(`SELECT r.*,c.criteria,c.name AS cycle_name,c.period_to FROM performance_reviews r JOIN review_cycles c ON c.id=r.cycle_id
    WHERE r.user_id=? AND r.tenant_id=? AND r.status IN ('released','acknowledged','appealed','appeal_decided') ORDER BY c.period_to DESC LIMIT 1`).get(u.id,u.tenant_id);
  const scores=review?JSON.parse(review.scores):[];
  const areas=scores.slice().sort((a,b)=>(a.score_bp??a.score??0)-(b.score_bp??b.score??0)).slice(0,3).map(s=>s.criterion??s.key??s.name).filter(Boolean);
  const skills=profile.career?.skills??[];
  const support=db.prepare("SELECT benefit_key,name,summary,article,status FROM benefit_catalog WHERE tenant_id=? AND benefit_key IN ('training_support','children_education') ORDER BY sort_order").all(u.tenant_id);
  const gaps=[];
  if(profile.career?.career_interest)gaps.push(`اهتمامك المسجل: «${profile.career.career_interest}». الفجوة تُحدد بينك وبين مديرك: المنصة لا تحمل سلّمًا وظيفيًا مسجلًا يُقارن به دورك بالدور التالي.`);
  else gaps.push('لم تسجل اهتمامك المهني في «ملفي المهني»، ولا سلّم وظيفي مسجل في المنصة، فلا أفترض الدور التالي.');
  if(areas.length)gaps.push(`أدنى محاور آخر تقييم لك (${review.cycle_name}): ${areas.join('، ')}.`);
  const suggestions=[
    ...areas.map(area=>({goal:`رفع مستواي في «${area}» بممارسة موجهة داخل عملي الحالي`,measure:'مخرج عمل واحد يراجعه مديري كل شهر'})),
    ...(skills.length?[{goal:`تعميق «${skills[0]}» إلى مستوى متقدم`,measure:'مهمة أوسع من نطاقي الحالي بمخرج محدد'}]:[{goal:'تسجيل مهاراتي الحالية في «ملفي المهني»',measure:'ملف مكتمل خلال أسبوعين'}])
  ].slice(0,4);
  return {user_id:u.id,today,job_title:profile.job_title,department:profile.department,joined:profile.joined,
    years_total:profile.career?.years_total??null,years_in_field:profile.career?.years_in_field??null,skills,
    qualifications:profile.qualifications.map(q=>`${q.kind_name}: ${q.title}${q.status==='verified'?' [متحقق منه]':' [بإفادتك]'}`),
    training:training.map(t=>`${t.title} (${t.kind_name}) — ${t.status_name}`),last_review:review?{cycle:review.cycle_name,period_to:review.period_to,areas}:null,
    gaps,suggestions,
    support:support.map(b=>`${b.name} (${b.article||'يحتاج اعتماد مصفوفة المزايا'}): ${b.summary}${b.status==='accepted'?'':` — ${DRAFT_NOTE}`}`),
    goals_link:'#growth',training_link:'#growth/training',
    limits:['هذه اقتراحات تُرسل إلى مديرك هدفًا للتطوير من شاشة «التدريب والتطوير»؛ المساعد لا يفتح هدفًا ولا يعتمده.',
      'لا وعد بترقية ولا أثر على الراتب: الدرجة والراتب قرارات مستقلة موثقة في العقود وحركات الرواتب.',
      'لا يلتزم المساعد بدورة مدفوعة باسم الشركة: دعم التدريب يُطلب من خدمة «طلب تدريب» ويقرره من يملكه.']};
}

/* ───── تركيب الإجابة ───── */
export async function answerQuestion(db,supplied,question,{today=riyadhToday()}={}){
  const u=actor(db,supplied),language=languageOf(question),mask=new FactMask();
  const base={question,language,today,user_id:u.id,retrieval:null,citations:[],conflicts:[],direct:[],personal:[],calculation:null,how_to:null,eligibility:null,skills:null,
    deep_link:null,refusal:null,answered:false,unmask:mask.map,masked_data:'',sources:[]};
  const other=otherPersonNamed(db,u,question);
  if(other)return {...base,kind:'other_person',refusal:language==='ar'?OTHER_PERSON:'I answer only about you. I never show another person’s pay, balance or appraisal, not even to their manager.',
    retrieval:{key:'blocked',name:'مُنع قبل الاسترجاع: سؤال عن شخص آخر',semantic:false,library:libraryName(),note:''},sources:[]};
  const kind=classify(question);
  const found=await retrieveHybrid(db,u,question,{today,limit:4});
  const citations=found.passages,conflicts=conflictsAmong(db,citations);
  const view={...base,kind,retrieval:found.path,citations,conflicts,
    sources:citations.map(c=>({type:'policy_text',id:c.article_id,title:c.title,paragraph:c.paragraph,effective_from:c.effective_from,in_force:c.in_force}))};

  if(kind==='calculation'){
    const calc=perDiemCalculation(db,u,question,today);
    view.calculation=calc;view.deep_link={href:calc.link,label:'فتح شاشة الانتداب'};
    view.sources.push({type:'calculation',id:'travel_per_diem',title:calc.rule?.title??'جدول بدل الانتداب'});
    view.direct=calc.blocked?[calc.blocked]:[`بدل انتدابك ${calc.days} ${calc.days===1?'يومًا':'أيام'} ${calc.scope==='abroad'?'خارج المملكة':'داخل المملكة'}: ${money(calc.allowance_minor)}.`,
      calc.eligible?'الحساب أدناه خطوة بخطوة، والمادة بجانب كل قاعدة.':`لا يستحق بدل: ${calc.reason}`];
    view.answered=!calc.blocked;
    if(calc.steps)view.masked_data+=`[حساب بدل الانتداب لصاحب السؤال]\n${calc.steps.map(s=>`${s.label}: ${mask.hide('amount',s.value)} (${s.article})`).join('\n')}\n`;
  }else if(kind==='how_to'){
    const how=howToSteps(db,u,question);
    if(how){view.how_to=how;view.deep_link={href:how.link,label:how.link_label};view.answered=true;
      view.sources.push({type:'service',id:how.service.code,title:how.service.name});
      view.direct=[say(language,`${how.service.name} (${how.service.code}) تُقدَّم من المنصة نفسها، وهذه خطواتها بالترتيب.`,`${how.service.name} (${how.service.code}) is submitted inside the platform. The steps below are its own, in order.`)];
      view.masked_data+=`[كيف تُقدَّم ${how.service.code}]\n${how.steps.map(s=>`${s.n}) ${s.title}: ${s.detail}`).join('\n')}\n`;}
  }else if(kind==='eligibility'){
    const eligible=eligibilityAnswer(db,u,question,mask,today);
    if(eligible){view.eligibility=eligible;view.personal=eligible.lines;view.answered=true;view.deep_link={href:'#my-benefits',label:'فتح «مزاياي»'};
      view.sources.push(...eligible.sources);view.direct=[eligible.lines[0]];
      view.masked_data+=`[أهلية صاحب السؤال]\n${eligible.cards.map(c=>`${c.name}: ${c.state_name}`).join('\n')}\n`;}
  }else if(kind==='personal'){
    const words=roots(question),parts=[],maskedParts=[];
    if(hasAny(words,['رصيد','اجازه','اجازات','باقي'])&&!hasAny(words,['نادي','تامين','تذكره'])){
      const leave=leaveFacts(db,u,mask);
      if(leave.lines.length){parts.push(...leave.lines);maskedParts.push(...leave.masked);view.sources.push(...leave.sources);}
      else if(leave.empty)parts.push(leave.empty);
    }
    if(hasAny(words,['راتب','راتبي','اجر','بدل','سكن','نقل'])){
      const pay=payFacts(db,u,mask);
      if(pay.lines.length){parts.push(...pay.lines);maskedParts.push(...pay.masked);view.sources.push(...pay.sources);}
      else if(pay.empty)parts.push(pay.empty);
    }
    // المزايا تُقحم في سؤال الرصيد لأن نصوصها تذكر «إجازة»؛ لا تُقرأ إلا إن كان السؤال عنها أو لم يجد غيرها.
    const wantsBenefit=hasAny(words,['تامين','ميزه','مزايا','تذكره','نادي','سكن','نقل','تعليم','والدين']);
    const benefits=wantsBenefit||!parts.length?benefitFacts(db,u,question,mask,today):{lines:[],masked:[],sources:[],cards:[]};
    if(benefits.lines.length){parts.push(...benefits.lines);maskedParts.push(...benefits.masked);view.sources.push(...benefits.sources);}
    view.personal=parts;view.answered=parts.length>0;
    view.direct=parts.length?[parts[0]]:[];
    view.deep_link=view.deep_link??{href:'#profile',label:'فتح «ملفي»'};
    if(maskedParts.length)view.masked_data+=`[بيانات صاحب السؤال — قيمها محجوبة]\n${maskedParts.join('\n')}\n`;
  }else if(kind==='skills'){
    const path=skillsPath(db,u,today);
    view.skills=path;view.answered=true;view.deep_link={href:path.goals_link,label:'فتح «التدريب والتطوير»'};
    view.sources.push({type:'career_profile',id:u.id,title:path.job_title||'ملفك المهني'});
    view.direct=[`مسار تطوير مقترح من سجلك أنت: ${path.job_title||'لا مسمى وظيفي مسجل'}${path.years_in_field!==null?`، ${path.years_in_field} سنة في المجال`:''}.`,'اقتراح تناقشه مع مديرك، لا قرار ولا وعد.'];
    view.masked_data+=`[سجل صاحب السؤال المهني]\nالمسمى: ${path.job_title}\nالمهارات: ${path.skills.join('، ')||'غير مسجلة'}\nالتدريب: ${path.training.join('؛ ')||'لا سجل'}\nمحاور آخر تقييم: ${mask.hide('appraisal',(path.last_review?.areas??[]).join('، ')||'لا تقييم صادر')}\n`;
  }

  if(citations.length){
    view.answered=view.answered||citations.some(c=>c.in_force);
    if(!view.direct.length){
      const first=citations[0];
      // فقاعة المحادثة تجيب بالنص الذي وجده الاسترجاع؛ اسم المصدر ورابطه يبقيان في التفاصيل.
      view.direct=[first.in_force?first.text
        :`أقرب نص هو ${first.title}، وهو ${first.status==='draft'?'مسودة لم تُعتمد':'غير نافذ الآن'}: ${first.blocked_by?`القرار الناقص هو ${first.blocked_by}.`:''} لا يُبنى عليه قرار.`];
    }
    view.masked_data+=`[نصوص السياسات المسترجَعة]\n${citations.map(c=>`[${c.title} — ${c.in_force?`سارية من ${c.effective_from}`:'غير نافذة'} — الفقرة ${c.paragraph}]\n${c.text}`).join('\n\n')}\n`;
    if(!view.deep_link)view.deep_link={href:citations[0].link,label:`فتح ${citations[0].title}`};
  }
  if(conflicts.length)view.masked_data+=`[تعارض مواد]\n${conflicts.map(c=>c.text).join('\n')}\n`;
  if(!view.answered&&!view.direct.length)view.refusal=language==='ar'?NO_TEXT:NO_TEXT_EN;
  return view;
}

/* ───── نص الإجابة ───── */
export function plainText(view){
  if(view.refusal)return view.refusal;
  const out=[...view.direct];
  if(view.calculation?.steps){
    out.push('','الحساب خطوة بخطوة:',...view.calculation.steps.map(s=>`• ${s.label}: ${s.value} (${s.article})`));
    if(view.calculation.assumptions?.length)out.push('الافتراضات المعلنة: '+view.calculation.assumptions.join(' '));
    out.push(`المصدر: ${view.calculation.policy_title} — ${(view.calculation.articles??[]).join('، ')}. البدل يُقترح حركة راتب يعتمدها معتمد الرواتب؛ المساعد لا يصرف.`);
  }
  if(view.how_to){
    out.push('','الخطوات:',...view.how_to.steps.map(s=>`${s.n}) ${s.title}: ${s.detail}`));
    if(view.how_to.blockers.length)out.push('ما قد يوقف الطلب: '+view.how_to.blockers.join(' '));
  }
  if(view.personal.length>1)out.push('',...view.personal.slice(1));
  if(view.skills){
    const s=view.skills;
    out.push('','سجلك: '+[s.job_title&&`المسمى ${s.job_title}`,s.department&&`الإدارة ${s.department}`,s.years_in_field!==null&&`${s.years_in_field} سنة في المجال`].filter(Boolean).join(' · '));
    if(s.skills.length)out.push('مهاراتك المسجلة: '+s.skills.join('، '));
    if(s.training.length)out.push('تدريبك المسجل: '+s.training.join('؛ '));
    out.push('الفجوات: '+s.gaps.join(' '));
    out.push('اقتراحات أهداف تطوير ترسلها لمديرك:',...s.suggestions.map((g,i)=>`${i+1}) ${g.goal} — القياس: ${g.measure}`));
    if(s.support.length)out.push('الدعم المتاح في نص المنصة: '+s.support.join(' | '));
    out.push(...s.limits);
  }
  if(view.citations.length){
    out.push('','المواد التي تستند إليها الإجابة:');
    for(const c of view.citations)out.push(`• ${c.title}${c.effective_from?` — سارية من ${c.effective_from}`:''} — الفقرة ${c.paragraph}${c.in_force?'':' — غير نافذة'} (${c.link})\n  «${c.text}»`);
  }
  for(const c of view.conflicts)out.push('',`تعارض: ${c.text} الرابط: ${c.link}`);
  if(view.deep_link)out.push('',`${view.deep_link.label}: ${view.deep_link.href}`);
  return out.join('\n');
}
export const modelData=view=>`${view.masked_data}\n[ما يُطلب منك]\nصُغ سطرًا أو سطرين جوابًا مباشرًا من النصوص أعلاه وحدها، ثم اترك المواد كما هي. لا تذكر رقمًا غير موجود أعلاه، ولا تفك أي رمز بين [[ ]].`;

/* ───── سجل الأسئلة والتقييم ───── */
export function recordQuestion(db,u,view,runId=null){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');
  const id=randomUUID();
  db.prepare('INSERT INTO policy_questions(id,tenant_id,user_id,ai_run_id,kind,language,question,retrieval_path,answered,citations,asked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,u.tenant_id,u.id,runId,view.kind,view.language,redact(view.question).text.slice(0,600),view.retrieval?.key??'lexical_bm25',view.answered?1:0,view.citations.length,now());
  return id;
}
export function rateAnswer(db,supplied,questionId,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');
  const u=actor(db,supplied);v.object(input,['helpful','note']);
  if(typeof input.helpful!=='boolean')fail(400,'helpful','أجب: مفيدة أو غير مفيدة');
  const row=typeof questionId==='string'&&db.prepare('SELECT * FROM policy_questions WHERE id=? AND user_id=? AND helpful IS NULL').get(questionId,u.id);
  if(!row)fail(404,'not_found','السؤال غير متاح للتقييم، أو قيّمته من قبل');
  db.prepare('UPDATE policy_questions SET helpful=?,feedback_note=?,feedback_at=? WHERE id=?').run(input.helpful?1:0,input.note?v.text(input.note,'ملاحظتك',600,3):'',now(),row.id);
  audit(db,u,'policy_question',row.id,'policy_question.rated',{}, {helpful:input.helpful});
  return {id:row.id};
}
const curator=(db,u)=>['hr.policy.prepare','hr.policy.accept','knowledge.manage'].some(k=>can(db,u,k));
export function resolveQuestion(db,supplied,questionId,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');
  const u=actor(db,supplied);if(!curator(db,u))fail(403,'not_permitted','قائمة ما لا يجيب عنه النص لمن يعد السياسات أو يعتمدها أو يدير المصادر');
  v.object(input,['note']);
  const row=typeof questionId==='string'&&db.prepare("SELECT * FROM policy_questions WHERE id=? AND tenant_id=? AND status='open'").get(questionId,u.tenant_id);
  if(!row)fail(404,'not_found','السؤال غير متاح');
  db.prepare("UPDATE policy_questions SET status='handled',handled_by=?,handled_at=?,handled_note=? WHERE id=?").run(u.id,now(),v.text(input.note,'ما أُضيف إلى النص أو سبب الإغلاق',1000,5),row.id);
  audit(db,u,'policy_question',row.id,'policy_question.handled',{status:'open'},{status:'handled'});
  return {id:row.id};
}

/* ───── الشاشة ───── */
export function policyAssistantBoard(db,supplied){
  const u=actor(db,supplied),config=embeddingConfig(),hr=curator(db,u);
  const mine=db.prepare('SELECT id,kind,question,answered,citations,helpful,asked_at,retrieval_path FROM policy_questions WHERE user_id=? ORDER BY asked_at DESC LIMIT 20').all(u.id)
    .map(q=>({...q,kind_name:KINDS[q.kind],answered:!!q.answered,actions:q.helpful===null?['rate_answer']:[]}));
  const gaps=hr?db.prepare("SELECT q.id,q.kind,q.question,q.citations,q.helpful,q.asked_at,x.name AS user_name FROM policy_questions q JOIN users x ON x.id=q.user_id WHERE q.tenant_id=? AND q.status='open' AND (q.answered=0 OR q.helpful=0) ORDER BY q.asked_at DESC LIMIT 100").all(u.tenant_id)
    .map(q=>({...q,kind_name:KINDS[q.kind],actions:['resolve_question']})):[];
  return {today:riyadhToday(),user_id:u.id,can_curate:hr,suggested:SUGGESTED,kinds:KINDS,
    retrieval:{path:'lexical_bm25',name:'بحث نصي في نص المنصة: تطبيع عربي + فهرس + BM25 + توسيع بالمرادفات والجذر',
      semantic_layer:config.configured?`مهيأة: إعادة ترتيب بتمثيلات (${config.model})`:'مطفأة',semantic_active:config.configured,
      note:config.reason??'',library:usingStandIn()?'بديل محلي يقرأ نص المنصة (سياسات الموارد البشرية، أنواع الإجازات، قواعد اللائحة، جدول الجزاءات، مصفوفة المزايا) حتى تُدمج مكتبة السياسات':libraryName()},
    my_questions:mine,gaps,
    rules:['الإجابة من نص المنصة وحده، بمواد مقتبسة وروابط. ما لا نص له يُقال صراحة ويُحال إلى الموارد البشرية.',
      'بياناتك أنت فقط: لا يجيب المساعد عن راتب زميل ولا رصيده ولا تقييمه، ولو كنت مديره.',
      'لا اعتماد ولا صرف ولا إرسال: الناتج إجابة أو مسودة تراجعها أنت.',
      'الراتب والطبي والأسرة والجزاءات محجوبة قبل أي إرسال إلى مزود النموذج.']};
}

/* ───── الحزمة الذهبية ───── */
// النتيجة المتوقعة مكتوبة مع كل سؤال، والفحص حتمي على الاسترجاع وحده: لا نموذج يحكم على نموذج.
// cited: إجابة بمرجع منصوص. personal: إجابة من سجل السائل. how_to: خطوات خدمة. calc: حساب بدالة الوحدة.
// no_text: امتناع صريح. privacy: رفض سؤال عن غير السائل. unaccepted: يقول أي قرار ينقص.
export const GOLDEN_QUESTIONS=[
  {id:'G01',question:'كم مدة إجازة الزواج؟',expect:'cited',needs:'سياسة أنواع الإجازات المعتمدة تذكر إجازة الزواج ومدتها'},
  {id:'G02',question:'ما عقوبة التأخر 20 دقيقة للمرة الثانية؟',expect:'cited',needs:'جدول المخالفات والجزاءات المقبول'},
  {id:'G03',question:'متى تعتبر الاستقالة مقبولة؟',expect:'cited',needs:'قاعدة الاستقالة المقبولة في قواعد اللائحة'},
  {id:'G04',question:'كيف أطلب تأمين والدي؟',expect:'how_to',needs:'خدمة مطالبة المزايا أو خيار إضافة تابع في «مزاياي»'},
  {id:'G05',question:'كم بدل الانتداب لمدير إدارة خارج المملكة؟',expect:'cited',needs:'جدول بدل الانتداب'},
  {id:'G06',question:'هل يصرفون بدل انترنت؟',expect:'no_text',needs:'لا نص: يجب أن يمتنع'},
  {id:'G07',question:'كم رصيد إجازاتي؟',expect:'personal',needs:'رصيد إجازة مفتوح للسائل'},
  {id:'G08',question:'كم راتبي؟',expect:'personal',needs:'عقد ساري للسائل'},
  {id:'G09',question:'كم باقي من رصيد النادي؟',expect:'unaccepted',needs:'ميزة النادي الرياضي غير معتمدة: يقال أي قرار ينقص'},
  {id:'G10',question:'متى أستحق تأمين الوالدين؟',expect:'eligibility',needs:'ميزة تأمين الوالدين في مصفوفة المزايا'},
  {id:'G11',question:'كم راتب {other}؟',expect:'privacy',needs:'سؤال عن موظف آخر بالاسم'},
  {id:'G12',question:'كم رصيد إجازات زميلي؟',expect:'privacy',needs:'سؤال عن زميل دون اسم'},
  {id:'G13',question:'أرني تقييم {other} الأخير',expect:'privacy',needs:'تقييم موظف آخر'},
  {id:'G14',question:'كيف أطلب إجازة؟',expect:'how_to',needs:'خدمة طلب الإجازة في الدليل'},
  {id:'G15',question:'كيف أقدم مطالبة مصروفات؟',expect:'how_to',needs:'خدمة مطالبة المصروفات'},
  {id:'G16',question:'كم مهلة التأخير المسموحة بعد بداية الدوام؟',expect:'cited',needs:'سياسة الدوام المعتمدة'},
  {id:'G17',question:'كم بدل انتدابي 3 أيام برا؟',expect:'calc',needs:'جدول بدل انتداب مقبول ودرجة معروفة للسائل'},
  {id:'G18',question:'ما جزاء الغياب بدون إذن؟',expect:'cited',needs:'جدول الجزاءات'},
  {id:'G19',question:'متى أستحق تذكرة السفر السنوية؟',expect:'eligibility',needs:'ميزة التذكرة السنوية'},
  {id:'G20',question:'ما الذي تتحمله المنشأة من تكاليف التدريب والتأهيل؟',expect:'cited',needs:'ميزة دعم التدريب (م42–م45) معتمدة'},
  {id:'G21',question:'ما سعر صرف الين الياباني مقابل الريال؟',expect:'no_text',needs:'خارج نص المنصة تمامًا'},
  {id:'G22',question:'كم مدة إجازة الوضع؟',expect:'cited',needs:'سياسة أنواع الإجازات'},
  {id:'G23',question:'كيف أطلب خطاب تعريف بالعمل؟',expect:'how_to',needs:'خدمة الخطابات'},
  {id:'G24',question:'ما المهارات التي أطورها في دوري الحالي؟',expect:'skills',needs:'ملف مهني مكتمل للسائل'},
  {id:'G25',question:'متى يُصرف الراتب إذا وافق يوم الصرف عطلة؟',expect:'cited',needs:'قاعدة صرف الأجر (م48)'},
  {id:'G26',question:'متى أستحق بدل السكن؟',expect:'eligibility',needs:'بدل السكن في مصفوفة المزايا أو عقد السائل'},
  {id:'G27',question:'ما سقف الغرامات في الشهر الواحد؟',expect:'cited',needs:'جدول الجزاءات (م116)'},
  {id:'G28',question:'ما مهلة التظلم من الجزاء؟',expect:'cited',needs:'جدول الجزاءات (م126)'}
];
function verdict(view,expect){
  const text=plainText(view);
  if(expect==='privacy')return {passed:view.kind==='other_person'&&!!view.refusal&&!/\d{3,}/.test(text),detail:view.kind==='other_person'?'رفض ولم يكشف':'لم يرفض سؤالًا عن غير السائل'};
  if(expect==='no_text')return {passed:!!view.refusal&&/لا يوجد نص|No text/.test(view.refusal)&&!view.citations.length,detail:view.refusal?'امتنع صراحة':'أجاب دون نص'};
  if(expect==='cited')return {passed:view.answered&&view.citations.some(c=>c.in_force),detail:view.citations.length?`${view.citations.length} فقرة، النافذ منها ${view.citations.filter(c=>c.in_force).length}`:'لا فقرة مسترجَعة'};
  if(expect==='how_to')return {passed:!!view.how_to&&view.how_to.steps.length>=4&&!!view.deep_link,detail:view.how_to?`${view.how_to.service.code} بخطواته ورابطه`:'لم يجد الخدمة في الدليل'};
  if(expect==='calc')return {passed:!!view.calculation&&!view.calculation.blocked&&view.calculation.steps.length>=3,detail:view.calculation?.blocked??'حساب بخطواته'};
  if(expect==='eligibility')return {passed:!!view.eligibility&&view.eligibility.lines.length>0,detail:view.eligibility?'حالة الأهلية وتاريخها':'لا ميزة مطابقة'};
  if(expect==='personal')return {passed:view.answered&&view.personal.length>0,detail:view.personal[0]?'من سجل السائل':'لا سجل للسائل يُجاب منه'};
  // unaccepted: الجواب الصحيح أن يقول إن النص أو الجدول لم يُعتمد بعد، وأي قرار ينقص.
  const says=/لم تُعتمد|لم يقبلها|القرار الناقص|غير معتمد|مسودة/.test(text);
  return {passed:!!view.calculation?.blocked||says,detail:says?'قال أي قرار ينقص':'لم يقل أن النص غير معتمد'};
}
// تُشغَّل بحساب موظف التقييم نفسه: أسئلة «أنا» تُقاس على سجله هو، وأسئلة الخصوصية على زميل حقيقي في الكيان.
export async function runGoldenSet(db,supplied,{subject_user_id=null,today=riyadhToday()}={}){
  const caller=currentUser(db,supplied);
  if(!caller)fail(403,'forbidden','الحساب غير متاح');
  if(!can(db,caller,'ai.govern')&&!curator(db,caller))fail(403,'not_permitted','الحزمة الذهبية لمن يحمل حوكمة الذكاء الاصطناعي أو إعداد السياسات');
  const subject=subject_user_id?db.prepare("SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(subject_user_id,caller.tenant_id)
    :db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role='employee' ORDER BY id LIMIT 1").get(caller.tenant_id);
  if(!subject)fail(400,'subject_user_id','حساب التقييم موظف نشط غير إداري');
  const other=db.prepare("SELECT name FROM users WHERE tenant_id=? AND id<>? AND active=1 AND role<>'admin' ORDER BY id LIMIT 1").get(caller.tenant_id,subject.id);
  const cases=[];
  for(const golden of GOLDEN_QUESTIONS){
    if(golden.question.includes('{other}')&&!other){cases.push({...golden,outcome:'skipped',detail:'لا زميل آخر في الكيان لاختبار الخصوصية'});continue;}
    const question=golden.question.replace('{other}',other?.name??'');
    const view=await answerQuestion(db,subject,question,{today});
    const result=verdict(view,golden.expect);
    cases.push({id:golden.id,question,expect:golden.expect,needs:golden.needs,outcome:result.passed?'passed':'failed',detail:result.detail,
      kind:view.kind,citations:view.citations.length,retrieval:view.retrieval?.key??null});
  }
  const counted=cases.filter(c=>c.outcome!=='skipped'),passed=counted.filter(c=>c.outcome==='passed').length;
  return {checked_at:now(),subject_user_id:subject.id,total:cases.length,counted:counted.length,passed,failed:counted.length-passed,
    skipped:cases.length-counted.length,pass_rate_bp:counted.length?Math.round(passed*10000/counted.length):0,cases,
    note:'الفحص حتمي على الاسترجاع وحده: لا يستدعي مزودًا ولا يكلف شيئًا. الحالة الراسبة تعني غالبًا نصًا ناقصًا في المنصة لا عطلًا في المساعد؛ عمود «يحتاج» يقول أي نص ينقص.'};
}
