// عرض الصفقة المعتمد وسلطة الهامش (الحزمة 4، P4-CRM-3، الترحيل 182، القرار D2).
//
// القاعدة في جملة: السعر لا يخرج إلا بسلطة من يملك إعطاءه، والاتفاق لا يتجاوز ما قبله العميل.
//   - نسخة العرض على الصفقة تُحفظ على عرض سعر العميل (FRM-024) الذي تساويه: لعميل الصفقة، على ورقة تسعير معتمدة لهذه الصفقة،
//     بالريال، وبالإجمالي نفسه وبنسبة ضريبته. وعرض السعر الواحد لصفقة واحدة.
//   - اعتماد العرض (approve_quote) يقرأ الهامش المستهدف الملتقط على ورقة التسعير وهامشها الفعلي بعد الخصم: ما دون المستهدف
//     لا يُعتمد إلا باستثناء تسعير (MOD-BD-03) معتمد لورقته، ساري اليوم، ويغطي الهامش. والقراءة تُحفظ مع قرار الاعتماد.
//   - توثيق الاتفاق (register_contract) يشترط أن العميل قبل عرض السعر المربوط بنسخته نفسها، ويعيد قراءة الهامش بيوم صدور العرض:
//     الاستثناء الذي يغطيه لازم كان ساريًا يوم خرج السعر للعميل.
//   - سجل العقود يشير إلى اتفاق الصفقة مرة، وإنهاؤه يوقف ما بعده (terminationOf).
// والمُطلِقات في الترحيل 182 هي الطبقة الأخيرة لكل قاعدة هنا؛ هذه الوحدة تقول قبلها ما الناقص ومن يملكه.
import { now } from './db.mjs';
import { refuse } from './refusal.mjs';
import { personName } from './people-read.mjs';
import { capabilityHolders } from './access.mjs';
import { riyadhToday, riyadhDateOf } from './riyadh-time.mjs';
import { QUOTATION_STATUS, EXCEPTION_STATUS } from './pricing.mjs';

const PRICER = { owner: 'معد التسعير — حامل تصريح «تسعير المشاريع وعروض الأسعار»', owner_role: 'pricing' };
const parse = text => { try { return JSON.parse(text); } catch { return {}; } };
const amount = minor => `${Math.trunc(Number(minor) / 100).toLocaleString('en-US')}.${String(Math.abs(Number(minor) % 100)).padStart(2, '0')}`;
const percent = bp => `${(Number(bp) / 100).toFixed(2)}%`;

// من يعتمد استثناء التسعير: يُسمّى إن كان في الكيان حامل واحد للتصريح، وإلا يُذكر الدور.
function exceptionOwner(db, tenantId) {
  const holders = capabilityHolders(db, tenantId, 'pricing.exception.approve');
  return holders.length === 1 ? holders[0].name : 'الرئيس التنفيذي — حامل تصريح «اعتماد استثناء التسعير»';
}
const ownerOf = (db, c) => personName(db, c.owner_id) ?? 'صاحب الصفقة';

/* ───── القراءة ───── */
const versionRow = (db, id) => db.prepare('SELECT * FROM quotation_versions WHERE id=?').get(id) ?? null;
const quotationRow = (db, tenantId, id) => typeof id === 'string' && id ? db.prepare('SELECT * FROM client_quotations WHERE id=? AND tenant_id=?').get(id, tenantId) ?? null : null;
const sheetRow = (db, id) => db.prepare('SELECT id,code,name,client_id,opportunity_id,status,target_margin_bp,vat_rate_bp FROM pricing_sheets WHERE id=?').get(id) ?? null;
export const quoteBinding = (db, quoteId) => quoteId ? db.prepare('SELECT * FROM commercial_quote_proposals WHERE quote_id=?').get(quoteId) ?? null : null;
export const contractBinding = (db, caseId) => db.prepare('SELECT * FROM commercial_contract_proposals WHERE case_id=?').get(caseId) ?? null;
const boundElsewhere = (db, quotationId, caseId) => db.prepare('SELECT case_id FROM commercial_quote_proposals WHERE quotation_id=? AND case_id<>? LIMIT 1').get(quotationId, caseId)?.case_id ?? null;

// أرقام نسخة عرض السعر كما صدرت: لقطتها ثابتة وبصمتها محفوظة، فهي ما قبله العميل أو سيقبله.
function versionFigures(version) {
  const s = parse(version.snapshot);
  return { revision: version.revision, valid_until: version.valid_until, grand_total_minor: Number(s.grand_total_minor), net_pre_tax_minor: Number(s.net_pre_tax_minor),
    admin_fee_minor: Number(s.admin_fee_minor ?? 0), vat_minor: Number(s.vat_minor), vat_rate_bp: Number(s.vat_rate_bp),
    target_margin_bp: Number(s.target_margin_bp), net_margin_bp: Number(s.net_margin_bp) };
}

// الاستثناءات على ورقة التسعير، الأحدث أولًا. «يغطي» = معتمد، ساري في اليوم المسؤول عنه، وهامشه المقبول لا يزيد على الهامش الفعلي.
function exceptionsOf(db, sheetId) {
  return db.prepare('SELECT * FROM margin_exceptions WHERE sheet_id=? ORDER BY requested_at DESC,rowid DESC').all(sheetId);
}
const covers = (e, net, on) => e.status === 'approved' && e.expires_on >= on && e.requested_margin_bp <= net;
const exceptionView = (db, e, on) => e && { id: e.id, code: e.code, status: e.status, status_name: EXCEPTION_STATUS[e.status] ?? e.status,
  requested_margin_bp: e.requested_margin_bp, expires_on: e.expires_on, expired: e.status === 'approved' && e.expires_on < on, decided_by_name: personName(db, e.decided_by) };

// قراءة سلطة الهامش لنسخة عرض سعر على ورقتها، في يوم بعينه (اليوم لاعتماد العرض، ويوم صدور العرض للاتفاق).
export function marginAuthority(db, tenantId, { sheet_id, version }, on = riyadhToday()) {
  const f = versionFigures(version), below = f.net_margin_bp < f.target_margin_bp;
  const all = exceptionsOf(db, sheet_id), covering = below ? all.find(e => covers(e, f.net_margin_bp, on)) ?? null : null;
  return { on, target_margin_bp: f.target_margin_bp, net_margin_bp: f.net_margin_bp, below_target: below, satisfied: !below || !!covering,
    exception: exceptionView(db, covering ?? all[0] ?? null, on), covering_exception_id: covering?.id ?? null, owner: below ? exceptionOwner(db, tenantId) : null };
}
function refuseMargin(db, c, reading, stage) {
  const e = reading.exception;
  const why = !e ? 'ما فيه طلب استثناء تسعير على ورقة هذا العرض'
    : e.status === 'pending' ? `طلب الاستثناء ${e.code} ينتظر قرار من يملكه`
    : e.status === 'rejected' ? `طلب الاستثناء ${e.code} انرفض`
    : e.expired ? `الاستثناء ${e.code} انتهت صلاحيته في ${e.expires_on}`
    : `الاستثناء ${e.code} يقبل هامشًا حتى ${percent(e.requested_margin_bp)} والهامش الحين ${percent(reading.net_margin_bp)}`;
  refuse(409, 'margin_authority_required', {
    what: `${stage}: الهامش الفعلي ${percent(reading.net_margin_bp)} دون المستهدف ${percent(reading.target_margin_bp)}، وهذا يحتاج استثناء تسعير قبل ما يخرج السعر`,
    missing: [{ document: 'استثناء تسعير (MOD-BD-03) معتمد لورقة هذا العرض، ساري ويغطي الهامش', why, owner: reading.owner, owner_role: 'ceo', doc_key: 'margin_exception' }],
    next: 'اطلب الاستثناء من ورقة التسعير في «التسعير» بمبرره وتاريخ انتهائه، وبعد ما يعتمده صاحبه ارجع لهالخطوة' });
}

/* ───── عروض السعر التي تصلح لهذه الصفقة ───── */
// لعميل الصفقة، غير مرفوضة، على ورقة معتمدة بلا فرصة أو بفرصة الصفقة نفسها، وغير مربوطة بصفقة أخرى. مع نسختها الحالية وأرقامها.
export function proposalCandidates(db, c, on = riyadhToday()) {
  if (!c.client_id) return [];
  return db.prepare(`SELECT x.* FROM client_quotations x JOIN pricing_sheets s ON s.id=x.sheet_id
      WHERE x.tenant_id=? AND x.client_id=? AND x.status<>'rejected' AND s.status='approved' AND (s.opportunity_id IS NULL OR s.opportunity_id IS ?)
      ORDER BY x.created_at DESC,x.id`).all(c.tenant_id, c.client_id, c.opportunity_id ?? null)
    .filter(x => !boundElsewhere(db, x.id, c.id) && x.current_version_id)
    .map(x => {
      const version = versionRow(db, x.current_version_id), sheet = sheetRow(db, x.sheet_id), f = versionFigures(version);
      return { id: x.id, code: x.code, status: x.status, status_name: QUOTATION_STATUS[x.status] ?? x.status, sheet_code: sheet.code, sheet_name: sheet.name,
        revision: f.revision, valid_until: f.valid_until, expired: f.valid_until < on, grand_total_minor: f.grand_total_minor, vat_rate_bp: f.vat_rate_bp,
        net_margin_bp: f.net_margin_bp, target_margin_bp: f.target_margin_bp, below_target: f.net_margin_bp < f.target_margin_bp };
    });
}

/* ───── ربط نسخة عرض الصفقة بعرض السعر ───── */
// يُفحص قبل كتابة نسخة العرض (فيُرفض بالاسم قبل أي كتابة)، ويُكتب الربط بعدها في المعاملة نفسها.
export function checkQuoteBinding(db, c, snapshot, quotationId, on = riyadhToday()) {
  const owner = ownerOf(db, c);
  if (!c.client_id) refuse(409, 'client_file_required', { what: 'الصفقة ما ارتبطت بملف عميل، وعرض السعر يُبنى لملف العميل',
    missing: [{ document: 'ربط الصفقة بملف عميلها', why: 'عرض سعر العميل (FRM-024) وورقة تسعيره لملف العميل، والصفقة بلا ملف ما يُعرف عميلها', owner, owner_role: 'account_manager', doc_key: 'client' }],
    next: 'اربط الصفقة بملف عميلها من «العملاء»، ثم احفظ العرض على عرض سعره' });
  if (typeof quotationId !== 'string' || !quotationId) refuse(409, 'quotation_required', {
    what: 'نسخة العرض تنحفظ على عرض سعر العميل (FRM-024) اللي تساويه',
    missing: [{ document: 'عرض سعر العميل من ورقة تسعير معتمدة لهذه الصفقة', why: 'عرض سعر العميل هو المستند المُلزِم: منه السعر الذي يخرج للعميل، وعليه يُقرأ الهامش واستثناؤه', ...PRICER, doc_key: 'quotation_id' }],
    next: 'جهّز ورقة التسعير وعرض السعر من «التسعير»، ثم اختر العرض في نسخة عرض الصفقة' });
  const x = quotationRow(db, c.tenant_id, quotationId);
  if (!x || x.client_id !== c.client_id || x.status === 'rejected') refuse(409, 'quotation_not_for_deal', {
    what: x?.status === 'rejected' ? `عرض السعر ${x.code} مرفوض من العميل، فما تنبني عليه نسخة` : 'عرض السعر هذا مو لعميل هذه الصفقة',
    missing: [{ document: 'عرض سعر لعميل الصفقة نفسه وغير مرفوض', why: 'نسخة العرض تساوي عرضًا صدر أو سيصدر لهذا العميل', ...PRICER, doc_key: 'quotation_id' }],
    next: 'اختر عرض السعر من قائمة عروض هذا العميل' });
  const other = boundElsewhere(db, x.id, c.id);
  if (other) refuse(409, 'quotation_other_deal', { what: `عرض السعر ${x.code} مربوط بصفقة ثانية`,
    missing: [{ document: 'عرض سعر لهذه الصفقة وحدها', why: 'عرض السعر الواحد لصفقة واحدة، فما يُتعاقد عليه مرتين', ...PRICER, doc_key: 'quotation_id' }],
    next: 'جهّز ورقة تسعير وعرض سعر لهذه الصفقة' });
  const sheet = sheetRow(db, x.sheet_id);
  if (sheet.status !== 'approved' || (sheet.opportunity_id && sheet.opportunity_id !== c.opportunity_id)) refuse(409, 'pricing_sheet_other_deal', {
    what: `ورقة التسعير ${sheet.code} ${sheet.status !== 'approved' ? 'ما اعتُمدت بعد' : 'مسعّرة لفرصة ثانية'}`,
    missing: [{ document: 'ورقة تسعير معتمدة لهذه الصفقة (بلا فرصة، أو بفرصة الصفقة نفسها)', why: 'الهامش يُقرأ من ورقة هذه الصفقة لا من ورقة صفقة غيرها', ...PRICER, doc_key: 'sheet_id' }],
    next: 'جهّز ورقة التسعير لهذه الصفقة واعتمدها بمقاعدها الأربعة' });
  const version = versionRow(db, x.current_version_id), f = versionFigures(version);
  if (f.valid_until < on) refuse(409, 'quotation_expired', { what: `صلاحية النسخة ${f.revision} من عرض السعر ${x.code} انتهت في ${f.valid_until}`,
    missing: [{ document: 'نسخة سارية من عرض السعر', why: 'عرض منتهي الصلاحية ما يُبنى عليه اتفاق', ...PRICER, doc_key: 'quotation_id' }],
    next: 'أصدر نسخة جديدة من عرض السعر بتاريخ صلاحية جديد، ثم احفظ عليها' });
  if (snapshot.currency !== 'SAR') refuse(409, 'quotation_currency', { what: `نسخة العرض بعملة ${snapshot.currency}، وعرض سعر العميل بالريال وحده`,
    missing: [{ document: 'نسخة عرض بالريال', why: 'المستند المُلزِم بالريال، والمنصة ما عندها سياسة سعر صرف معتمدة', owner, owner_role: 'account_manager', doc_key: 'currency' }],
    next: 'احفظ نسخة العرض بالريال' });
  const quoteTotal = Number(snapshot.total_minor);
  if (quoteTotal !== f.grand_total_minor) refuse(409, 'quotation_total_mismatch', {
    what: `إجمالي نسخة العرض ${amount(quoteTotal)} (قبل الضريبة ${amount(snapshot.net_minor)} والضريبة ${amount(snapshot.tax_minor)}) ما يساوي إجمالي عرض السعر ${x.code} ${amount(f.grand_total_minor)} (قبل الضريبة ${amount(f.net_pre_tax_minor + f.admin_fee_minor)} والضريبة ${amount(f.vat_minor)})`,
    missing: [{ document: 'بنود عرض بإجمالي عرض السعر نفسه', why: 'الاتفاق يكون على ما قبله العميل بالهللة، لا على رقم ثاني', owner, owner_role: 'account_manager', doc_key: 'lines' }],
    next: 'عدّل أسعار البنود لين يساوي الإجمالي عرض السعر، أو أصدر نسخة عرض سعر جديدة بالرقم الصحيح' });
  const rates = [...new Set(snapshot.lines.map(l => Number(l.tax_basis_points)))];
  if (rates.some(rate => rate !== f.vat_rate_bp)) refuse(409, 'quotation_tax_mismatch', {
    what: `نسبة الضريبة في بنود العرض (${rates.map(percent).join('، ')}) غير نسبة عرض السعر ${percent(f.vat_rate_bp)}`,
    missing: [{ document: 'بنود بنسبة ضريبة عرض السعر', why: 'الفاتورة تخرج بنسبة ما قبله العميل', owner, owner_role: 'account_manager', doc_key: 'lines' }],
    next: 'اكتب نسبة الضريبة نفسها في كل بند' });
  return { quotation: x, version, sheet, figures: f };
}
export function writeQuoteBinding(db, u, c, quoteId, checked) {
  db.prepare('INSERT INTO commercial_quote_proposals(quote_id,case_id,tenant_id,quotation_id,quotation_version_id,sheet_id,quote_total_minor,quotation_total_minor,vat_rate_bp,bound_by,bound_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(quoteId, c.id, c.tenant_id, checked.quotation.id, checked.version.id, checked.sheet.id, checked.figures.grand_total_minor, checked.figures.grand_total_minor, checked.figures.vat_rate_bp, u.id, now());
  return { quotation_id: checked.quotation.id, quotation_code: checked.quotation.code, version_id: checked.version.id, revision: checked.figures.revision, sheet_id: checked.sheet.id };
}

/* ───── اعتماد العرض ───── */
// العرض المربوط: نسخة عرض السعر ما زالت الحالية ولم يرفضها العميل، والهامش داخل السلطة اليوم. يعيد القراءة لتُحفظ مع القرار.
export function requireProposalForApproval(db, c, quote, stage = 'اعتماد العرض', on = riyadhToday()) {
  const binding = quoteBinding(db, quote.id), owner = ownerOf(db, c);
  if (!binding) refuse(409, 'quote_unbound', { what: `نسخة العرض ${quote.revision} ما هي مربوطة بعرض سعر العميل (FRM-024)`,
    missing: [{ document: 'نسخة عرض محفوظة على عرض سعر العميل اللي تساويه', why: 'العرض المُلزِم هو عرض سعر العميل، وعليه يُقرأ الهامش واستثناؤه؛ النسخة انحفظت قبل هذا الربط', owner, owner_role: 'account_manager', doc_key: 'quotation_id' }],
    next: 'يرفض المعتمد هذه النسخة بسببها، ثم يحفظ صاحب الصفقة نسخة جديدة على عرض السعر' });
  const x = quotationRow(db, c.tenant_id, binding.quotation_id), version = versionRow(db, binding.quotation_version_id);
  if (x.status === 'rejected' || x.current_version_id !== binding.quotation_version_id) refuse(409, 'quotation_revised', {
    what: x.status === 'rejected' ? `عرض السعر ${x.code} رفضه العميل` : `عرض السعر ${x.code} صدرت له نسخة أحدث من النسخة ${version.revision} المربوطة`,
    missing: [{ document: 'نسخة عرض على آخر نسخة من عرض السعر', why: 'الاعتماد على سعر ما عاد هو المعروض اعتمادٌ على ما لم يعد قائمًا', owner, owner_role: 'account_manager', doc_key: 'quotation_id' }],
    next: 'ارفض هذه النسخة بسببها، ويحفظ صاحب الصفقة نسخة على آخر نسخة من عرض السعر' });
  const reading = marginAuthority(db, c.tenant_id, { sheet_id: binding.sheet_id, version }, on);
  if (!reading.satisfied) refuseMargin(db, c, reading, stage);
  return { binding, quotation: x, version, reading };
}
export const marginEvidence = ({ binding, quotation, version, reading }) => ({ margin_authority: {
  quotation_id: quotation.id, quotation_code: quotation.code, quotation_version_id: version.id, revision: version.revision, sheet_id: binding.sheet_id,
  target_margin_bp: reading.target_margin_bp, net_margin_bp: reading.net_margin_bp, below_target: reading.below_target,
  margin_exception_id: reading.covering_exception_id, margin_exception_code: reading.below_target ? reading.exception?.code ?? null : null, read_on: reading.on } });

/* ───── توثيق الاتفاق ───── */
// العميل قبل عرض السعر المربوط بنسخته نفسها، والهامش داخل السلطة يوم صدر العرض. يعيد ما يُكتب في الربط.
export function requireAcceptedProposal(db, c, quote) {
  const owner = ownerOf(db, c), binding = quoteBinding(db, quote.id);
  if (!binding) refuse(409, 'quote_unbound', { what: `نسخة العرض ${quote.revision} ما هي مربوطة بعرض سعر العميل (FRM-024)`,
    missing: [{ document: 'نسخة عرض محفوظة على عرض سعر العميل ومعتمدة', why: 'الاتفاق يُسجَّل على ما قبله العميل', owner, owner_role: 'account_manager', doc_key: 'quotation_id' }],
    next: 'احفظ نسخة عرض على عرض السعر وارفعها للاعتماد، ثم وثّق الاتفاق' });
  const x = quotationRow(db, c.tenant_id, binding.quotation_id), version = versionRow(db, binding.quotation_version_id);
  if (x.status !== 'accepted' || x.current_version_id !== binding.quotation_version_id) refuse(409, 'quotation_not_accepted', {
    what: x.status === 'accepted' ? `عرض السعر ${x.code} انقبل على نسخة غير النسخة ${version.revision} المربوطة بالعرض` : `عرض السعر ${x.code} ${QUOTATION_STATUS[x.status] ?? x.status}، وما سجّل أحد قبول العميل`,
    missing: [{ document: `قبول العميل لعرض السعر ${x.code} بنسخته ${version.revision}`, why: 'الاتفاق يكون على السعر الذي قبله العميل بنسخته نفسها',
      ...(x.status === 'draft' ? { owner: 'جهة إصدار عرض السعر بقرار المالك', owner_role: 'pricing' } : PRICER), doc_key: 'quotation_accepted' }],
    next: x.status === 'draft' ? 'يصدر العرض للعميل من «عروض الأسعار»، وبعد قبوله يُسجَّل القبول ثم يتوثّق الاتفاق' : 'سجّل قبول العميل في «عروض الأسعار»، ثم وثّق الاتفاق' });
  const issuedOn = riyadhDateOf(x.issued_at);
  const reading = marginAuthority(db, c.tenant_id, { sheet_id: binding.sheet_id, version }, issuedOn);
  if (!reading.satisfied) refuseMargin(db, c, reading, `توثيق الاتفاق على عرض صدر في ${issuedOn}`);
  return { binding, quotation: x, version, reading };
}
export function writeContractBinding(db, u, c, contractId, quote, { binding, quotation, version, reading }) {
  db.prepare('INSERT INTO commercial_contract_proposals(contract_id,case_id,tenant_id,quote_id,quotation_id,quotation_version_id,sheet_id,target_margin_bp,net_margin_bp,margin_exception_id,bound_by,bound_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(contractId, c.id, c.tenant_id, quote.id, quotation.id, version.id, binding.sheet_id, reading.target_margin_bp, reading.net_margin_bp, reading.covering_exception_id, u.id, now());
  return { quotation_id: quotation.id, quotation_code: quotation.code, quotation_version_id: version.id, revision: version.revision,
    target_margin_bp: reading.target_margin_bp, net_margin_bp: reading.net_margin_bp, margin_exception_id: reading.covering_exception_id };
}

/* ───── ما تقرؤه الشاشة على الصفقة ───── */
function bindingView(db, tenantId, row, on) {
  if (!row) return null;
  const x = quotationRow(db, tenantId, row.quotation_id), version = versionRow(db, row.quotation_version_id), sheet = sheetRow(db, row.sheet_id), f = versionFigures(version);
  return { quotation_id: x.id, quotation_code: x.code, quotation_status: x.status, quotation_status_name: QUOTATION_STATUS[x.status] ?? x.status,
    revision: f.revision, current: x.current_version_id === version.id, valid_until: f.valid_until, sheet_id: sheet.id, sheet_code: sheet.code, sheet_name: sheet.name,
    grand_total_minor: f.grand_total_minor, vat_rate_bp: f.vat_rate_bp, margin: marginAuthority(db, tenantId, { sheet_id: sheet.id, version }, on) };
}
export function proposalView(db, c, { candidates = false } = {}) {
  const on = riyadhToday(), current = bindingView(db, c.tenant_id, quoteBinding(db, c.current_quote_id), on), contract = contractBinding(db, c.id);
  return { quote: current,
    contract: contract ? { ...bindingView(db, c.tenant_id, contract, on), target_margin_bp: contract.target_margin_bp, net_margin_bp: contract.net_margin_bp,
      margin_exception_code: contract.margin_exception_id ? db.prepare('SELECT code FROM margin_exceptions WHERE id=?').get(contract.margin_exception_id)?.code ?? null : null,
      bound_by_name: personName(db, contract.bound_by), bound_at: contract.bound_at } : null,
    candidates: candidates ? proposalCandidates(db, c, on) : [] };
}

/* ───── إنهاء العقد ───── */
// السجل الذي أنهى اتفاق الصفقة، إن وُجد. الإنهاء في سجل العقود (contract_records.status='terminated') هو المصدر الواحد.
export function terminationOf(db, caseId) {
  const r = db.prepare(`SELECT r.id,r.number,r.terminated_at,r.terminated_by,r.termination_note FROM contract_records r
    JOIN commercial_contracts k ON k.id=r.commercial_contract_id WHERE k.case_id=? AND r.status='terminated'`).get(caseId);
  return r ? { record_id: r.id, number: r.number, terminated_at: r.terminated_at, terminated_on: riyadhDateOf(r.terminated_at), terminated_by_name: personName(db, r.terminated_by), note: r.termination_note } : null;
}
export function refuseTerminated(db, caseId, what) {
  const t = terminationOf(db, caseId);
  if (!t) return;
  refuse(409, 'contract_terminated', { what: `${what}: العقد ${t.number} انتهى بإنهاء مسجّل في ${t.terminated_on}`,
    missing: [{ document: `عقد ساري بدل العقد ${t.number}`, why: `الإنهاء سجّله ${t.terminated_by_name ?? 'مالك العقد'}، وبعده ما يُسلَّم ولا يُستحق على هذا الاتفاق شي جديد`, owner: 'مالك العقد في «سجل العقود»', owner_role: 'account_manager', doc_key: 'contract_record' }],
    next: 'إذا رجع العميل بعمل جديد، تنفتح له صفقة جديدة تسمّي هذه سابقتها' });
}

/* ───── ورقة تسعير المشروع (استلام المشروع PM-01) ───── */
// ورقة صفقة المشروع: ما رُبط به اتفاقها، وإلا ما رُبطت به نسخة عرضها الحالية. null لمشروع بلا صفقة أو صفقة بلا ربط.
export function dealSheetOfProject(db, projectId) {
  const c = db.prepare('SELECT id,current_quote_id FROM commercial_cases WHERE project_id=?').get(projectId);
  if (!c) return null;
  return contractBinding(db, c.id)?.sheet_id ?? quoteBinding(db, c.current_quote_id)?.sheet_id ?? null;
}
// الصفقة التي رُبطت بها الورقة، إن رُبطت.
export const sheetDeal = (db, sheetId) => db.prepare('SELECT case_id FROM commercial_quote_proposals WHERE sheet_id=? LIMIT 1').get(sheetId)?.case_id ?? null;
