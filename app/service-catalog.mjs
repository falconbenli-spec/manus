import { randomUUID } from 'node:crypto';
import { transaction, audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { can } from './access.mjs';
import { currentUser } from './delegations.mjs';
// خدمات الكتالوج ذات الشاشة المخصصة (مثل «طلب إجازة» HR-LEAVE): تُعرض وتُبحث في الدليل وتفتح شاشتها، ولا تُثبَّت خدمةَ طلب عام.
export { MODULE_SERVICES } from './static/module-services.mjs';
import { createService, setServiceSection, setServiceTarget, catalog, normalizeStep, thresholdFor, executiveFor, escalationApprover, escalationLadder, approvalFallback, executorsFor, canApproveThresholds, deputiesFor, deputyEligibleDepartments } from './workflow.mjs';
import { refuse } from './refusal.mjs';
import { returnDepartedWork } from './request-assignment.mjs';
// زمن الخدمة لا يُعرض عاريًا: من أين جاء ومن تبنّاه في app/service-target.mjs، ومنه وحده تُؤخذ العبارة.
import { targetProvenance } from './service-target.mjs';
import * as v from './validation.mjs';
import { routeReadiness } from './module-routes.mjs';
import { listLeave } from './leave.mjs';
// مفتاح تفعيل الخدمة (ترحيل 129): اللوح يُركَّب داخل شاشة «إعداد الاعتماد»، والفحص يعلّم ما أُوقف منها.
import { availabilityBoard, hiddenServiceCodes, isHidden, refuseHidden, stopNote } from './service-availability.mjs';
// شروط أهلية الخدمة (ترحيل 138): اللوح يُركَّب داخل شاشة «إعداد الاعتماد» بجوار لوح المفاتيح.
import { gatesBoard } from './service-gates.mjs';
// شجرة الفئات (ترحيل 131): بياناتها وإسقاطها وقائمة إعادات التسمية. الاستيراد دوريّ بين الوحدتين كما هو
// بين هذه الوحدة وworkflow، ولا يُقرأ شيء منه وقت التحميل بل داخل المثبّت وحده.
import { projectCatalog, CATALOG_RENAMES } from './catalog-tree.mjs';
import { LETTER_BANKS, LETTER_EMBASSIES, LETTER_GOVERNMENTS } from './letter-directory.mjs';

// Company-wide request catalog. Department names are proposals pending the company's approved structure.
// كل مولّد حقل يقبل وسيطًا أخيرًا اختياريًا يحمل إرشاد الحقل:
//   why  — أي قرار يتوقف على هذا الحقل. أهمها: من يفهم لماذا يُسأل يجيب أدق.
//   hint — جملة قصيرة تحت الحقل تقول ما المتوقع كتابته.
//   example — مثال من عمل وكالة تسويق، لا نص عام.
//   min_length/max_length — حدود الطول حيث تفيد.
//   pattern/pattern_message — صيغة محددة ورسالة عربية تقول ما الصواب.
//   show_when — شرط ظهور الحقل من قيمة حقل آخر، يُفرض في validatePayload لا في الواجهة وحدها.
const with_=(base,extra)=>extra?{...base,...extra}:base;
const t=(key,label,required=true,extra)=>with_({key,label,type:'text',required},extra);
const long=(key,label,required=true,extra)=>with_({key,label,type:'textarea',required},extra);
const day=(key,label,required=true,extra)=>with_({key,label,type:'date',required},extra);
const num=(key,label,required=true,extra)=>with_({key,label,type:'number',required},extra);
const pick=(key,label,options,required=true,extra)=>with_({key,label,type:'select',options,required},extra);
const urgency=pick('urgency','الأولوية',['عاجل','عادي','غير عاجل'],true,{why:'العجلة تحدد ترتيب المعالجة بين البلاغات المفتوحة في اليوم نفسه.'});
// صيغة الشهر المستخدمة في المسير والتقارير المالية.
const MONTH={pattern:'^\\d{4}-(0[1-9]|1[0-2])$',pattern_message:'اكتب الشهر بأربعة أرقام للسنة ثم شرطة ثم رقمين للشهر، مثل 2026-03'};
export const FIELD_RULE_KEYS=v.FIELD_RULE_KEYS;
export const FIELD_GUIDANCE_KEYS=['hint','example','why',...FIELD_RULE_KEYS];
// ما يُعرض ولا يُفرض: يبقى في هذا الملف ويُدمج عند القراءة. وما يُفرض (FIELD_RULE_KEYS) يُخزَّن مع نسخة الخدمة.
export const FIELD_PRESENTATION_KEYS=FIELD_GUIDANCE_KEYS.filter(k=>!FIELD_RULE_KEYS.includes(k));
// مسح الكتالوج 20 سبتمبر (العطبان 2 و3): كانت النسخة المخزَّنة تُسقط شرط الظهور والصيغة وحدّ الطول،
// وتخزّن الحقل المشروط `required:false`، و`validatePayload` لا يقرأ إلا المخزَّن — فلم يُفرض شرط ولا صيغة قط.
// الآن تُخزَّن القاعدة كما كُتبت: الحقل المشروط مطلوب حين يتحقق شرطه، ومخفيّ لا يُطالَب به ولا تدخل قيمته السجل.
export const coreField=f=>({key:f.key,label:f.label,type:f.type,required:f.required,...(f.type==='select'?{options:f.options}:{}),
  ...Object.fromEntries(FIELD_RULE_KEYS.filter(k=>f[k]!==undefined).map(k=>[k,f[k]]))});
export const fieldModel=code=>catalogServices.find(s=>s.code===code)?.fields??null;
// الدمج لا يمس قاعدةً مخزَّنة: القاعدة المفروضة هي ما في نسخة الخدمة، والإرشاد وحده يُضاف فوقها.
export function enrichFields(code,fields){
  const model=fieldModel(code);
  if(!model||!Array.isArray(fields))return fields;
  return fields.map(field=>{
    const source=model.find(f=>f.key===field.key&&f.type===field.type);
    if(!source)return field;
    const extra=Object.fromEntries(FIELD_PRESENTATION_KEYS.filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
    return Object.keys(extra).length?{...field,...extra}:field;
  });
}
// الشكل الذي يصل نموذج الموظف: القاعدة المخزَّنة ومعها إرشادها (العطب 5 — كان الإرشاد حبيس لوحة المسؤول).
export const enrichCatalog=services=>services.map(s=>({...s,fields:enrichFields(s.code,s.fields)}));
const MANAGER_HEAD={steps:['manager','department_manager'],handler_role:'manager'};
const HEAD={steps:['department_manager'],handler_role:'manager'};

const GROWTH='قطاع النمو والقنوات',CORPORATE='قطاع الخدمات المؤسسية',EXEC='الرئاسة التنفيذية',PLATFORM='تشغيل المنصة';
// Approved company structure (org chart, 26 August 2026): CEO, two vice presidents and fourteen departments.
export const companyDepartments=[
  {id:'ceo-office',name:'مكتب الرئيس التنفيذي',sector:EXEC,head:'head-ceo-office',domains:['ADM','GOV']},
  {id:'brand',name:'إدارة العلامة التجارية',sector:EXEC,head:'head-brand',domains:['CRT']},
  {id:'pr',name:'إدارة العلاقات العامة والمؤثرين',sector:GROWTH,head:'head-pr',domains:['PR','INF']},
  {id:'marketing',name:'إدارة التسويق الرقمي',sector:GROWTH,head:'head-marketing',domains:['DIG']},
  {id:'accounts',name:'إدارة الحسابات',sector:GROWTH,head:'head-accounts',domains:['ACC']},
  {id:'production',name:'إدارة الإنتاج',sector:GROWTH,head:'head-production',domains:['PRO']},
  {id:'creative',name:'إدارة الخدمات الإبداعية',sector:GROWTH,head:null,domains:['CRT']},
  {id:'business-dev',name:'إدارة الأعمال',sector:GROWTH,head:'head-business-dev',domains:['CRM','STR']},
  {id:'comms',name:'التواصل الداخلي',sector:GROWTH,head:'head-comms',domains:['EXP']},
  {id:'it',name:'تقنية المعلومات',sector:CORPORATE,head:'head-it',domains:['IT']},
  {id:'grc',name:'الحوكمة والالتزام والمخاطر',sector:CORPORATE,head:'head-grc',domains:['LEG','GOV']},
  {id:'procurement',name:'المشتريات',sector:CORPORATE,head:'head-procurement',domains:['PRC']},
  {id:'finance',name:'المالية',sector:CORPORATE,head:'head-finance',domains:['FIN','PAY']},
  {id:'epmo',name:'الإدارة التنفيذية للمشاريع',sector:CORPORATE,head:'head-epmo',domains:['PMO','GOV']},
  {id:'campaigns-audit',name:'إدارة تدقيق الحملات',sector:CORPORATE,head:'head-campaigns-audit',domains:['DAT']},
  {id:'hr',name:'رأس المال البشري',sector:CORPORATE,head:'head-hr',domains:['HR','TAL','PAY']},
  {id:'ops',name:'تشغيل المنصة',sector:PLATFORM,head:null,domains:['PLT','NFR']}
];
// طبقة الرئاسة: الرئيس التنفيذي ونائباه. تُستخدم مرجعًا للتصعيد حين يكون الطلب من مدير الإدارة نفسه.
export const executiveLayer=[
  {id:'ceo',name:'الرئيس التنفيذي (تجريبي)',department_id:'ceo-office'},
  {id:'vp-growth',name:'نائب الرئيس للنمو والقنوات (تجريبي)',department_id:'ceo-office'},
  {id:'vp-corporate',name:'نائب الرئيس للخدمات المؤسسية (تجريبي)',department_id:'ceo-office'}
];
export const escalationFor=department=>department.sector===GROWTH?'vp-growth':department.sector===CORPORATE?'vp-corporate':'ceo';

// Units proposed before the approved chart arrived. Their services moved to the departments above.
export const retiredDepartments=[
  {id:'admin-affairs',head:'head-admin',moved_to:'ceo-office'},
  {id:'legal',head:'head-legal',moved_to:'grc'},
  {id:'governance',head:'head-governance',moved_to:'grc'},
  {id:'strategy',head:'head-strategy',moved_to:'business-dev'},
  {id:'growth',head:'head-growth',moved_to:'accounts'},
  {id:'pmo',head:'head-pmo',moved_to:'epmo'},
  {id:'data',head:'head-data',moved_to:'campaigns-audit'}
];

export const catalogServices=[
  // الموارد البشرية — التنفيذ لدى خدمات الموظف
  {code:'HR-SALARY-CERT',req:['HR-05'],section:'الشهادات والخطابات',department_id:'hr',name_ar:'تعريف بالراتب',name_en:'Salary certificate',description:'طلب تعريف بالراتب لجهة محددة. يراجع HR البيانات ويعدّ الخطاب؛ لا يصدر مستندًا رسميًا ولا يرسله للجهة نيابة عنك.',fields:[
    pick('recipient_kind','نوع الجهة',['بنك','سفارة','جهة حكومية','لمن يهمه الأمر','جهة أخرى'],true,{why:'نوع الجهة يفتح الدليل المناسب ويمنع اختلاف اسم المخاطَب بين الطلب والخطاب.'}),
    pick('recipient_bank','البنك',LETTER_BANKS.map(row=>row.name_ar),true,{show_when:{field:'recipient_kind',equals:['بنك']},why:'يُحفظ البنك كجهة مرجعية برمز ثابت، ثم يظهر اسمه المعتمد في الخطاب.'}),
    pick('recipient_embassy','السفارة',LETTER_EMBASSIES.map(row=>row.name_ar),true,{show_when:{field:'recipient_kind',equals:['سفارة']},why:'يُحفظ اختيار السفارة كجهة مرجعية بدل كتابة اسم قد يختلف في الخطاب.'}),
    pick('recipient_government','الجهة الحكومية',LETTER_GOVERNMENTS.map(row=>row.name_ar),true,{show_when:{field:'recipient_kind',equals:['جهة حكومية']},why:'اختر الجهة من الدليل حتى تنتقل إلى الخطاب باسمها المعتمد.'}),
    t('recipient_other','اسم الجهة',true,{show_when:{field:'recipient_kind',equals:['جهة أخرى']},why:'يُستخدم النص الحر فقط عندما لا تكون الجهة بنكًا أو سفارة أو جهة حكومية في الدليل.',hint:'اسم الجهة كما تريدها أن تظهر في الخطاب.',example:'شركة تمويل تجريبية'}),
    pick('language','لغة التعريف',['العربية','الإنجليزية'],true,{why:'لغة الجهة المستقبلة تحدد نسخة الخطاب التي يعدّها فريق الموارد البشرية.'}),
    pick('show_salary','إظهار تفاصيل الراتب',['نعم','الإجمالي فقط','بدون راتب'],true,{why:'راتبك بيان خاص بك؛ لا يُكشف منه إلا القدر الذي تطلبه أنت.',hint:'اختر أقل قدر تقبله الجهة الطالبة.'}),
    long('notes','ملاحظات',false,{hint:'أي صيغة أو بيان تطلبه الجهة ولم يظهر في الحقول أعلاه.',why:'يوفّر جولة مراسلة كاملة حين تشترط الجهة صيغة بعينها.',max_length:1000})],approval_policy:{steps:['hr'],handler_role:'hr'}},
  {code:'HR-PROFILE-UPDATE',req:['HR-01','HR-02'],section:'البيانات والوثائق',department_id:'hr',name_ar:'تحديث البيانات والوثائق الشخصية',name_en:'Personal data and documents update',description:'تحديث بيانات التواصل أو الوثائق مثل الهوية والجواز والمؤهل. أرفق الوثيقة المحدثة. تغيير حساب الراتب له خدمة مستقلة.',fields:[
    pick('change_type','نوع التحديث',['بيانات التواصل','الهوية أو الإقامة','جواز السفر','المؤهل العلمي','الحالة الاجتماعية والتابعون','أخرى'],true,{why:'نوع التحديث يحدد الوثيقة المطلوبة والسجل الذي يُحدَّث.',hint:'لتغيير حساب الراتب استخدم خدمة «تغيير حساب الراتب البنكي».'}),
    long('details','البيانات الجديدة',true,{why:'ما تكتبه هنا هو ما يُدخل في سجلك، فاكتبه كما يظهر في الوثيقة حرفًا بحرف.',hint:'البيان الجديد فقط، دون شرح طويل.',example:'رقم الجوال الجديد 05xxxxxxxx، ويُلغى القديم',max_length:1000}),
    day('document_expiry','تاريخ انتهاء الوثيقة',true,{show_when:{field:'change_type',equals:['الهوية أو الإقامة','جواز السفر']},why:'تاريخ الانتهاء يُبنى عليه تنبيه التجديد قبل أن تتوقف معاملاتك.',hint:'التاريخ كما يظهر في الوثيقة المرفقة.'})],approval_policy:{steps:['hr'],handler_role:'hr'}},
  {code:'HR-ATTENDANCE-FIX',req:['HR-03'],section:'الحضور والدوام',department_id:'hr',name_ar:'تصحيح حضور أو استئذان',name_en:'Attendance correction or permission',description:'تصحيح بصمة، استئذان، أو عمل خارج المكتب. يعتمد المدير ثم الموارد البشرية، ويُحدَّث سجل الحضور بعد الاعتماد.',fields:[
    pick('kind','نوع الطلب',['نسيان بصمة','استئذان','تأخير بعذر','عمل خارج المكتب','عمل عن بعد'],true,{why:'نوع الطلب يحدد ما يُصحَّح في سجل الحضور وما يُطلب من بيانات.'}),
    day('date','التاريخ',true,{why:'يوم واحد لكل طلب، فالتصحيح يقع على يوم بعينه في السجل.',hint:'لأيام متفرقة قدّم طلبًا لكل يوم.'}),
    t('from_time','من الساعة',true,{show_when:{field:'kind',equals:['نسيان بصمة','استئذان','تأخير بعذر']},pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',pattern_message:'اكتب الوقت بأربع خانات على مدار 24 ساعة، مثل 09:30',why:'الفترة المحددة هي ما يُصحَّح في السجل؛ بدونها يُرد الطلب لتحديدها.',example:'09:30'}),
    t('to_time','إلى الساعة',true,{show_when:{field:'kind',equals:['نسيان بصمة','استئذان','تأخير بعذر']},pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',pattern_message:'اكتب الوقت بأربع خانات على مدار 24 ساعة، مثل 14:00',why:'نهاية الفترة تكمل ما يُصحَّح، ويقيس عليها المدير أثر الغياب على العمل.',example:'14:00'}),
    long('reason','السبب',true,{why:'المدير يقرر على السبب لا على النوع وحده.',hint:'ما الذي حال دون الالتزام، بجملة أو جملتين.',example:'اجتماع عميل خارج المكتب صباحًا ولم أمر بالمكتب قبله',min_length:5}),
    long('evidence','الدليل المؤيد',false,{why:'الدليل يغني المعتمِد عن جولة أسئلة، وهو ما يميز طلبًا يمضي من يوم عن آخر يرتد.',hint:'اجتماع في التقويم، رسالة من العميل، أو إذن سابق. أرفق الصورة إن وُجدت.',example:'اجتماع في تقويم العمل مع عميل تجريبي 09:00–11:00',max_length:1000})],approval_policy:{steps:['manager','hr'],handler_role:'hr'}},
  {code:'HR-OVERTIME',req:['HR-03','PAY-03'],section:'الحضور والدوام',department_id:'hr',name_ar:'اعتماد عمل إضافي',name_en:'Overtime approval',description:'ساعات عمل إضافية مسبقة أو لاحقة. الاعتماد مدخل للمسير ولا يصرف مبلغًا ولا يحدد قيمته.',fields:[
    day('date','تاريخ العمل',true,{why:'الساعات تُنسب إلى يوم بعينه، وعليه يُبنى احتسابها في مسير الشهر.'}),
    num('hours','عدد الساعات',true,{why:'العدد هو المدخل الوحيد الذي يصل المسير، فدقّته تعني دقة استحقاقك.',hint:'ساعات فعلية، ويمكن نصف ساعة (0.5).',example:'3.5'}),
    t('project','المشروع أو المهمة',true,{why:'تكلفة الساعة الإضافية تُحمَّل على مشروع، وبها تظهر ربحيته الحقيقية.',example:'حملة إطلاق عميل تجريبي — التسليم النهائي'}),
    long('justification','المبرر',true,{why:'المدير يوازن بين الحاجة وإعادة توزيع العمل قبل أن يعتمد ساعة إضافية.',hint:'لماذا لم يكن العمل ممكنًا داخل الدوام.',min_length:5})],approval_policy:{steps:['manager','hr'],handler_role:'hr'}},
  {code:'HR-JOB-CHANGE',req:['HR-06'],section:'المسار الوظيفي',department_id:'hr',name_ar:'تغيير وظيفي',name_en:'Job change',description:'نقل أو ترقية أو تعديل مسمى أو مدير مباشر. يرفعه المدير ويعتمده الموارد البشرية، ويُحدَّث السجل الوظيفي بعد الاعتماد. تعديل الأجر ليس من هذا الطلب: يتم بتعديل عقد الموظف في شاشة عقود الموظفين، حيث يعدّه شخص ويعتمده آخر.',fields:[
    t('employee_name','اسم الموظف',true,{why:'التغيير يقع على سجل شخص بعينه، ولا يُنفَّذ على اسم غير محدد.',hint:'حدّد الموظف أيضًا في خانة «المستفيد» ليُمنع من اعتماد الطلب أو تنفيذه.'}),
    pick('change_type','نوع التغيير',['نقل إدارة','ترقية','تعديل مسمى','تغيير المدير المباشر'],true,{why:'نوع التغيير يحدد ما يُعدَّل في السجل ومن يلزم إشعاره به.',hint:'لتعديل الأجر: تعديل العقد في شاشة عقود الموظفين، لا هذا الطلب.'}),
    t('new_value','القيمة الجديدة',true,{why:'هذه هي القيمة التي ستُكتب في السجل بعد الاعتماد، فاكتبها نهائية لا تقريبية.',hint:'الإدارة أو المسمى أو اسم المدير الجديد.',example:'مسمى جديد: أخصائي تسويق رقمي أول'}),
    day('effective_date','تاريخ السريان',true,{why:'تاريخ السريان يفصل ما قبل التغيير عما بعده في السجل وفي المسير.'}),
    long('justification','المبرر',true,{why:'قرار الموارد البشرية يُبنى على المبرر لا على الطلب وحده، ويبقى في السجل مرجعًا للقرار.',hint:'الأداء أو إعادة التنظيم أو الاحتياج الذي دعا إليه.',min_length:5})],approval_policy:{steps:['hr'],handler_role:'hr'}},
  {code:'HR-GRIEVANCE',req:['HR-07','EXP-07'],section:'علاقات الموظفين',department_id:'hr',name_ar:'شكوى أو تظلم سري',name_en:'Confidential grievance',description:'يصل إلى الموارد البشرية مباشرة دون المرور بالمدير. يطلع عليه صاحب الطلب ومن يعتمده ويعالجه في الموارد البشرية ومديرها فقط، لا كل الفريق.',fields:[
    pick('category','التصنيف',['بيئة العمل','معاملة غير لائقة','تظلم من تقييم','تظلم من قرار','أخرى'],true,{why:'التصنيف يحدد من يتولى الحالة داخل الموارد البشرية ومسار معالجتها.'}),
    long('description','الوصف',true,{why:'الوقائع بتواريخها هي ما يمكن التحقق منه؛ الانطباع وحده لا يُبنى عليه قرار.',hint:'ماذا حدث ومتى ومن حضره، دون تأويل.',min_length:10}),
    long('expected','المطلوب',true,{why:'ما تعدّه أنت حلًا عادلًا يوجّه المعالجة ويقيس نجاحها عند الإغلاق.',hint:'النتيجة التي تريدها من هذا الطلب.',min_length:5})],approval_policy:{steps:['hr'],handler_role:'hr'}},
  {code:'HR-RESIGNATION',req:['HR-09','PAY-09'],section:'الانضمام والمغادرة',department_id:'hr',name_ar:'استقالة وإخلاء طرف',name_en:'Resignation and clearance',description:'تقديم الاستقالة وبدء إخلاء الطرف. التسوية النهائية تحتسب لاحقًا ولا تصرف من الطلب.',fields:[
    day('last_day','آخر يوم عمل مقترح',true,{why:'عليه تُبنى خطة التسليم وتاريخ إيقاف الصلاحيات وحساب المستحقات.',hint:'اليوم المقترح منك، وقد يُتفق على غيره مع مديرك.'}),
    long('reason','سبب الاستقالة',false,{why:'اختياري عمدًا؛ ما يُكتب هنا يُقرأ في تحليل أسباب المغادرة ولا يؤثر في إجراءات إخلاء الطرف.',max_length:1500}),
    pick('handover','حالة تسليم المهام',['لم يبدأ','قيد التسليم','مكتمل'],true,{why:'حالة التسليم تحدد ما يتبقى من عمل قبل آخر يوم، وهي أول ما يسأل عنه مديرك.'})],approval_policy:{steps:['manager','hr'],handler_role:'hr'}},
  {code:'HR-BENEFIT-CLAIM',req:['PAY-10'],section:'الرواتب والمزايا',department_id:'hr',name_ar:'مطالبة مزايا أو تأمين طبي',name_en:'Benefit or medical insurance claim',description:'إضافة تابع للتأمين، بدل، أو مطالبة مزايا. أرفق المستندات الداعمة. الطلب لا يصرف مبلغًا ولا يعدّل وثيقة التأمين بنفسه.',fields:[
    pick('benefit','نوع الميزة',['إضافة تابع للتأمين','ترقية فئة التأمين','بدل سكن','بدل تعليم','أخرى'],true,{why:'نوع الميزة يحدد من يعالجها وما المستند المطلوب معها.'}),
    num('amount','المبلغ المطلوب بالريال',false,{why:'يُذكر حين تكون المطالبة عن مبلغ محدد، ليُعرف حجم الالتزام قبل إقراره.',hint:'اتركه فارغًا إن كان الطلب إضافة تابع أو ترقية فئة.'}),
    long('details','التفاصيل',true,{why:'التفاصيل هي ما يتصرف عليه فريق المزايا؛ الطلب المجمل يرتد لاستكماله.',hint:'لإضافة تابع: صلة القرابة وتاريخ الميلاد كما في الوثيقة المرفقة. لغيرها: ما المطلوب ومنذ متى. لا تكتب بيانات صحية.',min_length:5})],approval_policy:{steps:['manager','hr'],handler_role:'hr'}},
  {code:'HR-PAYROLL-INQUIRY',req:['PAY-03','PAY-08'],section:'الرواتب والمزايا',department_id:'hr',name_ar:'استفسار أو تصحيح في الراتب',name_en:'Payroll inquiry or correction',description:'ملاحظة على مسير أو قسيمة شهر محدد. يتحقق الموارد البشرية ويوثق النتيجة؛ التصحيح المالي إن ثبت يجري في مسير لاحق.',fields:[
    t('month','شهر المسير',true,{...MONTH,why:'الملاحظة تُفحص في مسير شهر بعينه، ولا يمكن التحقق منها بغير تحديده.',example:'2026-03',max_length:7}),
    pick('issue','نوع الملاحظة',['خصم غير مفهوم','بدل غير مضاف','عمل إضافي غير محتسب','قسيمة غير مستلمة','أخرى'],true,{why:'نوع الملاحظة يوجّه الفحص إلى بند بعينه في المسير بدل مراجعته كله.'}),
    num('amount','الفرق المتوقع بالريال',false,{why:'تقديرك للفرق يوجّه الفحص، ولا يُعتمد مبلغًا مستحقًا بذاته.',hint:'اتركه فارغًا إن لم تكن متأكدًا.'}),
    long('details','التفاصيل',true,{why:'الفرق بين ما توقعته وما ظهر في القسيمة هو مادة الفحص.',hint:'ما الذي ظهر في القسيمة وما الذي كنت تتوقعه.',min_length:5})],approval_policy:{steps:['hr'],handler_role:'hr'}},
  {code:'HR-SALARY-ADVANCE',req:['PAY-03'],section:'الرواتب والمزايا',department_id:'hr',name_ar:'سلفة على الراتب',name_en:'Salary advance',description:'طلب سلفة بخطة سداد. الاعتماد قرار داخلي ولا يحول مبلغًا؛ التحويل يجري في المسير بعد إقراره.',fields:[
    num('amount','المبلغ بالريال',true,{why:'المبلغ هو موضوع القرار، وعليه يُبنى الخصم الشهري لاحقًا.'}),
    num('installments','عدد أشهر السداد',true,{why:'عدد الأشهر يحدد الخصم من كل راتب، وهو ما يوازنه المعتمِد مع صافي دخلك.',example:'6'}),
    long('reason','السبب',true,{why:'السلفة استثناء يُقرَّر على سببه لا على المبلغ وحده.',min_length:5})],approval_policy:{steps:['manager','hr'],handler_role:'hr'}},
  {code:'TAL-TRAINING',req:['TAL-07','TAL-08'],section:'التطوير والأداء',department_id:'hr',name_ar:'طلب تدريب أو شهادة مهنية',name_en:'Training or certification request',description:'دورة أو مؤتمر أو شهادة مرتبطة بخطة التطوير. الاعتماد لا يسجّلك في البرنامج ولا يشتريه.',fields:[
    t('program','اسم البرنامج',true,{why:'اسم البرنامج يُتحقق منه ويُقارن بما سبق اعتماده لغيرك.',example:'شهادة إدارة الحملات الرقمية — المستوى الأول'}),
    t('provider','الجهة المقدمة',true,{why:'الجهة تحدد جدية البرنامج وطريقة الشراء والسداد.'}),
    day('start_date','تاريخ البداية',true,{why:'تاريخ البداية يحدد المهلة المتاحة للاعتماد والتسجيل قبل فوات الموعد.'}),
    day('end_date','تاريخ النهاية',true,{why:'مدة البرنامج تُحسب منها أيام انشغالك عن العمل ليرتب المدير التغطية.'}),
    num('cost','التكلفة بالريال',false,{why:'التكلفة تُقارن بالمخصص المتاح قبل الالتزام.',hint:'اتركه فارغًا إن كان البرنامج مجانيًا.'}),
    long('development_goal','الأثر على الأداء أو خطة التطوير',true,{why:'هذا الحقل هو ما يفرّق بين تدريب يخدم العمل وآخر يستهلك وقتًا وميزانية.',hint:'أي مهارة ينقصك أداؤها اليوم، وما الذي ستفعله بعد البرنامج ولا تستطيعه الآن.',min_length:10})],approval_policy:{steps:['manager','hr'],handler_role:'hr'}},
  {code:'TAL-PERFORMANCE-REVIEW',req:['TAL-05','TAL-06'],section:'التطوير والأداء',department_id:'hr',name_ar:'مراجعة تقييم الأداء',name_en:'Performance review or calibration',description:'طلب مراجعة تقييم دوري أو اجتماع معايرة، مع الأدلة. الطلب لا يغيّر درجة التقييم بنفسه.',fields:[
    t('period','فترة التقييم',true,{why:'المراجعة تقع على دورة تقييم بعينها، ولها بياناتها وأدلتها.',example:'النصف الأول 2026'}),
    pick('request','نوع الطلب',['مراجعة تقييم','خطة تحسين أداء','اجتماع معايرة','تحديد أهداف'],true,{why:'نوع الطلب يحدد من يحضر ومن يقرر ومخرج الاجتماع.'}),
    long('evidence','الأدلة والمبررات',true,{why:'تغيير تقييم معتمد لا يقوم إلا على أدلة قابلة للفحص.',hint:'مخرجات وتواريخ وأرقام، لا انطباعات.',min_length:10})],approval_policy:{steps:['manager','hr'],handler_role:'hr'}},
  // تقنية المعلومات
  {code:'IT-ACCESS',req:['IT-02'],section:'الحسابات والصلاحيات',department_id:'it',name_ar:'طلب صلاحية نظام',name_en:'System access request',description:'منح أو تعديل أو سحب صلاحية على نظام داخلي أو حساب عميل. الاعتماد داخلي، والتنفيذ يجريه فريق تقنية المعلومات يدويًا.',fields:[
    t('system','النظام',true,{why:'اسم النظام يحدد من يملك منحه وما مستويات الصلاحية المتاحة فيه.',example:'نظام إدارة الحملات — حساب عميل تجريبي'}),
    t('system_owner','مالك النظام أو الفريق المسؤول عنه',false,{why:'كثير من الأنظمة تُدار خارج تقنية المعلومات، ومعرفة مالكها تختصر جولة بحث قبل التنفيذ.',hint:'اتركه فارغًا إن لم تعرفه.'}),
    pick('action','الإجراء',['منح','تعديل','سحب'],true,{why:'الإجراء يحدد ما يُنفَّذ على الحساب، والسحب لا يحتاج مستوى ولا مدة.'}),
    t('access_level','مستوى الصلاحية',true,{show_when:{field:'action',equals:['منح','تعديل']},why:'أقل صلاحية تكفي للعمل هي القاعدة، ولا تُمنح صلاحية دون تحديد مستواها.',hint:'قراءة فقط، تحرير، أو إدارة كاملة.',example:'قراءة فقط على تقارير الحملة'}),
    pick('duration','مدى الحاجة',['دائمة ضمن مهام وظيفتي','مؤقتة لمشروع أو مهمة'],true,{why:'الصلاحية المؤقتة تُسحب في موعدها؛ بدون هذا التمييز تتراكم صلاحيات لا يحتاجها أحد.'}),
    day('access_until','تنتهي الصلاحية في',true,{show_when:{field:'duration',equals:['مؤقتة لمشروع أو مهمة']},why:'التاريخ ينحفظ مع الطلب عشان يُعرف متى تنتهي الصلاحية. المنصة للحين ما تسحبها بنفسها — السحب يدوي في موعده.'}),
    long('justification','المبرر',true,{why:'المدير يقرر على الحاجة لا على اسم النظام؛ والمبرر يبقى مرجعًا عند مراجعة الصلاحيات.',hint:'أي عمل لا تستطيع إنجازه اليوم بدون هذه الصلاحية.',min_length:5})],approval_policy:{steps:['manager','it'],handler_role:'it'}},
  {code:'IT-DEVICE',req:['IT-04'],section:'الأجهزة والبرامج',department_id:'it',name_ar:'طلب جهاز أو ملحقات',name_en:'Device or accessory request',description:'حاسب أو شاشة أو هاتف أو ملحقات. الاعتماد لا يشتري الجهاز؛ الشراء يمر بالمشتريات وتُسجَّل العهدة عند التسليم.',fields:[
    pick('device','نوع الجهاز',['حاسب محمول','شاشة','هاتف','لوحة مفاتيح وفأرة','سماعة','أخرى'],true,{why:'نوع الجهاز يحدد المتاح في المخزون وما يحتاج شراء.'}),
    pick('reason','السبب',['موظف جديد','تلف','استبدال دوري','احتياج عمل'],true,{why:'السبب يفرّق بين ما يُصرف من المخزون وما يحتاج قرار شراء.'}),
    long('fault','وصف العطل',true,{show_when:{field:'reason',equals:['تلف']},why:'وصف العطل يحدد هل يُصلح الجهاز أم يُستبدل، وهو فرق في التكلفة كبير.',hint:'متى بدأ العطل وما الذي يظهر على الجهاز.',min_length:5}),
    long('specs','المواصفات المطلوبة',false,{why:'المواصفات تُقارن بالمتاح قبل الشراء، وغيابها يعني جهازًا قد لا يفي بالعمل.',hint:'ما يحتاجه عملك فعلًا: برامج التصميم أو المونتاج أو ما شابه.',example:'جهاز يشغّل برامج المونتاج مع شاشة خارجية'})],approval_policy:{steps:['manager','it'],handler_role:'it'}},
  {code:'IT-SOFTWARE',req:['IT-04'],section:'الأجهزة والبرامج',department_id:'it',name_ar:'طلب برنامج أو ترخيص',name_en:'Software or license request',description:'ترخيص برنامج أو اشتراك سحابي، مع فحص الترخيص والأمن. الاعتماد لا يشتري الاشتراك ولا ينشئ الحساب.',fields:[
    t('software','اسم البرنامج',true,{why:'الاسم يُفحص مقابل ما تملكه الشركة فعلًا؛ كثير من الطلبات تنتهي بترخيص قائم غير مستعمل.',example:'أداة جدولة منشورات المنصات'}),
    pick('license_type','نوع الترخيص',['شهري','سنوي','دائم','تجريبي'],true,{why:'نوع الترخيص يحدد الالتزام المتكرر وموعد التجديد أو الإيقاف.'}),
    num('seats','عدد المستخدمين',true,{why:'عدد المقاعد هو ما يُشترى فعلًا، وزيادته أكثر ما يرفع فاتورة الاشتراكات.',example:'3'}),
    num('cost','التكلفة التقديرية بالريال',false,{why:'التقدير يُقارن بالمخصص المتاح قبل الالتزام، ويُصحَّح بعرض المورد.'}),
    pick('data_scope','البيانات التي ستُعالج في الأداة',['لا بيانات شركة أو عملاء','بيانات داخلية','بيانات عملاء'],true,{why:'ما يدخل الأداة من بيانات يحدد الفحص الأمني المطلوب قبل الموافقة، لا سعرها.'}),
    long('use_case','الاستخدام',true,{why:'الاستخدام المحدد يُقارن بما تفعله الأدوات القائمة، فلا تتكرر الاشتراكات.',hint:'ما العمل الذي ستؤديه بها، ولماذا لا تكفي الأدوات الحالية.',min_length:5})],approval_policy:{steps:['manager','it'],handler_role:'it'}},
  {code:'IT-SECURITY-INCIDENT',req:['IT-10','LEG-10'],section:'الأمن السيبراني',department_id:'it',name_ar:'بلاغ أمني',name_en:'Security incident report',description:'رسالة احتيال، فقد جهاز، اشتباه اختراق. يصل مباشرة إلى تقنية المعلومات دون المرور بمديرك.',fields:[
    pick('incident','نوع البلاغ',['رسالة تصيد','فقد أو سرقة جهاز','اشتباه اختراق حساب','تسريب بيانات','برمجية ضارة'],true,{why:'نوع الحادثة يحدد أول إجراء احتواء: إيقاف حساب، عزل جهاز، أو حجب رسالة.'}),
    t('affected','الحساب أو الجهاز المتأثر',false,{why:'تحديد المتأثر يختصر زمن الاحتواء؛ وهو أثمن ما في البلاغ العاجل.',hint:'بريد العمل، رقم الجهاز، أو اسم النظام.'}),
    day('occurred_on','تاريخ الحدوث',true,{why:'وقت الحدوث يحدد نطاق السجلات التي تُفحص وما قد يكون تسرب خلاله.',hint:'أقرب تاريخ تتذكره إن لم تكن متأكدًا.'}),
    long('description','ماذا حدث',true,{why:'التفاصيل الأولى هي ما يبني عليه الفريق قرار الاحتواء قبل التحقيق الكامل.',hint:'ما الذي رأيته أو فعلته بالضبط. لا تعد إرسال الرسالة المشبوهة ولا تكتب كلمة المرور هنا.',min_length:10}),
    urgency],approval_policy:{steps:['it'],handler_role:'it'}},
  {code:'IT-NEW-ACCOUNT',req:['IT-02'],section:'الحسابات والصلاحيات',department_id:'it',name_ar:'تجهيز حسابات موظف جديد',name_en:'New employee accounts',description:'بريد وحسابات وأجهزة لموظف جديد قبل مباشرته. لا ينشئ عقدًا ولا سجلًا وظيفيًا.',fields:[
    t('employee_name','اسم الموظف الجديد',true,{why:'الاسم يُبنى عليه البريد وحسابات الأنظمة، فاكتبه كما في العقد.'}),
    t('department','الإدارة',true,{why:'الإدارة تحدد المجموعات والصلاحيات الافتراضية ومكان الجهاز.'}),
    t('reports_to','المدير المباشر',false,{why:'المدير المباشر يُبنى عليه توجيه الاعتمادات في المنصة بعد المباشرة.'}),
    day('start_date','تاريخ المباشرة',true,{why:'تاريخ المباشرة يحدد متى تُفعَّل الحسابات؛ تفعيلها قبله يفتح وصولًا بلا حاجة.'}),
    long('systems','الأنظمة المطلوبة',true,{why:'القائمة المكتوبة تمنع أسبوعًا أول ضائعًا في طلب صلاحية بعد أخرى.',hint:'الأنظمة التي سيعمل عليها فعلًا، ومستوى كل واحد إن عرفته.',example:'البريد، مساحة الملفات، أداة إدارة المهام — بصلاحية تحرير',min_length:5})],approval_policy:{steps:['it'],handler_role:'it'}},
  // الإبداع
  {code:'CRT-DESIGN',req:['CRT-01','CRT-02'],section:'التصميم',department_id:'creative',name_ar:'طلب تصميم',name_en:'Design request',description:'تصميم داخلي أو لعميل بموجز واضح وموعد تسليم. يُنفَّذ في شاشة الاستوديو بعد الاعتماد.',fields:[
    pick('design_type','نوع التصميم',['منشور','عرض تقديمي','هوية','مطبوعات','واجهة رقمية','أخرى'],true,{why:'نوع المخرج يحدد من يُسند إليه العمل وكم يستغرق.'}),
    pick('for_whom','لحساب من',['داخلي','عميل'],true,{why:'عمل العميل يُحمَّل على مشروعه ويمر بمراجعة الهوية، والداخلي لا.'}),
    t('client','العميل أو المشروع',true,{show_when:{field:'for_whom',equals:['عميل']},why:'اسم العميل يربط المخرج بمشروعه، وبه تُعرف ساعاته وتكلفته.'}),
    long('brief','الموجز',true,{why:'الموجز هو ما يُصمَّم عليه فعلًا؛ نقصه يعني جولات تعديل تُحسب على وقت الفريق ووقتك.',hint:'الرسالة، والجمهور، وأين سيُنشر، وما يجب أن يظهر فيه حتمًا.',example:'منشور إعلان شراكة، جمهور مهني، يظهر فيه شعار الطرفين وتاريخ الإطلاق',min_length:10}),
    t('dimensions','المقاسات والصيغ',false,{why:'المقاس الخاطئ يعيد العمل كله؛ تحديده مبكرًا أرخص من إعادته.',example:'مربع للمنصات ونسخة أفقية للعرض التقديمي'}),
    day('due_date','موعد التسليم',true,{why:'الموعد يدخل في ترتيب حمل الاستوديو، وعليه يُقبل الطلب أو يُفاوض عليه.'})],approval_policy:{steps:['manager'],handler_role:'manager'}},
  {code:'CRT-CONTENT',req:['CRT-03'],section:'المحتوى والكتابة',department_id:'creative',name_ar:'طلب كتابة محتوى',name_en:'Content writing request',description:'نصوص ومقالات وسيناريوهات مع جمهور ونبرة محددين. الطلب لا ينشر شيئًا؛ النشر خدمة منفصلة.',fields:[
    pick('content_type','نوع المحتوى',['منشورات','مقال','سيناريو','بيان','نصوص موقع','أخرى'],true,{why:'نوع المحتوى يحدد الكاتب المناسب وطول العمل.'}),
    t('audience','الجمهور المستهدف',true,{why:'النص يُكتب لجمهور بعينه؛ «الجميع» تعني نصًا لا يقنع أحدًا.',example:'مديرو تسويق في شركات متوسطة'}),
    pick('language','اللغة',['العربية','الإنجليزية','كلاهما'],true,{why:'اللغة تحدد الكاتب والمدقق، و«كلاهما» عمل مضاعف لا ترجمة آلية.'}),
    long('brief','الموجز والرسائل الرئيسية',true,{why:'الرسائل التي تريد بقاءها في ذهن القارئ هي ما يُقاس عليه النص عند التسليم.',hint:'الرسالة الواحدة الأهم، ثم ما يجب ذكره، ثم ما يجب تجنبه.',min_length:10}),
    day('due_date','موعد التسليم',true,{why:'الموعد يرتب العمل مع بقية التكليفات، وقبوله التزام لا تمنٍّ.'})],approval_policy:{steps:['manager'],handler_role:'manager'}},
  // الشؤون الإدارية
  {code:'ADM-MAINTENANCE',req:['ADM-01','ADM-10'],section:'المرافق والصيانة',department_id:'ceo-office',name_ar:'صيانة وإصلاح',name_en:'Maintenance request',description:'عطل في المكتب أو المرافق: تكييف، كهرباء، سباكة، أثاث. يُسند إلى فريق المرافق أو مقاول الصيانة بعد الاعتماد.',fields:[
    pick('category','التصنيف',['تكييف','كهرباء','سباكة','أثاث','نظافة','أخرى'],true,{why:'التصنيف يحدد الفني أو المقاول الذي يُستدعى.'}),
    t('location','الموقع',true,{why:'العنوان الدقيق يمنع جولة بحث في المبنى قبل الإصلاح.',hint:'الدور والغرفة أو أقرب معلم.',example:'الدور الثالث — غرفة الاجتماعات الصغيرة'}),
    long('description','وصف العطل',true,{why:'الوصف يحدد القطعة أو الأداة التي يحملها الفني معه من أول زيارة.',hint:'ما الذي يحدث ومتى بدأ، وهل يتكرر.',min_length:5}),
    urgency],approval_policy:HEAD},
  {code:'ADM-ROOM-BOOKING',req:['ADM-02'],section:'الحجوزات',department_id:'ceo-office',name_ar:'حجز قاعة اجتماعات',name_en:'Meeting room booking',description:'حجز قاعة بتاريخ ووقت وعدد حضور وتجهيزات. الحجز يثبت بعد اعتماده ولا يُرسل دعوات التقويم.',fields:[
    t('room','القاعة المفضلة',false,{why:'تفضيلك يُراعى إن كانت متاحة، وإلا رُشحت قاعة بديلة بالحجم نفسه.'}),
    day('date','التاريخ',true,{why:'التاريخ والوقت معًا هما ما يُحجز، وبهما يُكشف التعارض مع حجز آخر.'}),
    t('from_time','من الساعة',true,{pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',pattern_message:'اكتب الوقت بأربع خانات على مدار 24 ساعة، مثل 10:00',why:'بداية الحجز تحدد الفترة المحجوزة ومتى تُجهَّز القاعة.',example:'10:00'}),
    t('to_time','إلى الساعة',true,{pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',pattern_message:'اكتب الوقت بأربع خانات على مدار 24 ساعة، مثل 11:30',why:'نهاية الحجز تفتح القاعة لمن بعدك؛ تمديدها لاحقًا ليس مضمونًا.',example:'11:30'}),
    num('attendees','عدد الحضور',true,{why:'العدد يحدد القاعة المناسبة وعدد الكراسي والضيافة.'}),
    pick('setup','التجهيزات',['بدون','شاشة عرض','اجتماع مرئي','ضيافة','كامل'],true,{why:'التجهيزات تُعدّ قبل الموعد؛ طلبها في وقتها يعني اجتماعًا يبدأ في وقته.'}),
    t('purpose','الغرض من الحجز',true,{why:'الغرض يرجّح بين حجزين متعارضين على القاعة نفسها.',example:'عرض نتائج حملة على عميل تجريبي'})],approval_policy:HEAD},
  {code:'ADM-VISITOR',req:['ADM-03'],section:'الزوار والدخول',department_id:'ceo-office',name_ar:'تصريح دخول زائر',name_en:'Visitor access permit',description:'تسجيل زائر مسبقًا مع المضيف والغرض، ليُسمح له بالدخول في موعده.',fields:[
    t('visitor_name','اسم الزائر',true,{why:'الاسم هو ما يُسلَّم للاستقبال ليؤذن بالدخول؛ لا يُطلب رقم هوية في هذه الخدمة.'}),
    t('organization','الجهة',true,{why:'جهة الزائر تحدد مستوى الاستقبال وما إذا كان يحتاج مرافقة داخل المكتب.'}),
    day('visit_date','تاريخ الزيارة',true,{why:'التصريح يسري ليوم محدد؛ ولزيارة متكررة قدّم طلبًا لكل يوم.'}),
    t('visit_time','وقت الوصول',true,{pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',pattern_message:'اكتب الوقت بأربع خانات على مدار 24 ساعة، مثل 13:15',why:'وقت الوصول يُبلَّغ للاستقبال ويحدد من يستقبل الزائر.',example:'13:15'}),
    long('purpose','غرض الزيارة',true,{why:'الغرض يحدد المرافقة المطلوبة والمناطق المسموح دخولها.',min_length:5})],approval_policy:MANAGER_HEAD},
  // حقول «نموذج طلب انتداب» الورقي كما هي فيه: نوع الرحلة والمدينة والدولة، ومن تاريخ / إلى تاريخ، وبداية
  // ونهاية الانتداب الفعلية، وصفوف الطيران والسكن والمواصلات (حجز / بدون حجز). واسم الموظف ورقمه الوظيفي
  // ومسماه وإدارته لا تُسأل: النموذج الورقي يسألها لأن الورقة لا تعرف من يحملها، والمنصة تعرف صاحب الطلب
  // وتقرأها من سجله — وسؤال الموظف عن اسمه ورقمه تفكيرُ ورقٍ على شاشة.
  // وصفَّا السكن والمواصلات هما مدخل م65/2 نفسه: «حجز» يعني أن المنشأة وفّرته فيُخفض البدل إلى النصف مع
  // السكن وحده وإلى الربع معهما، و«بدون حجز» يعني أنها لم توفره فلا يُخفض. لذلك حلّا محل حقل «المطلوب»
  // القديم الذي كان يقارب السؤال نفسه بأربعة خيارات مجملة لا يُحسب عليها بدل.
  {code:'ADM-TRAVEL',req:['ADM-04'],section:'السفر والتنقل',department_id:'ceo-office',name_ar:'انتداب',name_en:'Secondment',description:'انتداب داخل المملكة أو خارجها، وبدله ينحسب لك على طول من عدد الأيام ودرجتك. الاعتماد قرار داخلي: ما يحجز تذكرة ولا يصرف بدل.',fields:[
    pick('travel_type','نوع الرحلة',['داخلية','خارجية'],true,{why:'داخل المملكة وخارجها لهما بدل مختلف في جدول الفئات، ودرجة إركاب مختلفة (م65).'}),
    t('city','المدينة',true,{why:'المدينة هي مكان أداء المهمة، ومنها تُقاس المسافة اللي يستحق عليها البدل (م64/3).',example:'جدة'}),
    t('country','الدولة',true,{show_when:{field:'travel_type',equals:['خارجية']},why:'الانتداب خارج المملكة يبي الدولة مع المدينة: عليها التأشيرة والتذكرة.',example:'مصر'}),
    day('start_date','من تاريخ',true,{why:'تاريخا السفر يحددان مدة غيابك عن العمل وتكلفة السكن.'}),
    day('end_date','إلى تاريخ',true,{why:'العودة تغلق مدة الانتداب، وعليها تُبنى التسوية بعد الرجوع.'}),
    day('actual_start_date','بداية الانتداب الفعلية',false,{why:'البدل ينحسب عن الأيام الفعلية لا المخططة (م65/1). اتركها فاضية إن ما تغيّر شي، وعدّلها إن سافرت أو رجعت في يوم ثاني.'}),
    day('actual_end_date','نهاية الانتداب الفعلية',false,{why:'نهاية المدة الفعلية تقفل العدّ؛ وأي فرق عن المخطط يظهر للمعتمِد بدل ما يُطمر (م65/1).'}),
    pick('flight','الطيران',['حجز','بدون حجز'],true,{why:'تذكرة الإركاب ذهابًا وإيابًا حق في م65/4، ودرجتها بحسب فئتك؛ و«بدون حجز» يعني إنك رتّبت سفرك بنفسك وتطالب بقيمته.'}),
    pick('housing','السكن',['حجز','بدون حجز'],true,{why:'إذا المنشأة وفّرت لك السكن ينزل البدل إلى النصف، ومعه المواصلات إلى الربع (م65/2). فهذا الصفّ يغيّر المبلغ مباشرة.'}),
    pick('transport','المواصلات',['حجز','بدون حجز'],true,{why:'وسيلة التنقل من المنشأة تنزل البدل مع السكن إلى الربع (م65/2)؛ وبدونها تبقى المواصلات عليك ويبقى بدلك كامل.'}),
    t('project','المشروع أو العميل',false,{why:'ربط السفر بمشروع يخلي تكلفته ظاهرة في ربحيته بدل ما تُحمَّل على المصروف العام.'}),
    long('purpose','توصيات المدير المباشر والغرض من السفر',true,{why:'الغرض هو اللي يوازنه المعتمِد مع تكلفة السفر وبدائله، وهو نفس خانة النموذج الورقي.',hint:'ليه يلزم حضورك شخصيًا، وإيش تتوقع تطلع به.',min_length:5})],
    // مسار الاعتماد يبقى كما كان (المدير المباشر ثم مدير الإدارة). وتوقيعات النموذج الورقي الخمسة — مقدم
    // الطلب، والمدير المباشر، ونائب الرئيس للخدمات المؤسسية، ومدير رأس المال البشري، والرئيس التنفيذي —
    // لا تُعبَّر عنها كاملة بمفردات الخطوات الحالية: خطوة executive لا تتكرر في السياسة (validatePolicy يلزم
    // دورًا مختلفًا لكل خطوة) وتُحلّ بقطاع صاحب الطلب (escalationFor)، فلا يوجد دور يفرّق «نائب الرئيس
    // للخدمات المؤسسية» من «الرئيس التنفيذي». وتغيير ذلك يمسّ app/workflow.mjs، فهو قرار خارج هذا العمل
    // يُذكر ولا يُفتعل هنا بمسار ينقص توقيعين ويكسر توجيه الاعتماد.
    approval_policy:MANAGER_HEAD},
  {code:'ADM-EXPENSE-CLAIM',req:['ADM-05'],section:'المصروفات والعهد',department_id:'ceo-office',name_ar:'مطالبة مصروفات',name_en:'Expense claim',description:'استرداد مصروف عمل مع إرفاق الفاتورة. الاعتماد لا يحول مبلغًا؛ الصرف يجري في دورة المدفوعات.',fields:[
    day('expense_date','تاريخ المصروف',true,{why:'تاريخ المصروف يحدد الفترة المحاسبية التي يُقيَّد فيها.'}),
    pick('category','التصنيف',['مواصلات','ضيافة','مستلزمات','اشتراكات','سفر','أخرى'],true,{why:'التصنيف يحدد بند الميزانية الذي يُخصم منه.'}),
    num('amount','المبلغ بالريال شامل الضريبة',true,{why:'المبلغ هو ما يُسترد، ولا بد أن يطابق الفاتورة المرفقة بالهللة.',example:'87.50'}),
    t('project','المشروع أو مركز التكلفة',false,{why:'بدونه يُحمَّل المصروف على المصروف العام ولا يظهر في تكلفة المشروع الذي أنفق عليه.'}),
    long('description','الوصف',true,{why:'الوصف يربط المبلغ بعمل حقيقي؛ فاتورة بلا سياق أكثر ما يرتد.',hint:'ماذا اشتريت أو أين ذهبت، ولأي عمل.',example:'ضيافة اجتماع عميل تجريبي — أربعة أشخاص',min_length:5})],approval_policy:MANAGER_HEAD},
  {code:'ADM-SUPPLIES',req:['ADM-07'],section:'المستلزمات',department_id:'ceo-office',name_ar:'قرطاسية ومستلزمات مكتبية',name_en:'Office supplies',description:'صرف مستلزمات من المخزون الخفيف. ما لا يتوفر في المخزون يتحول إلى طلب شراء مستقل.',fields:[
    long('items','الأصناف والكميات',true,{why:'الصنف والكمية هما ما يُصرف فعلًا؛ الطلب المجمل يرتد لتفصيله.',hint:'صنف وكمية في كل سطر.',example:'دفاتر ملاحظات — 5\nأقلام سبورة — 10',min_length:3}),
    t('location','موقع التسليم',true,{why:'موقع التسليم يوجّه المستلزمات إلى مكتبك بدل تركها في الاستقبال.'}),
    day('needed_by','مطلوب قبل',false,{why:'الموعد يُرتب الصرف مع بقية الطلبات، ويكشف ما يحتاج شراء عاجلًا.'}),
    pick('purpose','الغرض',['استخدام يومي','موظف جديد','فعالية','عميل'],false,{why:'الغرض يميّز الاستهلاك المتكرر عن الاحتياج المرتبط بحدث، وبه تُضبط الكميات.'})],approval_policy:HEAD},
  {code:'ADM-OUTGOING-LETTER',req:['ADM-06'],section:'المراسلات الرسمية',department_id:'ceo-office',name_ar:'مراسلة رسمية صادرة',name_en:'Official outgoing letter',description:'خطاب صادر باسم الشركة لجهة خارجية، يقيد برقم صادر بعد الاعتماد. المنصة لا ترسله إلى الجهة.',fields:[
    t('recipient','الجهة المرسل إليها',true,{why:'الجهة تحدد صيغة المخاطبة ومن يوقّع الخطاب.'}),
    t('subject','الموضوع',true,{why:'الموضوع يُقيَّد في سجل الصادر، وبه يُسترجع الخطاب لاحقًا.'}),
    long('body','مسودة النص',true,{why:'ما يُعتمد هو النص لا فكرته؛ الخطاب الصادر يلزم الشركة بما فيه.',hint:'اكتب النص كما تريده أن يخرج، وسيُراجع لغويًا وقانونيًا.',min_length:10}),
    pick('signatory','جهة التوقيع',['الرئيس التنفيذي','مدير الإدارة','أخرى'],true,{why:'جهة التوقيع تحدد مسار الاعتماد ومستوى الالتزام الذي يرتبه الخطاب.'})],approval_policy:MANAGER_HEAD},
  {code:'ADM-SAFETY',req:['ADM-09'],section:'السلامة',department_id:'ceo-office',name_ar:'بلاغ سلامة',name_en:'Safety report',description:'خطر سلامة أو حادث في موقع العمل. يصل إلى إدارة المرافق دون المرور بمديرك.',fields:[
    pick('hazard','نوع البلاغ',['خطر حريق','إصابة','معدات غير آمنة','مخرج طوارئ مغلق','أخرى'],true,{why:'النوع يحدد إجراء الاحتواء الفوري ومن يُستدعى له.'}),
    t('location','الموقع',true,{why:'الموقع الدقيق يختصر زمن الوصول، وهو أثمن ما في بلاغ السلامة.'}),
    long('description','الوصف',true,{why:'الوصف يحدد هل يُعزل المكان فورًا أم يُجدول الإصلاح.',hint:'ما الخطر، ومن يتعرض له، ومنذ متى.',min_length:5}),
    urgency],approval_policy:HEAD},
  {code:'ADM-SUBSCRIPTION',req:['ADM-08'],section:'العقود التشغيلية',department_id:'ceo-office',name_ar:'تجديد اشتراك أو عقد خدمة',name_en:'Subscription or service contract renewal',description:'تجديد عقد نظافة أو أمن أو اشتراك تشغيلي قبل انتهائه. الاعتماد لا يوقّع عقدًا ولا يدفع.',fields:[
    t('vendor','المورد',true,{why:'اسم المورد يربط الطلب بعقده القائم وسجل أدائه.'}),
    day('expiry_date','تاريخ الانتهاء',true,{why:'تاريخ الانتهاء يحدد المهلة المتاحة للتفاوض أو البحث عن بديل قبل انقطاع الخدمة.'}),
    num('annual_cost','التكلفة السنوية بالريال',true,{why:'التكلفة تُقارن بالعام الماضي وبالمخصص قبل الالتزام بسنة جديدة.'}),
    long('notes','ملاحظات الأداء والتجديد',true,{why:'أداء المورد خلال المدة الماضية هو ما يبرر التجديد أو يوقفه.',hint:'ما الذي سار جيدًا وما تكرر من ملاحظات.',min_length:5})],approval_policy:MANAGER_HEAD},
  // المالية
  {code:'FIN-PAYMENT-REQUEST',req:['FIN-05'],section:'المدفوعات',department_id:'finance',name_ar:'طلب صرف لمورد',name_en:'Supplier payment request',description:'طلب صرف مستحق مورد مطابق لأمر شراء وفاتورة. أرفق الفاتورة. لا دفع بنكي من المنصة؛ التحويل يجريه المالي خارجها.',fields:[
    t('supplier','المورد',true,{why:'اسم المورد يُطابق بسجل الموردين المؤهلين؛ الصرف لغير مسجل يتوقف.'}),
    t('invoice_number','رقم فاتورة المورد',true,{why:'رقم الفاتورة هو ما يمنع صرف الفاتورة نفسها مرتين.',max_length:60}),
    num('amount','المبلغ بالريال',true,{why:'المبلغ يُطابق بالفاتورة وأمر الشراء قبل الصرف؛ أي فرق يوقف الطلب.'}),
    t('purchase_order','رقم أمر الشراء',false,{why:'أمر الشراء يثبت أن الالتزام اعتُمد قبل وقوعه؛ غيابه يستدعي تفسيرًا في الوصف.',max_length:60}),
    day('due_date','تاريخ الاستحقاق',true,{why:'الاستحقاق يرتب الفاتورة في دورة المدفوعات ويدخل في التنبؤ النقدي.',hint:'كما في الفاتورة أو شروط العقد.'}),
    t('cost_center','مركز التكلفة أو المشروع',true,{why:'يحدد أي ميزانية تتحمل المبلغ، وبه تظهر تكلفة المشروع الحقيقية.'}),
    long('purpose','ما الذي نُفذ أو اشتُري',true,{why:'الصرف مقابل استلام فعلي؛ هذا الحقل إقرارك بأن العمل نُفذ أو البضاعة وصلت.',hint:'ما الذي استُلم ومتى ومن استلمه.',min_length:5})],approval_policy:MANAGER_HEAD},
  {code:'FIN-CUSTODY',req:['ADM-05','FIN-06'],section:'المدفوعات',department_id:'finance',name_ar:'عهدة نقدية أو تسويتها',name_en:'Petty cash custody',description:'فتح عهدة مؤقتة أو تسويتها بالفواتير. الاعتماد لا يسلّم نقدًا؛ التسليم والتسوية يوثقهما المالي.',fields:[
    pick('action','الإجراء',['طلب عهدة','تسوية عهدة','إقفال عهدة'],true,{why:'الإجراء يحدد هل يُفتح التزام جديد أم يُغلق قائم.'}),
    num('amount','المبلغ بالريال',true,{why:'في الطلب هو مبلغ العهدة، وفي التسوية والإقفال هو مجموع الفواتير المرفقة.'}),
    t('purpose','الغرض',true,{why:'العهدة تُفتح لغرض محدد وتُسوّى عليه؛ الغرض العام يجعل التسوية خلافًا.',example:'مصروفات تصوير خارجي ليومين — مشروع تجريبي'}),
    day('settle_by','موعد التسوية',true,{show_when:{field:'action',equals:['طلب عهدة']},why:'العهدة المفتوحة بلا موعد تبقى التزامًا معلقًا عليك وعلى الإقفال الشهري.'})],approval_policy:MANAGER_HEAD},
  {code:'FIN-CLIENT-INVOICE',req:['FIN-03','FIN-08','ACC-08'],section:'الفوترة والتحصيل',department_id:'finance',name_ar:'طلب إصدار فاتورة لعميل',name_en:'Client invoice request',description:'فوترة مرحلة أو دفعة وفق العقد والتسليم. يصدر المالي الفاتورة الرسمية خارج المنصة.',fields:[
    t('client','العميل',true,{why:'اسم العميل كما في العقد هو ما يظهر في الفاتورة الرسمية.'}),
    t('contract','رقم العقد أو العرض',true,{why:'العقد هو سند الفوترة؛ المالي يطابق المبلغ والمرحلة بما فيه قبل الإصدار.',max_length:80}),
    t('milestone','المرحلة أو الدفعة',true,{why:'تحديد المرحلة يمنع فوترتها مرتين أو تجاوز مرحلة لم تُفوتر.',example:'الدفعة الثانية — تسليم الهوية البصرية'}),
    num('amount','المبلغ قبل الضريبة بالريال',true,{why:'المبلغ قبل الضريبة هو ما يُطابق بالعقد؛ الضريبة يحسبها المالي عند الإصدار.'}),
    day('expected_date','تاريخ الإصدار المطلوب',true,{why:'تاريخ الإصدار يحدد الفترة المحاسبية وبداية مهلة السداد.'}),
    pick('delivery_status','حالة التسليم',['مقبول من العميل','مسلم بانتظار القبول','دفعة مقدمة حسب العقد'],true,{why:'الفوترة قبل قبول العميل أكثر ما ينتج إشعارات دائنة وخلافات تحصيل.'}),
    long('notes','ملاحظات',false,{hint:'مرجع أمر الشراء لدى العميل أو جهة الاستلام إن اشترطها.',why:'متطلبات العميل الشكلية إن غابت عن الفاتورة أُعيدت وتأخر السداد.',max_length:1000})],approval_policy:HEAD},
  {code:'FIN-BUDGET-TRANSFER',req:['FIN-02','GOV-05'],section:'الميزانيات',department_id:'finance',name_ar:'مناقلة ميزانية',name_en:'Budget transfer',description:'نقل مبلغ بين بنود أو مراكز تكلفة بمبرر. لا يزيد إجمالي الميزانية.',fields:[
    t('from_line','من بند أو مركز',true,{why:'البند المأخوذ منه يُفحص رصيده والتزاماته القائمة قبل السحب منه.'}),
    t('to_line','إلى بند أو مركز',true,{why:'البند المستفيد يحدد من يملك القرار على المبلغ بعد نقله.'}),
    num('amount','المبلغ بالريال',true,{why:'المبلغ هو موضوع القرار، ويُقارن بالمتاح في البند المصدر.'}),
    long('justification','المبرر',true,{why:'المناقلة تعني أن تقدير الميزانية تغيّر؛ المبرر يوضح ما الذي تغيّر ولماذا لا ينتظر.',hint:'ما الذي لن يُنفَّذ في البند المصدر، وما الذي سيُنفَّذ في البند المستفيد.',min_length:10})],approval_policy:HEAD},
  {code:'FIN-COLLECTION-FOLLOWUP',req:['FIN-03','FIN-04'],section:'الفوترة والتحصيل',department_id:'finance',name_ar:'متابعة تحصيل متأخر',name_en:'Overdue collection follow-up',description:'تصعيد فاتورة متأخرة السداد لخطة تحصيل موثقة. المنصة لا تراسل العميل.',fields:[
    t('client','العميل',true,{why:'العميل يحدد مدير الحساب الذي يُشرك في خطة التحصيل.'}),
    t('invoice','رقم الفاتورة',true,{why:'رقم الفاتورة يربط المتابعة بسجل المستحقات بدل وصف عام.',max_length:60}),
    num('amount','المبلغ المتأخر بالريال',true,{why:'حجم المبلغ يحدد مستوى التصعيد ومن يتواصل مع العميل.'}),
    num('days_overdue','أيام التأخر',true,{why:'مدة التأخر تحدد نبرة المتابعة، وتُقرأ مع تاريخ تعامل العميل.'}),
    long('history','التواصل السابق',true,{why:'ما قيل للعميل وما وعد به يمنع رسائل متناقضة من أكثر من شخص.',hint:'من تواصل، ومتى، وبماذا رد العميل.',min_length:5})],approval_policy:HEAD},
  // المشتريات
  {code:'PRC-PURCHASE-REQUEST',req:['PRC-01','PRC-03'],section:'طلبات الشراء',department_id:'procurement',name_ar:'طلب شراء',name_en:'Purchase request',description:'احتياج شراء بمواصفات وكمية وميزانية. تُطلب العروض بعد الاعتماد؛ الاعتماد لا يصدر أمر شراء.',fields:[
    long('items','الأصناف أو الخدمة والمواصفات',true,{why:'المواصفات هي ما تُطلب عليه العروض؛ غموضها ينتج عروضًا لا تُقارن.',hint:'صنف وكمية ومواصفة في كل سطر، أو نطاق الخدمة ومخرجاتها.',example:'طباعة كتيّب 24 صفحة — 500 نسخة — ورق مطفي',min_length:5}),
    num('estimated_cost','التكلفة التقديرية بالريال',true,{why:'التقدير يحدد مسار الشراء ومستوى الاعتماد، ويُقارن بالمخصص المتاح.'}),
    t('project','المشروع أو مركز التكلفة',true,{why:'يحدد أي ميزانية يُحجز منها المبلغ عند الاعتماد.'}),
    day('needed_by','مطلوب قبل',true,{why:'الموعد يحدد هل يتسع الوقت لجمع عروض منافسة أم لا.'}),
    t('suggested_vendor','مورد مقترح',false,{why:'اقتراحك يُضاف إلى قائمة العروض ولا يلزم المشتريات؛ اذكر علاقتك بالمورد إن وُجدت.'})],approval_policy:MANAGER_HEAD},
  {code:'PRC-VENDOR-REGISTRATION',req:['PRC-02','PRC-10'],section:'الموردون',department_id:'procurement',name_ar:'تسجيل مورد جديد',name_en:'New vendor registration',description:'ترشيح مورد للتسجيل. التحقق من السجل التجاري والضريبي والتأهيل يجريه فريق المشتريات يدويًا؛ المنصة لا تتصل بجهة رسمية.',fields:[
    t('vendor_name','اسم المورد',true,{why:'الاسم كما في السجل التجاري هو ما تُطابق به الفواتير والعقود لاحقًا.'}),
    t('commercial_registration','رقم السجل التجاري',true,{why:'يُتحقق به من وجود المنشأة ونشاطها قبل التعامل معها.',max_length:40}),
    t('vat_number','الرقم الضريبي',true,{why:'فواتير مورد بلا رقم ضريبي صحيح لا تُقبل، فيُتحقق منه قبل أول تعامل.',max_length:40}),
    pick('category','الفئة',['إنتاج','طباعة','تقنية','فعاليات','مؤثرون','خدمات عامة','أخرى'],true,{why:'الفئة تحدد من يقيّم المورد فنيًا ومتى يظهر في ترشيحات العروض.'}),
    long('evaluation','سبب الترشيح وتقييم أولي',true,{why:'سبب الترشيح يميّز الحاجة الحقيقية عن المعرفة الشخصية؛ اذكر أي علاقة لك بالمورد.',hint:'أعمال سابقة رأيتها له، ولماذا لا يكفي الموردون المسجلون.',min_length:10})],approval_policy:HEAD},
  // القانونية
  {code:'LEG-CONTRACT-REVIEW',req:['LEG-01','LEG-02'],section:'العقود والاتفاقيات',department_id:'grc',name_ar:'مراجعة عقد',name_en:'Contract review',description:'مراجعة عقد عميل أو مورد قبل التوقيع. أرفق المسودة. المراجعة رأي داخلي ولا تعني توقيعًا ولا إرسالًا للطرف الآخر.',fields:[
    t('counterparty','الطرف الآخر',true,{why:'اسم الطرف يُفحص به تضارب المصالح والعقود السابقة معه.'}),
    pick('contract_type','نوع العقد',['عقد عميل','عقد مورد','عقد مؤثر','عقد عمل','شراكة','أخرى'],true,{why:'نوع العقد يحدد القالب المرجعي والبنود التي تُفحص أولًا.'}),
    pick('draft_source','مصدر المسودة',['قالب الشركة','مسودة الطرف الآخر','مسودة مشتركة معدّلة'],true,{why:'مسودة الطرف الآخر تُراجع بندًا بندًا، وقالب الشركة تُراجع تعديلاته فقط؛ الفرق في الجهد كبير.'}),
    num('value','قيمة العقد بالريال',false,{why:'القيمة تحدد مستوى التفويض بالتوقيع وعمق المراجعة.'}),
    day('signing_target','موعد التوقيع المستهدف',true,{why:'الموعد يرتب المراجعة مع غيرها؛ ومسودة تصل قبل التوقيع بيوم تُراجع على عجل.'}),
    long('key_points','نقاط تحتاج انتباه',true,{why:'ما اتُّفق عليه شفهيًا ولم يُكتب، وما تتوجس منه، هو ما لا يراه المراجع من النص وحده.',hint:'شروط الدفع، الملكية الفكرية، الحصرية، الغرامات، أو أي وعد قُدِّم للطرف الآخر.',min_length:10})],approval_policy:HEAD},
  {code:'LEG-NDA',req:['LEG-02'],section:'العقود والاتفاقيات',department_id:'grc',name_ar:'اتفاقية عدم إفصاح',name_en:'Non-disclosure agreement',description:'إعداد أو مراجعة اتفاقية سرية. الطلب لا يوقّع الاتفاقية ولا يرسلها.',fields:[
    t('counterparty','الطرف الآخر',true,{why:'الاسم القانوني للطرف هو ما يُكتب في الاتفاقية ويُلزم بها.'}),
    pick('direction','الاتجاه',['متبادلة','من طرفنا','من الطرف الآخر'],true,{why:'من يفصح لمن يحدد أي الطرفين تحميه الاتفاقية وأي قالب يُستخدم.'}),
    long('purpose','غرض الإفصاح',true,{why:'الغرض يحدّ نطاق ما يُعد سريًا؛ الغرض الواسع يقيّد الشركة أكثر مما يحميها.',example:'مناقشة عرض حملة إطلاق منتج لم يُعلن',min_length:5}),
    num('duration_years','المدة بالسنوات',true,{why:'المدة التزام يبقى بعد انتهاء العمل؛ تُكتب كما اتُّفق عليها لا تقديرًا.'})],approval_policy:HEAD},
  {code:'LEG-CONSULTATION',req:['LEG-09'],section:'الاستشارات',department_id:'grc',name_ar:'استشارة قانونية',name_en:'Legal consultation',description:'سؤال قانوني أو تنظيمي داخلي. الجواب رأي داخلي وليس فتوى من جهة رسمية.',fields:[
    t('topic','الموضوع',true,{why:'الموضوع يوجّه السؤال إلى صاحب الاختصاص ويُسترجع به لاحقًا.'}),
    long('question','السؤال والسياق',true,{why:'الجواب القانوني يتغير بتغير الوقائع؛ سؤال بلا سياق ينتج جوابًا عامًا لا يُبنى عليه.',hint:'ما القرار الذي تريد اتخاذه، وما الوقائع، وما الذي فعلته حتى الآن.',min_length:10}),
    urgency],approval_policy:HEAD},
  {code:'LEG-PRIVACY-REQUEST',req:['LEG-05','LEG-07'],section:'الخصوصية والامتثال',department_id:'grc',name_ar:'طلب يتعلق بالبيانات الشخصية',name_en:'Personal data request',description:'طلب صاحب بيانات، نقل خارجي، أو مشاركة بيانات. يُعالج داخليًا؛ المنصة لا تخاطب جهة رقابية ولا تحسب مهلة نظامية.',fields:[
    pick('request_type','نوع الطلب',['وصول صاحب البيانات','تصحيح أو حذف','نقل بيانات خارج المملكة','مشاركة مع طرف ثالث','تقييم أثر'],true,{why:'نوع الطلب يحدد الإجراء الواجب ومن يشارك فيه.'}),
    long('description','الوصف',true,{why:'فئة البيانات والغرض والمستلم هي ما يُبنى عليه الحكم بالجواز.',hint:'أي بيانات، ولمن، ولأي غرض. صف البيانات ولا تلصقها هنا.',min_length:10}),
    day('deadline','الموعد النظامي',false,{why:'إن كان للطلب مهلة في سند تعرفه فهي ترتب أولويته.',hint:'اكتبه فقط إن كنت تعرفه من سند؛ لا تقدّره، وسيحدده فريق الالتزام.'})],approval_policy:HEAD},
  {code:'LEG-IP-RIGHTS',req:['LEG-03','CRT-07'],section:'الملكية الفكرية',department_id:'grc',name_ar:'حقوق ملكية فكرية أو علامة',name_en:'IP rights or trademark',description:'تسجيل علامة، التحقق من حقوق استخدام أصل، أو اعتراض. الطلب لا يودع شيئًا لدى جهة رسمية.',fields:[
    pick('request','نوع الطلب',['تسجيل علامة','التحقق من حقوق أصل','اعتراض على استخدام','ترخيص استخدام'],true,{why:'نوع الطلب يحدد الإجراء ومن يلزم إشراكه من العميل أو المورد.'}),
    t('asset','الأصل أو العلامة',true,{why:'تحديد الأصل بدقة هو ما يُفحص عليه: صورة أو خط أو موسيقى أو اسم.',example:'مقطع موسيقي في فيديو حملة عميل تجريبي'}),
    long('details','التفاصيل',true,{why:'مصدر الأصل ومكان استخدامه ومدته هي ما يحدد هل الترخيص القائم يكفي.',hint:'من أين جاء الأصل، وأين سيُستخدم، ولأي مدة.',min_length:10})],approval_policy:HEAD},
  {code:'LEG-WHISTLEBLOW',req:['LEG-08','GOV-10'],section:'البلاغات والنزاعات',department_id:'grc',name_ar:'بلاغ مخالفة أو نزاع',name_en:'Misconduct or dispute report',description:'بلاغ مخالفة نظامية أو نزاع مع طرف خارجي. يصل إلى إدارة الحوكمة والالتزام مباشرة دون المرور بمديرك. الطلب يحمل اسمك؛ المنصة لا توفر بلاغًا مجهول الهوية.',fields:[
    pick('category','التصنيف',['مخالفة نظامية','احتيال','تضارب مصالح','نزاع مع عميل','نزاع مع مورد'],true,{why:'التصنيف يحدد من يتولى الفحص ومن يُستبعد منه.'}),
    long('description','الوصف والأدلة',true,{why:'الوقائع القابلة للتحقق هي ما يُفتح عليه فحص؛ الشك وحده لا يكفي لإجراء.',hint:'ماذا حدث ومتى ومن يعلم به، وأين توجد الأدلة.',min_length:10}),
    urgency],approval_policy:HEAD},
  {code:'LEG-LICENSE-PERMIT',req:['LEG-04'],section:'التراخيص والتصاريح',department_id:'grc',name_ar:'ترخيص أو تصريح حكومي',name_en:'Government license or permit',description:'تصريح تصوير أو فعالية أو ترخيص نشاط قبل الموعد. الطلب داخلي؛ التقديم لدى الجهة يجريه الفريق المختص خارج المنصة.',fields:[
    pick('permit','نوع التصريح',['تصريح تصوير','تصريح فعالية','ترخيص إعلامي','تجديد سجل','أخرى'],true,{why:'نوع التصريح يحدد الجهة ومتطلبات التقديم.'}),
    t('authority','الجهة الحكومية',true,{why:'الجهة تحدد قناة التقديم ومن يملك التفويض بمراجعتها.'}),
    day('needed_by','مطلوب قبل',true,{why:'موعد الحاجة يُقارن بما تستغرقه الجهة عادة؛ وعليه يُقرر المضي أو تعديل موعد العمل.'}),
    long('details','التفاصيل',true,{why:'الموقع والتاريخ وطبيعة العمل هي بيانات نموذج التقديم نفسه.',hint:'الموقع والتاريخ وعدد الطاقم وطبيعة المحتوى والعميل.',min_length:10})],approval_policy:HEAD},
  // التواصل الداخلي
  {code:'EXP-ANNOUNCEMENT',req:['EXP-01'],section:'التواصل الداخلي',department_id:'comms',name_ar:'نشر تعميم داخلي',name_en:'Internal announcement',description:'تعميم أو خبر داخلي يراجع لغويًا ويعتمد قبل النشر. النشر يجريه فريق التواصل بعد الاعتماد.',fields:[
    t('title','عنوان التعميم',true,{why:'العنوان هو ما يُقرأ فعلًا؛ به يقرر الموظف فتح التعميم أو تجاوزه.',max_length:120}),
    pick('audience','الجمهور',['جميع الموظفين','إدارة محددة','المديرون'],true,{why:'الجمهور يحدد قناة النشر ونبرة النص.'}),
    long('body','النص',true,{why:'ما يُعتمد هو النص نفسه؛ التعميم يُقرأ كأنه موقف الشركة.',hint:'ما المطلوب من القارئ، ومتى، ومن يسأل.',min_length:10}),
    day('publish_date','تاريخ النشر',true,{why:'تاريخ النشر ينسَّق مع بقية الرسائل حتى لا تتزاحم في يوم واحد.'})],approval_policy:MANAGER_HEAD},
  {code:'EXP-SURVEY',req:['EXP-02'],section:'صوت الموظف',department_id:'comms',name_ar:'إطلاق استبيان',name_en:'Survey launch',description:'استبيان رضا أو نبض أو تقييم فعالية.',fields:[
    t('title','عنوان الاستبيان',true,{why:'العنوان يعرّف المشاركين بموضوع الاستبيان قبل فتحه.',max_length:120}),
    pick('audience','الجمهور',['جميع الموظفين','إدارة محددة','حضور فعالية'],true,{why:'حجم الجمهور يحدد هل تبقى الإجابات غير قابلة للتعرف على أصحابها.'}),
    long('questions','الأسئلة',true,{why:'الأسئلة تُراجع قبل الإطلاق: سؤال موجِّه أو مزدوج يفسد النتيجة كلها.',hint:'سؤال في كل سطر مع نوع الإجابة.',min_length:10}),
    day('close_date','تاريخ الإغلاق',true,{why:'مدة الاستبيان تحدد التذكيرات ومتى تُقرأ النتائج.'}),
    pick('anonymous','سرية الإجابات',['مجهول الهوية','باسم الموظف'],true,{why:'الوعد بالسرية التزام؛ يُحدد قبل الإطلاق ولا يُغيَّر بعده.'})],approval_policy:HEAD},
  {code:'EXP-RECOGNITION',req:['EXP-04','EXP-05'],section:'اندماج الموظف',department_id:'comms',name_ar:'ترشيح موظف الشهر',name_en:'Employee of the month nomination',description:'ترشيح زميل مع قيمة من قيم الشركة وأثر ملموس.',fields:[
    t('nominee','اسم المرشح',true,{why:'الترشيح لشخص بعينه، ويُجمع مع ترشيحات غيرك له.'}),
    t('month','الشهر',true,{...MONTH,why:'الترشيحات تُقارن داخل الشهر الواحد.',example:'2026-03',max_length:7}),
    pick('value','القيمة',['الإبداع','الإنجاز','الجودة','الشمولية','الاعتزاز'],true,{why:'ربط الترشيح بقيمة يجعل التقدير رسالة عن السلوك المطلوب لا عن الشخص وحده.'}),
    long('impact','الأثر والأمثلة',true,{why:'اللجنة تفاضل بالأثر الملموس لا بعدد الترشيحات.',hint:'موقف محدد وما ترتب عليه.',example:'أعاد بناء تقرير العميل في يومين فقبل العميل تمديد العقد',min_length:10})],approval_policy:HEAD},
  {code:'EXP-SUGGESTION',req:['EXP-07'],section:'صوت الموظف',department_id:'comms',name_ar:'اقتراح تحسين',name_en:'Improvement suggestion',description:'فكرة لتحسين العمل أو بيئته. يُرد على كل اقتراح بقرار وسببه.',fields:[
    pick('area','المجال',['بيئة العمل','الإجراءات','الأنظمة','الخدمات','الثقافة'],true,{why:'المجال يوجّه الاقتراح إلى من يملك تنفيذه.'}),
    long('idea','الفكرة',true,{why:'الفكرة المحددة تُقيَّم؛ الأمنية العامة تُشكر ولا تُنفَّذ.',hint:'ما الذي يتغير بالضبط.',min_length:10}),
    long('benefit','الفائدة المتوقعة',true,{why:'الفائدة هي ما يُوازن بكلفة التنفيذ عند القرار.',hint:'وقت يُوفَّر، خطأ يُمنع، أو تجربة تتحسن.',min_length:5})],approval_policy:HEAD},
  {code:'EXP-INTERNAL-EVENT',req:['EXP-03'],section:'اندماج الموظف',department_id:'comms',name_ar:'فعالية داخلية',name_en:'Internal event',description:'غداء شهري أو احتفال أو لقاء، بميزانية وقياس حضور. الاعتماد لا يحجز مكانًا ولا يشتري.',fields:[
    t('event','اسم الفعالية',true,{why:'الاسم يُعرَّف به الحدث في التقويم والدعوات.'}),
    day('date','التاريخ',true,{why:'التاريخ يُفحص مع مواعيد التسليم الكبرى والإجازات قبل تثبيته.'}),
    num('expected_attendance','الحضور المتوقع',true,{why:'العدد يحدد المكان والضيافة والتكلفة.'}),
    num('budget','الميزانية بالريال',false,{why:'تُذكر حين تكون للفعالية تكلفة، لتُقارن بمخصص الفعاليات.'}),
    long('plan','الخطة',true,{why:'الخطة تكشف ما يحتاج شراء أو حجزًا أو دعمًا تقنيًا قبل الموعد.',hint:'المكان والبرنامج ومن يتولى ماذا.',min_length:10})],approval_policy:MANAGER_HEAD},
  // العلاقات العامة والمؤثرون
  {code:'PR-MEDIA-REQUEST',req:['PR-03','PR-04','PR-05'],section:'الإعلام',department_id:'pr',name_ar:'بيان صحفي أو ظهور إعلامي',name_en:'Press release or media appearance',description:'بيان أو مقابلة أو ظهور إعلامي بمتحدث معتمد. الاعتماد داخلي؛ المنصة لا ترسل البيان لأي وسيلة.',fields:[
    pick('type','النوع',['بيان صحفي','مقابلة','ظهور إعلامي','رد على استفسار'],true,{why:'النوع يحدد التحضير المطلوب: نص يُراجع، أو متحدث يُجهَّز بأسئلة متوقعة.'}),
    pick('on_behalf','باسم من',['الشركة','عميل'],true,{why:'ما يصدر باسم عميل يحتاج موافقته الموثقة قبل النشر، وما يصدر باسم الشركة يحتاج موافقة قيادتها.'}),
    t('client','العميل',true,{show_when:{field:'on_behalf',equals:['عميل']},why:'اسم العميل يحدد من يوافق على الرسائل من جهته قبل أي ظهور.'}),
    t('outlet','الوسيلة الإعلامية',false,{why:'الوسيلة تحدد الجمهور والنبرة وما سبق أن نشرته عن الموضوع.'}),
    t('spokesperson','المتحدث',true,{why:'لا يتحدث باسم الجهة إلا من اعتُمد متحدثًا؛ تسميته هنا هي ما يُعتمد.'}),
    long('key_messages','الرسائل الرئيسية',true,{why:'الرسائل المعتمدة هي حدود ما يُقال؛ الخروج عنها أكثر ما يصنع الأزمات.',hint:'ثلاث رسائل على الأكثر، وما لا يُعلَّق عليه.',min_length:10}),
    day('date','التاريخ',true,{why:'التاريخ ينسَّق مع إعلانات العميل والشركة حتى لا يسبق خبرٌ خبرًا.'})],approval_policy:MANAGER_HEAD},
  {code:'PR-ISSUE-ALERT',req:['PR-07','PR-08'],section:'الرصد والأزمات',department_id:'pr',name_ar:'تنبيه قضية إعلامية',name_en:'Media issue alert',description:'محتوى سلبي أو أزمة محتملة تحتاج استجابة سريعة. المنصة لا ترصد الإعلام بنفسها؛ التنبيه يدخله من لاحظه.',fields:[
    t('source','المصدر أو الرابط',true,{why:'الرابط يتيح للفريق رؤية المحتوى نفسه وحجم انتشاره بدل وصفه.',max_length:500}),
    t('about','الجهة المعنية',true,{why:'قضية تمس عميلًا يُبلَّغ بها مدير حسابه فورًا، وما يمس الشركة يُرفع لقيادتها.',example:'عميل تجريبي — حملة الإطلاق'}),
    long('summary','ملخص القضية',true,{why:'الملخص يحدد هل هي شكوى فردية أم موجة تتسع، وعليه تُقرر الاستجابة أو الصمت.',hint:'ما الذي قيل، ومن قاله، وكم انتشر حتى الآن.',min_length:10}),
    pick('severity','الخطورة',['عالية','متوسطة','منخفضة'],true,{why:'تقديرك الأولي يرتب التنبيه بين غيره، ويعيد الفريق تقديره بعد الاطلاع.'})],approval_policy:HEAD},
  {code:'INF-CAMPAIGN',req:['INF-02','INF-03'],section:'المؤثرون',department_id:'pr',name_ar:'حملة مؤثرين',name_en:'Influencer campaign',description:'اختيار مؤثرين لحملة. التحقق من الترخيص والإفصاح الإعلاني يجريه الفريق يدويًا؛ المنصة لا تتصل بأي سجل تراخيص.',fields:[
    t('client','العميل أو الحملة',true,{why:'الحملة تُربط بعميلها، وبه تُعرف الفئات والأسماء التي لا يقبل الارتباط بها.'}),
    long('objective','الهدف والجمهور',true,{why:'الهدف والجمهور هما معيار اختيار المؤثر؛ عدد المتابعين وحده لا يكفي.',hint:'ماذا تريد أن يفعل الجمهور، ومن هو.',min_length:10}),
    num('influencers','عدد المؤثرين',true,{why:'العدد يحدد توزيع الميزانية وحجم العمل التعاقدي والمتابعة.'}),
    num('budget','الميزانية بالريال',true,{why:'الميزانية المعتمدة هي سقف التفاوض مع المؤثرين.'}),
    day('start_date','بداية الحملة',true,{why:'البداية تحدد المهلة المتاحة للتعاقد واعتماد المحتوى قبل النشر.'}),
    pick('license_check','التحقق من ترخيص موثوق',['مطلوب','تم التحقق'],true,{why:'الحالة هنا تحدد هل يبدأ الفريق بالتحقق من الترخيص قبل أي تفاوض، أم يمضي إلى العروض مباشرة.'})],approval_policy:HEAD},
  // التسويق الرقمي
  {code:'DIG-CAMPAIGN',req:['DIG-03','DIG-05'],section:'الحملات والشراء الإعلامي',department_id:'marketing',name_ar:'حملة رقمية أو شراء إعلامي',name_en:'Digital campaign or media buying',description:'حملة مدفوعة بمنصات وميزانية ومؤشرات قياس. الاعتماد لا يطلق إعلانًا ولا ينفق من أي حساب إعلاني.',fields:[
    t('client','العميل',true,{why:'الحملة تُنفق من ميزانية عميل بعينه وتُحاسب عليها أمامه.'}),
    t('platforms','المنصات',true,{why:'المنصات تحدد الحسابات الإعلانية المطلوبة ومن يملك الوصول إليها.',example:'منصتا فيديو قصير وبحث مدفوع'}),
    num('budget','الميزانية بالريال',true,{why:'الميزانية المعتمدة سقف الإنفاق؛ تجاوزها يحتاج طلب تعديل مستقل.'}),
    day('start_date','البداية',true,{why:'البداية تحدد موعد جاهزية المواد الإبداعية والتتبع.'}),
    day('end_date','النهاية',true,{why:'النهاية تحدد متى تُوقف الإعلانات ويُطابق الإنفاق.'}),
    long('kpis','مؤشرات النجاح',true,{why:'المؤشر المتفق عليه قبل الإطلاق هو ما يُحكم به على الحملة، لا ما يبدو جيدًا بعدها.',hint:'مؤشر ومستهدفه ومصدر قياسه.',example:'تكلفة التسجيل الواحد — المصدر: لوحة المنصة مع وسوم الحملة',min_length:10})],approval_policy:HEAD},
  {code:'DIG-SOCIAL-POST',req:['DIG-02'],section:'المنصات الاجتماعية',department_id:'marketing',name_ar:'جدولة نشر على المنصات',name_en:'Social media scheduling',description:'منشورات لحسابات الشركة أو العميل بعد اعتماد المحتوى. المنصة لا تنشر على أي حساب؛ النشر يجريه الفريق يدويًا.',fields:[
    t('account','الحساب',true,{why:'الحساب يحدد من يملك النشر عليه ومن يجب أن يوافق على المحتوى.',example:'حساب عميل تجريبي على منصة الصور'}),
    long('content','المحتوى أو الرابط',true,{why:'ما يُعتمد هو النص والمادة النهائيان، لا فكرتهما.',hint:'النص النهائي ورابط المادة المعتمدة.',min_length:5}),
    pick('client_approved','موافقة العميل على المحتوى',['موثقة','غير مطلوبة — حساب الشركة','لم تصل بعد'],true,{why:'النشر على حساب عميل دون موافقته الموثقة خطأ لا يُسترد بعد وقوعه.'}),
    day('publish_date','تاريخ النشر',true,{why:'التاريخ يُفحص مع تقويم المحتوى حتى لا تتزاحم المنشورات.'}),
    t('publish_time','وقت النشر',true,{pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',pattern_message:'اكتب الوقت بأربع خانات على مدار 24 ساعة، مثل 20:30',why:'وقت النشر يؤثر في الوصول، ويحدد متى يكون الفريق حاضرًا للرد.',example:'20:30'})],approval_policy:HEAD},
  {code:'DIG-PERFORMANCE-REPORT',req:['DIG-09','DAT-03'],section:'القياس والتقارير',department_id:'marketing',name_ar:'تقرير أداء حملة',name_en:'Campaign performance report',description:'تقرير نتائج حملة من مصادر القياس بتاريخ ومصدر. الأرقام تُدخل يدويًا من لوحات المنصات؛ لا ربط آلي بها.',fields:[
    t('campaign','الحملة',true,{why:'التقرير يُبنى على حملة بعينها وأهدافها المعتمدة.'}),
    t('period','الفترة',true,{why:'الفترة تحدد نطاق الأرقام؛ اختلافها بين تقريرين أكثر ما يفسد المقارنة.',example:'2026-03-01 إلى 2026-03-31'}),
    pick('for_whom','لمن التقرير',['العميل','داخلي'],true,{why:'تقرير العميل يمر بمراجعة مستقلة للأرقام قبل إرساله، والداخلي لا.'}),
    long('metrics','المؤشرات المطلوبة',true,{why:'المؤشرات المطلوبة تحدد المصادر التي تُسحب منها الأرقام.',hint:'المؤشرات المتفق عليها عند إطلاق الحملة أولًا.',min_length:5}),
    day('due_date','موعد التسليم',true,{why:'الموعد يُقارن بتاريخ اكتمال البيانات في المنصات.'})],approval_policy:HEAD},
  // الإنتاج والفعاليات
  {code:'PRO-SHOOT',req:['PRO-01','PRO-02'],section:'التصوير والإنتاج',department_id:'production',name_ar:'تصوير أو إنتاج مرئي',name_en:'Photo or video production',description:'تصوير أو فيديو بخطة موقع وطاقم وتصاريح. التصريح والموقع والطاقم تُطلب بخدماتها المستقلة.',fields:[
    pick('type','النوع',['تصوير فوتوغرافي','فيديو','موشن جرافيك','بث مباشر'],true,{why:'النوع يحدد الطاقم والمعدات وزمن ما بعد الإنتاج.'}),
    t('client','العميل أو المشروع',true,{why:'الإنتاج يُحمَّل على مشروع، وبه تُعرف ميزانيته والموافقات اللازمة.'}),
    t('location','الموقع',true,{why:'الموقع يحدد هل يلزم تصريح تصوير وما المعدات الممكن نقلها.'}),
    day('shoot_date','تاريخ التصوير',true,{why:'التاريخ يُفحص مع حجز المعدات والطاقم والمهلة اللازمة للتصاريح.'}),
    num('budget','الميزانية بالريال',false,{why:'الميزانية تحدد حجم الطاقم وما يُنفَّذ داخليًا وما يُسند لمستقلين.'}),
    long('brief','الموجز',true,{why:'الموجز يُبنى عليه جدول التصوير وقائمة اللقطات؛ نقصه يعني يوم تصوير إضافيًا.',hint:'المخرج النهائي ومدته وأين يُعرض، ومن يظهر فيه.',min_length:10})],approval_policy:HEAD},
  {code:'PRO-EVENT',req:['PRO-08'],section:'الفعاليات',department_id:'production',name_ar:'تنظيم فعالية لعميل',name_en:'Client event',description:'فعالية بموقع وموردين وخطة سلامة وتصاريح. الاعتماد لا يحجز موقعًا ولا يتعاقد مع مورد.',fields:[
    t('client','العميل',true,{why:'الفعالية تُنفذ على عقد عميل بعينه وتُحاسب عليه.'}),
    t('event','الفعالية',true,{why:'الاسم والطبيعة يحددان التصاريح والموردين المطلوبين.'}),
    day('event_date','التاريخ',true,{why:'التاريخ يُقارن بمهل التصاريح وتوفر الموردين قبل الالتزام أمام العميل.'}),
    t('venue','الموقع',true,{why:'الموقع يحدد السعة ومتطلبات السلامة والتصاريح.'}),
    num('attendance','الحضور المتوقع',true,{why:'العدد يحدد خطة السلامة والضيافة والطاقم.'}),
    num('budget','الميزانية بالريال',true,{why:'الميزانية المعتمدة من العميل هي سقف التعاقد مع الموردين.'}),
    long('scope','النطاق',true,{why:'ما يقع على الشركة وما يقع على العميل يُحسم هنا، لا يوم الفعالية.',hint:'ما الذي نتولاه وما الذي يتولاه العميل أو الموقع.',min_length:10})],approval_policy:HEAD},
  {code:'PRO-EQUIPMENT',req:['PRO-04'],section:'المعدات والمواقع',department_id:'production',name_ar:'حجز معدات إنتاج',name_en:'Production equipment booking',description:'كاميرات وإضاءة وصوت، مع تسليم واستلام موثق.',fields:[
    long('equipment','المعدات',true,{why:'القائمة المحددة تكشف التعارض مع حجز آخر، وما يحتاج استئجارًا خارجيًا.',hint:'قطعة في كل سطر مع الكمية.',min_length:3}),
    day('from_date','من تاريخ',true,{why:'بداية الحجز تشمل يوم الاستلام والتجهيز لا يوم التصوير وحده.'}),
    day('to_date','إلى تاريخ',true,{why:'الإرجاع في موعده يحرر المعدات للحجز التالي.'}),
    t('project','المشروع',true,{why:'المشروع يحدد من يتحمل العهدة وتكلفة أي تلف.'})],approval_policy:HEAD},
  // الإستراتيجية
  {code:'STR-RESEARCH',req:['STR-01','STR-02'],section:'البحث والتحليل',department_id:'business-dev',name_ar:'بحث أو تحليل سوق',name_en:'Research or market analysis',description:'بحث جمهور أو منافسين أو سوق بمنهجية ومصادر.',fields:[
    t('topic','الموضوع',true,{why:'الموضوع يحدد الباحث المناسب وما سبق بحثه فيه.'}),
    t('client','العميل أو المشروع',false,{why:'ربط البحث بعميل يحمّل جهده على مشروعه ويحدد سرية نتائجه.'}),
    long('questions','أسئلة البحث',true,{why:'البحث يجيب عن أسئلة؛ «ابحث في السوق» بلا سؤال ينتج تقريرًا لا يغيّر قرارًا.',hint:'القرار الذي ينتظر البحث، ثم الأسئلة التي تحسمه.',example:'هل ندخل العرض بباقة شهرية أم بمشروع واحد؟ ما الذي يدفعه المنافسون؟',min_length:10}),
    day('due_date','موعد التسليم',true,{why:'الموعد يحدد عمق البحث الممكن: مسح مكتبي أم مقابلات.'})],approval_policy:HEAD},
  {code:'STR-PITCH-SUPPORT',req:['STR-05','CRM-04'],section:'العروض والمنافسات',department_id:'business-dev',name_ar:'دعم عرض أو منافسة',name_en:'Pitch or tender support',description:'فكرة إستراتيجية وعرض لمنافسة أو عميل محتمل. الطلب لا يقدّم العرض للجهة.',fields:[
    t('opportunity','الفرصة',true,{why:'الفرصة تُربط بسجلها في المبيعات، وبه يُعرف تاريخ التواصل مع العميل.'}),
    day('submission_date','موعد التقديم',true,{why:'موعد التقديم لا يتحرك؛ عليه يُبنى الجدول العكسي للعمل كله.'}),
    long('requirements','متطلبات العرض',true,{why:'العرض يُقيَّم على ما طلبته الجهة؛ ما لا يُذكر هنا لا يُغطى.',hint:'ما تطلبه كراسة الشروط أو العميل، ومعايير التقييم إن أُعلنت.',min_length:10}),
    num('value','القيمة المتوقعة بالريال',false,{why:'القيمة تحدد حجم الجهد المبرر استثماره في العرض.'})],approval_policy:HEAD},
  // النمو والحسابات
  {code:'CRM-OPPORTUNITY',req:['CRM-01','CRM-02','CRM-03'],section:'المبيعات والفرص',department_id:'business-dev',name_ar:'تسجيل فرصة أو منافسة',name_en:'Opportunity or tender registration',description:'فرصة بيع أو منافسة حكومية بمرحلة وقيمة وتاريخ.',fields:[
    t('client','العميل',true,{why:'اسم العميل يكشف هل الفرصة مسجلة من زميل آخر، ومن يملك العلاقة.'}),
    pick('source','المصدر',['منافسة حكومية','عميل حالي','إحالة','تواصل مباشر','أخرى'],true,{why:'المصدر يحدد مسار العمل، ويُقاس به أي القنوات تجلب عملًا فعليًا.'}),
    num('value','القيمة المتوقعة بالريال',true,{why:'القيمة تدخل في توقعات المبيعات وترتب الأولوية بين الفرص.',hint:'تقدير واقعي؛ يُصحَّح حين يتضح النطاق.'}),
    day('deadline','الموعد النهائي',true,{why:'الموعد النهائي يحدد هل يتسع الوقت لعرض جاد أم يُعتذر عن الفرصة.'}),
    long('scope','النطاق',true,{why:'النطاق يحدد الإدارات التي تُشرك في قرار المضي.',min_length:10})],approval_policy:HEAD},
  {code:'ACC-CLIENT-COMPLAINT',req:['ACC-05','ACC-09'],section:'إدارة الحسابات',department_id:'accounts',name_ar:'شكوى أو ملاحظة عميل',name_en:'Client complaint',description:'تسجيل شكوى عميل ومسار معالجتها وإغلاقها بدليل.',fields:[
    t('client','العميل',true,{why:'الشكوى تُقرأ مع تاريخ العميل: أولى أم متكررة.'}),
    t('project','المشروع',true,{why:'المشروع يحدد الفريق المعني بالمعالجة.'}),
    pick('severity','الخطورة',['عالية','متوسطة','منخفضة'],true,{why:'الخطورة تحدد من يُبلَّغ ومن يتواصل مع العميل.'}),
    long('complaint','الشكوى',true,{why:'نص العميل كما قاله هو المرجع؛ إعادة صياغته تخفف ما يجب أن يُسمع.',hint:'ما قاله العميل، ومتى، وعبر أي قناة.',min_length:10}),
    long('proposed_action','الإجراء المقترح',false,{why:'اقتراحك يسرّع القرار، لكن غيابه لا يؤخر تسجيل الشكوى.'})],approval_policy:HEAD},
  {code:'ACC-CHANGE-REQUEST',req:['ACC-03','ACC-06'],section:'إدارة الحسابات',department_id:'accounts',name_ar:'طلب تغيير من عميل',name_en:'Client change request',description:'تغيير نطاق أو موعد بطلب العميل مع أثر مالي وزمني. الاعتماد داخلي ولا يعدّل العقد مع العميل.',fields:[
    t('client','العميل',true,{why:'التغيير يُقاس على عقد عميل بعينه.'}),
    t('project','المشروع',true,{why:'المشروع يحدد النطاق المعتمد الذي يُقاس عليه التغيير.'}),
    long('change','التغيير المطلوب',true,{why:'الفرق بين ما في العقد وما يُطلب الآن هو موضوع القرار.',hint:'ما الذي يُضاف أو يُحذف أو يُؤجل، كما طلبه العميل.',min_length:10}),
    day('requested_for','مطلوب تنفيذه قبل',true,{why:'الموعد يحدد هل يُستوعب التغيير في الخطة أم يزيح غيره.'}),
    num('cost_impact','الأثر المالي بالريال',false,{why:'تقديرك يحدد هل يُنفَّذ التغيير ضمن العقد أم يحتاج ملحقًا وفوترة.'}),
    num('days_impact','الأثر الزمني بالأيام',false,{why:'الأثر على موعد التسليم يُبلَّغ للعميل قبل القبول لا بعد التأخر.'})],approval_policy:HEAD},
  // مكتب المشاريع
  {code:'PMO-NEW-PROJECT',req:['PMO-01','PMO-02'],section:'دورة المشروع',department_id:'epmo',name_ar:'طلب فتح مشروع',name_en:'Project initiation',description:'فتح مشروع بعد عقد أو اعتماد داخلي، بمدير وميزانية وجدول.',fields:[
    t('project','اسم المشروع',true,{why:'الاسم هو ما تُسجَّل عليه الساعات والمصروفات والفواتير طوال عمر المشروع.'}),
    t('client','العميل',true,{why:'العميل يربط المشروع بعقده وفريق حسابه.',hint:'اكتب «داخلي» إن لم يكن لعميل.'}),
    t('basis','سند الفتح',true,{why:'المشروع لا يُفتح على وعد؛ السند يثبت أن هناك التزامًا يُعمل عليه.',example:'عقد موقّع رقم تجريبي، أو قرار داخلي بتاريخه'}),
    t('project_manager','مدير المشروع المقترح',true,{why:'لكل مشروع مسؤول واحد مسمى؛ حمله الحالي يُفحص قبل الإسناد.'}),
    num('budget','الميزانية بالريال',true,{why:'الميزانية المعتمدة هي ما تُقاس عليه الربحية ويُوقف عنده الصرف.'}),
    day('start_date','البداية',true,{why:'البداية تفتح تسجيل الساعات وحجز الموارد.'}),
    day('end_date','النهاية',true,{why:'النهاية المتفق عليها مع العميل هي ما يُقاس عليه التأخر.'}),
    long('scope','النطاق والمخرجات',true,{why:'النطاق المكتوب هو ما يُرفض به العمل الزائد لاحقًا أو يُسعَّر.',hint:'المخرجات المحددة، وما هو خارج النطاق صراحة.',min_length:10})],approval_policy:MANAGER_HEAD},
  {code:'PMO-RESOURCE',req:['PMO-04','PMO-05'],section:'الموارد والطاقة',department_id:'epmo',name_ar:'طلب موارد لمشروع',name_en:'Project resource request',description:'تكليف موظف أو مستقل أو ساعات من إدارة أخرى.',fields:[
    t('project','المشروع',true,{why:'الساعات المطلوبة تُحمَّل على ميزانية هذا المشروع.'}),
    t('role','الدور المطلوب',true,{why:'الدور لا الاسم: مكتب المشاريع يرشح من تتسع سعته.',example:'مصمم حركة'}),
    num('hours','عدد الساعات',true,{why:'الساعات تُقارن بسعة الفريق المتاحة في الفترة.',hint:'بالساعات؛ يوم العمل الكامل اكتبه بساعاته.'}),
    day('from_date','من تاريخ',true,{why:'الفترة تحدد مع من يتعارض الحجز.'}),
    day('to_date','إلى تاريخ',true,{why:'نهاية الحجز تحرر المورد لمشروع آخر.'}),
    long('justification','المبرر',true,{why:'المبرر يرجّح بين مشروعين يطلبان المورد نفسه.',min_length:5})],approval_policy:MANAGER_HEAD},
  {code:'PMO-RISK-ISSUE',req:['PMO-08'],section:'المخاطر والتصعيد',department_id:'epmo',name_ar:'بلاغ خطر أو تأخر مشروع',name_en:'Project risk or delay',description:'خطر أو تأخر يحتاج قرارًا أو تصعيدًا.',fields:[
    t('project','المشروع',true,{why:'الخطر يُقرأ مع حالة المشروع وميزانيته وموعده.'}),
    pick('type','النوع',['تأخر','تجاوز ميزانية','خطر جودة','خطر علاقة عميل','مورد'],true,{why:'النوع يحدد من يملك القرار المطلوب.'}),
    long('description','الوصف والأثر',true,{why:'الأثر على الموعد أو المال أو العميل هو ما يبرر التصعيد.',hint:'ما الذي حدث، وما الذي سيحدث إن لم يُتخذ قرار.',min_length:10}),
    long('mitigation','خطة المعالجة',true,{why:'التصعيد مع خيار مقترح يُحسم في اجتماع؛ وبدونه يُعاد إليك.',hint:'ما القرار الذي تطلبه بالتحديد.',min_length:5})],approval_policy:HEAD},
  // الحوكمة
  {code:'GOV-DECISION',req:['GOV-03','GOV-04'],section:'القرارات والاجتماعات',department_id:'ceo-office',name_ar:'طلب قرار تنفيذي',name_en:'Executive decision request',description:'قرار يتجاوز صلاحية الإدارة، ويوثق في سجل القرارات.',fields:[
    t('subject','الموضوع',true,{why:'الموضوع هو عنوان القرار في السجل، وبه يُسترجع.',max_length:150}),
    long('options','الخيارات والتوصية',true,{why:'القيادة تختار بين خيارات بكلفتها؛ طلب بخيار واحد هو طلب توقيع لا قرار.',hint:'خياران على الأقل بكلفة كل منهما وأثره، ثم توصيتك.',min_length:20}),
    num('financial_impact','الأثر المالي بالريال',false,{why:'الأثر المالي يحدد مستوى التفويض اللازم.'}),
    day('decision_needed_by','مطلوب قبل',true,{why:'الموعد يحدد هل يُدرج في الاجتماع القادم أم يُحسم بالتمرير.'})],approval_policy:MANAGER_HEAD},
  {code:'GOV-RISK',req:['GOV-06'],section:'المخاطر والرقابة',department_id:'grc',name_ar:'تسجيل خطر مؤسسي',name_en:'Enterprise risk registration',description:'خطر بمالك واحتمال وأثر وخطة معالجة.',fields:[
    t('risk','الخطر',true,{why:'صياغة الخطر حدثًا وأثره تجعله قابلًا للمتابعة.',example:'اعتماد ثلث الإيراد على عميل واحد ينتهي عقده هذا العام'}),
    pick('likelihood','الاحتمال',['مرتفع','متوسط','منخفض'],true,{why:'الاحتمال مع الأثر يرتبان الخطر في السجل.'}),
    pick('impact','الأثر',['مرتفع','متوسط','منخفض'],true,{why:'الأثر يحدد مستوى من يتابع الخطر.'}),
    t('owner','المالك المقترح',true,{why:'خطر بلا مالك مسمى لا يعالجه أحد.'}),
    long('mitigation','خطة المعالجة',true,{why:'الخطة هي ما يُتابع دوريًا؛ الخطر المسجل بلا خطة مجرد قلق موثق.',min_length:10})],approval_policy:HEAD},
  {code:'GOV-CONFLICT-DISCLOSURE',req:['GOV-09'],section:'النزاهة والإفصاح',department_id:'grc',name_ar:'إفصاح عن تضارب مصالح',name_en:'Conflict of interest disclosure',description:'إفصاح سنوي أو عند نشوء تضارب مع عميل أو مورد. يصل إلى إدارة الحوكمة والالتزام دون المرور بمديرك.',fields:[
    pick('relation','نوع العلاقة',['قرابة','ملكية أو شراكة','عمل خارجي','هدية أو ضيافة','أخرى'],true,{why:'نوع العلاقة يحدد الإجراء: تنحٍّ عن قرار، أو إفصاح يُحفظ فقط.'}),
    t('party','الطرف ذو العلاقة',true,{why:'اسم الطرف يُقابَل بالموردين والعملاء والمرشحين الذين قد تؤثر في قرار يخصهم.'}),
    long('details','التفاصيل',true,{why:'طبيعة العلاقة والقرار الذي قد تمسه هما ما يُبنى عليه الإجراء.',hint:'ما العلاقة، وأي قرار في عملك قد يتأثر بها. لا حاجة لتفاصيل شخصية تتجاوز ذلك.',min_length:10})],approval_policy:HEAD},
  {code:'GOV-POLICY',req:['GOV-10'],section:'السياسات',department_id:'grc',name_ar:'اعتماد سياسة أو إجراء',name_en:'Policy or procedure approval',description:'سياسة جديدة أو تعديل إجراء بمالك وتاريخ مراجعة. أرفق النص الكامل.',fields:[
    t('title','عنوان السياسة',true,{why:'العنوان هو مرجع السياسة في السجل وفي كل إحالة إليها.',max_length:150}),
    pick('type','النوع',['سياسة جديدة','تعديل','إلغاء'],true,{why:'التعديل والإلغاء يستدعيان مراجعة ما بُني على النص القديم.'}),
    t('owner','مالك السياسة',true,{why:'لكل سياسة مالك يُسأل عن تطبيقها ومراجعتها.'}),
    long('summary','الملخص والتغييرات',true,{why:'المعتمِد يقرأ ما تغيّر ولماذا قبل النص الكامل.',hint:'ما الذي يتغير على الموظف عمليًا.',min_length:10}),
    day('review_date','موعد المراجعة القادمة',true,{why:'سياسة بلا موعد مراجعة تبقى سارية بعد أن يتجاوزها الواقع.'})],approval_policy:HEAD},
  {code:'GOV-OBJECTIVE',req:['GOV-01','GOV-07'],section:'الأهداف والمؤشرات',department_id:'epmo',name_ar:'اعتماد هدف أو مؤشر',name_en:'Objective or KPI approval',description:'هدف سنوي بمالك ومؤشر وخط أساس ومستهدف وموعد مراجعة.',fields:[
    t('objective','الهدف',true,{why:'الهدف نتيجة لا نشاط؛ صياغته تحدد ما يُعد نجاحًا.',example:'رفع نسبة تجديد عقود العملاء'}),
    t('kpi','المؤشر',true,{why:'المؤشر هو ما يُقاس فعلًا، فيجب أن يكون له مصدر بيانات قائم.'}),
    t('baseline','خط الأساس',true,{why:'بدون خط أساس لا يُعرف هل تحقق تحسن.',hint:'القيمة الحالية ومصدرها وتاريخها.'}),
    t('target','المستهدف',true,{why:'المستهدف هو ما يُحاسب عليه المالك عند المراجعة.'}),
    t('owner','المالك',true,{why:'هدف يملكه الجميع لا يملكه أحد.'}),
    day('review_date','موعد المراجعة',true,{why:'المراجعة الدورية هي ما يبقي الهدف حيًا بعد اعتماده.'}),
    long('rationale','لماذا هذا الهدف الآن',false,{why:'يربط الهدف بأولوية الشركة الحالية حين تتزاحم الأهداف.'})],approval_policy:HEAD},
  // البيانات
  {code:'DAT-DASHBOARD',req:['DAT-01','DAT-03'],section:'التقارير واللوحات',department_id:'campaigns-audit',name_ar:'طلب تقرير أو لوحة مؤشرات',name_en:'Report or dashboard request',description:'لوحة أو تقرير بمصدر بيانات محدد وتعريف لكل مؤشر.',fields:[
    t('title','العنوان',true,{why:'العنوان يكشف هل يوجد تقرير قائم يغني عن بناء جديد.'}),
    long('decision','القرار الذي يخدمه التقرير',true,{why:'تقرير لا يغيّر قرارًا عبء صيانة دائم؛ هذا السؤال يحسم هل يُبنى أصلًا.',hint:'من سيقرأه، وماذا سيفعل بما يراه.',min_length:10}),
    long('metrics','المؤشرات وتعريفها',true,{why:'التعريف المكتوب يمنع رقمين مختلفين للمؤشر نفسه في تقريرين.',hint:'مؤشر وصيغة حسابه في كل سطر.',min_length:10}),
    t('data_sources','مصادر البيانات',true,{why:'المصدر يحدد هل البيانات متاحة ومن يملك الإذن بها.'}),
    pick('frequency','التكرار',['مرة واحدة','أسبوعي','شهري','ربع سنوي'],true,{why:'التكرار يحدد جهد التحديث المستمر لا جهد البناء وحده.'})],approval_policy:HEAD},
  {code:'DAT-DATA-ACCESS',req:['LEG-05'],section:'حوكمة البيانات',department_id:'campaigns-audit',name_ar:'طلب وصول لبيانات',name_en:'Data access request',description:'وصول لمجموعة بيانات بتصنيف وغرض ومدة. المنح والسحب يجريهما مالك البيانات يدويًا.',fields:[
    t('dataset','مجموعة البيانات',true,{why:'تحديد المجموعة يحدد مالكها الذي يقرر.'}),
    pick('classification','التصنيف',['عام','داخلي','سري','بيانات شخصية'],true,{why:'التصنيف يحدد الضوابط المطلوبة قبل المنح.'}),
    long('purpose','الغرض',true,{why:'الوصول يُمنح لغرض محدد ولا يُستخدم لغيره.',hint:'ما التحليل أو العمل، وهل يكفي مستخرج مجمّع بدل البيانات الخام.',min_length:10}),
    day('access_until','تنتهي في',true,{why:'الوصول المؤقت لازم ينسحب في موعده، والوصول بلا نهاية يتراكم. المنصة للحين ما تسحبه بنفسها — السحب يدوي.'})],approval_policy:MANAGER_HEAD},
  {code:'DAT-AI-USE',req:['DAT-09'],section:'الذكاء الاصطناعي',department_id:'campaigns-audit',name_ar:'استخدام أداة ذكاء اصطناعي',name_en:'AI tool use request',description:'تقييم أداة أو حالة استخدام من حيث البيانات والخصوصية والجودة.',fields:[
    t('tool','الأداة',true,{why:'الأداة تُفحص شروط استخدامها وما تفعله بالبيانات المدخلة.'}),
    long('use_case','حالة الاستخدام',true,{why:'الخطر في الاستخدام لا في الأداة: صياغة مسودة غير تحليل بيانات عميل.',hint:'ما الذي يدخل الأداة، وما الذي يخرج، ومن يراجع المخرج قبل استخدامه.',min_length:10}),
    pick('data_type','نوع البيانات المستخدمة',['لا بيانات حساسة','بيانات داخلية','بيانات عملاء','بيانات شخصية'],true,{why:'نوع البيانات يحدد هل تكفي موافقة داخلية أم تلزم موافقة العميل أو تقييم خصوصية.'}),
    pick('client_facing','هل يصل المخرج إلى عميل',['نعم','لا'],true,{why:'ما يصل العميل يحتاج مراجعة بشرية موثقة وربما إفصاحًا وفق عقده.'})],approval_policy:HEAD}
  ,
  // استكمال الخدمات — الموارد البشرية
  {code:'HR-EXPERIENCE-CERT',req:['HR-05','HR-09'],section:'الشهادات والخطابات',department_id:'hr',name_ar:'شهادة خبرة',name_en:'Experience certificate',description:'شهادة خبرة لموظف حالي أو عند المغادرة. يعدّها فريق الموارد البشرية من سجلك الوظيفي؛ لا تصدر تلقائيًا.',fields:[
    pick('language','اللغة',['العربية','الإنجليزية'],true,{why:'اللغة تحدد نسخة الشهادة التي تُعدّ.'}),
    t('recipient','الجهة الموجه إليها',false,{why:'إن وُجّهت لجهة بعينها كُتب اسمها، وإلا صدرت «لمن يهمه الأمر».'}),
    long('notes','ملاحظات',false,{why:'إن طلبت الجهة ذكر مهام أو مشاريع بعينها فاذكرها، ويقرر الفريق ما يمكن إثباته من السجل.',max_length:1000})],approval_policy:{steps:['hr'],handler_role:'hr'}},
  {code:'HR-DOC-RENEWAL',req:['HR-10'],section:'البيانات والوثائق',department_id:'hr',name_ar:'تجديد إقامة أو رخصة',name_en:'Residency, work permit or visa renewal',description:'متابعة تجديد وثيقة نظامية قبل انتهائها. المتابعة داخلية؛ المنصة لا تتصل بأي منصة حكومية ولا تجدد شيئًا بنفسها.',fields:[
    pick('document','الوثيقة',['الإقامة','رخصة العمل','تأشيرة خروج وعودة','تأشيرة زيارة عائلية','أخرى'],true,{why:'نوع الوثيقة يحدد الإجراء ومن يتولاه.'}),
    day('expiry_date','تاريخ الانتهاء',true,{why:'تاريخ الانتهاء يرتب الطلب بين غيره؛ الأقرب انتهاء يُعالج أولًا.',hint:'كما يظهر في الوثيقة.'}),
    t('dependents','التابعون المشمولون',false,{why:'تجديد وثائق التابعين إجراء مستقل لكل منهم؛ ذكرهم يمنع تجديدًا ناقصًا.',hint:'صلة القرابة والعدد تكفي.',example:'الزوجة وطفلان'}),
    long('notes','ملاحظات',false,{why:'سفر قريب أو ظرف يغيّر ترتيب الأولوية.',max_length:1000})],approval_policy:{steps:['manager','hr'],handler_role:'hr'}},
  {code:'HR-BANK-CHANGE',req:['PAY-07'],section:'الرواتب والمزايا',department_id:'hr',name_ar:'تغيير حساب الراتب البنكي',name_en:'Salary bank account change',description:'تحديث الآيبان قبل مسير الشهر. أرفق شهادة الآيبان؛ يتحقق فريق الموارد البشرية من مطابقة الاسم. لا تكتب الآيبان كاملًا في الطلب.',fields:[
    t('bank','البنك',true,{why:'اسم البنك يُطابق بشهادة الآيبان المرفقة.'}),
    t('iban_last4','آخر 4 أرقام من الآيبان الجديد',true,{pattern:'^\\d{4}$',pattern_message:'اكتب أربعة أرقام فقط، هي آخر أربع خانات من الآيبان',max_length:4,why:'أربعة أرقام تكفي لمطابقة الطلب بالشهادة المرفقة؛ الآيبان الكامل لا يُكتب هنا حتى لا يبقى في سجل الطلبات.',example:'4821'}),
    day('effective_month','يطبق من تاريخ',true,{why:'التاريخ يحدد أي مسير يُحوَّل فيه الراتب إلى الحساب الجديد.'}),
    long('reason','سبب التغيير',true,{why:'تغيير حساب الراتب من أكثر مداخل الاحتيال؛ السبب يُقرأ مع التحقق من هويتك.',min_length:5})],approval_policy:{steps:['hr'],handler_role:'hr'}},
  {code:'HR-GOSI-CORRECTION',req:['PAY-02'],section:'الرواتب والمزايا',department_id:'hr',name_ar:'تصحيح بيانات التأمينات الاجتماعية',name_en:'GOSI record correction',description:'طلب تصحيح الأجر الخاضع أو تاريخ الاشتراك أو التصنيف. التصحيح لدى التأمينات يجريه فريق الموارد البشرية خارج المنصة.',fields:[
    pick('issue','نوع التصحيح',['الأجر الخاضع','تاريخ الاشتراك','التصنيف','بيانات شخصية'],true,{why:'نوع التصحيح يحدد المستند المطلوب والإجراء لدى الجهة.'}),
    day('effective_from','التصحيح يسري من',true,{why:'تاريخ السريان يحدد الأشهر التي تتأثر اشتراكاتها.'}),
    long('details','التفاصيل',true,{why:'الفرق بين المسجل والصحيح هو ما يُصحَّح.',hint:'ما المسجل حاليًا وما الصحيح.',min_length:5}),
    long('evidence','المستند الداعم',false,{why:'الجهة لا تقبل تصحيحًا بلا مستند؛ تسميته هنا توضح ما أُرفق.',hint:'اسم المستند المرفق، لا محتواه.'})],approval_policy:{steps:['hr'],handler_role:'hr'}},
  {code:'HR-RETRO-ADJUSTMENT',req:['PAY-04'],section:'الرواتب والمزايا',department_id:'hr',name_ar:'تسوية مالية بأثر رجعي',name_en:'Retroactive pay adjustment',description:'فرق مستحق عن أشهر سابقة بسبب قرار متأخر. يراجع المدير ثم الموارد البشرية؛ الاعتماد لا يصرف مبلغًا.',fields:[
    t('from_month','من شهر',true,{...MONTH,why:'بداية الفترة تحدد أول مسير يُعاد احتسابه.',example:'2026-01',max_length:7}),
    t('to_month','إلى شهر',true,{...MONTH,why:'نهاية الفترة تغلق نطاق إعادة الاحتساب.',example:'2026-03',max_length:7}),
    num('amount','المبلغ التقديري بالريال',true,{why:'تقديرك يُقارن بما ينتجه الاحتساب الفعلي؛ الفرق الكبير يستدعي مراجعة.'}),
    long('reason','القرار أو السبب',true,{why:'التسوية الرجعية لا تقوم إلا على قرار موثق بتاريخه.',hint:'القرار ورقمه أو تاريخه، ولماذا تأخر تطبيقه.',min_length:10})],approval_policy:{steps:['manager','hr'],handler_role:'hr'}},
  {code:'HR-REFERRAL',req:['TAL-02'],section:'التوظيف والإحالات',department_id:'hr',name_ar:'ترشيح مرشح لوظيفة',name_en:'Employee referral',description:'رشّح شخصًا لوظيفة شاغرة. تُحفظ بياناته بالحد الأدنى اللازم، ولا يُتواصل معه قبل موافقته.',fields:[
    t('candidate_name','اسم المرشح',true,{why:'الاسم يكفي لبدء التواصل؛ لا تُطلب هنا هوية ولا بيانات اتصال شخصية.'}),
    t('position','الوظيفة',true,{why:'الترشيح يُربط بشاغر قائم، وإلا حُفظ دون إجراء.'}),
    t('profile_link','رابط الملف المهني',false,{why:'ملف مهني عام نشره المرشح بنفسه يغني عن إرسال سيرته دون علمه.',max_length:300}),
    pick('candidate_aware','هل يعلم المرشح بترشيحه',['نعم ووافق','لم أخبره بعد'],true,{why:'لا يُتواصل مع شخص بشأن بياناته قبل علمه؛ الجواب يحدد الخطوة الأولى.'}),
    long('why','لماذا ترشحه',true,{why:'معرفتك المباشرة بعمله هي قيمة الإحالة؛ بدونها هي سيرة ذاتية أخرى.',hint:'أين عملتما معًا وما الذي رأيته من عمله.',min_length:10})],approval_policy:{steps:['hr'],handler_role:'hr'}},
  {code:'HR-HIRING-NEED',req:['TAL-01'],section:'التوظيف والإحالات',department_id:'hr',name_ar:'طلب احتياج وظيفي',name_en:'Headcount request',description:'وظيفة جديدة أو بديلة بميزانية ومبرر. الاعتماد يفتح الشاغر في مساحة التوظيف ولا ينشر إعلانًا.',fields:[
    t('position','المسمى',true,{why:'المسمى يحدد النطاق الوظيفي والدرجة.'}),
    pick('type','النوع',['وظيفة جديدة','بديل مغادر','عقد مؤقت','متدرب'],true,{why:'البديل له مخصص قائم، والوظيفة الجديدة تحتاج مخصصًا جديدًا.'}),
    num('count','العدد',true,{why:'كل مقعد التزام مالي مستمر.'}),
    day('needed_by','مطلوب قبل',true,{why:'الموعد يُقارن بزمن التوظيف المعتاد ليُعرف هل يلزم حل مؤقت.'}),
    long('justification','المبرر والأثر',true,{why:'القرار يوازن بين التوظيف وإعادة توزيع العمل أو الإسناد الخارجي.',hint:'ما العمل الذي لا يُنجز اليوم، ولماذا لا يحله الفريق الحالي.',min_length:10})],approval_policy:{steps:['manager','hr'],handler_role:'hr'}},
  {code:'TAL-SUCCESSION',req:['TAL-09'],section:'التطوير والأداء',department_id:'hr',name_ar:'ترشيح لمسار تعاقب أو ترقية',name_en:'Succession or career path nomination',description:'ترشيح موظف لدور قيادي مستقبلي بخطة جاهزية. الترشيح سري ولا يعد وعدًا بالترقية.',fields:[
    t('employee_name','الموظف',true,{why:'الترشيح يُحفظ في خطة التعاقب باسم صاحبه.'}),
    t('target_role','الدور المستهدف',true,{why:'الجاهزية تُقاس على دور بعينه لا على القيادة عمومًا.'}),
    pick('readiness','الجاهزية',['جاهز الآن','خلال سنة','خلال سنتين'],true,{why:'الجاهزية تحدد كثافة خطة التطوير ومخاطر شغور الدور.'}),
    day('review_date','موعد مراجعة الجاهزية',true,{why:'الجاهزية تقدير يتغير؛ موعد المراجعة يمنع بقاءه على حاله سنوات.'}),
    long('development_plan','خطة التطوير',true,{why:'الفجوة بين اليوم والدور هي ما تُبنى عليه الخطة ويُتابع.',hint:'الفجوات المحددة وما يسدّها: تكليف، تدريب، أو إرشاد.',min_length:10})],approval_policy:{steps:['hr'],handler_role:'hr'}},
  {code:'HR-EXIT-INTERVIEW',req:['EXP-10','HR-09'],section:'الانضمام والمغادرة',department_id:'hr',name_ar:'مقابلة خروج ونقل معرفة',name_en:'Exit interview and knowledge handover',description:'جدولة مقابلة الخروج وتوثيق تسليم المعرفة والملفات.',fields:[
    day('interview_date','موعد المقابلة',true,{why:'المقابلة تُعقد قبل آخر يوم لتُستدرك الملاحظات.'}),
    long('handover','المعرفة والملفات المسلّمة',true,{why:'ما لا يُوثَّق هنا يغادر مع صاحبه.',hint:'المشاريع الجارية، أماكن الملفات، جهات الاتصال لدى العملاء، وما لم يكتمل. لا تكتب كلمات مرور.',min_length:10}),
    t('successor','المستلم',false,{why:'تسمية المستلم تجعل التسليم مسؤولية شخص لا ملفًا مشتركًا.'})],approval_policy:{steps:['manager','hr'],handler_role:'hr'}},
  // تقنية المعلومات
  {code:'IT-PASSWORD-UNLOCK',req:['IT-02'],section:'الحسابات والصلاحيات',department_id:'it',name_ar:'استعادة كلمة المرور',name_en:'Account unlock or password reset',description:'لحسابات الأنظمة الأخرى. لا ترسل كلمة المرور في الطلب أبدًا؛ تُسلَّم لك عبر قناة يحددها فريق تقنية المعلومات بعد التحقق من هويتك.',fields:[
    t('system','النظام',true,{why:'كل نظام له مسؤول وطريقة إعادة تعيين مختلفة.',example:'البريد الإلكتروني للعمل'}),
    pick('issue','المشكلة',['حساب مقفل','نسيت كلمة المرور','رمز التحقق لا يصل'],true,{why:'الحساب المقفل قد يدل على محاولات دخول من غيرك، فيُفحص قبل فتحه.'}),
    urgency,
    long('details','متى بدأت المشكلة وما الرسالة الظاهرة',false,{why:'نص الرسالة يختصر التشخيص.',hint:'انسخ نص الرسالة كما يظهر، دون أي كلمة مرور.',max_length:1000})],approval_policy:{steps:['it'],handler_role:'it'}},
  {code:'IT-CHANGE-REQUEST',req:['IT-06'],section:'الأنظمة والتغيير',department_id:'it',name_ar:'طلب نشر تغيير تقني',name_en:'System change or release',description:'تغيير على نظام قائم بخطة اختبار ورجوع ونافذة تنفيذ.',fields:[
    t('system','النظام',true,{why:'النظام يحدد مالكه ومن يتأثر بالتغيير.'}),
    long('change','التغيير المطلوب',true,{why:'ما يُعتمد هو التغيير المكتوب؛ ما سواه لا يُنفَّذ في النافذة.',min_length:10}),
    long('impact','من يتأثر أثناء التنفيذ',true,{why:'المستخدمون المتأثرون يُبلَّغون قبل النافذة؛ التوقف المفاجئ أسوأ من المعلن.',hint:'الفرق أو العملاء، ومدة التوقف المتوقعة إن وُجدت.',min_length:5}),
    long('test_plan','خطة الاختبار',true,{why:'الاختبار يثبت أن التغيير يعمل قبل أن يراه المستخدمون.',min_length:5}),
    long('rollback','خطة الرجوع',true,{why:'خطة الرجوع هي ما يُنفَّذ حين يفشل التغيير في منتصف النافذة؛ لا تُرتجل وقتها.',min_length:5}),
    day('window','تاريخ نافذة التنفيذ',true,{why:'النافذة تُنسق مع المواعيد الحرجة للعملاء.'})],approval_policy:{steps:['manager','it'],handler_role:'it'}},
  {code:'IT-OUTAGE',req:['IT-07','NFR-04'],section:'الأنظمة والتغيير',department_id:'it',name_ar:'بلاغ توقف خدمة أو بطء',name_en:'Service outage or slowness',description:'نظام متوقف أو بطيء لعدد من المستخدمين.',fields:[
    t('service','الخدمة المتأثرة',true,{why:'تحديد الخدمة يوجّه البلاغ لمسؤولها مباشرة.'}),
    pick('scope','النطاق',['مستخدم واحد','فريق','إدارة','الشركة كلها'],true,{why:'النطاق يحدد هل هو عطل عام يستدعي إعلانًا أم مشكلة جهاز.'}),
    long('description','الوصف ووقت البداية',true,{why:'وقت البداية يُطابق بسجلات الأنظمة وأي تغيير سبقه.',hint:'متى بدأ، وما الذي يظهر، وهل جربت جهازًا أو شبكة أخرى.',min_length:5}),
    urgency],approval_policy:{steps:['it'],handler_role:'it'}},
  {code:'IT-MEETING-SUPPORT',req:['IT-03'],section:'الدعم الفني',department_id:'it',name_ar:'دعم تقني لاجتماع',name_en:'Meeting or event tech support',description:'تجهيز عرض أو بث أو اجتماع مرئي.',fields:[
    day('date','التاريخ',true,{why:'التاريخ يحجز المعدات والفني المتاح.'}),
    t('time','الوقت',true,{pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',pattern_message:'اكتب الوقت بأربع خانات على مدار 24 ساعة، مثل 09:00',why:'التجهيز يسبق الموعد؛ الوقت يحدد متى يحضر الفني.',example:'09:00'}),
    t('location','المكان',true,{why:'المكان يحدد المعدات الموجودة وما يلزم نقله.'}),
    long('needs','المطلوب',true,{why:'ما لم يُطلب لا يُجهَّز.',hint:'شاشة، بث، ميكروفونات، اتصال مرئي مع جهة خارجية.',min_length:5})],approval_policy:{steps:['it'],handler_role:'it'}},
  {code:'IT-PLATFORM-FEEDBACK',req:['NFR-09'],section:'الدعم الفني',department_id:'it',name_ar:'اقتراح تحسين على المنصة',name_en:'Platform feedback or service idea',description:'خطأ في المنصة، أو خدمة تحتاجها ولا تجدها هنا.',fields:[
    pick('type','النوع',['خطأ أو مشكلة','اقتراح خدمة جديدة','تحسين على خدمة','صعوبة استخدام'],true,{why:'الخطأ يُصلح، والاقتراح يُوزن مع غيره؛ مساران مختلفان.'}),
    t('page','الصفحة أو الخدمة',false,{why:'الصفحة المحددة تختصر إعادة إنتاج المشكلة.'}),
    long('details','التفاصيل',true,{why:'ما فعلته وما توقعته وما حدث هو ما يُعاد به إنتاج الخطأ.',hint:'الخطوات بالترتيب، ثم ما توقعته، ثم ما ظهر.',min_length:10})],approval_policy:{steps:['it'],handler_role:'it'}},
  // الإبداع
  {code:'CRT-REVISION',req:['CRT-04','CRT-05'],section:'التصميم',department_id:'creative',name_ar:'طلب تعديل على مخرج',name_en:'Revision request',description:'ملاحظات موحدة على نسخة محددة من مخرج قائم.',fields:[
    t('deliverable','المخرج ورقم النسخة',true,{why:'الملاحظة على نسخة غير الأخيرة تعيد عملًا أُنجز.',example:'منشور الإطلاق — النسخة 3'}),
    pick('source','مصدر الملاحظات',['العميل','مراجعة داخلية'],true,{why:'ملاحظات العميل تُحسب على جولات التعديل في العقد، والداخلية لا.'}),
    long('feedback','الملاحظات',true,{why:'الملاحظات الموحدة من مصدر واحد تمنع تعديلات متعارضة.',hint:'ملاحظة في كل سطر، محددة الموضع، دون «حسّنه».',min_length:10}),
    day('due_date','موعد التعديل',true,{why:'الموعد يرتب التعديل مع بقية حمل الفريق.'})],approval_policy:{steps:['manager'],handler_role:'manager'}},
  {code:'CRT-ASSET-REQUEST',req:['CRT-06','CRT-10'],section:'الأصول الرقمية',department_id:'brand',name_ar:'طلب أصل من المكتبة الرقمية',name_en:'Digital asset request',description:'شعار أو صورة أو قالب معتمد، مع التحقق من حقوق الاستخدام.',fields:[
    t('asset','الأصل المطلوب',true,{why:'تحديد الأصل يمنع استخدام نسخة قديمة أو غير معتمدة.'}),
    t('use','مكان الاستخدام',true,{why:'الحقوق تُمنح لاستخدام محدد؛ الصورة المرخصة داخليًا قد لا يجوز نشرها.',example:'عرض تقديمي لعميل محتمل'}),
    pick('rights','الحقوق',['داخلي','عميل','نشر عام'],true,{why:'نطاق الاستخدام يُقارن بترخيص الأصل قبل تسليمه.'})],approval_policy:{steps:['manager'],handler_role:'manager'}},
  {code:'CRT-TRANSLATION',req:['CRT-08'],section:'المحتوى والكتابة',department_id:'creative',name_ar:'ترجمة أو تدقيق لغوي',name_en:'Translation or proofreading',description:'ترجمة أو تدقيق نص قبل النشر.',fields:[
    pick('service','الخدمة',['ترجمة عربي ← إنجليزي','ترجمة إنجليزي ← عربي','تدقيق لغوي'],true,{why:'الاتجاه يحدد المترجم المناسب.'}),
    num('words','عدد الكلمات التقريبي',true,{why:'حجم النص يحدد الزمن اللازم وهل يُسند خارجيًا.'}),
    day('due_date','موعد التسليم',true,{why:'الموعد يُقارن بحجم النص قبل القبول.'}),
    long('notes','ملاحظات',false,{why:'الجمهور والمصطلحات المعتمدة للعميل تمنع ترجمة صحيحة لغويًا وخاطئة سياقًا.',hint:'الجمهور، ومسرد العميل إن وُجد، وأين سيُنشر.'})],approval_policy:{steps:['manager'],handler_role:'manager'}},
  // الشؤون الإدارية
  {code:'ADM-ACCESS-CARD',req:['ADM-03'],section:'الزوار والدخول',department_id:'ceo-office',name_ar:'بطاقة موظف أو بطاقة دخول',name_en:'Employee or access card',description:'إصدار أو بدل فاقد أو تعديل صلاحية دخول مبنى. البطاقة المفقودة تُعطَّل عند استلام الطلب.',fields:[
    pick('action','الإجراء',['إصدار جديد','بدل فاقد','بدل تالف','تعديل صلاحية'],true,{why:'بدل الفاقد يبدأ بتعطيل البطاقة القديمة قبل إصدار الجديدة.'}),
    pick('access_area','نطاق الدخول',['المكتب','الاستوديو','المستودع','كامل المبنى'],true,{why:'أقل نطاق يكفي للعمل هو القاعدة؛ الاستوديو والمستودع فيهما عهد.'}),
    day('needed_by','مطلوب قبل',false,{why:'الموعد يرتب الإصدار مع بقية الطلبات.'}),
    long('notes','ملاحظات',false,{why:'لبدل الفاقد: متى وأين فُقدت، ليُراجع سجل الدخول بعدها.',max_length:1000})],approval_policy:MANAGER_HEAD},
  {code:'ADM-VEHICLE',req:['ADM-04'],section:'السفر والتنقل',department_id:'ceo-office',name_ar:'طلب سيارة أو توصيل',name_en:'Vehicle or transport request',description:'توصيل عمل أو سيارة لمهمة محددة.',fields:[
    day('date','التاريخ',true,{why:'التاريخ يحجز السيارة والسائق.'}),
    t('from','من',true,{why:'نقطة الانطلاق تحدد وقت التحرك.'}),
    t('to','إلى',true,{why:'الوجهة تحدد المدة ومن يُجمع في الرحلة نفسها.'}),
    t('time','الوقت',true,{pattern:'^([01]\\d|2[0-3]):[0-5]\\d$',pattern_message:'اكتب الوقت بأربع خانات على مدار 24 ساعة، مثل 08:15',why:'وقت الانطلاق يُبلَّغ للسائق.',example:'08:15'}),
    num('passengers','عدد الركاب',true,{why:'العدد والمعدات يحددان حجم السيارة.'}),
    t('purpose','الغرض من التنقل',true,{why:'الغرض يرجّح بين طلبين على السيارة نفسها.',example:'نقل معدات تصوير إلى موقع عميل'})],approval_policy:MANAGER_HEAD},
  {code:'ADM-COURIER',req:['ADM-06'],section:'المراسلات الرسمية',department_id:'ceo-office',name_ar:'إرسال شحنة أو مستند',name_en:'Courier dispatch',description:'إرسال مستند أو شحنة لعميل أو جهة. التسليم لشركة الشحن يجري خارج المنصة.',fields:[
    t('recipient','المستلم',true,{why:'اسم المستلم وجهته يُكتبان على الشحنة.'}),
    t('address','العنوان',true,{why:'العنوان الكامل يمنع إعادة الشحنة.',hint:'العنوان الوطني أو وصف دقيق مع رقم تواصل الجهة.'}),
    pick('type','النوع',['مستند','طرد','عينة إنتاج'],true,{why:'النوع يحدد التغليف وطريقة الشحن.'}),
    urgency,
    t('contents','وصف المحتوى',true,{why:'الوصف يُثبت ما أُرسل عند أي خلاف على الاستلام.'})],approval_policy:HEAD},
  {code:'ADM-GOVT-SERVICES',req:['HR-10','LEG-09'],section:'الخدمات الحكومية',department_id:'ceo-office',name_ar:'إنهاء معاملة حكومية',name_en:'Government service follow-up',description:'مراجعة جهة حكومية أو منصة رسمية نيابة عن الشركة. المراجعة يجريها المختص خارج المنصة؛ المنصة لا تتصل بأي جهة.',fields:[
    t('authority','الجهة',true,{why:'الجهة تحدد من يملك التفويض بمراجعتها.'}),
    t('service','الخدمة المطلوبة',true,{why:'الخدمة تحدد المستندات التي يحملها المعقب.'}),
    day('needed_by','مطلوب قبل',true,{why:'الموعد يرتب المراجعات ويكشف ما لا يتسع له الوقت.'}),
    long('details','التفاصيل',true,{why:'ما سبق من مراجعات ورقم المعاملة يمنع البدء من الصفر.',hint:'رقم المعاملة إن وُجد، وما تم حتى الآن.',min_length:5})],approval_policy:MANAGER_HEAD},
  {code:'ADM-WORKSPACE',req:['ADM-01'],section:'المرافق والصيانة',department_id:'ceo-office',name_ar:'مكتب أو مقعد عمل',name_en:'Workspace allocation',description:'تخصيص مكتب لموظف جديد، أو نقل مقعد.',fields:[
    t('employee_name','الموظف',true,{why:'المقعد يُسجَّل باسم شاغله.'}),
    pick('action','الإجراء',['تخصيص جديد','نقل','إخلاء'],true,{why:'الإخلاء يحرر مقعدًا وعهدة لغيرك.'}),
    day('date','التاريخ',true,{why:'التاريخ يرتب التجهيز مع يوم المباشرة أو النقل.'}),
    t('preferred_area','المنطقة المفضلة',false,{why:'قرب الفريق يُراعى إن اتسع المكان.'}),
    long('notes','ملاحظات',false,{why:'احتياج خاص في التجهيز يُرتب قبل اليوم لا بعده.',max_length:1000})],approval_policy:MANAGER_HEAD},
  // المالية والمشتريات
  {code:'FIN-TAX-QUERY',req:['FIN-08'],section:'الضرائب',department_id:'finance',name_ar:'استفسار ضريبي أو فاتورة غير مطابقة',name_en:'Tax query or non-compliant invoice',description:'فاتورة مورد لا تستوفي متطلبات الفوترة الإلكترونية، أو سؤال ضريبة قيمة مضافة. الجواب رأي داخلي من المالية.',fields:[
    t('invoice','رقم الفاتورة أو الموضوع',true,{why:'رقم الفاتورة يربط الملاحظة بسجل المستحقات ويوقف صرفها حتى تُحسم.'}),
    long('issue','الملاحظة',true,{why:'ما ينقص الفاتورة تحديدًا هو ما يُطلب من المورد تصحيحه.',hint:'الحقل الناقص أو المختلف في الفاتورة، أو سؤالك بسياقه.',min_length:5}),
    num('vat_amount','مبلغ الضريبة بالريال',false,{why:'المبلغ يحدد أثر الملاحظة على الإقرار الضريبي.'})],approval_policy:HEAD},
  {code:'FIN-REFUND',req:['FIN-03'],section:'الفوترة والتحصيل',department_id:'finance',name_ar:'طلب إشعار دائن أو استرداد',name_en:'Client credit note or refund',description:'إشعار دائن عن فاتورة صادرة بمبرر موثق. يصدره المالي خارج المنصة؛ الاعتماد لا يرد مبلغًا.',fields:[
    t('client','العميل',true,{why:'العميل يحدد حساب المستحقات الذي يُخفَّض.'}),
    t('invoice','الفاتورة الأصلية',true,{why:'الإشعار الدائن يُربط بفاتورة بعينها ولا يتجاوز قيمتها.'}),
    num('amount','المبلغ بالريال',true,{why:'المبلغ هو ما يُخفَّض من إيراد مسجل، فيُعتمد على مستويين.'}),
    long('reason','السبب',true,{why:'السبب الموثق يفرّق بين خطأ فوترة وتنازل تجاري، ولكل منهما معالجة.',min_length:10})],approval_policy:MANAGER_HEAD},
  {code:'PRC-PO-CHANGE',req:['PRC-08'],section:'طلبات الشراء',department_id:'procurement',name_ar:'تعديل أمر شراء',name_en:'Purchase order change',description:'تعديل كمية أو سعر أو موعد في أمر صادر، بإعادة اعتماد. المورد يُبلَّغ خارج المنصة.',fields:[
    t('po_number','رقم أمر الشراء',true,{why:'التعديل يقع على أمر بعينه ويُقارن بما اعتُمد فيه.'}),
    day('needed_by','مطلوب اعتماده قبل',true,{why:'الموعد يكشف هل التعديل يؤثر على تسليم قائم.'}),
    long('change','التعديل',true,{why:'الفرق بين الأمر الأصلي والجديد هو موضوع إعادة الاعتماد.',hint:'قبل التعديل وبعده لكل بند يتغير.',min_length:5}),
    num('new_total','القيمة الجديدة بالريال',false,{why:'الزيادة في القيمة تحدد هل يلزم مستوى اعتماد أعلى.'}),
    long('reason','السبب',true,{why:'تعديلات الأوامر المتكررة إشارة على خلل في التقدير أو المورد.',min_length:5})],approval_policy:MANAGER_HEAD},
  {code:'PRC-EMERGENCY',req:['PRC-07'],section:'طلبات الشراء',department_id:'procurement',name_ar:'شراء طارئ',name_en:'Emergency purchase',description:'شراء لا يحتمل مسار العروض الكامل، بمبرر وتوثيق لاحق. الاعتماد لا يصدر أمر شراء بنفسه.',fields:[
    long('items','الأصناف',true,{why:'الأصناف المحددة هي حدود الاستثناء؛ ما لم يُذكر يمر بالمسار العادي.',min_length:3}),
    num('amount','المبلغ بالريال',true,{why:'المبلغ يحدد مستوى الاعتماد حتى في الطوارئ.'}),
    t('project','المشروع أو مركز التكلفة',true,{why:'يحدد الميزانية التي تتحمل الشراء.'}),
    long('justification','سبب الطوارئ',true,{why:'الطارئ هو ما لم يكن متوقعًا؛ ما تأخر طلبه ليس طارئًا، والفرق يُسجَّل.',hint:'ما الذي حدث، ومتى علمت به، وما الذي يتوقف إن انتُظر المسار العادي.',min_length:10})],approval_policy:MANAGER_HEAD},
  {code:'PRC-VENDOR-BANK',req:['PRC-09'],section:'الموردون',department_id:'procurement',name_ar:'تحديث حساب مورد البنكي',name_en:'Vendor payment details change',description:'تغيير حساب مورد بتحقق مستقل من المورد عبر قناة معروفة، لمنع الاحتيال. لا يُكتب الحساب كاملًا في الطلب.',fields:[
    t('vendor','المورد',true,{why:'المورد يحدد السجل الذي تتغير بيانات دفعه.'}),
    t('iban_last4','آخر 4 أرقام من الحساب الجديد',true,{pattern:'^\\d{4}$',pattern_message:'اكتب أربعة أرقام فقط، هي آخر أربع خانات من الحساب',max_length:4,why:'أربعة أرقام تكفي لمطابقة الطلب بخطاب البنك المرفق دون أن يبقى الحساب في سجل الطلبات.',example:'0937'}),
    long('verification','كيف تحققت من المورد عبر قناة مستقلة',true,{why:'طلبات تغيير الحساب المزورة تصل عادة ببريد يبدو سليمًا؛ الاتصال بالمورد عبر رقم معروف مسبقًا هو خط الدفاع.',hint:'من اتصلت به، وعلى أي رقم، ومتى — رقم من سجل المورد لا من الرسالة التي طلبت التغيير.',min_length:10})],approval_policy:HEAD},
  {code:'PRC-VENDOR-EVALUATION',req:['PRC-10'],section:'الموردون',department_id:'procurement',name_ar:'تقييم أداء مورد',name_en:'Vendor performance review',description:'تقييم مورد بعد تنفيذ أمر أو مشروع.',fields:[
    t('vendor','المورد',true,{why:'التقييمات تتراكم على سجل المورد وتُقرأ عند ترشيحه مجددًا.'}),
    t('order','الأمر أو المشروع',true,{why:'التقييم يُربط بعمل محدد ليُقارن بما طُلب فيه.'}),
    pick('rating','التقييم',['ممتاز','جيد','مقبول','ضعيف'],true,{why:'التقييم «ضعيف» يستدعي مراجعة قبل الأمر التالي.'}),
    long('notes','الملاحظات',true,{why:'الملاحظة المحددة تفيد من يتعامل معه بعدك أكثر من الدرجة.',hint:'الالتزام بالموعد والجودة والتواصل، بأمثلة.',min_length:5})],approval_policy:HEAD},
  // التواصل الداخلي
  {code:'EXP-WELCOME',req:['EXP-08'],section:'اندماج الموظف',department_id:'comms',name_ar:'برنامج ترحيب بموظف جديد',name_en:'New joiner welcome',description:'رسالة ترحيب وجولة وحقيبة ترحيب ورفيق أول أسبوع.',fields:[
    t('employee_name','الموظف الجديد',true,{why:'الاسم يُكتب في رسالة الترحيب وبطاقة الحقيبة.'}),
    day('start_date','تاريخ المباشرة',true,{why:'الترحيب يُجهَّز قبل اليوم الأول لا فيه.'}),
    t('buddy','الرفيق المقترح',false,{why:'الرفيق يُسأل عن توفره في الأسبوع الأول قبل تسميته.'}),
    pick('kit','حقيبة الترحيب',['نعم','لا'],true,{why:'الحقيبة تُطلب من المخزون أو تُشترى مسبقًا.'}),
    long('notes','ملاحظات تساعد فريق الترحيب',false,{why:'ما يجعل الأسبوع الأول أسهل للموظف: فريقه، مشروعه الأول.',hint:'لا تكتب بيانات صحية أو شخصية.',max_length:1000})],approval_policy:HEAD},
  {code:'EXP-FAREWELL',req:['EXP-10'],section:'اندماج الموظف',department_id:'comms',name_ar:'توديع موظف',name_en:'Farewell',description:'رسالة أو لقاء توديع لموظف مغادر، بعد موافقته.',fields:[
    t('employee_name','الموظف',true,{why:'التوديع لشخص بعينه ويُنسق معه.'}),
    day('last_day','آخر يوم',true,{why:'اللقاء يُرتب قبل آخر يوم.'}),
    pick('format','الشكل',['رسالة داخلية','لقاء فريق','كلاهما'],true,{why:'الشكل يحدد الترتيب والتكلفة.'}),
    long('message','رسالة التوديع',false,{why:'النص المقترح يُراجع ويُعرض على الموظف قبل نشره.'})],approval_policy:HEAD},
  {code:'EXP-LEADERSHIP-MEETING',req:['EXP-06'],section:'صوت الموظف',department_id:'comms',name_ar:'طلب لقاء مع القيادة',name_en:'Leadership meeting request',description:'لقاء فردي أو جماعي مع القيادة لطرح موضوع.',fields:[
    t('topic','الموضوع',true,{why:'الموضوع يحدد من يحضر من القيادة.'}),
    pick('format','الشكل',['فردي','مجموعة صغيرة'],true,{why:'الشكل يحدد مدة اللقاء ومكانه.'}),
    long('details','التفاصيل',true,{why:'التحضير المسبق يجعل اللقاء يخرج بقرار لا بوعد بالنظر.',hint:'ما الذي تريد أن يخرج به اللقاء.',min_length:10})],approval_policy:HEAD},
  // العلاقات العامة والمؤثرون
  {code:'PR-EVENT-MEDIA',req:['PR-06'],section:'الإعلام',department_id:'pr',name_ar:'دعوات واعتمادات إعلامية',name_en:'Media invitations and accreditation',description:'قائمة إعلاميين ودعوات واعتمادات حضور لفعالية. المنصة لا ترسل الدعوات.',fields:[
    t('event','الفعالية',true,{why:'الفعالية تحدد الرسالة الإعلامية وقائمة المدعوين.'}),
    day('date','التاريخ',true,{why:'الدعوات تُرسل بمهلة كافية قبل الموعد.'}),
    num('media_count','عدد الإعلاميين المستهدف',true,{why:'العدد يحدد المقاعد والمواد الصحفية المطبوعة.'}),
    long('notes','ملاحظات',true,{why:'الوسائل ذات الأولوية وأي قيود من العميل على الحضور.',hint:'الوسائل المستهدفة وما يُمنع تصويره.',min_length:5})],approval_policy:HEAD},
  {code:'PR-IMPACT-REPORT',req:['PR-09','PR-10'],section:'الرصد والأزمات',department_id:'pr',name_ar:'تقرير تغطية وأثر إعلامي',name_en:'Coverage and impact report',description:'حصر التغطية وقياس الأثر وأرشفة المواد. الحصر يدوي؛ لا ربط بأدوات رصد.',fields:[
    t('campaign','الحملة أو الحدث',true,{why:'التقرير يُقاس على أهداف الحملة المعتمدة.'}),
    t('period','الفترة',true,{why:'الفترة تحدد نطاق الحصر.',example:'2026-03-01 إلى 2026-03-15'}),
    day('due_date','موعد التسليم',true,{why:'الموعد يحدد عمق الحصر الممكن.'}),
    long('scope','ما المطلوب في التقرير',false,{why:'حجم التغطية غير الأثر؛ حدد أيهما يطلبه العميل.'})],approval_policy:HEAD},
  {code:'INF-CONTRACT',req:['INF-04','INF-05'],section:'المؤثرون',department_id:'pr',name_ar:'عرض وعقد مؤثر',name_en:'Influencer offer and contract',description:'تفاوض واعتماد عرض مؤثر وحقوق الاستخدام قبل التعاقد. الاعتماد لا يوقّع العقد.',fields:[
    t('influencer','المؤثر',true,{why:'الاسم يُطابق بسجل المؤثرين والتحقق من ترخيصه.'}),
    t('campaign','الحملة',true,{why:'الحملة تحدد الميزانية التي يُخصم منها الأجر.'}),
    num('fee','الأجر بالريال',true,{why:'الأجر يُقارن بميزانية الحملة وبأجور سابقة للمؤثر نفسه.'}),
    day('start_date','بداية التعاقد',true,{why:'البداية تحدد موعد اعتماد المحتوى الأول.'}),
    t('deliverables','المخرجات',true,{why:'المخرجات المحددة هي ما يُثبت تنفيذه قبل السداد.',example:'منشوران وثلاث قصص خلال أسبوعين'}),
    pick('usage_rights','حقوق الاستخدام',['30 يومًا','90 يومًا','سنة','دائمة'],true,{why:'حقوق الاستخدام تحدد هل يمكن للعميل إعادة استخدام المحتوى في إعلاناته، وهي أغلى ما في العقد.'}),
    long('terms','شروط أساسية وملاحظات',false,{why:'الحصرية وعدم التعامل مع منافسين تُكتب قبل التوقيع لا بعده.'})],approval_policy:HEAD},
  {code:'INF-CONTENT-APPROVAL',req:['INF-06','INF-07'],section:'المؤثرون',department_id:'pr',name_ar:'اعتماد محتوى مؤثر قبل النشر',name_en:'Influencer content approval',description:'مراجعة المحتوى والإفصاح الإعلاني قبل النشر. المنصة لا تنشر ولا تراسل المؤثر.',fields:[
    t('influencer','المؤثر',true,{why:'المحتوى يُراجع مقابل عقد المؤثر ومخرجاته.'}),
    t('content_link','رابط المسودة',true,{why:'ما يُعتمد هو المسودة نفسها لا وصفها.',max_length:500}),
    day('publish_date','تاريخ النشر',true,{why:'التاريخ يُطابق بجدول الحملة.'}),
    pick('disclosure','الإفصاح الإعلاني',['موجود','ناقص'],true,{why:'المحتوى المدفوع بلا إفصاح لا يُعتمد للنشر.'}),
    long('notes','ملاحظات المراجعة',false,{why:'ملاحظات محددة تُرسل للمؤثر دفعة واحدة.'})],approval_policy:HEAD},
  {code:'INF-PROOF-PAYMENT',req:['INF-08','INF-09','INF-10'],section:'المؤثرون',department_id:'pr',name_ar:'إثبات تنفيذ وسداد',name_en:'Influencer proof and payment',description:'روابط النشر والنتائج ثم رفع طلب السداد. الاعتماد لا يحوّل مبلغًا.',fields:[
    t('influencer','المؤثر',true,{why:'السداد لمن نفذ فعلًا وفق عقده.'}),
    long('proof_links','روابط النشر',true,{why:'الروابط تثبت أن المخرجات المتعاقد عليها نُشرت فعلًا.',hint:'رابط لكل مخرج في العقد.',min_length:5}),
    long('results','النتائج',true,{why:'النتائج تُقيّم المؤثر للحملات القادمة، وتُذكر بمصدرها.',hint:'الأرقام من لقطات شاشة المؤثر أو المنصة، مع تاريخها.',min_length:5}),
    num('amount','المستحق بالريال',true,{why:'المستحق يُطابق بالعقد قبل رفعه للسداد.'})],approval_policy:HEAD},
  // التسويق الرقمي
  {code:'DIG-AD-ACCOUNT',req:['DIG-01'],section:'الحملات والشراء الإعلامي',department_id:'marketing',name_ar:'وصول لحساب إعلاني',name_en:'Ad account access',description:'منح أو سحب وصول لحساب إعلاني لعميل. التنفيذ يدوي في المنصة الإعلانية؛ لا ربط آلي بها.',fields:[
    t('platform','المنصة',true,{why:'كل منصة لها مستويات وصول ومسؤول مختلف.'}),
    t('client','العميل',true,{why:'الحساب الإعلاني ملك العميل، ووصولنا إليه بإذنه.'}),
    pick('action','الإجراء',['منح','سحب'],true,{why:'السحب يُنفَّذ فور انتهاء الحاجة أو مغادرة الموظف؛ لا ينتظر.'}),
    day('access_until','ينتهي في',true,{show_when:{field:'action',equals:['منح']},why:'الوصول لحساب ينفق من مال العميل يُمنح بمدة ولازم ينسحب في موعدها. المنصة للحين ما تسحبه بنفسها — السحب يدوي.'}),
    long('justification','مبرر الوصول',true,{why:'المبرر يحدد أقل مستوى وصول يكفي للعمل.',min_length:5})],approval_policy:HEAD},
  {code:'DIG-BUDGET-CHANGE',req:['DIG-06','DIG-07'],section:'الحملات والشراء الإعلامي',department_id:'marketing',name_ar:'تعديل ميزانية أو تحسين حملة',name_en:'Live campaign budget or optimization change',description:'زيادة أو تخفيض إنفاق أو تغيير استهداف بناء على الأداء. الاعتماد لا يغيّر شيئًا في المنصة الإعلانية بنفسه.',fields:[
    t('campaign','الحملة',true,{why:'التعديل يُقاس على خطة الحملة المعتمدة.'}),
    num('current_budget','الميزانية الحالية بالريال',true,{why:'الحالية نقطة المقارنة لحجم التغيير.'}),
    num('new_budget','الميزانية الجديدة بالريال',true,{why:'الزيادة على ما اعتمده العميل تحتاج موافقته قبل التنفيذ.'}),
    pick('client_approved','موافقة العميل على التغيير',['موثقة','لا تلزم — ضمن الصلاحية المتفق عليها','لم تصل بعد'],true,{why:'إنفاق مال العميل خارج ما وافق عليه لا يُسترد بعد وقوعه.'}),
    long('reason','البيانات والمبرر',true,{why:'التغيير يُبنى على أرقام بمصدرها وفترتها، لا على انطباع.',hint:'المؤشر وقيمته وفترته ومصدره، وما تتوقعه بعد التغيير.',min_length:10})],approval_policy:HEAD},
  {code:'DIG-CAMPAIGN-CLOSE',req:['DIG-10'],section:'القياس والتقارير',department_id:'marketing',name_ar:'إقفال حملة',name_en:'Campaign closure',description:'إيقاف الإعلانات ومطابقة الإنفاق وتسليم التقرير النهائي. الإيقاف يجريه الفريق في المنصة الإعلانية يدويًا.',fields:[
    t('campaign','الحملة',true,{why:'الإقفال يغلق حملة بعينها ويطابق إنفاقها بميزانيتها.'}),
    num('final_spend','الإنفاق النهائي بالريال',true,{why:'الإنفاق الفعلي يُطابق بالفواتير وبما اعتمده العميل.',hint:'كما يظهر في لوحة المنصة بعد الإيقاف.'}),
    long('learnings','الدروس',true,{why:'الدروس المكتوبة هي ما تنتفع به الحملة التالية للعميل نفسه.',hint:'ما نجح وما لم ينجح، بأرقام.',min_length:10})],approval_policy:HEAD},
  // الإنتاج
  {code:'PRO-EDIT-REVIEW',req:['PRO-07'],section:'التصوير والإنتاج',department_id:'production',name_ar:'مونتاج أو مراجعة نسخة',name_en:'Edit or cut review',description:'مونتاج مادة مصورة أو مراجعة نسخة قبل التسليم.',fields:[
    t('project','المشروع',true,{why:'المشروع يحدد المواد المصدرية ومن يملك الموافقة.'}),
    t('version','النسخة',true,{why:'الملاحظات على نسخة قديمة تعيد عملًا أُنجز.',example:'القطع الثاني'}),
    long('notes','الملاحظات',true,{why:'ملاحظات بتوقيتها في المادة تُنفَّذ من أول مرة.',hint:'التوقيت (دقيقة:ثانية) ثم الملاحظة في كل سطر.',example:'00:42 — تقديم الشعار ثانيتين',min_length:5}),
    day('due_date','الموعد',true,{why:'الموعد يرتب العمل على محطة المونتاج.'})],approval_policy:HEAD},
  {code:'PRO-FREELANCER',req:['PRO-02'],section:'التصوير والإنتاج',department_id:'production',name_ar:'تعاقد مع مستقل أو طاقم',name_en:'Freelancer or crew booking',description:'مصور أو مخرج أو طاقم لمشروع محدد. الاعتماد لا يوقّع عقدًا ولا يدفع.',fields:[
    t('role','الدور',true,{why:'الدور يحدد الأجر المعتاد والمعدات التي يجلبها.'}),
    t('project','المشروع',true,{why:'الأجر يُحمَّل على ميزانية هذا المشروع.'}),
    day('from_date','من تاريخ',true,{why:'الفترة تحدد الأيام المدفوعة.'}),
    day('to_date','إلى تاريخ',true,{why:'نهاية التعاقد تحدد متى يُسلَّم العمل.'}),
    num('fee','الأجر بالريال',true,{why:'الأجر يُقارن بميزانية المشروع قبل الالتزام.'}),
    long('scope','نطاق العمل المطلوب',true,{why:'النطاق المكتوب يحدد ما يشمله الأجر، ومن يملك المواد المنتجة.',hint:'المهام والمخرجات، وأن حقوق المواد للعميل.',min_length:10})],approval_policy:HEAD},
  {code:'PRO-LOCATION',req:['PRO-03'],section:'المعدات والمواقع',department_id:'production',name_ar:'موقع تصوير وتصريح',name_en:'Shooting location and permit',description:'حجز موقع والحصول على تصريح التصوير. التقديم للتصريح يجري خارج المنصة.',fields:[
    t('location','الموقع',true,{why:'الموقع يحدد مالكه ومتطلبات تصريحه.'}),
    day('shoot_date','التاريخ',true,{why:'التاريخ يُقارن بمهلة الحصول على التصريح.'}),
    t('project','المشروع',true,{why:'رسوم الموقع تُحمَّل على المشروع.'}),
    long('notes','ملاحظات',false,{why:'حجم الطاقم وساعات التصوير يحددان نوع التصريح.',hint:'عدد الطاقم، ساعات التصوير، وهل يظهر جمهور.'})],approval_policy:HEAD},
  {code:'PRO-DELIVERY',req:['PRO-09','PRO-10'],section:'التصوير والإنتاج',department_id:'production',name_ar:'تسليم مخرج نهائي وأرشفته',name_en:'Final delivery and archive',description:'تسليم الملفات النهائية بالصيغ المطلوبة وأرشفة المصادر.',fields:[
    t('project','المشروع',true,{why:'التسليم يغلق مخرجًا في المشروع.'}),
    t('formats','الصيغ',true,{why:'الصيغة الخاطئة تعني تصديرًا جديدًا.',example:'فيديو أفقي وعمودي، بترجمة مدمجة'}),
    t('destination','جهة التسليم',true,{why:'الجهة تحدد طريقة النقل.'}),
    day('delivery_date','تاريخ التسليم',true,{why:'التاريخ هو الالتزام أمام العميل.'}),
    long('notes','ملاحظات التسليم',false,{why:'ما يُؤرشف من مصادر ومدة حفظه تحدد إمكان التعديل لاحقًا.'})],approval_policy:HEAD},
  // الإستراتيجية
  {code:'STR-COMPETITOR',req:['STR-04'],section:'البحث والتحليل',department_id:'business-dev',name_ar:'تحليل منافسين',name_en:'Competitor analysis',description:'تحليل منافسين لعميل أو قطاع.',fields:[
    t('client','العميل أو القطاع',true,{why:'التحليل يُبنى من موقع العميل لا من منظور عام.'}),
    long('competitors','المنافسون',true,{why:'قائمة المنافسين يحددها العميل أولًا؛ ثم يُضاف من يغيب عنه.',min_length:3}),
    long('questions','ما الذي تريد معرفته',true,{why:'التحليل يجيب عن سؤال قرار؛ «حلّل المنافسين» بلا سؤال ينتج جدولًا لا يُستخدم.',example:'لماذا يتفوق منافس معين في التفاعل على المنصات رغم ميزانية أقل؟',min_length:10}),
    day('due_date','الموعد',true,{why:'الموعد يحدد عمق التحليل الممكن.'})],approval_policy:HEAD},
  {code:'STR-POST-CAMPAIGN',req:['STR-10'],section:'البحث والتحليل',department_id:'business-dev',name_ar:'مراجعة ما بعد الحملة',name_en:'Post-campaign review',description:'ما نجح وما لم ينجح، بدروس قابلة لإعادة الاستخدام.',fields:[
    t('campaign','الحملة',true,{why:'المراجعة تُقاس على أهداف الحملة المعتمدة.'}),
    long('results','النتائج مقابل الأهداف',true,{why:'المقارنة بالمستهدف لا بالانطباع هي ما يجعل المراجعة صادقة.',hint:'لكل هدف: المستهدف، والمتحقق، ومصدر الرقم.',min_length:10}),
    long('learnings','الدروس',true,{why:'الدرس القابل لإعادة الاستخدام يُكتب قاعدة لا قصة.',min_length:10})],approval_policy:HEAD},
  {code:'STR-CAMPAIGN-PLAN',req:['STR-06','STR-07'],section:'العروض والمنافسات',department_id:'business-dev',name_ar:'خطة حملة وقنوات',name_en:'Campaign and channel plan',description:'أهداف حملة وجمهور وقنوات وميزانية مبدئية.',fields:[
    t('client','العميل',true,{why:'الخطة تُبنى على عقد العميل وموجزه.'}),
    long('objectives','الأهداف',true,{why:'الهدف القابل للقياس هو ما تُختار عليه القنوات.',hint:'ماذا يتغير، وبكم، وكيف يُقاس.',min_length:10}),
    t('channels','القنوات',true,{why:'القنوات المقترحة تحدد الفرق المشاركة.'}),
    num('budget','الميزانية التقديرية بالريال',false,{why:'الميزانية تحدد ما يمكن تحقيقه واقعيًا.'}),
    day('due_date','الموعد',true,{why:'الموعد يحدد متى تُعرض الخطة على العميل.'})],approval_policy:HEAD},
  // النمو والحسابات
  {code:'CRM-PRICING',req:['CRM-05','CRM-07'],section:'المبيعات والفرص',department_id:'business-dev',name_ar:'تسعير أو استثناء هامش',name_en:'Pricing or margin exception',description:'سعر خارج الكتالوج أو هامش أقل من الحد المعتمد لدى الشركة.',fields:[
    t('opportunity','الفرصة',true,{why:'الاستثناء يُقرأ مع قيمة الفرصة وعلاقتها.'}),
    num('price','السعر المقترح بالريال',true,{why:'السعر هو موضوع الاستثناء.'}),
    num('margin','الهامش المتوقع %',true,{why:'الهامش هو ما يُقارن بالحد المعتمد؛ بدونه لا يُعرف حجم الاستثناء.'}),
    long('justification','المبرر',true,{why:'الاستثناء يُقبل لقيمة تتجاوز الصفقة: عميل إستراتيجي أو دخول سوق.',hint:'ما الذي تكسبه الشركة مقابل الهامش الأقل.',min_length:10})],approval_policy:MANAGER_HEAD},
  {code:'CRM-LOSS',req:['CRM-10','CRM-08'],section:'المبيعات والفرص',department_id:'business-dev',name_ar:'تسجيل خسارة فرصة',name_en:'Lost opportunity record',description:'سبب الخسارة والمنافس والدرس.',fields:[
    t('opportunity','الفرصة',true,{why:'الخسارة تُغلق الفرصة في سجل المبيعات.'}),
    pick('reason','السبب',['السعر','المنافس','التوقيت','النطاق','العلاقة','أخرى'],true,{why:'أسباب الخسارة المتكررة تكشف ما يلزم تغييره في العروض.'}),
    t('competitor','المنافس الفائز',false,{why:'معرفة الفائز تبني صورة السوق.'}),
    long('lesson','الدرس',true,{why:'الدرس المكتوب يمنع الخسارة نفسها في العرض التالي.',hint:'ما قاله العميل عن سبب اختياره، إن قاله.',min_length:5})],approval_policy:HEAD},
  {code:'CRM-HANDOVER',req:['CRM-09','ACC-02'],section:'إدارة الحسابات',department_id:'business-dev',name_ar:'تسليم فرصة للتشغيل',name_en:'Won deal handover',description:'تسليم العقد والنطاق والتوقعات لفريق التشغيل.',fields:[
    t('client','العميل',true,{why:'العميل يُسند إلى فريق حساب بعينه.'}),
    t('contract','العقد',true,{why:'العقد هو مرجع النطاق والدفعات.'}),
    num('value','القيمة بالريال',true,{why:'القيمة تحدد حجم الفريق المخصص.'}),
    long('scope','النطاق والتزامات العميل',true,{why:'ما وُعد به العميل أثناء البيع ولم يُكتب في العقد يجب أن يعرفه فريق التشغيل الآن.',hint:'المخرجات، والوعود الشفهية، وما على العميل تقديمه.',min_length:10}),
    day('kickoff','موعد الانطلاق',true,{why:'الانطلاق يرتب حجز الفريق.'})],approval_policy:HEAD},
  {code:'ACC-RENEWAL',req:['ACC-10','ACC-01'],section:'إدارة الحسابات',department_id:'accounts',name_ar:'تجديد أو توسعة حساب عميل',name_en:'Account renewal or expansion',description:'فرصة تجديد أو خدمات إضافية لعميل قائم.',fields:[
    t('client','العميل',true,{why:'التجديد يُقرأ مع تاريخ العميل ورضاه.'}),
    day('renewal_date','موعد التجديد',true,{why:'الموعد يحدد متى يبدأ التحضير.'}),
    num('value','القيمة المتوقعة بالريال',true,{why:'القيمة تدخل توقعات الإيراد.'}),
    long('plan','الخطة',true,{why:'الخطة تربط العرض بما حققه العميل معنا.',min_length:10})],approval_policy:HEAD},
  // مكتب المشاريع
  {code:'PMO-SUBCONTRACT',req:['PMO-05','PMO-10'],section:'الموارد والطاقة',department_id:'epmo',name_ar:'إسناد عمل لطرف خارجي',name_en:'Subcontracting',description:'إسناد جزء من مشروع لمورد أو وكالة شريكة. الاعتماد لا يتعاقد مع الطرف الخارجي.',fields:[
    t('project','المشروع',true,{why:'التكلفة تُحمَّل على ميزانية هذا المشروع.'}),
    t('partner','الطرف الخارجي',true,{why:'الطرف يُتحقق من تسجيله موردًا قبل الإسناد.'}),
    long('scope','النطاق',true,{why:'النطاق المسند يحدد المسؤولية أمام العميل.',min_length:10}),
    pick('client_data','هل يطّلع على بيانات العميل',['نعم','لا'],true,{why:'اطلاع طرف ثالث على بيانات العميل قد يحتاج موافقة العميل واتفاقية سرية قبل البدء.'}),
    num('cost','التكلفة بالريال',true,{why:'التكلفة تُقارن بما سيُفوتر للعميل عن الجزء نفسه.'})],approval_policy:MANAGER_HEAD},
  {code:'PMO-CLOSURE',req:['PMO-09','ACC-08'],section:'دورة المشروع',department_id:'epmo',name_ar:'إقفال مشروع',name_en:'Project closure',description:'قبول العميل النهائي والمطابقة المالية والدروس.',fields:[
    t('project','المشروع',true,{why:'الإقفال يوقف تسجيل الساعات والمصروفات عليه.'}),
    pick('client_acceptance','قبول العميل',['مقبول','مقبول بملاحظات','غير مقبول'],true,{why:'المشروع غير المقبول لا يُقفل بل يُصعَّد.'}),
    num('final_cost','التكلفة الفعلية بالريال',true,{why:'التكلفة الفعلية تُقارن بالميزانية لقياس الربحية.'}),
    long('lessons','الدروس',true,{why:'الدروس تُقرأ عند فتح مشروع مشابه.',min_length:10})],approval_policy:HEAD},
  {code:'PMO-TIMESHEET',req:['PMO-06'],section:'الموارد والطاقة',department_id:'epmo',name_ar:'تصحيح ساعات المشروع',name_en:'Timesheet correction',description:'تصحيح ساعات مسجلة على مشروع خاطئ أو ناقصة.',fields:[
    t('project','المشروع',true,{why:'الساعات تُنقل إلى هذا المشروع أو تُضاف له.'}),
    day('date','التاريخ',true,{why:'التصحيح يقع على يوم بعينه في الكشف.'}),
    num('hours','الساعات',true,{why:'الساعات تؤثر في تكلفة المشروع وفوترته.'}),
    long('reason','السبب',true,{why:'تصحيح كشف مقفل يحتاج سببًا مفهومًا للمراجع.',hint:'المشروع الذي سُجلت عليه خطأً، إن وُجد.',min_length:5})],approval_policy:MANAGER_HEAD},
  // الحوكمة
  {code:'GOV-MEETING-ITEM',req:['GOV-08'],section:'القرارات والاجتماعات',department_id:'ceo-office',name_ar:'إدراج بند في اجتماع',name_en:'Executive meeting agenda item',description:'بند للنقاش أو القرار في الاجتماع التنفيذي القادم.',fields:[
    t('title','البند',true,{why:'العنوان يُدرج في جدول الأعمال.',max_length:150}),
    pick('type','النوع',['للعلم','للنقاش','للقرار'],true,{why:'البند للقرار يحتاج خيارات؛ للعلم يكفيه ملخص.'}),
    long('brief','الملخص',true,{why:'الحضور يقرؤون الملخص قبل الاجتماع؛ ما لا يُقرأ مسبقًا يُؤجل.',hint:'السياق، وما المطلوب من الاجتماع بجملة واحدة.',min_length:10}),
    day('meeting_date','الاجتماع المستهدف',true,{why:'التاريخ يحدد مهلة إعداد المادة.'})],approval_policy:MANAGER_HEAD},
  {code:'GOV-INITIATIVE',req:['GOV-02','GOV-05'],section:'الأهداف والمؤشرات',department_id:'epmo',name_ar:'تسجيل مبادرة إستراتيجية',name_en:'Strategic initiative',description:'مبادرة بمالك وميزانية ومؤشر ضمن المحفظة التنفيذية.',fields:[
    t('initiative','المبادرة',true,{why:'الاسم هو مرجعها في المحفظة.'}),
    t('objective','الهدف المرتبط',true,{why:'مبادرة لا تخدم هدفًا معتمدًا تنافس غيرها على الموارد بلا سند.'}),
    t('owner','المالك',true,{why:'المالك يُسأل عن الإنجاز.'}),
    num('budget','الميزانية بالريال',true,{why:'الميزانية تُحجز من المحفظة عند الاعتماد.'}),
    day('end_date','تاريخ الإنجاز',true,{why:'الموعد يُتابع في مراجعة المحفظة.'}),
    long('description','وصف المبادرة والأثر المتوقع',true,{why:'الأثر المتوقع يُقاس عليه النجاح عند الإغلاق.',min_length:10})],approval_policy:MANAGER_HEAD},
  // البيانات
  {code:'DAT-PROFITABILITY',req:['DAT-04'],section:'التقارير واللوحات',department_id:'campaigns-audit',name_ar:'تحليل ربحية مشروع أو عميل',name_en:'Project or client profitability',description:'الإيراد والتكلفة الفعلية والهامش من السجلات المالية ومعدلات التكلفة المعتمدة في المنصة.',fields:[
    t('subject','المشروع أو العميل',true,{why:'التحليل يُبنى على سجلات هذا المشروع أو العميل وحدها.'}),
    t('period','الفترة',true,{why:'الفترة تحدد الإيراد والتكلفة المحتسبة؛ مشروع لم يُقفل ربحيته مؤقتة.',example:'2026-01 إلى 2026-06'}),
    long('questions','الأسئلة',true,{why:'السؤال يحدد التفصيل: بالخدمة، بالفريق، أم بالشهر.',hint:'القرار الذي ينتظر التحليل: تجديد، تسعير، أو إعادة توزيع.',min_length:10})],approval_policy:HEAD},
  {code:'DAT-KNOWLEDGE',req:['DAT-06','DAT-07'],section:'المعرفة',department_id:'campaigns-audit',name_ar:'إضافة محتوى لقاعدة المعرفة',name_en:'Knowledge base contribution',description:'دليل أو إجراء أو قالب ليصبح قابلًا للبحث.',fields:[
    t('title','العنوان',true,{why:'العنوان هو ما يُبحث به؛ اكتبه بكلمات من سيبحث عنه.'}),
    pick('type','النوع',['دليل','إجراء','قالب','دراسة حالة'],true,{why:'الإجراء يحتاج اعتماد مالك العملية، والدليل لا.'}),
    long('summary','الملخص',true,{why:'الملخص يحدد هل يغني المحتوى عن سؤال زميل.',min_length:10}),
    t('owner','مالك المحتوى',true,{why:'المحتوى بلا مالك يتقادم دون أن يحدّثه أحد.'})],approval_policy:HEAD},
  {code:'DAT-DATA-QUALITY',req:['DAT-02'],section:'حوكمة البيانات',department_id:'campaigns-audit',name_ar:'بلاغ خطأ في بيانات',name_en:'Data quality issue',description:'رقم خاطئ أو مكرر أو ناقص في تقرير أو نظام.',fields:[
    t('source','المصدر',true,{why:'المصدر يحدد من يملك التصحيح.'}),
    long('issue','المشكلة',true,{why:'الرقم الظاهر والرقم الصحيح ومصدر الصحيح هي ما يُصحَّح به.',hint:'الرقم الظاهر، وما تتوقعه، ولماذا.',min_length:10}),
    pick('impact','الأثر',['قرار تنفيذي','تقرير عميل','تقرير داخلي'],true,{why:'رقم خاطئ وصل عميلًا يستدعي تصحيحًا معلنًا لا صامتًا.'})],approval_policy:HEAD},
  {code:'DAT-ROI',req:['DAT-10'],section:'التقارير واللوحات',department_id:'campaigns-audit',name_ar:'قياس عائد مبادرة',name_en:'Initiative ROI measurement',description:'خط أساس ونتيجة وتكلفة فعلية لقياس عائد مبادرة منفذة.',fields:[
    t('initiative','المبادرة',true,{why:'القياس يُربط بمبادرة مسجلة وأهدافها.'}),
    t('baseline','خط الأساس',true,{why:'العائد فرق عن نقطة بداية؛ بلا خط أساس لا عائد يُقاس.',hint:'القيمة وتاريخها ومصدرها.'}),
    t('result','النتيجة',true,{why:'النتيجة تُقاس بالطريقة نفسها التي قيس بها خط الأساس.'}),
    num('cost','التكلفة الفعلية بالريال',true,{why:'التكلفة الفعلية لا المخططة هي ما يُحسب عليه العائد.'}),
    long('method','طريقة القياس ومصادرها',false,{why:'الطريقة المكتوبة تتيح لغيرك التحقق من الرقم.'})],approval_policy:HEAD}
  ,
  // إدارة العلامة التجارية
  {code:'BRAND-COMPLIANCE',req:['CRT-05','CRT-08'],section:'الالتزام بالهوية',department_id:'brand',name_ar:'مراجعة التزام بالهوية',name_en:'Brand compliance review',description:'مراجعة مخرج أو مادة قبل النشر للتأكد من مطابقتها لدليل الهوية.',fields:[
    t('deliverable','المخرج ورقم النسخة',true,{why:'المراجعة تقع على نسخة بعينها؛ تعديل بعدها يستدعي مراجعة جديدة.'}),
    pick('channel','قناة النشر',['منصات التواصل','مطبوعات','موقع','فيديو','عرض تقديمي','أخرى'],true,{why:'لكل قناة قواعد مقاسات وألوان في دليل الهوية.'}),
    t('client','العميل أو الجهة',false,{why:'مخرج العميل يُراجع على دليل هويته هو لا هويتنا.'}),
    day('publish_date','تاريخ النشر المستهدف',true,{why:'الموعد يرتب المراجعة قبل النشر لا بعده.'}),
    long('notes','ملاحظات',false,{why:'استثناء متفق عليه مع العميل يُذكر هنا حتى لا يُعدّ مخالفة.'})],approval_policy:HEAD},
  {code:'BRAND-ASSET-CREATE',req:['CRT-06'],section:'الأصول الرقمية',department_id:'brand',name_ar:'إنشاء أصل هوية',name_en:'New brand asset',description:'شعار فرعي أو قالب أو أيقونات تُضاف إلى مكتبة الهوية المعتمدة.',fields:[
    pick('asset_type','نوع الأصل',['شعار فرعي','قالب عرض','قالب مستند','أيقونات','ألوان وخطوط','أخرى'],true,{why:'النوع يحدد المصمم ومستوى الاعتماد.'}),
    long('use_case','الاستخدام والمبرر',true,{why:'الأصل الجديد يُضاف للمكتبة فقط إن لم يكفِ القائم؛ المبرر يثبت ذلك.',hint:'أين سيُستخدم، ولماذا لا يصلح الأصل القائم.',min_length:10}),
    day('due_date','موعد الحاجة',true,{why:'الموعد يرتب العمل مع الاستوديو.'})],approval_policy:HEAD},
  {code:'BRAND-NAMING',req:['CRT-03'],section:'التسمية والاعتماد',department_id:'brand',name_ar:'اعتماد اسم أو تسمية',name_en:'Naming approval',description:'اعتماد اسم مبادرة أو منتج أو حملة قبل استخدامه خارج الشركة. الاعتماد لا يثبت خلو الاسم من حقوق الغير؛ ذلك فحص قانوني مستقل.',fields:[
    t('proposed_name','الاسم المقترح',true,{why:'الاسم هو موضوع الاعتماد.'}),
    long('alternatives','بدائل مقترحة',false,{why:'البدائل توفر جولة حين يُرفض الاسم الأول.'}),
    long('rationale','المبرر والجمهور',true,{why:'الاسم يُقيَّم بوقعه على جمهوره لا بذوق المعتمِد.',min_length:10}),
    pick('scope','نطاق الاستخدام',['داخلي','عميل','عام'],true,{why:'الاسم العام يحتاج فحص حقوق قبل استخدامه.'})],approval_policy:HEAD},
  {code:'BRAND-MERCH',req:['CRT-09'],section:'المطبوعات والهدايا',department_id:'brand',name_ar:'مطبوعات وهدايا دعائية',name_en:'Print and merchandise',description:'تنفيذ مطبوعات أو هدايا بالهوية. الشراء يمر بالمشتريات بعد الاعتماد.',fields:[
    long('items','الأصناف والكميات',true,{why:'الأصناف والكميات هي ما تُطلب عليه عروض الأسعار.',min_length:3}),
    pick('occasion','المناسبة',['فعالية','عميل','موظفون','معرض','أخرى'],true,{why:'المناسبة تحدد الرسالة والتصميم.'}),
    day('needed_by','مطلوب قبل',true,{why:'الطباعة والتوريد يحتاجان مهلة؛ الموعد يحدد الممكن.'}),
    num('budget','الميزانية التقديرية بالريال',false,{why:'الميزانية تحدد الجودة والكمية الممكنتين.'})],approval_policy:MANAGER_HEAD},
  // إدارة الحسابات
  {code:'ACC-BRIEF-INTAKE',req:['ACC-02','ACC-03'],section:'استقبال التكليفات',department_id:'accounts',name_ar:'استقبال تكليف من عميل',name_en:'Client brief intake',description:'تسجيل تكليف جديد من عميل قائم، وتحديد إن كان ضمن العقد قبل تحويله للتنفيذ.',fields:[
    t('client','العميل',true,{why:'التكليف يُقاس على عقد هذا العميل.'}),
    t('project','المشروع أو الحملة',true,{why:'المشروع يحدد الفريق المنفذ وميزانيته.'}),
    long('brief','التكليف كما ورد من العميل',true,{why:'نص العميل كما هو يمنع تفسيرًا يُكتشف خطؤه عند التسليم.',hint:'انقل كلام العميل، ثم أضف ما فهمته منفصلًا.',min_length:10}),
    day('due_date','الموعد المطلوب',true,{why:'الموعد يُقارن بحمل الفريق قبل الالتزام أمام العميل.'}),
    pick('scope_status','النطاق ضمن العقد',['ضمن العقد','خارج العقد','يحتاج تأكيدًا'],true,{why:'ما هو خارج العقد يُسعَّر قبل التنفيذ، لا بعده.'})],approval_policy:HEAD},
  {code:'ACC-STATUS-REPORT',req:['ACC-07'],section:'التقارير والاجتماعات',department_id:'accounts',name_ar:'تقرير حالة للعميل',name_en:'Client status report',description:'تقرير دوري بما أُنجز وما هو قيد التنفيذ وما ينتظر قرار العميل. المنصة لا ترسله للعميل.',fields:[
    t('client','العميل',true,{why:'التقرير يُبنى على مشاريع هذا العميل.'}),
    t('period','الفترة',true,{why:'الفترة تحدد ما يُذكر من إنجاز.'}),
    pick('frequency','التكرار',['أسبوعي','نصف شهري','شهري','مرة واحدة'],true,{why:'التكرار المتفق عليه مع العميل التزام يُتابع.'}),
    day('due_date','موعد الإرسال',true,{why:'الموعد يرتب جمع البيانات من الفرق.'}),
    long('highlights','أبرز ما يُذكر في التقرير',false,{why:'ما ينتظر قرار العميل هو أهم ما في التقرير؛ يُذكر أولًا.'})],approval_policy:HEAD},
  {code:'ACC-MEETING-MINUTES',req:['ACC-07','ACC-04'],section:'التقارير والاجتماعات',department_id:'accounts',name_ar:'محضر اجتماع عميل وقراراته',name_en:'Client meeting minutes',description:'توثيق قرارات اجتماع العميل والالتزامات المترتبة عليها وأصحابها.',fields:[
    t('client','العميل',true,{why:'المحضر يُحفظ في سجل العميل.'}),
    day('meeting_date','تاريخ الاجتماع',true,{why:'التاريخ يرتب القرارات زمنيًا حين يتعارض قرار لاحق مع سابق.'}),
    long('attendees','الحضور',true,{why:'الحضور يحددون من التزم بماذا.',hint:'الاسم والجهة، دون بيانات اتصال.'}),
    long('decisions','القرارات والالتزامات',true,{why:'الالتزام بلا صاحب وموعد لا يُتابع.',hint:'القرار، ثم صاحبه، ثم موعده، في كل سطر.',min_length:10}),
    day('follow_up','موعد المتابعة',false,{why:'موعد المتابعة يُذكَّر به قبل حلوله.'})],approval_policy:HEAD},
  {code:'ACC-ESCALATION',req:['ACC-09'],section:'متابعة الحساب',department_id:'accounts',name_ar:'تصعيد حساب عميل',name_en:'Account escalation',description:'حساب متعثر أو علاقة في خطر تحتاج تدخل الإدارة قبل فقد العميل.',fields:[
    t('client','العميل',true,{why:'التصعيد يُقرأ مع قيمة العميل وتاريخه.'}),
    pick('risk','مستوى الخطر',['خطر فقد العميل','تأخر متكرر','خلاف على النطاق','تأخر سداد'],true,{why:'نوع الخطر يحدد من يتدخل: القيادة أم المالية أم التشغيل.'}),
    long('background','الخلفية',true,{why:'ما جرى حتى الآن يمنع تدخلًا يكرر ما فشل.',min_length:10}),
    long('proposed_action','الإجراء المقترح',true,{why:'التصعيد مع اقتراح يُحسم؛ وبدونه يُعاد إليك.',min_length:5})],approval_policy:MANAGER_HEAD}
];

// ── أعلام السياسة (تدقيق سير العمل B3 وB6) ──────────────────────────────────────
// الأعلام لا تغيّر من يعتمد: الخطوات كما هي.
// B3 — sod يمنع من اعتمد أي خطوة من الاستلام والإغلاق، ولذلك يصير المنفذ أي عضو نشط في الإدارة المنفذة (member)
// حتى لا يتوقف الطلب عند مدير واحد يعتمد ولا ينفذ.
// كان sod مقترحًا في policyProposals لا يُشغَّل إلا بتبنٍّ، فشُحنت المنصة والضابط مُطفأ على الاثنتين والعشرين كلها:
// أعاد فريقٌ مستقل قياسَها فمشى الاثنتين والعشرين إنشاءً واعتمادًا، ثم استلمها من اعتمدها نفسه، فردّ الخادم 201
// في اثنتين وعشرين من اثنتين وعشرين — منها وجهة الراتب وآيبان المورد ومنح الصلاحية وأمر الصرف والسلفة.
// فصار sod جزءًا من تعريف الخدمة نفسه كما صارت السرية (CONFIDENTIAL_SERVICES أدناه): ضابطٌ تحمله المنصة
// لا خيارٌ ينتظر قرار كيان. والخدمات العادية لا تُمَس، وجمعُها يُسجَّل ويُعرض في فحص الكتالوج ولا يُمنع.
export const SOD_SERVICES=[
  // مال
  'FIN-PAYMENT-REQUEST','FIN-REFUND','FIN-BUDGET-TRANSFER','FIN-CUSTODY','PRC-VENDOR-BANK','PRC-PURCHASE-REQUEST','PRC-EMERGENCY','PRC-PO-CHANGE',
  'INF-PROOF-PAYMENT','DIG-BUDGET-CHANGE','ADM-EXPENSE-CLAIM','HR-SALARY-ADVANCE','HR-RETRO-ADJUSTMENT','HR-BANK-CHANGE','HR-GOSI-CORRECTION','HR-JOB-CHANGE',
  // صلاحيات
  'IT-ACCESS','IT-NEW-ACCOUNT','IT-CHANGE-REQUEST','DIG-AD-ACCOUNT','DAT-DATA-ACCESS',
  // بيانات شخصية
  'LEG-PRIVACY-REQUEST'
];
// B6 — السرية: الرؤية لصاحب الطلب ومعتمدي نسختهم والمسند إليه ومدير الإدارة المنفذة ومن أُسندت له مهمة فيه، لا لكل فريق الإدارة.
// مُطبَّقة في الكتالوج مباشرة (لا تغيّر المعتمد ولا المنفذ). خطوة المدير المباشر في HR-SALARY-ADVANCE وHR-BENEFIT-CLAIM
// وHR-EXIT-INTERVIEW باقية: حذفها قرار مالك الإجراء (الموارد البشرية).
export const CONFIDENTIAL_SERVICES=[
  'HR-GRIEVANCE','HR-SALARY-ADVANCE','HR-BENEFIT-CLAIM','HR-BANK-CHANGE','HR-EXIT-INTERVIEW',
  'HR-SALARY-CERT','HR-PAYROLL-INQUIRY','HR-RETRO-ADJUSTMENT','HR-GOSI-CORRECTION','LEG-WHISTLEBLOW'
];
// ── الدائرة المغلقة: بلاغٌ عن شخص ───────────────────────────────────────────────
// السرية تضيّق من يقرأ؛ وهاتان الخدمتان أضيق: موضوعهما إنسان قد يكون أيَّ أحد خارج من سُمّي لهما،
// ومنه مرجعُ تصعيد الإدارة نفسه. فحين لا يبقى في إدارتهما منفّذ، لا يصعد التنفيذ في سُلَّم التصعيد كما
// يصعد في غيرهما: يقف عند رفضٍ مكتوب يطلب نائبًا مسمًّى لهذه الخدمة بعينها — تسميةٌ فعلُ شخصين تقول
// بالاسم من يُؤذن له بقراءة هذا النوع من البلاغات. رصدت هذا الطريقَ إعادةُ القياس (العطب 6) في
// HR-GRIEVANCE وLEG-WHISTLEBLOW بعينهما. وبقية السرية يغطيها السُّلَّم، وشاشة الطلب تقول من وصله وبأي سند.
export const CLOSED_CIRCLE_SERVICES=['HR-GRIEVANCE','LEG-WHISTLEBLOW'];
for(const service of catalogServices){
  if(SOD_SERVICES.includes(service.code))service.approval_policy={...service.approval_policy,sod:true,handler_role:'member'};
  if(CONFIDENTIAL_SERVICES.includes(service.code))service.approval_policy={...service.approval_policy,confidential:true};
  if(CLOSED_CIRCLE_SERVICES.includes(service.code))service.approval_policy={...service.approval_policy,closed_circle:true};
}

// ── C1: مسارات لا تناسب خطورة ما تقرره (مسح 20 سبتمبر، القسم 4-أ) ────────────────
// ست عشرة خدمة مسارها خطوة واحدة: الشخص نفسه يقرر ثم ينفّذ ما قرر. المقترح يضيف الخطوة الناقصة
// ويبقي القائمة كما هي، فلا يُمَس مسار حيّ بلا تبنٍّ مسجل من مالك الإجراء. `reason` يظهر في شاشة التبني
// فيقرأ المالك لماذا قبل أن يقرر — لا «تحسين مسار» بل «يمسّ بيانات دفع مورد».
// الصياغة: أي خدمة مالية تمر بالمالية، وأي خدمة تمسّ أجرًا تمر بالمدير المباشر قبل الموارد البشرية،
// وأي صلاحية أو بيانات شخصية تمر بالجهة الطالبة أو بالحوكمة.
const FINANCE={role:'department_manager',department:'finance'};
const BUSINESS={role:'department_manager',department:'business-dev'};
export const CHAIN_PROPOSALS=[
  {code:'PRC-VENDOR-BANK',steps:['department_manager',FINANCE],
    reason:'يمسّ بيانات دفع مورد: تغيير الآيبان ناقل احتيال معروف، فيلزمه تحقق مالي مستقل عن المشتريات. (التحقق المالي المسجل في ملف المورد صار لازمًا للإغلاق أصلًا، بلا تبنٍّ؛ هذا المقترح يضيف خطوة اعتماد من المالية قبله.)'},
  {code:'FIN-BUDGET-TRANSFER',steps:['department_manager',{role:'executive'}],
    reason:'ينقل مالًا بين بنود الميزانية: قرار فرد واحد اليوم، بلا خطوة من الرئاسة التي تملك البنود.'},
  {code:'HR-BANK-CHANGE',steps:['manager','hr'],
    reason:'يغيّر وجهة الراتب: تحويل راتب موظف إلى حساب آخر بقرار موظف واحد في الموارد البشرية.'},
  {code:'HR-GOSI-CORRECTION',steps:['hr',FINANCE],
    reason:'يغيّر الأجر الخاضع للاشتراك: أثر نظامي على التأمينات وعلى المسير، فيلزمه نظر المالية.'},
  {code:'HR-JOB-CHANGE',steps:['manager','hr'],
    reason:'يغيّر المسمى والدرجة: قرار فرد اليوم، بلا خطوة من مدير الموظف الذي يقع عليه التغيير.'},
  {code:'DIG-BUDGET-CHANGE',steps:['department_manager',FINANCE],
    reason:'يغيّر إنفاقًا إعلانيًا حيًّا: يقرره اليوم من يملك الحملة نفسها، بلا نظر مالي.'},
  {code:'DIG-AD-ACCOUNT',steps:['manager','department_manager'],
    reason:'يمنح صلاحية إنفاق على منصة خارجية: صلاحية مال بقرار مدير التسويق وحده، بلا طلب موثق من مدير طالبها.'},
  {code:'INF-PROOF-PAYMENT',steps:['department_manager',FINANCE],
    reason:'إقرار بالتنفيذ يسبق السداد: تصدره اليوم الجهة الطالبة نفسها، بلا تحقق من المالية قبل الصرف.'},
  {code:'LEG-PRIVACY-REQUEST',steps:['department_manager',{role:'executive'}],
    reason:'طلب صاحب بيانات شخصية له أثر نظامي ومهلة: خطوة واحدة وعشرة أيام، بلا مرجع أعلى يتحمل أثر التأخر.'},
  {code:'IT-NEW-ACCOUNT',steps:['manager','it'],
    reason:'ينشئ هوية جديدة في الأنظمة: يقرره اليوم مدير التقنية وحده، بلا طلب موثق من الجهة التي سيعمل فيها صاحب الحساب.'},
  // إدارة الحسابات: ست خدمات بخطوة واحدة عند مديرها. اثنتان منها التزام تجاري يمسّ النطاق والسعر.
  {code:'ACC-CHANGE-REQUEST',steps:['department_manager',BUSINESS],
    reason:'طلب تغيير من عميل يمسّ النطاق والسعر: التزام تجاري يقرره اليوم مدير الحسابات وحده، بلا إدارة الأعمال.'},
  {code:'ACC-RENEWAL',steps:['department_manager',BUSINESS],
    reason:'تجديد أو توسعة حساب عميل: التزام تعاقدي يقرره اليوم مدير الحسابات وحده، بلا إدارة الأعمال.'},
  {code:'ACC-BRIEF-INTAKE',steps:['manager','department_manager'],
    reason:'استقبال تكليف عميل يلزم الفرق بعمل: يُقبل اليوم بلا خطوة من مدير الفريق الذي سينفّذه.'},
  {code:'ACC-CLIENT-COMPLAINT',steps:['department_manager',BUSINESS],
    reason:'شكوى عميل: تُغلق اليوم داخل الإدارة المشكو منها نفسها، بلا نظر مستقل.'},
  {code:'ACC-MEETING-MINUTES',steps:['manager','department_manager'],
    reason:'محضر اجتماع عميل وقراراته: يصير مرجعًا لما التُزم به، فيلزمه إقرار من حضر عن الفريق لا من كتبه وحده.'},
  {code:'ACC-STATUS-REPORT',steps:['manager','department_manager'],
    reason:'تقرير حالة يذهب للعميل باسم الشركة: يُعتمد اليوم ممن أعدّه، بلا مراجعة ثانية.'}
];
// أما التصريح القائم الذي لم تستدعه «تحديث بيانات دفع مورد» قط (vendors.bank)، فقد عدّه التدقيق عطبًا لا مقترحًا،
// وأُصلح مباشرة بلا تبنٍّ: vendorBankGate في service-routes.mjs.

// ── سياسات مقترحة تحتاج تبنّيًا مسجلًا (B2 وC1) ─────────────────────────────────
// لا تُثبَّت تلقائيًا: اختبارا CATALOG وREVIEW المسجلان يشترطان مسار اعتماد لكل خدمة في الكتالوج، واختبار LIFECYCLE
// ينفذ كل خدمة بمن اعتمدها. كل مقترح دالة على سياسة الكتالوج الحالية، فيتبع أي تعديل لاحق لتعريف الخدمة.
// المثبِّت يطبق كل مقترح متبنى (approval_policy_adoptions) بترتيب هذه القائمة، ويرجع عنه سجل withdraw.
// أما فصل المهام (B3) فلم يعد مقترحًا ينتظر تبنّيًا: صار في تعريف الخدمة نفسها لكل واحدة من SOD_SERVICES،
// لأن شحنه مُطفأً كان يعني أن من اعتمد ينفّذ في اثنتين وعشرين خدمة حسّاسة يوم التسليم.
const direct=()=>({steps:[],mode:'direct',handler_role:'manager'});
export const policyProposals=[
  {key:'b2-safety-direct',code:'ADM-SAFETY',item:'B2',apply:direct,reason:'بلاغ السلامة يصل المنفذ فور تقديمه بدل انتظار اعتماد مدير المكتب.'},
  {key:'b2-issue-alert-direct',code:'PR-ISSUE-ALERT',item:'B2',apply:direct,reason:'تنبيه الأزمة الإعلامية يُعالج فور وصوله.'},
  // «بدل فاقد» خيار داخل الخدمة لا خدمة مستقلة؛ فالخطوتان مشروطتان بغيره، وبدل الفاقد يمر مباشرة لتعطيل البطاقة.
  {key:'b2-lost-card-direct',code:'ADM-ACCESS-CARD',item:'B2',
    apply:policy=>({...policy,steps:[{role:'manager',when:{field:'action',not_in:['بدل فاقد']}},{role:'department_manager',when:{field:'action',not_in:['بدل فاقد']}}],mode:'direct'}),
    reason:'البطاقة المفقودة تُعطَّل عند استلام الطلب، والإصدار الجديد وتعديل الصلاحية يبقيان باعتماد المدير ثم المكتب.'},
  ...CHAIN_PROPOSALS.map(p=>({key:`c1-chain-${p.code.toLowerCase()}`,code:p.code,item:'C1',
    apply:policy=>({...policy,steps:p.steps}),reason:p.reason}))
];
const adoptionOf=(db,tenantId,code,key)=>db.prepare('SELECT * FROM approval_policy_adoptions WHERE tenant_id=? AND service_code=? AND proposal_key=? ORDER BY adopted_at DESC,rowid DESC LIMIT 1').get(tenantId,code,key)??null;
export function effectivePolicy(db,definition,tenantId='36t'){
  let policy=definition.approval_policy;
  for(const proposal of policyProposals.filter(p=>p.code===definition.code))if(adoptionOf(db,tenantId,proposal.code,proposal.key)?.policy)policy=proposal.apply(policy);
  return policy;
}
// تبنّي مقترح (أو الرجوع عنه بـ withdraw:true): نسخة خدمة جديدة بالسياسة المقترحة، وسجل إلحاقي بالسند.
export function adoptPolicyProposal(db,supplied,key,input){
  if(!db.isTransaction)fail(500,'transaction_required','الكتابة تبي معاملة قاعدة بيانات');
  const u=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied?.id,supplied?.tenant_id);
  const proposal=policyProposals.find(p=>p.key===key);
  if(!u||u.role!=='admin'||!can(db,u,'catalog.manage'))fail(403,'not_permitted','تبنّي سياسة الاعتماد لمسؤول دليل الخدمات وبس');
  if(!proposal)fail(404,'not_found','ما لقينا المقترح هذا');
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['basis','withdraw'].includes(k)))fail(400,'invalid_fields','حقول الطلب مو صحيحة');
  const basis=typeof input.basis==='string'?input.basis.trim():'';
  if(basis.length<10||basis.length>1000)fail(400,'basis','اكتب سند التبنّي: مين قرره ومتى');
  const definition=catalogServices.find(s=>s.code===proposal.code);
  const current=db.prepare("SELECT * FROM services s WHERE tenant_id=? AND code=? AND version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)").get(u.tenant_id,proposal.code);
  if(!definition||!current)fail(409,'service_missing','ثبّت الكتالوج قبل ما تتبنّى المقترح');
  // ── الحارس الذي كان ناقصًا (قرار 21 سبتمبر) ────────────────────────────────────
  // proposalImpact كانت تُحسب وتُعرض في الشاشة ثم لا تُستشار لحظة التبني: فتبنّي «فصل المهام» يمضي
  // ويترك 13 خدمة مال وصلاحيات بلا منفذ. الآن تُستشار قبل الكتابة، ويُرفض تبنٍّ يقطع آخر منفذ للخدمة.
  if(input.withdraw!==true){
    const impact=proposalImpact(db,u.tenant_id,proposal);
    const strands=(impact?.warnings??[]).filter(w=>['sod_no_executor','no_executor'].includes(w.kind)&&!w.resolved);
    if(strands.length){
      const department=db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(current.department_id,u.tenant_id)?.name??current.department_id;
      refuse(409,'adoption_strands_service',{
        what:`تبنّي هذا المقترح يترك «${current.name_ar}» بلا منفذ في «${department}»`,
        missing:[{document:`نائب منفّذ مقبول لخدمة ${proposal.code}`,why:strands[0].message,
          owner:'من يدير الهيكل والتصعيد',owner_role:'structure.manage'}],
        next:`سمِّ نائبًا منفّذًا للخدمة من «إعداد الاعتماد» ويقبله شخص ثانٍ، أو سجّل مرجع تصعيد لـ«${department}»، ثم أعد التبني`,
        link:'#approval-settings'});
    }
  }
  // الأثر على السياسة المخزنة: كل المقترحات المتبناة للخدمة، مع إضافة هذا المقترح أو سحبه.
  const others=policyProposals.filter(p=>p.code===proposal.code&&p.key!==proposal.key&&adoptionOf(db,u.tenant_id,p.code,p.key)?.policy);
  let target=definition.approval_policy;
  for(const p of policyProposals)if(others.includes(p)||(p===proposal&&input.withdraw!==true))target=p.apply(target);
  const policy=input.withdraw===true?null:target;
  let version=current.version;
  if(stable(JSON.parse(current.approval_policy))!==stable(target)){
    const {req,section,...rest}=definition;
    version=createService(db,u,{...rest,fields:JSON.parse(current.fields),approval_policy:target,name_ar:current.name_ar,name_en:current.name_en,description:current.description,department_id:current.department_id}).version;
  }
  db.prepare('INSERT INTO approval_policy_adoptions(id,tenant_id,service_code,proposal_key,policy,basis,adopted_by,adopted_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),u.tenant_id,proposal.code,proposal.key,policy?JSON.stringify(policy):null,basis,u.id,now());
  audit(db,u,'service',proposal.code,policy?'service.policy_adopted':'service.policy_withdrawn',{version:current.version},{version,proposal:proposal.key},basis);
  return {code:proposal.code,version,adopted:!!policy};
}

// ── حال فصل المهام على الاثنتين والعشرين، كما هو مخزَّن لا كما يُفترض ────────────────
// لم تعد هناك دالة «تشغيل»: الضابط في تعريف الخدمة، فيصل مُشغَّلًا مع الكتالوج. تبقى هذه القراءة لأن
// الادّعاء وحده لا يكفي: تقرأ نسخة كل خدمة المخزَّنة في هذا الكيان وتقول أيها بلغها الضابط وأيها لم يبلغها
// (قاعدة زميل ثُبّت فيها الكتالوج قبل هذا التغيير)، فيُقرأ النقص نقصًا لا صمتًا.
export function separationOfDutiesState(db,tenantId){
  // includeHidden عمدًا (مراجعة 22 سبتمبر): خدمةٌ أوقفها المالك بمفتاح الإعدادات موجودةٌ في الدليل ونسختها
  // تحمل الضابط وطلباتها المفتوحة تمشي به؛ فقراءتها من الدليل المرشَّح كانت تجعلها «ناقصة من الكتالوج»
  // وتُسلّم القارئ خطوةً لا تغيّر شيئًا («ثبّت الدليل» لخدمة مثبَّتة). النقص يُقرأ نقصًا، والإيقاف إيقافًا،
  // ولا يُقرأ أحدهما بالآخر.
  const stored=new Map(catalog(db,{tenant_id:tenantId},{includeHidden:true}).map(s=>[s.code,s]));
  const hidden=hiddenServiceCodes(db,tenantId);
  const off=SOD_SERVICES.filter(code=>stored.has(code)&&!stored.get(code).approval_policy.sod);
  const missing=SOD_SERVICES.filter(code=>!stored.has(code));
  const stopped=SOD_SERVICES.filter(code=>stored.has(code)&&hidden.has(code));
  return {services:SOD_SERVICES.length,on:SOD_SERVICES.length-off.length-missing.length,off,missing,
    // الموقوفة دلوها الخاص: الضابط عليها مشتغل («on» يعدّها)، ولا يُفتح منها طلب جديد حتى يعيد المالك تفعيلها.
    stopped,
    // «ثبّت الكتالوج» هي الخطوة، لا «تبنَّ مقترحًا»: لم يعد للضابط مقترح يُتبنّى. والموقوفة ليست نقصًا فلا خطوة لها هنا.
    next:off.length||missing.length?'ثبّت دليل الخدمات (installServiceCatalog) لتصل نسخة الخدمة التي تحمل فصل المهام':''};
}

// ── C2: زمن الخدمة بالساعات، مقترحًا (مسح 20 سبتمبر، العطب 9 والقسم 4-ب) ──────────
// خمس خدمات تقول بطاقاتها إنها لا تحتمل التأجيل، وأقصر ما كان الدليل يقبله «يوم عمل واحد»:
// بلاغ الخميس ظهرًا يستحق الأحد. الساعات صارت ممكنة (ترحيل 115)، والرقم نفسه يبقى قرار مالك الإجراء:
// يُعرض مقترحًا في شاشة التبني بسنده، ولا يُطبَّق بلا قرار مسجل. الثمانون الباقية لا تُمَس، وتُدرج للمراجعة.
export const TARGET_PROPOSALS=[
  {key:'c2-hours-it-security-incident',code:'IT-SECURITY-INCIDENT',days:1,hours:2,
    reason:'بلاغ أمني: بطاقتها تقول «يصل مباشرة»، وزمنها اليوم يوم عمل كامل. ساعتا عمل تعني أن بلاغ الخميس ظهرًا يُنظر فيه الخميس.'},
  {key:'c2-hours-it-outage',code:'IT-OUTAGE',days:1,hours:2,
    reason:'بلاغ توقف خدمة: النظام متوقف والعمل متوقف معه؛ يوم عمل كامل ليس زمن استجابة لانقطاع.'},
  {key:'c2-hours-it-password-unlock',code:'IT-PASSWORD-UNLOCK',days:1,hours:1,
    reason:'فك قفل حساب: الموظف محجوب عن عمله كله حتى يُفك؛ ساعة عمل واحدة.'},
  {key:'c2-hours-adm-safety',code:'ADM-SAFETY',days:1,hours:2,
    reason:'بلاغ سلامة: الخطر لا ينتظر يوم عمل، والبطاقة نفسها تصفه بما لا يحتمل التأجيل.'},
  {key:'c2-hours-pr-issue-alert',code:'PR-ISSUE-ALERT',days:1,hours:2,
    reason:'تنبيه قضية إعلامية: أثر التأخر ساعةً بساعة، ويوم عمل كامل يعني أن القضية انتشرت قبل أن تُقرأ.'}
];
const targetAdoptionOf=(db,tenantId,key)=>db.prepare('SELECT * FROM service_target_adoptions WHERE tenant_id=? AND proposal_key=? ORDER BY decided_at DESC,rowid DESC LIMIT 1').get(tenantId,key)??null;
// مدير الإدارة كما تعرفه البيانات: من تسجّله `department_routing` معتمِدًا لخطوة «مدير الإدارة»، أو مديرٌ نشط منسوب إليها.
// لا ثالث، ولا يُستنتج من الاسم: هذه هي العلاقة نفسها التي يمشي بها الاعتماد.
export const headsDepartment=(db,u,departmentId)=>!!departmentId&&(
  (u.role==='manager'&&u.department_id===departmentId)
  ||!!db.prepare("SELECT 1 FROM department_routing WHERE tenant_id=? AND department_id=? AND step_role='department_manager' AND user_id=?").get(u.tenant_id,departmentId,u.id));
// الخدمة التي يملك هذا الحساب تبنّي زمنها: خدمةٌ قائمة في الدليل، وإدارتُها إدارتَه.
const directoryService=(db,tenantId,code)=>db.prepare(`SELECT s.code,s.name_ar,s.department_id,d.target_days,d.target_hours,d.updated_by
  FROM services s LEFT JOIN service_directory d ON d.tenant_id=s.tenant_id AND d.service_code=s.code
  WHERE s.tenant_id=? AND s.code=? AND s.active=1 AND s.version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)`).get(tenantId,code)??null;

// تبنّي زمن خدمة أو رفضه. مدخلان لبابٍ واحد:
//   (1) مفتاح مقترح من TARGET_PROPOSALS — الخمس التي لا تحتمل التأجيل، بالساعات، لمسؤول دليل الخدمات.
//   (2) رمز خدمة — مدير الإدارة المالكة يتبنّى الزمن المسجَّل لخدمته كما هو، أو يعلن أنه ليس التزامه.
// القرار في الحالين مسجل بسنده في سجل إلحاقي، والرفض يبقى مسجلًا فلا يُعاد عرضه كأنه لم يُحسم.
export function decideServiceTarget(db,supplied,key,input){
  if(!db.isTransaction)fail(500,'transaction_required','الكتابة تبي معاملة قاعدة بيانات');
  const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','ما لقينا حسابك، ولا هو موقوف — كلّم مسؤول المنصة');
  const proposal=TARGET_PROPOSALS.find(p=>p.key===key);
  const service=proposal?null:directoryService(db,u.tenant_id,String(key??'').toUpperCase());
  if(!proposal&&!service)fail(404,'not_found','ما فيه مقترح زمن بهذا المفتاح ولا خدمة بهذا الرمز');
  if(proposal&&(!can(db,u,'catalog.manage')||u.role!=='admin'))fail(403,'not_permitted','تبنّي زمن الخدمة المقترح بالساعات لمسؤول دليل الخدمات وبس');
  if(service&&!headsDepartment(db,u,service.department_id)){
    const department=db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(service.department_id,u.tenant_id)?.name??service.department_id;
    refuse(403,'not_permitted',{what:`زمن «${service.name_ar}» يتبنّاه مدير «${department}» وحده`,
      missing:[{document:`قرار مدير «${department}» على زمن ${service.code}`,why:'زمن خدمة إدارة أخرى ليس التزامًا تقطعه عنها',owner:`مدير «${department}»`,owner_role:'department_manager'}],
      next:'اطلب من مدير الإدارة المالكة للخدمة أن يتبنّى زمنها من شاشة «إعداد الاعتماد»، أو تبنَّ أزمنة خدمات إدارتك أنت',
      link:'#approval-settings'});
  }
  v.object(input,['decision','basis']);
  if(!['adopt','reject','withdraw'].includes(input.decision))fail(400,'decision','القرار: تبنٍّ ولا رفض ولا رجوع');
  const basis=v.text(input.basis,'سند القرار: من قرره ومتى',1000,10);
  const code=proposal?proposal.code:service.code;
  const row=db.prepare('SELECT target_days,target_hours,updated_by FROM service_directory WHERE tenant_id=? AND service_code=?').get(u.tenant_id,code);
  if(!row)fail(409,'service_missing','ثبّت الكتالوج قبل ما تتبنّى زمنه');
  const decision={adopt:'adopted',reject:'rejected',withdraw:'withdrawn'}[input.decision];
  // القيمة المتبنّاة: رقم المقترح في المسار الأول، والرقم المسجَّل كما هو في تبنّي مدير الإدارة — لا يغيّر التبني رقمًا،
  // بل ينقله من «مشتق لم يتبنّه أحد» إلى «التزام قطعه من يملكه».
  const days=proposal?proposal.days:row.target_days,hours=proposal?proposal.hours:row.target_hours??null;
  if(service&&decision==='adopted'){
    if(!days&&!hours)fail(409,'target_unset','ما فيه زمن مسجَّل لهذي الخدمة في الدليل، فما فيه شي يُتبنّى');
    // «معِدّ القيمة لا يعتمدها»: من كتب الرقم في الدليل لا يكون هو من يتبنّاه.
    if(row.updated_by===u.id)fail(409,'separation_of_duties','اللي سجّل زمن الخدمة في الدليل ما يتبنّاه — التبنّي قرار شخص ثاني');
  }
  if(proposal&&decision==='adopted')setServiceTarget(db,u,proposal.code,proposal.days,proposal.hours);
  if(proposal&&decision==='withdrawn')setServiceTarget(db,u,proposal.code,row.target_days??defaultTargetDays({code:proposal.code,fields:fieldModel(proposal.code)??[]}),null);
  db.prepare('INSERT INTO service_target_adoptions(id,tenant_id,service_code,proposal_key,decision,target_days,target_hours,previous_days,previous_hours,basis,decided_by,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),u.tenant_id,code,proposal?proposal.key:code,decision,decision==='adopted'?days:null,decision==='adopted'?hours:null,row.target_days??null,row.target_hours??null,basis,u.id,now());
  audit(db,u,'service',code,`service.target_${decision}`,{target_days:row.target_days,target_hours:row.target_hours},{proposal:proposal?proposal.key:code,target_days:decision==='adopted'?days:null,target_hours:decision==='adopted'?hours:null},basis);
  return {code,decision};
}

export const baseServiceSections={'HR-LETTER':'الشهادات والخطابات','IT-SUPPORT':'الدعم الفني','CREATIVE-BRIEF':'التكليفات الإبداعية'};

// Service level in working-day terms, proposed by service family until each owner signs off on its own target.
export function defaultTargetDays(service){
  const code=service.code,urgent=service.fields?.some?.(f=>f.key==='urgency');
  if(/^IT-(SECURITY|OUTAGE|PASSWORD)/.test(code)||/^ADM-SAFETY/.test(code)||/^PR-ISSUE/.test(code))return 1;
  if(/^PRC-EMERGENCY/.test(code))return 2;
  if(urgent||/^IT-/.test(code)||/^ADM-(MAINTENANCE|ROOM|SUPPLIES|VISITOR)/.test(code))return 2;
  if(/^(HR|TAL)-/.test(code))return 3;
  if(/^(ADM|EXP|CRT|DIG|PR|INF|PRO)-/.test(code))return 5;
  if(/^(FIN|PRC|ACC|CRM|PMO|DAT|STR)-/.test(code))return 7;
  return 10;
}
// مقارنة بالمضمون لا بترتيب المفاتيح، حتى لا يُعاد إصدار خدمة لم تتغير.
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export function installServiceCatalog(db){
  // الحارس يقرأ حقيقةً مسجَّلة لا اسم عرض (الترحيل 137). كان يطابق الاسم «3,6T — بيئة تجريبية» بحرفه،
  // فصار اسمُ الشركة على الشاشة اعتماديةً صلبة: تسميتها باسمها تُعطِّل المثبِّت. والمقصود من الحارس أصلًا
  // أن المثبِّت — وهو يعيد كتابة الدليل كله — لا يُشغَّل على بيانات صارت بيانات الشركة؛ وهذا ما يقوله demo_data.
  const tenant=db.prepare("SELECT name,demo_data FROM tenants WHERE id='36t'").get();
  if(!tenant)throw new Error('Tenant 36t not found. Run setup before installing the catalog.');
  if(tenant.demo_data!==1)throw new Error('Tenant 36t is marked as holding real company data. The catalog installer rewrites the whole catalogue and does not run on it.');
  const admin=db.prepare("SELECT * FROM users WHERE id='admin' AND tenant_id='36t' AND role='admin' AND active=1").get();
  const template=db.prepare("SELECT password_hash FROM users WHERE id='manager' AND tenant_id='36t'").get();
  if(!admin||!template)throw new Error('Run setup before installing the catalog.');
  return transaction(db,()=>{
    const created={departments:0,renamed:0,heads:0,routing:0,escalation:0,services:0,moved:0,revised:0,sections:0,targets:0,retired:0};
    for(const d of companyDepartments){
      const existing=db.prepare('SELECT * FROM departments WHERE id=?').get(d.id);
      if(existing&&existing.tenant_id!=='36t')throw new Error('Department id belongs to another tenant: '+d.id);
      if(!existing){
        db.prepare("INSERT INTO departments(id,tenant_id,name,sector) VALUES(?,'36t',?,?)").run(d.id,d.name,d.sector);
        audit(db,admin,'department',d.id,'department.created',{}, {name:d.name,sector:d.sector});created.departments++;
      }else if(existing.name!==d.name||existing.sector!==d.sector||!existing.active){
        db.prepare('UPDATE departments SET name=?,sector=?,active=1 WHERE id=?').run(d.name,d.sector,d.id);
        audit(db,admin,'department',d.id,'department.updated',{name:existing.name,sector:existing.sector,active:existing.active},{name:d.name,sector:d.sector,active:1});created.renamed++;
      }
      if(!d.head)continue;
      const head=db.prepare('SELECT * FROM users WHERE id=? OR username=?').get(d.head,d.head);
      if(head&&(head.tenant_id!=='36t'||head.role!=='manager'))throw new Error('Existing account differs; not changing it: '+d.head);
      if(!head){
        db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) VALUES(?,'36t',?,?,?,?,'manager')").run(d.head,d.id,d.head,'مدير '+d.name+' (تجريبي)',template.password_hash);
        audit(db,admin,'user',d.head,'user.created',{}, {department_id:d.id,role:'manager',synthetic:true});created.heads++;
      }else if(head.department_id!==d.id||!head.active){
        db.prepare('UPDATE users SET department_id=?,active=1 WHERE id=?').run(d.id,head.id);
        audit(db,admin,'user',head.id,'user.updated',{department_id:head.department_id,active:head.active},{department_id:d.id,active:1});created.heads++;
      }
    }
    for(const person of executiveLayer){
      const existing=db.prepare('SELECT * FROM users WHERE id=?').get(person.id);
      if(existing&&(existing.tenant_id!=='36t'||existing.role!=='manager'))throw new Error('Existing account differs; not changing it: '+person.id);
      if(!existing){
        db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) VALUES(?,'36t',?,?,?,?,'manager')").run(person.id,person.department_id,person.id,person.name,template.password_hash);
        audit(db,admin,'user',person.id,'user.created',{}, {department_id:person.department_id,role:'manager',synthetic:true,layer:'executive'});created.heads++;
      }
    }
    // مع وجود الرئاسة داخل مكتب الرئيس التنفيذي، يُثبَّت معتمد المكتب صراحة.
    if(!db.prepare("SELECT 1 FROM department_routing WHERE department_id='ceo-office' AND step_role='department_manager'").get()){
      db.prepare("INSERT INTO department_routing VALUES('36t','ceo-office','department_manager','head-ceo-office',?,?)").run(admin.id,now());
      audit(db,admin,'department','ceo-office','routing.assigned',{}, {step_role:'department_manager',user_id:'head-ceo-office'});created.routing=(created.routing??0)+1;
    }
    for(const d of companyDepartments){
      const above=escalationFor(d);
      if(above===d.head)continue;
      const current=db.prepare('SELECT user_id FROM department_escalation WHERE department_id=?').get(d.id);
      if(current?.user_id===above)continue;
      db.prepare('INSERT INTO department_escalation VALUES(?,?,?,?,?,?) ON CONFLICT(department_id) DO UPDATE SET user_id=excluded.user_id,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at')
        .run(d.id,'36t',above,'مرجع تصعيد طلبات مدير الإدارة نفسه',admin.id,now());
      audit(db,admin,'department',d.id,'escalation.assigned',current??{},{user_id:above});created.escalation=(created.escalation??0)+1;
    }
        const latest=code=>db.prepare("SELECT * FROM services s WHERE tenant_id='36t' AND code=? AND version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)").get(code);
    for(const {req,section,...definition} of catalogServices){
      // الإرشاد لا يُخزَّن في نسخة الخدمة، فالمقارنة والإنشاء يجريان على الشكل المخزَّن وحده،
      // وإلا أُعيد إصدار كل خدمة عند كل تثبيت دون تغيّر حقيقي في نموذجها.
      const service={...definition,fields:definition.fields.map(coreField)};
      // المقترحات المتبناة (policyProposals) تُطبَّق على تعريف الكتالوج حتى يُرجع عنها بسجل جديد.
      service.approval_policy=effectivePolicy(db,definition);
      const current=latest(service.code);
      if(!current){createService(db,admin,service);created.services++;continue;}
      const sameShape=current.department_id===service.department_id
        &&current.name_ar===service.name_ar&&current.name_en===service.name_en&&current.description===service.description
        &&stable(JSON.parse(current.fields))===stable(service.fields)&&stable(JSON.parse(current.approval_policy))===stable(service.approval_policy);
      if(sameShape)continue;
      createService(db,admin,service);
      if(current.department_id!==service.department_id)created.moved++;else created.revised++;
    }
    // ── إعادة التسمية (131) تجري وحدها في الحلقة أعلاه ─────────────────────────────────────────────
    // كل إعادة تسمية في CATALOG_RENAMES محرَّرة في تعريف الكود، فيرى المُقارِن أن sameShape=false فينشئ نسخة جديدة.
    // ولا خدمة مبذورة تُعاد تسميتها (مراجعة 23 سبتمبر): HR-LETTER تبقى باسمها المبذور وكلمة الطالب مرادفٌ لها.
    const sections=[...Object.entries(baseServiceSections),...catalogServices.map(s=>[s.code,s.section])];
    sections.forEach(([code,section],index)=>{
      const current=db.prepare("SELECT section,sort_order FROM service_directory WHERE tenant_id='36t' AND service_code=?").get(code);
      if(current?.section===section&&current.sort_order===index)return;
      if(!latest(code))return;
      setServiceSection(db,admin,code,section,index);created.sections++;
    });
    for(const service of [...catalogServices,{code:'HR-LETTER',fields:[]},{code:'IT-SUPPORT',fields:[]},{code:'CREATIVE-BRIEF',fields:[]}]){
      const row=db.prepare("SELECT target_days FROM service_directory WHERE tenant_id='36t' AND service_code=?").get(service.code);
      if(!row||row.target_days)continue;
      setServiceTarget(db,admin,service.code,defaultTargetDays(service));created.targets=(created.targets??0)+1;
    }
    // ── إسقاط شجرة الفئات (131) ─────────────────────────────────────────────────────────────────────
    // بعد أن استقرت الأقسام والأزمنة ونسخ الخدمات: تُمحى صفوف الإسقاط وتُعاد كتابتها كاملة من الشجرة
    // المكتوبة في app/catalog-tree.mjs، ومعها مرادفات الكود وحالة الإسقاط. إسقاطٌ لا قرار، فلا حدث
    // تدقيق له باسمه: القرار محفوظ في الكود وفي نسخ الخدمات التي كتبها createService قبل قليل.
    // والعائد لا يكسب مفتاحًا: شكل created عقدٌ تقرؤه اختبارات مسجَّلة («التثبيت لا يحرّك نسخة»)، وحصيلة
    // الإسقاط تُقرأ من catalog_projection_state حيث تُكتب، لا من عدّاد ثانٍ يُعاد نسخه.
    projectCatalog(db,'36t',admin.id);
    for(const d of retiredDepartments){
      const existing=db.prepare("SELECT * FROM departments WHERE id=? AND tenant_id='36t'").get(d.id);
      if(!existing)continue;
      if(latest_any(db,d.id))throw new Error('A current service still belongs to a retired department: '+d.id);
      const head=db.prepare('SELECT * FROM users WHERE id=?').get(d.head);
      if(head?.active){
        if(db.prepare('SELECT 1 FROM users WHERE manager_id=? AND active=1').get(head.id))throw new Error('Retired department head still has reports: '+d.head);
        db.prepare('UPDATE users SET active=0 WHERE id=?').run(head.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(head.id);
        audit(db,admin,'user',head.id,'user.deactivated',{active:1},{active:0,reason:'unit merged into '+d.moved_to});
        // الموجة 2، العطب 8: مدير وحدة دُمجت يُوقف حسابه؛ ما يباشره يعود إلى طابور إدارته وخطواته المعلقة يُنقل قرارها، في المعاملة نفسها.
        if(db.isTransaction)returnDepartedWork(db,{userId:head.id,actor:admin,auditor:admin});
      }
      if(db.prepare("SELECT 1 FROM users WHERE department_id=? AND active=1").get(d.id))throw new Error('Retired department still has active accounts: '+d.id);
      if(existing.active){
        db.prepare('UPDATE departments SET active=0 WHERE id=?').run(d.id);
        db.prepare('DELETE FROM department_routing WHERE department_id=?').run(d.id);
        audit(db,admin,'department',d.id,'department.archived',{active:1},{active:0,moved_to:d.moved_to});created.retired++;
      }
    }
    return created;
  });
}
function latest_any(db,departmentId){
  return db.prepare("SELECT 1 FROM services s WHERE tenant_id='36t' AND department_id=? AND version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code) LIMIT 1").get(departmentId);
}

// ── B9: فحص إعداد الكتالوج ──────────────────────────────────────────────────────
// يُعرض لمسؤول الكتالوج: خدمة لا منفذ لها، خطوة لا يمكن حلها، حد اعتماد غير معرّف، وخدمة sod لا منفذ فيها غير معتمدها.
// خطوة «المدير المباشر» تتبع صاحب الطلب فلا تُفحص هنا.
const ROLE_NAMES={manager:'مدير',hr:'موارد بشرية',it:'تقنية معلومات',pm:'مدير مشروع',member:'أي عضو نشط'};
function staticApprover(db,tenantId,departmentId,role){
  const needed=role==='department_manager'?'manager':role;
  const routed=db.prepare('SELECT u.id FROM department_routing r JOIN users u ON u.id=r.user_id WHERE r.tenant_id=? AND r.department_id=? AND r.step_role=? AND u.active=1 AND u.department_id=r.department_id AND u.role=?').get(tenantId,departmentId,role,needed);
  if(routed)return {id:routed.id};
  const rows=db.prepare('SELECT id FROM users WHERE tenant_id=? AND department_id=? AND role=? AND active=1').all(tenantId,departmentId,needed);
  if(rows.length===1)return {id:rows[0].id};
  return {error:rows.length?'ambiguous':'missing'};
}
// ── معتمدو خطوة «مديرك»، وكانوا نقطةً عمياء ────────────────────────────────────
// خطوة «مديرك» تتبع صاحب الطلب لا الخدمة، فلا تُحلّ إلى حساب بعينه قبل أن يُقدَّم طلب — وكان الفحص يتخطاها
// كلها (`if(step.role==='manager')return`). فعميت عنه خمس خدمات إبداعية نفّذها من قرر فيها، أثبتتها إعادة
// القياس بفرق المجموعات على قاعدتي المسح: CREATIVE-BRIEF وCRT-CONTENT وCRT-DESIGN وCRT-REVISION
// وCRT-TRANSLATION في الوضعين معًا. وهي ليست مجهولة: من يعتمد «مديرك» مديرٌ نشط يتبعه أحدٌ في إدارته نفسها،
// وهذه مجموعة تُقرأ من الهيكل كما تُقرأ أي خطوة ساكنة. فصارت تُحسب، والفحص يقول «قد يقرر وينفّذ» لا يسكت.
const managerStepDeciders=(db,tenantId)=>new Set(db.prepare(`SELECT DISTINCT m.id FROM users u JOIN users m ON m.id=u.manager_id AND m.tenant_id=u.tenant_id
  WHERE u.tenant_id=? AND u.active=1 AND m.active=1 AND m.role='manager' AND m.department_id=u.department_id`).all(tenantId).map(r=>r.id));
const hasManagerStep=policy=>policy.steps.some(raw=>normalizeStep(raw)?.role==='manager');
export function catalogHealth(db,tenantId){
  // الموقوفة بمفتاح الإعدادات (ترحيل 129) تبقى مفحوصة: لها طلبات مفتوحة تمشي بمعتمديها ومنفذيها، فلو سقطت
  // من الفحص لصار «لا ملاحظات» يعني «لم نَنظر» — وهو بالضبط ما يحذّر منه سطر العدّ أدناه. تُفحص وتُعلَّم،
  // ويُقال عددها، فلا ينقص الرقم صامتًا ولا يُقرأ نقصانه تحسّنًا.
  const services=catalog(db,{tenant_id:tenantId},{includeHidden:true});
  const hidden=hiddenServiceCodes(db,tenantId);
  const departments=new Map(db.prepare('SELECT id,name,active FROM departments WHERE tenant_id=?').all(tenantId).map(d=>[d.id,d]));
  const managerDeciders=managerStepDeciders(db,tenantId);
  const issues=[],label=id=>departments.get(id)?.name??id;
  const add=(s,kind,severity,message,extra={})=>issues.push({code:s.code,service:s.name_ar,department_id:s.department_id,kind,severity,message,hidden:hidden.has(s.code),...extra});
  for(const s of services){
    const policy=s.approval_policy,executors=executorsFor(db,s,s.department_id,tenantId);
    if(!executors.length)add(s,'no_executor','عالية',policy.confidential
      ?`لا منفذ: الخدمة سرية ولا مدير نشطًا في «${label(s.department_id)}» يستلمها`
      :`لا منفذ: لا حساب نشط بدور «${ROLE_NAMES[policy.handler_role]??policy.handler_role}» في «${label(s.department_id)}»`);
    const approvers=new Set();
    policy.steps.forEach((raw,position)=>{
      const step=normalizeStep(raw);if(!step||step.role==='manager')return;
      const departmentId=step.department??s.department_id,department=departments.get(departmentId);
      if(!department||!department.active){add(s,'step_unresolvable','عالية',`الخطوة ${position+1}: الإدارة «${departmentId}» غير موجودة أو مؤرشفة`,{position});return;}
      if(step.role==='executive'){
        const executive=executiveFor(db,tenantId,departmentId);
        if(executive)approvers.add(executive.id);else add(s,'step_unresolvable','عالية',`الخطوة ${position+1}: لا حساب نشط في الرئاسة لقطاع «${label(departmentId)}»`,{position});
      }else{
        const found=staticApprover(db,tenantId,departmentId,step.role);
        if(found.id)approvers.add(found.id);
        else add(s,'step_unresolvable','عالية',`الخطوة ${position+1}: ${found.error==='ambiguous'?'أكثر من معتمد محتمل ولا معتمد معيّن':'لا معتمد نشط'} بدور «${ROLE_NAMES[step.role==='department_manager'?'manager':step.role]}» في «${label(departmentId)}»`,{position});
        if(found.id&&!escalationApprover(db,tenantId,departmentId)&&!approvalFallback(db,tenantId,departmentId,step.role))
          add(s,'no_substitute','منخفضة',`الخطوة ${position+1}: لا معتمد بديل ولا مرجع تصعيد في «${label(departmentId)}»؛ طلب المعتمد نفسه لهذه الخدمة سيتوقف`,{position});
      }
      if(step.when?.gte_setting&&!thresholdFor(db,tenantId,step.when.gte_setting))
        add(s,'threshold_undefined','متوسطة',`حد الاعتماد غير معرّف (${step.when.gte_setting}): الخطوة ${position+1} تُطلب احتياطًا في كل طلب حتى يُعرَّف الحد ويُعتمد`,{position,setting_key:step.when.gte_setting});
    });
    // فصل المهام مفعّل ولا منفذ في الإدارة غير من يعتمد: تُحسب الحلقة الاحتياطية قبل الحكم، فلا يُقال
    // «بلا منفذ» وللخدمة نائب مقبول أو مرجع تصعيد، ولا يُسكت عنها وهي بلا أحد.
    if(policy.sod&&executors.length&&executors.every(p=>approvers.has(p.id))){
      const cover=executionCover(db,tenantId,s.code,s.department_id,approvers,!!policy.closed_circle);
      if(!cover)add(s,'sod_no_executor','عالية',`فصل المهام مفعّل ولا منفذ في «${label(s.department_id)}» غير من يعتمد الخدمة، ولا نائب مقبول${policy.closed_circle?' — والخدمة بلاغ سري عن شخص فلا يغطيها سُلَّم التصعيد':' ولا درجة في سُلَّم التصعيد'}؛ سمِّ نائبًا منفّذًا`);
    }
    // ── العطب الذي كان الفحص يسكت عنه: المقرِّر هو المنفِّذ ───────────────────────────
    // بلا فصل مهام، من يعتمد الخدمة هو من يستلمها ويغلقها. المسح وجدها في 115 طلبًا من 142.
    // هذه ملاحظة أولى بذاتها لا مجرد غياب علم: ضابطٌ مُطفأ يجب أن يُقرأ مُطفأً، لا أن يُسكت عنه.
    // معتمد «مديرك» يُحسب هنا وحده: مجموعة approvers الساكنة تبقى كما هي لبقية الملاحظات، فلا يُقال
    // «فصل المهام بلا منفذ» بسبب احتمالٍ يتبع صاحب الطلب. أما الجمع فاحتمالُه واقعٌ يجب أن يُقال.
    const viaManagerStep=hasManagerStep(policy);
    const deciders=viaManagerStep?new Set([...approvers,...managerDeciders]):approvers;
    if(!policy.sod&&executors.some(p=>deciders.has(p.id))){
      const both=executors.filter(p=>deciders.has(p.id));
      const onlyManagerStep=viaManagerStep&&!executors.some(p=>approvers.has(p.id));
      const sensitive=SOD_SERVICES.includes(s.code);
      add(s,'decider_is_executor',sensitive?'عالية':'متوسطة',
        sensitive
          ?`خدمة حسّاسة ونسختها المخزَّنة بلا فصل مهام: ${both.length===executors.length?'من يعتمدها هو وحده من ينفّذها':'من يعتمدها يملك تنفيذها أيضًا'} في «${label(s.department_id)}». ثبّت دليل الخدمات لتصل نسختُها التي تحمل الضابط`
          :onlyManagerStep
            ?`فصل المهام مُطفأ: من يعتمدها بصفته مديرَ صاحب الطلب يملك استلامها وإغلاقها في «${label(s.department_id)}»؛ يُسجَّل الجمع ويُعرض ولا يُمنع`
            :`فصل المهام مُطفأ: من يعتمد هذه الخدمة يملك استلامها وإغلاقها في «${label(s.department_id)}»؛ يُسجَّل الجمع ويُعرض ولا يُمنع`,
        {sensitive,via_manager_step:onlyManagerStep,deciders:both.map(p=>p.id)});
    }
  }
  const count=kind=>issues.filter(i=>i.kind===kind).length;
  const deciderIsExecutor=issues.filter(i=>i.kind==='decider_is_executor');
  return {tenant_id:tenantId,checked_at:now(),services_checked:services.length,
    // العدد أعلاه يشمل الموقوفة، وهذا عددها: الرقم يبقى صادقًا في الحالين، ولا يُقرأ «خدمة أقل» تحسّنًا.
    hidden_checked:services.filter(s=>hidden.has(s.code)).length,issues,
    // خدمات الجمع بأسمائها لا بعددها وحده: «142 خدمة مفحوصة، لا ملاحظات» صارت جملة يستحيل طبعها ما دام العدّ فوق الصفر.
    decider_is_executor:{count:deciderIsExecutor.length,sensitive:deciderIsExecutor.filter(i=>i.sensitive).length,services:deciderIsExecutor.map(i=>i.code)},
    summary:{no_executor:count('no_executor'),step_unresolvable:count('step_unresolvable'),threshold_undefined:count('threshold_undefined'),
      sod_no_executor:count('sod_no_executor'),no_substitute:count('no_substitute'),decider_is_executor:deciderIsExecutor.length}};
}
// الحلقة الاحتياطية لخدمة، كما يراها الفحص قبل أي طلب: نائب مقبول ليس من المعتمدين، وإلا درجةٌ في سُلَّم
// تصعيد الإدارة ليست منهم. تُرجع {basis,name} أو null. لا تُحسب هنا موانع الطلب الواحد (صاحبه ومستفيده)؛
// تلك في executionChain. والسرية تمنع السُّلَّم هنا كما تمنعه هناك، فلا يَعِد الفحص بغطاء لا يقع.
function executionCover(db,tenantId,serviceCode,departmentId,approvers=new Set(),closedCircle=false){
  const deputy=deputiesFor(db,tenantId,serviceCode).find(d=>!approvers.has(d.user_id));
  if(deputy)return {basis:'deputy',name:deputy.deputy_name};
  if(closedCircle)return null;
  const rung=escalationLadder(db,tenantId,departmentId).find(p=>!approvers.has(p.id));
  return rung?{basis:'escalation',name:rung.name}:null;
}

// ── أثر المقترح قبل تبنّيه (مسح 20 سبتمبر، العطب 1) ──────────────────────────────
// المنصة كانت تعرف العطب وتسمح بتبني السياسة التي تسببه ولا تحذّر لحظة التبني: تبنّي «فصل المهام» يترك
// 13 خدمة بلا منفذ، فيقف الطلب عند «معتمد» بـ409 no_executor. الأثر يُحسب هنا على السياسة التي سينتجها
// المقترح — لا على السارية — فيقرأ المالك ما سيكسره قبل أن يقرر، لا بعد أن يقف أول طلب.
export function proposalImpact(db,tenantId,proposal){
  const definition=catalogServices.find(s=>s.code===proposal.code);
  if(!definition)return null;
  const stored=db.prepare("SELECT * FROM services s WHERE tenant_id=? AND code=? AND version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)").get(tenantId,proposal.code);
  if(!stored)return null;
  const policy=proposal.apply(effectivePolicy(db,definition,tenantId));
  const service={...stored,fields:JSON.parse(stored.fields),approval_policy:policy};
  const warnings=[];
  const executors=executorsFor(db,service,service.department_id,tenantId);
  const department=db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(service.department_id,tenantId)?.name??service.department_id;
  if(!executors.length)warnings.push({kind:'no_executor',message:`لا حساب نشط ينفّذ هذه الخدمة في «${department}» بعد التبني`});
  else{
    // من سيعتمد الخدمة بعد التبني: كل خطوة ساكنة تُحل إلى حساب بعينه، وخطوة «مديرك» تُحسب بمجموعة
    // من يمكن أن يعتمدها — مديرٌ نشط يتبعه أحدٌ في إدارته. تخطّيها كان يُري المالكَ أثرًا أضيق مما سيقع.
    const approvers=new Set(hasManagerStep(policy)?managerStepDeciders(db,tenantId):[]);
    for(const raw of policy.steps){
      const step=normalizeStep(raw);if(!step||step.role==='manager')continue;
      const departmentId=step.department??service.department_id;
      if(step.role==='executive'){const x=executiveFor(db,tenantId,departmentId);if(x)approvers.add(x.id);continue;}
      const found=staticApprover(db,tenantId,departmentId,step.role);
      if(found.id)approvers.add(found.id);
    }
    if(policy.sod&&executors.every(p=>approvers.has(p.id))){
      const cover=executionCover(db,tenantId,proposal.code,service.department_id,approvers,!!policy.closed_circle);
      warnings.push({kind:'sod_no_executor',resolved:!!cover,basis:cover?.basis??null,department:service.department_id,
        message:cover?`فصل المهام يترك هذه الخدمة بلا منفذ في «${department}»، ويغطيها ${cover.basis==='deputy'?'النائب المسمّى':'سُلَّم تصعيد الإدارة'} «${cover.name}»`
          :`فصل المهام يترك هذه الخدمة بلا منفذ في «${department}»: من يعتمدها هو وحده من ينفّذها، ولا نائب مقبول${policy.closed_circle?' — والخدمة بلاغ سري عن شخص فلا يغطيها سُلَّم التصعيد':' ولا درجة في سُلَّم التصعيد'}. سمِّ نائبًا منفّذًا قبل التبني`});
    }
  }
  return {steps_before:JSON.parse(stored.approval_policy).steps,steps_after:policy.steps,warnings};
}

// اسم الخطوة كما يقرؤه مالك الإجراء: «مدير المالية» لا {role:'department_manager',department:'finance'}.
const STEP_LABELS={manager:'مديرك',department_manager:'مدير الإدارة المنفذة',hr:'الموارد البشرية',it:'تقنية المعلومات',pm:'مدير المشروع',executive:'الرئاسة'};
export function stepLabel(raw){
  const step=normalizeStep(raw);if(!step)return 'خطوة غير معروفة';
  const department=step.department?companyDepartments.find(d=>d.id===step.department)?.name??step.department:null;
  const base=department?`مدير ${department}`:(STEP_LABELS[step.role]??step.role);
  return step.when?`${base} (بشرط)`:base;
}

// فحص الكتالوج مقصورًا على إدارة واحدة: خدماتها وملاحظاتها وعددها. مدير الإدارة يقرأ إدارته لا الشركة،
// فلا يُقرأ «142 خدمة مفحوصة» على أنه رقم إدارته، ولا تُفتح له ملاحظاتُ إداراتٍ ليست شأنه.
function departmentHealth(db,tenantId,departmentId){
  const full=catalogHealth(db,tenantId);
  const issues=full.issues.filter(i=>i.department_id===departmentId);
  const count=kind=>issues.filter(i=>i.kind===kind).length;
  const decider=issues.filter(i=>i.kind==='decider_is_executor');
  // خدمات الإدارة كما يفحصها اللوح الكامل: الموقوفة داخلها ومعلَّمة، فرقم المدير كرقم الشركة صادق في الحالين.
  const mine=catalog(db,{tenant_id:tenantId},{includeHidden:true}).filter(s=>s.department_id===departmentId);
  const hidden=hiddenServiceCodes(db,tenantId);
  return {tenant_id:tenantId,checked_at:full.checked_at,scope:'department',department_id:departmentId,
    services_checked:mine.length,hidden_checked:mine.filter(s=>hidden.has(s.code)).length,issues,
    decider_is_executor:{count:decider.length,sensitive:decider.filter(i=>i.sensitive).length,services:decider.map(i=>i.code)},
    summary:{no_executor:count('no_executor'),step_unresolvable:count('step_unresolvable'),threshold_undefined:count('threshold_undefined'),
      sod_no_executor:count('sod_no_executor'),no_substitute:count('no_substitute'),decider_is_executor:decider.length}};
}
// ── شاشة إعداد الاعتماد: الحدود والبدلاء والمقترحات وفحص الكتالوج ─────────────────────
export function approvalSettings(db,supplied){
  const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','ما لقينا حسابك، ولا هو موقوف — كلّم مسؤول المنصة');
  const manage=can(db,u,'catalog.manage'),decide=canApproveThresholds(db,u),structure=can(db,u,'structure.manage');
  // مدير الإدارة يدخل هذه الشاشة لبابٍ واحد: أزمنة خدمات إدارته. الشاشة تعرض له ما يخصّه، ولا تعطيه فعلًا لا يملكه.
  const myDepartment=headsDepartment(db,u,u.department_id)?u.department_id:null;
  if(!manage&&!decide&&!structure&&!myDepartment)fail(403,'not_permitted','إعداد الاعتماد لمسؤول الكتالوج والرئاسة ومديري الإدارات لأزمنة خدماتهم');
  const name=id=>id?db.prepare('SELECT name FROM users WHERE id=?').get(id)?.name??null:null;
  const services=catalog(db,u);
  // ── قائمتان لا قائمة (مراجعة 22 سبتمبر) ──────────────────────────────────────
  // `services` أعلاه مرشَّحة، وهي الصحيحة لكل ما يعرض خدمةً للطلب (مفاتيح الحدود، والمقترحات).
  // لكن ثلاث قوائم في هذه الشاشة ليست عرضًا لخدمة: تسمية النائب المنفّذ، وتبنّي زمن الخدمة، وأزمنة
  // خدمات المدير — أبوابُ حوكمةٍ لعملٍ ما زال يتحرك. الخدمة الموقوفة تُبقي طلباتها المفتوحة بمعتمديها
  // ومنفذيها وساعتها، فسقوطها من هذه الثلاث كان يمنع المالكَ من تسمية نائب لها ومديرَها من تبنّي زمنها
  // في اللحظة التي ما زالت تلك القرارات تُلزم فيها عملًا قائمًا — و«٢٢ ← ٢١» بلا كلمة واحدة تقول لماذا،
  // وهو الطرح الصامت نفسه الذي أُضيف `hidden_checked` في الشاشة نفسها ليمنعه. تُقرأ كاملة وتُعلَّم.
  const allServices=catalog(db,u,{includeHidden:true});
  const hiddenCodes=hiddenServiceCodes(db,u.tenant_id);
  const stopMark=code=>hiddenCodes.has(code)?{hidden:true,hidden_reason:stopNote(db,u.tenant_id,'service',code)}:{hidden:false,hidden_reason:null};
  const departmentName=id=>id?db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(id,u.tenant_id)?.name??id:null;
  // ── شاشة مدير الإدارة الواحدة: خدماتي وأزمنتها ومن تبنّاها ──────────────────────
  // كل خدمة في إدارتي بزمنها وحاله: «مشتق لم يتبنّه أحد» أو «تبنّاه فلان بسنده» أو «قال مديرها إنه ليس التزامه».
  // التبني قرار، فله سند مكتوب، ولا يتبنّاه من سجّل الرقم. الإدارات الأخرى تُعدّ ولا تُعرض: ليست شأن هذا المدير.
  const myServiceTargets=()=>!myDepartment?[]:allServices.filter(s=>s.department_id===myDepartment)
    .map(s=>{const target=targetProvenance(db,u.tenant_id,s.code,{target_days:s.target_days??0,target_hours:s.target_hours??0});
      const updatedBy=db.prepare('SELECT updated_by FROM service_directory WHERE tenant_id=? AND service_code=?').get(u.tenant_id,s.code)?.updated_by??null;
      // الصف الذي لا فعل فيه يقول لماذا، فلا يُقرأ الفراغ عطلًا في الشاشة.
      const why=target.kind==='unset'?'لا زمن مسجَّل لهذه الخدمة في الدليل، فلا شيء يُتبنّى. يسجّله مسؤول دليل الخدمات أولًا'
        :updatedBy===u.id?'أنت من سجّل هذا الرقم في الدليل؛ التبني قرار شخص ثانٍ، فيتبنّاه من يخلفك أو يُسجّله غيرك':'';
      return {code:s.code,service:s.name_ar,target,blocked_why:why,...stopMark(s.code),
        actions:target.kind==='unset'||updatedBy===u.id?[]:target.adopted?['withdraw_service_target']:['adopt_service_target']};})
    .sort((a,b)=>a.code.localeCompare(b.code));
  // النواب بالرتبة وبحالتهم: «مقترح» لا ينفّذ حتى يقبله ثانٍ، و«مسحوب» يبقى معروضًا فلا يُظن أنه لم يكن.
  // ومن يقبل التسمية ليس النائب (فالقبول هو ما يمنح الحق): من يدير الهيكل، أو مدير إدارة النائب، أو مدير
  // الإدارة المنفذة — فالزر يظهر لمن يملك الفعل فعلًا، لا لمن يملكه الخادم وحده (إعادة القياس، العطب 10).
  const deputyRows=where=>db.prepare(`SELECT d.*,x.name AS deputy_name,x.department_id AS deputy_department_id,y.name AS proposed_by_name,z.name AS accepted_by_name
      FROM execution_deputies d JOIN users x ON x.id=d.user_id JOIN users y ON y.id=d.proposed_by LEFT JOIN users z ON z.id=d.accepted_by
      WHERE d.tenant_id=? ORDER BY d.service_code,d.rank`).all(u.tenant_id)
    .map(d=>{const service=db.prepare("SELECT department_id FROM services s WHERE tenant_id=? AND code=? AND version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)").get(u.tenant_id,d.service_code);
      const mayAccept=d.status==='proposed'&&d.proposed_by!==u.id&&d.user_id!==u.id
        &&(structure||headsDepartment(db,u,d.deputy_department_id)||(!!service&&headsDepartment(db,u,service.department_id)));
      return {...d,service_department_id:service?.department_id??null,
        service:catalogServices.find(s=>s.code===d.service_code)?.name_ar??d.service_code,
        actions:mayAccept?['accept_deputy']:structure&&d.status==='accepted'?['withdraw_deputy']:[]};})
    .filter(d=>!where||where(d));
  // ── قراءة بقدر الباب (إعادة القياس، العطب 5) ──────────────────────────────────
  // مدير الإدارة كان يُرسَل إليه لوحُ الاعتماد كله: كل الحدود وكل البدلاء وكل النواب وكل مقترحات السياسة
  // وفحص الشركة بخدماتها الـ142 — قراءةٌ أوسع من بابه بكثير. فصار ما يصله ما يخصّه: إدارته وحدها.
  if(!manage&&!decide&&!structure)return {scope:'department',
    can_propose:false,can_decide:false,can_assign_fallback:false,can_adopt:false,
    note:`هذه شاشتك بصفتك مدير «${departmentName(myDepartment)}»: أزمنة خدمات إدارتك وفحصها. حدود الاعتماد والمعتمد البديل ومقترحات المسارات لمسؤول دليل الخدمات والرئاسة ومن يدير الهيكل.`,
    keys:[],thresholds:[],fallbacks:[],proposals:[],target_proposals:[],targets_for_review:[],
    my_department:{id:myDepartment,name:departmentName(myDepartment)},my_service_targets:myServiceTargets(),
    deputies:deputyRows(d=>d.service_department_id===myDepartment||d.deputy_department_id===myDepartment||allServices.some(s=>s.code===d.service_code&&s.department_id===myDepartment)),
    deputy_services:[],
    health:departmentHealth(db,u.tenant_id,myDepartment),departments:[],people:[]};
  const keys=[...new Set(services.flatMap(s=>s.approval_policy.steps.map(normalizeStep).filter(x=>x?.when?.gte_setting).map(x=>x.when.gte_setting)))].sort();
  const thresholds=db.prepare('SELECT * FROM approval_thresholds WHERE tenant_id=? ORDER BY setting_key,proposed_at DESC').all(u.tenant_id).map(t=>({...t,proposed_by_name:name(t.proposed_by),decided_by_name:name(t.decided_by),
    effective:thresholdFor(db,u.tenant_id,t.setting_key)?.id===t.id,actions:t.status==='proposed'&&decide&&t.proposed_by!==u.id?['decide_threshold']:[]}));
  return {scope:'tenant',can_propose:manage,can_decide:decide,can_assign_fallback:structure,can_adopt:manage&&u.role==='admin',
    note:'الحدود بالهللات، يدخلها مسؤول الكتالوج بسندها ويعتمدها غيره من الرئاسة. خطوة مشروطة بحد غير معرّف لا تُتخطى: تُطلب احتياطًا مع ملاحظة «حد الاعتماد غير معرّف». المنصة لا تقترح رقمًا؛ مصفوفة الصلاحيات المالية قرار الرئاسة.',
    keys:keys.map(key=>{const t=thresholdFor(db,u.tenant_id,key);return {key,effective_minor:t?.amount_minor??null,effective_from:t?.effective_from??null,services:services.filter(s=>s.approval_policy.steps.some(x=>normalizeStep(x)?.when?.gte_setting===key)).map(s=>s.code)};}),
    thresholds,
    fallbacks:db.prepare('SELECT f.*,d.name AS department_name,x.name AS fallback_name,y.name AS assigned_by_name FROM approval_fallbacks f JOIN departments d ON d.id=f.department_id JOIN users x ON x.id=f.fallback_user_id JOIN users y ON y.id=f.assigned_by WHERE f.tenant_id=? ORDER BY d.name,f.step_role').all(u.tenant_id),
    proposals:policyProposals.map(p=>{const a=adoptionOf(db,u.tenant_id,p.code,p.key),definition=catalogServices.find(s=>s.code===p.code);
      const impact=a?.policy?null:proposalImpact(db,u.tenant_id,p);
      return {key:p.key,code:p.code,service:definition?.name_ar??p.code,item:p.item,reason:p.reason,approval_policy:p.apply(definition.approval_policy),
        chain_before:impact?impact.steps_before.map(stepLabel):null,chain_after:impact?impact.steps_after.map(stepLabel):null,
        warnings:impact?.warnings??[],adopted:!!a?.policy,adopted_at:a?.adopted_at??null,adopted_by_name:name(a?.adopted_by),basis:a?.basis??null,
        actions:manage&&u.role==='admin'?[a?.policy?'withdraw_proposal':'adopt_proposal']:[]};}),
    // زمن الخدمة: الخمس التي لا تحتمل التأجيل مقترحةً بالساعات، وما عداها معروض للمراجعة بلا تغيير.
    target_proposals:TARGET_PROPOSALS.map(p=>{const decided=targetAdoptionOf(db,u.tenant_id,p.key),definition=catalogServices.find(s=>s.code===p.code);
      const row=db.prepare('SELECT target_days,target_hours FROM service_directory WHERE tenant_id=? AND service_code=?').get(u.tenant_id,p.code);
      return {key:p.key,code:p.code,service:definition?.name_ar??p.code,reason:p.reason,proposed_days:p.days,proposed_hours:p.hours,
        current_days:row?.target_days??null,current_hours:row?.target_hours??null,decision:decided?.decision??null,
        decided_at:decided?.decided_at??null,decided_by_name:name(decided?.decided_by),basis:decided?.basis??null,
        actions:manage&&u.role==='admin'?(decided?.decision==='adopted'?['withdraw_target']:['decide_target']):[]};}),
    // العطب 10: زمن كل خدمة مشتق من عائلة رمزها لا من طبيعتها، ولم يعتمده مالك إجراء واحد. تُعرض ليراجعها مالكوها.
    targets_for_review:allServices.filter(s=>s.target_days&&!TARGET_PROPOSALS.some(p=>p.code===s.code)&&!s.target_hours)
      .map(s=>({code:s.code,service:s.name_ar,department_id:s.department_id,target_days:s.target_days,...stopMark(s.code),
        target:targetProvenance(db,u.tenant_id,s.code,{target_days:s.target_days,target_hours:s.target_hours??0})}))
      .filter(s=>s.target.kind==='derived').sort((a,b)=>a.code.localeCompare(b.code)),
    my_department:myDepartment?{id:myDepartment,name:departmentName(myDepartment)}:null,
    my_service_targets:myServiceTargets(),
    deputies:deputyRows(),
    // خدمات يصح أن يُسمّى لها نائب منفّذ: كل خدمة فصلُ المهام مفعّل عليها (فمعتمِدها لا ينفّذها)، ومعها
    // الإدارات المؤهَّلة لكل واحدة — إدارات قطاعها — فيختار من يسمّي من قائمة لا من ذاكرته ولا من رفض.
    deputy_services:structure?allServices.filter(s=>s.approval_policy.sod).map(s=>({code:s.code,service:s.name_ar,department_id:s.department_id,
      handler_role:s.approval_policy.handler_role,confidential:!!s.approval_policy.confidential,...stopMark(s.code),
      eligible_departments:deputyEligibleDepartments(db,u.tenant_id,s.department_id)})).sort((a,b)=>a.code.localeCompare(b.code)):[],
    health:catalogHealth(db,u.tenant_id),
    // لوح مفاتيح التفعيل (ترحيل 129): خدمات الدليل ومزايا «مزاياي» بحالة كل واحدة وقرارها الأخير وسجله.
    // يقع في نطاق الكيان وحده: مدير الإدارة لا يصله هذا الباب، فالمفتاح يغيّر ما يراه كل موظف في الشركة
    // لا ما يراه قسمه، ومالكه هو مالك «إعداد الخدمات». واللوح نفسه يردّ can_manage=false لغير حامله.
    availability:availabilityBoard(db,u),
    // لوح شروط الأهلية (ترحيل 138): بجوار لوح المفاتيح لأن السؤالين بابٌ واحد على الشاشة —
    // «هل هذه الخدمة مفتوحة أصلًا» و«ومن ينطبق عليه شرطها». والثاني للأدمن الأول وحده، واللوح يردّ
    // can_manage=false لغيره كما يفعل الأول، فما تُرسم شاشة أفعالٍ لا يملكها أحد.
    service_gates:gatesBoard(db,u),
    departments:db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id),
    people:structure?db.prepare("SELECT id,name,department_id,role FROM users WHERE tenant_id=? AND active=1 AND role IN ('manager','hr','it','pm') ORDER BY name").all(u.tenant_id):[]};
}

// ── خيارات داخل الخدمة الواحدة (طلب المالك 19 سبتمبر: «طريقة الاختيار من نفس الطلبات») ─────────────────────
// بطاقة واحدة لخدمات متقاربة، وأول خطوة في نموذجها اختيار النوع. كل خيار يشير إلى خدمة قائمة (service) تحمل حقوله
// ومسار اعتماده وزمنه المستهدف، فيقرر الخيار المختار الحقول والتوجيه وتاريخ الاستحقاق عبر المحرك نفسه بلا نسخة ثانية منه.
// رموز الخدمات القديمة تبقى في الدليل كما هي (أسماء بديلة): البحث يجدها، والطلبات القائمة عليها لا تتغير.
//   service — رمز خدمة الدليل التي يُنشأ عليها الطلب
//   link    — شاشة الوحدة المخصصة حين تكون جاهزة لهذا الحساب (ready كما في module-routes.mjs)؛ عندها يُفتح نموذجها لا طلب عام
//   preset  — قيم حقول يثبتها الخيار ويخفيها من النموذج. الخادم يفرضها فوق ما يرسله المتصفح (applyVariant)
//   docs    — المستندات المطلوبة لهذا الخيار، تُعرض قبل التقديم
//   words   — كلمات بحث إضافية؛ اسم الخيار ورمز خدمته يُبحث فيهما دائمًا
// مجموعة «إجازة» تُبنى من أرصدة الموظف نفسه (أنواع سياسة الإجازات لدى وحدة الإجازات)، و«خطاب» من أنواع وحدة الخطابات.
export const SERVICE_VARIANTS=[
  {code:'VAR-LETTER',name_ar:'خطاب',name_en:'Letter',section:'الشهادات والخطابات',department_id:'hr',words:['خطاب','خطابات','تعريف','شهادة','letter'],
    description:'تعريف بالراتب أو بالعمل، شهادة خبرة، خطاب لبنك أو لسفارة. اختر النوع أولًا.',
    options:[
      {code:'salary',name_ar:'تعريف بالراتب',name_en:'Salary certificate',service:'HR-SALARY-CERT',link:'#letters/new?type=salary',ready:'letter:salary',words:['تعريف','راتب','بنك','قرض'],docs:[]},
      {code:'employment',name_ar:'تعريف بالعمل',name_en:'Employment letter',service:'HR-LETTER',link:'#letters/new?type=employment',ready:'letter:employment',words:['تعريف','عمل','وظيفي'],docs:[]},
      {code:'experience',name_ar:'شهادة خبرة',name_en:'Experience certificate',service:'HR-EXPERIENCE-CERT',link:'#letters/new?type=experience',ready:'letter:experience',words:['خبرة'],docs:[]},
      {code:'bank',name_ar:'تعريف لفتح حساب بنكي',name_en:'Bank account letter',link:'#letters/new?type=bank',ready:'letter:bank',words:['بنك','حساب'],docs:[]},
      {code:'embassy',name_ar:'تعريف لسفارة',name_en:'Embassy letter',link:'#letters/new?type=embassy',ready:'letter:embassy',words:['سفارة','تأشيرة','سفر'],docs:['صورة جواز السفر']}
    ]},
  {code:'VAR-LEAVE',name_ar:'إجازة',name_en:'Leave',section:'الإجازات',department_id:'hr',words:['اجازه','اجازات','leave','vacation'],
    description:'اختر نوع الإجازة من أرصدتك، ويفتح نموذج «إجازاتي» بمسار اعتماده. الأنواع من سياسة الإجازات لدى الموارد البشرية.',
    options:'leave_balances'},
  {code:'VAR-PROFILE',name_ar:'تعديل بيانات',name_en:'Update my details',section:'البيانات والوثائق',department_id:'hr',words:['تعديل','تحديث','بيانات','ملف'],
    description:'العنوان أو التواصل أو الحساب البنكي أو التابعون أو المؤهلات أو الوثائق الرسمية. كل تغيير يعتمده الموارد البشرية.',
    options:[
      {code:'address',name_ar:'العنوان الوطني',name_en:'National address',service:'HR-PROFILE-UPDATE',preset:{change_type:'بيانات التواصل'},words:['عنوان','سكن','وطني'],docs:['إثبات العنوان الوطني من «سُبل»']},
      {code:'contact',name_ar:'رقم الجوال أو البريد',name_en:'Phone or e-mail',service:'HR-PROFILE-UPDATE',preset:{change_type:'بيانات التواصل'},words:['جوال','هاتف','بريد','تواصل'],docs:[]},
      {code:'bank',name_ar:'حساب الراتب البنكي',name_en:'Salary bank account',service:'HR-BANK-CHANGE',words:['بنك','ايبان','حساب'],docs:['شهادة الآيبان من البنك باسم الموظف']},
      {code:'dependants',name_ar:'الحالة الاجتماعية والتابعون',name_en:'Marital status and dependants',service:'HR-PROFILE-UPDATE',preset:{change_type:'الحالة الاجتماعية والتابعون'},words:['تابع','زوج','مولود','ابن'],docs:['صورة سجل الأسرة أو شهادة الميلاد']},
      {code:'qualifications',name_ar:'المؤهلات العلمية',name_en:'Qualifications',service:'HR-PROFILE-UPDATE',preset:{change_type:'المؤهل العلمي'},words:['مؤهل','شهادة','جامعة'],docs:['صورة المؤهل، ومعادلته إن كان من خارج المملكة']},
      {code:'identity',name_ar:'الهوية أو الإقامة',name_en:'ID or iqama',service:'HR-PROFILE-UPDATE',preset:{change_type:'الهوية أو الإقامة'},words:['هوية','اقامه'],docs:['صورة الهوية أو الإقامة المحدثة']},
      {code:'passport',name_ar:'جواز السفر',name_en:'Passport',service:'HR-PROFILE-UPDATE',preset:{change_type:'جواز السفر'},words:['جواز'],docs:['صورة صفحة البيانات في الجواز']}
    ]},
  {code:'VAR-ADMIN',name_ar:'طلب إداري',name_en:'Administrative request',section:'الخدمات الإدارية',department_id:'ceo-office',words:['اداري','مكتب','مرافق'],
    description:'صيانة، حجز قاعة، مستلزمات، زائر، بطاقة دخول، سيارة، شحنة أو مقعد عمل. اختر النوع أولًا.',
    options:[
      {code:'maintenance',name_ar:'صيانة وإصلاح',name_en:'Maintenance',service:'ADM-MAINTENANCE',words:['عطل','تكييف','كهرباء']},
      {code:'room',name_ar:'حجز قاعة اجتماعات',name_en:'Meeting room',service:'ADM-ROOM-BOOKING',words:['قاعه','اجتماع']},
      {code:'supplies',name_ar:'قرطاسية ومستلزمات',name_en:'Office supplies',service:'ADM-SUPPLIES',words:['قرطاسيه','مستلزمات']},
      {code:'visitor',name_ar:'تصريح زائر',name_en:'Visitor pass',service:'ADM-VISITOR',words:['زائر','ضيف']},
      {code:'card',name_ar:'بطاقة موظف أو دخول',name_en:'Access card',service:'ADM-ACCESS-CARD',words:['بطاقه','دخول']},
      {code:'vehicle',name_ar:'سيارة أو توصيل',name_en:'Car or ride',service:'ADM-VEHICLE',words:['سياره','توصيل']},
      {code:'courier',name_ar:'إرسال شحنة أو مستند',name_en:'Courier',service:'ADM-COURIER',words:['شحنه','بريد']},
      {code:'workspace',name_ar:'مكتب أو مقعد عمل',name_en:'Desk or workspace',service:'ADM-WORKSPACE',words:['مكتب','مقعد']}
    ]},
  {code:'VAR-IT',name_ar:'أجهزة وتقنية',name_en:'Devices and IT',section:'الأجهزة والدعم',department_id:'it',words:['تقنيه','جهاز','حاسب','it'],
    description:'جهاز جديد، إصلاح أو دعم، صلاحية نظام، برنامج أو ترخيص، أو فك قفل حساب. اختر النوع أولًا.',
    options:[
      {code:'device',name_ar:'جهاز جديد أو ملحقات',name_en:'New device',service:'IT-DEVICE',words:['لابتوب','شاشه','ماوس']},
      {code:'repair',name_ar:'إصلاح أو دعم فني',name_en:'Repair or support',service:'IT-SUPPORT',words:['عطل','دعم','اصلاح','مشكله']},
      {code:'access',name_ar:'صلاحية نظام',name_en:'System access',service:'IT-ACCESS',words:['صلاحيه','دخول','نظام']},
      {code:'software',name_ar:'برنامج أو ترخيص',name_en:'Software or licence',service:'IT-SOFTWARE',words:['برنامج','ترخيص']},
      {code:'password',name_ar:'فك قفل حساب أو كلمة مرور',name_en:'Account unlock or password',service:'IT-PASSWORD-UNLOCK',words:['كلمه مرور','قفل','الباسورد']}
    ]},
  {code:'VAR-BENEFITS',name_ar:'مزايا',name_en:'Benefits',section:'المزايا والتأمين',department_id:'hr',words:['مزايا','تامين','سلفه'],
    description:'مطالبة تأمين طبي أو مزايا، أو سلفة على الراتب. شاشة «التأمين والمزايا» لموظف الموارد البشرية تستقبل ما يُعتمد هنا.',
    options:[
      {code:'medical',name_ar:'مطالبة تأمين طبي أو مزايا',name_en:'Medical or benefit claim',service:'HR-BENEFIT-CLAIM',words:['تامين','طبي','علاج'],docs:['الفاتورة أو التقرير الطبي عند المطالبة بتعويض']},
      {code:'advance',name_ar:'سلفة على الراتب',name_en:'Salary advance',service:'HR-SALARY-ADVANCE',words:['سلفه','قرض']},
      // دمج 20260919: «مزاياي» (103) طلب واحد بخيارات وحقوله ومستنداته ومساره في benefits-portal.mjs؛ البطاقة تفتح الشاشة، وكل خيار يُفتح بـ#my-benefits/new?option=<key>.
      {code:'my_benefits',name_ar:'تابعو التأمين أو ترقية الفئة أو التذكرة أو بدل التعليم أو خطاب المزايا',name_en:'Insurance dependants, class upgrade, ticket, education or benefits letter',link:'#my-benefits',ready:'staff',words:['تابع','تذكره','تعليم','ترقيه','مزاياي']}
    ]},
  // ── عشرون مجموعة تُضاف بالآلية نفسها (131) ─────────────────────────────────────────────────────────────
  // القاعدة الحسابية التي تفرضها: 9 فئات × 12 بطاقة = 108، و143 > 108. فقاعدتا «6–9 فئات» و«قسّم فوق 12»
  // لا تصدقان معًا على 143 بندًا إن كانت البطاقة = خدمة واحدة. والحل الوحيد الذي لا يخالف أيًّا منهما ولا
  // يخفي خدمة: البطاقة قد تكون مجموعة خيارات — وهي آلية **مشحونة وتعمل** منذ 19 سبتمبر لا اختراعًا.
  // بلا هذه العشرين تصير فئة «مشاريعي وعملائي» 59 بطاقة وفئة «الدعم والحوكمة» 22.
  //
  // واسم الخيار هو **اسم خدمته بالحرف**، لا اسم عرضٍ ثانيًا: اسمان للخدمة يفترقان بعد ثلاثة أشهر، فيقول
  // البحث اسمًا و«طلباتي» اسمًا وسلسلة التدقيق ثالثًا. (الست القديمة تحمل تسميات عرضٍ سابقة لهذا القرار،
  // وهي مسمّاة في tests/catalog-tree.test.mjs بوصفها إرثًا لا سابقةً يُبنى عليها.)
  //
  // وdocs[] تُترك فارغةً **عمدًا**: لم يعتمد أحد قائمة مستندات لهذه الخيارات، وقسم «المستندات المطلوبة»
  // لا يُرسم عنوانًا فوق فراغ. تُملأ حين يكتبها مالك الإجراء، لا حين يخمّنها المهندس.
  {code:'VAR-CREATIVE',name_ar:'طلب شغل إبداعي',name_en:'Creative work request',section:'التصميم',department_id:'creative',words:['تصميم','محتوى','ديزاين','design','ترجمه','بوستر'],
    description:'تصميم، محتوى، ترجمة، تعديل مخرج، أو تكليف داخلي. اختر النوع أولًا.',
    options:[
      {code:'design',name_ar:'طلب تصميم',name_en:'Design request',service:'CRT-DESIGN',words:['تصميم','بوستر','جرافيك'],docs:[]},
      {code:'content',name_ar:'طلب كتابة محتوى',name_en:'Content writing request',service:'CRT-CONTENT',words:['محتوى','كتابه','كابشن','سكربت'],docs:[]},
      {code:'revision',name_ar:'طلب تعديل على مخرج',name_en:'Revision request',service:'CRT-REVISION',words:['تعديل','مراجعه','ريفيجن'],docs:[]},
      {code:'translation',name_ar:'ترجمة أو تدقيق لغوي',name_en:'Translation or proofreading',service:'CRT-TRANSLATION',words:['ترجمه','تدقيق','انجليزي'],docs:[]},
      {code:'brief',name_ar:'تكليف إبداعي داخلي',name_en:'Internal creative brief',service:'CREATIVE-BRIEF',words:['بريف','تكليف','كامبين'],docs:[]}
    ]},
  {code:'VAR-PRODUCTION',name_ar:'طلب إنتاج مرئي أو فعالية',name_en:'Production request',section:'التصوير والإنتاج',department_id:'production',words:['تصوير','انتاج','فيديو','production','فعاليه','مونتاج'],
    description:'تصوير، مونتاج، معدات، موقع، طاقم، تسليم، أو فعالية عميل. اختر النوع أولًا.',
    options:[
      {code:'shoot',name_ar:'تصوير أو إنتاج مرئي',name_en:'Photo or video production',service:'PRO-SHOOT',words:['تصوير','فيديو','فوتو','كاميرا'],docs:[]},
      {code:'edit',name_ar:'مونتاج أو مراجعة نسخة',name_en:'Edit or cut review',service:'PRO-EDIT-REVIEW',words:['مونتاج','نسخه','كت'],docs:[]},
      {code:'equipment',name_ar:'حجز معدات إنتاج',name_en:'Production equipment booking',service:'PRO-EQUIPMENT',words:['معدات','اضاءه','عدسات'],docs:[]},
      {code:'location',name_ar:'موقع تصوير وتصريح',name_en:'Shooting location and permit',service:'PRO-LOCATION',words:['موقع','لوكيشن','تصريح'],docs:[]},
      {code:'freelancer',name_ar:'تعاقد مع مستقل أو طاقم',name_en:'Freelancer or crew booking',service:'PRO-FREELANCER',words:['مستقل','فريلانسر','طاقم'],docs:[]},
      {code:'delivery',name_ar:'تسليم مخرج نهائي وأرشفته',name_en:'Final delivery and archive',service:'PRO-DELIVERY',words:['تسليم','ارشفه','نهائيه'],docs:[]},
      {code:'event',name_ar:'تنظيم فعالية لعميل',name_en:'Client event',service:'PRO-EVENT',words:['فعاليه','ايفنت','حفل','معرض'],docs:[]}
    ]},
  {code:'VAR-DIGITAL',name_ar:'حملة رقمية',name_en:'Digital campaign',section:'الحملات والشراء الإعلامي',department_id:'marketing',words:['حمله','اعلان','رقمي','digital','سوشال','ميديا'],
    description:'إطلاق حملة، جدولة نشر، وصول لحساب إعلاني، ميزانية، تقرير، أو إقفال.',
    options:[
      {code:'campaign',name_ar:'حملة رقمية أو شراء إعلامي',name_en:'Digital campaign or media buying',service:'DIG-CAMPAIGN',words:['حمله','اعلان','كامبين'],docs:[]},
      {code:'post',name_ar:'جدولة نشر على المنصات',name_en:'Social media scheduling',service:'DIG-SOCIAL-POST',words:['نشر','بوست','سوشال','انستقرام'],docs:[]},
      {code:'ad_account',name_ar:'وصول لحساب إعلاني',name_en:'Ad account access',service:'DIG-AD-ACCOUNT',words:['حساب اعلاني','صلاحيه','ads'],docs:[]},
      {code:'budget',name_ar:'تعديل ميزانية أو تحسين حملة',name_en:'Live campaign budget or optimization change',service:'DIG-BUDGET-CHANGE',words:['ميزانيه','تحسين','زياده'],docs:[]},
      {code:'report',name_ar:'تقرير أداء حملة',name_en:'Campaign performance report',service:'DIG-PERFORMANCE-REPORT',words:['تقرير','نتائج','اداء'],docs:[]},
      {code:'close',name_ar:'إقفال حملة',name_en:'Campaign closure',service:'DIG-CAMPAIGN-CLOSE',words:['اقفال','انهاء','تصفيه'],docs:[]}
    ]},
  {code:'VAR-PR',name_ar:'ظهور إعلامي',name_en:'Media and PR',section:'الإعلام',department_id:'pr',words:['اعلام','صحافه','بيان','تغطيه','صحفي'],
    description:'بيان صحفي، ظهور، دعوات لفعالية، تقرير أثر، أو تنبيه قضية.',
    options:[
      {code:'media',name_ar:'بيان صحفي أو ظهور إعلامي',name_en:'Press release or media appearance',service:'PR-MEDIA-REQUEST',words:['بيان','صحفي','مقابله','ظهور'],docs:[]},
      {code:'accreditation',name_ar:'دعوات واعتمادات إعلامية',name_en:'Media invitations and accreditation',service:'PR-EVENT-MEDIA',words:['دعوات','اعتماد','اعلاميين'],docs:[]},
      {code:'impact',name_ar:'تقرير تغطية وأثر إعلامي',name_en:'Coverage and impact report',service:'PR-IMPACT-REPORT',words:['تغطيه','اثر','كليبنق'],docs:[]},
      {code:'alert',name_ar:'تنبيه قضية إعلامية',name_en:'Media issue alert',service:'PR-ISSUE-ALERT',words:['ازمه','قضيه','تنبيه','طارئ'],docs:[]}
    ]},
  {code:'VAR-INFLUENCER',name_ar:'حملة مؤثرين',name_en:'Influencer campaign',section:'المؤثرون',department_id:'pr',words:['مؤثرين','انفلونسر','مشاهير','influencer'],
    description:'تعاقد مع مؤثر، اعتماد محتواه، وإثبات تنفيذ وسداد.',
    options:[
      {code:'campaign',name_ar:'حملة مؤثرين',name_en:'Influencer campaign',service:'INF-CAMPAIGN',words:['مؤثرين','حمله','كامبين'],docs:[]},
      {code:'contract',name_ar:'عرض وعقد مؤثر',name_en:'Influencer offer and contract',service:'INF-CONTRACT',words:['عقد','عرض','اتفاقيه'],docs:[]},
      {code:'approval',name_ar:'اعتماد محتوى مؤثر قبل النشر',name_en:'Influencer content approval',service:'INF-CONTENT-APPROVAL',words:['اعتماد','محتوى','قبل النشر'],docs:[]},
      {code:'payment',name_ar:'إثبات تنفيذ وسداد',name_en:'Influencer proof and payment',service:'INF-PROOF-PAYMENT',words:['اثبات','سداد','دفع','استحقاق'],docs:[]}
    ]},
  {code:'VAR-BRAND',name_ar:'اعتماد هوية أو أصل',name_en:'Brand approval',section:'الالتزام بالهوية',department_id:'brand',words:['هويه','براند','شعار','تسميه','مطبوعات'],
    description:'التزام بالهوية، أصل هوية جديد، أصل من المكتبة، تسمية، أو مطبوعات وهدايا.',
    options:[
      {code:'compliance',name_ar:'مراجعة التزام بالهوية',name_en:'Brand compliance review',service:'BRAND-COMPLIANCE',words:['التزام','هويه','دليل'],docs:[]},
      {code:'asset',name_ar:'إنشاء أصل هوية',name_en:'New brand asset',service:'BRAND-ASSET-CREATE',words:['اصل','شعار','قالب'],docs:[]},
      // انتقل من VAR-CREATIVE (مراجعة 23 سبتمبر): إدارته brand، وبطاقة المجموعة في المشغّل القديم تُسنَد إلى إدارة مجموعتها، فكان الوحيد الذي لا يُتصفَّح تحت إدارته.
      {code:'library',name_ar:'طلب أصل من المكتبة الرقمية',name_en:'Digital asset request',service:'CRT-ASSET-REQUEST',words:['شعار','لوقو','مكتبه','هويه','اصل رقمي'],docs:[]},
      {code:'naming',name_ar:'اعتماد اسم أو تسمية',name_en:'Naming approval',service:'BRAND-NAMING',words:['تسميه','اسم','مسمى'],docs:[]},
      {code:'merch',name_ar:'مطبوعات وهدايا دعائية',name_en:'Print and merchandise',service:'BRAND-MERCH',words:['مطبوعات','هدايا','بروشور','تيشرت'],docs:[]}
    ]},
  {code:'VAR-PROJECT',name_ar:'إدارة مشروع',name_en:'Project management',section:'دورة المشروع',department_id:'epmo',words:['مشروع','project','موارد','اقفال','pmo'],
    description:'فتح مشروع، موارد، إسناد خارجي، إقفال، أو بلاغ خطر وتأخر.',
    options:[
      {code:'open',name_ar:'طلب فتح مشروع',name_en:'Project initiation',service:'PMO-NEW-PROJECT',words:['مشروع جديد','فتح','نطاق'],docs:[]},
      {code:'resource',name_ar:'طلب موارد لمشروع',name_en:'Project resource request',service:'PMO-RESOURCE',words:['موارد','فريق','ساعات','تخصيص'],docs:[]},
      {code:'subcontract',name_ar:'إسناد عمل لطرف خارجي',name_en:'Subcontracting',service:'PMO-SUBCONTRACT',words:['اسناد','باطن','طرف خارجي'],docs:[]},
      {code:'closure',name_ar:'إقفال مشروع',name_en:'Project closure',service:'PMO-CLOSURE',words:['اقفال','انهاء','تسليم'],docs:[]},
      {code:'risk',name_ar:'بلاغ خطر أو تأخر مشروع',name_en:'Project risk or delay',service:'PMO-RISK-ISSUE',words:['خطر','تاخر','تصعيد'],docs:[]}
    ]},
  {code:'VAR-CLIENT',name_ar:'إدارة حساب عميل',name_en:'Client account management',section:'إدارة الحسابات',department_id:'accounts',words:['عميل','حساب','اكاونت','تكليف','بريف'],
    description:'تكليف، تغيير، شكوى، تقرير حالة، محضر، تصعيد، أو تجديد.',
    options:[
      {code:'intake',name_ar:'استقبال تكليف من عميل',name_en:'Client brief intake',service:'ACC-BRIEF-INTAKE',words:['تكليف','بريف','طلب عميل'],docs:[]},
      {code:'change',name_ar:'طلب تغيير من عميل',name_en:'Client change request',service:'ACC-CHANGE-REQUEST',words:['تغيير','تعديل نطاق','اضافه'],docs:[]},
      // P4-CRM-5: لمن في فريق حساب عميل، تفتح الشكوى والتصعيد نموذج البلاغ في «دعم العملاء» (سجلٌّ على العميل والصفقة بمهلته).
      {code:'complaint',name_ar:'شكوى أو ملاحظة عميل',name_en:'Client complaint',service:'ACC-CLIENT-COMPLAINT',link:'#client-support/new?kind=complaint',ready:'client_team',words:['شكوى','ملاحظه','اعتراض'],docs:[]},
      {code:'status',name_ar:'تقرير حالة للعميل',name_en:'Client status report',service:'ACC-STATUS-REPORT',words:['تقرير','حاله','تحديث'],docs:[]},
      {code:'minutes',name_ar:'محضر اجتماع عميل وقراراته',name_en:'Client meeting minutes',service:'ACC-MEETING-MINUTES',words:['محضر','اجتماع','قرارات'],docs:[]},
      {code:'escalation',name_ar:'تصعيد حساب عميل',name_en:'Account escalation',service:'ACC-ESCALATION',link:'#client-support/new?kind=escalation',ready:'client_team',words:['تصعيد','مشكله عميل'],docs:[]},
      // P4-CRM-6: لمن في فريق حساب عميل بتصريح المبيعات، يفتح التجديد فرصة من العقد السابق بنطاقه وأسعاره.
      {code:'renewal',name_ar:'تجديد أو توسعة حساب عميل',name_en:'Account renewal or expansion',service:'ACC-RENEWAL',link:'#pipeline/renewal',ready:'renewal',words:['تجديد','توسعه','تمديد'],docs:[]}
    ]},
  {code:'VAR-OPPORTUNITY',name_ar:'إدارة فرصة بيع',name_en:'Sales opportunity',section:'المبيعات والفرص',department_id:'business-dev',words:['فرصه','مبيعات','تسعير','منافسه','عرض سعر'],
    description:'تسجيل فرصة، تسعير أو استثناء هامش، خسارة، أو تسليم للتشغيل.',
    options:[
      // الباب الأمامي الواحد (الحزمة 4، P4-CRM-3): الخيار يفتح السجل المهيكل حين يستقبله الحساب؛ والطلب العام بالرمز نفسه يُرفض بإشارة إليه.
      {code:'opportunity',name_ar:'تسجيل فرصة أو منافسة',name_en:'Opportunity or tender registration',service:'CRM-OPPORTUNITY',link:'#pipeline',ready:'client_team',words:['فرصه','منافسه','مناقصه','تندر'],docs:[]},
      {code:'pricing',name_ar:'تسعير أو استثناء هامش',name_en:'Pricing or margin exception',service:'CRM-PRICING',words:['تسعير','هامش','خصم','استثناء'],docs:[]},
      {code:'loss',name_ar:'تسجيل خسارة فرصة',name_en:'Lost opportunity record',service:'CRM-LOSS',link:'#pipeline',ready:'open_opportunity',words:['خساره','ضاعت','خسرنا'],docs:[]},
      {code:'handover',name_ar:'تسليم فرصة للتشغيل',name_en:'Won deal handover',service:'CRM-HANDOVER',link:'#project-handover',ready:'handover',words:['تسليم','مكسوبه','تحويل'],docs:[]}
    ]},
  {code:'VAR-RESEARCH',name_ar:'بحث ودعم عروض',name_en:'Research and pitch support',section:'البحث والتحليل',department_id:'business-dev',words:['بحث','تحليل','منافسين','بيتش','سوق'],
    description:'بحث سوق، تحليل منافسين، دعم عرض، خطة حملة، أو مراجعة بعدية.',
    options:[
      {code:'research',name_ar:'بحث أو تحليل سوق',name_en:'Research or market analysis',service:'STR-RESEARCH',words:['بحث','سوق','دراسه','جمهور'],docs:[]},
      {code:'competitor',name_ar:'تحليل منافسين',name_en:'Competitor analysis',service:'STR-COMPETITOR',words:['منافسين','مقارنه','بنشمارك'],docs:[]},
      {code:'pitch',name_ar:'دعم عرض أو منافسة',name_en:'Pitch or tender support',service:'STR-PITCH-SUPPORT',words:['عرض','بيتش','بروبوزال'],docs:[]},
      {code:'plan',name_ar:'خطة حملة وقنوات',name_en:'Campaign and channel plan',service:'STR-CAMPAIGN-PLAN',words:['خطه','قنوات','استراتيجيه'],docs:[]},
      {code:'post_campaign',name_ar:'مراجعة ما بعد الحملة',name_en:'Post-campaign review',service:'STR-POST-CAMPAIGN',words:['مراجعه','دروس','بعد الحمله'],docs:[]}
    ]},
  {code:'VAR-REPORT',name_ar:'تقرير أو لوحة مؤشرات',name_en:'Report or dashboard',section:'التقارير واللوحات',department_id:'campaigns-audit',words:['تقرير','لوحه','داشبورد','مؤشرات','ربحيه'],
    description:'طلب تقرير أو لوحة، تحليل ربحية، أو قياس عائد مبادرة.',
    options:[
      {code:'dashboard',name_ar:'طلب تقرير أو لوحة مؤشرات',name_en:'Report or dashboard request',service:'DAT-DASHBOARD',words:['تقرير','لوحه','مؤشر','bi'],docs:[]},
      {code:'profitability',name_ar:'تحليل ربحية مشروع أو عميل',name_en:'Project or client profitability',service:'DAT-PROFITABILITY',words:['ربحيه','هامش','تكلفه'],docs:[]},
      {code:'roi',name_ar:'قياس عائد مبادرة',name_en:'Initiative ROI measurement',service:'DAT-ROI',words:['عائد','قياس','جدوى','مردود'],docs:[]}
    ]},
  {code:'VAR-DATA',name_ar:'بيانات وذكاء اصطناعي',name_en:'Data and AI',section:'حوكمة البيانات',department_id:'campaigns-audit',words:['بيانات','داتا','ذكاء اصطناعي','معرفه','جوده'],
    description:'وصول لبيانات، بلاغ خطأ، استخدام أداة ذكاء اصطناعي، أو إضافة معرفة.',
    options:[
      {code:'access',name_ar:'طلب وصول لبيانات',name_en:'Data access request',service:'DAT-DATA-ACCESS',words:['بيانات','وصول','صلاحيه','خام'],docs:[]},
      {code:'quality',name_ar:'بلاغ خطأ في بيانات',name_en:'Data quality issue',service:'DAT-DATA-QUALITY',words:['جوده','خطا','ناقص','غلط'],docs:[]},
      {code:'ai',name_ar:'استخدام أداة ذكاء اصطناعي',name_en:'AI tool use request',service:'DAT-AI-USE',words:['ذكاء اصطناعي','اداه','اعتماد'],docs:[]},
      {code:'knowledge',name_ar:'إضافة محتوى لقاعدة المعرفة',name_en:'Knowledge base contribution',service:'DAT-KNOWLEDGE',words:['معرفه','مقال','ويكي','توثيق'],docs:[]}
    ]},
  {code:'VAR-PROCURE',name_ar:'طلب شراء',name_en:'Purchase request',section:'طلبات الشراء',department_id:'procurement',words:['شراء','po','امر شراء','طلبيه','اشتري'],
    description:'شراء عادي أو طارئ، أو تعديل أمر شراء قائم.',
    options:[
      {code:'standard',name_ar:'طلب شراء',name_en:'Purchase request',service:'PRC-PURCHASE-REQUEST',words:['شراء','طلبيه','po','بيرتشس'],docs:[]},
      {code:'emergency',name_ar:'شراء طارئ',name_en:'Emergency purchase',service:'PRC-EMERGENCY',words:['طارئ','عاجل','مستعجل'],docs:[]},
      {code:'change',name_ar:'تعديل أمر شراء',name_en:'Purchase order change',service:'PRC-PO-CHANGE',words:['تعديل','امر شراء','تغيير طلبيه'],docs:[]}
    ]},
  {code:'VAR-VENDOR',name_ar:'إدارة مورد',name_en:'Vendor management',section:'الموردون',department_id:'procurement',words:['مورد','vendor','سبلاير','تسجيل مورد'],
    description:'تسجيل مورد جديد، تحديث حسابه البنكي، أو تقييم أدائه.',
    options:[
      {code:'registration',name_ar:'تسجيل مورد جديد',name_en:'New vendor registration',service:'PRC-VENDOR-REGISTRATION',words:['مورد جديد','تسجيل','سجل تجاري'],docs:[]},
      {code:'bank',name_ar:'تحديث حساب مورد البنكي',name_en:'Vendor payment details change',service:'PRC-VENDOR-BANK',words:['ايبان','بنك مورد','تحديث بنكي'],docs:[]},
      {code:'evaluation',name_ar:'تقييم أداء مورد',name_en:'Vendor performance review',service:'PRC-VENDOR-EVALUATION',words:['تقييم','اداء مورد'],docs:[]}
    ]},
  {code:'VAR-INVOICE',name_ar:'فوترة عميل وتحصيل',name_en:'Client billing and collection',section:'الفوترة والتحصيل',department_id:'finance',words:['فاتوره','تحصيل','invoice','متأخرات','اشعار دائن'],
    description:'إصدار فاتورة، متابعة تحصيل متأخر، أو إشعار دائن واسترداد.',
    options:[
      {code:'issue',name_ar:'طلب إصدار فاتورة لعميل',name_en:'Client invoice request',service:'FIN-CLIENT-INVOICE',words:['فاتوره','اصدار','مطالبه'],docs:[]},
      {code:'collection',name_ar:'متابعة تحصيل متأخر',name_en:'Overdue collection follow-up',service:'FIN-COLLECTION-FOLLOWUP',words:['تحصيل','متأخر','مديونيه'],docs:[]},
      {code:'refund',name_ar:'طلب إشعار دائن أو استرداد',name_en:'Client credit note or refund',service:'FIN-REFUND',words:['اشعار دائن','استرداد','الغاء فاتوره'],docs:[]}
    ]},
  {code:'VAR-LEGAL',name_ar:'استشارة أو مراجعة قانونية',name_en:'Legal review or advice',section:'العقود والاتفاقيات',department_id:'grc',words:['قانوني','عقد','محامي','اتفاقيه','nda'],
    description:'مراجعة عقد، اتفاقية عدم إفصاح، استشارة، ملكية فكرية، أو ترخيص.',
    options:[
      {code:'contract',name_ar:'مراجعة عقد',name_en:'Contract review',service:'LEG-CONTRACT-REVIEW',words:['عقد','مراجعه','بنود','توقيع'],docs:[]},
      {code:'nda',name_ar:'اتفاقية عدم إفصاح',name_en:'Non-disclosure agreement',service:'LEG-NDA',words:['nda','عدم افصاح','سريه'],docs:[]},
      {code:'consultation',name_ar:'استشارة قانونية',name_en:'Legal consultation',service:'LEG-CONSULTATION',words:['استشاره','سؤال','رأي قانوني'],docs:[]},
      {code:'ip',name_ar:'حقوق ملكية فكرية أو علامة',name_en:'IP rights or trademark',service:'LEG-IP-RIGHTS',words:['علامه','ملكيه فكريه','براءه'],docs:[]},
      {code:'license',name_ar:'ترخيص أو تصريح حكومي',name_en:'Government license or permit',service:'LEG-LICENSE-PERMIT',words:['ترخيص','تصريح','رخصه بلديه'],docs:[]}
    ]},
  {code:'VAR-DECISION',name_ar:'قرار تنفيذي أو بند اجتماع',name_en:'Executive decision or agenda item',section:'القرارات والاجتماعات',department_id:'ceo-office',words:['قرار','اجتماع تنفيذي','بند','الرئاسه','موافقه عليا'],
    description:'طلب قرار من الرئاسة، أو إدراج بند في اجتماع تنفيذي.',
    options:[
      {code:'decision',name_ar:'طلب قرار تنفيذي',name_en:'Executive decision request',service:'GOV-DECISION',words:['قرار','تنفيذي','رئاسه'],docs:[]},
      {code:'agenda',name_ar:'إدراج بند في اجتماع',name_en:'Executive meeting agenda item',service:'GOV-MEETING-ITEM',words:['بند','جدول اعمال','ادراج'],docs:[]}
    ]},
  {code:'VAR-STRATEGY',name_ar:'هدف أو مبادرة إستراتيجية',name_en:'Objective or initiative',section:'الأهداف والمؤشرات',department_id:'epmo',words:['هدف','مؤشر','kpi','مبادره','استراتيجيه'],
    description:'اعتماد هدف أو مؤشر، أو تسجيل مبادرة إستراتيجية.',
    options:[
      {code:'objective',name_ar:'اعتماد هدف أو مؤشر',name_en:'Objective or KPI approval',service:'GOV-OBJECTIVE',words:['هدف','مؤشر','مستهدف'],docs:[]},
      {code:'initiative',name_ar:'تسجيل مبادرة إستراتيجية',name_en:'Strategic initiative',service:'GOV-INITIATIVE',words:['مبادره','خطه','مشروع استراتيجي'],docs:[]}
    ]},
  {code:'VAR-INTERNAL-COMMS',name_ar:'تواصل داخلي وفعاليات',name_en:'Internal comms and events',section:'التواصل الداخلي',department_id:'comms',words:['تعميم','فعاليه','ترحيب','توديع','اعلان داخلي'],
    description:'تعميم داخلي، فعالية داخلية، ترحيب بموظف، أو توديعه.',
    options:[
      {code:'announcement',name_ar:'نشر تعميم داخلي',name_en:'Internal announcement',service:'EXP-ANNOUNCEMENT',words:['تعميم','اعلان','نشره'],docs:[]},
      {code:'event',name_ar:'فعالية داخلية',name_en:'Internal event',service:'EXP-INTERNAL-EVENT',words:['فعاليه','حفل','تجمع'],docs:[]},
      {code:'welcome',name_ar:'برنامج ترحيب بموظف جديد',name_en:'New joiner welcome',service:'EXP-WELCOME',words:['ترحيب','موظف جديد','اول يوم'],docs:[]},
      {code:'farewell',name_ar:'توديع موظف',name_en:'Farewell',service:'EXP-FAREWELL',words:['توديع','وداع','مغادره'],docs:[]}
    ]},
  {code:'VAR-VOICE',name_ar:'صوت الموظف',name_en:'Employee voice',section:'صوت الموظف',department_id:'comms',words:['اقتراح','استبيان','موظف الشهر','لقاء','تقدير'],
    description:'اقتراح تحسين، ترشيح موظف الشهر، لقاء مع القيادة، أو استبيان.',
    options:[
      {code:'suggestion',name_ar:'اقتراح تحسين',name_en:'Improvement suggestion',service:'EXP-SUGGESTION',words:['اقتراح','تحسين','فكره'],docs:[]},
      {code:'recognition',name_ar:'ترشيح موظف الشهر',name_en:'Employee of the month nomination',service:'EXP-RECOGNITION',words:['ترشيح','تقدير','شكر'],docs:[]},
      {code:'leadership',name_ar:'طلب لقاء مع القيادة',name_en:'Leadership meeting request',service:'EXP-LEADERSHIP-MEETING',words:['لقاء','قياده','المدير العام'],docs:[]},
      {code:'survey',name_ar:'إطلاق استبيان',name_en:'Survey launch',service:'EXP-SURVEY',words:['استبيان','استطلاع','نبض'],docs:[]}
    ]}
];
const VARIANT_ROLE={manager:'مديرك',department_manager:'مدير الإدارة المنفذة',hr:'الموارد البشرية',it:'تقنية المعلومات',pm:'مدير المشروع',executive:'الرئاسة'};
const VARIANT_ROLE_EN={manager:'your manager',department_manager:'the handling department head',hr:'HR',it:'IT',pm:'the project manager',executive:'the executive office'};
const workingDays=n=>n===1?'يوم عمل واحد':n===2?'يومي عمل':n<=10?`${n} أيام عمل`:`${n} يوم عمل`;
// «سيمر طلبك على: مديرك ← الموارد البشرية، خلال 3 أيام عمل». الخطوة الكائنية تذكر إدارتها باسمها، والمشروطة تُعلَّم.
export function chainPreview(db,tenantId,service){
  const name=id=>db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(id,tenantId)?.name??id;
  const policy=service.approval_policy??{steps:[]},steps=(policy.steps??[]).map(normalizeStep).filter(Boolean);
  const label=(s,en)=>{
    const dept=s.department??service.department_id;
    const base=s.role==='department_manager'&&s.department?(en?`head of ${name(s.department)}`:`مدير ${name(s.department)}`)
      :['hr','it'].includes(s.role)&&dept!==s.role?(en?`${name(dept)} approver`:`معتمد ${name(dept)}`)
      :(en?VARIANT_ROLE_EN:VARIANT_ROLE)[s.role]??s.role;
    return s.when?`${base} ${en?'(conditional)':'(بشرط)'}`:base;
  };
  const chain=steps.map(s=>label(s,false)),chain_en=steps.map(s=>label(s,true)),handler=name(service.department_id),sla=service.target_days||null;
  const text=(chain.length?`سيمر طلبك على: ${chain.join(' ← ')}`:`يصل طلبك مباشرة إلى ${handler}`)+(sla?`، خلال ${workingDays(sla)}`:'')+'.';
  const text_en=(chain_en.length?`Your request goes to: ${chain_en.join(' → ')}`:`Your request goes straight to ${handler}`)+(sla?`, within ${sla} working day${sla===1?'':'s'}`:'')+'.';
  return {chain,chain_en,handler,sla_days:sla,mode:policy.mode??'sequential',text,text_en};
}
// خيارات بطاقة «إجازة» من أرصدة صاحب الحساب نفسه، **نوعًا نوعًا وللسنة الجارية وحدها** — المصدر الواحد الذي تقرؤه بطاقة
// الخيارات وصفّ «لك» سواء (مراجعة 23 سبتمبر: كان «لك» يجمع كل الأنواع وكل السنين في رقمٍ لا تطبعه شاشة الإجازات).
// دمج 20260919: بعد اعتماد سياسة أنواع الإجازات (098) وتهيئة تقويم الإدارة، الخيارات هي الأنواع النظامية التي يتاح منها طلب،
// ويفتح كل خيار نموذج «request» الواحد بالنوع مختارًا. قبل ذلك تبقى الأرصدة الافتتاحية كما بناها 101.
export function leaveBalanceOptions(db,supplied){
  const u=currentUser(db,supplied)??supplied;
  if(!u||u.role==='admin')return [];
  let data=null;try{data=listLeave(db,u);}catch{return [];}
  if(data?.statutory?.ready)return data.statutory.balances.filter(b=>!b.note&&(b.available_days===null||Number(b.available_days)>0))
    .map(b=>({code:b.code,name_ar:b.name_ar,name_en:b.code,mode:'module',link:`#leave/new?kind=${encodeURIComponent(b.code)}`,available:true,words:[],
      docs:(b.documents??[]).filter(d=>d.required).map(d=>d.name_ar),preset:{},fields:[],preview:null,target_days:null,
      available_days:b.available_days===null?null:Number(b.available_days),unit_name:b.unit_name,balance_year:data.statutory.year??null,
      note:b.available_days!==null?`المتاح ${b.available_days} ${b.unit_name}`:b.per_event_days?`${b.per_event_days} لكل واقعة`:b.unit_name}));
  const year=Number(new Date(Date.now()+3*3600000).toISOString().slice(0,4));
  return (data?.balances??[]).filter(b=>b.employee_id===u.id&&b.balance_year===year&&b.available_days>0)
    .map(b=>({code:b.leave_type,name_ar:b.leave_type_name,name_en:b.leave_type,mode:'module',link:`#leave/new?type=${encodeURIComponent(b.leave_type)}&id=${encodeURIComponent(b.id)}`,
      available:true,words:[],docs:b.leave_type==='sick'?['التقرير الطبي المعتمد']:[],preset:{},fields:[],preview:null,target_days:null,
      available_days:Number(b.available_days),unit_name:'يومًا',balance_year:b.balance_year,note:`المتاح ${b.available_days} يومًا`}));
}
// المجموعات كما يراها هذا الحساب: الخيار متاح إن كانت خدمته في الدليل أو كانت شاشته جاهزة له. المجموعة بلا خيار متاح لا تظهر.
export function variantCatalog(db,supplied){
  const u=currentUser(db,supplied)??supplied;
  const services=catalog(db,u),byCode=new Map(services.map(s=>[s.code,s])),ready=routeReadiness(db,u);
  const letterTypes=new Set(ready.has('letters')?db.prepare("SELECT type_code FROM letter_templates WHERE tenant_id=? AND status='published'").all(u.tenant_id).map(r=>r.type_code):[]);
  const isReady=key=>key?.startsWith('letter:')?letterTypes.has(key.slice(7)):!!key&&ready.has(key);
  return SERVICE_VARIANTS.map(group=>{
    const options=(group.options==='leave_balances'?leaveBalanceOptions(db,u):group.options.map(o=>{
      const s=o.service?byCode.get(o.service)??null:null,module=!!o.link&&isReady(o.ready);
      if(!s&&!module)return {code:o.code,available:false};
      const fields=s?enrichFields(s.code,s.fields).filter(f=>!Object.hasOwn(o.preset??{},f.key)):[];
      return {code:o.code,name_ar:o.name_ar,name_en:o.name_en,words:o.words??[],docs:o.docs??[],available:true,
        mode:module?'module':'request',link:module?o.link:null,service_code:s?.code??null,service_id:s?.id??null,
        preset:o.preset??{},fields,preview:s?chainPreview(db,u.tenant_id,s):null,target_days:s?.target_days??null,
        // زمن الخيار كزمن الخدمة سواء: يصل ومعه من اشتقّه ومن تبنّاه، فلا يُقرأ في بطاقة الخيار وعدًا (app/service-target.mjs).
        target:s?targetProvenance(db,u.tenant_id,s.code,{target_days:s.target_days??0,target_hours:s.target_hours??0}):null};
    })).filter(o=>o.available);
    const first=options.find(o=>o.service_code);
    return {code:group.code,name_ar:group.name_ar,name_en:group.name_en,description:group.description,section:group.section,words:group.words,
      department_id:(first&&byCode.get(first.service_code)?.department_id)||group.department_id,
      aliases:group.options==='leave_balances'?[]:group.options.map(o=>o.service).filter(Boolean),options};
  }).filter(g=>g.options.length);
}
// الخيار المختار يقرر خدمة الطلب وقيمه الثابتة: يُحل الرمز على الخادم، وتُفرض قيم preset فوق المرسل، ولا يقبل خدمة غير خدمة الخيار.
// الطلب بعد ذلك طلب عادي على تلك الخدمة: التحقق من الحقول ومسار الاعتماد والزمن المستهدف كلها من المحرك نفسه.
export function applyVariant(db,supplied,input){
  if(!input||typeof input!=='object'||input.variant===undefined)return input;
  const {variant,...rest}=input;
  v.object(variant,['group','option']);
  const group=SERVICE_VARIANTS.find(g=>g.code===variant.group);
  if(!group||!Array.isArray(group.options))fail(400,'variant_unknown','مجموعة الخيارات هذي ما نعرفها');
  const option=group.options.find(o=>o.code===variant.option);
  if(!option)fail(400,'variant_unknown','الخيار هذا ما نعرفه في هذي الخدمة');
  if(!option.service)fail(409,'variant_module','الخيار هذا يتقدّم من شاشته المخصصة، مو بطلب عام');
  const u=currentUser(db,supplied)??supplied,s=catalog(db,u).find(x=>x.code===option.service);
  // الموقوفة قبل الغائبة (مراجعة 22 سبتمبر): الخيار يختفي من البطاقة، لكن هذا المسار يُبلَغ ممن كانت نافذته
  // مفتوحة لحظة قلب المفتاح، ومن POST /api/requests بجسم فيه variant. كان الرفض يقول «غير متاحة في دليل
  // شركتك» — وهي في دليل شركته، أوقفها مالكها — بلا سبب ولا مالك ولا خطوة تالية، أي fail عارٍ في موضع
  // يشترط فيه «السور» رفضًا مكتوبًا. refuseHidden يقولها، والرفض القديم يبقى لحاله وحدها: خدمة ليست في الكتالوج.
  if(!s&&isHidden(db,u.tenant_id,'service',option.service)){
    const name=db.prepare('SELECT name_ar FROM services WHERE tenant_id=? AND code=? ORDER BY version DESC LIMIT 1').get(u.tenant_id,option.service)?.name_ar;
    refuseHidden(db,u.tenant_id,'service',option.service,name??option.name_ar??option.service);
  }
  if(!s)fail(409,'service_unavailable','خدمة هذا الخيار مو متاحة في دليل شركتك');
  if(rest.service_id!==undefined&&rest.service_id!==null&&rest.service_id!==''&&rest.service_id!==s.id)fail(400,'variant_mismatch','الخدمة المرسلة ما تطابق الخيار اللي اخترته');
  const payload=rest.payload&&typeof rest.payload==='object'&&!Array.isArray(rest.payload)?rest.payload:{};
  for(const [key,value] of Object.entries(option.preset??{})){
    const field=s.fields.find(f=>f.key===key);
    if(!field||(field.type==='select'&&!field.options.includes(value)))fail(500,'variant_preset','فيه قيمة ثابتة في الخيار ما تطابق حقول الخدمة');
  }
  return {...rest,service_id:s.id,payload:{...payload,...(option.preset??{})}};
}
