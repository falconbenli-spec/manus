-- الحضور والانصراف: بصمة ذاتية بوقت الخادم، تصحيح يعتمده المدير المباشر، وغياب غير مدفوع بقرار شخصين.
-- السجل الناقص لا يتحول إلى خصم؛ الخصم لا يأتي إلا من غياب غير مدفوع معتمد صراحة.
CREATE TABLE attendance_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  check_in_at TEXT,
  check_out_at TEXT,
  source TEXT NOT NULL CHECK(source IN ('self','correction')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,work_date),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(check_in_at IS NOT NULL OR check_out_at IS NOT NULL),
  CHECK(check_in_at IS NULL OR check_out_at IS NULL OR check_out_at>check_in_at)
) STRICT;
CREATE TRIGGER attendance_records_no_delete BEFORE DELETE ON attendance_records BEGIN SELECT RAISE(ABORT,'attendance is corrected, not deleted'); END;

CREATE TABLE attendance_corrections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  proposed_in TEXT NOT NULL,
  proposed_out TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  previous_in TEXT,
  previous_out TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(proposed_out>proposed_in),
  CHECK(decided_by IS NULL OR decided_by<>user_id),
  CHECK((status='pending')=(decided_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX attendance_corrections_one_pending ON attendance_corrections(user_id,work_date) WHERE status='pending';
CREATE TRIGGER attendance_corrections_fixed BEFORE UPDATE ON attendance_corrections
WHEN OLD.status<>'pending' OR NEW.user_id<>OLD.user_id OR NEW.work_date<>OLD.work_date OR NEW.proposed_in<>OLD.proposed_in OR NEW.proposed_out<>OLD.proposed_out OR NEW.reason<>OLD.reason
BEGIN SELECT RAISE(ABORT,'a decided correction is final'); END;
CREATE TRIGGER attendance_corrections_no_delete BEFORE DELETE ON attendance_corrections BEGIN SELECT RAISE(ABORT,'corrections are retained'); END;

CREATE TABLE attendance_absences (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  employee_statement TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('proposed','confirmed','dismissed')),
  proposed_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(proposed_by<>user_id),
  CHECK(decided_by IS NULL OR (decided_by<>proposed_by AND decided_by<>user_id)),
  CHECK((status='proposed')=(decided_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX attendance_absences_one_live ON attendance_absences(user_id,work_date) WHERE status IN ('proposed','confirmed');
CREATE TRIGGER attendance_absences_fixed BEFORE UPDATE ON attendance_absences
WHEN OLD.status<>'proposed' OR NEW.user_id<>OLD.user_id OR NEW.work_date<>OLD.work_date OR NEW.reason<>OLD.reason OR NEW.proposed_by<>OLD.proposed_by
BEGIN SELECT RAISE(ABORT,'a decided absence is final'); END;
CREATE TRIGGER attendance_absences_no_delete BEFORE DELETE ON attendance_absences BEGIN SELECT RAISE(ABORT,'absences are retained'); END;
