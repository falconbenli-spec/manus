import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { notifySubject, dateRange } from './notices.mjs';
import { uploadFile } from './files.mjs';
import { holds } from './access.mjs';
import * as types from './leave-types.mjs';
import { daysText } from './static/leave-count.mjs';
import { compensatoryMovement } from './leave-compensatory.mjs';

const years=value=>{
  if(!Number.isInteger(value)||value<2000||value>2200) fail(400,'balance_year','سنة الرصيد مو صحيحة — اكتب سنة بين 2000 و2200');
  return value;
};
function leaveType(value) {
  const type=v.text(value,'نوع الإجازة',60);
  if(!/^[a-z][a-z0-9_-]{1,59}$/.test(type)) fail(400,'leave_type','رمز نوع الإجازة مو صحيح — اختر النوع من القائمة');
  return type;
}
// أسماء عربية لرموز أنواع الإجازة (B25): الرمز يبقى مفتاح التخزين، والاسم ما يراه الموظف. البادئة synthetic_ تعني
// رصيدًا أدخله HR للتجربة المحلية فيُذكر ذلك بجوار الاسم. رمز غير معروف يظهر «نوع إجازة آخر» مع رمزه لا رمزه وحده.
export const LEAVE_TYPES=[['annual','الإجازة السنوية'],['sick','الإجازة المرضية'],['marriage','إجازة الزواج'],['bereavement','إجازة الوفاة'],['paternity','إجازة المولود'],['maternity','إجازة الوضع'],['hajj','إجازة الحج'],['exam','إجازة الامتحان'],['unpaid','إجازة بدون أجر']].map(([code,name])=>({code,name}));
// أسماء أنواع اللائحة (ترحيل 098) تُضاف للعرض فقط؛ قائمة LEAVE_TYPES أعلاه تبقى خيارات الرصيد الافتتاحي كما كانت.
// تُبنى عند أول نداء لا عند تحميل الوحدة. هذه الوحدة وleave-types.mjs في دورة استيراد (leave → leave-types →
// payroll-extras → leave)، وقراءةُ REGULATION_LEAVE_TYPES في أعلى الملف تُنفَّذ قبل أن تُهيَّأ حين تكون وحدة
// أخرى هي المدخل: `Cannot access 'REGULATION_LEAVE_TYPES' before initialization`. الخادم ينجو بترتيب استيراده
// وحده، لكن hr-policies.mjs وleave-types.mjs لا يُحمَّلان منفردين — ولا يُحمَّلان في اختبار ولا سكربت.
// التأجيل يكسر الاعتماد الزمني بلا مساس بالقيم: الخريطة نفسها، وتُبنى مرة واحدة عند أول استعمال.
let typeNamesCache=null;
const typeNames=()=>typeNamesCache??=new Map([...types.REGULATION_LEAVE_TYPES.map(t=>[t.code,t.name_ar]),...LEAVE_TYPES.map(t=>[t.code,t.name])]);
export function leaveTypeName(code) {
  const raw=String(code??''),synthetic=raw.startsWith('synthetic_'),base=synthetic?raw.slice(10):raw;
  const name=typeNames().get(base)??`نوع إجازة آخر (${raw})`;
  return synthetic&&typeNames().has(base)?`${name} (رصيد تجريبي)`:name;
}
// D-06 (تدقيق مسارات الوحدات، 20 سبتمبر): إشعار الاعتماد كان يقول «سُجلت 60 يوم تقويمي» ولا شيء غير ذلك،
// و60 يومًا نصفها بـ75% ونصفها بلا أجر تقرأ كما تقرأ إجازة كاملة الأجر. أول ما يعرفه الموظف عن الخصم كان قسيمة الراتب.
// الشرائح تُقرأ من شروط الطلب نفسها (leave_request_terms.pay_json): كل يوم ونسبته، فتُجمع بنسبتها لا بعددها فقط.
const FULL_RATE=10000;
const rateName=bp=>bp>=FULL_RATE?'بأجر كامل':bp<=0?'بلا أجر':`بنسبة ${Number((bp/100).toFixed(2))}% من الأجر`;
export function paySummary(terms){
  if(!terms||!Array.isArray(terms.pay)||!terms.pay.length)return null;
  const byRate=new Map();
  for(const day of terms.pay){const bp=Number(day.rate_bp)||0;byRate.set(bp,(byRate.get(bp)??0)+(Number(day.milli)||1000));}
  const tiers=[...byRate.entries()].sort((a,b)=>b[0]-a[0]).map(([rate_bp,milli])=>({rate_bp,days:Number(daysText(milli)),name:rateName(rate_bp)}));
  const unpaidMilli=[...byRate.entries()].filter(([bp])=>bp<=0).reduce((n,[,m])=>n+m,0);
  const reducedMilli=[...byRate.entries()].filter(([bp])=>bp>0&&bp<FULL_RATE).reduce((n,[,m])=>n+m,0);
  const unit=terms.unit==='calendar'?'يوم تقويمي':'يوم عمل';
  return {tiers,fully_paid:tiers.every(t=>t.rate_bp>=FULL_RATE),unpaid_days:Number(daysText(unpaidMilli)),reduced_days:Number(daysText(reducedMilli)),
    text:tiers.map(t=>`${t.days} ${unit} ${t.name}`).join('، '),
    // لا مبلغ في الإشعار: المبلغ يُحسب في مسير الرواتب ولا يُذكر في إشعار داخل المنصة.
    effect:unpaidMilli||reducedMilli?'يُقترح على المسير خصم عن الأيام غير كاملة الأجر، ويعتمده معتمد الرواتب. راجع «الإجازات» و«قسائم راتبي».':'لا خصم على راتبك عن هذه الإجازة.'};
}
function actor(db,u) {
  const current=u&&db.prepare('SELECT id,name,tenant_id,department_id,role,manager_id,active FROM users WHERE id=? AND tenant_id=? AND active=1').get(u.id,u.tenant_id);
  if(!current||current.role==='admin') fail(403,'forbidden','الإجازات مو من صلاحية حسابك — كلّم خدمات الموظف');
  return current;
}
function employee(db,tenant,id) {
  return db.prepare("SELECT id,name,tenant_id,department_id,role,manager_id,active FROM users WHERE id=? AND tenant_id=? AND role<>'admin'").get(id,tenant);
}
function manager(db,e) {
  return e?.active&&db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND department_id=? AND role='manager' AND active=1 AND id<>?").get(e.manager_id,e.tenant_id,e.department_id,e.id);
}
function calendar(db,tenant,id) {
  return db.prepare('SELECT * FROM leave_calendars WHERE id=? AND tenant_id=?').get(id,tenant);
}
function inHrScope(u,e,c) {
  return u.role==='hr'&&u.tenant_id===e.tenant_id&&u.department_id===c?.hr_department_id&&e.department_id===c.employee_department_id;
}
function visible(db,u,b) {
  const e=employee(db,b.tenant_id,b.employee_id),c=calendar(db,b.tenant_id,b.calendar_id);
  return e&&b.tenant_id===u.tenant_id&&(u.id===e.id||(u.role==='manager'&&manager(db,e)?.id===u.id)||inHrScope(u,e,c));
}
function totals(db,bid) {
  const row=db.prepare('SELECT COALESCE(SUM(posted_delta),0) AS posted_days,COALESCE(SUM(reserved_delta),0) AS reserved_days FROM leave_ledger WHERE balance_id=?').get(bid);
  return {...row,available_days:row.posted_days-row.reserved_days};
}
// صاحب الصلاحية (م90، م91/5) يرى الطلب الذي يمر بخطوته فقط: ما كان مساره يتطلبه، أو ما قرر فيه.
function authorityScope(db,u,r) {
  if(!r||u.id===r.employee_id||!types.holdsAuthority(db,u)) return false;
  const t=types.termsOf(db,r);
  return !!t&&t.route==='manager_authority_hr'&&(['pending_hr','approved'].includes(r.status)||!!db.prepare('SELECT 1 FROM leave_authority_decisions WHERE request_id=? AND actor_id=?').get(r.id,u.id));
}
function balanceRecord(db,u,bid,r=null) {
  const b=db.prepare('SELECT * FROM leave_balances WHERE id=? AND tenant_id=?').get(bid,u.tenant_id);
  if(!b||!(visible(db,u,b)||authorityScope(db,u,r))) fail(404,'not_found','ما لقينا لك رصيد إجازة هنا — راجع خدمات الموظف');
  return b;
}
function requestRecord(db,u,rid) {
  const r=db.prepare('SELECT * FROM leave_requests WHERE id=? AND tenant_id=?').get(rid,u.tenant_id);
  if(!r) fail(404,'not_found','ما لقينا طلب الإجازة هذا، أو مو من صلاحيتك تشوفه');
  balanceRecord(db,u,r.balance_id,r);
  return r;
}
// المرحلة الفعلية: بين اعتماد المدير وخدمات الموظف قد تقع خطوة صاحب الصلاحية دون حالة جديدة في 006.
function stageOf(db,r,t=types.termsOf(db,r)) {
  if(r.status==='pending_hr'&&t?.route==='manager_authority_hr'&&types.authorityDecision(db,r)?.decision!=='approve') return 'pending_authority';
  return r.status;
}
function managerApprover(db,r) {
  return db.prepare("SELECT actor_id FROM leave_decisions WHERE request_id=? AND revision=? AND stage='manager' AND decision='approve'").get(r.id,r.revision)?.actor_id??null;
}
function requestActions(db,u,r) {
  const actions=[];
  if(r.employee_id===u.id) {
    if(r.status==='returned') actions.push('resubmit');
    // B20 (تدقيق 19 سبتمبر): الإجازة المعتمدة تُلغى قبل أن تبدأ فقط. بعد يوم البداية صارت إجازة مأخوذة،
    // وإلغاؤها كان يعيد أيامها إلى الرصيد (refund) فيُحسب الموظف حاضرًا ويسترد الأيام معًا.
    // تصحيح ما بدأ فعلًا قرار خدمات الموظف على سجل الحضور، لا زر إلغاء عند صاحب الطلب.
    if(['pending_manager','pending_hr','returned'].includes(r.status)) actions.push('cancel');
    else if(r.status==='approved'&&r.start_date>riyadhDate()) actions.push('cancel');
  } else {
    const e=employee(db,r.tenant_id,r.employee_id),b=balanceRecord(db,u,r.balance_id,r),c=calendar(db,r.tenant_id,b.calendar_id),stage=stageOf(db,r);
    if((stage==='pending_manager'&&u.role==='manager'&&manager(db,e)?.id===u.id)
      ||(stage==='pending_authority'&&types.holdsAuthority(db,u)&&managerApprover(db,r)!==u.id)
      ||(stage==='pending_hr'&&inHrScope(u,e,c))) actions.push('approve','return','reject');
    // B20: سحب إجازة بدأت أو انتهت قرار خدمات الموظف بسبب مكتوب، لا زر عند صاحبها. الأثر نفسه (رد الأيام وسحب أثر الأجر)
    // لكنه يمر بمن يملك تصحيح سجل الحضور والمسير، ويُقيَّد باسمه في سجل التدقيق.
    if(r.status==='approved'&&inHrScope(u,e,c)) actions.push('cancel');
  }
  return actions;
}
// العطل: قائمة التقويم القديمة مضافًا إليها العطل الرسمية المعتمدة في الحضور (مصدر واحد بعد ترحيل 098).
function unpackCalendar(c,db=null) {
  const own=JSON.parse(c.holidays_json),holidays=db?types.mergedHolidays(db,c.tenant_id,c):own;
  return {...c,weekdays:JSON.parse(c.weekdays_json),holidays,calendar_holidays:own,public_holidays:holidays.filter(d=>!own.includes(d)),weekdays_json:undefined,holidays_json:undefined};
}
export function riyadhDate(timestamp=now()) {
  const value=new Date(timestamp);
  if(!Number.isFinite(value.getTime())) fail(400,'invalid_timestamp','الطابع الزمني مو صحيح — حدّث الصفحة وجرّب من جديد');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const part=type=>parts.find(p=>p.type===type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function getLeaveBalance(db,user,bid) {
  const u=actor(db,user),b=balanceRecord(db,u,bid);
  return {...b,...totals(db,b.id),leave_type_name:leaveTypeName(b.leave_type),employee_name:employee(db,b.tenant_id,b.employee_id).name,
    calendar:unpackCalendar(calendar(db,b.tenant_id,b.calendar_id),db),
    ledger:db.prepare('SELECT * FROM leave_ledger WHERE balance_id=? ORDER BY seq').all(b.id)};
}
// أثر الإجازة على الأجر كما يقرأه صاحبها: الحالة بكلماتها، والأيام المتأثرة، والمبلغ متى اقتُرح.
// «بانتظار التسعير» حالة معلنة لا فراغ: قرار سياسة ناقص، والخصم لم يصل المسير بعد ولم يسقط.
const PAY_EFFECT_WORDS={
  proposed:'خصم مقترح في المسير — يعتمده حامل تصريح اعتماد الرواتب، ولم يُخصم بعد',
  unpriced:'بانتظار التسعير — لم تُحسم بعد سياسة تحدد أجر اليوم لهذه الأيام، فلم يُحسب مبلغ ولم يصل المسير. الخصم قائم ولم يسقط.',
  withdrawn:'مسحوب بعد إلغاء الإجازة'};
// وحال الأثر في سجله يبقى «مقترحًا» بعد أن يُعتمد خصمه ويُصرف، فيُقرأ بجواره ما آلت إليه حركته في الرواتب (deduction_status)
// وشهر المسير المعتمد الذي صُرف فيه (paid_month) — من قاعدة الصرف الواحدة التي يحكم بها سحب الأثر (paidDeduction في leave-types.mjs).
function payEffectsOf(db,r) {
  return db.prepare('SELECT id,month,dates_json,lost_bp_days,amount_minor,adjustment_id,status,note,created_at FROM leave_pay_effects WHERE request_id=? ORDER BY month,created_at').all(r.id)
    .map(e=>({id:e.id,month:e.month,dates:JSON.parse(e.dates_json),lost_days:String(e.lost_bp_days/10000),
      amount_minor:e.amount_minor,status:e.status,status_name:PAY_EFFECT_WORDS[e.status]??e.status,pending_pricing:e.status==='unpriced',note:e.note,
      deduction_status:e.adjustment_id?db.prepare('SELECT status FROM payroll_adjustments WHERE id=?').get(e.adjustment_id)?.status??null:null,
      paid_month:types.paidDeduction(db,e.adjustment_id)?.run_month??null}));
}
export function getLeaveRequest(db,user,rid) {
  const u=actor(db,user),r=requestRecord(db,u,rid),b=balanceRecord(db,u,r.balance_id,r),t=types.termsOf(db,r);
  const authority=db.prepare('SELECT d.revision,d.decision,d.note,d.created_at,d.actor_id,x.name AS actor_name FROM leave_authority_decisions d JOIN users x ON x.id=d.actor_id WHERE d.request_id=? ORDER BY d.revision').all(r.id);
  const documents=t?db.prepare("SELECT f.id,f.label,f.filename,f.created_at,x.name AS uploaded_by_name FROM stored_files f JOIN users x ON x.id=f.uploaded_by WHERE f.tenant_id=? AND f.entity_type='leave_request' AND f.entity_id=? ORDER BY f.created_at").all(r.tenant_id,r.id):[];
  const stage=stageOf(db,r,t),policy=t?db.prepare('SELECT parameters FROM leave_type_policies WHERE id=?').get(t.policy_id):null,type=policy?JSON.parse(policy.parameters).types.find(x=>x.code===t.leave_type):null;
  const effects=payEffectsOf(db,r);
  return {...r,work_dates:JSON.parse(r.work_dates_json),work_dates_json:undefined,leave_type:b.leave_type,leave_type_name:leaveTypeName(b.leave_type),balance_year:b.balance_year,
    // الأيام بقيمتها الدقيقة (نصف يوم = 0.5) ووحدتها؛ الطلب القديم أيام عمل كاملة كما كان.
    days:t?Number(daysText(t.days_milli)):r.days,unit:t?.unit??'working',unit_name:types.UNIT_NAMES[t?.unit??'working'],
    stage,stage_name:{pending_manager:'بانتظار المدير',pending_authority:'بانتظار صاحب الصلاحية',pending_hr:'بانتظار خدمات الموظف',returned:'معاد للتعديل',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغى'}[stage],
    terms:t?{policy_id:t.policy_id,unit:t.unit,days:daysText(t.days_milli),counted_dates:t.counted_dates,half_day:t.half_day,variant:t.variant,variant_name:type?.variants?.find(x=>x.key===t.variant)?.name_ar??null,event_date:t.event_date,
      source:t.source,source_name:types.SOURCE_NAMES[t.source],route:t.route,route_name:types.ROUTE_NAMES[t.route],pay:t.pay,pay_summary:paySummary(t),document_required:t.document_required,documents_needed:type?.documents??[],warnings:t.warnings,articles:type?.articles??[],articles_text:type?types.articlesText(type):''}:null,
    // D-01a: أثر الإجازة على الأجر يُقرأ في سجل الإجازة نفسه. البند بانتظار التسعير يُقال صراحةً ولا يُعرض فراغًا،
    // فلا يظن صاحبه أن لا خصم عليه. المبلغ يظهر بعد اقتراحه فقط، والاعتماد قرار مستقل لحامل تصريح الرواتب.
    // وpay_summary يقول القاعدة قبل الاقتراح: الاثنان يجيبان سؤالين مختلفين ولا يغني أحدهما عن الآخر.
    pay_effects:effects,
    // خصم هذه الإجازة صُرف في مسير معتمد: صاحبها لا يلغيها بنفسه (يُرفض بـpaid_leave_effect في withdrawPayEffects)، بل تلغيها خدمات
    // الموظف فيُقترح ردّ الخصم. القاعدة قاعدة السحب نفسها، فلا تعرض الشاشة لصاحبها زرّ إلغاء يُرفض.
    pay_effect_paid:effects.some(x=>x.status!=='withdrawn'&&x.paid_month!==null),
    documents,can_attach:!!t&&r.employee_id===u.id&&['pending_manager','pending_hr','returned'].includes(r.status),
    employee_name:employee(db,r.tenant_id,r.employee_id).name,actions:requestActions(db,u,r),authority_decisions:authority,
    decisions:db.prepare('SELECT d.*,u.name AS actor_name FROM leave_decisions d JOIN users u ON u.id=d.actor_id WHERE request_id=? ORDER BY revision,created_at,id').all(r.id),
    versions:db.prepare('SELECT revision,snapshot_json,created_at FROM leave_request_versions WHERE request_id=? ORDER BY revision').all(r.id).map(x=>({revision:x.revision,snapshot:JSON.parse(x.snapshot_json),created_at:x.created_at}))};
}
export function listLeave(db,user) {
  const u=actor(db,user),allCalendars=db.prepare('SELECT * FROM leave_calendars WHERE tenant_id=? ORDER BY effective_from,id').all(u.tenant_id);
  const calendars=allCalendars.filter(c=>c.employee_department_id===u.department_id||(u.role==='hr'&&c.hr_department_id===u.department_id));
  const employees=db.prepare("SELECT id,name,department_id,manager_id FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name,id").all(u.tenant_id)
    .filter(e=>e.id===u.id||(u.role==='manager'&&e.manager_id===u.id&&e.department_id===u.department_id)||(u.role==='hr'&&calendars.some(c=>c.hr_department_id===u.department_id&&c.employee_department_id===e.department_id)));
  const balances=db.prepare('SELECT * FROM leave_balances WHERE tenant_id=? ORDER BY balance_year DESC,employee_id,leave_type').all(u.tenant_id)
    .filter(b=>visible(db,u,b)).map(b=>getLeaveBalance(db,u,b.id));
  const allowed=new Set(balances.map(b=>b.id));
  const requests=db.prepare('SELECT * FROM leave_requests WHERE tenant_id=? ORDER BY updated_at DESC,id').all(u.tenant_id)
    .filter(r=>allowed.has(r.balance_id)||authorityScope(db,u,r)).map(r=>getLeaveRequest(db,u,r.id));
  const calendar_entries=requests.filter(r=>r.status==='approved').flatMap(r=>r.work_dates.map(date=>({request_id:r.id,employee_id:r.employee_id,employee_name:r.employee_name,date,leave_type:r.leave_type,leave_type_name:r.leave_type_name,balance_year:r.balance_year,status:'approved'})))
    .sort((a,b)=>a.date.localeCompare(b.date)||a.employee_id.localeCompare(b.employee_id));
  const today=riyadhDate(),year=Number(today.slice(0,4)),policy=types.acceptedLeavePolicy(db,u.tenant_id,today);
  // أنواع اللائحة المعتمدة وأرصدتها بأسمائها لصاحب الحساب، ومدى جاهزية تقديم الطلب.
  const own=employee(db,u.tenant_id,u.id),ownCalendars=db.prepare('SELECT * FROM leave_calendars WHERE tenant_id=? AND employee_department_id=? ORDER BY effective_from,id').all(u.tenant_id,u.department_id).map(c=>unpackCalendar(c,db));
  const statutory=policy?{policy_id:policy.id,title:policy.title,effective_from:policy.effective_from,year,
    types:types.orderLeaveTypes(policy.parameters.types).map(t=>({code:t.code,name_ar:t.name_ar,unit:t.unit,unit_name:types.UNIT_NAMES[t.unit],exclude_public_holidays:t.exclude_public_holidays,half_day:!!t.half_day,documents:t.documents,variants:t.variants??null,variant_optional:!!t.variant_optional,event_date:t.event_date??null,min_notice_days:t.limits?.min_notice_days??null,articles:t.articles,
      law_articles:t.law_articles??[],articles_text:types.articlesText(t),declaration_ar:t.eligibility?.declaration_ar??null,source:t.source,rules_ar:t.rules_ar,experience:types.leaveExperienceOf(t.code)})),
    balances:types.typeBalances(db,own,policy,year),own_calendars:ownCalendars,
    ready:ownCalendars.some(c=>c.effective_to>=today),missing:ownCalendars.some(c=>c.effective_to>=today)?null:'لم تُهيئ خدمات الموظف تقويم إجازات لإدارتك بعد. تستطيع الاطلاع على أنواعك وأرصدتك، والتقديم يتاح بعد التهيئة.'}:null;
  const hr=u.role==='hr',prepare=hr;
  const setup=hr||types.holdsAuthority(db,u)||['hr.policy.prepare','hr.policy.accept'].some(key=>holdsCap(db,u,key))?{
    policies:types.leavePolicies(db,u),draft_source:types.leaveTypesDraftSource(),
    can_prepare:holdsCap(db,u,'hr.policy.prepare'),can_accept:holdsCap(db,u,'hr.policy.accept'),can_create_calendar:prepare&&holdsCap(db,u,'hr.policy.prepare'),
    can_propose_holidays:holdsCap(db,u,'hr.attendance.manage'),
    departments:hr?db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id).map(d=>({...d,calendars:allCalendars.filter(c=>c.employee_department_id===d.id).map(c=>({id:c.id,name:c.name,effective_from:c.effective_from,effective_to:c.effective_to}))})):[],
    public_holidays:db.prepare("SELECT holiday_date,name,status FROM public_holidays WHERE tenant_id=? AND holiday_date>=? ORDER BY holiday_date LIMIT 80").all(u.tenant_id,`${year}-01-01`),
    // الراحة الأسبوعية في خطة العطل من سياسة ساعات العمل المعتمدة السارية في تاريخ كل عطلة (م81 مع م73(1))، لا من الشيفرة.
    holiday_plan:types.statutoryHolidayPlan(year,types.holidayPlanOptions(db,u.tenant_id,year)),holiday_notes:types.statutoryHolidayPlanWithNotes(year,types.holidayPlanOptions(db,u.tenant_id,year)).notes,year,
    pay_effects:hr?types.payEffectsView(db,u,requests.map(r=>r.id)):[],
    holiday_note:'مصدر العطل واحد: العطل الرسمية المعتمدة في شاشة الحضور. تُستثنى من أيام العمل في كل طلب، ومن الأيام التقويمية حيث تنص المادة. قائمة «الاستثناءات» في التقويمات القديمة تبقى مقروءة ولا تُضاف إليها عطل جديدة.'}:null;
  return {timezone:'Asia/Riyadh',operational_date:today,leave_types:LEAVE_TYPES,calendars:calendars.map(c=>unpackCalendar(c,db)),calendar_entries,employees,balances,requests,
    statutory,setup,authority:types.holdsAuthority(db,u)};
}
const holdsCap=(db,u,key)=>holds(db,u,key);
function validCalendar(c) {
  if(!c||c.synthetic!==1||c.timezone!=='Asia/Riyadh') fail(409,'calendar_unavailable','لازم تقويم محلي مصطنع مهيأ قبل هذي الخطوة');
  const weekdays=JSON.parse(c.weekdays_json),holidays=JSON.parse(c.holidays_json);
  if(!Array.isArray(weekdays)||!weekdays.length||weekdays.length>7||new Set(weekdays).size!==weekdays.length||weekdays.some(x=>!Number.isInteger(x)||x<0||x>6)||!Array.isArray(holidays)||holidays.length>366) fail(409,'calendar_invalid','إعداد أيام العمل مو صحيح — راجع سياسة ساعات العمل');
  v.date(c.effective_from);v.date(c.effective_to);
  for(const holiday of holidays) v.date(holiday);
  return {weekdays,holidays};
}
function route(db,e,c) {
  const m=manager(db,e);
  if(!m) fail(409,'routing_unavailable','لازم يكون في إدارة الموظف مدير نشط غيره — ما أحد يعتمد على نفسه');
  const h=db.prepare("SELECT id FROM users WHERE tenant_id=? AND department_id=? AND role='hr' AND active=1 AND id<>? AND id<>?").all(e.tenant_id,c.hr_department_id,e.id,m.id);
  if(!h.length) fail(409,'routing_unavailable','ما فيه معتمد نشط في خدمات الموظف مستقل عن الطلب داخل التقويم');
}
function calculate(db,e,b,input,excludeId='') {
  const start=v.date(input.start_date),end=v.date(input.end_date),c=calendar(db,e.tenant_id,b.calendar_id),config=validCalendar(c);
  if(end<start) fail(400,'date_order','تاريخ النهاية قبل تاريخ البداية — صحّح التواريخ');
  if(Number(start.slice(0,4))!==b.balance_year||Number(end.slice(0,4))!==b.balance_year) fail(400,'balance_year','الطلب يعبر سنة الرصيد — فرّقه طلبين، طلب لكل سنة');
  if(start<b.effective_date||start<c.effective_from||end>c.effective_to) fail(400,'calendar_range','الفترة خارج سريان رصيدك أو خارج التقويم المعتمد');
  if(e.department_id!==c.employee_department_id) fail(409,'scope_changed','تغيّر نطاق الموظف — لازم رصيد وتقويم معتمدين للنطاق الجديد');
  route(db,e,c);
  // العطل الرسمية المعتمدة في الحضور تُستثنى هنا أيضًا، مع ما كُتب في قائمة التقويم القديمة (مصدر واحد، ترحيل 098).
  const holidays=new Set(types.mergedHolidays(db,e.tenant_id,c)),dates=[];
  for(let ms=Date.parse(`${start}T00:00:00Z`),last=Date.parse(`${end}T00:00:00Z`);ms<=last;ms+=86400000) {
    const current=new Date(ms),day=current.toISOString().slice(0,10);
    if(config.weekdays.includes(current.getUTCDay())&&!holidays.has(day)) dates.push(day);
  }
  if(!dates.length) fail(400,'no_workdays','ما فيه ولا يوم عمل داخل هذي الفترة حسب التقويم');
  if(db.prepare("SELECT 1 FROM leave_requests WHERE tenant_id=? AND employee_id=? AND id<>? AND status IN ('pending_manager','pending_hr','approved') AND start_date<=? AND end_date>=?").get(e.tenant_id,e.id,excludeId,end,start)) fail(409,'leave_overlap','عندك طلب إجازة قائم يتداخل مع نفس الفترة');
  if(totals(db,b.id).available_days<dates.length) fail(409,'insufficient_balance','رصيدك ما يكفي أيام العمل اللي طلبتها');
  return {start_date:start,end_date:end,days:dates.length,work_dates_json:JSON.stringify(dates),reason:v.text(input.reason,'سبب الطلب',2000,3)};
}
function movement(db,u,bid,r,kind,note='',evidence='') {
  const delta={opening:[r.days,0],reserve:[0,r.days],release:[0,-r.days],debit:[-r.days,-r.days],refund:[r.days,0]}[kind];
  db.prepare('INSERT INTO leave_ledger(id,tenant_id,balance_id,request_id,revision,kind,posted_delta,reserved_delta,effective_date,actor_id,reason,evidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),u.tenant_id,bid,kind==='opening'?null:r.id,kind==='opening'?null:r.revision,kind,...delta,kind==='opening'?r.effective_date:r.start_date,u.id,note,evidence,now());
}
function saveVersion(db,r,plan=null) {
  const b=db.prepare('SELECT leave_type,balance_year,calendar_id FROM leave_balances WHERE id=?').get(r.balance_id);
  const extra=plan?{days:Number(daysText(plan.days_milli)),unit:plan.unit,counted_dates:plan.counted,half_day:plan.half_day,variant:plan.variant,event_date:plan.event_date,source:plan.source,route:plan.route}:{};
  db.prepare('INSERT INTO leave_request_versions VALUES(?,?,?,?)').run(r.id,r.revision,JSON.stringify({...b,employee_id:r.employee_id,start_date:r.start_date,end_date:r.end_date,days:r.days,work_dates:JSON.parse(r.work_dates_json),reason:r.reason,...extra}),now());
}
// الحركة على الرصيد بحسب مصدره: الافتتاحي في دفتر 006 بالأيام الكاملة، وما سواه في دفتر الأيام بالألف.
function move(db,u,bid,r,kind,note='') {
  const t=types.termsOf(db,r);
  if(!t||t.source==='opening') return movement(db,u,bid,r,kind,note);
  // الإجازة التعويضية تتحرك بالساعات على قيود العمل الإضافي نفسها (الأقدم أجلًا أولًا)، لا في دفتر الأيام.
  if(t.source==='overtime') return compensatoryMovement(db,u,r,t,kind,note);
  types.dayMovement(db,u,r,t,kind,note);
}

// إشعارات الإجازة (B6): للموظف عند كل قرار، وللمعتمد التالي حين يصل إليه الطلب. لا يُشعر أحد بفعله هو.
function leaveNotice(db,r,userId,kind,title,body) {
  notifySubject(db,{userId,kind,subjectKind:'leave_request',subjectId:r.id,title,body});
}
function hrApprovers(db,e,c,managerId) {
  return db.prepare("SELECT id FROM users WHERE tenant_id=? AND department_id=? AND role='hr' AND active=1 AND id<>? AND id<>?").all(e.tenant_id,c.hr_department_id,e.id,managerId??'').map(x=>x.id);
}
function noticeManager(db,e,r) {
  const m=manager(db,e);if(!m)return;
  leaveNotice(db,r,m.id,'leave_decision_needed',`طلب إجازة ينتظر قرارك: ${e.name} ${dateRange(r.start_date,r.end_date)}`,'افتح «الإجازات» لاعتماده أو إعادته أو رفضه.');
}

// The server wraps each mutation, its audit event, and createOnce in one transaction.
export function grantLeaveOpening(db,user,input) {
  const u=actor(db,user);
  if(u.role!=='hr') fail(403,'forbidden','إضافة الرصيد المصطنع لخدمات الموظف داخل نطاقها وبس');
  v.object(input,['employee_id','leave_type','balance_year','days','effective_date','reason','evidence','calendar_id']);
  const e=employee(db,u.tenant_id,v.text(input.employee_id,'الموظف',100)),c=calendar(db,u.tenant_id,v.text(input.calendar_id,'التقويم',100));
  if(!e?.active||!c||!inHrScope(u,e,c)||e.id===u.id) fail(403,'forbidden','الموظف خارج نطاق خدمات الموظف، أو الطلب على نفسك');
  validCalendar(c);
  const year=years(input.balance_year),type=leaveType(input.leave_type),effective=v.date(input.effective_date);
  if(!Number.isInteger(input.days)||input.days<1||input.days>366) fail(400,'leave_days','الأيام الافتتاحية لازم رقم صحيح بين 1 و366 في المثال المحلي');
  if(Number(effective.slice(0,4))!==year||effective<c.effective_from||effective>c.effective_to) fail(400,'balance_year','تاريخ الرصيد خارج السنة أو خارج التقويم المحدد');
  const reason=v.text(input.reason,'سبب الرصيد الافتتاحي',2000,3),evidence=v.text(input.evidence,'دليل الرصيد المصطنع',2000,3);
  // صف الرصيد قد يكون أُنشئ لطلب من نوع نظامي بلا حركة افتتاحية (ترحيل 098): يُضاف الافتتاحي إليه إن طابق التقويم.
  const existing=db.prepare('SELECT * FROM leave_balances WHERE tenant_id=? AND employee_id=? AND leave_type=? AND balance_year=?').get(u.tenant_id,e.id,type,year);
  if(existing&&(db.prepare("SELECT 1 FROM leave_ledger WHERE balance_id=? AND kind='opening'").get(existing.id)||existing.calendar_id!==c.id)) fail(409,'opening_exists','فيه رصيد افتتاحي مسجّل أصلًا لهذا الموظف والنوع والسنة');
  const bid=existing?.id??randomUUID();
  if(!existing) db.prepare('INSERT INTO leave_balances VALUES(?,?,?,?,?,?,?,?)').run(bid,u.tenant_id,e.id,type,year,c.id,effective,now());
  movement(db,u,bid,{days:input.days,effective_date:effective},'opening',reason,evidence);
  audit(db,u,'leave_balance',bid,'leave.opening',{}, {employee_id:e.id,leave_type:type,balance_year:year,days:input.days,calendar_id:c.id,effective_date:effective},reason);
  return getLeaveBalance(db,u,bid);
}
// حقول النوع النظامي (ترحيل 098): لا تُقبل قبل اعتماد سياسة أنواع الإجازات.
// declaration: إقرار مقدم الطلب الإلكتروني بهويته حيث يشترطه النوع (إجازة الحج، نظام العمل م114).
const STATUTORY_FIELDS=['half_day','variant','event_date','document','declaration'];
const policyAt=(db,u,date)=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?types.acceptedLeavePolicy(db,u.tenant_id,date):null;
function attachDocument(db,u,r,plan,document) {
  v.object(document,['filename','content']);
  const needed=plan.required_document??plan.type.documents.find(d=>d.required)??plan.type.documents[0];
  uploadFile(db,u,{entity_type:'leave_request',entity_id:r.id,label:needed?.name_ar??'مستند داعم لطلب الإجازة',filename:document.filename,content:document.content});
}
const unitWord=r=>r.unit==='calendar'?'يوم تقويمي':'يوم عمل';
function authorityHolders(db,e,exclude=[]) {
  return db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role<>'admin'").all(e.tenant_id).filter(x=>x.id!==e.id&&!exclude.includes(x.id)&&types.holdsAuthority(db,x)).map(x=>x.id);
}
function statutoryCreate(db,u,input,policy) {
  const plan=types.planRequest(db,u,input,policy),reason=v.text(input.reason,'سبب الطلب',2000,3);
  route(db,u,plan.calendar);
  if(plan.route==='manager_authority_hr'&&!authorityHolders(db,u,[manager(db,u)?.id]).length) fail(409,'routing_unavailable','ما فيه صاحب صلاحية نشط (hr.leave.authority) يعتمد الطلب غير المدير المباشر');
  if(input.document!==undefined) v.object(input.document,['filename','content']);
  const b=types.ensureBalanceRow(db,u,u,plan),rid=randomUUID(),timestamp=now();
  db.prepare("INSERT INTO leave_requests(id,tenant_id,employee_id,balance_id,start_date,end_date,days,work_dates_json,reason,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'pending_manager',?,?)")
    .run(rid,u.tenant_id,u.id,b.id,plan.start_date,plan.end_date,Math.ceil(plan.days_milli/1000),JSON.stringify(plan.work_dates),reason,timestamp,timestamp);
  const r=requestRecord(db,u,rid);types.saveTerms(db,r,plan,policy);saveVersion(db,r,plan);move(db,u,b.id,r,'reserve',reason);
  if(input.document!==undefined) attachDocument(db,u,r,plan,input.document);
  audit(db,u,'leave_request',rid,'leave.submitted',{}, {status:r.status,revision:r.revision,days:daysText(plan.days_milli),unit:plan.unit,leave_type:plan.code,source:plan.source,route:plan.route,balance_id:b.id});
  const days=daysText(plan.days_milli),held=['accrual','entitlement','opening','overtime'].includes(plan.source)?'محجوزة من رصيدك':'محسوبة';
  leaveNotice(db,r,u.id,'leave_submitted',`استلمنا طلب إجازتك ${dateRange(r.start_date,r.end_date)}`,`${plan.type.name_ar} · ${days} ${types.UNIT_NAMES[plan.unit]} ${held}. بانتظار موافقة مديرك.${plan.document_required&&input.document===undefined?' أرفق المستند المطلوب قبل أن يعتمده المدير.':''}`);
  noticeManager(db,u,r);
  return getLeaveRequest(db,u,rid);
}
export function createLeaveRequest(db,user,input) {
  const u=actor(db,user);
  v.object(input,['leave_type','balance_year','start_date','end_date','reason',...STATUTORY_FIELDS]);
  const policy=policyAt(db,u,input.start_date);
  if(policy) return statutoryCreate(db,u,input,policy);
  if(STATUTORY_FIELDS.some(key=>input[key]!==undefined)) fail(409,'policy_required','أنواع الإجازات النظامية لم يعتمدها مدير الموارد البشرية بعد؛ نصف اليوم والمستندات تُتاح بعد اعتمادها');
  const type=leaveType(input.leave_type),year=years(input.balance_year);
  const b=db.prepare('SELECT * FROM leave_balances WHERE tenant_id=? AND employee_id=? AND leave_type=? AND balance_year=?').get(u.tenant_id,u.id,type,year);
  if(!b) fail(409,'balance_unavailable','ما انضاف رصيد افتتاحي لهذا النوع وهذي السنة');
  const values=calculate(db,u,b,input),rid=randomUUID(),timestamp=now();
  db.prepare("INSERT INTO leave_requests(id,tenant_id,employee_id,balance_id,start_date,end_date,days,work_dates_json,reason,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'pending_manager',?,?)")
    .run(rid,u.tenant_id,u.id,b.id,values.start_date,values.end_date,values.days,values.work_dates_json,values.reason,timestamp,timestamp);
  const r=requestRecord(db,u,rid);saveVersion(db,r);movement(db,u,b.id,r,'reserve',values.reason);
  audit(db,u,'leave_request',rid,'leave.submitted',{}, {status:r.status,revision:r.revision,days:r.days,balance_id:b.id});
  leaveNotice(db,r,u.id,'leave_submitted',`استلمنا طلب إجازتك ${dateRange(r.start_date,r.end_date)}`,`${leaveTypeName(b.leave_type)} · ${r.days} يوم عمل محجوزة من رصيدك. بانتظار موافقة مديرك.`);
  noticeManager(db,u,r);
  return getLeaveRequest(db,u,rid);
}
export function leaveAction(db,user,rid,action,input) {
  const u=actor(db,user),r=requestRecord(db,u,rid),terms=types.termsOf(db,r);
  v.object(input,action==='resubmit'?['version','start_date','end_date','reason',...(terms?STATUTORY_FIELDS:[])]:['version','note']);
  v.version(input.version,r.version);
  if(!requestActions(db,u,r).includes(action)) fail(403,'transition_denied','ما ينفع هذا الإجراء في مرحلة الطلب الحالية ولا من صلاحية حسابك');
  const b=balanceRecord(db,u,r.balance_id,r),e=employee(db,r.tenant_id,r.employee_id),c=calendar(db,r.tenant_id,b.calendar_id),stage=stageOf(db,r,terms);
  let next,note=input.note===undefined?'':v.text(input.note,'سبب الإجراء',2000,0);
  if(action==='resubmit'&&terms) {
    // النوع والسنة ثابتان في الطلب؛ التواريخ ونصف اليوم والحالة تُعاد حسابها بسياسة اليوم المعتمدة.
    const policy=policyAt(db,u,input.start_date);
    if(!policy) fail(409,'policy_required','ما فيه سياسة أنواع إجازات معتمدة سارية في تاريخ البداية');
    const plan=types.planRequest(db,e,{...input,leave_type:b.leave_type,balance_year:b.balance_year,document:undefined,reason:undefined},policy,{excludeId:r.id});
    const reason=v.text(input.reason,'سبب الطلب',2000,3);
    db.prepare("UPDATE leave_requests SET start_date=?,end_date=?,days=?,work_dates_json=?,reason=?,status='pending_manager',revision=revision+1,version=version+1,updated_at=? WHERE id=?")
      .run(plan.start_date,plan.end_date,Math.ceil(plan.days_milli/1000),JSON.stringify(plan.work_dates),reason,now(),r.id);
    const revised=requestRecord(db,u,r.id);types.saveTerms(db,revised,plan,policy);saveVersion(db,revised,plan);move(db,u,b.id,revised,'reserve',reason);
    if(input.document!==undefined) attachDocument(db,u,revised,plan,input.document);
    next='pending_manager';
  } else if(action==='resubmit') {
    const values=calculate(db,e,b,input,r.id);
    db.prepare("UPDATE leave_requests SET start_date=?,end_date=?,days=?,work_dates_json=?,reason=?,status='pending_manager',revision=revision+1,version=version+1,updated_at=? WHERE id=?")
      .run(values.start_date,values.end_date,values.days,values.work_dates_json,values.reason,now(),r.id);
    const revised=requestRecord(db,u,r.id);saveVersion(db,revised);movement(db,u,b.id,revised,'reserve',values.reason);
    next='pending_manager';
  } else if(stage==='pending_authority') {
    // خطوة صاحب الصلاحية: قراره في جدوله، والموافقة لا تغيّر حالة الطلب بل تفتح خطوة خدمات الموظف.
    if(action!=='approve') note=v.text(note,'سبب الإجراء',2000,3);
    if(!e.active) fail(409,'routing_unavailable','حساب الموظف موقوف — كلّم مسؤول المنصة يفعّله');
    const previous=managerApprover(db,r);
    if(!previous||manager(db,e)?.id!==previous) fail(409,'routing_changed','تغيّر المدير المباشر بعد ما اعتمد — أعد الطلب عشان يمشي بالمسار الحالي');
    db.prepare('INSERT INTO leave_authority_decisions VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),r.id,r.tenant_id,r.revision,u.id,action,note,now());
    next=action==='approve'?'pending_hr':action==='return'?'returned':'rejected';
    if(next!=='pending_hr') {
      db.prepare('UPDATE leave_requests SET status=?,version=version+1,updated_at=? WHERE id=?').run(next,now(),r.id);
      move(db,u,b.id,requestRecord(db,u,r.id),'release',note);
    }
  } else {
    if(['return','reject','cancel'].includes(action)) note=v.text(note,'سبب الإجراء',2000,3);
    if(action==='cancel') next='cancelled';
    else {
      if(!e.active) fail(409,'routing_unavailable','حساب الموظف موقوف — كلّم مسؤول المنصة يفعّله');
      // المستند الإلزامي (كالتقرير الطبي للمرضية) شرط لاجتياز خطوة المدير.
      if(action==='approve'&&r.status==='pending_manager'&&terms?.document_required&&!types.hasDocument(db,r)) fail(409,'document_required',`لازم ترفق ${(type=>[...(type?.documents??[]).filter(d=>d.required),...(type?.variants??[]).filter(x=>x.key===terms.variant&&x.document?.required).map(x=>x.document)])(types.typeOf(policyAt(db,u,r.start_date)??{parameters:{types:[]}},terms.leave_type)).map(d=>d.name_ar).join('، ')||'المستند المطلوب'} قبل اعتماد المدير`);
      if(action==='approve'&&r.status==='pending_hr') {
        const previous=managerApprover(db,r);
        if(!previous||manager(db,e)?.id!==previous||previous===u.id||!inHrScope(u,e,c)) fail(409,'routing_changed','تغيّر المدير أو نطاق الاعتماد — أعد الطلب عشان يمشي بالمسار الحالي');
        if(terms?.route==='manager_authority_hr'&&types.authorityDecision(db,r)?.decision!=='approve') fail(409,'routing_changed','لازم قرار صاحب الصلاحية قبل ما يوصل خدمات الموظف');
      }
      db.prepare('INSERT INTO leave_decisions VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),r.id,r.tenant_id,r.revision,r.status==='pending_manager'?'manager':'hr',u.id,action,note,now());
      next=action==='return'?'returned':action==='reject'?'rejected':r.status==='pending_manager'?'pending_hr':'approved';
    }
    db.prepare('UPDATE leave_requests SET status=?,version=version+1,updated_at=? WHERE id=?').run(next,now(),r.id);
    const changed=requestRecord(db,u,r.id);
    if(next==='approved') {move(db,u,b.id,changed,'debit',note);if(terms)types.proposePayEffects(db,u,changed,terms);}
    else if(['returned','rejected','cancelled'].includes(next)&&['pending_manager','pending_hr'].includes(r.status)) move(db,u,b.id,changed,'release',note);
    else if(next==='cancelled'&&r.status==='approved') {move(db,u,b.id,changed,'refund',note);types.withdrawPayEffects(db,u,changed);}
  }
  const changedVersion=db.prepare('SELECT version FROM leave_requests WHERE id=?').get(r.id).version;
  audit(db,u,'leave_request',r.id,stage==='pending_authority'?`leave.authority_${action}`:`leave.${action}`,{status:r.status,version:r.version,revision:r.revision},{status:stage==='pending_authority'&&next==='pending_hr'?'pending_hr':next,version:changedVersion},note);
  const latest=requestRecord(db,u,r.id),range=dateRange(latest.start_date,latest.end_date),toEmployee=(kind,title,body)=>{if(e.id!==u.id)leaveNotice(db,latest,e.id,kind,title,body);};
  const latestTerms=types.termsOf(db,latest),shown={unit:latestTerms?.unit??'working',days:latestTerms?daysText(latestTerms.days_milli):latest.days};
  if(action==='resubmit') noticeManager(db,e,latest);
  else if(next==='pending_hr'&&stageOf(db,latest,latestTerms)==='pending_authority') {
    toEmployee('leave_manager_approved',`وافق مديرك على إجازتك ${range}`,'بانتظار اعتماد صاحب الصلاحية ثم خدمات الموظف.');
    for(const person of authorityHolders(db,e,[u.id])) leaveNotice(db,latest,person,'leave_decision_needed',`طلب إجازة ينتظر قرار صاحب الصلاحية: ${e.name} ${range}`,'وافق المدير المباشر. افتح «الإجازات» لاعتماده أو إعادته أو رفضه.');
  }
  else if(next==='pending_hr') {
    toEmployee('leave_manager_approved',stage==='pending_authority'?`اعتمد صاحب الصلاحية إجازتك ${range}`:`وافق مديرك على إجازتك ${range}`,'بانتظار اعتماد خدمات الموظف.');
    for(const person of hrApprovers(db,e,c,managerApprover(db,latest))) if(person!==u.id) leaveNotice(db,latest,person,'leave_decision_needed',`طلب إجازة ينتظر اعتمادك: ${e.name} ${range}`,stage==='pending_authority'?'اعتمده المدير المباشر وصاحب الصلاحية. افتح «الإجازات» لاعتماده أو إعادته أو رفضه.':'وافق المدير المباشر. افتح «الإجازات» لاعتماده أو إعادته أو رفضه.');
  }
  else if(next==='approved') {
    // D-06: الإشعار يذكر الشريحة وما لا أجر فيه، فلا يعرف الموظف بالخصم من قسيمة راتبه أول مرة.
    const pay=paySummary(latestTerms);
    const base=`${latestTerms&&latestTerms.source==='none'?'سُجلت':'خُصم'} ${shown.days} ${unitWord(shown)} ${latestTerms&&latestTerms.source==='none'?'من':'من رصيد'} ${leaveTypeName(b.leave_type)}.`;
    toEmployee('leave_approved',`اعتُمدت إجازتك ${range}`,pay&&!pay.fully_paid?`${base} الأجر: ${pay.text}. ${pay.effect}`:`${base}${pay?' الأجر: كامل عن كل الأيام.':''}`);
  }
  else if(next==='returned') toEmployee('leave_returned',`أُعيد إليك طلب إجازتك ${range} للتعديل`,'سبب الإعادة مكتوب في «الإجازات». عدّل الطلب وأعد تقديمه؛ أُعيدت الأيام المحجوزة إلى رصيدك.');
  else if(next==='rejected') toEmployee('leave_rejected',`رُفض طلب إجازتك ${range}`,'سبب الرفض مكتوب في «الإجازات». أُعيدت الأيام المحجوزة إلى رصيدك.');
  return getLeaveRequest(db,u,r.id);
}
