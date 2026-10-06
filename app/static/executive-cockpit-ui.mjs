import { icon } from './icons.mjs';
const STATUS = Object.freeze({
  actual: 'متحقق',
  derived: 'مشتق',
  forecast: 'متوقع',
  unavailable: 'غير مقاس'
});
const STATE = Object.freeze({
  good: 'مستقر',
  attention: 'يحتاج متابعة',
  critical: 'يحتاج تدخلًا',
  unknown: 'القياس غير مكتمل'
});
const QUALITY = Object.freeze({
  measured: 'مقاس',
  partial: 'قياس جزئي',
  stale: 'قياس قديم',
  estimated: 'تقديري',
  unavailable: 'غير مقاس'
});

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const number = value => new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 }).format(value);
const currency = value => new Intl.NumberFormat('ar-SA', {
  style: 'currency', currency: 'SAR', maximumFractionDigits: 2
}).format(Number(value) / 100);

function metricText(metric) {
  if (metric.status === 'unavailable' || metric.value === null || metric.value === undefined) return '—';
  if (metric.unit === 'minor_currency') return currency(metric.value);
  if (metric.unit === 'basis_points') return `${number(metric.value / 100)}٪`;
  if (metric.unit === 'days') return `${number(metric.value)} يوم`;
  if (metric.unit === 'ratio') return number(metric.value);
  return number(metric.value);
}

function metricCard(metric, dimension, e) {
  const status = STATUS[metric.status] ?? metric.status;
  const state = STATE[dimension.state] ?? dimension.state;
  const action = metric.source_link ? `<button type="button" class="cockpit-metric-action" data-action="open-metric" data-id="${e(metric.key)}" aria-label="فتح تفاصيل ${e(metric.label)}">
      <span>التفاصيل</span>${icon('chevron','is-directional')}
    </button>` : '';
  return `<article class="cockpit-metric is-${e(dimension.state)}" data-metric="${e(metric.key)}">
    <div class="cockpit-metric-head">
      <span class="cockpit-status is-${e(metric.status)}">${e(status)}</span>
      <span class="cockpit-state">${e(state)}</span>
    </div>
    <p class="cockpit-metric-label">${e(metric.label)}</p>
    <strong class="cockpit-metric-value">${e(metricText(metric))}</strong>
    <p class="cockpit-metric-note">${e(metric.note || 'لا توجد ملاحظة على القياس.')}</p>
    <dl class="cockpit-provenance">
      <div><dt>حتى</dt><dd>${e(String(metric.as_of ?? '').slice(0, 16).replace('T', ' '))}</dd></div>
      <div><dt>العينة</dt><dd>${e(number(metric.sample_size ?? 0))}</dd></div>
      <div><dt>الجودة</dt><dd>${e(QUALITY[metric.quality_state] ?? metric.quality_state)}</dd></div>
      <div><dt>المالك</dt><dd>${e(metric.owner)}</dd></div>
    </dl>
    ${action}
  </article>`;
}

function render(data, { e = escapeHtml } = {}) {
  const dimensions = Array.isArray(data?.dimensions) ? data.dimensions : [];
  const metrics = dimensions.flatMap(dimension => (dimension.metrics ?? []).map(metric => ({ metric, dimension }))).slice(0, 7);
  const attention = (data?.attention ?? []).slice(0, 5);
  const period = data?.period ?? {};
  return `<section class="cockpit" aria-labelledby="cockpit-title">
    <header class="cockpit-hero">
      <div class="cockpit-hero-copy">
        <span class="cockpit-eyebrow">اللوحة التنفيذية</span>
        <h1 id="cockpit-title">نبض الشركة</h1>
        <p class="cockpit-summary">${e(data?.summary || 'لا توجد خلاصة قابلة للعرض حتى الآن.')}</p>
      </div>
      <div class="cockpit-period" aria-label="فترة القياس">
        <span>الفترة</span>
        <strong>${e(period.from ?? '—')} — ${e(period.to ?? '—')}</strong>
        <small>توقيت الرياض · آخر تجميع ${e(String(data?.generated_at ?? '').slice(0, 16).replace('T', ' '))}</small>
      </div>
    </header>

    <section class="cockpit-bento" aria-label="مؤشرات الشركة">
      ${metrics.length ? metrics.map(({ metric, dimension }) => metricCard(metric, dimension, e)).join('') : `<div class="cockpit-empty"><strong>لا توجد مؤشرات قابلة للعرض</strong><p>يحدد مالك البيانات المصدر والتعريف قبل ظهور الرقم.</p></div>`}
    </section>

    <section class="cockpit-decisions" aria-labelledby="cockpit-decisions-title">
      <div class="cockpit-section-head">
        <div><span class="cockpit-eyebrow">الأولوية الآن</span><h2 id="cockpit-decisions-title">ما يحتاج قرارك</h2></div>
        <span class="cockpit-count">${e(number(attention.length))}</span>
      </div>
      <div class="cockpit-signals">
        ${attention.length ? attention.map((signal, index) => `<article class="cockpit-signal is-${e(signal.severity || 'attention')}">
          <span class="cockpit-signal-index">${e(String(index + 1).padStart(2, '0'))}</span>
          <p>${e(signal.text)}</p>
          ${signal.key ? `<button type="button" class="cockpit-signal-action" data-action="open-executive-signal" data-id="${e(signal.key)}" aria-label="فتح تفاصيل ${e(signal.text)}">فتح السبب ${icon('chevron','is-directional')}</button>` : ''}
        </article>`).join('') : `<div class="cockpit-clear"><span aria-hidden="true">✓</span><div><strong>لا توجد إشارة عاجلة</strong><p>لا يعني ذلك اكتمال القياس؛ راجع حالات «غير مقاس» أعلاه.</p></div></div>`}
      </div>
    </section>
  </section>`;
}

function detailRows(rows) {
  if (!rows?.length) return '<p class="cockpit-detail-empty">لا توجد سجلات في هذه الصفحة.</p>';
  return `<ul class="cockpit-detail-list">${rows.map(row => {
    const title = row.name ?? row.title ?? row.id ?? 'سجل';
    const detail = Object.entries(row).filter(([key]) => !['name', 'title'].includes(key)).slice(0, 4)
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' · ');
    return `<li><strong>${escapeHtml(title)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</li>`;
  }).join('')}</ul>`;
}

function form(action, id, data = {}) {
  if (action !== 'open-metric') return '';
  const metric = data.metric ?? {};
  return `<div class="cockpit-detail" data-metric="${escapeHtml(id)}">
    <div class="cockpit-detail-head">
      <span class="cockpit-status is-${escapeHtml(metric.status ?? 'unavailable')}">${escapeHtml(STATUS[metric.status] ?? 'غير مقاس')}</span>
      <h3>${escapeHtml(metric.label ?? id)}</h3>
      <strong>${escapeHtml(metricText(metric))}</strong>
    </div>
    <p>${escapeHtml(metric.note ?? '')}</p>
    <dl class="cockpit-detail-meta">
      <div><dt>المصدر</dt><dd>${escapeHtml(metric.source_module ?? 'غير محدد')}</dd></div>
      <div><dt>المالك</dt><dd>${escapeHtml(metric.owner ?? 'غير محدد')}</dd></div>
      <div><dt>نسخة التعريف</dt><dd>${escapeHtml(metric.definition_version ?? '—')}</dd></div>
      <div><dt>جودة القياس</dt><dd>${escapeHtml(QUALITY[metric.quality_state] ?? metric.quality_state ?? 'غير مقاس')}</dd></div>
    </dl>
    ${data.details_withheld ? `<div class="cockpit-withheld" role="note"><strong>التجميع متاح والتفاصيل محجوبة</strong><p>${escapeHtml(data.note ?? 'تحتاج تصريح الوحدة الأصلية لعرض السجلات المسماة.')}</p></div>` : detailRows(data.rows)}
    ${metric.source_link ? `<a class="btn outline" href="${escapeHtml(metric.source_link)}">فتح الوحدة الأصلية</a>` : ''}
  </div>`;
}

export const executiveCockpitUI = Object.freeze({ render, form });
export { render, form };
