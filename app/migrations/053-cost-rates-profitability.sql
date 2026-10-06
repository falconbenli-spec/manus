-- تكلفة الساعة وربحية المشروع والعميل.
-- القاعدة الحاكمة: معدل التكلفة خاصية «فئة وظيفية» لا خاصية شخص. لو ربطنا المعدل بالفرد لانكشف راتبه التقريبي
-- لكل من يفتح تقرير ربحية، فالخصوصية هنا مقدَّمة على دقة التكلفة. لا عمود user_id في جدول المعدلات إطلاقًا،
-- ولا يُشتق أي معدل آليًا من جدول الرواتب: يدخله صاحب الإجراء بمصدره ويعتمده شخص آخر.

CREATE TABLE job_categories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=2),
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  UNIQUE(id,tenant_id)
) STRICT;
CREATE TRIGGER job_categories_versioned BEFORE UPDATE ON job_categories
WHEN NEW.version<>OLD.version+1 OR NEW.code<>OLD.code OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'stale job category'); END;
CREATE TRIGGER job_categories_no_delete BEFORE DELETE ON job_categories
BEGIN SELECT RAISE(ABORT,'categories are deactivated, not deleted'); END;

-- معدل الساعة بنسخ مؤرخة: النسخة المعتمدة لا تُعدَّل بأثر رجعي، والتغيير نسخة جديدة بتاريخ سريان جديد،
-- فتبقى تكلفة ساعة العام الماضي محسوبة بمعدل العام الماضي.
CREATE TABLE category_cost_rates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  category_id TEXT NOT NULL,
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  rate_minor INTEGER NOT NULL CHECK(rate_minor>0 AND rate_minor<=100000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  source TEXT NOT NULL CHECK(length(trim(source))>=10),
  status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(category_id,tenant_id) REFERENCES job_categories(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='draft')=(decided_by IS NULL)),
  CHECK((status='draft')=(decided_at IS NULL))
) STRICT;
-- نسخة حية واحدة لكل فئة وتاريخ سريان: المعدل المعتمد لا يزاحمه معدل ثانٍ لليوم نفسه.
CREATE UNIQUE INDEX category_cost_rates_one_live ON category_cost_rates(tenant_id,category_id,effective_from) WHERE status<>'rejected';
CREATE INDEX category_cost_rates_lookup ON category_cost_rates(tenant_id,category_id,effective_from,status);
CREATE TRIGGER category_cost_rates_fixed BEFORE UPDATE ON category_cost_rates
WHEN OLD.status<>'draft' OR NEW.version<>OLD.version+1 OR NEW.status NOT IN ('approved','rejected')
  OR NEW.rate_minor<>OLD.rate_minor OR NEW.effective_from<>OLD.effective_from OR NEW.category_id<>OLD.category_id
  OR NEW.source<>OLD.source OR NEW.prepared_by<>OLD.prepared_by OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'an approved cost rate is never revised; approve a new dated rate instead'); END;
CREATE TRIGGER category_cost_rates_no_delete BEFORE DELETE ON category_cost_rates
BEGIN SELECT RAISE(ABORT,'cost rates are retained'); END;

-- انتماء الموظف لفئة وظيفية، مؤرخ هو الآخر: ساعة سُجلت قبل ترقيته تُكلَّف بفئته وقتها لا بفئته اليوم.
-- لا مبلغ في هذا الجدول: الفئة وحدها، والمبلغ في جدول المعدلات.
CREATE TABLE employee_job_categories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=5),
  assigned_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,user_id,effective_from),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(category_id,tenant_id) REFERENCES job_categories(id,tenant_id)
) STRICT;
CREATE INDEX employee_job_categories_lookup ON employee_job_categories(tenant_id,user_id,effective_from);
CREATE TRIGGER employee_job_categories_fixed BEFORE UPDATE ON employee_job_categories
BEGIN SELECT RAISE(ABORT,'an assignment is corrected by a new dated assignment'); END;
CREATE TRIGGER employee_job_categories_no_delete BEFORE DELETE ON employee_job_categories
BEGIN SELECT RAISE(ABORT,'assignments are retained'); END;

-- التحميل العام (المصاريف العمومية): مبلغ لكل ساعة أو نسبة من التكلفة المباشرة، بنسخ مؤرخة ومصدر مكتوب.
-- لا قيمة افتراضية: بلا نسخة معتمدة لا يُحمَّل شيء، وتقول الشاشة ذلك.
CREATE TABLE overhead_rates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  method TEXT NOT NULL CHECK(method IN ('per_hour','percent_of_direct_cost')),
  rate_minor INTEGER CHECK(rate_minor IS NULL OR (rate_minor>0 AND rate_minor<=100000000)),
  basis_points INTEGER CHECK(basis_points IS NULL OR (basis_points>0 AND basis_points<=100000)),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  source TEXT NOT NULL CHECK(length(trim(source))>=10),
  status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((method='per_hour')=(rate_minor IS NOT NULL)),
  CHECK((method='percent_of_direct_cost')=(basis_points IS NOT NULL)),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='draft')=(decided_by IS NULL)),
  CHECK((status='draft')=(decided_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX overhead_rates_one_live ON overhead_rates(tenant_id,effective_from) WHERE status<>'rejected';
CREATE TRIGGER overhead_rates_fixed BEFORE UPDATE ON overhead_rates
WHEN OLD.status<>'draft' OR NEW.version<>OLD.version+1 OR NEW.status NOT IN ('approved','rejected')
  OR NEW.method<>OLD.method OR NEW.rate_minor IS NOT OLD.rate_minor OR NEW.basis_points IS NOT OLD.basis_points
  OR NEW.effective_from<>OLD.effective_from OR NEW.source<>OLD.source OR NEW.prepared_by<>OLD.prepared_by OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'an approved overhead rate is never revised; approve a new dated rate instead'); END;
CREATE TRIGGER overhead_rates_no_delete BEFORE DELETE ON overhead_rates
BEGIN SELECT RAISE(ABORT,'overhead rates are retained'); END;

-- ربحية الخدمة تحتاج معرفة نوع العمل، والمنصة لا تعرفه من المشروع نفسه: يوسمه صاحب الإجراء بعائلة خدمة معلنة.
-- المشروع غير الموسوم يظهر في التقرير مستقلًا ولا يُوزَّع على العائلات بالتخمين.
CREATE TABLE project_service_tags (
  project_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  family TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  tagged_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id)
) STRICT;
CREATE TRIGGER project_service_tags_versioned BEFORE UPDATE ON project_service_tags
WHEN NEW.version<>OLD.version+1 OR NEW.project_id<>OLD.project_id OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'stale service tag'); END;
CREATE TRIGGER project_service_tags_no_delete BEFORE DELETE ON project_service_tags
BEGIN SELECT RAISE(ABORT,'service tags are retained'); END;
