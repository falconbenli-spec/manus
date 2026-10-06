-- ترحيل 183 — بوابات الاستحقاق (الحزمة 4، P4-CRM-4).
--
-- العطب، مقيسًا لا مستنتجًا:
--   (1) جدول دفعات الصفقة (case_payment_terms، الترحيل 116) يحمل لكل بند «شرطًا» نصًّا حرًّا («عند قبول المخرجات») ولا يعرف أي
--       بند من الاتفاق يفتح الدفعة، ولا يُقاس عليه الاستحقاق: الاستحقاق يُنشأ من مخرج مقبول حتى قيمة بنده، مهما قال الجدول.
--   (2) أمر شراء العميل المؤكد (الترحيل 160) شرطٌ للبدء وحده: الاستحقاقات على الصفقة تتجاوزه بلا رفض، ورقمه لا يصل الاستحقاق
--       ولا الفاتورة، فيردّ العميل فاتورةً بلا رقم أمر شرائه أو فوق قيمته.
--   (3) الأساس 'advance' في ar_claims (الترحيل 012) موجود في المخطط ولا يكتبه أي مسار.
--
-- ما يغيّره:
--   ١. لكل بند في الجدول نوع شرطه (condition_kind): 'advance' دفعة مقدمة تحل بتوثيق الاتفاق، أو 'acceptance' تحل بقبول بنود بعينها
--      من الاتفاق (condition_lines: أرقام البنود من صفر). البنود القائمة قبل هذا الترحيل تبقى بلا نوع (NULL) ولا يُخترع لها شرط لم
--      يكتبه أحد؛ والجديد يُكتب بنوعه، والبند الواحد من الاتفاق شرطٌ لبند دفع واحد على الأكثر، والمجموع لا يتجاوز الاتفاق.
--   ٢. ar_claim_terms: كل استحقاق على صفقة بجدول بشروط يسمّي بنده — ويُكتب الربط مع الاستحقاق نفسه لا بعده (المفتاح الأجنبي مؤجّل
--      إلى نهاية المعاملة، فيُكتب الربط أولًا ثم الاستحقاق الذي يقرؤه حارسه). ويحمل نسخة أمر شراء العميل التي نشأ تحتها ورقمها.
--   ٣. حارسان على كتابة الاستحقاق: (أ) الجدول بشروط: البند المسمّى من الصفقة نفسها، وأساس الاستحقاق نوع شرطه، ومخرج القبول من
--      بنوده، وكل بنوده مقبولة، والمجموع الحي عليه لا يتجاوزه، ومجموع الصفقة لا يتجاوز جدولها. (ب) أمر الشراء: آخر نسخة مؤكدة
--      من أمر شراء الصفقة سقفٌ لمجموع استحقاقاتها الحية؛ والجدول الذي يشترط أمرًا لا يُستحق عليه إلا تحت آخر نسخة مؤكدة سارية يوم
--      كتابة الاستحقاق (يوم الرياض من created_at الذي يكتبه الكود — لا ساعة في SQL).
--   ٤. مبلغ الاستحقاق المحروس بالبند أو بأمر الشراء ثابت؛ التصحيح إلغاء واستحقاق جديد.
--
-- لا إعادة بناء ولا نقل صفوف: عمودان يُضافان بقيمة افتراضية، وجدول جديد فارغ، ومُطلِقات تحرس ما يُكتب من الآن. الاستحقاقات القائمة
-- تبقى بلا ربط، وقيد قيدها لا يتغير. والقرار D3 (البوابة وحدها: لا فوترة لغير المخرجات بعد) في الكود (app/invoices.mjs)، لأن صفوف
-- اختبارات قائمة تكتب استحقاقات «advance» وفواتيرها مباشرةً سقالةً لبياناتها.

/* ───── ١. شرط كل بند في جدول الدفعات بنوعه ───── */
ALTER TABLE case_payment_terms ADD COLUMN condition_kind TEXT CHECK(condition_kind IS NULL OR condition_kind IN ('advance','acceptance'));
ALTER TABLE case_payment_terms ADD COLUMN condition_lines TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(condition_lines) AND json_type(condition_lines)='array');

-- بنود الاتفاق تُعدّ من لقطة الاتفاق إن وُثّق، وإلا من العرض المعتمد الحالي (الجدول يُسجَّل من «عرض معتمد» في الكود).
CREATE TRIGGER case_payment_terms_typed BEFORE INSERT ON case_payment_terms
WHEN NEW.condition_kind IS NULL
  OR (NEW.condition_kind='advance')<>(NEW.is_advance=1)
  OR (NEW.condition_kind='advance' AND json_array_length(NEW.condition_lines)>0)
  OR (NEW.condition_kind='acceptance' AND json_array_length(NEW.condition_lines)=0)
  OR EXISTS(SELECT 1 FROM json_each(NEW.condition_lines) j WHERE j.type<>'integer' OR j.value<0
       OR j.value>=COALESCE(json_array_length((SELECT k.snapshot FROM commercial_contracts k WHERE k.case_id=NEW.case_id),'$.lines'),
                            json_array_length((SELECT q.snapshot FROM commercial_quotes q JOIN commercial_cases c ON c.current_quote_id=q.id WHERE c.id=NEW.case_id),'$.lines'),0))
  OR (SELECT COUNT(*) FROM json_each(NEW.condition_lines))<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.condition_lines))
  OR EXISTS(SELECT 1 FROM case_payment_terms t, json_each(t.condition_lines) a, json_each(NEW.condition_lines) b WHERE t.case_id=NEW.case_id AND a.value=b.value)
  OR (SELECT COALESCE(SUM(amount_minor),0) FROM case_payment_terms WHERE case_id=NEW.case_id)+NEW.amount_minor
     >COALESCE((SELECT CAST(json_extract(k.snapshot,'$.total_minor') AS INTEGER) FROM commercial_contracts k WHERE k.case_id=NEW.case_id),
               (SELECT CAST(json_extract(q.snapshot,'$.total_minor') AS INTEGER) FROM commercial_quotes q JOIN commercial_cases c ON c.current_quote_id=q.id WHERE c.id=NEW.case_id),0)
BEGIN SELECT RAISE(ABORT,'a payment term recorded from migration 183 on names its condition kind, its own lines of the agreement, and stays within the agreement'); END;

/* ───── ٢. الاستحقاق يسمّي بنده من الجدول، ونسخة أمر الشراء التي نشأ تحتها ───── */
CREATE TABLE ar_claim_terms (
  claim_id TEXT PRIMARY KEY REFERENCES ar_claims(id) DEFERRABLE INITIALLY DEFERRED,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL REFERENCES commercial_cases(id),
  term_id TEXT NOT NULL REFERENCES case_payment_terms(id),
  client_po_id TEXT REFERENCES client_purchase_orders(id),
  client_po_number TEXT,
  client_po_revision INTEGER,
  created_at TEXT NOT NULL,
  CHECK((client_po_id IS NULL)=(client_po_number IS NULL) AND (client_po_id IS NULL)=(client_po_revision IS NULL))
) STRICT;
CREATE INDEX ar_claim_terms_term ON ar_claim_terms(term_id);
CREATE INDEX ar_claim_terms_case ON ar_claim_terms(case_id);

-- الربط يُكتب مع استحقاقه لا بعده (فلا يُنسب استحقاق قديم إلى بند بأثر رجعي يتخطى السقف)، على بند بنوعه من الصفقة نفسها،
-- وأمر الشراء المسمّى آخر نسخة مؤكدة في الصفقة برقمها ونسختها كما هما.
CREATE TRIGGER ar_claim_terms_source BEFORE INSERT ON ar_claim_terms
WHEN EXISTS(SELECT 1 FROM ar_claims WHERE id=NEW.claim_id)
  OR NOT EXISTS(SELECT 1 FROM case_payment_terms t JOIN commercial_cases c ON c.id=t.case_id
    WHERE t.id=NEW.term_id AND t.case_id=NEW.case_id AND t.tenant_id=NEW.tenant_id AND c.tenant_id=NEW.tenant_id AND t.condition_kind IS NOT NULL)
  OR (NEW.client_po_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM client_purchase_orders o
    WHERE o.id=NEW.client_po_id AND o.case_id=NEW.case_id AND o.tenant_id=NEW.tenant_id AND o.status='confirmed'
      AND o.po_number=NEW.client_po_number AND o.revision=NEW.client_po_revision
      AND o.revision=(SELECT MAX(revision) FROM client_purchase_orders WHERE case_id=NEW.case_id)))
BEGIN SELECT RAISE(ABORT,'a claim-term link is written with its claim, on a typed term of the same deal, naming the latest confirmed client purchase order as it is'); END;
CREATE TRIGGER ar_claim_terms_no_update BEFORE UPDATE ON ar_claim_terms BEGIN SELECT RAISE(ABORT,'a claim-term link is retained as written'); END;
CREATE TRIGGER ar_claim_terms_no_delete BEFORE DELETE ON ar_claim_terms BEGIN SELECT RAISE(ABORT,'a claim-term link is retained as written'); END;

/* ───── ٣. الحارسان على كتابة الاستحقاق ───── */
-- (أ) صفقة بجدول بشروط: الاستحقاق يسمّي بنده، وأساسه نوع الشرط، ومخرجه من بنود الشرط وكلها مقبولة، ويبقى داخل البند وداخل الجدول.
-- «الحي» كل استحقاق غير مرفوض ولا ملغى: المسودة والمعلّق والمعتمد كلها تحجز من البند، والإلغاء وحده يعيد مكانه.
CREATE TRIGGER ar_claims_term_gate BEFORE INSERT ON ar_claims
WHEN EXISTS(SELECT 1 FROM case_payment_terms WHERE case_id=NEW.case_id AND condition_kind IS NOT NULL)
 AND NOT EXISTS(
   SELECT 1 FROM ar_claim_terms x JOIN case_payment_terms t ON t.id=x.term_id
   WHERE x.claim_id=NEW.id AND x.case_id=NEW.case_id AND x.tenant_id=NEW.tenant_id AND t.case_id=NEW.case_id AND t.currency=NEW.currency
     AND ((NEW.basis='advance' AND t.condition_kind='advance')
       OR (NEW.basis='delivery' AND t.condition_kind='acceptance'
         AND EXISTS(SELECT 1 FROM commercial_deliveries d, json_each(t.condition_lines) j WHERE d.id=NEW.delivery_id AND d.case_id=NEW.case_id AND j.value=d.line_index)
         AND NOT EXISTS(SELECT 1 FROM json_each(t.condition_lines) j WHERE NOT EXISTS(
           SELECT 1 FROM commercial_deliveries d JOIN commercial_reviews r ON r.subject_id=d.id AND r.kind='delivery' AND r.status='approved'
           WHERE d.case_id=NEW.case_id AND d.line_index=j.value))))
     AND (SELECT COALESCE(SUM(CAST(c.amount_minor AS INTEGER)),0) FROM ar_claim_terms y JOIN ar_claims c ON c.id=y.claim_id
          WHERE y.term_id=t.id AND c.status NOT IN ('rejected','cancelled'))+CAST(NEW.amount_minor AS INTEGER)<=t.amount_minor
     AND (SELECT COALESCE(SUM(CAST(c.amount_minor AS INTEGER)),0) FROM ar_claims c WHERE c.case_id=NEW.case_id AND c.status NOT IN ('rejected','cancelled'))+CAST(NEW.amount_minor AS INTEGER)
          <=(SELECT SUM(amount_minor) FROM case_payment_terms WHERE case_id=NEW.case_id))
BEGIN SELECT RAISE(ABORT,'a claim on a typed payment schedule names its term, meets its condition and stays within the term and the schedule'); END;

-- (ب) أمر شراء العميل: آخر نسخة مؤكدة سقفٌ لمجموع الاستحقاقات الحية على الصفقة، أيًّا كان جدولها. والجدول الذي يشترط أمرًا لا يُستحق
-- عليه إلا تحت آخر نسخة مؤكدة سارية يوم كتابة الاستحقاق، ورقمها في الربط.
CREATE TRIGGER ar_claims_client_po_gate BEFORE INSERT ON ar_claims
WHEN (EXISTS(SELECT 1 FROM case_payment_terms WHERE case_id=NEW.case_id AND condition_kind IS NOT NULL AND requires_client_po=1)
    AND NOT EXISTS(SELECT 1 FROM ar_claim_terms x JOIN client_purchase_orders o ON o.id=x.client_po_id
      WHERE x.claim_id=NEW.id AND o.case_id=NEW.case_id AND o.status='confirmed'
        AND o.revision=(SELECT MAX(revision) FROM client_purchase_orders WHERE case_id=NEW.case_id)
        AND (o.valid_until IS NULL OR o.valid_until>=date(NEW.created_at,'+3 hours'))))
  OR EXISTS(SELECT 1 FROM client_purchase_orders o WHERE o.case_id=NEW.case_id AND o.status='confirmed'
    AND o.revision=(SELECT MAX(revision) FROM client_purchase_orders WHERE case_id=NEW.case_id)
    AND (SELECT COALESCE(SUM(CAST(c.amount_minor AS INTEGER)),0) FROM ar_claims c WHERE c.case_id=NEW.case_id AND c.status NOT IN ('rejected','cancelled'))+CAST(NEW.amount_minor AS INTEGER)>o.amount_minor)
BEGIN SELECT RAISE(ABORT,'a claim never exceeds the latest confirmed client purchase order of its deal, and a deal whose schedule requires one claims only under it'); END;

-- ٤. مبلغ الاستحقاق الذي يحرسه بنده أو أمر شراء صفقته ثابت حتى وهو مسودة (مُطلِق 012 يسمح بتعديل المسودة، والكود لا يعدّلها).
CREATE TRIGGER ar_claims_gated_amount_fixed BEFORE UPDATE OF amount_minor ON ar_claims
WHEN NEW.amount_minor<>OLD.amount_minor
  AND (EXISTS(SELECT 1 FROM ar_claim_terms WHERE claim_id=OLD.id) OR EXISTS(SELECT 1 FROM client_purchase_orders WHERE case_id=OLD.case_id AND status='confirmed'))
BEGIN SELECT RAISE(ABORT,'the amount of a claim held by its payment term or client purchase order is fixed; cancel it and raise another'); END;
