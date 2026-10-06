// ت1: الصفحات الجامعة («فريقي» #team، «المنظمة» #organization، «إدارة المنصة» #platform) وصفوف الروابط في «ملفي» و«بانتظار إجرائي» و«طلباتي».
// وحدة نقية بلا DOM ولا نداء خادم: تأخذ الشاشات التي وضعها placeFor (nav-map.mjs) في موضع واحد، من قائمة ما يصله الحساب اليوم (navReach في app.mjs)،
// فلا تمنح وصولًا ولا تمنعه. كل رابط هنا شاشة كان الحساب يصلها قبل ت1 بالشرط نفسه، والخادم يعيد فحص كل فتح.
import { icon, navGlyph } from './hr-design.mjs';
export const HUB_VIEWS=Object.freeze(['team','organization','platform']);
// المسار ← موضع placeFor الذي تجمعه صفحته.
export const HUB_OF=Object.freeze({team:'team',organization:'org',platform:'admin',profile:'profile',work:'pending',inbox:'pending','my-requests':'requests'});
// أقسام كل موضع بترتيب ثابت: [عنوان، عنوان إنجليزي، مفاتيح]. ما لا يرد في قسم يلحق بآخر قسم في صفحته، فلا تضيع شاشة ولا يُفتح قسم «أخرى».
// «ملفي» بأقسام البرومبت §2.1، والأداء و360 والتطوير في «مشاركتي» (ب-تنقل-3)، و«تفويضاتي» و«وثائقي» في «بياناتي» حين يضعهما placeFor هنا (ب-تنقل-2).
export const HUB_SECTIONS=Object.freeze({
  profile:[['بياناتي ووثائقي','My details and documents',['expiry','delegations']],
    ['العقد والراتب والمزايا','Contract, pay and benefits',['contracts','compensation','payroll','my-benefits','letters']],
    ['الوقت والإجازات','Time and leave',['attendance','leave','time','timesheets','travel']],
    ['الأداء والتطوير','Performance and growth',['pulse','recognition','one-to-ones','feedback','performance','review-360','growth']],
    ['الدعم وإعدادات الحساب','Support and account settings',['my-discipline','security','assistants','appearance','notification-settings','access-reviews']]],
  team:[['أعضاء الفريق','Members',['employees','employee-profile','expiry']],['الوقت والإجازات','Time & leave',['attendance','leave','timesheets']],
    ['الطلبات والاعتماد','Requests & approvals',['requests','delegations','access-reviews']],['الأداء والانضباط','Performance & conduct',['performance','discipline']]],
  org:[['الهيكل','Structure',['org']],['السياسات','Policies',['policy-library','policy-assistant','policy-acknowledgements']],['الإعلانات','Announcements',['announcements']]],
  admin:[['الحسابات والصلاحيات','Accounts and access',['accounts','permissions-matrix','access-reviews']],
    ['تشغيل الخدمات','Service operations',['catalog','intake-settings','approval-settings','service-cards','requests','centres']],
    ['التكاملات والأمان','Integrations and security',['integrations','jobs','feature-flags','mail','ai-governance']],
    ['الجودة وتهيئة المنتج','Product quality and configuration',['requirements','definitions','catalog-quality','service-insight','service-benchmark','knowledge']]],
  pending:[['وبانتظارك أيضًا','Also waiting for you',[]]],
  requests:[['وتتابع هنا أيضًا','Also tracked here',[]]]
});
// entries: [{key,label,label_en}] ممن موضعه hub. يعيد [[عنوان، عنوان إنجليزي، entries]] بلا قسم فارغ.
// ت2: القسم الثابت (موجز المالك، البند 6) تبني مجموعاته nav-map.sectionGroups لأنها تعرف أقسامه؛
// فتُمرَّر جاهزةً هنا بدل أن تُشتقّ من HUB_SECTIONS التي لا تعرف إلا الصفحات الجامعة الأربع.
export function hubGroups(hub,entries,ready=null){
  if(ready)return ready;
  const sections=HUB_SECTIONS[hub]??[['','',[]]],out=sections.map(([ar,en])=>[ar,en,[]]),last=out.length-1;
  for(const x of entries){const i=sections.findIndex(s=>s[2].includes(x.key));out[i<0?last:i][2].push(x);}
  return out.filter(s=>s[2].length);
}
// سهم «افتح»: يشير إلى الأمام في اتجاه القراءة، فيُعكس في RTL بصنف is-directional (hr-design.css).
const chevron=icon('chevron','is-directional');
const fallbackTr=ar=>ar;
// أيقونة الشاشة بقرصها الملون من مكتبة التصميم (navGlyphs) — المصدر نفسه الذي يرسم القائمة الجانبية.
const linkTo=(x,{e,tr,current})=>{const g=navGlyph(x.key);return `<a class="hub-link" href="#${e(x.key)}"${current===x.key?' aria-current="page"':''}><span class="nav-icon tint-${g.tint}" aria-hidden="true">${g.svg}</span><span class="hub-link-label">${e(tr(x.label,x.label_en||x.label))}</span>${chevron}</a>`;};
// صف روابط أعلى الصفحة (ملفي، بانتظار إجرائي، طلباتي): معلم nav مسمّى، ولكل قسم عنوانه.
export function hubLinks(hub,entries,{e,tr=fallbackTr,label,current='',groups:ready=null}){
  const groups=hubGroups(hub,entries,ready);if(!groups.length)return '';
  return `<nav class="hub-links" aria-label="${e(label)}">${groups.map(([ar,en,list])=>`<section class="hub-links-group">${ar?`<h2 class="hub-links-title">${e(tr(ar,en))}</h2>`:''}<ul>${list.map(x=>`<li>${linkTo(x,{e,tr,current})}</li>`).join('')}</ul></section>`).join('')}</nav>`;
}
// الصفحة الجامعة: قسم لكل عنوان، وروابط بارتفاع لمس 44. لا شاشة في الموضع لهذا الحساب ← جملة تقول ذلك ومن أين يبدأ.
export function hubPage(hub,entries,{e,tr=fallbackTr,emptyText,groups:ready=null}){
  const groups=hubGroups(hub,entries,ready);
  if(!groups.length)return `<section class="panel panel-body"><p class="subtle">${e(emptyText)}</p></section>`;
  // مجموعةٌ بلا عنوان لا تُرسم لها ترويسةٌ فارغة ولا اسمٌ فارغ لقارئ الشاشة.
  return `<div class="hub-page">${groups.map(([ar,en,list])=>`<section class="panel hub-section"${ar?` aria-label="${e(tr(ar,en))}"`:''}>${ar?`<div class="panel-head"><h2>${e(tr(ar,en))}</h2></div>`:''}<ul class="hub-list">${list.map(x=>`<li>${linkTo(x,{e,tr})}</li>`).join('')}</ul></section>`).join('')}</div>`;
}

// في صفحة الملف يبدأ الموظف ببياناته الفعلية، ثم يجد بقية أبوابه. الصفحات الأخرى تحتفظ بصف الروابط في الأعلى.
export function composeOperationPage({head='',links='',body='',profile=false}){
  return head+(profile?body+links:links+body);
}
