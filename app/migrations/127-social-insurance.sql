-- 127: خصم التأمينات الاجتماعية بحسب حالة كل موظف، لا نسبة واحدة على الجميع.
-- طلب المالك (سبتمبر 2026): «خصم التأمينات خذه من النظام بالضبط وطبق الخصم حسب كل حالة مذكورة».
--
-- العطب الذي يعالجه هذا الترحيل: سياسة دورة الرواتب تحمل نسبة استقطاع واحدة (social_insurance_employee_bp)
-- تُطبَّق على كل موظف. في النظام: غير السعودي لا يُخصم منه شيء، والسعودي الخاضع للنظام السابق نسبة ثابتة،
-- والسعودي المشترك الجديد نسبة تتدرج سنويًا، والأجر الخاضع له حد أدنى وحد أعلى. نسبة واحدة تخصم خطأً من أجر بشر.
--
-- ثلاث حالات لا غير، بقرار المالك (22 سبتمبر 2026): «لا تحط خليجيين في خصم التأمينات».
-- فرع مواطني دول الخليج لم يُبنَ ولم يُزرع ولم يُوثَّق نسبةً، رغم أن البحث غطاه: نسبه لكل دولة غير متحقق منها أصلًا.
--
-- الحالة لا تُكتب بيد أحد: تُشتق من الجنسية وتاريخ المباشرة كما هما في ملف الموظف
-- (employee_demographics.nationality_group وأقدم عقد للموظف). ما ينقص منهما يُقال «غير متاح» ويمنع الاعتماد، ولا يُخمَّن.
--
-- النسب هنا معلمات سياسة لا ثوابت في الكود: تصل مستخرجًا للمنصة في مسودة (tenant_id فارغ، status مسودة،
-- بموادها ومصدرها كما في reg-seed-deductions)، ولا تسري إلا بقبول مدير الموارد البشرية (hr.policy.accept) لكيانه.

-- ═══ 1) نوع سياسة جديد في قواعد اللائحة: التأمينات الاجتماعية ═══
-- kind محكوم بـCHECK في الترحيل 102 المطبَّق، والمطبَّق لا يُعدَّل. فيُعاد بناء الجدول باسمه هنا على نمط الترحيل 124:
-- نسخة مؤقتة، ثم إسقاط، ثم إنشاء باسمه مباشرة، ثم إعادة الصفوف. أربعة جداول تحيل إليه بالاسم
-- (based_on الذاتي، وresignations.policy_id، وsettlement_rule_basis.policy_id، وtravel_decisions.policy_id)،
-- فإعادة التسمية كانت ستعيد كتابة إحالاتها، والإسقاط يجعل كل إحالة مخالفةً مؤجلة لا تُغلق إلا بإعادة إدراج الصف الأب نفسه.
PRAGMA defer_foreign_keys=ON;

CREATE TEMP TABLE regulation_policies_carry AS SELECT * FROM regulation_policies;

DROP TRIGGER regulation_policies_fixed;
DROP TRIGGER regulation_policies_no_delete;
DROP TABLE regulation_policies;

CREATE TABLE regulation_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK(kind IN ('resignation','settlement','deductions','pay_rules','travel_per_diem','social_insurance')),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  articles TEXT NOT NULL CHECK(json_valid(articles) AND json_array_length(articles)>0),
  source TEXT NOT NULL CHECK(length(trim(source))>=10),
  body TEXT NOT NULL CHECK(length(trim(body))>=20),
  parameters TEXT NOT NULL CHECK(json_valid(parameters)),
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

INSERT INTO regulation_policies(id,tenant_id,kind,title,articles,source,body,parameters,pending_choices,status,based_on,effective_from,prepared_by,decided_by,decided_at,decision_note,created_at)
SELECT id,tenant_id,kind,title,articles,source,body,parameters,pending_choices,status,based_on,effective_from,prepared_by,decided_by,decided_at,decision_note,created_at
FROM regulation_policies_carry;
DROP TABLE regulation_policies_carry;

CREATE INDEX regulation_policies_live ON regulation_policies(tenant_id,kind,status,effective_from);
CREATE TRIGGER regulation_policies_fixed BEFORE UPDATE ON regulation_policies
WHEN OLD.tenant_id IS NULL OR OLD.status<>'draft' OR NEW.kind<>OLD.kind OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.prepared_by IS NOT OLD.prepared_by OR NEW.articles<>OLD.articles
BEGIN SELECT RAISE(ABORT,'a seeded or decided regulation policy is never rewritten; prepare a new draft'); END;
CREATE TRIGGER regulation_policies_no_delete BEFORE DELETE ON regulation_policies BEGIN SELECT RAISE(ABORT,'regulation policies are retained'); END;

-- ═══ 2) المستخرج المزروع: جدول النسب بالحالة والتاريخ ═══
-- كل رقم هنا من الموجز القانوني الموثق بمصدره، ولا رقم غير متحقق منه: ما لم يُتحقق منه مكتوب في open_questions
-- سؤالًا مفتوحًا يراه مدير الموارد البشرية قبل القبول، لا قيمةً تُطبَّق.
--   * الحالة 1 — سعودي خاضع للنظام السابق (له مدة اشتراك قبل 3 يوليو 2024): معاشات 9%+9%، ساند 0.75%+0.75%،
--     أخطار مهنية 2% على صاحب العمل وحده. الموظف 9.75% وصاحب العمل 11.75%. ساند 0.75% منذ 1 يناير 2022.
--   * الحالة 2 — سعودي مشترك جديد (لا مدة اشتراك قبل 3 يوليو 2024): درجات تصعد في 1 يوليو من كل سنة
--     بحسب جدول المؤسسة المنشور، وتُطبَّق بالتاريخ على كل من في هذه الفئة مهما كان تاريخ التحاقه.
--   * الحالة 3 — غير سعودي: أخطار مهنية 2% على صاحب العمل وحده، ولا يُخصم من الموظف شيء.
-- الأجر الخاضع: الأساسي + بدل السكن النقدي (م17 اللائحة التنفيذية)؛ لا نقل ولا بدلات أخرى ولا عمل إضافي.
-- الحد الأدنى 1,500 ريال لفرع المعاشات و400 ريال لمن في الأخطار المهنية وحدها، والحد الأعلى 45,000 ريال.
-- فرع الأخطار المهنية لا تاريخ بدء له في الموجز («سارية في النظامين»)، فتاريخ صفّه حدٌّ تقني أدنى معلن لا تاريخ نظامي:
-- بغيره كان شهرٌ سبق التاريخ المكتوب يمتنع فيه احتساب الـ2% ويمتنع اعتماد مسيره، لفرعٍ سارٍ في النظامين معًا.
-- age_thresholds فارغة عمدًا: الموجز يذكر حالات سنٍّ لا تُطبَّق فيها المعاشات (أول تغطية بعد سنٍّ معينة)،
-- ولم تُتحقق أعمارها في مصدر مفتوح هنا، فهي سؤال مفتوح لا قيمة. متى حققها مدير الموارد البشرية أعدّ مسودة بها،
-- وعندها يمتنع اعتماد مسير من بلغ السن عند مباشرته بدل أن يُخصم منه بنسبة الجدول (انظر open_questions).
INSERT INTO regulation_policies(id,tenant_id,kind,title,articles,source,body,parameters,pending_choices,status,created_at) VALUES
('reg-seed-social-insurance',NULL,'social_insurance','التأمينات الاجتماعية: نسبة كل حالة، والأجر الخاضع وحداه الأدنى والأعلى',
 '["م18 ف1 و ف2/أ نظام التأمينات 1421","م15 و م28 و م29 و م43 و م44 نظام التأمينات الجديد (م/273)","البند ثالثًا من المرسوم م/273","م8 ف1 و ف2","م17 و م20 اللائحة التنفيذية","م4 ف1 نظام 1421","م3 ف2 نظام التأمين ضد التعطل"]',
 'نظاما التأمينات الاجتماعية (1421 والمرسوم م/273) واللائحة التنفيذية للنظام الجديد وجدول النسب المنشور في الأسئلة الشائعة للمؤسسة العامة للتأمينات الاجتماعية — نص مستخرج آليًا يلزم مطابقته مع المصدر الرسمي قبل القبول',
 'يُخصم من الموظف بحسب حالته لا بنسبة واحدة. السعودي الخاضع للنظام السابق (له مدة اشتراك قبل 3 يوليو 2024): 9% معاشات + 0.75% ساند = 9.75%، وعلى صاحب العمل 9% + 0.75% + 2% أخطار مهنية = 11.75%. السعودي المشترك الجديد (لا مدة اشتراك قبل ذلك التاريخ): نسبة تتدرج في 1 يوليو من كل سنة — 9.75% ثم 10.25% ثم 10.75% (السارية اليوم) ثم 11.25% ثم 11.75%، ومقابلها على صاحب العمل 11.75% ثم 12.25% ثم 12.75% ثم 13.25% ثم 13.75%. غير السعودي: لا يُخصم منه شيء، وعلى صاحب العمل 2% أخطار مهنية فقط. الأجر الخاضع هو الأساسي وبدل السكن النقدي، بحد أدنى 1,500 ريال لفرع المعاشات و400 ريال لمن في الأخطار المهنية وحدها، وبحد أعلى 45,000 ريال. مواطنو دول مجلس التعاون خارج هذا الجدول بقرار المالك، ونسبهم لكل دولة غير متحقق منها أصلًا.',
 '{"wage_components":["basic","housing"],"max_wage_minor":4500000,"floors_minor":{"annuities":150000,"hazards_only":40000},"new_law_effective_from":"2024-07-03","partial_month_basis":null,"age_thresholds":null,"employee_rounding":"pay_rules","cases":{"saudi_previous_law":{"name":"سعودي خاضع للنظام السابق","floor":"annuities","article":"م18 ف1 و ف2/أ نظام 1421","source_url":"https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/8ff3cd90-e466-4bf9-a071-a9a700f2a70d/1","schedule":[{"from":"2022-01-01","employee_bp":975,"employer_bp":1175,"note":"معاشات 9%+9% وساند 0.75%+0.75% منذ 1 يناير 2022 وأخطار مهنية 2% على صاحب العمل","source_url":"https://www.gosi.gov.sa/GOSIOnline/news106"}]},"saudi_new_entrant":{"name":"سعودي مشترك جديد (لا مدة اشتراك سابقة)","floor":"annuities","article":"البند ثالثًا من المرسوم م/273 و م15","source_url":"https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/eaee8a20-3a54-4aaf-b0d9-b1ad00998962/1","schedule":[{"from":"2024-07-03","employee_bp":975,"employer_bp":1175,"note":"معاشات 18% مناصفة + ساند 1.5% مناصفة + أخطار 2%","source_url":"https://www.gosi.gov.sa/ContactUs/Faq/BySubject"},{"from":"2025-07-01","employee_bp":1025,"employer_bp":1225,"note":"معاشات 19%","source_url":"https://www.spa.gov.sa/N2349640"},{"from":"2026-07-01","employee_bp":1075,"employer_bp":1275,"note":"معاشات 20% — الدرجة السارية اليوم","source_url":"https://www.gosi.gov.sa/ContactUs/Faq/BySubject"},{"from":"2027-07-01","employee_bp":1125,"employer_bp":1325,"note":"معاشات 21% — بافتراض بقاء ساند 1.5%","source_url":"https://www.gosi.gov.sa/ContactUs/Faq/BySubject"},{"from":"2028-07-01","employee_bp":1175,"employer_bp":1375,"note":"معاشات 22% وهي النسبة النهائية (م15)","source_url":"https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/eaee8a20-3a54-4aaf-b0d9-b1ad00998962/1"}]},"non_saudi":{"name":"غير سعودي","floor":"hazards_only","article":"م28 و م29 (م/273) و م4 ف1 و م18 ف1 نظام 1421","source_url":"https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/eaee8a20-3a54-4aaf-b0d9-b1ad00998962/1","schedule":[{"from":"1900-01-01","employee_bp":0,"employer_bp":200,"note":"أخطار مهنية 2% على صاحب العمل وحده؛ لا يُخصم من الموظف شيء. الفرع سارٍ في النظامين ولا تاريخ بدء له في الموجز، وهذا التاريخ حدٌّ تقني أدنى لا تاريخ نظامي","source_url":"https://www.gosi.gov.sa/ContactUs/Faq/BySubject"}]}},"open_questions":["التقريب: لا قاعدة رسمية لتقريب الاشتراك إلى الهللة أو الريال في النظامين ولا في اللائحة التنفيذية ولا في الأسئلة الشائعة. أمثلة المؤسسة بخانتين عشريتين، والموجز يوصي بالاحتساب إلى خانتين ثم المطابقة مع فاتورة المؤسسة الشهرية. الاشتراك يُحتسب هنا بالهللة، وحصة الموظف تتبع employee_rounding: القيمة المزروعة pay_rules تعني اتباع قاعدة التقريب التي قبلتَها في «قواعد صرف الأجر» (م50/5)، وهي تُقرّب الخصم إلى الريال الأعلى فتزيد عن رقم الهللة حتى 0.99 ريال في الشهر؛ والقيمة halala تُبقي الخصم بالهللة كما يوصي الموجز. حصة المنشأة تتبع م50/5 على كل حال لأنها تكلفة عليها لا خصمًا على أحد. اختر بتعديل مسودة قبل قبولها.","مقسوم شهر الالتحاق وشهر الترك: المصادر تقول «على أساس عدد أيام الخدمة» ولا تقول أهو الأجر ÷ 30 أم ÷ أيام الشهر الفعلية. اختر المقسوم عند القبول (partial_month_basis).","الحد الأدنى للأجر الخاضع لمن يخضع للنظام الجديد: م8 ف1 تحيل إلى الحد الأدنى للأجور الذي تحدده الجهة المختصة ولا رقم في النظام ولا في لائحته. الرقمان 1,500 و400 من الأسئلة الشائعة للنظام الحالي.","السكن العيني: اللائحة التنفيذية تقدّره بأجر شهرين في السنة، والمنصة لا تسجل سكنًا عينيًا. الموظف الذي له سكن عيني يحتاج معالجة لم تُبنَ.","استمرار اشتراك المعاشات للسعودي الخاضع للنظام السابق بعد بلوغه الستين: مستفاد من م4 ف2 ولم ينص عليه مصدر مفتوح صراحة. وقف ساند عند الستين متحقق منه ولم يُبنَ هنا لأن المنصة لا تلزم بتاريخ الميلاد.","تعدد أصحاب العمل: عند تجاوز مجموع الأجور 45,000 ريال يُخفَّض أجر كل صاحب عمل تناسبيًا. المنصة لا تعرف أجر الموظف عند غيرها، فالحد الأعلى هنا يُطبَّق على أجر هذه المنشأة وحدها.","العمل خارج المملكة، والعمل بالساعة والقطعة والعمولة، ومتدربو تمهير: حالات نص عليها النظام ولم تُبنَ هنا؛ من ينطبق عليه أحدها يحتاج قرارًا مكتوبًا قبل اعتماد مسيره.","مواطنو دول مجلس التعاون: خارج هذا الجدول بقرار المالك. حقل الجنسية في المنصة قيمتان لا غير (سعودي / غير سعودي)، فالخليجي لا يتميز عن أي غير سعودي إلا بجواب مسجَّل. ولذلك يُسأل السؤال حيث تُسجَّل الجنسية: كل من سُجِّل «غير سعودي» يلزمه جواب صريح عن «هل هو مواطن خليجي؟» — «نعم» يمنع اعتماد مسيره حتى يُقرَّر أمره، و«لا» يُسجَّل جوابًا بسنده. وقبل الجواب لا يُعتمد مسيره: لا يُفترض أنه ليس خليجيًا لمجرد أن أحدًا لم يسأل.",
   "أول تغطية تأمينية في سنٍّ متقدمة (حالتا الموجز 6 و7): الموجز يذكر أن فرع المعاشات لا يُطبَّق على من تبدأ تغطيته بعد سنٍّ معينة — سنٌّ في النظام السابق وأخرى في النظام الجديد — وأن التأمين ضد التعطل (ساند) له حد سنٍّ عند البداية وحد وقف. أعمار هذه الحالات لم تُتحقق في مصدر رسمي مفتوح هنا، فلم تُكتب قيمةً ولم تُطبَّق. أثر ذلك اليوم صريح: من بدأت تغطيته في سنٍّ متقدمة يُخصم منه بنسبة جدول حالته كاملةً، وقد يكون فرع المعاشات لا ينطبق عليه أصلًا. متى حققتَ الأعمار من المصدر الرسمي، أعدّ مسودة تحمل age_thresholds لكل حالة؛ عندها يمتنع اعتماد مسير من بلغ السن عند تاريخ مباشرته ويُحال أمره إليك بدل أن يُخصم منه.",
   "الاشتراك أثناء الإجازة بلا أجر: الموجز يقول إن الاشتراك يستمر كاملًا على الأجر المسجَّل لا على ما صُرف فعلًا، ولا يعالج كيف يسترد صاحب العمل حصة الموظف حين لا يُصرف له أجر. المطبَّق هنا: حصة الموظف لا تتجاوز ما تبقى من أجره بعد الغياب غير المدفوع (م19/4: لا يُحسم من أجر لم يُصرف)، والفرق يظهر على المسير وفي سند السطر باسمه. والمنشأة تبقى مدينة للمؤسسة بالحصتين كاملتين. استرداد هذا الفرق من الموظف قرارك، ولم تبنِ المنصة له مسارًا.",
   "تغيّر الأجر في منتصف الشهر: يُحتسب الاشتراك على كل جزء من الشهر بأجره وأيامه ثم يُجمع الجزءان. وهل يُطبَّق الحد الأعلى (45,000 ريال) على كل جزء بأجره الشهري أم على مجموع الشهر؟ لم يُعالجه الموجز، والمطبَّق هنا الحصر على أجر كل جزء الشهري قبل نسبته من الشهر."]}',
 '["partial_month_basis"]','draft','2026-09-22T00:00:00.000Z');

-- ═══ 3) استثناءات التأمينات على الموظف: مؤرخة، لا تُعدَّل ولا تُحذف ═══
-- الحالة تُشتق ولا تُكتب، فهذا الجدول ليس موضع «حالة الموظف» بل موضع ما لا تعرفه المنصة من غير أن يقوله إنسان:
--   * prior_contribution_period — «له مدة اشتراك سابقة»: سعودي التحق بالشركة بعد 3 يوليو 2024 لكن له مدة اشتراك
--     عند صاحب عمل آخر قبله، فهو ليس مشتركًا جديدًا نظامًا (جدول التدرج لمن لا مدة اشتراك له). بلا هذا الاستثناء
--     يُشتق من تاريخ المباشرة وحده أنه مشترك جديد فيُخصم منه أكثر مما يجب. الاستثناء وحده ينقله للنظام السابق.
--   * gcc_national — «مواطن خليجي»: خارج جدول الخصم بقرار المالك. تسجيله يمنع اعتماد المسير حتى يُقرَّر أمره،
--     ولا يُعامل معاملة السعودي ولا معاملة غير السعودي بصمت.
--   * not_gcc_national — «ليس مواطنًا خليجيًا»: الجواب السالب مسجَّلًا. حقل الجنسية قيمتان لا غير، فسكوتُ الملف
--     عن الخليجي كان يعني «غير سعودي» بصمت. الجواب يُسأل حيث تُسجَّل الجنسية، وقبل تسجيله يمتنع اعتماد مسير
--     غير السعودي: فرقٌ بين «سألنا فأجاب لا» وبين «لم يسأله أحد».
-- يسجله شخص واحد من الموارد البشرية بسند مكتوب، ولا يسجله الموظف لنفسه، ولا يُكتب فيه رقم هوية ولا رقم اشتراك.
CREATE TABLE employee_insurance_overrides (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('prior_contribution_period','gcc_national','not_gcc_national')),
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- السند: نوع الوثيقة التي اطُّلع عليها (شهادة مدد وأجور، إفادة من المؤسسة…)، لا رقمها.
  -- ستة أرقام متتالية مرفوضة بأي رسم للرقم: لاتينية وعربية هندية وفارسية. الشاشة تُطبّع الأرقام قبل الفحص
  -- فتكشف ما فرّقته المسافات والنقاط أيضًا؛ وهذه القيود سدٌّ أخير في القاعدة نفسها لا الفحص الوحيد.
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10
    AND basis NOT GLOB '*[0-9][0-9][0-9][0-9][0-9][0-9]*'
    AND basis NOT GLOB '*[٠-٩][٠-٩][٠-٩][٠-٩][٠-٩][٠-٩]*'
    AND basis NOT GLOB '*[۰-۹][۰-۹][۰-۹][۰-۹][۰-۹][۰-۹]*'),
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  -- السحب: لا يُحذف صف ولا يُعدَّل؛ الخطأ يُسحب بسبب مكتوب ويبقى في السجل.
  withdrawn_by TEXT REFERENCES users(id),
  withdrawn_at TEXT,
  withdrawal_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(recorded_by<>user_id),
  CHECK(withdrawn_by IS NULL OR withdrawn_by<>user_id),
  CHECK((withdrawn_by IS NULL)=(withdrawn_at IS NULL)),
  CHECK(withdrawn_by IS NULL OR length(trim(withdrawal_reason))>=10)
) STRICT;
-- استثناء واحد قائم من كل نوع لكل موظف؛ المسحوب لا يمنع تسجيل غيره.
CREATE UNIQUE INDEX employee_insurance_overrides_live ON employee_insurance_overrides(tenant_id,user_id,kind) WHERE withdrawn_by IS NULL;
CREATE INDEX employee_insurance_overrides_user ON employee_insurance_overrides(tenant_id,user_id,effective_from);
CREATE TRIGGER employee_insurance_overrides_fixed BEFORE UPDATE ON employee_insurance_overrides
WHEN OLD.withdrawn_by IS NOT NULL OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.user_id<>OLD.user_id OR NEW.kind<>OLD.kind
  OR NEW.effective_from<>OLD.effective_from OR NEW.basis<>OLD.basis OR NEW.recorded_by<>OLD.recorded_by OR NEW.recorded_at<>OLD.recorded_at OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'an insurance override is recorded once; a wrong one is withdrawn with a written reason'); END;
CREATE TRIGGER employee_insurance_overrides_no_delete BEFORE DELETE ON employee_insurance_overrides
BEGIN SELECT RAISE(ABORT,'insurance overrides are retained'); END;

-- ═══ 4) حصة صاحب العمل في سطر المسير ═══
-- تكلفة على المنشأة لا خصم على الموظف: لا تدخل صافي السطر ولا استقطاعات المسير ولا ملف حماية الأجور.
-- عمود بقيمة افتراضية صفر حتى تبقى الإدراجات القائمة (ومنها إدراجات الاختبارات الخام) صالحة كما هي.
ALTER TABLE payroll_lines ADD COLUMN employer_insurance_minor INTEGER NOT NULL DEFAULT 0 CHECK(employer_insurance_minor>=0);
-- مشغّل القفل لا يسمّي الأعمدة الجديدة، فيبقى العمود الجديد قابلًا للتعديل في المراجعة لولا إعادة إنشائه.
DROP TRIGGER payroll_lines_locked_update;
CREATE TRIGGER payroll_lines_locked_update BEFORE UPDATE ON payroll_lines
WHEN (SELECT status FROM payroll_runs WHERE id=OLD.run_id)<>'in_review' OR NEW.net_minor<>OLD.net_minor OR NEW.gross_minor<>OLD.gross_minor OR NEW.user_id<>OLD.user_id OR NEW.earnings<>OLD.earnings OR NEW.basis<>OLD.basis OR NEW.additions_minor<>OLD.additions_minor OR NEW.advance_minor<>OLD.advance_minor OR NEW.other_deductions_minor<>OLD.other_deductions_minor OR NEW.adjustments<>OLD.adjustments OR NEW.social_insurance_minor<>OLD.social_insurance_minor OR NEW.employer_insurance_minor<>OLD.employer_insurance_minor
BEGIN SELECT RAISE(ABORT,'payroll lines change only by recalculating a draft'); END;

-- ═══ 5) قرار الصرف المبكر لشهر ═══
-- المالك: الرواتب تُصرف في 27 وتُزاح إلى يوم العمل السابق (م48 المقبولة)، «وفي بعض الأحيان يتم صرفها قبل إجازة الأعياد».
-- المسير نفسه لا يحمل تاريخ صرف، ومشغّل payroll_runs_locked يمنع أي تعديل عليه بعد الاعتماد، والمسير يُلغى ويُعاد إعداده.
-- فالقرار جدول مستقل بالشهر: يقترحه شخص ويؤكده غيره، ولا يكون أبدًا بعد تاريخ اللائحة (CHECK صلب).
CREATE TABLE payroll_pay_date_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  -- تاريخ اللائحة وقت القرار: يوم الصرف الاسمي بعد إزاحة م48. يُحفظ ليُقرأ القرار بعد سنة كما قُرئ يوم اتُّخذ.
  nominal_date TEXT NOT NULL CHECK(nominal_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  regulation_date TEXT NOT NULL CHECK(regulation_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  pay_on TEXT NOT NULL CHECK(pay_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
  status TEXT NOT NULL CHECK(status IN ('proposed','confirmed','rejected','withdrawn')),
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  confirmed_by TEXT REFERENCES users(id),
  confirmed_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  -- السحب: تاريخ صرف أُكِّد بالخطأ كان يبقى نافذًا إلى الأبد لأن المشغّل يمنع تعديل صف مقرَّر والفهرس يمنع بديلًا له.
  -- فالسحب مسار معلن كسحب استثناء التأمينات: بسبب مكتوب، بيد غير من اقترح، ويبقى الصف في السجل ويتحرر الشهر لقرار جديد.
  withdrawn_by TEXT REFERENCES users(id),
  withdrawn_at TEXT,
  withdrawal_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  -- أبكر من تاريخ اللائحة لا بعده أبدًا: الصرف المبكر تعجيل لا تأجيل.
  CHECK(pay_on<regulation_date),
  CHECK(pay_on>=month||'-01'),
  CHECK(confirmed_by IS NULL OR confirmed_by<>decided_by),
  CHECK(status<>'proposed' OR confirmed_by IS NULL),
  CHECK(status NOT IN ('confirmed','rejected') OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK(status<>'rejected' OR length(trim(decision_note))>=10),
  CHECK((withdrawn_by IS NULL)=(withdrawn_at IS NULL)),
  CHECK((status='withdrawn')=(withdrawn_by IS NOT NULL)),
  CHECK(withdrawn_by IS NULL OR (length(trim(withdrawal_reason))>=10 AND withdrawn_by<>decided_by))
) STRICT;
CREATE UNIQUE INDEX payroll_pay_date_one_live ON payroll_pay_date_decisions(tenant_id,month) WHERE status IN ('proposed','confirmed');
-- المقترح يُقرَّر مرة (تأكيدًا أو رفضًا)، والمؤكد يُسحب ولا يُعاد كتابته، والمرفوض والمسحوب نهايتان.
CREATE TRIGGER payroll_pay_date_fixed BEFORE UPDATE ON payroll_pay_date_decisions
WHEN OLD.status IN ('rejected','withdrawn')
  OR (OLD.status='proposed' AND NEW.status NOT IN ('confirmed','rejected'))
  OR (OLD.status='confirmed' AND (NEW.status<>'withdrawn' OR NEW.confirmed_by IS NOT OLD.confirmed_by OR NEW.confirmed_at IS NOT OLD.confirmed_at OR NEW.decision_note<>OLD.decision_note))
  OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.month<>OLD.month OR NEW.pay_on<>OLD.pay_on
  OR NEW.reason<>OLD.reason OR NEW.decided_by<>OLD.decided_by OR NEW.decided_at<>OLD.decided_at OR NEW.regulation_date<>OLD.regulation_date OR NEW.nominal_date<>OLD.nominal_date
BEGIN SELECT RAISE(ABORT,'a pay-date decision is proposed once and then confirmed or rejected; a confirmed one is withdrawn with a written reason and never rewritten'); END;
CREATE TRIGGER payroll_pay_date_no_delete BEFORE DELETE ON payroll_pay_date_decisions
BEGIN SELECT RAISE(ABORT,'pay-date decisions are retained'); END;
