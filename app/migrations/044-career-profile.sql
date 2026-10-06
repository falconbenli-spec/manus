-- الملف المهني: مؤهلات يدخلها الموظف ويتحقق منها موظف موارد بشرية آخر، وخبرة ومهارات واهتمام مهني يحدّثها صاحبها.
-- يُستخدم لاقتراح خطط التطوير فقط؛ لا يدخل في قرار راتب أو ترقية أو جزاء.
CREATE TABLE employee_qualifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('degree','certification','course','language')),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  field TEXT NOT NULL DEFAULT '',
  institution TEXT NOT NULL DEFAULT '',
  year INTEGER CHECK(year IS NULL OR year BETWEEN 1960 AND 2100),
  status TEXT NOT NULL CHECK(status IN ('self_declared','verified','withdrawn')),
  evidence_reference TEXT NOT NULL DEFAULT '',
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(verified_by IS NULL OR verified_by<>user_id),
  CHECK((status='verified')=(verified_by IS NOT NULL))
) STRICT;
CREATE INDEX employee_qualifications_user ON employee_qualifications(user_id,status);
CREATE TRIGGER employee_qualifications_fixed BEFORE UPDATE ON employee_qualifications
WHEN OLD.status<>'self_declared' OR NEW.user_id<>OLD.user_id OR NEW.title<>OLD.title OR NEW.kind<>OLD.kind OR NEW.institution<>OLD.institution
BEGIN SELECT RAISE(ABORT,'a verified or withdrawn qualification is final; add a new one instead'); END;
CREATE TRIGGER employee_qualifications_no_delete BEFORE DELETE ON employee_qualifications BEGIN SELECT RAISE(ABORT,'qualifications are withdrawn, not deleted'); END;

CREATE TABLE employee_career (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  years_total INTEGER NOT NULL CHECK(years_total BETWEEN 0 AND 60),
  years_in_field INTEGER NOT NULL CHECK(years_in_field BETWEEN 0 AND 60),
  previous_roles TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(skills)),
  career_interest TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(years_in_field<=years_total)
) STRICT;
