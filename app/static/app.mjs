import { icon as systemGlyph } from './icons.mjs';
import { feedbackPanel,benchmarkPage } from './service-quality-ui.mjs';
import { integrationCards } from './integrations-ui.mjs';
import {workFrames,groupedNavigation,departmentDirectory} from './hr-design.mjs';
import { brandLogo } from './brand-logo.mjs';
import { mountScenes } from './athar.mjs';
import { operationModules,operationFields,collectStructured,money } from './operations.mjs';
import { requestLauncher,requestComposer,launcherResults,catalogBrowser,variantComposer } from './request-picker.mjs';
// مركز الخدمات (الدفعة الثانية): شاشة الدليل وصفحة الفئة وبطاقة الدليل، وصفحة الخدمة. ملفان جديدان
// يبدآن من صفر مكوّن محلي: كل ما يُرسم فيهما من ctx.ui ومن الأصناف القائمة.
import { catalogHome,categoryView,catalogResults,catalogSkeleton,journeyLensView,journeyRunView } from './catalog-home-ui.mjs';
import { servicePageView,servicePageSkeleton } from './service-page.mjs';
import { mountCards } from './motion-cards.mjs';
import { executiveCockpitUI } from './executive-cockpit-ui.mjs';
import { adminCockpitUI } from './admin-cockpit-ui.mjs';
import { orgPage } from './org-ui.mjs';
import { workBoard as workBoardView } from './work-ui.mjs';
import { workspaceUI } from './workspace-ui.mjs';
import { portalPage } from './portal-ui.mjs';
import { parseDeepLink,unavailableText,unknownIntentText,BUILTIN_VIEWS } from './deep-links.mjs';
import { REQUEST_STATUS,ROLE_NAMES } from './vocabulary.mjs';
import { kit } from './kit.mjs';
import { icon as sharedIcon } from './icons.mjs';
import { registerServiceWorker,clearOfflineCaches } from './pwa.mjs';
import { countNoun, countEn } from './arabic-count.mjs';
import { parseFocus,focusRecord } from './focus-record.mjs';
// سجل التعريفات (ترحيل 123): اللقطة المحجوبة، والحقول المخصّصة في النماذج، والتسميات المتجاوَزة. محرّر الصفحة نفسه يُحمَّل كسولًا عند فتحه.
// كل رمز من هنا محروس بـtypeof عند استعماله: خمسة اختبارات تشغّل هذا الملف في صندوق بلا استيراداته.
import { loadSnapshot,snapshot as definitionsSnapshot,editableEntities,extendForm,applyConditions,text as glossaryText,relabel,term as vocabularyTerm,valuesForm,defsFor,isPreviewing } from './definitions-client.mjs';
// ت1: خريطة التنقل المعتمدة في ت0 (موضع كل شاشة وتسميتها الثابتة) والصفحات الجامعة. محروسة بـtypeof كالتعريفات: صناديق الاختبار تحذف الاستيراد.
import { placeFor,HUBS,NO_PAGE_DEPARTMENTS,SECTIONS,navSections,sectionGroups } from './nav-map.mjs';
import { HUB_VIEWS,HUB_OF,hubLinks,hubPage,composeOperationPage } from './hubs-ui.mjs';
const root=document.querySelector('#app'),dialog=document.querySelector('#dialog');
// navReach (ت1): كل شاشة يصلها الحساب اليوم [key,icon,ar,en] بشروط shell() القائمة، ومنشورة على globalThis.navReach لصفحة الإدارة. navItems اسمها القديم.
let operationData,operationView,dialogEpoch=0,clearCards=()=>{},clearTilt=()=>{},navItems=[],navReach=[],departmentNames=null;
const operationForms=new WeakMap();
let catalogTree=null,catalogQuery='',catalogExtra='',catalogCounts='';
let me,csrf,services=[],projectList=[],launcherDepartments=[],launcherState={selected:'',query:''},requestDetail,workData,lang=localStorage.getItem('36t-lang')||'ar',view='home',renderId=0;
// التسمية المتجاوَزة في سجل التعريفات تصل كل ما يُرسم عبر tr(): مطابقة بالنص الكامل («العميل» وحدها، لا جملة تحويها). بلا تجاوز منشور تعود العبارة كما هي.
const tr=(ar,en)=>{const out=lang==='ar'?ar:en;return typeof glossaryText==='function'?glossaryText(out,view,lang):out;};
let pageEditor=null;
const DESIGNS=['depth','classic','void','field','slate','studio','riwaq','yawm','markaz','classicplus'],THEMES=['auto','dark','light'];
let theme=localStorage.getItem('36t-theme'),design=localStorage.getItem('36t-design'),clearScenes=()=>{};
if(!THEMES.includes(theme))theme='dark';if(!DESIGNS.includes(design))design='depth';
// تبديل المظهر دفعة واحدة (better-ui، الدفعة الثالثة): تُعلَّق انتقالات اللون لحظة التبديل ويُفرض تخطيطٌ ثم تعود بعد إطارين — وإلا ذابت الشاشة
// كلها ببطء لأن كل عنصر ينتقل لونه في اللحظة نفسها. الصنف تمسكه قاعدةٌ في signature.css (@layer kill).
const settleLook=()=>{const done=()=>document.documentElement.classList?.remove('is-theme-swap');if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(done));else done();};
const swapLook=apply=>{document.documentElement.classList?.add('is-theme-swap');try{apply();}finally{void document.body?.offsetHeight;settleLook();}};
const paintAppearance=()=>swapLook(()=>{const d=document.documentElement.dataset;d.theme=theme;d.design=design;});
const applyAppearance=a=>{if(!a||!DESIGNS.includes(a.design)||!THEMES.includes(a.theme))return;design=a.design;theme=a.theme;try{localStorage.setItem('36t-design',design);localStorage.setItem('36t-theme',theme);}catch{}paintAppearance();};
paintAppearance();
// «يتبع الجهاز»: الجهاز يقلب الوضع فتقلبه وسائط CSS، والانقلاب يُعامل كتبديلٍ يدوي فلا يذوب.
try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(theme==='auto')swapLook(()=>{});});}catch{}
// لا حركة في الرسم الأول (better-ui): ما يظهر عند فتح الصفحة يظهر ساكنًا، والدخول يتحرك في الرسومات التالية. السمة تُرفع عند بدء الرسم
// الثاني وقبل استبدال الشاشة في المهمة نفسها، فلا يتحرك ما رُسم أولًا ولا يُحرم منه ما يليه (signature.css، @layer kill).
document.documentElement.dataset.firstPaint='';let drawn=0;
const leaveFirstPaint=()=>{if(drawn++)delete document.documentElement.dataset.firstPaint;};
// المظهر ثلاث حالات كما في iOS: تلقائي يتبع الجهاز، ثم فاتح، ثم داكن.
const themeName=()=>theme==='dark'?tr('داكن','Dark'):theme==='light'?tr('فاتح','Light'):tr('تلقائي','Automatic');
const themeButton=()=>`<button class="text-button" data-action="theme" aria-label="${tr('المظهر','Appearance')}: ${themeName()}">${tr('المظهر','Appearance')}: ${themeName()}</button>`;
// أسماء التصاميم الخمسة كما في DESIGN_LIST (app/preferences.mjs). مفتاح التصميم يُحمل في data-value وحده، لا في اسم الفعل:
// تعبير destructive أدناه يحوي void، واسما الفعلين design وpick-design لا يطابقانه.
const designNames={classicplus:['الكلاسيكي المطوّر','الكلاسيكي المطوّر'],studio:['مدار 360','مدار 360'],depth:['كوكبة 360','Constellation 360'],classic:['الكلاسيكي','Classic'],void:['الفراغ','VOID'],field:['الحقل 77','FIELD 77'],slate:['الفحمي','SLATE'],riwaq:['الرواق','RIWAQ'],yawm:['اليوم','YAWM'],markaz:['مركز الأثر','IMPACT CENTRE']};
const designName=(key=design)=>tr(...(designNames[key]||designNames.depth));
const designButton=()=>`<button type="button" class="text-button" data-action="design" aria-haspopup="menu" aria-expanded="false" aria-label="${tr('التصميم','Design')}: ${designName()}">${tr('التصميم','Design')}: ${designName()}</button>`;
// رموز الشريط العلوي والحساب: من مكتبة الأيقونات الواحدة (icons.mjs) — لغة SF البصرية بقرار المالك.
// صناديق الاختبار تحذف الاستيرادات (typeof كحارس glossaryText)، فيرجع الرسم فارغًا هناك ولا يسقط الموجّه.
const glyph=(name,extra)=>typeof sharedIcon==='function'?sharedIcon(name,extra):'';
const scene=controls=>`<div class="athar-scene" data-athar-scene><canvas aria-hidden="true"></canvas>${controls?'<button class="athar-motion" type="button" aria-pressed="false">'+tr('إيقاف الحركة','Pause motion')+'</button>':''}</div>`;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// م0 «السور»: عبارات الحالات والأدوار من القاموس الواحد (vocabulary.mjs) لا من نسخة هنا، والعدّة (kit.mjs) تُبنى مرة وتُحقن في كل شاشة باسم ui.
// tr تُقرأ عند الرسم، فتبديل اللغة لا يحتاج عدّة جديدة. الصندوق التجريبي في الاختبارات يحذف الاستيراد، فيمرر REQUEST_STATUS وROLE_NAMES وkit
// كما يمرر operationModules. الاسم هنا uiKit لا ui لأن الصندوق نفسه يصدّر globalThis.ui.
// الوسيط الثالث للعدّة وصلة سجل التعريفات: تُقرأ عند الرسم، فعدّة واحدة تعيش عبر تبديل الشاشة واللغة والمعاينة.
const labels=REQUEST_STATUS,roleNames=ROLE_NAMES,uiKit=kit(e,tr,typeof defsFor==='function'?defsFor(()=>view,()=>lang):undefined);
// مفتاح من القاموس (status.request.pending، role.pm): التجاوز المنشور إن وُجد، وإلا عبارة القاموس. القاموس يبقى منزل الافتراض الوحيد.
const termOr=(key,fallback)=>(typeof vocabularyTerm==='function'&&vocabularyTerm(key,lang))||fallback;
const actionNames={release:['إعادة الطلب إلى الطابور','Return the work to the queue'],escalate:['تذكير المعتمد','Remind the approver'],submit:['تقديم للاعتماد','Submit for approval'],approve:['اعتماد','Approve'],return:['إعادة للتعديل','Return for changes'],reject:['رفض','Reject'],cancel:['إلغاء الطلب','Cancel request'],claim:['استلام للتنفيذ','Start work'],complete:['إكمال مع دليل','Complete with evidence']};
// B10 (تدقيق 19 سبتمبر): سجل المعاملة كان يقرأ مفاتيح قصيرة فقط، فكل فعل يكتبه الخادم بصيغته الكاملة
// (service.feedback_recorded، request.closed، request.transferred…) يظهر «إجراء آخر». والمفاتيح المعروفة كانت
// عربية وحدها فتبقى عربية في الوضع الإنجليزي. القائمة الآن كاملة وثنائية اللغة، ومصدرها أفعال app/request-timeline.mjs.
const auditNames={created:['إنشاء المسودة','Draft created'],edited:['تعديل المسودة','Draft edited'],
  attachment_added:['إضافة مرفق','File attached'],attachment_downloaded:['تنزيل مرفق','File downloaded'],
  transfer:['تحويل لإدارة أخرى','Transferred'],transferred:['تحويل لإدارة أخرى','Transferred'],'request.transferred':['تحويل لإدارة أخرى','Transferred'],
  assign_task:['إسناد مهمة','Task assigned'],task_assigned:['إسناد مهمة','Task assigned'],'request.task_assigned':['إسناد مهمة','Task assigned'],
  task_completed:['إكمال مهمة','Task completed'],'request.task_complete':['إكمال مهمة','Task completed'],
  task_cancelled:['إلغاء مهمة','Task cancelled'],'request.task_cancel':['إلغاء مهمة','Task cancelled'],
  reopened:['إعادة فتح','Reopened'],'request.reopened':['إعادة فتح','Reopened'],'request.closed':['توثيق التسليم وإغلاق الطلب','Delivery recorded and closed'],
  'intake.saved':['تحديث بيانات الاستقبال','Intake details updated'],
  // الموجة 2 «لا طلب يضيع»: نقل القرار فعلًا، وحركات الإسناد، وتذكير الطلب المعاد وانقضاؤه.
  'approval.escalated':['نقل قرار خطوة إلى مرجع أعلى','Decision moved to a higher authority'],'approval.escalation_blocked':['تعذّر نقل قرار خطوة متأخرة','A late step could not be moved'],
  'request.released':['إعادة الطلب إلى طابور إدارته','Work returned to the queue'],'request.reassigned':['إعادة إسناد التنفيذ','Execution reassigned'],
  'request.assignment_overridden':['تجاوز مسجَّل للإسناد','Assignment overridden on record'],'request.resubmitted_from_lapsed':['إعادة تقديم من طلب منقضٍ','Resubmitted from a lapsed request'],'request.executor_departed':['عودة الطلب بعد إيقاف حساب منفّذه','Work returned after its executor’s account stopped'],
  'request.returned_reminded':['تذكير صاحب الطلب المعاد','Returned request: owner reminded'],'request.lapsed':['انقضاء الطلب لعدم الرد','Lapsed for no reply'],
  feedback:['تقييم الخدمة','Service rated'],'service.feedback_recorded':['تقييم الخدمة','Service rated'],
  'service.field_feedback_recorded':['ملاحظة على حقل في الخدمة','Feedback on a service field'],
  // ابن الرحلة (مركز الخدمات، مراجعة 23 سبتمبر): وُلد باسم صاحب الأب حين اعتمد المعتمِدُ الأبَ، والحدث باسم المعتمِد.
  'journey.child_created':['وُلد من رحلة عند اعتماد طلبها الأب','Created by a journey when its parent was approved']};
const actionLabel=action=>actionNames[action]?tr(...actionNames[action]):auditNames[action]?tr(...auditNames[action]):tr('إجراء آخر','Other action');
const statusLabel=s=>labels[s]?termOr('status.request.'+s,tr(...labels[s])):s;
// B26 (تدقيق 19 سبتمبر): حرف الصورة الرمزية كان أول حرف في الاسم، و«الموظفة التجريبية» تبدأ بأداة التعريف
// فيظهر «ا» لكل من يبدأ اسمه بـ«ال» — حرف لا يدل على أحد، ويُقرأ في الإنجليزية "I". نتخطى «ال» إلى أول حرف من الكلمة نفسها.
function nameInitial(name){
  const word=String(name??'').trim().split(/\s+/)[0]||'؟';
  const letters=[...word];
  return (letters[0]==='ا'&&letters[1]==='ل'&&letters.length>2?letters[2]:letters[0])||'؟';
}
const badge=s=>`<span class="badge ${e(s)}">${e(statusLabel(s))}</span>`;
// B23 (تدقيق 19 سبتمبر): الحقل الاختياري الفارغ كان يقول «لم يُستكمل»، فيقرأه صاحب الطلب ومعتمده كنقص عليه أن يسدّه.
// الفارغ الاختياري «—»، و«لم يُستكمل» تبقى للحقل المطلوب وحده لأنها هناك نقص حقيقي يمنع التقديم.
const fieldValue=(f,value)=>value||(f.required?tr('لم يُستكمل','Not provided'):'—');
const date=value=>new Intl.DateTimeFormat(lang==='ar'?'ar-SA-u-ca-gregory-nu-latn':'en-GB',{dateStyle:'medium',timeZone:'Asia/Riyadh'}).format(new Date(value));
// B34 (تدقيق 19 سبتمبر): سجل المعاملة كان تواريخ بلا أوقات، فأحداث اليوم الواحد لا يُعرف ترتيبها بالنظر،
// ولا يُقاس زمن خطوة داخل اليوم. الوقت بتوقيت الرياض كبقية المنصة.
const dateTime=value=>new Intl.DateTimeFormat(lang==='ar'?'ar-SA-u-ca-gregory-nu-latn':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(value));
const serviceName=s=>lang==='ar'?s.name_ar:s.name_en;
// الإشعار العابر (better-accessibility): منطقة role=status ثابتة في الصفحة؛ أقل مدته 5 ثوانٍ وتطول بطول الجملة وقتَ قراءة (حتى 12)، وإشعارٌ جديد
// يبدأ مؤقته هو، فلا يُخفيه مؤقتُ الذي قبله.
let toastTimer=0;
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');if(typeof clearTimeout==='function')clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),Math.min(12000,5000+String(message??'').length*60));}
async function api(path,method='GET',data,key){
  const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{}),...(csrf?{'x-csrf-token':csrf}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});
  // الرد قد لا يكون JSON أصلًا: وسيط أو نفق بينك وبين الخادم يردّ صفحة HTML عند انقطاعه، فيقع JSON.parse
  // ويظهر للموظف خطأ برمجي خام لا يفهمه ولا يدله على شيء. الشبكة ليست خطأ المستخدم،
  // فتُقال له بالعربية ومعها ما يفعله، ويُذكر رمز حالة الخادم حين يوجد ليعرف مسؤول المنصة أين المشكلة.
  const body=await response.text();
  let result;
  try{result=body?JSON.parse(body):{};}
  catch{
    const gateway=response.status>=500||response.status===0;
    throw Object.assign(new Error(gateway
      ?tr(`تعذّر الوصول إلى المنصة الآن (رمز ${response.status}). الاتصال انقطع بينك وبين الخادم؛ أعد المحاولة بعد قليل، وإن تكرر فأبلغ مسؤول المنصة.`,
          `The platform is unreachable right now (status ${response.status}). Try again shortly; if it persists, tell your platform administrator.`)
      :tr('وصل ردّ غير مفهوم من الخادم. أعد تحميل الصفحة، وإن تكرر فأبلغ مسؤول المنصة.',
          'The server sent an unreadable response. Reload the page; if it persists, tell your platform administrator.')),
      {code:'bad_gateway_response',details:{status:response.status}});
  }
  if(!response.ok){if(response.status===401&&path!=='/login'){me=null;csrf=null;dialogEpoch++;if(dialog.open)dialog.close();loginView();if(result.error?.details?.reason==='idle')toast(tr('انتهت الجلسة لعدم النشاط','Your session ended after inactivity'));}
    // م0 «السور»: الرفض المكتوب (app/refusal.mjs) يصل في error.details.refusal؛ يبقى مع الخطأ ليرسمه ui.refusal ولا يُختزل إلى نصه.
    throw Object.assign(new Error(result.error?.message||tr('تعذر إكمال العملية','The request failed')),{code:result.error?.code??null,details:result.error?.details??null});}
  return result;
}
function empty(title,body){return `<div class="empty"><div class="empty-symbol" aria-hidden="true">⌑</div><strong>${e(title)}</strong><p>${e(body)}</p></div>`;}
// رأس الشاشة: عنوان كبير على نمط iOS يصغر إلى الشريط العلوي عند التمرير، ثم سطر وصف، ثم فعل الشاشة.
function pageHead(title,description,action=''){return `<div class="page-head"><div><h1>${e(title)}</h1>${description?`<p>${e(description)}</p>`:''}</div>${action?`<div class="page-actions">${action}</div>`:''}</div>`;}
const taskStatus={open:['مفتوحة','Open'],completed:['مكتملة','Completed'],cancelled:['ملغاة','Cancelled']};
// مصدر الزمن المستهدف بالإنجليزية. العبارة العربية تأتي مبنيّة من الخادم (app/service-target.mjs TARGET_NOTES)
// فلا تُكتب هنا مرتين؛ الإنجليزية وحدها تُقابَل بمفتاح الحالة لأن الخادم لا يترجم.
const TARGET_SOURCE_EN={derived:'Derived from the service code family — nobody has adopted it, so it is not a promise anyone made',
  recorded:'Recorded in the directory with no written adoption decision — not a promise anyone made',
  adopted:'Adopted by the procedure owner in a written decision'};
// «يستحق في…» تاريخٌ يقرؤه صاحب الطلب وعدًا. ما لم يتبنَّ الزمنَ إنسانٌ يُقال ذلك بجوار التاريخ نفسه لا في شاشة أخرى.
const targetSource=clock=>{
  const t=clock?.target;
  if(!t||t.kind==='unset'||t.adopted)return '';
  return `<small class="subtle">${e(tr(t.note,TARGET_SOURCE_EN[t.kind]??t.note))}</small>`;
};
function clockChip(r){
  if(!r.clock?.target_days)return '';
  const source=targetSource(r.clock);
  if(r.clock.paused)return `<span class="badge">${tr('المدة متوقفة حتى يرد مقدّم الطلب','Paused until the requester replies')}</span>${source}`;
  if(!r.clock.due_on&&!r.clock.overdue)return `<span class="badge">${tr('زمن الخدمة','Service level')} ${tr(countNoun(r.clock.target_days,'working_day'),countEn(r.clock.target_days,'working day'))}</span>${source}`;
  return `<span class="badge ${r.clock.overdue?'rejected':'approved'}">${r.clock.overdue?tr('متأخر عن زمن الخدمة','Past the service level'):`${tr('يستحق','Due')} ${e(date(r.clock.due_on))}`}</span>${source}`;
}
function routingPanel(r){
  const tasks=r.tasks||[],transfers=r.transfers||[];
  if(!tasks.length&&!transfers.length&&!r.actions.includes('transfer')&&!r.actions.includes('assign_task'))return '';
  const controls=[r.actions.includes('assign_task')?`<button class="btn outline small" data-action="assign-task">${tr('إسناد مهمة','Assign a task')}</button>`:'',
    r.actions.includes('transfer')?`<button class="btn outline small" data-action="transfer">${tr('تحويل لإدارة أخرى','Transfer')}</button>`:''].join(' ');
  const taskRows=tasks.map(t=>`<div class="task-row"><div><strong>${e(t.title)}</strong><small> · ${e(t.assignee_name)} · ${tr('الاستحقاق','Due')} ${e(date(t.due_date))}</small><p class="subtle">${e(t.acceptance)}</p>${t.evidence?`<p class="subtle">${e(t.evidence)}</p>`:''}</div><div class="task-row-end"><span class="badge ${t.status==='completed'?'approved':t.status==='cancelled'?'rejected':'pending'}">${tr(...taskStatus[t.status])}</span>${t.status==='open'&&(t.assignee_id===me.id||r.actions.includes('assign_task'))?`<button class="btn outline small" data-action="settle-task" data-id="${e(t.id)}" data-mode="${t.assignee_id===me.id?'complete':'cancel'}">${t.assignee_id===me.id?tr('إكمال','Complete'):tr('إلغاء','Cancel')}</button>`:''}</div></div>`).join('');
  const transferRows=transfers.map(t=>`<p class="subtle">${e(date(t.created_at))} · ${e(t.actor_name)} · ${e(t.from_department_id)} ← ${e(t.to_department_id)} · ${e(t.reason)}</p>`).join('');
  return `<section class="panel"><div class="panel-head"><div><h2>${tr('التنفيذ والمهام','Execution & tasks')}</h2><p class="subtle">${tr('الإدارة المنفذة','Handling department')}: ${e(r.handling_department_id||r.service.department_id)}</p></div><div>${controls}</div></div><div class="panel-body">${taskRows||`<p class="muted">${tr('لا توجد مهام مسندة على هذا الطلب.','No tasks are assigned on this request.')}</p>`}${transfers.length?`<h3 class="mt">${tr('سجل التحويل','Transfer trail')}</h3>${transferRows}`:''}</div></section>`;
}
// من ينفّذ هذا الطلب وبأي سند. الاحتياط ظاهر لا ضمني: «نائب مسمّى» أو «مرجع تصعيد الإدارة» باسمه وسببه،
// والعجز يُكتب رفضًا يقول ما الناقص ومن يملكه وما الخطوة التالية بدل أن يقف الطلب صامتًا عند «معتمد».
function executionPanel(r){
  const x=r.execution;
  if(!x)return '';
  const gap=x.refusal?uiKit.refusal(x.refusal):'';
  const people=x.people.map(p=>`<div class="timeline-item"><strong>${e(p.name)}</strong>${p.rank?`<small> · ${tr('الرتبة','Rank')} ${e(p.rank)}</small>`:''}${p.why?`<p class="subtle">${e(p.why)}</p>`:''}</div>`).join('');
  const label=x.fallback?`<span class="pill">${e(x.label)}</span>`:'';
  return `<section class="panel"><div class="panel-head"><h2>${tr('من ينفّذ هذا الطلب','Who executes this request')}</h2>${label}</div><div class="panel-body">
    ${x.fallback?`<p class="subtle">${tr('لم يبقَ في الإدارة المنفذة من ينفّذه: من قرره لا ينفّذه. وصل إلى من يلي بسند مكتوب.','No one is left in the handling department: whoever decided it does not execute it. It reached the people below on a recorded basis.')}</p>`:''}
    ${people||gap||`<p class="muted">${tr('لا أحد يملك تنفيذه الآن.','No one can execute it now.')}</p>`}</div></section>`;
}
// «من يعتمد هذا الطلب، ومن ينفّذه، وبأي سند، وهل يجوز أن يكونا شخصًا واحدًا» — على الطلب نفسه.
// السؤال الأخير ليس نظريًا: مسح 21 سبتمبر وجد 115 طلبًا من 142 نفّذه الحسابُ الذي اعتمده. فصار الجواب معروضًا:
// حين يجوز الجمع يُقال إنه جائز، وحين يقع فعلًا يُسمَّى من جمعهما — الجمع في الخدمة العادية مُسجَّل ومعروض لا ممنوع.
// المصدر workflowView في app/workflow.mjs؛ هذه الشاشة تعرض ما بنته ولا تشتق حكمًا من عندها.
function workflowPanel(r){
  const w=r.workflow;
  if(!w)return '';
  const steps=w.approves.map(a=>`<div class="timeline-item"><strong>${e(a.name)}</strong><small> · ${e(a.basis_label)}</small>${a.decided_by_name&&a.decided_by_name!==a.name?`<p class="subtle">${tr('قرّرها','Decided by')}: ${e(a.decided_by_name)}</p>`:''}</div>`).join('')
    ||`<p class="muted">${tr('لا خطوة اعتماد على هذا الطلب — مسار مباشر.','No approval step on this request — a direct route.')}</p>`;
  const executes=w.executes?`<p>${tr('ينفّذه','Executed by')}: ${e(w.executes.people.map(p=>p.name).join('، ')||'—')} <span class="pill">${e(w.executes.label)}</span></p>`
    :`<p class="subtle">${tr('يتحدد المنفّذ عند اعتماد الطلب.','The executor is resolved when the request is approved.')}</p>`;
  const combined=w.decider_is_executor?`<p class="badge rejected">${e(w.decider_is_executor_note)}</p>`:'';
  return `<section class="panel"><div class="panel-head"><h2>${tr('من يعتمده ومن ينفّذه','Who approves and who executes')}</h2><span class="pill">${w.separation_of_duties?tr('فصل المهام مُشغَّل','Separation of duties on'):tr('فصل المهام غير مُشغَّل','Separation of duties off')}</span></div>
    <div class="panel-body"><div class="timeline">${steps}</div>${executes}${combined}<p class="subtle">${e(w.same_person_note)}</p></div></section>`;
}
function newButton(){return me.role!=='admin'?`<button class="btn primary" data-action="new-request"><span aria-hidden="true">${glyph('plus')}</span>${tr('طلب جديد','New request')}</button>`:'';}
// الإغلاق المحكوم: المنفذ يربط الطلب بسجل حقيقي في وحدته أو بمرفق محفوظ، ثم
// يقبل صاحب الطلب المخرج بيد مستقلة. هذه اللوحة تعرض الحالة نفسها التي يفحصها الخادم.
function serviceOutputPanel(r){
  const gate=r.delivery_outputs;if(!gate?.required)return '';
  const contract=gate.contract,statusName={submitted:tr('بانتظار قبول صاحب الطلب','Waiting for requester acceptance'),accepted:tr('مقبول','Accepted'),rejected:tr('مرفوض','Rejected')};
  const route=String(contract.route||'#request').replace(/^#/,'');
  const outputs=(gate.outputs||[]).map(output=>{
    const reference=output.attachment_id
      ?`<a href="/api/attachments/${e(output.attachment_id)}">${tr('فتح المرفق','Open attachment')}</a>`
      :`<a href="#${e(route)}"><bdi>${e(output.record_id)}</bdi></a>`;
    const decisions=(output.actions||[]).map(action=>`<button class="btn ${action==='reject_output'?'danger':'dark'} small" data-action="decide-service-output" data-decision="${action==='accept_output'?'accept':'reject'}" data-id="${e(output.id)}" data-version="${output.version}">${action==='accept_output'?tr('قبول المخرج','Accept output'):tr('رفض المخرج','Reject output')}</button>`).join(' ');
    return `<div class="task-row"><div><strong>${e(output.title)}</strong><small> · ${e(statusName[output.status]||output.status)} · ${e(output.recorded_by_name||'')}</small><p class="subtle">${e(output.evidence)}</p><p class="subtle">${tr('المرجع','Reference')}: ${reference}</p>${output.decision_note?`<p class="subtle">${tr('قرار صاحب الطلب','Requester decision')}: ${e(output.decision_note)}</p>`:''}</div><div class="task-row-end">${decisions}</div></div>`;
  }).join('');
  const canRecord=(gate.actions||[]).includes('record_output'),needsFile=contract.requires_attachment&&!(r.attachments||[]).length;
  const record=canRecord?`<button class="btn primary small" data-action="record-service-output" ${needsFile?'disabled':''}>${tr('تسجيل المخرج الفعلي','Record actual output')}</button>`:'';
  const state=gate.closure_ready
    ?`<span class="badge approved">${tr('جاهز للإغلاق','Ready to close')}</span>`
    :`<span class="badge pending">${tr('الإغلاق متوقف حتى قبول المخرج','Closure waits for output acceptance')}</span>`;
  const attachmentHint=(gate.invalid_reason?`<p class="notice" role="alert">${e(gate.invalid_reason)}</p>`:'')+(canRecord&&needsFile?`<p class="notice">${tr('أضف ملف التسليم من قسم المرفقات أولًا، ثم سجله هنا ليقبله صاحب الطلب.','Attach the delivery file first, then record it here for the requester to accept.')}</p>`:'');
  return `<section class="panel service-output-panel"><div class="panel-head"><div><h2>${tr('المخرج الفعلي وإغلاق الخدمة','Actual output and service closure')}</h2><p class="subtle">${e(contract.output_label)} · ${tr('الجولة','Round')} ${gate.round}</p></div>${state}</div><div class="panel-body"><p>${tr('الوحدة المسؤولة','Responsible module')}: <a href="#${e(route)}">${e(contract.module)}</a></p>${attachmentHint}${outputs||`<p class="muted">${tr('لم يُسجل مخرج بعد. لا يمكن إغلاق الطلب قبل تسجيله وقبول صاحب الطلب له.','No output has been recorded. The request cannot close until the requester accepts one.')}</p>`}<div class="mt">${record}</div></div></section>`;
}
function table(rows){return rows.length?`<div class="table-wrap"><table><thead><tr><th>${tr('الطلب','Request')}</th><th>${tr('الحالة','Status')}</th><th>${tr('آخر تحديث','Updated')}</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><a href="#request/${e(r.id)}"><strong>${e(r.title)}</strong><small>${e(r.service_name)} · ${e(r.id.slice(0,8))}</small></a></td><td>${badge(r.status)}${r.needs_me?` <span class="pill">${tr('بانتظارك','Your decision')}</span>`:''}</td><td>${e(date(r.updated_at))}</td><td><a class="btn outline small" href="#request/${e(r.id)}">${tr('فتح','Open')}</a></td></tr>`).join('')}</tbody></table></div>`:empty(tr('لا توجد طلبات هنا بعد','No requests here yet'),tr('ابدأ أول طلب من «الخدمات».','Start your first request from Services.'));}
// ت1: موضع الشاشة لهذا الحساب (placeFor في nav-map.mjs). بلا الوحدة (صندوق الاختبار) لا موضع، والتسمية تسمية القائمة القديمة.
let navRoute='',navSectionRows=[];
const placeOf=(key,label)=>typeof placeFor==='function'?placeFor(key,label,me):{hub:'internal',label};
const ownDepartment=()=>me?.department_id&&!(typeof NO_PAGE_DEPARTMENTS==='object'?NO_PAGE_DEPARTMENTS:['ops']).includes(me.department_id)?me.department_id:null;
// التسمية الثابتة لكل عدسة: آخر مقطع من تسمية placeFor. وإن طابقت اسم الصفحة الجامعة التي تسكنها («مهامي» موضعها «بانتظار إجرائي»)
// فالتسمية القديمة، حتى لا يحمل رابطان في مكان واحد اسمًا واحدًا لوجهتين.
function stableLabel(key,ar){const p=placeOf(key,ar),own=String(p.label??ar).split(' › ').pop(),hub=typeof HUBS==='object'?HUBS[p.hub]:null;return hub&&hub.label===own&&hub.route!==key?ar:own;}
const screenTitle=key=>{const n=navReach.find(x=>x[0]===key);return n?tr(stableLabel(key,n[2]),n[3]):null;};
// الشاشات التي يضعها placeFor في موضع واحد لهذا الحساب، بلا مدخل الصفحة الجامعة نفسها.
const placedIn=hub=>navReach.filter(([key,,ar])=>placeOf(key,ar).hub===hub&&!(typeof HUBS==='object'&&HUBS[hub]?.route===key)).map(([key,,ar,en])=>({key,label:stableLabel(key,ar),label_en:en}));
// مدخل القائمة الذي تسكن تحته الشاشة: أداة إدارة الحساب تحت مدخل إدارته، وأداة إدارة أخرى تُبلغ من «الخدمات» › الإدارات (بعد-ب).
// ت2: أبو الشاشة هو القسم الذي وضعتها فيه nav-map، لا خريطةٌ ثانية هنا. مصدرٌ واحد للموضع فلا ينحرف اثنان.
function navParent(key){
  return navSectionRows.find(row=>row.entries.some(x=>x.key===key))?.route??'';
}
// الأسماء البديلة للمسارات (ت1، ق-ت1-3): المسار القديم ← بيت الشاشة الجديد، ولا شاشة تُحذف. عادت #portal وجهة مستقلة تجمع كل خدمات الحساب؛
// #catalog ← «الخدمات» لمن كان يراه «طلب خدمة» (كل حساب غير الأدمن)، أما «دليل الخدمات» عند الأدمن فشاشة إعداد الخدمات فتبقى؛
// و#departments بلا إدارة ← #services/department (عدسة الإدارة لهذا الرسم وحده، بلا كتابة)، و#departments/<id> صفحة الإدارة كما هي.
const ROUTE_ALIASES={catalog:()=>me?.role!=='admin'?{route:'services'}:null,departments:rest=>rest.split('/')[0]?null:{route:'services/department'}};
function routeAlias(route){const [head,...rest]=String(route??'').split('?')[0].split('/');return Object.hasOwn(ROUTE_ALIASES,head)?ROUTE_ALIASES[head](rest.join('/')):null;}
// صف روابط الموضع أعلى صفحته الجامعة (ملفي، بانتظار إجرائي، طلباتي). فارغ حين لا شاشة في الموضع أو بلا الوحدة.
const hubRow=route=>typeof hubLinks==='function'&&HUB_OF[route]?hubLinks(HUB_OF[route],placedIn(HUB_OF[route]),{e,tr,label:tr('شاشات هذا القسم','Screens in this section')}):'';
function shell(){
  clearScenes();
  // التنقل يُبنى من تصاريح الحساب لا من دوره: ما لا تملك تصريحه لا يظهر لك.
  const allowed=new Set(me.can||[]);
  const has=key=>allowed.has(key);
  const nav=[];
  // ت1: nav أدناه لم يعد القائمة الجانبية؛ صار «ما يصله الحساب اليوم» (navReach). كل شرط nav.push باقٍ كما كان حرفًا بحرف — ت1 لا تتخذ قرار
  // وصول جديدًا — والقائمة الجانبية تُبنى بعد الكتلة مداخلَ ثابتة الترتيب، وكل شاشة هنا تجد موضعها الواحد من placeFor (nav-map.mjs).
  // الشاشة ذات الوجهين (شخصي وإداري) تظهر مرة واحدة في «مساحتي» ويتبدل اسمها بحسب التصريح.
  // staff: شاشات يرفضها الخادم لحساب الأدمن مهما حمل من تصاريح (403 forbidden)، فلا تُعرض له.
  // لا مدخل في القائمة لـannotations وeinvoice-selfcheck وsearch: تُفتح بـ#key من الموجّه، والبحث الشامل من حقل «ابحث عن شاشة».
  // plain: موظف بلا دور إشرافي. قائمته ما يستعمله فعلًا (تدقيق 19 سبتمبر B12 والتوصية 6)؛ ما يمنحه له تصريح إضافي يظهر بتصريحه.
  // delivery: شاشات العملاء والمشاريع لمن هو عضو في فريق عميل أو مشروع (delivery_member من /api/me)؛ غيابها يُبقي السلوك السابق.
  const staff=me.role!=='admin',plain=me.role==='employee',delivery=['manager','pm'].includes(me.role)||(me.role==='employee'&&me.delivery_member!==false),ledger=has('finance.use')&&me.capabilities?.finance;
  const payrollTeam=['payroll.prepare','payroll.review','payroll.approve'].some(has),taxTeam=['tax.returns.prepare','tax.returns.review'].some(has);
  const governance=['governance.objectives.manage','governance.risks.manage','governance.decisions.record','executive.view'].some(has);
  try{document.documentElement.dataset.audience=plain?'employee':staff?'staff':'admin';document.documentElement.dataset.viewAs=me.view_as?'on':'off';}catch{}
  // 1. مساحتي — اليوم. الرئيسية موجز اليوم، وبوابة الموظف تجمع شؤونه وكل خدماته، و«أين طلباتي» صار «طلباتي» الموحدة.
  nav.push(['home','⌂','الرئيسية','Home']);
  if(has('portal.use'))nav.push(['portal','◎','بوابة الموظف','Employee portal']);
  if(has('portal.use')||!plain)nav.push(['work','☰','عملي','My work']);
  if(has('requests.use'))nav.push(['my-requests','⇢','طلباتي','My requests']);
  nav.push(['notifications','♧','الإشعارات','Notifications']);
  if(has('portal.use'))nav.push(['announcements','✉','الإعلانات','Announcements']);
  // 1. مساحتي — شؤوني
  if(staff)nav.push(['attendance','◔',['hr.attendance.manage','hr.attendance.approve'].some(has)?'الحضور والانصراف':'حضوري','Attendance']);
  if(has('leave.use')&&staff)nav.push(['leave','◴',['hr','manager'].includes(me.role)?'الإجازات':'إجازاتي','Leave']);
  if(delivery)nav.push(['time','⧗','ساعاتي','My hours']);
  if(staff)nav.push(['expenses','◐',me.capabilities?.finance||me.role==='manager'?'المصروفات والعهد النقدية':'مصروفاتي وعهدي','Expenses & cash custody']);
  if(staff)nav.push(['letters','✉',['hr.letters.prepare','hr.letters.issue'].some(has)?'خطابات الموظفين':'خطاباتي','Letters']);
  // دمج 20260919: قائمة الموظف العادي قصيرة (101). الاستقالة والانتداب يبلغهما الموظف من «طلب خدمة» (HR-RESIGNATION وADM-TRAVEL
  // تفتحان الشاشتين، 102) ومن #resignations و#travel، ويظهران في القائمة لمن يعتمد أو يدير.
  if(staff&&!plain)nav.push(['resignations','⇤','الاستقالة','Resignation'],['travel','✈','الانتداب','Business travel']);
  if(staff)nav.push(['contracts','▤',['hr.policy.prepare','hr.policy.accept','hr.contracts.manage','hr.contracts.approve'].some(has)?'العقود وبنود الراتب':'عقدي وراتبي','Contracts & pay']);
  if(staff)nav.push(['payroll','◒',payrollTeam?'مسير الرواتب':'قسائم راتبي',payrollTeam?'Payroll':'My payslips']);
  // «ملفي»: ملف الموظف بأرقام مقنّعة؛ التغيير بطلب. يُغني الموظف عن «السجل الوظيفي» (403 له) وعن «انتهاء الوثائق».
  if(staff)nav.push(['profile','♙','ملفي','My profile']);
  if(staff)nav.push(['my-benefits','♥','مزاياي','My benefits']);
  // 1. مساحتي — مشاركتي
  if(staff)nav.push(['hr-cases','✎',has('hr.cases.handle')?'الحالات السرية':'الشكاوى والاستفسارات','HR cases']);
  // سجل المخالفات والجزاءات (ترحيل 097): صفحة الموظف
  if(staff)nav.push(['my-discipline','⚖','مخالفاتي وجزاءاتي','My violations & penalties']);
  // مكتبة السياسات (ترحيل 110): نص اللائحة يقرؤه كل موظف، فبطاقته في قائمة الجميع بلا تصريح.
  if(staff)nav.push(['policy-library','§','مكتبة السياسات','Policy library']);
  // «اسأل تركي» (ترحيل 111): الإجابة من نص المنصة وبيانات السائل وحده. قائمة الموظف العادي تبقى قصيرة
  // (تدقيق 19 سبتمبر B12)، ومدخله إليها الزر السريع في الرئيسية؛ ومن يشرف أو يعتمد يجدها في قائمته.
  if(staff&&!plain)nav.push(['policy-assistant','❓','اسأل تركي','Ask Turki']);
  if(has('portal.use'))nav.push(['policy-acknowledgements','✓','السياسات المطلوب إقرارها','Policies to acknowledge'],['pulse','♡','استبيان النبض','Pulse survey'],['recognition','✪','التقدير','Recognition']);
  if(has('portal.use')&&staff)nav.push(['one-to-ones','⇆','اللقاءات الفردية','One-to-ones'],['feedback','✐','ملاحظات الزملاء','Colleague feedback']);
  // 1. مساحتي — حسابي
  nav.push(['security','⛨','أمان حسابي','Account security']);
  // المساعدون معطّلون حتى يفعّلهم الأدمن الأول؛ صفحة «غير مفعّلة» لا تُعرض للموظف في قائمته.
  if(!plain)nav.push(['assistants','✺','المساعدون الذكيون','AI assistants']);
  // المظهر متاح من قسم الحساب نفسه؛ لا نكرر له صفًا في قائمة العمل اليومية.
  // دمج 20260919: للموظف العادي تُفتح الإعدادات من زر «إعدادات الإشعارات» في صفحة الإشعارات (100)، فتبقى قائمته قصيرة (101) مع «مزاياي» (103).
  if(!plain)nav.push(['notification-settings','✉','إعدادات الإشعارات','Notification settings']);
  // 2. الطلبات والخدمات — الطلبات. «الطلبات» و«الإدارات» تكرران «طلباتي» و«طلب خدمة» عند الموظف، فتبقيان لمن يعتمد أو ينفذ.
  // مركز الخدمات: الدليل بعدسة حاجة الطالب (الفئات الثماني). «دليل الخدمات» القديم يبقى بعدسة الإدارة كما هو.
  // ت1 (البرومبت §2.1، ميزانية NAV_BUDGET): «الخدمات» باب كل من يحمل requests.use، والموظف العادي منهم. كان محجوبًا عنه حتى يقرّر المالك
  // المدخل الثاني والثلاثين؛ قرّر في ت0 قائمة من ثمانية مداخل هذا الباب أحدها. هذا الانعكاس للباب وحده: #services كان مفتوحًا له بالرابط
  // من قبل (الخادم لا يحجبه)، فلا وصول جديد. «الطلبات» و«الإدارات» تبقيان بشرطهما.
  if(has('requests.use'))nav.push(['services','◎','مركز الخدمات','Service centre']);
  // بابان يفتحان الشاشة نفسها: ROUTE_ALIASES أعلاه يحوّل ‎#catalog‎ إلى ‎#services‎ لكل حساب غير الأدمن،
  // فكان «مركز الخدمات» و«طلب خدمة» مدخلين في قائمة الموظف يصلان الوجهة عينها. يبقى المدخل للأدمن
  // وحده، حيث ‎#catalog‎ شاشة إعداد الخدمات فعلًا لا اسمًا آخر لمركزها.
  if(!staff&&(has('requests.use')||has('catalog.manage')))nav.push(['catalog','⊞','دليل الخدمات','Service catalog']);
  if(has('requests.use')&&!plain)nav.push(['requests','▤','الطلبات','Requests'],['departments','▦','الإدارات','Departments']);
  if(!plain||has('catalog.manage'))nav.push(['service-cards','▣','بطاقات الخدمات','Service cards']);
  if(has('delegations.use'))nav.push(['delegations','⇌','التفويض المؤقت','Delegation']);
  // 2. الطلبات والخدمات — إعداد الخدمات: صفحات إعداد وتطوير، بتصاريحها لا لكل موظف (B12).
  if(has('catalog.manage'))nav.push(['intake-settings','⚑','أولويات الطلبات','Request priorities']);
  if(has('catalog.manage')||has('executive.view'))nav.push(['catalog-quality','△','نواقص دليل الخدمات','Catalog gaps']);
  if(has('executive.view')||has('catalog.manage'))nav.push(['service-insight','◕','قياس الخدمات','Service insight']);
  if(has('knowledge.manage'))nav.push(['knowledge','✧','مراجعة المصادر','Source review']);
  if(has('requirements.view'))nav.push(['service-benchmark','◇','تطوير الخدمات','Service improvement']);
  // «الرئاسة» التي تعتمد حدود الاعتماد لا تُعرف من me اليوم؛ الشرط الثالث يعمل حين يضيف الخادم capabilities.thresholds.
  if(has('catalog.manage')||has('structure.manage')||me.capabilities?.thresholds)nav.push(['approval-settings','⚙','إعداد مسارات الاعتماد','Approval routing']);
  // 3. الموارد البشرية — الموظفون
  if((has('hr.operations.use')||has('hr.permissions.delegate'))&&staff)nav.push(['hr-operations','✣','مركز عمليات الموارد البشرية','HR operations centre']);
  // الخادم يفتح السجل الوظيفي لحامل employees.view أو لمن يتبعه موظفون؛ me لا يحمل الثانية فيُستدل عليها بدور المدير.
  if(staff&&(has('employees.view')||me.role==='manager'))nav.push(['employees','♗','السجل الوظيفي','Employee records']);
  // الملف الموحّد بشرط الدليل نفسه، وبجواره في القائمة. الموظف العادي لا يأخذ مدخلًا ثالثًا: «ملفي» (#profile) هو بابه
  // إلى بياناته، ومدخلان لبيانات الشخص نفسه يربكان أكثر مما يفيدان — وميزانية قائمته 31 مدخلًا يحرسها tests/employee-ux.
  // من فتح الدليل يفتح ملف أي موظف من اسم الصف فيه، وهو الطريق نفسه الذي يسلكه النظام المرجعي.
  if(staff&&(has('employees.view')||me.role==='manager'))nav.push(['employee-profile','⊙','ملف الموظف','Employee profile']);
  if(has('people.manage')&&staff)nav.push(['people','♙','التوظيف','Hiring']);
  if(has('people.manage'))nav.push(['lifecycle','⇥','التعيين والمغادرة','Joining & leaving'],['clearance','⇤','إخلاء الطرف','Clearance']);
  // شاشة واحدة لاعتماد كل سياسات الموارد البشرية وقائمة جاهزيتها (hr-policy-unify.md)
  if(staff&&(has('hr.policy.accept')||has('hr.policy.prepare')))nav.push(['hr-policies','☰','سياسات الموارد البشرية','HR policies']);
  if(staff&&(has('hr.policy.accept')||has('hr.policy.prepare')||payrollTeam))nav.push(['payroll-rules','§','قواعد اللائحة في الرواتب','Payroll regulation rules']);
  // وثائق الموظف نفسه في «ملفي» بتواريخ انتهائها؛ «انتهاء الوثائق» شاشة رصد لمن يملك وثائق غيره.
  if(!plain||['employees.view','vendors.view','hr.contracts.manage'].some(has))nav.push(['expiry','⧖','انتهاء الوثائق','Document expiry']);
  if(staff&&['hr.letters.prepare','hr.letters.issue'].some(has))nav.push(['letter-templates','✉','قوالب الخطابات','Letter templates']);
  // سجل المخالفات والجزاءات (ترحيل 097): الموارد البشرية وصاحب الصلاحية والرواتب والمدير المباشر (الخادم يحصر ما يراه كل منهم)
  if(staff&&(['hr.discipline.propose','hr.discipline.decide','hr.policy.accept'].some(has)||payrollTeam||me.role==='manager'))nav.push(['discipline','⚖','المخالفات والجزاءات','Violations & penalties']);
  if(has('hr.workforce.view')&&staff)nav.push(['workforce','◔','تركيبة الموظفين','Workforce mix']);
  // 3. الموارد البشرية — الوقت والإجازات
  if(['hr.policy.prepare','hr.policy.accept'].some(has))nav.push(['leave-accrual','◴','استحقاق الإجازات','Leave accrual']);
  if(has('hr.benefits.manage'))nav.push(['benefits','♥','التأمين والمزايا','Insurance & benefits']);
  if(staff&&['hr.benefits.manage','hr.policy.prepare','hr.policy.accept','benefits.finance.confirm','payroll.prepare'].some(has))nav.push(['benefits-admin','❖','إدارة المزايا','Benefits administration']);
  // 3. الموارد البشرية — الرواتب
  if(payrollTeam)nav.push(['payroll-extras','◓','حركات الرواتب','Payroll movements'],['payroll-anomaly','⌕','فحص المسير','Payroll checks'],['wage-reconciliation','⚖','مطابقة الأجور','Wage reconciliation'],['wps','⛨','ملف حماية الأجور','Wage protection file']);
  // حالات التأمينات (ترحيل 127): تكشف الجنسية، فبابها تصريح قراءة القوى العاملة أو تصريح رواتب — لا دور المدير.
  if(staff&&(has('hr.workforce.view')||payrollTeam))nav.push(['payroll-insurance','⛉','حالات التأمينات','Insurance cases']);
  // المسير الموازي والانتقال (الترحيل 176): لحاملي تصاريح الرواتب، وهو شرط الخادم نفسه في app/payroll-parallel.mjs.
  if(payrollTeam)nav.push(['payroll-parallel','⇄','المسير الموازي','Parallel payroll']);
  // «زياداتي» كانت تَعِد الموظف بما تمنعه قاعدة الشاشة نفسها. نصّها: «المدير يرى مقترحات فريقه المباشر
  // فقط… ولا يرى أحد مقترحًا يخصه». فالمدخل يفتح على شاشة لا تعرض لصاحبها شيئًا عن زيادته أبدًا، وهذا
  // سؤالٌ يُولَد عند كل موظف يفتحها. الزيادة تصل صاحبها حين تُنفَّذ في نسخة عقد جديدة، ويقرؤها حينها
  // في «عقدي وراتبي». فيبقى المدخل لمن يراجع الرواتب فعلًا. (الشاشة نفسها لم تُقفل ولم يتغير تصريحها.)
  if(staff&&has('hr.compensation.review'))nav.push(['compensation','↗','مراجعة الرواتب','Compensation review']);
  // 3. الموارد البشرية — الأداء والتطوير
  if(staff)nav.push(['performance','◆','تقييم الأداء','Performance']);
  if(has('portal.use')&&staff)nav.push(['review-360','↻','تقييم 360','360 review']);
  if(staff)nav.push(['growth','✦','التدريب والتطوير','Training & growth']);
  // 4. العملاء والحملات — العملاء والمبيعات
  if(delivery)nav.push(['clients','◍','العملاء','Clients']);
  // بلاغات العملاء بعد البيع (P4-CRM-5): لفريق الحساب، والخادم يحصر ما يراه كل حساب بعضويته.
  if(delivery)nav.push(['client-support','☏','دعم العملاء','Client support']);
  if(has('commercial.use')&&staff)nav.push(['pipeline','▽','خط الفرص','Pipeline'],['estimates','▦','التقديرات والأسعار','Estimates & rates']);
  // تسعير المشاريع (ترحيل 108): الورقة والاستثناء والعرض، لحامل تصريح التسعير أو صاحب قرار الاستثناء.
  if(staff&&(has('pricing.sheets.use')||has('pricing.exception.approve')))nav.push(['pricing','▤','تسعير المشاريع','Project pricing'],['margin-exceptions','◇','استثناءات التسعير','Pricing exceptions'],['quotations','◫','عروض الأسعار','Client quotations']);
  // التفويض المالي (تدقيق 20260920، B4): لحامل تصريح المنح وحده، فلا يدخل قائمة الموظف العادي.
  if(has('finance.grants.manage'))nav.push(['finance-grants','⚿','التفويض المالي','Finance delegations']);
  // الانتداب وبدلاته (ترحيل 112): شاشة إدارية لمن يعتمد سياسات الموارد البشرية أو يسجّل الدرجات.
  if(has('hr.policy.accept')||has('hr.policy.prepare')||has('people.manage'))nav.push(['secondment','✈','الانتداب وبدلاته','Secondment allowances']);
  if(has('commercial.use'))nav.push(['commercial','◇','العملاء والعروض','Clients & proposals']);
  if(delivery)nav.push(['offerings','◈','الباقات','Offerings']);
  if(staff&&(has('approvals.record')||has('approvals.verify')))nav.push(['approvals','◉','موافقات العملاء','Client approvals']);
  if(has('commercial.use')&&staff)nav.push(['client-reports','▥','تقارير العملاء','Client reports']);
  // 4. العملاء والحملات — الحملات والإعلام
  if(delivery)nav.push(['campaigns','◎','الحملات','Campaigns'],['content','▧','تقويم المحتوى','Content calendar']);
  if(has('commercial.use')&&staff)nav.push(['media-spend','◍','الصرف الإعلامي','Media spend']);
  if(has('influencers.manage'))nav.push(['influencers','★','المؤثرون','Influencers']);
  if(has('influencers.manage')&&staff)nav.push(['influencer-campaigns','∞','ارتباطات المؤثرين','Influencer engagements']);
  if(has('pr.manage'))nav.push(['pr','♪','العلاقات العامة','Public relations'],['media-contacts','▤','جهات الإعلام','Media contacts']);
  // 5. المشاريع والإنتاج — المشاريع
  if(has('projects.use'))nav.push(['projects','▧','المشاريع والمهام','Projects & tasks']);
  if(has('projects.use'))nav.push(['project-participation','⇄','مشاركة الإدارات','Department participation']);
  // مسار المشاريع (الموجة 5 «سلسلة المشروع»): المراحل الثمان والخطوة الجاية وعند مين، وحزم العمل بأزرار القارئ.
  if(has('projects.use'))nav.push(['project-spine','⇶','مسار المشاريع','Project spine']);
  // النماذج الإلكترونية (ترحيل 107): نماذج المشاريع والتسليم. تبقى خارج قائمة الموظف العادي القصيرة (101):
  // يصلها من فريق مشروعه أو عميله، أو بتصريح إعداد التعريفات أو قبولها. رابط المشروع يفتحها له على كل حال.
  if(((!plain||delivery)&&has('forms.fill'))||['forms.design','forms.accept'].some(has))nav.push(['forms','▤','النماذج الإلكترونية','Electronic forms']);
  if(delivery)nav.push(['project-templates','▨','قوالب المشاريع','Project templates'],['scope','◬','حارس النطاق','Scope guard']);
  // سلسلة استلام المشروع: BD-04 ثم PM-01 وبوابتها ثم PM-02 وPM-03 (ترحيل 109)
  if(delivery)nav.push(['project-handover','⇨','محضر تسليم المشروع','Project handover'],['project-receipt','☑','استلام المشروع وبوابته','Project receipt'],['project-kickoff','◍','محضر الانطلاق','Kickoff minutes'],['change-requests','⇄','طلبات التغيير','Change requests']);
  if(has('resourcing.view')&&staff)nav.push(['resourcing','♙','خطة الموارد','Resource plan']);
  if(has('portal.use')&&staff)nav.push(['timesheets','◷',has('timesheets.approve')?'اعتماد الساعات':'كشفي الأسبوعي',has('timesheets.approve')?'Timesheet approval':'My weekly timesheet']);
  // 5. المشاريع والإنتاج — الاستوديو والإنتاج
  if(has('studio.use'))nav.push(['studio','✧','الاستوديو والتسليم','Studio']);
  if(has('review.manage'))nav.push(['review-rounds','↻','جولات المراجعة','Review rounds']);
  if(has('production.manage'))nav.push(['productions','▶','الإنتاج والتصوير','Production & shoots']);
  if(staff&&(!plain||delivery))nav.push(['call-sheets','☷','أوراق الاستدعاء','Call sheets'],['equipment','◙','المعدات وحجزها','Equipment & bookings']);
  // 6. المالية — المشتريات والموردون
  if(has('procurement.use')||has('finance.use'))nav.push(['procurement','▦','المشتريات والتحقق المالي','Procurement & finance checks']);
  if(has('procurement.use')||has('vendors.legal'))nav.push(['procurement-extras','⇅','الشراء الطارئ والتعديلات','Emergency buys & changes']);
  if(['vendors.view','vendors.assess','vendors.manage','vendors.legal','vendors.bank'].some(has))nav.push(['vendors','◈','الموردون','Vendors']);
  if(['contracts.register.view','contracts.register.manage'].some(has))nav.push(['contracts-register','✍','سجل العقود','Contracts register']);
  // 6. المالية — الإيرادات والتحصيل
  if(ledger)nav.push(['receivables','◩','مستحقات العملاء','Customer receivables'],['invoices','▣','الفواتير الضريبية','Tax invoices']);
  if(has('billing.recurring.manage'))nav.push(['billing-schedules','↻','الفوترة الدورية','Recurring billing'],['retainers','◫','اتفاقات الاشتراك','Retainer agreements']);
  if(has('einvoice.manage'))nav.push(['einvoice','▩','الفوترة الإلكترونية','E-invoicing']);
  // 6. المالية — المدفوعات والنقد
  if(ledger)nav.push(['payables','▭','مدفوعات الموردين','Supplier payments']);
  if(['bank.reconcile','bank.reconcile.approve'].some(has))nav.push(['bank-reconciliation','⌂','المطابقة البنكية','Bank reconciliation']);
  if(has('finance.forecast.view'))nav.push(['cash-forecast','↗','التنبؤ النقدي','Cash forecast']);
  // 6. المالية — الدفتر والإقفال
  if(ledger)nav.push(['finance','▥','الدفتر المالي','Ledger'],['statements','▨','القوائم المالية','Financial statements']);
  if(has('finance.close.manage'))nav.push(['accruals','≡','الإطفاء والاستحقاقات','Amortisation & accruals'],['close-checklist','⚿','الإقفال الشهري','Month-end close']);
  // الاستثناءات المالية (الحزمة 3): لمن يقرأ الدفتر، وهو شرط الخادم نفسه في finance-exceptions.mjs.
  if(ledger)nav.push(['finance-exceptions','⚑','الاستثناءات المالية','Finance exceptions']);
  // الخيارات والقيم المعتمدة: لمن يقرر قيمة أو يدير قائمة، ولمسؤول المنصة الأعلى — شرط canSeeOptions في app/options.mjs بتصاريحه.
  if(['vendors.manage','vendors.bank','finance.use','finance.close.manage','procurement.use'].some(has)||(me.admin_level==='super'&&!me.view_as))nav.push(['options','⚙','الخيارات والقيم المعتمدة','Options & adopted values']);
  if(ledger)nav.push(['assets','▦','الأصول الثابتة','Fixed assets']);
  if(has('budgets.use')||me.capabilities?.finance)nav.push(['budgets','◔','مخصصات المشاريع','Project budgets']);
  // 6. المالية — الضرائب والربحية
  if(taxTeam)nav.push(['vat-worksheet','٪','القيمة المضافة والزكاة','VAT & zakat'],['withholding','◍','ضريبة الاستقطاع','Withholding tax']);
  if(has('profitability.view'))nav.push(['profitability','▥','الربحية','Profitability']);
  if(has('costing.manage'))nav.push(['cost-rates','◷','معدلات التكلفة','Cost rates']);
  // 7. القيادة والحوكمة — القيادة
  if(has('executive.view'))nav.push(['executive','◱','اللوحة التنفيذية','Executive board']);
  if((staff&&(!plain||delivery))||has('executive.view'))nav.push(['reports','▤','مركز التقارير','Reports']);
  // تقرير الإدارة التنفيذية للمشاريع (ترحيل 118): يُعدّه حامل تصريح EPMO، ويقرؤه حامل تصريح اللوحة التنفيذية.
  if(['epmo.review','executive.view'].some(has))nav.push(['epmo','◳','تقرير الإدارة التنفيذية للمشاريع','EPMO report']);
  if(governance)nav.push(['objectives','◎','الأهداف والمبادرات','Objectives & initiatives'],['decisions','✍','القرارات والمحاضر','Decisions & minutes']);
  if(has('org.view'))nav.push(['org','⛬','الهيكل التنظيمي','Org structure']);
  if(has('org.view')&&!plain)nav.push(['centres','❖','المراكز التخصصية','Specialised centres']);
  // 7. القيادة والحوكمة — المخاطر والامتثال
  if(governance)nav.push(['risks','△','سجل المخاطر','Risk register']);
  if((staff&&!plain)||has('compliance.manage'))nav.push(['compliance','◷','تقويم الالتزامات','Compliance calendar']);
  if(has('privacy.manage'))nav.push(['privacy','⛨','حماية البيانات','Data protection'],['subject-requests','♗','طلبات أصحاب البيانات','Data subject requests']);
  // 8. إدارة المنصة
  if(has('accounts.manage'))nav.push(['accounts','♟','الموظفون والصلاحيات','Employees & access']);
  // مصفوفة الصلاحيات (ترحيل 130): يفتحها الأدمن الأول، ويفتحها أدمن الإدارة على أعضاء إدارته وحدهم.
  // البوابة هي بوابة الشاشة نفسها حرفًا بحرف (app/department-levels.mjs matrix): امتياز الأدمن الأول
  // أو تصريح ضبط المستويات. لا accounts.manage — «أدمن محدد» يحمله ولا تفتح له الشاشة، فكان يرى المدخل
  // في القائمة ويأخذ 403 في كل مرة.
  if(me.admin_level==='super'||has('department.levels.manage'))nav.push(['permissions-matrix','◫','مصفوفة الصلاحيات','Permission matrix']);
  if(has('platform.flags'))nav.push(['platform-health','◈','مركز تشغيل المنصة','Platform operations centre']);
  if(has('access.manage')||has('accounts.manage')||me.role==='manager')nav.push(['access-reviews','◉','مراجعة الصلاحيات','Access reviews']);
  if(has('integrations.view'))nav.push(['integrations','⇄','حالة التكاملات','Integration status']);
  if(has('ai.govern'))nav.push(['ai-governance','▣','حوكمة المساعدين','Assistant governance']);
  if(has('platform.flags'))nav.push(['jobs','≣','المهام الخلفية','Background jobs'],['feature-flags','◐','مفاتيح الميزات','Feature flags'],['mail','✉','البريد والإشعارات','Mail & notifications']);
  if(has('requirements.view'))nav.push(['requirements','◎','نطاق المنصة','Platform scope']);
  // سجل التعريفات (ترحيل 123): نسخ تعريف كل صفحة، وما ينتظر ناشرًا ثانيًا، والنقل بين بيئتين، وسجل «جرّب كمستخدم».
  if(has('definitions.configure')||has('definitions.publish'))nav.push(['definitions','▤','تعريفات الصفحات','Page definitions']);
  navItems=nav;navReach=nav;globalThis.navReach=nav;globalThis.navMe=me;
  document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
  // ت1: مداخل القائمة بترتيب ثابت (البرومبت §2.1) وبلا «أخرى». كل مدخل بشرط شاشته في الكتلة أعلاه فلا مدخل لما لا يصله الحساب؛
  // «فريقي» للمدير و«إدارة المنصة» للأدمن كما في nav-map.mjs، و«الإدارات» مدخل إدارة الحساب وحدها (بعد-ب) ولا مدخل لإدارة بلا صفحة (ops).
  const own=ownDepartment();
  // ت2 (موجز المالك 30 سبتمبر 2026، البند 6): القائمة أقسامٌ ثمانية ثابتة الأسماء والترتيب، يبنيها navSections
  // من «ما يصله الحساب» (nav أعلاه) وحده — فالأقسام تسمّي مواضع ولا تمنح وصولًا ولا تمنعه. والقسم الفارغ لا صفّ له.
  navSectionRows=typeof navSections==='function'
    ?navSections(nav,me,{departments:own?[[own,departmentNames?.[own]||tr('إدارتي','My department')]]:[]}):[];
  const side=navSectionRows.map(row=>[row.route,row.glyph,tr(row.label,row.label_en),'']);
  // شاشة بلا مدخل تُعلِّم مدخل موضعها (aria-current="true")، والتبويبان يعلّمان مدخل شاشتهما الأم. صفحة الإدارة مدخلها «#departments/<id>».
  const hiddenTitle=operationModules[view]?.title,navView={annotations:'review-rounds','einvoice-selfcheck':'einvoice'}[view]||view;
  const sideKey=view==='section'?navRoute:view==='departments'&&navRoute.split('/')[1]?'departments/'+decodeURIComponent(navRoute.split('/')[1]):navView;
  // العنوان: اسم المدخل، وإلا التسمية الثابتة من placeFor لهذا الحساب (B13 صار ثابتًا لكل عدسة)، وإلا عنوان الوحدة.
  const current=side.find(s=>s[0]===sideKey)?.[2]||screenTitle(view)||(hiddenTitle?tr(hiddenTitle,hiddenTitle):tr('تفاصيل الطلب','Request details')),initial=e(nameInitial(me.name));
  const navHtml=groupedNavigation(side,sideKey,e,{reach:nav.map(([key,icon,ar,en])=>[key,icon,tr(stableLabel(key,ar),en)]),parent:navParent(navView),
    names:{mine:tr('مساحتي','My space'),depts:tr('الإدارات','Departments'),reach:tr('كل شاشاتك','All your screens')}});
  // الجوال: شريط علوي شفاف بعنوان يظهر عند التمرير، وشريط تبويب سفلي، وقائمة كاملة في صفيحة من الأسفل.
  // سطح المكتب: الصفيحة نفسها شريط جانبي ثابت بمادة شفافة. الربط والحركة في signature.mjs.
  const accountRow=(action,icon,tint,label,value='',cls='',attrs='')=>`<button type="button" class="nav-row${cls}" data-action="${action}"${attrs}><span class="nav-icon tint-${tint}" aria-hidden="true">${glyph(icon)}</span><span class="nav-label">${label}</span>${value?`<span class="nav-value">${value}</span>`:''}</button>`;
  // «جرّب كمستخدم»: شريط أحمر دائم ما دامت التجربة جارية. الخادم هو من يرفض كل كتابة؛ الشريط يقول ذلك ويحمل زر الإنهاء.
  const trial=me.view_as?`<div class="view-as-banner" role="status"><strong>${tr('جرّب كمستخدم','Trying as a user')}: ${e(me.view_as.persona_name)}</strong><span class="view-as-long">${tr('قراءة فقط · بهويتك أنت: فريقك ومشاريعك تبقى، وكل إجراء يرفضه الخادم. بعض الشاشات قد تعرض أكثر مما يراه صاحب هذا الدور فعلًا. ما تفتحه يُسجَّل باسمك.','Read-only · as yourself: your team and projects remain, and the server refuses every action. Some screens may show more than this role really sees. What you open is recorded under your name.')}</span><span class="view-as-short">${tr('قراءة فقط · بهويتك أنت · يُسجَّل باسمك','Read-only · as yourself · recorded')}</span><button type="button" data-action="view-as-stop">${tr('إنهاء التجربة','End the trial')}</button></div>`:'';
  root.innerHTML=`<div class="shell">${trial}<aside class="sidebar" id="app-sidebar" aria-label="${tr('القائمة','Menu')}"><div class="side-head"><div class="brand">${brandLogo}</div><h2 class="side-title">${tr('الفهرس','Index')}</h2><button type="button" class="side-done" data-shell="drawer-close">${tr('إغلاق','Close')}</button></div><div class="side-profile"><span class="avatar" aria-hidden="true">${initial}</span><div><strong>${e(me.name)}</strong><small>${e(termOr('role.'+me.role,tr(...roleNames[me.role])))}</small></div></div><label class="nav-search-label">${glyph('search')}<input class="nav-search" id="nav-search" type="search" autocomplete="off" enterkeyhint="search" placeholder="${tr('ابحث عن شاشة…','Find a screen…')}" aria-label="${tr('بحث في الشاشات','Search screens')}"></label><nav class="nav" aria-label="${tr('التنقل الرئيسي','Main navigation')}">${navHtml}</nav><section class="side-account" aria-label="${tr('الحساب','Account')}"><p class="hr-nav-label">${tr('الحساب','Account')}</p><div class="hr-nav-rows">${accountRow('theme','theme','indigo',tr('الوضع','Mode'),themeName())}${accountRow('design','design','teal',tr('التصميم','Design'),designName(),'',' aria-haspopup="menu" aria-expanded="false"')}${accountRow('language','language','blue',tr('اللغة','Language'),lang==='ar'?'العربية':'English')}${accountRow('change-password','key','gray',tr('كلمة المرور','Password'))}${has('access.view_as')&&!me.view_as?accountRow('view-as','search','indigo',tr('جرّب كمستخدم','Try as a user')):''}${accountRow('logout','logout','red',tr('تسجيل الخروج','Sign out'),'',' is-destructive')}</div></section><p class="side-note"><span class="status-dot" aria-hidden="true"></span>${e(envBadge?.name??tr('التشغيل','Local'))}</p></aside><div class="side-scrim" data-shell="drawer-close" aria-hidden="true"></div><div class="stage"><header class="topbar"><a class="brand" href="#home" aria-label="${tr('3,6T — الرئيسية','3,6T — Home')}">${brandLogo}</a><button type="button" class="top-btn top-avatar" data-shell="drawer" aria-controls="app-sidebar" aria-expanded="false" aria-label="${tr('الفهرس والحساب','Index and account')}"><span class="avatar">${initial}</span><span class="top-index-label">${tr('الفهرس','Index')}</span></button><div class="topbar-title" aria-hidden="true">${e(current)}</div><button type="button" class="top-btn top-search" data-shell="search" aria-label="${tr('بحث في الشاشات والخدمات','Search screens and services')}">${glyph('search')}<span class="top-search-text">${tr('ابحث عن شاشة أو خدمة','Search screens and services')}</span><kbd>⌘K</kbd></button></header><main id="main" class="page" tabindex="-1"><div class="loading">${tr('جارٍ التحميل…','Loading…')}</div></main></div></div>`;
}
// تغيّر الشاشة يُعلن (better-accessibility): عنوان النافذة يحمل اسم الشاشة، والتركيز ينتقل إلى عنوانها عند الانتقال بين الشاشات —
// لا في الرسم الأول، ولا عند إعادة رسم الشاشة نفسها بعد حفظ، ولا والنافذة مفتوحة.
let lastRoute='';
function settleView(route){
  const main=document.querySelector('#main'),h1=main?.querySelector?.('h1'),name=String(h1?.textContent??'').trim();
  if(name)document.title=`${name} | 3,6T`;
  const moved=lastRoute&&lastRoute!==route;lastRoute=route;
  if(!moved||dialog?.open||typeof h1?.focus!=='function')return;
  if(!h1.hasAttribute?.('tabindex'))h1.setAttribute?.('tabindex','-1');
  h1.focus({preventScroll:true});
}
async function render(){
  if(!me)return loginView();
  if(me.must_change_password)return passwordView(true);
  leaveFirstPaint();
  operationData=null;operationView=null;
  // ت1: جدول الأسماء البديلة (routeAlias). العنوان يُعاد كتابته بـreplaceState فيقول الوجهة الجديدة،
  // وhash يبقى كما وصل: #catalog/new نيةٌ تقرؤها followDeepLink بعد رسم «الخدمات» فتفتح نافذة الطلب كما كانت.
  const turn=++renderId;const hash=location.hash.slice(1)||'home';let route=typeof parseFocus==='function'?parseFocus(hash).path:hash;
  const moved=routeAlias(route);if(moved){route=moved.route;try{history.replaceState(null,'','#'+route+(hash.includes('?')?hash.slice(hash.indexOf('?')):''));}catch{}}
  view=route.split('/')[0];navRoute=route;shell();
  // شارة «بانتظار إجرائي»: عدد حي من الخادم، ولا يوقف فشله الصفحة. هي الشارة الوحيدة في القائمة (ت1)؛ عدد الإشعارات غير المقروءة
  // يبقى في html[data-unread] لمن يقرؤه، ولا يُلصق بمدخل.
  api('/inbox/count').then(c=>{document.documentElement.dataset.inbox=String(c.total);for(const a of document.querySelectorAll('a[href="#work"],a[href="#inbox"]')){a.querySelector('.nav-count')?.remove();if(c.total){const b=document.createElement('span');b.className='nav-count'+(c.late?' is-late':'');b.textContent=String(c.total);a.append(b);}}}).catch(()=>{});
  api('/notifications/count').then(c=>{document.documentElement.dataset.unread=String(c.unread);}).catch(()=>{});
  // اسم إدارة الحساب لمدخل «الإدارات»: me لا يحمله، فيُقرأ مرة من /departments ويُكتب في المدخل. فشله يُبقي «إدارتي».
  const own=ownDepartment();
  if(own&&!departmentNames)api('/departments').then(list=>{departmentNames=Object.fromEntries((Array.isArray(list)?list:[]).map(d=>[d.id,d.name]));const name=departmentNames[own];if(!name)return;
    for(const a of document.querySelectorAll('.nav a'))if(a.getAttribute('href')==='#departments/'+own){const label=a.querySelector('.nav-label');if(label)label.textContent=name;}}).catch(()=>{});
  try{
    const loadedServices=await api('/catalog');if(turn!==renderId)return;services=loadedServices;let html='';
    // لقطة سجل التعريفات بجوار الدليل: محجوبة لهذا الحساب على الخادم، و«لم تتغير» حين لا جديد. فشلها لا يوقف الصفحة.
    if(typeof loadSnapshot==='function'){await loadSnapshot(api);if(turn!==renderId)return;}
    // ت1: الصفحات الجامعة (#team و#organization و#platform) تسرد ما وضعه placeFor فيها من شاشات هذا الحساب. لا نداء خادم: كل رابط شاشة
    // كان الحساب يصلها قبل ت1، وفتحها يمر بفحص الخادم كما كان. تُفتح بالرابط لكل حساب، وتقول «لا شاشة هنا» لمن لا شاشة له فيها.
    // حساب لا يصل شاشة «ملفي» نفسها (الأدمن: ليس موظفًا) وله شاشات موضعها «ملفي» (أمان حسابي، المظهر…) يرى أقسامها وحدها، ولا تُحمَّل له شاشة الملف.
    if(typeof hubPage==='function'&&(HUB_VIEWS.includes(view)||view==='profile'&&!navReach.some(n=>n[0]==='profile'))){
      const hub=HUB_OF[view],title=typeof HUBS==='object'?HUBS[hub].label:view;
      const about={profile:['إعدادات حسابك وما يخصك من شاشات.','Your account settings and your own screens.'],team:['شاشات فريقك: أعضاؤه، وإجازاتهم وحضورهم، وما ينتظر اعتمادك منهم.','Your team’s screens: members, leave and attendance, and what waits for your approval.'],
        org:['ما يخص الشركة كلها: الهيكل، والسياسات، والإعلانات.','What concerns the whole company: structure, policies and announcements.'],
        admin:['إعداد المنصة وتشغيلها: الحسابات والصلاحيات، ودليل الخدمات، والتكاملات.','Setting up and running the platform: accounts and access, the service catalog, integrations.']}[hub];
      html=pageHead(tr(title,{profile:'My profile',team:'My team',org:'Organisation',admin:'Platform administration'}[hub]),tr(...about))+hubPage(hub,placedIn(hub),{e,tr,emptyText:tr('لا شاشة لحسابك في هذا القسم. ابدأ من «الخدمات» أو من «ابحث عن شاشة».','Your account has no screen in this section. Start from Services or Find a screen.')});
    // ت2: صفحة القسم تسرد ما وضعته nav-map في هذا القسم من شاشات هذا الحساب، بمجموعاته. لا نداء خادم ولا قرار وصول هنا.
    // حلقةٌ في هذه السلسلة لا قبلها: تعليقها بـelse على «if(typeof loadSnapshot…)» المستقلّ فوقها كان يقطع
    // السلسلة كلها حين تتحقق تلك الجملة — فلا تُرسم وحدةٌ ولا صفحةٌ جامعة، وهو ما أسقط اختبارات الاستوديو.
    }else if(view==='section'){
      const row=navSectionRows.find(r=>r.route===navRoute)??(typeof SECTIONS==='object'?SECTIONS.find(sx=>'section/'+sx.id===navRoute):null);
      const entries=row?.entries??[];
      html=pageHead(tr(row?.label??'القسم',row?.label_en??'Section'),tr('شاشات هذا القسم المتاحة لحسابك.','The screens in this section your account can open.'))
        +(typeof hubPage==='function'?hubPage(view,entries,{e,tr,groups:row&&typeof sectionGroups==='function'?sectionGroups(row.id,entries):[],emptyText:tr('لا شاشة لحسابك في هذا القسم. ابدأ من «الخدمات» أو من «ابحث عن شاشة».','Your account has no screen in this section. Start from Services or Find a screen.')}):'');
    }else if(operationModules[view]){
      const module=operationModules[view],loaded=await module.load(api);if(turn!==renderId)return;
      operationData=loaded;operationView=view;
      const button=(action,id,label)=>`<button class="btn outline small" data-action="operation" data-module="${e(view)}" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
      // B13 ثابتًا (ت1): العنوان تسمية الشاشة لهذا الحساب من placeFor — اسم واحد للشاشة في كل عدسة، سواء أكان لها مدخل في القائمة أم لا
      // (الوجه الشخصي «إجازاتي»، وعدسة المدير «إجازات فريقي»، وعدسة الموارد البشرية «إجازات الموظفين»).
      const heading=screenTitle(view)||tr(module.title,module.title_en||module.title);
      // صف روابط الموضع تحت رأس الصفحة وفوق محتواها كما كان: أقسام «ملفي» (بياناتي، عقدي وراتبي، قسائمي، مزاياي، خطاباتي، مخالفاتي،
      // وقتي، مشاركتي، إعدادات الحساب)، و«مهامي» في «بانتظار إجرائي»، و«مصروفاتي وعهدي» في «طلباتي». سياق render للوحدة لا يتغير (kit.test).
      const links=hubRow(view);
      // «تعديل هذه الصفحة»: لحامل تصريح تعديل التعريفات وحده، وعلى شاشة يربطها الخادم بكيان يعمل عليه هذا الحساب. الخادم يعيد الفحص عند كل نداء.
      const editable=typeof editableEntities==='function'&&(me.can||[]).includes('definitions.configure')&&!me.view_as?editableEntities(view):[];
      const editAction=editable.length?`<button type="button" class="btn outline" data-action="page-editor">${tr('تعديل هذه الصفحة','Edit this page')}</button>`:'';
      const previewNote=typeof isPreviewing==='function'&&isPreviewing()?`<p class="notice pe-preview-note" role="status">${tr('معاينة مسودة — لا يراها غيرك. ما تراه هنا لم يُنشر بعد، والخادم لا يقبل قيمة لحقل لم يُنشر.','Draft preview — only you see it. Nothing here is published yet.')}</p>`:'';
      const head=pageHead(heading,tr(module.description,module.description_en||module.description),editAction);
      const body=`<div class="operations">${previewNote}${module.render(loaded,{e,button,money,tr,lang,date,ui:uiKit})}</div>`;
      html=typeof composeOperationPage==='function'?composeOperationPage({head,links,body,profile:view==='profile'}):head+links+body;
    }else if(view==='executive'){
      const data=await api('/executive');if(turn!==renderId)return;
      html=executiveCockpitUI.render(data,{e});
    }else if(view==='platform-health'){
      const data=await api('/platform-health');if(turn!==renderId)return;
      html=adminCockpitUI.render(data,{e});
    }else if(view==='org'){
      const data=await api('/org');if(turn!==renderId)return;
      html=orgPage(data,{e});
    }else if(view==='work'){
      workData=await api('/work');if(turn!==renderId)return;
      html=workBoardView(workData,{e,date});
    }else if(view==='workspace'){
      const [,spaceId,requestedTool='tasks']=route.split('/'),tools=new Set(['tasks','boards','messages','chat','schedule','files','checkins','people','insights']);
      if(!/^[a-f0-9-]{36}$/.test(spaceId??'')||!tools.has(requestedTool))throw new Error('رابط مساحة العمل غير صالح');
      const [tasks,files,topics,chat,events,checkins,people,activity,report]=await Promise.all([
        api(`/spaces/${spaceId}/tasks`),api(`/spaces/${spaceId}/files`),api(`/spaces/${spaceId}/topics`),api(`/spaces/${spaceId}/chat?limit=100`),
        api(`/spaces/${spaceId}/events`),api(`/spaces/${spaceId}/check-ins`),api(`/spaces/${spaceId}/people`),api(`/spaces/${spaceId}/activity?limit=50`),api(`/spaces/${spaceId}/report`)
      ]);if(turn!==renderId)return;
      html=workspaceUI.render({space:tasks.space,active_tool:requestedTool,tasks,files,topics,chat,events,checkins,people,activity,report},{e,date,ui:uiKit});
    }else if(view==='portal'){
      const data=await api('/portal');if(turn!==renderId)return;
      html=portalPage(data,{e,date});
    }else if(view==='requests'){
      const rows=await api('/requests');if(turn!==renderId)return;
      html=pageHead(tr('الطلبات','Requests'),tr('الطلبات الظاهرة ضمن صلاحيات حسابك فقط.','Only requests available to your account appear here.'),newButton())+`<form id="request-filter" class="filters"><input name="q" aria-label="${tr('بحث في الطلبات','Search requests')}" placeholder="${tr('ابحث بعنوان الطلب أو رقمه…','Search by title or reference…')}"><select name="status" aria-label="${tr('الحالة','Status')}"><option value="">${tr('جميع الحالات','All statuses')}</option>${Object.keys(labels).map(s=>`<option value="${s}">${statusLabel(s)}</option>`).join('')}</select><button class="btn dark">${tr('بحث','Search')}</button></form><section class="panel" id="request-results">${table(rows)}</section>`;
    }else if(view==='departments'){
      // ت1: صفحة الإدارة #departments/<id>[/<قسم>] بأقسامها الخمسة (catalog-home-ui.mjs departmentPageView). #departments بلا إدارة
      // لا يبلغ هذا الفرع: اسمه البديل (ROUTE_ALIASES) يحوّله إلى #services/department. ما يُجلب للقسم الواحد مما يصل الحساب اليوم، ولمن هو من الإدارة أو يحمل أداةً فيها وحده.
      const parts=route.split('/'),id=decodeURIComponent(parts[1]||''),section=decodeURIComponent(parts[2]||'');
      const departmentsList=await api('/departments');await loadVariants();if(turn!==renderId)return;launcherDepartments=departmentsList;launcherState={selected:'',query:''};
      const {departmentPageView,departmentTools}=await import('./catalog-home-ui.mjs');
      // navReach/navMe: عقد القائمة (nav-map.mjs) — الشاشات التي يبلغها الحساب اليوم. غيابها = لا كتلة «أدوات الإدارة».
      const reach=Array.isArray(globalThis.navReach)?globalThis.navReach:null,navMe=globalThis.navMe??me;
      const full=me.department_id===id||!!departmentTools(reach,navMe,id)?.length;
      const quiet=path=>api(path).catch(()=>null);
      const [requestRows,orgChart,board]=full?await Promise.all([quiet('/requests'),quiet('/org'),quiet('/engagement/announcements')]):[null,null,null];
      if(turn!==renderId)return;
      html=departmentPageView({id,section,departments:departmentsList,services,variants:variantGroups,me:navMe,reach,requests:requestRows,org:orgChart,
        announcements:Array.isArray(board?.announcements)?board.announcements.filter(a=>a.publish_on<=board.today):null,e,ui:uiKit});
      // التبويب رابطٌ إلى موضع قسمه في الصفحة نفسها: بعد الرسم يُمرَّر إليه.
      if(section)setTimeout(()=>{if(turn===renderId)document.getElementById('dept-'+section)?.scrollIntoView?.({block:'start'});},0);
    }else if(view==='services'){
      // ثلاثة مسارات في شاشة واحدة: #services (الدليل) و#services/category/<فئة>[/<ترتيب>] و#services/<رمز>.
      // الرمز حروفٌ كبيرة و«category» صغيرة، فلا التباس بينهما. وت1: #services/department و#services/need (أو #services/lens/<عدسة>)
      // تفتح الباب بتلك العدسة لهذا الرسم وحده، ثم يعود العنوان إلى #services فتبقى أزرار العدسات تحفظ اختيار صاحبها كما كانت.
      const parts=route.split('/'),first=decodeURIComponent(parts[1]||''),asked=first==='lens'?decodeURIComponent(parts[2]||''):first;
      const lensOverride=['department','need'].includes(asked)?asked:null,segment=lensOverride?'':first;
      if(lensOverride){try{history.replaceState(null,'','#services');}catch{}}
      document.querySelector('#main').innerHTML=segment&&segment!=='category'?servicePageSkeleton():catalogSkeleton();
      // صفحة تتبع الرحلة #services/journey/<run_id> (الدفعة الرابعة): حالات الأبناء تُقرأ من الطلبات لحظة الفتح.
      if(segment==='journey'){
        const run=await api('/catalog/journey/'+encodeURIComponent(parts[2]||''));if(turn!==renderId)return;
        html=journeyRunView(run,{e,ui:uiKit});
      }else if(segment&&segment!=='category'){
        const page=await api('/catalog/service/'+encodeURIComponent(segment));if(turn!==renderId)return;
        html=servicePageView(page,{e,ui:uiKit});
      }else{
        catalogTree=await api('/catalog/tree');if(turn!==renderId)return;catalogQuery='';catalogExtra='';catalogCounts='';
        if(lensOverride)catalogTree.lens=lensOverride;
        if(segment==='category')html=categoryView(catalogTree,decodeURIComponent(parts[2]||''),decodeURIComponent(parts[3]||'tree'),{e,ui:uiKit});
        else{
          // ما يسكن لوح النتائج عند الفتح يُحفظ (catalogExtra) فيعود هو نفسه حين يُفرَّغ صندوق البحث — لا شبكة الحاجة تحت تبويب الإدارة.
          if(catalogTree.lens==='department'){
            // عدسة الإدارة (الافتراضية في ت1) ليست شاشة ثانية: هي launcherResults القائمة نفسها بروابط إلى صفحات الإدارات.
            const list=await api('/departments');await loadVariants();if(turn!==renderId)return;
            launcherDepartments=list;launcherState={selected:'',query:''};
            const {departmentLens,departmentLensCounts}=await import('./catalog-home-ui.mjs');
            catalogExtra=departmentLens({departments:list,services,me,e,modules:operationModules,variants:variantGroups});
            catalogCounts=departmentLensCounts({departments:list,services,variants:variantGroups});
          }
          // عدسة «حسب الرحلة» حيّة برحلة واحدة (الدفعة الرابعة): التعريف بخطواته، ورحلاتي، والسبع الباقيات مادّةً.
          else if(catalogTree.lens==='journey')catalogExtra=journeyLensView(catalogTree,{e,ui:uiKit});
          html=catalogHome(catalogTree,{e,ui:uiKit,extra:catalogExtra,counts:catalogCounts});
        }
      }
    }else if(view==='catalog'){
      const catalogDepartments=await api('/departments');await loadVariants();if(turn!==renderId)return;launcherDepartments=catalogDepartments;launcherState={selected:'',query:''};
      // باب مركز الخدمات لمن يطلب: عدسة الحاجة بجوار عدسة الإدارة، وهو باب الموظف العادي إليه ما دامت قائمته بلا مدخل له (انظر shell()).
      const centreLink=me.can?.includes('requests.use')?`<p class="notice"><a href="#services">${tr('الخدمات: ابحث بحاجتك بكلماتك، أو تصفّح بالإدارة أو بالفئات الثماني ←','Services: search in your own words, or browse by department or the eight categories ←')}</a></p>`:'';
      html='<a class="department-back" href="#services/department">الخدمات حسب الإدارة ←</a>'+pageHead(tr('دليل الخدمات','Service catalog'),tr('كل خدمات الشركة مرتبة حسب الإدارة والقسم.','Every company service, organised by department and section.'),me.role==='admin'?`<button class="btn primary" data-action="new-service">${tr('إعداد خدمة','Configure a service')}</button>`:newButton())+centreLink+catalogBrowser({departments:catalogDepartments,services,me,e,admin:!me.can?.includes('requests.use'),modules:operationModules,variants:me.role==='admin'?null:variantGroups});
      // B14: لا بطاقة لشاشة يرفضها الخادم لهذا الحساب؛ الموظف يرى شاشات خدمته الذاتية، ومن يملك التصريح يرى شاشة فريقه.
      const specialised=[['leave',has=>has('leave.use')],['letters',()=>true],['expenses',()=>true],['attendance',()=>true],['commercial',has=>has('commercial.use')],['procurement',has=>has('procurement.use')],['people',has=>has('people.manage')],['studio',has=>has('studio.use')]]
        .filter(([key,ok])=>operationModules[key]&&ok(k=>(me.can||[]).includes(k))).map(([key])=>key);
      if(me.role!=='admin'&&specialised.length)html+=`<h2 class="mt">${tr('شاشات الخدمة الذاتية','Self-service screens')}</h2><div class="service-grid">${specialised.map(key=>{const n=navItems.find(x=>x[0]===key);return `<article class="service"><h2>${e(n?tr(n[2],n[3]):operationModules[key].title)}</h2><p>${e(tr(operationModules[key].description,operationModules[key].description_en||operationModules[key].description))}</p><a class="btn outline small" href="#${key}">${tr('فتح الشاشة','Open the screen')}</a></article>`;}).join('')}</div>`;
    }else if(view==='request'){
      const r=await api('/requests/'+encodeURIComponent(route.split('/')[1]));if(turn!==renderId)return;requestDetail=r;
      html=pageHead(r.title,`${serviceName(r.service)} · ${r.revision?`${tr('النسخة المقدمة','Submitted revision')} ${r.revision}`:tr('مسودة لم تُقدَّم بعد','Draft, not submitted yet')} · ${tr('المرجع','Reference')} ${r.id.slice(0,8).toUpperCase()}`,`${clockChip(r)}<a class="btn outline" href="#requests">${tr('العودة للطلبات','Back to requests')}</a>`)+`<div class="details-grid"><div><section class="panel"><div class="panel-head"><h2>${tr('تفاصيل الطلب','Request details')}</h2>${badge(r.status)}</div><div class="panel-body"><div class="muted">${e(r.requester_name)} · ${e(date(r.created_at))}</div><dl class="detail-data">${r.service.fields.map(f=>`<div><dt>${e(f.label)}</dt><dd>${e(fieldValue(f,r.payload[f.key]))}</dd></div>`).join('')}</dl>${r.actions.includes('edit')?`<button class="btn outline small" data-action="edit-request">${tr('تعديل المسودة','Edit draft')}</button>`:''}<p class="subtle">${tr('المرجع الكامل','Full reference')}: <span class="ltr">${e(r.id)}</span></p></div></section><section class="panel"><div class="panel-head"><h2>${tr('المرفقات','Attachments')}</h2>${r.actions.includes('attach')?`<button class="btn outline small" data-action="attach">${tr('إضافة ملف','Add a file')}</button>`:''}</div><div class="panel-body">${r.attachments.length?r.attachments.map(a=>`<div class="file"><div><span><bdi>${e(a.filename)}</bdi></span><small> · ${Math.ceil(a.size/1024)} KB</small></div><a href="/api/attachments/${e(a.id)}">${tr('تنزيل','Download')}</a></div>`).join(''):`<p class="muted">${tr('لم تُضف مرفقات.','No attachments yet.')}</p>`}<p class="subtle">${tr('TXT أو PDF أو PNG، حتى 2 ميغابايت.','TXT, PDF or PNG, up to 2 MB.')}</p></div></section><section class="panel"><div class="panel-head"><h2>${tr('سجل المعاملة','Activity record')}</h2><small>${tr(countNoun(r.audit.length,'event'),countEn(r.audit.length,'event'))}</small></div><div class="panel-body timeline">${r.audit.map(a=>`<div class="timeline-item"><strong>${e(actionLabel(a.action))}</strong><small><time datetime="${e(a.created_at)}">${e(dateTime(a.created_at))}</time> · ${e(a.actor_name||'')}</small>${a.reason?`<p>${e(a.reason)}</p>`:''}</div>`).join('')}${r.versions.map(v=>`<details><summary>${tr('النسخة المقدمة','Submitted revision')} ${v.revision} · ${dateTime(v.created_at)}</summary><p class="subtle">${e(v.snapshot.title)} · ${tr('إصدار الخدمة','Service version')} ${e(v.snapshot.service_version)}</p><dl class="detail-data">${r.service.fields.map(f=>`<div><dt>${e(f.label)}</dt><dd>${e(v.snapshot.payload[f.key]||'—')}</dd></div>`).join('')}</dl><p class="subtle">${tr('مرفقات هذه النسخة:','Files in this revision:')} ${(v.snapshot.attachments||[]).map(f=>e(f.filename)).join('، ')||'—'}</p></details>`).join('')}</div></section></div><div>${feedbackPanel(r,{e})}${workflowPanel(r)}${executionPanel(r)}${routingPanel(r)}${serviceOutputPanel(r)}<section class="panel"><div class="panel-head"><h2>${tr('الخطوة التالية','Next step')}</h2></div><div class="panel-body">${r.actions.filter(a=>actionNames[a]&&(a!=='complete'||r.delivery_outputs?.closure_ready!==false)).map(a=>`<button class="btn ${a==='approve'||a==='submit'?'dark':a==='reject'||a==='cancel'?'danger':'outline'}" data-action="transition" data-transition="${a}">${e(actionLabel(a))}</button>`).join(' ')||`<p class="muted">${tr('لا توجد خطوة مسندة إليك الآن.','No action is assigned to you now.')}</p>`}<p class="subtle">${tr('الاعتماد الداخلي مستقل عن التنفيذ أو أي إجراء رسمي خارجي.','Internal approval is separate from execution or an external official action.')}</p></div></section><section class="panel"><div class="panel-head"><h2>${tr('مسار الاعتماد','Approval route')}</h2></div><div class="journey">${r.approvals.filter(a=>a.revision===r.revision).map(a=>`<div class="journey-step"><span class="step-no">${a.position+1}</span><div><strong>${e(a.approver_name)}</strong>${badge(a.status)}${a.delegation_id?`<small>بالنيابة: ${e(a.decided_by_name)}</small>`:''}${(r.escalations||[]).filter(x=>x.step_id===a.id).map(x=>`<small>${tr('نُقل القرار إلى','Decision moved to')} ${e(x.to_name)} — ${e(x.basis_label)}</small>`).join('')}${a.note?`<p class="subtle">${e(a.note)}</p>`:''}</div></div>`).join('')||`<p class="muted">${tr('يتحدد المسار عند التقديم.','The route is assigned on submission.')}</p>`}</div></section></div></div>`;
    }else if(view==='projects'){
      const loadedProjects=await api('/projects');if(turn!==renderId)return;projectList=loadedProjects;
      html=pageHead(tr('المشاريع والمهام','Projects & tasks'),tr('فريق محدد، ومهام لها مواعيد ومعايير قبول.','Named members, due dates and acceptance criteria.'),['manager','pm'].includes(me.role)?`<button class="btn primary" data-action="new-project">${tr('مشروع جديد','New project')}</button>`:'')+(projectList.length?projectList.map(p=>`<article class="panel project-card"><div class="project-top"><div><h2>${e(p.name)}</h2><p>${e(p.brief)}</p></div>${p.can_manage?`<button class="btn outline small" data-action="new-task" data-id="${e(p.id)}">${tr('إسناد مهمة','Assign a task')}</button>`:''}<a class="btn outline small" href="#project-participation?focus=${e(p.id)}">${tr('مشاركة الإدارات','Department participation')}</a><a class="btn outline small" href="#forms?project_id=${e(p.id)}">${tr('نماذج المشروع','Project forms')}</a></div><small>${p.members.map(m=>e(m.name)).join('، ')}</small><div class="task-list">${p.tasks.map(t=>`<div class="task ${t.status}"><span class="square">${t.status==='completed'?'✓':''}</span><div class="task-info"><strong>${e(t.title)}</strong><p>${e(t.acceptance)}</p><small>${e(t.assignee_name)} · ${e(t.due_date)}</small>${t.evidence?`<p>${tr('دليل الإنجاز:','Evidence:')} ${e(t.evidence)}</p>`:''}</div>${t.status==='open'&&t.assignee_id===me.id?`<button class="btn outline small" data-action="complete-task" data-id="${e(t.id)}" data-version="${t.version}">${tr('إكمال','Complete')}</button>`:badge(t.status==='open'?'in_progress':'completed')}</div>`).join('')||`<p class="muted">${tr('لم تُسند مهام بعد.','No tasks assigned yet.')}</p>`}</div></article>`).join(''):`<section class="panel">${empty(tr('لا توجد مشاريع مسندة إليك','No projects assigned to you'),tr('ينشئ مدير الفريق مشروعًا ويضيف أعضاءه.','A team manager can create a project and add its members.'))}</section>`);
    }else if(view==='notifications'){
      const notes=await api('/notifications');if(turn!==renderId)return;
      html=pageHead(tr('الإشعارات','Notifications'),tr('تحديثات مسارات العمل التي تشارك فيها.','Updates to workflows you take part in.'),`${notes.some(n=>!n.read_at)?`<button class="btn outline" data-action="read-all-notifications">${tr('تعليم الكل كمقروء','Mark all as read')}</button>`:''}<a class="btn outline" href="#notification-settings">${tr('إعدادات الإشعارات','Notification settings')}</a>`)+`<section class="panel">${notes.map(n=>`<div class="notification-row"><span class="avatar" aria-hidden="true">${['approval_needed','approval_escalated','ready_for_execution','ready_for_execution_fallback'].includes(n.kind)?'!':'✓'}</span><div><strong>${e(n.title||tr('تحديث على طلبك','Your request was updated'))}</strong>${n.body?`<span class="subtle">${e(n.body)}</span>`:''}<small>${e(date(n.created_at))}</small></div><a class="btn outline small" href="${e(n.link||(n.request_id?`#request/${n.request_id}`:'#notifications'))}">${n.request_id?tr('فتح الطلب','Open request'):tr('فتح','Open')}</a>${!n.read_at?`<button class="text-button" data-action="read-notification" data-id="${e(n.id)}">${tr('تمت القراءة','Mark read')}</button>`:''}</div>`).join('')||empty(tr('لا توجد إشعارات','No notifications'),tr('ستظهر هنا تحديثات الطلبات والموافقات.','Request and approval updates will appear here.'))}</section>`;
    }else if(view==='requirements'){
      const requirements=await api('/requirements');if(turn!==renderId)return;window.scopeRows=requirements;
      html=pageHead(tr('نطاق المنصة','Platform scope'),tr('المتطلبات الأصلية ومعايير قبولها. هذا سجل نطاق، وليس قائمة وظائف مكتملة.','Original requirements and acceptance criteria. This is a scope register, not a list of completed features.'))+`<div class="panel panel-body counts"><strong>220</strong><span>${tr('متطلبًا','requirements')}</span><strong>22</strong><span>${tr('مجالًا وظيفيًا','functional areas')}</span></div><form id="scope-filter" class="filters"><input name="q" placeholder="${tr('ابحث بالرمز أو المتطلب…','Search by code or requirement…')}" aria-label="${tr('بحث المتطلبات','Search requirements')}"><button class="btn dark">${tr('بحث','Search')}</button></form><section class="panel requirements-list" id="scope-results">${scopeCards(requirements)}</section>`;
    }else if(view==='service-benchmark'){
      const data=await api('/service-benchmark');if(turn!==renderId)return;html=benchmarkPage(data,{e});
    }else if(view==='integrations'){
      const integration=await api('/integrations');if(turn!==renderId)return;
      html=pageHead('التكاملات ونقل البيانات','متطلبات كل اتصال وحالته الفعلية')+integrationCards(integration,{e});
    }else html=pageHead(tr('الصفحة غير متاحة','Page unavailable'),tr('اختر صفحة من مساحة العمل.','Choose a page from your workspace.'));
    if(turn===renderId){document.querySelector('#main').innerHTML=html;
      // مرور التسميات بعد الرسم الواحد: الشاشات التي لم تنتقل إلى العدّة تتبع تبديل التسمية في الثانية التي يُنشر فيها (عناصر التسمية وحدها).
      if(typeof relabel==='function')relabel(document.querySelector('#main'),view,lang);
      settleView(route);
      clearScenes=mountScenes(root);if(view==='catalog')paintMotion(document.querySelector('#main'));else paintTilt(document.querySelector('#main'));paintBars(document.querySelector('#main'));
      // صفحة الخدمة على الشاشة الضيقة: الأقسام الطويلة تُطوى بعد الرسم ما عدا «سياقك أنت» — «اشرح قبل أن تسأل» لا «اعرض كل شيء دفعة» (٣-٢). حالةٌ لا نمط، فلا مساس بـCSP.
      if(view==='services'&&typeof matchMedia==='function'&&matchMedia('(max-width:759.98px)').matches)for(const section of document.querySelectorAll('#main .sc-fold'))section.open=false;}
    // رابط يفتح نموذج الوحدة مباشرة (مثل «طلب إجازة» من دليل الخدمات: #leave/request). يُزال المقطع من العنوان حتى لا يُعاد فتحه بعد الحفظ.
    const opens=turn===renderId&&operationModules[view]?.autoOpen?.(route.split('/')[1],operationData);
    // م0 «السور»: autoOpen تسمّي زرًّا، فإن لم يكن مرسومًا لا تُبتلع النقرة؛ يكمل الرابط إلى followDeepLink فيُفتح بديله أو يقال السبب.
    const opener=opens?document.querySelector(`#main [data-operation="${CSS.escape(opens.action)}"][data-id="${CSS.escape(opens.id)}"]`):null;
    if(opener){history.replaceState(null,'','#'+view);opener.click();}
    // الروابط العميقة (101): #leave/new و#letters/new وأخواتهما، بعد الرسم وما لم يفتح autoOpen نموذجًا.
    else if(turn===renderId)await followDeepLink(hash,turn);
    // رابط السجل (الموجة 1 «ما عليّ»): ‎#screen?focus=<id>‎ يقف عند السجل نفسه ويعلّمه — معالج واحد عام لكل الشاشات (focus-record.mjs).
    // route هو المسار بلا معاملاته (فيصح ‎#request/<id>?focus=<مهمة>‎)، وhash كاملًا يذهب للروابط العميقة. يعود العنوان إلى
    // الشاشة حتى لا يعيد التحديث القفز، والسجل غير الظاهر في الشاشة يُقال عنه ذلك بدل الصمت. محروسة كالروابط العميقة: صندوق الاختبارات بلا هذه الوحدة.
    const record=turn===renderId&&typeof parseFocus==='function'?parseFocus(hash).focus:null;
    if(record){try{history.replaceState(null,'','#'+route);}catch{}if(!focusRecord(document.querySelector('#main'),record))toast(tr('فُتحت الشاشة، لكن هذا السجل غير ظاهر فيها الآن؛ ربما اتُّخذ قراره.','The screen is open, but this record is not shown on it now; it may already be decided.'));}
  // مسح 20 سبتمبر (S-07): شاشة يرفضها الخادم كانت تترك «إعادة المحاولة» وحدها، وهي لا تغيّر شيئًا حين يكون السبب تصريحًا
  // ناقصًا لا عطلًا عابرًا. يبقى زر المحاولة لعطل الشبكة، ويُضاف طريق عودة حتى لا تكون الشاشة نهاية مسدودة (تدقيق 19 سبتمبر B14).
  }catch(error){if(turn===renderId&&me)document.querySelector('#main').innerHTML=`<div class="error">${e(error.message)}</div><div class="page-actions"><button class="btn" data-action="reload">${tr('إعادة المحاولة','Try again')}</button><a class="btn outline" href="#home">${tr('العودة إلى الرئيسية','Back to home')}</a></div>`;}
}
// الروابط العميقة (P1-2): #leave/new وأخواته. بعد رسم الشاشة يُضغط زر نموذجها نفسه مرة واحدة، فتبقى قواعد النموذج قواعد الشاشة،
// ويعود العنوان إلى الشاشة (#leave) حتى لا يعيد التحديث فتح النموذج، وإغلاقه يترك الموظف على الشاشة لا على صفحة فارغة.
// زر غير موجود (لا رصيد، لا قالب، لا قسيمة) يقول متى يتاح بدل الصمت. محروسة: الصندوق التجريبي في الاختبارات بلا هذه الوحدة.
async function followDeepLink(route,turn){
  let opened=false;
  try{
    if(typeof parseDeepLink!=='function')return;
    const link=parseDeepLink(route);if(turn!==renderId)return;
    // ت1: نية على اسم بديل (#catalog/new) تُنفَّذ كما هي، والعنوان يعود إلى البيت الجديد (#services) لا إلى الاسم القديم.
    const home=routeAlias(link.base.slice(1));if(home)link.base='#'+home.route;
    // م0 «السور» — لا نقرة ميتة صامتة: نية لم تفتحها autoOpen ولا يعرفها DEEP_LINKS يقال لصاحبها ذلك ويعود العنوان إلى الشاشة.
    // يُستثنى ما مقطعه الثاني سجل أو مسار فرعي تقرؤه الشاشة بنفسها (#request/<id>…)، وشاشة غير معروفة أصلًا لأن صفحتها تقول «غير متاحة».
    if(!link.valid){
      if(link.intent&&!link.subrouted&&(operationModules[link.view]||BUILTIN_VIEWS.includes(link.view))){try{history.replaceState(null,'',link.base);}catch{}toast(unknownIntentText(lang));}
      return;
    }
    try{history.replaceState(null,'',link.base);}catch{}
    if(link.special==='launcher'){await requestForm();return;}
    if(link.special==='payslip'){
      const slip=document.querySelector('#main [data-payslip]');
      if(!slip){toast(unavailableText('payroll',lang));return;}
      slip.open=true;opened=true;slip.scrollIntoView?.({block:'start'});slip.querySelector('summary')?.focus?.({preventScroll:true});return;
    }
    const find=operation=>[...document.querySelectorAll(`#main [data-action="operation"][data-module="${link.view}"][data-operation="${operation}"]`)];
    let buttons=find(link.operation);if(!buttons.length&&link.alternate)buttons=find(link.alternate);
    // نوع خطاب بعينه غير متاح (بلا قالب معتمد) لا يفتح نوعًا آخر مكانه.
    const button=(link.row&&buttons.find(b=>b.dataset.id===link.row))||(link.exactRow?null:buttons[0]);
    // السبب من الشاشة نفسها إن كانت تعرفه (whyUnavailable: ما حسبه الخادم لهذا الحساب)، وإلا فالنص العام للشاشة.
    if(!button){toast(operationModules[link.view]?.whyUnavailable?.(link.intent,operationData)||unavailableText(link.view,lang));return;}
    button.click();opened=true;
    // تعبئة ما يحمله الرابط (مثل نوع الخطاب) بقيمة موجودة في قائمة الحقل فقط؛ غير ذلك يُترك لاختيار الموظف.
    const form=dialog.querySelector?.('#operation-form');
    for(const [name,value] of Object.entries(link.fields||{})){
      const field=form?.elements?.[name];if(!field)continue;
      if(field.tagName==='SELECT'?[...field.options].some(o=>o.value===value):true){field.value=value;field.dispatchEvent?.(new Event('change',{bubbles:true}));}
    }
  // عطل قبل فتح النموذج (تحميل فشل، زر رفض) كان يُبتلع هنا فتبدو النقرة ميتة. يقال الآن؛ وعطل التعبئة بعد الفتح يبقى صامتًا لأن النموذج أمام صاحبه.
  }catch(error){if(!opened)try{toast(error?.message||unavailableText('default',lang));}catch{}}
}
const scopeCards=rows=>rows.map(r=>`<article class="req-card"><code>${e(r.id)}</code> <span class="badge">${e(r.priority)}</span> <span class="badge">${e(r.implementation_status||tr('لم يبدأ','Not started'))}</span><h3>${e(r.title)} · ${e(r.domain)}</h3><p>${e(r.acceptance)}</p></article>`).join('');
function passwordForm(forced){return `<form id="password-form" class="password-form"><label><span>${forced?tr('كلمة المرور المؤقتة','Temporary password'):tr('كلمة المرور الحالية','Current password')}</span><input name="current_password" type="password" autocomplete="current-password" required dir="ltr"></label><label><span>${tr('كلمة المرور الجديدة','New password')}</span><input name="new_password" type="password" autocomplete="new-password" required minlength="8" dir="ltr"><small class="subtle">${tr('8 أحرف على الأقل، ليست أرقامًا فقط ولا تتضمن اسم المستخدم.','At least 8 characters, not digits only, without your username.')}</small></label><label><span>${tr('تأكيد كلمة المرور الجديدة','Confirm new password')}</span><input name="confirm_password" type="password" autocomplete="new-password" required minlength="8" dir="ltr"></label>${forced?`<div id="login-error" role="alert"></div><button class="btn primary" type="submit">${tr('حفظ ومتابعة','Save and continue')}</button><button class="text-button" type="button" data-action="logout">${tr('خروج','Sign out')}</button>`:formEnd(tr('تغيير كلمة المرور','Change password'))}</form>`;}
function passwordView(forced){if(!forced)return showDialog(tr('تغيير كلمة المرور','Change password'),passwordForm(false));leaveFirstPaint();clearScenes();renderId++;root.innerHTML=`<main class="login password-gate" id="main"><section class="login-form"><div class="login-card"><div class="eyebrow" lang="en" dir="ltr">WORKSPACE ACCESS</div><h2>${tr('أهلًا','Welcome')} ${e(me.name)}</h2><p>${tr('لحماية حسابك، اختر كلمة مرور خاصة بك بدل كلمة المرور المؤقتة.','To protect your account, replace the temporary password with your own.')}</p>${passwordForm(true)}</div></section></main>`;}
// وسم البيئة (TP2.4): التجهيز يُعلن عن نفسه في كل شاشة فلا يُظنّ تشغيلًا. يُحقن بجانب الجذر
// لا داخله، فلا يدخل في HTML الشاشة ولا يضيع مع إعادة رسمها.
let envBadge=null;
// وسمٌ معلوماتي لا يملك أن يُبطل فعلًا: كل ما فيه داخل try، فبيئةٌ بلا DOM كامل (حزام الاختبار) تتخطاه
// ولا تُسقط معالج النقرة قبل إعادة الرسم — وهو ما وقع فعلًا فأبقى شريط «جرّب كمستخدم» بعد إنهاء التجربة.
function paintEnvironment(){
  try{
    const existing=document.getElementById?.('env-strip');
    if(!envBadge?.warn){existing?.remove?.();return;}
    if(!document.body?.insertBefore||!document.createElement)return;
    const strip=existing??document.body.insertBefore(Object.assign(document.createElement('div'),{id:'env-strip',className:'notice env-strip'}),document.body.firstChild);
    strip.setAttribute?.('role','status');
    strip.textContent=`${envBadge.name} — ${envBadge.warn}`;
  }catch{/* الوسم زينة؛ غيابه لا يوقف شيئًا */}
}
function loginView(){leaveFirstPaint();clearScenes();renderId++;requestDetail=null;document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';root.innerHTML=`<main class="login" id="main"><section class="login-story"><div class="brand">${brandLogo}</div>${workFrames(brandLogo)}<div class="story-copy"><div class="eyebrow">${tr('معًا، نصنع ما نفخر به.','Made together.')}</div><h1>${tr('هنا يبدأ الأثر.','People make<br>the difference.')}</h1><p>${tr('مساحة تجمع الطلبات والموافقات والمشاريع، وتوضح لكل شخص خطوته التالية.','A workspace for requests, approvals and projects, with a clear next step for each person.')}</p></div><div class="hr-values"><span>الإنجاز</span><span>الشمولية</span><span>الإبداع</span><span>الجودة</span><span>الاعتزاز</span></div></section><section class="login-form"><header class="login-masthead"><div class="login-wordmark">${brandLogo}<span>${tr('منصة تشغيل 3,6T','3,6T operations platform')}</span></div></header><div class="login-card"><div class="login-mobile-tagline">${tr('مساحة عمل لصُنّاع الأثر.','A workspace for your next idea.')}</div><div class="eyebrow" lang="en" dir="ltr">WORKSPACE ACCESS</div><h2>${tr('حيّاك الله في 3,6T.','Welcome to 3,6T.')}</h2><p>${tr('استخدم حسابك التجريبي لفتح مساحة عملك.','Use your evaluation account to open your workspace.')}</p><form id="login-form"><label><span>${tr('اسم المستخدم','Username')}</span><input name="username" autocomplete="username" required dir="ltr" placeholder="employee"></label><label><span>${tr('كلمة المرور','Password')}</span><input name="password" type="password" autocomplete="current-password" required dir="ltr"></label><label><span>${tr('رمز التحقق بخطوتين (لمن فعّله)','Two-step code (if enabled)')}</span><input name="otp" inputmode="numeric" autocomplete="one-time-code" dir="ltr" maxlength="20" placeholder="123456"></label><div id="login-error" role="alert"></div><button class="btn dark" type="submit">${tr('الدخول إلى مساحة العمل','Sign in')}</button></form><p class="login-note">${tr('لأول دخول استعمل اسم المستخدم وكلمة المرور المؤقتة التي سلّمك إياها مسؤول المنصة.','For your first sign-in, use the username and temporary password your platform administrator gave you.')}</p><div class="login-appearance">${designButton()}${themeButton()}<button type="button" class="text-button" data-action="language" lang="${lang==='ar'?'en':'ar'}">${lang==='ar'?'English':'العربية'}</button></div></div><footer class="login-footer">3,6T © 2026</footer></section></main>`;clearScenes=mountScenes(root);}
let requestFormBaseline=null;
function requestSnapshot(form){
  return JSON.stringify([...form.elements].filter(control=>control.name&&!['submit','button','reset'].includes(control.type)).map(control=>[control.name,control.type==='checkbox'||control.type==='radio'?control.checked:control.value]));
}
function captureRequestBaseline(){const form=dialog.querySelector?.('#request-form');const service=form?.querySelector?.('select[name=service_id]');if(service)service.dataset.previousValue=service.value;requestFormBaseline=form?.id==='request-form'?{form,value:requestSnapshot(form)}:null;}
function requestHasChanges(){const form=dialog.open&&dialog.querySelector?.('#request-form');return !!(form&&requestFormBaseline?.form===form&&requestSnapshot(form)!==requestFormBaseline.value);}
function allowRequestDiscard(){
  return !requestHasChanges()||window.confirm(tr('عندك تعديلات ما انحفظت. تبي تتركها وتكمل؟ اضغط إلغاء عشان ترجع وتحفظ مسودتك.','You have unsaved changes. Discard them and continue? Choose Cancel to return and save your draft.'));
}
function showDialog(title,content,variant=''){if(!allowRequestDiscard())return false;dialogEpoch++;dialog.classList.add('drawer');dialog.classList[variant==='launcher'?'add':'remove']('launcher');dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${e(title)}</h2><button type="button" class="sheet-close" data-action="close" aria-label="${tr('إغلاق','Close')}">${glyph('close')}</button></div><div class="dialog-body">${content}<div id="dialog-error" role="alert"></div></div>`;for(const form of dialog.querySelectorAll('form'))form.dataset.key=crypto.randomUUID();if(typeof relabel==='function')relabel(dialog,view,lang);dialog.showModal();captureRequestBaseline();return true;}
// B9 (تدقيق 19 سبتمبر): الحقل المطلوب هنا لا يحمل required عمدًا — «حفظ المسودة» يحفظ نصف المكتمل، والمسودة نصف مكتملة
// هي الغرض منها. النقص يُعلن عند «تقديم للاعتماد»، وكان يُعلن حقلًا حقلًا فصار يُعلن كاملًا (app/validation.mjs).
// aria-required يبلغ قارئ الشاشة ما تقوله النجمة الحمراء للعين، دون أن يمنع حفظ المسودة.
// مسح الكتالوج 20 سبتمبر (العطب 5): الإرشاد المكتوب لكل حقل — لماذا يُسأل، وما المتوقع كتابته، ومثاله —
// كان يصل لوحة المسؤول ولا يصل من يملأ النموذج. يُعرض الآن تحت الحقل، ويحمل الحقل حدّه وصيغته
// كما يفرضهما الخادم، وشرطُ ظهوره يُخفيه حتى يتحقق. الإخفاء عرضٌ فقط؛ الفرض في validatePayload.
function fieldGuidance(f){
  const lines=[f.hint,f.why?`${tr('لماذا يُسأل','Why this is asked')}: ${f.why}`:'',f.example?`${tr('مثال','Example')}: ${f.example}`:''].filter(Boolean);
  return lines.length?`<small class="subtle field-guidance">${lines.map(x=>`<span>${e(x)}</span>`).join('')}</small>`:'';
}
function fieldInput(f,value=''){
  const req=f.required?' aria-required="true"':'';
  const max=f.max_length??3000,min=f.min_length?` minlength="${e(f.min_length)}"`:'';
  const pattern=f.pattern?` pattern="${e(f.pattern)}" title="${e(f.pattern_message??'')}"`:'';
  const when=f.show_when?` data-show-when="${e(f.show_when.field)}" data-show-equals="${e(JSON.stringify(f.show_when.equals))}" hidden`:'';
  const body=f.type==='textarea'?`<textarea name="field:${e(f.key)}"${req}${min} maxlength="${e(max)}">${e(value)}</textarea>`
    :f.type==='select'?`<select name="field:${e(f.key)}"${req}><option value="">${tr('اختر…','Choose…')}</option>${f.options.map(o=>`<option ${value===o?'selected':''} value="${e(o)}">${e(o)}</option>`).join('')}</select>`
    :`<input name="field:${e(f.key)}"${req}${min}${pattern} type="${f.type==='date'?'date':f.type==='number'?'number':'text'}"${f.type==='number'?' min="0" step="0.01" inputmode="decimal" dir="ltr"':''} maxlength="${e(max)}" value="${e(value)}">`;
  return `<label data-field="${e(f.key)}"${when}><span>${e(f.label)} ${f.required?'<span class="required">*</span>':''}</span>${body}${fieldGuidance(f)}</label>`;
}
// شرط الظهور يُطبَّق عند الفتح وعند كل تغيير: الحقل المخفي لا يُطالَب به، وقيمته لا تُرسل.
function applyFieldConditions(root){
  if(!root?.querySelectorAll)return;
  for(const label of root.querySelectorAll('[data-show-when]')){
    let equals=[];try{equals=JSON.parse(label.dataset.showEquals);}catch{equals=[];}
    // معرف الحقل مقيد بـ ^[a-z][a-z0-9_]{1,39}$ في createService، فلا يحتاج تهريبًا في المحدِّد.
    const source=root.querySelector(`[name="field:${label.dataset.showWhen}"]`);
    const shown=!source||equals.includes(source.value);
    label.hidden=!shown;
    for(const control of label.querySelectorAll('input,select,textarea'))control.disabled=!shown;
  }
}
// زر الإرسال يحمل اسم الفعل نفسه، والفعل الذي لا رجعة فيه (رفض، إلغاء، حذف، سحب…) أحمر.
const destructive=/(^|_)(reject|cancel|delete|remove|revoke|withdraw|void|terminate|suspend|archive|drop|decline)(_|$)|^(رفض|إلغاء|حذف|سحب|إزالة|إيقاف|إنهاء|إبطال|استبعاد|أرشفة)/;
function formEnd(label,tone='dark'){return `<div class="form-actions"><button class="btn outline" type="button" data-action="close">${tr('إلغاء','Cancel')}</button><button class="btn ${tone}" type="submit">${e(label)}</button></div>`;}
async function requestForm(sid,edit=false){
  const opening=++dialogEpoch,turn=renderId;const loadedProjects=await api('/projects'),loadedDepartments=await api('/departments');if(turn!==renderId||opening!==dialogEpoch)return;projectList=loadedProjects;launcherDepartments=loadedDepartments;
  if(!edit&&!sid){await loadVariants();if(turn!==renderId||opening!==dialogEpoch)return;}
  const s=edit?requestDetail.service:services.find(s=>s.id===sid);
  if(!edit&&s&&openModuleForm(s))return;
  if(edit||s)return showComposer(s,edit);
  if(!services.length)return toast(tr('لا توجد خدمة متاحة','No service is available'));
  launcherState={selected:'',query:''};showLauncher();
}
// مدخل واحد (G7): خدمة في الدليل لها وحدة مخصصة جاهزة لهذا الحساب (module_link من الخادم) تفتح نموذج الوحدة لا طلبًا عامًا،
// فيبقى للطلب مسار اعتماد واحد. الرابط من قائمة ثابتة في app/module-routes.mjs ويبدأ بـ# دائمًا.
function openModuleForm(s){
  const link=s?.module_link;
  if(typeof link!=='string'||!/^#[a-z-]+(\/[a-z-]+)?$/.test(link))return false;
  if(dialog.open){if(!allowRequestDiscard())return true;dialogEpoch++;dialog.close();}
  if(location.hash===link)routeRender();else location.hash=link.slice(1);
  return true;
}
// بطاقات الخيارات (service-catalog.mjs SERVICE_VARIANTS): تُحمَّل مرة لكل رسم يحتاجها. فشلها يعيد الدليل إلى شكله السابق بلا بطاقات.
let variantGroups=[];
async function loadVariants(){
  if(!me||me.role==='admin'){variantGroups=[];return variantGroups;}
  try{const loaded=await api('/catalog/variants');variantGroups=Array.isArray(loaded)?loaded:[];}catch{variantGroups=[];}
  return variantGroups;
}
// ما ليس في النموذج بعد (الحفظ التلقائي، التعبئة من طلب سابق، «عاجل») يصل مع حمولة مركز الخدمات (gaps.form) ويُرسم في
// النموذج بسببه؛ ومن فتح النموذج من «طلب خدمة» بلا الحمولة لا يُرسم له شيء — لا يُكتب هنا نصٌّ من عندنا.
const formGaps=()=>catalogTree?.gaps?.form??[];
function showVariant(code,optionCode){
  const group=variantGroups.find(g=>g.code===code);if(!group)throw Error(tr('الخدمة غير متاحة','Service unavailable'));
  const option=group.options.find(o=>o.code===optionCode)??(group.options.length===1?group.options[0]:null);
  const service=option?.service_id?services.find(s=>s.id===option.service_id):null;
  if(!showDialog(tr('طلب جديد','New request'),variantComposer({group,option,service,departments:launcherDepartments,projects:projectList,e,fieldInput,gaps:formGaps()}),'launcher'))return;
  applyFieldConditions(dialog.querySelector('#request-form'));
  dialog.querySelector('.rq-option[aria-checked="true"]')?.focus?.({preventScroll:true});
}
function showLauncher(){if(!showDialog(tr('طلب جديد','New request'),requestLauncher({departments:launcherDepartments,services,me,...launcherState,e,variants:variantGroups}),'launcher'))return;paintMotion(dialog);launcherRoot().querySelector('#launcher-search')?.focus?.();}
function showComposer(s,edit=false){if(!showDialog(edit?tr('تعديل الطلب','Edit request'):tr('طلب جديد','New request'),requestComposer({service:s,departments:launcherDepartments,projects:projectList,request:edit?requestDetail:null,edit,e,fieldInput,gaps:edit?[]:formGaps()}),'launcher'))return;applyFieldConditions(dialog.querySelector('#request-form'));}
// ── سجل البحث بلا هوية (مركز الخدمات، الدفعة الثالثة) ─────────────────────────────────────────────
// جلسة بحث واحدة = معرّف عشوائي يولّده المتصفح (32 خانة ست عشرية) من أول حرف يُكتب حتى يُفرَّغ الصندوق أو يُقدَّم طلب.
// «searched» بعد 600 مللي ثانية من آخر ضغطة على سؤالٍ غير فارغ، و«opened» عند فتح بطاقة من النتائج بمرتبتها، و«submitted»
// حين ينجح إنشاء الطلب ومعرّف الجلسة في اليد. الخادم يعدّ النتائج بنفسه ولا يكتب السرّي (app/catalog-home.mjs).
// فشل التسجيل لا يوقف شيئًا: السجل خبرٌ عن الدليل لا شرطٌ للطلب.
let searchSession={id:null,query:'',timer:null,logged:'',opened:null};
const newSearchId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
function logSearch(event,extra={}){if(!searchSession.id)return;api('/catalog/search-log','POST',{search_id:searchSession.id,event,query:searchSession.query,...extra}).catch(()=>{});}
function paintCatalogSearch(value){
  catalogQuery=value;const target=document.querySelector('#catalog-results');
  if(!target||!catalogTree)return;
  const q=catalogQuery.trim();
  // اللوح من الدالة نفسها التي رسمته أولًا (catalogResults)، والعدّاد يُكتب في لوح الحالة الدائم فيُنطق تغيّره.
  const pane=catalogResults(catalogTree,catalogQuery,{e,ui:uiKit,extra:catalogExtra,counts:catalogCounts});
  target.innerHTML=pane.html;
  const counts=document.querySelector('#catalog-counts');if(counts)counts.textContent=pane.announce;
  if(!q&&catalogTree.lens==='department')paintMotion(target);
  clearTimeout(searchSession.timer);
  if(!q){searchSession={id:null,query:'',timer:null,logged:'',opened:null};return;}
  // بحثٌ جديد بعد فتح بطاقة جلسةٌ جديدة: لا تُنسب نتيجة سؤالٍ إلى معرّف سؤالٍ آخر.
  if(!searchSession.id||searchSession.opened)searchSession={id:newSearchId(),query:q,timer:null,logged:'',opened:null};
  searchSession.query=q;
  const count=target.querySelectorAll('.sc-card').length;
  searchSession.timer=setTimeout(()=>{if(searchSession.logged===q)return;searchSession.logged=q;logSearch('searched',{result_count:count});},600);
}
// فتح بطاقة من نتائج البحث (جسمها أو زرّ بدئها أو «اشرح لي أولًا»): مرتبتها من data-position على غلافها.
document.addEventListener('click',ev=>{
  const found=ev.target.closest?.('#catalog-results .sc-found');if(!found||!searchSession.id)return;
  const card=found.querySelector('[data-card]'),hit=ev.target.closest('a,button');if(!card||!hit)return;
  searchSession.opened={kind:card.dataset.kind||'service',key:card.dataset.card};
  logSearch('opened',{item_kind:searchSession.opened.kind,item_key:searchSession.opened.key,position:Number(found.dataset.position)||null});
},true);
function launcherRoot(){return dialog.open?dialog:document;}
function paintLauncher(){const target=launcherRoot().querySelector('#launcher-dynamic');if(!target)return;const page=!dialog.open&&target.closest('[data-mode="page"]');target.innerHTML=launcherResults({departments:launcherDepartments,services,me,...launcherState,e,interactive:!(page&&me.role==='admin'),variants:me.role==='admin'?null:variantGroups});paintMotion(target);}
function paintBars(root){for(const bar of root?.querySelectorAll?.('[data-width]')??[])bar.style?.setProperty?.('width',Math.max(2,Number(bar.dataset.width)||0)+'%');}
// تصفية جدول: كل أداة تحمل data-filter="<محدِّد الجدول>" تشارك في التصفية نفسها، فمربّع بحث ومرشّحا قائمة يعملون معًا لا
// يمحو أحدهم الآخر. الأداة بلا data-filter-key بحثٌ نصي في data-filter-text؛ والأداة بمفتاح تطابق data-<المفتاح> تمامًا.
// وعدّاد النتائج (عنصر بـdata-filter-count="<المحدِّد نفسه>") يُحدَّث بعد كل تصفية: الجدول المرجعي يعرض عدد النتائج،
// وعددٌ لا يتحرك مع المرشّح أسوأ من لا عدّاد.
function applyTableFilters(selector){
  const controls=[...document.querySelectorAll(`[data-filter="${CSS.escape(selector)}"]`)];
  const tests=controls.map(control=>{
    const value=String(control.value??'').trim();if(!value)return null;
    const key=control.dataset.filterKey;
    if(key)return row=>row.dataset[key]===value;
    const q=value.toLocaleLowerCase();
    return row=>(row.dataset.filterText??'').toLocaleLowerCase().includes(q);
  }).filter(Boolean);
  let shown=0;
  for(const row of document.querySelectorAll(selector+' tbody tr')){
    const visible=tests.every(match=>match(row));row.hidden=!visible;if(visible)shown++;
  }
  // البطاقة المطوية تلغي البحث (مراجعة 22 سبتمبر): الصف يصير غير مخفيّ والعدّاد يقول «1»، والقارئ لا يرى
  // شيئًا لأن <details> حوله مغلقة. فكل بطاقة بقي فيها صفٌّ مطابق تُفتح ما دام هناك مرشّح — وهو ما يفعله
  // بحث القائمة الجانبية في هذا الملف نفسه منذ البداية (g.open=true). وحين يُفرَّغ المرشّح تعود كل بطاقة
  // إلى حالها الأول كما رسمتها الشاشة، فلا يترك البحث خلفه شاشةً مفتوحة بالكامل لم يطلبها أحد.
  const filtering=tests.length>0;
  for(const box of document.querySelectorAll(selector+' details')){
    if(box.dataset.filterOpen===undefined)box.dataset.filterOpen=box.open?'1':'0';
    box.open=filtering?!!box.querySelector('tbody tr:not([hidden])'):box.dataset.filterOpen==='1';
  }
  for(const counter of document.querySelectorAll(`[data-filter-count="${CSS.escape(selector)}"]`))counter.textContent=String(shown);
}
function paintMotion(root){try{clearCards();clearCards=mountCards(root);}catch{clearCards=()=>{};}}
// بقية الشاشات: البلاطات والبطاقات تتبع المؤشر فقط (--tilt-x/--tilt-y)، بلا دخول متتابع. أثرها مرئي حيث يقرأ CSS المتغيرات.
function paintTilt(root){try{clearTilt();clearTilt=mountCards(root,{enter:false});}catch{clearTilt=()=>{};}}
// انتقال العرض عند تغيّر المسار فقط (hashchange)، لا مع كل إعادة رسم. شروطه: الرمز --scene-3d = 1 من التصميم، وstartViewTransition موجودة،
// ولا تقليل حركة (الجهاز أو html[data-motion=off]). الاستدعاء يبدأ render() داخل رد الانتقال، ويُطلق اللقطة الجديدة حين ينتهي الرسم
// أو بعد 320ms أيهما أسبق، حتى لا تتجمد الصفحة أثناء انتظار الخادم؛ ما يصل بعدها يُرسم كالمعتاد. كل شيء محروس: الصندوق التجريبي بلا DOM.
function sceneTransition(){
  try{
    const html=document.documentElement;
    if(typeof document.startViewTransition!=='function'||typeof getComputedStyle!=='function'||html?.dataset?.motion==='off')return false;
    if(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches)return false;
    return getComputedStyle(html).getPropertyValue('--scene-3d').trim()==='1';
  }catch{return false;}
}
function routeRender(){
  if(!me||!sceneTransition())return render();
  let rendered;
  try{
    const transition=document.startViewTransition(()=>{rendered=render();return Promise.race([rendered.catch(()=>{}),new Promise(done=>setTimeout(done,320))]);});
    // انتقال متخطّى (تبويب مخفي، أو انتقال أحدث بدأ) يرفض ready: رفض متوقع لا خطأ غير معالج.
    for(const phase of [transition.ready,transition.finished])Promise.resolve(phase).catch(()=>{});
    return Promise.resolve(transition.updateCallbackDone).catch(()=>{}).then(()=>rendered??render());
  }catch{return rendered??render();}
}
// قائمة التصميم: عنصر واحد يُلحق بـ<body> عند أول فتح (لا شيء هنا يعمل عند تحميل الوحدة). Popover API حين يتوفر (auto: النقر خارجها وEsc يغلقانها)،
// وإلا سمة hidden مع مستمع نقر خارجي يُضاف عند الفتح ويُزال عند الإغلاق. الموضع بـCSSOM بجوار الزر الذي فتحها؛ لا style في الترميز.
// الزر الفاتح يبقى aria-expanded="true" ما دامت مفتوحة: signature.mjs يقرؤه ليعيد التركيز إلى بديله بعد إعادة الرسم.
let designMenuNode=null,designInvoker=null,designDismissed={el:null,at:0},designOutside=null;
const designPopover=()=>typeof HTMLElement!=='undefined'&&typeof HTMLElement.prototype.showPopover==='function';
const designMenuOpen=()=>!!designMenuNode&&(designPopover()?designMenuNode.matches(':popover-open'):!designMenuNode.hidden);
function designMenuItems(){return [...(designMenuNode?.querySelectorAll('[role="menuitemradio"]')??[])];}
function designMenuKey(ev){
  const items=designMenuItems(),at=items.indexOf(document.activeElement);
  if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ev.preventDefault();const step=ev.key==='ArrowDown'?1:-1;items[(at+step+items.length)%items.length]?.focus();}
  else if(ev.key==='Home'||ev.key==='End'){ev.preventDefault();items[ev.key==='Home'?0:items.length-1]?.focus();}
  else if(ev.key==='Escape'||ev.key==='Tab'){ev.preventDefault();ev.stopPropagation();closeDesignMenu();}
}
function designMenuClosed(){
  // يُستدعى مرة لكل إغلاق مهما كان سببه: اختيار، Esc، نقر خارجها، أو إغلاق المتصفح لها.
  const invoker=designInvoker,inside=designMenuNode?.contains(document.activeElement);
  designDismissed={el:invoker,at:Date.now()};designInvoker=null;
  if(designOutside){document.removeEventListener('pointerdown',designOutside,true);designOutside=null;}
  for(const b of document.querySelectorAll('[data-action="design"][aria-expanded="true"]'))b.setAttribute('aria-expanded','false');
  if(invoker?.isConnected&&(inside||document.activeElement===document.body))invoker.focus({preventScroll:true});
}
function closeDesignMenu(){
  if(!designMenuOpen())return;
  if(designPopover()){try{designMenuNode.hidePopover();}catch{}}   // beforetoggle (متزامن) يستدعي designMenuClosed() والتركيز ما زال داخلها
  else{designMenuNode.hidden=true;designMenuClosed();}
}
function placeDesignMenu(menu,invoker){
  const r=invoker.getBoundingClientRect(),m=menu.getBoundingClientRect(),pad=8,gap=4,vw=document.documentElement.clientWidth||window.innerWidth,vh=window.innerHeight;
  let top=r.bottom+gap;if(top+m.height>vh-pad&&r.top-gap-m.height>=pad)top=r.top-gap-m.height;
  top=Math.max(pad,Math.min(top,vh-pad-m.height));
  // تبدأ القائمة من حافة البداية للزر: يمينه في العربية ويساره في الإنجليزية.
  let left=document.documentElement.dir==='rtl'?r.right-m.width:r.left;left=Math.max(pad,Math.min(left,vw-pad-m.width));
  menu.style.setProperty('top',Math.round(top)+'px');menu.style.setProperty('left',Math.round(left)+'px');
}
function openDesignMenu(invoker){
  if(!designMenuNode){
    designMenuNode=document.createElement('div');designMenuNode.id='design-menu';designMenuNode.setAttribute('role','menu');
    if(designPopover()){designMenuNode.setAttribute('popover','auto');designMenuNode.addEventListener('beforetoggle',ev=>{if(ev.newState==='closed')designMenuClosed();});}
    else designMenuNode.hidden=true;
    designMenuNode.addEventListener('keydown',designMenuKey);
    document.body.append(designMenuNode);
  }
  const menu=designMenuNode;
  menu.setAttribute('aria-label',tr('التصميم','Design'));menu.dir=document.documentElement.dir||'rtl';menu.lang=lang;
  menu.innerHTML=DESIGNS.map(key=>`<button type="button" role="menuitemradio" tabindex="-1" aria-checked="${key===design}" data-action="pick-design" data-value="${key}"><span class="design-swatch swatch-${key}" aria-hidden="true"></span><span class="design-menu-name">${e(designName(key))}</span></button>`).join('');
  designInvoker=invoker;invoker.setAttribute('aria-controls','design-menu');invoker.setAttribute('aria-expanded','true');
  if(designPopover()){try{menu.showPopover();}catch{}}
  else{menu.hidden=false;designOutside=ev=>{if(!menu.contains(ev.target)&&!invoker.contains(ev.target))closeDesignMenu();};document.addEventListener('pointerdown',designOutside,true);}
  placeDesignMenu(menu,invoker);
  (menu.querySelector('[aria-checked="true"]')||menu.querySelector('button'))?.focus({preventScroll:true});
}
// قائمة «+ إنشاء» (موجز المالك 30 سبتمبر 2026، البند 1): محتواها مرسومٌ في الشاشة نفسها (home-ui.quickRow) لأنه
// بياناتها — جاهزيةُ كل مدخل وسببُ غيابه يحسبهما الخادم لهذا الحساب. وهذا هنا آلةُ فتحٍ وإغلاقٍ ووضعٍ لا غير،
// وهي آلة قائمة المظاهر نفسها: Popover API حيث يدعمه المتصفح، وإلا سمة hidden مع مستمع نقرٍ خارجي.
// بنودها روابط (href) فالنقرة تصل وجهتها ولو تعطّلت الآلة كلها؛ والتنقل بالأسهم وEsc كما في قائمة المظاهر.
let createMenuNode=null,createInvoker=null,createOutside=null,createDismissed={el:null,at:0};
const createMenuOpen=()=>!!createMenuNode&&createMenuNode.isConnected&&(designPopover()?createMenuNode.matches(':popover-open'):!createMenuNode.hidden);
const createMenuItems=()=>[...(createMenuNode?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')??[])];
function createMenuKey(ev){
  const items=createMenuItems(),at=items.indexOf(document.activeElement);
  if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ev.preventDefault();const step=ev.key==='ArrowDown'?1:-1;items[(at+step+items.length)%items.length]?.focus();}
  else if(ev.key==='Home'||ev.key==='End'){ev.preventDefault();items[ev.key==='Home'?0:items.length-1]?.focus();}
  else if(ev.key==='Escape'||ev.key==='Tab'){ev.preventDefault();ev.stopPropagation();closeCreateMenu();}
}
function createMenuClosed(){
  const invoker=createInvoker,inside=createMenuNode?.contains(document.activeElement);
  createDismissed={el:invoker,at:Date.now()};createInvoker=null;
  if(createOutside){document.removeEventListener('pointerdown',createOutside,true);createOutside=null;}
  for(const b of document.querySelectorAll('[data-action="create-menu"][aria-expanded="true"]'))b.setAttribute('aria-expanded','false');
  if(invoker?.isConnected&&(inside||document.activeElement===document.body))invoker.focus({preventScroll:true});
}
function closeCreateMenu(){
  if(!createMenuOpen())return;
  if(designPopover()){try{createMenuNode.hidePopover();}catch{}}
  else{createMenuNode.hidden=true;createMenuClosed();}
}
function openCreateMenu(invoker){
  // إعادة الرسم تبني شريطًا جديدًا بقائمته، والقديمة المنقولة إلى <body> تبقى معلّقة بالمعرّف نفسه.
  // تُزال أولًا، فلا يحمل المستند معرّفين متطابقين ولا تُفتح قائمةٌ من رسمٍ مضى.
  const inStrip=invoker.parentElement?.querySelector('#create-menu')??null;
  if(inStrip)for(const stale of document.querySelectorAll('body > #create-menu'))if(stale!==inStrip)stale.remove();
  const menu=inStrip||document.querySelector('body > #create-menu');
  if(!menu){toast(tr('قائمة الإنشاء غير متاحة في هذه الشاشة.','The create menu is not available on this screen.'));return;}
  createMenuNode=menu;
  // العنصر مرسومٌ داخل الشريط، فيُنقل إلى <body> ليخرج من قصّ الشريط الأفقي ومن مكدّس طبقاته.
  if(menu.parentElement!==document.body)document.body.append(menu);
  if(!menu.dataset.wired){
    menu.dataset.wired='1';menu.addEventListener('keydown',createMenuKey);
    menu.addEventListener('click',ev=>{if(ev.target.closest('[role="menuitem"]'))closeCreateMenu();});
    if(designPopover())menu.addEventListener('beforetoggle',ev=>{if(ev.newState==='closed')createMenuClosed();});
  }
  menu.dir=document.documentElement.dir||'rtl';menu.lang=lang;
  createInvoker=invoker;invoker.setAttribute('aria-expanded','true');
  if(designPopover()){menu.setAttribute('popover','auto');menu.hidden=false;try{menu.showPopover();}catch{menu.hidden=false;}}
  else{menu.hidden=false;createOutside=ev=>{if(!menu.contains(ev.target)&&!invoker.contains(ev.target))closeCreateMenu();};document.addEventListener('pointerdown',createOutside,true);}
  placeDesignMenu(menu,invoker);
  createMenuItems()[0]?.focus({preventScroll:true});
}
// شرط ظهور الحقل يُعاد تطبيقه كلما تغيّر حقل في النموذج، فالحقل المشروط يظهر لحظة تحقق شرطه.
document.addEventListener('change',ev=>{if(ev.target.closest?.('#request-form'))applyFieldConditions(ev.target.closest('#request-form'));});
// شرط ظهور الحقل المخصّص في نماذج العمليات: القاعدة نفسها، والفرض في الخادم.
document.addEventListener('change',ev=>{const form=ev.target.closest?.('#operation-form');if(form&&typeof applyConditions==='function')applyConditions(form);});
document.addEventListener('change',ev=>{if(ev.target.matches('#request-form select[name=service_id]')){const next=ev.target.value;ev.target.value=ev.target.dataset.previousValue??next;if(!allowRequestDiscard())return;ev.target.value=next;ev.target.dataset.previousValue=next;const s=services.find(s=>s.id===next);document.querySelector('#service-fields').innerHTML=s.fields.map(f=>fieldInput(f)).join('');applyFieldConditions(document.querySelector('#request-form'));}
  // معاينة حية لشاشة «المظهر»: تكتب السمتين فقط، ولا تلمس التخزين؛ إغلاق الحوار بلا حفظ يعيد الشكل المحفوظ.
  if(operationView==='appearance'&&ev.target.form?.id==='operation-form'&&['design','theme'].includes(ev.target.name)){const f=ev.target.form,d=document.documentElement.dataset;swapLook(()=>{if(DESIGNS.includes(f.elements.design?.value))d.design=f.elements.design.value;if(THEMES.includes(f.elements.theme?.value))d.theme=f.elements.theme.value;});}});
document.addEventListener('click',async ev=>{
  const button=ev.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action;
  try{
    if(['theme','pick-design','language','logout','reload'].includes(action)&&!allowRequestDiscard())return;
    if(action==='theme'){if(me?.appearance?.locked){toast(tr('المظهر موحّد من إدارة المنصة.','Appearance is set by the platform administrator.'));return;}theme=theme==='light'?'dark':theme==='dark'?'auto':'light';applyAppearance({design,theme});if(me){me.appearance={...me.appearance,design,theme,source:'personal'};api('/account/appearance','POST',{design,theme}).catch(()=>{});}if(dialog.open)dialog.close();me?await render():loginView();}
    else if(action==='design'){
      // نقرة الفأرة التي أغلقت القائمة (النقر خارجها يسبق click) لا تعيد فتحها من الزر نفسه؛ Enter/Space (detail=0) يفتحها دائمًا.
      if(designMenuOpen()){closeDesignMenu();return;}
      if(ev.detail>0&&designDismissed.el===button&&Date.now()-designDismissed.at<400)return;
      if(me?.appearance?.locked){toast(tr('المظهر موحّد من إدارة المنصة.','Appearance is set by the platform administrator.'));return;}
      openDesignMenu(button);
    }
    else if(action==='pick-design'){
      const value=button.dataset.value;closeDesignMenu();
      if(!DESIGNS.includes(value))return;
      if(me?.appearance?.locked){toast(tr('المظهر موحّد من إدارة المنصة.','Appearance is set by the platform administrator.'));return;}
      if(value===design)return;
      applyAppearance({design:value,theme});if(me){me.appearance={...me.appearance,design,theme,source:'personal'};api('/account/appearance','POST',{design,theme}).catch(()=>{});}if(dialog.open)dialog.close();me?await render():loginView();
    }
    else if(action==='language'){lang=lang==='ar'?'en':'ar';localStorage.setItem('36t-lang',lang);if(dialog.open)dialog.close();me?await render():loginView();}
    else if(action==='logout'){await api('/logout','POST',{});me=null;csrf=null;if(typeof clearOfflineCaches==='function')clearOfflineCaches();loginView();}
    // بطاقة «اليوم»: البصمة بنقرة واحدة. الوقت من الخادم؛ الرد يحمل لوحة الحضور فيُعرض الوقت المسجل كما حفظه الخادم.
    else if(action==='punch'){
      const kind=button.dataset.kind==='out'?'out':'in';button.disabled=true;
      try{const board=await api('/attendance/punch','POST',{kind});const at=kind==='in'?board?.me?.today?.check_in:board?.me?.today?.check_out;
        toast(kind==='in'?tr(`سُجل حضورك الساعة ${at??''} بوقت الخادم`,`Checked in at ${at??''} server time`):tr(`سُجل انصرافك الساعة ${at??''} بوقت الخادم`,`Checked out at ${at??''} server time`));}
      finally{button.disabled=false;}
      await render();
    }
    else if(action==='reload')await render();
    else if(action==='close'){if(!allowRequestDiscard())return;dialogEpoch++;dialog.close();}
    else if(action==='turki-followup'){
      dialogEpoch++;dialog.close();
      const ask=document.querySelector('#main [data-action="operation"][data-module="policy-assistant"][data-operation="ask_policy"]');
      if(!ask)throw Error('أعد فتح «اسأل تركي» وابدأ سؤالًا جديدًا');
      ask.click();
    }
    else if(action==='open-metric'||action==='open-executive-signal'){
      const id=button.dataset.id;if(!/^[a-z0-9._-]{3,80}$/.test(id??''))throw Error(tr('المؤشر غير صالح','Invalid metric'));
      const detail=await api('/executive/drilldown/'+encodeURIComponent(id));
      showDialog(detail.metric?.label??tr('تفاصيل المؤشر','Metric details'),executiveCockpitUI.form('open-metric',id,detail));
    }
    else if(action==='row-add'){const box=button.closest('[data-rows]'),body=box.querySelector('tbody');if(body.children.length>=Number(box.dataset.max))throw Error(tr('بلغت الحد الأقصى للصفوف','Row limit reached'));body.append(box.querySelector('template').content.cloneNode(true));body.lastElementChild.querySelector('input,select')?.focus();}
    else if(action==='row-remove'){const box=button.closest('[data-rows]'),body=box.querySelector('tbody');if(body.children.length>Number(box.dataset.min))button.closest('tr').remove();else for(const input of button.closest('tr').querySelectorAll('input'))input.value='';}
    else if(action==='operation'){
      const module=button.dataset.module;if(module!==operationView||module!==view||!operationData)throw Error('أعد تحميل مساحة العمل');
      // نقطة النماذج الوحيدة: نموذج يعلن entity تُضاف إليه الحقول المخصّصة المنشورة، وتحمل toPayload الملفوفة custom_fields (definitions-client.mjs).
      let operationSpec=operationModules[module].form(button.dataset.operation,button.dataset.id,operationData);
      if(typeof extendForm==='function')operationSpec=extendForm(operationSpec,lang);
      const verb=String(operationSpec.submit||button.textContent||'').replace(/\s+/g,' ').trim()||operationSpec.title;
      if(!showDialog(operationSpec.title,`<form id="operation-form"><div class="form-grid">${operationFields(operationSpec.fields,e,label=>typeof glossaryText==='function'?glossaryText(label,view,lang):label)}</div>${formEnd(verb,destructive.test(button.dataset.operation||'')||destructive.test(verb)?'danger':'dark')}</form>`))return;
      operationForms.set(dialog.querySelector('#operation-form'),operationSpec);
      if(typeof applyConditions==='function')applyConditions(dialog.querySelector('#operation-form'));
      // معاينة حية اختيارية (live): تُحسب من قيم النموذج عند كل تغيير، والخادم يعيد التحقق عند الحفظ.
      const liveForm=dialog.querySelector('#operation-form');
      if(typeof operationSpec.live==='function'&&liveForm){const box=document.createElement('div');box.id='operation-live';box.className='notice';box.setAttribute('role','status');box.setAttribute('aria-live','polite');liveForm.querySelector('.form-grid')?.after(box);
        const paint=()=>{try{box.innerHTML=operationSpec.live(Object.fromEntries(new FormData(liveForm)),e)||'';}catch(error){box.textContent=error.message;}};liveForm.addEventListener('input',paint);liveForm.addEventListener('change',paint);paint();}
      operationSpec.opened?.(dialog.querySelector('#operation-form')); /* attendance rules (099): a form may start work when it opens, e.g. GPS sampling before a punch */
      if(operationView==='appearance'){const f=dialog.querySelector('#operation-form'),d=document.documentElement.dataset;swapLook(()=>{if(DESIGNS.includes(f?.elements.design?.value))d.design=f.elements.design.value;if(THEMES.includes(f?.elements.theme?.value))d.theme=f.elements.theme.value;});} /* integrator: the form opens with the chosen design preselected, so preview it at once instead of waiting for a change event (B-7); closing without saving repaints the saved look */
    }
    // الحفظ العام لقيم الحقول المخصّصة لسجلٍ نموذجُه غير مفتوح: النموذج نفسه ومسار واحد لكل الكيانات (POST /api/records/:entity/:id/custom-fields).
    else if(action==='custom-fields'){
      const valuesSpec=typeof valuesForm==='function'?valuesForm(button.dataset.entity,button.dataset.id,lang):null;
      if(!valuesSpec)throw Error(tr('لا حقل مخصّص تعدّله بحسابك في هذا السجل الآن. أعد تحميل الصفحة لترى حالته.','No custom field on this record is editable by your account now.'));
      if(!showDialog(valuesSpec.title,`<form id="operation-form"><div class="form-grid">${operationFields(valuesSpec.fields,e)}</div>${formEnd(valuesSpec.submit)}</form>`))return;
      operationForms.set(dialog.querySelector('#operation-form'),valuesSpec);
      if(typeof applyConditions==='function')applyConditions(dialog.querySelector('#operation-form'));
    }
    // محرّر الصفحة: درج فوق الصفحة نفسها، يُحمَّل عند أول فتح. data-entity يفتحه على كيان بعينه (من شاشة «تعريفات الصفحات»).
    else if(action==='page-editor'){
      const wanted=button.dataset.entity,known=typeof definitionsSnapshot==='function'?Object.values(definitionsSnapshot()?.entities??{}):[];
      const entities=wanted==='platform'?[{key:'platform',label:{ar:'مصطلحات المنصة',en:'Platform terms'},terms_only:true}]:wanted?known.filter(x=>x.key===wanted):typeof editableEntities==='function'?editableEntities(view):[];
      if(!entities.length)throw Error(tr('لا كيان مربوط بهذه الصفحة في سجل التعريفات، أو لا تحمل تصريح العمل عليه.','No registry entity is bound to this page for your account.'));
      pageEditor??=await import('./page-editor.mjs');
      // الزر نفسه يُمرَّر ليعود إليه التركيز عند إغلاق الدرج (لا إلى أول الصفحة).
      await pageEditor.openPageEditor({view,entities,me,api,e,tr,lang,date,ui:uiKit,rerender:render,toast,opener:button});
    }
    // «جرّب كمستخدم»: الدور المختار وسبب مكتوب. الخادم يحسب التصاريح المخفَّضة ويرفض كل كتابة حتى تُنهى التجربة.
    else if(action==='view-as'){
      const personas=[['employee',tr('موظف عادي','Ordinary employee')],...['manager','pm','hr'].map(role=>[role,termOr('role.'+role,tr(...roleNames[role]))])];
      if(!showDialog(tr('جرّب كمستخدم','Try as a user'),`<form id="view-as-form"><p>${tr('ترى المنصة بتصاريح الدور المختار التي تحملها أنت أيضًا، وبهويتك أنت: لا تدخل حساب زميل، فلا تُفتح لك قسيمته ولا حالاته. قراءة فقط: الخادم يرفض كل اعتماد ودفع وتنفيذ وإكمال وتغيير تصريح. تنتهي بعد 30 دقيقة أو من الشريط الأحمر، وتُسجَّل بسببها وما فتحته فيها.','You see the platform with the chosen role’s capabilities that you also hold, as yourself. Read-only: the server refuses every action. It ends after 30 minutes or from the red banner, and is recorded.')}</p><label><span>${tr('الدور الذي تجرّبه','Role to try')}</span><select name="persona">${personas.map(([value,name])=>`<option value="${e(value)}">${e(name)}</option>`).join('')}</select></label><label><span>${tr('سبب التجربة (يُحفظ في السجل)','Reason (kept in the record)')}</span><textarea name="reason" required minlength="10" maxlength="500"></textarea></label>${formEnd(tr('ابدأ التجربة','Start the trial'))}</form>`))return;
    }
    else if(action==='view-as-stop'){await api('/view-as/stop','POST',{});const auth=await api('/me');me=auth.user;csrf=auth.csrf;envBadge=auth.environment??null;paintEnvironment();toast(tr('انتهت التجربة. عدت إلى حسابك وتصاريحك.','The trial ended. You are back on your own account.'));await render();}
    else if(action==='transfer'){
      const targets=requestDetail.transfer_targets||[];
      if(!targets.length)throw Error(tr('لا توجد إدارة مستقبِلة بدور المنفذ لهذه الخدمة','No receiving department has this service role'));
      if(!showDialog(tr('تحويل الطلب','Transfer the request'),`<form id="transfer-form" data-id="${e(requestDetail.id)}" data-version="${requestDetail.version}"><label><span>${tr('الإدارة المستقبِلة','Receiving department')}</span><select name="department_id">${targets.map(d=>`<option value="${e(d.id)}">${e(d.name)}</option>`).join('')}</select></label><label><span>${tr('سبب التحويل','Reason')}</span><textarea name="reason" required minlength="3" maxlength="1000"></textarea></label><p class="subtle">${tr('يعود الطلب غير مُستلم لدى الإدارة الجديدة، ويُسجل التحويل في الأثر.','The request returns unclaimed to the new department, and the transfer is recorded in the trail.')}</p>${formEnd(tr('تحويل','Transfer'))}</form>`))return;
    }
    else if(action==='assign-task'){
      const team=requestDetail.team||[];
      if(!team.length)throw Error(tr('لا يوجد أعضاء نشطون في الإدارة المنفذة','The handling department has no active members'));
      if(!showDialog(tr('إسناد مهمة','Assign a task'),`<form id="task-assign-form" data-id="${e(requestDetail.id)}" data-version="${requestDetail.version}"><label><span>${tr('المهمة','Task')}</span><input name="title" required minlength="3" maxlength="180"></label><label><span>${tr('المكلف','Assignee')}</span><select name="assignee_id">${team.map(u=>`<option value="${e(u.id)}">${e(u.name)}</option>`).join('')}</select></label><label><span>${tr('موعد الاستحقاق','Due date')}</span><input name="due_date" type="date" required></label><label><span>${tr('معيار القبول','Acceptance criteria')}</span><textarea name="acceptance" required minlength="3" maxlength="2000"></textarea></label>${formEnd(tr('إسناد','Assign'))}</form>`))return;
    }
    else if(action==='settle-task'){
      const mode=button.dataset.mode;
      if(!showDialog(mode==='complete'?tr('إكمال المهمة','Complete the task'):tr('إلغاء المهمة','Cancel the task'),`<form id="task-settle-form" data-id="${e(requestDetail.id)}" data-task="${e(button.dataset.id)}" data-mode="${e(mode)}" data-version="${requestDetail.version}"><label><span>${mode==='complete'?tr('دليل الإنجاز','Completion evidence'):tr('سبب الإلغاء','Reason')}</span><textarea name="evidence" required minlength="3" maxlength="3000"></textarea></label>${formEnd(mode==='complete'?tr('إكمال','Complete'):tr('إلغاء المهمة','Cancel task'))}</form>`))return;
    }
    else if(action==='finish-task'){await api('/work/tasks/'+button.dataset.id,'PATCH',{status:'done'});await render();}
    else if(action==='drop-task'){await api('/work/tasks/'+button.dataset.id,'POST',{action:'delete'});await render();}
    else if(action==='change-password')passwordView(false);
    else if(action==='create-menu'){
      // نقرة الفأرة التي أغلقت القائمة (النقر خارجها يسبق click) لا تعيد فتحها من الزر نفسه؛ Enter/Space (detail=0) يفتحها دائمًا.
      if(createMenuOpen()){closeCreateMenu();return;}
      if(ev.detail>0&&createDismissed.el===button&&Date.now()-createDismissed.at<400)return;
      openCreateMenu(button);
    }
    else if(action==='new-request')await requestForm(button.dataset.id);
    else if(action==='pick-department'){launcherState={selected:button.dataset.id||'',query:''};const search=launcherRoot().querySelector('#launcher-search');if(search)search.value='';paintLauncher();launcherRoot().querySelector('#launcher-dynamic')?.scrollIntoView?.({block:'nearest'});}
    else if(action==='pick-service'){if(dialog.open&&document.querySelector('[data-launcher]')){const s=services.find(x=>x.id===button.dataset.id);if(!s)throw Error(tr('الخدمة غير متاحة','Service unavailable'));if(openModuleForm(s))return;showComposer(s);}else await requestForm(button.dataset.id);}
    // عدسة مركز الخدمات: تُحفظ للحساب ثم تُعاد الشاشة بها. فشل الحفظ لا يبتلع النقرة — يصل كرسالة خطأ كغيره.
    // وبعد إعادة الرسم يعود التبئير إلى التبويب المختار لا إلى أعلى الوثيقة (مراجعة 23 سبتمبر).
    else if(action==='catalog-lens'){await api('/catalog/lens','POST',{lens:button.dataset.lens},crypto.randomUUID());await render();document.querySelector('[data-action="catalog-lens"][aria-selected="true"]')?.focus?.({preventScroll:true});}
    // «لا تقترح هذه عليّ» / «اقترحها من جديد» و«أخفِ المقترحات»: تفضيلان شخصيان يُحفظان ثم تُعاد الشاشة بهما، والتبئير يعود إلى زرّ الصفّ.
    else if(action==='hide-suggestion'){await api('/catalog/hide-suggestion','POST',{item_kind:button.dataset.kind,item_key:button.dataset.key,hidden:button.dataset.hidden==='1'});await render();(document.querySelector('[data-action="suggestions-hidden"]')??document.querySelector('#catalog-search'))?.focus?.({preventScroll:true});}
    else if(action==='suggestions-hidden'){await api('/catalog/suggestions-hidden','POST',{hidden:button.dataset.hidden==='1'});await render();document.querySelector('[data-action="suggestions-hidden"]')?.focus?.({preventScroll:true});}
    else if(action==='launcher-back')showLauncher();
    // بطاقة خيارات: اختيار النوع أول خطوة، ويعيد رسم النموذج بحقول الخيار ومسار خدمته. الخيار المطابق للبحث يصل مختارًا.
    // من بطاقة الدليل أو صفحة الخدمة تصل النقرة بلا نافذة الطلب الجديد قبلها، فتُحمَّل المشاريع كما يحمّلها requestForm وإلا رُسم حقل الربط بلا مشاريع.
    else if(action==='pick-variant'){if(!launcherDepartments.length)launcherDepartments=await api('/departments');if(!projectList.length)projectList=await api('/projects');if(!variantGroups.length)await loadVariants();showVariant(button.dataset.group,button.dataset.option);}
    else if(action==='edit-request')await requestForm(requestDetail.service_id,true);
    else if(action==='record-service-output'){
      const gate=requestDetail.delivery_outputs,contract=gate?.contract;if(!contract)return;
      const reference=contract.requires_attachment
        ?`<label><span>${tr('ملف التسليم المحفوظ على الطلب','Delivery file attached to the request')}</span><select name="attachment_id" required>${requestDetail.attachments.map(file=>`<option value="${e(file.id)}" dir="ltr">${e(file.filename)}</option>`).join('')}</select></label>`
        :`<label><span>${tr('معرّف السجل في الوحدة','Record ID in the module')}</span><input name="record_id" required maxlength="100" dir="ltr"></label>`;
      if(contract.requires_attachment&&!requestDetail.attachments.length)throw Error(tr('أضف ملف التسليم إلى مرفقات الطلب أولًا','Attach the delivery file to the request first'));
      showDialog(tr('تسجيل المخرج الفعلي','Record actual output'),`<form id="service-output-form" data-id="${e(requestDetail.id)}" data-version="${requestDetail.version}"><p>${tr('المخرج المطلوب','Required output')}: <strong>${e(contract.output_label)}</strong></p><p class="subtle">${tr('سجّل المخرج في وحدته أولًا ثم اربط معرّفه هنا.','Record the output in its module first, then link its ID here.')} <a href="${e(contract.route)}">${tr('فتح الوحدة','Open module')}</a></p>${reference}<label><span>${tr('اسم المخرج','Output title')}</span><input name="title" required minlength="5" maxlength="240"></label><label><span>${tr('دليل ما تحقق','Evidence of delivery')}</span><textarea name="evidence" required minlength="20" maxlength="3000"></textarea></label>${formEnd(tr('إرسال لصاحب الطلب','Send to requester'))}</form>`);
    }
    else if(action==='decide-service-output'){
      const decision=button.dataset.decision,accept=decision==='accept';
      showDialog(accept?tr('قبول المخرج','Accept output'):tr('رفض المخرج','Reject output'),`<form id="service-output-decision-form" data-id="${e(button.dataset.id)}" data-decision="${e(decision)}" data-version="${e(button.dataset.version)}"><p>${accept?tr('تحقق من المرجع والنتيجة قبل القبول. بعد القرار لا يمكن تعديله.','Check the reference and result before accepting. The decision is final.'):tr('اكتب ما ينقص المخرج ليصححه المنفذ ويسجل بديلًا.','State what is missing so the executor can record a replacement.')}</p><label><span>${accept?tr('دليل التحقق والقبول','Acceptance evidence'):tr('سبب الرفض وما يلزم تصحيحه','Reason and required correction')}</span><textarea name="note" required minlength="10" maxlength="1200"></textarea></label>${formEnd(accept?tr('قبول نهائي','Accept permanently'):tr('رفض المخرج','Reject output'),accept?'dark':'danger')}</form>`);
    }
    // الإغلاق صار بابًا واحدًا يمر بـcloseWithEvidence: الوصف عشرون حرفًا فأكثر لأنه ما سيقرؤه صاحب الطلب
    // وما سيُحتج به بعد شهر، ومنه يُكتب سجل الإغلاق الذي تُبنى عليه إعادة الفتح. بقية الانتقالات كما كانت.
    else if(action==='transition'){const a=button.dataset.transition,closing=a==='complete';
      const label=closing?tr('وصف ما سُلِّم فعلًا (مطلوب)','What was actually delivered (required)'):['return','reject','escalate','release'].includes(a)?tr('السبب (مطلوب)','Reason (required)'):tr('ملاحظة (اختيارية)','Note (optional)');
      const hint=closing?`<small class="subtle">${tr('عشرون حرفًا على الأقل. يُحفظ سجلَّ إغلاق يقرؤه صاحب الطلب، وعليه تُبنى مهلة إعادة الفتح؛ «تم» ليست وصفًا.','At least twenty characters. It is kept as the closure record the requester reads, and the reopening window is built on it.')}</small>`:'';
      // «مراجعة ثم تقديم» (مركز الخدمات، الدفعة الثالثة): ما أُدخل يُقرأ جدولًا من العدّة فوق زرّ التقديم، من الحمولة نفسها.
      showDialog(actionLabel(a),`<form id="transition-form" data-id="${e(requestDetail.id)}" data-version="${requestDetail.version}" data-transition="${e(a)}"><p>${e(requestDetail.title)}</p>${reviewMode(a)?reviewTable(requestDetail,reviewMode(a)):''}<label class="mt"><span>${label}</span><textarea name="note" maxlength="3000" ${closing?'required minlength="20"':a==='release'?'required minlength="10"':['return','reject','escalate'].includes(a)?'required minlength="3"':''}></textarea></label>${hint}${formEnd(actionLabel(a),['reject','cancel'].includes(a)?'danger':'dark')}</form>`);}
    else if(action==='rate-service'){if(!requestDetail.feedback?.can_rate)return;showDialog('تقييم جودة الخدمة',`<form id="service-feedback-form" data-id="${e(requestDetail.id)}" data-version="${requestDetail.version}"><label>التقييم<select name="rating" required><option value="">اختر تقييمًا</option><option value="5">5 — ممتاز</option><option value="4">4 — جيد</option><option value="3">3 — مقبول</option><option value="2">2 — يحتاج تحسينًا</option><option value="1">1 — غير مرضٍ</option></select></label><label>الملاحظة (مطلوبة للتقييم 1 أو 2)<textarea name="comment" maxlength="2000"></textarea></label><p>لا يمكن تعديل التقييم بعد حفظه.</p>${formEnd('حفظ التقييم')}</form>`);}
    else if(action==='attach')showDialog(tr('إضافة مرفق','Add attachment'),`<form id="attachment-form" data-id="${e(requestDetail.id)}" data-version="${requestDetail.version}"><label><span>${tr('اختر ملفًا','Choose a file')}</span><input name="file" type="file" accept=".txt,.pdf,.png" required></label><p class="subtle">${tr('TXT أو PDF أو PNG، حتى 2 ميغابايت.','TXT, PDF or PNG, up to 2 MB.')}</p>${formEnd(tr('رفع الملف','Upload file'))}</form>`);
    else if(action==='read-notification'){await api('/notifications/'+button.dataset.id+'/read','POST',{});await render();}
    else if(action==='read-all-notifications'){const r=await api('/notifications/read-all','POST',{});toast(tr(`عُلّم ${r.marked} إشعارًا كمقروء`,`${r.marked} marked as read`));await render();}
    else if(action==='new-project'){
      const opening=++dialogEpoch,turn=renderId;const team=await api('/team');if(turn!==renderId||opening!==dialogEpoch)return;showDialog(tr('مشروع جديد','New project'),`<form id="project-form"><label><span>${tr('اسم المشروع','Project name')}</span><input name="name" required maxlength="180"></label><label><span>${tr('موجز المشروع','Project brief')}</span><textarea name="brief" required maxlength="3000"></textarea></label><label>${tr('أعضاء الفريق','Team members')}</label>${team.filter(u=>u.id!==me.id).map(u=>`<label class="check"><input type="checkbox" name="member" value="${e(u.id)}"><span>${e(u.name)}</span></label>`).join('')}${formEnd(tr('إنشاء المشروع','Create project'))}</form>`);
    }else if(action==='new-task'){
      const p=projectList.find(p=>p.id===button.dataset.id);showDialog(tr('إسناد مهمة','Assign a task'),`<form id="task-form" data-project="${e(p.id)}"><label><span>${tr('المهمة','Task')}</span><input name="title" required maxlength="180"></label><label><span>${tr('المكلف','Assignee')}</span><select name="assignee_id">${p.members.map(m=>`<option value="${e(m.id)}">${e(m.name)}</option>`).join('')}</select></label><label><span>${tr('تاريخ الاستحقاق','Due date')}</span><input name="due_date" type="date" required></label><label><span>${tr('معيار القبول','Acceptance criteria')}</span><textarea name="acceptance" required maxlength="2000"></textarea></label>${formEnd(tr('إسناد','Assign'))}</form>`);
    }else if(action==='complete-task')showDialog(tr('توثيق إنجاز المهمة','Record task completion'),`<form id="task-complete-form" data-id="${e(button.dataset.id)}" data-version="${e(button.dataset.version)}"><label><span>${tr('دليل الإنجاز','Completion evidence')}</span><textarea name="evidence" required minlength="3" maxlength="3000"></textarea></label>${formEnd(tr('إكمال المهمة','Complete task'))}</form>`);
    else if(action==='new-service'){
      const opening=++dialogEpoch,turn=renderId;const departments=await api('/departments');if(turn!==renderId||opening!==dialogEpoch)return;showDialog(tr('إعداد خدمة جديدة','Configure a service'),`<form id="service-form"><div class="form-grid"><label><span>${tr('رمز الخدمة','Service code')}</span><input name="code" pattern="[A-Z][A-Z0-9_-]{2,39}" required placeholder="IT-REQUEST" dir="ltr"></label><label><span>${tr('الإدارة المنفذة','Service department')}</span><select name="department_id">${departments.map(d=>`<option value="${e(d.id)}" ${d.id===button.dataset.department?'selected':''}>${e(d.name)}</option>`).join('')}</select></label><label><span>${tr('الاسم بالعربية','Arabic name')}</span><input name="name_ar" required maxlength="150"></label><label><span>${tr('الاسم بالإنجليزية','English name')}</span><input name="name_en" required maxlength="150"></label><label class="full"><span>${tr('وصف الخدمة','Description')}</span><textarea name="description" required maxlength="1000"></textarea></label></div><h3>${tr('حقول النموذج','Form fields')}</h3><div id="builder-fields">${builderField(1)}</div><button class="btn outline small" type="button" data-action="add-field">${tr('إضافة حقل','Add field')}</button><label class="mt"><span>${tr('الاعتماد بعد المدير','Approval after the manager')}</span><select name="second"><option value="">${tr('المدير فقط','Manager only')}</option><option value="hr">${tr('خدمات الموظف','HR')}</option><option value="it">${tr('الدعم التقني','IT')}</option><option value="department_manager">${tr('مدير الإدارة المنفذة','Service department manager')}</option></select></label><label><span>${tr('نمط الاعتماد','Approval mode')}</span><select name="approval_mode"><option value="sequential">${tr('متسلسل','Sequential')}</option><option value="parallel">${tr('متوازٍ — كل المعتمدين','Parallel, all approvers')}</option></select></label><label><span>${tr('دور المنفذ','Executor role')}</span><select name="handler_role"><option value="it">${tr('الدعم التقني','IT')}</option><option value="hr">${tr('خدمات الموظف','HR')}</option><option value="manager">${tr('المدير','Manager')}</option></select></label><p class="subtle">${tr('إعادة استخدام الرمز تنشئ إصدارًا جديدًا. يجب وجود معتمد نشط واحد للدور داخل الإدارة.','Reusing a code creates a new version. Each department approval role needs one active approver.')}</p>${formEnd(tr('حفظ إصدار الخدمة','Save service version'))}</form>`);
    }else if(action==='add-field'){const container=document.querySelector('#builder-fields');if(container.children.length<12)container.insertAdjacentHTML('beforeend',builderField(container.children.length+1));}
  }catch(error){toast(error.message);}
});
function builderField(i){return `<fieldset class="builder-field"><legend>${tr('حقل','Field')} ${i}</legend><div class="form-grid"><label><span>${tr('المعرف','Key')}</span><input name="key_${i}" pattern="[a-z][a-z0-9_]{1,39}" required dir="ltr"></label><label><span>${tr('التسمية','Label')}</span><input name="label_${i}" required maxlength="100"></label><label><span>${tr('النوع','Type')}</span><select name="type_${i}"><option value="text">${tr('نص قصير','Short text')}</option><option value="textarea">${tr('نص متعدد الأسطر','Long text')}</option><option value="date">${tr('تاريخ','Date')}</option><option value="number">${tr('رقم أو مبلغ','Number or amount')}</option></select></label><label class="check"><input type="checkbox" name="required_${i}" checked><span>${tr('مطلوب','Required')}</span></label></div></fieldset>`;}
document.addEventListener('keydown',ev=>{
  // Enter في «ابحث عن شاشة»: يفتح أول شاشة مطابقة، وإن لم تطابق شاشة يقود إلى البحث الشامل بالكلمة نفسها.
  if(ev.key==='Enter'&&ev.target?.id==='nav-search'){const q=ev.target.value.trim(),first=document.querySelector('.nav a:not([hidden])');if(!q)return;ev.preventDefault();if(first)first.click();else if(me?.can?.includes('search.use')){document.querySelector('[data-shell="drawer-close"]')?.click();location.hash='search/'+encodeURIComponent(q);}return;}
  if(ev.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(ev.target?.tagName)){const search=dialog.open?dialog.querySelector('#launcher-search'):document.querySelector('#catalog-search')??launcherRoot().querySelector('#launcher-search');if(search){ev.preventDefault();search.focus();}}
  // عدسات مركز الخدمات (role="tablist"): السهمان ينقلان التبئير بين التبويبات، والتفعيل بـEnter/Space على الزر نفسه (تفعيل يدوي: التبديل نداءٌ للخادم فلا يُطلق بمجرد المرور).
  if(['ArrowLeft','ArrowRight'].includes(ev.key)&&ev.target?.dataset?.action==='catalog-lens'){const tabs=[...document.querySelectorAll('[data-action="catalog-lens"]')],i=tabs.indexOf(ev.target);if(i<0)return;ev.preventDefault();tabs[(i+(ev.key==='ArrowLeft'?1:tabs.length-1))%tabs.length].focus();}});
document.addEventListener('input',ev=>{if(ev.target.id==='benchmark-search'){const q=ev.target.value.trim().toLowerCase();let n=0;document.querySelectorAll('[data-benchmark-search]').forEach(card=>{card.hidden=!card.dataset.benchmarkSearch.includes(q);if(!card.hidden)n++;});document.querySelector('#benchmark-search-status').textContent=`${n} وحدة مطابقة`;return;}if(ev.target.id==='portal-service-search'){const fold=value=>String(value??'').toLowerCase().replace(/[\u064B-\u0652\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه'),query=fold(ev.target.value.trim());let visible=0;document.querySelectorAll('[data-portal-service]').forEach(card=>{card.hidden=!!query&&!fold(card.dataset.portalService).includes(query);if(!card.hidden)visible++;});document.querySelectorAll('[data-portal-group]').forEach(group=>{group.hidden=!group.querySelector('[data-portal-service]:not([hidden])');if(query&&!group.hidden)group.open=true;});const status=document.querySelector('#portal-service-search-status');if(status)status.textContent=visible?`${visible} خدمة مطابقة`:'لا توجد خدمة مطابقة ضمن صلاحيات حسابك';return;}if(ev.target.dataset?.filter){applyTableFilters(ev.target.dataset.filter);return;}// بحث مركز الخدمات: يعيد رسم منطقة النتائج وحدها، ويعود إلى شبكة الفئات نفسها حين يُفرَّغ الصندوق.
  if(ev.target.id==='catalog-search'){paintCatalogSearch(ev.target.value);return;}if(ev.target.id==='launcher-search'){launcherState={selected:launcherState.selected,query:ev.target.value};paintLauncher();return;}if(ev.target.id==='department-search'){const q=ev.target.value.trim().toLocaleLowerCase();let visible=0;document.querySelectorAll('[data-department-search]').forEach(card=>{card.hidden=!card.dataset.departmentSearch.includes(q);if(!card.hidden)visible++;});document.querySelector('#department-search-status').textContent=visible?`${visible} نتيجة`:'لا توجد إدارة أو خدمة تطابق البحث';}if(ev.target.id==='nav-search'){const fold=v=>String(v).toLowerCase().replace(/[\u064B-\u0652\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه'),q=fold(ev.target.value.trim());document.querySelectorAll('.nav a').forEach(a=>a.hidden=!fold(a.textContent).includes(q));document.querySelectorAll('.nav .hr-nav-section').forEach(x=>x.hidden=!x.querySelector('a:not([hidden])'));document.querySelectorAll('.nav .hr-nav-group').forEach(g=>{g.hidden=!g.querySelector('a:not([hidden])');if(q)g.open=true;});
    // ت1: كتلة «كل شاشاتك» (كل ما يصله الحساب وليس له مدخل) تظهر عند الكتابة وحدها، والصفوف والفاصل الفارغة تختفي معها.
    document.querySelectorAll('.nav .hr-nav-rows').forEach(x=>x.hidden=!x.querySelector('a:not([hidden])'));document.querySelectorAll('.nav .nav-sep').forEach(x=>x.hidden=!!q);
    const reach=document.querySelector('.nav [data-nav-reach]');if(reach)reach.hidden=!q||!reach.querySelector('a:not([hidden])');}const form=ev.target.closest('form');if(form)form.dataset.key=crypto.randomUUID();});
document.addEventListener('submit',async ev=>{
  const form=ev.target;
  if(form.matches?.('[data-workspace-search]')){ev.preventDefault();const q=String(new FormData(form).get('q')??'').trim();if(q)location.hash='search/'+encodeURIComponent(q);return;}
  if(form.dataset?.workspaceForm){
    ev.preventDefault();const submit=form.querySelector('button[type=submit]')||form.querySelector('button:not([type])');if(submit)submit.disabled=true;
    try{
      const values=Object.fromEntries(new FormData(form)),parts=(location.hash.slice(1)||'').split('/'),spaceId=parts[0]==='workspace'?parts[1]:undefined;
      if(form.dataset.workspaceForm==='file-upload'){
        const file=new FormData(form).get('file');if(!file?.size||file.size>2097152)throw new Error(tr('حجم الملف يجب أن يكون بين بايت واحد و2 ميغابايت','File size must be between 1 byte and 2 MB'));
        const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));values.file={filename:file.name,content:btoa(binary)};
      }
      const recordId=form.dataset.workspaceForm==='project-task-create'?values.target_id:form.dataset.recordId;
      const spec=workspaceUI.form(form.dataset.workspaceForm,recordId,{spaceId}),saved=await api(spec.endpoint,spec.method,spec.toPayload(values),spec.idempotent?(form.dataset.key||=crypto.randomUUID()):undefined);
      toast(tr('تم حفظ العمل','Work saved'));
      if(form.dataset.workspaceForm==='space-ensure'&&saved?.id)location.hash=`workspace/${saved.id}/tasks`;else await render();
    }catch(error){toast(error.message);}finally{if(submit)submit.disabled=false;}
    return;
  }
  if(!form.id)return;ev.preventDefault();const submittedTurn=renderId,submittedEpoch=dialogEpoch;const data=new FormData(form),submit=form.querySelector('button[type=submit]')||form.querySelector('button:not([type])');if(submit)submit.disabled=true;
  const payload=Object.fromEntries([...data].filter(([key])=>key.startsWith('field:')).map(([key,value])=>[key.slice(6),value]));
  const lockedRequestControls=form.id==='request-form'?[...form.elements].map(control=>({control,disabled:control.disabled})):[];
  for(const {control} of lockedRequestControls)control.disabled=true;
  try{
    let result;
    if(form.dataset.form==='wf2'){const body=Object.fromEntries([...data].map(([k,v])=>[k,k==='version'?Number(v):v]));if(form.dataset.version)body.version=Number(form.dataset.version);await api(form.dataset.path,'POST',body);toast(tr('سُجّل','Recorded'));await render();return;}
    if(form.id==='work-task-form'){await api('/work/tasks','POST',{title:data.get('title'),list:form.dataset.list},form.dataset.key);await render();return;}
    if(form.id==='password-form'){if(data.get('new_password')!==data.get('confirm_password'))throw new Error(tr('كلمتا المرور الجديدتان غير متطابقتين','The new passwords do not match'));await api('/account/password','POST',{current_password:data.get('current_password'),new_password:data.get('new_password')});const forced=!!me.must_change_password;me={...me,must_change_password:false};if(dialog.open)dialog.close();toast(tr('تم تغيير كلمة المرور','Password changed'));if(forced)await render();return;}
    if(form.id==='login-form'){const auth=await api('/login','POST',{username:data.get('username'),password:data.get('password'),...(String(data.get('otp')||'').trim()?{otp:String(data.get('otp')).trim()}:{})});me=auth.user;csrf=auth.csrf;envBadge=auth.environment??null;paintEnvironment();applyAppearance(me.appearance);await render();return;}
    if(form.id==='view-as-form'){await api('/view-as/start','POST',{persona:data.get('persona'),reason:data.get('reason')});const auth=await api('/me');me=auth.user;csrf=auth.csrf;envBadge=auth.environment??null;paintEnvironment();if(dialog.open)dialog.close();if(pageEditor)await pageEditor.closePageEditor({silent:true});if(location.hash&&location.hash!=='#home')location.hash='home';else await render();return;}
    if(form.id==='request-filter'){const rows=await api('/requests?q='+encodeURIComponent(data.get('q'))+'&status='+encodeURIComponent(data.get('status')));document.querySelector('#request-results').innerHTML=table(rows);return;}
    if(form.id==='scope-filter'){const q=String(data.get('q')).toLowerCase();document.querySelector('#scope-results').innerHTML=scopeCards(window.scopeRows.filter(r=>[r.id,r.title,r.domain,r.acceptance].join(' ').toLowerCase().includes(q)));return;}
    if(form.id==='request-form'){const edit=form.dataset.edit==='true',variant=data.get('variant_group')?{variant:{group:data.get('variant_group'),option:data.get('variant_option')}}:{};result=await api(edit?'/requests/'+form.dataset.id:'/requests',edit?'PATCH':'POST',edit?{version:Number(form.dataset.version),title:data.get('title'),payload}:{service_id:data.get('service_id'),title:data.get('title'),payload,project_id:data.get('project_id')||null,...variant},form.dataset.key);
      // «تقديم للاعتماد» في الصفيحة: المسودة بمسارها القائم ثم التقديم بمساره القائم (POST /requests ثم /requests/:id/submit).
      // بعد الحفظ تصير الصفيحة صفيحة تعديل لتلك المسودة: إن ردّ التقديم بنقصٍ عُلّمت الحقول وحُفظ ما كُتب، ولا تولد مسودة ثانية عند الإعادة.
      if(ev.submitter?.value==='submit'&&result?.id){Object.assign(form.dataset,{id:result.id,version:String(result.version),edit:'true'});captureRequestBaseline();result=await api(`/requests/${result.id}/submit`,'POST',{version:Number(result.version)});}}
    else if(form.id==='service-feedback-form')result=await api(`/requests/${form.dataset.id}/feedback`,'POST',{version:Number(form.dataset.version),rating:Number(data.get('rating')),comment:data.get('comment')});
    else if(form.id==='transfer-form')result=await api(`/requests/${form.dataset.id}/transfer`,'POST',{version:Number(form.dataset.version),department_id:data.get('department_id'),reason:data.get('reason')});
    else if(form.id==='task-assign-form')result=await api(`/requests/${form.dataset.id}/tasks`,'POST',{version:Number(form.dataset.version),title:data.get('title'),assignee_id:data.get('assignee_id'),due_date:data.get('due_date'),acceptance:data.get('acceptance')},form.dataset.key);
    else if(form.id==='task-settle-form')result=await api(`/requests/${form.dataset.id}/tasks/${form.dataset.task}`,'POST',{version:Number(form.dataset.version),action:form.dataset.mode,evidence:data.get('evidence')});
    else if(form.id==='service-output-form')result=await api(`/requests/${form.dataset.id}/outputs`,'POST',{version:Number(form.dataset.version),record_id:data.get('record_id')||undefined,attachment_id:data.get('attachment_id')||undefined,title:data.get('title'),evidence:data.get('evidence')},form.dataset.key);
    else if(form.id==='service-output-decision-form')result=await api(`/service-outputs/${form.dataset.id}/${form.dataset.decision}`,'POST',{version:Number(form.dataset.version),note:data.get('note')});
    // الإغلاق يرسل الوصف باسمه «delivered» كما تقرؤه closeWithEvidence؛ الخادم يقبل note أيضًا لمن لم يُحدَّث بعد.
    else if(form.id==='transition-form')result=await api(`/requests/${form.dataset.id}/${form.dataset.transition}`,'POST',{version:Number(form.dataset.version),note:data.get('note'),...(form.dataset.transition==='complete'?{delivered:data.get('note')}:{})});
    else if(form.id==='attachment-form'){
      const file=data.get('file');if(!file.size||file.size>2097152)throw new Error(tr('حجم الملف يجب أن يكون بين بايت واحد و2 ميغابايت','File size must be between 1 byte and 2 MB'));
      const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      result=await api(`/requests/${form.dataset.id}/attachments`,'POST',{version:Number(form.dataset.version),filename:file.name,content:btoa(binary)});
    }else if(form.id==='project-form')await api('/projects','POST',{name:data.get('name'),brief:data.get('brief'),member_ids:data.getAll('member')},form.dataset.key);
    else if(form.id==='task-form')await api(`/projects/${form.dataset.project}/tasks`,'POST',Object.fromEntries(data),form.dataset.key);
    else if(form.id==='task-complete-form')await api(`/tasks/${form.dataset.id}/complete`,'POST',{version:Number(form.dataset.version),evidence:data.get('evidence')});
    else if(form.id==='operation-form'){
      const spec=operationForms.get(form);
      if(!spec)throw Error('أعد فتح النموذج');
      const values=Object.fromEntries(data);
      if(spec.fields.some(f=>f.type==='rows'||f.type==='checks'))collectStructured(form,spec.fields,values);
      for(const [name,value] of Object.entries(values)){
        if(!value||typeof value!=='object'||typeof value.arrayBuffer!=='function')continue;
        if(!value.size){delete values[name];continue;}
        if(value.size>2097152)throw new Error(tr('الحد الأقصى للملف 2 ميغابايت','Files are limited to 2 MB'));
        const bytes=new Uint8Array(await value.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        values[name]={filename:value.name,content:btoa(binary)};
      }
      const saved=await api(spec.dynamicEndpoint?spec.dynamicEndpoint(values):spec.endpoint,spec.method||'POST',spec.toPayload(values),spec.idempotent?form.dataset.key:undefined);
      if(saved?.appearance){me.appearance=saved.appearance;applyAppearance(saved.appearance);}
      // بعض العمليات تعيد ما يجب أن يراه المستخدم مرة واحدة (مثل رموز الاسترداد).
      const once=spec.after?.(saved,e);
      if(once){await render();showDialog(once.title,once.html);return;}
    }
    else if(form.id==='service-form'){
      const fields=[...form.querySelectorAll('.builder-field')].map((_,index)=>{const i=index+1;return {key:data.get('key_'+i),label:data.get('label_'+i),type:data.get('type_'+i),required:data.has('required_'+i)};});
      await api('/catalog','POST',{code:data.get('code'),name_ar:data.get('name_ar'),name_en:data.get('name_en'),description:data.get('description'),department_id:data.get('department_id'),fields,approval_policy:{steps:['manager',...(data.get('second')?[data.get('second')]:[])],handler_role:data.get('handler_role'),mode:data.get('approval_mode')}},form.dataset.key);
    }
    if(submittedTurn!==renderId||submittedEpoch!==dialogEpoch||!dialog.open){toast(tr('تم حفظ العملية السابقة','Previous operation saved'));return;}
    captureRequestBaseline();
    dialog.close();
    // رسالة التأكيد بعد الحفظ والتقديم تقول المرحلة وعند من الطلب الآن — من الحمولة (whereabouts) لا من نصٍّ هنا.
    const where=result?.whereabouts;
    toast(where?`${tr('تم حفظ العملية','Saved')} · ${where.stage_name} · ${tr('عند','With')}: ${where.with}`:tr('تم حفظ العملية','Saved'));
    // «submitted» في سجل البحث: طلبٌ وُلد وفي اليد معرّف جلسة بحث فُتحت منها بطاقة. البند من الحمولة (رمز خدمة الطلب).
    if(form.id==='request-form'&&result?.id&&searchSession.id&&searchSession.opened){logSearch('submitted',{item_kind:'service',item_key:result.service?.code??searchSession.opened.key});searchSession={id:null,query:'',timer:null,logged:'',opened:null};}
    if(result?.id&&['service-feedback-form','request-form','transition-form','attachment-form','transfer-form','task-assign-form','task-settle-form'].includes(form.id)){if(location.hash===`#request/${result.id}`)await render();else location.hash=`request/${result.id}`;}else await render();
  }catch(error){if(submittedTurn!==renderId||submittedEpoch!==dialogEpoch){toast(error.message);return;}const target=document.querySelector(dialog.open?'#dialog-error':'#login-error');
    // الرفض المكتوب (app/refusal.mjs) يُرسم كما كُتب — ما رُفض، وما الناقص وعند من، وما الخطوة التالية ورابطها — لا نصًّا مضغوطًا في سطر. ما عداه يبقى شكله كما كان.
    if(target)target.innerHTML=error.details?.refusal?uiKit.refusal(error):`<div class="error">${e(error.message)}</div>`;else toast(error.message);
    for(const {control,disabled} of lockedRequestControls)control.disabled=disabled;
    markFieldErrors(form,error);}
  finally{for(const {control,disabled} of lockedRequestControls)control.disabled=disabled;if(submit)submit.disabled=false;}
});
// الخطأ تحت حقله (مركز الخدمات، الدفعة الثالثة): app/validation.mjs يرسل details.field (حقل واحد) أو details.fields
// (الناقصة كلها). يُعلَّم الحقل aria-invalid ويُربط برسالته aria-describedby، والرسالة نفسها تبقى في #dialog-error أيضًا.
// رسالة المتصفح الأصلية (required/minlength/pattern) تبقى كما هي قبل الإرسال.
function markFieldErrors(form,error){
  if(!form?.querySelectorAll)return;
  for(const old of form.querySelectorAll('.field-error'))old.remove();
  for(const control of form.querySelectorAll('[aria-invalid]')){control.removeAttribute('aria-invalid');control.removeAttribute('aria-describedby');}
  const keys=[...new Set([...(Array.isArray(error?.details?.fields)?error.details.fields:[]),...(error?.details?.field?[error.details.field]:[])])];
  let first=null;
  for(const key of keys){
    const label=form.querySelector(`[data-field="${CSS.escape(String(key))}"]`),control=label?.querySelector('input,select,textarea');
    if(!control)continue;
    const id=`field-error-${key}`;
    control.setAttribute('aria-invalid','true');control.setAttribute('aria-describedby',id);
    if(!first)label.insertAdjacentHTML('beforeend',`<small class="field-error" id="${e(id)}">${e(error.message)}</small>`);
    else control.setAttribute('aria-describedby',`field-error-${keys[0]}`);
    first??=control;
  }
  first?.focus?.();
}
// «مراجعة ثم تقديم»: الحقول الظاهرة بشرطها (show_when كما يفرضه الخادم) وقيمها من حمولة الطلب، جدولًا من العدّة.
//
// وهو في نافذة القرار أيضًا (م1، البند 15). كانت النافذة تُفتح على المعتمِد بعنوان الطلب وخانة ملاحظة وحدهما،
// وهي نافذة معيارية تغطي الصفحة التي فيها التفاصيل — فيُعتمد الطلب أو يُردّ وما فيه ليس أمام من يقرر.
// ولا كشف جديد هنا: الجدول يقرأ r.service.fields وr.payload نفسيهما اللذين ترسمهما صفحة الطلب،
// فما حجبه الخادم عن هذا القارئ محجوب في الموضعين.
const REVIEW_MODES={
  submit:{head:['ما أدخلته','Your entry'],
    note:['راجع ما أدخلته: التقديم يجمّده نسخةً لا تُعدَّل، وما بعده يعود إليك إعادةً من المعتمِد.',
      'Review your entries: submitting freezes them as a revision; changes after that come back to you from the approver.']},
  decide:{head:['ما قُدِّم','Submitted'],
    note:['قرارك على هذه النسخة بعينها: الاعتماد يمضي بها كما هي، والإعادة للتعديل تُرجعها إلى صاحبها.',
      'Your decision applies to this revision as it stands: approving passes it unchanged, returning sends it back to the requester.']},
  work:{head:['ما طُلب','Requested']},
};
function reviewTable(r,mode='submit'){
  const fields=r.service?.fields??[],view=REVIEW_MODES[mode]??REVIEW_MODES.submit;
  const visible=f=>{const rule=f.show_when;if(!rule||typeof rule!=='object'||typeof rule.field!=='string')return true;if(!fields.some(x=>x.key===rule.field))return true;return [].concat(rule.equals).includes(r.payload?.[rule.field]);};
  const rows=fields.filter(visible).map(f=>`<tr><th scope="row">${e(f.label)}</th><td>${e(fieldValue(f,r.payload?.[f.key])||'—')}</td></tr>`);
  return `<div class="rq-review">${uiKit.table({head:[tr('الحقل','Field'),tr(...view.head)],rows,empty:{title:tr('لا حقول في هذه الخدمة','This service has no fields')}})}${view.note?`<p class="subtle">${tr(...view.note)}</p>`:''}</div>`;
}
// «تذكير المعتمد» و«الإلغاء» و«إعادة العمل إلى الطابور» لا قرار فيها على المحتوى، فلا تحمل جدوله.
const reviewMode=action=>action==='submit'?'submit':['approve','return','reject'].includes(action)?'decide':['claim','complete'].includes(action)?'work':null;
dialog.addEventListener?.('cancel',ev=>{if(!allowRequestDiscard())ev.preventDefault();});
window.addEventListener('beforeunload',ev=>{if(requestHasChanges()){ev.preventDefault();ev.returnValue='';}});
dialog.addEventListener?.('close',()=>{dialogEpoch++;paintAppearance();});
// الدرج يخص الصفحة التي فُتح عليها: الانتقال إلى شاشة أخرى يغلقه ويوقف المعاينة، ثم تُرسم الشاشة الجديدة بالمنشور.
window.addEventListener('hashchange',ev=>{if(!allowRequestDiscard()){if(ev?.oldURL)history.replaceState(null,'',ev.oldURL);return;}closeDesignMenu();if(dialog.open)dialog.close();const closing=pageEditor?.isPageEditorOpen?.()?pageEditor.closePageEditor({silent:true}):null;if(closing)closing.then(routeRender,routeRender);else routeRender();});
// عامل الخدمة في سياق آمن فقط (HTTPS أو localhost)؛ محروس لأن الصندوق التجريبي في الاختبارات بلا هذه الوحدة.
if(typeof registerServiceWorker==='function')registerServiceWorker();
try{const auth=await api('/me');me=auth.user;csrf=auth.csrf;envBadge=auth.environment??null;paintEnvironment();applyAppearance(me.appearance);await render();}catch{loginView();}
