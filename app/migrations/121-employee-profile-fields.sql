-- 121: ما ينقص ملف الموظف الموحّد وحده، لا أكثر.
-- الملف الموحّد (app/employee-profile.mjs) يركّب أربع تبويبات من سجلات قائمة: employee_profiles وemployment_contracts
-- وemployee_demographics وmedical_enrolments وbenefit_catalog وattendance_exemptions. هذا الترحيل لا يكرر منها حقلًا واحدًا،
-- ولا يوسّع employee_profiles: السجل الوظيفي (employees.mjs) يكتب فيه ويقرؤه بنسخته، وإضافة عمود شخصي إليه تجعل كل
-- تحديث لمسمّى وظيفي يمرّ فوق تاريخ ميلاد. الجديد جدول منفصل بنسخة ومالك تسجيل، على نمط employee_demographics (الترحيل 068).
--
-- ما لا يُسجَّل هنا عمدًا:
--   * رقم الهوية أو الإقامة: المنصة ترفضه بالتصميم (employees.mjs وbenefits-portal.mjs وworkforce.mjs ترفض ستة أرقام
--     متتالية في أي حقل نصي). النظام المرجعي يعرضه فارغًا أصلًا. لا عمود له، الآن ولا لاحقًا.
--   * العمر: مشتق من تاريخ الميلاد عند القراءة. رقم مخزَّن يكذب بعد أول عيد ميلاد.
--   * فئة التأمين الصحي ومزوّده: مسجَّلة منذ الترحيل 066 في medical_policies وmedical_enrolments (المزوّد والفئة ورقم
--     الوثيقة والتابعون)، وتُقرأ عبر benefits.coverageOf. عمود ثانٍ هنا مصدرُ حقيقة ثانٍ يتعارض مع الأول صامتًا.
--   * الجنس والجنسية: مسجَّلان في employee_demographics (الترحيل 068) اختيارًا لا افتراضًا، ومعهما عدّ «غير مسجَّل» معلن.
--
-- كل عمود قابل لـNULL عمدًا: المجهول يبقى مجهولًا. قيمة افتراضية هنا تعني أن تُقرأ لاحقًا كأنها سجّلها إنسان.

CREATE TABLE employee_personal (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  -- تاريخ الميلاد: يُسجَّل من وثيقة يطّلع عليها موظف الموارد البشرية. لا يُقبل تاريخ في المستقبل ولا قبل 1900.
  birth_date TEXT CHECK(birth_date IS NULL OR (birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND birth_date>='1900-01-01')),
  marital_status TEXT CHECK(marital_status IS NULL OR marital_status IN ('single','married','divorced','widowed')),
  education_level TEXT CHECK(education_level IS NULL OR education_level IN ('secondary','diploma','bachelor','master','doctorate')),
  -- التخصص نص حر بحدّ: قائمة تخصصات مغلقة لا تملكها الشركة، وتخصص خارجها كان سيُسجَّل «أخرى» فيضيع.
  education_field TEXT CHECK(education_field IS NULL OR (length(trim(education_field))BETWEEN 2 AND 120)),
  -- الخبرة السابقة بالأشهر قبل الالتحاق بـ3,6T. صفر قيمة مشروعة (لا خبرة سابقة) وتختلف عن NULL (لم تُسجَّل).
  prior_experience_months INTEGER CHECK(prior_experience_months IS NULL OR (prior_experience_months BETWEEN 0 AND 720)),
  -- الوثيقة التي اطُّلع عليها، لا رقمها: نوع الوثيقة فقط، كما في employee_demographics.source.
  source TEXT NOT NULL CHECK(length(trim(source))>=5),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  -- لا يسجّل الموظف بياناته الشخصية بنفسه: مُعِدّ السجل غير صاحبه، كما في employee_demographics والعقود.
  CHECK(recorded_by<>user_id)
) STRICT;

-- نسخة تتقدّم واحدًا واحدًا، والمفتاح لا يتغيّر: تحديث بنسخة قديمة يُرفض في القاعدة لا في الوحدة وحدها.
CREATE TRIGGER employee_personal_versioned BEFORE UPDATE ON employee_personal
WHEN NEW.version<>OLD.version+1 OR NEW.user_id<>OLD.user_id OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'stale personal record'); END;
CREATE TRIGGER employee_personal_no_delete BEFORE DELETE ON employee_personal
BEGIN SELECT RAISE(ABORT,'personal records are retained; record a correction instead'); END;

-- لا بذرة: جدول بيانات شخصية يبدأ فارغًا. ما لم تسجّله الموارد البشرية يُعرض «غير متاح» بسببه، لا بقيمة مخترعة.

-- من قرأ ملف من، ومتى. الملف الموحّد أول شاشة في المنصة يصل منها قارئٌ إلى تاريخ ميلاد زميله وحالته الاجتماعية،
-- ومن يقرأ سجلًا كهذا يُعرف — كما يُسجَّل الاطلاع على قسيمة الراتب (payslip_views، الترحيل 031) وعلى المخالصة
-- وعلى المادة النظامية (policy_article_views، الترحيل 110). لا يُسجَّل اطلاع الموظف على ملفه هو: ليس اطلاعًا على غيره.
-- جدول إلحاقي بحقّه: لا تعديل ولا حذف، فسجل من اطّلع لا يُنقّح بعد وقوعه.
CREATE TABLE employee_profile_views (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  subject_user_id TEXT NOT NULL REFERENCES users(id),
  viewer_id TEXT NOT NULL REFERENCES users(id),
  -- الصفة التي فُتح بها الملف، لا التصريح: «hr» حامل تصريح السجل الوظيفي، و«manager» المدير المباشر.
  scope TEXT NOT NULL CHECK(scope IN ('hr','manager')),
  created_at TEXT NOT NULL,
  CHECK(viewer_id<>subject_user_id),
  FOREIGN KEY(subject_user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX employee_profile_views_subject ON employee_profile_views(subject_user_id,created_at);
CREATE TRIGGER employee_profile_views_fixed BEFORE UPDATE ON employee_profile_views
BEGIN SELECT RAISE(ABORT,'profile view records are append-only'); END;
CREATE TRIGGER employee_profile_views_no_delete BEFORE DELETE ON employee_profile_views
BEGIN SELECT RAISE(ABORT,'profile view records are retained'); END;
