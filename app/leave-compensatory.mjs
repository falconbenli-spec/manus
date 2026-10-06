import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { notifySubject, dayName } from './notices.mjs';
import { overtimePolicy, suggestedMinor, wageBasis, annualPaidMinor, sar } from './overtime-rules.mjs';
import { annualCapMinor, overtimeAmountMinor } from './attendance-policy.mjs';
import { proposeAdjustment } from './payroll-extras.mjs';
import { compensatoryLeaveMinutes, overtimeMinutesBack, compensatoryConsentSentence, compensatoryDaysText, hoursText, ratioText, shiftDate } from './static/leave-count.mjs';

// الإجازة التعويضية عن ساعات العمل الإضافي (نظام العمل م107/1 كما عدلها المرسوم م/44، واللائحة التنفيذية م22 مكرر):
//   1) الموظف وحده يختار الإجازة بدل الأجر عند تسجيل ساعاته، واختياره هو موافقته: تُحفظ بهويته ووقتها ونص ما وافق عليه.
//   2) عند اعتماد الساعات يُقيَّد رصيد = الساعات × النسبة المعتمدة في سياسة أنواع الإجازات، ومهلته من يوم العمل نفسه.
//   3) يُستهلك الرصيد إجازةً من الأقدم أجلًا، وإلغاء الإجازة أو رفضها يعيد الساعات إلى قيودها نفسها.
//   4) ما انقضت مهلته أو انتهت خدمة صاحبه لا يسقط: يحيله مُعد الرواتب حركةً مقترحة يعتمدها معتمد الرواتب. عند ترك العمل النص في لائحة الشركة نفسها
//      م77(6) (ص 27 من النسخة الموقعة): «على أن يدفع الأجر الإضافي نقدًا إذا انتهت خدمة العامل لأي سبب قبل استعماله للإجازة التعويضية»، ومثله في
//      اللائحة التنفيذية «أجر الإجازات التعويضية المستحقة» (م22 مكرر/4)؛ وعند انقضاء المهلة على رأس العمل كلتاهما ساكتة؛ يُعرض على المُعد أجر الإجازة
//      وأجر الساعات الأصلية ويُقترح أكبرهما.
// لا رقم نظامي هنا: النسبة والمهلة والسقف السنوي من كتلة compensatory في السياسة المعتمدة، وساعات اليوم من سياسة ساعات العمل المعتمدة.
// الوحدة لا تستورد leave-types.mjs عمدًا (تلك تستوردها)، فتقرأ السياسة المعتمدة من جدولها مباشرة.
const RIYADH_OFFSET=3*3600000;
const riyadhDate=(time=Date.now())=>new Date(time+RIYADH_OFFSET).toISOString().slice(0,10);
export const COMPENSATORY_CODE='compensatory';
// حدّا اللائحة التنفيذية وسقفها (م22 مكرر، ملف الوزارة أبريل 2025، رُوجع 21 سبتمبر 2026). تُستعمل للتحقق فقط: النسبة في السياسة لا تنزل عن
// حدها الأدنى، والمهلة لا تطول عن سقفها. القيمة السارية هي ما في السياسة المعتمدة، لا هذه.
// م77(6) من لائحة الشركة كما طُبعت (ص 27): شروطها الثلاثة — الاستبدال بموافقة العامل، والإجازة مدفوعة الأجر، والدفع نقدًا عند انتهاء الخدمة لأي سبب قبل الاستعمال.
export const ART77_6='م77(6) (ص 27 من النسخة الموقعة): يجوز لصاحب العمل بموافقة العامل أن يحتسب له أيام إجازة تعويضية مدفوعة الأجر بدلًا عن أجر ساعات العمل الإضافية، على أن يدفع الأجر الإضافي نقدًا إذا انتهت خدمة العامل لأي سبب قبل استعماله للإجازة التعويضية';
export const COMPENSATORY_LEGAL=Object.freeze({min_ratio_bp:15000 /* م22 مكرر/1: ساعة ونصف عن كل ساعة */,max_use_within_days:60 /* م22 مكرر/2 */,annual_cap_days:30 /* م22 مكرر/3 */});
export const LOT_STATES={open:'متاح للإجازة',expiring:'يقترب أجله',reserved:'محجوز لطلب إجازة قائم',due:'انقضت مهلته — يُحال أجره إلى المسير',service_ended:'انتهت الخدمة — يُدفع أجره نقدًا في المسير (م77(6))',in_payroll:'أُحيل باقيه إلى المسير أجرًا إضافيًا',with_settlement:'حُمل باقيه على مخالصة نهاية الخدمة بقرار مكتوب',spent:'استُعمل كله إجازةً'};
const HR_OWNER={owner:'مدير الموارد البشرية (يعتمد) وموظف الموارد البشرية المخول (يُعد)',owner_role:'hr.policy.accept'};

function actor(db,supplied){
  const u=currentUser(db,supplied);
  if(!u||u.role==='admin')refuse(403,'forbidden',{what:'الإجازة التعويضية لحسابات الموظفين لا لحساب إدارة المنصة',next:'سجّل الدخول بحساب موظف يحمل التصريح المطلوب'});
  return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة دفتر الإجازة التعويضية معاملة قاعدة بيانات');}
const nameOf=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

// ── السياستان المعتمدتان ────────────────────────────────────────────────────────
// قاعدة الإجازة التعويضية من سياسة أنواع الإجازات المعتمدة السارية في التاريخ. سياسة معتمدة قبل هذا النوع (الإصدار 2 وما قبله)
// لا كتلة فيها ولا نوع: تعود null، فيبقى اختيار الإجازة غير متاح وتبقى السياسة القديمة تعمل كما كانت.
export function compensatoryRule(db,tenantId,date){
  const row=db.prepare("SELECT id,title,parameters FROM leave_type_policies WHERE tenant_id=? AND status='accepted' AND effective_from<=? ORDER BY effective_from DESC,decided_at DESC LIMIT 1").get(tenantId,date);
  if(!row)return null;
  const p=JSON.parse(row.parameters),block=p.compensatory,type=(p.types??[]).find(t=>t.code===COMPENSATORY_CODE);
  // سياسة نسبتها دون الحد الأدنى النظامي لا تُقيَّد بها ساعة: تُعامل كأنها غير موجودة حتى تُستبدل.
  if(!block||!type||!Number.isInteger(block.ratio_bp)||block.ratio_bp<COMPENSATORY_LEGAL.min_ratio_bp||!Number.isInteger(block.use_within_days)||block.use_within_days<1)return null;
  return {policy_id:row.id,policy_title:row.title,ratio_bp:block.ratio_bp,use_within_days:block.use_within_days,annual_cap_days:Number.isInteger(block.annual_cap_days)?block.annual_cap_days:null,
    warn_days:Number.isInteger(block.warn_days)?block.warn_days:0,type_name:type.name_ar};
}
// ساعات اليوم: «ساعات اليوم في قسمة الأجر» من كتلة العمل الإضافي في سياسة ساعات العمل المعتمدة — الرقم نفسه الذي تُسعَّر به الساعة
// الإضافية، فتحويل الساعات إلى أيام وتحويلها إلى ريالات يقرآن يومًا واحدًا. بلا سياسة معتمدة لا يُفترض ثمانٍ: تعود null.
export function dailyBasis(db,tenantId,date){
  const o=overtimePolicy(db,tenantId,date);
  return o&&Number.isInteger(o.hour_divisor_hours)?{daily_minutes:o.hour_divisor_hours*60,policy_id:o.policy_id}:null;
}
function requireDailyBasis(db,tenantId,date,what){
  const basis=dailyBasis(db,tenantId,date);
  if(!basis)refuse(409,'working_time_policy_required',{what,
    missing:[{doc_key:'working_time',document:'سياسة «ساعات العمل والحضور» معتمدة وفيها قواعد العمل الإضافي وساعات اليوم',why:'تحويل ساعات الرصيد إلى أيام يقرأ ساعات اليوم منها، ولا تُفترض ثماني ساعات',...HR_OWNER}],
    next:'يُعد موظف الموارد البشرية السياسة من شاشة الحضور ويعتمدها مدير الموارد البشرية من «العقود والسياسات»، ثم يُعاد الطلب',link:'#attendance'});
  return basis;
}
function requireRule(db,tenantId,date,what){
  const rule=compensatoryRule(db,tenantId,date);
  if(!rule)refuse(409,'compensatory_policy_required',{what,
    missing:[{doc_key:'leave_types',document:'سياسة أنواع الإجازات معتمدة وفيها نوع «الإجازة التعويضية» ونسبته ومهلته',why:'النسبة (لا تقل عن ساعة ونصف عن كل ساعة) والمهلة تُقرآن من سياسة معتمدة لا من الشيفرة (نظام العمل م107/1، اللائحة التنفيذية م22 مكرر)',...HR_OWNER}],
    next:'اختر «أجر» الآن، أو انتظر اعتماد مدير الموارد البشرية لسياسة أنواع الإجازات من شاشة «الإجازات»',link:'#leave'});
  return rule;
}

// ── القيود وأرصدتها ────────────────────────────────────────────────────────────
// نهاية الخدمة: لا عقد ساريًا وآخر عقد منتهٍ ليس تعديلًا حل محله عقد آخر. بعدها لا إجازة تُؤخذ، فيُحال الباقي أجرًا (م22 مكرر/4).
export function serviceEndedOn(db,tenantId,userId){
  if(db.prepare("SELECT 1 FROM employment_contracts WHERE tenant_id=? AND user_id=? AND status='active'").get(tenantId,userId))return null;
  return db.prepare("SELECT ended_on FROM employment_contracts WHERE tenant_id=? AND user_id=? AND status='ended' AND end_reason NOT LIKE 'حل محله عقد معدل%' ORDER BY ended_on DESC LIMIT 1").get(tenantId,userId)?.ended_on??null;
}
const LOT_SQL=`SELECT c.*,
  (SELECT COALESCE(SUM(m.used_minutes),0) FROM compensatory_movements m WHERE m.credit_id=c.id) AS used_minutes,
  (SELECT COALESCE(SUM(m.reserved_minutes),0) FROM compensatory_movements m WHERE m.credit_id=c.id) AS reserved_minutes,
  (SELECT COALESCE(SUM(p.leave_minutes),0) FROM compensatory_payouts p JOIN payroll_adjustments a ON a.id=p.adjustment_id WHERE p.credit_id=c.id AND a.status<>'rejected') AS paid_minutes,
  (SELECT COALESCE(SUM(p.overtime_minutes),0) FROM compensatory_payouts p JOIN payroll_adjustments a ON a.id=p.adjustment_id WHERE p.credit_id=c.id AND a.status<>'rejected') AS overtime_back_minutes
  FROM compensatory_credits c`;
// ما حُمل على مخالصة نهاية الخدمة بقرار مكتوب لأن لا مسير يحمله (مسير شهر ترك العمل اعتُمد): يُقرأ من بنود المخالصة المعتمدة نفسها
// (service_settlements.clearance_blockers، ترحيل 113)، فلا دفتر ثانٍ ولا صف يُعدَّل.
function carriedBySettlement(db,tenantId,userId){
  const carried=new Map();
  for(const s of db.prepare("SELECT clearance_blockers FROM service_settlements WHERE tenant_id=? AND user_id=? AND status='approved'").all(tenantId,userId))
    for(const b of JSON.parse(s.clearance_blockers||'[]'))if(b.source==='compensatory')for(const lot of b.lots??[])carried.set(lot.credit_id,(carried.get(lot.credit_id)??0)+lot.leave_minutes);
  return carried;
}
function lotView(db,row,date,ended,warnDays,carried=0){
  const remaining=row.leave_minutes-row.used_minutes-row.reserved_minutes-row.paid_minutes-carried,expired=row.expires_on<date;
  const state=remaining<=0?(row.reserved_minutes>0?'reserved':carried>0?'with_settlement':row.paid_minutes>0?'in_payroll':'spent'):ended?'service_ended':expired?'due':row.expires_on<=shiftDate(date,warnDays)?'expiring':'open';
  return {id:row.id,user_id:row.user_id,overtime_request_id:row.overtime_request_id,work_date:row.work_date,overtime_minutes:row.overtime_minutes,ratio_bp:row.ratio_bp,leave_minutes:row.leave_minutes,
    expires_on:row.expires_on,legacy:!!row.legacy,used_minutes:row.used_minutes,reserved_minutes:row.reserved_minutes,paid_minutes:row.paid_minutes,carried_minutes:carried,overtime_back_minutes:row.overtime_back_minutes,remaining_minutes:Math.max(0,remaining),
    days_left:Math.round((Date.parse(row.expires_on)-Date.parse(date))/86400000),state,state_name:LOT_STATES[state],due:remaining>0&&(expired||!!ended),
    cause:remaining>0&&ended?'service_ended':remaining>0&&expired?'expired':null,created_at:row.created_at};
}
export function lotsOf(db,tenantId,userId,date=riyadhDate()){
  const ended=serviceEndedOn(db,tenantId,userId),warn=compensatoryRule(db,tenantId,date)?.warn_days??0,carried=carriedBySettlement(db,tenantId,userId);
  return db.prepare(`${LOT_SQL} WHERE c.tenant_id=? AND c.user_id=? ORDER BY c.expires_on,c.work_date,c.seq`).all(tenantId,userId).map(row=>lotView(db,row,date,ended,warn,carried.get(row.id)??0));
}
// المتاح لإجازة تبدأ في تاريخ: القيود التي كُسبت قبله ولم تنقض مهلتها عنده، الأقدم أجلًا أولًا. والقيد «المستحق الصرف» اليوم (انقضت مهلته
// أو انتهت خدمة صاحبه) لم يعد إجازة حتى لطلب بتاريخ سابق: ما تعرضه البلاطة وما يقوله الرفض وما يقبله الخادم تاريخ واحد.
const usableAt=(lots,date)=>lots.filter(l=>l.remaining_minutes>0&&!l.due&&l.expires_on>=date&&l.work_date<=date);
export function compensatoryAvailability(db,e,date=riyadhDate()){
  const lots=lotsOf(db,e.tenant_id,e.id),sum=(rows,key)=>rows.reduce((n,l)=>n+l[key],0),usable=usableAt(lots,date),basis=dailyBasis(db,e.tenant_id,date);
  return {lots,daily_minutes:basis?.daily_minutes??null,working_time_policy_id:basis?.policy_id??null,credited_minutes:sum(lots,'leave_minutes'),used_minutes:sum(lots,'used_minutes'),
    reserved_minutes:sum(lots,'reserved_minutes'),paid_minutes:sum(lots,'paid_minutes'),available_minutes:sum(usable,'remaining_minutes'),due_minutes:sum(lots.filter(l=>l.due),'remaining_minutes'),
    next_expiry:usable[0]?.expires_on??null};
}
// ما يراه الموظف: الرصيد بالساعات وبالأيام، وكل قيد بمهلته. بلا سياسة ساعات عمل معتمدة تبقى الساعات ظاهرة والأيام «غير قابلة للقياس».
export function compensatoryBalanceView(db,e,date=riyadhDate()){
  const a=compensatoryAvailability(db,e,date),days=minutes=>compensatoryDaysText(minutes,a.daily_minutes);
  return {available_hours:hoursText(a.available_minutes),available_days:days(a.available_minutes),reserved_hours:hoursText(a.reserved_minutes),used_hours:hoursText(a.used_minutes),
    credited_hours:hoursText(a.credited_minutes),paid_hours:hoursText(a.paid_minutes),due_hours:hoursText(a.due_minutes),daily_hours:a.daily_minutes?hoursText(a.daily_minutes):null,
    days_note:a.daily_minutes?`اليوم ${hoursText(a.daily_minutes)} ساعات كما في سياسة ساعات العمل المعتمدة؛ ما دون نصف يوم لا يُطلب إجازةً ويُحال أجرًا عند انقضاء مهلته.`
      :'الأيام غير قابلة للقياس: لا سياسة «ساعات العمل والحضور» معتمدة تحدد ساعات اليوم. الساعات محفوظة، وطلب الإجازة منها يتاح بعد اعتماد السياسة.',
    next_expiry:a.next_expiry,
    lots:a.lots.map(l=>({id:l.id,work_date:l.work_date,overtime_hours:hoursText(l.overtime_minutes),ratio:ratioText(l.ratio_bp),leave_hours:hoursText(l.leave_minutes),remaining_hours:hoursText(l.remaining_minutes),
      remaining_days:days(l.remaining_minutes),used_hours:hoursText(l.used_minutes),reserved_hours:hoursText(l.reserved_minutes),paid_hours:hoursText(l.paid_minutes),expires_on:l.expires_on,days_left:l.days_left,
      state:l.state,state_name:l.state_name,legacy:l.legacy,
      warning:l.state==='expiring'?`بقي ${l.days_left} يومًا على انقضاء مهلة هذا الرصيد (${l.expires_on}). اطلب إجازتك قبلها، وإلا اقتُرح صرف أجره في المسير.`:null}))};
}

// ── الاختيار والموافقة ──────────────────────────────────────────────────────────
// ما يُعرض على الموظف في نموذج العمل الإضافي قبل أن يختار: هل الخيار متاح، وبأي نسبة ومهلة، وإن لم يكن متاحًا فلماذا وعند من.
export function compensationOffer(db,u,date=riyadhDate()){
  const rule=compensatoryRule(db,u.tenant_id,date),basis=dailyBasis(db,u.tenant_id,date);
  if(!rule)return {available:false,reason:'اختيار الإجازة التعويضية بدل الأجر غير متاح: لم يعتمد مدير الموارد البشرية بعد سياسة أنواع إجازات فيها هذا النوع ونسبته ومهلته.'};
  if(!basis)return {available:false,reason:'اختيار الإجازة التعويضية بدل الأجر غير متاح: لا سياسة «ساعات العمل والحضور» معتمدة تحدد ساعات اليوم، فلا يُقاس الرصيد بالأيام ولا سقفه السنوي.'};
  return {available:true,ratio_bp:rule.ratio_bp,ratio:ratioText(rule.ratio_bp),use_within_days:rule.use_within_days,annual_cap_days:rule.annual_cap_days,daily_hours:hoursText(basis.daily_minutes),policy_title:rule.policy_title,
    articles:'نظام العمل م107/1، اللائحة التنفيذية م22 مكرر'};
}
const yearOf=date=>date.slice(0,4);
// ما قُيِّد أو وُوفق عليه من إجازة تعويضية عن أيام عمل في السنة الميلادية نفسها (الطلبات القائمة والمعتمدة، والقيود القديمة بلا موافقة مسجلة).
function committedMinutes(db,tenantId,userId,year){
  const consents=db.prepare("SELECT COALESCE(SUM(k.leave_minutes),0) AS n FROM overtime_compensation_consents k JOIN overtime_requests o ON o.id=k.overtime_request_id WHERE k.tenant_id=? AND k.user_id=? AND o.status IN ('pending','approved') AND o.work_date BETWEEN ? AND ?").get(tenantId,userId,`${year}-01-01`,`${year}-12-31`).n;
  const legacy=db.prepare('SELECT COALESCE(SUM(leave_minutes),0) AS n FROM compensatory_credits WHERE tenant_id=? AND user_id=? AND legacy=1 AND work_date BETWEEN ? AND ?').get(tenantId,userId,`${year}-01-01`,`${year}-12-31`).n;
  return consents+legacy;
}
// يُستدعى من requestOvertime حين يختار الموظف الإجازة: يتحقق من السياستين ومن الموافقة الصريحة ومن السقف السنوي، ويعيد شروط الموافقة.
export function consentTerms(db,u,{work_date,minutes,consent}){
  const today=riyadhDate(),what='لم يُسجَّل اختيار الإجازة التعويضية بدل أجر العمل الإضافي';
  const rule=requireRule(db,u.tenant_id,today,what),basis=requireDailyBasis(db,u.tenant_id,today,what);
  const sentence=compensatoryConsentSentence({work_date,overtime_minutes:minutes,ratio_bp:rule.ratio_bp,use_within_days:rule.use_within_days});
  if(consent!==true)refuse(400,'consent_required',{what:'اختيار الإجازة بدل الأجر موافقةٌ منك يشترطها نظام العمل (م107/1)، ولا تُفترض ولا يسجلها أحد عنك',
    next:`اقرأ الجملة وأكّد موافقتك عليها في النموذج: «${sentence}»`});
  const leave=compensatoryLeaveMinutes(minutes,rule.ratio_bp);
  if(rule.annual_cap_days!==null){
    const cap=rule.annual_cap_days*basis.daily_minutes,committed=committedMinutes(db,u.tenant_id,u.id,yearOf(work_date));
    if(committed+leave>cap)refuse(409,'compensatory_annual_cap',{what:`تتجاوز هذه الساعات سقف الإجازة التعويضية في السنة (${rule.annual_cap_days} يومًا، اللائحة التنفيذية م22 مكرر/3): المقيَّد والموافَق عليه ${hoursText(committed)} ساعة، والسقف ${hoursText(cap)} ساعة`,
      next:'اختر «أجر» لهذه الساعات: ما زاد على السقف يُدفع أجرًا إضافيًا ولا يُحوَّل إجازة'});
  }
  return {rule,sentence,leave_minutes:leave};
}
export function recordConsent(db,u,overtimeId,terms,{work_date,minutes,consent_at}){
  writing(db);
  db.prepare('INSERT INTO overtime_compensation_consents(overtime_request_id,tenant_id,user_id,consent_at,policy_id,ratio_bp,use_within_days,overtime_minutes,leave_minutes,sentence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(overtimeId,u.tenant_id,u.id,consent_at,terms.rule.policy_id,terms.rule.ratio_bp,terms.rule.use_within_days,minutes,terms.leave_minutes,terms.sentence,consent_at);
  audit(db,u,'overtime_compensation_consent',overtimeId,'compensatory.consent_recorded',{}, {work_date,overtime_minutes:minutes,leave_minutes:terms.leave_minutes,ratio_bp:terms.rule.ratio_bp,use_within_days:terms.rule.use_within_days,policy_id:terms.rule.policy_id});
}

// ── القيد عند الاعتماد ──────────────────────────────────────────────────────────
// يُكتب داخل معاملة اعتماد الساعات نفسها، بالنسبة والمهلة اللتين وافق عليهما الموظف (لا بما تغيّر بعدهما). الطلب القديم بلا موافقة
// مسجلة (اعتُمد اختياره قبل الترحيل 125) يُقيَّد بالقاعدة المعتمدة اليوم إن وُجدت، وإلا بقي ظاهرًا «لم يُقيَّد» حتى تُعتمد السياسة.
export function creditOvertime(db,approver,o,{legacy=false,reason=''}={}){
  writing(db);
  if(o.compensation!=='time_off'||o.status!=='approved')return null;
  if(db.prepare('SELECT 1 FROM compensatory_credits WHERE overtime_request_id=?').get(o.id))return null;
  // دُفعت نقدًا عند انتهاء الخدمة قبل القيد (م77(6)): لها حركة مسير قائمة، فلا تُقيَّد رصيدًا بعد ذلك — الساعة لا تُعوَّض مرتين.
  if(o.adjustment_id&&db.prepare("SELECT 1 FROM payroll_adjustments WHERE id=? AND status<>'rejected'").get(o.adjustment_id))return null;
  const consent=db.prepare('SELECT * FROM overtime_compensation_consents WHERE overtime_request_id=?').get(o.id)??null;
  const rule=consent?{policy_id:consent.policy_id,ratio_bp:consent.ratio_bp,use_within_days:consent.use_within_days}:compensatoryRule(db,o.tenant_id,riyadhDate());
  if(!rule)return null;
  const creditId=randomUUID(),leave=consent?consent.leave_minutes:compensatoryLeaveMinutes(o.minutes,rule.ratio_bp),expires=shiftDate(o.work_date,rule.use_within_days);
  db.prepare('INSERT INTO compensatory_credits(id,tenant_id,user_id,overtime_request_id,work_date,overtime_minutes,ratio_bp,leave_minutes,expires_on,policy_id,legacy,credited_by,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(creditId,o.tenant_id,o.user_id,o.id,o.work_date,o.minutes,rule.ratio_bp,leave,expires,rule.policy_id,legacy||!consent?1:0,approver.id,reason||`اعتماد ${hoursText(o.minutes)} ساعة عمل إضافي يوم ${o.work_date} اختار صاحبها الإجازة التعويضية`,now());
  audit(db,approver,'compensatory_credit',creditId,'compensatory.credited',{}, {user_id:o.user_id,overtime_request_id:o.id,work_date:o.work_date,overtime_minutes:o.minutes,ratio_bp:rule.ratio_bp,leave_minutes:leave,expires_on:expires,legacy:legacy||!consent});
  return {id:creditId,leave_minutes:leave,expires_on:expires,ratio_bp:rule.ratio_bp};
}
// طلبات «وقت راحة بدل الأجر» المعتمدة التي لا قيد لها: تظهر لحامل تصريح اعتماد الحضور ليقيّدها، فلا تبقى ساعة معتمدة بلا أثر.
export function uncreditedOvertime(db,u){
  if(!holds(db,u,'hr.attendance.approve'))return [];
  const ready=!!compensatoryRule(db,u.tenant_id,riyadhDate());
  return db.prepare("SELECT o.* FROM overtime_requests o WHERE o.tenant_id=? AND o.status='approved' AND o.compensation='time_off' AND NOT EXISTS(SELECT 1 FROM compensatory_credits c WHERE c.overtime_request_id=o.id) AND NOT EXISTS(SELECT 1 FROM payroll_adjustments a WHERE a.id=o.adjustment_id AND a.status<>'rejected') ORDER BY o.work_date").all(u.tenant_id)
    .map(o=>({id:o.id,user_id:o.user_id,employee_name:nameOf(db,o.user_id),work_date:o.work_date,minutes:o.minutes,hours:hoursText(o.minutes),created_at:o.decided_at??o.created_at,
      note:ready?'اعتُمدت قبل قيد الأرصدة التعويضية؛ تُقيَّد بالنسبة والمهلة المعتمدتين اليوم.':'لا تُقيَّد قبل اعتماد سياسة أنواع إجازات فيها الإجازة التعويضية.',
      actions:ready&&o.user_id!==u.id?['credit_compensatory']:[]}));
}
export function creditLegacy(db,supplied,overtimeId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['note']);
  if(!holds(db,u,'hr.attendance.approve'))refuse(403,'not_permitted',{what:'قيد الرصيد التعويضي عن ساعات معتمدة سابقًا لحامل تصريح اعتماد الحضور',next:'اطلبه ممن يحمل تصريح hr.attendance.approve'});
  const o=typeof overtimeId==='string'&&db.prepare("SELECT * FROM overtime_requests WHERE id=? AND tenant_id=? AND status='approved' AND compensation='time_off'").get(overtimeId,u.tenant_id);
  if(!o||o.user_id===u.id)refuse(404,'not_found',{what:'طلب العمل الإضافي غير متاح لقيد رصيده',next:'يُقيَّد الرصيد عن طلب معتمد اختار صاحبه وقت الراحة، ولا يقيّده صاحبه لنفسه'});
  if(db.prepare('SELECT 1 FROM compensatory_credits WHERE overtime_request_id=?').get(o.id))refuse(409,'already_credited',{what:'لهذا الطلب قيد رصيد تعويضي قائم',next:'راجع القيد في «الإجازات» لدى الموظف'});
  // دُفعت نقدًا عند انتهاء الخدمة (م77(6)) فلها حركة مسير قائمة: creditOvertime تعيد null لها، وكان الوصول إلى هنا يسقط بخطأ برمجي لا برفض مكتوب.
  const paid=o.adjustment_id?db.prepare("SELECT id,month,status FROM payroll_adjustments WHERE id=? AND status<>'rejected'").get(o.adjustment_id):null;
  if(paid)refuse(409,'already_paid',{what:`دُفعت ساعات ${o.work_date} نقدًا عند انتهاء الخدمة (${ART77_6}) بحركة مسير ${paid.status==='approved'?'معتمدة':'مقترحة'} لشهر ${paid.month}، فلا تُقيَّد رصيدًا`,
    next:'الساعة لا تُعوَّض مرتين (نظام العمل م107/1). إن رُفضت الحركة في المسير عاد الطلب إلى هذا الطابور'});
  requireRule(db,u.tenant_id,riyadhDate(),'لم يُقيَّد الرصيد التعويضي');
  const credit=creditOvertime(db,u,o,{legacy:true,reason:v.text(input.note,'سند القيد',1000,10)});
  if(!credit)refuse(409,'not_credited',{what:`لم يُقيَّد رصيد ساعات ${o.work_date}: تغيّر الطلب أو قيده أثناء الإجراء`,next:'حدّث الصفحة وأعد المحاولة'});
  notifySubject(db,{userId:o.user_id,kind:'compensatory_credited',subjectKind:'compensatory_credit',subjectId:credit.id,title:`قُيِّد رصيدك التعويضي عن عمل ${dayName(o.work_date)}`,
    body:`${hoursText(credit.leave_minutes)} ساعة إجازة تعويضية، مهلتها حتى ${credit.expires_on}. بعدها يُقترح صرف أجر الباقي في المسير ولا يسقط.`});
  return {id:credit.id,leave_minutes:credit.leave_minutes,expires_on:credit.expires_on};
}

// ── حركة الإجازة على القيود: الأقدم أجلًا أولًا ────────────────────────────────────
// ما يلزم لطلب إجازة من هذا الرصيد، دون كتابة: يستدعيه planRequest فيرفض بسببه المكتوب قبل إنشاء الطلب.
export function planCompensatory(db,e,{start_date,days_milli,type_name,excludeRequestId=''}){
  const basis=requireDailyBasis(db,e.tenant_id,start_date,`لا يُحسب طلب ${type_name} بالأيام`);
  const lots=lotsOf(db,e.tenant_id,e.id),needed=days_milli*basis.daily_minutes/1000,usable=usableAt(lots,start_date);
  // عند إعادة التقديم لا حجز قائمًا لهذا الطلب (حُرر عند الإعادة)، فالمتاح يُقرأ كما هو.
  void excludeRequestId;
  const available=usable.reduce((n,l)=>n+l.remaining_minutes,0),due=lots.filter(l=>l.due).reduce((n,l)=>n+l.remaining_minutes,0);
  // ما انقضت مهلته اليوم لم يعد إجازة ولو كان تاريخ الطلب سابقًا لانقضائها: الرفض يسمّيه ويسمّي طريقه، فلا يصغر طابور الصرف تحت يد مُعد الرواتب.
  if(available<needed)refuse(409,'insufficient_balance',{what:`رصيدك التعويضي المتاح لإجازة تبدأ في ${start_date} هو ${hoursText(available)} ساعة (${compensatoryDaysText(available,basis.daily_minutes)} يوم) ولا يغطي ${hoursText(needed)} ساعة مطلوبة${due?`؛ ولك ${hoursText(due)} ساعة انقضت مهلتها فلم تعد إجازة: يحيل مُعد الرواتب أجرها إلى المسير ولا تسقط`:''}`,
    next:'الرصيد يُكسب من ساعات عمل إضافي معتمدة اخترت لها الإجازة بدل الأجر، ويُحسب منه ما لم تنقض مهلته اليوم ولا عند بداية الإجازة. اطلب مدة أقصر أو نصف يوم، أو سجّل ساعاتك الإضافية من «الحضور والانصراف»',link:'#attendance'});
  return {minutes:needed,daily_minutes:basis.daily_minutes,working_time_policy_id:basis.policy_id,available_minutes:available};
}
const insertMovement=(db,u,r,creditId,kind,used,reserved,basis,note)=>db.prepare('INSERT INTO compensatory_movements(id,tenant_id,user_id,credit_id,request_id,revision,kind,used_minutes,reserved_minutes,daily_minutes,working_time_policy_id,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(randomUUID(),r.tenant_id,r.employee_id,creditId,r.id,r.revision,kind,used,reserved,basis.daily_minutes,basis.working_time_policy_id,u.id,note,now());
export function compensatoryMovement(db,u,r,terms,kind,note=''){
  writing(db);
  if(kind==='reserve'){
    const plan=planCompensatory(db,{tenant_id:r.tenant_id,id:r.employee_id},{start_date:r.start_date,days_milli:terms.days_milli,type_name:'الإجازة التعويضية'});
    let need=plan.minutes;
    for(const lot of usableAt(lotsOf(db,r.tenant_id,r.employee_id),r.start_date)){
      if(need<=0)break;
      const take=Math.min(need,lot.remaining_minutes);
      insertMovement(db,u,r,lot.id,'reserve',0,take,plan,note);need-=take;
    }
    return;
  }
  // التحرير والخصم والرد تعود إلى القيود نفسها التي حُجز منها، بالمقدار نفسه وأساس التحويل نفسه: أساس آخر حجز لهذا الطلب على القيد (لا عمود عارٍ في GROUP BY).
  const rows=db.prepare(`SELECT m.credit_id,SUM(m.reserved_minutes) AS reserved,SUM(m.used_minutes) AS used,
    (SELECT x.daily_minutes FROM compensatory_movements x WHERE x.request_id=m.request_id AND x.credit_id=m.credit_id AND x.kind='reserve' ORDER BY x.seq DESC LIMIT 1) AS daily_minutes,
    (SELECT x.working_time_policy_id FROM compensatory_movements x WHERE x.request_id=m.request_id AND x.credit_id=m.credit_id AND x.kind='reserve' ORDER BY x.seq DESC LIMIT 1) AS working_time_policy_id
    FROM compensatory_movements m WHERE m.request_id=? GROUP BY m.credit_id ORDER BY MIN(m.seq)`).all(r.id);
  // الخصم بساعات اليوم السارية في تاريخ الإجازة. إن اعتُمدت بين الحجز والاعتماد سياسة ساعات عمل غيّرت طول اليوم فالمحجوز لم يعد يساوي أيام الطلب:
  // لا يُخصم يوم من ست ساعات بثمانٍ ولا العكس. لا يُعاد الحجز هنا (حركة واحدة من كل نوع لكل نسخة من الطلب)، فيُعاد الطلب إلى صاحبه ليُحجز بالأساس الساري.
  if(kind==='debit'){
    const held=rows.find(row=>row.reserved>0),current=dailyBasis(db,r.tenant_id,r.start_date);
    if(held&&current&&current.daily_minutes!==held.daily_minutes)refuse(409,'working_time_changed',{what:`حُجزت ساعات هذا الطلب ويوم العمل ${hoursText(held.daily_minutes)} ساعات، ثم اعتُمدت سياسة ساعات عمل تجعله ${hoursText(current.daily_minutes)} ساعات في ${r.start_date}؛ الخصم بالمحجوز يحسب اليوم بغير طوله`,
      next:'أعد الطلب إلى صاحبه («إعادة») ليعيد تقديمه، فتُحرر الساعات المحجوزة وتُحجز من جديد بساعات اليوم السارية، ثم يُعتمد'});
  }
  for(const row of rows){
    if(kind==='release'&&row.reserved>0)insertMovement(db,u,r,row.credit_id,'release',0,-row.reserved,row,note);
    if(kind==='debit'&&row.reserved>0)insertMovement(db,u,r,row.credit_id,'debit',row.reserved,-row.reserved,row,note);
    if(kind==='refund'&&row.used>0)insertMovement(db,u,r,row.credit_id,'refund',-row.used,0,row,note);
  }
}

// ساعات اختار صاحبها الإجازة بدل الأجر ولم تُسوَّ بعد: طلب قائم، أو معتمد بلا قيد، أو قيد فيه باقٍ أو محجوز. يقرؤها الباب اليدوي في حركات الرواتب
// (لا حركة «عمل إضافي» غير مرتبطة ما دامت قائمة) ومعتمد الساعات قبل قراره.
export function unsettledTimeOff(db,tenantId,userId){
  const lots=new Map(lotsOf(db,tenantId,userId).map(l=>[l.overtime_request_id,l]));
  // ما دُفع نقدًا عند انتهاء الخدمة قبل القيد (م77(6)) مُسوًّى: له حركة مسير قائمة.
  return db.prepare("SELECT id,work_date,minutes,status FROM overtime_requests o WHERE tenant_id=? AND user_id=? AND compensation='time_off' AND status IN ('pending','approved') AND NOT EXISTS(SELECT 1 FROM payroll_adjustments a WHERE a.id=o.adjustment_id AND a.status<>'rejected') ORDER BY work_date").all(tenantId,userId)
    .map(o=>{const lot=lots.get(o.id),state=o.status==='pending'?'pending':!lot?'uncredited':lot.remaining_minutes+lot.reserved_minutes>0?'open':null;
      return state&&{id:o.id,work_date:o.work_date,minutes:o.minutes,state,state_name:{pending:'بانتظار الاعتماد',uncredited:'معتمد لم يُقيَّد رصيدًا',open:'رصيده لم يُستعمل كله ولم يُحل'}[state]};}).filter(Boolean);
}
// حركات «عمل إضافي» يدوية (غير مرتبطة بطلب ولا بإحالة رصيد) مقترحة أو معتمدة لصاحب الساعات في شهر العمل أو الشهر الذي يليه: تُعرض على معتمد
// الساعات التي اختير لها الإجازة قبل قراره، فقد تكون دفعت الساعات نفسها أجرًا.
export function manualOvertimeNear(db,tenantId,userId,workDate){
  const month=workDate.slice(0,7),[y,m]=month.split('-').map(Number),next=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
  return db.prepare("SELECT a.id,a.month,a.amount_minor,a.status FROM payroll_adjustments a WHERE a.tenant_id=? AND a.user_id=? AND a.kind='overtime' AND a.status IN ('proposed','approved') AND a.month IN (?,?) AND NOT EXISTS(SELECT 1 FROM overtime_requests o WHERE o.adjustment_id=a.id) AND NOT EXISTS(SELECT 1 FROM compensatory_payouts p WHERE p.adjustment_id=a.id) ORDER BY a.created_at")
    .all(tenantId,userId,month,next).map(a=>({id:a.id,month:a.month,amount:sar(a.amount_minor),status:a.status}));
}

// ── ما انقضت مهلته أو انتهت خدمة صاحبه: إحالة إلى المسير بيد إنسان ─────────────────────
// المستحق يُشتق من التواريخ والدفتر كل مرة، فلا صف «منتهٍ» يُكتب ولا شيء يُحذف. الحركة المرفوضة تعيد ساعاتها مستحقةً من جديد.
export function tenantLots(db,tenantId,date=riyadhDate()){
  const users=db.prepare('SELECT DISTINCT user_id FROM compensatory_credits WHERE tenant_id=?').all(tenantId).map(r=>r.user_id);
  return users.flatMap(userId=>lotsOf(db,tenantId,userId,date));
}
export const dueLots=(db,tenantId,date=riyadhDate())=>tenantLots(db,tenantId,date).filter(l=>l.due);
// أجر الرصيد غير المستعمل. اللائحة التنفيذية (م22 مكرر/4) تقول عند ترك العمل «أجر الإجازات التعويضية المستحقة» ولم تفصّل حسابه، وهي ساكتة
// عما تنقضي مهلته والموظف على رأس العمل. فلا تختار المنصة القراءة الأدنى: تحسب القراءتين وتعرضهما على مُعد الرواتب وتقترح أكبرهما.
//   leave_wage: دقائق الإجازة الباقية × أجر الساعة الفعلي (أجر الإجازة لو أُخذت)، بالأجر الساري يوم الاستحقاق.
//   overtime_wage: الساعات الإضافية الأصلية المقابلة × معادلة السياسة المقبولة (نظام العمل م107/1)، بأجر يوم العمل.
// بلا سياسة عمل إضافي مقبولة أو بلا عقد: لا مقترح، ويدخل المُعد المبلغ وأساسه. أي القراءتين تعتمد الشركة سؤال مفتوح لمدير الموارد البشرية.
export const PAYOUT_READINGS={leave_wage:'أجر الإجازة التعويضية المستحقة (اللائحة التنفيذية م22 مكرر/4)',overtime_wage:'أجر الساعات الإضافية الأصلية — «الأجر الإضافي نقدًا» (م77(6) من لائحة الشركة؛ نظام العمل م107/1)'};
export function payoutBasis(db,tenantId,lot,dueOn){
  const minutes=overtimeMinutesBack(lot.remaining_minutes,lot,lot.overtime_back_minutes),policy=overtimePolicy(db,tenantId,lot.work_date);
  const worked=policy?wageBasis(db,lot.user_id,lot.work_date):null,atDue=policy?wageBasis(db,lot.user_id,dueOn)??worked:null;
  if(!worked||!atDue)return {minutes,policy,leave_wage_minor:null,overtime_wage_minor:null,suggested_minor:null,reading:null};
  const leaveWage=Math.round(lot.remaining_minutes*atDue.actual_minor/(policy.hour_divisor_days*policy.hour_divisor_hours*60)),overtimeWage=overtimeAmountMinor(minutes,worked,policy);
  return {minutes,policy,leave_wage_minor:leaveWage,overtime_wage_minor:overtimeWage,suggested_minor:Math.max(leaveWage,overtimeWage),reading:leaveWage>=overtimeWage?'leave_wage':'overtime_wage'};
}
const dueOnOf=(db,tenantId,lot)=>lot.cause==='service_ended'?serviceEndedOn(db,tenantId,lot.user_id):shiftDate(lot.expires_on,1);
// إجازة تعويضية معتمدة (خُصمت ساعاتها) يقع منها يوم بعد انتهاء الخدمة: لن تؤخذ، وساعاتها ليست «مستعملة». تُلغى فتعود إلى قيودها نفسها وتظهر مستحقة الصرف.
export function untakenAfterExit(db,tenantId,userId,ended=serviceEndedOn(db,tenantId,userId)){
  if(!ended)return [];
  return db.prepare("SELECT r.id,r.start_date,r.end_date,t.counted_dates_json,(SELECT COALESCE(SUM(m.used_minutes),0) FROM compensatory_movements m WHERE m.request_id=r.id) AS used FROM leave_requests r JOIN leave_request_terms t ON t.request_id=r.id AND t.revision=r.revision WHERE r.tenant_id=? AND r.employee_id=? AND r.status='approved' AND t.source='overtime' AND r.end_date>? ORDER BY r.start_date")
    .all(tenantId,userId,ended).filter(r=>r.used>0).map(r=>({request_id:r.id,start_date:r.start_date,end_date:r.end_date,minutes:r.used,hours:hoursText(r.used),days_after_exit:JSON.parse(r.counted_dates_json).filter(d=>d>ended).length,ended_on:ended}));
}
export function payoutQueue(db,u,date=riyadhDate()){
  if(!holds(db,u,'payroll.prepare'))return [];
  const due=dueLots(db,u.tenant_id,date).map(l=>{
    const dueOn=dueOnOf(db,u.tenant_id,l),b=payoutBasis(db,u.tenant_id,l,dueOn);
    return {id:l.id,user_id:l.user_id,employee_name:nameOf(db,l.user_id),work_date:l.work_date,expires_on:l.expires_on,due_on:dueOn,
      cause:l.cause,cause_name:LOT_STATES[l.cause==='service_ended'?'service_ended':'due'],remaining_hours:hoursText(l.remaining_minutes),overtime_minutes:b.minutes,overtime_hours:hoursText(b.minutes),ratio:ratioText(l.ratio_bp),
      suggested:sar(b.suggested_minor),leave_wage:sar(b.leave_wage_minor),overtime_wage:sar(b.overtime_wage_minor),reading:b.reading,reading_name:b.reading?PAYOUT_READINGS[b.reading]:null,
      created_at:l.created_at,actions:l.user_id!==u.id?['compensatory_to_payroll']:[]};
  });
  // إجازة معتمدة بعد انتهاء الخدمة: ساعاتها لا تدخل الطابور قبل أن تلغيها خدمات الموظف، فتُعرض هنا بلا زر حتى لا تسقط في صمت.
  const ended=db.prepare('SELECT DISTINCT user_id FROM compensatory_credits WHERE tenant_id=?').all(u.tenant_id).flatMap(r=>untakenAfterExit(db,u.tenant_id,r.user_id).map(x=>({...x,user_id:r.user_id})));
  return [...due,...ended.map(x=>({id:x.request_id,user_id:x.user_id,employee_name:nameOf(db,x.user_id),work_date:x.start_date,expires_on:x.end_date,due_on:x.ended_on,cause:'untaken_leave',
    cause_name:`إجازة تعويضية معتمدة ${x.start_date===x.end_date?`يوم ${x.start_date}`:`من ${x.start_date} إلى ${x.end_date}`} بعد انتهاء الخدمة في ${x.ended_on}: تلغيها خدمات الموظف من «الإجازات» فتعود ساعاتها مستحقة الصرف`,
    remaining_hours:x.hours,overtime_minutes:null,overtime_hours:null,ratio:null,suggested:null,leave_wage:null,overtime_wage:null,reading:null,reading_name:null,created_at:x.ended_on,actions:[]}))];
}
const monthRange=month=>{const [y,m]=month.split('-').map(Number);return {from:`${month}-01`,to:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};};
// المسير لا يحمل سطرًا إلا لمن له عقد يتقاطع مع الشهر (payroll.mjs): حركة معتمدة في شهر بلا سطر لا يدفعها مسير أبدًا.
export function hasPayrollLine(db,tenantId,userId,month){
  const {from,to}=monthRange(month);
  return !!db.prepare("SELECT 1 FROM employment_contracts WHERE tenant_id=? AND user_id=? AND status IN ('active','ended') AND start_date<=? AND COALESCE(ended_on,end_date,'9999-12-31')>=?").get(tenantId,userId,to,from);
}
const runLock=(db,tenantId,month)=>db.prepare("SELECT status FROM payroll_runs WHERE tenant_id=? AND month=? AND status IN ('in_review','reviewed','approved')").get(tenantId,month)?.status??null;
function firstOpenMonth(db,tenantId,month){
  let target=month;
  for(let guard=0;guard<24&&runLock(db,tenantId,target);guard++){
    const [y,m]=target.split('-').map(Number);target=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
  }
  return target;
}
// إلى أي مسير تذهب الإحالة. من انتهت خدمته لا سطر له بعد شهر انتهائها، فلا تُنقل إحالته إلى شهر لاحق: إن كان مسير ذلك الشهر مقفلًا قيل من يفتحه،
// وإن اعتُمد فلا مسير يحملها: تبقى الساعات «مستحقة» وتُحمل على المخالصة بقرار مكتوب (settlementCompensatoryGate).
export function payoutRoute(db,tenantId,lot,today=riyadhDate()){
  if(lot.cause!=='service_ended'){
    const month=firstOpenMonth(db,tenantId,today.slice(0,7));
    return hasPayrollLine(db,tenantId,lot.user_id,month)?{month,lock:null}:{month:null,lock:'no_line'};
  }
  const month=serviceEndedOn(db,tenantId,lot.user_id).slice(0,7);
  return {month,lock:runLock(db,tenantId,month)};
}
const LOCK_OWNER={in_review:{owner:'مراجع الرواتب',owner_role:'payroll.review'},reviewed:{owner:'معتمد الرواتب',owner_role:'payroll.approve'}};
const toMinor=amount=>{const m=/^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(amount));return m?Number(m[1])*100+Number((m[2]??'').padEnd(2,'0')):null;};
export function compensatoryToPayroll(db,supplied,creditId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['month','amount','basis']);
  if(!holds(db,u,'payroll.prepare'))refuse(403,'not_permitted',{what:'إحالة الرصيد التعويضي إلى المسير لمُعد الرواتب',next:'اطلبها ممن يحمل تصريح payroll.prepare؛ ويعتمد الحركة بعده حامل payroll.approve'});
  const today=riyadhDate(),credit=typeof creditId==='string'&&db.prepare('SELECT user_id FROM compensatory_credits WHERE id=? AND tenant_id=?').get(creditId,u.tenant_id);
  const lot=credit&&credit.user_id!==u.id?lotsOf(db,u.tenant_id,credit.user_id,today).find(l=>l.id===creditId):null;
  if(!lot)refuse(404,'not_found',{what:'القيد التعويضي غير متاح للإحالة',next:'تُحال القيود المعروضة في «أرصدة تعويضية مستحقة الصرف»، ولا يحيل أحد رصيده لنفسه'});
  if(!lot.due)refuse(409,'compensatory_not_due',{what:lot.remaining_minutes>0?`رصيد ${nameOf(db,lot.user_id)} عن عمل ${lot.work_date} ما زال متاحًا للإجازة حتى ${lot.expires_on}`:'لا ساعات باقية في هذا القيد: استُعملت إجازةً أو حُجزت لطلب قائم أو أُحيلت إلى المسير',
    next:'لا يُصرف أجر عن رصيد يستطيع صاحبه أخذه إجازة؛ الإحالة بعد انقضاء المهلة أو انتهاء الخدمة، وللباقي غير المحجوز فقط'});
  if(!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND active=1').get(lot.user_id,u.tenant_id))refuse(409,'employee_inactive',{what:'لا تُقترح حركة مسير لحساب موقوف',
    missing:[{document:'حساب الموظف مفعَّلًا حتى تُحال مستحقاته',why:'حركات المسير تُقترح لحسابات نشطة، والرصيد التعويضي مستحق عند ترك العمل (اللائحة التنفيذية م22 مكرر/4)',owner:'الموارد البشرية',owner_role:'people.manage'}],
    next:'يُعاد تفعيل الحساب حتى تُعتمد المخالصة، ثم تُحال الساعات'});
  // المسير الذي يحمل الحركة، قبل أي كتابة: حركة في شهر لا سطر لصاحبها فيه لا يدفعها مسير، والدفتر يقول «أُحيلت».
  const ended=lot.cause==='service_ended'?serviceEndedOn(db,u.tenant_id,lot.user_id):null,route=payoutRoute(db,u.tenant_id,lot,today),who=nameOf(db,lot.user_id);
  if(route.lock==='approved')refuse(409,'exit_month_paid',{what:`انتهت خدمة ${who} في ${ended} ومسير ${route.month} اعتُمد فلا يُعاد فتحه، ولا سطر لمن انتهت خدمته في مسير لاحق: لا مسير يحمل أجر هذه الساعات`,
    missing:[{document:'قرار مكتوب بحمل أجر الرصيد التعويضي على مخالصة نهاية الخدمة',why:'للعامل أجر إجازاته التعويضية المستحقة إذا ترك العمل قبل استعمالها (اللائحة التنفيذية م22 مكرر/4)، ولا يسقطه إقفال مسير',owner:'معتمد الرواتب حامل تصريح التوظيف والتهيئة عند اعتماد المخالصة',owner_role:'people.manage'}],
    next:'تبقى الساعات «مستحقة الصرف» وتظهر بندًا مفتوحًا عند اعتماد المخالصة بمبلغها المقترح؛ يُكتب هناك كيف ومتى تُصرف مع مستحقات نهاية الخدمة',link:'#payroll-extras'});
  if(route.lock==='no_line')refuse(409,'no_payroll_line',{what:`لا عقد لـ${who} يتقاطع مع أول شهر مسيره مفتوح، فلا سطر له في مسيره يحمل الحركة`,
    missing:[{document:'عقد ساري أو مجدد يغطي شهر الصرف',why:'المسير يحمل سطرًا لمن له عقد يتقاطع مع الشهر فقط',owner:'الموارد البشرية',owner_role:'hr.contracts.approve'}],next:'يُجدد العقد أو تُنهى الخدمة في المنصة، ثم تُحال الساعات'});
  if(route.lock)refuse(409,'exit_month_locked',{what:`انتهت خدمة ${who} في ${ended} ومسير ${route.month} تجاوز المسودة؛ لا سطر له في مسير لاحق، فلا تُنقل الحركة إلى شهر بعده`,
    missing:[{document:`مسير ${route.month} معادًا إلى المسودة`,why:'آخر مسير يحمل سطرًا لصاحب الرصيد هو مسير شهر انتهاء خدمته',...LOCK_OWNER[route.lock]}],
    next:`يعيد ${LOCK_OWNER[route.lock].owner} مسير ${route.month} إلى المسودة بسبب مكتوب («إعادة» في شاشة الرواتب)، ثم تُحال الساعات فتدخله. تبقى الساعات «مستحقة الصرف» حتى ذلك`,link:'#payroll'});
  let month=route.month;
  if(input.month!==undefined&&input.month!==''&&input.month!==month){
    month=input.month;
    if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!hasPayrollLine(db,u.tenant_id,lot.user_id,month))refuse(409,'no_payroll_line',{what:`لا سطر لـ${who} في مسير ${String(month)}: لا عقد له يتقاطع مع ذلك الشهر`,next:`أحل الحركة إلى مسير ${route.month}، وهو آخر مسير يحمل سطرًا له`});
  }
  const dueOn=ended??shiftDate(lot.expires_on,1),b=payoutBasis(db,u.tenant_id,lot,dueOn),{minutes,policy}=b,suggested=b.suggested_minor;
  const amount=input.amount===undefined||input.amount===''?sar(suggested):input.amount;
  if(amount===null)refuse(400,'amount_required',{what:'لا مبلغ مقترح لهذه الساعات',
    missing:[{document:'سياسة عمل إضافي مقبولة وعقد ساري في يوم العمل',why:'المقترح أكبر القراءتين: أجر الإجازة المستحقة (الساعات الباقية × أجر الساعة الفعلي) أو أجر الساعات الإضافية الأصلية بمعادلة السياسة، وكلاهما يقرأ السياسة والعقد',owner:'مُعد الرواتب يدخل المبلغ وأساسه إن تعذر المقترح',owner_role:'payroll.prepare'}],
    next:'أدخل المبلغ واكتب أساس احتسابه'});
  const minor=toMinor(amount),override=suggested!==null&&minor!==suggested;
  const readings=suggested===null?'':`أجر الإجازة المستحقة ${sar(b.leave_wage_minor)} ريال (${hoursText(lot.remaining_minutes)} ساعة × أجر الساعة الفعلي في ${dueOn})، وأجر الساعات الإضافية الأصلية ${sar(b.overtime_wage_minor)} ريال (${hoursText(minutes)} ساعة × (أجر الساعة الفعلي + ${policy.basic_share_bp/100}% من الأساسي))؛ الشهر ${policy.hour_divisor_days} يومًا (م50(1)) واليوم ${policy.hour_divisor_hours} ساعات (م73(2))`;
  let basis;
  if(input.basis!==undefined&&input.basis!=='')basis=v.text(input.basis,'أساس الاحتساب',600,10);
  else if(suggested!==null&&!override)basis=`المقترح أكبر القراءتين — ${PAYOUT_READINGS[b.reading]}: ${readings}`;
  else refuse(400,'basis_required',{what:'المبلغ يخالف المقترح من السياسة أو لا مقترح له',next:'اكتب أساس الاحتساب (عشرة أحرف على الأقل)'});
  // سقف م77(5) من لائحة الشركة لا يمنع هذه الحركة: الساعات عُملت واعتُمدت، وأجر الرصيد عند ترك العمل حق نظامي (م22 مكرر/4) لا يسقطه سقف لائحة.
  // التجاوز يُكتب في سبب الحركة فيراه معتمد الرواتب ويقرر، ويبقى ما أُحيل محسوبًا في السقف لما يُحوَّل بعده من عمل إضافي (annualPaidMinor).
  const wage=policy?wageBasis(db,lot.user_id,lot.work_date):null;
  let overCap='';
  if(wage&&minor!==null){
    const used=annualPaidMinor(db,lot.user_id,yearOf(lot.work_date)),cap=annualCapMinor(wage.basic_minor,policy);
    if(used+minor>cap)overCap=` تنبيه لمعتمد الرواتب: بهذه الحركة يتجاوز أجر العمل الإضافي المحوَّل في ${yearOf(lot.work_date)} سقف لائحة الشركة (${policy.annual_cap_basic_months} أشهر من الأساسي، م77(5)) بمقدار ${sar(used+minor-cap)} ريال؛ السقف قرار لائحة لا يسقط أجر ساعات عُملت واعتُمدت.`;
  }
  const why=lot.cause==='service_ended'?`انتهت خدمة صاحبه في ${ended} قبل استعماله: يُدفع الأجر الإضافي نقدًا (م77(6) من لائحة الشركة، ص 27؛ واللائحة التنفيذية م22 مكرر/4)`:`انقضت مهلته في ${lot.expires_on} ولم يُستعمل، واللائحة التنفيذية ساكتة عما يترتب، ولائحة الشركة (م77(6)) كذلك`;
  const adjustment=proposeAdjustment(db,u,{user_id:lot.user_id,kind:'overtime',month,amount,
    reason:`رصيد إجازة تعويضية ${hoursText(lot.remaining_minutes)} ساعة عن عمل إضافي يوم ${lot.work_date} ${why}؛ يقابل ${hoursText(minutes)} ساعة عمل إضافي (÷ ${ratioText(lot.ratio_bp)}). أساس الاحتساب: ${basis}${override&&readings?` (${readings})`:''}.${overCap}`},{linked:true});
  const payoutId=randomUUID();
  db.prepare('INSERT INTO compensatory_payouts(id,tenant_id,user_id,credit_id,cause,leave_minutes,overtime_minutes,adjustment_id,suggested_minor,proposed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(payoutId,u.tenant_id,lot.user_id,lot.id,lot.cause,lot.remaining_minutes,minutes,adjustment.id,suggested,u.id,now());
  audit(db,u,'compensatory_payout',payoutId,'compensatory.to_payroll',{}, {user_id:lot.user_id,credit_id:lot.id,cause:lot.cause,leave_minutes:lot.remaining_minutes,overtime_minutes:minutes,adjustment_id:adjustment.id,suggested_minor:suggested,
    leave_wage_minor:b.leave_wage_minor,overtime_wage_minor:b.overtime_wage_minor,reading:b.reading,override,over_company_cap:!!overCap});
  notifySubject(db,{userId:lot.user_id,kind:'compensatory_to_payroll',subjectKind:'compensatory_credit',subjectId:lot.id,title:`أُحيل رصيدك التعويضي عن عمل ${dayName(lot.work_date)} إلى المسير`,
    body:`${hoursText(lot.remaining_minutes)} ساعة إجازة لم تُستعمل اقتُرح صرف أجرها في مسير ${month}. تدخل راتبك بعد اعتماد معتمد الرواتب.`});
  return {id:payoutId,credit_id:lot.id,adjustment_id:adjustment.id,overtime_minutes:minutes,month,suggested:sar(suggested),leave_wage:sar(b.leave_wage_minor),overtime_wage:sar(b.overtime_wage_minor),reading:b.reading,over_company_cap:!!overCap};
}
// بوابة المخالصة (م22 مكرر/4). قراءة صرفة تعيد ما يمنع اعتماد مخالصة صاحب الرصيد، مفصولًا بحسب من يملك رفعه:
//   untaken: إجازة معتمدة بعد انتهاء الخدمة لم تُلغَ — ساعاتها مخصومة ولن تؤخذ (خدمات الموظف).
//   routable: رصيد باقٍ أو محجوز له مسير يحمله — يحيله مُعد الرواتب (أو يُبت في الطلب القائم أولًا).
//   unroutable: رصيد لا مسير يحمله (مسير شهر ترك العمل اعتُمد)، أو إحالة معتمدة علقت في شهر لا سطر لصاحبها فيه — يُحمل على المخالصة بقرار مكتوب.
export function settlementCompensatoryGate(db,tenantId,userId){
  const today=riyadhDate(),lots=lotsOf(db,tenantId,userId,today).filter(l=>l.remaining_minutes>0||l.reserved_minutes>0),untaken=untakenAfterExit(db,tenantId,userId);
  const stranded=db.prepare("SELECT p.credit_id,p.leave_minutes,p.overtime_minutes,a.amount_minor,a.month FROM compensatory_payouts p JOIN payroll_adjustments a ON a.id=p.adjustment_id WHERE p.tenant_id=? AND p.user_id=? AND a.status='approved' AND a.run_id IS NULL").all(tenantId,userId)
    .filter(p=>!hasPayrollLine(db,tenantId,userId,p.month));
  const open=lots.map(l=>({lot:l,lock:l.due?payoutRoute(db,tenantId,l,today).lock:null})),routable=open.filter(x=>x.lock!=='approved'),sum=rows=>rows.reduce((n,x)=>n+x.lot.remaining_minutes+x.lot.reserved_minutes,0);
  const unroutable=[...open.filter(x=>x.lock==='approved').map(({lot})=>{const b=payoutBasis(db,tenantId,lot,dueOnOf(db,tenantId,lot));return {credit_id:lot.id,work_date:lot.work_date,leave_minutes:lot.remaining_minutes,overtime_minutes:b.minutes,suggested_minor:b.suggested_minor};}),
    ...stranded.map(p=>({credit_id:p.credit_id,work_date:null,leave_minutes:0,stranded_leave_minutes:p.leave_minutes,overtime_minutes:p.overtime_minutes,suggested_minor:p.amount_minor,stranded_month:p.month}))];
  if(!lots.length&&!untaken.length&&!unroutable.length)return null;
  const minutes=sum(open);
  return {minutes,hours:hoursText(minutes),lots:lots.length,untaken,routable_minutes:sum(routable),routable_hours:hoursText(sum(routable)),unroutable};
}
// بند إخلاء طرف مشتق لما لا يحمله مسير: يدخل قائمة البنود المفتوحة عند اعتماد المخالصة بمبلغه المقترح، ويُحفظ معها إن حُمل عليها بقرار مكتوب،
// فيقرؤه lotsOf «حُمل على المخالصة». leave_minutes صفر للإحالة العالقة: ساعاتها محسوبة في إحالتها أصلًا.
export function settlementCarryBlocker(gate){
  if(!gate?.unroutable.length)return null;
  const leave=gate.unroutable.reduce((n,x)=>n+x.leave_minutes+(x.stranded_leave_minutes??0),0),known=gate.unroutable.every(x=>x.suggested_minor!==null);
  return {source:'compensatory',title:`رصيد إجازة تعويضية ${hoursText(leave)} ساعة لا مسير يحمله: مسير شهر ترك العمل اعتُمد (اللائحة التنفيذية م22 مكرر/4)${known?'':' — لا مبلغ مقترح: لا سياسة عمل إضافي مقبولة أو لا عقد'}`,
    amount_minor:known?gate.unroutable.reduce((n,x)=>n+x.suggested_minor,0):null,action_owner:'يُصرف أجره مع مستحقات نهاية الخدمة بقرار مكتوب يذكر المبلغ وموعده',lots:gate.unroutable};
}

// ── المسح اليومي (يُستدعى من reminders.mjs): يذكّر ولا يكتب مالًا ─────────────────────
// طابور المهام لا يقرر ولا يقترح حركة راتب (قواعد jobs.mjs): المسح ينبّه صاحب الرصيد قبل انقضاء مهلته، ويرفع ما انقضت مهلته
// أو انتهت خدمة صاحبه إلى مُعد الرواتب ليحيله. once: دالة «مرة واحدة» من reminders.mjs، وholders: حاملو تصريح من غير الأدمن.
export function compensatorySweep(db,tenantId,date,{once,holders}){
  let warned=0,raised=0,due=0;
  const users=db.prepare('SELECT DISTINCT user_id FROM compensatory_credits WHERE tenant_id=?').all(tenantId).map(r=>r.user_id);
  for(const userId of users)for(const lot of lotsOf(db,tenantId,userId,date)){
    if(lot.state==='expiring'&&once(`compensatory-expiring:${lot.id}`)){
      notifySubject(db,{userId,kind:'compensatory_expiring',subjectKind:'compensatory_credit',subjectId:lot.id,title:`رصيدك التعويضي ${hoursText(lot.remaining_minutes)} ساعة تنقضي مهلته في ${dayName(lot.expires_on,date)}`,
        body:`بقي ${lot.days_left} يومًا. اطلب «الإجازة التعويضية» من شاشة الإجازات قبلها؛ ما لا تستعمله يُقترح صرف أجره في المسير، ولا يسقط.`});warned++;
    }
    if(!lot.due)continue;
    due++;
    if(!once(`compensatory-due:${lot.id}:${lot.cause}`))continue;
    notifySubject(db,{userId,kind:'compensatory_due',subjectKind:'compensatory_credit',subjectId:lot.id,title:`${lot.cause==='service_ended'?'انتهت خدمتك':'انقضت مهلة رصيدك التعويضي'}: ${hoursText(lot.remaining_minutes)} ساعة تُحال أجرًا`,
      body:'يقترح مُعد الرواتب صرف أجرها في المسير ويعتمده معتمد الرواتب: لا يقل المقترح عن أجر الإجازة المستحقة ولا عن أجر ساعاتك الإضافية الأصلية. لا يسقط منها شيء.'});
    for(const holder of holders('payroll.prepare')){
      if(holder===userId)continue;
      notifySubject(db,{userId:holder,kind:'compensatory_payout_needed',subjectKind:'compensatory_payout',subjectId:lot.id,title:`رصيد تعويضي مستحق الصرف: ${nameOf(db,userId)} — ${hoursText(lot.remaining_minutes)} ساعة`,
        body:`${lot.cause==='service_ended'?'انتهت خدمة صاحبه':`انقضت مهلته في ${lot.expires_on}`}. أحِله إلى المسير من «الحضور والانصراف» ← «أرصدة تعويضية مستحقة الصرف»؛ المنصة لا تقترح الحركة آليًا.`});raised++;
    }
  }
  // إجازة تعويضية معتمدة يقع منها يوم بعد انتهاء الخدمة: ساعاتها مخصومة ولن تؤخذ. يُرفع ذلك مرة إلى مُعدي الرواتب (تظهر لهم في الطابور بلا زر)
  // ليطلبوا من خدمات الموظف إلغاءها، فتعود الساعات إلى قيودها وتصير مستحقة الصرف. المسح لا يلغي إجازة ولا يكتب مالًا.
  let untaken=0;
  for(const userId of users)for(const x of untakenAfterExit(db,tenantId,userId)){
    untaken++;
    if(!once(`compensatory-untaken:${x.request_id}`))continue;
    for(const holder of holders('payroll.prepare'))if(holder!==userId)notifySubject(db,{userId:holder,kind:'compensatory_payout_needed',subjectKind:'compensatory_payout',subjectId:x.request_id,title:`إجازة تعويضية معتمدة بعد انتهاء الخدمة: ${nameOf(db,userId)} — ${x.hours} ساعة`,
      body:`انتهت خدمة صاحبها في ${x.ended_on} وإجازته من ${x.start_date} إلى ${x.end_date} لن تؤخذ. تلغيها خدمات الموظف من «الإجازات» فتعود ساعاتها إلى قيودها وتظهر في «أرصدة تعويضية مستحقة الصرف»؛ ولا تُعتمد المخالصة قبل ذلك.`});
  }
  return {warned,raised,due,untaken};
}
