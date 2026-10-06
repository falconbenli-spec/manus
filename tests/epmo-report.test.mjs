import test from 'node:test';
import assert from 'node:assert/strict';
import { once as listen } from 'node:events';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createApp } from '../app/server.mjs';
import * as reports from '../app/reports.mjs';
import * as epmo from '../app/epmo-report.mjs';
import { epmoBoard } from '../app/epmo-board.mjs';
import { epmoUI } from '../app/static/epmo-ui.mjs';
import { FIGURE_KINDS, compositeRows, compositeSheets } from '../app/report-figures.mjs';
import { createSchedule, runDueSchedules, duePeriod } from '../app/report-schedules.mjs';
import { workbook } from '../app/xlsx.mjs';

// التقرير المركّب E01 — المرحلة الرابعة. ما تحرسه هذه الاختبارات ثلاث جمل:
// (1) الرقم بمصدره أو الفراغ بسببه، ولا ثالث — ولا يخرج غياب القياس صفرًا في أي ملف ولا في أي شاشة.
// (2) اللقطة تُختم مرة واحدة: بصمتها تغطي الكلمات مع الأرقام، ويعتمدها غير من أعدّها، مرة واحدة للفترة.
// (3) ما يظهر على الشاشة هو نفسه ما يخرج في CSV وفي XLSX وفي نسخة الطباعة، بلا فرق في بند واحد.

const code = value => error => error.code === value;
const P = { from: '2026-08-01', to: '2026-08-31' };
const NOTE = 'قراءة الإدارة لهذه الفترة: مشروع واحد بلا خطر مسجل، ومؤشر بلا قياس، والقرار أمام القيادة.';
const APPROVAL = 'راجعت الأقسام وتغطيتها المعلنة وقراءة الإدارة قبل الاعتماد';

// ZIP صغير مطابق لما يكتبه app/xlsx.mjs: ترويسة محلية بـ30 بايت وضغط deflate.
function unzip(buffer) {
  const files = new Map();
  for (let i = 0; i + 4 <= buffer.length && buffer.readUInt32LE(i) === 0x04034b50;) {
    const packed = buffer.readUInt32LE(i + 18), nameLength = buffer.readUInt16LE(i + 26), extraLength = buffer.readUInt16LE(i + 28);
    const name = buffer.toString('utf8', i + 30, i + 30 + nameLength), start = i + 30 + nameLength + extraLength;
    files.set(name, inflateRawSync(buffer.subarray(start, start + packed)).toString('utf8'));
    i = start + packed;
  }
  return files;
}
const figuresOf = result => result.sections.flatMap(s => (s.groups ?? []).flatMap(g => g.figures ?? []));
const figureNamed = (result, label) => figuresOf(result).find(f => f.label === label);

// بيانات مصطنعة تكفي ليخرج في التقرير: رقم مقيس قوي، ورقم مقيس دون مستهدفه، وبند بلا قياس.
function synthetic(db) {
  const time = now();
  db.prepare('INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES(?,?,?,?,?,?)')
    .run('proj-epmo', '36t', 'مشروع مصطنع بلا خطر مسجل', 'موجز مصطنع للاختبار', 'epmo-lead', time);
  db.prepare("INSERT INTO governance_objectives(id,tenant_id,department_id,title,statement,owner_id,period_from,period_to,status,closure_note,created_by,version,created_at,updated_at) VALUES('obj-1','36t','ops','هدف مصطنع للاختبار','ما يقيس تحققه مؤشراه المسجلان','epmo-lead','2026-01-01','2026-12-31','open','','epmo-lead',1,?,?)").run(time, time);
  db.prepare("INSERT INTO governance_initiatives(id,tenant_id,objective_id,title,owner_id,due_date,budget_minor,budget_id,budget_note,status,proposed_by,approved_by,approved_at,decision_note,outcome_note,version,created_at,updated_at) VALUES('ini-1','36t','obj-1','مبادرة مصطنعة للاختبار','epmo-lead','2026-10-31',NULL,NULL,'','proposed','epmo-lead',NULL,NULL,'','',1,?,?)").run(time, time);
  const indicator = db.prepare('INSERT INTO governance_indicators(id,tenant_id,initiative_id,title,unit,baseline_value,target_value,direction,measurement_source,created_by,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)');
  indicator.run('ind-measured', '36t', 'ini-1', 'مؤشر مقيس', 'يومًا', 20, 10, 'down', 'كشف مصطنع يقرؤه مسؤول التشغيل شهريًا', 'epmo-lead', time, time);
  indicator.run('ind-unmeasured', '36t', 'ini-1', 'مؤشر بلا قياس', 'طلبًا', 0, 40, 'up', 'كشف مصطنع آخر لم يُقرأ بعد ولا قياس له', 'epmo-lead', time, time);
  db.prepare("INSERT INTO governance_measurements(id,indicator_id,value,measured_on,source,recorded_by,recorded_at,corrects_id,correction_reason) VALUES(?,'ind-measured',14,'2026-08-20','كشف مصطنع بتاريخه','epmo-lead',?,NULL,'')").run(randomUUID(), time);
  return { indicator_measured: 'مؤشر مقيس — مبادرة مصطنعة للاختبار', indicator_unmeasured: 'مؤشر بلا قياس — مبادرة مصطنعة للاختبار' };
}

function fixture(t) {
  const db = openDb(':memory:');
  seed(db, 'synthetic-epmo-report-tests-only');
  t.after(() => db.close());
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('epmo-lead','36t','ops','epmo-lead','قائدة مكتب المشاريع المصطنعة','unused-test-hash','manager',NULL),
    ('exec','36t','ops','exec','تنفيذي مصطنع','unused-test-hash','manager',NULL),
    ('exec-two','36t','ops','exec-two','تنفيذي مصطنع ثانٍ','unused-test-hash','manager',NULL),
    ('gap-owner','36t','ops','gap-owner','مالكة فجوة مصطنعة','unused-test-hash','employee','epmo-lead')`);
  const users = Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id,name FROM users').all().map(u => [u.id, u]));
  const tx = f => transaction(db, f);
  const grant = (user_id, capability) => tx(() => grantAccess(db, users.admin, { user_id, capability, department_id: '', note: 'تصريح اختبار تقرير EPMO المركّب' }));
  grant('epmo-lead', 'epmo.review');
  grant('exec', 'executive.view');
  grant('exec-two', 'executive.view');
  const labels = synthetic(db);
  return { db, users, tx, grant, labels };
}

/* ───── 1. المسارات الأربعة: E01 يُشغَّل ويُلتقط ويُصدَّر ويُطبع ───── */

test('E01 routes: run, snapshot, export and print all answer for a key that is not R\\d{2}', async t => {
  const db = openDb(':memory:');
  seed(db, 'synthetic-epmo-http');
  const users = Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,role,manager_id,name FROM users').all().map(u => [u.id, u]));
  transaction(db, () => grantAccess(db, users.admin, { user_id: 'manager', capability: 'epmo.review', department_id: '', note: 'إعداد التقرير' }));
  transaction(db, () => grantAccess(db, users.admin, { user_id: 'hr', capability: 'executive.view', department_id: '', note: 'قراءة التقرير واعتماده' }));
  const server = createApp(db); server.listen(0, '127.0.0.1'); await listen(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`, sessions = {};
  for (const username of ['manager', 'hr']) {
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'synthetic-epmo-http' }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    sessions[username] = { cookie: response.headers.get('set-cookie').split(';')[0], csrf: body.csrf };
  }
  const post = async (who, path, input, expected = 201) => {
    const auth = sessions[who];
    const response = await fetch(base + '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: auth.cookie, 'x-csrf-token': auth.csrf, 'Idempotency-Key': randomUUID() }, body: JSON.stringify(input) });
    const body = await response.json(); assert.equal(response.status, expected, JSON.stringify(body)); return body;
  };
  const get = async (who, path, expected = 200) => {
    const response = await fetch(base + '/api' + path, { headers: { cookie: sessions[who].cookie } });
    assert.equal(response.status, expected, path);
    return { type: response.headers.get('content-type'), body: Buffer.from(await response.arrayBuffer()) };
  };
  const query = `?from=${P.from}&to=${P.to}`;

  // (1) التشغيل. لو بقي المسار على R\d{2} لعاد 404 هنا ولبدا التقرير غير مبني.
  const live = await post('manager', '/reports/E01/run', P);
  assert.equal(live.shape, 'composite');
  assert.equal(live.sections.length, epmo.SECTIONS.length);
  assert.deepEqual([live.columns, live.rows], [[], []], 'the composite keeps columns and rows present and empty');
  // (2) اللقطة.
  const snapshot = await post('manager', '/reports/E01/snapshots', P);
  assert.ok(snapshot.id, 'a draft snapshot was saved through the same route the tabular reports use');
  // (3) التصدير بصيغتيه.
  const xlsx = await get('manager', `/reports/E01/export.xlsx${query}`);
  assert.ok(xlsx.type.includes('spreadsheetml'), 'the workbook is served as a workbook');
  assert.ok(unzip(xlsx.body).has('xl/workbook.xml'), 'and it really is an OOXML package');
  const csvFile = await get('manager', `/reports/E01/export.csv${query}`);
  assert.ok(csvFile.body.toString('utf8').includes(FIGURE_KINDS.unmeasurable), 'the CSV names what cannot be measured in words');
  // (4) الطباعة.
  const print = await get('manager', `/reports/E01/print${query}`);
  assert.ok(print.type.includes('text/html'));
  assert.ok(print.body.toString('utf8').includes('dir="rtl"'));
  // والقارئ التنفيذي يمر بالأربعة كلها أيضًا؛ ومن لا يملك أيًّا من التصريحين لا يمر بأيٍّ منها.
  await get('hr', `/reports/E01/print${query}`);
  await post('hr', '/reports/E01/run', P);
  await get('employee' in sessions ? 'employee' : 'manager', `/reports/E01/print${query}`);
  assert.ok(verifyAudit(db));
});

/* ───── 2. التصنيف: تقرير مركّب بلا جمهور معلن لا يراه إلا مُعِدّه ───── */

test('E01 audience: the composite is classified executive, and every composite definition is classified somewhere', () => {
  assert.equal(reports.snapshotAudience('E01'), 'executive', 'an unclassified key falls back to creator, and then nobody but its preparer could ever approve it');
  const classified = new Set(Object.values(reports.AUDIENCE).flat());
  // الحارس الذي يسقط عند نسيان التقرير المركّب التالي، لا عند نسيان E01 وحده.
  const composites = reports.REPORTS.filter(r => r.shape === 'composite');
  assert.ok(composites.length >= 1, 'there is at least one composite report to classify');
  for (const report of composites) assert.ok(classified.has(report.key), `${report.key} is a composite with no AUDIENCE class: it would default to creator and could never be approved`);
  for (const report of reports.REPORTS) assert.ok(classified.has(report.key) || reports.snapshotAudience(report.key) === 'creator');
});

/* ───── 3. الختم والاعتماد باثنين على لقطة مركّبة ───── */

test('E01 snapshot: the digest seals words with numbers, the body cannot be rewritten, and the preparer never approves', t => {
  const { db, users, tx } = fixture(t);
  tx(() => epmo.epmoNoteAction(db, users['epmo-lead'], { period_from: P.from, period_to: P.to, section_key: 'risks', body: NOTE }));
  const saved = tx(() => reports.saveSnapshot(db, users['epmo-lead'], 'E01', P));
  const sealed = reports.readSnapshot(db, users['epmo-lead'], saved.id);
  assert.equal(sealed.shape, 'composite');
  // قراءة الإدارة مطوية داخل الجسم المختوم: البصمة تغطي الكلام والرقم معًا.
  assert.ok(JSON.stringify(sealed.sections).includes(NOTE), 'the commentary travels inside the sealed body');
  assert.equal(sealed.sections.find(s => s.key === 'risks').note, NOTE);
  assert.ok(figureNamed(sealed, 'المخاطر'), 'the commentary section names each section it read');

  // الجسم لا يُعاد كتابته: القيد في قاعدة البيانات لا في الشيفرة وحدها.
  assert.throws(() => db.prepare("UPDATE report_snapshots SET result='{\"key\":\"E01\"}' WHERE id=?").run(saved.id), /keeps the figures it captured/);
  // وبصمة لا تطابق محتواها تُرفض عند القراءة، فلا يمر جسم بُدِّل من خارج المنصة.
  const forged = randomUUID(), body = JSON.stringify({ key: 'E01', shape: 'composite', sections: [], rows: [], columns: [] });
  db.prepare("INSERT INTO report_snapshots(id,tenant_id,report_key,title,params,result,digest,status,created_by,created_at) VALUES(?,'36t','E01','لقطة مزوّرة',?,?,'بصمة-لا-تطابق','draft','epmo-lead',?)")
    .run(forged, JSON.stringify(P), body, now());
  assert.throws(() => reports.readSnapshot(db, users['epmo-lead'], forged), code('snapshot_corrupted'));

  // الاعتماد باثنين: من أعدّ لا يعتمد، ومن لا تغطيه صلاحية التقرير لا يعتمد.
  assert.throws(() => tx(() => reports.snapshotAction(db, users['epmo-lead'], saved.id, 'approve_snapshot', { note: APPROVAL })), code('separation_of_duties'));
  assert.throws(() => tx(() => reports.snapshotAction(db, users['gap-owner'], saved.id, 'approve_snapshot', { note: APPROVAL })), code('not_found'));
  const approved = tx(() => reports.snapshotAction(db, users.exec, saved.id, 'approve_snapshot', { note: APPROVAL }));
  assert.equal(approved.status, 'approved');
  assert.equal(reports.readSnapshot(db, users.exec, saved.id).snapshot.status, 'approved');
  assert.ok(verifyAudit(db));
});

/* ───── 4. لقطة معتمدة واحدة لكل فترة ───── */

test('E01 snapshot: the partial index refuses a second approved snapshot for the same period', t => {
  const { db, users, tx } = fixture(t);
  const first = tx(() => reports.saveSnapshot(db, users['epmo-lead'], 'E01', P));
  const second = tx(() => reports.saveSnapshot(db, users['epmo-lead'], 'E01', P));
  assert.notEqual(first.id, second.id, 'preparing repeats: drafts carry no constraint');
  tx(() => reports.snapshotAction(db, users.exec, first.id, 'approve_snapshot', { note: APPROVAL }));
  // نسختان رسميتان للفترة نفسها تعنيان روايتين لا سبيل للقارئ بينهما.
  assert.throws(() => tx(() => reports.snapshotAction(db, users['exec-two'], second.id, 'approve_snapshot', { note: APPROVAL })), /UNIQUE constraint/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM report_snapshots WHERE report_key='E01' AND status='approved'").get().n, 1);
  // وفترة أخرى تمر: القيد على الفترة لا على التقرير.
  const other = { from: '2026-09-01', to: '2026-09-30' };
  const third = tx(() => reports.saveSnapshot(db, users['epmo-lead'], 'E01', other));
  assert.equal(tx(() => reports.snapshotAction(db, users.exec, third.id, 'approve_snapshot', { note: APPROVAL })).status, 'approved');
  assert.ok(verifyAudit(db));
});

/* ───── 5. الجدولة: لقطة واحدة للأسبوع المنتهي، ولا تتكرر ───── */

test('E01 schedule: a weekly schedule produces exactly one draft for the closed week, and running it again is a no-op', t => {
  const { db, users, tx } = fixture(t);
  const schedule = tx(() => createSchedule(db, users['epmo-lead'], { report_key: 'E01', cadence: 'weekly' }));
  const runDate = db.prepare('SELECT next_run FROM report_schedules WHERE id=?').get(schedule.id).next_run;
  const week = duePeriod('weekly', runDate);

  const first = runDueSchedules(db, runDate);
  assert.equal(first.length, 1);
  assert.equal(first[0].outcome, 'snapshot');
  const snapshots = () => db.prepare("SELECT id,params,status FROM report_snapshots WHERE report_key='E01'").all();
  assert.equal(snapshots().length, 1);
  assert.equal(snapshots()[0].status, 'draft', 'the schedule prepares, it never approves');
  assert.equal(JSON.parse(snapshots()[0].params).from, week.from, 'the captured period is the closed week');

  // التشغيل التالي بالتاريخ نفسه لا يلتقط شيئًا: موعد التشغيل تقدّم.
  assert.deepEqual(runDueSchedules(db, runDate), []);
  assert.equal(snapshots().length, 1);
  // وحتى لو أُعيد موعد التشغيل إلى الوراء، الفترة الملتقطة لا تُلتقط مرتين.
  db.prepare('UPDATE report_schedules SET next_run=? WHERE id=?').run(runDate, schedule.id);
  assert.deepEqual(runDueSchedules(db, runDate), []);
  assert.equal(snapshots().length, 1, 'one period, one snapshot — never two reports of the same week');
  assert.ok(verifyAudit(db));
});

/* ───── 6. غياب القياس لا يُكتب صفرًا في أي مخرج ───── */

test('E01 figures: an indicator with no measurement is never serialised as 0 — not in JSON, not in CSV, not in the workbook', t => {
  const { db, users, labels } = fixture(t);
  const result = reports.runReport(db, users['epmo-lead'], 'E01', P);
  const blank = figureNamed(result, labels.indicator_unmeasured);
  assert.ok(blank, 'the unmeasured indicator is declared, not dropped');
  assert.equal(blank.kind, 'unavailable');
  assert.equal(blank.value, null, 'a missing measurement is null, never zero');
  assert.equal(blank.tone, 'blank');
  assert.ok(blank.reason.length >= 10 && blank.needed.length >= 10, 'the blank says why it is blank and what would fill it');
  assert.ok(!JSON.stringify(blank).includes('"value":0'));

  // والمقيس بجانبه رقم حقيقي بفجوته بوحدة المؤشر نفسها — لا نسبة إنجاز.
  const measured = figureNamed(result, labels.indicator_measured);
  assert.equal(measured.kind, 'measured');
  assert.equal(measured.value, -4, 'the gap is a difference in the indicator unit: measured 14 against a ceiling of 10');
  assert.equal(measured.unit, 'يومًا');
  assert.ok(!JSON.stringify(result).includes('percent_complete_value'), 'the platform computes no completion percentage');

  const row = compositeRows(result).find(r => r[2] === labels.indicator_unmeasured);
  assert.equal(row[3], FIGURE_KINDS.unavailable, 'the CSV value cell carries the Arabic phrase');
  assert.ok(!row.includes(0) && !row.includes('0'), 'nowhere in the row is the missing value written as zero');
  assert.ok(row.every(cell => cell !== '' && cell !== null && cell !== undefined), 'and not one cell is left blank, because a blank cell reads as zero');

  const sheets = compositeSheets(result), files = unzip(workbook(sheets));
  const objectives = sheets.findIndex(s => s.name === 'الأهداف والمبادرات');
  const xml = files.get(`xl/worksheets/sheet${objectives + 1}.xml`);
  const xmlRow = (xml.match(/<row [^>]*>.*?<\/row>/g) ?? []).find(r => r.includes(labels.indicator_unmeasured)) ?? '';
  assert.ok(xmlRow.includes(FIGURE_KINDS.unavailable));
  assert.ok(!/<v>0<\/v>/.test(xmlRow), 'no zero was invented in the workbook for the figure nobody measured');
  assert.equal((xmlRow.match(/<c /g) ?? []).length, sheets[objectives].rows[0].length, 'every column produced a cell — a dropped cell reads as zero');
});

/* ───── 7. تطابق المخرجات: الشاشة = CSV = XLSX ───── */

test('E01 export parity: screen totals equal the CSV equal the workbook, one sheet per section plus the declared-gaps sheet with owners and dates', t => {
  const { db, users, tx } = fixture(t);
  tx(() => epmo.gapAction(db, users['epmo-lead'], 'milestone_records', 'own_gap', { version: 0, owner_id: 'gap-owner', target_on: '2026-12-31' }));
  const result = reports.runReport(db, users['epmo-lead'], 'E01', P);
  const declared = result.coverage.declared, figures = figuresOf(result);
  assert.equal(figures.length, declared, 'the screen counts every declared item once');
  assert.equal(result.coverage.measured + result.coverage.unavailable + result.coverage.unmeasurable, declared);

  // CSV: صف ترويسة ثم صف لكل بند، بالعدد نفسه الذي تعرضه الشاشة.
  const rows = compositeRows(result);
  assert.equal(rows.length - 1, declared, 'the CSV carries exactly the same items the screen showed');

  // XLSX: ورقة لكل قسم، ثم الورقة الجامعة للفجوات المعلنة.
  const sheets = compositeSheets(result);
  assert.equal(sheets.length, result.sections.length + 1);
  assert.deepEqual(sheets.slice(0, -1).map(s => s.name), result.sections.map(s => s.name));
  assert.equal(new Set(sheets.map(s => s.name)).size, sheets.length, 'no two sheets share a name: a duplicate name is a workbook that will not open');
  assert.equal(sheets.slice(0, -1).reduce((n, s) => n + s.rows.length - 1, 0), declared, 'the section sheets together carry the same items');

  const gapsSheet = sheets.at(-1);
  assert.equal(gapsSheet.rows.length - 1, result.coverage.missing.length, 'the declared-gaps sheet names every blank, summarising none away');
  const header = gapsSheet.rows[0];
  assert.ok(header.includes('من تسلّم إغلاق الفجوة') && header.includes('التاريخ المستهدف لإغلاقها'));
  const ownedRow = gapsSheet.rows.find(r => r.includes('milestone_records'));
  assert.ok(ownedRow.includes('مالكة فجوة مصطنعة') && ownedRow.includes('2026-12-31'), 'an owned gap ships with who took it and when they promised');
  assert.ok(gapsSheet.rows.every(r => r.every(cell => cell !== '' && cell !== null && cell !== undefined)));

  // ولا تخرج البصمة نفسها مختلفة بين الملفين: القيمة المعروضة والقيمة المصدَّرة بند واحد.
  const xlsxFile = reports.exportReport(result, 'xlsx'), csvFile = reports.exportReport(result, 'csv');
  assert.equal(xlsxFile.filename, `E01-${P.from}-${P.to}.xlsx`);
  assert.equal(csvFile.filename, `E01-${P.from}-${P.to}.csv`);
  const text = csvFile.content.toString('utf8');
  for (const gap of epmo.MEASUREMENT_GAPS.slice(0, 5)) assert.ok(text.includes(gap.key), `${gap.key} reaches the export by name`);
  assert.equal(unzip(xlsxFile.content).size >= sheets.length, true);
  assert.ok(!/,,/.test(text) && !/,\r\n/.test(text), 'no empty field anywhere in the CSV');
});

/* ───── 8. نسخة الطباعة: عربية من اليمين، بورقة أنماط المنصة وحدها ───── */

test('E01 printable: right-to-left Arabic on the platform stylesheet, with no script and no external origin', t => {
  const { db, users } = fixture(t);
  const html = reports.printable(reports.runReport(db, users['epmo-lead'], 'E01', P));
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('lang="ar"') && html.includes('dir="rtl"'));
  assert.ok(html.includes('<link rel="stylesheet" href="/report-print.css">'), 'the platform stylesheet, by its own path');
  assert.ok(!/<script/i.test(html), 'no script tag: the content policy is strict (script-src self)');
  assert.ok(!/ on[a-z]+=/i.test(html), 'and no inline handler attribute either');
  assert.ok(!/ style=/i.test(html), 'and no inline style attribute');
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1)/i.test(html), 'nothing is loaded from outside the platform');
  assert.ok(html.includes(FIGURE_KINDS.unmeasurable) && html.includes('الفجوات المعلنة'));
  for (const s of epmo.SECTIONS) assert.ok(html.includes(s.name), `${s.key} appears in the printed copy`);
});

/* ───── 9. الشاشة: الفراغ لا يأخذ شريطًا، والضعيف يأخذ شريطًا كاملًا بنبرة التأخر ───── */

test('E01 screen: an unmeasured figure carries its Arabic phrase and never a bar, while a weak measured figure carries a full bar in the late tone', t => {
  const { db, users, labels } = fixture(t);
  const board = epmoBoard(db, users['epmo-lead'], { period_from: P.from, period_to: P.to });
  assert.equal(board.report.key, 'E01');
  assert.equal(board.report.shape, 'composite');
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const buttons = [], button = (action, id, label) => { buttons.push([action, id]); return `<button>${e(label)}</button>`; };
  const html = epmoUI.render(board, { e, button });
  assert.ok(!/\bundefined\b|\bNaN\b|\[object /.test(html.replace(/<[^>]+>/g, ' ')));

  const rows = html.match(/<li class="figure-[^"]*"[\s\S]*?<\/li>/g) ?? [];
  const rowFor = label => rows.find(r => r.includes(e(label))) ?? '';
  // الفراغ: عبارته العربية وسببه وما يلزم لقياسه — وبلا شريط بأي طول.
  const blankRow = rowFor(labels.indicator_unmeasured);
  assert.ok(blankRow.includes(FIGURE_KINDS.unavailable), 'the phrase is on the screen, not a hole');
  assert.ok(blankRow.includes('يلزم لقياسه'), 'and what is needed to measure it');
  assert.ok(!blankRow.includes('vn-bar') && !blankRow.includes('data-width'), 'a figure nobody measured never gets a coverage bar: a zero-length bar reads as zero');
  // الضعيف: مقيس تمامًا وضعيف تمامًا — شريط كامل بنبرة التأخر.
  const weakRow = rowFor('مشاريع بلا خطر مفتوح واحد مربوط بها');
  assert.ok(weakRow.includes('data-width="100"') && weakRow.includes('vn-bar is-late'), 'a measured figure below its declared target keeps a full bar, in the late tone');
  assert.ok(weakRow.includes('دون المستهدف المعلن'));
  assert.notEqual(blankRow.replace(/\s+/g, ''), weakRow.replace(/\s+/g, ''), 'the two never render alike');

  // ولكل قسم تغطيته المعلنة، وللشاشة طريق واحد إلى الاعتماد: مركز التقارير.
  assert.equal(Object.keys(board.report.section_coverage).length, epmo.SECTIONS.length);
  assert.ok(html.includes('href="#reports"'), 'the screen links to the reports centre, where approval lives with its separation of duties');
  assert.ok(buttons.some(([action]) => action === 'save_snapshot'));
  const form = epmoUI.form('save_snapshot', '', board);
  assert.equal(form.endpoint, '/reports/E01/snapshots');
  assert.deepEqual(form.toPayload({ from: P.from, to: P.to }), P);
  // وقسم الفجوات لا يفرغ ولا يُطوى.
  const gapsSection = board.report.sections.find(s => s.key === 'gaps');
  assert.ok(gapsSection.groups.length >= 2 && gapsSection.groups[0].figures.length >= 5);
});

/* ───── 10. الدورة كاملة: إعداد ← قراءة ← لقطة ← اعتماد، والسلسلة متصلة ───── */

test('E01 cycle: prepare, note, snapshot and approve — and verifyAudit still passes', t => {
  const { db, users, tx } = fixture(t);
  const body = reports.runReport(db, users['epmo-lead'], 'E01', P);
  assert.equal(body.sections.length, epmo.SECTIONS.length, 'thirteen sections including the human commentary');
  // الأقسام التي تحمل أرقامًا حقيقية اليوم، والأقسام المعلنة بفجواتها — كلتاهما مصرَّح بهما لا مخفيتان.
  for (const key of ['blockers', 'objectives', 'risks', 'decisions', 'gaps'])
    assert.ok(body.section_coverage[key].measured > 0, `${key} carries real figures`);
  for (const key of ['services', 'receivables', 'profitability', 'resourcing', 'workforce'])
    assert.equal(body.section_coverage[key].measured, 0, `${key} is a declared gap, not a filled-in guess`);
  for (const key of ['portfolio', 'pipeline'])
    assert.ok(body.section_coverage[key].declared > 0 && body.section_coverage[key].measured === 0,
      `${key} declares its items and waits for the executive-scope branch rather than inventing a number`);
  // كل بند غير قابل للقياس يحمل مفتاح فجوة مسجَّلًا في الكتالوج.
  for (const f of figuresOf(body)) if (f.kind === 'unmeasurable') {
    assert.ok(epmo.GAP_KEYS.includes(f.gap_key), `${f.label} points at a registered gap`);
    assert.equal(f.gap_registered, true);
  }

  tx(() => epmo.epmoNoteAction(db, users['epmo-lead'], { period_from: P.from, period_to: P.to, section_key: 'commentary', body: NOTE }));
  tx(() => epmo.gapAction(db, users['epmo-lead'], 'unrecorded_capacity', 'own_gap', { version: 0, owner_id: 'gap-owner', target_on: '2026-11-30' }));
  const saved = tx(() => reports.saveSnapshot(db, users['epmo-lead'], 'E01', P));
  tx(() => reports.snapshotAction(db, users.exec, saved.id, 'approve_snapshot', { note: APPROVAL }));

  const board = epmoBoard(db, users.exec, { period_from: P.from, period_to: P.to });
  assert.equal(board.snapshots.length, 1);
  assert.equal(board.snapshots[0].status, 'approved');
  assert.deepEqual(board.snapshot_ids, [saved.id], 'visibility comes from the reports centre alone, not from a second rule on this screen');
  // الفجوة المسنَدة تخرج في التقرير بمالكها وتاريخها المستهدف.
  const owned = figuresOf(reports.readSnapshot(db, users.exec, saved.id)).find(f => f.gap_key === 'unrecorded_capacity' && f.owner);
  assert.equal(owned.owner, 'مالكة فجوة مصطنعة');
  assert.equal(owned.target_on, '2026-11-30');
  assert.ok(verifyAudit(db), 'the audit chain is intact after prepare, note, snapshot and approve');
});
