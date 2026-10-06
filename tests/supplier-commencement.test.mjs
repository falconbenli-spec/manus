// أمر المباشرة للمورد (الترحيل 162): إذنٌ مستقل بعد أمر الشراء المعتمد، يحفظ من أصدره وتواريخه ونطاقه ونسخة الأمر
// ومدة سريانه ودليل إبلاغ المورد، ويصدره مراجعٌ غير طالب الشراء، والاستلام لا يُسجَّل إلا على إذن يسري لحظة التسجيل،
// والسحب والاستبدال يضيفان سجلًّا ولا يمحوان شيئًا. الدورة من طرف إلى طرف في tests/delivery-cycle.test.mjs؛ هنا
// الطرق السالبة كل واحدة وحدها: الصلاحيات، وفصل المهام، وغياب الأمر، ونسخة الأمر الخطأ، وانتهاء السريان، والسحب،
// والاستبدال، والتكرار، والتسابق، وسلسلة التدقيق، والعزل بين الكيانات، والترحيل على إذنٍ صدر قبله.
// البيانات كلها مصطنعة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase, procurementAction, listProcurement } from '../app/procurement.mjs';
import { requestOrderChange, decideOrderChange, discloseConflict } from '../app/procurement-extras.mjs';
import { authoriseCommencement, replaceCommencement, withdrawCommencement, requireSupplierStart, commencementOf } from '../app/project-axes.mjs';
import { reservePurchaseBudget, commitPurchaseBudget } from '../app/budgets.mjs';
import { resolveCostCenter } from '../app/cost-centres.mjs';
import { procurementUI } from '../app/static/procurement-ui.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';
import { fundProject } from './budget-fixture.mjs';
import { approveVendor } from './vendor-fixture.mjs';

const PASSWORD = 'synthetic-supplier-commencement';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'tests/supplier-commencement-worker.mjs');
const code = value => error => error.code === value;
const caught = run => { try { run(); } catch (error) { return error; } throw new Error('لم يُرفض ما كان يجب رفضه'); };
// يوم الرياض بإزاحة أيام: الخادم يحسب السريان على يوم الرياض، والرياض UTC+3 بلا توقيت صيفي.
const dayAt = (ms, offset = 0) => new Date(ms + 3 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const day = (offset = 0) => dayAt(Date.now(), offset);
const AUTHORISE = (overrides = {}) => ({ start_on: day(), valid_until: day(30), site_or_channel: 'موقع التصوير المصطنع',
  scope_confirmation: 'أيام تصوير بالطاقم والمعدات كما في الأمر المعتمد', evidence: 'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام', ...overrides });
const WITHDRAW = { reason: 'أوقفنا المورد حتى يُعاد تأكيد النطاق مع العميل', evidence: 'خطاب إيقاف مصطنع مرسل للمورد ومحفوظ في ملف الطلب' };

function fixture(t) {
  const db = openDb(':memory:');
  seed(db, PASSWORD);
  t.after(() => db.close());
  // مدير مشروع مصطنع: مراجعٌ ثانٍ في المشروع حين يمنحه مالك المشروع تصريح التكلفة (الترحيل 005).
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT 'pm','36t','creative','pm','مدير مشروع مصطنع',password_hash,'pm','manager' FROM users WHERE id='employee'");
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  for (const key of ['SUPPLIER-A', 'SUPPLIER-B', 'SUPPLIER-C']) approveVendor(db, key);
  const project = transaction(db, () => createProject(db, users.manager, { name: 'مشروع مباشرة مصطنع', brief: 'اختبار أمر المباشرة للمورد', member_ids: ['employee'] }));
  fundProject(db, project.id, 'CC-COMMENCE', '10000.00');
  db.prepare('INSERT INTO project_members VALUES(?,?)').run(project.id, 'pm');
  const grantPm = () => db.prepare('INSERT INTO procurement_project_grants VALUES(?,?,?,?,?)').run(project.id, 'pm', 'manager', 'تصريح تكلفة مستقل لمدير المشروع المصطنع', new Date().toISOString());
  const act = (who, p, action, values = {}) => transaction(db, () => procurementAction(db, users[who], p.id, action, { version: p.version, ...values }));
  const read = (p, who = 'manager') => listProcurement(db, users[who]).find(x => x.id === p.id);
  const ordered = ({ quantity = 3 } = {}) => {
    let p = transaction(db, () => createPurchase(db, users.employee, { project_id: project.id, title: 'احتياج تصوير مصطنع', specification: 'أيام تصوير بطاقم ومعدات',
      cost_center: 'CC-COMMENCE', due_date: '2099-10-20', quantity, unit: 'يوم', budget_amount: '300.00', budget_evidence: 'مخصص المشروع المعتمد', currency: 'SAR' }));
    p = act('employee', p, 'submit');
    for (const [key, price] of [['supplier-a', '10.00'], ['supplier-b', '11.00'], ['supplier-c', '12.00']])
      p = act('employee', p, 'add_quote', { supplier_key: key, supplier_name: 'مورد ' + key, unit_price: price, technical_assessment: 'مطابق للمواصفات المسجلة',
        financial_terms: 'بعد الاستلام والمطابقة', delivery_date: '2099-10-20', evidence: 'عرض مصطنع محفوظ' });
    p = act('manager', p, 'award', { quote_id: p.quotes.find(q => q.supplier_key === 'SUPPLIER-A').id, note: 'أقل سعر مطابق فنيًا ومورد مؤهل' });
    return act('manager', p, 'approve_order', { terms: 'أيام تصوير بالطاقم والمعدات', delivery_date: '2099-10-20', note: 'اعتماد أمر الشراء' });
  };
  const receive = (p, reference, who = 'employee') => act(who, p, 'receive', { quantity: 1, reference, evidence: 'محضر استلام يوم تصوير مصطنع' });
  const amend = (p, date = '2099-11-20') => {
    const change = transaction(db, () => requestOrderChange(db, users.employee, p.id, { kind: 'delivery_date', new_delivery_date: date, new_terms: '',
      reason: 'طلب المورد تمديدًا مكتوبًا لموعد التسليم', supplier_confirmation: 'بريد المورد المصطنع بطلب التمديد' }));
    transaction(db, () => decideOrderChange(db, users.manager, change.id, 'approve', { note: 'التمديد لا يمس موعد تسليم العميل' }));
    return read(p);
  };
  return { db, users, project, grantPm, act, read, ordered, receive, amend };
}

// إدراج مباشر في جدول الأوامر يتخطى الكود كله: ما يُقاس به حارس القاعدة وحده.
function insertAuthorisation(db, row) {
  const values = { id: randomUUID(), tenant_id: '36t', start_on: day(), valid_until: day(30), site_or_channel: 'موقع إدراج مباشر مصطنع',
    scope_confirmation: 'إدراج مباشر لاختبار حارس القاعدة', evidence: 'دليل إدراج مباشر مصطنع', replaces_id: null, replacement_reason: null,
    issued_by: 'manager', issued_at: new Date().toISOString(), ...row };
  db.prepare(`INSERT INTO commencement_authorisations(${Object.keys(values).join(',')}) VALUES(${Object.keys(values).map(() => '?').join(',')})`).run(...Object.values(values));
}
const directReceipt = (db, purchaseId, id) => db.prepare('INSERT INTO procurement_receipts VALUES(?,?,1,?,?,?,?,?)')
  .run(id, purchaseId, 'R-' + id, 'استلام مباشر مصطنع يتخطى الكود', 'employee', 99, new Date().toISOString());

test('commencement: only an independent reviewer in scope issues, replaces or withdraws it — never the requester, an outsider, another tenant or a conflicted reviewer', t => {
  const { db, users, grantPm, act, read, ordered } = fixture(t);
  let p = ordered();
  // طالب الشراء: لا يظهر له الإجراء، ولا يُقبل منه عبر المسار ولا عبر الدالة مباشرة، والرفض يسمّي المالك والخطوة.
  assert.ok(!read(p, 'employee').allowed_actions.includes('commence'));
  assert.throws(() => act('employee', p, 'commence', AUTHORISE()), code('transition_denied'));
  const self = caught(() => transaction(db, () => authoriseCommencement(db, users.employee, p.id, AUTHORISE())));
  assert.equal(self.code, 'self_approval');
  assert.ok(self.details.refusal.missing[0].owner.length > 0 && self.details.refusal.next.length > 0);
  // ولا يصير مراجعًا لطلبه بتغيير دوره: من طلب يبقى طالبًا.
  db.prepare("UPDATE users SET role='manager' WHERE id='employee'").run();
  assert.throws(() => act('employee', p, 'commence', AUTHORISE()), code('transition_denied'));
  assert.throws(() => transaction(db, () => authoriseCommencement(db, users.employee, p.id, AUTHORISE())), code('self_approval'));
  db.prepare("UPDATE users SET role='employee' WHERE id='employee'").run();
  // خارج النطاق: زميلٌ ليس في المشروع، ومسؤولة المنصة، وموظف الكيان الآخر — لا يرون الطلب أصلًا.
  for (const who of ['outsider', 'admin', 'external']) {
    assert.throws(() => act(who, p, 'commence', AUTHORISE()), code('not_found'), who);
    assert.equal(read(p, who), undefined, who);
  }
  assert.throws(() => transaction(db, () => authoriseCommencement(db, users.external, p.id, AUTHORISE())), code('not_found'));
  // مدير المشروع بلا تصريح تكلفة لا يرى الطلب؛ بتصريح من مالك المشروع يصير مراجعًا.
  assert.throws(() => act('pm', p, 'commence', AUTHORISE()), code('not_found'));
  grantPm();
  assert.ok(read(p, 'pm').allowed_actions.includes('commence'));
  // المراجع الذي أفصح عن علاقة بالمورد لا يقرر على أمر مباشرته حتى يُبت في إفصاحه — إصدارًا أو استبدالًا أو سحبًا.
  transaction(db, () => discloseConflict(db, users.manager, { supplier_key: 'SUPPLIER-A', relationship: 'family', description: 'قريب من الدرجة الأولى يملك حصة في المورد المصطنع' }));
  const conflicted = caught(() => act('manager', p, 'commence', AUTHORISE()));
  assert.equal(conflicted.code, 'conflict_of_interest');
  assert.equal(conflicted.details.refusal.missing[0].owner_role, 'manager');
  p = act('pm', p, 'commence', AUTHORISE());
  assert.equal(p.commencement.issued_by, 'pm');
  assert.throws(() => act('manager', read(p), 'replace_commencement', { ...AUTHORISE({ valid_until: day(40) }), reason: 'مدّ الإذن عشرة أيام بطلب المورد المكتوب' }), code('conflict_of_interest'));
  assert.throws(() => act('manager', read(p), 'withdraw_commencement', WITHDRAW), code('conflict_of_interest'));
  assert.throws(() => act('employee', read(p), 'withdraw_commencement', WITHDRAW), code('transition_denied'));
  assert.throws(() => transaction(db, () => withdrawCommencement(db, users.employee, p.id, WITHDRAW)), code('self_approval'));
  // والقاعدة تحرس الشيء نفسه بلا كود: استبدالٌ باسم طالب الشراء، أو سحبٌ باسمه، يُرفضان بإدراج مباشر.
  const live = commencementOf(db, p.id);
  assert.throws(() => insertAuthorisation(db, { purchase_id: p.id, sequence: 2, order_id: p.order.id, order_version: 1, replaces_id: live.id,
    replacement_reason: 'استبدال مباشر باسم طالب الشراء', issued_by: 'employee' }), /the requester does not authorise the supplier/);
  assert.throws(() => db.prepare('INSERT INTO commencement_withdrawals(authorisation_id,tenant_id,purchase_id,reason,evidence,withdrawn_by,withdrawn_at) VALUES(?,?,?,?,?,?,?)')
    .run(live.id, '36t', p.id, 'سحب مباشر باسم طالب الشراء', 'دليل مصطنع للسحب المباشر', 'employee', new Date().toISOString()), /not by the requester/);
  // والعزل بين الكيانين في القاعدة أيضًا: إذنٌ يحمل كيانًا غير كيان الطلب يسقط على المفتاح المركب.
  assert.throws(() => insertAuthorisation(db, { tenant_id: 'isolated', purchase_id: p.id, sequence: 2, order_id: p.order.id, order_version: 1, replaces_id: live.id,
    replacement_reason: 'إذن مباشر من كيان آخر', issued_by: 'external' }), /FOREIGN KEY|binds the current version/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commencement_authorisations').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commencement_withdrawals').get().n, 0);
  assert.ok(verifyAudit(db));
});

test('commencement: it records issuer, dates, scope, order version, validity and evidence, and the receipt re-checks all of it when it is recorded', t => {
  const { db, act, read, ordered, receive, amend } = fixture(t);
  const base = Date.now();
  let p = ordered();
  // بلا إذن: الرفض يسمّي الناقص ومالكه وخطوته، والقاعدة ترفض الإدراج المباشر أيضًا.
  const missing = caught(() => receive(p, 'R-0'));
  assert.equal(missing.code, 'commencement_required');
  assert.match(missing.details.refusal.missing[0].document, /أمر مباشرة/);
  assert.throws(() => directReceipt(db, p.id, 'direct-none'), /receipt requires a valid commencement/);
  // مدخلات ناقصة أو غريبة أو تواريخ متناقضة لا تُكتب.
  assert.throws(() => act('manager', p, 'commence', { ...AUTHORISE(), evidence: '' }), code('invalid_text'));
  assert.throws(() => act('manager', p, 'commence', { ...AUTHORISE(), valid_until: undefined }), code('invalid_date'));
  assert.throws(() => act('manager', p, 'commence', { ...AUTHORISE(), issued_by: 'employee' }), code('invalid_fields'));
  assert.throws(() => act('manager', p, 'commence', AUTHORISE({ start_on: day(-1) })), code('start_before_order'), 'لا يبدأ المورد قبل أمر الشراء');
  assert.throws(() => act('manager', p, 'commence', AUTHORISE({ start_on: day(5), valid_until: day(4) })), code('validity_before_start'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commencement_authorisations').get().n, 0);
  // إذن يبدأ بعد يومين: كل ما يطلبه المعيار محفوظ في الصف، والسريان لم يبدأ فلا استلام.
  p = act('manager', p, 'commence', AUTHORISE({ start_on: day(2) }));
  const issued = db.prepare('SELECT * FROM commencement_authorisations WHERE purchase_id=?').get(p.id);
  assert.deepEqual({ issued_by: issued.issued_by, sequence: issued.sequence, order_id: issued.order_id, order_version: issued.order_version, start_on: issued.start_on,
    valid_until: issued.valid_until, site_or_channel: issued.site_or_channel, scope_confirmation: issued.scope_confirmation, evidence: issued.evidence, replaces_id: issued.replaces_id },
  { issued_by: 'manager', sequence: 1, order_id: p.order.id, order_version: 1, start_on: day(2), valid_until: day(30), site_or_channel: 'موقع التصوير المصطنع',
    scope_confirmation: 'أيام تصوير بالطاقم والمعدات كما في الأمر المعتمد', evidence: 'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام', replaces_id: null });
  assert.match(issued.issued_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(p.commencement.validity.state, 'not_started');
  assert.ok(!read(p, 'employee').allowed_actions.includes('receive'), 'الاستلام لا يظهر والإذن لم يبدأ');
  assert.throws(() => receive(p, 'R-1'), code('commencement_not_started'));
  // الإذن يبدأ اليوم: يُفتح الاستلام.
  p = act('manager', p, 'replace_commencement', { ...AUTHORISE(), reason: 'قدّم المورد موعد البدء إلى اليوم بطلب مكتوب' });
  p = receive(p, 'R-1');
  assert.equal(p.status, 'part_received');
  // تعديل الأمر نسخةٌ جديدة منه: إذن النسخة الأولى لا يكفي، والرفض يسمّي النسختين.
  p = amend(p);
  assert.equal(p.order.order_version, 2);
  assert.equal(p.commencement.validity.state, 'stale');
  const stale = caught(() => receive(p, 'R-2'));
  assert.equal(stale.code, 'commencement_stale');
  assert.match(stale.message, /النسخة 1/);
  assert.match(stale.message, /النسخة 2/);
  assert.throws(() => directReceipt(db, p.id, 'direct-stale'), /receipt requires a valid commencement/);
  // والقاعدة لا تقبل إذنًا جديدًا على النسخة السابقة.
  assert.throws(() => insertAuthorisation(db, { purchase_id: p.id, sequence: 3, order_id: p.order.id, order_version: 1, replaces_id: p.commencement.id,
    replacement_reason: 'إدراج مباشر على نسخة سابقة من الأمر' }), /binds the current version/);
  // إذن على النسخة الثانية يسري يومًا واحدًا بعد اليوم.
  p = act('manager', p, 'replace_commencement', { ...AUTHORISE({ valid_until: day(1) }), reason: 'أُعيد الإذن على النسخة المعدلة من الأمر ليوم واحد' });
  assert.equal(p.commencement.order_version, 2);
  // بعد ثلاثة أيام: انتهى السريان، فالاستلام يُرفض في الكود وفي القاعدة.
  const later = base + 3 * 86400000;
  t.mock.timers.enable({ apis: ['Date'], now: later });
  const expired = caught(() => receive(p, 'R-2'));
  assert.equal(expired.code, 'commencement_expired');
  assert.throws(() => directReceipt(db, p.id, 'direct-expired'), /receipt requires a valid commencement/);
  // ولا يُصدر إذنٌ فات آخر يوم فيه قبل أن يبدأ.
  assert.throws(() => act('manager', p, 'replace_commencement', { ...AUTHORISE({ start_on: dayAt(base, 1), valid_until: dayAt(base, 2) }), reason: 'إذن فات سريانه قبل صدوره' }), code('validity_passed'));
  p = act('manager', p, 'replace_commencement', { ...AUTHORISE({ start_on: dayAt(later), valid_until: dayAt(later, 10) }), reason: 'مُدّ الإذن بعد انتهائه بطلب المورد المكتوب' });
  p = receive(p, 'R-2');
  t.mock.timers.reset();
  assert.equal(p.receipts.length, 2);
  assert.ok(verifyAudit(db));
});

test('commencement: withdrawal and replacement add records and never rewrite or delete the earlier ones', t => {
  const { db, users, act, read, ordered, receive } = fixture(t);
  let p = act('manager', ordered(), 'commence', AUTHORISE());
  const row = id => db.prepare('SELECT * FROM commencement_authorisations WHERE id=?').get(id);
  const first = row(p.commencement.id);
  p = act('manager', p, 'replace_commencement', { ...AUTHORISE({ site_or_channel: 'استوديو المورد البديل' }), reason: 'نُقل التصوير إلى استوديو بديل بطلب العميل المكتوب' });
  const second = row(p.commencement.id);
  assert.deepEqual(row(first.id), first, 'الإذن المستبدَل يُقرأ كما صدر بالضبط');
  assert.equal(second.replaces_id, first.id);
  assert.equal(second.sequence, 2);
  assert.equal(second.replacement_reason, 'نُقل التصوير إلى استوديو بديل بطلب العميل المكتوب');
  assert.deepEqual(p.commencement_history.map(a => [a.sequence, a.state, a.replaced_by]), [[1, 'replaced', second.id], [2, 'live', null]]);
  p = receive(p, 'R-1');
  // السحب: سجلٌّ مستقل، والإذن نفسه باقٍ كما صدر، والاستلام يُرفض ويقول لماذا.
  p = act('manager', p, 'withdraw_commencement', WITHDRAW);
  assert.equal(p.commencement, null);
  assert.deepEqual(row(second.id), second, 'الإذن المسحوب يُقرأ كما صدر بالضبط');
  const withdrawal = db.prepare('SELECT * FROM commencement_withdrawals WHERE authorisation_id=?').get(second.id);
  assert.deepEqual({ by: withdrawal.withdrawn_by, reason: withdrawal.reason, evidence: withdrawal.evidence }, { by: 'manager', ...{ reason: WITHDRAW.reason, evidence: WITHDRAW.evidence } });
  const refused = caught(() => receive(p, 'R-2'));
  assert.equal(refused.code, 'commencement_withdrawn');
  assert.match(refused.details.refusal.missing[0].why, /أوقفنا المورد/);
  assert.throws(() => directReceipt(db, p.id, 'direct-withdrawn'), /receipt requires a valid commencement/);
  // لا إذن قائم فلا استبدال ولا سحب؛ والإصدار الجديد يعود.
  assert.throws(() => transaction(db, () => replaceCommencement(db, users.manager, p.id, { ...AUTHORISE(), reason: 'استبدال إذن مسحوب' })), code('no_live_commencement'));
  assert.throws(() => transaction(db, () => withdrawCommencement(db, users.manager, p.id, WITHDRAW)), code('no_live_commencement'));
  assert.deepEqual(read(p).allowed_actions.filter(a => a.includes('commence')), ['commence']);
  p = act('manager', p, 'commence', AUTHORISE());
  assert.equal(p.commencement.replaces_id, null);
  assert.deepEqual(p.commencement_history.map(a => [a.sequence, a.state]), [[1, 'replaced'], [2, 'withdrawn'], [3, 'live']]);
  assert.equal(p.commencement_history[1].withdrawal.withdrawn_by_name, 'مدير الفريق التجريبي');
  p = receive(p, 'R-2');
  // القاعدة تحفظ التاريخ: لا تعديل ولا حذف لإذن ولا لسحب.
  assert.throws(() => db.exec("UPDATE commencement_authorisations SET valid_until='2099-12-31'"), /issued once/);
  assert.throws(() => db.exec("UPDATE commencement_authorisations SET evidence='دليل معدل بصمت بعد الإصدار'"), /issued once/);
  assert.throws(() => db.exec('DELETE FROM commencement_authorisations'), /retained/);
  assert.throws(() => db.exec("UPDATE commencement_withdrawals SET reason='سبب معدل بصمت بعد السحب'"), /retained as recorded/);
  assert.throws(() => db.exec('DELETE FROM commencement_withdrawals'), /retained as recorded/);
  // إذنٌ قائم واحد، ولا يُحيا إذنٌ مسحوب ولا يُستبدل إذنٌ مرتين.
  const next = { purchase_id: p.id, sequence: 4, order_id: p.order.id, order_version: 1 };
  assert.throws(() => insertAuthorisation(db, next), /one live commencement authorisation per purchase/);
  assert.throws(() => insertAuthorisation(db, { ...next, replaces_id: second.id, replacement_reason: 'إحياء إذن مسحوب بإدراج مباشر' }), /one live commencement authorisation per purchase/);
  assert.throws(() => insertAuthorisation(db, { ...next, replaces_id: first.id, replacement_reason: 'استبدال ثانٍ لإذن مستبدَل' }), /UNIQUE/);
  assert.throws(() => db.prepare('INSERT INTO commencement_withdrawals(authorisation_id,tenant_id,purchase_id,reason,evidence,withdrawn_by,withdrawn_at) VALUES(?,?,?,?,?,?,?)')
    .run(first.id, '36t', p.id, 'سحب إذن مستبدَل بإدراج مباشر', 'دليل مصطنع للسحب المباشر', 'manager', new Date().toISOString()), /only the live commencement/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commencement_authorisations').get().n, 3);
  // سلسلة التدقيق: كل إصدار واستبدال وسحب حدثٌ بما قبله وما بعده وسببه، والسلسلة سليمة.
  const events = db.prepare("SELECT action,actor_id,before_json,after_json,reason FROM audit_events WHERE entity_id=? AND action LIKE 'axes.commencement%' ORDER BY seq").all(p.id);
  assert.deepEqual(events.map(e => e.action), ['axes.commencement_authorised', 'axes.commencement_replaced', 'axes.commencement_withdrawn', 'axes.commencement_authorised']);
  assert.equal(JSON.parse(events[1].before_json).authorisation_id, first.id);
  assert.equal(JSON.parse(events[1].after_json).authorisation_id, second.id);
  assert.equal(events[1].reason, 'نُقل التصوير إلى استوديو بديل بطلب العميل المكتوب');
  assert.equal(JSON.parse(events[2].after_json).state, 'withdrawn');
  assert.equal(events[2].reason, WITHDRAW.reason);
  // والاستلام يُقرن في التدقيق بالإذن الذي تم عليه.
  assert.deepEqual(db.prepare("SELECT reason FROM audit_events WHERE entity_id=? AND action='receive' ORDER BY seq").all(p.id).map(e => e.reason),
    ['استلام على أمر المباشرة رقم 2', 'استلام على أمر المباشرة رقم 3']);
  assert.ok(verifyAudit(db));
});

test('commencement: a replayed or repeated request creates no second record, through the module and through the API route', async t => {
  const { db, users, act, ordered } = fixture(t);
  const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const before = ordered();
  const p1 = act('manager', before, 'commence', AUTHORISE());
  assert.throws(() => act('manager', before, 'commence', AUTHORISE()), code('stale_version'), 'إعادة الطلب نفسه بالنسخة نفسها');
  assert.throws(() => act('manager', p1, 'commence', AUTHORISE()), code('transition_denied'), 'الإصدار يختفي ما دام إذنٌ قائمًا');
  assert.throws(() => transaction(db, () => authoriseCommencement(db, users.manager, p1.id, AUTHORISE())), code('already_commenced'));
  assert.equal(count('commencement_authorisations'), 1);
  const extend = { ...AUTHORISE({ valid_until: day(45) }), reason: 'مدّ الإذن أسبوعين بطلب المورد المكتوب' };
  const p2 = act('manager', p1, 'replace_commencement', extend);
  assert.throws(() => act('manager', p1, 'replace_commencement', extend), code('stale_version'));
  assert.throws(() => act('manager', p2, 'replace_commencement', { ...extend, reason: 'تكرار الاستبدال بالمحتوى نفسه' }), code('no_change'));
  assert.equal(count('commencement_authorisations'), 2);
  const p3 = act('manager', p2, 'withdraw_commencement', WITHDRAW);
  assert.throws(() => act('manager', p2, 'withdraw_commencement', WITHDRAW), code('stale_version'));
  assert.throws(() => act('manager', p3, 'withdraw_commencement', WITHDRAW), code('transition_denied'));
  assert.equal(count('commencement_withdrawals'), 1);
  // المسار نفسه عبر الخادم (POST /api/procurement/:id/<الإجراء>) بلا فتح منفذ: الطلب يُمرَّر إلى المعالج مباشرة.
  const app = createApp(db);
  const login = async username => {
    const response = await dispatch(app, { method: 'POST', path: '/api/login', body: { username, password: PASSWORD } });
    assert.equal(response.status, 200, response.text);
    return { cookie: response.headers['Set-Cookie'].split(';')[0], csrf: response.json().csrf };
  };
  const manager = await login('manager'), employee = await login('employee');
  const post = (auth, path, body) => dispatch(app, { method: 'POST', path: '/api' + path, headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf }, body });
  let q = ordered();
  const denied = await post(employee, `/procurement/${q.id}/commence`, { version: q.version, ...AUTHORISE() });
  assert.equal(denied.status, 403);
  const first = await post(manager, `/procurement/${q.id}/commence`, { version: q.version, ...AUTHORISE() });
  assert.equal(first.status, 201, first.text);
  const replay = await post(manager, `/procurement/${q.id}/commence`, { version: q.version, ...AUTHORISE() });
  assert.equal(replay.status, 409);
  assert.equal(replay.json().error.code, 'stale_version');
  q = first.json();
  const early = await post(employee, `/procurement/${q.id}/receive`, { version: q.version, quantity: 1, reference: 'HTTP-R-0', evidence: 'استلام قبل بدء السريان' });
  assert.equal(early.status, 201, 'الإذن يبدأ اليوم فيُقبل الاستلام');
  q = early.json();
  const replaced = await post(manager, `/procurement/${q.id}/replace_commencement`, { version: q.version, ...AUTHORISE({ valid_until: day(20) }), reason: 'قُصّرت مدة الإذن إلى عشرين يومًا بطلب العميل' });
  assert.equal(replaced.status, 201, replaced.text);
  q = replaced.json();
  const withdrawn = await post(manager, `/procurement/${q.id}/withdraw_commencement`, { version: q.version, ...WITHDRAW });
  assert.equal(withdrawn.status, 201, withdrawn.text);
  q = withdrawn.json();
  const blocked = await post(employee, `/procurement/${q.id}/receive`, { version: q.version, quantity: 1, reference: 'HTTP-R-1', evidence: 'استلام بعد السحب' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json().error.code, 'commencement_withdrawn');
  assert.ok(blocked.json().error.details.refusal.next.length > 0, 'الرفض يصل الشاشة بخطوته التالية');
  const listed = (await dispatch(app, { path: '/api/procurement', headers: { cookie: manager.cookie } })).json().find(x => x.id === q.id);
  assert.deepEqual(listed.commencement_history.map(a => a.state), ['replaced', 'withdrawn']);
  assert.ok(verifyAudit(db));
});

test('commencement: a receipt racing a withdrawal never lands after it — separate processes on one database file', async t => {
  const { db, act, ordered } = fixture(t);
  // ستة طلبات بإذن قائم: ثلاثة يتسابق فيها عاملان يقرأ كل منهما النسخة داخل معاملته (البوابة وحدها تحمي)، وثلاثة
  // يحمل فيها العاملان النسخة نفسها المقروءة قبل السباق (قفل النسخة يحمي أيضًا).
  const purchases = Array.from({ length: 6 }, () => act('manager', ordered(), 'commence', AUTHORISE()));
  const dir = mkdtempSync(join(tmpdir(), '36t-commencement-race-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'race.sqlite');
  db.exec(`VACUUM INTO '${path}'`);
  // الملف يخرج من VACUUM INTO بدفتر الرجوع؛ يُحوَّل إلى WAL مرة قبل السباق كما يفتحه الخادم، وإلا تسابق العمال على التحويل نفسه.
  openDb(path).close();
  const startAt = Date.now() + 3000;
  const run = (job, p, mode) => new Promise(done => {
    const child = spawn(process.execPath, [WORKER, path, job, p.id, String(startAt), mode, String(p.version)], { cwd: ROOT });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('close', () => { try { done(JSON.parse(out.trim().split('\n').pop())); } catch { done({ job, purchase_id: p.id, ok: false, error: 'no output: ' + err.slice(-400) }); } });
  });
  const results = await Promise.all(purchases.flatMap((p, index) => ['receive', 'withdraw'].map(job => run(job, p, index < 3 ? 'fresh' : 'same'))));
  const file = new DatabaseSync(path);
  t.after(() => file.close());
  // أيّ الترتيبين وقع لكل طلب: يُطبع مع النتيجة ليُرى أن السباق جرى فعلًا لا أن أحد العاملين انتهى قبل أن يبدأ الآخر.
  t.diagnostic('orderings: ' + purchases.map((p, index) => `${index < 3 ? 'fresh' : 'same'}:${results.filter(r => r.purchase_id === p.id).filter(r => r.ok).map(r => r.job).join('+') || 'none'}`).join(' '));
  for (const [index, p] of purchases.entries()) {
    const pair = results.filter(r => r.purchase_id === p.id), receipt = pair.find(r => r.job === 'receive'), withdrawal = pair.find(r => r.job === 'withdraw');
    const withdrawn = file.prepare('SELECT w.withdrawn_at FROM commencement_withdrawals w JOIN commencement_authorisations a ON a.id=w.authorisation_id WHERE a.purchase_id=?').get(p.id);
    const received = file.prepare('SELECT created_at FROM procurement_receipts WHERE purchase_id=?').all(p.id);
    assert.equal(received.length, receipt.ok ? 1 : 0, JSON.stringify(pair));
    // الثابت في كل ترتيب: لا استلام بعد السحب.
    if (withdrawn) for (const r of received) assert.ok(r.created_at <= withdrawn.withdrawn_at, `استلام بعد السحب: ${JSON.stringify(pair)}`);
    if (index < 3) {
      // النسخة تُقرأ داخل المعاملة: السحب ينجح دائمًا، والاستلام ينجح فقط إن سبق السحب، وإلا ترفضه البوابة لا قفل النسخة.
      assert.equal(withdrawal.ok, true, JSON.stringify(pair));
      if (!receipt.ok) assert.equal(receipt.error, 'commencement_withdrawn', JSON.stringify(pair));
    } else {
      // النسخة نفسها لكليهما: ينجح أحدهما وحده، والثاني يرى أن الطلب تغيّر.
      assert.equal(pair.filter(r => r.ok).length, 1, JSON.stringify(pair));
      assert.equal(pair.find(r => !r.ok).error, 'stale_version', JSON.stringify(pair));
    }
  }
  // وبعد السحب لا يمر استلامٌ مباشر من اتصال آخر: الحارس في القاعدة لا في الكود.
  const settled = purchases.find(p => file.prepare('SELECT 1 FROM commencement_withdrawals WHERE purchase_id=?').get(p.id));
  assert.ok(settled, 'وقع سحبٌ واحد على الأقل');
  assert.throws(() => file.prepare('INSERT INTO procurement_receipts VALUES(?,?,1,?,?,?,?,?)').run('race-direct', settled.id, 'R-RACE-DIRECT', 'استلام مباشر بعد السحب', 'employee', 99, new Date().toISOString()),
    /receipt requires a valid commencement|receipt exceeds approved order/);
  assert.equal(file.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});

test('commencement UI: the purchase shows the standing authorisation and its history, and every form posts to the procurement route with the opened version', t => {
  const { db, users, project, act, ordered } = fixture(t);
  const e = text => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const context = { e, button: (action, id, label) => `<button data-action="${e(action)}" data-id="${e(id)}">${e(label)}</button>`, money: minor => String(minor) };
  let p = ordered();
  const data = { purchases: [p], projects: [project], user: users.manager };
  // قبل هذا العمل كان زر الإصدار يُرسم بلا عنوان ونموذجه يرمي «الإجراء غير معرف»: الاستلام كان مستحيلًا من الشاشة.
  const issue = procurementUI.form('commence', p.id, data);
  assert.equal(issue.endpoint, `/procurement/${p.id}/commence`);
  assert.deepEqual(issue.fields.map(f => f.name), ['start_on', 'valid_until', 'site_or_channel', 'scope_confirmation', 'evidence']);
  assert.equal(issue.fields.find(f => f.name === 'valid_until').value, '2099-10-20', 'آخر يوم مقترح: موعد تسليم الأمر النافذ');
  assert.equal(issue.toPayload({ start_on: day() }).version, p.version);
  assert.ok(procurementUI.render(data, context).includes('>إصدار أمر المباشرة</button>'));
  p = act('manager', p, 'commence', AUTHORISE({ evidence: 'بريد المورد <img src=x onerror=alert(1)> محفوظ في الملف' }));
  p = act('manager', p, 'replace_commencement', { ...AUTHORISE({ evidence: 'خطاب المباشرة الثاني المرسل للمورد' }), reason: 'نُقل التصوير إلى استوديو بديل بطلب العميل' });
  data.purchases = [p];
  const html = procurementUI.render(data, context);
  assert.ok(html.includes('أمر المباشرة رقم 2'));
  assert.ok(html.includes('>استبدال أمر المباشرة</button>') && html.includes('>سحب أمر المباشرة</button>'));
  assert.ok(html.includes('أوامر المباشرة السابقة (1)'));
  assert.ok(html.includes('&lt;img') && !html.includes('<img src=x'), 'الدليل يُهرَّب');
  assert.ok(!/<button[^>]*><\/button>/.test(html), 'لا زر بلا عنوان');
  const replace = procurementUI.form('replace_commencement', p.id, data);
  assert.deepEqual(replace.fields.map(f => f.name), ['start_on', 'valid_until', 'site_or_channel', 'scope_confirmation', 'evidence', 'reason']);
  assert.equal(replace.fields.find(f => f.name === 'start_on').value, p.commencement.start_on);
  assert.equal(replace.fields.find(f => f.name === 'evidence').value, undefined, 'دليل الإذن الجديد يُكتب من جديد');
  const withdraw = procurementUI.form('withdraw_commencement', p.id, data);
  assert.deepEqual(withdraw.fields.map(f => f.name), ['reason', 'evidence']);
  assert.equal(withdraw.endpoint, `/procurement/${p.id}/withdraw_commencement`);
  // طالب الشراء يرى حال الإذن وتاريخه، ولا يرى أزرار القرار ولا تُفتح له نماذجها.
  const ownData = { purchases: listProcurement(db, users.employee), projects: [project], user: users.employee };
  const own = procurementUI.render(ownData, context);
  assert.ok(own.includes('أمر المباشرة رقم 2'));
  assert.ok(!own.includes('>استبدال أمر المباشرة</button>') && !own.includes('>سحب أمر المباشرة</button>'));
  assert.throws(() => procurementUI.form('replace_commencement', p.id, ownData), /غير متاح/);
});

test('migration 162: an authorisation issued before it is carried as issued — no validity or evidence invented — and opens no receipt until replaced', t => {
  // قاعدة عند الترحيل 161 تُبنى كما يبنيها openDb، ويُكتب فيها إذنٌ بشكل الترحيل 116، ثم يُطبَّق 162 وحده بالطريقة نفسها.
  const raw = new DatabaseSync(':memory:');
  t.after(() => raw.close());
  raw.exec('PRAGMA foreign_keys=ON;');
  const apply = (version, sql) => { raw.exec('BEGIN'); try { raw.exec(sql); raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version, hash(sql)); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; } };
  const schema = readFileSync(new URL('../app/schema.sql', import.meta.url), 'utf8');
  raw.exec(schema);
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  const files = readdirSync(new URL('../app/migrations/', import.meta.url)).filter(name => /^\d{3}-.+\.sql$/.test(name)).sort();
  for (const file of files.filter(name => Number(name.slice(0, 3)) < 162)) apply(Number(file.slice(0, 3)), readFileSync(new URL('../app/migrations/' + file, import.meta.url), 'utf8'));
  seed(raw, PASSWORD);
  const users = Object.fromEntries(raw.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const project = transaction(raw, () => createProject(raw, users.manager, { name: 'مشروع ترقية مصطنع', brief: 'إذن مباشرة صدر قبل الترحيل 162', member_ids: ['employee'] }));
  fundProject(raw, project.id, 'CC-LEGACY', '1000.00');
  // الدورة حتى أمر الشراء بإدراجات خام تمر بحراس القاعدة كلها: كود المشتريات الحالي يقرأ جداول 162 فلا يعمل قبله.
  const origin = Date.now(), at = minute => new Date(origin - (60 - minute) * 60000).toISOString(), center = resolveCostCenter(raw, '36t', 'CC-LEGACY');
  const purchase = () => raw.prepare("SELECT * FROM procurement_purchases WHERE id='legacy-p'").get();
  raw.prepare(`INSERT INTO procurement_purchases(id,tenant_id,project_id,requester_id,title,specification,cost_center,cost_center_id,due_date,quantity,unit,currency,budget_minor,budget_evidence,status,version,created_at,updated_at)
    VALUES('legacy-p','36t',?,'employee','احتياج قبل الترحيل 162','يوما تصوير بطاقم ومعدات',?,?,'2099-10-20',2,'يوم','SAR',10000,'مخصص المشروع المعتمد','draft',1,?,?)`).run(project.id, center.text, center.id, at(0), at(0));
  raw.prepare(`INSERT INTO procurement_purchase_lines(id,purchase_id,line_no,description,quantity,unit,currency,unit_price_minor,price_source,purchase_version,created_at)
    VALUES('legacy-line','legacy-p',1,'يوما تصوير بطاقم ومعدات',2,'يوم','SAR',NULL,'not_priced',1,?)`).run(at(0));
  raw.prepare(`INSERT INTO procurement_line_allocations(id,purchase_id,purchase_line_id,position,cost_center_id,cost_center,amount_minor,currency,basis,purchase_version,created_at)
    VALUES('legacy-allocation','legacy-p','legacy-line',1,?,?,10000,'SAR','purchase_budget',1,?)`).run(center.id, center.text, at(0));
  raw.prepare("UPDATE procurement_purchases SET status='sourcing',version=2,updated_at=? WHERE id='legacy-p'").run(at(1));
  for (const [id, key, price] of [['legacy-q-a', 'SUPPLIER-A', 2000], ['legacy-q-b', 'SUPPLIER-B', 2500]]) {
    raw.prepare('INSERT INTO procurement_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, 'legacy-p', key, 'مورد ' + key, price, price * 2, 'مطابق للمواصفات', 'بعد الاستلام', '2099-10-20', 'عرض مصطنع محفوظ', 'employee', at(2));
    raw.prepare('INSERT INTO procurement_quote_lines(id,quote_id,purchase_id,purchase_line_id,line_no,description,quantity,unit,unit_price_minor,total_minor,currency,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id + '-line', id, 'legacy-p', 'legacy-line', 1, 'يوما تصوير بطاقم ومعدات', 2, 'يوم', price, price * 2, 'SAR', at(2));
  }
  transaction(raw, () => reservePurchaseBudget(raw, users.manager, purchase(), 4000));
  raw.prepare('INSERT INTO procurement_awards VALUES(?,?,?,?,?,?)').run('legacy-p', 'legacy-q-a', 'manager', 'ترسية مستقلة قبل الترحيل', 3, at(3));
  raw.prepare("UPDATE procurement_purchases SET status='awarded',version=3,updated_at=? WHERE id='legacy-p'").run(at(3));
  transaction(raw, () => commitPurchaseBudget(raw, users.manager, purchase(), 4000));
  raw.prepare('INSERT INTO procurement_orders(id,purchase_id,supplier_key,supplier_name,quantity,unit_price_minor,total_minor,currency,terms,delivery_date,approved_by,note,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('legacy-o', 'legacy-p', 'SUPPLIER-A', 'مورد SUPPLIER-A', 2, 2000, 4000, 'SAR', 'يوما تصوير', '2099-10-20', 'manager', 'اعتماد أمر قبل الترحيل', 4, at(4));
  raw.prepare('INSERT INTO procurement_order_lines(id,order_id,purchase_id,purchase_line_id,line_no,description,quantity,unit,unit_price_minor,total_minor,allocated_minor,currency,cost_center_id,cost_center,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('legacy-ol', 'legacy-o', 'legacy-p', 'legacy-line', 1, 'يوما تصوير بطاقم ومعدات', 2, 'يوم', 2000, 4000, 4000, 'SAR', center.id, center.text, 4, at(4));
  raw.prepare("UPDATE procurement_purchases SET status='ordered',version=4,updated_at=? WHERE id='legacy-p'").run(at(4));
  // تعديلٌ معتمد قبل الإذن وآخر بعده: نسخة الأمر التي صدر عليها الإذن 2، ونسخته اليوم 3.
  const change = raw.prepare(`INSERT INTO procurement_order_changes(id,tenant_id,purchase_id,order_id,kind,new_delivery_date,new_terms,reason,supplier_confirmation,requested_by,status,decided_by,decided_at,decision_note,created_at)
    VALUES(?,'36t','legacy-p','legacy-o','delivery_date',?,NULL,'طلب المورد تمديدًا مكتوبًا لموعد التسليم','بريد المورد المصطنع','employee','approved','manager',?,'تمديد معتمد',?)`);
  change.run('legacy-change-1', '2099-11-20', at(5), at(5));
  raw.prepare(`INSERT INTO commencement_authorisations(id,tenant_id,purchase_id,order_id,start_on,site_or_channel,scope_confirmation,issued_by,issued_at)
    VALUES('legacy-a','36t','legacy-p','legacy-o',?,'موقع التصوير المصطنع','يوما تصوير على الأمر المعتمد','manager',?)`).run(day(), at(6));
  change.run('legacy-change-2', '2099-12-20', at(7), at(7));

  apply(162, readFileSync(new URL('../app/migrations/' + files.find(name => name.startsWith('162-')), import.meta.url), 'utf8'));
  assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
  const carried = raw.prepare("SELECT * FROM commencement_authorisations WHERE id='legacy-a'").get();
  assert.deepEqual({ sequence: carried.sequence, order_version: carried.order_version, valid_until: carried.valid_until, evidence: carried.evidence,
    replaces_id: carried.replaces_id, issued_by: carried.issued_by, issued_at: carried.issued_at, start_on: carried.start_on, scope_confirmation: carried.scope_confirmation },
  { sequence: 1, order_version: 2, valid_until: null, evidence: null, replaces_id: null, issued_by: 'manager', issued_at: at(6), start_on: day(), scope_confirmation: 'يوما تصوير على الأمر المعتمد' });
  // لا يفتح استلامًا: بلا مدة سريان ولا دليل، والرفض يقول ذلك ويطلب الاستبدال — في الكود وفي القاعدة.
  assert.equal(commencementOf(raw, 'legacy-p').validity.state, 'incomplete');
  assert.equal(caught(() => requireSupplierStart(raw, purchase())).code, 'commencement_incomplete');
  assert.throws(() => directReceipt(raw, 'legacy-p', 'legacy-direct'), /receipt requires a valid commencement/);
  // ولا يُكتب بعد الترحيل إذنٌ ناقص مثله.
  assert.throws(() => insertAuthorisation(raw, { purchase_id: 'legacy-p', sequence: 2, order_id: 'legacy-o', order_version: 3, valid_until: null, evidence: null,
    replaces_id: 'legacy-a', replacement_reason: 'استبدال مباشر بلا سريان ولا دليل' }), /records a current validity and its evidence/);
  // والاستبدال بالمسار الحقيقي يفتح الاستلام على نسخة الأمر الحالية، والقديم يبقى بحاله.
  let p = listProcurement(raw, users.manager).find(x => x.id === 'legacy-p');
  assert.deepEqual(p.allowed_actions.filter(a => a.includes('commence')), ['replace_commencement', 'withdraw_commencement']);
  p = transaction(raw, () => procurementAction(raw, users.manager, 'legacy-p', 'replace_commencement', { version: p.version, ...AUTHORISE(), reason: 'أُعيد الإذن بمدة سريان ودليل بعد الترحيل 162' }));
  assert.equal(p.commencement.order_version, 3);
  p = transaction(raw, () => procurementAction(raw, users.employee, 'legacy-p', 'receive', { version: p.version, quantity: 1, reference: 'LEGACY-R-1', evidence: 'محضر استلام بعد استبدال الإذن القديم' }));
  assert.equal(p.status, 'part_received');
  assert.deepEqual(p.commencement_history.map(a => [a.sequence, a.state]), [[1, 'replaced'], [2, 'live']]);
  assert.deepEqual(raw.prepare("SELECT * FROM commencement_authorisations WHERE id='legacy-a'").get(), carried);
  assert.ok(verifyAudit(raw));
});
