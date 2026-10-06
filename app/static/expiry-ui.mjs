// مراقبة انتهاء الوثائق: تقرأ تواريخ الانتهاء من مصادرها القائمة، ولا تعرف متى ينبغي التذكير حتى يدخل مالك الإجراء المدة بمصدرها.
// بلاطة الرقم المحلية باقية بحرفها (ترحيل منسَّق: tests/kit.test.mjs يعدّ نسخها)، والحالة الفارغة من العدّة (ui)، والاختبار الذي
// يرسم الشاشة بلا ui يأخذ العدّة نفسها افتراضًا (kit(e)).
import { dual } from './dates.mjs';
import { kit } from './kit.mjs';
import { countNoun } from './arabic-count.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
// نص الحارس مثبَّت في tests/expiry.test.mjs (/الإجراء غير متاح/)، فبقي بحرفه.
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const labels={set_watch:'إدخال مدة التذكير',update_watch:'تعديل مدة التذكير'};
const stateNames={expired:'منتهية',due_soon:'تقترب من الانتهاء',ok:'سارية'};
// التاريخ بنصه المعتاد (ميلادي · هجري) وقيمته الآلية في datetime؛ والأيام بصيغتها العربية والرقم وحده مجدول.
const when=(e,iso)=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(dual(iso))}</time>`:'—';
const counted=(e,n)=>e(countNoun(n,'day')).replace(/^-?\d[\d,.]*/,m=>`<span data-num>${m}</span>`);
// ما بقي أو ما مضى بكلمته، لا «-3 يومًا».
const left=(e,n)=>n<0?`انتهت ومضى عليها ${counted(e,-n)}`:n===0?'تنتهي اليوم':`باقي ${counted(e,n)}`;
const reminders=(e,s)=>`التذكير الأول ${counted(e,s.first_reminder_days)} والثاني ${counted(e,s.second_reminder_days)} قبل الانتهاء`;

export const expiryUI={
  title:'مراقبة انتهاء الوثائق',
  description:'تواريخ انتهاء وثائق الموظفين والعقود محددة المدة ووثائق الموردين، من مصادرها لحظيًا. المنتهي يطلع دايم، و«تقترب من الانتهاء» تطلع بعد ما يدخل مالك الإجراء مدة التذكير بمصدرها.',
  load:api=>api('/expiry'),
  render(data,{e,button,ui=kit(e)}){
    const tile=(value,label,tone='')=>`<div class="vn-tile ${tone}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
    // الصف يحمل كلمة حالته (منتهية، تقترب من الانتهاء، سارية) مع لونه. ورمز المورد في أول اسم صاحب الوثيقة («V-0004 · …») معزول الاتجاه.
    const itemRow=i=>`<li class="${i.status==='expired'?'is-late':i.status==='due_soon'?'is-due':'is-ok'}"><a href="${e(i.link)}"><strong>${e(i.doc_kind_name)} — ${e(i.subject_name).replace(/^[A-Z][A-Z0-9]*-[0-9]+/,code=>`<span class="ltr">${code}</span>`)}</strong></a><span>${e(stateNames[i.status]??i.status)} · ينتهي ${when(e,i.expires_on)} · ${left(e,i.days_left)} · المرجع <bdi>${e(i.reference)}</bdi>${i.scope==='own'?' · وثيقتك':''}</span>${i.configured?`<small>${reminders(e,i)} — ${e(i.basis)}</small>`:'<small>ما لنوعها مدة تذكير مسجّلة: تطلع إذا انتهت بس، وما ينقال إنها تقترب.</small>'}</li>`;
    const kindRow=k=>`<li class="${k.setting?'is-ok':k.in_use?'is-due':'is-old'}"><strong>${e(k.name)}</strong><span>${k.setting?`${reminders(e,k.setting)} · آخر تحديث ${when(e,k.setting.updated_at)}`:'ما له مدة مسجّلة'}${k.in_use?' · له وثائق قائمة':''}</span>${k.setting?`<small>${e(k.setting.basis)}</small>`:''}${k.actions.length?`<div class="operation-actions">${k.actions.map(a=>button(a,k.key,labels[a])).join('')}</div>`:''}</li>`;

    // ما ينتظر قرارًا يُقال أول الشاشة بلون الانتباه.
    const missing=data.missing_settings.filter(m=>m.can_set);
    const head=`<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      ${missing.length?`<p class="vn-alert is-due">أنواع عندها وثائق قائمة وما لها مدة تذكير: ${e(missing.map(m=>m.name).join('، '))}. دخّل مدتها ومصدرها من قائمة الأنواع تحت.</p>`:''}
      ${data.malformed.length?`<p class="vn-alert is-due">سجلات تاريخ انتهائها بصيغة غلط، فما انحسبت: <span data-num>${e(data.malformed.length)}</span> — صحّحها من شاشاتها.</p>`:''}</section>`;

    // اللون للحالة القائمة وحدها: صفر بلا لون.
    const tiles=`<div class="vn-tiles">${tile(data.totals.expired,'منتهية',data.totals.expired?'is-late':'')}${tile(data.totals.due_soon,'تقترب من الانتهاء',data.totals.due_soon?'is-due':'')}${tile(data.totals.ok,'سارية',data.totals.ok?'is-ok':'')}${tile(data.totals.unconfigured,'بلا مدة تذكير مسجلة',data.totals.unconfigured?'is-due':'')}</div>`;
    const watched=data.items.filter(i=>i.status!=='ok'),valid=data.items.filter(i=>i.status==='ok');
    // المصادر المقروءة وما بقي خارج الرصد مرجعٌ آخر الشاشة، في قائمة واحدة.
    const sources=`<section class="vn-block"><div class="panel-head"><h2>المصادر المقروءة</h2></div><ul class="vn-list">${data.sources.map(s=>`<li><strong>${e(s.name)}</strong><span>${e(s.scope)}</span></li>`).join('')}${data.not_watched.map(n=>`<li><strong><bdi>${e(n.source)}</bdi></strong><span>خارج الرصد: ${e(n.reason)}</span></li>`).join('')}</ul></section>`;

    return `${head}<section class="vn-board">${tiles}
      <section class="vn-block"><div class="panel-head"><h2>ما انتهى أو يقترب</h2></div>${watched.length?`<ul class="vn-list">${watched.map(itemRow).join('')}</ul>`:ui.empty('ما فيه وثيقة منتهية أو قرّبت','تطلع هنا الوثيقة إذا انتهت، أو إذا وصلت مدة تذكير مسجّلة لنوعها.')}</section>
      <section class="vn-block"><div class="panel-head"><h2>وثائق سارية</h2></div>${valid.length?`<ul class="vn-list">${valid.map(itemRow).join('')}</ul>`:'<p class="subtle">للحين ما فيه وثائق سارية تخصّك — تطلع هنا من المصادر المقروءة تحت.</p>'}</section>
      <section class="vn-block"><div class="panel-head"><h2>أنواع الوثائق ومدد التذكير</h2></div>${data.can_set_any?'':'<p class="subtle">المدد يدخلها مالك إجراء كل نوع، وأنت تشوفها بس.</p>'}<ul class="vn-list">${data.kinds.map(kindRow).join('')}</ul></section>
      ${sources}</section>`;
  },
  form(action,id,data){
    const kind=data.kinds.find(k=>k.key===id);
    guard(kind&&kind.actions.includes(action));
    const s=kind.setting;
    return {
      title:`${labels[action]} — ${kind.name}`,
      endpoint:`/expiry/settings/${id}`,
      idempotent:!s,
      fields:[
        field('first_reminder_days','التذكير الأول: كم يوم قبل الانتهاء','number',{min:1,max:730,value:s?String(s.first_reminder_days):'',hint:'اكتب المدة اللي قررتوها.'}),
        field('second_reminder_days','التذكير الثاني: كم يوم قبل الانتهاء','number',{min:1,max:730,value:s?String(s.second_reminder_days):'',hint:'أقل من الأول: تنبيه قريب من الموعد.'}),
        field('basis','مصدر المدة ومن أكدها وتاريخ التأكيد','textarea',{value:s?s.basis:'',hint:'اكتب من وين جات المدة (قرار داخلي، خطاب جهة، مختص)، ومن أكدها ومتى. لا تكتب مدة ما تعرف سندها.'})
      ],
      toPayload:v=>({...(s?{version:s.version}:{}),first_reminder_days:Number(v.first_reminder_days),second_reminder_days:Number(v.second_reminder_days),basis:v.basis})
    };
  }
};
