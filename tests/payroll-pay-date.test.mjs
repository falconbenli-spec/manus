import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { decideRule } from '../app/payroll-rules.mjs';
import { getRun, prepareRun, runAction } from '../app/payroll.mjs';

// المالك: الرواتب تُصرف في 27 وتُزاح إلى يوم العمل السابق إن وافقت راحة أو عطلة (م48 المقبولة)،
// «وفي بعض الأحيان يتم صرفها قبل إجازة الأعياد». التعجيل قرار شخصين ولا يتجاوز تاريخ اللائحة أبدًا.
const code=value=>error=>error.code===value;

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-pay-date');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const grant=(user_id,capability)=>transaction(db,()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح مصطنع لاختبار تاريخ الصرف'}));
  for(const c of ['hr.policy.accept','hr.contracts.approve','payroll.approve'])grant('hr-manager',c);
  const policy=(kind,parameters)=>{const {id}=transaction(db,()=>preparePolicy(db,users.hr,{kind,title:'سياسة '+kind,body:'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.',basis:'قرار إدارة مصطنع لسنة 2026',effective_from:'2019-01-01',parameters}));
    transaction(db,()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'اعتماد مصطنع للاختبار المحلي'}));return id;};
  policy('pay_components',{components:['basic','housing']});
  policy('payroll_cycle',{pay_day:27,day_basis:'thirty',review_threshold_bp:9000});
  // م48 المقبولة: الإزاحة إلى يوم العمل السابق.
  transaction(db,()=>decideRule(db,users['hr-manager'],'reg-seed-pay-rules','accept',
    {effective_from:'2019-01-01',choices:{rounding:'halala'},note:'طابقت قواعد الصرف مع اللائحة الموقعة (اختبار مصطنع)'}));
  const {id}=transaction(db,()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'وظيفة مصطنعة',work_location:'الرياض',start_date:'2023-05-01',weekly_hours:40,probation_days:90,notice_days:60,
    pay_lines:[{component:'basic',amount:'8000.00'},{component:'housing',amount:'2000.00'}],document_reference:'عقد مصطنع'}));
  transaction(db,()=>contractAction(db,users.hr,id,'submit_contract',{version:getContract(db,users.hr,id).version}));
  transaction(db,()=>contractAction(db,users['hr-manager'],id,'approve_contract',{version:getContract(db,users['hr-manager'],id).version}));
  const act=(who,run,action,values={})=>transaction(db,()=>runAction(db,users[who],run.id,action,{version:run.version,...values}));
  const run=()=>getRun(db,users.hr,db.prepare("SELECT id FROM payroll_runs WHERE month='2026-09'").get().id);
  transaction(db,()=>prepareRun(db,users.hr,{month:'2026-09'}));
  const holiday=(date,name)=>db.prepare("INSERT INTO public_holidays(id,tenant_id,holiday_date,name,basis,status,proposed_by,decided_by,decided_at,created_at) VALUES(?,'36t',?,?,'قرار مصطنع باعتماد عطلة للاختبار','approved','hr','hr-manager','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z')")
    .run('hol-'+date,date,name);
  return {db,users,act,run,holiday};
}

test('the pay date a run carries is the nominal day, the day Art. 48 shifts it to, and the date actually decided — and an early payment needs two people',t=>{
  const {db,users,act,run}=fixture(t);
  const draft=run();
  assert.equal(draft.pay_date.nominal,'2026-09-27');
  assert.equal(draft.pay_date.regulation,'2026-09-27','27 سبتمبر 2026 يوم عمل، فلا إزاحة');
  assert.equal(draft.pay_date.effective,'2026-09-27','بلا قرار تعجيل، النافذ هو تاريخ اللائحة');
  assert.equal(draft.pay_date.decision,null);
  // التعجيل أبكر من تاريخ اللائحة لا في يومه ولا بعده.
  assert.throws(()=>act('hr',draft,'propose_early_pay',{pay_on:'2026-09-27',reason:'تعجيل بلا تعجيل للاختبار'}),code('not_earlier'));
  assert.throws(()=>act('hr',draft,'propose_early_pay',{pay_on:'2026-09-29',reason:'تأجيل مقنّع في صورة تعجيل'}),code('not_earlier'));
  // ولا يقع على يوم راحة أسبوعية: 25 سبتمبر 2026 جمعة.
  assert.throws(()=>act('hr',draft,'propose_early_pay',{pay_on:'2026-09-25',reason:'صرف مبكر في يوم راحة للاختبار'}),code('rest_day'));
  const proposed=act('hr',draft,'propose_early_pay',{pay_on:'2026-09-24',reason:'الصرف قبل إجازة العيد بحسب طلب المالك'});
  assert.equal(proposed.pay_date.decision.status,'proposed');
  assert.equal(proposed.pay_date.effective,'2026-09-27','المقترح وحده لا يغيّر النافذ قبل تأكيده');
  // من اقترح لا يؤكد.
  assert.throws(()=>act('hr',proposed,'confirm_early_pay',{note:'تأكيد من المقترح نفسه للاختبار'}),code('action_unavailable'));
  const confirmed=act('hr-manager',getRun(db,users['hr-manager'],proposed.id),'confirm_early_pay',{note:'أقر بالتعجيل وأثره على السيولة قبل العيد'});
  assert.equal(confirmed.pay_date.decision.status,'confirmed');
  assert.equal(confirmed.pay_date.decision.confirmed_by_name,users['hr-manager'].name);
  assert.equal(confirmed.pay_date.effective,'2026-09-24','التاريخ المؤكد هو النافذ');
  // ولا يُقترح ثانٍ ما دام الأول قائمًا.
  assert.throws(()=>act('hr',confirmed,'propose_early_pay',{pay_on:'2026-09-23',reason:'اقتراح ثانٍ على الشهر نفسه للاختبار'}),code('action_unavailable'));
  assert.throws(()=>db.prepare("UPDATE payroll_pay_date_decisions SET pay_on='2026-09-10'").run(),/proposed once/);
  assert.throws(()=>db.prepare('DELETE FROM payroll_pay_date_decisions').run(),/retained/);
  assert.ok(verifyAudit(db));
});

test('a holiday declared after the decision can only pull the pay date earlier, never past the date the regulation sets',t=>{
  const {db,users,act,run,holiday}=fixture(t);
  const confirmedRun=(()=>{const p=act('hr',run(),'propose_early_pay',{pay_on:'2026-09-24',reason:'الصرف قبل إجازة العيد بحسب طلب المالك'});
    return act('hr-manager',getRun(db,users['hr-manager'],p.id),'confirm_early_pay',{note:'أقر بالتعجيل وأثره على السيولة قبل العيد'});})();
  assert.equal(confirmedRun.pay_date.effective,'2026-09-24');
  // عطلة تبتلع 23–27 سبتمبر: م48 تزيح تاريخ اللائحة إلى 22 سبتمبر، وهو أبكر من التاريخ المؤكد.
  for(const day of ['2026-09-23','2026-09-24','2026-09-27'])holiday(day,'إجازة مصطنعة للاختبار');
  const after=run();
  assert.equal(after.pay_date.regulation,'2026-09-22');
  assert.equal(after.pay_date.effective,'2026-09-22','النافذ يتبع الأبكر: قرار التعجيل لا يؤخر الصرف عن تاريخ اللائحة');
  assert.equal(after.pay_date.decision.pay_on,'2026-09-24','وقرار التعجيل نفسه محفوظ كما اتُّخذ، بتاريخ اللائحة الذي قيس عليه');
  assert.equal(after.pay_date.decision.regulation_date_at_decision,'2026-09-27');
});

test('an early payment can be refused by the second person, and the month is then free for a new proposal',t=>{
  const {db,users,act,run}=fixture(t);
  const proposed=act('hr',run(),'propose_early_pay',{pay_on:'2026-09-24',reason:'الصرف قبل إجازة العيد بحسب طلب المالك'});
  const rejected=act('hr-manager',getRun(db,users['hr-manager'],proposed.id),'reject_early_pay',{note:'السيولة لا تحتمل التعجيل هذا الشهر'});
  assert.equal(rejected.pay_date.decision,null,'المرفوض لم يعد قرارًا قائمًا');
  assert.equal(rejected.pay_date.effective,'2026-09-27');
  assert.ok(rejected.actions.includes('propose_early_pay'),'والشهر مفتوح لاقتراح جديد');
  assert.equal(db.prepare("SELECT status FROM payroll_pay_date_decisions WHERE id=?").get(proposed.pay_date.decision.id).status,'rejected','والمرفوض يبقى في السجل');
  assert.ok(verifyAudit(db));
});
