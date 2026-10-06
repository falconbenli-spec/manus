-- طبقة الفوترة الإلكترونية القابلة للتوصيل. المنصة **غير مربوطة** بأي جهة ولا ترسل شيئًا.
-- ما تبنيه هذه الهجرة نافع بذاته سواء تم الربط أو لم يتم: عدّاد لا يُعاد ضبطه، وأرشيف لا يُعدَّل،
-- وطابور جاهز يحمل سبب كل حالة. لا مفتاح ولا شهادة ولا سر في أي عمود هنا؛ مكانها خزنة أسرار يقررها المالك.

-- ── العدّاد: رقم المستند لا يعود للوراء ولا يُعاد ضبطه، ولو أُفرغت الجداول الأخرى ────────────────
CREATE TABLE einvoice_counters (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('invoice','credit_note')),
  last_sequence INTEGER NOT NULL CHECK(last_sequence>0),
  last_document_id TEXT NOT NULL REFERENCES tax_invoices(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,kind)
) STRICT;
-- العدّاد يزيد واحدًا واحدًا فقط. أي نقص أو قفزة أو نقل بين كيان ونوع مرفوض في SQL لا في الكود.
CREATE TRIGGER einvoice_counter_never_resets BEFORE UPDATE ON einvoice_counters
WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.kind<>OLD.kind OR NEW.last_sequence<>OLD.last_sequence+1
BEGIN SELECT RAISE(ABORT,'einvoice counter is sequential and never resets'); END;
CREATE TRIGGER einvoice_counter_no_delete BEFORE DELETE ON einvoice_counters
BEGIN SELECT RAISE(ABORT,'einvoice counter is sequential and never resets'); END;

-- كل رقم يُمنح لمستند يمر بالعدّاد: لا فجوة ولا إعادة استخدام ولا رجوع للوراء.
CREATE TRIGGER einvoice_sequence_monotonic BEFORE UPDATE OF sequence ON tax_invoices
WHEN NEW.sequence IS NOT NULL AND NEW.sequence<>COALESCE((SELECT last_sequence FROM einvoice_counters WHERE tenant_id=NEW.tenant_id AND kind=NEW.kind),0)+1
BEGIN SELECT RAISE(ABORT,'einvoice counter is sequential and never resets'); END;
CREATE TRIGGER einvoice_sequence_advance AFTER UPDATE OF sequence ON tax_invoices
WHEN NEW.sequence IS NOT NULL AND OLD.sequence IS NULL
BEGIN
  INSERT INTO einvoice_counters(tenant_id,kind,last_sequence,last_document_id,updated_at)
  VALUES(NEW.tenant_id,NEW.kind,NEW.sequence,NEW.id,NEW.updated_at)
  ON CONFLICT(tenant_id,kind) DO UPDATE SET last_sequence=excluded.last_sequence,last_document_id=excluded.last_document_id,updated_at=excluded.updated_at;
END;

-- سلسلة البصمات تُفرض عند الإصدار: بصمة المستند السابق ورقم حلقته لا يُختاران من الكود وحده.
CREATE TRIGGER einvoice_chain_link BEFORE UPDATE OF hash ON tax_invoices
WHEN NEW.hash IS NOT NULL AND OLD.hash IS NULL
 AND (COALESCE(NEW.previous_hash,'')<>COALESCE((SELECT hash FROM tax_invoices WHERE tenant_id=NEW.tenant_id AND chain_index=(SELECT MAX(chain_index) FROM tax_invoices WHERE tenant_id=NEW.tenant_id AND chain_index IS NOT NULL AND id<>NEW.id)),'')
   OR NEW.chain_index<>COALESCE((SELECT MAX(chain_index) FROM tax_invoices WHERE tenant_id=NEW.tenant_id AND chain_index IS NOT NULL AND id<>NEW.id),0)+1)
BEGIN SELECT RAISE(ABORT,'einvoice hash chain must link to the previous issued document'); END;

-- ── الأرشيف: نسخة كل مستند صادر بصيغته، لا تُعدَّل ولا تُحذف ──────────────────────────────────
-- الصيغة `platform-json-v1` صيغة المنصة نفسها، وليست صيغة جهة ولا مواصفة رسمية؛ لا نخترع مواصفة.
CREATE TABLE einvoice_archive (
  document_id TEXT PRIMARY KEY REFERENCES tax_invoices(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('invoice','credit_note')),
  original_document_id TEXT REFERENCES tax_invoices(id),
  number TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence>0),
  chain_index INTEGER NOT NULL CHECK(chain_index>0),
  issued_at TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format='platform-json-v1'),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  previous_hash TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  qr_tlv TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  UNIQUE(tenant_id,number),
  -- الإشعار الدائن يحمل مرجع أصله إلزامًا، في الأرشيف كما في المستند.
  CHECK((kind='credit_note')=(original_document_id IS NOT NULL))
) STRICT;
CREATE TRIGGER einvoice_archive_issued_only BEFORE INSERT ON einvoice_archive
WHEN NOT EXISTS(SELECT 1 FROM tax_invoices WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND status='issued' AND hash=NEW.document_hash AND number=NEW.number)
BEGIN SELECT RAISE(ABORT,'the archive stores an issued document exactly as issued'); END;
CREATE TRIGGER einvoice_archive_no_update BEFORE UPDATE ON einvoice_archive
BEGIN SELECT RAISE(ABORT,'an archived document is never modified'); END;
CREATE TRIGGER einvoice_archive_no_delete BEFORE DELETE ON einvoice_archive
BEGIN SELECT RAISE(ABORT,'an archived document is never deleted'); END;

-- ── تجاوز نقص بيانات المشتري: موثّق بسببه وبصاحبه، لا يُعدَّل ولا يُحذف ──────────────────────────
-- متطلبات بيانات المشتري تخص نوعًا من الفواتير دون غيره ولا نعرف حدودها يقينًا، فالتجاوز ممكن ومسجّل.
CREATE TABLE einvoice_buyer_overrides (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  missing TEXT NOT NULL CHECK(json_valid(missing)),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=20),
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX einvoice_override_case ON einvoice_buyer_overrides(tenant_id,case_id);
CREATE TRIGGER einvoice_override_no_update BEFORE UPDATE ON einvoice_buyer_overrides
BEGIN SELECT RAISE(ABORT,'a documented override is replaced by a new record'); END;
CREATE TRIGGER einvoice_override_no_delete BEFORE DELETE ON einvoice_buyer_overrides
BEGIN SELECT RAISE(ABORT,'a documented override is retained'); END;

-- ── الطابور: جاهز ولا يرسل شيئًا اليوم. لكل حالة سبب مكتوب، ولكل محاولة سجل ────────────────────
CREATE TABLE einvoice_submissions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  document_id TEXT NOT NULL UNIQUE REFERENCES tax_invoices(id),
  -- القناة لا تفترضها المنصة: نوع الفاتورة يحدده إنسان بسببه، لأن تصنيفها ليس معلومًا للمنصة.
  channel TEXT CHECK(channel IS NULL OR channel IN ('clearance','reporting')),
  channel_reason TEXT NOT NULL DEFAULT '',
  channel_by TEXT,
  channel_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','sent','accepted','accepted_with_warnings','rejected','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0 AND attempts<=50),
  last_attempt_at TEXT,
  last_attempt_by TEXT,
  next_attempt_at TEXT,
  provider TEXT NOT NULL DEFAULT '',
  provider_reference TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(channel_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(last_attempt_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((channel IS NULL)=(channel_by IS NULL) AND (channel IS NULL)=(channel_at IS NULL)),
  CHECK(channel IS NULL OR length(trim(channel_reason))>=10),
  CHECK(status='queued' OR channel IS NOT NULL),
  CHECK((attempts=0)=(last_attempt_at IS NULL) AND (attempts=0)=(last_attempt_by IS NULL))
) STRICT;
CREATE INDEX einvoice_submission_queue ON einvoice_submissions(tenant_id,status,next_attempt_at);
CREATE TRIGGER einvoice_submission_issued_only BEFORE INSERT ON einvoice_submissions
WHEN NEW.status<>'queued' OR NEW.attempts<>0 OR NEW.version<>1 OR NEW.channel IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM tax_invoices WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND status='issued')
BEGIN SELECT RAISE(ABORT,'a submission starts queued and unsent for an issued document only'); END;
-- آلة الحالات: القبول والرفض نهائيان، والسبب يتغير مع كل حالة، ومن صنّف القناة لا يرسلها.
CREATE TRIGGER einvoice_submission_flow BEFORE UPDATE ON einvoice_submissions
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.document_id<>OLD.document_id OR NEW.created_at<>OLD.created_at
 OR NEW.version<>OLD.version+1 OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1
 OR OLD.status IN ('accepted','accepted_with_warnings','rejected')
 OR (OLD.channel IS NOT NULL AND (NEW.channel IS NOT OLD.channel OR NEW.channel_by IS NOT OLD.channel_by OR NEW.channel_reason<>OLD.channel_reason))
 OR (NEW.status<>OLD.status AND NEW.reason=OLD.reason)
 OR (NEW.attempts>OLD.attempts AND (NEW.channel IS NULL OR NEW.last_attempt_by IS NULL OR NEW.last_attempt_by=NEW.channel_by))
 OR NOT ((OLD.status='queued' AND NEW.status IN ('queued','sent','accepted','accepted_with_warnings','rejected','failed'))
      OR (OLD.status='sent' AND NEW.status IN ('sent','accepted','accepted_with_warnings','rejected','failed'))
      OR (OLD.status='failed' AND NEW.status IN ('queued','failed')))
BEGIN SELECT RAISE(ABORT,'einvoice submission history is append-only and its decisions are final'); END;
CREATE TRIGGER einvoice_submission_no_delete BEFORE DELETE ON einvoice_submissions
BEGIN SELECT RAISE(ABORT,'a submission record is retained'); END;
-- مستند لمشتر ناقص البيانات لا يُحاول إرساله إلا بتجاوز موثّق مسجّل لعميله.
CREATE TRIGGER einvoice_submission_buyer_guard BEFORE UPDATE ON einvoice_submissions
WHEN NEW.attempts>OLD.attempts AND EXISTS(
  SELECT 1 FROM tax_invoices t JOIN ar_claims c ON c.id=t.claim_id
  WHERE t.id=NEW.document_id
    AND (json_extract(t.buyer,'$.vat_number') IS NULL
      OR length(trim(COALESCE(json_extract(t.buyer,'$.address.building'),'')))=0
      OR length(trim(COALESCE(json_extract(t.buyer,'$.address.street'),'')))=0
      OR length(trim(COALESCE(json_extract(t.buyer,'$.address.district'),'')))=0
      OR length(trim(COALESCE(json_extract(t.buyer,'$.address.city'),'')))=0
      OR length(trim(COALESCE(json_extract(t.buyer,'$.address.postal_code'),'')))=0)
    AND NOT EXISTS(SELECT 1 FROM einvoice_buyer_overrides o WHERE o.tenant_id=t.tenant_id AND o.case_id=c.case_id))
BEGIN SELECT RAISE(ABORT,'a buyer with incomplete tax data needs a documented override before any attempt'); END;

CREATE TABLE einvoice_attempts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  submission_id TEXT NOT NULL REFERENCES einvoice_submissions(id),
  attempt_no INTEGER NOT NULL CHECK(attempt_no>0),
  operation TEXT NOT NULL CHECK(operation IN ('submitForClearance','reportSimplified','statusOf')),
  provider TEXT NOT NULL CHECK(length(trim(provider))>=1),
  outcome TEXT NOT NULL CHECK(outcome IN ('refused','pending','accepted','accepted_with_warnings','rejected','failed')),
  message TEXT NOT NULL CHECK(length(trim(message))>=5),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX einvoice_attempt_trail ON einvoice_attempts(submission_id,created_at);
CREATE TRIGGER einvoice_attempts_no_update BEFORE UPDATE ON einvoice_attempts
BEGIN SELECT RAISE(ABORT,'an attempt log line is immutable'); END;
CREATE TRIGGER einvoice_attempts_no_delete BEFORE DELETE ON einvoice_attempts
BEGIN SELECT RAISE(ABORT,'an attempt log line is retained'); END;

-- ── كل مستند يصدر يدخل الأرشيف والطابور بالمحفّز نفسه، فلا يفلت مستند من أيهما ──────────────────
CREATE TRIGGER einvoice_issue_archives AFTER UPDATE OF status ON tax_invoices
WHEN NEW.status='issued' AND OLD.status<>'issued'
BEGIN
  INSERT INTO einvoice_archive(document_id,tenant_id,kind,original_document_id,number,sequence,chain_index,issued_at,format,payload,previous_hash,document_hash,qr_tlv,archived_at)
  VALUES(NEW.id,NEW.tenant_id,NEW.kind,NEW.original_invoice_id,NEW.number,NEW.sequence,NEW.chain_index,NEW.issued_at,'platform-json-v1',
    json_object('id',NEW.id,'kind',NEW.kind,'number',NEW.number,'issued_at',NEW.issued_at,'supply_date',NEW.supply_date,
      'seller',json(NEW.seller),'buyer',json(NEW.buyer),'lines',json(NEW.lines),
      'vat_category',NEW.vat_category,'vat_basis_points',NEW.vat_basis_points,'vat_reason',NEW.vat_reason,'currency',NEW.currency,
      'net_minor',NEW.net_minor,'vat_minor',NEW.vat_minor,'total_minor',NEW.total_minor,
      'original_invoice_id',NEW.original_invoice_id,'previous_hash',COALESCE(NEW.previous_hash,''),'hash',NEW.hash,'qr_tlv',NEW.qr_tlv),
    COALESCE(NEW.previous_hash,''),NEW.hash,NEW.qr_tlv,NEW.updated_at);
  INSERT INTO einvoice_submissions(id,tenant_id,document_id,status,reason,created_at,updated_at)
  VALUES(lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
    NEW.tenant_id,NEW.id,'queued','غير مربوط: لم تُحدد قناة الإرسال بعد، ولم يُرسل شيء إلى أي جهة.',NEW.updated_at,NEW.updated_at);
END;

-- ── ما صدر قبل هذه الهجرة يدخل العدّاد والأرشيف والطابور بأثر رجعي ──────────────────────────────
INSERT INTO einvoice_counters(tenant_id,kind,last_sequence,last_document_id,updated_at)
SELECT t.tenant_id,t.kind,t.sequence,t.id,COALESCE(t.issued_at,t.updated_at) FROM tax_invoices t
WHERE t.sequence IS NOT NULL AND t.sequence=(SELECT MAX(x.sequence) FROM tax_invoices x WHERE x.tenant_id=t.tenant_id AND x.kind=t.kind);

INSERT INTO einvoice_archive(document_id,tenant_id,kind,original_document_id,number,sequence,chain_index,issued_at,format,payload,previous_hash,document_hash,qr_tlv,archived_at)
SELECT t.id,t.tenant_id,t.kind,t.original_invoice_id,t.number,t.sequence,t.chain_index,t.issued_at,'platform-json-v1',
  json_object('id',t.id,'kind',t.kind,'number',t.number,'issued_at',t.issued_at,'supply_date',t.supply_date,
    'seller',json(t.seller),'buyer',json(t.buyer),'lines',json(t.lines),
    'vat_category',t.vat_category,'vat_basis_points',t.vat_basis_points,'vat_reason',t.vat_reason,'currency',t.currency,
    'net_minor',t.net_minor,'vat_minor',t.vat_minor,'total_minor',t.total_minor,
    'original_invoice_id',t.original_invoice_id,'previous_hash',COALESCE(t.previous_hash,''),'hash',t.hash,'qr_tlv',t.qr_tlv),
  COALESCE(t.previous_hash,''),t.hash,t.qr_tlv,t.updated_at
FROM tax_invoices t WHERE t.status='issued';

INSERT INTO einvoice_submissions(id,tenant_id,document_id,status,reason,created_at,updated_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  t.tenant_id,t.id,'queued','غير مربوط: مستند صدر قبل بناء الطابور، ولم يُرسل إلى أي جهة.',t.updated_at,t.updated_at
FROM tax_invoices t WHERE t.status='issued';
