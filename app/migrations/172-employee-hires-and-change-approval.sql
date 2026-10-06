-- الحزمة 4 (P4-HR-1): سجل الموظف الرئيسي والتغيير التنظيمي المعتمد.
--
-- (1) رابط التوظيف: مرشحٌ مقبول ← حسابٌ في المنصة ← عقدُ ذلك الحساب. كان التوظيف (008) والحسابات (admin) والعقود (025)
--     ثلاثة سجلات لا يربطها شيء: لا يُعرف من أي مرشح جاء الموظف، ولا أي عقد يقابل أي عرض. مرشحٌ واحد لحساب واحد،
--     وحسابٌ واحد لمرشح واحد. الحساب يُربط أولًا، والعقد حين يُعتمد — كلٌّ مرة واحدة، والعقد عقد الحساب نفسه، ولا يُحذف الرابط.
CREATE TABLE employee_hires (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  candidate_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL UNIQUE,
  contract_id TEXT REFERENCES employment_contracts(id),
  evidence TEXT NOT NULL CHECK(length(trim(evidence))>=3),
  linked_by TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  contract_linked_by TEXT REFERENCES users(id),
  contract_linked_at TEXT,
  FOREIGN KEY(candidate_id,tenant_id) REFERENCES people_candidates(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(linked_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(linked_by<>user_id),
  CHECK((contract_id IS NULL)=(contract_linked_by IS NULL)),
  CHECK((contract_id IS NULL)=(contract_linked_at IS NULL))
) STRICT;
CREATE TRIGGER employee_hires_own_contract BEFORE INSERT ON employee_hires
WHEN NEW.contract_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employment_contracts c WHERE c.id=NEW.contract_id AND c.user_id=NEW.user_id AND c.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'a hire link carries the contract of its own account'); END;
CREATE TRIGGER employee_hires_fixed BEFORE UPDATE ON employee_hires
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.candidate_id<>OLD.candidate_id OR NEW.user_id<>OLD.user_id OR NEW.evidence<>OLD.evidence
  OR NEW.linked_by<>OLD.linked_by OR NEW.linked_at<>OLD.linked_at OR OLD.contract_id IS NOT NULL OR NEW.contract_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM employment_contracts c WHERE c.id=NEW.contract_id AND c.user_id=NEW.user_id AND c.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'a hire link is written once: its account at linking, its own contract once, and nothing else'); END;
CREATE TRIGGER employee_hires_no_delete BEFORE DELETE ON employee_hires BEGIN SELECT RAISE(ABORT,'hire links are retained'); END;

-- (2) اعتماد التغيير الوظيفي المؤرخ. كان شخص واحد يسجّل النقل أو الترقية أو المغادرة فيسري في تاريخه بلا رأي ثانٍ.
--     صار التغيير يُسجَّل مفتوحًا، ويعتمده حامل آخر لـ«السجل الوظيفي» غير صاحبه، ولا يسري قبل اعتماده.
--     وقاعدة الشخصين تُتجاوز في موضع واحد: لا حامل آخر في الكيان، فيعتمده من سجّله بسبب مكتوب (self_approval_reason،
--     20 حرفًا فأكثر) يُكتب هنا وفي سجل التدقيق مع two_person:false. والاعتماد مرة واحدة، والشروط لا تتغير بعد التسجيل.
--     prior_manager: المدير المباشر الذي يتركه النقل خلفه، يُكتب لحظة سريان نقل الإدارة وحدها، فيُقرأ «المدير في تاريخ» صادقًا.
--     الصفوف التي سبقت هذا الترحيل وسرت أو أُلغيت تبقى كما هي؛ والمفتوحة منها تنتظر اعتمادها كأي تغيير جديد.
ALTER TABLE employee_changes ADD COLUMN approved_by TEXT REFERENCES users(id);
ALTER TABLE employee_changes ADD COLUMN approved_at TEXT;
ALTER TABLE employee_changes ADD COLUMN self_approval_reason TEXT;
ALTER TABLE employee_changes ADD COLUMN prior_manager TEXT;
DROP TRIGGER employee_change_immutable;
CREATE TRIGGER employee_change_immutable BEFORE UPDATE ON employee_changes
WHEN OLD.applied_at IS NOT NULL OR OLD.cancelled_at IS NOT NULL
  OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.user_id<>OLD.user_id OR NEW.change_type<>OLD.change_type
  OR NEW.from_value<>OLD.from_value OR NEW.to_value<>OLD.to_value OR NEW.effective_from<>OLD.effective_from OR NEW.reason<>OLD.reason
  OR NEW.request_id IS NOT OLD.request_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
  OR (OLD.approved_by IS NOT NULL AND (NEW.approved_by IS NOT OLD.approved_by OR NEW.approved_at IS NOT OLD.approved_at OR NEW.self_approval_reason IS NOT OLD.self_approval_reason))
  OR (NEW.approved_by IS NULL)<>(NEW.approved_at IS NULL)
  OR (NEW.approved_by IS NULL AND NEW.self_approval_reason IS NOT NULL)
  OR NEW.approved_by=NEW.user_id
  OR (NEW.approved_by=NEW.created_by AND length(trim(COALESCE(NEW.self_approval_reason,'')))<20)
  OR (NEW.applied_at IS NOT NULL AND NEW.approved_by IS NULL)
  OR (NEW.prior_manager IS NOT OLD.prior_manager AND (NEW.applied_at IS NULL OR NEW.change_type<>'department'))
BEGIN SELECT RAISE(ABORT,'a settled employee change is immutable; an open one keeps its terms, is approved once by someone other than its subject, and applies only after approval'); END;
CREATE INDEX employee_changes_open ON employee_changes(tenant_id,user_id,applied_at,cancelled_at);
