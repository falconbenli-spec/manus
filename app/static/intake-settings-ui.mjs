// مقياس الأثر والعجلة ومصفوفة الأولوية: تعريف مالك إجراء الخدمات، لا افتراض من المنصة.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const dimensions={impact:'الأثر',urgency:'العجلة'};

export const intakeSettingsUI={
  title:'مقاييس استقبال الطلبات',
  description:'درجات الأثر والعجلة، والأولوية اللي تطلع من تقاطعها، والزمن المستهدف لكل أولوية، يحطّها مالك إجراء الخدمات بسندها. وأولوية الطلب تتجمّد لما يتقدّم، فما يغيّرها تعديل لاحق على المصفوفة.',
  load:api=>api('/intake/settings'),
  render(data,{e,button,ui}){
    const scaleList=rows=>rows.length?`<ul class="vn-list">${rows.map(s=>`<li><strong>${e(s.name)}</strong><span>الرمز <bdi>${e(s.code)}</bdi> · الترتيب ${e(s.rank)}</span><small>${e(s.guidance)}</small><small>السند: ${e(s.basis)}</small></li>`).join('')}</ul>`:'<p class="subtle">ما فيه درجات معرّفة للحين.</p>';
    // المصفوفة جدولٌ ذو بعدين: الأثر صفوفًا والعجلة أعمدة، وكل خانة أولويتها وزمنها وسندها. كانت قائمةً من سطر لكل تقاطع
    // تُقرأ «أ × ب» سطرًا سطرًا؛ والجدول يُقرأ بالعين صفًّا وعمودًا، وعلى الجوال يصير كل صف أثرٍ سجلًّا بأسماء أعمدته.
    const cell=(i,g)=>{
      const found=data.cells.find(c=>c.impact_code===i.code&&c.urgency_code===g.code);
      return found
        ?`<td><strong>${e(found.priority)}</strong><br><small>زمن ${found.target_days===null?'من الخدمة':`${e(found.target_days)} أيام عمل`}</small><br><small class="subtle">السند: ${e(found.basis)}</small></td>`
        :'<td><span class="badge is-warn">ما تعرّفت</span></td>';
    };
    const grid=data.impact.length&&data.urgency.length
      ? '<p class="subtle">الصفوف درجات الأثر، والأعمدة درجات العجلة.</p>'+ui.table({head:['الأثر',...data.urgency.map(g=>g.name)],rows:data.impact.map(i=>`<tr><td><strong>${e(i.name)}</strong></td>${data.urgency.map(g=>cell(i,g)).join('')}</tr>`)}).replace(/<th>/g,'<th scope="col">')
      : '<p class="subtle">عرّف درجات الأثر والعجلة أول، وبعدها عبّ كل تقاطع بينها.</p>';
    const gaps=data.missing.length?`<div class="vn-alert is-warn"><strong>تقاطعات بلا أولوية (${e(data.missing.length)})</strong><ul>${data.missing.map(m=>`<li>${e(m.impact)} × ${e(m.urgency)}</li>`).join('')}</ul><p>ما دام فيه تقاطع واحد فاضي، ممكن يوصل طلب بلا أولوية ويوقف عند بوابة التقديم.</p></div>`:'';
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <p><span class="badge ${data.configured?'approved':''}">${data.configured?'المصفوفة مفعّلة: الأثر والعجلة مطلوبان قبل تقديم أي طلب':'المصفوفة غير معرّفة: الطلبات تمشي بزمن الخدمة بس'}</span></p>
      ${data.can_manage?`<div class="operation-actions">${button('define_scale','','درجة جديدة')}${button('set_cell','','تعريف تقاطع')}</div>`:''}</section>
      ${gaps}
      <section class="vn-board"><section class="vn-block"><h2>${dimensions.impact}</h2>${scaleList(data.impact)}</section>
      <section class="vn-block"><h2>${dimensions.urgency}</h2>${scaleList(data.urgency)}</section>
      <section class="vn-block"><h2>الأولوية عند كل تقاطع</h2>${grid}</section></section>`;
  },
  form(action,id,data){
    guard(data.can_manage);
    if(action==='define_scale')return {title:'درجة جديدة',endpoint:'/intake/scales',idempotent:true,fields:[
      field('dimension','البعد','select',{options:Object.entries(dimensions).map(([value,label])=>({value,label}))}),
      field('code','الرمز','text',{hint:'رمز قصير بالإنجليزية يبقى ثابتًا، مثل wide أو single.'}),
      field('name','الاسم كما يراه الموظف'),
      field('rank','الترتيب (1 هو الأشد)','number',{min:1,max:9}),
      field('guidance','متى تُختار هذه الدرجة','textarea',{hint:'اكتبها بلغة الموظف: مثال ملموس من عمل الشركة يميّزها عن الدرجة التي تليها.'}),
      field('basis','من عرّف هذه الدرجة ومتى','textarea',{hint:'اسم مالك الإجراء وتاريخ إقرارها؛ مقياس الأثر في شركتكم يحطّه أهلها.'})
    ],toPayload:v=>({...v,rank:Number(v.rank)})};
    return {title:'أولوية تقاطع',endpoint:'/intake/matrix',idempotent:true,fields:[
      field('impact_code','درجة الأثر','select',{options:data.impact.map(s=>({value:s.code,label:s.name}))}),
      field('urgency_code','درجة العجلة','select',{options:data.urgency.map(s=>({value:s.code,label:s.name}))}),
      field('priority','اسم الأولوية','text',{hint:'مثل: حرجة، مرتفعة، عادية.'}),
      field('priority_rank','ترتيب الأولوية (1 هو الأشد)','number',{min:1,max:9}),
      field('target_days','الزمن المستهدف بأيام العمل','number',{required:false,min:0,max:120,hint:'اتركه فاضي ويبقى زمن الخدمة بس. ولما يجتمع الزمنان ينوخذ الأضيق.'}),
      field('basis','سند هذا التقاطع','textarea')
    ],toPayload:v=>({...v,priority_rank:Number(v.priority_rank),target_days:v.target_days===''?null:Number(v.target_days)})};
  }
};
