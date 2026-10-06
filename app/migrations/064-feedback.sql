-- اللقاءات الفردية والتغذية الراجعة المستمرة وتقييم 360.
-- تبني فوق دورات التقييم في 038-talent.sql ولا تعدلها: تقييم 360 خيار داخل الدورة القائمة لا دورة موازية.
-- ثلاث قواعد خصوصية مفروضة هنا لا في الواجهة:
--   (1) محتوى اللقاء الفردي بين طرفيه؛ الموارد البشرية تقرأ انعقاده وموعده من عرض `one_to_one_cadence` الذي لا يحمل نصًا.
--   (2) الملاحظة ملك كاتبها ومستلمها، ومن يراها غيرهما تحدده مرئيتها المكتوبة وقت كتابتها.
--   (3) التقييم الصاعد لا يحمل هوية كاتبه إطلاقًا: الاستجابة لا تشير إلى ترشيحها، وواقعة الإجابة تُسجل في جدول منفصل.
-- لا درجة ولا ترتيب في أي من هذه الجداول: النص وحده، والدمج قرار بشري في معايرة الدورة القائمة.

-- ---------- اللقاءات الفردية ----------
CREATE TABLE one_to_ones (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  employee_id TEXT NOT NULL,
  manager_id TEXT NOT NULL REFERENCES users(id),
  scheduled_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('scheduled','held','cancelled')),
  -- محضر مشترك يقرأه الطرفان، وملاحظة خاصة لكل طرف لا يراها الآخر ولا الموارد البشرية.
  shared_notes TEXT NOT NULL DEFAULT '',
  employee_private_note TEXT NOT NULL DEFAULT '',
  manager_private_note TEXT NOT NULL DEFAULT '',
  held_at TEXT,
  closed_by TEXT REFERENCES users(id),
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(employee_id<>manager_id),
  CHECK((status='held')=(held_at IS NOT NULL)),
  CHECK((status='held')=(closed_by IS NOT NULL)),
  CHECK((status='cancelled')=(length(trim(cancel_reason))>0))
) STRICT;
CREATE INDEX one_to_ones_parties ON one_to_ones(tenant_id,employee_id,manager_id);
-- محضر اللقاء بعد تسجيل انعقاده نهائي: التصحيح لقاء جديد، والبنود المفتوحة تُقفل في جدولها.
CREATE TRIGGER one_to_ones_versioned BEFORE UPDATE ON one_to_ones
WHEN NEW.version<>OLD.version+1 OR NEW.employee_id<>OLD.employee_id OR NEW.manager_id<>OLD.manager_id OR NEW.tenant_id<>OLD.tenant_id
  OR OLD.status<>'scheduled'
BEGIN SELECT RAISE(ABORT,'a held or cancelled one-to-one is final; a correction is a new meeting'); END;
CREATE TRIGGER one_to_ones_no_delete BEFORE DELETE ON one_to_ones
BEGIN SELECT RAISE(ABORT,'one-to-one meetings are retained'); END;

-- ما تراه الموارد البشرية: أن اللقاء انعقد ومتى. لا أجندة ولا محضر ولا ملاحظة خاصة.
CREATE VIEW one_to_one_cadence AS
SELECT id, tenant_id, employee_id, manager_id, scheduled_on, status, held_at, created_at FROM one_to_ones;

CREATE TABLE one_to_one_agenda_items (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES one_to_ones(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  topic TEXT NOT NULL CHECK(length(trim(topic))>=3),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX one_to_one_agenda_items_meeting ON one_to_one_agenda_items(meeting_id);
-- الأجندة مشتركة ويكتب فيها الطرفان قبل اللقاء: لا يكتب فيها غيرهما، ولا تُكتب بعد تسجيل الانعقاد.
CREATE TRIGGER one_to_one_agenda_items_before_meeting BEFORE INSERT ON one_to_one_agenda_items
WHEN NOT EXISTS(SELECT 1 FROM one_to_ones m WHERE m.id=NEW.meeting_id AND m.status='scheduled' AND NEW.author_id IN (m.employee_id,m.manager_id))
BEGIN SELECT RAISE(ABORT,'the shared agenda is written by the two parties before the meeting'); END;
CREATE TRIGGER one_to_one_agenda_items_fixed BEFORE UPDATE ON one_to_one_agenda_items
BEGIN SELECT RAISE(ABORT,'an agenda entry is not rewritten'); END;
CREATE TRIGGER one_to_one_agenda_items_no_delete BEFORE DELETE ON one_to_one_agenda_items
BEGIN SELECT RAISE(ABORT,'agenda entries are retained'); END;

CREATE TABLE one_to_one_follow_ups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  meeting_id TEXT NOT NULL REFERENCES one_to_ones(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  item TEXT NOT NULL CHECK(length(trim(item))>=5),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','done','dropped')),
  created_by TEXT NOT NULL REFERENCES users(id),
  closing_note TEXT NOT NULL DEFAULT '',
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  CHECK((status='open')=(closed_at IS NULL)),
  CHECK(status='open' OR length(trim(closing_note))>=5)
) STRICT;
CREATE INDEX one_to_one_follow_ups_owner ON one_to_one_follow_ups(tenant_id,owner_id,status);
-- لكل بند مالك من طرفي اللقاء، وموعد، وحالة. يقفله مالكه بما كتبه، ولا يُعاد كتابة نصه.
CREATE TRIGGER one_to_one_follow_ups_party BEFORE INSERT ON one_to_one_follow_ups
WHEN NOT EXISTS(SELECT 1 FROM one_to_ones m WHERE m.id=NEW.meeting_id AND NEW.owner_id IN (m.employee_id,m.manager_id) AND NEW.created_by IN (m.employee_id,m.manager_id))
BEGIN SELECT RAISE(ABORT,'a follow-up item belongs to one of the two parties'); END;
CREATE TRIGGER one_to_one_follow_ups_versioned BEFORE UPDATE ON one_to_one_follow_ups
WHEN NEW.version<>OLD.version+1 OR OLD.status<>'open' OR NEW.owner_id<>OLD.owner_id OR NEW.item<>OLD.item OR NEW.due_date<>OLD.due_date OR NEW.meeting_id<>OLD.meeting_id
BEGIN SELECT RAISE(ABORT,'a closed follow-up item is final and its text is not rewritten'); END;
CREATE TRIGGER one_to_one_follow_ups_no_delete BEFORE DELETE ON one_to_one_follow_ups
BEGIN SELECT RAISE(ABORT,'follow-up items are retained'); END;

-- ---------- التغذية الراجعة المستمرة ----------
CREATE TABLE feedback_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  -- الطلب عن صاحبه: يطلب الموظف رأي زميل فيه هو، بسؤال محدد.
  requester_id TEXT NOT NULL,
  respondent_id TEXT NOT NULL REFERENCES users(id),
  question TEXT NOT NULL CHECK(length(trim(question))>=10),
  status TEXT NOT NULL CHECK(status IN ('open','answered','declined')),
  decline_reason TEXT NOT NULL DEFAULT '',
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY(requester_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(requester_id<>respondent_id),
  CHECK((status='open')=(closed_at IS NULL)),
  CHECK((status='declined')=(length(trim(decline_reason))>0))
) STRICT;
CREATE INDEX feedback_requests_people ON feedback_requests(tenant_id,respondent_id,status);
CREATE TRIGGER feedback_requests_versioned BEFORE UPDATE ON feedback_requests
WHEN NEW.version<>OLD.version+1 OR OLD.status<>'open' OR NEW.requester_id<>OLD.requester_id OR NEW.respondent_id<>OLD.respondent_id OR NEW.question<>OLD.question
BEGIN SELECT RAISE(ABORT,'an answered or declined feedback request is final'); END;
CREATE TRIGGER feedback_requests_no_delete BEFORE DELETE ON feedback_requests
BEGIN SELECT RAISE(ABORT,'feedback requests are retained'); END;

CREATE TABLE feedback_notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  subject_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('appreciation','improvement')),
  -- المرئية تُكتب مع الملاحظة ولا تتغير بعدها: للمستلم وحده، أو له ولمديره، أو علنية داخل الكيان.
  visibility TEXT NOT NULL CHECK(visibility IN ('recipient','recipient_manager','public')),
  body TEXT NOT NULL CHECK(length(trim(body))>=15),
  occurred_on TEXT NOT NULL,
  request_id TEXT REFERENCES feedback_requests(id),
  withdrawn_at TEXT,
  withdrawal_reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY(subject_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(author_id<>subject_id),
  CHECK((withdrawn_at IS NULL)=(length(trim(withdrawal_reason))=0))
) STRICT;
CREATE INDEX feedback_notes_subject ON feedback_notes(tenant_id,subject_id,occurred_on);
CREATE INDEX feedback_notes_author ON feedback_notes(tenant_id,author_id);
-- الملاحظة ملك كاتبها ومستلمها: لا يُعاد كتابة نصها ولا توسَّع مرئيتها لاحقًا. لكاتبها سحبها بسبب مكتوب، ويبقى أثر السحب.
CREATE TRIGGER feedback_notes_immutable BEFORE UPDATE ON feedback_notes
WHEN NEW.version<>OLD.version+1 OR OLD.withdrawn_at IS NOT NULL
  OR NEW.author_id<>OLD.author_id OR NEW.subject_id<>OLD.subject_id OR NEW.body<>OLD.body OR NEW.kind<>OLD.kind OR NEW.visibility<>OLD.visibility OR NEW.occurred_on<>OLD.occurred_on
BEGIN SELECT RAISE(ABORT,'a feedback note is written once; only its author may withdraw it with a reason'); END;
CREATE TRIGGER feedback_notes_no_delete BEFORE DELETE ON feedback_notes
BEGIN SELECT RAISE(ABORT,'feedback notes are retained; withdrawal is recorded, not erased'); END;

-- ---------- تقييم 360 داخل دورة التقييم القائمة ----------
-- الحد الأدنى لعدد المستجيبين قبل عرض التقييم الصاعد: إعداد يدخله مدير الموارد البشرية بمصدره وتاريخ تأكيده.
-- لا قيمة افتراضية في الكود ولا صف ابتدائي هنا: ما لم يُدخل الحد لا يُعرض تقييم صاعد إطلاقًا.
-- الحد لا يقل عن اثنين لأن مستجيبًا واحدًا يعني كشفه بالتعريف، أما القيمة الفعلية فقرار مالك الإجراء.
CREATE TABLE review_360_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  min_upward_respondents INTEGER NOT NULL CHECK(min_upward_respondents BETWEEN 2 AND 20),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  confirmed_on TEXT NOT NULL,
  set_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  superseded_at TEXT
) STRICT;
CREATE UNIQUE INDEX review_360_settings_one_live ON review_360_settings(tenant_id) WHERE superseded_at IS NULL;
CREATE TRIGGER review_360_settings_superseded_only BEFORE UPDATE ON review_360_settings
WHEN OLD.superseded_at IS NOT NULL OR NEW.min_upward_respondents<>OLD.min_upward_respondents OR NEW.basis<>OLD.basis OR NEW.confirmed_on<>OLD.confirmed_on OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'a threshold is replaced by a new dated row, not edited'); END;
CREATE TRIGGER review_360_settings_no_delete BEFORE DELETE ON review_360_settings
BEGIN SELECT RAISE(ABORT,'threshold history is retained'); END;

CREATE TABLE review_360_nominations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  cycle_id TEXT NOT NULL REFERENCES review_cycles(id),
  subject_id TEXT NOT NULL,
  rater_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL CHECK(source IN ('self','peer','upward')),
  nominated_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(cycle_id,subject_id,rater_id),
  FOREIGN KEY(subject_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((source='self')=(rater_id=subject_id)),
  -- اختيار المقيِّمين يعتمده طرف ثالث: لا المرشِّح ولا المقيِّم ولا صاحب التقييم.
  CHECK(decided_by IS NULL OR (decided_by<>nominated_by AND decided_by<>rater_id AND decided_by<>subject_id)),
  CHECK((status='proposed')=(decided_by IS NULL)),
  CHECK(status='proposed' OR length(trim(decision_note))>=5)
) STRICT;
CREATE INDEX review_360_nominations_panel ON review_360_nominations(tenant_id,cycle_id,subject_id,status);
CREATE INDEX review_360_nominations_rater ON review_360_nominations(tenant_id,rater_id,status);
CREATE TRIGGER review_360_nominations_versioned BEFORE UPDATE ON review_360_nominations
WHEN NEW.version<>OLD.version+1 OR OLD.status<>'proposed' OR NEW.subject_id<>OLD.subject_id OR NEW.rater_id<>OLD.rater_id OR NEW.source<>OLD.source OR NEW.cycle_id<>OLD.cycle_id OR NEW.nominated_by<>OLD.nominated_by
BEGIN SELECT RAISE(ABORT,'a decided nomination is final; a correction is a new nomination'); END;
CREATE TRIGGER review_360_nominations_no_delete BEFORE DELETE ON review_360_nominations
BEGIN SELECT RAISE(ABORT,'nominations are retained'); END;

-- الاستجابة نص لا درجة، ولا تشير إلى مَن كتبها: لا عمود مقيِّم ولا مرجع إلى ترشيحه.
-- ما يمنع الإجابة مرتين هو `review_360_submissions` وحده، وهو لا يدل على أي استجابة تخص أي مقيِّم.
CREATE TABLE review_360_responses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  cycle_id TEXT NOT NULL REFERENCES review_cycles(id),
  subject_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('self','peer','upward')),
  strengths TEXT NOT NULL CHECK(length(trim(strengths))>=15),
  improvements TEXT NOT NULL CHECK(length(trim(improvements))>=15),
  submitted_at TEXT NOT NULL,
  FOREIGN KEY(subject_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX review_360_responses_panel ON review_360_responses(tenant_id,cycle_id,subject_id,source);
CREATE TRIGGER review_360_responses_immutable BEFORE UPDATE ON review_360_responses
BEGIN SELECT RAISE(ABORT,'a submitted 360 response is final'); END;
CREATE TRIGGER review_360_responses_no_delete BEFORE DELETE ON review_360_responses
BEGIN SELECT RAISE(ABORT,'360 responses are retained'); END;

CREATE TABLE review_360_submissions (
  nomination_id TEXT PRIMARY KEY REFERENCES review_360_nominations(id),
  submitted_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER review_360_submissions_immutable BEFORE UPDATE ON review_360_submissions
BEGIN SELECT RAISE(ABORT,'a submission mark is final'); END;
CREATE TRIGGER review_360_submissions_no_delete BEFORE DELETE ON review_360_submissions
BEGIN SELECT RAISE(ABORT,'submission marks are retained'); END;
