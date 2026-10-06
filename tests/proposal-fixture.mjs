// عرض سعر العميل (FRM-024) لاختبارات ما بعد العرض (الترحيل 182، القرار D2): منذ الترحيل تُحفظ نسخة عرض الصفقة على عرض سعر
// يساويها، ويُتعاقد على العرض الذي قبله العميل. الاختبارات التي يعنيها ما بعد الاتفاق (التسليم والاستحقاق والتحصيل والفوترة والإقفال)
// تأخذ من هنا عرض سعر مقبولًا بإجمالي عرضها، وملف عميل لصفقتها، وممثل عميل مفوّضًا لقبول مخرجاتها — بلا أن تمرّ بمقاعد التسعير
// الأربعة وتصاريحها، فلا يتغيّر في عالمها حاملُ تصريحٍ واحد.
//
// لماذا SQL مباشر لا مسارات التسعير: تلك تحتاج تصاريح التسعير الخمسة لحسابات العالم (finance.use لمقعد المالية مثلًا)، ومنحها يغيّر
// ما تختبره تلك الملفات (من يحمل تصريحًا ماليًا، ومن يُسمّى مالك الوثيقة المالية). الصفوف هنا تحترم كل قيد ومُطلِق في المخطط
// (الورقة مسودة ثم مقدّمة ثم معتمدة بمقاعدها الأربعة من غير معدّها، والعرض مسودة ثم صادر ثم مقبول)؛ ومسارات التسعير نفسها وسلطة
// الهامش تُختبر بأدوارها الحقيقية في tests/crm-proposal-of-record.test.mjs.
// كل اسم ورقم هنا مصطنع وموسوم «تجريبي».
import { randomUUID } from 'node:crypto';
import { hash } from '../app/db.mjs';
import { computePricing } from '../app/pricing.mjs';
// لقطة نسخة عرض السعر بمفاتيحها كما يكتبها createQuotation في app/pricing.mjs (quotationSnapshot)، من الورقة وحسابها وبطاقتها.
const quotationSnapshot = (row, totals, card) => ({ sheet_id: row.id, sheet_code: row.code, name: row.name, scope: row.scope_note, currency: 'SAR',
  contract_kind: row.contract_kind, duration_note: row.duration_note, price_card_id: card.id, price_card_name: card.name, price_card_effective_from: card.effective_from,
  contingency_rate_bp: row.contingency_rate_bp, target_margin_bp: row.target_margin_bp, minimum_margin_bp: row.minimum_margin_bp,
  groups: totals.groups, direct_total_minor: totals.direct_total_minor, contingency_minor: totals.contingency_minor, total_cost_minor: totals.total_cost_minor,
  sale_price_pre_tax_minor: totals.sale_price_pre_tax_minor, discount_minor: totals.discount_minor, net_pre_tax_minor: totals.net_pre_tax_minor,
  actual_margin_bp: totals.actual_margin_bp, net_margin_bp: totals.net_margin_bp, markup_bp: totals.markup_bp, admin_fee_bp: totals.admin_fee_bp, admin_fee_minor: totals.admin_fee_minor,
  vat_rate_bp: totals.vat_rate_bp, vat_minor: totals.vat_minor, grand_total_minor: totals.grand_total_minor, formulas: totals.formulas, rounding: 'half-up-on-integers' });
import { createLead } from '../app/commercial.mjs';

const stamp = () => new Date().toISOString();
const day = (offset = 0) => new Date(Date.now() + 3 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const halfUp = (num, den) => (2n * num + den) / (2n * den);
let serial = 0;
const next = () => String(++serial).padStart(4, '0');

// معتمد غير المعد في الكيان نفسه: المدير أولًا إن وُجد.
function approverBesides(db, tenantId, preparer) {
  return db.prepare("SELECT id FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY CASE role WHEN 'manager' THEN 0 ELSE 1 END,id LIMIT 1").get(tenantId, preparer).id;
}
// سياسة معتمدة أو تُبذر: بلا احتياطي ولا هامش مستهدف، فيساوي سعر البيع التكلفة ويُضبط الإجمالي بالهللة.
function policy(db, tenantId, key, preparer, approver) {
  const live = db.prepare("SELECT * FROM pricing_policies WHERE tenant_id=? AND policy_key=? AND status='approved'").get(tenantId, key);
  if (live) return live;
  const t = stamp(), revision = (db.prepare('SELECT MAX(revision) AS n FROM pricing_policies WHERE tenant_id=? AND policy_key=?').get(tenantId, key).n ?? 0) + 1;
  return db.prepare(`INSERT INTO pricing_policies(id,tenant_id,policy_key,revision,value_unit,value_raw,source_reference,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at,updated_at)
    VALUES(?,?,?,?,'percent',0,'سند تجريبي لسياسة تسعير اختبارات ما بعد العرض','سياسة تجريبية بلا احتياطي ولا هامش ليساوي العرض اتفاقه',?,'approved',?,?,?,?,?) RETURNING *`)
    .get(randomUUID(), tenantId, key, revision, day(-30), preparer, approver, t, t, t);
}
function card(db, tenantId, preparer, approver) {
  const live = db.prepare("SELECT * FROM price_cards WHERE tenant_id=? AND client_id IS NULL AND status='approved' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1").get(tenantId, day());
  if (live) return live;
  const t = stamp();
  return db.prepare(`INSERT INTO price_cards(id,tenant_id,client_id,name,effective_from,lines,source,status,prepared_by,decided_by,decided_at,created_at,updated_at)
    VALUES(?,?,NULL,'بطاقة أسعار تجريبية عامة',?,?,'قرار تسعير داخلي تجريبي ومرجعه','approved',?,?,?,?,?) RETURNING *`)
    .get(randomUUID(), tenantId, day(-30), JSON.stringify([{ kind: 'role', name: 'مصمم تجريبي', category_code: '', price: '300.00' }]), preparer, approver, t, t, t);
}
function issuer(db, tenantId, preparer, approver) {
  const live = db.prepare("SELECT * FROM pricing_decisions WHERE tenant_id=? AND decision_code='quotation_issuer' AND status='approved'").get(tenantId);
  if (live) return live;
  const t = stamp();
  return db.prepare(`INSERT INTO pricing_decisions(id,tenant_id,decision_code,revision,chosen_option,basis,status,prepared_by,decided_by,decided_at,created_at,updated_at)
    VALUES(?,?,'quotation_issuer',1,'procurement','قرار تجريبي بجهة إصدار عرض السعر','approved',?,?,?,?,?) RETURNING *`).get(randomUUID(), tenantId, preparer, approver, t, t, t);
}
// صافي قبل الضريبة يعطي بنسبتها الإجمالي المطلوب بالهللة، كما يحسبه computePricing (نصف لأعلى على أعداد صحيحة).
function netFor(total, vatBp) {
  const T = BigInt(total), v = BigInt(vatBp), guess = T * 10000n / (10000n + v);
  for (let n = guess - 3n; n <= guess + 3n; n++) if (n > 0n && n + halfUp(n * v, 10000n) === T) return Number(n);
  throw new Error(`proposal-fixture: لا صافي يعطي ${total} بنسبة ${vatBp}؛ عدّل مبلغ بند في العرض`);
}

// عرض سعر للصفقة بإجمالي نسخة عرضها (quote: حمولة save_quote كما يرسلها الاختبار). يعيد معرّف العرض لحمولة save_quote.
// accepted=true (الافتراض) يصدره ويسجّل قبول العميل، فيُتعاقد عليه؛ و'issued' يتركه صادرًا، و'draft' مسودة.
export function proposalFor(db, caseId, quote, { state = 'accepted', valid_until = '2099-12-01' } = {}) {
  const c = db.prepare('SELECT * FROM commercial_cases WHERE id=?').get(caseId);
  if (!c?.client_id) throw new Error('proposal-fixture: الصفقة بلا ملف عميل — افتحها من ملف العميل (clientFileFor)');
  const rates = [...new Set(quote.lines.map(l => Math.round(Number(l.tax_rate) * 100)))];
  if (rates.length !== 1) throw new Error('proposal-fixture: بنود العرض بنسبة ضريبة واحدة');
  // إجمالي نسخة العرض كما يحسبه app/commercial.mjs: لكل بند (سعر × كمية − خصم) وضريبته نصف لأعلى.
  const minor = value => { const [w, f = ''] = String(value).split('.'); return BigInt(w) * 100n + BigInt(f.padEnd(2, '0')); };
  const total = quote.lines.reduce((sum, l) => { const net = minor(l.unit_price) * BigInt(l.quantity) - minor(l.discount); return sum + net + (net * BigInt(rates[0]) + 5000n) / 10000n; }, 0n);
  const preparer = c.owner_id, approver = approverBesides(db, c.tenant_id, preparer), t = stamp();
  const contingency = policy(db, c.tenant_id, 'contingency_rate', preparer, approver), target = policy(db, c.tenant_id, 'target_margin', preparer, approver);
  const priceCard = card(db, c.tenant_id, preparer, approver), decision = issuer(db, c.tenant_id, preparer, approver);
  const net = netFor(total, rates[0]), sheetId = randomUUID(), tag = next();
  db.prepare(`INSERT INTO pricing_sheets(id,tenant_id,client_id,opportunity_id,code,name,scope_note,contract_kind,duration_note,quoted_on,price_card_id,price_card_effective_from,rates_on,
      contingency_rate_bp,contingency_policy_id,target_margin_bp,target_margin_policy_id,vat_rate_bp,vat_basis,status,prepared_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'one_off','ثمانية أسابيع تجريبية',?,?,?,?,?,?,?,?,?,'نسبة الضريبة كما في بنود العرض التجريبي','draft',?,?,?)`)
    .run(sheetId, c.tenant_id, c.client_id, c.opportunity_id ?? null, `PS-FX-${tag}`, 'ورقة تسعير تجريبية للصفقة', 'نطاق تجريبي مسعّر لاختبار ما بعد العرض', day(), priceCard.id, priceCard.effective_from, day(),
      contingency.value_raw, contingency.id, target.value_raw, target.id, rates[0], preparer, t, t);
  const pieces = []; for (let rest = net; rest > 0; rest -= Math.min(rest, 100000000)) pieces.push(Math.min(rest, 100000000));
  pieces.forEach((amount, index) => db.prepare(`INSERT INTO pricing_sheet_lines(id,sheet_id,line_no,cost_group,description,basis,quantity_centi,unit_price_minor,amount_minor,created_at)
    VALUES(?,?,?,'internal_team','تكلفة تجريبية للعرض','quantity',100,?,?,?)`).run(randomUUID(), sheetId, index + 1, amount, amount, t));
  db.prepare("UPDATE pricing_sheets SET status='submitted',submitted_at=?,version=version+1 WHERE id=?").run(t, sheetId);
  for (const seat of ['requesting_department', 'procurement_finance', 'epmo', 'vp_corporate_services'])
    db.prepare("INSERT INTO pricing_sheet_approvals(id,sheet_id,approval_round,seat,decision,capability,note,decided_by,decided_at) VALUES(?,?,1,?,'approved','مقعد تجريبي','اعتماد تجريبي للورقة',?,?)").run(randomUUID(), sheetId, seat, approver, t);
  db.prepare("UPDATE pricing_sheets SET status='approved',decided_at=?,decision_note='اعتماد تجريبي',version=version+1 WHERE id=?").run(t, sheetId);
  const sheet = db.prepare('SELECT * FROM pricing_sheets WHERE id=?').get(sheetId);
  const lines = db.prepare('SELECT * FROM pricing_sheet_lines WHERE sheet_id=? ORDER BY line_no').all(sheetId);
  const totals = computePricing(lines, { contingency_rate_bp: sheet.contingency_rate_bp, target_margin_bp: sheet.target_margin_bp, minimum_margin_bp: null, discount_minor: 0, admin_fee_bp: 0, vat_rate_bp: sheet.vat_rate_bp });
  if (BigInt(totals.grand_total_minor) !== total) throw new Error(`proposal-fixture: الإجمالي ${totals.grand_total_minor} غير ${total}`);
  const quotationId = randomUUID(), versionId = randomUUID(), snapshot = JSON.stringify(quotationSnapshot(sheet, totals, priceCard));
  db.prepare("INSERT INTO client_quotations(id,tenant_id,client_id,sheet_id,code,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?,?)").run(quotationId, c.tenant_id, c.client_id, sheetId, `QT-FX-${tag}`, preparer, t, t);
  db.prepare('INSERT INTO quotation_versions(id,quotation_id,revision,price_card_id,price_card_effective_from,valid_until,snapshot,digest,prepared_by,created_at) VALUES(?,?,1,?,?,?,?,?,?,?)')
    .run(versionId, quotationId, priceCard.id, priceCard.effective_from, valid_until, snapshot, hash(snapshot), preparer, t);
  db.prepare('UPDATE client_quotations SET current_version_id=?,version=version+1,updated_at=? WHERE id=?').run(versionId, t, quotationId);
  if (state !== 'draft') db.prepare("UPDATE client_quotations SET status='issued',issuer_role='procurement',issuer_decision_id=?,issued_by=?,issued_at=?,version=version+1,updated_at=? WHERE id=?").run(decision.id, preparer, t, t, quotationId);
  if (state === 'accepted') db.prepare("UPDATE client_quotations SET status='accepted',outcome='won',outcome_reason='قبول تجريبي للعرض في الاختبار',outcome_recorded_by=?,outcome_recorded_at=?,version=version+1,updated_at=? WHERE id=?").run(preparer, t, t, quotationId);
  return quotationId;
}
// نسخة save_quote مربوطة بعرض سعر مقبول يساويها.
export const boundQuote = (db, caseId, quote, options) => ({ ...quote, quotation_id: proposalFor(db, caseId, quote, options) });

// ملف عميل لصفقة تُفتح منه (createLead({client_id})): بديل المسار القديم بالاسم ورقم السجل، بالاسم والرقم والقطاع أنفسهم، ومالكه صاحب الصفقة.
export function clientFileFor(db, owner, { name, registration_number, sector = 'تجريبي', contact = 'جهة تواصل تجريبية' }) {
  const id = randomUUID(), t = stamp();
  db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,sector,status,owner_id,created_at,updated_at,registration_number) VALUES(?,?,?,?,?,'active',?,?,?,?)")
    .run(id, owner.tenant_id, `C-FX-${next()}`, name, sector, owner.id, t, t, registration_number.normalize('NFKC').trim().toUpperCase());
  db.prepare('INSERT INTO client_contacts(id,client_id,name,title,created_by,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), id, contact, 'جهة تواصل', owner.id, t);
  return id;
}
// صفقة مفتوحة من ملف عميل بالاسم ورقم السجل والقطاع وجهة الاتصال والمصدر التي كان يأخذها المسار القديم (داخل معاملة كما createLead).
export const dealFor = (db, user, input) => createLead(db, user, { client_id: clientFileFor(db, user, input), contact: input.contact, source: input.source });
// ممثل عميل مفوّض في سجل المشروع، ساريًا منذ أمس (يوم الرياض)، لقبول المخرجات وشهادة الإنجاز. يسجّله منشئ المشروع ما لم يُسمَّ غيره.
export function approverFor(db, projectId, recordedBy = null) {
  const live = db.prepare('SELECT id FROM client_approvers WHERE project_id=? AND revoked_on IS NULL ORDER BY created_at LIMIT 1').get(projectId);
  if (live) return live.id;
  const id = randomUUID(), project = db.prepare('SELECT tenant_id,created_by FROM projects WHERE id=?').get(projectId);
  recordedBy ??= project.created_by;
  db.prepare("INSERT INTO client_approvers(id,tenant_id,project_id,name,title,authority_basis,authority_scope,valid_from,recorded_by,created_at) VALUES(?,?,?,'ممثل عميل تجريبي','مدير التسويق','خطاب تفويض تجريبي محفوظ في أرشيف الاختبار','قبول مخرجات المشروع التجريبي',?,?,?)")
    .run(id, project.tenant_id, projectId, day(-1), recordedBy, stamp());
  return id;
}
// جدول دفعات بشروطه (الترحيل 183) لاختبارات ما بعد الاتفاق: دفعة «عند قبول» لكل بند من الاتفاق بقيمته، بلا مقدمة ولا شرط أمر شراء
// ما لم يُطلب. منذ 183 لا استحقاق على صفقة بلا جدول، والدفعة بقيمة بندها تُبقي الاستحقاق كما كان: حتى قيمة بند المخرج المقبول.
// SQL مباشر يحترم قيود الجدول ومُطلِقه؛ ومسار recordPaymentTerms نفسه يُختبر بأدواره في tests/crm-entitlement-gates.test.mjs.
// صفقة سُجّل عليها جدول تبقى كما هي.
export function scheduleFor(db, caseId, { requires_client_po = false } = {}) {
  if (db.prepare('SELECT 1 FROM case_payment_terms WHERE case_id=?').get(caseId)) return;
  const c = db.prepare('SELECT tenant_id,owner_id FROM commercial_cases WHERE id=?').get(caseId);
  const agreement = JSON.parse(db.prepare('SELECT snapshot FROM commercial_contracts WHERE case_id=?').get(caseId).snapshot), t = stamp();
  agreement.lines.forEach((line, index) => db.prepare(`INSERT INTO case_payment_terms(id,tenant_id,case_id,position,label,amount_minor,currency,due_on,condition,is_advance,recorded_by,recorded_at,requires_client_po,condition_kind,condition_lines)
    VALUES(?,?,?,?,?,?,?,'2099-12-15','',0,?,?,?,'acceptance',?)`).run(randomUUID(), c.tenant_id, caseId, index, `دفعة تجريبية عند قبول البند ${index + 1}`, Number(line.total_minor), agreement.currency,
    c.owner_id, t, requires_client_po ? 1 : 0, JSON.stringify([index])));
}
