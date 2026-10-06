import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { decideRule, prepareRule, ruleChecks } from '../app/payroll-rules.mjs';
import { recordDemographics } from '../app/workforce.mjs';
import { getRun, listPayroll, prepareRun, runAction } from '../app/payroll.mjs';
import { retroCandidates } from '../app/payroll-retro.mjs';
import { insuranceBoard, recordOverride } from '../app/payroll-insurance.mjs';
import { labelFor } from '../app/inbox.mjs';
import { obligations } from '../app/obligations.mjs';
import { payrollUI } from '../app/static/payroll-ui.mjs';
import { riyadhMonth } from '../app/riyadh-time.mjs';
import { onEveryClock } from './riyadh-clock.mjs';

// ما أثبته مراجعون مستقلون على هذا الفرع، عطبًا عطبًا. كل رقم متوقَّع هنا من الموجز القانوني بمصدره
// (9.75% للخاضع للنظام السابق، 10.75% لدرجة 1 يوليو 2026، صفر لغير السعودي و2% أخطار على المنشأة)
// أو رقمٌ مصطنع للاختبار يقول النص أنه مصطنع — ولا رقم نظامي جديد يُخترع هنا.
const code=value=>error=>error.code===value;
const BEFORE_NEW_LAW='2023-05-01',AFTER_NEW_LAW='2025-02-01';
const e=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=m=>(m/100).toFixed(2);
const html=data=>payrollUI.render(data,{e,button:()=>'',money,ui:{tile:()=>''}});

function fixture(t,{acceptInsurance=true,partial='thirty',insuranceFrom='2019-01-01',cyclePolicy=null}={}){
  const db=openDb(':memory:');seed(db,'synthetic-insurance-review');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL),('reviewer','36t','hr','reviewer','مراجع الرواتب المصطنع','unused','employee','hr-manager')");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const grant=(user_id,capability)=>transaction(db,()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح مصطنع لاختبار مراجعة التأمينات'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve','payroll.approve'])grant('hr-manager',c);
  grant('reviewer','payroll.review');// hr.policy.prepare وhr.workforce.view أصلًا من افتراضيات دور الموارد البشرية
  const policy=(kind,parameters,title)=>{const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind,title,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2019-01-01',parameters}));
    transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار المحلي'}));return id;};
  policy('pay_components',{components:['basic','housing','transport']},'بنود الراتب');
  policy('payroll_cycle',cyclePolicy??{pay_day:27,day_basis:'thirty',review_threshold_bp:9000},'دورة الرواتب');
  const acceptInsuranceRule=(from=insuranceFrom)=>transaction(db,()=>decideRule(db,users['hr-manager'],'reg-seed-social-insurance','accept',
    {effective_from:from,choices:{partial_month_basis:partial},note:'طابقت النسب مع مصادر المؤسسة العامة للتأمينات قبل القبول (اختبار مصطنع)'}));
  if(acceptInsurance)acceptInsuranceRule();
  const contract=(user_id,start,basic='8000.00',housing='2000.00')=>{
    const {id}=transaction(db,()=>prepareContract(db,users.hr,{user_id,contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:start,weekly_hours:40,probation_days:90,notice_days:60,
      pay_lines:[{component:'basic',amount:basic},{component:'housing',amount:housing}],document_reference:'عقد مصطنع'}));
    const step=(who,action)=>transaction(db,()=>contractAction(db,users[who],id,action,{version:getContract(db,users[who],id).version}));
    step('hr','submit_contract');step('hr-manager','approve_contract');return id;};
  const nationality=(user_id,group,extra={})=>transaction(db,()=>recordDemographics(db,users.hr,user_id,{version:db.prepare('SELECT version FROM employee_demographics WHERE user_id=?').get(user_id)?.version??0,
    nationality_group:group,gender:null,source:'صورة وثيقة مصطنعة في ملف الموظف',...extra}));
  // تاريخ المباشرة في السجل الوظيفي: موضعه المقرر في المنصة، وهو ما تقرؤه الوحدات الأخرى أولًا.
  const joinDate=(user_id,date)=>db.prepare('INSERT INTO employee_profiles(user_id,tenant_id,job_title,employment_type,join_date,contract_end,status,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(user_id,'36t','وظيفة مصطنعة','full_time',date,null,'active','hr',now());
  const birthDate=(user_id,date)=>db.prepare("INSERT INTO employee_personal(user_id,tenant_id,birth_date,source,recorded_by,updated_at) VALUES(?,'36t',?,'صورة وثيقة مصطنعة',?,?)").run(user_id,date,'hr',now());
  const parameters=()=>JSON.parse(db.prepare("SELECT parameters FROM regulation_policies WHERE tenant_id='36t' AND kind='social_insurance' AND status='accepted' ORDER BY effective_from DESC LIMIT 1").get().parameters);
  const amendRule=(changes,from)=>{const base=db.prepare("SELECT id FROM regulation_policies WHERE tenant_id='36t' AND kind='social_insurance' AND status='accepted' ORDER BY effective_from DESC LIMIT 1").get().id;
    const {id}=transaction(db,()=>prepareRule(db,users.hr,{based_on:base,parameters:{...parameters(),...changes},note:'تعديل مصطنع لاختبار المراجعة المستقلة'}));
    return transaction(db,()=>decideRule(db,users['hr-manager'],id,'accept',{effective_from:from,choices:{},note:'قبول مصطنع للنسخة المعدلة في الاختبار المحلي'}));};
  const absence=(user_id,month,days)=>{for(let d=1;d<=days;d++)db.prepare("INSERT INTO attendance_absences(id,tenant_id,user_id,work_date,reason,status,proposed_by,decided_by,decided_at,created_at) VALUES(?,'36t',?,?,?,'confirmed','hr','hr-manager',?,?)")
    .run(`abs-${user_id}-${d}`,user_id,`${month}-${String(d).padStart(2,'0')}`,'غياب غير مدفوع مصطنع للاختبار',now(),now());};
  const prepare=month=>getRun(db,users.hr,transaction(db,()=>prepareRun(db,users.hr,{month})).id);
  const act=(who,run,action,values={})=>transaction(db,()=>runAction(db,users[who],run.id,action,{version:run.version,...values}));
  const line=(run,user_id)=>run.lines.find(l=>l.user_id===user_id);
  return {db,users,contract,nationality,joinDate,birthDate,parameters,amendRule,absence,prepare,act,line,acceptInsuranceRule};
}

test('the case follows the join date the employee record holds, not the start of the contract he happens to be on now; and two recorded dates on opposite sides of the new law are named, never picked between',t=>{
  const {db,users,contract,nationality,joinDate,prepare,act,line}=fixture(t);
  // سجلٌ وظيفي يقول 2019 وعقد جارٍ يبدأ 2019: التاريخان متفقان على الجانب نفسه، فالحالة النظام السابق.
  contract('employee','2019-06-01');nationality('employee','saudi');joinDate('employee','2019-03-01');
  // شركة تبنّت المنصة في 2025: تاريخ المباشرة الحقيقي 2019 والعقد الوحيد المسجل يبدأ 2025 — التاريخان على طرفي 3 يوليو 2024.
  contract('outsider','2025-01-01');nationality('outsider','saudi');joinDate('outsider','2019-03-01');
  const run=prepare('2026-09'),long=line(run,'employee'),adopted=line(run,'outsider');
  assert.equal(long.basis.insurance.case,'saudi_previous_law');
  assert.equal(long.basis.insurance.derived_from.start_date,'2019-03-01','تاريخ السجل الوظيفي لا بداية العقد');
  assert.equal(long.basis.insurance.derived_from.join_source,'profile');
  assert.equal(long.social_insurance_minor,Math.round(1000000*0.0975),'9.75% لا 10.75%: مئة ريال شهريًا كانت تُخصم بلا وجه حق');
  assert.equal(adopted.basis.insurance.method,'unavailable');
  assert.equal(adopted.basis.insurance.blocked,'start_date_conflict');
  let thrown=null;try{act('hr',run,'submit_run');}catch(error){thrown=error;}
  assert.equal(thrown?.code,'insurance_case_required');
  assert.ok(thrown.details.refusal.missing.some(m=>m.document.includes('2019-03-01')&&m.document.includes('2025-01-01')),'الرفض يسمّي التاريخين معًا');
  // والوثيقة تحسمه: استثناء «له مدة اشتراك سابقة» يجعل الجانبين سواء، فلا يبقى سؤال.
  transaction(db,()=>recordOverride(db,users.hr,'outsider','prior_contribution_period',{effective_from:'2019-03-01',basis:'شهادة مدد وأجور مصطنعة تثبت اشتراكه قبل النظام الجديد'}));
  const again=act('hr',getRun(db,users.hr,run.id),'recalculate');
  assert.equal(line(again,'outsider').basis.insurance.case,'saudi_previous_law');
  assert.ok(act('hr',getRun(db,users.hr,run.id),'submit_run'));
});

// جواب «ليس خليجيًا» يُسجَّل ساريًا من يوم الرياض الذي أُدخل فيه (app/workforce.mjs)، ومسير الشهر يقرأ الاستثناءات السارية في آخر يوم
// منه. كان المسير هنا «2026-09» حرفًا، فسقط الاختبار من 02:05 بتوقيت الرياض يوم 1 أكتوبر وسيبقى ساقطًا بعده: الجواب ساري من أكتوبر
// ولا يغطي سبتمبر. المسير هنا لشهر الرياض الجاري، فيبقى الاختبار على ما يثبته (السؤال يمنع حتى يُجاب) أيًّا كان يوم تشغيله.
const gccQuestion=t=>{
  const {db,users,contract,nationality,prepare,act,line}=fixture(t);
  contract('employee',BEFORE_NEW_LAW);nationality('employee','saudi');
  contract('outsider',AFTER_NEW_LAW);nationality('outsider','non_saudi');
  const run=prepare(riyadhMonth());
  assert.equal(line(run,'outsider').basis.insurance.case,'non_saudi','الحالة تُشتق كما كانت، والسؤال لا يمنع الاحتساب');
  assert.equal(run.insurance.unanswered.length,1);
  let thrown=null;try{act('hr',run,'submit_run');}catch(error){thrown=error;}
  assert.equal(thrown?.code,'insurance_case_required');
  assert.ok(thrown.details.refusal.missing.some(m=>m.document.includes('مواطن خليجي')),'الرفض يسمّي السؤال نفسه');
  assert.equal(insuranceBoard(db,users.hr).unanswered,1);
  // الجواب يُسجَّل حيث تُسجَّل الجنسية: «لا» جوابٌ بسنده لا سكوت.
  nationality('outsider','non_saudi',{gcc_national:'no'});
  const answered=act('hr',getRun(db,users.hr,run.id),'recalculate');
  assert.equal(answered.insurance.unanswered.length,0);
  assert.ok(db.prepare("SELECT 1 FROM employee_insurance_overrides WHERE user_id='outsider' AND kind='not_gcc_national' AND withdrawn_by IS NULL").get());
  assert.ok(act('hr',getRun(db,users.hr,run.id),'submit_run'));
  // و«نعم» على موظف آخر يوقف مسيره كما كان.
  contract('manager',AFTER_NEW_LAW);nationality('manager','non_saudi',{gcc_national:'yes'});
  assert.throws(()=>nationality('manager','non_saudi',{gcc_national:'no'}),code('gcc_recorded'));
  assert.ok(verifyAudit(db));
};
test('a non-Saudi is not assumed to be outside the Gulf because nobody asked: the run refuses until the question is answered where nationality is recorded, and either answer is a record',gccQuestion);
onEveryClock(test,'a non-Saudi is not assumed to be outside the Gulf because nobody asked: the run refuses until the question is answered where nationality is recorded, and either answer is a record',gccQuestion);

test('the approval gate reads the rule in force, not the basis frozen on the line: a draft calculated before the rule was accepted, or before an exclusion was recorded, cannot be submitted or approved',t=>{
  const {db,users,contract,nationality,prepare,act,line,acceptInsuranceRule}=fixture(t,{acceptInsurance:false,
    cyclePolicy:{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:975,social_insurance_base:['basic','housing'],review_threshold_bp:9000}});
  contract('employee','2026-02-01');nationality('employee','saudi');
  const draft=prepare('2026-09');
  assert.equal(line(draft,'employee').basis.insurance.method,'flat_policy');
  acceptInsuranceRule('2019-01-01');
  const after=getRun(db,users.hr,draft.id);
  assert.equal(after.insurance.stale.length,1,'السطر محسوب بالنسبة الواحدة والقاعدة الآن بالحالة');
  assert.equal(after.insurance.employer_total_minor,0);
  let thrown=null;try{act('hr',after,'submit_run');}catch(error){thrown=error;}
  assert.equal(thrown?.code,'insurance_recalculate_required');
  assert.ok(thrown.details.refusal.next.includes('إعادة الاحتساب'));
  const recomputed=act('hr',getRun(db,users.hr,draft.id),'recalculate');
  assert.equal(recomputed.lines[0].social_insurance_minor,Math.round(1000000*0.1075),'مشترك جديد على درجة 1 يوليو 2026');
  act('hr',getRun(db,users.hr,draft.id),'submit_run');
  // واستثناء سُجِّل بعد التقديم لا يمر إلى الاعتماد بأرقام ما قبله.
  transaction(db,()=>recordOverride(db,users.hr,'employee','prior_contribution_period',{effective_from:'2026-02-01',basis:'شهادة مدد وأجور مصطنعة من صاحب عمل سابق'}));
  // الحزمة 4 (P4-HR-2، 1 أكتوبر 2026): المراجعة نفسها تتحقق الآن من بصمة مدخلات المسير، فالاستثناء الذي غيّر الحالة بعد التقديم
  // يوقف المراجعة باسم «قواعد التأمينات والتقريب» قبل أن يبلغ الاعتماد — كانت المراجعة تمر ويوقفه الاعتماد وحده.
  assert.throws(()=>act('reviewer',getRun(db,users.reviewer,draft.id),'pass_review',{note:'مراجعة مصطنعة للاختبار المحلي'}),
    error=>error.code==='inputs_changed'&&error.details.refusal.missing.map(m=>m.doc_key).includes('rules'));
  assert.equal(getRun(db,users.hr,draft.id).status,'in_review','the run does not reach approval with its pre-exclusion numbers');
});

test('an employee whose contract changed mid-month is charged on each part by its own wage and days, not on the newest contract for the whole month',t=>{
  const {db,users,contract,nationality,prepare,line}=fixture(t);
  const first=contract('employee','2023-05-01','8000.00','2000.00');
  transaction(db,()=>contractAction(db,users['hr-manager'],first,'end_contract',{version:getContract(db,users['hr-manager'],first).version,ended_on:'2026-09-15',reason:'زيادة راتب مصطنعة تُنهي العقد وتبدأ غيره'}));
  contract('employee','2026-09-16','32000.00','8000.00');
  nationality('employee','saudi');
  const l=line(prepare('2026-09'),'employee'),insurance=l.basis.insurance;
  assert.equal(insurance.parts.length,2);
  assert.equal(insurance.parts[0].contributory_wage_minor,1000000);
  assert.equal(insurance.parts[1].contributory_wage_minor,4000000);
  // نصف شهر على 10,000 ونصف على 40,000 = 25,000 أساسًا خاضعًا، لا 40,000 شهرًا كاملًا.
  assert.equal(insurance.contributory_wage_minor,2500000);
  assert.equal(l.social_insurance_minor,Math.round(1000000*0.0975/2)+Math.round(4000000*0.0975/2));
  assert.ok(insurance.rule.includes('جزأي الشهر'));
});

test('a share clamped to what is left of the wage says so on the line, on the run and on the payslip: the percentage never prints next to an amount it does not produce',t=>{
  const {db,users,contract,nationality,absence,prepare,act,line}=fixture(t);
  contract('employee',BEFORE_NEW_LAW);nationality('employee','saudi');
  absence('employee','2026-09',28);
  const run=prepare('2026-09'),insurance=line(run,'employee').basis.insurance;
  assert.equal(insurance.employee_uncapped_minor,97500);
  assert.equal(insurance.capped_by_net,true);
  assert.equal(insurance.shortfall_minor,97500-insurance.employee_minor);
  assert.equal(run.insurance.capped.length,1);
  assert.equal(run.insurance.capped_shortfall_minor,insurance.shortfall_minor);
  assert.ok(insurance.rule.includes('حُصر المخصوم'));
  assert.ok(ruleChecks(db,'36t',db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(run.id)).some(c=>c.level==='warn'&&c.article==='م19/4'));
  act('hr',run,'submit_run');
  act('reviewer',getRun(db,users.reviewer,run.id),'pass_review',{note:'مراجعة مصطنعة للاختبار المحلي'});
  act('hr-manager',getRun(db,users['hr-manager'],run.id),'approve_run',{note:'اعتماد مصطنع للاختبار المحلي'});
  const row=html(listPayroll(db,users.employee)).split('<tr>').find(r=>r.includes('استقطاع التأمينات (حصة الموظف)'));
  assert.ok(row.includes('حُصر بما تبقى من أجرك'),'القسيمة تقول سبب الفرق بدل نسبة لا تُنتج مبلغها');
});

test('accepting the insurance rule after a month was approved does not invent a retroactive wage difference with no stated reason',t=>{
  const {db,users,contract,nationality,prepare,act,acceptInsuranceRule}=fixture(t,{acceptInsurance:false,
    cyclePolicy:{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:975,social_insurance_base:['basic','housing'],review_threshold_bp:9000}});
  contract('employee','2026-02-01');nationality('employee','saudi');
  const run=prepare('2026-09');
  act('hr',run,'submit_run');
  act('reviewer',getRun(db,users.reviewer,run.id),'pass_review',{note:'مراجعة مصطنعة للاختبار المحلي'});
  act('hr-manager',getRun(db,users['hr-manager'],run.id),'approve_run',{note:'اعتماد مصطنع للاختبار المحلي'});
  acceptInsuranceRule('2019-01-01');
  const candidates=retroCandidates(db,users.hr).candidates;
  assert.equal(candidates.length,0,'فرق الاشتراك ليس فرق أجر ولا يُعرض حركةً تُصرف');
});

test('the early-pay date is judged by the working week the tenant accepted, and a date confirmed by mistake is withdrawn with a written reason instead of standing for ever',t=>{
  const {db,users,contract,nationality,prepare,act}=fixture(t);
  // أسبوع دوام الاثنين–الجمعة: الجمعة يوم عمل في هذا الكيان، والأحد يوم راحة.
  const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind:'working_time',title:'ساعات العمل المصطنعة',body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2019-01-01',
    parameters:{workdays:[1,2,3,4,5],start:'09:00',end:'17:00',grace_minutes:30}}));
  transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار المحلي'}));
  contract('employee',BEFORE_NEW_LAW);nationality('employee','saudi');
  const run=prepare('2026-09');
  // 18 سبتمبر 2026 جمعة: يوم عمل في هذا الكيان، وكان يُرفض بأسبوع افتراضي ليس أسبوعه.
  const proposed=act('hr',run,'propose_early_pay',{pay_on:'2026-09-18',reason:'صرف قبل إجازة العيد المصطنعة في الاختبار'});
  assert.equal(proposed.pay_date.decision.pay_on,'2026-09-18');
  // وفي صندوق «بانتظار قراري» اسمُ القرار لا رأسه العام: «تأكيد» وحدها على صف عنوانه «مسير رواتب» تقرأ كأن المسير ينتظر تأكيدًا.
  assert.equal(labelFor('confirm_early_pay'),'تأكيد صرف مبكر');
  assert.ok(obligations(db,users['hr-manager']).items.some(o=>o.source==='payroll'&&o.actions.includes('تأكيد صرف مبكر')));
  const confirmed=act('hr-manager',getRun(db,users['hr-manager'],run.id),'confirm_early_pay',{note:'أقر بأثر التعجيل على السيولة (اختبار مصطنع)'});
  assert.equal(confirmed.pay_date.effective,'2026-09-18');
  // ومن أُكِّد بالخطأ يُسحب بسبب مكتوب بيد غير من اقترحه، فيتحرر الشهر لقرار جديد.
  assert.equal(getRun(db,users['hr-manager'],run.id).actions.includes('withdraw_early_pay'),true);
  const withdrawn=act('hr-manager',getRun(db,users['hr-manager'],run.id),'withdraw_early_pay',{note:'تبيّن أن تاريخ الإجازة غير ما بُني عليه القرار (اختبار مصطنع)'});
  assert.equal(withdrawn.pay_date.decision,null);
  assert.equal(withdrawn.pay_date.effective,withdrawn.pay_date.regulation);
  assert.equal(db.prepare("SELECT status FROM payroll_pay_date_decisions WHERE month='2026-09'").get().status,'withdrawn');
  assert.throws(()=>db.prepare("UPDATE payroll_pay_date_decisions SET status='confirmed' WHERE month='2026-09'").run(),/never rewritten/);
  assert.ok(act('hr',getRun(db,users.hr,run.id),'propose_early_pay',{pay_on:'2026-09-17',reason:'اقتراح بديل بعد سحب الأول في الاختبار'}));
  assert.ok(verifyAudit(db));
});

test('the basis of an exclusion refuses an identity number however it is written: Arabic-Indic and Persian digits and digits split by dots are numbers too',t=>{
  const {db,users}=fixture(t);
  const record=(user,basis)=>transaction(db,()=>recordOverride(db,users.hr,user,'prior_contribution_period',{effective_from:'2025-02-01',basis}));
  assert.throws(()=>record('employee','شهادة مدد وأجور بتاريخ 2026-01-01 رقم الهوية 1056789012'),code('reference_number'));
  assert.throws(()=>record('employee','شهادة مدد وأجور بتاريخ ٢٠٢٦ رقم الهوية ١٠٥٦٧٨٩٠١٢'),code('reference_number'));
  assert.throws(()=>record('employee','شهادة مدد وأجور بتاريخ ۲۰۲۶ رقم الهوية ۱۰۵۶۷۸۹۰۱۲'),code('reference_number'));
  assert.throws(()=>record('employee','شهادة مدد وأجور بتاريخ 2026 رقم الهوية 1.0.5.6.7.8.9.0.1.2'),code('reference_number'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM employee_insurance_overrides').get().n,0);
  // والقاعدة نفسها سدٌّ أخير خلف الشاشة.
  assert.throws(()=>db.prepare("INSERT INTO employee_insurance_overrides(id,tenant_id,user_id,kind,effective_from,basis,recorded_by,recorded_at,created_at) VALUES('x','36t','employee','gcc_national','2025-01-01','وثيقة رقمها ١٢٣٤٥٦','hr','t','t')").run(),/CHECK/);
});

test('when the accepted rounding rule moves the deduction, the basis carries the amount that was actually withheld — and the HR manager may keep the employee share at the halala the brief recommends',t=>{
  const {db,users,contract,nationality,amendRule,prepare,act,line}=fixture(t);
  transaction(db,()=>decideRule(db,users['hr-manager'],'reg-seed-pay-rules','accept',
    {effective_from:'2019-01-01',choices:{rounding:'riyal_up'},note:'طابقت قواعد الصرف مع اللائحة الموقعة (اختبار مصطنع)'}));
  contract('employee','2023-05-01','8333.33','0.00');nationality('employee','saudi');
  const first=prepare('2026-09'),rounded=line(first,'employee');
  assert.equal(rounded.social_insurance_minor,81300,'812.50 ريال مقرَّبة إلى 813.00 بقاعدة م50/5 المقبولة');
  assert.equal(rounded.basis.insurance.employee_minor,rounded.social_insurance_minor,'السند يحمل ما خُصم لا ما كان قبل التقريب');
  assert.equal(rounded.basis.insurance.employer_minor,rounded.employer_insurance_minor);
  assert.ok(rounded.basis.insurance.rule.includes('التقريب إلى الريال الأعلى'));
  // والموجز يوصي بالاحتساب إلى خانتين: خيار معلن في القاعدة نفسها لا قاعدة تقريب أجور تُورَّث للخصم.
  act('hr',first,'cancel_run',{note:'إلغاء مصطنع لإعادة الإعداد بعد تعديل القاعدة'});
  amendRule({employee_rounding:'halala'},'2019-01-02');
  const halala=line(prepare('2026-09'),'employee');
  assert.equal(halala.social_insurance_minor,81250,'حصة الموظف بالهللة');
  assert.equal(halala.employer_insurance_minor,98000,'وحصة المنشأة تبقى على م50/5 لأنها تكلفة عليها لا خصم');
  assert.equal(halala.basis.insurance.employee_minor,halala.social_insurance_minor);
});

test('the occupational-hazards branch is in force under both laws, so a month before the date that was copied into its row still charges the company its two per cent',t=>{
  const {db,users,contract,nationality,prepare,line}=fixture(t);
  contract('employee','2019-05-01');nationality('employee','non_saudi',{gcc_national:'no'});
  const run=prepare('2021-06'),row=line(run,'employee');
  assert.equal(row.basis.insurance.method,'per_case');
  assert.equal(row.social_insurance_minor,0,'لا يُخصم من غير السعودي شيء');
  assert.equal(row.employer_insurance_minor,Math.round(1000000*0.02),'2% أخطار مهنية على المنشأة وحدها');
  assert.ok(row.basis.insurance.rate_note.includes('حدٌّ تقني'),'تاريخ الصف معلن أنه ليس تاريخًا نظاميًا');
});

test('an age at first coverage is never applied as a figure the platform invented: nothing changes until the HR manager records a verified threshold, and then the run refuses instead of deducting',t=>{
  const {db,users,contract,nationality,birthDate,amendRule,prepare,act,line}=fixture(t);
  contract('employee',AFTER_NEW_LAW);nationality('employee','saudi');birthDate('employee','1959-01-01');
  const draft=prepare('2026-09'),before=line(draft,'employee');
  assert.equal(before.basis.insurance.case,'saudi_new_entrant','بلا حدٍّ محقق لا يُخترع حدٌّ ولا يُغيَّر الخصم');
  assert.equal(before.basis.insurance.derived_from.age_at_commencement,66,'والسن تُقال في السند حتى تُرى');
  // حدٌّ مصطنع للاختبار (66 سنة) لا رقم نظامي: الغرض إثبات أن المسار موجود متى حُقّق الرقم.
  act('hr',draft,'cancel_run',{note:'إلغاء مصطنع لإعادة الإعداد بعد تسجيل حد السن'});
  amendRule({age_thresholds:{saudi_new_entrant:66}},'2019-01-02');
  const after=prepare('2026-09'),row=line(after,'employee');
  assert.equal(row.basis.insurance.method,'unavailable');
  assert.equal(row.basis.insurance.blocked,'age_case');
  assert.equal(row.social_insurance_minor,0);
  assert.throws(()=>act('hr',after,'submit_run'),code('insurance_case_required'));
});

test('a run whose month the insurance rule never governed says the company share is unavailable, and never prints a zero it did not compute',t=>{
  const {db,users,contract,nationality,prepare}=fixture(t,{acceptInsurance:false,
    cyclePolicy:{pay_day:27,day_basis:'thirty',social_insurance_employee_bp:975,social_insurance_base:['basic','housing'],review_threshold_bp:9000}});
  contract('employee',BEFORE_NEW_LAW);nationality('employee','saudi');
  const run=prepare('2026-09');
  assert.equal(run.insurance.rule_accepted,false);
  assert.equal(run.insurance.employer_total_minor,null,'لم تُحتسب فليست صفرًا');
  const page=html(listPayroll(db,users.hr));
  const fact=page.split('<div>').find(d=>d.includes('حصة المنشأة في التأمينات'));
  assert.ok(fact.includes('غير متاح'),'الشاشة تقول «غير متاح» لا ٠٫٠٠');
});
