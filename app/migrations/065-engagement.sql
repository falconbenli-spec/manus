-- الارتباط: استبيان النبض وeNPS، والتقدير بين الزملاء، والإعلانات الداخلية وتقويم الفعاليات.
--
-- القاعدة الحاكمة للاستبيان: الشركة من 30 إلى 60 موظفًا وأقسامها من 3 إلى 6 أشخاص.
-- أي تقسيم للنتائج حسب القسم يكشف صاحب الرأي، فالمنع هنا بنيوي لا بالاتفاق:
-- جدول الإجابات لا يحمل عمود مستخدم ولا عمود إدارة ولا طابعًا زمنيًا ولا حتى rowid يرتب الإدخال،
-- وجدول المشاركة منفصل عنه ولا يجمعهما مفتاح غير دورة الاستبيان كلها.
-- الحد الأدنى للمستجيبين إعداد مؤرّخ يدخله مدير الموارد البشرية؛ لا قيمة افتراضية في الكود ولا في المخطط.

CREATE TABLE survey_privacy_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  min_respondents INTEGER NOT NULL CHECK(min_respondents BETWEEN 2 AND 500),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  set_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,effective_from),
  FOREIGN KEY(set_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX survey_privacy_lookup ON survey_privacy_settings(tenant_id,effective_from);
-- الإعداد مؤرّخ: تغييره سطر جديد بتاريخ سريان جديد، لا تعديل على سطر عملت به دورة سابقة.
CREATE TRIGGER survey_privacy_no_update BEFORE UPDATE ON survey_privacy_settings BEGIN SELECT RAISE(ABORT,'a dated setting is superseded by a new row, not edited'); END;
CREATE TRIGGER survey_privacy_no_delete BEFORE DELETE ON survey_privacy_settings BEGIN SELECT RAISE(ABORT,'dated settings are retained'); END;

CREATE TABLE pulse_cycles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  purpose TEXT NOT NULL DEFAULT '',
  opens_on TEXT NOT NULL CHECK(opens_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  closes_on TEXT NOT NULL CHECK(closes_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND closes_on>=opens_on),
  status TEXT NOT NULL CHECK(status IN ('draft','open','closed')),
  -- الحد الأدنى يُثبَّت في الدورة لحظة فتحها: تغيير الإعداد لاحقًا لا يكشف نتائج جُمعت بوعد آخر.
  min_respondents INTEGER CHECK(min_respondents IS NULL OR min_respondents>=2),
  privacy_setting_id TEXT REFERENCES survey_privacy_settings(id),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  opened_by TEXT REFERENCES users(id),
  opened_at TEXT,
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='draft')=(opened_by IS NULL)),
  CHECK((status='closed')=(closed_by IS NOT NULL)),
  -- من يعدّ أسئلة الاستبيان لا يفتحه وحده: صياغة السؤال نفسها قد تحدد من يُسأل عنه.
  CHECK(opened_by IS NULL OR opened_by<>prepared_by),
  CHECK(status='draft' OR (min_respondents IS NOT NULL AND privacy_setting_id IS NOT NULL))
) STRICT;
CREATE INDEX pulse_cycles_status ON pulse_cycles(tenant_id,status,opens_on);
CREATE TRIGGER pulse_cycles_versioned BEFORE UPDATE ON pulse_cycles
WHEN NEW.version<>OLD.version+1 OR OLD.status='closed'
  OR (OLD.status<>'draft' AND (NEW.title<>OLD.title OR NEW.purpose<>OLD.purpose OR NEW.opens_on<>OLD.opens_on OR NEW.closes_on<>OLD.closes_on
    OR NEW.prepared_by<>OLD.prepared_by OR NEW.opened_by IS NOT OLD.opened_by
    OR NEW.min_respondents IS NOT OLD.min_respondents OR NEW.privacy_setting_id IS NOT OLD.privacy_setting_id))
BEGIN SELECT RAISE(ABORT,'an open cycle is closed, never rewritten'); END;
CREATE TRIGGER pulse_cycles_no_delete BEFORE DELETE ON pulse_cycles WHEN OLD.status<>'draft' BEGIN SELECT RAISE(ABORT,'cycles that collected answers are retained'); END;

CREATE TABLE pulse_questions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  cycle_id TEXT NOT NULL REFERENCES pulse_cycles(id),
  position INTEGER NOT NULL CHECK(position>0),
  kind TEXT NOT NULL CHECK(kind IN ('scale','enps','comment')),
  prompt TEXT NOT NULL CHECK(length(trim(prompt))>=5),
  UNIQUE(cycle_id,position)
) STRICT;
CREATE TRIGGER pulse_questions_draft_only BEFORE INSERT ON pulse_questions
WHEN (SELECT status FROM pulse_cycles WHERE id=NEW.cycle_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'questions belong to a draft cycle'); END;
CREATE TRIGGER pulse_questions_no_update BEFORE UPDATE ON pulse_questions BEGIN SELECT RAISE(ABORT,'a draft cycle replaces its questions; it does not edit them'); END;
CREATE TRIGGER pulse_questions_frozen BEFORE DELETE ON pulse_questions
WHEN (SELECT status FROM pulse_cycles WHERE id=OLD.cycle_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'the questions of an opened cycle are fixed'); END;

-- الإجابات: لا عمود مستخدم، ولا إدارة، ولا طابع زمني، ولا rowid.
-- WITHOUT ROWID يعني أن ترتيب الجدول هو ترتيب المفتاح العشوائي لا ترتيب التقديم،
-- فلا يُستنتج «من أجاب أولًا» بمطابقة تسلسل الإدخال مع تسلسل المشاركة.
CREATE TABLE pulse_answers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  cycle_id TEXT NOT NULL REFERENCES pulse_cycles(id),
  question_id TEXT NOT NULL REFERENCES pulse_questions(id),
  value INTEGER,
  comment TEXT NOT NULL DEFAULT '',
  CHECK(value IS NOT NULL OR length(trim(comment))>0)
) STRICT, WITHOUT ROWID;
CREATE INDEX pulse_answers_question ON pulse_answers(cycle_id,question_id);
CREATE TRIGGER pulse_answers_open_only BEFORE INSERT ON pulse_answers
WHEN (SELECT status FROM pulse_cycles WHERE id=NEW.cycle_id)<>'open'
BEGIN SELECT RAISE(ABORT,'answers are accepted only while the cycle is open'); END;
CREATE TRIGGER pulse_answers_no_update BEFORE UPDATE ON pulse_answers BEGIN SELECT RAISE(ABORT,'an anonymous answer cannot be edited'); END;
CREATE TRIGGER pulse_answers_no_delete BEFORE DELETE ON pulse_answers BEGIN SELECT RAISE(ABORT,'an anonymous answer cannot be deleted; nobody can prove which one to remove'); END;

-- المشاركة: «فلان شارك» فقط، وباليوم لا باللحظة. لحظة دقيقة هنا مع أي ترتيب هناك تساوي هوية.
CREATE TABLE pulse_participants (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  cycle_id TEXT NOT NULL REFERENCES pulse_cycles(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  responded_on TEXT NOT NULL CHECK(responded_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  PRIMARY KEY(cycle_id,user_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER pulse_participants_no_update BEFORE UPDATE ON pulse_participants BEGIN SELECT RAISE(ABORT,'participation is recorded once'); END;
CREATE TRIGGER pulse_participants_no_delete BEFORE DELETE ON pulse_participants BEGIN SELECT RAISE(ABORT,'participation is retained'); END;

-- التقدير بين الزملاء: بطاقة مرتبطة بقيمة مؤسسية يعرّفها صاحب الإجراء.
-- لا عمود نقاط ولا وزن ولا رتبة في أي من الجدولين: التقدير المحوَّل إلى مسابقة يصير أداة ضغط.
CREATE TABLE recognition_values (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=2),
  description TEXT NOT NULL CHECK(length(trim(description))>=10),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=5),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  defined_by TEXT NOT NULL REFERENCES users(id),
  retired_on TEXT,
  retired_by TEXT REFERENCES users(id),
  retired_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,name),
  FOREIGN KEY(defined_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(retired_on IS NULL OR (retired_by IS NOT NULL AND length(trim(retired_reason))>=3))
) STRICT;
CREATE TRIGGER recognition_values_retire_only BEFORE UPDATE ON recognition_values
WHEN NEW.version<>OLD.version+1 OR OLD.retired_on IS NOT NULL
  OR NEW.name<>OLD.name OR NEW.description<>OLD.description OR NEW.basis<>OLD.basis
  OR NEW.effective_from<>OLD.effective_from OR NEW.defined_by<>OLD.defined_by
BEGIN SELECT RAISE(ABORT,'a value in force is retired, not reworded under the cards that cite it'); END;
CREATE TRIGGER recognition_values_no_delete BEFORE DELETE ON recognition_values BEGIN SELECT RAISE(ABORT,'values are retired, not deleted'); END;

CREATE TABLE recognition_cards (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  from_user_id TEXT NOT NULL REFERENCES users(id),
  to_user_id TEXT NOT NULL REFERENCES users(id),
  value_id TEXT NOT NULL REFERENCES recognition_values(id),
  message TEXT NOT NULL CHECK(length(trim(message))>=10),
  visibility TEXT NOT NULL CHECK(visibility IN ('public','private')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(from_user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(to_user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(from_user_id<>to_user_id)
) STRICT;
CREATE INDEX recognition_cards_feed ON recognition_cards(tenant_id,created_at);
CREATE INDEX recognition_cards_to ON recognition_cards(tenant_id,to_user_id);
CREATE TRIGGER recognition_cards_no_update BEFORE UPDATE ON recognition_cards BEGIN SELECT RAISE(ABORT,'a recognition card is sent once; a correction is a new card'); END;
CREATE TRIGGER recognition_cards_no_delete BEFORE DELETE ON recognition_cards BEGIN SELECT RAISE(ABORT,'recognition is retained'); END;

-- الإعلانات الداخلية: عكس الاستبيان تمامًا — هنا الربط بالاسم هو الغرض، لأن الإقرار بالقراءة التزام موثق.
CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  body TEXT NOT NULL CHECK(length(trim(body))>=10),
  audience_kind TEXT NOT NULL CHECK(audience_kind IN ('all','department')),
  department_id TEXT,
  publish_on TEXT NOT NULL CHECK(publish_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  expires_on TEXT NOT NULL CHECK(expires_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND expires_on>=publish_on),
  requires_ack INTEGER NOT NULL DEFAULT 0 CHECK(requires_ack IN (0,1)),
  ack_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','published','withdrawn')),
  prepared_by TEXT NOT NULL REFERENCES users(id),
  published_by TEXT REFERENCES users(id),
  published_at TEXT,
  withdrawn_by TEXT REFERENCES users(id),
  withdrawn_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  CHECK((audience_kind='department')=(department_id IS NOT NULL)),
  CHECK((status='draft')=(published_by IS NULL)),
  -- من كتب الإعلان لا ينشره على الجميع وحده، وخاصة ما يطلب إقرارًا يُحتج به لاحقًا.
  CHECK(published_by IS NULL OR published_by<>prepared_by),
  CHECK(requires_ack=0 OR length(trim(ack_reason))>=5),
  CHECK(status<>'withdrawn' OR (withdrawn_by IS NOT NULL AND length(trim(withdrawn_reason))>=3))
) STRICT;
CREATE INDEX announcements_live ON announcements(tenant_id,status,publish_on);
CREATE TRIGGER announcements_versioned BEFORE UPDATE ON announcements
WHEN NEW.version<>OLD.version+1 OR OLD.status='withdrawn'
  OR (OLD.status='published' AND (NEW.title<>OLD.title OR NEW.body<>OLD.body OR NEW.audience_kind<>OLD.audience_kind
    OR NEW.department_id IS NOT OLD.department_id OR NEW.publish_on<>OLD.publish_on OR NEW.expires_on<>OLD.expires_on
    OR NEW.requires_ack<>OLD.requires_ack OR NEW.ack_reason<>OLD.ack_reason
    OR NEW.prepared_by<>OLD.prepared_by OR NEW.published_by IS NOT OLD.published_by))
BEGIN SELECT RAISE(ABORT,'a published announcement is withdrawn and replaced, not rewritten under the people who acknowledged it'); END;
CREATE TRIGGER announcements_no_delete BEFORE DELETE ON announcements WHEN OLD.status<>'draft' BEGIN SELECT RAISE(ABORT,'published announcements are retained'); END;

CREATE TABLE announcement_attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  announcement_id TEXT NOT NULL REFERENCES announcements(id),
  label TEXT NOT NULL CHECK(length(trim(label))>=3),
  filename TEXT NOT NULL CHECK(length(trim(filename))>=1),
  media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','image/png','image/jpeg')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152),
  digest TEXT NOT NULL,
  content BLOB NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(announcement_id,digest)
) STRICT;
CREATE TRIGGER announcement_attachments_no_update BEFORE UPDATE ON announcement_attachments BEGIN SELECT RAISE(ABORT,'attachments are immutable'); END;
CREATE TRIGGER announcement_attachments_draft_only BEFORE DELETE ON announcement_attachments
WHEN (SELECT status FROM announcements WHERE id=OLD.announcement_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'an attachment people were told to read is retained'); END;

CREATE TABLE announcement_reads (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  announcement_id TEXT NOT NULL REFERENCES announcements(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  read_at TEXT NOT NULL,
  PRIMARY KEY(announcement_id,user_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER announcement_reads_no_update BEFORE UPDATE ON announcement_reads BEGIN SELECT RAISE(ABORT,'an acknowledgement is recorded once'); END;
CREATE TRIGGER announcement_reads_no_delete BEFORE DELETE ON announcement_reads BEGIN SELECT RAISE(ABORT,'acknowledgements are retained'); END;

CREATE TABLE internal_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  event_date TEXT NOT NULL CHECK(event_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_time TEXT NOT NULL DEFAULT '' CHECK(start_time='' OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  location TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  audience_kind TEXT NOT NULL CHECK(audience_kind IN ('all','department')),
  department_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  cancelled_by TEXT REFERENCES users(id),
  cancelled_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  CHECK((audience_kind='department')=(department_id IS NOT NULL)),
  CHECK(cancelled_by IS NULL OR length(trim(cancelled_reason))>=3)
) STRICT;
CREATE INDEX internal_events_calendar ON internal_events(tenant_id,event_date);
CREATE TRIGGER internal_events_versioned BEFORE UPDATE ON internal_events
WHEN NEW.version<>OLD.version+1 OR OLD.cancelled_by IS NOT NULL OR NEW.created_by<>OLD.created_by
BEGIN SELECT RAISE(ABORT,'a cancelled event stays cancelled'); END;
CREATE TRIGGER internal_events_no_delete BEFORE DELETE ON internal_events BEGIN SELECT RAISE(ABORT,'events are cancelled with a reason, not deleted'); END;
