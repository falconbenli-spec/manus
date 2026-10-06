// خط الفرص بالاحتمالات، ومصفوفة التقدير وبطاقات الأسعار — لفريق حساب العميل وحامل تصريح المبيعات والتسليم.
// البلاطة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
// عقود قرب نهايتها وفرصة التجديد (الحزمة 4، P4-CRM-6).
import { renewalsSection, renewalBasisHtml, renewalForm } from './renewals-ui.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const pct=bp=>bp===null||bp===undefined?'—':`${(bp/100).toFixed(2)}%`;
const hrs=centi=>(centi/100).toFixed(2).replace(/\.00$/,'');
const rial=minor=>minor===null||minor===undefined?'':(minor/100).toFixed(2);
const table=(e,head,rows)=>`<div class="table-wrap"><table><thead><tr>${head.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

/* ───── خط الفرص ───── */
const oppLabels={edit_opportunity:'تعديل البيانات',log_activity:'تسجيل نشاط',move_stage:'نقل لمرحلة',close_won:'إغلاق رابحة',close_lost:'إغلاق خاسرة',open_case:'فتح صفقة'};
const oppRoutes={edit_opportunity:'edit',log_activity:'activity',move_stage:'move',close_won:'win',close_lost:'lose',open_case:'open_case'};
// الفرصة وصفقتها (P4-CRM-2): «فتح صفقة» يعبّي التأهيل من الفرصة، فالخادم يرفضه وصاحب القرار ناقص أو تاريخ الإغلاق المتوقع فات؛
// والفوز يُسجَّل على اتفاق موثّق على صفقتها، والخسارة لا تقع على صفقة متعاقد عليها. ما يرفضه الخادم لا يُرسم زرًّا، ويُقال بداله الناقص وعند من.
const dealGaps=(o,today)=>[...(String(o.decision_maker??'').trim()?[]:['صاحب القرار عند العميل']),...(o.expected_close_on&&o.expected_close_on>=today?[]:['تاريخ الإغلاق المتوقع (اليوم أو بعده)'])];
const offered=(o,action,today)=>action==='close_won'?!!o.deal?.contracted:action==='close_lost'?!o.deal?.contracted:action==='open_case'?!dealGaps(o,today).length:true;
const dealState=d=>d.contracted?'عليها اتفاق موثّق':{lost:'خسرناها',withdrawn:'سحبناها'}[d.status]??'مفتوحة وما توثّق اتفاقها للحين';
const stageLabels={approve_stage:'اعتماد المرحلة',reject_stage:'رفض',retire_stage:'سحب المرحلة',revise_stage:'نسخة جديدة'};
function detailFields(data,o){
  return [field('name','اسم الفرصة','text',{value:o?.name}),field('service_family','نوع الخدمة','select',{value:o?.service_family,options:data.families.map(f=>({value:f.key,label:f.name}))}),
    field('value','القيمة المتوقعة بالريال','text',{value:o?rial(o.value_minor):'',hint:'قيمة تقديرية يكتبها صاحب الفرصة؛ مو إيراد.'}),field('expected_close_on','تاريخ الإغلاق المتوقع','date',{required:false,value:o?.expected_close_on??''}),
    field('decision_maker','صاحب القرار عند العميل','text',{required:false,value:o?.decision_maker}),field('budget_note','سند ميزانية العميل','textarea',{required:false,value:o?.budget_note}),
    field('next_step','الخطوة التالية','text',{required:false,value:o?.next_step}),field('next_step_on','موعدها','date',{required:false,value:o?.next_step_on??''})];
}
const detailPayload=v=>({name:v.name,service_family:v.service_family,value:String(v.value).trim(),expected_close_on:v.expected_close_on||'',decision_maker:v.decision_maker||'',budget_note:v.budget_note||'',next_step:v.next_step||'',next_step_on:v.next_step_on||''});
function stageFields(data,s){
  return [field('code','رمز المرحلة (لاتيني)','text',{value:s?.code,hint:s?'الرمز ثابت؛ النسخة الجديدة تحل محل السارية لما يعتمدها شخص ثاني.':''}),field('name','اسم المرحلة','text',{value:s?.name}),field('sort_order','ترتيبها في الخط','number',{min:1,max:99,value:s?.sort_order??1}),
    field('win_probability','احتمال الفوز %','text',{value:s?.win_probability??'',hint:'من تجربة الشركة مو من مرجع عام.'}),field('probability_basis','سند الاحتمال','textarea',{value:s?.probability_basis,hint:'مثال: نسبة اللي فاز من الفرص اللي وصلت هالمرحلة في فترة محددة.'}),
    field('confirmed_on','تاريخ تأكيد الرقم','date',{value:s?.confirmed_on??data.today}),field('idle_days','عتبة الخمول بالأيام','number',{min:1,max:365,value:s?.idle_days??'',hint:'بعدها تطلع الفرصة «راكدة» لصاحبها، والنشاط المسجل يصفّر العداد.'}),
    field('required_fields','وش يُشترط قبل دخول المرحلة','checks',{required:false,value:s?.required??[],options:Object.entries(data.requirements).map(([value,label])=>({value,label}))})];
}
const stagePayload=v=>({code:v.code,name:v.name,sort_order:Number(v.sort_order),win_probability:String(v.win_probability).trim(),probability_basis:v.probability_basis,confirmed_on:v.confirmed_on,idle_days:Number(v.idle_days),required_fields:v.required_fields??[]});

export const pipelineUI={
  title:'خط الفرص',description:'فرص كل عميل بمراحل يعرّفها مالك الإجراء باحتمالها وسنده، وشروط دخول كل مرحلة، وتنبيه الركود، وسبب إلزامي لكل خسارة. التوقع الموزون تقدير مو إيراد.',
  load:api=>api('/pipeline'),
  // سجل التعريفات (ترحيل 123): الحقول المخصّصة في موضعيها، والقائمة بأعمدتها ومرشحاتها. بسجل فارغ لا يتغير في البطاقة بايت.
  render(data,{e,button,money,ui=kit(e)}){
    const f=data.forecast,r=data.report,ENTITY='opportunity';
    const opp=o=>`<details class="vn-card"${o.stale&&o.is_mine?' open':''}><summary><span class="vn-code">${e(o.client_name)}</span><span class="vn-name"><strong>${e(o.name)}</strong><small>${e(o.family_name)} · ${e(o.owner_name)}${o.expected_close_on?` · إغلاق متوقع ${e(o.expected_close_on)}`:''}</small></span><span class="vn-flags">${o.stale?`<span class="vn-flag is-block">راكدة ${e(o.days_idle)} يوم</span>`:''}${o.stage_missing?'<span class="vn-flag is-warn">مرحلتها مسحوبة</span>':''}<span class="badge">${e(o.status==='open'?o.stage_name??o.stage_code:o.status==='won'?'رابحة':'خاسرة')}</span></span></summary>
      <div class="vn-body">${ui.fields(ENTITY,o,'header')}<div class="vn-tiles">${ui.tile(money(o.value_minor),'القيمة المتوقعة')}${o.status==='open'?ui.tile(pct(o.win_probability_bp),'احتمال المرحلة')+ui.tile(o.weighted_minor===null?'—':money(o.weighted_minor),'القيمة الموزونة (تقدير)')+ui.tile(`${o.days_idle} / ${o.idle_threshold??'—'}`,'أيام بدون نشاط / العتبة',o.stale?'is-late':''):''}</div>
      ${o.status==='lost'?`<p class="vn-alert">سبب الخسارة: ${e(o.loss_reason_name)} — ${e(o.loss_comment)}</p>`:''}${o.status==='won'?`<p class="subtle">سند الفوز: ${e(o.close_note)}</p>`:''}
      ${renewalBasisHtml(o,{e,money,ui})}
      <dl class="detail-data"><dt>صاحب القرار</dt><dd>${e(o.decision_maker||'—')}</dd><dt>سند الميزانية</dt><dd>${e(o.budget_note||'—')}</dd><dt>الخطوة التالية</dt><dd>${e(o.next_step?`${o.next_step} · ${o.next_step_on}`:'—')}</dd></dl>
      ${o.moves.length?`<section class="vn-block"><h3>شروط المراحل الأخرى</h3><ul class="vn-list">${o.moves.map(m=>`<li class="${m.missing.length?'is-due':'is-ok'}"><strong>${e(m.name)}</strong><span>${m.missing.length?`ناقص: ${e(m.missing.join('؛ '))}`:'مستوفاة'}</span></li>`).join('')}</ul></section>`:''}
      ${o.activities.length?`<section class="vn-block"><h3>النشاط</h3><ul class="vn-list">${o.activities.map(a=>`<li><strong>${e(a.activity_date)} · ${e(a.kind_name)}</strong><span>${e(a.note)}</span><small>${e(a.recorded_by_name)}</small></li>`).join('')}</ul></section>`:''}
      ${ui.fields(ENTITY,o,'body')}
      <p class="subtle">المسار: ${o.history.map(h=>e(h.to_stage)).join(' ← ')}</p>
      ${deal(o)}${o.actions.some(a=>offered(o,a,data.today))?`<div class="operation-actions">${o.actions.filter(a=>offered(o,a,data.today)).map(a=>button(a,o.id,oppLabels[a])).join('')}</div>`:''}</div></details>`;
    // الصفقة على بطاقة فرصتها ورابطها، وما ينقص قبل فتحها أو قبل الفوز بكلام واضح مكان الزر اللي يرفضه الخادم.
    function deal(o){
      const gaps=o.actions.includes('open_case')?dealGaps(o,data.today):[];
      return (o.deal?`<p><a href="#commercial?focus=${e(o.deal.id)}">الصفقة <bdi>${e(o.deal.ref)}</bdi></a> · ${e(dealState(o.deal))}</p>`:'')
        +(gaps.length?`<p class="subtle">قبل «فتح صفقة» ناقص في الفرصة: ${e(gaps.join(' · '))} — عند ${e(o.owner_name)}.</p>`:'')
        +(o.actions.includes('close_won')&&!o.deal?.contracted?`<p class="subtle">${o.deal?'الفوز بعد ما يتوثّق الاتفاق على صفقتها من «العملاء والعروض».':'الفوز ينسجّل على اتفاق موثّق: افتح صفقة من الفرصة، وكمّل عليها التأهيل والعرض والاتفاق.'}</p>`:'');
    }
    const open=data.opportunities.filter(o=>o.status==='open'),closed=data.opportunities.filter(o=>o.status!=='open');
    const groups=data.stages.map(s=>{const list=open.filter(o=>o.stage_code===s.code);return list.length?`<section class="vn-group"><h2>${e(s.name)} <span>${list.length}</span></h2>${list.map(opp).join('')}</section>`:'';}).join('')+(open.some(o=>o.stage_missing)?`<section class="vn-group"><h2>مرحلة مسحوبة</h2>${open.filter(o=>o.stage_missing).map(opp).join('')}</section>`:'');
    const winRow=g=>`<tr><td>${e(g.name)}</td><td>${e(g.won_count)}</td><td>${e(money(g.won_value_minor))}</td><td>${e(g.lost_count)}</td><td>${e(money(g.lost_value_minor))}</td><td>${e(pct(g.win_rate_count_bp))}</td><td>${e(pct(g.win_rate_value_bp))}</td></tr>`;
    // العمود الأول اسم المجموعة: كان رأسه فاضيًا فيُعلن عمودًا بلا اسم.
    const winHead=first=>[first,'رابحة','قيمتها','خاسرة','قيمتها','نسبة الفوز بالعدد','بالقيمة'];
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${data.setup_needed.map(s=>`<p class="vn-alert">${e(s)}</p>`).join('')}
      <div class="operation-actions">${data.stages.length&&data.clients.length?button('create_opportunity','','فرصة جديدة'):''}${button('prepare_stage','','تعريف مرحلة')}${button('add_loss_reason','','سبب خسارة')}</div>${data.clients.length?'':'<p class="subtle">ما أنت ضمن فريق أي حساب عميل.</p>'}</section>
      ${renewalsSection(data,{e,button,money,ui})}
      <section class="vn-board"><p class="vn-alert">${e(f.warning)}</p><div class="vn-tiles">${ui.tile(money(f.weighted_minor),'التوقع الموزون (تقدير)')}${ui.tile(money(f.open_value_minor),'القيمة المفتوحة غير الموزونة')}${ui.tile(f.open_count,'فرصة مفتوحة')}${ui.tile(data.stale_mine.length,'فرصي الراكدة',data.stale_mine.length?'is-late':'')}</div>
      ${f.unweighted_count?`<p class="subtle">${e(f.unweighted_count)} فرصة في مرحلة مسحوبة ما تدخل التوقع.</p>`:''}
      ${data.stale_mine.length?`<ul class="vn-list">${data.stale_mine.map(o=>`<li class="is-late"><strong>${e(o.name)} · ${e(o.client_name)}</strong><span>${e(o.stage_name)} · ${e(o.days_idle)} يوم بدون نشاط والعتبة ${e(o.idle_threshold)}</span></li>`).join('')}</ul>`:''}
      ${data.stages.length?table(e,['المرحلة','الاحتمال','سنده وتاريخه','الفرص','القيمة','الموزونة','راكدة'],f.by_stage.map(s=>`<tr><td>${e(s.name)}</td><td>${e(pct(s.win_probability_bp))}</td><td>${e(s.probability_basis)} · ${e(s.confirmed_on)}</td><td>${e(s.count)}</td><td>${e(money(s.value_minor))}</td><td>${e(money(s.weighted_minor))}</td><td>${e(s.stale)}</td></tr>`)):''}</section>
      ${data.opportunities.length?`<section class="panel panel-body"><h2>قائمة الفرص</h2>${ui.records(ENTITY,data.opportunities,{id:'opportunity-list',custom:data.custom_columns,columns:[
        {key:'name',label:ui.label(ENTITY,'name','اسم الفرصة'),value:o=>o.name,html:o=>`<a href="#pipeline?focus=${e(o.id)}">${e(o.name)}</a>`},
        {key:'client_id',label:ui.label(ENTITY,'client_id','العميل'),value:o=>o.client_name},
        {key:'stage_code',label:ui.label(ENTITY,'stage_code','المرحلة'),value:o=>o.status==='open'?o.stage_name??o.stage_code:o.status_name??o.status},
        {key:'value',label:ui.label(ENTITY,'value','القيمة المتوقعة'),value:o=>money(o.value_minor)},
        {key:'owner_id',label:ui.label(ENTITY,'owner_id','صاحب الفرصة'),value:o=>o.owner_name}]})}</section>`:''}
      ${groups||ui.empty('ما فيه فرص مفتوحة في حساباتك','الفرصة الجديدة تبدأ من «فرصة جديدة» على عميل أنت ضمن فريق حسابه.')}
      <section class="panel panel-body"><h2>الفوز والخسارة ${e(r.from)} لين ${e(r.to)}</h2>${r.total?`<h3>أسباب الخسارة</h3>${table(e,['السبب','العدد','القيمة'],r.by_reason.map(g=>`<tr><td>${e(g.name)}</td><td>${e(g.count)}</td><td>${e(money(g.value_minor))}</td></tr>`))}
        ${r.loss_by_month.length?`<h3>أسباب الخسارة عبر الأشهر</h3>${table(e,['الشهر','السبب','العدد','القيمة'],r.loss_by_month.map(m=>`<tr><td>${e(m.month)}</td><td>${e(m.reason)}</td><td>${e(m.count)}</td><td>${e(money(m.value_minor))}</td></tr>`))}`:''}
        <h3>حسب القطاع</h3>${table(e,winHead('القطاع'),r.by_sector.map(winRow))}<h3>حسب نوع الخدمة</h3>${table(e,winHead('نوع الخدمة'),r.by_family.map(winRow))}
        ${r.comments.length?`<h3>تعليقات الخسارة</h3><ul class="vn-list">${r.comments.map(c=>`<li><strong>${e(c.closed_on)} · ${e(c.name)} · ${e(c.client_name)}</strong><span>${e(c.reason)} · ${e(money(c.value_minor))}</span><small>${e(c.comment)}</small></li>`).join('')}</ul>`:''}`:'<p class="subtle">ما فيه فرص مقفلة في الفترة.</p>'}</section>
      ${closed.length?`<section class="vn-group"><h2>مقفلة <span>${closed.length}</span></h2>${closed.slice(0,30).map(opp).join('')}</section>`:''}
      <section class="panel panel-body"><h2>إعداد المراحل</h2>${data.stage_revisions.length?`<ul class="vn-list">${data.stage_revisions.map(s=>`<li class="${s.status==='approved'?'is-ok':['retired','rejected'].includes(s.status)?'is-old':s.actions.length?'is-decision':'is-due'}"><strong>${e(s.name)} (<bdi>${e(s.code)}</bdi> · نسخة ${e(s.revision)}) · ${e(s.status_name)}</strong><span>احتمال ${e(s.win_probability)}% · خمول ${e(s.idle_days)} يوم · تأكيد ${e(s.confirmed_on)}${s.required_names.length?` · يشترط: ${e(s.required_names.join('؛ '))}`:''}</span><small>${e(s.probability_basis)}</small>${s.actions.length?`<div class="operation-actions">${s.actions.map(a=>button(a,s.id,stageLabels[a])).join('')}</div>`:''}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه مراحل معرّفة للحين.</p>'}
      <h2>أسباب الخسارة</h2>${data.loss_reasons.length?`<ul class="vn-list">${data.loss_reasons.map(x=>`<li class="${x.active?'':'is-old'}"><strong>${e(x.name)} (<bdi>${e(x.code)}</bdi>)</strong>${x.actions.length?`<div class="operation-actions">${button(x.actions[0],x.id,x.active?'تعطيل':'تفعيل')}</div>`:''}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه أسباب خسارة معرّفة للحين.</p>'}</section>`;
  },
  form(action,id,data){
    if(action==='create_opportunity'){guard(data.stages.length&&data.clients.length);return {title:'فرصة جديدة',endpoint:'/pipeline/opportunities',idempotent:true,fields:[field('client_id','العميل','select',{options:data.clients.map(c=>({value:c.id,label:c.name}))}),field('stage_code','المرحلة','select',{options:data.stages.map(s=>({value:s.code,label:`${s.name} (${pct(s.win_probability_bp)})`}))}),...detailFields(data,null)],toPayload:v=>({client_id:v.client_id,stage_code:v.stage_code,...detailPayload(v)}),entity:'opportunity'};}
    if(action==='prepare_stage')return {title:'تعريف مرحلة',endpoint:'/pipeline/stages',idempotent:true,fields:stageFields(data,null),toPayload:stagePayload};
    if(action==='open_renewal')return renewalForm(data,id);
    if(action==='add_loss_reason')return {title:'سبب خسارة',endpoint:'/pipeline/loss-reasons',idempotent:true,fields:[field('code','الرمز (لاتيني)'),field('name','السبب','text',{hint:'الاسم ثابت بعد الحفظ عشان ما يتغير معنى تقارير الفترات اللي قبل.'})],toPayload:v=>v};
    const s=data.stage_revisions.find(x=>x.id===id);
    if(s){guard(s.actions.includes(action));
      if(action==='revise_stage')return {title:`نسخة جديدة — ${s.name}`,endpoint:'/pipeline/stages',idempotent:true,fields:stageFields(data,s),toPayload:stagePayload};
      return {title:`${stageLabels[action]} — ${s.name}`,endpoint:`/pipeline/stages/${id}/${action}`,fields:[field('note',action==='approve_stage'?'أساس الاعتماد':'السبب','textarea')],toPayload:v=>({version:s.version,note:v.note})};}
    const reason=data.loss_reasons.find(x=>x.id===id);
    if(reason){guard(reason.actions.includes(action));return {title:`${reason.active?'تعطيل':'تفعيل'} — ${reason.name}`,endpoint:`/pipeline/loss-reasons/${id}/${action}`,fields:[],toPayload:()=>({version:reason.version})};}
    const o=data.opportunities.find(x=>x.id===id);guard(o&&o.actions.includes(action)&&offered(o,action,data.today));
    // فتح الصفقة (P4-CRM-2): ما يُكتب شي — العميل من ملفه والتأهيل من الفرصة — فالنموذج يقرأ ما ينتقل ويرسل نسخة الفرصة وحدها.
    if(action==='open_case')return {title:`${oppLabels[action]} — ${o.name}`,endpoint:`/pipeline/opportunities/${id}/open_case`,idempotent:true,submit:'فتح الصفقة',
      fields:[field('carried','اللي ينتقل للصفقة','hidden',{required:false,value:'',hint:`العميل «${o.client_name}» من ملفه، والتأهيل من الفرصة: الاحتياج «${o.name}» والقيمة ${rial(o.value_minor)} ريال وموعد القرار ${o.expected_close_on} وصاحب القرار ${o.decision_maker}.`}),
        field('decides','مين يعتمد التأهيل','hidden',{required:false,value:'',hint:`المدير المباشر لصاحب الفرصة (${o.owner_name})، والصفقة تصير لصاحب الفرصة.`})],
      toPayload:()=>({version:o.version})};
    // entity/record: نموذج التعديل يحمل الحقول المخصّصة كلها، ونموذج الانتقال (نقل، فوز، خسارة) يحمل الملزَم منها عند ذلك الانتقال. تسجيل نشاط لا يحمل شيئًا.
    const transition={move_stage:'move',close_won:'win',close_lost:'lose'}[action];
    const spec=(fields,toPayload=v=>v)=>({title:`${oppLabels[action]} — ${o.name}`,endpoint:`/pipeline/opportunities/${id}/${oppRoutes[action]}`,fields,toPayload:v=>({version:o.version,...toPayload(v)}),
      ...(action==='log_activity'?{}:{entity:'opportunity',record:o,...(transition?{transition}:{})})});
    if(action==='edit_opportunity')return spec(detailFields(data,o),detailPayload);
    if(action==='log_activity')return spec([field('activity_date','التاريخ','date',{value:data.today}),field('kind','النوع','select',{options:Object.entries(data.activity_kinds).map(([value,label])=>({value,label}))}),field('note','وش صار','textarea')]);
    if(action==='move_stage')return spec([field('stage_code','المرحلة','select',{options:o.moves.map(m=>({value:m.code,label:m.missing.length?`${m.name} — ناقص: ${m.missing.join('؛ ')}`:m.name}))}),field('note','ملاحظة','textarea',{required:false})],v=>({stage_code:v.stage_code,note:v.note||''}));
    if(action==='close_won')return spec([field('note','سند الفوز','textarea',{required:false,hint:`اختياري. السند هو الاتفاق الموثّق على الصفقة ${o.deal.ref}؛ اتركه فاضي ويكفي.`})],v=>String(v.note??'').trim()?{note:v.note}:{});
    const reasons=data.loss_reasons.filter(x=>x.active);guard(reasons.length);
    return spec([field('loss_reason_id','سبب الخسارة','select',{options:reasons.map(x=>({value:x.id,label:x.name}))}),field('comment','وش صار ووش نتعلم','textarea',{hint:`إلزامي؛ تقرير أسباب الخسارة عبر الفترات هو اللي يحسّن العروض.${o.deal&&!o.deal.contracted?` وصفقتها ${o.deal.ref} تنقفل خاسرة معها بالسبب نفسه.`:''}`})]);
  }
};

/* ───── التقديرات ───── */
const estLabels={edit_estimate:'تعديل المصفوفة',submit_estimate:'إرسال للاعتماد',withdraw_estimate:'سحب للتعديل',approve_estimate:'اعتماد',reject_estimate:'رفض',create_change_order:'أمر تغيير',handoff_estimate:'ربط بملف تجاري',to_quote:'نقل للعرض التجاري'};
const estRoutes={edit_estimate:'edit',submit_estimate:'submit',withdraw_estimate:'withdraw',approve_estimate:'approve',reject_estimate:'reject',handoff_estimate:'handoff'};
const changeType={added:'أُضيف',changed:'تغيّر',removed:'حُذف'};
function lineRows(client,x){
  const roles=client?.live_card?.roles??[];
  return field('lines','مصفوفة الدور × المخرج','rows',{value:x?.lines.map(l=>({role_name:l.role_name,category_code:l.category_code,deliverable:l.deliverable,hours:hrs(l.hours_centi),sell_rate:l.sell_rate_origin==='manual'?rial(l.sell_rate_minor):''})),maxRows:120,
    columns:[{name:'role_name',label:'الدور'},{name:'category_code',label:'رمز الفئة الوظيفية',required:false},{name:'deliverable',label:'المخرج'},{name:'hours',label:'الساعات'},{name:'sell_rate',label:'سعر بيع الساعة (فارغ = من البطاقة)',required:false}],
    hint:roles.length?`البطاقة السارية: ${roles.map(r=>`${r.name} ${rial(r.unit_price_minor)}`).join(' · ')}. التكلفة تنقرأ برمز الفئة الوظيفية وما تنكتب باليد.`:'ما فيه بطاقة أسعار معتمدة سارية لهالعميل: اكتب سعر كل سطر.'});
}
const linesPayload=rows=>(rows??[]).map(l=>({role_name:l.role_name,category_code:l.category_code||'',deliverable:l.deliverable,hours:String(l.hours).trim(),sell_rate:l.sell_rate?String(l.sell_rate).trim():''}));
export const estimatesUI={
  title:'التقديرات وبطاقات الأسعار',description:'مصفوفة دور × مخرج بالساعات وسعر البيع والتكلفة، والهامش ظاهر سطر سطر قبل إرسال العرض. ما فيه أسعار افتراضية، ولا هامش على تكلفة مو متاحة.',
  load:api=>api('/estimates'),
  render(data,{e,button,money,ui=kit(e)}){
    const m=v=>v===null||v===undefined?'غير متاحة':money(v),mp=v=>v===null||v===undefined?'غير محسوب':pct(v);
    const card=x=>{const actions=[...x.actions,...(x.status==='approved'&&x.handoff&&x.margin_available?['to_quote']:[])];
      return `<details class="vn-card"${x.status==='submitted'?' open':''}><summary><span class="vn-code"><bdi>${e(x.code)}</bdi></span><span class="vn-name"><strong>${e(x.name)}</strong><small>${e(x.client_name)} · ${e(x.kind_name)} · ${e(x.prepared_by_name)}${x.parent?` · على <bdi>${e(x.parent.code)}</bdi>`:''}</small></span><span class="vn-flags">${x.margin_available?'':'<span class="vn-flag is-warn">الهامش غير محسوب</span>'}<span class="badge">${e(x.status_name)}</span></span></summary>
      <div class="vn-body"><p class="measure">${e(x.scope_note)}</p>${x.change_reason?`<p class="subtle">سبب التغيير: ${e(x.change_reason)}</p>`:''}
      <div class="vn-tiles">${ui.tile(money(x.total.sell_minor),'سعر البيع')}${ui.tile(m(x.total.cost_minor),'التكلفة')}${ui.tile(m(x.total.margin_minor),'الهامش')}${ui.tile(mp(x.total.margin_bp),'نسبة الهامش',x.margin_available?'':'is-due')}</div>
      ${x.margin_notice?`<p class="vn-alert">${e(x.margin_notice)}</p>`:''}
      ${table(e,['الدور','المخرج','الساعات','سعر الساعة','البيع','التكلفة','الهامش','النسبة'],[...x.lines.map(l=>`<tr class="${l.cost_minor===null?'is-due':''}"><td>${e(l.role_name)}${l.category_code?` <small><bdi>${e(l.category_code)}</bdi></small>`:''}</td><td>${e(l.deliverable)}</td><td>${e(hrs(l.hours_centi))}</td><td>${e(rial(l.sell_rate_minor))}${l.sell_rate_origin==='manual'?' <small>يدوي</small>':''}</td><td>${e(money(l.sell_minor))}</td><td>${e(m(l.cost_minor))}${l.cost_rate_source?` <small>${e(l.cost_rate_source)}</small>`:''}</td><td>${e(m(l.margin_minor))}</td><td>${e(mp(l.margin_bp))}</td></tr>`),
        `<tr><th colspan="2" scope="row">الإجمالي</th><td><strong>${e(hrs(x.total.hours_centi))}</strong></td><td></td><td><strong>${e(money(x.total.sell_minor))}</strong></td><td><strong>${e(m(x.total.cost_minor))}</strong></td><td><strong>${e(m(x.total.margin_minor))}</strong></td><td><strong>${e(mp(x.total.margin_bp))}</strong></td></tr>`])}
      <section class="vn-block"><h3>حسب المخرج</h3>${table(e,['المخرج','الساعات','البيع','الهامش','النسبة'],x.deliverables.map(d=>`<tr><td>${e(d.name)}</td><td>${e(hrs(d.hours_centi))}</td><td>${e(money(d.sell_minor))}</td><td>${e(m(d.margin_minor))}</td><td>${e(mp(d.margin_bp))}</td></tr>`))}
        <h3>حسب الدور</h3>${table(e,['الدور','الساعات','البيع','الهامش','النسبة'],x.roles.map(d=>`<tr><td>${e(d.name)}</td><td>${e(hrs(d.hours_centi))}</td><td>${e(money(d.sell_minor))}</td><td>${e(m(d.margin_minor))}</td><td>${e(mp(d.margin_bp))}</td></tr>`))}
        ${x.deliverable_reference.length?`<p class="subtle">مقارنة بسعر المخرج في البطاقة: ${x.deliverable_reference.map(d=>`${e(d.name)} ${e(money(d.matrix_sell_minor))} مقابل ${e(money(d.card_price_minor))}`).join(' · ')}</p>`:''}</section>
      ${x.change?`<section class="vn-block"><h3>ما تغيّر عن <bdi>${e(x.parent.code)}</bdi> وبكم</h3><ul class="vn-list">${x.change.changes.map(c=>`<li><strong>${e(changeType[c.type])} · ${e(c.role_name)} × ${e(c.deliverable)}</strong><span>ساعات ${e(hrs(c.hours_delta_centi))} · بيع ${e(money(c.sell_delta_minor))} · تكلفة ${e(m(c.cost_delta_minor))}</span></li>`).join('')||'<li><span>ما فيه فرق في المصفوفة.</span></li>'}</ul>
        <p>فرق البيع ${e(money(x.change.sell_delta_minor))} · فرق التكلفة ${e(m(x.change.cost_delta_minor))} · فرق الهامش ${e(m(x.change.margin_delta_minor))} · نسبة الهامش ${e(mp(x.change.margin_bp_before))} ← ${e(mp(x.change.margin_bp_after))}</p>${x.change.margin_notice?`<p class="vn-alert">${e(x.change.margin_notice)}</p>`:''}</section>`:''}
      ${x.handoff?`<p class="subtle">مرتبط بالملف التجاري «${e(x.handoff.case_name)}» (${e(x.handoff.case_status)})؛ العقد والمشروع وميزانيته هناك.</p>`:''}${x.decision_note?`<p class="subtle">القرار: ${e(x.decision_note)}</p>`:''}
      ${actions.length?`<div class="operation-actions">${actions.map(a=>button(a,x.id,estLabels[a])).join('')}</div>`:''}</div></details>`;};
    const cards=data.price_cards.map(c=>`<li class="${c.status==='approved'?'is-ok':c.status==='rejected'?'is-old':c.actions.length?'is-decision':'is-due'}"><strong>${e(c.name)} · ${e(c.scope_name)}${c.client_name?` — ${e(c.client_name)}`:''} · سريان ${e(c.effective_from)} · ${e(c.status_name)}</strong><span>${c.lines.map(l=>`${e(l.name)} ${e(l.unit_price)}${l.kind==='role'?'/ساعة':'/مخرج'}`).join(' · ')}</span><small>${e(c.source)}</small>${c.actions.length?`<div class="operation-actions">${c.actions.map(a=>button(a,c.id,a==='approve_card'?'اعتماد البطاقة':'رفض')).join('')}</div>`:''}</li>`).join('');
    const groups=[['submitted','بانتظار الاعتماد'],['draft','مسودات'],['approved','معتمدة'],['rejected','مرفوضة']].map(([s,t])=>{const rows=data.estimates.filter(x=>x.status===s);return rows.length?`<section class="vn-group"><h2>${e(t)} <span>${rows.length}</span></h2>${rows.map(card).join('')}</section>`:'';}).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p><p class="${data.cost_source_connected?'subtle':'vn-alert'}">${e(data.cost_notice)}</p>
      ${data.clients.length?`<div class="operation-actions">${data.clients.map(c=>button('create_estimate',c.id,`تقدير — ${c.name}`)).join('')}${button('prepare_card','','بطاقة أسعار')}</div>`:'<p class="subtle">ما أنت ضمن فريق أي حساب عميل.</p>'}</section>
      ${data.scope_candidates.length?`<section class="panel panel-body"><h2>تنبيهات حارس النطاق: تنتظر أمر تغيير</h2><ul class="vn-list">${data.scope_candidates.map(s=>`<li class="is-late"><strong>${e(s.client_name)} · ${e(s.baseline_name)} · ${e(s.item_reference)}</strong><span>${e(s.description)}</span>${s.parents.length?`<div class="operation-actions">${button('change_from_scope',s.id,'أمر تغيير مسعّر')}</div>`:'<small>ما فيه تقدير معتمد لهالعميل ينبني عليه أمر التغيير.</small>'}</li>`).join('')}</ul></section>`:''}
      ${groups||ui.empty('ما فيه تقديرات في حساباتك للحين','التقدير يبدأ من زر «تقدير» على عميل أنت ضمن فريق حسابه.')}
      <section class="panel panel-body"><h2>بطاقات الأسعار</h2>${cards?`<ul class="vn-list">${cards}</ul>`:'<p class="subtle">ما فيه بطاقات أسعار للحين. البطاقة تبدأ فاضية ويعبيها صاحب الإجراء بسندها.</p>'}</section>`;
  },
  form(action,id,data){
    if(action==='prepare_card')return {title:'بطاقة أسعار',endpoint:'/estimates/price-cards',idempotent:true,fields:[field('client_id','النطاق','select',{required:false,options:[{value:'',label:'القائمة العامة'},...data.clients.map(c=>({value:c.id,label:`بطاقة خاصة — ${c.name}`}))]}),field('name','اسم البطاقة'),field('effective_from','تاريخ السريان','date',{value:data.today}),field('source','سند الأسعار','textarea',{hint:'قرار التسعير أو الاتفاق مع العميل ومرجعه.'}),
      field('lines','البنود','rows',{maxRows:80,columns:[{name:'kind',label:'النوع',type:'select',options:[{value:'role',label:'سعر ساعة لدور'},{value:'deliverable',label:'سعر وحدة لمخرج'}]},{name:'name',label:'الدور أو المخرج'},{name:'category_code',label:'رمز الفئة الوظيفية (للدور)',required:false},{name:'price',label:'السعر بالريال'}],hint:'السعر الجديد بطاقة بتاريخ سريان جديد.'})],
      toPayload:v=>({client_id:v.client_id||'',name:v.name,effective_from:v.effective_from,source:v.source,lines:(v.lines??[]).map(l=>({kind:l.kind,name:l.name,category_code:l.category_code||'',price:String(l.price).trim()}))})};
    const pc=data.price_cards.find(c=>c.id===id);
    if(pc){guard(pc.actions.includes(action));return {title:`${action==='approve_card'?'اعتماد':'رفض'} — ${pc.name}`,endpoint:`/estimates/price-cards/${id}/${action}`,fields:[field('note',action==='approve_card'?'أساس الاعتماد':'السبب','textarea')],toPayload:v=>({version:pc.version,note:v.note})};}
    const base=(client,extra,toExtra)=>({endpoint:'/estimates',idempotent:true,fields:[...extra,field('name','اسم التقدير'),field('scope_note','النطاق والافتراضات','textarea'),lineRows(client,null)],toPayload:v=>({client_id:client.id,opportunity_id:'',parent_estimate_id:'',change_reason:'',scope_event_id:'',...toExtra(v),name:v.name,scope_note:v.scope_note,lines:linesPayload(v.lines)})});
    if(action==='create_estimate'){const client=data.clients.find(c=>c.id===id);guard(client);
      return {title:`تقدير — ${client.name}`,...base(client,[field('opportunity_id','الفرصة','select',{required:false,options:[{value:'',label:'بدون فرصة'},...client.opportunities.map(o=>({value:o.id,label:o.name}))]})],v=>({opportunity_id:v.opportunity_id||''}))};}
    if(action==='change_from_scope'){const s=data.scope_candidates.find(x=>x.id===id);guard(s&&s.parents.length);const client=data.clients.find(c=>c.id===s.client_id);
      return {title:`أمر تغيير — ${s.item_reference}`,...base(client,[field('parent_estimate_id','التقدير المعتمد الأصلي','select',{options:s.parents.map(p=>({value:p.id,label:`${p.code} — ${p.name}`}))}),field('change_reason','وش تغيّر وليش','textarea',{value:s.description})],v=>({parent_estimate_id:v.parent_estimate_id,change_reason:v.change_reason,scope_event_id:s.id}))};}
    const x=data.estimates.find(r=>r.id===id);guard(x);const client=data.clients.find(c=>c.id===x.client_id);
    if(action==='create_change_order'){guard(x.actions.includes(action));
      return {title:`أمر تغيير على ${x.code}`,endpoint:'/estimates',idempotent:true,fields:[field('change_reason','وش تغيّر وليش','textarea'),field('name','اسم أمر التغيير','text',{value:`تغيير على ${x.name}`}),field('scope_note','النطاق والافتراضات','textarea',{value:x.scope_note}),{...lineRows(client,x),hint:'المصفوفة كاملة بعد التغيير، والفرق عن الأصل ينحسب وينعرض.'}],
        toPayload:v=>({client_id:x.client_id,opportunity_id:'',parent_estimate_id:x.id,change_reason:v.change_reason,scope_event_id:'',name:v.name,scope_note:v.scope_note,lines:linesPayload(v.lines)})};}
    if(action==='to_quote'){guard(x.status==='approved'&&x.handoff&&x.margin_available);const k=client?.cases.find(c=>c.id===x.handoff.case_id);
      const common=[field('acceptance',x.kind==='change_order'?'معيار قبول العمل الإضافي':'معيار قبول المخرجات','textarea')];
      return {title:`نقل ${x.code} للملف التجاري`,endpoint:`/estimates/${id}/to-quote`,fields:x.kind==='change_order'?[field('extra_days','أثر المدة بالأيام','number',{min:0,max:3650,value:0}),field('due_date','موعد التسليم','date'),...common]:[field('valid_until','صلاحية العرض','date'),field('tax_rate','نسبة الضريبة %','text',{hint:'تكتبها من مصدرها.'}),field('revisions','جولات المراجعة لكل مخرج','number',{min:0,max:20}),...common],
        toPayload:v=>({case_version:k?.version,acceptance:v.acceptance,...(x.kind==='change_order'?{extra_days:Number(v.extra_days),due_date:v.due_date}:{valid_until:v.valid_until,tax_rate:String(v.tax_rate).trim(),revisions:Number(v.revisions)})})};}
    guard(x.actions.includes(action));
    const spec=(fields,toPayload=v=>v)=>({title:`${estLabels[action]} — ${x.code}`,endpoint:`/estimates/${id}/${estRoutes[action]}`,fields,toPayload:v=>({version:x.version,...toPayload(v)})});
    if(action==='edit_estimate')return spec([field('name','اسم التقدير','text',{value:x.name}),field('scope_note','النطاق والافتراضات','textarea',{value:x.scope_note}),...(x.kind==='change_order'?[field('change_reason','وش تغيّر وليش','textarea',{value:x.change_reason})]:[]),lineRows(client,x)],v=>({name:v.name,scope_note:v.scope_note,change_reason:v.change_reason||'',lines:linesPayload(v.lines)}));
    if(['submit_estimate','withdraw_estimate'].includes(action))return spec([],()=>({}));
    if(action==='handoff_estimate'){guard(client?.cases.length);return {title:`ربط ${x.code} بملف تجاري`,endpoint:`/estimates/${id}/handoff`,fields:[field('case_id','الملف التجاري','select',{options:client.cases.map(c=>({value:c.id,label:`${c.name} (${c.status})`}))}),field('note','ملاحظة','textarea',{required:false})],toPayload:v=>({version:x.version,case_id:v.case_id,note:v.note||''})};}
    if(action==='approve_estimate')return spec([field('note','أساس الاعتماد','textarea'),...(x.margin_available?[]:[field('ack','الهامش غير محسوب','checks',{options:[{value:'yes',label:'أعتمد وأنا عارف إن التكلفة مو متاحة والهامش ما انحسب'}]})])],v=>({note:v.note,...(x.margin_available?{}:{accept_unknown_margin:(v.ack??[]).includes('yes')})}));
    return spec([field('note','سبب الرفض','textarea')],v=>({note:v.note}));
  }
};
