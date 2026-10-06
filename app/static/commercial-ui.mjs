// الحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const statusNames = {
  lead: 'عميل محتمل', qualification_pending: 'التأهيل بانتظار الاعتماد', qualification_rejected: 'التأهيل مرفوض', qualified: 'تأهيل معتمد',
  quote_draft: 'مسودة عرض', quote_pending: 'العرض بانتظار الاعتماد', quote_rejected: 'العرض مرفوض', quote_approved: 'عرض معتمد',
  contracted: 'اتفاق داخلي موثق', project_active: 'مشروع قيد التنفيذ', pending: 'بانتظار القرار', pending_epmo: 'بانتظار مراجعة EPMO', approved: 'معتمد', rejected: 'مرفوض', changes_required: 'يحتاج تعديلات'
};
const actionNames = {
  create_lead: 'إضافة عميل محتمل', qualify: 'تقديم التأهيل', approve_qualification: 'اعتماد التأهيل', reject_qualification: 'رفض التأهيل',
  save_quote: 'حفظ نسخة عرض', submit_quote: 'تقديم العرض للاعتماد', approve_quote: 'اعتماد العرض', reject_quote: 'رفض العرض',
  register_contract: 'توثيق الاتفاق الداخلي', create_project: 'تحويل الاتفاق إلى مشروع', submit_delivery: 'تقديم مخرج للقبول',
  accept_delivery: 'توثيق قبول مخرج', create_change: 'طلب تغيير النطاق', approve_change: 'اعتماد طلب تغيير', reject_change: 'رفض طلب تغيير', start_change: 'إنشاء مهمة التغيير المعتمد',
  record_payment_terms: 'تسجيل جدول الدفعات وشرط أمر الشراء', record_client_po: 'تسجيل أمر شراء العميل', confirm_client_po: 'تأكيد أمر الشراء بالأصل',
  request_readiness_waiver: 'طلب إعفاء من شرط بدء', authorise_readiness_waiver: 'اعتماد طلب إعفاء', decline_readiness_waiver: 'رفض طلب إعفاء', withdraw_readiness_waiver: 'سحب إعفاء قائم',
  close_lost: 'إغلاق الصفقة خاسرة', withdraw: 'سحب الصفقة',
  submit_private_proposal_checklist: 'تقديم قائمة العرض للقطاع الخاص', submit_government_proposal_checklist: 'تقديم قائمة العرض للجهات الحكومية', review_proposal_checklist: 'مراجعة قائمة العرض الفني'
};
// الخسارة والسحب (الترحيل 180): سبب من قائمة أسباب الخسارة السارية في «خط الفرص» ودرس مكتوب، والصفقة بعدها نهائية.
// بلا قائمة يرفضهما الخادم (loss_reason_required)، فلا يُرسم زرّاهما ويُقال من يضيف الأسباب.
const closingActions = new Set(['close_lost', 'withdraw']);
const riyadhDay = stamp => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(stamp));
// شهادة الإنجاز (ترحيل 164): إجراءاتها على لوحة /completion-certificates، ومعرّفها المشروع للإصدار ونسخة الشهادة لما بعده.
const certificateActionNames = { issue_certificate: 'إصدار شهادة الإنجاز', accept_certificate: 'تسجيل قبول العميل', correct_certificate: 'تصحيح بنسخة جديدة', reverse_certificate: 'عكس الشهادة' };
// أفعال جاهزية البدء تُحسب في الخادم لكل قارئ (caseReadiness في app/project-axes.mjs) بقواعد دوالها نفسها؛ الشاشة ترسم ما وصلها.
const readinessActions = new Set(['record_payment_terms', 'record_client_po', 'confirm_client_po', 'request_readiness_waiver', 'authorise_readiness_waiver', 'decline_readiness_waiver', 'withdraw_readiness_waiver']);
const yesNo = [{ value: 'yes', label: 'نعم' }, { value: 'no', label: 'لا' }];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const currencyOptions = ['SAR', 'USD', 'EUR'].map(value => ({ value, label: { SAR: 'ريال سعودي SAR', USD: 'دولار أمريكي USD', EUR: 'يورو EUR' }[value] }));
const decimal = minor => {
  const value = BigInt(minor ?? '0'), negative = value < 0n, absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};
const textField = (name, label, value = '', required = true) => ({ name, label, value, required, type: 'text' });
const longField = (name, label, value = '') => ({ ...textField(name, label, value), type: 'textarea' });
const dateField = (name, label, value = '') => ({ ...textField(name, label, value), type: 'date' });
const selectField = (name, label, options, value = '', required = true) => ({ name, label, options, value, required, type: 'select' });

// إقفال المشروع (ترحيل 163): الشاشة تعرض القائمتين كما يقيّمهما الخادم الآن وسجل كل إقفال سابق، وترسم زر كل إجراء
// يسمح به الخادم لهذا الحساب. الخادم يعيد الفحص عند الحفظ، ويرد باسم كل بند باقٍ ومن يحسمه.
const closureActionNames = { close_technically: 'الإقفال الفني', accept_margin: 'قبول نتيجة الهامش', close_financially: 'الإقفال المالي',
  close_finally: 'الإقفال النهائي', reopen_closure: 'إعادة فتح الإقفال' };
function checklistItems(lines, e) {
  return `<ul>${lines.map(l => `<li><strong>${e(l.label)}</strong> — ${l.outstanding.length ? `باقي ${e(l.outstanding.length)}` : 'سليم'} · فُحص ${e(l.checked)}`
    + l.outstanding.map(i => `<br>${e(i.item)} — ${e(i.owner)}${l.decidable ? '' : ' <span class="subtle">(ما ينطوي بقرار)</span>'}`).join('')
    + l.not_applicable.map(n => `<br><span class="subtle">ما له مصدر في المنصة: ${e(n.topic)} — ${e(n.reason)}</span>`).join('') + '</li>').join('')}</ul>`;
}
function closurePanel(closures, { e, button }) {
  const projects = (closures?.projects ?? []).filter(p => p.closure.allowed_actions.length || p.closure.records.length || p.closure.state !== 'open');
  if (!projects.length) return '';
  const remaining = lines => lines.reduce((n, l) => n + l.outstanding.length, 0);
  return `<section class="panel"><div class="panel-head"><h2>إقفال المشاريع</h2></div><div class="panel-body"><p class="subtle">${e(closures.note)}</p>${projects.map(p => {
    const c = p.closure, margin = c.margin;
    const records = c.records.length ? `<details><summary>سجل الإقفال (${e(c.records.length)})</summary><ul>${c.records.map(r => `<li>${e(r.lock_name)} · ${e(r.closed_by_name)} · ${e(r.closed_at.slice(0, 10))} · ${r.in_force ? 'ساري' : r.ended?.cascaded ? 'انتهى مع إعادة فتح ما بُني عليه' : 'انتهى بإعادة فتح'}${r.origin === 'carried' ? ' · منقول من قبل حفظ القوائم' : ''}<br>${e(r.note)}</li>`).join('')}</ul></details>` : '';
    const reopenings = c.reopenings.length ? `<details><summary>إعادات الفتح (${e(c.reopenings.length)})</summary><ul>${c.reopenings.map(r => `<li>${e(closures.lock_names[r.scope] ?? r.scope)} · ${e(r.reopened_by_name)} · ${e(r.reopened_at.slice(0, 10))}<br>${e(r.reason)}</li>`).join('')}</ul></details>` : '';
    const marginLine = margin.accepted ? `الهامش: قبله ${e(margin.accepted_by_name)}${margin.current ? '' : ' — وتغيّر بعد قبوله'}` : 'الهامش: ما انقبل للحين';
    return `<article class="notice"><p><strong>${e(p.name)}</strong> · ${e(c.state_name)}</p><p class="subtle">الفني: ${remaining(c.technical_checklist) ? `باقي ${e(remaining(c.technical_checklist))}` : 'جاهز أو مقفل'} · المالي: ${remaining(c.financial_checklist) ? `باقي ${e(remaining(c.financial_checklist))}` : 'جاهز أو مقفل'} · ${marginLine}</p>`
      + `<details><summary>قائمة الإقفال الفني</summary>${checklistItems(c.technical_checklist, e)}</details><details><summary>قائمة الإقفال المالي</summary>${checklistItems(c.financial_checklist, e)}</details>`
      + records + reopenings + (c.allowed_actions.length ? `<div class="operation-actions">${c.allowed_actions.map(action => button(action, p.id, closureActionNames[action])).join('')}</div>` : '') + '</article>';
  }).join('')}</div></section>`;
}
function closureForm(action, id, data) {
  const project = data.closures?.projects.find(p => p.id === id);
  if (!project || !project.closure.allowed_actions.includes(action)) throw new Error('الإجراء ما عاد متاحًا لهالمشروع. حدّث الشاشة.');
  const c = project.closure, endpoint = `/projects/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, title = `${closureActionNames[action]} · ${project.name}`;
  if (action === 'close_technically' || action === 'close_financially') {
    const technical = action === 'close_technically', lines = technical ? c.technical_checklist : c.financial_checklist;
    const decidable = [...new Map(lines.filter(l => l.decidable).flatMap(l => l.outstanding).map(item => [item.ref, item])).values()];
    const digest = technical ? c.technical_digest : c.financial_digest;
    return { title, endpoint, fields: [
      longField('note', technical ? 'خلاصة الإقفال الفني (20 حرفًا على الأقل)' : 'خلاصة الإقفال المالي (20 حرفًا على الأقل)'),
      ...decidable.map((item, index) => ({ ...longField(`decision_${index}`, `قرار على: ${item.item}`), required: false, hint: 'اتركه فاضي إذا بتحسمه من مساره؛ القرار 20 حرفًا على الأقل ويبقى في سجل الإقفال' })),
      { ...textField('same_person_reason', 'سبب اجتماع القفلين في يدك'), required: false, hint: 'بس إذا كنت أنت اللي سجّل القفل الثاني وعندك صلاحية التجاوز' }],
      toPayload: values => ({ note: values.note, checklist_digest: digest,
        decisions: decidable.map((item, index) => ({ ref: item.ref, resolution: (values[`decision_${index}`] ?? '').trim() })).filter(d => d.resolution),
        ...(values.same_person_reason?.trim() ? { same_person_reason: values.same_person_reason.trim() } : {}) }) };
  }
  if (action === 'accept_margin') {
    const m = c.margin, figure = m.visible ? `الهامش الفعلي ${decimal(m.figures.margin_minor)} ريال${m.figures.planned ? ` مقابل المخطط ${decimal(m.figures.planned.margin_minor)}` : ''}` : 'الهامش';
    return { title, endpoint, fields: [longField('note', `أساس قبول ${figure}: المخطط والفعلي وسبب الفرق (20 حرفًا على الأقل)`)],
      toPayload: values => ({ note: values.note, figures_digest: m.digest }) };
  }
  if (action === 'close_finally') return { title, endpoint, fields: [longField('profitability_note', 'خلاصة الربحية: المخطط والفعلي وسبب الفرق'), longField('lessons', 'الدروس المستفادة')],
    toPayload: values => ({ version: c.version, profitability_note: values.profitability_note, lessons: values.lessons }) };
  const scopes = [['technical', c.technical_state], ['financial', c.financial_state], ['final', c.final_state]].filter(([, state]) => state === 'closed')
    .map(([scope]) => ({ value: scope, label: data.closures.lock_names[scope] }));
  return { title, endpoint, fields: [selectField('scope', 'اللي ينفتح (فتح الفني يفتح المالي والنهائي معه)', scopes, scopes[0]?.value), longField('reason', 'سبب إعادة الفتح (20 حرفًا على الأقل)')],
    toPayload: values => ({ version: c.version, scope: values.scope, reason: values.reason }) };
}

// عرض سعر العميل (FRM-024) الذي تُحفظ عليه النسخة (الترحيل 182، القرار D2): من عروض عميل الصفقة التي يرسلها الخادم، والإجمالي يساويه.
function quotationField(row) {
  const options = (row.proposal?.candidates ?? []).map(q => ({ value: q.id, label: `${q.code} · النسخة ${q.revision} · ${decimal(q.grand_total_minor)} SAR · ${q.status_name}${q.expired ? ' · انتهت صلاحيته' : ''}` }));
  const bound = row.proposal?.quote?.quotation_id, chosen = options.some(o => o.value === bound) ? bound : options[0]?.value;
  return { ...selectField('quotation_id', 'عرض سعر العميل (FRM-024) اللي تساويه النسخة', options, chosen),
    hint: options.length ? 'إجمالي البنود يساوي إجمالي العرض بالهللة وبنسبة ضريبته؛ والهامش يُقرأ من ورقة تسعيره' : 'ما فيه عرض سعر لهذا العميل للحين: جهّز ورقة التسعير وعرض السعر من «التسعير»، ثم ارجع' };
}
function quoteFields(row) {
  const current = row.current_quote?.snapshot;
  const fields = [quotationField(row), longField('scope', 'نطاق العرض والمخرجات والاستثناءات', current?.scope), selectField('currency', 'عملة العرض المطابقة للتأهيل', currencyOptions, current?.currency ?? row.qualifications?.at(-1)?.snapshot.currency), dateField('valid_until', 'آخر يوم لصلاحية العرض', current?.valid_until)];
  for (let index = 0; index < Math.max(3, current?.lines.length ?? 0); index++) {
    const line = current?.lines[index], prefix = `line_${index}_`, label = `البند ${index + 1}`;
    const required = index === 0;
    fields.push(textField(prefix + 'description', `${label}: الوصف${required ? '' : ' (اتركه فاضي إذا ما تبي البند)'}`, line?.description, required));
    fields.push({ ...textField(prefix + 'quantity', `${label}: الكمية الصحيحة`, line?.quantity ?? '1', required), type: 'number', min: 1, max: 999999, step: 1 });
    for (const [key, title] of [['unit_price', 'سعر الوحدة'], ['unit_cost', 'تكلفة الوحدة'], ['discount', 'خصم البند قبل الضريبة'], ['tax_rate', 'نسبة الضريبة المدخلة للمراجعة %']]) {
      const existing = key === 'tax_rate' ? line?.tax_basis_points : line?.[key + '_minor'];
      fields.push(textField(prefix + key, `${label}: ${title}`, existing === undefined ? (key === 'discount' ? '0.00' : '') : decimal(existing), required));
    }
    fields.push({ ...longField(prefix + 'acceptance', `${label}: معيار القبول`, line?.acceptance), required });
    fields.push({ ...textField(prefix + 'revisions', `${label}: عدد المراجعات المشمولة`, line?.revisions ?? '0', required), type: 'number', min: 0, max: 20, step: 1 });
  }
  return fields;
}
function certificateForm(action, id, data) {
  const board = data.certificates, entries = Object.values(board?.cases ?? {});
  const approverOptions = entry => (entry?.approvers ?? []).map(approver => ({ value: approver.id, label: `${approver.name} — ${approver.title}` }));
  if (action === 'issue_certificate') {
    const entry = entries.find(item => item.project_id === id);
    if (!entry?.issue?.allowed) throw new Error('إصدار الشهادة مو متاح الحين. أعد تحميل الملف.');
    return { title: certificateActionNames[action], endpoint: `/projects/${encodeURIComponent(id)}/completion-certificate`, idempotent: true,
      fields: [selectField('approver_id', 'ممثل العميل المفوّض (من سجل موافقات العملاء)', approverOptions(entry), entry.approvers[0]?.id), longField('scope_summary', 'وش أُنجز بالضبط؟ ملخص يطابق بنود الاتفاق'), longField('evidence', 'مرجع تقرير إنجاز المشروع')],
      toPayload: values => ({ approver_id: values.approver_id, scope_summary: values.scope_summary, evidence: values.evidence }) };
  }
  const entry = entries.find(item => item.certificates.some(certificate => certificate.id === id)), certificate = entry?.certificates.find(item => item.id === id);
  if (!certificate || !certificate.actions.includes(action)) throw new Error('هالإجراء غير متاح لك الحين. حدّث الملف.');
  const version = certificate.version, title = `${certificateActionNames[action]} · ${certificate.number}`, endpoint = step => `/completion-certificates/${encodeURIComponent(id)}/${step}`;
  if (action === 'accept_certificate') return { title, endpoint: endpoint('acknowledge'),
    fields: [selectField('channel', 'كيف وصلنا قبول العميل؟ (دليل خارجي، مو توقيع إلكتروني)', board.channels.map(channel => ({ value: channel.key, label: channel.name })), 'email'), dateField('received_on', 'متى وصل القبول؟', board.today), longField('evidence', 'مرجع الدليل الخارجي: الرسالة أو المحضر أو التأكيد المكتوب للاتصال')],
    toPayload: values => ({ version, channel: values.channel, received_on: values.received_on, evidence: values.evidence }) };
  if (action === 'correct_certificate') return { title, endpoint: endpoint('correct'), idempotent: true,
    fields: [longField('reason', 'وش كان غلط في هذي النسخة؟ السبب يبقى في سجلها'), selectField('approver_id', 'ممثل العميل المفوّض', approverOptions(entry), certificate.client_representative.approver_id ?? entry.approvers[0]?.id), longField('scope_summary', 'وش أُنجز بالضبط؟', certificate.scope_summary), longField('evidence', 'مرجع تقرير إنجاز المشروع', certificate.evidence)],
    toPayload: values => ({ version, reason: values.reason, approver_id: values.approver_id, scope_summary: values.scope_summary, evidence: values.evidence }) };
  return { title, endpoint: endpoint('reverse'), fields: [longField('reason', 'ليش تعكس الشهادة؟ السبب يبقى في سجلها')], toPayload: values => ({ version, reason: values.reason }) };
}
function quotePayload(values, fieldCount) {
  const lines = [];
  for (let index = 0; index < fieldCount; index++) {
    const prefix = `line_${index}_`;
    if (!values[prefix + 'description']?.trim()) continue;
    const line = Object.fromEntries(['description', 'quantity', 'unit_price', 'unit_cost', 'discount', 'tax_rate', 'acceptance'].map(key => [key, values[prefix + key]]));
    if (Object.values(line).some(value => typeof value !== 'string' || !value.trim())) throw new Error(`كمّل بيانات البند ${index + 1}، أو امسح وصفه إذا ما تبيه`);
    line.revisions = Number(values[prefix + 'revisions']);
    lines.push(line);
  }
  return { scope: values.scope, currency: values.currency, valid_until: values.valid_until, lines, quotation_id: values.quotation_id };
}

// نماذج جاهزية البدء: كل نموذج يصل مسار العمود الفقري نفسه، ويرسل روابط الملف كما قرأها (الاتفاق والمشروع والعميل)
// فيطابقها الخادم مع الملف ويرفض ما لا يخصه — لا يثق بما يرسله النموذج.
function readinessForm(action, row) {
  const r = row?.readiness;
  if (!r || !r.actions.includes(action)) throw new Error('هالإجراء غير متاح لك الحين. حدّث الملف.');
  const title = `${actionNames[action]} · ${row.name}`, current = r.client_purchase_order?.current ?? null, projectId = r.refs.project_id;
  if (action === 'record_payment_terms') {
    // كل دفعة بنوع شرطها (الترحيل 183): مقدمة تحل بتوثيق الاتفاق، أو تحل بقبول بنود يختارها من بنود الاتفاق نفسه.
    const agreementLines = (row.current_quote?.snapshot?.lines ?? []).map((line, index) => ({ value: String(index), label: `البند ${index + 1}: ${line.description}` }));
    const fields = [selectField('requires_client_po', 'الاتفاق يشترط أمر شراء من العميل قبل البدء؟', yesNo, '')];
    for (let index = 0; index < 4; index++) {
      const prefix = `term_${index}_`, label = `الدفعة ${index + 1}`, required = index === 0;
      fields.push(textField(prefix + 'label', `${label}: الوصف${required ? '' : ' (اتركه فاضي إذا ما تبيها)'}`, '', required), textField(prefix + 'amount', `${label}: المبلغ شامل الضريبة`, '', required),
        { ...dateField(prefix + 'due_on', `${label}: التاريخ المتوقع`), required },
        selectField(prefix + 'kind', `${label}: متى تحل؟`, [{ value: 'acceptance', label: 'عند قبول بنود من الاتفاق' }, { value: 'advance', label: 'دفعة مقدمة عند توقيع الاتفاق' }], 'acceptance', required),
        { name: prefix + 'lines', label: `${label}: البنود اللي قبولها يفتحها`, type: 'checks', options: agreementLines, value: [], required: false,
          hint: 'للدفعة عند القبول: اختر بنودها، والبند الواحد يفتح دفعة وحدة. المقدمة ما لها بنود.' },
        textField(prefix + 'condition', `${label}: ملاحظة على الشرط`, '', false));
    }
    return { title, endpoint: `/commercial/${encodeURIComponent(row.id)}/payment-terms`, fields, toPayload: values => {
      const terms = [0, 1, 2, 3].filter(index => values[`term_${index}_label`]?.trim()).map(index => {
        const kind = values[`term_${index}_kind`] === 'advance' ? 'advance' : 'acceptance';
        return { label: values[`term_${index}_label`], amount: values[`term_${index}_amount`], due_on: values[`term_${index}_due_on`], condition: values[`term_${index}_condition`] ?? '',
          condition_kind: kind, condition_lines: kind === 'advance' ? [] : (values[`term_${index}_lines`] ?? []).map(Number), is_advance: kind === 'advance' };
      });
      return { terms, requires_client_po: values.requires_client_po === 'yes' };
    } };
  }
  if (action === 'record_client_po') return { title: current ? `نسخة جديدة من أمر الشراء تحل محل النسخة ${current.revision} · ${row.name}` : title,
    endpoint: `/commercial/${encodeURIComponent(row.id)}/purchase-order`, idempotent: true,
    fields: [textField('po_number', 'رقم أمر الشراء زي ما هو في أصله', current?.po_number), dateField('issued_on', 'تاريخ إصداره', current?.issued_on ?? today()), dateField('valid_until', 'آخر يوم لصلاحيته', current?.valid_until ?? ''),
      textField('amount', `قيمته شاملة الضريبة (${row.current_quote?.snapshot?.currency ?? 'SAR'})`, current ? decimal(current.amount_minor) : ''), longField('scope', 'النطاق المذكور في أمر الشراء', current?.scope),
      textField('customer_representative', 'ممثل العميل الموقّع عليه'), longField('evidence', 'دليله ومكان حفظ أصله')],
    toPayload: values => ({ ...values, contract_id: r.refs.contract_id, project_id: r.refs.project_id ?? '', client_id: r.refs.client_id, supersedes_id: current?.id ?? '' }) };
  if (action === 'confirm_client_po') return { title: `تأكيد النسخة ${current.revision} من أمر الشراء بعد مقابلتها بالأصل · ${row.name}`,
    endpoint: `/client-purchase-orders/${encodeURIComponent(current.id)}/confirm`, fields: [longField('note', 'اللي قابلته بالأصل: الرقم والقيمة والصلاحية')],
    toPayload: values => ({ version: current.version, note: values.note }) };
  if (action === 'request_readiness_waiver') {
    const names = { client_po: 'أمر شراء العميل', advance: 'الدفعة المقدمة' };
    const options = r.requestable.map(item => ({ value: item, label: names[item] }));
    return { title, endpoint: `/projects/${encodeURIComponent(projectId)}/readiness-waiver-requests`, idempotent: true,
      fields: [selectField('item', 'الشرط المطلوب الإعفاء منه', options, options[0]?.value), longField('reason', 'سبب الإعفاء ومستنده (يعتمده صاحب الصلاحية غيرك)')],
      toPayload: values => ({ item: values.item, reason: values.reason }) };
  }
  const pending = r.requests.filter(q => !q.own).map(q => ({ value: q.id, label: `${q.item_name} — طلبه ${q.requested_by_name}: ${q.reason.slice(0, 80)}`, item: q.item }));
  if (action === 'authorise_readiness_waiver') return { title, endpoint: `/projects/${encodeURIComponent(projectId)}/readiness-waivers`,
    fields: [selectField('request_id', 'طلب الإعفاء', pending, pending[0]?.value), longField('reason', 'سبب اعتمادك للإعفاء ومستنده')],
    toPayload: values => ({ item: pending.find(p => p.value === values.request_id)?.item, reason: values.reason }) };
  if (action === 'decline_readiness_waiver') return { title, dynamicEndpoint: values => `/readiness-waiver-requests/${encodeURIComponent(values.request_id)}/decline`,
    fields: [selectField('request_id', 'طلب الإعفاء', pending, pending[0]?.value), longField('note', 'سبب رفض الإعفاء')], toPayload: values => ({ note: values.note }) };
  const live = r.waivers.map(w => ({ value: w.id, label: `${w.item === 'advance' ? 'الدفعة المقدمة' : 'أمر شراء العميل'} — اعتمده ${w.waived_by_name}` }));
  return { title, dynamicEndpoint: values => `/readiness-waivers/${encodeURIComponent(values.waiver_id)}/withdraw`,
    fields: [selectField('waiver_id', 'الإعفاء', live, live[0]?.value), longField('reason', 'سبب سحب الإعفاء')], toPayload: values => ({ reason: values.reason }) };
}

export const commercialUI = {
  title: 'العملاء والعروض',
  description: 'تأهيل العميل واعتماد نسخة العرض وتوثيق الاتفاق، ثم متابعة المشروع والمخرجات والتغييرات.',
  async load(api) {
    const [rows, team, auth, certificates, closures, proposalReview] = await Promise.all([api('/commercial'), api('/team'), api('/me'), api('/completion-certificates'), api('/project-closures'), api('/technical-proposal-reviews')]);
    // أسباب الخسارة تُقرأ من «خط الفرص» حين يعرض الخادم إغلاقًا على ملف من ملفاتك؛ حسابٌ ما يصل «خط الفرص» يبقى بلا قائمة (null).
    const closing = rows.some(row => (row.allowed_actions ?? []).some(action => closingActions.has(action)));
    const loss_reasons = closing ? await api('/pipeline').then(board => board.loss_reasons.filter(reason => reason.active).map(({ id, code, name }) => ({ id, code, name })), () => null) : [];
    return { rows, team, user: auth.user, certificates, closures, loss_reasons, proposalReview };
  },
  render(data, { e, button, ui = kit(e) }) {
    const amount = (minor, currency) => `${e(decimal(minor))} ${e(currency)}`;
    // جاهزية البدء: الناقص ومالكه بالرفض المكتوب نفسه الذي يصل عند المحاولة، ثم ما بُني عليه — الجدول ونسخ أمر الشراء والإعفاءات.
    const versionState = version => version.superseded ? 'حلّت محلها نسخة أحدث' : version.status === 'void' ? 'ملغاة'
      : version.status !== 'confirmed' ? 'مسجّلة وتنتظر تأكيد غير اللي سجّلها' : version.expired ? 'مؤكدة وانتهت صلاحيتها' : 'مؤكدة وسارية';
    const readinessDetails = row => {
      const r = row.readiness, po = r.client_purchase_order, currency = row.current_quote?.snapshot?.currency ?? 'SAR';
      const blockers = r.blockers.length ? ui.refusal({ what: 'التنفيذ المدفوع واقف على هذا الملف لين تكتمل شروط البدء', missing: r.blockers, next: 'كمّل الناقص، أو اطلب إعفاء بسبب مكتوب يعتمده غيرك' })
        : `<p class="subtle">${r.state === 'not_required' ? 'الاتفاق ما يشترط دفعة مقدمة ولا أمر شراء قبل البدء.' : 'شروط البدء مكتملة، والتنفيذ المدفوع يمشي.'}</p>`;
      const terms = r.terms.length ? `<p>جدول الدفعات: ${r.terms.map(t => `${e(t.label)} ${amount(t.amount_minor, t.currency)}${t.condition_text ? ` (${e(t.condition_text)})` : t.is_advance ? ' (مقدمة)' : ''}`).join(' · ')}</p><p class="subtle">أمر شراء العميل ${r.requires_client_po ? 'شرط قبل البدء' : 'مو شرط في هذا الاتفاق'}.</p>` : '';
      const advance = r.advance?.declared && r.advance.expected_minor !== undefined ? `<p>الدفعة المقدمة: المؤكَّد ${amount(r.advance.confirmed_minor, currency)} من ${amount(r.advance.expected_minor, currency)}${r.advance.reversed_minor ? ` بعد خصم ${amount(r.advance.reversed_minor, currency)} ارتدّت` : ''}</p>` : '';
      const versions = po?.history?.length ? `<ul class="vn-list">${po.history.map(version => `<li><strong>أمر الشراء <bdi>${e(version.po_number)}</bdi> · النسخة ${e(version.revision)}</strong><span>${amount(version.amount_minor, version.currency)} · صادر ${e(version.issued_on)} · صالح لين ${e(version.valid_until ?? '—')}</span><span class="subtle">${e(versionState(version))}</span></li>`).join('')}</ul>` : '';
      const waivers = r.waivers.map(w => `<p>إعفاء من ${e(w.item === 'advance' ? 'الدفعة المقدمة' : 'أمر شراء العميل')}: اعتمده ${e(w.waived_by_name)}${w.requested_by_name ? ` بطلب ${e(w.requested_by_name)}` : ''} — ${e(w.reason)}${w.valid ? '' : ' <small class="subtle">(ما عاد يغطي: معتمده ما عاد عنده صلاحية الإعفاء)</small>'}</p>`).join('');
      const requests = r.requests.map(q => `<p class="subtle">طلب إعفاء من ${e(q.item_name)} ينتظر قرار صاحب الصلاحية — طلبه ${e(q.requested_by_name)}: ${e(q.reason)}</p>`).join('');
      const actions = r.actions.map(action => button(action, row.id, action === 'record_client_po' && po?.current ? 'نسخة جديدة من أمر الشراء' : actionNames[action])).join('');
      return `<details open><summary>جاهزية البدء: ${e(r.state_name)}</summary>${blockers}${terms}${advance}${versions}${waivers}${requests}${actions ? `<div class="operation-actions">${actions}</div>` : ''}</details>`;
    };
    // المقفلة بشكلها وكلمتها: «خسرناها» بشكل التوقف، و«سحبناها» خاملة؛ والكلمة من الخادم (closure.status_name).
    const closingStates = ['lost', 'withdrawn'], reasons = data.loss_reasons ?? [];
    const badge = (status, name) => `<span class="badge ${['approved', 'quote_approved', 'qualified', 'contracted'].includes(status) ? 'approved' : status.includes('pending') || status === 'lead' ? 'pending' : status.includes('rejected') ? 'rejected' : status === 'quote_draft' ? 'draft' : status === 'project_active' ? 'in_progress' : closingStates.includes(status) ? status : ''}">${e(name ?? statusNames[status] ?? status)}</span>`;
    // مكان الخطوة الجاية في الصفقة المقفلة: وش صار — السبب من القائمة والدرس المكتوب ويوم الإقفال.
    const closure = row => {
      const c = row.closure, day = c.closed_at ? riyadhDay(c.closed_at) : '';
      return `<dl class="detail-data"><div><dt>${row.status === 'withdrawn' ? 'سبب السحب' : 'سبب الخسارة'}</dt><dd>${e(c.reason_name ?? '—')}</dd></div><div><dt>وش صار ووش نتعلم</dt><dd class="measure">${e(c.comment)}</dd></div>${day ? `<div><dt>انقفلت</dt><dd><time datetime="${e(day)}">${e(day)}</time></dd></div>` : ''}</dl>`;
    };
    const closingWait = data.loss_reasons === null
      ? 'إغلاق الصفقة خاسرة أو سحبها يحتاج سبب من قائمة أسباب الخسارة في «خط الفرص»، والقائمة ما توصلها بحسابك. اطلب تصريح «المبيعات والتسليم» من مسؤول الصلاحيات.'
      : 'إغلاق الصفقة خاسرة أو سحبها يحتاج سبب من قائمة أسباب الخسارة، وما فيه أسباب خسارة سارية تختار منها. يضيفها مالك الإجراء في «خط الفرص».';
    // عرض سعر العميل المُلزِم (الترحيل 182، القرار D2): ما رُبطت به نسخة العرض والاتفاق، وقراءة الهامش من ورقته. لمن يرى الأرقام وحده.
    const pct = bp => `${(Number(bp) / 100).toFixed(2)}%`, day = value => `<time datetime="${e(value)}">${e(value)}</time>`;
    const marginLine = m => !m ? '' : !m.below_target ? `<p class="subtle">الهامش بعد الخصم ${e(pct(m.net_margin_bp))} يبلغ المستهدف ${e(pct(m.target_margin_bp))}، فما يحتاج استثناء.</p>`
      : m.satisfied ? `<p class="subtle">الهامش بعد الخصم ${e(pct(m.net_margin_bp))} دون المستهدف ${e(pct(m.target_margin_bp))}، ويغطيه الاستثناء <bdi>${e(m.exception.code)}</bdi> لين ${day(m.exception.expires_on)}.</p>`
      : ui.refusal({ what: `الهامش بعد الخصم ${pct(m.net_margin_bp)} دون المستهدف ${pct(m.target_margin_bp)}، والعرض واقف لين يعتمد صاحبه استثناء تسعير`,
        missing: [{ document: 'استثناء تسعير (MOD-BD-03) ساري يغطي الهامش', why: m.exception ? `${m.exception.code}: ${m.exception.status_name}${m.exception.expired ? '، وانتهت صلاحيته' : ''}` : 'ما انطلب استثناء على ورقة هذا العرض', owner: m.owner }],
        next: 'اطلب الاستثناء من ورقة التسعير في «التسعير»' });
    const proposalDetails = row => {
      const p = row.proposal;
      if (row.access !== 'financial' || !p) return '';
      if (!p.quote && !p.contract) return row.current_quote ? '<p class="subtle">نسخة العرض الحالية انحفظت قبل ربط العروض بعرض سعر العميل؛ تنحفظ نسخة جديدة عليه قبل اعتمادها.</p>' : '';
      const bound = p.contract ?? p.quote;
      return `<details open><summary>عرض سعر العميل المُلزِم: <bdi>${e(bound.quotation_code)}</bdi> · النسخة ${e(bound.revision)}</summary>` +
        `<dl class="detail-data"><div><dt>حالته</dt><dd>${e(bound.quotation_status_name)}</dd></div><div><dt>الإجمالي شامل الضريبة</dt><dd>${amount(bound.grand_total_minor, 'SAR')}</dd></div>` +
        `<div><dt>ورقة التسعير</dt><dd><bdi>${e(bound.sheet_code)}</bdi></dd></div><div><dt>صالح لين</dt><dd>${day(bound.valid_until)}</dd></div></dl>` +
        (bound.current ? '' : '<p class="vn-alert">صدرت نسخة أحدث من عرض السعر بعد الربط؛ النسخة المربوطة ما عادت المعروضة على العميل.</p>') +
        (p.contract ? `<p class="subtle">الاتفاق موثّق على هذا العرض بعد قبول العميل، وهامشه وقتها ${e(pct(p.contract.net_margin_bp))} من مستهدف ${e(pct(p.contract.target_margin_bp))}${p.contract.margin_exception_code ? ` باستثناء <bdi>${e(p.contract.margin_exception_code)}</bdi>` : ''}.</p>` : marginLine(p.quote.margin)) + '</details>';
    };
    // العقد المنهى في «سجل العقود» يوقف ما بعده على الصفقة، فيُقال أولًا قبل أي خطوة.
    const terminationNotice = row => row.termination ? `<div class="vn-alert is-block" role="status"><strong>العقد <bdi>${e(row.termination.number)}</bdi> انتهى بإنهاء مسجّل في ${day(row.termination.terminated_on)}</strong><p>بعد الإنهاء ما يتقدّم مخرج ولا يُطلب تغيير ولا يُستحق مبلغ جديد على هذا الاتفاق. وما استُحق قبله يُحصَّل في مساره.</p></div>` : '';
    const rows = data.rows;
    // كتلة الشهادة داخل ملف العميل الذي له مشروع. بيانات بلا لوحة (اختبار قديم أو شاشة لم تحمّلها) لا ترسم شيئًا،
    // ولا تُرسم قبل وقتها: لا شهادة ولا إصدارٌ متاح، فلا سطر.
    const certificateBlock = record => {
      const entry = data.certificates?.cases?.[record.id];
      if (!entry || (!entry.certificates.length && !entry.issue)) return '';
      const items = entry.certificates.map(certificate => {
        const representative = certificate.client_representative, accepted = certificate.acceptance;
        return `<article class="notice"><p><strong><bdi dir="ltr">${e(certificate.number)}</bdi> · الإصدار ${e(certificate.revision)}</strong> <span class="badge ${{ accepted: 'approved', issued: 'pending', reversed: 'rejected' }[certificate.state] ?? ''}">${e(certificate.state_name)}</span></p>` +
          `<p>ممثل العميل: ${e(representative.name)}${representative.title ? ` — ${e(representative.title)}` : ''}${representative.authority_basis ? ` · سند التفويض: ${e(representative.authority_basis)}` : ''}</p>` +
          (accepted ? `<p>قبول العميل: ${e(accepted.channel_name)}${accepted.received_on ? ` بتاريخ ${e(accepted.received_on)}` : ''} · المرجع: <bdi>${e(accepted.evidence_reference)}</bdi> · وثّقه ${e(accepted.recorded_by_name)}</p><p class="subtle">${e(accepted.limitation)}</p>` : '') +
          (certificate.reversal ? `<p class="subtle">سبب العكس: ${e(certificate.reversal.reason)}</p>` : '') +
          `<div class="operation-actions">${certificate.actions.map(action => button(action, certificate.id, certificateActionNames[action])).join('')}<a class="btn outline small" href="/api/completion-certificates/${e(certificate.id)}/document" target="_blank" rel="noopener">عرض الشهادة كمستند<span class="sr-only"> (تنفتح في تبويب جديد)</span></a></div></article>`;
      }).join('');
      const issue = entry.issue?.allowed ? `<div class="operation-actions">${button('issue_certificate', entry.project_id, certificateActionNames.issue_certificate)}</div>` : entry.issue?.blocker ? `<p class="subtle">${e(entry.issue.blocker)}</p>` : '';
      return `<details open><summary>شهادة الإنجاز${entry.certificates.length ? ` (${entry.certificates.length})` : ''}</summary>${items}${issue}<p class="subtle">${e(data.certificates.signature_statement)}</p></details>`;
    };
    const proposalQueue = data.proposalReview?.queue ?? [];
    let html = proposalQueue.length ? `<section class="panel"><div class="panel-head"><div><h2>مراجعات العروض الفنية لدى EPMO</h2><p class="subtle">مراجعة مستقلة لكل بند قبل إرسال نسخة العرض للاعتماد.</p></div></div><div class="panel-body">${proposalQueue.map(item => `<article class="notice"><p><strong>${e(item.client_name)} · النسخة ${e(item.revision)}</strong> ${badge(item.status)}</p><p>${e(item.proposal_type === 'private' ? 'قطاع خاص' : 'جهة حكومية')} · ${e(item.items.length)} بندًا · قدّمها ${e(item.submitted_by_name)}</p>${item.review ? `<p>${e(item.review.note)}</p>` : ''}${item.actions.map(action => button(action, item.id, actionNames[action])).join('')}</article>`).join('')}</div></section>` : '';
    html += `<section class="panel"><div class="panel-head"><h2>ملفات العملاء ضمن نطاقك</h2>${['employee', 'manager'].includes(data.user.role) ? button('create_lead', '', actionNames.create_lead) : ''}</div></section>`;
    html += closurePanel(data.closures, { e, button });
    if (!rows.length) return html + (!proposalQueue.length ? ui.empty('ما فيه ملفات عملاء لك للحين', 'ملف العميل يطلع هنا إذا كنت مالكه أو عضو في مشروعه.') : '');
    html += rows.map(row => {
      const financial = row.access === 'financial', quote = row.current_quote?.snapshot;
      const currentQualification = row.qualifications?.at(-1)?.snapshot;
      const quoteDetails = quote ? `<details open><summary>نسخة العرض ${e(row.current_quote.revision)}</summary><p>${e(quote.scope)}</p>${financial ? `<dl class="detail-data"><div><dt>الإجمالي مع الضريبة</dt><dd>${amount(quote.total_minor, quote.currency)}</dd></div><div><dt>التكلفة المقدرة</dt><dd>${amount(quote.cost_minor, quote.currency)}</dd></div><div><dt>الهامش قبل الضريبة</dt><dd>${amount(quote.margin_minor, quote.currency)}</dd></div><div><dt>صالح حتى</dt><dd>${e(quote.valid_until)}</dd></div></dl>` : '<p class="subtle">عرض التسليم لأعضاء المشروع: النطاق والبنود بدون أرقام.</p>'}<div class="table-wrap"><table><thead><tr><th>البند</th><th>الكمية</th><th>معيار القبول</th>${financial ? '<th>صافي البند</th><th>الضريبة</th>' : ''}</tr></thead><tbody>${quote.lines.map(line => `<tr><td>${e(line.description)}<br><small>المراجعات المشمولة: ${e(line.revisions)}</small></td><td>${e(line.quantity)}</td><td>${e(line.acceptance)}</td>${financial ? `<td>${amount(line.net_minor, quote.currency)}</td><td>${amount(line.tax_minor, quote.currency)}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>` : '';
      const proposal = financial && row.proposal_checklist ? `<details open><summary>قائمة مراجعة العرض الفني ${badge(row.proposal_checklist.status)}</summary><p>${e(row.proposal_checklist.proposal_type === 'private' ? 'قطاع خاص' : 'جهة حكومية')} · الإصدار ${e(row.proposal_checklist.revision)} · ${e(row.proposal_checklist.items.length)} بندًا · المصدر: ${e(row.proposal_checklist.source_reference)}</p>${row.proposal_checklist.review ? `<p><strong>خلاصة EPMO:</strong> ${e(row.proposal_checklist.review.note)}</p>` : '<p class="subtle">ينتظر مراجعة مستقلة من EPMO.</p>'}<div class="table-wrap"><table><thead><tr><th>#</th><th>المحور</th><th>السؤال</th><th>الدليل</th><th>نتيجة EPMO</th></tr></thead><tbody>${row.proposal_checklist.items.map(item => { const reviewed = row.proposal_checklist.review?.items.find(x => x.item_id === item.id); return `<tr><td>${e(item.item_no)}</td><td>${e(item.category)} · ${e(item.axis)}</td><td>${e(item.question)}</td><td>${e(item.evidence)}</td><td>${e(reviewed ? ({ passed: 'مستوفى', gap: 'فجوة', not_applicable: 'لا ينطبق' }[reviewed.result] ?? reviewed.result) : 'بانتظار المراجعة')}${reviewed?.epmo_note ? `<br><small>${e(reviewed.epmo_note)}</small>` : ''}</td></tr>`; }).join('')}</tbody></table></div></details>` : '';
      const qualification = financial && currentQualification ? `<details><summary>التأهيل الموثق</summary><dl class="detail-data"><div><dt>الاحتياج</dt><dd>${e(currentQualification.need)}</dd></div><div><dt>الميزانية المذكورة</dt><dd>${amount(currentQualification.budget_minor, currentQualification.currency)}</dd></div><div><dt>التوقيت</dt><dd>${e(currentQualification.timing)}</dd></div><div><dt>صاحب القرار</dt><dd>${e(currentQualification.decision_maker)}</dd></div><div><dt>ملاءمة الخدمة</dt><dd>${e(currentQualification.service_fit)}</dd></div></dl></details>` : '';
      const deliveries = row.deliveries.length ? `<details open><summary>المخرجات والقبول (${row.deliveries.length})</summary>${row.deliveries.map(delivery => `<article class="notice"><p><strong>البند ${e(delivery.line_index + 1)} · النسخة ${e(delivery.revision)}</strong> ${badge(delivery.review?.status ?? 'pending')}</p><p>${e(delivery.evidence)}</p>${delivery.review?.evidence?.acceptance_evidence ? `<p>دليل القبول: ${e(delivery.review.evidence.acceptance_evidence)}</p><p class="subtle">ممثل العميل: ${e(delivery.review.evidence.customer_representative)}${delivery.review.evidence.approver_title ? ` — ${e(delivery.review.evidence.approver_title)}` : ''}</p>` : ''}</article>`).join('')}</details>` : '';
      const changes = row.changes.length ? `<details open><summary>طلبات تغيير النطاق (${row.changes.length})</summary>${row.changes.map(change => `<article class="notice"><p><strong>${e(change.snapshot.scope)}</strong> ${badge(change.review?.status ?? change.status ?? 'pending')}</p><p>أثر المدة: ${e(change.snapshot.extra_days)} يوم · الموعد: ${e(change.snapshot.due_date)}</p>${financial ? `<p>السعر الإضافي: ${amount(change.snapshot.additional_price_minor, change.snapshot.currency)} · التكلفة: ${amount(change.snapshot.additional_cost_minor, change.snapshot.currency)} · أثر الهامش: ${amount(change.snapshot.margin_delta_minor, change.snapshot.currency)}</p>` : ''}<p>${e(change.snapshot.acceptance)}</p>${change.task_id ? '<p class="subtle">انفتحت مهمة الشغل الإضافي بعد الاعتماد.</p>' : ''}</article>`).join('')}</details>` : '';
      const history = financial && row.reviews.length ? `<details><summary>قرارات المراجعة والنسخ السابقة</summary><div class="timeline">${row.reviews.map(review => `<div class="timeline-item"><strong>${e({ qualification: 'التأهيل', quote: 'العرض', delivery: 'قبول المخرج', change: 'طلب التغيير' }[review.kind])} ${badge(review.status)}</strong><small>${e(review.decided_at ?? review.requested_at)}</small>${review.note ? `<p>${e(review.note)}</p>` : ''}</div>`).join('')}</div>${row.quotes.filter(q => q.id !== row.current_quote_id).map(q => `<details><summary>نسخة العرض السابقة ${e(q.revision)} · ${amount(q.snapshot.total_minor, q.snapshot.currency)}</summary><p>${e(q.snapshot.scope)}</p>${q.snapshot.lines.map(line => `<p>${e(line.description)} · ${e(line.quantity)} · ${amount(line.total_minor, q.snapshot.currency)}</p>`).join('')}</details>`).join('')}</details>` : '';
      const offered = [...row.allowed_actions, ...(row.proposal_actions ?? [])].filter(action => !closingActions.has(action) || reasons.length);
      const waiting = offered.length < row.allowed_actions.length + (row.proposal_actions ?? []).length ? `<p class="subtle">${e(closingWait)}</p>` : '';
      const next = row.closure ? closure(row) : offered.length ? `<div class="operation-actions">${offered.map(action => button(action, row.id, actionNames[action] ?? action)).join('')}</div>${waiting}` : waiting || '<p class="subtle">ما عليك خطوة في هالملف الحين.</p>';
      return `<section class="panel" data-id="${e(row.id)}"><div class="panel-head"><h2>${e(row.name)}</h2>${badge(row.status, row.closure?.status_name)}</div><div class="panel-body">${financial ? `<p class="subtle">السجل: <bdi>${e(row.registration_number)}</bdi> · المالك: ${e(row.owner_name)}</p><dl class="detail-data"><div><dt>جهة الاتصال</dt><dd>${e(row.contact)}</dd></div><div><dt>المصدر والقطاع</dt><dd>${e(row.source)} · ${e(row.sector)}</dd></div></dl>` : ''}${terminationNotice(row)}${next}${row.project_id ? `<p><a class="btn outline small" href="#projects">المشروع المرتبط: ${e(row.name)}</a></p>` : ''}${qualification}${quoteDetails}${proposalDetails(row)}${row.contract && financial ? `<details><summary>دليل الاتفاق الداخلي</summary><p class="measure">${e(row.contract.agreement_evidence)}</p><p class="subtle">الممثل المذكور في الدليل: ${e(row.contract.customer_representative)}</p></details>` : ''}${row.readiness ? readinessDetails(row) : ''}${deliveries}${certificateBlock(row)}${changes}${history}</div></section>`;
    }).join('');
    return html;
  },
  form(action, id, data) {
    if (Object.hasOwn(certificateActionNames, action)) return certificateForm(action, id, data);
    if (Object.hasOwn(closureActionNames, action)) return closureForm(action, id, data);
    if (action === 'create_lead') return { title: actionNames[action], endpoint: '/commercial', idempotent: true,
      fields: [textField('name', 'اسم الجهة'), textField('registration_number', 'رقم السجل (أرقام أو أحرف لاتينية أو شرطة)'), textField('contact', 'جهة الاتصال'), textField('source', 'مصدر العميل المحتمل'), textField('sector', 'القطاع')],
      toPayload: values => ({ name: values.name, registration_number: values.registration_number, contact: values.contact, source: values.source, sector: values.sector }) };
    if (action === 'review_proposal_checklist') {
      const item = data.proposalReview?.queue.find(record => record.id === id);
      if (!item?.actions.includes(action)) throw new Error('هالمراجعة ما عادت متاحة. حدّث الشاشة.');
      const people = data.proposalReview.reviewers.map(person => ({ value: person.id, label: `${person.name} · ${person.department_id}` }));
      return { title: `${actionNames[action]} · ${item.client_name}`, endpoint: `/technical-proposal-reviews/${encodeURIComponent(id)}/review`, fields: [
        selectField('decision', 'قرار EPMO', [{ value: 'approved', label: 'معتمد' }, { value: 'changes_required', label: 'يحتاج تعديلات' }], 'approved'), longField('note', 'خلاصة المراجعة'),
        { name: 'items', label: 'مراجعة كل بند', type: 'rows', value: item.items.map(line => ({ item_id: line.id, result: 'passed', epmo_note: '', responsible_user_id: '', due_on: '' })), minRows: item.items.length, maxRows: item.items.length,
          columns: [{ name: 'item_id', label: 'البند', type: 'select', options: item.items.map(line => ({ value: line.id, label: `${line.item_no}: ${line.axis}` })) }, { name: 'result', label: 'النتيجة', type: 'select', options: [{ value: 'passed', label: 'مستوفى' }, { value: 'gap', label: 'فجوة' }, { value: 'not_applicable', label: 'لا ينطبق' }] }, { name: 'epmo_note', label: 'الملاحظة', type: 'text', required: false }, { name: 'responsible_user_id', label: 'مسؤول الفجوة', type: 'select', options: [{ value: '', label: 'بدون' }, ...people], required: false }, { name: 'due_on', label: 'موعد الفجوة', type: 'date', required: false }] }
      ], toPayload: values => ({ decision: values.decision, note: values.note, items: values.items.map(line => ({ item_id: line.item_id, result: line.result, epmo_note: line.epmo_note ?? '', responsible_user_id: line.responsible_user_id || null, due_on: line.due_on || null })) }) };
    }
    const row = data.rows.find(record => record.id === id);
    if (readinessActions.has(action)) return readinessForm(action, row);
    const rowActions = row ? [...row.allowed_actions, ...(row.proposal_actions ?? [])] : [];
    if (!row || !rowActions.includes(action)) throw new Error('هالإجراء غير متاح لك الحين. حدّث الملف.');
    const version = row.version;
    const spec = { title: `${actionNames[action]} · ${row.name}`, endpoint: `/commercial/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, fields: [], toPayload: values => ({ ...values, version }) };
    if (['submit_private_proposal_checklist', 'submit_government_proposal_checklist'].includes(action)) {
      const proposalType = action.includes('government') ? 'government' : 'private', definitions = data.proposalReview.definitions[proposalType];
      spec.endpoint = `/technical-proposal-reviews/${encodeURIComponent(id)}/submit`;
      spec.fields = [{ name: 'items', label: 'دليل الاستيفاء لكل بند', type: 'rows', value: definitions.map(line => ({ item_no: line.item_no, evidence: '', author_note: '' })), minRows: definitions.length, maxRows: definitions.length,
        columns: [{ name: 'item_no', label: 'البند', type: 'select', options: definitions.map(line => ({ value: line.item_no, label: `${line.item_no}: ${line.axis}` })) }, { name: 'evidence', label: 'الدليل أو المرجع', type: 'text' }, { name: 'author_note', label: 'ملاحظة معد العرض', type: 'text', required: false }] }];
      spec.toPayload = values => ({ case_version: version, proposal_type: proposalType, items: values.items.map(line => ({ item_no: Number(line.item_no), evidence: line.evidence, author_note: line.author_note ?? '' })) });
    } else if (action === 'qualify') {
      const previous = row.qualifications?.at(-1)?.snapshot;
      spec.fields = [longField('need', 'الاحتياج المحدد', previous?.need), textField('budget', 'الميزانية المذكورة (نص عشري)', previous ? decimal(previous.budget_minor) : ''), selectField('currency', 'عملة الميزانية', currencyOptions, previous?.currency ?? 'SAR'), dateField('timing', 'الموعد المستهدف', previous?.timing), textField('decision_maker', 'صاحب القرار عند العميل', previous?.decision_maker), longField('service_fit', 'ملاءمة الخدمة للاحتياج', previous?.service_fit)];
    } else if (['approve_qualification', 'reject_qualification', 'approve_quote', 'reject_quote'].includes(action)) {
      spec.fields = [longField('note', 'سبب القرار بعد مراجعة النسخة المعروضة')];
    } else if (action === 'save_quote') {
      spec.fields = quoteFields(row);
      const count = Math.max(3, row.current_quote?.snapshot.lines.length ?? 0);
      spec.toPayload = values => ({ version, ...quotePayload(values, count) });
    } else if (action === 'submit_quote') {
      spec.title = `تقديم نسخة العرض ${row.current_quote.revision} للاعتماد · ${row.name}`;
      spec.toPayload = () => ({ version });
    } else if (action === 'register_contract') {
      spec.fields = [longField('agreement_evidence', 'مرجع الاتفاق ودليله الداخلي (مو توقيع ولا إرسال رسمي)'), textField('customer_representative', 'ممثل العميل المذكور في دليل الاتفاق')];
    } else if (action === 'create_project') {
      const candidates = data.team.filter(member => ['employee', 'manager', 'pm'].includes(member.role) && member.id !== row.owner_id && member.id !== data.user.id);
      spec.title = `إنشاء مشروع من الاتفاق المعتمد · ${row.name} (المدير والمالك ينضافون تلقائيًا)`;
      spec.fields = candidates.map(member => selectField(`member_${member.id}`, `إضافة ${member.name}`, [{ value: 'no', label: 'ما ينضاف' }, { value: 'yes', label: 'ينضاف للمشروع' }], 'no'));
      spec.toPayload = values => ({ version, member_ids: candidates.filter(member => values[`member_${member.id}`] === 'yes').map(member => member.id) });
    } else if (action === 'submit_delivery') {
      const options = row.current_quote.snapshot.lines.map((line, index) => ({ value: String(index), label: `${index + 1}: ${line.description}` })).filter(option => !row.deliveries.some(delivery => delivery.line_index === Number(option.value) && ['pending', 'approved'].includes(delivery.review?.status)));
      spec.fields = [selectField('line_index', 'بند المخرج من العقد الأصلي', options, options[0]?.value), longField('evidence', 'وصف نسخة المخرج ومرجع دليل التسليم')];
      spec.toPayload = values => ({ version, line_index: Number(values.line_index), evidence: values.evidence });
    } else if (action === 'accept_delivery') {
      const deliveries = row.deliveries.filter(delivery => delivery.review?.status === 'pending' && delivery.review.approver_id === data.user.id);
      spec.fields = [selectField('delivery_id', 'نسخة المخرج المطلوب قبولها', deliveries.map(delivery => ({ value: delivery.id, label: `البند ${delivery.line_index + 1} · النسخة ${delivery.revision} · ${delivery.evidence.slice(0, 80)}` })), deliveries[0]?.id), longField('note', 'سبب قبول النسخة حسب معيار البند'), longField('acceptance_evidence', 'مرجع دليل القبول الداخلي لهالنسخة'),
        { ...selectField('approver_id', 'ممثل العميل المفوّض (من سجل موافقات العملاء)', (row.client_approvers ?? []).map(a => ({ value: a.id, label: `${a.name} — ${a.title}` })), row.client_approvers?.[0]?.id),
          hint: row.client_approvers?.length ? 'نفس السجل اللي تسمّي منه شهادة الإنجاز ممثل العميل' : 'ما فيه ممثل عميل مسجّل لهالمشروع: سجّله وسند تفويضه من «موافقات العملاء» أولًا' }];
    } else if (action === 'create_change') {
      spec.fields = [longField('scope', 'نطاق الشغل الإضافي وسببه'), textField('additional_price', `السعر الإضافي قبل الضريبة (${row.current_quote.snapshot.currency})`), textField('additional_cost', `التكلفة الإضافية (${row.current_quote.snapshot.currency})`), { ...textField('extra_days', 'أثر التغيير على المدة بالأيام'), type: 'number', min: 0, max: 3650, step: 1 }, dateField('due_date', 'موعد المهمة الإضافية'), longField('acceptance', 'معيار قبول الشغل الإضافي')];
      spec.toPayload = values => ({ version, scope: values.scope, additional_price: values.additional_price, additional_cost: values.additional_cost, extra_days: Number(values.extra_days), due_date: values.due_date, acceptance: values.acceptance });
    } else if (closingActions.has(action)) {
      const reasons = data.loss_reasons ?? [];
      if (!reasons.length) throw new Error('ما فيه أسباب خسارة سارية تختار منها. يضيفها مالك الإجراء في «خط الفرص».');
      const together = row.opportunity?.status === 'open' ? `، وفرصتها «${row.opportunity.name}» تنقفل خاسرة معها بالسبب نفسه` : '';
      spec.fields = [selectField('reason_id', action === 'withdraw' ? 'سبب السحب (من قائمة أسباب الخسارة)' : 'سبب الخسارة', reasons.map(reason => ({ value: reason.id, label: reason.name }))),
        { ...longField('comment', 'وش صار ووش نتعلم'), hint: `عشرة أحرف أو أكثر. الصفقة تنقفل نهائيًا${together}.` }];
      spec.toPayload = values => ({ version, reason_id: values.reason_id, comment: values.comment });
    } else if (['approve_change', 'reject_change', 'start_change'].includes(action)) {
      const changes = row.changes.filter(change => action === 'start_change' ? change.review?.status === 'approved' && !change.task_id : change.review?.status === 'pending' && change.review.approver_id === data.user.id);
      spec.fields = [selectField('change_id', 'طلب التغيير الأصلي', changes.map(change => ({ value: change.id, label: change.snapshot.scope })), changes[0]?.id)];
      if (action !== 'start_change') spec.fields.push(longField('note', 'سبب القرار بعد مراجعة الوقت والتكلفة'));
    }
    return spec;
  }
};
