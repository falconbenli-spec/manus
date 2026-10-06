CREATE TABLE executive_metric_definitions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL CHECK(length(trim(key)) BETWEEN 3 AND 80),
  version INTEGER NOT NULL CHECK(version > 0),
  label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 2 AND 120),
  unit TEXT NOT NULL CHECK(unit IN ('count','minor_currency','basis_points','days','ratio')),
  formula TEXT NOT NULL CHECK(length(trim(formula)) BETWEEN 3 AND 1000),
  source_module TEXT NOT NULL CHECK(length(trim(source_module)) BETWEEN 2 AND 80),
  source_link TEXT NOT NULL CHECK(length(trim(source_link)) BETWEEN 2 AND 240),
  owner TEXT NOT NULL CHECK(length(trim(owner)) BETWEEN 2 AND 120),
  active_from TEXT NOT NULL CHECK(length(active_from)=10),
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,key,version)
) STRICT;

CREATE TABLE executive_metric_observations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  metric_key TEXT NOT NULL,
  definition_version INTEGER NOT NULL CHECK(definition_version > 0),
  status TEXT NOT NULL CHECK(status IN ('actual','derived','forecast','unavailable')),
  observed_at TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  FOREIGN KEY(tenant_id,metric_key,definition_version)
    REFERENCES executive_metric_definitions(tenant_id,key,version)
) STRICT;

CREATE INDEX executive_metric_observations_metric
  ON executive_metric_observations(tenant_id,metric_key,definition_version,observed_at);

CREATE TRIGGER executive_metric_definition_used_no_update
BEFORE UPDATE ON executive_metric_definitions
WHEN EXISTS(
  SELECT 1 FROM executive_metric_observations observation
  WHERE observation.tenant_id=OLD.tenant_id
    AND observation.metric_key=OLD.key
    AND observation.definition_version=OLD.version
)
BEGIN SELECT RAISE(ABORT,'a metric definition already used cannot be rewritten'); END;

CREATE TRIGGER executive_metric_definition_used_no_delete
BEFORE DELETE ON executive_metric_definitions
WHEN EXISTS(
  SELECT 1 FROM executive_metric_observations observation
  WHERE observation.tenant_id=OLD.tenant_id
    AND observation.metric_key=OLD.key
    AND observation.definition_version=OLD.version
)
BEGIN SELECT RAISE(ABORT,'a metric definition already used cannot be deleted'); END;

CREATE TRIGGER executive_metric_observations_no_update
BEFORE UPDATE ON executive_metric_observations
BEGIN SELECT RAISE(ABORT,'metric observations are append only'); END;

CREATE TRIGGER executive_metric_observations_no_delete
BEFORE DELETE ON executive_metric_observations
BEGIN SELECT RAISE(ABORT,'metric observations are append only'); END;

CREATE TRIGGER executive_metric_definitions_for_new_tenant
AFTER INSERT ON tenants
BEGIN
  INSERT INTO executive_metric_definitions VALUES
    (NEW.id,'cash.overdue',1,'المبالغ المتأخرة','minor_currency','Sum open receivable balances past their due date.','receivables','#receivables','المدير المالي','2026-10-02','2026-10-02T00:00:00.000Z'),
    (NEW.id,'growth.weighted_pipeline',1,'القمع الموزون','minor_currency','Sum open opportunity values multiplied by the approved stage probability.','commercial','#pipeline','مدير تطوير الأعمال','2026-10-02','2026-10-02T00:00:00.000Z'),
    (NEW.id,'delivery.blocked',1,'المشاريع المتوقفة','count','Count active projects with a blocked delivery state.','projects','#projects','مدير إدارة المشاريع','2026-10-02','2026-10-02T00:00:00.000Z'),
    (NEW.id,'people.headcount',1,'عدد الموظفين النشطين','count','Count active employee accounts in the tenant.','people','#people','مدير رأس المال البشري','2026-10-02','2026-10-02T00:00:00.000Z'),
    (NEW.id,'risk.red',1,'المخاطر الحمراء المفتوحة','count','Count open high-severity risks with a red state.','risk','#risks','مالك سجل المخاطر','2026-10-02','2026-10-02T00:00:00.000Z'),
    (NEW.id,'quality.unavailable',1,'المؤشرات غير المقاسة','count','Count cockpit metrics whose source cannot provide a governed value.','governance','#executive','مسؤول حوكمة البيانات','2026-10-02','2026-10-02T00:00:00.000Z');
END;

INSERT INTO executive_metric_definitions
SELECT tenant.id,definition.key,definition.version,definition.label,definition.unit,definition.formula,
  definition.source_module,definition.source_link,definition.owner,definition.active_from,definition.created_at
FROM tenants tenant
CROSS JOIN (
  SELECT 'cash.overdue' AS key,1 AS version,'المبالغ المتأخرة' AS label,'minor_currency' AS unit,
    'Sum open receivable balances past their due date.' AS formula,'receivables' AS source_module,
    '#receivables' AS source_link,'المدير المالي' AS owner,'2026-10-02' AS active_from,'2026-10-02T00:00:00.000Z' AS created_at
  UNION ALL SELECT 'growth.weighted_pipeline',1,'القمع الموزون','minor_currency','Sum open opportunity values multiplied by the approved stage probability.','commercial','#pipeline','مدير تطوير الأعمال','2026-10-02','2026-10-02T00:00:00.000Z'
  UNION ALL SELECT 'delivery.blocked',1,'المشاريع المتوقفة','count','Count active projects with a blocked delivery state.','projects','#projects','مدير إدارة المشاريع','2026-10-02','2026-10-02T00:00:00.000Z'
  UNION ALL SELECT 'people.headcount',1,'عدد الموظفين النشطين','count','Count active employee accounts in the tenant.','people','#people','مدير رأس المال البشري','2026-10-02','2026-10-02T00:00:00.000Z'
  UNION ALL SELECT 'risk.red',1,'المخاطر الحمراء المفتوحة','count','Count open high-severity risks with a red state.','risk','#risks','مالك سجل المخاطر','2026-10-02','2026-10-02T00:00:00.000Z'
  UNION ALL SELECT 'quality.unavailable',1,'المؤشرات غير المقاسة','count','Count cockpit metrics whose source cannot provide a governed value.','governance','#executive','مسؤول حوكمة البيانات','2026-10-02','2026-10-02T00:00:00.000Z'
) definition;
