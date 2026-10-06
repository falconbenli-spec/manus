// مركز التقارير: تقرير حي من سجلات المنصة بتعريفه وفترته، وتصديره Excel وCSV وكمستند، ولقطة يعتمدها شخص ثاني.
// الترتيب: اللقطات اللي تنتظر اعتمادك أول الشاشة، ثم التقارير بمجموعاتها، ثم لقطاتك المحفوظة وجدولاتك. ورقم كل عنوان طول قائمته.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const query=p=>`from=${encodeURIComponent(p.from)}&to=${encodeURIComponent(p.to)}`;
const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/;
const RIYADH=new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'});
// التاريخ <time> بقيمته؛ والختم الكامل بتوقيت الرياض (كان يُطبع ختم UTC كما هو).
const when=(e,value)=>{
  const text=String(value??'');
  if(ISO_DAY.test(text))return `<time datetime="${e(text)}">${e(text)}</time>`;
  const time=Date.parse(text);
  return Number.isNaN(time)?e(text||'—'):`<time datetime="${e(new Date(time).toISOString())}">${e(RIYADH.format(new Date(time)))}</time>`;
};
// اسمٌ مسموع للزر المتكرر في كل بطاقة يحمل تقريره، ويبدأ بنصه الظاهر. النص الظاهر نفسه لا يتغيّر.
const named=(e,html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
function resultView(r,e){
  const ui=kit(e);
  const fmt=(c,row)=>row[c.key]===null||row[c.key]===undefined||row[c.key]===''?'—':c.type==='money'&&typeof row[c.key]==='number'?row[c.key].toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):e(row[c.key]);
  const base=r.snapshot?`/api/reports/snapshots/${e(r.snapshot.id)}`:`/api/reports/${e(r.key)}`,qs=r.snapshot?'':'?'+query(r.params);
  // الإجمالي باسم عموده لا بمفتاحه البرمجي، ومصدر التقرير (أسماء جداول القاعدة) لا يُطبع في سطر قراءة.
  const label=k=>r.columns.find(c=>c.key===k)?.label??k;
  return `<p class="subtle measure">${e(r.definition)}</p><p class="subtle">الفترة من ${when(e,r.params.from)} لين ${when(e,r.params.to)} · البيانات حتى ${when(e,r.data_until)} · انطلع ${when(e,r.generated_at)} · ${r.live?'تقرير حي، أرقامه ممكن تتغير':`لقطة ${r.snapshot?.status==='approved'?'معتمدة':'ما اعتُمدت للحين'} · بصمتها <bdi dir="ltr">${e((r.snapshot?.digest||'').slice(0,12))}</bdi>`}</p>
    ${ui.table({head:r.columns.map(c=>c.label),rows:r.rows.map(row=>`<tr>${r.columns.map(c=>`<td>${fmt(c,row)}</td>`).join('')}</tr>`),empty:{title:'ما فيه بيانات في هالفترة',body:'وغياب البيانات مو صفر — جرّب فترة ثانية.'}})}
    ${Object.keys(r.totals).length?`<p><strong>الإجماليات:</strong> ${Object.entries(r.totals).map(([k,val])=>`${e(label(k))} = <span class="ltr">${e(typeof val==='number'?val.toLocaleString('en-US',{minimumFractionDigits:2}):val)}</span>`).join(' · ')}</p>`:''}
    ${r.notes.length?`<ul class="vn-list">${r.notes.map(n=>`<li><small>${e(n)}</small></li>`).join('')}</ul>`:''}
    <div class="form-actions"><a class="btn outline" href="${base}/export.xlsx${qs}" download>تنزيل <bdi dir="ltr">Excel</bdi></a><a class="btn outline" href="${base}/export.csv${qs}" download>تنزيل <bdi dir="ltr">CSV</bdi></a><a class="btn outline" href="${base}/print${qs}" target="_blank" rel="noopener">نسخة للطباعة / <bdi dir="ltr">PDF</bdi> (تنفتح في تبويب جديد)</a><button class="btn dark" type="button" data-action="close">إغلاق</button></div>`;
}
export const reportsUI={
  title:'مركز التقارير',description:'تقارير من سجلات المنصة بتعريفها وفترتها ووقت استخراجها. تشوف اللي تسمح به صلاحيتك بس، حتى في اللقطات المحفوظة.',
  load:api=>api('/reports'),
  render(data,{e,button,ui:given}){
    const ui=typeof given?.card==='function'?given:kit(e);
    const groups=[...new Set(data.reports.map(r=>r.group))];
    // بطاقة التقرير من العدّة: رمزه معزول، واسمه وتعريفه، وأفعاله الثلاثة في صفها.
    const reportCard=r=>ui.card({codeHtml:`<bdi dir="ltr">${e(r.key)}</bdi>`,title:r.title,meta:r.definition,
      body:`<div class="vn-body"><div class="operation-actions">${named(e,button('run_report',r.key,'عرض التقرير'),`عرض التقرير: ${r.title}`)}${named(e,button('save_snapshot',r.key,'حفظ لقطة للاعتماد'),`حفظ لقطة للاعتماد: ${r.title}`)}${named(e,button('schedule_report',r.key,'جدولة لقطة دورية'),`جدولة لقطة دورية: ${r.title}`)}</div></div>`});
    const cards=groups.map(g=>{const list=data.reports.filter(r=>r.group===g);return `<section class="vn-group"><h2>${e(g)} <span>${list.length}</span></h2>${list.map(reportCard).join('')}</section>`;}).join('');
    // اللقطة: فترتها وحالها، ومن جهّزها ما دامت تنتظر شخصًا ثانيًا (يعتمدها غيره)؛ والمعتمدة تقول متى اعتُمدت بلا سيرة.
    const actionNames={approve_snapshot:'اعتماد',discard_snapshot:'حذف المسودة'};
    const snapshotRow=s=>ui.row({title:s.title,tone:s.actions.includes('approve_snapshot')?'is-decision':s.status==='approved'?'':'is-pending',
      html:`<span><bdi dir="ltr">${e(s.report_key)}</bdi> · من ${when(e,s.params.from)} لين ${when(e,s.params.to)} · ${s.status==='approved'?`معتمدة${s.approved_at?` ${when(e,s.approved_at)}`:''}`:`جهّزها ${e(s.created_by_name)}، ويعتمدها غيره`}</span>`
        +`<div class="operation-actions">${named(e,button('open_snapshot',s.id,'فتح اللقطة'),`فتح اللقطة: ${s.title}`)}${s.actions.map(a=>named(e,button(a,s.id,actionNames[a]),`${actionNames[a]}: ${s.title}`)).join('')}</div>`});
    const mine=data.snapshots.filter(s=>s.actions.includes('approve_snapshot')),saved=data.snapshots.filter(s=>!mine.includes(s));
    const scheduleRow=s=>ui.row({title:s.title,tone:s.active?'':'is-old',
      html:`<span><bdi dir="ltr">${e(s.report_key)}</bdi> · ${e(s.cadence_name)} · ${s.active?`التشغيل الجاي ${when(e,s.next_run)}`:`موقفة: ${e(s.stopped_reason)}`}${s.last_run?` · آخر تشغيل ${when(e,s.last_run)}`:''}</span>`
        +`${s.actions.length?`<div class="operation-actions">${named(e,button('stop_schedule',s.id,'إيقاف الجدولة'),`إيقاف الجدولة: ${s.title}`)}</div>`:''}`});
    return `<section class="panel panel-body vn-head"><p class="measure">${e(data.not_built)}</p></section>`
      +(mine.length?`<section class="vn-group"><h2>لقطات تنتظر اعتمادك <span>${mine.length}</span></h2><section class="vn-block"><ul class="vn-list">${mine.map(snapshotRow).join('')}</ul></section></section>`:'')
      +(cards||`<section class="panel">${ui.empty('ما فيه تقرير تقدر تفتحه بصلاحيتك','التقارير تطلع هنا بحسب صلاحية حسابك.')}</section>`)
      +`<section class="vn-group"><h2>اللقطات المحفوظة <span>${saved.length}</span></h2><section class="vn-block">${saved.length?`<ul class="vn-list">${saved.map(snapshotRow).join('')}</ul>`:ui.empty('ما فيه لقطات محفوظة','اللقطة تحفظ أرقام التقرير كما هي عشان تنعتمد وتنعاد. تحفظها من «حفظ لقطة للاعتماد» عند أي تقرير.')}</section></section>`
      +`<section class="vn-group"><h2>جدولاتي <span>${data.schedules.length}</span></h2><section class="vn-block">${data.schedules.length?`<ul class="vn-list">${data.schedules.map(scheduleRow).join('')}</ul>`:ui.empty('ما عندك جدولة','الجدولة تسوي لقطة مسودة للفترة اللي خلصت باسمك وبصلاحيتك وقت التشغيل، وتنتظر اعتماد شخص ثاني. ما ينرسل شي برّا المنصة.')}</section></section>`;
  },
  form(action,id,data){
    const year=data.today.slice(0,4),range=[field('from','من','date',{value:`${year}-01-01`}),field('to','لين','date',{value:data.today})];
    if(action==='run_report'){const r=data.reports.find(x=>x.key===id);if(!r)throw Error('التقرير غير متاح لك الحين.');return {title:`${r.key} — ${r.title}`,endpoint:`/reports/${id}/run`,fields:range,toPayload:v=>v,after:(saved,e)=>({title:`${saved.key} — ${saved.title}`,html:resultView(saved,e)})};}
    if(action==='save_snapshot')return {title:'حفظ لقطة للاعتماد',endpoint:`/reports/${id}/snapshots`,idempotent:true,fields:range,toPayload:v=>v};
    if(action==='schedule_report')return {title:`جدولة — ${id}`,endpoint:'/reports/schedules',idempotent:true,fields:[field('cadence','التكرار','select',{options:data.cadences.map(c=>({value:c.key,label:c.name}))})],toPayload:v=>({report_key:id,cadence:v.cadence})};
    if(action==='stop_schedule')return {title:'إيقاف الجدولة',endpoint:`/reports/schedules/${id}/stop`,fields:[field('reason','السبب')],toPayload:v=>v};
    if(action==='open_snapshot')return {title:'فتح اللقطة',endpoint:`/reports/snapshots/${id}/open`,fields:[],toPayload:()=>({}),after:(saved,e)=>({title:`${saved.key} — ${saved.title}`,html:resultView(saved,e)})};
    if(action==='approve_snapshot')return {title:'اعتماد اللقطة',endpoint:`/reports/snapshots/${id}/approve_snapshot`,fields:[field('note','وش اللي راجعته؟','textarea')],toPayload:v=>v};
    if(action==='discard_snapshot')return {title:'حذف مسودة اللقطة',endpoint:`/reports/snapshots/${id}/discard_snapshot`,fields:[],toPayload:()=>({})};
    throw Error('الإجراء غير متاح لك الحين.');
  }
};
