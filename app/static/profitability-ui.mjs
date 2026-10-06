// تكلفة الساعة وربحية المشروع والعميل.
// الشاشة تقول القرار المقصود صراحةً: المعدل بالفئة الوظيفية لا بالشخص، حمايةً لراتب الموظف من الانكشاف،
// وتقول كذلك ما لم تغطه الأرقام — ساعات غير معتمدة، ساعات بلا معدل، تحميل عام غير معتمد — فوق كل رقم.
// البلاطة والجدول والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const hours=minutes=>(minutes/60).toFixed(1);
// نماذج الفترة والتفصيل قراءةٌ لا كتابة: GET بلا جسم (fetch يرفض GET بجسم). المرشح يُبنى في العنوان ويُحفظ للجلسة
// فتقرؤه load عند إعادة رسم الشاشة بعد النموذج، كما يفعل البحث الشامل.
const FILTER_KEY='profitability-filter';
const storedFilter=()=>{try{return JSON.parse(sessionStorage.getItem(FILTER_KEY)??'{}')??{};}catch{return {};}};
const filterPath=filter=>{const query=new URLSearchParams(Object.entries(filter).filter(([,value])=>value)).toString();return query?`/profitability?${query}`:'/profitability';};
const applyFilter=filter=>{try{sessionStorage.setItem(FILTER_KEY,JSON.stringify(filter));}catch{/* تخزين معطّل: المرشح يسري على هذا الطلب وحده */}return filterPath(filter);};
const pct=basisPoints=>basisPoints===null||basisPoints===undefined?'—':`${(basisPoints/100).toFixed(1)}%`;
const tone=basisPoints=>basisPoints===null||basisPoints===undefined?'':basisPoints<0?'is-late':basisPoints<1500?'is-due':'is-ok';

// الرقم والنسبة: معزولان بأرقام جدولية، والسالب بإشارته داخل العزل ومعه كلمته (خسارة)، لا بلونه وحده.
const helpers=(e,money)=>{
  const num=v=>money(v,'').trim(),fig=v=>`<span class="ltr">${e(num(v))}</span>`;
  const loss=v=>v!==null&&v!==undefined&&Number(v)<0;
  return {num,fig,signed:v=>loss(v)?`${fig(v)} <small>خسارة</small>`:fig(v),rate:bp=>`<span class="ltr">${e(pct(bp))}</span>`,tileMoney:v=>loss(v)?`⁦${num(v)}⁩`:num(v),loss};
};
const alerts=(list,e)=>list.length?`<section class="vn-block"><h3>اللي ما تقوله الأرقام بروحها</h3><ul class="vn-list">${list.map(x=>`<li class="is-due"><span>${e(x)}</span></li>`).join('')}</ul></section>`:'';

function summary(data,e,money,ui){
  const {num,tileMoney,loss}=helpers(e,money);
  return `<div class="vn-tiles">
    ${ui.tile(tileMoney(data.margin.amount_minor),loss(data.margin.amount_minor)?'الهامش بالريال — خسارة':'الهامش بالريال',tone(data.margin.bp))}
    ${ui.tile(pct(data.margin.bp),'الهامش بالنسبة',tone(data.margin.bp))}
    ${ui.tile(num(data.revenue.net_minor),'الإيراد بالصافي دون ضريبة بالريال')}
    ${ui.tile(num(data.cost.total_minor),'إجمالي التكلفة بالريال')}
    ${ui.tile(pct(data.hours.billable_bp),'الاستغلال القابل للفوترة')}
    ${ui.tile(`${hours(data.hours.approved_minutes)} س`,'ساعات معتمدة')}</div>`;
}
function breakdown(data,e,money){
  const {fig,signed,rate}=helpers(e,money),f=data.forecast;
  return `<section class="vn-block"><h3>من وين جا الرقم</h3><ul class="vn-list">
      <li><strong>تكلفة الوقت — ${fig(data.cost.time_minor)} ريال</strong><span><span class="ltr">${e(hours(data.coverage.costed_minutes))}</span> ساعة مُكلَّفة بمعدل فئة صاحبها الساري في تاريخ الساعة${data.coverage.blended_hour_minor===null?'':` · متوسط فعلي ${fig(data.coverage.blended_hour_minor)} للساعة`}</span></li>
      <li><strong>المشتريات — ${fig(data.cost.purchases_minor)}</strong><span><span data-num>${e(data.cost.purchase_count)}</span> فاتورة مورد مطابقة</span></li>
      <li><strong>المصروفات — ${fig(data.cost.expenses_minor)}</strong><span><span data-num>${e(data.cost.expense_count)}</span> مطالبة معتمدة ماليًا</span></li>
      <li class="${data.coverage.overhead_applied?'':'is-due'}"><strong>التحميل العام${data.coverage.overhead_applied?` — ${fig(data.cost.overhead_minor)}`:''}</strong><span>${data.coverage.overhead_applied?'بمعدل التحميل المعتمد الساري':'ما فيه معدل تحميل معتمد ساري'}</span></li>
      <li><strong>تغطية الساعات</strong><span>المعتمد ${rate(data.hours.approval_coverage_bp)} من <span class="ltr">${e(hours(data.hours.logged_minutes))}</span> ساعة مسجلة · المُكلَّف ${rate(data.coverage.costed_bp)} من المعتمد</span></li>
      ${data.excluded.unapproved_hours_cost_minor?`<li class="is-due"><strong>برّا الحساب — ${fig(data.excluded.unapproved_hours_cost_minor)}</strong><span>ساعات ما انعتمدت للحين، وما تدخل التكلفة لين تنعتمد.</span></li>`:''}
    </ul></section>
    <section class="vn-block"><h3>حرق الميزانية</h3><ul class="vn-list">
      <li><strong>الميزانية${f.budget_minor===null?'':` — ${fig(f.budget_minor)} ريال`}</strong><span>${f.budget_minor===null?'ما تحددت':''}${f.budget_source==='project_budgets'?'مصدرها مخصصات المشتريات المعتمدة':f.budget_source==='supplied'?'ممرَّرة من برّا الوحدة':''}</span></li>
      <li><strong>المنفق فعلًا — ${fig(f.spent_minor)}</strong><span>${f.elapsed_days?`خلال <span data-num>${e(f.elapsed_days)}</span> يوم من <time datetime="${e(f.first_cost_day)}">${e(f.first_cost_day)}</time>`:''}</span></li>
      <li><strong>المحجوز مستقبلًا${f.committed_future_supplied?` — ${fig(f.committed_future_minor)}`:''}</strong><span>${f.committed_future_supplied?'من تخطيط الموارد':'ما مرّرته وحدة تخطيط الموارد للحين'}</span></li>
      <li><strong>معدل الحرق${f.daily_burn_minor===null?'':` — ${fig(f.daily_burn_minor)} يوميًا`}</strong><span>${f.daily_burn_minor===null?'ما ينحسب بلا إنفاق':''}</span></li>
      <li class="${f.days_to_exhaustion!==null&&f.days_to_exhaustion<30?'is-late':''}"><strong>تنفد الميزانية${f.exhausts_on===null?'':` في <time datetime="${e(f.exhausts_on)}">${e(f.exhausts_on)}</time>`}</strong><span>${f.exhausts_on===null?'ما ينحسب بلا ميزانية أو بلا إنفاق':`بعد <span data-num>${e(f.days_to_exhaustion)}</span> يوم بهالمعدل`}</span></li>
    </ul></section>
    <section class="vn-block"><h3>الهامش عند الاكتمال</h3><ul class="vn-list">
      <li><strong>الإيراد المتوقع${f.expected_revenue_minor===null?'':` — ${fig(f.expected_revenue_minor)} ريال`}</strong><span>${f.expected_revenue_minor===null?'ما فيه قيمة عقد معتمدة':f.expected_revenue_source==='contract_baseline'?'قيمة العقد في خط الأساس':'ممرَّرة من برّا الوحدة'}</span></li>
      <li><strong>كلفة المتبقي المجدول${f.remaining_cost_minor===null?'':` — ${fig(f.remaining_cost_minor)}`}</strong><span>${f.remaining_cost_minor===null?'ما مرّرته وحدة تخطيط الموارد للحين':f.remaining_basis==='supplied_cost'?'ممرَّرة محسوبة':'مقدّرة بمتوسط تكلفة ساعة هالنطاق'}</span></li>
      <li><strong>التكلفة عند الاكتمال — ${fig(f.cost_at_completion_minor)}</strong></li>
      <li class="${tone(f.margin_at_completion_bp)==='is-ok'?'':tone(f.margin_at_completion_bp)}"><strong>الهامش المتوقع${f.margin_at_completion_minor===null?'':` — ${signed(f.margin_at_completion_minor)} (${rate(f.margin_at_completion_bp)})`}</strong>${f.margin_at_completion_minor===null?'<span>ما ينحسب للحين</span>':''}</li>
    </ul></section>`;
}
function detail(data,e,money,ui){
  return `<div class="panel-head"><h2>${e(data.scope==='client'?`ربحية العميل — ${data.client.legal_name}`:`ربحية المشروع — ${data.project.name}`)}</h2>
      <p>من <time datetime="${e(data.period.from)}">${e(data.period.from)}</time> لين <time datetime="${e(data.period.to)}">${e(data.period.to)}</time>${data.scope==='client'?` · <span data-num>${e(data.projects)}</span> مشروع`:''}. ${e(data.revenue.basis)}</p></div>
    ${alerts(data.caveats,e)}${summary(data,e,money,ui)}${breakdown(data,e,money)}`;
}

export const profitabilityUI={
  title:'ربحية المشاريع والعملاء',
  description:'الإيراد من الفواتير الصادرة بالصافي، ناقص تكلفة الساعات المعتمدة بمعدل فئة صاحبها الساري في تاريخ الساعة، ناقص المشتريات والمصروفات والتحميل العام. ما تقرأ من نظام محاسبي خارجي، وما تعرض تكلفة أي فرد.',
  // مرشح محفوظ لسجل لم يعد متاحًا لا يُعطّل الشاشة: يُمسح وتُحمَّل الصورة العامة.
  load:async api=>{const filter=storedFilter();if(!Object.keys(filter).length)return api('/profitability');
    try{return await api(filterPath(filter));}catch{applyFilter({});return api('/profitability');}},
  render(data,{e,button,money,ui=kit(e)}){
    const {fig,signed,rate}=helpers(e,money);
    // الربحية جدولٌ يُقرأ كما يقرؤه المحاسب: الإيراد ثم التكلفة ثم الهامش مبلغًا ونسبة، والخسارة بإشارتها وكلمتها.
    const rows=ui.table({head:['المشروع','الإيراد (ريال)','التكلفة (ريال)','الهامش (ريال)','الهامش','الإجراء'],
      rows:data.rows.map(r=>`<tr class="${tone(r.margin_bp)==='is-ok'?'':tone(r.margin_bp)}"><td>${e(r.name)}<small><span class="ltr">${e(hours(r.approved_minutes))}</span> ساعة معتمدة · اعتماد ${rate(r.approval_coverage_bp)} · قابل للفوترة ${rate(r.billable_bp)} · مُكلَّف ${rate(r.costed_bp)}${r.caveats?` · <span data-num>${e(r.caveats)}</span> تحفظ`:''}${r.family?'':' · بدون عائلة خدمة'}</small></td><td>${fig(r.revenue_minor)}</td><td>${fig(r.cost_minor)}</td><td>${signed(r.margin_minor)}</td><td>${rate(r.margin_bp)}</td><td><div class="operation-actions">${button('view_project',r.id,'التفصيل والتوقع')}${data.can_tag?button('tag_service',r.id,r.family?'تغيير عائلة الخدمة':'وسم عائلة الخدمة'):''}</div></td></tr>`),
      empty:{title:'ما فيه مشاريع في هالكيان',body:'تطلع ربحية المشروع هنا أول ما تصدر له فاتورة أو تنعتمد له ساعات.'}});
    const families=ui.table({head:['عائلة الخدمة','المشاريع','الإيراد (ريال)','الهامش (ريال)','الهامش'],
      rows:data.services.families.map(f=>`<tr class="${tone(f.margin.bp)==='is-ok'?'':tone(f.margin.bp)}"><td>${e(f.family_name)}</td><td><span data-num>${e(f.projects)}</span></td><td>${fig(f.revenue.net_minor)}</td><td>${signed(f.margin.amount_minor)}</td><td>${rate(f.margin.bp)}</td></tr>`),
      empty:{title:'ما فيه مشروع موسوم بعائلة خدمة للحين',body:'الوسم يدوي من جدول المشاريع فوق: «وسم عائلة الخدمة».'}});
    const clients=data.clients.map(c=>`<li><strong>${e(c.legal_name)}</strong><span><bdi dir="ltr">${e(c.code)}</bdi></span><div class="operation-actions">${button('view_client',c.id,'ربحية العميل')}</div></li>`).join('');
    return `<section class="panel panel-body vn-head"><div class="operation-actions">${button('set_period','','تغيير الفترة')}</div><p>${e(data.note)}</p>
        <p>الفترة المعروضة من <time datetime="${e(data.period.from)}">${e(data.period.from)}</time> لين <time datetime="${e(data.period.to)}">${e(data.period.to)}</time>.</p></section>
      ${data.selected?`<section class="vn-block">${detail(data.selected,e,money,ui)}</section>`:''}
      ${data.selected_client?`<section class="vn-block">${detail(data.selected_client,e,money,ui)}</section>`:''}
      <section class="vn-block"><div class="panel-head"><h2>المشاريع</h2></div>${rows}</section>
      <section class="vn-block"><div class="panel-head"><h2>الربحية بعائلة الخدمة</h2></div>${alerts(data.services.caveats,e)}${families}</section>
      <section class="vn-block"><div class="panel-head"><h2>العملاء</h2></div>${clients?`<ul class="vn-list">${clients}</ul>`:'<p class="subtle">ما فيه ملفات عملاء — تنضاف من «العملاء».</p>'}</section>`;
  },
  form(action,id,data){
    if(action==='set_period')return {title:'فترة التقرير',endpoint:'/profitability',method:'GET',
      fields:[field('from','من تاريخ','date',{required:false,value:data.period.from}),field('to','لين تاريخ','date',{required:false,value:data.period.to})],
      dynamicEndpoint:value=>applyFilter({from:value.from||'',to:value.to||''}),toPayload:()=>undefined};
    if(action==='view_project'){const row=data.rows.find(r=>r.id===id);guard(row);
      return {title:`ربحية — ${row.name}`,endpoint:'/profitability',method:'GET',
        fields:[field('from','من تاريخ','date',{required:false,value:data.period.from}),field('to','لين تاريخ','date',{required:false,value:data.period.to})],
        dynamicEndpoint:value=>applyFilter({project_id:id,from:value.from||'',to:value.to||''}),toPayload:()=>undefined};}
    if(action==='view_client'){const client=data.clients.find(c=>c.id===id);guard(client);
      return {title:`ربحية العميل — ${client.legal_name}`,endpoint:'/profitability',method:'GET',
        fields:[field('from','من تاريخ','date',{required:false,value:data.period.from}),field('to','لين تاريخ','date',{required:false,value:data.period.to})],
        dynamicEndpoint:value=>applyFilter({client_id:id,from:value.from||'',to:value.to||''}),toPayload:()=>undefined};}
    if(action==='tag_service'){const row=data.rows.find(r=>r.id===id);guard(row&&data.can_tag);
      return {title:`عائلة الخدمة — ${row.name}`,endpoint:'/profitability/tags',idempotent:true,
        fields:[field('family','عائلة الخدمة','select',{value:row.family??'',options:data.families.map(f=>({value:f.family??f.key,label:f.name}))}),
          field('note','سند الوسم','textarea',{required:false,hint:'الوسم يدوي؛ المنصة ما تستنتج نوع الخدمة من المشروع، والمشروع اللي بلا وسم ما يدخل أي عائلة.'})],
        toPayload:value=>({project_id:id,family:value.family,note:value.note||'',version:row.tag_version??undefined})};}
    guard(false);
  }
};

export const costRatesUI={
  title:'معدلات تكلفة الساعة',
  description:'معدل تكلفة الساعة لكل فئة وظيفية، بنسخ مؤرخة يدخلها صاحب الإجراء بمصدرها ويعتمدها شخص ثاني. المعدل ما ينربط بشخص وما ينشتق من الرواتب، والنسخة المعتمدة ما تتعدل بأثر رجعي.',
  load:api=>api('/cost-rates'),
  render(data,{e,button,money,ui=kit(e)}){
    const {fig}=helpers(e,money);
    const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
    const categoryName=id=>data.categories.find(c=>c.id===id)?.name??'—';
    const categories=data.categories.map(c=>`<li class="${c.active?(c.live_rate?'':'is-due'):'is-old'}"><strong>${e(c.name)} · <bdi dir="ltr">${e(c.code)}</bdi>${c.live_rate?` — ${fig(c.live_rate.rate_minor)} ريال للساعة`:''}</strong>${c.active?'':'<span class="badge inactive">موقوفة</span>'}
      <span>${c.live_rate?`المعدل الساري من ${day(c.live_rate.effective_from)}`:'ما فيه معدل معتمد ساري — ساعات هالفئة غير مُكلَّفة'}</span>
      <small><span data-num>${e(c.people)}</span> من الفريق في هالفئة اليوم${c.description?` · ${e(c.description)}`:''}</small>
      <div class="operation-actions">${button('new_rate',c.id,'معدل جديد مؤرخ')}${button('assign',c.id,'إسناد شخص للفئة')}${button(c.active?'deactivate_category':'activate_category',c.id,c.active?'إيقاف الفئة':'تفعيل الفئة')}</div></li>`).join('');
    // النسخة المؤرخة: قيمتها ثم حالها شكلًا وكلمة، ثم سريانها ومصدرها. المسودة التي تنتظر قرار القارئ بعلامة «دورك».
    const version=(r,title,approve,reject)=>{const yours=r.actions.includes(approve);
      return `<li class="${yours?'is-decision':r.status==='draft'?'is-pending':r.status==='rejected'?'is-old':''}"><strong>${title}</strong><span class="badge ${yours?'is-decision':r.status==='approved'?'approved':r.status==='draft'?'pending':'rejected'}">${e(yours?'ينتظر اعتمادك':r.status_name)}</span>
      <span>يسري من ${day(r.effective_from)}${r.status==='draft'?` · أعدّه ${e(r.prepared_by_name)}، ويعتمده غيره`:''}</span>
      <small class="measure">المصدر: ${e(r.source)}</small>
      ${yours?`<div class="operation-actions">${button(approve,r.id,'اعتماد')}${button(reject,r.id,'رفض')}</div>`:''}</li>`;};
    const rateRow=r=>version(r,`${e(categoryName(r.category_id))} — ${e(r.rate)} ريال للساعة`,'approve_rate','reject_rate');
    const overheadRow=r=>version(r,`${e(r.method_name)} — ${e(r.method==='per_hour'?`${r.rate} ريال للساعة`:`${r.percent}%`)}`,'approve_overhead','reject_overhead');
    const waiting=[...data.rates.filter(r=>r.actions.includes('approve_rate')).map(rateRow),...data.overhead.filter(r=>r.actions.includes('approve_overhead')).map(overheadRow)].join('');
    const rates=data.rates.filter(r=>!r.actions.includes('approve_rate')).map(rateRow).join(''),overhead=data.overhead.filter(r=>!r.actions.includes('approve_overhead')).map(overheadRow).join('');
    const assignments=data.assignments.map(a=>`<li><strong>${e(a.user_name)} — ${e(a.category_name)}</strong><span>من ${day(a.effective_from)}</span><small class="measure">${e(a.basis)}</small></li>`).join('');
    const benchmark=!data.benchmark?'':`<section class="vn-block"><h3>مرجع مجمّع من الرواتب</h3>${data.benchmark.available
      ?`<p class="subtle measure">${e(data.benchmark.note)}</p><ul class="vn-list"><li><strong>متوسط التكلفة الشهرية — ${fig(data.benchmark.average_monthly_minor)} ريال</strong><span>عن <span data-num>${e(data.benchmark.people)}</span> عقد ساري</span></li>${data.benchmark.groups.map(g=>`<li><strong>${e(g.category_name)} — ${fig(g.average_monthly_minor)}</strong><span>عن <span data-num>${e(g.people)}</span> أشخاص</span></li>`).join('')}</ul>`
      :`<p class="subtle measure">${e(data.benchmark.reason)}</p>`}</section>`;
    const block=(title,body)=>`<section class="vn-block"><div class="panel-head"><h2>${e(title)}</h2></div>${body}</section>`;
    return `<section class="panel panel-body vn-head"><div class="operation-actions">${button('new_category','','فئة وظيفية جديدة')}${button('new_overhead','','معدل تحميل عام مؤرخ')}</div><p>${e(data.note)}</p></section>
      ${data.uncategorised.length?`<div class="vn-alert is-due"><strong><span data-num>${e(data.uncategorised.length)}</span> من الفريق بدون فئة وظيفية اليوم.</strong><p class="measure">ساعاتهم ما تتكلّف، وتطلع «غير مُكلَّفة» في كل تقرير ربحية: ${data.uncategorised.map(p=>e(p.name)).join('، ')}.</p></div>`:''}
      ${waiting?block('ينتظر اعتمادك',`<ul class="vn-list">${waiting}</ul>`):''}
      ${block('الفئات الوظيفية',categories?`<ul class="vn-list">${categories}</ul>`:'<p class="subtle">ما فيه فئات للحين. ابدأ بفئة يعرّفها صاحب الإجراء، مثل «مصمم أول».</p>')}
      ${block('معدل الساعة — النسخ المؤرخة',rates?`<ul class="vn-list">${rates}</ul>`:'<p class="subtle">ما فيه نسخ غير اللي تنتظر اعتمادك.</p>')}
      ${block('التحميل العام',`${data.live_overhead?'':'<div class="vn-alert is-due"><strong>ما فيه معدل تحميل عام معتمد ساري.</strong><p>الهوامش في تقارير الربحية قبل المصاريف العمومية لين ينعتمد معدل.</p></div>'}${overhead?`<ul class="vn-list">${overhead}</ul>`:'<p class="subtle">ما فيه معدلات تحميل غير اللي تنتظر اعتمادك.</p>'}`)}
      ${block('إسناد الفئات',`${benchmark}${assignments?`<ul class="vn-list">${assignments}</ul>`:'<p class="subtle">ما فيه إسنادات للحين — كل شخص ينسند لفئته من «إسناد شخص للفئة».</p>'}`)}`;
  },
  form(action,id,data){
    const category=data.categories.find(c=>c.id===id);
    if(action==='new_category')return {title:'فئة وظيفية جديدة',endpoint:'/cost-rates/categories',idempotent:true,
      fields:[field('code','رمز الفئة'),field('name','اسم الفئة',"text",{hint:'مثل: مصمم أول، منتج، مدير حساب. الفئة وصف للدور مو لشخص.'}),field('description','الوصف','textarea',{required:false})],
      toPayload:value=>({code:value.code,name:value.name,description:value.description||''})};
    if(action==='new_overhead')return {title:'معدل تحميل عام مؤرخ',endpoint:'/cost-rates/overhead',idempotent:true,
      fields:[field('effective_from','سريان من','date'),
        field('method','طريقة التحميل','select',{options:Object.entries(data.methods).map(([value,label])=>({value,label}))}),
        field('rate_amount','المبلغ لكل ساعة (بالريال)','number',{required:false,hint:'ينعبّى مع طريقة المبلغ الثابت بس.'}),
        field('percent','النسبة من التكلفة المباشرة (%)','number',{required:false,hint:'تنعبّى مع طريقة النسبة بس.'}),
        field('source','مصدر المعدل وكيف انحسب','textarea',{hint:'ما فيه قيمة جاهزة: اكتب من وين جا الرقم ومتى تأكد. التحميل بالمبلغ يسري على الساعات بس، وبالنسبة يسري على الساعات والمشتريات والمصروفات.'})],
      toPayload:value=>({effective_from:value.effective_from,method:value.method,rate_amount:value.rate_amount||'',percent:value.percent||'',source:value.source})};
    if(action==='new_rate'){guard(category);
      return {title:`معدل ساعة — ${category.name}`,endpoint:'/cost-rates/rates',idempotent:true,
        fields:[field('effective_from','سريان من','date',{hint:'النسخة المعتمدة ما تتعدل بأثر رجعي: الساعات اللي قبل هالتاريخ تبقى بمعدلها القديم.'}),
          field('rate_amount','تكلفة الساعة (بالريال)','number'),
          field('source','مصدر المعدل وكيف انحسب','textarea',{hint:'المعدل بالفئة مو بالشخص، عشان ما ينكشف راتب أحد في تقارير الربحية. اكتب أساس الرقم ومين أقرّه ومتى، ولا تنسخه من راتب شخص.'})],
        toPayload:value=>({category_id:id,effective_from:value.effective_from,rate_amount:value.rate_amount,source:value.source})};}
    if(action==='assign'){guard(category);
      return {title:`إسناد للفئة — ${category.name}`,endpoint:'/cost-rates/assignments',idempotent:true,
        fields:[field('user_id','الشخص','select',{options:data.people.map(p=>({value:p.id,label:p.name}))}),
          field('effective_from','سريان من','date',{hint:'الإسناد مؤرخ: الساعة اللي انسجلت قبل هالتاريخ تنحسب تكلفتها بفئته السابقة.'}),
          field('basis','سند الإسناد','textarea')],
        toPayload:value=>({user_id:value.user_id,category_id:id,effective_from:value.effective_from,basis:value.basis})};}
    if(action==='activate_category'||action==='deactivate_category'){guard(category);
      return {title:action==='activate_category'?`تفعيل الفئة — ${category.name}`:`إيقاف الفئة — ${category.name}`,endpoint:`/cost-rates/categories/${id}/${action}`,
        fields:[field('reason','سبب التغيير','textarea')],toPayload:value=>({version:category.version,reason:value.reason})};}
    const rate=data.rates.find(r=>r.id===id),over=data.overhead.find(r=>r.id===id);
    if(action==='approve_rate'||action==='reject_rate'){guard(rate&&rate.actions.includes(action));
      return {title:action==='approve_rate'?'اعتماد معدل الساعة':'رفض معدل الساعة',endpoint:`/cost-rates/rates/${id}/${action}`,
        fields:[field('note','أساس القرار','textarea',{hint:'اللي أدخل المعدل ما يعتمده. المعتمد نهائي وما يتعدل؛ تغييره يكون بنسخة جديدة بتاريخ سريان جديد.'})],
        toPayload:value=>({version:rate.version,note:value.note})};}
    if(action==='approve_overhead'||action==='reject_overhead'){guard(over&&over.actions.includes(action));
      return {title:action==='approve_overhead'?'اعتماد معدل التحميل':'رفض معدل التحميل',endpoint:`/cost-rates/overhead/${id}/${action}`,
        fields:[field('note','أساس القرار','textarea')],toPayload:value=>({version:over.version,note:value.note})};}
    guard(false);
  }
};
