-- ترحيل 168 — المطابقة البنكية المجمّعة والمجزّأة، وفتح الفترة المحاسبية المضبوط، واستثناءات الإقفال (الحزمة 3).
--
-- ما كان قبل هذا الترحيل، مقيسًا بمسبار على 3d1d84c لا مستنتجًا (docs/testing/p3-bank-close-probe-20260930.txt):
--   • المطابقة سطرٌ بسجل بالمبلغ نفسه لا غير: تحويلٌ مجمّع لأمري دفع، أو قبضٌ وصل على دفعتين، لا يُطابَق أبدًا؛
--     وقيدٌ يدوي على حساب البنك في الدفتر لا يُطابَق؛ وbank_matches.source_kind يقبل ستة أنواع فقط.
--   • الفترة المحاسبية لا تنفتح بعد إقفالها: finance_period_identity (007) لا يسمح بغير open→closed، وفتح قائمة
--     الإقفال يعيد الشهر مفتوحًا والقيود مقفلة، فقيد تسوية بتاريخ داخل الشهر مستحيل.
--   • close_period_versioned يمنع نزول ledger_locked مطلقًا، فلا يصدق العلم لو انفتح الدفتر.
--
-- ما يضيفه:
--   (1) bank_matches يُعاد بناؤه بستة أنواع + ثلاثة (قبض الدفعة المقدمة، وارتدادها، ومرتجع دفعة المورد)، وبشكل
--       المطابقة (single: سطر بسجل · group: سطر واحد بسجلات · split: سطور بسجل واحد). الصفوف القائمة تُنقل كما هي.
--   (2) bank_match_items — أعضاء المطابقة: كل سطر كشف بمبلغه كاملًا، وكل سجل منصة أو قيد يدوي مرحّل بمبلغه.
--       الحيّ منها فريد (السطر والسجل لا يدخلان مطابقتين قائمتين، والقيد اليدوي مرة في كل حساب بنكي يمسّه)،
--       والمعتمدة تتوازن بالهللة.
--   (3) finance_period_reopenings — طلب فتح فترة محاسبية مقفلة: نسخة الإقفال التي يفتحها، ومن أقفلها ومتى وبأي دليل،
--       ومن طلب ولماذا، ومن قرّر (شخص ثالث: لا من أقفل ولا من طلب)، وموعد إعادة الإقفال، ومن أعاد الإقفال.
--   (4) finance_period_identity يُستبدل: open→closed كما كان ما لم يكن للفترة فتحٌ معتمد لم يُعَد إقفاله، وclosed→open
--       لا يقع إلا بفتح معتمد لنسخة الإقفال نفسها.
--   (5) close_period_versioned يُستبدل: ledger_locked ينزل فقط والفترة المحاسبية المربوطة منفتحة فعلًا بفتح معتمد.
--   (6) close_explanations — تفسير مكتوب لفرق حساب رقابي في آخر الشهر، على إقفالٍ بعينه وبمبلغ الفرق نفسه.
--       من يفسّر لا يعتمد الإقفال، كما لا يعتمده من نفّذ مهمة فيه.
--
-- الصفوف القائمة: bank_matches ينتقل بأعمدته وقيمه، ولكل مطابقة سطرها وسجلها بندين في bank_match_items بحالتها
-- (المرفوضة غير حيّة). لا صفّ في finance_periods ولا close_periods يتغير.

/* (1) إعادة بناء bank_matches */
DROP TRIGGER bank_match_live_batch;
DROP TRIGGER bank_match_decided_once;
DROP TRIGGER bank_matches_no_delete;
DROP TRIGGER bank_import_cancel_guard;
DROP INDEX bank_match_live;
DROP INDEX bank_match_record_live;
DROP INDEX bank_matches_source;
ALTER TABLE bank_matches RENAME TO bank_matches_v2;
CREATE TABLE bank_matches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  transaction_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('record','unmatched')),
  shape TEXT NOT NULL DEFAULT 'single' CHECK(shape IN ('single','group','split')),
  source_kind TEXT CHECK(source_kind IS NULL OR source_kind IN ('supplier_payment','ar_receipt','payroll_payment','expense_reimbursement','custody_issue','custody_return','advance_receipt','advance_reversal','supplier_payment_return')),
  source_id TEXT,
  unmatched_reason TEXT CHECK(unmatched_reason IS NULL OR unmatched_reason IN ('bank_fee','interest','account_transfer','unknown')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0 AND amount_minor<=1000000000000),
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
  -- رأس المطابقة يحمل سجلها حين يكون سجلًّا واحدًا (single وsplit)؛ group وقيد يدوي بلا سجل في الرأس، وأعضاؤها في البنود.
  CHECK((source_kind IS NULL)=(source_id IS NULL)),
  CHECK(kind='record' OR (source_kind IS NULL AND shape='single')),
  CHECK((kind='unmatched')=(unmatched_reason IS NOT NULL)),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='proposed')=(decided_by IS NULL AND decided_at IS NULL))
) STRICT;
INSERT INTO bank_matches(id,tenant_id,transaction_id,kind,shape,source_kind,source_id,unmatched_reason,amount_minor,rationale,suggested_score,status,prepared_by,prepared_at,decided_by,decided_at,decision_note,version)
  SELECT id,tenant_id,transaction_id,kind,'single',source_kind,source_id,unmatched_reason,amount_minor,rationale,suggested_score,status,prepared_by,prepared_at,decided_by,decided_at,decision_note,version FROM bank_matches_v2;
DROP TABLE bank_matches_v2;
CREATE UNIQUE INDEX bank_match_live ON bank_matches(transaction_id) WHERE status<>'rejected';
CREATE UNIQUE INDEX bank_match_record_live ON bank_matches(tenant_id,source_kind,source_id) WHERE kind='record' AND status<>'rejected';
CREATE INDEX bank_matches_source ON bank_matches(tenant_id,source_kind,source_id);

/* (2) أعضاء المطابقة */
CREATE TABLE bank_match_items (
  match_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  -- حساب المطابقة: قيدُ تحويل بين حسابين للمنشأة يمسّ الاثنين، فيُطابَق مرة في كشف كل حساب منهما لا مرة واحدة.
  bank_account_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 200),
  side TEXT NOT NULL CHECK(side IN ('line','record','journal')),
  transaction_id TEXT,
  source_kind TEXT CHECK(source_kind IS NULL OR source_kind IN ('supplier_payment','ar_receipt','payroll_payment','expense_reimbursement','custody_issue','custody_return','advance_receipt','advance_reversal','supplier_payment_return')),
  source_id TEXT,
  journal_id TEXT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0 AND amount_minor<=1000000000000),
  live INTEGER NOT NULL DEFAULT 1 CHECK(live IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(match_id,position),
  FOREIGN KEY(match_id,tenant_id) REFERENCES bank_matches(id,tenant_id),
  FOREIGN KEY(bank_account_id,tenant_id) REFERENCES bank_accounts(id,tenant_id),
  FOREIGN KEY(transaction_id,tenant_id) REFERENCES bank_transactions(id,tenant_id),
  FOREIGN KEY(journal_id,tenant_id) REFERENCES finance_journals(id,tenant_id),
  CHECK((side='line')=(transaction_id IS NOT NULL)),
  CHECK((side='record')=(source_kind IS NOT NULL AND source_id IS NOT NULL)),
  CHECK((side='journal')=(journal_id IS NOT NULL)),
  CHECK((source_kind IS NULL)=(source_id IS NULL))
) STRICT;
-- الصفوف القائمة: السطر بندٌ أول، وسجلّ المطابقة بندٌ ثانٍ، بالمبلغ نفسه (المطابقة القائمة واحد بواحد بالمبلغ نفسه).
INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,transaction_id,amount_minor,live,created_at)
  SELECT m.id,m.tenant_id,t.bank_account_id,1,'line',m.transaction_id,m.amount_minor,CASE WHEN m.status='rejected' THEN 0 ELSE 1 END,m.prepared_at FROM bank_matches m JOIN bank_transactions t ON t.id=m.transaction_id;
INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,source_kind,source_id,amount_minor,live,created_at)
  SELECT m.id,m.tenant_id,t.bank_account_id,2,'record',m.source_kind,m.source_id,m.amount_minor,CASE WHEN m.status='rejected' THEN 0 ELSE 1 END,m.prepared_at FROM bank_matches m JOIN bank_transactions t ON t.id=m.transaction_id WHERE m.kind='record';
-- سطر الكشف وسجل المنصة والقيد اليدوي لا يدخل أيٌّ منها مطابقتين قائمتين.
CREATE UNIQUE INDEX bank_match_item_line_live ON bank_match_items(transaction_id) WHERE side='line' AND live=1;
CREATE UNIQUE INDEX bank_match_item_record_live ON bank_match_items(tenant_id,source_kind,source_id) WHERE side='record' AND live=1;
CREATE UNIQUE INDEX bank_match_item_journal_live ON bank_match_items(journal_id,bank_account_id) WHERE side='journal' AND live=1;
CREATE INDEX bank_match_items_record ON bank_match_items(tenant_id,source_kind,source_id);

-- الرأس: سطره الأول في دفعة سارية، والمطابقة الواحدة بالسطر الواحد (single وgroup) تحمل مبلغ سطرها كاملًا.
CREATE TRIGGER bank_match_live_batch BEFORE INSERT ON bank_matches
WHEN NOT EXISTS(SELECT 1 FROM bank_transactions t JOIN bank_statement_imports i ON i.id=t.import_id
  WHERE t.id=NEW.transaction_id AND t.tenant_id=NEW.tenant_id AND i.status='active'
    AND ((NEW.shape IN ('single','group') AND NEW.amount_minor=t.debit_minor+t.credit_minor) OR (NEW.shape='split' AND NEW.amount_minor>t.debit_minor+t.credit_minor)))
 OR NEW.status<>'proposed' OR NEW.version<>1
BEGIN SELECT RAISE(ABORT,'a match needs a live batch and carries the amount of its bank line'); END;
CREATE TRIGGER bank_match_decided_once BEFORE UPDATE ON bank_matches
WHEN OLD.status<>'proposed' OR NEW.status NOT IN ('approved','rejected') OR NEW.decided_by IS NULL
 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.transaction_id<>OLD.transaction_id OR NEW.kind<>OLD.kind OR NEW.shape<>OLD.shape
 OR NEW.source_kind IS NOT OLD.source_kind OR NEW.source_id IS NOT OLD.source_id OR NEW.unmatched_reason IS NOT OLD.unmatched_reason
 OR NEW.amount_minor<>OLD.amount_minor OR NEW.rationale<>OLD.rationale OR NEW.prepared_by<>OLD.prepared_by OR NEW.prepared_at<>OLD.prepared_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'a bank match is decided once, by someone other than its preparer, and never rewritten'); END;
-- الاعتماد على مطابقة متوازنة بالهللة: مجموع سطور الكشف = مبلغ الرأس = مجموع السجلات والقيود، وشكلها يطابق عدد أعضائها.
CREATE TRIGGER bank_match_exact_sum BEFORE UPDATE ON bank_matches
WHEN NEW.status='approved' AND (
  (SELECT COALESCE(SUM(amount_minor),0) FROM bank_match_items WHERE match_id=OLD.id AND side='line')<>OLD.amount_minor
  OR NOT EXISTS(SELECT 1 FROM bank_match_items WHERE match_id=OLD.id AND side='line' AND transaction_id=OLD.transaction_id)
  OR (OLD.kind='record' AND (SELECT COALESCE(SUM(amount_minor),0) FROM bank_match_items WHERE match_id=OLD.id AND side<>'line')<>OLD.amount_minor)
  OR (OLD.kind='unmatched' AND ((SELECT COUNT(*) FROM bank_match_items WHERE match_id=OLD.id)<>1))
  OR (OLD.kind='record' AND OLD.shape='single' AND ((SELECT COUNT(*) FROM bank_match_items WHERE match_id=OLD.id AND side='line')<>1 OR (SELECT COUNT(*) FROM bank_match_items WHERE match_id=OLD.id AND side<>'line')<>1))
  OR (OLD.shape='group' AND ((SELECT COUNT(*) FROM bank_match_items WHERE match_id=OLD.id AND side='line')<>1 OR (SELECT COUNT(*) FROM bank_match_items WHERE match_id=OLD.id AND side<>'line')<2))
  OR (OLD.shape='split' AND ((SELECT COUNT(*) FROM bank_match_items WHERE match_id=OLD.id AND side='line')<2 OR (SELECT COUNT(*) FROM bank_match_items WHERE match_id=OLD.id AND side<>'line')<>1)))
BEGIN SELECT RAISE(ABORT,'an approved match balances to the halala: its bank lines and its records carry the same sum'); END;
CREATE TRIGGER bank_matches_no_delete BEFORE DELETE ON bank_matches BEGIN SELECT RAISE(ABORT,'match decisions are retained'); END;
CREATE TRIGGER bank_import_cancel_guard BEFORE UPDATE ON bank_statement_imports
WHEN NEW.status='cancelled' AND EXISTS(SELECT 1 FROM bank_match_items b JOIN bank_transactions t ON t.id=b.transaction_id JOIN bank_matches m ON m.id=b.match_id WHERE t.import_id=OLD.id AND b.side='line' AND m.status='approved')
BEGIN SELECT RAISE(ABORT,'a batch with an approved match cannot be cancelled'); END;

-- البند: سطر كشف حيّ بمبلغه كاملًا، أو قيد مرحّل، تحت مطابقة مقترحة وعلى حساب سطرها الأول نفسه. لا بند يُضاف بعد القرار.
CREATE TRIGGER bank_match_items_insert BEFORE INSERT ON bank_match_items
WHEN NEW.live<>1
 OR NOT EXISTS(SELECT 1 FROM bank_matches m JOIN bank_transactions a ON a.id=m.transaction_id WHERE m.id=NEW.match_id AND m.tenant_id=NEW.tenant_id AND m.status='proposed' AND a.bank_account_id=NEW.bank_account_id)
 OR (NEW.side='line' AND NOT EXISTS(SELECT 1 FROM bank_transactions t JOIN bank_statement_imports i ON i.id=t.import_id
   WHERE t.id=NEW.transaction_id AND t.tenant_id=NEW.tenant_id AND i.status='active' AND t.debit_minor+t.credit_minor=NEW.amount_minor AND t.bank_account_id=NEW.bank_account_id))
 OR (NEW.side='journal' AND NOT EXISTS(SELECT 1 FROM finance_journals j WHERE j.id=NEW.journal_id AND j.tenant_id=NEW.tenant_id AND j.status='posted'))
BEGIN SELECT RAISE(ABORT,'a match item names a live bank line at its full amount, or a posted journal, under a proposed match'); END;
CREATE TRIGGER bank_match_items_fixed BEFORE UPDATE ON bank_match_items
WHEN NEW.match_id<>OLD.match_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.bank_account_id<>OLD.bank_account_id OR NEW.position<>OLD.position OR NEW.side<>OLD.side OR NEW.transaction_id IS NOT OLD.transaction_id
 OR NEW.source_kind IS NOT OLD.source_kind OR NEW.source_id IS NOT OLD.source_id OR NEW.journal_id IS NOT OLD.journal_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.created_at<>OLD.created_at
 OR NOT (OLD.live=1 AND NEW.live=0 AND EXISTS(SELECT 1 FROM bank_matches m WHERE m.id=OLD.match_id AND m.status='rejected'))
BEGIN SELECT RAISE(ABORT,'a match item is fixed; it only stops being live when its match is rejected'); END;
CREATE TRIGGER bank_match_items_no_delete BEFORE DELETE ON bank_match_items BEGIN SELECT RAISE(ABORT,'match items are retained'); END;
-- رفض المطابقة يحرّر أعضاءها: السطر والسجل يعودان متاحين لمطابقة جديدة، والبند يبقى شاهدًا بحالته.
CREATE TRIGGER bank_match_items_release AFTER UPDATE OF status ON bank_matches
WHEN NEW.status='rejected'
BEGIN UPDATE bank_match_items SET live=0 WHERE match_id=NEW.id AND live=1; END;

/* (3) فتح الفترة المحاسبية المقفلة */
CREATE TABLE finance_period_reopenings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_id TEXT NOT NULL,
  -- نسخة الفترة المقفلة التي يفتحها الطلب: بها يعرف القادح أن الفتح لهذا الإقفال بعينه، ولا يُستعمل مرتين.
  period_version INTEGER NOT NULL CHECK(period_version>0),
  close_reopening_id TEXT UNIQUE REFERENCES close_reopenings(id),
  previous_closed_by TEXT NOT NULL REFERENCES users(id),
  previous_closed_at TEXT NOT NULL,
  previous_close_evidence TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  reclose_days INTEGER CHECK(reclose_days IS NULL OR reclose_days BETWEEN 0 AND 365),
  reclose_due_on TEXT CHECK(reclose_due_on IS NULL OR reclose_due_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  reclosed_by TEXT REFERENCES users(id),
  reclosed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(period_id,tenant_id) REFERENCES finance_periods(id,tenant_id),
  FOREIGN KEY(requested_by,tenant_id) REFERENCES users(id,tenant_id),
  -- ثلاثة أشخاص: من أقفل لا يطلب الفتح، ومن قرّر ليس من أقفل ولا من طلب.
  CHECK(requested_by<>previous_closed_by),
  CHECK((status='pending')=(decided_by IS NULL AND decided_at IS NULL)),
  CHECK(decided_by IS NULL OR (decided_by<>requested_by AND decided_by<>previous_closed_by AND length(trim(decision_note))>=10)),
  CHECK((status='approved')=(reclose_days IS NOT NULL AND reclose_due_on IS NOT NULL)),
  CHECK((reclosed_by IS NULL)=(reclosed_at IS NULL)),
  CHECK(reclosed_at IS NULL OR status='approved')
) STRICT;
CREATE UNIQUE INDEX finance_period_reopen_one_pending ON finance_period_reopenings(period_id) WHERE status='pending';
CREATE UNIQUE INDEX finance_period_reopen_one_per_close ON finance_period_reopenings(period_id,period_version) WHERE status='approved';
CREATE INDEX finance_period_reopenings_scope ON finance_period_reopenings(tenant_id,status);
-- الطلب يسمّي نسخة الإقفال القائمة ومن أقفلها ومتى، كما هي في الفترة لحظة الطلب.
CREATE TRIGGER finance_period_reopen_request BEFORE INSERT ON finance_period_reopenings
WHEN NEW.status<>'pending' OR NEW.version<>1 OR NEW.reclosed_at IS NOT NULL OR NEW.reclose_days IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM finance_periods p WHERE p.id=NEW.period_id AND p.tenant_id=NEW.tenant_id AND p.status='closed'
   AND p.version=NEW.period_version AND p.closed_by=NEW.previous_closed_by AND p.closed_at=NEW.previous_closed_at AND p.close_evidence=NEW.previous_close_evidence)
BEGIN SELECT RAISE(ABORT,'a reopening request names the closed version of its period and who closed it'); END;
-- يُقرَّر مرة، ويُعاد إقفاله مرة والفترة منفتحة به، ولا يُعاد كتابة شيء فيه.
CREATE TRIGGER finance_period_reopen_decided_once BEFORE UPDATE ON finance_period_reopenings
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.period_id<>OLD.period_id OR NEW.period_version<>OLD.period_version OR NEW.close_reopening_id IS NOT OLD.close_reopening_id
 OR NEW.previous_closed_by<>OLD.previous_closed_by OR NEW.previous_closed_at<>OLD.previous_closed_at OR NEW.previous_close_evidence<>OLD.previous_close_evidence
 OR NEW.requested_by<>OLD.requested_by OR NEW.reason<>OLD.reason OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
 OR NOT (
   (OLD.status='pending' AND NEW.status IN ('approved','rejected') AND NEW.reclosed_at IS NULL)
   OR (OLD.status='approved' AND NEW.status='approved' AND OLD.reclosed_at IS NULL AND NEW.reclosed_at IS NOT NULL
     AND NEW.decided_by=OLD.decided_by AND NEW.decided_at=OLD.decided_at AND NEW.decision_note=OLD.decision_note
     AND NEW.reclose_days=OLD.reclose_days AND NEW.reclose_due_on=OLD.reclose_due_on
     AND EXISTS(SELECT 1 FROM finance_periods p WHERE p.id=OLD.period_id AND p.status='open' AND p.version=OLD.period_version+1)))
BEGIN SELECT RAISE(ABORT,'a ledger reopening is decided once, re-closed once, and never rewritten'); END;
CREATE TRIGGER finance_period_reopen_no_delete BEFORE DELETE ON finance_period_reopenings BEGIN SELECT RAISE(ABORT,'ledger reopening history is immutable'); END;

/* (4) الفترة المحاسبية: إقفال بدليل، وفتح بفتح معتمد لنسخة الإقفال نفسها لا غير */
DROP TRIGGER finance_period_identity;
CREATE TRIGGER finance_period_identity BEFORE UPDATE ON finance_periods
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.name<>OLD.name OR NEW.starts_on<>OLD.starts_on OR NEW.ends_on<>OLD.ends_on
 OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
 OR NOT (
   (OLD.status='open' AND NEW.status='closed' AND NEW.closed_by IS NOT NULL AND NEW.closed_at IS NOT NULL AND length(trim(COALESCE(NEW.close_evidence,'')))>=3
     AND NOT EXISTS(SELECT 1 FROM finance_period_reopenings r WHERE r.period_id=OLD.id AND r.status='approved' AND r.reclosed_at IS NULL))
   OR (OLD.status='closed' AND NEW.status='open' AND NEW.closed_by IS NULL AND NEW.closed_at IS NULL AND NEW.close_evidence IS NULL
     AND EXISTS(SELECT 1 FROM finance_period_reopenings r WHERE r.period_id=OLD.id AND r.tenant_id=OLD.tenant_id AND r.status='approved' AND r.period_version=OLD.version AND r.reclosed_at IS NULL)))
BEGIN SELECT RAISE(ABORT,'financial period can only be closed with evidence, or reopened through an approved reopening'); END;

/* (5) علم قفل الدفتر في قائمة الإقفال ينزل فقط والدفتر منفتح فعلًا بفتح معتمد */
DROP TRIGGER close_period_versioned;
CREATE TRIGGER close_period_versioned BEFORE UPDATE ON close_periods
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.period_key<>OLD.period_key OR NEW.opened_by<>OLD.opened_by OR NEW.created_at<>OLD.created_at
 OR (NEW.ledger_locked<OLD.ledger_locked AND NOT EXISTS(SELECT 1 FROM finance_periods p JOIN finance_period_reopenings r ON r.period_id=p.id
   WHERE p.id=OLD.finance_period_id AND p.status='open' AND r.status='approved' AND r.reclosed_at IS NULL))
BEGIN SELECT RAISE(ABORT,'close period identity is fixed and a released ledger lock is not forgotten'); END;

/* (6) تفسير فروق الحسابات الرقابية على إقفالٍ بعينه */
CREATE TABLE close_explanations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_id TEXT NOT NULL,
  check_key TEXT NOT NULL CHECK(check_key IN ('controls')),
  item_key TEXT NOT NULL CHECK(length(item_key) BETWEEN 3 AND 300),
  amount_minor INTEGER NOT NULL,
  explanation TEXT NOT NULL CHECK(length(trim(explanation))>=20),
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(period_id,check_key,item_key,amount_minor),
  FOREIGN KEY(period_id,tenant_id) REFERENCES close_periods(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER close_explanations_open_period BEFORE INSERT ON close_explanations
WHEN NOT EXISTS(SELECT 1 FROM close_periods p WHERE p.id=NEW.period_id AND p.tenant_id=NEW.tenant_id AND p.status='open')
BEGIN SELECT RAISE(ABORT,'an approved close takes no new explanation'); END;
CREATE TRIGGER close_explanations_no_update BEFORE UPDATE ON close_explanations BEGIN SELECT RAISE(ABORT,'a close explanation is a record, not an edit'); END;
CREATE TRIGGER close_explanations_no_delete BEFORE DELETE ON close_explanations BEGIN SELECT RAISE(ABORT,'a close explanation is a record, not an edit'); END;
CREATE TRIGGER close_period_approver_not_explainer BEFORE UPDATE ON close_periods
WHEN NEW.status='approved' AND OLD.status<>'approved' AND EXISTS(SELECT 1 FROM close_explanations e WHERE e.period_id=OLD.id AND e.recorded_by=NEW.approved_by)
BEGIN SELECT RAISE(ABORT,'whoever explains an exception in the close does not approve it'); END;
