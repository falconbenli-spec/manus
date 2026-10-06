// الحملات وتقويم المحتوى وحارس النطاق — لفريق الحساب فقط.
// البلاطة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const pct=bp=>bp===null||bp===undefined?'—':`${(bp/100).toFixed(0)}%`;
const lines=text=>String(text??'').split('\n').map(l=>l.trim()).filter(Boolean);
// علامة الاكتمال: الرمز للعين وحدها، والكلمة للقارئ الآلي.
const mark=(on,yes,no)=>`<span aria-hidden="true">${on?'✓':'○'}</span><span class="sr-only">${on?yes:no}: </span>`;

const campaignLabels={edit_campaign:'تعديل الخطة',check_item:'إكمال بند جاهزية',request_launch:'طلب اعتماد الإطلاق',approve_launch:'اعتماد الإطلاق',return_launch:'إعادة للتخطيط',record_result:'تسجيل نتيجة',record_spend:'تسجيل صرف',correct_entry:'تصحيح قيد',pause_campaign:'إيقاف مؤقت',resume_campaign:'استئناف',complete_campaign:'إقفال الحملة',cancel_campaign:'إلغاء الحملة'};
const campaignRoutes={edit_campaign:'edit',check_item:'check',request_launch:'request_launch',approve_launch:'approve_launch',return_launch:'return_launch',record_result:'result',record_spend:'spend',correct_entry:'correct',pause_campaign:'pause',resume_campaign:'resume',complete_campaign:'complete',cancel_campaign:'cancel'};
const pacing={no_budget:'بدون ميزانية إعلامية',on_track:'الصرف متسق مع الزمن',ahead:'الصرف يسبق الزمن',behind:'الصرف متأخر عن الزمن',over_budget:'تجاوز الميزانية'};
function campaignFields(data,c){
  return [field('name','اسم الحملة','text',{value:c?.name}),field('objective','الهدف','textarea',{value:c?.objective}),field('channels','القنوات','checks',{value:c?.channels??['instagram'],options:data.channels.map(x=>({value:x.key,label:x.name}))}),
    field('targets','المؤشرات المستهدفة','rows',{value:c?.targets?.map(t=>({metric:t.metric,target:t.target,unit:t.unit})),columns:[{name:'metric',label:'المؤشر'},{name:'target',label:'المستهدف',type:'number',min:1},{name:'unit',label:'الوحدة'}],maxRows:12,hint:'تثبت المؤشرات بعد اعتماد الإطلاق.'}),
    field('media_budget','الميزانية الإعلامية (0 إذا ما فيه)','text',{value:c?(c.media_budget_minor/100).toFixed(2):'0'}),field('budget_reference','مرجع اعتماد الميزانية من العميل','text',{required:false,value:c?.budget_reference}),field('start_date','البداية','date',{value:c?.start_date}),field('end_date','النهاية','date',{value:c?.end_date})];
}
// للحملة خطة صرف معتمدة: الصرف من سجل الصرف الإعلامي وحده (الترحيل 192)، فيُقال من أين الرقم وأين يُسجَّل، وما كُتب هنا قبل الخطة يُسمّى.
const spendSource=(c,{e,money})=>c.spend_ledger?`<p class="subtle measure">الصرف من سجل الصرف الإعلامي على خطة الصرف المعتمدة (النسخة ${e(c.spend_ledger.plan_revision)})، ويتسجل ويتصحح من <a href="#media-spend">شاشة الصرف الإعلامي</a>.${c.spend_ledger.legacy_spend_minor?` قيود «صرف» انكتبت هنا قبل الخطة بمجموع ${e(money(c.spend_ledger.legacy_spend_minor))} تبقى تاريخ في القيود وما تدخل الصرف.`:''}</p>`:'';
const campaignPayload=v=>({name:v.name,objective:v.objective,channels:v.channels,targets:v.targets,media_budget:String(v.media_budget).trim(),budget_reference:v.budget_reference||'',start_date:v.start_date,end_date:v.end_date});
export const campaignsUI={
  title:'الحملات',description:'خطة ومؤشرات وجاهزية إطلاق يعتمدها شخص آخر، ثم نتائج وصرف بمصدر كل رقم، وإقفال بما تعلمناه.',
  load:api=>api('/campaigns'),
  render(data,{e,button,money,ui=kit(e)}){
    const card=c=>`<details class="vn-card"${c.status==='live'?' open':''}><summary><span class="vn-code">${e(c.client_name)}</span><span class="vn-name"><strong>${e(c.name)}</strong><small>${e(c.start_date)} لين ${e(c.end_date)} · ${e(c.owner_name)}</small></span><span class="vn-flags">${['ahead','over_budget'].includes(c.pacing)?`<span class="vn-flag is-block">${e(pacing[c.pacing])}</span>`:''}<span class="badge">${e(c.status_name)}</span></span></summary>
      <div class="vn-body"><p class="measure">${e(c.objective)}</p>${c.actions.length?`<div class="operation-actions">${c.actions.map(a=>button(a,c.id,campaignLabels[a])).join('')}</div>`:''}<div class="vn-tiles">${ui.tile(pct(c.time_elapsed_bp),'مضى من المدة')}${ui.tile(c.spend_bp===null?'—':pct(c.spend_bp),`انصرف ${money(c.spent_minor)} من ${money(c.media_budget_minor)}`,['ahead','over_budget'].includes(c.pacing)?'is-late':'')}${ui.tile(`${c.checklist_done}/${c.checklist.length}`,'جاهزية الإطلاق')}${ui.tile(c.content_count,'بند محتوى')}</div>${spendSource(c,{e,money})}
      <section class="vn-block"><h3>المؤشرات</h3><ul class="vn-list">${c.targets.map(t=>`<li><strong>${e(t.metric)} · ${e(t.actual.toLocaleString('en-US'))} من ${e(t.target.toLocaleString('en-US'))} ${e(t.unit)}</strong><span>${e(pct(t.attainment_bp))} من المستهدف</span></li>`).join('')}</ul></section>
      ${c.status==='planning'||c.status==='launch_review'?`<section class="vn-block"><h3>جاهزية الإطلاق</h3><ul class="vn-list">${c.checklist.map(i=>`<li class="${i.done?'is-old':'is-pending'}"><strong>${mark(i.done,'مكتمل','ناقص')}${e(i.label)}</strong>${i.done?`<small>${e(i.evidence)}</small>`:''}</li>`).join('')}</ul>${c.launch_note?`<p class="subtle">${e(c.launch_note)}</p>`:''}</section>`:''}
      ${c.entries.length?`<section class="vn-block"><h3>القيود</h3><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>البند</th><th>القيمة</th><th>المصدر</th></tr></thead><tbody>${c.entries.map(x=>`<tr class="${x.superseded?'is-old':''}"><td>${e(x.entry_date)}</td><td>${e(x.kind==='spend'?`صرف · ${x.channel}`:x.metric)}${x.corrects_id?' · تصحيح':''}${x.superseded?' · مصحَّح':''}</td><td>${e(x.kind==='spend'?money(x.value):x.value.toLocaleString('en-US'))}</td><td>${e(x.source)}</td></tr>`).join('')}</tbody></table></div></section>`:''}
      ${c.learning?`<section class="vn-block"><h3>اللي تعلمناه</h3><p class="measure">${e(c.learning)}</p></section>`:''}</div></details>`;
    const groups=[['live','نشطة'],['launch_review','تنتظر اعتماد الإطلاق'],['planning','تخطيط'],['paused','متوقفة'],['completed','مقفلة'],['cancelled','ملغاة']].map(([s,t])=>{const rows=data.campaigns.filter(c=>c.status===s);return rows.length?`<section class="vn-group"><h2>${e(t)} <span>${rows.length}</span></h2>${rows.map(card).join('')}</section>`:'';}).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${data.clients.length?`<div class="operation-actions">${button('create_campaign','','حملة جديدة')}</div>`:'<p class="subtle">ما أنت ضمن فريق أي حساب عميل.</p>'}</section>${groups||ui.empty('ما فيه حملات في حساباتك للحين','الحملة تبدأ من «حملة جديدة»: خطة ومؤشرات وجاهزية إطلاق يعتمدها شخص ثاني.')}`;
  },
  form(action,id,data){
    if(action==='create_campaign'){guard(data.clients.length);return {title:'حملة جديدة',endpoint:'/campaigns',idempotent:true,fields:[field('client_id','العميل','select',{options:data.clients.map(c=>({value:c.id,label:c.name}))}),...campaignFields(data,null)],toPayload:v=>({client_id:v.client_id,...campaignPayload(v)})};}
    const c=data.campaigns.find(x=>x.id===id);guard(c&&c.actions.includes(action));
    const spec=(fields,toPayload=v=>v)=>({title:`${campaignLabels[action]} — ${c.name}`,endpoint:`/campaigns/${id}/${campaignRoutes[action]}`,fields,toPayload:v=>({version:c.version,...toPayload(v)})});
    if(action==='edit_campaign')return spec(campaignFields(data,c),campaignPayload);
    if(action==='check_item')return spec([field('key','البند','select',{options:c.checklist.filter(i=>!i.done).map(i=>({value:i.key,label:i.label}))}),field('evidence','دليل اكتماله','textarea')]);
    if(action==='request_launch')return spec([],()=>({}));
    if(action==='record_result')return spec([field('entry_date','التاريخ','date',{value:data.today}),field('metric','المؤشر','select',{options:c.targets.map(t=>({value:t.metric,label:t.metric}))}),field('value','القيمة','number',{min:0,step:1}),field('source','مصدر الرقم','text',{hint:'مثال: لوحة مدير الإعلانات بتاريخ اليوم.'})],v=>({entry_date:v.entry_date,metric:v.metric,value:Number(v.value),source:v.source}));
    if(action==='record_spend')return spec([field('entry_date','التاريخ','date',{value:data.today}),field('channel','القناة','select',{options:c.channels.map(k=>({value:k,label:data.channels.find(x=>x.key===k)?.name??k}))}),field('amount','المبلغ'),field('source','مصدر الرقم')],v=>({entry_date:v.entry_date,channel:v.channel,amount:String(v.amount).trim(),source:v.source}));
    if(action==='correct_entry')return spec([field('entry_id','القيد','select',{options:c.entries.filter(x=>x.correctable).map(x=>({value:x.id,label:`${x.entry_date} · ${x.kind==='spend'?'صرف '+x.channel+' '+(x.value/100).toFixed(2):x.metric+' '+x.value}`}))}),field('value','القيمة الصحيحة','text',{hint:'للصرف مبلغ بالريال، وللنتيجة عدد صحيح. والقيد السابق يبقى ظاهر كمصحَّح.'}),field('source','سبب التصحيح ومصدر الرقم الصحيح','textarea')],v=>{const entry=c.entries.find(x=>x.id===v.entry_id);return {entry_id:v.entry_id,value:entry?.kind==='spend'?String(v.value).trim():Number(v.value),source:v.source};});
    if(action==='complete_campaign')return spec([field('learning','وش نجح ووش ما نجح ووش نغيّر','textarea',{maxLength:4000})],v=>({learning:v.learning}));
    return spec([field('note',action==='approve_launch'?'أساس اعتماد الإطلاق':'السبب','textarea')],v=>({note:v.note}));
  }
};

const contentLabels={edit_item:'تعديل البند',start_drafting:'بدء الإعداد',submit_internal:'إرسال للمراجعة الداخلية',pass_internal:'اجتاز المراجعة',return_item:'إعادة للتعديل',record_client_approval:'توثيق موافقة العميل',client_changes:'تعديلات العميل',schedule_item:'جدولة',publish_item:'توثيق النشر',cancel_item:'إلغاء البند'};
const contentRoutes={edit_item:'edit',start_drafting:'start',submit_internal:'submit',pass_internal:'pass',return_item:'return',record_client_approval:'client_approve',client_changes:'client_changes',schedule_item:'schedule',publish_item:'publish',cancel_item:'cancel'};
function contentFields(data,client,item){
  const opt=(list,empty)=>[{value:'',label:empty},...list.map(x=>({value:x.id,label:x.name}))];
  return [field('title','العنوان','text',{value:item?.title}),field('channel','القناة','select',{value:item?.channel,options:data.channels.filter(c=>c.key!=='outdoor').map(c=>({value:c.key,label:c.name}))}),field('format','الشكل','select',{value:item?.format,options:data.formats.map(f=>({value:f.key,label:f.name}))}),field('planned_date','تاريخ النشر المخطط','date',{value:item?.planned_date??data.today}),field('planned_time','الوقت','time',{required:false,value:item?.planned_time}),
    field('brief','الفكرة والرسالة','textarea',{required:false,value:item?.brief}),field('brand_id','العلامة','select',{required:false,value:item?.brand_id??'',options:opt(client.brands,'بدون تحديد')}),field('campaign_id','الحملة','select',{required:false,value:item?.campaign_id??'',options:opt(client.campaigns,'خارج الحملات')}),
    field('retainer','ينخصم من اشتراك','select',{required:false,value:item?.retainer_id?`${item.retainer_id}|${item.deliverable_type}`:'',options:[{value:'',label:'ما ينخصم من اشتراك'},...client.retainers.flatMap(r=>r.types.map(t=>({value:`${r.id}|${t}`,label:`${r.name} — ${t}`})))]})];
}
const contentPayload=v=>{const [retainer='',type='']=String(v.retainer||'').split('|');return {campaign_id:v.campaign_id||'',brand_id:v.brand_id||'',channel:v.channel,format:v.format,title:v.title,brief:v.brief||'',planned_date:v.planned_date,planned_time:v.planned_time||'',retainer_id:retainer,deliverable_type:type};};
export const contentUI={
  title:'تقويم المحتوى',description:'من الفكرة إلى النشر: مراجعة داخلية من شخص آخر، موافقة عميل موثقة بمرجعها، ثم جدولة ونشر يخصم من رصيد الاشتراك.',
  load:api=>api('/content'),
  render(data,{e,button,ui=kit(e)}){
    const open=data.items.filter(i=>!['published','cancelled'].includes(i.status)),byDate=new Map();
    for(const i of data.items)byDate.set(i.planned_date,[...(byDate.get(i.planned_date)??[]),i]);
    const item=i=>`<li class="${i.late?'is-late':['published','cancelled'].includes(i.status)?'is-old':''}"><strong>${i.planned_time?`<bdi dir="ltr">${e(i.planned_time)}</bdi> · `:''}${e(i.title)}</strong><span>${e(i.client_name)} · ${e(i.channel_name)} · ${e(i.format_name)} · ${e(i.status_name)}${i.late?' · فات موعده':''}${i.revision_count?` · ${e(i.revision_count)} جولة تعديل`:''}</span><small>${e(i.owner_name)}${i.internal_note?` — ${e(i.internal_note)}`:''}${i.output?` — النسخة ${e(i.output.revision)} من «${e(i.output.title)}» · بصمة <bdi>${e(String(i.output.digest).slice(0,12))}</bdi>`:''}${i.client_approval_reference?` — موافقة العميل: ${e(i.client_approval_reference)}`:''}${i.published_reference?` — <bdi>${e(i.published_reference)}</bdi>`:''}</small>${i.actions.length?`<div class="operation-actions">${i.actions.map(a=>button(a,i.id,contentLabels[a])).join('')}</div>`:''}</li>`;
    const days=[...byDate.keys()].sort().map(d=>`<section class="vn-block"><h3>${e(d)}${byDate.get(d)[0].holiday?` <span class="vn-flag is-warn">${e(byDate.get(d)[0].holiday)}</span>`:''}</h3><ul class="vn-list">${byDate.get(d).map(item).join('')}</ul></section>`).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${data.clients.length?`<div class="operation-actions">${data.clients.map(c=>button('create_item',c.id,`بند محتوى — ${c.name}`)).join('')}</div>`:'<p class="subtle">ما أنت ضمن فريق أي حساب عميل.</p>'}</section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(open.length,'بند قائم')}${ui.tile(open.filter(i=>i.status==='internal_review').length,'في المراجعة الداخلية')}${ui.tile(open.filter(i=>i.status==='client_review').length,'عند العميل')}${ui.tile(open.filter(i=>i.late).length,'فات موعده',open.some(i=>i.late)?'is-late':'')}</div>
      <h2>${e(data.month)}</h2>${data.holidays.length?`<p class="subtle">العطل الرسمية المعتمدة هالشهر: ${data.holidays.map(h=>`${e(h.date)} ${e(h.name)}`).join(' · ')}</p>`:''}<div class="vn-grid">${days||'<p class="subtle">ما فيه بنود محتوى في هالشهر.</p>'}</div></section>`;
  },
  form(action,id,data){
    if(action==='create_item'){const client=data.clients.find(c=>c.id===id);guard(client);return {title:`بند محتوى — ${client.name}`,endpoint:'/content',idempotent:true,fields:contentFields(data,client,null),toPayload:v=>({client_id:id,...contentPayload(v)})};}
    const i=data.items.find(x=>x.id===id);guard(i&&i.actions.includes(action));
    const spec=(fields,toPayload=v=>v)=>({title:`${contentLabels[action]} — ${i.title}`,endpoint:`/content/${id}/${contentRoutes[action]}`,fields,toPayload:v=>({version:i.version,...toPayload(v)})});
    if(action==='edit_item')return spec(contentFields(data,data.clients.find(c=>c.id===i.client_id),i),contentPayload);
    if(action==='start_drafting')return spec([],()=>({}));
    // البند ينقدّم على نسخة اعتمدها الاستوديو لعميله وحملته وقناته؛ البصمة تنقرأ من الاستوديو وما تنكتب.
    if(action==='submit_internal'){
      const fit=(data.versions??[]).filter(x=>(!x.client_id||x.client_id===i.client_id)&&(!i.campaign_id||x.campaign_id===i.campaign_id)&&x.channel===i.channel);
      return spec([field('output_version_id','النسخة المعتمدة اللي ينشرها البند','select',{value:i.output?.version_id??'',
        options:fit.length?[{value:'',label:'اختيار نسخة معتمدة'},...fit.map(x=>({value:x.id,label:`${x.title} · النسخة ${x.revision} · ${x.studio_title}`}))]:[{value:'',label:'ما فيه نسخة معتمدة تطابق البند للحين'}],
        hint:'النسخ اللي اعتمدها الاستوديو لعميل البند وحملته وقناته. إذا ما لقيتها: افتح العمل في «الاستوديو والتسليم» على حملة البند.'})],v=>({output_version_id:v.output_version_id}));
    }
    if(action==='record_client_approval'){
      const documented=i.client_approvals??[];
      if(documented.length)return spec([field('external_approval_id','موافقة العميل الموثّقة على نسخة البند','select',{required:false,options:[{value:'',label:'أكتب المرجع بنفسي'},...documented.map(a=>({value:a.id,label:a.label}))],hint:'من سجل «موافقات العملاء» على النسخة نفسها، فما تحتاج تكتب مرجعها.'}),
        field('reference','مين وافق ووين انحفظ الدليل (إذا ما اخترت موافقة موثّقة)','textarea',{required:false})],v=>v.external_approval_id?{external_approval_id:v.external_approval_id}:{reference:v.reference});
      return spec([field('reference','مين وافق من جهة العميل ووين انحفظ الدليل','textarea',{hint:'تسجيل لموافقة وصلت برّا المنصة؛ مو توقيع من العميل.'})]);
    }
    if(action==='schedule_item')return spec([field('planned_date','تاريخ النشر','date',{value:i.planned_date}),field('planned_time','الوقت','time',{value:i.planned_time})]);
    if(action==='publish_item')return spec([field('published_reference','رابط المنشور أو معرّفه'),...(i.retainer_id?[field('overage_note','سند تجاوز رصيد الاشتراك (إذا تعدّى)','textarea',{required:false,hint:`ينخصم «${i.deliverable_type}» واحد من رصيد الاشتراك وقت النشر.`})]:[])],v=>({published_reference:v.published_reference,overage_note:v.overage_note||''}));
    return spec([field('note',action==='pass_internal'?'ملاحظة المراجعة':action==='cancel_item'?'سبب الإلغاء':'المطلوب تعديله','textarea')],v=>({note:v.note}));
  }
};

export const scopeUI={
  title:'حارس النطاق',description:'ما سُلّم وما رُوجع مقابل خط الأساس في العقد، وقرار مكتوب فيما زاد: نتحمله، أو طلب تغيير، أو اعتذار.',
  load:api=>api('/scope'),
  render(data,{e,button,ui=kit(e)}){
    const disposition={absorbed:'تحملناه',change_request:'طلب تغيير مسعّر',declined:'اعتذرنا للعميل'},kind={delivery:'تسليم',revision:'جولة مراجعة',new_ask:'طلب جديد'};
    const card=b=>`<details class="vn-card"${b.open_decisions?' open':''}><summary><span class="vn-code">${e(b.client_name)}</span><span class="vn-name"><strong>${e(b.name)}</strong><small>${e(b.contract_reference)}</small></span><span class="vn-flags">${b.open_decisions?`<span class="vn-flag is-block">${e(b.open_decisions)} ينتظر قرار</span>`:''}${b.status==='closed'?'<span class="badge">مقفل</span>':''}</span></summary>
      <div class="vn-body"><div class="table-wrap"><table><thead><tr><th>المخرج</th><th>في العقد</th><th>سُلّم</th><th>المتبقي</th><th>جولات لكل مخرج</th><th>مخرجات تجاوزت الجولات</th></tr></thead><tbody>${b.lines.map(l=>`<tr><td>${e(l.name)}</td><td>${e(l.quantity)}</td><td>${e(l.delivered)}</td><td>${e(l.remaining)}</td><td>${e(l.revisions)}</td><td>${e(l.items_over_revisions)}</td></tr>`).join('')}</tbody></table></div>
      ${b.exclusions?`<p class="subtle">المستثنى: ${e(b.exclusions)}</p>`:''}<p class="subtle">تحمّلناه بدون مقابل: ${e(b.absorbed)} · طلبات تغيير: ${e(b.change_requests)}</p>
      ${b.events.length?`<ul class="vn-list">${b.events.slice().reverse().map(x=>`<li class="${x.over_scope&&!x.disposition?(x.actions.length?'is-decision':'is-late'):''}"><strong>${e(kind[x.kind])} · ${e(x.line_name)} · ${e(x.quantity)}</strong><span><bdi>${e(x.item_reference)}</bdi> · ${e(x.created_at.slice(0,10))}${x.over_scope?` · خارج النطاق: ${x.disposition?e(disposition[x.disposition]):'ينتظر قرار مسؤول الحساب'}`:''}</span>${x.description||x.disposition_note?`<small>${e(x.description)}${x.disposition_note?` — ${e(x.disposition_note)}`:''}</small>`:''}${x.actions.length?`<div class="operation-actions">${button('decide_scope',`${b.id}:${x.id}`,'اتخاذ القرار')}</div>`:''}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه أحداث مسجلة.</p>'}
      ${b.actions.length?`<div class="operation-actions">${b.actions.map(a=>button(a,b.id,a==='record_scope'?'تسجيل تسليم أو مراجعة أو طلب':'إقفال خط الأساس')).join('')}</div>`:''}</div></details>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${data.clients.length?`<div class="operation-actions">${button('create_baseline','','خط أساس من عقد')}</div>`:''}</section>${data.baselines.map(card).join('')||ui.empty('ما فيه خطوط أساس في حساباتك','يضعها مسؤول الحساب من العقد أو العرض المعتمد.')}`;
  },
  form(action,id,data){
    if(action==='create_baseline'){guard(data.clients.length);return {title:'خط أساس من عقد',endpoint:'/scope',idempotent:true,fields:[field('client_id','العميل','select',{options:data.clients.map(c=>({value:c.id,label:c.name}))}),field('name','الاسم'),field('contract_reference','مرجع العقد أو العرض المعتمد'),field('lines','مخرجات العقد','rows',{columns:[{name:'name',label:'المخرج'},{name:'quantity',label:'الكمية',type:'number',min:1},{name:'revisions',label:'جولات المراجعة لكل مخرج',type:'number',min:0,max:20,value:2}],maxRows:40,hint:'ما يتعدل بعد الحفظ؛ ينستبدل بخط أساس جديد.'}),field('exclusions','المستثنى من النطاق','textarea',{required:false})],
      toPayload:v=>({client_id:v.client_id,name:v.name,contract_reference:v.contract_reference,exclusions:v.exclusions||'',lines:v.lines})};}
    const [baselineId,eventId]=String(id).split(':'),b=data.baselines.find(x=>x.id===baselineId);guard(b);
    if(action==='record_scope')return {title:`تسجيل — ${b.name}`,endpoint:`/scope/${baselineId}/record`,fields:[field('kind','النوع','select',{options:[{value:'delivery',label:'تسليم مخرج'},{value:'revision',label:'جولة مراجعة على مخرج'},{value:'new_ask',label:'طلب جديد خارج البنود'}]}),field('line_key','البند','select',{required:false,options:[{value:'',label:'— للطلب الجديد —'},...b.lines.map(l=>({value:l.key,label:`${l.name} (المتبقي ${l.remaining})`}))]}),field('quantity','الكمية','number',{min:1,max:1000,value:1}),field('item_reference','مرجع المخرج أو الطلب','text',{hint:'استخدم نفس المرجع للمخرج الواحد عشان تنحسب جولات مراجعته.'}),field('description','الوصف','textarea',{required:false})],toPayload:v=>({kind:v.kind,line_key:v.kind==='new_ask'?'':v.line_key||'',quantity:Number(v.quantity),item_reference:v.item_reference,description:v.description||''})};
    if(action==='close_baseline')return {title:`إقفال — ${b.name}`,endpoint:`/scope/${baselineId}/close`,fields:[field('note','سبب الإقفال','textarea')],toPayload:v=>({version:b.version,note:v.note})};
    const x=b.events.find(ev=>ev.id===eventId);guard(x&&x.actions.includes('decide_scope'));
    return {title:`قرار خارج النطاق — ${x.item_reference}`,endpoint:`/scope/events/${eventId}/decide`,fields:[field('disposition','القرار','select',{options:[{value:'change_request',label:'طلب تغيير مسعّر'},{value:'absorbed',label:'نتحمّله بدون مقابل'},{value:'declined',label:'اعتذار للعميل'}]}),field('note','المرجع أو السبب','textarea')],toPayload:v=>v};
  }
};
