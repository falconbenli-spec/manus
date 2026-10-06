import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { BASE_SCHEDULE_ID, decideSchedule, recordViolation, caseAction, getCase, myDiscipline } from '../app/discipline.mjs';

// م117 الموقعة (ص p040) توجب قبل أي جزاء يتجاوز غرامة أجر يوم: إبلاغ العامل كتابة بما نُسب إليه، وسماع أقواله،
// وتحقيق دفاعه، وإثبات ذلك في محضر يودع بملفه. ولا تحدد المادة مدةً لتقديم الدفاع.
// كانت المنصة تعرض مهلة الدفاع (parameters.defence_wait_days = 3) لمدير الموارد البشرية وللموظف موسومة «م117»،
// فتنسب إلى اللائحة مدةً ليست فيها. القيمة نفسها قرار شركة مشروع (وهي في parameters.open_values من أول يوم)؛
// الخطأ كان في السند وحده.
const riyadh = ms => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
const TEXT = 'نص تجريبي كافٍ الطول لأغراض الاختبار الآلي';

function fixture(t) {
  const db = openDb(':memory:'); seed(db, 'synthetic-defence-window'); t.after(() => db.close());
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const tx = f => transaction(db, f), today = riyadh(Date.now());
  tx(() => grantAccess(db, users.admin, { user_id: 'it', capability: 'hr.policy.accept', note: 'تصريح تجريبي لقبول جدول الجزاءات' }));
  tx(() => decideSchedule(db, users.it, BASE_SCHEDULE_ID, 'accept', { effective_from: '2024-01-01', note: 'قبول تجريبي للجدول في بيئة الاختبار' }));
  const { id } = tx(() => recordViolation(db, users.hr, {
    user_id: 'employee', codes: ['A01'], act_date: today, discovered_on: today,
    description: 'تأخر تجريبي عن بداية الدوام لأغراض الاختبار', source_kind: 'hr_observation'
  }));
  tx(() => caseAction(db, users.hr, id, 'open_investigation', {
    version: getCase(db, users.hr, id).version, process: 'written',
    charge_text: 'اتهام كتابي تجريبي بالتأخر عن مواعيد الحضور', charge_delivered_on: today
  }));
  return { db, users, id, today };
}
const defenceOf = view => view.deadlines.find(d => d.key === 'defence');

test('the written-defence window is labelled a company-set period, and Art. 117 is cited only for what it says', t => {
  const { db, users, id } = fixture(t);
  for (const reader of ['hr', 'employee']) {
    const view = reader === 'employee' ? myDiscipline(db, users.employee).cases.find(c => c.id === id) : getCase(db, users.hr, id);
    const defence = defenceOf(view);
    assert.ok(defence, `${reader}: مهلة الدفاع معروضة`);
    assert.equal(defence.article, '', `${reader}: لا رقم مادة على مهلة لا تنص عليها اللائحة`);
    assert.equal(defence.company_value, true);
    assert.equal(defence.basis_ar, 'مهلة تحددها الشركة');
    assert.equal(defence.basis_en, 'A company-set period');
    assert.match(defence.ar, /تحددها الشركة لا اللائحة/);
    // وما تقوله م117 فعلًا يبقى منسوبًا إليها: الإبلاغ الكتابي وسماع الأقوال وتحقيق الدفاع في محضر.
    assert.match(defence.ar, /م117 توجب الإبلاغ الكتابي وسماع الأقوال وتحقيق الدفاع في محضر/);
  }
  // بقية المهل تبقى على سندها من اللائحة.
  const proven = (() => {
    transaction(db, () => caseAction(db, users.employee, id, 'submit_defence', { version: getCase(db, users.employee, id).version, defence: 'دفاع تجريبي مكتوب من الموظف' }));
    transaction(db, () => caseAction(db, users.hr, id, 'record_hearing', { version: getCase(db, users.hr, id).version, hearing_on: riyadh(Date.now()), minutes: 'محضر جلسة تحقيق تجريبي بأقوال الموظف' }));
    transaction(db, () => caseAction(db, users.hr, id, 'conclude', { version: getCase(db, users.hr, id).version, finding: 'proven', note: TEXT }));
    return getCase(db, users.hr, id);
  })();
  const decision = proven.deadlines.find(d => d.key === 'decision');
  assert.equal(decision.article, 'م120');
  assert.equal(decision.basis_ar, 'م120');
  assert.equal(decision.company_value, false);
  assert.equal(defenceOf(proven), undefined, 'مهلة الدفاع تنتهي بانتهاء التحقيق');
});

test('the employee is told the defence window is the company’s, not the regulation’s', t => {
  const { db, users } = fixture(t);
  const notice = db.prepare("SELECT title,body FROM notifications WHERE user_id='employee' AND kind='discipline_charge'").get();
  assert.ok(notice, 'وصل الموظف إشعار الاتهام الكتابي');
  assert.match(notice.body, /مهلة تحددها الشركة؛ اللائحة لا تحددها/);
  // وحقوقه المعروضة تبقى تستشهد بم117 لما تنص عليه: الإبلاغ وسماع الأقوال وتحقيق الدفاع في محضر.
  const rights = myDiscipline(db, users.employee).rights.join('\n');
  assert.match(rights, /سماع أقوالك وتحقيق دفاعك في محضر/);
  assert.match(rights, /م117/);
});
