import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { can } from './access.mjs';
import { currentUser } from './delegations.mjs';
import { riyadhDayRange } from './riyadh-time.mjs';
import { setGapRegistry, figure, unavailable, unmeasurable, group, section, coverage, assertSourced } from './report-figures.mjs';
import * as projectAxes from './project-axes.mjs';
import * as pipelineEstimates from './pipeline-estimates.mjs';

// تقرير الإدارة التنفيذية للمشاريع (EPMO): الكتالوج وأفعال السجلّات. الترحيل: app/migrations/118-epmo-report.sql
//
// هذه المرحلة تبني ما تحت التقرير لا التقرير نفسه: أقسامه ومصادرها، وكتالوج فجواته المعلنة،
// وأفعال السجلّات الثلاثة (تعليق القسم، خطة إغلاق الفجوة، طلب القرار). التركيب في مرحلة تالية.
//
// نطاقه إدارة واحدة عمدًا. EPMO تقرأ ما سجّلته الإدارات في مواضعه، وتكتب تعليقها وفجواتها وأسئلتها.
// ما لا تملكه المنصة اليوم لا يُفتح له نموذج عند إدارة أخرى: يُعلَن فجوةً باسم إدارته ويُتابَع هنا.
// إضافة شاشة أو حقل أو واجب إدخال على الحسابات أو المالية أو تطوير الأعمال أو الموارد البشرية
// خروجٌ عن هذا النطاق، مهما بدا صغيرًا.
//
// التصاريح: `epmo.review` تكتب، و`executive.view` تقرأ. لا تصريح جديد في هذه المرحلة.

/* ───── الأقسام الاثنا عشر، وقسم القراءة البشرية ───── */
// لكل قسم مصدره المسمّى في المنصة. قسم بلا مصدر لا يدخل التقرير، لأنه سيُملأ حينها بالتقدير.
// `commentary` وحده بشري: هو موضع الجملة التي تقرأ الأرقام، ولذلك `human:true` ولا مصدر له.
export const SECTIONS = [
  { key: 'portfolio', name: 'محفظة المشاريع', source: 'projects + commercial_cases + project_axis_events' },
  { key: 'blockers', name: 'المعوّقات والتصعيد', source: 'tasks + project_execution_states + requests' },
  { key: 'objectives', name: 'الأهداف والمبادرات', source: 'governance_objectives + governance_initiatives' },
  { key: 'risks', name: 'المخاطر', source: 'governance_risks' },
  { key: 'services', name: 'الخدمات وأزمنتها', source: 'requests + service_directory' },
  { key: 'pipeline', name: 'خط الفرص', source: 'opportunities + commercial_cases' },
  { key: 'receivables', name: 'مستحقات العملاء', source: 'ar_claims + ar_receipts + ar_disputes' },
  { key: 'profitability', name: 'الربحية', source: 'timesheet_entries + category_cost_rates + ar_claims' },
  { key: 'resourcing', name: 'الموارد والسعة', source: 'resource_capacity + resource_bookings + timesheet_entries' },
  { key: 'workforce', name: 'القوى العاملة', source: 'users + employee_profiles + employee_demographics + employee_changes' },
  { key: 'decisions', name: 'القرارات والالتزامات', source: 'governance_decisions + governance_minutes' },
  { key: 'gaps', name: 'الفجوات المعلنة', source: 'MEASUREMENT_GAPS + epmo_gap_plans' },
  { key: 'commentary', name: 'قراءة الإدارة التنفيذية للمشاريع', source: 'epmo_section_notes', human: true }
];
export const SECTION_KEYS = SECTIONS.map(s => s.key);
const sectionByKey = new Map(SECTIONS.map(s => [s.key, s]));

/* ───── كتالوج الفجوات المعلنة ───── */
// ثابت في الشيفرة لا صفوف في جدول، على سابقة AXES في app/project-axes.mjs. السبب ليس تقنيًا:
// ما يُبذر في جدول يُحذف منه، وفجوة يمكن تعديلها إلى العدم ليست فجوة وإنما تذكير. الاعتراف بأن
// رقمًا لا يُقاس يجب أن يكلّف نشر شيفرة، لا ضغطة زر في شاشة.
//
// الجدول (epmo_gap_plans) يحمل **خطة الإغلاق** لا التصريح بالفجوة: من تسلّمها، ومتى وعد، وبأي دليل
// أُغلقت، أو بأي سبب رُفض قياسها. والفجوة بلا صفّ خطةٍ حالتها «معلنة» ولا تختفي بغياب الصف.
//
// كل مدخل يجيب أربعة أسئلة بلا مواربة: ما الذي لا يُقاس، ولماذا (أي سجل غير موجود)، وما الذي يلزم
// لقياسه، وعلى أي إدارة يقع. `department_id` فارغ حين لا تملكها إدارة واحدة بعينها.
export const MEASUREMENT_GAPS = [
  /* — محفظة المشاريع وتنفيذها — */
  { key: 'project_percent_complete', department: 'الإدارة التنفيذية للمشاريع', department_id: 'epmo',
    statement: 'نسبة إنجاز المشروع غير قابلة للقياس.',
    why: 'لا سجل وزن ولا قيمة مكتسبة لأي مشروع. الموجود وحده نسبة عدد المهام المكتملة إلى عددها الكلي في تقرير R11، وهي تحمل تنبيهها بنفسها: «الإنجاز بعدد المهام لا بوزنها؛ لا مراحل ولا معالم بعد». مهمة يوم ومهمة شهر تتساويان فيها.',
    needed: 'وزن معلن لكل حزمة عمل أو معلم (ساعات مخططة أو قيمة عقدية)، ونسبة تُحسب من الأوزان المنجزة لا من عدد الصفوف.' },
  { key: 'schedule_baseline_variance', department: 'الإدارة التنفيذية للمشاريع', department_id: 'epmo',
    statement: 'الانحراف الزمني عن الخطة الأصلية غير قابل للقياس.',
    why: 'لا خط أساس زمني محفوظ يُقارن به الفعلي. `work_packages` تحمل `planned_start` و`planned_end` قابلين للتعديل، فما يُقرأ اليوم هو آخر خطة لا أولها، ومقارنة الخطة بنفسها بعد تحريكها لا تكشف تأخرًا.',
    needed: 'تجميد خط أساس عند اعتماد الخطة، وحفظ كل إعادة جدولة بسببها ومن أقرّها، ثم قياس الفعلي على الأساس المجمَّد.' },
  { key: 'milestone_records', department: 'الإدارة التنفيذية للمشاريع', department_id: 'epmo',
    statement: 'المعالم الرئيسية للمشاريع غير قابلة للقياس: لا عددها المستحق ولا ما أُنجز منه في موعده.',
    why: 'لا كيان «معلم» في المنصة أصلًا. ما يقاربه `work_packages` و`tasks`، وكلاهما وحدة عمل لا نقطة التزام أمام العميل، ولا يحمل موعدًا متعاقدًا عليه.',
    needed: 'سجل معالم لكل مشروع بتاريخه المتعاقد عليه ومخرجه ودليل بلوغه، مربوط بحزم العمل التي تؤدي إليه.' },
  { key: 'risk_coverage', department: 'الإدارة التنفيذية للمشاريع', department_id: 'epmo',
    statement: 'تغطية المشاريع بالمخاطر غير قابلة للقياس: كم مشروعًا يسير بلا خطر مسجل واحد.',
    why: 'الربط نفسه **موجود** (`governance_risks.link_type=\'project\'` مع `link_id`)، والناقص استعماله: لا قاعدة تُلزم مشروعًا بمراجعة مخاطر، ولا سجل يقول «رُوجعت مخاطر هذا المشروع في هذا التاريخ فلم يُوجد خطر». فصفر المخاطر لا يُفرَّق فيه بين مشروع آمن ومشروع لم ينظر أحد في مخاطره.',
    needed: 'تسجيل مراجعة مخاطر لكل مشروع بتاريخها ومن أجراها، فيصير غياب الخطر نتيجةً معلنة لا فراغًا، وتُحسب التغطية على المراجعات لا على الربط.' },
  { key: 'unrecorded_capacity', department: 'الإدارة التنفيذية للمشاريع', department_id: 'epmo',
    statement: 'سعة الفريق غير مكتملة: نسبة التحميل غير قابلة للقياس لمن لا سعة مسجلة له.',
    why: 'السعة تُقرأ من `resource_capacity` بدقائق يومية يسجّلها مسؤول، ومن لا صفّ له تعود سعته `null` لا صفرًا (app/resourcing.mjs). فمجموع سعة الشركة ناقص بمقدار من لم يُسجَّلوا، ونسبة التحميل عليه تكون قسمة على مجهول.',
    needed: 'سعة يومية مسجلة لكل حساب نشط بمصدرها (عقد العمل أو قرار الدوام)، أو إعلان صريح بأن هذا الحساب خارج الطاقة القابلة للتحميل.' },
  /* — الخدمات — */
  { key: 'service_target_time', department: 'الإدارة المالكة لكل خدمة', department_id: '',
    statement: 'الالتزام بالزمن المستهدف غير قابل للقياس في الخدمات التي لا مستهدف معتمدًا لها.',
    why: 'الزمن المستهدف حقل في `service_directory` يعتمده صاحب الإجراء لكل خدمة، وما لم يُعتمد يبقى فارغًا. تقرير R07 يكتب في عمود «ضمن المستهدف» شرطةً لهذه الخدمات، والشرطة ليست التزامًا ولا إخلالًا.',
    needed: 'زمن مستهدف معتمد لكل خدمة من إدارتها المالكة بسنده، أو تصريح مكتوب بأن هذه الخدمة بلا زمن ملزم ولماذا.' },
  /* — التجاري والمالي — */
  { key: 'pipeline_reconciliation', department: 'إدارة الأعمال', department_id: 'business-dev',
    statement: 'قيمة خط الفرص غير قابلة للقياس على رقم واحد: في المنصة خطان لا يتطابقان.',
    why: 'الفرص تُسجَّل في `opportunities` بمراحلها واحتمالاتها (app/pipeline-estimates.mjs)، والملفات التجارية تُسجَّل في `commercial_cases` بحالاتها العشر (app/commercial.mjs)، ولا مفتاح يربط الصفَّين ولا قاعدة تقول أيهما المصدر. فرصة واحدة قد تظهر في الاثنين أو في أحدهما، فيصير الجمع ازدواجًا والطرح إسقاطًا.',
    needed: 'قرار مكتوب بأي السجلين مصدر قيمة الخط، وربط إلزامي بين الفرصة وملفها التجاري عند التأهيل، وتسوية للأرصدة القائمة قبل أول تقرير يجمعها.' },
  { key: 'revenue_target', department: 'المالية', department_id: 'finance',
    statement: 'الأداء مقابل مستهدف الإيراد غير قابل للقياس.',
    why: 'لا سجل مستهدف إيراد في المنصة: لا سنويًا ولا ربعيًا ولا لإدارة ولا لعميل. `project_budgets` سقوف إنفاق لا مستهدفات إيراد، والاثنان لا يُقرأ أحدهما مكان الآخر.',
    needed: 'مستهدف إيراد معتمد للفترة بمستواه (شركة أو إدارة أو عميل) ومن أقرّه ومتى، ليُقارَن به المحصَّل والمفوتر.' },
  { key: 'receivable_delay_reason', department: 'المالية', department_id: 'finance',
    statement: 'أسباب تأخر التحصيل غير قابلة للقياس: لا يُعرف كم من المتأخر سببه خلافٌ وكم سببه بطء إجراء وكم سببه عجز عميل.',
    why: '`ar_disputes` تسجّل النزاع المعلن وحده، وهو حالة واحدة. المتأخر الذي لا نزاع عليه يظهر في R31 شريحةً زمنية بلا سبب، فلا يُفرَّق فيه بين ما يُعالَج بمكالمة وما يحتاج قرارًا.',
    needed: 'سبب مصنَّف لكل استحقاق يتجاوز موعده، يسجّله المسؤول عن التحصيل بتاريخه، ويُغلق حين يُسدَّد أو يتغير سببه.' },
  { key: 'days_to_collect', department: 'المالية', department_id: 'finance',
    statement: 'متوسط أيام التحصيل غير قابل للقياس.',
    why: 'يلزم لقياسه طرفان: تاريخ مطالبة العميل، وتاريخ وصول النقد. الطرف الثاني موجود (`ar_receipts.received_on` بعد تأكيده)، والأول غائب: `ar_claims.created_at` لحظة تسجيل داخلي لا تاريخ إرسال المطالبة، ولا قاعدة معلنة لاحتساب المقبوضات الجزئية على مطالبة واحدة.',
    needed: 'تاريخ إرسال المطالبة إلى العميل محفوظًا في السجل، وقاعدة معلنة للمقبوض الجزئي (بالمرجَّح أم بآخر دفعة)، ثم يُحسب المتوسط على المطالبات المسدَّدة كاملةً في الفترة.' },
  { key: 'uncosted_minutes', department: 'المالية', department_id: 'finance',
    statement: 'الربحية ناقصة: الدقائق المسجَّلة على فئات وظيفية بلا معدل تكلفة معتمد لا تدخل حساب التكلفة.',
    why: 'التكلفة تُقرأ من `category_cost_rates` بحالة `approved` سارية في تاريخ العمل (app/profitability.mjs). الساعة المسجَّلة على فئة بلا معدل تعود تكلفتها `null`، والهامش عليها لا يُحسب — وهذا صواب، لكنه يعني أن رقم الربحية مبني على جزء من العمل لا كله.',
    needed: 'معدل تكلفة معتمد وسارٍ لكل فئة وظيفية يُسجَّل عليها وقت، أو إعلان الدقائق غير المسعّرة رقمًا ظاهرًا بجانب كل هامش.' },
  /* — القوى العاملة — */
  { key: 'nitaqat_band', department: 'رأس المال البشري', department_id: 'hr',
    statement: 'نطاق المنشأة في برنامج نطاقات ولونه ومستوى امتثاله غير قابل للقياس.',
    why: 'المنصة تحسب نسبة السعوديين من سجلاتها وحدها ولا تصنّف نطاقًا عمدًا: معادلة التصنيف نظامية متغيّرة بحسب النشاط وحجم المنشأة، ونصها ليس في المنصة. أي لون يُكتب هنا ادعاء لا قياس (app/workforce.mjs).',
    needed: 'قراءة النطاق من حساب المنشأة لدى الجهة، مسجَّلة بتاريخها ومن اطّلع عليها، تُعرض مصدرًا خارجيًا لا حسابًا داخليًا.' },
  { key: 'gosi_employer_share', department: 'رأس المال البشري', department_id: 'hr',
    statement: 'حصة المنشأة في التأمينات الاجتماعية غير قابلة للقياس، فتكلفة التوظيف الكاملة غير معروفة.',
    why: 'لا سجل لحصة صاحب العمل ولا لنِسبها المطبَّقة على كل موظف. ما في المنصة بنود الراتب المستحقة للموظف، وحصة المنشأة التزام عليها لا بند له.',
    needed: 'نسب الاشتراك المطبَّقة بمصدرها وتاريخ سريانها، وأساس الاحتساب لكل موظف، فتُحسب الحصة شهريًا وتُضاف إلى تكلفة التوظيف.' },
  { key: 'turnover_rate', department: 'رأس المال البشري', department_id: 'hr',
    statement: 'الدوران الإرادي — الرقم الذي تتصرف عليه القيادة — غير قابل للقياس، ومعدل الدوران العام محسوب على جزء من الحسابات لا عليها كلها.',
    why: 'المعدل العام **يُحسب** فعلًا (`movement.turnover_bp` في app/workforce.mjs: المغادرون ÷ متوسط العدد أول الفترة وآخرها)، لكنه مقيَّد بمن له ملف موظف بتاريخ التحاق، واللوحة تعلن عدد من لا ملف لهم (`without_profile`) صراحةً. والأهم أن المغادرة تُقرأ من تغيير حالة في `employee_changes` بلا تصنيف سبب، فلا يُفرَّق بين استقالة وإنهاء عقد وانتهاء مدة.',
    needed: 'ملف بتاريخ التحاق لكل حساب نشط حتى يكتمل المقام، وتصنيف معلن لسبب كل مغادرة، فيُفصل الدوران الإرادي عن غيره بدل معدل واحد يخلط الثلاثة.' },
  { key: 'time_to_hire', department: 'رأس المال البشري', department_id: 'hr',
    statement: 'زمن شغل الوظيفة الشاغرة غير قابل للقياس.',
    why: 'لا سجل طلب توظيف بتاريخ اعتماده وتاريخ قبول المرشح: الاحتياج الوظيفي يُقدَّم خدمةً في الكتالوج (`HR-HIRING-NEED`) فيُحفظ طلبًا لا شاغرًا مفتوحًا، ولا كيان يربطه بالحساب الذي فُتح في النهاية.',
    needed: 'شاغر بمعرّفه من اعتماد الاحتياج إلى مباشرة الموظف، بمراحله وتواريخها، فيُقاس الزمن على الشاغر لا على الطلب.' },
  { key: 'training_cost', department: 'رأس المال البشري', department_id: 'hr',
    statement: 'الإنفاق على التدريب وأثره غير قابلين للقياس.',
    why: 'التدريب يُطلب خدمةً (`TAL-TRAINING`) وتُكتب تكلفته حقلًا نصيًا اختياريًا في الطلب، ولا تُقيَّد مصروفًا مرتبطًا بالموظف ولا ببرنامج. فلا مجموع للإنفاق ولا نصيب موظف ولا ربط بالتقييم بعده.',
    needed: 'قيد مصروف لكل برنامج تدريبي مربوط بمتدربيه وبمصدر تمويله، وتاريخ إتمام موثق، ليُجمع الإنفاق ويُقاس ما بعده.' },
  { key: 'unrecorded_nationality', department: 'رأس المال البشري', department_id: 'hr',
    statement: 'نسبة السعودة محسوبة على جزء من الحسابات النشطة لا عليها كلها.',
    why: 'الجنسية سجل اختياري (`employee_demographics`) يسجّله موظف الموارد البشرية من وثيقة، ومن لا صفّ له لا يدخل البسط ولا المقام. اللوحة تعلن عدد غير المسجَّلين صراحةً (`unrecorded` في app/workforce.mjs)، فالنسبة صحيحة على ما قِيس، ناقصة عن الشركة.',
    needed: 'تسجيل الجنسية لكل حساب نشط من وثيقته، أو إعلان النسبة مقيَّدة بعدد من قِيسوا في كل موضع تُعرض فيه.' }
];
export const GAP_KEYS = MEASUREMENT_GAPS.map(g => g.key);
const gapByKey = new Map(MEASUREMENT_GAPS.map(g => [g.key, g]));
// تثبيت السجل عند تحميل الوحدة: بعده يصير مفتاح فجوة غير مسجَّل خطأً يوقف توليد أي تقرير، ولا يمر
// فراغ يشير إلى فجوة لا يتابعها أحد. هذا هو العقد الذي تركته المرحلة الأولى مفتوحًا (report-figures.mjs).
export const GAP_REGISTRY = setGapRegistry(GAP_KEYS);

/* ───── أدوات ───── */
const id = () => randomUUID();
const WRITE = 'epmo.review';
const READ = 'executive.view';
function writing(db) { if (!db.isTransaction) fail(500, 'transaction_required', 'تتطلب كتابة سجلّات تقرير EPMO معاملة قاعدة بيانات'); }
function actor(db, supplied) { const u = currentUser(db, supplied); if (!u) fail(403, 'forbidden', 'الحساب غير متاح أو موقوف. سجّل الدخول من جديد، أو راجع مسؤول المنصة'); return u; }
// القراءة لمن يُعِدّ التقرير ولمن يقرؤه. الكتابة لمن يُعِدّه وحده: التنفيذي يقرأ ويقرر، ولا يكتب تعليق الإدارة عنها.
export const canPrepare = (db, u) => can(db, u, WRITE);
export const canRead = (db, u) => can(db, u, WRITE) || can(db, u, READ);
function preparer(db, supplied) {
  const u = actor(db, supplied);
  if (!canPrepare(db, u)) fail(403, 'not_permitted', 'إعداد تقرير الإدارة التنفيذية للمشاريع لحامل تصريح «اعتماد مكتب إدارة المشاريع المؤسسي (EPMO)»');
  return u;
}
function reader(db, supplied) {
  const u = actor(db, supplied);
  if (!canRead(db, u)) fail(403, 'not_permitted', 'تقرير الإدارة التنفيذية للمشاريع لمُعِدّه ولحامل تصريح اللوحة التنفيذية');
  return u;
}
export function period(input) {
  const from = v.date(input?.period_from), to = v.date(input?.period_to);
  if (to < from) fail(400, 'date_order', 'نهاية الفترة تسبق بدايتها. صحّح التاريخين وأعد تشغيل التقرير');
  return { from, to };
}
function sectionKey(value) {
  if (typeof value !== 'string' || !sectionByKey.has(value)) fail(400, 'section_key', `القسم غير معروف. أقسام التقرير: ${SECTION_KEYS.join('، ')}`);
  return value;
}
// المفتاح يُطابَق بالكتالوج قبل أي كتابة: خطة لفجوة غير معلنة خطة لشيء لا يعرفه أحد.
export function gapDefinition(key) {
  const gap = typeof key === 'string' && gapByKey.get(key);
  if (!gap) fail(404, 'gap_unknown', `مفتاح فجوة غير مسجَّل في كتالوج الفجوات المعلنة: ${String(key).slice(0, 60)}`);
  return gap;
}
const person = (db, userId) => userId ? db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name ?? '' : '';
const planOf = (db, u, key) => db.prepare('SELECT * FROM epmo_gap_plans WHERE tenant_id=? AND gap_key=?').get(u.tenant_id, key) ?? null;
// الفجوة بلا صفّ خطة حالتها «معلنة»: غياب الصف لا يعني غياب الفجوة، ولذلك تُركَّب الحالة هنا لا في استعلام.
// `prepare` يفصل ما تسمح به الحالة عمّا يسمح به التصريح: القارئ يرى الفجوة كاملةً بحالتها ومالكها
// ودليلها، ولا تُعرض عليه أفعال لا يملكها. الخادم يرفضها على أي حال، والعرض لا يعد بما سيُرفض.
export function gapRow(db, u, gap, prepare = true) {
  const plan = planOf(db, u, gap.key);
  const byState = plan && ['closed', 'refused'].includes(plan.status) ? ['reopen_gap'] : ['own_gap', 'close_gap', 'refuse_gap'];
  return { ...gap, status: plan?.status ?? 'declared', status_name: GAP_STATUS[plan?.status ?? 'declared'],
    owner_id: plan?.owner_id ?? null, owner_name: person(db, plan?.owner_id), target_on: plan?.target_on ?? null,
    decision_note: plan?.decision_note ?? '', closed_evidence: plan?.closed_evidence ?? '',
    version: plan?.version ?? 0, updated_by_name: person(db, plan?.updated_by), updated_at: plan?.updated_at ?? '',
    actions: prepare ? byState : [] };
}
export const GAP_STATUS = { declared: 'معلنة بلا مالك', owned: 'مُسنَدة بمالك وتاريخ', closed: 'أُغلقت بدليل', refused: 'رُفض قياسها بسبب معلن' };
export const REQUEST_STATUS = { open: 'مفتوح', decided: 'مقرَّر', withdrawn: 'مسحوب' };

/* ───── 1. تعليق الإدارة على القسم ───── */
// فعل واحد يكتب ويصحّح: أول تعليق للفترة والقسم يُنشأ، وما بعده نسخة تالية بنسخته السابقة.
// لا نسخة ثانية لقسم في فترة واحدة (قيد فريد في الترحيل)، حتى لا يظهر للتنفيذي رأيان بلا ترتيب.
export function epmoNoteAction(db, supplied, input) {
  writing(db);
  const u = preparer(db, supplied);
  v.object(input, ['period_from', 'period_to', 'section_key', 'body', 'version']);
  const p = period(input), key = sectionKey(input.section_key);
  const body = v.text(input.body, 'قراءة الإدارة لهذا القسم', 8000, 20);
  const time = now();
  const existing = db.prepare('SELECT * FROM epmo_section_notes WHERE tenant_id=? AND period_from=? AND period_to=? AND section_key=?').get(u.tenant_id, p.from, p.to, key);
  if (!existing) {
    if (input.version !== undefined) v.version(input.version, 0);
    const noteId = id();
    db.prepare('INSERT INTO epmo_section_notes(id,tenant_id,period_from,period_to,section_key,body,written_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,1)')
      .run(noteId, u.tenant_id, p.from, p.to, key, body, u.id, time, time);
    audit(db, u, 'epmo_note', noteId, 'epmo.note_written', {}, { section: key, ...p });
    return { id: noteId, section_key: key, version: 1, created: true };
  }
  v.version(input.version, existing.version);
  db.prepare('UPDATE epmo_section_notes SET body=?,written_by=?,updated_at=?,version=? WHERE id=?')
    .run(body, u.id, time, existing.version + 1, existing.id);
  audit(db, u, 'epmo_note', existing.id, 'epmo.note_revised', { body: existing.body }, { section: key, ...p });
  return { id: existing.id, section_key: key, version: existing.version + 1, created: false };
}

/* ───── 2. خطة إغلاق الفجوة ───── */
// أربعة أفعال، وكل واحد يكتب ما يُلزمه القيد في قاعدة البيانات. الشيفرة ترفض قبل القيد لتقول السبب
// بالعربية، والقيد يرفض بعدها ليقطع الطريق على أي مسار آخر يظن أنه يعرف أفضل.
const GAP_ACTIONS = { own_gap: 'إسناد الفجوة', close_gap: 'إغلاق الفجوة بدليل', refuse_gap: 'رفض قياسها بسبب', reopen_gap: 'إعادة فتح الفجوة' };
export function gapAction(db, supplied, gapKey, action, input) {
  writing(db);
  const u = preparer(db, supplied);
  if (!Object.hasOwn(GAP_ACTIONS, action)) fail(404, 'not_found', 'الإجراء غير متاح على خطة الفجوة');
  const gap = gapDefinition(gapKey), plan = planOf(db, u, gap.key), current = plan?.status ?? 'declared';
  const row = gapRow(db, u, gap);
  if (!row.actions.includes(action)) v.actionUnavailable(action, { subject: `الفجوة «${gap.statement}»`, state_name: GAP_STATUS[current],
    reason: 'الفجوة المغلقة أو المرفوضة تُعاد فتحها أولًا قبل أي إسناد جديد', available: row.actions, names: GAP_ACTIONS });
  v.object(input, ['owner_id', 'target_on', 'evidence', 'reason', 'note', 'version']);
  v.version(input.version, plan?.version ?? 0);
  const time = now();
  const next = { owner_id: plan?.owner_id ?? null, target_on: plan?.target_on ?? null, status: current,
    decision_note: plan?.decision_note ?? '', closed_evidence: plan?.closed_evidence ?? '' };

  if (action === 'own_gap') {
    // المالك حساب نشط في الشركة، والتاريخ تاريخ. القيد في الترحيل يرفض «مُسنَدة» بلا الاثنين، والرسالة هنا تقول لماذا.
    const owner = typeof input.owner_id === 'string' && db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id, u.tenant_id);
    if (!owner) fail(400, 'owner_required', 'إسناد الفجوة يحتاج مالكًا: حسابًا نشطًا يتسلّمها. نية بلا اسم ليست إسنادًا');
    next.owner_id = owner.id;
    next.target_on = v.date(input.target_on);
    next.status = 'owned';
    next.decision_note = input.note ? v.text(input.note, 'ملاحظة الإسناد', 2000, 0) : next.decision_note;
  } else if (action === 'close_gap') {
    // «تم» ليست دليلًا. الدليل يسمّي ما الذي صار يُقاس وبأي سجل صار كذلك.
    next.closed_evidence = v.text(input.evidence, 'ما الذي جعل هذا البند قابلًا للقياس', 4000, 10);
    next.status = 'closed';
  } else if (action === 'refuse_gap') {
    // الرفض المعلن أشرف من فجوة تُنسى: قرار بألّا يُقاس هذا البند، باسم من قرره وسببه.
    next.decision_note = v.text(input.reason, 'سبب رفض قياس هذا البند', 4000, 10);
    next.status = 'refused';
    next.closed_evidence = '';
  } else {
    // إعادة الفتح تُعيد الفجوة «معلنة» وتمسح دليل الإغلاق، وتحفظ سبب إعادة الفتح مكان قرار الرفض:
    // ما صار غير مقيس مرة أخرى لا يبقى عليه وسام «أُغلق».
    next.decision_note = v.text(input.reason, 'سبب إعادة فتح الفجوة', 4000, 10);
    next.status = 'declared';
    next.closed_evidence = '';
    next.owner_id = null;
    next.target_on = null;
  }
  if (!plan) {
    db.prepare('INSERT INTO epmo_gap_plans(tenant_id,gap_key,owner_id,target_on,status,decision_note,closed_evidence,version,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)')
      .run(u.tenant_id, gap.key, next.owner_id, next.target_on, next.status, next.decision_note, next.closed_evidence, u.id, time);
  } else {
    db.prepare('UPDATE epmo_gap_plans SET owner_id=?,target_on=?,status=?,decision_note=?,closed_evidence=?,version=?,updated_by=?,updated_at=? WHERE tenant_id=? AND gap_key=?')
      .run(next.owner_id, next.target_on, next.status, next.decision_note, next.closed_evidence, plan.version + 1, u.id, time, u.tenant_id, gap.key);
  }
  audit(db, u, 'epmo_gap', gap.key, `epmo.${action}`, { status: current }, { status: next.status, owner_id: next.owner_id, target_on: next.target_on });
  return { gap_key: gap.key, status: next.status, status_name: GAP_STATUS[next.status], version: (plan?.version ?? 0) + 1 };
}

/* ───── 3. ما يُوضع أمام التنفيذيين ───── */
// طلب القرار سؤال محدد بخياراته وأثر تأجيله. خياران على الأقل: سؤال بخيار واحد ليس سؤالًا.
export function requestDecision(db, supplied, input) {
  writing(db);
  const u = preparer(db, supplied);
  v.object(input, ['period_from', 'period_to', 'section_key', 'title', 'asked', 'options', 'consequence_of_delay']);
  const p = period(input), key = sectionKey(input.section_key);
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 8) fail(400, 'options', 'اكتب خيارين إلى ثمانية. سؤال بخيار واحد ليس سؤالًا وإنما إبلاغ');
  const options = input.options.map((option, i) => v.text(option, `الخيار ${i + 1}`, 1000, 5));
  const requestId = id(), time = now();
  db.prepare('INSERT INTO epmo_decision_requests(id,tenant_id,period_from,period_to,section_key,title,asked,options,consequence_of_delay,status,decision_id,withdrawn_reason,raised_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,\'open\',NULL,\'\',?,?,?,1)')
    .run(requestId, u.tenant_id, p.from, p.to, key, v.text(input.title, 'عنوان الطلب', 300, 5),
      v.text(input.asked, 'ما المطلوب البتّ فيه بالضبط', 4000, 20), JSON.stringify(options),
      v.text(input.consequence_of_delay, 'أثر تأجيل القرار', 2000, 10), u.id, time, time);
  audit(db, u, 'epmo_decision_request', requestId, 'epmo.decision_requested', {}, { section: key, ...p });
  return { id: requestId };
}
const REQUEST_ACTIONS = { link_decision: 'ربط القرار الصادر', withdraw_request: 'سحب الطلب' };
export function decisionRequestAction(db, supplied, requestId, action, input) {
  writing(db);
  const u = preparer(db, supplied);
  if (!Object.hasOwn(REQUEST_ACTIONS, action)) fail(404, 'not_found', 'الإجراء غير متاح على طلب القرار');
  const r = typeof requestId === 'string' && db.prepare('SELECT * FROM epmo_decision_requests WHERE id=? AND tenant_id=?').get(requestId, u.tenant_id);
  if (!r) fail(404, 'not_found', 'طلب القرار غير موجود في كيانك أو حُسم من قبل. افتح «تقرير الإدارة التنفيذية للمشاريع» لترى القائمة الحالية');
  if (r.status !== 'open') v.actionUnavailable(action, { subject: `طلب القرار «${r.title}»`, state_name: REQUEST_STATUS[r.status],
    reason: 'الطلب المقرَّر أو المسحوب لا يُغيَّر: القرار يُراجَع في سجل القرارات', available: [], names: REQUEST_ACTIONS });
  v.object(input, ['decision_id', 'reason', 'version']);
  v.version(input.version, r.version);
  const time = now();
  if (action === 'link_decision') {
    // القرار يُقرأ من سجله القائم ولا يُكتب هنا ثانيةً: نصّه وبدائله وأثره ومن قرره كلها هناك.
    const decision = typeof input.decision_id === 'string' && db.prepare('SELECT id,title FROM governance_decisions WHERE id=? AND tenant_id=?').get(input.decision_id, u.tenant_id);
    if (!decision) fail(404, 'decision_not_found', 'القرار غير موجود في سجل القرارات. يُسجَّل القرار هناك أولًا ثم يُربط هنا');
    db.prepare("UPDATE epmo_decision_requests SET status='decided',decision_id=?,updated_at=?,version=? WHERE id=?").run(decision.id, time, r.version + 1, r.id);
    audit(db, u, 'epmo_decision_request', r.id, 'epmo.decision_linked', { status: r.status }, { decision_id: decision.id });
    return { id: r.id, status: 'decided', decision_id: decision.id, version: r.version + 1 };
  }
  const reason = v.text(input.reason, 'سبب سحب الطلب', 2000, 10);
  db.prepare("UPDATE epmo_decision_requests SET status='withdrawn',withdrawn_reason=?,updated_at=?,version=? WHERE id=?").run(reason, time, r.version + 1, r.id);
  audit(db, u, 'epmo_decision_request', r.id, 'epmo.request_withdrawn', { status: r.status }, { reason });
  return { id: r.id, status: 'withdrawn', version: r.version + 1 };
}

/* ───── قراءات مشتركة تستعملها اللوحة ───── */
export const gapsRegister = (db, u, prepare = true) => MEASUREMENT_GAPS.map(gap => gapRow(db, u, gap, prepare));
export function sectionNotes(db, u, p) {
  return db.prepare('SELECT n.*,w.name AS written_by_name FROM epmo_section_notes n JOIN users w ON w.id=n.written_by WHERE n.tenant_id=? AND n.period_from=? AND n.period_to=? ORDER BY n.section_key')
    .all(u.tenant_id, p.from, p.to).map(n => ({ ...n, section_name: sectionByKey.get(n.section_key)?.name ?? n.section_key }));
}
export function decisionRequests(db, u, statuses = ['open'], prepare = true) {
  const marks = statuses.map(() => '?').join(',');
  return db.prepare(`SELECT r.*,x.name AS raised_by_name,d.title AS decision_title,d.decided_on FROM epmo_decision_requests r JOIN users x ON x.id=r.raised_by LEFT JOIN governance_decisions d ON d.id=r.decision_id WHERE r.tenant_id=? AND r.status IN (${marks}) ORDER BY r.period_to DESC,r.created_at DESC LIMIT 200`)
    .all(u.tenant_id, ...statuses)
    .map(r => ({ ...r, options: JSON.parse(r.options), status_name: REQUEST_STATUS[r.status],
      section_name: sectionByKey.get(r.section_key)?.name ?? r.section_key,
      actions: prepare && r.status === 'open' ? ['link_decision', 'withdraw_request'] : [] }));
}
export { reader as epmoReader };

/* ═════ 4. التقرير المركّب E01 ═════ */
// الأقسام تُركَّب من سجلات المنصة نفسها، بندًا بندًا، بأولية المرحلة الأولى (app/report-figures.mjs):
// إمّا `figure` برقمه ومصدره وتاريخه، وإمّا `unavailable` لغياب قيد في فترة، وإمّا `unmeasurable`
// لغياب السجل من المنصة أصلًا — وكل `unmeasurable` بمفتاح فجوة مسجَّل في الكتالوج أعلاه.
//
// ما لا يُبنى في هذه المرحلة يُعلَن فجوةً باسمه لا يُملأ بتقدير: الخدمات ومستحقات العملاء والربحية
// والموارد والقوى العاملة أقسام معلنة بفجواتها، وهذه هي حالتها الصادقة اليوم لا حشوٌ مكان بناء.
//
// ولا نسبة إنجاز في أي قسم: قسم الأهداف يذكر الفجوة بوحدة المؤشر نفسها كما يفعل سجل الحوكمة
// (app/governance.mjs)، والمؤشر بلا قياس `unavailable` لا صفر — الصفر قياسٌ لم يقله أحد.

const day = stamp => typeof stamp === 'string' && stamp.length >= 10 ? stamp.slice(0, 10) : '';
const countOf = (db, sql, ...args) => Number(db.prepare(sql).get(...args)?.n ?? 0);
const sourceOf = key => sectionByKey.get(key).source;
const nameOf = key => sectionByKey.get(key).name;

// محوّلا الفرعين المتوازيين. `executiveAxesBoard` في app/project-axes.mjs و`portfolioForecast` في
// app/pipeline-estimates.mjs يصلان مع فرع «النطاق التنفيذي»، ولم يُدمج بعد ولا يُعدَّل هذان الملفان هنا.
// حتى ذلك الحين: القسمان يخرجان فراغًا مصرَّحًا به يسمّي سبب الفراغ، **لا رقمًا مخترعًا ولا صفرًا**.
// وحين يصل التصدير يُقرأ منه، وإن اختلف شكله عمّا هو موصوف هنا بقي الفراغ — السقوط إلى ناحية الصمت
// المعلن لا إلى ناحية رقم خاطئ. (راجع docs/implementation/handoff/epmo-report.md عند الدمج.)
export const reportSources = () => ({
  executiveAxesBoard: typeof projectAxes.executiveAxesBoard === 'function' ? projectAxes.executiveAxesBoard : null,
  portfolioForecast: typeof pipelineEstimates.portfolioForecast === 'function' ? pipelineEstimates.portfolioForecast : null
});
const BRANCH_PENDING = 'فرع «النطاق التنفيذي» لم يُدمج بعد، فالقراءة التي يصدّرها غير متاحة في هذا الإصدار.';
// بعد دمج «النطاق التنفيذي» (22 سبتمبر 2026): الدالتان تفتحان نطاق الكيان لحامل executive.view وحده وترفضان غيره بـ403،
// والمحوّل لا يبتلع أخطاء، فكان رفضهما يُسقط التقرير كله عند مُعِدّ يحمل epmo.review وحده. القرار (ملف التسليم §5/2):
// يُحصر النداء بحامل التصريح، ويبقى القسم لغيره فراغًا معلنًا يسمّي التصريح ومن يمنحه — لا رقمًا من مصدر ثانٍ.
const ENTITY_SCOPE = 'executive.view';
const SCOPE_MISSING = 'قراءة نطاق الكيان لحامل تصريح «اللوحة التنفيذية» وحده، ومن أُعدّ له هذا التقرير لا يحمله.';
const SCOPE_NEEDED = 'أن يمنح الأدمن الأول مُعِدَّ التقرير تصريح «اللوحة التنفيذية» من «الحسابات والتصاريح» بقرار المالك، فيُقرأ هذا القسم بأرقامه.';

function portfolioSection(db, u, p, sources) {
  const source = sourceOf('portfolio'), figures = [];
  const entitled = can(db, u, ENTITY_SCOPE);
  const board = sources.executiveAxesBoard && entitled ? sources.executiveAxesBoard(db, u, p) : null;
  const projects = Array.isArray(board?.projects) ? board.projects : null;
  if (projects) {
    const onAxis = (axis, state) => projects.filter(x => x?.axes?.[axis] === state).length;
    figures.push(figure('مشاريع في المحفظة', projects.length, 'count', source, p.to, { unit: 'مشروع' }));
    figures.push(figure('مشاريع جارية التنفيذ', onAxis('execution', 'in_progress'), 'count', source, p.to, { unit: 'مشروع' }));
    figures.push(figure('مشاريع متوقفة على محور التنفيذ', onAxis('execution', 'on_hold'), 'count', source, p.to, { unit: 'مشروع', target: 0, better: 'down' }));
    figures.push(figure('مشاريع لم تبدأ بعد', onAxis('execution', 'not_started'), 'count', source, p.to, { unit: 'مشروع' }));
  } else {
    figures.push(unavailable('توزيع المحفظة على محاور التنفيذ الثمانية', {
      reason: `${sources.executiveAxesBoard ? SCOPE_MISSING : BRANCH_PENDING} لا تُقرأ المحفظة من مصدر ثانٍ ولا تُقدَّر بالعين`,
      needed: sources.executiveAxesBoard ? SCOPE_NEEDED : 'دمج الفرع الذي يصدّر executiveAxesBoard من app/project-axes.mjs، فيُقرأ منه هذا القسم كاملًا بمحاوره.' }));
  }
  // فجوتان دائمتان في هذا القسم لا يسدّهما دمج ولا شيفرة: لا وزن ولا معالم، فلا نسبة إنجاز ولا التزام أمام العميل.
  figures.push(gapFigure(db, u, 'project_percent_complete'), gapFigure(db, u, 'milestone_records'));
  return section('portfolio', nameOf('portfolio'), [group('حالة المحفظة', figures)]);
}

function blockersSection(db, u, p) {
  const source = sourceOf('blockers'), t = u.tenant_id;
  const openTasks = countOf(db, "SELECT COUNT(*) AS n FROM tasks k JOIN projects j ON j.id=k.project_id WHERE j.tenant_id=? AND k.status='open'", t);
  const lateTasks = countOf(db, "SELECT COUNT(*) AS n FROM tasks k JOIN projects j ON j.id=k.project_id WHERE j.tenant_id=? AND k.status='open' AND k.due_date<?", t, p.to);
  const held = countOf(db, "SELECT COUNT(*) AS n FROM project_execution_states WHERE tenant_id=? AND state='on_hold'", t);
  const blocked = countOf(db, "SELECT COUNT(*) AS n FROM work_packages WHERE tenant_id=? AND status='blocked'", t);
  // «حتى نهاية الفترة» تنتهي بنهاية يوم p.to بتوقيت الرياض: created_at طابع UTC فيُقارَن بلحظة نهاية ذلك اليوم.
  const openRequests = countOf(db, "SELECT COUNT(*) AS n FROM requests WHERE tenant_id=? AND status IN ('pending','approved','in_progress','returned') AND created_at<?", t, riyadhDayRange(p.to)[1]);
  return section('blockers', nameOf('blockers'), [
    group('ما يقف اليوم', [
      figure('مهام مفتوحة تجاوزت موعدها', lateTasks, 'count', source, p.to, { unit: 'مهمة', target: 0, better: 'down' }),
      figure('مهام مفتوحة', openTasks, 'count', source, p.to, { unit: 'مهمة' }),
      figure('مشاريع حالة تنفيذها «متوقفة»', held, 'count', source, p.to, { unit: 'مشروع', target: 0, better: 'down' }),
      figure('حزم عمل متوقفة', blocked, 'count', source, p.to, { unit: 'حزمة', target: 0, better: 'down' }),
      figure('طلبات خدمة مفتوحة حتى نهاية الفترة', openRequests, 'count', source, p.to, { unit: 'طلب' })
    ], { note: 'التأخر يُقاس على الموعد المسجَّل اليوم لا على خط أساس مجمَّد؛ ولذلك الفجوة التالية معلنة في القسم نفسه.' }),
    group('ما لا يُقاس في هذا القسم', [gapFigure(db, u, 'schedule_baseline_variance')])
  ]);
}

// الأهداف: الفجوة بوحدة المؤشر نفسها، لا نسبة إنجاز. والمؤشر بلا قياس فراغ مصرَّح به لا صفر.
function objectivesSection(db, u, p) {
  const source = sourceOf('objectives'), t = u.tenant_id;
  const objectives = db.prepare("SELECT * FROM governance_objectives WHERE tenant_id=? AND period_from<=? AND period_to>=? ORDER BY period_from,title").all(t, p.to, p.from);
  const ids = objectives.map(o => o.id), marks = ids.map(() => '?').join(',');
  const initiatives = ids.length ? db.prepare(`SELECT * FROM governance_initiatives WHERE tenant_id=? AND objective_id IN (${marks}) ORDER BY due_date`).all(t, ...ids) : [];
  const live = initiatives.filter(i => ['proposed', 'approved', 'running'].includes(i.status));
  const counts = group('الأهداف والمبادرات في الفترة', [
    figure('أهداف قائمة تغطي الفترة', objectives.filter(o => o.status === 'open').length, 'count', source, p.to, { unit: 'هدف' }),
    figure('مبادرات تحتها', initiatives.length, 'count', source, p.to, { unit: 'مبادرة' }),
    figure('مبادرات تجاوزت موعدها ولمّا تُنجز', live.filter(i => i.due_date < p.to).length, 'count', source, p.to, { unit: 'مبادرة', target: 0, better: 'down' })
  ]);
  const figures = [];
  for (const initiative of initiatives) {
    for (const indicator of db.prepare('SELECT * FROM governance_indicators WHERE initiative_id=? ORDER BY title').all(initiative.id)) {
      const label = `${indicator.title} — ${initiative.title}`;
      const latest = db.prepare('SELECT m.* FROM governance_measurements m WHERE m.indicator_id=? AND m.measured_on<=? AND NOT EXISTS(SELECT 1 FROM governance_measurements c WHERE c.corrects_id=m.id) ORDER BY m.measured_on DESC,m.recorded_at DESC LIMIT 1').get(indicator.id, p.to);
      if (!latest) {
        // غياب القياس ليس صفرًا ولا بلوغًا للمستهدف: بند بلا قيد في هذه الفترة، وسببه مكتوب.
        figures.push(unavailable(label, { unit: indicator.unit,
          reason: `لا قياس مسجَّل لهذا المؤشر حتى ${p.to}. المصدر المعلن للقياس: ${indicator.measurement_source}`,
          needed: `تسجيل قياس للمؤشر بتاريخه ومصدره في سجل الحوكمة، ثم تُذكر الفجوة عن المستهدف (${indicator.target_value} ${indicator.unit}) بوحدتها.` }));
        continue;
      }
      // الفجوة فرق عددي بوحدة المؤشر، بالاتجاه المعلن — القاعدة نفسها التي في app/governance.mjs.
      const gap = Math.round((indicator.target_value - latest.value) * 1000) / 1000;
      figures.push(figure(label, gap, 'number', source, latest.measured_on, { unit: indicator.unit, target: 0, better: indicator.direction === 'up' ? 'down' : 'up',
        note: `القياس ${latest.value} ${indicator.unit} مقابل مستهدف ${indicator.target_value} ${indicator.unit} (${DIRECTION_NAMES[indicator.direction]}). لا نسبة إنجاز تُشتق من هذا الرقم.` }));
    }
  }
  const measures = group('الفجوة عن المستهدف بوحدة كل مؤشر', figures.length ? figures
    : [unavailable('مؤشرات الأهداف', { reason: 'لا مؤشر مسجَّل تحت أي مبادرة تغطي هذه الفترة، فلا فجوة تُذكر بوحدتها.',
        needed: 'تسجيل مؤشر لكل مبادرة بوحدته ومستهدفه ومصدر قياسه، ثم قياسه بتاريخه.' })],
    { note: 'الرقم أدناه فجوة بوحدة المؤشر: موجبها لم يبلغ المستهدف بعد، وصفرها أو سالبها بلغه أو تجاوزه. لا نسبة إنجاز.' });
  return section('objectives', nameOf('objectives'), [counts, measures]);
}

// المخاطر: التغطية المعلنة هنا هي المشاريع التي **لا** خطر مربوط بها، لا عدد المخاطر.
function risksSection(db, u, p) {
  const source = sourceOf('risks'), t = u.tenant_id;
  const projects = countOf(db, 'SELECT COUNT(*) AS n FROM projects WHERE tenant_id=?', t);
  const uncovered = countOf(db, "SELECT COUNT(*) AS n FROM projects j WHERE j.tenant_id=? AND NOT EXISTS(SELECT 1 FROM governance_risks r WHERE r.tenant_id=j.tenant_id AND r.link_type='project' AND r.link_id=j.id AND r.status='open')", t);
  const open = countOf(db, "SELECT COUNT(*) AS n FROM governance_risks WHERE tenant_id=? AND status='open'", t);
  const overdue = countOf(db, "SELECT COUNT(*) AS n FROM governance_risks WHERE tenant_id=? AND status='open' AND next_review_on<?", t, p.to);
  const proposed = countOf(db, "SELECT COUNT(*) AS n FROM governance_risks WHERE tenant_id=? AND status='open' AND response='accept_proposed'", t);
  return section('risks', nameOf('risks'), [
    group('تغطية المشاريع بالمخاطر', [
      figure('مشاريع بلا خطر مفتوح واحد مربوط بها', uncovered, 'count', source, p.to, { unit: 'مشروع', target: 0, better: 'down' }),
      figure('مشاريع في المنصة', projects, 'count', source, p.to, { unit: 'مشروع' })
    ], { note: 'صفر المخاطر على مشروع ليس أمانًا: قد يعني أن أحدًا لم ينظر في مخاطره. الفجوة أدناه تسمّي ما ينقص لتمييز الحالتين.' }),
    group('سجل المخاطر', [
      figure('مخاطر مفتوحة', open, 'count', source, p.to, { unit: 'خطر' }),
      figure('مخاطر تجاوزت موعد مراجعتها', overdue, 'count', source, p.to, { unit: 'خطر', target: 0, better: 'down' }),
      figure('قبول مقترح لم يعتمده أحد أعلى من مالكه', proposed, 'count', source, p.to, { unit: 'خطر', target: 0, better: 'down' })
    ]),
    group('ما لا يُقاس في هذا القسم', [gapFigure(db, u, 'risk_coverage')])
  ]);
}

function decisionsSection(db, u, p) {
  const source = sourceOf('decisions'), t = u.tenant_id;
  const decided = countOf(db, 'SELECT COUNT(*) AS n FROM governance_decisions WHERE tenant_id=? AND decided_on BETWEEN ? AND ?', t, p.from, p.to);
  const reversals = countOf(db, 'SELECT COUNT(*) AS n FROM governance_decisions WHERE tenant_id=? AND decided_on BETWEEN ? AND ? AND reverses_id IS NOT NULL', t, p.from, p.to);
  const openCommitments = countOf(db, "SELECT COUNT(*) AS n FROM governance_commitments WHERE tenant_id=? AND status='open'", t);
  const lateCommitments = countOf(db, "SELECT COUNT(*) AS n FROM governance_commitments WHERE tenant_id=? AND status='open' AND due_date<?", t, p.to);
  const asked = countOf(db, "SELECT COUNT(*) AS n FROM epmo_decision_requests WHERE tenant_id=? AND status='open'", t);
  const waiting = countOf(db, "SELECT COUNT(*) AS n FROM epmo_decision_requests WHERE tenant_id=? AND status='open' AND period_to<=?", t, p.to);
  return section('decisions', nameOf('decisions'), [
    group('قرارات الفترة والتزاماتها', [
      figure('قرارات سُجِّلت في الفترة', decided, 'count', source, p.to, { unit: 'قرار' }),
      figure('منها عدول عن قرار سابق', reversals, 'count', source, p.to, { unit: 'قرار' }),
      figure('التزامات مفتوحة', openCommitments, 'count', source, p.to, { unit: 'التزام' }),
      figure('التزامات تجاوزت موعدها', lateCommitments, 'count', source, p.to, { unit: 'التزام', target: 0, better: 'down' })
    ], { note: 'القرار يُسجَّل في سجل القرارات وحده ولا يُكتب في هذا التقرير نسخةً ثانية؛ هنا عدده وأثره لا نصّه.' }),
    group('ما وُضع أمام القيادة ولم يُبتّ فيه', [
      figure('أسئلة مفتوحة أمام القيادة', asked, 'count', 'epmo_decision_requests', p.to, { unit: 'سؤال', target: 0, better: 'down' }),
      figure('منها فترتها انتهت ولم تُجَب', waiting, 'count', 'epmo_decision_requests', p.to, { unit: 'سؤال', target: 0, better: 'down' })
    ])
  ]);
}

// قسم الفجوات: الكتالوج الثابت مضمومًا إلى خططه في epmo_gap_plans. لا يفرغ ولا يُطوى:
// كل فجوة مفتوحة تخرج ببيانها وسببها وما يلزم لقياسها، ومعها من تسلّمها ومتى وعد.
function gapsSection(db, u, p) {
  const source = sourceOf('gaps'), rows = gapsRegister(db, u, false);
  const open = rows.filter(r => ['declared', 'owned'].includes(r.status));
  const refused = rows.filter(r => r.status === 'refused');
  const closed = rows.filter(r => r.status === 'closed');
  const groups = [group('حصيلة الكتالوج', [
    figure('فجوات معلنة في الكتالوج', rows.length, 'count', source, p.to, { unit: 'فجوة' }),
    figure('فجوات مفتوحة (معلنة أو مُسنَدة)', open.length, 'count', source, p.to, { unit: 'فجوة', target: 0, better: 'down' }),
    figure('فجوات بلا مالك ولا تاريخ', rows.filter(r => r.status === 'declared').length, 'count', source, p.to, { unit: 'فجوة', target: 0, better: 'down' }),
    figure('فجوات أُغلقت بدليل', closed.length, 'count', source, p.to, { unit: 'فجوة' }),
    figure('فجوات رُفض قياسها بسبب معلن', refused.length, 'count', source, p.to, { unit: 'فجوة' })
  ], { note: 'الكتالوج ثابت في الشيفرة ولا يُحرَّر من شاشة. غياب صفّ خطة لا يعني غياب الفجوة، وإنما أنها لم يتسلّمها أحد.' })];
  const asFigure = row => unmeasurable(row.statement, { gap_key: row.key, owner: row.owner_name, target_on: row.target_on,
    reason: `${row.why} — على ${row.department}. الحالة: ${row.status_name}${row.decision_note ? `. ${row.decision_note}` : ''}`,
    needed: row.needed });
  if (open.length) groups.push(group('فجوات مفتوحة', open.map(asFigure), { note: 'لكل فجوة مسنَدة مالكها وتاريخها المستهدف في عمودَيهما، وفي التصدير كذلك.' }));
  if (refused.length) groups.push(group('فجوات رُفض قياسها بقرار معلن', refused.map(asFigure), { note: 'الرفض المعلن باسم صاحبه أشرف من فجوة تُنسى، وهو يبقى في التقرير ولا يُطوى.' }));
  if (closed.length) groups.push(group('فجوات أُغلقت بدليل', closed.map(row =>
    figure(row.statement, row.closed_evidence, 'text', 'epmo_gap_plans', day(row.updated_at) || p.to, { note: `أغلقها ${row.updated_by_name || '—'}` })),
    { note: 'ما جعل البند قابلًا للقياس مكتوب بنصّه؛ «تم» ليست دليلًا ولا يقبلها القيد.' }));
  return section('gaps', nameOf('gaps'), groups);
}

// أقسام معلنة بفجواتها: لم تُبنَ أرقامها في هذه المرحلة، وهذه حالتها الصادقة لا حشوٌ مكان بناء.
const DECLARED_ONLY = {
  services: ['service_target_time'],
  pipeline: ['pipeline_reconciliation'],
  receivables: ['receivable_delay_reason', 'days_to_collect'],
  profitability: ['uncosted_minutes', 'revenue_target'],
  resourcing: ['unrecorded_capacity'],
  workforce: ['nitaqat_band', 'gosi_employer_share', 'turnover_rate', 'time_to_hire', 'training_cost', 'unrecorded_nationality']
};
const DIRECTION_NAMES = { up: 'الأعلى أفضل', down: 'الأدنى أفضل' };
// بند «غير قابل للقياس» يُبنى من مدخل الكتالوج مباشرة: بيانه اسمه، ولماذا سببه، وما يلزم لقياسه حاجته،
// ومعه خطة إغلاقه إن وُجدت. الفجوة الواحدة قد تُذكر في قسمها وفي سجل الفجوات معًا، وتخرج في الموضعين
// بمالكها وتاريخه نفسيهما: خطة واحدة لا نسختان تختلفان بحسب موضع القراءة.
function gapFigure(db, u, key) {
  const gap = gapDefinition(key), plan = planOf(db, u, key);
  return unmeasurable(gap.statement, { gap_key: gap.key, owner: person(db, plan?.owner_id), target_on: plan?.target_on ?? '',
    reason: `${gap.why} — على ${gap.department}`, needed: gap.needed });
}

function pipelineSection(db, u, p, sources) {
  const source = sourceOf('pipeline'), figures = [];
  const entitled = can(db, u, ENTITY_SCOPE);
  const forecast = sources.portfolioForecast && entitled ? sources.portfolioForecast(db, u, p) : null;
  // الاسم في الفرع المدموج open_value_minor (بالهللات)، لا open_minor كما افتُرض قبل الدمج: فحص الشكل الإلزامي في §5/1.
  const openMinor = forecast?.open_value_minor ?? forecast?.open_minor;
  if (forecast && Number.isFinite(forecast.weighted_minor) && Number.isFinite(openMinor)) {
    figures.push(figure('قيمة الفرص المفتوحة', openMinor, 'money', source, p.to));
    figures.push(figure('التوقع الموزون باحتمال المرحلة المعتمدة', forecast.weighted_minor, 'money', source, p.to,
      { note: 'تقدير لا قيد: يتغير بتغير احتمال المرحلة، ولا يدخل أي قائمة مالية.' }));
  } else {
    figures.push(unavailable('قيمة خط الفرص وتوقعه الموزون', {
      reason: `${sources.portfolioForecast ? SCOPE_MISSING : BRANCH_PENDING} ولا يُجمع الخط من استعلام ثانٍ هنا حتى لا يختلف رقمان باسم واحد`,
      needed: sources.portfolioForecast ? SCOPE_NEEDED : 'دمج الفرع الذي يصدّر portfolioForecast من app/pipeline-estimates.mjs، فيُقرأ منه هذا القسم برقم واحد.' }));
  }
  figures.push(gapFigure(db, u, 'pipeline_reconciliation'));
  return section('pipeline', nameOf('pipeline'), [group('خط الفرص', figures)]);
}

function declaredSection(db, u, key) {
  const figures = DECLARED_ONLY[key].map(gapKey => gapFigure(db, u, gapKey));
  return section(key, nameOf(key), [group('ما لا يُقاس في هذا القسم', figures,
    { note: 'لم تُبنَ أرقام هذا القسم في هذه المرحلة. الفجوة المعلنة باسم إدارتها أصدق من رقمٍ يُملأ بالتقدير.' })]);
}

// قراءة الإدارة تُطوى داخل الجسم **قبل** الحارس، فتُختم الكلمات مع الأرقام في بصمة واحدة:
// لقطة تحمل أرقامًا بلا الجملة التي تقرؤها لقطةٌ نصفها مختوم.
function commentarySection(db, u, p, notes) {
  const source = sourceOf('commentary');
  const figures = SECTIONS.map(s => {
    const note = notes.get(s.key);
    if (note) return figure(s.name, note.body, 'text', source, day(note.updated_at) || p.to, { note: `كتبها ${note.written_by_name} · نسخة ${note.version}` });
    return unavailable(s.name, { reason: 'لا قراءة مكتوبة لهذا القسم في هذه الفترة. الصمت عن قسم يُقرأ رضًا عنه، وليس كذلك.',
      needed: 'قراءة مكتوبة من الإدارة التنفيذية للمشاريع لهذا القسم في هذه الفترة: ما تغيّر ولماذا وما الذي يترتب عليه.' });
  });
  return section('commentary', nameOf('commentary'), [group('قراءة الإدارة لكل قسم', figures)], { human: true,
    note: 'هذه الجملة تُختم مع الأرقام في اللقطة نفسها: بصمة اللقطة تغطي الكلام والرقم معًا.' });
}

// جسم التقرير المركّب. يُستدعى من app/reports.mjs (المفتاح E01) ومن لوحة EPMO للعرض على الشاشة.
export function buildEpmoBody(db, u, input, sources = reportSources()) {
  const p = { from: v.date(input?.from), to: v.date(input?.to) };
  if (p.to < p.from) fail(400, 'date_order', 'نهاية الفترة تسبق بدايتها. صحّح التاريخين وأعد تشغيل التقرير');
  const notes = new Map(sectionNotes(db, u, p).map(n => [n.section_key, n]));
  const sections = [
    portfolioSection(db, u, p, sources),
    blockersSection(db, u, p),
    objectivesSection(db, u, p),
    risksSection(db, u, p),
    declaredSection(db, u, 'services'),
    pipelineSection(db, u, p, sources),
    declaredSection(db, u, 'receivables'),
    declaredSection(db, u, 'profitability'),
    declaredSection(db, u, 'resourcing'),
    declaredSection(db, u, 'workforce'),
    decisionsSection(db, u, p),
    gapsSection(db, u, p)
  ];
  // التعليق يُضاف إلى قسمه قبل الحارس، ثم يصير قسمًا مستقلًا يجمع القراءات كلها.
  for (const s of sections) { const note = notes.get(s.key); if (note) s.note = note.body; }
  sections.push(commentarySection(db, u, p, notes));
  const body = { period: p, sections, coverage: coverage(sections), section_coverage: Object.fromEntries(sections.map(s => [s.key, coverage(s)])) };
  // الحارس أخيرًا: لا يخرج رقم بلا مصدره وتاريخه، ولا فراغ لا يقول لماذا هو فراغ وما الذي يلزم لقياسه.
  assertSourced(body.sections);
  return body;
}
