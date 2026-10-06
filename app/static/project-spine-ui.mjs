// مسار المشاريع (خطة التغيير، الموجة 5 «سلسلة المشروع»): لكل مشروع مراحله الثمان وحالة كل مرحلة، والخطوة الجاية وعند مين،
// وحزم العمل بأزرارها. كل ما يُرسم يصل من الخادم (spineBoard في app/project-axes.mjs): الحالات وعباراتها، والخطوة وصاحبها،
// والأزرار التي يقبلها الخادم من هذا الحساب الآن — فالشاشة ما تحسب قاعدة ولا تفترق عن المحرك، والرفض يبقى رفض الخادم.
const ACTIONS = {
  set_execution: 'تغيير حالة التنفيذ', create_work_package: 'حزمة عمل جديدة',
  activate: 'تفعيل الحزمة', block: 'إيقاف الحزمة', deliver: 'تسليم الحزمة', cancel: 'إلغاء الحزمة',
  set_scope: 'المعايير والمخرجات', add_contributor: 'إضافة مساهم', add_dependency: 'ربطها بحزمة قبلها',
  remove_contributor: 'إنهاء المساهمة', remove_dependency: 'فك الربط'
};
const field = (name, label, type = 'text', extra = {}) => ({ name, label, type, required: true, ...extra });
const lines = text => String(text ?? '').split('\n').map(item => item.trim()).filter(Boolean);
const stateName = (data, axis, state) => data.state_names?.[axis]?.[state] ?? state;
const packages = data => data.projects.flatMap(project => project.work_packages.map(pack => ({ project, pack })));

function nextStep(step, e) {
  if (!step) return '<p class="notice">المشروع مقفل: ما بقي عليه خطوة.</p>';
  return `<div class="notice"><p><strong>الخطوة الجاية: ${e(step.step)}</strong></p><p>عند: ${e(step.owner)} · ${e(step.axis_name)}</p>${step.why ? `<p class="subtle">${e(step.why)}</p>` : ''}<p><a class="btn outline small" href="${e(step.link)}">فتح الخطوة<span class="sr-only">: ${e(step.step)}</span></a></p></div>`;
}

function packageCard(data, project, pack, { e, button, ui }) {
  const department = project.departments.find(d => d.id === pack.department_id)?.name ?? '';
  const open = pack.tasks.filter(task => task.status !== 'completed').length;
  const list = (items, none) => items.length ? `<ul class="vn-list">${items.join('')}</ul>` : `<p class="subtle">${e(none)}</p>`;
  const contributors = list(pack.contributors.map(c => `<li><strong>${e(c.name)}</strong><span>${e(c.contribution)}</span>${c.actions.length ? `<div class="operation-actions">${c.actions.map(a => button(a, c.id, ACTIONS[a])).join('')}</div>` : ''}</li>`), 'ما فيه مساهمين غير مسؤول الحزمة.');
  const dependencies = list(pack.depends_on.map(d => `<li><strong><bdi>${e(d.code)}</bdi></strong><span>${e(data.work_package_statuses[d.status] ?? d.status)}</span>${d.actions.length ? `<div class="operation-actions">${d.actions.map(a => button(a, d.id, ACTIONS[a])).join('')}</div>` : ''}</li>`), 'ما تعتمد على حزمة ثانية.');
  const gaps = pack.delivery_gaps.length ? ui.refusal({ what: 'قبل ما تنسلّم الحزمة', missing: pack.delivery_gaps, next: 'كمّل الناقص، ويطلع زر التسليم.' }) : '';
  const body = `<div class="vn-body"><dl class="detail-data"><div><dt>الإدارة</dt><dd>${e(department)}</dd></div><div><dt>المدة المخططة</dt><dd><bdi>${e(pack.planned_start)}</bdi> ← <bdi>${e(pack.planned_end)}</bdi></dd></div>`
    + `<div><dt>الهدف</dt><dd>${e(pack.objective)}</dd></div><div><dt>معايير القبول</dt><dd>${e(pack.acceptance_criteria || 'ما انكتبت للحين')}</dd></div>`
    + `<div><dt>المهام</dt><dd>${e(`${open} مفتوحة من ${pack.tasks.length}`)}</dd></div>${pack.delivery_evidence ? `<div><dt>دليل الإنجاز</dt><dd>${e(pack.delivery_evidence)}</dd></div>` : ''}</dl>`
    + `<section class="vn-block"><h3>المخرجات</h3>${list(pack.deliverables.map(item => `<li><strong>${e(item)}</strong></li>`), 'ما انكتبت مخرجات للحين.')}</section>`
    + `<section class="vn-block"><h3>المساهمون</h3>${contributors}</section><section class="vn-block"><h3>تعتمد على</h3>${dependencies}</section>${gaps}`
    + (pack.actions.length ? `<div class="operation-actions">${pack.actions.map(a => button(a, pack.id, ACTIONS[a])).join('')}</div>` : '') + '</div>';
  return ui.card({ codeHtml: `<bdi>${e(pack.code)}</bdi>`, title: pack.title, meta: `${pack.status_name} · ${pack.phase_name} · ${pack.lead_name}`, body });
}

function projectPanel(data, project, helpers) {
  const { e, button, ui } = helpers, axes = project.axes, manager = project.project.manager;
  const strip = data.definitions.map(a => `<div><dt>${e(a.name)}</dt><dd>${e(stateName(data, a.key, axes[a.key].state))}</dd></div>`).join('');
  const stages = ui.table({ head: ['المرحلة', 'الحالة', 'صاحبها'],
    rows: data.definitions.map(a => `<tr><td>${e(a.name)}</td><td>${e(stateName(data, a.key, axes[a.key].state))}</td><td>${e(a.owner_role)}</td></tr>`) });
  const cards = project.work_packages.map(pack => packageCard(data, project, pack, helpers)).join('');
  const actions = project.actions.length ? `<div class="operation-actions">${project.actions.map(a => button(a, project.project.id, ACTIONS[a])).join('')}</div>` : '';
  return `<section class="panel" data-focus-id="${e(project.project.id)}"><div class="panel-head"><h2>${e(project.project.name)}</h2><span class="badge">${e(stateName(data, 'closure', axes.closure.state))}</span></div><div class="panel-body">`
    + `<p class="subtle">مدير المشروع: ${e(manager.name || 'ما تحدد')}${manager.available ? '' : ' — مو متاح'}</p>${nextStep(project.next_step, e)}`
    + `<dl class="detail-data">${strip}</dl>${actions}`
    + `<details><summary>المراحل الثمان وأصحابها</summary>${stages}</details>`
    + `<details${project.work_packages.length ? ' open' : ''}><summary>حزم العمل (${project.work_packages.length})</summary>${cards || '<p class="subtle">ما فيه حزم عمل للحين. مدير المشروع يفتحها لكل إدارة مشاركة.</p>'}</details>`
    + '</div></section>';
}

export const projectSpineUI = {
  title: 'مسار المشاريع',
  description: 'كل مشروع بمراحله الثمان: وين وصل، ووش الخطوة الجاية، وعند مين.',
  description_en: 'Every project across its eight stages: where it stands, the next step, and who owns it.',
  load: api => api('/project-spine'),
  render(data, helpers) {
    if (!data.projects.length) return helpers.ui.empty('ما عندك مشاريع للحين', 'المشاريع اللي أنت عضو فيها تطلع هنا بمراحلها والخطوة الجاية في كل واحد.');
    return data.projects.map(project => projectPanel(data, project, helpers)).join('');
  },
  form(action, id, data) {
    const project = data.projects.find(p => p.project.id === id && p.actions.includes(action));
    // مراكز التكلفة تصل لمدير المشروع المسجَّل وحده. والحقل يغيب إن لم يكن الربط القائم بين خياراته: حقلٌ بلا قيمته
    // الحالية يُرسل «بلا ربط» فيفكّ ما لم يقصد أحد فكّه، وغيابه يُبقي الربط كما هو.
    const budgetField = (budgets, value = '') => budgets.length && (!value || budgets.some(b => b.id === value))
      ? [field('budget_id', 'مركز التكلفة', 'select', { required: false, value, options: [{ value: '', label: 'بلا ربط' }, ...budgets.map(b => ({ value: b.id, label: b.cost_center }))] })] : [];
    if (project && action === 'set_execution') return {
      title: ACTIONS[action], endpoint: `/projects/${id}/execution`, method: 'POST',
      fields: [field('state', 'الحالة الجديدة', 'select', { options: project.axes.execution.next_states.map(s => ({ value: s, label: stateName(data, 'execution', s) })) }),
        field('note', 'السبب أو الملاحظة', 'textarea', { maxLength: 2000 })],
      toPayload: v => ({ version: project.axes.execution.version, state: v.state, note: v.note })
    };
    if (project && action === 'create_work_package') return {
      title: ACTIONS[action], endpoint: `/projects/${id}/work-packages`, method: 'POST', idempotent: true,
      fields: [field('code', 'رمز الحزمة', 'text', { maxLength: 20, hint: 'رمز قصير يبقى ثابت، مثل WP-1' }), field('title', 'اسم الحزمة', 'text', { maxLength: 200 }),
        field('department_id', 'الإدارة المسؤولة', 'select', { options: project.departments.map(d => ({ value: d.id, label: d.name })) }),
        field('phase', 'المرحلة', 'select', { options: Object.entries(data.phases).map(([value, label]) => ({ value, label })) }),
        field('objective', 'الهدف ومخرجه', 'textarea', { maxLength: 2000 }),
        field('lead_id', 'مسؤول الحزمة', 'select', { options: project.members.map(m => ({ value: m.id, label: `${m.name} · ${m.department_name}` })), hint: 'من الإدارة المسؤولة نفسها' }),
        field('planned_start', 'بداية مخططة', 'date'), field('planned_end', 'نهاية مخططة', 'date'),
        field('acceptance_criteria', 'معايير القبول', 'textarea', { maxLength: 3000 }),
        field('deliverables', 'المخرجات: كل مخرج في سطر', 'textarea', { maxLength: 8000 }), ...budgetField(project.budgets)],
      toPayload: v => ({ ...v, deliverables: lines(v.deliverables), budget_id: v.budget_id || undefined })
    };
    const found = packages(data).find(x => x.pack.id === id && x.pack.actions.includes(action));
    if (found) {
      const { pack } = found, owner = found.project;
      if (['activate', 'block', 'deliver', 'cancel'].includes(action)) return {
        title: `${ACTIONS[action]} ${pack.code}`, endpoint: `/work-packages/${id}/${action}`, method: 'POST',
        fields: [field('note', 'أساس القرار', 'textarea', { maxLength: 2000 }),
          ...(action === 'deliver' ? [field('evidence', 'دليل الإنجاز: وش انسلّم ووين ينراجع', 'textarea', { maxLength: 4000, hint: 'عشرين حرف على الأقل' })] : [])],
        toPayload: v => ({ version: pack.version, ...v })
      };
      if (action === 'set_scope') {
        const pick = budgetField(owner.budgets, pack.budget_id ?? '');
        return {
          title: `${ACTIONS[action]} ${pack.code}`, endpoint: `/work-packages/${id}/scope`, method: 'POST',
          fields: [field('acceptance_criteria', 'معايير القبول', 'textarea', { maxLength: 3000, value: pack.acceptance_criteria ?? '' }),
            field('deliverables', 'المخرجات: كل مخرج في سطر', 'textarea', { maxLength: 8000, value: pack.deliverables.join('\n') }), ...pick,
            field('basis', 'سبب التعديل', 'textarea', { maxLength: 2000 })],
          toPayload: v => ({ version: pack.version, acceptance_criteria: v.acceptance_criteria, deliverables: lines(v.deliverables), basis: v.basis,
            ...(pick.length ? { budget_id: v.budget_id || null } : {}) })
        };
      }
      if (action === 'add_contributor') {
        const taken = new Set([pack.lead_id, ...pack.contributors.map(c => c.user_id)]);
        return {
          title: `${ACTIONS[action]} في ${pack.code}`, endpoint: `/work-packages/${id}/contributors`, method: 'POST', idempotent: true,
          fields: [field('user_id', 'المساهم', 'select', { options: owner.members.filter(m => !taken.has(m.id)).map(m => ({ value: m.id, label: `${m.name} · ${m.department_name}` })) }),
            field('contribution', 'وش بيساهم فيه', 'textarea', { maxLength: 1000 })],
          toPayload: v => v
        };
      }
      if (action === 'add_dependency') {
        const linked = new Set(pack.depends_on.map(d => d.depends_on_id));
        return {
          title: `${ACTIONS[action]}: ${pack.code}`, endpoint: `/work-packages/${id}/dependencies`, method: 'POST', idempotent: true,
          fields: [field('depends_on_id', 'الحزمة اللي تنتظرها', 'select', { options: owner.work_packages.filter(w => w.id !== pack.id && w.status !== 'cancelled' && !linked.has(w.id)).map(w => ({ value: w.id, label: `${w.code} · ${w.title}` })) }),
            field('basis', 'ليش تنتظرها', 'textarea', { maxLength: 1000 })],
          toPayload: v => v
        };
      }
    }
    const contributor = packages(data).flatMap(x => x.pack.contributors).find(c => c.id === id && c.actions.includes(action));
    if (contributor && action === 'remove_contributor') return {
      title: `${ACTIONS[action]}: ${contributor.name}`, endpoint: `/work-package-contributors/${id}/remove`, method: 'POST',
      fields: [field('reason', 'السبب', 'textarea', { maxLength: 1000, hint: 'السجل يبقى، والمساهمة تنقفل بسببها' })], toPayload: v => v
    };
    const dependency = packages(data).flatMap(x => x.pack.depends_on).find(d => d.id === id && d.actions.includes(action));
    if (dependency && action === 'remove_dependency') return {
      title: `${ACTIONS[action]} مع ${dependency.code}`, endpoint: `/work-package-dependencies/${id}/remove`, method: 'POST',
      fields: [field('reason', 'السبب', 'textarea', { maxLength: 1000, hint: 'الربط يبقى في السجل منقفل بسببه' })], toPayload: v => v
    };
    throw new Error('هذا الإجراء ما عاد متاح لك. حدّث الصفحة.');
  }
};
