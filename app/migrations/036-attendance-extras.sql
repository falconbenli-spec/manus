-- استكمال الحضور: عطل رسمية يقترحها شخص ويعتمدها آخر، مهمات عمل يعتمدها المدير، ورديات مؤرخة، وعمل إضافي معتمد.
-- العطلة والمهمة تفسّران اليوم فلا يُقترح عليه غياب. العمل الإضافي ساعات معتمدة فقط؛ قيمته تدخل المسير بحركة مستقلة يعتمدها شخص آخر.
CREATE TABLE public_holidays (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  holiday_date TEXT NOT NULL CHECK(holiday_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected')),
  proposed_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK(decided_by IS NULL OR decided_by<>proposed_by),
  CHECK((status='proposed')=(decided_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX public_holidays_one_live ON public_holidays(tenant_id,holiday_date) WHERE status IN ('proposed','approved');
CREATE TRIGGER public_holidays_fixed BEFORE UPDATE ON public_holidays
WHEN OLD.status<>'proposed' OR NEW.holiday_date<>OLD.holiday_date OR NEW.name<>OLD.name OR NEW.basis<>OLD.basis OR NEW.proposed_by<>OLD.proposed_by
BEGIN SELECT RAISE(ABORT,'a decided holiday is final'); END;
CREATE TRIGGER public_holidays_no_delete BEFORE DELETE ON public_holidays BEGIN SELECT RAISE(ABORT,'holidays are retained'); END;

CREATE TABLE work_missions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  destination TEXT NOT NULL CHECK(length(trim(destination))>=2),
  purpose TEXT NOT NULL CHECK(length(trim(purpose))>=10),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(to_date>=from_date),
  CHECK(decided_by IS NULL OR decided_by<>user_id OR status='cancelled'),
  CHECK((status='pending')=(decided_by IS NULL))
) STRICT;
CREATE INDEX work_missions_user ON work_missions(user_id,from_date,to_date);
CREATE TRIGGER work_missions_fixed BEFORE UPDATE ON work_missions
WHEN OLD.status<>'pending' OR NEW.user_id<>OLD.user_id OR NEW.from_date<>OLD.from_date OR NEW.to_date<>OLD.to_date OR NEW.destination<>OLD.destination OR NEW.purpose<>OLD.purpose
BEGIN SELECT RAISE(ABORT,'a decided mission is final'); END;
CREATE TRIGGER work_missions_no_delete BEFORE DELETE ON work_missions BEGIN SELECT RAISE(ABORT,'missions are retained'); END;

CREATE TABLE shift_assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  start_time TEXT NOT NULL CHECK(start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time TEXT NOT NULL CHECK(end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  workdays_json TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  assigned_by TEXT NOT NULL REFERENCES users(id),
  ended_by TEXT REFERENCES users(id),
  ended_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(to_date>=from_date),
  CHECK(end_time<>start_time),
  CHECK(assigned_by<>user_id),
  CHECK((ended_by IS NULL)=(ended_at IS NULL))
) STRICT;
CREATE INDEX shift_assignments_user ON shift_assignments(user_id,from_date,to_date);
CREATE TRIGGER shift_assignments_fixed BEFORE UPDATE ON shift_assignments
WHEN OLD.ended_at IS NOT NULL OR NEW.user_id<>OLD.user_id OR NEW.from_date<>OLD.from_date OR NEW.start_time<>OLD.start_time OR NEW.end_time<>OLD.end_time OR NEW.workdays_json<>OLD.workdays_json OR NEW.reason<>OLD.reason OR NEW.assigned_by<>OLD.assigned_by OR NEW.to_date>OLD.to_date
BEGIN SELECT RAISE(ABORT,'a shift is ended early, not rewritten'); END;
CREATE TRIGGER shift_assignments_no_delete BEFORE DELETE ON shift_assignments BEGIN SELECT RAISE(ABORT,'shifts are retained'); END;

CREATE TABLE overtime_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 15 AND 720 AND minutes%15=0),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  adjustment_id TEXT REFERENCES payroll_adjustments(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>user_id),
  CHECK((status='pending')=(decided_by IS NULL)),
  CHECK(adjustment_id IS NULL OR status='approved')
) STRICT;
CREATE UNIQUE INDEX overtime_requests_one_live ON overtime_requests(user_id,work_date) WHERE status IN ('pending','approved');
CREATE UNIQUE INDEX overtime_requests_one_adjustment ON overtime_requests(adjustment_id) WHERE adjustment_id IS NOT NULL;
CREATE TRIGGER overtime_requests_fixed BEFORE UPDATE ON overtime_requests
WHEN (OLD.status<>'pending' AND NEW.status<>OLD.status) OR NEW.user_id<>OLD.user_id OR NEW.work_date<>OLD.work_date OR NEW.minutes<>OLD.minutes OR NEW.reason<>OLD.reason
BEGIN SELECT RAISE(ABORT,'a decided overtime request is final'); END;
CREATE TRIGGER overtime_requests_no_delete BEFORE DELETE ON overtime_requests BEGIN SELECT RAISE(ABORT,'overtime requests are retained'); END;
