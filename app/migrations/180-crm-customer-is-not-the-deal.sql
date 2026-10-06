-- ترحيل 180 — العميل غير الصفقة (الحزمة 4، P4-CRM-1، القرار D1 في docs/readiness/DECISIONS-NEEDED.md §ز).
--
-- العطب: المسار التجاري (الترحيل 004) عامل كل صفقة كأنها العميل. commercial_cases تحمل UNIQUE(tenant_id,registration_number)،
-- والعقد وخط أساس المشروع صفٌّ واحد لكل ملف، فالسجل التجاري الواحد ما يقدر يفتح صفقة ثانية أبدًا: لا تجديد ولا نطاق ثاني.
-- وملف العميل (clients، الترحيل 033) بلا رقم سجل أصلًا، ففحص التكرار فيه بالاسم القانوني الحرفي وحده.
--
-- القرار D1: الملف التجاري صفقةٌ واحدة، والعميل صفُّ clients. فهذا الترحيل:
--   (1) يضيف clients.registration_number بفهرس فريد جزئي (الكيان، الرقم) حيث الرقم موجود — فالعميل هو من يحمل الرقم.
--   (2) يعيد بناء commercial_cases بلا UNIQUE(tenant_id,registration_number)، ويبقي UNIQUE(id,tenant_id) وكل قيد آخر بحرفه،
--       ويضيف: client_id (العميل)، opportunity_id (الفرصة التي فُتحت منها، فريد جزئيًا)، predecessor_case_id (الصفقة السابقة
--       لنفس العميل)، وحالتي lost وwithdrawn النهائيتين بسببٍ من pipeline_loss_reasons وتعليقٍ ومن أغلق ومتى.
--
-- ═══ سلامة البيانات في إعادة البناء ═══
-- تسعة عشر جدولًا تحيل إلى commercial_cases بتسعة عشر مفتاحًا أجنبيًا (مفتاح ar_account_receipts مركّب: case_id+tenant_id)،
-- وتحتها 27 جدولًا آخر بالتعدّي. جُردت كلها بـ PRAGMA foreign_key_list على قاعدة مبنية من الترحيلات ٠٠١–١٧٠: **كل** إحالة إلى commercial_cases
-- ON DELETE NO ACTION، ولا CASCADE ولا SET NULL ولا SET DEFAULT على أي جدول في السلسلة كلها (الإجراءات الثلاثة الوحيدة في
-- المخطط كله على procurement_project_grants وreport_schedule_runs، وكلاهما خارج السلسلة).
-- و DROP TABLE مع foreign_keys=ON يجري DELETE ضمنيًا: يُسقط المُطلِقات أولًا فلا يُطلق أيٌّ منها، ويُطلق إجراءات الإحالة
-- (CASCADE/SET NULL) لو وُجدت — وما وُجدت. فالحذف الضمني لا يلمس صفًّا ابنًا، ومخالفاته مؤجلة بـ defer_foreign_keys،
-- وتنغلق حين تعود الصفوف بمعرفاتها نفسها قبل الإغلاق. فنمط 124 و127 و144 آمن هنا، ولا حاجة لتوسيع مشغّل الترحيلات.
-- الدليل: tests/migration-180.test.mjs (صفوف في الجداول التسعة عشر كلها) وscripts/crm-rebuild-parity.mjs (آخر نسخة احتياطية
-- للتشغيل على نسخة)، كلاهما يقيس عدد الصفوف وبصمة محتواها بترتيب rowid لكل جدول في السلسلة قبل الترحيل وبعده.
-- والصفوف تعود بـ rowid نفسه، فلا يتغيّر ترتيب قراءة بلا ORDER BY.
--
-- ═══ قاعدة ملء client_id ═══
-- من ربط الصفقة بملف العميل (client_links) وحده: الربط قرار سجّله مسؤول الحساب بيده (agency.link_case)، وclient_links.case_id
-- فريد فلا لبس. ولا مطابقة برقم السجل هنا: عند هذه اللحظة لا رقم سجل على أي عميل إلا ما نُسخ في الخطوة (1) من صفقته
-- المربوطة نفسها، والرقم كان فريدًا لكل كيان في 004، فالمطابقة به لا تجد إلا الصفقة المربوطة أصلًا. الصفقة بلا ربط تبقى
-- client_id = NULL، وتُقرأ بالاستعلام: SELECT id,tenant_id,status,created_at FROM commercial_cases WHERE client_id IS NULL.
PRAGMA defer_foreign_keys=ON;

-- ═══ (1) العميل يحمل رقم سجله ═══
-- الشكل نفسه الذي يفرضه createLead منذ 004: أحرف لاتينية كبيرة وأرقام وشرطة، من 3 إلى 40.
ALTER TABLE clients ADD COLUMN registration_number TEXT CHECK(registration_number IS NULL OR (length(registration_number) BETWEEN 3 AND 40 AND registration_number NOT GLOB '*[^A-Z0-9-]*'));
CREATE UNIQUE INDEX clients_registration_unique ON clients(tenant_id,registration_number) WHERE registration_number IS NOT NULL;
-- مفتاح أجنبي مركّب (العميل، الكيان) من الصفقة: يلزمه فهرس فريد على العمودين في الجدول الأب.
CREATE UNIQUE INDEX clients_id_tenant ON clients(id,tenant_id);

-- رقم السجل من الصفقة المربوطة: يُنسخ إلى العميل حين تتفق صفقاته المربوطة كلها على رقم واحد بالشكل الصحيح،
-- ولا يدّعيه عميل آخر في الكيان نفسه. غير ذلك يبقى فارغًا ويسجّله مسؤول الحساب (agency: set_registration).
CREATE TEMP TABLE crm180_client_registration AS
SELECT l.client_id, MIN(k.registration_number) AS registration_number
FROM client_links l
JOIN commercial_cases k ON k.id=l.case_id
JOIN clients c ON c.id=l.client_id AND c.tenant_id=k.tenant_id
GROUP BY l.client_id
HAVING COUNT(DISTINCT k.registration_number)=1;
DELETE FROM crm180_client_registration
WHERE length(registration_number) NOT BETWEEN 3 AND 40 OR registration_number GLOB '*[^A-Z0-9-]*';
DELETE FROM crm180_client_registration WHERE client_id IN (
  SELECT r.client_id FROM crm180_client_registration r JOIN clients c ON c.id=r.client_id
  WHERE EXISTS(SELECT 1 FROM crm180_client_registration r2 JOIN clients c2 ON c2.id=r2.client_id
    WHERE c2.tenant_id=c.tenant_id AND r2.registration_number=r.registration_number AND r2.client_id<>r.client_id));
UPDATE clients SET registration_number=(SELECT r.registration_number FROM crm180_client_registration r WHERE r.client_id=clients.id)
WHERE registration_number IS NULL AND id IN (SELECT client_id FROM crm180_client_registration);
DROP TABLE crm180_client_registration;

-- ═══ (2) الصفقة: إعادة بناء commercial_cases باسمها ═══
CREATE TEMP TABLE commercial_cases_carry AS SELECT rowid AS crm180_rowid, * FROM commercial_cases;

DROP TRIGGER commercial_case_identity;
DROP TRIGGER commercial_case_no_delete;
DROP TABLE commercial_cases;

CREATE TABLE commercial_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  department_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  contact TEXT NOT NULL,
  source TEXT NOT NULL,
  sector TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('lead','qualification_pending','qualification_rejected','qualified','quote_draft','quote_pending','quote_rejected','quote_approved','contracted','project_active','lost','withdrawn')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  current_qualification_id TEXT,
  current_quote_id TEXT,
  project_id TEXT REFERENCES projects(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- العميل الذي تخصه الصفقة. فارغ في صفقة قديمة لم تُربط بملف عميل؛ ومتى كُتب لا يتغير (commercial_case_links_fixed).
  client_id TEXT,
  -- الفرصة التي فُتحت منها الصفقة، والصفقة السابقة لنفس العميل (تجديد أو نطاق ثانٍ). تُكتبان عند الإنشاء ولا تتغيران.
  opportunity_id TEXT,
  predecessor_case_id TEXT,
  -- خسارة الصفقة أو سحبها: سبب من قائمة أسباب الخسارة السارية، وما حدث وما نتعلمه، ومن أغلق ومتى. نهائيتان.
  closed_reason_id TEXT,
  closed_comment TEXT NOT NULL DEFAULT '',
  closed_at TEXT,
  closed_by TEXT,
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(client_id,tenant_id) REFERENCES clients(id,tenant_id),
  FOREIGN KEY(opportunity_id,tenant_id) REFERENCES opportunities(id,tenant_id),
  FOREIGN KEY(predecessor_case_id,tenant_id) REFERENCES commercial_cases(id,tenant_id),
  FOREIGN KEY(closed_reason_id,tenant_id) REFERENCES pipeline_loss_reasons(id,tenant_id),
  FOREIGN KEY(closed_by,tenant_id) REFERENCES users(id,tenant_id),
  UNIQUE(id,tenant_id),
  CHECK(predecessor_case_id IS NULL OR predecessor_case_id<>id),
  CHECK((status IN ('lost','withdrawn'))=(closed_reason_id IS NOT NULL)),
  CHECK((status IN ('lost','withdrawn'))=(closed_by IS NOT NULL AND closed_at IS NOT NULL)),
  CHECK(status NOT IN ('lost','withdrawn') OR length(trim(closed_comment))>=10)
) STRICT;

INSERT INTO commercial_cases(rowid,id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,version,current_qualification_id,current_quote_id,project_id,created_at,updated_at,client_id)
SELECT k.crm180_rowid,k.id,k.tenant_id,k.department_id,k.owner_id,k.name,k.registration_number,k.contact,k.source,k.sector,k.status,k.version,k.current_qualification_id,k.current_quote_id,k.project_id,k.created_at,k.updated_at,
  (SELECT l.client_id FROM client_links l JOIN clients c ON c.id=l.client_id AND c.tenant_id=k.tenant_id WHERE l.case_id=k.id)
FROM commercial_cases_carry k ORDER BY k.crm180_rowid;
DROP TABLE commercial_cases_carry;

-- الفهرس والمُطلِقان كما في الترحيل 004 بحرفها.
CREATE INDEX commercial_owner ON commercial_cases(tenant_id,owner_id,status);
CREATE TRIGGER commercial_case_identity BEFORE UPDATE ON commercial_cases
WHEN OLD.id<>NEW.id OR OLD.tenant_id<>NEW.tenant_id OR OLD.department_id<>NEW.department_id
 OR OLD.owner_id<>NEW.owner_id OR OLD.registration_number<>NEW.registration_number
 OR OLD.name<>NEW.name OR OLD.contact<>NEW.contact OR OLD.source<>NEW.source OR OLD.sector<>NEW.sector
 OR OLD.created_at<>NEW.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'commercial identity is fixed and changes require the next version'); END;
CREATE TRIGGER commercial_case_no_delete BEFORE DELETE ON commercial_cases
BEGIN SELECT RAISE(ABORT,'commercial history is immutable'); END;

-- ما يضيفه هذا الترحيل: البحث برقم السجل صار فهرسًا عاديًا بعد أن كان قيدًا فريدًا، وصفقات العميل، والفرصة الواحدة بصفقة واحدة.
CREATE INDEX commercial_cases_registration ON commercial_cases(tenant_id,registration_number);
CREATE INDEX commercial_cases_client ON commercial_cases(client_id,status) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX commercial_cases_opportunity ON commercial_cases(opportunity_id) WHERE opportunity_id IS NOT NULL;

-- العميل يُكتب مرة (عند الإنشاء أو عند ربط صفقة قديمة) ولا يتغير؛ والفرصة والسابقة من الإنشاء.
CREATE TRIGGER commercial_case_links_fixed BEFORE UPDATE ON commercial_cases
WHEN (OLD.client_id IS NOT NULL AND NEW.client_id IS NOT OLD.client_id)
  OR NEW.opportunity_id IS NOT OLD.opportunity_id
  OR NEW.predecessor_case_id IS NOT OLD.predecessor_case_id
BEGIN SELECT RAISE(ABORT,'a deal keeps its customer once set, and its opportunity and predecessor from creation'); END;
-- الخسارة والسحب نهائيان، والصفقة المتعاقد عليها لا تُخسر ولا تُسحب: إنهاء عقدٍ قائم مسار آخر.
CREATE TRIGGER commercial_case_closed_final BEFORE UPDATE ON commercial_cases
WHEN OLD.status IN ('lost','withdrawn')
  OR (NEW.status IN ('lost','withdrawn') AND OLD.status IN ('contracted','project_active'))
BEGIN SELECT RAISE(ABORT,'a lost or withdrawn deal is final, and a contracted deal is not lost or withdrawn'); END;
-- الصفقة من فرصة تخص عميل الفرصة نفسه، والسابقة صفقةٌ لنفس العميل في الكيان نفسه.
CREATE TRIGGER commercial_case_same_customer BEFORE INSERT ON commercial_cases
WHEN (NEW.opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM opportunities o
        WHERE o.id=NEW.opportunity_id AND o.tenant_id=NEW.tenant_id AND o.client_id IS NEW.client_id))
  OR (NEW.predecessor_case_id IS NOT NULL AND (NEW.client_id IS NULL OR NOT EXISTS(SELECT 1 FROM commercial_cases p
        WHERE p.id=NEW.predecessor_case_id AND p.tenant_id=NEW.tenant_id AND p.client_id=NEW.client_id)))
BEGIN SELECT RAISE(ABORT,'a deal belongs to the customer of its opportunity and of its predecessor, inside one tenant'); END;
-- ربط صفقة بملف عميل: عميلها نفسه إن كان مكتوبًا، وفي كيانها.
CREATE TRIGGER client_links_same_customer BEFORE INSERT ON client_links
WHEN EXISTS(SELECT 1 FROM commercial_cases k WHERE k.id=NEW.case_id AND k.client_id IS NOT NULL AND k.client_id<>NEW.client_id)
  OR NOT EXISTS(SELECT 1 FROM commercial_cases k JOIN clients c ON c.id=NEW.client_id AND c.tenant_id=k.tenant_id WHERE k.id=NEW.case_id)
BEGIN SELECT RAISE(ABORT,'a deal is linked to its own customer, inside its tenant'); END;
