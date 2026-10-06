// بانتظار إجرائي: كل ما تعرضه عليك شاشات المنصة من قرارات وردود، في مكان واحد. القرار يُتخذ في سجله.
// الأرقام من «ما عليّ» (app/obligations.mjs) نفسها التي تقرؤها الرئيسية وشارة القائمة و«مهامي»: لا عدّ هنا،
// وكل رقم في الشاشة طولُ القائمة التي تحته، أو عدّ الخادم لها قبل القطع ومعه «يُعرض N من M».
// العدّة من ctx.ui، وبلاها (اختبار يرسم الشاشة بسياق مختصر) تُبنى من kit نفسها فلا نسخة محلية.
import { kit } from './kit.mjs';
import { REQUESTER_STAGES } from './vocabulary.mjs';

const NEEDS_YOU=REQUESTER_STAGES.needs_you[0];
const ISO_DAY=/^\d{4}-\d{2}-\d{2}/;
// أيام العمل بلهجة المنصة: «يومين عمل» لا «يوما عمل»، و«15 يوم عمل» لا «15 يومًا».
const workDays=n=>n===1?'يوم عمل':n===2?'يومين عمل':`${n} ${n>=3&&n<=10?'أيام':'يوم'} عمل`;
// العمر بأيام العمل منذ وصل البند إليك، لا منذ آخر تعديل على سجله.
const ageText=n=>n===0?'وصلك اليوم':`وصلك من ${workDays(n)}`;

export const inboxUI={
  title:'بانتظار إجرائي',description:'كل شي ينتظر قرارك أو ردّك في المنصة، من كل الشاشات وبحسب صلاحيتك. كل بند يفتح سجله، والقرار يصير هناك.',
  load:api=>api('/inbox'),
  render(data,{e,ui:given}){
    const ui=typeof given?.row==='function'?given:kit(e);
    // التاريخ يُكتب <time> بقيمته الآلية، والنص المقروء ما تقوله الجملة (منذ متى، أو الموعد نفسه).
    const stamp=(iso,text)=>ISO_DAY.test(String(iso??''))?`<time datetime="${e(String(iso).slice(0,10))}">${e(text)}</time>`:e(text);
    const age=i=>i.age_days===null||i.age_days===undefined?'':stamp(i.since,ageText(i.age_days));
    const due=i=>i.optional||!i.due_on||i.due_basis==='working_days_waiting'?'':`${e(i.due_basis_name||'الموعد')} ${stamp(i.due_on,i.due_on)}`;
    // سياق البند قد يكون تاريخًا (يوم العطلة، يوم المهمة): يُعزل <time> مثل بقية التواريخ.
    const context=i=>i.context?(/^\d{4}-\d{2}-\d{2}$/.test(i.context)?stamp(i.context,i.context):e(i.context)):'';
    // البند: ما هو، ثم المطلوب منك فيه، ثم من أين جاء ومنذ متى وموعده، ثم ما يفتحه قرارك، ثم رابط سجله.
    // الرابط الوحيد في الصف يمتد على الصف كله (journey.css)، فالنقر في أي موضع منه يفتح السجل. واسمه المسموع يحمل البند.
    // العلامة شكلٌ وكلمة: ما ينتظرك «دورك» (is-decision، وكلمته عنوان القسم)، والمتأخر «متأخر»، والاختياري خامل.
    const itemRow=i=>ui.row({title:[i.kind,i.title].filter(Boolean).join(' · '),tone:i.late?'is-late':i.optional?'is-old':'is-decision',
      html:`<span>${[e((i.actions??[]).join('، ')),context(i),age(i),due(i),i.late?'متأخر':''].filter(Boolean).join(' · ')}</span>`
        +`${i.unblocks?`<small>${e(i.unblocks)}</small>`:''}`
        +`<a class="btn outline small" href="${e(i.link)}" aria-label="${e(`فتح السجل: ${i.title}`)}">فتح السجل</a>`});
    // القطع يُقال ولا يُخفى: الرقم في العنوان عدد كل ما ينتظر، والمعروض بعضه، وبقيته في شاشته.
    const groups=data.groups.map(g=>`<section class="vn-group"><h2>${e(g.name)} <span>${e(g.total)}</span></h2><section class="vn-block"><ul class="vn-list">${g.items.map(itemRow).join('')}</ul>`
      +`${g.truncated?`<p class="subtle">${e(g.shown_note)} — <a href="${e(g.link)}">${e(`كمّل الباقي في «${g.name}»`)}</a></p>`:''}</section></section>`).join('');
    // ما ينتظر ردّك: رقمه طول قائمته. والاختياري (سؤال التجربة، وإعادة الفتح، ومسوداتك) مطويّ تحته بعدّه هو، لأنه ما يتأخر ولا ينعدّ عليك.
    const respond=data.respond??[],asked=respond.filter(i=>!i.optional),optional=respond.filter(i=>i.optional);
    const replies=(asked.length?`<section class="vn-group"><h2>${e(NEEDS_YOU)} <span>${e(asked.length)}</span></h2><section class="vn-block"><ul class="vn-list">${asked.map(itemRow).join('')}</ul></section></section>`:'')
      +(optional.length?`<details class="vn-group eu-group"><summary><h2>اختياري — ما يتأخر ولا ينعدّ عليك <span>${e(optional.length)}</span></h2></summary><section class="vn-block"><ul class="vn-list">${optional.map(itemRow).join('')}</ul></section></details>`:'');
    const limit=data.waiting_limit_days;
    // القرار أولًا: البنود ثم ما ينتظر ردّك، ثم العدّادات التي ليست صفرًا، ثم طريقة الصندوق مطويّة. (في العرض الواسع تبقى الأرقام
    // عمود البيان الثابت بجوار البنود: style.css يضعها في العمود الأول صراحةً، فترتيب الترميز لا يحرّكها.)
    const tiles=[data.total?ui.tile(data.total,'ينتظر قرارك الحين','is-decision'):'',
      data.late?ui.tile(data.late,limit?`متأخر: فات موعده أو صار له ${workDays(limit)}`:'متأخر: فات موعده','is-late'):'',
      asked.length?ui.tile(asked.length,NEEDS_YOU,asked.some(i=>i.late)?'is-late':'is-decision'):'',
      data.groups.length?ui.tile(data.groups.length,'شاشة فيها شي ينتظر قرارك'):''].join('');
    // لا شيء ينتظر: الجملة جواب الشاشة (vn-none يكبّرها)، إلا إن لحقها ردٌّ ينتظر أو مصدرٌ تعذرت قراءته فـ«ما فيه شي» غير مؤكدة.
    const none=`<section class="panel panel-body${respond.length||data.unavailable.length?'':' vn-none'}">ما ينتظرك قرار الحين، وأول ما يوصلك شي يطلع هنا.</section>`;
    const how=data.note||data.late_note?`<details class="rq-help"><summary>كيف يشتغل هالصندوق؟</summary>${data.note?`<p class="measure">${e(data.note)}</p>`:''}${data.late_note?`<p class="subtle measure">${e(data.late_note)}</p>`:''}</details>`:'';
    return `${groups||none}${replies}${tiles?`<section class="vn-board"><div class="vn-tiles">${tiles}</div></section>`:''}${how}`
      +`${data.unavailable.length?'<p class="notice" role="status">بعض البيانات غير متاحة الآن. حدّث الصفحة أو جرّب لاحقًا.</p>':''}`;
  },
  form(){throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة.');}
};
