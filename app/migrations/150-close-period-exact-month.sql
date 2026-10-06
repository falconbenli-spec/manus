-- ترحيل 150 — فترة الإقفال تُربط بفترة محاسبية تساوي شهرها بالضبط، لا بفترة تغطيه.
--
-- ما كان يقع: `openClosePeriod` كان يقبل أي فترة محاسبية **تغطي** الشهر (starts_on<=الأول AND ends_on>=الآخر).
-- وقاعدة التشغيل فيها فترة محاسبية واحدة، 2026-01-01 إلى 2026-12-31. فاعتماد إقفال سبتمبر كان يستدعي
-- `financeReferenceAction(...,'close')` على تلك الفترة، فتصير **السنة كلها** closed.
--
-- ولماذا هذا لا يُصلَح بسطر كود وحده: القفل هناك لا رجعة فيه. مُطلِق `finance_period_identity` (ترحيل 007)
-- لا يسمح بغير انتقال open→closed، و`finance_periods_no_delete` يمنع الحذف، ولا مسار إعادة فتح في الكود
-- ولا في القاعدة — حتى إعادة فتح الإقفال نفسه لا تفك قفل الدفتر، كما تقول app/close-checklist.mjs صراحةً.
-- فأكتوبر ونوفمبر وديسمبر تصير غير قابلة للقيد إلى الأبد، بلا أي طريق للتراجع. خسارةٌ بهذا الحجم لا يجوز
-- أن يمنعها شرطٌ واحد في الكود يُلتفّ عليه بمسارٍ يُكتب غدًا أو بتعديل مباشر على الجدول.
--
-- الشكل: الحد نفسه مكرر في الكود (رسالة مكتوبة تسمّي مدى الفترة الفعلي وتقول ما الذي يُنشأ بدله) وفي القاعدة
-- (إجهاض صامت وأخير). وهو مفروض على الإدراج **وعلى التعديل** معًا، لأن ربطًا يُضاف بعد الفتح هو القفل نفسه
-- من باب آخر: `close_period_versioned` لا يمنع تغيير finance_period_id.
--
-- آخر الشهر يُحسب من التاريخ لا من جدول: date(المفتاح||'-01','+1 month','-1 day') يعطي 2026-02-28 و2026-12-31
-- على السواء، فلا سنة كبيسة تُنسى ولا قائمة أطوال أشهر تُكتب باليد.
--
-- لا صفوف قائمة تتأثر: `close_periods` فارغ في نسخة قاعدة التشغيل التي قيس عليها هذا العمل، والمُطلِقات
-- تحرس الكتابة القادمة لا المحفوظ.

CREATE TRIGGER close_period_month_scope_insert BEFORE INSERT ON close_periods
WHEN NEW.finance_period_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM finance_periods p
  WHERE p.id=NEW.finance_period_id AND p.tenant_id=NEW.tenant_id
    AND p.starts_on=NEW.period_key||'-01'
    AND p.ends_on=date(NEW.period_key||'-01','+1 month','-1 day'))
BEGIN SELECT RAISE(ABORT,'a close period binds only to an accounting period spanning exactly its own month'); END;

CREATE TRIGGER close_period_month_scope_update BEFORE UPDATE ON close_periods
WHEN NEW.finance_period_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM finance_periods p
  WHERE p.id=NEW.finance_period_id AND p.tenant_id=NEW.tenant_id
    AND p.starts_on=NEW.period_key||'-01'
    AND p.ends_on=date(NEW.period_key||'-01','+1 month','-1 day'))
BEGIN SELECT RAISE(ABORT,'a close period binds only to an accounting period spanning exactly its own month'); END;
