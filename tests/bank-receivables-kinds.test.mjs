// الحزمة 3 — نقد التحصيل يُطابَق بكشف البنك (الترحيل 171). الترحيل 170 أضاف ثلاثة مستندات تحرّك مالًا في البنك: ارتداد القبض
// المؤكد (خارج)، والقبض على حساب العميل (داخل)، وارتداد القبض على الحساب (خارج). جدولا المطابقة (الترحيل 168) لا يقبلان
// نوعها، فسطر الكشف الذي حمل هذا المال بلا مطابقة ممكنة: التسوية لا تُعدّ، أو يبقى فرقًا بمبلغه. هنا: الأنواع الثلاثة سجلات
// نقد باتجاهها، تُطابَق مفردة ومجمّعة، وتُتتبَّع من الدفتر إلى سطرها، وتُسوّى التسوية بها بفرق صفر؛ والترقية تنقل كل صف قائم.
// بيانات مصطنعة كلها.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, hash, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as bank from '../app/bank-reconciliation.mjs';
import * as ar from '../app/receivables.mjs';
import * as ledger from '../app/ledger.mjs';
import { grantAccess } from '../app/access.mjs';
import { visibilityWorld, riyadhDay } from './visibility-fixture.mjs';

const code = value => error => error.code === value;
const KINDS = ['ar_receipt_reversal', 'ar_account_receipt', 'ar_account_reversal'];

function world(t) {
  const m = visibilityWorld(t), { db, users, tx } = m;
  for (const [who, capability] of [['employee', 'bank.reconcile'], ['manager', 'bank.reconcile.approve']]) tx(() => grantAccess(db, users.admin, { user_id: who, capability, note: 'تصريح مطابقة مصطنع' }));
  const k = m.customer({ lines: [['حملة مصطنعة', '100.00']] });
  const [claim] = k.claims;
  const receipt = m.receipt(claim, '115.00', 'SYN-R1');
  const reversal = m.reverseReceipt(claim, receipt);
  const cash = m.onAccount(k.case.id, '200.00', 'SYN-ACC-1');
  const small = m.onAccount(k.case.id, '50.00', 'SYN-ACC-2');
  // العكس يطلبه employee ويعتمده outsider: لا مسجّله ولا مطابقه (manager).
  const request = tx(() => ar.requestAccountReversal(db, users.employee, small.id, { reason: 'انعكست الحوالة من بنك العميل المصطنع', evidence: 'إشعار انعكاس مصطنع من البنك محفوظ', effective_on: riyadhDay() }));
  tx(() => ar.decideAccountReversal(db, users.outsider, small.id, request.id, 'approve', { note: 'طابقت إشعار الانعكاس مع الكشف' }));
  const accountReversal = db.prepare('SELECT * FROM ar_account_reversals WHERE id=?').get(request.id);
  const account = tx(() => bank.createBankAccount(db, users.employee, { label: 'حساب التحصيل المصطنع', bank_name: 'بنك مصطنع', account_tail: '5151', gl_account_id: m.accounts.bank.id }));
  const profile = tx(() => bank.saveImportProfile(db, users.employee, { bank_account_id: account.id, name: 'كشف التحصيل المصطنع', delimiter: 'comma', date_format: 'YYYY-MM-DD', header_rows: 1,
    columns: { date: 'date', description: 'description', reference: 'reference', debit: 'debit', credit: 'credit' } }));
  const day = riyadhDay();
  // المال في الكشف: القبض يدخل ثم يرتد، والقبض على الحساب بمئتين، وحوالتان بخمسين وتسعين في سطر واحد لا تخصّان التحصيل، والارتداد.
  tx(() => bank.importStatement(db, users.employee, { profile_id: profile.id, file_name: 'receivables.csv', period_start: `${m.month}-01`, period_end: day, opening_balance: '0.00', closing_balance: '200.00',
    content: ['date,description,reference,debit,credit', `${day},قبض شيك العميل,SYN-R1,,115.00`, `${day},ارتداد شيك العميل,REV-SYN-R1,115.00,`,
      `${day},حوالة على الحساب,SYN-ACC-1,,200.00`, `${day},حوالة صغيرة على الحساب,SYN-ACC-2,,50.00`, `${day},انعكاس الحوالة الصغيرة,REV-SYN-ACC-2,50.00,`].join('\n') }));
  const line = text => db.prepare('SELECT * FROM bank_transactions WHERE description=?').get(text);
  const propose = input => tx(() => bank.proposeMatch(db, users.employee, { kind: 'record', unmatched_reason: null, rationale: 'المبلغ والمرجع يطابقان السجل المصطنع', ...input }));
  const decide = matchId => tx(() => bank.decideMatch(db, users.manager, matchId, 'approve', { version: 1, note: 'راجعت إشعار البنك المصطنع' }));
  return { ...m, k, claim, receipt, reversal, cash, small, accountReversal, account, line, propose, decide };
}

test('receivables cash: a receipt reversal, cash on account and its reversal are cash records with their direction, matchable, and traced from the ledger to their line', t => {
  const w = world(t), { db, users } = w;
  const records = bank.cashRecords(db, '36t', '0000-01-01', '9999-12-31');
  const find = (kind, id) => records.find(r => r.source_kind === kind && r.source_id === id);
  for (const [kind, id] of [['ar_receipt_reversal', w.reversal.id], ['ar_account_receipt', w.cash.id], ['ar_account_reversal', w.accountReversal.id]])
    assert.ok(find(kind, id), `${kind}: money that moved in the bank is a cash record`);
  assert.deepEqual([find('ar_receipt_reversal', w.reversal.id).direction, find('ar_receipt_reversal', w.reversal.id).amount_minor, find('ar_receipt_reversal', w.reversal.id).reference], ['out', 11500, 'REV-SYN-R1']);
  assert.deepEqual([find('ar_account_receipt', w.cash.id).direction, find('ar_account_receipt', w.cash.id).amount_minor, find('ar_account_receipt', w.cash.id).reference], ['in', 20000, 'SYN-ACC-1']);
  assert.deepEqual([find('ar_account_reversal', w.accountReversal.id).direction, find('ar_account_reversal', w.accountReversal.id).amount_minor], ['out', 5000]);
  for (const kind of KINDS) assert.ok(Object.hasOwn(bank.SOURCE_KINDS, kind), `${kind}: a matchable kind in the bank module's own list`);
  assert.equal(bank.cashRecords(db, 'isolated', '0000-01-01', '9999-12-31').length, 0, 'another tenant sees none of them');

  // اتجاه السجل يحرس المطابقة: الارتداد مال خارج، فلا يُطابَق بسطر داخل.
  assert.throws(() => w.propose({ transaction_id: w.line('قبض شيك العميل').id, source_kind: 'ar_receipt_reversal', source_id: w.reversal.id }), code('direction_mismatch'));
  w.decide(w.propose({ transaction_id: w.line('قبض شيك العميل').id, source_kind: 'ar_receipt', source_id: w.receipt.id }).id);
  w.decide(w.propose({ transaction_id: w.line('ارتداد شيك العميل').id, source_kind: 'ar_receipt_reversal', source_id: w.reversal.id }).id);
  w.decide(w.propose({ transaction_id: w.line('حوالة على الحساب').id, source_kind: 'ar_account_receipt', source_id: w.cash.id }).id);
  w.decide(w.propose({ transaction_id: w.line('حوالة صغيرة على الحساب').id, source_kind: 'ar_account_receipt', source_id: w.small.id }).id);
  w.decide(w.propose({ transaction_id: w.line('انعكاس الحوالة الصغيرة').id, source_kind: 'ar_account_reversal', source_id: w.accountReversal.id }).id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM bank_matches WHERE status='approved' AND source_kind IN ('ar_receipt_reversal','ar_account_receipt','ar_account_reversal')").get().n, 4);
  for (const [kind, id, text] of [['ar_receipt_reversal', w.reversal.id, 'ارتداد شيك العميل'], ['ar_account_receipt', w.cash.id, 'حوالة على الحساب'], ['ar_account_reversal', w.accountReversal.id, 'انعكاس الحوالة الصغيرة']]) {
    const step = ledger.traceAmount(db, users.manager, { kind, id }).chain.find(s => s.step === 'bank_match');
    assert.equal(step.state, 'linked', `${kind}: the trace reaches the statement line`);
    assert.equal(step.items[0].transaction_id, w.line(text).id);
  }
  // قيود المستندات مرحّلة: رصيد الدفتر يساوي الكشف، ولا حركة بلا قرار، والفرق صفر.
  for (const [kind, id] of [['ar_receipt', w.receipt.id], ['ar_receipt_reversal', w.reversal.id], ['ar_account_receipt', w.cash.id], ['ar_account_receipt', w.small.id], ['ar_account_reversal', w.accountReversal.id]])
    w.post(w.journal(kind, id));
  const s = bank.reconciliationStatement(db, users.employee, { bank_account_id: w.account.id, period_start: `${w.month}-01`, period_end: riyadhDay() });
  assert.deepEqual([s.undecided_count, s.outstanding.length, s.difference_minor, s.book_balance_minor], [0, 0, 0, 20000]);
  assert.ok(verifyAudit(db));
});

test('receivables cash: two reversals in one bank debit are one grouped match, and a pending cash on account is not matchable', t => {
  const w = world(t), { db, users, tx } = w;
  // قبضٌ ثانٍ على الحساب ينعكس، فيخرج الارتدادان في سطر بنك واحد.
  const more = w.onAccount(w.k.case.id, '30.00', 'SYN-ACC-3');
  const request = tx(() => ar.requestAccountReversal(db, users.employee, more.id, { reason: 'انعكست الحوالة الثانية من بنك العميل', evidence: 'إشعار انعكاس ثانٍ مصطنع محفوظ', effective_on: riyadhDay() }));
  tx(() => ar.decideAccountReversal(db, users.outsider, more.id, request.id, 'approve', { note: 'طابقت الانعكاس الثاني مع الكشف' }));
  const profile = db.prepare('SELECT id FROM bank_import_profiles WHERE bank_account_id=?').get(w.account.id);
  const day = riyadhDay();
  tx(() => bank.importStatement(db, users.employee, { profile_id: profile.id, file_name: 'bulk.csv', period_start: day, period_end: day, opening_balance: '0.00', closing_balance: '-195.00',
    content: ['date,description,reference,debit,credit', `${day},ارتداد مجمع لقبض وحوالة,REV-BULK,195.00,`].join('\n') }));
  const bulk = w.line('ارتداد مجمع لقبض وحوالة');
  // 115 (ارتداد القبض) + 50 (انعكاس الأولى) = 165 ما يساوي 195: المجموع يحرس المطابقة.
  assert.throws(() => w.propose({ transaction_id: bulk.id, members: [{ source_kind: 'ar_receipt_reversal', source_id: w.reversal.id }, { source_kind: 'ar_account_reversal', source_id: w.accountReversal.id }] }), code('amount_mismatch'));
  const second = db.prepare('SELECT id FROM ar_account_reversals WHERE id=?').get(request.id);
  const group = w.propose({ transaction_id: bulk.id, members: [{ source_kind: 'ar_receipt_reversal', source_id: w.reversal.id }, { source_kind: 'ar_account_reversal', source_id: w.accountReversal.id }, { source_kind: 'ar_account_reversal', source_id: second.id }] });
  w.decide(group.id);
  const items = db.prepare("SELECT source_kind,amount_minor FROM bank_match_items WHERE match_id=? AND side='record' ORDER BY position").all(group.id).map(i => [i.source_kind, i.amount_minor]);
  assert.deepEqual(items, [['ar_receipt_reversal', 11500], ['ar_account_reversal', 5000], ['ar_account_reversal', 3000]]);
  const step = ledger.traceAmount(db, users.manager, { kind: 'ar_account_reversal', id: second.id }).chain.find(s => s.step === 'bank_match');
  assert.deepEqual([step.state, step.items[0].transaction_id, step.items[0].shape], ['linked', bulk.id, 'group'], 'a member of a grouped match is traced through the items, not the header');
  // قبضٌ على الحساب ما تطابق بعد ليس سجل نقد نهائيًا.
  const pending = tx(() => ar.recordAccountReceipt(db, users.employee, { case_id: w.k.case.id, reference: 'SYN-ACC-P', amount: '10.00', received_on: riyadhDay(), payer: 'شركة العميل المصطنعة', evidence: 'إشعار بنكي مصطنع محفوظ في ملف الاختبار' }));
  assert.throws(() => w.propose({ transaction_id: w.line('حوالة على الحساب').id, source_kind: 'ar_account_receipt', source_id: pending.id }), code('source_not_found'));
});

// الترقية: قاعدة على الترحيل 170 فيها مطابقات بأنواع الترحيل 168 (مفردة معتمدة، ومجمّعة مرفوضة بنودها غير حيّة)، تُفتح فيُطبَّق 171،
// فتبقى الصفوف كما هي عمودًا عمودًا، وتبقى القوادح تحرس، ويقبل الجدول الأنواع الجديدة.
function pre171(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pre171-')), path = join(directory, 'pre171.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema = readFileSync(new URL('../app/schema.sql', import.meta.url), 'utf8');
  raw.exec(schema); raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for (const file of readdirSync(new URL('../app/migrations/', import.meta.url)).filter(name => /^\d{3}-.+\.sql$/.test(name)).sort()) {
    const version = Number(file.slice(0, 3));
    if (version >= 171) continue;
    const sql = readFileSync(new URL('../app/migrations/' + file, import.meta.url), 'utf8');
    raw.exec('BEGIN'); raw.exec(sql); raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version, hash(sql)); raw.exec('COMMIT');
  }
  seed(raw, 'synthetic-pre-171');
  const stamp = '2026-08-20T09:00:00.000Z', digest = 'a'.repeat(64);
  raw.exec(`INSERT INTO finance_accounts(id,tenant_id,code,name,account_type,currency,created_by,created_at) VALUES('gl-171','36t','1000','بنك مصطنع','asset','SAR','manager','${stamp}');
    INSERT INTO bank_accounts(id,tenant_id,label,bank_name,account_tail,gl_account_id,created_by,created_at,updated_at) VALUES('ba-171','36t','حساب مصطنع قبل 171','بنك مصطنع','1717','gl-171','employee','${stamp}','${stamp}');
    INSERT INTO bank_import_profiles(id,tenant_id,bank_account_id,name,delimiter,date_format,header_rows,columns,created_by,created_at,updated_at) VALUES('bp-171','36t','ba-171','كشف مصطنع','comma','YYYY-MM-DD',1,'{}','employee','${stamp}','${stamp}');
    INSERT INTO bank_statement_imports(id,tenant_id,bank_account_id,profile_id,file_name,file_digest,period_start,period_end,opening_balance_minor,closing_balance_minor,row_count,imported_by,imported_at) VALUES('bi-171','36t','ba-171','bp-171','pre171.csv','${digest}','2026-08-01','2026-08-31',100000,40000,2,'employee','${stamp}');
    INSERT INTO bank_transactions(id,tenant_id,import_id,bank_account_id,line_no,txn_date,description,reference,debit_minor,credit_minor,created_at) VALUES('bt-1','36t','bi-171','ba-171',1,'2026-08-10','صرف عهدة','CUST-1',50000,0,'${stamp}'),('bt-2','36t','bi-171','ba-171',2,'2026-08-11','صرف عهدتين','CUST-23',10000,0,'${stamp}');
    INSERT INTO bank_matches(id,tenant_id,transaction_id,kind,shape,source_kind,source_id,amount_minor,rationale,prepared_by,prepared_at) VALUES('bm-1','36t','bt-1','record','single','custody_issue','cust-1',50000,'مطابقة مصطنعة قبل الترقية','employee','${stamp}');
    INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,transaction_id,amount_minor,created_at) VALUES('bm-1','36t','ba-171',1,'line','bt-1',50000,'${stamp}');
    INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,source_kind,source_id,amount_minor,created_at) VALUES('bm-1','36t','ba-171',2,'record','custody_issue','cust-1',50000,'${stamp}');
    UPDATE bank_matches SET status='approved',decided_by='manager',decided_at='${stamp}',decision_note='مطابقة معتمدة مصطنعة',version=2 WHERE id='bm-1';
    INSERT INTO bank_matches(id,tenant_id,transaction_id,kind,shape,amount_minor,rationale,prepared_by,prepared_at) VALUES('bm-2','36t','bt-2','record','group',10000,'مطابقة مجمعة مصطنعة قبل الترقية','employee','${stamp}');
    INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,transaction_id,amount_minor,created_at) VALUES('bm-2','36t','ba-171',1,'line','bt-2',10000,'${stamp}');
    INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,source_kind,source_id,amount_minor,created_at) VALUES('bm-2','36t','ba-171',2,'record','custody_issue','cust-2',6000,'${stamp}'),('bm-2','36t','ba-171',3,'record','custody_issue','cust-3',4000,'${stamp}');
    UPDATE bank_matches SET status='rejected',decided_by='manager',decided_at='${stamp}',decision_note='المطابقة المجمعة غير صحيحة وتُرفض',version=2 WHERE id='bm-2';`);
  const before = { matches: raw.prepare('SELECT * FROM bank_matches ORDER BY id').all(), items: raw.prepare('SELECT * FROM bank_match_items ORDER BY match_id,position').all() };
  // قيد الترحيل 168: النوع الجديد مرفوض قبل الترقية — السطر bt-2 حرٌّ بعد رفض مطابقته، والقادح يمرّ، والقيد وحده يرفض.
  assert.throws(() => raw.prepare("INSERT INTO bank_matches(id,tenant_id,transaction_id,kind,shape,source_kind,source_id,amount_minor,rationale,prepared_by,prepared_at) VALUES('bm-x','36t','bt-2','record','single','ar_account_receipt','acc-1',10000,'نوع جديد مرفوض قبل الترقية','employee',?)").run(stamp), /CHECK constraint failed/);
  raw.close();
  return { path, before };
}

test('migration 171: every match and item on a pre-171 database survives the rebuild column for column, the guards still hold, and the three receivables kinds are accepted', t => {
  const { path, before } = pre171(t);
  const db = openDb(path); t.after(() => { try { db.close(); } catch {} });
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=171').get(), 'migration 171 applied on open');
  assert.deepEqual(db.prepare('SELECT * FROM bank_matches ORDER BY id').all(), before.matches, 'headers carried as they were');
  assert.deepEqual(db.prepare('SELECT * FROM bank_match_items ORDER BY match_id,position').all(), before.items, 'items carried, the rejected match\'s items still not live');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('bank_matches_v3','bank_match_items_v1')").get().n, 0, 'no leftover of the rebuild');
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (tbl_name IN ('bank_matches','bank_match_items') OR name='bank_import_cancel_guard') ORDER BY name").all().map(r => r.name);
  assert.deepEqual(triggers, ['bank_import_cancel_guard', 'bank_match_decided_once', 'bank_match_exact_sum', 'bank_match_items_fixed', 'bank_match_items_insert', 'bank_match_items_no_delete', 'bank_match_items_release', 'bank_match_live_batch', 'bank_matches_no_delete']);
  // الحراس كما هم: القرار لا يُعاد كتابته، والبند لا يُحذف، والدفعة ذات المطابقة المعتمدة لا تُلغى.
  assert.throws(() => db.prepare("UPDATE bank_matches SET status='rejected',version=3 WHERE id='bm-1'").run(), /decided once/);
  assert.throws(() => db.prepare("DELETE FROM bank_match_items WHERE match_id='bm-1'").run(), /retained/);
  assert.throws(() => db.prepare("UPDATE bank_statement_imports SET status='cancelled',version=version+1 WHERE id='bi-171'").run(), /approved match cannot be cancelled/);
  // والأنواع الثلاثة صارت مقبولة في الجدولين.
  const stamp = '2026-08-21T09:00:00.000Z';
  db.exec(`INSERT INTO bank_transactions(id,tenant_id,import_id,bank_account_id,line_no,txn_date,description,reference,debit_minor,credit_minor,created_at) VALUES('bt-3','36t','bi-171','ba-171',3,'2026-08-21','ارتداد قبض','REV-1',11500,0,'${stamp}')`);
  db.exec(`INSERT INTO bank_matches(id,tenant_id,transaction_id,kind,shape,source_kind,source_id,amount_minor,rationale,prepared_by,prepared_at) VALUES('bm-3','36t','bt-3','record','single','ar_receipt_reversal','rev-1',11500,'مطابقة ارتداد مصطنعة بعد الترقية','employee','${stamp}')`);
  db.exec(`INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,source_kind,source_id,amount_minor,created_at) VALUES('bm-3','36t','ba-171',1,'record','ar_account_reversal','rev-2',11500,'${stamp}')`);
  assert.throws(() => db.exec(`INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,source_kind,source_id,amount_minor,created_at) VALUES('bm-3','36t','ba-171',2,'record','ar_unknown_kind','x',1,'${stamp}')`), /CHECK/);
});
