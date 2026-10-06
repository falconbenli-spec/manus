-- الموجة 2 «لا طلب يضيع» — ترحيل 126. كل جداول الموجة تُنشأ معًا، فلا يحتاج نصفها الثاني ترحيلًا ثانيًا:
--   workflow_timer_settings            مهل محرك العمل: مقترحة حتى يتبناها شخص ثانٍ. المهلة غير المتبناة لا تفعل شيئًا.
--   approval_step_escalations          نقل قرار خطوة اعتماد إلى مرجع أعلى. معتمد الخطوة لا يُعدَّل (مشغّل 002-integrity)،
--                                      و(request_id,revision,position) فريد، فالتصعيد الحقيقي جدول جانبي يقرؤه authorizedStep
--                                      كما يقرأ التفويض اليوم. بلا صفوف هنا، من يملك القرار هو من يملكه اليوم حرفًا بحرف.
--   request_assignment_events          إلغاء إسناد وإعادة إسناد وتجاوز أدمن ومغادرة منفّذ، بسبب مكتوب.
--   request_lapses                     انقضاء طلب معاد لعدم الرد: لا يُكتب إلا بمهلة انقضاء متبناة وتذكير سبق إرساله.
--   undeliverable_notices (+قراراتها)  إشعار لم يجد مستلمًا: يُسجَّل حيث يراه من يدير الهيكل، ولا يسقط صامتًا.
-- الخمسة إلحاقية بمشغّلات، وSTRICT، ومقيّدة بالكيان بمفاتيح مركّبة. لا صف ابتدائي: المالك لم يقرر أي مهلة بعد.
--
-- المسودة الأولى لهذا الترحيل كُتبت برقم 120 في a9ac299 ولم تُدمج؛ الرقم 120 صار لترحيل المالك «استوديو المظهر»،
-- و123 و125 محجوزان لفرعين يُبنيان الآن، فأُعيد ترقيمها 126 وروجعت: التصعيد صار سُلَّمًا لا درجة واحدة (level)،
-- ومشغّل إدراجه صار يشترط أن الطلب ما زال «قيد الاعتماد» وأن الخطوة من نسخته الحالية (كما يشترط مشغّل متابعة 013)،
-- والتصعيد بانقضاء المهلة والانقضاء يحملان صف المهلة المتبناة الذي تصرفا بناءً عليه، ويرفض الجدول ما عداه.

-- ── 1) مهل محرك العمل ─────────────────────────────────────────────────────────────
-- المفاتيح المعتمدة ووحدة كل منها ومعناها في app/workflow-timers.mjs (TIMER_KEYS). القيد هنا قيد شكل لا قائمة مغلقة:
-- قائمة مغلقة في CHECK تعني إعادة بناء الجدول عند أول مفتاح جديد (درس ترحيل 099 مع subject_kind).
-- الصف لا تُعدَّل قيمته أبدًا: يُقترح، ثم يتبناه شخص غير من اقترحه، ثم يحل محله صف جديد. السجل كله يبقى.
CREATE TABLE workflow_timer_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  timer_key TEXT NOT NULL CHECK(length(timer_key) BETWEEN 3 AND 60 AND timer_key NOT GLOB '*[^a-z_]*'),
  unit TEXT NOT NULL CHECK(unit IN ('working_days','working_hours')),
  value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 240),
  -- السند المكتوب: من قرر هذا الرقم ومتى ولماذا. رقم بلا سند رأي لا مهلة.
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','adopted','superseded')),
  proposed_by TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  adopted_by TEXT,
  adopted_at TEXT,
  superseded_at TEXT,
  FOREIGN KEY(proposed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(adopted_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من اقترح المهلة لا يتبناها: القرار هوية ثانية.
  CHECK(adopted_by IS NULL OR adopted_by<>proposed_by),
  CHECK((adopted_by IS NULL)=(adopted_at IS NULL)),
  CHECK(status<>'adopted' OR adopted_by IS NOT NULL),
  CHECK(status<>'proposed' OR (adopted_by IS NULL AND superseded_at IS NULL)),
  CHECK((status='superseded')=(superseded_at IS NOT NULL))
) STRICT;
-- مهلة سارية واحدة لكل مفتاح، ومقترح مفتوح واحد: لا يتزاحم رقمان على قرار واحد.
CREATE UNIQUE INDEX workflow_timer_one_adopted ON workflow_timer_settings(tenant_id,timer_key) WHERE status='adopted';
CREATE UNIQUE INDEX workflow_timer_one_proposed ON workflow_timer_settings(tenant_id,timer_key) WHERE status='proposed';
CREATE INDEX workflow_timer_history ON workflow_timer_settings(tenant_id,timer_key,proposed_at);

CREATE TRIGGER workflow_timer_starts_proposed BEFORE INSERT ON workflow_timer_settings
WHEN NEW.status<>'proposed'
BEGIN SELECT RAISE(ABORT,'a workflow timer is born proposed; a second person adopts it'); END;
-- الحركة الوحيدة المسموحة على صف: مقترح ← متبنى، أو مقترح ← مسحوب، أو متبنى ← حلّ محله غيره. القيمة والسند والمقترِح لا تُلمس.
CREATE TRIGGER workflow_timer_lifecycle_only BEFORE UPDATE ON workflow_timer_settings
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.timer_key<>OLD.timer_key OR NEW.unit<>OLD.unit OR NEW.value<>OLD.value
  OR NEW.basis<>OLD.basis OR NEW.proposed_by<>OLD.proposed_by OR NEW.proposed_at<>OLD.proposed_at
  OR OLD.status='superseded'
  OR NOT ((OLD.status='proposed' AND NEW.status IN ('adopted','superseded')) OR (OLD.status='adopted' AND NEW.status='superseded'))
  OR (OLD.status='adopted' AND (NEW.adopted_by IS NOT OLD.adopted_by OR NEW.adopted_at IS NOT OLD.adopted_at))
BEGIN SELECT RAISE(ABORT,'a workflow timer is never edited: it is adopted once, then replaced by a new row'); END;
CREATE TRIGGER workflow_timer_no_delete BEFORE DELETE ON workflow_timer_settings
BEGIN SELECT RAISE(ABORT,'workflow timer history is retained'); END;

-- ── 2) تصعيد خطوة اعتماد: نقل القرار لا تنبيه المتأخر ─────────────────────────────────
-- سُلَّم لا درجة: الصف الأول (level=1) ينقل القرار من معتمد الخطوة الأصلي، وكل صف بعده ينقله ممن وصله قبله.
-- صاحب القرار الآن هو to_user_id في أعلى level؛ وبلا صفوف هو approver_id كما كان. لا يعود القرار إلى أحد مرّ به،
-- ولا يصل صاحب الطلب أبدًا (القاعدة نفسها في مشغّل step_tenant). الحد ثماني درجات، حدّ escalationLadder نفسه.
-- actor_id فارغ = التشغيل اليومي، ولا يصح إلا لأساسين يكتشفهما وحده: انقضاء المهلة، أو فقدان صاحب القرار صفته.
-- timer_row_id: صف المهلة المتبناة الذي تصرف التشغيل بناءً عليه. «timeout» بلا مهلة متبناة يرفضه الجدول نفسه.
CREATE TABLE approval_step_escalations (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES approval_steps(id),
  level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 8),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  basis TEXT NOT NULL CHECK(basis IN ('timeout','unqualified','requester_followup','admin_override')),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  timer_row_id TEXT REFERENCES workflow_timer_settings(id),
  actor_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(step_id,level),
  FOREIGN KEY(request_id,tenant_id) REFERENCES requests(id,tenant_id),
  FOREIGN KEY(from_user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(to_user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(from_user_id<>to_user_id),
  CHECK(actor_id IS NOT NULL OR basis IN ('timeout','unqualified')),
  CHECK((basis='timeout')=(timer_row_id IS NOT NULL))
) STRICT;
CREATE INDEX approval_step_escalations_request ON approval_step_escalations(tenant_id,request_id);
CREATE INDEX approval_step_escalations_to ON approval_step_escalations(tenant_id,to_user_id);
CREATE INDEX approval_step_escalations_from ON approval_step_escalations(tenant_id,from_user_id);

-- الخطوة من هذا الطلب ومن نسخته الحالية، ومعلّقة، والطلب «قيد الاعتماد»؛ و«من» هو صاحب قرارها الآن، والدرجة هي التالية
-- بلا فجوة؛ و«إلى» حسابٌ نشط في الكيان نفسه، وليس صاحب الطلب ولا معتمد الخطوة الأصلي ولا أحدًا مرّ به القرار قبلًا.
-- شرط النشاط ليس تزيّدًا: authorizedStep يحل صاحب القرار بـcurrentUser (active=1)، فصفٌّ إلى حساب موقوف يترك الخطوة
-- بلا من يقررها أصلًا حتى يلتقطها التشغيل اليومي. الكاتب (escalationCandidates) يمنعه، والجدول يعيد قوله كما يعيد
-- قاعدتي صاحب الطلب ومن مرّ به القرار.
CREATE TRIGGER approval_step_escalation_valid BEFORE INSERT ON approval_step_escalations
WHEN NOT EXISTS(SELECT 1 FROM approval_steps s JOIN requests r ON r.id=s.request_id
  WHERE s.id=NEW.step_id AND s.request_id=NEW.request_id AND r.tenant_id=NEW.tenant_id
    AND s.status='pending' AND r.status='pending' AND s.revision=r.revision
    AND r.requester_id<>NEW.to_user_id AND s.approver_id<>NEW.to_user_id
    AND NEW.level=1+(SELECT COUNT(*) FROM approval_step_escalations e WHERE e.step_id=NEW.step_id)
    AND NEW.from_user_id=COALESCE((SELECT e.to_user_id FROM approval_step_escalations e WHERE e.step_id=NEW.step_id ORDER BY e.level DESC LIMIT 1),s.approver_id))
  OR NOT EXISTS(SELECT 1 FROM users a WHERE a.id=NEW.to_user_id AND a.tenant_id=NEW.tenant_id AND a.active=1)
  OR EXISTS(SELECT 1 FROM approval_step_escalations e WHERE e.step_id=NEW.step_id AND NEW.to_user_id IN (e.from_user_id,e.to_user_id))
BEGIN SELECT RAISE(ABORT,'an escalation moves a current pending step of this request from its present decider to the next level: never to the requester, to anyone it already passed, or to a stopped account'); END;
CREATE TRIGGER approval_step_escalation_timer BEFORE INSERT ON approval_step_escalations
WHEN NEW.basis='timeout' AND NOT EXISTS(SELECT 1 FROM workflow_timer_settings t
  WHERE t.id=NEW.timer_row_id AND t.tenant_id=NEW.tenant_id AND t.timer_key='approval_escalation' AND t.status='adopted')
BEGIN SELECT RAISE(ABORT,'a timeout escalation acts only on the adopted approval_escalation timer'); END;
CREATE TRIGGER approval_step_escalation_immutable BEFORE UPDATE ON approval_step_escalations
BEGIN SELECT RAISE(ABORT,'an escalation is written once'); END;
CREATE TRIGGER approval_step_escalation_no_delete BEFORE DELETE ON approval_step_escalations
BEGIN SELECT RAISE(ABORT,'escalation history is retained'); END;

-- ── 3) أحداث إسناد الطلب ──────────────────────────────────────────────────────────
-- طلب «قيد التنفيذ» عند موظف غادر كان نهائيًا: لا إلغاء إسناد ولا إعادة ولا تجاوز. كل حركة من هذه صف هنا بسببه.
--   released         المنفّذ يعيد الطلب إلى طابور إدارته                    to_user_id فارغ
--   reassigned       مدير الإدارة المنفذة يسنده إلى منفّذ آخر من سلسلة تنفيذه  to_user_id مطلوب
--   admin_override   تجاوز مسجَّل حين لا يبقى في الإدارة من يملك الحركة      to_user_id اختياري (فارغ = إلى الطابور)
--   departure        حساب المنفّذ أُوقف، فعاد عمله إلى طابور إدارته            to_user_id فارغ، وactor_id فارغ حين يكتشفه التشغيل اليومي
-- handling_department_id: الطابور الذي عاد إليه الطلب أو بقي فيه لحظة الحدث، فيُقرأ من السجل بعد أي تحويل لاحق.
CREATE TABLE request_assignment_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('released','reassigned','admin_override','departure')),
  from_user_id TEXT NOT NULL,
  to_user_id TEXT,
  handling_department_id TEXT,
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  actor_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(request_id,tenant_id) REFERENCES requests(id,tenant_id),
  FOREIGN KEY(from_user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(to_user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(handling_department_id,tenant_id) REFERENCES departments(id,tenant_id),
  CHECK(to_user_id IS NULL OR to_user_id<>from_user_id),
  CHECK(kind<>'reassigned' OR to_user_id IS NOT NULL),
  CHECK(kind NOT IN ('released','departure') OR to_user_id IS NULL),
  CHECK(actor_id IS NOT NULL OR kind='departure')
) STRICT;
CREATE INDEX request_assignment_events_request ON request_assignment_events(tenant_id,request_id,created_at);

-- صاحب الطلب لا يصير منفّذه بإعادة إسناد، كما لا يستلمه ابتداءً.
CREATE TRIGGER request_assignment_event_not_requester BEFORE INSERT ON request_assignment_events
WHEN NEW.to_user_id IS NOT NULL AND NEW.to_user_id=(SELECT requester_id FROM requests WHERE id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'a request is never assigned to its own requester'); END;
CREATE TRIGGER request_assignment_event_immutable BEFORE UPDATE ON request_assignment_events
BEGIN SELECT RAISE(ABORT,'an assignment event is written once'); END;
CREATE TRIGGER request_assignment_event_no_delete BEFORE DELETE ON request_assignment_events
BEGIN SELECT RAISE(ABORT,'assignment history is retained'); END;

-- ── 4) انقضاء الطلب المعاد ────────────────────────────────────────────────────────
-- قائمة حالات الطلب مغلقة (ثماني حالات في CHECK على جدول تحيل إليه عشرات الجداول)، فلا حالة تاسعة: الطلب المنقضي يُغلق
-- «ملغى»، وهذا الصف هو ما يميّزه عن إلغاء صاحبه ويُقرأ منه «انقضى لعدم الرد». يُكتب قبل تغيير الحالة، في المعاملة نفسها،
-- والجدول نفسه يرفضه ما لم يكن الطلب «معادًا» الآن، ومهلة الانقضاء متبناة، والانتظار بلغها، وتذكير صاحبه سبق الانقضاء.
CREATE TABLE request_lapses (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  revision INTEGER NOT NULL,
  returned_at TEXT NOT NULL,
  returned_by TEXT,
  reminded_at TEXT NOT NULL,
  waited_days INTEGER NOT NULL CHECK(waited_days>=1),
  timer_row_id TEXT NOT NULL REFERENCES workflow_timer_settings(id),
  lapsed_at TEXT NOT NULL,
  FOREIGN KEY(request_id,tenant_id) REFERENCES requests(id,tenant_id),
  FOREIGN KEY(returned_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(returned_at<=reminded_at AND reminded_at<lapsed_at)
) STRICT;
CREATE TRIGGER request_lapse_valid BEFORE INSERT ON request_lapses
WHEN NOT EXISTS(SELECT 1 FROM requests r WHERE r.id=NEW.request_id AND r.tenant_id=NEW.tenant_id AND r.status='returned' AND r.revision=NEW.revision)
  OR NOT EXISTS(SELECT 1 FROM workflow_timer_settings t WHERE t.id=NEW.timer_row_id AND t.tenant_id=NEW.tenant_id
    AND t.timer_key='returned_expiry' AND t.status='adopted' AND NEW.waited_days>=t.value)
BEGIN SELECT RAISE(ABORT,'a request lapses only while returned, on the adopted returned_expiry timer, after waiting at least its value'); END;
CREATE TRIGGER request_lapse_immutable BEFORE UPDATE ON request_lapses
BEGIN SELECT RAISE(ABORT,'a lapse is written once'); END;
CREATE TRIGGER request_lapse_no_delete BEFORE DELETE ON request_lapses
BEGIN SELECT RAISE(ABORT,'lapse history is retained'); END;

-- ── 5) إشعار لم يجد مستلمًا ───────────────────────────────────────────────────────
-- الإشعار الذي لا مستلم له كان يسقط صامتًا (notifySubject يعيد null). صار يمر بمدير الإدارة ثم سُلَّم تصعيدها،
-- فإن لم يبقَ أحد سُجِّل هنا. لا يُخزَّن نص الإشعار ولا عنوان الطلب: من يقرأ هذا الجدول يدير الهيكل ولا يرى الطلبات،
-- وما يحتاجه هو «أي نوع، عن أي سجل، لمن كان، ومن جُرِّب قبله ولماذا لم يصلح» ليسدّ الفراغ في الهيكل.
CREATE TABLE undeliverable_notices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(length(kind) BETWEEN 3 AND 80),
  subject_kind TEXT NOT NULL CHECK(length(subject_kind) BETWEEN 3 AND 60),
  subject_id TEXT NOT NULL CHECK(length(subject_id) BETWEEN 1 AND 200),
  intended_user_id TEXT,
  department_id TEXT,
  tried TEXT NOT NULL CHECK(json_valid(tried)),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  created_at TEXT NOT NULL,
  FOREIGN KEY(intended_user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  -- مفتاح مركّب ليُسنَد إليه قرار المعالجة: بلا هذا يبقى الصف الابن بلا رابط كيان، ويغلق كيانٌ إشعار كيان آخر.
  UNIQUE(id,tenant_id)
) STRICT;
CREATE INDEX undeliverable_notices_recent ON undeliverable_notices(tenant_id,created_at);
CREATE TRIGGER undeliverable_notice_immutable BEFORE UPDATE ON undeliverable_notices
BEGIN SELECT RAISE(ABORT,'an undeliverable notice is written once'); END;
CREATE TRIGGER undeliverable_notice_no_delete BEFORE DELETE ON undeliverable_notices
BEGIN SELECT RAISE(ABORT,'undeliverable notices are retained'); END;
-- «عولج»: قرار مكتوب ممن يدير الهيكل بأن الفراغ سُدّ (عُيّن مدير أو مرجع تصعيد). الصف الأصلي يبقى كما هو.
CREATE TABLE undeliverable_notice_resolutions (
  notice_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  resolved_by TEXT NOT NULL,
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  resolved_at TEXT NOT NULL,
  -- المفتاح مركّب كبقية جداول الموجة: الإشعار وكيانه معًا، فلا يُعلَّم إشعار كيانٍ «عولج» بقرار من كيان آخر.
  FOREIGN KEY(notice_id,tenant_id) REFERENCES undeliverable_notices(id,tenant_id),
  FOREIGN KEY(resolved_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER undeliverable_resolution_immutable BEFORE UPDATE ON undeliverable_notice_resolutions
BEGIN SELECT RAISE(ABORT,'a resolution is written once'); END;
CREATE TRIGGER undeliverable_resolution_no_delete BEFORE DELETE ON undeliverable_notice_resolutions
BEGIN SELECT RAISE(ABORT,'resolutions are retained'); END;
