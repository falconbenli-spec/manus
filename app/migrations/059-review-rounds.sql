-- جولات المراجعة الإبداعية: مسار متعدد المراحل على نسخة محددة من مخرج الاستوديو، وتعليق مثبَّت على موضع في المادة نفسها.
-- ثلاثة قرارات لا اثنان: موافق · موافق مع تعديلات · تعديلات مطلوبة. الثاني يعني «امضِ في التنفيذ والتزم بالملاحظات».
-- القرار مرتبط بنسخة لا بملف، ولا يُعدَّل بعد صدوره؛ التراجع قرار جديد على نسخة جديدة (مسار جديد).
-- لا رابط مراجعة خارجي بلا حساب: مرحلة العميل تُغلق بسجل موافقة خارجية موثقة على النسخة نفسها (external_approvals)،
-- كما يفعل client-approvals.mjs اليوم. لا دخول للعميل إلى المنصة ولا توقيع إلكتروني منه.

CREATE TABLE review_route_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retired_at TEXT,
  retired_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(tenant_id,name),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((retired_at IS NULL)=(retired_by IS NULL))
) STRICT;

-- مراحل القالب: الترتيب بـposition، والمراحل التي تتساوى في position تعمل متوازية وتبدأ معًا.
-- المُدد كلها اختيارية بلا قيمة افتراضية: ما لم يدخل صاحب المسار مدةً فلا موعد ولا تذكير ولا تصعيد.
CREATE TABLE review_template_stages (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES review_route_templates(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 20),
  name TEXT NOT NULL CHECK(length(trim(name))>=2),
  audience TEXT NOT NULL CHECK(audience IN ('internal','client')),
  reviewer_ids TEXT NOT NULL CHECK(json_valid(reviewer_ids) AND json_array_length(reviewer_ids)>=1),
  due_days INTEGER CHECK(due_days IS NULL OR due_days BETWEEN 1 AND 365),
  reminder_days INTEGER CHECK(reminder_days IS NULL OR reminder_days BETWEEN 1 AND 365),
  escalation_days INTEGER CHECK(escalation_days IS NULL OR escalation_days BETWEEN 1 AND 365),
  UNIQUE(template_id,position,name),
  -- التذكير قبل الموعد لا بعده، ولا تذكير بلا موعد.
  CHECK(reminder_days IS NULL OR (due_days IS NOT NULL AND reminder_days<due_days))
) STRICT;

CREATE TABLE review_routes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  studio_id TEXT NOT NULL REFERENCES studio_workspaces(id),
  output_id TEXT NOT NULL REFERENCES studio_outputs(id),
  -- نسخة واحدة = مسار واحد. مراجعة نسخة أحدث تبدأ مسارًا جديدًا ولا تعدّل قرارات السابق.
  output_version_id TEXT NOT NULL UNIQUE REFERENCES studio_output_versions(id),
  output_revision INTEGER NOT NULL CHECK(output_revision>0),
  output_digest TEXT NOT NULL,
  template_id TEXT REFERENCES review_route_templates(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  -- مالك الملف: إليه يُصعَّد توقف أي مرحلة.
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','approved','approved_with_changes','changes_required','cancelled')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='running')=(closed_at IS NULL)),
  -- من يفتح المسار لا يكون مالك الملف الذي يُصعَّد إليه توقفه.
  CHECK(owner_id<>created_by)
) STRICT;

CREATE TABLE review_stages (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES review_routes(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 20),
  name TEXT NOT NULL CHECK(length(trim(name))>=2),
  audience TEXT NOT NULL CHECK(audience IN ('internal','client')),
  due_days INTEGER CHECK(due_days IS NULL OR due_days BETWEEN 1 AND 365),
  reminder_days INTEGER CHECK(reminder_days IS NULL OR reminder_days BETWEEN 1 AND 365),
  escalation_days INTEGER CHECK(escalation_days IS NULL OR escalation_days BETWEEN 1 AND 365),
  status TEXT NOT NULL CHECK(status IN ('waiting','open','decided','cancelled')),
  opened_on TEXT,
  due_on TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(route_id,position,name),
  CHECK((status IN ('waiting','cancelled')) OR opened_on IS NOT NULL),
  CHECK(due_on IS NULL OR opened_on IS NOT NULL),
  CHECK(reminder_days IS NULL OR (due_days IS NOT NULL AND reminder_days<due_days))
) STRICT;

CREATE TABLE review_stage_reviewers (
  stage_id TEXT NOT NULL REFERENCES review_stages(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL,
  PRIMARY KEY(stage_id,reviewer_id)
) STRICT;

CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY,
  -- قرار واحد لكل مرحلة: لا تعديل ولا قرار ثانٍ على المرحلة نفسها.
  stage_id TEXT NOT NULL UNIQUE REFERENCES review_stages(id),
  route_id TEXT NOT NULL REFERENCES review_routes(id),
  output_version_id TEXT NOT NULL REFERENCES studio_output_versions(id),
  decision TEXT NOT NULL CHECK(decision IN ('approved','approved_with_changes','changes_required')),
  note TEXT NOT NULL CHECK(length(trim(note))>=3),
  -- مرحلة العميل فقط: سجل الموافقة الخارجية الموثقة على النسخة نفسها.
  external_approval_id TEXT REFERENCES external_approvals(id),
  decided_by TEXT NOT NULL REFERENCES users(id),
  decided_at TEXT NOT NULL
) STRICT;

-- المادة الخاضعة للمراجعة، محفوظة داخل المنصة. تُعرض من مسار داخلي؛ لا مورد خارجي ولا رابط عام.
CREATE TABLE review_media (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  route_id TEXT NOT NULL REFERENCES review_routes(id),
  kind TEXT NOT NULL CHECK(kind IN ('image','pdf','video','audio','text')),
  label TEXT NOT NULL CHECK(length(trim(label))>=3),
  filename TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL CHECK(media_type IN ('image/png','image/jpeg','application/pdf','video/mp4','audio/mpeg','text/plain')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152),
  digest TEXT NOT NULL,
  content BLOB,
  body TEXT,
  -- عدد الصفحات والمدة يدخلهما الرافع: لا استخراج تلقائي من الملف، ولا قيمة مفترضة.
  pages INTEGER CHECK(pages IS NULL OR pages BETWEEN 1 AND 2000),
  duration_seconds INTEGER CHECK(duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 86400),
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(route_id,digest),
  FOREIGN KEY(uploaded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((kind='text')=(content IS NULL)),
  CHECK((kind='text')=(body IS NOT NULL)),
  CHECK(kind<>'text'  OR media_type='text/plain'),
  CHECK(kind<>'image' OR media_type IN ('image/png','image/jpeg')),
  CHECK(kind<>'pdf'   OR (media_type='application/pdf' AND pages IS NOT NULL)),
  CHECK(kind<>'video' OR media_type='video/mp4'),
  CHECK(kind<>'audio' OR media_type='audio/mpeg'),
  CHECK(kind IN ('video','audio') OR duration_seconds IS NULL),
  CHECK(kind='pdf' OR pages IS NULL)
) STRICT;

-- تعليق مثبَّت على موضع: الإحداثيات نسبية (0..1) لا بالبكسل حتى يبقى التعليق في موضعه مهما تغيّر حجم العرض.
-- visibility فصل صريح: 'internal' لا يخرج إلى العميل إطلاقًا، و'shared' هو وحده ما يُسلَّم له.
CREATE TABLE review_annotations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  media_id TEXT NOT NULL REFERENCES review_media(id),
  stage_id TEXT REFERENCES review_stages(id),
  anchor TEXT NOT NULL CHECK(anchor IN ('point','timestamp','text_range')),
  page INTEGER CHECK(page IS NULL OR page BETWEEN 1 AND 2000),
  x REAL CHECK(x IS NULL OR (x>=0.0 AND x<=1.0)),
  y REAL CHECK(y IS NULL OR (y>=0.0 AND y<=1.0)),
  at_seconds REAL CHECK(at_seconds IS NULL OR at_seconds>=0.0),
  char_start INTEGER CHECK(char_start IS NULL OR char_start>=0),
  char_end INTEGER CHECK(char_end IS NULL OR char_end>0),
  visibility TEXT NOT NULL CHECK(visibility IN ('internal','shared')),
  body TEXT NOT NULL CHECK(length(trim(body))>=3),
  status TEXT NOT NULL CHECK(status IN ('open','addressed','wont_fix')),
  resolution_note TEXT NOT NULL DEFAULT '',
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((anchor='point')=(x IS NOT NULL AND y IS NOT NULL)),
  CHECK((anchor='timestamp')=(at_seconds IS NOT NULL)),
  CHECK((anchor='text_range')=(char_start IS NOT NULL AND char_end IS NOT NULL)),
  CHECK(char_end IS NULL OR char_end>char_start),
  CHECK(anchor='point' OR page IS NULL),
  CHECK((status='open')=(resolved_by IS NULL)),
  CHECK((resolved_by IS NULL)=(resolved_at IS NULL)),
  -- «لن يُعالج» بلا سبب ليس قرارًا.
  CHECK(status<>'wont_fix' OR length(trim(resolution_note))>=3)
) STRICT;

-- التذكير والتصعيد داخل المنصة، بلا بريد: لا مزوّد بريد بعد، ولا صف هنا يدّعي إرسالًا خارجيًا.
-- جدول `notifications` الأساسي يشترط request_id لطلب خدمة قائم، ومسار المراجعة ليس طلب خدمة؛
-- فحُفظت إشعارات المراجعة هنا بالشكل نفسه (مستخدم · نوع · مقروء) حتى يوحّدها المنسّق في ترحيل يملكه.
CREATE TABLE review_notices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  route_id TEXT NOT NULL REFERENCES review_routes(id),
  stage_id TEXT NOT NULL REFERENCES review_stages(id),
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('review_stage_opened','review_due_reminder','review_stage_escalated')),
  due_on TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(stage_id,user_id,kind),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

CREATE INDEX review_routes_scope ON review_routes(tenant_id,studio_id,status);
CREATE INDEX review_routes_output ON review_routes(output_id,output_revision);
CREATE INDEX review_stages_route ON review_stages(route_id,position,status);
CREATE INDEX review_media_route ON review_media(route_id,kind);
CREATE INDEX review_annotations_media ON review_annotations(media_id,visibility,status);
CREATE INDEX review_notices_user ON review_notices(user_id,read_at,created_at);

-- من أعدّ النسخة أو فتح مسارها لا يراجعها.
CREATE TRIGGER review_stage_reviewer_independent BEFORE INSERT ON review_stage_reviewers
WHEN EXISTS(SELECT 1 FROM review_stages s JOIN review_routes r ON r.id=s.route_id JOIN studio_output_versions ver ON ver.id=r.output_version_id
            WHERE s.id=NEW.stage_id AND (ver.created_by=NEW.reviewer_id OR r.created_by=NEW.reviewer_id))
BEGIN SELECT RAISE(ABORT,'the author of the version and the person who opened the route do not review it'); END;
CREATE TRIGGER review_stage_reviewers_locked BEFORE INSERT ON review_stage_reviewers
WHEN EXISTS(SELECT 1 FROM review_stages s WHERE s.id=NEW.stage_id AND s.status<>'waiting')
BEGIN SELECT RAISE(ABORT,'reviewers are named before the stage opens'); END;
CREATE TRIGGER review_stage_reviewers_no_update BEFORE UPDATE ON review_stage_reviewers
BEGIN SELECT RAISE(ABORT,'a named reviewer is not rewritten in place'); END;
CREATE TRIGGER review_stage_reviewers_no_delete BEFORE DELETE ON review_stage_reviewers
WHEN EXISTS(SELECT 1 FROM review_stages s WHERE s.id=OLD.stage_id AND s.status<>'waiting')
BEGIN SELECT RAISE(ABORT,'reviewers of an open or decided stage are retained'); END;

-- القرار: مرحلة مفتوحة، من مراجع مسمى فيها، ومن غير معدّ النسخة ولا فاتح المسار.
CREATE TRIGGER review_decision_authority BEFORE INSERT ON review_decisions
WHEN NOT EXISTS(SELECT 1 FROM review_stage_reviewers x WHERE x.stage_id=NEW.stage_id AND x.reviewer_id=NEW.decided_by)
  OR NOT EXISTS(SELECT 1 FROM review_stages s WHERE s.id=NEW.stage_id AND s.status='open' AND s.route_id=NEW.route_id)
  OR NOT EXISTS(SELECT 1 FROM review_routes r WHERE r.id=NEW.route_id AND r.status='running'
                 AND r.output_version_id=NEW.output_version_id AND r.created_by<>NEW.decided_by)
  OR EXISTS(SELECT 1 FROM studio_output_versions ver WHERE ver.id=NEW.output_version_id AND ver.created_by=NEW.decided_by)
BEGIN SELECT RAISE(ABORT,'a stage decision comes from an assigned reviewer of an open stage, never from the author of the version under review'); END;
-- مرحلة العميل لا تُغلق إلا بموافقة خارجية موثقة على النسخة نفسها؛ لا رابط ولا حساب للعميل.
CREATE TRIGGER review_decision_client_evidence BEFORE INSERT ON review_decisions
WHEN (SELECT audience FROM review_stages WHERE id=NEW.stage_id)='client'
 AND NOT EXISTS(SELECT 1 FROM external_approvals a WHERE a.id=NEW.external_approval_id
                 AND a.output_version_id=NEW.output_version_id AND a.status IN ('documented','verified'))
BEGIN SELECT RAISE(ABORT,'a client stage closes only on a documented external approval recorded against the same version'); END;
CREATE TRIGGER review_decision_internal_scope BEFORE INSERT ON review_decisions
WHEN (SELECT audience FROM review_stages WHERE id=NEW.stage_id)='internal' AND NEW.external_approval_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'an internal stage carries no client approval reference'); END;
CREATE TRIGGER review_decisions_no_update BEFORE UPDATE ON review_decisions
BEGIN SELECT RAISE(ABORT,'a review decision is final; reverse it with a new decision on a new version'); END;
CREATE TRIGGER review_decisions_no_delete BEFORE DELETE ON review_decisions
BEGIN SELECT RAISE(ABORT,'review decisions are retained'); END;

CREATE TRIGGER review_routes_versioned BEFORE UPDATE ON review_routes
WHEN NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.studio_id<>OLD.studio_id
  OR NEW.output_id<>OLD.output_id OR NEW.output_version_id<>OLD.output_version_id OR NEW.output_digest<>OLD.output_digest
  OR NEW.owner_id<>OLD.owner_id OR NEW.created_by<>OLD.created_by OR NEW.opened_at<>OLD.opened_at OR OLD.status<>'running'
BEGIN SELECT RAISE(ABORT,'a review route is bound to one version and a closed route is not reopened'); END;
CREATE TRIGGER review_routes_no_delete BEFORE DELETE ON review_routes
BEGIN SELECT RAISE(ABORT,'review history is retained'); END;

CREATE TRIGGER review_stages_versioned BEFORE UPDATE ON review_stages
WHEN NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.route_id<>OLD.route_id OR NEW.position<>OLD.position
  OR NEW.name<>OLD.name OR NEW.audience<>OLD.audience OR NEW.due_days IS NOT OLD.due_days
  OR NEW.reminder_days IS NOT OLD.reminder_days OR NEW.escalation_days IS NOT OLD.escalation_days
  OR OLD.status IN ('decided','cancelled')
BEGIN SELECT RAISE(ABORT,'stage identity and its agreed periods are fixed, and a decided stage does not reopen'); END;
CREATE TRIGGER review_stages_no_delete BEFORE DELETE ON review_stages
BEGIN SELECT RAISE(ABORT,'review stages are retained'); END;

CREATE TRIGGER review_media_no_update BEFORE UPDATE ON review_media
BEGIN SELECT RAISE(ABORT,'material under review is immutable; a changed file is a new version with its own route'); END;
CREATE TRIGGER review_media_no_delete BEFORE DELETE ON review_media
BEGIN SELECT RAISE(ABORT,'material under review is retained'); END;

-- الموضع يجب أن يناسب المادة، ويقع داخل حدودها المعلنة.
CREATE TRIGGER review_annotation_anchor_matches_media BEFORE INSERT ON review_annotations
WHEN NOT EXISTS(SELECT 1 FROM review_media m WHERE m.id=NEW.media_id AND m.tenant_id=NEW.tenant_id AND (
      (m.kind='image' AND NEW.anchor='point' AND NEW.page IS NULL)
   OR (m.kind='pdf'   AND NEW.anchor='point' AND NEW.page IS NOT NULL AND NEW.page<=m.pages)
   OR (m.kind IN ('video','audio') AND NEW.anchor='timestamp' AND (m.duration_seconds IS NULL OR NEW.at_seconds<=m.duration_seconds))
   OR (m.kind='text' AND NEW.anchor='text_range' AND NEW.char_end<=length(m.body))))
BEGIN SELECT RAISE(ABORT,'the anchor must fit the material: relative x/y (with a page for PDF), a timestamp for video and audio, a character range for text'); END;
-- نص التعليق وموضعه وجمهوره لا تتغير بعد كتابته؛ ما يُسجَّل لاحقًا هو إغلاقه، مرة واحدة.
CREATE TRIGGER review_annotations_content_fixed BEFORE UPDATE ON review_annotations
WHEN NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.media_id<>OLD.media_id
  OR NEW.stage_id IS NOT OLD.stage_id OR NEW.visibility<>OLD.visibility OR NEW.body<>OLD.body OR NEW.anchor<>OLD.anchor
  OR NEW.page IS NOT OLD.page OR NEW.x IS NOT OLD.x OR NEW.y IS NOT OLD.y OR NEW.at_seconds IS NOT OLD.at_seconds
  OR NEW.char_start IS NOT OLD.char_start OR NEW.char_end IS NOT OLD.char_end
  OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR OLD.status<>'open'
BEGIN SELECT RAISE(ABORT,'an annotation keeps its text, its place and its audience; only its closure is recorded, once'); END;
CREATE TRIGGER review_annotations_no_delete BEFORE DELETE ON review_annotations
BEGIN SELECT RAISE(ABORT,'annotations are retained'); END;

CREATE TRIGGER review_template_stages_no_update BEFORE UPDATE ON review_template_stages
BEGIN SELECT RAISE(ABORT,'a template stage is replaced by saving a new template, not edited'); END;
CREATE TRIGGER review_templates_versioned BEFORE UPDATE ON review_route_templates
WHEN NEW.version<>OLD.version+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.name<>OLD.name
  OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR OLD.retired_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'a template is retired, not rewritten'); END;
CREATE TRIGGER review_templates_no_delete BEFORE DELETE ON review_route_templates
BEGIN SELECT RAISE(ABORT,'templates are retired, not deleted'); END;

CREATE TRIGGER review_notices_read_only BEFORE UPDATE ON review_notices
WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.stage_id<>OLD.stage_id OR NEW.kind<>OLD.kind OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'only the read mark of a notice changes'); END;
