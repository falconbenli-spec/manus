-- سجلّات تقرير الإدارة التنفيذية للمشاريع (EPMO): تعليق الإدارة على كل قسم، وخطة إغلاق كل فجوة
-- معلنة، وما تضعه الإدارة أمام التنفيذيين ليقرّر فيه. المرحلة الثالثة من خطة تقرير EPMO.
-- الوحدات: app/epmo-report.mjs (الكتالوج والأفعال) و app/epmo-board.mjs (اللوحة).
--
-- المبدأ الذي يحكم الملف كله: **الفجوة لا تختفي بصمت**. الرقم الذي لا نملكه يُعلن غيابه
-- (app/report-figures.mjs، المرحلة الأولى)، ثم يُتابَع هنا حتى يُغلق بدليل، أو يُرفض بسبب مكتوب.
-- لا حالة ثالثة اسمها «نُسي». ولذلك ثلاثة قيود على خطة الإغلاق تحمل المعنى كله، ولا تكفي الشيفرة
-- وحدها لحملها: ما يمنعه القيد في قاعدة البيانات لا يفتحه خطأ في وحدة ولا مسار جديد.
--
-- ما ليس هنا عمدًا: كتالوج الفجوات نفسه. الفجوة المعلنة ثابت في الشيفرة (MEASUREMENT_GAPS في
-- app/epmo-report.mjs) على سابقة AXES في app/project-axes.mjs، لأن ما يُبذر في جدول يُحذف منه،
-- وفجوة تُعدَّل إلى العدم ليست فجوة. الجدول هنا يحمل **خطة الإغلاق** لا التصريح بالفجوة.
--
-- وما ليس هنا عمدًا أيضًا: مخزن قرارات ثانٍ. `epmo_decision_requests` تطلب القرار وتنتظره،
-- وحين يصدر يُربط بسجل القرارات القائم `governance_decisions` (ترحيل 055). سجلّان للقرار
-- يعنيان قرارين مختلفين باسم واحد.
--
-- ونطاق هذا الترحيل إدارة واحدة: EPMO. ما تدين به إدارة أخرى (حسابات، مالية، تطوير أعمال،
-- موارد بشرية) يظهر فجوةً معلنة باسم إدارته، لا شاشةً ولا حقلًا ولا واجبَ إدخالٍ جديدًا عليها.

/* ───── 1. تعليق EPMO المكتوب على كل قسم في كل فترة ───── */
-- التقرير المركّب أرقام بمصادرها؛ وهذا موضع الجملة البشرية التي تقرأ الأرقام. عشرون حرفًا حد أدنى
-- لأن «جيد» و«لا جديد» ليست قراءة. الفترة جزء من المفتاح: تعليق فترةٍ لا يُنسب إلى غيرها.
CREATE TABLE epmo_section_notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_from TEXT NOT NULL CHECK(period_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_to TEXT NOT NULL CHECK(period_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  section_key TEXT NOT NULL CHECK(length(trim(section_key))>=3),
  body TEXT NOT NULL CHECK(length(trim(body))>=20),
  written_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(written_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(period_to>=period_from),
  UNIQUE(tenant_id,period_from,period_to,section_key)
) STRICT;
CREATE INDEX epmo_section_notes_period ON epmo_section_notes(tenant_id,period_from,period_to);
-- التعليق يُصحَّح بنسخة تالية لا بكتابة صامتة فوق السابقة، والفترة والقسم لا يتحولان بعد الكتابة:
-- تعليق كُتب عن الربع الأول لا يُنقل إلى الثاني بتعديل حقلين.
CREATE TRIGGER epmo_section_notes_versioned BEFORE UPDATE ON epmo_section_notes
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.period_from<>OLD.period_from
  OR NEW.period_to<>OLD.period_to OR NEW.section_key<>OLD.section_key OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'a section note is revised with the next version, and keeps its period and section'); END;

/* ───── 2. خطة إغلاق الفجوة المعلنة ───── */
-- مفتاح الفجوة نصّ يُطابَق بكتالوج الشيفرة (MEASUREMENT_GAPS)، ولا مفتاح أجنبي له لأنه ليس صفًّا
-- في جدول. الوحدة ترفض مفتاحًا خارج الكتالوج قبل الكتابة، وregister في report-figures.mjs يرفضه
-- عند التوليد؛ فالمفتاح المجهول لا يدخل من بابين.
--
-- الحالات الأربع، وما تعنيه كل واحدة:
--   declared — معلنة ولم يتسلّمها أحد بعد. هذه حالة البداية لكل فجوة في الكتالوج بلا صفّ هنا.
--   owned    — تسلّمها مالك بتاريخ مستهدف. بلا الاثنين ليست ملكية وإنما نية.
--   closed   — صار البند قابلًا للقياس، والدليل يسمّي **ما الذي جعله كذلك**، لا «تم».
--   refused  — قرار مكتوب بألّا يُقاس. الرفض المعلن أشرف من فجوة تُنسى، ولذلك سببه إلزامي.
CREATE TABLE epmo_gap_plans (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  gap_key TEXT NOT NULL CHECK(length(trim(gap_key))>=3),
  owner_id TEXT,
  target_on TEXT CHECK(target_on IS NULL OR target_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'declared' CHECK(status IN ('declared','owned','closed','refused')),
  decision_note TEXT NOT NULL DEFAULT '',
  closed_evidence TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,gap_key),
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(updated_by,tenant_id) REFERENCES users(id,tenant_id),
  -- القيود الثلاثة التي تحمل المعنى كله. الفجوة لا يمكن أن تختفي بصمت:
  -- (1) لا ملكية بلا مالك وتاريخ: «سنهتم بها» ليست إسنادًا.
  CHECK(status<>'owned' OR (owner_id IS NOT NULL AND target_on IS NOT NULL)),
  -- (2) لا إغلاق بلا دليل يسمّي ما الذي صار يُقاس: عشرة أحرف على الأقل، و«تم» لا تكفي.
  CHECK(status<>'closed' OR length(trim(closed_evidence))>=10),
  -- (3) لا رفض بلا سبب مكتوب: من يقرر ألّا يُقاس شيء يوقّع على قراره.
  CHECK(status<>'refused' OR length(trim(decision_note))>=10)
) STRICT;
CREATE INDEX epmo_gap_plans_status ON epmo_gap_plans(tenant_id,status,target_on);
-- الخطة تتغير بنسخة تالية، ومفتاح فجوتها لا يتحول: خطة فجوةٍ لا تُعاد توجيهها إلى فجوة أخرى.
CREATE TRIGGER epmo_gap_plans_versioned BEFORE UPDATE ON epmo_gap_plans
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.gap_key<>OLD.gap_key
BEGIN SELECT RAISE(ABORT,'a gap plan changes with the next version and keeps its gap key'); END;
-- الحذف ممنوع: الفجوة تُغلق بدليل أو تُرفض بسبب، ولا تُمحى. هذا هو القيد الذي يمنع الاختفاء الصامت
-- من الباب الخلفي بعد أن منعته القيود الثلاثة من الباب الأمامي.
CREATE TRIGGER epmo_gap_plans_no_delete BEFORE DELETE ON epmo_gap_plans
BEGIN SELECT RAISE(ABORT,'a declared gap is closed with evidence or refused with a reason, never deleted'); END;

/* ───── 3. ما تضعه EPMO أمام التنفيذيين ───── */
-- الطلب سؤال محدد بخياراته وأثر تأجيله، لا «للعلم». وحين يصدر القرار يُربط بسجل القرارات القائم،
-- فيبقى للقرار موضع واحد في المنصة: من قرر، ومتى، وعلى أي بدائل، وما أثره.
CREATE TABLE epmo_decision_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  period_from TEXT NOT NULL CHECK(period_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_to TEXT NOT NULL CHECK(period_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  section_key TEXT NOT NULL CHECK(length(trim(section_key))>=3),
  title TEXT NOT NULL CHECK(length(trim(title))>=5),
  asked TEXT NOT NULL CHECK(length(trim(asked))>=20),
  options TEXT NOT NULL CHECK(json_valid(options) AND json_array_length(options)>=2),
  consequence_of_delay TEXT NOT NULL CHECK(length(trim(consequence_of_delay))>=10),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','decided','withdrawn')),
  decision_id TEXT REFERENCES governance_decisions(id),
  withdrawn_reason TEXT NOT NULL DEFAULT '',
  raised_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(raised_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(period_to>=period_from),
  -- «مقرَّر» و«له قرار مرتبط» وجهان لحالة واحدة، في الاتجاهين: لا حالة قرار بلا قرار، ولا قرار
  -- مربوط بطلب لا يزال مفتوحًا أو مسحوبًا. سؤال يُعلن مقرَّرًا بلا سجل قرار هو الصمت مرة أخرى.
  CHECK((status='decided')=(decision_id IS NOT NULL)),
  CHECK(status<>'withdrawn' OR length(trim(withdrawn_reason))>=10)
) STRICT;
CREATE INDEX epmo_decision_requests_open ON epmo_decision_requests(tenant_id,status,period_to);
CREATE TRIGGER epmo_decision_requests_versioned BEFORE UPDATE ON epmo_decision_requests
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_at<>OLD.created_at
  OR NEW.raised_by<>OLD.raised_by OR NEW.period_from<>OLD.period_from OR NEW.period_to<>OLD.period_to
BEGIN SELECT RAISE(ABORT,'a decision request keeps its period and its author'); END;
CREATE TRIGGER epmo_decision_requests_no_delete BEFORE DELETE ON epmo_decision_requests
BEGIN SELECT RAISE(ABORT,'a decision request is withdrawn with a reason, never deleted'); END;

/* ───── 4. لقطة E01 معتمدة واحدة لكل فترة ───── */
-- E01 هو التقرير المركّب للإدارة التنفيذية للمشاريع، يبنيه العمل التالي على هذه المرحلة.
-- لقطتان معتمدتان لفترة واحدة تعنيان نسختين رسميتين متعارضتين للفترة نفسها، ولا سبيل لمن يقرأ
-- إحداهما أن يعرف أن الأخرى موجودة. المسودات تبقى بلا قيد: التحضير يتكرر، والاعتماد لا يتكرر.
--
-- التحقّق قبل بناء هذا الفهرس: `params` في `report_snapshots` تُكتب في `saveSnapshot`
-- (app/reports.mjs) بـ`JSON.stringify(result.params)` حيث `result.params` هو ما تعيده `period()`
-- في الملف نفسه، وهي تبني الكائن بترتيب مفاتيح ثابت `{from,to}` وبقيمتين نصّيتين مطبَّعتين
-- (`v.date` أو تاريخ الرياض المحسوب). فالتسلسل حتمي: الفترة نفسها تنتج النص نفسه حرفًا بحرف،
-- والفهرس على العمود كما هو صحيح. لو صارت `period()` تضيف مفتاحًا أو تقلب الترتيب، وجب استبدال
-- هذا الفهرس بفهرس على `json_extract(params,'$.from')` و`json_extract(params,'$.to')`.
CREATE UNIQUE INDEX report_snapshots_e01_one_approved_per_period
  ON report_snapshots(tenant_id,report_key,params)
  WHERE report_key='E01' AND status='approved';
