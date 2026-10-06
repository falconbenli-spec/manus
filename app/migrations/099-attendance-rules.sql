-- قواعد الحضور من اللائحة (P1 #3 و#4 و#5 في تقرير الفجوات 19 سبتمبر): العمل الإضافي بتكليف مسبق (م76–77)،
-- والاستئذان والانصراف المبكر وإشعار التأخر في يومه (م74، م75)، والحضور بموقع يُعلَّم ولا يُمنع، وإعفاءات الحضور.
-- القيم النظامية (السقوف، الأجر، ساعات رمضان، سقف الاستئذان، مدة حفظ الإحداثيات) لا تُكتب هنا:
-- تسكن في معاملات سياسة «ساعات العمل والحضور» ولا تسري إلا بعد قبول مدير الموارد البشرية.

-- 1) تكليف العمل الإضافي المسبق: يكتبه مدير الإدارة، ويوافق عليه صاحب الصلاحية مسبقًا، وتعتمد الموارد البشرية ميزانيته كتابة.
-- أربعة أشخاص مختلفون: الموظف، والمكلِّف، وصاحب الصلاحية، ومعتمد الميزانية.
CREATE TABLE overtime_assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  from_date TEXT NOT NULL CHECK(from_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  to_date TEXT NOT NULL CHECK(to_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  minutes_per_day INTEGER NOT NULL CHECK(minutes_per_day BETWEEN 15 AND 720 AND minutes_per_day%15=0),
  days_json TEXT NOT NULL CHECK(json_valid(days_json)),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  policy_id TEXT NOT NULL REFERENCES hr_policies(id),
  status TEXT NOT NULL CHECK(status IN ('proposed','authorised','budget_approved','rejected','cancelled')),
  assigned_by TEXT NOT NULL REFERENCES users(id),
  authorised_by TEXT REFERENCES users(id),
  authorised_at TEXT,
  authorisation_note TEXT NOT NULL DEFAULT '',
  budget_by TEXT REFERENCES users(id),
  budget_at TEXT,
  budget_note TEXT NOT NULL DEFAULT '',
  budget_minor INTEGER CHECK(budget_minor IS NULL OR budget_minor>=0),
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  close_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(to_date>=from_date),
  CHECK(assigned_by<>user_id),
  CHECK(authorised_by IS NULL OR (authorised_by<>assigned_by AND authorised_by<>user_id)),
  CHECK(budget_by IS NULL OR (budget_by<>assigned_by AND budget_by<>authorised_by AND budget_by<>user_id)),
  CHECK((status IN ('authorised','budget_approved'))<=(authorised_by IS NOT NULL)),
  CHECK((status='budget_approved')=(budget_by IS NOT NULL))
) STRICT;
CREATE INDEX overtime_assignments_user ON overtime_assignments(user_id,from_date,to_date);
CREATE TRIGGER overtime_assignments_fixed BEFORE UPDATE ON overtime_assignments
WHEN OLD.status IN ('budget_approved','rejected','cancelled') OR NEW.user_id<>OLD.user_id OR NEW.from_date<>OLD.from_date OR NEW.to_date<>OLD.to_date OR NEW.minutes_per_day<>OLD.minutes_per_day OR NEW.reason<>OLD.reason OR NEW.assigned_by<>OLD.assigned_by OR NEW.days_json<>OLD.days_json
BEGIN SELECT RAISE(ABORT,'a decided overtime assignment is final'); END;
CREATE TRIGGER overtime_assignments_no_delete BEFORE DELETE ON overtime_assignments BEGIN SELECT RAISE(ABORT,'overtime assignments are retained'); END;

-- الساعات الفعلية تُسجَّل على التكليف. الطلب اللاحق بلا تكليف يبقى ممكنًا لكنه «بأثر رجعي» ويُعلَّم بذلك.
-- كل الطلبات القائمة قبل هذا الترحيل لاحقة بطبيعتها، فتُعلَّم رجعية.
ALTER TABLE overtime_requests ADD COLUMN assignment_id TEXT REFERENCES overtime_assignments(id);
ALTER TABLE overtime_requests ADD COLUMN retroactive INTEGER NOT NULL DEFAULT 0 CHECK(retroactive IN (0,1));
ALTER TABLE overtime_requests ADD COLUMN compensation TEXT NOT NULL DEFAULT 'pay' CHECK(compensation IN ('pay','time_off'));
ALTER TABLE overtime_requests ADD COLUMN consent_at TEXT;
ALTER TABLE overtime_requests ADD COLUMN day_type TEXT CHECK(day_type IS NULL OR day_type IN ('working','rest','holiday'));
ALTER TABLE overtime_requests ADD COLUMN suggested_minor INTEGER CHECK(suggested_minor IS NULL OR suggested_minor>=0);
UPDATE overtime_requests SET retroactive=1 WHERE assignment_id IS NULL;
CREATE TRIGGER overtime_requests_time_off_consent BEFORE INSERT ON overtime_requests
WHEN NEW.compensation='time_off' AND NEW.consent_at IS NULL
BEGIN SELECT RAISE(ABORT,'time off instead of pay needs the employee consent'); END;
CREATE TRIGGER overtime_requests_time_off_no_pay BEFORE UPDATE OF adjustment_id ON overtime_requests
WHEN NEW.adjustment_id IS NOT NULL AND NEW.compensation='time_off'
BEGIN SELECT RAISE(ABORT,'time off in lieu is not paid as well'); END;

-- 2) الاستئذان والانصراف المبكر سجل حضور: يطلبه الموظف ويعتمده مديره أو المعتمد، ولا يعتمده صاحبه.
CREATE TABLE attendance_permissions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  work_date TEXT NOT NULL CHECK(work_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind TEXT NOT NULL CHECK(kind IN ('late_arrival','during_day','early_leave')),
  from_time TEXT NOT NULL CHECK(from_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  to_time TEXT NOT NULL CHECK(to_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 720),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=5),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(to_time>from_time),
  CHECK(decided_by IS NULL OR decided_by<>user_id OR status='cancelled'),
  CHECK((status='pending')=(decided_by IS NULL))
) STRICT;
CREATE INDEX attendance_permissions_user ON attendance_permissions(user_id,work_date);
CREATE TRIGGER attendance_permissions_fixed BEFORE UPDATE ON attendance_permissions
WHEN OLD.status<>'pending' OR NEW.user_id<>OLD.user_id OR NEW.work_date<>OLD.work_date OR NEW.from_time<>OLD.from_time OR NEW.to_time<>OLD.to_time OR NEW.minutes<>OLD.minutes OR NEW.reason<>OLD.reason OR NEW.kind<>OLD.kind
BEGIN SELECT RAISE(ABORT,'a decided permission is final'); END;
CREATE TRIGGER attendance_permissions_no_delete BEFORE DELETE ON attendance_permissions BEGIN SELECT RAISE(ABORT,'permissions are retained'); END;

-- إشعار «سأتأخر / سأغيب» في اليوم نفسه (م75). يقبله المدير عذرًا أو لا يقبله؛ لا يُحذف.
CREATE TABLE attendance_notices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  work_date TEXT NOT NULL CHECK(work_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind TEXT NOT NULL CHECK(kind IN ('late','absent')),
  expected_time TEXT CHECK(expected_time IS NULL OR expected_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=5),
  status TEXT NOT NULL CHECK(status IN ('open','accepted','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((kind='late')=(expected_time IS NOT NULL)),
  CHECK(decided_by IS NULL OR decided_by<>user_id),
  CHECK((status='open')=(decided_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX attendance_notices_one ON attendance_notices(user_id,work_date,kind);
CREATE TRIGGER attendance_notices_fixed BEFORE UPDATE ON attendance_notices
WHEN OLD.status<>'open' OR NEW.user_id<>OLD.user_id OR NEW.work_date<>OLD.work_date OR NEW.kind<>OLD.kind OR NEW.reason<>OLD.reason OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'a decided notice is final'); END;
CREATE TRIGGER attendance_notices_no_delete BEFORE DELETE ON attendance_notices BEGIN SELECT RAISE(ABORT,'notices are retained'); END;

-- 3) مواقع الحضور: يقترحها شخص ويعتمدها آخر. نصف القطر من 50 إلى 2000 متر.
CREATE TABLE attendance_sites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=2),
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),
  radius_m INTEGER NOT NULL CHECK(radius_m BETWEEN 50 AND 2000),
  status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected','retired')),
  proposed_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  retired_by TEXT REFERENCES users(id),
  retired_at TEXT,
  retire_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK(decided_by IS NULL OR decided_by<>proposed_by),
  CHECK((status='proposed')=(decided_by IS NULL)),
  CHECK((status='retired')=(retired_by IS NOT NULL))
) STRICT;
CREATE TRIGGER attendance_sites_fixed BEFORE UPDATE ON attendance_sites
WHEN OLD.status IN ('rejected','retired') OR (OLD.status='approved' AND NEW.status<>'retired') OR NEW.name<>OLD.name OR NEW.lat<>OLD.lat OR NEW.lng<>OLD.lng OR NEW.radius_m<>OLD.radius_m OR NEW.proposed_by<>OLD.proposed_by
BEGIN SELECT RAISE(ABORT,'a decided site is replaced, not rewritten'); END;
CREATE TRIGGER attendance_sites_no_delete BEFORE DELETE ON attendance_sites BEGIN SELECT RAISE(ABORT,'sites are retained'); END;

-- نتيجة الموقع لكل بصمة. الخادم يحسب المسافة؛ لا يُقبل حكم المتصفح. الإحداثيات الخام تُمسح بعد مدة السياسة وتبقى النتيجة.
CREATE TABLE attendance_punch_locations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('in','out')),
  zone TEXT NOT NULL CHECK(zone IN ('in_zone','out_of_zone','no_location')),
  zone_note TEXT NOT NULL DEFAULT '' CHECK(zone_note IN ('','low_accuracy','denied','unavailable','timeout','unsupported','not_sent','notice_not_acknowledged')),
  site_id TEXT REFERENCES attendance_sites(id),
  distance_m INTEGER CHECK(distance_m IS NULL OR distance_m>=0),
  accuracy_m INTEGER CHECK(accuracy_m IS NULL OR accuracy_m>=0),
  lat REAL CHECK(lat IS NULL OR lat BETWEEN -90 AND 90),
  lng REAL CHECK(lng IS NULL OR lng BETWEEN -180 AND 180),
  needs_explanation INTEGER NOT NULL CHECK(needs_explanation IN (0,1)),
  explanation TEXT NOT NULL DEFAULT '',
  explained_at TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  policy_id TEXT NOT NULL REFERENCES hr_policies(id),
  captured_at TEXT NOT NULL,
  purge_after TEXT,
  purged_at TEXT,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  UNIQUE(user_id,work_date,kind),
  CHECK((lat IS NULL)=(lng IS NULL)),
  CHECK(lat IS NULL OR purge_after IS NOT NULL),
  CHECK(reviewed_by IS NULL OR reviewed_by<>user_id)
) STRICT;
CREATE INDEX attendance_punch_locations_purge ON attendance_punch_locations(tenant_id,purge_after) WHERE lat IS NOT NULL;
-- الإحداثيات تُمسح ولا تُعاد، والنتيجة لا تُعدَّل.
CREATE TRIGGER attendance_punch_locations_fixed BEFORE UPDATE ON attendance_punch_locations
WHEN NEW.zone<>OLD.zone OR NEW.zone_note<>OLD.zone_note OR NEW.site_id IS NOT OLD.site_id OR NEW.distance_m IS NOT OLD.distance_m OR NEW.accuracy_m IS NOT OLD.accuracy_m OR NEW.user_id<>OLD.user_id OR NEW.work_date<>OLD.work_date OR NEW.captured_at<>OLD.captured_at
  OR (NEW.lat IS NOT NULL AND NEW.lat IS NOT OLD.lat) OR (NEW.lng IS NOT NULL AND NEW.lng IS NOT OLD.lng) OR (OLD.reviewed_by IS NOT NULL AND NEW.reviewed_by IS NOT OLD.reviewed_by)
BEGIN SELECT RAISE(ABORT,'a punch location result is final; raw coordinates can only be purged'); END;
CREATE TRIGGER attendance_punch_locations_no_delete BEFORE DELETE ON attendance_punch_locations BEGIN SELECT RAISE(ABORT,'punch location results are retained'); END;

-- الاطلاع على إشعار الخصوصية قبل أول إرسال للموقع، لكل نسخة سياسة.
CREATE TABLE attendance_location_notices_seen (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  policy_id TEXT NOT NULL REFERENCES hr_policies(id),
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY(user_id,policy_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

-- 4) إعفاءات الحضور بفترات معتمدة: يقترحها موظف الموارد البشرية ويعتمدها شخص آخر غير صاحبها.
CREATE TABLE attendance_exemptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  from_date TEXT NOT NULL CHECK(from_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  to_date TEXT NOT NULL CHECK(to_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected')),
  proposed_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(to_date>=from_date),
  CHECK(proposed_by<>user_id),
  CHECK(decided_by IS NULL OR (decided_by<>proposed_by AND decided_by<>user_id)),
  CHECK((status='proposed')=(decided_by IS NULL))
) STRICT;
CREATE INDEX attendance_exemptions_user ON attendance_exemptions(user_id,from_date,to_date);
CREATE TRIGGER attendance_exemptions_fixed BEFORE UPDATE ON attendance_exemptions
WHEN OLD.status<>'proposed' OR NEW.user_id<>OLD.user_id OR NEW.from_date<>OLD.from_date OR NEW.to_date<>OLD.to_date OR NEW.reason<>OLD.reason OR NEW.proposed_by<>OLD.proposed_by
BEGIN SELECT RAISE(ABORT,'a decided exemption is final'); END;
CREATE TRIGGER attendance_exemptions_no_delete BEFORE DELETE ON attendance_exemptions BEGIN SELECT RAISE(ABORT,'exemptions are retained'); END;

-- 5) إشعار الموظف بكل قرار: أنواع موضوع جديدة للإشعارات. قائمة 096 المغلقة تُستبدل بشرط شكل
-- (حروف لاتينية صغيرة وشرطة سفلية)، والتحقق من النوع وشاشته في الكود (SUBJECT_LINKS في notices.mjs).
-- السبب: أكثر من وحدة تضيف أنواعًا في الفترة نفسها، وقائمة مغلقة في كل ترحيل تُسقط أنواع غيرها.
ALTER TABLE notifications RENAME TO notifications_v2;
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT REFERENCES requests(id),
  kind TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  subject_kind TEXT,
  subject_id TEXT,
  title TEXT,
  body TEXT,
  CHECK(request_id IS NOT NULL OR (subject_kind IS NOT NULL AND subject_id IS NOT NULL AND length(trim(title))>0)),
  CHECK(subject_kind IS NULL OR (length(subject_kind) BETWEEN 3 AND 40 AND subject_kind NOT GLOB '*[^a-z_]*')),
  CHECK(title IS NULL OR length(title)<=300),
  CHECK(body IS NULL OR length(body)<=600)
) STRICT;
INSERT INTO notifications(id,user_id,request_id,kind,read_at,created_at,subject_kind,subject_id,title,body) SELECT id,user_id,request_id,kind,read_at,created_at,subject_kind,subject_id,title,body FROM notifications_v2;
DROP TABLE notifications_v2;
CREATE INDEX notifications_user ON notifications(user_id,created_at);
CREATE INDEX notifications_subject ON notifications(subject_kind,subject_id);
