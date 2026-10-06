CREATE TABLE finance_grants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  granted_role TEXT NOT NULL CHECK(granted_role IN ('employee','manager','pm')),
  action TEXT NOT NULL CHECK(action IN ('read','configure','prepare','approve','post','reverse','source_procurement')),
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL CHECK(valid_until>valid_from),
  granted_by TEXT NOT NULL,
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=3),
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(granted_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(user_id<>granted_by)
) STRICT;
CREATE INDEX finance_grant_lookup ON finance_grants(tenant_id,user_id,action,valid_until);
CREATE TRIGGER finance_grant_identity BEFORE UPDATE ON finance_grants
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.user_id<>OLD.user_id OR NEW.granted_role<>OLD.granted_role OR NEW.action<>OLD.action OR NEW.valid_from<>OLD.valid_from OR NEW.valid_until<>OLD.valid_until OR NEW.granted_by<>OLD.granted_by OR NEW.evidence<>OLD.evidence OR NEW.created_at<>OLD.created_at OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
BEGIN SELECT RAISE(ABORT,'financial grant can only be revoked'); END;
CREATE TRIGGER finance_grant_no_delete BEFORE DELETE ON finance_grants BEGIN SELECT RAISE(ABORT,'financial grants retain history'); END;

CREATE TABLE finance_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK(account_type IN ('asset','liability','equity','income','expense')),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),UNIQUE(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE finance_cost_centers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),UNIQUE(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE finance_periods (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL CHECK(ends_on>=starts_on),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  version INTEGER NOT NULL DEFAULT 1,
  closed_by TEXT REFERENCES users(id),
  close_evidence TEXT,
  closed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER finance_period_overlap BEFORE INSERT ON finance_periods
WHEN EXISTS(SELECT 1 FROM finance_periods WHERE tenant_id=NEW.tenant_id AND starts_on<=NEW.ends_on AND ends_on>=NEW.starts_on)
BEGIN SELECT RAISE(ABORT,'financial periods cannot overlap'); END;
CREATE TRIGGER finance_account_identity BEFORE UPDATE ON finance_accounts
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code OR NEW.name<>OLD.name OR NEW.account_type<>OLD.account_type OR NEW.currency<>OLD.currency OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR NEW.active=OLD.active
BEGIN SELECT RAISE(ABORT,'account definition is immutable'); END;
CREATE TRIGGER finance_center_identity BEFORE UPDATE ON finance_cost_centers
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code OR NEW.name<>OLD.name OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR NEW.active=OLD.active
BEGIN SELECT RAISE(ABORT,'cost center definition is immutable'); END;
CREATE TRIGGER finance_period_identity BEFORE UPDATE ON finance_periods
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.name<>OLD.name OR NEW.starts_on<>OLD.starts_on OR NEW.ends_on<>OLD.ends_on OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR OLD.status<>'open' OR NEW.status<>'closed' OR NEW.closed_by IS NULL OR NEW.closed_at IS NULL OR length(trim(COALESCE(NEW.close_evidence,'')))<3
BEGIN SELECT RAISE(ABORT,'financial period can only be closed with evidence'); END;
CREATE TRIGGER finance_accounts_no_delete BEFORE DELETE ON finance_accounts BEGIN SELECT RAISE(ABORT,'accounts retain history'); END;
CREATE TRIGGER finance_centers_no_delete BEFORE DELETE ON finance_cost_centers BEGIN SELECT RAISE(ABORT,'cost centers retain history'); END;
CREATE TRIGGER finance_periods_no_delete BEFORE DELETE ON finance_periods BEGIN SELECT RAISE(ABORT,'periods retain history'); END;

CREATE TABLE finance_journals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency='SAR'),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('manual','procurement_payable','reversal')),
  source_id TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  prepared_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','posted','rejected')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),UNIQUE(tenant_id,source_kind,source_id),
  FOREIGN KEY(period_id,tenant_id) REFERENCES finance_periods(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE finance_lines (
  journal_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 50),
  account_id TEXT NOT NULL,
  cost_center_id TEXT NOT NULL,
  debit_minor INTEGER NOT NULL CHECK(debit_minor BETWEEN 0 AND 1000000000000),
  credit_minor INTEGER NOT NULL CHECK(credit_minor BETWEEN 0 AND 1000000000000),
  memo TEXT NOT NULL,
  PRIMARY KEY(journal_id,position),
  FOREIGN KEY(journal_id,tenant_id) REFERENCES finance_journals(id,tenant_id),
  FOREIGN KEY(account_id,tenant_id) REFERENCES finance_accounts(id,tenant_id),
  FOREIGN KEY(cost_center_id,tenant_id) REFERENCES finance_cost_centers(id,tenant_id),
  CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0))
) STRICT;
CREATE TABLE finance_decisions (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL REFERENCES finance_journals(id),
  revision INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','returned','rejected')),
  actor_id TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  journal_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(journal_id,revision)
) STRICT;
CREATE TABLE finance_postings (
  journal_id TEXT PRIMARY KEY REFERENCES finance_journals(id),
  posted_by TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  journal_version INTEGER NOT NULL,
  posted_at TEXT NOT NULL
) STRICT;
CREATE TABLE finance_reversals (
  original_journal_id TEXT PRIMARY KEY REFERENCES finance_postings(journal_id),
  reversal_journal_id TEXT NOT NULL UNIQUE REFERENCES finance_journals(id),
  requested_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(original_journal_id<>reversal_journal_id)
) STRICT;
CREATE TABLE finance_payable_links (
  payable_id TEXT PRIMARY KEY REFERENCES procurement_payables(id),
  journal_id TEXT NOT NULL UNIQUE REFERENCES finance_journals(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),
  currency TEXT NOT NULL CHECK(currency='SAR'),
  linked_by TEXT NOT NULL REFERENCES users(id),
  evidence TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE finance_versions (
  journal_id TEXT NOT NULL REFERENCES finance_journals(id),
  version INTEGER NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(journal_id,version)
) STRICT;
CREATE INDEX finance_journal_scope ON finance_journals(tenant_id,status,entry_date);
CREATE TRIGGER finance_journal_initial BEFORE INSERT ON finance_journals
WHEN NEW.status<>'draft' OR NEW.version<>1 OR NEW.revision<>0
BEGIN SELECT RAISE(ABORT,'journal must start as draft version one'); END;
CREATE TRIGGER finance_journal_identity BEFORE UPDATE ON finance_journals
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.prepared_by<>OLD.prepared_by OR NEW.source_kind<>OLD.source_kind OR NEW.source_id<>OLD.source_id OR NEW.created_at<>OLD.created_at OR NEW.currency<>OLD.currency OR NEW.version<>OLD.version+1 OR OLD.status IN ('posted','rejected')
BEGIN SELECT RAISE(ABORT,'journal identity or posted version is immutable'); END;
CREATE TRIGGER finance_journal_fields BEFORE UPDATE ON finance_journals
WHEN OLD.status<>'draft' AND (NEW.period_id<>OLD.period_id OR NEW.entry_date<>OLD.entry_date OR NEW.description<>OLD.description OR NEW.evidence<>OLD.evidence OR NEW.source_reference<>OLD.source_reference)
BEGIN SELECT RAISE(ABORT,'submitted journal values are immutable'); END;
CREATE TRIGGER finance_journal_state BEFORE UPDATE ON finance_journals
WHEN NOT ((OLD.status='draft' AND NEW.status IN ('draft','pending')) OR (OLD.status='pending' AND NEW.status IN ('draft','approved','rejected')) OR (OLD.status='approved' AND NEW.status='posted'))
 OR NEW.revision<>OLD.revision+CASE WHEN OLD.status='draft' AND NEW.status='pending' THEN 1 ELSE 0 END
BEGIN SELECT RAISE(ABORT,'journal state cannot skip approval'); END;
CREATE TRIGGER finance_lines_insert BEFORE INSERT ON finance_lines
WHEN NOT EXISTS(SELECT 1 FROM finance_journals WHERE id=NEW.journal_id AND status='draft')
BEGIN SELECT RAISE(ABORT,'lines require an editable draft'); END;
CREATE TRIGGER finance_lines_update BEFORE UPDATE ON finance_lines BEGIN SELECT RAISE(ABORT,'replace draft lines as a set'); END;
CREATE TRIGGER finance_lines_delete BEFORE DELETE ON finance_lines
WHEN NOT EXISTS(SELECT 1 FROM finance_journals WHERE id=OLD.journal_id AND status='draft')
BEGIN SELECT RAISE(ABORT,'submitted lines are immutable'); END;
CREATE TRIGGER finance_balance_guard BEFORE UPDATE ON finance_journals
WHEN NEW.status IN ('pending','approved','posted') AND ((SELECT COUNT(*) FROM finance_lines WHERE journal_id=NEW.id)<2
 OR (SELECT COALESCE(SUM(debit_minor),0) FROM finance_lines WHERE journal_id=NEW.id)<>(SELECT COALESCE(SUM(credit_minor),0) FROM finance_lines WHERE journal_id=NEW.id)
 OR (SELECT COALESCE(SUM(debit_minor),0) FROM finance_lines WHERE journal_id=NEW.id)>1000000000000)
BEGIN SELECT RAISE(ABORT,'journal is not balanced'); END;
CREATE TRIGGER finance_valid_period BEFORE UPDATE ON finance_journals
WHEN NEW.status IN ('pending','approved','posted') AND (NOT EXISTS(SELECT 1 FROM finance_periods p WHERE p.id=NEW.period_id AND p.tenant_id=NEW.tenant_id AND p.status='open' AND NEW.entry_date BETWEEN p.starts_on AND p.ends_on)
 OR EXISTS(SELECT 1 FROM finance_lines l JOIN finance_accounts a ON a.id=l.account_id JOIN finance_cost_centers c ON c.id=l.cost_center_id WHERE l.journal_id=NEW.id AND (a.active<>1 OR c.active<>1 OR a.currency<>NEW.currency)))
BEGIN SELECT RAISE(ABORT,'journal requires open period and active accounts'); END;
CREATE TRIGGER finance_decision_guard BEFORE INSERT ON finance_decisions
WHEN NOT EXISTS(SELECT 1 FROM finance_journals j WHERE j.id=NEW.journal_id AND j.status='pending' AND j.revision=NEW.revision AND j.prepared_by<>NEW.actor_id AND NEW.journal_version=j.version+1)
BEGIN SELECT RAISE(ABORT,'journal decision must be independent and current'); END;
CREATE TRIGGER finance_approval_guard BEFORE UPDATE ON finance_journals
WHEN OLD.status='pending' AND NOT EXISTS(SELECT 1 FROM finance_decisions d WHERE d.journal_id=NEW.id AND d.revision=NEW.revision AND d.journal_version=NEW.version AND d.decision=CASE NEW.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'returned' END)
BEGIN SELECT RAISE(ABORT,'journal transition requires a recorded decision'); END;
CREATE TRIGGER finance_posting_guard BEFORE INSERT ON finance_postings
WHEN NOT EXISTS(SELECT 1 FROM finance_journals j JOIN finance_decisions d ON d.journal_id=j.id AND d.revision=j.revision WHERE j.id=NEW.journal_id AND j.status='approved' AND d.decision='approved' AND j.prepared_by<>NEW.posted_by AND NEW.journal_version=j.version+1)
BEGIN SELECT RAISE(ABORT,'posting requires independent approval'); END;
CREATE TRIGGER finance_posted_state BEFORE UPDATE ON finance_journals
WHEN NEW.status='posted' AND NOT EXISTS(SELECT 1 FROM finance_postings WHERE journal_id=NEW.id AND journal_version=NEW.version)
BEGIN SELECT RAISE(ABORT,'posted state requires a posting record'); END;
CREATE TRIGGER finance_reversal_guard BEFORE INSERT ON finance_reversals
WHEN NOT EXISTS(SELECT 1 FROM finance_journals o JOIN finance_journals r ON r.tenant_id=o.tenant_id WHERE o.id=NEW.original_journal_id AND o.status='posted' AND r.id=NEW.reversal_journal_id AND r.status='draft' AND r.source_kind='reversal' AND r.source_id=o.id AND r.prepared_by=NEW.requested_by AND o.prepared_by<>NEW.requested_by)
BEGIN SELECT RAISE(ABORT,'reversal requires a posted source and another preparer'); END;
CREATE TRIGGER finance_payable_guard BEFORE INSERT ON finance_payable_links
WHEN NOT EXISTS(SELECT 1 FROM procurement_payables p JOIN procurement_invoices i ON i.id=p.invoice_id JOIN finance_journals j ON j.tenant_id=i.tenant_id WHERE p.id=NEW.payable_id AND j.id=NEW.journal_id AND j.source_kind='procurement_payable' AND j.source_id=p.id AND j.status='draft' AND p.amount_minor=NEW.amount_minor AND p.currency=NEW.currency)
BEGIN SELECT RAISE(ABORT,'payable link must match its approved source'); END;
CREATE TRIGGER finance_journals_no_delete BEFORE DELETE ON finance_journals BEGIN SELECT RAISE(ABORT,'journal history is immutable'); END;
CREATE TRIGGER finance_decisions_no_update BEFORE UPDATE ON finance_decisions BEGIN SELECT RAISE(ABORT,'financial decision is immutable'); END;
CREATE TRIGGER finance_decisions_no_delete BEFORE DELETE ON finance_decisions BEGIN SELECT RAISE(ABORT,'financial decision is immutable'); END;
CREATE TRIGGER finance_postings_no_update BEFORE UPDATE ON finance_postings BEGIN SELECT RAISE(ABORT,'posting is immutable'); END;
CREATE TRIGGER finance_postings_no_delete BEFORE DELETE ON finance_postings BEGIN SELECT RAISE(ABORT,'posting is immutable'); END;
CREATE TRIGGER finance_reversals_no_update BEFORE UPDATE ON finance_reversals BEGIN SELECT RAISE(ABORT,'reversal link is immutable'); END;
CREATE TRIGGER finance_reversals_no_delete BEFORE DELETE ON finance_reversals BEGIN SELECT RAISE(ABORT,'reversal link is immutable'); END;
CREATE TRIGGER finance_payable_links_no_update BEFORE UPDATE ON finance_payable_links BEGIN SELECT RAISE(ABORT,'payable link is immutable'); END;
CREATE TRIGGER finance_payable_links_no_delete BEFORE DELETE ON finance_payable_links BEGIN SELECT RAISE(ABORT,'payable link is immutable'); END;
CREATE TRIGGER finance_versions_no_update BEFORE UPDATE ON finance_versions BEGIN SELECT RAISE(ABORT,'financial version is immutable'); END;
CREATE TRIGGER finance_versions_no_delete BEFORE DELETE ON finance_versions BEGIN SELECT RAISE(ABORT,'financial version is immutable'); END;
