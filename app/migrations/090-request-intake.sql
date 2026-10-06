-- استقبال الطلب باحترافية: أثر وعجلة تشتقان الأولوية، ومستفيد قد يختلف عن مقدّم الطلب، ومبرر وأثر مالي وربط بالسجلات.
-- المقاييس ومصفوفة الأولوية تبدأ فارغة عمدًا: المنصة لا تعرف مقياس الأثر في هذه الشركة، ومالك الإجراء هو من يضعه بسنده.

CREATE TABLE intake_scales (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  dimension TEXT NOT NULL CHECK(dimension IN ('impact','urgency')),
  code TEXT NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 40),
  name TEXT NOT NULL CHECK(length(trim(name))>=2),
  guidance TEXT NOT NULL CHECK(length(trim(guidance))>=10),
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 9),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  defined_by TEXT NOT NULL REFERENCES users(id),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,dimension,code),
  UNIQUE(tenant_id,dimension,rank)
) STRICT;

CREATE TABLE priority_matrix (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  impact_code TEXT NOT NULL,
  urgency_code TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(length(trim(priority))>=2),
  priority_rank INTEGER NOT NULL CHECK(priority_rank BETWEEN 1 AND 9),
  target_days INTEGER CHECK(target_days IS NULL OR target_days BETWEEN 0 AND 120),
  defined_by TEXT NOT NULL REFERENCES users(id),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,impact_code,urgency_code)
) STRICT;

-- بيانات الاستقبال لكل طلب. تُملأ قبل التقديم وتُجمَّد بعده مع نسخة الطلب.
CREATE TABLE request_intake (
  request_id TEXT PRIMARY KEY REFERENCES requests(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  beneficiary_id TEXT REFERENCES users(id),
  impact_code TEXT,
  urgency_code TEXT,
  priority TEXT,
  priority_rank INTEGER,
  needed_by TEXT CHECK(needed_by IS NULL OR needed_by GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  justification TEXT NOT NULL DEFAULT '',
  cost_impact_minor INTEGER CHECK(cost_impact_minor IS NULL OR cost_impact_minor BETWEEN 0 AND 1000000000000),
  cost_center TEXT NOT NULL DEFAULT '',
  client_id TEXT,
  campaign_id TEXT,
  contract_reference TEXT NOT NULL DEFAULT '',
  frozen_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

-- المستفيد لا يكون هو مقدّم الطلب: إن كان الطلب لنفسه فالحقل فارغ، حتى لا يوجد تمثيلان لحقيقة واحدة.
CREATE TRIGGER request_intake_beneficiary_distinct BEFORE INSERT ON request_intake
WHEN NEW.beneficiary_id IS NOT NULL AND NEW.beneficiary_id=(SELECT requester_id FROM requests WHERE id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'beneficiary equals requester: leave it empty'); END;

CREATE TRIGGER request_intake_beneficiary_distinct_update BEFORE UPDATE ON request_intake
WHEN NEW.beneficiary_id IS NOT NULL AND NEW.beneficiary_id=(SELECT requester_id FROM requests WHERE id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'beneficiary equals requester: leave it empty'); END;

-- بعد التقديم تُجمَّد بيانات الاستقبال مع النسخة المقدَّمة؛ التغيير يكون بإعادة الطلب لصاحبه وتقديم نسخة جديدة.
CREATE TRIGGER request_intake_frozen BEFORE UPDATE ON request_intake
WHEN OLD.frozen_at IS NOT NULL AND NEW.frozen_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'submitted intake is frozen with its revision'); END;

CREATE INDEX request_intake_beneficiary ON request_intake(tenant_id,beneficiary_id);
