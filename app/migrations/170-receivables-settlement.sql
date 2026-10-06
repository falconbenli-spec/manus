-- ترحيل 170 — التحصيل والتسوية (الحزمة 3، عمق المالية): ارتداد القبض، وإلغاء الاستحقاق باعتماد مستقل، والنزاع والوعد
-- بالسداد، والقبض على حساب العميل وتخصيصه على استحقاقاته.
--
-- ما قاسه المسبار قبل الكتابة (docs/testing/p3-receivables-settlement-probe-20260930.txt) على رأس التكامل 3d1d84c:
--   (أ) ar_adjustments وar_disputes وar_promises جداول منذ الترحيل 012 ولا وحدة في app/ تكتب فيها ولا مسار يسمّيها،
--       فالقبض المرتد (شيك رجع، حوالة انعكست، قبض سُجّل خطأ) لا يُسجَّل أصلًا. والمخطط يسمح بقلب صف القبض إلى 'reversed'
--       بتعديل مباشر، لكن ذلك يُسقط القبض من أستاذه المساعد وقيده باقٍ في الدفتر: فرق 115.00 على ذمم العملاء «قيد بلا مستند».
--   (ب) استحقاقٌ معتمد مفوتر ومحصَّل يُلغى بتعديل مباشر لحالته، بلا اعتماد ثانٍ ولا فحص لما يقوم عليه.
--   (ج) القبض يعيش على استحقاق واحد فقط: حوالة واحدة لاستحقاقين تُرفض (المبلغ يتجاوز الأول، ومرجعها مستعمل للثاني)،
--       والدفعة التي تصل قبل استحقاقها لا مكان لها.
--
-- القرارات:
--   1) العكس سجلٌ جديد لا تعديل. صف القبض يبقى «مؤكدًا» كما وقع، والارتداد صفٌّ في ar_adjustments بتاريخ أثره في البنك
--      (effective_on) يعتمده ثالث: لا مسجّل القبض ولا مطابقه ولا طالب العكس. فيبقى لكل مستند قيده في الدفتر: القبض يخفض
--      الذمة، والارتداد يعيدها — والأستاذ المساعد يطابق الحساب الرقابي بعد السلسلة كلها.
--   2) الإلغاء صفٌّ في ar_adjustments يعتمده غير طالبه، ولا تنتقل حالة الاستحقاق إلى «ملغى» إلا بقرار معتمد مسجل،
--      ولا يُعتمد والقبض أو التخصيص أو الفاتورة (غير المصحَّحة بإشعار دائن) قائمة عليه.
--   3) القبض على الحساب (ar_account_receipts) مالٌ للعميل لم يُخصَّص بعد: يطابقه غير مسجّله، ثم يخصّصه على استحقاقات
--      العميل نفسه شخصٌ غير مسجّله (ar_allocations). التخصيص لا يُعدَّل ولا يُحذف؛ يُعكس بصفٍّ جديد يشير إليه مرة واحدة.
--   4) سقفٌ واحد لكل استحقاق: القبض المعلق، والمؤكد غير المرتد، والمخصص الحي، لا تتجاوز صافيه بعد الإشعارات الدائنة
--      الصادرة. يُحسب في منظور واحد (ar_claim_collection) تقرؤه الشيفرة وقيود هذا الترحيل وقائمة إقفال المشروع.
--
-- فُحص قبل الكتابة على قاعدة الاختبار: لا صف في ar_adjustments ولا ar_promises ولا ar_disputes يكتبه مسار في المنصة،
-- والقيود الجديدة على الإدراج (BEFORE INSERT) لا تعيد قراءة صف قائم، ومحفّز الإلغاء يحرس الانتقال إلى «ملغى» وحده.

/* ───── 1) تاريخ الأثر البنكي للارتداد ───── */
-- القبض المرتد يُقيَّد بتاريخ رجوعه في كشف البنك، لا بتاريخ اعتماد العكس: قد يُعتمد بعد أيام وفي شهر آخر.
ALTER TABLE ar_adjustments ADD COLUMN effective_on TEXT CHECK(effective_on IS NULL OR effective_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
CREATE INDEX ar_adjustments_claim ON ar_adjustments(claim_id,kind,status);

/* ───── 2) القبض على حساب العميل ───── */
CREATE TABLE ar_account_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL,
  reference TEXT NOT NULL CHECK(length(trim(reference))>=3),
  -- الدفتر بالريال، والفوترة بالريال وحدها (app/invoices.mjs currency_policy). قبضٌ بعملة أخرى على الحساب قرارُ سياسة صرف لم يُتخذ.
  currency TEXT NOT NULL CHECK(currency='SAR'),
  amount_minor TEXT NOT NULL CHECK(length(amount_minor) BETWEEN 1 AND 12 AND amount_minor NOT GLOB '*[^0-9]*' AND CAST(amount_minor AS INTEGER)>0),
  received_on TEXT NOT NULL CHECK(received_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  payer TEXT NOT NULL CHECK(length(trim(payer))>=3),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  recorded_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','rejected')),
  decided_by TEXT,
  decision_note TEXT,
  matching_evidence TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,reference),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(case_id,tenant_id) REFERENCES commercial_cases(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='pending')=(decided_by IS NULL) AND (decided_by IS NULL)=(decided_at IS NULL)
    AND (decided_by IS NULL)=(decision_note IS NULL) AND (decided_by IS NULL)=(matching_evidence IS NULL)),
  CHECK(decided_by IS NULL OR decided_by<>recorded_by)
) STRICT;
CREATE INDEX ar_account_receipts_case ON ar_account_receipts(tenant_id,case_id,status);
-- مرجع التحويل الواحد لا يُسجَّل مرتين في الكيان: لا على استحقاق وعلى الحساب معًا، ولا على الحساب مرتين (UNIQUE أعلاه).
CREATE TRIGGER ar_account_receipt_source BEFORE INSERT ON ar_account_receipts
WHEN NEW.status<>'pending'
  OR NOT EXISTS(SELECT 1 FROM commercial_contracts k JOIN commercial_cases c ON c.id=k.case_id WHERE c.id=NEW.case_id AND c.tenant_id=NEW.tenant_id)
  OR EXISTS(SELECT 1 FROM ar_receipts r WHERE r.tenant_id=NEW.tenant_id AND r.reference=NEW.reference)
BEGIN SELECT RAISE(ABORT,'an on-account receipt starts pending, for a contracted customer of its tenant, under a reference no other receipt uses'); END;
CREATE TRIGGER ar_account_receipt_decision BEFORE UPDATE ON ar_account_receipts
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.case_id<>OLD.case_id OR NEW.reference<>OLD.reference OR NEW.currency<>OLD.currency
  OR NEW.amount_minor<>OLD.amount_minor OR NEW.received_on<>OLD.received_on OR NEW.payer<>OLD.payer OR NEW.evidence<>OLD.evidence
  OR NEW.recorded_by<>OLD.recorded_by OR NEW.created_at<>OLD.created_at
  OR OLD.status<>'pending' OR NEW.status NOT IN ('confirmed','rejected')
  OR length(trim(NEW.decision_note))<3 OR length(trim(NEW.matching_evidence))<10
BEGIN SELECT RAISE(ABORT,'an on-account receipt keeps its evidence and is decided once, by someone other than its recorder'); END;
CREATE TRIGGER ar_account_receipts_no_delete BEFORE DELETE ON ar_account_receipts BEGIN SELECT RAISE(ABORT,'receipt history is immutable'); END;
CREATE TRIGGER ar_receipt_reference_once BEFORE INSERT ON ar_receipts
WHEN EXISTS(SELECT 1 FROM ar_account_receipts x WHERE x.tenant_id=NEW.tenant_id AND x.reference=NEW.reference)
BEGIN SELECT RAISE(ABORT,'a receipt reference is used once in its tenant, on a claim or on account'); END;

/* ───── 3) التخصيص وعكسه: سجل إلحاقي ───── */
CREATE TABLE ar_allocations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  account_receipt_id TEXT NOT NULL,
  claim_id TEXT NOT NULL REFERENCES ar_claims(id),
  kind TEXT NOT NULL CHECK(kind IN ('allocation','reversal')),
  reverses_id TEXT REFERENCES ar_allocations(id),
  amount_minor TEXT NOT NULL CHECK(length(amount_minor) BETWEEN 1 AND 12 AND amount_minor NOT GLOB '*[^0-9]*' AND CAST(amount_minor AS INTEGER)>0),
  note TEXT NOT NULL CHECK(length(trim(note))>=3),
  allocated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_receipt_id,tenant_id) REFERENCES ar_account_receipts(id,tenant_id),
  FOREIGN KEY(allocated_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((kind='allocation')=(reverses_id IS NULL))
) STRICT;
CREATE UNIQUE INDEX ar_allocation_reversed_once ON ar_allocations(reverses_id) WHERE reverses_id IS NOT NULL;
CREATE INDEX ar_allocations_claim ON ar_allocations(claim_id,kind);
CREATE INDEX ar_allocations_receipt ON ar_allocations(account_receipt_id,kind);

/* ───── 4) ارتداد القبض على الحساب ───── */
CREATE TABLE ar_account_reversals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  account_receipt_id TEXT NOT NULL,
  amount_minor TEXT NOT NULL CHECK(length(amount_minor) BETWEEN 1 AND 12 AND amount_minor NOT GLOB '*[^0-9]*' AND CAST(amount_minor AS INTEGER)>0),
  effective_on TEXT NOT NULL CHECK(effective_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=10),
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  decided_by TEXT,
  decision_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_receipt_id,tenant_id) REFERENCES ar_account_receipts(id,tenant_id),
  FOREIGN KEY(requested_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='pending')=(decided_by IS NULL) AND (decided_by IS NULL)=(decided_at IS NULL) AND (decided_by IS NULL)=(decision_note IS NULL)),
  CHECK(decided_by IS NULL OR decided_by<>requested_by)
) STRICT;
CREATE UNIQUE INDEX ar_account_reversal_pending ON ar_account_reversals(account_receipt_id) WHERE status='pending';
CREATE UNIQUE INDEX ar_account_reversal_approved ON ar_account_reversals(account_receipt_id) WHERE status='approved';

/* ───── 5) منظور التحصيل: سقفٌ واحد لكل استحقاق ───── */
-- net: قيمة الاستحقاق ناقص الإشعارات الدائنة الصادرة (لا تنزل تحت الصفر). received: المؤكد غير المرتد من القبض المباشر.
-- pending: المعلق بانتظار مطابقته. allocated: المخصص من القبض على الحساب ناقص ما عُكس منه.
CREATE VIEW ar_claim_collection AS
SELECT c.id AS claim_id,c.tenant_id,
  MAX(CAST(c.amount_minor AS INTEGER)-(SELECT COALESCE(SUM(t.total_minor),0) FROM tax_invoices t WHERE t.claim_id=c.id AND t.kind='credit_note' AND t.status='issued'),0) AS net_minor,
  (SELECT COALESCE(SUM(CAST(r.amount_minor AS INTEGER)),0) FROM ar_receipts r WHERE r.claim_id=c.id AND r.status='confirmed'
     AND NOT EXISTS(SELECT 1 FROM ar_adjustments a WHERE a.receipt_id=r.id AND a.kind='receipt_reversal' AND a.status='approved')) AS received_minor,
  (SELECT COALESCE(SUM(CAST(r.amount_minor AS INTEGER)),0) FROM ar_receipts r WHERE r.claim_id=c.id AND r.status='pending') AS pending_minor,
  (SELECT COALESCE(SUM(CASE x.kind WHEN 'allocation' THEN CAST(x.amount_minor AS INTEGER) ELSE -CAST(x.amount_minor AS INTEGER) END),0)
     FROM ar_allocations x WHERE x.claim_id=c.id) AS allocated_minor
FROM ar_claims c;

/* ───── 6) القيود ───── */
-- القبض المباشر لا يتجاوز الصافي مع ما خُصّص على الاستحقاق نفسه (الشيفرة ترفض قبل هذا برفض يسمّي الأرقام).
CREATE TRIGGER ar_receipt_ceiling BEFORE INSERT ON ar_receipts
WHEN (SELECT CAST(NEW.amount_minor AS INTEGER)+s.received_minor+s.pending_minor+s.allocated_minor-s.net_minor FROM ar_claim_collection s WHERE s.claim_id=NEW.claim_id)>0
BEGIN SELECT RAISE(ABORT,'receipts and allocations never exceed the claim net of issued credit notes'); END;

-- التخصيص: مالٌ مؤكد على الحساب، لعميل الاستحقاق نفسه، باستحقاق معتمد بالعملة نفسها، بلا ارتداد معلق أو معتمد على القبض،
-- ولا يتجاوز الباقي من القبض ولا صافي الاستحقاق — وصاحبه غير مسجّل القبض. والعكس يطابق تخصيصًا واحدًا بمبلغه مرة واحدة.
CREATE TRIGGER ar_allocation_guard BEFORE INSERT ON ar_allocations
WHEN NOT EXISTS(SELECT 1 FROM ar_account_receipts x WHERE x.id=NEW.account_receipt_id AND x.tenant_id=NEW.tenant_id AND x.status='confirmed' AND x.recorded_by<>NEW.allocated_by)
  OR (NEW.kind='allocation' AND (
       NOT EXISTS(SELECT 1 FROM ar_claims c JOIN ar_account_receipts x ON x.id=NEW.account_receipt_id
         WHERE c.id=NEW.claim_id AND c.tenant_id=NEW.tenant_id AND c.case_id=x.case_id AND c.status='approved' AND c.currency=x.currency)
       OR EXISTS(SELECT 1 FROM ar_account_reversals v WHERE v.account_receipt_id=NEW.account_receipt_id AND v.status IN ('pending','approved'))
       OR CAST(NEW.amount_minor AS INTEGER)+(SELECT COALESCE(SUM(CASE y.kind WHEN 'allocation' THEN CAST(y.amount_minor AS INTEGER) ELSE -CAST(y.amount_minor AS INTEGER) END),0)
            FROM ar_allocations y WHERE y.account_receipt_id=NEW.account_receipt_id)
          >(SELECT CAST(x.amount_minor AS INTEGER) FROM ar_account_receipts x WHERE x.id=NEW.account_receipt_id)
       OR (SELECT CAST(NEW.amount_minor AS INTEGER)+s.received_minor+s.pending_minor+s.allocated_minor-s.net_minor FROM ar_claim_collection s WHERE s.claim_id=NEW.claim_id)>0))
  OR (NEW.kind='reversal' AND NOT EXISTS(SELECT 1 FROM ar_allocations o WHERE o.id=NEW.reverses_id AND o.kind='allocation'
       AND o.account_receipt_id=NEW.account_receipt_id AND o.claim_id=NEW.claim_id AND o.amount_minor=NEW.amount_minor))
BEGIN SELECT RAISE(ABORT,'an allocation spends confirmed on-account cash of the same customer within the receipt and the claim net, by someone other than its recorder; a reversal mirrors one allocation once'); END;
CREATE TRIGGER ar_allocations_no_update BEFORE UPDATE ON ar_allocations BEGIN SELECT RAISE(ABORT,'allocations are append-only; reverse one with a new record'); END;
CREATE TRIGGER ar_allocations_no_delete BEFORE DELETE ON ar_allocations BEGIN SELECT RAISE(ABORT,'allocations are append-only; reverse one with a new record'); END;

-- طلب التسوية: يبدأ معلقًا بسببه ودليله، من حساب في كيان الاستحقاق. العكس لقبضٍ مؤكد كامل على استحقاقه، بتاريخ في البنك
-- لا يسبق القبض؛ والإلغاء لاستحقاق مسودة أو معتمد.
CREATE TRIGGER ar_adjustment_request BEFORE INSERT ON ar_adjustments
WHEN NEW.status<>'pending' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_note IS NOT NULL
  OR length(trim(NEW.reason))<10 OR length(trim(NEW.evidence))<10
  OR NOT EXISTS(SELECT 1 FROM ar_claims c JOIN users x ON x.id=NEW.requested_by AND x.tenant_id=c.tenant_id WHERE c.id=NEW.claim_id)
  OR (NEW.kind='receipt_reversal' AND (NEW.effective_on IS NULL OR NOT EXISTS(SELECT 1 FROM ar_receipts r WHERE r.id=NEW.receipt_id AND r.claim_id=NEW.claim_id
       AND r.status='confirmed' AND r.amount_minor=NEW.amount_minor AND NEW.effective_on>=r.received_on)))
  OR (NEW.kind='claim_cancel' AND (NEW.effective_on IS NOT NULL OR NOT EXISTS(SELECT 1 FROM ar_claims c WHERE c.id=NEW.claim_id AND c.status IN ('draft','approved'))))
BEGIN SELECT RAISE(ABORT,'an adjustment starts pending with its reason and evidence: the reversal of a whole confirmed receipt dated in the bank, or the cancellation of an open claim'); END;
CREATE TRIGGER ar_adjustment_effective_fixed BEFORE UPDATE ON ar_adjustments
WHEN NEW.effective_on IS NOT OLD.effective_on
BEGIN SELECT RAISE(ABORT,'adjustments require a final independent decision'); END;
-- القرار: من كيان الاستحقاق. عكس القبض لا يعتمده مسجّله ولا مطابقه (وطالب العكس يمنعه ar_adjustment_identity).
-- والإلغاء لا يُعتمد وقبضٌ قائم أو معلق أو تخصيص حي عليه، ولا مستند ضريبي معلق، ولا فاتورة صادرة ما صُحّحت كاملة بإشعار دائن.
CREATE TRIGGER ar_adjustment_decision_guard BEFORE UPDATE ON ar_adjustments
WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected') AND (
  NOT EXISTS(SELECT 1 FROM ar_claims c JOIN users x ON x.id=NEW.decided_by AND x.tenant_id=c.tenant_id WHERE c.id=NEW.claim_id)
  OR (NEW.status='approved' AND NEW.kind='receipt_reversal' AND EXISTS(SELECT 1 FROM ar_receipts r WHERE r.id=NEW.receipt_id AND (r.status<>'confirmed' OR r.recorded_by=NEW.decided_by
       OR EXISTS(SELECT 1 FROM ar_receipt_decisions d WHERE d.receipt_id=r.id AND d.actor_id=NEW.decided_by))))
  OR (NEW.status='approved' AND NEW.kind='claim_cancel' AND (
       EXISTS(SELECT 1 FROM ar_claim_collection s WHERE s.claim_id=NEW.claim_id AND s.received_minor+s.pending_minor+s.allocated_minor>0)
       OR EXISTS(SELECT 1 FROM tax_invoices t WHERE t.claim_id=NEW.claim_id AND t.status IN ('draft','pending'))
       OR (SELECT COALESCE(SUM(CASE t.kind WHEN 'invoice' THEN t.total_minor ELSE -t.total_minor END),0) FROM tax_invoices t WHERE t.claim_id=NEW.claim_id AND t.status='issued')>0)))
BEGIN SELECT RAISE(ABORT,'an adjustment is decided independently inside its tenant: never by its requester, a reversal by neither the recorder nor the matcher, a cancellation only when nothing stands on the claim'); END;
CREATE TRIGGER ar_claim_cancel_decided BEFORE UPDATE OF status ON ar_claims
WHEN NEW.status='cancelled' AND OLD.status<>'cancelled'
  AND NOT EXISTS(SELECT 1 FROM ar_adjustments a WHERE a.claim_id=NEW.id AND a.kind='claim_cancel' AND a.status='approved')
BEGIN SELECT RAISE(ABORT,'a claim is cancelled only through an approved, independently decided cancellation'); END;

-- ارتداد القبض على الحساب: لقبض مؤكد بمبلغه كاملًا، بتاريخ لا يسبقه، ولا تخصيص حي عليه (يُعكس التخصيص أولًا فتعود ذمته).
-- ويعتمده غير طالبه (CHECK أعلاه) وغير مسجّل القبض ومطابقه، وقراره نهائي.
CREATE TRIGGER ar_account_reversal_request BEFORE INSERT ON ar_account_reversals
WHEN NEW.status<>'pending'
  OR NOT EXISTS(SELECT 1 FROM ar_account_receipts x WHERE x.id=NEW.account_receipt_id AND x.tenant_id=NEW.tenant_id AND x.status='confirmed'
       AND x.amount_minor=NEW.amount_minor AND NEW.effective_on>=x.received_on)
  OR EXISTS(SELECT 1 FROM ar_allocations y WHERE y.account_receipt_id=NEW.account_receipt_id AND y.kind='allocation'
       AND NOT EXISTS(SELECT 1 FROM ar_allocations z WHERE z.reverses_id=y.id))
BEGIN SELECT RAISE(ABORT,'an on-account reversal is requested for a whole confirmed receipt with no live allocation, dated on or after it'); END;
CREATE TRIGGER ar_account_reversal_decision BEFORE UPDATE ON ar_account_reversals
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.account_receipt_id<>OLD.account_receipt_id OR NEW.amount_minor<>OLD.amount_minor
  OR NEW.effective_on<>OLD.effective_on OR NEW.reason<>OLD.reason OR NEW.evidence<>OLD.evidence OR NEW.requested_by<>OLD.requested_by OR NEW.created_at<>OLD.created_at
  OR OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR length(trim(NEW.decision_note))<3
  OR (NEW.status='approved' AND (
       EXISTS(SELECT 1 FROM ar_account_receipts x WHERE x.id=NEW.account_receipt_id AND (x.recorded_by=NEW.decided_by OR x.decided_by=NEW.decided_by))
       OR EXISTS(SELECT 1 FROM ar_allocations y WHERE y.account_receipt_id=NEW.account_receipt_id AND y.kind='allocation'
            AND NOT EXISTS(SELECT 1 FROM ar_allocations z WHERE z.reverses_id=y.id))))
BEGIN SELECT RAISE(ABORT,'an on-account reversal is decided once, by neither its requester nor the recorder or matcher, with no live allocation left'); END;
CREATE TRIGGER ar_account_reversals_no_delete BEFORE DELETE ON ar_account_reversals BEGIN SELECT RAISE(ABORT,'adjustment history is immutable'); END;

-- النزاع يُفتح على استحقاق معتمد بمبلغه وسببه ودليله، ويُحسم لاحقًا بمستقل (ar_dispute_identity، الترحيل 012).
CREATE TRIGGER ar_dispute_open BEFORE INSERT ON ar_disputes
WHEN NEW.resolved_at IS NOT NULL OR NEW.resolved_by IS NOT NULL OR NEW.resolution_note IS NOT NULL OR NEW.resolution_evidence IS NOT NULL
  OR NOT (length(NEW.amount_minor) BETWEEN 1 AND 12 AND NEW.amount_minor NOT GLOB '*[^0-9]*' AND CAST(NEW.amount_minor AS INTEGER)>0)
  OR length(trim(NEW.reason))<10 OR length(trim(NEW.evidence))<10
  OR NOT EXISTS(SELECT 1 FROM ar_claims c JOIN users x ON x.id=NEW.opened_by AND x.tenant_id=c.tenant_id WHERE c.id=NEW.claim_id AND c.status='approved')
BEGIN SELECT RAISE(ABORT,'a dispute opens on an approved claim of its tenant with an amount, a reason and evidence'); END;
-- الوعد بالسداد: مبلغ، وتاريخ لا يسبق يوم الوعد، ومن وعد، ودليله — على استحقاق معتمد. الوعد لا يُعدَّل ولا يُحذف (012).
CREATE TRIGGER ar_promise_record BEFORE INSERT ON ar_promises
WHEN NOT (length(NEW.amount_minor) BETWEEN 1 AND 12 AND NEW.amount_minor NOT GLOB '*[^0-9]*' AND CAST(NEW.amount_minor AS INTEGER)>0)
  OR NEW.promised_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR NEW.promised_on<substr(NEW.created_at,1,10)
  OR length(trim(NEW.contact))<3 OR length(trim(NEW.evidence))<10
  OR NOT EXISTS(SELECT 1 FROM ar_claims c JOIN users x ON x.id=NEW.recorded_by AND x.tenant_id=c.tenant_id WHERE c.id=NEW.claim_id AND c.status='approved')
BEGIN SELECT RAISE(ABORT,'a promise to pay names an amount, a date on or after the day it was made, who promised and the evidence, on an approved claim'); END;
CREATE INDEX ar_promises_claim ON ar_promises(claim_id,promised_on);
