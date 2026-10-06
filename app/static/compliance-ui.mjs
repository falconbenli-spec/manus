// تقويم الالتزامات النظامية والدورية: تذكير للمالك قبل الموعد، ودليل تنفيذ يتحقق منه شخص آخر.
import { dual } from './dates.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const labels={complete_obligation:'توثيق التنفيذ',verify_obligation:'تحققت من الدليل',deactivate_obligation:'إيقاف',activate_obligation:'تفعيل'};
const months=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
export const complianceUI={
  title:'تقويم الالتزامات',description:'التزامات نظامية ودورية بمالك وموعد وسند، ودليل تنفيذ لكل فترة يتحقق منه شخص ثاني. المنصة تذكّر، والمعاملة عند الجهة يسويها صاحبها.',
  load:api=>api('/compliance'),
  // من العدّة (ui.tile وui.row) لا نسختان محليتان: HTML البلاطة والصف مطابقة لما كانت تكتبه النسختان بالحرف.
  render(data,{e,button,ui}){
    const count=state=>data.obligations.filter(o=>o.active&&o.state===state).length;
    // الدليل يُقرأ بمرجعه؛ ومن نفّذ يُسمّى ما دام التحقق ينتظر شخصًا ثانيًا (لا يتحقق المنفّذ من نفسه)، وبعد التحقق يكفي أنه تُحقّق منه.
    const evidence=o=>!o.completion?'':o.completion.verified_by_name
      ?` — الدليل: ${o.completion.evidence_reference} (تُحقّق منه)`
      :` — الدليل: ${o.completion.evidence_reference} (نفّذه ${o.completion.completed_by_name}، والتحقق من غيره)`;
    const obligation=o=>ui.row({title:`${o.title} · ${o.authority}`,tone:o.state==='overdue'?'is-late':!o.active||o.state==='verified'?'is-old':'',
      meta:`${o.cadence_name} · فترة ${o.period} · الموعد ${dual(o.due_date)} · ${o.state_name}${o.active?'':' · موقوف'} · المالك ${o.owner_name}`,
      html:`<small>${e(o.basis)}${e(evidence(o))}</small>${o.actions.length?`<div class="operation-actions">${o.actions.map(a=>button(a,o.id,labels[a])).join('')}</div>`:''}`});
    const list=data.obligations.slice().sort((a,b)=>a.due_date.localeCompare(b.due_date)).map(obligation).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)} التذكير يبدأ قبل الموعد بـ${e(data.remind_days)} أيام ويطلع في «عملي».</p>${data.can_manage?`<div class="operation-actions">${button('create_obligation','','التزام جديد')}</div>`:''}</section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(count('overdue'),'متأخر',count('overdue')?'is-late':'')}${ui.tile(count('due_soon'),'مستحق قريبًا',count('due_soon')?'is-due':'')}${ui.tile(count('completed'),'نُفذ وينتظر التحقق')}${ui.tile(count('verified'),'نُفذ وتُحقق منه',count('verified')?'is-ok':'')}</div>
      <section class="vn-block">${list?`<ul class="vn-list">${list}</ul>`:`<p class="subtle">${data.can_manage?'ما فيه التزامات مسجّلة. ابدأ باللي تعرف موعده وسنده.':'ما فيه التزامات مسندة لك.'}</p>`}</section></section>`;
  },
  form(action,id,data){
    if(action==='create_obligation'){guard(data.can_manage);return {title:'التزام جديد',endpoint:'/compliance',idempotent:true,fields:[field('title','الالتزام','text',{hint:data.suggested.length?`أمثلة شائعة: ${data.suggested.join('، ')}.`:''}),field('authority','الجهة'),field('cadence','التكرار','select',{options:Object.entries(data.cadences).map(([value,label])=>({value,label}))}),field('due_day','يوم الاستحقاق من الشهر (1–28)','number',{min:1,max:28}),field('due_month','شهر الاستحقاق (للسنوي، أو أول شهر استحقاق للربع سنوي)','select',{required:false,options:[{value:'',label:'— للشهري —'},...months.map((m,i)=>({value:String(i+1),label:m}))]}),field('owner_id','المالك','select',{options:data.people.map(p=>({value:p.id,label:p.name}))}),field('basis','سند الموعد ومن أكده','textarea',{hint:'المواعيد النظامية ما تعرفها المنصة: اكتب مصدر الموعد (موقع الجهة، خطاب، مختص) وتاريخ تأكيده.'})],
      toPayload:v=>({title:v.title,authority:v.authority,cadence:v.cadence,due_day:Number(v.due_day),due_month:v.cadence==='monthly'||!v.due_month?null:Number(v.due_month),owner_id:v.owner_id,basis:v.basis})};}
    const o=data.obligations.find(x=>x.id===id);guard(o&&o.actions.includes(action));
    if(action==='complete_obligation')return {title:`توثيق تنفيذ — ${o.title} · ${o.period}`,endpoint:`/compliance/${id}/complete_obligation`,fields:[field('evidence_reference','دليل التنفيذ','textarea',{hint:'رقم المعاملة أو الإيصال ومكان حفظه. لا تكتب كلمات مرور ولا بيانات دخول.'})],toPayload:v=>v};
    if(action==='verify_obligation')return {title:`تحقق — ${o.title} · ${o.period}`,endpoint:`/compliance/${id}/verify_obligation`,fields:[field('note','ما الذي اطلعت عليه','textarea')],toPayload:v=>v};
    return {title:`${labels[action]} — ${o.title}`,endpoint:`/compliance/${id}/${action}`,fields:[field('note','السبب','textarea')],toPayload:v=>({version:o.version,note:v.note})};
  }
};
