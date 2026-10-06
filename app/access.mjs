import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail, AppError } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { sensitiveGrantAlert, newAdminAlert } from './security-alerts.mjs';
import { viewingAs } from './request-context.mjs';
import { refuse } from './refusal.mjs';
import { personAssignment } from './people-read.mjs';

// التصاريح: ما يراه كل حساب ويفعله، مستقلًا عن دوره في مسار الاعتماد.
export const CAPABILITIES=[
  {key:'portal.use',name:'بوابتي والعمل اليومي',group:'الأساس',everyone:true},
  {key:'requests.use',name:'طلباتي وتقديم الخدمات',group:'الأساس',everyone:true},
  {key:'org.view',name:'الهيكل التنظيمي',group:'الأساس',everyone:true},
  {key:'leave.use',name:'مساحة الإجازات',group:'خدمات الموظف',everyone:true},
  {key:'projects.use',name:'المشاريع والمهام',group:'التشغيل',roles:['manager','pm']},
  // محاور حالة المشروع (ترحيل 116): الإعفاء من شرط البدء وإعادة فتح الإقفال استثناءان
  // يُمنحان صراحةً ولا يأتيان بالدور، لأن كليهما يتجاوز قاعدة عمل مكتوبة.
  {key:'projects.readiness.waive',name:'الإعفاء من شرط الدفعة المقدمة أو أمر شراء العميل',group:'التشغيل',sensitive:true},
  {key:'projects.closure.reopen',name:'إعادة فتح إقفال المشروع',group:'التشغيل',sensitive:true},
  // قرار المالك (الخيار «ب»): إقفال المشروع فنيًا وماليًا بيد واحدة ممنوع، ويتجاوزه حامل هذا التصريح بسبب مكتوب يُسجَّل.
  {key:'projects.closure.same_person',name:'إقفال المشروع فنيًا وماليًا بيد واحدة (تجاوز بسبب مكتوب)',group:'التشغيل',sensitive:true},
  {key:'delegations.use',name:'التفويض المؤقت',group:'التشغيل',roles:['manager','hr','it','pm']},
  {key:'budgets.use',name:'مخصصات المشاريع',group:'المالية',roles:['manager']},
  {key:'commercial.use',name:'المبيعات والتسليم',group:'التشغيل',scoped:true},
  {key:'procurement.use',name:'المشتريات',group:'التشغيل',scoped:true},
  {key:'studio.use',name:'الاستوديو والتسليم',group:'التشغيل',scoped:true},
  {key:'finance.use',name:'الدفتر المالي والمستحقات',group:'المالية',scoped:true},
  {key:'vendors.view',name:'دليل الموردين',group:'المشتريات',roles:['manager','pm']},
  {key:'vendors.assess',name:'التقييم الفني للموردين',group:'المشتريات',roles:['manager','pm']},
  {key:'vendors.manage',name:'تسجيل الموردين وتأهيلهم',group:'المشتريات'},
  {key:'vendors.legal',name:'المراجعة القانونية والمخاطر للموردين',group:'المشتريات'},
  {key:'vendors.bank',name:'التحقق المالي من بيانات دفع الموردين',group:'المالية',sensitive:true},
  {key:'clients.manage',name:'ملفات العملاء وفرق الحسابات',group:'التشغيل',roles:['manager','pm']},
  {key:'offerings.manage',name:'كتالوج الباقات التجارية',group:'التشغيل',roles:['manager','pm']},
  {key:'approvals.record',name:'توثيق موافقات العملاء الخارجية',group:'التشغيل',roles:['manager','pm']},
  {key:'approvals.verify',name:'التحقق من موافقات العملاء الموثقة',group:'التشغيل',roles:['manager']},
  {key:'people.manage',name:'التوظيف والتهيئة',group:'خدمات الموظف',roles:['hr']},
  {key:'employees.view',name:'السجل الوظيفي',group:'خدمات الموظف',roles:['hr']},
  {key:'hr.policy.prepare',name:'إعداد سياسات الموارد البشرية',group:'خدمات الموظف',roles:['hr']},
  {key:'hr.policy.accept',name:'اعتماد سياسات الموارد البشرية (مدير الموارد البشرية)',group:'خدمات الموظف',sensitive:true},
  {key:'hr.leave.authority',name:'صاحب الصلاحية في الإجازة الاستثنائية فوق 5 أيام ومرافقة المريض (م90، م91)',group:'خدمات الموظف',sensitive:true},
  {key:'hr.contracts.manage',name:'إعداد عقود الموظفين وبنود الراتب',group:'خدمات الموظف',roles:['hr'],sensitive:true},
  {key:'hr.contracts.approve',name:'اعتماد عقود الموظفين',group:'خدمات الموظف',sensitive:true},
  {key:'hr.attendance.manage',name:'متابعة الحضور واقتراح الغياب غير المدفوع',group:'خدمات الموظف',roles:['hr']},
  {key:'hr.attendance.approve',name:'اعتماد الغياب غير المدفوع',group:'خدمات الموظف'},
  {key:'hr.performance.manage',name:'إدارة دورات تقييم الأداء والتدريب',group:'خدمات الموظف',roles:['hr']},
  {key:'hr.performance.calibrate',name:'معايرة التقييم وإصداره والبت في التظلمات',group:'خدمات الموظف',sensitive:true},
  {key:'hr.succession.manage',name:'خطط التعاقب الوظيفي',group:'خدمات الموظف',sensitive:true},
  {key:'payroll.prepare',name:'إعداد مسير الرواتب',group:'خدمات الموظف',roles:['hr'],sensitive:true},
  {key:'payroll.review',name:'مراجعة مسير الرواتب',group:'خدمات الموظف',sensitive:true},
  {key:'payroll.approve',name:'اعتماد مسير الرواتب',group:'خدمات الموظف',sensitive:true},
  {key:'compliance.manage',name:'تقويم الالتزامات النظامية والتحقق من تنفيذها',group:'القيادة'},
  {key:'search.use',name:'البحث الشامل',group:'الأساس',everyone:true},
  {key:'hr.letters.prepare',name:'إعداد خطابات الموظفين',group:'خدمات الموظف',roles:['hr']},
  {key:'hr.letters.issue',name:'إصدار خطابات الموظفين واعتمادها',group:'خدمات الموظف',sensitive:true},
  {key:'hr.cases.handle',name:'حالات الموارد البشرية السرية',group:'خدمات الموظف',roles:['hr'],sensitive:true},
  // سجل المخالفات والجزاءات (ترحيل 097): الموارد البشرية تسجل وتحقق، وصاحب الصلاحية (م113) يقرر بمنح صريح.
  {key:'hr.discipline.propose',name:'تسجيل المخالفات والتحقيق فيها واقتراح الجزاء',group:'خدمات الموظف',roles:['hr']},
  {key:'hr.discipline.decide',name:'توقيع الجزاء التأديبي والبت في التظلم منه (صاحب الصلاحية)',group:'خدمات الموظف',sensitive:true},
  {key:'hr.feedback.manage',name:'دورات التغذية الراجعة واللقاءات الفردية',group:'خدمات الموظف',roles:['hr']},
  {key:'hr.survey.manage',name:'استبيانات النبض وقياس الارتباط',group:'خدمات الموظف',roles:['hr'],sensitive:true},
  {key:'hr.compensation.review',name:'مراجعة التعويضات ونطاقات الرواتب',group:'خدمات الموظف',sensitive:true},
  {key:'hr.workforce.view',name:'لوحة السعودة وتركيبة القوى العاملة',group:'خدمات الموظف',roles:['hr']},
  {key:'hr.operations.use',name:'مركز عمليات الموارد البشرية',group:'خدمات الموظف',roles:['hr']},
  {key:'hr.competency.manage',name:'قاموس الكفاءات ومصفوفة المهارات',group:'خدمات الموظف',roles:['hr']},
  {key:'hr.pip.manage',name:'خطط تحسين الأداء',group:'خدمات الموظف',roles:['hr'],sensitive:true},
  {key:'hr.permissions.delegate',name:'تفويض صلاحيات فريق رأس المال البشري',group:'خدمات الموظف',sensitive:true},
  {key:'bank.reconcile',name:'إعداد المطابقة البنكية',group:'المالية',sensitive:true},
  {key:'bank.reconcile.approve',name:'اعتماد المطابقة البنكية',group:'المالية',sensitive:true},
  {key:'billing.recurring.manage',name:'الفوترة الدورية والدفعات المقدمة',group:'المالية'},
  {key:'finance.forecast.view',name:'التنبؤ النقدي',group:'المالية',sensitive:true},
  {key:'finance.close.manage',name:'قائمة الإقفال الشهري وقفل الفترات',group:'المالية'},
  // منح التفويض المالي (تدقيق دورة التسليم 20260920، B4): finance_grants كان يُقرأ ولا يُكتب،
  // فكانت المالية على قاعدة حقيقية مقفلة على الجميع بلا سبيل لفتحها. التصريح حساس: لا يفتحه
  // امتياز الأدمن الأول وحده، ومن يمنح لا يمنح نفسه.
  {key:'finance.grants.manage',name:'منح التفويض المالي وسحبه',group:'المالية',sensitive:true},
  // حزمة تدقيق الفترة (الحزمة 3، app/audit-export.mjs): تُخرج من المنصة قيود الفترة ومستنداتها واعتماداتها وقطعة سلسلة التدقيق.
  // حساس: لا يفتحه امتياز الأدمن الأول وحده، ويلزم معه تفويض القراءة في الدفتر المالي.
  {key:'finance.audit.export',name:'تصدير حزمة تدقيق الفترة المالية (القيود والمستندات والاعتمادات وسلسلة التدقيق)',group:'المالية',sensitive:true},
  // تسعير المشاريع (ترحيل 108، MOD-BD-02): المشتريات تُعدّ الأسعار، والسياسات واستثناء التسعير قرار الرئيس التنفيذي.
  // مقعدا EPMO ونائب الرئيس التنفيذي من تواقيع النموذج الأربعة، وقد صارت اعتمادات إلكترونية بقرار المالك.
  {key:'pricing.sheets.use',name:'تسعير المشاريع وعروض الأسعار',group:'التشغيل',scoped:true},
  {key:'pricing.epmo.approve',name:'اعتماد ورقة التسعير — مقعد فريق EPMO',group:'التشغيل',scoped:true},
  {key:'pricing.vp.approve',name:'اعتماد ورقة التسعير — مقعد نائب الرئيس التنفيذي للخدمات المؤسسية',group:'القيادة',sensitive:true},
  {key:'pricing.exception.approve',name:'اعتماد سياسات التسعير واستثناء التسعير MOD-BD-03 (الرئيس التنفيذي)',group:'القيادة',sensitive:true},
  {key:'costing.manage',name:'معدلات تكلفة الساعة بالفئة الوظيفية',group:'المالية',sensitive:true},
  {key:'profitability.view',name:'ربحية المشاريع والعملاء',group:'المالية',sensitive:true},
  {key:'tax.returns.prepare',name:'إعداد الإقرارات الضريبية وسجل الاستقطاع',group:'المالية'},
  {key:'tax.returns.review',name:'مراجعة الإقرارات الضريبية',group:'المالية',sensitive:true},
  {key:'governance.objectives.manage',name:'سجل الأهداف والمبادرات',group:'القيادة'},
  {key:'governance.risks.manage',name:'سجل المخاطر',group:'القيادة'},
  {key:'governance.decisions.record',name:'سجل القرارات والالتزامات',group:'القيادة'},
  {key:'privacy.manage',name:'سجلات حماية البيانات الشخصية وطلبات أصحابها',group:'القيادة',sensitive:true},
  // سلسلة استلام المشروع (ترحيل 109): من يسلّم BD-04، ومن يقرر قراءة بوابة PM-01 وسياسة تصنيف التغيير.
  {key:'intake.handover',name:'تسليم المشاريع من تطوير الأعمال إلى التنفيذ (BD-04)',group:'التشغيل',roles:['manager','pm']},
  {key:'intake.policy.approve',name:'قراءة بوابة استلام المشروع واعتماد سياسة تصنيف التغيير',group:'التشغيل'},
  {key:'contracts.register.view',name:'سجل العقود والالتزامات التعاقدية',group:'التشغيل',roles:['manager','pm']},
  {key:'contracts.register.manage',name:'إدارة سجل العقود وتنبيهات التجديد',group:'التشغيل'},
  {key:'resourcing.view',name:'خطة الموارد والسعة',group:'التشغيل',roles:['manager','pm']},
  {key:'resourcing.plan',name:'حجز الموارد وتأكيدها',group:'التشغيل',roles:['manager','pm']},
  {key:'timesheets.approve',name:'اعتماد كشوف الوقت وقفلها',group:'التشغيل',roles:['manager','pm']},
  {key:'review.manage',name:'مسارات المراجعة الإبداعية وموافقة العميل',group:'التشغيل'},
  {key:'influencers.manage',name:'المؤثرون والحملات المدفوعة',group:'التشغيل'},
  {key:'production.manage',name:'الإنتاج والتصوير وأوراق الاستدعاء',group:'التشغيل'},
  {key:'pr.manage',name:'العلاقات العامة والتغطية الإعلامية',group:'التشغيل'},
  {key:'equipment.manage',name:'حجز المعدات والعهد',group:'التشغيل',roles:['manager','pm']},
  // النماذج الإلكترونية (ترحيل 107): التعبئة لكل موظف، وإعداد التعريفات وقبولها تصريحان منفصلان
  // حتى يبقى من أعدّ التعريف غير من يقبله.
  {key:'forms.fill',name:'تعبئة النماذج الإلكترونية وتقديمها',group:'التشغيل',everyone:true},
  {key:'forms.design',name:'إعداد تعريفات النماذج الإلكترونية',group:'التشغيل',roles:['manager','pm']},
  {key:'forms.accept',name:'قبول تعريفات النماذج الإلكترونية (مالك النموذج)',group:'التشغيل'},
  // فهرس نماذج المصدر يجعل EPMO معتمدًا ثالثًا في نماذج البند 02 (استلام المشروع، بدء المشروع، طلب التعديل).
  {key:'epmo.review',name:'اعتماد مكتب إدارة المشاريع المؤسسي (EPMO)',group:'التشغيل'},
  {key:'hr.benefits.manage',name:'التأمين الطبي ومزايا الموظفين',group:'خدمات الموظف',roles:['hr'],sensitive:true},
  // «مزاياي»: الخطوة المالية في طلب المزايا (تذكرة، بدل تعليم، ترقية فئة). يؤكد المبلغ مقترحًا ولا يصرف شيئًا.
  {key:'benefits.finance.confirm',name:'التأكيد المالي لمطالبات المزايا',group:'المالية',sensitive:true},
  {key:'einvoice.manage',name:'إعداد الفوترة الإلكترونية وأرشيفها',group:'المالية',sensitive:true},
  {key:'knowledge.manage',name:'قاعدة المعرفة ودورة التحقق منها',group:'الأساس',roles:['manager','hr','pm']},
  {key:'access.review',name:'حملات مراجعة الصلاحيات الدورية',group:'إدارة المنصة',admin:true},
  {key:'ai.govern',name:'جرد مساعدي الذكاء الاصطناعي وتقييم مخاطرهم',group:'إدارة المنصة',admin:true},
  {key:'platform.flags',name:'أعلام الميزات',group:'إدارة المنصة',admin:true},
  // سجل التعريفات ومحرّر الصفحة (ترحيل 123). «تعديل هذه الصفحة» زر على شاشة عمل، فتصريحه ليس admin:true: تصاريح
  // إدارة المنصة تُمنح لحساب إداري فقط (grantAccess أدناه)، وحساب الإدارة مرفوض على شاشات العمل أصلًا. الإعداد والمعاينة
  // تصريح عادي يلزم معه تصريح عمل الكيان نفسه؛ والنشر تصريح حساس: لا يفتحه امتياز الأدمن الأول وحده، ويلزمه التحقق بخطوتين حين يُفرض.
  {key:'definitions.configure',name:'تعديل تعريف الصفحات: الحقول والعناوين والأعمدة (مسودة ومعاينة)',group:'إدارة المنصة'},
  {key:'definitions.publish',name:'نشر تعريفات الصفحات واسترجاعها واستيرادها',group:'إدارة المنصة',sensitive:true},
  // «جرّب كمستخدم»: خفض تصاريح بهوية صاحبها وقراءة فقط، لا انتحال زميل (ترحيل 123، الجدول view_as_events).
  {key:'access.view_as',name:'جرّب كمستخدم — قراءة فقط بتصاريح مخفَّضة',group:'إدارة المنصة',sensitive:true},
  {key:'executive.view',name:'اللوحة التنفيذية',group:'القيادة'},
  // سجل النطاق وأبحاث تطوير الخدمات صفحات تطوير داخلية (B12): لا تُمنح لكل موظف افتراضيًا. الأدمن الأول يملكها، ومن سواه بمنح صريح.
  {key:'requirements.view',name:'نطاق المنصة وأبحاث تطوير الخدمات',group:'القيادة'},
  {key:'integrations.view',name:'حالة التكاملات',group:'القيادة',roles:['manager','pm']},
  // أدمن الإدارة (ترحيل 130، قرار المالك 20 سبتمبر): يضبط مستوى أعضاء إدارته وحدها. ليس admin:true عمدًا —
  // أدمن الإدارة موظف في إدارته لا مسؤول منصة، وتصاريح إدارة المنصة تُمنح لحساب إداري وحده (grantAccess أدناه).
  // وهو **التصريح الوحيد في المنصة الذي يحصره الكود فعلًا بإدارة**: app/department-levels.mjs يقارن إدارة الحساب
  // المستهدَف بإدارة الفاعل ويرفض ما خرج عنها. بقية ما يحمل scoped:true يقبل نطاق إدارة عند المنح ولا يُصفّي به صفًّا بعد.
  {key:'department.levels.manage',name:'ضبط مستويات صلاحية أعضاء إدارتي',group:'إدارة المنصة',scoped:true},
  {key:'accounts.manage',name:'الموظفون والصلاحيات',group:'إدارة المنصة',admin:true},
  {key:'structure.manage',name:'الإدارات والهيكل والتصعيد',group:'إدارة المنصة',admin:true},
  {key:'catalog.manage',name:'إعداد الخدمات',group:'إدارة المنصة',admin:true},
  {key:'access.manage',name:'منح التصاريح وسحبها',group:'إدارة المنصة',super:true}
];
const byKey=new Map(CAPABILITIES.map(c=>[c.key,c]));
export const grantable=CAPABILITIES.filter(c=>!c.everyone&&!c.super);
const id=()=>randomUUID();

// أزواج لا يحملها الشخص نفسه. المصفوفة تجمع عدة مفاتيح في حفظ واحد، لذلك يلزم فحص المجموعة
// قبل كتابة أول صف؛ grantAccess يفحص المفتاح الواحد ولا يستطيع رؤية ما سيأتي بعده في الحزمة.
const ACCESS_CONFLICTS=[
  ['hr.policy.prepare','hr.policy.accept'],
  ['hr.contracts.manage','hr.contracts.approve'],
  ['hr.attendance.manage','hr.attendance.approve'],
  ['hr.performance.manage','hr.performance.calibrate'],
  ['hr.letters.prepare','hr.letters.issue'],
  ['hr.discipline.propose','hr.discipline.decide'],
  ['payroll.prepare','payroll.review'],
  ['payroll.prepare','payroll.approve'],
  ['payroll.review','payroll.approve'],
  ['bank.reconcile','bank.reconcile.approve'],
  ['tax.returns.prepare','tax.returns.review'],
  ['forms.design','forms.accept']
];
const controlledDecision=key=>/(?:\.approve|\.accept|\.verify|\.issue|\.decide|\.publish|\.reopen|\.waive)$/.test(key);
const compatibleWith=(target,capability)=>target.role==='admin'?!!capability.admin:!capability.admin;
function conflictsIn(keys){
  return ACCESS_CONFLICTS.filter(pair=>pair.every(key=>keys.has(key)));
}
export const capabilityDefinition=key=>byKey.get(key)??null;
export const capabilityConflicts=keys=>conflictsIn(new Set(keys));

/* ═════ صنف النطاق: ما الذي يحصره الكود اليوم، لا ما نتمناه (ترحيل 130) ═════
   ثلاثة أصناف تقسم المئة قسمةً تامة، ومصدرها مسحٌ عُدَّ فيه كل مفتاح على مواضع حراسته وما تحرسه:
     department (٧) — grantAccess يقبل له نطاق إدارة. منها **واحد** يحصره الكود فعلًا اليوم
                      (department.levels.manage)، والستة الباقية تقبل النطاق ولا يُصفّي به شيء بعد.
     personal   (٧) — مجموعة صفوفه شخصٌ واحد أصلًا، فحصره بإدارة لا معنى له.
     company    (٨٧) — لا يحصره الكود بإدارة اليوم. منه ما هو شركة بطبعه (مسير واحد، إقرار واحد،
                      سلسلة تدقيق واحدة، إدارة منصة)، ومنه ما يمكن حصره ولم يُحصر — وهذا الأخير
                      موسومٌ بمرحلته أدناه حتى لا تقول الشاشة «عام» وكأنه قرار وهو تأجيل.
   القاعدة التي تحرسها المصفوفة: لا تُعرض على المالك إمكانية حصر ما لا يحصره الكود. */
const PERSONAL_SCOPE=new Set(['portal.use','requests.use','org.view','leave.use','delegations.use','search.use','forms.fill']);
// المرحلة (ب) — حصرٌ بتعديل الحارس وحده: صف الموضوع يحمل إدارته أصلًا (users.department_id غير قابل للعدم،
// وسجلات الحوكمة وأبواب المشروع تحمل department_id). لا ترحيل ولا قرار ردم.
const STAGE_B_GUARD=new Set(['people.manage','employees.view','hr.contracts.manage','hr.contracts.approve','hr.attendance.manage','hr.attendance.approve',
  'hr.performance.manage','hr.performance.calibrate','hr.succession.manage','hr.letters.prepare','hr.letters.issue','hr.discipline.propose','hr.discipline.decide',
  'hr.feedback.manage','hr.cases.handle','hr.compensation.review',
  'governance.objectives.manage','governance.risks.manage','governance.decisions.record','projects.readiness.waive','projects.closure.reopen','projects.closure.same_person','contracts.register.manage']);
// المرحلة (ب) — حصرٌ يلزمه عمود جديد في سجل عام وقرارُ ردم لصفوفه القائمة: المورد الواحد يخدم كل الإدارات،
// فالسؤال ليس «كيف نحصره» بل «هل يُحصر أصلًا» — وهو قرار مالك لا قرار مبرمج.
const STAGE_B_SCHEMA=new Set(['vendors.view','vendors.assess','vendors.manage','vendors.legal','vendors.bank','clients.manage','offerings.manage','approvals.record',
  'approvals.verify','intake.handover','intake.policy.approve','contracts.register.view','resourcing.view','resourcing.plan','timesheets.approve','review.manage',
  'influencers.manage','production.manage','pr.manage','equipment.manage','forms.design','forms.accept','epmo.review','knowledge.manage']);
// الحصر المطبَّق فعلًا في الشيفرة اليوم. الرقم يُعرض على الشاشة كما هو، ولا يُقرَّب إلى ما يسرّ.
export const CONFINED_IN_CODE=Object.freeze(['department.levels.manage']);
export function scopeClass(key){
  const c=byKey.get(key);
  if(!c)return null;
  if(PERSONAL_SCOPE.has(key))return 'personal';
  if(c.scoped)return 'department';
  return 'company';
}
export const scopeStage=key=>STAGE_B_GUARD.has(key)?'guard':STAGE_B_SCHEMA.has(key)?'schema':null;
export const scopeSummary=()=>{
  const counts={department:0,personal:0,company:0};
  for(const c of CAPABILITIES)counts[scopeClass(c.key)]++;
  return {...counts,total:CAPABILITIES.length,confined_in_code:CONFINED_IN_CODE.length,
    stage_b_guard:STAGE_B_GUARD.size,stage_b_schema:STAGE_B_SCHEMA.size};
};

/* ═════ مستويات الإدارة (ترحيل 130) ═════
   المستوى يضيف ولا يسحب: التصريح الفعلي = افتراضات الدور ∪ ما يحمله المستوى ∪ المنح الفردية.
   والقراءة كلها خلف مفتاح مطفأ، فما دام enabled=0 لا يُقرأ جدول واحد من جداول الترحيل 130 في
   مسار القرار، والجواب هو جواب اليوم حرفًا بحرف. هذا ما يجعل المقارنة الظلية ممكنة أصلًا:
   الدالة نفسها تُستدعى بالمفتاح مطفأً ومشتعلًا فتُقارن إجابتاها (scripts/permission-shadow.mjs). */
export const LEVELS=Object.freeze([
  {key:'department_manager',name:'مدير الإدارة'},{key:'employee',name:'موظف'},{key:'department_admin',name:'أدمن الإدارة'}
]);
export const levelName=key=>LEVELS.find(l=>l.key===key)?.name??key;
// قاعدة لم تبلغ الترحيل 130 بعد لا مستويات فيها، فجوابها هو الجواب القديم — وهذا ما تريده تمامًا.
// (اختبارات الترقية تبني قواعد تقف عند ترحيل أقدم ثم تستدعي can، كما في tests/definitions-registry.test.mjs.)
// لا يُبتلع خطأ آخر: غياب الجدول وحده يُترجم «مطفأ»، وما سواه يُرفع كما هو.
export function levelsEnabled(db,tenantId){
  try{return !!db.prepare('SELECT enabled FROM permission_level_settings WHERE tenant_id=?').get(tenantId)?.enabled;}
  catch(error){
    if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='permission_level_settings'").get())throw error;
    return false;
  }
}
// مستوى حساب لم يُضبط له مستوى بعد: يُشتق من دوره كما اشتقه الترحيل 130 للحسابات القائمة، فالحساب الذي
// يُنشأ بعد الترحيل لا يقع خارج النموذج ولا يحتاج خطوةً يدوية تُنسى. حساب إدارة المنصة بلا مستوى إدارة:
// مستوى الإدارة منزل موظفي الإدارات، وامتياز الأدمن الأول شيء آخر (isSuperAdmin أعلاه).
export const derivedLevel=u=>u.role==='admin'?null:u.role==='manager'?'department_manager':'employee';
export const assignedLevel=(db,u)=>db.prepare('SELECT level FROM user_permission_levels WHERE tenant_id=? AND user_id=?').get(u.tenant_id,u.id)?.level??null;
// مستوى الحساب. **دور الحساب يسبق الصف المخزَّن**: حساب إدارة المنصة بلا مستوى إدارة مهما قال الجدول،
// فصفٌّ بقي من دورٍ سابق (أو زُرع بخطأ) لا يمنح حسابًا إداريًا تصاريح مستوى موظفين. والدور نفسه يُعاد اشتقاق
// الصف منه عند كل تغيير دور (app/admin.mjs updateAccount)، فلا يعيش المستوى بعد الدور الذي اشتُق منه.
export const userLevel=(db,u)=>u.role==='admin'?null:(assignedLevel(db,u)??derivedLevel(u));
// ما يحمله مستوى بعينه في إدارة بعينها، مستقلًا عن شخص: قالب الشركة، ثم استثناء تلك الإدارة (add يضيف،
// remove يحجب، follow لا يفعل شيئًا)، ثم المرشِّح. تُقرأ من موضعين: قراءة تصاريح شخص (levelCapabilities
// أدناه)، وحسابُ ما سيكسبه شخص **قبل** إسناده إلى مستوى (app/department-levels.mjs setUserLevel).
// التصفية عند القراءة لا عند الكتابة وحدها: مفتاح لم يعد معرَّفًا، أو تصريح «الجميع»، أو تصريح الأدمن الأول،
// أو **تصريح حساس** (الحساس يُمنح لشخص بعينه بمنح مسجَّل ينبّه ويُراجَع ويُسحب — والمستوى لا يفعل شيئًا من
// ذلك، فلا طريق له عبره)، أو تصريح إدارة منصة في حساب غير إداري — كلها تسقط هنا، فصفٌّ قديم في القالب
// أو صفٌّ زُرع في الجدول مباشرةً لا يفتح بابًا لم يُقصد.
export function capabilitiesOfLevel(db,tenantId,level,departmentId,role){
  const keys=new Set(db.prepare('SELECT capability FROM permission_level_template WHERE tenant_id=? AND level=?').all(tenantId,level).map(r=>r.capability));
  for(const row of db.prepare('SELECT capability,mode FROM permission_level_exceptions WHERE tenant_id=? AND department_id=? AND level=?').all(tenantId,departmentId,level)){
    if(row.mode==='add')keys.add(row.capability);
    else if(row.mode==='remove')keys.delete(row.capability);
  }
  for(const key of [...keys]){
    const c=byKey.get(key);
    if(!c||c.everyone||c.super||c.sensitive||(c.admin&&role!=='admin'))keys.delete(key);
  }
  return keys;
}
export function levelCapabilities(db,supplied,{levels=null}={}){
  const u=supplied;
  if(viewingAs(u))return new Set();
  const on=levels??levelsEnabled(db,u.tenant_id);
  if(!on)return new Set();
  const level=userLevel(db,u);
  if(!level)return new Set();
  return capabilitiesOfLevel(db,u.tenant_id,level,u.department_id,u.role);
}
function actor(db,u){const current=currentUser(db,u);if(!current)fail(403,'forbidden','ما لقينا حسابك، ولا هو موقوف — كلّم مسؤول المنصة');return current;}
// «جرّب كمستخدم» (app/view-as.mjs): أثناء التجربة تُحسب تصاريح صاحبها «افتراضات الدور المختار ∩ ما يحمله هو»، وتسقط منحه،
// ولا يبقى له امتياز الأدمن الأول. يقع الخفض هنا في الدوال الثلاث التي تبني عليها can وholds وcapabilitiesFor، فيسري في كل
// مكان دفعة واحدة، وعلى صاحب التجربة وحده (capabilityHolders تمشي كل الحسابات في الطلب نفسه).
export const isSuperAdmin=u=>u.role==='admin'&&u.admin_level==='super'&&!viewingAs(u);

function liveGrants(db,u){
  if(viewingAs(u))return [];
  return db.prepare('SELECT capability,department_id FROM access_grants WHERE tenant_id=? AND user_id=? AND revoked_at IS NULL').all(u.tenant_id,u.id);
}
// ما يملكه الحساب افتراضيًا بحكم دوره، قبل أي منح إضافي.
export function defaultCapabilities(u){
  const reduced=viewingAs(u);
  if(reduced)return new Set(reduced.capabilities);
  const keys=new Set();
  for(const c of CAPABILITIES){
    if(c.everyone&&u.role!=='admin')keys.add(c.key);
    if(c.roles?.includes(u.role))keys.add(c.key);
    // مدير رأس المال البشري يرث باب إدارة صلاحيات فريقه فقط. تنفيذ خدمات الموظفين أو قرارات
    // اعتمادها يحتاج منحًا مستقلًا، حتى لا يجمع المدير الإعداد والقرار لمجرد مسماه.
    if(u.role==='manager'&&u.department_id==='hr'&&c.key==='hr.permissions.delegate')keys.add(c.key);
  }
  if(u.role==='admin')keys.add('portal.use');
  return keys;
}
export function capabilitiesFor(db,supplied,{levels=null}={}){
  const u=currentUser(db,supplied)??supplied;
  if(isSuperAdmin(u)){const granted=new Set(liveGrants(db,u).map(g=>g.capability));return {list:CAPABILITIES.filter(c=>!c.sensitive||granted.has(c.key)).map(c=>c.key),scopes:{},super:true};}
  const keys=defaultCapabilities(u),scopes={};
  for(const key of [...keys])if(!mfaSatisfied(db,u,key))keys.delete(key);
  const unrestricted=new Set(keys);
  for(const grant of liveGrants(db,u)){
    if(!byKey.has(grant.capability)||!mfaSatisfied(db,u,grant.capability))continue;
    keys.add(grant.capability);
    if(grant.department_id)(scopes[grant.capability]??=[]).push(grant.department_id);
    else unrestricted.add(grant.capability);
  }
  // ما يصل بالمستوى (ترحيل 130). التصريح الذي يقبل نطاق إدارة يصل بالمستوى **محصورًا بإدارة صاحبه**:
  // المستوى مستوىً في إدارة، فلا يمد حامله إلى إدارة أخرى. ويُسقط عليه إلزام التحقق بخطوتين كما يُسقط على المنح.
  // ولا يُكتب نطاق لتصريح يحمله صاحبه بلا قيد أصلًا (بدوره أو بمنح عام): نطاقٌ مكتوب فوق حقٍّ عام يضيّق ما لا يضيقه الكود.
  for(const key of levelCapabilities(db,u,{levels})){
    if(!mfaSatisfied(db,u,key))continue;
    keys.add(key);
    if(byKey.get(key)?.scoped&&u.department_id&&!unrestricted.has(key)&&!(scopes[key]??[]).includes(u.department_id))(scopes[key]??=[]).push(u.department_id);
  }
  return {list:[...keys],scopes,super:false};
}
// هل يصل ما يحمله هذا الشخص من هذا التصريح إلى هذه الإدارة بعينها؟
// قاعدة الحصر مكتوبة هنا مرة واحدة، وتستعملها can() (ومعها امتياز الأدمن الأول) وholdsIn() (بدونه).
// كانت مكتوبة داخل can() وحدها، فكل من احتاجها بلا امتياز الأدمن لم يجد إلا holds() التي لا ترى
// الإدارة — وهذا بالضبط ما أفلت الحصر في محرك النماذج. وتفرّع القاعدة تحت اسمين هو الخطأ الذي وقع
// من قبل في تعريف isPeopleOfficer، فلا يُعاد.
//
// الترتيب: بلا إدارة مطلوبة لا محلّ للسؤال؛ ثم ما يصل بالدور يصل بلا نطاق؛ ثم منحٌ عام أو منحٌ
// لهذه الإدارة؛ وأخيرًا ما يصل بالمستوى (ترحيل 130) يصل محصورًا بإدارة صاحبه حين يقبل التصريح الحصر.
function reachesDepartment(db,u,capability,departmentId,{levels=null}={}){
  if(!departmentId)return true;
  if(defaultCapabilities(u).has(capability))return true;
  if(liveGrants(db,u).some(g=>g.capability===capability&&(!g.department_id||g.department_id===departmentId)))return true;
  return levelCapabilities(db,u,{levels}).has(capability)&&(!byKey.get(capability)?.scoped||u.department_id===departmentId);
}
export function can(db,supplied,capability,departmentId=null,{levels=null}={}){
  const u=currentUser(db,supplied);
  if(!u)return false;
  // التصريح الحساس لا يُفتح بامتياز الأدمن الأول وحده، ولا يعمل بلا تحقق بخطوتين حين يكون مفروضًا —
  // القاعدة نفسها التي تطبقها capabilitiesFor وholds، حتى لا تختلف الشاشة عن الدالة.
  const sensitive=!!byKey.get(capability)?.sensitive;
  if(isSuperAdmin(u)&&!sensitive)return true;
  if(!mfaSatisfied(db,u,capability))return false;
  if(defaultCapabilities(u).has(capability))return true;
  const grants=liveGrants(db,u).filter(g=>g.capability===capability);
  // ترحيل 130: ما يصل بالمستوى يصل محصورًا بإدارة صاحبه حين يكون التصريح مما يقبل الحصر.
  // بالمفتاح مطفأً byLevel=false دائمًا، فالسطران أدناه يعودان حرفيًا إلى ما كانا عليه.
  const byLevel=levelCapabilities(db,u,{levels}).has(capability);
  if(!grants.length&&!byLevel)return false;
  return reachesDepartment(db,u,capability,departmentId,{levels});
}
// تصريح حساس: امتياز الأدمن الأول لا يكفي وحده؛ يلزم منح صريح مسجل.
// عند تفعيل إلزام التحقق بخطوتين: التصريح الحساس لا يعمل لحساب لم يفعّل التحقق، مهما كان دوره أو منحه.
export function mfaSatisfied(db,u,capability){
  if(!byKey.get(capability)?.sensitive)return true;
  if(!db.prepare('SELECT require_mfa_for_sensitive AS on_ FROM security_settings WHERE tenant_id=?').get(u.tenant_id)?.on_)return true;
  return !!db.prepare('SELECT 1 FROM user_totp WHERE user_id=? AND enabled_at IS NOT NULL').get(u.id);
}
// holds تتجاهل امتياز الأدمن الأول والإدارة عمدًا: سؤالها «هل يحمله هذا الشخص بعينه» (فصل المهام، وقوائم الحاملين).
// المستوى جزء مما يحمله الشخص، فلولا إضافته هنا لاختلفت قوائم «من يستطيع» عن الشاشات التي تفتحها can.
// من يعمل على السجل الوظيفي: الدور hr، أو من مُنح «السجل الوظيفي» (employees.view) صراحةً.
//
// كان هذا التعريف مكتوبًا مرتين بقاعدتين مختلفتين تحت الاسم نفسه: app/my-profile.mjs يقبل التصريح،
// وapp/employees.mjs يقبل الدور وحده. فالنتيجة المقيسة على قاعدة التشغيل أن مدير رأس المال البشري —
// دوره manager — **يقرأ** ملفات الموظفين ولا **يحرّرها**، والحساب الوحيد الذي يحرّرها حساب مبذور.
// موضعه هنا لأن التصريح يُعرَّف هنا، فلا يتفرّع التعريف مرة أخرى.
//
// والتصريح ليس واسعًا: حسّاس، يُمنح صراحةً بقرار، ومحروس في STAGE_B_GUARD. ومن يملكه يقرأ سجل كل
// موظف أصلًا، وهو أوسع مما يفتحه له هنا من تحرير.
export const isPeopleOfficer=(db,u)=>u?.role==='hr'||holds(db,u,'employees.view');

export function holds(db,supplied,capability,{levels=null}={}){
  const u=currentUser(db,supplied);
  if(!u)return false;
  return (defaultCapabilities(u).has(capability)||liveGrants(db,u).some(g=>g.capability===capability)||levelCapabilities(db,u,{levels}).has(capability))&&mfaSatisfied(db,u,capability);
}
// holds مضافًا إليها الإدارة: «هل يحمله هذا الشخص بعينه، ويصل ما يحمله إلى هذه الإدارة؟»
// لا يفتحها امتياز الأدمن الأول، لأن سؤالها سؤال holds نفسه: فصل المهام وقرارات سلسلة الاعتماد.
// يُمرَّر departmentId=null حيث لا إدارة للسؤال، فتعود holdsIn إلى holds حرفيًا.
export function holdsIn(db,supplied,capability,departmentId=null,{levels=null}={}){
  if(!holds(db,supplied,capability,{levels}))return false;
  return reachesDepartment(db,currentUser(db,supplied),capability,departmentId,{levels});
}
// D-07 (تدقيق مسارات الوحدات، 20 سبتمبر): مسار العمل الإضافي بتكليف مسبق يحتاج تصريحين، أحدهما (hr.attendance.approve)
// بلا دور افتراضي، فلا يحمله أحد في التهيئة الأولى. الرفض كان «الإجراء غير متاح» ولا يسمّي التصريح ولا حامله ولا مانحه.
// هذه الدالة مصدر واحد لذلك البيان، تستعمله أي وحدة تقف على تصريح.
export const capabilityName=key=>byKey.get(key)?.name??key;
export function capabilityHolders(db,tenantId,capability){
  return db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(tenantId)
    .filter(p=>holds(db,p,capability)).map(p=>({id:p.id,name:p.name,role:p.role}));
}
export function capabilityGap(db,tenantId,capability,{exclude=[]}={}){
  const definition=byKey.get(capability)??null;
  const all=capabilityHolders(db,tenantId,capability),eligible=all.filter(p=>!exclude.includes(p.id));
  const roles=definition?.roles??null;
  const granter=definition?.super?'لا يُمنح هذا التصريح من الشاشة'
    :'يمنحه الأدمن الأول من «الموظفون والصلاحيات» (تصريح access.manage)'+(definition?.sensitive?'، وهو تصريح حساس لا يكفي فيه امتياز الأدمن وحده بل يلزم منح صريح مسجَّل':'');
  const roleNote=roles?.length?`يحمله افتراضيًا دور: ${roles.join('، ')}`:'لا دور يحمله افتراضيًا في المنصة: لا يُحمل إلا بمنح صريح';
  const text=all.length===0
    ?`لا حساب يحمل تصريح «${capabilityName(capability)}» (${capability}). ${roleNote}. ${granter}.`
    :eligible.length===0
      ?`يحمل تصريح «${capabilityName(capability)}» (${capability}) ${all.map(p=>p.name).join('، ')} فقط، ولا أحد منهم يجوز له هذه الخطوة هنا (فصل المهام). ${granter} لحساب آخر.`
      :`يحمل تصريح «${capabilityName(capability)}» (${capability}): ${eligible.map(p=>p.name).join('، ')}.`;
  return {capability,capability_name:capabilityName(capability),default_roles:roles??[],sensitive:!!definition?.sensitive,
    holders:all.map(p=>p.name),eligible:eligible.map(p=>p.name),satisfied:eligible.length>0,granted_by:granter,text};
}
export function require(db,supplied,capability,departmentId=null){
  if(!can(db,supplied,capability,departmentId))fail(403,'not_permitted','ما فيه تصريح يفتح لك هذي الشاشة — اطلبه من مسؤول الصلاحيات');
  return true;
}

export function accessDirectory(db,supplied){
  const u=actor(db,supplied);
  if(!isSuperAdmin(u))require(db,u,'accounts.manage');
  const users=db.prepare('SELECT id,name,username,role,department_id,active,admin_level FROM users WHERE tenant_id=? ORDER BY active DESC,name').all(u.tenant_id);
  const grants=db.prepare('SELECT g.*,x.name AS granted_by_name FROM access_grants g JOIN users x ON x.id=g.granted_by WHERE g.tenant_id=? AND g.revoked_at IS NULL ORDER BY g.granted_at DESC').all(u.tenant_id);
  return {
    capabilities:grantable.map(c=>({key:c.key,name:c.name,group:c.group,scoped:!!c.scoped,sensitive:!!c.sensitive,admin:!!c.admin,controlled:controlledDecision(c.key)})),
    admin_levels:[{key:'super',name:'أدمن أول — كامل الصلاحيات'},{key:'scoped',name:'أدمن محدد — بحسب التصاريح الممنوحة'}],
    users:users.map(row=>({
      ...row,active:!!row.active,
      defaults:[...defaultCapabilities(row)],
      grants:grants.filter(g=>g.user_id===row.id).map(g=>({id:g.id,capability:g.capability,name:byKey.get(g.capability)?.name??g.capability,department_id:g.department_id,granted_by:g.granted_by_name,granted_at:g.granted_at}))
    })),
    can_manage_access:isSuperAdmin(u),actor_id:u.id
  };
}
export function applyAccessMatrix(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','حفظ المصفوفة لازم ينفّذ داخل معاملة');
  const u=actor(db,supplied);
  if(!isSuperAdmin(u))fail(403,'forbidden','مصفوفة الصلاحيات للأدمن الأول وبس');
  v.object(input,['user_id','mode','capability_keys','department_id','note']);
  const target=personAssignment(db,u.tenant_id,input.user_id);
  if(target&&!target.active)refuse(409,'account_inactive',{what:`حساب «${target.name}» موقوف، فما تنحفظ له مصفوفة صلاحيات جديدة`,next:'فعّل الحساب أولًا من شاشة الموظفين والصلاحيات، ثم أعد فتح المصفوفة'});
  if(!target)fail(404,'not_found','ما لقينا الحساب هذا، أو هو موقوف');
  if(target.id===u.id)fail(409,'separation_of_duties','ما تقدر توسّع صلاحياتك بنفسك — يلزم أدمن أول ثاني');
  if(!['comprehensive','custom'].includes(input.mode))refuse(400,'mode',{what:'طريقة منح الصلاحيات غير محددة في المصفوفة',next:'اختر «شامل» للحزمة العامة الآمنة أو «مخصص» لاختيار الصلاحيات بنفسك'});
  if(!Array.isArray(input.capability_keys)||input.capability_keys.some(key=>typeof key!=='string')||new Set(input.capability_keys).size!==input.capability_keys.length)
    fail(400,'capability_keys','اختيارات الصلاحيات مو صحيحة');
  const note=v.text(input.note??'','سبب المنح',500,3);
  const explicit=liveGrants(db,target),held=new Set([...defaultCapabilities(target),...explicit.map(row=>row.capability)]);
  const excluded={sensitive:0,scoped:0,controlled:0,incompatible:0,conflicting:0,already_held:0};
  let selected=[];
  if(input.mode==='comprehensive'){
    for(const capability of grantable){
      if(!compatibleWith(target,capability)){excluded.incompatible++;continue;}
      if(capability.sensitive){excluded.sensitive++;continue;}
      if(capability.scoped){excluded.scoped++;continue;}
      if(controlledDecision(capability.key)){excluded.controlled++;continue;}
      if(held.has(capability.key)){excluded.already_held++;continue;}
      const next=new Set([...held,...selected.map(row=>row.key),capability.key]);
      if(conflictsIn(next).length){excluded.conflicting++;continue;}
      selected.push(capability);
    }
  }else{
    if(!input.capability_keys.length)fail(400,'capability_keys','اختر صلاحية واحدة على الأقل في الوضع المخصص');
    selected=input.capability_keys.map(key=>{
      const capability=byKey.get(key);
      if(!capability||capability.everyone||capability.super)fail(400,'capability','في المصفوفة تصريح غير قابل للمنح');
      if(!compatibleWith(target,capability))fail(400,'capability_incompatible','في المصفوفة تصريح ما يناسب نوع الحساب');
      return capability;
    });
    const combined=new Set([...held,...selected.map(row=>row.key)]),conflicts=conflictsIn(combined);
    if(conflicts.length)throw Object.assign(new AppError(409,'separation_of_duties','المصفوفة تجمع صلاحيات إعداد واعتماد لازم تكون مع أشخاص مختلفين'),
      {details:{conflicts,conflict_names:conflicts.map(pair=>pair.map(capabilityName))}});
  }
  const needsDepartment=selected.some(capability=>capability.scoped);
  if(needsDepartment&&!input.department_id)fail(400,'department_required','اختر الإدارة للصلاحيات المحصورة');
  const department=input.department_id?db.prepare('SELECT id FROM departments WHERE id=? AND tenant_id=? AND active=1').get(input.department_id,u.tenant_id):null;
  if(input.department_id&&!department)fail(400,'department','ما لقينا الإدارة، أو هي مؤرشفة');
  const granted=[],skipped=[];
  for(const capability of selected){
    const departmentId=capability.scoped?department?.id??null:null;
    const exists=explicit.some(row=>row.capability===capability.key&&(row.department_id??null)===departmentId)||defaultCapabilities(target).has(capability.key);
    if(exists){skipped.push(capability.key);continue;}
    grantAccess(db,u,{user_id:target.id,capability:capability.key,department_id:departmentId,note});
    explicit.push({capability:capability.key,department_id:departmentId});
    held.add(capability.key);granted.push(capability.key);
  }
  audit(db,u,'access',target.id,'access.matrix_applied',{}, {mode:input.mode,granted,skipped,excluded,department_id:department?.id??null});
  return {user_id:target.id,mode:input.mode,granted,skipped,excluded};
}
export function grantAccess(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','المنح لازم ينفّذ داخل معاملة');
  const u=actor(db,supplied);
  if(!isSuperAdmin(u))fail(403,'forbidden','منح التصاريح للأدمن الأول وبس');
  v.object(input,['user_id','capability','department_id','note']);
  const target=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1').get(input.user_id,u.tenant_id);
  if(!target)fail(404,'not_found','ما لقينا حسابك، ولا هو موقوف — كلّم مسؤول المنصة');
  const capability=byKey.get(input.capability);
  if(!capability||capability.everyone||capability.super)fail(400,'capability','التصريح هذا ما ينمنح');
  // المنح بيدين (الترحيل 144): ولا أحد يمنح نفسه — ولا الأدمن الأول. التصريح الحساس ما يفتحه امتياز
  // الأدمن الأول لحاله، لازمه منح مسجَّل (capabilitiesFor وcan وholds)؛ فلو منح نفسه المنحَ راح معنى
  // الشرط كله. القاعدة نفسها في finance_grants (CHECK(user_id<>granted_by)، الترحيل 007) وفي مراجعة
  // الصلاحيات («لا تراجع تصاريحك بنفسك»، app/access-reviews.mjs). القيد في القاعدة هو الضمان،
  // وهذا السطر هو اللي يقراه الإنسان: يقول الناقص ومين يملكه وش الخطوة.
  if(target.id===u.id)refuse(409,'separation_of_duties',{
    what:`ما تمنح نفسك تصريح «${capability.name}»`,
    missing:[{document:`منح تصريح «${capability.name}» باسم أدمن أول ثاني`,
      why:'التصريح يمنحه غير صاحبه، عشان ما يوسّع أحد صلاحيته بنفسه',
      owner:'أدمن أول ثاني غيرك',owner_role:'admin'}],
    next:'عيّن أدمن أول ثاني من «الموظفون والصلاحيات»، وهو يمنحك التصريح باسمه'});
  if(input.department_id&&!capability.scoped)fail(400,'scope_not_supported','التصريح هذا عام، وما ينحصر بإدارة');
  // التصريح الذي **يحصره الكود** بإدارة لا يُمنح بلا إدارة: منحٌ بلا نطاق يرضي can() في كل إدارة
  // (السطر «if(!departmentId)return true» أدناه)، فيصير حامله أدمنًا على الكيان كله بينما الشاشة
  // واسم التصريح يقولان «إدارتي وحدها». الحصر المكتوب في CONFINED_IN_CODE يُفرض عند المنح أيضًا.
  if(!input.department_id&&CONFINED_IN_CODE.includes(capability.key))fail(400,'department_required','التصريح هذا محصور بإدارة وحدة، فما ينمنح بلا إدارة — اختر إدارة صاحبه من القائمة');
  if(capability.admin&&target.role!=='admin')fail(400,'capability','تصاريح إدارة المنصة تُمنح لحساب إداري وبس');
  if(defaultCapabilities(target).has(capability.key))fail(409,'already_default','التصريح هذا أصلًا متاح لهذا الدور');
  const department=input.department_id?db.prepare('SELECT id FROM departments WHERE id=? AND tenant_id=? AND active=1').get(input.department_id,u.tenant_id):null;
  if(input.department_id&&!department)fail(400,'department','ما لقينا الإدارة، ولا هي مؤرشفة');
  if(db.prepare('SELECT 1 FROM access_grants WHERE user_id=? AND capability=? AND coalesce(department_id,?)=? AND revoked_at IS NULL').get(target.id,capability.key,'*',department?.id??'*'))fail(409,'already_granted','التصريح هذا ممنوح أصلًا');
  const grantId=id();
  db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(grantId,u.tenant_id,target.id,capability.key,department?.id??null,input.note?v.text(input.note,'سبب المنح',500):'',u.id,now());
  audit(db,u,'access',target.id,'access.granted',{}, {capability:capability.key,department_id:department?.id??null});
  // تنبيه أمني: منح تصريح حساس، أو تصريح إدارة منصة (صلاحية إدارية جديدة).
  if(capability.sensitive)sensitiveGrantAlert(db,u,target.id,capability.name);
  else if(capability.admin)newAdminAlert(db,u,target.id,`تصريح «${capability.name}»`);
  return {id:grantId};
}
export function revokeAccess(db,supplied,grantId,input){
  if(!db.isTransaction)fail(500,'transaction_required','السحب لازم ينفّذ داخل معاملة');
  const u=actor(db,supplied);
  if(!isSuperAdmin(u))fail(403,'forbidden','سحب التصاريح للأدمن الأول وبس');
  v.object(input,['reason']);
  const grant=db.prepare('SELECT * FROM access_grants WHERE id=? AND tenant_id=? AND revoked_at IS NULL').get(grantId,u.tenant_id);
  if(!grant)fail(404,'not_found','ما لقينا التصريح هذا');
  db.prepare('UPDATE access_grants SET revoked_at=?,revoked_by=? WHERE id=?').run(now(),u.id,grantId);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(grant.user_id);
  audit(db,u,'access',grant.user_id,'access.revoked',{capability:grant.capability,department_id:grant.department_id},{revoked:true},input.reason?v.text(input.reason,'سبب السحب',500,3):'');
  return {revoked:true};
}
export function setAdminLevel(db,supplied,userId,input){
  if(!db.isTransaction)fail(500,'transaction_required','التغيير لازم ينفّذ داخل معاملة');
  const u=actor(db,supplied);
  if(!isSuperAdmin(u))fail(403,'forbidden','تغيير مستوى الإدارة للأدمن الأول وبس');
  v.object(input,['admin_level','reason']);
  const target=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(userId,u.tenant_id);
  if(!target)fail(404,'not_found','ما لقينا الحساب هذا');
  const level=input.admin_level===''?null:input.admin_level;
  if(level!==null&&!['scoped','super'].includes(level))fail(400,'admin_level','مستوى الإدارة هذا مو صحيح');
  if(level&&target.role!=='admin')fail(400,'role','المستوى الإداري ينمنح لحساب دوره مسؤول المنصة');
  if(target.id===u.id&&level!=='super')fail(409,'last_super','ما تسحب صلاحيتك الكاملة من نفسك — عيّن أدمن أول ثاني الأول');
  if(target.admin_level==='super'&&level!=='super'&&db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND admin_level='super' AND active=1").get(u.tenant_id).n<=1)
    fail(409,'last_super','لازم يبقى أدمن أول واحد على الأقل');
  db.prepare('UPDATE users SET admin_level=? WHERE id=?').run(level,target.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
  audit(db,u,'access',target.id,'access.admin_level',{admin_level:target.admin_level},{admin_level:level},input.reason?v.text(input.reason,'السبب',500,3):'');
  if(level&&level!==target.admin_level&&(target.admin_level===null||level==='super'))newAdminAlert(db,u,target.id,level==='super'?'أدمن أول — كامل الصلاحيات':'أدمن محدد');
  return {id:target.id,admin_level:level};
}
