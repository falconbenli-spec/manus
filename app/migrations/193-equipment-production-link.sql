-- ربط حجز المعدات بالإنتاج (الحزمة 4، P4-DOMAIN-3). كان الربط نصًّا حرًّا (production_ref في 063) لأن وحدة الإنتاج
-- بُنيت بالتوازي؛ والحجز الآن يحمل معرّف الإنتاج نفسه، فيُعرف أي معدات طالعة على أي إنتاج، ولا يُقفل إنتاجٌ ومعداته برّا.
--
-- عمود يُضاف لا جدول يُعاد بناؤه: لإعادة البناء (نمط 144) شرطٌ لا يتحقق هنا دائمًا — DROP TABLE يُطلق أفعال الحذف المتسلسل
-- عند الأبناء ولو أُجّلت المفاتيح — وADD COLUMN بمرجع قيمته الافتراضية NULL لا يمسّ صفًّا ولا ابنًا. ولأن ADD COLUMN لا يحمل
-- مفتاحًا مركّبًا (production_id,tenant_id)، فالكيان يُفرض بمحفّز عند الإدراج، والمعرّف لا يتبدّل بعده بمحفّز آخر.
ALTER TABLE equipment_bookings ADD COLUMN production_id TEXT REFERENCES productions(id);

-- الربط الرجعي: نص المرجع يُقرأ إنتاجًا إذا طابق إنتاجًا واحدًا بالضبط في الكيان نفسه — رمزه بلا اعتبار لحالة الأحرف
-- (الرموز تُحفظ بأحرف كبيرة)، أو اسمه حرفًا بحرف. ما طابق اثنين أو لم يطابق شيئًا يبقى NULL ونصّه كما هو.
-- محفّز الإصدار (063) يرفض أي تحديث لا يرفع الإصدار، ويرفض كل تحديث على حجز مغلق؛ فيُرفع لحظة الربط ويُعاد بنصّه نفسه،
-- فلا يتغير عمود قديم في أي صف: لا الإصدار ولا وقت التحديث.
DROP TRIGGER equipment_bookings_versioned;
UPDATE equipment_bookings SET production_id=(
  SELECT p.id FROM productions p WHERE p.tenant_id=equipment_bookings.tenant_id
    AND (p.code=upper(trim(equipment_bookings.production_ref)) OR trim(p.title)=trim(equipment_bookings.production_ref)))
WHERE trim(production_ref)<>'' AND (
  SELECT COUNT(*) FROM productions p WHERE p.tenant_id=equipment_bookings.tenant_id
    AND (p.code=upper(trim(equipment_bookings.production_ref)) OR trim(p.title)=trim(equipment_bookings.production_ref)))=1;
CREATE TRIGGER equipment_bookings_versioned BEFORE UPDATE ON equipment_bookings
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.item_id<>OLD.item_id OR NEW.custodian_id<>OLD.custodian_id
  OR NEW.booked_by<>OLD.booked_by OR OLD.status IN ('returned','cancelled')
BEGIN SELECT RAISE(ABORT,'a closed booking is final; custody and item never move to another booking'); END;

-- الحجز يُربط بإنتاج كيانه وحده، وبإنتاج للحين في التحضير ولا قيد التصوير؛ والإنتاج المنتهي أو المقفل أو الملغى لا يأخذ حجزًا جديدًا.
CREATE TRIGGER equipment_bookings_production_tenant BEFORE INSERT ON equipment_bookings
WHEN NEW.production_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM productions p WHERE p.id=NEW.production_id AND p.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'a booking links only to a production of its own tenant'); END;
CREATE TRIGGER equipment_bookings_production_live BEFORE INSERT ON equipment_bookings
WHEN NEW.production_id IS NOT NULL AND (SELECT p.status FROM productions p WHERE p.id=NEW.production_id) NOT IN ('planning','in_production')
BEGIN SELECT RAISE(ABORT,'equipment is booked only against a production still in planning or shooting'); END;
-- والحجز يبقى على الإنتاج الذي حُجز له: لا ينتقل لإنتاج آخر ولا ينفك عنه، فلا يُفلت من شرط الإقفال أدناه.
CREATE TRIGGER equipment_bookings_production_fixed BEFORE UPDATE OF production_id ON equipment_bookings
WHEN NEW.production_id IS NOT OLD.production_id
BEGIN SELECT RAISE(ABORT,'a booking keeps the production it was made for'); END;
-- لا يُقفل إنتاجٌ ومعداته محجوزة له أو طالعة عليه. الوحدة ترفض أولًا برفض يسمّي القطع وحامليها؛ هذا حارس الكتابة المباشرة.
CREATE TRIGGER productions_close_after_equipment BEFORE UPDATE OF status ON productions
WHEN NEW.status='closed' AND OLD.status<>'closed' AND EXISTS(
  SELECT 1 FROM equipment_bookings b WHERE b.production_id=NEW.id AND b.status IN ('reserved','out'))
BEGIN SELECT RAISE(ABORT,'a production is closed only after its booked equipment is back or released'); END;
CREATE INDEX equipment_bookings_production ON equipment_bookings(production_id,status) WHERE production_id IS NOT NULL;
