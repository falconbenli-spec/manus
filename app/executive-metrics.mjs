import { AppError } from './auth.mjs';
import { refuse } from './refusal.mjs';

const STATUSES = new Set(['actual', 'derived', 'forecast', 'unavailable']);
const QUALITY_STATES = new Set(['measured', 'partial', 'stale', 'estimated', 'unavailable']);

export function metricDefinition(db, tenantId, key) {
  const definition = db.prepare(`SELECT * FROM executive_metric_definitions
    WHERE tenant_id=? AND key=? ORDER BY version DESC LIMIT 1`).get(tenantId, key);
  if (!definition) refuse(404, 'metric_definition_not_found', {
    what: 'تعذر عرض المؤشر لأن تعريفه المحكوم غير موجود',
    next: 'اطلب من مسؤول حوكمة البيانات إضافة تعريف المؤشر وإصداره قبل استخدامه'
  });
  return definition;
}

export function listMetricDefinitions(db, tenantId) {
  return db.prepare(`SELECT definition.* FROM executive_metric_definitions definition
    WHERE definition.tenant_id=? AND NOT EXISTS(
      SELECT 1 FROM executive_metric_definitions newer
      WHERE newer.tenant_id=definition.tenant_id
        AND newer.key=definition.key
        AND newer.version>definition.version
    ) ORDER BY definition.key`).all(tenantId);
}

function validPeriod(period) {
  if (typeof period === 'string') return period.trim().length > 0;
  return period && typeof period === 'object' && !Array.isArray(period)
    && typeof period.from === 'string' && typeof period.to === 'string'
    && period.from.length === 10 && period.to.length === 10 && period.from <= period.to;
}

export function metricValue(definition, input = {}) {
  if (!definition || typeof definition !== 'object') throw new AppError(500, 'metric_definition', 'تعريف المؤشر الداخلي غير صالح ولا يمكن بناء قياس موثوق منه');
  const status = input.status ?? 'unavailable';
  if (!STATUSES.has(status)) throw new AppError(500, 'metric_status', 'حالة المؤشر الداخلية ليست ضمن الحالات المحكومة المعتمدة');
  if (!validPeriod(input.period) || typeof input.scope !== 'string' || !input.scope.trim()
    || typeof input.as_of !== 'string' || !Number.isFinite(Date.parse(input.as_of))) {
    throw new AppError(500, 'metric_metadata', 'بيانات نطاق المؤشر وفترته ووقت القياس غير مكتملة ولا تسمح بعرضه');
  }
  if (status !== 'unavailable' && (typeof input.value !== 'number' || !Number.isFinite(input.value))) {
    throw new AppError(500, 'metric_value', 'قيمة المؤشر المقاس غير رقمية أو غير محدودة ولا يمكن اعتمادها');
  }
  const sampleSize = input.sample_size ?? 0;
  if (!Number.isInteger(sampleSize) || sampleSize < 0) throw new AppError(500, 'metric_sample', 'حجم عينة المؤشر الداخلي يجب أن يكون عددًا صحيحًا غير سالب');
  const qualityState = input.quality_state ?? (status === 'unavailable' ? 'unavailable' : 'measured');
  if (!QUALITY_STATES.has(qualityState)) throw new AppError(500, 'metric_quality', 'حالة جودة المؤشر الداخلية ليست ضمن قاموس الجودة المحكوم');

  return {
    key: definition.key,
    label: definition.label,
    value: status === 'unavailable' ? null : input.value,
    unit: definition.unit,
    period: input.period,
    scope: input.scope.trim(),
    status,
    source_module: definition.source_module,
    source_link: input.source_link ?? definition.source_link,
    definition_version: definition.version,
    as_of: input.as_of,
    sample_size: sampleSize,
    quality_state: qualityState,
    owner: definition.owner,
    note: typeof input.note === 'string' ? input.note : ''
  };
}
