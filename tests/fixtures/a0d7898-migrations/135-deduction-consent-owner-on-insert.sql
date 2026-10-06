-- ترحيل 135 — م51 من النسخة الموقعة من لائحة تنظيم العمل (شهادة 351743، ص 19)، صدر المادة: «لا يجوز حسم أي مبلغ من أجور العامل لقاء حقوقه
-- دون موافقة خطيّة منه». الموافقة بهوية صاحب الأجر وحده، عند الإدخال كما عند التعديل.
-- القادح payroll_deduction_basis_consent_owner (الترحيل 133) يحرس UPDATE OF consent_by وحده، فصف سند يُدخَل ابتداءً بموافقة منقولة من وحدة
-- أخرى باسم غير صاحب الأجر كان يمر ويُعتمد (مراجعة 22 سبتمبر). لا يُعدَّل ترحيل مطبَّق: قادح ثانٍ على الإدخال بالشرط نفسه والرسالة نفسها.
-- لا جدول جديد ولا عمود جديد ولا صف يُكتب. الصفوف القائمة لا تُمس: التحقق منها في الشيفرة (recordDeductionBasis) قبل هذا الترحيل لم يكن، فما كُتب
-- قبله يُراجَع يدويًا إن وُجد (لا صف كهذا في القاعدة الحية اليوم: الباب الداخلي الوحيد يمرر موافقة صاحب الطلب نفسه).
CREATE TRIGGER payroll_deduction_basis_consent_owner_insert BEFORE INSERT ON payroll_deduction_basis
WHEN NEW.consent_by IS NOT NULL AND NEW.consent_by<>(SELECT user_id FROM payroll_adjustments WHERE id=NEW.adjustment_id)
BEGIN SELECT RAISE(ABORT,'the worker consents to a deduction from his own wage; nobody consents for him'); END;
