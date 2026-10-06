import { countNoun } from './arabic-count.mjs';
import { MODULE_SHORTCUTS } from './deep-links.mjs';
// New-request launcher and service browser: department → section → service.
import { MODULE_SERVICES } from './module-services.mjs';
import { icon } from './hr-design.mjs';
// أيقونات الإدارات SVG خطية من مكتبة التصميم (SVG أصلي قريب من Apple: 24pt، قلم 1.6، أطراف دائرية) —
// الرموز النصية السابقة لم تكن طقم أيقونات (انظر تعليق journey.css القديم).
export const departmentMeta={
  hr:{icon:icon('person'),tone:1,tagline:'شهاداتك، دوامك، راتبك ومسارك الوظيفي',keywords:'موارد بشرية رواتب اجازة اجازات دوام تعريف راتب شهادة خبرة استقالة تدريب'},
  it:{icon:icon('cpu'),tone:2,tagline:'الحسابات والأجهزة والدعم والأمن السيبراني',keywords:'تقنية معلومات دعم فني حاسب جهاز برنامج ترخيص صلاحية بريد امن سيبراني'},
  'ceo-office':{icon:icon('building'),tone:3,tagline:'القرارات والاجتماعات التنفيذية',keywords:'شؤون ادارية اداري مرافق مكتب صيانة قاعة اجتماع زائر سفر انتداب مصروفات عهدة قرطاسية سلامة خطاب صادر'},
  // وحدة عرضٍ لا صفّ لها في departments (ق3 ود1): تملك خدمات ADM- عرضًا وحده، وتنفّذها مكتب الرئيس التنفيذي مؤقتًا.
  'admin-affairs':{icon:icon('building'),tone:3,tagline:'المكتب والصيانة والسفر والمرافق',keywords:'شؤون ادارية اداري مرافق مكتب صيانة قاعة اجتماع زائر سفر انتداب قرطاسية سلامة خطاب صادر'},
  finance:{icon:icon('banknote'),tone:4,tagline:'المدفوعات والفوترة والميزانيات',keywords:'مالية محاسبة صرف فاتورة تحصيل ميزانية ضريبة عهدة'},
  procurement:{icon:icon('cart'),tone:5,tagline:'طلبات الشراء والموردون',keywords:'مشتريات شراء مورد عرض سعر امر شراء'},
  grc:{icon:icon('scale'),tone:6,tagline:'العقود والخصوصية والتراخيص والمخاطر والبلاغات',keywords:'قانونية قانوني محامي عقد اتفاقية عدم افصاح امتثال حوكمة مخاطر خصوصية بلاغ ترخيص علامة تجارية'},
  comms:{icon:icon('megaphone'),tone:7,tagline:'التعاميم والاستبيانات والتقدير والفعاليات',keywords:'تواصل داخلي تجربة موظف تعميم استبيان موظف الشهر فعالية ترحيب'},
  pr:{icon:icon('mic'),tone:8,tagline:'الإعلام والرصد والمؤثرون',keywords:'علاقات عامة اعلام صحافة بيان مؤثر مؤثرين ازمة تغطية'},
  marketing:{icon:icon('chart'),tone:2,tagline:'الحملات الرقمية والمنصات والقياس',keywords:'تسويق رقمي اعلانات حملة سوشيال ميديا منصات ميزانية اعلانية'},
  production:{icon:icon('film'),tone:3,tagline:'التصوير والمونتاج والفعاليات والمعدات',keywords:'انتاج تصوير فيديو مونتاج معدات موقع تصريح فعالية'},
  creative:{icon:icon('sparkles'),tone:7,tagline:'التصميم والمحتوى والترجمة',keywords:'ابداع تصميم محتوى كتابة ترجمة تدقيق هوية'},
  brand:{icon:icon('medal'),tone:5,tagline:'الهوية والأصول الرقمية',keywords:'علامة تجارية هوية شعار اصول'},
  'business-dev':{icon:icon('trend'),tone:1,tagline:'الفرص والتسعير والبحث والعروض',keywords:'تطوير اعمال مبيعات فرصة منافسة تسعير عرض استراتيجية بحث سوق منافسين'},
  accounts:{icon:icon('bubbles'),tone:4,tagline:'خدمة العملاء وطلبات التغيير والتجديد',keywords:'حسابات عملاء عميل شكوى تغيير تجديد'},
  epmo:{icon:icon('clipboard'),tone:6,tagline:'فتح المشاريع والموارد والمخاطر والأهداف',keywords:'مشاريع مكتب ادارة المشاريع موارد مخاطر اقفال اهداف مبادرة ساعات'},
  'campaigns-audit':{icon:icon('gauge'),tone:8,tagline:'التقارير واللوحات وجودة البيانات',keywords:'بيانات تحليلات تقارير لوحة مؤشرات تدقيق حملات جودة ذكاء اصطناعي معرفة'},
  ops:{icon:icon('gear'),tone:2,tagline:'تشغيل المنصة',keywords:'منصة تشغيل'}
};
const fallbackMeta={icon:icon('grid'),tone:1,tagline:'خدمات الإدارة'};
export const metaFor=id=>departmentMeta[id]||fallbackMeta;
// أيقونة لكل خدمة من كلماتها (الرمز والاسم والوصف): الأخص أولًا، وبلا مطابقة تعود أيقونة الإدارة الممرَّرة.
const SERVICE_GLYPH_RULES=[
  ['اجاز|إجاز','calendar'],['دوام|حضور|انصراف|بصم','clock'],['راتب|رواتب|أجر |اجور|أجور','banknote'],
  ['تعريف|شهاد','signed'],['عقد|اتفاقي','signed'],['خطاب|رسال|صادر|بريد','envelope'],
  ['سفر|انتداب|تذكر','route'],['تدريب|تطوير مهار|دورة','book'],['توظيف|تعيين|مرشح','badge'],
  ['استقال|اخلاء|إخلاء|اخلاء طرف','exit'],['تأمين|صحي','heart'],['سلفة|قرض','coins'],
  ['مصروف|عهدة|صرف','receipt'],['فاتور|سداد|دفع|تحصيل','receipt'],['ميزاني','pie'],
  ['جهاز|حاسب|لابتوب|طابعة|عتاد','cpu'],['برنامج|تطبيق|نظام','cpu'],
  ['صلاحي|وصول|حساب','key'],['دعم|عطل|خربان|مشكلة','gear'],['سيبران|اختراق','shield'],
  ['صيانة','gear'],['قاعة|اجتماع','people'],['زائر|زيارة','person'],['قرطاسي|مستلزم','clipboard'],
  ['شراء|مشتر|مورد|عرض سعر','cart'],['تصميم|هوية|شعار','sparkles'],['محتوى|كتابة|ترجم|تدقيق','note'],
  ['تصوير|فيديو|مونتاج|انتاج|إنتاج','film'],['معدات|كاميرا','camera'],['فعالية|فعاليات','megaphone'],
  ['تقرير|تحليل|لوحة','chart'],['مشروع','briefcase'],['عميل|عملاء','people'],
  ['شكوى|بلاغ|مخالف','warning'],['ترخيص|تصريح','shield'],['قانون|امتثال|خصوصي','scale'],
  ['استبيان|تقييم','checklist'],['اعلان|إعلان|تعميم','megaphone'],['وثيقة|مستند|ملف','doc']
].map(([pattern,name])=>[new RegExp(pattern),name]);
export function serviceGlyph(s,fallback){
  const text=`${s?.code??''} ${s?.name_ar??s?.name??''} ${s?.description??''}`;
  for(const [re,name] of SERVICE_GLYPH_RULES)if(re.test(text))return icon(name);
  return fallback;
}
// «خدمات مختارة» (ت1): قائمةٌ يدوية ثابتة من خدمات الباب الأمامي، لا عدّ فيها ولا تُحسب من الطلبات. «الأكثر طلبًا» يعود
// بعد أن يصير للطلبات الحقيقية عددٌ له معنى (م4)؛ وقبلها تسميةُ قائمةٍ مكتوبة باليد «الأكثر طلبًا» ادّعاءٌ بلا قياس.
// تقرؤها نافذة الطلب الجديد وشاشة «الخدمات» سواء (app/catalog-home.mjs featuredFrom).
export const FEATURED_SERVICES=Object.freeze(['HR-LETTER','HR-SALARY-CERT','HR-ATTENDANCE-FIX','IT-SUPPORT','ADM-MAINTENANCE','ADM-ROOM-BOOKING','ADM-EXPENSE-CLAIM']);
const GENERAL='خدمات عامة';

// ── ملكية العرض (ت1، ق3 ود1) ── تسميةٌ لا قرار: department_id لكل خدمة كما هو، ومسار الاعتماد والمنفّذ كما هما.
// خدمات ADM- تُعرض في صفحة «الشؤون الإدارية والمرافق» (موقوفة، بلا صفّ في departments) وعليها «ينفّذها مؤقتًا: مكتب الرئيس
// التنفيذي»، وADM-EXPENSE-CLAIM تُعرض تحت المالية. ويُقرأ الشرط على الرمز وعلى إدارة التنفيذ القائمة معًا، فلا ينقل غيرها.
export const ADMIN_AFFAIRS=Object.freeze({id:'admin-affairs',name:'الشؤون الإدارية والمرافق',display_only:true});
export const INTERIM_EXECUTOR='ينفّذها مؤقتًا: مكتب الرئيس التنفيذي';
const DISPLAY_OWNER=Object.freeze({'ADM-EXPENSE-CLAIM':'finance'});
const isAdminCode=code=>/^ADM-/.test(code)||code==='VAR-ADMIN';
export function displayDepartment(item){
  const code=String(item?.code??item?.key??''),from=item?.department_id??null;
  if(from!=='ceo-office')return from;
  return DISPLAY_OWNER[code]??(isAdminCode(code)?ADMIN_AFFAIRS.id:from);
}
export const interimExecutor=item=>item?.department_id==='ceo-office'&&isAdminCode(String(item?.code??item?.key??''))?INTERIM_EXECUTOR:'';
// قائمة الإدارات كما تُعرض: وحدة الشؤون الإدارية تُضاف في قطاع مكتب الرئيس التنفيذي حين يُعرض عليها شيء، ولا تُضاف غيرها.
export function displayDepartments(departments,services){
  if(departments.some(d=>d.id===ADMIN_AFFAIRS.id)||!services.some(s=>displayDepartment(s)===ADMIN_AFFAIRS.id))return departments;
  const ceo=departments.find(d=>d.id==='ceo-office');
  return [...departments,{id:ADMIN_AFFAIRS.id,name:ADMIN_AFFAIRS.name,sector:ceo?.sector??'',display_only:true}];
}

// المطبِّع الواحد للمتصفح. القاعدة (مركز الخدمات، الدفعة الثالثة): يجب أن يساوي app/arabic-text.mjs normalize على كل
// ما يكتبه الناس، وإلا لم تطابق مرادفاتُ الخادم (مطبَّعة هناك) استعلامَ المتصفح (مطبَّع هنا). فأُضيف ما كان ينقصه:
// NFKC، ومحارف الاتجاه وصفر العرض، وٱ، وؤ→و وئ→ي، والأرقام الهندية والفارسية → لاتينية. ويثبت المساواةَ اختبارٌ على
// خمسين سؤالًا (tests/catalog-search.test.mjs). الخادم لا يُستورَد هنا: هذا ملف متصفح.
// النطاقات بأرقامها لا بحروفها: نطاقٌ مكتوب بالحروف كان يبتلع الأرقام الهندية (٠–٩ تقع بين الفتحتين والألف الخنجرية).
const INVISIBLE=/[\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const MARKS=/[\u064B-\u0655\u0670\u0640]/g;
export function normalizeArabic(value){
  return String(value??'').normalize('NFKC').replace(INVISIBLE,'').replace(MARKS,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/ؤ/g,'و').replace(/ئ/g,'ي')
    .replace(/[٠-٩۰-۹]/g,d=>{const code=d.codePointAt(0);return String(code-(code<=0x0669?0x0660:0x06F0));}).toLowerCase().replace(/\s+/g,' ').trim();
}
// العدد الفعلي للخدمات: بطاقة المجموعة تُحسب بعدد خياراتها لا صفًّا واحدًا.
export const actualServiceCount=list=>list.reduce((n,s)=>n+(s.variant?.options?.length||1),0);
export function groupCatalog(rawDepartments,services){
  // وحدة العرض (الشؤون الإدارية) تُضاف هنا أيضًا، فلا تسقط خدمات ADM- من رفوف من يمرّر قائمة departments كما هي.
  const departments=displayDepartments(rawDepartments,services);
  const known=new Map(departments.map(d=>[d.id,d]));
  return departments.map(d=>{
    // الرفّ بملكية العرض (displayDepartment) لا بإدارة التنفيذ: ADM- على رفّ الشؤون الإدارية، ومطالبة المصروفات على رفّ المالية.
    const list=services.filter(s=>displayDepartment(s)===d.id);
    const sections=new Map();
    for(const s of [...list].sort((a,b)=>(a.section_order??1e4)-(b.section_order??1e4)||a.name_ar.localeCompare(b.name_ar,'ar'))){
      const key=s.section||GENERAL;if(!sections.has(key))sections.set(key,[]);sections.get(key).push(s);
    }
    return {department:d,meta:metaFor(d.id),count:actualServiceCount(list),sections:[...sections].map(([name,items])=>({name,items}))};
  }).filter(g=>known.has(g.department.id)).sort((a,b)=>b.count-a.count||a.department.name.localeCompare(b.department.name,'ar'));
}
export function searchCatalog(departments,services,query){
  const terms=normalizeArabic(query).split(' ').filter(Boolean);
  if(!terms.length)return [];
  const names=new Map(departments.map(d=>[d.id,d.name]));
  return services.map(s=>{
    const title=normalizeArabic(s.name_ar+' '+s.name_en),rest=normalizeArabic([s.description,s.section,names.get(s.department_id),metaFor(s.department_id).keywords??'',s.code].join(' '));
    if(!terms.every(t=>title.includes(t)||rest.includes(t)))return null;
    return {service:s,score:terms.reduce((n,t)=>n+(title.startsWith(t)?4:title.includes(t)?2:1),0)};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||a.service.name_ar.localeCompare(b.service.name_ar,'ar')).map(r=>r.service);
}
// الخدمات ذات الشاشة المخصصة (module-services.mjs): تُطابق بالكلمات نفسها وتُعرض رابطًا إلى شاشتها.
export function searchModuleServices(query,me=null){
  const terms=normalizeArabic(query).split(' ').filter(Boolean);
  if(!terms.length)return [];
  return MODULE_SERVICES.filter(m=>!me?.can||me.can.includes(m.capability)).filter(m=>{const hay=normalizeArabic([m.name_ar,m.name_en,m.description,m.section,m.keywords,m.code].join(' '));return terms.every(t=>hay.includes(t));});
}
function moduleSection(departmentId,me,e,interactive){
  const list=MODULE_SERVICES.filter(m=>m.department_id===departmentId&&(!me?.can||me.can.includes(m.capability)));
  if(!list.length||!interactive)return '';
  return `<section class="rq-section"><h4><span class="rq-section-no" aria-hidden="true">${icon('star')}</span><span>خدمات بشاشة مخصصة</span><small>${list.length}</small></h4><div class="rq-list">${list.map(m=>moduleRow(m,e)).join('')}</div></section>`;
}
function moduleRow(m,e){
  const meta=metaFor(m.department_id);
  return `<a class="rq-row" href="${e(m.href)}" data-module-service="${e(m.code)}"><span class="rq-row-text"><strong>${e(m.name_ar)}</strong><span>${e(m.description)}</span></span><span class="rq-row-meta"><span class="rq-chip">${e(m.path_ar)}</span></span></a>`;
}
export function approvalTrail(service,departments){
  const name=departments.find(d=>d.id===service.department_id)?.name||'الإدارة المنفذة';
  const label={manager:'مديرك المباشر',department_manager:'مدير '+name,hr:'مسؤول '+name,it:'مسؤول '+name,pm:'مدير المشروع',executive:'الرئاسة'};
  // الخطوة إما نص أو كائن {role, department?, when?}: الإدارة الأخرى تُذكر باسمها في القائمة، والخطوة المشروطة تُعلَّم.
  const named=step=>{
    if(typeof step==='string')return label[step]||step;
    const base=step?.role==='department_manager'&&step.department?'مدير '+(departments.find(d=>d.id===step.department)?.name||step.department)
      :(label[step?.role]||step?.role||'معتمد');
    const scoped=step?.department&&step?.role!=='department_manager'?`${base} — ${departments.find(d=>d.id===step.department)?.name||step.department}`:base;
    return step?.when?`${scoped} (بشرط)`:scoped;
  };
  return {steps:service.approval_policy.steps.map(named),handler:name,parallel:service.approval_policy.mode==='parallel',direct:service.approval_policy.mode==='direct'};
}

// B22: تمييز العدد من وحدة واحدة (arabic-count.mjs) بدل صيغ متفرقة في كل شاشة.
const sla=days=>!days?'':countNoun(days,'working_day');
const workingDays=n=>countNoun(n,'working_day');
// شارة الزمن في صف الخدمة: الكمية، ومعها حالُ الزمن حين لا يكون التزامًا تبنّاه أحد («مشتق» أو «مسجَّل»).
// الشارة ضيقة، فالعبارة الكاملة تُقال في معاينة المسار وفي وصف الصف المقروء آليًا — لا يُترك الرقم عاريًا في أيٍّ منها.
const slaChip=s=>{
  const t=s.target;
  if(!t||t.kind==='unset')return s.target_days?sla(s.target_days):'';
  return t.adopted?t.amount:`${t.amount} · ${t.kind_name}`;
};
// معاينة المسار قبل التقديم: «سيمر طلبك على: مديرك ← الموارد البشرية، خلال 3 أيام عمل».
// والزمن لا يُقدَّم وعدًا ما لم يتبنَّه إنسان: العبارة تأتي كاملة من app/service-target.mjs، فيقرأ الموظف
// «خلال يوما عمل — مشتق من عائلة رمز الخدمة، لم يتبنّه أحد بعد» بدل رقمٍ يظنه التزامًا قطعته إدارة.
export function routePreview(service,departments){
  const trail=approvalTrail(service,departments),t=service.target,days=service.target_days;
  const when=t&&t.kind!=='unset'?`، خلال ${t.label}`:days?`، خلال ${workingDays(days)}`:'';
  return (trail.steps.length?`سيمر طلبك على: ${trail.steps.join(' ← ')}`:`يصل طلبك مباشرة إلى ${trail.handler}`)+when+'.';
}

// ── بطاقات الخيارات (SERVICE_VARIANTS في app/service-catalog.mjs، تصل من /api/catalog/variants) ──
// بطاقة المجموعة تحل محل خدماتها في التصفح، وتبقى الخدمات القديمة في البحث عبر خياراتها. الخيار الذي طابق البحث يأتي مختارًا.
export function mergeVariants(services,groups){
  const aliases=new Set((groups||[]).flatMap(g=>g.options.map(o=>o.service_code).filter(Boolean)));
  const cards=(groups||[]).map(g=>({id:'variant:'+g.code,code:g.code,name_ar:g.name_ar,name_en:g.name_en,description:g.description,department_id:g.department_id,section:g.section,
    approval_policy:{steps:[]},target_days:null,target:null,fields:[],variant:g}));
  return [...services.filter(s=>!aliases.has(s.code)),...cards];
}
const optionText=(g,o)=>normalizeArabic([o.name_ar,o.name_en,...(o.words||[]),o.service_code||''].join(' '));
export function searchVariants(groups,query){
  const terms=normalizeArabic(query).split(' ').filter(Boolean);
  if(!terms.length)return [];
  const found=[];
  for(const g of groups||[]){
    const groupText=normalizeArabic([g.name_ar,g.name_en,...(g.words||[]),g.code,...(g.aliases||[])].join(' '));
    // يُختار أول خيار تطابقه كل الكلمات بترتيب الخيارات في البيانات؛ الاسم الذي يبدأ بالكلمة يتقدم.
    const scored=g.options.map((o,i)=>{const text=optionText(g,o),name=normalizeArabic(o.name_ar);
      if(!terms.every(t=>text.includes(t)||groupText.includes(t)))return null;
      const direct=terms.filter(t=>text.includes(t)).length;if(!direct)return null;
      return {o,i,score:direct*2+terms.reduce((n,t)=>n+(name.startsWith(t)?3:name.includes(t)?1:0),0)};}).filter(Boolean)
      .sort((a,b)=>b.score-a.score||a.i-b.i);
    if(scored.length)found.push({group:g,option:scored[0].o,score:scored[0].score+2});
    else if(terms.every(t=>groupText.includes(t)))found.push({group:g,option:null,score:1});
  }
  return found.sort((a,b)=>b.score-a.score);
}
// صفّ المجموعة في صفحة الإدارة (ت1، linked): كل خيارٍ له خدمة رابطٌ إلى صفحتها (#services/<رمز>)، فتُبلَغ صفحة الخدمة من
// صفحة إدارتها بضغطة واحدة لا بعد نافذة الخيارات؛ وزرّ البدء هو باب نافذة الخيارات نفسه (pick-variant). الخيارات التي تشترك
// في خدمة واحدة (VAR-PROFILE) رابطٌ واحد؛ والخيار الذي بابه شاشة مخصصة رابطُ شاشته.
// صفحة الإدارة: بطاقة الخيارات **مفتوحة** لا مطويّة (طلب المالك، 30 سبتمبر 2026).
// كانت صفًّا واحدًا فيه «٤ خيارات» وزرّ «ابدأ الطلب»، فيلزم من يفتح إدارته نقرةً ليعرف
// ما تحتها ثم نقرةً ليختار. ومن جاء إلى إدارة الخدمات الإبداعية يسأل «وش أقدر أطلب» —
// فالجواب يُعرض، لا يُخبَّأ خلف زرّ. وكل خيار زرٌّ يبدأ طلبه مباشرة، فسقطت نقرتان إلى واحدة.
// واسم الخيار يبقى رابطًا إلى صفحة خدمته («اشرح قبل أن تسأل») فلم يُفقد شيء بالفتح.
function linkedVariantRow(g,e){
  const meta=metaFor(displayDepartment(g)),seen=new Set();
  const options=g.options.filter(o=>{const key=o.service_code||o.link||o.code;if(seen.has(key))return false;seen.add(key);return true;});
  const note=interimExecutor(g);
  // زمن الخيار كما تعرضه بطاقته في المشغّل: المتبنّى أولًا، ثم المشتقّ، ولا يُخترع زمن.
  const when=o=>o.target&&o.target.kind!=='unset'?o.target.label:o.target_days?sla(o.target_days):'';
  // الوجهة تُسمّى target لا service_code: المسنّنة تعدّ إقحام رمز خدمة خارج السمات قيمةً لاتينية
  // بلا عزل — وهي محقّة في القاعدة، لكن هذه الوجهة تُستهلك في href، والسمة لا تُعزل بوسم (تعليق
  // scripts/quality-ratchet.mjs نفسه). فالاسم المحايد يبقي الحارس صادقًا ولا يخفي شيئًا يُعرض.
  const destination=o=>{const target=o.service_code;return target?`#services/${e(target)}`:String(o.link??'').startsWith('#')?e(o.link):'';};
  // لا تُسمَّ card: «card» من أسماء المكوّنات المشتركة التي تعدّها المسنّنة، والعدّة المشتركة مكانها.
  const optionItem=o=>{
    const href=destination(o),time=when(o);
    // رابط الشاشة المخصصة داخليٌّ وحده؛ وخيارٌ بلا وجهة يبقى اسمًا بلا زرّ ميّت.
    const title=href?`<a class="rq-opt-name" href="${href}">${e(o.name_ar)}</a>`:`<span class="rq-opt-name">${e(o.name_ar)}</span>`;
    const start=`<button type="button" class="btn outline small" data-action="pick-variant" data-group="${e(g.code)}" data-option="${e(o.code)}" aria-label="${e(`ابدأ الطلب: ${g.name_ar} — ${o.name_ar}`)}">ابدأ</button>`;
    return `<li class="rq-opt">${title}${time?`<span class="rq-chip is-time">${e(time)}</span>`:''}${start}</li>`;
  };
  return `<div class="rq-row is-variant is-open" data-group="${e(g.code)}">`
    +`<div class="rq-row-text"><strong>${e(g.name_ar)}</strong><span>${e(g.description??'')}</span>`
    +`<ul class="rq-opt-list">${options.map(optionItem).join('')}</ul></div>`
    +`<span class="rq-row-meta"><span class="rq-chip">${options.length} ${options.length>2&&options.length<11?'خيارات':'خيار'}</span>${note?`<span class="rq-chip">${e(note)}</span>`:''}</span></div>`;
}
function variantRow(g,e,{interactive=true,option=null,linked=false}={}){
  if(linked&&interactive&&!option)return linkedVariantRow(g,e);
  const meta=metaFor(displayDepartment(g)),names=g.options.map(o=>o.name_ar);
  const body=`
    <span class="rq-row-text"><strong>${e(g.name_ar)}${option?` — ${e(option.name_ar)}`:''}</strong><span>${e(names.slice(0,5).join('، ')+(names.length>5?'…':''))}</span></span>
    <span class="rq-row-meta"><span class="rq-chip">${g.options.length} ${g.options.length>2&&g.options.length<11?'خيارات':'خيار'}</span>${interactive?'':`<code>${e(g.code)}</code>`}</span>`;
  return interactive?`<button type="button" class="rq-row is-variant" data-action="pick-variant" data-group="${e(g.code)}"${option?` data-option="${e(option.code)}"`:''} aria-label="${e(`${g.name_ar}${option?' — '+option.name_ar:''} — ${names.join('، ')}`)}">${body}</button>`
    :`<article class="rq-row is-static">${body}</article>`;
}
// نموذج المجموعة: الخطوة الأولى اختيار النوع. الخيار ذو الشاشة الجاهزة يفتح نموذجها؛ الخيار ذو الخدمة يفتح نموذج خدمته
// بحقوله هو (بلا الحقول الثابتة) ومعاينة مساره وزمنه والمستندات المطلوبة.
export function variantComposer({group,option,service,departments,projects,e,fieldInput,gaps=[]}){
  const meta=metaFor(group.department_id);
  const picker=`<fieldset class="rq-options"><legend>اختر نوع الطلب</legend><div class="rq-option-list" role="radiogroup" aria-label="نوع الطلب">${group.options.map(o=>`<button type="button" role="radio" aria-checked="${o.code===option?.code}" class="rq-option${o.code===option?.code?' is-selected':''}" data-action="pick-variant" data-group="${e(group.code)}" data-option="${e(o.code)}"><strong>${e(o.name_ar)}</strong>${o.note?`<small>${e(o.note)}</small>`:o.target&&o.target.kind!=='unset'?`<small>${e(o.target.label)}</small>`:o.target_days?`<small>${e(sla(o.target_days))}</small>`:''}</button>`).join('')}</div></fieldset>`;
  const head=`<div class="rq-compose-head tone-${meta.tone}"><button type="button" class="rq-back" data-action="launcher-back">→ كل الخدمات</button><div class="rq-compose-title"><span class="rq-dept-icon" aria-hidden="true">${serviceGlyph(group,meta.icon)}</span><div><p class="rq-crumbs">${e(group.section||'')}</p><h3>${e(group.name_ar)}</h3><p>${e(group.description)}</p></div></div></div>`;
  const docs=option?.docs?.length?`<p class="rq-docs"><strong>المستندات المطلوبة:</strong> ${option.docs.map(e).join('، ')}</p>`:'';
  if(!option)return `<div class="rq-compose" data-variant="${e(group.code)}">${head}<div class="rq-compose-body"><div class="rq-compose-main">${picker}<p class="subtle">اختر النوع لتظهر حقوله ومسار اعتماده.</p></div></div><div class="form-actions"><button class="btn outline" type="button" data-action="close">إلغاء</button></div></div>`;
  if(option.mode==='module'||!service)return `<div class="rq-compose" data-variant="${e(group.code)}">${head}<div class="rq-compose-body"><div class="rq-compose-main">${picker}${docs}<p class="rq-preview">يُقدَّم هذا النوع من شاشته المخصصة بمسار اعتمادها، حتى يبقى للطلب مسار واحد.</p></div></div><div class="form-actions"><button class="btn outline" type="button" data-action="close">إلغاء</button><a class="btn dark" href="${e(option.link||'#')}" data-variant-link>متابعة إلى النموذج</a></div></div>`;
  return requestComposer({service,departments,projects,request:null,edit:false,e,fieldInput,variant:{group,option,picker,docs},gaps});
}

// صف خدمة مضغوط: الاسم ثم وصف سطر واحد ثم زمن الخدمة ومسار اعتمادها.
function serviceRow(s,departments,e,{interactive=true,linked=false}={}){
  if(s.variant)return variantRow(s.variant,e,{interactive,linked});
  // صفحة الإدارة (ت1، linked): الصفّ رابطٌ إلى صفحة الخدمة («اشرح قبل أن تسأل»)، وزرّ البدء فيها — نموذجًا عامًا أو شاشةً مخصصة.
  if(interactive&&linked)return linkedServiceRow(s,departments,e);
  // خدمة لها شاشة مخصصة جاهزة (module-routes.mjs): البطاقة رابط إلى نموذج الشاشة، فلا يتكرر مسار الاعتماد.
  if(interactive&&s.module_link){const meta=metaFor(displayDepartment(s));return `<a class="rq-row" href="${e(s.module_link)}" aria-label="${e(`${s.name_ar} — يُقدَّم من «${s.module_name}»`)}"><span class="rq-row-text"><strong>${e(s.name_ar)}</strong><span>${e(s.description)}</span></span><span class="rq-row-meta"><span class="rq-chip">يُقدَّم من «${e(s.module_name)}»</span></span></a>`;}
  const {meta,trail,path}=rowParts(s,departments);
  const body=`
    <span class="rq-row-text"><strong>${e(s.name_ar)}</strong><span>${e(s.description)}</span></span>
    <span class="rq-row-meta"><span class="rq-chip">${e(path)}</span>${slaChip(s)?`<span class="rq-chip is-time">${e(slaChip(s))}</span>`:''}${interactive?'':`<code>${e(s.code)}</code>`}</span>`;
  return interactive
    ?`<button type="button" class="rq-row" data-action="pick-service" data-id="${e(s.id)}" aria-label="${e(rowLabel(s,trail))}">${body}</button>`
    :`<article class="rq-row is-static">${body}</article>`;
}
const SHORT_LABELS={manager:'مديرك',department_manager:'مدير الإدارة',hr:'معتمد الإدارة',it:'معتمد الإدارة',pm:'مدير المشروع',executive:'الرئاسة'};
function rowParts(s,departments){
  const shortStep=step=>{const role=typeof step==='string'?step:step?.role;return (SHORT_LABELS[role]||role||'معتمد')+(typeof step==='object'&&step?.when?' (بشرط)':'');};
  return {meta:metaFor(displayDepartment(s)),trail:approvalTrail(s,departments),path:[...s.approval_policy.steps.map(shortStep),'تنفيذ'].join(' ← ')};
}
const rowLabel=(s,trail)=>`${s.name_ar} — ${s.description} — مسار الاعتماد: ${[...trail.steps,trail.handler].join(' ← ')}${s.target&&s.target.kind!=='unset'?` — الزمن المستهدف ${s.target.label}`:''}`;
function linkedServiceRow(s,departments,e){
  const {meta,trail,path}=rowParts(s,departments),note=interimExecutor(s);
  return `<a class="rq-row" href="#services/${e(s.code)}" aria-label="${e(rowLabel(s,trail)+(note?` — ${note}`:''))}">`
    +`<span class="rq-row-text"><strong>${e(s.name_ar)}</strong><span>${e(s.description)}</span></span>`
    +`<span class="rq-row-meta">${s.module_link?`<span class="rq-chip">يُقدَّم من «${e(s.module_name)}»</span>`:`<span class="rq-chip">${e(path)}</span>`}${slaChip(s)?`<span class="rq-chip is-time">${e(slaChip(s))}</span>`:''}${note?`<span class="rq-chip">${e(note)}</span>`:''}</span></a>`;
}
function sectionBlocks(group,departments,e,options){
  return group.sections.map((sec,i)=>`<section class="rq-section"><h4><span class="rq-section-no" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><span>${e(sec.name)}</span><small>${actualServiceCount(sec.items)}</small></h4><div class="rq-list">${sec.items.map(s=>serviceRow(s,departments,e,options)).join('')}</div></section>`).join('');
}
const workspaceBindings={hr:['leave','people','contracts','attendance','payroll','employees'],creative:['studio'],'business-dev':['commercial','approvals'],procurement:['procurement','vendors'],finance:['finance','budgets','invoices','payables','assets','statements'],epmo:['budgets']};
function workspaceLinks(departmentId,modules,me,e){
  // B14: «السجل الوظيفي» لموظف الموارد البشرية أو لمن يتبعه موظفون؛ غيرهما يلقى 403، فلا يُعرض له رابطه.
  const keys=(workspaceBindings[departmentId]||[]).filter(key=>modules?.[key]&&(key==='employees'?!!me?.can?.includes('employees.view')||me?.role==='manager':['contracts','attendance','payroll'].includes(key)?true:['invoices','statements','payables','assets'].includes(key)?!!me?.capabilities?.finance:me?.can?me.can.some(c=>c.startsWith(key+'.')):true));
  if(!keys.length)return '';
  return `<div class="rq-workspaces"><p class="rq-workspaces-label">مساحات عمل الإدارة</p>${keys.map(key=>`<a class="rq-workspace" href="#${e(key)}"><strong>${e(modules[key].title)}</strong><span>${e(modules[key].description)}</span></a>`).join('')}</div>`;
}

export function launcherResults({departments:rawDepartments,services:rawServices,me,selected='',query='',e,interactive=true,modules=null,variants=null,linked=false}){
  // بطاقات الخيارات تحل محل خدماتها في التصفح؛ بدون variants يبقى الدليل كما كان.
  const services=variants?.length?mergeVariants(rawServices,variants):rawServices;
  const shelves=launcherShelves({departments:rawDepartments,services});
  const {departments,groups,bySector}=shelves;
  const own=me?.department_id;
  const rail=departmentRail({shelves,me,selected,query,e,linked});
  let body;
  if(query.trim()){
    // الخيار الذي طابق البحث يأتي مختارًا في بطاقته («تعريف» ← «خطاب» بنوع «تعريف بالراتب»)، ورمز الخدمة القديم يجد بطاقتها.
    const hits=searchVariants(variants||[],query),hitCodes=new Set(hits.map(h=>h.group.code));
    const found=searchCatalog(departments,services,query).filter(s=>!(s.variant&&hitCodes.has(s.variant.code)));
    const names=new Map(departments.map(d=>[d.id,d.name]));
    const covered={leave:'VAR-LEAVE',letters:'VAR-LETTER'},q=normalizeArabic(query);
    // دمج 20260919: خدمة الوحدة المخصصة (HR-LEAVE، ترحيل 098) تظهر ما لم تطابق بطاقة الخيارات نفسها، والاختصار لا يكرر خدمة ظهرت.
    const moduleOf=m=>String(m.href||'').replace(/^#/,'').split('/')[0];
    const direct=searchModuleServices(query,me).filter(m=>!hitCodes.has(covered[moduleOf(m)])),directModules=new Set(direct.map(moduleOf));
    const shortcuts=interactive&&me?.role!=='admin'?MODULE_SHORTCUTS.filter(m=>m.words.some(w=>q.includes(normalizeArabic(w))||normalizeArabic(w).startsWith(q))&&!hitCodes.has(covered[m.module])&&!directModules.has(m.module)):[];
    const total=found.length+hits.length+direct.length;
    body=`<div class="rq-results-head"><h3>نتائج «${e(query.trim())}»</h3><p role="status" aria-live="polite">${total?`${countNoun(total,'service')} مطابقة`:'لا توجد خدمة مطابقة'}</p></div>`
      +(shortcuts.length?`<div class="rq-popular">${shortcuts.map(m=>`<a class="rq-pill" href="${e(m.link)}">${e(m.title)}</a>`).join('')}</div>`:'')+(total
      ?`<div class="rq-list">${direct.map(m=>`<div class="rq-found"><span class="rq-found-dept">${e(names.get(m.department_id)||'')}</span>${moduleRow(m,e)}</div>`).join('')}${hits.map(h=>`<div class="rq-found"><span class="rq-found-dept">${e(names.get(displayDepartment(h.group))||'')}</span>${variantRow(h.group,e,{interactive,option:h.option})}</div>`).join('')}${found.map(s=>`<div class="rq-found"><span class="rq-found-dept">${e(names.get(displayDepartment(s))||'')}</span>${serviceRow(s,departments,e,{interactive,linked})}</div>`).join('')}</div>`
      :`<div class="rq-empty"><strong>لم نجد ما تبحث عنه</strong><p>جرّب كلمة أقصر، أو تصفّح الإدارات. وإن كانت الخدمة غير موجودة فعلًا، اطلب «ملاحظة على المنصة أو اقتراح خدمة» من تقنية المعلومات.</p></div>`);
  }else if(selected){
    body=departmentServices({shelves,departments,id:selected,me,e,interactive,modules,linked})||'<div class="rq-empty"><strong>الإدارة غير متاحة</strong></div>';
  }else{
    // «خدمات مختارة»: قائمة يدوية ثابتة (FEATURED_SERVICES)، وخدمة صارت خيارًا في بطاقة تظهر بطاقتها مرة واحدة. في «الخدمات»
    // (linked) لا تُرسم هنا: الشاشة ترسم كتلتها فوق العدسات من الحمولة نفسها، فلا تُكرَّر.
    const popular=linked?[]:[...new Map(FEATURED_SERVICES.map(code=>services.find(s=>s.code===code)??services.find(s=>s.variant?.aliases?.includes(code))).filter(Boolean).map(s=>[s.id,s])).values()];
    const mine=own?groups.find(g=>g.department.id===own):null;
    const tone=s=>metaFor(displayDepartment(s));
    // بطاقة الإدارة: زرٌّ يبدّل الرفّ في المشغّل، ورابطٌ إلى صفحة الإدارة في «الخدمات» (linked).
    const deptInside=g=>`<span class="rq-dept-icon" aria-hidden="true">${g.meta.icon}</span><strong>${e(g.department.name)}</strong><span class="rq-dept-tag">${e(g.meta.tagline)}</span><span class="rq-dept-sections">${g.sections.slice(0,3).map(s=>`<i>${e(s.name)}</i>`).join('')}${g.sections.length>3?`<i>+${g.sections.length-3}</i>`:''}</span><span class="rq-dept-count">${countNoun(g.count,'service')} ←</span>`;
    const deptTile=g=>linked
      ?`<a class="rq-dept tone-${g.meta.tone}" href="#departments/${e(g.department.id)}">${deptInside(g)}</a>`
      :`<button type="button" class="rq-dept tone-${g.meta.tone}" data-action="pick-department" data-id="${e(g.department.id)}">${deptInside(g)}</button>`;
    body=`${popular.length?`<div class="rq-results-head"><h3>خدمات مختارة</h3></div><div class="rq-popular">${interactive?MODULE_SERVICES.filter(m=>!me?.can||me.can.includes(m.capability)).map(m=>`<a class="rq-pill tone-${metaFor(m.department_id).tone}" href="${e(m.href)}"><span aria-hidden="true">${serviceGlyph(m,metaFor(m.department_id).icon)}</span>${e(m.name_ar)}</a>`).join(''):''}${popular.map(s=>interactive?s.variant?`<button type="button" class="rq-pill tone-${tone(s).tone}" data-action="pick-variant" data-group="${e(s.code)}"><span aria-hidden="true">${serviceGlyph(s,tone(s).icon)}</span>${e(s.name_ar)}</button>`:s.module_link?`<a class="rq-pill tone-${tone(s).tone}" href="${e(s.module_link)}"><span aria-hidden="true">${serviceGlyph(s,tone(s).icon)}</span>${e(s.name_ar)}</a>`:`<button type="button" class="rq-pill tone-${tone(s).tone}" data-action="pick-service" data-id="${e(s.id)}"><span aria-hidden="true">${serviceGlyph(s,tone(s).icon)}</span>${e(s.name_ar)}</button>`:`<span class="rq-pill tone-${tone(s).tone}">${e(s.name_ar)}</span>`).join('')}</div>`:''}
      ${mine?`<div class="rq-results-head"><h3>خدمات ${e(mine.department.name)}</h3><p>إدارتك</p></div><div class="rq-list">${mine.sections.flatMap(sec=>sec.items).slice(0,5).map(s=>serviceRow(s,departments,e,{interactive,linked})).join('')}</div>`:''}
      ${[...bySector].map(([sector,items])=>`<div class="rq-results-head"><h3>${e(sector)}</h3><p>${countNoun(items.length,'department')} · ${countNoun(items.reduce((n,g)=>n+g.count,0),'service')}</p></div><div class="rq-dept-grid">${items.map(deptTile).join('')}</div>`).join('')}`;
  }
  return `${rail}<div class="rq-results">${body}</div>`;
}

// الرفوف كما تُعرض: الإدارات بوحدات العرض (displayDepartments) مجمَّعةً بالقطاع. مصدرٌ واحد يقرؤه المشغّل وعدسة الإدارة
// وصفحة الإدارة، فلا يفترق شريط الإدارات بين الثلاث.
export function launcherShelves({departments:rawDepartments,services:rawServices,variants=null}){
  // بطاقات الخيارات تحل محل خدماتها في التصفح؛ بدون variants يبقى الدليل كما كان.
  const services=variants?.length?mergeVariants(rawServices,variants):rawServices;
  const departments=displayDepartments(rawDepartments,services);
  const groups=groupCatalog(departments,services);
  const bySector=new Map();
  for(const g of groups.filter(g=>g.count)){
    const sector=g.department.sector||'إدارات أخرى';
    if(!bySector.has(sector))bySector.set(sector,[]);
    bySector.get(sector).push(g);
  }
  return {services,departments,groups,bySector};
}
// شريط الإدارات. في المشغّل أزرارٌ تبدّل الرفّ في مكانه؛ وفي «الخدمات» وصفحة الإدارة (linked، ت1) روابطُ إلى صفحة كل إدارة
// (#departments/<id>) والمختارة aria-current="page"، و«كل الخدمات» يعود إلى عدسة الإدارة.
export function departmentRail({shelves,me,selected='',query='',e,linked=false}){
  const own=me?.department_id,{services,bySector}=shelves;
  const current=id=>selected===id&&!query;
  const railItem=g=>linked
    ?`<a class="rq-rail-item tone-${g.meta.tone} ${current(g.department.id)?'active':''}" href="#departments/${e(g.department.id)}"${current(g.department.id)?' aria-current="page"':''}><span class="rq-rail-icon" aria-hidden="true">${g.meta.icon}</span><span>${e(g.department.name)}${g.department.id===own?' <em>إدارتك</em>':''}</span><small>${g.count}</small></a>`
    :`<button type="button" class="rq-rail-item tone-${g.meta.tone} ${current(g.department.id)?'active':''}" data-action="pick-department" data-id="${e(g.department.id)}" ${current(g.department.id)?'aria-current="true"':''}><span class="rq-rail-icon" aria-hidden="true">${g.meta.icon}</span><span>${e(g.department.name)}${g.department.id===own?' <em>إدارتك</em>':''}</span><small>${g.count}</small></button>`;
  const all=linked
    ?`<a class="rq-rail-item is-all ${current('')?'active':''}" href="#services/department"${current('')?' aria-current="page"':''}><span class="rq-rail-icon" aria-hidden="true">${icon('sparkles')}</span><span>كل الخدمات</span><small>${services.length}</small></a>`
    :`<button type="button" class="rq-rail-item is-all ${!selected&&!query?'active':''}" data-action="pick-department" data-id="" ${!selected&&!query?'aria-current="true"':''}><span class="rq-rail-icon" aria-hidden="true">${icon('sparkles')}</span><span>كل الخدمات</span><small>${services.length}</small></button>`;
  return `<nav class="rq-rail" aria-label="الإدارات">
    ${all}
    ${[...bySector].map(([sector,items])=>`<div class="rq-rail-group"><p class="rq-rail-label">${e(sector)}</p>${items.map(railItem).join('')}</div>`).join('')}</nav>`;
}
// خدمات إدارةٍ واحدة بأقسامها (الأقسام الست والسبعون تجميعٌ داخلي): رأس الإدارة ثم الوحدات المخصصة ثم الأقسام. تقرؤه صفحة
// الإدارة (linked) والمشغّل حين تُختار إدارة. وحدة العرض الموقوفة تقول من ينفّذ خدماتها مؤقتًا.
export function departmentServices({shelves,departments,id,me,e,interactive=true,modules=null,linked=false,workspaces=true}){
  const g=shelves.groups.find(x=>x.department.id===id);
  if(!g)return '';
  const interim=g.department.display_only?`<p class="rq-crumbs">${e(INTERIM_EXECUTOR)}</p>`:'';
  return `<div class="rq-dept-head tone-${g.meta.tone}"><span class="rq-dept-icon" aria-hidden="true">${g.meta.icon}</span><div><p class="rq-crumbs">${e(g.department.sector||'')}</p><h3>${e(g.department.name)}</h3><p>${e(g.meta.tagline)} · ${countNoun(g.count,'service')} في ${countNoun(g.sections.length,'section')}</p>${interim}</div></div>${workspaces?workspaceLinks(g.department.id,modules,me,e):''}${moduleSection(g.department.id,me,e,interactive)}${sectionBlocks(g,departments,e,{interactive,linked})}`;
}

export function requestLauncher({departments,services,me,selected='',query='',e,modules=null,variants=null}){
  const shown=variants?.length?mergeVariants(services,variants):services;
  const count=shown.length,depts=new Set(shown.map(displayDepartment)).size;
  return `<div class="rq" data-launcher><header class="rq-hero"><div class="rq-hero-copy"><span class="rq-kicker">طلب جديد</span><h3>وش تحتاج اليوم؟</h3><p>${countNoun(count,'service')} من ${countNoun(depts,'department')}. ابحث مباشرة، أو اختر الإدارة ثم القسم.</p></div><label class="rq-search"><span class="rq-search-icon" aria-hidden="true">⌕</span><span class="sr-only">ابحث عن خدمة</span><input id="launcher-search" type="search" autocomplete="off" enterkeyhint="search" placeholder="مثال: تعريف بالراتب، صيانة، عقد، سفر" value="${e(query)}"><kbd aria-hidden="true">/</kbd></label></header><div class="rq-body" id="launcher-dynamic">${launcherResults({departments,services,me,selected,query,e,modules,variants})}</div></div>`;
}

// variant (اختياري): {group,option,picker,docs} من variantComposer. الحقول الثابتة في الخيار (preset) لا تظهر، ويرسل النموذج
// variant_group وvariant_option فيحل الخادم الخدمة ويفرض القيم الثابتة (applyVariant). المعاينة تظهر قبل الحفظ في كل خدمة.
// gaps (اختياري): ما طلبته الكرّاسة في النموذج ولم يُبنَ (الحفظ التلقائي، التعبئة من طلب سابق، «عاجل») كما ترسله حمولة
// مركز الخدمات (UNAVAILABLE في app/catalog-home.mjs) — تفاصيل إضافية قابلة للفتح، ويبقى إرشاد حفظ المسودة ظاهرًا.
export function requestComposer({service,departments,projects,request,edit,e,fieldInput,variant=null,gaps=[]}){
  const meta=metaFor(service.department_id),trail=approvalTrail(service,departments);
  const department=departments.find(d=>d.id===service.department_id);
  const steps=[['أنت','تقدّم الطلب'],...trail.steps.map((s,i)=>[s,trail.parallel?'اعتماد متوازٍ':`الاعتماد ${i+1}`]),[trail.handler,'التنفيذ والإغلاق بدليل']];
  const preset=variant?.option?.preset??{},fields=service.fields.filter(f=>{
    if(Object.hasOwn(preset,f.key))return false;
    const condition=f.show_when;
    return !condition||!Object.hasOwn(preset,condition.field)||[].concat(condition.equals).includes(preset[condition.field]);
  });
  const title=variant?`${variant.group.name_ar} — ${variant.option.name_ar}`:service.name_ar;
  const preview=variant?.option?.preview?.text||routePreview(service,departments);
  const hidden=variant?`<input type="hidden" name="variant_group" value="${e(variant.group.code)}"><input type="hidden" name="variant_option" value="${e(variant.option.code)}">`:'';
  const heading=variant?`<p class="rq-crumbs">${e(variant.group.section||department?.name||'')}</p><h3>${e(variant.group.name_ar)}</h3><p>${e(variant.group.description)}</p>`
    :`<p class="rq-crumbs">${e(department?.name||'')}${service.section?` <span aria-hidden="true">›</span> ${e(service.section)}`:''}</p><h3>${e(service.name_ar)}</h3><p>${e(service.description)}</p>`;
  return `<form id="request-form" class="rq-compose" data-id="${e(request?.id)}" data-version="${e(request?.version)}" data-edit="${edit}"><input type="hidden" name="service_id" value="${e(service.id)}">${hidden}<div class="rq-compose-head tone-${meta.tone}">${edit?'':'<button type="button" class="rq-back" data-action="launcher-back">→ كل الخدمات</button>'}<div class="rq-compose-title"><span class="rq-dept-icon" aria-hidden="true">${serviceGlyph(service,meta.icon)}</span><div>${heading}</div></div></div><div class="rq-compose-body"><div class="rq-compose-main">${variant?.picker??''}<label><span>عنوان الطلب <span class="required">*</span></span><input name="title" maxlength="180" required value="${e(request?.title??(edit?'':title))}"></label>${edit?'':`<label><span>ربط بمشروع (اختياري)</span><select name="project_id"><option value="">طلب عام</option>${projects.map(p=>`<option value="${e(p.id)}">${e(p.name)}</option>`).join('')}</select></label>`}<div id="service-fields" class="rq-fields">${fields.map(f=>fieldInput(f,request?.payload?.[f.key])).join('')}</div>${variant?.docs??''}</div><aside class="rq-compose-side" aria-label="مسار الطلب"><h4>مسار طلبك</h4><ol class="rq-trail">${steps.map(([who,what],i)=>`<li class="${i===0?'is-now':''}"><strong>${e(who)}</strong><span>${e(what)}</span></li>`).join('')}</ol><p class="rq-tip">عندك مرفق؟ احفظ المسودة، ارفق الملف (PDF أو PNG أو TXT حتى 2 ميغابايت)، ثم قدّمها.</p>${Array.isArray(gaps)&&gaps.length?`<details class="rq-help"><summary>قبل ما تكمل: خيارات النموذج</summary><ul class="rq-gaps" aria-label="ما ليس في هذا النموذج بعد">${gaps.map(gap=>`<li><strong>${e(gap.label)} — غير متاح.</strong> ${e(gap.why)}</li>`).join('')}</ul></details>`:''}</aside></div><p class="rq-preview" data-route-preview>${e(preview)}</p>${edit?'':'<p class="rq-draft-note">المسودة ما توصل لأحد لين تقدّمها للاعتماد.</p>'}<div class="form-actions"><button class="btn outline" type="button" data-action="close">إلغاء</button>${edit?'<button class="btn dark" type="submit">حفظ التعديل</button>':'<button class="btn outline" type="submit" value="draft">حفظ المسودة</button><button class="btn primary" type="submit" value="submit">تقديم للاعتماد</button>'}</div></form>`;
}

export function catalogBrowser({departments,services,me,query='',selected='',e,admin=false,modules=null,variants=null}){
  // مسح 20 سبتمبر (S-04): العنوان كان يعدّ الخدمات الخام والشريط يعدّ المدموجة، فتظهر «142 خدمة» فوق «كل الخدمات 127»
  // في الشاشة نفسها. كلاهما يعدّ الآن ما يراه المستخدم فعلًا في التصفح: بطاقة الخيارات مكان خدماتها.
  const shown=variants?.length?mergeVariants(services,variants):services;
  return `<div class="rq rq-page" data-launcher data-mode="page"><header class="rq-hero"><div class="rq-hero-copy"><span class="rq-kicker">دليل الخدمات</span><h3>${countNoun(shown.length,'service')} في ${countNoun(new Set(shown.map(displayDepartment)).size,'department')}</h3><p>${admin?'تنظيم الكتالوج حسب الإدارة والقسم. الرمز يظهر لكل خدمة.':'اختر الإدارة ثم القسم، أو ابحث باسم الخدمة.'}</p></div><label class="rq-search"><span class="rq-search-icon" aria-hidden="true">⌕</span><span class="sr-only">ابحث عن خدمة</span><input id="launcher-search" type="search" autocomplete="off" placeholder="ابحث في كل الخدمات" value="${e(query)}"></label></header><div class="rq-body" id="launcher-dynamic">${launcherResults({departments,services,me,selected,query,e,interactive:!admin,modules,variants})}</div></div>`;
}
