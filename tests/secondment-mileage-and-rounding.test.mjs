import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { decideRule } from '../app/payroll-rules.mjs';
import { proposeTravel, travelAction, travelBoard } from '../app/travel.mjs';
import { recordEmployeeGrade, recordTicket, versionInForce, secondmentRounding } from '../app/secondment-benefits.mjs';

// تصحيحان في الانتداب سندهما الصفحات الموقعة:
//   (3) م41 فقرة (ح) — ص p017: «فإن المنشأة تصرف له ريالًا واحدًا عن الكيلو متر الواحد ... ذهابًا وإيابًا».
//       فالمعدل حكم لائحة لا شرط تعميم، وكانت نسخة اللائحة مزروعة بمعدل صفر والمطالبة تُرفض بأن المعدل «يسري مع التعميم».
//   (4) م50/5 — ص p020: كل أجر وبدل ومكافأة وتعويض وحسم في اللائحة يُقرَّب إلى أقرب ريال بالزيادة. قبل المالك القاعدة
//       في سياسة قواعد صرف الأجر، وكان الانتداب يقرأ التقريب من حقل النسخة وحدها فلا تصل القاعدة المقبولة إلى البدل.
const code = expected => error => error.code === expected;
const RULE_FROM = '2026-06-01';

function fixture(t) {
  const db = openDb(':memory:'); seed(db, 'synthetic-secondment-signed-regulation'); t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const tx = run => transaction(db, run), time = now();
  for (const capability of ['hr.policy.accept', 'hr.contracts.approve'])
    tx(() => grantAccess(db, users.admin, { user_id: 'manager', capability, department_id: null, note: 'تصريح مصطنع لاختبار تصحيحات اللائحة الموقعة' }));
  db.prepare("INSERT INTO employee_profiles(user_id,tenant_id,job_title,employment_type,join_date,status,updated_by,updated_at) VALUES('employee','36t','وظيفة مصطنعة','full_time','2024-01-01','active','hr',?)").run(time);
  tx(() => recordEmployeeGrade(db, users.hr, { user_id: 'employee', grade_code: 'D', note: 'درجة مصطنعة لأغراض الاختبار' }));
  tx(() => decideRule(db, users.manager, 'reg-seed-travel', 'accept', { effective_from: '2019-01-01', choices: {}, note: 'طابقت قيم م65 مع الصفحة الموقعة p024 (اختبار مصطنع)' }));
  const view = id => travelBoard(db, users.manager).decisions.find(x => x.id === id);
  const propose = extra => tx(() => proposeTravel(db, users.employee, { task: 'مهمة ميدانية مصطنعة لدى العميل', destination: 'الدمام', scope: 'domestic', distance_km: 400, road_type: 'paved', ...extra })).id;
  const approve = id => tx(() => travelAction(db, users.manager, id, 'approve_travel', { version: view(id).version, grade: 'employee', housing: 'none', transport: 'none' }));
  const acceptRounding = (mode, from = RULE_FROM) => tx(() => decideRule(db, users.manager, 'reg-seed-pay-rules', 'accept',
    { effective_from: from, choices: { rounding: mode }, note: 'قبول قاعدة التقريب في م50/5 كما في الصفحة الموقعة p020' }));
  return { db, users, tx, view, propose, approve, acceptRounding };
}

test('Art. 41(h): the kilometre rate is the regulation’s own, so it is carried by the Art. 65 version and no circular is needed', t => {
  const { db, users, tx, propose, approve } = fixture(t);
  // النسخة السارية هي نسخة اللائحة (م65)؛ التعميم لم يُفعَّل ولا يلزم.
  const live = versionInForce(db, '36t', '2026-07-01');
  assert.equal(live.code, 'regulation_art65');
  assert.equal(live.mileage_rate_minor, 100, 'ريال واحد عن الكيلو متر الواحد (م41/ح، ص p017)');
  assert.ok(live.body.includes('م41 فقرة (ح)'), 'نص النسخة يذكر سند المعدل');
  // ونسخة الكيان المعزول صُححت معها، لأن البذرة تنسخ القالب لكل كيان.
  assert.equal(db.prepare("SELECT mileage_rate_minor AS n FROM secondment_allowance_versions WHERE id='isolated-sec-reg'").get().n, 100);

  const trip = propose({ start_date: '2026-07-01', end_date: '2026-07-03' });
  approve(trip);
  const ticket = tx(() => recordTicket(db, users.hr, trip, { mode: 'mileage', distance_km: 310, measured_from: 'workplace' }));
  assert.equal(ticket.amount_minor, 62000, '310 كم × 2 (ذهابًا وإيابًا) × 1.00 ريال = 620.00 ريال');
  assert.ok(ticket.steps.some(s => s.includes('1.00 ريال للكيلومتر')));
  assert.ok(verifyAudit(db));
});

test('the kilometre refusal fires only when the version in force genuinely carries no rate, and it names who fixes it', t => {
  const { db, users, tx, propose, approve } = fixture(t);
  const trip = propose({ start_date: '2026-07-01', end_date: '2026-07-03' });
  approve(trip);
  // نسخة بلا معدل لا تُنتَج من الشاشات بعد التصحيح، فتُصطنع هنا بكتابة مباشرة على قاعدة في الذاكرة وحدها،
  // لأن المقصود اختبار الرفض نفسه: متى يقع، وبأي نص.
  db.exec('DROP TRIGGER secondment_allowance_versions_fixed');
  db.prepare("UPDATE secondment_allowance_versions SET mileage_rate_minor=0 WHERE id='36t-sec-reg'").run();
  let error = null;
  try { tx(() => recordTicket(db, users.hr, trip, { mode: 'mileage', distance_km: 310, measured_from: 'workplace' })); }
  catch (thrown) { error = thrown; }
  assert.ok(error && code('no_mileage_rate')(error), 'النسخة بلا معدل تُرفض، وبهذا الرمز');
  assert.doesNotMatch(error.message, /التعميم/, 'المعدل حكم م41، فلا يُعلَّق على تعميم');
  assert.match(error.message, /م41/);
  assert.match(error.message, /hr\.policy\.accept/, 'الرفض يسمي من يملك الإصلاح');
});

test('Art. 50(5): the accepted rounding rule reaches the secondment allowance and the ticket, and a version issued before it keeps its own value', t => {
  const { db, users, tx, view, propose, approve, acceptRounding } = fixture(t);
  acceptRounding('riyal_up');
  // النسخة نفسها تحمل التقريب بالهللة، فلولا القاعدة المقبولة لبقي الحساب عليها.
  assert.equal(versionInForce(db, '36t', '2026-07-01').rounding, 'halala');
  assert.equal(secondmentRounding(db, '36t', '2026-07-01', versionInForce(db, '36t', '2026-07-01')).source, 'pay_rules');
  assert.equal(secondmentRounding(db, '36t', '2026-05-01', versionInForce(db, '36t', '2026-05-01')).source, 'version');

  const after = propose({ start_date: '2026-07-01', end_date: '2026-07-03' });
  approve(after);
  const basisAfter = view(after).basis;
  assert.equal(basisAfter.rounding, 'riyal_up', 'قاعدة م50/5 المقبولة هي المرجع، لا حقل النسخة');
  assert.equal(basisAfter.rounding_source, 'pay_rules');
  assert.ok(basisAfter.articles.includes('م50/5'), 'السند المعروض يذكر المادة التي جاء منها التقريب');
  assert.ok(basisAfter.steps.some(s => s.includes('سياسة قواعد صرف الأجر المقبولة')));

  // المسار الثاني: انتداب بدأ قبل سريان القاعدة يبقى على تقريب نسخته، فلا يتغير أثر قرار مضى.
  const before = propose({ start_date: '2026-05-10', end_date: '2026-05-12' });
  approve(before);
  const basisBefore = view(before).basis;
  assert.equal(basisBefore.rounding, 'halala');
  assert.equal(basisBefore.rounding_source, 'version');
  assert.ok(!basisBefore.articles.includes('م50/5'));

  // والتذكرة تقرأ القاعدة نفسها: فرق سعر بكسر ريال يُقرَّب بالزيادة بعد القبول، ويبقى بالهللة قبله.
  const roundedUp = tx(() => recordTicket(db, users.hr, after, { mode: 'fare_difference', issued_class: 'economy', entitled_fare: '4200.55', issued_fare: '1500.00' }));
  assert.equal(roundedUp.amount_minor, 270100, '2700.55 ريال تُقرَّب إلى 2701.00 (م50/5)');
  const kept = tx(() => recordTicket(db, users.hr, before, { mode: 'fare_difference', issued_class: 'economy', entitled_fare: '4200.55', issued_fare: '1500.00' }));
  assert.equal(kept.amount_minor, 270055, 'انتداب سبق قبول القاعدة يبقى على تقريب نسخته');
  assert.ok(verifyAudit(db));
});
