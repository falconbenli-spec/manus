// اللقاءات الفردية · التغذية الراجعة المستمرة · تقييم 360.
// ثلاث شاشات تصرّح بحدودها: ما يُكتب فيها أداة تطوير، ولا يتحول إلى درجة ولا ترتيب ولا قرار إداري آلي.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const tile=(e,value,label,tone='')=>`<div class="vn-tile ${tone}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
const acts=(e,button,row,labels)=>row.actions.length?`<div class="operation-actions">${row.actions.map(a=>button(a,row.id,labels[a])).join('')}</div>`:'';
// الأرقام في سياقها المجدول: التاريخ في <time> بنصه كما كان، والعدد الصِّرف في <span data-num>.
const when=(e,iso)=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(iso)}</time>`:'';
const num=(e,n)=>`<span data-num>${e(n)}</span>`;
const ago=(e,n)=>n===0?'اليوم':n===1?'أمس':n===2?'قبل يومين':`قبل ${num(e,n)} ${n<=10?'أيام':'يوم'}`;

const meetingLabels={add_agenda:'بند أجندة',add_follow_up:'بند متابعة',save_private_note:'ملاحظتي الخاصة',record_held:'تسجيل انعقاد اللقاء',cancel_meeting:'إلغاء اللقاء'};
const itemLabels={complete_item:'إنجاز البند',drop_item:'إسقاط البند'};

export const oneToOnesUI={
  title:'اللقاءات الفردية',
  description:'لقاء دوري بين الموظف ومديره: أجندة يكتب فيها الاثنين، ومحضر، وبنود متابعة لكل بند صاحب وموعد. المحتوى بينهم بس؛ الموارد البشرية تشوف إن اللقاء انعقد ومتى، مو وش انقال فيه.',
  load:api=>api('/one-to-ones'),
  render(data,{e,button,ui}){
    // اللقاء عنوانٌ (h3) تحت مجموعته (h2)، وأقسامه h4. المجدول يعرض أقسامه الأربعة ويقول كيف تمتلئ؛
    // وما انعقد أو انلغى ما عاد يتغير، فيعرض ما فيه فقط بلا أسطر «ما فيه» مكررة.
    const part=(title,has,body,hint)=>has?`<h4>${title}</h4>${body}`:hint?`<h4>${title}</h4><p class="subtle">${hint}</p>`:'';
    const meeting=m=>{const live=m.actions.length>0;return `<section class="vn-block"><div class="panel-head"><h3>${when(e,m.scheduled_on)} — ${e(m.other_name||'')} <span class="badge ${e(m.status)}">${e(m.status_name)}</span></h3></div>
      <p class="subtle">${e(m.employee_name)} مع ${e(m.manager_name)}${m.held_at?` · انسجل انعقاده ${when(e,String(m.held_at).slice(0,10))}${m.closed_by_name?` بيد ${e(m.closed_by_name)}`:''}`:''}${m.cancel_reason?` · انلغى: ${e(m.cancel_reason)}`:''}</p>
      ${part('الأجندة المشتركة',m.agenda.length,`<ul class="vn-list">${m.agenda.map(a=>`<li><strong>${e(a.topic)}</strong><span>${e(a.author_name)}${a.mine?' · بندك':''}</span></li>`).join('')}</ul>`,live&&'يكتب فيها الطرفين قبل اللقاء من «بند أجندة».')}
      ${part('المحضر المشترك',!!m.shared_notes,`<p class="measure">${e(m.shared_notes)}</p>`,'')}
      ${part('ملاحظتي الخاصة',!!m.my_private_note,`<p class="measure">${e(m.my_private_note)}</p>`,live&&'اللي تكتبه هنا لك بروحك: ما يشوفه الطرف الثاني ولا الموارد البشرية.')}
      ${part('بنود المتابعة',m.follow_ups.length,`<ul class="vn-list">${m.follow_ups.map(f=>`<li class="${f.overdue?'is-late':f.status!=='open'?'is-old':''}"><strong>${e(f.item)}</strong><span>${e(f.owner_name)}${f.mine?' · بندك':''} · الموعد ${when(e,f.due_date)} · ${e(f.status_name)}${f.overdue?' · متأخر':''}</span>${f.closing_note?`<small>${e(f.closing_note)}</small>`:''}${acts(e,button,f,itemLabels)}</li>`).join('')}</ul>`,live&&'تنضاف من «بند متابعة»، ولكل بند صاحب وموعد.')}
      ${acts(e,button,m,meetingLabels)}</section>`;};
    const mine=data.my_open_items.map(i=>`<li class="${i.overdue?'is-late':''}"><strong>${e(i.item)}</strong><span>الموعد ${when(e,i.due_date)} · من لقائك مع ${e(i.counterpart_name)}${i.overdue?' · متأخر':''}</span></li>`).join('');
    const cadence=data.cadence?`<section class="vn-block"><div class="panel-head"><h2>انتظام اللقاءات</h2></div><p class="subtle measure">${e(data.cadence.note)}</p>
      ${data.cadence.rows.length?`<ul class="vn-list">${data.cadence.rows.map(r=>`<li class="${r.never_held?'is-due':''}"><strong>${e(r.employee_name)} مع ${e(r.manager_name||'—')}</strong><span>${r.last_held_on?`اللقاءات المنعقدة ${num(e,r.held_count)} · آخرها ${when(e,r.last_held_on)} (${ago(e,r.days_since_last)})`:'ما انعقد بينهم لقاء للحين'}${r.next_scheduled_on?` · الجاي ${when(e,r.next_scheduled_on)}`:''}</span></li>`).join('')}</ul>`:'<p class="subtle">انتظام اللقاءات يطلع هنا لكل موظف له مدير مباشر مسجّل.</p>'}</section>`:'';
    // المجدولة أولًا (فيها الأجندة والتسجيل)، ثم ما انعقد أو انلغى.
    const scheduled=data.meetings.filter(m=>m.status==='scheduled'),past=data.meetings.filter(m=>m.status!=='scheduled');
    const group=(title,list)=>list.length?`<section class="vn-group"><h2>${e(title)} <span>${num(e,list.length)}</span></h2>${list.map(meeting).join('')}</section>`:'';
    const overdue=data.my_open_items.filter(i=>i.overdue).length;
    return `<section class="panel panel-body vn-head"><p>${e(data.privacy)}</p><p class="subtle">${e(data.note)}</p>
      ${data.counterparts.length?`<div class="operation-actions">${button('schedule_meeting','','جدولة لقاء')}</div>`:'<p class="subtle">اللقاء الفردي يكون بين الموظف ومديره المباشر، وحسابك ما له مدير مسجّل ولا فريق يرفع له.</p>'}</section>
      <section class="vn-board"><div class="vn-tiles">${tile(e,scheduled.length,'لقاء مجدول')}${tile(e,data.meetings.filter(m=>m.status==='held').length,'لقاء منعقد')}${tile(e,data.my_open_items.length,'بند متابعة عليّ',data.my_open_items.length?'is-due':'')}${tile(e,overdue,'بند متأخر',overdue?'is-late':'')}</div>
      <section class="vn-block"><div class="panel-head"><h2>بنودي المفتوحة</h2></div>${mine?`<ul class="vn-list">${mine}</ul>`:'<p class="subtle">بنود المتابعة اللي عليك من لقاءاتك تطلع هنا.</p>'}</section>${cadence}</section>
      ${group('اللقاءات المجدولة',scheduled)}${group('لقاءات سابقة',past)}
      ${data.meetings.length||!data.counterparts.length?'':ui.empty('ما فيه لقاءات للحين','حدّد موعد أول لقاء من «جدولة لقاء»، واكتبوا أجندتكم قبله.')}`;
  },
  form(action,id,data){
    if(action==='schedule_meeting'){
      guard(data.counterparts.length);
      return {title:'جدولة لقاء فردي',endpoint:'/one-to-ones',idempotent:true,
        fields:[field('counterpart_id','مع مين','select',{options:data.counterparts.map(p=>({value:p.id,label:p.name}))}),field('scheduled_on','الموعد','date',{hint:'الطرفين يكتبون أجندتهم قبل هالتاريخ.'})],
        toPayload:v=>({counterpart_id:v.counterpart_id,scheduled_on:v.scheduled_on})};
    }
    if(itemLabels[action]){
      const meeting=data.meetings.find(m=>m.follow_ups.some(f=>f.id===id)),item=meeting?.follow_ups.find(f=>f.id===id);
      guard(item&&item.actions.includes(action));
      return {title:`${itemLabels[action]} — ${item.item}`,endpoint:`/one-to-ones/items/${id}/${action}`,
        fields:[field('note',action==='complete_item'?'وش اللي انجز؟':'ليش انسقط البند؟','textarea')],
        toPayload:v=>({version:item.version,note:v.note})};
    }
    const m=data.meetings.find(x=>x.id===id);guard(m&&m.actions.includes(action));
    const spec=(fields,toPayload)=>({title:`${meetingLabels[action]} — ${m.scheduled_on}`,endpoint:`/one-to-ones/${id}/${action}`,fields,toPayload:v=>({version:m.version,...toPayload(v)})});
    if(action==='add_agenda')return spec([field('topic','بند الأجندة','text',{maxLength:600,hint:'يشوفه الطرف الثاني، وما يشوفه أحد غيركم.'})],v=>({topic:v.topic}));
    if(action==='save_private_note')return spec([field('note','ملاحظتك الخاصة','textarea',{maxLength:3000,value:m.my_private_note,hint:'لك بروحك: ما يشوفها الطرف الثاني ولا الموارد البشرية. تنحفظ نسخة وحدة تاخذ مكان اللي قبلها.'})],v=>({note:v.note}));
    if(action==='add_follow_up')return spec([field('item','البند','text',{maxLength:600}),field('owner_id','صاحب البند','select',{options:[{value:data.user_id,label:'أنا'},{value:m.other_id,label:m.other_name}]}),field('due_date','الموعد','date')],v=>({item:v.item,owner_id:v.owner_id,due_date:v.due_date}));
    if(action==='record_held')return spec([field('shared_notes','محضر اللقاء المشترك','textarea',{maxLength:6000,hint:'يقرؤه الطرفين وينقفل بعد التسجيل، والتصحيح يكون بلقاء جديد. لا تكتب هنا شي تبيه خاص.'})],v=>({shared_notes:v.shared_notes}));
    return spec([field('reason','سبب الإلغاء','textarea',{maxLength:600})],v=>({reason:v.reason}));
  }
};

const requestLabels={answer_request:'إجابة الطلب',decline_request:'اعتذار عن الإجابة'};
export const feedbackUI={
  title:'التغذية الراجعة',
  description:'ملاحظة يكتبها زميل أو مدير في وقتها، بنوعها ومين يشوفها. الملاحظة ملك كاتبها واللي انكتبت عنه، وتوصل المقيِّم دليل يقرؤه — مو درجة تنحسب.',
  load:api=>api('/feedback'),
  render(data,{e,button}){
    const note=n=>`<li class="${n.withdrawn?'is-old':''}"><strong>${e(n.kind_name)} · ${n.about_me?'عني':`عن ${e(n.subject_name)}`} — ${e(n.author_name)}</strong>
      <span>${when(e,n.occurred_on)} · ${e(n.visibility_name)}${n.from_request?' · ردّ على طلب':''}${n.withdrawn?' · مسحوبة':''}</span>
      <small>${e(n.body)}${n.withdrawn&&n.withdrawal_reason?` — سبب السحب: ${e(n.withdrawal_reason)}`:''}</small>${acts(e,button,n,{withdraw_note:'سحب الملاحظة'})}</li>`;
    // الطلب المفتوح الموجّه لي ينتظر ردّي، فيُعلَّم وكلمة «مفتوح» معه.
    const requests=(list,toMe)=>list.map(r=>`<li class="${toMe&&r.status==='open'?'is-due':''}"><strong>${e(r.question)}</strong><span>${e(r.counterpart_name)} · ${e({open:'مفتوح',answered:'أُجيب',declined:'اعتُذر عنه'}[r.status])}${r.decline_reason?` — ${e(r.decline_reason)}`:''}</span>${acts(e,button,r,requestLabels)}</li>`).join('');
    const evidence=data.evidence.map(x=>`<section class="vn-block"><div class="panel-head"><h2>أدلة تقييم — ${e(x.employee_name)} · ${e(x.cycle_name)}</h2></div>
      <p class="subtle measure">${when(e,x.period_from)} إلى ${when(e,x.period_to)} · ${e(x.rule)}</p>
      ${x.notes.length?`<ul class="vn-list">${x.notes.map(note).join('')}</ul>`:'<p class="subtle">الملاحظات اللي تشملك مرئيتها عنه في فترة الدورة تطلع هنا.</p>'}</section>`).join('');
    const openToMe=data.requests_to_me.filter(r=>r.status==='open').length;
    return `<section class="panel panel-body vn-head"><p>${e(data.ownership)}</p><p class="subtle">${e(data.note)}</p>
      <div class="operation-actions">${button('write_feedback','','كتابة ملاحظة')}${button('request_feedback','','طلب تغذية راجعة')}</div></section>
      <section class="vn-board"><div class="vn-tiles">${tile(e,data.received,'ملاحظة عني')}${tile(e,data.given,'ملاحظة كتبتها')}${tile(e,openToMe,'طلب ينتظر إجابتي',openToMe?'is-due':'')}${tile(e,data.my_requests.filter(r=>r.status==='open').length,'طلب أرسلته وللحين مفتوح')}</div>
      <section class="vn-block"><div class="panel-head"><h2>طلبات وصلتني</h2></div>${data.requests_to_me.length?`<ul class="vn-list">${requests(data.requests_to_me,true)}</ul>`:'<p class="subtle">إذا طلب منك زميل رأيك في شغله، يطلع طلبه هنا.</p>'}</section>
      <section class="vn-block"><div class="panel-head"><h2>طلباتي</h2></div>${data.my_requests.length?`<ul class="vn-list">${requests(data.my_requests,false)}</ul>`:'<p class="subtle">تقدر تطلب رأي زميل في شغلك من «طلب تغذية راجعة».</p>'}</section>
      <section class="vn-block"><div class="panel-head"><h2>الملاحظات اللي تشملك مرئيتها</h2></div>${data.notes.length?`<ul class="vn-list">${data.notes.map(note).join('')}</ul>`:'<p class="subtle">تطلع هنا الملاحظات اللي تكتبها أو تنكتب عنك أو تشملك مرئيتها.</p>'}</section>${evidence}</section>`;
  },
  form(action,id,data){
    const kinds=data.kinds.map(k=>({value:k.key,label:k.name})),visibility=data.visibility_options.map(k=>({value:k.key,label:k.name}));
    const visibilityHint='المرئية تنكتب مع الملاحظة وما تتغير بعدها. «للمستلم فقط» يعني مديره ما يقرأها، وما تصلح دليل في تقييمه.';
    if(action==='write_feedback')return {title:'ملاحظة في حينها',endpoint:'/feedback/notes',idempotent:true,
      fields:[field('subject_id','عن مين','select',{options:data.colleagues.map(p=>({value:p.id,label:p.name}))}),field('kind','النوع','select',{options:kinds}),field('visibility','مين يشوفها','select',{options:visibility,hint:visibilityHint}),
        field('occurred_on','تاريخ الموقف','date',{value:data.today}),field('body','الملاحظة','textarea',{maxLength:4000,hint:'موقف محدد وأثره، مو وصف للشخص.'})],
      toPayload:v=>({subject_id:v.subject_id,kind:v.kind,visibility:v.visibility,occurred_on:v.occurred_on,body:v.body})};
    if(action==='request_feedback')return {title:'طلب تغذية راجعة',endpoint:'/feedback/requests',idempotent:true,
      fields:[field('respondent_id','مين الزميل','select',{options:data.colleagues.map(p=>({value:p.id,label:p.name}))}),field('question','سؤالك المحدد','textarea',{maxLength:1000,hint:'اسأل عن شغل محدد عشان يكون الرد مفيد.'})],
      toPayload:v=>({respondent_id:v.respondent_id,question:v.question})};
    if(action==='withdraw_note'){
      const n=[...data.notes,...data.evidence.flatMap(x=>x.notes)].find(x=>x.id===id);
      guard(n&&n.actions.includes(action));
      return {title:'سحب ملاحظة كتبتها',endpoint:`/feedback/notes/${id}/withdraw_note`,
        fields:[field('reason','سبب السحب','textarea',{maxLength:600,hint:'الملاحظة تبقى محفوظة عند كاتبها واللي انكتبت عنه مع سبب سحبها، ويوقف عرضها لأي أحد غيرهم.'})],
        toPayload:v=>({version:n.version,reason:v.reason})};
    }
    const r=data.requests_to_me.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    if(action==='answer_request')return {title:`إجابة — ${r.counterpart_name}`,endpoint:`/feedback/requests/${id}/answer_request`,
      fields:[field('kind','النوع','select',{options:kinds}),field('visibility','مين يشوفها','select',{options:visibility,hint:visibilityHint}),field('body','ردّك','textarea',{maxLength:4000})],
      toPayload:v=>({version:r.version,kind:v.kind,visibility:v.visibility,body:v.body})};
    return {title:`اعتذار — ${r.counterpart_name}`,endpoint:`/feedback/requests/${id}/decline_request`,
      fields:[field('reason','سبب الاعتذار','textarea',{maxLength:600})],toPayload:v=>({version:r.version,reason:v.reason})};
  }
};

const nominationLabels={approve_nomination:'اعتماد المقيِّم',reject_nomination:'رفض الترشيح'};
export const review360UI={
  title:'تقييم 360',
  description:'تقييم ذاتي وأقران وصاعد داخل دورة التقييم القائمة. المقيِّمين يعتمدهم طرف ثالث، والتقييم الصاعد ما ينعرض إلا مجمّع وبعد ما يبلغ الحد اللي يحدده مدير الموارد البشرية.',
  load:api=>api('/review-360'),
  render(data,{e,button,ui}){
    // الدورة h2، ولوحة كل شخص h3، ونتائجها حسب المصدر h4.
    const response=r=>`<li><strong>اللي يسويه زين</strong><span>${e(r.strengths)}</span><small>اللي يحتاج يطوّره: ${e(r.improvements)}</small></li>`;
    // العدد في العنوان حين توجد ردود فقط؛ وبلا ردود سطرٌ واحد يقول ذلك، لا «(0)» ثم «ما فيه».
    const answers=(title,list)=>list.length?`<h4>${e(title)} (${num(e,list.length)})</h4><ul class="vn-list">${list.map(response).join('')}</ul>`:`<h4>${e(title)}</h4><p class="subtle">ما وصل رد من هالمصدر.</p>`;
    // لوحة بلا مقيِّمين مرشحين نتائجها فارغة حتمًا، فلا تُرسم أقسامها؛ وسطر «لمن النتائج» (results_note) يبقى حيث يأتي.
    const panel=(c,p)=>`<section class="vn-block"><div class="panel-head"><h3>${e(p.subject_name)}${p.is_me?' · لوحتي':''}</h3></div>
      ${p.nominations.length?`<ul class="vn-list">${p.nominations.map(n=>`<li class="${n.status==='rejected'?'is-old':''}"><strong>${e(n.source_name)} — ${e(n.rater_name)}</strong><span>${e(n.status_name)}${n.decided_by_name?` · قرّره ${e(n.decided_by_name)}`:''}${n.answered===true?' · جاوب':n.answered===false?' · ما جاوب للحين':''}${n.decision_note?` — ${e(n.decision_note)}`:''}</span>${acts(e,button,{...n,id:`${c.id}:${n.id}`},nominationLabels)}</li>`).join('')}</ul>`:`<p class="subtle">${p.can_nominate?'المقيِّمين ينرشّحون من «ترشيح مقيِّم»، ويعتمدهم طرف ثالث.':'ما انرشّح مقيِّمين لهاللوحة.'}</p>`}
      ${p.results&&!p.nominations.length?'':p.results?`${answers('التقييم الذاتي',p.results.self)}${answers('تقييم الأقران',p.results.peer)}
        <h4>التقييم الصاعد · مجمّع</h4><p class="subtle measure">${e(p.results.upward_note)}</p>
        ${p.results.upward.length?`<ul class="vn-list">${p.results.upward.map(response).join('')}</ul>`:''}
        <p class="subtle measure">${e(p.results.rule)}</p>`:`<p class="subtle">${e(p.results_note)}</p>`}
      ${p.can_nominate?`<div class="operation-actions">${button('nominate_rater',`${c.id}:${p.subject_id}`,'ترشيح مقيِّم')}</div>`:''}</section>`;
    const cycles=data.cycles.map(c=>`<section class="panel panel-body"><h2>${e(c.name)} <span class="badge ${e(c.status)}">${e(c.status_name)}</span></h2>
      <p class="subtle">${when(e,c.period_from)} إلى ${when(e,c.period_to)}</p>
      ${c.my_tasks.length?`<section class="vn-block"><div class="panel-head"><h3>تقييمات عليّ</h3></div><ul class="vn-list">${c.my_tasks.map(t=>`<li class="is-due"><strong>${e(t.source_name)} — ${e(t.subject_name)}</strong><span>${t.actions.length?'معتمدة من طرف ثالث وتنتظر ردّك':'معتمدة من طرف ثالث، وترسل ردّك لما تنفتح الدورة'}</span>${acts(e,button,{...t,id:`${c.id}:${t.id}`},{submit_360:'كتابة استجابتي'})}</li>`).join('')}</ul></section>`:''}
      ${c.panels.map(p=>panel(c,p)).join('')}</section>`).join('');
    // حدّ الكشف قاعدة سارية: قيمتها وتاريخها وأساسها. من أكّدها في أساسها وفي سجل التدقيق، لا في سطرها.
    const threshold=data.threshold
      ? `<p><strong>الحد الأدنى لعرض التقييم الصاعد: ${num(e,data.threshold.min_upward_respondents)}</strong> · تأكّد في ${when(e,data.threshold.confirmed_on)}</p><p class="subtle measure">الأساس: ${e(data.threshold.basis)}</p>`
      : `<div class="vn-alert${data.can_set_threshold?' is-due':''}"><strong>${e(data.threshold_note)}</strong></div>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.confidentiality)}</p><p class="subtle">${e(data.note)}</p>
      ${threshold}
      ${data.can_set_threshold?`<div class="operation-actions">${button('set_threshold','','تحديد حد كشف التقييم الصاعد')}</div>`:''}</section>
      ${cycles||ui.empty('ما فيه دورة تقييم قائمة للحين','تقييم 360 يصير داخل دورة تقييم الأداء، مو دورة لحاله. أول ما تنفتح دورة في «تقييم الأداء» تطلع هنا.')}`;
  },
  form(action,id,data){
    if(action==='set_threshold'){
      guard(data.can_set_threshold);
      return {title:'حد كشف التقييم الصاعد',endpoint:'/review-360/threshold',
        fields:[field('min_upward_respondents','أقل عدد مستجيبين قبل العرض','number',{min:3,max:20,value:data.threshold?.min_upward_respondents??'',hint:'القرار قرارك. باثنين يقدر واحد يطرح نصه وينكشف نص الثاني، عشان كذا أقل حد ثلاثة. والحد يثبت في كل دورة لحظة فتحها.'}),
          field('basis','أساس القرار ومصدره','textarea',{maxLength:1000}),field('confirmed_on','تاريخ تأكيدك','date',{value:data.today})],
        toPayload:v=>({min_upward_respondents:Number(v.min_upward_respondents),basis:v.basis,confirmed_on:v.confirmed_on})};
    }
    const [cycleId,key]=String(id).split(':'),cycle=data.cycles.find(c=>c.id===cycleId);guard(cycle);
    if(action==='nominate_rater'){
      const p=cycle.panels.find(x=>x.subject_id===key);guard(p&&p.can_nominate);
      return {title:`ترشيح مقيِّم — ${p.subject_name}`,endpoint:'/review-360/nominations',idempotent:true,
        fields:[field('source','مصدر التقييم','select',{options:data.sources.map(s=>({value:s.key,label:s.name}))}),
          field('rater_id','المقيِّم','select',{options:data.people.map(x=>({value:x.id,label:x.name})),hint:'الصاعد من فريقه المباشر، والقرين زميل مو مديره ولا من فريقه، والذاتي هو صاحب اللوحة نفسه.'})],
        toPayload:v=>({cycle_id:cycleId,subject_id:p.subject_id,rater_id:v.rater_id,source:v.source})};
    }
    if(action==='submit_360'){
      const task=cycle.my_tasks.find(t=>t.id===key);guard(task&&task.actions.includes(action));
      return {title:`استجابتي — ${task.subject_name}`,endpoint:`/review-360/nominations/${key}/submit`,
        fields:[field('strengths','وش اللي يسويه زين؟ مع دليل','textarea',{maxLength:3000}),field('improvements','وش اللي يحتاج يطوّره؟ مع دليل','textarea',{maxLength:3000,hint:'ردّك ينحفظ بدون هوية كاتبه. وفي التقييم الصاعد ما ينعرض للي انكتب عنه إلا مجمّع وبعد ما يبلغ الحد المسجّل.'})],
        toPayload:v=>({strengths:v.strengths,improvements:v.improvements})};
    }
    const n=cycle.panels.flatMap(p=>p.nominations).find(x=>x.id===key);guard(n&&n.actions.includes(action));
    return {title:`${nominationLabels[action]} — ${n.source_name}`,endpoint:`/review-360/nominations/${key}/${action}`,
      fields:[field('note','أساس القرار','textarea',{maxLength:1000,hint:'أنت طرف ثالث: مو المقيَّم ولا اللي رشّح ولا المقيِّم. اذكر ليش هالاختيار متوازن.'})],
      toPayload:v=>({version:n.version,note:v.note})};
  }
};
