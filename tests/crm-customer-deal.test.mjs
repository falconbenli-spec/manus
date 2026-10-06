// P4-CRM-1 — العميل غير الصفقة (القرار D1). العميل صفُّ clients ويحمل رقم سجله؛ الملف التجاري صفقةٌ واحدة له.
// بيانات تجريبية مصطنعة بالكامل (tests/crm-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction, verifyAudit } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import * as agency from '../app/agency.mjs';
import * as commercial from '../app/commercial.mjs';
import * as pipeline from '../app/pipeline-estimates.mjs';
import { adoptionAction } from '../app/options.mjs';
import { crmWorld, code, caught, riyadh, CLIENT } from './crm-fixture.mjs';

const isolatedManager = db => {
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('iso-manager','isolated','other','iso-manager','مدير تجريبي في الكيان المعزول','unused','manager',NULL)").run();
  return db.prepare("SELECT * FROM users WHERE id='iso-manager'").get();
};

test('CRM-01: a spelling variant or a known registration number is refused before saving, and the refusal names the existing file and its owner', t => {
  const { db, users, tx, client } = crmWorld(t);
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, before = count();
  const create = input => tx(() => agency.createClient(db, users.outsider, { sector: 'التجزئة', status: 'prospect', ...input }));
  for (const variant of ['شركه الافق التجريبيه للتجزئه', 'الأفق التجريبية للتجزئة', 'شركة الأُفُق التجريبيـة للتجزئة', '  شركة   الأفق التجريبية للتجزئة.']) {
    const refused = caught(() => create({ legal_name: variant }));
    assert.equal(refused.code, 'duplicate_client', variant);
    assert.equal(refused.status, 409);
    assert.match(refused.details.refusal.missing[0].document, /C-0001/, 'the refusal names the file that already exists');
  }
  // رقم السجل نفسه باسم مختلف تمامًا، وبأرقام عربية هندية ومسافات.
  assert.equal(caught(() => create({ legal_name: 'جهة تجريبية باسم مختلف', registration_number: '٧٠٠١ ٧٠٠ ١٧٠' })).code, 'duplicate_client');
  assert.equal(count(), before, 'nothing was saved');
  // اسمان متقاربان برقمي سجل مختلفين معلومين: كيانان مختلفان يثبتهما الرقم، فلا تعارض.
  const sister = create({ legal_name: 'مؤسسة الأفق التجريبية للتجزئة', registration_number: '7001700999' }).id;
  assert.equal(db.prepare('SELECT registration_number FROM clients WHERE id=?').get(sister).registration_number, '7001700999');
  // القارئ نفسه يُسأل قبل الحفظ، ويسمّي الملف ومالكه دون أن يكشف اسم عميل ليس في فريق السائل.
  // بلا رقم سجل في السؤال لا يثبت أن الاسم لجهة ثالثة: الملفان المتقاربان كلاهما تعارض. المدير في فريق الأول لا الثاني.
  const found = agency.clientConflicts(db, users.manager, { legal_name: 'شركة الافق التجريبيه للتجزئه' });
  assert.deepEqual(found.conflicts.map(c => c.code).sort(), ['C-0001', 'C-0002']);
  const [mine, other] = ['C-0001', 'C-0002'].map(value => found.conflicts.find(c => c.code === value));
  assert.ok(mine.reasons.includes('legal_name'));
  assert.equal(mine.owner_name, users.outsider.name);
  assert.equal(mine.name, CLIENT.legal_name);
  assert.equal(other.owner_name, users.outsider.name, 'the owner is named so the reader knows whom to ask');
  assert.equal(other.name, undefined, 'the name of a client outside the reader’s team is not shown');
  assert.equal(other.client_id, undefined);
  assert.equal(agency.clientConflicts(db, users.manager, { registration_number: '7001700170' }).conflicts[0].client_id, client);
  assert.ok(verifyAudit(db));
});

test('CRM-01: how many typing slips still make two names one customer is the owner’s number — until it is adopted by two people, only names equal after normalization conflict', t => {
  const { db, users, tx } = crmWorld(t);
  const typo = { legal_name: 'شركة الأفق التجريبية للتجزي' };
  assert.deepEqual(agency.clientConflicts(db, users.outsider, typo).conflicts, [], 'no number invented: a one-letter slip is not matched yet');
  assert.equal(agency.clientConflicts(db, users.outsider, typo).name_edits, 0);
  tx(() => adoptionAction(db, users.outsider, agency.NAME_EDITS, 'record', { value: { max_edits: 1 }, basis: 'قرار تجريبي: خطأ حرف واحد في اسم العميل يعني الجهة نفسها', effective_from: riyadh(-1) }));
  assert.deepEqual(agency.clientConflicts(db, users.outsider, typo).conflicts, [], 'recorded is not adopted: a second person approves first');
  const pending = db.prepare('SELECT id FROM option_adoptions WHERE key=? AND approved_by IS NULL').get(agency.NAME_EDITS).id;
  assert.equal(caught(() => tx(() => adoptionAction(db, users.outsider, agency.NAME_EDITS, 'approve', { adoption_id: pending, note: 'اعتماد ذاتي تجريبي مرفوض' }))).code, 'separation_of_duties');
  tx(() => adoptionAction(db, users.manager, agency.NAME_EDITS, 'approve', { adoption_id: pending, note: 'اعتماد تجريبي من شخص ثانٍ' }));
  const found = agency.clientConflicts(db, users.outsider, typo);
  assert.equal(found.name_edits, 1);
  assert.deepEqual(found.conflicts.map(c => c.code), ['C-0001']);
  assert.equal(caught(() => tx(() => agency.createClient(db, users.outsider, { ...typo, sector: 'التجزئة', status: 'prospect' }))).code, 'duplicate_client');
  assert.ok(verifyAudit(db));
});

test('CRM-01: the registration number lives on the client — recorded by the account owner, unique per tenant, and fixed once a deal carries it', t => {
  const { db, users, tx, client } = crmWorld(t);
  const bare = tx(() => agency.createClient(db, users.outsider, { legal_name: 'عميل تجريبي بلا رقم سجل', sector: 'الصحة', status: 'prospect' })).id;
  assert.throws(() => tx(() => agency.clientAction(db, users.employee, bare, 'set_registration', { registration_number: '7002700270' })), code('not_found'), 'not in the team');
  tx(() => agency.clientAction(db, users.outsider, bare, 'add_member', { user_id: 'employee', role: 'عضو تجريبي' }));
  assert.throws(() => tx(() => agency.clientAction(db, users.employee, bare, 'set_registration', { registration_number: '7002700270' })), code('forbidden'), 'only the account owner records it');
  assert.throws(() => tx(() => agency.clientAction(db, users.outsider, bare, 'set_registration', { registration_number: '7001700170' })), code('duplicate_client'));
  tx(() => agency.clientAction(db, users.outsider, bare, 'set_registration', { registration_number: ' 7002-700270 ' }));
  assert.equal(db.prepare('SELECT registration_number FROM clients WHERE id=?').get(bare).registration_number, '7002-700270');
  // صفقة على العميل الأول تثبّت رقمه.
  tx(() => commercial.createLead(db, users.employee, { client_id: client, source: 'زيارة تجريبية' }));
  assert.equal(caught(() => tx(() => agency.clientAction(db, users.outsider, client, 'set_registration', { registration_number: '7001700171' }))).code, 'registration_fixed');
  // العزل: كيان آخر يسجّل الرقم نفسه لعميله، ولا يرى تعارضًا مع عميل كيان غيره.
  const iso = isolatedManager(db);
  assert.deepEqual(agency.clientConflicts(db, iso, { registration_number: '7001700170', legal_name: CLIENT.legal_name }).conflicts, []);
  const isoClient = tx(() => agency.createClient(db, iso, { legal_name: CLIENT.legal_name, sector: 'التجزئة', status: 'prospect', registration_number: '7001700170' })).id;
  assert.equal(db.prepare('SELECT tenant_id FROM clients WHERE id=?').get(isoClient).tenant_id, 'isolated');
  assert.ok(verifyAudit(db));
});

test('D1: a deal is opened from the client file — the customer fields come from the file, a second deal for the same registration number opens, and the renewal names its predecessor', t => {
  const { db, users, tx, client } = crmWorld(t);
  const first = tx(() => commercial.createLead(db, users.employee, { client_id: client, source: 'زيارة تجريبية' }));
  assert.equal(first.client_id, client);
  assert.equal(first.name, CLIENT.legal_name);
  assert.equal(first.registration_number, '7001700170');
  assert.equal(first.sector, CLIENT.sector);
  assert.match(first.contact, /ممثلة عميل تجريبية/, 'the contact comes from the client file');
  assert.equal(db.prepare('SELECT client_id FROM client_links WHERE case_id=?').get(first.id).client_id, client, 'the readers that join client_links see the deal');
  // صفقة ثانية لنفس السجل: كانت ترفض «رقم السجل مستخدم في ملف قائم».
  const second = tx(() => commercial.createLead(db, users.employee, { client_id: client, source: 'تجديد تجريبي', predecessor_case_id: first.id }));
  assert.equal(second.predecessor_case_id, first.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commercial_cases WHERE client_id=? AND registration_number=?').get(client, '7001700170').n, 2);
  // ما يأتي من ملف العميل لا يُكتب مرة ثانية.
  const typed = caught(() => tx(() => commercial.createLead(db, users.employee, { client_id: client, source: 'تجريبي', name: 'اسم مكتوب', registration_number: '7001700170' })));
  assert.equal(typed.code, 'client_field_from_file');
  // عميل بلا رقم سجل: الرفض يسمّي الناقص ومالكه.
  const bare = tx(() => agency.createClient(db, users.outsider, { legal_name: 'عميل تجريبي آخر بلا رقم', sector: 'الصحة', status: 'prospect' })).id;
  tx(() => agency.clientAction(db, users.outsider, bare, 'add_member', { user_id: 'employee', role: 'عضو تجريبي' }));
  const missing = caught(() => tx(() => commercial.createLead(db, users.employee, { client_id: bare, source: 'تجريبي', contact: 'جهة تجريبية' })));
  assert.equal(missing.code, 'registration_required');
  assert.equal(missing.details.refusal.missing[0].owner, users.outsider.name);
  // السابقة لعميل آخر مرفوضة، وعميل خارج فريقي غير متاح.
  tx(() => agency.clientAction(db, users.outsider, bare, 'set_registration', { registration_number: '7003700370' }));
  assert.equal(caught(() => tx(() => commercial.createLead(db, users.employee, { client_id: bare, source: 'تجريبي', contact: 'جهة تجريبية', predecessor_case_id: first.id }))).code, 'predecessor_other_customer');
  const foreign = tx(() => agency.createClient(db, users.outsider, { legal_name: 'عميل تجريبي خارج فريق الموظفة', sector: 'الصحة', status: 'prospect', registration_number: '7004700470' })).id;
  assert.equal(caught(() => tx(() => commercial.createLead(db, users.employee, { client_id: foreign, source: 'تجريبي', contact: 'جهة' }))).code, 'not_found');
  // المسار القديم بلا ملف عميل: رقم سجل يملكه عميل يُرد إلى ملفه.
  const legacy = caught(() => tx(() => commercial.createLead(db, users.employee, { name: 'جهة مكتوبة', registration_number: '7001700170', contact: 'جهة', source: 'تجريبي', sector: 'تجريبي' })));
  assert.equal(legacy.code, 'customer_has_file');
  assert.match(legacy.details.refusal.missing[0].document, /C-0001/);
  assert.ok(verifyAudit(db));
});

test('D1: a legacy deal linked to a client file takes that client as its customer, once', t => {
  const { db, users, tx, client } = crmWorld(t);
  const legacy = tx(() => commercial.createLead(db, users.employee, { name: 'جهة تجريبية قديمة', registration_number: 'SYN-LEGACY-1', contact: 'جهة', source: 'تجريبي', sector: 'تجريبي' }));
  assert.equal(legacy.client_id, null);
  assert.equal(caught(() => tx(() => commercial.createLead(db, users.employee, { name: 'جهة ثانية', registration_number: 'syn-legacy-1', contact: 'جهة', source: 'تجريبي', sector: 'تجريبي' }))).code, 'duplicate_registration');
  // link_case قائم منذ 033: يربط مالكُ ملف العميل صفقةً يملكها. الموظفة هنا تملك الاثنين.
  tx(() => grantAccess(db, users.admin, { user_id: 'employee', capability: 'clients.manage', department_id: '', note: 'منح تجريبي لربط صفقة قديمة' }));
  const own = tx(() => agency.createClient(db, users.employee, { legal_name: 'عميل تجريبي لربط صفقة قديمة', sector: 'تجريبي', status: 'active' })).id;
  tx(() => agency.clientAction(db, users.employee, own, 'link_case', { case_id: legacy.id }));
  assert.equal(db.prepare('SELECT client_id FROM commercial_cases WHERE id=?').get(legacy.id).client_id, own);
  assert.throws(() => db.prepare('UPDATE commercial_cases SET client_id=?,version=version+1 WHERE id=?').run(client, legacy.id), /keeps its customer/);
  assert.ok(verifyAudit(db));
});

test('CRM-10: a deal is closed lost or withdrawn with a reason from the managed list and a written lesson — final, and its open opportunity closes lost with it', t => {
  const { db, users, tx, client, reasons, opportunity, opp, kase, act, openCase, contract } = crmWorld(t);
  const deal = tx(() => commercial.createLead(db, users.employee, { client_id: client, source: 'تجريبي' }));
  assert.ok(commercial.listCommercial(db, users.employee).find(c => c.id === deal.id).allowed_actions.includes('close_lost'));
  assert.equal(caught(() => act('employee', deal.id, 'close_lost', { reason_id: 'unknown', comment: 'خسرناها بسبب السعر التجريبي' })).code, 'loss_reason_required');
  assert.equal(caught(() => act('employee', deal.id, 'close_lost', { reason_id: reasons.price, comment: 'قصير' })).code, 'invalid_text');
  assert.equal(caught(() => act('manager', deal.id, 'close_lost', { reason_id: reasons.price, comment: 'المدير ليس صاحب الصفقة' })).code, 'commercial_transition');
  const lost = act('employee', deal.id, 'close_lost', { reason_id: reasons.price, comment: 'اختار العميل عرضًا تجريبيًا أرخص بفارق كبير' });
  assert.equal(lost.status, 'lost');
  assert.equal(lost.closure.reason_code, 'PRICE');
  assert.deepEqual(lost.allowed_actions, [], 'a lost deal is final');
  assert.throws(() => act('employee', deal.id, 'qualify', {}), code('commercial_transition'));
  // صفقة من فرصة: سحبها يغلق الفرصة خاسرة بالسبب نفسه، فلا تبقى فرصة مفتوحة على صفقة منتهية.
  const oppId = opportunity();
  const fromOpp = openCase(oppId).id;
  const withdrawn = act('employee', fromOpp, 'withdraw', { reason_id: reasons.capacity, comment: 'لا طاقة تجريبية لدينا في موعد العميل' });
  assert.equal(withdrawn.status, 'withdrawn');
  assert.deepEqual([opp(oppId).status, opp(oppId).loss_reason_id], ['lost', reasons.capacity]);
  assert.match(opp(oppId).loss_comment, /لا طاقة تجريبية/);
  // والعكس: خسارة الفرصة تغلق صفقتها التي لم يُتعاقد عليها.
  const oppTwo = opportunity({ name: 'فرصة تجريبية ثانية' });
  const dealTwo = openCase(oppTwo).id;
  tx(() => pipeline.opportunityAction(db, users.employee, oppTwo, 'lose', { version: opp(oppTwo).version, loss_reason_id: reasons.price, comment: 'خسرنا الفرصة التجريبية الثانية بالسعر' }));
  assert.equal(kase(dealTwo).status, 'lost');
  // المتعاقد عليها لا تُخسر، وفرصتها لا تُغلق خاسرة.
  const oppThree = opportunity({ name: 'فرصة تجريبية ثالثة' });
  const dealThree = openCase(oppThree).id;
  contract(dealThree);
  assert.ok(!commercial.listCommercial(db, users.employee).find(c => c.id === dealThree).allowed_actions.includes('close_lost'));
  assert.equal(caught(() => tx(() => pipeline.opportunityAction(db, users.employee, oppThree, 'lose', { version: opp(oppThree).version, loss_reason_id: reasons.price, comment: 'محاولة إغلاق فرصة متعاقد عليها' }))).code, 'deal_contracted');
  const events = db.prepare("SELECT action FROM audit_events WHERE entity_id IN (?,?) ORDER BY seq").all(fromOpp, oppId).map(r => r.action);
  assert.ok(events.includes('withdraw') && events.includes('opportunity.lose'), JSON.stringify(events));
  assert.ok(verifyAudit(db));
});

test('isolation: a reader in another tenant sees no deal, no client conflict and no deal summary from this tenant', t => {
  const { db, users, tx, client } = crmWorld(t);
  const deal = tx(() => commercial.createLead(db, users.employee, { client_id: client, source: 'تجريبي' }));
  const iso = isolatedManager(db);
  assert.equal(commercial.listCommercial(db, users.external).length, 0);
  assert.equal(caught(() => commercial.dealSummary(db, users.external, deal.id)).code, 'not_found');
  assert.equal(caught(() => commercial.dealSummary(db, iso, deal.id)).code, 'not_found');
  assert.deepEqual(agency.clientConflicts(db, iso, { registration_number: '7001700170' }).conflicts, []);
  assert.equal(commercial.dealSummary(db, users.employee, deal.id).client.id, client);
  assert.equal(caught(() => tx(() => commercial.createLead(db, iso, { client_id: client, source: 'تجريبي', contact: 'جهة' }))).code, 'not_found');
});
