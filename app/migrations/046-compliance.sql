-- تقويم الالتزامات النظامية والدورية: لكل التزام مالك وموعد يدخله من يعرفه مع سنده، وإثبات تنفيذ لكل فترة يتحقق منه شخص آخر.
-- المنصة لا تعرف المواعيد النظامية بنفسها ولا تنفذ المعاملة لدى الجهة؛ تذكّر وتحفظ الدليل.
CREATE TABLE compliance_obligations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  authority TEXT NOT NULL CHECK(length(trim(authority))>=2),
  cadence TEXT NOT NULL CHECK(cadence IN ('monthly','quarterly','yearly')),
  due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 28),
  due_month INTEGER CHECK(due_month IS NULL OR due_month BETWEEN 1 AND 12),
  owner_id TEXT NOT NULL,
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,title),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((cadence='monthly')=(due_month IS NULL))
) STRICT;
CREATE TRIGGER compliance_obligations_versioned BEFORE UPDATE ON compliance_obligations WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'stale obligation'); END;
CREATE TRIGGER compliance_obligations_no_delete BEFORE DELETE ON compliance_obligations BEGIN SELECT RAISE(ABORT,'obligations are deactivated, not deleted'); END;
CREATE TABLE compliance_completions (
  id TEXT PRIMARY KEY,
  obligation_id TEXT NOT NULL REFERENCES compliance_obligations(id),
  period TEXT NOT NULL,
  due_date TEXT NOT NULL,
  completed_by TEXT NOT NULL REFERENCES users(id),
  completed_at TEXT NOT NULL,
  evidence_reference TEXT NOT NULL CHECK(length(trim(evidence_reference))>=5),
  verified_by TEXT REFERENCES users(id),
  verified_at TEXT,
  verification_note TEXT NOT NULL DEFAULT '',
  UNIQUE(obligation_id,period),
  CHECK(verified_by IS NULL OR verified_by<>completed_by)
) STRICT;
CREATE TRIGGER compliance_completions_fixed BEFORE UPDATE ON compliance_completions
WHEN OLD.verified_by IS NOT NULL OR NEW.period<>OLD.period OR NEW.evidence_reference<>OLD.evidence_reference OR NEW.completed_by<>OLD.completed_by
BEGIN SELECT RAISE(ABORT,'a completion is verified once and never rewritten'); END;
CREATE TRIGGER compliance_completions_no_delete BEFORE DELETE ON compliance_completions BEGIN SELECT RAISE(ABORT,'completions are retained'); END;
