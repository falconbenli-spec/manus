import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds, capabilityGap } from './access.mjs';
import { submitClaim } from './expenses.mjs';
import { travelNotice } from './module-notices.mjs';
import { refuse } from './refusal.mjs';
import { acceptedRule, ruleOrDraft, roundMoney, addDays, daysBetween, riyadhToday, GRADES } from './payroll-rules.mjs';
// تعميم الانتداب (الترحيل 112): جدول البدل صار نسخًا مؤرخة، ودرجات التذاكر وضوابط الإقرار وازدواج العمل الإضافي معها.
import { versionInForce, parametersWithVersion, perDiemBreakdown, secondmentRounding, assertSecondmentControls, attestationOf, ticketsOf, gradeCodeOf, GRADE_NAMES, TICKET_CLASS_NAMES } from './secondment-benefits.mjs';

// الانتداب (م63–65): قرار يحدد المهمة والمدة وتاريخي البداية والنهاية، وتمديد لا يتجاوز الحد إلا بعد بحث ما أنجز وبقرار صاحب الصلاحية،
// والبدل اليومي بالدرجة داخل المملكة وخارجها، بعتبات المسافة، ويُخفض إلى الربع مع السكن والنقل وإلى النصف مع السكن وحده.
// البدل يُقترح حركة راتب «مقترحة» يعتمدها حامل اعتماد الرواتب؛ والتأشيرات والرسوم مطالبات مصروفات بمستنداتها (م65/5). لا صرف من هنا.
export const STATUS_NAMES={proposed:'مقترح بانتظار قرار صاحب الصلاحية',approved:'قرار انتداب معتمد',rejected:'مرفوض',cancelled:'ملغى'};
export const HOUSING=[['none','لا سكن من المنشأة'],['company','سكن توفره المنشأة'],['company_temporary','سكن مؤقت من المنشأة (لا يؤثر في البدل)'],['third_party','سكن من جهة أخرى على حسابها (لا يؤثر)'],['third_party_charged','سكن من جهة أخرى تُحمَّل تكلفته على المنشأة']].map(([key,name])=>({key,name}));
export const TRANSPORT=[['none','لا نقل من المنشأة'],['company','وسيلة تنقل توفرها المنشأة'],['third_party','نقل من جهة أخرى على حسابها (لا يؤثر)'],['third_party_charged','نقل من جهة أخرى تُحمَّل تكلفته على المنشأة']].map(([key,name])=>({key,name}));
export const ROADS=[['paved','طريق مسفلت'],['unpaved','طريق غير مسفلت'],['rough','طريق وعر لا تصله السيارات']].map(([key,name])=>({key,name}));
// النموذج الورقي «نموذج طلب انتداب»: صفّ الطيران فيه خيارا «حجز» و«بدون حجز» — والتذكرة نفسها وقيمتها في م41 وم65/4.
export const FLIGHT=[['booked','حجز طيران من المنشأة'],['none','بدون حجز — التذكرة على الموظف']].map(([key,name])=>({key,name}));
export const COST_KINDS=[['visa','رسوم تأشيرة'],['ticket','تذكرة'],['medical','فحص أو علاج غير مغطى'],['fees','رسوم مطارات أو رسوم أخرى'],['venue','استئجار مكان أداء المهمة'],['other','تكلفة أخرى لازمة للمهمة']].map(([key,name])=>({key,name}));
const PROVIDED_HOUSING=new Set(['company','third_party_charged']),PROVIDED_TRANSPORT=new Set(['company','third_party_charged']);
const id=()=>randomUUID();
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','الانتداب لحسابات الموظفين وبس');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','الكتابة تبي معاملة قاعدة بيانات');}
const payrollStaff=(db,u)=>['payroll.prepare','payroll.review','payroll.approve'].some(k=>holds(db,u,k));

// ————— فئة بلا سند محسوم: رفض مكتوب لا قيمة مخمَّنة (الترحيل 155) —————
// تعميم الانتداب 30 سبتمبر 2026 يذكر ثلاث فئات: العاملون 700/900، ومدراء الإدارات 900/1200، ونواب الرئيس 1000/1500.
// وفيه فجوتان لم يحسمهما المالك: لا يذكر الرئيس التنفيذي إطلاقًا، و«مدراء الإدارات» فيه مقابل «مدراء العموم» في م65
// دون تأكيد أنهما فئة واحدة. الترحيل 112 كان ينقل قيم م65 المنسوخة إلى صفّ الرئيس التنفيذي في نسخة التعميم ويطبعها
// في سند القرار منسوبةً إلى التعميم، ويسوّي بين الاسمين بلا تأكيد — قيمتان مخمَّنتان تُقترحان على الرواتب بلا كلمة.
// الآن تُقرأ الفجوة قبل الحساب ويُرفض رفضًا مكتوبًا: لا مبلغ، ولا حركة راتب، ولا اعتماد.
export const gradeBasisGap=(db,versionCode,grade)=>versionCode&&grade
  ?db.prepare('SELECT * FROM secondment_grade_basis_gaps WHERE version_code=? AND grade=?').get(versionCode,grade)??null
  :null;
// شكل الرفض المقروء والمهيكل معًا: ما رُفض، وما الناقص ومن يملكه ومعه سنده المؤرَّخ، والخطوة التالية.
export const basisRefusal=gap=>({what:gap.what,
  missing:[{document:gap.document,why:`${gap.why} السند: ${gap.source}`,owner:gap.owner,owner_role:gap.owner_role}],
  next:gap.next_step});
const refuseGradeBasis=gap=>refuse(409,'grade_basis_missing',basisRefusal(gap));

// ————— أيام الانتداب: الفعلية حين تُعرف —————
// م65/1: «يُصرف للعامل المنتدب داخل / خارج المملكة عن كل يوم فعلي يقضيه خارج مقر عمله، ويبدأ حساب هذا البدل من
// يوم الانتداب الفعلي الذي يُحدّد في قرار الانتداب، وينتهي بانتهاء مدته». فالنموذج الورقي يسأل «بداية ونهاية
// الانتداب الفعلية» إلى جانب «من تاريخ / إلى تاريخ»، والعدّ على الفعلية حين تُعرف والمخططة حين لا تُعرف.
export function effectiveDates(t){
  const actual=!!t.actual_start_date&&!!t.actual_end_date&&t.actual_end_date>=t.actual_start_date;
  return actual?{start:t.actual_start_date,end:t.actual_end_date,dates_basis:'actual'}
    :{start:t.start_date,end:t.end_date,dates_basis:'planned'};
}
export const effectiveDays=t=>{const {start,end}=effectiveDates(t);return daysBetween(start,end)+1;};

// البدل: دالة صرفة تُختبر وحدها. params من سياسة الانتداب المقبولة.
export function computePerDiem(params,{scope,distance_km,road_type,grade,housing,transport,days}){
  const rate=params.grades[grade]?.[scope==='abroad'?'abroad_minor':'domestic_minor'];
  if(rate===undefined)fail(400,'grade','الدرجة هذي ما هي في جدول البدل');
  if(scope==='domestic'){
    const threshold=params.distance_km[road_type];
    if(threshold===undefined||!Number.isInteger(distance_km))fail(400,'distance','الانتداب داخل المملكة يبي المسافة ونوع الطريق');
    if(distance_km<threshold)return {eligible:false,reason:`المسافة ${distance_km} كم أقل من ${threshold} كم لهذا النوع من الطرق (م64/3)`,days,daily_rate_minor:rate,factor_bp:0,allowance_minor:0};
  }
  const house=PROVIDED_HOUSING.has(housing),move=PROVIDED_TRANSPORT.has(transport);
  const factor=house&&move?params.housing_and_transport_bp:house?params.housing_only_bp:10000;
  const reason=house&&move?'خُفض إلى الربع لتوفير السكن ووسيلة التنقل (م65/2)':house?'خُفض إلى النصف لتوفير السكن فقط (م65/2)':'بدل كامل';
  return {eligible:true,reason,days,daily_rate_minor:rate,factor_bp:factor,allowance_minor:Number((BigInt(rate)*BigInt(days)*BigInt(factor)+5000n)/10000n)};
}

const FIELD_NAMES={housing:'السكن',transport:'المواصلات',distance_km:'المسافة بالكيلومتر',road_type:'نوع الطريق',grade:'درجة الانتداب'};
// ————— الحساب التلقائي قبل القرار —————
// المبلغ وخطواته ودرجة الإركاب المستحقة تُقرأ قبل الاعتماد لا بعده: الموظف يعرف ما يستحقه، وكل معتمد يوازن
// الغرض بالتكلفة وهي مكتوبة أمامه. ويُعاد الحساب في كل قراءة من التواريخ السارية، فتغيّر التاريخ يغيّر المبلغ
// بلا إجراء. قراءةٌ لا تُعطِب: ما ينقص يُقال، وما لا سند له يُرفض في الشاشة بالنص نفسه الذي يرفض به القرار.
function allowancePreview(db,t,params,live){
  const {start,end,dates_basis}=effectiveDates(t),days=daysBetween(start,end)+1;
  const rate=live?.grades[t.grade],base={days,dates_basis,from:start,to:end,
    ticket_class:rate?.ticket_class??null,ticket_class_name:rate?.ticket_class?TICKET_CLASS_NAMES[rate.ticket_class]:null,
    ticket_class_source:rate?.ticket_class_source??null,ticket_class_conflict:rate?.ticket_class_conflict||null};
  if(!t.grade)return {...base,ready:false,note:'حدّد درجة الانتداب من جدول البدل فوق، وينحسب المبلغ على طول'};
  const gap=gradeBasisGap(db,live?.code,t.grade);
  if(gap)return {...base,ready:false,blocked:true,note:gap.what,refusal:basisRefusal(gap)};
  const need=['housing','transport',...(t.scope==='domestic'?['distance_km','road_type']:[])].filter(k=>t[k]===null);
  if(need.length)return {...base,ready:false,note:`كمّل هذي وينحسب المبلغ: ${need.map(k=>FIELD_NAMES[k]).join('، ')}`};
  try{
    const result=computePerDiem(parametersWithVersion(params,live),
      {scope:t.scope,distance_km:t.distance_km,road_type:t.road_type,grade:t.grade,housing:t.housing,transport:t.transport,days});
    const rounding=secondmentRounding(db,t.tenant_id,start,live),allowance=roundMoney(result.allowance_minor,rounding.mode);
    if(!result.eligible)return {...base,ready:true,eligible:false,allowance_minor:0,note:result.reason,steps:[result.reason]};
    const breakdown=perDiemBreakdown({grade_code:gradeCodeOf(t.grade),grade_name:GRADE_NAMES[gradeCodeOf(t.grade)],scope:t.scope,
      daily_rate_minor:result.daily_rate_minor,days,factor_bp:result.factor_bp,factor_reason:result.reason,
      rounding:rounding.mode,rounding_note:rounding.source_note,version_title:live?.title});
    return {...base,ready:true,eligible:true,daily_rate_minor:result.daily_rate_minor,factor_bp:result.factor_bp,
      allowance_minor:allowance,formula:breakdown.formula,steps:breakdown.steps};
  }catch(error){
    // قراءة الشاشة لا تُعطب بخطأ حساب: السبب يُقال في مكانه، والقرار نفسه يرفض بالرسالة الكاملة.
    return {...base,ready:false,note:error?.message??'ما نقدر نحسب المبلغ بالمعطيات الحالية'};
  }
}

function travelView(db,u,t,params,authority){
  const own=t.user_id===u.id,actions=[];
  if(t.status==='proposed'&&authority&&!own&&t.proposed_by!==u.id)actions.push('approve_travel','reject_travel');
  if(t.status==='proposed'&&(own||t.proposed_by===u.id))actions.push('cancel_travel');
  const extensions=db.prepare('SELECT * FROM travel_extensions WHERE travel_id=? ORDER BY created_at').all(t.id).map(x=>({...x,requested_by_name:personName(db,x.requested_by),decided_by_name:personName(db,x.decided_by),
    actions:x.status==='proposed'&&authority&&x.requested_by!==u.id&&!own?['approve_extension','reject_extension']:[]}));
  const usedExt=extensions.filter(x=>x.status!=='rejected').reduce((n,x)=>n+x.days,0);
  if(t.status==='approved'&&(own||t.proposed_by===u.id||managerOf(db,t.user_id)===u.id||authority)&&usedExt<params.extension_max_days&&!extensions.some(x=>x.status==='proposed'))actions.push('request_extension');
  if(t.status==='approved'&&own)actions.push('submit_receipt');
  const receipts=db.prepare('SELECT l.cost_kind,c.id,c.amount_minor,c.status,c.receipt_reference,c.expense_date FROM travel_expense_links l JOIN expense_claims c ON c.id=l.claim_id WHERE l.travel_id=? ORDER BY c.created_at').all(t.id);
  const adjustment=t.adjustment_id?db.prepare('SELECT id,month,amount_minor,status FROM payroll_adjustments WHERE id=?').get(t.adjustment_id):null;
  // الترحيل 112: النسخة السارية في تاريخ البداية، وإقرار المدير حين تلزمه النسخة، وتذاكر م41 المسجلة.
  // والتاريخ هو البداية الفعلية حين تُعرف (م65/1، الترحيل 155)، فقرارٌ مضى يبقى على نسخة يومه الفعلي.
  const dates=effectiveDates(t);
  const live=versionInForce(db,t.tenant_id,dates.start),attestation=attestationOf(db,t.id);
  const manager=managerOf(db,t.user_id);
  if(!attestation&&t.status==='proposed'&&(manager===u.id||authority)&&t.user_id!==u.id)actions.push('record_attestation');
  if(t.status==='approved'&&(own||manager===u.id||authority))actions.push('record_ticket');
  return {...t,basis:t.basis?JSON.parse(t.basis):null,employee_name:personName(db,t.user_id),proposed_by_name:personName(db,t.proposed_by),decided_by_name:personName(db,t.decided_by),
    allowance_version:live?{id:live.id,code:live.code,title:live.title,effective_from:live.effective_from,rounding:live.rounding,requires_attestation:live.requires_attestation}:null,
    attestation:attestation?{attested_by_name:personName(db,attestation.attested_by),statement:attestation.statement,created_at:attestation.created_at}:null,
    attestation_required:!!live?.requires_attestation,tickets:ticketsOf(db,t.tenant_id,t.id),
    status_name:STATUS_NAMES[t.status],own,days_total:daysBetween(dates.start,dates.end)+1,dates_basis:dates.dates_basis,
    // الحساب التلقائي: قبل القرار تقديرٌ يُعاد حسابه من التواريخ السارية، وبعده سند القرار المجمَّد هو المرجع.
    allowance_preview:t.status==='proposed'?allowancePreview(db,t,params,live):null,
    extension_days_used:usedExt,extension_days_left:Math.max(0,params.extension_max_days-usedExt),
    missing_details:['distance_km','road_type','grade','housing','transport'].filter(k=>t[k]===null&&!(t.scope==='abroad'&&['distance_km','road_type'].includes(k))),
    extensions,receipts,adjustment,actions};
}
const managerOf=(db,userId)=>db.prepare('SELECT manager_id FROM users WHERE id=?').get(userId)?.manager_id??null;
export function travelBoard(db,supplied){
  const u=actor(db,supplied),today=riyadhToday(),rule=ruleOrDraft(db,u.tenant_id,'travel_per_diem',today),authority=holds(db,u,rule.parameters.authority_capability);
  const live=versionInForce(db,u.tenant_id,today);
  const all=authority||payrollStaff(db,u);
  const rows=all?db.prepare('SELECT * FROM travel_decisions WHERE tenant_id=? ORDER BY created_at DESC LIMIT 300').all(u.tenant_id)
    :db.prepare('SELECT * FROM travel_decisions WHERE tenant_id=? AND (user_id=? OR proposed_by=? OR user_id IN (SELECT id FROM users WHERE manager_id=?)) ORDER BY created_at DESC').all(u.tenant_id,u.id,u.id,u.id);
  const list=rows.map(t=>travelView(db,u,t,rule.parameters,authority));
  const team=db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND (id=? OR manager_id=?) ORDER BY name").all(u.tenant_id,u.id,u.id);
  return {today,user_id:u.id,authority,status_names:STATUS_NAMES,housing:HOUSING,transport:TRANSPORT,roads:ROADS,flight:FLIGHT,cost_kinds:COST_KINDS,
    // الفئة التي لا سند لها في النسخة السارية تُعرض بفجوتها لا بمبلغها (الترحيل 155): المبلغ يُحجب، والناقص ومالكه مكتوبان.
    grades:GRADES.map(g=>{
      const gap=gradeBasisGap(db,live?.code,g),rate=live?.grades[g];
      return {key:g,grade_code:gradeCodeOf(g),...rule.parameters.grades[g],
        ...(rate?{domestic_minor:rate.domestic_minor,abroad_minor:rate.abroad_minor,ticket_class:rate.ticket_class,
          ticket_class_name:TICKET_CLASS_NAMES[rate.ticket_class],ticket_class_source:rate.ticket_class_source,
          ticket_class_conflict:rate.ticket_class_conflict}:{}),
        ...(gap?{domestic_minor:null,abroad_minor:null,basis_gap:basisRefusal(gap)}:{basis_gap:null})};
    }),
    allowance_version:live?{id:live.id,code:live.code,title:live.title,effective_from:live.effective_from,rounding:live.rounding,
      mileage_rate_minor:live.mileage_rate_minor,requires_attestation:live.requires_attestation,articles:live.articles}:null,
    rule:{active:rule.active,id:rule.id,articles:rule.articles,distance_km:rule.parameters.distance_km,extension_max_days:rule.parameters.extension_max_days,
      housing_and_transport_bp:rule.parameters.housing_and_transport_bp,housing_only_bp:rule.parameters.housing_only_bp},
    team,decisions:list,
    awaiting_me:[...list.filter(t=>t.actions.includes('approve_travel')).map(t=>({id:t.id,title:`انتداب ${t.employee_name} — ${t.destination}`,created_at:t.created_at,actions:['approve_travel']})),
      ...list.flatMap(t=>t.extensions.filter(x=>x.actions.length).map(x=>({id:x.id,title:`تمديد انتداب ${t.employee_name} ${x.days} يوم`,created_at:x.created_at,actions:['approve_extension']})))],
    note:'قرار الانتداب يحدد المهمة والمدة والتاريخين. البدل اليومي من جدول الدرجات في سياسة الانتداب بعد قبول مدير الموارد البشرية، ويُقترح حركة راتب يعتمدها معتمد الرواتب. التأشيرات والرسوم تُطالب بها كمصروفات بمستنداتها الأصلية. المنصة لا تحجز ولا تصرف.'};
}

function cleanDetails(input,scope,required){
  const out={};
  if(input.distance_km!==undefined&&input.distance_km!==null&&input.distance_km!==''){if(!Number.isInteger(input.distance_km)||input.distance_km<0||input.distance_km>20000)fail(400,'distance_km','المسافة بالكيلومتر رقم صحيح');out.distance_km=input.distance_km;}
  if(input.road_type){if(!ROADS.some(r=>r.key===input.road_type))fail(400,'road_type','اختر نوع الطريق من القائمة');out.road_type=input.road_type;}
  if(input.grade){if(!GRADES.includes(input.grade))fail(400,'grade','اختر الدرجة من جدول البدل اللي فوق');out.grade=input.grade;}
  if(input.housing){if(!HOUSING.some(h=>h.key===input.housing))fail(400,'housing','اختر حالة السكن من القائمة');out.housing=input.housing;}
  if(input.transport){if(!TRANSPORT.some(h=>h.key===input.transport))fail(400,'transport','اختر حالة التنقل من القائمة');out.transport=input.transport;}
  if(required){
    const need=['grade','housing','transport',...(scope==='domestic'?['distance_km','road_type']:[])].filter(k=>out[k]===undefined);
    if(need.length)fail(400,'details_required',`كمّل هذي قبل القرار: ${need.map(k=>FIELD_NAMES[k]??k).join('، ')}`);
  }
  return out;
}
// وجهة النموذج الورقي مفصّلة: «داخلية (المدينة)» أو «خارجية (الدولة والمدينة)»، ومعها صفّ الطيران (حجز / بدون حجز).
// الدولة تُطلب للخارجي وحده؛ ومدينة بلا دولة في انتداب خارجي وجهةٌ ناقصة لا تُحجز عليها تذكرة.
function cleanPlace(input,scope){
  const out={};
  if(input.city!==undefined&&input.city!==null&&input.city!=='')out.city=v.text(input.city,'المدينة',120,2);
  if(input.country!==undefined&&input.country!==null&&input.country!=='')out.country=v.text(input.country,'الدولة',120,2);
  if(input.flight){if(!FLIGHT.some(f=>f.key===input.flight))fail(400,'flight','اختر حالة الطيران: حجز ولا بدون حجز');out.flight=input.flight;}
  if(scope==='domestic'&&out.country!==undefined)fail(400,'country','الانتداب داخل المملكة ما له دولة — خلّ المدينة وبس');
  return out;
}
// التاريخان الفعليان: يُدخلان معًا لأن يومًا واحدًا منهما لا يكوّن مدة، وترتيبهما يُفحص كما يُفحص المخططان.
function cleanActualDates(input,t){
  const has=k=>input[k]!==undefined&&input[k]!==null&&input[k]!=='';
  if(!has('actual_start_date')&&!has('actual_end_date'))return {};
  if(!has('actual_start_date')||!has('actual_end_date'))
    fail(400,'actual_dates','بداية ونهاية الانتداب الفعلية تُدخلان معًا — واحد منهما ما يكوّن مدة');
  const start=v.date(input.actual_start_date),end=v.date(input.actual_end_date);
  if(end<start)fail(400,'actual_date_order','خلّ نهاية الانتداب الفعلية بعد بدايته الفعلية');
  return {actual_start_date:start,actual_end_date:end};
}
export function proposeTravel(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['user_id','task','destination','scope','start_date','end_date','distance_km','road_type','grade','housing','transport','source_request_id',
    'city','country','flight','actual_start_date','actual_end_date']);
  const traveler=input.user_id&&input.user_id!==u.id?db.prepare("SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id):u;
  if(!traveler)fail(404,'not_found','ما لقينا الموظف هذا');
  const rule=ruleOrDraft(db,u.tenant_id,'travel_per_diem');
  if(traveler.id!==u.id&&traveler.manager_id!==u.id&&!holds(db,u,rule.parameters.authority_capability)&&!holds(db,u,'people.manage'))fail(403,'not_permitted','الانتداب يقترحه الموظف لنفسه، ولا مديره المباشر');
  if(!['domestic','abroad'].includes(input.scope))fail(400,'scope','حدد: داخل المملكة ولا خارجها');
  const start=v.date(input.start_date),end=v.date(input.end_date);
  if(end<start)fail(400,'date_order','خلّ تاريخ النهاية بعد تاريخ البداية');
  const d=cleanDetails(input,input.scope,false),place=cleanPlace(input,input.scope),actual=cleanActualDates(input,null),travelId=id(),time=now();
  db.prepare("INSERT INTO travel_decisions(id,tenant_id,user_id,proposed_by,source_request_id,task,destination,scope,start_date,end_date,city,country,flight,actual_start_date,actual_end_date,distance_km,road_type,grade,housing,transport,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'proposed',?,?)")
    .run(travelId,u.tenant_id,traveler.id,u.id,input.source_request_id??null,v.text(input.task,'المهمة المطلوبة',2000,5),v.text(input.destination,'مكان الانتداب',200,2),input.scope,start,end,
      place.city??null,place.country??null,place.flight??null,actual.actual_start_date??null,actual.actual_end_date??null,
      d.distance_km??null,d.road_type??null,d.grade??null,d.housing??null,d.transport??null,time,time);
  audit(db,u,'travel_decision',travelId,'travel.proposed',{}, {user_id:traveler.id,scope:input.scope,start_date:start,end_date:end});
  travelNotice(db,u,'proposed',db.prepare('SELECT * FROM travel_decisions WHERE id=?').get(travelId),{capability:rule.parameters.authority_capability});
  return {id:travelId};
}

function travelRow(db,u,travelId){
  const t=typeof travelId==='string'&&db.prepare('SELECT * FROM travel_decisions WHERE id=? AND tenant_id=?').get(travelId,u.tenant_id);
  if(!t)fail(404,'not_found','ما لقينا قرار الانتداب هذا');
  return t;
}
// الشهر الذي تُقترح فيه الحركة: شهر نهاية الانتداب، أو أول شهر لاحق لم يتجاوز مسيره المسودة.
function payrollMonth(db,tenantId,date){
  let month=date.slice(0,7);
  for(let i=0;i<24&&db.prepare("SELECT 1 FROM payroll_runs WHERE tenant_id=? AND month=? AND status IN ('in_review','reviewed','approved')").get(tenantId,month);i++){
    const [y,m]=month.split('-').map(Number);month=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
  }
  return month;
}
// الحركة مقترحة باسم صاحب القرار، ويعتمدها حامل اعتماد الرواتب (شخص آخر بقيد الجدول).
function proposeAllowance(db,u,t,amount,reason,sourceKind,sourceId){
  if(amount<=0)return null;
  const adjustmentId=id(),month=payrollMonth(db,u.tenant_id,t.end_date);
  db.prepare("INSERT INTO payroll_adjustments(id,tenant_id,user_id,kind,month,amount_minor,reason,status,proposed_by,created_at) VALUES(?,?,?,'allowance',?,?,?,'proposed',?,?)").run(adjustmentId,u.tenant_id,t.user_id,month,amount,reason,u.id,now());
  db.prepare('INSERT INTO payroll_adjustment_classes(adjustment_id,tenant_id,class,reference,source_kind,source_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(adjustmentId,u.tenant_id,'travel_per_diem',`انتداب ${t.id}`,sourceKind,sourceId,u.id,now());
  audit(db,u,'payroll_adjustment',adjustmentId,'adjustment.proposed',{}, {user_id:t.user_id,kind:'allowance',month,source:`${sourceKind}:${sourceId}`});
  return adjustmentId;
}
export function travelAction(db,supplied,travelId,action,input){
  writing(db);const u=actor(db,supplied);
  // م65/1: يوم الانتداب الفعلي «يُحدّد في قرار الانتداب» — فالتاريخان الفعليان يُدخلان مع القرار، والنموذج الورقي يسألهما.
  const fields={approve_travel:['grade','housing','transport','distance_km','road_type','actual_start_date','actual_end_date','note'],reject_travel:['note'],cancel_travel:['note'],request_extension:['days','progress_review'],submit_receipt:['cost_kind','expense_date','amount','receipt_reference','description']}[action];
  if(!fields)fail(404,'not_found','ما فيه إجراء بهذا الاسم على الانتداب');
  v.object(input,['version',...fields]);
  const t=travelRow(db,u,travelId),today=riyadhToday(),rule=ruleOrDraft(db,u.tenant_id,'travel_per_diem',today),authority=holds(db,u,rule.parameters.authority_capability);
  const current=travelView(db,u,t,rule.parameters,authority);
  if(!current.own&&t.proposed_by!==u.id&&managerOf(db,t.user_id)!==u.id&&!authority&&!payrollStaff(db,u))fail(404,'not_found','ما لقينا قرار الانتداب هذا');
  v.version(input.version,t.version);
  // D-14: الرفض يسمّي الحالة والمتاح والتصريح الناقص، بدل نص عام يترك الموظف بلا خطوة تالية.
  if(!current.actions.includes(action)){
    const gap=capabilityGap(db,u.tenant_id,rule.parameters.authority_capability,{exclude:[t.user_id,t.proposed_by]});
    v.actionUnavailable(action,{subject:'قرار الانتداب',state_name:current.status_name??t.status,available:current.actions,
      names:{approve_travel:'اعتماد الانتداب',reject_travel:'رفض الانتداب',cancel_travel:'إلغاء الانتداب',request_extension:'طلب التمديد',submit_receipt:'تسجيل إيصال'},
      reason:['approve_travel','reject_travel'].includes(action)&&(t.proposed_by===u.id||t.user_id===u.id)
        ?'صاحب الانتداب ومقترحه لا يقرران فيه (فصل المهام)':'حالة القرار لا تقبل هذا الإجراء أو لا يحمله تصريحك',
      who:['approve_travel','reject_travel'].includes(action)?gap.text:null});
  }
  const time=now();
  if(action==='approve_travel'){
    // التواريخ الفعلية تُحدَّد في القرار (م65/1)، وعليها يقوم العدّ واختيار النسخة والتقريب.
    const actual=cleanActualDates(input,t),onRow={...t,...actual},dates=effectiveDates(onRow),days=daysBetween(dates.start,dates.end)+1;
    const accepted=acceptedRule(db,u.tenant_id,'travel_per_diem',dates.start);
    if(!accepted)fail(409,'policy_required','جدول بدل الانتداب لسّه مسودة وما قبلها مدير الموارد البشرية — وما ينحسب بدل قبل قبوله');
    // النسخة السارية في تاريخ بداية الانتداب: قرار مضى يبقى على قيم نسخته ولو سرى تعميم بعده.
    const liveVersion=versionInForce(db,u.tenant_id,dates.start);
    assertSecondmentControls(db,{...onRow,start_date:dates.start,end_date:dates.end},liveVersion);
    const d={...Object.fromEntries(['distance_km','road_type','grade','housing','transport'].map(k=>[k,t[k]]).filter(([,x])=>x!==null)),...cleanDetails(input,t.scope,false)};
    cleanDetails(d,t.scope,true);
    // فئة بلا سند محسوم في النسخة السارية: رفض مكتوب قبل أي حساب (الترحيل 155). لا مبلغ ولا حركة راتب ولا اعتماد.
    const gap=gradeBasisGap(db,liveVersion?.code,d.grade);
    if(gap)refuseGradeBasis(gap);
    const params=parametersWithVersion(accepted.parameters,liveVersion);
    const result=computePerDiem(params,{scope:t.scope,...d,days});
    // م50/5: قاعدة التقريب المقبولة هي المرجع إن كانت سارية في تاريخ الانتداب؛ حقل النسخة احتياط لما سرى قبل قبولها.
    const rounding=secondmentRounding(db,u.tenant_id,dates.start,liveVersion),mode=rounding.mode,allowance=roundMoney(result.allowance_minor,mode);
    // الحساب كاملًا بخطواته، يقرؤه الموظف وكل معتمد في كل خطوة.
    const breakdown=result.eligible?perDiemBreakdown({grade_code:gradeCodeOf(d.grade),grade_name:GRADE_NAMES[gradeCodeOf(d.grade)],scope:t.scope,
      daily_rate_minor:result.daily_rate_minor,days,factor_bp:result.factor_bp,factor_reason:result.reason,rounding:mode,rounding_note:rounding.source_note,version_title:liveVersion?.title}):null;
    const basis={...result,allowance_minor:allowance,rounding:mode,rounding_source:rounding.source,rounding_note:rounding.source_note,
      policy_title:accepted.title,articles:[...accepted.articles,...(rounding.source==='pay_rules'&&!accepted.articles.includes('م50/5')?['م50/5']:[])],rule:'البدل = البدل اليومي للدرجة × الأيام الفعلية × نسبة التخفيض',
      allowance_version_id:liveVersion?.id??null,allowance_version_title:liveVersion?.title??null,allowance_version_from:liveVersion?.effective_from??null,
      dates_basis:dates.dates_basis,counted_from:dates.start,counted_to:dates.end,
      steps:breakdown?breakdown.steps:[result.reason]};
    db.prepare("UPDATE travel_decisions SET status='approved',distance_km=?,road_type=?,grade=?,housing=?,transport=?,actual_start_date=?,actual_end_date=?,policy_id=?,eligible=?,days=?,daily_rate_minor=?,factor_bp=?,allowance_minor=?,basis=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?")
      .run(d.distance_km??null,d.road_type??null,d.grade,d.housing,d.transport,onRow.actual_start_date??null,onRow.actual_end_date??null,accepted.id,result.eligible?1:0,days,result.daily_rate_minor,result.factor_bp,allowance,JSON.stringify(basis),u.id,time,input.note?v.text(input.note,'ملاحظة القرار',2000):'',time,t.id);
    const adjustmentId=result.eligible?proposeAllowance(db,u,{...t,end_date:dates.end},allowance,`بدل انتداب ${days} يوم — ${t.destination} (م65)`,'travel_decision',t.id):null;
    if(adjustmentId)db.prepare('UPDATE travel_decisions SET adjustment_id=?,version=version+1,updated_at=? WHERE id=?').run(adjustmentId,time,t.id);
    audit(db,u,'travel_decision',t.id,'travel.approved',{status:'proposed'},{status:'approved',eligible:result.eligible,days,adjustment_id:adjustmentId});
    // الإشعار بلا مبلغ: البدل حركة راتب مقترحة، وقيمتها تُقرأ في الشاشة.
    travelNotice(db,u,'approved',db.prepare('SELECT * FROM travel_decisions WHERE id=?').get(t.id),{capability:rule.parameters.authority_capability});
    return {id:t.id,allowance_minor:allowance,eligible:result.eligible,reason:result.reason,adjustment_id:adjustmentId};
  }
  if(action==='reject_travel'||action==='cancel_travel'){
    const status=action==='reject_travel'?'rejected':'cancelled';
    if(action==='reject_travel')db.prepare('UPDATE travel_decisions SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(status,u.id,time,v.text(input.note,'السبب',2000,5),time,t.id);
    else db.prepare('UPDATE travel_decisions SET status=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(status,input.note?v.text(input.note,'السبب',2000):'سحبه مقترحه',time,t.id);
    audit(db,u,'travel_decision',t.id,'travel.'+status,{status:t.status},{status});
    travelNotice(db,u,status,db.prepare('SELECT * FROM travel_decisions WHERE id=?').get(t.id),{capability:rule.parameters.authority_capability});
    return {id:t.id,status};
  }
  if(action==='request_extension'){
    // حدّ اللهجة: «م64/1» رقم المادة، فيبقى بحرفه كما هو في اللائحة الموقّعة — الرقم هو ما يربط الجملة بسندها.
    // وما حوله («مجموع التمديد ما يتعدّى… والمستخدَم لين الحين…») كلام المنصة عن المادة لا اقتباس منها، فهو لهجة.
    if(!Number.isInteger(input.days)||input.days<1)fail(400,'days','أيام التمديد رقم صحيح موجب');
    if(current.extension_days_used+input.days>rule.parameters.extension_max_days)fail(409,'extension_limit',`مجموع التمديد ما يتعدّى ${rule.parameters.extension_max_days} يوم (م64/1) — والمستخدَم لين الحين ${current.extension_days_used}`);
    const extId=id();
    db.prepare("INSERT INTO travel_extensions(id,tenant_id,travel_id,days,new_end_date,progress_review,requested_by,status,created_at) VALUES(?,?,?,?,?,?,?,'proposed',?)")
      .run(extId,u.tenant_id,t.id,input.days,addDays(t.end_date,input.days),v.text(input.progress_review,'ما أُنجز من المهمة وما بقي والتثبت من بذل الجهد',3000,20),u.id,time);
    db.prepare('UPDATE travel_decisions SET version=version+1,updated_at=? WHERE id=?').run(time,t.id);
    audit(db,u,'travel_extension',extId,'travel.extension_requested',{}, {travel_id:t.id,days:input.days});
    travelNotice(db,u,'extension_requested',t,{days:input.days,capability:rule.parameters.authority_capability});
    return {id:extId};
  }
  // إيصال تأشيرة أو رسوم: مطالبة مصروفات عادية بتصنيف «سفر وانتداب» تمر بالمدير ثم المالية، مربوطة بقرار الانتداب.
  if(!COST_KINDS.some(k=>k.key===input.cost_kind))fail(400,'cost_kind','اختر نوع التكلفة من القائمة');
  const claim=submitClaim(db,u,{expense_date:input.expense_date,category:'travel',description:`${COST_KINDS.find(k=>k.key===input.cost_kind).name} — انتداب إلى ${t.destination}: ${v.text(input.description,'البيان',1500,5)}`,amount:input.amount,receipt_reference:input.receipt_reference});
  db.prepare('INSERT INTO travel_expense_links(claim_id,travel_id,tenant_id,cost_kind,created_at) VALUES(?,?,?,?,?)').run(claim.id,t.id,u.tenant_id,input.cost_kind,time);
  db.prepare('UPDATE travel_decisions SET version=version+1,updated_at=? WHERE id=?').run(time,t.id);
  audit(db,u,'travel_decision',t.id,'travel.receipt_submitted',{}, {claim_id:claim.id,cost_kind:input.cost_kind});
  return {id:t.id,claim_id:claim.id};
}
export function extensionAction(db,supplied,extensionId,decision,input){
  writing(db);const u=actor(db,supplied);
  if(!['approve_extension','reject_extension'].includes(decision))fail(404,'not_found','القرار لازم يكون اعتماد التمديد ولا رفضه');
  v.object(input,['note']);
  const x=typeof extensionId==='string'&&db.prepare("SELECT * FROM travel_extensions WHERE id=? AND tenant_id=? AND status='proposed'").get(extensionId,u.tenant_id);
  if(!x)fail(404,'not_found','ما لقينا طلب تمديد ينتظر قرار');
  const t=travelRow(db,u,x.travel_id),rule=acceptedRule(db,u.tenant_id,'travel_per_diem',t.start_date)??ruleOrDraft(db,u.tenant_id,'travel_per_diem');
  if(!holds(db,u,rule.parameters.authority_capability))fail(403,'not_permitted','تمديد الانتداب بقرار صاحب الصلاحية وبس');
  if(x.requested_by===u.id||t.user_id===u.id)fail(409,'separation_of_duties','اللي طلب التمديد وصاحب الانتداب ما يقررون فيه');
  const time=now(),note=v.text(input.note,decision==='approve_extension'?'أساس القرار بعد بحث ما أنجز':'سبب الرفض',2000,decision==='approve_extension'?5:10);
  if(decision==='reject_extension'){
    db.prepare("UPDATE travel_extensions SET status='rejected',decided_by=?,decided_at=?,decision_note=? WHERE id=?").run(u.id,time,note,x.id);
    audit(db,u,'travel_extension',x.id,'travel.extension_rejected',{status:'proposed'},{status:'rejected'},note);
    travelNotice(db,u,'extension_rejected',t,{days:x.days,capability:rule.parameters.authority_capability});
    return {id:x.id,status:'rejected'};
  }
  if(!acceptedRule(db,u.tenant_id,'travel_per_diem',t.start_date))fail(409,'policy_required','جدول بدل الانتداب ما انقبل لين الحين');
  const used=db.prepare("SELECT COALESCE(SUM(days),0) AS n FROM travel_extensions WHERE travel_id=? AND status='approved'").get(t.id).n;
  if(used+x.days>rule.parameters.extension_max_days)fail(409,'extension_limit',`مجموع التمديد ما يتعدّى ${rule.parameters.extension_max_days} يوم (م64/1)`);
  const basis=JSON.parse(t.basis??'{}'),per=basis.eligible?Number((BigInt(basis.daily_rate_minor)*BigInt(x.days)*BigInt(basis.factor_bp)+5000n)/10000n):0;
  const amount=roundMoney(per,basis.rounding??'halala');
  db.prepare('UPDATE travel_decisions SET end_date=?,version=version+1,updated_at=? WHERE id=?').run(x.new_end_date,time,t.id);
  const adjustmentId=basis.eligible?proposeAllowance(db,u,{...t,end_date:x.new_end_date},amount,`بدل تمديد انتداب ${x.days} يوم — ${t.destination} (م64/1، م65)`,'travel_extension',x.id):null;
  db.prepare("UPDATE travel_extensions SET status='approved',decided_by=?,decided_at=?,decision_note=?,allowance_minor=?,adjustment_id=? WHERE id=?").run(u.id,time,note,amount,adjustmentId,x.id);
  audit(db,u,'travel_extension',x.id,'travel.extension_approved',{status:'proposed'},{status:'approved',days:x.days,adjustment_id:adjustmentId},note);
  travelNotice(db,u,'extension_approved',db.prepare('SELECT * FROM travel_decisions WHERE id=?').get(t.id),{days:x.days,capability:rule.parameters.authority_capability});
  return {id:x.id,status:'approved',allowance_minor:amount,adjustment_id:adjustmentId};
}

// من طلب الكتالوج ADM-TRAVEL بعد اعتماده: قرار انتداب مقترح بما في الطلب، وتكمل التفاصيل عند قرار صاحب الصلاحية.
// حقول الطلب هي حقول النموذج الورقي: نوع الرحلة والمدينة والدولة، وتاريخا «من / إلى»، والبداية والنهاية الفعلية،
// وصفوف الطيران والسكن والمواصلات (حجز / بدون حجز). وصفَّا السكن والمواصلات هما مدخل م65/2 نفسه: «حجز» يعني أن
// المنشأة وفّرته فيُخفض البدل، و«بدون حجز» يعني أنها لم توفره فلا يُخفض. فلا يُسأل الموظف السؤال نفسه مرتين.
const BOOKED=value=>value==='حجز'?'company':value==='بدون حجز'?'none':null;
// «خارجية» صيغة النموذج الورقي، و«خارجي» صيغة الطلبات المخزَّنة قبل مطابقته — الاثنتان تُقرآن حتى لا يصير
// انتدابٌ خارجيٌّ داخليًّا بصمت عند القراءة، وهو فرقٌ في البدل وفي درجة التذكرة معًا.
const ABROAD=new Set(['خارجية','خارجي']);
export function travelFromRequest(db,request){
  const p=JSON.parse(request.payload),time=now(),travelId=id();
  const start=p.start_date,end=p.end_date&&p.end_date>=p.start_date?p.end_date:p.start_date;
  const scope=ABROAD.has(p.travel_type)?'abroad':'domestic';
  const city=p.city?String(p.city).slice(0,120):null,country=scope==='abroad'&&p.country?String(p.country).slice(0,120):null;
  const where=[country,city].filter(Boolean).join(' — ')||String(p.destination||'—');
  const actualStart=p.actual_start_date||null,actualEnd=p.actual_end_date&&actualStart&&p.actual_end_date>=actualStart?p.actual_end_date:null;
  db.prepare("INSERT INTO travel_decisions(id,tenant_id,user_id,proposed_by,source_request_id,task,destination,scope,start_date,end_date,city,country,flight,actual_start_date,actual_end_date,housing,transport,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'proposed',?,?)")
    .run(travelId,request.tenant_id,request.requester_id,request.requester_id,request.id,
      String(p.purpose||request.title).slice(0,2000).padEnd(5,'.'),where.slice(0,200).padEnd(2,'.'),scope,start,end,
      city,country,p.flight==='حجز'?'booked':p.flight==='بدون حجز'?'none':null,
      actualEnd?actualStart:null,actualEnd,BOOKED(p.housing),BOOKED(p.transport),time,time);
  return travelId;
}
