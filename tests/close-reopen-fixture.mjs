// الحزمة 3 — شهر مقفل بفترة محاسبية تساويه، ومهمة منفذة، وأشخاص بأدوار الفتح المضبوط: من أقفل (reviewer)، ومن يطلب الفتح
// (closer)، وثالثان مؤهلان للقرار (third وfourth)، ومن يحمل الإقفال بلا سلطة الدفتر (nolock). يستعمله اختبار الفتح واختبار السباق.
// كل ما هنا مصطنع. path يقبل ملفًا ليتنافس عليه أكثر من عملية.
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as f from '../app/finance.mjs';
import { adoptionAction } from '../app/options.mjs';
import { getClosePeriod, createTemplate, openClosePeriod, taskAction, periodAction, RECLOSE_DAYS } from '../app/close-checklist.mjs';

export const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const plusDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const lastMonth = () => { const [y, m] = riyadhToday().slice(0, 7).split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

export function reopenFixture(t, { path = ':memory:' } = {}) {
  const db = openDb(path); seed(db, 'synthetic-ledger-reopen'); t?.after?.(() => { try { db.close(); } catch {} });
  // مغلق الإقفال (reviewer)، وطالب الفتح (closer)، وثالثان مؤهلان للقرار (third وfourth)، ومن يحمل الإقفال بلا سلطة الدفتر (nolock).
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('closer','36t','ops','closer','محاسب الإقفال المصطنع','unused','employee',NULL),('reviewer','36t','ops','reviewer','مراجع الإقفال المصطنع','unused','manager',NULL),
    ('third','36t','ops','third','الطرف الثالث المصطنع','unused','manager',NULL),('fourth','36t','ops','fourth','طرف رابع مصطنع','unused','manager',NULL),
    ('nolock','36t','ops','nolock','مدير إقفال بلا سلطة دفتر','unused','manager',NULL)`);
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  for (const who of ['closer', 'reviewer', 'third', 'fourth', 'nolock']) db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)')
    .run(randomUUID(), '36t', who, 'finance.close.manage', 'تصريح مصطنع للاختبار', 'admin', now());
  for (const [who, actions] of [['closer', ['read', 'configure', 'prepare']], ['reviewer', ['read', 'configure', 'approve', 'post']], ['third', ['read', 'configure']], ['fourth', ['read', 'configure']], ['nolock', ['read']], ['employee', ['read', 'prepare']]])
    for (const action of actions) db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', who, users[who].role, action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض مالي مصطنع', null, now());
  const tx = run => transaction(db, run);
  const month = lastMonth(), [year, m] = month.split('-').map(Number), monthEnd = `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const financePeriod = tx(() => f.createFinanceReference(db, users.closer, 'periods', { name: `فترة ${month} المصطنعة`, starts_on: `${month}-01`, ends_on: monthEnd }));
  const ref = (kind, input) => tx(() => f.createFinanceReference(db, users.reviewer, kind, input));
  const expense = ref('accounts', { code: 'RO-EXP', name: 'مصروف مصطنع', account_type: 'expense', currency: 'SAR' }), liability = ref('accounts', { code: 'RO-LIA', name: 'التزام مصطنع', account_type: 'liability', currency: 'SAR' });
  const centre = ref('cost_centers', { code: 'RO-CC', name: 'مركز مصطنع' });
  const adjustment = (reference = randomUUID(), { post = true } = {}) => {
    let j = tx(() => f.createJournal(db, users.employee, { period_id: financePeriod.id, entry_date: `${month}-20`, description: 'قيد تسوية مصطنع بتاريخ داخل الشهر', evidence: 'فاتورة وصلت بعد الإقفال', currency: 'SAR', source_reference: reference,
      lines: [{ account_id: expense.id, cost_center_id: centre.id, debit: '10.00', credit: '0', memo: 'مدين' }, { account_id: liability.id, cost_center_id: centre.id, debit: '0', credit: '10.00', memo: 'دائن' }] }));
    if (post) for (const [who, action] of [['employee', 'submit'], ['reviewer', 'approve'], ['reviewer', 'post']]) j = tx(() => f.journalAction(db, users[who], j.id, action, { version: j.version, note: 'قرار مالي مصطنع' }));
    return j;
  };
  tx(() => createTemplate(db, users.closer, { title: 'مطابقة كشف البنك المصطنع', owner_id: 'closer', due_day: 5, basis: 'قرار مالك إجراء الإقفال المصطنع لهذه المهمة' }));
  const opened = tx(() => openClosePeriod(db, users.closer, { period_key: month, finance_period_id: financePeriod.id }));
  const task = getClosePeriod(db, users.closer, opened.id).tasks[0];
  tx(() => taskAction(db, users.closer, task.id, 'complete_task', { version: task.version, evidence: 'طابقت الكشف المصطنع وحفظت الدليل' }));
  const view = (who = 'reviewer') => getClosePeriod(db, users[who], opened.id);
  const act = (who, action, input) => tx(() => periodAction(db, users[who], opened.id, action, { version: view(who).version, ...input }));
  const approveClose = (who = 'reviewer') => act(who, 'approve_close', { note: 'راجعت كل مهمة ودليلها وفحوص الإقفال' });
  const requestReopen = (who = 'closer') => act(who, 'request_reopen', { reason: 'وصلت فاتورة مورد تخص الشهر بعد اعتماد الإقفال' });
  const approveReopen = (who = 'third') => act(who, 'approve_reopen', { note: 'أقر بأن الفاتورة تخص الشهر وتستوجب فتح الإقفال' });
  // موعد إعادة الإقفال قرار المالك: يسجّله واحد ويعتمده ثانٍ.
  const adopt = (days = 5) => { const recorded = tx(() => adoptionAction(db, users.closer, RECLOSE_DAYS, 'record', { value: { days }, basis: 'قرار مالك الإجراء المصطنع لمدة بقاء الشهر مفتوحًا بعد فتحه', effective_from: '2026-01-01' }));
    return tx(() => adoptionAction(db, users.reviewer, RECLOSE_DAYS, 'approve', { adoption_id: recorded.adoption_id ?? db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(RECLOSE_DAYS).id, note: 'اعتمدت المدة بعد مراجعة أساسها المكتوب' })); };
  const fp = () => db.prepare('SELECT * FROM finance_periods WHERE id=?').get(financePeriod.id);
  const reopenings = () => db.prepare('SELECT * FROM finance_period_reopenings WHERE period_id=? ORDER BY created_at,rowid').all(financePeriod.id);
  return { db, users, tx, month, monthEnd, financePeriod, period: opened, view, act, approveClose, requestReopen, approveReopen, adopt, adjustment, fp, reopenings };
}
