import { attachFiles, filesBlock, fileForm } from './files-ui.mjs';
// المصروفات والعهد: الموظف يطالب، مديره يقر الغرض، والمالية تعتمد وتوثق الصرف.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
// D-09: لصاحب المطالبة والعهدة زر سحب قبل أول قرار، فلا يكون مخرجه الوحيد أن يطلب رفض طلبه.
const labels={manager_approve:'إقرار المدير',finance_approve:'اعتماد المالية',reject_claim:'رفض',record_reimbursement:'توثيق التعويض',approve_custody:'اعتماد العهدة',reject_custody:'رفض العهدة',issue_custody:'توثيق صرف العهدة',close_custody:'إقفال العهدة',withdraw_claim:'سحب المطالبة',withdraw_custody:'سحب طلب العهدة'};
// ما ينتظر القارئ نوعان: قرارٌ يعتمد أو يرفض، وتوثيقُ صرفٍ حصل في البنك. السحب فعل صاحب الطلب على طلبه، لا قرار.
const DECIDES=new Set(['manager_approve','finance_approve','reject_claim','approve_custody','reject_custody']);
export const expensesUI={
  title:'المصروفات والعهد',description:'مطالبة بإيصال واحد ما يتكرر، يقرها المدير المباشر وبعدها تعتمدها المالية. العهدة تتسوّى بمطالبات معتمدة، ويرجع الباقي منها بالضبط.',
  load:async api=>{const data=await api('/expenses');return attachFiles(api,data,'expense_claim',data.claims.map(c=>c.id));},
  render(data,{e,button,money,ui}){
    // م0 «السور»: tile من العدّة المحقونة (ui من app.mjs) لا من نسخة محلية؛ HTML الناتجة مطابقة بالحرف (tests/ui-golden.test.mjs).
    const {tile,empty}=ui;
    // المبلغ رقمٌ معزول الاتجاه بأرقام جدولية؛ والعملة تُسمّى مرة: في التسمية وبعد أول مبلغ في السطر.
    const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
    const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
    const acts=(row,kind)=>row.actions.length?`<div class="operation-actions">${row.actions.map(a=>button(a,`${kind}:${row.id}`,labels[a])).join('')}</div>`:'';
    // دورك: سجلُّ غيرك عليه فعلٌ لك. القرار «ينتظر قرارك»، والصرف الذي حصل «ينتظر توثيقك».
    const turn=row=>!row.own&&row.actions.length?(row.actions.some(a=>DECIDES.has(a))?'ينتظر قرارك':'ينتظر توثيقك'):'';
    const state=(row,module)=>row.withdrawn?`<span><span class="badge cancelled">${e(row.status_name)}</span></span>`:`<span>${ui.statusBadge(row.status,{module})}</span>`;
    const claim=c=>{const mine=turn(c);
      return `<li class="${mine?'is-decision':c.withdrawn?'is-old':''}"><strong>${e(c.claimant_name)} · ${fig(c.amount_minor)} ريال</strong>${mine?`<span class="badge is-decision">${mine}</span>`:''}${state(c,'expense')}<span>${e(c.category_name)} · ${day(c.expense_date)}${c.custody_id?' · من عهدة':''} · إيصال <bdi dir="ltr">${e(c.receipt_reference)}</bdi></span><small class="measure">${e(c.description)}${c.decision_note?` — ${e(c.decision_note)}`:''}</small>${acts(c,'claim')}${filesBlock(data,c.id,{e,button},'claim:'+c.id)}</li>`;};
    const custody=c=>{const mine=turn(c);
      return `<li class="${mine?'is-decision':c.withdrawn?'is-old':''}"><strong>${e(c.holder_name)} · عهدة ${fig(c.amount_minor)} ريال</strong>${mine?`<span class="badge is-decision">${mine}</span>`:''}${state(c,'custody')}${c.status==='issued'?`<span>الباقي ${fig(c.open_minor)} · تسوّى ${fig(c.settled_minor)} · معلّق في مطالبات ${fig(c.pending_minor)}</span>`:''}<small class="measure">${e(c.purpose)}</small>${acts(c,'custody')}</li>`;};
    const waiting=[...data.claims.filter(c=>turn(c)).map(claim),...data.custodies.filter(c=>turn(c)).map(custody)];
    const claims=data.claims.filter(c=>!turn(c)).map(claim).join(''),custodies=data.custodies.filter(c=>!turn(c)).map(custody).join('');
    const block=(title,items,none)=>`<section class="vn-block"><div class="panel-head"><h2>${e(title)}</h2></div>${items?`<ul class="vn-list">${items}</ul>`:`<p class="subtle">${e(none)}</p>`}</section>`;
    return `<section class="panel panel-body vn-head"><div class="operation-actions">${button('submit_claim','','مطالبة مصروف')}${button('request_custody','','طلب عهدة')}</div><p>الإيصال ينسجّل برقمه، وصورته ترفعها من بطاقة المطالبة ما دامت تنتظر القرار.</p></section>
      <section class="vn-board"><div class="vn-tiles">${tile(data.totals.awaiting_me,'ينتظر قراري أو توثيقي',data.totals.awaiting_me?'is-decision':'')}${tile(num(data.totals.my_unreimbursed_minor),'معتمد لي وما تعوّض بالريال')}${tile(num(data.totals.open_custody_minor),'عهد مصروفة ما تسوّت بالريال')}${tile(data.claims.length,'مطالبة في نطاقي')}</div></section>
      ${waiting.length?`<section class="vn-block"><div class="panel-head"><h2>ينتظرك</h2></div><ul class="vn-list">${waiting.join('')}</ul></section>`:''}
      ${data.claims.length||data.custodies.length?`<div class="vn-grid">${block('المطالبات',claims,'ما فيه مطالبات غير اللي تنتظرك.')}${block('العهد',custodies,'ما فيه عهد غير اللي تنتظرك.')}</div>`
        :empty('ما فيه مطالبات ولا عهد للحين','ابدأ من «مطالبة مصروف» بإيصالها، أو اطلب عهدة لمصروف قادم؛ ويطلع هنا كل طلب ومساره.')}`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    if(action==='submit_claim')return {title:'مطالبة مصروف',endpoint:'/expenses/claims',idempotent:true,fields:[field('expense_date','تاريخ المصروف','date',{value:data.today}),field('category','التصنيف','select',{options:data.categories.map(c=>({value:c.key,label:c.name}))}),field('amount','المبلغ شامل الضريبة','text',{inputmode:'decimal',placeholder:'0.00'}),field('receipt_reference','رقم الإيصال أو الفاتورة'),field('description','الغرض','textarea'),field('custody_id','تسوية من عهدتي','select',{required:false,options:[{value:'',label:'— تعويض مباشر —'},...data.my_open_custodies.map(c=>({value:c.id,label:`عهدة ${(c.amount_minor/100).toFixed(2)} · الباقي ${(c.open_minor/100).toFixed(2)}`}))]}),field('project_id','المشروع (اختياري)','select',{required:false,options:[{value:'',label:'— بدون مشروع —'},...data.projects.map(p=>({value:p.id,label:p.name}))]})],toPayload:v=>({expense_date:v.expense_date,category:v.category,amount:v.amount,receipt_reference:v.receipt_reference,description:v.description,...(v.custody_id?{custody_id:v.custody_id}:{}),...(v.project_id?{project_id:v.project_id}:{})})};
    if(action==='request_custody')return {title:'طلب عهدة',endpoint:'/expenses/custodies',idempotent:true,fields:[field('amount','مبلغ العهدة','text',{inputmode:'decimal',placeholder:'0.00'}),field('purpose','الغرض والمدة','textarea')],toPayload:v=>v};
    if(action==='upload_file'){const claimId=String(id).split(':')[1],c=data.claims.find(x=>x.id===claimId);guard(c&&data.files?.[claimId]?.can_upload);return fileForm('expense_claim',claimId,`${c.category_name} ${c.expense_date}`);}
    const [kind,rowId]=String(id).split(':'),row=(kind==='claim'?data.claims:data.custodies).find(x=>x.id===rowId);guard(row&&row.actions.includes(action));
    const base=kind==='claim'?`/expenses/claims/${rowId}/${action}`:`/expenses/custodies/${rowId}/${action}`,withVersion=v=>({...v,version:row.version});
    if(action==='record_reimbursement')return {title:'توثيق تعويض المصروف',endpoint:base,fields:[field('reimbursed_on','تاريخ التحويل','date',{value:data.today}),field('reference','مرجع التحويل')],toPayload:withVersion};
    if(action==='issue_custody')return {title:'توثيق صرف العهدة',endpoint:base,fields:[field('issued_on','تاريخ الصرف','date',{value:data.today}),field('reference','مرجع الصرف')],toPayload:withVersion};
    if(action==='close_custody')return {title:`إقفال العهدة — الباقي ${(row.open_minor/100).toFixed(2)}`,endpoint:base,fields:[field('returned','المبلغ المرجّع','text',{value:(row.open_minor/100).toFixed(2)}),field('return_reference','مرجع رجوع المبلغ','text',{required:false}),field('note','ملاحظة الإقفال','textarea')],toPayload:v=>withVersion({returned:v.returned,...(v.return_reference?{return_reference:v.return_reference}:{}),note:v.note})};
    return {title:labels[action],endpoint:base,fields:[field('note','الأساس أو السبب','textarea')],toPayload:withVersion};
  }
};
