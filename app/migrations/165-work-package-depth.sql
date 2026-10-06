-- عمق حزمة العمل — عقد التنفيذ 30 سبتمبر 2026، الحزمة 2 البند 5 «حزم عمل متعددة الإدارات»:
--   «Store department, phase, accountable owner, contributors, dependencies, dates, deliverables,
--    acceptance criteria, budget reference, status, and evidence.»
--   «Detect circular dependencies and prevent completion without required evidence.»
--
-- الإدارة والمرحلة والمسؤول والتواريخ والحالة موجودةٌ منذ 116. والمشاركة بين الإدارات موجودة منذ 142
-- (الإدارة تُشرَك بقرار رئيسها، وعضو المشروع من إدارةٍ مشاركة). الناقص هنا ستة أشياء، ولا كيان ثانٍ:
--   المساهمون، والتبعيات، والمخرجات، ومعايير القبول، ومرجع المخصص، ودليل الإنجاز.
--
-- والقاعدة تحرس ما يمكن أن تحرسه: الحلقة تُرفض في SQL باستعلام تعاودي داخل القادح (SQLite ≥ 3.8.3)،
-- فلا يُدخلها سكربتٌ خارج الكود ولا سباقُ كتابتين. والإنجاز بلا دليل يُرفض في SQL كذلك.

/* ───── 1. حقول الحزمة الناقصة ───── */
-- معايير القبول والمخرجات فارغة للحزم السابقة على هذا الترحيل: تُقرأ «لم تُسجَّل» ولا تُختلق لها قيم.
-- والحزمة الجديدة يفرض الكود أن تحملهما عند إنشائها.
ALTER TABLE work_packages ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT '';
ALTER TABLE work_packages ADD COLUMN deliverables TEXT NOT NULL DEFAULT '[]';
-- مرجع المخصص: مخصصٌ من مخصصات المشروع نفسه (010)، لا نصٌّ حرّ يُكتب فيه ما لا يُفتح.
ALTER TABLE work_packages ADD COLUMN budget_id TEXT REFERENCES project_budgets(id);
-- دليل الإنجاز: يُكتب مرة عند التسليم ولا يُعدَّل بعده.
ALTER TABLE work_packages ADD COLUMN delivery_evidence TEXT NOT NULL DEFAULT '';

CREATE TRIGGER work_packages_deliverables_array_insert BEFORE INSERT ON work_packages
WHEN NOT json_valid(NEW.deliverables) OR json_type(NEW.deliverables)<>'array'
BEGIN SELECT RAISE(ABORT,'deliverables is a JSON array'); END;
CREATE TRIGGER work_packages_deliverables_array_update BEFORE UPDATE OF deliverables ON work_packages
WHEN NOT json_valid(NEW.deliverables) OR json_type(NEW.deliverables)<>'array'
BEGIN SELECT RAISE(ABORT,'deliverables is a JSON array'); END;

-- المخصص من المشروع نفسه وللكيان نفسه: مخصصُ مشروعٍ آخر لا يموّل حزمةً هنا.
CREATE TRIGGER work_packages_budget_same_project_insert BEFORE INSERT ON work_packages
WHEN NEW.budget_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_budgets b
  WHERE b.id=NEW.budget_id AND b.project_id=NEW.project_id AND b.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'a work package budget belongs to its own project'); END;
CREATE TRIGGER work_packages_budget_same_project_update BEFORE UPDATE OF budget_id ON work_packages
WHEN NEW.budget_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_budgets b
  WHERE b.id=NEW.budget_id AND b.project_id=NEW.project_id AND b.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'a work package budget belongs to its own project'); END;

-- لا إنجاز بلا دليل: الانتقال إلى «مسلَّمة» يحمل دليلًا مكتوبًا، والدليل لا يُعدَّل بعد التسليم.
CREATE TRIGGER work_packages_delivered_evidence BEFORE UPDATE OF status ON work_packages
WHEN NEW.status='delivered' AND OLD.status<>'delivered' AND length(trim(NEW.delivery_evidence))<20
BEGIN SELECT RAISE(ABORT,'a delivered work package carries its evidence'); END;
CREATE TRIGGER work_packages_evidence_retained BEFORE UPDATE OF delivery_evidence ON work_packages
WHEN OLD.status='delivered' AND NEW.delivery_evidence IS NOT OLD.delivery_evidence
BEGIN SELECT RAISE(ABORT,'delivery evidence is retained as recorded'); END;

/* ───── 2. المساهمون ───── */
-- المساهم عضوٌ في المشروع (والعضو من إدارةٍ مشاركة بقرار رئيسها — 142)، فالتكليف عبر الإدارات
-- لا يمنح وصولًا أوسع: لا تصريح يُكتب هنا، والمساهمة سجلٌّ يُفتح ويُغلق بسبب ولا يُمحى.
CREATE TABLE work_package_contributors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  package_id TEXT NOT NULL REFERENCES work_packages(id),
  user_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  contribution TEXT NOT NULL CHECK(length(trim(contribution))>=5),
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  removed_by TEXT,
  removed_at TEXT,
  removed_reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(added_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(removed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((removed_at IS NULL)=(removed_by IS NULL)),
  CHECK(removed_at IS NULL OR length(trim(removed_reason))>=5)
) STRICT;
CREATE UNIQUE INDEX work_package_contributors_live ON work_package_contributors(package_id,user_id) WHERE removed_at IS NULL;
CREATE INDEX work_package_contributors_user ON work_package_contributors(user_id,removed_at);

CREATE TRIGGER work_package_contributors_member BEFORE INSERT ON work_package_contributors
WHEN NOT EXISTS(SELECT 1 FROM work_packages p JOIN project_members m ON m.project_id=p.project_id
  WHERE p.id=NEW.package_id AND p.tenant_id=NEW.tenant_id AND m.user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'a contributor is a member of the project'); END;
-- الإغلاق هو التعديل الوحيد، ومرة واحدة.
CREATE TRIGGER work_package_contributors_close_only BEFORE UPDATE ON work_package_contributors
WHEN OLD.removed_at IS NOT NULL
  OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.package_id<>OLD.package_id OR NEW.user_id<>OLD.user_id
  OR NEW.department_id<>OLD.department_id OR NEW.contribution<>OLD.contribution
  OR NEW.added_by<>OLD.added_by OR NEW.added_at<>OLD.added_at
BEGIN SELECT RAISE(ABORT,'a contribution is recorded once and only closed'); END;
CREATE TRIGGER work_package_contributors_no_delete BEFORE DELETE ON work_package_contributors
BEGIN SELECT RAISE(ABORT,'contribution history is retained'); END;

/* ───── 3. التبعيات ───── */
-- «الحزمة ب تعتمد على أ»: لا تُسلَّم ب قبل تسليم أ. والتبعية داخل مشروعٍ واحد، ولا حلقة:
-- يُرفض الحدّ الذي يجعل الحزمة معتمدةً على نفسها ولو عبر سلسلة. التبعية سجلٌّ يُغلق بسبب ولا يُمحى.
CREATE TABLE work_package_dependencies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  package_id TEXT NOT NULL REFERENCES work_packages(id),
  depends_on_id TEXT NOT NULL REFERENCES work_packages(id),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=5),
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  removed_by TEXT,
  removed_at TEXT,
  removed_reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(added_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(removed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(package_id<>depends_on_id),
  CHECK((removed_at IS NULL)=(removed_by IS NULL)),
  CHECK(removed_at IS NULL OR length(trim(removed_reason))>=5)
) STRICT;
CREATE UNIQUE INDEX work_package_dependencies_live ON work_package_dependencies(package_id,depends_on_id) WHERE removed_at IS NULL;
CREATE INDEX work_package_dependencies_on ON work_package_dependencies(depends_on_id,removed_at);

CREATE TRIGGER work_package_dependencies_same_project BEFORE INSERT ON work_package_dependencies
WHEN NOT EXISTS(SELECT 1 FROM work_packages a JOIN work_packages b ON b.project_id=a.project_id AND b.tenant_id=a.tenant_id
  WHERE a.id=NEW.package_id AND b.id=NEW.depends_on_id AND a.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'dependencies stay within one project'); END;
-- الحلقة: هل تصل «depends_on» بالسير على التبعيات الحية إلى الحزمة نفسها؟ فإن وصلت فالحدّ الجديد يُغلق حلقة.
CREATE TRIGGER work_package_dependencies_acyclic BEFORE INSERT ON work_package_dependencies
WHEN EXISTS(
  WITH RECURSIVE reach(id) AS (
    SELECT NEW.depends_on_id
    UNION
    SELECT d.depends_on_id FROM work_package_dependencies d JOIN reach r ON d.package_id=r.id WHERE d.removed_at IS NULL
  ) SELECT 1 FROM reach WHERE id=NEW.package_id)
BEGIN SELECT RAISE(ABORT,'a work package dependency may not close a cycle'); END;
CREATE TRIGGER work_package_dependencies_close_only BEFORE UPDATE ON work_package_dependencies
WHEN OLD.removed_at IS NOT NULL
  OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.package_id<>OLD.package_id OR NEW.depends_on_id<>OLD.depends_on_id
  OR NEW.basis<>OLD.basis OR NEW.added_by<>OLD.added_by OR NEW.added_at<>OLD.added_at
BEGIN SELECT RAISE(ABORT,'a dependency is recorded once and only closed'); END;
CREATE TRIGGER work_package_dependencies_no_delete BEFORE DELETE ON work_package_dependencies
BEGIN SELECT RAISE(ABORT,'dependency history is retained'); END;
