// البلاطة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const channelNames = { instagram: 'إنستغرام', x: 'إكس', linkedin: 'لينكدإن', tiktok: 'تيك توك', youtube: 'يوتيوب', website: 'الموقع', internal: 'استخدام داخلي', print: 'مطبوعات', video: 'فيديو', event: 'فعالية',
  snapchat: 'سناب شات', google_ads: 'إعلانات قوقل', email: 'البريد', outdoor: 'إعلانات خارجية', other: 'قناة أخرى' };
const statusNames = { draft: 'مسودة', brief_pending: 'الموجز بانتظار المراجعة', brief_returned: 'الموجز معاد للتعديل', production: 'الإنتاج الداخلي', pending: 'بانتظار المراجعة', returned: 'معاد للتعديل', approved: 'معتمد', passed: 'اجتاز الفحص', failed: 'ما اجتاز الفحص' };
const labels = { create: 'موجز جديد', save_brief: 'حفظ نسخة موجز', submit_brief: 'تقديم الموجز للمراجعة', approve_brief: 'اعتماد الموجز', return_brief: 'إعادة الموجز', add_asset: 'تسجيل أصل وحقوقه', inspect_asset: 'توثيق فحص الأصل', create_output: 'إضافة مخرج', save_output: 'حفظ نسخة مخرج', submit_output: 'تقديم النسخة للمراجعة', approve_output: 'اعتماد نسخة المخرج', return_output: 'إعادة نسخة المخرج', issue_package: 'إصدار بيان تسليم داخلي', accept_package: 'قبول بيان التسليم داخليًا' };
const qualityNames = { brand: 'الهوية', language: 'اللغة والإملاء', claims: 'المعلومات والادعاءات', accessibility: 'التباين والإتاحة', specification: 'مواصفات القناة' };
const field = (name, label, type = 'text', extra = {}) => ({ name, label, type, required: true, ...extra });
const long = (name, label, value = '', maxLength = 3000) => field(name, label, 'textarea', { value, maxLength });
const select = (name, label, options, value = '') => field(name, label, 'select', { options, value });
const choices = [{ value: 'no', label: 'غير مشمول' }, { value: 'yes', label: 'مشمول' }];
const currentDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const multiFields = (prefix, records, selected = []) => records.map(record => select(`${prefix}_${record.value}`, record.label, choices, selected.includes(record.value) ? 'yes' : 'no'));
const multiValues = (values, prefix, records) => records.filter(record => values[`${prefix}_${record.value}`] === 'yes').map(record => record.value);
const allChannels = Object.entries(channelNames).map(([value, label]) => ({ value, label: `قناة ${label}` }));
// ما يقرؤه موجز العمل المفتوح لحملة من سجلها (الهدف والمؤشر والقنوات) ما ينطلب في النموذج ولا ينرسل؛ وفي نموذج البداية يختفي
// ما دامت الحملة مختارة (showWhen)، ويرجع إذا صار العمل بلا حملة.
const fromCampaign = new Set(['objective', 'kpi']);
function briefFields(snapshot = {}, { campaign = false, choosing = false } = {}) {
  const fields = [
    long('objective', 'الهدف المطلوب من العمل', snapshot.objective), long('audience', 'الجمهور واحتياجاته', snapshot.audience, 2000),
    long('audience_basis', 'الدليل والافتراضات عن الجمهور (فرّق الافتراضات بوضوح)', snapshot.audience_basis, 4000),
    long('message', 'الرسالة الرئيسية', snapshot.message), long('prohibited_messages', 'الرسائل والادعاءات المحظورة', snapshot.prohibited_messages),
    long('kpi', 'المؤشر المستهدف وتعريفه', snapshot.kpi, 2000), long('measurement_source', 'مصدر القياس وطريقة جمعه وحالة توفره', snapshot.measurement_source),
    ...multiFields('channel', allChannels, snapshot.channels ?? ['internal']), long('scope', 'المخرجات المطلوبة وحدود النطاق والاستثناءات', snapshot.scope, 5000)
  ];
  const derived = f => fromCampaign.has(f.name) || f.name.startsWith('channel_');
  if (campaign) return fields.filter(f => !derived(f));
  return choosing ? fields.map(f => derived(f) ? { ...f, showWhen: { name: 'campaign_id', equals: [''] } } : f) : fields;
}
function briefPayload(values, campaign = false) {
  const own = Object.fromEntries(['audience', 'audience_basis', 'message', 'prohibited_messages', 'measurement_source', 'scope'].map(key => [key, values[key]]));
  return campaign ? own : { objective: values.objective, ...own, kpi: values.kpi, channels: multiValues(values, 'channel', allChannels) };
}
function outputFields(row, snapshot = {}) {
  const assets = row.assets.map(asset => ({ value: asset.id, label: `استخدام الأصل: ${asset.name} · ${asset.internal_reference}` }));
  const allowedChannels = [{ value: '', label: 'اختيار القناة' }, ...row.brief.snapshot.channels.map(value => ({ value, label: channelNames[value] }))];
  return [field('title', 'اسم المخرج', 'text', { value: snapshot.title, maxLength: 180 }), select('channel', 'قناة المخرج من الموجز المعتمد', allowedChannels, snapshot.channel),
    field('format', 'الصيغة المطلوبة (مثل نص أو PNG)', 'text', { value: snapshot.format, maxLength: 100 }), field('dimensions', 'المقاس أو الدقة أو مواصفات الوسيط', 'text', { value: snapshot.dimensions, maxLength: 300 }),
    field('language', 'اللغة', 'text', { value: snapshot.language ?? 'العربية', maxLength: 100 }), field('brand_reference', 'مرجع دليل الهوية الداخلي', 'text', { value: snapshot.brand_reference, maxLength: 300 }),
    long('acceptance', 'معيار قبول المخرج', snapshot.acceptance), long('content', 'النص الفعلي أو وصف النسخة (بدون رفع ملف وسائط)', snapshot.content, 20000),
    ...multiFields('asset', assets, snapshot.asset_ids ?? [])];
}
function outputPayload(values, row) {
  return { ...Object.fromEntries(['title', 'channel', 'format', 'dimensions', 'language', 'brand_reference', 'acceptance', 'content'].map(key => [key, values[key]])),
    asset_ids: multiValues(values, 'asset', row.assets.map(asset => ({ value: asset.id }))) };
}

export const studioUI = {
  title: 'الاستوديو والتسليم',
  description: 'موجز معتمد ونسخ مخرجات ومراجعات وحقوق أصول، تنتهي ببيان تسليم داخلي قابل للتتبع.',
  async load(api) {
    // الحملات القائمة لعملاء فريقك: منها يُفتح العمل فيقرأ الموجز هدفها وقنواتها ومستهدفاتها.
    const [rows, projects, me, campaigns] = await Promise.all([api('/studio'), api('/projects'), api('/me'),
      api('/campaigns').then(board => (board.campaigns ?? []).filter(c => !['completed', 'cancelled'].includes(c.status))).catch(() => [])]);
    return { rows, projects, user: me.user, campaigns };
  },
  render(data, { e, button, ui = kit(e) }) {
    // الشكل يطابق المعنى: المسودة خاملة، والإنتاج جارٍ، والمنتظر بشكل الانتظار، والمعاد والمرفوض بالمنع، والمعتمد بالفاصلة الممتلئة.
    const badge = status => `<span class="badge ${status === 'approved' || status === 'passed' ? 'approved' : status === 'returned' || status === 'failed' || status === 'brief_returned' ? 'returned' : status === 'draft' ? 'draft' : status === 'production' ? 'in_progress' : 'pending'}">${e(statusNames[status] ?? status)}</span>`;
    const bar = list => list.length ? `<div class="operation-actions">${list.join('')}</div>` : '';
    const canCreate = ['employee', 'manager', 'pm'].includes(data.user.role);
    const entry = `<section class="panel"><div class="panel-body"><h2>ابدأ من مشروعك</h2><p class="subtle">الأصول هنا سجلات حقوق ومراجع داخلية، مو ملفات مرفوعة؛ وبيان التسليم ما ينشر ولا يرسل ملفات.</p>${canCreate ? bar(data.projects.map(project => button('create', project.id, `موجز جديد · ${project.name}`))) : ''}${!data.projects.length ? '<p>تحتاج تكون عضو في مشروع عشان تبدأ موجز.</p>' : ''}</div></section>`;
    if (!data.rows.length) return entry + ui.empty('ما فيه مساحات استوديو لك للحين', 'الموجز يبدأ من مشروع أنت عضو فيه، وبعد اعتماده تنضاف المخرجات والأصول.');
    return entry + data.rows.map(row => {
      const b = row.brief.snapshot, can = action => row.allowed_actions.includes(action), actionButton = (action, childId = '') => button(action, childId ? `${row.id}:${childId}` : row.id, labels[action]);
      const brief = `<details open><summary>الموجز · النسخة ${e(row.brief.revision)}</summary>${row.campaign_id ? `<p class="subtle">الهدف والمؤشر والقنوات من حملة «${e(row.campaign_name)}» كما كانت وقت كتابة هالنسخة.</p>` : ''}<dl class="detail-data"><div><dt>الهدف</dt><dd>${e(b.objective)}</dd></div><div><dt>الجمهور</dt><dd>${e(b.audience)}</dd></div><div><dt>الدليل والافتراضات</dt><dd>${e(b.audience_basis)}</dd></div><div><dt>الرسالة</dt><dd>${e(b.message)}</dd></div><div><dt>المحظورات</dt><dd>${e(b.prohibited_messages)}</dd></div><div><dt>المؤشر</dt><dd>${e(b.kpi)}</dd></div><div><dt>مصدر القياس وطريقته</dt><dd>${e(b.measurement_source)}</dd></div><div><dt>القنوات</dt><dd>${b.channels.map(channel => e(channelNames[channel])).join('، ')}</dd></div><div><dt>النطاق</dt><dd>${e(b.scope)}</dd></div></dl>${bar(['save_brief', 'submit_brief', 'approve_brief', 'return_brief'].filter(can).map(action => actionButton(action)))}</details>`;
      const assets = `<details ${row.assets.length ? 'open' : ''}><summary>الأصول وحقوق الاستخدام (${e(row.assets.length)})</summary>${row.assets.map(asset => `<article class="notice"><h3>${e(asset.name)}</h3><p>مرجع داخلي: <code>${e(asset.internal_reference)}</code></p><p>صاحب الحقوق: ${e(asset.rights_holder)} · الأساس: ${e({ owned: 'ملكية', licensed: 'ترخيص', consent: 'موافقة استخدام' }[asset.rights_basis])}</p><p>المدة: ${e(asset.valid_from)} لين ${e(asset.valid_until)} · القنوات: ${asset.channels.map(channel => e(channelNames[channel])).join('، ')}</p><p class="measure">${e(asset.rights_evidence)}</p>${asset.inspection ? `<p>${badge(asset.inspection.outcome)} ${e(asset.inspection.evidence)}</p>` : `<p class="subtle">ما انسجل فحص داخلي للحين.</p>${can('inspect_asset') ? bar([actionButton('inspect_asset', asset.id)]) : ''}`}</article>`).join('')}${can('add_asset') ? bar([actionButton('add_asset')]) : ''}</details>`;
      const outputs = `<details open><summary>المخرجات (${e(row.outputs.length)})</summary>${row.outputs.map(output => {
        const version = output.current_version, snapshot = version.snapshot;
        const available = [];
        if (['draft', 'returned'].includes(output.status) && can('save_output')) available.push('save_output');
        if (output.status === 'draft' && can('submit_output')) available.push('submit_output');
        if (output.status === 'pending') for (const action of ['approve_output', 'return_output']) if (can(action)) available.push(action);
        return `<article class="notice"><h3>${e(snapshot.title)} ${badge(output.status)}</h3><p class="subtle">نسخة المخرج ${e(version.revision)} · ${e(channelNames[snapshot.channel])} · موجز ${e(row.brief.revision)}</p><dl class="detail-data"><div><dt>المواصفات</dt><dd>${e(snapshot.format)} · ${e(snapshot.dimensions)} · ${e(snapshot.language)}</dd></div><div><dt>مرجع الهوية</dt><dd>${e(snapshot.brand_reference)}</dd></div><div><dt>معيار القبول</dt><dd>${e(snapshot.acceptance)}</dd></div><div><dt>الأصول المرتبطة</dt><dd>${snapshot.asset_ids.map(id => e(row.assets.find(a => a.id === id)?.internal_reference ?? id)).join('، ')}</dd></div><div><dt>النص أو وصف النسخة</dt><dd>${e(snapshot.content)}</dd></div></dl>${bar(available.map(action => actionButton(action, output.id)))}${output.versions.length > 1 ? `<details><summary>النسخ السابقة (${e(output.versions.length - 1)})</summary>${output.versions.filter(previous => previous.id !== version.id).map(previous => `<p class="measure">النسخة ${e(previous.revision)} · ${e(previous.snapshot.content)}</p>`).join('')}</details>` : ''}</article>`;
      }).join('')}${can('create_output') ? bar([actionButton('create_output')]) : row.status === 'production' && !row.assets.length ? '<p class="subtle">سجّل أصل وحقوقه قبل ما تربطه بأول مخرج.</p>' : ''}</details>`;
      const packages = `<details open><summary>بيانات التسليم الداخلي (${e(row.packages.length)})</summary>${row.packages.map(pkg => `<article class="notice"><h3>بيان حزمة <bdi>${e(pkg.id.slice(0, 8))}</bdi></h3><p class="subtle">${e(pkg.issued_at)} · ${pkg.acceptance ? 'مقبول داخليًا' : 'ينتظر القبول الداخلي'}</p><p>الاستخدام المطلوب: ${e(pkg.snapshot.use_from)} لين ${e(pkg.snapshot.use_until)}</p>${pkg.snapshot.outputs.map(output => `<p>${e(output.snapshot.title)} · النسخة ${e(output.revision)} · ${e(channelNames[output.snapshot.channel])}</p>`).join('')}<p>الاستثناءات: ${e(pkg.snapshot.exclusions)}</p><p class="subtle">${e(pkg.snapshot.assets.length)} سجل أصل · ${e(pkg.snapshot.excluded_output_ids.length)} مخرج مستثنى</p>${pkg.acceptance ? `<p>دليل القبول الداخلي: ${e(pkg.acceptance.evidence)}</p><p>${e(pkg.acceptance.note)}</p>` : can('accept_package') ? bar([actionButton('accept_package', pkg.id)]) : ''}</article>`).join('')}${can('issue_package') ? bar([actionButton('issue_package')]) : ''}</details>`;
      const reviews = `<details><summary>سجل المراجعات (${e(row.reviews.length)})</summary><div class="timeline">${row.reviews.map(review => {
        const version = review.kind === 'brief' ? row.brief_versions.find(item => item.id === review.version_id) : row.outputs.flatMap(output => output.versions).find(item => item.id === review.version_id);
        return `<article class="timeline-item"><strong>${review.kind === 'brief' ? 'موجز' : 'مخرج'} · النسخة ${e(version?.revision)} ${badge(review.decision)}</strong><p>${e(review.note)}</p><small>${e(review.reviewed_at)} · ${e(row.reviewer_name)}</small>${Object.keys(review.quality_checks).length ? `<p class="subtle">الفحوص المسجلة: ${Object.keys(review.quality_checks).map(key => e(qualityNames[key])).join('، ')}</p>` : ''}</article>`;
      }).join('')}</div>${row.brief_versions.length > 1 ? `<details><summary>نسخ الموجز السابقة</summary>${row.brief_versions.filter(version => version.id !== row.brief.id).map(version => `<p class="measure">نسخة ${e(version.revision)} · ${e(version.snapshot.objective)}<br>${e(version.snapshot.message)}</p>`).join('')}</details>` : ''}</details>`;
      const served = row.campaign_id ? ` · حملة «${row.campaign_name}» لـ${row.client_name}` : '';
      return `<section class="panel"><div class="panel-head"><h2>${e(row.title)}</h2>${badge(row.status)}</div><div class="panel-body"><p class="subtle">${e(row.project_name)}${e(served)} · المعدّ: ${e(row.owner_name)} · المراجع: ${e(row.reviewer_name)}</p>${brief}${assets}${outputs}${packages}${reviews}</div></section>`;
    }).join('');
  },
  form(action, id, data) {
    if (action === 'create') {
      const project = data.projects.find(p => p.id === id);
      if (!project) throw new Error('المشروع مو متاح لك الحين. حدّث القائمة.');
      const campaigns = data.campaigns ?? [], choosing = campaigns.length > 0;
      const fields = [field('title', 'عنوان مساحة الاستوديو', 'text', { maxLength: 180 }),
        ...(choosing ? [select('campaign_id', 'الحملة اللي يخدمها العمل', [{ value: '', label: 'بلا حملة — أكتب الهدف والقنوات بنفسي' }, ...campaigns.map(c => ({ value: c.id, label: `${c.name} · ${c.client_name}` }))],
          '')].map(f => ({ ...f, required: false, hint: 'مع الحملة ينقرأ الهدف والمؤشر والقنوات منها، وتكتب أنت الباقي.' })) : []),
        ...briefFields({}, { choosing })];
      if (project.created_by === data.user.id) fields.unshift(select('reviewer_id', 'المراجع اللي تعيّنه لهالمساحة', [{ value: '', label: 'اختيار عضو مستقل' }, ...project.members.filter(member => member.id !== data.user.id).map(member => ({ value: member.id, label: member.name }))]));
      return { title: `${labels.create} · ${project.name}`, endpoint: '/studio', idempotent: true, fields,
        toPayload: values => ({ project_id: project.id, title: values.title, ...(values.campaign_id ? { campaign_id: values.campaign_id } : {}), ...briefPayload(values, !!values.campaign_id), ...(project.created_by === data.user.id ? { reviewer_id: values.reviewer_id } : {}) }) };
    }
    const [studioId, childId] = String(id).split(':'), row = data.rows.find(s => s.id === studioId);
    if (!row || !row.allowed_actions.includes(action)) throw new Error('الإجراء غير متاح لك في هالمساحة الحين. حدّث القائمة.');
    const version = row.version;
    const spec = { title: `${labels[action]} · ${row.title}`, endpoint: `/studio/${encodeURIComponent(studioId)}/${encodeURIComponent(action)}`, fields: [], toPayload: values => ({ ...values, version }) };
    if (action === 'save_brief') {
      spec.fields = briefFields(row.brief.snapshot, { campaign: !!row.campaign_id }); spec.toPayload = values => ({ version, ...briefPayload(values, !!row.campaign_id) });
    } else if (action === 'submit_brief') spec.toPayload = () => ({ version });
    else if (['approve_brief', 'return_brief'].includes(action)) spec.fields = [long('note', 'سبب القرار على نسخة الموجز المعروضة')];
    else if (action === 'add_asset') {
      spec.fields = [field('name', 'اسم الأصل', 'text', { maxLength: 180 }), field('internal_reference', 'معرّف الأصل الداخلي (أحرف لاتينية وأرقام وشرطة بس)', 'text', { maxLength: 80 }),
        field('rights_holder', 'صاحب الحقوق', 'text', { maxLength: 300 }), select('rights_basis', 'أساس حق الاستخدام', [{ value: '', label: 'اختيار أساس الحق' }, { value: 'owned', label: 'ملكية' }, { value: 'licensed', label: 'ترخيص' }, { value: 'consent', label: 'موافقة استخدام' }]),
        long('rights_evidence', 'الإفادة النصية بحق الاستخدام ومرجعها (مو رفع ملف ترخيص)', '', 5000), field('valid_from', 'بداية مدة حق الاستخدام', 'date', { value: currentDate() }), field('valid_until', 'نهاية مدة حق الاستخدام', 'date'),
        ...multiFields('channel', allChannels)];
      spec.toPayload = values => ({ version, ...Object.fromEntries(['name', 'internal_reference', 'rights_holder', 'rights_basis', 'rights_evidence', 'valid_from', 'valid_until'].map(key => [key, values[key]])), channels: multiValues(values, 'channel', allChannels) });
    } else if (action === 'inspect_asset') {
      const asset = row.assets.find(a => a.id === childId && !a.inspection);
      if (!asset) throw new Error('الأصل ما يحتاج فحص جديد.');
      spec.title = `${labels.inspect_asset} · ${asset.name}`;
      spec.fields = [select('outcome', 'نتيجة فحص الحقوق والقنوات والمدة', [{ value: '', label: 'اختيار نتيجة الفحص' }, { value: 'passed', label: 'اجتاز الفحص الداخلي' }, { value: 'failed', label: 'ما اجتاز الفحص' }]), long('evidence', 'إفادة الفحص ومرجع المراجعة الداخلية', '', 5000)];
      spec.toPayload = values => ({ version, asset_id: asset.id, outcome: values.outcome, evidence: values.evidence });
    } else if (['create_output', 'save_output'].includes(action)) {
      const output = action === 'save_output' ? row.outputs.find(o => o.id === childId && ['draft', 'returned'].includes(o.status)) : null;
      if (action === 'save_output' && !output) throw new Error('المخرج مو متاح للتعديل.');
      spec.fields = outputFields(row, output?.current_version.snapshot);
      spec.toPayload = values => ({ version, ...outputPayload(values, row), ...(output ? { output_id: output.id } : {}) });
    } else if (['submit_output', 'approve_output', 'return_output'].includes(action)) {
      const output = row.outputs.find(o => o.id === childId);
      if (!output || (action === 'submit_output' ? output.status !== 'draft' : output.status !== 'pending')) throw new Error('حالة نسخة المخرج تغيّرت. حدّث الصفحة.');
      spec.title = `${labels[action]} · ${output.current_version.snapshot.title} · النسخة ${output.current_version.revision}`;
      if (action !== 'submit_output') spec.fields.push(long('note', 'سبب القرار على هالنسخة'));
      if (action === 'approve_output') for (const [key, label] of Object.entries(qualityNames)) spec.fields.push(select(`quality_${key}`, `فحص ${label}`, [{ value: '', label: 'اختيار بعد المراجعة' }, { value: 'passed', label: 'اجتاز الفحص' }]));
      spec.toPayload = values => ({ version, output_id: output.id, ...(action !== 'submit_output' ? { note: values.note } : {}), ...(action === 'approve_output' ? { quality_checks: Object.fromEntries(Object.keys(qualityNames).map(key => [key, values[`quality_${key}`]])) } : {}) });
    } else if (action === 'issue_package') {
      const outputs = row.outputs.filter(o => o.status === 'approved').map(o => ({ value: o.id, label: `تضمين ${o.current_version.snapshot.title} · النسخة ${o.current_version.revision}` }));
      spec.fields = [...multiFields('output', outputs, outputs.map(o => o.value)), field('use_from', 'بداية الاستخدام المطلوب', 'date', { value: currentDate() }), field('use_until', 'آخر يوم للاستخدام المطلوب', 'date'), long('exclusions', 'المخرجات وملفات المصدر المستثناة وسبب الاستثناء، أو اكتب إنه ما فيه استثناءات', '', 5000)];
      spec.toPayload = values => ({ version, output_ids: multiValues(values, 'output', outputs), use_from: values.use_from, use_until: values.use_until, exclusions: values.exclusions });
    } else if (action === 'accept_package') {
      const pkg = row.packages.find(p => p.id === childId && !p.acceptance);
      if (!pkg) throw new Error('بيان الحزمة ما يحتاج قبول جديد.');
      spec.title = `${labels.accept_package} · ${pkg.id.slice(0, 8)}`;
      spec.fields = [long('note', 'سبب القبول بعد مطابقة النسخ والاستثناءات'), long('evidence', 'إفادة القبول الداخلي لبيان الحزمة المحدد', '', 5000)];
      spec.toPayload = values => ({ version, package_id: pkg.id, note: values.note, evidence: values.evidence });
    }
    return spec;
  }
};
