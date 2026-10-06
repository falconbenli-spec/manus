// P4-CRM-2 — الفرصة الرابحة إلى مشروع بلا إعادة كتابة (CRM-09: «لا يتطلب الانتقال إعادة إدخال العميل أو نطاق المخرجات»).
// الفرصة تفتح صفقتها، والفوز يشترط اتفاقًا موثّقًا عليها، ونموذج التسليم BD-04 يُشتق من الصفقة والاتفاق والعرض المقبول.
// بيانات تجريبية مصطنعة بالكامل (tests/crm-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { createOnce } from '../app/idempotency.mjs';
import * as commercial from '../app/commercial.mjs';
import * as pipeline from '../app/pipeline-estimates.mjs';
import * as projectIntake from '../app/project-intake.mjs';
import * as projectAxes from '../app/project-axes.mjs';
import { createProject } from '../app/projects.mjs';
import { createApp } from '../app/server.mjs';
import { sessionsFor, dispatch } from './definitions-fixture.mjs';
import { crmWorld, code, caught, riyadh, CLIENT, OPPORTUNITY } from './crm-fixture.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { boundQuote } from './proposal-fixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'tests/crm-conversion-worker.mjs');
const TERMS = { requires_client_po: false, terms: [
  { label: 'دفعة تجريبية عند اعتماد الهوية', amount: '46000.00', due_on: '2099-10-15', condition: 'عند اعتماد العميل للهوية التجريبية', condition_kind: 'acceptance', condition_lines: [0] },
  { label: 'دفعة تجريبية عند إطلاق الحملة', amount: '46000.00', due_on: '2099-11-15', condition: '', condition_kind: 'acceptance', condition_lines: [1] }] };
const HANDOVER = projectId => ({ project_id: projectId, project_manager_id: 'pm1', contract_signed_on: riyadh(-1), kickoff_planned_on: riyadh(3),
  channels: 'البريد الرسمي وقناة المشروع التجريبية', timeline_start: riyadh(), timeline_end: '2099-12-31', risks: '', special_requirements: '' });

test('CRM-09: the opportunity opens its deal with nothing typed twice — customer from the client file, qualification prefilled from the opportunity and still decided by the direct manager', t => {
  const w = crmWorld(t), { db, users, tx, client } = w;
  const oppId = w.opportunity();
  const deal = w.openCase(oppId);
  const c = w.kase(deal.id);
  assert.deepEqual([c.client_id, c.opportunity_id, c.owner_id, c.name, c.registration_number, c.sector, c.status],
    [client, oppId, 'employee', CLIENT.legal_name, CLIENT.registration_number, CLIENT.sector, 'qualification_pending']);
  assert.match(c.contact, /ممثلة عميل تجريبية/);
  assert.equal(w.opp(oppId).case_id, deal.id, 'the opportunity points at its deal');
  assert.equal(db.prepare('SELECT client_id FROM client_links WHERE case_id=?').get(deal.id).client_id, client);
  const q = JSON.parse(db.prepare('SELECT snapshot FROM commercial_qualifications WHERE case_id=?').get(deal.id).snapshot);
  assert.deepEqual([q.need, q.budget_minor, q.currency, q.timing, q.decision_maker], [OPPORTUNITY.name, '10000000', 'SAR', OPPORTUNITY.expected_close_on, OPPORTUNITY.decision_maker]);
  assert.match(q.service_fit, /الأفكار والحملات المتكاملة/);
  // التأهيل المعبأ ما زال قرار المدير المباشر، لا صاحب الصفقة.
  const review = db.prepare("SELECT * FROM commercial_reviews WHERE case_id=? AND kind='qualification'").get(deal.id);
  assert.deepEqual([review.status, review.approver_id, review.requested_by], ['pending', 'manager', 'employee']);
  assert.throws(() => w.act('employee', deal.id, 'approve_qualification', { note: 'اعتماد ذاتي' }), code('commercial_transition'));
  // كل تغيّر حالة في سلسلة التدقيق: إنشاء الصفقة، ورفع تأهيلها، وربط الفرصة بها.
  const trail = id => db.prepare('SELECT action FROM audit_events WHERE entity_id=? ORDER BY seq').all(id).map(r => r.action);
  assert.deepEqual(trail(deal.id), ['lead.created', 'qualify']);
  assert.ok(trail(oppId).includes('opportunity.case_opened'));
  // لا حقل يُكتب عند التحويل: كل ما يلزم من الفرصة والعميل.
  const second = w.opportunity({ name: 'فرصة تجريبية ثانية' });
  assert.equal(caught(() => tx(() => commercial.createCaseFromOpportunity(db, users.employee, second, { version: w.opp(second).version, name: 'اسم مكتوب' }))).code, 'invalid_fields');
  // فرصة ناقصة: الرفض يسمّي حقول الفرصة الناقصة ومالكها، والإصلاح في الفرصة لا في التحويل.
  const thin = w.opportunity({ name: 'فرصة تجريبية ناقصة', decision_maker: '', expected_close_on: '' });
  const incomplete = caught(() => w.openCase(thin));
  assert.equal(incomplete.code, 'opportunity_incomplete');
  assert.deepEqual(incomplete.details.refusal.missing.map(m => m.doc_key).sort(), ['decision_maker', 'expected_close_on']);
  assert.ok(verifyAudit(db));
});

test('CRM-09: an opportunity is won only on a contracted deal opened from it — the refusal names what is still missing and who owns it', t => {
  const w = crmWorld(t), { db, users } = w;
  const oppId = w.opportunity();
  let refused = caught(() => w.oppAct('employee', oppId, 'win', { note: 'موافقة العميل التجريبية بالبريد' }));
  assert.equal(refused.code, 'contract_required');
  assert.equal(refused.details.refusal.missing[0].doc_key, 'deal');
  const deal = w.openCase(oppId).id;
  refused = caught(() => w.oppAct('employee', oppId, 'win', {}));
  assert.equal(refused.code, 'contract_required');
  assert.deepEqual(refused.details.refusal.missing.map(m => m.doc_key), ['qualification_approval', 'approved_quote', 'registered_agreement']);
  assert.equal(refused.details.refusal.missing[0].owner, users.manager.name, 'the pending qualification names the manager who decides it');
  w.act('manager', deal, 'approve_qualification', { note: 'الاحتياج والميزانية مراجعان' });
  w.act('employee', deal, 'save_quote', boundQuote(db, deal, quoteInput()));
  w.act('employee', deal, 'submit_quote');
  w.act('manager', deal, 'approve_quote', { note: 'العرض مراجع' });
  refused = caught(() => w.oppAct('employee', oppId, 'win', {}));
  assert.deepEqual(refused.details.refusal.missing.map(m => m.doc_key), ['registered_agreement']);
  // الطبقة الأخيرة في القاعدة: حتى كتابة مباشرة لا تفوز بفرصة بلا اتفاق.
  assert.throws(() => db.prepare("UPDATE opportunities SET status='won',closed_on='2026-10-01',closed_by='employee',version=version+1 WHERE id=?").run(oppId), /contracted deal/);
  w.act('employee', deal, 'register_contract', { agreement_evidence: 'محضر اتفاق تجريبي موقّع ومحفوظ', customer_representative: 'ممثل عميل تجريبي' });
  w.oppAct('employee', oppId, 'win', {});
  assert.equal(w.opp(oppId).status, 'won');
  assert.match(w.opp(oppId).close_note, /اتفاق/);
  assert.ok(verifyAudit(db));
});
function quoteInput() {
  return { scope: 'حملة إطلاق تجريبية: هوية الحملة وعشرة منشورات', currency: 'SAR', valid_until: '2099-12-01', lines: [
    { description: 'هوية الحملة التجريبية', quantity: '1', unit_price: '40000.00', unit_cost: '15000.00', discount: '0', tax_rate: '15', acceptance: 'اعتماد العميل الكتابي للهوية التجريبية', revisions: 3 },
    { description: 'منشور تجريبي مصمم', quantity: '10', unit_price: '4000.00', unit_cost: '1500.00', discount: '0', tax_rate: '15', acceptance: 'مطابقة الموجز ودليل الهوية', revisions: 2 }] };
}

test('CRM-09: the BD-04 handover is derived from the deal, its agreement and the accepted quote — client, value, services, deliverables, milestones, contacts and payment terms are never typed again', t => {
  const w = crmWorld(t), { db, users, tx, client } = w;
  const oppId = w.opportunity();
  const deal = w.openCase(oppId).id;
  w.contract(deal);
  tx(() => projectAxes.recordPaymentTerms(db, users.employee, deal, TERMS));
  w.oppAct('employee', oppId, 'win', {});
  w.act('manager', deal, 'create_project', { member_ids: ['pm1'] });
  const projectId = w.kase(deal).project_id;
  const source = projectIntake.handoverSource(db, users.employee, projectId);
  assert.equal(source.derived, true);
  // القارئ لعضو المشروع في كيانه وحده.
  assert.equal(caught(() => projectIntake.handoverSource(db, users.external, projectId)).code, 'project_not_found');
  assert.equal(caught(() => projectIntake.handoverSource(db, users.outsider, projectId)).code, 'project_not_found');
  assert.deepEqual([source.case_id, source.client.id, source.contract_value_minor, source.currency, source.advance_minor], [deal, client, 9200000, 'SAR', 0]);
  assert.deepEqual(source.services, ['هوية الحملة التجريبية', 'منشور تجريبي مصمم']);
  assert.deepEqual(source.deliverables.map(d => [d.name, d.quantity, d.revision_rounds, d.rounds_source]), [['هوية الحملة التجريبية', 1, 3, 'contract'], ['منشور تجريبي مصمم', 10, 2, 'contract']]);
  assert.deepEqual(source.milestones.map(m => [m.name, m.due_on]), [['دفعة تجريبية عند اعتماد الهوية', '2099-10-15'], ['دفعة تجريبية عند إطلاق الحملة', '2099-11-15']]);
  assert.deepEqual(source.payment_terms.map(p => p.amount_minor), [4600000, 4600000]);
  assert.deepEqual(source.client_contacts.map(c => c.name), ['ممثلة عميل تجريبية']);
  assert.deepEqual(source.input_fields, ['project_id', 'project_manager_id', 'contract_signed_on', 'kickoff_planned_on', 'channels', 'timeline_start', 'timeline_end', 'advance_claimed_on', 'primary_contact_id', 'risks', 'special_requirements']);
  // حقل مشتق يُكتب في الطلب: مرفوض باسمه، لا يُتجاهل بصمت.
  for (const extra of [{ client_id: client }, { contract_value: '92000.00' }, { deliverables: [] }, { services: ['خدمة مكتوبة'] }, { payment_terms: [] }, { client_contacts: [] }, { milestones: [] }]) {
    const refused = caught(() => tx(() => projectIntake.createHandover(db, users.employee, { ...HANDOVER(projectId), ...extra })));
    assert.equal(refused.code, 'derived_field', JSON.stringify(Object.keys(extra)));
  }
  // الجدول الزمني مدخل، ومواعيد الاتفاق داخله: موعد دفعة قبل بداية الجدول يُرفض باسمه.
  const early = caught(() => tx(() => projectIntake.createHandover(db, users.employee, { ...HANDOVER(projectId), timeline_start: '2099-10-20' })));
  assert.equal(early.code, 'milestones');
  assert.match(early.message, /2099-10-15/);
  const handoverId = tx(() => projectIntake.createHandover(db, users.employee, HANDOVER(projectId))).id;
  const row = db.prepare('SELECT * FROM project_handovers WHERE id=?').get(handoverId);
  assert.deepEqual([row.client_id, row.contract_value_minor, row.advance_minor, row.project_manager_id], [client, 9200000, 0, 'pm1']);
  assert.deepEqual(JSON.parse(row.services), source.services);
  assert.deepEqual(JSON.parse(row.milestones).map(m => m.due_on), ['2099-10-15', '2099-11-15']);
  assert.deepEqual(JSON.parse(row.client_contacts).map(c => [c.name, c.is_primary]), [['ممثلة عميل تجريبية', true]]);
  assert.match(row.contract_reference, /العرض المعتمد رقم 1/);
  const deliverables = db.prepare('SELECT name,quantity,acceptance,revision_rounds,rounds_source,rounds_basis FROM project_deliverables WHERE handover_id=? ORDER BY position').all(handoverId);
  assert.deepEqual(deliverables.map(d => [d.name, d.quantity, d.revision_rounds, d.rounds_source]), [['هوية الحملة التجريبية', 1, 3, 'contract'], ['منشور تجريبي مصمم', 10, 2, 'contract']]);
  assert.equal(deliverables[0].acceptance, 'اعتماد العميل الكتابي للهوية التجريبية');
  assert.match(deliverables[1].rounds_basis, /البند 2/);
  const terms = db.prepare('SELECT label,amount_minor,due_on,condition,is_advance FROM handover_payment_terms WHERE handover_id=? ORDER BY position').all(handoverId);
  assert.deepEqual(terms.map(r => [r.amount_minor, r.due_on, r.is_advance]), [[4600000, '2099-10-15', 0], [4600000, '2099-11-15', 0]]);
  assert.match(terms[1].condition, /2099-11-15/, 'an empty condition on the schedule is stated as its due date, not invented');
  const event = db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='intake.handover_prepared'").get(handoverId);
  assert.equal(JSON.parse(event.after_json).derived_from.case_id, deal);
  // مشروع بلا صفقة يبقى على النموذج المكتوب كما كان.
  const plain = tx(() => createProject(db, users.manager, { name: 'مشروع تجريبي بلا صفقة', brief: 'موجز تجريبي لمشروع داخلي', member_ids: [] })).id;
  const typed = projectIntake.handoverSource(db, users.manager, plain);
  assert.equal(typed.derived, false);
  assert.ok(typed.input_fields.includes('client_id') && typed.input_fields.includes('deliverables'));
  assert.ok(verifyAudit(db));
});

test('CRM-09: the handover refuses what the deal does not hold yet — no payment schedule, or a schedule that does not add up to the agreement', t => {
  const w = crmWorld(t), { db, users, tx } = w;
  const oppId = w.opportunity();
  const deal = w.openCase(oppId).id;
  w.contract(deal);
  w.oppAct('employee', oppId, 'win', {});
  w.act('manager', deal, 'create_project', { member_ids: ['pm1'] });
  const projectId = w.kase(deal).project_id;
  const none = caught(() => tx(() => projectIntake.createHandover(db, users.employee, HANDOVER(projectId))));
  assert.equal(none.code, 'payment_terms_required');
  assert.equal(none.details.refusal.missing[0].owner, users.employee.name);
  // منذ الترحيل 183 الجدول الناقص لا يُسجَّل أصلًا: مجموعه قيمة الاتفاق أو يُرفض عند تسجيله، فيبقى النموذج على «ما عليها جدول».
  // (حارس payment_terms_mismatch في نموذج التسليم باقٍ للجداول المسجّلة قبل 183.)
  assert.equal(caught(() => tx(() => projectAxes.recordPaymentTerms(db, users.employee, deal, { requires_client_po: false,
    terms: [{ label: 'دفعة تجريبية ناقصة', amount: '1000.00', due_on: '2099-10-15', condition: 'شرط تجريبي', condition_kind: 'acceptance', condition_lines: [0] }] }))).code, 'terms_total_mismatch');
  assert.equal(caught(() => tx(() => projectIntake.createHandover(db, users.employee, HANDOVER(projectId)))).code, 'payment_terms_required');
  assert.ok(verifyAudit(db));
});

test('CRM-09: double and concurrent conversion yields exactly one deal — in one process, with one idempotency key, and across four processes racing on one database file', { timeout: 240000 }, async t => {
  const w = crmWorld(t), { db, users, tx } = w;
  const first = w.opportunity();
  const deal = w.openCase(first).id;
  const again = caught(() => w.openCase(first));
  assert.equal(again.code, 'already_converted');
  assert.match(again.details.refusal.missing[0].document, new RegExp(deal.slice(0, 8).toUpperCase()));
  const keyed = w.opportunity({ name: 'فرصة تجريبية بمفتاح تكرار' });
  const input = { version: w.opp(keyed).version }, operation = `/api/pipeline/opportunities/${keyed}/open_case`;
  const once = () => tx(() => createOnce(db, users.employee, operation, 'crm_conversion_key_0001', input, () => commercial.createCaseFromOpportunity(db, users.employee, keyed, input), id => ({ id })));
  assert.equal(once().id, once().id, 'the same key returns the same deal');
  // سباق حقيقي: أربع عمليات على ملف واحد في اللحظة نفسها.
  const raceOpp = [w.opportunity({ name: 'فرصة تجريبية للسباق الأول' }), w.opportunity({ name: 'فرصة تجريبية للسباق الثاني' })];
  const versions = raceOpp.map(id => w.opp(id).version);
  const dir = mkdtempSync(join(tmpdir(), '36t-crm-race-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'race.sqlite');
  db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  const keeper = openDb(path); t.after(() => keeper.close());
  const race = jobs => { const startAt = Date.now() + 2500; return Promise.all(jobs.map((job, index) => new Promise(done => {
    const child = spawn(process.execPath, [WORKER, path, String(startAt), JSON.stringify({ ...job, index })], { cwd: ROOT });
    let out = '', err = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { err += c; });
    child.on('close', () => { try { done(JSON.parse(out.trim().split('\n').pop())); } catch { done({ index, ok: false, error: 'no output: ' + err.slice(0, 300) }); } });
  }))); };
  const distinct = await race(Array.from({ length: 4 }, () => ({ user: 'employee', opportunity_id: raceOpp[0], version: versions[0] })));
  assert.equal(distinct.filter(r => r.ok).length, 1, JSON.stringify(distinct));
  assert.deepEqual([...new Set(distinct.filter(r => !r.ok).map(r => r.error))], ['already_converted']);
  const sameKey = await race(Array.from({ length: 4 }, () => ({ user: 'employee', opportunity_id: raceOpp[1], version: versions[1], key: 'crm_race_same_key_0001' })));
  assert.equal(sameKey.filter(r => r.ok).length, 4, JSON.stringify(sameKey));
  assert.equal(new Set(sameKey.map(r => r.id)).size, 1, 'one key, one deal');
  for (const id of raceOpp) {
    assert.equal(keeper.prepare('SELECT COUNT(*) AS n FROM commercial_cases WHERE opportunity_id=?').get(id).n, 1);
    const linked = keeper.prepare('SELECT case_id FROM opportunities WHERE id=?').get(id).case_id;
    assert.equal(keeper.prepare('SELECT COUNT(*) AS n FROM client_links WHERE case_id=?').get(linked).n, 1);
  }
  assert.equal(verifyAudit(keeper), true, 'the audit chain did not fork under concurrent writers');
});

test('CRM-09: lost, cross-client and cross-tenant conversions are refused — in the code and in the database', t => {
  const w = crmWorld(t), { db, users, tx, client, reasons } = w;
  const lost = w.opportunity({ name: 'فرصة تجريبية خاسرة' });
  w.oppAct('employee', lost, 'lose', { loss_reason_id: reasons.price, comment: 'خسرنا الفرصة التجريبية قبل فتح صفقتها' });
  assert.equal(caught(() => w.openCase(lost)).code, 'opportunity_closed');
  // صفقة خاسرة: فرصتها خاسرة معها، فلا فوز ولا تحويل ثانٍ.
  const opp = w.opportunity({ name: 'فرصة تجريبية تُخسر صفقتها' });
  const deal = w.openCase(opp).id;
  w.act('employee', deal, 'close_lost', { reason_id: reasons.price, comment: 'اختار العميل التجريبي عرضًا آخر' });
  assert.equal(w.opp(opp).status, 'lost');
  assert.equal(caught(() => w.oppAct('employee', opp, 'win', {})).code, 'action_unavailable');
  // عزل الكيان: موظف الكيان المعزول لا يحوّل فرصة هنا ولا يقرأ مصدر تسليمها.
  const mine = w.opportunity({ name: 'فرصة تجريبية للعزل' });
  assert.equal(caught(() => tx(() => commercial.createCaseFromOpportunity(db, users.external, mine, { version: w.opp(mine).version }))).code, 'not_found');
  // عضو في الفريق ليس صاحب الفرصة ولا مالك ملف العميل: لا يفتح صفقة غيره.
  assert.equal(caught(() => tx(() => commercial.createCaseFromOpportunity(db, users.manager, mine, { version: w.opp(mine).version }))).code, 'not_permitted');
  // القاعدة نفسها: صفقة بفرصة عميل آخر، وفرصة تشير إلى صفقة ليست صفقتها، مرفوضتان مهما كان الكاتب.
  const otherClient = tx(() => db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at) VALUES('syn-other-client','36t','C-0999','عميل تجريبي آخر','','تجريبي','active','outsider','','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z') RETURNING id").get().id);
  assert.throws(() => db.prepare("INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,created_at,updated_at,client_id,opportunity_id) VALUES('syn-cross','36t','creative','employee','x','SYN-X','x','x','x','lead','2026-10-01','2026-10-01',?,?)").run(otherClient, mine), /customer of its opportunity/);
  const converted = w.openCase(mine).id;
  const sibling = w.opportunity({ name: 'فرصة تجريبية شقيقة' });
  assert.throws(() => db.prepare('UPDATE opportunities SET case_id=?,version=version+1 WHERE id=?').run(converted, sibling), /links once|UNIQUE/);
  assert.throws(() => db.prepare('UPDATE opportunities SET case_id=NULL,version=version+1 WHERE id=?').run(mine), /links once/);
  assert.equal(client, w.kase(converted).client_id);
  assert.ok(verifyAudit(db));
});

test('handoffs notify: a deal opened by the account owner reaches its owner and the manager who decides the qualification, and a win reaches the account team', t => {
  const w = crmWorld(t), { db, users } = w;
  const oppId = w.opportunity();
  const notes = user => db.prepare('SELECT kind,subject_kind,title FROM notifications WHERE user_id=? ORDER BY created_at').all(user);
  const deal = w.openCase(oppId, 'outsider').id;
  assert.equal(w.kase(deal).owner_id, 'employee', 'the deal belongs to the opportunity owner, whoever opened it');
  assert.ok(notes('employee').some(n => n.kind === 'deal_opened_from_opportunity' && n.subject_kind === 'commercial_case'));
  assert.ok(notes('manager').some(n => n.kind === 'commercial_qualification_needed'));
  assert.ok(!notes('outsider').some(n => n.kind === 'deal_opened_from_opportunity'), 'the actor is not notified of their own act');
  w.contract(deal);
  w.oppAct('employee', oppId, 'win', {});
  for (const member of ['outsider', 'manager']) assert.ok(notes(member).some(n => n.kind === 'opportunity_won' && n.subject_kind === 'opportunity'), member);
  assert.ok(!notes('employee').some(n => n.kind === 'opportunity_won'));
  assert.ok(verifyAudit(db));
});

test('routes: opening a deal is wrapped in the idempotency helper, and the two new readers answer their own tenant only', async t => {
  const w = crmWorld(t), { db } = w;
  const oppId = w.opportunity();
  const app = createApp(db);
  const { sessions, call } = await sessionsFor(app, ['employee', 'external']);
  const post = (who, path, body, key) => dispatch(app, { method: 'POST', path: '/api' + path, body,
    headers: { cookie: sessions[who].cookie, 'x-csrf-token': sessions[who].csrf, ...(key ? { 'idempotency-key': key } : {}) } });
  const path = `/pipeline/opportunities/${oppId}/open_case`, body = { version: w.opp(oppId).version };
  assert.equal((await post('employee', path, body)).status, 400, 'no key, no conversion');
  const first = await post('employee', path, body, 'route_open_case_key_0001');
  assert.equal(first.status, 201, first.text);
  const repeat = await post('employee', path, body, 'route_open_case_key_0001');
  assert.equal(repeat.status, 201, repeat.text);
  assert.equal(repeat.json().id, first.json().id, 'a retried request returns the same deal');
  const other = await post('employee', path, { version: w.opp(oppId).version }, 'route_open_case_key_0002');
  assert.equal(other.status, 409);
  assert.equal(other.json().error.code, 'already_converted');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commercial_cases WHERE opportunity_id=?').get(oppId).n, 1);
  const conflicts = await call('employee', '/clients/conflicts?registration_number=7001700170');
  assert.equal(conflicts.status, 200, conflicts.text);
  assert.equal(conflicts.json().conflicts.length, 1);
  assert.equal((await call('employee', '/clients/conflicts')).status, 200, 'an empty question is answered, not crashed');
  assert.equal((await call('external', '/clients/conflicts?registration_number=7001700170')).status, 403);
  const caseId = first.json().id;
  w.contract(caseId);
  w.oppAct('employee', oppId, 'win', {});
  w.act('manager', caseId, 'create_project', { member_ids: ['pm1'] });
  const projectId = w.kase(caseId).project_id;
  const source = await call('employee', `/project-intake/handover-source/${projectId}`);
  assert.equal(source.status, 200, source.text);
  assert.equal(source.json().derived, true);
  assert.equal((await call('external', `/project-intake/handover-source/${projectId}`)).status, 404);
});
