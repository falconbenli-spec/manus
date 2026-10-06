-- اعتماد كشوف الوقت وتخطيط الموارد والسعة.
-- القاعدة الحاكمة الأولى: الساعة المعتمدة رقم يُبنى عليه (ربحية، استغلال، فوترة)، فلا تُعدَّل بعد الاعتماد إطلاقًا.
-- التصحيح إدخال جديد في أسبوع لاحق يشير إلى الأصل، فيبقى الخطأ والتصحيح ظاهرين معًا.
-- القاعدة الثانية: «قابل للفوترة» قرار المعتمِد لا ادعاء المُسجِّل. يُحفظ قراره في سجل مستقل بوقته واسمه،
-- ولا يُكتب فوق ما أدخله الموظف في time_entries حتى يبقى الفرق بين ما ادّعاه وما اعتُمد قابلًا للمراجعة.
-- القاعدة الثالثة: لا مدة قفل مكتوبة في الكود. مدة القفل إعداد يدخله صاحبه بسنده؛ بلا إعداد لا يقفل شيء آليًا.

/* ───── مدة القفل المجدول: إعداد مالك الإجراء، بلا صف ابتدائي وبلا قيمة افتراضية ───── */
CREATE TABLE timesheet_lock_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  lock_after_days INTEGER NOT NULL CHECK(lock_after_days BETWEEN 1 AND 365),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(updated_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER timesheet_lock_settings_versioned BEFORE UPDATE ON timesheet_lock_settings
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'stale timesheet lock setting'); END;
CREATE TRIGGER timesheet_lock_settings_no_delete BEFORE DELETE ON timesheet_lock_settings
BEGIN SELECT RAISE(ABORT,'the lock window is replaced by a new dated value, not deleted'); END;

/* ───── أسبوع العمل لكل موظف: مفتوح · مُرسَل · معتمد · مُعاد · مقفل ───── */
CREATE TABLE timesheet_periods (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  week_start TEXT NOT NULL CHECK(week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  week_end TEXT NOT NULL CHECK(week_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK(status IN ('open','submitted','approved','returned','locked')),
  submitted_at TEXT,
  submit_note TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  approved_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  locked_by TEXT,
  locked_at TEXT,
  lock_basis TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,user_id,week_start),
  UNIQUE(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(approved_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(locked_by,tenant_id) REFERENCES users(id,tenant_id),
  -- فصل المهام بالهوية: الموظف لا يعتمد أسبوعه، ولو حمل تصريح الاعتماد.
  CHECK(approved_by IS NULL OR approved_by<>user_id),
  CHECK((approved_by IS NULL)=(approved_at IS NULL)),
  CHECK((locked_by IS NULL)=(locked_at IS NULL)),
  CHECK(status<>'approved' OR approved_by IS NOT NULL),
  CHECK(status<>'locked' OR locked_by IS NOT NULL),
  CHECK(status<>'submitted' OR submitted_at IS NOT NULL),
  CHECK(week_end>week_start)
) STRICT;
CREATE INDEX timesheet_periods_lookup ON timesheet_periods(tenant_id,user_id,week_start);
CREATE INDEX timesheet_periods_open ON timesheet_periods(tenant_id,status,week_start);
-- الأسبوع يبدأ الأحد وينتهي السبت. دوال الوقت غير حتمية فلا تصلح في CHECK، فيُفرض الشكل بمشغل.
CREATE TRIGGER timesheet_periods_week_shape BEFORE INSERT ON timesheet_periods
WHEN CAST(strftime('%w',NEW.week_start) AS INTEGER)<>0 OR NEW.week_end<>date(NEW.week_start,'+6 days')
BEGIN SELECT RAISE(ABORT,'a timesheet week starts on Sunday and spans seven days'); END;
-- المعتمد لا يُعاد فتحه: من المعتمد إلى المقفل فقط، والمقفل نهاية المسار.
CREATE TRIGGER timesheet_periods_transitions BEFORE UPDATE ON timesheet_periods
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.user_id<>OLD.user_id
  OR NEW.week_start<>OLD.week_start OR NEW.week_end<>OLD.week_end
  OR OLD.status='locked'
  OR (OLD.status='approved' AND NEW.status NOT IN ('approved','locked'))
  OR (OLD.status='approved' AND (NEW.approved_by IS NOT OLD.approved_by OR NEW.approved_at IS NOT OLD.approved_at))
BEGIN SELECT RAISE(ABORT,'an approved timesheet week is never reopened; correct it with a correcting entry in a later week'); END;
CREATE TRIGGER timesheet_periods_no_delete BEFORE DELETE ON timesheet_periods
BEGIN SELECT RAISE(ABORT,'timesheet weeks are retained'); END;

/* ───── قرار «قابل للفوترة» لكل إدخال، يتخذه المعتمِد لحظة الاعتماد ───── */
CREATE TABLE timesheet_entry_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_id TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES time_entries(id),
  minutes INTEGER NOT NULL CHECK(minutes>0),
  claimed_billable INTEGER NOT NULL CHECK(claimed_billable IN (0,1)),
  billable INTEGER NOT NULL CHECK(billable IN (0,1)),
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  UNIQUE(entry_id),
  FOREIGN KEY(period_id,tenant_id) REFERENCES timesheet_periods(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX timesheet_entry_decisions_period ON timesheet_entry_decisions(period_id);
CREATE TRIGGER timesheet_entry_decisions_final BEFORE UPDATE ON timesheet_entry_decisions
BEGIN SELECT RAISE(ABORT,'a billable determination is final; correct it with a correcting entry in a later week'); END;
CREATE TRIGGER timesheet_entry_decisions_no_delete BEFORE DELETE ON timesheet_entry_decisions
BEGIN SELECT RAISE(ABORT,'billable determinations are retained'); END;

/* ───── التصحيح: إدخال في أسبوع لاحق يشير إلى الأصل ولا يمحوه ───── */
CREATE TABLE timesheet_corrections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  original_entry_id TEXT NOT NULL REFERENCES time_entries(id),
  correction_entry_id TEXT NOT NULL REFERENCES time_entries(id),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(correction_entry_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(correction_entry_id<>original_entry_id)
) STRICT;
CREATE INDEX timesheet_corrections_original ON timesheet_corrections(original_entry_id);
CREATE TRIGGER timesheet_corrections_later_week BEFORE INSERT ON timesheet_corrections
WHEN (SELECT date(work_date,'-'||CAST(strftime('%w',work_date) AS INTEGER)||' days') FROM time_entries WHERE id=NEW.correction_entry_id)
  <= (SELECT date(work_date,'-'||CAST(strftime('%w',work_date) AS INTEGER)||' days') FROM time_entries WHERE id=NEW.original_entry_id)
  OR (SELECT user_id FROM time_entries WHERE id=NEW.correction_entry_id)
  <> (SELECT user_id FROM time_entries WHERE id=NEW.original_entry_id)
BEGIN SELECT RAISE(ABORT,'a correction belongs to the same person and to a later week than the entry it corrects'); END;
CREATE TRIGGER timesheet_corrections_final BEFORE UPDATE ON timesheet_corrections
BEGIN SELECT RAISE(ABORT,'a correction link is final'); END;
CREATE TRIGGER timesheet_corrections_no_delete BEFORE DELETE ON timesheet_corrections
BEGIN SELECT RAISE(ABORT,'correction links are retained'); END;

/* ───── تذكير من لم يرسل أسبوعه. لا بريد: لا مزوّد بريد في المنصة بعد ───── */
CREATE TABLE timesheet_reminders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  week_start TEXT NOT NULL CHECK(week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  channel TEXT NOT NULL CHECK(channel='in_platform'),
  raised_by TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,user_id,week_start),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(raised_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(raised_by<>user_id)
) STRICT;
CREATE INDEX timesheet_reminders_user ON timesheet_reminders(user_id,created_at);
CREATE TRIGGER timesheet_reminders_no_delete BEFORE DELETE ON timesheet_reminders
BEGIN SELECT RAISE(ABORT,'reminders are retained'); END;

/* ───── حماية ساعات الأسبوع المُرسَل والمعتمد والمقفل، على مستوى قاعدة البيانات لا الكود ─────
   تُفرض على time_entries نفسه: أي مسار آخر في المنصة يحاول تعديل ساعة داخل أسبوع محسوم يُرفض. */
-- الأسبوع المُرسَل مغلق أمام الإضافة والحذف لا أمام التعديل: المعتمِد يختم «قابل للفوترة» على إدخالاته
-- قبل أن ينقلب الأسبوع إلى معتمد، وبعد الاعتماد لا يمس الإدخالَ أحد.
CREATE TRIGGER time_entries_closed_week_no_update BEFORE UPDATE ON time_entries
WHEN EXISTS(SELECT 1 FROM timesheet_periods p WHERE p.tenant_id=OLD.tenant_id AND p.user_id=OLD.user_id
  AND OLD.work_date BETWEEN p.week_start AND p.week_end AND p.status IN ('approved','locked'))
BEGIN SELECT RAISE(ABORT,'an approved or locked timesheet week is never edited; log a correcting entry in a later week'); END;
CREATE TRIGGER time_entries_closed_week_no_delete BEFORE DELETE ON time_entries
WHEN EXISTS(SELECT 1 FROM timesheet_periods p WHERE p.tenant_id=OLD.tenant_id AND p.user_id=OLD.user_id
  AND OLD.work_date BETWEEN p.week_start AND p.week_end AND p.status IN ('submitted','approved','locked'))
BEGIN SELECT RAISE(ABORT,'a submitted, approved or locked timesheet week is never edited; log a correcting entry in a later week'); END;
-- القفل المجدول بأثر مباشر: بعد مدة المالك لا يُقبل إدخال بأثر رجعي، ولو لم يُنشأ صف الأسبوع بعد.
CREATE TRIGGER time_entries_locked_window_no_insert BEFORE INSERT ON time_entries
WHEN EXISTS(SELECT 1 FROM timesheet_periods p WHERE p.tenant_id=NEW.tenant_id AND p.user_id=NEW.user_id
    AND NEW.work_date BETWEEN p.week_start AND p.week_end AND p.status IN ('submitted','approved','locked'))
  OR EXISTS(SELECT 1 FROM timesheet_lock_settings s WHERE s.tenant_id=NEW.tenant_id
    AND NEW.work_date < date('now','+3 hours','-'||s.lock_after_days||' days'))
BEGIN SELECT RAISE(ABORT,'the week is closed or older than the owner-set lock window; log a correcting entry in an open week'); END;

/* ───── السعة الأسبوعية للشخص: رقم يدخله صاحبه بسنده، بنسخ مؤرخة. لا أربعون ساعة مفترضة ───── */
CREATE TABLE resource_capacity (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  hours_per_week INTEGER NOT NULL CHECK(hours_per_week BETWEEN 1 AND 80),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  set_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,user_id,effective_from),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(set_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX resource_capacity_lookup ON resource_capacity(tenant_id,user_id,effective_from);
CREATE TRIGGER resource_capacity_fixed BEFORE UPDATE ON resource_capacity
BEGIN SELECT RAISE(ABORT,'a capacity figure is corrected by a new dated figure'); END;
CREATE TRIGGER resource_capacity_no_delete BEFORE DELETE ON resource_capacity
BEGIN SELECT RAISE(ABORT,'capacity figures are retained'); END;

/* ───── العنصر النائب: «مصمم قادم» يُحجز عليه قبل التعيين ثم يُستبدل بشخص فتنتقل حجوزاته دفعة واحدة ───── */
CREATE TABLE role_placeholders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL,
  role_name TEXT NOT NULL CHECK(length(trim(role_name))>=2),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('open','filled','cancelled')),
  filled_user_id TEXT,
  filled_by TEXT,
  filled_at TEXT,
  fill_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(filled_user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(filled_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK((status='filled')=(filled_user_id IS NOT NULL)),
  CHECK((filled_user_id IS NULL)=(filled_at IS NULL)),
  CHECK((filled_user_id IS NULL)=(filled_by IS NULL))
) STRICT;
CREATE INDEX role_placeholders_project ON role_placeholders(tenant_id,project_id,status);
CREATE TRIGGER role_placeholders_once BEFORE UPDATE ON role_placeholders
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id
  OR NEW.role_name<>OLD.role_name OR NEW.created_by<>OLD.created_by OR OLD.status<>'open'
BEGIN SELECT RAISE(ABORT,'a placeholder is filled or cancelled once; it is not reassigned'); END;
CREATE TRIGGER role_placeholders_no_delete BEFORE DELETE ON role_placeholders
BEGIN SELECT RAISE(ABORT,'placeholders are retained'); END;

/* ───── الحجز: مبدئي أو مؤكد ─────
   المبدئي لا يدخل مجموع الساعات المجدولة ولا مؤشر فرط التحميل؛ التمييز بين ما قد يحدث وما سيحدث
   هو كل فائدة هذه الشاشة. التحويل إلى مؤكد فعل مسجل باسم صاحبه ووقته، ولا رجعة عنه إلا بإطلاق الحجز. */
CREATE TABLE resource_bookings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  project_id TEXT NOT NULL,
  user_id TEXT,
  placeholder_id TEXT,
  from_date TEXT NOT NULL CHECK(from_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  to_date TEXT NOT NULL CHECK(to_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  hours_per_week INTEGER NOT NULL CHECK(hours_per_week BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK(status IN ('tentative','confirmed','released')),
  note TEXT NOT NULL CHECK(length(trim(note))>=5),
  booked_by TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TEXT,
  confirm_note TEXT NOT NULL DEFAULT '',
  released_by TEXT,
  released_at TEXT,
  release_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(placeholder_id,tenant_id) REFERENCES role_placeholders(id,tenant_id),
  FOREIGN KEY(booked_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(confirmed_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(released_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(to_date>=from_date),
  -- إما شخص وإما عنصر نائب، لا الاثنان ولا لا شيء.
  CHECK((user_id IS NULL)<>(placeholder_id IS NULL)),
  CHECK((confirmed_by IS NULL)=(confirmed_at IS NULL)),
  CHECK((released_by IS NULL)=(released_at IS NULL)),
  CHECK(status<>'confirmed' OR confirmed_by IS NOT NULL),
  CHECK(status<>'released' OR released_by IS NOT NULL),
  CHECK(confirmed_by IS NULL OR status IN ('confirmed','released')),
  -- صاحب السجل لا يقرر فيه: المحجوز لا يؤكد حجز نفسه.
  CHECK(confirmed_by IS NULL OR user_id IS NULL OR confirmed_by<>user_id)
) STRICT;
CREATE INDEX resource_bookings_range ON resource_bookings(tenant_id,from_date,to_date);
CREATE INDEX resource_bookings_person ON resource_bookings(tenant_id,user_id,status);
CREATE INDEX resource_bookings_placeholder ON resource_bookings(placeholder_id);
CREATE TRIGGER resource_bookings_guarded BEFORE UPDATE ON resource_bookings
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id
  OR NEW.from_date<>OLD.from_date OR NEW.to_date<>OLD.to_date OR NEW.hours_per_week<>OLD.hours_per_week
  OR NEW.booked_by<>OLD.booked_by OR OLD.status='released'
  OR (OLD.status='confirmed' AND NEW.status='tentative')
  OR (OLD.placeholder_id IS NULL AND NEW.placeholder_id IS NOT NULL)
  OR (OLD.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id)
BEGIN SELECT RAISE(ABORT,'a booking is corrected by releasing it and booking again; confirmation is one way'); END;
CREATE TRIGGER resource_bookings_no_delete BEFORE DELETE ON resource_bookings
BEGIN SELECT RAISE(ABORT,'bookings are retained'); END;
