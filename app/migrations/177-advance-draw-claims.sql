-- ترحيل 177 — سحب الدفعة المقدمة يُحتسب تحصيلًا على استحقاقه (الحزمة 3).
--
-- العطب، مقيسًا لا مستنتجًا: السحب من دفعة العميل المقدمة (advance_draws) يسمّي فاتورته نصًّا حرًّا (target_reference)،
-- وقيده في الدفتر (نوع المصدر advance_draw، الترحيل 167) يقيد سُلَف العملاء مدينًا والذمم المدينة دائنًا — فيسدّد الذمة في
-- الدفتر. لكن منظور التحصيل الواحد ar_claim_collection (الترحيل 170)، الذي تقرؤه شاشة المستحقات وأعمار الذمم (R31) ونبض
-- الشركة (R01) والتنبؤ النقدي وقائمة إقفال المشروع وطابور الاستثناءات وقوادح القاعدة نفسها، لا يرى السحب أبدًا: الاستحقاق
-- يبقى «غير محصَّل» بمبلغ غطّته الدفعة المقدمة، فيُطالَب العميل به، ويقبل قادح القبض (ar_receipt_ceiling) قبضًا ثانيًا عليه
-- حتى صافيه كاملًا — تحصيلٌ مكرر — ويظهر في المطابقة الرقابية فرقٌ بين رصيد الذمم في الدفتر ومجموع الاستحقاقات.
--
-- ما يغيّره:
--   (1) advance_draws.claim_id: الاستحقاق الذي يسدّده السحب، بإحالة حقيقية. يُضاف عمودًا (ADD COLUMN) لا بإعادة بناء الجدول،
--       فلا صفّ يُنسخ ولا قادح يُعاد. ويُثبَّت عند التخطيط ولا يتبدل بعده.
--   (2) السحوبات القائمة تُربط حين يطابق نصّها رقمَ فاتورة صادرة واحدة حرفيًا، لاستحقاقٍ من الملف التجاري نفسه للدفعة
--       (أو لعميلها بربطه) وبعملتها. ما لا يطابق يبقى بلا ربط ولا يُخمَّن: يبقى كما كان، ويظهر فرقه في المطابقة الرقابية.
--   (3) المنظور يُعاد بالتعريف نفسه، وallocated_minor صار «المال المقبوض سابقًا والمطبَّق على هذا الاستحقاق»: التخصيص من القبض
--       على الحساب ناقص ما عُكس منه، **والمسحوب من الدفعات المقدمة المربوطة به**. فكل قارئ وكل قادح يرى السحب بلا تعديل واحد
--       فيه — القرّاء الذين وحّدتهم الحزمة 3 على هذا المنظور لا يتفرقون من جديد. وdrawn_minor عمودٌ للعرض وحده (منه كذا سحبًا).
--   (4) قادحان: الربط صحيح عند التخطيط (استحقاق معتمد، العميل نفسه، العملة نفسها) ولا يتبدل؛ والسحب المطبَّق لا يتجاوز ما بقي
--       على الاستحقاق بعد المقبوض والمعلق والمخصص — الحارس الأخير في القاعدة، والشيفرة ترفض قبله برفض يسمّي الأرقام.
--
-- لماذا لا يُعاد بناء القوادح الثلاثة التي تقرأ المنظور (ar_receipt_ceiling وar_allocation_guard وar_adjustment_decision_guard):
-- تقرأ allocated_minor بالاسم، فتراه بمعناه الجديد عند أول تنفيذ. وفُحص sqlite_master قبل الكتابة: لا منظور ولا جدول آخر يحيل إليه.

ALTER TABLE advance_draws ADD COLUMN claim_id TEXT REFERENCES ar_claims(id);

-- (2) الربط الحرفي للسحوبات القائمة. قادح advance_draws_versioned يشترط زيادة النسخة مع كل تعديل.
UPDATE advance_draws SET claim_id=(
    SELECT t.claim_id FROM tax_invoices t JOIN ar_claims c ON c.id=t.claim_id JOIN advance_invoices a ON a.id=advance_draws.advance_id
    WHERE t.tenant_id=advance_draws.tenant_id AND t.kind='invoice' AND t.status='issued' AND t.number=trim(advance_draws.target_reference)
      AND c.currency=a.currency AND (c.case_id=a.case_id OR (a.case_id IS NULL AND EXISTS(SELECT 1 FROM client_links l WHERE l.client_id=a.client_id AND l.case_id=c.case_id)))),
  version=version+1
WHERE claim_id IS NULL AND (
    SELECT COUNT(*) FROM tax_invoices t JOIN ar_claims c ON c.id=t.claim_id JOIN advance_invoices a ON a.id=advance_draws.advance_id
    WHERE t.tenant_id=advance_draws.tenant_id AND t.kind='invoice' AND t.status='issued' AND t.number=trim(advance_draws.target_reference)
      AND c.currency=a.currency AND (c.case_id=a.case_id OR (a.case_id IS NULL AND EXISTS(SELECT 1 FROM client_links l WHERE l.client_id=a.client_id AND l.case_id=c.case_id))))=1;

CREATE INDEX advance_draws_claim ON advance_draws(claim_id) WHERE claim_id IS NOT NULL;

-- (3) المنظور بالتعريف نفسه، والمسحوب المربوط ضمن «المطبَّق».
DROP VIEW ar_claim_collection;
CREATE VIEW ar_claim_collection AS
SELECT c.id AS claim_id,c.tenant_id,
  MAX(CAST(c.amount_minor AS INTEGER)-(SELECT COALESCE(SUM(t.total_minor),0) FROM tax_invoices t WHERE t.claim_id=c.id AND t.kind='credit_note' AND t.status='issued'),0) AS net_minor,
  (SELECT COALESCE(SUM(CAST(r.amount_minor AS INTEGER)),0) FROM ar_receipts r WHERE r.claim_id=c.id AND r.status='confirmed'
     AND NOT EXISTS(SELECT 1 FROM ar_adjustments a WHERE a.receipt_id=r.id AND a.kind='receipt_reversal' AND a.status='approved')) AS received_minor,
  (SELECT COALESCE(SUM(CAST(r.amount_minor AS INTEGER)),0) FROM ar_receipts r WHERE r.claim_id=c.id AND r.status='pending') AS pending_minor,
  (SELECT COALESCE(SUM(CASE x.kind WHEN 'allocation' THEN CAST(x.amount_minor AS INTEGER) ELSE -CAST(x.amount_minor AS INTEGER) END),0)
     FROM ar_allocations x WHERE x.claim_id=c.id)
  +(SELECT COALESCE(SUM(d.applied_minor),0) FROM advance_draws d WHERE d.claim_id=c.id) AS allocated_minor,
  (SELECT COALESCE(SUM(d.applied_minor),0) FROM advance_draws d WHERE d.claim_id=c.id) AS drawn_minor
FROM ar_claims c;

-- (4) الربط عند التخطيط: استحقاق معتمد في الكيان نفسه، لعميل الدفعة (ملفها التجاري، أو عميلها بربطه) وبعملتها.
CREATE TRIGGER advance_draws_claim_valid BEFORE INSERT ON advance_draws
WHEN NEW.claim_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM ar_claims c JOIN advance_invoices a ON a.id=NEW.advance_id
  WHERE c.id=NEW.claim_id AND c.tenant_id=NEW.tenant_id AND c.status='approved' AND c.currency=a.currency
    AND (c.case_id=a.case_id OR (a.case_id IS NULL AND EXISTS(SELECT 1 FROM client_links l WHERE l.client_id=a.client_id AND l.case_id=c.case_id))))
BEGIN SELECT RAISE(ABORT,'a draw settles an approved claim of the same customer and currency as its advance'); END;

CREATE TRIGGER advance_draws_claim_fixed BEFORE UPDATE OF claim_id ON advance_draws
WHEN NEW.claim_id IS NOT OLD.claim_id
BEGIN SELECT RAISE(ABORT,'the claim a draw settles is fixed when it is planned; plan another draw instead'); END;

-- السحب المطبَّق لا يتجاوز الباقي على استحقاقه: بعد التطبيق يبقى المقبوض والمعلق والمطبَّق داخل الصافي.
CREATE TRIGGER advance_draws_claim_room AFTER UPDATE OF applied_minor ON advance_draws
WHEN NEW.claim_id IS NOT NULL AND NEW.applied_minor>OLD.applied_minor
  AND (SELECT s.received_minor+s.pending_minor+s.allocated_minor-s.net_minor FROM ar_claim_collection s WHERE s.claim_id=NEW.claim_id)>0
BEGIN SELECT RAISE(ABORT,'a draw never takes a claim past its net: received, pending and applied money stay within it'); END;
