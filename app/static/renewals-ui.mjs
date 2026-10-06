// عقود قرب نهايتها وفرصة التجديد (الحزمة 4، P4-CRM-6) داخل «خط الفرص»: كل تجديد يبدأ قبل أن ينتهي العقد القديم ويحمل نطاقه وأسعاره.
// ملف مستقل يستورده pipeline-estimates-ui.mjs في ثلاثة مواضع، فيبقى تحرير شاشة الفرص نفسها أقل ما يمكن.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const date=(e,d)=>d?`<time datetime="${e(d)}">${e(d)}</time>`:'—';

// القسم: العقود السارية لعملائك قرب نهايتها، أولها ما دخل نافذة التذكير. لا يُرسم شيء حين لا عقد.
export function renewalsSection(data,{e,button,money,ui=kit(e)}){
  const r=data.renewals;
  if(!r||!r.contracts.length)return '';
  const due=r.contracts.filter(c=>c.in_window&&c.actions.length);
  const contractRow=c=>`<li class="${c.in_window&&c.actions.length?'is-decision':c.opportunity||c.successor?'is-ok':''}" data-id="${e(c.id)}">
    <strong><bdi>${e(c.number)}</bdi> · ${e(c.client_name)} · ينتهي ${date(e,c.end_date)}</strong>
    <span>${e(c.subject)}${c.auto_renew&&c.notice_deadline?` · يتجدد تلقائيًا، وآخر موعد للإشعار ${date(e,c.notice_deadline)}`:''}</span>
    <small>${c.opportunity?`فرصة التجديد: «${e(c.opportunity.name)}» عند ${e(c.opportunity.owner_name)}`:c.successor?`تجدد بالعقد <bdi>${e(c.successor.number)}</bdi>`
      :c.decision==='do_not_renew'?'انسجّل قرار «عدم التجديد» لهالدورة'
      :c.window?(c.in_window?'داخل نافذة التجديد':`نافذة التجديد تنفتح ${date(e,c.window.opens_on)}`):'نافذة التجديد ما تنحسب: مهل التنبيه ما انضبطت في «سجل العقود»'}
      · ينتقل للفرصة: ${c.basis.lines.length?`${e(c.basis.lines.length)} بند بأسعارها، صافي ${e(money(c.basis.net_minor))}`:c.basis.net_minor!==null?`قيمة العقد ${e(money(c.basis.net_minor))}`:'موضوع العقد بلا قيمة مسجلة'}</small>
    ${c.actions.length?`<div class="operation-actions">${c.actions.map(a=>button(a,c.id,'فتح فرصة التجديد')).join('')}</div>`:''}</li>`;
  return `<section class="panel panel-body"><h2>عقود قرب نهايتها <span data-num>${e(r.contracts.length)}</span></h2>
    ${r.alerts_configured?'':'<p class="subtle">مهل التنبيه ما انضبطت في «سجل العقود»، فما يوصل تذكير تجديد لأحد. العقود هنا بنهايتها.</p>'}
    ${due.length?`<div class="operation-actions">${button('open_renewal','',`فرصة تجديد (${due.length} عقد في نافذته)`)}</div>`:''}
    <ul class="vn-list">${r.contracts.map(contractRow).join('')}</ul></section>`;
}

// ما نُسخ من العقد السابق على فرصة التجديد: رقمه ونهايته ونطاقه وبنوده بأسعارها.
export function renewalBasisHtml(o,{e,money,ui=kit(e)}){
  const b=o.renewal;
  if(!b)return '';
  return `<section class="vn-block"><h3>تجديد <bdi>${e(b.contract.number)}</bdi> · ينتهي ${date(e,b.contract.end_date)}</h3><p class="measure">${e(b.scope)}</p>
    ${ui.table({head:['البند','الكمية','سعر الوحدة','الصافي','الإجمالي'],rows:b.lines.map(l=>`<tr><td>${e(l.description)}</td><td data-num>${e(l.quantity)}</td><td>${e(money(l.unit_price_minor))}</td><td>${e(money(l.net_minor))}</td><td>${e(money(l.total_minor))}</td></tr>`),
      empty:{title:'العقد السابق بلا بنود مسعّرة',body:b.net_minor!==null?`قيمته المسجلة ${money(b.net_minor)}.`:'ما انسجلت له قيمة.'}})}</section>`;
}

// نموذج فتح فرصة التجديد: من زر العقد نفسه، أو من زر القسم باختيار العقد.
export function renewalForm(data,id){
  const list=(data.renewals?.contracts??[]).filter(c=>c.actions.includes('open_renewal')),chosen=id?list.find(c=>c.id===id):null;
  guard(id?chosen:list.length);guard(data.stages.length);
  return {title:chosen?`فرصة تجديد — ${chosen.number}`:'فرصة تجديد من عقد',idempotent:true,
    ...(chosen?{endpoint:`/pipeline/contracts/${chosen.id}/open_renewal`}:{dynamicEndpoint:v=>`/pipeline/contracts/${v.contract_id}/open_renewal`}),
    fields:[...(chosen?[]:[field('contract_id','العقد','select',{options:list.map(c=>({value:c.id,label:`${c.number} · ${c.client_name} · ينتهي ${c.end_date}`}))})]),
      field('stage_code','المرحلة','select',{options:data.stages.map(s=>({value:s.code,label:s.name}))}),
      field('expected_close_on','تاريخ الإغلاق المتوقع','date',{required:false,value:chosen?.end_date??'',hint:'إذا تركته فاضي يصير يوم نهاية العقد السابق.'}),
      field('service_family','نوع الخدمة','select',{required:false,options:[{value:'',label:'من الفرصة السابقة'},...data.families.map(f=>({value:f.key,label:f.name}))]}),
      field('name','اسم الفرصة','text',{required:false,hint:'إذا تركته فاضي: «تجديد» ورقم العقد وموضوعه.'})],
    toPayload:v=>({stage_code:v.stage_code,...(v.expected_close_on?{expected_close_on:v.expected_close_on}:{}),...(v.service_family?{service_family:v.service_family}:{}),...(v.name?{name:v.name}:{})})};
}
