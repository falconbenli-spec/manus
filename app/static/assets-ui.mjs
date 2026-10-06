// الأصول الثابتة والإهلاك بالقسط الثابت.
// البلاطة والجدول والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const labels={approve_asset:'اعتماد الأصل',reject_asset:'رفض التسجيل',dispose_asset:'استبعاد الأصل'};
const states={pending:'بانتظار الاعتماد',active:'في الخدمة',disposed:'مستبعد',rejected:'مرفوض'};
// الحالة شكلٌ وكلمة: المنتظر بشكل الانتظار، والمرفوض بشكل الرفض، والمستبعد ساكن، والذي في الخدمة صامت.
const tones={pending:'pending',active:'approved',disposed:'closed',rejected:'rejected'};
export const assetsUI={
  title:'الأصول الثابتة',description:'سجل الأصول بتكلفتها وعمرها ومسؤولها، وإهلاك شهري بالقسط الثابت ينحسب مرة وحدة ويتقيّد من شاشة «القوائم المالية والترحيل».',
  load:api=>api('/assets'),
  render(data,{e,button,money,ui=kit(e)}){
    const prepare=data.permissions.includes('prepare');
    // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية، والعملة تُسمّى مرة: في تسمية البلاطة ورأس العمود، وبعد أول مبلغ في البطاقة.
    const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
    const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
    // البطاقة تبدأ بما يُقرّر عليه: المنتظر اعتماده يُقرأ بتكلفته، والذي في الخدمة بصافي قيمته الدفترية.
    const assetCard=a=>{
      const decide=a.actions.includes('approve_asset'),[leadLabel,lead]=['pending','rejected'].includes(a.status)?['التكلفة',a.cost_minor]:['صافي دفتري',a.net_book_minor];
      const tone=decide?'is-decision':a.status==='pending'?'is-pending':a.status==='active'?'':'is-old';
      const badge=decide?'<span class="badge is-decision">ينتظر اعتمادك</span>':`<span class="badge ${tones[a.status]??''}">${e(states[a.status]??a.status)}</span>`;
      return `<details class="vn-card ${tone}"${decide?' open':''}><summary><span class="vn-code"><bdi>${e(a.code)}</bdi></span><span class="vn-name"><strong>${e(a.name)}</strong><small>${e(a.category_name)} · ${e(a.custodian_name||'بدون مسؤول')} · ${e(a.location||'بدون موقع مسجّل')}</small></span><span class="vn-flags"><strong>${e(leadLabel)} ${fig(lead)} ريال</strong>${badge}</span></summary><div class="vn-body">
        ${a.actions.length?`<div class="operation-actions">${a.actions.map(x=>button(x,a.id,labels[x])).join('')}</div>`:''}
        ${a.status==='pending'?`<p class="subtle">المسجِّل: ${e(a.recorded_by_name)} — والاعتماد لشخص ثاني.</p>`:''}
        <dl class="vn-facts"><div><dt>تاريخ الاقتناء</dt><dd>${day(a.acquired_on)}</dd></div><div><dt>التكلفة</dt><dd>${fig(a.cost_minor)}</dd></div><div><dt>قيمة الخردة</dt><dd>${fig(a.salvage_minor)}</dd></div><div><dt>العمر الإنتاجي</dt><dd><span data-num>${e(a.useful_months)}</span> شهر</dd></div><div><dt>مجمع الإهلاك</dt><dd>${fig(a.accumulated_minor)}</dd></div><div><dt>صافي القيمة الدفترية</dt><dd>${fig(a.net_book_minor)}</dd></div></dl>
        <p class="subtle measure">${e(a.evidence)}</p>${a.disposal_note?`<p class="subtle measure">${a.status==='disposed'?`انستبعد${a.disposed_on?` في ${day(a.disposed_on)}`:''}: `:'سبب الرفض: '}${e(a.disposal_note)}</p>`:''}</div></details>`;
    };
    const group=(title,rows)=>rows.length?`<section class="vn-group"><h2>${e(title)} <span>${rows.length}</span></h2>${rows.map(assetCard).join('')}</section>`:'';
    const decide=data.assets.filter(a=>a.actions.includes('approve_asset')),rest=data.assets.filter(a=>!decide.includes(a));
    const runs=data.runs.length
      ?ui.table({head:['الشهر','قسط الإهلاك (ريال)'],rows:data.runs.map(r=>`<tr><td><time datetime="${e(r.month)}">${e(r.month)}</time></td><td>${fig(r.total_minor)}</td></tr>`)})
      :'<p class="subtle">ما انحسب إهلاك أي شهر للحين — ينحسب من «حساب إهلاك شهر» بعد ما ينعتمد أول أصل.</p>';
    return `<section class="panel panel-body vn-head">${prepare?`<div class="operation-actions">${button('register_asset','','تسجيل أصل')}${button('run_depreciation','','حساب إهلاك شهر')}</div>`:''}<p>الإهلاك يبدأ من الشهر اللي بعد الاقتناء، والشهر الأخير يشيل فرق التقريب. الاستبعاد يوقف الإهلاك، وما يحسب ربح ولا خسارة للحين.</p></section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(data.totals.count,'أصل في الخدمة')}${ui.tile(num(data.totals.cost_minor),'تكلفتها بالريال')}${ui.tile(num(data.totals.accumulated_minor),'مجمع إهلاكها بالريال')}${ui.tile(num(data.totals.net_book_minor),'صافي قيمتها الدفترية بالريال')}</div></section>
      ${group('ينتظر اعتمادك',decide)}${group('بانتظار اعتماد زميل',rest.filter(a=>a.status==='pending'))}${group('في الخدمة',rest.filter(a=>a.status==='active'))}${group('مستبعدة ومرفوضة',rest.filter(a=>['disposed','rejected'].includes(a.status)))}
      ${data.assets.length?'':ui.empty('ما فيه أصول مسجّلة للحين',prepare?'سجّل أول أصل من «تسجيل أصل» بتكلفته وعمره ومرجع فاتورته، ويعتمده زميل ثاني.':'تطلع هنا الأصول أول ما تسجّلها المالية ويعتمدها زميل ثاني.')}
      <section class="vn-block"><div class="panel-head"><h2>أشهر انحسب إهلاكها</h2></div>${runs}</section>`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    if(action==='register_asset'){guard(data.permissions.includes('prepare'));return {title:'تسجيل أصل ثابت',endpoint:'/assets',idempotent:true,fields:[field('name','اسم الأصل'),field('category','الفئة','select',{options:data.categories.map(c=>({value:c.key,label:c.name}))}),field('acquired_on','تاريخ الاقتناء','date'),field('cost','التكلفة'),field('salvage','قيمة الخردة','text',{required:false,value:'0'}),field('useful_months','العمر الإنتاجي بالأشهر','number',{min:1,max:600,value:36}),field('custodian_id','المسؤول عن الأصل','select',{required:false,options:[{value:'',label:'— بدون مسؤول —'},...data.custodians.map(u=>({value:u.id,label:u.name}))]}),field('location','الموقع','text',{required:false}),field('evidence','مرجع فاتورة الشراء وسند العمر الإنتاجي','textarea')],toPayload:v=>({name:v.name,category:v.category,acquired_on:v.acquired_on,cost:v.cost,salvage:v.salvage||'0',useful_months:Number(v.useful_months),...(v.custodian_id?{custodian_id:v.custodian_id}:{}),...(v.location?{location:v.location}:{}),evidence:v.evidence})};}
    if(action==='run_depreciation'){guard(data.permissions.includes('prepare'));return {title:'حساب إهلاك شهر',endpoint:'/assets/depreciation',idempotent:true,fields:[field('month','الشهر','month',{value:data.today.slice(0,7)})],toPayload:v=>v};}
    const a=data.assets.find(x=>x.id===id);guard(a&&a.actions.includes(action));
    return {title:`${labels[action]} — ${a.code}`,endpoint:`/assets/${id}/${action}`,fields:[...(action==='dispose_asset'?[field('disposed_on','تاريخ الاستبعاد','date',{value:data.today})]:[]),field('note','أساس القرار','textarea')],toPayload:v=>({...v,version:a.version})};
  }
};
