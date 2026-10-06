-- شرط أهلية الخدمة: تصريح لازم وحصرٌ بإدارة — 24 سبتمبر 2026.
--
-- ما قِيس قبل هذا الترحيل، على القاعدة الحية (ترحيل 137) لا على الظن:
--   • 169 صفًّا في catalog_placement، كلها required_capability='' وdepartment_id=NULL وvisible=1.
--   • ولا خطوة اعتماد واحدة في الكتالوج تحمل شرطًا (`when`): صفر من 139 تعريفًا.
--   • وأهمّ من الاثنين: **العمودان لا يقرؤهما مرشّحُ ظهورٍ واحد في المنصة**. قارئهما الوحيد
--     eligibilityFrom في app/service-cards.mjs، وهي تطبعهما للموظف نصًّا: «لازم يكون بحسابك تصريح
--     كذا» و«الخدمة هذي لمنسوبي كذا وبس». فالبطاقة تعد بحصرٍ لا يفرضه أحد — وهذا هو العطب، لا
--     كونُ العمودين فارغين. ملء العمودين قبل ربطهما كان يزيد الكذبة لا يغلقها.
--
-- ولماذا جدول مستقل والعمودان موجودان أصلًا في catalog_placement: لأن **الإسقاط ليس مصدر حقيقة**
-- (ترحيل 131 بنصّه). projectCatalog في app/catalog-tree.mjs يمحو صفوف الكيان كلها ويعيد بناءها
-- بـrequired_capability='' وdepartment_id=NULL في كل تشغيلة مثبّت. فقرارُ المالك المكتوب في الإسقاط
-- وحده يضيع عند أول إعادة بناء، بلا أثر ولا سبب ولا من اتخذه. القرار يسكن هنا، والإسقاط يحمل صورته
-- ويُعاد وضعها عليه بعد كل بناء — كما تُعاد مرادفات from_code.
--
-- السجل إلحاقيّ كبقية ما في المنصة يُتخذ فيه قرار (خصوصًا 129، وهذا نظيره): وضعُ الشرط قرارٌ، ورفعُه
-- قرارٌ ثانٍ، ويبقى الاثنان بسببيهما. الحالة السارية صاحب أكبر seq، وseq تسلسل من القاعدة لا ختم وقت.
-- والافتراض بلا صف: **لا شرط**. فالترحيل لا يُدرج صفًّا واحدًا، ولا يتغيّر ما يراه أحد بترقية مخطط.
--
-- ما لا يفعله هذا الترحيل: لا يمسّ catalog_placement ولا services ولا requests ولا يكتب حدث تدقيق
-- (الحدث لفعل إنسان)، ولا يقرّر عن المالك من يطلب ماذا — ذاك قراره وحده، وهذا بابه إليه.

CREATE TABLE service_gate (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  -- رمز الخدمة في الدليل، لا معرّف نسختها: صفوف services نسخٌ لا تُعدَّل، وفريدها tenant_id+code+version.
  -- القاعدة نفسها التي تمشي عليها service_directory (043) وservice_cards (045) وservice_availability (129).
  service_code TEXT NOT NULL CHECK(length(trim(service_code)) BETWEEN 2 AND 60),
  -- التصريح اللازم لرؤية الخدمة وطلبها، أو '' لخدمة لا شرط تصريحٍ لها. نصّ لا مفتاح أجنبي: التصاريح
  -- كودٌ في app/access.mjs بقرار 123 الصريح، والتحقق بـcan لا بإحالة. والباب يرفض مفتاحًا لا يعرفه باسمه.
  required_capability TEXT NOT NULL DEFAULT '' CHECK(length(required_capability) BETWEEN 0 AND 40),
  -- الإدارة التي تنحصر فيها الخدمة، أو NULL لخدمة مفتوحة لكل الإدارات.
  department_id TEXT,
  -- على أي أساس وُضع الشرط أو رُفع. شرطٌ بلا سند مكتوب يصير بعد شهر بابًا مغلقًا لا يعرف أحد من أغلقه
  -- ولا لماذا، ولا يجرؤ أحد على فتحه. عشرة أحرف على الأقل، كسند استثناء الإدارة في 130.
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  decided_by TEXT NOT NULL REFERENCES users(id),
  decided_at TEXT NOT NULL,
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id)
) STRICT;

-- قراءة الحالة السارية تمشي على (كيان، رمز) وتأخذ أكبر seq؛ والفهرس يخدم هذا وحده.
CREATE INDEX service_gate_current ON service_gate(tenant_id,service_code,seq);

CREATE TRIGGER service_gate_no_update BEFORE UPDATE ON service_gate
  BEGIN SELECT RAISE(ABORT,'a gate decision is append only: record a new decision'); END;
CREATE TRIGGER service_gate_no_delete BEFORE DELETE ON service_gate
  BEGIN SELECT RAISE(ABORT,'a gate decision taken is never erased'); END;
-- تكرار الشرط الساري نفسه ليس قرارًا: يُرفض في القاعدة كما يُرفض في الوحدة، فلا يمتلئ السجل بشرطٍ
-- فوق شرطٍ ويضيع القرار الأول بين نسخه.
CREATE TRIGGER service_gate_no_repeat BEFORE INSERT ON service_gate
WHEN EXISTS(SELECT 1 FROM service_gate p WHERE p.tenant_id=NEW.tenant_id AND p.service_code=NEW.service_code
  AND p.seq=(SELECT MAX(x.seq) FROM service_gate x WHERE x.tenant_id=NEW.tenant_id AND x.service_code=NEW.service_code)
  AND p.required_capability=NEW.required_capability AND p.department_id IS NEW.department_id)
BEGIN SELECT RAISE(ABORT,'this is already the current gate'); END;
-- وأول صفٍّ لخدمة لا شرط فيه أصلًا: رفعُ ما لم يوضع ليس قرارًا.
CREATE TRIGGER service_gate_no_empty_first BEFORE INSERT ON service_gate
WHEN trim(NEW.required_capability)='' AND NEW.department_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM service_gate p WHERE p.tenant_id=NEW.tenant_id AND p.service_code=NEW.service_code)
BEGIN SELECT RAISE(ABORT,'a first gate row must carry a capability or a department'); END;
