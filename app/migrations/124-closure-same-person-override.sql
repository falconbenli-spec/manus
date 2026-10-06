-- قرار المالك (21 سبتمبر 2026، الخيار «ب»): إقفال المشروع فنيًا وماليًا بيد واحدة ممنوع قاعدةً،
-- لكنه ليس منعًا صلبًا في قاعدة البيانات. الشركة صغيرة، ومدير المشروع قد يكون هو نفسه معتمد المالية؛
-- والقيد الصلب في ترحيل 116 كان يجمّد الإقفال بلا مخرج إلا ترحيلًا جديدًا. فيُنقل المنع إلى الشيفرة
-- (app/project-axes.mjs) مع تجاوز مسجَّل: تصريح حساس، وسبب مكتوب، وقيد تدقيق باسمه.
--
-- ما يبقى مضمونًا في قاعدة البيانات نفسها: قفلان بيد واحدة لا يُكتبان أبدًا بلا سبب مكتوب (20 حرفًا فأكثر).
-- فالتجاوز قد يُمنح، لكنه لا يمر صامتًا حتى لو كُتب الصف من خارج الشيفرة.
--
-- إعادة البناء بلا إعادة تسمية: تُنسخ الصفوف إلى جدول مؤقت، يُسقط الأصل، يُنشأ الجدول الجديد باسمه مباشرة، ثم تُعاد الصفوف.
-- السبب: project_closure_reopenings يحيل إلى project_closures بالاسم. إعادة تسمية الأصل كانت ستعيد كتابة إحالته،
-- والإسقاط (مع فحص المراجع) يحذف صفوف الأصل ضمنيًا فيُحتسب كل قيد إعادة فتح مخالفةً مؤجلة. المخالفة المؤجلة
-- لا تزول إلا بإدراج الصف الأب نفسه من جديد — وهذا ما يفعله الإدراج الأخير، فتُغلق المعاملة نظيفة حتى مع وجود قيود إعادة فتح.
PRAGMA defer_foreign_keys=ON;

CREATE TEMP TABLE project_closures_carry AS SELECT * FROM project_closures;

-- مشغّل منع الحذف يُزال مع جدوله، ويعود على الجدول الجديد أدناه.
DROP TRIGGER project_closures_no_delete;
DROP TRIGGER project_closures_versioned;
DROP TABLE project_closures;

CREATE TABLE project_closures (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
  case_id TEXT REFERENCES commercial_cases(id),
  technical_state TEXT NOT NULL DEFAULT 'open' CHECK(technical_state IN ('open','closed')),
  technical_closed_by TEXT,
  technical_closed_at TEXT,
  technical_note TEXT NOT NULL DEFAULT '',
  certificate_id TEXT REFERENCES completion_certificates(id),
  financial_state TEXT NOT NULL DEFAULT 'open' CHECK(financial_state IN ('open','closed')),
  financial_closed_by TEXT,
  financial_closed_at TEXT,
  financial_note TEXT NOT NULL DEFAULT '',
  final_state TEXT NOT NULL DEFAULT 'open' CHECK(final_state IN ('open','closed')),
  final_closed_by TEXT,
  final_closed_at TEXT,
  profitability_note TEXT NOT NULL DEFAULT '',
  lessons TEXT NOT NULL DEFAULT '',
  -- التجاوز: لماذا أقفل الشخص نفسه القفلين، ومتى. فارغ ما دام القفلان بيدين مختلفتين.
  same_person_reason TEXT NOT NULL DEFAULT '',
  same_person_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(technical_closed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(financial_closed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(final_closed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  -- قفلان بيد واحدة ليسا قفلين إلا بسبب مكتوب: المنع في الشيفرة، وهذا ما لا يُتجاوز حتى من خارجها.
  CHECK(technical_closed_by IS NULL OR financial_closed_by IS NULL OR technical_closed_by<>financial_closed_by
    OR (length(trim(same_person_reason))>=20 AND same_person_at IS NOT NULL)),
  -- والسبب لا يُكتب على إقفال لم يجتمع قفلاه في يد واحدة: تجاوز بلا حاجة إليه تضليل في السجل.
  CHECK(same_person_reason='' OR (technical_closed_by IS NOT NULL AND technical_closed_by=financial_closed_by)),
  CHECK((technical_state='closed')=(technical_closed_by IS NOT NULL AND technical_closed_at IS NOT NULL AND certificate_id IS NOT NULL)),
  CHECK((financial_state='closed')=(financial_closed_by IS NOT NULL AND financial_closed_at IS NOT NULL)),
  -- الإقفال النهائي يشترط الاثنين، والربحية والدروس مكتوبتين.
  CHECK((final_state='closed')=(final_closed_by IS NOT NULL AND final_closed_at IS NOT NULL
    AND technical_state='closed' AND financial_state='closed'
    AND length(trim(profitability_note))>=20 AND length(trim(lessons))>=20))
) STRICT;

INSERT INTO project_closures(id,tenant_id,project_id,case_id,technical_state,technical_closed_by,technical_closed_at,technical_note,certificate_id,
  financial_state,financial_closed_by,financial_closed_at,financial_note,final_state,final_closed_by,final_closed_at,profitability_note,lessons,
  same_person_reason,same_person_at,version,created_at,updated_at)
SELECT id,tenant_id,project_id,case_id,technical_state,technical_closed_by,technical_closed_at,technical_note,certificate_id,
  financial_state,financial_closed_by,financial_closed_at,financial_note,final_state,final_closed_by,final_closed_at,profitability_note,lessons,
  '',NULL,version,created_at,updated_at
FROM project_closures_carry;
DROP TABLE project_closures_carry;

CREATE TRIGGER project_closures_versioned BEFORE UPDATE ON project_closures
WHEN NEW.version<>OLD.version+1 OR NEW.project_id<>OLD.project_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'closure changes carry the next version'); END;
CREATE TRIGGER project_closures_no_delete BEFORE DELETE ON project_closures
BEGIN SELECT RAISE(ABORT,'closure history is retained'); END;
