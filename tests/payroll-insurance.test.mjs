import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { decideRule } from '../app/payroll-rules.mjs';
import { recordDemographics } from '../app/workforce.mjs';
import { getRun, prepareRun, runAction } from '../app/payroll.mjs';
import { insuranceBoard, recordOverride, withdrawOverride, caseOf, rateFor } from '../app/payroll-insurance.mjs';

// كل رقم متوقَّع هنا مشتق من الموجز القانوني بمصدره، لا من تشغيل الكود:
//   سعودي خاضع للنظام السابق  9.75% موظف / 11.75% منشأة  (9% معاشات + 0.75% ساند، ومعها 2% أخطار على المنشأة)
//   سعودي مشترك جديد          9.75% ثم 10.25% ثم 10.75% ثم 11.25% ثم 11.75% بحسب درجة 1 يوليو
//   غير سعودي                 صفر على الموظف و2% أخطار مهنية على المنشأة وحدها
//   الأجر الخاضع = الأساسي + السكن، بحد أدنى 1,500 (معاشات) و400 (أخطار وحدها) وحد أعلى 45,000
const code=value=>error=>error.code===value;
// النظام الجديد نفذ في 3 يوليو 2024؛ من باشر قبله خاضع للسابق ومن باشر بعده مشترك جديد ما لم يثبت خلافه.
const BEFORE_NEW_LAW='2023-05-01',AFTER_NEW_LAW='2025-02-01';

function fixture(t,{acceptInsurance=true,partial='thirty',insuranceFrom='2019-01-01'}={}){
  const db=openDb(':memory:');seed(db,'synthetic-insurance');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL),('reviewer','36t','hr','reviewer','مراجع الرواتب المصطنع','unused','employee','hr-manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const grant=(user_id,capability)=>transaction(db,()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح مصطنع لاختبار التأمينات'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve','payroll.approve'])grant('hr-manager',c);
  grant('reviewer','payroll.review');// hr.workforce.view أصلًا من افتراضيات دور الموارد البشرية
  const policy=(kind,parameters,title)=>{const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind,title,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2019-01-01',parameters}));
    transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار المحلي'}));return id;};
  policy('pay_components',{components:['basic','housing','transport']},'بنود الراتب');
  // سياسة دورة رواتب بلا نسبة تأمينات: المسودة الجديدة لم تعد تطلبها.
  policy('payroll_cycle',{pay_day:27,day_basis:'thirty',review_threshold_bp:9000},'دورة الرواتب');
  if(acceptInsurance)transaction(db,()=>decideRule(db,users['hr-manager'],'reg-seed-social-insurance','accept',
    {effective_from:insuranceFrom,choices:{partial_month_basis:partial},note:'طابقت النسب مع مصادر المؤسسة العامة للتأمينات قبل القبول (اختبار مصطنع)'}));
  const contract=(user_id,start,basic='8000.00',housing='2000.00')=>{
    const {id}=transaction(db,()=>prepareContract(db,users.hr,{user_id,contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:start,weekly_hours:40,probation_days:90,notice_days:60,
      pay_lines:[{component:'basic',amount:basic},{component:'housing',amount:housing}],document_reference:'عقد مصطنع'}));
    const step=(who,action)=>transaction(db,()=>contractAction(db,users[who],id,action,{version:getContract(db,users[who],id).version}));
    step('hr','submit_contract');step('hr-manager','approve_contract');return id;};
  const nationality=(user_id,group)=>transaction(db,()=>recordDemographics(db,users.hr,user_id,{version:0,nationality_group:group,gender:null,source:'صورة وثيقة مصطنعة في ملف الموظف'}));
  const prepare=month=>getRun(db,users.hr,transaction(db,()=>prepareRun(db,users.hr,{month})).id);
  const act=(who,run,action,values={})=>transaction(db,()=>runAction(db,users[who],run.id,action,{version:run.version,...values}));
  const line=(run,user_id)=>run.lines.find(l=>l.user_id===user_id);
  return {db,users,contract,nationality,prepare,act,line,grant};
}

test('every case in the law is deducted by its own rate: a Saudi under the previous law, a Saudi new entrant on the step in force, and a non-Saudi who pays nothing while the company still owes the hazards branch',t=>{
  const {db,users,contract,nationality,prepare,line}=fixture(t);
  contract('employee',BEFORE_NEW_LAW);nationality('employee','saudi');
  contract('outsider',AFTER_NEW_LAW);nationality('outsider','saudi');
  contract('manager',AFTER_NEW_LAW);nationality('manager','non_saudi');
  const run=prepare('2026-09');
  // الأجر الخاضع = 8,000 + 2,000 = 10,000 ريال (النقل خارجه).
  const wage=1000000;
  const previous=line(run,'employee'),entrant=line(run,'outsider'),expat=line(run,'manager');
  assert.equal(previous.basis.insurance.case,'saudi_previous_law');
  assert.equal(previous.social_insurance_minor,Math.round(wage*0.0975),'9.75% — 9% معاشات و0.75% ساند');
  assert.equal(previous.employer_insurance_minor,Math.round(wage*0.1175),'11.75% — ومعها 2% أخطار مهنية');
  assert.equal(entrant.basis.insurance.case,'saudi_new_entrant');
  assert.equal(entrant.basis.insurance.rate_from,'2026-07-01','الدرجة السارية في سبتمبر 2026 هي درجة 1 يوليو 2026');
  assert.equal(entrant.social_insurance_minor,Math.round(wage*0.1075),'10.75% — 10% معاشات و0.75% ساند');
  assert.equal(entrant.employer_insurance_minor,Math.round(wage*0.1275));
  assert.equal(expat.basis.insurance.case,'non_saudi');
  assert.equal(expat.social_insurance_minor,0,'لا يُخصم من غير السعودي شيء');
  assert.equal(expat.employer_insurance_minor,Math.round(wage*0.02),'2% أخطار مهنية على المنشأة وحدها');
  // حصة المنشأة تكلفة لا خصم: لا تدخل الصافي ولا استقطاعات المسير.
  assert.equal(expat.net_minor,expat.gross_minor,'حصة المنشأة لا تنقص صافي غير السعودي');
  assert.equal(previous.net_minor,previous.gross_minor-previous.social_insurance_minor);
  assert.equal(run.deductions_minor,previous.social_insurance_minor+entrant.social_insurance_minor);
  assert.equal(run.insurance.employer_total_minor,previous.employer_insurance_minor+entrant.employer_insurance_minor+expat.employer_insurance_minor);
  // كل ريال مفسَّر في السند: المادة والمصدر والأجر المستعمل والنسبة وتاريخ درجتها.
  assert.ok(previous.basis.insurance.source_url.startsWith('http'));
  assert.equal(previous.basis.insurance.contributory_wage_minor,wage);
  assert.ok(verifyAudit(db));
});

test('the contributory wage is clamped to the floor and the ceiling the law sets, and the rate is read from the payroll month so a step-up lands on the month it takes effect',t=>{
  const {db,users,contract,nationality,prepare,line}=fixture(t);
  // أجر دون الحد الأدنى لفرع المعاشات (1,500 ريال): يُرفع إليه.
  contract('employee',BEFORE_NEW_LAW,'700.00','300.00');nationality('employee','saudi');
  // أجر فوق الحد الأعلى (45,000 ريال): يُحصر عنده.
  contract('outsider',BEFORE_NEW_LAW,'50000.00','10000.00');nationality('outsider','saudi');
  // غير سعودي بأجر دون 400 ريال: حده الأدنى حد الأخطار المهنية لا حد المعاشات.
  contract('manager',AFTER_NEW_LAW,'200.00','100.00');nationality('manager','non_saudi');
  const run=prepare('2026-09'),low=line(run,'employee'),high=line(run,'outsider'),expat=line(run,'manager');
  assert.equal(low.basis.insurance.contributory_wage_minor,150000);
  assert.equal(low.basis.insurance.clamped,'floor');
  assert.equal(low.social_insurance_minor,Math.round(150000*0.0975));
  assert.equal(high.basis.insurance.contributory_wage_minor,4500000);
  assert.equal(high.basis.insurance.clamped,'ceiling');
  assert.equal(high.social_insurance_minor,Math.round(4500000*0.0975));
  assert.equal(expat.basis.insurance.contributory_wage_minor,40000,'حد الأخطار المهنية 400 ريال');
  assert.equal(expat.employer_insurance_minor,800);
  // التدرج بالشهر لا بتاريخ اليوم: يونيو 2026 على درجة 1 يوليو 2025، ويوليو 2026 على درجة 1 يوليو 2026.
  const rule=db.prepare("SELECT parameters FROM regulation_policies WHERE tenant_id='36t' AND kind='social_insurance'").get();
  const parameters=JSON.parse(rule.parameters);
  assert.equal(rateFor(parameters,'saudi_new_entrant','2026-06-30').employee_bp,1025);
  assert.equal(rateFor(parameters,'saudi_new_entrant','2026-07-31').employee_bp,1075);
  assert.equal(rateFor(parameters,'saudi_new_entrant','2028-07-31').employee_bp,1175,'الدرجة النهائية 11.75%');
  assert.equal(rateFor(parameters,'saudi_previous_law','2028-07-31').employee_bp,975,'الخاضع للنظام السابق لا يتدرج');
});

test('an employee with no recorded case is never guessed: the draft shows him as unavailable at zero and the run refuses to be submitted or approved, naming who is missing and who records it',t=>{
  const {db,users,contract,nationality,prepare,act,line}=fixture(t);
  contract('employee',BEFORE_NEW_LAW);nationality('employee','saudi');
  contract('outsider',AFTER_NEW_LAW);// بلا جنسية مسجلة
  const run=prepare('2026-09');
  const unknown=line(run,'outsider');
  assert.equal(unknown.basis.insurance.method,'unavailable');
  assert.equal(unknown.basis.insurance.blocked,'missing_fields');
  assert.equal(unknown.social_insurance_minor,0);
  assert.equal(unknown.employer_insurance_minor,0);
  assert.equal(run.insurance.missing.length,1);
  assert.equal(run.insurance.missing[0].name,users.outsider.name);
  // الرفض يسمّي الناقص ومالكه، ولا يقول «الإجراء غير متاح».
  let thrown=null;try{act('hr',run,'submit_run');}catch(error){thrown=error;}
  assert.equal(thrown?.code,'insurance_case_required');
  const refusal=thrown.details.refusal;
  assert.ok(refusal.missing.some(m=>m.document.includes(users.outsider.name)&&m.document.includes('الجنسية')));
  assert.ok(refusal.missing.some(m=>m.owner==='الموارد البشرية'));
  assert.ok(refusal.next.length>10);
  // وبعد تسجيل الجنسية يمضي المسير.
  nationality('outsider','saudi');
  const again=act('hr',getRun(db,users.hr,run.id),'recalculate');
  assert.equal(again.insurance.missing.length,0);
  assert.equal(again.lines.find(l=>l.user_id==='outsider').basis.insurance.case,'saudi_new_entrant');
  assert.ok(act('hr',getRun(db,users.hr,run.id),'submit_run'));
});

test('a Saudi who joined after the new law but already had a contribution period elsewhere is moved back to the previous law by a dated override, and withdrawing it restores the derived case',t=>{
  const {db,users,contract,nationality,prepare,line}=fixture(t);
  contract('employee',AFTER_NEW_LAW);nationality('employee','saudi');
  assert.equal(line(prepare('2026-09'),'employee').basis.insurance.case,'saudi_new_entrant','بلا استثناء تُشتق الحالة من تاريخ المباشرة وحده');
  const {id}=transaction(db,()=>recordOverride(db,users.hr,'employee','prior_contribution_period',
    {effective_from:'2025-02-01',basis:'شهادة مدد وأجور مصطنعة من صاحب عمل سابق، مؤرخة في يناير'}));
  const after=caseOf(db,'36t','employee','2026-09-30',JSON.parse(db.prepare("SELECT parameters FROM regulation_policies WHERE tenant_id='36t' AND kind='social_insurance'").get().parameters));
  assert.equal(after.case_key,'saudi_previous_law');
  assert.equal(after.override.kind,'prior_contribution_period');
  // الفرق ليس نظريًا: 9.75% بدل 10.75% على أجر 10,000 ريال هو 100 ريال شهريًا تُخصم بلا وجه حق.
  const board=insuranceBoard(db,users.hr),row=board.rows.find(r=>r.user_id==='employee');
  assert.equal(row.case_key,'saudi_previous_law');
  assert.equal(row.employee_bp,975);
  assert.ok(row.overrides[0].basis.includes('شهادة مدد وأجور'));
  // لا رقم هوية ولا رقم اشتراك في السند، ولا يسجل الموظف لنفسه.
  assert.throws(()=>transaction(db,()=>recordOverride(db,users.hr,'reviewer','prior_contribution_period',{effective_from:'2025-02-01',basis:'شهادة مدد وأجور رقمها 1023456789'})),code('reference_number'));
  assert.throws(()=>transaction(db,()=>recordOverride(db,users.hr,'hr','prior_contribution_period',{effective_from:'2025-02-01',basis:'شهادة مدد وأجور مصطنعة لنفسي'})),code('separation_of_duties'));
  assert.throws(()=>transaction(db,()=>recordOverride(db,users.hr,'employee','prior_contribution_period',{effective_from:'2025-02-01',basis:'شهادة مدد وأجور مصطنعة ثانية'})),code('override_exists'));
  // الصف لا يُعدَّل ولا يُحذف؛ الخطأ يُسحب بسبب مكتوب فتعود الحالة المشتقة.
  assert.throws(()=>db.prepare("UPDATE employee_insurance_overrides SET kind='gcc_national' WHERE id=?").run(id),/recorded once/);
  assert.throws(()=>db.prepare('DELETE FROM employee_insurance_overrides').run(),/retained/);
  transaction(db,()=>withdrawOverride(db,users.hr,id,{reason:'تبيّن أن الشهادة لموظف آخر يحمل الاسم نفسه'}));
  assert.equal(insuranceBoard(db,users.hr).rows.find(r=>r.user_id==='employee').case_key,'saudi_new_entrant');
  assert.ok(verifyAudit(db));
});

test('a Gulf national is excluded by the owner decision, so he has no applicable case and blocks approval like anyone else — he is never silently treated as Saudi or as non-Saudi',t=>{
  const {db,users,contract,nationality,prepare,act,line}=fixture(t);
  contract('employee',AFTER_NEW_LAW);nationality('employee','saudi');
  contract('outsider',AFTER_NEW_LAW);nationality('outsider','non_saudi');
  // حقل الجنسية قيمتان لا غير، فالخليجي يُسجَّل غير سعودي: بلا الاستثناء يُحتسب غير سعودي بلا خصم.
  const draft=prepare('2026-09');
  assert.equal(line(draft,'outsider').basis.insurance.case,'non_saudi');
  transaction(db,()=>recordOverride(db,users.hr,'outsider','gcc_national',{effective_from:'2025-02-01',basis:'جواز سفر خليجي مصطنع، نوع الوثيقة دون رقمها'}));
  const run=act('hr',draft,'recalculate');
  const gulf=run.lines.find(l=>l.user_id==='outsider');
  assert.equal(gulf.basis.insurance.method,'unavailable');
  assert.equal(gulf.basis.insurance.blocked,'gcc_national');
  assert.equal(gulf.social_insurance_minor,0);
  assert.equal(gulf.employer_insurance_minor,0);
  assert.throws(()=>act('hr',run,'submit_run'),code('insurance_case_required'));
  assert.ok(insuranceBoard(db,users.hr).gcc_note.includes('قرار المالك'));
});

test('the old single-rate cycle policy keeps governing the months it governed: a month before the insurance rule took effect reproduces its recorded line, and the run says which basis it used',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-insurance-legacy');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const grant=(user_id,capability)=>transaction(db,()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح مصطنع لاختبار التوافق'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve','payroll.approve'])grant('hr-manager',c);
  const policy=(kind,parameters,effective)=>{const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:effective,parameters}));
    transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار المحلي'}));return id;};
  policy('pay_components',{components:['basic','housing']},'2019-01-01');
  // السياسة القديمة بمفتاحيها كما اعتُمدت فعلًا: تبقى مقبولة ولا تُكسر.
  policy('payroll_cycle',{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:975,social_insurance_base:['basic','housing'],review_threshold_bp:9000},'2019-01-01');
  const {id}=transaction(db,()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:'2023-05-01',weekly_hours:40,probation_days:90,notice_days:60,
    pay_lines:[{component:'basic',amount:'8000.00'},{component:'housing',amount:'2000.00'}],document_reference:'عقد مصطنع'}));
  transaction(db,()=>contractAction(db,users.hr,id,'submit_contract',{version:getContract(db,users.hr,id).version}));
  transaction(db,()=>contractAction(db,users['hr-manager'],id,'approve_contract',{version:getContract(db,users['hr-manager'],id).version}));
  transaction(db,()=>recordDemographics(db,users.hr,'employee',{version:0,nationality_group:'saudi',gender:null,source:'صورة وثيقة مصطنعة في ملف الموظف'}));
  // قاعدة التأمينات تُقبل سارية من سبتمبر 2026 فقط: ما قبله لا تحكمه.
  transaction(db,()=>decideRule(db,users['hr-manager'],'reg-seed-social-insurance','accept',
    {effective_from:'2026-09-01',choices:{partial_month_basis:'thirty'},note:'طابقت النسب مع مصادر المؤسسة قبل القبول (اختبار مصطنع)'}));
  const august=getRun(db,users.hr,transaction(db,()=>prepareRun(db,users.hr,{month:'2026-08'})).id);
  const line=august.lines[0];
  assert.equal(line.basis.insurance.method,'flat_policy','شهر سبق سريان القاعدة يبقى على نسبة سياسة الدورة');
  assert.equal(line.social_insurance_minor,97500,'9.75% من 10,000 كما كانت تُحسب قبل هذا العمل بالضبط');
  assert.equal(line.employer_insurance_minor,0,'حصة المنشأة غير محتسبة قبل قبول القاعدة، ولا تُخترع بأثر رجعي');
  assert.equal(august.insurance.rule_accepted,false);
  const september=getRun(db,users.hr,transaction(db,()=>prepareRun(db,users.hr,{month:'2026-09'})).id);
  assert.equal(september.lines[0].basis.insurance.method,'per_case');
  assert.equal(september.lines[0].basis.insurance.case,'saudi_previous_law');
  assert.equal(september.lines[0].social_insurance_minor,97500,'النسبة نفسها في هذه الحالة، لكن مأخوذة من القاعدة لا من السياسة');
  assert.equal(september.lines[0].employer_insurance_minor,117500,'وحصة المنشأة صارت محتسبة');
  assert.equal(september.insurance.rule_accepted,true);
});

test('the insurance case reveals nationality, so it is read by the same rule: a manager without the workforce capability cannot open the screen, and no override is recorded without an HR role',t=>{
  const {db,users}=fixture(t);
  assert.throws(()=>insuranceBoard(db,users.manager),code('not_permitted'));
  assert.throws(()=>insuranceBoard(db,users.employee),code('not_permitted'));
  assert.ok(insuranceBoard(db,users.hr).rows.length,'موظف الموارد البشرية بتصريح القوى العاملة يراها');
  assert.ok(insuranceBoard(db,users['hr-manager']).rows.length,'وحامل تصريح اعتماد الرواتب يراها');
  assert.equal(insuranceBoard(db,users['hr-manager']).may_record,false,'القراءة لا تعني التسجيل: التسجيل لدور الموارد البشرية');
  assert.throws(()=>transaction(db,()=>recordOverride(db,users['hr-manager'],'employee','gcc_national',{effective_from:'2025-01-01',basis:'وثيقة مصطنعة لا وجود لها'})),code('not_permitted'));
});

test('a joiner mid-month is charged on the days of service by the divisor the HR manager chose, and both shares follow the rounding rule he accepted in the pay rules',t=>{
  const {db,users,contract,nationality,prepare,line}=fixture(t);
  // م50/5 المقبولة: التقريب إلى الريال الأعلى. يُطبَّق على الحصتين معًا.
  transaction(db,()=>decideRule(db,users['hr-manager'],'reg-seed-pay-rules','accept',
    {effective_from:'2019-01-01',choices:{rounding:'riyal_up'},note:'طابقت قواعد الصرف مع اللائحة الموقعة (اختبار مصطنع)'}));
  // أجر خاضع 8,333.33 ريال: 9.75% منه 812.50 بالهللة، فيظهر أثر التقريب.
  contract('employee','2023-05-01','8333.33','0.00');nationality('employee','saudi');
  // ملتحق في 16 سبتمبر: 15 يوم خدمة على مقسوم الثلاثين = نصف الشهر.
  contract('outsider','2026-09-16');nationality('outsider','saudi');
  const run=prepare('2026-09'),whole=line(run,'employee'),joiner=line(run,'outsider');
  assert.equal(whole.basis.insurance.rounding===undefined,true);
  assert.equal(whole.social_insurance_minor,81300,'812.50 ريال مقرَّبة إلى 813.00');
  assert.equal(whole.employer_insurance_minor,98000,'979.17 ريال مقرَّبة إلى 980.00 بالزيادة');
  assert.equal(joiner.basis.insurance.service_days,15);
  assert.equal(joiner.basis.insurance.partial_month_basis,'thirty');
  assert.equal(joiner.basis.insurance.fraction_bp,5000,'15 من 30');
  // 10,000 × 10.75% × 50% = 537.50 ريال، ثم التقريب إلى 538.00.
  assert.equal(joiner.social_insurance_minor,53800);
  assert.equal(run.lines.every(l=>l.net_minor===l.gross_minor-l.unpaid_absence_minor-l.social_insurance_minor),true,'حصة المنشأة لا تدخل الصافي مهما قُرِّبت');
});

test('the run totals and the wage-protection deduction never carry the employer share: it is stored on the line as the company cost and nowhere else',t=>{
  const {db,users,contract,nationality,prepare,line}=fixture(t);
  contract('employee','2023-05-01');nationality('employee','saudi');
  const run=prepare('2026-09'),row=line(run,'employee');
  assert.ok(row.employer_insurance_minor>0);
  assert.equal(run.gross_minor,row.gross_minor,'حصة المنشأة ليست استحقاقًا للموظف');
  assert.equal(run.deductions_minor,row.social_insurance_minor,'ولا استقطاعًا عليه');
  assert.equal(run.net_minor,run.gross_minor-run.deductions_minor);
  // وما يُصرف للموظف في ملف حماية الأجور هو الصافي نفسه.
  assert.equal(row.net_minor,row.gross_minor-row.social_insurance_minor);
});
