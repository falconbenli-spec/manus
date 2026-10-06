-- لقطات التقارير: نتيجة محفوظة ببصمتها ووقت استخراجها، تُعتمد بشخص آخر وتُعاد قراءتها كما هي.
CREATE TABLE report_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  report_key TEXT NOT NULL,
  title TEXT NOT NULL,
  params TEXT NOT NULL CHECK(json_valid(params)),
  result TEXT NOT NULL CHECK(json_valid(result)),
  digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','approved')),
  created_by TEXT NOT NULL REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK(approved_by IS NULL OR approved_by<>created_by),
  CHECK((status='approved')=(approved_by IS NOT NULL))
) STRICT;
CREATE TRIGGER report_snapshots_fixed BEFORE UPDATE ON report_snapshots
WHEN OLD.status='approved' OR NEW.result<>OLD.result OR NEW.digest<>OLD.digest OR NEW.params<>OLD.params OR NEW.report_key<>OLD.report_key OR NEW.created_by<>OLD.created_by
BEGIN SELECT RAISE(ABORT,'a snapshot keeps the figures it captured'); END;
CREATE TRIGGER report_snapshots_no_delete BEFORE DELETE ON report_snapshots
WHEN OLD.status='approved' BEGIN SELECT RAISE(ABORT,'approved snapshots are retained'); END;
