// الحزمة 3 — المطابقة البنكية والإقفال: دفتر مصطنع صغير بحساب بنك واحد وكشف يُستورد ملفًا، لاختبارات المطابقة
// المجمّعة والمجزّأة، وقيد سطر الكشف المصنّف، وفحوص الإقفال. كل ما هنا مصطنع: لا بنك ولا حساب ولا جهة حقيقية.
//
// فصل المهام كما تفرضه المنصة: employee يعدّ المطابقة والقيد، وmanager يعتمد المطابقة والقيد، وoutsider يرحّل.
// والعكس يعدّه manager (غير معدّ الأصل)، ويعتمده ويرحّله outsider.
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import * as f from '../app/finance.mjs';
import { recordMapping, approveMapping, journalFromSource } from '../app/ledger.mjs';
import * as bank from '../app/bank-reconciliation.mjs';

export const code = value => error => error.code === value;
export const CHART = {
  bank: ['1000', 'بنك مصطنع', 'asset'], second: ['1010', 'أصل مصطنع ثانٍ', 'asset'], equity: ['3000', 'رأس مال مصطنع', 'equity'],
  receivable: ['1100', 'ذمم عملاء مصطنعة', 'asset'], custody: ['1200', 'عهد موظفين مصطنعة', 'asset'],
  charges: ['5300', 'رسوم بنكية مصطنعة', 'expense'], interest: ['4100', 'عوائد بنكية مصطنعة', 'income'], expense: ['5200', 'مصروف مصطنع', 'expense'], liability: ['2500', 'مصروفات مستحقة مصطنعة', 'liability']
};
const PURPOSE_ACCOUNT = { bank: 'bank', bank_charges: 'charges', interest_income: 'interest', receivable: 'receivable', employee_custody: 'custody' };

export function bankLedger(t, { path = ':memory:', seedName = 'synthetic-bank-close', map = ['bank', 'bank_charges', 'interest_income'], period = { name: 'سنة الاختبار المصطنعة 2026', starts_on: '2026-01-01', ends_on: '2026-12-31' } } = {}) {
  const db = openDb(path); seed(db, seedName); t?.after?.(() => { try { db.close(); } catch {} });
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u])), tx = run => transaction(db, run);
  for (const [who, capability] of [['employee', 'bank.reconcile'], ['manager', 'bank.reconcile.approve']])
    tx(() => grantAccess(db, users.admin, { user_id: who, capability, note: 'تصريح مطابقة بنكية مصطنع' }));
  const financeGrants = { employee: ['read', 'configure', 'prepare'], manager: ['read', 'configure', 'prepare', 'approve', 'post', 'reverse'], outsider: ['read', 'approve', 'post'] };
  for (const [who, actions] of Object.entries(financeGrants)) for (const action of actions)
    db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', who, users[who].role, action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض دفتر مصطنع', null, now());
  const ref = (kind, input) => tx(() => f.createFinanceReference(db, users.manager, kind, input));
  const accounts = Object.fromEntries(Object.entries(CHART).map(([key, [c, name, type]]) => [key, ref('accounts', { code: c, name, account_type: type, currency: 'SAR' })]));
  const centre = ref('cost_centers', { code: 'GEN', name: 'عام مصطنع' });
  const financePeriod = ref('periods', period);
  const mapPurpose = (purpose, account = accounts[PURPOSE_ACCOUNT[purpose]]) => {
    const { id } = tx(() => recordMapping(db, users.employee, { purpose, account_id: account.id, cost_center_id: centre.id, effective_from: '2026-01-01' }));
    tx(() => approveMapping(db, users.manager, id, { note: 'طابقت الحساب مع دليل الحسابات المصطنع' }));
  };
  for (const purpose of map) mapPurpose(purpose);

  const act = (who, j, action, values = {}) => tx(() => f.journalAction(db, users[who], j.id, action, { version: j.version, ...(action === 'reverse' ? {} : { note: 'قرار مالي مصطنع' }), ...values }));
  const post = j => act('outsider', act('manager', act('employee', j, 'submit'), 'approve'), 'post');
  const reverse = (j, date) => { let r = act('manager', j, 'reverse', { period_id: financePeriod.id, entry_date: date ?? j.entry_date, reason: 'عكس قيد مصطنع لخطأ', evidence: 'مذكرة تصحيح مصطنعة' });
    r = act('manager', r, 'submit'); r = act('outsider', r, 'approve'); return act('outsider', r, 'post'); };
  // قيد يدوي: [[الحساب، مدين، دائن]…] بالريال نصًّا. draft=true يتركه مسودة.
  const journal = (date, lines, reference, { draft = false } = {}) => {
    const j = tx(() => f.createJournal(db, users.employee, { period_id: financePeriod.id, entry_date: date, description: `قيد يدوي مصطنع ${reference}`, evidence: 'دليل مصطنع للاختبار', currency: 'SAR', source_reference: reference,
      lines: lines.map(([account, debit, credit]) => ({ account_id: account.id, cost_center_id: centre.id, debit: debit || '0', credit: credit || '0', memo: 'سطر مصطنع' })) }));
    return draft ? j : post(j);
  };
  const sourced = (kind, id, who = 'employee') => tx(() => journalFromSource(db, users[who], { source_kind: kind, source_id: id, period_id: financePeriod.id }));

  const account = tx(() => bank.createBankAccount(db, users.employee, { label: 'الحساب التشغيلي المصطنع', bank_name: 'بنك مصطنع', account_tail: '4321', gl_account_id: accounts.bank.id }));
  const profile = tx(() => bank.saveImportProfile(db, users.employee, { bank_account_id: account.id, name: 'كشف مصطنع', delimiter: 'comma', date_format: 'YYYY-MM-DD', header_rows: 1,
    columns: { date: 'date', description: 'description', reference: 'reference', debit: 'debit', credit: 'credit' } }));
  let files = 0;
  const load = (rows, { opening, closing, start = '2026-08-01', end = '2026-08-31' }) => tx(() => bank.importStatement(db, users.employee, { profile_id: profile.id, file_name: `statement-${++files}.csv`,
    content: ['date,description,reference,debit,credit', ...rows].join('\n'), period_start: start, period_end: end, opening_balance: opening, closing_balance: closing }));
  const line = text => db.prepare('SELECT * FROM bank_transactions WHERE description LIKE ? ORDER BY line_no').get(`%${text}%`);
  const propose = (input, who = 'employee') => tx(() => bank.proposeMatch(db, users[who], { kind: 'record', unmatched_reason: null, rationale: 'مطابقة مصطنعة بعد مراجعة المرجع والمبلغ', ...input }));
  const decide = (matchId, decision = 'approve', who = 'manager') => tx(() => bank.decideMatch(db, users[who], matchId, decision, { version: db.prepare('SELECT version FROM bank_matches WHERE id=?').get(matchId).version, note: decision === 'approve' ? 'راجعت السند المصطنع' : 'المطابقة المقترحة غير صحيحة وتُرفض' }));
  const classify = (text, reason) => { const txn = line(text);
    const m = propose({ transaction_id: txn.id, kind: 'unmatched', source_kind: null, source_id: null, unmatched_reason: reason, rationale: 'حركة بنكية بلا سجل مقابل في المنصة' });
    decide(m.id); return txn; };
  const statement = (from = '2026-08-01', to = '2026-08-31') => bank.reconciliationStatement(db, users.employee, { bank_account_id: account.id, period_start: from, period_end: to });
  // عهدة مصطنعة تُكتب صفًّا مباشرًا كما يفعل اختبار المطابقة القائم: سجل نقدي نهائي بمرجع ومبلغ وتاريخ.
  const custody = (reference, minor, date, { returned = null } = {}) => { const id = randomUUID();
    if (returned) db.prepare("INSERT INTO custodies(id,tenant_id,holder_id,amount_minor,purpose,status,approved_by,approved_at,issued_on,issue_reference,issued_by,returned_minor,return_reference,closed_by,closed_at,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,'closed',?,?,?,?,?,?,?,?,?,'',?,?)")
      .run(id, '36t', 'outsider', minor, 'عهدة مصطنعة للاختبار', 'manager', `${date}T00:00:00.000Z`, date, reference, 'manager', returned.minor, returned.reference, 'manager', `${returned.date}T09:00:00.000Z`, now(), now());
    else db.prepare("INSERT INTO custodies(id,tenant_id,holder_id,amount_minor,purpose,status,approved_by,approved_at,issued_on,issue_reference,issued_by,decision_note,created_at,updated_at) VALUES(?,?,?,?,?,'issued',?,?,?,?,?,'',?,?)")
      .run(id, '36t', 'outsider', minor, 'عهدة مصطنعة للاختبار', 'manager', `${date}T00:00:00.000Z`, date, reference, 'manager', now(), now());
    return id; };
  const lines = journalId => db.prepare('SELECT a.code,l.debit_minor,l.credit_minor FROM finance_lines l JOIN finance_accounts a ON a.id=l.account_id WHERE l.journal_id=? ORDER BY l.position').all(journalId).map(l => [l.code, l.debit_minor, l.credit_minor]);
  return { db, users, tx, accounts, centre, period: financePeriod, account, profile, mapPurpose, act, post, reverse, journal, sourced, load, line, propose, decide, classify, statement, custody, lines };
}
