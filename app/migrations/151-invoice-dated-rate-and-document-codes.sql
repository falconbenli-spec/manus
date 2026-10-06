-- ترحيل 151 — نسبة ضريبة المخرجات تُقرأ من الجدول المؤرَّخ، ورموز المستند تُجمَّد وقت الإصدار.
--
-- السبب الأول: القيد يعرف نسبتين فقط `vat_basis_points IN (0,1500)`، والكود كان يعرف مثلهما.
-- وضريبة المدخلات في app/payables.mjs تقرأ **جدولًا مؤرَّخًا** (واصف `finance.vat_rate`): 5% من
-- 2018-01-01 و15% من 2020-07-01، مع الأداة التنظيمية لكل مرحلة. فصارت فاتورة مخرجات بتاريخ توريد
-- يسبق يوليو 2020 تُرفض بـ`unsupported_rate` بينما فاتورة مدخلات بالتاريخ نفسه تُقاس بنسبتها هي.
-- الكود وحده لا يكفي: توسيعه بلا هذا الترحيل يسقط عند الإدراج بـ
--   CHECK constraint failed: vat_basis_points IN (0,1500)
-- وهو نفس نمط «الرواق» (ترحيل 143) و«اليوم» (149): قيمة دخلت الكود ولم تدخل القيد.
-- والنسب هنا **ليست فتحًا عامًّا**: ثلاث قيم مسمّاة هي نفسها التي في الجدول المؤرَّخ، ونسبة رابعة
-- تحتاج ترحيلًا يُراجَع وحده — لا تُفتح من شاشة ولا من إدخال.
--
-- السبب الثاني: الأرشيف لا يُعدَّل بعد كتابته (المحفّز einvoice_archive_no_update)، فكل حقل ناقص
-- وقت الإصدار يبقى ناقصًا في تلك النسخة إلى الأبد. وجدول المستندات فارغ اليوم، فإضافة الحقول الآن
-- بلا كلفة، وبعد أول مستند تحتاج نسخة ثانية لا تطابق الأولى. والمضاف ثلاثة رموز تُشتق اشتقاقًا من
-- المستند نفسه ولا تُدخَل بيد أحد: نوع المستند، ورمز فئة الضريبة، ورمز وسيلة السداد.
--
-- **حدّ صريح يُقرأ كما هو:** هذا تثبيت حقول في أرشيف المنصة، لا أكثر. المنصة **غير مربوطة** بأي جهة
-- ولم ترسل شيئًا، وهذا الترحيل لا يغيّر ذلك ولا يدّعي توافقًا مع أي مرحلة ولا مطابقة أي مواصفة.
-- وصيغة الأرشيف تبقى `platform-json-v1`: صيغة المنصة نفسها، لا صيغة جهة.
--
-- ولماذا لا تُعاد تسمية الجدول القديم — وهو النمط المتبع في 147:
-- لهذا الجدول تابعون: أربعة جداول تشير إليه بمفتاح أجنبي (einvoice_counters وeinvoice_archive
-- وeinvoice_submissions وbilling_drafts)، وخمسة محفّزات على جداول أخرى تقرؤه بالاسم. وإعادة التسمية
-- الحديثة في SQLite تعيد كتابة كل إشارة إليه فيهم، فتصير تشير إلى الاسم المؤقت ثم يُسقط. فالمتّبع هنا
-- الإجراء الرسمي: جديد باسم مؤقت، نقل الصفوف، إسقاط القديم باسمه، ثم تسمية الجديد باسمه.
-- والمحفّزات التابعة تُسقط وتعود بنصّها حول العملية: ALTER TABLE ... RENAME يفحص المخطط كله، ومحفّزٌ
-- يشير إلى جدول مُسقَط يُفشل الفحص. وdefer_foreign_keys تؤجّل فحص المفاتيح إلى نهاية المعاملة.
--
-- ولا قيمة تتغير: الصفوف تُنقل بحروفها، ولا صفّ يُحذف، ولا سطر مستندٍ صادرٍ يُعاد كتابته — نسخته في
-- الأرشيف مجمَّدة، فتعديل سطوره هنا يُفرّق المستند عن أرشيفه. الرموز الجديدة تُشتق للصفوف المنقولة من
-- نوعها وتصنيفها (اشتقاق لا إدخال)، ورمز الوحدة يلزم المستندات الجديدة وحدها بمحفّز.
PRAGMA defer_foreign_keys=ON;

-- ١) المحفّزات التابعة على جداول أخرى: تُسقط الآن وتعود بنصّها في آخر الملف.
DROP TRIGGER billing_drafts_human_issue;
DROP TRIGGER billing_drafts_invoice_same_client;
DROP TRIGGER einvoice_archive_issued_only;
DROP TRIGGER einvoice_submission_issued_only;
DROP TRIGGER einvoice_submission_buyer_guard;

-- ٢) الجدول بقيده الموسَّع. ما عدا النسب والرموز منقول بحرفه من الترحيل 024.
CREATE TABLE tax_invoices_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('invoice','credit_note')),
  claim_id TEXT NOT NULL REFERENCES ar_claims(id),
  original_invoice_id TEXT REFERENCES tax_invoices_new(id),
  project_id TEXT NOT NULL,
  sequence INTEGER CHECK(sequence IS NULL OR sequence>0),
  number TEXT,
  issued_at TEXT,
  supply_date TEXT NOT NULL,
  seller TEXT NOT NULL CHECK(json_valid(seller)),
  buyer TEXT NOT NULL CHECK(json_valid(buyer)),
  lines TEXT NOT NULL CHECK(json_valid(lines)),
  vat_category TEXT NOT NULL CHECK(vat_category IN ('standard','zero_rated','exempt','out_of_scope')),
  -- النسب المؤرَّخة المعتمدة وحدها: صفر لغير الخاضع، و5% و15% للنسبة الأساسية بحسب تاريخ التوريد.
  -- مصدرها الجدول المؤرَّخ في واصف finance.vat_rate (app/payables.mjs) بأداته التنظيمية لكل مرحلة.
  vat_basis_points INTEGER NOT NULL CHECK(vat_basis_points IN (0,500,1500)),
  vat_reason TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL CHECK(currency='SAR'),
  net_minor INTEGER NOT NULL CHECK(net_minor>0),
  vat_minor INTEGER NOT NULL CHECK(vat_minor>=0),
  total_minor INTEGER NOT NULL CHECK(total_minor=net_minor+vat_minor),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','pending','issued','rejected')),
  prepared_by TEXT NOT NULL,
  issued_by TEXT REFERENCES users(id),
  decision_note TEXT NOT NULL DEFAULT '',
  chain_index INTEGER CHECK(chain_index IS NULL OR chain_index>0),
  previous_hash TEXT,
  hash TEXT,
  qr_tlv TEXT,
  -- لا اتصال بمنصة «فاتورة»: الحالة ثابتة حتى يُبنى الربط ويُثبت.
  reporting_status TEXT NOT NULL DEFAULT 'not_reported' CHECK(reporting_status='not_reported'),
  -- رموز المستند: تُشتق من المستند نفسه ولا يُدخلها أحد، والقيد يمنع افتراقها عن أصلها.
  -- نوع المستند من قائمة UN/CEFACT 1001: 388 فاتورة، 381 إشعار دائن. والمنصة لا تعرف غير النوعين.
  document_type_code TEXT NOT NULL CHECK(document_type_code=CASE kind WHEN 'invoice' THEN '388' ELSE '381' END),
  -- فئة الضريبة من قائمة UN/ECE 5305: S أساسية، Z صفرية، E معفاة، O خارج النطاق.
  tax_category_code TEXT NOT NULL CHECK(tax_category_code=CASE vat_category WHEN 'standard' THEN 'S' WHEN 'zero_rated' THEN 'Z' WHEN 'exempt' THEN 'E' ELSE 'O' END),
  -- وسيلة السداد من قائمة UN/ECE 4461. القيمة الوحيدة المقبولة اليوم 1 = «غير محددة»، وهي الصادقة:
  -- المستند يصدر قبل القبض، والمنصة لا تلتقط وسيلة سداد وقت الإصدار. توسيعها يحتاج ترحيلًا،
  -- على نمط reporting_status أعلاه، فلا تُخترع وسيلة لم تُلتقط.
  payment_means_code TEXT NOT NULL DEFAULT '1' CHECK(payment_means_code='1'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((kind='credit_note')=(original_invoice_id IS NOT NULL)),
  CHECK(kind='invoice' OR length(trim(reason))>=10),
  CHECK((vat_category='standard' AND vat_basis_points IN (500,1500)) OR (vat_category<>'standard' AND vat_basis_points=0 AND length(trim(vat_reason))>=10)),
  CHECK(issued_by IS NULL OR issued_by<>prepared_by),
  CHECK((status='issued')=(sequence IS NOT NULL AND number IS NOT NULL AND issued_at IS NOT NULL AND issued_by IS NOT NULL AND hash IS NOT NULL AND qr_tlv IS NOT NULL AND chain_index IS NOT NULL))
) STRICT;

-- ٣) نقل الصفوف بحروفها. الرموز الثلاثة تُشتق من النوع والتصنيف، والسطور تُنقل كما هي: مستندٌ صادر
-- نسخته في الأرشيف مجمَّدة، فإعادة كتابة سطوره هنا تُفرّقه عن أرشيفه.
INSERT INTO tax_invoices_new(id,tenant_id,kind,claim_id,original_invoice_id,project_id,sequence,number,issued_at,supply_date,
  seller,buyer,lines,vat_category,vat_basis_points,vat_reason,currency,net_minor,vat_minor,total_minor,reason,status,
  prepared_by,issued_by,decision_note,chain_index,previous_hash,hash,qr_tlv,reporting_status,
  document_type_code,tax_category_code,payment_means_code,version,created_at,updated_at)
SELECT id,tenant_id,kind,claim_id,original_invoice_id,project_id,sequence,number,issued_at,supply_date,
  seller,buyer,lines,vat_category,vat_basis_points,vat_reason,currency,net_minor,vat_minor,total_minor,reason,status,
  prepared_by,issued_by,decision_note,chain_index,previous_hash,hash,qr_tlv,reporting_status,
  CASE kind WHEN 'invoice' THEN '388' ELSE '381' END,
  CASE vat_category WHEN 'standard' THEN 'S' WHEN 'zero_rated' THEN 'Z' WHEN 'exempt' THEN 'E' ELSE 'O' END,
  '1',version,created_at,updated_at
FROM tax_invoices;

DROP TABLE tax_invoices;
ALTER TABLE tax_invoices_new RENAME TO tax_invoices;

-- ٤) الفهارس الأربعة بنصّها (الترحيل 024): تسقط مع الجدول، وغيابها يفتح ما كانت تغلقه.
CREATE UNIQUE INDEX tax_invoices_sequence ON tax_invoices(tenant_id,kind,sequence) WHERE sequence IS NOT NULL;
CREATE UNIQUE INDEX tax_invoices_chain ON tax_invoices(tenant_id,chain_index) WHERE chain_index IS NOT NULL;
CREATE UNIQUE INDEX tax_invoices_number ON tax_invoices(tenant_id,number) WHERE number IS NOT NULL;
CREATE UNIQUE INDEX tax_invoices_one_per_claim ON tax_invoices(claim_id) WHERE kind='invoice' AND status<>'rejected';

-- ٥) المحفّزات السبعة على الجدول بنصّها (024 و070). أسماؤها هي نفسها التي تقرؤها المراجعة الذاتية
-- في app/einvoice-selfcheck.mjs من sqlite_master، فغياب واحدٍ منها يقلب ضابطه إلى «غير مستوفى».
CREATE TRIGGER tax_invoices_fixed BEFORE UPDATE ON tax_invoices
WHEN OLD.status IN ('issued','rejected') OR NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.kind<>OLD.kind OR NEW.claim_id<>OLD.claim_id OR NEW.original_invoice_id IS NOT OLD.original_invoice_id OR NEW.prepared_by<>OLD.prepared_by OR NEW.created_at<>OLD.created_at
  OR (OLD.status='pending' AND (NEW.seller<>OLD.seller OR NEW.buyer<>OLD.buyer OR NEW.lines<>OLD.lines OR NEW.net_minor<>OLD.net_minor OR NEW.vat_minor<>OLD.vat_minor OR NEW.total_minor<>OLD.total_minor OR NEW.supply_date<>OLD.supply_date OR NEW.vat_category<>OLD.vat_category))
  OR NOT ((OLD.status='draft' AND NEW.status IN ('draft','pending')) OR (OLD.status='pending' AND NEW.status IN ('draft','issued','rejected')))
BEGIN SELECT RAISE(ABORT,'issued tax documents are immutable; correct with a credit note'); END;
CREATE TRIGGER tax_invoices_no_delete BEFORE DELETE ON tax_invoices BEGIN SELECT RAISE(ABORT,'tax documents are retained'); END;
-- لا فجوات: الرقم التالي دائمًا هو الأكبر + 1 داخل الكيان والنوع.
CREATE TRIGGER tax_invoices_gapless BEFORE UPDATE OF sequence ON tax_invoices
WHEN NEW.sequence IS NOT NULL AND NEW.sequence<>COALESCE((SELECT MAX(sequence) FROM tax_invoices WHERE tenant_id=NEW.tenant_id AND kind=NEW.kind),0)+1
BEGIN SELECT RAISE(ABORT,'tax document numbers are sequential without gaps'); END;

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

-- كل مستند يصدر يدخل الأرشيف والطابور بالمحفّز نفسه، فلا يفلت مستند من أيهما. والنسخة المؤرشفة
-- تحمل الآن رموز المستند الثلاثة إلى جانب ما كانت تحمله، وسطورها تحمل رمز وحدتها.
CREATE TRIGGER einvoice_issue_archives AFTER UPDATE OF status ON tax_invoices
WHEN NEW.status='issued' AND OLD.status<>'issued'
BEGIN
  INSERT INTO einvoice_archive(document_id,tenant_id,kind,original_document_id,number,sequence,chain_index,issued_at,format,payload,previous_hash,document_hash,qr_tlv,archived_at)
  VALUES(NEW.id,NEW.tenant_id,NEW.kind,NEW.original_invoice_id,NEW.number,NEW.sequence,NEW.chain_index,NEW.issued_at,'platform-json-v1',
    json_object('id',NEW.id,'kind',NEW.kind,'number',NEW.number,'issued_at',NEW.issued_at,'supply_date',NEW.supply_date,
      'seller',json(NEW.seller),'buyer',json(NEW.buyer),'lines',json(NEW.lines),
      'vat_category',NEW.vat_category,'vat_basis_points',NEW.vat_basis_points,'vat_reason',NEW.vat_reason,'currency',NEW.currency,
      'document_type_code',NEW.document_type_code,'tax_category_code',NEW.tax_category_code,'payment_means_code',NEW.payment_means_code,
      'net_minor',NEW.net_minor,'vat_minor',NEW.vat_minor,'total_minor',NEW.total_minor,
      'original_invoice_id',NEW.original_invoice_id,'previous_hash',COALESCE(NEW.previous_hash,''),'hash',NEW.hash,'qr_tlv',NEW.qr_tlv),
    COALESCE(NEW.previous_hash,''),NEW.hash,NEW.qr_tlv,NEW.updated_at);
  INSERT INTO einvoice_submissions(id,tenant_id,document_id,status,reason,created_at,updated_at)
  VALUES(lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
    NEW.tenant_id,NEW.id,'queued','غير مربوط: لم تُحدد قناة الإرسال بعد، ولم يُرسل شيء إلى أي جهة.',NEW.updated_at,NEW.updated_at);
END;

-- ٦) رمز الوحدة لكل سطر: لا يُقبل مستند جديد بسطر بلا رمز وحدة. القيد لا يُكتب CHECK لأن CHECK لا يقبل
-- استعلامًا فرعيًا، والمحفّز يقبله. ويسري على الإدراج وحده: مستندٌ سبق هذا الترحيل سطوره في أرشيفه
-- المجمَّد كما صدرت، فلا يُعاد كتابتها هنا.
CREATE TRIGGER tax_invoices_line_unit_code BEFORE INSERT ON tax_invoices
WHEN EXISTS(SELECT 1 FROM json_each(NEW.lines) WHERE json_extract(value,'$.unit_code') IS NULL)
BEGIN SELECT RAISE(ABORT,'every tax document line carries a unit code'); END;

-- ٧) المحفّزات التابعة تعود بنصّها بعد أن صار الجدول موجودًا باسمه.
-- لا تُغلق المسودة إلا بفاتورة أصدرها شخص فعلًا في tax_invoices؛ الأتمتة لا تصدر ولا تُسند إصدارًا لم يقع.
CREATE TRIGGER billing_drafts_human_issue BEFORE UPDATE ON billing_drafts
WHEN NEW.issued_invoice_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM tax_invoices WHERE id=NEW.issued_invoice_id AND tenant_id=NEW.tenant_id AND kind='invoice' AND status='issued')
BEGIN SELECT RAISE(ABORT,'a draft closes only against an invoice a person actually issued'); END;

-- الفوترة المتكررة: المسودة لا تُربط إلا بفاتورة لعميلها نفسه (فاتورة ← مطالبة ← سجل تجاري ← ربط العميل).
CREATE TRIGGER billing_drafts_invoice_same_client BEFORE UPDATE ON billing_drafts
WHEN NEW.issued_invoice_id IS NOT NULL AND NEW.issued_invoice_id IS NOT OLD.issued_invoice_id AND NOT EXISTS(
  SELECT 1 FROM tax_invoices i JOIN ar_claims c ON c.id=i.claim_id JOIN client_links l ON l.case_id=c.case_id
  WHERE i.id=NEW.issued_invoice_id AND i.tenant_id=NEW.tenant_id AND l.client_id=NEW.client_id)
BEGIN SELECT RAISE(ABORT,'a billing draft is linked only to an invoice issued to its own client'); END;

CREATE TRIGGER einvoice_archive_issued_only BEFORE INSERT ON einvoice_archive
WHEN NOT EXISTS(SELECT 1 FROM tax_invoices WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND status='issued' AND hash=NEW.document_hash AND number=NEW.number)
BEGIN SELECT RAISE(ABORT,'the archive stores an issued document exactly as issued'); END;

CREATE TRIGGER einvoice_submission_issued_only BEFORE INSERT ON einvoice_submissions
WHEN NEW.status<>'queued' OR NEW.attempts<>0 OR NEW.version<>1 OR NEW.channel IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM tax_invoices WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND status='issued')
BEGIN SELECT RAISE(ABORT,'a submission starts queued and unsent for an issued document only'); END;

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
