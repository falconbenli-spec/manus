-- 112: تعميم الانتداب (جدول بدل مؤرخ جديد ودرجات التذاكر م41) والمزايا الثلاث الجديدة (تأمين الوالدين، دراسة الأبناء، الأندية الصحية).
-- يمتد على الترحيلين 102 (الانتداب) و103 (كتالوج المزايا) ولا يعيد بناء أي منهما:
--   * جدول البدل يصبح نسخًا مؤرخة: نسخة اللائحة (م65) تبقى قائمة ثم تنتهي، ونسخة التعميم مسودة لا تسري حتى يُدخل
--     صاحب الصلاحية تاريخ سريانها — التعميم لا يذكر تاريخًا، فالتفعيل ممنوع قبل إدخاله.
--   * الطلب القديم يحسب بنسخة تاريخ بدايته، فلا يتغير أثر قرار مضى.
-- المنصة لا تصرف: كل مبلغ هنا محسوب أو مقترح، والصرف فعل بشري خارجها.

-- ————— 1) الدرجات الوظيفية —————
-- بيانات مرجعية فقط. اللائحة تقول «مدراء العموم» والتعميم يقول «مدراء الإدارات»؛ هل هما درجة واحدة قرار يحتاج تأكيد المالك.
CREATE TABLE job_grades (
  code TEXT PRIMARY KEY CHECK(code IN ('A','B','C','D')),
  sort_order INTEGER NOT NULL,
  name_ar TEXT NOT NULL CHECK(length(trim(name_ar))>=3),
  travel_grade TEXT NOT NULL CHECK(travel_grade IN ('ceo','deputy','gm','employee')),
  note TEXT NOT NULL DEFAULT '',
  needs_confirmation INTEGER NOT NULL DEFAULT 0 CHECK(needs_confirmation IN (0,1))
) STRICT;
CREATE TRIGGER job_grades_fixed BEFORE UPDATE ON job_grades BEGIN SELECT RAISE(ABORT,'reference grades change through a new migration'); END;
CREATE TRIGGER job_grades_no_delete BEFORE DELETE ON job_grades BEGIN SELECT RAISE(ABORT,'reference grades are retained'); END;
INSERT INTO job_grades(code,sort_order,name_ar,travel_grade,note,needs_confirmation) VALUES
('A',10,'الرئيس التنفيذي','ceo','التعميم صامت عن بدل هذه الدرجة، فتبقى على قيم م65 من اللائحة.',0),
('B',20,'نواب الرئيس','deputy','درجة التذكرة محل تعارض: اللائحة (م41) تعطيها الدرجة الأولى والتعميم يعطيها درجة رجال الأعمال.',1),
('C',30,'مدراء الإدارات / مدراء العموم','gm','اللائحة تسميها «مدراء العموم» والتعميم يسميها «مدراء الإدارات»؛ يلزم تأكيد أنهما درجة واحدة.',1),
('D',40,'العاملون','employee','',0);

-- درجة الموظف: تسجيل يكتبه فريق الموارد البشرية. لا درجة مفترضة؛ ما لم تُسجَّل يُرفض ما يعتمد عليها بنص السبب.
CREATE TABLE employee_job_grades (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  grade_code TEXT NOT NULL REFERENCES job_grades(code),
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER employee_job_grades_no_delete BEFORE DELETE ON employee_job_grades BEGIN SELECT RAISE(ABORT,'grade records are retained; record a new grade instead'); END;

-- ————— 2) نسخ جدول بدل الانتداب ودرجات التذاكر —————
-- status: مسودة (لا تسري) ← سارية ← منتهية حين تسري نسخة أحدث. التفعيل يلزمه تاريخ سريان يدخله صاحب الصلاحية.
CREATE TABLE secondment_allowance_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL CHECK(code IN ('regulation_art65','circular')),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  source TEXT NOT NULL CHECK(length(trim(source))>=10),
  articles TEXT NOT NULL CHECK(json_valid(articles) AND json_array_length(articles)>0),
  body TEXT NOT NULL CHECK(length(trim(body))>=20),
  status TEXT NOT NULL CHECK(status IN ('draft','active','expired')),
  effective_from TEXT CHECK(effective_from IS NULL OR effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  effective_to TEXT CHECK(effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- م50/5: التقريب إلى أقرب ريال بالزيادة. نسخة اللائحة تبقى على ما كان (الهللة) حتى لا يتغير أثر قرار مضى.
  rounding TEXT NOT NULL CHECK(rounding IN ('halala','riyal_up')),
  -- م41: ريال لكل كيلومتر ذهابًا وإيابًا حين لا سيارة للشركة ولا مطار في مدينة المهمة (بالهللة).
  mileage_rate_minor INTEGER NOT NULL DEFAULT 0 CHECK(mileage_rate_minor>=0),
  requires_attestation INTEGER NOT NULL DEFAULT 0 CHECK(requires_attestation IN (0,1)),
  pending_note TEXT NOT NULL DEFAULT '',
  activated_by TEXT REFERENCES users(id),
  activated_at TEXT,
  activation_note TEXT NOT NULL DEFAULT '',
  superseded_by TEXT REFERENCES secondment_allowance_versions(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  -- لا سريان بلا تاريخ: التعميم لا يذكر تاريخًا، فالتفعيل موقوف حتى يدخله صاحب الصلاحية.
  CHECK(status='draft' OR effective_from IS NOT NULL),
  CHECK(activated_by IS NULL OR status<>'draft'),
  CHECK(status<>'expired' OR effective_to IS NOT NULL),
  CHECK(effective_to IS NULL OR effective_from IS NULL OR effective_to>=effective_from)
) STRICT;
CREATE INDEX secondment_allowance_versions_live ON secondment_allowance_versions(tenant_id,status,effective_from);
CREATE TRIGGER secondment_allowance_versions_fixed BEFORE UPDATE ON secondment_allowance_versions
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code OR NEW.articles<>OLD.articles OR NEW.body<>OLD.body
  OR NEW.mileage_rate_minor<>OLD.mileage_rate_minor OR NEW.rounding<>OLD.rounding OR NEW.requires_attestation<>OLD.requires_attestation
  OR OLD.status='expired' OR (OLD.status='active' AND (NEW.status<>'expired' OR NEW.effective_from<>OLD.effective_from))
BEGIN SELECT RAISE(ABORT,'an allowance version is activated once and then only expires'); END;
CREATE TRIGGER secondment_allowance_versions_no_delete BEFORE DELETE ON secondment_allowance_versions BEGIN SELECT RAISE(ABORT,'allowance versions are retained'); END;

-- قيم الدرجة في النسخة: البدل اليومي داخل المملكة وخارجها، ودرجة التذكرة المستحقة.
CREATE TABLE secondment_allowance_grades (
  version_id TEXT NOT NULL REFERENCES secondment_allowance_versions(id),
  grade TEXT NOT NULL CHECK(grade IN ('ceo','deputy','gm','employee')),
  grade_code TEXT NOT NULL REFERENCES job_grades(code),
  domestic_minor INTEGER NOT NULL CHECK(domestic_minor>=0),
  abroad_minor INTEGER NOT NULL CHECK(abroad_minor>=0),
  ticket_class TEXT NOT NULL CHECK(ticket_class IN ('first','business','economy')),
  ticket_class_source TEXT NOT NULL CHECK(length(trim(ticket_class_source))>=3),
  ticket_class_conflict TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(version_id,grade)
) STRICT;
CREATE TRIGGER secondment_allowance_grades_fixed BEFORE UPDATE ON secondment_allowance_grades BEGIN SELECT RAISE(ABORT,'allowance rates are fixed; a new circular is a new version'); END;
CREATE TRIGGER secondment_allowance_grades_no_delete BEFORE DELETE ON secondment_allowance_grades BEGIN SELECT RAISE(ABORT,'allowance rates are retained'); END;

-- إقرار المدير (م64): لا يوجد في منطقة المهمة موظف يستطيع أداءها. إقرار مكتوب يُسجَّل مرة واحدة ولا يُعدَّل.
CREATE TABLE secondment_attestations (
  travel_id TEXT PRIMARY KEY REFERENCES travel_decisions(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  attested_by TEXT NOT NULL REFERENCES users(id),
  statement TEXT NOT NULL CHECK(length(trim(statement))>=20),
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER secondment_attestations_fixed BEFORE UPDATE ON secondment_attestations BEGIN SELECT RAISE(ABORT,'an attestation is recorded once'); END;
CREATE TRIGGER secondment_attestations_no_delete BEFORE DELETE ON secondment_attestations BEGIN SELECT RAISE(ABORT,'attestations are retained'); END;

-- التذاكر (م41): الوضع المختار وحسابه. المبلغ محسوب لا مصروف؛ الصرف يمر بمطالبة مصروفات أو حركة راتب مقترحة.
CREATE TABLE secondment_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  travel_id TEXT NOT NULL REFERENCES travel_decisions(id),
  version_id TEXT NOT NULL REFERENCES secondment_allowance_versions(id),
  grade TEXT NOT NULL CHECK(grade IN ('ceo','deputy','gm','employee')),
  entitled_class TEXT NOT NULL CHECK(entitled_class IN ('first','business','economy','per_contract')),
  mode TEXT NOT NULL CHECK(mode IN ('ticket','cash_lowest_fare','fare_difference','company_car','mileage','contract_or_authority')),
  issued_class TEXT CHECK(issued_class IS NULL OR issued_class IN ('first','business','economy')),
  entitled_fare_minor INTEGER CHECK(entitled_fare_minor IS NULL OR entitled_fare_minor>=0),
  issued_fare_minor INTEGER CHECK(issued_fare_minor IS NULL OR issued_fare_minor>=0),
  distance_km INTEGER CHECK(distance_km IS NULL OR distance_km>=0),
  rate_minor INTEGER CHECK(rate_minor IS NULL OR rate_minor>=0),
  measured_from TEXT NOT NULL DEFAULT '' CHECK(measured_from IN ('','workplace','nearest_airport')),
  higher_class INTEGER NOT NULL DEFAULT 0 CHECK(higher_class IN (0,1)),
  higher_class_reason TEXT NOT NULL DEFAULT '' CHECK(higher_class_reason IN ('','ceo','official_guests')),
  driver INTEGER NOT NULL DEFAULT 0 CHECK(driver IN (0,1)),
  driver_assistant INTEGER NOT NULL DEFAULT 0 CHECK(driver_assistant IN (0,1)),
  driver_reason TEXT NOT NULL DEFAULT '' CHECK(driver_reason IN ('','materials','ceo')),
  driver_value_minor INTEGER NOT NULL DEFAULT 0 CHECK(driver_value_minor>=0),
  contract_basis TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),
  payable_via TEXT NOT NULL CHECK(payable_via IN ('none','company_expense','payroll_proposal')),
  basis TEXT NOT NULL CHECK(json_valid(basis)),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  -- لا تذكرة للمنتدب حين تُستعمل سيارة الشركة (الوقود والصيانة على المنشأة)؛ ما يُسجَّل معها هو قيمة تذكرة السائق ومساعده وحدها.
  CHECK(mode<>'company_car' OR driver=1 OR amount_minor=0),
  CHECK(mode<>'company_car' OR driver=0 OR amount_minor=driver_value_minor*(1+driver_assistant)),
  CHECK(mode<>'mileage' OR (distance_km IS NOT NULL AND rate_minor IS NOT NULL AND measured_from<>'')),
  CHECK(mode<>'fare_difference' OR (issued_class IS NOT NULL AND entitled_fare_minor IS NOT NULL AND issued_fare_minor IS NOT NULL)),
  CHECK(mode<>'cash_lowest_fare' OR entitled_fare_minor IS NOT NULL),
  CHECK(mode<>'contract_or_authority' OR length(trim(contract_basis))>=10),
  CHECK(higher_class=0 OR higher_class_reason<>''),
  CHECK(driver=0 OR driver_reason<>''),
  CHECK(driver_assistant=0 OR driver=1)
) STRICT;
CREATE INDEX secondment_tickets_travel ON secondment_tickets(tenant_id,travel_id);
CREATE TRIGGER secondment_tickets_fixed BEFORE UPDATE ON secondment_tickets BEGIN SELECT RAISE(ABORT,'a ticket entitlement is recorded once; record a new one'); END;
CREATE TRIGGER secondment_tickets_no_delete BEFORE DELETE ON secondment_tickets BEGIN SELECT RAISE(ABORT,'ticket entitlements are retained'); END;

-- قوالب النسخ: النص كما صيغ من اللائحة ومن التعميم. عامة لا تخص كيانًا، وتُنسخ لكل كيان قائم ولكل كيان يُنشأ بعدها.
CREATE TABLE secondment_allowance_templates (
  code TEXT PRIMARY KEY CHECK(code IN ('regulation_art65','circular')),
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  articles TEXT NOT NULL CHECK(json_valid(articles)),
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','active')),
  effective_from TEXT,
  rounding TEXT NOT NULL CHECK(rounding IN ('halala','riyal_up')),
  mileage_rate_minor INTEGER NOT NULL DEFAULT 0,
  requires_attestation INTEGER NOT NULL DEFAULT 0 CHECK(requires_attestation IN (0,1)),
  pending_note TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL
) STRICT;
CREATE TABLE secondment_allowance_template_grades (
  code TEXT NOT NULL REFERENCES secondment_allowance_templates(code),
  grade TEXT NOT NULL CHECK(grade IN ('ceo','deputy','gm','employee')),
  grade_code TEXT NOT NULL REFERENCES job_grades(code),
  domestic_minor INTEGER NOT NULL,
  abroad_minor INTEGER NOT NULL,
  ticket_class TEXT NOT NULL CHECK(ticket_class IN ('first','business','economy')),
  ticket_class_source TEXT NOT NULL,
  ticket_class_conflict TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(code,grade)
) STRICT;
CREATE TRIGGER secondment_allowance_templates_fixed BEFORE UPDATE ON secondment_allowance_templates BEGIN SELECT RAISE(ABORT,'seed templates are fixed'); END;
CREATE TRIGGER secondment_allowance_template_grades_fixed BEFORE UPDATE ON secondment_allowance_template_grades BEGIN SELECT RAISE(ABORT,'seed templates are fixed'); END;

INSERT INTO secondment_allowance_templates(code,title,source,articles,body,status,effective_from,rounding,mileage_rate_minor,requires_attestation,pending_note,suffix) VALUES
('regulation_art65','بدل الانتداب وجدول الدرجات — لائحة تنظيم العمل (م65)',
 'لائحة تنظيم العمل المعتمدة على منصة قوى (أبريل 2025) — جدول م65 مستخرج آليًا يلزم مطابقته مع النسخة الموقعة',
 '["م41","م63","م64","م65"]',
 'القيم السارية قبل التعميم: الرئيس التنفيذي 2100 داخل المملكة و2500 خارجها، نواب الرئيس 1000/1500، مدراء العموم 600/900، العاملون 400/500. درجة التذكرة بحسب م41/1: الدرجة الأولى للرئيس التنفيذي ونوابه، ودرجة رجال الأعمال للمدراء العموم، ودرجة الضيافة لباقي العاملين. هذه النسخة تبقى مرجع كل انتداب بدأ قبل سريان التعميم.',
 'active','2019-01-01','halala',0,0,'','-sec-reg'),
('circular','بدل الانتداب ودرجات التذاكر — التعميم',
 'تعميم بدل الانتداب ودرجات السفر — نص مستخرج آليًا يلزم مطابقته مع النسخة الموقعة',
 '["م41","م50/5","م63","م64","م65","م77/9"]',
 'التعميم يرفع البدل اليومي لدرجتي مدراء الإدارات والعاملين ويبقي الرئيس التنفيذي على قيم م65 لأنه صامت عنها: مدراء الإدارات 900 داخل المملكة و1200 خارجها، والعاملون 700/900، ونواب الرئيس 1000/1500 كما هي. درجات التذاكر بعد التعميم: الرئيس التنفيذي الدرجة الأولى (م41)، نواب الرئيس درجة رجال الأعمال (التعميم، واللائحة تقول الدرجة الأولى)، مدراء الإدارات درجة رجال الأعمال، العاملون الدرجة السياحية. التقريب إلى أقرب ريال بالزيادة (م50/5). ولا يستحق البدل قبل إقرار المدير بأنه لا يوجد في منطقة المهمة موظف يستطيع أداءها.',
 'draft',NULL,'riyal_up',100,1,'التعميم لا يذكر تاريخ سريان: أدخل التاريخ الذي تقرره الإدارة قبل التفعيل. لا يسري شيء من قيمه قبل ذلك.','-sec-circ');
INSERT INTO secondment_allowance_template_grades(code,grade,grade_code,domestic_minor,abroad_minor,ticket_class,ticket_class_source,ticket_class_conflict) VALUES
('regulation_art65','ceo','A',210000,250000,'first','م41/1 — الدرجة الأولى للرئيس التنفيذي ونوابه',''),
('regulation_art65','deputy','B',100000,150000,'first','م41/1 — الدرجة الأولى للرئيس التنفيذي ونوابه',''),
('regulation_art65','gm','C',60000,90000,'business','م41/1 — درجة رجال الأعمال للمدراء العموم',''),
('regulation_art65','employee','D',40000,50000,'economy','م41/1 — درجة الضيافة لباقي العاملين',''),
('circular','ceo','A',210000,250000,'first','م41/1 — الدرجة الأولى؛ التعميم صامت عن هذه الدرجة فتبقى على اللائحة',''),
('circular','deputy','B',100000,150000,'business','التعميم — درجة رجال الأعمال لنواب الرئيس',
 'تعارض: م41/1 في اللائحة تعطي نواب الرئيس الدرجة الأولى، والتعميم يعطيهم درجة رجال الأعمال. الافتراضي هنا التعميم، والقرار يحتاج تأكيد المالك.'),
('circular','gm','C',90000,120000,'business','التعميم — درجة رجال الأعمال لمدراء الإدارات',''),
('circular','employee','D',70000,90000,'economy','التعميم — الدرجة السياحية للعاملين','');

-- بذرة النسخ لكل كيان قائم.
-- نسخة اللائحة سارية بقيمها الحالية نفسها (م65) حتى لا يتغير حساب أي قرار قائم، ونسخة التعميم مسودة بلا تاريخ.
INSERT INTO secondment_allowance_versions(id,tenant_id,code,title,source,articles,body,status,effective_from,rounding,mileage_rate_minor,requires_attestation,pending_note,created_at)
  SELECT t.id||p.suffix,t.id,p.code,p.title,p.source,p.articles,p.body,p.status,p.effective_from,p.rounding,p.mileage_rate_minor,p.requires_attestation,p.pending_note,strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM tenants t CROSS JOIN secondment_allowance_templates p;
INSERT INTO secondment_allowance_grades(version_id,grade,grade_code,domestic_minor,abroad_minor,ticket_class,ticket_class_source,ticket_class_conflict)
  SELECT t.id||p.suffix,g.grade,g.grade_code,g.domestic_minor,g.abroad_minor,g.ticket_class,g.ticket_class_source,g.ticket_class_conflict
  FROM tenants t CROSS JOIN secondment_allowance_templates p JOIN secondment_allowance_template_grades g ON g.code=p.code;

-- ————— 3) المزايا الثلاث: الإعدادات —————
-- الأهلية المشتركة للمزايا الثلاث: دوام كامل نظامي، واجتياز فترة التجربة، وآخر تقييم أداء لا يقل عن النسبة هنا.
CREATE TABLE benefit_extra_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  min_appraisal_bp INTEGER NOT NULL DEFAULT 7000 CHECK(min_appraisal_bp BETWEEN 0 AND 10000),
  parents_share_bp INTEGER NOT NULL DEFAULT 500 CHECK(parents_share_bp BETWEEN 0 AND 10000),
  parents_cap_minor INTEGER NOT NULL DEFAULT 250000 CHECK(parents_cap_minor>=0),
  parents_max_instalments INTEGER NOT NULL DEFAULT 12 CHECK(parents_max_instalments BETWEEN 1 AND 12),
  -- «العام المالي» في مصدر تأمين الوالدين: هل هو السنة الميلادية المستعملة في بقية المنصة؟ قرار معلق.
  parents_year_basis TEXT CHECK(parents_year_basis IS NULL OR parents_year_basis IN ('gregorian','financial')),
  education_cap_basis TEXT CHECK(education_cap_basis IS NULL OR education_cap_basis IN ('per_child','per_employee')),
  education_max_children INTEGER NOT NULL DEFAULT 2 CHECK(education_max_children BETWEEN 1 AND 10),
  sports_default_cap_minor INTEGER NOT NULL DEFAULT 550000 CHECK(sports_default_cap_minor>=0),
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT
) STRICT;
CREATE TRIGGER benefit_extra_settings_no_delete BEFORE DELETE ON benefit_extra_settings BEGIN SELECT RAISE(ABORT,'benefit settings are retained'); END;

-- سقف دراسة الأبناء لكل درجة: يبدأ فارغًا لأن المصدر لا يذكر المبالغ. الطلب ممنوع حتى تملأه الإدارة.
CREATE TABLE education_grade_caps (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  grade_code TEXT NOT NULL REFERENCES job_grades(code),
  annual_cap_minor INTEGER NOT NULL CHECK(annual_cap_minor>=0),
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,grade_code)
) STRICT;
CREATE TRIGGER education_grade_caps_no_delete BEFORE DELETE ON education_grade_caps BEGIN SELECT RAISE(ABORT,'education caps are retained; record a new amount'); END;

-- سقف الأندية الصحية والأجهزة الرياضية لكل درجة: 5500 ريال افتراضًا لكل درجة، لأن المصدر يذكر المبلغ ويذكر «حسب الفئة الوظيفية» معًا.
CREATE TABLE sports_grade_caps (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  grade_code TEXT NOT NULL REFERENCES job_grades(code),
  annual_cap_minor INTEGER NOT NULL CHECK(annual_cap_minor>=0),
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT REFERENCES users(id),
  recorded_at TEXT,
  PRIMARY KEY(tenant_id,grade_code)
) STRICT;
CREATE TRIGGER sports_grade_caps_no_delete BEFORE DELETE ON sports_grade_caps BEGIN SELECT RAISE(ABORT,'sports caps are retained; record a new amount'); END;

INSERT INTO benefit_extra_settings(tenant_id) SELECT id FROM tenants;
INSERT INTO sports_grade_caps(tenant_id,grade_code,annual_cap_minor,note)
  SELECT t.id,g.code,550000,'القيمة الافتراضية من المصدر (5500 ريال للموظف في السنة الميلادية) لكل الدرجات؛ المصدر يقول أيضًا «حسب الفئة الوظيفية» فالتفريق بالدرجة متاح هنا.'
  FROM tenants t CROSS JOIN job_grades g;
CREATE TRIGGER benefit_extra_seed AFTER INSERT ON tenants
BEGIN
  INSERT INTO benefit_extra_settings(tenant_id) VALUES(NEW.id);
  INSERT INTO sports_grade_caps(tenant_id,grade_code,annual_cap_minor,note)
    SELECT NEW.id,g.code,550000,'القيمة الافتراضية من المصدر (5500 ريال للموظف في السنة الميلادية) لكل الدرجات.' FROM job_grades g;
  INSERT INTO secondment_allowance_versions(id,tenant_id,code,title,source,articles,body,status,effective_from,rounding,mileage_rate_minor,requires_attestation,pending_note,created_at)
    SELECT NEW.id||p.suffix,NEW.id,p.code,p.title,p.source,p.articles,p.body,p.status,p.effective_from,p.rounding,p.mileage_rate_minor,p.requires_attestation,p.pending_note,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM secondment_allowance_templates p;
  INSERT INTO secondment_allowance_grades(version_id,grade,grade_code,domestic_minor,abroad_minor,ticket_class,ticket_class_source,ticket_class_conflict)
    SELECT NEW.id||p.suffix,g.grade,g.grade_code,g.domestic_minor,g.abroad_minor,g.ticket_class,g.ticket_class_source,g.ticket_class_conflict
    FROM secondment_allowance_templates p JOIN secondment_allowance_template_grades g ON g.code=p.code;
END;

-- ————— 3/ب) المزايا الثلاث في كتالوج المزايا (الترحيل 103): مسودات تستشهد بمصدرها —————
-- الميزات الثلاث مزروعة أصلًا مسودات في benefit_catalog. هنا يُحدَّث نص المسودة لتستشهد بمصدرها الجديد وتحمل الأهلية
-- المشتركة، وتبقى مسودة لا تُطلب ولا تُعد استحقاقًا حتى يعتمدها مدير الموارد البشرية شخصًا غير من اقترحها.
-- المصدر عرض المزايا الداخلي؛ لم تُستعمل روابطه لأنها تشير إلى موقع جهة أخرى.
CREATE TABLE benefit_extra_source (
  benefit_key TEXT PRIMARY KEY REFERENCES benefit_templates(benefit_key),
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_note TEXT NOT NULL,
  rules TEXT NOT NULL CHECK(json_valid(rules)),
  value_params TEXT NOT NULL CHECK(json_valid(value_params)),
  frequency TEXT NOT NULL,
  claim_method TEXT NOT NULL,
  documents TEXT NOT NULL CHECK(json_valid(documents)),
  change_note TEXT NOT NULL
) STRICT;
CREATE TRIGGER benefit_extra_source_fixed BEFORE UPDATE ON benefit_extra_source BEGIN SELECT RAISE(ABORT,'seed texts are replaced by a new migration'); END;
INSERT INTO benefit_extra_source VALUES
('parents_insurance','التأمين الطبي للوالدين',
 'إضافة والد الموظف أو والدته أو كليهما إلى وثيقة التأمين الطبي، ويتحمل الموظف 5% من قيمة الوثيقة بحد أقصى 2500 ريال لكل والد في العام المالي.',
 'مصدره عرض المزايا الداخلي لا اللائحة: الوالدان خارج تعريف «أسرة العامل» (الزوج والأبناء والبنات غير المتزوجين)، وم70 تحيل ما سواه إلى مصفوفة المزايا (مرفق 1) غير الموجودة في الملف. الأهلية المشتركة: دوام كامل نظامي، واجتياز فترة التجربة، وآخر تقييم لا يقل عن النسبة المقررة في إعدادات المزايا. نصيب الموظف = أقل من (قيمة الوثيقة × 5%) و(2500 ريال لكل والد في العام المالي)، يُسدَّد دفعة واحدة أو أقساطًا حتى 12 شهرًا، ولا يُخصم إلا بإقرار كتابي من الموظف داخل النموذج (م51). لم تُستعمل روابط العرض لأنها تشير إلى موقع جهة أخرى. و«العام المالي»: هل هو السنة الميلادية المستعملة في بقية المنصة؟ قرار معلق.',
 '{"min_tenure_months":6,"past_probation":true,"employment_types":["full_time"]}',
 '{"text":"نصيب الموظف: 5% من قيمة الوثيقة بحد أقصى 2500 ريال لكل والد في العام المالي، خصمًا بموافقته الكتابية."}',
 'policy_term','request',
 '["ما يثبت صلة القرابة","صورة هوية الوالد أو الوالدة (لا يُخزَّن رقمها كاملًا)","عرض شركة التأمين بقيمة الوثيقة"]',
 'مصدره عرض المزايا الداخلي: النسبة والسقف وطريقة السداد وشرط الإقرار الكتابي.'),
('children_education','بدل دراسة الأبناء',
 'مساهمة في رسوم دراسة أبناء الموظف لطفلين كحد أقصى، بسقف سنوي لكل درجة وظيفية تقرره الإدارة، وتُصرف في نهاية الشهر الميلادي مع المسير.',
 'مصدره عرض المزايا الداخلي لا اللائحة؛ م70 تحيل ما سواه إلى مصفوفة المزايا (مرفق 1) غير الموجودة. الأهلية المشتركة: دوام كامل نظامي، واجتياز فترة التجربة، وآخر تقييم لا يقل عن النسبة المقررة. طفلان كحد أقصى، وتلزم فاتورة ضريبية غير مكررة (رقم الفاتورة مع الرقم الضريبي للمورد) وإثبات قيد، والصرف في نهاية الشهر الميلادي مع مسير الرواتب. المبلغ السنوي لكل درجة غير مذكور في المصدر: جدول فارغ تملؤه الإدارة، ولا يُقدَّم الطلب قبل ملئه. لم تُستعمل روابط العرض لأنها تشير إلى موقع جهة أخرى.',
 '{"min_tenure_months":6,"past_probation":true,"employment_types":["full_time"]}',
 '{"text":"سقف سنوي لكل درجة وظيفية تملؤه الإدارة (لكل طفل أو لكل موظف)، لطفلين كحد أقصى."}',
 'per_academic_year','request',
 '["فاتورة ضريبية باسم الطالب برقمها والرقم الضريبي للمورد","ما يثبت قيد الابن أو الابنة في المدرسة"]',
 'مصدره عرض المزايا الداخلي: حد الطفلين، والفاتورة الضريبية غير المكررة، وإثبات القيد، والصرف نهاية الشهر الميلادي. المبالغ ينتظر تقريرها.'),
('gym','الأندية الصحية والأجهزة الرياضية',
 '5500 ريال للموظف في السنة الميلادية لاشتراك نادٍ رياضي أو أجهزة رياضية، بطلب واحد في السنة.',
 'مصدره عرض المزايا الداخلي لا اللائحة؛ م70 تحيل ما سواه إلى مصفوفة المزايا (مرفق 1) غير الموجودة. الأهلية المشتركة: دوام كامل نظامي، واجتياز فترة التجربة، وآخر تقييم لا يقل عن النسبة المقررة. المبلغ 5500 ريال للموظف في السنة الميلادية، والمصدر يقول أيضًا «حسب الفئة الوظيفية» فالسقف جدول لكل درجة قيمته الافتراضية 5500. المصروف المسموح اشتراك نادٍ أو أجهزة رياضية فقط، وتلزم فاتورة، ويُصرف أقل من مبلغ الفاتورة والسقف. طلب واحد في السنة: يُغلق الرصيد بعده، ويُنبَّه الموظف قبل التقديم. لم تُستعمل روابط العرض لأنها تشير إلى موقع جهة أخرى.',
 '{"min_tenure_months":6,"past_probation":true,"employment_types":["full_time"]}',
 '{"text":"5500 ريال للموظف في السنة الميلادية لكل درجة افتراضًا، وطلب واحد في السنة."}',
 'annual','request',
 '["فاتورة اشتراك النادي أو شراء الأجهزة الرياضية"]',
 'مصدره عرض المزايا الداخلي: المبلغ السنوي، وحصر المصروف في الاشتراك والأجهزة، وطلب واحد في السنة.');

-- التحديث يجري للكيانات القائمة، وبقادح على جدول الكتالوج نفسه لمسودة كل كيان يُنشأ بعد الترحيل:
-- بذرة الترحيل 103 تُنشئ المسودة عند إدراج الكيان، فيلتقطها القادح مهما كان ترتيب قوادح جدول الكيانات.
UPDATE benefit_catalog SET
  name=(SELECT s.name FROM benefit_extra_source s WHERE s.benefit_key=benefit_catalog.benefit_key),
  summary=(SELECT s.summary FROM benefit_extra_source s WHERE s.benefit_key=benefit_catalog.benefit_key),
  source_note=(SELECT s.source_note FROM benefit_extra_source s WHERE s.benefit_key=benefit_catalog.benefit_key),
  rules=(SELECT s.rules FROM benefit_extra_source s WHERE s.benefit_key=benefit_catalog.benefit_key),
  value_params=(SELECT s.value_params FROM benefit_extra_source s WHERE s.benefit_key=benefit_catalog.benefit_key),
  frequency=(SELECT s.frequency FROM benefit_extra_source s WHERE s.benefit_key=benefit_catalog.benefit_key),
  claim_method=(SELECT s.claim_method FROM benefit_extra_source s WHERE s.benefit_key=benefit_catalog.benefit_key),
  request_option='module:benefit-extras',
  documents=(SELECT s.documents FROM benefit_extra_source s WHERE s.benefit_key=benefit_catalog.benefit_key),
  change_note=(SELECT s.change_note FROM benefit_extra_source s WHERE s.benefit_key=benefit_catalog.benefit_key),
  version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE status='draft' AND benefit_key IN (SELECT benefit_key FROM benefit_extra_source);
CREATE TRIGGER benefit_catalog_extra_source AFTER INSERT ON benefit_catalog
WHEN NEW.status='draft' AND NEW.revision=1 AND NEW.benefit_key IN ('parents_insurance','children_education','gym')
BEGIN
  UPDATE benefit_catalog SET
    name=(SELECT s.name FROM benefit_extra_source s WHERE s.benefit_key=NEW.benefit_key),
    summary=(SELECT s.summary FROM benefit_extra_source s WHERE s.benefit_key=NEW.benefit_key),
    source_note=(SELECT s.source_note FROM benefit_extra_source s WHERE s.benefit_key=NEW.benefit_key),
    rules=(SELECT s.rules FROM benefit_extra_source s WHERE s.benefit_key=NEW.benefit_key),
    value_params=(SELECT s.value_params FROM benefit_extra_source s WHERE s.benefit_key=NEW.benefit_key),
    frequency=(SELECT s.frequency FROM benefit_extra_source s WHERE s.benefit_key=NEW.benefit_key),
    claim_method=(SELECT s.claim_method FROM benefit_extra_source s WHERE s.benefit_key=NEW.benefit_key),
    request_option='module:benefit-extras',
    documents=(SELECT s.documents FROM benefit_extra_source s WHERE s.benefit_key=NEW.benefit_key),
    change_note=(SELECT s.change_note FROM benefit_extra_source s WHERE s.benefit_key=NEW.benefit_key),
    version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id=NEW.id;
END;

-- ————— 4) طلبات المزايا الثلاث —————
-- جدول مستقل عن benefit_requests (الترحيل 103) لأن خياراته مقفلة بقيد CHECK، ولأن لهذه المزايا خطوات ليست فيه:
-- إقرار الموظف بالخصم، وقيمة عرض شركة التأمين، وجدول الأقساط، والفاتورة الضريبية غير المكررة.
CREATE TABLE benefit_extra_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reference TEXT NOT NULL CHECK(reference GLOB 'BEX-[0-9][0-9][0-9][0-9]-[0-9]*'),
  employee_id TEXT NOT NULL,
  grade_code TEXT NOT NULL REFERENCES job_grades(code),
  kind TEXT NOT NULL CHECK(kind IN ('parents_insurance','children_education','sports')),
  benefit_year TEXT NOT NULL CHECK(benefit_year GLOB '[0-9][0-9][0-9][0-9]'),
  catalog_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending_hr','pending_employee','pending_authority','pending_finance','completed','rejected','withdrawn')),
  details TEXT NOT NULL CHECK(json_valid(details) AND json_type(details)='object'),
  -- تأمين الوالدين: قيمة عرض شركة التأمين، ونصيب الموظف = أقل من (القيمة × النسبة) والسقف لكل والد في السنة.
  policy_value_minor INTEGER CHECK(policy_value_minor IS NULL OR policy_value_minor>=0),
  cap_minor INTEGER CHECK(cap_minor IS NULL OR cap_minor>=0),
  amount_minor INTEGER CHECK(amount_minor IS NULL OR amount_minor>=0),
  payment_mode TEXT CHECK(payment_mode IS NULL OR payment_mode IN ('one_off','instalments')),
  instalment_months INTEGER CHECK(instalment_months IS NULL OR instalment_months BETWEEN 1 AND 12),
  -- م51: لا حسم من الأجر بغير موافقة العامل. الإقرار مكتوب ومسجل داخل النموذج، وبدونه لا يمضي الطلب.
  consent_text TEXT NOT NULL DEFAULT '',
  consent_at TEXT,
  consent_by TEXT,
  calculation TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(calculation)),
  hr_by TEXT, hr_at TEXT, hr_note TEXT NOT NULL DEFAULT '',
  authority_by TEXT, authority_at TEXT, authority_note TEXT NOT NULL DEFAULT '',
  finance_by TEXT, finance_at TEXT, finance_note TEXT NOT NULL DEFAULT '',
  reimbursement_month TEXT CHECK(reimbursement_month IS NULL OR reimbursement_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  outcome TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(outcome)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,reference),
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(hr_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(authority_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(finance_by,tenant_id) REFERENCES users(id,tenant_id),
  -- صاحب الطلب لا يقرر فيه، ولا يقرر في خطوتين متتاليتين شخص واحد.
  CHECK(hr_by IS NULL OR hr_by<>employee_id),
  CHECK(authority_by IS NULL OR (authority_by<>employee_id AND authority_by<>hr_by)),
  CHECK(finance_by IS NULL OR finance_by<>employee_id),
  CHECK((consent_at IS NULL)=(consent_by IS NULL)),
  CHECK(consent_at IS NULL OR length(trim(consent_text))>=20),
  -- تأمين الوالدين لا يصل صاحب الصلاحية قبل إقرار الموظف بالخصم وبمبلغه.
  CHECK(kind<>'parents_insurance' OR status NOT IN ('pending_authority','pending_finance','completed') OR (consent_at IS NOT NULL AND amount_minor IS NOT NULL AND payment_mode IS NOT NULL)),
  CHECK(status NOT IN ('pending_finance','completed') OR hr_by IS NOT NULL)
) STRICT;
CREATE INDEX benefit_extra_requests_scope ON benefit_extra_requests(tenant_id,employee_id,kind,benefit_year);
CREATE INDEX benefit_extra_requests_queue ON benefit_extra_requests(tenant_id,status);
-- طلب واحد للأندية الصحية في السنة الميلادية: ما إن يُقدَّم طلب حي حتى يُغلق الرصيد لتلك السنة.
CREATE UNIQUE INDEX benefit_extra_sports_once ON benefit_extra_requests(tenant_id,employee_id,benefit_year)
  WHERE kind='sports' AND status NOT IN ('rejected','withdrawn');
CREATE TRIGGER benefit_extra_requests_fixed BEFORE UPDATE ON benefit_extra_requests
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.reference<>OLD.reference OR NEW.employee_id<>OLD.employee_id OR NEW.kind<>OLD.kind
  OR NEW.benefit_year<>OLD.benefit_year OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
  OR OLD.status IN ('completed','rejected','withdrawn')
  OR (OLD.consent_at IS NOT NULL AND (NEW.consent_at IS NOT OLD.consent_at OR NEW.consent_by IS NOT OLD.consent_by OR NEW.consent_text<>OLD.consent_text))
BEGIN SELECT RAISE(ABORT,'a decided benefit request is final and a recorded consent is never rewritten'); END;
CREATE TRIGGER benefit_extra_requests_no_delete BEFORE DELETE ON benefit_extra_requests BEGIN SELECT RAISE(ABORT,'benefit requests are retained'); END;

-- الوالدان في الطلب: الاسم وتاريخ الميلاد ومرجع الهوية مقنّعًا. لا بيانات طبية ولا رقم هوية كامل.
CREATE TABLE benefit_extra_parents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL REFERENCES benefit_extra_requests(id),
  seq INTEGER NOT NULL CHECK(seq IN (1,2)),
  relation TEXT NOT NULL CHECK(relation IN ('father','mother')),
  parent_name TEXT NOT NULL CHECK(length(trim(parent_name))>=3),
  id_reference TEXT NOT NULL CHECK(length(trim(id_reference))>=2),
  birth_date TEXT NOT NULL CHECK(birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  document_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(request_id,seq),
  UNIQUE(request_id,relation)
) STRICT;
CREATE TRIGGER benefit_extra_parents_no_delete BEFORE DELETE ON benefit_extra_parents BEGIN SELECT RAISE(ABORT,'request lines are retained'); END;

-- الأبناء في طلب الدراسة: طفلان كحد أقصى (قيد seq)، وكل سطر بفاتورته وإثبات قيده.
CREATE TABLE benefit_extra_children (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL REFERENCES benefit_extra_requests(id),
  seq INTEGER NOT NULL CHECK(seq IN (1,2)),
  child_name TEXT NOT NULL CHECK(length(trim(child_name))>=3),
  birth_date TEXT NOT NULL CHECK(birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  stage TEXT NOT NULL CHECK(length(trim(stage))>=3),
  school TEXT NOT NULL CHECK(length(trim(school))>=2),
  enrolment_proof TEXT NOT NULL CHECK(length(trim(enrolment_proof))>=2),
  invoice_id TEXT,
  claimed_minor INTEGER NOT NULL CHECK(claimed_minor>=0),
  approved_minor INTEGER CHECK(approved_minor IS NULL OR approved_minor>=0),
  created_at TEXT NOT NULL,
  UNIQUE(request_id,seq)
) STRICT;
CREATE TRIGGER benefit_extra_children_no_delete BEFORE DELETE ON benefit_extra_children BEGIN SELECT RAISE(ABORT,'request lines are retained'); END;

-- الفاتورة الضريبية: لا تتكرر في الكيان برقمها مع الرقم الضريبي للمورد.
CREATE TABLE benefit_extra_invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL REFERENCES benefit_extra_requests(id),
  kind TEXT NOT NULL CHECK(kind IN ('children_education','sports')),
  invoice_number TEXT NOT NULL CHECK(length(trim(invoice_number)) BETWEEN 2 AND 60),
  supplier_tax_number TEXT NOT NULL CHECK(length(trim(supplier_tax_number)) BETWEEN 5 AND 40),
  supplier_name TEXT NOT NULL CHECK(length(trim(supplier_name))>=2),
  invoice_date TEXT NOT NULL CHECK(invoice_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  document_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,invoice_number,supplier_tax_number)
) STRICT;
CREATE INDEX benefit_extra_invoices_request ON benefit_extra_invoices(request_id);
CREATE TRIGGER benefit_extra_invoices_fixed BEFORE UPDATE ON benefit_extra_invoices BEGIN SELECT RAISE(ABORT,'an invoice is recorded once'); END;
CREATE TRIGGER benefit_extra_invoices_no_delete BEFORE DELETE ON benefit_extra_invoices BEGIN SELECT RAISE(ABORT,'invoices are retained'); END;

-- جدول أقساط نصيب الموظف في تأمين الوالدين: خصوم «مقترحة» في المسير، لا خصم هنا.
CREATE TABLE benefit_extra_instalments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL REFERENCES benefit_extra_requests(id),
  seq INTEGER NOT NULL CHECK(seq BETWEEN 1 AND 12),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  status TEXT NOT NULL CHECK(status IN ('proposed','handed_to_payroll','cancelled')),
  payroll_adjustment_id TEXT REFERENCES payroll_adjustments(id),
  created_at TEXT NOT NULL,
  UNIQUE(request_id,seq),
  CHECK((status='handed_to_payroll')=(payroll_adjustment_id IS NOT NULL))
) STRICT;
CREATE TRIGGER benefit_extra_instalments_start_proposed BEFORE INSERT ON benefit_extra_instalments
WHEN NEW.status<>'proposed' BEGIN SELECT RAISE(ABORT,'an instalment starts proposed; nothing is deducted from the benefits module'); END;
CREATE TRIGGER benefit_extra_instalments_no_delete BEFORE DELETE ON benefit_extra_instalments BEGIN SELECT RAISE(ABORT,'instalments are retained'); END;
