-- حماية الأجور: مواصفة ملف الأجور تُدخل بيانات لا كودًا، وفحوص ما قبل التصدير، والأجر المسجّل لدى الجهة يدويًا،
-- وعتبات كشف شذوذ المسير يحددها المستخدم. لا عمود ثابت ولا نسبة نظامية في الكود ولا اتصال بأي جهة.

-- مواصفة الملف كما هي في حساب المنشأة لدى الجهة: أعمدة مرقّمة بمصادرها من المنصة، وفاصل وترميز ومن أدخلها ومصدرها وتاريخ تأكيدها.
-- من يدخل المواصفة لا يؤكدها، والمؤكدة لا تُعدَّل: التصحيح نسخة جديدة تحل محلها وتبقى القديمة.
CREATE TABLE wps_file_formats (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bank_name TEXT NOT NULL CHECK(length(trim(bank_name)) BETWEEN 2 AND 180),
  format_label TEXT NOT NULL CHECK(length(trim(format_label)) BETWEEN 2 AND 180),
  revision INTEGER NOT NULL CHECK(revision>0),
  layout TEXT NOT NULL CHECK(layout IN ('delimited','fixed')),
  delimiter TEXT NOT NULL,
  encoding TEXT NOT NULL CHECK(encoding IN ('utf-8','utf-8-bom')),
  line_ending TEXT NOT NULL CHECK(line_ending IN ('crlf','lf')),
  include_header INTEGER NOT NULL CHECK(include_header IN (0,1)),
  columns TEXT NOT NULL CHECK(json_valid(columns) AND json_array_length(columns) BETWEEN 1 AND 60),
  spec_source TEXT NOT NULL CHECK(length(trim(spec_source))>=10),
  spec_confirmed_on TEXT NOT NULL CHECK(spec_confirmed_on LIKE '____-__-__'),
  status TEXT NOT NULL CHECK(status IN ('draft','active','rejected','retired')),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  confirmed_by TEXT REFERENCES users(id),
  confirmed_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,bank_name,revision),
  CHECK(confirmed_by IS NULL OR confirmed_by<>recorded_by),
  CHECK((status='draft')=(confirmed_by IS NULL)),
  CHECK((layout='delimited')=(length(delimiter)>0))
) STRICT;
CREATE UNIQUE INDEX wps_formats_one_draft ON wps_file_formats(tenant_id,bank_name) WHERE status='draft';
CREATE UNIQUE INDEX wps_formats_one_active ON wps_file_formats(tenant_id,bank_name) WHERE status='active';
-- تعريف الصيغة نفسه لا يتغير بعد إدخاله إطلاقًا؛ ما يتغير حالته ومن قرر فيها. المؤكدة لا تعود مسودة، وتُسحب بالتقاعد فقط.
CREATE TRIGGER wps_formats_fixed BEFORE UPDATE ON wps_file_formats
WHEN NEW.version<>OLD.version+1 OR OLD.status IN ('retired','rejected')
  OR NEW.tenant_id<>OLD.tenant_id OR NEW.bank_name<>OLD.bank_name OR NEW.revision<>OLD.revision OR NEW.recorded_by<>OLD.recorded_by
  OR NEW.columns<>OLD.columns OR NEW.layout<>OLD.layout OR NEW.delimiter<>OLD.delimiter OR NEW.encoding<>OLD.encoding
  OR NEW.line_ending<>OLD.line_ending OR NEW.include_header<>OLD.include_header OR NEW.spec_source<>OLD.spec_source OR NEW.spec_confirmed_on<>OLD.spec_confirmed_on
  OR (OLD.status='active' AND NEW.status<>'retired')
  OR (OLD.status='draft' AND NEW.status NOT IN ('active','rejected'))
BEGIN SELECT RAISE(ABORT,'a confirmed wage file format is replaced by a new revision, not edited'); END;
CREATE TRIGGER wps_formats_no_delete BEFORE DELETE ON wps_file_formats WHEN OLD.status<>'draft'
BEGIN SELECT RAISE(ABORT,'decided wage file formats are retained'); END;

-- كل تصدير محفوظ ببصمة ملفه وبصورة الفحوص وقت التصدير، ثم يُسجل رفعه اليدوي مرة واحدة بمرجعه.
-- المنصة لا ترفع الملف ولا تتصل بجهة؛ الرفع إقرار بشري يوثقه شخص غير من صدّر.
CREATE TABLE wps_exports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  format_id TEXT NOT NULL REFERENCES wps_file_formats(id),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  headcount INTEGER NOT NULL CHECK(headcount>0),
  total_minor INTEGER NOT NULL CHECK(total_minor>0),
  run_total_minor INTEGER NOT NULL CHECK(run_total_minor>=0),
  file_digest TEXT NOT NULL,
  checks TEXT NOT NULL CHECK(json_valid(checks)),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK(warning_count>=0),
  exported_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  uploaded_on TEXT,
  upload_reference TEXT,
  upload_note TEXT NOT NULL DEFAULT '',
  upload_recorded_by TEXT REFERENCES users(id),
  upload_recorded_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  CHECK(total_minor=run_total_minor),
  CHECK(upload_recorded_by IS NULL OR upload_recorded_by<>exported_by),
  CHECK((uploaded_on IS NULL)=(upload_recorded_by IS NULL)),
  CHECK(uploaded_on IS NULL OR length(trim(upload_note))>=10)
) STRICT;
CREATE INDEX wps_exports_run ON wps_exports(tenant_id,run_id);
CREATE TRIGGER wps_exports_fixed BEFORE UPDATE ON wps_exports
WHEN NEW.version<>OLD.version+1 OR OLD.uploaded_on IS NOT NULL
  OR NEW.run_id<>OLD.run_id OR NEW.format_id<>OLD.format_id OR NEW.file_digest<>OLD.file_digest
  OR NEW.total_minor<>OLD.total_minor OR NEW.headcount<>OLD.headcount OR NEW.exported_by<>OLD.exported_by OR NEW.checks<>OLD.checks
BEGIN SELECT RAISE(ABORT,'an export keeps its digest and checks; the manual upload is recorded once'); END;
CREATE TRIGGER wps_exports_no_delete BEFORE DELETE ON wps_exports BEGIN SELECT RAISE(ABORT,'exports are retained'); END;

-- الأجر المسجّل لدى الجهة: رقم يقرأه مدير الموارد البشرية من حساب المنشأة ويدخله بيده بتاريخ تسجيله ومصدره.
-- لا يُجلب آليًا ولا يُصحَّح آليًا؛ تصحيحه إدخال جديد يحل محل السابق ويبقى السابق.
CREATE TABLE wage_registrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  registered_wage_minor INTEGER NOT NULL CHECK(registered_wage_minor>0),
  registered_on TEXT NOT NULL CHECK(registered_on LIKE '____-__-__'),
  source_note TEXT NOT NULL CHECK(length(trim(source_note))>=10),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  -- الإحالة إلى الإدخال اللاحق مؤجلة إلى نهاية المعاملة: القديم يُوسم أولًا كي لا يوجد «ساريان» للحظة واحدة.
  superseded_by TEXT REFERENCES wage_registrations(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(recorded_by<>user_id)
) STRICT;
CREATE UNIQUE INDEX wage_registrations_current ON wage_registrations(user_id) WHERE superseded_by IS NULL;
CREATE TRIGGER wage_registrations_fixed BEFORE UPDATE ON wage_registrations
WHEN OLD.superseded_by IS NOT NULL OR NEW.registered_wage_minor<>OLD.registered_wage_minor OR NEW.user_id<>OLD.user_id
  OR NEW.registered_on<>OLD.registered_on OR NEW.recorded_by<>OLD.recorded_by OR NEW.source_note<>OLD.source_note
BEGIN SELECT RAISE(ABORT,'a wage registration entry is superseded, not edited'); END;
CREATE TRIGGER wage_registrations_no_delete BEFORE DELETE ON wage_registrations BEGIN SELECT RAISE(ABORT,'wage registrations are retained'); END;

-- قرار الإنسان في فرق المطابقة الثلاثية: طلب تعديل التسجيل، أو تصحيح العقد، أو تفسير مكتوب. لا تصحيح آلي.
CREATE TABLE wage_difference_notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  contract_wage_minor INTEGER,
  registered_wage_minor INTEGER,
  payroll_wage_minor INTEGER,
  resolution TEXT NOT NULL CHECK(resolution IN ('registration_update_requested','contract_correction_requested','explained')),
  note TEXT NOT NULL CHECK(length(trim(note))>=10),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(recorded_by<>user_id)
) STRICT;
CREATE INDEX wage_difference_notes_month ON wage_difference_notes(tenant_id,month,user_id);
CREATE TRIGGER wage_difference_notes_immutable BEFORE UPDATE ON wage_difference_notes
BEGIN SELECT RAISE(ABORT,'a recorded explanation is immutable; record a new one'); END;
CREATE TRIGGER wage_difference_notes_no_delete BEFORE DELETE ON wage_difference_notes
BEGIN SELECT RAISE(ABORT,'explanations are retained'); END;

-- عتبات كشف الشذوذ: كلها فارغة حتى يدخلها صاحبها بسندها. الفحص بلا عتبة لا يعمل ويقول ذلك بدل أن يفترض رقمًا.
CREATE TABLE payroll_anomaly_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  variance_bp INTEGER CHECK(variance_bp IS NULL OR variance_bp BETWEEN 1 AND 100000),
  variance_amount_minor INTEGER CHECK(variance_amount_minor IS NULL OR variance_amount_minor>0),
  deduction_ratio_bp INTEGER CHECK(deduction_ratio_bp IS NULL OR deduction_ratio_bp BETWEEN 1 AND 10000),
  overtime_factor_bp INTEGER CHECK(overtime_factor_bp IS NULL OR overtime_factor_bp>=10000),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER payroll_anomaly_settings_versioned BEFORE UPDATE ON payroll_anomaly_settings
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id
BEGIN SELECT RAISE(ABORT,'thresholds are updated with their version'); END;
CREATE TRIGGER payroll_anomaly_settings_no_delete BEFORE DELETE ON payroll_anomaly_settings
BEGIN SELECT RAISE(ABORT,'threshold history is retained'); END;
