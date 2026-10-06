// الحزمة 3 — اكتمال الأستاذ العام: من المستند إلى القيد، وتتبّع كل مبلغ إلى مصدره ومعتمده وترحيله وتسويته وعكسه.
// لماذا هذا الملف: جردٌ للقراءة فقط على 7ee08cd ثم مسبارٌ على الشجرة نفسها (docs/testing/p3-ledger-completeness-probe-20260930.txt)
// أثبتا ست فجوات: فاتورة المورد ليست مصدرًا للدفتر (المسار الوحيد قيد بسطرين بالإجمالي بلا ضريبة مدخلات)، والمستحق غير
// المرحّل لا يظهر في «بانتظار الترحيل» فيصير حساب الموردين مدينًا بصمت، والدفعات المقدمة بلا قيد، ولا مطابقة بين الأستاذ
// المساعد والحساب الرقابي، ولا تتبّع لمبلغ، وحالة الدفع في الدفتر نصّ ثابت «غير مدفوع». كل اختبار هنا يقيس واحدة منها.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import * as f from '../app/finance.mjs';
import * as ledger from '../app/ledger.mjs';
import { registerSourceKind, registerSourceLink, sourceKinds, sourceKind } from '../app/ledger-sources.mjs';
import { runReport } from '../app/reports.mjs';
import { createBankAccount, saveImportProfile, importStatement, proposeMatch, decideMatch } from '../app/bank-reconciliation.mjs';
import { createClient } from '../app/agency.mjs';
import * as billing from '../app/billing-recurring.mjs';
import { login } from '../app/auth.mjs';
import { createApp } from '../app/server.mjs';
import { statementsUI } from '../app/static/statements-ui.mjs';
import { financeUI } from '../app/static/finance-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { money } from '../app/static/operations.mjs';
import { ledgerMonth, code } from './ledger-fixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'tests/ledger-completeness-worker.mjs');
const linesOf = (db, journalId) => db.prepare('SELECT l.debit_minor,l.credit_minor,a.code,c.code AS centre FROM finance_lines l JOIN finance_accounts a ON a.id=l.account_id JOIN finance_cost_centers c ON c.id=l.cost_center_id WHERE l.journal_id=? ORDER BY l.position').all(journalId)
  .map(l => [l.code, l.centre, l.debit_minor, l.credit_minor]);
const balanceOf = (db, accountCode) => db.prepare("SELECT COALESCE(SUM(l.debit_minor)-SUM(l.credit_minor),0) AS n FROM finance_lines l JOIN finance_journals j ON j.id=l.journal_id JOIN finance_accounts a ON a.id=l.account_id WHERE j.status='posted' AND a.code=?").get(accountCode).n;
const control = (report, key) => report.controls.find(c => c.key === key);
const thrown = run => { try { run(); } catch (error) { return error; } assert.fail('expected a refusal'); };

/* ───── (1) السجل: الأنواع القائمة كما هي، والجديدة، ونوعٌ يسجّله ملف آخر ───── */
test('registry: every existing source kind is held unchanged, the new kinds join it, and another file can register its own kind', t => {
  const m = ledgerMonth(t);
  const existing = ['tax_invoice', 'credit_note', 'ar_receipt', 'payroll_run', 'supplier_payment', 'payroll_payment', 'expense_claim', 'expense_reimbursement', 'custody_issue', 'custody_return', 'depreciation_run', 'year_close', 'withholding'];
  const keys = sourceKinds().map(k => k.key);
  for (const key of [...existing, 'supplier_invoice', 'advance_receipt', 'advance_draw', 'advance_reversal']) assert.ok(keys.includes(key), `${key} is registered`);
  assert.deepEqual(ledger.SOURCE_KINDS.map(k => k.key).slice(0, existing.length), existing, 'the managed list keeps its original order and names');
  assert.equal(sourceKind('tax_invoice').module, 'ledger');
  assert.equal(ledger.registerSourceKind, registerSourceKind, 'ledger.mjs re-exports the one registry');
  assert.throws(() => registerSourceKind({ key: 'tax_invoice', name: 'مكرر', module: 'test', build: () => null }), TypeError, 'a key lives in one module');
  assert.throws(() => registerSourceKind({ key: 'Bad-Key', name: 'خطأ', module: 'test', build: () => null }), TypeError);
  assert.throws(() => registerSourceKind({ key: 'no_builder_kind', name: 'بلا قارئ', module: 'test' }), TypeError, 'a kind without a builder cannot post anything');
  // نوعٌ من ملف آخر — كما سيسجّل فريق البنك سطور الكشف المصنّفة: يبني قيده من سجله، ويمرّ بالاعتماد والترحيل المستقلين.
  const fees = new Map([['fee-1', { date: m.day, amount_minor: 2500 }]]);
  registerSourceKind({ key: 'test_bank_fee', name: 'رسوم بنكية مصنّفة (اختبار)', module: 'tests/ledger-completeness',
    build: (db, u, id) => { const x = db === m.db ? fees.get(id) : null; return x ? { date: x.date, reference: `FEE-${id}`, description: 'رسوم بنكية مصنّفة مصطنعة', lines: [{ purpose: 'supplier_cost', debit_minor: x.amount_minor, credit_minor: 0, memo: 'رسوم بنكية' }, { purpose: 'bank', debit_minor: 0, credit_minor: x.amount_minor, memo: 'خصم البنك' }] } : null; },
    // السجل عامّ في العملية كلها، فالنوع التجريبي يقرأ قاعدته وحدها ولا يظهر في اختبارات تالية.
    pending: db => db === m.db ? [...fees].map(([id, x]) => ({ source_id: id, reference: `FEE-${id}`, amount_minor: x.amount_minor, date: x.date })) : [] });
  const j = m.journal('test_bank_fee', 'fee-1');
  assert.deepEqual(linesOf(m.db, j.id), [['5200', 'GEN', 2500, 0], ['1000', 'GEN', 0, 2500]]);
  assert.throws(() => m.journal('test_bank_fee', 'fee-1'), code('duplicate_source'));
  assert.ok(ledger.statements(m.db, m.users.manager).sources.some(s => s.source_kind === 'test_bank_fee' && s.journal_status === 'draft'), 'a late kind is listed with the others');
  // والنوع المجهول ما زال يُرفض برمز القائمة المُدارة نفسه (tests/options-conversions.test.mjs).
  assert.equal(thrown(() => m.journal('no_such_kind', 'x')).code, 'option_not_offered');
});

/* ───── (2) فاتورة المورد مصدرًا: صافٍ لكل مركز، وضريبة مدخلات، والتزام بالإجمالي ───── */
test('supplier invoice: net per cost centre, input VAT from the verified record, the gross liability — one balanced journal in minor units', t => {
  const m = ledgerMonth(t);
  const { payable, invoice } = m.matchedPayable({ gross: '1150.00', split: [['CC-A', 69000], ['CC-B', 46000]] });
  m.inputTax(invoice.id, '150.00');
  const j = m.journal('supplier_invoice', payable.id);
  assert.deepEqual(linesOf(m.db, j.id), [['5200', 'CC-A', 60000, 0], ['5200', 'CC-B', 40000, 0], ['1150', 'GEN', 15000, 0], ['2000', 'GEN', 0, 115000]],
    'the VAT is spread over the allocations in proportion, so each centre carries its net and the two nets add up to the invoice net');
  assert.ok(j.lines.every(l => Number.isInteger(l.debit_minor) && Number.isInteger(l.credit_minor)));
  // الهوية: قيد المستحق نفسه الذي يقرؤه كل الباقي (المشتريات وقائمة إقفال المشروع ودفتر المالية) — لا جدول ربط ثالث.
  const row = m.db.prepare('SELECT source_kind,source_id FROM finance_journals WHERE id=?').get(j.id);
  assert.deepEqual({ ...row }, { source_kind: 'procurement_payable', source_id: payable.id });
  assert.equal(m.db.prepare('SELECT amount_minor FROM finance_payable_links WHERE payable_id=?').get(payable.id).amount_minor, 115000);
  assert.equal(m.db.prepare("SELECT journal_id FROM finance_source_links WHERE source_kind='supplier_invoice' AND source_id=?").get(payable.id).journal_id, j.id);
  assert.equal(f.listFinance(m.db, m.users.employee).eligible_payables.find(p => p.id === payable.id).journal_id, j.id, 'the finance screen sees the posting through the payable link it always read');
  // السطور تتبع المستند ولا تُعدَّل يدويًا، ولا يعتمد المُعدّ قيده.
  const tampered = { period_id: m.period.id, entry_date: j.entry_date, description: j.description, evidence: j.evidence, currency: 'SAR', source_reference: j.source_reference,
    lines: [{ account_id: m.accounts.supplier_cost.id, cost_center_id: m.centres['CC-A'].id, debit: '1150.00', credit: '0', memo: 'بالإجمالي' }, { account_id: m.accounts.payable.id, cost_center_id: m.centres.GEN.id, debit: '0', credit: '1150.00', memo: 'التزام' }] };
  assert.throws(() => m.tx(() => f.journalAction(m.db, m.users.employee, j.id, 'edit', { version: j.version, ...tampered })), code('source_mismatch'));
  const posted = m.post(j);
  assert.equal(posted.status, 'posted');
  assert.deepEqual([balanceOf(m.db, '2000'), balanceOf(m.db, '1150'), balanceOf(m.db, '5200')], [-115000, 15000, 100000]);
  assert.ok(verifyAudit(m.db));
});

test('supplier invoice: not ready until the VAT position is known, and a supplier outside the VAT register posts gross to cost', t => {
  const m = ledgerMonth(t);
  const a = m.matchedPayable({ gross: '1150.00' });
  const missing = thrown(() => m.journal('supplier_invoice', a.payable.id));
  assert.equal(missing.code, 'input_tax_missing', 'a VAT-registered supplier with no tax record is not a journal yet');
  assert.ok(missing.details.refusal.missing[0].owner.length > 0);
  m.inputTax(a.invoice.id, '150.00', { verify: false });
  assert.equal(thrown(() => m.journal('supplier_invoice', a.payable.id)).code, 'input_tax_pending', 'a recorded but unverified VAT amount waits for the second person');
  assert.equal(m.db.prepare("SELECT COUNT(*) AS n FROM finance_source_links WHERE source_kind='supplier_invoice'").get().n, 0, 'nothing reached the ledger');
  // مورد بلا رقم ضريبي: لا ضريبة مدخلات، والتكلفة بالإجمالي.
  m.db.prepare('UPDATE vendors SET vat_number=NULL,version=version+1 WHERE id=?').run(m.winner.id);
  const b = m.matchedPayable({ gross: '575.00' });
  const j = m.journal('supplier_invoice', b.payable.id);
  assert.deepEqual(linesOf(m.db, j.id), [['5200', 'CC-A', 57500, 0], ['2000', 'GEN', 0, 57500]]);
});

test('supplier invoice: one payable, one journal — the old manual path is closed, its journals stay readable, and a trigger refuses a second path', t => {
  const m = ledgerMonth(t);
  const a = m.matchedPayable({ gross: '1150.00' });
  m.inputTax(a.invoice.id, '150.00');
  const legacyInput = { payable_id: a.payable.id, period_id: m.period.id, entry_date: m.day, description: 'قيد المستحق المصدر', evidence: 'ربط قديم', debit_account_id: m.accounts.supplier_cost.id, credit_account_id: m.accounts.payable.id, cost_center_id: m.centres['CC-A'].id };
  const closed = thrown(() => m.tx(() => f.createJournalFromPayable(m.db, m.users.employee, legacyInput)));
  assert.equal(closed.code, 'payable_source_moved');
  assert.match(closed.details.refusal.next, /القوائم المالية/);
  // قيد قديم كتبه المسار اليدوي قبل هذا التغيير: يُكتب هنا بالجداول نفسها كما كانت تكتبه المنصة.
  const jid = randomUUID(), time = now();
  m.tx(() => {
    m.db.prepare("INSERT INTO finance_journals(id,tenant_id,period_id,entry_date,description,evidence,currency,source_kind,source_id,source_reference,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'SAR','procurement_payable',?,?,?,?,?)")
      .run(jid, '36t', m.period.id, m.day, 'قيد قديم بالإجمالي', 'قيد سابق للتغيير', a.payable.id, 'LOCAL-A/INV-OLD', 'employee', time, time);
    m.db.prepare('INSERT INTO finance_lines VALUES(?,?,?,?,?,?,?,?)').run(jid, '36t', 1, m.accounts.supplier_cost.id, m.centres['CC-A'].id, 115000, 0, 'قديم');
    m.db.prepare('INSERT INTO finance_lines VALUES(?,?,?,?,?,?,?,?)').run(jid, '36t', 2, m.accounts.payable.id, m.centres['CC-A'].id, 0, 115000, 'قديم');
    m.db.prepare('INSERT INTO finance_payable_links VALUES(?,?,?,?,?,?,?)').run(a.payable.id, jid, 115000, 'SAR', 'employee', 'قديم', time);
  });
  assert.equal(f.listFinance(m.db, m.users.employee).eligible_payables.find(p => p.id === a.payable.id).journal_id, jid, 'the old journal stays readable where it always was');
  const twice = thrown(() => m.journal('supplier_invoice', a.payable.id));
  assert.equal(twice.code, 'duplicate_source', 'the code refuses a second path for the same payable');
  assert.ok(ledger.statements(m.db, m.users.manager).sources.find(s => s.source_kind === 'supplier_invoice' && s.source_id === a.payable.id).journal_status === 'draft', 'the pending list reads the old journal as this payable’s journal');
  // والقاعدة ترفض ما يتجاوز الكود: رابط مصدر لقيد ليس قيد المستحق.
  const other = m.tx(() => f.createJournal(m.db, m.users.employee, { period_id: m.period.id, entry_date: m.day, description: 'قيد يدوي آخر', evidence: 'اختبار المحفّز', currency: 'SAR', source_reference: 'MANUAL-TRIGGER', lines: [{ account_id: m.accounts.supplier_cost.id, cost_center_id: m.centres.GEN.id, debit: '1.00', credit: '0', memo: 'x' }, { account_id: m.accounts.payable.id, cost_center_id: m.centres.GEN.id, debit: '0', credit: '1.00', memo: 'x' }] }));
  const b = m.matchedPayable({ gross: '575.00' });
  assert.throws(() => m.db.prepare("INSERT INTO finance_source_links VALUES('supplier_invoice',?,'36t',?,'[]','employee',?)").run(b.payable.id, other.id, now()), /supplier invoice posts through its own payable link/);
  assert.throws(() => m.db.prepare("INSERT INTO finance_source_links VALUES('tax_invoice','x-tenant','isolated',?,'[]','employee',?)").run(other.id, now()), /own tenant/);
});

/* ───── (3) الدفعات المقدمة: قبض وسحب على فاتورة وارتداد ───── */
test('customer advances: receipt, each draw application and reversal become journals, and the control reads net of reversals', t => {
  const m = ledgerMonth(t);
  const advance = m.paidAdvance({ amount: '5000.00' });
  const receipt = m.post(m.journal('advance_receipt', advance.id));
  assert.deepEqual(linesOf(m.db, receipt.id), [['1000', 'GEN', 500000, 0], ['2400', 'GEN', 0, 500000]]);
  // سحب جزئي مرتين على السحب نفسه: حدثان، وقيدان، ولا يُرحَّل الحدث مرتين.
  const planned = m.tx(() => billing.planDraw(m.db, m.users.manager, advance.id, { target_reference: 'INV-ADV-1', amount: '2000.00' }));
  let row = m.db.prepare('SELECT * FROM advance_draws WHERE id=?').get(planned.id);
  m.tx(() => billing.applyDraw(m.db, m.users.manager, planned.id, { version: row.version, amount: '1200.00', note: '' }));
  row = m.db.prepare('SELECT * FROM advance_draws WHERE id=?').get(planned.id);
  m.tx(() => billing.applyDraw(m.db, m.users.manager, planned.id, { version: row.version, amount: '800.00', note: 'ما تبقى' }));
  const events = m.db.prepare('SELECT * FROM advance_draw_applications WHERE draw_id=? ORDER BY cumulative_minor').all(planned.id);
  assert.deepEqual(events.map(e => [e.amount_minor, e.cumulative_minor, e.origin]), [[120000, 120000, 'applied'], [80000, 200000, 'applied']]);
  assert.throws(() => m.db.prepare('UPDATE advance_draw_applications SET amount_minor=1 WHERE id=?').run(events[0].id), /never edited/);
  assert.throws(() => m.db.prepare("INSERT INTO advance_draw_applications VALUES('forged','36t',?,?,5,5,?,'applied',?)").run(planned.id, advance.id, now(), now()), /mirrors its draw/);
  for (const e of events) {
    const j = m.post(m.journal('advance_draw', e.id));
    assert.deepEqual(linesOf(m.db, j.id), [['2400', 'GEN', e.amount_minor, 0], ['1100', 'GEN', 0, e.amount_minor]], 'the draw settles the later invoice’s receivable from the advance');
  }
  assert.throws(() => m.journal('advance_draw', events[0].id), code('duplicate_source'));
  const reversal = m.reverseAdvance(advance.id, '1000.00');
  const rj = m.post(m.journal('advance_reversal', reversal.id));
  assert.deepEqual(linesOf(m.db, rj.id), [['2400', 'GEN', 100000, 0], ['1000', 'GEN', 0, 100000]]);
  const advances = control(ledger.controlReconciliation(m.db, '36t', m.day), 'customer_advances');
  assert.deepEqual([advances.subledger_minor, advances.ledger_minor, advances.difference_minor], [200000, 200000, 0], 'paid 5000 less drawn 2000 less reversed 1000, the way billing-recurring and the closure checklist read it');
  assert.equal(balanceOf(m.db, '2400'), -200000);
});

test('migration 167 upgrade: draws applied before it become one opening event each, and later applications are captured by the trigger', t => {
  const dir = mkdtempSync(join(tmpdir(), '36t-ledger-167-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(join(dir, 'upgrade.sqlite'));
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(join(ROOT, 'app/schema.sql'), 'utf8'));
  const files = readdirSync(join(ROOT, 'app/migrations')).filter(n => /^\d{3}-.+\.sql$/.test(n)).sort();
  for (const file of files.filter(n => Number(n.slice(0, 3)) < 167)) db.exec(readFileSync(join(ROOT, 'app/migrations', file), 'utf8'));
  seed(db, 'synthetic-ledger-upgrade');
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u])), tx = run => transaction(db, run);
  for (const user_id of ['manager', 'outsider']) tx(() => grantAccess(db, users.admin, { user_id, capability: 'billing.recurring.manage', note: 'تصريح ترقية مصطنع' }));
  const client = tx(() => createClient(db, users.manager, { legal_name: 'عميل ترقية مصطنع', trade_name: 'مصطنع', sector: 'تجريبي', status: 'active', notes: '' }));
  const { id } = tx(() => billing.recordAdvance(db, users.manager, { client_id: client.id, schedule_id: '', description: 'دفعة مقدمة قبل الترحيل', agreement_reference: 'بند مصطنع 1-1', amount: '900.00' }));
  tx(() => billing.confirmAdvance(db, users.outsider, id, { version: 1, amount: '900.00', received_on: '2026-09-01', evidence: 'كشف حساب مصطنع قبل الترقية', reference: 'TRF-UPGRADE-1' }));
  // السحب القائم قبل 167 يُكتب صفًّا كما كانت البيانات فعلًا، لا بكود اليوم: كود اليوم يقرأ ما أضافته ترحيلات بعد 167
  // (منظور التحصيل في 170، وربط السحب باستحقاقه في 177)، فتشغيله على مخطط 166 يختبر مخططًا لا وجود له في أي تشغيل.
  const at = '2026-09-02T08:00:00.000Z', planned = { id: 'draw-before-167' };
  db.prepare("INSERT INTO advance_draws(id,tenant_id,advance_id,target_reference,amount_minor,applied_minor,status,requested_by,version,created_at,updated_at) VALUES(?,'36t',?,'INV-UPGRADE',60000,25000,'partial','manager',2,?,?)")
    .run(planned.id, id, at, at);
  db.exec(readFileSync(join(ROOT, 'app/migrations', files.find(n => n.startsWith('167-'))), 'utf8'));
  const opening = db.prepare('SELECT * FROM advance_draw_applications WHERE draw_id=?').all(planned.id);
  assert.deepEqual(opening.map(e => [e.amount_minor, e.cumulative_minor, e.origin]), [[25000, 25000, 'opening_balance']]);
  const version = db.prepare('SELECT version FROM advance_draws WHERE id=?').get(planned.id).version;
  tx(() => billing.applyDraw(db, users.manager, planned.id, { version, amount: '100.00', note: '' }));
  assert.deepEqual(db.prepare('SELECT amount_minor,cumulative_minor,origin FROM advance_draw_applications WHERE draw_id=? ORDER BY cumulative_minor').all(planned.id).map(e => [e.amount_minor, e.cumulative_minor, e.origin]),
    [[25000, 25000, 'opening_balance'], [10000, 35000, 'applied']]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_foreign_key_check").get().n, 0);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});

/* ───── (4) المستحق غير المرحّل يحجز حزمة الإقفال ───── */
test('pending sources: an unposted supplier liability is listed and blocks the monthly close pack like any other unposted document', t => {
  const m = ledgerMonth(t);
  const a = m.matchedPayable({ gross: '1150.00' });
  m.inputTax(a.invoice.id, '150.00');
  let s = ledger.statements(m.db, m.users.manager);
  const row = s.sources.find(x => x.source_kind === 'supplier_invoice' && x.source_id === a.payable.id);
  assert.ok(row, 'the matched payable is a document the ledger reads');
  assert.deepEqual([row.amount_minor, row.journal_status, row.reference], [115000, null, 'INV-1']);
  assert.equal(s.unposted, 1);
  const pack = runReport(m.db, m.users.manager, 'R35', { from: `${m.month}-01`, to: m.day });
  const blocking = pack.rows.filter(r => r.check === 'مستند بلا قيد مرحّل');
  assert.ok(blocking.some(r => r.detail === 'INV-1' && r.item === 'فاتورة مورد مطابقة' && r.blocking === 'نعم'), 'the close pack names the unposted liability');
  m.post(m.journal('supplier_invoice', a.payable.id));
  s = ledger.statements(m.db, m.users.manager);
  assert.equal(s.unposted, 0);
  assert.equal(runReport(m.db, m.users.manager, 'R35', { from: `${m.month}-01`, to: m.day }).rows.filter(r => r.check === 'مستند بلا قيد مرحّل').length, 0);
});

/* ───── (5) مطابقة الأستاذ المساعد بالحساب الرقابي ───── */
function syntheticMonth(t) {
  const m = ledgerMonth(t);
  const ar = m.issuedInvoice({ amount: '115.00' });
  m.post(m.journal('tax_invoice', ar.invoice.id));
  const note = ar.creditNote('23.00');
  m.post(m.journal('credit_note', note.id));
  const receipt = ar.receipt('42.00');
  m.post(m.journal('ar_receipt', receipt.id));
  const advance = m.paidAdvance({ amount: '500.00' });
  m.post(m.journal('advance_receipt', advance.id));
  const draw = m.draw(advance.id, ar.invoice.number, '50.00');
  const application = m.db.prepare('SELECT * FROM advance_draw_applications WHERE draw_id=?').get(draw.id);
  m.post(m.journal('advance_draw', application.id));
  const reversal = m.reverseAdvance(advance.id, '100.00');
  m.post(m.journal('advance_reversal', reversal.id));
  const p1 = m.matchedPayable({ gross: '1150.00', split: [['CC-A', 69000], ['CC-B', 46000]] });
  m.inputTax(p1.invoice.id, '150.00');
  m.post(m.journal('supplier_invoice', p1.payable.id));
  const order = m.pay(p1.payable.id);
  m.post(m.journal('supplier_payment', order.id));
  const p2 = m.matchedPayable({ gross: '575.00' });
  m.inputTax(p2.invoice.id, '75.00');
  m.post(m.journal('supplier_invoice', p2.payable.id));
  return { ...m, ar, note, receipt, advance, draw, application, reversal, p1, p2, order };
}

test('control reconciliation: AR, AP, input VAT, output VAT and customer advances tie to their control accounts after a synthetic month, and the trial balance balances', t => {
  const m = syntheticMonth(t);
  const report = ledger.controlReconciliation(m.db, '36t', m.day);
  const expected = { receivable: 0, payable: 57500, input_vat: 22500, output_vat: 1200, customer_advances: 35000 };
  for (const [key, amount] of Object.entries(expected)) {
    const c = control(report, key);
    assert.ok(c, `${key} is reconciled`);
    assert.deepEqual([c.subledger_minor, c.ledger_minor, c.difference_minor, c.items.length], [amount, amount, 0, 0], `${key}: sub-ledger ${c.subledger_minor}, ledger ${c.ledger_minor}`);
    assert.equal(c.mapped, true);
  }
  assert.equal(report.balanced, true);
  const finance = f.listFinance(m.db, m.users.manager);
  assert.equal(finance.trial_balance.is_balanced, true);
  assert.equal(finance.trial_balance.total_debit_minor, finance.trial_balance.total_credit_minor);
  assert.equal(ledger.statements(m.db, m.users.manager).balance_sheet.balanced, true);
  assert.ok(verifyAudit(m.db));
});

test('control reconciliation: every difference is itemised to a document or a journal, and the items add up to the difference', t => {
  const m = syntheticMonth(t);
  const p3 = m.matchedPayable({ gross: '230.00' });
  m.inputTax(p3.invoice.id, '30.00');
  const p4 = m.matchedPayable({ gross: '115.00' });
  m.inputTax(p4.invoice.id, '15.00');
  const draft = m.journal('supplier_invoice', p4.payable.id);
  const manual = m.post(m.tx(() => f.createJournal(m.db, m.users.employee, { period_id: m.period.id, entry_date: m.day, description: 'تسوية يدوية مصطنعة على الموردين', evidence: 'مذكرة مصطنعة', currency: 'SAR', source_reference: 'MAN-AP-1',
    lines: [{ account_id: m.accounts.supplier_cost.id, cost_center_id: m.centres.GEN.id, debit: '1.00', credit: '0', memo: 'تصحيح' }, { account_id: m.accounts.payable.id, cost_center_id: m.centres.GEN.id, debit: '0', credit: '1.00', memo: 'تصحيح' }] })));
  const ap = control(ledger.controlReconciliation(m.db, '36t', m.day), 'payable');
  assert.equal(ap.subledger_minor, 57500 + 23000 + 11500);
  assert.equal(ap.ledger_minor, 57500 + 100);
  assert.equal(ap.difference_minor, ap.subledger_minor - ap.ledger_minor);
  assert.equal(ap.items.reduce((n, i) => n + i.difference_minor, 0), ap.difference_minor, 'nothing unexplained');
  const byReason = Object.fromEntries(ap.items.map(i => [i.reason, i]));
  assert.deepEqual([byReason.no_journal.source_id, byReason.no_journal.difference_minor], [p3.payable.id, 23000]);
  assert.deepEqual([byReason.journal_not_posted.journal_id, byReason.journal_not_posted.difference_minor], [draft.id, 11500]);
  assert.deepEqual([byReason.no_document.journal_id, byReason.no_document.difference_minor], [manual.id, -100]);
  const vat = control(ledger.controlReconciliation(m.db, '36t', m.day), 'input_vat');
  assert.equal(vat.difference_minor, 3000 + 1500);
  assert.equal(vat.items.reduce((n, i) => n + i.difference_minor, 0), vat.difference_minor);
  // العكس بلا قيد بعده: المستحق باقٍ في الأستاذ المساعد وقيده صار صفرًا في الدفتر، فيظهر فرقًا مسمّى بسببه.
  const p2Journal = m.db.prepare("SELECT journal_id FROM finance_source_links WHERE source_kind='supplier_invoice' AND source_id=?").get(m.p2.payable.id).journal_id;
  m.reverse(f.listFinance(m.db, m.users.manager).journals.find(j => j.id === p2Journal));
  const afterReversal = ledger.controlReconciliation(m.db, '36t', m.day);
  const reversedAp = control(afterReversal, 'payable').items.find(i => i.reason === 'reversed');
  assert.deepEqual([reversedAp.source_id, reversedAp.difference_minor, reversedAp.journal_id], [m.p2.payable.id, 57500, p2Journal]);
  assert.equal(control(afterReversal, 'input_vat').items.find(i => i.reason === 'reversed').difference_minor, 7500);
  for (const c of afterReversal.controls) assert.equal(c.items.reduce((n, i) => n + i.difference_minor, 0), c.difference_minor, `${c.key}: still fully itemised`);
  // وما صدر بعد تاريخ المطابقة لا يدخلها: الحساب في آخر اليوم السابق لا يرى شيئًا من الشهر.
  const before = new Date(Date.parse(`${m.month}-01T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const earlier = ledger.controlReconciliation(m.db, '36t', before);
  assert.ok(earlier.controls.every(c => c.subledger_minor === 0 && c.ledger_minor === 0 && c.items.length === 0));
});

test('control reconciliation: read-only, finance-scoped and tenant-isolated', t => {
  const m = syntheticMonth(t);
  const board = ledger.controlBoard(m.db, m.users.manager, { to: m.day });
  assert.equal(board.as_of, m.day);
  assert.equal(control(board, 'payable').ledger_minor, 57500);
  for (const who of ['hr', 'admin', 'external']) assert.throws(() => ledger.controlBoard(m.db, m.users[who], {}), code('ledger_access_denied'));
  const isolated = ledger.controlReconciliation(m.db, 'isolated', m.day);
  assert.ok(isolated.controls.every(c => c.subledger_minor === 0 && c.items.length === 0), 'another tenant sees none of these documents');
  const counts = () => m.db.prepare('SELECT (SELECT COUNT(*) FROM finance_journals)+(SELECT COUNT(*) FROM finance_source_links)+(SELECT COUNT(*) FROM audit_events) AS n').get().n;
  const before = counts();
  ledger.controlBoard(m.db, m.users.manager, {});
  assert.equal(counts(), before, 'reading the reconciliation writes nothing');
});

/* ───── (6) تتبّع المبلغ ───── */
function bankMatched(m, order) {
  const grant = (user_id, capability) => m.tx(() => grantAccess(m.db, m.users.admin, { user_id, capability, note: 'تصريح مطابقة بنكية مصطنع' }));
  grant('employee', 'bank.reconcile'); grant('manager', 'bank.reconcile.approve');
  const account = m.tx(() => createBankAccount(m.db, m.users.employee, { label: 'الحساب التشغيلي المصطنع', bank_name: 'بنك مصطنع', account_tail: '4321', gl_account_id: m.accounts.bank.id }));
  const profile = m.tx(() => saveImportProfile(m.db, m.users.employee, { bank_account_id: account.id, name: 'كشف مصطنع', delimiter: 'comma', date_format: 'YYYY-MM-DD', header_rows: 1,
    columns: { date: 'date', description: 'description', reference: 'reference', debit: 'debit', credit: 'credit', balance: 'balance' } }));
  const amount = (order.amount_minor / 100).toFixed(2), closing = ((1000000 - order.amount_minor) / 100).toFixed(2);
  m.tx(() => importStatement(m.db, m.users.employee, { profile_id: profile.id, file_name: 'statement-synthetic.csv', period_start: `${m.month}-01`, period_end: m.day, opening_balance: '10000.00', closing_balance: closing,
    content: ['date,description,reference,debit,credit,balance', `${m.day},تحويل لمورد مصطنع,${order.bank_reference},${amount},,${closing}`].join('\n') }));
  const txn = m.db.prepare('SELECT * FROM bank_transactions ORDER BY line_no').get();
  const match = m.tx(() => proposeMatch(m.db, m.users.employee, { transaction_id: txn.id, kind: 'record', source_kind: 'supplier_payment', source_id: order.id, unmatched_reason: null, rationale: 'المبلغ والمرجع والتاريخ تطابق دفعة المورد المصطنعة' }));
  m.tx(() => decideMatch(m.db, m.users.manager, match.id, 'approve', { version: 1, note: 'راجعت إشعار التحويل المصطنع' }));
  return txn;
}
const step = (trace, name) => trace.chain.find(s => s.step === name);

test('trace: a supplier invoice walks to its approvers, its posted journal, its payment, the bank line, and its reversal — with explicit no-link markers', t => {
  const m = syntheticMonth(t);
  let trace = ledger.traceAmount(m.db, m.users.manager, { kind: 'supplier_invoice', id: m.p1.payable.id });
  assert.equal(trace.document.amount_minor, 115000);
  assert.equal(trace.document.reference, m.p1.invoice.supplier_reference);
  const approvals = step(trace, 'approvals');
  assert.equal(approvals.state, 'linked');
  assert.ok(approvals.items.some(a => a.actor_id === 'manager' && /طابق/.test(a.role)), 'the three-way match approver');
  assert.ok(approvals.items.some(a => a.actor_id === 'manager' && /الضريبة/.test(a.role)), 'the input VAT verifier');
  const journal = step(trace, 'journal');
  assert.equal(journal.state, 'linked');
  assert.deepEqual([journal.items[0].status, journal.items[0].prepared_by, journal.items[0].approved_by, journal.items[0].posted_by], ['posted', 'employee', 'manager', 'outsider']);
  const settlement = step(trace, 'settlement');
  assert.equal(settlement.state, 'linked');
  assert.deepEqual([settlement.items[0].kind, settlement.items[0].id, settlement.items[0].amount_minor, settlement.items[0].journal.status], ['supplier_payment', m.order.id, 115000, 'posted']);
  assert.equal(step(trace, 'bank_match').state, 'none', 'no bank line is matched yet, and the trace says so');
  assert.ok(step(trace, 'bank_match').why.length > 10);
  assert.equal(step(trace, 'reversal').state, 'none');
  const txn = bankMatched(m, m.order);
  trace = ledger.traceAmount(m.db, m.users.manager, { kind: 'supplier_invoice', id: m.p1.payable.id });
  assert.equal(step(trace, 'bank_match').state, 'linked');
  assert.deepEqual([step(trace, 'bank_match').items[0].transaction_id, step(trace, 'bank_match').items[0].status], [txn.id, 'approved']);
  // العكس: قيد عكس مرحّل يظهر في السلسلة بحالته ومن طلبه.
  const posted = m.db.prepare("SELECT journal_id FROM finance_source_links WHERE source_kind='supplier_invoice' AND source_id=?").get(m.p1.payable.id).journal_id;
  m.reverse(f.listFinance(m.db, m.users.manager).journals.find(j => j.id === posted));
  trace = ledger.traceAmount(m.db, m.users.manager, { kind: 'supplier_invoice', id: m.p1.payable.id });
  assert.equal(step(trace, 'reversal').state, 'linked');
  assert.deepEqual([step(trace, 'reversal').items[0].status, step(trace, 'reversal').items[0].requested_by], ['posted', 'manager']);
  // والدفعة نفسها تُتتبَّع إلى المستحق الذي سوّته.
  const payment = ledger.traceAmount(m.db, m.users.manager, { kind: 'supplier_payment', id: m.order.id });
  assert.equal(step(payment, 'settles').items[0].id, m.p1.payable.id);
  assert.equal(step(payment, 'bank_match').state, 'linked');
});

test('trace: an invoice reaches its receipt, the advance drawn on it and its credit note; a manual journal says it has no source document', t => {
  const m = syntheticMonth(t);
  const trace = ledger.traceAmount(m.db, m.users.manager, { kind: 'tax_invoice', id: m.ar.invoice.id });
  const settled = step(trace, 'settlement').items.map(i => [i.kind, i.amount_minor]);
  assert.deepEqual(settled.sort(), [['advance_draw', 5000], ['ar_receipt', 4200]].sort());
  assert.deepEqual(step(trace, 'reversal').items.map(i => [i.kind, i.amount_minor]), [['credit_note', 2300]]);
  assert.equal(step(trace, 'bank_match').state, 'none', 'the receipt is not matched to a bank line');
  const draw = ledger.traceAmount(m.db, m.users.manager, { kind: 'advance_draw', id: m.application.id });
  assert.ok(step(draw, 'settles').items.some(i => i.kind === 'tax_invoice' && i.id === m.ar.invoice.id), 'the draw names the invoice it settled');
  assert.ok(step(draw, 'settles').items.some(i => i.kind === 'advance_receipt' && i.id === m.advance.id));
  const advance = ledger.traceAmount(m.db, m.users.manager, { kind: 'advance_receipt', id: m.advance.id });
  assert.equal(step(advance, 'bank_match').state, 'none');
  // الحزمة 3 (المطابقة البنكية، الترحيل 168): جدول المطابقة صار يقبل قبض الدفعة المقدمة، فسبب الانقطاع «ما طابقه أحد للحين» لا «الجدول ما يقبله».
  assert.match(step(advance, 'bank_match').why, /سطر كشف بنكي/, 'an advance receipt is matchable now and simply not matched yet, and the trace says so');
  const manual = m.post(m.tx(() => f.createJournal(m.db, m.users.employee, { period_id: m.period.id, entry_date: m.day, description: 'قيد يدوي مصطنع', evidence: 'مذكرة مصطنعة', currency: 'SAR', source_reference: 'MAN-FREE-TEXT',
    lines: [{ account_id: m.accounts.supplier_cost.id, cost_center_id: m.centres.GEN.id, debit: '2.00', credit: '0', memo: 'x' }, { account_id: m.accounts.bank.id, cost_center_id: m.centres.GEN.id, debit: '0', credit: '2.00', memo: 'x' }] })));
  const free = ledger.traceAmount(m.db, m.users.manager, { kind: 'journal', id: manual.id });
  assert.equal(step(free, 'source').state, 'none');
  assert.match(step(free, 'source').why, /نص حر|يدوي/);
  assert.equal(step(free, 'journal').items[0].journal_id, manual.id);
  const fromJournal = ledger.traceAmount(m.db, m.users.manager, { kind: 'journal', id: m.db.prepare("SELECT journal_id FROM finance_source_links WHERE source_kind='tax_invoice' AND source_id=?").get(m.ar.invoice.id).journal_id });
  assert.deepEqual([fromJournal.kind, fromJournal.id], ['tax_invoice', m.ar.invoice.id], 'a sourced journal leads back to its document');
});

test('trace: finance-scoped, tenant-isolated, and it refuses what it cannot find instead of guessing', t => {
  const m = syntheticMonth(t);
  for (const who of ['hr', 'admin']) assert.throws(() => ledger.traceAmount(m.db, m.users[who], { kind: 'supplier_invoice', id: m.p1.payable.id }), code('ledger_access_denied'));
  // مانح التفويض في الكيان الآخر نفسه: finance_grants يربط المانح بكيانه، ولا يمنح أحدٌ نفسه.
  m.db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) SELECT 'isolated-grantor','isolated','other','isolated-grantor','مانح مصطنع في الكيان الآخر',password_hash,'employee' FROM users WHERE id='external'");
  m.db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'isolated', 'external', 'employee', 'read', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'isolated-grantor', 'تفويض قراءة مصطنع لكيان آخر', null, now());
  assert.ok(ledger.controlBoard(m.db, m.users.external, {}).controls.every(c => c.subledger_minor === 0), 'with a read grant in its own tenant it reads its own empty ledger');
  assert.equal(thrown(() => ledger.traceAmount(m.db, m.users.external, { kind: 'supplier_invoice', id: m.p1.payable.id })).code, 'trace_source_not_found', 'another tenant’s document is not found, not shown');
  assert.equal(thrown(() => ledger.traceAmount(m.db, m.users.manager, { kind: 'no_such_kind', id: 'x' })).code, 'trace_kind_unknown');
  assert.equal(thrown(() => ledger.traceAmount(m.db, m.users.manager, { kind: 'supplier_invoice', id: randomUUID() })).code, 'trace_source_not_found');
});

/* ───── (7) حالة الدفع الحقيقية بدل النص الثابت ───── */
test('listFinance: no constant payment status; each payable carries its payment state from its payment order', t => {
  const m = syntheticMonth(t);
  const report = f.listFinance(m.db, m.users.employee);
  assert.equal('payment_status' in report, false, 'the report-level constant is gone');
  const paid = report.eligible_payables.find(p => p.id === m.p1.payable.id), unpaid = report.eligible_payables.find(p => p.id === m.p2.payable.id);
  assert.deepEqual([paid.payment_status, unpaid.payment_status], ['paid', 'not_paid']);
  assert.equal(paid.paid_minor, 115000);
});

/* ───── (8) مرة واحدة فقط — حتى تحت سباق عمليتين على ملف واحد ───── */
function race(path, jobs) {
  const startAt = Date.now() + 2500;
  return Promise.all(jobs.map((job, index) => new Promise(done => {
    const child = spawn(process.execPath, [WORKER, path, job.kind, job.id, job.period, String(startAt)], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', () => { try { done(JSON.parse(out.trim().split('\n').pop())); } catch { done({ index, ok: false, error: 'no output' }); } });
  })));
}
test('idempotency: two processes preparing the same supplier invoice at the same instant leave one journal, one payable link and one source link', { timeout: 60000 }, async t => {
  const m = ledgerMonth(t);
  const a = m.matchedPayable({ gross: '1150.00' });
  m.inputTax(a.invoice.id, '150.00');
  const dir = mkdtempSync(join(tmpdir(), '36t-ledger-race-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'race.sqlite');
  m.db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  // النسخة تخرج من قاعدة بالذاكرة بسجلٍّ غير WAL: فتحها مرةً قبل السباق يحوّلها كما تفتح المنصة ملفها، فلا يتنافس العاملان
  // على تحويل وضع السجل نفسه (PRAGMA journal_mode يسبق busy_timeout في openDb) بدل تنافسهما على القيد.
  openDb(path).close();
  const results = await race(path, [0, 1].map(() => ({ kind: 'supplier_invoice', id: a.payable.id, period: m.period.id })));
  assert.equal(results.filter(r => r.ok).length, 1, 'exactly one process prepared the journal: ' + JSON.stringify(results));
  assert.deepEqual(results.filter(r => !r.ok).map(r => r.error), ['duplicate_source'], 'the other was refused by name, not by a raw database error: ' + JSON.stringify(results));
  const file = openDb(path); t.after(() => file.close());
  assert.equal(file.prepare("SELECT COUNT(*) AS n FROM finance_journals WHERE source_kind='procurement_payable' AND source_id=?").get(a.payable.id).n, 1);
  assert.equal(file.prepare('SELECT COUNT(*) AS n FROM finance_payable_links WHERE payable_id=?').get(a.payable.id).n, 1);
  assert.equal(file.prepare("SELECT COUNT(*) AS n FROM finance_source_links WHERE source_kind='supplier_invoice' AND source_id=?").get(a.payable.id).n, 1);
  assert.ok(verifyAudit(file));
});

/* ───── (9) فصل المهام والصلاحيات ───── */
test('separation of duties: the preparer neither approves nor posts a sourced journal, a reversal needs another preparer, and a read-only holder prepares nothing', t => {
  const m = ledgerMonth(t);
  const a = m.matchedPayable({ gross: '1150.00' });
  m.inputTax(a.invoice.id, '150.00');
  assert.throws(() => m.journal('supplier_invoice', a.payable.id, 'outsider'), code('ledger_access_denied'), 'approve and post without prepare cannot build a journal');
  let j = m.journal('supplier_invoice', a.payable.id);
  j = m.jAct('employee', j, 'submit');
  assert.throws(() => m.jAct('employee', j, 'approve'), code('transition_denied'));
  j = m.jAct('manager', j, 'approve');
  assert.throws(() => m.jAct('employee', j, 'post'), code('transition_denied'), 'the preparer does not post');
  j = m.jAct('outsider', j, 'post');
  assert.throws(() => m.jAct('employee', j, 'reverse', { period_id: m.period.id, entry_date: m.day, reason: 'عكس ذاتي', evidence: 'مصطنع' }), code('transition_denied'), 'the original preparer does not reverse');
  const advance = m.paidAdvance({ amount: '300.00' });
  assert.throws(() => m.journal('advance_receipt', advance.id, 'treasurer'), code('ledger_access_denied'));
});

/* ───── (10) المساران والشاشتان ───── */
// الطلب يُمرَّر إلى معالج الخادم مباشرةً (النمط نفسه في tests/authorization-race.test.mjs): لا منفذ يُفتح، فيعمل في
// الصندوق الذي يمنع listen. المسار الحقيقي كاملًا: الجلسة والتفويض والرفض المكتوب ورمز الحالة.
async function get(server, token, url) {
  const req = { method: 'GET', url, headers: { host: '127.0.0.1', cookie: `session=${token}` }, async *[Symbol.asyncIterator]() {} };
  const res = { headers: {}, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers ?? {}); }, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body ? JSON.parse(String(body)) : null; } };
  await server.listeners('request')[0](req, res);
  return res;
}
test('routes: GET /api/ledger/reconciliation and /api/ledger/trace answer a finance reader and refuse everyone else, writing nothing', async t => {
  const m = syntheticMonth(t);
  const server = createApp(m.db); t.after(() => server.close());
  const manager = login(m.db, 'manager', 'synthetic-ledger-completeness', 'local-test'), hr = login(m.db, 'hr', 'synthetic-ledger-completeness', 'local-test');
  const before = m.db.prepare('SELECT (SELECT COUNT(*) FROM finance_journals)+(SELECT COUNT(*) FROM finance_source_links) AS n').get().n;
  const reconciliation = await get(server, manager.token, `/api/ledger/reconciliation?to=${m.day}`);
  assert.equal(reconciliation.status, 200);
  assert.equal(reconciliation.body.controls.find(c => c.key === 'payable').ledger_minor, 57500);
  const trace = await get(server, manager.token, `/api/ledger/trace?kind=supplier_invoice&id=${m.p1.payable.id}`);
  assert.equal(trace.status, 200);
  assert.equal(trace.body.chain.find(s => s.step === 'journal').items[0].status, 'posted');
  const unknown = await get(server, manager.token, '/api/ledger/trace?kind=no_such_kind&id=x');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'trace_kind_unknown');
  assert.ok(unknown.body.error.details.refusal.next.length > 0, 'the refusal says what to do next');
  for (const url of ['/api/ledger/reconciliation', `/api/ledger/trace?kind=supplier_invoice&id=${m.p1.payable.id}`]) {
    const refused = await get(server, hr.token, url);
    assert.equal(refused.status, 403, url);
  }
  assert.equal(m.db.prepare('SELECT (SELECT COUNT(*) FROM finance_journals)+(SELECT COUNT(*) FROM finance_source_links) AS n').get().n, before);
});

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
test('screens: the statements screen shows the control reconciliation and a trace action; the finance screen shows each payable’s real payment state', t => {
  const m = syntheticMonth(t);
  const p3 = m.matchedPayable({ gross: '230.00' });
  m.inputTax(p3.invoice.id, '30.00');
  const data = { ...ledger.statements(m.db, m.users.manager), controls: ledger.controlBoard(m.db, m.users.manager, {}) };
  const buttons = [];
  const html = statementsUI.render(data, { e: escapeHtml, money, ui: kit(escapeHtml), button: (action, id, label) => { buttons.push([action, id]); return `<button>${escapeHtml(label)}</button>`; } });
  assert.match(html, /مطابقة الحسابات الرقابية/);
  assert.match(html, /فيه فرق/, 'the unposted payable shows as a difference');
  assert.match(html, /مستند ما له قيد/);
  assert.ok(!html.includes('undefined') && !html.includes('NaN'), 'no raw undefined or NaN reaches the reader');
  assert.ok(buttons.some(([action, id]) => action === 'trace_amount' && id === `supplier_invoice:${p3.payable.id}`));
  assert.ok(buttons.some(([action, id]) => action === 'journal_from_source' && id === `supplier_invoice:${p3.payable.id}`));
  const spec = statementsUI.form('trace_amount', `supplier_invoice:${m.p1.payable.id}`, data);
  assert.equal(spec.method, 'GET');
  assert.equal(spec.dynamicEndpoint({}), `/ledger/trace?kind=supplier_invoice&id=${m.p1.payable.id}`);
  const dialog = spec.after(ledger.traceAmount(m.db, m.users.manager, { kind: 'supplier_invoice', id: m.p1.payable.id }), escapeHtml);
  assert.match(dialog.html, /سطر كشف البنك/);
  assert.match(dialog.html, /ما فيه/);
  assert.ok(!dialog.html.includes('undefined'));
  const prepare = statementsUI.form('journal_from_source', `supplier_invoice:${p3.payable.id}`, data);
  assert.deepEqual(prepare.toPayload({ period_id: m.period.id }), { source_kind: 'supplier_invoice', source_id: p3.payable.id, period_id: m.period.id });
  // والشاشة القديمة للقوائم (بلا مطابقة) ترسم كما كانت.
  assert.ok(!statementsUI.render(ledger.statements(m.db, m.users.manager), { e: escapeHtml, money, ui: kit(escapeHtml), button: () => '' }).includes('undefined'));
  const financeButtons = [];
  const finance = financeUI.render(f.listFinance(m.db, m.users.employee), { e: escapeHtml, money, button: action => { financeButtons.push(action); return ''; } });
  assert.match(finance, /· مدفوع</, 'the paid payable says so');
  assert.match(finance, /غير مدفوع/, 'and the unpaid one says so, from its payment orders');
  assert.ok(!financeButtons.includes('from_payable'), 'the closed manual path offers no button');
  assert.throws(() => financeUI.form('from_payable', m.p2.payable.id, f.listFinance(m.db, m.users.employee)), /غير متاح|الفعل/);
});
