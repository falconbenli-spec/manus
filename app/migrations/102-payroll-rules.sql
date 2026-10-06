-- 102: قواعد اللائحة في الرواتب ونهاية الخدمة: الاستقالة (م34، م37)، والمخالصة (م36، م38، م50، م91)،
-- وسقوف الاستقطاع (م51، م116)، وقواعد الصرف (م48، م50.5، م67)، والانتداب (م63–65)، وقوالب الخطابات المبدئية.
-- كل قيمة من اللائحة تدخل هنا سياسة مسودة تستشهد برقم المادة، ولا تسري إلا بقبول مدير الموارد البشرية.
-- المنصة لا تحرك مالًا: كل مبلغ هنا مقترح أو محسوب، والصرف فعل بشري خارجها.

-- سياسات اللائحة. الصف بلا tenant_id مسودة مشتركة زرعتها المنصة من نص اللائحة (لا مُعد بشري لها)،
-- ويتبناها مدير الموارد البشرية لكيانه بصف مقبول جديد. ما يعده موظف الموارد البشرية لكيانه مسودة لها مُعد، ولا يقبلها مُعدها.
CREATE TABLE regulation_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('resignation','settlement','deductions','pay_rules','travel_per_diem')),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  articles TEXT NOT NULL CHECK(json_valid(articles) AND json_array_length(articles)>0),
  source TEXT NOT NULL CHECK(length(trim(source))>=10),
  body TEXT NOT NULL CHECK(length(trim(body))>=20),
  parameters TEXT NOT NULL CHECK(json_valid(parameters)),
  -- اختيارات يلزم أن يحسمها القابل عند القبول (مثل قراءة م36/2 وقاعدة التقريب). المقبول لا يحمل اختيارًا معلقًا.
  pending_choices TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(pending_choices)),
  status TEXT NOT NULL CHECK(status IN ('draft','accepted','rejected')),
  based_on TEXT REFERENCES regulation_policies(id),
  effective_from TEXT CHECK(effective_from IS NULL OR effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  prepared_by TEXT REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK(tenant_id IS NOT NULL OR (status='draft' AND prepared_by IS NULL)),
  CHECK(decided_by IS NULL OR prepared_by IS NULL OR decided_by<>prepared_by),
  CHECK((status='draft')=(decided_by IS NULL)),
  CHECK(status<>'accepted' OR (effective_from IS NOT NULL AND pending_choices='[]' AND length(trim(decision_note))>=10))
) STRICT;
CREATE INDEX regulation_policies_live ON regulation_policies(tenant_id,kind,status,effective_from);
CREATE TRIGGER regulation_policies_fixed BEFORE UPDATE ON regulation_policies
WHEN OLD.tenant_id IS NULL OR OLD.status<>'draft' OR NEW.kind<>OLD.kind OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.prepared_by IS NOT OLD.prepared_by OR NEW.articles<>OLD.articles
BEGIN SELECT RAISE(ABORT,'a seeded or decided regulation policy is never rewritten; prepare a new draft'); END;
CREATE TRIGGER regulation_policies_no_delete BEFORE DELETE ON regulation_policies BEGIN SELECT RAISE(ABORT,'regulation policies are retained'); END;

-- المسودات المزروعة من نص اللائحة. النص مستخرج آليًا من PDF بترتيب مرئي معكوس؛ كل رقم يُطابق مع النسخة الموقعة قبل القبول.
INSERT INTO regulation_policies(id,tenant_id,kind,title,articles,source,body,parameters,pending_choices,status,created_at) VALUES
('reg-seed-resignation',NULL,'resignation','الاستقالة: القبول الحكمي والتأجيل وآخر يوم عمل',
 '["م34/1","م34/2","م37/2","م37/3","م37/5"]',
 'لائحة تنظيم العمل المعتمدة على منصة قوى (أبريل 2025) — نص مستخرج آليًا يلزم مطابقته مع النسخة الموقعة',
 'الاستقالة خطاب مؤرخ إلى مدير الإدارة ونسخة إلى الموارد البشرية. تعد مقبولة إذا مضى عليها أكثر من ثلاثين يومًا دون قبولها (م34/1). يجوز خلال مدة الطلب تأجيل قبولها إلى ستين يومًا لأسباب تتعلق بمصلحة العمل (م34/2). صاحب الصلاحية يحدد آخر يوم عمل شاملًا فترة الإشعار وله حق الإعفاء منها (م37/3). لا يجوز قبول استقالة العامل المحال إلى التحقيق أو الموقوف عن العمل حتى يبت في أمره (م37/5).',
 '{"deemed_after_days":30,"deferral_max_days":60,"deferral_anchor":"submission","authority_capability":"hr.contracts.approve","block_during_investigation":true}',
 '[]','draft','2026-09-19T00:00:00.000Z'),
('reg-seed-settlement',NULL,'settlement','المخالصة النهائية: مدة الخدمة ومهلة الصرف والوفاة وقراءة م36/2',
 '["م36/2","م36/3","م38/3","م50/1","م50/2","م91/3"]',
 'لائحة تنظيم العمل المعتمدة على منصة قوى (أبريل 2025) — نص مستخرج آليًا يلزم مطابقته مع النسخة الموقعة',
 'تنبيه م36/2: نص اللائحة يعطي أجر شهر عن كل سنة لمن بلغت خدمته خمس سنوات فأكثر (القراءة الحرفية)، ونظام العمل يعطي نصف شهر عن كل سنة من السنوات الخمس الأولى ثم شهرًا عما بعدها. مثال 7 سنوات بأجر 10,000: الحرفية 70,000 ونظام العمل 45,000. لا تُعتمد مخالصة قبل أن يختار مدير الموارد البشرية القراءة هنا. يحسم مجموع الإجازات الاستثنائية بلا أجر متى تجاوز عشرين يومًا من مدة الخدمة (م91/3). تُصرف المستحقات خلال 7 أيام إن أنهت المنشأة العقد و14 يومًا إن أنهاه العامل (م50/2). عند الوفاة يُصرف الأجر الفعلي كاملًا عن شهر الوفاة والتعويض عن الإجازة المستحقة للورثة (م38/3).',
 '{"art36_reading":null,"unpaid_leave_threshold_days":20,"unpaid_leave_mode":"excess","unpaid_leave_types":["unpaid","synthetic_unpaid"],"dues_days_company":7,"dues_days_worker":14,"death_award_factor_bp":10000}',
 '["art36_reading"]','draft','2026-09-19T00:00:00.000Z'),
('reg-seed-deductions',NULL,'deductions','سقوف الاستقطاع من الأجر',
 '["م51/1","م51/5","م51/6","م116","م50/1"]',
 'لائحة تنظيم العمل المعتمدة على منصة قوى (أبريل 2025) — نص مستخرج آليًا يلزم مطابقته مع النسخة الموقعة',
 'لا يزيد ما يحسم لاسترداد قروض صاحب العمل على 10% من الأجر (م51/1)، ولا ما يحسم شهريًا لدين بحكم قضائي على ربع الأجر ما لم يتضمن الحكم خلاف ذلك (م51/6)، ولا يقتطع من الأجر أكثر من أجر خمسة أيام في الشهر وفاءً للغرامات (م116). الشهر ثلاثون يومًا للحقوق المالية (م50/1).',
 '{"loan_cap_bp":1000,"court_cap_bp":2500,"fines_cap_days":5,"day_basis_days":30}',
 '[]','draft','2026-09-19T00:00:00.000Z'),
('reg-seed-pay-rules',NULL,'pay_rules','قواعد صرف الأجر: يوم الصرف والتقريب وبدل السكن',
 '["م48","م50/5","م67/2"]',
 'لائحة تنظيم العمل المعتمدة على منصة قوى (أبريل 2025) — نص مستخرج آليًا يلزم مطابقته مع النسخة الموقعة',
 'إذا وافق يوم دفع الأجور يوم الراحة الأسبوعية أو عطلة رسمية يتم الدفع في يوم العمل السابق (م48). تقرب قيم الأجور والبدلات والمكافآت والتعويضات والحسميات إلى أقرب ريال بالزيادة (م50/5)، وهو قرار يختاره مدير الموارد البشرية، والافتراضي حتى قبوله التقريب إلى الهللة كما هو اليوم. بدل السكن 25% من الأجر الأساسي شهريًا (م67/2).',
 '{"payday_shift":"previous_working_day","rounding":null,"housing_bp_of_basic":2500}',
 '["rounding"]','draft','2026-09-19T00:00:00.000Z'),
('reg-seed-travel',NULL,'travel_per_diem','الانتداب: البدل اليومي بالدرجة وعتبات المسافة والتخفيض والتمديد',
 '["م63","م64/1","م64/3","م65/1","م65/2","م65/5"]',
 'لائحة تنظيم العمل المعتمدة على منصة قوى (أبريل 2025) — جدول م65 مستخرج آليًا يلزم مطابقته مع النسخة الموقعة',
 'قرار الانتداب يحدد المهمة والمدة وتاريخ البداية والنهاية، ولا يمدد إلا بعد بحث ما أنجز، ولا يجوز تمديده لأكثر من أسبوعين إلا بقرار صاحب الصلاحية (م64/1). يستحق البدل إذا لم تقل المسافة عن 75 كم للطرق المسفلتة أو 40 كم لغير المسفلتة أو 15 كم للوعرة (م64/3). البدل اليومي خارج المملكة/داخلها: الرئيس التنفيذي 2500/2100، نواب الرئيس 1500/1000، مدراء العموم 900/600، العاملون 500/400 ريال (م65). يخفض إلى الربع إذا وفرت المنشأة السكن ووسيلة التنقل، وإلى النصف إذا وفرت السكن فقط، ولا يتأثر إن وفرت السكن مؤقتًا أو حصل عليهما العامل من جهة غير المنشأة ما لم تحتسب التكاليف عليها (م65/2). التأشيرات والرسوم الأخرى تعوض بالمستندات الأصلية (م65/5).',
 '{"grades":{"ceo":{"name":"الرئيس التنفيذي","abroad_minor":250000,"domestic_minor":210000},"deputy":{"name":"نواب الرئيس","abroad_minor":150000,"domestic_minor":100000},"gm":{"name":"مدراء العموم","abroad_minor":90000,"domestic_minor":60000},"employee":{"name":"العاملون","abroad_minor":50000,"domestic_minor":40000}},"distance_km":{"paved":75,"unpaved":40,"rough":15},"housing_and_transport_bp":2500,"housing_only_bp":5000,"extension_max_days":14,"authority_capability":"hr.contracts.approve"}',
 '[]','draft','2026-09-19T00:00:00.000Z');

-- الاستقالة: خطاب مؤرخ إلى مدير الإدارة ونسخة إلى الموارد البشرية (م34/1).
CREATE TABLE resignations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  addressed_to TEXT,
  hr_copied INTEGER NOT NULL DEFAULT 1 CHECK(hr_copied=1),
  letter_date TEXT NOT NULL CHECK(letter_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  submitted_on TEXT NOT NULL CHECK(submitted_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
  proposed_last_day TEXT NOT NULL CHECK(proposed_last_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK(status IN ('submitted','deferred','accepted','deemed_accepted','withdrawn')),
  deferred_until TEXT,
  deferral_reason TEXT NOT NULL DEFAULT '',
  deferred_by TEXT REFERENCES users(id),
  accepted_on TEXT,
  accepted_by TEXT REFERENCES users(id),
  last_working_day TEXT,
  notice_waived INTEGER NOT NULL DEFAULT 0 CHECK(notice_waived IN (0,1)),
  last_day_set_by TEXT REFERENCES users(id),
  decision_note TEXT NOT NULL DEFAULT '',
  hold_note TEXT NOT NULL DEFAULT '',
  policy_id TEXT REFERENCES regulation_policies(id),
  offboarding_bundle_id TEXT REFERENCES lifecycle_bundles(id),
  offboarding_note TEXT NOT NULL DEFAULT '',
  source_request_id TEXT REFERENCES requests(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(addressed_to IS NULL OR addressed_to<>user_id),
  CHECK(deferred_by IS NULL OR deferred_by<>user_id),
  CHECK(accepted_by IS NULL OR accepted_by<>user_id),
  CHECK(last_day_set_by IS NULL OR last_day_set_by<>user_id),
  CHECK(status<>'deferred' OR (deferred_until IS NOT NULL AND length(trim(deferral_reason))>=10)),
  CHECK(status NOT IN ('accepted','deemed_accepted') OR accepted_on IS NOT NULL),
  CHECK((status='accepted')=(accepted_by IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX resignations_one_open ON resignations(tenant_id,user_id) WHERE status IN ('submitted','deferred');
CREATE TRIGGER resignations_versioned BEFORE UPDATE ON resignations
WHEN NEW.version<>OLD.version+1 OR NEW.user_id<>OLD.user_id OR NEW.letter_date<>OLD.letter_date OR NEW.submitted_on<>OLD.submitted_on OR NEW.reason<>OLD.reason
  OR OLD.status='withdrawn' OR (OLD.status IN ('accepted','deemed_accepted') AND (NEW.status<>OLD.status OR NEW.accepted_on<>OLD.accepted_on))
BEGIN SELECT RAISE(ABORT,'a resignation letter is fixed; an accepted or withdrawn resignation is final'); END;
CREATE TRIGGER resignations_no_delete BEFORE DELETE ON resignations BEGIN SELECT RAISE(ABORT,'resignations are retained'); END;

-- تصنيف حركات الخصم والبدل التي تحكمها سقوف اللائحة، دون تغيير جدول حركات الرواتب.
CREATE TABLE payroll_adjustment_classes (
  adjustment_id TEXT PRIMARY KEY REFERENCES payroll_adjustments(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  class TEXT NOT NULL CHECK(class IN ('court_order','fine','employer_loan','travel_per_diem')),
  reference TEXT NOT NULL CHECK(length(trim(reference))>=3),
  source_kind TEXT,
  source_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER payroll_adjustment_classes_fixed BEFORE UPDATE ON payroll_adjustment_classes BEGIN SELECT RAISE(ABORT,'an adjustment class is recorded once'); END;
CREATE TRIGGER payroll_adjustment_classes_no_delete BEFORE DELETE ON payroll_adjustment_classes BEGIN SELECT RAISE(ABORT,'adjustment classes are retained'); END;

-- أساس المخالصة بحسب اللائحة: القراءتان جنبًا إلى جنب، والمستبعد من الخدمة، ومهلة صرف المستحقات وتسجيل صرفها.
CREATE TABLE settlement_rule_basis (
  settlement_id TEXT PRIMARY KEY REFERENCES service_settlements(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  policy_id TEXT REFERENCES regulation_policies(id),
  art36_reading TEXT CHECK(art36_reading IS NULL OR art36_reading IN ('literal','labor_law')),
  literal_award_minor INTEGER NOT NULL CHECK(literal_award_minor>=0),
  labor_law_award_minor INTEGER NOT NULL CHECK(labor_law_award_minor>=0),
  unpaid_leave_days INTEGER NOT NULL DEFAULT 0 CHECK(unpaid_leave_days>=0),
  excluded_days INTEGER NOT NULL DEFAULT 0 CHECK(excluded_days>=0),
  ended_by TEXT NOT NULL CHECK(ended_by IN ('company','worker')),
  death INTEGER NOT NULL DEFAULT 0 CHECK(death IN (0,1)),
  heirs_month_wage_minor INTEGER CHECK(heirs_month_wage_minor IS NULL OR heirs_month_wage_minor>=0),
  rounding TEXT NOT NULL CHECK(rounding IN ('halala','riyal_up')),
  dues_due_on TEXT NOT NULL,
  dues_paid_on TEXT,
  dues_reference TEXT,
  dues_recorded_by TEXT REFERENCES users(id),
  dues_recorded_at TEXT,
  created_at TEXT NOT NULL,
  CHECK(death=0 OR heirs_month_wage_minor IS NOT NULL),
  CHECK((dues_paid_on IS NULL)=(dues_recorded_by IS NULL))
) STRICT;
CREATE TRIGGER settlement_rule_basis_fixed BEFORE UPDATE ON settlement_rule_basis
WHEN OLD.dues_paid_on IS NOT NULL OR NEW.literal_award_minor<>OLD.literal_award_minor OR NEW.labor_law_award_minor<>OLD.labor_law_award_minor OR NEW.art36_reading IS NOT OLD.art36_reading
  OR NEW.excluded_days<>OLD.excluded_days OR NEW.dues_due_on<>OLD.dues_due_on OR NEW.ended_by<>OLD.ended_by
BEGIN SELECT RAISE(ABORT,'the settlement basis is fixed; only the dues payment is recorded, once'); END;
CREATE TRIGGER settlement_rule_basis_no_delete BEFORE DELETE ON settlement_rule_basis BEGIN SELECT RAISE(ABORT,'settlement bases are retained'); END;

-- قرار الانتداب (م64/1): المهمة والمدة والتاريخان، ومنه يُحسب البدل اليومي ويُقترح حركة راتب لا صرفًا.
CREATE TABLE travel_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  proposed_by TEXT NOT NULL REFERENCES users(id),
  source_request_id TEXT REFERENCES requests(id),
  task TEXT NOT NULL CHECK(length(trim(task))>=5),
  destination TEXT NOT NULL CHECK(length(trim(destination))>=2),
  scope TEXT NOT NULL CHECK(scope IN ('domestic','abroad')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL CHECK(end_date>=start_date),
  distance_km INTEGER CHECK(distance_km IS NULL OR distance_km>=0),
  road_type TEXT CHECK(road_type IS NULL OR road_type IN ('paved','unpaved','rough')),
  grade TEXT CHECK(grade IS NULL OR grade IN ('ceo','deputy','gm','employee')),
  housing TEXT CHECK(housing IS NULL OR housing IN ('none','company','company_temporary','third_party','third_party_charged')),
  transport TEXT CHECK(transport IS NULL OR transport IN ('none','company','third_party','third_party_charged')),
  status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected','cancelled')),
  policy_id TEXT REFERENCES regulation_policies(id),
  eligible INTEGER CHECK(eligible IS NULL OR eligible IN (0,1)),
  days INTEGER CHECK(days IS NULL OR days>0),
  daily_rate_minor INTEGER,
  factor_bp INTEGER,
  allowance_minor INTEGER CHECK(allowance_minor IS NULL OR allowance_minor>=0),
  basis TEXT CHECK(basis IS NULL OR json_valid(basis)),
  adjustment_id TEXT REFERENCES payroll_adjustments(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(decided_by IS NULL OR (decided_by<>user_id AND decided_by<>proposed_by)),
  CHECK(status<>'approved' OR (decided_by IS NOT NULL AND eligible IS NOT NULL AND allowance_minor IS NOT NULL AND grade IS NOT NULL AND housing IS NOT NULL AND transport IS NOT NULL))
) STRICT;
CREATE INDEX travel_decisions_user ON travel_decisions(tenant_id,user_id,status);
CREATE TRIGGER travel_decisions_fixed BEFORE UPDATE ON travel_decisions
WHEN NEW.version<>OLD.version+1 OR NEW.user_id<>OLD.user_id OR OLD.status IN ('rejected','cancelled')
  OR (OLD.status='approved' AND (NEW.status NOT IN ('approved','cancelled') OR NEW.allowance_minor<>OLD.allowance_minor OR NEW.start_date<>OLD.start_date OR NEW.basis<>OLD.basis))
BEGIN SELECT RAISE(ABORT,'an approved travel decision changes only through a recorded extension'); END;
CREATE TRIGGER travel_decisions_no_delete BEFORE DELETE ON travel_decisions BEGIN SELECT RAISE(ABORT,'travel decisions are retained'); END;

-- التمديد بعد بحث ما أنجز (م64/1)، بقرار صاحب الصلاحية، ومجموعه لا يتجاوز الحد في السياسة.
CREATE TABLE travel_extensions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  travel_id TEXT NOT NULL REFERENCES travel_decisions(id),
  days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 60),
  new_end_date TEXT NOT NULL,
  progress_review TEXT NOT NULL CHECK(length(trim(progress_review))>=20),
  requested_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  allowance_minor INTEGER,
  adjustment_id TEXT REFERENCES payroll_adjustments(id),
  created_at TEXT NOT NULL,
  CHECK(decided_by IS NULL OR decided_by<>requested_by),
  CHECK((status='proposed')=(decided_by IS NULL))
) STRICT;
CREATE TRIGGER travel_extensions_fixed BEFORE UPDATE ON travel_extensions WHEN OLD.status<>'proposed'
BEGIN SELECT RAISE(ABORT,'a decided extension is final'); END;
CREATE TRIGGER travel_extensions_no_delete BEFORE DELETE ON travel_extensions BEGIN SELECT RAISE(ABORT,'travel extensions are retained'); END;

-- إيصالات التأشيرة والرسوم الأخرى (م65/5) تمر بمطالبة مصروفات عادية، وهذا الربط يثبت صلتها بالانتداب.
CREATE TABLE travel_expense_links (
  claim_id TEXT PRIMARY KEY REFERENCES expense_claims(id),
  travel_id TEXT NOT NULL REFERENCES travel_decisions(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  cost_kind TEXT NOT NULL CHECK(cost_kind IN ('visa','ticket','medical','fees','venue','other')),
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER travel_expense_links_fixed BEFORE UPDATE ON travel_expense_links BEGIN SELECT RAISE(ABORT,'links are recorded once'); END;
CREATE TRIGGER travel_expense_links_no_delete BEFORE DELETE ON travel_expense_links BEGIN SELECT RAISE(ABORT,'links are retained'); END;

-- ربط طلب الكتالوج بالسجل الذي ينفذه في وحدته (خطاب، استقالة، انتداب).
CREATE TABLE service_request_links (
  request_id TEXT PRIMARY KEY REFERENCES requests(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  module TEXT NOT NULL CHECK(module IN ('letters','resignations','travel')),
  record_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER service_request_links_fixed BEFORE UPDATE ON service_request_links BEGIN SELECT RAISE(ABORT,'links are recorded once'); END;
CREATE TRIGGER service_request_links_no_delete BEFORE DELETE ON service_request_links BEGIN SELECT RAISE(ABORT,'links are retained'); END;

-- نصوص مبدئية للقوالب، ثنائية اللغة، مسودات تحتاج اعتماد الموارد البشرية. لا تُنشر منها وحدها:
-- يتبناها موظف الموارد البشرية مسودةً باسمه في شاشة القوالب، ويعتمدها شخص آخر يملك الإصدار.
CREATE TABLE letter_template_starters (
  type_code TEXT PRIMARY KEY,
  body TEXT NOT NULL CHECK(length(trim(body))>=40),
  status_note TEXT NOT NULL CHECK(length(trim(status_note))>=10),
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER letter_template_starters_fixed BEFORE UPDATE ON letter_template_starters BEGIN SELECT RAISE(ABORT,'starter texts are replaced by a new migration'); END;
CREATE TRIGGER letter_template_starters_no_delete BEFORE DELETE ON letter_template_starters BEGIN SELECT RAISE(ABORT,'starter texts are retained'); END;
-- النص العربي أولًا ثم سطر «---- English ----» ثم الإنجليزي؛ يختار الموظف العربية أو الإنجليزية أو كلتيهما.
INSERT INTO letter_template_starters(type_code,body,status_note,created_at) VALUES
('salary','إلى: {{addressee}}

الموضوع: تعريف بالراتب

تشهد شركة 3,6T بأن {{employee_name}} يعمل لديها بوظيفة {{job_title}} منذ {{hire_date}}، وأن راتبه {{salary_total}}. أُعطي هذا التعريف بناءً على طلبه دون أدنى مسؤولية على الشركة.
---- English ----
To: {{addressee}}

Subject: Salary certificate

This is to certify that {{employee_name}} has been employed by 3,6T as {{job_title}} since {{hire_date}}, with a salary of {{salary_total}}. This certificate is issued at the employee''s request without any liability on the company.',
 'مسودة مبدئية ثنائية اللغة تحتاج اعتماد الموارد البشرية قبل أي استخدام. الاسم والمسمى يُملآن بالعربية في النصين لأن المنصة لا تحفظ لهما صيغة إنجليزية بعد.','2026-09-19T00:00:00.000Z'),
('employment','إلى: {{addressee}}

الموضوع: تعريف بالعمل

تشهد شركة 3,6T بأن {{employee_name}} يعمل لديها بوظيفة {{job_title}} منذ {{hire_date}}، ولا يزال على رأس العمل حتى تاريخه. أُعطي هذا التعريف بناءً على طلبه دون أدنى مسؤولية على الشركة.
---- English ----
To: {{addressee}}

Subject: Employment certificate

This is to certify that {{employee_name}} has been employed by 3,6T as {{job_title}} since {{hire_date}} and remains in service as of the date of this letter. This certificate is issued at the employee''s request without any liability on the company.',
 'مسودة مبدئية ثنائية اللغة تحتاج اعتماد الموارد البشرية قبل أي استخدام. لا تذكر راتبًا.','2026-09-19T00:00:00.000Z'),
('to_whom','إلى من يهمه الأمر

تشهد شركة 3,6T بأن {{employee_name}} يعمل لديها بوظيفة {{job_title}} منذ {{hire_date}}. أُعطيت هذه الإفادة بناءً على طلبه دون أدنى مسؤولية على الشركة.
---- English ----
To whom it may concern

This is to certify that {{employee_name}} has been employed by 3,6T as {{job_title}} since {{hire_date}}. This letter is issued at the employee''s request without any liability on the company.',
 'مسودة مبدئية ثنائية اللغة تحتاج اعتماد الموارد البشرية قبل أي استخدام. لا جهة مسماة ولا راتب.','2026-09-19T00:00:00.000Z'),
('experience','إلى: {{addressee}}

الموضوع: شهادة خبرة

تشهد شركة 3,6T بأن {{employee_name}} عمل لديها بوظيفة {{job_title}} من {{hire_date}} إلى {{service_end_date}}. أُعطيت هذه الشهادة بناءً على طلبه دون أدنى مسؤولية على الشركة.
---- English ----
To: {{addressee}}

Subject: Experience certificate

This is to certify that {{employee_name}} worked at 3,6T as {{job_title}} from {{hire_date}} to {{service_end_date}}. This certificate is issued at the employee''s request without any liability on the company.',
 'مسودة مبدئية ثنائية اللغة تحتاج اعتماد الموارد البشرية. تاريخ نهاية الخدمة من العقد المنتهي أو آخر يوم عمل حدده صاحب الصلاحية، وإلا «حتى تاريخه».','2026-09-19T00:00:00.000Z'),
('embassy','إلى: {{addressee}}

الموضوع: تعريف لسفارة

تشهد شركة 3,6T بأن {{employee_name}} يعمل لديها بوظيفة {{job_title}} منذ {{hire_date}}، وأن راتبه {{salary_total}}، ولا مانع لدى الشركة من سفره إلى {{destination}} في الفترة من {{travel_from}} إلى {{travel_to}}، على أن يعود بعدها إلى عمله. أُعطي هذا التعريف بناءً على طلبه دون أدنى مسؤولية على الشركة.
---- English ----
To: {{addressee}}

Subject: Letter to an embassy

This is to certify that {{employee_name}} has been employed by 3,6T as {{job_title}} since {{hire_date}}, with a salary of {{salary_total}}. The company has no objection to their travel to {{destination}} from {{travel_from}} to {{travel_to}}, after which they will resume work. This letter is issued at the employee''s request without any liability on the company.',
 'مسودة مبدئية ثنائية اللغة تحتاج اعتماد الموارد البشرية. السفارات تطلب غالبًا الجنسية ورقم الجواز، وهما ليسا عنصرين نائبين معتمدين بعد.','2026-09-19T00:00:00.000Z'),
('bank','إلى: {{addressee}}

الموضوع: تعريف بالراتب لجهة مصرفية

تشهد شركة 3,6T بأن {{employee_name}} يعمل لديها بوظيفة {{job_title}} منذ {{hire_date}}، وأن راتبه {{salary_total}}. أُعطي هذا التعريف بناءً على طلبه دون أدنى مسؤولية على الشركة، ولا يعد التزامًا من الشركة بتحويل الراتب أو كفالة أي تمويل.
---- English ----
To: {{addressee}}

Subject: Salary certificate for a bank

This is to certify that {{employee_name}} has been employed by 3,6T as {{job_title}} since {{hire_date}}, with a salary of {{salary_total}}. This letter is issued at the employee''s request without any liability on the company and is not an undertaking to transfer the salary or guarantee any financing.',
 'مسودة مبدئية ثنائية اللغة تحتاج اعتماد الموارد البشرية قبل أي استخدام.','2026-09-19T00:00:00.000Z');

-- «لمن يهمه الأمر» نوع أساسي مشترك يُضاف إلى الأنواع الخمسة (الترحيل 048).
INSERT INTO letter_types(id,tenant_id,code,name,created_at) VALUES('letter-type-to-whom',NULL,'to_whom','لمن يهمه الأمر','2026-09-19T00:00:00.000Z');

-- جهات مرجعية للخطاب: أسماء فقط، بلا شعارات ولا بيانات شخصية. قائمة يراجعها مالك الإجراء؛ الاسم الحر مسموح بعد التحقق.
CREATE TABLE letter_addressees (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('bank','embassy','government')),
  code TEXT NOT NULL CHECK(length(code) BETWEEN 2 AND 40),
  name_ar TEXT NOT NULL CHECK(length(trim(name_ar))>=3),
  name_en TEXT NOT NULL CHECK(length(trim(name_en))>=3),
  country_ar TEXT,
  country_en TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(kind,code)
) STRICT;
CREATE TRIGGER letter_addressees_no_delete BEFORE DELETE ON letter_addressees BEGIN SELECT RAISE(ABORT,'reference addressees are deactivated, not deleted'); END;
INSERT INTO letter_addressees(id,kind,code,name_ar,name_en,created_at) VALUES
('bank-snb','bank','snb','البنك الأهلي السعودي','The Saudi National Bank','2026-09-19T00:00:00.000Z'),
('bank-rajhi','bank','rajhi','مصرف الراجحي','Al Rajhi Bank','2026-09-19T00:00:00.000Z'),
('bank-riyad','bank','riyad','بنك الرياض','Riyad Bank','2026-09-19T00:00:00.000Z'),
('bank-sab','bank','sab','البنك السعودي الأول','Saudi Awwal Bank','2026-09-19T00:00:00.000Z'),
('bank-bsf','bank','bsf','البنك السعودي الفرنسي','Banque Saudi Fransi','2026-09-19T00:00:00.000Z'),
('bank-anb','bank','anb','البنك العربي الوطني','Arab National Bank','2026-09-19T00:00:00.000Z'),
('bank-albilad','bank','albilad','بنك البلاد','Bank Albilad','2026-09-19T00:00:00.000Z'),
('bank-aljazira','bank','aljazira','بنك الجزيرة','Bank AlJazira','2026-09-19T00:00:00.000Z'),
('bank-alinma','bank','alinma','مصرف الإنماء','Alinma Bank','2026-09-19T00:00:00.000Z'),
('bank-saib','bank','saib','البنك السعودي للاستثمار','The Saudi Investment Bank','2026-09-19T00:00:00.000Z'),
('bank-gib','bank','gib','بنك الخليج الدولي - السعودية','Gulf International Bank Saudi Arabia','2026-09-19T00:00:00.000Z'),
('bank-stc','bank','stcbank','بنك STC','STC Bank','2026-09-19T00:00:00.000Z'),
('bank-d360','bank','d360','بنك D360','D360 Bank','2026-09-19T00:00:00.000Z'),
('gov-hrsd','government','hrsd','وزارة الموارد البشرية والتنمية الاجتماعية','Ministry of Human Resources and Social Development','2026-09-19T00:00:00.000Z'),
('gov-jawazat','government','jawazat','المديرية العامة للجوازات','General Directorate of Passports','2026-09-19T00:00:00.000Z'),
('gov-mofa','government','mofa','وزارة الخارجية','Ministry of Foreign Affairs','2026-09-19T00:00:00.000Z'),
('gov-gosi','government','gosi','المؤسسة العامة للتأمينات الاجتماعية','General Organization for Social Insurance','2026-09-19T00:00:00.000Z'),
('gov-housing','government','housing','وزارة البلديات والإسكان','Ministry of Municipalities and Housing','2026-09-19T00:00:00.000Z'),
('gov-redf','government','redf','صندوق التنمية العقارية','Real Estate Development Fund','2026-09-19T00:00:00.000Z'),
('gov-moe','government','moe','وزارة التعليم','Ministry of Education','2026-09-19T00:00:00.000Z'),
('gov-courts','government','courts','المحاكم ووزارة العدل','Ministry of Justice and the Courts','2026-09-19T00:00:00.000Z');
INSERT INTO letter_addressees(id,kind,code,name_ar,name_en,country_ar,country_en,created_at) VALUES
('emb-us','embassy','us','سفارة الولايات المتحدة الأمريكية','Embassy of the United States of America','الولايات المتحدة الأمريكية','the United States','2026-09-19T00:00:00.000Z'),
('emb-gb','embassy','gb','سفارة المملكة المتحدة','British Embassy','المملكة المتحدة','the United Kingdom','2026-09-19T00:00:00.000Z'),
('emb-ca','embassy','ca','سفارة كندا','Embassy of Canada','كندا','Canada','2026-09-19T00:00:00.000Z'),
('emb-au','embassy','au','سفارة أستراليا','Embassy of Australia','أستراليا','Australia','2026-09-19T00:00:00.000Z'),
('emb-nz','embassy','nz','سفارة نيوزيلندا','Embassy of New Zealand','نيوزيلندا','New Zealand','2026-09-19T00:00:00.000Z'),
('emb-ie','embassy','ie','سفارة أيرلندا','Embassy of Ireland','أيرلندا','Ireland','2026-09-19T00:00:00.000Z'),
('emb-fr','embassy','fr','سفارة فرنسا','Embassy of France','فرنسا','France','2026-09-19T00:00:00.000Z'),
('emb-de','embassy','de','سفارة ألمانيا','Embassy of Germany','ألمانيا','Germany','2026-09-19T00:00:00.000Z'),
('emb-it','embassy','it','سفارة إيطاليا','Embassy of Italy','إيطاليا','Italy','2026-09-19T00:00:00.000Z'),
('emb-es','embassy','es','سفارة إسبانيا','Embassy of Spain','إسبانيا','Spain','2026-09-19T00:00:00.000Z'),
('emb-pt','embassy','pt','سفارة البرتغال','Embassy of Portugal','البرتغال','Portugal','2026-09-19T00:00:00.000Z'),
('emb-nl','embassy','nl','سفارة هولندا','Embassy of the Netherlands','هولندا','the Netherlands','2026-09-19T00:00:00.000Z'),
('emb-be','embassy','be','سفارة بلجيكا','Embassy of Belgium','بلجيكا','Belgium','2026-09-19T00:00:00.000Z'),
('emb-ch','embassy','ch','سفارة سويسرا','Embassy of Switzerland','سويسرا','Switzerland','2026-09-19T00:00:00.000Z'),
('emb-at','embassy','at','سفارة النمسا','Embassy of Austria','النمسا','Austria','2026-09-19T00:00:00.000Z'),
('emb-se','embassy','se','سفارة السويد','Embassy of Sweden','السويد','Sweden','2026-09-19T00:00:00.000Z'),
('emb-no','embassy','no','سفارة النرويج','Embassy of Norway','النرويج','Norway','2026-09-19T00:00:00.000Z'),
('emb-dk','embassy','dk','سفارة الدنمارك','Embassy of Denmark','الدنمارك','Denmark','2026-09-19T00:00:00.000Z'),
('emb-gr','embassy','gr','سفارة اليونان','Embassy of Greece','اليونان','Greece','2026-09-19T00:00:00.000Z'),
('emb-cz','embassy','cz','سفارة التشيك','Embassy of the Czech Republic','التشيك','the Czech Republic','2026-09-19T00:00:00.000Z'),
('emb-pl','embassy','pl','سفارة بولندا','Embassy of Poland','بولندا','Poland','2026-09-19T00:00:00.000Z'),
('emb-tr','embassy','tr','سفارة تركيا','Embassy of Türkiye','تركيا','Türkiye','2026-09-19T00:00:00.000Z'),
('emb-jp','embassy','jp','سفارة اليابان','Embassy of Japan','اليابان','Japan','2026-09-19T00:00:00.000Z'),
('emb-cn','embassy','cn','سفارة الصين','Embassy of China','الصين','China','2026-09-19T00:00:00.000Z'),
('emb-kr','embassy','kr','سفارة كوريا الجنوبية','Embassy of the Republic of Korea','كوريا الجنوبية','the Republic of Korea','2026-09-19T00:00:00.000Z'),
('emb-sg','embassy','sg','سفارة سنغافورة','Embassy of Singapore','سنغافورة','Singapore','2026-09-19T00:00:00.000Z'),
('emb-my','embassy','my','سفارة ماليزيا','Embassy of Malaysia','ماليزيا','Malaysia','2026-09-19T00:00:00.000Z'),
('emb-id','embassy','id','سفارة إندونيسيا','Embassy of Indonesia','إندونيسيا','Indonesia','2026-09-19T00:00:00.000Z'),
('emb-th','embassy','th','سفارة تايلاند','Embassy of Thailand','تايلاند','Thailand','2026-09-19T00:00:00.000Z'),
('emb-in','embassy','in','سفارة الهند','Embassy of India','الهند','India','2026-09-19T00:00:00.000Z'),
('emb-pk','embassy','pk','سفارة باكستان','Embassy of Pakistan','باكستان','Pakistan','2026-09-19T00:00:00.000Z'),
('emb-ph','embassy','ph','سفارة الفلبين','Embassy of the Philippines','الفلبين','the Philippines','2026-09-19T00:00:00.000Z'),
('emb-eg','embassy','eg','سفارة مصر','Embassy of Egypt','مصر','Egypt','2026-09-19T00:00:00.000Z'),
('emb-jo','embassy','jo','سفارة الأردن','Embassy of Jordan','الأردن','Jordan','2026-09-19T00:00:00.000Z'),
('emb-lb','embassy','lb','سفارة لبنان','Embassy of Lebanon','لبنان','Lebanon','2026-09-19T00:00:00.000Z'),
('emb-ma','embassy','ma','سفارة المغرب','Embassy of Morocco','المغرب','Morocco','2026-09-19T00:00:00.000Z'),
('emb-tn','embassy','tn','سفارة تونس','Embassy of Tunisia','تونس','Tunisia','2026-09-19T00:00:00.000Z'),
('emb-ae','embassy','ae','سفارة الإمارات العربية المتحدة','Embassy of the United Arab Emirates','الإمارات العربية المتحدة','the United Arab Emirates','2026-09-19T00:00:00.000Z'),
('emb-bh','embassy','bh','سفارة البحرين','Embassy of Bahrain','البحرين','Bahrain','2026-09-19T00:00:00.000Z'),
('emb-kw','embassy','kw','سفارة الكويت','Embassy of Kuwait','الكويت','Kuwait','2026-09-19T00:00:00.000Z'),
('emb-om','embassy','om','سفارة عُمان','Embassy of Oman','عُمان','Oman','2026-09-19T00:00:00.000Z'),
('emb-qa','embassy','qa','سفارة قطر','Embassy of Qatar','قطر','Qatar','2026-09-19T00:00:00.000Z'),
('emb-ge','embassy','ge','سفارة جورجيا','Embassy of Georgia','جورجيا','Georgia','2026-09-19T00:00:00.000Z'),
('emb-az','embassy','az','سفارة أذربيجان','Embassy of Azerbaijan','أذربيجان','Azerbaijan','2026-09-19T00:00:00.000Z');

-- خيارات طلب الخطاب: الجهة من القائمة أو نص حر، واللغة، وتفصيل الراتب وفترته (بلا مبلغ)، وتواريخ السفر، والتسليم والنسخ والاستعجال.
-- لا عمود هنا لمبلغ: الراتب يُشتق عند الإصدار من العقد الساري ويُثبَّت في نص الخطاب المُصدَر وحده.
CREATE TABLE letter_request_options (
  request_id TEXT PRIMARY KEY REFERENCES letter_requests(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  addressee_kind TEXT NOT NULL CHECK(addressee_kind IN ('bank','embassy','government','to_whom','other')),
  addressee_code TEXT,
  language TEXT NOT NULL CHECK(language IN ('ar','en','both')),
  salary_detail TEXT CHECK(salary_detail IS NULL OR salary_detail IN ('total','breakdown')),
  salary_period TEXT CHECK(salary_period IS NULL OR salary_period IN ('monthly','annual')),
  travel_from TEXT,
  travel_to TEXT,
  destination TEXT,
  delivery TEXT NOT NULL CHECK(delivery IN ('digital','printed')),
  copies INTEGER NOT NULL DEFAULT 1 CHECK(copies BETWEEN 1 AND 5),
  urgent INTEGER NOT NULL DEFAULT 0 CHECK(urgent IN (0,1)),
  urgent_reason TEXT NOT NULL DEFAULT '',
  due_on TEXT NOT NULL,
  reused_from TEXT REFERENCES letter_requests(id),
  handed_over_at TEXT,
  handed_over_by TEXT REFERENCES users(id),
  handover_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK((addressee_kind IN ('bank','embassy','government'))=(addressee_code IS NOT NULL)),
  CHECK(urgent=0 OR length(trim(urgent_reason))>=5),
  CHECK(delivery='printed' OR copies=1),
  CHECK(travel_from IS NULL OR travel_to IS NULL OR travel_to>=travel_from)
) STRICT;
CREATE TRIGGER letter_request_options_fixed BEFORE UPDATE ON letter_request_options
WHEN OLD.handed_over_at IS NOT NULL OR NEW.language<>OLD.language OR NEW.addressee_kind<>OLD.addressee_kind OR NEW.addressee_code IS NOT OLD.addressee_code
  OR NEW.salary_detail IS NOT OLD.salary_detail OR NEW.salary_period IS NOT OLD.salary_period OR NEW.delivery<>OLD.delivery OR NEW.copies<>OLD.copies OR NEW.urgent<>OLD.urgent OR NEW.due_on<>OLD.due_on
BEGIN SELECT RAISE(ABORT,'letter options are fixed at request time; only the printed handover is recorded, once'); END;
CREATE TRIGGER letter_request_options_no_delete BEFORE DELETE ON letter_request_options BEGIN SELECT RAISE(ABORT,'letter options are retained'); END;
