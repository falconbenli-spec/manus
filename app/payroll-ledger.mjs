// محاسبة الرواتب (الحزمة 4، P4-HR-3): كيف يصل ريال المسير إلى الدفتر — في تاريخه، وعلى مركز تكلفة إدارته، وعلى التزامه الصحيح.
//
// ما في هذه الوحدة:
//   * مركز تكلفة كل إدارة (department_cost_centres، الترحيل 174): يسجّله حامل تفويض الإعداد المالي ويقرره شخص ثانٍ يحمل تفويض الاعتماد.
//   * سطور قيد المسير (payrollRunEntry): يقرؤها نوع «مسير رواتب معتمد» في app/ledger.mjs. مصروف الرواتب لكل مركز إدارة، والحسومات كلٌّ إلى
//     غرضه (D4) لا مخصومةً من المصروف، والصافي إلى «رواتب مستحقة الدفع». التاريخ آخر يوم من شهر المسير.
//   * نوع «صرف سلفة موظف» في سجل المستندات المصدر، وتسجيل الصرف نفسه (recordAdvanceDisbursement).
//
// لماذا وحدة مستقلة لا جزءًا من app/ledger.mjs: الدفتر يستورد هذه الوحدة لبناء قيد المسير، والرواتب تستوردها لتسأل «هل ترحّل قيد المسير؟»
// قبل اعتماد التحويل (D5). لو كانت في الدفتر لاستوردت الرواتبُ الدفترَ، والدفتر يصل إلى الرواتب عبر المدفوعات والمشتريات فتنغلق دورة.
// هذه الوحدة لا تستورد الدفتر: تسجّل أنواعها في app/ledger-sources.mjs كما تفعل المدفوعات والبنك والإقفال.
import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { holds } from './access.mjs';
import { financeCapabilities } from './finance.mjs';
import { registerSourceKind, registerSourceLink } from './ledger-sources.mjs';
import { orgOn } from './employees.mjs';
import { personName } from './people-read.mjs';
import { riyadhDateOf, riyadhToday } from './riyadh-time.mjs';

const M='payroll-ledger';
const id=()=>randomUUID();
export const monthEnd=month=>{const [y,m]=month.split('-').map(Number);return `${month}-${String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')}`;};
const FINANCE_CONFIGURE={owner:'المالية — من يحمل تفويض الإعداد المالي',owner_role:'finance'};
const writing=db=>{if(!db.isTransaction)fail(500,'transaction_required','كتابة محاسبة الرواتب تبي معاملة قاعدة بيانات');};

/* ───── الحسومات: كل سند إلى غرضه (D4) ───── */
// كان القيد يطرح «الخصومات الأخرى» من مصروف الرواتب، فدين المحكمة وغرامة العامل وقسط القرض تختفي في المصروف ولا يظهر التزام بها.
// الآن: الأجر غير المستحق أصلًا (أثر إجازة بلا أجر) وتصحيح مسير سابق صُرف بالزيادة (الأثر الرجعي) يُنقصان المصروف لأنهما ليسا مصروفًا
// أصلًا؛ وما سواهما يذهب إلى التزامه أو أصله:
//   حكم قضائي (م51/6)         ← garnishment_payable: المحسوم لصاحب الحكم حتى يُورَّد له.
//   غرامة (م51/5، سقفها م116) ← employee_fines_payable: م123 من اللائحة بنصها «تقيد الغرامات الموقعة على العمال في سجل خاص؛ وفق أحكام
//                                 (المادة الثالثة والسبعون من) نظام العمل ويكون، التصرف فيها بما يعود بالنفع على العمال من قبل اللجنة
//                                 العمالية في المنشأة؛ وفي حالة عدم وجود لجنة عمالية يكون التصرف في الغرامات بموافقة وزارة الموارد البشرية
//                                 والتنمية الاجتماعية.» — فهي ليست إيرادًا للشركة بل التزامٌ لما ينفع العمال.
//   قرض صاحب العمل (م51/1)   ← employee_advances: يسترد أصلًا في ذمة الموظف كما تسترده أقساط السلفة.
//   اشتراك تأمينات (م51/2)   ← social_insurance_payable.
//   وما سوى ذلك (موافقة العامل، ما أتلفه، صندوق الادخار، أقساط السكن، وما سبق اشتراط السند) ← payroll_deductions_clearing: محسومٌ من
//   أجر العامل ما عُيِّن حسابه بعد؛ يبقى رصيدًا ظاهرًا حتى توجّهه المالية بقيد، لا يذوب في المصروف.
export const DEDUCTION_PURPOSES=Object.freeze({employer_loan:'employee_advances',court_order:'garnishment_payable',fine:'employee_fines_payable',social_insurance:'social_insurance_payable'});
export const CLEARING_PURPOSE='payroll_deductions_clearing';
const CREDIT_ORDER=['social_insurance_payable','employee_advances','garnishment_payable','employee_fines_payable',CLEARING_PURPOSE];
const CREDIT_MEMOS={social_insurance_payable:'حصتا الموظفين والمنشأة في التأمينات واشتراكات محسومة (م51/2)',employee_advances:'أقساط سلف وقروض مستردة من الرواتب (م51/1)',
  garnishment_payable:'محسوم بأحكام قضائية لأصحابها (م51/6)',employee_fines_payable:'غرامات محسومة تُقيَّد في سجل خاص (م123)',[CLEARING_PURPOSE]:'حسومات بموافقة العامل أو حالات أخرى تنتظر توجيهها'};
// أين يذهب خصمٌ واحد: 'expense' (يُنقص المصروف) أو غرضه.
function deductionTarget(db,adjustmentId,retro){
  if(retro.has(adjustmentId))return 'expense';
  const b=db.prepare('SELECT basis,exception_case FROM payroll_deduction_basis WHERE adjustment_id=?').get(adjustmentId);
  if(b?.basis==='not_a_deduction')return 'expense';
  if(b?.basis==='exception'&&DEDUCTION_PURPOSES[b.exception_case])return DEDUCTION_PURPOSES[b.exception_case];
  return CLEARING_PURPOSE;
}
// حسومات سطرٍ واحد مصنّفة: {expense, [غرض]: مبلغ}. ما في عمود الخصومات ولا يقابله بند في adjustments (سطور قديمة) يذهب إلى الحساب المعلّق.
function lineDeductions(db,line,retro){
  const out={expense:0};let classified=0;
  for(const a of JSON.parse(line.adjustments??'[]').filter(a=>a.kind==='deduction')){
    const target=deductionTarget(db,a.id,retro);out[target]=(out[target]??0)+a.amount_minor;classified+=a.amount_minor;
  }
  const rest=line.other_deductions_minor-classified;
  if(rest>0)out[CLEARING_PURPOSE]=(out[CLEARING_PURPOSE]??0)+rest;
  return out;
}
const retroIds=(db,tenantId)=>new Set(db.prepare('SELECT adjustment_id FROM payroll_retro WHERE tenant_id=?').all(tenantId).map(r=>r.adjustment_id));
// ما يسترده المسير من «سلف الموظفين»: أقساط السلف وحسم قرض صاحب العمل. يقرؤه الأستاذ المساعد للسلف (app/ledger.mjs).
export function runAdvanceRecovery(db,tenantId,runId){
  const retro=retroIds(db,tenantId);
  return db.prepare('SELECT * FROM payroll_lines WHERE run_id=?').all(runId).reduce((n,l)=>n+l.advance_minor+(lineDeductions(db,l,retro).employee_advances??0),0);
}

/* ───── مركز تكلفة الإدارة ───── */
// المركز المعتمد الساري للإدارة في تاريخ: أحدث صف معتمد سريانه لا يتجاوز التاريخ.
export function departmentCentreOn(db,tenantId,departmentId,date){
  if(!departmentId)return null;
  return db.prepare("SELECT d.*,c.code,c.name AS centre_name FROM department_cost_centres d JOIN finance_cost_centers c ON c.id=d.cost_center_id WHERE d.tenant_id=? AND d.department_id=? AND d.status='approved' AND d.effective_from<=? ORDER BY d.effective_from DESC,d.decided_at DESC LIMIT 1").get(tenantId,departmentId,date)??null;
}
const departmentName=(db,tenantId,departmentId)=>db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(departmentId,tenantId)?.name??departmentId;

/* ───── مرجع المسير في الدفتر ───── */
// PAY-الشهر؛ والمسير المصحَّح بعد عكسٍ يحمل ترتيبه بين مسيرات شهره النهائية (PAY-2026-06-2)، فلا يتشابه مستندان في «بانتظار الترحيل»
// ولا في التتبّع. شهرٌ بمسير واحد يبقى مرجعه كما كان.
export function runReference(db,run){
  const r=run.tenant_id&&run.approved_at!==undefined?run:db.prepare('SELECT id,tenant_id,month,approved_at FROM payroll_runs WHERE id=?').get(run.id);
  const before=db.prepare("SELECT COUNT(*) AS n FROM payroll_runs WHERE tenant_id=? AND month=? AND status IN ('approved','reversed') AND id<>? AND (approved_at<? OR (approved_at=? AND id<?))").get(r.tenant_id,r.month,r.id,r.approved_at,r.approved_at,r.id).n;
  return before?`PAY-${r.month}-${before+1}`:`PAY-${r.month}`;
}

/* ───── قيد المسير ───── */
// سطور قيد مسير معتمد: مصروف الرواتب وحصة المنشأة في التأمينات لكل مركز إدارة (إدارة الموظف في آخر يوم من الشهر، D3)، والالتزامات
// بإجماليها، والصافي. إجماليات بالمراكز لا راتب فرد؛ والمذكرات لا تسمّي أحدًا.
export function payrollRunEntry(db,tenantId,run){
  const date=monthEnd(run.month),retro=retroIds(db,tenantId);
  const lines=db.prepare('SELECT * FROM payroll_lines WHERE run_id=? ORDER BY user_id').all(run.id);
  const centres=new Map(),missing=new Map(),credit=Object.fromEntries(CREDIT_ORDER.map(k=>[k,0]));let net=0;
  for(const l of lines){
    const department=orgOn(db,l.user_id,date,{tenantId})?.department_id??null,centre=departmentCentreOn(db,tenantId,department,date);
    if(!centre){const key=department??'';missing.set(key,(missing.get(key)??0)+1);continue;}
    const d=lineDeductions(db,l,retro);
    for(const key of CREDIT_ORDER)if(key!=='social_insurance_payable')credit[key]+=d[key]??0;
    credit.employee_advances+=l.advance_minor;
    credit.social_insurance_payable+=l.social_insurance_minor+l.employer_insurance_minor+(d.social_insurance_payable??0);
    const g=centres.get(centre.cost_center_id)??{id:centre.cost_center_id,code:centre.code,expense:0,employer:0};
    g.expense+=l.gross_minor+l.additions_minor-l.unpaid_absence_minor-d.expense;g.employer+=l.employer_insurance_minor;
    centres.set(centre.cost_center_id,g);net+=l.net_minor;
  }
  if(missing.size)refuse(409,'department_cost_centre_missing',{what:`قيد مسير ${run.month} ما يتجهز: ${[...missing.keys()].map(k=>k?`«${departmentName(db,tenantId,k)}»`:'موظف ما تُعرف إدارته').join('، ')} ما لها مركز تكلفة معتمد سارٍ في ${date}`,
    missing:[...missing.entries()].map(([k,n])=>({document:k?`مركز تكلفة لإدارة «${departmentName(db,tenantId,k)}» سارٍ في ${date}، يسجّله واحد ويعتمده ثانٍ`:'إدارة الموظف في آخر الشهر في سجله الوظيفي',
      why:`رواتب ${n} موظف تنقيد على مركز إدارتهم في آخر يوم من الشهر، لا على مركز واحد للجميع ولا على مركز يُخمَّن`,...FINANCE_CONFIGURE})),
    next:'سجّل مركز الإدارة من «القوائم المالية والترحيل» ← «مراكز تكلفة الإدارات»، ويعتمده زميل يحمل تفويض الاعتماد، وبعدها جهّز القيد',link:'#statements'});
  const groups=[...centres.values()].sort((a,b)=>a.code.localeCompare(b.code));
  const out=[...groups.map(g=>({purpose:'salaries_expense',cost_center_id:g.id,debit_minor:g.expense,credit_minor:0,memo:`رواتب الشهر لمركز ${g.code} بعد الغياب والإجازات غير المدفوعة`})),
    ...groups.map(g=>({purpose:'social_insurance_employer_expense',cost_center_id:g.id,debit_minor:g.employer,credit_minor:0,memo:`حصة المنشأة في التأمينات لمركز ${g.code}`})),
    ...CREDIT_ORDER.map(k=>({purpose:k,debit_minor:0,credit_minor:credit[k],memo:CREDIT_MEMOS[k]})),
    {purpose:'salaries_payable',debit_minor:0,credit_minor:net,memo:'صافي مستحق الدفع للموظفين'}].filter(l=>l.debit_minor>0||l.credit_minor>0);
  return {date,reference:runReference(db,run),description:`مسير رواتب ${run.month} المعتمد (${run.headcount} موظف)`,lines:out};
}
// قيد المسير في الدفتر وحالته: يسأله اعتماد التحويل (D5) قبل أن يعتمد.
export function runJournal(db,tenantId,runId){
  return db.prepare("SELECT j.id,j.status,j.entry_date FROM finance_source_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.source_kind='payroll_run' AND l.source_id=? AND l.tenant_id=?").get(runId,tenantId)??null;
}
// D5: لا يُعتمد تحويل رواتب قبل أن يكون التزامها مرحّلًا في الدفتر. يُرجع null حين يُسمح، ونص الرفض حين لا.
export function journalBeforeTransfer(db,tenantId,run){
  const j=runJournal(db,tenantId,run.id);
  if(j?.status==='posted')return null;
  return {what:`تحويل رواتب ${run.month} ما ينعتمد: قيد المسير ${j?`حالته «${{draft:'مسودة',pending:'بانتظار الاعتماد',approved:'معتمد ما انرحّل',rejected:'مرفوض',reversed:'منعكس'}[j.status]??j.status}»`:'ما تجهّز للحين'} في الدفتر`,
    missing:[{document:`قيد مسير ${run.month} مرحّلًا في الدفتر`,why:'التحويل يسدّد التزامًا؛ والالتزام ما يكون في الدفتر قبل ما يترحّل قيد المسير، فيطلع المدفوع بلا مقابل',owner:'المالية — من يحمل تفويض إعداد القيود ثم اعتمادها وترحيلها',owner_role:'finance'}],
    next:'جهّز قيد المسير من «القوائم المالية والترحيل» ويعتمده ويرحّله غيرك، وبعدها اعتمد التحويل',link:'#statements'};
}

/* ───── تسجيل مركز الإدارة وقراره ───── */
const FINANCE_ACTIONS={configure:'الإعداد المالي',approve:'الاعتماد المالي',read:'القراءة المالية'};
function financeActor(db,supplied,action){
  const u=actorOrRefuse(db,supplied);
  u.permissions=financeCapabilities(db,u);
  if(!u.permissions.includes(action))refuse(403,'ledger_access_denied',{what:`مراكز تكلفة الإدارات تبي تفويض «${FINANCE_ACTIONS[action]}» في الدفتر المالي، وحسابك ما يحمله`,
    missing:[{document:`تفويض «${FINANCE_ACTIONS[action]}» ساري في الدفتر المالي`,why:'مركز الإدارة يقرر على أي مركز تنقيد رواتبها، فيسجّله من يُعدّ الإعداد المالي ويعتمده غيره',owner:'مسؤول التفويضات المالية',owner_role:'finance'}],
    next:'اطلب التفويض من مسؤول التفويضات المالية'});
  return u;
}
const centreRow=(db,tenantId,rowId)=>typeof rowId==='string'?db.prepare('SELECT * FROM department_cost_centres WHERE id=? AND tenant_id=?').get(rowId,tenantId)??null:null;
export function recordDepartmentCentre(db,supplied,input){
  writing(db);
  const u=financeActor(db,supplied,'configure');
  v.object(input,['department_id','cost_center_id','effective_from','reason']);
  const department=typeof input.department_id==='string'?db.prepare('SELECT id,name FROM departments WHERE id=? AND tenant_id=? AND active=1').get(input.department_id,u.tenant_id):null;
  if(!department)refuse(404,'department_not_found',{what:'الإدارة المختارة مو من إدارات كيانك النشطة',next:'اختر الإدارة من القائمة كما تظهر في الهيكل'});
  const centre=typeof input.cost_center_id==='string'?db.prepare('SELECT id,code FROM finance_cost_centers WHERE id=? AND tenant_id=? AND active=1').get(input.cost_center_id,u.tenant_id):null;
  if(!centre)refuse(404,'cost_centre_not_found',{what:'مركز التكلفة المختار مو من مراكز الدفتر النشطة في كيانك',next:'أنشئ المركز في «الدفتر المالي» ← مراكز التكلفة، أو اختر مركزًا نشطًا'});
  const effective=v.date(input.effective_from),reason=v.text(input.reason,'سبب الربط وسنده',2000,10);
  const pending=db.prepare("SELECT id,recorded_by FROM department_cost_centres WHERE tenant_id=? AND department_id=? AND status='pending'").get(u.tenant_id,department.id);
  if(pending)refuse(409,'department_centre_pending',{what:`لإدارة «${department.name}» ربطٌ مسجّل ينتظر قرار زميل`,
    missing:[{document:'قرار على الربط المنتظر: اعتماد أو رفض',why:'ربطان منتظران لإدارة واحدة يتركان المعتمد بين قرارين متعارضين',owner:'المالية — من يحمل تفويض الاعتماد',owner_role:'finance'}],
    next:'ينحسم الربط المنتظر أولًا، وبعدها سجّل الجديد'});
  const rowId=id(),time=now();
  db.prepare("INSERT INTO department_cost_centres(id,tenant_id,department_id,cost_center_id,effective_from,reason,status,recorded_by,created_at) VALUES(?,?,?,?,?,?,'pending',?,?)")
    .run(rowId,u.tenant_id,department.id,centre.id,effective,reason,u.id,time);
  audit(db,u,'department_cost_centre',rowId,'department_centre.recorded',{},{department_id:department.id,cost_center:centre.code,effective_from:effective},reason);
  return {id:rowId};
}
export function decideDepartmentCentre(db,supplied,rowId,decision,input){
  writing(db);
  const u=financeActor(db,supplied,'approve');
  v.object(input,['note']);
  if(!['approve','reject'].includes(decision))refuse(404,'action_unavailable',{what:'القرار على مركز الإدارة اعتماد أو رفض وبس',next:'اختر اعتماد أو رفض'});
  const row=centreRow(db,u.tenant_id,rowId);
  if(!row||row.status!=='pending')refuse(404,'department_centre_not_pending',{what:'ما فيه ربط مركز إدارة بهذا المعرّف ينتظر قرارًا في كيانك',next:'حدّث الشاشة؛ يمكن انحسم من زميل'});
  if(row.recorded_by===u.id)refuse(403,'self_approval',{what:'اللي سجّل ربط مركز الإدارة ما يقرره',
    missing:[{document:'قرار زميل ثانٍ يحمل تفويض الاعتماد المالي',why:'مركز الإدارة يوزّع تكلفة رواتبها في الدفتر، فلا يقرره من سجّله',owner:'المالية — من يحمل تفويض الاعتماد',owner_role:'finance'}],
    next:'اتركه لزميل يحمل تفويض الاعتماد؛ يظهر عنده في «بانتظار قراري»'});
  const status=decision==='approve'?'approved':'rejected',note=v.text(input.note,decision==='approve'?'أساس الاعتماد':'سبب الرفض',2000,decision==='approve'?3:10),time=now();
  db.prepare('UPDATE department_cost_centres SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,time,note,row.id);
  audit(db,u,'department_cost_centre',row.id,`department_centre.${status}`,{status:'pending'},{status,department_id:row.department_id},note);
  return {id:row.id,status};
}
// ما تعرضه «القوائم المالية والترحيل»: لكل إدارة نشطة مركزها الساري اليوم، وما ينتظر القرار بأفعاله لصاحب الشاشة.
export function departmentCentresView(db,u,{permissions=financeCapabilities(db,u)}={}){
  const today=riyadhToday();
  const rows=db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id).map(d=>{
    const live=departmentCentreOn(db,u.tenant_id,d.id,today);
    return {department_id:d.id,department_name:d.name,active:live?{id:live.id,cost_center_id:live.cost_center_id,code:live.code,centre_name:live.centre_name,effective_from:live.effective_from}:null};
  });
  const pending=db.prepare("SELECT d.*,c.code,c.name AS centre_name,x.name AS department_name FROM department_cost_centres d JOIN finance_cost_centers c ON c.id=d.cost_center_id JOIN departments x ON x.id=d.department_id WHERE d.tenant_id=? AND d.status='pending' ORDER BY d.created_at").all(u.tenant_id)
    .map(r=>({id:r.id,department_id:r.department_id,department_name:r.department_name,code:r.code,centre_name:r.centre_name,effective_from:r.effective_from,reason:r.reason,
      recorded_by:r.recorded_by,recorded_by_name:personName(db,r.recorded_by),created_at:r.created_at,
      actions:permissions.includes('approve')&&r.recorded_by!==u.id?['approve_department_centre','reject_department_centre']:[]}));
  return {rows,pending,can_record:permissions.includes('configure'),
    rule:'رواتب كل موظف تنقيد على مركز إدارته في آخر يوم من شهر المسير. الإدارة بلا مركز معتمد سارٍ يوقف قيد المسير باسمها.'};
}

/* ───── صرف السلفة ───── */
const PAYROLL_CAPS=['payroll.prepare','payroll.review','payroll.approve'];
function payrollStaff(db,supplied){
  const u=actorOrRefuse(db,supplied);
  u.caps=PAYROLL_CAPS.filter(key=>holds(db,u,key));
  return u;
}
const advanceRow=(db,tenantId,advanceId)=>typeof advanceId==='string'?db.prepare('SELECT * FROM salary_advances WHERE id=? AND tenant_id=?').get(advanceId,tenantId)??null:null;
// هل يسجّل هذا الشخص صرف هذه السلفة؟ مثل تنفيذ تحويل المسير: حامل المراجعة أو الاعتماد، وغير صاحبها ومقترحها ومعتمدها.
export const canRecordDisbursement=(u,a)=>a.status==='approved'&&!a.disbursed_on&&(u.caps.includes('payroll.review')||u.caps.includes('payroll.approve'))&&![a.user_id,a.proposed_by,a.decided_by].includes(u.id);
export function recordAdvanceDisbursement(db,supplied,advanceId,input){
  writing(db);
  const u=payrollStaff(db,supplied);
  v.object(input,['disbursed_on','reference','evidence']);
  const a=advanceRow(db,u.tenant_id,advanceId);
  if(!a||!u.caps.length)refuse(404,'advance_not_found',{what:'ما لقينا سلفة بهذا المعرّف في كيانك',next:'افتح «حركات الرواتب والتسويات» واختر السلفة من القائمة'});
  if(a.status!=='approved')refuse(409,'advance_not_approved',{what:'السلفة ما انعتمدت، فما يُسجَّل صرفها',
    missing:[{document:'اعتماد السلفة من حامل اعتماد الرواتب',why:'ما يُصرف إلا ما انعتمد وانعتمد جدول أقساطه',owner:'معتمد الرواتب',owner_role:'payroll.approve'}],next:'تُعتمد السلفة أولًا من «حركات الرواتب والتسويات»'});
  if(a.disbursed_on)refuse(409,'advance_disbursed',{what:`صرف هالسلفة مسجّل من قبل بتاريخ ${a.disbursed_on} ومرجع ${a.disbursement_reference}`,next:'الصرف يُسجَّل مرة وحدة؛ والخطأ فيه يُصحَّح بقيد يعكسه في الدفتر'});
  if(!u.caps.includes('payroll.review')&&!u.caps.includes('payroll.approve'))refuse(403,'not_permitted',{what:'تسجيل صرف السلفة لحامل مراجعة الرواتب أو اعتمادها',
    missing:[{document:'تصريح مراجعة الرواتب أو اعتمادها',why:'الصرف حركة مال يشهد عليها غير من أعدّ',owner:'مسؤول المنصة',owner_role:'admin'}],next:'يسجّله زميل يحمل التصريح'});
  if([a.user_id,a.proposed_by,a.decided_by].includes(u.id))refuse(409,'separation_of_duties',{what:'صرف السلفة يسجّله غير صاحبها وغير اللي اقترحها وغير اللي اعتمدها',
    missing:[{document:'تسجيل الصرف بيد زميل رابع يحمل مراجعة الرواتب أو اعتمادها',why:'من يقترح المال أو يعتمده أو يستلمه ما يشهد على خروجه من البنك',owner:'مراجع الرواتب',owner_role:'payroll.review'}],
    next:'اتركه لمراجع الرواتب أو معتمد ثانٍ'});
  const on=v.date(input.disbursed_on),approvedOn=riyadhDateOf(a.decided_at),today=riyadhToday();
  if(on<approvedOn||on>today)refuse(400,'disbursed_on',{what:`تاريخ الصرف ${on} بين يوم اعتماد السلفة (${approvedOn}) واليوم (${today})`,next:'اكتب يوم خروج المبلغ من البنك كما في كشفه'});
  const reference=v.text(input.reference,'المرجع البنكي للصرف',120,3).toUpperCase(),evidence=v.text(input.evidence,'دليل الصرف: إشعار التحويل أو سطر الكشف',2000,10),time=now();
  if(db.prepare('UPDATE salary_advances SET disbursed_on=?,disbursement_reference=?,disbursement_evidence=?,disbursed_by=?,disbursement_recorded_at=? WHERE id=? AND disbursed_on IS NULL')
    .run(on,reference,evidence,u.id,time,a.id).changes!==1)refuse(409,'stale_version',{what:'انسجّل صرف السلفة من زميل أثناء حفظك',next:'حدّث الشاشة'});
  audit(db,u,'salary_advance',a.id,'advance.disbursed',{disbursed:false},{disbursed_on:on,amount_minor:a.amount_minor},evidence);
  return {id:a.id,disbursed_on:on,disbursement_reference:reference};
}

/* ───── نوع «صرف سلفة موظف» في الدفتر ───── */
// مدين سلف الموظفين، دائن البنك، بتاريخ الصرف. والأقساط تُخفّض الأصل نفسه من قيد كل مسير (app/ledger.mjs)، فيلتقي الاثنان في الأستاذ
// المساعد للسلف: ما صُرف ناقص ما استُرد. صاحب السلفة لا يُسمّى في المستند ولا في التتبّع؛ المبلغ ومعتمدوه يكفون لتتبّع المال.
const disbursed=(db,tenantId)=>db.prepare("SELECT id,amount_minor,disbursed_on,disbursement_reference FROM salary_advances WHERE tenant_id=? AND status='approved' AND disbursed_on IS NOT NULL").all(tenantId);
const at=(role,actor_id,time,note)=>actor_id?{role,actor_id,at:time??null,...(note?{note}:{})}:null;
registerSourceKind({key:'salary_advance',name:'صرف سلفة موظف',module:M,bank:'cash',
  build(db,u,advanceId){
    const a=advanceRow(db,u.tenant_id,advanceId);
    if(!a||a.status!=='approved'||!a.disbursed_on)return null;
    return {date:a.disbursed_on,reference:a.disbursement_reference,description:`صرف سلفة موظف ${a.disbursement_reference} — تُسترد على ${a.installments} قسط`,
      lines:[['employee_advances',a.amount_minor,0,'سلفة في ذمة الموظف تُسترد من رواتبه'],['bank',0,a.amount_minor,'المبلغ المصروف من البنك']]};
  },
  pending:(db,tenantId)=>disbursed(db,tenantId).map(a=>({source_id:a.id,reference:a.disbursement_reference,amount_minor:a.amount_minor,date:a.disbursed_on})),
  controls:{employee_advances:(db,tenantId)=>disbursed(db,tenantId).map(a=>({source_id:a.id,reference:a.disbursement_reference,date:a.disbursed_on,amount_minor:a.amount_minor}))},
  document:(db,tenantId,advanceId)=>{const a=advanceRow(db,tenantId,advanceId);return a&&{reference:a.disbursement_reference??'سلفة ما انصرفت للحين',date:a.disbursed_on??riyadhDateOf(a.created_at),amount_minor:a.amount_minor,
    status:a.disbursed_on?'disbursed':a.status,description:`سلفة موظف على ${a.installments} قسط من ${a.first_month}`};},
  approvals:(db,tenantId,advanceId)=>{const a=advanceRow(db,tenantId,advanceId);return a?[at('اقترح السلفة',a.proposed_by,a.created_at),at('اعتمدها',a.decided_by,a.decided_at,a.decision_note),at('سجّل صرفها',a.disbursed_by,a.disbursement_recorded_at)].filter(Boolean):[];}});
// السلفة تُسوّى بمسيرات استردت أقساطها: كل مسير معتمد فيه قسط منها.
registerSourceLink({from:'salary_advance',role:'settlement',module:M,list:(db,tenantId,advanceId)=>db.prepare("SELECT DISTINCT r.id,r.tenant_id,r.month,r.approved_at,r.status,x.amount_minor FROM payroll_adjustments x JOIN payroll_runs r ON r.id=x.run_id WHERE x.advance_id=? AND x.tenant_id=? AND r.status='approved' ORDER BY r.month").all(advanceId,tenantId)
  .map(r=>({kind:'payroll_run',id:r.id,reference:runReference(db,r),date:monthEnd(r.month),amount_minor:r.amount_minor,status:r.status}))});

/* ───── نوع «عكس مسير رواتب معتمد» في الدفتر (P4-HR-4، الترحيل 175) ───── */
// مستند العكس يعكس قيد المسير المرحّل بحرفه: كل سطر بحسابه ومركز تكلفته، مدينه دائن ودائنه مدين، وبتاريخ قيد المسير نفسه (آخر الشهر)،
// فيحمل الشهرُ تكلفته المصحَّحة لا الأصل والمصحَّح معًا. ولا يُبنى قبل أن يترحّل قيد المسير: ما يُعكس هو ما ترحّل لا ما سيُبنى.
// وأثره على الحسابين الرقابيين مقابل أثر المسير: ناقص الصافي من «رواتب مستحقة الدفع»، وزائد ما استرده من «سلف الموظفين».
const reversalRow=(db,tenantId,rowId)=>typeof rowId==='string'?db.prepare('SELECT * FROM payroll_run_reversals WHERE id=? AND tenant_id=?').get(rowId,tenantId)??null:null;
const approvedReversals=(db,tenantId)=>db.prepare("SELECT id,run_id,month,net_minor FROM payroll_run_reversals WHERE tenant_id=? AND status='approved'").all(tenantId);
// مرجع العكس من مرجع مسيره: REV-PAY-2026-06، وعكسُ مسيرٍ مصحَّح REV-PAY-2026-06-2.
const reversalReference=(db,x)=>`REV-${runReference(db,{id:x.run_id})}`;
registerSourceKind({key:'payroll_run_reversal',name:'عكس مسير رواتب معتمد',module:M,
  build(db,u,rowId){
    const x=reversalRow(db,u.tenant_id,rowId);
    if(!x||x.status!=='approved')return null;
    const j=runJournal(db,u.tenant_id,x.run_id);
    if(j?.status!=='posted')refuse(409,'run_journal_unposted',{what:`قيد عكس مسير ${x.month} ما يتجهز قبل ما يترحّل قيد المسير نفسه (${j?'قيده ما انرحّل':'ما له قيد للحين'})`,
      missing:[{document:`قيد مسير ${x.month} مرحّلًا`,why:'العكس يعكس اللي ترحّل بحرفه — حساباته ومراكز تكلفته — ولا يُبنى على قيد ما انرحّل',owner:'المالية — من يحمل تفويض إعداد القيود ثم اعتمادها وترحيلها',owner_role:'finance'}],
      next:'جهّز قيد المسير من «القوائم المالية والترحيل» ويعتمده ويرحّله غيرك، وبعدها جهّز قيد عكسه',link:'#statements'});
    const lines=db.prepare('SELECT account_id,cost_center_id,debit_minor,credit_minor,memo FROM finance_lines WHERE journal_id=? ORDER BY position').all(j.id);
    return {date:j.entry_date,reference:reversalReference(db,x),description:`عكس مسير رواتب ${x.month} المعتمد قبل صرفه`,
      lines:lines.map(l=>({account_id:l.account_id,cost_center_id:l.cost_center_id,debit_minor:l.credit_minor,credit_minor:l.debit_minor,memo:`عكس: ${l.memo}`.slice(0,300)}))};
  },
  pending:(db,tenantId)=>approvedReversals(db,tenantId).map(x=>({source_id:x.id,reference:reversalReference(db,x),amount_minor:x.net_minor,date:monthEnd(x.month)})),
  controls:{salaries_payable:(db,tenantId)=>approvedReversals(db,tenantId).map(x=>({source_id:x.id,reference:reversalReference(db,x),date:monthEnd(x.month),amount_minor:-x.net_minor})),
    employee_advances:(db,tenantId)=>approvedReversals(db,tenantId).map(x=>({source_id:x.id,reference:reversalReference(db,x),date:monthEnd(x.month),amount_minor:runAdvanceRecovery(db,tenantId,x.run_id)})).filter(d=>d.amount_minor)},
  document:(db,tenantId,rowId)=>{const x=reversalRow(db,tenantId,rowId);return x&&{reference:reversalReference(db,x),date:monthEnd(x.month),amount_minor:x.net_minor,status:x.status,description:`عكس مسير ${x.month}: ${x.reason}`.slice(0,300)};},
  approvals:(db,tenantId,rowId)=>{const x=reversalRow(db,tenantId,rowId);return x?[at('طلب العكس',x.requested_by,x.requested_at,x.reason),at(x.status==='rejected'?'رفضه':'اعتمده',x.decided_by,x.decided_at,x.decision_note)].filter(Boolean):[];}});
// المسير يُعكس بمستند العكس؛ والعكس يسوّي مسيره.
registerSourceLink({from:'payroll_run',role:'reversal',module:M,list:(db,tenantId,runId)=>db.prepare("SELECT id,run_id,month,net_minor,status FROM payroll_run_reversals WHERE run_id=? AND tenant_id=? AND status<>'rejected' ORDER BY requested_at").all(runId,tenantId)
  .map(x=>({kind:'payroll_run_reversal',id:x.id,reference:reversalReference(db,x),date:monthEnd(x.month),amount_minor:x.net_minor,status:x.status}))});
registerSourceLink({from:'payroll_run_reversal',role:'settles',module:M,list:(db,tenantId,rowId)=>{const x=reversalRow(db,tenantId,rowId);
  const r=x&&db.prepare('SELECT id,tenant_id,month,approved_at,net_minor,status FROM payroll_runs WHERE id=? AND tenant_id=?').get(x.run_id,tenantId);
  return r?[{kind:'payroll_run',id:r.id,reference:runReference(db,r),date:monthEnd(r.month),amount_minor:r.net_minor,status:r.status}]:[];}});
