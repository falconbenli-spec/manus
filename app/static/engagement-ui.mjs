// الارتباط: استبيان النبض وeNPS، والتقدير بين الزملاء، والإعلانات الداخلية وتقويم الفعاليات.
// الصدق في هذه الشاشات ليس تزيينًا: ما لا يُعرض هنا محجوب عمدًا، والشاشة تقول لماذا.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
// م0 «السور»: tile من العدّة المحقونة (ui من app.mjs) لا من نسخة محلية؛ HTML الناتجة مطابقة بالحرف (tests/ui-golden.test.mjs).
const paragraphs=(e,text)=>e(String(text??'')).replace(/\n/g,'<br>');
const kilobytes=bytes=>Math.max(1,Math.round(bytes/1024));
const acts=list=>{const kept=list.filter(Boolean);return kept.length?`<div class="operation-actions">${kept.join('')}</div>`:'';};
// الأرقام في سياقها المجدول: التاريخ في <time> بنصه كما كان، والعدد الصِّرف في <span data-num>، والموقَّع (eNPS) في .ltr فتبقى إشارته قبله.
const when=(e,iso)=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(iso)}</time>`:'';
const num=(e,n)=>`<span data-num>${e(n)}</span>`;
const ENPS='<span lang="en" dir="ltr">eNPS</span>';

/* ————————————————— أ. استبيان النبض وeNPS ————————————————— */

const cycleStates={draft:'مسودة',open:'مفتوحة',closed:'مغلقة'};
const pulseLabels={edit_cycle:'تعديل المسودة',approve_cycle:'اعتماد وفتح الدورة',close_cycle:'إغلاق الدورة',answer_pulse:'المشاركة في الاستبيان'};

function questionResult(q,e){
  if(q.withheld)return `<li class="is-old"><strong>${e(q.prompt)}</strong><span class="muted">${e(q.reason)}</span></li>`;
  if(q.kind==='comment'){
    const body=q.comments_visible
      ? (q.comments.length?`<ul class="vn-list">${q.comments.map(c=>`<li><span>${paragraphs(e,c)}</span></li>`).join('')}</ul>`:'')
      : `<p class="subtle">${e(q.comments_note)}</p>`;
    return `<li><strong>${e(q.prompt)}</strong><span>التعليقات ${num(e,q.answered)}</span>${q.comments_visible?`<span class="subtle">${e(q.comments_note)}</span>`:''}${body}</li>`;
  }
  const bands=q.bands
    // تسمية فئة المقياس رقمٌ صرف من الخادم («5»)، فتُقال «الدرجة 5»؛ وفئات eNPS تُعرض بتسميتها.
    ? `<ul class="vn-list">${q.bands.map(b=>`<li><strong>${/^\d+$/.test(String(b.label))?`الدرجة ${num(e,b.label)}`:e(b.label)}</strong><span>${num(e,b.count)}</span></li>`).join('')}</ul>`
    : `<p class="muted">${e(q.bands_reason)}</p>`;
  // حين يُحجب التوزيع يحجب الخادم المتوسط وeNPS معه (null)، فلا يُرسم سطرٌ برقم فارغ.
  const headline=q.average===null||q.average===undefined?'':q.kind==='enps'?`${ENPS} <span class="ltr">${e(q.enps)}</span> · متوسط الدرجة ${num(e,q.average)} · `:`المتوسط ${num(e,q.average)} من ${num(e,5)} · `;
  return `<li><strong>${e(q.prompt)}</strong><span>${headline}الإجابات ${num(e,q.answered)}</span>${bands}</li>`;
}
function cycleCard(c,e,button){
  const results=c.results.available
    ? `<section class="vn-block"><h4>النتائج</h4><p class="subtle">${e(c.results.scope)} عدد المستجيبين ${num(e,c.results.respondents)}، والحد الأدنى المثبّت للدورة ${num(e,c.results.minimum)}.</p><ul class="vn-list">${c.results.questions.map(q=>questionResult(q,e)).join('')}</ul></section>`
    : c.status==='draft'?'':`<section class="vn-block"><h4>النتائج</h4><div class="vn-alert"><strong>محجوبة.</strong> ${e(c.results.reason)}</div></section>`;
  const questions=c.results.available?'':`<section class="vn-block"><h4>الأسئلة (${num(e,c.questions.length)})</h4><ol class="vn-list">${c.questions.map(q=>`<li><strong>${e(q.prompt)}</strong><span>${e(q.kind_name)}</span></li>`).join('')}</ol></section>`;
  // من أعدّ ومن فتح ومن أغلق سجلُّ فصل مهام (المعدّ لا يفتح دورته)، فيبقى ظاهرًا. والمسودة بلا مشاركة ولا نتيجة: تُعرض أسئلتها للمراجعة وحدها.
  return `<section class="panel panel-body"><h3>${e(c.title)} <span class="badge ${e(c.status)}">${e(cycleStates[c.status])}</span></h3>
    <p class="subtle">من ${when(e,c.opens_on)} إلى ${when(e,c.closes_on)} · أعدّها ${e(c.prepared_by_name??'—')}${c.opened_by_name?` · فتحها ${e(c.opened_by_name)}`:''}${c.closed_by_name?` · أغلقها ${e(c.closed_by_name)}`:''}</p>
    ${c.purpose?`<p class="measure">${paragraphs(e,c.purpose)}</p>`:''}
    ${c.status==='draft'?'':`<p class="muted measure">شارك ${num(e,c.participation.responded)} من ${num(e,c.participation.invited)}. الأسماء محجوبة عمدًا: سجل المشاركة بس يمنع إن أحد يجاوب مرتين، وما ينستخدم لقائمة «مين ما جاوب».</p>`}
    ${c.answered_by_me?'<p class="subtle measure">شاركت في هالدورة. إجابتك محفوظة بدون أي ربط باسمك، فما تقدر ترجع لها ولا تعدّلها.</p>':''}
    ${questions}${results}
    ${acts(c.actions.map(a=>button(a,c.id,pulseLabels[a])))}</section>`;
}
export const pulseUI={
  title:'استبيان النبض وeNPS',
  description:'النتيجة على مستوى الشركة كلها بس، بلا تقسيم حسب الإدارة، وإجابتك تنحفظ بدون أي ربط باسمك. وإذا كان المستجيبين أقل من الحد اللي يحدده مدير الموارد البشرية تنحجب النتيجة كلها.',
  load:api=>api('/engagement/pulse'),
  render(data,{e,button,ui}){
    const {tile}=ui;
    // حدّ السرية قاعدة سارية: تُعرض بقيمتها وسريانها وسندها. من قرّرها مكتوب في سندها وفي سجل التدقيق، لا في سطرها.
    const privacy=data.privacy
      ? `<p><strong>الحد الأدنى للمستجيبين: ${num(e,data.privacy.min_respondents)}</strong> · ساري من ${when(e,data.privacy.effective_from)}</p><p class="subtle">السند: ${paragraphs(e,data.privacy.basis)}</p>`
      : `<div class="vn-alert${data.can_manage?' is-due':''}"><strong>الحد الأدنى للمستجيبين ما تحدّد للحين.</strong> هو وعد السرية لمن يشارك، فما تنفتح دورة قبل ما يتثبّت. يحدده مدير الموارد البشرية بسنده.</div>`;
    const history=data.can_manage&&data.privacy_history.length>1
      ? `<section class="vn-block"><div class="panel-head"><h2>سجل الحد الأدنى</h2></div><div class="timeline">${data.privacy_history.map(s=>`<div class="timeline-item"><strong>الحد الأدنى ${num(e,s.min_respondents)}</strong><small>من ${when(e,s.effective_from)}</small><p class="measure">${paragraphs(e,s.basis)}</p></div>`).join('')}</div></section>`
      : '';
    const open=data.cycles.filter(c=>c.status==='open'),drafts=data.cycles.filter(c=>c.status==='draft'),closed=data.cycles.filter(c=>c.status==='closed');
    const group=(title,list)=>list.length?`<section class="vn-block"><div class="panel-head"><h2>${e(title)}</h2></div>${list.map(c=>cycleCard(c,e,button)).join('')}</section>`:'';
    const next=!data.can_manage?'الموارد البشرية تفتح دورة النبض، وأول ما تنفتح تقدر تشارك فيها من هنا.'
      :data.privacy?'جهّز أول دورة من «دورة نبض جديدة»، ويفتحها شخص ثاني من الموارد البشرية بعد ما يراجع أسئلتها.'
      :'حدّد الحد الأدنى للمستجيبين أول، بعدها تقدر تجهّز دورة نبض.';
    return `<section class="panel panel-body vn-head">
      <p><strong>${e(data.note)}</strong></p>
      <p class="subtle">${e(data.comment_warning)}</p>
      <p class="muted">${e(data.benchmarks)}</p>
      ${privacy}
      ${acts([data.can_manage?button('set_privacy','','تحديد الحد الأدنى للمستجيبين'):'',data.can_manage&&data.privacy?button('create_cycle','','دورة نبض جديدة'):''])}</section>
      <section class="vn-board"><div class="vn-tiles">${tile(data.cycles.length,'دورة')}${tile(open.length,'مفتوحة')}${tile(closed.length,'مغلقة')}${tile(data.my_open.length,'بانتظار مشاركتك',data.my_open.length?'is-due':'')}</div></section>
      ${group('مفتوحة الحين',open)}${group('مسودات',drafts)}${group('مغلقة',closed)}
      ${data.cycles.length?'':ui.empty('ما فيه دورة نبض للحين',next)}
      ${history}`;
  },
  form(action,id,data){
    if(action==='set_privacy'){
      guard(data.can_manage);
      return {title:'الحد الأدنى للمستجيبين قبل عرض أي نتيجة',endpoint:'/engagement/pulse/privacy',idempotent:true,
        fields:[field('min_respondents','الحد الأدنى','number',{min:2,step:1,value:data.privacy?.min_respondents??'',hint:'اختر عدد ما يخلّي أحد يقدر ينسب أي إجابة لشخص بعينه في شركة بحجمنا. أقل شي 5: بأقل منها يقدر المشارك يطرح إجابته من النتيجة وينكشف جواب غيره.'}),
          field('effective_from','سريان القرار','date',{value:data.today,hint:'اليوم أو بعده. الحد ما ينخفض بأثر رجعي، لأنه يكشف نتائج انجمعت بوعد أعلى.'}),
          field('basis','سند القرار ومن قرره','textarea')],
        toPayload:v=>({min_respondents:Number(v.min_respondents),effective_from:v.effective_from,basis:v.basis})};
    }
    if(action==='create_cycle'||action==='edit_cycle'){
      const c=action==='edit_cycle'?data.cycles.find(x=>x.id===id):null;
      guard(data.can_manage&&data.privacy&&(action==='create_cycle'||c?.status==='draft'));
      return {title:action==='create_cycle'?'دورة نبض جديدة':`تعديل — ${c.title}`,
        endpoint:action==='create_cycle'?'/engagement/pulse/cycles':`/engagement/pulse/cycles/${id}`,idempotent:action==='create_cycle',
        fields:[field('title','عنوان الدورة','text',{value:c?.title}),field('purpose','الغرض من الدورة','textarea',{required:false,value:c?.purpose}),
          field('opens_on','الفتح','date',{value:c?.opens_on??data.today}),field('closes_on','الإغلاق','date',{value:c?.closes_on}),
          field('questions','الأسئلة','rows',{maxRows:15,value:c?.questions?.map(q=>({kind:q.kind,prompt:q.prompt})),
            columns:[{name:'kind',label:'النوع',type:'select',options:Object.entries(data.question_kinds).map(([value,label])=>({value,label}))},{name:'prompt',label:'نص السؤال'}],
            hint:'سؤال eNPS واحد بالكثير. التعليق الحر اختياري للي يجاوب، وينعرض مثل ما انكتب بدون أي تحليل مشاعر ولا نموذج لغوي.'})],
        toPayload:v=>({...(c?{version:c.version}:{}),title:v.title,purpose:v.purpose||'',opens_on:v.opens_on,closes_on:v.closes_on,
          questions:v.questions.map(q=>({kind:q.kind,prompt:q.prompt}))})};
    }
    const c=data.cycles.find(x=>x.id===id);guard(c&&c.actions.includes(action));
    if(action==='approve_cycle')return {title:`اعتماد وفتح — ${c.title}`,endpoint:`/engagement/pulse/cycles/${id}/approve`,
      fields:[field('note','أساس الفتح','textarea',{hint:'اللي جهّز الأسئلة ما يفتح الدورة بنفسه. وبعد الفتح تثبت الأسئلة والحد الأدنى للمستجيبين وما تتغير.'})],
      toPayload:v=>({version:c.version,note:v.note})};
    if(action==='close_cycle')return {title:`إغلاق — ${c.title}`,endpoint:`/engagement/pulse/cycles/${id}/close`,
      fields:[field('note','أساس الإغلاق','textarea',{hint:'النتائج تنحسب بعد الإغلاق بس: لو انقرت النتيجة الجارية مرتين، ينكشف بالطرح جواب اللي شارك بين القراءتين.'})],
      toPayload:v=>({version:c.version,note:v.note})};
    return {title:`${c.title}`,endpoint:`/engagement/pulse/cycles/${id}/respond`,idempotent:true,
      fields:c.questions.map((q,index)=>q.kind==='comment'
        ? field(`q${index}`,q.prompt,'textarea',{required:false,hint:'اختياري. في شركة بحجمنا ممكن أسلوب التعليق يكشف كاتبه.'})
        // B17 (تدقيق 19 سبتمبر): بلا خيار فارغ كانت القائمة تبدأ على أدنى درجة، فيُرسل من لم يلمس السؤال «1» (أو «0» في eNPS)
        // وكأنه أجاب. الخيار الفارغ أولًا مع required يجعل السؤال بلا إجابة افتراضية.
        : field(`q${index}`,q.prompt,'select',{options:[{value:'',label:'— اختر درجة —'},...(q.kind==='enps'?[0,1,2,3,4,5,6,7,8,9,10]:[1,2,3,4,5]).map(n=>({value:String(n),label:String(n)}))],value:'',hint:q.kind==='enps'?'0 لا أرشّح إطلاقًا · 10 أرشّح بقوة':'1 أرفض بشدة · 5 أوافق بشدة'})),
      toPayload:v=>({answers:c.questions.map((q,index)=>({question_id:q.id,value:q.kind==='comment'?null:Number(v[`q${index}`]),comment:q.kind==='comment'?(v[`q${index}`]||''):''}))})};
  }
};

/* ————————————————— ب. التقدير بين الزملاء ————————————————— */

// السهم يعني «إلى»: يُخفى عن القارئ الآلي وتُقال الكلمة بدله.
const cardItem=(c,e)=>`<li><strong>${e(c.from_name??'—')} <span aria-hidden="true">←</span><span class="sr-only">إلى</span> ${e(c.to_name??'—')}</strong><span>${e(c.value_name)} · ${e(c.visibility_name)} · ${when(e,String(c.created_at).slice(0,10))}</span><span>${paragraphs(e,c.message)}</span></li>`;
export const recognitionUI={
  title:'التقدير بين الزملاء',
  description:'بطاقة تقدير ترسلها لزميل على موقف يعكس قيمة من قيم الشركة. ما فيها نقاط ولا لوحة صدارة ولا ترتيب، وما تنحسب تلقائيًا في تقييم الأداء.',
  load:api=>api('/engagement/recognition'),
  render(data,{e,button,ui}){
    const {tile}=ui;
    // القيمة تُقرأ بنصها وسريانها وسندها. من عرّفها في سندها وسجل التدقيق، لا في سطرها.
    const values=data.values.map(x=>`<li class="${x.live?'':'is-old'}"><strong>${e(x.name)}</strong><span>${x.live?`سارية من ${when(e,x.effective_from)}`:x.retired_on?`انسحبت في ${when(e,x.retired_on)}`:`تسري من ${when(e,x.effective_from)}`}</span><span>${paragraphs(e,x.description)}</span><span class="subtle">السند: ${paragraphs(e,x.basis)}</span>${x.retired_reason?`<span class="subtle">سبب السحب: ${paragraphs(e,x.retired_reason)}</span>`:''}${acts(x.actions.map(a=>button(a,x.id,'سحب القيمة')))}</li>`).join('');
    const list=(title,rows,none)=>`<section class="vn-block"><div class="panel-head"><h2>${e(title)}</h2></div>${rows.length?`<ul class="vn-list">${rows.map(c=>cardItem(c,e)).join('')}</ul>`:`<p class="subtle">${e(none)}</p>`}</section>`;
    const canSend=data.actions.includes('send_recognition');
    // ما وصلني أول: حالي قبل موجز الشركة، والقيم المرجعية آخرًا. وبلا أي بطاقة بعد، الجواب حالة فارغة واحدة تقول من أين يبدأ.
    const cards=data.cards_total||data.received.length||data.sent.length||data.feed.length
      ? `${list('وصلتني',data.received,'البطاقات اللي يرسلها لك زملاؤك تطلع هنا.')}
      ${list('الموجز — البطاقات العلنية',data.feed,'أول ما يرسل أحد بطاقة علنية تطلع هنا للكل.')}
      ${list('أرسلتها',data.sent,canSend?'تقدر ترسل أول بطاقة من «بطاقة تقدير لزميل».':'تقدر ترسل بطاقة أول ما تعرّف الموارد البشرية قيم الشركة.')}`
      : ui.empty('ما انرسلت بطاقة تقدير للحين',canSend?'ابدأ من «بطاقة تقدير لزميل»: اختر الزميل والقيمة، واذكر الموقف اللي تقدّره.':data.can_manage?'عرّف أول قيمة من «تعريف قيمة مؤسسية» بسندها، وبعدها يقدر الكل يرسل بطاقات تقدير.':'أول ما تعرّف الموارد البشرية قيم الشركة تقدر ترسل أول بطاقة لزميلك.');
    return `<section class="panel panel-body vn-head">
      <p><strong>${e(data.note)}</strong></p>
      <p class="subtle">${e(data.performance_note)}</p>
      ${data.values_missing?`<div class="vn-alert${data.can_manage?' is-due':''}"><strong>ما فيه قيمة سارية من قيم الشركة.</strong> كل بطاقة تنربط بقيمة تعرّفها الموارد البشرية بسندها، فما تنرسل بطاقة قبل ما تكون فيه قيمة سارية.</div>`:''}
      ${acts([data.actions.includes('send_recognition')?button('send_recognition','','بطاقة تقدير لزميل'):'',data.actions.includes('define_value')?button('define_value','','تعريف قيمة مؤسسية'):''])}</section>
      <section class="vn-board"><div class="vn-tiles">${tile(data.cards_total,'بطاقة في المنصة')}${tile(data.received.length,'وصلتني')}${tile(data.sent.length,'أرسلتها')}</div>
      <p class="muted">هذي أعداد على مستوى الشركة وعلى مستواك أنت بس. ما فيه في هالشاشة ولا في بياناتها أي ترتيب للأشخاص بعدد بطاقاتهم.</p></section>
      ${cards}
      <section class="vn-block"><div class="panel-head"><h2>القيم المؤسسية</h2></div>${values?`<ul class="vn-list">${values}</ul>`:`<p class="subtle">${data.can_manage?'القيم اللي تعرّفها تطلع هنا بسندها وتاريخ سريانها.':'قيم الشركة تطلع هنا أول ما تعرّفها الموارد البشرية بسندها.'}</p>`}</section>`;
  },
  form(action,id,data){
    if(action==='send_recognition'){
      guard(data.live_values.length&&data.colleagues.length);
      return {title:'بطاقة تقدير لزميل',endpoint:'/engagement/recognition/cards',idempotent:true,
        fields:[field('to_user_id','الزميل','select',{options:data.colleagues.map(p=>({value:p.id,label:p.name}))}),
          field('value_id','القيمة المؤسسية','select',{options:data.live_values.map(x=>({value:x.id,label:`${x.name} — ${x.description.slice(0,60)}`}))}),
          field('message','وش اللي تقدّره بالضبط؟','textarea',{hint:'اذكر الموقف مو الصفة. البطاقة ما تنعدّل ولا تنحذف بعد ما ترسلها، والتصحيح يكون ببطاقة جديدة.'}),
          field('visibility','الظهور','select',{options:Object.entries(data.visibility).map(([value,label])=>({value,label}))})],
        toPayload:v=>({to_user_id:v.to_user_id,value_id:v.value_id,message:v.message,visibility:v.visibility})};
    }
    if(action==='define_value'){
      guard(data.can_manage);
      return {title:'تعريف قيمة مؤسسية',endpoint:'/engagement/recognition/values',idempotent:true,
        fields:[field('name','اسم القيمة'),field('description','وش تعني القيمة على أرض الواقع','textarea'),
          field('basis','سندها ومن أقرّها','textarea',{hint:'المستند أو القرار اللي أقرّ هالقيمة وتاريخه. القيم ما تنخترع هنا.'}),
          field('effective_from','سريانها','date',{value:data.today})],
        toPayload:v=>({name:v.name,description:v.description,basis:v.basis,effective_from:v.effective_from})};
    }
    const x=data.values.find(y=>y.id===id);guard(x&&x.actions.includes(action));
    return {title:`سحب القيمة — ${x.name}`,endpoint:`/engagement/recognition/values/${id}/retire`,
      fields:[field('reason','سبب السحب','textarea',{hint:'البطاقات اللي استشهدت بهالقيمة تبقى مثل ما هي، والقيمة تبقى محفوظة عشان تنفهم البطاقات.'})],
      toPayload:v=>({version:x.version,reason:v.reason})};
  }
};

/* ————————————————— ج. الإعلانات الداخلية والفعاليات ————————————————— */

const announcementStates={draft:'مسودة',published:'منشور',withdrawn:'مسحوب'};
const announcementLabels={edit_announcement:'تعديل المسودة',attach_file:'إضافة مرفق',approve_announcement:'اعتماد ونشر',withdraw_announcement:'سحب الإعلان',acknowledge:'أقر بالاطلاع'};
function announcementCard(a,e,button){
  // زر التنزيل يحمل اسم مرفقه لقارئ الشاشة، فلا تتشابه أزرار «تنزيل» في إعلان واحد.
  const attachments=a.attachments.length?`<section class="vn-block"><h4>المرفقات</h4><ul class="vn-list">${a.attachments.map(f=>`<li><strong>${e(f.label)}</strong><span><bdi dir="ltr">${e(f.filename)}</bdi> · ${num(e,kilobytes(f.size))} كيلوبايت</span><a class="btn outline small" href="/api/engagement/announcements/files/${e(f.id)}">تنزيل<span class="sr-only"> ${e(f.label)}</span></a></li>`).join('')}</ul></section>`:'';
  // من ينتظر إقراره أولًا (هو من يُتابَع)، ومن أقرّ مطويٌّ بعدده.
  const readers=a.reads?.length?`<details><summary>اللي أقرّوا (${num(e,a.reads.length)})</summary><ul class="vn-list">${a.reads.map(r=>`<li class="is-ok"><strong>${e(r.name)}</strong><span>أقرّ <time datetime="${e(r.read_at)}">${e(String(r.read_at).slice(0,16).replace('T',' '))}</time></span></li>`).join('')}</ul></details>`:'';
  const tracking=a.reads?`<section class="vn-block"><h4>إقرار القراءة</h4><p class="subtle measure">أقرّ ${num(e,a.reads.length)} · ما اطّلع للحين ${num(e,a.pending.length)}. ليش يستوجب إقرار: ${paragraphs(e,a.ack_reason)}</p>
    ${a.pending.length?`<ul class="vn-list">${a.pending.map(p=>`<li class="is-due"><strong>${e(p.name)}</strong><span>ما اطّلع للحين</span></li>`).join('')}</ul>`:''}${readers}
    <p class="muted measure">التذكير داخل المنصة بس: ما فيه مزوّد بريد مربوط، فما تنرسل رسالة لأحد من هالقائمة.</p></section>`:'';
  const state=a.status==='withdrawn'?'is-old':a.expired?'is-old':a.requires_ack&&!a.acknowledged&&a.status==='published'?'is-due':'';
  const mine=a.actions.includes('acknowledge');
  // من أعدّ ومن نشر سجلُّ فصل مهام (المعدّ لا ينشر إعلانه)، فيبقى ظاهرًا.
  return `<section class="panel panel-body ${state}"><h3>${e(a.title)} <span class="badge ${e(a.status)}">${e(announcementStates[a.status])}</span>${mine?' <span class="badge is-due">بانتظار إقرارك</span>':a.requires_ack?' <span class="badge">يستوجب إقرار</span>':''}</h3>
    <p class="subtle">${e(a.audience_name)}${a.department_name?` · ${e(a.department_name)}`:''} · من ${when(e,a.publish_on)} إلى ${when(e,a.expires_on)}${a.expired?' · منتهي':''} · أعدّه ${e(a.prepared_by_name??'—')}${a.published_by_name?` · نشره ${e(a.published_by_name)}`:''}</p>
    ${a.status==='withdrawn'?`<div class="vn-alert"><strong>سحبه ${e(a.withdrawn_by_name??'—')}.</strong> ${paragraphs(e,a.withdrawn_reason)}</div>`:''}
    <p class="measure">${paragraphs(e,a.body)}</p>
    ${a.acknowledged?'<p class="subtle">سجّلت إقرارك إنك اطّلعت على هالإعلان.</p>':''}
    ${attachments}${tracking}
    ${acts(a.actions.map(x=>button(x,a.id,announcementLabels[x])))}</section>`;
}
export const announcementsUI={
  title:'الإعلانات الداخلية',
  description:'إعلانات الشركة لكل الموظفين أو لإدارة وحدة، لكل إعلان تاريخ نشر وانتهاء، واللي يستوجب إقرار تقرّ فيه إنك اطّلعت. توصلك داخل المنصة بس، ما فيه بريد إلكتروني مربوط.',
  load:api=>api('/engagement/announcements'),
  render(data,{e,button,ui}){
    const {tile}=ui;
    const live=data.announcements.filter(a=>a.status==='published'&&!a.expired),drafts=data.announcements.filter(a=>a.status==='draft'),old=data.announcements.filter(a=>a.status==='withdrawn'||(a.status==='published'&&a.expired));
    // اللي ينتظر إقرارك أول السارية: هو سبب فتح الشاشة. الفرز ثابت فيبقى ترتيب التاريخ بين البقية.
    live.sort((x,y)=>Number(y.actions.includes('acknowledge'))-Number(x.actions.includes('acknowledge')));
    const group=(title,list)=>list.length?`<section class="vn-block"><div class="panel-head"><h2>${e(title)}</h2></div>${list.map(a=>announcementCard(a,e,button)).join('')}</section>`:'';
    const events=data.events.length
      ? `<ul class="vn-list">${data.events.map(x=>`<li class="${x.cancelled?'is-old':''}"><strong>${e(x.title)}${x.cancelled?' · ملغاة':''}</strong><span>${when(e,x.event_date)}${x.start_time?` · <time datetime="${e(x.start_time)}">${e(x.start_time)}</time>`:''}${x.location?` · ${e(x.location)}`:''} · ${e(x.audience_name)}</span>${x.note?`<span>${paragraphs(e,x.note)}</span>`:''}${x.cancelled?`<span class="subtle">سبب الإلغاء: ${paragraphs(e,x.cancelled_reason)}</span>`:''}${acts(x.actions.map(a=>button(a,x.id,'إلغاء الفعالية')))}</li>`).join('')}</ul>`
      : `<p class="subtle">${data.can_manage?'الفعاليات تطلع هنا أول ما تضيفها من «فعالية في التقويم».':'فعاليات الشركة الجاية تطلع هنا أول ما تنضاف.'}</p>`;
    const pending=data.announcements.filter(a=>a.actions.includes('acknowledge')).length;
    return `<section class="panel panel-body vn-head">
      <p><strong>${e(data.note)}</strong></p>
      ${acts([data.actions.includes('draft_announcement')?button('draft_announcement','','إعلان جديد'):'',data.actions.includes('create_event')?button('create_event','','فعالية في التقويم'):''])}</section>
      <section class="vn-board"><div class="vn-tiles">${tile(live.length,'إعلان ساري')}${tile(pending,'بانتظار إقرارك',pending?'is-due':'')}${tile(data.events.filter(x=>!x.cancelled).length,'فعالية جاية')}</div></section>
      ${data.announcements.length?`${group('سارية الحين',live)}${group('مسودات',drafts)}`:ui.empty('ما فيه إعلانات للحين',data.can_manage?'ابدأ من «إعلان جديد»، وينشره شخص ثاني من الموارد البشرية بعد ما يراجعه.':'إعلانات الشركة توصلك هنا أول ما تنزل، واللي يستوجب منها إقرار يطلع لك تحته زر «أقر بالاطلاع».')}
      <section class="vn-block"><div class="panel-head"><h2>تقويم الفعاليات</h2></div>${events}</section>
      ${group('منتهية ومسحوبة',old)}`;
  },
  form(action,id,data){
    const departmentOptions=data.departments.map(d=>({value:d.id,label:d.name}));
    if(action==='draft_announcement'||action==='edit_announcement'){
      const a=action==='edit_announcement'?data.announcements.find(x=>x.id===id):null;
      guard(data.can_manage&&(action==='draft_announcement'||a?.status==='draft'));
      return {title:action==='draft_announcement'?'إعلان جديد':`تعديل — ${a.title}`,
        endpoint:action==='draft_announcement'?'/engagement/announcements':`/engagement/announcements/${id}`,idempotent:action==='draft_announcement',
        fields:[field('title','العنوان','text',{value:a?.title}),field('body','النص','textarea',{value:a?.body}),
          field('audience_kind','الجمهور','select',{value:a?.audience_kind??'all',options:Object.entries(data.audiences).map(([value,label])=>({value,label}))}),
          field('department_id','الإدارة (إذا الإعلان لإدارة وحدة)','select',{required:false,value:a?.department_id??'',options:[{value:'',label:'—'},...departmentOptions]}),
          field('publish_on','تاريخ النشر','date',{value:a?.publish_on??data.today}),field('expires_on','تاريخ الانتهاء','date',{value:a?.expires_on}),
          field('requires_ack','يستوجب إقرار قراءة','select',{value:a?.requires_ack?'yes':'no',options:[{value:'no',label:'لا — إعلان عام ما يتتبع مين قرأه'},{value:'yes',label:'نعم — ينسجل مين اطّلع ومتى'}],hint:'الإقرار بس للي يستوجبه فعلًا، مثل تغيير سياسة. والإعلان العادي ما يتتبع مين قرأه.'}),
          field('ack_reason','ليش يستوجب إقرار','textarea',{required:false,value:a?.ack_reason})],
        toPayload:v=>({...(a?{version:a.version}:{}),title:v.title,body:v.body,audience_kind:v.audience_kind,
          department_id:v.audience_kind==='department'?v.department_id:'',publish_on:v.publish_on,expires_on:v.expires_on,
          requires_ack:v.requires_ack==='yes',ack_reason:v.requires_ack==='yes'?(v.ack_reason||''):''})};
    }
    if(action==='create_event'){
      guard(data.can_manage);
      return {title:'فعالية في التقويم',endpoint:'/engagement/announcements/events',idempotent:true,
        fields:[field('title','اسم الفعالية'),field('event_date','التاريخ','date',{value:data.today}),
          field('start_time','الوقت','text',{required:false,placeholder:'09:30',hint:'بنظام 24 ساعة، مثل 09:30 أو 14:00.'}),
          field('location','المكان','text',{required:false}),field('note','تفاصيل','textarea',{required:false}),
          field('audience_kind','الجمهور','select',{value:'all',options:Object.entries(data.audiences).map(([value,label])=>({value,label}))}),
          field('department_id','الإدارة (إذا الفعالية لإدارة وحدة)','select',{required:false,options:[{value:'',label:'—'},...departmentOptions]})],
        toPayload:v=>({title:v.title,event_date:v.event_date,start_time:v.start_time||'',location:v.location||'',note:v.note||'',
          audience_kind:v.audience_kind,department_id:v.audience_kind==='department'?v.department_id:''})};
    }
    if(action==='cancel_event'){
      const x=data.events.find(y=>y.id===id);guard(x&&x.actions.includes(action));
      return {title:`إلغاء — ${x.title}`,endpoint:`/engagement/announcements/events/${id}/cancel`,
        fields:[field('reason','سبب الإلغاء','textarea')],toPayload:v=>({version:x.version,reason:v.reason})};
    }
    const a=data.announcements.find(x=>x.id===id);guard(a&&a.actions.includes(action));
    if(action==='attach_file')return {title:`مرفق — ${a.title}`,endpoint:`/engagement/announcements/${id}/attachments`,idempotent:true,
      fields:[field('label','وصف المرفق'),field('file','الملف','file',{hint:'PDF أو PNG أو JPEG لين 2 ميغابايت. المرفقات تنضاف قبل النشر وما تنعدّل بعده.'})],
      toPayload:v=>({label:v.label,file:v.file})};
    if(action==='approve_announcement')return {title:`اعتماد ونشر — ${a.title}`,endpoint:`/engagement/announcements/${id}/approve`,
      fields:[field('note','أساس النشر','textarea',{hint:'اللي جهّز الإعلان ما ينشره بنفسه. والإعلان المنشور ما ينعدّل: ينسحب بسببه، وينزل إعلان بداله.'})],
      toPayload:v=>({version:a.version,note:v.note})};
    if(action==='withdraw_announcement')return {title:`سحب — ${a.title}`,endpoint:`/engagement/announcements/${id}/withdraw`,
      fields:[field('reason','سبب السحب','textarea',{hint:'الإقرارات المسجّلة تبقى محفوظة مثل ما هي.'})],
      toPayload:v=>({version:a.version,reason:v.reason})};
    return {title:`إقرار الاطلاع — ${a.title}`,endpoint:`/engagement/announcements/${id}/acknowledge`,
      fields:[],toPayload:()=>({})};
  }
};
