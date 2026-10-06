// دعم العملاء بعد البيع (الحزمة 4، P4-CRM-5): كل بلاغ له عميل وصفقة وساعة، ومسؤول يرد ويحل، وشخص ثانٍ في فريق الحساب يقرّ الحل.
// المهلة من بند العقد أو القيمة المعتمدة، وإلا تقول الشاشة «ما تحددت» — لا موعد مخترع. نص العميل يُعرض هنا كما قاله، ولا يدخل إشعارًا.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء مو متاح لك الحين. حدّث الصفحة وشوف وين وصل البلاغ.');};
const LABELS={respond_case:'تسجيل أول رد',resolve_case:'تسجيل الحل',confirm_resolution:'إقرار الحل',return_resolution:'إرجاع الحل للمعالجة',reassign_case:'نقل البلاغ'};
const options=map=>Object.entries(map).map(([value,label])=>({value,label}));
// اللحظة بتوقيت الرياض «2026-10-01 09:30»، والطابع الكامل في datetime.
const when=(e,iso)=>iso?`<time datetime="${e(iso)}">${e(new Date(Date.parse(iso)+3*3600000).toISOString().slice(0,16).replace('T',' '))}</time>`:'—';
const local=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,16);
const CLOCK_TONE={late:'is-late',missed:'is-late',running:'is-due',met:'',unset:''};

export const clientSupportUI={
  title:'دعم العملاء',
  description:'بلاغات العملاء وتصعيدات حساباتهم بعد البيع: كل بلاغ على عميله وصفقته، بمهلة رده إذا تحددت، ومسؤول يرد ويحل، وزميل ثاني في فريق الحساب يقرّ الحل.',
  load:api=>api('/client-support'),
  render(data,{e,button,ui=kit(e)}){
    const actions=c=>c.actions.length?`<div class="operation-actions">${c.actions.map(a=>button(a,c.id,LABELS[a])).join('')}</div>`:'';
    const clock=c=>c.clock.state==='unset'?`<span>${e(c.clock.text)}</span>`
      :`<span>${e(c.clock.text)} · الموعد ${when(e,c.clock.due_at)} (${e(c.clock.hours)} ساعة من ${e(c.clock.source_name)})</span>`;
    const body=c=>`<div class="vn-body" data-id="${e(c.id)}">
        ${actions(c)}
        <p>${ui.statusBadge(c.canonical)} <small class="subtle">${e(c.status_name)}</small></p>
        <dl class="detail-data">
          <div><dt>العميل</dt><dd><bdi>${e(c.client.code)}</bdi> · ${e(c.client.name)}</dd></div>
          <div><dt>الصفقة</dt><dd>${c.deal?`<bdi>${e(c.deal.ref)}</bdi> · ${e(c.deal.name)}`:'على الحساب كله'}</dd></div>
          <div><dt>وصل من العميل</dt><dd>${when(e,c.received_at)} · ${e(c.channel_name)}</dd></div>
          <div><dt>مهلة أول رد</dt><dd class="${e(CLOCK_TONE[c.clock.state]??'')}">${clock(c)}</dd></div>
          <div><dt>الضمان</dt><dd>${e(c.warranty.text)}${c.warranty.until?` · لين <time datetime="${e(c.warranty.until)}">${e(c.warranty.until)}</time>`:''}</dd></div>
          <div><dt>المسؤول</dt><dd>${e(c.handler_name)}</dd></div>
          ${c.contract?`<div><dt>العقد</dt><dd><bdi>${e(c.contract.number)}</bdi></dd></div>`:''}
        </dl>
        <section class="vn-block"><h3>كلام العميل</h3><p class="measure">${e(c.statement)}</p>${c.proposed_action?`<p class="subtle measure">الإجراء المقترح: ${e(c.proposed_action)}</p>`:''}</section>
        ${c.response_note?`<section class="vn-block"><h3>أول رد</h3><p class="measure">${e(c.response_note)}</p><p class="subtle">${when(e,c.responded_at)}</p></section>`:''}
        ${c.resolution?`<section class="vn-block"><h3>الحل · ${e(c.resolution_name)}</h3><p class="measure">${e(c.resolution)}</p><p class="subtle measure">الدليل: ${e(c.resolution_evidence)}</p></section>`:''}
        ${c.closure_note?`<section class="vn-block"><h3>إقرار الحل</h3><p class="measure">${e(c.closure_note)}</p><p class="subtle">${when(e,c.closed_at)}</p></section>`:''}
        <section class="vn-block"><h3>سجل البلاغ</h3><ul class="vn-list">${c.history.map(h=>`<li><strong>${e(h.action_name)} · ${e(h.actor_name)}</strong><span>${when(e,h.created_at)}</span>${h.note?`<small class="measure">${e(h.note)}</small>`:''}</li>`).join('')}</ul></section>
      </div>`;
    const caseCard=c=>ui.card({codeHtml:`<bdi>${e(c.number)}</bdi>`,title:`${c.kind_name}${c.risk_name?` — ${c.risk_name}`:''} · ${c.client.name}`,
      meta:`${c.status_name} · ${c.severity_name}${c.clock.state==='late'?' · فاتت مهلة الرد':''}`,open:data.awaiting_me.includes(c.id),body:body(c)});
    const waiting=data.cases.filter(c=>data.awaiting_me.includes(c.id)),open=data.cases.filter(c=>c.status!=='closed'&&!data.awaiting_me.includes(c.id)),closed=data.cases.filter(c=>c.status==='closed');
    const d=data.defaults;
    const notice=d.response.source==='unset'
      ?`<div class="vn-alert"><strong>ما تحددت مهلة رد للبلاغات</strong><p>القيمة «مهلة الرد الأول على بلاغ العميل بالساعات» (<bdi>crm.support_response_hours</bdi>) ما انعتمدت، فالبلاغ بلا موعد إلا إذا قاله بند العقد المسجّل على صفقته. يقررها ${e(d.owner)} ويعتمدها شخص ثاني.</p></div>`
      :`<p class="subtle">مهلة أول رد: ${e(d.response.hours)} ساعة من لحظة وصول البلاغ (${e(d.response.source_name)})، وبند العقد المسجّل على الصفقة يتقدّم عليها.</p>`;
    const warranty=d.warranty.source==='unset'
      ?`<p class="subtle">ما تحددت مدة ضمان (<bdi>crm.warranty_days</bdi>)، فما ينقال عن بلاغ إنه داخل الضمان إلا إذا قاله بند العقد.</p>`
      :`<p class="subtle">الضمان: ${e(d.warranty.days)} يوم من آخر قبول مخرج على الصفقة (${e(d.warranty.source_name)})، وبند العقد يتقدّم عليه.</p>`;
    const group=(title,list)=>list.length?`<section class="vn-group"><h2>${e(title)} <span data-num>${e(list.length)}</span></h2>${list.map(caseCard).join('')}</section>`:'';
    return `<section class="panel panel-body vn-head"><p>البلاغ يوصل من العميل؛ مسؤول الحساب يستلمه ويرد أول رد، ويسجّل الحل بدليله، وزميل ثاني في فريق الحساب يقرّه.</p>
        ${notice}${warranty}
        <div class="operation-actions">${data.can_open?button('open_case','','بلاغ جديد من عميل'):''}</div></section>
      ${group('بانتظار إجرائي',waiting)}
      <section class="vn-board"><div class="vn-tiles">${ui.tile(data.totals.open,'بلاغ مفتوح')}${ui.tile(data.totals.late,'فاتت مهلة رده',data.totals.late?'is-late':'')}${ui.tile(data.totals.awaiting_confirmation,'حل ينتظر إقراره',data.totals.awaiting_confirmation?'is-due':'')}${ui.tile(data.totals.closed,'بلاغ مقفل')}</div></section>
      ${group('بلاغات مفتوحة',open)}${group('بلاغات مقفلة',closed)}
      ${data.cases.length?'':ui.empty('ما فيه بلاغات للحين','أي ملاحظة أو شكوى توصل من عميل أنت في فريق حسابه، سجّلها من «بلاغ جديد من عميل» بلحظة وصولها.')}`;
  },
  form(action,id,data){
    if(action==='open_case'){guard(data.can_open);
      return {title:'بلاغ جديد من عميل',endpoint:'/client-support',idempotent:true,fields:[
        field('kind','نوع البلاغ','select',{options:options(data.kinds)}),
        field('client_id','العميل','select',{options:data.clients.map(c=>({value:c.id,label:`${c.code} · ${c.name}`}))}),
        field('case_id','الصفقة','select',{required:false,options:[{value:'',label:'على الحساب كله (للتصعيد بس)'},...data.deals.map(x=>({value:x.id,label:`${x.ref} · ${x.name}${x.after_sale?'':' — قبل الاتفاق'}`}))],hint:'الشكوى بعد البيع على صفقة متعاقد عليها لنفس العميل.'}),
        field('severity','الخطورة','select',{options:options(data.severities)}),
        field('risk','نوع الخطر (للتصعيد)','select',{required:false,options:[{value:'',label:'ما ينطبق'},...options(data.risks)]}),
        field('channel','وصل عن طريق','select',{options:options(data.channels)}),
        field('received_at','متى وصل من العميل','datetime-local',{value:local(),hint:'بتوقيت الرياض. المهلة تبدأ من هنا، مو من لحظة التسجيل.'}),
        field('statement','كلام العميل','textarea',{hint:'زي ما قاله العميل، ومتى، وعن أي مخرج. لا تعيد صياغته.'}),
        field('proposed_action','الإجراء المقترح','textarea',{required:false})],
        toPayload:v=>({client_id:v.client_id,kind:v.kind,severity:v.severity,channel:v.channel,received_at:v.received_at,statement:v.statement,
          ...(v.case_id?{case_id:v.case_id}:{}),...(v.kind==='escalation'&&v.risk?{risk:v.risk}:{}),...(v.proposed_action?{proposed_action:v.proposed_action}:{})})};}
    const c=data.cases.find(x=>x.id===id);guard(c&&c.actions.includes(action));
    const spec=(fields,toPayload)=>({title:`${LABELS[action]} — ${c.number}`,endpoint:`/client-support/${id}/${action}`,fields,toPayload:v=>({version:c.version,...toPayload(v)})});
    if(action==='respond_case')return spec([field('note','وش قلنا للعميل وكيف','textarea')],v=>({note:v.note}));
    if(action==='resolve_case')return spec([field('resolution_kind','نوع الحل','select',{options:options(data.resolutions),hint:c.warranty.state==='inside'?'البلاغ وصل داخل الضمان.':`«انصلح ضمن الضمان» ما يمشي هنا: ${c.warranty.text}.`}),
      field('resolution','وش انعمل','textarea'),field('evidence','دليل الحل ومكان حفظه','textarea')],v=>({resolution_kind:v.resolution_kind,resolution:v.resolution,evidence:v.evidence}));
    if(action==='confirm_resolution')return spec([field('note','وش اطلعت عليه قبل الإقرار','textarea')],v=>({note:v.note}));
    if(action==='return_resolution')return spec([field('note','ليش يرجع للمعالجة','textarea')],v=>({note:v.note}));
    const client=data.clients.find(x=>x.id===c.client.id);
    return spec([field('handler_id','المسؤول الجديد','select',{options:(client?.team??[]).filter(p=>p.id!==c.handler_id).map(p=>({value:p.id,label:p.name}))}),field('note','سبب النقل','textarea')],v=>({handler_id:v.handler_id,note:v.note}));
  }
};
