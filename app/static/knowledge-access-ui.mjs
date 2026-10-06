// ثلاث شاشات ضبط داخلي: صدق قاعدة المعرفة، وإقرار الاطلاع على نسخة سياسة بعينها، وحملات مراجعة الصلاحيات.
import { dual } from './dates.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const tileOf=e=>(value,label,t='')=>`<div class="vn-tile ${t}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
const actionsOf=(button,list,id,labels)=>list.length?`<div class="operation-actions">${list.map(a=>button(a,id,labels[a])).join('')}</div>`:'';
// الوقت بتوقيت الرياض (UTC+3 طوال السنة، بلا توقيت صيفي): الختم المخزّن بتوقيت غرينتش كان يُعرض كما هو بلاحقة «UTC».
const riyadh=iso=>new Date(Date.parse(iso)+3*3600e3).toISOString().slice(0,16).replace('T',' ');

/* ───── أ) قاعدة المعرفة ───── */
const sourceLabels={verify_source:'راجعته وما زال صحيحًا',request_update:'يحتاج تحديثًا',edit_source:'تعديل',retire_source:'سحب المصدر'};
const stateClass={verified:'is-ok',due_soon:'is-due',expired:'is-late',unverified:'is-late',retired:'is-old'};
export const knowledgeUI={
  title:'صدق قاعدة المعرفة',description:'لكل سياسة أو بطاقة خدمة أو إجراء مالك يأكّد صحته دوريًا باسمه وتاريخه. والمصدر المنتهي يبقى ظاهرًا بتحذير صريح وما ينحجب.',
  load:api=>api('/knowledge'),
  render(data,{e,button}){
    const tile=tileOf(e),h=data.honesty;
    const row=s=>`<li class="${stateClass[s.state]??''}"><strong>${e(s.kind_name)}: ${e(s.title)}</strong><span>${e(s.state_name)}${s.update_requested?' · طلب مالكه تحديثه':''} · المالك ${e(s.owner_name)} · آخر تحقق ${s.last_verified_on?e(dual(s.last_verified_on)):'ما تحقّق للحين'} · ${s.last_verified_on?`صالح حتى ${e(dual(s.expires_on))}`:'بلا تاريخ صلاحية لين يأكّده مالكه'} · المراجعة كل ${e(s.review_interval_days)} يومًا · استُشهد به ${e(s.citations)} مرة</span>${s.warning?`<small class="vn-alert">${e(s.warning)}</small>`:''}${s.status==='retired'?`<small class="muted">مسحوب: ${e(s.retire_reason)}</small>`:''}${actionsOf(button,s.actions,s.id,sourceLabels)}</li>`;
    const risky=h?.cited_and_stale.length?`<section class="vn-block"><h3>الأكثر استشهادًا وهو غير متحقق منه حديثًا</h3><p class="subtle">أخطر شي في قاعدة المعرفة: مصدر يعتمد عليه المساعد كثير وما أكّده مالكه. العدّ من تشغيلات آخر ${e(data.citation_window_days)} يومًا.</p><ul class="vn-list">${h.cited_and_stale.map(s=>`<li class="is-late"><strong>${e(s.title)} · ${e(s.citations)} استشهادًا</strong><span>${e(s.state_name)} · المالك ${e(s.owner_name)} · آخر تحقق ${e(s.last_verified_on??'ما تحقّق')}</span></li>`).join('')}</ul></section>`:'';
    const orphan=h?.cited_unregistered.length?`<section class="vn-block"><h3>يُستشهد به ولا مالك له</h3><ul class="vn-list">${h.cited_unregistered.map(c=>`<li class="is-due"><strong>${e(c.kind_name)}: ${c.title?e(c.title):`<bdi>${e(c.reference)}</bdi>`} · ${e(c.citations)} استشهادًا</strong><span>سجّله مصدرًا وسمِّ مالكه عشان ينراجع دوريًا.</span></li>`).join('')}</ul></section>`:'';
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${data.can_manage?`<div class="operation-actions">${button('register_source','','تسجيل مصدر')}</div>`:''}</section>
      ${h?`<section class="vn-board"><div class="vn-tiles">${tile(h.verified_percent===null?'—':`${h.verified_percent}%`,'متحقق منه ضمن دوريته',h.verified_percent===100?'is-ok':h.verified_percent===null?'':'is-due')}${tile(h.expired,'تجاوز تاريخ مراجعته',h.expired?'is-late':'')}${tile(h.unverified,'لم يؤكده مالكه بعد',h.unverified?'is-late':'')}${tile(h.update_requested,'طلب مالكه تحديثه',h.update_requested?'is-due':'')}${tile(h.due_soon,`تحل مراجعته خلال ${data.remind_days} يومًا`)}</div>${risky}${orphan}</section>`:''}
      <section class="panel panel-body"><section class="vn-block"><h3>${data.can_manage?'كل المصادر':'المصادر التي تملكها'}</h3>${data.sources.length?`<ul class="vn-list">${data.sources.map(row).join('')}</ul>`:`<p class="subtle">${data.can_manage?'ما فيه مصادر مسجّلة. ابدأ بالسياسات المعتمدة والبطاقات المنشورة.':'ما فيه مصادر مسندة لك.'}</p>`}</section></section>`;
  },
  form(action,id,data){
    const people=data.people.map(p=>({value:p.id,label:p.name}));
    if(action==='register_source'){guard(data.can_manage);
      return {title:'تسجيل مصدر معرفي',endpoint:'/knowledge/sources',idempotent:true,fields:[field('kind','النوع','select',{options:Object.entries(data.kinds).map(([value,label])=>({value,label}))}),
        field('reference','المرجع في المنصة','select',{required:false,options:[{value:'',label:'— إجراء خارج المنصة —'},...data.candidates.map(c=>({value:`${c.kind}|${c.reference}`,label:`${data.kinds[c.kind]}: ${c.title}`}))],hint:'للسياسة وبطاقة الخدمة اختر سجلها المعتمد. الإجراء لا سجل له هنا؛ اكتب مكانه في الحقل التالي.'}),
        field('location_note','مكان المصدر','text',{required:false}),field('title','العنوان'),field('owner_id','المالك الذي يؤكد صحته','select',{options:people,hint:'لا تسمِّ نفسك: من يسجل المصدر لا يكون مالكه.'}),
        field('review_interval_days','دورية المراجعة بالأيام','number',{min:7,max:1095,hint:'يحددها صاحب المصدر بحسب سرعة تغير موضوعه؛ لا قيمة افتراضية.'})],
        toPayload:v=>{const [kind,reference]=v.reference?v.reference.split('|'):[v.kind,''];return {kind:v.reference?kind:v.kind,reference,title:v.title,location_note:v.location_note||'',owner_id:v.owner_id,review_interval_days:Number(v.review_interval_days)};}};}
    const s=data.sources.find(x=>x.id===id);guard(s&&s.actions.includes(action));
    if(action==='verify_source')return {title:`تأكيد صحة — ${s.title}`,endpoint:`/knowledge/sources/${id}/verify_source`,fields:[field('note','ما الذي راجعته','textarea',{hint:`باسمك وبتاريخ اليوم: راجعته وما زال صحيحًا. يمتد صلاحه ${s.review_interval_days} يومًا.`})],toPayload:v=>({version:s.version,note:v.note})};
    if(action==='request_update')return {title:`طلب تحديث — ${s.title}`,endpoint:`/knowledge/sources/${id}/request_update`,fields:[field('note','ما الذي يحتاج تحديثًا','textarea',{hint:'الطلب لا يمدد الصلاحية؛ يبقى المصدر موسومًا حتى تؤكده بعد تحديثه.'})],toPayload:v=>({version:s.version,note:v.note})};
    if(action==='retire_source')return {title:`سحب — ${s.title}`,endpoint:`/knowledge/sources/${id}/retire_source`,fields:[field('reason','السبب','textarea',{hint:'المصدر المسحوب يبقى في السجل ولا يُحذف.'})],toPayload:v=>({version:s.version,reason:v.reason})};
    return {title:`تعديل — ${s.title}`,endpoint:`/knowledge/sources/${id}/edit_source`,fields:[field('title','العنوان','text',{value:s.title}),field('location_note','مكان المصدر','text',{required:false,value:s.location_note}),field('owner_id','المالك','select',{value:s.owner_id,options:people}),field('review_interval_days','دورية المراجعة بالأيام','number',{min:7,max:1095,value:s.review_interval_days}),field('reason','سبب التعديل','textarea',{hint:'تغيير المالك أو الدورية لا يُعد تحققًا.'})],
      toPayload:v=>({version:s.version,title:v.title,location_note:v.location_note||'',owner_id:v.owner_id,review_interval_days:Number(v.review_interval_days),reason:v.reason})};
  }
};

/* ───── ب) إقرار الاطلاع على السياسات ───── */
const roundLabels={remind_round:'تذكير من لم يقر',sync_recipients:'إضافة الملتحقين بالفئة',close_round:'إغلاق الجولة'};
export const policyAcknowledgementsUI={
  title:'إقرار الاطلاع على السياسات',description:'لما تنعتمد نسخة سياسة، الفئة المعنية تقر بالاطلاع عليها: مين أقر ومتى وعلى أي نسخة. ضبط داخلي، مو توقيع ولا إلزام نظامي، والتذكير داخل المنصة بس.',
  load:api=>api('/policy-acknowledgements'),
  render(data,{e,button}){
    const tile=tileOf(e);
    const mine=data.pending_mine.map(p=>`<li class="${p.late?'is-late':'is-due'}"><strong>${e(p.title)} — النسخة ${e(p.policy_revision)}</strong><span>${e(p.kind_name)} · سارية من ${e(dual(p.effective_from))} · مطلوب قبل ${e(dual(p.due_on))}${p.reminder_count?` · ذُكّرت ${e(p.reminder_count)} مرة`:''}</span>${actionsOf(button,p.actions,p.id,{acknowledge_policy:'قراءة النص والإقرار'})}</li>`).join('');
    const rounds=data.rounds.map(r=>`<li class="${r.late?'is-late':r.status==='closed'?'is-old':''}"><strong>${e(r.policy_title)} — النسخة ${e(r.policy_revision)} · ${e(r.status_name)}</strong><span>${e(r.audience_name)} · أقر ${e(r.acknowledged)} من ${e(r.requested)} · الموعد ${e(dual(r.due_on))} · المالك ${e(r.owner_name)}${r.reminder_count?` · ذُكّر ${e(r.reminder_count)} مرة`:''}</span>
      ${r.pending.length?`<small>لم يقر بعد: ${r.pending.map(p=>e(p.name)).join('، ')}</small>`:''}${r.status==='closed'?`<small class="muted">أُغلقت ${e(r.closed_at.slice(0,10))}: ${e(r.close_note)}</small>`:''}${actionsOf(button,r.actions,r.id,roundLabels)}</li>`).join('');
    const without=data.policies_without_round.map(p=>`<li class="is-due"><strong>${e(p.title)} — النسخة ${e(p.policy_revision)}</strong><span>${e(p.kind_name)} · سارية من ${e(dual(p.effective_from))} · ما انطلب الإقرار بها</span>${actionsOf(button,p.actions,p.id,{open_round:'طلب الإقرار'})}</li>`).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">${tile(data.pending_mine.length,'بانتظار إقرارك',data.pending_mine.length?'is-due':'is-ok')}${tile(data.my_acknowledgements.length,'إقرارات سابقة لك')}${data.can_oversee?tile(data.policies_without_round.length,'نسخة معتمدة بلا طلب إقرار',data.policies_without_round.length?'is-due':''):''}</div></section>
      ${mine?`<section class="panel panel-body"><section class="vn-block"><h3>بانتظار إقرارك</h3><ul class="vn-list">${mine}</ul></section></section>`:''}
      ${without?`<section class="panel panel-body"><section class="vn-block"><h3>نسخ معتمدة لم يُطلب الإقرار بها</h3><ul class="vn-list">${without}</ul></section></section>`:''}
      ${rounds?`<section class="panel panel-body"><section class="vn-block"><h3>جولات الإقرار</h3><ul class="vn-list">${rounds}</ul></section></section>`:''}
      ${data.my_acknowledgements.length?`<section class="panel panel-body"><section class="vn-block"><h3>إقراراتك</h3><ul class="vn-list">${data.my_acknowledgements.map(a=>`<li class="is-ok"><strong>${e(a.policy_title)} — النسخة ${e(a.policy_revision)}</strong><span>${e(a.kind_name)} · أقريت <time datetime="${e(a.acknowledged_at)}">${e(riyadh(a.acknowledged_at))}</time></span></li>`).join('')}</ul></section></section>`:''}`;
  },
  form(action,id,data){
    if(action==='acknowledge_policy'){const p=data.pending_mine.find(x=>x.id===id);guard(p);
      return {title:`${p.title} — النسخة ${p.policy_revision}`,endpoint:`/policy-acknowledgements/rounds/${id}/acknowledge`,fields:[field('text','نص السياسة','textarea',{required:false,value:p.body,hint:'اقرأ النص كاملًا. إقرارك يخص هذه النسخة وحدها؛ نسخة جديدة تحتاج إقرارًا جديدًا.'}),field('confirm','اطلعت على نص هذه النسخة','checkbox',{hint:'إقرار اطلاع داخلي، لا توقيع ولا إلزام نظامي.'})],
        toPayload:v=>({policy_revision:p.policy_revision,confirm:v.confirm==='on'})};}
    if(action==='open_round'){const p=data.policies_without_round.find(x=>x.id===id);guard(p&&data.can_oversee);
      return {title:`طلب الإقرار — ${p.title} (النسخة ${p.policy_revision})`,endpoint:'/policy-acknowledgements/rounds',idempotent:true,fields:[field('audience','الفئة المعنية','select',{options:Object.entries(data.audiences).map(([value,label])=>({value,label}))}),
        field('audience_value','الإدارة أو الدور','select',{required:false,options:[{value:'',label:'— لكل الموظفين —'},...data.departments.map(d=>({value:`department|${d.id}`,label:`إدارة: ${d.name}`})),...Object.entries(data.roles).map(([value,label])=>({value:`role|${value}`,label:`دور: ${label}`}))]}),
        field('due_on','الإقرار مطلوب قبل','date')],
        toPayload:v=>({policy_id:p.id,audience:v.audience,audience_value:v.audience==='all'?'':(v.audience_value||'').split('|')[1]??'',due_on:v.due_on})};}
    const r=data.rounds.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    if(action==='sync_recipients')return {title:`${roundLabels[action]} — ${r.policy_title}`,endpoint:`/policy-acknowledgements/rounds/${id}/sync_recipients`,fields:[],toPayload:()=>({version:r.version})};
    return {title:`${roundLabels[action]} — ${r.policy_title}`,endpoint:`/policy-acknowledgements/rounds/${id}/${action}`,fields:[field('note',action==='close_round'?'ملاحظة الإغلاق':'ملاحظة التذكير','textarea',{required:action==='close_round',hint:action==='close_round'?'من لم يقر يبقى مسجلًا «لم يقر» في الجولة المغلقة.':'التذكير يظهر لهم داخل المنصة؛ لا بريد ولا رسائل.'})],toPayload:v=>({version:r.version,note:v.note||undefined})};
  }
};

/* ───── ج) حملات مراجعة الصلاحيات ───── */
const itemLabels={keep_access:'أُبقيه',revoke_access:'أسحبه'},requestLabels={execute_revocation:'نفذت السحب',decline_revocation:'رد الطلب'};
export const accessReviewsUI={
  title:'مراجعة الصلاحيات',description:'حملة دورية يقرر فيها كل مدير لكل تصريح عند اللي يتبعونه: أُبقيه أو أسحبه. السحب طلب ينفّذه صاحب صلاحية منح التصاريح بنفسه، والمنصة ما تسحب تلقائيًا. والحملة المغلقة دليل مؤرّخ ما يتعدّل.',
  load:api=>api('/access-reviews'),
  render(data,{e,button}){
    const tile=tileOf(e);
    const item=i=>`<li class="${i.usage_state==='unused'?'is-late':i.sensitive?'is-due':i.decision?'is-old':''}"><strong>${e(i.subject_name)} — ${e(i.capability_name)}${i.sensitive?' <span class="badge">حساس</span>':''}${i.usage_state==='unused'?' <span class="badge">لم يُستعمل</span>':''}</strong><span>${e(i.source_name)} · ${e(i.usage_name)}${i.last_used_at?` · آخر أثر ${e(i.last_used_at.slice(0,10))}`:''} · المراجع ${e(i.reviewer_name)} · ${e(i.decision_name)}${i.decided_at?` ${e(i.decided_at.slice(0,10))}`:''}</span>${i.reason?`<small>${e(i.reason)}</small>`:''}${actionsOf(button,i.actions,i.id,itemLabels)}</li>`;
    const campaign=c=>`<section class="panel panel-body"><div class="panel-head"><h2>${e(c.title)} · ${e(c.status_name)}</h2><span class="subtle">فُتحت ${e(c.opened_at.slice(0,10))} · الاستعمال من ${e(dual(c.usage_since))} · الموعد ${e(dual(c.due_on))}${c.closed_at?` · أُغلقت ${e(c.closed_at.slice(0,10))}`:''}</span></div>
      <div class="vn-tiles">${tile(c.totals.undecided,'لم يُراجع',c.totals.undecided?(c.late?'is-late':'is-due'):'is-ok')}${tile(c.totals.keep,'أُبقي')}${tile(c.totals.revoke,'طُلب سحبه')}${tile(c.totals.sensitive,'حساس')}${tile(c.totals.unused,'لم يُستعمل',c.totals.unused?'is-late':'')}</div>
      ${c.reviewers.length?`<p class="subtle">المراجعون: ${c.reviewers.map(r=>`${e(r.name)} (${e(r.items-r.undecided)}/${e(r.items)})`).join('، ')}</p>`:''}${c.close_note?`<p class="muted">${e(c.close_note)}</p>`:''}
      <section class="vn-block">${c.items.length?`<ul class="vn-list">${c.items.map(item).join('')}</ul>`:'<p class="subtle">ما فيه بنود مسندة لك في هذي الحملة.</p>'}</section>${actionsOf(button,c.actions,c.id,{close_campaign:'إغلاق الحملة'})}</section>`;
    const requests=data.revocation_requests.map(r=>`<li class="${r.status==='open'?'is-due':'is-old'}"><strong>${e(r.subject_name)} — ${e(r.capability_name)}${r.sensitive?' <span class="badge">حساس</span>':''} · ${e(r.status_name)}</strong><span>طلبه ${e(r.requested_by_name)} ${e(r.requested_at.slice(0,10))}: ${e(r.reason)}</span><small>${e(r.how)}</small>${r.executed_by_name?`<small class="muted">${e(r.executed_by_name)} ${e(r.executed_at.slice(0,10))}: ${e(r.execution_note)}</small>`:''}${actionsOf(button,r.actions,r.id,requestLabels)}</li>`).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${actionsOf(button,data.actions,'',{open_campaign:'فتح حملة مراجعة'})}</section>
      ${data.campaigns.map(campaign).join('')||`<section class="panel panel-body"><p class="subtle">${data.can_oversee?'ما فيه حملات للحين.':'ما فيه حملات مسندة لك.'}</p></section>`}
      ${requests?`<section class="panel panel-body"><section class="vn-block"><h3>طلبات السحب</h3><ul class="vn-list">${requests}</ul></section></section>`:''}`;
  },
  form(action,id,data){
    if(action==='open_campaign'){guard(data.actions.includes('open_campaign'));const people=[{value:'',label:'— لا أحد —'},...data.people.map(p=>({value:p.id,label:p.name}))];
      return {title:'فتح حملة مراجعة الصلاحيات',endpoint:'/access-reviews/campaigns',idempotent:true,fields:[field('title','اسم الحملة'),field('usage_since','قياس الاستعمال منذ','date',{hint:'الاستعمال مستنتج من سجل التدقيق من هذا التاريخ.'}),field('due_on','موعد إنهاء المراجعة','date'),
        field('top_reviewer_id','المراجع الأعلى','select',{required:false,options:people,hint:'يراجع من لا مدير فوقه في المنصة (ومنهم الأدمن الأول). لا يكون أدمن أول.'}),field('second_reviewer_id','المراجع الثاني','select',{required:false,options:people,hint:'يراجع تصاريح المراجع الأعلى نفسه؛ لا أحد يراجع نفسه.'})],
        toPayload:v=>({title:v.title,usage_since:v.usage_since,due_on:v.due_on,top_reviewer_id:v.top_reviewer_id||undefined,second_reviewer_id:v.second_reviewer_id||undefined})};}
    if(action==='close_campaign'){const c=data.campaigns.find(x=>x.id===id);guard(c&&c.actions.includes(action));
      return {title:`إغلاق — ${c.title}`,endpoint:`/access-reviews/campaigns/${id}/close`,fields:[field('note','ملاحظة الإغلاق','textarea',{hint:'بعد الإغلاق لا يُعدَّل شيء: الحملة دليل مؤرخ للمدقق.'}),...(c.totals.undecided?[field('accept_incomplete',`أقر بالإغلاق مع ${c.totals.undecided} بندًا لم يُراجع`,'checkbox',{required:false})]:[])],
        toPayload:v=>({version:c.version,note:v.note,accept_incomplete:v.accept_incomplete==='on'})};}
    if(action in requestLabels){const r=data.revocation_requests.find(x=>x.id===id);guard(r&&r.actions.includes(action));
      return {title:`${requestLabels[action]} — ${r.capability_name} · ${r.subject_name}`,endpoint:`/access-reviews/revocations/${id}/${action}`,fields:[field('note',action==='execute_revocation'?'ما الذي نفذته':'سبب الرد','textarea',{hint:r.how})],toPayload:v=>({version:r.version,note:v.note})};}
    const i=data.campaigns.flatMap(c=>c.items).find(x=>x.id===id);guard(i&&i.actions.includes(action));
    const revoke=action==='revoke_access';
    return {title:`${itemLabels[action]} — ${i.capability_name} · ${i.subject_name}`,endpoint:`/access-reviews/items/${id}/decide`,fields:[field('reason',revoke?'سبب السحب':i.sensitive?'سبب الإبقاء على تصريح حساس':'ملاحظة','textarea',{required:revoke||i.sensitive,hint:revoke?'يُنشأ طلب سحب ينفذه صاحب صلاحية منح التصاريح؛ لا يُسحب شيء آليًا.':`${i.usage_name}. القرار يُسجَّل مرة واحدة.`})],
      toPayload:v=>({version:i.version,decision:revoke?'revoke':'keep',reason:v.reason||undefined})};
  }
};

export const knowledgeAccessModules={knowledge:knowledgeUI,'policy-acknowledgements':policyAcknowledgementsUI,'access-reviews':accessReviewsUI};
