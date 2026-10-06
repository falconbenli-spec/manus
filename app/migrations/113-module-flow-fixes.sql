-- D-01a (تدقيق مسارات الوحدات، 20 سبتمبر 2026): أثر الأجر لكل إجازة بلا أجر أو بأقل منه كان يُكتب «غير مسعّر»
-- ثم لا يصل المسير أبدًا. الحالة نفسها صحيحة — المنصة لا تخترع سعرًا حين لا تكون هناك سياسة دورة رواتب معتمدة —
-- لكنها كانت طريقًا مسدودًا: القيد في الترحيل 098 يمنع كتابة المبلغ ورقم الحركة بعد الإنشاء، فالأثر الذي وُلد
-- غير مسعّر يبقى غير مسعّر إلى الأبد، ولو اعتُمدت السياسة بعد يوم واحد.
--
-- هذا الترحيل يفتح انتقالًا واحدًا فقط: «غير مسعّر» ← «مقترح»، بكتابة المبلغ ورقم الحركة معًا بعد أن كانا فارغين.
-- ما عدا ذلك يبقى كما كان: الطلب والشهر والأيام لا تتغير، والمبلغ المكتوب لا يُعاد كتابته، و«مسحوب» تبقى الحالة
-- النهائية الوحيدة الأخرى. التسعير فعل إنسان بصلاحية إعداد الرواتب، لا فعل آلي.
DROP TRIGGER leave_pay_effects_fixed;
CREATE TRIGGER leave_pay_effects_fixed BEFORE UPDATE ON leave_pay_effects
WHEN NEW.request_id<>OLD.request_id OR NEW.month<>OLD.month OR NEW.dates_json<>OLD.dates_json OR NEW.lost_bp_days<>OLD.lost_bp_days
  OR NOT (
    -- بقاء الحالة كما هي، أو سحبها: المبلغ والحركة لا يتغيران.
    ((NEW.status=OLD.status OR NEW.status='withdrawn') AND NEW.amount_minor IS OLD.amount_minor AND NEW.adjustment_id IS OLD.adjustment_id)
    -- أو التسعير: من «غير مسعّر» إلى «مقترح» بمبلغ موجب وحركة، وكلاهما كان فارغًا.
    OR (OLD.status='unpriced' AND NEW.status='proposed' AND OLD.amount_minor IS NULL AND OLD.adjustment_id IS NULL
        AND NEW.amount_minor IS NOT NULL AND NEW.amount_minor>0 AND NEW.adjustment_id IS NOT NULL)
  )
BEGIN SELECT RAISE(ABORT,'a leave pay effect is only priced once, then withdrawn'); END;

-- D-01b: بوابة إخلاء الطرف قبل اعتماد التسوية النهائية كانت شيفرة ميتة — clearanceBlockers مُعرَّفة ولا يستدعيها أحد،
-- فتُعتمد مخالصة فوق عهدة مفتوحة ومعدة لم تُرجع وسلفة قائمة. صارت البوابة نافذة في app/payroll-extras.mjs،
-- وهذه الأعمدة تحفظ أثرها: ما كان مفتوحًا لحظة القرار، ومن تجاوزه بتصريحه وبأي سبب مكتوب.
-- التجاوز قرار إنسان يحمل تصريح التوظيف والتهيئة (people.manage): يُسجَّل باسمه وسببه، ولا يُمحى.
ALTER TABLE service_settlements ADD COLUMN clearance_blockers TEXT NOT NULL DEFAULT '[]';
ALTER TABLE service_settlements ADD COLUMN clearance_override_by TEXT REFERENCES users(id);
ALTER TABLE service_settlements ADD COLUMN clearance_override_reason TEXT;
ALTER TABLE service_settlements ADD COLUMN clearance_override_at TEXT;
-- التجاوز لا يوجد بلا صاحب ولا بلا سبب.
CREATE TRIGGER service_settlements_override_complete BEFORE UPDATE ON service_settlements
WHEN (NEW.clearance_override_by IS NULL)<>(NEW.clearance_override_reason IS NULL)
  OR (NEW.clearance_override_by IS NULL)<>(NEW.clearance_override_at IS NULL)
  OR (NEW.clearance_override_reason IS NOT NULL AND length(trim(NEW.clearance_override_reason))<20)
BEGIN SELECT RAISE(ABORT,'a clearance override carries its holder, its time and a written reason'); END;

-- D-15: المغادر لم يكن يُخبَر بمخالصته إطلاقًا. الإشعار يحتاج موضوعًا مسموحًا به في قائمة notices.mjs،
-- وقيد الشكل في الترحيل 100 يقبل أي نص؛ لا تغيير في الشكل هنا، والقائمة المسموحة تُوسَّع في الكود.
-- ما يلزم في القاعدة: وسم قراءة المخالصة لصاحبها، فكل اطلاع مسجَّل كما تُسجَّل قسيمة الراتب.
CREATE TABLE settlement_views (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES service_settlements(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX settlement_views_settlement ON settlement_views(settlement_id);
