// القيم التي تقرأها أكثر من وحدة موارد بشرية واحدة: تُقرَّر مرة واحدة وتُقرأ من هنا.
//
// قبل هذا الملف كانت القيمة الواحدة مكتوبة في موضعين: حد الإجازة بلا أجر في سياسة أنواع الإجازات (098) وفي سياسة
// المخالصة (102)، وسقف غرامات م116 وأساس الأجر الذي يُقاس عليه في جدول الجزاءات (097) وفي سياسة سقوف الاستقطاع (102).
// كل دالة هنا تُرجع القيمة السارية مع مصدرها، وتُرجع معها ما اختلف بين الموضعين (mismatch) كي يظهر الخلاف في الشاشة
// بدل أن يبقى فرقًا صامتًا بين وحدتين.
//
// هذه الوحدة تقرأ ولا تكتب، ولا تستورد وحدة موارد بشرية أخرى (تقرأ الجداول مباشرة) فلا تنشأ دورة استيراد.

export const PAY_COMPONENT_KEYS=['basic','housing','transport','other_allowance'];
export const PAY_COMPONENT_NAMES={basic:'الراتب الأساسي',housing:'بدل سكن',transport:'بدل نقل',other_allowance:'بدل آخر'};
export const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
// القسمة بالتقريب نصف فأعلى على الأعداد الصحيحة بالهللة. نسخة واحدة تستعملها وحدات الجزاءات والرواتب والإجازات.
export const halfUp=(n,d)=>Number((BigInt(n)*2n+BigInt(d))/(BigInt(d)*2n));

const json=value=>{try{return JSON.parse(value);}catch{return null;}};

// ── السياسات المعتمدة السارية، بلا استيراد وحداتها ─────────────────────────────
export function acceptedLeaveTypeParameters(db,tenantId,date){
  const row=db.prepare("SELECT id,parameters FROM leave_type_policies WHERE tenant_id=? AND status='accepted' AND effective_from<=? ORDER BY effective_from DESC,decided_at DESC LIMIT 1").get(tenantId,date);
  const parameters=row?json(row.parameters):null;
  return parameters?{id:row.id,parameters}:null;
}
export function acceptedRegulationParameters(db,tenantId,kind,date){
  const row=db.prepare("SELECT id,parameters FROM regulation_policies WHERE tenant_id=? AND kind=? AND status='accepted' AND effective_from<=? ORDER BY effective_from DESC,decided_at DESC LIMIT 1").get(tenantId,kind,date);
  const parameters=row?json(row.parameters):null;
  return parameters?{id:row.id,parameters}:null;
}
export function acceptedScheduleParameters(db,tenantId,date){
  const row=db.prepare("SELECT id,parameters FROM discipline_schedules WHERE tenant_id=? AND status='accepted' AND effective_from<=? ORDER BY effective_from DESC,decided_at DESC LIMIT 1").get(tenantId,date);
  const parameters=row?json(row.parameters):null;
  return parameters?{id:row.id,parameters}:null;
}

// ── 0) أساس اليوم في دورة الرواتب (م5، م50/1) ──────────────────────────────────
// اختيار واحد مخزَّن في سياسة «دورة الرواتب» (day_basis: thirty | calendar). كان يُفك في موضعين بحسابين مختلفين
// (أيام الشهر من Date.UTC في المسير، ومن نص التاريخ في أثر الإجازة على الأجر)؛ صارا يقرآن هذه الدالة.
// ملاحظة: هذا أساس اليوم في صرف الأجر، وهو غير day_basis_days في سقوف الاستقطاع والغرامات (عدد ثابت 28–31، م116).
export function cycleDayBasis(cycleParameters,monthEndDate){
  const days=Number(String(monthEndDate).slice(8,10));
  return cycleParameters?.day_basis==='thirty'?30:days;
}

// ── 1) الإجازة بلا أجر فوق الحد (م86/2ب، م91/3، م91/6) ─────────────────────────
// قرار واحد: كم يومًا يبدأ عنده الأثر، وهل يُحسم الزائد وحده أم المدة كلها. يوقف استحقاق السنوية (محرك الاستحقاق)
// ويُخصم من مدة الخدمة (المخالصة). موضعه النظامي سياسة أنواع الإجازات، فهي المرجع، وسياسة المخالصة تبقى مقروءة
// لما هو مخزَّن من قبلها (مسار آمن للترحيل).
export const UNPAID_LEAVE_ARTICLES=['م86/2ب','م91/3','م91/6'];
export const UNPAID_LEAVE_MODES={none:'لا يُحسم من مدة الخدمة شيء',excess:'يُحسم ما زاد على الحد فقط',total_when_over:'يُحسم المجموع كله متى تجاوز الحد (ظاهر نص م91/3)'};
export const DEFAULT_UNPAID_LEAVE_TYPES=['unpaid'];

// القيمة كما خزنتها سياسة أنواع الإجازات: الحقل الموحد أولًا، ثم حدود نوع «unpaid» في السياسات المعتمدة قبل التوحيد.
export function leavePolicyUnpaidRule(parameters){
  if(!parameters)return null;
  const block=parameters.unpaid_leave;
  if(block&&Number.isInteger(block.threshold_days))return {threshold_days:block.threshold_days,mode:block.mode??null,types:block.types??null,legacy:false};
  const limits=parameters.types?.find(t=>t.code==='unpaid')?.limits??null;
  const legacy=limits&&Number.isInteger(limits.accrual_stops_after_days)?limits.accrual_stops_after_days:null;
  return legacy===null?null:{threshold_days:legacy,mode:null,types:null,legacy:true};
}

// يُرجع القاعدة السارية ومصدر كل قيمة فيها، مع ما اختلف بين الموضعين. null إن لم تُعتمد أي سياسة من الاثنتين.
export function unpaidLeaveRule(db,tenantId,date=riyadhToday()){
  const leave=acceptedLeaveTypeParameters(db,tenantId,date),settlement=acceptedRegulationParameters(db,tenantId,'settlement',date);
  const fromLeave=leavePolicyUnpaidRule(leave?.parameters),s=settlement?.parameters??null;
  const settlementThreshold=Number.isInteger(s?.unpaid_leave_threshold_days)?s.unpaid_leave_threshold_days:null;
  const settlementMode=s?.unpaid_leave_mode??null;
  if(!fromLeave&&settlementThreshold===null)return null;
  const threshold=fromLeave?fromLeave.threshold_days:settlementThreshold;
  const thresholdSource=fromLeave?'leave_policy':'settlement_policy';
  const mode=fromLeave?.mode??settlementMode??null;
  const modeSource=mode===null?null:fromLeave?.mode?'leave_policy':'settlement_policy';
  const mismatch=[];
  if(fromLeave&&settlementThreshold!==null&&settlementThreshold!==fromLeave.threshold_days)
    mismatch.push(`حد الإجازة بلا أجر: ${fromLeave.threshold_days} يومًا في سياسة أنواع الإجازات و${settlementThreshold} يومًا في سياسة المخالصة. المعتمد ما في سياسة أنواع الإجازات.`);
  if(fromLeave?.mode&&settlementMode&&settlementMode!==fromLeave.mode)
    mismatch.push(`طريقة حسم الإجازة بلا أجر: «${UNPAID_LEAVE_MODES[fromLeave.mode]}» في سياسة أنواع الإجازات و«${UNPAID_LEAVE_MODES[settlementMode]}» في سياسة المخالصة. المعتمد ما في سياسة أنواع الإجازات.`);
  return {threshold_days:threshold,threshold_source:thresholdSource,mode,mode_source:modeSource,
    // نطاق المسح في المخالصة: رموز أنواع الإجازة بلا أجر كما سجلتها سياسة المخالصة، وتشمل رموزًا قديمة لا تعرفها سياسة الأنواع.
    types:s?.unpaid_leave_types??DEFAULT_UNPAID_LEAVE_TYPES,
    leave_policy_id:leave?.id??null,settlement_policy_id:settlement?.id??null,
    legacy_leave_shape:!!fromLeave?.legacy,decided:mode!==null,articles:UNPAID_LEAVE_ARTICLES,mismatch};
}
// الشكل الذي تقرأه excludedServiceDays في app/payroll-rules.mjs.
export function settlementUnpaidShape(rule){
  return rule&&rule.decided?{unpaid_leave_threshold_days:rule.threshold_days,unpaid_leave_mode:rule.mode,unpaid_leave_types:rule.types}:null;
}
// الحد الذي يتوقف عنده استحقاق السنوية. null إن لم تُعتمد سياسة تحدده.
export function accrualStopAfterDays(db,tenantId,date){
  const rule=unpaidLeaveRule(db,tenantId,date);
  return rule&&Number.isInteger(rule.threshold_days)?rule.threshold_days:null;
}

// ── 2) أساس الأجر وسقف الغرامات (م51، م116) ────────────────────────────────────
// قرار واحد: ما بنود الأجر التي تُقاس عليها السقوف، وكم يومًا في الشهر في القسمة، وكم يوم أجر سقف الغرامات الشهري.
// موضعه سياسة سقوف الاستقطاع (kind='deductions')، وجدول الجزاءات يبقى مقروءًا ما لم تُقبل تلك السياسة بعد.
export const CAP_BASIS_ARTICLES=['م51','م116'];
export const DEFAULT_CAP_BASIS={monthly_fine_cap_days:5,fine_cap_days_per_violation:5,day_basis_days:30,wage_components:PAY_COMPONENT_KEYS};

const components=list=>Array.isArray(list)&&list.length&&list.every(c=>PAY_COMPONENT_KEYS.includes(c))?[...new Set(list)]:null;

export function capBasis(db,tenantId,date=riyadhToday()){
  const deductions=acceptedRegulationParameters(db,tenantId,'deductions',date),schedule=acceptedScheduleParameters(db,tenantId,date);
  const d=deductions?.parameters??null,sp=schedule?.parameters??null;
  // بنود الأجر: ما في سياسة الاستقطاع، وإلا ما في جدول الجزاءات، وإلا بنود العقد كلها كما كان قبل التوحيد.
  const deductionComponents=components(d?.wage_components),scheduleComponents=components(sp?.wage_components);
  const wageComponents=deductionComponents??scheduleComponents??DEFAULT_CAP_BASIS.wage_components;
  const wageSource=deductionComponents?'deductions_policy':scheduleComponents?'discipline_schedule':'default';
  const dayBasis=Number.isInteger(d?.day_basis_days)?d.day_basis_days:Number.isInteger(sp?.day_basis_days)?sp.day_basis_days:DEFAULT_CAP_BASIS.day_basis_days;
  const dayBasisSource=Number.isInteger(d?.day_basis_days)?'deductions_policy':Number.isInteger(sp?.day_basis_days)?'discipline_schedule':'default';
  const capDays=Number.isInteger(d?.fines_cap_days)?d.fines_cap_days:Number.isInteger(sp?.monthly_fine_cap_days)?sp.monthly_fine_cap_days:DEFAULT_CAP_BASIS.monthly_fine_cap_days;
  const capSource=Number.isInteger(d?.fines_cap_days)?'deductions_policy':Number.isInteger(sp?.monthly_fine_cap_days)?'discipline_schedule':'default';
  const mismatch=[];
  if(deductionComponents&&scheduleComponents&&deductionComponents.slice().sort().join()!==scheduleComponents.slice().sort().join())
    mismatch.push(`بنود الأجر اليومي: ${scheduleComponents.map(c=>PAY_COMPONENT_NAMES[c]).join('، ')} في جدول الجزاءات، و${deductionComponents.map(c=>PAY_COMPONENT_NAMES[c]).join('، ')} في سياسة سقوف الاستقطاع. المعتمد ما في سياسة سقوف الاستقطاع.`);
  if(Number.isInteger(d?.day_basis_days)&&Number.isInteger(sp?.day_basis_days)&&d.day_basis_days!==sp.day_basis_days)
    mismatch.push(`أيام الشهر في قسمة الأجر اليومي: ${sp.day_basis_days} في جدول الجزاءات و${d.day_basis_days} في سياسة سقوف الاستقطاع. المعتمد ما في سياسة سقوف الاستقطاع.`);
  if(Number.isInteger(d?.fines_cap_days)&&Number.isInteger(sp?.monthly_fine_cap_days)&&d.fines_cap_days!==sp.monthly_fine_cap_days)
    mismatch.push(`سقف الغرامات الشهري (م116): أجر ${sp.monthly_fine_cap_days} أيام في جدول الجزاءات وأجر ${d.fines_cap_days} أيام في سياسة سقوف الاستقطاع. المعتمد ما في سياسة سقوف الاستقطاع.`);
  return {wage_components:wageComponents,wage_components_source:wageSource,
    day_basis_days:dayBasis,day_basis_source:dayBasisSource,
    monthly_fine_cap_days:capDays,monthly_fine_cap_source:capSource,
    // سقف الغرامة للمخالفة الواحدة يبقى في جدول الجزاءات وحده: قيد على ما يختاره صاحب الصلاحية، لا على ما يُقتطع في الشهر.
    fine_cap_days_per_violation:Number.isInteger(sp?.fine_cap_days_per_violation)?sp.fine_cap_days_per_violation:DEFAULT_CAP_BASIS.fine_cap_days_per_violation,
    deductions_policy_id:deductions?.id??null,schedule_id:schedule?.id??null,articles:CAP_BASIS_ARTICLES,mismatch};
}

const activeContract=(db,tenantId,userId,date)=>db.prepare("SELECT pay_lines,monthly_total_minor FROM employment_contracts WHERE user_id=? AND tenant_id=? AND status IN ('active','ended') AND start_date<=? AND COALESCE(ended_on,end_date,'9999-12-31')>=? ORDER BY start_date DESC LIMIT 1").get(userId,tenantId,date,date)
  ??db.prepare("SELECT pay_lines,monthly_total_minor FROM employment_contracts WHERE user_id=? AND tenant_id=? AND status='active' ORDER BY start_date DESC LIMIT 1").get(userId,tenantId)??null;

// أجر الشهر الذي تُقاس عليه سقوف م51 وم116: بنود العقد الداخلة في الأساس المقرر. null إن لا عقد.
export function capWageMinor(db,tenantId,userId,basis,date=riyadhToday()){
  const contract=activeContract(db,tenantId,userId,date);
  if(!contract)return null;
  const lines=json(contract.pay_lines);
  if(!Array.isArray(lines))return contract.monthly_total_minor??null;
  return lines.filter(l=>basis.wage_components.includes(l.component)).reduce((n,l)=>n+l.amount_minor,0);
}
export const dailyWageMinor=(monthlyMinor,basis)=>halfUp(monthlyMinor,basis.day_basis_days);
// سقف الغرامات في الشهر بالهللة، بالأساس نفسه الذي يُحسب به مبلغ الغرامة.
export const monthlyFineCapMinor=(monthlyMinor,basis)=>Math.floor(monthlyMinor*basis.monthly_fine_cap_days/basis.day_basis_days);
