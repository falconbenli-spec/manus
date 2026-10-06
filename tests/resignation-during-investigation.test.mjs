import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { runDue } from '../app/jobs.mjs';
import { decideRule, addDays } from '../app/payroll-rules.mjs';
import { prepareContract, contractAction, getContract, preparePolicy, decidePolicy } from '../app/hr-contracts.mjs';
import { submitResignation, resignationAction, resignationsBoard, openInvestigationsFor } from '../app/resignations.mjs';

// م37/5 الموقعة: «لا يجوز قبول استقالة العامل المُحال إلى التحقيق، أو الموقوف عن العمل؛ حتى يُبتَّ في أمره».
// المنع منصبٌّ على القبول وحده. وكانت المنصة ترفض التقديم نفسه، فلا يُسجَّل الخطاب ولا يبدأ الإشعار ولا تجري مدة
// القبول الحكمي — وهي مدد تعطيها اللائحة للعامل، فيخسرها بسبب إجراء لم يُبت فيه بعد.
const code = value => error => error.code === value;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const at = date => Date.parse(`${date}T12:00:00+03:00`);

function fixture(t) {
  const db = openDb(':memory:'); seed(db, 'synthetic-resignation-art37'); t.after(() => db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL)");
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u])), tx = f => transaction(db, f);
  for (const capability of ['hr.policy.accept', 'hr.contracts.approve'])
    tx(() => grantAccess(db, users.admin, { user_id: 'hr-manager', capability, note: 'تصريح مصطنع لاختبار م37/5' }));
  const policy = (kind, parameters) => { const { id } = tx(() => preparePolicy(db, users.hr, { kind, title: 'سياسة ' + kind, body: 'نص سياسة مصطنع كافٍ الطول لأغراض الاختبار الآلي فقط.', basis: 'قرار إدارة مصطنع لسنة 2026', effective_from: '2019-01-01', parameters })); tx(() => decidePolicy(db, users['hr-manager'], id, 'accept', { note: 'اعتماد مصطنع للاختبار' })); };
  policy('pay_components', { components: ['basic', 'housing'] });
  const { id: contractId } = tx(() => prepareContract(db, users.hr, { user_id: 'employee', contract_type: 'indefinite', job_title: 'وظيفة مصطنعة', work_location: 'الرياض', start_date: '2026-01-01', weekly_hours: 40, probation_days: 90, notice_days: 0, pay_lines: [{ component: 'basic', amount: '8000.00' }, { component: 'housing', amount: '2000.00' }], document_reference: 'عقد مصطنع' }));
  tx(() => contractAction(db, users.hr, contractId, 'submit_contract', { version: getContract(db, users.hr, contractId).version }));
  tx(() => contractAction(db, users['hr-manager'], contractId, 'approve_contract', { version: getContract(db, users['hr-manager'], contractId).version }));
  tx(() => decideRule(db, users['hr-manager'], 'reg-seed-resignation', 'accept', { effective_from: '2019-01-01', choices: {}, note: 'طابقت قواعد الاستقالة مع الصفحة الموقعة p016 (اختبار مصطنع)' }));
  const d0 = today();
  const openCase = () => { db.prepare("INSERT INTO hr_cases(id,tenant_id,reporter_id,category,subject,description,respondent_id,status,created_at,updated_at) VALUES('case-art37','36t','manager','violation_report','مخالفة مصطنعة قيد التحقيق','وصف مصطنع لبلاغ مخالفة يكفي للاختبار الآلي','employee','open',?,?)").run(d0, d0); return 'case-art37'; };
  const closeCase = id => db.prepare("UPDATE hr_cases SET status='closed',outcome='unfounded',closing_reason='لم تثبت المخالفة بعد التحقيق',closed_by='hr',closed_at=?,version=version+1 WHERE id=?").run(d0, id);
  const resignation = (who, id) => resignationsBoard(db, users[who]).resignations.find(r => r.id === id);
  return { db, users, tx, d0, openCase, closeCase, resignation };
}

test('Art. 37/5 blocks accepting a resignation, not filing one: the letter is recorded and dated while the investigation is open', t => {
  const { db, users, tx, d0, openCase, resignation } = fixture(t);
  const caseId = openCase();
  assert.equal(openInvestigationsFor(db, '36t', 'employee').length, 1);

  // (1) التقديم: يُسجَّل بتاريخه، ويوسم «موقوف قبولها».
  const submitted = tx(() => submitResignation(db, users.employee, { letter_date: d0, proposed_last_day: addDays(d0, 30) }));
  assert.equal(submitted.submitted_on, d0, 'تاريخ التقديم مسجَّل، فلا يخسر العامل مدةً تعطيه إياها اللائحة');
  assert.equal(submitted.acceptance_held, true);
  assert.match(submitted.hold_note, /موقوف قبولها حتى يُبتَّ في التحقيق \(م37\/5\)/);
  const row = db.prepare('SELECT status,submitted_on,letter_date,hold_note FROM resignations WHERE id=?').get(submitted.id);
  assert.deepEqual([row.status, row.submitted_on, row.letter_date], ['submitted', d0, d0]);
  assert.match(row.hold_note, /م37\/5/);
  const staffView = resignation('hr-manager', submitted.id);
  assert.equal(staffView.acceptance_held, true);
  assert.match(staffView.hold_label, /موقوف قبولها/);
  assert.match(staffView.hold_owner, /hr\.discipline\.decide/, 'الوسم يقول من يبت في الأمر');
  assert.equal(staffView.actions.includes('accept_resignation'), false);
  assert.equal(staffView.clock.active, true, 'ساعة الإشعار تجري على خطاب مسجَّل');
  // وتفاصيل الحالة السرية لا تُكشف لصاحبها كما كانت.
  assert.deepEqual(resignation('employee', submitted.id).hold.items, []);

  // (2) القبول: مرفوض، والرفض يسمي ما هو مفتوح ومن يبت فيه.
  let error = null;
  try { tx(() => resignationAction(db, users['hr-manager'], submitted.id, 'accept_resignation', { version: staffView.version, last_working_day: addDays(d0, 30), notice_waived: true })); }
  catch (thrown) { error = thrown; }
  assert.ok(error && code('investigation_open')(error));
  assert.match(error.message, /مخالفة مصطنعة قيد التحقيق/, 'الرفض يسمي الإجراء المفتوح');
  assert.match(error.message, /hr\.discipline\.decide/, 'ويسمي من يبت فيه');
  assert.match(error.message, new RegExp(d0), 'ويؤكد أن تاريخ التقديم مسجَّل ولا يتأثر');

  // (3) القبول الحكمي: لا يقع ما دام الأمر مفتوحًا.
  runDue(db, { now: at(addDays(d0, 31)) });
  const held = resignation('hr-manager', submitted.id);
  assert.equal(held.status, 'submitted', 'لا قبول حكمًا قبل البت في التحقيق');
  assert.match(held.hold_note, /م37\/5/);

  // (4) بعد البت: القبول ممكن، ومن يوم التقديم الأول لا من يوم جديد.
  db.prepare("UPDATE hr_cases SET status='closed',outcome='unfounded',closing_reason='لم تثبت المخالفة بعد التحقيق',closed_by='hr',closed_at=?,version=version+1 WHERE id=?").run(d0, caseId);
  const free = resignation('hr-manager', submitted.id);
  assert.equal(free.acceptance_held, false);
  assert.equal(free.hold, null);
  assert.ok(free.actions.includes('accept_resignation'));
  tx(() => resignationAction(db, users['hr-manager'], submitted.id, 'accept_resignation', { version: free.version, last_working_day: addDays(d0, 30), notice_waived: true, note: 'قبول بعد إغلاق التحقيق' }));
  const accepted = resignation('hr-manager', submitted.id);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.submitted_on, d0, 'تاريخ الخطاب الأول هو المعتمد بعد رفع الوقف');
  assert.ok(verifyAudit(db));
});

test('with no open matter nothing changes: the deemed-acceptance clock runs from the recorded submission date', t => {
  const { db, users, tx, d0, openCase, closeCase, resignation } = fixture(t);
  const caseId = openCase();
  const { id } = tx(() => submitResignation(db, users.employee, { letter_date: d0, proposed_last_day: addDays(d0, 30) }));
  closeCase(caseId);
  runDue(db, { now: at(addDays(d0, 31)) });
  const r = resignation('hr-manager', id);
  assert.equal(r.status, 'deemed_accepted', 'تُعد مقبولة حكمًا بمضي المدة من تاريخ التقديم المسجَّل (م34/1)');
  assert.equal(r.accepted_on, addDays(d0, 31));
});
