-- ترحيل 171 — الرؤية وإثبات الشهر (الحزمة 3): نقد التحصيل يُطابَق بكشف البنك، وإقرار الاستثناءات المالية سجلٌّ إلحاقي.
--
-- الجزء الأول (1–4): نقد التحصيل يُطابَق بكشف البنك.
-- ما كان قبل هذا الترحيل، مقيسًا لا مستنتجًا: الترحيل 170 أضاف ثلاثة مستندات تحرّك مالًا في البنك — ارتداد القبض المؤكد
-- (ar_receipt_reversal: مالٌ خرج لأن الشيك رجع أو الحوالة انعكست)، والقبض على حساب العميل (ar_account_receipt: مالٌ دخل)،
-- وارتداد القبض على الحساب (ar_account_reversal: مالٌ خرج) — ولكلٍّ قيدٌ على حساب البنك في الدفتر. لكن bank_matches.source_kind
-- وbank_match_items.source_kind (الترحيل 168) يقبلان تسعة أنواع لا غير، فسطر الكشف الذي يحمل هذا المال لا يُطابَق بسجله أبدًا:
-- يبقى «حركة بنكية بلا قرار» فلا تُعدّ التسوية، أو يُصنَّف «غير معروف» فيبقى فرقًا بمبلغه، وقيده المرحّل يبقى «سجلًّا لم يظهر في
-- البنك» — والتتبّع يقول عن نقدٍ حقيقي إن الجدول لا يقبل نوعه.
--
-- ما يغيّره: الجدولان يُعاد بناؤهما بنمط الترحيل 168 نفسه (إعادة تسمية، ثم جدول بالقيد الموسَّع، ثم نقل الصفوف كما هي عمودًا
-- عمودًا، ثم حذف القديم)، بالأنواع الاثني عشر: التسعة كما هي، والثلاثة الجديدة. لا عمود يُضاف ولا يُحذف، ولا صفّ يتغيّر:
-- المطابقات المقترحة والمعتمدة والمرفوضة، وبنودها الحيّة وغير الحيّة، تنتقل بقيمها. والقوادح والفهارس تُعاد بنصوص الترحيل 168
-- بالحرف: الحارس نفسه على الأعضاء والمجموع والقرار الواحد والرفض الذي يحرّر.
--
-- لماذا يُعاد البنود أيضًا لا الرأس وحده: عضو المطابقة المجمّعة (group) لا يُكتب في الرأس أصلًا — يُكتب في bank_match_items —
-- فقيدٌ على الرأس وحده يترك ارتداد قبضين في تحويل واحد بلا مطابقة ممكنة.
--
-- وترتيب إعادة التسمية مقصود: البنود أولًا ثم الرأس، فينتقل مرجع البنود القديمة إلى الرأس القديم ويُحذفان معًا، ويشير الجدول
-- الجديد للبنود إلى الرأس الجديد. لا وحدة ولا رؤية أخرى تشير إلى الجدولين (فُحص sqlite_master قبل الكتابة: القوادح التسعة
-- والفهارس السبعة أدناه وحدها).

/* (1) ما يُعاد بناؤه: القوادح والفهارس على الجدولين وعلى دفعات الكشف */
DROP TRIGGER bank_import_cancel_guard;
DROP TRIGGER bank_match_decided_once;
DROP TRIGGER bank_match_exact_sum;
DROP TRIGGER bank_match_items_fixed;
DROP TRIGGER bank_match_items_insert;
DROP TRIGGER bank_match_items_no_delete;
DROP TRIGGER bank_match_items_release;
DROP TRIGGER bank_match_live_batch;
DROP TRIGGER bank_matches_no_delete;
DROP INDEX bank_match_item_journal_live;
DROP INDEX bank_match_item_line_live;
DROP INDEX bank_match_item_record_live;
DROP INDEX bank_match_items_record;
DROP INDEX bank_match_live;
DROP INDEX bank_match_record_live;
DROP INDEX bank_matches_source;
ALTER TABLE bank_match_items RENAME TO bank_match_items_v1;
ALTER TABLE bank_matches RENAME TO bank_matches_v3;

/* (2) رأس المطابقة بالأنواع الاثني عشر */
CREATE TABLE bank_matches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  transaction_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('record','unmatched')),
  shape TEXT NOT NULL DEFAULT 'single' CHECK(shape IN ('single','group','split')),
  source_kind TEXT CHECK(source_kind IS NULL OR source_kind IN ('supplier_payment','ar_receipt','payroll_payment','expense_reimbursement','custody_issue','custody_return','advance_receipt','advance_reversal','supplier_payment_return','ar_receipt_reversal','ar_account_receipt','ar_account_reversal')),
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
  CHECK((source_kind IS NULL)=(source_id IS NULL)),
  CHECK(kind='record' OR (source_kind IS NULL AND shape='single')),
  CHECK((kind='unmatched')=(unmatched_reason IS NOT NULL)),
  CHECK(decided_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='proposed')=(decided_by IS NULL AND decided_at IS NULL))
) STRICT;
INSERT INTO bank_matches(id,tenant_id,transaction_id,kind,shape,source_kind,source_id,unmatched_reason,amount_minor,rationale,suggested_score,status,prepared_by,prepared_at,decided_by,decided_at,decision_note,version)
  SELECT id,tenant_id,transaction_id,kind,shape,source_kind,source_id,unmatched_reason,amount_minor,rationale,suggested_score,status,prepared_by,prepared_at,decided_by,decided_at,decision_note,version FROM bank_matches_v3;

/* (3) أعضاء المطابقة بالأنواع نفسها */
CREATE TABLE bank_match_items (
  match_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bank_account_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 200),
  side TEXT NOT NULL CHECK(side IN ('line','record','journal')),
  transaction_id TEXT,
  source_kind TEXT CHECK(source_kind IS NULL OR source_kind IN ('supplier_payment','ar_receipt','payroll_payment','expense_reimbursement','custody_issue','custody_return','advance_receipt','advance_reversal','supplier_payment_return','ar_receipt_reversal','ar_account_receipt','ar_account_reversal')),
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
INSERT INTO bank_match_items(match_id,tenant_id,bank_account_id,position,side,transaction_id,source_kind,source_id,journal_id,amount_minor,live,created_at)
  SELECT match_id,tenant_id,bank_account_id,position,side,transaction_id,source_kind,source_id,journal_id,amount_minor,live,created_at FROM bank_match_items_v1;
DROP TABLE bank_match_items_v1;
DROP TABLE bank_matches_v3;

/* (4) الفهارس والقوادح كما كتبها الترحيل 168 بالحرف */
CREATE UNIQUE INDEX bank_match_live ON bank_matches(transaction_id) WHERE status<>'rejected';
CREATE UNIQUE INDEX bank_match_record_live ON bank_matches(tenant_id,source_kind,source_id) WHERE kind='record' AND status<>'rejected';
CREATE INDEX bank_matches_source ON bank_matches(tenant_id,source_kind,source_id);
CREATE UNIQUE INDEX bank_match_item_line_live ON bank_match_items(transaction_id) WHERE side='line' AND live=1;
CREATE UNIQUE INDEX bank_match_item_record_live ON bank_match_items(tenant_id,source_kind,source_id) WHERE side='record' AND live=1;
CREATE UNIQUE INDEX bank_match_item_journal_live ON bank_match_items(journal_id,bank_account_id) WHERE side='journal' AND live=1;
CREATE INDEX bank_match_items_record ON bank_match_items(tenant_id,source_kind,source_id);

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
CREATE TRIGGER bank_match_items_release AFTER UPDATE OF status ON bank_matches
WHEN NEW.status='rejected'
BEGIN UPDATE bank_match_items SET live=0 WHERE match_id=NEW.id AND live=1; END;

/* (5) إقرار الاستثناءات المالية (app/finance-exceptions.mjs) */
-- الاستثناء نفسه لا يُخزَّن: يُحسب من مصدره وقت القراءة (فاتورة موقوفة، سطر كشف بلا قرار، مستند بلا قيد مرحّل، فرق حساب رقابي،
-- إعادة إقفال فات موعدها، عكس ينتظر اعتماده، وعد سداد ما انوفى)، ويختفي حين يُحسم في مصدره. ما يُخزَّن هو إقرار مالكه:
-- من أقرّ، ومتى، وبأي مبلغ كان الاستثناء لحظتها، وما الذي سيفعله. سجلٌّ إلحاقي لا يُعدَّل ولا يُحذف؛ وتغيّر المبلغ بعد الإقرار
-- يجعله إقرارًا لرقم قديم، فيعود الاستثناء ينتظر إقرارًا جديدًا — الإقرار لا يحسم شيئًا ولا يُخفي فرقًا.
-- النوع مفتاحٌ يملكه الكود (السجل في الوحدة)، والقاعدة تحرس شكله فقط، فنوعٌ جديد لا يحتاج إعادة بناء الجدول.
CREATE TABLE finance_exception_acks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  exception_key TEXT NOT NULL CHECK(length(exception_key) BETWEEN 3 AND 300),
  kind TEXT NOT NULL CHECK(length(kind) BETWEEN 3 AND 40 AND kind NOT GLOB '*[^a-z_]*'),
  amount_minor INTEGER,
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  acknowledged_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(acknowledged_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX finance_exception_acks_key ON finance_exception_acks(tenant_id,exception_key,created_at);
CREATE TRIGGER finance_exception_acks_no_update BEFORE UPDATE ON finance_exception_acks BEGIN SELECT RAISE(ABORT,'an exception acknowledgement is a record, not an edit'); END;
CREATE TRIGGER finance_exception_acks_no_delete BEFORE DELETE ON finance_exception_acks BEGIN SELECT RAISE(ABORT,'an exception acknowledgement is a record, not an edit'); END;
