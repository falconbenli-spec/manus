CREATE TABLE leave_calendars (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_department_id TEXT NOT NULL,
  hr_department_id TEXT NOT NULL,
  name TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT NOT NULL CHECK(effective_to>=effective_from),
  weekdays_json TEXT NOT NULL CHECK(json_valid(weekdays_json)),
  holidays_json TEXT NOT NULL CHECK(json_valid(holidays_json)),
  timezone TEXT NOT NULL CHECK(timezone='Asia/Riyadh'),
  synthetic INTEGER NOT NULL CHECK(synthetic=1),
  created_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(employee_department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(hr_department_id,tenant_id) REFERENCES departments(id,tenant_id)
) STRICT;
CREATE TABLE leave_balances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  balance_year INTEGER NOT NULL CHECK(balance_year BETWEEN 2000 AND 2200),
  calendar_id TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,employee_id,leave_type,balance_year),
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(calendar_id,tenant_id) REFERENCES leave_calendars(id,tenant_id)
) STRICT;
CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  balance_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL CHECK(end_date>=start_date),
  days INTEGER NOT NULL CHECK(days>0),
  work_dates_json TEXT NOT NULL CHECK(json_valid(work_dates_json)),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending_manager','pending_hr','returned','approved','rejected','cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(balance_id,tenant_id) REFERENCES leave_balances(id,tenant_id)
) STRICT;
CREATE TABLE leave_request_versions (
  request_id TEXT NOT NULL REFERENCES leave_requests(id),
  revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(request_id,revision)
) STRICT;
CREATE TABLE leave_decisions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('manager','hr')),
  actor_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approve','return','reject')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(request_id,revision,stage),
  FOREIGN KEY(request_id,tenant_id) REFERENCES leave_requests(id,tenant_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE leave_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  balance_id TEXT NOT NULL,
  request_id TEXT,
  revision INTEGER,
  kind TEXT NOT NULL CHECK(kind IN ('opening','reserve','release','debit','refund')),
  posted_delta INTEGER NOT NULL,
  reserved_delta INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(request_id,revision,kind),
  FOREIGN KEY(balance_id,tenant_id) REFERENCES leave_balances(id,tenant_id),
  FOREIGN KEY(request_id,tenant_id) REFERENCES leave_requests(id,tenant_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((kind='opening' AND request_id IS NULL AND revision IS NULL AND posted_delta>0 AND reserved_delta=0)
    OR (kind='reserve' AND request_id IS NOT NULL AND revision>0 AND posted_delta=0 AND reserved_delta>0)
    OR (kind='release' AND request_id IS NOT NULL AND revision>0 AND posted_delta=0 AND reserved_delta<0)
    OR (kind='debit' AND request_id IS NOT NULL AND revision>0 AND posted_delta<0 AND reserved_delta=posted_delta)
    OR (kind='refund' AND request_id IS NOT NULL AND revision>0 AND posted_delta>0 AND reserved_delta=0))
) STRICT;
CREATE UNIQUE INDEX leave_opening_once ON leave_ledger(balance_id) WHERE kind='opening';
CREATE UNIQUE INDEX leave_debit_once ON leave_ledger(request_id) WHERE kind='debit';
CREATE UNIQUE INDEX leave_refund_once ON leave_ledger(request_id) WHERE kind='refund';
CREATE INDEX leave_request_scope ON leave_requests(tenant_id,employee_id,status,start_date,end_date);
CREATE INDEX leave_balance_ledger ON leave_ledger(balance_id,seq);
CREATE TRIGGER leave_calendar_no_update BEFORE UPDATE ON leave_calendars BEGIN SELECT RAISE(ABORT,'leave calendar versions are immutable'); END;
CREATE TRIGGER leave_calendar_no_delete BEFORE DELETE ON leave_calendars BEGIN SELECT RAISE(ABORT,'leave calendar versions are immutable'); END;
CREATE TRIGGER leave_balance_no_update BEFORE UPDATE ON leave_balances BEGIN SELECT RAISE(ABORT,'leave balance identity is immutable'); END;
CREATE TRIGGER leave_balance_no_delete BEFORE DELETE ON leave_balances BEGIN SELECT RAISE(ABORT,'leave balance history is immutable'); END;
CREATE TRIGGER leave_ledger_no_update BEFORE UPDATE ON leave_ledger BEGIN SELECT RAISE(ABORT,'leave ledger is append only'); END;
CREATE TRIGGER leave_ledger_no_delete BEFORE DELETE ON leave_ledger BEGIN SELECT RAISE(ABORT,'leave ledger is append only'); END;
CREATE TRIGGER leave_versions_no_update BEFORE UPDATE ON leave_request_versions BEGIN SELECT RAISE(ABORT,'leave submitted versions are immutable'); END;
CREATE TRIGGER leave_versions_no_delete BEFORE DELETE ON leave_request_versions BEGIN SELECT RAISE(ABORT,'leave submitted versions are immutable'); END;
CREATE TRIGGER leave_decision_no_update BEFORE UPDATE ON leave_decisions BEGIN SELECT RAISE(ABORT,'leave decisions are immutable'); END;
CREATE TRIGGER leave_decision_no_delete BEFORE DELETE ON leave_decisions BEGIN SELECT RAISE(ABORT,'leave decisions are immutable'); END;
CREATE TRIGGER leave_request_no_delete BEFORE DELETE ON leave_requests BEGIN SELECT RAISE(ABORT,'leave history is immutable'); END;
CREATE TRIGGER leave_request_identity BEFORE UPDATE ON leave_requests
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.employee_id<>OLD.employee_id OR NEW.balance_id<>OLD.balance_id OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'leave request identity is immutable'); END;
CREATE TRIGGER leave_request_content BEFORE UPDATE ON leave_requests
WHEN (NEW.start_date<>OLD.start_date OR NEW.end_date<>OLD.end_date OR NEW.days<>OLD.days OR NEW.work_dates_json<>OLD.work_dates_json OR NEW.reason<>OLD.reason OR NEW.revision<>OLD.revision)
 AND NOT (OLD.status='returned' AND NEW.status='pending_manager' AND NEW.revision=OLD.revision+1)
BEGIN SELECT RAISE(ABORT,'leave submitted content is immutable'); END;
CREATE TRIGGER leave_request_transition BEFORE UPDATE ON leave_requests
WHEN NEW.version<>OLD.version+1 OR NOT (
 (OLD.status='pending_manager' AND NEW.status IN ('pending_hr','returned','rejected','cancelled'))
 OR (OLD.status='pending_hr' AND NEW.status IN ('approved','returned','rejected','cancelled'))
 OR (OLD.status='returned' AND NEW.status IN ('pending_manager','cancelled'))
 OR (OLD.status='approved' AND NEW.status='cancelled'))
BEGIN SELECT RAISE(ABORT,'invalid leave transition'); END;
CREATE TRIGGER leave_request_balance BEFORE INSERT ON leave_requests
WHEN NOT EXISTS(SELECT 1 FROM leave_balances b WHERE b.id=NEW.balance_id AND b.tenant_id=NEW.tenant_id AND b.employee_id=NEW.employee_id
 AND substr(NEW.start_date,1,4)=CAST(b.balance_year AS TEXT) AND substr(NEW.end_date,1,4)=CAST(b.balance_year AS TEXT) AND NEW.start_date>=b.effective_date)
BEGIN SELECT RAISE(ABORT,'invalid leave balance'); END;
CREATE TRIGGER leave_request_overlap_insert BEFORE INSERT ON leave_requests
WHEN EXISTS(SELECT 1 FROM leave_requests r WHERE r.tenant_id=NEW.tenant_id AND r.employee_id=NEW.employee_id AND r.status IN ('pending_manager','pending_hr','approved') AND r.start_date<=NEW.end_date AND r.end_date>=NEW.start_date)
BEGIN SELECT RAISE(ABORT,'overlapping leave request'); END;
CREATE TRIGGER leave_request_overlap_update BEFORE UPDATE ON leave_requests
WHEN NEW.status IN ('pending_manager','pending_hr','approved') AND EXISTS(SELECT 1 FROM leave_requests r WHERE r.id<>NEW.id AND r.tenant_id=NEW.tenant_id AND r.employee_id=NEW.employee_id AND r.status IN ('pending_manager','pending_hr','approved') AND r.start_date<=NEW.end_date AND r.end_date>=NEW.start_date)
BEGIN SELECT RAISE(ABORT,'overlapping leave request'); END;
CREATE TRIGGER leave_ledger_nonnegative BEFORE INSERT ON leave_ledger
WHEN (SELECT COALESCE(SUM(posted_delta-reserved_delta),0) FROM leave_ledger WHERE balance_id=NEW.balance_id)+NEW.posted_delta-NEW.reserved_delta<0
 OR (SELECT COALESCE(SUM(reserved_delta),0) FROM leave_ledger WHERE balance_id=NEW.balance_id)+NEW.reserved_delta<0
BEGIN SELECT RAISE(ABORT,'leave balance cannot be negative'); END;
CREATE TRIGGER leave_ledger_request BEFORE INSERT ON leave_ledger
WHEN NEW.kind<>'opening' AND NOT EXISTS(SELECT 1 FROM leave_requests r WHERE r.id=NEW.request_id AND r.tenant_id=NEW.tenant_id AND r.balance_id=NEW.balance_id AND r.revision=NEW.revision
 AND ((NEW.kind='reserve' AND NEW.reserved_delta=r.days AND r.status='pending_manager')
 OR (NEW.kind='release' AND NEW.reserved_delta=-r.days AND r.status IN ('returned','rejected','cancelled'))
 OR (NEW.kind='debit' AND NEW.posted_delta=-r.days AND r.status='approved')
 OR (NEW.kind='refund' AND NEW.posted_delta=r.days AND r.status='cancelled')))
BEGIN SELECT RAISE(ABORT,'invalid leave movement'); END;
CREATE TRIGGER leave_refund_requires_debit BEFORE INSERT ON leave_ledger
WHEN NEW.kind='refund' AND NOT EXISTS(SELECT 1 FROM leave_ledger l WHERE l.request_id=NEW.request_id AND l.kind='debit' AND l.posted_delta=-NEW.posted_delta)
BEGIN SELECT RAISE(ABORT,'leave refund requires a matching debit'); END;
CREATE TRIGGER leave_decision_no_self BEFORE INSERT ON leave_decisions
WHEN EXISTS(SELECT 1 FROM leave_requests r WHERE r.id=NEW.request_id AND r.employee_id=NEW.actor_id)
BEGIN SELECT RAISE(ABORT,'leave self approval is forbidden'); END;
