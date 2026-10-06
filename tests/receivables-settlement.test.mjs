// الحزمة 3 — التحصيل والتسوية: ارتداد القبض، وإلغاء الاستحقاق، والنزاع والوعد بالسداد، والقبض على الحساب وتخصيصه.
// لماذا هذا الملف: مسبارٌ على 3d1d84c (docs/testing/p3-receivables-settlement-probe-20260930.txt) أثبت أن جداول العكس
// والنزاع والوعد لا يكتبها شيء، وأن القبض المرتد لا يُسجَّل، وأن الاستحقاق يُلغى بتعديل مباشر بلا اعتماد، وأن حوالةً
// واحدة لاستحقاقين أو دفعةً قبل استحقاقها لا مكان لها. كل اختبار هنا يقيس واحدة منها بالمسارات الحقيقية.
// كل البيانات مصطنعة: عملاء ومراجع حوالات لا وجود لها، في قاعدة بالذاكرة (أو ملف مؤقت لسباق العمليتين).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openDb, verifyAudit, now } from '../app/db.mjs';
import * as ar from '../app/receivables.mjs';
import * as ledger from '../app/ledger.mjs';
import { createLead, commercialAction } from '../app/commercial.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote, approverFor, scheduleFor } from './proposal-fixture.mjs';
import { recordCompanyProfile, approveCompanyProfile, recordCustomerProfile, prepareInvoice, prepareCreditNote, invoiceAction, getInvoice } from '../app/invoices.mjs';
import { financialChecklist, collectionAxis } from '../app/project-axes.mjs';
import { collect, labelFor, inbox, clearInboxCache } from '../app/inbox.mjs';
import { createOnce } from '../app/idempotency.mjs';
import { createApp } from '../app/server.mjs';
import { receivablesUI } from '../app/static/receivables-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { ledgerMonth } from './ledger-fixture.mjs';
import { dispatch } from './definitions-fixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'tests/receivables-settlement-worker.mjs');
const PASSWORD = 'synthetic-ledger-completeness';
const EVIDENCE = 'إشعار بنكي مصطنع محفوظ في ملف التحصيل';
const address = { building: '1234', street: 'طريق مصطنع', district: 'حي الاختبار', city: 'الرياض', postal_code: '12345', country: 'SA' };
const plus = (day, days) => new Date(Date.parse(day + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const thrown = run => { try { run(); } catch (error) { return error; } assert.fail('expected a refusal'); };
const balanceOf = (db, accountCode) => db.prepare("SELECT COALESCE(SUM(l.debit_minor)-SUM(l.credit_minor),0) AS n FROM finance_lines l JOIN finance_journals j ON j.id=l.journal_id JOIN finance_accounts a ON a.id=l.account_id WHERE j.status='posted' AND a.code=?").get(accountCode).n;

// شهر الدفتر المصطنع (tests/ledger-fixture.mjs) ومعه عميلٌ ببنود يختارها كل اختبار، ومساعدات التحصيل.
// الأدوار في الشهر: employee يعدّ (prepare)، وmanager يعدّ ويعتمد، وoutsider يعتمد ولا يعدّ.
function month(t) {
  const m = ledgerMonth(t), { db, users, tx } = m;
  const step = (who, doc, action, input = {}) => tx(() => invoiceAction(db, users[who], doc.id, action, { version: doc.version, ...input }));
  const issue = id => step('manager', step('employee', getInvoice(db, users.employee, id), 'submit'), 'issue');
  const ensureSeller = () => {
    if (db.prepare("SELECT 1 FROM company_tax_profiles WHERE tenant_id='36t' AND approved_by IS NOT NULL").get()) return;
    const sellerId = tx(() => recordCompanyProfile(db, users.employee, { legal_name: 'شركة 3,6T المصطنعة', vat_number: '300000000000003', cr_number: '1010000001', address, effective_from: '2026-01-01' })).id;
    tx(() => approveCompanyProfile(db, users.manager, sellerId, { note: 'طابقنا الشهادة المصطنعة' }));
  };
  // عميل بعقد ومشروع وبنود بنسبة 15%: المبلغ الشامل للبند 100.00 هو 115.00. claimed: البنود التي تُطالَب الآن.
  function customer({ lines = [['حملة مصطنعة أولى', '100.00'], ['تقرير مصطنع ثانٍ', '200.00']], due = '2099-12-15', claimed = lines.map((_, i) => i), invoice = true } = {}) {
    const tag = randomUUID().slice(0, 8);
    const act = (who, c, action, input = {}) => tx(() => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
    let c = tx(() => dealFor(db, users.employee, { name: `عميل تحصيل مصطنع ${tag}`, registration_number: `SET-${tag}`, contact: 'جهة مصطنعة', source: 'اختبار', sector: 'تجريبي' }));
    c = act('employee', c, 'qualify', { need: 'مخرجات مصطنعة', budget: '1000.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل عميل', service_fit: 'مناسب للاختبار' });
    c = act('manager', c, 'approve_qualification', { note: 'تأهيل معتمد' });
    c = act('employee', c, 'save_quote', boundQuote(db, c.id, { scope: 'مخرجات مصطنعة', currency: 'SAR', valid_until: '2099-12-01',
      lines: lines.map(([description, unit_price]) => ({ description, quantity: '1', unit_price, unit_cost: '20.00', discount: '0', tax_rate: '15', acceptance: 'قبول بدليل', revisions: 1 })) }));
    c = act('employee', c, 'submit_quote'); c = act('manager', c, 'approve_quote', { note: 'عرض معتمد' });
    c = act('employee', c, 'register_contract', { agreement_evidence: 'اتفاق داخلي مصطنع موثق', customer_representative: 'ممثل مصطنع' });
    // منذ الترحيل 183 لا استحقاق بلا جدول دفعات بشروطه: دفعة عند قبول كل بند بقيمته (tests/proposal-fixture.mjs scheduleFor).
    scheduleFor(db, c.id);
    c = act('manager', c, 'create_project', { member_ids: [] });
    ensureSeller();
    tx(() => recordCustomerProfile(db, users.employee, { case_id: c.id, legal_name: `شركة العميل المصطنعة ${tag}`, vat_number: '310000000000003', address, source: 'شهادة مصطنعة من العميل' }));
    const gross = index => (Number(lines[index][1]) * 1.15).toFixed(2);
    const claimLine = (index, { stage = 'approved', dueDate = due, invoiceIt = invoice } = {}) => {
      c = act('employee', c, 'submit_delivery', { line_index: index, evidence: `مرجع تسليم مصطنع للبند ${index + 1}` });
      // المخرج بسطره: قائمة المخرجات مرتبة بالبند، فآخرها ليس بالضرورة ما سُلّم للتو حين تُطالَب البنود بغير ترتيبها.
      const delivery = c.deliveries.filter(d => d.line_index === index).at(-1);
      c = act('manager', c, 'accept_delivery', { delivery_id: delivery.id, note: 'مطابق للمعيار', acceptance_evidence: 'مرجع قبول مصطنع', approver_id: approverFor(db, c.project_id) });
      let claim = tx(() => ar.createClaim(db, users.employee, { delivery_id: delivery.id, amount: gross(index), due_date: dueDate, entitlement_evidence: 'العقد والقبول يدعمان الاستحقاق المصطنع' }));
      if (stage === 'draft') return { claim, invoice: null };
      claim = tx(() => ar.claimAction(db, users.employee, claim.id, 'submit', { version: claim.version }));
      claim = tx(() => ar.claimAction(db, users.manager, claim.id, 'approve', { version: claim.version, note: 'استحقاق معتمد' }));
      const doc = invoiceIt ? issue(tx(() => prepareInvoice(db, users.employee, { claim_id: claim.id, supply_date: m.day, vat_category: 'standard' })).id) : null;
      return { claim, invoice: doc };
    };
    const made = claimed.map(index => claimLine(index));
    return { case: c, project: db.prepare('SELECT * FROM projects WHERE id=?').get(c.project_id), claims: made.map(x => x.claim), invoices: made.map(x => x.invoice), claimLine };
  }
  const creditNote = (invoice, amount) => issue(tx(() => prepareCreditNote(db, users.employee, invoice.id, { amount, reason: 'تصحيح مصطنع متفق عليه مع العميل' })).id);
  // قبض مباشر على استحقاق: يسجّله employee ويطابقه manager.
  const receipt = (claim, amount, reference, { received_on = m.day, confirm = true } = {}) => {
    const r = tx(() => ar.recordReceipt(db, users.employee, claim.id, { reference, amount, received_on, payer: 'شركة العميل المصطنعة', evidence: EVIDENCE }));
    if (confirm) tx(() => ar.receiptAction(db, users.manager, claim.id, r.id, 'confirm', { note: 'طابقت كشف الحساب', matching_evidence: 'سطر كشف حساب مصطنع مطابق للمبلغ والتاريخ' }));
    return db.prepare('SELECT * FROM ar_receipts WHERE id=?').get(r.id);
  };
  const reverse = (claim, r, who = 'employee', input = {}) => tx(() => ar.requestReceiptReversal(db, users[who], claim.id, r.id,
    { reason: 'الشيك رجع من بنك العميل لعدم كفاية الرصيد', evidence: 'إشعار ارتداد مصطنع من البنك محفوظ', effective_on: m.day, ...input }));
  const decide = (claim, adjustment, who, action = 'approve', note = 'طابقت الطلب مع المستندات') => tx(() => ar.decideAdjustment(db, users[who], claim.id, adjustment.id, action, { note }));
  const onAccount = (caseId, amount, reference, who = 'employee', input = {}) => tx(() => ar.recordAccountReceipt(db, users[who],
    { case_id: caseId, reference, amount, received_on: m.day, payer: 'شركة العميل المصطنعة', evidence: EVIDENCE, ...input }));
  const confirmAccount = (x, who = 'manager') => tx(() => ar.accountReceiptAction(db, users[who], x.id, 'confirm', { note: 'طابقت المبلغ مع الكشف', matching_evidence: 'سطر كشف حساب مصطنع بالمبلغ والتاريخ' }));
  const allocate = (x, lines, who = 'outsider') => tx(() => ar.allocateReceipt(db, users[who], x.id, { lines, note: 'تخصيص الحوالة على استحقاقات العميل حسب كتابه' }));
  const claimOf = (who, id) => ar.listReceivables(db, users[who]).claims.find(c => c.id === id);
  const account = (who, id) => ar.listReceivables(db, users[who]).account_receipts.find(x => x.id === id);
  const control = key => ledger.controlReconciliation(db, '36t', m.day).controls.find(c => c.key === key);
  const post = (kind, id) => m.post(m.journal(kind, id));
  return { ...m, customer, creditNote, receipt, reverse, decide, onAccount, confirmAccount, allocate, claimOf, account, control, post, postJournal: m.post };
}

/* ───── (1) ارتداد القبض: سجل جديد يعتمده ثالث، وصف القبض لا يُمس ───── */
test('reversal: a bounced receipt is reversed by a new record a third person approves; the receipt row stays as it was and the claim balance reopens', t => {
  const m = month(t), { db } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']] });
  const [claim] = k.claims;
  const r = m.receipt(claim, '115.00', 'SYN-CHQ-1');
  assert.equal(m.claimOf('manager', claim.id).balance_minor, '0');
  const before = db.prepare('SELECT * FROM ar_receipts WHERE id=?').get(r.id);
  const request = m.reverse(claim, r);
  assert.deepEqual([request.kind, request.status, request.amount_minor, request.effective_on], ['receipt_reversal', 'pending', '11500', m.day]);
  let view = m.claimOf('manager', claim.id);
  assert.equal(view.balance_minor, '0', 'a pending request does not reopen anything yet');
  assert.deepEqual([view.receipts[0].effective_status, view.receipts[0].reversal.status], ['confirmed', 'pending']);
  assert.equal(thrown(() => m.decide(claim, request, 'manager')).code, 'reversal_not_independent', 'the matcher of the receipt does not approve its reversal');
  assert.equal(thrown(() => m.decide(claim, request, 'employee')).code, 'receivable_access_denied');
  view = m.decide(claim, request, 'outsider', 'approve', 'طابقت إشعار الارتداد مع كشف البنك');
  assert.deepEqual([view.balance_minor, view.confirmed_minor, view.receipts[0].status, view.receipts[0].effective_status], ['11500', '0', 'confirmed', 'reversed']);
  assert.deepEqual(db.prepare('SELECT * FROM ar_receipts WHERE id=?').get(r.id), before, 'the receipt row is not edited: the reversal is its own record');
  assert.ok(m.claimOf('employee', claim.id).actions.includes('record_receipt'), 'the reopened balance can be collected again');
  assert.equal(thrown(() => m.reverse(claim, r)).code, 'receipt_already_reversed');
  assert.throws(() => db.prepare("UPDATE ar_adjustments SET status='rejected' WHERE id=?").run(request.id), /independent decision/);
  assert.throws(() => db.prepare('DELETE FROM ar_adjustments WHERE id=?').run(request.id), /immutable/);
  assert.ok(verifyAudit(db));
});

test('reversal: the database keeps the requester, the recorder and the matcher out of the approval, and the decision inside the tenant', t => {
  const m = month(t), { db } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']] });
  const [claim] = k.claims;
  const r = m.receipt(claim, '115.00', 'SYN-CHQ-2');
  const request = m.reverse(claim, r, 'manager');
  const direct = who => () => db.prepare("UPDATE ar_adjustments SET status='approved',decided_by=?,decision_note='اعتماد مباشر',decided_at=? WHERE id=?").run(who, now(), request.id);
  assert.throws(direct('manager'), /independent/, 'the requester (who also matched it)');
  assert.throws(direct('employee'), /neither the recorder nor the matcher/, 'the recorder');
  assert.throws(direct('external'), /inside its tenant/, 'a user of another tenant');
  direct('outsider')();
  assert.equal(m.claimOf('manager', claim.id).balance_minor, '11500');
});

test('reversal: what cannot be reversed is refused by name, and a rejected request leaves the money collected', t => {
  const m = month(t);
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00'], ['تقرير مصطنع', '200.00']] });
  const [one, two] = k.claims;
  const pending = m.receipt(one, '50.00', 'SYN-PEND-1', { confirm: false });
  assert.equal(thrown(() => m.reverse(one, pending)).code, 'receipt_not_confirmed');
  const done = m.receipt(one, '65.00', 'SYN-DONE-1');
  assert.equal(thrown(() => m.reverse(two, done)).code, 'receipt_not_found', 'a receipt is reversed on its own claim');
  assert.equal(thrown(() => m.reverse(one, done, 'employee', { effective_on: plus(m.day, -1) })).code, 'reversal_date', 'the bank cannot return money before it arrived');
  assert.equal(thrown(() => m.reverse(one, done, 'employee', { effective_on: plus(m.day, 1) })).code, 'reversal_date', 'nor in the future');
  assert.equal(thrown(() => m.reverse(one, done, 'employee', { reason: 'قصير' })).code, 'invalid_text');
  assert.equal(thrown(() => m.reverse(one, done, 'outsider')).code, 'receivable_access_denied', 'asking for a reversal needs the prepare capability');
  const request = m.reverse(one, done);
  const again = thrown(() => m.reverse(one, done, 'manager'));
  assert.equal(again.code, 'reversal_already_requested');
  assert.ok(again.details.refusal.what.length > 10, 'a written refusal, not a bare code');
  const kept = m.decide(one, request, 'outsider', 'reject', 'الحوالة ظاهرة في كشف البنك وما ارتدت');
  assert.equal(kept.receipts.find(x => x.id === done.id).effective_status, 'confirmed');
  assert.equal(kept.adjustments.find(a => a.id === request.id).status, 'rejected');
  assert.equal(thrown(() => m.decide(one, request, 'outsider')).code, 'adjustment_decided');
  assert.equal(m.reverse(one, done, 'manager').status, 'pending', 'after a rejection a new request can be made');
});

/* ───── (2) إلغاء الاستحقاق: باعتماد مستقل، وممنوع وما يقوم عليه قائم ───── */
test('cancellation: an open claim is cancelled only by an independent approval, never while a receipt or an uncorrected invoice stands on it', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']] });
  const [claim] = k.claims, [invoice] = k.invoices;
  const r = m.receipt(claim, '115.00', 'SYN-CAN-1');
  const ask = (who = 'employee') => m.tx(() => ar.requestClaimCancel(db, users[who], claim.id, { reason: 'العميل ألغى البند باتفاق مكتوب', evidence: 'خطاب إلغاء مصطنع من العميل محفوظ' }));
  const refusal = thrown(() => ask());
  assert.equal(refusal.code, 'claim_not_cancellable');
  assert.deepEqual(refusal.details.refusal.missing.map(x => x.doc_key), ['receipts', 'invoice']);
  m.decide(claim, m.reverse(claim, r), 'outsider');
  assert.deepEqual(thrown(() => ask()).details.refusal.missing.map(x => x.doc_key), ['invoice'], 'the bounced receipt no longer stands; the issued invoice does');
  m.creditNote(invoice, '115.00');
  const request = ask();
  assert.deepEqual([request.kind, request.status, request.amount_minor], ['claim_cancel', 'pending', '0']);
  assert.equal(thrown(() => ask('manager')).code, 'cancel_already_requested');
  assert.equal(thrown(() => m.decide(claim, request, 'employee')).code, 'receivable_access_denied');
  const cancelled = m.decide(claim, request, 'manager', 'approve', 'راجعت خطاب الإلغاء والإشعار الدائن');
  assert.deepEqual([cancelled.status, cancelled.aging_bucket], ['cancelled', 'ملغى']);
  assert.equal(db.prepare('SELECT action FROM ar_history WHERE claim_id=? ORDER BY version DESC LIMIT 1').get(claim.id).action, 'cancelled');
  assert.ok(verifyAudit(db));
});

test('cancellation: the database refuses a cancellation nobody approved, a pending claim is returned instead, and a cancelled draft frees its delivery', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00'], ['تقرير مصطنع', '200.00']], claimed: [0], invoice: false });
  const [approved] = k.claims;
  assert.throws(() => db.prepare("UPDATE ar_claims SET status='cancelled',version=version+1 WHERE id=?").run(approved.id), /approved, independently decided cancellation/);
  const input = { reason: 'استحقاق أُعد على بند خطأ ويُعاد إعداده', evidence: 'مذكرة داخلية مصطنعة بالتصحيح' };
  // طلب على استحقاق نظيف، ثم قبضٌ يُسجَّل قبل القرار: القرار يعيد الفحص ويرفض.
  const early = m.tx(() => ar.requestClaimCancel(db, users.employee, approved.id, input));
  m.receipt(approved, '10.00', 'SYN-LATE-1', { confirm: false });
  const late = thrown(() => m.decide(approved, early, 'manager'));
  assert.equal(late.code, 'claim_not_cancellable');
  assert.deepEqual(late.details.refusal.missing.map(x => x.doc_key), ['receipts']);
  const { claim: draft } = k.claimLine(1, { stage: 'draft' });
  const request = m.tx(() => ar.requestClaimCancel(db, users.employee, draft.id, input));
  assert.equal(thrown(() => m.decide(draft, request, 'employee')).code, 'receivable_access_denied');
  assert.equal(m.decide(draft, request, 'manager').status, 'cancelled');
  const again = m.tx(() => ar.createClaim(db, users.employee, { delivery_id: draft.delivery_id, amount: '230.00', due_date: '2099-12-15', entitlement_evidence: 'العقد والقبول يدعمان الاستحقاق المصطنع' }));
  assert.equal(again.status, 'draft', 'the delivery can be claimed again once its claim is cancelled');
  const submitted = m.tx(() => ar.claimAction(db, users.employee, again.id, 'submit', { version: again.version }));
  assert.equal(thrown(() => m.tx(() => ar.requestClaimCancel(db, users.employee, submitted.id, input))).code, 'claim_state');
});

/* ───── (3) النزاع والوعد بالسداد ───── */
test('disputes: an open dispute moves the claim to the disputed bucket and pauses follow-up until someone else resolves it with evidence', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']], due: plus(m.day, -10) });
  const [claim] = k.claims;
  let view = m.claimOf('manager', claim.id);
  assert.deepEqual([view.aging_bucket, view.follow_up.state], ['متأخر', 'due']);
  const open = (input = {}, who = 'employee') => m.tx(() => ar.openDispute(db, users[who], claim.id,
    { amount: '40.00', reason: 'العميل يعترض على جودة جزء من التقرير', evidence: 'بريد اعتراض مصطنع من العميل محفوظ', ...input }));
  assert.equal(thrown(() => open({ amount: '115.01' })).code, 'dispute_exceeds_balance');
  assert.equal(thrown(() => open({}, 'outsider')).code, 'receivable_access_denied');
  const dispute = open();
  assert.equal(dispute.state, 'open');
  view = m.claimOf('manager', claim.id);
  assert.deepEqual([view.aging_bucket, view.disputed, view.follow_up.state], ['متنازع عليه', true, 'paused']);
  assert.equal(thrown(() => open()).code, 'dispute_already_open');
  assert.ok(view.actions.includes('resolve_dispute'), 'someone other than the opener is offered the resolution');
  assert.ok(!m.claimOf('employee', claim.id).actions.includes('resolve_dispute'));
  const resolution = { resolution_note: 'اتفقنا مع العميل على تسليم نسخة مصححة بدون خصم', resolution_evidence: 'محضر اجتماع مصطنع موقع من الطرفين' };
  const resolve = (who, id = dispute.id) => m.tx(() => ar.resolveDispute(db, users[who], claim.id, id, resolution));
  assert.equal(thrown(() => resolve('employee')).code, 'receivable_access_denied');
  view = resolve('manager');
  assert.deepEqual([view.aging_bucket, view.disputes[0].state, view.follow_up.state], ['متأخر', 'resolved', 'due']);
  assert.equal(thrown(() => resolve('manager')).code, 'dispute_resolved');
  const second = open({}, 'manager');
  assert.equal(thrown(() => resolve('manager', second.id)).code, 'dispute_not_independent');
  assert.throws(() => db.prepare('UPDATE ar_disputes SET resolved_by=?,resolution_note=?,resolution_evidence=?,resolved_at=? WHERE id=?').run('manager', 'حسم ذاتي مباشر', 'دليل حسم ذاتي', now(), second.id), /independent documented resolution/);
  assert.throws(() => db.prepare('DELETE FROM ar_disputes WHERE id=?').run(second.id), /immutable/);
  assert.ok(verifyAudit(db));
});

test('promises: a promise to pay has an amount and a date; kept and broken are read from receipts, and a bounced receipt breaks a kept promise', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']], due: plus(m.day, -20), invoice: false });
  const [claim] = k.claims;
  const promise = (input = {}, who = 'employee') => m.tx(() => ar.recordPromise(db, users[who], claim.id,
    { amount: '60.00', promised_on: plus(m.day, 7), contact: 'مدير مالية العميل المصطنع', evidence: 'مكالمة مصطنعة موثقة في سجل التحصيل', ...input }));
  assert.equal(thrown(() => promise({ promised_on: plus(m.day, -1) })).code, 'promise_date');
  assert.equal(thrown(() => promise({ amount: '115.01' })).code, 'promise_exceeds_balance');
  assert.equal(thrown(() => promise({}, 'outsider')).code, 'receivable_access_denied');
  const open = promise();
  assert.equal(open.state, 'open');
  assert.equal(m.claimOf('manager', claim.id).follow_up.state, 'awaiting_promise', 'an open promise holds the follow-up until its date');
  // وعدٌ قديم (قبل عشرة أيام لموعدٍ قبل ثلاثة) يُدرج كسجلٍ تاريخي: المسار يرفض تاريخًا مضى.
  const past = randomUUID();
  db.prepare('INSERT INTO ar_promises VALUES(?,?,?,?,?,?,?,?)').run(past, claim.id, '5000', plus(m.day, -3), 'مدير مالية العميل المصطنع', 'مكالمة مصطنعة قديمة موثقة', users.employee.id, `${plus(m.day, -10)}T09:00:00.000Z`);
  const stateOf = id => m.claimOf('manager', claim.id).promises.find(p => p.id === id);
  assert.deepEqual([stateOf(past).state, stateOf(past).collected_minor], ['broken', '0']);
  const r = m.receipt(claim, '50.00', 'SYN-PROM-1', { received_on: plus(m.day, -5) });
  assert.deepEqual([stateOf(past).state, stateOf(past).collected_minor], ['kept', '5000'], 'money that arrived inside the window keeps the promise');
  m.decide(claim, m.reverse(claim, r), 'outsider');
  assert.equal(stateOf(past).state, 'broken', 'the bounce breaks it again');
  assert.equal(stateOf(open.id).state, 'open');
  assert.throws(() => db.prepare("UPDATE ar_promises SET amount_minor='1' WHERE id=?").run(open.id), /immutable/);
  assert.throws(() => db.prepare('INSERT INTO ar_promises VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), claim.id, '100', plus(m.day, -2), 'جهة', 'دليل مصطنع كافٍ', users.employee.id, now()), /on or after the day it was made/);
});

/* ───── (4) القبض على الحساب وتخصيصه ───── */
test('on account: one transfer for two claims is recorded once, matched by another person and allocated across both by someone other than its recorder', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer();
  const [one, two] = k.claims;
  const x = m.onAccount(k.case.id, '345.00', 'SYN-TRF-2C', 'manager');
  assert.deepEqual([x.status, x.unallocated_minor], ['pending', '0']);
  assert.equal(thrown(() => m.confirmAccount(x, 'manager')).code, 'self_approval');
  m.confirmAccount(x, 'outsider');
  assert.equal(m.account('outsider', x.id).unallocated_minor, '34500');
  assert.ok(m.account('outsider', x.id).actions.includes('allocate'));
  assert.ok(!m.account('manager', x.id).actions.includes('allocate'), 'the recorder is not offered the allocation');
  assert.equal(thrown(() => m.allocate(x, [{ claim_id: one.id, amount: '115.00' }], 'manager')).code, 'allocation_not_independent');
  assert.equal(thrown(() => m.allocate(x, [{ claim_id: one.id, amount: '115.01' }])).code, 'allocation_exceeds_claim');
  assert.equal(thrown(() => m.allocate(x, [{ claim_id: one.id, amount: '10.00' }, { claim_id: one.id, amount: '1.00' }])).code, 'allocation_lines');
  assert.equal(thrown(() => m.allocate(x, [])).code, 'allocation_lines');
  const other = m.customer({ lines: [['حملة لعميل آخر', '100.00']] });
  assert.equal(thrown(() => m.allocate(x, [{ claim_id: other.claims[0].id, amount: '10.00' }])).code, 'allocation_other_customer');
  const after = m.allocate(x, [{ claim_id: one.id, amount: '115.00' }, { claim_id: two.id, amount: '230.00' }]);
  assert.deepEqual([after.unallocated_minor, after.allocated_minor, after.allocations.length], ['0', '34500', 2]);
  for (const [c, allocated] of [[one, '11500'], [two, '23000']]) {
    const v = m.claimOf('manager', c.id);
    assert.deepEqual([v.balance_minor, v.allocated_minor, v.aging_bucket], ['0', allocated, 'مسدد داخليًا']);
  }
  assert.equal(thrown(() => m.allocate(x, [{ claim_id: two.id, amount: '0.01' }])).code, 'allocation_exceeds_receipt');
  assert.equal(thrown(() => m.receipt(one, '0.01', 'SYN-EXTRA-1', { confirm: false })).code, 'over_allocation', 'a direct receipt cannot collect what the allocation already covered');
  const allocation = after.allocations.find(a => a.claim_id === two.id);
  const undo = (who = 'outsider') => m.tx(() => ar.reverseAllocation(db, users[who], x.id, allocation.id, { reason: 'خُصص على البند الخطأ حسب كتاب العميل' }));
  assert.equal(thrown(() => undo('manager')).code, 'allocation_not_independent');
  const reversed = undo();
  assert.equal(reversed.unallocated_minor, '23000');
  assert.equal(m.claimOf('manager', two.id).balance_minor, '23000');
  assert.equal(thrown(() => undo()).code, 'allocation_already_reversed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ar_allocations WHERE account_receipt_id=?').get(x.id).n, 3, 'the reversal is a third row; nothing was edited');
  assert.throws(() => db.prepare("UPDATE ar_allocations SET amount_minor='1' WHERE id=?").run(allocation.id), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM ar_allocations WHERE id=?').run(allocation.id), /append-only/);
  m.allocate(x, [{ claim_id: two.id, amount: '230.00' }]);
  assert.equal(m.claimOf('manager', two.id).balance_minor, '0');
  assert.ok(verifyAudit(db));
});

test('on account: a payment that arrives before its claim waits unapplied and is allocated once the claim is approved', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer({ claimed: [] });
  const x = m.onAccount(k.case.id, '230.00', 'SYN-EARLY-1');
  m.confirmAccount(x);
  let view = m.account('outsider', x.id);
  assert.deepEqual([view.unallocated_minor, view.eligible_claims, view.actions.includes('allocate')], ['23000', [], false], 'nothing to allocate to yet');
  const { claim } = k.claimLine(1);
  view = m.account('outsider', x.id);
  assert.deepEqual(view.eligible_claims.map(c => [c.id, c.room_minor]), [[claim.id, '23000']]);
  assert.ok(view.actions.includes('allocate'));
  m.allocate(x, [{ claim_id: claim.id, amount: '230.00' }]);
  assert.equal(m.claimOf('manager', claim.id).balance_minor, '0');
  const lead = m.tx(() => dealFor(db, users.employee, { name: 'عميل محتمل مصطنع', registration_number: `SET-LEAD-${randomUUID().slice(0, 6)}`, contact: 'جهة مصطنعة', source: 'اختبار', sector: 'تجريبي' }));
  assert.equal(thrown(() => m.onAccount(lead.id, '10.00', 'SYN-LEAD-1')).code, 'customer_not_contracted');
  assert.equal(thrown(() => m.onAccount(k.case.id, '10.00', 'syn-early-1')).code, 'duplicate_receipt_reference', 'the reference is normalised before it is compared');
  const { claim: first } = k.claimLine(0);
  assert.equal(thrown(() => m.receipt(first, '1.00', 'SYN-EARLY-1', { confirm: false })).code, 'duplicate_receipt_reference', 'nor recorded again on a claim');
  assert.throws(() => db.prepare("INSERT INTO ar_receipts VALUES(?,?,?,?,?,?,?,?,?,'pending',?)").run(randomUUID(), first.id, '36t', 'SYN-EARLY-1', '100', m.day, 'دافع', 'دليل مصطنع كافٍ', 'employee', now()), /used once in its tenant/);
  assert.equal(thrown(() => m.onAccount(k.case.id, '10.00', 'SYN-FUT-1', 'employee', { received_on: plus(m.day, 1) })).code, 'future_receipt');
  assert.equal(thrown(() => m.onAccount(k.case.id, '10.00', 'SYN-OUT-1', 'outsider')).code, 'receivable_access_denied');
  // قبضٌ ما يطابق الكشف يُرفض مرة ولا يُخصَّص منه شيء، ومرجعه يبقى مستعملًا فلا يُسجَّل التحويل نفسه مرتين.
  const wrong = m.onAccount(k.case.id, '10.00', 'SYN-WRONG-1');
  const rejected = m.tx(() => ar.accountReceiptAction(db, users.manager, wrong.id, 'reject', { note: 'المبلغ ما ظهر في الكشف', matching_evidence: 'كشف الحساب المصطنع لليوم بلا هالمبلغ' }));
  assert.deepEqual([rejected.status, rejected.actions, rejected.unallocated_minor], ['rejected', [], '0']);
  assert.equal(thrown(() => m.confirmAccount(wrong, 'outsider')).code, 'account_receipt_not_pending', 'the decision is final');
  assert.equal(thrown(() => m.allocate(wrong, [{ claim_id: first.id, amount: '10.00' }])).code, 'account_receipt_not_confirmed');
  assert.equal(thrown(() => m.onAccount(k.case.id, '10.00', 'SYN-WRONG-1')).code, 'duplicate_receipt_reference');
});

test('on account: a bounced transfer is reversed only after its allocations are undone, by someone who neither recorded nor matched it', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']] });
  const [claim] = k.claims;
  const x = m.onAccount(k.case.id, '115.00', 'SYN-BNC-1');
  m.confirmAccount(x);
  const allocated = m.allocate(x, [{ claim_id: claim.id, amount: '115.00' }]);
  const ask = (who = 'employee', input = {}) => m.tx(() => ar.requestAccountReversal(db, users[who], x.id, { reason: 'الحوالة ارتدت من بنك العميل', evidence: 'إشعار ارتداد مصطنع محفوظ', effective_on: m.day, ...input }));
  const blocked = thrown(() => ask());
  assert.equal(blocked.code, 'account_allocations_live');
  assert.deepEqual(blocked.details.refusal.missing.map(x => x.doc_key), ['allocations']);
  m.tx(() => ar.reverseAllocation(db, users.outsider, x.id, allocated.allocations[0].id, { reason: 'فك التخصيص لأن الحوالة ارتدت' }));
  const request = ask();
  assert.equal(request.status, 'pending');
  assert.equal(thrown(() => ask('manager')).code, 'reversal_already_requested');
  assert.equal(thrown(() => m.allocate(x, [{ claim_id: claim.id, amount: '1.00' }])).code, 'account_reversal_pending', 'cash that may have bounced is not allocated');
  const decide = (who, action = 'approve', id = request.id) => m.tx(() => ar.decideAccountReversal(db, users[who], x.id, id, action, { note: 'طابقت الارتداد مع كشف البنك' }));
  assert.equal(thrown(() => decide('manager')).code, 'account_reversal_not_independent', 'the matcher does not approve it');
  assert.equal(thrown(() => decide('employee')).code, 'receivable_access_denied');
  // رفض الطلب يعيد المال قابلًا للتخصيص، وطلبٌ جديد بعده يُعتمد.
  const kept = decide('outsider', 'reject');
  assert.deepEqual([kept.effective_status, kept.reversals.map(r => r.status), kept.actions.includes('allocate')], ['confirmed', ['rejected'], true]);
  const again = ask();
  const done = decide('outsider', 'approve', again.id);
  assert.deepEqual([done.effective_status, done.unallocated_minor], ['reversed', '0']);
  assert.equal(m.claimOf('manager', claim.id).balance_minor, '11500');
  assert.equal(thrown(() => decide('outsider', 'approve', again.id)).code, 'adjustment_decided');
  assert.equal(thrown(() => ask()).code, 'account_receipt_reversed');
  assert.throws(() => db.prepare('DELETE FROM ar_account_reversals WHERE id=?').run(request.id), /immutable/);
});

/* ───── (5) الدفتر: كل سلسلة تبقى مطابقة لحسابها الرقابي ───── */
test('ledger: receipt → reversal → re-receipt and on account → allocation → reversal → reallocation keep AR and customer advances tied to their control accounts, every journal balanced', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer();
  const [one, two] = k.claims;
  for (const invoice of k.invoices) m.post('tax_invoice', invoice.id);
  const first = m.receipt(one, '115.00', 'SYN-L-1'); m.post('ar_receipt', first.id);
  const reversal = m.reverse(one, first); m.decide(one, reversal, 'outsider');
  const waiting = m.control('receivable');
  assert.deepEqual(waiting.items.map(i => [i.reason, i.source_kind, i.difference_minor]), [['no_journal', 'ar_receipt_reversal', 11500]], 'before its journal the reversal is an itemised difference');
  const journal = m.journal('ar_receipt_reversal', reversal.id);
  assert.deepEqual(db.prepare('SELECT a.code,l.debit_minor,l.credit_minor FROM finance_lines l JOIN finance_accounts a ON a.id=l.account_id WHERE l.journal_id=? ORDER BY l.position').all(journal.id).map(l => [l.code, l.debit_minor, l.credit_minor]),
    [['1100', 11500, 0], ['1000', 0, 11500]], 'the reversal debits receivables and credits the bank');
  m.postJournal(journal);
  const second = m.receipt(one, '115.00', 'SYN-L-2'); m.post('ar_receipt', second.id);
  const x = m.onAccount(k.case.id, '230.00', 'SYN-L-3'); m.confirmAccount(x); m.post('ar_account_receipt', x.id);
  assert.deepEqual([m.control('customer_advances').subledger_minor, m.control('customer_advances').difference_minor], [23000, 0]);
  const a1 = m.allocate(x, [{ claim_id: two.id, amount: '230.00' }]).allocations[0]; m.post('ar_allocation', a1.id);
  const undone = m.tx(() => ar.reverseAllocation(db, users.outsider, x.id, a1.id, { reason: 'خُصص قبل مراجعة كتاب العميل' }));
  m.post('ar_allocation_reversal', undone.allocations.find(a => a.kind === 'reversal').id);
  const a2 = m.allocate(x, [{ claim_id: two.id, amount: '230.00' }]).allocations.find(a => a.kind === 'allocation' && a.id !== a1.id); m.post('ar_allocation', a2.id);
  const y = m.onAccount(k.case.id, '50.00', 'SYN-L-4'); m.confirmAccount(y); m.post('ar_account_receipt', y.id);
  const bounce = m.tx(() => ar.requestAccountReversal(db, users.employee, y.id, { reason: 'الحوالة ارتدت من بنك العميل', evidence: 'إشعار ارتداد مصطنع محفوظ', effective_on: m.day }));
  m.tx(() => ar.decideAccountReversal(db, users.outsider, y.id, bounce.id, 'approve', { note: 'طابقت الارتداد مع كشف البنك' }));
  m.post('ar_account_reversal', bounce.id);
  for (const key of ['receivable', 'customer_advances']) {
    const c = m.control(key);
    assert.deepEqual([c.subledger_minor, c.ledger_minor, c.difference_minor, c.balanced, c.items], [0, 0, 0, true, []], key);
  }
  assert.deepEqual(db.prepare('SELECT j.id FROM finance_journals j JOIN finance_lines l ON l.journal_id=j.id GROUP BY j.id HAVING SUM(l.debit_minor)<>SUM(l.credit_minor)').all(), [], 'every journal balances');
  const statements = ledger.statements(db, users.manager, { to: m.day });
  assert.equal(statements.balance_sheet.balanced, true);
  assert.deepEqual(statements.sources.filter(s => s.source_kind.startsWith('ar_') && s.journal_status !== 'posted'), [], 'no receivable document waits for a journal');
  assert.equal(balanceOf(db, '1000'), 34500, 'bank: 115 − 115 + 115 + 230 + 50 − 50');
});

test('trace: an invoice walks to its receipt, the bounce and the allocation that settled it, each with who asked, who approved and the posted journal', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']] });
  const [claim] = k.claims, [invoice] = k.invoices;
  m.post('tax_invoice', invoice.id);
  const r = m.receipt(claim, '115.00', 'SYN-T-1'); m.post('ar_receipt', r.id);
  const reversal = m.reverse(claim, r); m.decide(claim, reversal, 'outsider'); m.post('ar_receipt_reversal', reversal.id);
  const x = m.onAccount(k.case.id, '115.00', 'SYN-T-2'); m.confirmAccount(x); m.post('ar_account_receipt', x.id);
  const allocation = m.allocate(x, [{ claim_id: claim.id, amount: '115.00' }]).allocations[0]; m.post('ar_allocation', allocation.id);
  const step = (trace, key) => trace.chain.find(s => s.step === key);
  const trace = ledger.traceAmount(db, users.manager, { kind: 'tax_invoice', id: invoice.id });
  const settlement = step(trace, 'settlement');
  assert.equal(settlement.state, 'linked');
  assert.deepEqual(settlement.items.map(i => [i.kind, i.amount_minor]).sort(), [['ar_allocation', 11500], ['ar_receipt', 11500], ['ar_receipt_reversal', 11500]]);
  assert.ok(settlement.items.every(i => i.journal?.status === 'posted'), 'every movement that settled or unsettled the invoice is posted');
  const receipt = ledger.traceAmount(db, users.manager, { kind: 'ar_receipt', id: r.id });
  assert.deepEqual(step(receipt, 'reversal').items.map(i => [i.kind, i.id]), [['ar_receipt_reversal', reversal.id]]);
  const back = ledger.traceAmount(db, users.manager, { kind: 'ar_receipt_reversal', id: reversal.id });
  assert.deepEqual(step(back, 'approvals').items.map(a => a.actor_id), ['employee', 'outsider']);
  assert.equal(step(back, 'journal').items[0].status, 'posted');
  assert.deepEqual(step(back, 'settles').items.map(i => i.id), [r.id]);
  assert.equal(step(back, 'bank_match').state, 'none');
  assert.ok(step(back, 'bank_match').why.length > 10, 'the bank line gap is said, not left silent');
  const spent = ledger.traceAmount(db, users.manager, { kind: 'ar_allocation', id: allocation.id });
  assert.deepEqual(step(spent, 'settles').items.map(i => i.kind).sort(), ['ar_account_receipt', 'tax_invoice']);
  assert.deepEqual(step(spent, 'approvals').items.map(a => a.actor_id), ['employee', 'manager', 'outsider']);
  const cash = ledger.traceAmount(db, users.manager, { kind: 'ar_account_receipt', id: x.id });
  assert.deepEqual(step(cash, 'settlement').items.map(i => i.id), [allocation.id]);
});

/* ───── (6) العزل والتكرار والسباق ───── */
test('tenant isolation: another tenant neither sees nor touches these claims, receipts or cash on account', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']] });
  const [claim] = k.claims;
  const r = m.receipt(claim, '115.00', 'SYN-ISO-1');
  const x = m.onAccount(k.case.id, '50.00', 'SYN-ISO-2'); m.confirmAccount(x);
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) SELECT 'isolated-grantor','isolated','other','isolated-grantor','مانح مصطنع في الكيان الآخر',password_hash,'employee' FROM users WHERE id='external'");
  for (const action of ['read', 'prepare', 'approve']) db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), 'isolated', 'external', 'employee', action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'isolated-grantor', 'تفويض مصطنع في الكيان المعزول', null, now());
  const ext = users.external, board = ar.listReceivables(db, ext);
  assert.deepEqual([board.claims.length, board.account_receipts.length, board.customers.length], [0, 0, 0]);
  const reason = { reason: 'محاولة من كيان آخر مصطنعة', evidence: 'دليل مصطنع من كيان آخر' };
  for (const [label, run] of [
    ['reversal', () => ar.requestReceiptReversal(db, ext, claim.id, r.id, { ...reason, effective_on: m.day })],
    ['cancel', () => ar.requestClaimCancel(db, ext, claim.id, reason)],
    ['dispute', () => ar.openDispute(db, ext, claim.id, { ...reason, amount: '1.00' })],
    ['promise', () => ar.recordPromise(db, ext, claim.id, { amount: '1.00', promised_on: m.day, contact: 'جهة مصطنعة', evidence: 'دليل مصطنع من كيان آخر' })],
    ['on account', () => ar.recordAccountReceipt(db, ext, { case_id: k.case.id, reference: 'SYN-ISO-3', amount: '1.00', received_on: m.day, payer: 'دافع مصطنع', evidence: EVIDENCE })],
    ['confirm', () => ar.accountReceiptAction(db, ext, x.id, 'confirm', { note: 'مطابقة', matching_evidence: 'دليل مطابقة مصطنع' })],
    ['allocate', () => ar.allocateReceipt(db, ext, x.id, { lines: [{ claim_id: claim.id, amount: '1.00' }], note: 'تخصيص من كيان آخر' })],
    ['record', () => ar.getReceivableRecord(db, ext, 'account_receipt', x.id)]
  ]) assert.equal(thrown(() => m.tx(run)).status, 404, label);
});

test('idempotency: one key replays one cash-on-account record and one allocation; the same key with another body is refused', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']] });
  const body = { case_id: k.case.id, reference: 'SYN-IDEM-1', amount: '115.00', received_on: m.day, payer: 'شركة العميل المصطنعة', evidence: EVIDENCE };
  const record = input => m.tx(() => createOnce(db, users.employee, '/api/receivables/on-account', 'receivables-settlement-key-0001', input,
    () => ar.recordAccountReceipt(db, users.employee, input), id => ar.getReceivableRecord(db, users.employee, 'account_receipt', id)));
  const first = record(body), again = record(body);
  assert.equal(again.id, first.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ar_account_receipts').get().n, 1);
  assert.equal(thrown(() => record({ ...body, amount: '116.00' })).code, 'idempotency_conflict');
  m.confirmAccount(first);
  const input = { lines: [{ claim_id: k.claims[0].id, amount: '115.00' }], note: 'تخصيص الحوالة على الاستحقاق' };
  const allocate = () => m.tx(() => createOnce(db, users.outsider, `/api/receivables/on-account/${first.id}/allocations`, 'receivables-allocation-key-0001', input,
    () => ar.allocateReceipt(db, users.outsider, first.id, input), id => ar.getReceivableRecord(db, users.outsider, 'account_receipt', id)));
  allocate(); allocate();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ar_allocations WHERE kind='allocation'").get().n, 1, 'a retried click does not allocate twice');
});

function race(path, jobs) {
  const startAt = Date.now() + 2500;
  return Promise.all(jobs.map((job, index) => new Promise(done => {
    const child = spawn(process.execPath, [WORKER, path, job.operation, job.user, JSON.stringify(job.args), String(startAt)], { cwd: ROOT });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', () => { try { done(JSON.parse(out.trim().split('\n').pop())); } catch { done({ index, ok: false, error: 'no output' }); } });
  })));
}
test('race: two processes asking for and approving the same reversal, and two allocating the same cash beyond it, leave one reversal and no over-allocation', { timeout: 120000 }, async t => {
  const m = month(t), { db } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']] });
  const r = m.receipt(k.claims[0], '115.00', 'SYN-RACE-1');
  const w = m.customer({ lines: [['حملة مصطنعة أولى', '200.00'], ['حملة مصطنعة ثانية', '200.00']] });
  const x = m.onAccount(w.case.id, '300.00', 'SYN-RACE-2'); m.confirmAccount(x);
  const dir = mkdtempSync(join(tmpdir(), '36t-receivables-race-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'race.sqlite');
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  openDb(path).close();
  const input = { reason: 'الشيك رجع من بنك العميل لعدم كفاية الرصيد', evidence: 'إشعار ارتداد مصطنع من البنك محفوظ', effective_on: m.day };
  const asked = await race(path, ['employee', 'manager'].map(user => ({ operation: 'request_reversal', user, args: { claim_id: k.claims[0].id, receipt_id: r.id, input } })));
  assert.equal(asked.filter(x => x.ok).length, 1, 'one request: ' + JSON.stringify(asked));
  assert.deepEqual(asked.filter(x => !x.ok).map(x => x.error), ['reversal_already_requested'], 'the other is refused by name: ' + JSON.stringify(asked));
  const file = () => { const f = openDb(path); t.after(() => f.close()); return f; };
  const adjustment = file().prepare("SELECT id FROM ar_adjustments WHERE receipt_id=? AND status='pending'").get(r.id).id;
  const approved = await race(path, [0, 1].map(() => ({ operation: 'approve_reversal', user: 'outsider', args: { claim_id: k.claims[0].id, adjustment_id: adjustment, input: { note: 'طابقت إشعار الارتداد مع كشف البنك' } } })));
  assert.equal(approved.filter(x => x.ok).length, 1, 'one approval: ' + JSON.stringify(approved));
  assert.deepEqual(approved.filter(x => !x.ok).map(x => x.error), ['adjustment_decided'], JSON.stringify(approved));
  const spent = await race(path, [['manager', w.claims[0]], ['outsider', w.claims[1]]].map(([user, claim]) => ({ operation: 'allocate', user,
    args: { account_receipt_id: x.id, input: { lines: [{ claim_id: claim.id, amount: '200.00' }], note: 'تخصيص متزامن مصطنع' } } })));
  assert.equal(spent.filter(x => x.ok).length, 1, 'one allocation fits: ' + JSON.stringify(spent));
  assert.deepEqual(spent.filter(x => !x.ok).map(x => x.error), ['allocation_exceeds_receipt'], JSON.stringify(spent));
  const after = file();
  assert.equal(after.prepare("SELECT COUNT(*) AS n FROM ar_adjustments WHERE receipt_id=? AND status='approved'").get(r.id).n, 1);
  assert.deepEqual({ ...after.prepare('SELECT net_minor,received_minor FROM ar_claim_collection WHERE claim_id=?').get(k.claims[0].id) }, { net_minor: 11500, received_minor: 0 }, 'the claim reopened once, not twice');
  assert.equal(after.prepare("SELECT SUM(CAST(amount_minor AS INTEGER)) AS n FROM ar_allocations WHERE account_receipt_id=? AND kind='allocation'").get(x.id).n, 20000);
  assert.ok(verifyAudit(after));
});

/* ───── (7) قائمة إقفال المشروع تبقى صادقة ───── */
test('project closure checklist stays true: a reversal reopens collection, pending decisions and open disputes are named, cash on account and the new documents are counted', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer({ lines: [['حملة مصطنعة أولى', '100.00'], ['تقرير مصطنع ثانٍ', '200.00'], ['بند مصطنع ثالث', '50.00']], claimed: [0, 1] });
  const [one, two] = k.claims;
  const line = key => financialChecklist(db, k.project).find(l => l.key === key);
  const has = (key, code, ref) => line(key).outstanding.some(i => i.code === code && i.ref === ref);
  const r = m.receipt(one, '115.00', 'SYN-P-1');
  assert.ok(!has('receivables', 'claim_not_collected', `claim:${one.id}`));
  const reversal = m.reverse(one, r);
  assert.ok(has('receivables', 'reversal_pending', `adjustment:${reversal.id}`), 'a reversal waiting for its approver is named');
  m.decide(one, reversal, 'outsider');
  assert.ok(has('receivables', 'claim_not_collected', `claim:${one.id}`), 'the bounced money is not collected');
  assert.equal(collectionAxis(db, k.project).confirmed_minor, 0);
  assert.ok(has('journals', 'document_not_journalized', `journal:ar_receipt_reversal:${reversal.id}`), 'the reversal is a project document that needs its journal');
  const dispute = m.tx(() => ar.openDispute(db, users.employee, one.id, { amount: '115.00', reason: 'العميل يعترض على المبلغ كاملًا', evidence: 'بريد اعتراض مصطنع محفوظ' }));
  assert.ok(has('receivables', 'dispute_open', `dispute:${dispute.id}`));
  const x = m.onAccount(k.case.id, '230.00', 'SYN-P-2');
  assert.ok(has('advances', 'account_unconfirmed', `account_receipt:${x.id}`));
  m.confirmAccount(x);
  assert.ok(has('advances', 'account_unapplied', `account_receipt:${x.id}`));
  const allocation = m.allocate(x, [{ claim_id: two.id, amount: '230.00' }]).allocations[0];
  assert.ok(!line('advances').outstanding.some(i => i.code.startsWith('account_')), 'fully allocated cash leaves nothing on account');
  assert.ok(!has('receivables', 'claim_not_collected', `claim:${two.id}`), 'allocated cash collects the claim');
  assert.ok(has('journals', 'document_not_journalized', `journal:ar_allocation:${allocation.id}`));
  assert.ok(has('journals', 'document_not_journalized', `journal:ar_account_receipt:${x.id}`));
  const { claim: third } = k.claimLine(2, { invoiceIt: false });
  const cancel = m.tx(() => ar.requestClaimCancel(db, users.employee, third.id, { reason: 'طلب إلغاء مصطنع للاختبار', evidence: 'مذكرة مصطنعة محفوظة' }));
  assert.ok(has('receivables', 'cancel_pending', `adjustment:${cancel.id}`));
  m.creditNote(k.invoices[1], '30.00');
  assert.deepEqual(line('refunds').outstanding.map(i => [i.code, i.ref]), [['refund_due', `refund:${two.id}`]], 'allocated cash counts as paid when a credit note lowers the net');
});

/* ───── (8) الصندوق والشاشة والمسارات ───── */
test('inbox: each new decision reaches the person who must take it, labelled for what it is', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer({ due: plus(m.day, -5), invoice: false });
  const [one, two] = k.claims;
  const r = m.receipt(one, '115.00', 'SYN-I-1');
  m.reverse(one, r);
  m.tx(() => ar.requestClaimCancel(db, users.employee, two.id, { reason: 'طلب إلغاء مصطنع للاختبار', evidence: 'مذكرة مصطنعة محفوظة' }));
  m.tx(() => ar.openDispute(db, users.employee, two.id, { amount: '10.00', reason: 'العميل يعترض على جزء من المبلغ', evidence: 'بريد اعتراض مصطنع محفوظ' }));
  m.onAccount(k.case.id, '20.00', 'SYN-I-2');
  const keys = who => { const out = []; collect(ar.listReceivables(db, users[who]), [], out, new Set()); return out.flatMap(i => i.action_keys); };
  const outsider = keys('outsider'), manager = keys('manager'), employee = keys('employee');
  assert.ok(outsider.includes('approve_reversal'), 'the third person sees the reversal');
  assert.ok(!manager.includes('approve_reversal'), 'the matcher does not');
  assert.ok(manager.includes('approve_cancel') && outsider.includes('approve_cancel'));
  assert.ok(manager.includes('resolve_dispute') && !employee.includes('resolve_dispute'));
  assert.ok(manager.includes('confirm_account') && !employee.includes('confirm_account'));
  for (const key of ['approve_reversal', 'reject_reversal', 'approve_cancel', 'reject_cancel', 'resolve_dispute', 'confirm_account', 'reject_account', 'allocate', 'approve_account_reversal', 'reject_account_reversal'])
    assert.ok(labelFor(key), `${key} is a decision the inbox names`);
  for (const key of ['request_reversal', 'request_cancel', 'open_dispute', 'record_promise', 'record_account_receipt', 'reverse_allocation', 'request_account_reversal'])
    assert.equal(labelFor(key), null, `${key} is work its owner starts, not a decision waiting on someone`);
  clearInboxCache();
  const box = inbox(db, users.outsider);
  const group = box.groups.find(g => g.key === 'receivables');
  assert.ok(group && group.items.some(i => i.id === one.id), 'the claim with the reversal waits in the outsider’s «awaiting my decision»');
});

test('screen: the receivables screen offers each settlement form to the right person, and the forms post where the routes listen', t => {
  const m = month(t), { db, users } = m;
  const k = m.customer();
  const [one, two] = k.claims;
  const r = m.receipt(one, '115.00', 'SYN-S-1');
  const reversal = m.reverse(one, r);
  const x = m.onAccount(k.case.id, '230.00', 'SYN-S-2'); m.confirmAccount(x);
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const view = who => { const data = ar.listReceivables(db, users[who]); return { data, html: receivablesUI.render(data, { e, money: v => String(v), button: (action, id, label) => `[${action}:${id}:${label}]`, ui: kit(e) }) }; };
  const outsider = view('outsider'), manager = view('manager'), employee = view('employee');
  assert.ok(outsider.html.includes(`[approve_adjustment:${one.id}:${reversal.id}:`));
  assert.ok(!manager.html.includes(`[approve_adjustment:${one.id}:${reversal.id}:`), 'the matcher is not offered the approval');
  const approve = receivablesUI.form('approve_adjustment', `${one.id}:${reversal.id}`, outsider.data);
  assert.equal(approve.endpoint, `/receivables/${one.id}/adjustments/${reversal.id}/approve`);
  assert.throws(() => receivablesUI.form('approve_adjustment', `${one.id}:${reversal.id}`, manager.data));
  const cancel = receivablesUI.form('request_cancel', two.id, employee.data);
  assert.deepEqual([cancel.endpoint, cancel.idempotent], [`/receivables/${two.id}/cancel`, true]);
  const second = m.receipt(two, '10.00', 'SYN-S-3');
  const reverse = receivablesUI.form('request_reversal', `${two.id}:${second.id}`, view('employee').data);
  assert.deepEqual([reverse.endpoint, reverse.idempotent, reverse.fields.map(f => f.name)], [`/receivables/${two.id}/receipts/${second.id}/reverse`, true, ['effective_on', 'reason', 'evidence']]);
  const allocate = receivablesUI.form('allocate', x.id, outsider.data);
  assert.equal(allocate.endpoint, `/receivables/on-account/${x.id}/allocations`);
  assert.deepEqual(allocate.toPayload({ note: 'تخصيص مصطنع', [`amount_${two.id}`]: '230.00', [`amount_${one.id}`]: '' }), { lines: [{ claim_id: two.id, amount: '230.00' }], note: 'تخصيص مصطنع' });
  assert.throws(() => receivablesUI.form('allocate', x.id, employee.data), 'the recorder is not offered the allocation');
  const record = receivablesUI.form('record_account_receipt', '', employee.data);
  assert.equal(record.endpoint, '/receivables/on-account');
  assert.ok(record.fields.find(f => f.name === 'case_id').options.some(o => o.value === k.case.id));
  for (const [form, id, endpoint] of [['open_dispute', two.id, `/receivables/${two.id}/disputes`], ['record_promise', two.id, `/receivables/${two.id}/promises`]])
    assert.equal(receivablesUI.form(form, id, employee.data).endpoint, endpoint);
  assert.match(outsider.html, /بانتظار/, 'the pending reversal is shown with its state');
  assert.ok(outsider.html.includes(`data-id="${one.id}"`), 'the claim can be focused from the inbox');
  // الشاشة القديمة (بلا عدّة ممرَّرة) ما زالت ترسم.
  assert.ok(receivablesUI.render(outsider.data, { e: String, money: String, button: a => `[${a}]` }).includes('[approve_adjustment]'));
});

test('routes: the settlement endpoints answer through the real request handler, with session, CSRF, idempotency and written refusals', async t => {
  const m = month(t), { db } = m;
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']] });
  const [claim] = k.claims;
  const r = m.receipt(claim, '115.00', 'SYN-R-1');
  const app = createApp(db);
  const sessions = {};
  for (const username of ['employee', 'manager', 'outsider']) {
    const res = await dispatch(app, { method: 'POST', path: '/api/login', body: { username, password: PASSWORD } });
    assert.equal(res.status, 200, res.text);
    sessions[username] = { cookie: res.headers['Set-Cookie'].split(';')[0], csrf: res.json().csrf };
  }
  const call = (who, path, body, key) => dispatch(app, { method: body === undefined ? 'GET' : 'POST', path: '/api' + path,
    headers: { cookie: sessions[who].cookie, 'x-csrf-token': sessions[who].csrf, ...(key ? { 'idempotency-key': key } : {}) }, body });
  const input = { reason: 'الشيك رجع من بنك العميل لعدم كفاية الرصيد', evidence: 'إشعار ارتداد مصطنع من البنك محفوظ', effective_on: m.day };
  let res = await call('employee', `/receivables/${claim.id}/receipts/${r.id}/reverse`, input, 'route-reversal-key-00001');
  assert.equal(res.status, 201, res.text);
  const adjustment = res.json().id;
  res = await call('employee', `/receivables/${claim.id}/receipts/${r.id}/reverse`, input, 'route-reversal-key-00001');
  assert.deepEqual([res.status, res.json().id], [201, adjustment], 'the same key replays the same request');
  res = await call('manager', `/receivables/${claim.id}/adjustments/${adjustment}/approve`, { note: 'اعتماد من المطابق' });
  assert.deepEqual([res.status, res.json().error.code], [403, 'reversal_not_independent']);
  assert.ok(res.json().error.details.refusal.missing.length, 'the refusal travels with what is missing and who holds it');
  res = await call('outsider', `/receivables/${claim.id}/adjustments/${adjustment}/approve`, { note: 'طابقت إشعار الارتداد' });
  assert.deepEqual([res.status, res.json().balance_minor], [201, '11500']);
  res = await call('employee', '/receivables/on-account', { case_id: k.case.id, reference: 'SYN-R-2', amount: '115.00', received_on: m.day, payer: 'شركة العميل المصطنعة', evidence: EVIDENCE }, 'route-account-key-000001');
  assert.equal(res.status, 201, res.text);
  const account = res.json().id;
  assert.equal((await call('manager', `/receivables/on-account/${account}/confirm`, { note: 'طابقت الكشف', matching_evidence: 'سطر كشف حساب مصطنع' })).status, 201);
  res = await call('outsider', `/receivables/on-account/${account}/allocations`, { lines: [{ claim_id: claim.id, amount: '115.00' }], note: 'تخصيص على الاستحقاق' }, 'route-allocate-key-00001');
  assert.deepEqual([res.status, res.json().unallocated_minor], [201, '0']);
  const allocation = res.json().allocations[0].id;
  res = await call('outsider', `/receivables/on-account/${account}/allocations/${allocation}/reverse`, { reason: 'فك تخصيص مصطنع للاختبار' });
  assert.deepEqual([res.status, res.json().unallocated_minor], [201, '11500']);
  res = await call('employee', `/receivables/${claim.id}/disputes`, { amount: '10.00', reason: 'اعتراض مصطنع على جزء', evidence: 'بريد اعتراض مصطنع محفوظ' }, 'route-dispute-key-000001');
  assert.equal(res.status, 201, res.text);
  res = await call('manager', `/receivables/${claim.id}/disputes/${res.json().id}/resolve`, { resolution_note: 'حسم مصطنع بعد مراجعة', resolution_evidence: 'محضر مصطنع موقع' });
  assert.equal(res.status, 201, res.text);
  res = await call('employee', `/receivables/${claim.id}/promises`, { amount: '10.00', promised_on: m.day, contact: 'جهة مصطنعة', evidence: 'مكالمة مصطنعة موثقة' }, 'route-promise-key-000001');
  assert.equal(res.status, 201, res.text);
  res = await call('employee', `/receivables/${claim.id}/cancel`, { reason: 'طلب إلغاء مصطنع', evidence: 'مذكرة مصطنعة محفوظة' }, 'route-cancel-key-0000001');
  assert.deepEqual([res.status, res.json().error.code], [409, 'claim_not_cancellable']);
  res = await call('employee', '/receivables');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json().account_receipts));
});
