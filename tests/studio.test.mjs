import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { createOnce } from '../app/idempotency.mjs';
import { listStudio, createStudio, studioAction } from '../app/studio.mjs';
import { studioUI } from '../app/static/studio-ui.mjs';

const code = value => error => error.code === value;
const briefInput = () => ({ objective: 'هدف تجريبي قابل للمراجعة', audience: 'جمهور مصطنع للمشروع', audience_basis: 'افتراض محلي معلن؛ لم يجر بحث ميداني', message: 'رسالة الاختبار المعتمدة', prohibited_messages: 'منع الادعاءات الطبية والوعود غير المسندة', kpi: 'عدد استكمال نموذج الاهتمام؛ ليس قياس أثر تجاري', measurement_source: 'سجل تجريبي محلي غير متصل بمصدر خارجي', channels: ['instagram', 'website'], scope: 'مخرجان نصيان للاختبار الداخلي فقط' });
const assetInput = (reference = 'DEMO_ASSET_01', extra = {}) => ({ name: 'أصل نصي مصطنع', internal_reference: reference, rights_holder: 'صاحب حق مصطنع', rights_basis: 'owned', rights_evidence: 'إفادة ملكية داخلية مصطنعة، ليست ملف ترخيص', valid_from: '2020-01-01', valid_until: '2099-12-31', channels: ['instagram', 'website'], ...extra });
const outputInput = assetId => ({ title: 'المخرج النصي الأول', channel: 'instagram', format: 'نص تجريبي', dimensions: 'مربع موصوف 1080×1080 دون ملف صورة', language: 'العربية', brand_reference: 'ATHAR-DEMO', acceptance: 'مطابقة الرسالة وعدم وجود ادعاء غير مسند', content: 'محتوى عربي مصطنع للمراجعة الداخلية.', asset_ids: [assetId] });
const quality = () => ({ brand: 'passed', language: 'passed', claims: 'passed', accessibility: 'passed', specification: 'passed' });
const packageInput = outputId => ({ output_ids: [outputId], use_from: '2099-01-01', use_until: '2099-12-01', exclusions: 'لا توجد ملفات إنتاج فعلية؛ البيان يحفظ النص والمراجع فقط' });

function fixture(t) {
  const db = openDb(':memory:');
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='studio_workspaces'").get()) {
    const draft = new URL('../work/studio-009.sql', import.meta.url);
    assert.equal(existsSync(draft), true); db.exec(readFileSync(draft, 'utf8'));
  }
  seed(db, 'synthetic-studio-tests-only');
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('pm-studio','36t','creative','pm-studio','مراجع مشروع مصطنع','unused-test-hash','pm','manager'),('other-manager','36t','creative','other-manager','مدير فريق آخر','unused-test-hash','manager',NULL)");
  const users = Object.fromEntries(db.prepare('SELECT id,tenant_id,department_id,manager_id,role,name FROM users').all().map(u => [u.id, u]));
  const project = transaction(db, () => createProject(db, users.manager, { name: 'مشروع استوديو مصطنع', brief: 'اختبار الاستوديو الداخلي', member_ids: ['employee', 'pm-studio'] }));
  const make = (who = 'employee', extra = {}) => transaction(db, () => createStudio(db, users[who], { project_id: project.id, title: 'مساحة تسليم مصطنعة', ...briefInput(), ...extra }));
  const act = (who, s, action, input = {}) => transaction(db, () => studioAction(db, users[who], s.id, action, { version: s.version, ...input }));
  const production = () => act('manager', act('employee', make(), 'submit_brief'), 'approve_brief', { note: 'راجعنا الهدف والرسالة والمحظورات' });
  const addAsset = (s, extra = {}) => act('employee', s, 'add_asset', assetInput('ASSET_' + s.assets.length, extra));
  const inspect = (s, assetId = s.assets.at(-1).id, outcome = 'passed') => act('manager', s, 'inspect_asset', { asset_id: assetId, outcome, evidence: 'إفادة فحص الحقوق والقنوات والمدة لهذا الأصل المصطنع' });
  const addOutput = (s, assetId = s.assets.at(-1).id, extra = {}) => act('employee', s, 'create_output', { ...outputInput(assetId), ...extra });
  const approve = (s, outputId = s.outputs.at(-1).id) => act('manager', act('employee', s, 'submit_output', { output_id: outputId }), 'approve_output', { output_id: outputId, note: 'اجتازت النسخة فحوص الجودة الداخلية', quality_checks: quality() });
  const ready = () => approve(addOutput(inspect(addAsset(production()))));
  t.after(() => db.close());
  return { db, users, project, make, act, production, addAsset, inspect, addOutput, approve, ready };
}

test('STR-05/06/08/09, CRT-02/08/09: approved brief, two outputs, inspected rights and internal acceptance preserve their source versions', t => {
  const { db, act, production, addAsset, inspect, addOutput, approve } = fixture(t);
  let s = production(); assert.equal(s.status, 'production');
  s = inspect(addAsset(s)); s = approve(addOutput(s));
  s = approve(addOutput(s, s.assets[0].id, { title: 'المخرج النصي الثاني', channel: 'website', dimensions: 'مساحة نص على صفحة اختبار' }));
  const approvedIds = s.outputs.map(o => o.current_version_id);
  s = act('employee', s, 'issue_package', { ...packageInput(s.outputs[0].id), output_ids: s.outputs.map(o => o.id) });
  assert.equal(s.packages[0].snapshot.outputs.length, 2);
  assert.deepEqual(s.packages[0].snapshot.outputs.map(o => o.version_id).sort(), approvedIds.sort());
  assert.equal(s.packages[0].snapshot.assets.length, 1);
  assert.equal(s.packages[0].snapshot.brief_id, s.brief.id);
  assert.equal(s.packages[0].snapshot.internal_only, true);
  s = act('manager', s, 'accept_package', { package_id: s.packages[0].id, note: 'تطابق البيان مع النسخ المحددة', evidence: 'إفادة قبول داخلية مصطنعة لبيان التسليم المحفوظ' });
  assert.equal(s.packages[0].acceptance.accepted_by, 'manager');
  assert.equal(verifyAudit(db), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n, 0);
});

test('STR-08/09: returned briefs need a new version, retain the reason, and cannot be changed after approval', t => {
  const { db, make, act } = fixture(t);
  let s = act('employee', make(), 'submit_brief');
  assert.throws(() => act('employee', s, 'create_output', outputInput('missing')), code('studio_transition'));
  assert.throws(() => act('manager', s, 'return_brief', { note: '' }), code('invalid_text'));
  s = act('manager', s, 'return_brief', { note: 'وضح افتراض الجمهور ومصدر القياس' });
  assert.throws(() => act('employee', s, 'submit_brief'), code('studio_transition'));
  const oldId = s.brief.id;
  s = act('employee', s, 'save_brief', { ...briefInput(), audience_basis: 'افتراض مصطنع موضح في النسخة الثانية' });
  assert.equal(s.brief_versions.length, 2); assert.notEqual(s.brief.id, oldId);
  assert.equal(s.reviews[0].version_id, oldId);
  s = act('manager', act('employee', s, 'submit_brief'), 'approve_brief', { note: 'اعتماد النسخة الثانية من الموجز' });
  assert.throws(() => act('employee', s, 'save_brief', briefInput()), code('studio_transition'));
  assert.throws(() => db.prepare("UPDATE studio_brief_versions SET snapshot='{}' WHERE id=?").run(s.brief.id), /immutable/);
});

test('CRT-04/05/08: output return and quality approval are tied to one immutable version', t => {
  const { db, act, production, addAsset, inspect, addOutput } = fixture(t);
  let s = addOutput(inspect(addAsset(production()))), outputId = s.outputs[0].id;
  s = act('employee', s, 'submit_output', { output_id: outputId });
  const previousVersion = s.outputs[0].current_version_id;
  assert.throws(() => act('manager', s, 'approve_output', { output_id: outputId, note: 'فحص ناقص', quality_checks: { ...quality(), claims: 'failed' } }), code('quality_required'));
  assert.throws(() => act('employee', s, 'save_output', { output_id: outputId, ...outputInput(s.assets[0].id) }), code('studio_transition'));
  s = act('manager', s, 'return_output', { output_id: outputId, note: 'صحح الادعاء في النسخة الأولى' });
  s = act('employee', s, 'save_output', { output_id: outputId, ...outputInput(s.assets[0].id), content: 'محتوى مصحح في النسخة الثانية بعد الإعادة' });
  assert.equal(s.outputs[0].versions.length, 2); assert.equal(s.outputs[0].current_version.revision, 2);
  assert.equal(s.reviews.find(r => r.kind === 'output').version_id, previousVersion);
  s = act('manager', act('employee', s, 'submit_output', { output_id: outputId }), 'approve_output', { output_id: outputId, note: 'اعتماد النسخة المصححة', quality_checks: quality() });
  assert.throws(() => db.prepare("UPDATE studio_output_versions SET snapshot='{}' WHERE id=?").run(s.outputs[0].current_version_id), /immutable/);
  assert.throws(() => db.prepare("UPDATE studio_outputs SET status='draft' WHERE id=?").run(outputId), /immutable/);
  assert.throws(() => db.prepare("UPDATE studio_reviews SET decision='returned' WHERE id=?").run(s.reviews.at(-1).id), /immutable/);
});

test('CRT-07/09, LEG-03, PRO-06: expired, future, short-duration and wrong-channel rights block new manifests', t => {
  const { db, act, production, addAsset, inspect, addOutput, approve } = fixture(t);
  const scenarios = [
    [{ valid_until: '2020-01-02' }, 'asset_expired'], [{ valid_from: '2099-01-01' }, 'asset_expired'],
    [{ valid_until: '2099-06-01' }, 'asset_expired'], [{ channels: ['website'] }, 'asset_channel']
  ];
  for (const [extra, expected] of scenarios) {
    let s = approve(addOutput(inspect(addAsset(production(), extra))));
    assert.throws(() => act('employee', s, 'issue_package', packageInput(s.outputs[0].id)), code(expected));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM studio_packages').get().n, 0);
});

test('CRT-07/08/09: unchecked or failed assets cannot be included, and an unapproved output cannot enter an otherwise valid manifest', t => {
  const { db, act, production, addAsset, inspect, addOutput, approve } = fixture(t);
  let s = approve(addOutput(addAsset(production())));
  assert.throws(() => act('employee', s, 'issue_package', packageInput(s.outputs[0].id)), code('asset_unchecked'));
  s = inspect(s, s.assets[0].id, 'failed');
  assert.throws(() => act('employee', s, 'issue_package', packageInput(s.outputs[0].id)), code('asset_unchecked'));
  let good = approve(addOutput(inspect(addAsset(production()))));
  good = addOutput(good);
  assert.throws(() => act('employee', good, 'issue_package', { ...packageInput(good.outputs[0].id), output_ids: good.outputs.map(o => o.id) }), code('unapproved_output'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM studio_packages').get().n, 0);
});

test('STR-09/CRT-04: only the project creator may appoint an independent alternate reviewer', t => {
  const { db, users, project, make, act } = fixture(t);
  assert.throws(() => make('employee', { reviewer_id: 'pm-studio' }), code('reviewer_assignment'));
  assert.throws(() => make('manager'), code('self_approval'));
  let s = make('manager', { reviewer_id: 'employee' });
  assert.equal(s.reviewer_appointed_by, 'manager'); assert.equal(s.reviewer_role, 'employee');
  s = act('manager', s, 'submit_brief');
  assert.throws(() => act('manager', s, 'approve_brief', { note: 'اعتماد ذاتي' }), code('studio_transition'));
  assert.throws(() => act('pm-studio', s, 'approve_brief', { note: 'مراجع غير معين' }), code('studio_transition'));
  s = act('employee', s, 'approve_brief', { note: 'مراجعة ضمن تعيين صريح' }); assert.equal(s.status, 'production');
  db.prepare("UPDATE users SET role='hr' WHERE id='employee'").run();
  assert.equal(listStudio(db, users.employee).length, 0);
  db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project.id, 'manager');
  assert.equal(listStudio(db, users['pm-studio'])[0].allowed_actions.includes('approve_brief'), false);
});

test('CRT-06: tenant, admin and project membership are checked on all studio reads and actions', t => {
  const { db, users, project, make, act } = fixture(t);
  const s = make();
  for (const id of ['outsider', 'other-manager', 'external', 'admin']) {
    assert.equal(listStudio(db, users[id]).length, 0);
    assert.throws(() => act(id, s, 'submit_brief'), code('not_found'));
  }
  db.prepare('INSERT INTO project_members VALUES(?,?)').run(project.id, 'admin');
  assert.equal(listStudio(db, users.admin).length, 0);
  assert.throws(() => act('admin', s, 'submit_brief'), code('not_found'));
  db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project.id, 'employee');
  assert.equal(listStudio(db, users.employee).length, 0);
  assert.throws(() => act('employee', s, 'submit_brief'), code('not_found'));
});

test('CRT-06/09: asset, output and package IDs cannot be substituted across studio workspaces', t => {
  const { db, act, ready, production, addAsset, inspect, addOutput, approve } = fixture(t);
  let first = ready(), second = ready();
  assert.throws(() => act('employee', first, 'create_output', outputInput(second.assets[0].id)), code('not_found'));
  assert.throws(() => act('employee', first, 'issue_package', packageInput(second.outputs[0].id)), code('not_found'));
  first = act('employee', first, 'issue_package', packageInput(first.outputs[0].id));
  second = act('employee', second, 'issue_package', packageInput(second.outputs[0].id));
  assert.throws(() => act('manager', first, 'accept_package', { package_id: second.packages[0].id, note: 'استبدال معرف', evidence: 'إفادة لحزمة مساحة أخرى غير صحيحة' }), code('not_found'));
  let pending = addOutput(inspect(addAsset(production())));
  pending = act('employee', pending, 'submit_output', { output_id: pending.outputs[0].id });
  assert.throws(() => act('manager', pending, 'approve_output', { output_id: first.outputs[0].id, note: 'معرف خارج المساحة', quality_checks: quality() }), code('not_found'));
  assert.equal(verifyAudit(db), true);
});

test('CRT-05/09: retries cannot duplicate a decision, manifest or acceptance; snapshots survive later output creation', t => {
  const { db, act, ready, addOutput } = fixture(t);
  let s = ready();
  const before = s, input = packageInput(s.outputs[0].id);
  s = act('employee', s, 'issue_package', input);
  assert.throws(() => act('employee', before, 'issue_package', input), code('stale_version'));
  assert.throws(() => act('employee', s, 'issue_package', input), code('duplicate_package'));
  const snapshot = JSON.stringify(s.packages[0].snapshot), pkgId = s.packages[0].id;
  s = addOutput(s, s.assets[0].id, { title: 'مخرج جديد لا يغير الحزمة السابقة' });
  assert.equal(JSON.stringify(s.packages[0].snapshot), snapshot);
  assert.equal(s.packages[0].snapshot.outputs.length, 1);
  s = act('manager', s, 'accept_package', { package_id: pkgId, note: 'قبول البيان الأول', evidence: 'إفادة قبول للبيان الأول ومخرجه الأصلي' });
  assert.throws(() => act('manager', s, 'accept_package', { package_id: pkgId, note: 'تكرار القبول', evidence: 'إفادة قبول مكررة غير مطلوبة' }), code('studio_transition'));
  assert.throws(() => db.prepare("UPDATE studio_packages SET snapshot='{}' WHERE id=?").run(pkgId), /immutable/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM studio_acceptances').get().n, 1);
});

test('STR-06/CRT-02: incomplete briefs, unknown fields, channels and external asset URLs are rejected', t => {
  const { db, users, project, make, act, production, addAsset } = fixture(t);
  for (const change of [{ measurement_source: '' }, { prohibited_messages: '' }, { channels: ['unknown'] }, { channels: ['instagram', 'instagram'] }, { owner_id: 'manager' }]) {
    assert.throws(() => make('employee', change), error => error.status === 400);
  }
  let s = production();
  assert.throws(() => act('employee', s, 'add_asset', assetInput('https://example.test/file')), code('internal_reference'));
  assert.throws(() => act('employee', s, 'add_asset', assetInput('INVALID-DATE', { valid_from: '2099-02-30' })), code('invalid_date'));
  s = addAsset(s);
  assert.throws(() => act('employee', s, 'add_asset', assetInput(s.assets[0].internal_reference)), code('duplicate_asset'));
  assert.throws(() => act('employee', s, 'create_output', { ...outputInput(s.assets[0].id), channel: 'youtube' }), code('brief_channel'));
  assert.throws(() => act('employee', s, 'create_output', { ...outputInput(s.assets[0].id), asset_ids: [] }), code('invalid_list'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM studio_outputs').get().n, 0);
  assert.throws(() => createStudio(db, users.employee, { project_id: project.id, title: 'بدون معاملة', ...briefInput() }), code('transaction_required'));
});

test('CRT-09: audit failure rolls back the issued manifest and the workspace version', t => {
  const { db, act, ready } = fixture(t);
  const s = ready(), count = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  db.exec("CREATE TEMP TRIGGER studio_test_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='issue_package' BEGIN SELECT RAISE(ABORT,'synthetic studio audit failure'); END");
  assert.throws(() => act('employee', s, 'issue_package', packageInput(s.outputs[0].id)), /synthetic studio audit failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM studio_packages').get().n, 0);
  assert.equal(db.prepare('SELECT version FROM studio_workspaces WHERE id=?').get(s.id).version, s.version);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, count);
  assert.equal(verifyAudit(db), true);
});

test('CRT-06: createOnce rechecks membership for a repeated studio creation', t => {
  const { db, users, project } = fixture(t);
  const input = { project_id: project.id, title: 'إنشاء قابل لإعادة المحاولة', ...briefInput() };
  const run = () => transaction(db, () => createOnce(db, users.employee, 'studio.create', 'studio_create_test_0001', input,
    () => createStudio(db, users.employee, input), id => {
      const current = listStudio(db, users.employee).find(s => s.id === id);
      if (!current) throw new Error('membership revoked');
      return current;
    }));
  const first = run(), again = run(); assert.equal(first.id, again.id);
  db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project.id, 'employee');
  assert.throws(run, /membership revoked/);
});

test('CRT-07/09: acceptance rechecks asset expiry across midnight in Riyadh', t => {
  const { act, production, addAsset, inspect, addOutput, approve } = fixture(t);
  const RealDate = globalThis.Date;
  const clock = (iso, run) => {
    const instant = RealDate.parse(iso);
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [instant])); }
      static now() { return instant; }
    };
    try { return run(); } finally { globalThis.Date = RealDate; }
  };
  let s = clock('2026-09-10T12:00:00Z', () => {
    const ready = approve(addOutput(inspect(addAsset(production(), { valid_until: '2026-09-10' }))));
    return act('employee', ready, 'issue_package', { ...packageInput(ready.outputs[0].id), use_from: '2026-09-10', use_until: '2026-09-10' });
  });
  clock('2026-09-10T21:30:00Z', () => {
    assert.throws(() => act('manager', s, 'accept_package', { package_id: s.packages[0].id, note: 'قبول بعد يوم الرياض', evidence: 'إفادة قبول بعد انتهاء الحق في يوم الرياض' }), code('asset_expired'));
  });
});

test('STR-09/CRT-04: membership and current role revoke a designated reviewer before the next decision', t => {
  const { db, users, project, make, act } = fixture(t);
  const s = act('employee', make(), 'submit_brief');
  db.prepare("UPDATE users SET role='pm' WHERE id='manager'").run();
  assert.throws(() => act('manager', s, 'approve_brief', { note: 'دور المراجع تغير' }), code('studio_transition'));
  db.prepare("UPDATE users SET role='manager' WHERE id='manager'").run();
  db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project.id, 'manager');
  assert.equal(listStudio(db, users.manager).length, 0);
  assert.throws(() => act('manager', s, 'approve_brief', { note: 'عضوية المراجع سحبت' }), code('not_found'));
});

test('CRT-05 UI: output forms capture the original target and version without editable identity fields', t => {
  const { users, project, production, addAsset, inspect, addOutput } = fixture(t);
  const s = addOutput(inspect(addAsset(production()))), output = s.outputs[0], version = s.version;
  const data = { rows: [s], projects: [project], user: users.employee };
  const spec = studioUI.form('save_output', `${s.id}:${output.id}`, data);
  assert.equal(spec.fields.some(field => ['version', 'output_id', 'project_id'].includes(field.name)), false);
  const values = Object.fromEntries(spec.fields.map(field => [field.name, String(field.value ?? '')]));
  s.version += 1;
  const payload = spec.toPayload(values);
  assert.equal(payload.version, version); assert.equal(payload.output_id, output.id);
  assert.deepEqual(payload.asset_ids, [s.assets[0].id]);
  assert.equal(payload.content, output.current_version.snapshot.content);
  assert.equal(spec.endpoint, `/studio/${s.id}/save_output`);
});

test('CRT-06/09 UI: unauthorized actions are absent, content is escaped, and an asset reference is never a download link', t => {
  const { db, users, project, ready } = fixture(t);
  const s = ready(); s.outputs[0].current_version.snapshot.content = '<script>untrusted</script>';
  const memberView = listStudio(db, users['pm-studio'])[0];
  memberView.outputs[0].current_version.snapshot.content = '<script>untrusted</script>';
  const e = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const requestedActions = [];
  const html = studioUI.render({ rows: [memberView], projects: [project], user: users['pm-studio'] }, { e, button: (action, id, label) => { requestedActions.push(action); return `<button>${e(label)}</button>`; } });
  assert.equal(html.includes('<script>'), false); assert.equal(html.includes('&lt;script&gt;'), true);
  assert.equal(html.includes('href='), false);
  for (const action of ['approve_brief', 'inspect_asset', 'approve_output', 'issue_package', 'accept_package']) assert.equal(requestedActions.includes(action), false, action);
  assert.throws(() => studioUI.form('approve_output', `${memberView.id}:${memberView.outputs[0].id}`, { rows: [memberView], projects: [project], user: users['pm-studio'] }), /الإجراء غير متاح/);
});
