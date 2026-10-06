// الصفحة الرئيسية حسب الدور: بطاقة «اليوم» وأزرار سريعة للموظف، ثم بطاقات تقود كل رقم إلى شاشته، وقوائم مشتقة لحظيًا من مصادرها.
// ملخصي (portal) دُمج هنا (REF-APP-FRONTEND P1-4): #portal يفتح هذه الصفحة. النص الإنجليزي كامل عبر tr() الذي تمرره app.mjs.
//
// ★ تركيب الشاشة (إعادة بناء «اليوم»): الصفحة تبدأ بسؤال واحد كبير — «وش المطلوب منك اليوم؟» — ثم تجيب عليه بالترتيب:
//   تحية خافتة ← السؤال ← سطر العدد ← شريط أفقي ينزلق فيه «طلب جديد» وما تبدأ منه ← بطاقة اليوم ← أربع بلاطات إحصاء
//   ← ملاحظة البيانات ← ثلاث كتل مسمّاة ببطاقات مهام ← «كل طلباتي». وأقسام الأدوار بعدها كما كانت.
// وكل رقم في الشاشة طولُ القائمة التي تحته أو بجانبه، لا رقم يُمرَّر منفصلًا: البلاطة والكتلة تقرآن المصفوفة نفسها.
// أصناف hm-* هي عقد الشكل مع app/static/yawm.css؛ وأصناف vn-* وpanel وbtn تبقى معها حتى تقرأ الشاشة في المظاهر الأخرى.
import { dual } from './dates.mjs';
import { countNoun, countEn } from './arabic-count.mjs';
import { icon, familyIcon, quickIcon, statusIcon } from './icons.mjs';
// م0 «السور»: عبارات الحالات والأدوار من القاموس الواحد، لا من نسخة هنا.
import { REQUEST_STATUS as statusNames,ROLE_NAMES as roleNames,REQUESTER_STAGES,stageOf } from './vocabulary.mjs';
// العدّة من ctx.ui، وبلاها (اختبارات ترسم الرئيسية بسياق مختصر) تُبنى من kit نفسها: لا نسخة محلية من البلاطة ولا الحالة الفارغة.
import { kit } from './kit.mjs';
import { unavailableText } from './deep-links.mjs';
import { placeFor, HUBS } from './nav-map.mjs';
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة.');};
const expiryNames={expired:['انتهت','Expired'],due_soon:['قرّبت تنتهي','Expiring soon'],ok:['سارية','Valid']};
const NEEDS_YOU=REQUESTER_STAGES.needs_you;
const ISO_DAY=/^\d{4}-\d{2}-\d{2}/;
// الأيام بلهجة المنصة: «يوم» و«يومين» و«3 أيام» و«15 يوم»؛ والإنجليزية بجمعها البسيط.
const dayWord=n=>{const a=Math.abs(Number(n));return a===1?'يوم':a===2?'يومين':`${a} ${a>=3&&a<=10?'أيام':'يوم'}`;};
// موجز المالك (30 سبتمبر 2026) البند 2: «تحويل البطاقات إلى قوائم عمل حقيقية — يظهر داخل كل عنصر:
// الحالة، المسؤول، الموعد، المرحلة، والإجراء التالي». الخمسة كلها كانت في حمولة /home ولا تُرسم؛
// الشارة تقول الحالة، ومؤشّر الخطوات يقول المرحلة، وهذه الأسماء للثلاثة الباقية.
const factNames={owner:['صاحبه','Raised by'],with:['عند','Now with'],due:['الموعد','Due'],next:['التالي','Next'],act:['المطلوب منك','Your move'],doing:['المطلوب','To do']};
// مصدر الموعد بلغتيه: الخادم يبني العبارة العربية في app/obligations.mjs (WAITING_NOTE) ولا يترجم،
// فتُقابَل هنا بمفتاح المصدر وحده — كما تُقابَل مصادر الزمن في timeNote أدناه.
const basisNames={service_target:['الزمن المستهدف لخدمته','its service level'],record_due_date:['موعد السجل نفسه',"the record's own due date"],
  task_due_date:['موعد المهمة','the task due date'],working_days_waiting:['محسوب من مهلة الانتظار المعتمدة','from the approved waiting limit'],
  optional:['اختياري: لا موعد له','optional — no due date'],none:['بلا موعد معتمد','no approved due date']};
const cardNames={decisions:['ما ينتظر قراري','Awaiting my decision'],my_requests:['طلباتي المفتوحة','My open requests'],tasks:['مهامي','My tasks'],leave:['رصيد إجازتي','My leave balance'],my_documents:['وثائقي اللي قرّبت تنتهي','My expiring documents'],
  team_late:['طلبات فريقي المتأخرة',"My team's late requests"],request_approvals:['طلبات تنتظر اعتمادي','Requests awaiting my approval'],respond:['ما ينتظر ردّي','Awaiting my reply'],department_overruns:['تجاوزات المدة في إدارتي','Overruns in my department'],
  expired_documents:['وثائق منتهية','Expired documents'],due_soon_documents:['وثائق قرّبت تنتهي','Documents expiring soon'],ended_contracts:['عقود منتهية','Ended contracts'],hr_requests:['طلبات الموارد البشرية المفتوحة','Open HR requests'],
  overdue_receivables:['مستحقات متأخرة','Overdue receivables'],pending_payment_orders:['أوامر دفع معلقة','Pending payment orders'],open_periods:['فترات ما انقفلت','Open periods'],
  discipline:['مخالفاتي وجزاءاتي','My violations and penalties']};
const deadlineKinds={request:['طلب','Request'],task:['مهمة','Task'],document:['وثيقة','Document']};
// علامة العائلة من بادئة رمز الخدمة (HR- وADM- وIT-…): خمس بطاقات تحمل المعين نفسه لا تقول شيئًا،
// فيمسحها النظر ولا يقرؤها. البادئة موجودة في كل رمز، والعائلة هي ما يميّز الخدمة عن جارتها في الصف.
// صارت العلامات مرسومة لا أحرف خط (icons.mjs، قرار المالك 1 أكتوبر 2026): عشرون عائلة، عشرون رسمًا
// متمايزًا يمثّل مجالها، وما لا بادئة معروفة له يأخذ النقطة المحايدة فلا تُخترع له علامةٌ تدّعي تصنيفًا.
export const serviceGlyph=code=>familyIcon(code);
// قرص الحالة: لكل حال رسمٌ واحد وصنفٌ واحد، يقرؤهما yawm.css لونًا وهندسة. الرسم زينة (aria-hidden) والنص بجانبه هو الذي يُقرأ.
// قرص الشريط: رسمٌ في قرصٍ بلا نبرة حال — رسوم الإجراءات السريعة وأبواب الشريط، لا حالات البطاقات.
const DISC=glyph=>`<span class="hm-disc" aria-hidden="true">${glyph}</span>`;
const disc=(tone,e)=>`<b class="hm-disc ${e(tone)}" aria-hidden="true">${statusIcon(tone)}</b>`;
// مراحل الطلب على مسارها المعتمد. مصفوفة لا خريطة: الأسماء من القاموس الواحد عند الرسم، ولا نسخة حالات هنا.
// يوم الرياض لطابع زمني (en-CA يعطي YYYY-MM-DD)، كما يقرؤه الخادم بـriyadhDateOf.
const riyadhDayOf=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
const ROUTE=['pending','approved','in_progress','completed'];
// «شغلة» بصورها الأربع: سطر العدد يقول «شغلة وحدة» و«شغلتين» و«3 شغلات» و«15 شغلة»، لا «1 شغلة».
const THINGS=['شغلة وحدة','شغلتين','شغلات','شغلة'];
// و«شاشة» كذلك، لسطر عدد شاشات الإدارة. ليست في قاموس NOUNS فتُمرَّر صورها الأربع كما تُمرَّر THINGS.
const SCREENS=['شاشة وحدة','شاشتين','شاشات','شاشة'];
const fallbackTr=ar=>ar;

// «شغل إدارتي» — بوابة أسماء الشاشات. navReach هي الشاشات التي يبلغها الحساب اليوم: كتلةٌ واحدة في app.mjs
// مشروطة بتصاريحه، تنشرها على globalThis لتقرأها الشاشات الأخرى (وصفحة الإدارة تقرؤها من هذا الموضع نفسه).
// هذه لا تمنح وصولًا ولا تمنعه: الخادم يقرّر كل نداء كما كان. ما ليس فيها لا يُرسم اسمه، فلا يُعرض لأحد بابٌ
// تنتهي نقرته برفض؛ وغيابها كلها (صندوق اختبار بلا الوحدة) يعني ألا تُرسم أسماء شاشات أصلًا — لا أن تُرسم كلها.
function reachedKeys(){
  const reach=globalThis.navReach;
  if(!Array.isArray(reach))return null;
  const keys=new Set();
  for(const entry of reach)if(Array.isArray(entry)&&typeof entry[0]==='string')keys.add(entry[0]);
  return keys;
}
// اسمٌ واحد لكل شاشة: رابطٌ إليها من هنا يحمل اسمها في القائمة، وهو عنوانها حين تُفتح (screenTitle في app.mjs) — آخر مقطع
// من placeFor لمدخلها في navReach، أو تسمية المدخل نفسه حين يطابق ذلك اسمَ الصفحة الجامعة («مهامي» في «بانتظار إجرائي»).
// التسمية التي تحوي الاسم أصلًا تبقى («كل طلباتي» دعوةٌ إلى القائمة كلها)، وبلا navReach (صندوق الاختبار) يبقى المعطى.
function screenName(href,given){
  const key=/^#([\w-]+)$/.exec(String(href??''))?.[1],reach=globalThis.navReach;
  const entry=key&&Array.isArray(reach)?reach.find(x=>Array.isArray(x)&&x[0]===key):null;
  if(!entry||typeof entry[2]!=='string')return given;
  const place=placeFor(key,entry[2],globalThis.navMe??null),own=String(place.label??entry[2]).split(' › ').pop(),hub=HUBS[place.hub];
  const name=hub&&hub.label===own&&hub.route!==key?entry[2]:own;
  return String(given).includes(name)?given:name;
}

// بطاقة «اليوم»: زر حضور بنقرة واحدة (data-action="punch" في app.mjs يستدعي /api/attendance/punch بوقت الخادم)، وحال اليوم، وأقرب موعد.
export function todayCard(t,{e,tr=fallbackTr,lang='ar'}){
  if(!t)return '';
  const a=t.attendance,en=lang!=='ar';
  // الوقت المسجّل <time> (قيمة «08:12» وقتٌ صالح بلا datetime)، والفارغ شرطة.
  const clock=value=>value?`<time>${e(value)}</time>`:'—';
  const times=a?`<dl class="eu-times"><div><dt>${tr('الحضور','Check-in')}</dt><dd class="ltr">${clock(a.check_in)}</dd></div><div><dt>${tr('الانصراف','Check-out')}</dt><dd class="ltr">${clock(a.check_out)}</dd></div></dl>`:'';
  // زر البصمة مصدرٌ لا أمرٌ مذكّر (قاعدة المنتج: الزر لا يفترض جنس المخاطب)، وهو اسمه نفسه في شاشة الحضور.
  const punch=!a?'':a.can_check_in?`<button type="button" class="btn outline eu-punch" data-action="punch" data-kind="in">${tr('تسجيل الحضور','Check in now')}</button>`
    :a.can_check_out?`<button type="button" class="btn outline eu-punch" data-action="punch" data-kind="out">${tr('تسجيل الانصراف','Check out now')}</button>`
    :`<p class="eu-done">${tr('سجّلت حضورك وانصرافك اليوم','Today is recorded')}</p>`;
  const status=t.status?`<p class="eu-status is-${e(t.status.kind)}"><strong>${e(en?t.status.name_en:t.status.name)}</strong></p>`:'';
  // مسح 20 سبتمبر (S-08): بطاقة «اليوم» كانت تطبع التواريخ كما تأتي من الخادم (2026-10-04) بينما بقية الشاشة
  // تكتبها بالميلادي والهجري معًا عبر dual. التاريخ المفرد يأخذ الصيغة نفسها؛ المدى يبقى ميلاديًا ويتبعه هجري واحد
  // حتى لا يصير سطر الإجازة أربعة تواريخ. الوضع الإنجليزي على الصيغة الدولية كما في بقية الشاشات.
  // والتاريخ المفرد <time> بقيمته الآلية؛ المدى نصٌّ واحد لأن datetime لا يحمل مدى.
  const day=v=>v?(en?v:dual(v)):'—';
  const dayTag=v=>ISO_DAY.test(String(v??''))?`<time datetime="${e(String(v).slice(0,10))}">${e(day(v))}</time>`:e(day(v));
  const span=(from,to)=>en?`${from} — ${to}`:`${from} — ${dual(to)}`;
  const upcoming=t.upcoming_leave?`<li><span>${tr('إجازتك الجاية','Your next leave')}</span><strong>${e(t.upcoming_leave.type_name)} · ${e(span(t.upcoming_leave.start_date,t.upcoming_leave.end_date))}${t.upcoming_leave.approved?'':` (${tr('بانتظار الاعتماد','awaiting approval')})`}</strong></li>`:'';
  const holiday=t.next_holiday?`<li><span>${tr('العطلة الرسمية الجاية','Next public holiday')}</span><strong>${e(t.next_holiday.name)} · ${dayTag(t.next_holiday.date)}</strong></li>`:'';
  const d=t.next_deadline;
  const when=d?(d.overdue?tr('فات موعده','overdue'):d.days_left===0?tr('اليوم','today'):en?`in ${countEn(d.days_left,'day')}`:`باقي ${dayWord(d.days_left)}`):'';
  const deadline=`<li class="${d?.overdue?'is-late':d&&d.days_left<=3?'is-due':''}"><span>${tr('أقرب موعد','Next deadline')}</span>${d?`<a href="${e(d.link)}"><strong>${e(d.title)}</strong></a><small>${e(tr(...(deadlineKinds[d.kind]||[d.kind,d.kind])))} · ${dayTag(d.date)} · ${e(when)}</small>`:`<strong>${tr('ما عندك موعد قريب','Nothing due soon')}</strong>`}</li>`;
  const policy=a&&!a.policy?`<p class="subtle">${tr('ما فيه سياسة دوام معتمدة للحين، فما ينحسب تأخير. والوقت بساعة المنصة.','No approved working-time policy yet, so lateness is not judged. Times are server time.')}</p>`:'';
  return `<section class="panel eu-today" aria-labelledby="eu-today-title"><div class="panel-head"><div><h2 id="eu-today-title">${tr('اليوم','Today')}</h2><p class="subtle">${e(en?t.weekday_en:t.weekday)} · ${en?e(t.date):dayTag(t.date)}</p></div>${a?`<a class="btn outline small" href="#attendance/correction">${tr('طلب تصحيح','Request a correction')}</a>`:''}</div>
    <div class="panel-body eu-today-body"><div class="eu-punch-box">${punch}${times}${policy}</div><div class="eu-day">${status}<ul class="eu-facts">${deadline}${upcoming}${holiday}</ul></div></div></section>`;
}
// الشريط الأفقي: زرٌّ رئيسيٌّ واحد «+ إنشاء» يفتح قائمة ما يُنشأ، ثم شريحة لكل إجراء ليس إنشاءً، ثم بطاقة
// لكل خدمة من خدمات صاحب الحساب الأكثر طلبًا (خمس على الأكثر، routing.usedServices)، ثم بابٌ واحد إلى «كل الخدمات».
// موجز المالك (30 سبتمبر 2026): «زر رئيسي واحد + إنشاء يفتح قائمة ذكية» و«خمس خدمات متكررة لكل مستخدم، ثم زر واضح
// لفتح جميع الخدمات. لا نعرض عشرة مربعات متشابهة». فكانت الشرائح عشرًا متشابهة في صفٍّ واحد، وصارت قائمةً تُفتح عند
// الطلب — وما فيها لم يُخفَ، بل نُقل إلى حيث يُقرأ اسمًا اسمًا بدل أن يُمسح بالعين مربعاتٍ متجاورة.
//
// م0 «السور»: ما ليس جاهزًا (لا رصيد، لا قالب) كان يُحذف من الصف فلا يعرف الموظف أن الإجراء موجود ولا لماذا غاب. يبقى
// ظاهرًا معطّلًا (aria-disabled) وسببه مكتوب فيه — في الشريط وفي القائمة سواء؛ والسبب يحسبه الخادم في quickActions
// (app/home.mjs) لهذا الحساب. بلا href فلا تقود النقرة إلى مكان، وبـtabindex يبلغه قارئ الشاشة فيقرأ الاسم والسبب معًا.
// وسببٌ فارغ من الخادم (تصريح ناقص) لا يُترك فراغًا: يُقال النص العام «غير متاح لحسابك الآن».
//
// القائمة مرسومةٌ هنا في الشاشة لا مبنيّةٌ في app.mjs: بياناتها بيانات هذه الشاشة، وapp.mjs يفتحها ويغلقها ويضعها
// بالآلة نفسها التي تفتح قائمة المظاهر — top layer حيث يدعمه المتصفح، وإلا hidden وإغلاقٌ بالنقر خارجها.
// وبنودها روابط: النقرة تعمل ولو لم تعمل الآلة، فلا نقرة ميتة صامتة.
export function quickRow(actions,{e,tr=fallbackTr,lang='ar',cards=[],lead=true}={}){
  const all=actions||[],extra=cards||[];
  if(!all.length&&!extra.length)return '';
  const name=q=>e(lang==='ar'?q.label:q.label_en);
  const whyNot=q=>(lang==='ar'?q.reason:q.reason_en||q.reason)||unavailableText('default',lang);
  let QA_ORDER=[];
  const glyphOf=q=>DISC(quickIcon(q.key),"qa-c"+(Math.max(0,QA_ORDER.indexOf(q.key))%10+1));
  const chip=q=>{
    if(q.ready)return `<a class="eu-chip" href="${e(q.link)}" data-quick="${e(q.key)}">${glyphOf(q)}${name(q)}</a>`;
    return `<a class="eu-chip is-disabled" role="link" aria-disabled="true" tabindex="0" data-quick="${e(q.key)}">${glyphOf(q)}<b class="eu-chip-text">${name(q)}<small>${e(whyNot(q))}</small></b></a>`;
  };
  // بند القائمة: رابطٌ لما هو جاهز، وسطرٌ معطّل بسببه لما ليس جاهزًا. الاثنان menuitem فيعدّهما قارئ الشاشة معًا.
  const entry=q=>q.ready
    ?`<a role="menuitem" href="${e(q.link)}" data-quick="${e(q.key)}">${glyphOf(q)}<b>${name(q)}</b></a>`
    :`<span role="menuitem" aria-disabled="true" tabindex="-1" data-quick="${e(q.key)}">${glyphOf(q)}<b>${name(q)}<small>${e(whyNot(q))}</small></b></span>`;

  const creators=all.filter(q=>q.create),chips=all.filter(q=>!q.create);
  QA_ORDER=[...creators,...chips].map(x=>x.key);
  // «كل الخدمات»: البابُ الواحد إلى الدليل كله، يُرسم مع الخمس لا بدلها — فما يُعرض خمسٌ وما وراءها معروف الطريق.
  const doorway=extra.length||creators.length
    ?`<span class="hm-strip-card is-all"><a class="eu-chip" href="#services">${DISC(icon('grid','is-tinted'),'qa-all')}${tr('كل الخدمات','All services')}</a></span>`:'';
  const items=[...creators.map(q=>`<span class="hm-strip-card">${chip(q)}</span>`),...chips.map(q=>`<span class="hm-strip-card">${chip(q)}</span>`),...extra,doorway].filter(Boolean);
  // العدد بنودُ قائمة الإنشاء زائدَ ما في الشريط: بطاقةٌ تقول رقمًا وبجانبها ما يخالفه عيبٌ لا يُقبل.
  // و«كل الخدمات» بابٌ لا خدمة فلا يُعدّ.
  const counted=items.length-(doorway?1:0);
  const said=lang==='ar'?countNoun(counted,'service'):countEn(counted,'service');
  const head=lead&&creators.length
    ?`<button type="button" class="btn primary hm-strip-new" data-action="create-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="create-menu">`
      +`<b class="hm-disc" aria-hidden="true">${icon('plus')}</b><strong>${tr('إنشاء','Create')}</strong><small>${e(said)} ${tr('بين يدك','ready to start')}</small></button>`
      +`<div id="create-menu" class="hm-menu" role="menu" aria-label="${tr('إنشاء','Create')}" hidden>${creators.map(entry).join('')}</div>`
    :'';
  return `<nav class="eu-quick hm-strip" aria-label="${tr('إجراءات سريعة','Quick actions')}">${head}${items.join('')}</nav>`;
}
export const homeUI={
  title:'الرئيسية',title_en:'Home',
  description:'ما يخصك اليوم: الحضور، وما ينتظرك، وطلباتك ومواعيدها.',description_en:'What matters to you today: attendance, what is waiting for you, and your requests and their due dates.',
  load:api=>api('/home'),
  render(data,{e,tr=fallbackTr,lang='ar',ui:given}){
    const en=lang!=='ar',T=pair=>tr(...pair);
    const ui=typeof given?.tile==='function'?given:kit(e,tr);
    // بلاطة بطاقة الخادم من العدّة (ui.tile برابطها): الرقم يقود إلى القائمة التي هو طولها.
    const drawTile=c=>ui.tile(c.value,cardNames[c.key]?T(cardNames[c.key]):c.title,c.tone,c.link);
    const linkName=(link,label)=>en?label:screenName(link,label);
    // الكتلة: عنوانها h2 حين تكون قسمًا، وh3 حين تكون جزءًا من قسمٍ له عنوانه (المدير، الموارد البشرية، المالية، القيادة، المخالفات).
    const block=(title,link,linkLabel,body,level=2)=>`<section class="vn-block"><div class="panel-head"><h${level}>${e(title)}</h${level}>${link?`<a class="btn outline small" href="${e(link)}">${e(linkName(link,linkLabel))}</a>`:''}</div>${body}</section>`;
    const list=(items,none,draw)=>items.length?`<ul class="vn-list">${items.map(draw).join('')}</ul>`:`<p class="subtle">${e(none)}</p>`;
    const status=r=>statusNames[r.status]?T(statusNames[r.status]):r.status_name;
    // مصدر الزمن بالإنجليزية: الخادم يبني العبارة العربية (app/service-target.mjs TARGET_NOTES) ولا يترجم،
    // فتُقابَل هنا بمفتاح الحال وحده. «متبقٍ ثلاثة أيام» جملةٌ تقيس إلى رقم؛ ما لم يتبنَّه إنسان يُقال ذلك معها.
    const sourceEn={derived:'derived from the service code family, adopted by nobody — not a promise anyone made',
      recorded:'recorded in the directory with no written adoption decision — not a promise anyone made'};
    const timeNote=r=>{
      if(!en)return r.time_note;
      const c=r.clock,source=c?.target&&!c.target.adopted&&sourceEn[c.target.kind]?` — ${sourceEn[c.target.kind]}`:'';
      if(!c||!c.target_days)return 'No approved service level for this service';
      if(c.paused)return 'Paused, waiting for the requester';
      if(c.overdue)return `Past the service level by ${countEn(Math.abs(c.days_left),'working day')}${source}`;
      if(c.days_left===null||c.days_left===undefined)return r.status==='draft'?'Draft, not submitted yet':'Starts when submitted'+source;
      return `${countEn(c.days_left,'working day')} left${source}`;
    };
    // B22: تمييز العدد بدل «15 يوم» و«1 يوم».
    const days=n=>en?countEn(n,'day'):countNoun(n,'day');
    // التاريخ <time> بقيمته الآلية، ونصه بصيغة الشاشة (ميلادي وهجري في العربية).
    const dateTag=iso=>ISO_DAY.test(String(iso??''))?`<time datetime="${e(String(iso).slice(0,10))}">${e(en?String(iso):dual(String(iso)))}</time>`:e(iso??'—');
    // منذ متى وصل البند إليك بأيام العمل (عمر «ما عليّ»): «وصلك اليوم» أو «وصلك من 3 أيام عمل» — العبارة نفسها في «بانتظار إجرائي»
    // و«مهامي» — و<time> بيوم وصوله حين تحمله الحمولة.
    const sinceHtml=r=>{const text=r.age_days?(en?`for ${countEn(r.age_days,'working day')}`:`وصلك من ${dayWord(r.age_days)} عمل`):tr('وصلك اليوم','arrived today');
      return ISO_DAY.test(String(r.since??''))?`<time datetime="${e(String(r.since).slice(0,10))}">${e(text)}</time>`:e(text);};

    // صف الطلب: عنوانه يفتح سجله، وشارة حالته من القاموس (شكل وكلمة)، ثم خدمته وزمنه.
    const requestRow=r=>`<li class="${r.clock?.overdue?'is-late':r.status==='completed'?'is-old':''}"><a href="${e(r.link)}"><strong>${e(r.title)}</strong></a>${ui.statusBadge(r.status)}<span>${e(r.service_name)} · ${e(timeNote(r))}</span></li>`;
    // ما ينتظر قرارك: علامة «دورك» (is-decision، وكلمتها عنوان كتلتها)، والمتأخر بعلامة التأخر.
    const decisionRow=r=>`<li class="${(r.overdue??r.age_days>=3)?'is-late':'is-decision'}"><a href="${e(r.link)}"><strong>${e(r.title)}</strong></a><span>${e(r.service_name)} · ${e(r.count?r.status_name:status(r))} · ${sinceHtml(r)}</span></li>`;
    // الوثيقة: حالها، ويوم انتهائها، وكم باقي عليها أو كم مضى (لا «-3 أيام»).
    const left=n=>en?(Number(n)<0?`${countEn(Math.abs(n),'day')} ago`:countEn(n,'day')+' left'):Number(n)<0?`من ${dayWord(n)}`:Number(n)===0?'اليوم':`باقي ${dayWord(n)}`;
    const documentRow=d=>`<li class="${d.status==='expired'?'is-late':'is-due'}"><a href="${e(d.link)}"><strong>${e(d.name)}</strong></a><span>${e(expiryNames[d.status]?T(expiryNames[d.status]):d.status)} · ${d.status==='expired'?tr('انتهت','Expired'):tr('تنتهي','Expires')} ${dateTag(d.expires_on)} · ${e(left(d.days_left))}${d.configured?'':' · '+tr('ما لنوعها مدة تذكير مسجّلة','no reminder period set')}</span></li>`;
    // الخدمة غير المتاحة تقول أيّ غياب هو (مراجعة 22 سبتمبر): usedServices في app/routing.mjs يكتب السبب
    // منذ الترحيل 129 — «موقوفة من إعدادات الخدمات: <نص قرار المالك>» غير «لم تعد في دليل الخدمات» —
    // وكان يصل الحمولة ولا يُرسَم، فيقرأ من طلبها بالأمس عبارةً واحدة عامة عن حالين مختلفين. العربية
    // تقرأ السبب المكتوب، والإنجليزية تبقى على عبارتها: نصّ القرار عربيٌّ كما كتبه صاحبه، ولا يُترجَم هنا.
    const whyGone=s=>!en&&s.unavailable_reason?s.unavailable_reason:tr('الخدمة غير متاحة الآن','service not available now');
    const leaveRow=b=>`<li class="${Number(b.remaining)>0?'':'is-old'}"><strong>${e(b.type)}</strong><span>${tr('سنة','Year')} ${e(b.year)} · ${Number(b.remaining)>0?`${tr('باقي لك','Available')} ${e(days(b.remaining))}`:tr('ما بقى لك أيام','No days available')}${b.reserved?` · ${tr('محجوز لطلبات مفتوحة','Reserved for open requests')} ${e(b.reserved)}`:''}</span></li>`;
    // العقد المنتهي يفتح سجله في «العقود» (‎?focus=‎ يقف عنده)، لا رأس الشاشة.
    const alertRow=a=>`<li class="${a.kind==='contract_expired'?'is-late':'is-due'}"><a href="${a.contract_id?`#contracts?focus=${encodeURIComponent(a.contract_id)}`:'#contracts'}"><strong>${e(a.employee_name)}</strong></a><span>${e(a.message)}</span></li>`;
    // المبلغ رقمٌ معزول (يبقى بإشارته وفواصله) والعملة في سياقها.
    const money=value=>value===null||value===undefined?'—':`<span class="ltr">${e((Number(value)/100).toLocaleString('en-US',{minimumFractionDigits:2}))}</span> ${tr('ريال','SAR')}`;

    /* ───── تركيب «اليوم»: البطاقة الواحدة، والكتلة الواحدة، والحالة الفارغة ───── */
    // بطاقة المهمة: قرص حالة + عنوان يفتح سجلّه + شارة حالة + سطر بيانات + ملاحظة + مؤشّر خطوات + صف أزرار.
    // ما لا يوجد له حقل في الحمولة لا يُرسم له عنصر فارغ: الملاحظة والخطوات يظهران حين يوجد ما يقولانه.
    // شريط الحقائق: زوجٌ لكل حقيقة موجودة، ولا صفّ لما لا قيمة له — «الموعد: —» أسوأ من غيابه.
    // dl لأن ما هنا اسمٌ وقيمته، فيقرؤه قارئ الشاشة زوجًا زوجًا لا نصًّا متصلًا.
    // جملة بناها الخادم بالعربية («الخطوة التالية: فلان»، «قرار اعتماد: اعتماد أو إعادة…») لا تُترجَم هنا،
    // فهي نصٌّ لا مفتاح — وهي القاعدة نفسها التي يمشي عليها whyGone وtimeNote في هذا الملف. فتُعرض في العربية،
    // وتُطوى في الإنجليزية بدل أن تُقحَم عربيةً في شاشةٍ إنجليزية أو تُترجَم ترجمةً يخترعها العارض. والأسماء
    // والتواريخ بيانات لا جمل، فتبقى في اللغتين كما تُكتب في كل شاشة أخرى.
    const SENTENCE_FACTS=new Set(['next','act','doing']);
    // القيمة نصٌّ يُهرَّب، أو {html} جاهز من صاحبه (الموعد بـ<time>).
    const facts=pairs=>{
      const rows=pairs.filter(pair=>pair&&pair[1]&&!(en&&SENTENCE_FACTS.has(pair[0])));
      return rows.length?`<dl class="hm-facts">${rows.map(([key,value])=>`<div><dt>${e(T(factNames[key]))}</dt><dd>${typeof value==='object'?value.html:e(value)}</dd></div>`).join('')}</dl>`:'';
    };
    // الموعد الحقيقي ومصدره في سطر واحد: تاريخٌ بلا سندٍ يُقرأ وعدًا، والسند يقول من أين جاء.
    // وموعدٌ من زمن خدمةٍ لم يُعتمد (due_adopted=false) يُقال إنه تقديري، لا من اعتمده ولا من لم يعتمده.
    const NOT_ADOPTED_HERE=tr('موعد تقديري','an estimated date');
    const basisOf=r=>basisNames[r.due_basis]?T(basisNames[r.due_basis]):'';
    const dueText=r=>{
      if(!r.due_on)return basisOf(r);
      const basis=basisOf(r),flag=r.due_adopted===false?` (${NOT_ADOPTED_HERE})`:'';
      return {html:`${dateTag(r.due_on)}${e(`${basis?` — ${basis}`:''}${flag}${r.overdue?` · ${tr('فات','past due')}`:''}`)}`};
    };
    // البطاقة: ما ينتظرك (قرار أو رد) بعلامة «دورك» (is-decision) وشارتها بالكلمة نفسها، والمتأخر بعلامة التأخر.
    // وزرّها الواحد مصدرٌ لا أمر («اتخاذ القرار»)، واسمه المسموع يحمل البطاقة لأن الزر نفسه يتكرر في كل بطاقة.
    const drawCard=o=>`<li class="${e(['hm-card',o.late?'is-late':o.turn?'is-decision':o.due?'is-due':''].filter(Boolean).join(' '))}">`
      +`<div class="hm-card-head">${disc(o.tone,e)}<a href="${e(o.link)}"><strong>${e(o.title)}</strong></a><span class="${e(['badge',o.badgeTone].filter(Boolean).join(' '))}">${e(o.badge)}</span></div>`
      +`<p class="hm-card-meta">${o.metaHtml??e(o.meta)}</p>`
      +(o.note?`<p class="hm-card-note">${e(o.note)}</p>`:'')
      +(o.facts??'')
      +(o.steps??'')
      +`<div class="hm-card-actions"><a class="btn outline small" href="${e(o.link)}" aria-label="${e(`${o.action}: ${o.title}`)}">${e(o.action)}</a></div></li>`;
    // مؤشّر الخطوات: مراحل مسار الطلب وحدها، من حالته هو. لا مؤشّر لمسودة ولا لمرفوض ولا لبند خارج مسار الطلبات،
    // فلا تُخترع مرحلة لسجلّ لا مراحل له. النص للقارئ في aria-label والمربّعات زينة.
    const steps=r=>{
      const at=r.status==='returned'?0:ROUTE.indexOf(r.status);
      if(at<0)return '';
      const name=statusNames[ROUTE[at]]?T(statusNames[ROUTE[at]]):ROUTE[at];
      const label=en?`Step ${at+1} of ${ROUTE.length}: ${name}`:`الخطوة ${at+1} من ${ROUTE.length}: ${name}`;
      return `<p class="hm-steps" aria-label="${e(label)}">${ROUTE.map((s,i)=>`<span class="hm-step${i<at?' is-done':i===at?' is-now':''}"></span>`).join('')}</p>`;
    };
    const NOTHING_YET=tr('بيبان هنا أول ما يوصلك شي.','It shows up here the moment something reaches you.');
    // الكتلة المسمّاة: عنوان + عدد هو طول قائمتها + سطر شرح + شبكة بطاقات. العدد لا يُمرَّر: يُقرأ من items هنا.
    const named=(title,hint,items,draw,noneTitle,link,linkLabel,noneBody)=>`<section class="vn-block hm-block"><div class="panel-head"><div>`
      +`<h2>${e(title)} <small>${e(items.length)}</small></h2><p class="subtle">${e(hint)}</p></div>`
      +`${link?`<a class="btn outline small" href="${e(link)}">${e(linkName(link,linkLabel))}</a>`:''}</div>`
      +(items.length?`<ul class="vn-list">${items.map(draw).join('')}</ul>`:ui.empty(noneTitle,noneBody??NOTHING_YET))+'</section>';

    const decisions=data.decisions??[],respond=data.respond??[],tasks=data.tasks??[],mine=data.my_requests??[];
    // «منذ 0 أيام» ليست عبارة: ما وصل اليوم يقال عنه إنه وصل اليوم (sinceHtml أعلاه، بـ<time>).
    // الشارة تقول الحالة؛ وحين تقول الشارة نفسها الفعل (بند لوحة لا حالة له في القاموس) لا يُكرَّر الفعل تحتها.
    const actOf=(r,badge)=>r.action_text&&r.action_text!==badge?r.action_text:'';
    const decisionFacts=(r,badge)=>facts([['owner',r.owner_of_record],['due',dueText(r)],['act',actOf(r,badge)],['next',r.unblocks]]);
    const decisionCard=r=>{const badge=r.count?r.status_name:status(r);
      return drawCard({tone:'is-decide',title:r.title,link:r.link,badge,badgeTone:'is-decision',
        metaHtml:`${e(r.service_name)} · ${sinceHtml(r)}`,facts:decisionFacts(r,badge),
        late:(r.overdue??r.age_days>=3),turn:true,action:tr('اتخاذ القرار','Open and decide')});};
    const respondCard=r=>{const badge=r.count?r.status_name:status(r);
      return drawCard({tone:'is-return',title:r.title,link:r.link,badge,badgeTone:'is-decision',
        metaHtml:`${e(r.service_name)} · ${sinceHtml(r)}`,facts:decisionFacts(r,badge),
        late:!!r.overdue,turn:true,action:tr('إكمال المطلوب','Open and complete')});};
    const doCard=t=>{
      const dated=!!t.due_on;
      return drawCard({tone:'is-do',title:t.title,link:t.link,badge:t.overdue?tr('متأخرة','Overdue'):tr('مفتوحة','Open'),
        meta:t.context??'',
        note:t.shared?tr('في طابور إدارتك: أول من يباشرها ياخذها.','In your department queue: whoever starts it takes it.'):'',
        facts:facts([['owner',t.owner_of_record],['due',dueText(t)],['doing',t.action_text],['next',t.unblocks]]),
        late:!!t.overdue,due:dated,action:tr('فتح المهمة','Open task')});
    };
    const mineTone=r=>r.status==='completed'?'is-done':r.status==='rejected'||r.status==='cancelled'?'is-reject':r.status==='returned'?'is-return':'is-run';
    // لون الشارة اسم الحالة نفسه في style.css، ولا يُعطى إلا لطلب دليل حالتُه من الثماني (r.clock موجود):
    // صفّ وحدة أخرى قد تكون حالته خارجها، فلا يُكتب له صنفٌ لا تعرّفه ورقةُ أنماط.
    // «عند» و«التالي» و«المطلوب منك» من app/request-timeline.nextStep — المصدر الذي تقرؤه شاشة «أين طلباتي»
    // نفسها. والساعة الموقوفة لا تُعطي تاريخًا متوقعًا، فيُقال سببُ توقّفها بدل تاريخٍ لا يملكه أحد.
    const mineDue=r=>{
      if(r.step?.paused)return tr('الساعة متوقفة: تنتظر ردّك','Clock paused: waiting on your reply');
      const on=r.step?.expected_on??r.due_on??null;
      return on?{html:`${dateTag(on)}${r.overdue||r.clock?.overdue?e(` · ${tr('فات','past due')}`):''}`}:'';
    };
    // طلبك الذي عندك (مسودة أو معاد: مرحلة «ينتظر ردك» في القاموس) دورك أنت، فيأخذ العلامة وكلمتها أول سطره.
    const yours=r=>stageOf(r.status).stage==='needs_you';
    const mineCard=r=>drawCard({tone:mineTone(r),title:r.title,link:r.link,badge:status(r),badgeTone:r.clock?r.status:'',
      metaHtml:`${yours(r)?`${e(tr(...NEEDS_YOU))} · `:''}${e(r.service_name)} · ${e(timeNote(r))}`,note:'',steps:steps(r),
      facts:facts([['with',r.step?.with],['due',mineDue(r)],['next',r.step?.awaiting],['act',r.step?.you_can]]),
      late:!!(r.clock?.overdue||r.overdue),turn:yours(r),due:false,action:tr('فتح الطلب','Open request')});

    /* ───── 1–3: التحية، والسؤال، وسطر العدد ───── */
    const t=data.today_card;
    // تحيةٌ شخصية لا تناقض الساعة: قبل الظهر بتوقيت الرياض «صبّحك»، وبعده «مسّاك». الاسم من الحساب
    // نفسه، واليوم والتاريخ من بطاقة اليوم التي يبنيها الخادم؛ لا اسم افتراضي ولا ساعة متصفح للحكم على التاريخ.
    const morning=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Asia/Riyadh'}).format(new Date()))<12;
    const hello=morning?tr('صبّحك الله بالخير','Good morning'):tr('مسّاك الله بالخير','Good evening');
    const person=e(data.me?.name||tr('زميلنا','there'));
    const welcomeDate=t?`${e(en?t.weekday_en:t.weekday)}<span aria-hidden="true">·</span><bdi>${e(en?t.date:dual(t.date))}</bdi>`:'';
    const welcome=`<section class="hm-welcome" aria-label="${e(`${hello}، ${data.me?.name||''}`)}"><div class="hm-welcome-copy"><p class="hm-welcome-kicker">${tr('مساحة عملك اليوم','Your workspace today')}</p><h2>${e(hello)}، <strong>${person}</strong></h2>${welcomeDate?`<p class="hm-welcome-date">${welcomeDate}</p>`:''}</div><span class="hm-welcome-mark" aria-hidden="true">${icon(morning?'sun':'sparkles','is-tinted')}</span></section>`;
    const ask=`<h2 class="hm-ask">${tr('وش المطلوب منك اليوم؟','What needs you today?')}</h2>`;
    // العدد الإجمالي مجموع أطوال الكتل الثلاث نفسها، فما يقوله السطر هو ما يجده القارئ تحته.
    const total=decisions.length+respond.length+tasks.length;
    const sub=`<p class="hm-sub">${e(total
      ?tr(`اليوم عليك ${countNoun(total,THINGS)}، والباقي ماشي بروحه ولا يبيلك همّ.`,`${countEn(total,'thing')} on you today — the rest is moving on its own.`)
      :tr('أمورك تمام، ما عليك شي اليوم وطلباتك ماشية في مسارها.','All clear — nothing is on you today and your requests are moving along their route.'))}</p>`;

    /* ───── 4: الشريط الأفقي ───── */
    // خدماتك الأكثر استخدامًا بطاقاتٌ في الشريط نفسه: اسمها وكم طلبتها، وزرّها يفتح نموذجها مباشرة (data-action/data-id).
    // وما لم يعد متاحًا يبقى ظاهرًا بسبب غيابه كما كتبه الخادم، ولا يحمل زرًّا يقود إلى رفض.
    const serviceCards=(data.top_services??[]).map((s,i)=>{
      const caption=s.available?(en?countEn(s.uses,'earlier request'):countNoun(s.uses,'earlier_request')):whyGone(s);
      const inner=`<b class="hm-disc qa-c${(i*3+2)%10+1}" aria-hidden="true">${serviceGlyph(s.code)}</b><strong>${e(s.name)}</strong><small>${e(caption)}</small>`;
      return s.available&&s.service_id
        ?`<span class="hm-strip-card" data-family="${e(String(s.code??'').split('-')[0])}"><button type="button" class="text-button" data-action="new-request" data-id="${e(s.service_id)}">${inner}</button></span>`
        :`<span class="hm-strip-card is-old" data-family="${e(String(s.code??'').split('-')[0])}">${inner}</span>`;
    });
    const strip=quickRow(data.quick_actions,{e,tr,lang,cards:serviceCards});

    /* ───── 5: أربع بلاطات إحصاء ───── */
    // كل بلاطة رقمها طول القائمة التي تفتحها، والقرص يقول أيّ حال هي.
    const stat=(tone,items,label,link)=>`<a class="vn-tile hm-stat" href="${e(link)}">${disc(tone,e)}<strong>${e(items.length)}</strong><span>${e(label)}</span></a>`;
    const stats=`<div class="vn-tiles hm-stats">`
      +stat('is-decide',decisions,tr('ينتظر قرارك','Waiting on you'),'#inbox')
      +stat('is-return',respond,tr(...NEEDS_YOU),'#work')
      +stat('is-do',tasks,tr('مهامي','My tasks'),'#work')
      +stat('is-run',mine,tr('طلباتك المفتوحة','Your open requests'),'#my-requests')
      +`</div>`;

    /* ───── 6: ملاحظة البيانات ───── */
    const notice=data.unavailable_notice??data.unavailable??[];
    const role=data.me.department?.name||(roleNames[data.me.role]?T(roleNames[data.me.role]):tr('مساحتك','Your workspace'));
    const availability=notice.length?`<p class="notice" role="status">${tr('بعض البيانات غير متاحة الآن. حدّث الصفحة أو جرّب لاحقًا.','Some data is unavailable. Refresh the page or try again later.')}</p>`:'';

    /* ───── 7: الكتل الثلاث، ثم ما أعدتُه، ثم طلباتي ───── */
    // أسماء الكتل هي أسماء البلاطات فوقها وأسماء ألواح «مهامي»: القائمة الواحدة تُسمّى باسم واحد في كل شاشة.
    const blocks=named(tr('ينتظر قرارك','Waiting on your decision'),tr('هذي تنتظر منك موافقة أو ملاحظة عشان تكمّل طريقها.','These need your approval or a note before they can move on.'),
        decisions,decisionCard,tr('ما فيه شي ينتظر قرارك الحين','Nothing is waiting on your decision yet'),'#inbox',tr('بانتظار إجرائي','My actions'))
      +named(tr(...NEEDS_YOU),tr('رجعت لك عشان تكمّل ناقص أو توضّح شي، أو تنتظر إقرارك أو ردّك.','Sent back to you to complete something or explain it, or waiting on your reply.'),
        respond,respondCard,tr('أمورك تمام، ما فيه شي رجع لك','All clear — nothing has come back to you'),'#work',tr('مهامي','My tasks'))
      +named(tr('مهامي','My tasks'),tr('شغلك المطلوب منك مباشرة: مهامك الخاصة، ومهام المشاريع والطلبات، وتأكيد أو تسليم ينتظرك.','Work asked of you directly: your own tasks, project and request tasks, and anything to confirm or hand over.'),
        tasks,doCard,tr('ما عليك مهام للتنفيذ الحين','No tasks on you right now'),'#work',tr('مهامي','My tasks'));
    const workNow=blocks?`<section class="vn-board hm-now"><div class="panel-head"><h2>${tr('شغلك الآن','Your work now')}</h2><a class="btn outline small" href="#work">${tr('فتح عملي','Open my work')}</a></div>${blocks}</section>`:'';
    // ما أعدتُه وينتظر صاحبه: متابعة لا التزام — لا يدخل عدّ «تحتاج استكمال» لأنه ليس عندك، والرد عند صاحب الطلب.
    const waited=n=>n===null||n===undefined?'':n===0?tr('اليوم','today'):en?`for ${countEn(n,'working day')}`:`من ${dayWord(n)} عمل`;
    const returnedWatch=data.returned_by_me?.length?named(tr('أعدتُها وتنتظر صاحبها','Returned by me, waiting on the requester'),
      tr('للمتابعة بس: الرد عند صاحب الطلب وما تنعدّ عليك.','Follow-up only: the reply is with the requester and it is not counted against you.'),
      data.returned_by_me,r=>drawCard({tone:'is-return',title:r.title,link:r.link,badge:tr('عند صاحبه','With the requester'),
        metaHtml:`${e(r.requester_name)} · ${ISO_DAY.test(String(r.returned_at??''))?`<time datetime="${e(riyadhDayOf(r.returned_at))}">${e(waited(r.age_days))}</time>`:e(waited(r.age_days))}`,note:r.lapse_note??'',late:false,due:false,action:tr('فتح الطلب','Open request')}),
      '','#work',tr('مهامي','My tasks')):'';
    const mineBlock=named(tr('طلباتك المفتوحة','Your open requests'),tr('طلباتك اللي ما خلّصت بعد، وكل واحد وين واقف.','Your requests that are not finished yet, and where each one stands.'),
      mine,mineCard,tr('ما عندك طلبات مفتوحة','You have no open requests'),'#my-requests',tr('كل طلباتي','All my requests'),
      tr('تبدأ طلب جديد من «إنشاء» فوق، ويطلع هنا بمرحلته وعند مين.','Start one from Create above; it shows here with its stage and who holds it.'));

    /* ───── 8: بقية البلاطات وتفاصيلي، ثم رابط «كل طلباتي» ───── */
    // البلاطات الأربع أعلاه أخذت قوائمها، فلا تتكرر هنا؛ وبقية بطاقات الخادم تبقى مداخلَ إلى شاشاتها.
    const shown=['decisions','respond','tasks','my_requests'];
    const rest=(data.cards??[]).filter(c=>!shown.includes(c.key));
    const personal=`<section class="vn-board">${rest.length?`<div class="vn-tiles">${rest.map(drawTile).join('')}</div>`:''}`
      +block(tr('رصيد إجازتي','My leave balance'),'#leave',tr('إجازاتي','My leave'),list(data.leave,tr('ما فيه رصيد إجازة لحسابك للحين — تضيفه الموارد البشرية، ويطلع هنا.','No leave balance is shown for your account yet. HR adds it.'),leaveRow))
      +block(tr('وثائقي اللي قرّبت تنتهي','My expiring documents'),'#profile',tr('ملفي','My profile'),list(data.my_documents,tr('ما عندك وثيقة انتهت أو قرّبت تنتهي.','None of your documents has expired or is expiring soon.'),documentRow)+(data.my_documents_note?`<p class="subtle">${en?'Some of your document types have no reminder period set, so they are not called "expiring soon" until the process owner sets one.':e(data.my_documents_note)}</p>`:''))
      +`</section>`;
    // الرقم في الرابط هو طول القائمة التي رُسمت فوقه، ويقول أيّ عدد هو حتى لا يُقرأ عدد الطلبات كلها.
    const openCount=mine.length?(en?`${countEn(mine.length,'open request')}`:`المفتوح منها ${countNoun(mine.length,'request')}`):tr('ما فيه مفتوح الحين','nothing open right now');
    const allLink=`<p class="hm-all"><a class="btn outline" href="#my-requests">${tr('كل طلباتي','All my requests')} · ${e(openCount)}</a></p>`;

    // «مخالفاتي وجزاءاتي» (ترحيل 097): لوحتها كانت في portal-ui.mjs التي لم تعد تُعرض بعد دمج «ملخصي» في الرئيسية.
    // تظهر هنا فقط لمن عليه قضية أو جزاء، بلا نص اتهام ولا دفاع ولا مبلغ غرامة: الصفحة تقود إلى صحيفته.
    const dis=data.discipline;
    const disciplineRow=r=>`<li class="${r.overdue?'is-late':r.needs_you?'is-decision':''}"><a href="${e(r.link)}"><strong><bdi>${e(r.reference)}</bdi></strong></a><span>${r.needs_you?`${e(tr(...NEEDS_YOU))} · `:''}${e(r.status_name)}${r.penalty?` · ${e(r.penalty)}`:''}${r.due_on?` · ${tr('الموعد','Due')} ${dateTag(r.due_on)}${r.deadline_text&&!en?` — ${e(r.deadline_text)}`:''}`:''}</span></li>`;
    const discipline=dis?`<section class="vn-board"><div class="panel-head"><h2>${tr('مخالفاتي وجزاءاتي','My violations and penalties')}</h2><a class="btn outline small" href="${e(dis.link)}">${tr('فتح صحيفتي','Open my record')}</a></div>
      <p class="subtle">${en?'Your record, your written defence and your grievance are in “My violations and penalties”. Nobody sees them but you, HR and the authority holder.':e(dis.note)}</p>
      ${block(tr('قضايا مفتوحة عليّ','Open cases against me'),'','',list(dis.rows.filter(r=>r.needs_you||!['decided','notified','withdrawn','not_proven','lapsed'].includes(r.status)),tr('ما عليك قضية مفتوحة الحين.','No case is open against you now.'),disciplineRow),3)}
      ${block(tr('صحيفة جزاءاتي','My penalty record'),'','',`<p class="subtle">${tr('الجزاءات السارية في صحيفتك','Penalties in force on your record')}: ${e(dis.penalties)}.</p>`,3)}</section>`:'';

    // «شغل إدارتي» (موجز المالك 30 سبتمبر 2026، البند 3): قسمٌ واحد لكل الإدارات، إدارةُ صاحب الحساب هي ما يبدّله.
    // شاشاتُ إدارته من سجل الوجهات (الخادم يشتقها في app/home.mjs)، مصفّاةً بما يبلغه هذا الحساب اليوم وحده.
    // وشغلُ الإدارة المفتوح هنا لا في قسم المدير: هو شغل الإدارة لا شغل الفريق (الموجة 2 «لا طلب يضيع» — المعاد
    // إلى صاحبه قبل أن يصل الإدارة، وما تنفّذه الإدارة الآن وعند من، وما تجاوز مدته). كتابته في الموضعين تعني
    // رقمين لسؤال واحد. بيانات وصفية بلا حمولة، وإعادة الإسناد نموذج داخل الصف بلا سكربت مضمَّن.
    const reassignForm=r=>r.candidates.length?`<details><summary>${tr('إعادة إسناد','Reassign')}</summary><form id="wf2-form-${e(r.id)}" data-form="wf2" data-path="/requests/${e(r.id)}/reassign" data-version="${e(r.version)}"><label><span>${tr('إلى','To')}</span><select name="to_user_id" required>${r.candidates.map(c=>`<option value="${e(c.id)}">${e(c.name)}</option>`).join('')}</select></label><label><span>${tr('السبب (مطلوب)','Reason (required)')}</span><textarea name="reason" required minlength="10" maxlength="1000"></textarea></label><button class="btn dark small" type="submit">${tr('إسناد','Assign')}</button></form></details>`:`<small class="subtle">${tr('ما فيه منفّذ ثاني في سلسلة تنفيذه — يرجّعه منفّذه للطابور، أو يتجاوزه اللي يدير الهيكل.','No other executor in its chain.')}</small>`;
    const dept=data.department??null,reached=reachedKeys();
    // اسم الشاشة كما يسمّيها حساب صاحبها (التسمية الثابتة في كل عدسة، يبنيها الخادم من placeFor)، ورابطها #مفتاحها.
    const deptScreens=dept&&reached?(dept.screens??[]).filter(s=>reached.has(s.key)):[];
    const screenChip=s=>`<span class="hm-strip-card"><a class="eu-chip" href="${e(s.link)}">${e(s.label)}</a></span>`;
    const screenCount=n=>lang==='ar'?countNoun(n,SCREENS):countEn(n,'screen');
    // عنوان الخدمة السرية لا يُكتب، ويبقى اسم الخدمة وحده: مدير الإدارة يعرف أن طلبًا موجود لا ما فيه.
    const workTitle=r=>e(r.confidential?`${r.service_name} (${tr('سري','confidential')})`:r.title||r.service_name);
    const heldRow=r=>`<li class="${r.assignee_active?'':'is-late'}"><strong>${workTitle(r)}</strong><span><bdi>${e(r.reference)}</bdi> · ${tr('عند','with')} ${e(r.assignee_name)}${r.assignee_active?'':` — ${tr('حسابه موقوف','account stopped')}`} · ${e(waited(r.held_working_days))}</span>${reassignForm(r)}</li>`;
    const backRow=r=>`<li><strong>${workTitle(r)}</strong><span>${[r.reference?`<bdi>${e(r.reference)}</bdi>`:'',r.requester_name?e(r.requester_name):'',r.returned_by_name?`${tr('رجّعه','returned by')} ${e(r.returned_by_name)}`:''].filter(Boolean).join(' · ')} · ${e(waited(r.age_days))}</span></li>`;
    // الأرقام لمن قُرئت له القوائم (مدير الإدارة): عددُ كل كتلة طولُ قائمتها، ومن لم تُقرأ له لا يُعرض له عدد.
    // وكتلةٌ لما فيه صفوف وحده: ثلاث خانات فارغة متجاورة تُمسح بالعين ولا تُقرأ، والخبرُ نفسه يقوله سطر واحد
    // تحتها يسمّي ما قُرئ ولم يوجد فيه شيء — فالطمأنينة تبقى ولا يبقى الفراغ.
    const deptParts=[
      {rows:dept?.overruns??[],draw:requestRow,link:'#requests',linkLabel:tr('الطلبات','Requests'),
        title:tr('تجاوزت المدة في إدارتي','Past their service level in my department'),
        hint:tr('طلبات إدارتك اللي فات زمنها المستهدف.','Requests of your department that are past their approved service level.'),
        none:tr('ما فيه تجاوز مدة ظاهر لك','no overrun visible to you')},
      {rows:dept?.held??[],draw:heldRow,link:'',linkLabel:'',
        title:tr('ما تنفّذه إدارتي الآن','What my department is executing now'),
        hint:tr('شغل ماشي الحين وعند مين، وتعيد إسناده إذا غاب منفّذه.','Work in progress and with whom — reassign it if its executor is gone.'),
        none:tr('ولا شي قيد التنفيذ','nothing in progress')},
      {rows:dept?.returned??[],draw:backRow,link:'',linkLabel:'',
        title:tr('معادة تنتظر أصحابها','Returned, waiting on their owners'),
        hint:tr('للمتابعة بس: الرد عند صاحب الطلب وساعة الخدمة موقوفة، وما ينفتح لك الطلب قبل اعتماده.','Follow-up only: the reply is with the requester, the service clock is paused, and the request does not open for you before it is approved.'),
        none:tr('ولا طلب معاد ينتظر صاحبه','no returned request waiting on its owner')}];
    const deptEmpty=dept?.work_read?deptParts.filter(part=>!part.rows.length):[];
    const deptWork=dept?.work_read
      ?deptParts.filter(part=>part.rows.length).map(part=>named(part.title,part.hint,part.rows,part.draw,'',part.link,part.linkLabel)).join('')
        +(deptEmpty.length?`<p class="subtle">${e(tr('إدارتك اليوم:','Your department today:'))} ${e(deptEmpty.map(part=>part.none).join('، '))}.</p>`:'')
      :'';
    const department=dept&&(deptScreens.length||deptWork)?`<section class="vn-board"><div class="panel-head"><div><h2>${tr('شغل إدارتي','My department')}</h2>`
      +`<p class="subtle"><strong>${e(dept.name)}</strong> — ${en?'Your department screens and its open work, as your own access shows them — not the whole company.':e(dept.scope_note)}</p></div>`
      +`<a class="btn outline small" href="${e(dept.link)}">${tr('صفحة الإدارة','Department page')}</a></div>`
      +(deptScreens.length?`<p class="subtle">${e(screenCount(deptScreens.length))} ${tr('من إدارتك بين يدك.','from your department, open to you.')}</p>`
        +`<nav class="eu-quick hm-strip" aria-label="${tr('شاشات إدارتي','My department screens')}">${deptScreens.map(screenChip).join('')}</nav>`:'')
      +`${deptWork}</section>`:'';
    const approvals=data.manager?(data.manager.request_approvals??data.manager.pending_approvals):[];
    const oldest=data.manager?.oldest_approval&&approvals.some(r=>r.id===data.manager.oldest_approval.id)?data.manager.oldest_approval:null;
    const manager=data.manager?`<section class="vn-board"><div class="panel-head"><h2>${tr('ما يخص دوري كمدير','For my role as a manager')}</h2></div><p class="subtle">${en?'Built from the requests you can see, not from every request in the company.':e(data.manager.scope_note)}</p>
      ${block(tr('طلبات فريقي المتأخرة',"My team's late requests"),'#requests',tr('الطلبات','Requests'),list(data.manager.team_late,tr('ما فيه طلب متأخر في فريقك.','No late request in your team.'),r=>`<li class="is-late"><a href="${e(r.link)}"><strong>${e(r.title)}</strong></a><span>${e(r.requester_name)} · ${e(timeNote(r))}</span></li>`),3)}
      ${block(tr('طلبات تنتظر اعتمادي','Requests awaiting my approval'),'#inbox',tr('بانتظار إجرائي','My actions'),list(approvals,tr('ما فيه طلب ينتظر اعتمادك.','No request is awaiting your approval.'),decisionRow)+(oldest?`<p class="subtle">${tr('أقدمها:','Oldest:')} ${e(oldest.title)} — ${sinceHtml(oldest)}.</p>`:''),3)}</section>`:'';

    const hr=data.hr?`<section class="vn-board"><div class="panel-head"><h2>${tr('ما يخص الموارد البشرية','For human resources')}</h2></div><p class="subtle">${en?'Documents and contracts from their sources; requests are those your requests screen shows you.':e(data.hr.scope_note)}</p>
      ${block(tr('وثائق منتهية','Expired documents'),'#expiry',tr('مراقبة الانتهاء','Expiry watch'),list(data.hr.expired_documents,tr('ما فيه وثيقة منتهية.','No expired document.'),d=>`<li class="is-late"><a href="${e(d.link)}"><strong>${e(d.doc_kind_name)} — ${e(d.subject_name)}</strong></a><span>${tr('انتهت','Expired on')} ${dateTag(d.expires_on)}</span></li>`),3)}
      ${block(tr('وثائق قرّبت تنتهي','Documents expiring soon'),'#expiry',tr('مراقبة الانتهاء','Expiry watch'),list(data.hr.due_soon_documents,tr('ما فيه وثيقة قرّبت تنتهي ضمن المدد المسجّلة.','No document is expiring within the recorded periods.'),d=>`<li class="is-due"><a href="${e(d.link)}"><strong>${e(d.doc_kind_name)} — ${e(d.subject_name)}</strong></a><span>${tr('تنتهي','Expires')} ${dateTag(d.expires_on)} · ${e(left(d.days_left))}</span></li>`)+(data.hr.unconfigured_kinds.length?`<p class="vn-alert">${tr('أنواع ما لها مدة تذكير مسجّلة، فما ينقال عنها «قرّبت تنتهي» لين تندخل مدتها بسندها:','Types with no reminder period set, not called "expiring soon" until one is entered with its source:')} ${e(data.hr.unconfigured_kinds.join('، '))}.</p>`:''),3)}
      ${block(tr('العقود المنتهية','Ended contracts'),'#contracts',tr('العقود','Contracts'),list(data.hr.ended_contracts,tr('ما فيه عقد انتهى وهو مسجّل ساري.','No ended contract is still recorded as active.'),alertRow)+(data.hr.ending_contracts.length?`<p class="subtle">${tr('وتنتهي قريب:','Ending soon:')} ${e(data.hr.ending_contracts.length)}</p>`:''),3)}
      ${block(tr('طلبات الموارد البشرية المفتوحة','Open HR requests'),'#requests',tr('الطلبات','Requests'),list(data.hr.pending_requests,tr('ما فيه طلبات مفتوحة تشوفها.','No open requests are shown to you.'),requestRow),3)}</section>`:'';

    const f=data.finance;
    const finance=f?`<section class="vn-board"><div class="panel-head"><h2>${tr('ما يخص المالية','For finance')}</h2></div><p class="subtle">${en?'An approved payment order is not paid until its bank execution is recorded; the platform makes no transfer.':e(f.scope_note)}</p>
      ${f.overdue_receivables?block(tr('المستحقات المتأخرة','Overdue receivables'),'#receivables',tr('المستحقات','Receivables'),list(f.overdue_receivables,tr('ما فيه مستحق متأخر.','No overdue receivable.'),c=>`<li class="is-late"><a href="${e(c.link)}"><strong>${money(c.balance_minor)}</strong></a><span>${tr('تاريخ الاستحقاق','Due date')} ${dateTag(c.due_date)}</span></li>`),3):''}
      ${f.pending_payment_orders?block(tr('أوامر الدفع المعلقة','Pending payment orders'),'#payables',tr('المدفوعات','Payments'),list(f.pending_payment_orders,tr('ما فيه أمر دفع معلّق.','No pending payment order.'),o=>`<li class="is-due"><a href="${e(o.link)}"><strong>${e(o.vendor_name)}</strong></a><span>${money(o.amount_minor)} · ${tr('بانتظار الاعتماد','awaiting approval')}</span></li>`),3):''}
      ${f.open_periods?block(tr('الفترات اللي ما انقفلت','Open periods'),'#finance',tr('الدفتر المالي','Ledger'),list(f.open_periods,tr('ما فيه فترة مفتوحة.','No open period.'),p=>`<li><a href="${e(p.link)}"><strong>${e(p.name)}</strong></a><span>${tr('من','From')} ${dateTag(p.starts_on)} ${tr('لين','to')} ${dateTag(p.ends_on)}</span></li>`),3):''}</section>`:'';

    const x=data.executive;
    const executive=x?`<section class="vn-board"><div class="panel-head"><h2>${tr('أرقام القيادة المجمّعة','Leadership totals')}</h2><a class="btn outline small" href="${e(x.link)}">${tr('اللوحة التنفيذية','Executive board')}</a></div><p class="subtle">${e(x.scope)}</p>
      <div class="vn-tiles">${[['people','منسوب','people'],['departments','إدارة','departments'],['open','طلب مفتوح','open requests'],['overdue','طلب تجاوز زمنه','overdue requests'],['completed','طلب مكتمل','completed requests'],['tasks_open','مهمة مفتوحة','open tasks']].map(([k,label,label_en])=>ui.tile(x.totals[k]??0,tr(label,label_en),k==='overdue'&&x.totals[k]?'is-late':'')).join('')}</div>
      ${block(tr('ما يستدعي الانتباه','Needs attention'),'','',list(x.attention,tr('ما فيه شي يستدعي الانتباه في الأرقام المجمّعة.','Nothing in the totals needs attention.'),a=>`<li class="${a.kind==='overdue'?'is-late':'is-due'}"><strong>${e(a.text)}</strong></li>`),3)}</section>`:'';

    // السؤال أولًا، ثم ما يُبدأ منه، ثم بطاقة اليوم وأرقامها، ثم الكتل، ثم التفاصيل، ثم إدارتي ثم بقية أقسام الأدوار:
    // «شغل إدارتي» قبل «دوري كمدير» لأن الإدارة أوسع من الفريق، ولأن من له إدارة وليس مديرًا يجدها ولا يجد ما بعدها.
    return `${welcome}${ask}${sub}${strip}${stats}${todayCard(data.today_card,{e,tr,lang})}${availability}${workNow}${returnedWatch}${mineBlock?`<section class="vn-board">${mineBlock}</section>`:''}${personal}${discipline}${department}${manager}${hr}${finance}${executive}`;
  },
  // الفعل الوحيد هنا هو البصمة، ويجري بنقرة واحدة من app.mjs (data-action="punch") لا بنموذج.
  form(){guard(false);}
};
