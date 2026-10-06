-- ترحيل 178 — وعد السداد لا يسبق يوم الوعد بتوقيت الرياض (الحزمة 3).
--
-- القادح ar_promise_record (الترحيل 170) يقارن تاريخ الوعد بـsubstr(NEW.created_at,1,10): أول عشرة أحرف من طابع UTC.
-- من 00:00 إلى 03:00 بتوقيت الرياض يكون يوم UTC أمس، فيقبل القادح وعدًا تاريخه أمس — يتساهل يومًا كاملًا. فحص الشيفرة في
-- app/receivables.mjs صحيح ويرفض قبله، فالعطب في الحارس الأخير وحده؛ وهو يُصحَّح لأن القاعدة تحرس من يكتب بغير الشيفرة.
-- التعريف نفسه حرفًا إلا المقارنة: date(NEW.created_at,'+3 hours') كما في الترحيلين 162 و163.
DROP TRIGGER ar_promise_record;
CREATE TRIGGER ar_promise_record BEFORE INSERT ON ar_promises
WHEN NOT (length(NEW.amount_minor) BETWEEN 1 AND 12 AND NEW.amount_minor NOT GLOB '*[^0-9]*' AND CAST(NEW.amount_minor AS INTEGER)>0)
  OR NEW.promised_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR NEW.promised_on<date(NEW.created_at,'+3 hours')
  OR length(trim(NEW.contact))<3 OR length(trim(NEW.evidence))<10
  OR NOT EXISTS(SELECT 1 FROM ar_claims c JOIN users x ON x.id=NEW.recorded_by AND x.tenant_id=c.tenant_id WHERE c.id=NEW.claim_id AND c.status='approved')
BEGIN SELECT RAISE(ABORT,'a promise to pay names an amount, a date on or after the day it was made, who promised and the evidence, on an approved claim'); END;
