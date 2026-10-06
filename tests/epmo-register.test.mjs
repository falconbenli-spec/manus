import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, transaction, now, hash, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import * as epmo from '../app/epmo-report.mjs';
import { epmoBoard } from '../app/epmo-board.mjs';

// سجلّات تقرير الإدارة التنفيذية للمشاريع (ترحيل 118). ما تحرسه هذه الاختبارات جملة واحدة:
// الفجوة المعلنة لا تختفي بصمت — لا بإسناد بلا مالك، ولا بإغلاق بلا دليل، ولا برفض بلا سبب،
// ولا بحذف صفّها، ولا بمفتاح لا يعرفه الكتالوج.

const code = value => error => error.code === value;
const P = { period_from: '2026-08-01', period_to: '2026-08-31' };
const EVIDENCE = 'صار الرقم يُقرأ من جدول المعالم الجديد بتاريخه ودليل بلوغه';
const REASON = 'قرار القيادة بتأجيل القياس إلى ما بعد ربط النظام الحكومي';

function fixture(t) {
  const db = openDb(':memory:');
  seed(db, 'synthetic-epmo-register-tests-only');
  t.after(() => db.close());
  // ثلاثة حسابات: من يُعِدّ التقرير، ومن يقرؤه، ومن لا يملك أيًّا من التصريحين.
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('epmo-lead','36t','ops','epmo-lead','قائدة مكتب المشاريع المصطنعة','unused-test-hash','manager',NULL),
    ('exec','36t','ops','exec','تنفيذي مصطنع','unused-test-hash','manager',NULL),
    ('gap-owner','36t','ops','gap-owner','مالكة فجوة مصطنعة','unused-test-hash','employee','epmo-lead'),
    ('nobody','36t','ops','nobody','حساب بلا تصريح','unused-test-hash','employee','epmo-lead')`);
  const users = Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id,name FROM users').all().map(u => [u.id, u]));
  const tx = f => transaction(db, f);
  const grant = (user_id, capability) => tx(() => grantAccess(db, users.admin, { user_id, capability, department_id: '', note: 'تصريح اختبار تقرير EPMO' }));
  grant('epmo-lead', 'epmo.review');
  grant('exec', 'executive.view');
  return { db, users, tx, grant };
}

/* ───── 1. القيود الثلاثة: ما يمنعه القيد لا تفتحه شيفرة ───── */

test('EPMO gaps: the three CHECKs refuse an ownership with no owner or date, a closure with no evidence, and a refusal with no reason', t => {
  const { db, users, tx } = fixture(t);
  const key = 'milestone_records';
  const raw = (owner, target, status, note, evidence) => db.prepare('INSERT INTO epmo_gap_plans(tenant_id,gap_key,owner_id,target_on,status,decision_note,closed_evidence,version,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)')
    .run('36t', key, owner, target, status, note, evidence, 'epmo-lead', now());

  // (1) «مُسنَدة» بلا مالك، أو بلا تاريخ، أو بلا الاثنين — مرفوضة في قاعدة البيانات نفسها.
  assert.throws(() => raw(null, '2026-12-31', 'owned', '', ''), /CHECK constraint/, 'ownership with a date but no owner is refused');
  assert.throws(() => raw('gap-owner', null, 'owned', '', ''), /CHECK constraint/, 'ownership with an owner but no date is refused');
  assert.throws(() => raw(null, null, 'owned', '', ''), /CHECK constraint/, 'ownership with neither is refused');
  // (2) «أُغلقت» بلا دليل، أو بدليل أقصر من عشرة أحرف.
  assert.throws(() => raw(null, null, 'closed', '', ''), /CHECK constraint/, 'a closure with no evidence is refused');
  assert.throws(() => raw(null, null, 'closed', '', 'تم'), /CHECK constraint/, '"done" is not evidence');
  // (3) «رُفض قياسها» بلا سبب مكتوب.
  assert.throws(() => raw(null, null, 'refused', '', ''), /CHECK constraint/, 'a refusal with no reason is refused');
  assert.throws(() => raw(null, null, 'refused', 'لا', ''), /CHECK constraint/, 'a one-word reason is not a reason');

  // والشيفرة ترفض قبل القيد برسالة عربية تقول السبب، فلا يصل المستخدم إلى نصّ SQLite.
  assert.throws(() => tx(() => epmo.gapAction(db, users['epmo-lead'], key, 'own_gap', { version: 0, owner_id: '', target_on: '2026-12-31' })), code('owner_required'));
  assert.throws(() => tx(() => epmo.gapAction(db, users['epmo-lead'], key, 'close_gap', { version: 0, evidence: 'تم' })), code('invalid_text'));
  assert.throws(() => tx(() => epmo.gapAction(db, users['epmo-lead'], key, 'refuse_gap', { version: 0, reason: 'لا' })), code('invalid_text'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM epmo_gap_plans').get().n, 0, 'nothing was written by any refused attempt');
});

test('EPMO gaps: a declared gap can never disappear — its row cannot be deleted, and its key cannot be rewritten', t => {
  const { db, users, tx } = fixture(t);
  tx(() => epmo.gapAction(db, users['epmo-lead'], 'revenue_target', 'refuse_gap', { version: 0, reason: REASON }));
  assert.throws(() => db.prepare("DELETE FROM epmo_gap_plans WHERE gap_key='revenue_target'").run(), /never deleted/);
  assert.throws(() => db.prepare("UPDATE epmo_gap_plans SET gap_key='days_to_collect',version=2 WHERE gap_key='revenue_target'").run(), /keeps its gap key/);
  assert.throws(() => db.prepare("UPDATE epmo_gap_plans SET decision_note='أخرى' WHERE gap_key='revenue_target'").run(), /next version/, 'a silent edit without the next version is refused');
});

/* ───── 2. الكتالوج: المفتاح المجهول خطأ، والسجل لا يفرغ ───── */

test('EPMO gaps: a key outside MEASUREMENT_GAPS raises, the register is never empty, and every plan resolves to a catalogue entry', t => {
  const { db, users, tx } = fixture(t);
  assert.throws(() => tx(() => epmo.gapAction(db, users['epmo-lead'], 'invented_gap', 'refuse_gap', { version: 0, reason: REASON })), code('gap_unknown'));
  assert.throws(() => epmo.gapDefinition('project_percent_complete_v2'), code('gap_unknown'));

  // الكتالوج ثابت في الشيفرة: لا جدول يُبذر فيه ولا صفّ يُحذف منه.
  assert.ok(epmo.MEASUREMENT_GAPS.length >= 15, 'the verified gap list is carried in full');
  assert.equal(new Set(epmo.GAP_KEYS).size, epmo.MEASUREMENT_GAPS.length, 'gap keys are unique');
  for (const gap of epmo.MEASUREMENT_GAPS) {
    assert.ok(gap.statement.length >= 20, `${gap.key} says what cannot be measured`);
    assert.ok(gap.why.length >= 40, `${gap.key} says which record does not exist`);
    assert.ok(gap.needed.length >= 30, `${gap.key} says what would be needed`);
    assert.ok(gap.department.length >= 5, `${gap.key} names the department it belongs to`);
  }
  // سجل التقرير المركّب مُثبَّت، فلا يمر فراغ يشير إلى فجوة لا يتابعها أحد.
  assert.deepEqual(epmo.GAP_REGISTRY, { installed: true, keys: epmo.MEASUREMENT_GAPS.length });

  const board = epmoBoard(db, users['epmo-lead']);
  assert.equal(board.gaps.length, epmo.MEASUREMENT_GAPS.length, 'the register lists the whole catalogue, never an empty table');
  assert.equal(board.gap_summary.declared, epmo.MEASUREMENT_GAPS.length, 'a gap with no plan row is still declared, not absent');
  tx(() => epmo.gapAction(db, users['epmo-lead'], 'nitaqat_band', 'refuse_gap', { version: 0, reason: REASON }));
  for (const plan of db.prepare('SELECT gap_key FROM epmo_gap_plans').all()) assert.ok(epmo.GAP_KEYS.includes(plan.gap_key), `plan ${plan.gap_key} resolves to a catalogue entry`);
  assert.equal(epmoBoard(db, users['epmo-lead']).gaps.length, epmo.MEASUREMENT_GAPS.length, 'writing a plan neither adds nor removes a gap');
});

test('EPMO gaps: the full life of one gap — owned with an owner and a date, closed with evidence, reopened back to declared', t => {
  const { db, users, tx } = fixture(t);
  const key = 'risk_coverage', act = (action, input) => tx(() => epmo.gapAction(db, users['epmo-lead'], key, action, input));
  const row = () => epmoBoard(db, users['epmo-lead']).gaps.find(g => g.key === key);

  assert.equal(row().status, 'declared');
  assert.equal(act('own_gap', { version: 0, owner_id: 'gap-owner', target_on: '2026-12-31' }).status, 'owned');
  assert.equal(row().owner_name, 'مالكة فجوة مصطنعة');
  assert.throws(() => act('own_gap', { version: 0, owner_id: 'gap-owner', target_on: '2026-12-31' }), code('stale_version'));
  assert.equal(act('close_gap', { version: 1, evidence: EVIDENCE }).status, 'closed');
  // المغلقة لا تُسنَد ولا تُرفض قبل إعادة فتحها: الحالة تُقرأ قبل الفعل لا بعده.
  assert.throws(() => act('close_gap', { version: 2, evidence: EVIDENCE }), code('action_unavailable'));
  assert.throws(() => act('own_gap', { version: 2, owner_id: 'gap-owner', target_on: '2027-01-01' }), code('action_unavailable'));
  const reopened = act('reopen_gap', { version: 2, reason: 'عاد البند غير مقيس بعد سحب الجدول المؤقت' });
  assert.equal(reopened.status, 'declared');
  assert.equal(row().closed_evidence, '', 'reopening clears the closure evidence: a gap that is open again carries no "closed" badge');
  assert.equal(row().owner_id, null, 'reopening returns the gap to declared with no owner');
  assert.ok(verifyAudit(db));
});

/* ───── 3. تعليق القسم: حدّه الأدنى، وواحد لكل قسم في كل فترة ───── */

test('EPMO notes: twenty characters at least, one note per section per period, and revision carries the next version', t => {
  const { db, users, tx } = fixture(t);
  const write = (input, who = 'epmo-lead') => tx(() => epmo.epmoNoteAction(db, users[who], input));
  assert.throws(() => write({ ...P, section_key: 'risks', body: 'لا جديد' }), code('invalid_text'), '"nothing new" is not a reading');
  assert.throws(() => write({ ...P, section_key: 'not_a_section', body: 'قراءة كافية الطول لقسم لا وجود له' }), code('section_key'));
  assert.throws(() => write({ period_from: '2026-08-31', period_to: '2026-08-01', section_key: 'risks', body: 'فترة مقلوبة بنص كافٍ الطول' }), code('date_order'));

  const first = write({ ...P, section_key: 'risks', body: 'ثلاثة مخاطر مفتوحة بلا خطة معالجة، واثنان منها على مشروع واحد.' });
  assert.equal(first.version, 1);
  assert.equal(first.created, true);
  // النسخة الثانية تصحيح للتعليق نفسه لا صفّ ثانٍ: لا رأيان لقسم واحد في فترة واحدة.
  assert.throws(() => write({ ...P, section_key: 'risks', body: 'محاولة كتابة ثانية بنسخة قديمة تمامًا', version: 0 }), code('stale_version'));
  const second = write({ ...P, section_key: 'risks', body: 'أُغلق خطر وبقي اثنان، وخطة المعالجة صدرت لأحدهما.', version: 1 });
  assert.equal(second.version, 2);
  assert.equal(second.id, first.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM epmo_section_notes WHERE section_key='risks'").get().n, 1);
  assert.throws(() => db.prepare("INSERT INTO epmo_section_notes(id,tenant_id,period_from,period_to,section_key,body,written_by,created_at,updated_at,version) VALUES(?,'36t','2026-08-01','2026-08-31','risks','قراءة ثانية للقسم نفسه في الفترة نفسها','epmo-lead','x','x',1)").run(randomUUID()), /UNIQUE constraint/);
  // والفترة لا تتحول بعد الكتابة: تعليق أغسطس لا يُنقل إلى سبتمبر بتعديل حقلين.
  assert.throws(() => db.prepare("UPDATE epmo_section_notes SET period_to='2026-09-30',version=3 WHERE id=?").run(first.id), /keeps its period and section/);

  // تعليق فترة أخرى لا يصطدم بتعليق هذه الفترة.
  const other = write({ period_from: '2026-09-01', period_to: '2026-09-30', section_key: 'risks', body: 'قراءة سبتمبر: خطر واحد جديد على مشروع مفتوح.' });
  assert.equal(other.version, 1);
  assert.equal(epmoBoard(db, users['epmo-lead'], P).notes.length, 1, 'the board shows the chosen period only');
  assert.ok(verifyAudit(db));
});

/* ───── 4. طلب القرار: لا حالة قرار بلا قرار مرتبط ───── */

test('EPMO decision requests: a request cannot be decided without a linked decision, and the link points at the existing decisions register', t => {
  const { db, users, tx } = fixture(t);
  const ask = () => tx(() => epmo.requestDecision(db, users['epmo-lead'], { ...P, section_key: 'portfolio', title: 'أي المشروعين يتقدم',
    asked: 'مشروعان يتنافسان على الفريق نفسه في سبتمبر، وأحدهما يتأخر حتمًا. أيهما يتقدم؟',
    options: ['تقديم مشروع العميل الأول وتأجيل الثاني أسبوعين', 'تقديم الثاني وإبلاغ الأول بالتأخير'],
    consequence_of_delay: 'يتأخر الاثنان معًا ويفقد الفريق أسبوعًا بلا قرار' }));

  // القيد في قاعدة البيانات: «مقرَّر» و«له قرار» وجهان لحالة واحدة، في الاتجاهين.
  const rawRequest = (status, decisionId) => db.prepare("INSERT INTO epmo_decision_requests(id,tenant_id,period_from,period_to,section_key,title,asked,options,consequence_of_delay,status,decision_id,withdrawn_reason,raised_by,created_at,updated_at,version) VALUES(?,'36t','2026-08-01','2026-08-31','portfolio','عنوان مصطنع','سؤال مصطنع طويل بما يكفي للقيد المعلن','[\"خيار أول\",\"خيار ثانٍ\"]','أثر التأجيل مكتوب',?,?,'','epmo-lead','x','x',1)").run(randomUUID(), status, decisionId);
  assert.throws(() => rawRequest('decided', null), /CHECK constraint/, 'decided with no decision is refused');
  assert.throws(() => rawRequest('withdrawn', null), /CHECK constraint/, 'withdrawn with no reason is refused');

  const r = ask();
  assert.throws(() => tx(() => epmo.decisionRequestAction(db, users['epmo-lead'], r.id, 'link_decision', { version: 1, decision_id: randomUUID() })), code('decision_not_found'),
    'the decision is recorded in the decisions register first, then linked here — no second decision store');
  assert.throws(() => tx(() => epmo.requestDecision(db, users['epmo-lead'], { ...P, section_key: 'portfolio', title: 'سؤال بخيار واحد',
    asked: 'سؤال طويل بما يكفي لكنه بخيار واحد فقط، وهذا ليس سؤالًا', options: ['الخيار الوحيد المتاح'], consequence_of_delay: 'أثر معلن' })), code('options'));

  // قرار حقيقي في سجل القرارات القائم، ثم يُربط.
  const decisionId = randomUUID();
  db.prepare("INSERT INTO governance_decisions(id,tenant_id,title,context,alternatives,decision,impact,decided_by,decided_on,reference,recorded_by,recorded_at) VALUES(?,'36t','تقديم مشروع العميل الأول','تعارض موارد بين مشروعين','تقديم الأول أو الثاني','يتقدم الأول ويُبلَّغ الثاني','تأخير أسبوعين على الثاني','exec','2026-09-01','','epmo-lead',?)").run(decisionId, now());
  const linked = tx(() => epmo.decisionRequestAction(db, users['epmo-lead'], r.id, 'link_decision', { version: 1, decision_id: decisionId }));
  assert.equal(linked.status, 'decided');
  assert.throws(() => tx(() => epmo.decisionRequestAction(db, users['epmo-lead'], r.id, 'withdraw_request', { version: 2, reason: REASON })), code('action_unavailable'));
  assert.throws(() => db.prepare('DELETE FROM epmo_decision_requests WHERE id=?').run(r.id), /never deleted/);

  const withdrawn = ask();
  assert.throws(() => tx(() => epmo.decisionRequestAction(db, users['epmo-lead'], withdrawn.id, 'withdraw_request', { version: 1, reason: 'لا' })), code('invalid_text'));
  tx(() => epmo.decisionRequestAction(db, users['epmo-lead'], withdrawn.id, 'withdraw_request', { version: 1, reason: 'سحبته الإدارة بعد أن حُل التعارض بجدولة جديدة' }));
  const board = epmoBoard(db, users['epmo-lead'], P);
  assert.equal(board.decision_requests.length, 0, 'nothing is open any more');
  assert.equal(board.decided_requests.length, 2, 'the decided and the withdrawn both stay visible with their reasons');
  assert.ok(verifyAudit(db));
});

/* ───── 5. لقطة E01 معتمدة واحدة لكل فترة ───── */

test('EPMO snapshots: the partial index refuses a second approved E01 for the same period, and leaves drafts unconstrained', t => {
  const { db } = fixture(t);
  const params = JSON.stringify({ from: '2026-08-01', to: '2026-08-31' });
  const body = JSON.stringify({ key: 'E01', rows: [] });
  const snapshot = (status, createdBy, approvedBy, p = params) => db.prepare('INSERT INTO report_snapshots(id,tenant_id,report_key,title,params,result,digest,status,created_by,approved_by,approved_at,approval_note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), '36t', 'E01', 'تقرير الإدارة التنفيذية للمشاريع', p, body, hash(body), status, createdBy, approvedBy, approvedBy ? now() : null, '', now());

  // المسودات بلا قيد: التحضير يتكرر.
  snapshot('draft', 'epmo-lead', null);
  snapshot('draft', 'exec', null);
  snapshot('draft', 'epmo-lead', null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM report_snapshots WHERE status='draft'").get().n, 3);

  // والاعتماد لا يتكرر: نسختان رسميتان للفترة نفسها تعنيان روايتين لا سبيل للقارئ بينهما.
  snapshot('approved', 'epmo-lead', 'exec');
  assert.throws(() => snapshot('approved', 'exec', 'epmo-lead'), /UNIQUE constraint/, 'a second approved E01 for the same period is refused');
  // فترة أخرى تمر: القيد على الفترة لا على التقرير.
  snapshot('approved', 'epmo-lead', 'exec', JSON.stringify({ from: '2026-09-01', to: '2026-09-30' }));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM report_snapshots WHERE status='approved'").get().n, 2);
  // وتقرير آخر لا يعنيه القيد أصلًا: الفهرس جزئي على E01 وحده.
  const other = db.prepare('INSERT INTO report_snapshots(id,tenant_id,report_key,title,params,result,digest,status,created_by,approved_by,approved_at,approval_note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 2; i++) other.run(randomUUID(), '36t', 'R07', 'تقرير آخر', params, body, hash(body), 'approved', 'epmo-lead', 'exec', now(), '', now());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM report_snapshots WHERE report_key='R07'").get().n, 2);
});

test('EPMO snapshots: period() in app/reports.mjs serialises params deterministically, which is what the partial index rests on', async t => {
  const { db, users, tx, grant } = fixture(t);
  grant('epmo-lead', 'executive.view');
  const reports = await import('../app/reports.mjs');
  const a = tx(() => reports.saveSnapshot(db, users['epmo-lead'], 'R07', { from: '2026-08-01', to: '2026-08-31' }));
  const b = tx(() => reports.saveSnapshot(db, users['epmo-lead'], 'R07', { from: '2026-08-01', to: '2026-08-31' }));
  const paramsOf = id => db.prepare('SELECT params FROM report_snapshots WHERE id=?').get(id).params;
  assert.equal(paramsOf(a.id), paramsOf(b.id), 'the same period always serialises to the same bytes');
  assert.equal(paramsOf(a.id), '{"from":"2026-08-01","to":"2026-08-31"}', 'key order is fixed at {from,to}');
});

/* ───── 6. التصاريح: من يكتب، ومن يقرأ، ومن لا يرى شيئًا ───── */

test('EPMO access: epmo.review writes, executive.view reads without writing, and an account with neither sees nothing', t => {
  const { db, users, tx } = fixture(t);
  const note = { ...P, section_key: 'gaps', body: 'سبع فجوات بلا مالك، وأربع منها على إدارة واحدة.' };

  // من يُعِدّ التقرير يكتب.
  assert.equal(tx(() => epmo.epmoNoteAction(db, users['epmo-lead'], note)).version, 1);

  // والتنفيذي يقرأ ولا يكتب: يقرأ الأرقام ويقرر، ولا يكتب تعليق الإدارة عنها.
  const read = epmoBoard(db, users.exec, P);
  assert.equal(read.can_prepare, false);
  assert.equal(read.notes.length, 1);
  assert.equal(read.gaps.length, epmo.MEASUREMENT_GAPS.length);
  assert.deepEqual(read.sections.find(s => s.key === 'gaps').actions, [], 'a reader is offered no write action');
  assert.deepEqual(read.gaps[0].actions, [], 'a reader is offered no gap action');
  assert.throws(() => tx(() => epmo.epmoNoteAction(db, users.exec, { ...note, body: 'محاولة تنفيذي لكتابة قراءة الإدارة', version: 1 })), code('not_permitted'));
  assert.throws(() => tx(() => epmo.gapAction(db, users.exec, 'revenue_target', 'refuse_gap', { version: 0, reason: REASON })), code('not_permitted'));
  assert.throws(() => tx(() => epmo.requestDecision(db, users.exec, { ...P, section_key: 'gaps', title: 'محاولة',
    asked: 'سؤال من حساب لا يملك تصريح الإعداد وهو طويل بما يكفي', options: ['أ من الخيارات', 'ب من الخيارات'], consequence_of_delay: 'أثر معلن' })), code('not_permitted'));

  // ومن لا يملك أيًّا من التصريحين لا يرى الشاشة أصلًا: لا كتالوج فجوات ولا أسئلة مفتوحة.
  assert.throws(() => epmoBoard(db, users.nobody, P), code('not_permitted'));
  assert.throws(() => epmoBoard(db, users.employee, P), code('not_permitted'));
  assert.throws(() => tx(() => epmo.gapAction(db, users.nobody, 'revenue_target', 'refuse_gap', { version: 0, reason: REASON })), code('not_permitted'));
  // والعزل بين الكيانات قائم كما في بقية المنصة.
  assert.throws(() => epmoBoard(db, users.external, P), code('not_permitted'));
  assert.ok(verifyAudit(db));
});

/* ───── 7. دورة كاملة: السلسلة تبقى متصلة ───── */

test('EPMO cycle: a note, a gap owned then closed, a question asked then decided — and verifyAudit still passes', t => {
  const { db, users, tx } = fixture(t);
  tx(() => epmo.epmoNoteAction(db, users['epmo-lead'], { ...P, section_key: 'portfolio', body: 'أحد عشر مشروعًا مفتوحًا، وثلاثة بلا مراجعة مخاطر.' }));
  tx(() => epmo.epmoNoteAction(db, users['epmo-lead'], { ...P, section_key: 'commentary', body: 'الشهر محكوم بتعارض موارد واحد، وقراره أمام القيادة في هذا التقرير.' }));
  tx(() => epmo.gapAction(db, users['epmo-lead'], 'unrecorded_capacity', 'own_gap', { version: 0, owner_id: 'gap-owner', target_on: '2026-11-30', note: 'تُسجَّل السعة من عقود العمل' }));
  tx(() => epmo.gapAction(db, users['epmo-lead'], 'unrecorded_capacity', 'close_gap', { version: 1, evidence: 'سُجِّلت سعة يومية لكل حساب نشط بمصدرها من عقد العمل' }));
  tx(() => epmo.gapAction(db, users['epmo-lead'], 'gosi_employer_share', 'refuse_gap', { version: 0, reason: REASON }));
  const r = tx(() => epmo.requestDecision(db, users['epmo-lead'], { ...P, section_key: 'resourcing', title: 'تعارض الموارد في سبتمبر',
    asked: 'مشروعان يتنافسان على الفريق نفسه، وأحدهما يتأخر حتمًا. أيهما يتقدم؟',
    options: ['تقديم الأول', 'تقديم الثاني', 'تعيين مورد خارجي للثاني'], consequence_of_delay: 'يتأخر الاثنان ويفقد الفريق أسبوعًا' }));
  const decisionId = randomUUID();
  db.prepare("INSERT INTO governance_decisions(id,tenant_id,title,context,alternatives,decision,impact,decided_by,decided_on,reference,recorded_by,recorded_at) VALUES(?,'36t','قرار تعارض سبتمبر','تعارض موارد','ثلاثة بدائل معروضة','يتقدم الأول ويُسند الثاني خارجيًا','كلفة إضافية على الثاني','exec','2026-09-02','','epmo-lead',?)").run(decisionId, now());
  tx(() => epmo.decisionRequestAction(db, users['epmo-lead'], r.id, 'link_decision', { version: 1, decision_id: decisionId }));

  const board = epmoBoard(db, users.exec, P);
  assert.equal(board.notes.length, 2);
  assert.equal(board.gap_summary.closed, 1);
  assert.equal(board.gap_summary.refused, 1);
  assert.equal(board.gap_summary.declared, epmo.MEASUREMENT_GAPS.length - 2);
  assert.equal(board.decision_requests.length, 0);
  assert.equal(board.decided_requests[0].decision_title, 'قرار تعارض سبتمبر');
  assert.ok(board.available_periods.length >= 2, 'periods come from duePeriod in report-schedules.mjs');
  for (const p of board.available_periods) assert.ok(p.to >= p.from && /^\d{4}-\d{2}-\d{2}$/.test(p.from));
  assert.equal(board.sections.length, 13, 'twelve sections plus the human commentary');
  assert.ok(board.sections.find(s => s.key === 'commentary').human);
  for (const s of board.sections) assert.ok(s.source.length >= 5, `${s.key} names its owning source`);
  assert.ok(verifyAudit(db), 'the audit chain is intact after a full cycle');
});

/* ───── 8. الترقية من قاعدة قبل 118 ───── */

test('EPMO migration 118: a database that stopped before it upgrades, keeps its rows, and gains the three registers and the E01 index', t => {
  const directory = mkdtempSync(join(tmpdir(), '36t-epmo-118-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'pre118.sqlite'), raw = new DatabaseSync(path);
  const schema = readFileSync(new URL('../app/schema.sql', import.meta.url), 'utf8');
  raw.exec('PRAGMA foreign_keys=ON');
  raw.exec(schema);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for (const file of readdirSync(new URL('../app/migrations/', import.meta.url)).filter(f => /^\d{3}-.+\.sql$/.test(f)).sort()) {
    const version = Number(file.slice(0, 3));
    if (version >= 118) continue;
    const sql = readFileSync(new URL('../app/migrations/' + file, import.meta.url), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version, hash(sql));
  }
  seed(raw, 'synthetic-pre-118');
  // لقطة معتمدة بمفتاح E01 موجودة قبل الترحيل: الفهرس الجزئي يُبنى فوقها ولا يوقف الترقية.
  const body = JSON.stringify({ key: 'E01', rows: [] }), stamp = '2026-09-01T00:00:00.000Z';
  raw.prepare('INSERT INTO report_snapshots(id,tenant_id,report_key,title,params,result,digest,status,created_by,approved_by,approved_at,approval_note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('legacy-e01', '36t', 'E01', 'لقطة سابقة', '{"from":"2026-07-01","to":"2026-07-31"}', body, hash(body), 'approved', 'manager', 'hr', stamp, 'اعتماد سابق', stamp);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version=118").get().n, 0, 'the database really stopped before 118');
  raw.close();

  const db = openDb(path);
  t.after(() => db.close());
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=118').get(), '118 is applied by openDb');
  for (const table of ['epmo_section_notes', 'epmo_gap_plans', 'epmo_decision_requests'])
    assert.equal(db.prepare("SELECT type FROM sqlite_master WHERE name=?").get(table).type, 'table', `${table} exists after the upgrade`);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='report_snapshots_e01_one_approved_per_period'").get());
  assert.equal(db.prepare("SELECT title FROM report_snapshots WHERE id='legacy-e01'").get().title, 'لقطة سابقة', 'the pre-existing approved snapshot survives untouched');
  // والقيد يسري على ما بعده: لقطة معتمدة ثانية للفترة نفسها مرفوضة، ولو كانت الأولى سابقة للترحيل.
  assert.throws(() => db.prepare('INSERT INTO report_snapshots(id,tenant_id,report_key,title,params,result,digest,status,created_by,approved_by,approved_at,approval_note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), '36t', 'E01', 'لقطة ثانية', '{"from":"2026-07-01","to":"2026-07-31"}', body, hash(body), 'approved', 'hr', 'manager', stamp, '', stamp), /UNIQUE constraint/);
  // والسجلّات الثلاثة تعمل على القاعدة المُرقّاة كما تعمل على قاعدة جديدة.
  const users = Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id,name FROM users').all().map(u => [u.id, u]));
  transaction(db, () => grantAccess(db, users.admin, { user_id: 'manager', capability: 'epmo.review', department_id: '', note: 'تصريح اختبار الترقية' }));
  transaction(db, () => epmo.gapAction(db, users.manager, 'training_cost', 'refuse_gap', { version: 0, reason: REASON }));
  assert.equal(epmoBoard(db, users.manager).gap_summary.refused, 1);
  assert.ok(verifyAudit(db));
});
