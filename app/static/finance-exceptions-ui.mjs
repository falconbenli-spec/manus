// شاشة الاستثناءات المالية (الحزمة 3): كل استثناء من مصدره، بمالكه وإقراره. الشاشة لا تحسم شيئًا: الحسم في شاشة المصدر
// (الرابط على كل بند)، والإقرار هنا يقول إن المالك رآه وما الذي سيفعله.
import { kit } from './kit.mjs';
import { riyadhDay } from './dates.mjs';
const ORDER=['held_invoice','unmatched_bank_line','unposted_source','control_difference','overdue_reclose','reversal_awaiting_approval','broken_promise'];

export const financeExceptionsUI={
  title:'الاستثناءات المالية',
  description:'فواتير موقوفة، وسطور كشف بلا قرار، ومستندات بلا قيد مرحّل، وفروق حسابات رقابية، وإعادة إقفال فات موعدها، وعكس ينتظر اعتماده، ووعود سداد ما انوفت. كل بند ينحسب من مصدره الحين ويختفي أول ما ينحسم هناك، ولكل بند مالك يقرّ به.',
  load:api=>api('/finance-exceptions'),
  render(data,{e,button,money,ui=kit(e)}){
    // المبلغ رقمٌ معزول الاتجاه، وإشارته داخل العزل؛ والعملة تُسمّى بعده مرة.
    const amount=minor=>minor===null||minor===undefined?'':`<span class="ltr">${e(money(minor,'').trim())}</span> ريال`;
    const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'';
    // البند: عنوانه رابطٌ إلى مصدره (هناك يُحسم)، ثم ما هو، ثم مبلغه وتاريخه، ثم مالكه وإقراره. الذي ينتظر إقرارك بعلامة «دورك» وكلمتها.
    const item=x=>{
      const yours=x.actions.length>0,ack=x.acknowledgement;
      const facts=[amount(x.amount_minor),day(x.date)].filter(Boolean).join(' · ');
      return ui.row({title:x.title,href:x.link,meta:x.detail,tone:yours?'is-decision':ack?.current?'':'is-due',
        html:(yours?'<span class="badge is-decision">ينتظر إقرارك</span>':'')
          +(facts?`<span>${facts}</span>`:'')
          +`<small>المالك: ${e(x.owner)}${x.inbox?'':' · قراره في صندوق صاحبه'}</small>`
          +(ack?`<small class="measure">${ack.current?'أقرّ به':'أقرّ بمبلغ قبل ما يتغيّر'} ${e(ack.acknowledged_by_name??'')}${ack.created_at?` في <time datetime="${e(ack.created_at)}">${e(riyadhDay(ack.created_at))}</time>`:''} — ${e(ack.note)}</small>`:'')
          +(yours?`<div class="operation-actions">${button('acknowledge_exception',x.key,'إقرار')}</div>`:'')});
    };
    const mine=data.exceptions.filter(x=>x.actions.length);
    const groups=ORDER.map(kind=>({kind,name:data.kinds[kind].name,items:data.exceptions.filter(x=>x.kind===kind&&!x.actions.length)})).filter(g=>g.items.length);
    const section=(title,items)=>`<section class="vn-block"><div class="panel-head"><h2>${e(title)} <span data-num>(${items.length})</span></h2></div><ul class="vn-list">${items.map(item).join('')}</ul></section>`;
    // حزمة تدقيق الفترة: رابط تنزيل عادي كبقية التصدير، لمن يحمل تصريحها فقط (الخادم يقرر allowed).
    const auditPackage=data.audit_export?.allowed&&data.audit_export.periods.length?`<section class="vn-block"><div class="panel-head"><h2>حزمة تدقيق الفترة</h2></div>
      <p class="subtle measure">قيود الفترة ومستنداتها واعتماداتها وتسوياتها وعكوسها، ومقطع سجل التدقيق اللي يغطيها، في ملف واحد. التنزيل نفسه ينسجّل في السجل. وتفحص الملف بدون المنصة بالأمر <code>node scripts/verify-audit-package.mjs</code> واسم الملف.</p>
      <div class="operation-actions">${data.audit_export.periods.map(p=>`<a class="btn outline small" href="${e(p.href)}" download>${e(p.name)}</a>`).join('')}</div></section>`:'';
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">${ORDER.map(kind=>ui.tile(data.counts[kind]??0,data.kinds[kind].name,data.counts[kind]?'is-due':'')).join('')}</div></section>
      ${mine.length?section('ينتظر إقرارك',mine):''}
      ${groups.map(g=>section(g.name,g.items)).join('')}
      ${data.exceptions.length?'':ui.empty('ما فيه استثناء مالي الحين','كل ما ينحسب هنا محسوم في مصدره؛ ويطلع هنا أول بند يتعلّق بلا قرار، ومعه رابط شاشته.')}${auditPackage}`;
  },
  form(action,id,data){
    if(action!=='acknowledge_exception')throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');
    const x=data.exceptions.find(item=>item.key===id);
    return {title:`إقرار: ${x?.title??'استثناء مالي'}`,endpoint:'/finance-exceptions/acknowledge',
      fields:[{name:'note',label:'وش شفت ووش بتسوي ومتى',type:'textarea',hint:'الإقرار ما يحسم الاستثناء؛ الحسم في شاشة مصدره. ولو تغيّر المبلغ بعدين ينطلب إقرار جديد.'}],
      toPayload:v=>({key:id,note:v.note})};
  }
};
