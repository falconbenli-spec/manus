// الترحيل 152: من سجّل الاستلام لا يعتمد المطابقة المبنية عليه — 29 سبتمبر 2026.
//
// ما يجب أن يثبت هنا شيئان. الأول أن الترحيل يُطبَّق على قاعدة نظيفة فتبقى سليمة: تكامل الملف،
// ولا مفتاح أجنبي معلق، والمُطلِق واحد باسمه لا اثنان. والثاني أن الشرط المضاف هو الوحيد الذي تغيّر:
// الحالات التي كان 141 يمنعها تبقى ممنوعة بالرسالة نفسها، والحالة السليمة — من لم يستلم ولم يسجّل
// الفاتورة ولم يطلب الشراء — تبقى تمر. فرقُ الترحيل يُقاس على السلوك لا على نصّ المُطلِق.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import { fundProject } from './budget-fixture.mjs';
import { approveVendor } from './vendor-fixture.mjs';

const STAMP = '2026-09-29T09:00:00.000Z';
// الاستلام يُسجَّل اليوم، فأمر المباشرة يبدأ اليوم: الإذن الذي لم يبدأ سريانه لا يفتح استلامًا (الترحيل 162).
const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

function fresh(t) {
  const db = openDb(':memory:');
  t.after(() => db.close());
  return db;
}

test('migration 152: applies cleanly and leaves one match guard carrying the receipt condition', t => {
  const db = fresh(t);
  assert.equal(db.prepare('SELECT 1 AS applied FROM schema_migrations WHERE version=152').get()?.applied, 1);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const guards = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='procurement_match_guard'").all();
  assert.equal(guards.length, 1, 'the guard is replaced, not duplicated');
  assert.match(guards[0].sql, /procurement_receipts r WHERE r\.purchase_id=p\.id AND r\.received_by=NEW\.matched_by/);
  // الشروط التي جاء بها 141 باقية بحرفها: الترحيل يزيد شرطًا ولا يعيد كتابة المطابقة الثلاثية.
  assert.match(guards[0].sql, /NEW\.matched_by<>p\.requester_id AND NEW\.matched_by<>i\.recorded_by/);
  assert.match(guards[0].sql, /three way match requires receipt and independent approval/);
});

// المُطلِق وحده: الدورة تُبنى بالوحدات كما تُبنى في التشغيل (حراس 005 و010 و141 على الطريق كلها)، ثم
// يُدرج المستحق **بـSQL خام** بأسماء معتمدين مختلفة. فالمقيس هنا حارس القاعدة لا حارس app/procurement.mjs:
// إدراج مباشر من سكربت أو إصلاح يدوي لا يمر على الكود إطلاقًا.
function cycle(t) {
  const db = openDb(':memory:');
  seed(db, 'synthetic-migration-152-test-only');
  t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  for (const key of ['SUPPLIER-A', 'SUPPLIER-B', 'SUPPLIER-C']) approveVendor(db, key);
  const project = transaction(db, () => createProject(db, users.manager, { name: 'مشروع ترحيل مصطنع', brief: 'اختبار حارس المطابقة في القاعدة', member_ids: ['employee'] }));
  fundProject(db, project.id, 'SYNTHETIC-CC-1');
  const act = (who, p, action, values = {}) => transaction(db, () => procurementAction(db, users[who], p.id, action, { version: p.version, ...values }));
  const start = () => {
    let p = transaction(db, () => createPurchase(db, users.employee, { project_id: project.id, title: 'احتياج مصطنع', specification: 'وحدتان للاختبار بالمواصفات المحددة', cost_center: 'SYNTHETIC-CC-1', due_date: '2099-10-20', quantity: 2, unit: 'وحدة', budget_amount: '100.00', budget_evidence: 'مخصص اختبار داخلي قدره مئة ريال', currency: 'SAR' }));
    p = act('employee', p, 'submit');
    for (const [key, price] of [['supplier-a', '10.00'], ['supplier-b', '11.00'], ['supplier-c', '12.00']]) {
      p = act('employee', p, 'add_quote', { supplier_key: key, supplier_name: 'مورد اختبار ' + key, unit_price: price, technical_assessment: 'العرض يطابق المواصفات المسجلة', financial_terms: 'استحقاق بعد الاستلام والمطابقة', delivery_date: '2099-10-20', evidence: 'عرض مصطنع محفوظ برقم ' + key });
    }
    p = act('manager', p, 'award', { quote_id: p.quotes.find(q => q.supplier_key === 'SUPPLIER-A').id, note: 'اخترنا العرض الموافق والأقل وأكدنا المخصص' });
    p = act('manager', p, 'approve_order', { terms: 'تسليم داخلي بعد التحقق من الجودة', delivery_date: '2099-10-20', note: 'اعتماد نسخة أمر محلي دون إرسال إلى المورد' });
    return act('manager', p, 'commence', { start_on: today(), valid_until: '2099-12-31', site_or_channel: 'موقع المورد المصطنع', scope_confirmation: 'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر الداخلي', evidence: 'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام' });
  };
  const payable = (p, matcher, id) => db.prepare('INSERT INTO procurement_payables(id,purchase_id,invoice_id,amount_minor,currency,matched_by,note,purchase_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, p.id, p.invoices[0].id, p.invoices[0].amount_minor, 'SAR', matcher, 'مطابقة مصطنعة بإدخال مباشر', p.version, STAMP);
  return { db, act, start, payable };
}

const REFUSED = /three way match requires receipt and independent approval/;

test('migration 152: the guard alone refuses a payable approved by whoever recorded a receipt', t => {
  const { db, act, start, payable } = cycle(t);
  // صاحب الطلب هو المستلم: الحالة التي كان 141 يمسكها أصلًا (requester و recorded_by).
  let a = start();
  a = act('employee', a, 'receive', { quantity: 2, reference: 'receipt-a', evidence: 'استلام وحدتين وفحصهما محليًا' });
  a = act('employee', a, 'record_invoice', { supplier_reference: 'invoice-a', quantity: 2, amount: '20.00', evidence: 'مرجع مورد مصطنع لوحدتين' });
  assert.throws(() => payable(a, 'employee', 'pay-a-self'), REFUSED);
  // ومن لم يستلم ولم يسجّل ولم يطلب يمر كما كان: الترحيل يوسّع الممنوع ولا يقفل المسار السليم.
  payable(a, 'manager', 'pay-a-ok');
  assert.equal(db.prepare("SELECT matched_by FROM procurement_payables WHERE id='pay-a-ok'").get().matched_by, 'manager');

  // الحالة التي جاء لها 152: المراجع نفسه يسجّل الاستلام، وصاحب الطلب يسجّل الفاتورة. الشرطان القديمان
  // يمرّان عليه (ليس صاحب الطلب ولا مسجّل الفاتورة)، فكان المستحق يُنشأ قبل هذا الترحيل.
  let b = start();
  b = act('manager', b, 'receive', { quantity: 2, reference: 'receipt-b', evidence: 'استلام سجّله المراجع نفسه' });
  b = act('employee', b, 'record_invoice', { supplier_reference: 'invoice-b', quantity: 2, amount: '20.00', evidence: 'مرجع مورد مصطنع سجّله صاحب الطلب' });
  assert.throws(() => payable(b, 'manager', 'pay-b-receiver'), REFUSED);
  assert.throws(() => payable(b, 'employee', 'pay-b-requester'), REFUSED);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM procurement_payables WHERE purchase_id=?").get(b.id).n, 0);
  // ويبقى للطلب مخرج: مراجع ثالث لم يستلم ولم يسجّل الفاتورة.
  payable(b, 'outsider', 'pay-b-independent');
  assert.equal(db.prepare("SELECT matched_by FROM procurement_payables WHERE id='pay-b-independent'").get().matched_by, 'outsider');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
