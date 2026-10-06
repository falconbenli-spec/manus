// جولات المراجعة والتعليق على المادة. المعاينة من مسار داخلي فقط؛ لا مورد خارجي ولا سكربت ولا تنسيق مضمّن.
// طبقة التعليقات فوق المادة تحتاج موضعًا نسبيًا، وهو يستلزم CSS مضمّنًا محظورًا هنا؛
// فتُعرض التعليقات قائمةً مرقّمة بجانب المادة مع موضعها مكتوبًا، والـCSP تبقى صارمة.
// البلاطة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const clean=values=>Object.fromEntries(Object.entries(values).filter(([,x])=>x!==''&&x!==undefined&&x!==null));
const routeOf=(data,id)=>{const r=data.routes.find(x=>x.id===id);guard(r);return r;};

// المادة نفسها: الصورة نصّها البديل وصفها، والفيديو والصوت والـPDF باسم المادة للقارئ الآلي، والنص بطول سطر مريح.
function mediaBlock(m,e){
  const head=`<h3>${e(m.label)} — ${e(m.kind_name)}</h3>`;
  const view=m.kind==='image'?`<img src="${e(m.preview_path)}" alt="${e(m.label)}">`
    :m.kind==='pdf'?`<iframe src="${e(m.preview_path)}" title="${e(m.label)}"></iframe>`
    :m.kind==='video'?`<video controls src="${e(m.preview_path)}" aria-label="${e(m.label)}"></video>`
    :m.kind==='audio'?`<audio controls src="${e(m.preview_path)}" aria-label="${e(m.label)}"></audio>`
    :`<p class="measure">${e(m.body??'').replace(/\n/g,'<br>')}</p>`;
  const notes=m.annotations.length?`<ol class="vn-list">${m.annotations.map((a,index)=>`<li class="${a.status==='open'?'is-pending':''}"><strong>${index+1}. ${e(a.place)}</strong><span>${e(a.body)}</span><span class="subtle">${e(a.visibility_name)} · ${e(a.status_name)}${a.resolution_note?` · ${e(a.resolution_note)}`:''} · ${e(a.created_by_name)}</span></li>`).join('')}</ol>`
    :'<p class="subtle">ما فيه تعليقات على هالمادة للحين.</p>';
  return `<section class="vn-block">${head}${view}${notes}</section>`;
}
// المرحلة اللي تنتظر قرارك علامتها «دورك»، والمتأخرة علامتها التأخر — مع الكلمة نفسها في السطر.
function stageList(route,e,button){
  return `<section class="vn-block"><h3>المراحل</h3><ol class="vn-list">${route.stages.map(s=>`<li class="${s.actions.includes('decide')?'is-decision':s.overdue?'is-late':''}"><strong>${e(s.position)} · ${e(s.name)}</strong><span>${e(s.audience_name)} · ${e(s.status_name)}${s.due_on?` · الموعد ${e(s.due_on)}`:''}${s.overdue?' · متأخرة':''}</span>
    <span class="subtle">المراجعين: ${s.reviewers.map(r=>e(r.name)).join('، ')||'—'}${s.due_note?` · ${e(s.due_note)}`:''}</span>
    ${s.decision?`<span class="badge">${e(s.decision.decision_name)}</span><span>${e(s.decision.meaning)}</span><span class="subtle">${e(s.decision.note)}</span>`:''}
    ${s.actions.includes('decide')?`<div class="operation-actions">${button('decide',route.id,`قرارك على «${s.name}»`)}</div>`:''}</li>`).join('')}</ol></section>`;
}
function compareBlock(c,e){
  if(!c.previous)return `<section class="vn-block"><h3>مقارنة النسخ</h3><p class="subtle">${e(c.note)}</p></section>`;
  const row=(label,a,b)=>`<div><dt>${e(label)}</dt><dd>${e(a)} ← ${e(b)}</dd></div>`;
  return `<section class="vn-block"><h3>مقارنة النسختين</h3>
    <dl class="detail-data"><div><dt>السابقة</dt><dd>نسخة ${e(c.previous.revision)} · ${e(c.previous.created_by_name)} · ${e(c.previous.created_at)}</dd></div><div><dt>الحالية</dt><dd>نسخة ${e(c.current.revision)} · ${e(c.current.created_by_name)} · ${e(c.current.created_at)}</dd></div></dl>
    ${c.differences.length?`<dl class="detail-data">${c.differences.map(d=>row(d.field,d.previous,d.current)).join('')}</dl>`:'<p class="subtle">ما فيه فرق في البيانات الوصفية بين النسختين.</p>'}
    <p class="subtle">${e(c.note)}</p></section>`;
}
// المسار سجلٌ بعنوانه (h2)، ثم حقائقه، ثم مراحله وأزرار القرار فيها، ثم أفعاله، ثم المادة والمقارنة.
function routeCard(route,e,button){
  const flag=route.status==='changes_required'?'is-late':route.status==='running'?'is-due':'is-ok';
  const actions=[route.actions.includes('add_media')?button('add_media_file',route.id,'إضافة ملف للمراجعة')+button('add_media_text',route.id,'إضافة نص للمراجعة'):'',
    route.actions.includes('annotate')?button('annotate',route.id,'تعليق على موضع'):'',route.actions.includes('notify')?button('notify',route.id,'تذكير وتصعيد'):'',
    route.actions.includes('save_template')?button('save_template',route.id,'حفظ المسار قالب'):'',button('client_pack',route.id,'حزمة العميل المشتركة'),
    route.actions.includes('cancel')?button('cancel',route.id,'إلغاء المسار'):''].join('');
  return `<section class="panel panel-body">
    <div class="panel-head"><h2>${e(route.name)}</h2><span class="badge ${flag}">${e(route.status_name)}</span></div>
    <dl class="detail-data"><div><dt>المخرج</dt><dd>${e(route.studio_title)} · نسخة ${e(route.output_revision)}</dd></div><div><dt>المشروع</dt><dd>${e(route.project_name)}</dd></div>
      <div><dt>مالك الملف</dt><dd>${e(route.owner_name)}</dd></div><div><dt>انفتح</dt><dd>${e(route.opened_at)}</dd></div>
      <div><dt>التعليقات</dt><dd>${e(route.counts.shared)} مشترك · ${e(route.counts.internal)} داخلي · ${e(route.counts.open)} مفتوح</dd></div></dl>
    ${stageList(route,e,button)}
    <div class="operation-actions">${actions}</div>
    ${route.media.map(m=>mediaBlock(m,e)).join('')||'<p class="subtle">ما انضافت مادة للمراجعة للحين.</p>'}
    ${compareBlock(route.compare,e)}
  </section>`;
}
function stageRows(data){
  return {name:'stages',label:'مراحل المسار',type:'rows',minRows:1,maxRows:20,
    hint:'الترتيب يحدد التسلسل؛ المراحل اللي لها نفس الترتيب وأسماؤها مختلفة تشتغل مع بعض. صفّين بنفس الترتيب والاسم = مراجعَين لمرحلة وحدة. اترك المدد فاضية إذا ما اتفقتوا عليها: بدون مدة ما فيه موعد ولا تذكير ولا تصعيد.',
    columns:[{name:'position',label:'الترتيب',type:'number',min:1,max:20,value:1},{name:'name',label:'اسم المرحلة'},
      {name:'audience',label:'الجمهور',type:'select',options:Object.entries(data.audiences).map(([value,label])=>({value,label}))},
      {name:'reviewer_id',label:'المراجع',type:'select',options:data.people.map(p=>({value:p.id,label:p.name}))},
      {name:'due_days',label:'مهلة (أيام عمل)',type:'number',min:1,max:365,required:false},
      {name:'reminder_days',label:'تذكير قبل (أيام)',type:'number',min:1,max:365,required:false},
      {name:'escalation_days',label:'تصعيد بعد (أيام)',type:'number',min:1,max:365,required:false}]};
}
function groupStages(rows){
  const byKey=new Map();
  for(const row of rows){
    const key=`${row.position}·${String(row.name||'').trim()}`;
    const stage=byKey.get(key)??{position:Number(row.position),name:String(row.name||'').trim(),audience:row.audience,reviewer_ids:[],
      due_days:row.due_days??null,reminder_days:row.reminder_days??null,escalation_days:row.escalation_days??null};
    if(row.reviewer_id&&!stage.reviewer_ids.includes(row.reviewer_id))stage.reviewer_ids.push(row.reviewer_id);
    byKey.set(key,stage);
  }
  return [...byKey.values()];
}
function packView(pack,e){
  const list=(tag,items,none,body)=>items.length?`<${tag} class="vn-list">${items.map(body).join('')}</${tag}>`:`<p class="subtle">${none}</p>`;
  return `<div class="vn-alert"><strong>${e(pack.disclaimer)}</strong></div>
    <dl class="detail-data"><div><dt>المسار</dt><dd>${e(pack.route_name)}</dd></div><div><dt>النسخة</dt><dd>${e(pack.output_revision)}</dd></div></dl>
    <section class="vn-block"><h3>المواد</h3>${list('ul',pack.media,'ما فيه مواد',m=>`<li><strong>${e(m.label)}</strong><span>${e(m.kind_name)}</span></li>`)}</section>
    <section class="vn-block"><h3>التعليقات المشتركة بس</h3>${list('ol',pack.shared_annotations,'ما فيه تعليقات مشتركة',a=>`<li><strong>${e(a.media_label)} · ${e(a.place)}</strong><span>${e(a.body)}</span><span class="subtle">${e(a.status_name)}</span></li>`)}</section>
    <section class="vn-block"><h3>مراحل العميل</h3>${list('ul',pack.client_stages,'ما فيه مرحلة عميل في هالمسار',s=>`<li><strong>${e(s.name)}</strong><span>${e(s.status_name)}${s.decision_name?` · ${e(s.decision_name)}`:''}</span><span class="subtle">${s.documented_approval_id?`على سجل موافقة خارجية موثق: <bdi>${e(s.documented_approval_id)}</bdi>`:'ما صدر قرار موثق للحين'}</span></li>`)}</section>
    <div class="form-actions"><button class="btn outline" type="button" data-action="close">إغلاق</button></div>`;
}

export const reviewRoundsUI={
  title:'جولات المراجعة',
  description:'مسار مراجعة بمراحل على نسخة محددة من مخرج الاستوديو، بثلاث قرارات: موافق · موافق مع تعديلات · تعديلات مطلوبة. قرار العميل يتوثق داخليًا: ما فيه رابط مراجعة للعميل ولا بريد.',
  load:api=>api('/review-rounds'),
  render(data,{e,button,ui=kit(e)}){
    const running=data.routes.filter(r=>r.status==='running'),changes=data.routes.filter(r=>r.status==='changes_required');
    const open=data.routes.reduce((sum,r)=>sum+r.counts.open,0);
    const kinds={review_stage_opened:'انفتحت مرحلة تنتظر قرارك',review_due_reminder:'تذكير: موعد المرحلة قرّب',review_stage_escalated:'تصعيد: وقفت مرحلة في ملف تملكه'};
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <div class="operation-actions">${data.candidates.length?button('new_route','','فتح مسار مراجعة لنسخة'):''}</div>
      ${data.notices.length?`<div class="vn-alert is-due"><strong>تنبيهات المراجعة (${e(data.notices.length)})</strong><ul class="vn-list">${data.notices.map(n=>`<li class="is-decision"><strong>${e(n.route_name)} · ${e(n.stage_name)}</strong><span>${e(kinds[n.kind]??n.kind)}${n.due_on?` · الموعد ${e(n.due_on)}`:''}</span></li>`).join('')}</ul></div>`:''}</section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(data.routes.length,'مسار مراجعة')}${ui.tile(running.length,'جاري',running.length?'is-due':'')}${ui.tile(changes.length,'تعديلات مطلوبة',changes.length?'is-late':'')}${ui.tile(open,'تعليق مفتوح',open?'is-due':'')}${ui.tile(data.templates.length,'قالب محفوظ')}${ui.tile(data.candidates.length,'نسخة بدون مسار')}</div></section>
      ${data.routes.map(r=>routeCard(r,e,button)).join('')||ui.empty('ما فيه مسارات مراجعة في مشاريعك للحين','أول ما تنفتح مراجعة على نسخة مخرج من الاستوديو تطلع هنا بمراحلها وتعليقاتها.')}`;
  },
  form(action,id,data){
    if(action==='new_route'){
      guard(data.candidates.length&&data.people.length);
      return {title:'فتح مسار مراجعة',endpoint:'/review-rounds',idempotent:true,
        fields:[field('output_version_id','نسخة المخرج','select',{options:data.candidates.map(c=>({value:c.version_id,label:`${c.studio_title} · ${c.title} · نسخة ${c.revision} · أعدّها ${c.author_name}`}))}),
          field('name','اسم المسار'),
          field('owner_id','مالك الملف (له يتصعّد توقف أي مرحلة)','select',{options:data.people.filter(p=>p.id!==data.user_id).map(p=>({value:p.id,label:p.name})),hint:'ما يكون اللي يفتح المسار.'}),
          field('template_id','قالب محفوظ (اختياري)','select',{required:false,options:[{value:'',label:'بدون قالب — أحدد المراحل يدويًا'},...data.templates.map(t=>({value:t.id,label:t.name}))],hint:'إذا اخترت قالب تنأخذ مراحله ومراجعينه ومدده زي ما هي، والجدول اللي تحت ما ينحسب.'}),
          stageRows(data)],
        toPayload:v=>({output_version_id:v.output_version_id,name:v.name,owner_id:v.owner_id,template_id:v.template_id||'',stages:v.template_id?[]:groupStages(v.stages||[])})};
    }
    const route=routeOf(data,id);
    if(action==='client_pack')return {title:`حزمة العميل — ${route.name}`,endpoint:`/review-rounds/${id}/client-pack`,fields:[],toPayload:()=>({}),
      after:(saved,e)=>({title:'اللي يجوز يوصل العميل',html:packView(saved,e)})};
    if(action==='add_media_file'){
      guard(route.actions.includes('add_media'));
      return {title:'إضافة ملف للمراجعة',endpoint:`/review-rounds/${id}/add_media`,idempotent:true,
        fields:[field('kind','نوع المادة','select',{options:[['image','صورة'],['pdf','ملف PDF'],['video','فيديو'],['audio','صوت']].map(([value,label])=>({value,label}))}),
          field('label','وصف المادة'),field('content','الملف','file',{hint:'PNG أو JPEG أو PDF أو MP4 أو MP3، لين 2 ميغابايت.'}),
          field('pages','عدد صفحات الـPDF','number',{required:false,min:1,max:2000,hint:'مطلوب لملفات PDF.'}),
          field('duration_seconds','مدة الفيديو أو الصوت بالثواني','number',{required:false,min:1,max:86400,hint:'اتركها فاضية إذا ما تعرفها.'})],
        toPayload:v=>clean({version:route.version,kind:v.kind,label:v.label,content:v.content,pages:v.pages?Number(v.pages):'',duration_seconds:v.duration_seconds?Number(v.duration_seconds):''})};
    }
    if(action==='add_media_text'){
      guard(route.actions.includes('add_media'));
      return {title:'إضافة نص للمراجعة',endpoint:`/review-rounds/${id}/add_media`,idempotent:true,
        fields:[field('label','وصف المادة'),field('body','النص اللي ينراجع','textarea',{maxLength:20000,hint:'ينحفظ زي ما هو وما يتغير بعد إضافته، لأن مواضع التعليقات تنحسب عليه.'})],
        toPayload:v=>({version:route.version,kind:'text',label:v.label,body:v.body})};
    }
    if(action==='annotate'){
      guard(route.actions.includes('annotate'));
      return {title:'تعليق على موضع في المادة',endpoint:`/review-rounds/${id}/annotate`,idempotent:true,
        fields:[field('media_id','المادة','select',{options:route.media.map(m=>({value:m.id,label:`${m.label} (${m.kind_name})`}))}),
          field('visibility','الجمهور','select',{options:[{value:'internal',label:'داخلي — ما يطلع للعميل أبد'},{value:'shared',label:'مشترك — يجوز يوصل للعميل'}]}),
          field('body','نص التعليق','textarea'),
          field('x','الموضع الأفقي (0 إلى 1)','number',{required:false,min:0,max:1,step:'0.001',hint:'للصورة وPDF: نسبة من العرض.'}),
          field('y','الموضع الرأسي (0 إلى 1)','number',{required:false,min:0,max:1,step:'0.001'}),
          field('page','رقم الصفحة','number',{required:false,min:1,max:2000,hint:'لملفات PDF بس.'}),
          field('at_seconds','الطابع الزمني بالثواني','number',{required:false,min:0,step:'0.1',hint:'للفيديو والصوت.'}),
          field('char_start','بداية مدى الأحرف','number',{required:false,min:0,hint:'للنص.'}),
          field('char_end','نهاية مدى الأحرف','number',{required:false,min:1}),
          field('stage_id','المرحلة المرتبطة (اختياري)','select',{required:false,options:[{value:'',label:'بدون مرحلة'},...route.stages.map(s=>({value:s.id,label:`${s.position} · ${s.name}`}))]})],
        toPayload:v=>clean({version:route.version,media_id:v.media_id,visibility:v.visibility,body:v.body,stage_id:v.stage_id,
          x:v.x===''?'':Number(v.x),y:v.y===''?'':Number(v.y),page:v.page===''?'':Number(v.page),
          at_seconds:v.at_seconds===''?'':Number(v.at_seconds),char_start:v.char_start===''?'':Number(v.char_start),char_end:v.char_end===''?'':Number(v.char_end)})};
    }
    if(action==='decide'){
      const open=route.stages.filter(s=>s.actions.includes('decide'));guard(open.length);
      return {title:'قرارك على المرحلة',endpoint:`/review-rounds/${id}/decide`,
        fields:[field('stage_id','المرحلة','select',{options:open.map(s=>({value:s.id,label:`${s.position} · ${s.name} (${s.audience_name})`}))}),
          field('decision','القرار','select',{options:Object.entries(data.decisions).map(([value,label])=>({value,label:`${label} — ${data.decision_meaning[value]}`})),hint:'القرار يخص هالنسخة بس، وما يتعدل بعد ما يصدر. التراجع قرار جديد على نسخة جديدة.'}),
          field('note','سبب القرار وملاحظاته','textarea'),
          field('external_approval_id','سجل موافقة العميل الموثق','select',{required:false,options:[{value:'',label:'ما ينطبق — مرحلة داخلية'},...route.client_evidence.map(x=>({value:x.id,label:`${x.received_on} · ${x.maps_to_name} · ${x.status}`}))],
            hint:'مرحلة العميل ما تنقفل إلا بسجل موافقة خارجية موثق على هالنسخة في شاشة «موافقات العملاء».'})],
        toPayload:v=>clean({version:route.version,stage_id:v.stage_id,decision:v.decision,note:v.note,external_approval_id:v.external_approval_id})};
    }
    if(action==='save_template'){
      guard(route.actions.includes('save_template'));
      return {title:'حفظ المسار قالب',endpoint:`/review-rounds/${id}/save_template`,idempotent:true,
        fields:[field('name','اسم القالب'),field('description','وصف القالب','textarea',{required:false})],toPayload:v=>clean({version:route.version,name:v.name,description:v.description})};
    }
    if(action==='notify'){
      guard(route.actions.includes('notify'));
      return {title:'تذكير وتصعيد',endpoint:`/review-rounds/${id}/notify`,fields:[],toPayload:()=>({version:route.version}),
        after:(saved,e)=>({title:'داخل المنصة بس',html:`<div class="vn-alert"><strong>ما يطلع بريد من المنصة.</strong><p>التذكيرات والتصعيدات تنسجل في شاشة المراجعة، وتطلع لأصحابها أول ما يدخلون.</p></div><p>${e(saved.name)}</p><div class="form-actions"><button class="btn outline" type="button" data-action="close">إغلاق</button></div>`})};
    }
    guard(route.actions.includes('cancel'));
    return {title:'إلغاء المسار',endpoint:`/review-rounds/${id}/cancel`,fields:[field('reason','سبب الإلغاء','textarea')],toPayload:v=>({version:route.version,reason:v.reason})};
  }
};

export const annotationsUI={
  title:'التعليقات وقائمة شغل النسخة الجاية',
  description:'كل تعليق مثبّت على موضع في المادة: داخلي ما يطلع للعميل، أو مشترك يجوز يوصله. التعليقات المفتوحة هي قائمة شغل النسخة الجاية.',
  load:api=>api('/review-rounds'),
  render(data,{e,button,ui=kit(e)}){
    const rows=data.routes.flatMap(r=>r.worklist.map(w=>({...w,route:r})));
    const closed=data.routes.flatMap(r=>r.annotations.filter(a=>a.status!=='open').map(a=>({...a,route:r})));
    const route=r=>{
      const shut=r.annotations.filter(a=>a.status!=='open');
      return `<section class="panel panel-body"><div class="panel-head"><h2>${e(r.name)}</h2><span class="badge">${e(r.status_name)}</span></div>
        <section class="vn-block"><h3>قائمة شغل النسخة الجاية</h3>${r.worklist.length?`<ol class="vn-list">${r.worklist.map(w=>{
          const can=(r.annotations.find(a=>a.id===w.id)?.actions??[]).includes('address');
          return `<li class="${can?'is-decision':'is-pending'}"><strong>${e(w.media_label)} · ${e(w.place)}</strong><span>${e(w.body)}</span><span class="subtle">${e(w.visibility_name)} · ${e(w.created_by_name)}</span>
          ${can?`<div class="operation-actions">${button('address',w.id,'تمت المعالجة')}${button('wont_fix',w.id,'بدون معالجة')}</div>`:''}</li>`;}).join('')}</ol>`:'<p class="subtle">ما فيه تعليقات مفتوحة على هالمسار.</p>'}</section>
        ${shut.length?`<section class="vn-block"><h3>تعليقات مقفلة</h3><ul class="vn-list">${shut.map(a=>`<li class="is-old"><strong>${e(a.media_label)} · ${e(a.place)}</strong><span>${e(a.body)}</span><span class="subtle">${e(a.status_name)} — ${e(a.resolution_note)}</span></li>`).join('')}</ul></section>`:''}
      </section>`;
    };
    return `<section class="panel panel-body vn-head"><p>التعليق الداخلي ما يطلع للعميل؛ حزمة العميل تنبني من التعليقات المشتركة بس.</p></section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(rows.length,'تعليق مفتوح',rows.length?'is-due':'')}${ui.tile(closed.filter(a=>a.status==='addressed').length,'انعالج','is-ok')}${ui.tile(closed.filter(a=>a.status==='wont_fix').length,'بدون معالجة بسبب')}${ui.tile(data.routes.reduce((n,r)=>n+r.counts.internal,0),'داخلي')}${ui.tile(data.routes.reduce((n,r)=>n+r.counts.shared,0),'مشترك')}</div></section>
      ${data.routes.map(route).join('')||ui.empty('ما فيه مسارات مراجعة في مشاريعك للحين','التعليقات تطلع هنا أول ما تنفتح مراجعة على نسخة مخرج.')}`;
  },
  form(action,id,data){
    const annotation=data.routes.flatMap(r=>r.annotations).find(a=>a.id===id);
    guard(annotation&&annotation.actions.includes(action));
    if(action==='address')return {title:'تعليق تمت معالجته',endpoint:`/review-rounds/annotations/${id}/address`,
      fields:[field('note','وش انعالج وكيف','textarea')],toPayload:v=>({version:annotation.version,note:v.note})};
    return {title:'تعليق بدون معالجة',endpoint:`/review-rounds/annotations/${id}/wont_fix`,
      fields:[field('reason','سبب عدم المعالجة','textarea',{hint:'«بدون معالجة» بلا سبب مو قرار؛ السبب ينحفظ مع التعليق وما يتعدل بعده.'})],toPayload:v=>({version:annotation.version,reason:v.reason})};
  }
};
