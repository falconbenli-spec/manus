// ترحيلات تسليمات المجالات المتخصصة (الحزمة 4، الفرع p4/specialist-handoffs): 187 الاستوديو على حملة، و188 الإنتاج على مسار
// المراجعة وفحص التصريح عند الإصدار، و189 ربط المنشور بالنسخة المعتمدة وتفرّد حساب المؤثر في الكيان ونوع «إثبات نشر» في الملفات.
// كل ترحيل يُختبر على قاعدة بُنيت بما قبله وفيها صفوف كتبها الكود القديم: يُطبَّق نظيفًا، ولا يمسّ عمودًا قديمًا في أي صف،
// ولا يكتب حدث تدقيق، والسلامة والمفاتيح الأجنبية نظيفة بعده، والمحفّزات الجديدة قائمة. والقاعدة الجديدة الفارغة تُبنى كاملة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { listStudio } from '../app/studio.mjs';
import { grantAccess } from '../app/access.mjs';
import { productionsBoard } from '../app/production.mjs';
import { createClient } from '../app/agency.mjs';
import { createInfluencer, influencersBoard } from '../app/influencers.mjs';
import { influencersUI } from '../app/static/influencers-ui.mjs';

const PASSWORD = 'synthetic-specialist-handoff-migrations';
const STAMP = '2026-09-01T08:00:00.000Z';
const FILES = readdirSync(new URL('../app/migrations/', import.meta.url)).filter(name => /^\d{3}-.+\.sql$/.test(name)).sort();
const sql = file => readFileSync(new URL('../app/migrations/' + file, import.meta.url), 'utf8');
function applyMigration(raw, version, text) {
  raw.exec('BEGIN');
  try { raw.exec(text); raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version, hash(text)); raw.exec('COMMIT'); }
  catch (error) { raw.exec('ROLLBACK'); throw error; }
}
// قاعدة بكل الترحيلات قبل version، والباقي يُطبَّق بعد كتابة الصفوف القديمة.
function before(t, version) {
  const raw = new DatabaseSync(':memory:'); t.after(() => raw.close());
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema = readFileSync(new URL('../app/schema.sql', import.meta.url), 'utf8');
  raw.exec(schema); raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for (const file of FILES) if (Number(file.slice(0, 3)) < version) applyMigration(raw, Number(file.slice(0, 3)), sql(file));
  return raw;
}
const rest = (raw, from) => { for (const file of FILES) if (Number(file.slice(0, 3)) >= from) applyMigration(raw, Number(file.slice(0, 3)), sql(file)); };
const users = raw => Object.fromEntries(raw.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
const snapshotOf = (raw, table) => {
  const columns = raw.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  return () => raw.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY id`).all().map(r => JSON.stringify(r));
};
const clean = raw => {
  assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok(verifyAudit(raw));
};

test('the specialist hand-off migrations apply cleanly to an empty database, in order with everything after them', () => {
  const db = openDb(':memory:');
  for (const version of [187, 188, 189]) assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version), `migration ${version} is applied`);
  clean(db);
  db.close();
});

test('migration 187 upgrade: free-standing studio jobs written before it keep every column and stay readable, and the campaign link is written once, with the campaign’s own client', t => {
  const raw = before(t, 187);
  assert.equal(raw.prepare("SELECT 1 FROM pragma_table_info('studio_workspaces') WHERE name='campaign_id'").get(), undefined, 'before 187 the studio job knows no campaign');
  seed(raw, PASSWORD);
  const people = users(raw);
  const project = transaction(raw, () => createProject(raw, people.manager, { name: 'مشروع استوديو قبل 187', brief: 'مساحة حرة قديمة', member_ids: ['employee'] })).id;
  // المساحة كما كتبها الكود قبل 187: ثلاثة عشر عمودًا بالموضع، وموجزها بنسخته.
  const snapshot = JSON.stringify({ objective: 'هدف مساحة قديمة', audience: 'جمهور', audience_basis: 'افتراض', message: 'رسالة', prohibited_messages: 'لا شيء', kpi: 'مؤشر', measurement_source: 'مصدر', channels: ['instagram'], scope: 'نطاق' });
  raw.prepare("INSERT INTO studio_workspaces VALUES('old-studio','36t',?,'مساحة حرة قديمة','employee','manager','manager','manager','draft',1,'old-brief',?,?)").run(project, STAMP, STAMP);
  raw.prepare("INSERT INTO studio_brief_versions VALUES('old-brief','old-studio',1,?,?,'employee',?)").run(snapshot, hash(snapshot), STAMP);
  const columns = snapshotOf(raw, 'studio_workspaces'), was = columns(), audits = raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  rest(raw, 187);
  assert.deepEqual(columns(), was, 'not one old column of the old job moved');
  assert.deepEqual({ ...raw.prepare("SELECT client_id,campaign_id FROM studio_workspaces WHERE id='old-studio'").get() }, { client_id: null, campaign_id: null });
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, audits, 'the migration writes no audit event of its own');
  for (const name of ['studio_workspace_campaign_link', 'studio_workspace_campaign_fixed']) assert.ok(raw.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name), name);
  const read = listStudio(raw, people.employee).find(r => r.id === 'old-studio');
  assert.deepEqual([read.title, read.brief.snapshot.objective, read.campaign_name, read.client_name], ['مساحة حرة قديمة', 'هدف مساحة قديمة', null, null], 'the old job reads as it did');
  assert.throws(() => raw.prepare("UPDATE studio_workspaces SET client_id='x',version=version+1 WHERE id='old-studio'").run(), /fixed when it is opened/, 'a free-standing job is not attached to a campaign afterwards');
  clean(raw);
});

test('migration 188 upgrade: productions and call sheets written before it keep every column; an issued sheet stays issued, while a planning production no longer starts and a draft sheet no longer issues without what the shoot needs', t => {
  const raw = before(t, 188);
  assert.equal(raw.prepare("SELECT 1 FROM pragma_table_info('productions') WHERE name='review_route_id'").get(), undefined, 'before 188 the production knows no treatment');
  seed(raw, PASSWORD);
  const people = users(raw);
  const project = transaction(raw, () => createProject(raw, people.manager, { name: 'مشروع إنتاج قبل 188', brief: 'إنتاجات قديمة', member_ids: ['employee'] })).id;
  // الصفوف كما كتبها الكود قبل 188: إنتاج في التحضير وآخر قيد التصوير، وموقع تصريحه قيد الطلب، وورقة صدرت عليه ومسودة بعدها.
  const insert = (id, code, status) => raw.prepare(`INSERT INTO productions(id,tenant_id,code,title,kind,status,producer_id,brief,client_id,campaign_id,project_id,shoot_from,shoot_to,created_at,updated_at)
    VALUES(?,'36t',?,?,'ad',?,'manager','موجز قديم',NULL,NULL,?,'2026-09-02','2026-09-09',?,?)`).run(id, code, `إنتاج قديم ${code}`, status, project, STAMP, STAMP);
  insert('old-plan', 'OLD-PLAN', 'planning'); insert('old-shoot', 'OLD-SHOOT', 'in_production');
  raw.prepare(`INSERT INTO production_locations(id,tenant_id,production_id,name,permit_required,permit_basis,permit_status,recorded_by,created_at,updated_at)
    VALUES('old-loc','36t','old-shoot','شارع قديم',1,'قرر المنتج أن الموقع عام ويحتاج إذنًا','pending','manager',?,?)`).run(STAMP, STAMP);
  const sheet = (id, date, status) => raw.prepare(`INSERT INTO call_sheets(id,tenant_id,production_id,shoot_date,revision,location_id,call_time,day_schedule,nearest_hospital,emergency_contact_name,emergency_contact_phone,status,prepared_by,issued_by,issued_at,created_at,updated_at)
    VALUES(?,'36t','old-shoot',?,1,'old-loc','06:30','[{"time":"06:30","activity":"تجمع","note":""}]','مستشفى قديم','منسق سلامة قديم','0555000111',?,'manager',?,?,?,?)`)
    .run(id, date, status, status === 'issued' ? 'hr' : null, status === 'issued' ? STAMP : null, STAMP, STAMP);
  sheet('old-issued', '2026-09-03', 'issued'); sheet('old-draft', '2026-09-04', 'draft');
  const productionColumns = snapshotOf(raw, 'productions'), sheetColumns = snapshotOf(raw, 'call_sheets');
  const was = [productionColumns(), sheetColumns()], audits = raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  rest(raw, 188);
  assert.deepEqual([productionColumns(), sheetColumns()], was, 'not one old column of any production or call sheet moved');
  assert.deepEqual(raw.prepare('SELECT review_route_id,output_version_id FROM productions ORDER BY id').all().map(r => [r.review_route_id, r.output_version_id]), [[null, null], [null, null]]);
  assert.equal(raw.prepare("SELECT status FROM call_sheets WHERE id='old-issued'").get().status, 'issued', 'a sheet issued before 188 stays issued: the guard reads the transition, not the history');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, audits, 'the migration writes no audit event of its own');
  for (const name of ['productions_treatment_link', 'productions_treatment_fixed', 'productions_start_ready', 'call_sheets_issue_permit'])
    assert.ok(raw.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name), name);
  assert.throws(() => raw.prepare("UPDATE productions SET status='in_production',version=version+1 WHERE id='old-plan'").run(), /approved treatment and an approved project budget/);
  assert.throws(() => raw.prepare("UPDATE call_sheets SET status='issued',issued_by='hr',issued_at=?,version=version+1 WHERE id='old-draft'").run(STAMP), /required permit is obtained/);
  raw.prepare("UPDATE productions SET status='wrapped',wrap_note='انتهى التصوير القديم وسُلّمت المواد',version=version+1 WHERE id='old-shoot'").run();
  transaction(raw, () => grantAccess(raw, people.admin, { user_id: 'manager', capability: 'production.manage', department_id: '', note: 'منح تجريبي لقراءة الإنتاجات القديمة' }));
  const old = productionsBoard(raw, users(raw).manager).productions.find(p => p.id === 'old-plan');
  assert.deepEqual([old.treatment, old.readiness.missing.map(m => m.doc_key), old.actions.includes('start_production')], [null, ['treatment', 'budget'], false], 'an old planning production reads what it still needs');
  clean(raw);
});

test('migration 189 upgrade: a calendar item published on a typed reference stays as written, a handle already on two influencer files is kept and listed for a decision while a third is refused, and the proof screenshot becomes a registered file type', t => {
  const raw = before(t, 189);
  assert.equal(raw.prepare("SELECT 1 FROM pragma_table_info('content_items') WHERE name='output_version_id'").get(), undefined, 'before 189 the calendar item carries text only');
  seed(raw, PASSWORD);
  let people = users(raw);
  const client = transaction(raw, () => createClient(raw, people.manager, { legal_name: 'شركة قديمة تجريبية', trade_name: 'القديمة التجريبية', sector: 'تجزئة', status: 'active' })).id;
  // بند نُشر قبل 189 بمرجعه النصي، كما كتبه الكود القديم.
  raw.prepare(`INSERT INTO content_items(id,tenant_id,client_id,channel,format,title,planned_date,status,owner_id,draft_reference,internal_reviewer,client_approval_reference,client_approval_recorded_by,published_reference,published_at,created_at,updated_at)
    VALUES('old-post','36t',?,'instagram','post','منشور قديم تجريبي','2026-09-02','published','employee','ملف التصميم القديم في المجلد','manager','موافقة بالبريد محفوظة','employee','https://example.invalid/old/1',?,?,?)`).run(client, STAMP, STAMP, STAMP);
  transaction(raw, () => grantAccess(raw, people.admin, { user_id: 'employee', capability: 'influencers.manage', department_id: '', note: 'منح تجريبي لملفات المؤثرين القديمة' }));
  people = users(raw);
  const make = stage => transaction(raw, () => createInfluencer(raw, people.employee, { stage_name: stage, category: 'food', contact_mode: 'direct', agency_name: '', contact_name: 'جهة تواصل قديمة', contact_channel: 'old@example.invalid', notes: '' })).id;
  const [a, b, c] = ['مؤثر قديم أ', 'مؤثر قديم ب', 'مؤثر قديم ج'].map(make);
  // الزوج كما سمح به التفرّد داخل الملف (060): الحساب نفسه بحالة أحرف مختلفة على ملفين.
  const account = (id, influencer, handle) => raw.prepare("INSERT INTO influencer_accounts(id,influencer_id,platform,handle,profile_url,added_by,created_at) VALUES(?,?,'instagram',?,'','employee',?)").run(id, influencer, handle, STAMP);
  account('acc-a', a, '@Creator.Dup'); account('acc-b', b, 'creator.dup');
  const contentColumns = snapshotOf(raw, 'content_items'), accountColumns = snapshotOf(raw, 'influencer_accounts');
  const was = [contentColumns(), accountColumns()], audits = raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  rest(raw, 189);
  assert.deepEqual([contentColumns(), accountColumns()], was, 'not one old column of the published item or of either account moved, and nothing was deleted');
  assert.deepEqual({ ...raw.prepare("SELECT output_version_id,output_digest,client_approval_id,status FROM content_items WHERE id='old-post'").get() },
    { output_version_id: null, output_digest: null, client_approval_id: null, status: 'published' }, 'the old post stays published on its typed reference');
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, audits, 'the migration writes no audit event of its own');
  assert.ok(raw.prepare("SELECT 1 FROM stored_file_entity_types WHERE entity_type='influencer_proof' AND added_in=189").get(), 'the proof screenshot is a registered file type');
  for (const name of ['content_items_version_digest_insert', 'content_items_version_digest_update', 'content_items_client_approval_insert', 'content_items_client_approval_update',
    'influencer_content_version_digest_insert', 'influencer_content_version_digest_update', 'influencer_accounts_one_file_per_handle', 'influencer_accounts_one_file_on_return'])
    assert.ok(raw.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name), name);
  const board = influencersBoard(raw, users(raw).employee);
  assert.deepEqual(board.duplicate_accounts.map(d => [d.platform, d.files.map(f => f.id).sort()]), [['instagram', [a, b].sort()]], 'the pair recorded before 189 is listed for a decision');
  assert.equal(board.alerts.duplicate_accounts, 1);
  assert.throws(() => account('acc-c', c, 'CREATOR.DUP'), /one influencer file in its tenant/, 'a third file does not join the pair');
  const e = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const html = influencersUI.render(board, { e, button: (action, id, label) => `<button>${e(label)}</button>` });
  assert.match(html, /حساب واحد على أكثر من ملف/);
  assert.match(html, /عطّل الحساب من الملف الخطأ/);
  clean(raw);
});

