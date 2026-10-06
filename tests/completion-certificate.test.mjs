// شهادة الإنجاز سجلًّا (الترحيلان 116 و164): ما يثبته هذا الملف ولا تثبته دورة التسليم وحدها —
// الترقيم تحت التزامن، وثبات الصادر في SQL، والتصحيح بنسخة والعكس بسبب، وقبول العميل دليلًا خارجيًا بحدّه المكتوب،
// وألا يُدّعى توقيع، وفصل المهام والصلاحيات، والمسارات السالبة، والإعادة بمفتاح التكرار، وسلسلة التدقيق، وعزل الكيانات،
// والترقية فوق قاعدة كُتبت فيها شهادات قبل 164. البيانات مصطنعة كلها.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { passwordHash } from '../app/auth.mjs';
import { grantAccess } from '../app/access.mjs';
import { createLead, commercialAction, listCommercial } from '../app/commercial.mjs';
import { registerApprover, revokeApprover } from '../app/client-approvals.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { dealFor, boundQuote } from './proposal-fixture.mjs';
import * as certificates from '../app/completion-certificates.mjs';
import * as axes from '../app/project-axes.mjs';
import { createApp } from '../app/server.mjs';
import { commercialUI } from '../app/static/commercial-ui.mjs';
import { dispatch } from './definitions-fixture.mjs';
import { handOverProject } from './handover-fixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'tests/completion-certificate-worker.mjs');
const PASSWORD = 'synthetic-completion-certificate';
const code = value => error => error.code === value;
const riyadh = (days = 0) => new Date(Date.now() + 3 * 3600000 + days * 86400000).toISOString().slice(0, 10);
const tx = (db, run) => transaction(db, run);
const caught = run => { try { run(); } catch (error) { return error; } throw new Error('لم يُرفض ما كان يجب رفضه'); };

// الشخصيات فوق البذرة: مدير مشروع في الإدارة المالكة، وثلاثة في الكيان المعزول ليُبنى فيه مشروع كامل بترقيمه.
function world(db, hashValue = 'unused-test-hash') {
  const insert = db.prepare('INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES(?,?,?,?,?,?,?,?)');
  for (const [uid, tenant, department, name, role, manager] of [
    ['pm', '36t', 'creative', 'مدير مشروع مصطنع', 'pm', 'manager'],
    ['iso-manager', 'isolated', 'other', 'مدير الكيان المعزول', 'manager', null],
    ['iso-owner', 'isolated', 'other', 'مسؤولة ملف الكيان المعزول', 'employee', 'iso-manager'],
    ['iso-pm', 'isolated', 'other', 'مدير مشروع الكيان المعزول', 'pm', 'iso-manager']
  ]) insert.run(uid, tenant, department, uid, name, hashValue, role, manager);
  return Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
}
function fresh(t, hashValue) {
  const db = openDb(':memory:');
  seed(db, PASSWORD);
  t.after(() => db.close());
  return { db, users: world(db, hashValue) };
}

const LINES = [
  { description: 'دليل الهوية المصطنع', quantity: '1', unit_price: '500.00', unit_cost: '100.00', discount: '0', tax_rate: '15', acceptance: 'اعتماد الدليل بعناصره الثلاثة', revisions: 1 },
  { description: 'فيلم تعريفي مصطنع', quantity: '1', unit_price: '700.00', unit_cost: '200.00', discount: '0', tax_rate: '15', acceptance: 'اعتماد النسخة النهائية من الفيلم', revisions: 1 }
];
// ملف تجاري حتى مشروع مفتوح بالطريق الحقيقي كله: مسؤول الملف يقدّم، ومديره المباشر يعتمد ويقبل المخرجات، ومدير المشروع عضو.
function project(db, users, { registration, owner = 'employee', manager = 'manager', pm = 'pm' }) {
  const act = (who, c, action, input = {}) => tx(db, () => commercialAction(db, users[who], c.id, action, { version: c.version, ...input }));
  let c = tx(db, () => dealFor(db, users[owner], { name: `عميل شهادة مصطنع ${registration}`, registration_number: registration, contact: 'ممثل مصطنع', source: 'اختبار الشهادة', sector: 'تجريبي' }));
  c = act(owner, c, 'qualify', { need: 'مخرجان مصطنعان لاختبار الشهادة', budget: '1200.00', currency: 'SAR', timing: '2099-12-01', decision_maker: 'ممثل القرار المصطنع', service_fit: 'ضمن خدمات التجربة' });
  c = act(manager, c, 'approve_qualification', { note: 'التأهيل المصطنع مراجع' });
  c = act(owner, c, 'save_quote', boundQuote(db, c.id, { scope: 'مخرجان مصطنعان بمعياري قبول', currency: 'SAR', valid_until: '2099-12-01', lines: LINES }));
  c = act(owner, c, 'submit_quote');
  c = act(manager, c, 'approve_quote', { note: 'العرض والنطاق مراجعان' });
  c = act(owner, c, 'register_contract', { agreement_evidence: 'محضر اتفاق مصطنع محفوظ في ملف التجربة', customer_representative: 'ممثل العميل المصطنع' });
  c = act(manager, c, 'create_project', { member_ids: [pm] });
  const deliver = index => {
    c = act(owner, c, 'submit_delivery', { line_index: index, evidence: `تقرير إنجاز البند ${index + 1} المصطنع` });
    const delivery = c.deliveries.find(d => d.line_index === index && d.review?.status === 'pending');
    c = act(manager, c, 'accept_delivery', { delivery_id: delivery.id, note: 'مطابق لمعيار القبول', acceptance_evidence: `محضر قبول البند ${index + 1} المصطنع`, approver_id: approver() });
  };
  const register = overrides => tx(db, () => registerApprover(db, users[pm], { project_id: c.project_id, name: 'مفوضة قبول مصطنعة', title: 'مديرة المشاريع لدى العميل',
    authority_basis: 'البند 9 من العقد المصطنع يسميها مفوضة بقبول الإنجاز', authority_scope: 'قبول المخرجات وشهادة الإنجاز', valid_from: '2026-01-01', ...overrides })).id;
  // ممثل العميل الواحد في سجل المشروع (الترحيل 182): يُسمّى في قبول المخرجات وفي الشهادة. بلا تعديل يعود هو نفسه، وبتعديل يُسجَّل ممثل آخر.
  let representative = null;
  const approver = (overrides = {}) => Object.keys(overrides).length ? register(overrides) : (representative ??= register({}));
  return { project_id: c.project_id, case_id: c.id, deliver, acceptAll: () => { deliver(0); deliver(1); }, approver };
}
// صفقة ومشروعها ومخرجاها مقبولان بصفوف SQL كما كتبها الكود قبل الترحيل 164: الكود الحالي يحفظ العرض على عرض سعر العميل (الترحيل 182)
// ويسمّي ممثل العميل من سجله، وجداول ذلك لا توجد على مخطط ما قبل 164. الأرقام نفسها التي يحسبها quoteSnapshot لبندَي LINES.
function legacyProject(db, users, registration, { owner = 'employee', manager = 'manager', pm = 'pm' } = {}) {
  const t = '2026-09-20T09:00:00.000Z', id = () => randomUUID(), ids = { case: id(), qualification: id(), quote: id(), contract: id(), project: id() };
  const lines = [['دليل الهوية المصطنع', '50000', '7500', '57500', '10000', 'اعتماد الدليل بعناصره الثلاثة'], ['فيلم تعريفي مصطنع', '70000', '10500', '80500', '20000', 'اعتماد النسخة النهائية من الفيلم']]
    .map(([description, net, tax, total, cost, acceptance]) => ({ description, quantity: '1', unit_price_minor: net, unit_cost_minor: cost, discount_minor: '0', tax_basis_points: '1500',
      net_minor: net, tax_minor: tax, total_minor: total, cost_minor: cost, acceptance, revisions: 1 }));
  const quote = JSON.stringify({ scope: 'مخرجان مصطنعان بمعياري قبول', currency: 'SAR', valid_until: '2099-12-01', lines, net_minor: '120000', tax_minor: '18000', total_minor: '138000', cost_minor: '30000', margin_minor: '90000', rounding: 'per-line-half-up' });
  const contract = JSON.stringify({ ...JSON.parse(quote), quote_id: ids.quote, quote_revision: 1, quote_digest: 'legacy', client_name: `عميل شهادة مصطنع ${registration}`, registration_number: registration, internal_only: true });
  db.prepare('INSERT INTO projects(id,tenant_id,name,brief,created_by,created_at) VALUES(?,?,?,?,?,?)').run(ids.project, '36t', `عميل شهادة مصطنع ${registration}`, 'مخرجان مصطنعان بمعياري قبول', manager, t);
  for (const member of [manager, owner, pm]) db.prepare('INSERT INTO project_members VALUES(?,?)').run(ids.project, member);
  db.prepare("INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,version,current_qualification_id,current_quote_id,project_id,created_at,updated_at) VALUES(?,'36t','creative',?,?,?,'ممثل مصطنع','اختبار الشهادة','تجريبي','project_active',9,?,?,?,?,?)")
    .run(ids.case, owner, `عميل شهادة مصطنع ${registration}`, registration, ids.qualification, ids.quote, ids.project, t, t);
  db.prepare('INSERT INTO commercial_qualifications VALUES(?,?,1,?,?,?)').run(ids.qualification, ids.case, JSON.stringify({ need: 'مخرجان مصطنعان', budget_minor: '120000', currency: 'SAR' }), owner, t);
  db.prepare('INSERT INTO commercial_quotes VALUES(?,?,?,1,?,?,?,?)').run(ids.quote, ids.case, ids.qualification, quote, 'legacy', owner, t);
  db.prepare('INSERT INTO commercial_contracts VALUES(?,?,?,?,?,?,?,?)').run(ids.contract, ids.case, ids.quote, contract, 'محضر اتفاق مصطنع محفوظ في ملف التجربة', 'ممثل العميل المصطنع', owner, t);
  db.prepare('INSERT INTO commercial_project_baselines VALUES(?,?,?,?,?,?)').run(ids.project, ids.case, ids.contract, ids.quote, contract, t);
  [0, 1].forEach(index => {
    const delivery = id(), review = id();
    db.prepare('INSERT INTO commercial_deliveries VALUES(?,?,?,?,1,?,?,?)').run(delivery, ids.case, ids.contract, index, `تقرير إنجاز البند ${index + 1} المصطنع`, owner, t);
    db.prepare("INSERT INTO commercial_reviews(id,case_id,kind,subject_id,requested_by,approver_id,requested_at) VALUES(?,?,'delivery',?,?,?,?)").run(review, ids.case, delivery, owner, manager, t);
    db.prepare("UPDATE commercial_reviews SET status='approved',note='مطابق لمعيار القبول',evidence_json=?,decided_at=? WHERE id=?")
      .run(JSON.stringify({ acceptance_evidence: `محضر قبول البند ${index + 1} المصطنع`, customer_representative: 'ممثل العميل المصطنع', internal_only: true }), t, review);
  });
  return { project_id: ids.project, case_id: ids.case };
}
const issue = (db, who, projectId, approverId, input = {}) => tx(db, () => certificates.issueCompletionCertificate(db, who, projectId, {
  scope_summary: 'أُنجز المخرجان المصطنعان كما في بنود الاتفاق المصطنع', approver_id: approverId, evidence: 'تقرير إنجاز المشروع المصطنع DC-CR-9', ...input }));
const accept = (db, who, certificate, input = {}) => tx(db, () => certificates.acknowledgeCompletionCertificate(db, who, certificate.id, {
  version: certificate.version, channel: 'email', received_on: riyadh(), evidence: 'رسالة بريد مصطنعة من مفوضة العميل تقبل الشهادة', ...input }));
const correct = (db, who, certificate, approverId, input = {}) => tx(db, () => certificates.correctCompletionCertificate(db, who, certificate.id, {
  version: certificate.version, reason: 'ملخص الإنجاز أغفل النسخة النهائية من الفيلم التعريفي', scope_summary: 'أُنجز المخرجان المصطنعان، والفيلم بنسخته النهائية',
  approver_id: approverId, evidence: 'تقرير إنجاز المشروع المصطنع DC-CR-9', ...input }));
const reverse = (db, who, certificate, input = {}) => tx(db, () => certificates.reverseCompletionCertificate(db, who, certificate.id, {
  version: certificate.version, reason: 'اعترض العميل على اكتمال الفيلم بعد إصدار الشهادة المصطنعة', ...input }));
const read = (db, who, certificate) => certificates.getCompletionCertificate(db, who, certificate.id);
// إدراج خام يتجاوز الكود: ما يحرسه المحفّز لا ما يحرسه app/completion-certificates.mjs. يُنسخ صفٌّ سليم ويُبدَّل منه ما يُختبر.
function rawCertificate(db, base, overrides) {
  const row = { ...db.prepare('SELECT * FROM completion_certificates WHERE id=?').get(base.id), id: randomUUID(), ...overrides };
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO completion_certificates(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(column => row[column]));
}
const nextSequence = db => db.prepare("SELECT MAX(sequence)+1 AS n FROM completion_certificates WHERE tenant_id='36t'").get().n;
const numberOf = sequence => `CERT-${String(sequence).padStart(5, '0')}`;

test('numbering: six processes issuing at the same instant get six distinct consecutive numbers, and a same-project race yields one certificate and no gap', { timeout: 180000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), '36t-certificate-race-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'race.sqlite'), prepared = [];
  {
    const db = openDb(path);
    seed(db, PASSWORD);
    const users = world(db);
    for (let i = 1; i <= 7; i++) {
      const p = project(db, users, { registration: `RACE-${i}` });
      p.acceptAll();
      prepared.push([p.project_id, p.approver()]);
    }
    db.close();
  }
  // موعد مشترك للبدء، كما في حزام التزامن: بلا موعد تنتهي الأولى قبل أن تُقلع الأخيرة ولا يقع تنافس.
  const race = jobs => {
    const startAt = Date.now() + 2500;
    return Promise.all(jobs.map(([projectId, approverId], index) => new Promise(done => {
      const child = spawn(process.execPath, [WORKER, path, projectId, approverId, String(index), String(startAt)], { cwd: ROOT });
      let out = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.on('close', () => { try { done(JSON.parse(out.trim().split('\n').pop())); } catch { done({ index, ok: false, error: 'no output' }); } });
    })));
  };
  const six = await race(prepared.slice(0, 6));
  assert.deepEqual(six.filter(r => !r.ok), [], 'كل عملية أصدرت شهادتها');
  assert.deepEqual(six.map(r => r.number).sort(), ['CERT-00001', 'CERT-00002', 'CERT-00003', 'CERT-00004', 'CERT-00005', 'CERT-00006'], 'ستة أرقام متمايزة متتابعة');
  // ثلاث عمليات على المشروع نفسه: واحدة تُصدر، والباقيتان تُرفضان برفض مكتوب — لا شهادتان حيّتان ولا رقم مستهلك بلا شهادة.
  const same = await race([prepared[6], prepared[6], prepared[6]]);
  assert.equal(same.filter(r => r.ok).length, 1, JSON.stringify(same));
  assert.deepEqual(same.filter(r => !r.ok).map(r => r.error), ['certificate_exists', 'certificate_exists']);
  const db = openDb(path);
  t.after(() => db.close());
  assert.deepEqual(db.prepare("SELECT number FROM completion_certificates WHERE tenant_id='36t' ORDER BY sequence").all().map(r => r.number),
    ['CERT-00001', 'CERT-00002', 'CERT-00003', 'CERT-00004', 'CERT-00005', 'CERT-00006', 'CERT-00007'], 'الرفض لا يستهلك رقمًا: لا فجوة');
  assert.equal(verifyAudit(db), true, 'سلسلة التدقيق لم تتفرّع تحت الكتّاب المتزامنين');
});

test('immutability: an issued certificate refuses UPDATE and DELETE in SQL on every column, and so do its acceptance and reversal; the insert guards hold without the code', t => {
  const { db, users } = fresh(t);
  const p = project(db, users, { registration: 'FIXED-1' });
  p.acceptAll();
  const approverId = p.approver();
  let certificate = accept(db, users.pm, issue(db, users.manager, p.project_id, approverId));
  assert.equal(certificate.state, 'accepted');
  // «توثيق الاستلام» القديم كان UPDATE على هذه الأعمدة بالذات؛ صار ممنوعًا مثل غيره.
  for (const [column, value] of [['scope_summary', 'تعديل صامت على شهادة صادرة'], ['status', 'acknowledged'], ['acknowledged_by', 'pm'], ['version', 2],
    ['revision', 2], ['approver_snapshot', '{}'], ['evidence', 'دليل بديل بعد الصدور'], ['delivery_ids', '[]']])
    assert.throws(() => db.prepare(`UPDATE completion_certificates SET ${column}=? WHERE id=?`).run(value, certificate.id), /never edited/, column);
  assert.throws(() => db.prepare('DELETE FROM completion_certificates WHERE id=?').run(certificate.id), /retained/);
  assert.throws(() => db.prepare("UPDATE completion_certificate_acceptances SET channel='call' WHERE certificate_id=?").run(certificate.id), /never edited/);
  assert.throws(() => db.prepare('DELETE FROM completion_certificate_acceptances WHERE certificate_id=?').run(certificate.id), /retained/);
  certificate = reverse(db, users.manager, certificate);
  assert.throws(() => db.prepare("UPDATE completion_certificate_reversals SET reason='سبب آخر مكتوب بعد العكس' WHERE certificate_id=?").run(certificate.id), /recorded once/);
  assert.throws(() => db.prepare('DELETE FROM completion_certificate_reversals WHERE certificate_id=?').run(certificate.id), /retained/);
  // حرّاس الإدراج بلا الكود: كل إدراج يخالف شرطًا واحدًا فقط، فتُقرأ رسالة حارسه بعينه.
  const live = issue(db, users.manager, p.project_id, approverId);
  assert.equal(live.number, 'CERT-00002');
  const next = nextSequence(db);
  assert.throws(() => rawCertificate(db, live, { sequence: next, number: numberOf(next) }), /one live completion certificate/, 'شهادتان حيّتان لمشروع واحد');
  const other = project(db, users, { registration: 'FIXED-2' });
  other.acceptAll();
  const otherApprover = other.approver();
  const otherLive = issue(db, users.manager, other.project_id, otherApprover);
  reverse(db, users.manager, otherLive);
  assert.throws(() => rawCertificate(db, otherLive, { sequence: nextSequence(db) + 1, number: numberOf(nextSequence(db) + 1) }), /without gaps/, 'رقم يقفز');
  assert.throws(() => rawCertificate(db, otherLive, { sequence: nextSequence(db), number: 'CERT-9' }), /without gaps/, 'رقم لا يُشتق من تسلسله');
  assert.throws(() => rawCertificate(db, otherLive, { sequence: nextSequence(db), number: numberOf(nextSequence(db)), approver_id: approverId }), /registered for its project/, 'ممثل من مشروع آخر');
  assert.throws(() => rawCertificate(db, otherLive, { sequence: nextSequence(db), number: numberOf(nextSequence(db)), status: 'acknowledged', acknowledged_by: 'pm', acknowledged_at: new Date().toISOString(), acknowledgement_evidence: 'قبول مزروع بإدراج مباشر' }), /inserted as issued/);
  assert.throws(() => rawCertificate(db, live, { sequence: nextSequence(db), number: numberOf(nextSequence(db)), supersedes_id: live.id, revision: 3, correction_reason: 'قفزة نسخة لا يجوز أن تمر بإدراج مباشر' }), /next version of a live certificate/);
  assert.throws(() => rawCertificate(db, live, { sequence: nextSequence(db), number: numberOf(nextSequence(db)), supersedes_id: live.id, revision: 2, correction_reason: '' }), /next version of a live certificate/, 'تصحيح بلا سبب');
  // والقبول بلا الكود: قناة توقيع لا وجود لها، وقبول على نسخة استُبدلت.
  const acceptance = values => db.prepare('INSERT INTO completion_certificate_acceptances(id,tenant_id,certificate_id,channel,received_on,evidence_reference,limitation,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), '36t', values.certificate_id, values.channel ?? 'email', values.received_on ?? riyadh(), 'مرجع مصطنع لإدراج مباشر', 'حد مكتوب مصطنع لاختبار الحارس', values.recorded_by ?? 'pm', new Date().toISOString());
  assert.throws(() => acceptance({ certificate_id: live.id, channel: 'electronic_signature' }), /CHECK constraint failed/, 'لا قناة للتوقيع الإلكتروني في القاعدة');
  const corrected = correct(db, users.manager, live, approverId);
  assert.throws(() => acceptance({ certificate_id: live.id }), /live version/, 'قبول على نسخة استُبدلت');
  assert.throws(() => acceptance({ certificate_id: corrected.id, received_on: '2025-12-31' }), /not authorised on the day/, 'قبول قبل بداية التفويض');
  assert.equal(verifyAudit(db), true);
});

test('correction: a new version with its own number points at what it corrects; the old one stays as issued, and neither a stale, a superseded nor a closure-backed version is corrected', t => {
  const { db, users } = fresh(t);
  const p = project(db, users, { registration: 'CORRECT-1' });
  p.acceptAll();
  const approverId = p.approver();
  const first = accept(db, users.pm, issue(db, users.manager, p.project_id, approverId));
  assert.throws(() => correct(db, users.manager, first, approverId, { reason: 'خطأ' }), code('invalid_text'), 'لا تصحيح بلا سبب مكتوب');
  assert.throws(() => correct(db, users.manager, { ...first, version: 9 }, approverId), code('stale_version'));
  assert.throws(() => correct(db, users.employee, first, approverId), code('not_project_manager'), 'التصحيح لمدير المشروع');
  const second = correct(db, users.manager, first, approverId);
  assert.equal(second.number, 'CERT-00002');
  assert.equal(second.revision, 2);
  assert.equal(second.supersedes.number, 'CERT-00001');
  assert.equal(second.correction_reason, 'ملخص الإنجاز أغفل النسخة النهائية من الفيلم التعريفي');
  assert.equal(second.state, 'issued', 'النسخة الجديدة تنتظر قبول العميل من جديد');
  assert.deepEqual(second.deliverables.map(d => d.delivery_id), read(db, users.manager, first).deliverables.map(d => d.delivery_id), 'المخرجات نفسها');
  const old = read(db, users.manager, first);
  assert.equal(old.state, 'superseded');
  assert.equal(old.superseded_by.number, 'CERT-00002');
  assert.equal(old.scope_summary, 'أُنجز المخرجان المصطنعان كما في بنود الاتفاق المصطنع', 'الصادر يبقى كما صدر');
  assert.equal(old.acceptance.channel, 'email', 'وقبوله باقٍ في سجله');
  assert.deepEqual(old.actions, [], 'لا إجراء على نسخة استُبدلت');
  let error = caught(() => correct(db, users.manager, first, approverId));
  assert.equal(error.code, 'certificate_superseded');
  assert.match(error.message, /CERT-00002/, 'الرفض يسمّي النسخة السارية');
  // النسخة المستبدَلة لا تُحسب للإقفال الفني ولو قُبلت يومًا؛ السارية تُحسب بعد قبولها.
  const project_ = db.prepare('SELECT * FROM projects WHERE id=?').get(p.project_id);
  assert.ok(axes.technicalOutstanding(db, project_).outstanding.some(item => item.code === 'certificate_missing'));
  const accepted = accept(db, users.pm, second, { channel: 'meeting_minutes', evidence: 'محضر اجتماع الإغلاق المصطنع رقم 7' });
  assert.equal(axes.technicalOutstanding(db, project_).certificate.id, accepted.id);
  // الإقفال الفني قائم على النسخة الثانية: لا تصحيح ولا عكس تحته حتى يُعاد فتحه بتصريحه.
  tx(db, () => axes.closeTechnically(db, users.manager, p.project_id, { note: 'أُنجزت المخرجات وقُبلت وقبل العميل الشهادة', decisions: [] }));
  assert.equal(db.prepare('SELECT certificate_id FROM project_closures WHERE project_id=?').get(p.project_id).certificate_id, accepted.id);
  error = caught(() => correct(db, users.manager, accepted, approverId));
  assert.equal(error.code, 'closure_rests_on_certificate');
  assert.equal(error.details.refusal.missing[0].owner, 'حامل تصريح «إعادة فتح إقفال المشروع»');
  assert.throws(() => reverse(db, users.manager, accepted), code('closure_rests_on_certificate'));
  assert.deepEqual(read(db, users.manager, accepted).actions, [], 'الأزرار تقول ما يقوله الرفض');
  tx(db, () => grantAccess(db, users.admin, { user_id: 'manager', capability: 'projects.closure.reopen', department_id: '', note: 'اختبار تصحيح الشهادة بعد إعادة الفتح' }));
  const closure = axes.axesFor(db, users.manager, p.project_id).axes.closure;
  tx(db, () => axes.reopenClosure(db, users.manager, p.project_id, { version: closure.version, scope: 'technical', reason: 'ظهر خطأ في ملخص الشهادة بعد الإقفال الفني المصطنع' }));
  const third = correct(db, users.manager, accepted, approverId, { reason: 'تصحيح بعد إعادة فتح الإقفال الفني للمشروع المصطنع' });
  assert.equal(third.revision, 3);
  assert.equal(third.number, 'CERT-00003');
  assert.equal(verifyAudit(db), true);
});

test('reversal: a separate record with its reason; the reversed version stops counting, cannot be reversed or corrected again, and a fresh certificate may follow', t => {
  const { db, users } = fresh(t);
  const p = project(db, users, { registration: 'REVERSE-1' });
  p.acceptAll();
  const approverId = p.approver();
  const first = accept(db, users.pm, issue(db, users.manager, p.project_id, approverId));
  assert.throws(() => reverse(db, users.manager, first, { reason: 'قصير' }), code('invalid_text'));
  assert.throws(() => reverse(db, users.employee, first), code('not_project_manager'));
  const reversed = reverse(db, users.manager, first);
  assert.equal(reversed.state, 'reversed');
  assert.equal(reversed.reversal.reason, 'اعترض العميل على اكتمال الفيلم بعد إصدار الشهادة المصطنعة');
  assert.equal(reversed.reversal.reversed_by_name, users.manager.name);
  assert.equal(reversed.acceptance.channel, 'email', 'العكس لا يمحو ما سُجّل قبله');
  assert.equal(certificates.acceptedCertificate(db, p.project_id), null, 'المعكوسة لا تُحسب للإقفال');
  assert.throws(() => reverse(db, users.manager, first), code('certificate_reversed'));
  assert.throws(() => correct(db, users.manager, first, approverId), code('certificate_reversed'));
  // بعد العكس لا شهادة حيّة، فيُصدَر للمشروع أصلٌ جديد برقمه التالي ونسخته الأولى.
  const renewed = accept(db, users.pm, issue(db, users.manager, p.project_id, approverId));
  assert.equal(renewed.number, 'CERT-00002');
  assert.equal(renewed.revision, 1);
  assert.equal(renewed.supersedes, null, 'الأصل الجديد لا يدّعي أنه تصحيح للمعكوسة');
  assert.deepEqual(certificates.certificateSummaries(db, p.project_id).map(c => [c.number, c.revision, c.state]), [['CERT-00001', 1, 'reversed'], ['CERT-00002', 1, 'accepted']]);
  // عكس نسخة استُبدلت مرفوض: العكس للسارية.
  const next = correct(db, users.manager, renewed, approverId);
  assert.throws(() => reverse(db, users.manager, renewed), code('certificate_superseded'));
  assert.equal(reverse(db, users.manager, next).state, 'reversed');
  assert.equal(verifyAudit(db), true);
});

test('client acceptance: every channel is employee-entered external evidence carrying its written limit, and nothing on the record, the screen or the document claims a signature', t => {
  const { db, users } = fresh(t);
  const p = project(db, users, { registration: 'CHANNEL-1' });
  p.acceptAll();
  const approverId = p.approver();
  const channels = certificates.acceptanceChannels();
  assert.deepEqual(channels.map(c => c.key), ['email', 'signed_document', 'meeting_minutes', 'message', 'call'], 'قنوات سجل الموافقات الخارجية نفسها');
  for (const channel of channels) {
    assert.match(channel.limitation, /مو توقيع إلكتروني/, channel.key);
    assert.match(channel.limitation, /ما تحققت/, `${channel.key}: الحد يقول ما لم تتحقق منه المنصة`);
  }
  assert.match(channels.find(c => c.key === 'call').limitation, /ما يترك أثر مكتوب/, 'الاتصال يقول إن أثره التأكيد المكتوب وحده');
  // كل قناة على نسخة من سلسلة واحدة: قبولٌ ثم تصحيحٌ بنسخة ثم قبولها بالقناة التالية.
  let certificate = issue(db, users.manager, p.project_id, approverId);
  const seen = [];
  for (const [index, channel] of channels.entries()) {
    const accepted = accept(db, users.pm, certificate, { channel: channel.key, evidence: `مرجع دليل مصطنع للقناة ${channel.key}` });
    assert.equal(accepted.acceptance.channel, channel.key);
    assert.equal(accepted.acceptance.channel_name, channel.name);
    assert.equal(accepted.acceptance.limitation, channel.limitation, 'الحد مكتوب على السجل كما هو');
    assert.equal(accepted.acceptance.source, 'employee_entered_external_evidence');
    assert.equal(accepted.acceptance.recorded_by_name, users.pm.name);
    assert.equal(accepted.electronic_signature, false);
    seen.push(accepted);
    if (index < channels.length - 1) certificate = correct(db, users.manager, accepted, approverId, { reason: `تصحيح مصطنع رقم ${index + 1} لتجربة قناة القبول التالية` });
  }
  assert.deepEqual(db.prepare('SELECT channel,limitation FROM completion_certificate_acceptances ORDER BY recorded_at,rowid').all().map(r => r.channel), channels.map(c => c.key));
  const error = caught(() => accept(db, users.pm, correct(db, users.manager, seen.at(-1), approverId, { reason: 'تصحيح مصطنع لتجربة قناة توقيع لا وجود لها' }), { channel: 'electronic_signature' }));
  assert.equal(error.code, 'channel');
  assert.match(error.details.refusal.next, /ما عندها آلية توقيع معتمدة/, 'الرفض يقول لماذا لا قناة للتوقيع');
  // لا ادعاء توقيع في أي مفتاح يذكر التوقيع: false أو الجملة التي تنفيه، ولا شيء غيرهما.
  const claims = (value, path = '') => value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, item]) => [...(/signature|signed/i.test(key) ? [[path + key, item]] : []), ...claims(item, `${path}${key}.`)]) : [];
  const view = read(db, users.pm, seen[0]);
  for (const [key, value] of claims(view)) assert.ok(value === false || value === certificates.SIGNATURE_STATEMENT, `${key} يدّعي توقيعًا: ${JSON.stringify(value)}`);
  assert.match(view.signature_statement, /ما فيه توقيع إلكتروني/);
  // المستند: السجل نفسه بشكل وثيقة، بحدّ القبول وجملة التوثيق، بلا صورة توقيع ولا خانة تنتظر قلمًا.
  const html = certificates.certificateDocument(view);
  for (const text of [view.number, 'الإصدار 1', 'مفوضة قبول مصطنعة', 'البند 9 من العقد المصطنع', view.acceptance.limitation, certificates.SIGNATURE_STATEMENT,
    'تقرير إنجاز البند 1 المصطنع', 'محضر قبول البند 2 المصطنع', 'استُبدلت هذي النسخة'])
    assert.ok(html.includes(text), `المستند ما يحمل: ${text}`);
  assert.equal(/<img|<canvas|signature-pad|التوقيع:/i.test(html), false, 'لا صورة توقيع ولا خانة توقيع');
  assert.equal(verifyAudit(db), true);
});

test('separation of duties and permissions: the issuer and the internal acceptor of the deliverables never record the client acceptance, in code and in SQL', t => {
  const { db, users } = fresh(t);
  const p = project(db, users, { registration: 'DUTIES-1' });
  p.acceptAll();
  // يُسلَّم المشروع لمدير المشروع ليفترق المُصدِر عن قابل المخرجات داخليًا (المدير المباشر)، فيُختبر كل رفضٍ وحده.
  handOverProject(db, p.project_id, 'pm');
  const approverId = p.approver();
  assert.throws(() => issue(db, users.employee, p.project_id, approverId), code('not_project_manager'), 'الإصدار لمدير المشروع');
  assert.throws(() => issue(db, users.outsider, p.project_id, approverId), code('project_not_found'), 'غير العضو لا يعرف المشروع');
  // المدير قبل المخرجات، فيُصدر مدير المشروع هنا: من قبل المخرجات لا يسجّل قبول العميل للشهادة نفسها.
  const certificate = issue(db, users.pm, p.project_id, approverId);
  let error = caught(() => accept(db, users.pm, certificate));
  assert.equal(error.code, 'self_approval', 'المُصدِر لا يسجّل القبول');
  assert.ok(error.details.refusal.next, 'الرفض يقول الخطوة التالية');
  error = caught(() => accept(db, users.manager, certificate));
  assert.equal(error.code, 'delivery_acceptor', 'من قبل المخرجات داخليًا لا يسجّل قبول العميل');
  error = caught(() => accept(db, users.employee, certificate));
  assert.equal(error.code, 'not_permitted', 'بلا تصريح توثيق موافقات العملاء لا قبول');
  assert.equal(error.status, 403);
  assert.equal(error.details.refusal.missing[0].document, 'تصريح «توثيق موافقات العملاء الخارجية»');
  assert.throws(() => accept(db, users.outsider, certificate), code('not_found'));
  // والقاعدة تقول الشيء نفسه لمن يتجاوز الكود.
  const direct = recorder => db.prepare('INSERT INTO completion_certificate_acceptances(id,tenant_id,certificate_id,channel,received_on,evidence_reference,limitation,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), '36t', certificate.id, 'email', riyadh(), 'مرجع مصطنع لإدراج مباشر', 'حد مكتوب مصطنع لاختبار الحارس', recorder, new Date().toISOString());
  assert.throws(() => direct('pm'), /other than the issuer and the internal acceptor/);
  assert.throws(() => direct('manager'), /other than the issuer and the internal acceptor/);
  assert.deepEqual(read(db, users.employee, certificate).actions, [], 'الأزرار تقول ما يقوله الرفض');
  // التصريح يُمنح فيُفتح الطريق لغير المُصدِر وغير القابل.
  tx(db, () => grantAccess(db, users.admin, { user_id: 'employee', capability: 'approvals.record', department_id: '', note: 'اختبار فصل المهام في شهادة الإنجاز' }));
  assert.deepEqual(read(db, users.employee, certificate).actions, ['accept_certificate']);
  const accepted = accept(db, users.employee, certificate);
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.issued_by_name, users.pm.name);
  assert.equal(accepted.acceptance.recorded_by_name, users.employee.name);
  assert.equal(verifyAudit(db), true);
});

test('negative paths: every refusal names what is missing, who owns it and the next step', t => {
  const { db, users } = fresh(t);
  const p = project(db, users, { registration: 'NEGATIVE-1' });
  const approverId = p.approver();
  p.deliver(0);
  let error = caught(() => issue(db, users.manager, p.project_id, approverId));
  assert.equal(error.code, 'deliverable_not_accepted');
  assert.deepEqual(error.details.refusal.missing.map(m => m.document), ['قبول بند «فيلم تعريفي مصطنع»'], 'الرفض يسمّي البند الباقي بعينه');
  assert.equal(error.details.refusal.missing[0].owner, 'المدير المباشر لمسؤول الملف');
  p.deliver(1);
  // الشكل القديم (ممثل العميل نصًّا حرًّا) يُرفض: لا خانة ثانية تفترق عن سجل المفوّضين.
  assert.throws(() => tx(db, () => certificates.issueCompletionCertificate(db, users.manager, p.project_id, { scope_summary: 'أُنجز المخرجان المصطنعان كما في الاتفاق', customer_representative: 'أي اسم يُكتب', evidence: 'تقرير إنجاز مصطنع' })), code('invalid_fields'));
  error = caught(() => issue(db, users.manager, p.project_id, undefined));
  assert.equal(error.code, 'approver_required');
  assert.match(error.details.refusal.next, /موافقات العملاء/);
  const elsewhere = project(db, users, { registration: 'NEGATIVE-2' }).approver();
  assert.throws(() => issue(db, users.manager, p.project_id, elsewhere), code('approver_required'), 'مفوّض مشروع آخر لا يمثل العميل هنا');
  const revoked = p.approver({ name: 'مفوض سُحب تفويضه' });
  tx(db, () => revokeApprover(db, users.pm, revoked, { reason: 'انتهى تكليف المفوض لدى العميل المصطنع', revoked_on: riyadh() }));
  error = caught(() => issue(db, users.manager, p.project_id, revoked));
  assert.equal(error.code, 'approver_required');
  assert.match(error.message, /مفوض سُحب تفويضه/);
  assert.throws(() => issue(db, users.manager, p.project_id, approverId, { scope_summary: 'قصير' }), code('invalid_text'));
  const certificate = issue(db, users.manager, p.project_id, approverId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM completion_certificates').get().n, 1, 'الرفوض قبلها لم تستهلك رقمًا');
  error = caught(() => issue(db, users.manager, p.project_id, approverId));
  assert.equal(error.code, 'certificate_exists');
  assert.match(error.details.refusal.next, /صحّحها بنسخة جديدة/);
  assert.throws(() => accept(db, users.pm, { ...certificate, version: 2 }), code('stale_version'));
  assert.throws(() => accept(db, users.pm, certificate, { received_on: riyadh(1) }), code('received_on'), 'لا قبول في المستقبل');
  assert.throws(() => accept(db, users.pm, certificate, { received_on: riyadh(-1) }), code('received_on'), 'لا قبول قبل إصدار الشهادة');
  assert.throws(() => accept(db, users.pm, certificate, { evidence: 'قصير' }), code('invalid_text'), 'لا قبول بلا مرجع دليل');
  assert.throws(() => accept(db, users.pm, certificate, { channel: 'call', evidence: 'قصير' }), error => error.code === 'invalid_text' && /التأكيد المكتوب/.test(error.message), 'الاتصال يُسند بتأكيده المكتوب');
  tx(db, () => revokeApprover(db, users.pm, approverId, { reason: 'سحب العميل تفويض مفوضة القبول المصطنعة', revoked_on: riyadh() }));
  error = caught(() => accept(db, users.pm, certificate));
  assert.equal(error.code, 'approver_not_authorized');
  assert.match(error.details.refusal.next, /صحّح الشهادة/);
  const replacement = p.approver({ name: 'مفوض بديل مصطنع' });
  const corrected = correct(db, users.manager, certificate, replacement, { reason: 'سحب العميل تفويض المفوضة الأولى فصارت الشهادة باسم المفوض البديل' });
  assert.equal(accept(db, users.pm, corrected).client_representative.name, 'مفوض بديل مصطنع');
  error = caught(() => accept(db, users.pm, corrected));
  assert.equal(error.code, 'certificate_not_open', 'القبول يُسجَّل مرة');
  assert.match(error.details.refusal.next, /مرة وحدة/);
  assert.equal(verifyAudit(db), true);
});

test('replay through HTTP: the same idempotency key returns the same certificate, a changed body is refused, a repeated acceptance is refused, and the document is served to members only', async t => {
  const { db, users } = fresh(t, passwordHash(PASSWORD));
  const p = project(db, users, { registration: 'HTTP-1' });
  p.acceptAll();
  const approverId = p.approver();
  const app = createApp(db);
  const sessions = {};
  for (const who of ['manager', 'pm', 'outsider', 'hr']) {
    const response = await dispatch(app, { method: 'POST', path: '/api/login', body: { username: who, password: PASSWORD } });
    assert.equal(response.status, 200, who);
    sessions[who] = { cookie: response.headers['Set-Cookie'].split(';')[0], csrf: response.json().csrf };
  }
  const call = (who, method, path, body, key) => dispatch(app, { method, path: '/api' + path, body,
    headers: { cookie: sessions[who].cookie, 'x-csrf-token': sessions[who].csrf, ...(key ? { 'idempotency-key': key } : {}) } });
  const body = { scope_summary: 'أُنجز المخرجان المصطنعان كما في بنود الاتفاق المصطنع', approver_id: approverId, evidence: 'تقرير إنجاز المشروع المصطنع HTTP-CR-1' };
  const key = 'certificate-issue-replay-0001';
  const first = await call('manager', 'POST', `/projects/${p.project_id}/completion-certificate`, body, key);
  assert.equal(first.status, 201, first.text);
  const again = await call('manager', 'POST', `/projects/${p.project_id}/completion-certificate`, body, key);
  assert.equal(again.status, 201);
  assert.equal(again.json().id, first.json().id, 'الإعادة بالمفتاح نفسه تعيد الشهادة نفسها');
  assert.equal(again.json().number, 'CERT-00001');
  assert.equal(again.json().electronic_signature, false, 'والإعادة تعيد السجل كاملًا لا معرّفه وحده');
  const changed = await call('manager', 'POST', `/projects/${p.project_id}/completion-certificate`, { ...body, scope_summary: 'ملخص مختلف بالمفتاح نفسه لا يجوز أن يمر' }, key);
  assert.equal(changed.status, 409);
  assert.equal(changed.json().error.code, 'idempotency_conflict');
  const keyless = await call('manager', 'POST', `/projects/${p.project_id}/completion-certificate`, body);
  assert.equal(keyless.status, 400);
  assert.equal(keyless.json().error.code, 'idempotency_required');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM completion_certificates').get().n, 1);
  const certificate = first.json();
  const acceptance = { version: certificate.version, channel: 'email', received_on: riyadh(), evidence: 'رسالة بريد مصطنعة من مفوضة العميل تقبل الشهادة' };
  const accepted = await call('pm', 'POST', `/completion-certificates/${certificate.id}/acknowledge`, acceptance);
  assert.equal(accepted.status, 201, accepted.text);
  assert.equal(accepted.json().state, 'accepted');
  const repeated = await call('pm', 'POST', `/completion-certificates/${certificate.id}/acknowledge`, acceptance);
  assert.equal(repeated.status, 409);
  assert.equal(repeated.json().error.code, 'certificate_not_open');
  assert.ok(repeated.json().error.details.refusal.next, 'الرفض المكتوب يصل الواجهة بخطوته التالية');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM completion_certificate_acceptances').get().n, 1);
  const correction = { version: certificate.version, reason: 'ملخص الإنجاز أغفل النسخة النهائية من الفيلم التعريفي', scope_summary: 'أُنجز المخرجان المصطنعان، والفيلم بنسخته النهائية', approver_id: approverId, evidence: 'تقرير إنجاز المشروع المصطنع HTTP-CR-1' };
  const corrected = await call('manager', 'POST', `/completion-certificates/${certificate.id}/correct`, correction, 'certificate-correct-replay-0001');
  assert.equal(corrected.status, 201, corrected.text);
  const correctedAgain = await call('manager', 'POST', `/completion-certificates/${certificate.id}/correct`, correction, 'certificate-correct-replay-0001');
  assert.equal(correctedAgain.json().id, corrected.json().id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM completion_certificates').get().n, 2, 'التصحيح المعاد لا ينشئ نسخة ثالثة');
  const reversed = await call('manager', 'POST', `/completion-certificates/${corrected.json().id}/reverse`, { version: 1, reason: 'اعترض العميل على اكتمال الفيلم بعد إصدار الشهادة المصطنعة' });
  assert.equal(reversed.status, 201, reversed.text);
  const reversedAgain = await call('manager', 'POST', `/completion-certificates/${corrected.json().id}/reverse`, { version: 1, reason: 'اعترض العميل على اكتمال الفيلم بعد إصدار الشهادة المصطنعة' });
  assert.equal(reversedAgain.json().error.code, 'certificate_reversed');
  // المستند والقراءة: للأعضاء، ومن ليس عضوًا لا يعرف أن الشهادة موجودة.
  const document = await call('pm', 'GET', `/completion-certificates/${certificate.id}/document`);
  assert.equal(document.status, 200);
  assert.match(document.headers['Content-Type'], /text\/html/);
  assert.ok(document.text.includes('CERT-00001') && document.text.includes('ما فيه توقيع إلكتروني'));
  assert.equal((await call('pm', 'GET', `/completion-certificates/${certificate.id}`)).json().state, 'superseded');
  assert.equal((await call('outsider', 'GET', `/completion-certificates/${certificate.id}/document`)).status, 404);
  assert.equal((await call('outsider', 'GET', `/completion-certificates/${certificate.id}`)).status, 404);
  const board = await call('hr', 'GET', '/completion-certificates');
  assert.equal(board.status, 200, 'اللوحة لا ترفض من لا مشروع تجاريًا له');
  assert.deepEqual(board.json().cases, {});
  assert.equal((await call('manager', 'GET', '/completion-certificates')).json().cases[p.case_id].certificates.length, 2);
  assert.equal(verifyAudit(db), true);
});

test('audit chain: issue, acceptance, correction and reversal each leave a named event on an unbroken chain', t => {
  const { db, users } = fresh(t);
  const p = project(db, users, { registration: 'AUDIT-1' });
  p.acceptAll();
  const approverId = p.approver();
  const first = accept(db, users.pm, issue(db, users.manager, p.project_id, approverId), { channel: 'call', evidence: 'تأكيد مكتوب مصطنع بعد الاتصال رقم 44' });
  const second = correct(db, users.manager, first, approverId);
  reverse(db, users.manager, second);
  const events = db.prepare("SELECT actor_id,entity_id,action,after_json,reason FROM audit_events WHERE entity_type='completion_certificate' ORDER BY seq").all();
  assert.deepEqual(events.map(e => [e.action, e.actor_id]), [['axes.certificate_issued', 'manager'], ['axes.certificate_accepted', 'pm'], ['axes.certificate_corrected', 'manager'], ['axes.certificate_reversed', 'manager']]);
  const acceptedEvent = JSON.parse(events[1].after_json);
  assert.equal(acceptedEvent.channel, 'call');
  assert.equal(acceptedEvent.source, 'employee_entered_external_evidence');
  assert.equal(acceptedEvent.electronic_signature, false, 'حتى سجل التدقيق لا يدّعي توقيعًا');
  assert.equal(events[2].reason, 'ملخص الإنجاز أغفل النسخة النهائية من الفيلم التعريفي');
  assert.equal(JSON.parse(events[2].after_json).supersedes, 'CERT-00001');
  assert.equal(verifyAudit(db), true);
});

test('tenant isolation: another tenant neither reads nor acts on a certificate, and numbers its own certificates from one', t => {
  const { db, users } = fresh(t);
  const p = project(db, users, { registration: 'TENANT-1' });
  p.acceptAll();
  const certificate = issue(db, users.manager, p.project_id, p.approver());
  assert.equal(certificate.number, 'CERT-00001');
  assert.throws(() => read(db, users.external, certificate), code('not_found'));
  assert.throws(() => accept(db, users.external, certificate), code('not_found'));
  assert.throws(() => reverse(db, users.external, certificate), code('not_found'));
  assert.deepEqual(certificates.certificatesBoard(db, users.external).cases, {});
  // الكيان المعزول يبني مشروعه بالطريق نفسه، وترقيمه يبدأ من واحد: الرقم فريد في الكيان لا في المنصة.
  const isolated = project(db, users, { registration: 'TENANT-1', owner: 'iso-owner', manager: 'iso-manager', pm: 'iso-pm' });
  isolated.acceptAll();
  const own = issue(db, users['iso-manager'], isolated.project_id, isolated.approver());
  assert.equal(own.number, 'CERT-00001');
  assert.equal(accept(db, users['iso-pm'], own).state, 'accepted');
  assert.throws(() => read(db, users.manager, own), code('not_found'));
  assert.throws(() => issue(db, users.manager, isolated.project_id, p.approver()), code('project_not_found'));
  assert.deepEqual(db.prepare('SELECT tenant_id,number FROM completion_certificates ORDER BY tenant_id').all().map(r => [r.tenant_id, r.number]), [['36t', 'CERT-00001'], ['isolated', 'CERT-00001']]);
  assert.equal(verifyAudit(db), true);
});

test('migration 164 over a database with pre-164 certificates: rows are kept as written, an acknowledged one still counts, an unrepresented one is corrected before acceptance', t => {
  const dir = mkdtempSync(join(tmpdir(), '36t-certificate-164-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'pre-164.sqlite');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON;');
  const schema = readFileSync(new URL('../app/schema.sql', import.meta.url), 'utf8');
  raw.exec(schema);
  raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  for (const file of readdirSync(new URL('../app/migrations/', import.meta.url)).filter(name => /^\d{3}-.+\.sql$/.test(name)).sort()) {
    const version = Number(file.slice(0, 3));
    if (version >= 164) continue;
    const sql = readFileSync(new URL('../app/migrations/' + file, import.meta.url), 'utf8');
    raw.exec('BEGIN'); raw.exec(sql); raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version, hash(sql)); raw.exec('COMMIT');
  }
  seed(raw, PASSWORD);
  const before = world(raw);
  const legacy = [];
  for (const registration of ['LEGACY-1', 'LEGACY-2']) {
    const p = legacyProject(raw, before, registration);
    const deliveries = raw.prepare("SELECT d.id FROM commercial_deliveries d JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' AND r.status='approved' WHERE d.case_id=? ORDER BY d.line_index").all(p.case_id).map(r => r.id);
    const certificateId = randomUUID(), sequence = legacy.length + 1;
    // كما كتبها الكود قبل 164 بالحرف: إصدار بممثل نصّي، ثم «توثيق الاستلام» UPDATE على الصف نفسه.
    raw.prepare("INSERT INTO completion_certificates(id,tenant_id,case_id,project_id,sequence,number,scope_summary,delivery_ids,our_representative,customer_representative,evidence,status,issued_by,issued_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'issued',?,?)")
      .run(certificateId, '36t', p.case_id, p.project_id, sequence, numberOf(sequence), 'أُنجز المخرجان المصطنعان قبل ترحيل الشهادة', JSON.stringify(deliveries), before.manager.name, 'ممثل مكتوب نصًّا قبل 164', 'دليل مصطنع قبل الترحيل', 'manager', '2026-09-20T09:00:00.000Z');
    legacy.push({ ...p, id: certificateId });
  }
  raw.prepare("UPDATE completion_certificates SET status='acknowledged',acknowledged_by='pm',acknowledged_at='2026-09-21T09:00:00.000Z',acknowledgement_evidence='بريد العميل المصطنع باستلام الشهادة',version=version+1 WHERE id=?").run(legacy[0].id);
  raw.close();

  const db = openDb(path);
  t.after(() => db.close());
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=164').get(), 'الترحيل 164 طُبِّق فوق القاعدة القديمة');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  // الموثّقة قبل 164 تبقى مقبولة بقاعدة يومها، ويُقال عنها ما لم يُسجَّل: لا قناة ولا سند.
  const acknowledged = certificates.getCompletionCertificate(db, users.manager, legacy[0].id);
  assert.equal(acknowledged.state, 'accepted');
  assert.equal(acknowledged.acceptance.channel, null);
  assert.match(acknowledged.acceptance.limitation, /قبل ما تُطلب القناة وسند التفويض/);
  assert.equal(acknowledged.client_representative.registered, false);
  assert.equal(acknowledged.client_representative.authority_basis, null, 'لا يُختلق سند بأثر رجعي');
  assert.equal(acknowledged.electronic_signature, false);
  assert.equal(certificates.acceptedCertificate(db, legacy[0].project_id).id, legacy[0].id, 'الإقفال الفني يقرؤها كما كان');
  assert.throws(() => db.prepare("UPDATE completion_certificates SET scope_summary='تعديل بعد الترحيل' WHERE id=?").run(legacy[0].id), /never edited/);
  // الصادرة بلا ممثل من السجل: لا قبول عليها حتى تُصحَّح بنسخة تسمّيه.
  const pending = certificates.getCompletionCertificate(db, users.manager, legacy[1].id);
  assert.equal(pending.state, 'issued');
  assert.throws(() => accept(db, users.pm, pending), code('approver_required'));
  const approverId = tx(db, () => registerApprover(db, users.pm, { project_id: legacy[1].project_id, name: 'مفوضة مسجلة بعد الترحيل', title: 'مديرة المشاريع لدى العميل',
    authority_basis: 'خطاب تفويض مصطنع سُجّل بعد الترحيل 164', authority_scope: 'قبول شهادة الإنجاز', valid_from: '2026-01-01' })).id;
  const corrected = correct(db, users.manager, pending, approverId, { reason: 'الشهادة صدرت قبل سجل المفوّضين وتحتاج ممثلًا بسند تفويضه' });
  assert.equal(corrected.number, 'CERT-00003', 'الترقيم يكمل بعد الصفوف القائمة بلا فجوة');
  assert.equal(corrected.revision, 2);
  assert.equal(accept(db, users.pm, corrected).state, 'accepted');
  assert.equal(verifyAudit(db), true);
});

test('screen: the commercial file draws the certificate with its representative, acceptance limit and statement, and its forms post to the certificate routes', t => {
  const { db, users } = fresh(t);
  const p = project(db, users, { registration: 'SCREEN-1' });
  p.acceptAll();
  const approverId = p.approver();
  const e = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const button = (action, id, label) => `<button data-action="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
  // بيانات الشاشة كما تحمّلها load: ملفات العميل من الخادم، ولوحة الشهادات من /completion-certificates.
  const data = who => ({ rows: [], team: [], user: users[who], certificates: certificates.certificatesBoard(db, users[who]) });
  const listed = who => ({ ...data(who), rows: listCommercial(db, users[who]) });
  // قبل الإصدار: مدير المشروع يرى زر الإصدار، ونموذجه يحمل مفتاح التكرار وممثل العميل من السجل.
  let html = commercialUI.render(listed('manager'), { e, button });
  assert.match(html, /data-action="issue_certificate"/);
  const issueForm = commercialUI.form('issue_certificate', p.project_id, data('manager'));
  assert.equal(issueForm.idempotent, true);
  assert.equal(issueForm.endpoint, `/projects/${p.project_id}/completion-certificate`);
  assert.deepEqual(issueForm.fields.find(f => f.name === 'approver_id').options.map(o => o.value), [approverId]);
  assert.throws(() => commercialUI.form('issue_certificate', p.project_id, data('employee')), /مو متاح/, 'غير مدير المشروع لا نموذج له');
  const certificate = issue(db, users.manager, p.project_id, approverId);
  // بعد الإصدار: مدير المشروع يسجّل القبول، ونموذجه يرسل النسخة والقناة إلى /acknowledge.
  const acceptForm = commercialUI.form('accept_certificate', certificate.id, data('pm'));
  assert.equal(acceptForm.endpoint, `/completion-certificates/${certificate.id}/acknowledge`);
  assert.deepEqual(acceptForm.toPayload({ channel: 'message', received_on: riyadh(), evidence: 'رسالة مصطنعة من مفوضة العميل' }), { version: 1, channel: 'message', received_on: riyadh(), evidence: 'رسالة مصطنعة من مفوضة العميل' });
  assert.match(acceptForm.fields.find(f => f.name === 'channel').label, /مو توقيع إلكتروني/);
  accept(db, users.pm, certificate, { channel: 'message', evidence: 'رسالة مصطنعة من مفوضة العميل' });
  html = commercialUI.render(listed('manager'), { e, button });
  for (const text of ['CERT-00001', 'قبلها العميل', 'مفوضة قبول مصطنعة', 'البند 9 من العقد المصطنع', certificates.acceptanceChannels().find(c => c.key === 'message').limitation, 'ما فيه توقيع إلكتروني', `/api/completion-certificates/${certificate.id}/document`])
    assert.ok(html.includes(e(text)) || html.includes(text), `الشاشة ما تحمل: ${text}`);
  assert.match(html, /data-action="correct_certificate"/);
  const correctForm = commercialUI.form('correct_certificate', certificate.id, data('manager'));
  assert.equal(correctForm.idempotent, true);
  assert.equal(correctForm.fields.find(f => f.name === 'scope_summary').value, certificate.scope_summary, 'التصحيح يبدأ من نص النسخة السابقة');
  assert.equal(commercialUI.form('reverse_certificate', certificate.id, data('manager')).endpoint, `/completion-certificates/${certificate.id}/reverse`);
  // بيانات الشاشة بلا لوحة الشهادات (الشكل القديم) لا ترسم كتلة ولا تنكسر.
  const legacy = listed('manager');
  delete legacy.certificates;
  assert.equal(commercialUI.render(legacy, { e, button }).includes('شهادة الإنجاز'), false);
  assert.equal(verifyAudit(db), true);
});
