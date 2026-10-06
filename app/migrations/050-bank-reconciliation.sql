-- المطابقة البنكية: كشف يرفعه المحاسب ملفًا، وحركات غير قابلة للتعديل، ومطابقة يقترحها النظام ويقرّها إنسان،
-- وتسوية فترة يعدّها شخص ويعتمدها آخر. لا اتصال بأي بنك ولا مصرفية مفتوحة، ولا قيد محاسبي آلي.

-- حساب بنكي للمنشأة. يُحفظ آخر أربعة أرقام فقط للتمييز؛ لا IBAN كامل ولا بيانات دخول في المنصة.
CREATE TABLE bank_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  label TEXT NOT NULL CHECK(length(trim(label))>=3),
  bank_name TEXT NOT NULL CHECK(length(trim(bank_name))>=2),
  account_tail TEXT NOT NULL CHECK(length(account_tail)=4 AND account_tail NOT GLOB '*[^0-9]*'),
  gl_account_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,label),UNIQUE(id,tenant_id),
  FOREIGN KEY(gl_account_id,tenant_id) REFERENCES finance_accounts(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER bank_accounts_versioned BEFORE UPDATE ON bank_accounts
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.gl_account_id<>OLD.gl_account_id OR NEW.account_tail<>OLD.account_tail OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'a bank account keeps its ledger account and identity'); END;
CREATE TRIGGER bank_accounts_no_delete BEFORE DELETE ON bank_accounts BEGIN SELECT RAISE(ABORT,'bank accounts are deactivated, not deleted'); END;

-- تعيين أعمدة الكشف: كل بنك يصدّر ملفًا بشكل مختلف، فيُحفظ الشكل مرة ويُعاد استخدامه.
CREATE TABLE bank_import_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bank_account_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  delimiter TEXT NOT NULL CHECK(delimiter IN ('comma','semicolon','tab','pipe')),
  date_format TEXT NOT NULL CHECK(date_format IN ('YYYY-MM-DD','DD/MM/YYYY','DD-MM-YYYY','MM/DD/YYYY')),
  header_rows INTEGER NOT NULL CHECK(header_rows BETWEEN 0 AND 20),
  columns TEXT NOT NULL CHECK(json_valid(columns)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,bank_account_id,name),UNIQUE(id,tenant_id),
  FOREIGN KEY(bank_account_id,tenant_id) REFERENCES bank_accounts(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER bank_import_profiles_versioned BEFORE UPDATE ON bank_import_profiles
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.bank_account_id<>OLD.bank_account_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'a column profile keeps its account and owner'); END;
CREATE TRIGGER bank_import_profiles_no_delete BEFORE DELETE ON bank_import_profiles BEGIN SELECT RAISE(ABORT,'column profiles are deactivated, not deleted'); END;

-- دفعة استيراد: بصمة محتوى الملف تمنع استيراده مرتين، ونطاق التواريخ والرصيدان كما في الكشف نفسه.
CREATE TABLE bank_statement_imports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bank_account_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  file_name TEXT NOT NULL CHECK(length(trim(file_name))>=3),
  file_digest TEXT NOT NULL CHECK(length(file_digest)=64 AND file_digest NOT GLOB '*[^0-9a-f]*'),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL CHECK(period_end>=period_start),
  opening_balance_minor INTEGER NOT NULL,
  closing_balance_minor INTEGER NOT NULL,
  row_count INTEGER NOT NULL CHECK(row_count BETWEEN 1 AND 5000),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  cancelled_by TEXT REFERENCES users(id),
  cancelled_at TEXT,
  cancel_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id,file_digest),UNIQUE(id,tenant_id),
  FOREIGN KEY(bank_account_id,tenant_id) REFERENCES bank_accounts(id,tenant_id),
  FOREIGN KEY(profile_id,tenant_id) REFERENCES bank_import_profiles(id,tenant_id),
  FOREIGN KEY(imported_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='cancelled')=(cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND length(trim(cancel_reason))>=10))
) STRICT;

-- حركة بنكية مستوردة: لا تُعدَّل ولا تُحذف إطلاقًا. التصحيح بإلغاء الدفعة كاملة قبل اعتماد أي مطابقة عليها.
CREATE TABLE bank_transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  import_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  line_no INTEGER NOT NULL CHECK(line_no BETWEEN 1 AND 5000),
  txn_date TEXT NOT NULL,
  description TEXT NOT NULL CHECK(length(trim(description))>=1),
  reference TEXT NOT NULL DEFAULT '',
  debit_minor INTEGER NOT NULL CHECK(debit_minor BETWEEN 0 AND 1000000000000),
  credit_minor INTEGER NOT NULL CHECK(credit_minor BETWEEN 0 AND 1000000000000),
  balance_minor INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(import_id,line_no),UNIQUE(id,tenant_id),
  FOREIGN KEY(import_id,tenant_id) REFERENCES bank_statement_imports(id,tenant_id),
  FOREIGN KEY(bank_account_id,tenant_id) REFERENCES bank_accounts(id,tenant_id),
  CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0))
) STRICT;
CREATE INDEX bank_transactions_scope ON bank_transactions(tenant_id,bank_account_id,txn_date);
CREATE TRIGGER bank_transactions_immutable BEFORE UPDATE ON bank_transactions
BEGIN SELECT RAISE(ABORT,'an imported bank line is never edited; cancel the whole batch'); END;
CREATE TRIGGER bank_transactions_no_delete BEFORE DELETE ON bank_transactions
BEGIN SELECT RAISE(ABORT,'imported bank lines are retained even when their batch is cancelled'); END;

-- مطابقة حركة بنكية: إما بسجل في المنصة، أو تصنيف لحركة بلا سجل مقابل. من يقترح لا يقرر.
CREATE TABLE bank_matches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  transaction_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('record','unmatched')),
  source_kind TEXT CHECK(source_kind IS NULL OR source_kind IN ('supplier_payment','ar_receipt','payroll_payment','expense_reimbursement','custody_issue','custody_return')),
  source_id TEXT,
  unmatched_reason TEXT CHECK(unmatched_reason IS NULL OR unmatched_reason IN ('bank_fee','interest','account_transfer','unknown')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  rationale TEXT NOT NULL CHECK(length(trim(rationale))>=10),
  suggested_score INTEGER NOT NULL DEFAULT 0 CHECK(suggested_score BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected')),
  prepared_by TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(transaction_id,tenant_id) REFERENCES bank_transactions(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((kind='record')=(source_kind IS NOT NULL AND source_id IS NOT NULL)),
  CHECK((kind='unmatched')=(unmatched_reason IS NOT NULL)),
  -- من يُعِدّ المطابقة لا يعتمدها، ولا يرفضها.
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='proposed')=(decided_by IS NULL AND decided_at IS NULL))
) STRICT;
-- حركة واحدة لا تحمل مطابقتين قائمتين، وسجل واحد في المنصة لا يُطابَق بحركتين.
CREATE UNIQUE INDEX bank_match_live ON bank_matches(transaction_id) WHERE status<>'rejected';
CREATE UNIQUE INDEX bank_match_record_live ON bank_matches(tenant_id,source_kind,source_id) WHERE kind='record' AND status<>'rejected';
CREATE TRIGGER bank_match_live_batch BEFORE INSERT ON bank_matches
WHEN NOT EXISTS(SELECT 1 FROM bank_transactions t JOIN bank_statement_imports i ON i.id=t.import_id WHERE t.id=NEW.transaction_id AND t.tenant_id=NEW.tenant_id AND i.status='active' AND NEW.amount_minor=t.debit_minor+t.credit_minor)
BEGIN SELECT RAISE(ABORT,'a match needs a live batch and carries the amount of its bank line'); END;
CREATE TRIGGER bank_match_decided_once BEFORE UPDATE ON bank_matches
WHEN OLD.status<>'proposed' OR NEW.status NOT IN ('approved','rejected') OR NEW.decided_by IS NULL
 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.transaction_id<>OLD.transaction_id OR NEW.kind<>OLD.kind
 OR NEW.source_kind IS NOT OLD.source_kind OR NEW.source_id IS NOT OLD.source_id OR NEW.unmatched_reason IS NOT OLD.unmatched_reason
 OR NEW.amount_minor<>OLD.amount_minor OR NEW.rationale<>OLD.rationale OR NEW.prepared_by<>OLD.prepared_by OR NEW.prepared_at<>OLD.prepared_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'a bank match is decided once, by someone other than its preparer, and never rewritten'); END;
CREATE TRIGGER bank_matches_no_delete BEFORE DELETE ON bank_matches BEGIN SELECT RAISE(ABORT,'match decisions are retained'); END;

-- إلغاء الدفعة: بعد اعتماد أي مطابقة عليها يصبح التصحيح بدفعة لاحقة لا بإلغاء ما بُني عليه قرار.
CREATE TRIGGER bank_import_cancel_only BEFORE UPDATE ON bank_statement_imports
WHEN NOT (OLD.status='active' AND NEW.status='cancelled')
 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.bank_account_id<>OLD.bank_account_id OR NEW.profile_id<>OLD.profile_id
 OR NEW.file_digest<>OLD.file_digest OR NEW.file_name<>OLD.file_name OR NEW.period_start<>OLD.period_start OR NEW.period_end<>OLD.period_end
 OR NEW.opening_balance_minor<>OLD.opening_balance_minor OR NEW.closing_balance_minor<>OLD.closing_balance_minor OR NEW.row_count<>OLD.row_count
 OR NEW.imported_by<>OLD.imported_by OR NEW.imported_at<>OLD.imported_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'a statement batch is only cancelled, never edited'); END;
CREATE TRIGGER bank_import_cancel_guard BEFORE UPDATE ON bank_statement_imports
WHEN NEW.status='cancelled' AND EXISTS(SELECT 1 FROM bank_matches m JOIN bank_transactions t ON t.id=m.transaction_id WHERE t.import_id=OLD.id AND m.status='approved')
BEGIN SELECT RAISE(ABORT,'a batch with an approved match cannot be cancelled'); END;
CREATE TRIGGER bank_statement_imports_no_delete BEFORE DELETE ON bank_statement_imports BEGIN SELECT RAISE(ABORT,'statement batches are retained'); END;

-- قاعدة مطابقة: نمط في وصف الحركة يقترح حسابًا أو مشروعًا. تقترح فقط ولا تُرحّل ولا تُنشئ قيدًا.
CREATE TABLE bank_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  pattern TEXT NOT NULL CHECK(length(trim(pattern))>=3),
  suggested_account_id TEXT,
  suggested_project_id TEXT,
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  owner_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,pattern),
  FOREIGN KEY(suggested_account_id,tenant_id) REFERENCES finance_accounts(id,tenant_id),
  FOREIGN KEY(suggested_project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(suggested_account_id IS NOT NULL OR suggested_project_id IS NOT NULL)
) STRICT;
CREATE TRIGGER bank_rules_versioned BEFORE UPDATE ON bank_rules
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.pattern<>OLD.pattern OR NEW.owner_id<>OLD.owner_id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'a bank rule keeps its pattern, owner and date'); END;
CREATE TRIGGER bank_rules_no_delete BEFORE DELETE ON bank_rules BEGIN SELECT RAISE(ABORT,'bank rules are deactivated, not deleted'); END;

-- تسوية الفترة: رصيد البنك الختامي − الحركات غير المطابقة + سجلات الدفتر غير الظاهرة في البنك = رصيد الدفتر المتوقع.
-- الفرق يُعرض صراحة، ولا يُحفظ فرق غير صفري بلا تفسير مكتوب. المعتمدة مقفلة، والتصحيح بتسوية لاحقة.
CREATE TABLE bank_reconciliations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bank_account_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL CHECK(period_end>=period_start),
  statement_closing_minor INTEGER NOT NULL,
  unmatched_bank_minor INTEGER NOT NULL,
  unmatched_book_minor INTEGER NOT NULL,
  expected_book_minor INTEGER NOT NULL,
  book_balance_minor INTEGER NOT NULL,
  difference_minor INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  explanation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','cancelled')),
  prepared_by TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  approval_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(bank_account_id,tenant_id) REFERENCES bank_accounts(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من يُعِدّ التسوية لا يعتمدها.
  CHECK(approved_by IS NULL OR approved_by<>prepared_by),
  CHECK((status='approved')=(approved_by IS NOT NULL AND approved_at IS NOT NULL AND length(trim(approval_note))>=3)),
  CHECK(expected_book_minor=statement_closing_minor-unmatched_bank_minor+unmatched_book_minor),
  CHECK(difference_minor=expected_book_minor-book_balance_minor),
  CHECK(difference_minor=0 OR length(trim(explanation))>=20)
) STRICT;
CREATE UNIQUE INDEX bank_reconciliation_live ON bank_reconciliations(tenant_id,bank_account_id,period_end) WHERE status<>'cancelled';
CREATE TRIGGER bank_reconciliation_locked BEFORE UPDATE ON bank_reconciliations
WHEN OLD.status<>'draft' OR NEW.status NOT IN ('approved','cancelled')
 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.bank_account_id<>OLD.bank_account_id
 OR NEW.period_start<>OLD.period_start OR NEW.period_end<>OLD.period_end
 OR NEW.statement_closing_minor<>OLD.statement_closing_minor OR NEW.unmatched_bank_minor<>OLD.unmatched_bank_minor
 OR NEW.unmatched_book_minor<>OLD.unmatched_book_minor OR NEW.expected_book_minor<>OLD.expected_book_minor
 OR NEW.book_balance_minor<>OLD.book_balance_minor OR NEW.difference_minor<>OLD.difference_minor
 OR NEW.snapshot<>OLD.snapshot OR NEW.explanation<>OLD.explanation
 OR NEW.prepared_by<>OLD.prepared_by OR NEW.prepared_at<>OLD.prepared_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'an approved reconciliation is locked; correct it with a later one'); END;
CREATE TRIGGER bank_reconciliations_no_delete BEFORE DELETE ON bank_reconciliations BEGIN SELECT RAISE(ABORT,'reconciliations are retained'); END;
