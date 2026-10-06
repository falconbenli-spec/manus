-- «مزاياي»: كتالوج مزايا الموظف، وطلب مزايا واحد بخيارات، ومقترحات صرف لا تُصرف، ومستندات المزايا.
-- القاعدة: كل ميزة مسودة حتى يعتمدها مدير الموارد البشرية (hr.policy.accept) شخصًا غير من اقترحها.
-- ما تنص عليه لائحة تنظيم العمل يحمل رقم مادته؛ وما أحالته المادة 70 إلى «مصفوفة المزايا» (مرفق 1) غير الموجود
-- في الملف يبقى معلّمًا «يحتاج اعتماد مصفوفة المزايا»، ولا يُطلب إلا بعد اعتماده.
-- المال لا يتحرك من هنا: الطلب ينتهي بمقترح صرف أو خصم (proposed) يستلمه مُعد الرواتب ليقترحه في حركات المسير،
-- وليس في أي جدول هنا حالة «صُرف».

-- 1) قوالب البذرة: نص الميزة كما صيغ من اللائحة. عامة لا تخص كيانًا، وتُنسخ مسودةً لكل كيان.
CREATE TABLE benefit_templates (
  benefit_key TEXT PRIMARY KEY CHECK(benefit_key GLOB '[a-z]*' AND benefit_key NOT GLOB '*[^a-z_]*' AND length(benefit_key) BETWEEN 3 AND 40),
  sort_order INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('allowance','insurance','travel','finance','development','family','recognition','wellbeing')),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  summary TEXT NOT NULL CHECK(length(trim(summary))>=10),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('regulation','needs_matrix')),
  article TEXT NOT NULL DEFAULT '',
  source_note TEXT NOT NULL CHECK(length(trim(source_note))>=10),
  rules TEXT NOT NULL CHECK(json_valid(rules) AND json_type(rules)='object'),
  value_basis TEXT NOT NULL CHECK(value_basis IN ('fixed','percent_of_basic','months_of_basic','policy','contract','informational')),
  value_params TEXT NOT NULL CHECK(json_valid(value_params) AND json_type(value_params)='object'),
  frequency TEXT NOT NULL CHECK(frequency IN ('monthly','annual','once','per_event','per_academic_year','daily','policy_term')),
  claim_method TEXT NOT NULL CHECK(claim_method IN ('automatic','request','enrolment','informational')),
  request_option TEXT NOT NULL DEFAULT '',
  documents TEXT NOT NULL CHECK(json_valid(documents) AND json_type(documents)='array'),
  CHECK(source_kind<>'regulation' OR length(trim(article))>=2)
) STRICT;
CREATE TRIGGER benefit_templates_fixed BEFORE UPDATE ON benefit_templates BEGIN SELECT RAISE(ABORT,'seed templates are fixed; change a benefit through the catalog'); END;
CREATE TRIGGER benefit_templates_no_delete BEFORE DELETE ON benefit_templates BEGIN SELECT RAISE(ABORT,'seed templates are retained'); END;

INSERT INTO benefit_templates VALUES
('housing',10,'allowance','بدل السكن','بدل سكن نقدي شهري بنسبة من الأجر الأساسي، ما لم توفر المنشأة سكنًا مناسبًا.','regulation','م66، م67 (وم72)',
 'م67/2: تدفع المنشأة بدل السكن بمعدل 25% من الأجر الأساسي شهريًا، ويُدفع مجزأً على أشهر السنة. م67/1: يجوز لصاحب الصلاحية صرفه مقدمًا استثناءً بشرط تجاوز فترة التجربة. م72 تنص على أنها تحل محل مادة بدل السكن والمواصلات وتجيز توفير السكن عينًا أو بدلًا نقديًا «مناسبًا» دون نسبة؛ التعارض بين م67 وم72 يحتاج تأكيد المالك.',
 '{}','percent_of_basic','{"percent":25,"component":"housing","advance_after_probation":true}','monthly','automatic','','[]'),
('transport',20,'allowance','بدل النقل','بدل نقل نقدي شهري بحسب العقد، ما لم توفر المنشأة وسيلة النقل.','regulation','م66، م68 (وم72)',
 'م68: يُدفع بدل النقل أثناء الإجازة السنوية وأي إجازة مدفوعة وأثناء عطل المنشأة الرسمية، ولا يُدفع إذا وفرت المنشأة وسيلة النقل أو خصصت سيارة للعامل، ولا إذا أقام العامل في وحدات سكنية بموقع العمل. اللائحة لا تحدد مبلغه؛ المبلغ ما في العقد.',
 '{}','contract','{"component":"transport"}','monthly','automatic','','[]'),
('medical_insurance',30,'insurance','التأمين الطبي للموظف وأسرته','تأمين صحي تعاوني للموظف وأسرته (الزوج والأبناء والبنات غير المتزوجين) بحسب وثيقة التأمين.','regulation','م95، م98',
 'م95: تؤمن المنشأة صحيًا على جميع العاملين وفق نظام الضمان الصحي التعاوني ولائحته. م98/1: تتكفل بتأمين صحي للعامل وأسرته وفق وثيقة التأمين. تعريف أسرة العامل في اللائحة: الزوج والأبناء والبنات غير المتزوجين. م98/3: تستمر تغطية أسرة المتوفى حتى انتهاء الوثيقة. فئة التغطية لكل درجة وترقية الفئة على حساب الموظف لا تحددهما اللائحة.',
 '{}','policy','{"text":"فئة التغطية كما في وثيقة التأمين المسجلة؛ فئة كل درجة وظيفية تحتاج اعتماد المالك.","upgrade_at_employee_cost":false}','policy_term','enrolment','dependant_add',
 '["عقد الزواج لإضافة الزوج أو الزوجة","شهادة الميلاد لإضافة ابن أو ابنة","هوية التابع أو إقامته للاطلاع (لا يُخزَّن رقمها)"]'),
('air_ticket',40,'travel','تذكرة السفر السنوية','تذكرة سفر عند التمتع بالإجازة السنوية بحسب العقد، بالدرجة المستحقة أو قيمتها نقدًا.','regulation','م39، م41',
 'م39/2: يتحدد الالتزام بمصروفات إركاب العامل أو أسرته عند تمتعه بإجازته السنوية وفق ما يتفق عليه في عقد العمل. م41/1: الدرجة الأولى للرئيس التنفيذي ونوابه، ودرجة رجال الأعمال للمدراء العموم، ودرجة الضيافة لباقي العاملين؛ ويجوز صرف قيمة التذكرة نقدًا بحسب درجة السفر المستحقة (م41/1/ث). مدة الخدمة قبل أول تذكرة وشمول الأسرة غير محددين في اللائحة: سنة خدمة هنا مقترح يحتاج اعتماد.',
 '{"min_tenure_months":12,"contract_clause":true}','policy','{"classes":{"executive":"الدرجة الأولى","general_manager":"درجة رجال الأعمال","staff":"درجة الضيافة"},"cash_equivalent":true}','annual','request','ticket_claim',
 '["موافقة الإجازة السنوية أو تاريخ السفر","عرض سعر للدرجة المستحقة عند طلب القيمة نقدًا"]'),
('relocation',50,'allowance','بدل الانتقال إلى مدينة أخرى','أجر أساسي لشهر واحد لمن يُنقل إلى مدينة أخرى لمدة لا تقل عن سنة، مقابل نفقات انتقاله وعائلته.','regulation','م69 (وم40)',
 'م69: يُصرف للعامل المنقول من مدينة إلى أخرى بقصد العمل لمدة لا تقل عن سنة ما يعادل أجرًا أساسيًا لشهر واحد مقابل نفقات انتقاله وعائلته، ما لم يكن النقل بناءً على طلبه. م40: يستحق المنقول نفقات نقله ومن يعولهم ممن يقيمون معه، بما فيها الإركاب ونقل الأمتعة، ما لم يكن النقل برغبته.',
 '{"event":"relocation"}','months_of_basic','{"months":1}','per_event','automatic','','["قرار النقل وتاريخه"]'),
('emergency_advance',60,'finance','السلفة الاضطرارية','سلفة للظروف الطارئة بتقدير الرئيس التنفيذي، تُسترد أقساطًا شهرية من الراتب.','regulation','م71',
 'م71: للرئيس التنفيذي الصلاحية بما يراه مناسبًا بمنح سلفة اضطرارية للعامل على أن تُسترد في شكل أقساط شهرية من راتبه. تُطلب من خدمة «سلفة على الراتب» ويقترحها مُعد الرواتب في مسار السلف القائم.',
 '{}','policy','{"text":"المبلغ وعدد الأقساط بتقدير الرئيس التنفيذي؛ تُسترد من الراتب شهريًا."}','per_event','request','service:HR-SALARY-ADVANCE','["ما يثبت الظرف الطارئ إن وُجد"]'),
('training_support',70,'development','دعم التدريب والتأهيل','تكاليف تأهيل العاملين السعوديين وتدريبهم، ومنها التذاكر والسكن والمعيشة عند التدريب خارج مقر المنشأة.','regulation','م42–م45',
 'م42: تتحمل المنشأة كافة تكاليف تأهيل العاملين السعوديين أو تدريبهم، وتذاكر السفر بالدرجة التي تحددها والمعيشة أو بدلًا عنها، مع استمرار الأجر. م44: يجوز اشتراط العمل مدة مماثلة لمدة البرنامج، وإلزام المتدرب بالتكاليف أو بعضها إن ترك البرنامج أو العمل. م45: توفر المنشأة التدريب والتطوير المهني لجميع العاملين.',
 '{"nationality":"saudi"}','policy','{"text":"تكاليف البرنامج المعتمد كاملة للعاملين السعوديين؛ لغيرهم بحسب خطة التطوير (م45)."}','per_event','request','service:TAL-TRAINING','["عرض البرنامج وتكلفته","موافقة المدير على الارتباط بخطة التطوير"]'),
('nursing_hour',80,'family','ساعة الرضاعة','فترة أو فترات رضاعة لا تزيد على ساعة يوميًا للعاملة بعد عودتها من إجازة الوضع، لمدة 24 شهرًا من تاريخ الوضع، دون تخفيض الأجر.','regulation','م102',
 'م102: للعاملة بعد عودتها من إجازة الوضع أن تأخذ فترة أو فترات لإرضاع مولودها لا تزيد في مجموعها على الساعة في اليوم الواحد، علاوة على فترات الراحة، لمدة أربعة وعشرين شهرًا من تاريخ الوضع، وتُحسب من ساعات العمل الفعلية ولا يترتب عليها تخفيض الأجر. عليها إشعار صاحب العمل كتابةً بوقت الفترة.',
 '{"gender":"female","event":"childbirth"}','policy','{"text":"حتى ساعة يوميًا من ساعات العمل الفعلية، 24 شهرًا من تاريخ الوضع."}','daily','informational','','["إشعار كتابي بوقت فترة الرضاعة"]'),
('rewards',90,'recognition','المكافآت المعنوية والمادية','خطاب شكر، أو إجازة إضافية بأجر حتى خمسة أيام في السنة، أو مكافأة تشجيعية مقطوعة بتقدير الرئيس التنفيذي.','regulation','م57–م59',
 'م58: مكافأة معنوية بخطاب شكر وتقدير أو إجازة إضافية بأجر لا تتجاوز خمسة أيام عمل في السنة. م59/1: الأجر الفعلي أساس حساب المكافأة. م59/3: يجوز للرئيس التنفيذي صرف مكافأة تشجيعية مقطوعة لا تتجاوز أربعة رواتب فعلية شهرية «حسب ما ورد في جدول مزايا وبدلات العاملين» غير المرفق. للاطلاع فقط: لا تُطلب.',
 '{}','informational','{"text":"بتقدير الرئيس التنفيذي؛ لا تُطلب من هذه الشاشة."}','per_event','informational','','[]'),
('social_insurance',95,'insurance','التأمينات الاجتماعية','اشتراك المنشأة عن جميع العاملين في فرع الأخطار المهنية، وتطبيق أحكامه على إصابات العمل.','regulation','م95، م99',
 'م95: تشترك المنشأة عن جميع العاملين في فرع الأخطار المهنية لدى المؤسسة العامة للتأمينات الاجتماعية. م99/2: تطبق أحكام فرع الأخطار المهنية على إصابات العمل وأمراض المهنة. التسجيل يجري لدى التأمينات خارج المنصة.',
 '{}','informational','{"text":"اشتراك تدفعه المنشأة؛ التسجيل وحالته لدى التأمينات الاجتماعية خارج المنصة."}','policy_term','automatic','','[]'),
('parents_insurance',110,'insurance','التأمين الطبي للوالدين','إضافة والد الموظف أو والدته إلى وثيقة التأمين. كانت في التطبيق القديم؛ الوالدان خارج تعريف «أسرة العامل» في اللائحة.','needs_matrix','',
 'لا مادة تنص عليه: تعريف أسرة العامل الزوج والأبناء والبنات غير المتزوجين، وم70 تحيل المزايا الأخرى إلى مصفوفة المزايا (مرفق 1) غير الموجودة في الملف. في التطبيق القديم: الأهلية بعد 6 أشهر خدمة. يحتاج قرار المالك: هل تُقدَّم، ومن يتحمل القسط، وأي فئة.',
 '{"min_tenure_months":6}','policy','{"text":"يحدد المالك من يتحمل القسط والفئة."}','policy_term','request','dependant_add','["ما يثبت صلة القرابة","ما يثبت الإعالة إن اشترطته السياسة"]'),
('children_education',120,'family','بدل تعليم الأبناء','مساهمة في رسوم دراسة أبناء الموظف. كانت في التطبيق القديم؛ لا تنص عليها اللائحة.','needs_matrix','',
 'لا مادة تنص عليه؛ م70 تحيل المزايا الأخرى إلى مصفوفة المزايا (مرفق 1) غير الموجودة. في التطبيق القديم: الأهلية بعد 6 أشهر خدمة. يحتاج قرار المالك: السقف لكل طفل وعدد الأطفال والمراحل الدراسية وطريقة الصرف.',
 '{"min_tenure_months":6}','policy','{"text":"السقف لكل طفل وعدد الأطفال يحددهما المالك."}','per_academic_year','request','education_claim','["فاتورة المدرسة الرسمية باسم الطالب","ما يثبت سداد الرسوم"]'),
('gym',130,'wellbeing','اشتراك النادي الرياضي','اشتراك أو مساهمة في نادٍ رياضي. كانت في التطبيق القديم؛ لا تنص عليها اللائحة.','needs_matrix','',
 'لا مادة تنص عليه؛ م70 تحيل المزايا الأخرى إلى مصفوفة المزايا (مرفق 1) غير الموجودة. في التطبيق القديم: الأهلية بعد 6 أشهر خدمة. يحتاج قرار المالك: هل يُقدَّم، وبأي سقف، وعبر أي نادٍ.',
 '{"min_tenure_months":6}','policy','{"text":"السقف والنادي يحددهما المالك."}','annual','informational','','[]');

-- 2) كتالوج المزايا لكل كيان: مراجعات مؤرخة لكل ميزة. معتمدة واحدة ومسودة واحدة على الأكثر لكل ميزة.
--    proposed_by فارغ يعني مسودة المنصة الأولى المصوغة من نص اللائحة؛ من يعدّل المسودة يصير مقترحها ولا يعتمدها.
CREATE TABLE benefit_catalog (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  benefit_key TEXT NOT NULL REFERENCES benefit_templates(benefit_key),
  revision INTEGER NOT NULL CHECK(revision>0),
  sort_order INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('allowance','insurance','travel','finance','development','family','recognition','wellbeing')),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  summary TEXT NOT NULL CHECK(length(trim(summary))>=10),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('regulation','needs_matrix')),
  article TEXT NOT NULL DEFAULT '',
  source_note TEXT NOT NULL CHECK(length(trim(source_note))>=10),
  rules TEXT NOT NULL CHECK(json_valid(rules) AND json_type(rules)='object'),
  value_basis TEXT NOT NULL CHECK(value_basis IN ('fixed','percent_of_basic','months_of_basic','policy','contract','informational')),
  value_params TEXT NOT NULL CHECK(json_valid(value_params) AND json_type(value_params)='object'),
  frequency TEXT NOT NULL CHECK(frequency IN ('monthly','annual','once','per_event','per_academic_year','daily','policy_term')),
  claim_method TEXT NOT NULL CHECK(claim_method IN ('automatic','request','enrolment','informational')),
  request_option TEXT NOT NULL DEFAULT '',
  documents TEXT NOT NULL CHECK(json_valid(documents) AND json_type(documents)='array'),
  status TEXT NOT NULL CHECK(status IN ('draft','accepted','rejected','retired')),
  proposed_by TEXT REFERENCES users(id),
  change_note TEXT NOT NULL DEFAULT '',
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  effective_from TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,benefit_key,revision),
  CHECK(source_kind<>'regulation' OR length(trim(article))>=2),
  -- من اقترح لا يعتمد: قيد في المخطط لا في الكود وحده.
  CHECK(decided_by IS NULL OR proposed_by IS NULL OR decided_by<>proposed_by),
  CHECK((status='draft')=(decided_by IS NULL)),
  CHECK(status NOT IN ('accepted','retired') OR effective_from IS NOT NULL),
  -- ما أحالته اللائحة إلى مصفوفة غير مرفقة لا يُعتمد بلا سند مكتوب في قرار الاعتماد.
  CHECK(status<>'accepted' OR source_kind='regulation' OR length(trim(decision_note))>=10)
) STRICT;
CREATE UNIQUE INDEX benefit_catalog_one_accepted ON benefit_catalog(tenant_id,benefit_key) WHERE status='accepted';
CREATE UNIQUE INDEX benefit_catalog_one_draft ON benefit_catalog(tenant_id,benefit_key) WHERE status='draft';
-- المسودة تُعدّل، والقرار يُسجَّل مرة واحدة، والمعتمدة لا تتغير إلا إلى «مستبدلة» حين تُعتمد مراجعة أحدث.
CREATE TRIGGER benefit_catalog_fixed BEFORE UPDATE ON benefit_catalog
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.benefit_key<>OLD.benefit_key OR NEW.revision<>OLD.revision OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
  OR NOT ((OLD.status='draft' AND NEW.status IN ('draft','accepted','rejected')) OR (OLD.status='accepted' AND NEW.status='retired'))
  OR (OLD.status<>'draft' AND (NEW.name<>OLD.name OR NEW.summary<>OLD.summary OR NEW.source_kind<>OLD.source_kind OR NEW.article<>OLD.article OR NEW.source_note<>OLD.source_note OR NEW.rules<>OLD.rules
    OR NEW.value_basis<>OLD.value_basis OR NEW.value_params<>OLD.value_params OR NEW.frequency<>OLD.frequency OR NEW.claim_method<>OLD.claim_method OR NEW.request_option<>OLD.request_option OR NEW.documents<>OLD.documents
    OR NEW.decided_by IS NOT OLD.decided_by OR NEW.effective_from IS NOT OLD.effective_from OR NEW.proposed_by IS NOT OLD.proposed_by))
BEGIN SELECT RAISE(ABORT,'a decided benefit is replaced by a new revision, not edited'); END;
CREATE TRIGGER benefit_catalog_no_delete BEFORE DELETE ON benefit_catalog BEGIN SELECT RAISE(ABORT,'benefit catalog history is retained'); END;

-- البذرة: مسودة لكل ميزة في كل كيان قائم، ولكل كيان يُنشأ بعد الترحيل.
INSERT INTO benefit_catalog(id,tenant_id,benefit_key,revision,sort_order,category,name,summary,source_kind,article,source_note,rules,value_basis,value_params,frequency,claim_method,request_option,documents,status,created_at,updated_at)
  SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
    t.id,b.benefit_key,1,b.sort_order,b.category,b.name,b.summary,b.source_kind,b.article,b.source_note,b.rules,b.value_basis,b.value_params,b.frequency,b.claim_method,b.request_option,b.documents,'draft',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM tenants t CROSS JOIN benefit_templates b;
CREATE TRIGGER benefit_catalog_seed AFTER INSERT ON tenants
BEGIN
  INSERT INTO benefit_catalog(id,tenant_id,benefit_key,revision,sort_order,category,name,summary,source_kind,article,source_note,rules,value_basis,value_params,frequency,claim_method,request_option,documents,status,created_at,updated_at)
    SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
      NEW.id,b.benefit_key,1,b.sort_order,b.category,b.name,b.summary,b.source_kind,b.article,b.source_note,b.rules,b.value_basis,b.value_params,b.frequency,b.claim_method,b.request_option,b.documents,'draft',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM benefit_templates b;
END;

-- 3) طلب المزايا الواحد بخياراته. لكل خيار حقوله ومستنداته ومساره: الموظف ← الموارد البشرية ← المالية حين يكون فيه مال.
CREATE TABLE benefit_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reference TEXT NOT NULL CHECK(reference GLOB 'BEN-[0-9][0-9][0-9][0-9]-[0-9]*'),
  employee_id TEXT NOT NULL,
  option TEXT NOT NULL CHECK(option IN ('dependant_add','dependant_remove','class_upgrade','ticket_claim','education_claim','benefit_letter')),
  catalog_id TEXT,
  details TEXT NOT NULL CHECK(json_valid(details) AND json_type(details)='object'),
  needs_finance INTEGER NOT NULL CHECK(needs_finance IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('pending_hr','pending_finance','completed','rejected','withdrawn')),
  hr_by TEXT,
  hr_at TEXT,
  hr_note TEXT NOT NULL DEFAULT '',
  hr_details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(hr_details) AND json_type(hr_details)='object'),
  finance_by TEXT,
  finance_at TEXT,
  finance_note TEXT NOT NULL DEFAULT '',
  amount_minor INTEGER CHECK(amount_minor IS NULL OR amount_minor>0),
  outcome TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(outcome) AND json_type(outcome)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id,tenant_id),
  UNIQUE(tenant_id,reference),
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(hr_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(finance_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(catalog_id,tenant_id) REFERENCES benefit_catalog(id,tenant_id),
  -- صاحب الطلب لا يقرر فيه، ومن قرر في الموارد البشرية لا يؤكد ماليًا.
  CHECK(hr_by IS NULL OR hr_by<>employee_id),
  CHECK(finance_by IS NULL OR (finance_by<>employee_id AND finance_by<>hr_by)),
  CHECK(needs_finance=1 OR finance_by IS NULL),
  CHECK(status<>'pending_finance' OR (needs_finance=1 AND hr_by IS NOT NULL AND amount_minor IS NOT NULL)),
  CHECK(status<>'completed' OR hr_by IS NOT NULL),
  CHECK(status<>'completed' OR needs_finance=0 OR (finance_by IS NOT NULL AND amount_minor IS NOT NULL))
) STRICT;
CREATE INDEX benefit_requests_scope ON benefit_requests(tenant_id,employee_id,created_at);
CREATE INDEX benefit_requests_queue ON benefit_requests(tenant_id,status);
CREATE TRIGGER benefit_requests_fixed BEFORE UPDATE ON benefit_requests
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.reference<>OLD.reference OR NEW.employee_id<>OLD.employee_id OR NEW.option<>OLD.option
  OR NEW.catalog_id IS NOT OLD.catalog_id OR NEW.details<>OLD.details OR NEW.needs_finance<>OLD.needs_finance OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
  OR OLD.status IN ('completed','rejected','withdrawn')
  OR NOT ((OLD.status='pending_hr' AND NEW.status IN ('pending_finance','completed','rejected','withdrawn')) OR (OLD.status='pending_finance' AND NEW.status IN ('completed','rejected','withdrawn')))
BEGIN SELECT RAISE(ABORT,'a decided benefit request is final'); END;
CREATE TRIGGER benefit_requests_no_delete BEFORE DELETE ON benefit_requests BEGIN SELECT RAISE(ABORT,'benefit requests are retained'); END;

-- 4) مقترح الصرف أو الخصم: نهاية المسار المالي. لا حالة «صُرف» هنا؛ مُعد الرواتب يسلّمه إلى حركات المسير
--    مقترحًا (payroll_adjustments.status='proposed') يعتمده معتمد الرواتب هناك، أو تتولاه المالية مصروفًا للشركة.
CREATE TABLE benefit_payout_proposals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL UNIQUE,
  employee_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK(target IN ('payroll_addition','payroll_deduction','company_expense')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  status TEXT NOT NULL CHECK(status IN ('proposed','handed_to_payroll','withdrawn')),
  payroll_adjustment_id TEXT REFERENCES payroll_adjustments(id),
  proposed_by TEXT NOT NULL,
  handed_by TEXT REFERENCES users(id),
  handed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  FOREIGN KEY(request_id,tenant_id) REFERENCES benefit_requests(id,tenant_id),
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(proposed_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(proposed_by<>employee_id),
  CHECK((status='handed_to_payroll')=(payroll_adjustment_id IS NOT NULL)),
  CHECK(status<>'handed_to_payroll' OR target IN ('payroll_addition','payroll_deduction')),
  CHECK(handed_by IS NULL OR handed_by<>employee_id)
) STRICT;
CREATE TRIGGER benefit_payouts_start_proposed BEFORE INSERT ON benefit_payout_proposals
WHEN NEW.status<>'proposed' BEGIN SELECT RAISE(ABORT,'a benefit payout is only ever proposed; nothing is paid from the benefits module'); END;
CREATE TRIGGER benefit_payouts_fixed BEFORE UPDATE ON benefit_payout_proposals
WHEN NEW.id<>OLD.id OR NEW.request_id<>OLD.request_id OR NEW.employee_id<>OLD.employee_id OR NEW.target<>OLD.target OR NEW.amount_minor<>OLD.amount_minor OR NEW.proposed_by<>OLD.proposed_by
  OR NEW.version<>OLD.version+1 OR OLD.status<>'proposed' OR NEW.status NOT IN ('handed_to_payroll','withdrawn')
BEGIN SELECT RAISE(ABORT,'a payout proposal is handed over or withdrawn once'); END;
CREATE TRIGGER benefit_payouts_no_delete BEFORE DELETE ON benefit_payout_proposals BEGIN SELECT RAISE(ABORT,'payout proposals are retained'); END;

-- 5) مستندات المزايا: مرفقات الطلب (شهادة ميلاد، عقد زواج، فاتورة مدرسة) وبطاقة التأمين على التسجيل.
--    جدول خاص لا stored_files: هذه وثائق أسرة الموظف، لا يراها إلا صاحبها وحامل تصريح المزايا، ولا تدخل بحثًا ولا تقريرًا.
CREATE TABLE benefit_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('request','enrolment')),
  owner_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(length(trim(label))>=3),
  filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 120),
  media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','image/png','image/jpeg')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152),
  digest TEXT NOT NULL,
  content BLOB NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,owner_kind,owner_id,digest),
  FOREIGN KEY(employee_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(uploaded_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX benefit_documents_owner ON benefit_documents(tenant_id,owner_kind,owner_id);
CREATE TRIGGER benefit_documents_no_update BEFORE UPDATE ON benefit_documents BEGIN SELECT RAISE(ABORT,'benefit documents are immutable'); END;
CREATE TRIGGER benefit_documents_no_delete BEFORE DELETE ON benefit_documents BEGIN SELECT RAISE(ABORT,'benefit documents are retained'); END;

-- 6) الإشعارات: لا يُعاد بناء جدول الإشعارات هنا. موضوعات المزايا (benefit_request للموظف، وbenefit_review
--    وbenefit_catalog لفريق المزايا والمالية) تطابق شرط الشكل الذي يضعه الترحيل 099 (حروف لاتينية صغيرة وشرطة سفلية)،
--    والقائمة المسموحة وشاشة كل موضوع في SUBJECT_LINKS (app/notices.mjs).
