// P4-CRM-3 — عرض الصفقة المعتمد وسلطة الهامش (الترحيل 182، القرار D2: عرض سعر العميل FRM-024 هو المستند المُلزِم).
// السعر لا يخرج إلا بسلطة من يملك إعطاءه، والاتفاق لا يتجاوز ما قبله العميل.
// الأدوار: employee صاحب الصفقة ومعد التسعير ومُصدر العرض (procurement.use)، manager المدير المباشر ومقعدا EPMO ونائب الرئيس،
// outsider مسؤول ملف العميل ومقعدا الإدارة الطالبة والمالية، ceo1 صاحب استثناء التسعير وسياساته. بيانات تجريبية مصطنعة بالكامل.
import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction, verifyAudit } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import * as agency from '../app/agency.mjs';
import * as commercial from '../app/commercial.mjs';
import * as projectAxes from '../app/project-axes.mjs';
import * as projectIntake from '../app/project-intake.mjs';
import * as receivables from '../app/receivables.mjs';
import * as contracts from '../app/contracts-register.mjs';
import * as billing from '../app/billing-recurring.mjs';
import { preparePriceCard, priceCardAction } from '../app/estimates.mjs';
import { preparePolicy, policyAction, prepareIssuerDecision, issuerDecisionAction, saveSheet, sheetAction, requestMarginException,
  marginExceptionAction, createQuotation, quotationAction, pricingBoard, APPROVAL_SEATS } from '../app/pricing.mjs';
import { crmWorld, caught, riyadh, QUOTE, CONTRACT } from './crm-fixture.mjs';
import { boundQuote, proposalFor, approverFor } from './proposal-fixture.mjs';

// ورقتان تعطيان نسخة عرض الصفقة نفسها (92,000.00 شاملة 15%): الأولى على الهامش المستهدف 20% تمامًا، والثانية بخصم يُنزل الهامش إلى 15%.
const AT_TARGET = { lines: [{ cost_group: 'internal_team', description: 'فريق داخلي تجريبي', basis: 'quantity', quantity: '1', unit_price: '58181.82', cost_reference_kind: '', cost_reference_id: '', note: '' }], discount: '', discount_basis: '' };
const BELOW_TARGET = { lines: [{ cost_group: 'internal_team', description: 'فريق داخلي تجريبي', basis: 'quantity', quantity: '1', unit_price: '61818.18', cost_reference_kind: '', cost_reference_id: '', note: '' }],
  discount: '5000.00', discount_basis: 'خصم تجريبي وافق عليه مدير الحساب لدخول الحساب' };

function pricingWorld(w) {
  const { db, users, tx, client } = w;
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('ceo1','36t','creative','ceo1','رئيس تنفيذي تجريبي','unused','manager',NULL)").run();
  users.ceo1 = db.prepare("SELECT * FROM users WHERE id='ceo1'").get();
  tx(() => {
    for (const [user, capability, department] of [['employee', 'pricing.sheets.use', 'creative'], ['employee', 'procurement.use', 'creative'],
      ['outsider', 'pricing.sheets.use', 'creative'], ['outsider', 'finance.use', 'creative'], ['manager', 'pricing.sheets.use', 'creative'],
      ['manager', 'pricing.epmo.approve', 'creative'], ['manager', 'pricing.vp.approve', ''], ['ceo1', 'pricing.sheets.use', 'creative'], ['ceo1', 'pricing.exception.approve', '']])
      grantAccess(db, users.admin, { user_id: user, capability, department_id: department, note: 'منح تجريبي لاختبار سلطة الهامش' });
  });
  tx(() => agency.clientAction(db, users.outsider, client, 'add_member', { user_id: 'ceo1', role: 'رئيس تنفيذي تجريبي' }));
  const version = (table, id) => db.prepare(`SELECT version FROM ${table} WHERE id=?`).get(id).version;
  for (const [key, percent] of [['contingency_rate', '10'], ['target_margin', '20']]) {
    const id = tx(() => preparePolicy(db, users.employee, { policy_key: key, percent, duration: null, source_reference: `نموذج تسعير المشروع التجريبي MOD-BD-02 — ${key}`, basis: 'الرقم كما في النموذج التجريبي', effective_from: riyadh(-1) })).id;
    tx(() => policyAction(db, users.ceo1, id, 'approve_policy', { version: version('pricing_policies', id), note: 'اعتماد تجريبي' }));
  }
  const cardId = tx(() => preparePriceCard(db, users.employee, { client_id: '', name: 'بطاقة أسعار تجريبية عامة', effective_from: riyadh(-1), source: 'قرار تسعير داخلي تجريبي ومرجعه', lines: [{ kind: 'role', name: 'مصمم تجريبي', category_code: '', price: '300.00' }] })).id;
  tx(() => priceCardAction(db, users.manager, cardId, 'approve_card', { version: version('price_cards', cardId), note: 'اعتماد تجريبي' }));
  const decision = tx(() => prepareIssuerDecision(db, users.employee, { chosen_option: 'procurement', basis: 'قرار المالك التجريبي بجهة الإصدار' })).id;
  tx(() => issuerDecisionAction(db, users.ceo1, decision, 'approve_decision', { version: version('pricing_decisions', decision), note: 'حسم تجريبي' }));
  const seat = { requesting_department: users.outsider, procurement_finance: users.outsider, epmo: users.manager, vp_corporate_services: users.manager };
  const sheet = (config, opportunityId = '') => {
    const id = tx(() => saveSheet(db, users.employee, { client_id: client, opportunity_id: opportunityId, name: 'حملة إطلاق تجريبية', scope_note: 'هوية الحملة وعشرة منشورات تجريبية',
      contract_kind: 'one_off', duration_note: 'ثمانية أسابيع', proposed_pm_id: '', review_notes: '', discount: config.discount, discount_basis: config.discount_basis,
      admin_fee_percent: '', admin_fee_basis: '', vat_rate: '15', vat_basis: 'نسبة الضريبة النظامية التجريبية', lines: config.lines })).id;
    tx(() => sheetAction(db, users.employee, id, 'submit', { version: version('pricing_sheets', id) }));
    for (const s of APPROVAL_SEATS) tx(() => sheetAction(db, seat[s.key], id, 'decide', { version: version('pricing_sheets', id), seat: s.key, decision: 'approved', note: 'راجعت البنود واعتمدت' }));
    return id;
  };
  const exception = (sheetId, expiresOn = riyadh(30)) => tx(() => requestMarginException(db, users.employee, sheetId, { justification: 'دخول حساب جديد بعلاقة طويلة متوقعة مع العميل التجريبي',
    applies_to: 'هذا العرض وحده', attachments: [], expires_on: expiresOn })).id;
  const decideException = (id, action = 'approve_exception', who = users.ceo1) => tx(() => marginExceptionAction(db, who, id, action, { version: version('margin_exceptions', id), note: 'قرار تجريبي بعد مراجعة المبرر' }));
  const quotation = sheetId => tx(() => createQuotation(db, users.employee, sheetId, { valid_until: riyadh(30), note: '' })).id;
  const qAct = (id, action, input = {}) => tx(() => quotationAction(db, users.employee, id, action, { version: version('client_quotations', id), ...input }));
  const issue = id => qAct(id, 'issue', { note: 'إصدار تجريبي' });
  const accept = id => qAct(id, 'accept', { reason: 'قبول العميل التجريبي بالبريد' });
  return { sheet, exception, decideException, quotation, qAct, issue, accept };
}
// صفقة من فرصة حتى التأهيل المعتمد.
function qualifiedDeal(w, name = 'حملة إطلاق تجريبية SYN-7182') {
  const oppId = w.opportunity({ name });
  const deal = w.openCase(oppId).id;
  w.act('manager', deal, 'approve_qualification', { note: 'تأهيل تجريبي معتمد' });
  return { oppId, deal };
}

test('D2: the deal quote is saved on the FRM-024 client quotation it equals — unbound, other customer, other deal, expired, total and tax rate are refused by name before anything is written', t => {
  const w = crmWorld(t), { db, users, tx, client } = w;
  const { deal } = qualifiedDeal(w);
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM commercial_quotes').get().n, before = count();
  let refused = caught(() => w.act('employee', deal, 'save_quote', QUOTE()));
  assert.equal(refused.code, 'quotation_required');
  assert.equal(refused.details.refusal.missing[0].doc_key, 'quotation_id');
  // عرض بإجمالي آخر: يُرفض ويسمّي الرقمين.
  const other = QUOTE(); other.lines[0].unit_price = '41000.00';
  refused = caught(() => w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: proposalFor(db, deal, other) }));
  assert.equal(refused.code, 'quotation_total_mismatch');
  assert.match(refused.message, /92,000\.00/);
  assert.match(refused.message, /93,150\.00/);
  // نسبة ضريبة غير نسبة العرض، والإجمالي نفسه: يُرفض.
  const zero = { ...QUOTE(), lines: [{ ...QUOTE().lines[0], unit_price: '52000.00', tax_rate: '0' }, { ...QUOTE().lines[1], tax_rate: '0' }] };
  refused = caught(() => w.act('employee', deal, 'save_quote', { ...zero, quotation_id: proposalFor(db, deal, QUOTE()) }));
  assert.equal(refused.code, 'quotation_tax_mismatch');
  // عرض منتهي الصلاحية.
  refused = caught(() => w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: proposalFor(db, deal, QUOTE(), { valid_until: riyadh(-1) }) }));
  assert.equal(refused.code, 'quotation_expired');
  // عرض سعر على ورقة فرصة ثانية لنفس العميل: ورقته ليست لهذه الصفقة؛ وبعد ما تربطه صفقته يُرفض لأنه لصفقة واحدة.
  const second = qualifiedDeal(w, 'فرصة تجريبية ثانية SYN-7182').deal;
  const quotationId = proposalFor(db, second, QUOTE());
  assert.equal(caught(() => w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: quotationId })).code, 'pricing_sheet_other_deal');
  w.act('employee', second, 'save_quote', { ...QUOTE(), quotation_id: quotationId });
  refused = caught(() => w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: quotationId }));
  assert.equal(refused.code, 'quotation_other_deal');
  assert.equal(count(), before + 1, 'only the bound save of the second deal was written');
  // عرض عميل آخر.
  const foreign = tx(() => agency.createClient(db, users.outsider, { legal_name: 'عميل تجريبي آخر للربط', sector: 'الصحة', status: 'active', registration_number: '7182000002' })).id;
  tx(() => agency.clientAction(db, users.outsider, foreign, 'add_member', { user_id: 'employee', role: 'عضو تجريبي' }));
  tx(() => agency.clientAction(db, users.outsider, foreign, 'add_contact', { name: 'جهة تجريبية', title: 'مديرة', email: '', phone: '' }));
  const foreignDeal = tx(() => commercial.createLead(db, users.employee, { client_id: foreign, source: 'زيارة تجريبية' })).id;
  refused = caught(() => w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: proposalFor(db, foreignDeal, QUOTE()) }));
  assert.equal(refused.code, 'quotation_not_for_deal');
  assert.equal(caught(() => w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: 'not-a-quotation' })).code, 'quotation_not_for_deal');
  // المطابق: يُكتب الربط، وتقرؤه الصفقة.
  const c = w.act('employee', deal, 'save_quote', boundQuote(db, deal, QUOTE()));
  assert.equal(c.proposal.quote.grand_total_minor, 9200000);
  assert.equal(c.proposal.quote.current, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM commercial_quote_proposals WHERE case_id=?').get(deal).n, 1);
  // القاعدة نفسها: ربط بإجمالي آخر أو لعرض مربوط بصفقة أخرى يُرفض مهما كان الكاتب.
  const quote = db.prepare('SELECT id FROM commercial_quotes WHERE case_id=? ORDER BY revision DESC LIMIT 1').get(deal).id;
  const row = db.prepare('SELECT * FROM commercial_quote_proposals WHERE quote_id=?').get(quote);
  assert.throws(() => db.prepare('UPDATE commercial_quote_proposals SET quote_total_minor=1 WHERE quote_id=?').run(quote), /binding is fixed/);
  assert.throws(() => db.prepare('INSERT INTO commercial_quote_proposals(quote_id,case_id,tenant_id,quotation_id,quotation_version_id,sheet_id,quote_total_minor,quotation_total_minor,vat_rate_bp,bound_by,bound_at) SELECT id,case_id,?,?,?,?,9200000,9200000,1500,?,? FROM commercial_quotes WHERE case_id=? AND revision=1')
    .run('36t', quotationId, db.prepare('SELECT current_version_id FROM client_quotations WHERE id=?').get(quotationId).current_version_id, row.sheet_id, 'employee', 'x', second), /binds one deal|bound to a FRM-024/);
  assert.equal(client, w.kase(deal).client_id);
  assert.ok(verifyAudit(db));
});

test('MOD-BD-03: approve_quote reads the target margin on the deal’s pricing sheet and its exception — below target it waits for an approved, live, covering exception, and the reading is stored with the decision', t => {
  const w = crmWorld(t), { db, users } = w, p = pricingWorld(w);
  const { oppId, deal } = qualifiedDeal(w);
  const sheetId = p.sheet(BELOW_TARGET, oppId), quotationId = p.quotation(sheetId);
  w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: quotationId });
  w.act('employee', deal, 'submit_quote');
  let refused = caught(() => w.act('manager', deal, 'approve_quote', { note: 'اعتماد العرض' }));
  assert.equal(refused.code, 'margin_authority_required');
  assert.match(refused.message, /15\.00%/);
  assert.match(refused.message, /20\.00%/);
  assert.equal(refused.details.refusal.missing[0].owner, users.ceo1.name, 'the one holder of the exception authority is named');
  // طلب معلّق لا يكفي، ومرفوض لا يكفي.
  const pending = p.exception(sheetId);
  assert.match(caught(() => w.act('manager', deal, 'approve_quote', { note: 'اعتماد العرض' })).details.refusal.missing[0].why, /ينتظر قرار/);
  assert.equal(caught(() => p.decideException(pending, 'approve_exception', users.employee)).code, 'self_approval', 'the requester never approves the exception');
  p.decideException(pending, 'reject_exception');
  assert.match(caught(() => w.act('manager', deal, 'approve_quote', { note: 'اعتماد العرض' })).details.refusal.missing[0].why, /انرفض/);
  const approved = p.exception(sheetId);
  p.decideException(approved);
  const c = w.act('manager', deal, 'approve_quote', { note: 'اعتماد العرض بعد الاستثناء' });
  assert.equal(c.status, 'quote_approved');
  const review = c.reviews.find(r => r.kind === 'quote' && r.status === 'approved');
  assert.deepEqual([review.evidence.margin_authority.target_margin_bp, review.evidence.margin_authority.net_margin_bp, review.evidence.margin_authority.below_target,
    review.evidence.margin_authority.margin_exception_id], [2000, 1500, true, approved]);
  assert.equal(c.proposal.quote.margin.satisfied, true);
  assert.ok(verifyAudit(db));
});

test('MOD-BD-03: an at-target quote needs no exception; a quotation revised after binding is a stale price and refused until the deal saves on the new version', t => {
  const w = crmWorld(t), { db } = w, p = pricingWorld(w);
  const { oppId, deal } = qualifiedDeal(w);
  const sheetId = p.sheet(AT_TARGET, oppId), quotationId = p.quotation(sheetId);
  w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: quotationId });
  w.act('employee', deal, 'submit_quote');
  p.qAct(quotationId, 'revise', { valid_until: riyadh(40), note: 'نسخة تجريبية جديدة بصلاحية أطول' });
  const refused = caught(() => w.act('manager', deal, 'approve_quote', { note: 'اعتماد العرض' }));
  assert.equal(refused.code, 'quotation_revised');
  w.act('manager', deal, 'reject_quote', { note: 'العرض صدرت له نسخة أحدث' });
  w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: quotationId });
  w.act('employee', deal, 'submit_quote');
  const c = w.act('manager', deal, 'approve_quote', { note: 'اعتماد العرض على النسخة الجديدة' });
  assert.equal(c.reviews.filter(r => r.kind === 'quote').at(-1).evidence.margin_authority.below_target, false);
  assert.equal(c.proposal.quote.revision, 2);
  assert.ok(verifyAudit(db));
});

test('D2: register_contract binds the accepted client quotation — refused while only issued, refused when the exception had expired before the quotation left, and the database refuses a contracted deal without the binding', t => {
  const w = crmWorld(t), { db, users } = w, p = pricingWorld(w);
  const { oppId, deal } = qualifiedDeal(w);
  const sheetId = p.sheet(BELOW_TARGET, oppId), quotationId = p.quotation(sheetId), exceptionId = p.exception(sheetId);
  p.decideException(exceptionId);
  w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: quotationId });
  w.act('employee', deal, 'submit_quote');
  w.act('manager', deal, 'approve_quote', { note: 'اعتماد العرض بعد الاستثناء' });
  let refused = caught(() => w.act('employee', deal, 'register_contract', CONTRACT));
  assert.equal(refused.code, 'quotation_not_accepted');
  assert.match(refused.message, /مسودة/);
  p.issue(quotationId);
  refused = caught(() => w.act('employee', deal, 'register_contract', CONTRACT));
  assert.equal(refused.code, 'quotation_not_accepted');
  p.accept(quotationId);
  // الاستثناء انتهى قبل يوم صدور العرض: يُقرأ الهامش بيوم صدوره، فلا يغطي (يُعاد تاريخ الصدور هنا مباشرةً لأن المسار يرفض الإصدار بلا استثناء ساري).
  const issued = db.prepare('SELECT issued_at FROM client_quotations WHERE id=?').get(quotationId).issued_at;
  db.exec('DROP TRIGGER client_quotations_versioned');
  db.prepare('UPDATE client_quotations SET issued_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z', quotationId);
  refused = caught(() => w.act('employee', deal, 'register_contract', CONTRACT));
  assert.equal(refused.code, 'margin_authority_required');
  assert.match(refused.details.refusal.missing[0].why, /انتهت صلاحيته/);
  db.prepare('UPDATE client_quotations SET issued_at=? WHERE id=?').run(issued, quotationId);
  // الطبقة الأخيرة قبل المسار: «متعاقد عليها» بلا ربط مرفوضة مهما كان الكاتب.
  assert.throws(() => db.prepare("UPDATE commercial_cases SET status='contracted',version=version+1 WHERE id=?").run(deal), /contracted on the accepted FRM-024/);
  const c = w.act('employee', deal, 'register_contract', CONTRACT);
  assert.equal(c.status, 'contracted');
  assert.equal(c.contract.snapshot.quotation_id, quotationId);
  assert.deepEqual([c.proposal.contract.quotation_id, c.proposal.contract.net_margin_bp, c.proposal.contract.margin_exception_code], [quotationId, 1500,
    db.prepare('SELECT code FROM margin_exceptions WHERE id=?').get(exceptionId).code]);
  // العرض المقبول لاتفاق واحد، والربط ثابت.
  assert.throws(() => db.prepare('INSERT INTO commercial_contract_proposals SELECT * FROM commercial_contract_proposals WHERE case_id=?').run(deal), /UNIQUE|PRIMARY/);
  assert.throws(() => db.prepare('UPDATE commercial_contract_proposals SET net_margin_bp=2500 WHERE case_id=?').run(deal), /binding is fixed/);
  // لوحة التسعير تقرأ الصفقة التي رُبط بها العرض.
  const view = pricingBoard(db, users.employee).quotations.find(q => q.id === quotationId);
  assert.deepEqual([view.deal.case_id, view.deal.contracted], [deal, true]);
  w.oppAct('employee', oppId, 'win', {});
  assert.ok(verifyAudit(db));
});

test('approvedPricingSheet: «ملف تسعير المشروع المعتمد ماليًا» is the sheet of this project’s deal, not any approved sheet of the client', t => {
  const w = crmWorld(t), { db, users, tx } = w, p = pricingWorld(w);
  const { oppId, deal } = qualifiedDeal(w);
  const sheetId = p.sheet(AT_TARGET, oppId), quotationId = p.quotation(sheetId);
  const otherSheet = p.sheet(AT_TARGET);
  w.act('employee', deal, 'save_quote', { ...QUOTE(), quotation_id: quotationId });
  w.act('employee', deal, 'submit_quote');
  w.act('manager', deal, 'approve_quote', { note: 'اعتماد العرض' });
  p.issue(quotationId); p.accept(quotationId);
  w.act('employee', deal, 'register_contract', CONTRACT);
  w.oppAct('employee', oppId, 'win', {});
  w.act('manager', deal, 'create_project', { member_ids: ['pm1'] });
  const projectId = w.kase(deal).project_id;
  assert.equal(caught(() => projectIntake.approvedPricingSheet(db, '36t', w.client, otherSheet, projectId)).code, 'pricing_sheet_other_deal');
  assert.equal(projectIntake.approvedPricingSheet(db, '36t', w.client, sheetId, projectId).sheet.id, sheetId);
  // وورقة صفقة هذا المشروع لا تُقدَّم لمشروع غيره.
  assert.equal(caught(() => projectIntake.approvedPricingSheet(db, '36t', w.client, sheetId, null)).code, 'pricing_sheet_other_deal');
  assert.ok(users && tx);
});

// صفقة متعاقد عليها بمشروع مفتوح، بجدول دفعات ومستلَم.
function projectDeal(w) {
  const { db, users, tx } = w;
  const oppId = w.opportunity();
  const deal = w.openCase(oppId).id;
  w.contract(deal);
  w.oppAct('employee', oppId, 'win', {});
  w.act('manager', deal, 'create_project', { member_ids: ['pm1'] });
  return { deal, projectId: w.kase(deal).project_id, contractId: db.prepare('SELECT id FROM commercial_contracts WHERE case_id=?').get(deal).id, users, tx };
}

test('accept_delivery names a registered client approver of the project, active today — the same register the completion certificate uses; a typed name or a revoked approver is refused, in code and in the database', t => {
  const w = crmWorld(t), { db, users } = w;
  const { deal, projectId } = projectDeal(w);
  const c = w.act('employee', deal, 'submit_delivery', { line_index: 0, evidence: 'تقرير إنجاز هوية الحملة التجريبية' });
  const delivery = c.deliveries.find(d => d.line_index === 0).id;
  let refused = caught(() => w.act('manager', deal, 'accept_delivery', { delivery_id: delivery, note: 'مطابق للمعيار', acceptance_evidence: 'محضر قبول تجريبي محفوظ', customer_representative: 'اسم مكتوب' }));
  assert.equal(refused.code, 'approver_required');
  assert.match(refused.message, /سجل مفوّضي المشروع/);
  refused = caught(() => w.act('manager', deal, 'accept_delivery', { delivery_id: delivery, note: 'مطابق للمعيار', acceptance_evidence: 'محضر قبول تجريبي محفوظ', approver_id: 'unknown' }));
  assert.equal(refused.code, 'approver_required');
  const approver = approverFor(db, projectId, 'pm1');
  assert.deepEqual(w.view(deal, 'manager').client_approvers.map(a => a.id), [approver]);
  // تفويض مسحوب لا يُسمّى ممثلًا في القبول.
  db.prepare("INSERT INTO client_approvers(id,tenant_id,project_id,name,title,authority_basis,authority_scope,valid_from,recorded_by,created_at) VALUES('syn-revoked','36t',?,'ممثل تجريبي سُحب تفويضه','مدير سابق','خطاب تفويض تجريبي قديم محفوظ','قبول المخرجات',?,'pm1','x')").run(projectId, riyadh(-10));
  db.prepare("UPDATE client_approvers SET revoked_on=?,revoked_by='pm1',revoke_reason='انتهى تفويضه التجريبي' WHERE id='syn-revoked'").run(riyadh(-1));
  refused = caught(() => w.act('manager', deal, 'accept_delivery', { delivery_id: delivery, note: 'مطابق للمعيار', acceptance_evidence: 'محضر قبول تجريبي محفوظ', approver_id: 'syn-revoked' }));
  assert.equal(refused.code, 'approver_required');
  assert.match(refused.message, /مو ساري اليوم/);
  // القاعدة نفسها: قرار قبول بلا ممثل مسجّل يُرفض مهما كان الكاتب.
  assert.throws(() => db.prepare("UPDATE commercial_reviews SET status='approved',note='قبول مباشر',evidence_json='{}',decided_at='x' WHERE kind='delivery' AND subject_id=?").run(delivery), /registered client approver/);
  const accepted = w.act('manager', deal, 'accept_delivery', { delivery_id: delivery, note: 'مطابق للمعيار', acceptance_evidence: 'محضر قبول تجريبي محفوظ', approver_id: approver });
  const evidence = accepted.deliveries.find(d => d.id === delivery).review.evidence;
  assert.deepEqual([evidence.approver_id, evidence.customer_representative, evidence.approver_title], [approver, 'ممثل عميل تجريبي', 'مدير التسويق']);
  assert.ok(verifyAudit(db));
});

test('contract register: a client contract points at its deal agreement once — client-checked and fixed in force — and terminating it stops deliveries, changes, new entitlements and billing schedules, in code and in the database', t => {
  const w = crmWorld(t), { db, users, tx } = w;
  const { deal, projectId, contractId } = projectDeal(w);
  tx(() => grantAccess(db, users.admin, { user_id: 'manager', capability: 'contracts.register.manage', department_id: '', note: 'منح تجريبي لسجل العقود' }));
  tx(() => grantAccess(db, users.admin, { user_id: 'manager', capability: 'billing.recurring.manage', department_id: '', note: 'منح تجريبي للفوترة الدورية' }));
  const record = extra => ({ party_kind: 'client', client_id: w.client, vendor_id: '', party_name: '', contract_type: 'statement_of_work', subject: 'أمر عمل حملة الإطلاق التجريبية',
    start_date: riyadh(-1), end_date: '2099-12-31', value: '92000.00', auto_renew: false, notice_days: null, renewal_note: '', scope_baseline_id: '', owner_id: 'employee',
    original_location: 'أرشيف العقود التجريبي — ملف 7182', signed_for_company: 'مدير تجريبي', signed_for_party: 'ممثل عميل تجريبي', signed_on: riyadh(-1), commercial_contract_id: contractId, ...extra });
  // عقد لعميل آخر لا يشير إلى اتفاق هذا العميل.
  const other = tx(() => agency.createClient(db, users.outsider, { legal_name: 'عميل تجريبي آخر للسجل', sector: 'الصحة', status: 'active', registration_number: '7182000003' })).id;
  assert.equal(caught(() => tx(() => contracts.createContract(db, users.manager, record({ client_id: other })))).code, 'agreement_other_client');
  const recordId = tx(() => contracts.createContract(db, users.manager, record())).id;
  assert.equal(caught(() => tx(() => contracts.createContract(db, users.manager, record()))).code, 'agreement_already_registered');
  assert.throws(() => db.prepare("INSERT INTO contract_records(id,tenant_id,number,party_kind,client_id,contract_type,subject,start_date,end_date,auto_renew,owner_id,original_location,status,created_by,created_at,updated_at,commercial_contract_id) VALUES('x','36t','CT-9999','client',?,'other','نسخة ثانية تجريبية','2026-01-01','2099-01-01',0,'employee','أرشيف تجريبي','draft','manager','x','x',?)").run(w.client, contractId), /UNIQUE/);
  const version = () => db.prepare('SELECT version FROM contract_records WHERE id=?').get(recordId).version;
  tx(() => contracts.contractAction(db, users.employee, recordId, 'activate_contract', { version: version(), note: 'أقر بملكية العقد ومطابقته للأصل' }));
  assert.throws(() => db.prepare('UPDATE contract_records SET commercial_contract_id=NULL,version=version+1 WHERE id=?').run(recordId), /keeps its deal agreement/);
  const board = contracts.contractsRegisterBoard(db, users.manager).contracts.find(r => r.id === recordId);
  assert.equal(board.commercial_agreement.case_id, deal);
  // جدولة فوترة دورية على الصفقة قبل الإنهاء.
  const schedule = db.prepare("INSERT INTO billing_schedules(id,tenant_id,client_id,case_id,title,cadence,issue_day,lines,currency,total_minor,contract_reference,start_date,status,owner_id,created_by,created_at,updated_at) VALUES('syn-schedule','36t',?,?,'جدولة تجريبية شهرية','monthly',1,'[{\"description\":\"اشتراك تجريبي\",\"amount_minor\":100000}]','SAR',100000,'اتفاق الصفقة التجريبية',?, 'active','manager','manager','x','x') RETURNING id").get(w.client, deal, riyadh()).id;
  const c = w.act('employee', deal, 'submit_delivery', { line_index: 0, evidence: 'تقرير إنجاز هوية الحملة التجريبية' });
  tx(() => contracts.contractAction(db, users.employee, recordId, 'terminate_contract', { version: version(), note: 'إنهاء تجريبي بإشعار مرسل برقم 7182' }));
  assert.equal(db.prepare('SELECT status FROM billing_schedules WHERE id=?').get(schedule).status, 'ended');
  assert.match(db.prepare('SELECT stopped_reason FROM billing_schedules WHERE id=?').get(schedule).stopped_reason, /CT-/);
  let refused = caught(() => w.act('employee', deal, 'submit_delivery', { line_index: 1, evidence: 'تقرير إنجاز المنشورات التجريبية' }));
  assert.equal(refused.code, 'contract_terminated');
  refused = caught(() => w.act('employee', deal, 'create_change', { scope: 'منشورات إضافية تجريبية', additional_price: '100.00', additional_cost: '50.00', extra_days: 1, due_date: '2099-12-02', acceptance: 'قبول تجريبي' }));
  assert.equal(refused.code, 'contract_terminated');
  assert.equal(w.view(deal).termination.number, board.number);
  assert.ok(!w.view(deal).allowed_actions.includes('submit_delivery'));
  // القبول المعلّق قبل الإنهاء يبقى قراره، والاستحقاق الجديد مرفوض.
  const approver = approverFor(db, projectId, 'pm1'), delivery = c.deliveries.find(d => d.line_index === 0).id;
  w.act('manager', deal, 'accept_delivery', { delivery_id: delivery, note: 'مطابق للمعيار', acceptance_evidence: 'محضر قبول تجريبي محفوظ', approver_id: approver });
  refused = caught(() => tx(() => receivables.createClaim(db, users.employee, { delivery_id: delivery, amount: '46000.00', due_date: '2099-12-15', entitlement_evidence: 'محضر القبول التجريبي' })));
  assert.equal(refused.code, 'contract_terminated');
  // الطبقة الأخيرة في القاعدة.
  assert.throws(() => db.prepare("INSERT INTO commercial_deliveries VALUES('x',?,?,1,9,'دليل','employee','x')").run(deal, contractId), /terminated contract/);
  assert.throws(() => db.prepare("INSERT INTO billing_schedules(id,tenant_id,client_id,case_id,title,cadence,issue_day,lines,currency,total_minor,contract_reference,start_date,status,owner_id,created_by,created_at,updated_at) VALUES('syn-schedule-2','36t',?,?,'جدولة تجريبية ثانية','monthly',1,'[{\"description\":\"اشتراك\",\"amount_minor\":100}]','SAR',100,'اتفاق الصفقة التجريبية',?, 'active','manager','manager','x','x')").run(w.client, deal, riyadh()), /terminated contract/);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id='pm1' AND kind='contract_terminated'").get(), 'the project team hears of it');
  assert.ok(billing && verifyAudit(db));
});
