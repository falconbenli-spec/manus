// كتالوج نماذج الشركة: البيانات وحدها، بلا قاعدة بيانات وبلا منطق. forms.mjs يزرعها مسودات مؤرخة بنسخة 1.
//
// **المصدر المعتمد (20 سبتمبر 2026): docs/product/workflow/SOURCE-FILES-VERIFIED.md** — قراءة مباشرة من ملفات درايف
// الأصلية. زُرع هذا الكتالوج أولًا من `SOURCE-APPENDIX.md` (نسخة نصية من برومبت المالك، لم تُفتح منها الملفات)، ثم
// قُرئت الأصول فظهرت فروق مرصودة في `APPENDIX-VS-ORIGINAL.md`. كل تعريف هنا صُحِّح على الأصل، ويذكر سطر مصدره.
// الملحق صار **مصدرًا ثانويًا متجاوَزًا**، ولا يُبنى عليه شيء لم يؤكده الأصل.
//
// ما لم ينص عليه المصدر موسوم inferred:true فتعرضه الشاشة «مقترح — يحتاج اعتماد». وما نص المصدر على أنه قيمة قالب
// أو غير محدد (جولتا التصميم، درجات BANT وحد نجاحه، الحد الأدنى لقيمة المشروع) يبقى مسودة تحتاج قرار مالك.
// وما تعذّرت قراءة ملفه أصلًا موسوم unverified فتعرضه الشاشة «غير مُتحقَّق — الملف غير مقروء» ولا يُقدَّم مُسنَدًا.
//
// المعرّف الداخلي (key) مستقر ولا يتغير. رموز المصدر وأسماؤه كلها تبقى أسماء بديلة: FRM-0xx ورمز الملف (BD-01) ورمز
// النص (MOD-BD-01) والاسم العربي والإنجليزي. المصادر تتنازع رموزًا وأسماء: MOD-01 وMOD-02 مكرران، وملف دليل الأسلوب
// مسمّى VD-03 ومحتواه CW-02، و*Project Handover Minutes* و*Project Kick-off Minutes* و*Kickoff Meeting* تتوزع على
// BD-04 وPM-01 وPM-02 بتعارض بين الفهرس والملفات. كلها أسماء بديلة موسومة ambiguous، والاسم المعروض (title_en) يحمل
// رمز مصدره حتى لا يلتبس نموذج بآخر.
//
// **وسندٌ ثانٍ لنماذج الموارد البشرية.** مجلد «نماذج الموارد البشرية 360» في درايف ليس في فهرس الـ41 ولا في سجلات
// MOD التسعة — التقاطع صفر — فسجل القراءة المباشرة لا يذكره. سند نماذجه الثمانية: `docs/services/DRIVE-FORMS-INVENTORY.md`
// واسم ملف كل نموذج فيه، ومعه `docs/product/workflow/HR-FORMS-SOURCE-REGISTER.json` الذي يذكر لكل نموذج ما قُرئ وما لم يُقرأ.
// فلكل نموذج هنا ملفُ سندِه في `source_doc`، ولا يُحال قارئ إلى وثيقة لا تذكره.
//
// قرار المالك (20 سبتمبر): كل شيء إلكتروني ولا طباعة. سطر التوقيع في النموذج الأصلي ليس حقلًا هنا: سطر توقيع المُعِدّ
// صار إقرار التقديم (author) بهوية مقدّمه ووقته ونسخته، وكل سطر توقيع آخر صار خطوة اعتماد إلكترونية في chain
// موسومة from_signature. لا سطر فارغ للتوقيع ولا صورة توقيع.

export const INFERRED_NOTE='مقترح — يحتاج اعتماد';
export const UNDEFINED_NOTE='غير محدد في المصدر — يحتاج قرار مالك';
export const TEMPLATE_NOTE='قيمة قالب في المصدر — تحتاج قرار مالك';
// قيمة معبأة في القالب الأصلي: تُحمل كما هي وتُعرض على أنها افتراضي القالب، ومن يعبّئ النموذج يغيّرها.
export const TEMPLATE_DEFAULT_NOTE='قيمة معبأة في القالب الأصلي — افتراضي يغيّره من يعبّئ النموذج';
export const UNVERIFIED_NOTE='غير مُتحقَّق — الملف غير مقروء';
export const TRUNCATED_NOTE='ذيل النص مبتور في استخراج المصدر — ما بعده غير متحقَّق';
export const VERIFIED='docs/product/workflow/SOURCE-FILES-VERIFIED.md';
export const APPENDIX='docs/product/workflow/SOURCE-APPENDIX.md';
export const COMPARISON='docs/product/workflow/APPENDIX-VS-ORIGINAL.md';
// سند نماذج الموارد البشرية الثمانية: جرد درايف، وسجل مصادرها الذي يذكر لكل نموذج ما قُرئ منه وما لم يُقرأ ولماذا.
export const HR_INVENTORY='docs/services/DRIVE-FORMS-INVENTORY.md';
export const HR_REGISTER='docs/product/workflow/HR-FORMS-SOURCE-REGISTER.json';
export const HR_FOLDER='نماذج الموارد البشرية 360';
// سند حقلٍ من هذه العائلة: اسم ملف نموذجه في درايف وموضع وصفه في الجرد. يُكتب على كل حقل لأن هذه النماذج
// لا سجل قراءةٍ مباشرة لها كسجل نماذج دورة المشروع؛ سندها الجرد وحده، وما لم يذكره الجرد لا يُقدَّم مسنَدًا.
const hrBasis=(file,where)=>`سنده «${file}» في مجلد «${HR_FOLDER}» — ${HR_INVENTORY} ${where}`;

// ملفان في درايف تعذّرت قراءتهما نهائيًا. ما يستند إليهما لا يُعرض مُسنَدًا، ويُذكر للمالك ليفتحهما بنفسه.
export const UNVERIFIED_SOURCES=[
  {file:'Workflow .key',folder:'دورة العمل للطلب لجميع الإدارات',
    reason:'نوع الملف application/x-iwork-keynote-sffkey مرفوض من أداة القراءة؛ لم يُقرأ منه حرف (SOURCE-FILES-VERIFIED.md §2)',
    rests_on:['وصف المخططات الثلاثة 01–24 وتسلسل بنودها واعتماداتها ومهلها',
      'تعارض المالك رقم 2 «ترتيب التنفيذ قبل التسعير» — مستنده المخطط وحده',
      'الجزء الخاص بـ«المخطط» في تعارض المالك رقم 1 (مسؤول إصدار عرض سعر العميل)'],
    catalogue_impact:'لا حقل ولا بوابة في هذا الكتالوج مبنية عليه: أرقام البنود (step_no) ودوراتها مأخوذة من فهرس Excel المقروء، لا من المخططات.'},
  {file:'طلب عرض السعر RFQ — نسخة 14 سبتمبر 2026',folder:'RFQ',
    reason:'متن المستند صورة PNG واحدة 624×318 ورأس صفحته خالٍ؛ ثلاث طرق استخراج مستقلة أعطت فراغًا (SOURCE-FILES-VERIFIED.md §11.3)',
    rests_on:['العنوان المزعوم One-Year Subscription for EPMO Members',
      'حذف فرع الاشتراكات والتراخيص من هذه النسخة','ترتيب سطر «المجموع قبل VAT»',
      'كل «فرق بين نسخ RFQ» — نسختا 20 أغسطس متطابقتان حرفًا بحرف، والفرق كله منسوب لهذه النسخة غير المقروءة'],
    catalogue_impact:'نموذجا F-03 وF-04 (RFQ ومراجعة المالية) خارج فهرس الـ41 ولم يُبنيا في هذا الكتالوج، فلا شيء هنا يستند إليهما.'},
  // ملفا عائلة المخالفات في مجلد نماذج الموارد البشرية: القالب الورقي لم يُفتح، والتغطية مقيسة من الكود وحده.
  {file:'مخالفة عمل.docx',folder:'نماذج الموارد البشرية 360',
    reason:'مُنع بمصنِّف حماية البيانات الشخصية (PII Data Handling)؛ لم يُحاول الوصول إليه بأداة أخرى (DRIVE-FORMS-INVENTORY.md §7)',
    rests_on:['أقسام «نموذج مخالفة عمل» وحقوله وسطور توقيعه','مطابقة حقلٍ بحقل بين القالب الورقي ووحدة app/discipline.mjs'],
    catalogue_impact:'FORM-HR-MISCONDUCT مبنيٌّ «بانتظار اعتماد المصدر»: حقل الواقعة فيه موسوم غير متحقَّق، وما عداه مسنَد إلى قياس الوحدة لا إلى القالب. وله 35 نسخة معبّأة، أكثر نموذج في الشجرة.'},
  {file:'خطاب الإنذار والخصم.pdf',folder:'نماذج الموارد البشرية 360',
    reason:'لم يُفتح؛ وقف الجرد عن قراءة ملفات هذه العائلة بعد المنع أعلاه (DRIVE-FORMS-INVENTORY.md §7)',
    rests_on:['متن «خطاب الإنذار والخصم» وخاناته وسطور توقيعه'],
    catalogue_impact:'FORM-HR-DISCIPLINE-NOTICE مبنيٌّ «بانتظار اعتماد المصدر»: متن الإشعار موسوم غير متحقَّق، ونوع الجزاء مسنَد إلى PENALTY_KINDS في app/discipline.mjs لا إلى القالب.'}
];

const f=(key,label,label_en,type,extra={})=>({key,label,label_en,type,required:extra.required!==false,inferred:extra.inferred===true,
  ...(extra.options?{options:extra.options}:{}),...(extra.help?{help:extra.help}:{}),...(extra.show_when?{show_when:extra.show_when}:{}),
  ...(extra.min!==undefined?{min:extra.min}:{}),...(extra.max!==undefined?{max:extra.max}:{}),
  ...(extra.max_length!==undefined?{max_length:extra.max_length}:{}),...(extra.min_length!==undefined?{min_length:extra.min_length}:{}),
  ...(extra.weight!==undefined?{weight:extra.weight}:{}),...(extra.undefined_in_source?{undefined_in_source:extra.undefined_in_source}:{}),
  ...(extra.template_default!==undefined?{template_default:extra.template_default}:{}),
  ...(extra.unverified?{unverified:extra.unverified}:{})});
const section=(key,title,owner,fields)=>({key,title,owner,fields});
// تبعية نموذج على نموذج، من عمود «المرفقات / الارتباطات» في فهرس الـ41. كل تبعية تحمل سطر مصدرها.
const needs=(form_key,source)=>({form_key,source});
// إقرار التقديم: الدور الذي كان يوقّع سطر «أعدّه» في النموذج الورقي. التقديم نفسه هو الإقرار.
const author=(title,capability)=>({title,capability});
// خطوة اعتماد إلكترونية. from_signature=true: كانت سطر توقيع في النموذج. false: اعتماد من فهرس المصدر أو من تنبيهه.
const step=(key,title,capability,covers,extra={})=>({key,title,capability,covers,
  from_signature:extra.from_signature===true,...(extra.inferred?{inferred:true}:{}),...(extra.source?{source:extra.source}:{}),
  ...(extra.unverified?{unverified:extra.unverified}:{})});
// بوابة يفرضها نص تنبيه المصدر نفسه، وتُفحص عند الاعتماد الإلكتروني لا عند الحفظ.
const gate=(field,rule,value,message)=>({field,rule,value,message});

// نص متكرر.
const YES_NO=['نعم','لا'];
const ACCOUNT_STEP=(covers)=>step('account_manager','اعتماد مدير الحسابات عند المشاركة','clients.manage',covers,
  {source:'فهرس الـ41: عمود «الاعتماد / الشرط»'});

// الإدارات كما يسميها فهرس المصدر، لا كما تسمّي المنصة إداراتها.
export const FORM_DEPARTMENTS=[
  {code:'BD',name:'تطوير الأعمال'},
  {code:'AM',name:'إدارة الحسابات'},
  {code:'CR',name:'الإبداع'},
  {code:'PROD',name:'الإنتاج'},
  {code:'AD',name:'التسويق الرقمي'},
  {code:'DS',name:'التصميم'},
  {code:'PR',name:'العلاقات العامة والمؤثرون'},
  {code:'CW',name:'المحتوى والترجمة'},
  // اسم مجلد المصدر «نماذج الموارد البشرية 360»؛ والمنصة تسمّي الإدارة نفسها «رأس المال البشري»،
  // وسطور توقيع نماذجها تقول «مدير رأس المال البشري». الاسم هنا اسم المصدر كبقية الصفوف.
  {code:'HR',name:'الموارد البشرية'}
];
const departmentOf=code=>FORM_DEPARTMENTS.find(d=>d.code===code);

// جدول BANT في MOD-BD-01: **سبعة أعمدة في الأصل** لا أربعة. الملحق أسقط «التقييم» و«الدرجة» و«ملاحظات»،
// وهي الأعمدة الثلاثة التي تُنتج الدرجة، فبقيت الأوزان 25/25/30/20 بلا حامل. أُعيدت كلها هنا.
// الأوزان ثابتة في المصدر، والخيارات نصية كما وردت. أما **درجة كل خيار وحد النجاح فغير محددين في المصدر**،
// فالمنصة **تسجّل** ما يكتبه المقيّم في «التقييم» و«الدرجة» **ولا تحسب** درجة ولا تصدر حكم «مؤهل» حتى يضع المالك سلّمًا.
export const BANT_COLUMNS=['المعيار','السؤال','إجابة العميل','التقييم','الوزن','الدرجة','ملاحظات'];
export const BANT=[
  {key:'bant_budget',label:'الميزانية — هل لديهم ميزانية محددة للمشروع؟',options:['محدد','تقريبي','غير محدد'],weight:25},
  {key:'bant_authority',label:'صلاحية القرار — هل المتحدث هو صاحب القرار الفعلي؟',options:['نعم','جزئياً','لا'],weight:25},
  {key:'bant_need',label:'الحاجة الفعلية — هل لديهم حاجة حقيقية لخدماتنا؟',options:['واضحة','محتملة','غير واضحة'],weight:30},
  {key:'bant_timing',label:'التوقيت — متى يريدون البدء؟',options:['فوري','خلال شهر','مستقبلي'],weight:20}
];
// أعمدة «التقييم» و«الدرجة» و«ملاحظات» لكل معيار: مفاتيحها مشتقة من مفتاح المعيار نفسه.
export const bantFieldKeys=key=>({answer:key,assessment:`${key}_assessment`,score:`${key}_score`,notes:`${key}_notes`});
export const BANT_UNDEFINED='درجات الإجابات وحد النجاح والحد الأدنى لقيمة المشروع غير محددة في المصدر (MOD-BD-01). '
  +'المنصة تسجّل «إجابة العميل» و«التقييم» و«الدرجة» كما يكتبها المقيّم، ولا تجمعها ولا تصدر حكم تأهيل آليًا حتى يعتمد المالك سلّم درجات وحد نجاح.';

// قائمة الوثائق الثماني في محضر استلام المشروع، بنصها من المصدر (عمودها في الأصل اسمه «موجودة؟» وبجانبه «ملاحظات»).
export const RECEIPT_DOCUMENTS=['العقد الموقع من الطرفين','ملف تسعير المشروع المعتمد ماليًا','محضر Kick-off مع العميل إن وجد',
  'الملخص الإبداعي المعتمد من العميل','جدول الدفعات','تأكيد استلام الدفعة المقدمة من الإدارة المالية','بيانات جهة التواصل','ملفات وأصول العميل'];
export const ADVANCE_DOCUMENT=RECEIPT_DOCUMENTS[5];

// جدولا الدفعات: **جدولان مختلفان** في الأصل، لا جدول واحد. الملحق نقل جدول BD-04 مكان جدول PM-01.
// الفرق: ترتيب العمودين وتسمية العمود الأول. لكلٍّ أربعة صفوف ثابتة في القالب.
export const BD04_PAYMENT_COLUMNS=['المرحلة / الدفعة','القيمة (ريال)','تاريخ الاستحقاق','شرط الاستحقاق','الحالة','ملاحظات'];
export const PM01_PAYMENT_COLUMNS=['الدفعة','القيمة (ريال)','شرط الاستحقاق','تاريخ الاستحقاق المتوقع','الحالة','ملاحظات'];
export const PAYMENT_ROWS=4;

// منصات AD-01 الست ومنصات AD-02 الثماني، بأسمائها الحرفية من كل ملف. الفرق حقيقي في المصدر:
// AD-02 يفصل Google إلى Search وDisplay ويضيف YouTube Ads.
export const AD01_PLATFORMS=['Meta (Facebook & Instagram)','Google Ads','TikTok Ads','Snapchat Ads','Twitter/X Ads','LinkedIn Ads'];
export const AD02_PLATFORMS=['Meta (Facebook & Instagram)','Google Ads (Search)','Google Ads (Display)','TikTok Ads',
  'Snapchat Ads','Twitter/X Ads','LinkedIn Ads','YouTube Ads'];

// قسما MOD-PR-01 الغائبان عن الملحق كليًا: ست مهام للعلاقات العامة، وأربع شرائح للمؤثرين.
export const PR_DELIVERABLES=[
  {key:'pr_media_kit',label:'حقيبة إعلامية'},
  {key:'pr_talking_points',label:'محاور إعلامية / بنك أسئلة'},
  {key:'pr_press_conference',label:'مؤتمر صحفي / لقاء تعريفي'},
  {key:'pr_supporters_campaign',label:'حملة الجهات الداعمة'},
  {key:'pr_crisis_manual',label:'دليل أزمات'},
  {key:'pr_monitoring_report',label:'تقرير الرصد الإعلامي'}
];
export const INFLUENCER_TIERS=[
  {key:'tier_mega',label:'Mega (1M+)'},
  {key:'tier_macro',label:'Macro (100K-1M)'},
  {key:'tier_micro',label:'Micro (10K-100K)'},
  {key:'tier_nano',label:'Nano (1K-10K)'}
];

// معايير الطول لكل منصة في دليل أسلوب العميل، بنصها من المصدر بأعمدته السبعة.
// صف Twitter/X يحمل تعارض المصدر نفسه (كلمات مقابل حروف). وصفّا المقال والسكريبت يقولان «غير مطلوب» صراحةً
// للإيموجي، و«حسب المدة» للطول الأقصى في السكريبت — وقد وضع الملحق «—» مكانها.
export const STYLE_LENGTHS=[
  'Instagram Caption: المثالي 150-200 كلمة، الأقصى 300 كلمة، 5-10 هاشتاق، الإيموجي مسموح',
  'Twitter/X: المثالي 100-150 كلمة، الأقصى 280 حرف، 2-3 هاشتاق، الإيموجي مسموح',
  'LinkedIn Post: المثالي 200-300 كلمة، الأقصى 500 كلمة، 3-5 هاشتاق، الإيموجي محدود',
  'TikTok Caption: المثالي 50-100 كلمة، الأقصى 150 كلمة، 5-8 هاشتاق، الإيموجي مسموح',
  'مقال / بلوج: المثالي 800-1500 كلمة، الأقصى 2500 كلمة، الهاشتاقات غير مطلوبة، الإيموجي غير مطلوب',
  'سكريبت فيديو: المثالي حسب المدة، الأقصى حسب المدة، الهاشتاقات غير مطلوبة، الإيموجي غير مطلوب'
];

// أعمدة جدول المستفيدين في «طلب صرف تعويض أندية» بنصها من القالب كما نقلها الجرد §6.4. عدد صفوف القالب غير مسجّل.
export const SPORTS_CLUB_COLUMNS=['الرقم الوظيفي','اسم الموظف','المسمى','تاريخ المباشرة','إجمالي التعويض'];

export const FORM_CATALOGUE=[
  {
    key:'FORM-BD-QUALIFY',frm:'FRM-001',step_no:1,cycle:'تجهيز المشروع',department:'BD',mandate:'إلزامي',
    classification:'تأهيل',
    title:'تأهيل العميل المحتمل',title_en:'Lead Qualification Form (MOD-BD-01)',
    aliases:{code:['FRM-001','BD-01','MOD-BD-01'],name_ar:['تأهيل العميل المحتمل'],
      name_en:['Lead Qualification Form','Potential Customer Qualification'],
      ambiguous:{'Lead Qualification Form':'اسم رأس الملف؛ والفهرس يسمّي النموذج نفسه Potential Customer Qualification',
        'Potential Customer Qualification':'اسم الفهرس؛ والملف نفسه يسمّيه Lead Qualification Form'}},
    subject_kinds:['opportunity','project'],
    warnings:['جدول BANT في الأصل **سبعة أعمدة**: المعيار، السؤال، إجابة العميل، التقييم، الوزن، الدرجة، ملاحظات. '
      +'الملحق نقل أربعة وأسقط التقييم والدرجة والملاحظات (APPENDIX-VS-ORIGINAL.md الفرق #4)، وقد أُعيدت.',
      'غير محدد في المصدر: درجة كل خيار، وحد النجاح، والحد الأدنى لقيمة المشروع. المنصة تسجّل التقييم والدرجة كما يكتبهما المقيّم ولا تجمعهما ولا تحكم بالتأهيل.',
      'تعارض تسمية (ج10): الملف يسمّيه Lead Qualification Form والفهرس يسمّيه Potential Customer Qualification. الاسمان محفوظان بديلين، والمعروض يحمل رمز المصدر.'],
    sections:[
      section('meta','بيانات النموذج','تطوير الأعمال',[
        f('form_serial','رقم النموذج','Form serial','text',{required:false,max_length:60,
          help:'المصدر يضع النمط MOD-BD-01-____ . تاريخ التعبئة واسم المعبئ ومسماه لا حقول هنا: هي إقرار التقديم الإلكتروني بهوية من قدّمه ووقته.'})
      ]),
      section('client','بيانات العميل','تطوير الأعمال',[
        f('company','اسم الشركة','Company','text',{max_length:180}),
        f('sector','القطاع','Sector','text',{max_length:120}),
        f('contact_name','اسم جهة التواصل','Contact name','text',{max_length:180}),
        f('contact_title','المسمى الوظيفي لجهة التواصل','Contact title','text',{max_length:120}),
        f('contact_email','البريد','Email','text',{max_length:180}),
        f('contact_phone','الهاتف','Phone','text',{max_length:60}),
        f('reached_us','كيف وصلنا للعميل؟','How we reached the client','textarea',{max_length:1500})
      ]),
      // سبعة أعمدة كما في الأصل: المعيار والسؤال في اسم الحقل، ثم إجابة العميل والتقييم والوزن والدرجة والملاحظات.
      section('bant','تقييم الفرصة (BANT Framework)','تطوير الأعمال',BANT.flatMap(b=>{
        const k=bantFieldKeys(b.key);
        return [
          f(k.answer,`${b.label} — إجابة العميل (الوزن ${b.weight}%)`,'','select',
            {options:b.options,weight:b.weight,help:BANT_UNDEFINED,undefined_in_source:'درجة الخيار وحد النجاح'}),
          f(k.assessment,`${b.label} — التقييم`,'','text',{required:false,max_length:180,
            undefined_in_source:'مقياس التقييم',help:'عمود «التقييم» في الأصل. المصدر لا يضع له مقياسًا، فيُسجَّل نصًا كما يكتبه المقيّم. '+UNDEFINED_NOTE}),
          f(k.score,`${b.label} — الدرجة`,'','number',{required:false,min:0,max:100,
            undefined_in_source:'سلّم الدرجات وحد النجاح',help:'عمود «الدرجة» في الأصل. تُسجَّل ولا تُجمع: لا سلّم درجات ولا حد نجاح في المصدر. '+UNDEFINED_NOTE}),
          f(k.notes,`${b.label} — ملاحظات`,'','text',{required:false,max_length:500,help:'عمود «ملاحظات» في الأصل.'})
        ];
      })),
      section('fit','ملاءمة الخدمة','تطوير الأعمال',[
        f('services','الخدمات المطلوبة','Requested services','textarea',{max_length:2000}),
        f('expected_value','القيمة المتوقعة','Expected value','text',{max_length:120}),
        f('above_minimum','هل تتجاوز الحد الأدنى للمشاريع؟','Above the project minimum?','select',
          {options:['نعم','لا','الحد الأدنى غير محدد'],inferred:true,undefined_in_source:'الحد الأدنى لقيمة المشروع',
            help:'المصدر يقول «يجب تحديد الحد الأدنى» ولا يذكر رقمًا. '+UNDEFINED_NOTE}),
        f('duration','المدة','Duration','text',{max_length:120}),
        f('capacity','الطاقة الاستيعابية','Capacity','textarea',{max_length:1500}),
        f('experience','الخبرة','Experience','textarea',{max_length:1500})
      ]),
      section('decision','القرار','تطوير الأعمال',[
        f('decision','قرار التأهيل','Decision','select',{options:['مؤهل','غير مؤهل','يحتاج مزيداً من المعلومات']}),
        // الأصل يعطي الأولوية ثلاثة خيارات، ولم ينقلها الملحق.
        f('priority','الأولوية','Priority','select',{options:['عالية','متوسطة','منخفضة']}),
        f('justification','المبررات','Justification','textarea',{max_length:2500}),
        f('next_step','الخطوة التالية','Next step','textarea',{max_length:1500})
      ])
    ],
    author:author('أعدّه أخصائي تطوير الأعمال','commercial.use'),
    chain:[step('bd_manager','توقيع مدير تطوير الأعمال (اعتماد مدير الإدارة)','commercial.use',['client','bant','fit','decision'],
      {from_signature:true,source:'MOD-BD-01: «توقيع مدير تطوير الأعمال والتاريخ»؛ وفهرس الـ41: اعتماد مدير الإدارة'})],
    attachments:{allowed:true,max:5,note:'مراسلات العميل وما يسند درجات التقييم.'}
  },
  {
    key:'FORM-BD-HANDOVER',frm:'FRM-002',step_no:1,cycle:'تجهيز المشروع',department:'BD',mandate:'إلزامي',
    classification:'استلام وتسليم',
    // تعارض الأسماء الثلاثي: الفهرس يسمّيه Project Handover Minutes، ورأس الملف نفسه يسمّيه Project Kick-off Minutes،
    // والاسم الأول هو اسم PM-01 داخل ملفه. الاسم المعروض يحمل رمز المصدر حتى لا يلتبس الثلاثة.
    title:'محضر تسليم المشروع لفريق التنفيذ',title_en:'Project Handover Minutes (MOD-BD-04)',
    aliases:{code:['FRM-002','BD-04','MOD-BD-04'],name_ar:['محضر تسليم المشروع','محضر تسليم المشروع لفريق التنفيذ'],
      name_en:['Project Handover Minutes','Project Kick-off Minutes'],
      ambiguous:{'Project Handover Minutes':'اسم الفهرس لهذا النموذج، وهو نفسه الاسم الإنجليزي داخل ملف MOD-PM-01',
        'Project Kick-off Minutes':'اسم رأس ملف MOD-BD-04 نفسه، ويخالف اسم الفهرس'}},
    subject_kinds:['project','opportunity'],
    warnings:['تعارض تسمية ثلاثي (الفرق #7): الفهرس يسمّي هذا النموذج Project Handover Minutes، ورأس ملفه يسمّيه '
      +'Project Kick-off Minutes، والاسم الأول هو اسم MOD-PM-01 داخل ملفه، وKickoff Meeting اسم MOD-PM-02 في الفهرس. '
      +'الأسماء كلها محفوظة بديلة موسومة، والمعروض يحمل رمز المصدر. يحتاج قرار مالك لحسم الاسم الرسمي.'],
    sections:[
      section('deal','بيانات المشروع والتعاقد','تطوير الأعمال',[
        f('project_name','اسم المشروع','Project name','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('contract_date','تاريخ توقيع العقد','Contract signature date','date'),
        f('kickoff_date','تاريخ اجتماع Kick-off','Kick-off date','date',{required:false}),
        f('project_manager','مدير المشروع المعين','Assigned project manager','text',{max_length:180}),
        f('bd_manager','مدير تطوير الأعمال','Business development manager','text',{max_length:180}),
        f('contract_value','قيمة العقد','Contract value','text',{max_length:120}),
        f('advance_received','الدفعة المقدمة المستلمة','Advance payment received','text',{max_length:120}),
        f('advance_date','تاريخ استلام الدفعة المقدمة','Advance payment date','date',{required:false})
      ]),
      section('scope','النطاق والمخرجات','تطوير الأعمال',[
        f('services','الخدمات المتفق عليها','Agreed services','textarea',{max_length:3000}),
        f('deliverables','المخرجات الرئيسية','Key deliverables','textarea',{max_length:3000}),
        f('timeline','الجدول الزمني','Timeline','textarea',{max_length:2000}),
        f('revision_rounds','عدد جولات التعديل','Revision rounds','text',{max_length:60}),
        f('channels','قنوات التواصل','Communication channels','textarea',{max_length:1000}),
        f('main_contact','جهة التواصل الرئيسية','Main contact','text',{max_length:180})
      ]),
      // جدول دفعات BD-04 غير جدول PM-01: هنا «المرحلة / الدفعة» ثم القيمة ثم **تاريخ الاستحقاق قبل شرط الاستحقاق**.
      section('payments','جدول الدفعات','تطوير الأعمال',[
        f('payment_schedule',BD04_PAYMENT_COLUMNS.join('، '),'Payment schedule (BD-04 column order)','textarea',{max_length:3000,
          help:`أعمدة هذا الجدول بترتيب MOD-BD-04: ${BD04_PAYMENT_COLUMNS.join(' · ')}. القالب الأصلي ${PAYMENT_ROWS} صفوف ثابتة. `
            +'جدول MOD-PM-01 يعكس عمودَي الشرط والتاريخ ويسمّي الأول «الدفعة»، وهما جدولان مختلفان.'})
      ]),
      section('risks','المخاطر والمتطلبات الخاصة','تطوير الأعمال',[
        f('risks','نقاط المخاطرة المحتملة','Potential risks','textarea',{required:false,max_length:2500}),
        f('special_requirements','متطلبات خاصة من العميل','Special client requirements','textarea',{required:false,max_length:2500})
      ])
    ],
    author:author('أعدّه مدير تطوير الأعمال','commercial.use'),
    chain:[step('pm_assigned','توقيع مدير المشروع المعين','projects.use',['deal','scope','payments','risks'],
      {from_signature:true,source:'MOD-BD-04: «توقيع مدير تطوير الأعمال ومدير المشروع المعين»'})],
    attachments:{allowed:true,max:8,note:'العقد وجدول الدفعات وما يثبت استلام الدفعة المقدمة.'}
  },
  {
    key:'FORM-PM-RECEIPT',frm:'FRM-003',step_no:2,cycle:'تجهيز المشروع',department:'AM',mandate:'إلزامي',
    classification:'إحاطة',
    title:'محضر استلام المشروع',title_en:'Project Handover Minutes (MOD-PM-01)',
    aliases:{code:['FRM-003','PM-01','MOD-PM-01'],name_ar:['محضر استلام المشروع','موجز استلام المشروع','محضر استلام المشروع من تطوير الأعمال'],
      name_en:['Project Handover Minutes','Project Receipt Brief'],
      ambiguous:{'Project Handover Minutes':'اسم رأس ملف MOD-PM-01، وهو نفسه اسم MOD-BD-04 في الفهرس',
        'Project Receipt Brief':'اسم الفهرس لهذا النموذج، ولا يرد في رأس الملف'}},
    subject_kinds:['project'],
    // تصحيح: الأصل يوقف التنفيذ على **التحقق من استلام الدفعة المقدمة وحدها**. «وتوقيع المحضر» زيادة لا سند لها في المصدر.
    warnings:['تنبيه المصدر (MOD-PM-01) حرفيًا: «لا يُبدأ في أي عمل تنفيذي قبل التحقق من استلام الدفعة المقدمة». '
      +'شرط «وتوقيع المحضر» كان مضافًا في النسخة المزروعة ولا سند له في الأصل، وقد حُذف (الفرق #6).',
      'تعارض تسمية ثلاثي (الفرق #7): Project Handover Minutes اسم رأس هذا الملف، وهو نفسه اسم MOD-BD-04 في الفهرس. الاسم المعروض يحمل رمز المصدر.',
      'مصالحة مطلوبة: ترحيل 109 (استقبال المشاريع) يطبّق نسخة ثلاثية الشروط لهذه البوابة. الأصل شرط واحد. يجب التوفيق بينهما قبل الدمج.'],
    sections:[
      section('receipt','بيانات الاستلام','إدارة الحسابات',[
        f('minutes_serial','رقم المحضر','Minutes serial','text',{required:false,max_length:60,
          help:'المصدر يضع النمط HO-PM-____ ، ولم ينقله الملحق.'}),
        f('received_on','تاريخ الاستلام','Receipt date','date'),
        f('project_name','المشروع','Project','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('contract_value','قيمة العقد','Contract value','text',{max_length:120}),
        f('handed_by','المُسلِّم (مدير تطوير الأعمال)','Handed over by','text',{max_length:180}),
        f('received_by','المُستلِم (مدير المشروع)','Received by','text',{max_length:180})
      ]),
      // عمودا الأصل: «موجودة؟» و«ملاحظات». الملحق سمّى الأول «نعم/لا» وأغفل الثاني، فكان حقل الملاحظات موسومًا مقترحًا.
      section('documents','الوثائق المستلمة','إدارة الحسابات',[
        f('documents_received','موجودة؟ — أشِّر كل وثيقة مستلمة','Received?','checks',
          {options:RECEIPT_DOCUMENTS,help:'ثمانية بنود بنصها في المصدر، وعمودها في الأصل اسمه «موجودة؟» بخياري نعم / لا. البند غير المؤشَّر يعني «لا»، ويُذكر سببه ومن يورّده في عمود الملاحظات.'}),
        f('missing_note','ملاحظات — ما لم يُستلم، ومن يورّده، ومتى','Notes','textarea',{required:false,max_length:2500,
          help:'عمود «ملاحظات» بجانب «موجودة؟» في الأصل.'})
      ]),
      section('scope','ملخص النطاق','إدارة الحسابات',[
        f('services','الخدمات بالتفصيل','Services in detail','textarea',{max_length:3000}),
        f('deliverables','المخرجات','Deliverables','textarea',{max_length:3000}),
        f('timeline','الجدول الزمني','Timeline','textarea',{max_length:2000}),
        f('rounds_per_deliverable','عدد جولات التعديل لكل مخرج','Revision rounds per deliverable','textarea',{max_length:1500}),
        f('channels','قنوات التواصل','Communication channels','textarea',{max_length:1000}),
        f('special_notes','ملاحظات خاصة','Special notes','textarea',{required:false,max_length:2000})
      ]),
      // جدول دفعات PM-01: «الدفعة» ثم القيمة ثم **شرط الاستحقاق قبل تاريخ الاستحقاق المتوقع** — عكس ترتيب BD-04.
      section('payments','جدول الدفعات','إدارة الحسابات',[
        f('payment_schedule',PM01_PAYMENT_COLUMNS.join('، '),'Payment schedule (PM-01 column order)','textarea',{max_length:3000,
          help:`أعمدة هذا الجدول بترتيب MOD-PM-01: ${PM01_PAYMENT_COLUMNS.join(' · ')}. القالب الأصلي ${PAYMENT_ROWS} صفوف ثابتة. `
            +'جدول MOD-BD-04 يسمّي العمود الأول «المرحلة / الدفعة» ويضع تاريخ الاستحقاق قبل شرطه، وهما جدولان مختلفان.'})
      ])
    ],
    author:author('استلمه مدير المشروع (المُستلِم)','projects.use'),
    chain:[
      step('handover_bd','توقيع المُسلِّم — مدير تطوير الأعمال','commercial.use',['receipt','documents'],
        {from_signature:true,source:'MOD-PM-01: التوقيعان'}),
      step('dept_manager','اعتماد مدير الإدارة','projects.use',['receipt','documents','scope','payments'],
        {source:'فهرس الـ41: مدير الإدارة + مدير الحسابات + EPMO'}),
      step('account_manager','اعتماد مدير الحسابات','clients.manage',['receipt','documents','scope','payments'],
        {source:'فهرس الـ41: مدير الإدارة + مدير الحسابات + EPMO'}),
      step('epmo','اعتماد فريق EPMO','epmo.review',['receipt','documents','scope','payments'],
        {source:'فهرس الـ41: مدير الإدارة + مدير الحسابات + EPMO'})],
    // بوابة واحدة بشرط واحد: التحقق من استلام الدفعة المقدمة. لا شرط توقيع — ليس في المصدر.
    gates:[gate('documents_received','includes',ADVANCE_DOCUMENT,
      'تنبيه المصدر (MOD-PM-01): لا يُبدأ في أي عمل تنفيذي قبل التحقق من استلام الدفعة المقدمة. أشِّر بند «'+ADVANCE_DOCUMENT+'» قبل الاعتماد.')],
    attachments:{allowed:true,max:10,note:'نسخ الوثائق الثماني أو ما توفر منها.'}
  },
  {
    key:'FORM-PM-KICKOFF',frm:'FRM-004',step_no:2,cycle:'تجهيز المشروع',department:'AM',mandate:'مشروط: إن وجد',
    classification:'اجتماع وتنسيق',
    title:'محضر اجتماع بدء المشروع (Kick-off)',title_en:'Kickoff Meeting (MOD-PM-02)',
    aliases:{code:['FRM-004','PM-02','MOD-PM-02'],name_ar:['اجتماع بدء المشروع','محضر اجتماع Kick-off','محضر اجتماع Kick-off مع العميل'],
      name_en:['Kickoff Meeting'],
      ambiguous:{'Kickoff Meeting':'اسم الفهرس وحده؛ **لا اسم إنجليزي في رأس ملف MOD-PM-02**، وملف MOD-BD-04 يسمّي نفسه Project Kick-off Minutes'}},
    subject_kinds:['project'],
    warnings:['رأس ملف MOD-PM-02 **بلا اسم إنجليزي**؛ Kickoff Meeting اسم الفهرس وحده، وملف MOD-BD-04 يسمّي نفسه '
      +'Project Kick-off Minutes. الاسم المعروض يحمل رمز المصدر (الفرق #7).'],
    sections:[
      section('meeting','الاجتماع','إدارة الحسابات',[
        f('project_name','المشروع','Project','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('mode','طريقة الاجتماع','Meeting mode','select',{options:['حضوري','أونلاين','هجين']}),
        f('project_manager','مدير المشروع','Project manager','text',{max_length:180}),
        f('client_contact','جهة التواصل لدى العميل','Client contact','text',{max_length:180}),
        f('attendees','الحضور (الاسم، المسمى الوظيفي، الجهة)','Attendees','textarea',{max_length:2500,
          help:'القالب الأصلي ستة صفوف ثابتة (1–6). الجدول هنا مفتوح؛ تثبيت السعة يحتاج قرار مالك.'})
      ]),
      section('agreements','الاتفاقيات','إدارة الحسابات',[
        f('final_scope','نطاق العمل النهائي','Final scope','textarea',{max_length:3000}),
        f('deliverables','المخرجات','Deliverables','textarea',{max_length:3000}),
        f('milestones','الجدول والمعالم','Schedule and milestones','textarea',{max_length:2500}),
        f('revision_rounds','عدد جولات التعديل','Revision rounds','text',{max_length:60}),
        f('official_channel','قناة التواصل الرسمية','Official channel','text',{max_length:180}),
        f('followup_meetings','موعد ومنهجية اجتماعات المتابعة','Follow-up meetings','textarea',{max_length:1500}),
        f('approval_policy','سياسة الموافقة على المخرجات ومدة الرد','Deliverable approval policy and response time','textarea',{max_length:2000}),
        f('constraints','متطلبات أو قيود خاصة','Special requirements or constraints','textarea',{required:false,max_length:2000})
      ]),
      section('clarified','نقاط توضَّح للعميل','إدارة الحسابات',[
        f('clarified_points','النقاط التي وُضّحت','Points clarified','checks',
          {options:['سياسة التعديلات داخل النطاق وخارجه','طلب التعديلات كتابيًا فقط','الموافقة قبل النشر',
            'تأخر التسليم من جانب العميل','سياسة الإلغاء والغرامات حسب العقد']})
      ])
    ],
    author:author('أعدّه مدير المشروع','projects.use'),
    chain:[
      step('dept_manager','اعتماد مدير الإدارة','projects.use',['meeting','agreements','clarified'],{source:'فهرس الـ41'}),
      step('account_manager','اعتماد مدير الحسابات','clients.manage',['meeting','agreements','clarified'],{source:'فهرس الـ41'}),
      step('epmo','اعتماد فريق EPMO','epmo.review',['meeting','agreements','clarified'],{source:'فهرس الـ41'})],
    attachments:{allowed:true,max:5,note:'محضر الاجتماع وما عُرض فيه.'}
  },
  {
    key:'FORM-PM-CHANGE',frm:'FRM-005',step_no:2,cycle:'تجهيز المشروع',department:'AM',mandate:'مشروط: عند وجود طلب',
    classification:'طلب',
    title:'طلب تعديل',title_en:'Change Request Form (MOD-PM-03)',
    aliases:{code:['FRM-005','PM-03','MOD-PM-03'],name_ar:['طلب تعديل','نموذج طلب التعديل'],name_en:['Change Request','Change Request Form']},
    subject_kinds:['project'],
    warnings:['اختبار القبول 9 في المصدر: تجاوز الجولات أو تغيير الفكرة جذريًا يولّد طلب تغيير، ولا يغيّر العقد والسعر بصمت.',
      'تصادم بادئات الترقيم في المصدر (ج5): رقم الطلب هنا CR-PM-____ ورقم طلب الحملة في MOD-AD-01 هو CR-AD-____ . البادئة CR تحمل معنيين.',
      'بنية الأصل: «تصنيف التعديل» و«هل استُنفدت الجولات» تحت قسم مستقل اسمه «تقييم مدير المشروع» لا تحت تفاصيل التعديل. صُحِّحت هنا.'],
    sections:[
      section('request','بيانات الطلب','إدارة الحسابات',[
        f('request_serial','رقم الطلب','Request serial','text',{required:false,max_length:60,
          help:'المصدر يضع النمط CR-PM-____ ، ويتصادم بادئةً مع CR-AD-____ في MOD-AD-01.'}),
        f('requested_on','تاريخ الطلب','Request date','date'),
        f('project_name','المشروع','Project','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('project_manager','مدير المشروع','Project manager','text',{max_length:180}),
        f('round_no','رقم جولة التعديل','Revision round number','number',{min:1,max:99})
      ]),
      section('details','تفاصيل التعديل المطلوب','إدارة الحسابات',[
        f('description','وصف التعديل المطلوب بالتفصيل','Description','textarea',{max_length:3000}),
        f('affected','المخرج / المرحلة المتأثرة','Affected deliverable or stage','textarea',{max_length:1500}),
        f('client_reason','سبب طلب التعديل (من العميل)','Client reason','textarea',{max_length:2000})
      ]),
      // قسم مستقل في الأصل: تصنيف التعديل واستنفاد الجولات مع الأثر على الجدول والميزانية والتكلفة.
      section('impact','تقييم مدير المشروع','إدارة الحسابات',[
        f('classification','تصنيف التعديل','Classification','text',{max_length:180}),
        f('free_rounds_used','هل استُنفدت جولات التعديل المجانية؟','Free rounds exhausted?','select',{options:YES_NO}),
        f('schedule_impact','الأثر على الجدول الزمني','Schedule impact','textarea',{max_length:1500}),
        f('budget_impact','الأثر على الميزانية (ريال)','Budget impact','textarea',{max_length:1500}),
        f('extra_cost','التكلفة الإضافية المقترحة (إن وجدت)','Proposed extra cost','text',{required:false,max_length:120,
          show_when:{field:'free_rounds_used',equals:'نعم'}})
      ]),
      section('approval','الاعتماد والتنفيذ','إدارة الحسابات',[
        f('client_cost_approval','موافقة العميل على التكلفة الإضافية','Client approved the extra cost','select',{options:['نعم','لا','غير مطلوبة'],inferred:true}),
        f('start_date','تاريخ بدء التنفيذ','Execution start date','date',{required:false})
      ])
    ],
    author:author('رفعه مدير المشروع','projects.use'),
    chain:[
      step('finance','قرار الإدارة المالية للتعديلات المدفوعة','finance.use',['impact','approval'],
        {from_signature:true,source:'MOD-PM-03: «قرار الإدارة المالية للتعديلات المدفوعة»'}),
      step('dept_manager','اعتماد مدير الإدارة','projects.use',['request','details','impact','approval'],{source:'فهرس الـ41'}),
      step('account_manager','اعتماد مدير الحسابات','clients.manage',['request','details','impact','approval'],{source:'فهرس الـ41'}),
      step('epmo','اعتماد فريق EPMO','epmo.review',['request','details','impact','approval'],{source:'فهرس الـ41'})],
    attachments:{allowed:true,max:5,note:'طلب العميل كما ورد كتابيًا.'}
  },
  {
    key:'FORM-CR-BRIEF',frm:'FRM-006',step_no:3,cycle:'تجهيز المشروع',department:'CR',mandate:'حسب النطاق',
    classification:'إحاطة',
    title:'الملخص الإبداعي',title_en:'Creative Brief (MOD-CR-01)',
    aliases:{code:['FRM-006','MOD-01','MOD-CR-01'],name_ar:['الموجز الإبداعي','الملخص الإبداعي'],name_en:['Creative Brief']},
    subject_kinds:['project'],
    // تصحيح: تنبيه الأصل ينتهي عند «من الطرفين»، وذيله يبدو كاملًا. «واكتمال بياناته» زيادة لا سند لها.
    warnings:['تنبيه المصدر (MOD-CR-01) حرفيًا: «لا يبدأ أي عمل إبداعي قبل توقيع هذا الملخص من الطرفين». '
      +'عبارة «واكتمال بياناته» كانت مضافة في النسخة المزروعة وحُذفت.'],
    sections:[
      section('meta','بيانات المهمة','الإبداع',[
        f('brief_serial','رقم الملخص','Brief serial','text',{required:false,max_length:60,help:'المصدر يضع النمط CB-CR-____ .'}),
        f('issued_on','تاريخ الإصدار','Issue date','date'),
        f('project_name','المشروع / الحملة','Project or campaign','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('project_manager','مدير المشروع','Project manager','text',{max_length:180}),
        f('creative_director','المدير الإبداعي المعين','Assigned creative director','text',{max_length:180}),
        f('due_date','تاريخ التسليم','Delivery date','date')
      ]),
      section('goal','الهدف والجمهور','الإبداع',[
        f('objective','هدف المهمة','Objective','textarea',{max_length:2000}),
        f('audience','الجمهور المستهدف','Target audience','textarea',{max_length:2000}),
        f('key_message','الرسالة الأساسية','Key message','textarea',{max_length:1500}),
        f('tone','نبرة الصوت','Tone of voice','text',{max_length:180})
      ]),
      section('outputs','المخرجات المطلوبة','الإبداع',[
        f('deliverables','نوع المخرج، المواصفات التقنية، المنصة / الاستخدام، الكمية، تاريخ التسليم، ملاحظات','Deliverables','textarea',
          {max_length:3000,help:'القالب الأصلي ستة صفوف ثابتة.'})
      ]),
      section('requirements','المتطلبات','الإبداع',[
        f('colors_required','الألوان المطلوبة','Required colours','textarea',{required:false,max_length:1000}),
        f('colors_forbidden','الألوان المحظورة','Forbidden colours','textarea',{required:false,max_length:1000}),
        f('fonts','الخطوط','Fonts','textarea',{required:false,max_length:1000}),
        f('imagery','الصور والأيقونات','Images and icons','textarea',{required:false,max_length:1500}),
        f('mandatory_text','النصوص الإلزامية','Mandatory text','textarea',{required:false,max_length:1500}),
        f('prohibited','المحظورات','Prohibitions','textarea',{required:false,max_length:1500}),
        f('references','مراجع إبداعية','Creative references','textarea',{required:false,max_length:1500})
      ]),
      section('revisions','سياسة التعديلات','الإبداع',[
        f('free_rounds','عدد الجولات المجانية','Free revision rounds','number',{min:0,max:99,
          help:'المصدر يربطها باتفاق المشروع ولا يثبّت رقمًا هنا (تعارض 7).'}),
        f('feedback_method','آلية تقديم الملاحظات','Feedback method','textarea',{max_length:1500}),
        f('client_response_time','مدة رد العميل','Client response time','text',{max_length:120})
      ])
    ],
    author:author('أعدّه مدير المشروع','projects.use'),
    chain:[step('creative_director','توقيع المدير الإبداعي','studio.use',['meta','goal','outputs','requirements','revisions'],
      {from_signature:true,source:'MOD-CR-01: التوقيعان'}),
      ACCOUNT_STEP(['meta','goal','outputs','requirements','revisions'])],
    attachments:{allowed:true,max:8,note:'المراجع البصرية وأصول العميل.'}
  },
  {
    key:'FORM-CR-CONCEPT',frm:'FRM-007',step_no:3,cycle:'تجهيز المشروع',department:'CR',mandate:'حسب النطاق',
    classification:'اعتماد',
    depends_on:[needs('FORM-CR-BRIEF','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-007: «مرفق: الموجز الإبداعي»')],
    title:'موافقة الفكرة',title_en:'Concept Approval Form (MOD-CR-02)',
    aliases:{code:['FRM-007','MOD-02','MOD-CR-02'],name_ar:['موافقة الفكرة','موافقة العميل على الفكرة الإبداعية'],name_en:['Concept Approval','Concept Approval Form']},
    subject_kinds:['project'],
    warnings:['ملاحظة المصدر (MOD-CR-02): التوقيع يعني موافقة كاملة، وأي تغيير جذري بعده خارج النطاق ويستوجب تسعيرًا إضافيًا.'],
    sections:[
      section('meta','بيانات العرض','الإبداع',[
        f('project_name','المشروع','Project','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('presentation_mode','طريقة العرض','Presentation mode','select',{options:['حضوري','أونلاين','بريد']})
      ]),
      section('proposals','المقترحات الإبداعية المعروضة','الإبداع',[
        f('proposals','اسم المقترح، وصف الفكرة، نقاط القوة، ملاحظات العميل، قرار العميل','Proposals','textarea',
          {max_length:4000,help:'القالب الأصلي ثلاثة صفوف مقترحات ثابتة.'})
      ]),
      section('decision','الفكرة المختارة','الإبداع',[
        f('chosen_concept','الفكرة المختارة','Chosen concept','text',{max_length:180}),
        f('client_decision','قرار العميل','Client decision','select',{options:['معتمدة','معتمدة بتعديلات','مرفوضة'],inferred:true}),
        f('changes','تعديلات على الفكرة','Changes to the concept','textarea',{required:false,inferred:true,max_length:2500,
          show_when:{field:'client_decision',equals:'معتمدة بتعديلات'}}),
        f('notes','ملاحظات إضافية','Additional notes','textarea',{required:false,max_length:2000})
      ])
    ],
    author:author('قدّمه المدير الإبداعي','studio.use'),
    chain:[step('client_sign','توثيق توقيع جهة التواصل لدى العميل','approvals.record',['proposals','decision'],
      {from_signature:true,source:'MOD-CR-02: «توقيع المدير الإبداعي وجهة التواصل لدى العميل»'}),
      ACCOUNT_STEP(['meta','proposals','decision'])],
    gates:[gate('client_decision','not_equals','مرفوضة',
      'ملاحظة المصدر (MOD-CR-02): التوقيع موافقة كاملة. فكرة قرارها «مرفوضة» لا تُعتمد؛ سجّل فكرة أخرى أو نسخة جديدة.')],
    attachments:{allowed:true,max:8,note:'ملفات العرض والمرئيات كما عُرضت.'}
  },
  {
    key:'FORM-PROD-BRIEF',frm:'FRM-008',step_no:4,cycle:'تجهيز المشروع',department:'PROD',mandate:'حسب النطاق',
    classification:'إحاطة',
    title:'موجز الإنتاج',title_en:'Production Brief (MOD-PROD-01)',
    // اسم الملف MOD-VD-01 ومحتواه MOD-PROD-01 (تعارض 3).
    aliases:{code:['FRM-008','PROD-01','MOD-PROD-01','VD-01'],name_ar:['موجز الإنتاج','نموذج طلب الإنتاج'],name_en:['Production Brief'],
      ambiguous:{'VD-01':'اسم ملف هذا النموذج MOD-VD-01 ومحتواه MOD-PROD-01؛ ليس معرّفًا'}},
    subject_kinds:['project'],
    warnings:['تنبيه المصدر (MOD-PROD-01) **مبتور** كما استُخرج: «لا يبدأ أي عمل إنتاجي قبل توقيع هذا النموذج واكتمال جميع بياناته والحصول…». '
      +'ما بعد «والحصول» غير متحقَّق. النسخة المزروعة كانت تكمله بـ«الموافقة المالية»، وهي ترجيح لا نص، فصارت خطوة المالية موسومة غير متحقَّقة.'],
    sections:[
      section('meta','بيانات الطلب','الإنتاج',[
        f('brief_serial','رقم الطلب','Request serial','text',{required:false,max_length:60,help:'المصدر يضع النمط PB-PROD-____ .'}),
        f('requested_on','تاريخ الطلب','Request date','date'),
        f('project_name','المشروع','Project','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('project_manager','مدير المشروع','Project manager','text',{max_length:180}),
        f('production_type','نوع الإنتاج','Production type','select',{options:['فيديو','تصوير','موشن','بودكاست','أخرى']}),
        f('production_type_other','اذكر نوع الإنتاج','Describe the production type','text',
          {required:false,inferred:true,max_length:180,show_when:{field:'production_type',equals:'أخرى'}}),
        f('due_date','تاريخ التسليم','Delivery date','date')
      ]),
      section('goal','الهدف والأسلوب','الإنتاج',[
        f('objective','هدف المنتج','Objective','textarea',{max_length:2000}),
        f('audience','الجمهور','Audience','textarea',{max_length:1500}),
        f('key_message','الرسالة','Message','textarea',{max_length:1500}),
        f('visual_style','الأسلوب البصري','Visual style','textarea',{max_length:1500})
      ]),
      section('outputs','المخرجات المطلوبة','الإنتاج',[
        f('deliverables','نوع المخرج، المدة / الحجم، الصيغة المطلوبة، الأبعاد / الدقة، الاستخدام / المنصة، ملاحظات','Deliverables','textarea',
          {max_length:3000,help:'القالب الأصلي خمسة صفوف ثابتة.'})
      ]),
      section('extras','المتطلبات الإضافية','الإنتاج',[
        f('music','الموسيقى المطلوبة (نوع، مزاج، مرجع)','Music','textarea',{required:false,max_length:1000}),
        f('cast','الكاست المطلوب','Cast','textarea',{required:false,max_length:1500}),
        f('location','الموقع / الاستوديو المطلوب','Location or studio','textarea',{required:false,max_length:1500}),
        f('client_assets','المواد والأصول المطلوبة من العميل','Client assets','textarea',{required:false,max_length:1500}),
        f('special','أي متطلبات خاصة أخرى','Special requirements','textarea',{required:false,max_length:1500})
      ]),
      // قسم مستقل في الأصل بحقل واحد فقط، لا بندًا داخل المتطلبات الإضافية.
      section('revisions','سياسة التعديلات','الإنتاج',[
        f('free_rounds','عدد جولات التعديل المجانية','Free revision rounds','number',{min:0,max:99,
          help:'قسم مستقل في الأصل وفيه هذا الحقل وحده — بلا «آلية الملاحظات» ولا «مدة رد العميل» خلافًا لـCR-01 وCW-01.'})
      ])
    ],
    author:author('أعدّه مدير المشروع','projects.use'),
    // توقيع واحد في الأصل (مدير المشروع)، وهو إقرار التقديم. الخطوتان أدناه اعتمادان من الفهرس ومن تنبيه مبتور.
    chain:[step('production_manager','اعتماد مدير الإنتاج','production.manage',['meta','goal','outputs','extras','revisions'],
      {source:'إدارة النموذج في فهرس الـ41: إدارة الإنتاج'}),
      step('finance','الموافقة المالية','finance.use',['outputs','extras'],
        {inferred:true,unverified:'تنبيه MOD-PROD-01 مبتور عند «والحصول…»؛ إكماله بـ«الموافقة المالية» ترجيح لا نص مصدر',
          source:'تنبيه MOD-PROD-01 المبتور: «... واكتمال جميع بياناته والحصول…»'}),
      ACCOUNT_STEP(['meta','goal','outputs','extras','revisions'])],
    attachments:{allowed:true,max:10,note:'المراجع البصرية وأصول العميل.'}
  },
  {
    key:'FORM-PROD-SCRIPT',frm:'FRM-009',step_no:4,cycle:'تجهيز المشروع',department:'PROD',mandate:'حسب النطاق',
    classification:'اعتماد',
    depends_on:[needs('FORM-PROD-BRIEF','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-009: «مرفق: موجز الإنتاج»')],
    title:'اعتماد النص / السكريبت',title_en:'Script Approval Form (MOD-PROD-02)',
    aliases:{code:['FRM-009','PROD-02','MOD-PROD-02','VD-02'],name_ar:['اعتماد السكريبت','اعتماد النص'],name_en:['Script Approval','Script Approval Form'],
      ambiguous:{'VD-02':'اسم ملف هذا النموذج MOD-VD-02 ومحتواه MOD-PROD-02؛ ليس معرّفًا'}},
    subject_kinds:['project'],
    warnings:['تنبيه المصدر (MOD-PROD-02): يُمنع بدء التصوير قبل الحصول على التوقيع.'],
    sections:[
      section('meta','بيانات السكريبت','الإنتاج',[
        f('project_name','المشروع','Project','text',{max_length:180}),
        f('production_type','نوع الإنتاج','Production type','text',{max_length:120}),
        f('main_idea','الفكرة الرئيسية','Main idea','textarea',{max_length:2000}),
        f('key_message','الرسالة','Message','textarea',{max_length:1500}),
        f('style_mood','الأسلوب البصري والمزاج','Visual style and mood','textarea',{max_length:1500})
      ]),
      section('structure','هيكل المحتوى (Scene by Scene)','الإنتاج',[
        f('scenes','المشهد / القسم، الوصف البصري، النص / الحوار، المدة التقريبية','Scene breakdown','textarea',
          {max_length:6000,help:'القالب الأصلي ستة مشاهد ثابتة.'})
      ]),
      section('decision','قرار العميل','الإنتاج',[
        f('client_decision','قرار العميل','Client decision','select',{options:['معتمد','معتمد بتعديلات','مرفوض'],inferred:true}),
        f('client_notes','ملاحظات العميل','Client notes','textarea',{required:false,max_length:2500})
      ])
    ],
    author:author('أعدّه فريق الإنتاج','production.manage'),
    chain:[step('client_sign','توثيق توقيع العميل أو مدير المشروع','approvals.record',['structure','decision'],
      {from_signature:true,source:'MOD-PROD-02: «توقيع العميل أو مدير المشروع»'}),
      ACCOUNT_STEP(['meta','structure','decision'])],
    gates:[gate('client_decision','not_equals','مرفوض',
      'تنبيه المصدر (MOD-PROD-02): يُمنع بدء التصوير قبل الحصول على التوقيع. سكريبت قراره «مرفوض» لا يُعتمد.')],
    attachments:{allowed:true,max:5,note:'ملف السكريبت كما عُرض.'}
  },
  {
    key:'FORM-AD-REQUEST',frm:'FRM-010',step_no:5,cycle:'تجهيز المشروع',department:'AD',mandate:'حسب النطاق',
    classification:'طلب',
    title:'طلب الحملة الإعلانية',title_en:'Campaign Request Form (MOD-AD-01)',
    aliases:{code:['FRM-010','AD-01','MOD-AD-01'],name_ar:['طلب حملة','طلب الحملة الإعلانية'],name_en:['Campaign Request','Campaign Request Form']},
    subject_kinds:['project'],
    warnings:['تنبيه المصدر (MOD-AD-01) **مبتور**: «يُمنع منعاً باتاً إطلاق أي حملة إعلانية قبل تحصيل الميزانية كاملة من العميل وتأك…». '
      +'إكماله بـ«وتأكيد الإدارة المالية» ترجيح؛ الشرط المتحقَّق هو تحصيل الميزانية كاملة.',
      'منصات هذا النموذج **ست** في الأصل، بينما الخطة الإعلامية MOD-AD-02 فيها **ثماني** منصات: Google مفصولة إلى Search وDisplay، وبإضافة YouTube Ads (الفرق #10، ج6).'],
    sections:[
      section('meta','بيانات الطلب','التسويق الرقمي',[
        f('request_serial','رقم الطلب','Request serial','text',{required:false,max_length:60,
          help:'المصدر يضع النمط CR-AD-____ ، ويتصادم بادئةً مع CR-PM-____ في MOD-PM-03.'}),
        f('requested_on','تاريخ الطلب','Request date','date'),
        f('client','العميل','Client','text',{max_length:180}),
        f('project_manager','مدير المشروع','Project manager','text',{max_length:180}),
        f('campaign_name','اسم الحملة','Campaign name','text',{max_length:180}),
        f('duration','مدة الحملة','Campaign duration','text',{max_length:120}),
        f('objective','الهدف الرئيسي','Main objective','textarea',{max_length:1500})
      ]),
      section('audience','الجمهور والرسالة','التسويق الرقمي',[
        f('age_group','الفئة العمرية','Age group','text',{max_length:120}),
        f('interests','الاهتمامات','Interests','textarea',{max_length:1500}),
        f('location','الموقع','Location','text',{max_length:180}),
        f('geography','المنطقة الجغرافية','Geography','text',{max_length:180}),
        f('key_message','الرسالة الأساسية','Key message','textarea',{max_length:1500})
      ]),
      section('kpi','KPIs المستهدفة','التسويق الرقمي',[
        f('kpis','الوصول (Reach)، التفاعل (Engagement Rate %)، النقرات (Clicks)، تكلفة النقرة (CPC)، التحويلات (Conversions)، العائد على الإنفاق (ROAS) — لكل مؤشر الهدف المستهدف والمنصة','Target KPIs','textarea',{max_length:3000})
      ]),
      // ست منصات بأسمائها الحرفية في MOD-AD-01. الخطة الإعلامية MOD-AD-02 لها قائمة ثماني منصات مختلفة.
      section('platforms','المنصات والمواد الإعلانية','التسويق الرقمي',[
        f('platforms_used','المنصة','Platforms','checks',{options:AD01_PLATFORMS,
          help:'ست منصات كما وردت في MOD-AD-01. الخطة الإعلامية MOD-AD-02 تفصل Google إلى Search وDisplay وتضيف YouTube Ads.'}),
        f('platform_details','لكل منصة: الميزانية المخصصة (ريال)، نوع الإعلان، المواد المطلوبة','Per-platform budget, ad type and assets','textarea',{max_length:3000})
      ]),
      section('collection','تأكيد تحصيل الميزانية','التسويق الرقمي',[
        f('budget_collected','هل تم تحصيل ميزانية الإعلانات كاملة؟','Budget fully collected?','select',{options:YES_NO}),
        f('receipt_number','رقم إيصال الاستلام','Receipt number','text',{required:false,max_length:120,
          show_when:{field:'budget_collected',equals:'نعم'}})
      ])
    ],
    author:author('أعدّه مدير المشروع','projects.use'),
    chain:[step('campaigns_manager','اعتماد مدير الحملات','commercial.use',['meta','audience','kpi','platforms'],
      {source:'إدارة النموذج في فهرس الـ41: إدارة التسويق الرقمي'}),
      step('finance','تأكيد الإدارة المالية للتحصيل','finance.use',['collection'],
        {inferred:true,unverified:'تنبيه MOD-AD-01 مبتور عند «وتأك…»؛ نسبة التأكيد إلى الإدارة المالية ترجيح لا نص مصدر',
          source:'تنبيه MOD-AD-01 المبتور: «... من العميل وتأك…»؛ ورأس الملف: «يُسلم لمدير الحملات مع تأكيد تحصيل الميزانية»'}),
      ACCOUNT_STEP(['meta','audience','kpi','platforms','collection'])],
    gates:[gate('budget_collected','equals','نعم',
      'تنبيه المصدر (MOD-AD-01): يُمنع منعاً باتاً إطلاق أي حملة إعلانية قبل تحصيل الميزانية كاملة من العميل.')],
    attachments:{allowed:true,max:5,note:'إيصال استلام الميزانية وموافقة العميل.'}
  },
  {
    key:'FORM-AD-MEDIAPLAN',frm:'FRM-011',step_no:5,cycle:'تجهيز المشروع',department:'AD',mandate:'حسب النطاق',
    classification:'خطة',
    depends_on:[needs('FORM-AD-REQUEST','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-011: «مرفق: طلب الحملة»')],
    title:'الخطة الإعلامية',title_en:'Media Plan Template (MOD-AD-02)',
    aliases:{code:['FRM-011','AD-02','MOD-AD-02'],name_ar:['الخطة الإعلامية'],name_en:['Media Plan','Media Plan Template']},
    subject_kinds:['project'],
    warnings:['تعارض المصدر (MOD-AD-02): الرأس يقول «يُعتمد من العميل ومدير المشروع والإدارة المالية»، بينما حقول التوقيع تبدأ بمدير الحملات ولا تذكر العميل. المسار هنا يتبع حقول التوقيع، ويحتاج قرار مالك.',
      'منصات هذا النموذج **ثماني**: Google مفصولة إلى Search وDisplay، وفيها YouTube Ads — مقابل **ست** في MOD-AD-01. '
        +'الملحق لم ينقل القائمة أصلًا، فكانت الخطة تُبنى على قائمة AD-01 السداسية (الفرق #10).',
      'التوقيع الثالث في الأصل **مبتور** عند «توقيع»؛ نسبته إلى الإدارة المالية ترجيح لا نص متحقَّق.'],
    sections:[
      section('meta','بيانات الحملة','التسويق الرقمي',[
        f('campaign_name','اسم الحملة','Campaign name','text',{max_length:180}),
        f('duration','مدة الحملة (من - إلى)','Duration','text',{max_length:120})
      ]),
      section('plan','توزيع الميزانية على المنصات','التسويق الرقمي',[
        f('platforms_used','المنصة','Platforms','checks',{options:AD02_PLATFORMS,
          help:'ثماني منصات كما وردت في MOD-AD-02، وفيها Google Ads (Search) وGoogle Ads (Display) وYouTube Ads. قائمة MOD-AD-01 ست منصات تدمج Google ولا تذكر YouTube.'}),
        f('platform_rows','لكل منصة: نوع الإعلان، الميزانية اليومية، مدة التشغيل (أيام)، إجمالي الميزانية، نسبة من الإجمالي %، الهدف الرئيسي، KPI المستهدف، الجمهور المستهدف، ملاحظات','Per-platform plan','textarea',{max_length:5000,
          help:'أحد عشر عمودًا في الأصل، وآخر صف في الجدول «الإجمالي».'}),
        f('total_budget','الإجمالي','Total budget','number',{max:99999999})
      ])
    ],
    author:author('أعدّها أخصائي الحملات','commercial.use'),
    chain:[
      step('campaigns_manager','توقيع مدير الحملات','commercial.use',['meta','plan'],{from_signature:true,source:'MOD-AD-02: «توقيع مدير الحملات»'}),
      step('project_manager','توقيع مدير المشروع','projects.use',['meta','plan'],{from_signature:true,source:'MOD-AD-02: «توقيع مدير المشروع»'}),
      step('finance','توقيع الإدارة المالية','finance.use',['plan'],{from_signature:true,inferred:true,
        unverified:'التوقيع الثالث في MOD-AD-02 مبتور عند «توقيع»؛ نسبته إلى الإدارة المالية ترجيح',
        source:'MOD-AD-02: التوقيع الثالث المبتور «توقيع…»، ورأس الملف يذكر الإدارة المالية بين المعتمدين'})],
    attachments:{allowed:true,max:8,note:'جدول التوزيع وعروض المنصات.'}
  },
  {
    key:'FORM-AD-SETUP',frm:'FRM-012',step_no:5,cycle:'تجهيز المشروع',department:'AD',mandate:'حسب النطاق',
    classification:'قائمة تحقق',
    depends_on:[needs('FORM-AD-REQUEST','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-012: «مرفق: طلب الحملة؛ الخطة الإعلامية»'),
      needs('FORM-AD-MEDIAPLAN','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-012: «مرفق: طلب الحملة؛ الخطة الإعلامية»')],
    title:'قائمة تحقق إعداد الحملة',title_en:'Campaign Setup Checklist (MOD-AD-03)',
    aliases:{code:['FRM-012','AD-03','MOD-AD-03'],name_ar:['قائمة تحقق إعداد الحملة'],name_en:['Campaign Setup Checklist']},
    subject_kinds:['project'],
    warnings:['تنبيه المصدر (MOD-AD-03): يُمنع الإطلاق قبل اجتياز جميع البنود.'],
    sections:[
      section('meta','بيانات القائمة','التسويق الرقمي',[
        f('campaign_name','اسم الحملة','Campaign name','text',{max_length:180}),
        f('specialist','أخصائي الحملات','Campaign specialist','text',{max_length:180})
      ]),
      section('finance_checks','الاشتراطات المالية','التسويق الرقمي',[
        f('finance_done','البنود المنجزة','Completed items','checks',
          {options:['تحصيل الميزانية كاملة','موافقة مالية مكتوبة','بطاقة إعلانات بحد ائتماني','ربط البطاقة بالحسابات الصحيحة']})
      ]),
      section('platform_checks','إعداد المنصات','التسويق الرقمي',[
        f('platform_done','البنود المنجزة','Completed items','checks',
          {options:['إنشاء الحملات حسب الخطة','الجمهور المستهدف','رفع المواد المعتمدة','سقف الإنفاق اليومي والإجمالي',
            'Pixel/Tracking','روابط Landing Pages','UTM']})
      ]),
      section('approval_checks','الموافقات','التسويق الرقمي',[
        f('approval_done','البنود المنجزة','Completed items','checks',
          {options:['موافقة العميل الكتابية على المواد','موافقة مدير الحملات على الإعداد','توافق المواد مع سياسات المنصات',
            'مراجعة مدير الحملات قبل الإطلاق']})
      ]),
      section('prelaunch_checks','فحص ما قبل الإطلاق','التسويق الرقمي',[
        f('prelaunch_done','البنود المنجزة','Completed items','checks',
          {options:['الأهداف وKPIs','الجدول الزمني','الميزانية اليومية مقابل المدة','تنبيهات الأداء']}),
        f('item_notes','المسؤول والوقت والملاحظات لكل بند','Owner, time and notes per item','textarea',{required:false,max_length:3000}),
        f('launch_decision','قرار الإطلاق','Launch decision','select',{options:['جاهزة للإطلاق','غير جاهزة'],inferred:true})
      ])
    ],
    author:author('أعدّها أخصائي الحملات','commercial.use'),
    chain:[step('campaigns_manager','توقيع مدير الحملات','commercial.use',
      ['meta','finance_checks','platform_checks','approval_checks','prelaunch_checks'],{from_signature:true,source:'MOD-AD-03: توقيع مدير الحملات'}),
      ACCOUNT_STEP(['finance_checks','platform_checks','approval_checks','prelaunch_checks'])],
    gates:[gate('finance_done','all',null,'تنبيه المصدر (MOD-AD-03): يُمنع الإطلاق قبل اجتياز جميع البنود — الاشتراطات المالية غير مكتملة.'),
      gate('platform_done','all',null,'تنبيه المصدر (MOD-AD-03): يُمنع الإطلاق قبل اجتياز جميع البنود — إعداد المنصات غير مكتمل.'),
      gate('approval_done','all',null,'تنبيه المصدر (MOD-AD-03): يُمنع الإطلاق قبل اجتياز جميع البنود — الموافقات غير مكتملة.'),
      gate('prelaunch_done','all',null,'تنبيه المصدر (MOD-AD-03): يُمنع الإطلاق قبل اجتياز جميع البنود — فحص ما قبل الإطلاق غير مكتمل.'),
      gate('launch_decision','equals','جاهزة للإطلاق','تنبيه المصدر (MOD-AD-03): قرار الإطلاق «غير جاهزة» لا يُعتمد.')],
    attachments:{allowed:true,max:5,note:'إثباتات الإعداد قبل النشر.'}
  },
  {
    key:'FORM-DS-BRIEF',frm:'FRM-013',step_no:6,cycle:'تجهيز المشروع',department:'DS',mandate:'حسب النطاق',
    classification:'إحاطة',
    title:'موجز التصميم',title_en:'Design Brief (MOD-DS-01)',
    aliases:{code:['FRM-013','DS-01','MOD-DS-01'],name_ar:['موجز التصميم','نموذج طلب التصميم'],name_en:['Design Brief']},
    subject_kinds:['project'],
    warnings:['سياسة التعديلات في هذا النموذج **حقلان فقط** في الأصل: عدد الجولات المجانية وآلية الملاحظات — بلا «مدة رد العميل» خلافًا لـMOD-CR-01 وMOD-CW-01.'],
    sections:[
      section('meta','بيانات الطلب','التصميم',[
        f('request_serial','رقم الطلب','Request serial','text',{required:false,max_length:60,help:'المصدر يضع النمط DB-DS-____ .'}),
        f('requested_on','تاريخ الطلب','Request date','date'),
        f('project_name','المشروع','Project','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('project_manager','مدير المشروع','Project manager','text',{max_length:180}),
        f('design_manager','مدير التصاميم المعين','Assigned design manager','text',{max_length:180}),
        f('due_date','تاريخ التسليم','Delivery date','date')
      ]),
      section('goal','الهدف والرسالة','التصميم',[
        f('objective','هدف التصميم','Design objective','textarea',{max_length:2000}),
        f('audience','الجمهور','Audience','textarea',{max_length:1500}),
        f('key_message','الرسالة','Message','textarea',{max_length:1500}),
        f('tone','نبرة التصميم','Design tone','text',{max_length:180})
      ]),
      section('outputs','المخرجات التصميمية المطلوبة','التصميم',[
        f('deliverables','نوع التصميم، الأبعاد / المواصفات، المنصة / الاستخدام، الصيغة المطلوبة، الكمية، ملاحظات','Deliverables','textarea',
          {max_length:3000,help:'القالب الأصلي ستة صفوف ثابتة.'})
      ]),
      section('requirements','المتطلبات','التصميم',[
        f('colors','الألوان','Colours','textarea',{required:false,max_length:1000}),
        f('fonts','الخطوط','Fonts','textarea',{required:false,max_length:1000}),
        f('imagery','الصور','Images','textarea',{required:false,max_length:1500}),
        f('mandatory_text','النصوص الإلزامية','Mandatory text','textarea',{required:false,max_length:1500}),
        f('prohibited','المحظورات','Prohibitions','textarea',{required:false,max_length:1500}),
        f('references','مراجع تصميمية','Design references','textarea',{required:false,max_length:1500})
      ]),
      // حقلان فقط في الأصل، والأول «عدد جولات التعديل المجانية المسموحة» لا «سياسة التعديلات» نصًا مفتوحًا.
      section('revisions','سياسة التعديلات','التصميم',[
        f('free_rounds','عدد جولات التعديل المجانية المسموحة','Free revision rounds','number',{min:0,max:99}),
        f('feedback_method','آلية تقديم الملاحظات','Feedback method','textarea',{max_length:1500})
      ])
    ],
    author:author('أعدّه مدير المشروع','projects.use'),
    chain:[step('design_manager','توقيع مدير التصاميم','studio.use',['meta','goal','outputs','requirements','revisions'],
      {from_signature:true,source:'MOD-DS-01: التوقيعان'}),
      ACCOUNT_STEP(['meta','goal','outputs','requirements','revisions'])],
    attachments:{allowed:true,max:8,note:'الأصول والمراجع.'}
  },
  {
    key:'FORM-DS-QA',frm:'FRM-014',step_no:6,cycle:'تجهيز المشروع',department:'DS',mandate:'حسب النطاق',
    classification:'قائمة تحقق',
    depends_on:[needs('FORM-DS-BRIEF','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-014: «مرفق: موجز التصميم»')],
    title:'قائمة فحص جودة التصميم',title_en:'Design QA Checklist (MOD-DS-02)',
    aliases:{code:['FRM-014','DS-02','MOD-DS-02'],name_ar:['قائمة تحقق جودة التصميم','قائمة فحص جودة التصميم'],name_en:['Design QA Checklist']},
    subject_kinds:['project'],
    warnings:['تنبيه المصدر (MOD-DS-02): يُمنع إرسال أي تصميم للعميل قبل اجتياز البنود وتوقيع مدير التصاميم.',
      'بنود التوافق مع المنصات تُؤشَّر للمنصات المستهدفة وحدها، فلا تُفرض كاملة عند الاعتماد. يحتاج قرار مالك.'],
    sections:[
      section('meta','بيانات الفحص','التصميم',[
        f('project_name','المشروع','Project','text',{max_length:180}),
        f('design_type','نوع التصميم','Design type','text',{max_length:120}),
        f('designer','المصمم','Designer','text',{max_length:180}),
        f('reviewer','المراجع','Reviewer','text',{max_length:180}),
        f('round_no','رقم جولة التعديل','Revision round','number',{min:1,max:99})
      ]),
      section('brief_compliance','الامتثال للملخص','التصميم',[
        f('brief_passed','البنود المجتازة','Items passed','checks',
          {options:['الهدف','اكتمال المخرجات','الجمهور','الرسالة','Call to Action','مطابقة الفكرة المعتمدة']})
      ]),
      section('brand','الهوية البصرية','التصميم',[
        f('brand_passed','البنود المجتازة','Items passed','checks',
          {options:['الألوان الرسمية','الخطوط الرسمية','الشعار حجمًا وموقعًا ونسخةً','دليل الهوية','اتساق الأسلوب',
            'عدم استخدام ألوان أو خطوط محظورة']})
      ]),
      section('technical','الجودة التقنية','التصميم',[
        f('technical_passed','البنود المجتازة','Items passed','checks',
          {options:['الدقة (72dpi رقمي، 300dpi طباعة)','الأبعاد','حقوق الصور','حقوق الخطوط','صيغة الملف',
            'وضع الألوان (RGB/CMYK)','تنظيم الطبقات','خلو النصوص من الأخطاء الإملائية']})
      ]),
      section('platforms','التوافق مع المنصات','التصميم',[
        f('platforms_passed','المنصات المستهدفة المجتازة','Platforms passed','checks',
          {required:false,options:['Instagram (Feed/Stories/Reels)','Twitter/X','LinkedIn','TikTok','Snapchat','الإعلانات الرقمية']})
      ]),
      section('result','النتيجة','التصميم',[
        f('result','النتيجة','Result','select',{options:['اجتاز','لم يجتز']}),
        f('notes','الملاحظات والإجراء المطلوب','Notes and required action','textarea',{required:false,max_length:3000})
      ])
    ],
    author:author('أعدّها المراجع','studio.use'),
    chain:[step('design_manager','توقيع مدير التصاميم','studio.use',['meta','brief_compliance','brand','technical','platforms','result'],
      {from_signature:true,source:'MOD-DS-02: «النتيجة والملاحظات وتوقيع مدير التصاميم»'}),
      ACCOUNT_STEP(['result'])],
    gates:[gate('brief_passed','all',null,'تنبيه المصدر (MOD-DS-02): يُمنع إرسال أي تصميم للعميل قبل اجتياز البنود — بنود الامتثال للملخص غير مكتملة.'),
      gate('brand_passed','all',null,'تنبيه المصدر (MOD-DS-02): يُمنع إرسال أي تصميم للعميل قبل اجتياز البنود — بنود الهوية البصرية غير مكتملة.'),
      gate('technical_passed','all',null,'تنبيه المصدر (MOD-DS-02): يُمنع إرسال أي تصميم للعميل قبل اجتياز البنود — بنود الجودة التقنية غير مكتملة.'),
      gate('result','equals','اجتاز','تنبيه المصدر (MOD-DS-02): تصميم نتيجته «لم يجتز» لا يُعتمد ولا يُرسل للعميل.')],
    attachments:{allowed:true,max:5,note:'ملف التصدير وإثباتات الفحص.'}
  },
  {
    key:'FORM-DS-REVISIONS',frm:'FRM-015',step_no:6,cycle:'تجهيز المشروع',department:'DS',mandate:'حسب النطاق',
    classification:'سجل',
    depends_on:[needs('FORM-DS-BRIEF','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-015: «مرفق: موجز التصميم»')],
    title:'سجل التعديلات التصميمية',title_en:'Design Revision Log (MOD-DS-03)',
    aliases:{code:['FRM-015','DS-03','MOD-DS-03','MOD-03'],name_ar:['سجل تعديلات التصميم','سجل التعديلات التصميمية'],name_en:['Design Revision Log'],
      ambiguous:{'MOD-03':'اسم ملف هذا السجل MOD-03 ومحتواه MOD-DS-03؛ ليس معرّفًا'}},
    subject_kinds:['project'],
    warnings:['تنبيه المصدر (MOD-DS-03) **مبتور**: «عند استنفاد الجولات المجانية، يجب إبلاغ مدير المشروع فوراً لإصدار عرض سعر للجولات ال…». '
      +'ما بعد «للجولات ال» غير متحقَّق؛ النسخة المزروعة كانت تكمله بـ«الإضافية».',
      'تعارض المصدر 7: «2 جولات» قيمة مكتوبة في هذا القالب (مؤكَّدة حرفيًا)، بينما بقية النماذج تربط الجولات باتفاق المشروع. يحتاج قرار مالك.'],
    sections:[
      section('meta','بيانات السجل','التصميم',[
        f('project_client','اسم المشروع / العميل','Project / client','text',{max_length:250}),
        f('free_rounds','عدد الجولات المجانية المسموحة','Free rounds','number',{min:0,max:99,template_default:'2',
          help:'المصدر يضع «2 جولات» قيمةَ قالب. '+TEMPLATE_NOTE}),
        f('rounds_used','إجمالي الجولات المستخدمة','Rounds used','number',{min:0,max:99}),
        f('rounds_left','الجولات المتبقية','Rounds left','number',{min:0,max:99})
      ]),
      section('log','جدول السجل','التصميم',[
        f('rows','التصميم المعني، تاريخ الطلب، وصف التعديل المطلوب، التصنيف، المصمم المنفذ، تاريخ التسليم، حالة التعديل، تكلفة إضافية؟، ملاحظات','Revision rows','textarea',
          {max_length:6000,help:'عشرة أعمدة في الأصل، والقالب خمسة عشر صفًا ثابتًا (1–15).'})
      ])
    ],
    author:author('سجّله مدير التصاميم','studio.use'),
    chain:[ACCOUNT_STEP(['meta','log'])],
    attachments:{allowed:true,max:5,note:'ملاحظات العميل كما وردت.'}
  },
  {
    key:'FORM-PR-CAMPAIGN',frm:'FRM-016',step_no:7,cycle:'تجهيز المشروع',department:'PR',mandate:'حسب النطاق',
    classification:'طلب',
    title:'طلب حملة للعلاقات العامة والمؤثرين',title_en:'Influencer Campaign Request (MOD-PR-01)',
    aliases:{code:['FRM-016','PR-01','MOD-PR-01'],name_ar:['طلب حملة مؤثرين','طلب حملة للعلاقات العامة والمؤثرين'],
      name_en:['Influencer Campaign Request']},
    subject_kinds:['project'],
    warnings:['نص المصدر: «الميزانية الإجمالية غير شامل الضريبة والرسوم الإدارية».',
      'قسمان كاملان كانا غائبين عن النسخة المزروعة وأُعيدا (الفرق #3): «المخرجات من العلاقات العامة» بست مهام، '
        +'و«متطلبات / مقترحات المؤثرين» بأربع شرائح Mega / Macro / Micro / Nano.',
      'الأسئلة الثلاثة في آخر النموذج **معبأة في القالب الأصلي**: نعم / نعم / لا. تظهر هنا افتراضيات قالب يغيّرها من يعبّئ النموذج، '
        +'ولا تُعرض أسئلة مفتوحة كما كانت (الفرق #9).',
      'بنية الأصل: ترويسة نصية (رقم الكــــود / التاريـــخ 22-07-2026 / رقم المعاملة 0000 / نوع النمـــوذج) لا جدول رأس صفحة، وهو من عائلة قوالب غير بقية النماذج (ج3).',
      'خطأ ترقيم في الأصل (ج8): صفوف «المخرجات من المؤثرين» مرقّمة 1، 1، 2. النص محفوظ كما ورد ولم يُصحَّح الترقيم من عندنا.'],
    sections:[
      section('meta','البيانات الرئيسية','العلاقات العامة والمؤثرون',[
        f('project_manager','مدير المشروع','Project manager','text',{max_length:180}),
        f('project_number','رقم المشروع / الطلب','Project number','text',{max_length:120}),
        f('duration','المدة الزمنية','Duration','text',{max_length:120}),
        f('client','اسم العميل','Client','text',{max_length:180}),
        f('campaign_name','الحملة','Campaign','text',{max_length:180}),
        f('total_budget','الميزانية الإجمالية (غير شامل الضريبة والرسوم الإدارية)','Total budget excluding VAT and admin fees','number',{max:99999999})
      ]),
      section('goals','أهداف الحملة والجمهور','العلاقات العامة والمؤثرون',[
        f('objective','هدف الحملة الرئيسي','Objective','textarea',{max_length:2000}),
        f('audience','الجمهور المستهدف','Audience','textarea',{max_length:1500}),
        f('key_message','الرسالة الأساسية للحملة','Message','textarea',{max_length:1500}),
        f('media_fields','مجالات الإعلام','Media fields','textarea',{max_length:1500}),
        f('influencer_fields','مجالات المؤثرين','Influencer fields','textarea',{max_length:1500})
      ]),
      section('media','متطلبات / مقترحات الإعلام','العلاقات العامة والمؤثرون',[
        f('media_requirements','الصحف، القنوات التلفزيونية، القنوات الإذاعية، نشر دولي، إعلانات — لكل نوع المنصات والعدد','Media requirements','textarea',{max_length:3000})
      ]),
      // قسم كامل غائب عن الملحق: ست مهام بأعمدة م | المهمة | الشرح | العدد.
      section('pr_outputs','المخرجات من العلاقات العامة','العلاقات العامة والمؤثرون',[
        ...PR_DELIVERABLES.map(item=>f(item.key,`${item.label} — العدد`,'','number',{required:false,min:0,max:9999})),
        f('pr_outputs_details','الشرح لكل مهمة مطلوبة','Details per deliverable','textarea',{required:false,max_length:3000,
          help:'عمود «الشرح» في جدول المخرجات من العلاقات العامة.'})
      ]),
      // قسم كامل غائب عن الملحق: أربع شرائح مؤثرين بأعمدة م | نوع المؤثر | المنصات | العدد.
      section('influencer_tiers','متطلبات / مقترحات المؤثرين','العلاقات العامة والمؤثرون',
        INFLUENCER_TIERS.flatMap(tier=>[
          f(`${tier.key}_platforms`,`${tier.label} — المنصات`,'','text',{required:false,max_length:250}),
          f(`${tier.key}_count`,`${tier.label} — العدد`,'','number',{required:false,min:0,max:9999})
        ])),
      section('influencer_outputs','المخرجات من المؤثرين','العلاقات العامة والمؤثرون',[
        f('posts_count','عدد المنشورات (Posts) المطلوبة','Posts','number',{min:0,max:9999}),
        f('stories_count','عدد القصص (Stories) المطلوبة','Stories','number',{min:0,max:9999}),
        f('videos_count','عدد الفيديوهات (Reels/TikTok) المطلوبة','Videos','number',{min:0,max:9999}),
        // القالب الأصلي يصل معبأً بهذه الإجابات الثلاث. تُحمل كما هي افتراضيات قالب، ومن يعبّئ النموذج يغيّرها.
        f('brand_mention','هل يُطلب ذكر العلامة التجارية بشكل صريح؟','Explicit brand mention?','select',
          {options:YES_NO,template_default:'نعم',help:'القالب الأصلي يصل بالإجابة «نعم». '+TEMPLATE_DEFAULT_NOTE}),
        f('discount_code','هل يُطلب استخدام كود خصم خاص؟ / أو رابط تسجيل','Discount code or sign-up link?','select',
          {options:YES_NO,template_default:'نعم',help:'القالب الأصلي يصل بالإجابة «نعم». '+TEMPLATE_DEFAULT_NOTE}),
        f('reuse_rights','هل يُطلب حقوق إعادة استخدام المحتوى؟','Content reuse rights?','select',
          {options:YES_NO,template_default:'لا',help:'القالب الأصلي يصل بالإجابة «لا» — خلافًا لما عرضه الملحق سؤالًا مفتوحًا. '+TEMPLATE_DEFAULT_NOTE})
      ])
    ],
    author:author('أعدّه مدير الحسابات','clients.manage'),
    chain:[step('pr_manager','توقيع مدير العلاقات العامة','pr.manage',
      ['meta','goals','media','pr_outputs','influencer_tiers','influencer_outputs'],
      {from_signature:true,source:'MOD-PR-01، جدول الاعتماد والتوقيع: «1 توقيع مدير الحسابات، 2 مدير العلاقات العامة»'})],
    attachments:{allowed:true,max:8,note:'خلفية الحملة ومواد العميل.'}
  },
  {
    key:'FORM-PR-INFLUENCERS',frm:'FRM-017',step_no:7,cycle:'تجهيز المشروع',department:'PR',mandate:'حسب النطاق',
    classification:'اعتماد',
    depends_on:[needs('FORM-PR-CAMPAIGN','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-017: «مرفق: طلب حملة مؤثرين»')],
    title:'اعتماد قائمة المؤثرين',title_en:'Influencer List Approval Form (MOD-PR-02)',
    aliases:{code:['FRM-017','PR-02','MOD-PR-02'],name_ar:['اعتماد قائمة المؤثرين'],name_en:['Influencer List Approval','Influencer List Approval Form']},
    subject_kinds:['project'],
    warnings:['تنبيه المصدر (MOD-PR-02): يُمنع التواصل مع أي مؤثر أو أي التزام قبل توقيع العميل.'],
    sections:[
      section('meta','بيانات القائمة','العلاقات العامة والمؤثرون',[
        f('campaign_name','اسم الحملة','Campaign name','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180})
      ]),
      section('list','جدول المؤثرين','العلاقات العامة والمؤثرون',[
        f('rows','لكل مؤثر: اسم المؤثر / الحساب، المنصة، عدد المتابعين، معدل التفاعل %، التخصص / المحتوى، السعر المقترح (ريال)، نسبة المتابعين الحقيقيين %، توصية الفريق، قرار العميل','Influencer rows','textarea',
          {max_length:6000,help:'عشرة أعمدة في الأصل، والقالب ثمانية صفوف ثابتة.'})
      ]),
      section('decision','قرار العميل','العلاقات العامة والمؤثرون',[
        f('approved_influencers','المؤثرون المعتمدون نهائيًا','Finally approved influencers','textarea',{max_length:3000}),
        f('client_decision','قرار العميل','Client decision','select',{options:['معتمدة','معتمدة جزئيًا','مرفوضة'],inferred:true}),
        f('client_notes','ملاحظات العميل','Client notes','textarea',{required:false,max_length:2500})
      ])
    ],
    author:author('أعدّها أخصائي المؤثرين','influencers.manage'),
    chain:[step('client_sign','توثيق توقيع العميل أو مدير المشروع','approvals.record',['list','decision'],
      {from_signature:true,source:'MOD-PR-02: «توقيع العميل أو مدير المشروع»'}),
      step('pr_manager','اعتماد مدير العلاقات العامة','pr.manage',['list','decision'],{source:'إدارة النموذج في فهرس الـ41: العلاقات العامة'}),
      ACCOUNT_STEP(['meta','list','decision'])],
    gates:[gate('client_decision','not_equals','مرفوضة',
      'تنبيه المصدر (MOD-PR-02): يُمنع التواصل مع أي مؤثر أو أي التزام قبل توقيع العميل. قائمة قرارها «مرفوضة» لا تُعتمد.')],
    attachments:{allowed:true,max:8,note:'ملفات المؤثرين وأرقام المنصات.'}
  },
  {
    key:'FORM-PR-CONTRACT',frm:'FRM-018',step_no:7,cycle:'تجهيز المشروع',department:'PR',mandate:'مشروط: إن وجد',
    classification:'عقد / اتفاقية',
    depends_on:[needs('FORM-PR-INFLUENCERS','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-018: «مرفق: اعتماد قائمة المؤثرين — إن وجد»')],
    title:'عقد التعاون مع المؤثر',title_en:'Influencer Collaboration Contract (MOD-PR-03)',
    aliases:{code:['FRM-018','PR-03','MOD-PR-03'],name_ar:['عقد تعاون المؤثر','عقد التعاون مع المؤثر'],name_en:['Influencer Collaboration Contract']},
    subject_kinds:['project','supplier'],
    warnings:['تنبيه المصدر (MOD-PR-03) **مبتور**: «لا تُصرف أي دفعة قبل توقيع هذا العقد من الطرفين والحصول على م…». '
      +'إكماله بـ«موافقة مالية مكتوبة» ترجيح؛ المتحقَّق هو توقيع الطرفين.',
      'تعارض المصدر 6 (مؤكَّد): الفهرس يجعل هذا النموذج «مشروطًا / إن وجد»، بينما رأس الملف يقول «يُوقَّع قبل أي دفعة أو بدء عمل».'],
    sections:[
      section('meta','بيانات العقد','العلاقات العامة والمؤثرون',[
        f('contract_serial','رقم العقد','Contract serial','text',{required:false,max_length:60,help:'المصدر يضع النمط CONT-PR-____ .'}),
        f('contract_date','تاريخ العقد','Contract date','date'),
        f('influencer','المؤثر','Influencer','text',{max_length:180}),
        f('campaign_name','الحملة','Campaign','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180})
      ]),
      section('outputs','المخرجات','العلاقات العامة والمؤثرون',[
        f('rows','Post، Story، Reel/TikTok، YouTube Video، Live Session — لكل منها المنصة والكمية وتاريخ التسليم للمراجعة وتاريخ النشر','Deliverable rows','textarea',{max_length:4000})
      ]),
      section('financial','الشروط المالية','العلاقات العامة والمؤثرون',[
        f('total_value','إجمالي قيمة العقد','Total contract value','number',{max:99999999}),
        f('advance','الدفعة المقدمة عند التوقيع','Advance on signature','number',{max:99999999}),
        f('final_payment','الدفعة النهائية بعد التحقق من الإنجاز','Final payment after verification','number',{max:99999999}),
        f('payment_method','آلية الدفع','Payment method','text',{max_length:180}),
        f('final_payment_date','موعد صرف الدفعة النهائية','Final payment date','text',{max_length:180})
      ]),
      section('terms','الشروط','العلاقات العامة والمؤثرون',[
        f('ip_rights','حقوق الملكية الفكرية','IP rights','textarea',{max_length:2000}),
        f('paid_reuse','حق إعادة الاستخدام في الإعلانات المدفوعة','Reuse in paid advertising','textarea',{max_length:1500}),
        f('exclusivity','فترة الحصرية','Exclusivity period','text',{max_length:180}),
        f('values_commitment','الالتزام بقيم العميل وسياسات المنصة','Commitment to client values and platform policies','textarea',{max_length:2000}),
        f('late_penalty','عقوبة التأخر','Late penalty','textarea',{max_length:1500}),
        f('cancellation_right','حق الإلغاء عند المخالفة','Cancellation right on breach','textarea',{max_length:1500}),
        f('finance_written_approval','موافقة مالية مكتوبة','Written finance approval','select',{options:YES_NO,
          inferred:true,unverified:'مستندها ذيل تنبيه MOD-PR-03 المبتور عند «والحصول على م…»'})
      ])
    ],
    author:author('أعدّه أخصائي المؤثرين','influencers.manage'),
    chain:[step('pr_manager','اعتماد مدير العلاقات العامة','pr.manage',['meta','outputs','financial','terms'],
      {source:'إدارة النموذج في فهرس الـ41: إدارة العلاقات العامة والمؤثرين'}),
      step('finance','الموافقة المالية المكتوبة','finance.use',['financial','terms'],
        {from_signature:true,inferred:true,unverified:'تنبيه MOD-PR-03 مبتور عند «والحصول على م…»؛ إكماله بـ«موافقة مالية مكتوبة» ترجيح',
          source:'تنبيه MOD-PR-03 المبتور: «لا تُصرف أي دفعة قبل توقيع هذا العقد من الطرفين والحصول على م…»'}),
      ACCOUNT_STEP(['meta','financial'])],
    gates:[gate('finance_written_approval','equals','نعم',
      'تنبيه المصدر (MOD-PR-03) المبتور: «لا تُصرف أي دفعة قبل توقيع هذا العقد من الطرفين والحصول على م…». '
      +'شرط الموافقة المالية المكتوبة إكمال مرجَّح لذيل مبتور، ويحتاج قرار مالك.')],
    attachments:{allowed:true,max:5,note:'العقد الموقّع من الطرف الآخر.'}
  },
  {
    key:'FORM-PR-BRIEFING',frm:'FRM-019',step_no:7,cycle:'تجهيز المشروع',department:'PR',mandate:'حسب النطاق',
    classification:'إحاطة',
    depends_on:[needs('FORM-PR-CAMPAIGN','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-019: «مرفق: طلب حملة مؤثرين؛ اعتماد القائمة»'),
      needs('FORM-PR-INFLUENCERS','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-019: «مرفق: طلب حملة مؤثرين؛ اعتماد القائمة»')],
    title:'مستندات إحاطة المؤثر',title_en:'Influencer Briefing Document (MOD-PR-04)',
    aliases:{code:['FRM-019','PR-04','MOD-PR-04'],name_ar:['مستندات إحاطة المؤثر','إحاطة المؤثر'],name_en:['Influencer Briefing Docs','Influencer Briefing Document']},
    subject_kinds:['project'],
    source_status:'بانتظار تأكيد النسخة الحاكمة',
    warnings:['**بانتظار تأكيد النسخة الحاكمة:** MOD-PR-04 غير مدرج في فهرس سجل نماذج العلاقات العامة (الصف 4 مفقود)، والملف موجود ومذكور في SLA. يُبنى ويبقى مسودة حتى يؤكد المالك أي نسخة تحكم.',
      'ذيل الأصل **مبتور** عند «راب» في قسم أصول العميل؛ «رابط مجلد الأصول» ترجيح لا نص متحقَّق، والحقل هنا اختياري موسوم بذلك.'],
    sections:[
      section('meta','بيانات الإحاطة','العلاقات العامة والمؤثرون',[
        f('campaign_or_product','الحملة أو المنتج','Campaign or product','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('objective','هدف الحملة','Objective','textarea',{max_length:1500}),
        f('key_message','الرسالة الأساسية','Key message','textarea',{max_length:1500}),
        f('tone','نبرة المحتوى','Content tone','text',{max_length:180}),
        f('audience','الجمهور','Audience','textarea',{max_length:1500})
      ]),
      section('outputs','المخرجات المطلوبة','العلاقات العامة والمؤثرون',[
        f('rows','نوع المخرج، المنصة، المواصفات، تاريخ التسليم للمراجعة، تاريخ النشر، ملاحظات','Deliverable rows','textarea',
          {max_length:4000,help:'القالب الأصلي أربعة صفوف ثابتة.'})
      ]),
      section('mandatory','الإلزامي والمحظور','العلاقات العامة والمؤثرون',[
        f('mandatory_elements','العناصر الإلزامية','Mandatory elements','textarea',{max_length:2000}),
        f('mandatory_words','الكلمات والهاشتاقات الإلزامية','Mandatory words and hashtags','textarea',{max_length:1500}),
        f('discount_code','كود الخصم','Discount code','text',{required:false,max_length:120}),
        f('prohibited','المحظورات','Prohibitions','textarea',{max_length:2000}),
        f('prohibited_style','الأسلوب المحظور','Prohibited style','textarea',{required:false,max_length:1500})
      ]),
      section('assets','أصول العميل','العلاقات العامة والمؤثرون',[
        f('logo','الشعار وصيغه','Logo and formats','textarea',{max_length:1000}),
        f('brand_colors','الألوان الرسمية','Official colours','textarea',{max_length:1000}),
        f('approved_media','الصور والفيديوهات المعتمدة','Approved images and videos','textarea',{max_length:1500}),
        f('assets_folder','رابط مجلد الأصول','Assets folder link','text',{required:false,max_length:400,inferred:true,
          unverified:'ذيل MOD-PR-04 مبتور عند «راب»؛ «رابط مجلد الأصول» ترجيح لا نص مصدر',
          help:'الأصل ينقطع عند «راب…». اسم الحقل ترجيح، فهو اختياري موسوم مقترحًا حتى يؤكده المالك.'})
      ])
    ],
    author:author('أعدّها أخصائي المؤثرين','influencers.manage'),
    chain:[ACCOUNT_STEP(['meta','outputs','mandatory','assets'])],
    attachments:{allowed:true,max:5,note:'مواد الإحاطة المرسلة.'}
  },
  {
    key:'FORM-PR-RELEASE',frm:'FRM-020',step_no:7,cycle:'تجهيز المشروع',department:'PR',mandate:'حسب النطاق',
    classification:'مستند محتوى',
    title:'البيان الصحفي',title_en:'Press Release (MOD-PR-05)',
    aliases:{code:['FRM-020','PR-05','MOD-PR-05'],name_ar:['البيان الصحفي'],name_en:['Press Release']},
    subject_kinds:['project'],
    warnings:['**القالب الأصلي غير مكتمل:** جدول محتوى البيان فيه **صف فقرة واحد** وبداخله النص «تت» (حشو غير مقصود). '
      +'لا توجد في المصدر بنية بيان متعدد الفقرات، فحقل المحتوى هنا **مقترح** يحتاج قرار مالك ولا يُقدَّم مسنَدًا (الفرق: PR-05 في APPENDIX-VS-ORIGINAL.md §2.7).',
      'جدول بيانات البيان في الأصل فيه خانات شَرطة «-» غير مفسَّرة، ونوع البيان فيه قيمة واحدة «خبر صحفي».',
      'بنية الأصل ترويسة نصية (رقم الكــــود / التاريـــخ 22-07-2026 / رقم المعاملة 0000) من عائلة قوالب MOD-PR-01 نفسها (ج3).'],
    sections:[
      section('meta','بيانات البيان','العلاقات العامة والمؤثرون',[
        f('issue_date','تاريخ الإصدار','Issue date','date'),
        f('release_number','رقم البيان','Release number','text',{max_length:120}),
        f('release_type','نوع البيان','Release type','select',{options:['خبر صحفي'],
          help:'القيمة الوحيدة الواردة في القالب الأصلي.'}),
        f('client','اسم العميل','Client','text',{max_length:180})
      ]),
      section('body','محتوى البيان الصحفي','العلاقات العامة والمؤثرون',[
        f('content','محتوى البيان فقرة فقرة','Release content','textarea',{max_length:8000,inferred:true,
          help:'الأصل صف فقرة واحد فيه حشو «تت» ولا بنية متعددة الفقرات. التقسيم إلى فقرات اقتراح من المنصة يحتاج اعتماد المالك. '+INFERRED_NOTE})
      ]),
      section('contact','الاعتماد والتوقيع / معلومات التواصل','العلاقات العامة والمؤثرون',[
        f('media_rep','اسم ممثل الإعلام لدى العميل','Client media representative','text',{max_length:180}),
        f('rep_phone','رقم الجوال','Mobile','text',{max_length:60}),
        f('rep_email','البريد الإلكتروني','Email','text',{max_length:180})
      ])
    ],
    author:author('أعدّه فريق العلاقات العامة','pr.manage'),
    chain:[step('client_media_rep','توثيق توقيع ممثل الإعلام لدى العميل','approvals.record',['body','contact'],
      {from_signature:true,source:'MOD-PR-05: «معلومات التواصل: اسم ممثل الإعلام لدى العميل، التوقيع»'}),
      ACCOUNT_STEP(['meta','body'])],
    attachments:{allowed:true,max:5,note:'الصور والمواد المرفقة بالبيان.'}
  },
  {
    // MOD-PR-06 لا رمز FRM له: ليس في فهرس الـ41، ومصدره ورقة «MOD-04 سجل الأداء» داخل PR_02_MOD_Forms.xlsx (لا ملف Word).
    // فهرس سجل العلاقات العامة يضعه «Not uploded» و«Requried by the workflow»، فهو «بانتظار اعتماد المصدر» حتى يعتمده المالك.
    key:'FORM-PR-PERFORMANCE',frm:null,step_no:7,cycle:'تنفيذ المشروع',department:'PR',mandate:'حسب النطاق',
    classification:'سجل أداء',
    // لا تبعيات: النموذج خارج فهرس الـ41 فلا عمود «المرفقات / الارتباطات» له، ولا تُخترع تبعية بلا سند.
    title:'سجل أداء المؤثرين',title_en:'Influencer Performance Log (MOD-PR-06)',
    aliases:{code:['PR-06','MOD-PR-06'],name_ar:['سجل أداء المؤثرين'],name_en:['Influencer Performance Log'],
      ambiguous:{'PR-06':'ورقة المصدر مسماة «MOD-04 سجل الأداء» وتحمل في الفهرس الرقم MOD-PR-06؛ الرمز اسم بديل لا معرّف'}},
    subject_kinds:['project'],
    source_status:'بانتظار اعتماد المصدر',
    warnings:['**بانتظار اعتماد المصدر:** فهرس سجل العلاقات العامة يضع هذا النموذج «Not uploded». الحقول منقولة من ورقة «MOD-04 سجل الأداء» في PR_02_MOD_Forms.xlsx.',
      'تعارض رمز: ورقة المصدر مسماة MOD-04 والفهرس يسميها MOD-PR-06، بينما MOD-PR-04 هو إحاطة المؤثر. المعرّف الداخلي يحسم.',
      'معدل التفاعل لا يُكتب يدويًا: تحسبه المنصة = التفاعل ÷ الوصول، ويُعرض «غير محسوب» إذا كان الوصول صفرًا أو فارغًا، ولا يُعتمد مؤشرًا حتى يعتمد المالك تعريف KPI.',
      'موضع البند 07 مقترح: النموذج خارج فهرس الـ41 فلا بند له في المصدر.'],
    sections:[
      section('meta','بيانات الحملة','العلاقات العامة والمؤثرون',[
        f('campaign_name','اسم الحملة','Campaign name','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('specialist','أخصائي المؤثرين','Influencer specialist','text',{max_length:180}),
        f('total_posts','إجمالي المنشورات','Total posts','number',{min:0,max:10000})
      ]),
      section('posts','سجل المنشورات','العلاقات العامة والمؤثرون',[
        f('rows','لكل منشور: #، اسم المؤثر، المنصة، نوع المنشور، تاريخ النشر، الوصول (Reach)، المشاهدات (Views)، التفاعل (Likes+Comments+Shares)، Screenshot مأخوذ؟، ملاحظات',
          'Post rows','textarea',{max_length:8000,help:'عمود «معدل التفاعل %» في الأصل لا يُكتب هنا: تحسبه المنصة من الإجماليات.'})
      ]),
      section('totals','الإجمالي','العلاقات العامة والمؤثرون',[
        f('total_reach','إجمالي الوصول (Reach)','Total reach','number',{min:0,max:9999999999}),
        f('total_views','إجمالي المشاهدات (Views)','Total views','number',{min:0,max:9999999999}),
        f('total_engagement','إجمالي التفاعل (Likes+Comments+Shares)','Total engagement','number',{min:0,max:9999999999}),
        f('screenshots_taken','هل أُخذت لقطات الشاشة لكل المنشورات؟','Screenshots taken for every post?','select',{options:YES_NO}),
        f('notes','ملاحظات','Notes','textarea',{required:false,max_length:2000})
      ])
    ],
    author:author('أعدّه أخصائي المؤثرين','influencers.manage'),
    chain:[step('pr_manager','مراجعة مدير العلاقات العامة','pr.manage',['meta','posts','totals'],
      {inferred:true,source:'لا سطر توقيع في ورقة المصدر؛ خطوة مراجعة مقترحة تحتاج اعتماد المالك'})],
    attachments:{allowed:true,max:20,note:'لقطات شاشة المنشورات (عمود «Screenshot مأخوذ؟» في الأصل).'}
  },
  {
    key:'FORM-PR-BUDGET',frm:'FRM-021',step_no:7,cycle:'تجهيز المشروع',department:'PR',mandate:'حسب النطاق',
    classification:'اعتماد مالي',
    depends_on:[needs('FORM-PR-CAMPAIGN','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-021: «مرفق: طلب حملة مؤثرين؛ اعتماد القائمة»'),
      needs('FORM-PR-INFLUENCERS','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-021: «مرفق: طلب حملة مؤثرين؛ اعتماد القائمة»')],
    title:'اعتماد ميزانية المؤثرين',title_en:'Influencer Budget Approval Form (MOD-PR-08)',
    aliases:{code:['FRM-021','PR-08','MOD-PR-08'],name_ar:['اعتماد ميزانية المؤثرين','اعتماد ميزانية المؤثر'],name_en:['Influencer Budget Approval','Influencer Budget Approval Form']},
    subject_kinds:['project'],
    warnings:['تنبيه المصدر (MOD-PR-08) **مبتور**: «يُمنع منعاً باتاً إجراء أي التزام مالي مع المؤثرين قبل الحصول على توقيع المدير المالي على…». ما بعد «على» غير متحقَّق.'],
    sections:[
      section('meta','بيانات الميزانية','العلاقات العامة والمؤثرون',[
        f('campaign_name','الحملة','Campaign','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('pr_manager','مدير العلاقات العامة','PR manager','text',{max_length:180}),
        f('budget_collected','هل الميزانية محصلة من العميل؟','Budget collected from the client?','select',{options:YES_NO})
      ]),
      section('breakdown','تفاصيل الميزانية المطلوبة','العلاقات العامة والمؤثرون',[
        f('rows','لكل مؤثر: اسم المؤثر، المنصة، المخرجات المطلوبة، الدفعة المقدمة (ريال)، الدفعة النهائية (ريال)، الإجمالي (ريال)','Per-influencer rows','textarea',
          {max_length:5000,help:'القالب الأصلي ثمانية صفوف ثابتة، ثم صف «الإجمالي الكلي المطلوب».'}),
        f('grand_total','الإجمالي الكلي المطلوب','Grand total','number',{max:99999999})
      ]),
      section('finance','قرار الإدارة المالية','العلاقات العامة والمؤثرون',[
        f('approved_budget','الميزانية المعتمدة','Approved budget','number',{required:false,max:99999999})
      ])
    ],
    author:author('أعدّها مدير العلاقات العامة','pr.manage'),
    chain:[step('finance','توقيع المدير المالي (قرار الإدارة المالية)','finance.use',['meta','breakdown','finance'],
      {from_signature:true,source:'MOD-PR-08: «قرار الإدارة المالية، الميزانية المعتمدة، توقيع المدير المالي»'}),
      ACCOUNT_STEP(['meta','breakdown'])],
    gates:[gate('budget_collected','equals','نعم',
      'تنبيه المصدر (MOD-PR-08): يُمنع أي التزام مالي مع المؤثرين قبل توقيع المدير المالي، والميزانية غير محصلة من العميل.')],
    attachments:{allowed:true,max:8,note:'عروض الأسعار وإثبات التحصيل.'}
  },
  {
    key:'FORM-CW-BRIEF',frm:'FRM-022',step_no:8,cycle:'تجهيز المشروع',department:'CW',mandate:'حسب النطاق',
    classification:'إحاطة',
    title:'موجز المحتوى',title_en:'Content Brief (MOD-CW-01)',
    // الفهرس يعطي هذا النموذج الرمز MOD-01 نفسه الذي يحمله الموجز الإبداعي (تعارض 3).
    aliases:{code:['FRM-022','MOD-01','MOD-CW-01','CW-01'],name_ar:['موجز المحتوى','نموذج طلب المحتوى'],name_en:['Content Brief']},
    subject_kinds:['project'],
    warnings:['تعارض المصدر 3: الفهرس يعطي هذا النموذج الرمز MOD-01 نفسه الذي يحمله الموجز الإبداعي. المعرّف الداخلي يحسم، والرمز يبقى اسمًا بديلًا.'],
    sections:[
      section('meta','بيانات الطلب','المحتوى والترجمة',[
        f('request_serial','رقم الطلب','Request serial','text',{required:false,max_length:60,help:'المصدر يضع النمط CB-CW-____ .'}),
        f('requested_on','تاريخ الطلب','Request date','date'),
        f('project_name','المشروع','Project','text',{max_length:180}),
        f('client','العميل','Client','text',{max_length:180}),
        f('project_manager','مدير المشروع','Project manager','text',{max_length:180}),
        f('content_manager','مدير المحتوى المعين','Assigned content manager','text',{max_length:180}),
        f('due_date','تاريخ التسليم','Delivery date','date')
      ]),
      section('goal','الهدف والرسالة','المحتوى والترجمة',[
        f('objective','الهدف','Objective','textarea',{max_length:2000}),
        f('audience','الجمهور','Audience','textarea',{max_length:1500}),
        f('key_message','الرسالة','Message','textarea',{max_length:1500}),
        f('tone','نبرة الصوت','Tone of voice','text',{max_length:180})
      ]),
      section('outputs','المحتوى المطلوب','المحتوى والترجمة',[
        f('rows','نوع المحتوى، المنصة / الاستخدام، الطول المطلوب، الكمية، تاريخ التسليم، ملاحظات','Content rows','textarea',
          {max_length:3000,help:'القالب الأصلي ستة صفوف ثابتة.'})
      ]),
      section('requirements','المتطلبات','المحتوى والترجمة',[
        f('seo_keywords','كلمات SEO','SEO keywords','textarea',{required:false,max_length:1500}),
        f('forbidden_words','الكلمات المحظورة','Forbidden words','textarea',{required:false,max_length:1500}),
        f('hashtags','الهاشتاقات','Hashtags','textarea',{required:false,max_length:1000}),
        f('cta','Call to Action','Call to action','text',{required:false,max_length:250}),
        f('links','الروابط','Links','textarea',{required:false,max_length:1500}),
        f('references','مراجع','References','textarea',{required:false,max_length:1500}),
        f('special','متطلبات خاصة','Special requirements','textarea',{required:false,max_length:1500})
      ]),
      section('revisions','سياسة التعديلات','المحتوى والترجمة',[
        f('free_rounds','الجولات المجانية','Free rounds','number',{min:0,max:99}),
        f('feedback_method','آلية الملاحظات','Feedback method','textarea',{max_length:1500}),
        f('client_response_time','مدة رد العميل','Client response time','text',{max_length:120})
      ])
    ],
    author:author('أعدّه مدير المشروع','projects.use'),
    chain:[step('content_manager','توقيع مدير المحتوى','studio.use',['meta','goal','outputs','requirements','revisions'],
      {from_signature:true,source:'MOD-CW-01: التوقيعان'}),
      ACCOUNT_STEP(['meta','goal','outputs','requirements','revisions'])],
    attachments:{allowed:true,max:5,note:'مراجع ومصادر المعلومات.'}
  },
  {
    key:'FORM-CW-STYLE',frm:'FRM-023',step_no:8,cycle:'تجهيز المشروع',department:'CW',mandate:'حسب النطاق',
    classification:'دليل مرجعي',
    depends_on:[needs('FORM-CW-BRIEF','فهرس الـ41، عمود «المرفقات / الارتباطات» لصف FRM-023: «مرفق: موجز المحتوى»')],
    title:'دليل أسلوب العميل',title_en:'Style Guide Template (MOD-CW-02)',
    // الملف مسمّى VD-03 ومحتواه CW-02 (تعارض 3). الرمزان اسمان بديلان.
    aliases:{code:['FRM-023','CW-02','MOD-CW-02','VD-03'],name_ar:['دليل أسلوب العميل','دليل الأسلوب'],name_en:['Style Guide','Style Guide Template']},
    subject_kinds:['project','opportunity'],
    warnings:['تعارض المصدر 3: ملف هذا الدليل مسمّى VD-03 ومحتواه CW-02. الرمزان اسمان بديلان، والمعرّف الداخلي هو المرجع.',
      'تعارض المصدر 8: صف Twitter/X يجمع «100–150 كلمة» مع حد أقصى «280 حرفًا». النصّان محفوظان كما وردا ويحتاجان قرار مالك.'],
    sections:[
      section('meta','بيانات العميل','المحتوى والترجمة',[
        f('client','العميل','Client','text',{max_length:180}),
        f('sector','القطاع','Sector','text',{max_length:120}),
        f('platforms','المنصات المستخدمة','Platforms used','textarea',{max_length:1500})
      ]),
      section('voice','نبرة الصوت','المحتوى والترجمة',[
        f('main_tone','النبرة الرئيسية','Main tone','text',{max_length:180}),
        f('persona','وصف الشخصية','Persona','textarea',{max_length:2000}),
        f('style','الأسلوب','Style','textarea',{max_length:2000}),
        f('audience','الجمهور','Audience','textarea',{max_length:1500}),
        f('language','اللغة','Language','text',{max_length:120}),
        f('formality','مستوى الرسمية','Formality level','text',{max_length:120})
      ]),
      section('words','الكلمات والعبارات','المحتوى والترجمة',[
        f('preferred_words','الكلمات والعبارات المفضلة، والسبب / السياق','Preferred words and why','textarea',
          {max_length:2500,help:'القالب الأصلي ثمانية صفوف.'}),
        f('forbidden_words','الكلمات والعبارات المحظورة، والسبب / البديل المقترح','Forbidden words and alternatives','textarea',
          {max_length:2500,help:'القالب الأصلي ثمانية صفوف.'})
      ]),
      section('lengths','معايير الطول والتنسيق لكل منصة','المحتوى والترجمة',[
        f('length_rules','المعايير المعتمدة لكل منصة','Confirmed per-platform length rules','checks',
          {options:STYLE_LENGTHS,inferred:true,help:'النصوص كما وردت في جدول المصدر بأعمدته السبعة. صف Twitter/X يحمل تعارض المصدر نفسه '
            +'(100-150 كلمة مقابل 280 حرف)، وصفّا المقال والسكريبت يقولان «غير مطلوب» للإيموجي و«حسب المدة» للطول الأقصى في السكريبت.'}),
        f('length_notes','ملاحظات','Notes','textarea',{required:false,max_length:2000,
          help:'عمود «ملاحظات» السابع في جدول المصدر؛ لم ينقله الملحق.'})
      ])
    ],
    author:author('أعدّه فريق المحتوى','studio.use'),
    chain:[step('content_manager','توقيع مدير المحتوى','studio.use',['meta','voice','words','lengths'],
      {from_signature:true,source:'MOD-CW-02: «تاريخ الاعتماد وتوقيع مدير المحتوى»'}),
      ACCOUNT_STEP(['meta','voice','words','lengths'])],
    attachments:{allowed:true,max:5,note:'دليل العميل الأصلي إن وُجد.'}
  },
  // ───────────────────── نماذج الموارد البشرية الثمانية ─────────────────────
  //
  // سندها غير سند نماذج دورة المشروع: مجلد «نماذج الموارد البشرية 360» في درايف ليس في فهرس الـ41 ولا في
  // سجلات MOD التسعة — التقاطع بينهما صفر (جرد درايف §4). فسجل القراءة المباشرة `SOURCE-FILES-VERIFIED.md`
  // لا يذكر منها حرفًا، ولا يصح أن يُقدَّم سندًا لها. سند كل نموذج هنا: **اسم ملفه في درايف** كما هو مسجّل في
  // `DRIVE-FORMS-INVENTORY.md`، ومعه سجل `HR-FORMS-SOURCE-REGISTER.json` الذي يذكر لكل نموذج ما قُرئ منه وما لم يُقرأ.
  //
  // الرموز HR-01…HR-08 **رموز سجلٍّ لا رموز مصدر**: المجلد يسمّي نماذجه بأسماء ملفاتها ولا يرقّمها، فالرمز
  // موسوم ambiguous ولا يُعرض معرّفًا. والمعرّف هو المفتاح الداخلي وحده.
  //
  // ولا بند لها في فهرس الدورة (step_no=null) ولا موضع في «تجهيز المشروع / تنفيذ المشروع»: دورتها دورة الموظف.
  //
  // **قاعدة سلسلة الاعتماد في هذه الثمانية.** سطر التوقيع في القالب يصير خطوة اعتماد إلكترونية — لكن فقط حين
  // يوجد في المنصة تصريح يحمل ذلك المقعد فعلًا. ومقاعد القيادة (نائب الرئيس للخدمات المؤسسية، الرئيس التنفيذي)
  // لا تصاريح عامة لها: الموجود `pricing.vp.approve` و`pricing.exception.approve` وهما مقعدان في ورقة التسعير
  // وحدها. ومحطتا «الشؤون الإدارية» و«الإدارة المالية» في إخلاء الطرف لا دور مالك لهما في `app/lifecycle.mjs`
  // (OWNER_ROLES خمسة: manager, hr, it, pm, employee). فما لا تصريح له **لا يُلبَس تصريحًا قريبًا**: يُذكر في
  // تنبيهات النموذج أن سطر توقيعه بانتظار قرار المالك في من يحمله، ولا يُخترع مقعد.
  //
  // **وشكل الوثيقة.** لا تخطيط صفحة للطباعة ولا سطر توقيع، كما في الثمانية والعشرين قبلها. وما يحفظ شكل النموذج
  // الأصلي حين يحتاجه المالك وثيقةً هو ما تفعله التعريفات القائمة: الأقسام بترتيب الأصل وأسماء محطاته، والعمود
  // كما كُتب في القالب اسمَ حقلٍ حرفيًّا، وعدد صفوف القالب الثابتة في التلميح، والاسم الإنجليزي حيث كان الأصل
  // ثنائي اللغة. فتُنتَج الوثيقة من القيم المحفوظة بشكل نموذجها.
  {
    key:'FORM-HR-CLEARANCE',frm:null,step_no:null,cycle:'دورة الموظف',department:'HR',mandate:'إلزامي',
    classification:'إخلاء طرف',
    title:'نموذج إخلاء طرف',title_en:'Employee Clearance Form (HR-01)',
    aliases:{code:['HR-01'],file:['نموذج إخلاء طرف'],name_ar:['نموذج إخلاء طرف','إخلاء الطرف'],
      name_en:['Employee Clearance Form','Clearance Form'],
      ambiguous:{'HR-01':'رمز سجل نماذج الموارد البشرية؛ المجلد لا يرقّم نماذجه ولا رمز لهذا النموذج في أي مصدر'}},
    subject_kinds:['request'],
    source_doc:HR_INVENTORY,source_ref:'نموذج إخلاء طرف',
    warnings:['القالب ثنائي اللغة وفيه **ست محطات** بهذا الترتيب: الشؤون الإدارية، المدير المباشر، الإدارة المالية، '
      +'تقنية المعلومات، الموارد البشرية، الرئيس التنفيذي. لكل محطة بنود تحقّق واسم وتوقيع وتاريخ وملاحظة (الجرد §6.1). '
      +'الأقسام أدناه هي المحطات الست بترتيبها، فتُنتَج الوثيقة بشكل النموذج.',
      '**نصوص بنود التحقّق نفسها غير مسجّلة في الجرد** — سجّل وجودها ولم ينقل نصّها. فكل قسم محطةٍ يحمل حقل بنودها '
      +'موسومًا غير متحقَّق، ولا تُخترع بنود.',
      '**ثلاث محطات بلا دور مالك في المنصة:** `OWNER_ROLES` في `app/lifecycle.mjs` خمسة (manager, hr, it, pm, employee) '
      +'— لا الشؤون الإدارية ولا الإدارة المالية ولا الرئيس التنفيذي. وتوقيع الرئيس التنفيذي لا يقابله شيء، والموانع '
      +'المالية تُقرأ بتصاريح الرواتب لا بمحطة مالكة. من يحمل هذه المقاعد الثلاثة قرار مالك.',
      'النموذج ثلاث نسخ في المجلد: PDF ومستندا Google متطابقان (3221 بايت لكلٍّ) أُنشئا 31 مارس و16 أغسطس 2026. '
      +'البنية هنا واحدة: الجرد لا يذكر فرقًا بين النسخ.',
      'بياناته تُدخل في شاشة «إخلاء الطرف» حيث تحقّقها وبوابتها (`app/lifecycle.mjs`)، والخدمة `HR-RESIGNATION` تبقى '
      +'طلبًا عامًا لأن الشاشة لموظف الموارد البشرية وحده. هذا التعريف يحفظ شكل القالب وسنده، ولا يفتح تعبئة موازية.'],
    sections:[
      section('subject','بيانات إخلاء الطرف','الموارد البشرية',[
        f('employee_ref','الموظف المعني','Employee','text',{max_length:180,inferred:true,
          help:hrBasis('نموذج إخلاء طرف','§6.1')+'. خانة هوية الموظف في القالب غير منقولة في الجرد، والخانة هنا مقترحة تحتاج اعتماد.'}),
        f('last_working_day','تاريخ آخر يوم عمل','Last working day','date',{required:false,inferred:true,
          help:hrBasis('نموذج إخلاء طرف','§6.1')+'. الجرد لا يسجّل خانة تاريخ في رأس القالب؛ الخانة مقترحة.'})
      ]),
      section('admin_affairs','محطة الشؤون الإدارية','الشؤون الإدارية',[
        f('admin_items','بنود تحقّق الشؤون الإدارية','Administrative Affairs checklist','textarea',{required:false,max_length:2000,
          unverified:'الجرد يسجّل أن للمحطة «بنود تحقّق» ولا ينقل نصّها؛ والقالب لم يُفتح بندًا بندًا (الجرد §6.1)',
          help:hrBasis('نموذج إخلاء طرف','§6.1')}),
        f('admin_note','ملاحظة الشؤون الإدارية','Administrative Affairs note','text',{required:false,max_length:500,
          help:hrBasis('نموذج إخلاء طرف','§6.1')+'. عمود «ملاحظة» في المحطة.'})
      ]),
      section('line_manager','محطة المدير المباشر','المدير المباشر',[
        f('manager_items','بنود تحقّق المدير المباشر','Line manager checklist','textarea',{required:false,max_length:2000,
          unverified:'نصوص بنود المحطة غير مسجّلة في الجرد (§6.1)',help:hrBasis('نموذج إخلاء طرف','§6.1')}),
        f('manager_note','ملاحظة المدير المباشر','Line manager note','text',{required:false,max_length:500,
          help:hrBasis('نموذج إخلاء طرف','§6.1')+'. عمود «ملاحظة» في المحطة.'})
      ]),
      section('finance','محطة الإدارة المالية','الإدارة المالية',[
        f('finance_items','بنود تحقّق الإدارة المالية','Finance checklist','textarea',{required:false,max_length:2000,
          unverified:'نصوص بنود المحطة غير مسجّلة في الجرد (§6.1)',help:hrBasis('نموذج إخلاء طرف','§6.1')}),
        f('finance_note','ملاحظة الإدارة المالية','Finance note','text',{required:false,max_length:500,
          help:hrBasis('نموذج إخلاء طرف','§6.1')+'. عمود «ملاحظة» في المحطة.'})
      ]),
      section('it','محطة تقنية المعلومات','تقنية المعلومات',[
        f('it_items','بنود تحقّق تقنية المعلومات','IT checklist','textarea',{required:false,max_length:2000,
          unverified:'نصوص بنود المحطة غير مسجّلة في الجرد (§6.1)',help:hrBasis('نموذج إخلاء طرف','§6.1')}),
        f('it_note','ملاحظة تقنية المعلومات','IT note','text',{required:false,max_length:500,
          help:hrBasis('نموذج إخلاء طرف','§6.1')+'. عمود «ملاحظة» في المحطة.'})
      ]),
      section('hr','محطة الموارد البشرية','الموارد البشرية',[
        f('hr_items','بنود تحقّق الموارد البشرية','HR checklist','textarea',{required:false,max_length:2000,
          unverified:'نصوص بنود المحطة غير مسجّلة في الجرد (§6.1)',help:hrBasis('نموذج إخلاء طرف','§6.1')}),
        f('hr_note','ملاحظة الموارد البشرية','HR note','text',{required:false,max_length:500,
          help:hrBasis('نموذج إخلاء طرف','§6.1')+'. عمود «ملاحظة» في المحطة.'})
      ]),
      section('ceo','محطة الرئيس التنفيذي','الرئيس التنفيذي',[
        f('ceo_items','بنود تحقّق الرئيس التنفيذي','CEO checklist','textarea',{required:false,max_length:2000,
          unverified:'نصوص بنود المحطة غير مسجّلة في الجرد (§6.1)',help:hrBasis('نموذج إخلاء طرف','§6.1')}),
        f('ceo_note','ملاحظة الرئيس التنفيذي','CEO note','text',{required:false,max_length:500,
          help:hrBasis('نموذج إخلاء طرف','§6.1')+'. عمود «ملاحظة» في المحطة.'})
      ])
    ],
    author:author('أعدّه أخصائي الموارد البشرية','people.manage'),
    // محطة الموارد البشرية وحدها لها تصريح يحمل مقعدها. الخمس الباقية بانتظار قرار المالك في حاملها،
    // فلا تُلبَس تصريحًا قريبًا ولا تُقدَّم خطوة إلكترونية قائمة.
    chain:[step('hr_station','اعتماد محطة الموارد البشرية','people.manage',
      ['subject','admin_affairs','line_manager','finance','it','hr','ceo'],
      {from_signature:true,source:'محطة «الموارد البشرية» في القالب: اسم وتوقيع وتاريخ (الجرد §6.1)'})],
    attachments:{allowed:true,max:8,note:'ما تطلبه المحطات من إثباتات تسليم العهدة.'}
  },
  {
    key:'FORM-HR-TRANSFER',frm:null,step_no:null,cycle:'دورة الموظف',department:'HR',mandate:'مشروط: عند وجود طلب',
    classification:'نقل وتعديل',
    title:'نموذج نقل الموظفين بين الإدارات',title_en:'Inter-Department Employee Transfer Form (HR-02)',
    aliases:{code:['HR-02'],file:['نموذج نقل الموظفين بين الإدارات'],
      name_ar:['نموذج نقل الموظفين بين الإدارات','النقل بين الإدارات'],
      name_en:['Employee Transfer Form','Inter-Department Transfer'],
      ambiguous:{'HR-02':'رمز سجل نماذج الموارد البشرية؛ لا رمز لهذا النموذج في أي مصدر'}},
    subject_kinds:['request'],
    source_doc:HR_INVENTORY,source_ref:'نموذج نقل الموظفين بين الإدارات',
    warnings:['القالب يحمل **موافقتَي مديرين لا واحدة**: المدير المباشر الحالي والمدير المباشر المستقبلي، كلًّا بحالة '
      +'طلب (موافق / غير موافق) وملاحظات، ثم المسمى الحالي والمسمى المستقبلي (الجرد §6.3). وهما حالتان في القالب '
      +'نفسه لا سطرا توقيع، فبقيتا حقلين كما هما.',
      '**فجوة مع الخدمة القائمة:** حقول `HR-JOB-CHANGE` خمسة (employee_name, change_type, new_value, effective_date, '
      +'justification) — لا موضع فيها لموافقة المدير المستقبلي ولا للمسمّيين معًا (الجرد §6.3).',
      'سلسلة التوقيع الثلاثية في القالب: مدير رأس المال البشري ← نائب الرئيس للخدمات المؤسسية ← الرئيس التنفيذي '
      +'(الجرد §3.1، مقروءة من سطور توقيع هذا النموذج). ومقعد مدير رأس المال البشري وحده له تصريح في المنصة؛ '
      +'ومقعدا نائب الرئيس والرئيس التنفيذي لا تصريح عامًّا لهما (الموجود مقعدا ورقة التسعير وحدهما)، '
      +'فمن يحملهما قرار مالك ولم يُخترع لهما مقعد.'],
    sections:[
      section('subject','بيانات النقل','الموارد البشرية',[
        f('employee_ref','الموظف المعني','Employee','text',{max_length:180,inferred:true,
          help:hrBasis('نموذج نقل الموظفين بين الإدارات','§6.3')+'. الجرد يصف أقسام القالب ولا ينقل خانة تعريف الموظف؛ الخانة مقترحة.'}),
        f('from_department','الإدارة الحالية','Current department','text',{max_length:120,inferred:true,
          help:hrBasis('نموذج نقل الموظفين بين الإدارات','§6.3')+'. النقل «بين الإدارات» باسم النموذج نفسه، وخانتا الإدارتين غير منقولتين في الجرد.'}),
        f('to_department','الإدارة المستقبلية','Receiving department','text',{max_length:120,inferred:true,
          help:hrBasis('نموذج نقل الموظفين بين الإدارات','§6.3')+'. مقترحة كسابقتها.'}),
        f('current_title','المسمى الحالي','Current job title','text',{max_length:120,
          help:hrBasis('نموذج نقل الموظفين بين الإدارات','§6.3')+'. خانة في القالب.'}),
        f('future_title','المسمى المستقبلي','Future job title','text',{max_length:120,
          help:hrBasis('نموذج نقل الموظفين بين الإدارات','§6.3')+'. خانة في القالب.'})
      ]),
      section('managers','موافقة المديرين','الموارد البشرية',[
        f('current_manager_state','حالة طلب المدير المباشر الحالي','Current line manager decision','select',
          {options:['موافق','غير موافق'],help:hrBasis('نموذج نقل الموظفين بين الإدارات','§6.3')+'. حالة في القالب بخيارَيها.'}),
        f('current_manager_notes','ملاحظات المدير المباشر الحالي','Current line manager notes','textarea',
          {required:false,max_length:1500,help:hrBasis('نموذج نقل الموظفين بين الإدارات','§6.3')}),
        f('future_manager_state','حالة طلب المدير المباشر المستقبلي','Receiving line manager decision','select',
          {options:['موافق','غير موافق'],help:hrBasis('نموذج نقل الموظفين بين الإدارات','§6.3')+'. حالة في القالب بخيارَيها.'}),
        f('future_manager_notes','ملاحظات المدير المباشر المستقبلي','Receiving line manager notes','textarea',
          {required:false,max_length:1500,help:hrBasis('نموذج نقل الموظفين بين الإدارات','§6.3')})
      ])
    ],
    author:author('أعدّه أخصائي الموارد البشرية','people.manage'),
    chain:[step('hcm_manager','توقيع مدير رأس المال البشري','hr.policy.accept',['subject','managers'],
      {from_signature:true,source:'سطر توقيع مدير رأس المال البشري في القالب (الجرد §3.1 و§6.3)'})],
    // البوابة من القالب نفسه: نقلٌ بلا موافقة الإدارة المستقبلية لا يمرّ اعتمادًا.
    gates:[gate('future_manager_state','equals','موافق',
      'القالب يشترط موافقة المدير المباشر المستقبلي: بغير «موافق» ما يمرّ الاعتماد')],
    attachments:{allowed:true,max:5,note:'ما يسند طلب النقل من مراسلات الإدارتين.'}
  },
  {
    key:'FORM-HR-INTERVIEW-EVAL',frm:null,step_no:null,cycle:'دورة الموظف',department:'HR',mandate:'مشروط: عند وجود طلب',
    classification:'تقييم',
    title:'نموذج تقييم المقابلة الشخصية',title_en:'Interview Evaluation Form — 3.6T (HR-03)',
    aliases:{code:['HR-03'],file:['Interview Evaluation Form — 3.6T'],
      name_ar:['نموذج تقييم المقابلة الشخصية','تقييم المقابلة'],
      name_en:['Interview Evaluation Form','Interview Evaluation Form — 3.6T'],
      ambiguous:{'HR-03':'رمز سجل نماذج الموارد البشرية؛ لا رمز لهذا النموذج في أي مصدر'}},
    subject_kinds:['request'],
    source_doc:HR_INVENTORY,source_ref:'Interview Evaluation Form — 3.6T',
    warnings:['القالب **ثلاثة عشر مؤشرًا بسلّم 1–5 بلا أوزان**، بلا حقل دليل، **وينص صراحةً** على ترك المؤشر فارغًا '
      +'عند عدم انطباقه (الجرد §6.2). فالمؤشرات هنا ثلاثة عشر اختياريًّا بسلّم 1–5، كما في القالب.',
      '**نصوص المؤشرات الثلاثة عشر غير مسجّلة في الجرد** — سجّل عددها وسلّمها ولم ينقل عنواناتها. فكل مؤشر موسوم '
      +'غير متحقَّق، ولا يُخترع له عنوان.',
      '**الوحدة القائمة ترفض القالب من ثلاثة أوجه:** `app/people.mjs` يشترط أن تساوي أوزان معايير المقابلة 100، '
      +'ويطلب `evidence` نصيًّا لكل معيار، والقالب بلا أوزان وبلا دليل ويجيز الفراغ (الجرد §6.2). التوفيق بين '
      +'القالب والوحدة قرار مالك: إمّا أوزان للقالب، أو استثناء للنموذج من شرط الأوزان والدليل.',
      'ومعه في المجلد «Candidate Interview Sheet» — اختصارٌ لا ملف، ونوع متمايز ثانٍ يشترك معه في وحدة `people.mjs` '
      +'(الجرد §1.3 و§2). لم يُبنَ هنا: اختصاره لم يُفكّ ولا قالب له.'],
    sections:[
      section('candidate','بيانات المقابلة','الموارد البشرية',[
        f('candidate_ref','المرشح','Candidate','text',{max_length:180,inferred:true,
          help:hrBasis('Interview Evaluation Form — 3.6T','§6.2')+'. الجرد يصف المؤشرات ولا ينقل رأس القالب؛ الخانة مقترحة.'}),
        f('vacancy','الوظيفة المتقدَّم لها','Vacancy','text',{max_length:180,inferred:true,
          help:hrBasis('Interview Evaluation Form — 3.6T','§6.2')+'. مقترحة كسابقتها.'}),
        f('interview_date','تاريخ المقابلة','Interview date','date',{required:false,inferred:true,
          help:hrBasis('Interview Evaluation Form — 3.6T','§6.2')+'. مقترحة كسابقتها.'})
      ]),
      // ثلاثة عشر مؤشرًا: العدد والسلّم من المصدر، والعنوان لا. كلها اختيارية لأن القالب يجيز ترك غير المنطبق فارغًا.
      section('indicators','مؤشرات التقييم (13 مؤشرًا، سلّم 1–5)','الموارد البشرية',
        Array.from({length:13},(_,i)=>f(`indicator_${String(i+1).padStart(2,'0')}`,
          `المؤشر ${i+1} — عنوانه غير مسجّل في الجرد`,`Indicator ${i+1}`,'number',
          {required:false,min:1,max:5,
            unverified:'عدد المؤشرات (13) وسلّمها (1–5) مسجّلان في الجرد §6.2، وعنوان كل مؤشر غير مسجّل',
            help:hrBasis('Interview Evaluation Form — 3.6T','§6.2')
              +'. اتركه فارغًا إذا ما كان المؤشر منطبقًا — القالب ينص على ذلك صراحةً.'}))),
      section('outcome','الخلاصة','الموارد البشرية',[
        f('recommendation','توصية المقابلة','Interview recommendation','textarea',{required:false,max_length:2000,inferred:true,
          help:hrBasis('Interview Evaluation Form — 3.6T','§6.2')+'. الجرد لا يسجّل خانة توصية؛ الخانة مقترحة تحتاج اعتماد.'})
      ])
    ],
    author:author('أعدّه من أجرى المقابلة','people.manage'),
    chain:[step('hiring_owner','اعتماد مالك التوظيف','people.manage',['candidate','indicators','outcome'],
      {inferred:true,source:'الجرد لا ينقل سطر توقيع من هذا القالب؛ خطوة اعتماد مقترحة تحتاج اعتماد المالك'})],
    attachments:{allowed:true,max:5,note:'ما يسند التقييم من مخرجات المقابلة.'}
  },
  {
    key:'FORM-HR-SPORTS-CLUB',frm:null,step_no:null,cycle:'دورة الموظف',department:'HR',mandate:'مشروط: عند وجود طلب',
    classification:'صرف مزية',
    title:'طلب صرف تعويض أندية',title_en:'Sports Club Reimbursement Letter (HR-04)',
    aliases:{code:['HR-04'],file:['طلب صرف تعويض أندية','شيت بدل الأندية الرياضية.xlsx'],
      name_ar:['طلب صرف تعويض أندية','بدل الأندية الرياضية'],
      name_en:['Sports Club Reimbursement','Sports Club Allowance'],
      ambiguous:{'HR-04':'رمز سجل نماذج الموارد البشرية؛ لا رمز لهذا النموذج في أي مصدر'}},
    subject_kinds:['request'],
    source_doc:HR_INVENTORY,source_ref:'طلب صرف تعويض أندية',
    warnings:['**القالب ليس طلب موظف:** هو **خطاب صادر** من مدير الموارد البشرية إلى الإدارة المالية لجهة خارجية، '
      +'بجدول (الرقم الوظيفي، اسم الموظف، المسمى، تاريخ المباشرة، إجمالي التعويض) وقيمة إجمالية (الجرد §6.4). '
      +'فهو مطالبة جماعية بين جهتين لا مطالبة فرد.',
      '**فجوة مع الوحدة القائمة:** `app/secondment-benefits.mjs` يغطي مطالبة الموظف السنوية (`SPORTS_CATEGORIES`: '
      +'اشتراك نادٍ رياضي / أجهزة رياضية، طلب واحد في السنة، المادة 8/ج)، ولا يغطي خطاب الصرف الجماعي بين جهتين. '
      +'وأنواع الخطابات كلها موجَّهة لمصلحة الموظف لا لمطالبة بين منشأتين (الجرد §6.4).',
      '**حالة السداد غير ممثَّلة:** مجلد «بدل أندية لم يدفع» في درايف يقول إن للمطالبة حالة سداد تُتابع (الجرد §6.4). '
      +'الحقل هنا يسجّلها، ودورة متابعتها قرار مالك.',
      'وخيارات `HR-BENEFIT-CLAIM` (تابع تأمين، ترقية فئة، بدل سكن، بدل تعليم، أخرى) **لا تذكر الأندية** — فلا خدمة '
      +'لهذا النموذج في الدليل (الجرد §2).',
      'القالب **ملفان مستقلان بمعرّفين مختلفين** في مجلدين (مجلد القوالب ومجلد بدل الأندية)، و«شيت بدل الأندية '
      +'الرياضية.xlsx» نسختان مستقلتان إحداهما في مجلد الإنذارات خطأً (الجرد §1.3). الجرد لا يذكر فرقًا في البنية.'],
    sections:[
      section('letter','بيانات الخطاب','الموارد البشرية',[
        f('addressee','المخاطَب','Addressee','text',{max_length:180,
          help:hrBasis('طلب صرف تعويض أندية','§6.4')+'. القالب خطاب إلى الإدارة المالية.'}),
        f('external_party','الجهة الخارجية','External party','text',{max_length:180,
          help:hrBasis('طلب صرف تعويض أندية','§6.4')+'. القالب يصرف لجهة خارجية.'}),
        f('category','بند الصرف','Reimbursement category','select',{options:['اشتراك نادٍ رياضي','أجهزة رياضية'],
          help:'سنده `SPORTS_CATEGORIES` في `app/secondment-benefits.mjs` كما قاسه '+HR_INVENTORY+' §2 — لا القالب الورقي. '
            +'الجرد لا ينقل خانة بندٍ من القالب.',inferred:true})
      ]),
      // أعمدة الجدول بنصها من القالب. حقل واحد يحمل الأعمدة الخمسة كما يفعل جدولا الدفعات في نماذج دورة المشروع.
      section('beneficiaries','جدول المستفيدين','الموارد البشرية',[
        f('rows',SPORTS_CLUB_COLUMNS.join('، '),'Beneficiary rows','textarea',{max_length:6000,
          help:`أعمدة الجدول بنصها من القالب: ${SPORTS_CLUB_COLUMNS.join(' · ')}. `
            +hrBasis('طلب صرف تعويض أندية','§6.4')+'. عدد صفوف القالب غير مسجّل في الجرد.'})
      ]),
      section('totals','الإجمالي وحالة السداد','الموارد البشرية',[
        f('total_value','القيمة الإجمالية (ريال)','Total value','text',{max_length:120,
          help:hrBasis('طلب صرف تعويض أندية','§6.4')+'. القالب يحمل قيمة إجمالية.'}),
        f('settlement_state','حالة السداد','Settlement state','select',{options:['سُدِّد','لم يُسدَّد'],inferred:true,
          undefined_in_source:'دورة متابعة السداد ومهلتها',
          help:hrBasis('طلب صرف تعويض أندية','§6.4')+'. مجلد «بدل أندية لم يدفع» يقول إن للمطالبة حالة سداد تُتابع، '
            +'والقالب لا يحمل خانةً لها. '+INFERRED_NOTE})
      ])
    ],
    author:author('أعدّه مدير الموارد البشرية','hr.benefits.manage'),
    chain:[step('finance_confirm','التأكيد المالي لصرف التعويض','benefits.finance.confirm',['letter','beneficiaries','totals'],
      {from_signature:true,source:'القالب خطاب موجَّه إلى الإدارة المالية للصرف (الجرد §6.4)'})],
    attachments:{allowed:true,max:20,note:'إيصالات الاشتراك التي تسند صفوف الجدول.'}
  },
  {
    key:'FORM-HR-SALARY-CERT',frm:null,step_no:null,cycle:'دورة الموظف',department:'HR',mandate:'مشروط: عند وجود طلب',
    classification:'خطاب',
    title:'خطاب تعريف بالراتب',title_en:'Salary Certificate Letter (HR-05)',
    aliases:{code:['HR-05'],file:['خطاب تعريف بالراتب'],
      name_ar:['خطاب تعريف بالراتب','خطاب التعريف بالراتب'],
      name_en:['Salary Certificate','Salary Definition Letter'],
      ambiguous:{'HR-05':'رمز سجل نماذج الموارد البشرية؛ لا رمز لهذا النموذج في أي مصدر'}},
    subject_kinds:['request'],
    source_doc:HR_INVENTORY,source_ref:'خطاب تعريف بالراتب',
    warnings:['**خانة رقم الهوية في القالب لا تُوصَّل، وهي قرار سياسة لا مهمة بناء:** جدول بيانات الموظف في القالب '
      +'يحمل خانة رقم الهوية، و`app/pii.mjs` ينص «لا تُسجَّل أرقام الهوية أو الإقامة في المنصة بأي حقل»، '
      +'و`looksLikeIdentifier` يرفض ستة أرقام متتالية فأكثر (الجرد §6.5). فلا حقل لها هنا: إمّا يُقرّ المالك استثناءً '
      +'مكتوبًا لخطاباتٍ بعينها، أو تُصدَر الخطابات بدونها. ويسري الحكم على كل نموذج ورقي فيه رقم هوية.',
      '**نصّ الخطاب مبنيّ في وحدة الخطابات لا هنا:** `HR-SALARY-CERT` تُحوَّل إلى «خطاباتي» بنوع `salary`، '
      +'و`show_salary` بخياراته الثلاثة يغطي التعريف بلا راتب (الجرد §2). وترحيل 156 بنى نصّ الشركة الحرفي مسودةً '
      +'تحتاج اعتماد شخص ثانٍ، وسطر توقيعها **صفة** «مدير رأس المال البشري» لا اسم شخص. فهذا التعريف يحفظ شكل '
      +'القالب وسنده، والوثيقة تُنتَج من وحدة الخطابات.',
      '**بقية خانات القالب غير مسجّلة في الجرد:** الجرد نقل خانة رقم الهوية وحدها من جدول بيانات الموظف، ولم ينقل '
      +'بقية الخانات ولا نصّ متن الخطاب. فما دون ذلك موسوم مقترحًا، ولا يُخترع.'],
    sections:[
      section('request','بيانات الخطاب','الموارد البشرية',[
        f('employee_ref','الموظف المعني','Employee','text',{max_length:180,inferred:true,
          help:hrBasis('خطاب تعريف بالراتب','§6.5')+'. جدول بيانات الموظف في القالب مذكور، وخاناته غير منقولة عدا رقم الهوية. '+INFERRED_NOTE}),
        f('addressee','المخاطَب','Addressee','text',{max_length:180,inferred:true,
          help:hrBasis('خطاب تعريف بالراتب','§6.5')+'. '+INFERRED_NOTE}),
        f('show_salary','إظهار الراتب في الخطاب','Show salary','select',
          {options:['الراتب الأساسي','الراتب الإجمالي','بلا راتب'],inferred:true,
            help:'سنده `show_salary` بخياراته الثلاثة في `app/letters.mjs` كما قاسه '+HR_INVENTORY+' §2 — لا القالب الورقي. '+INFERRED_NOTE})
      ])
    ],
    author:author('أعدّه أخصائي الخطابات','hr.letters.prepare'),
    chain:[step('letters_issue','إصدار مدير رأس المال البشري','hr.letters.issue',['request'],
      {from_signature:true,source:'سطر توقيع القالب صفةً: «مدير رأس المال البشري» (الجرد، ترحيل 156)'})],
    attachments:{allowed:false,max:0,note:'لا مرفق: الخطاب يُنتَج من السجل لا من ملف مرفوع.'}
  },
  {
    key:'FORM-HR-DISCIPLINE-NOTICE',frm:null,step_no:null,cycle:'دورة الموظف',department:'HR',mandate:'مشروط: عند وجود طلب',
    classification:'خطاب',
    title:'خطاب الإنذار والخصم',title_en:'Warning and Deduction Letter (HR-06)',
    aliases:{code:['HR-06'],file:['خطاب الإنذار والخصم'],
      name_ar:['خطاب الإنذار والخصم','إشعار الجزاء'],
      name_en:['Warning and Deduction Letter','Disciplinary Notice'],
      ambiguous:{'HR-06':'رمز سجل نماذج الموارد البشرية؛ لا رمز لهذا النموذج في أي مصدر'}},
    subject_kinds:['request'],
    source_doc:HR_INVENTORY,source_ref:'خطاب الإنذار والخصم',
    source_status:'بانتظار اعتماد المصدر',
    warnings:['**بانتظار اعتماد المصدر: القالب لم يُقرأ.** ملف `خطاب الإنذار والخصم.pdf` لم يُفتح — وقف الجرد عن قراءة '
      +'ملفات هذه العائلة بعد منع مصنِّف حماية البيانات الشخصية لـ`مخالفة عمل.docx` (الجرد §7). فبنية هذا النموذج '
      +'**غير موصوفة من أصلها**، ولا حقل هنا مسنَدًا إلى القالب.',
      'ما هو مسنَد: تغطية الوحدة مقيسة من الكود. `PENALTY_KINDS` في `app/discipline.mjs` تضم `warning` («إنذار كتابي») '
      +'و`fine` (خصم بنقاط أساس من أجر اليوم)، ونوع `discipline_notice` في `HR_INITIATED` بوحدة الخطابات (الجرد §2). '
      +'وترحيل 156 بنى نصّ الشركة الحرفي مسودةً، وسطر توقيعها صفة «مدير رأس المال البشري» لا اسم شخص.',
      '**ومطابقة حقلٍ بحقل على القالب الورقي تبقى غير منجزة ولا تُدّعى** (الجرد §7). فتح القالب أو طلبه من الموارد '
      +'البشرية يسبق أي حقل يُقدَّم مسنَدًا هنا.'],
    sections:[
      section('penalty','الجزاء','الموارد البشرية',[
        f('penalty_kind','نوع الجزاء','Penalty kind','select',{options:['إنذار كتابي','خصم'],
          help:'سنده `PENALTY_KINDS` في `app/discipline.mjs` كما قاسه '+HR_INVENTORY+' §2 — لا القالب الورقي.'}),
        f('notice_body','متن الإشعار','Notice body','textarea',{required:false,max_length:4000,
          unverified:'ملف «خطاب الإنذار والخصم.pdf» لم يُفتح، فمتن القالب وخاناته غير موصوفة من أصلها (الجرد §7)',
          help:hrBasis('خطاب الإنذار والخصم','§7')})
      ])
    ],
    author:author('أعدّه من يسجّل المخالفة ويقترح الجزاء','hr.discipline.propose'),
    chain:[step('penalty_decide','توقيع الجزاء — صاحب الصلاحية','hr.discipline.decide',['penalty'],
      {unverified:'سطور توقيع القالب غير مقروءة؛ المقعد هنا من `hr.discipline.decide` في المنصة لا من القالب',
        source:'`hr.discipline.decide` — توقيع الجزاء التأديبي (الجرد §2)'})],
    attachments:{allowed:true,max:5,note:'ما يسند الواقعة، وما تطلبه اللائحة من إثبات.'}
  },
  {
    key:'FORM-HR-MISCONDUCT',frm:null,step_no:null,cycle:'دورة الموظف',department:'HR',mandate:'مشروط: عند وجود طلب',
    classification:'مخالفة وجزاء',
    title:'نموذج مخالفة عمل',title_en:'Work Misconduct Form (HR-07)',
    aliases:{code:['HR-07'],file:['مخالفة عمل'],
      name_ar:['نموذج مخالفة عمل','مخالفة عمل'],
      name_en:['Work Misconduct Form','Misconduct Record'],
      ambiguous:{'HR-07':'رمز سجل نماذج الموارد البشرية؛ لا رمز لهذا النموذج في أي مصدر'}},
    subject_kinds:['request'],
    source_doc:HR_INVENTORY,source_ref:'مخالفة عمل',
    source_status:'بانتظار اعتماد المصدر',
    warnings:['**بانتظار اعتماد المصدر: القالب مُنع من القراءة.** ملف `مخالفة عمل.docx` منعه مصنِّف حماية البيانات '
      +'الشخصية (`PII Data Handling`)، ولم يُحاول الوصول إليه بأداة أخرى (الجرد §7). فبنيته **غير موصوفة من أصلها**، '
      +'ولا حقل هنا مسنَدًا إلى القالب.',
      'وهو **أعلى ما يستحق الإنجاز في هذه العائلة:** له 35 نسخة معبّأة في درايف، أكثر من أي نموذج آخر في الشجرة '
      +'(الجرد §7). استخراج حقوله يحتاج فتح المالك للقالب أو أداةً مصرَّحًا لها.',
      'ما هو مسنَد: `app/discipline.mjs` — سجل المخالفات والجزاءات على اللائحة م111–م126. ولا خدمة له في الدليل '
      +'**بالتصميم**: الجزاء يبدأه موظف الموارد البشرية لا الموظف (الجرد §2).'],
    sections:[
      section('incident','الواقعة','الموارد البشرية',[
        f('incident_summary','وصف المخالفة','Misconduct description','textarea',{required:false,max_length:4000,
          unverified:'ملف «مخالفة عمل.docx» منعه مصنِّف حماية البيانات الشخصية، فأقسام القالب وحقوله غير موصوفة من أصلها (الجرد §7)',
          help:hrBasis('مخالفة عمل','§7')}),
        f('article_ref','مادة اللائحة','Regulation article','text',{required:false,max_length:120,
          help:'سنده `app/discipline.mjs` على اللائحة م111–م126 كما قاسه '+HR_INVENTORY+' §2 — لا القالب الورقي. '
            +'ونصّ المادة نفسه يبقى بحرفه كما في مكتبة السياسات، ولا يُعاد صوغه هنا.'})
      ])
    ],
    author:author('أعدّه من يسجّل المخالفة ويحقّق فيها','hr.discipline.propose'),
    chain:[step('penalty_decide','البتّ في المخالفة — صاحب الصلاحية','hr.discipline.decide',['incident'],
      {unverified:'سطور توقيع القالب غير مقروءة؛ المقعد هنا من `hr.discipline.decide` في المنصة لا من القالب',
        source:'`hr.discipline.decide` — توقيع الجزاء التأديبي والبت في التظلم (الجرد §2)'})],
    attachments:{allowed:true,max:5,note:'ما يسند الواقعة.'}
  },
  {
    key:'FORM-HR-SECONDMENT-REQUEST',frm:null,step_no:null,cycle:'دورة الموظف',department:'HR',mandate:'مشروط: عند وجود طلب',
    classification:'طلب',
    title:'نموذج طلب انتداب',title_en:'Secondment Request Form (HR-08)',
    aliases:{code:['HR-08'],file:['نموذج طلب انتداب'],
      name_ar:['نموذج طلب انتداب','طلب انتداب'],
      name_en:['Secondment Request','Business Travel Request'],
      ambiguous:{'HR-08':'رمز سجل نماذج الموارد البشرية؛ لا رمز لهذا النموذج في أي مصدر'}},
    subject_kinds:['request'],
    source_doc:HR_INVENTORY,source_ref:'نموذج طلب انتداب',
    source_status:'بانتظار اعتماد المصدر',
    warnings:['**بانتظار اعتماد المصدر: بنية القالب غير مسجّلة.** الجرد يسجّل اسم الملف وصيغته (docx) وخدمته الموجَّهة، '
      +'**ولا يسجّل أقسامه ولا حقوله ولا سطور توقيعه** — لا في §6 ولا في §1.1. فلا حقل هنا مسنَدًا إلى القالب، '
      +'ولم تُستنبط حقوله من نسخة معبّأة.',
      'ما هو مسنَد: `ADM-TRAVEL` في إدارة مكتب الرئيس («السفر والتنقل») تُحوَّل إلى `travel`، ومعها '
      +'`app/secondment-benefits.mjs` (الجرد §2). و`app/travel.mjs` يجعل الانتداب يقترحه الموظف لنفسه أو مديره المباشر.',
      'فتح القالب أو طلبه من الموارد البشرية يسبق أي حقل يُقدَّم مسنَدًا هنا.'],
    sections:[
      section('request','بيانات الانتداب','الموارد البشرية',[
        f('purpose','الغرض من الانتداب','Secondment purpose','textarea',{required:false,max_length:2000,
          unverified:'الجرد لا يسجّل أقسام «نموذج طلب انتداب» ولا حقوله، والقالب لم يُقرأ (الجرد §1.1 و§2)',
          help:hrBasis('نموذج طلب انتداب','§2')})
      ])
    ],
    author:author('يقترحه الموظف لنفسه أو مديره المباشر','requests.use'),
    chain:[step('travel_authority','اعتماد صاحب صلاحية الانتداب','people.manage',['request'],
      {unverified:'سطور توقيع القالب غير مسجّلة؛ المقعد هنا من `app/travel.mjs` في المنصة لا من القالب',
        source:'`app/travel.mjs`: الانتداب يقترحه الموظف لنفسه أو مديره المباشر، ويعتمده حامل صلاحيته (الجرد §2)'})],
    attachments:{allowed:true,max:5,note:'ما يسند الغرض من الانتداب.'}
  }
].map(form=>({...form,
  depends_on:form.depends_on??[],
  classification:form.classification??'',
  department_name:departmentOf(form.department).name,
  // اقتباس المصدر: ملف سند النموذج أولًا — سجل القراءة المباشرة لنماذج دورة المشروع، وجرد درايف لنماذج
  // الموارد البشرية — ثم رموز النموذج وتصنيفه وبنده وإلزامه وتبعياته. وما لا بند له في فهرس الدورة يُقال ذلك
  // صريحًا، فلا يقرأ أحد «البند null».
  source_doc:form.source_doc??VERIFIED,
  source_status:form.source_status??'مصدر متاح',
  source_note:`${form.source_doc??VERIFIED} — ${form.source_ref??form.frm??'بلا رمز FRM'} · ${form.aliases.code.filter(c=>c!==form.frm).join(' / ')}`
    +(form.source_status?` · ${form.source_status}`:'')
    +` · التصنيف ${form.classification??'—'} · ${form.step_no==null?'بلا بند في فهرس الدورة':`البند ${String(form.step_no).padStart(2,'0')}`} · ${form.mandate}`
    +((form.depends_on??[]).length?` · يتطلب ${form.depends_on.map(d=>d.form_key).join(' + ')}`:'')}));

export const catalogueKeys=()=>FORM_CATALOGUE.map(x=>x.key);
export const catalogueForm=key=>FORM_CATALOGUE.find(x=>x.key===key)??null;
// شبكة تبعيات النماذج كما قرأها عمود «المرفقات / الارتباطات» في فهرس الـ41 — العمود الذي لم ينقله الملحق إطلاقًا.
export const dependencyGraph=()=>FORM_CATALOGUE.filter(form=>form.depends_on.length)
  .map(form=>({form_key:form.key,frm:form.frm,requires:form.depends_on.map(d=>d.form_key),sources:form.depends_on.map(d=>d.source)}));
