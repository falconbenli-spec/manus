-- ترحيل 132 — م77(6) من النسخة الموقعة من لائحة تنظيم العمل (شهادة 351743، ص 27): «على أن يدفع الأجر الإضافي نقدًا إذا انتهت خدمة
-- العامل لأي سبب قبل استعماله للإجازة التعويضية».
-- القادح overtime_requests_time_off_no_pay (الترحيل 099) كان يمنع ربط أي طلب اختير له وقت الراحة بحركة مسير بلا شرط، فساعاتٌ اعتُمدت قبل
-- دفتر الأرصدة (125) ولم تُقيَّد رصيدًا تضيع على من انتهت خدمته. لا يُعدَّل ترحيل مطبَّق: يُسقط القادح ويُعاد بالشرط الذي يقوله النص —
-- المنع ما دامت الخدمة قائمة (عقد ساري)، أو ما دامت الساعات مقيَّدة رصيدًا (فلها طريقها في compensatory_payouts، ولا تُعوَّض الساعة مرتين).
-- لا جدول جديد ولا عمود جديد ولا صف يُكتب.
DROP TRIGGER overtime_requests_time_off_no_pay;
CREATE TRIGGER overtime_requests_time_off_no_pay BEFORE UPDATE OF adjustment_id ON overtime_requests
WHEN NEW.adjustment_id IS NOT NULL AND NEW.compensation='time_off'
  AND (EXISTS(SELECT 1 FROM employment_contracts c WHERE c.user_id=NEW.user_id AND c.tenant_id=NEW.tenant_id AND c.status='active')
       OR EXISTS(SELECT 1 FROM compensatory_credits k WHERE k.overtime_request_id=NEW.id))
BEGIN SELECT RAISE(ABORT,'time off in lieu is not paid as well while the service continues or the hours are credited (art. 77(6): cash only when service has ended)'); END;
