-- محرك الاعتماد (تدقيق سير العمل B1–B9): إعدادات تضاف ولا تعدّل جدولًا قائمًا.
-- الخدمة تبقى نسخًا لا تُعدَّل؛ أعلامها الجديدة (sod وconfidential وmode:'direct' وخطوات الإدارات الأخرى والشروط)
-- تُخزَّن في approval_policy مع النسخة. ما يتغير دون نسخة جديدة — حدود المبالغ والمعتمد البديل — له جداوله هنا.

-- B1: حدود الاعتماد بالمبالغ. لا مبلغ في الكود ولا في الخدمة: الحد سجل بسنده، يدخله شخص ويعتمده آخر.
-- الحد الساري لمفتاح = آخر سجل معتمد بلغ تاريخ سريانه. مفتاح بلا حد ساري = الخطوة المشروطة به تُطلب احتياطًا.
CREATE TABLE approval_thresholds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  setting_key TEXT NOT NULL CHECK(length(setting_key) BETWEEN 3 AND 60 AND setting_key NOT GLOB '*[^a-z0-9_.]*' AND substr(setting_key,1,1) BETWEEN 'a' AND 'z'),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 0 AND 100000000000000),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected')),
  proposed_by TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(proposed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  -- المُدخل ليس المعتمِد، والقرار مؤرخ باسم صاحبه.
  CHECK(decided_by IS NULL OR decided_by<>proposed_by),
  CHECK((status='proposed')=(decided_by IS NULL)),
  CHECK((decided_by IS NULL)=(decided_at IS NULL))
) STRICT;
CREATE INDEX approval_thresholds_key ON approval_thresholds(tenant_id,setting_key,status,effective_from);

CREATE TRIGGER approval_threshold_decision_only BEFORE UPDATE ON approval_thresholds
WHEN OLD.status<>'proposed' OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.setting_key<>OLD.setting_key
 OR NEW.amount_minor<>OLD.amount_minor OR NEW.basis<>OLD.basis OR NEW.effective_from<>OLD.effective_from
 OR NEW.proposed_by<>OLD.proposed_by OR NEW.proposed_at<>OLD.proposed_at OR NEW.status='proposed'
 OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'an approval threshold is decided once; propose a new one to change it'); END;
CREATE TRIGGER approval_threshold_no_delete BEFORE DELETE ON approval_thresholds
BEGIN SELECT RAISE(ABORT,'approval thresholds are retained'); END;

-- B5: معتمد بديل لكل دور موجَّه في إدارة، يُستعمل حين يكون المعتمد المعيّن هو صاحب الطلب أو المستفيد منه.
-- جدول مستقل بجوار department_routing حتى لا يُمس الجدول القائم.
CREATE TABLE approval_fallbacks (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  department_id TEXT NOT NULL,
  step_role TEXT NOT NULL CHECK(step_role IN ('department_manager','hr','it','pm')),
  fallback_user_id TEXT NOT NULL,
  note TEXT NOT NULL CHECK(length(trim(note))>=3),
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL,
  PRIMARY KEY(department_id,step_role),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(fallback_user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

-- أساس إسناد كل خطوة اعتماد: على أي قاعدة حُلّت (معيارية، بديل، تصعيد، تصعيد لتكرار، رئاسة)
-- ونتيجة شرطها إن وُجد. يُقرأ عند كل قرار ليُعاد التحقق من أن الشخص ما زال يملك الصفة نفسها.
CREATE TABLE approval_step_basis (
  step_id TEXT PRIMARY KEY REFERENCES approval_steps(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL REFERENCES requests(id),
  revision INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4),
  step_role TEXT NOT NULL CHECK(step_role IN ('manager','department_manager','hr','it','pm','executive')),
  department_id TEXT,
  basis TEXT NOT NULL CHECK(basis IN ('standard','fallback','escalation','duplicate_escalation','executive')),
  replaced_user_id TEXT REFERENCES users(id),
  condition TEXT CHECK(condition IS NULL OR json_valid(condition)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX approval_step_basis_request ON approval_step_basis(request_id,revision);
CREATE TRIGGER approval_step_basis_immutable BEFORE UPDATE ON approval_step_basis
BEGIN SELECT RAISE(ABORT,'approval step basis is immutable'); END;
CREATE TRIGGER approval_step_basis_no_delete BEFORE DELETE ON approval_step_basis
BEGIN SELECT RAISE(ABORT,'approval step basis is immutable'); END;

-- تبنّي سياسة اعتماد مقترحة لخدمة من الكتالوج (مثل المسار المباشر للبلاغات). مثبِّت الكتالوج لا يطبّق المقترح
-- إلا بعد تبنٍّ مسجل بسنده؛ policy فارغة = الرجوع إلى تعريف الكتالوج. سجل إلحاقي، آخره هو الساري.
CREATE TABLE approval_policy_adoptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  service_code TEXT NOT NULL,
  proposal_key TEXT NOT NULL,
  policy TEXT CHECK(policy IS NULL OR json_valid(policy)),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  adopted_by TEXT NOT NULL,
  adopted_at TEXT NOT NULL,
  FOREIGN KEY(adopted_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX approval_policy_adoptions_code ON approval_policy_adoptions(tenant_id,service_code,adopted_at);
CREATE TRIGGER approval_policy_adoption_immutable BEFORE UPDATE ON approval_policy_adoptions
BEGIN SELECT RAISE(ABORT,'policy adoptions are an append-only trail'); END;
CREATE TRIGGER approval_policy_adoption_no_delete BEFORE DELETE ON approval_policy_adoptions
BEGIN SELECT RAISE(ABORT,'policy adoptions are an append-only trail'); END;
