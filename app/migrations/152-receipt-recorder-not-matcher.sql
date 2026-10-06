-- ترحيل 152 — من سجّل الاستلام لا يعتمد المطابقة المبنية عليه: القاعدة تنزل من الكود إلى المُطلِق.
--
-- العطب. المطابقة الثلاثية تقارن **الأمر** بـ**الاستلام** بـ**الفاتورة**، ومنها يُنشأ المستحق. وحرس
-- الاستقلال كانوا يقرؤون طرفين من الثلاثة فقط:
--   app/procurement.mjs (match) : invoice.recorded_by <> المعتمد
--   procurement_match_guard (141): NEW.matched_by <> p.requester_id  AND  NEW.matched_by <> i.recorded_by
-- ولا أحد يقرأ procurement_receipts.received_by — والاستلام هو الطرف الوحيد الذي يثبت أن شيئًا وصل فعلًا.
-- وتسجيل الاستلام مفتوح لكل من في نطاق الطلب (app/procurement.mjs، allowedActions: «receive» بلا شرط
-- مراجع ولا صاحب طلب)، فالمسار التالي كان يمر كاملًا بشخصين ظاهرًا وبشخص واحد حقيقة:
--   مراجع M يرسّي ← يعتمد الأمر الداخلي ← يصدر أمر المباشرة ← **يسجّل استلامًا بكامل الكمية** ←
--   صاحب الطلب R يسجّل الفاتورة ← **M نفسه يعتمد المطابقة** ← يُنشأ مستحق.
-- الفاتورة سجّلها غير المعتمد وصاحب الطلب غير المعتمد، فالشرطان القائمان يمران؛ والاستلام — وهو الشيء
-- الوحيد الذي يقول إن البضاعة وصلت — اختلقه المعتمد نفسه بدليل نصّي حرّ.
--
-- القاعدة المضافة: matched_by ليس من سجّل **أي** استلام على هذا الطلب. «أي» لا «الاستلام الأخير»: المستحق
-- يُبنى على مجموع المستلَم على البند (شرط الكمية أدناه يجمع procurement_receipt_lines كلها)، فمن أثبت
-- جزءًا من ذلك المجموع مستفيدٌ من اعتماده.
--
-- لماذا في الطبقتين. هذا هو النمط المكتوب في المنتج حيث المال: قاعدة الشخصين في الرواتب نزلت إلى
-- CHECK(recorded_by<>user_id) في الترحيل 145، وفي التصاريح إلى CHECK(user_id<>granted_by) في الترحيل 144،
-- والسبب نفسه هنا: حارس الكود يحرس مساره وحده، وأي إدخال مباشر — سكربت، إصلاح يدوي، مسار جديد يُكتب غدًا —
-- يمرّ من تحته. والمستحق صفٌّ لا يُحذف ولا يُعدَّل (procurement_payables_no_update/no_delete، الترحيل 005)،
-- فمنعه عند الإدراج هو الفرصة الوحيدة.
--
-- فُحص قبل الكتابة على نسخة القاعدة الحية (عند الترحيل 149): procurement_payables فارغ (0 صفًّا)،
-- وprocurement_receipts فارغ، فلا صفّ قائم يخالف القاعدة ولا صفّ يُعاد كتابته أو يُسقَط. والمُطلِق يحرس
-- الإدراج وحده (BEFORE INSERT)، فلا أثر له على صفّ موجود أصلًا حتى لو ظهر لاحقًا.
--
-- الشكل: المُطلِق يُسقَط ويُعاد بحرفه كما في الترحيل 141 وتُزاد فقرة واحدة، لأن SQLite لا تعدّل مُطلِقًا
-- في مكانه. ورسالة الإيقاف تبقى كما هي ('three way match requires receipt and independent approval')،
-- فما يقرأ الرسالة من اختبار أو سجل لا يتغيّر عليه شيء؛ والفرق الوحيد أن الحالة الممنوعة صارت أوسع.

DROP TRIGGER procurement_match_guard;
CREATE TRIGGER procurement_match_guard BEFORE INSERT ON procurement_payables
WHEN NOT EXISTS(
  SELECT 1 FROM procurement_invoices i JOIN procurement_orders o ON o.purchase_id=i.purchase_id JOIN procurement_purchases p ON p.id=o.purchase_id
  WHERE i.id=NEW.invoice_id AND i.purchase_id=NEW.purchase_id AND p.status IN ('part_received','received')
    AND NEW.matched_by<>p.requester_id AND NEW.matched_by<>i.recorded_by
    -- المضاف في هذا الترحيل: ولا من أثبت الاستلام الذي يُبنى عليه المستحق.
    AND NOT EXISTS(SELECT 1 FROM procurement_receipts r WHERE r.purchase_id=p.id AND r.received_by=NEW.matched_by)
    AND NEW.amount_minor=i.amount_minor AND NEW.currency=i.currency
    AND EXISTS(SELECT 1 FROM procurement_invoice_lines il WHERE il.invoice_id=i.id)
    AND NOT EXISTS(
      SELECT 1 FROM procurement_invoice_lines il JOIN procurement_order_lines ol ON ol.id=il.order_line_id
      WHERE il.invoice_id=i.id AND (
        il.amount_minor<>il.quantity*ol.unit_price_minor
        OR il.quantity+COALESCE((
          SELECT SUM(pl.quantity) FROM procurement_payable_lines pl
          JOIN procurement_payables px ON px.id=pl.payable_id
          WHERE pl.order_line_id=il.order_line_id AND px.purchase_id=p.id
        ),0)>COALESCE((
          SELECT SUM(rl.quantity) FROM procurement_receipt_lines rl
          WHERE rl.order_line_id=il.order_line_id AND rl.purchase_id=p.id
        ),0)
      )
    )
)
BEGIN SELECT RAISE(ABORT,'three way match requires receipt and independent approval'); END;
