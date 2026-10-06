import { can } from './access.mjs';
import { metricDefinition, metricValue } from './executive-metrics.mjs';
import { activeEmployeeCount, activeEmployeePage } from './people-read.mjs';
import { actorOrRefuse, refuse } from './refusal.mjs';
import { executiveAxesBoard } from './project-axes.mjs';
import { portfolioForecast } from './pipeline-estimates.mjs';
import * as v from './validation.mjs';

const DAY = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const NOW = () => new Date().toISOString();
const DIMENSION_ORDER = ['cash', 'growth', 'delivery', 'people', 'risk', 'quality'];

function actor(db, supplied) {
  const user = actorOrRefuse(db, supplied);
  if (!can(db, user, 'executive.view')) refuse(403, 'forbidden', {
    what: 'لا يمكن فتح المقصورة التنفيذية بهذا الحساب',
    missing: [{ document: 'تصريح عرض المقصورة التنفيذية', owner: 'مسؤول الصلاحيات', owner_role: 'admin' }],
    next: 'اطلب التصريح المسجل ثم أعد فتح المقصورة'
  });
  return user;
}

function periodOf({ from, to } = {}) {
  const end = to ? v.date(to) : DAY();
  const start = from ? v.date(from) : `${end.slice(0, 4)}-01-01`;
  if (end < start) refuse(400, 'date_order', {
    what: 'لا يمكن قياس فترة تنتهي قبل تاريخ بدايتها',
    next: 'اختر تاريخ نهاية يساوي تاريخ البداية أو يأتي بعده'
  });
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 366) refuse(400, 'date_range', {
    what: 'لا يمكن قياس فترة تنفيذية تتجاوز 366 يومًا',
    next: 'اختر فترة أقصر ثم أعد تشغيل التقرير'
  });
  return { from: start, to: end };
}

function value(db, user, key, input) {
  return metricValue(metricDefinition(db, user.tenant_id, key), input);
}

function stateFor(metric, { critical = Number.POSITIVE_INFINITY, attention = 1 } = {}) {
  if (metric.status === 'unavailable') return 'unknown';
  if (metric.value >= critical) return 'critical';
  if (metric.value >= attention) return 'attention';
  return 'good';
}

export function cashDimension(db, user, period, measuredAt) {
  const rows = db.prepare(`SELECT claim.id,claim.due_date,CAST(claim.amount_minor AS INTEGER) AS amount_minor,
      COALESCE((SELECT SUM(CAST(receipt.amount_minor AS INTEGER)) FROM ar_receipts receipt
        WHERE receipt.claim_id=claim.id AND receipt.tenant_id=claim.tenant_id AND receipt.status='confirmed'),0) AS received_minor
    FROM ar_claims claim
    WHERE claim.tenant_id=? AND claim.status='approved' AND claim.currency='SAR'`).all(user.tenant_id);
  const overdue = rows.filter(row => row.due_date < period.to && row.amount_minor > row.received_minor);
  const metric = value(db, user, 'cash.overdue', rows.length ? {
    value: overdue.reduce((sum, row) => sum + row.amount_minor - row.received_minor, 0),
    period, scope: 'tenant', status: 'derived', as_of: measuredAt, sample_size: rows.length,
    note: 'الرصيد المتأخر مشتق من المطالبات المعتمدة بالريال ناقص المقبوض المؤكد.'
  } : {
    period, scope: 'tenant', status: 'unavailable', as_of: measuredAt,
    note: 'لا توجد عينة مطالبات معتمدة بالريال يمكن قياسها.'
  });
  const state = stateFor(metric, { critical: 1, attention: 1 });
  return { key: 'cash', label: 'السيولة والتحصيل', state, metrics: [metric], attention: state === 'unknown' ? [] : metric.value > 0 ? [{
    key: metric.key, severity: 'critical', text: `مبالغ متأخرة بقيمة ${metric.value} هللة تحتاج متابعة التحصيل.`, source_link: metric.source_link
  }] : [] };
}

function portfolioFor(db, user, period, cached) {
  if (cached) return cached;
  const axes = executiveAxesBoard(db, user).projects;
  const funnel = portfolioForecast(db, user, period);
  return {
    projects: axes.length,
    on_hold: axes.filter(project => project.axes.execution === 'on_hold').length,
    blocked_start: axes.filter(project => ['awaiting_client_po', 'awaiting_advance'].includes(project.axes.readiness)).length,
    funnel
  };
}

export function growthDimension(db, user, period, measuredAt, portfolio = null) {
  const source = portfolioFor(db, user, period, portfolio);
  const funnel = source.funnel;
  const sample = funnel?.open_count ?? 0;
  const metric = value(db, user, 'growth.weighted_pipeline', sample ? {
    value: funnel.weighted_minor, period, scope: 'tenant', status: 'forecast', as_of: measuredAt,
    sample_size: sample, quality_state: funnel.unweighted_count ? 'partial' : 'estimated',
    note: funnel.warning ?? 'توقع مبني على قيم الفرص واحتمالات المراحل المعتمدة.'
  } : {
    period, scope: 'tenant', status: 'unavailable', as_of: measuredAt,
    note: 'لا توجد فرص مفتوحة تشكل عينة لقمع موزون.'
  });
  const state = metric.status === 'unavailable' ? 'unknown' : funnel.unweighted_count ? 'attention' : 'good';
  return { key: 'growth', label: 'النمو والعملاء', state, metrics: [metric], attention: funnel?.unweighted_count ? [{
    key: metric.key, severity: 'attention', text: `${funnel.unweighted_count} فرصة مفتوحة خارج وزن مرحلة معتمدة.`, source_link: metric.source_link
  }] : [] };
}

export function deliveryDimension(db, user, period, measuredAt, portfolio = null) {
  const source = portfolioFor(db, user, period, portfolio);
  const count = (source.on_hold ?? 0) + (source.blocked_start ?? 0);
  const metric = value(db, user, 'delivery.blocked', source.projects ? {
    value: count, period, scope: 'tenant', status: 'derived', as_of: measuredAt,
    sample_size: source.projects, note: 'عدد المشاريع الموقوفة أو المحجوبة قبل البدء من محاور المحفظة.'
  } : {
    period, scope: 'tenant', status: 'unavailable', as_of: measuredAt,
    note: 'لا توجد عينة مشاريع يمكن قياس حالة تسليمها.'
  });
  const state = stateFor(metric, { critical: 3, attention: 1 });
  return { key: 'delivery', label: 'التسليم والمشاريع', state, metrics: [metric], attention: metric.value > 0 ? [{
    key: metric.key, severity: state, text: `${metric.value} مشروعًا متوقفًا أو محجوبًا قبل البدء.`, source_link: metric.source_link
  }] : [] };
}

export function peopleDimension(db, user, period, measuredAt) {
  const count = activeEmployeeCount(db, user.tenant_id);
  const metric = value(db, user, 'people.headcount', {
    value: count, period, scope: 'tenant', status: 'actual', as_of: measuredAt,
    sample_size: count, note: 'حسابات الموظفين النشطة باستثناء حسابات إدارة المنصة.'
  });
  return { key: 'people', label: 'الأفراد والسعة', state: 'good', metrics: [metric], attention: [] };
}

export function riskDimension(db, user, period, measuredAt) {
  const rows = db.prepare(`SELECT likelihood_value*impact_value AS score FROM governance_risks
    WHERE tenant_id=? AND status='open'`).all(user.tenant_id);
  const highBand = db.prepare(`SELECT min_score,max_score,label FROM governance_risk_bands
    WHERE tenant_id=? ORDER BY min_score DESC LIMIT 1`).get(user.tenant_id);
  const high = highBand ? rows.filter(row => row.score >= highBand.min_score && row.score <= highBand.max_score).length : 0;
  const metric = value(db, user, 'risk.red', rows.length && highBand ? {
    value: high, period, scope: 'tenant', status: 'derived', as_of: measuredAt,
    sample_size: rows.length, note: `أعلى نطاق معتمد في سجل المخاطر: ${highBand.label}.`
  } : {
    period, scope: 'tenant', status: 'unavailable', as_of: measuredAt,
    note: rows.length ? 'مقياس نطاقات المخاطر غير مهيأ.' : 'لا توجد عينة مخاطر مفتوحة يمكن قياسها.'
  });
  const state = stateFor(metric, { critical: 1, attention: 1 });
  return { key: 'risk', label: 'المخاطر والالتزام', state, metrics: [metric], attention: metric.value > 0 ? [{
    key: metric.key, severity: 'critical', text: `${metric.value} مخاطر في أعلى نطاق معتمد.`, source_link: metric.source_link
  }] : [] };
}

export function qualityDimension(db, user, period, measuredAt, dimensions) {
  const missing = dimensions.flatMap(dimension => dimension.metrics).filter(metric => metric.status === 'unavailable').length;
  const metric = value(db, user, 'quality.unavailable', {
    value: missing, period, scope: 'tenant', status: 'derived', as_of: measuredAt,
    sample_size: dimensions.flatMap(dimension => dimension.metrics).length,
    quality_state: missing ? 'partial' : 'measured',
    note: 'عدد مؤشرات المقصورة التي لم يقدم مصدرها قيمة محكومة.'
  });
  const state = stateFor(metric, { critical: 3, attention: 1 });
  return { key: 'quality', label: 'العملاء وجودة البيانات', state, metrics: [metric], attention: missing ? [{
    key: metric.key, severity: state, text: `${missing} مؤشرات بلا قياس محكوم حتى الآن.`, source_link: metric.source_link
  }] : [] };
}

function narrative(dimensions, attention) {
  const critical = dimensions.filter(dimension => dimension.state === 'critical').map(dimension => dimension.label);
  if (critical.length) return `${critical.slice(0, 2).join(' و')} تحتاج تدخلًا؛ وتوجد ${attention.length} إشارات تتطلب المتابعة.`;
  const unknown = dimensions.filter(dimension => dimension.state === 'unknown').length;
  if (unknown) return `وضع الشركة مستقر في المصادر المقاسة، و${unknown} أبعاد تحتاج استكمال القياس قبل الحكم.`;
  return attention.length ? `وضع الشركة مستقر إجمالًا، مع ${attention.length} إشارات تحتاج متابعة.` : 'المؤشرات المقاسة مستقرة ولا توجد إشارة تنفيذية عاجلة.';
}

export function executiveCockpit(db, supplied, options = {}) {
  const user = actor(db, supplied);
  const period = periodOf(options);
  const measuredAt = NOW();
  const dimensions = [
    cashDimension(db, user, period, measuredAt),
    growthDimension(db, user, period, measuredAt, options.portfolio),
    deliveryDimension(db, user, period, measuredAt, options.portfolio),
    peopleDimension(db, user, period, measuredAt),
    riskDimension(db, user, period, measuredAt)
  ];
  dimensions.push(qualityDimension(db, user, period, measuredAt, dimensions));
  dimensions.sort((a, b) => DIMENSION_ORDER.indexOf(a.key) - DIMENSION_ORDER.indexOf(b.key));
  const attention = dimensions.flatMap(dimension => dimension.attention).slice(0, 5);
  return {
    generated_at: measuredAt,
    today: period.to,
    period,
    scope: 'tenant',
    summary: narrative(dimensions, attention),
    dimensions,
    attention,
    note: 'مجاميع للكيان فقط. التفاصيل المسماة تمر بصلاحية الوحدة الأصلية.'
  };
}

const DETAIL_CAPABILITY = Object.freeze({
  'cash.overdue': 'finance.use',
  'growth.weighted_pipeline': 'commercial.use',
  'delivery.blocked': 'projects.use',
  'people.headcount': 'employees.view',
  'risk.red': 'governance.risks.manage'
});

export function executiveDrilldown(db, supplied, key, options = {}) {
  const user = actor(db, supplied);
  const board = executiveCockpit(db, user, options);
  const metric = board.dimensions.flatMap(dimension => dimension.metrics).find(item => item.key === key);
  if (!metric) refuse(404, 'metric_not_found', {
    what: 'لا يمكن فتح تفاصيل مؤشر غير موجود في المقصورة الحالية',
    next: 'أعد فتح المقصورة واختر مؤشرًا ظاهرًا فيها'
  });
  const capability = DETAIL_CAPABILITY[key];
  if (!capability || !can(db, user, capability, user.department_id)) {
    return { metric, details_withheld: true, rows: [], next_cursor: null, note: 'التجميع متاح، أما السجلات المسماة فتحتاج تصريح الوحدة الأصلية.' };
  }
  const offset = Number.isInteger(Number(options.cursor)) && Number(options.cursor) >= 0 ? Number(options.cursor) : 0;
  const limit = 50;
  let rows = [];
  if (key === 'cash.overdue') rows = db.prepare(`SELECT id,due_date,CAST(amount_minor AS INTEGER) AS amount_minor,status
    FROM ar_claims WHERE tenant_id=? AND status='approved' AND currency='SAR' AND due_date<? ORDER BY due_date,id LIMIT ? OFFSET ?`)
    .all(user.tenant_id, board.period.to, limit + 1, offset);
  if (key === 'growth.weighted_pipeline') rows = db.prepare(`SELECT id,name,status,value_minor,stage_code
    FROM opportunities WHERE tenant_id=? AND status='open' ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`)
    .all(user.tenant_id, limit + 1, offset);
  if (key === 'delivery.blocked') rows = executiveAxesBoard(db, user).projects
    .filter(project => project.axes.execution === 'on_hold' || ['awaiting_client_po', 'awaiting_advance'].includes(project.axes.readiness))
    .slice(offset, offset + limit + 1).map(project => ({ id: project.id, name: project.name, axes: project.axes }));
  if (key === 'people.headcount') rows = activeEmployeePage(db, user.tenant_id, { limit: limit + 1, offset });
  if (key === 'risk.red') rows = db.prepare(`SELECT id,title,category,likelihood_value,impact_value,next_review_on
    FROM governance_risks WHERE tenant_id=? AND status='open' ORDER BY likelihood_value*impact_value DESC,id LIMIT ? OFFSET ?`)
    .all(user.tenant_id, limit + 1, offset);
  const hasMore = rows.length > limit;
  return { metric, details_withheld: false, rows: rows.slice(0, limit), next_cursor: hasMore ? String(offset + limit) : null };
}
