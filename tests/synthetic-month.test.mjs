// الحزمة 3 — الشهر المصطنع: سبتمبر 2026 كاملًا بالمسارات الحقيقية، من أول قيد افتتاحي إلى إقفال الشهر وفتحه المضبوط وقيد التسوية
// المؤرّخ داخله وإعادة إقفاله — ثم ميزان مراجعة متوازن، وكل حساب رقابي بفرق صفر، وكل مبلغ يُتتبَّع من مستنده إلى قيده وسطر كشفه
// وتسويته وعكسه، وطابور الاستثناءات فارغ، وحزمة التدقيق تُفحص بعد خروجها في ملف.
//
// الساعة مضبوطة (t.mock.timers على Date وحده): كل مستند يُكتب في يومه من سبتمبر، والكشف يُستورد في أول أكتوبر لأن كشفًا لفترة
// لم تنته لا يُستورد، والإقفال بعده. لا صفّ يُكتب باليد: كل خطوة نداءٌ لوحدتها بأدوارها وفصل مهامها (من يعدّ لا يعتمد، ومن يعتمد
// لا يرحّل، ومن أقفل لا يطلب الفتح، ومن يقرر الفتح ثالث). البيانات مصطنعة كلها في قاعدة بالذاكرة.
//
// المال في الشهر (بالريال): رأس مال 100,000 · فاتورتان للعميل 11,500 و5,750 وإشعار دائن 575 · قبض 11,500 يرتد ثم يعود على دفعتين
// في البنك (6,000 + 5,500) · قبض على الحساب 5,175 يُخصَّص · دفعة مقدمة 2,300 يرتد منها 500 · شراء بوحدتين 11,500 يُستلم ويُفوتر
// على دفعتين (5,750 + 5,750 بضريبة 750 لكل منهما) · دفعة جزئية 3,000 ثم أمر مجمّع 8,500 يرجع من البنك برسوم 10 ثم يُعاد تحويله ·
// مصروف موظف 460 يُعوَّض في تحويل مجمّع مع رد الدفعة المقدمة (960) · رسوم حساب 25 · وقيد تسوية مؤرّخ 30 سبتمبر بعد فتح الشهر 1,200.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { verifyAudit, now } from '../app/db.mjs';
import * as f from '../app/finance.mjs';
import * as ledger from '../app/ledger.mjs';
import * as bank from '../app/bank-reconciliation.mjs';
import * as billing from '../app/billing-recurring.mjs';
import * as expenses from '../app/expenses.mjs';
import { createPurchase, procurementAction } from '../app/procurement.mjs';
import { recordInputTax, decideInputTax } from '../app/payables.mjs';
import { grantAccess } from '../app/access.mjs';
import { adoptionAction } from '../app/options.mjs';
import { createTemplate, openClosePeriod, getClosePeriod, taskAction, periodAction, closeChecks, RECLOSE_DAYS } from '../app/close-checklist.mjs';
import { runReport } from '../app/reports.mjs';
import { cashForecastBoard } from '../app/cash-forecast.mjs';
import { exceptionsBoard } from '../app/finance-exceptions.mjs';
import { exportAuditPackage, verifyAuditPackage } from '../app/audit-export.mjs';
import { sourceKind } from '../app/ledger-sources.mjs';
import { visibilityWorld, riyadhDay } from './visibility-fixture.mjs';

const MONTH = '2026-09', FROM = '2026-09-01', TO = '2026-09-30';
const at = day => Date.parse(`${day}T07:00:00.000Z`);
const halalas = sar => Math.round(Number(sar) * 100);

test('synthetic month: September 2026 runs end to end through the real paths — sales, procurement, advances, expenses, bank import with grouped and split matches and a posted fee, a zero-difference reconciliation, a green close, a controlled reopen, a dated adjustment and a re-close — and proves itself', t => {
  t.mock.timers.enable({ apis: ['Date'], now: at(FROM) });
  const on = day => t.mock.timers.setTime(at(day));
  const w = visibilityWorld(t), { db, users, tx } = w;
  assert.equal(w.month, MONTH, 'the ledger month is September 2026');

  /* ───── 09-01: الأشخاص والتصاريح والدليل والحساب البنكي ───── */
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT id,'36t','ops',id,name,(SELECT password_hash FROM users WHERE id='manager'),role,NULL FROM (
    SELECT 'closer' AS id,'محاسب الإقفال المصطنع' AS name,'employee' AS role UNION ALL SELECT 'reviewer','مراجع الإقفال المصطنع','manager' UNION ALL SELECT 'third','مقرر الفتح المصطنع','manager')`);
  const everyone = () => Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  Object.assign(users, everyone());
  for (const [who, actions] of [['closer', ['read', 'configure', 'prepare']], ['reviewer', ['read', 'configure']], ['third', ['read', 'configure']]])
    for (const action of actions) db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', who, users[who].role, action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض إقفال مصطنع', null, now());
  for (const [who, capability] of [['employee', 'bank.reconcile'], ['manager', 'bank.reconcile.approve'], ['closer', 'finance.close.manage'], ['reviewer', 'finance.close.manage'], ['third', 'finance.close.manage'], ['third', 'finance.audit.export']])
    tx(() => grantAccess(db, users.admin, { user_id: who, capability, note: 'تصريح مصطنع لشهر الإثبات' }));
  const ref = (kind, input) => tx(() => f.createFinanceReference(db, users.manager, kind, input));
  const extra = { equity: ref('accounts', { code: '3000', name: 'رأس مال مصطنع', account_type: 'equity', currency: 'SAR' }), general_expense: ref('accounts', { code: '5100', name: 'مصروفات تشغيلية مصطنعة', account_type: 'expense', currency: 'SAR' }),
    employee_payable: ref('accounts', { code: '2100', name: 'مستحقات موظفين مصطنعة', account_type: 'liability', currency: 'SAR' }), bank_charges: ref('accounts', { code: '5300', name: 'رسوم بنكية مصطنعة', account_type: 'expense', currency: 'SAR' }),
    accrued: ref('accounts', { code: '2500', name: 'مصروفات مستحقة مصطنعة', account_type: 'liability', currency: 'SAR' }) };
  for (const purpose of ['general_expense', 'employee_payable', 'bank_charges']) {
    const { id } = tx(() => ledger.recordMapping(db, users.employee, { purpose, account_id: extra[purpose].id, cost_center_id: w.centres.GEN.id, effective_from: '2026-01-01' }));
    tx(() => ledger.approveMapping(db, users.manager, id, { note: 'طابقت الحساب مع دليل الحسابات المصطنع' }));
  }
  const post = (kind, id) => w.post(w.journal(kind, id));
  const manual = (date, lines, reference, description) => w.post(tx(() => f.createJournal(db, users.employee, { period_id: w.period.id, entry_date: date, description, evidence: 'مستند داخلي مصطنع محفوظ', currency: 'SAR', source_reference: reference,
    lines: lines.map(([account, debit, credit]) => ({ account_id: account.id, cost_center_id: w.centres.GEN.id, debit: debit ?? '0', credit: credit ?? '0', memo: 'سطر مصطنع' })) })));
  const capital = manual(FROM, [[w.accounts.bank, '100000.00'], [extra.equity, null, '100000.00']], 'CAP-2026', 'إيداع رأس المال الافتتاحي المصطنع');
  const account = tx(() => bank.createBankAccount(db, users.employee, { label: 'الحساب التشغيلي المصطنع', bank_name: 'بنك مصطنع', account_tail: '9090', gl_account_id: w.accounts.bank.id }));
  const profile = tx(() => bank.saveImportProfile(db, users.employee, { bank_account_id: account.id, name: 'كشف سبتمبر المصطنع', delimiter: 'comma', date_format: 'YYYY-MM-DD', header_rows: 1,
    columns: { date: 'date', description: 'description', reference: 'reference', debit: 'debit', credit: 'credit' } }));
  tx(() => createTemplate(db, users.closer, { title: 'مطابقة كشف البنك وتسويته', owner_id: 'closer', due_day: 5, basis: 'قرار مالك إجراء الإقفال المصطنع لهذه المهمة' }));

  /* ───── 09-02 ← 09-22: المشتريات من الطلب إلى المرتجع ───── */
  on('2026-09-02');
  const pAct = (who, p, action, values = {}) => tx(() => procurementAction(db, users[who], p.id, action, { version: p.version, ...values }));
  let p = tx(() => createPurchase(db, users.employee, { project_id: w.project.id, title: 'إنتاج مواد حملة مصطنعة', specification: 'وحدتا إنتاج بالمواصفات المصطنعة المسجلة', cost_center: 'CC-A', due_date: '2099-10-20', quantity: 2, unit: 'وحدة',
    budget_amount: '11500.00', budget_evidence: 'مخصص اختبار داخلي', currency: 'SAR' }));
  p = pAct('employee', p, 'submit');
  for (const [key, price] of [['LOCAL-A', '5750.00'], ['LOCAL-B', '5999.00'], ['LOCAL-C', '6100.00']])
    p = pAct('employee', p, 'add_quote', { supplier_key: key, supplier_name: 'مورد مصطنع ' + key, unit_price: price, technical_assessment: 'العرض يطابق المواصفات المسجلة', financial_terms: 'استحقاق بعد الاستلام والمطابقة', delivery_date: '2099-10-20', evidence: 'عرض مصطنع محفوظ برقم ' + key });
  p = pAct('manager', p, 'award', { quote_id: p.quotes.find(q => q.supplier_key === 'LOCAL-A').id, note: 'ترسية على الأقل سعرًا بعد تأكيد المخصص' });
  p = pAct('manager', p, 'approve_order', { terms: 'تسليم وحدتين على دفعتين بعد فحص الجودة', delivery_date: '2099-10-20', note: 'اعتماد أمر شراء داخلي مصطنع' });
  p = pAct('manager', p, 'commence', { start_on: '2026-09-02', valid_until: '2099-12-31', site_or_channel: 'موقع المورد المصطنع', scope_confirmation: 'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر', evidence: 'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام' });
  const tax = (invoice, number, date) => { const { id } = tx(() => recordInputTax(db, users.employee, { invoice_id: invoice.id, supplier_vat_number: w.winner.vat_number, supplier_invoice_number: number, invoice_date: date, vat: '750.00', evidence: 'فاتورة ضريبية مصطنعة محفوظة في ملف المورد' }));
    tx(() => decideInputTax(db, users.manager, id, 'verify', { note: 'طابقنا الفاتورة الضريبية المصطنعة' })); };
  on('2026-09-06');
  p = pAct('employee', p, 'receive', { quantity: 1, reference: 'REC-SEP-1', evidence: 'استلام الوحدة الأولى وفحصها محليًا' });
  assert.equal(p.status, 'part_received', 'a partial receipt');
  p = pAct('employee', p, 'record_invoice', { supplier_reference: 'SUP-INV-1', quantity: 1, amount: '5750.00', evidence: 'فاتورة المورد المصطنعة الأولى' });
  p = pAct('manager', p, 'match', { invoice_id: p.invoices.find(i => i.supplier_reference === 'SUP-INV-1').id, note: 'طابقنا الأمر والاستلام الجزئي والفاتورة' });
  const P1 = p.payables[0];
  tax(p.invoices.find(i => i.supplier_reference === 'SUP-INV-1'), 'TAX-SEP-1', '2026-09-06');
  post('supplier_invoice', P1.id);

  /* ───── 09-03 ← 09-15: المبيعات من الاستحقاق إلى التخصيص ───── */
  on('2026-09-03');
  const k = w.customer({ lines: [['حملة إطلاق مصطنعة', '10000.00'], ['تقرير أداء مصطنع', '5000.00']] });
  const [C1, C2] = k.claims, [I1, I2] = k.invoices;
  post('tax_invoice', I1.id); post('tax_invoice', I2.id);
  on('2026-09-04');
  const advance = (() => { const { id } = tx(() => billing.recordAdvance(db, users.manager, { client_id: w.client.id, schedule_id: '', description: 'دفعة مقدمة مصطنعة على اتفاق اشتراك', agreement_reference: 'بند 7-3 من الاتفاق المصطنع', amount: '2300.00' }));
    tx(() => billing.confirmAdvance(db, users.outsider, id, { version: db.prepare('SELECT version FROM advance_invoices WHERE id=?').get(id).version, amount: '2300.00', received_on: riyadhDay(), evidence: 'كشف حساب بنكي مصطنع يطابق الحوالة', reference: 'TRF-ADV-1' }));
    return db.prepare('SELECT * FROM advance_invoices WHERE id=?').get(id); })();
  post('advance_receipt', advance.id);
  on('2026-09-08');
  const R1 = w.receipt(C1, '11500.00', 'SYN-R1');
  post('ar_receipt', R1.id);
  on('2026-09-09');
  const claim = tx(() => expenses.submitClaim(db, users.it, { expense_date: '2026-09-09', category: 'supplies', description: 'مستلزمات تصوير مصطنعة للحملة', amount: '460.00', receipt_reference: 'RCPT-SEP-9' }));
  const eAct = (who, action, values) => tx(() => expenses.claimAction(db, users[who], claim.id, action, { version: db.prepare('SELECT version FROM expense_claims WHERE id=?').get(claim.id).version, ...values }));
  eAct('manager', 'manager_approve', { note: 'المصروف ضمن عمل الحملة' });
  eAct('outsider', 'finance_approve', { note: 'طابقت الإيصال المصطنع مع المبلغ' });
  post('expense_claim', claim.id);
  on('2026-09-10');
  const reversal = w.reverseReceipt(C1, R1);
  post('ar_receipt_reversal', reversal.id);
  on('2026-09-12');
  const CN = w.creditNote(I2, '575.00');
  post('credit_note', CN.id);
  on('2026-09-13');
  const approveOrder = o => w.act('manager', o, 'approve_order', { note: 'طابقت المستحق والمورد والحساب' });
  const execute = (o, reference) => w.act('treasurer', o, 'record_execution', { executed_on: riyadhDay(), bank_reference: reference, evidence: 'إشعار تحويل بنكي مصطنع محفوظ في مجلد الخزينة' });
  const partial = execute(approveOrder(w.prepare({ payable_id: P1.id, amount: '3000.00' })), 'BNK-PART-1');
  post('supplier_payment', partial.id);
  on('2026-09-14');
  const R2 = w.receipt(C1, '11500.00', 'SYN-R2');
  post('ar_receipt', R2.id);
  on('2026-09-15');
  const X1 = w.onAccount(k.case.id, '5175.00', 'SYN-ACC-1');
  post('ar_account_receipt', X1.id);
  w.allocate(X1, [{ claim_id: C2.id, amount: '5175.00' }]);
  const allocation = db.prepare("SELECT * FROM ar_allocations WHERE account_receipt_id=? AND kind='allocation'").get(X1.id);
  post('ar_allocation', allocation.id);
  on('2026-09-16');
  p = pAct('employee', p, 'receive', { quantity: 1, reference: 'REC-SEP-2', evidence: 'استلام الوحدة الثانية وفحصها محليًا' });
  assert.equal(p.status, 'received');
  p = pAct('employee', p, 'record_invoice', { supplier_reference: 'SUP-INV-2', quantity: 1, amount: '5750.00', evidence: 'فاتورة المورد المصطنعة الثانية' });
  p = pAct('manager', p, 'match', { invoice_id: p.invoices.find(i => i.supplier_reference === 'SUP-INV-2').id, note: 'طابقنا الأمر والاستلام الثاني والفاتورة' });
  const P2 = p.payables.find(y => y.id !== P1.id);
  tax(p.invoices.find(i => i.supplier_reference === 'SUP-INV-2'), 'TAX-SEP-2', '2026-09-16');
  post('supplier_invoice', P2.id);
  on('2026-09-17');
  const batch = execute(approveOrder(w.prepare({ lines: [{ payable_id: P1.id, amount: '2750.00' }, { payable_id: P2.id, amount: '5750.00' }] })), 'BNK-BATCH-1');
  post('supplier_payment', batch.id);
  on('2026-09-20');
  const returned = w.returnOrder(batch, '8490.00', 'RET-BATCH-1').return;
  post('supplier_payment_return', returned.id);
  eAct('treasurer', 'record_reimbursement', { reimbursed_on: riyadhDay(), reference: 'EXP-PAY-0920' });
  post('expense_reimbursement', claim.id);
  tx(() => billing.reverseAdvance(db, users.manager, advance.id, { amount: '500.00', reason: 'رد جزء من الدفعة المقدمة بطلب العميل المصطنع', evidence: 'خطاب طلب رد مصطنع محفوظ' }));
  const advanceReversal = db.prepare('SELECT * FROM advance_reversals WHERE advance_id=?').get(advance.id);
  post('advance_reversal', advanceReversal.id);
  on('2026-09-22');
  const again = execute(approveOrder(w.prepare({ lines: [{ payable_id: P1.id, amount: '2750.00' }, { payable_id: P2.id, amount: '5750.00' }] })), 'BNK-BATCH-2');
  post('supplier_payment', again.id);
  assert.deepEqual([P1.id, P2.id].map(id => db.prepare('SELECT outstanding_minor FROM payable_balances WHERE payable_id=?').get(id).outstanding_minor), [0, 0], 'both payables are paid after the return and the second transfer');

  /* ───── 10-01: كشف سبتمبر، مطابقة مجمّعة ومجزّأة، رسوم مرحّلة، وتسوية بفرق صفر ───── */
  on('2026-10-01');
  tx(() => bank.importStatement(db, users.employee, { profile_id: profile.id, file_name: 'statement-2026-09.csv', period_start: FROM, period_end: TO, opening_balance: '0.00', closing_balance: '106480.00',
    content: ['date,description,reference,debit,credit',
      '2026-09-01,إيداع رأس المال,CAP-2026,,100000.00', '2026-09-04,حوالة دفعة مقدمة,TRF-ADV-1,,2300.00', '2026-09-08,إيداع شيك العميل,SYN-R1,,11500.00',
      '2026-09-10,شيك العميل راجع,REV-SYN-R1,11500.00,', '2026-09-12,رسوم إدارة الحساب,FEE-SEP,25.00,', '2026-09-13,تحويل جزئي للمورد,BNK-PART-1,3000.00,',
      '2026-09-14,حوالة العميل الأولى,SYN-R2-A,,6000.00', '2026-09-14,حوالة العميل الثانية,SYN-R2-B,,5500.00', '2026-09-15,حوالة على الحساب,SYN-ACC-1,,5175.00',
      '2026-09-17,تحويل مجمع للمورد,BNK-BATCH-1,8500.00,', '2026-09-20,تحويل مجمع لموظف وعميل,BULK-0920,960.00,', '2026-09-20,مرتجع تحويل المورد,RET-BATCH-1,,8490.00',
      '2026-09-22,إعادة التحويل المجمع للمورد,BNK-BATCH-2,8500.00,'].join('\n') }));
  const line = text => db.prepare('SELECT * FROM bank_transactions WHERE description=?').get(text);
  const propose = input => w.tx(() => bank.proposeMatch(db, users.employee, { kind: 'record', unmatched_reason: null, rationale: 'المبلغ والمرجع والتاريخ تطابق السجل المصطنع', ...input }));
  const approveMatch = m => tx(() => bank.decideMatch(db, users.manager, m.id, 'approve', { version: 1, note: 'راجعت السطر والسجل في الكشف المصطنع' }));
  const single = (text, source_kind, source_id) => approveMatch(propose({ transaction_id: line(text).id, source_kind, source_id }));
  approveMatch(propose({ transaction_id: line('إيداع رأس المال').id, members: [{ journal_id: capital.id }] }));
  single('حوالة دفعة مقدمة', 'advance_receipt', advance.id);
  single('إيداع شيك العميل', 'ar_receipt', R1.id);
  single('شيك العميل راجع', 'ar_receipt_reversal', reversal.id);
  single('تحويل جزئي للمورد', 'supplier_payment', partial.id);
  const split = propose({ transaction_ids: [line('حوالة العميل الأولى').id, line('حوالة العميل الثانية').id], source_kind: 'ar_receipt', source_id: R2.id });
  assert.equal(split.shape, 'split'); approveMatch(split);
  single('حوالة على الحساب', 'ar_account_receipt', X1.id);
  single('تحويل مجمع للمورد', 'supplier_payment', batch.id);
  const grouped = propose({ transaction_id: line('تحويل مجمع لموظف وعميل').id, members: [{ source_kind: 'expense_reimbursement', source_id: claim.id }, { source_kind: 'advance_reversal', source_id: advanceReversal.id }] });
  assert.equal(grouped.shape, 'group'); approveMatch(grouped);
  single('مرتجع تحويل المورد', 'supplier_payment_return', returned.id);
  single('إعادة التحويل المجمع للمورد', 'supplier_payment', again.id);
  const fee = line('رسوم إدارة الحساب');
  approveMatch(w.tx(() => bank.proposeMatch(db, users.employee, { transaction_id: fee.id, kind: 'unmatched', unmatched_reason: 'bank_fee', rationale: 'رسوم إدارة الحساب الشهرية من البنك المصطنع' })));
  post('bank_line', fee.id);
  const statement = bank.reconciliationStatement(db, users.employee, { bank_account_id: account.id, period_start: FROM, period_end: TO });
  assert.deepEqual([statement.undecided_count, statement.outstanding.length, statement.difference_minor, statement.book_balance_minor], [0, 0, 0, halalas('106480')], 'every line decided, nothing outstanding, zero difference');
  const reconciliation = tx(() => bank.prepareReconciliation(db, users.employee, { bank_account_id: account.id, period_start: FROM, period_end: TO, explanation: '' }));
  tx(() => bank.approveReconciliation(db, users.manager, reconciliation.id, { version: 1, note: 'طابقت الكشف والدفتر بفرق صفر' }));

  /* ───── 10-02: الإقفال بفحوصه الأربعة ───── */
  on('2026-10-02');
  const checks = closeChecks(db, '36t', { from: FROM, to: TO, finance_period_id: w.period.id });
  assert.deepEqual(checks.checks.map(c => [c.key, c.passed, c.items.length]), [['journals', true, 0], ['sources', true, 0], ['bank', true, 0], ['controls', true, 0]], 'all four close checks green before anyone approves');
  const opened = tx(() => openClosePeriod(db, users.closer, { period_key: MONTH, finance_period_id: w.period.id }));
  const task = getClosePeriod(db, users.closer, opened.id).tasks[0];
  tx(() => taskAction(db, users.closer, task.id, 'complete_task', { version: task.version, evidence: 'طابقت كشف سبتمبر وأُعتمدت التسوية بفرق صفر' }));
  const view = who => getClosePeriod(db, users[who], opened.id);
  const act = (who, action, input) => tx(() => periodAction(db, users[who], opened.id, action, { version: view(who).version, ...input }));
  assert.throws(() => act('closer', 'approve_close', { note: 'محاولة اعتماد ممن نفّذ مهمة' }), error => error.code === 'invalid_state', 'whoever executed a task does not approve the close');
  act('reviewer', 'approve_close', { note: 'راجعت المهام والفحوص الأربعة لسبتمبر' });
  assert.equal(db.prepare('SELECT status FROM finance_periods WHERE id=?').get(w.period.id).status, 'closed', 'approving the close locks the ledger month');
  assert.throws(() => manual(TO, [[extra.general_expense, '1.00'], [extra.accrued, null, '1.00']], 'LATE-0', 'قيد متأخر مرفوض'), error => error.code === 'period_closed');

  /* ───── 10-05: فتح مضبوط، وقيد تسوية مؤرّخ داخل الشهر ───── */
  on('2026-10-05');
  tx(() => adoptionAction(db, users.closer, RECLOSE_DAYS, 'record', { value: { days: 3 }, basis: 'قرار مالك الإجراء المصطنع لمدة بقاء الشهر مفتوحًا بعد فتحه', effective_from: '2026-01-01' }));
  tx(() => adoptionAction(db, users.reviewer, RECLOSE_DAYS, 'approve', { adoption_id: db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(RECLOSE_DAYS).id, note: 'اعتمدت المدة بعد مراجعة أساسها المكتوب' }));
  assert.throws(() => act('reviewer', 'request_reopen', { reason: 'محاولة فتح ممن اعتمد الإقفال' }), error => error.code === 'invalid_state', 'whoever approved the close does not request its reopening');
  act('closer', 'request_reopen', { reason: 'وصلت فاتورة مصروف تخص سبتمبر بعد اعتماد الإقفال' });
  act('third', 'approve_reopen', { note: 'أقر بأن الفاتورة تخص سبتمبر وتستوجب قيد تسوية مؤرّخًا' });
  const reopening = db.prepare('SELECT * FROM finance_period_reopenings WHERE period_id=?').get(w.period.id);
  assert.deepEqual([reopening.status, reopening.requested_by, reopening.decided_by, reopening.previous_closed_by, reopening.reclose_due_on], ['approved', 'closer', 'third', 'reviewer', '2026-10-08'], 'three people and a date to re-close');
  const adjustment = manual(TO, [[extra.general_expense, '1200.00'], [extra.accrued, null, '1200.00']], 'ACC-SEP-1', 'قيد تسوية مؤرّخ: مصروف سبتمبر وصلت فاتورته بعد الإقفال');
  assert.equal(adjustment.entry_date, TO, 'the adjustment is dated inside the reopened month');

  /* ───── 10-06: إعادة الإقفال بالفحوص نفسها ───── */
  on('2026-10-06');
  act('reviewer', 'approve_close', { note: 'أعدت الإقفال بعد قيد التسوية المؤرّخ ومراجعة الفحوص الأربعة' });
  assert.deepEqual([db.prepare('SELECT status FROM finance_periods WHERE id=?').get(w.period.id).status, db.prepare('SELECT reclosed_by FROM finance_period_reopenings WHERE id=?').get(reopening.id).reclosed_by], ['closed', 'reviewer']);

  /* ───── الإثبات ───── */
  // ميزان المراجعة متوازن، والمركز المالي متوازن، ورصيد البنك في الدفتر يساوي الكشف.
  const trial = f.listFinance(db, users.manager).trial_balance;
  assert.equal(trial.is_balanced, true);
  const s = ledger.statements(db, users.manager, { from: FROM, to: TO });
  assert.equal(s.balance_sheet.balanced, true);
  assert.equal(s.income_statement.net_minor, halalas('10000') + halalas('5000') - halalas('500') - halalas('10000') - halalas('460') - halalas('10') - halalas('25') - halalas('1200'),
    'revenue net of the credit note, less supplier cost net of verified VAT, the expense, the bank charges and the dated accrual');
  // كل حساب رقابي بفرق صفر في آخر الشهر.
  const controls = ledger.controlReconciliation(db, '36t', TO);
  assert.deepEqual(controls.controls.map(c => [c.key, c.mapped, c.difference_minor]), [['receivable', true, 0], ['payable', true, 0], ['input_vat', true, 0], ['output_vat', true, 0], ['customer_advances', true, 0]]);
  assert.deepEqual(controls.controls.map(c => c.ledger_minor), [0, 0, halalas('1500'), halalas('2175'), halalas('1800')]);
  // كل مبلغ يُتتبَّع: مستنده، ومن أعدّه واعتمده، وقيده المرحّل، وسطر كشفه إن كان نقدًا أو تسويته النقدية.
  const documents = ledger.pendingSources(db, users.manager).filter(d => d.date >= FROM && d.date <= TO);
  const tally = documents.reduce((m, d) => ({ ...m, [d.source_kind]: (m[d.source_kind] ?? 0) + 1 }), {});
  assert.deepEqual(tally, { tax_invoice: 2, credit_note: 1, ar_receipt: 2, ar_receipt_reversal: 1, ar_account_receipt: 1, ar_allocation: 1, advance_receipt: 1, advance_reversal: 1,
    supplier_invoice: 2, supplier_payment: 3, supplier_payment_return: 1, expense_claim: 1, expense_reimbursement: 1, bank_line: 1 }, 'nineteen documents of fourteen kinds, each final and dated in September');
  for (const d of documents) {
    const trace = ledger.traceAmount(db, users.manager, { kind: d.source_kind, id: d.source_id }), step = key => trace.chain.find(x => x.step === key);
    assert.equal(step('journal').state, 'linked', `${d.source_kind} ${d.reference}: a journal`);
    assert.ok(step('journal').items.every(j => j.status === 'posted'), `${d.source_kind} ${d.reference}: posted`);
    if (sourceKind(d.source_kind).approvals) assert.equal(step('approvals').state, 'linked', `${d.source_kind} ${d.reference}: who prepared and approved it`);
    const cash = sourceKind(d.source_kind).bank === 'cash' || d.source_kind === 'bank_line';
    if (cash) assert.equal(step('bank_match').state, 'linked', `${d.source_kind} ${d.reference}: the statement line that carried it`);
    else assert.notEqual(step('bank_match').state, 'none', `${d.source_kind} ${d.reference}: its cash settlement is matched, or it has none`);
  }
  const traceOf = (kind, id) => ledger.traceAmount(db, users.manager, { kind, id }).chain;
  const settledBy = (kind, id) => traceOf(kind, id).find(x => x.step === 'settlement').items.map(i => `${i.kind}:${i.id}`);
  assert.ok([`ar_receipt:${R1.id}`, `ar_receipt:${R2.id}`, `ar_receipt_reversal:${reversal.id}`].every(x => settledBy('tax_invoice', I1.id).includes(x)), 'the first invoice: the receipt, its reversal and the receipt that came back');
  assert.ok(settledBy('tax_invoice', I2.id).includes(`ar_allocation:${allocation.id}`), 'the second invoice: settled from cash on account');
  assert.deepEqual(settledBy('supplier_invoice', P1.id).sort(), [`supplier_payment:${partial.id}`, `supplier_payment:${batch.id}`, `supplier_payment:${again.id}`].sort(), 'the first supplier invoice: the partial payment and both batch transfers');
  assert.ok(traceOf('supplier_payment', batch.id).find(x => x.step === 'reversal').items.some(i => i.kind === 'supplier_payment_return' && i.id === returned.id), 'the returned transfer is the reversal of the batch payment');
  const linesOf = (kind, id) => traceOf(kind, id).find(x => x.step === 'bank_match').items.map(i => i.reference).sort();
  assert.deepEqual(linesOf('tax_invoice', I1.id), ['REV-SYN-R1', 'SYN-R1', 'SYN-R2-A', 'SYN-R2-B'], 'the first invoice: every statement line its cash crossed, both lines of the split receipt included');
  assert.deepEqual(traceOf('tax_invoice', I2.id).find(x => x.step === 'bank_match').items.map(i => [i.reference, i.via?.kind]), [['SYN-ACC-1', 'ar_account_receipt']], 'the second invoice: the line of the on-account receipt its allocation drew on');
  assert.deepEqual(traceOf('advance_reversal', advanceReversal.id).find(x => x.step === 'bank_match').items.map(i => i.shape), ['group'], 'a record inside a grouped bank line');
  assert.equal(traceOf('ar_receipt', R2.id).find(x => x.step === 'bank_match').items.length, 2, 'a receipt that arrived on two lines');
  // ما يبقى معلّقًا: لا شيء. الطابور فارغ، وحزمة الإقفال بلا مانع، وأعمار الموردين والعملاء فارغة.
  assert.deepEqual(exceptionsBoard(db, users.manager).exceptions.map(x => `${x.kind}:${x.title}`), [], 'no finance exception is left at month end');
  assert.deepEqual(runReport(db, users.manager, 'R35', { from: FROM, to: TO }).rows.filter(r => r.blocking === 'نعم'), [], 'nothing blocks the close of September');
  assert.deepEqual([runReport(db, users.manager, 'R41', { from: FROM, to: TO }).rows.length, runReport(db, users.manager, 'R31', { from: FROM, to: TO }).rows.length], [0, 0]);
  // الرصيد الافتتاحي للتنبؤ من التسوية المعتمدة: رصيد الدفتر اليوم على الحساب المطابق.
  const forecast = cashForecastBoard(db, users.manager);
  assert.deepEqual([forecast.opening.source, forecast.opening_balance_minor, forecast.opening.accounts[0].reconciled_to], ['bank_reconciliation', halalas('106480'), TO]);
  // حزمة التدقيق تخرج ملفًا وتُفحص سلسلتها وبصمتها بلا المنصة.
  const pkg = JSON.parse(JSON.stringify(tx(() => exportAuditPackage(db, users.third, { month: MONTH }))));
  const verified = verifyAuditPackage(pkg);
  assert.deepEqual([verified.ok, verified.problems], [true, []]);
  assert.ok(pkg.journals.length >= 20 && pkg.documents.length === documents.length, 'the package carries the month\'s journals and documents');
  assert.ok(pkg.journals.some(j => j.id === adjustment.id && j.entry_date === TO), 'including the dated adjustment');
  assert.equal(pkg.trial_balance.balanced, true);
  assert.ok(verifyAudit(db), 'and the platform\'s own chain is intact');
});
