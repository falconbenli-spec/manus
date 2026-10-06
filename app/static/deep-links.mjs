// الروابط العميقة للموظف (REF-APP-FRONTEND P1-2): #leave/new يفتح نموذج الإجازة بعد رسم شاشتها، وهكذا.
// وحدة نقية بلا DOM: app.mjs يقرأ الناتج ويضغط زر الشاشة نفسه، فتبقى قواعد النموذج قواعد الشاشة.
// operation: اسم الفعل في data-operation بالشاشة. special: فعل خاص تنفذه app.mjs (قسيمة أو نافذة طلب جديد).
export const DEEP_LINKS={
  // دمج 20260919: بعد اعتماد سياسة أنواع الإجازات (098) يختفي زر «create» لكل رصيد ويبقى زر «request» الواحد، فيُجرَّب بديلًا.
  // م0 «السور»: بطاقة «طلب إجازة» في دليل الخدمات تقود إلى #leave/request (module-services.mjs). كانت autoOpen في شاشة الإجازات
  // تفتحها حين تكون السياسة جاهزة فقط، وحين لا تكون لم يكن الرابط مسجلًا هنا فكانت النقرة لا تفعل شيئًا ولا تقول شيئًا.
  // مسجلة الآن بترتيب معكوس: زر السياسة المعتمدة أولًا ثم زر الرصيد الافتتاحي، وإلا فسبب مكتوب.
  leave:{new:{operation:'create',alternate:'request'},request:{operation:'request',alternate:'create'}},
  // دمج 20260919: معالج الخطابات (102) يرسم زرًا لكل نوع بمعرّف «type:<code>»، فيختار ?type= الزرَّ نفسه (عقد route() في letters-ui).
  letters:{new:{operation:'request_letter',rowParam:['type','type:']}},
  attendance:{correction:{operation:'request_correction'},overtime:{operation:'request_overtime'},mission:{operation:'request_mission'}},
  expenses:{new:{operation:'submit_claim'},custody:{operation:'request_custody'}},
  'hr-cases':{new:{operation:'file_case'},anonymous:{operation:'submit_anonymous'}},
  growth:{training:{operation:'request_training'}},
  // دمج 20260919: خيار بعينه في «مزاياي» (103)، مثل #my-benefits/new?option=ticket_claim؛ الخيار غير المتاح الآن لا يفتح غيره.
  'my-benefits':{new:{operation:'request_option',rowParam:['option','']}},
  payroll:{latest:{special:'payslip'}},
  // «اسأل عن السياسة» (ترحيل 111): #policy-assistant/ask يفتح صندوق السؤال مباشرة من الرئيسية.
  'policy-assistant':{ask:{operation:'ask_policy'}},
  catalog:{new:{special:'launcher'}},
  // بلاغ العميل (P4-CRM-5): بطاقتا الشكوى والتصعيد في الدليل تفتحان نموذج البلاغ بنوعه (?kind=).
  'client-support':{new:{operation:'open_case'}},
  // التجديد (P4-CRM-6): بطاقة «تجديد أو توسعة حساب عميل» تفتح فرصة التجديد من عقد قرب نهايته في «خط الفرص».
  pipeline:{renewal:{operation:'open_renewal'}}
};
// ما يقال للموظف إن لم يجد الرابط زره في الشاشة (لا رصيد، لا قالب، لا قسيمة بعد): جملة تشرح متى يتاح، لا خطأ.
export const UNAVAILABLE={
  leave:['لا يوجد رصيد إجازة متاح لك بعد. يضيفه فريق الموارد البشرية.','No leave balance is available to you yet. HR adds it.'],
  letters:['لا يوجد نوع خطاب له قالب معتمد بعد، فلا يمكن طلب خطاب الآن.','No letter type has an approved template yet, so a letter cannot be requested now.'],
  'my-benefits':['هذا الخيار غير متاح لك الآن؛ سبب ذلك مكتوب تحته في «مزاياي».','This option is not available to you now; the reason is shown under it in My benefits.'],
  payroll:['لا توجد قسيمة معتمدة لك بعد. تظهر القسيمة بعد اعتماد مسير الرواتب.','There is no approved payslip for you yet. It appears after the payroll run is approved.'],
  default:['هذا النموذج غير متاح لحسابك الآن.','This form is not available to your account now.']
};
// معاملات الرابط (?type=salary&id=…): id يختار زر الصف نفسه (رصيد إجازة بعينه)، وبقية المعاملات تملأ حقول النموذج
// بأسمائها في هذه الخريطة، ولا تُملأ إلا بقيمة موجودة في قائمة الحقل. خطابات: type ← type_code (أنواع وحدة الخطابات).
// leave: ?type و?id للرصيد الافتتاحي (يختار الصف)؛ ?kind يختار النوع في نموذج السياسة المعتمدة (098) إن كان في قائمته (دمج 20260919).
export const DEEP_LINK_FIELDS={letters:{type:'type_code'},leave:{kind:'leave_type'},expenses:{category:'category'},'hr-cases':{category:'category'},'client-support':{kind:'kind'}};
const SAFE=/^[\w.:-]{1,64}$/;
// م0 «السور» — لا نقرة ميتة صامتة. شاشات مقطعها الثاني سجلٌّ أو مسار فرعي تقرؤه الشاشة بنفسها، لا نية تفتح نموذجًا:
// #request/<id> و#departments/<id> و#forms/<id> و#search/<نص> و#policy-library/article/…. ما عداها فمقطعه الثاني نية،
// والنية إما مسجلة في DEEP_LINKS أو يقال لصاحبها لماذا لم تُفتح. من أضاف شاشة تقرأ مقطعها الثاني سجّلها هنا.
export const SUBROUTED_VIEWS=Object.freeze(['request','departments','forms','search','policy-library','employee-profile','services','section','workspace']);
// الشاشات التي يرسمها app.mjs بنفسه في render() خارج operationModules. فحص سلامة الروابط (scripts/quality-ratchet.mjs) يقرأ هذه القائمة
// مع مفاتيح operationModules ليعرف ما الشاشة المسجلة؛ وtests/links.test.mjs يطابقها على فروع render() فلا تنحرف عنها.
// ت1: الصفحات الجامعة الثلاث (team وorganization وplatform) يرسمها فرع واحد في render() من HUB_VIEWS (hubs-ui.mjs)، لا فرع لكل منها.
export const BUILTIN_VIEWS=Object.freeze(['home','portal','executive','org','work','workspace','requests','departments','catalog','services','request','projects','notifications','requirements','service-benchmark','integrations','platform-health','team','organization','platform','section']);
// ما يقال حين يحمل الرابط نية لا تعرفها الشاشة: سبب مكتوب وطريق، لا صمت.
export const UNKNOWN_INTENT=['هذا الرابط لا يفتح نموذجًا في هذه الشاشة. الشاشة مفتوحة أمامك، فابدأ من أزرارها.','This link does not open a form on this screen. The screen is open; start from its buttons.'];
export const unknownIntentText=(lang='ar')=>UNKNOWN_INTENT[lang==='ar'?0:1];
// يقرأ «#view/intent?…» ويعيد ما يفعله الموجّه. مسارات مثل #request/<id> و#departments/<id> ليست روابط عميقة فتعود valid:false
// ومعها subrouted:true؛ ونية غير مسجلة على شاشة أخرى تعود valid:false وsubrouted:false، وهذه هي التي لا يجوز أن تمر صامتة.
export function parseDeepLink(hash){
  const [path='',query='']=String(hash??'').replace(/^#/,'').split('?');
  const [view='',intent='']=path.split('/');
  const target=Object.hasOwn(DEEP_LINKS,view)&&intent&&Object.hasOwn(DEEP_LINKS[view],intent)?DEEP_LINKS[view][intent]:null;
  const params={},fields={},map=DEEP_LINK_FIELDS[view]??{};
  if(target&&query)for(const [key,value] of new URLSearchParams(query)){
    if(!SAFE.test(key)||!SAFE.test(value))continue;
    params[key]=value;
    if(Object.hasOwn(map,key))fields[map[key]]=value;
  }
  return {view:view||'home',intent:intent||null,valid:!!target,subrouted:SUBROUTED_VIEWS.includes(view),operation:target?.operation??null,alternate:target?.alternate??null,special:target?.special??null,base:'#'+(view||'home'),params,fields,row:params.id??(target?.rowParam&&params[target.rowParam[0]]?target.rowParam[1]+params[target.rowParam[0]]:null),
    exactRow:!params.id&&!!(target?.rowParam&&params[target.rowParam[0]])};
}
// سلامة الروابط: هل تصل حرفية «#view/intent» إلى شاشة مسجلة، وإن حملت نية فإلى نية مسجلة؟ نقية: تأخذ أسماء الشاشات ممن يعرفها
// (operationModules + BUILTIN_VIEWS). المقطع الثاني المتغير (‎${…}‎ أو فارغ يُلصق به معرّف) يصح للشاشات ذات المسار الفرعي وحدها؛
// وعلى غيرها لا يُعرف عند الفحص إلى أين يقود، فيُعدّ غير محلول حتى يُكتب نيةً مسجلة.
export function resolveLink(literal,screens){
  const [path='']=String(literal??'').replace(/^#/,'').split('?');
  const slash=path.indexOf('/'),view=slash<0?path:path.slice(0,slash),rest=slash<0?null:path.slice(slash+1);
  const known=screens instanceof Set?screens.has(view):screens.includes(view);
  if(!known)return {ok:false,view,intent:rest,reason:`الشاشة «${view}» غير مسجلة`};
  if(rest===null)return {ok:true,view,intent:null};
  if(SUBROUTED_VIEWS.includes(view))return {ok:true,view,intent:rest};
  const intent=rest.split('/')[0];
  if(!/^[\w-]+$/.test(intent))return {ok:false,view,intent:rest,reason:`مقطع متغير بعد «#${view}/» وهي شاشة لا تقرأ مسارًا فرعيًا`};
  if(Object.hasOwn(DEEP_LINKS,view)&&Object.hasOwn(DEEP_LINKS[view],intent))return {ok:true,view,intent};
  return {ok:false,view,intent,reason:`النية «${intent}» غير مسجلة في DEEP_LINKS.${view}`};
}
export const unavailableText=(view,lang='ar')=>(UNAVAILABLE[view]??UNAVAILABLE.default)[lang==='ar'?0:1];
// كلمات بحث تقود إلى شاشة لا خدمة في الدليل (B11): «إجازة» لا تطابق خدمة لأن الإجازة وحدة مستقلة.
export const MODULE_SHORTCUTS=[
  {words:['اجازه','اجازات','leave','vacation'],title:'طلب إجازة',title_en:'Request leave',link:'#leave/new',module:'leave'},
  {words:['خطاب','تعريف','letter','certificate'],title:'طلب خطاب',title_en:'Request a letter',link:'#letters/new',module:'letters'},
  {words:['راتب','قسيمه','payslip','salary'],title:'قسيمة الراتب',title_en:'My payslip',link:'#payroll/latest',module:'payroll'},
  {words:['حضور','بصمه','تصحيح','attendance'],title:'تصحيح حضور',title_en:'Attendance correction',link:'#attendance/correction',module:'attendance'},
  {words:['مصروف','مطالبه','عهده','expense','custody'],title:'مطالبة مصروف',title_en:'Expense claim',link:'#expenses/new',module:'expenses'},
  {words:['ملفي','هويه','اقامه','ايبان','profile','iban'],title:'ملفي',title_en:'My profile',link:'#profile',module:'profile'}
];
