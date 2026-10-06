// شجرة مركز الخدمات — النسخة صفر، بياناتُها في هذا الملف (ترحيل 131).
//
// الدليل قبل هذا الملف قائمةٌ واحدة: 143 بندًا (142 صفًّا في services، وHR-LEAVE ليس صفًّا فيها ومع
// ذلك يُتصفَّح ويُبحث فيه). وهذا الملف يقول أين يقع كل بند من **عدسة حاجة الطالب**: أي فئة، وهل له
// بطاقة في شبكتها أم يسكن مجموعة خيارات، ومن يراه.
//
// ولماذا كودٌ لا جدول إعدادات ولا كيان في سجل التعريفات (123): لأن 123 طبقةٌ على كياناتٍ لها جدول
// وشاشة وحالات ودوالّ load/list/readable (عقد registerEntity)، ووثيقة ترتيبٍ لا ينطبق عليها ذلك
// العقد؛ ورفع SPEC_FORMAT من 1 إلى 2 رقمٌ عامٌّ للمنصة كلها يُكتب في كل صف نسخة لكل كيان. فالشجرة
// **كودٌ هو النسخة صفر** — عُرف 123 بنصّه: «لا بذرة، النسخة 0 هي افتراضات الكود» — وسطحُ النشر يأتي
// بعد أن تثبت الشجرة أنها الشجرة الصحيحة. بناء محرّرٍ لترتيبٍ لم يُختبر هو أغلى خطأ ممكن هنا.
//
// ── قرار مؤجَّل يُكتب هنا لا يُسكت عنه: قاعدة الاسم الإنجليزي «فعل + مفعول» ──────────────────────
// المقيس: نحو 175 اسمًا إنجليزيًا في شجرة الخدمات، ثلاثة أو أربعة فقط تبدأ بفعل. تطبيق القاعدة =
// إعادة كتابة 139 اسمًا = 139 صفَّ نسخةٍ إضافيًا في services، **ولا يقرأ الطالبُ العربيُّ منها حرفًا**
// (الواجهة عربية RTL، وname_en يظهر في أسطح الإدارة). فالقاعدة لا تشتري للطالب شيئًا في هذه الحزمة،
// وتشتري خطر تسمية على 139 رمزًا. **مؤجَّلة بقرار المالك.** وسعرها إن اعتُمدت لاحقًا: تحرير 139
// name_en + تشغيلة مثبّت واحدة تنتج 139 نسخة + إعادة بصمة الشاشات التي تطبع name_en (تُقاس قبل
// التنفيذ، والمرشَّح الأول service-cards). وشرط الرجوع: أن يطلبها المالك بعد أن يرى هذا السعر.
// ما يبقى ساريًا: ≤5 كلمات للاسم العربي (تسعة استثناءات مثبَّتة في FIXED_NAMES)، و≤90 حرفًا للوصف.
import { now } from './db.mjs';
import { normalize } from './arabic-text.mjs';
// دورة استيراد مقصودة ومطابقة للقائم بين service-catalog وworkflow: لا يُقرأ SERVICE_VARIANTS هنا
// وقتَ تحميل الوحدة، بل داخل الدوال وحدها، فلا يقع في منطقة الموت الزمني.
import { SERVICE_VARIANTS } from './service-catalog.mjs';
import { MODULE_SERVICES } from './static/module-services.mjs';
// شرط «هذه الخدمة ليست موقوفة» (129) وقائمة الجماهير وحلّها: مصدرٌ واحد في app/service-availability.mjs،
// وهو نفسه الذي يُحقن في مسارات القراءة الأربعة. لا نسخة ثانية منه هنا.
import { availableSql, gateSql, AUDIENCES, audiencesFor, currentGates } from './service-availability.mjs';
export { AUDIENCES, audiencesFor };
const AUDIENCE_LIST=[...AUDIENCES];

/* ───── الفئات الثماني ───────────────────────────────────────────────────────── */
// ترتيبها يدويّ: هو ترتيب المالك في برومبته، لا ترتيبٌ محسوب. والأيقونات من مكتبة واحدة (Lucide)
// وتمثّل الشيء لا الإدارة.
export const CATEGORIES=Object.freeze([
  {key:'my_time',name_ar:'وقتي وحضوري',name_en:'My Time & Attendance',icon:'calendar-clock',position:1,
    description:'كل ما يخصّ ساعاتي وأيامي: الإجازة، البصمة، الإضافي، ساعات المشروع.'},
  {key:'my_documents',name_ar:'أوراقي وبياناتي',name_en:'My Documents & Data',icon:'file-text',position:2,
    description:'ورقة أحتاجها، أو بيان عنّي يجب أن يتغيّر.'},
  {key:'my_pay',name_ar:'راتبي ومصاريفي',name_en:'My Pay & Money',icon:'wallet',position:3,
    description:'مبلغ يخصّني: راتب، مطالبة، مصروف، عهدة.'},
  {key:'my_workplace',name_ar:'أدواتي ومكاني',name_en:'My Tools & Workplace',icon:'laptop',position:4,
    description:'جهاز، صلاحية، مكان، تنقّل، أو عطل.'},
  {key:'my_growth',name_ar:'تطوري وأدائي',name_en:'My Growth & Performance',icon:'trending-up',position:5,
    description:'مساري: تدريب، تقييم، ترقية، انضمام، ومغادرة.'},
  {key:'my_projects',name_ar:'مشاريعي وعملائي',name_en:'My Projects & Clients',icon:'briefcase',position:6,
    description:'شغل العملاء والمشاريع: تكليف، إنتاج، حملة، مشروع، حساب، بحث، تقرير.'},
  {key:'purchasing',name_ar:'مشتريات ومدفوعات',name_en:'Purchasing & Payments',icon:'shopping-cart',position:7,
    description:'مال يخرج للشركة أو يدخل إليها: شراء، مورد، صرف، فاتورة، ميزانية.'},
  {key:'governance',name_ar:'الدعم والحوكمة',name_en:'Support & Governance',icon:'shield-check',position:8,
    description:'قانوني، حوكمة، بلاغ، صوت الموظف، وتواصل داخلي.'}
]);

/* ───── الإسناد: بطاقات كل فئة بترتيبها ──────────────────────────────────────── */
// كل عنصر في cards إمّا **رمز مجموعة** يبدأ بـ«VAR-» فيصير بطاقةً واحدة فوق أعضائها، وإمّا **رمز خدمة**
// فيصير بطاقةً مفردة. وأعضاء المجموعة لا يُكتبون هنا: يُشتقّون من SERVICE_VARIANTS عند الإسقاط، فتبقى
// العضوية مصدرَ حقيقةٍ واحدًا في الكود. جدولٌ ثانٍ للعضوية مصدران يفترقان بعد أول تحرير.
//
// والحساب الذي يُلزم كل رقم على كل شاشة، ويُعاد قياسه في tests/catalog-tree.test.mjs لا يُفترض:
//   بنود الموظف = 143 (142 خدمة + HR-LEAVE) · بطاقاته = 63 (26 مجموعة + 37 مفردة) · فئاته = 8
//   بنود المدير = 143 · بطاقاته = 63 — لا فرق بينهما اليوم (انظر MANAGER_DELTA).
export const PLACEMENT=Object.freeze([
  {category:'my_time',cards:['VAR-LEAVE','HR-ATTENDANCE-FIX','HR-OVERTIME','PMO-TIMESHEET']},
  {category:'my_documents',cards:['VAR-LETTER','VAR-PROFILE','HR-DOC-RENEWAL','ADM-GOVT-SERVICES','LEG-PRIVACY-REQUEST']},
  {category:'my_pay',cards:['HR-PAYROLL-INQUIRY','VAR-BENEFITS','HR-GOSI-CORRECTION','HR-RETRO-ADJUSTMENT','ADM-EXPENSE-CLAIM','FIN-CUSTODY']},
  {category:'my_workplace',cards:['VAR-IT','IT-OUTAGE','IT-MEETING-SUPPORT','IT-SECURITY-INCIDENT','IT-CHANGE-REQUEST','IT-PLATFORM-FEEDBACK',
    'VAR-ADMIN','ADM-SAFETY','ADM-TRAVEL','ADM-OUTGOING-LETTER','IT-NEW-ACCOUNT']},
  {category:'my_growth',cards:['TAL-TRAINING','TAL-PERFORMANCE-REVIEW','TAL-SUCCESSION','HR-JOB-CHANGE','HR-REFERRAL','HR-HIRING-NEED','HR-RESIGNATION','HR-EXIT-INTERVIEW']},
  {category:'my_projects',cards:['VAR-CREATIVE','VAR-PRODUCTION','VAR-DIGITAL','VAR-PR','VAR-INFLUENCER','VAR-BRAND',
    'VAR-PROJECT','VAR-CLIENT','VAR-OPPORTUNITY','VAR-RESEARCH','VAR-REPORT','VAR-DATA']},
  {category:'purchasing',cards:['VAR-PROCURE','VAR-VENDOR','FIN-PAYMENT-REQUEST','VAR-INVOICE','FIN-BUDGET-TRANSFER','FIN-TAX-QUERY','ADM-SUBSCRIPTION']},
  {category:'governance',cards:['VAR-LEGAL','LEG-WHISTLEBLOW','HR-GRIEVANCE','GOV-CONFLICT-DISCLOSURE','GOV-RISK','GOV-POLICY',
    'VAR-DECISION','VAR-STRATEGY','VAR-INTERNAL-COMMS','VAR-VOICE']}
]);

// عضوٌ في مجموعة لا صفَّ له في services. الحالة الوحيدة اليوم HR-LEAVE داخل VAR-LEAVE: خياراتها تُبنى
// من أرصدة الموظف نفسه لا من قائمة في الكود، فلا يستطيع الإسقاط اشتقاقها من SERVICE_VARIANTS.
// وهي بالضبط الوحدة الثالثة والأربعون بعد المئة التي تسقط في كل تنفيذ يبني على services وحدها.
export const GROUP_MODULES=Object.freeze({'VAR-LEAVE':['HR-LEAVE']});

/* ───── جمهور المدير: فرقٌ لا نسخة ──────────────────────────────────────────── */
// catalog_placement يحمل للمدير **صفوف الفرق وحدها**، وكل ما عداه يُحلّ من صفوف الموظف بشرط الجمهور في
// الاستعلام. والنسخة الكاملة كانت ستعني 142 صفًّا مكررًا لكل جمهور، وأي تغيير في الشجرة يُطبَّق مرتين،
// وأول إسقاطٍ يفشل نصفه يترك المدير يرى دليلًا يخالف دليل الموظف بلا أن يقول أحدٌ ذلك.
//
// **الفرق اليوم فارغ، بقرارٍ مكتوب لا مسكوتٍ عنه (مراجعة 23 سبتمبر).** الدفعة الأولى أخرجت IT-NEW-ACCOUNT
// (تجهيز حسابات موظف جديد) من دليل الموظف بهذا الصفّ، فكسرت سبعة تأكيدات في خمسة اختبارات مسجَّلة تثبّت أن
// الموظف يرى الدليل كاملًا (142 خدمة)، وعُدّلت تلك الاختبارات لتوافقها — وتعديل اختبارٍ مسجَّل ممنوعٌ بقاعدة
// المالك. فأُعيدت الاختبارات الخمسة إلى نصّها المسجَّل، وعادت IT-NEW-ACCOUNT إلى إسناد الموظف (my_workplace)،
// وبقيت الآلية كما هي: صفُّ فرقٍ للمدير يُكتب هنا حين **يقرّر المالك** تضييق ظهور خدمةٍ على الموظف — ومعه إعادة
// تسجيل الاختبارات الخمسة باسمه. والتضييق نفسه ما زال وجيهًا (لا يطلب موظفٌ تجهيز حسابات موظفٍ جديد لنفسه)،
// لكنه قرار منتج لا قرار مهندس.
export const MANAGER_DELTA=Object.freeze([]);

// «فريقي» عدسة لا فئة تاسعة: بطاقاتها هي التعريفات نفسها معروضة بعدسة «أنا المدير الطالب»، وتُعرض
// موسومةً صراحةً «بطاقات عُدّت في فئاتها» فلا تدخل عدّاد الفئات ولا تُنتج صفًّا ثانيًا ولا اسمًا ثانيًا.
// وفيها بطاقة خدمة حقيقية واحدة (IT-NEW-ACCOUNT)؛ والأربع الباقيات عدسات على فئاتهنّ.
export const MY_TEAM_LENS=Object.freeze(['HR-HIRING-NEED','HR-JOB-CHANGE','PMO-RESOURCE','HR-EXIT-INTERVIEW','IT-NEW-ACCOUNT']);
export const MY_TEAM_NOTE='عدسة — بطاقات عُدّت في فئاتها';

/* ───── إعادة التسمية: نسخة خدمة جديدة، والاسم القديم يبقى مكتشَفًا ─────────── */
// services غير قابل للتحديث ولا للحذف (service_no_update/service_no_delete)، ولا يملك اليوم أي مسار
// لتغيير name_ar. فإعادة التسمية تجري حصرًا عبر createService: يُحرَّر الاسم في تعريف الكود، فيكتشف
// installServiceCatalog أن sameShape=false فينشئ **نسخة جديدة** ويكتب service.version_created في
// سلسلة التدقيق. الطلبات القائمة تشير إلى نسخةٍ بعينها فلا تتأثر.
//
// و**الاسم القديم يبقى مكتشَفًا في البحث إلزامًا**: catalog(db,u) يقرأ أحدث نسخة لكل رمز، فالاسم القديم
// يختفي من الفهرس ما لم يُحفَظ. فكل إعادة تسمية تُدرج صفًّا في service_synonyms بالاسم القديم — لا
// استثناء، واختبارٌ يفشل إن وُجد رمز أُعيدت تسميته بلا مرادفٍ اسمُه القديم.
//
// **تسع عشرة لا عشرون (مراجعة 23 سبتمبر).** العشرون كانت HR-LETTER المبذورة («طلب خطاب وظيفي» ← «تعريف بالعمل»)،
// وكانت تُنسخ بشكلها في المثبّت فتُحسب `revised:1` على البذرة الجديدة — واختبار المثبّت المسجَّل يثبّت `revised:0`،
// واختبار مساعد الموظف المسجَّل يثبّت أن «خطاب وظيفي» يجد HR-LETTER على البذرة وحدها. فلا طريق إلى الاسم الجديد
// بلا تعديل اختبارٍ مسجَّل أو بذرةٍ يقرؤها اختبار مسجَّل؛ والقاعدة تمنع الأول، والثاني يكسر الأول بطريقٍ ثانٍ.
// فبقي اسمها كما هو، وكلمة الطالب («تعريف»، «تعريف بالعمل») مرادفٌ لها في CATALOG_WORDS يجدها البحث أولًا.
// إعادة تسميتها قرار مالك يأتي معه إعادة تسجيل الاختبارين باسمه.
export const CATALOG_RENAMES=Object.freeze([
  {code:'HR-DOC-RENEWAL',from:'تجديد إقامة أو رخصة عمل أو تأشيرة',to:'تجديد إقامة أو رخصة',why:'سبع كلمات إلى ثلاث؛ التأشيرة خيار داخل النموذج'},
  {code:'HR-REFERRAL',from:'ترشيح مرشح (إحالة موظف)',to:'ترشيح مرشح لوظيفة',why:'القوس مصطلح داخلي'},
  {code:'TAL-PERFORMANCE-REVIEW',from:'طلب مراجعة أو معايرة تقييم الأداء',to:'مراجعة تقييم الأداء',why:'«معايرة» مصطلح إدارة لا لغة طالب'},
  {code:'ADM-GOVT-SERVICES',from:'خدمة حكومية أو تعقيب',to:'إنهاء معاملة حكومية',why:'«تعقيب» مهنة لا حاجة'},
  {code:'IT-PASSWORD-UNLOCK',from:'فك قفل حساب أو إعادة تعيين كلمة مرور',to:'استعادة كلمة المرور',why:'ثماني كلمات إلى ثلاث؛ «فك قفل» يحمله المرادف'},
  {code:'IT-PLATFORM-FEEDBACK',from:'ملاحظة على المنصة أو اقتراح خدمة',to:'اقتراح تحسين على المنصة',why:'يبدأ بالفعل لا بالاسم'},
  {code:'IT-CHANGE-REQUEST',from:'طلب تغيير أو نشر على نظام',to:'طلب نشر تغيير تقني',why:'«على نظام» غامض للطالب'},
  {code:'PMO-TIMESHEET',from:'تصحيح ساعات عمل على مشروع',to:'تصحيح ساعات المشروع',why:'خمس كلمات إلى ثلاث'},
  {code:'CRM-HANDOVER',from:'تسليم فرصة مكسوبة للتشغيل',to:'تسليم فرصة للتشغيل',why:'«مكسوبة» تحملها المجموعة'},
  {code:'INF-PROOF-PAYMENT',from:'إثبات تنفيذ وسداد مؤثر',to:'إثبات تنفيذ وسداد',why:'«مؤثر» تحمله المجموعة'},
  {code:'BRAND-ASSET-CREATE',from:'إنشاء أصل هوية جديد',to:'إنشاء أصل هوية',why:'«جديد» حشو'},
  {code:'DAT-DATA-QUALITY',from:'بلاغ جودة بيانات',to:'بلاغ خطأ في بيانات',why:'«جودة بيانات» مصطلح تخصص'},
  {code:'GOV-MEETING-ITEM',from:'إدراج بند في اجتماع تنفيذي',to:'إدراج بند في اجتماع',why:'«تنفيذي» تحمله الفئة'},
  {code:'PRC-VENDOR-BANK',from:'تحديث بيانات دفع مورد',to:'تحديث حساب مورد البنكي',why:'الوضوح هنا ضمانة أمنية لا تجميل'},
  {code:'FIN-CUSTODY',from:'طلب عهدة نقدية أو تسويتها',to:'عهدة نقدية أو تسويتها',why:'«طلب» حشو'},
  {code:'IT-MEETING-SUPPORT',from:'دعم تقني لاجتماع أو فعالية',to:'دعم تقني لاجتماع',why:'الفعالية تحملها المرادفات'},
  {code:'DIG-BUDGET-CHANGE',from:'تعديل ميزانية أو تحسين حملة جارية',to:'تعديل ميزانية أو تحسين حملة',why:'«جارية» حشو'},
  {code:'PR-EVENT-MEDIA',from:'دعوات واعتمادات إعلامية لفعالية',to:'دعوات واعتمادات إعلامية',why:'«لفعالية» حشو'},
  {code:'FIN-REFUND',from:'طلب إشعار دائن أو استرداد لعميل',to:'طلب إشعار دائن أو استرداد',why:'«لعميل» مفهوم من الفئة'}
]);

// تسعة أسماء **لا تُمسّ**: تغييرها يغيّر المعنى النظامي أو التعاقدي أو يكسر المطابقة مع مستند خارجي.
// تُعالَج بالمرادفات والوصف وحدهما، وهي وحدها المستثناة من حدّ الخمس كلمات.
export const FIXED_NAMES=Object.freeze(['HR-GOSI-CORRECTION','HR-RESIGNATION','HR-RETRO-ADJUSTMENT','LEG-NDA',
  'LEG-PRIVACY-REQUEST','LEG-WHISTLEBLOW','GOV-CONFLICT-DISCLOSURE','FIN-TAX-QUERY','IT-SECURITY-INCIDENT']);

/* ───── أوزان الترتيب: تُقرأ ولا تُخزَّن، وصفراها مكتوبٌ سببهما ─────────────── */
// درجةٌ مخزَّنة تُحسب بأوزانٍ قديمة وتُعرض بأوزانٍ جديدة، فيقرأ المدير سببًا لا يطابق النتيجة. فتُخزَّن
// المدخلات ولا يُخزَّن الناتج. والصفران ليسا سهوًا: النصّ أدناه يُعرض حرفيًا على شاشة الإعدادات.
// balance (الدفعة الرابعة): رصيد إجازةٍ متاح لصاحب الحساب يرفع بطاقة «إجازة» في صفّ «لك» — إشارة من بياناته هو،
// لا من سلوك أحد غيره، وسببها يُطبع بالرقم («رصيدك 18 يومًا»).
export const RANKING=Object.freeze({pinned:100,audience_match:40,usage_30d:0,my_usage:20,balance:15,seasonal:0,journey_step_due:10,not_eligible:-30});
// سبب الصفر نصٌّ ثابت **بلا رقم مكتوب فيه** (مراجعة 23 سبتمبر): «29 موظفًا وطلبان مكتملان» كانت حرفيّةً تُرسم على ثلاث
// شاشات، صادقةً على القاعدة الحيّة وحدها وبالمصادفة، وكاذبةً بعد أول طلب مكتمل جديد. الرقمان يُحقنان عند القراءة من
// catalogFacts (app/catalog-home.mjs) في موضعَي {employees} و{completed} بـfillReason، فلا يُطبع رقمٌ لم يُقس لحظته.
export const RANKING_ZERO_REASONS=Object.freeze({
  usage_30d:'الوزن صفر: القاعدة اليوم {employees}، والمكتمل من الطلبات {completed}. «الأكثر طلبًا في 30 يومًا» على هذا الحجم إمّا لا يحرّك شيئًا، وإمّا يحرّكه طلبٌ واحدٌ من شخصٍ واحد يعرفه الجميع. يرفعه المالك حين يصير للعدد معنى.',
  seasonal:'الوزن صفر: لا موسم قرّره أحد، ولا مخزن لنوافذ المواسم. قيمة مخترعة أسوأ من فراغ.'});
// حقن الأرقام المقيسة في نصٍّ فيه مواضع {مفتاح}. الموضع الذي لا قيمة له يبقى كما هو فيراه الاختبار لا القارئ وحده.
export const fillReason=(text,facts={})=>String(text??'').replace(/\{([a-z_]+)\}/g,(m,key)=>Object.hasOwn(facts,key)&&facts[key]!==undefined&&facts[key]!==null?String(facts[key]):m);
// أسماء الإشارات كما تُقرأ على شاشة الأوزان وفي سبب كل بطاقة مقترحة.
export const RANKING_NAMES=Object.freeze({pinned:'مثبّتة من مالك الدليل',audience_match:'مطابقة الجمهور (عدسة فريقي)',usage_30d:'الأكثر طلبًا في 30 يومًا',
  my_usage:'استعمالي أنا',balance:'رصيد متاح',seasonal:'موسم جارٍ',journey_step_due:'خطوة مستحقة في رحلة',not_eligible:'لا تنطبق عليّ الآن'});

/* ───── التثبيت والمواسم: فارغان عمدًا، وطريقهما مكتوب ─────────────────────── */
// PINS: رموز يثبّتها مالك الدليل في صفّ «لك» للجميع (الوزن 100). فارغ: لا قرار تثبيت من أحد، وقيمة مخترعة أسوأ من فراغ.
// يُكتب هنا كودًا (النسخة صفر) حتى يوجد سطح نشر؛ شاشة الإعدادات تقول «لا شيء بعد» وتسمّي هذا المسار.
export const PINS=Object.freeze([]);
// SEASONS: نوافذ سنوية تُعلَّم فيها بطاقات بعينها بشارة «موسم: … حتى …» (وزن الترتيب صفر بقرار المالك، والشارة خبرٌ لا ترتيب).
// شكل الموسم: {key,name_ar,calendar:'gregorian'|'islamic-umalqura',from:'MM-DD',to:'MM-DD',items:['VAR-LEAVE',…]}.
// التقويم الهجري بتقويم أم القرى المحسوب (Intl، كما في app/dates.mjs): للعرض والنافذة السنوية، لا للاحتساب النظامي.
// النافذة تتكرر كل سنة، ويصح أن تعبر رأس السنة (from > to). فارغ: لا موسم قرّره أحد.
export const SEASONS=Object.freeze([]);
export const SEASON_CALENDARS=Object.freeze(['gregorian','islamic-umalqura']);
const partsFormatter=new Map();
// اليوم والشهر في تقويم الموسم لتاريخٍ ما، أرقامًا لاتينية. الميلادي من الرقم نفسه بلا Intl.
function monthDay(date,calendar){
  if(calendar==='gregorian')return {month:date.getUTCMonth()+1,day:date.getUTCDate()};
  if(!partsFormatter.has(calendar))partsFormatter.set(calendar,new Intl.DateTimeFormat(`en-u-ca-${calendar}-nu-latn`,{month:'numeric',day:'numeric',timeZone:'UTC'}));
  const parts=partsFormatter.get(calendar).formatToParts(date);
  return {month:Number(parts.find(p=>p.type==='month')?.value),day:Number(parts.find(p=>p.type==='day')?.value)};
}
const key=(month,day)=>month*100+day;
const parseMD=text=>{const m=/^(\d{2})-(\d{2})$/.exec(String(text??''));return m?key(Number(m[1]),Number(m[2])):null;};
// المواسم الجارية في تاريخٍ ما من قائمةٍ تُمرَّر (الافتراضي SEASONS): موسمٌ شكلُه غير صالح لا يُقيَّم ولا يُخفي غيره.
export function seasonsAt(date,list=SEASONS){
  const at=date instanceof Date?date:new Date(Date.parse(String(date).slice(0,10)+'T00:00:00Z'));
  if(Number.isNaN(at.getTime()))return [];
  return list.filter(season=>{
    if(!season||!SEASON_CALENDARS.includes(season.calendar))return false;
    const from=parseMD(season.from),to=parseMD(season.to);
    if(from===null||to===null)return false;
    const {month,day}=monthDay(at,season.calendar),today=key(month,day);
    return from<=to?today>=from&&today<=to:today>=from||today<=to;
  });
}
export const seasonFor=(date=new Date())=>seasonsAt(date,SEASONS);

/* ───── الرحلات: واحدة مبنيّة، وسبعٌ مادّةً بلا تعريف ────────────────────────── */
// الرحلة طلبٌ أب عادي في requests (له خدمته ومساره) يولّد عند اعتماده طلبات أبناء باسم صاحبه. التعريف كودٌ هنا
// (النسخة صفر، كالشجرة)، والتنفيذ في journey_runs/journey_run_steps (ترحيل 131) بلا نسخة ثانية من حالة الابن.
//
// خطوة الرحلة: {key,item:{kind,key},when,copy,preset}
//   when   شرطٌ بشكل show_when نفسه ({field,equals:[…]}) يُقيَّم على حمولة الأب بـapp/validation.mjs fieldVisible —
//          لا لغة شرطٍ ثانية. null = بلا شرط.
//   copy   مفتاح حقل الابن ← مفتاح حقل الأب (والمفتاح المتطابق يُنسخ بلا ذكر).
//   preset قيمٌ يعرفها تعريف الرحلة نفسه (موظف جديد = «إصدار جديد» للبطاقة، «تخصيص جديد» للمقعد، «موظف جديد» سببًا للجهاز).
// ما لا يعرفه التعريف لا يُخترع: الحقل اللازم الذي بقي فارغًا يترك الابن **مسودةً** «ينتظر ردك» عند صاحب الرحلة.
//
// والقرار المكتوب لا المسكوت عنه: **لا فرع «سعودي/غير سعودي»**. الأب (IT-NEW-ACCOUNT) لا يحمل حقل جنسية أو إقامة،
// وإضافته تعني نسخة خدمة جديدة (createService) وقرارَ مالكٍ في حقلٍ يُسأل عن إنسان لم يدخل المنصة بعد؛ ولا خدمة
// «إصدار إقامة» في الدليل يتفرّع إليها (HR-DOC-RENEWAL تجديدٌ لا إصدار). فالمحرّك يقيّم الشرط بالشكل الموحّد
// (مختبَرٌ على تعريفٍ اصطناعي)، والفرع نفسه يُبنى حين يقرّر المالك الحقل والخدمة.
export const JOURNEY_VERSION=0;
export const JOURNEYS=Object.freeze([
  {key:'new_joiner',name_ar:'انضمام موظف جديد',name_en:'New joiner',
    parent:{kind:'service',key:'IT-NEW-ACCOUNT'},audience:'manager',
    description:'حين يُعتمد تجهيز حسابات الموظف الجديد تُولَّد باسم من طلبه طلباتُ الجهاز والمقعد وبطاقة الدخول والترحيب، وتُتابَع كلها في صفحة واحدة.',
    steps:[
      {key:'device',item:{kind:'service',key:'IT-DEVICE'},when:null,copy:{},preset:{reason:'موظف جديد'}},
      {key:'workspace',item:{kind:'service',key:'ADM-WORKSPACE'},when:null,copy:{date:'start_date'},preset:{action:'تخصيص جديد'}},
      {key:'access_card',item:{kind:'service',key:'ADM-ACCESS-CARD'},when:null,copy:{},preset:{action:'إصدار جديد'}},
      {key:'welcome',item:{kind:'service',key:'EXP-WELCOME'},when:null,copy:{},preset:{}}
    ]}
]);
// السبع الباقيات كما في شجرة المالك §٨: مادّتها القائمة وما ينقصها، ولا تعريفٌ مزيَّف لأيٍّ منها.
export const JOURNEYS_LATER=Object.freeze([
  {key:'business_travel',name_ar:'سفر عمل',material:'ADM-TRAVEL → travel_decisions',missing:'الفروع (تذكرة/سكن/بدل/تأمين سفر) كطلبات مستقلة تحت أب واحد'},
  {key:'personal_event',name_ar:'مناسبة شخصية',material:'VAR-LEAVE + HR-BENEFIT-CLAIM',missing:'الرابط بينهما'},
  {key:'data_change',name_ar:'تغيير بيانات',material:'VAR-PROFILE',missing:'تولّد فروع (بنك ← مالية، هوية ← حكومي)'},
  {key:'leaver',name_ar:'مغادرة موظف',material:'HR-RESIGNATION → resignations + HR-EXIT-INTERVIEW + EXP-FAREWELL',missing:'إغلاق الصلاحيات واسترداد العهدة كفرعين مشروطين'},
  {key:'new_project',name_ar:'مشروع جديد',material:'PMO-NEW-PROJECT → projects',missing:'PMO-RESOURCE + CRT-* كفروع'},
  {key:'new_client',name_ar:'عميل جديد',material:'CRM-HANDOVER + ACC-BRIEF-INTAKE + retainers',missing:'الرحلة نفسها'},
  {key:'seasonal',name_ar:'موسمي',material:'لا شيء',missing:'موسمٌ يقرّره المالك في SEASONS، ثم ربطه ببطاقاته'}
]);

/* ───── المرادفات السرّية: فعل شخصين بلا عمود جديد ──────────────────────────── */
// مرادفُ خدمةٍ سرّية أو مغلقة الدائرة (نقد المراجعة §4-3) لا يدخل البحث بيد واحدة: يُقترح فيُكتب صفّه بهذه العلامة في
// أول note، ولا يقرؤه ترتيب البحث حتى يؤكّده حاملُ «إعداد الخدمات» آخر. الحالة في note لا في عمود: الترحيل 131 مطبَّق
// ولا يُمسّ، والحارس في الكود واختبارُه يثبته.
export const PROPOSAL_MARK='مقترح بانتظار تأكيدٍ ثانٍ';

/* ───── قرار التسمية الإنجليزية، بنصّه المعروض على شاشة الإعدادات ───────────── */
// هو الفقرة نفسها في رأس هذا الملف: تُقرأ من هنا لا من تعليق، فلا يفترق ما يُعرض عمّا قُرّر.
export const NAMING_RULE_DECISION='قاعدة الاسم الإنجليزي «فعل + مفعول» مؤجَّلة بقرار المالك. المقيس: نحو 175 اسمًا إنجليزيًا في شجرة الخدمات، ثلاثة أو أربعة فقط تبدأ بفعل. تطبيق القاعدة = إعادة كتابة 139 اسمًا = 139 صفَّ نسخةٍ إضافيًا في services، ولا يقرأ الطالبُ العربيُّ منها حرفًا (الواجهة عربية RTL، وname_en يظهر في أسطح الإدارة). فالقاعدة لا تشتري للطالب شيئًا في هذه الحزمة، وتشتري خطر تسمية على 139 رمزًا. سعرها إن اعتُمدت لاحقًا: تحرير 139 name_en + تشغيلة مثبّت واحدة تنتج 139 نسخة + إعادة بصمة الشاشات التي تطبع name_en (تُقاس قبل التنفيذ، والمرشَّح الأول service-cards). وشرط الرجوع: أن يطلبها المالك بعد أن يرى هذا السعر. ما يبقى ساريًا: ≤5 كلمات للاسم العربي (تسعة استثناءات مثبَّتة في FIXED_NAMES)، و≤90 حرفًا للوصف.';

/* ───── اشتقاق أعضاء المجموعة ───────────────────────────────────────────────── */
// أعضاء المجموعة = خدمات خياراتها بلا تكرار (VAR-PROFILE فيها سبعة خيارات على خدمتين)، ومعها
// البنود التي لا صفَّ لها في services من GROUP_MODULES. الخيار الذي يفتح شاشةً بلا خدمة (تعريف لسفارة،
// «مزاياي») ليس بندًا في الدليل ولا يُعدّ: لا رمز له في services ولا شيء يُحسب عليه.
export function groupMembers(groupCode){
  const group=SERVICE_VARIANTS.find(g=>g.code===groupCode),members=[];
  const push=(key,kind)=>{if(key&&!members.some(m=>m.key===key))members.push({key,kind});};
  if(group&&Array.isArray(group.options))for(const option of group.options)push(option.service,'service');
  for(const key of GROUP_MODULES[groupCode]??[])push(key,'module');
  return members;
}
export const isGroupCode=code=>String(code).startsWith('VAR-');

/* ───── صفوف الإسقاط، مبنيّةً في الذاكرة قبل أي كتابة ───────────────────────── */
// تُبنى مرة واحدة ثم تُكتب، فإسقاطان متتاليان يعطيان الصفوف نفسها بالضبط (الثبات عند التكرار يختبره
// tests/catalog-tree.test.mjs). المواضع: البطاقة (i+1)*100، وعضوها (i+1)*100+j+1، فيبقى ترتيب
// القراءة هو ترتيب الشجرة المكتوب أعلاه لا ترتيب الإدراج.
export function placementRows(){
  const rows=[];
  for(const {category,cards} of PLACEMENT)cards.forEach((card,index)=>{
    const position=(index+1)*100;
    if(!isGroupCode(card)){rows.push({audience:'employee',kind:'service',key:card,category,group:'',browse:1,position});return;}
    rows.push({audience:'employee',kind:'group',key:card,category,group:'',browse:1,position});
    groupMembers(card).forEach((member,j)=>rows.push({audience:'employee',kind:member.kind,key:member.key,category,group:card,browse:0,position:position+j+1}));
  });
  for(const delta of MANAGER_DELTA)rows.push({audience:'manager',kind:delta.kind,key:delta.key,category:delta.category,group:'',browse:1,position:9000});
  return rows;
}

/* ───── كلمات الناس للبطاقات المفردة (الدفعة الثالثة) ───────────────────────── */
// الخدمة التي لا تسكن مجموعةً لا words[] لها في SERVICE_VARIANTS، فكانت بلا مرادف واحد — و«راتبي ناقص» لا
// تجد «استفسار أو تصحيح في الراتب» بالمطابقة الحرفية. هنا كلماتها كما يكتبها الناس: الدارج، والإنجليزي،
// والخطأ الشائع، وصيغة الشكوى («خربان»، «واقف»، «ضاعت»). من ثلاث إلى ثماني لكل بند، وهي المصدر الخامس في
// codeSynonyms بالعلامة نفسها from_code فتُعاد كتابتها مع كل إسقاط. ولا كلمة إدارةٍ هنا: «موارد بشرية» على
// عشرين خدمة تُفسد الترتيب. والسرّي والمغلق (HR-GRIEVANCE, LEG-WHISTLEBLOW) يُبحث فيهما ولا يُسجَّل بحثُهما.
export const CATALOG_WORDS=Object.freeze({
  'HR-ATTENDANCE-FIX':['بصمه','نسيت ابصم','استئذان','تاخير','حضور','غياب','خروج مبكر','عمل عن بعد'],
  'HR-OVERTIME':['اوفر تايم','overtime','ساعات اضافيه','عمل اضافي','دوام اضافي','بعد الدوام'],
  'PMO-TIMESHEET':['تايم شيت','timesheet','ساعاتي','ساعات المشروع','تسجيل ساعات','ساعات غلط'],
  'HR-DOC-RENEWAL':['اقامه','تجديد الاقامه','رخصه عمل','تاشيره','اقامتي','انتهت الاقامه','فيزا','رخصه شغل','رخصه الشغل','انتهت الرخصه'],
  'ADM-GOVT-SERVICES':['معامله حكوميه','تعقيب','مقيم','ابشر','قوى','جهه حكوميه','منصه حكوميه'],
  'LEG-PRIVACY-REQUEST':['بياناتي','خصوصيه','حذف بياناتي','مشاركه بيانات','بيانات شخصيه','نقل بيانات'],
  'HR-PAYROLL-INQUIRY':['راتبي','راتبي ناقص','خصم','مسير','قسيمه','الراتب','نقص في الراتب','راتب','ينزل الراتب','متى ينزل الراتب','موعد الراتب','خصموا','خصموا علي'],
  'HR-GOSI-CORRECTION':['التامينات','تامينات','gosi','اشتراك','الاجر الخاضع','تصنيف'],
  'HR-RETRO-ADJUSTMENT':['فروقات','فرق راتب','باثر رجعي','مستحقات سابقه','اشهر سابقه'],
  'ADM-EXPENSE-CLAIM':['مصروفات','مصاريف','فاتوره','استرداد','صرفت من جيبي','مطالبه','expense'],
  'FIN-CUSTODY':['عهده','عهده نقديه','تسويه عهده','كاش','مبلغ مقدم'],
  'IT-OUTAGE':['واقف','متوقف','النظام','نظام','معلق','داون','down','بطيء','السيرفر','الشبكه'],
  'IT-MEETING-SUPPORT':['اجتماع','بث','عرض','مايك','بروجكتر','زووم','تيمز','فعاليه'],
  'IT-SECURITY-INCIDENT':['اختراق','احتيال','رساله مشبوهه','فيشنق','phishing','فقدت جهازي','امني','هاكر'],
  'IT-CHANGE-REQUEST':['نشر','تغيير تقني','deploy','ديبلوي','تحديث نظام','ريليز'],
  'IT-PLATFORM-FEEDBACK':['ملاحظه','اقتراح','خدمه ناقصه','ما لقيت','لم اجد','خطا في المنصه','مشكله في المنصه'],
  'ADM-SAFETY':['سلامه','حادث','اصابه','خطر','حريق','اسعاف','safety'],
  'ADM-TRAVEL':['سفر','انتداب','تذكره','فندق','مهمه خارجيه','رحله عمل','travel','طيران','تذكره طيران','حجز طيران'],
  'ADM-OUTGOING-LETTER':['خطاب صادر','مراسله','صادر','خطاب رسمي','جهه خارجيه'],
  'IT-NEW-ACCOUNT':['موظف جديد','حساب جديد','ايميل جديد','تجهيز','مباشره','onboarding'],
  'TAL-TRAINING':['تدريب','دوره','كورس','مؤتمر','شهاده مهنيه','training','ورشه'],
  'TAL-PERFORMANCE-REVIEW':['تقييم','تقييمي','الاداء','معايره','اعتراض على التقييم','performance'],
  'TAL-SUCCESSION':['ترقيه','تعاقب','قيادي','خليفه','مسار قيادي','succession'],
  'HR-JOB-CHANGE':['نقل','ترقيه','مسمى','تغيير مدير','تغيير اداره','نقل موظف'],
  'HR-REFERRAL':['ترشيح','احاله','اعرف شخص','مرشح','referral','ترشيح صديق'],
  'HR-HIRING-NEED':['موظف','توظيف','شاغر','تعيين','احتاج موظف','وظيفه جديده','hiring','headcount'],
  'HR-RESIGNATION':['استقاله','استقيل','اخلاء طرف','ترك العمل','resignation','مغادره'],
  'HR-EXIT-INTERVIEW':['مقابله خروج','خروج','نقل معرفه','تسليم','exit'],
  'FIN-PAYMENT-REQUEST':['صرف','دفع لمورد','مستحق مورد','سداد فاتوره','payment','تحويل لمورد'],
  'FIN-BUDGET-TRANSFER':['مناقله','ميزانيه','نقل ميزانيه','بند','مركز تكلفه','budget'],
  'FIN-TAX-QUERY':['ضريبه','ضريبي','فاتوره غير مطابقه','قيمه مضافه','vat','زاتكا','tax'],
  'ADM-SUBSCRIPTION':['اشتراك','تجديد عقد','عقد خدمه','نظافه','امن','subscription'],
  'LEG-WHISTLEBLOW':['مخالفه','نزاع','بلاغ','تجاوز','whistleblow'],
  'HR-GRIEVANCE':['تظلم','شكوى','سري','مظلمه','grievance','اشتكي','شكوى على مديري','مديري'],
  'GOV-CONFLICT-DISCLOSURE':['تضارب','تضارب مصالح','افصاح','مصالح','conflict'],
  'GOV-RISK':['خطر','مخاطر','risk','سجل المخاطر'],
  'GOV-POLICY':['سياسه','اجراء','لائحه','policy','اعتماد سياسه'],
  // أعضاء المجموعات التي تفتقر كلماتُ خياراتها صيغةَ الشكوى الدارجة.
  'IT-SUPPORT':['خربان','خرب','معطل','ما يشتغل','مو شغال','جهازي','واي فاي','wifi','نت','انترنت','طابعه','support','لابتوب','اللابتوب','علق','يعلق','هنق','الجهاز علق'],
  'IT-PASSWORD-UNLOCK':['باسورد','باسوورد','نسيت','كلمه السر','password','قفل الحساب','مقفل'],
  'IT-DEVICE':['جهاز جديد','لاب توب','laptop','كيبورد','سماعه','ملحقات'],
  'ADM-ACCESS-CARD':['ضاعت','فقدت','مفقوده','بدل فاقد','بطاقتي','كرت','كرت الدخول','بطاقه الدخول','كرت دخول'],
  'ADM-MAINTENANCE':['خربان','مكسور','تسريب','ماء','اضاءه','صيانه','مكيف','تكييف','ما يبرد','كهربا','كهرباء','مقطوعه','الكهربا مقطوعه','لمبه'],
  'HR-SALARY-CERT':['تعريف بنك','شهاده راتب','تعريف راتب','للبنك','تمويل'],
  'HR-LETTER':['تعريف','خطاب تعريف','تعريف عمل','لجهه','تعريف بالعمل','سفاره','خطاب للسفاره','تعريف للسفاره'],
  'HR-EXPERIENCE-CERT':['خبره','شهاده خبره','شهادة خبرة','experience'],
  'HR-BANK-CHANGE':['iban','ايبان','تغيير بنك','حسابي البنكي','حساب الراتب','الايبان','تحديث الايبان'],
  'HR-SALARY-ADVANCE':['سلفه','سلفة','قرض','مقدم راتب','advance'],
  'HR-BENEFIT-CLAIM':['تامين','تأمين طبي','مطالبه تامين','علاج','بوليصه','insurance','زوجتي','تابع','اضافه تابع','التامين','ابنائي'],
  'ADM-ROOM-BOOKING':['حجز قاعه','قاعه','غرفه اجتماعات','meeting room'],
  'ADM-VISITOR':['زائر','زياره','ضيف','عندي زائر','تصريح دخول'],
  'CRT-DESIGN':['تصميم','بوستر','ديزاين','بنر','سوشال ميديا','design','فوتوشوب','photoshop','الستريتور'],
  'PRO-SHOOT':['نصور','تصوير فيديو','فيديو','فوتوسيشن','كاميرا'],
  // بند الوحدة المخصصة (HR-LEAVE): كلماتها في module-services.mjs، وهنا الدارج الذي تفتقره («اطلع اجازة»، «الحج»).
  'HR-LEAVE':['اجازه مرضيه','مرضيه','اطلع اجازه','الحج','حج','عمره','اجازه سنويه','ابي اجازه'],
  'LEG-NDA':['nda','عدم افصاح','سريه','اتفاقيه سريه'],
  'FIN-CLIENT-INVOICE':['فاتوره لعميل','اصدار فاتوره','فوتره','invoice'],
  'PRC-PURCHASE-REQUEST':['اشتري','شراء','طلب شراء','purchase'],
  'IT-SOFTWARE':['لايسنس','تنزيل برنامج','اوفيس','ادوبي','software'],
  'ADM-SUPPLIES':['اقلام','ورق','حبر','stationery','اقلام وورق','قرطاسيه','ادوات مكتبيه'],
  'ADM-VEHICLE':['مشوار','سائق','اوبر','vehicle'],
  'ADM-COURIER':['ارسال','مندوب','ارامكس','courier'],
  'ADM-WORKSPACE':['كرسي','مكان عمل','desk'],
  'ACC-ESCALATION':['عميل زعلان','escalation','شكوى كبيره'],
  'PRC-VENDOR-EVALUATION':['تقييم مورد','evaluation','مورد سيء']
});

/* ───── مرادفات الكود ───────────────────────────────────────────────────────── */
// خمسة مصادر، كلها source='from_code' فتُمحى وتُعاد كتابتها مع كل إسقاط بلا أن تمسّ ما كتبه إنسان:
//   (1) words[] المجموعة → صفّ المجموعة نفسها.
//   (2) words[] الخيار → خدمته.
//   (3) keywords وحدة HR-LEAVE (app/static/module-services.mjs) → البند module.
//   (4) **الأسماء العشرون القديمة** → رموزها، وإلا اختفى الاسم القديم من البحث يوم إعادة التسمية.
//   (5) CATALOG_WORDS أعلاه → البند بنوعه (خدمة أو وحدة مخصصة).
// وما لا يُنقل عمدًا: departmentMeta.keywords — كلمةُ إدارةٍ معلَّقة على 22 خدمة تُفسد الترتيب بدل أن
// تحسّنه. والكلمة التي تنكمش صورتها المطبَّعة دون حرفين تُترك: مفتاح الصف صورتُها، وحرفٌ واحد يطابق كل شيء.
export function codeSynonyms(){
  const rows=[],seen=new Set();
  const push=(kind,key,term,note)=>{
    const text=String(term??'').trim(),normalized=normalize(text);
    if(text.length<2||text.length>60||normalized.length<2||normalized.length>60)return;
    const id=`${kind} ${key} ${normalized}`;
    if(seen.has(id))return;
    seen.add(id);rows.push({kind,key,term:text,normalized,note});
  };
  for(const group of SERVICE_VARIANTS){
    for(const word of group.words??[])push('group',group.code,word,'كلمة مجموعة من الكود');
    if(!Array.isArray(group.options))continue;
    for(const option of group.options){
      if(!option.service)continue;
      for(const word of option.words??[])push('service',option.service,word,'كلمة خيار من الكود');
    }
  }
  for(const module of MODULE_SERVICES)for(const word of String(module.keywords??'').split(/\s+/))push('module',module.code,word,'كلمة وحدة مخصصة من الكود');
  for(const rename of CATALOG_RENAMES)push('service',rename.code,rename.from,'الاسم قبل إعادة التسمية، يبقى مكتشَفًا في البحث');
  const moduleCodes=new Set(MODULE_SERVICES.map(m=>m.code));
  for(const [code,words] of Object.entries(CATALOG_WORDS))for(const word of words)push(moduleCodes.has(code)?'module':'service',code,word,'كلمة الناس من الكود');
  return rows;
}

/* ───── الإسقاط ─────────────────────────────────────────────────────────────── */
// يُمحى الإسقاط ويُعاد بناؤه كاملًا داخل معاملة المُثبِّت نفسها، كما يُعاد بناء search_index (047) من
// مصادره. محو صفٍّ مشتق لا يمحو قرارًا، والقرار محفوظ في الكود أعلاه.
// items_unplaced **يُقاس ولا يُفترض**: كل رمز في services لهذا الكيان، وكل بند وحدةٍ مخصصة، ناقص ما
// أُسنِد فعلًا. هدفه صفر، وهو الرقم الذي يمنع اختفاء 59 خدمة تسليمٍ للعملاء بالصمت.
export function projectCatalog(db,tenantId,actorId){
  if(!db.isTransaction)throw new Error('projectCatalog rebuilds a projection and must run inside the installer transaction.');
  const stamp=now(),rows=placementRows(),synonyms=codeSynonyms();
  db.prepare('DELETE FROM catalog_placement WHERE tenant_id=?').run(tenantId);
  // شرط الأهلية السارية (138) يُعاد وضعه على الصفّ المبني، ولا يُبنى الصفّ فارغًا ثم يُصحَّح: هذا الجدول
  // إسقاطٌ يُمحى ويُعاد، والقرار يسكن service_gate. بلا هذين السطرين يمحو **كلُّ** تشغيلة مثبّت كلَّ شرطٍ
  // وضعه المالك، بلا خبر ولا سبب — وهو بالضبط ما كان سيقع لو سكن القرار في الإسقاط وحده.
  const gates=currentGates(db,tenantId);
  const insert=db.prepare(`INSERT INTO catalog_placement(tenant_id,audience,item_kind,item_key,category_key,group_key,browse,position,visible,required_capability,department_id,release_version,projected_at)
    VALUES(?,?,?,?,?,?,?,?,1,?,?,0,?)`);
  for(const row of rows){const gate=row.kind==='service'?gates.get(row.key):null;
    insert.run(tenantId,row.audience,row.kind,row.key,row.category,row.group,row.browse,row.position,
      gate?.required_capability??'',gate?.department_id??null,stamp);}
  // ما كتبه إنسان (curated) وما رُفع من بحثٍ ثم اعتُمد (from_search) لا يمسّهما الإسقاط.
  db.prepare("DELETE FROM service_synonyms WHERE tenant_id=? AND source='from_code'").run(tenantId);
  const word=db.prepare("INSERT INTO service_synonyms(tenant_id,item_kind,item_key,term,normalized,source,note,added_by,added_at) VALUES(?,?,?,?,?,'from_code',?,?,?) ON CONFLICT DO NOTHING");
  for(const row of synonyms)word.run(tenantId,row.kind,row.key,row.term,row.normalized,row.note,actorId,stamp);
  const placed=new Set(rows.filter(r=>r.kind!=='group').map(r=>r.key));
  const known=new Set([...db.prepare('SELECT DISTINCT code FROM services WHERE tenant_id=?').all(tenantId).map(r=>r.code),...MODULE_SERVICES.map(m=>m.code)]);
  const unplaced=[...known].filter(code=>!placed.has(code));
  db.prepare(`INSERT INTO catalog_projection_state(tenant_id,release_version,entries,items_unplaced,rebuilt_at) VALUES(?,0,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET release_version=0,entries=excluded.entries,items_unplaced=excluded.items_unplaced,rebuilt_at=excluded.rebuilt_at`)
    .run(tenantId,rows.length,unplaced.length,stamp);
  return {entries:rows.length,synonyms:db.prepare("SELECT COUNT(*) AS n FROM service_synonyms WHERE tenant_id=? AND source='from_code'").get(tenantId).n,
    items_unplaced:unplaced.length,unplaced};
}

/* ───── ت1: موضع العرض — الباب الأمامي وصفحة الإدارة (عرضٌ فقط) ───────────────── */
// قرارا تركي على صفحة اعتماد ت0 (docs/org/data/decisions-t0.json): د4 «نقل موضع الـ39 إلى صفحات إداراتها في ت1» ود3
// «DAT-PROFITABILITY في صفحة إدارتها». المصدر عمود «الموضع» = «صفحة الإدارة فقط» في docs/org/catalog-mapping.csv (40 صفًّا).
// والحدّيات الأربع عشرة (د2) تبقى في الباب الأمامي فلا تُكتب هنا.
// **هذا موضعُ رسمٍ لا بوابة**: لا يُحذف صفّ من catalog_placement، ولا يُمسّ الجمهور ولا visible ولا required_capability ولا
// department_id — تلك شروط الظهور (service-availability.mjs placedSql: خدمةٌ بلا صفّ إسقاطٍ تصير ظاهرة للجميع). الخدمة هنا
// تغيب عن «حسب الحاجة» و«خدمات مختارة» و«لك» وحدها، وتبقى في صفحة إدارتها وعدسة الإدارة والبحث، ورابطها المباشر يعمل.
// والتقييد الفعلي للجمهور لا يُفرض قبل ت2ب (د4 بنصّه).
export const DEPARTMENT_ONLY=Object.freeze([
  'ACC-BRIEF-INTAKE','ACC-CHANGE-REQUEST','ACC-CLIENT-COMPLAINT','ACC-ESCALATION','ACC-MEETING-MINUTES','ACC-RENEWAL','ACC-STATUS-REPORT',
  'BRAND-ASSET-CREATE','BRAND-NAMING',
  'CRM-HANDOVER','CRM-LOSS','CRM-OPPORTUNITY','CRM-PRICING',
  'DAT-PROFITABILITY','DAT-ROI',
  'DIG-AD-ACCOUNT','DIG-BUDGET-CHANGE','DIG-CAMPAIGN','DIG-CAMPAIGN-CLOSE','DIG-PERFORMANCE-REPORT','DIG-SOCIAL-POST',
  'INF-CAMPAIGN','INF-CONTENT-APPROVAL','INF-CONTRACT','INF-PROOF-PAYMENT',
  'PR-EVENT-MEDIA','PR-IMPACT-REPORT','PR-MEDIA-REQUEST',
  'PRO-DELIVERY','PRO-EDIT-REVIEW','PRO-EQUIPMENT','PRO-EVENT','PRO-FREELANCER','PRO-LOCATION','PRO-SHOOT',
  'STR-CAMPAIGN-PLAN','STR-COMPETITOR','STR-PITCH-SUPPORT','STR-POST-CAMPAIGN','STR-RESEARCH']);
const DEPARTMENT_ONLY_SET=new Set(DEPARTMENT_ONLY);
export const isDepartmentOnly=code=>DEPARTMENT_ONLY_SET.has(String(code??''));
// الباب الأمامي من إسقاطٍ قُرئ بـplacementFor: تُرفع صفوف الأربعين، والمجموعة التي لم يبقَ لها عضو تُرفع معها، وتُعاد العدّادات
// من الصفوف الباقية نفسها — فتبقى الترويسة مجموعَ ما ترسمه البطاقات. والمرفوع يعود في department_rows بترتيبه لا يُرمى.
export function frontDoorView(view){
  const kept=view.rows.filter(r=>!(r.item_kind==='service'&&DEPARTMENT_ONLY_SET.has(r.item_key)));
  const alive=new Set(kept.filter(r=>r.group_key).map(r=>r.group_key));
  const rows=kept.filter(r=>r.item_kind!=='group'||alive.has(r.item_key)),shown=new Set(rows);
  const categories=view.categories.map(category=>{
    const mine=rows.filter(r=>r.category_key===category.key);
    return {...category,rows:mine,cards:mine.filter(r=>r.browse===1).length,items:mine.filter(r=>r.item_kind!=='group').length};
  }).filter(category=>category.rows.length);
  return {...view,categories,rows,department_rows:view.rows.filter(r=>!shown.has(r)),
    totals:{categories:categories.length,cards:categories.reduce((n,c)=>n+c.cards,0),items:categories.reduce((n,c)=>n+c.items,0)}};
}

/* ───── القراءة: «ماذا يرى هذا الحساب في الدليل» — استعلامٌ واحد ───────────── */
// جملة واحدة على catalog_placement للجمهور المحلول، والعدّادات كلها مشتقّة من صفوفها في الذاكرة.
// ومن هنا يستحيل العطب الذي وقع في مسح 20 سبتمبر (S-04): «142 خدمة» في الترويسة فوق «كل الخدمات 127»
// في الشاشة نفسها — لأن الترويسة والبطاقات لم تكونا من عدٍّ واحد. هنا الترويسة **هي** مجموع البطاقات
// بالبناء لا بالمصادفة.
//
// والموقوفة بـ129 لا تدخل أيًّا من الرقمين: تُطرح في الجملة نفسها بـavailableSql (مصدر الشرط الواحد)،
// وتُذكر رقمًا ثالثًا مستقلًا تقرؤه الشاشة من لوح المفاتيح، لا رقمًا مطروحًا بلا خبر.
// gates: سياق أهلية حسابٍ بعينه (gatesFor)، أو 'all' لأسطح الإدارة التي تعدّ الشجرة كلها، أو غيابٌ
// يمرّر غير المشروط وحده. الأحوال الثلاثة وشروحها في app/service-availability.mjs، مصدرًا واحدًا.
export function placementFor(db,tenantId,audience,gates=null){
  const list=Array.isArray(audience)?audience:[audience];
  const audiences=list.filter(a=>AUDIENCE_LIST.includes(a));
  if(!audiences.length)throw new Error('placementFor needs at least one known audience: '+AUDIENCE_LIST.join(', '));
  const marks=audiences.map(()=>'?').join(',');
  const live=db.prepare(`SELECT p.category_key,p.item_kind,p.item_key,p.group_key,p.browse,p.position,p.required_capability,p.department_id,p.audience
    FROM catalog_placement p
    WHERE p.tenant_id=? AND p.audience IN (${marks}) AND p.visible=1 AND ${gateSql('p',gates)}
      AND (p.item_kind<>'service' OR ${availableSql('p','item_key','service')})
    ORDER BY p.category_key,p.position,p.item_key`).all(tenantId,...audiences);
  // مجموعةٌ أُوقف كل أعضائها لا تبقى بطاقةً فارغة في الشبكة ولا في العدّاد. وهذا ما يفعله
  // variantCatalog اليوم في الواجهة (`filter(g=>g.options.length)`)، فلو عُدَّت هنا لظهر الفرقُ نفسه
  // الذي بُنيت هذه الدالة لمنعه: ترويسةٌ تقول رقمًا وشبكةٌ ترسم أقلّ منه.
  const alive=new Set(live.filter(r=>r.group_key).map(r=>r.group_key));
  const rows=live.filter(r=>r.item_kind!=='group'||alive.has(r.item_key));
  const order=new Map(CATEGORIES.map(c=>[c.key,c.position]));
  const categories=CATEGORIES.map(category=>{
    const mine=rows.filter(r=>r.category_key===category.key);
    return {...category,rows:mine,cards:mine.filter(r=>r.browse===1).length,items:mine.filter(r=>r.item_kind!=='group').length};
  }).filter(category=>category.rows.length).sort((a,b)=>order.get(a.key)-order.get(b.key));
  const state=db.prepare('SELECT * FROM catalog_projection_state WHERE tenant_id=?').get(tenantId)??null;
  return {audiences,categories,rows,
    // الترويسة: مجموع البطاقات ومجموع البنود من الصفوف نفسها. لا جملة ثانية، فلا رقمان يفترقان.
    totals:{categories:categories.length,cards:categories.reduce((n,c)=>n+c.cards,0),items:categories.reduce((n,c)=>n+c.items,0)},
    release_version:state?.release_version??0,rebuilt_at:state?.rebuilt_at??null,items_unplaced:state?.items_unplaced??0};
}
