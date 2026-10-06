-- الإنتاج والتصوير: المشروع الإنتاجي وطاقمه ومواهبه ومواقعه، وورقة استدعاء تُصدَر ولا تُعدَّل،
-- وجدول أيام التصوير بترتيب قابل للسحب وقائمة اللقطات.
-- لا اتصال خارجي في هذه الوحدة: رابط الخريطة والطقس وأقرب مستشفى وجهة اتصال الطوارئ حقول يملؤها المنتج بيده.
-- المستقل الخارجي مورد في vendors وتُصرف مستحقاته عبر دورة المشتريات والمدفوعات؛ لا مسار دفع هنا.
-- الموظف الداخلي يُربط بـusers، ولا يُخزَّن أجره ولا تكلفته في أي عمود من هذه الجداول.

CREATE TABLE productions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL CHECK(code=upper(code) AND length(code) BETWEEN 3 AND 40),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  kind TEXT NOT NULL CHECK(kind IN ('ad','social','corporate','stills')),
  status TEXT NOT NULL CHECK(status IN ('planning','in_production','wrapped','closed','cancelled')),
  producer_id TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  client_id TEXT REFERENCES clients(id),
  campaign_id TEXT REFERENCES campaigns(id),
  project_id TEXT,
  shoot_from TEXT NOT NULL,
  shoot_to TEXT NOT NULL,
  wrap_note TEXT NOT NULL DEFAULT '',
  closed_by TEXT,
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,code),
  FOREIGN KEY(producer_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(closed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  CHECK(shoot_to>=shoot_from),
  -- الإنتاج عمل لجهة: عميل أو حملة أو مشروع قائم. ميزانيته مخصص المشروع في شاشة المخصصات، ولا تُكرر هنا.
  CHECK(client_id IS NOT NULL OR campaign_id IS NOT NULL OR project_id IS NOT NULL),
  CHECK(status NOT IN ('wrapped','closed') OR length(trim(wrap_note))>=10),
  -- من أنتج لا يقفل إنتاجه: الإقفال شهادة طرف ثانٍ على أن العمل انتهى وتوثقت مخرجاته.
  CHECK((status='closed')=(closed_by IS NOT NULL)),
  CHECK(closed_by IS NULL OR closed_by<>producer_id)
) STRICT;
CREATE INDEX productions_dates ON productions(tenant_id,shoot_from,shoot_to);
CREATE TRIGGER productions_versioned BEFORE UPDATE ON productions
WHEN NEW.version<>OLD.version+1 OR OLD.status IN ('closed','cancelled')
  OR NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code OR NEW.producer_id<>OLD.producer_id OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'a closed production is final; its code and producer never change'); END;
CREATE TRIGGER productions_no_delete BEFORE DELETE ON productions BEGIN SELECT RAISE(ABORT,'productions are retained'); END;

CREATE TABLE production_crew (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  production_id TEXT NOT NULL,
  role_key TEXT NOT NULL CHECK(role_key IN ('director','photographer','camera_assistant','lighting_assistant','sound','editor','colorist','stylist','makeup','drone_operator','production_assistant','other')),
  role_note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK(source IN ('internal','external')),
  user_id TEXT,
  vendor_id TEXT,
  day_rate_minor INTEGER CHECK(day_rate_minor IS NULL OR (day_rate_minor>0 AND day_rate_minor<=100000000)),
  currency TEXT NOT NULL DEFAULT 'SAR' CHECK(currency='SAR'),
  days INTEGER CHECK(days IS NULL OR days BETWEEN 1 AND 365),
  engagement_note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  removal_note TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(production_id,tenant_id) REFERENCES productions(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(vendor_id,tenant_id) REFERENCES vendors(id,tenant_id),
  FOREIGN KEY(added_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((source='internal')=(user_id IS NOT NULL)),
  CHECK((source='external')=(vendor_id IS NOT NULL)),
  -- أجر الموظف الداخلي وتكلفته لا مكان لهما هنا: المعدل اليومي للمستقل الخارجي وحده، وصرفه عبر دورة المدفوعات.
  CHECK(source='external' OR (day_rate_minor IS NULL AND days IS NULL)),
  CHECK(source='internal' OR day_rate_minor IS NOT NULL),
  CHECK(active=1 OR length(trim(removal_note))>=5)
) STRICT;
CREATE UNIQUE INDEX production_crew_once ON production_crew(production_id,role_key,COALESCE(user_id,vendor_id));
CREATE TRIGGER production_crew_fixed BEFORE UPDATE ON production_crew
WHEN NEW.version<>OLD.version+1 OR NEW.production_id<>OLD.production_id OR NEW.source<>OLD.source
  OR NEW.user_id IS NOT OLD.user_id OR NEW.vendor_id IS NOT OLD.vendor_id OR NEW.added_by<>OLD.added_by
BEGIN SELECT RAISE(ABORT,'a crew line keeps its person and its production'); END;
CREATE TRIGGER production_crew_no_delete BEFORE DELETE ON production_crew BEGIN SELECT RAISE(ABORT,'crew lines are deactivated, not deleted'); END;

CREATE TABLE production_talent (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  production_id TEXT NOT NULL,
  full_name TEXT NOT NULL CHECK(length(trim(full_name))>=3),
  talent_kind TEXT NOT NULL CHECK(talent_kind IN ('actor','model','voice','presenter','extra','child')),
  agency_vendor_id TEXT,
  contact_note TEXT NOT NULL DEFAULT '',
  -- تصريح استخدام الصورة: واقعة مسجلة لا توقيع إلكتروني. المنصة تسجل هل وُقّع ومتى وأين حُفظ الأصل، ولا تدّعي حجية.
  release_status TEXT NOT NULL CHECK(release_status IN ('not_signed','signed','expired','refused')),
  release_signed_on TEXT,
  release_valid_until TEXT,
  release_scope TEXT NOT NULL DEFAULT '',
  release_media TEXT NOT NULL DEFAULT '',
  release_storage TEXT NOT NULL DEFAULT '',
  release_note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  removal_note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(production_id,full_name),
  FOREIGN KEY(production_id,tenant_id) REFERENCES productions(id,tenant_id),
  FOREIGN KEY(agency_vendor_id,tenant_id) REFERENCES vendors(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(release_status NOT IN ('signed','expired') OR (release_signed_on IS NOT NULL AND length(trim(release_scope))>=3 AND length(trim(release_storage))>=3)),
  CHECK(release_status IN ('signed','expired') OR (release_signed_on IS NULL AND release_valid_until IS NULL)),
  CHECK(release_valid_until IS NULL OR release_valid_until>=release_signed_on),
  CHECK(active=1 OR length(trim(removal_note))>=5)
) STRICT;
CREATE TRIGGER production_talent_fixed BEFORE UPDATE ON production_talent
WHEN NEW.version<>OLD.version+1 OR NEW.production_id<>OLD.production_id OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'a talent line keeps its production'); END;
CREATE TRIGGER production_talent_no_delete BEFORE DELETE ON production_talent BEGIN SELECT RAISE(ABORT,'talent lines are deactivated, not deleted'); END;

CREATE TABLE production_locations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  production_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  address_note TEXT NOT NULL DEFAULT '',
  map_link TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  -- هل يتطلب هذا الموقع تصريحًا من جهة؟ قرار المنتج وحده مع سنده. المنصة لا تفترض أي متطلب نظامي ولا تعرف الجهات.
  permit_required INTEGER NOT NULL CHECK(permit_required IN (0,1)),
  permit_basis TEXT NOT NULL DEFAULT '',
  permit_status TEXT NOT NULL CHECK(permit_status IN ('not_required','pending','obtained','refused')),
  permit_number TEXT NOT NULL DEFAULT '',
  permit_issuer TEXT NOT NULL DEFAULT '',
  permit_expires_on TEXT,
  permit_storage TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  removal_note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(production_id,name),
  FOREIGN KEY(production_id,tenant_id) REFERENCES productions(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((permit_required=0)=(permit_status='not_required')),
  CHECK(permit_required=0 OR length(trim(permit_basis))>=5),
  CHECK(permit_status<>'obtained' OR (length(trim(permit_number))>=2 AND length(trim(permit_issuer))>=2 AND permit_expires_on IS NOT NULL AND length(trim(permit_storage))>=3)),
  CHECK(permit_status='obtained' OR (permit_number='' AND permit_issuer='' AND permit_expires_on IS NULL)),
  CHECK(active=1 OR length(trim(removal_note))>=5)
) STRICT;
CREATE TRIGGER production_locations_fixed BEFORE UPDATE ON production_locations
WHEN NEW.version<>OLD.version+1 OR NEW.production_id<>OLD.production_id OR NEW.recorded_by<>OLD.recorded_by
BEGIN SELECT RAISE(ABORT,'a location keeps its production'); END;
CREATE TRIGGER production_locations_no_delete BEFORE DELETE ON production_locations BEGIN SELECT RAISE(ABORT,'locations are deactivated, not deleted'); END;

CREATE TABLE shoot_schedule (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  production_id TEXT NOT NULL,
  shoot_date TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK(sort_order>=0),
  scene_ref TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK(length(trim(title))>=2),
  note TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  start_time TEXT NOT NULL DEFAULT '' CHECK(start_time='' OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  estimated_minutes INTEGER CHECK(estimated_minutes IS NULL OR estimated_minutes BETWEEN 5 AND 1440),
  recorded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(production_id,tenant_id) REFERENCES productions(id,tenant_id),
  FOREIGN KEY(location_id,tenant_id) REFERENCES production_locations(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX shoot_schedule_day ON shoot_schedule(production_id,shoot_date,sort_order);
CREATE TRIGGER shoot_schedule_fixed BEFORE UPDATE ON shoot_schedule
WHEN NEW.version<>OLD.version+1 OR NEW.production_id<>OLD.production_id
BEGIN SELECT RAISE(ABORT,'a schedule row keeps its production'); END;

CREATE TABLE shot_list (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  production_id TEXT NOT NULL,
  scene_id TEXT,
  sort_order INTEGER NOT NULL CHECK(sort_order>=0),
  code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL CHECK(length(trim(description))>=3),
  shot_size TEXT NOT NULL CHECK(shot_size IN ('extreme_wide','wide','medium','close','extreme_close','over_shoulder','two_shot','insert')),
  camera_angle TEXT NOT NULL CHECK(camera_angle IN ('eye_level','high','low','overhead','dutch','pov','tracking')),
  -- المرجع البصري يُكتب مكانه هنا: جدول الملفات المشترك لا يقبل بعدُ سجلات الإنتاج، فلا رفع مرفق داخل المنصة.
  reference_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('planned','shot','reshoot')),
  status_note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(production_id,tenant_id) REFERENCES productions(id,tenant_id),
  FOREIGN KEY(scene_id,tenant_id) REFERENCES shoot_schedule(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(status='planned' OR length(trim(status_note))>=3)
) STRICT;
CREATE INDEX shot_list_order ON shot_list(production_id,sort_order);
CREATE TRIGGER shot_list_fixed BEFORE UPDATE ON shot_list
WHEN NEW.version<>OLD.version+1 OR NEW.production_id<>OLD.production_id
BEGIN SELECT RAISE(ABORT,'a shot keeps its production'); END;

CREATE TABLE call_sheets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  production_id TEXT NOT NULL,
  shoot_date TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  supersedes_id TEXT REFERENCES call_sheets(id),
  change_summary TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  map_link TEXT NOT NULL DEFAULT '',
  call_time TEXT NOT NULL CHECK(call_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  wrap_time TEXT NOT NULL DEFAULT '' CHECK(wrap_time='' OR wrap_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  day_schedule TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(day_schedule)),
  safety_notes TEXT NOT NULL DEFAULT '',
  -- الطقس ملاحظة يكتبها المنتج من مصدره؛ لا خدمة طقس ولا خرائط داخل المنصة.
  weather_note TEXT NOT NULL DEFAULT '',
  nearest_hospital TEXT NOT NULL DEFAULT '',
  hospital_address TEXT NOT NULL DEFAULT '',
  emergency_contact_name TEXT NOT NULL DEFAULT '',
  emergency_contact_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('draft','issued','superseded','cancelled')),
  prepared_by TEXT NOT NULL,
  issued_by TEXT,
  issued_at TEXT,
  cancel_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(production_id,shoot_date,revision),
  FOREIGN KEY(production_id,tenant_id) REFERENCES productions(id,tenant_id),
  FOREIGN KEY(location_id,tenant_id) REFERENCES production_locations(id,tenant_id),
  FOREIGN KEY(prepared_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(issued_by,tenant_id) REFERENCES users(id,tenant_id),
  -- من أعدّ ورقة الاستدعاء لا يصدرها.
  CHECK(issued_by IS NULL OR issued_by<>prepared_by),
  CHECK(status NOT IN ('issued','superseded') OR issued_by IS NOT NULL),
  CHECK(status<>'draft' OR issued_by IS NULL),
  CHECK((issued_by IS NULL)=(issued_at IS NULL)),
  -- لا تُصدر ورقة استدعاء بلا موقع ولا بلا أقرب مستشفى وجهة اتصال طوارئ يملؤهما المنتج.
  CHECK(status NOT IN ('issued','superseded') OR (location_id IS NOT NULL AND length(trim(nearest_hospital))>=3
    AND length(trim(emergency_contact_name))>=3 AND length(trim(emergency_contact_phone))>=7 AND json_array_length(day_schedule)>0)),
  -- النسخة الثانية فما بعدها تقول بالضبط ما الذي تغير.
  CHECK((revision=1)=(supersedes_id IS NULL)),
  CHECK(revision=1 OR length(trim(change_summary))>=10),
  CHECK(status<>'cancelled' OR length(trim(cancel_note))>=5)
) STRICT;
CREATE UNIQUE INDEX call_sheets_one_draft ON call_sheets(production_id,shoot_date) WHERE status='draft';
CREATE UNIQUE INDEX call_sheets_one_issued ON call_sheets(production_id,shoot_date) WHERE status='issued';
CREATE UNIQUE INDEX call_sheets_one_successor ON call_sheets(supersedes_id) WHERE supersedes_id IS NOT NULL;
-- ورقة الاستدعاء المُصدَرة لا تُعدَّل بحرف واحد. التغيير نسخة جديدة تحل محلها وتُخطر بها كل من استُدعي.
CREATE TRIGGER call_sheets_issued_immutable BEFORE UPDATE ON call_sheets
WHEN NEW.version<>OLD.version+1
  OR OLD.status IN ('superseded','cancelled')
  OR NEW.production_id<>OLD.production_id OR NEW.shoot_date<>OLD.shoot_date OR NEW.revision<>OLD.revision
  OR NEW.supersedes_id IS NOT OLD.supersedes_id OR NEW.prepared_by<>OLD.prepared_by OR NEW.created_at<>OLD.created_at
  OR (OLD.status='issued' AND (
      NEW.status NOT IN ('superseded','cancelled')
      OR NEW.location_id IS NOT OLD.location_id OR NEW.map_link<>OLD.map_link
      OR NEW.call_time<>OLD.call_time OR NEW.wrap_time<>OLD.wrap_time OR NEW.day_schedule<>OLD.day_schedule
      OR NEW.safety_notes<>OLD.safety_notes OR NEW.weather_note<>OLD.weather_note
      OR NEW.nearest_hospital<>OLD.nearest_hospital OR NEW.hospital_address<>OLD.hospital_address
      OR NEW.emergency_contact_name<>OLD.emergency_contact_name OR NEW.emergency_contact_phone<>OLD.emergency_contact_phone
      OR NEW.change_summary<>OLD.change_summary
      OR NEW.issued_by IS NOT OLD.issued_by OR NEW.issued_at IS NOT OLD.issued_at))
BEGIN SELECT RAISE(ABORT,'an issued call sheet is never edited: issue a new revision that states what changed'); END;
CREATE TRIGGER call_sheets_no_delete BEFORE DELETE ON call_sheets BEGIN SELECT RAISE(ABORT,'call sheets are retained'); END;

CREATE TABLE call_sheet_invitees (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  call_sheet_id TEXT NOT NULL,
  party_kind TEXT NOT NULL CHECK(party_kind IN ('crew','talent')),
  crew_id TEXT,
  talent_id TEXT,
  user_id TEXT,
  display_name TEXT NOT NULL CHECK(length(trim(display_name))>=2),
  call_time TEXT NOT NULL CHECK(call_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  -- من له حساب يصله إشعار داخلي ويرد بنفسه. من لا حساب له يبلغه المنتج خارج المنصة ويسجل رده:
  -- لا رابط مشاركة عامًا في هذه النسخة، ولا تدّعي المنصة أن الورقة وصلته.
  delivery TEXT NOT NULL CHECK(delivery IN ('in_platform','outside_platform')),
  state TEXT NOT NULL CHECK(state IN ('sent','viewed','confirmed','declined')),
  response_source TEXT NOT NULL DEFAULT '' CHECK(response_source IN ('','self','recorded_outside')),
  response_note TEXT NOT NULL DEFAULT '',
  responded_at TEXT,
  responded_by TEXT,
  notified_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(call_sheet_id,tenant_id) REFERENCES call_sheets(id,tenant_id),
  FOREIGN KEY(crew_id,tenant_id) REFERENCES production_crew(id,tenant_id),
  FOREIGN KEY(talent_id,tenant_id) REFERENCES production_talent(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(responded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((party_kind='crew')=(crew_id IS NOT NULL)),
  CHECK((party_kind='talent')=(talent_id IS NOT NULL)),
  CHECK((delivery='in_platform')=(user_id IS NOT NULL)),
  CHECK((state='sent')=(responded_at IS NULL)),
  CHECK((state='sent')=(response_source='')),
  CHECK((responded_at IS NULL)=(responded_by IS NULL)),
  CHECK(response_source<>'self' OR responded_by=user_id),
  -- رد يسجله المنتج نيابة عمن لا حساب له يلزمه بيان كيف وصل الرد.
  CHECK(response_source<>'recorded_outside' OR length(trim(response_note))>=5)
) STRICT;
CREATE UNIQUE INDEX call_sheet_invitees_crew ON call_sheet_invitees(call_sheet_id,crew_id) WHERE crew_id IS NOT NULL;
CREATE UNIQUE INDEX call_sheet_invitees_talent ON call_sheet_invitees(call_sheet_id,talent_id) WHERE talent_id IS NOT NULL;
CREATE INDEX call_sheet_invitees_user ON call_sheet_invitees(user_id,state);
CREATE TRIGGER call_sheet_invitees_fixed BEFORE UPDATE ON call_sheet_invitees
WHEN NEW.version<>OLD.version+1 OR NEW.call_sheet_id<>OLD.call_sheet_id OR NEW.party_kind<>OLD.party_kind
  OR NEW.crew_id IS NOT OLD.crew_id OR NEW.talent_id IS NOT OLD.talent_id OR NEW.user_id IS NOT OLD.user_id
  OR (NEW.state='sent' AND OLD.state<>'sent')
  OR (SELECT status FROM call_sheets WHERE id=OLD.call_sheet_id) IN ('superseded','cancelled')
BEGIN SELECT RAISE(ABORT,'an invitee line belongs to its revision: it is never reassigned nor reset to unsent'); END;
CREATE TRIGGER call_sheet_invitees_no_delete BEFORE DELETE ON call_sheet_invitees
WHEN (SELECT status FROM call_sheets WHERE id=OLD.call_sheet_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'an invitee of an issued call sheet is retained'); END;
