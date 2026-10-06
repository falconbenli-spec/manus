import { now } from './db.mjs';
import { fail } from './auth.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { listRequests } from './workflow.mjs';
import { listProjects } from './projects.mjs';
import { listLeave } from './leave.mjs';
import { portal, serviceClock, handlingDepartment, usedServices } from './routing.mjs';
import { canReadExecutive, executiveOverview } from './workspace.mjs';
import { listContracts } from './hr-contracts.mjs';
import { listReceivables } from './receivables.mjs';
import { listPayables } from './payables.mjs';
import { listFinance } from './finance.mjs';
import { expiringSoon, maskReference } from './expiry.mjs';
import { obligations } from './obligations.mjs';
// «وين واقف الطلب وعند مين» تأتي من nextStep نفسها التي تقرؤها شاشة «أين طلباتي» (app/request-timeline.mjs):
// عند من هو، وما القرار المنتظر، ومتى يُتوقع، وما الذي يستطيعه صاحبه. تعريفٌ ثانٍ لها هنا يعني رقمين لسؤال واحد.
import { nextStep } from './request-timeline.mjs';
import { dayStates } from './attendance.mjs';
import { routeReadiness } from './module-routes.mjs';
import { myDiscipline } from './discipline.mjs';
import { REQUEST_STATUS_AR } from './static/vocabulary.mjs';
import { departmentReturned } from './returned-requests.mjs';
import { departmentHeldWork } from './request-assignment.mjs';
// شاشات الإدارة ليست قائمةً تُكتب هنا لكل إدارة من السبع عشرة: سجل الوجهات (app/static/nav-map.mjs) يحمل
// إدارة كل شاشة، وplaceFor هي التي تقول أين تقع الشاشة لهذا الحساب. يُقرأ السجل ولا يُنسخ منه صف.
import { NAV_DEST, placeFor, NO_PAGE_DEPARTMENTS } from './static/nav-map.mjs';

// الصفحة الرئيسية: ما يخص هذا الشخص في هذا الدور، مشتقًا من مصادره لحظيًا بلا تخزين.
// تبني على البوابة القائمة في app/routing.mjs ولوح العمل في app/workspace.mjs ولا تعدّلهما.
// القاعدة: لا يظهر رقم لمن لا يملك تفصيله — كل رقم هنا طوله طول القائمة التي بنته، وكل قائمة قرأها المستخدم بصلاحيته هو.
const OPEN=['draft','pending','returned','approved','in_progress'];
const FINANCE_SOURCES=['مستحقات العملاء','أوامر الدفع','الدفتر المالي'];
// الحالات من القاموس الواحد (app/static/vocabulary.mjs): الرئيسية وصفحة الطلب و«طلباتي» تقول العبارة نفسها.
const STATUS_NAMES=REQUEST_STATUS_AR;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}

// زمن الخدمة يُحسب من السجل الخام لا من الإسقاط: listRequests لا يحمل service_id.
function clockOf(db,u,r){
  const raw=db.prepare('SELECT * FROM requests WHERE id=? AND tenant_id=?').get(r.id,u.tenant_id);
  if(!raw)return {request:null,clock:null};
  try{return {request:raw,clock:serviceClock(db,raw)};}catch{return {request:raw,clock:null};}
}
const timeNote=(r,clock)=>!clock||!clock.target_days?'بلا زمن مستهدف معتمد لهذه الخدمة':clock.paused?'الزمن موقوف بانتظار مقدم الطلب':clock.overdue?`تجاوز الزمن المستهدف بـ ${Math.abs(clock.days_left)} يوم عمل`:clock.days_left===null||clock.days_left===undefined?(r.status==='draft'?'مسودة لم تُقدَّم بعد':'يبدأ الزمن عند التقديم'):`${clock.days_left} يوم عمل متبق`;
// «متبقٍ ثلاثة أيام» جملةٌ تقيس إلى رقم. ما لم يتبنَّ الرقمَ إنسانٌ يُقال ذلك في السطر نفسه، فلا يُقرأ العدّ وعدًا.
const targetNote=clock=>clock?.target&&!clock.target.adopted&&clock.target.kind!=='unset'?` — ${clock.target.note}`:'';
// الخطوة التالية للطلب كما تقولها شاشته: عند من، وما المنتظر، ومتى، وما يستطيعه صاحبه أولًا.
// تفشل بصمت وتعيد null حين لا يُقرأ السجل الخام أو تُمنع قراءة خدمته: الرئيسية لا تسقط لأن حقل عرض غاب.
function stepOf(db,u,raw,clock){
  if(!raw)return null;
  try{
    const s=clock?nextStep(db,u,raw,undefined,clock):nextStep(db,u,raw);
    return {with:s.with||'',awaiting:s.awaiting||'',expected_on:s.expected_on??null,paused:!!s.paused,you_can:s.you_can?.[0]??''};
  }catch{return null;}
}
const requestRow=(r,clock,step=null)=>({
  id:r.id,title:r.title,service_name:r.service_name,status:r.status,status_name:STATUS_NAMES[r.status]??r.status,
  updated_at:r.updated_at,link:`#request/${r.id}`,
  clock:clock?{target_days:clock.target_days,days_left:clock.days_left,due_on:clock.due_on,overdue:clock.overdue,paused:clock.paused,target:clock.target??null}:null,
  // خدمة بلا زمن مستهدف لا تُوصف بأنها في الموعد ولا متأخرة، وزمنٌ لم يتبنّه أحد لا يُعرض التزامًا.
  time_note:timeNote(r,clock)+targetNote(clock),
  step
});

// ── البطاقة تأخذ القائمة لا الرقم ─────────────────────────────────────────────
// كانت البطاقة تُعطى رقمًا، فقالت رئيسية المدير «6 ما ينتظر قراري» و«0 اعتماداتي المعلقة» ثم «لا اعتماد معلق عليك»:
// تعريفان لعبارة واحدة بينهما خمسون سطرًا. الآن تأخذ البطاقة القائمة نفسها التي تُعرض تحتها وتشتق رقمها من طولها،
// وترمي خطأ إن أُعطيت رقمًا — فلا تستطيع بطاقة أن تخالف قائمتها مرة أخرى. الكمية الحقيقية (رصيد إجازة) لها figure().
export function card(key,title,list,link,tone=''){
  if(!Array.isArray(list))throw new TypeError(`card(${key}): البطاقة تأخذ القائمة التي تُعرض تحتها وتشتق رقمها من طولها؛ لا تقبل رقمًا. للكمية الحقيقية استعمل figure().`);
  return {key,title,value:list.length,link,tone,basis:'list'};
}
export function figure(key,title,quantity,link,tone=''){
  if(quantity!==null&&!Number.isFinite(quantity))throw new TypeError(`figure(${key}): الكمية رقم أو null حين لا تُعرف`);
  return {key,title,value:quantity,link,tone,basis:'quantity'};
}
// سطر الرئيسية لبند من «ما عليّ». age_days بأيام العمل منذ وصل البند إلى الشخص، وoverdue من موعده الحقيقي (obligations.mjs).
// طلب الدليل يبقى status:'pending' فتسمّيه الواجهة «قيد الاعتماد»؛ بند أي شاشة أخرى يُسمّى بفعله المنتظر.
const decisionRow=i=>({id:i.id,title:i.title,service_name:i.source==='requests'?i.context:[i.source_name,i.kind].filter(Boolean).join(' · '),
  status:i.source==='requests'?'pending':'decision',status_name:i.actions.join('، '),source:i.source,age_days:i.age_days??0,due_on:i.due_on,due_basis:i.due_basis,
  // action_text: الفعل المنتظر منك بعينه («قرار على طلب»، «إفادة عن غياب»). كان يُطوى في status_name وحده
  // فتبتلعه الشارة حين تعرض الحالة، فلا يبقى في البطاقة ما يقول ما المطلوب منك فعلًا.
  action_text:i.actions.join('، '),due_basis_name:i.due_basis_name??'',due_adopted:i.due_adopted!==false,
  overdue:i.overdue,owner_of_record:i.owner_of_record,unblocks:i.unblocks,link:i.link,clock:null,time_note:''});
// due_date للعرض («غير محدد» حين لا موعد، فلا تُطبع كلمة «الموعد» وحدها)، وdue_on الموعد الحقيقي أو null لمن يحسب به.
const taskRow=i=>({id:i.id,title:i.title,context:[i.kind,i.context].filter(Boolean).join(' · '),due_on:i.due_on,due_date:i.due_on??'غير محدد',overdue:i.overdue,shared:!!i.shared,source:i.source,link:i.link,
  action_text:i.actions.join('، '),due_basis:i.due_basis,due_basis_name:i.due_basis_name??'',due_adopted:i.due_adopted!==false,
  owner_of_record:i.owner_of_record,unblocks:i.unblocks});

// «مخالفاتي وجزاءاتي» (ترحيل 097). كانت لوحتها في portal-ui.mjs، وقد توقفت عن الظهور حين دُمجت «ملخصي» في الرئيسية
// (فجوة تسليم الدمج §5). القسم يظهر هنا فقط لمن عليه قضية أو جزاء: لا يُذكَّر من لا مخالفة عليه بالمخالفات.
// الملخص لا يحمل نص الاتهام ولا الدفاع ولا التظلم ولا مبلغ الغرامة: كلها في «مخالفاتي وجزاءاتي» بصلاحية صاحبها.
function disciplineSummary(db,u){
  if(u.role==='admin')return null;
  let board=null;try{board=myDiscipline(db,u);}catch{return null;}
  const cases=board.cases??[],sheet=board.sheet??[];
  if(!cases.length&&!sheet.length)return null;
  const rows=cases.map(c=>{
    const deadline=(c.deadlines??[]).slice().sort((a,b)=>a.due_on.localeCompare(b.due_on))[0]??null;
    return {id:c.id,reference:c.reference,act_date:c.act_date,status:c.status,status_name:c.status_ar,
      penalty:c.effective?.ar??null,needs_you:(c.actions??[]).length>0,actions:c.actions??[],
      due_on:deadline?.due_on??null,overdue:!!deadline?.overdue,deadline_text:deadline?.ar??null,link:'#my-discipline'};
  });
  const open=rows.filter(r=>!['decided','notified','withdrawn','not_proven','lapsed'].includes(r.status));
  return {cases:rows.length,open_cases:open.length,penalties:sheet.filter(r=>!r.cancelled).length,
    needs_you:rows.filter(r=>r.needs_you).length,rows,link:'#my-discipline',
    note:'صحيفتك ودفاعك وتظلمك في «مخالفاتي وجزاءاتي». لا يراها غيرك إلا الموارد البشرية وصاحب الصلاحية.'};
}

// ── «شغل إدارتي»: قسم واحد مشتقٌّ من إدارة صاحب الحساب ───────────────────────────
// موجز المالك (30 سبتمبر 2026) البند 3: مدير إدارة الحسابات يرى التحصيل والإقفال والسيولة، ومدير إدارة الأعمال
// يرى العملاء والفرص. سبعة عشر قسمًا مكتوبًا بيد تعني سبعة عشر تعريفًا لسؤال واحد تتقادم واحدًا واحدًا، فالقسم
// واحد وإدارة صاحب الحساب هي ما يبدّله. شاشاته من سجل الوجهات بموضع placeFor لهذا الحساب: ترتيب السجل نفسه،
// وتسميته هو للشاشة (التسمية الثابتة في كل عدسة). ويُقرأ السجل بمرونة لأنه مولَّد ويُحرَّر عقده: مدخلٌ بشكل
// لا نعرفه يُتجاوز ولا يُسقط الرئيسية.
// وهذه أسماء شاشاتٍ لا أرقام: بوابة «ما يبلغه هذا الحساب اليوم» تحرسها الشاشة في app/static/home-ui.mjs،
// فلا يُرسم اسم شاشةٍ لا يصلها صاحبها ولا تصير النقرة رفضًا.
function departmentScreens(u){
  const own=u.department_id||null;
  const noPage=Array.isArray(NO_PAGE_DEPARTMENTS)&&NO_PAGE_DEPARTMENTS.includes(own);
  if(!own||u.role==='admin'||noPage||typeof placeFor!=='function')return [];
  const rows=[];
  for(const [key,destination] of Object.entries(NAV_DEST??{})){
    if(!destination||typeof destination!=='object')continue;
    let place=null;try{place=placeFor(key,destination.label,u);}catch{continue;}
    if(place?.hub!=='dept'||place.dept!==own)continue;
    rows.push({key,label:place.label||destination.label||key,link:`#${key}`});
  }
  return rows;
}

// B4: رقم البطاقة هو المتاح (available_days) من رصيد الإجازة السنوية لهذه السنة. جمع أنواع مختلفة (سنوية ومرضية)
// رقم بلا معنى؛ بقية الأنواع تظهر كل منها باسمه في قائمة «رصيد إجازتي». نوع واحد غير سنوي يُعرض كما هو.
function leaveCardValue(balances,year){
  const current=balances.filter(b=>b.year===year),pool=current.length?current:balances;
  const annual=pool.filter(b=>/^(synthetic_)?annual$/.test(b.type_code??''));
  if(annual.length)return annual.reduce((n,b)=>n+Number(b.remaining??0),0);
  return pool.length===1?Number(pool[0].remaining??0):null;
}
// بطاقة «اليوم» (REF-APP-FRONTEND P1-1): حضور اليوم بوقت الخادم، وحال اليوم (إجازة أو عطلة أو راحة)، وأقرب موعد.
// الحضور من dayStates في وحدة الحضور نفسها؛ لا حساب مستقل للحالة هنا.
const WEEKDAYS=[['الأحد','Sunday'],['الاثنين','Monday'],['الثلاثاء','Tuesday'],['الأربعاء','Wednesday'],['الخميس','Thursday'],['الجمعة','Friday'],['السبت','Saturday']];
const daysBetween=(from,to)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);
function todayCard(db,u,{day,leave,mineOpen,tasks,documents}){
  const [weekday,weekday_en]=WEEKDAYS[new Date(day+'T00:00:00Z').getUTCDay()];
  let attendance=null;
  if(u.role!=='admin'){
    try{
      const d=dayStates(db,u,day,day,day)[0]??null;
      attendance={check_in:d?.check_in??null,check_out:d?.check_out??null,can_check_in:!d?.check_in,can_check_out:!!d?.check_in&&!d?.check_out,
        state:d?.state??null,state_name:d?.state_name??null,policy:!!d?.policy_id};
    }catch{attendance=null;}
  }
  const own=(leave?.requests??[]).filter(r=>r.employee_id===u.id&&['approved','pending_manager','pending_hr'].includes(r.status)&&r.end_date>=day).sort((a,b)=>a.start_date.localeCompare(b.start_date));
  const onLeave=own.find(r=>r.status==='approved'&&r.start_date<=day&&(r.work_dates??[]).includes(day))??own.find(r=>r.status==='approved'&&r.start_date<=day&&day<=r.end_date)??null;
  const upcoming=own.find(r=>r.start_date>day)??null;
  const holidayToday=db.prepare("SELECT name FROM public_holidays WHERE tenant_id=? AND status='approved' AND holiday_date=?").get(u.tenant_id,day)??null;
  const nextHoliday=db.prepare("SELECT holiday_date,name FROM public_holidays WHERE tenant_id=? AND status='approved' AND holiday_date>? ORDER BY holiday_date LIMIT 1").get(u.tenant_id,day)??null;
  const status=onLeave?{kind:'leave',name:`في إجازة: ${onLeave.leave_type_name} حتى ${onLeave.end_date}`,name_en:`On leave until ${onLeave.end_date}`}
    :holidayToday?{kind:'holiday',name:`عطلة رسمية: ${holidayToday.name}`,name_en:`Public holiday: ${holidayToday.name}`}
    :attendance?.state==='off'?{kind:'off',name:'يوم راحة في سياسة الدوام',name_en:'Rest day in the working-time policy'}
    :attendance?.state==='mission'?{kind:'mission',name:'مهمة عمل معتمدة',name_en:'Approved work mission'}
    :{kind:'work',name:'يوم عمل',name_en:'Working day'};
  // أقرب موعد: طلب مفتوح له زمن خدمة، أو مهمة لها تاريخ، أو وثيقة تنتهي. المتأخر يتقدم على القادم.
  const candidates=[
    ...mineOpen.filter(r=>r.clock?.due_on).map(r=>({kind:'request',title:r.title,date:r.clock.due_on,link:r.link})),
    ...tasks.filter(t=>t.due_on).map(t=>({kind:'task',title:t.title,date:String(t.due_on).slice(0,10),link:t.link})),
    ...documents.filter(d=>d.status!=='ok'||daysBetween(day,d.expires_on)<=60).map(d=>({kind:'document',title:d.doc_kind_name,date:d.expires_on,link:d.scope==='own'?'#profile':d.link}))
  ].map(c=>({...c,days_left:daysBetween(day,c.date),overdue:c.date<day})).sort((a,b)=>a.date.localeCompare(b.date));
  return {date:day,weekday,weekday_en,attendance,status,
    leave:onLeave?{type_name:onLeave.leave_type_name,start_date:onLeave.start_date,end_date:onLeave.end_date}:null,
    upcoming_leave:upcoming?{type_name:upcoming.leave_type_name,start_date:upcoming.start_date,end_date:upcoming.end_date,status:upcoming.status,approved:upcoming.status==='approved'}:null,
    next_holiday:nextHoliday?{date:nextHoliday.holiday_date,name:nextHoliday.name}:null,
    next_deadline:candidates[0]??null};
}
// الأزرار السريعة (P1-2): كل زر رابط عميق يفتح النموذج مباشرة. ما لا تستطيع وحدته استقباله الآن يُخفى ولا يظهر زرًا ميتًا.
export function quickActions(db,u,balances,statutoryReady=false){
  if(u.role==='admin')return [];
  const ready=routeReadiness(db,u),canRequest=can(db,u,'requests.use');
  // دمج 20260919: تحت سياسة أنواع إجازات معتمدة (098) يُقدَّم الطلب بالنوع النظامي ولو لم يوجد رصيد افتتاحي.
  const hasBalance=statutoryReady||(balances??[]).some(b=>Number(b.remaining??0)>0);
  // create: هل هذا إنشاءُ شيء جديد. موجز المالك (30 سبتمبر 2026) البند 1: «زر رئيسي واحد + إنشاء يفتح قائمة ذكية»،
  // والبند 4: «خمس خدمات متكررة لكل مستخدم ثم زر واضح لفتح جميع الخدمات. لا نعرض عشرة مربعات متشابهة».
  // فما يُنشئ يذهب إلى القائمة، وما ليس إنشاءً («راتبي الجاي» قراءة، و«اسأل تركي» سؤال) يبقى شريحةً في الشريط.
  // ولا يُخترع مدخلٌ لما لا نموذج له: أمر الشراء والاجتماع والمستند ليست في المنصة بعد، فلا تُكتب هنا نقرةٌ ميتة.
  // وكل مدخل هنا نيّةٌ مسجلة في app/static/deep-links.mjs، وtests/employee-ux.test.mjs يتحقق من ذلك لكل واحد.
  return [
    {key:'service',create:true,label:'طلب من دليل الخدمات',label_en:'Request from the catalog',link:'#catalog/new',ready:canRequest,reason:canRequest?'':'لا تصريح بتقديم الطلبات'},
    {key:'leave',create:true,label:'طلب إجازة',label_en:'Request leave',link:'#leave/new',ready:hasBalance&&can(db,u,'leave.use'),reason:hasBalance?'':'لا رصيد إجازة متاح لك بعد'},
    {key:'letter',create:true,label:'طلب خطاب',label_en:'Request a letter',link:'#letters/new',ready:ready.has('letters'),reason:ready.has('letters')?'':'لا قالب خطاب معتمد بعد'},
    {key:'expense',create:true,label:'مطالبة مصروف',label_en:'Expense claim',link:'#expenses/new',ready:true,reason:''},
    {key:'custody',create:true,label:'طلب عهدة',label_en:'Request custody',link:'#expenses/custody',ready:true,reason:''},
    {key:'correction',create:true,label:'تصحيح حضور',label_en:'Attendance correction',link:'#attendance/correction',ready:true,reason:''},
    {key:'overtime',create:true,label:'عمل إضافي',label_en:'Overtime',link:'#attendance/overtime',ready:true,reason:''},
    {key:'mission',create:true,label:'مهمة عمل',label_en:'Work mission',link:'#attendance/mission',ready:true,reason:''},
    {key:'training',create:true,label:'طلب تدريب',label_en:'Request training',link:'#growth/training',ready:true,reason:''},
    {key:'case',create:true,label:'حالة موارد بشرية',label_en:'HR case',link:'#hr-cases/new',ready:true,reason:''},
    {key:'payslip',create:false,label:'راتبي الجاي',label_en:'My next pay',link:'#payroll/latest',ready:true,reason:''},
    // «اسأل تركي» (ترحيل 111): الإجابة من نص المنصة وحده، وبيانات السائل نفسه.
    {key:'policy',create:false,label:'اسأل تركي',label_en:'Ask Turki',link:'#policy-assistant/ask',ready:true,reason:''}
  ];
}
export function homeBoard(db,supplied){
  const u=actor(db,supplied),day=today(),unavailable=[];
  // كل مصدر خارج وحدتي يُقرأ بهوية المستخدم نفسه: ما يمنعه التصريح لا يُحتسب ولا يُعرض رقمه.
  const read=(name,load)=>{try{return load();}catch(error){if(error.status===403||error.status===404){unavailable.push(name);return null;}throw error;}};

  const requests=listRequests(db,u,'','');
  const projects=read('المشاريع',()=>listProjects(db,u))??[];
  const leave=read('الإجازات',()=>listLeave(db,u));
  const base=portal(db,u,{requests,projects,leave});

  // «ما عليّ» مصدر كل ما ينتظر هذا الشخص: البطاقات والقوائم هنا، وشارة القائمة، و«بانتظار قراري»، و«العمل اليومي» تقرؤه كلها.
  const mine=obligations(db,u,{requests,projects});
  const clocks=new Map(),clockFor=r=>{if(!clocks.has(r.id))clocks.set(r.id,clockOf(db,u,r));return clocks.get(r.id);};
  // «طلباتي المفتوحة»: القائمة الموحدة نفسها التي تفتحها البطاقة (طلبات الدليل والإجازات والمصروفات والخطابات…).
  // كانت البطاقة تعدّ الموحدة (5) والقائمة تعرض طلبات الدليل وحدها (2) تحت العنوان نفسه.
  const catalogRows=new Map(requests.map(r=>[r.id,r]));
  const mineOpen=mine.watching.map(w=>{
    const row=w.source==='catalog'?catalogRows.get(w.id):null;
    if(row){const held=clockFor(row);return requestRow(row,held.clock,stepOf(db,u,held.request,held.clock));}
    return {id:w.id,title:w.title,service_name:[w.kind,w.module_status].filter(Boolean).join(' · '),status:w.status,status_name:w.status_name,updated_at:w.updated_at,link:w.link,
      clock:null,due_on:w.due_on,overdue:w.overdue,time_note:w.due_on?`الموعد ${w.due_on}${w.overdue?' · فات':''}`:'بلا زمن مستهدف معتمد بعد'};
  });
  // الأقدم أولًا: عمر الانتظار بأيام العمل منذ وصل البند إلى هذا الشخص.
  const decisions=mine.items.filter(i=>i.bucket==='decide').map(decisionRow).sort((a,b)=>b.age_days-a.age_days);
  const requestApprovals=decisions.filter(d=>d.source==='requests');
  const respond=mine.items.filter(i=>i.bucket==='respond'&&!i.optional).map(decisionRow);
  // «مهامي» = سلة «أنفّذ» كاملة: مهام الطلبات والمشاريع بلا سقف، والمهام الخاصة، وما تباشره أو ينتظر في طابور إدارتك.
  const tasks=mine.items.filter(i=>i.bucket==='do').map(taskRow);

  // الخدمات الأكثر استخدامًا: محسوبة من تاريخ طلبات هذا الشخص وحده (routing.usedServices)، لا من قائمة ثابتة في الكود.
  const topServices=usedServices(db,u);

  const myDocuments=read('انتهاء الوثائق',()=>expiringSoon(db,u))??[];
  const ownDocuments=myDocuments.filter(d=>d.scope==='own');

  const home={
    generated_at:now(),today:day,
    me:{id:base.me.id,name:base.me.name,role:base.me.role,department:base.me.department},
    unread:base.unread,
    decisions,respond,my_requests:mineOpen,tasks,
    obligation_counts:mine.counts,waiting_limit_days:mine.waiting_limit_days,
    leave:base.leave,
    top_services:topServices,
    top_services_note:topServices.length?'محسوبة من طلباتك السابقة.':'لا طلبات سابقة لك بعد، فلا نقترح قائمة ثابتة. ابدأ من دليل الخدمات.',
    my_documents:ownDocuments.filter(d=>d.status!=='ok').map(d=>({id:d.id,name:d.doc_kind_name,expires_on:d.expires_on,days_left:d.days_left,status:d.status,configured:d.configured,link:d.link})),
    my_documents_note:ownDocuments.some(d=>!d.configured)?'بعض أنواع وثائقك بلا مدة تذكير مسجلة، فلا يقال عنها إنها «تقترب من الانتهاء» قبل أن يدخل مالك الإجراء مدتها بمصدرها.':'',
    manager:null,hr:null,finance:null,executive:null,department:null,
    discipline:disciplineSummary(db,u),
    cards:[],unavailable,
    today_card:todayCard(db,u,{day,leave,mineOpen,tasks,documents:ownDocuments}),
    quick_actions:quickActions(db,u,base.leave,!!leave?.statutory?.ready),
    note:'كل رقم هنا من مصدره لحظيًا، وكل بطاقة تفتح شاشتها.',
    note_more:'لا يظهر رقم لا تملك تفصيله: كل بطاقة تُبنى من القائمة المعروضة تحتها ورقمها طول تلك القائمة. المنصة لا تتصل بجهة خارجية ولا ترسل تنبيهًا خارجها.'
  };
  // لوحة تعذرت قراءتها في «ما عليّ» عطلٌ لا تصريح ناقص، فلا تُخلط بقائمة «خارج صلاحيتك» أعلاه؛ تُعرض في «بانتظار قراري» و«العمل اليومي».
  home.obligations_unavailable=mine.unavailable;
  // ما أعدتُه وينتظر صاحبه: متابعة لا التزام — لا بطاقة له ولا رقم في «ما ينتظر قراري».
  home.returned_by_me=mine.returned_by_me??[];

  // المدير: فريقه المباشر، وأقدم اعتماد معلق عليه، وتجاوزات المدة في إدارته — كلها من الطلبات التي يراها هو.
  // عمل الإدارة المفتوح يُقرأ مرة واحدة: يعرضه قسم المدير كما كان، ويقرؤه «شغل إدارتي» منه بلا حساب ثانٍ.
  // وnull هنا ليست قائمةً فارغة: الفرق بين «قُرئ ولا شيء فيه» و«لم يُقرأ» هو الفرق بين رقمٍ تملك تفصيله ورقمٍ لا تملكه.
  let departmentReturnedRows=null,departmentHeldRows=null;
  const team=db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND manager_id=? AND active=1 ORDER BY name').all(u.tenant_id,u.id);
  if(u.role==='manager'||team.length){
    departmentReturnedRows=read('الطلبات المعادة في إدارتي',()=>departmentReturned(db,u));
    departmentHeldRows=read('ما تنفّذه إدارتي',()=>departmentHeldWork(db,u));
    const teamIds=new Set(team.map(p=>p.id)),byId=new Map(team.map(p=>[p.id,p.name]));
    const visibleOpen=requests.filter(r=>OPEN.includes(r.status)).map(r=>{const {request,clock}=clockOf(db,u,r);return {row:requestRow(r,clock),raw:request,requester_id:r.requester_id};});
    home.manager={
      team_size:team.length,
      team_late:visibleOpen.filter(x=>teamIds.has(x.requester_id)&&x.row.clock?.overdue).map(x=>({...x.row,requester_name:byId.get(x.requester_id)??''})),
      // pending_approvals: كل ما ينتظر اعتماد المدير (القسم المعنون «اعتماداتي المعلقة» في الواجهة يعرضه كاملًا، فلا يقول
      // «لا اعتماد معلق عليك» وفي الصندوق قرارات). request_approvals: طلبات الدليل منها، وهي ما تعدّه بطاقة «طلبات تنتظر اعتمادي».
      pending_approvals:decisions,request_approvals:requestApprovals,
      oldest_approval:decisions.length?decisions[0]:null,
      department_overruns:visibleOpen.filter(x=>x.raw&&x.row.clock?.overdue&&handlingDepartment(db,x.raw)===u.department_id).map(x=>x.row),
      // الموجة 2: عمل الإدارة المفتوح الذي لا يراه مديرها في قائمة طلباته — المعاد إلى صاحبه قبل أن يصل إدارته (بيانات وصفية بلا حمولة)،
      // وما هو «قيد التنفيذ» في إدارته وعند من (ليعيد إسناده إن غاب منفّذه). لمدير الإدارة كما يعرفه محرك الطلبات وحده.
      department_returned:departmentReturnedRows??[],
      department_held:departmentHeldRows??[],
      scope_note:'محسوب من الطلبات التي تراها أنت بصلاحيتك، لا من كل طلبات الكيان.'
    };
  }

  // «شغل إدارتي»: الإدارة التي ينتمي إليها صاحب الحساب، وشاشاتها، وشغلها المفتوح كما قرأه هو بصلاحيته.
  // لا قسم لحساب الأدمن (لا شغل إدارة له)، ولا لإدارة بلا صفحة (ops تقنية بلا خدمات بقصد فلا شاشة لها في السجل).
  // القوائم الثلاث مأخوذة كما هي من قسم المدير: من ليس مدير إدارته تعيدها مصادرها فارغة، فلا يُعدّ ما لا يملكه.
  const ownDepartment=u.role==='admin'?null:base.me.department??null;
  const departmentScreenRows=ownDepartment?departmentScreens(u):[];
  if(ownDepartment&&departmentScreenRows.length)home.department={
    id:ownDepartment.id,name:ownDepartment.name,link:`#departments/${ownDepartment.id}`,
    screens:departmentScreenRows,
    overruns:home.manager?.department_overruns??[],
    held:departmentHeldRows??[],
    // المعاد إلى صاحبه متابعةٌ لا التزام: الكرة عند صاحب الطلب وساعة الخدمة موقوفة، فلا بطاقة له في أعلى الصفحة.
    returned:departmentReturnedRows??[],
    // الشغل يُعرض لمن قُرئ له: مدير الإدارة. لغيره القسم شاشاتٌ بلا أرقام — ورقمٌ بلا تفصيلٍ تملكه أسوأ من غيابه.
    work_read:!!home.manager&&Array.isArray(departmentHeldRows),
    scope_note:'شاشات إدارتك وشغلها المفتوح كما تشوفه أنت بصلاحيتك، ما هو كل شغل الشركة.'
  };

  // الموارد البشرية: الوثائق المنتهية والمقتربة، والعقود المنتهية، وطلبات الوحدة المفتوحة.
  if(can(db,u,'employees.view')){
    // رقم الوثيقة يصل مقنّعًا (آخر أربعة أرقام)؛ يُعاد التقنيع هنا حتى لا يعتمد العرض على مصدر واحد.
    const documents=myDocuments.filter(d=>d.doc_kind.startsWith('employee.')).map(d=>({...d,reference:maskReference(d.reference)}));
    const contractsBoard=read('عقود الموظفين',()=>listContracts(db,u));
    home.hr={
      expired_documents:documents.filter(d=>d.status==='expired'),
      due_soon_documents:documents.filter(d=>d.status==='due_soon'),
      unconfigured_kinds:[...new Set(documents.filter(d=>!d.configured).map(d=>d.doc_kind_name))],
      ended_contracts:contractsBoard?contractsBoard.alerts.filter(a=>a.kind==='contract_expired'):[],
      ending_contracts:contractsBoard?contractsBoard.alerts.filter(a=>a.kind==='contract_ending'):[],
      pending_requests:requests.filter(r=>OPEN.includes(r.status)&&r.requester_id!==u.id).map(r=>requestRow(r,clockOf(db,u,r).clock)),
      scope_note:'الوثائق والعقود من مصادرها القائمة؛ الطلبات هي ما تعرضه لك شاشة الطلبات بصلاحيتك.'
    };
  }

  // المالية: كل قسم من لوحته الخاصة بصلاحية المستخدم نفسه. ما لا يُقرأ لا يُعرض عدده.
  const receivables=read('مستحقات العملاء',()=>listReceivables(db,u));
  const payables=read('أوامر الدفع',()=>listPayables(db,u));
  const finance=read('الدفتر المالي',()=>listFinance(db,u));
  // B29: السجل يسمي كل مصدر رُفض، لكن الصفحة لا تذكر لموظف مصادر المالية التي لا يملكها أصلًا؛ ذكرها يوحي بأن شيئًا ينقصه.
  home.unavailable_notice=unavailable.filter(name=>!FINANCE_SOURCES.includes(name));
  if(receivables||payables||finance){
    home.finance={
      overdue_receivables:receivables?receivables.claims.filter(c=>c.aging_bucket==='متأخر').map(c=>({id:c.id,due_date:c.due_date,amount_minor:c.amount_minor,balance_minor:c.balance_minor,link:'#receivables'})):null,
      pending_payment_orders:payables?payables.orders.filter(o=>o.status==='pending').map(o=>({id:o.id,vendor_name:o.vendor_name,amount_minor:o.amount_minor,link:'#payables'})):null,
      open_periods:finance?finance.periods.filter(p=>p.status==='open').map(p=>({id:p.id,name:p.name,starts_on:p.starts_on,ends_on:p.ends_on,link:'#finance'})):null,
      scope_note:'أوامر الدفع المعتمدة ليست مدفوعة حتى يوثَّق تنفيذها بنكيًا؛ المنصة لا تنفذ تحويلًا.'
    };
  }

  // القيادة: أرقام مجمّعة فقط. `executiveOverview` نفسه لا يعيد أسماء أشخاص، ونقتصر هنا على مجاميعه.
  // الشرط هو شرط المسار نفسه (تصريح executive.view): كان هنا فحص دور وهناك فحص تصريح، فظهر الزر لمن يرفضه المسار.
  if(canReadExecutive(db,u)){
    const overview=read('اللوحة التنفيذية',()=>executiveOverview(db,u));
    if(overview)home.executive={scope:overview.scope,totals:overview.totals,by_status:overview.by_status,attention:overview.attention,link:'#executive'};
  }

  const openCases=home.discipline?home.discipline.rows.filter(r=>!['decided','notified','withdrawn','not_proven','lapsed'].includes(r.status)):[];
  home.cards=[
    card('decisions','ما ينتظر قراري',decisions,'#work',decisions.length?'is-due':''),
    // ما أُعيد إليك أو طُلب فيه ردّك. تظهر حين يوجد ما يُرد عليه فقط؛ الاختياري (استبيان، إعادة فتح، مسودة) لا يدخلها.
    ...(respond.length?[card('respond','ما ينتظر ردّي',respond,'#work',respond.some(r=>r.overdue)?'is-late':'is-due')]:[]),
    card('my_requests','طلباتي المفتوحة',mineOpen,'#my-requests',mineOpen.some(r=>r.clock?.overdue||r.overdue)?'is-late':''),
    card('tasks','مهامي',tasks,'#work',tasks.some(t=>t.overdue)?'is-late':''),
    // رصيد الإجازة كمية حقيقية لا طول قائمة.
    figure('leave','رصيد إجازتي',leaveCardValue(base.leave,Number(day.slice(0,4))),'#leave'),
    card('my_documents','وثائقي المقتربة من الانتهاء',home.my_documents,'#profile',home.my_documents.some(d=>d.status==='expired')?'is-late':home.my_documents.length?'is-due':''),
    // البطاقة لا تُبنى إلا لمن عليه قضية أو جزاء؛ لغيره لا أثر لها على الصفحة. قضايا مفتوحة = قائمتها؛ وإلا فعدد الجزاءات السارية كمية.
    ...(home.discipline?[openCases.length?card('discipline','مخالفاتي وجزاءاتي',openCases,'#my-discipline',home.discipline.needs_you?'is-due':'')
      :figure('discipline','مخالفاتي وجزاءاتي',home.discipline.penalties,'#my-discipline',home.discipline.needs_you?'is-due':'')]:[]),
    ...(home.manager?[
      card('team_late','طلبات فريقي المتأخرة',home.manager.team_late,'#requests',home.manager.team_late.length?'is-late':''),
      // كانت «اعتماداتي المعلقة» وتعدّ طلبات الدليل وحدها؛ سُمّيت بما هي: طلبات الدليل التي تنتظر اعتماد هذا المدير، جزء من «ما ينتظر قراري».
      card('request_approvals','طلبات تنتظر اعتمادي',home.manager.request_approvals,'#work',home.manager.request_approvals.length?'is-due':''),
      card('department_overruns','تجاوزات المدة في إدارتي',home.manager.department_overruns,'#requests',home.manager.department_overruns.length?'is-late':'')
    ]:[]),
    // ولا بلاطة في أعلى الصفحة لشغل الإدارة: أعداده مكتوبة على كتلها في «شغل إدارتي» حيث قوائمها معروضة تحتها،
    // وهي القاعدة نفسها التي بُنيت عليها البطاقة — رقمٌ يُقرأ بعيدًا عن قائمته هو الذي أنتج تعريفين لعبارة واحدة.
    ...(home.hr?[
      card('expired_documents','وثائق منتهية',home.hr.expired_documents,'#expiry',home.hr.expired_documents.length?'is-late':''),
      card('due_soon_documents','وثائق تقترب من الانتهاء',home.hr.due_soon_documents,'#expiry',home.hr.due_soon_documents.length?'is-due':''),
      card('ended_contracts','عقود منتهية',home.hr.ended_contracts,'#contracts',home.hr.ended_contracts.length?'is-late':''),
      card('hr_requests','طلبات الموارد البشرية المفتوحة',home.hr.pending_requests,'#requests')
    ]:[]),
    ...(home.finance?[
      ...(home.finance.overdue_receivables?[card('overdue_receivables','مستحقات متأخرة',home.finance.overdue_receivables,'#receivables',home.finance.overdue_receivables.length?'is-late':'')]:[]),
      ...(home.finance.pending_payment_orders?[card('pending_payment_orders','أوامر دفع معلقة',home.finance.pending_payment_orders,'#payables',home.finance.pending_payment_orders.length?'is-due':'')]:[]),
      ...(home.finance.open_periods?[card('open_periods','فترات غير مقفلة',home.finance.open_periods,'#finance')]:[])
    ]:[])
  ].filter(c=>c.value!==null);
  return home;
}
