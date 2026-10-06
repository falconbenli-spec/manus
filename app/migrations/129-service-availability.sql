-- مفتاح تفعيل الخدمة وإخفائها — 22 سبتمبر 2026.
-- طلب المالك بالحرف: «تذكرة السفر السنوية خل عندي خيار اني افعلها او اخفيها من صفحه الاعدادات والصلاحيات لكل خدمه».
-- المثال الذي ضربه ليس خدمة في الدليل: «تذكرة السفر السنوية» هي الميزة air_ticket في benefit_catalog، يصل إليها
-- الموظف من خيار الطلب ticket_claim في «مزاياي». فالمفتاح الواحد يغطي سجلّين لا سجلًا واحدًا:
--   (1) خدمات الدليل بالرمز (HR-LETTER…)، 142 خدمة.
--   (2) المزايا بمفتاحها (air_ticket…)، 13 ميزة.
-- ولهذا الصف يحمل kind: بلا هذا التمييز يصطدم رمزٌ بمفتاح ميزة يومًا، ويُخفى غير المقصود.
--
-- لماذا جدول مستقل لا عمودًا في services: صفوف الخدمة نسخٌ لا تُعدَّل ولا تُحذف (مُطلِقا schema.sql
-- service_no_update وservice_no_delete)، فـ«UPDATE services SET active=0» يُجهَض. وإطفاء الخدمة بإدراج
-- نسخة جديدة يغيّر s.id، فيسقط فحصُ createRequest عند كل من فتح الصفحة قبل الإخفاء، وتتغير الصفوف التي
-- تشير إليها الطلبات. فالمفتاح — كـservice_directory قبله — يُمسك بالرمز لا بالنسخة، ولا يحمل مفتاحًا
-- أجنبيًا إلى services لأن رمز الخدمة ليس مفتاحًا فريدًا فيها (فريدها tenant_id+code+version).
--
-- السجل إلحاقي كبقية ما في المنصة يُتخذ فيه قرار: الإخفاء صف، وإعادة التفعيل صف ثانٍ، ولا يُمحى أحدهما.
-- الحالة السارية هي صاحب أكبر seq لكل (كيان، نوع، مفتاح)، وseq تسلسل من القاعدة لا ختم وقت: ختمان في
-- الملّي ثانية نفسها لا يحسمان أيهما الأخير، والتسلسل يحسم.
-- الافتراضي بلا صف: «متاحة». فالترحيل لا يُدرج صفًا واحدًا، ولا يتغير شيء لأي خدمة لم يمسّها المالك.

CREATE TABLE service_availability (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  -- service: رمز خدمة في الدليل. benefit: مفتاح ميزة في benefit_catalog.
  kind TEXT NOT NULL CHECK(kind IN ('service','benefit')),
  target_key TEXT NOT NULL CHECK(length(trim(target_key)) BETWEEN 2 AND 60),
  state TEXT NOT NULL CHECK(state IN ('available','hidden')),
  -- سطر واحد يقول لماذا: يُقرأ في الشاشة بجوار المفتاح، وفي الرفض الذي يصل الموظف إن حاول الطلب.
  -- قرارٌ بلا سبب مكتوب يصير بعد شهر إخفاءً لا يعرف أحد سببه ولا يجرؤ أحد على الرجوع عنه.
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 4 AND 400),
  decided_by TEXT NOT NULL REFERENCES users(id),
  decided_at TEXT NOT NULL,
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

-- قراءة الحالة السارية تمشي على (كيان، نوع، مفتاح) وتأخذ أكبر seq؛ والفهرس يخدم هذا وحده.
CREATE INDEX service_availability_current ON service_availability(tenant_id,kind,target_key,seq);

CREATE TRIGGER service_availability_no_update BEFORE UPDATE ON service_availability
  BEGIN SELECT RAISE(ABORT,'availability history is append only: record a new decision'); END;
CREATE TRIGGER service_availability_no_delete BEFORE DELETE ON service_availability
  BEGIN SELECT RAISE(ABORT,'availability history is append only: a decision taken is never erased'); END;
-- صفٌّ لا يغيّر شيئًا ليس قرارًا: تكرار الحالة السارية نفسها يُرفض في القاعدة كما يُرفض في الوحدة،
-- فلا يمتلئ السجل بإخفاءٍ فوق إخفاء ويضيع القرار الأول بين نسخه.
CREATE TRIGGER service_availability_no_repeat BEFORE INSERT ON service_availability
  WHEN NEW.state = (SELECT state FROM service_availability p WHERE p.tenant_id=NEW.tenant_id AND p.kind=NEW.kind AND p.target_key=NEW.target_key ORDER BY p.seq DESC LIMIT 1)
  BEGIN SELECT RAISE(ABORT,'this is already the current state'); END;
