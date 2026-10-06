// الترحيلات 184 و185 و186 (الحزمة 4: الدعم بعد البيع، وسلسلة التجديد، وإنهاء العلاقة): تُطبَّق من الصفر، وعلى قاعدة أقدم فيها
// بيانات، دون أن يسقط صفّ أو يتغيّر، والمفاتيح الأجنبية نظيفة، وسلسلة التدقيق سليمة. كل الأسماء والأرقام مصطنعة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openDb, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { migrateTo } from './crm-rebuild-fixture.mjs';

const STAMP = '2026-09-20T09:00:00.000Z';
// قاعدة عند 181 (قبل الثلاثة) فيها عميل وصفقة متعاقد عليها وسجلا عقد: لعميل، ولجهة أخرى.
function buildAt181(t) {
  const dir = mkdtempSync(join(tmpdir(), '36t-migration-184-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'pre184.sqlite');
  const db = new DatabaseSync(path);
  migrateTo(db, 181);
  seed(db, 'synthetic-migration-184');
  const run = (sql, ...values) => db.prepare(sql).run(...values);
  db.exec('BEGIN IMMEDIATE');
  run("INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at,registration_number) VALUES('syn-client','36t','C-1840','عميل تجريبي للترحيل 184','','تجريبي','active','outsider','',?,?,'SYN-1840')", STAMP, STAMP);
  run("INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,created_at,updated_at,client_id) VALUES('syn-deal','36t','creative','employee','عميل تجريبي للترحيل 184','SYN-1840','جهة تجريبية','مصدر تجريبي','تجريبي','contracted',?,?,'syn-client')", STAMP, STAMP);
  run("INSERT INTO client_links VALUES('syn-client','syn-deal','outsider',?)", STAMP);
  const contract = (id, number, kind, client, party) => run(`INSERT INTO contract_records(id,tenant_id,number,party_kind,client_id,party_name,contract_type,subject,start_date,end_date,value_minor,auto_renew,owner_id,original_location,signed_on,status,activated_by,activated_at,created_by,created_at,updated_at)
    VALUES(?,'36t',?,?,?,?,'statement_of_work','موضوع عقد تجريبي للترحيل','2026-01-01','2026-12-31',8000000,0,'outsider','أرشيف تجريبي للترحيل 184','2025-12-20','active','outsider',?,'hr',?,?)`, id, number, kind, client, party, STAMP, STAMP, STAMP);
  contract('syn-contract-client', 'CT-1840', 'client', 'syn-client', '');
  contract('syn-contract-other', 'CT-1841', 'other', null, 'جهة تجريبية أخرى');
  // فرصة قائمة وجدولة فوترة بلا نهاية: يحكمهما الجديد من اليوم، ولا يُعاد كتابتهما.
  run("INSERT INTO opportunities(id,tenant_id,client_id,name,service_family,value_minor,stage_code,owner_id,status,last_activity_on,created_at,updated_at) VALUES('syn-opp','36t','syn-client','فرصة تجريبية قبل 185','campaigns',500000,'LEAD','employee','open','2026-09-20',?,?)", STAMP, STAMP);
  run("INSERT INTO billing_schedules(id,tenant_id,client_id,title,cadence,issue_day,lines,currency,total_minor,contract_reference,start_date,status,owner_id,created_by,created_at,updated_at) VALUES('syn-schedule','36t','syn-client','جدولة تجريبية قبل 185','monthly',5,'[{\"description\":\"بند تجريبي\",\"amount_minor\":100000}]','SAR',100000,'عقد تجريبي رقم 1840','2026-01-01','active','manager','manager',?,?)", STAMP, STAMP);
  db.exec('COMMIT');
  const snapshot = table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(r => ({ ...r }));
  const before = snapshot('contract_records'), tables = Object.fromEntries(['clients', 'opportunities', 'billing_schedules', 'commercial_cases'].map(t => [t, snapshot(t)]));
  db.close();
  return { path, before, tables };
}

test('migration 184: applies from empty — the support tables, the contract’s deal and support terms, and their guards', t => {
  const db = openDb(':memory:'); t.after(() => db.close());
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=184').get());
  const columns = db.prepare('PRAGMA table_info(contract_records)').all().map(c => c.name);
  for (const name of ['case_id', 'support_response_hours', 'warranty_days']) assert.ok(columns.includes(name), name);
  for (const name of ['client_support_cases', 'client_support_events']) assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name), name);
  for (const name of ['contract_records_support_terms_fixed', 'client_support_cases_versioned', 'client_support_cases_same_client', 'client_support_events_append_only'])
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?").get(name), name);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('migration 184: on a database at 181 every contract keeps every value, the new columns start empty, and nothing dangles', t => {
  const { path, before } = buildAt181(t);
  const db = openDb(path); t.after(() => db.close());
  const after = db.prepare('SELECT * FROM contract_records ORDER BY id').all();
  assert.equal(after.length, before.length);
  for (const [i, row] of after.entries()) {
    for (const [key, value] of Object.entries(before[i])) assert.deepEqual(row[key], value, `${row.id}.${key}`);
    assert.deepEqual([row.case_id, row.support_response_hours, row.warranty_days], [null, null, null]);
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  // العقد الساري لا يأخذ صفقة ولا بند دعم بعد سريانه؛ والجهة الأخرى لا تأخذ صفقة عميل.
  assert.throws(() => db.prepare("UPDATE contract_records SET case_id='syn-deal',version=version+1 WHERE id='syn-contract-client'").run(), /support terms/);
  assert.throws(() => db.prepare("UPDATE contract_records SET support_response_hours=4,version=version+1 WHERE id='syn-contract-client'").run(), /support terms/);
  assert.equal(verifyAudit(db), true);
});

test('migration 185: applies from empty — the renewal columns, the reminder record and the schedule’s contract, with their guards', t => {
  const db = openDb(':memory:'); t.after(() => db.close());
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=185').get());
  const has = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
  for (const [table, column] of [['opportunities', 'kind'], ['opportunities', 'renews_contract_id'], ['opportunities', 'renewal_basis'], ['contract_records', 'renews_id'], ['billing_schedules', 'contract_id']])
    assert.ok(has(table, column), `${table}.${column}`);
  for (const name of ['opportunities_renewal_shape', 'opportunities_renewal_fixed', 'contract_records_renews_same_client', 'contract_records_renews_fixed', 'billing_schedules_within_contract', 'contract_renewal_reminders_fixed'])
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?").get(name), name);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('migration 185: on a database at 181 the opportunity stays «new», the schedule keeps its open end, and both still move under their old rules', t => {
  const { path, tables } = buildAt181(t);
  const db = openDb(path); t.after(() => db.close());
  for (const [table, rows] of Object.entries(tables)) {
    const after = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    assert.equal(after.length, rows.length, table);
    for (const [i, row] of rows.entries()) for (const [key, value] of Object.entries(row)) assert.deepEqual(after[i][key], value, `${table}.${row.id}.${key}`);
  }
  const opp = db.prepare("SELECT kind,renews_contract_id,renewal_basis FROM opportunities WHERE id='syn-opp'").get();
  assert.deepEqual({ ...opp }, { kind: 'new', renews_contract_id: null, renewal_basis: '{}' });
  assert.equal(db.prepare("SELECT contract_id FROM billing_schedules WHERE id='syn-schedule'").get().contract_id, null);
  // القديم يتحرك بقواعده: تعديل الفرصة بنسختها، وإيقاف الجدولة.
  db.prepare("UPDATE opportunities SET name='فرصة تجريبية بعد 185',version=version+1 WHERE id='syn-opp'").run();
  db.prepare("UPDATE billing_schedules SET status='paused',version=version+1 WHERE id='syn-schedule'").run();
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(verifyAudit(db), true);
});

// قاعدة عند 181 فيها عميل أُقفل بتغيير الحالة قبل 186 (بلا سجل خلفه)، وما زالت له جدولة فوترة نشطة وصفقة بمخرج مقبول لم يُطالب به:
// بعد الترحيل يبقى مقفلًا كما هو، ويقف عليه كل جديد — المسودة الدورية والاستحقاق — برفض مسمّى، ورجوعه بسجل إعادة فتح كغيره.
function buildClosedAt181(t) {
  const dir = mkdtempSync(join(tmpdir(), '36t-migration-186-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'pre186.sqlite');
  const db = new DatabaseSync(path);
  migrateTo(db, 181);
  seed(db, 'synthetic-migration-186');
  const run = (sql, ...values) => db.prepare(sql).run(...values);
  const json = value => JSON.stringify(value);
  const LINE = { description: 'مخرج تجريبي مقبول', quantity: '1', unit_price_minor: '100000', unit_cost_minor: '40000', discount_minor: '0', tax_basis_points: '1500', net_minor: '100000', tax_minor: '15000', total_minor: '115000', cost_minor: '40000', acceptance: 'قبول تجريبي بدليل مكتوب', revisions: 1 };
  const snapshot = { scope: 'نطاق تجريبي قبل 186', currency: 'SAR', valid_until: '2099-12-01', lines: [LINE], net_minor: '100000', tax_minor: '15000', total_minor: '115000', cost_minor: '40000', margin_minor: '60000', rounding: 'per-line-half-up' };
  db.exec('BEGIN IMMEDIATE');
  run("INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at,registration_number) VALUES('syn-closed','36t','C-1860','عميل تجريبي مقفل قبل 186','','تجريبي','closed','outsider','',?,?,'SYN-1860')", STAMP, STAMP);
  run("INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES('syn-project','36t','مشروع تجريبي قبل 186','موجز تجريبي','manager',?)", STAMP);
  run("INSERT INTO project_members VALUES('syn-project','manager'),('syn-project','employee')");
  run("INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,project_id,created_at,updated_at,client_id) VALUES('syn-deal','36t','creative','employee','عميل تجريبي مقفل قبل 186','SYN-1860','جهة تجريبية','مصدر تجريبي','تجريبي','project_active','syn-project',?,?,'syn-closed')", STAMP, STAMP);
  run("INSERT INTO client_links VALUES('syn-closed','syn-deal','outsider',?)", STAMP);
  run('INSERT INTO commercial_qualifications VALUES(?,?,1,?,?,?)', 'syn-q', 'syn-deal', json({ need: 'احتياج تجريبي', budget_minor: '100000', currency: 'SAR', timing: '2099-12-01', decision_maker: 'صاحب قرار تجريبي', service_fit: 'ملاءمة تجريبية' }), 'employee', STAMP);
  run('INSERT INTO commercial_quotes VALUES(?,?,?,1,?,?,?,?)', 'syn-quote', 'syn-deal', 'syn-q', json(snapshot), 'syn-digest', 'employee', STAMP);
  for (const [kind, subject] of [['qualification', 'syn-q'], ['quote', 'syn-quote']]) {
    run('INSERT INTO commercial_reviews(id,case_id,kind,subject_id,requested_by,approver_id,requested_at) VALUES(?,?,?,?,?,?,?)', `${subject}-review`, 'syn-deal', kind, subject, 'employee', 'manager', STAMP);
    run("UPDATE commercial_reviews SET status='approved',note='اعتماد تجريبي',decided_at=? WHERE id=?", STAMP, `${subject}-review`);
  }
  run("UPDATE commercial_cases SET current_qualification_id='syn-q',current_quote_id='syn-quote',version=version+1 WHERE id='syn-deal'");
  run('INSERT INTO commercial_contracts VALUES(?,?,?,?,?,?,?,?)', 'syn-contract', 'syn-deal', 'syn-quote', json({ ...snapshot, quote_id: 'syn-quote', quote_revision: 1, client_name: 'عميل تجريبي مقفل قبل 186', registration_number: 'SYN-1860', internal_only: true }), 'محضر اتفاق تجريبي محفوظ', 'ممثل عميل تجريبي', 'employee', STAMP);
  run('INSERT INTO commercial_deliveries VALUES(?,?,?,0,1,?,?,?)', 'syn-delivery', 'syn-deal', 'syn-contract', 'دليل مخرج تجريبي مكتوب', 'employee', STAMP);
  run('INSERT INTO commercial_reviews(id,case_id,kind,subject_id,requested_by,approver_id,requested_at) VALUES(?,?,?,?,?,?,?)', 'syn-delivery-review', 'syn-deal', 'delivery', 'syn-delivery', 'employee', 'manager', STAMP);
  run("UPDATE commercial_reviews SET status='approved',note='قبول تجريبي',evidence_json=?,decided_at=? WHERE id='syn-delivery-review'", json({ acceptance_evidence: 'محضر قبول تجريبي', customer_representative: 'ممثل عميل تجريبي', internal_only: true }), STAMP);
  run("INSERT INTO billing_schedules(id,tenant_id,client_id,title,cadence,issue_day,lines,currency,total_minor,contract_reference,start_date,status,owner_id,created_by,created_at,updated_at) VALUES('syn-closed-schedule','36t','syn-closed','جدولة تجريبية لعميل مقفل','monthly',1,'[{\"description\":\"بند تجريبي\",\"amount_minor\":100000}]','SAR',100000,'عقد تجريبي رقم 1860','2026-01-01','active','manager','manager',?,?)", STAMP, STAMP);
  for (const action of ['read', 'prepare']) run("INSERT INTO finance_grants VALUES(?,'36t','employee','employee',?,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض تجريبي للترحيل 186',NULL,?)", `syn-grant-${action}`, action, STAMP);
  // مالك الجدولة يحمل تصريحها، فما يوقفها إلا إقفال عميلها.
  run("INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES('syn-billing-grant','36t','manager','billing.recurring.manage',NULL,'منح تجريبي للترحيل 186','admin',?)", STAMP);
  db.exec('COMMIT');
  db.close();
  return path;
}

test('migration 186: applies from empty — the offboarding record and the client’s link to it, with the guards that close and reopen only through it', t => {
  const db = openDb(':memory:'); t.after(() => db.close());
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=186').get());
  assert.ok(db.prepare('PRAGMA table_info(clients)').all().some(c => c.name === 'offboarding_id'));
  for (const name of ['client_offboardings_kind_matches', 'client_offboardings_versioned', 'clients_not_born_closed', 'clients_closed_through_record', 'clients_reopened_through_record', 'clients_offboarding_link'])
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?").get(name), name);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('migration 186: a client closed before it stays closed with no record behind it; its schedule stops and its unbilled delivery is refused by name, and it reopens only through a record', async t => {
  const path = buildClosedAt181(t);
  const db = openDb(path); t.after(() => db.close());
  assert.deepEqual({ ...db.prepare("SELECT status,offboarding_id FROM clients WHERE id='syn-closed'").get() }, { status: 'closed', offboarding_id: null });
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const { transaction } = await import('../app/db.mjs');
  const billing = await import('../app/billing-recurring.mjs');
  const receivables = await import('../app/receivables.mjs');
  const offboarding = await import('../app/client-offboarding.mjs');
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const run = billing.runDueSchedules(db, '2026-03-05');
  assert.ok(run.some(r => r.schedule_id === 'syn-closed-schedule' && r.outcome === 'stopped' && /مقفل/.test(r.detail)), JSON.stringify(run));
  assert.equal(db.prepare("SELECT status FROM billing_schedules WHERE id='syn-closed-schedule'").get().status, 'paused');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM billing_drafts WHERE schedule_id='syn-closed-schedule'").get().n, 0, 'no invoice draft for a closed client');
  const refused = (() => { try { transaction(db, () => receivables.createClaim(db, users.employee, { delivery_id: 'syn-delivery', amount: '1150.00', due_date: '2099-12-15', entitlement_evidence: 'محضر القبول التجريبي وبند العقد' })); } catch (error) { return error; } })();
  assert.equal(refused?.code, 'client_closed');
  assert.throws(() => db.prepare("UPDATE clients SET status='active',version=version+1 WHERE id='syn-closed'").run(), /reopened only through/);
  const reopen = transaction(db, () => offboarding.requestOffboarding(db, users.outsider, 'syn-closed', { kind: 'reopen', reason: 'رجوع تجريبي لعميل أُقفل قبل الترحيل 186', approver_id: 'manager' })).id;
  transaction(db, () => offboarding.offboardingAction(db, users.manager, reopen, 'approve_offboarding', { version: 1, note: 'رجوع العميل موثّق بطلبه المكتوب' }));
  assert.deepEqual({ ...db.prepare("SELECT status,offboarding_id FROM clients WHERE id='syn-closed'").get() }, { status: 'active', offboarding_id: reopen });
  assert.equal(verifyAudit(db), true);
});
