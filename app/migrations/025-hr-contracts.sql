-- سياسات الموارد البشرية المعتمدة من مدير الموارد البشرية (DEC16)، وعقود الموظفين وبنود رواتبهم.
CREATE TABLE hr_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('pay_components','working_time','payroll_cycle','end_of_service')),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  body TEXT NOT NULL CHECK(length(trim(body))>=20),
  parameters TEXT NOT NULL CHECK(json_valid(parameters)),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  effective_from TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','accepted','rejected')),
  prepared_by TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='draft')=(decided_by IS NULL))
) STRICT;
CREATE TRIGGER hr_policies_fixed BEFORE UPDATE ON hr_policies
WHEN OLD.status<>'draft' OR NEW.kind<>OLD.kind OR NEW.title<>OLD.title OR NEW.body<>OLD.body OR NEW.parameters<>OLD.parameters OR NEW.basis<>OLD.basis OR NEW.effective_from<>OLD.effective_from OR NEW.prepared_by<>OLD.prepared_by
BEGIN SELECT RAISE(ABORT,'a decided policy is replaced by a new dated policy'); END;
CREATE TRIGGER hr_policies_no_delete BEFORE DELETE ON hr_policies BEGIN SELECT RAISE(ABORT,'policies are retained'); END;

CREATE TABLE employment_contracts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  supersedes_id TEXT REFERENCES employment_contracts(id),
  policy_id TEXT NOT NULL REFERENCES hr_policies(id),
  contract_type TEXT NOT NULL CHECK(contract_type IN ('indefinite','fixed_term')),
  job_title TEXT NOT NULL,
  work_location TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  weekly_hours INTEGER NOT NULL CHECK(weekly_hours BETWEEN 1 AND 48),
  probation_days INTEGER NOT NULL CHECK(probation_days BETWEEN 0 AND 180),
  notice_days INTEGER NOT NULL CHECK(notice_days BETWEEN 0 AND 180),
  pay_lines TEXT NOT NULL CHECK(json_valid(pay_lines)),
  monthly_total_minor INTEGER NOT NULL CHECK(monthly_total_minor>0),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  document_reference TEXT NOT NULL CHECK(length(trim(document_reference))>=3),
  change_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','pending','active','ended','rejected')),
  ended_on TEXT,
  end_reason TEXT NOT NULL DEFAULT '',
  prepared_by TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((contract_type='fixed_term')=(end_date IS NOT NULL)),
  CHECK(end_date IS NULL OR end_date>start_date),
  CHECK(decided_by IS NULL OR (decided_by<>prepared_by AND decided_by<>user_id)),
  CHECK(prepared_by<>user_id),
  CHECK(supersedes_id IS NULL OR length(trim(change_reason))>=10),
  CHECK((status='ended')=(ended_on IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX employment_contracts_one_active ON employment_contracts(user_id) WHERE status='active';
CREATE UNIQUE INDEX employment_contracts_one_open ON employment_contracts(user_id) WHERE status IN ('draft','pending');
-- ما اعتُمد لا يُعدل: تعديل الراتب أو المسمى عقد جديد يحل محل السابق بسبب وتاريخ.
CREATE TRIGGER employment_contracts_fixed BEFORE UPDATE ON employment_contracts
WHEN NEW.version<>OLD.version+1 OR NEW.user_id<>OLD.user_id OR NEW.prepared_by<>OLD.prepared_by OR NEW.created_at<>OLD.created_at OR OLD.status IN ('ended','rejected')
  OR (OLD.status IN ('pending','active') AND (NEW.pay_lines<>OLD.pay_lines OR NEW.monthly_total_minor<>OLD.monthly_total_minor OR NEW.start_date<>OLD.start_date OR NEW.end_date IS NOT OLD.end_date OR NEW.job_title<>OLD.job_title OR NEW.contract_type<>OLD.contract_type OR NEW.policy_id<>OLD.policy_id OR NEW.weekly_hours<>OLD.weekly_hours))
  OR NOT ((OLD.status='draft' AND NEW.status IN ('draft','pending')) OR (OLD.status='pending' AND NEW.status IN ('draft','active','rejected')) OR (OLD.status='active' AND NEW.status='ended'))
BEGIN SELECT RAISE(ABORT,'an approved contract is replaced by a new contract, not edited'); END;
CREATE TRIGGER employment_contracts_no_delete BEFORE DELETE ON employment_contracts BEGIN SELECT RAISE(ABORT,'contracts are retained'); END;
