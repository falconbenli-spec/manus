// تشغيل المنصة: طابور المهام، وأعلام الميزات، وجرد مساعدي الذكاء الاصطناعي وتقييمهم. شاشات لمسؤول المنصة.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
const tile=(e,value,label,t='')=>`<div class="vn-tile ${t}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
const alerts=(list,e)=>list?.length?`<div class="vn-alert">${list.map(a=>`<p>${e(a)}</p>`).join('')}</div>`:'';
const when=value=>value?String(value).replace('T',' ').slice(0,16):'—';
const reason=(label='السبب')=>field('reason',label,'textarea',{hint:'يُحفظ في سجل التدقيق باسمك.'});

/* ───── طابور المهام ───── */
export const jobsUI={
  title:'طابور المهام الخلفية',description:'اللي ينفّذه الخادم في الخلفية بعد قرار إنسان، واللي فشل وخلّص محاولاته. الطابور ما يقرر، وما يرسل شي برّا المنصة.',
  load:api=>api('/jobs'),
  render(data,{e,button}){
    const row=j=>`<li><strong><bdi dir="ltr">${e(j.type)}</bdi> · ${e(j.status_name)}</strong><span>نشأت عن ${e(j.source)} · طلبها ${e(j.requested_by_name)} · المحاولات ${e(j.attempts)}/${e(j.max_attempts)} · الاستحقاق ${e(when(j.due_at))}${j.handler_registered?'':' · لا معالج مسجلًا لنوعها'}</span>${j.last_error?`<span class="subtle">آخر خطأ: ${e(j.last_error)}</span>`:''}${j.payload?`<details><summary>الحمولة</summary><pre dir="ltr" translate="no">${e(JSON.stringify(j.payload,null,2))}</pre></details>`:''}<div class="operation-actions">${j.actions.includes('retry_job')?button('retry_job',j.id,'إعادة المحاولة'):''}${j.actions.includes('cancel_job')?button('cancel_job',j.id,'إلغاء'):''}</div></li>`;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${alerts(data.alerts,e)}</section>
      <section class="vn-board"><div class="vn-tiles">${tile(e,data.counts.dead,'ميتة تنتظر قرارك',data.counts.dead?'is-late':'is-ok')}${tile(e,data.counts.queued,'في الانتظار',data.counts.queued?'is-due':'')}${tile(e,data.counts.running,'قيد التنفيذ')}${tile(e,data.counts.done,'نُفذت')}${tile(e,data.counts.cancelled,'ملغاة')}</div>${data.oldest_queued_due_at?`<p class="subtle">أقدم مهمة منتظرة مستحقة منذ ${e(when(data.oldest_queued_due_at))}.</p>`:''}</section>
      <section class="panel panel-body"><h2>المهام الميتة</h2>${data.dead.length?`<ul class="vn-list">${data.dead.map(row).join('')}</ul>`:'<p class="muted">ما فيه مهام ميتة.</p>'}</section>
      <section class="panel panel-body"><h2>في الانتظار وقيد التنفيذ</h2>${data.pending.length?`<ul class="vn-list">${data.pending.map(row).join('')}</ul>`:'<p class="muted">الطابور فاضي.</p>'}</section>
      <section class="panel panel-body"><h2>آخر اللي انتهى</h2>${data.recent.length?`<ul class="vn-list">${data.recent.map(row).join('')}</ul>`:'<p class="muted">ما فيه شي للحين.</p>'}<p class="subtle">المعالجات المسجّلة: ${data.handlers.length?data.handlers.map(h=>`<bdi dir="ltr">${e(h.type)}</bdi>${h.sensitive?' (حساس)':''}`).join('، '):'ما فيه للحين'}.</p></section>`;
  },
  form(action,id,data){
    const j=[...data.dead,...data.pending].find(x=>x.id===id);guard(j&&j.actions.includes(action));
    if(action==='retry_job')return {title:`إعادة مهمة ميتة — ${j.type}`,endpoint:`/jobs/${id}/retry`,fields:[reason('لماذا تُعاد الآن؟ ما الذي تغيّر؟')],toPayload:v=>({version:j.version,reason:v.reason})};
    return {title:`إلغاء مهمة — ${j.type}`,endpoint:`/jobs/${id}/cancel`,fields:[reason('سبب الإلغاء')],toPayload:v=>({version:j.version,reason:v.reason})};
  }
};

/* ───── أعلام الميزات ───── */
export const featureFlagsUI={
  title:'أعلام الميزات',description:'مفاتيح تشغيل مؤقتة لميزات قيد الإطلاق، ولكل علم تاريخ انتهاء إلزامي. العلم مو صلاحية وما يتجاوز التصاريح.',
  load:api=>api('/feature-flags'),
  render(data,{e,button}){
    const cls={on:'is-ok',expiring:'is-due',expired:'is-late',off:'',retired:'is-old'};
    const count=s=>data.flags.filter(f=>f.state===s).length;
    const rows=data.flags.map(f=>`<li class="${cls[f.state]}"><strong><bdi dir="ltr">${e(f.key)}</bdi> · ${e(f.state_name)}</strong><span>${e(f.description)}</span><span class="subtle">النطاق: ${e(f.scope_name)}${f.target_names.length?` — ${f.target_names.map(e).join('، ')}`:''} · ينتهي ${e(f.expires_on)} · آخر تغيير ${e(f.updated_by_name)}</span><div class="operation-actions">${f.actions.includes('edit_flag')?button('edit_flag',f.id,'تعديل'):''}${f.actions.includes('retire_flag')?button('retire_flag',f.id,'سحب نهائي'):''}</div></li>`).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${alerts(data.alerts,e)}<div class="operation-actions">${button('new_flag','','علم جديد')}</div></section>
      <section class="vn-board"><div class="vn-tiles">${tile(e,count('on')+count('expiring'),'مضاء',count('on')+count('expiring')?'is-ok':'')}${tile(e,count('expiring'),'ينتهي خلال أسبوعين',count('expiring')?'is-due':'')}${tile(e,count('expired'),'منتهٍ يُعامل مطفأً',count('expired')?'is-late':'')}${tile(e,count('off'),'مطفأ')}${tile(e,count('retired'),'مسحوب')}</div></section>
      <section class="panel panel-body">${rows?`<ul class="vn-list">${rows}</ul>`:'<p class="muted">ما فيه أعلام للحين.</p>'}</section>`;
  },
  form(action,id,data){
    const f=id?data.flags.find(x=>x.id===id):null;
    if(action==='retire_flag'){guard(f?.actions.includes('retire_flag'));return {title:`سحب العلم ${f.key}`,endpoint:`/feature-flags/${id}/retire`,fields:[reason('سبب السحب (أُزيل شرطه من الكود؟)')],toPayload:v=>({version:f.version,reason:v.reason})};}
    if(action==='edit_flag')guard(f?.actions.includes('edit_flag'));else guard(action==='new_flag');
    const chosen=new Set(f?.targets??[]);
    const fields=[...(f?[]:[field('key','المفتاح','text',{hint:'حروف إنجليزية صغيرة ونقاط، مثل ai.asset_gate. لا يُعاد استخدام مفتاح مسحوب.'})]),
      field('description','ما الذي يشغّله ومتى يُزال','textarea',{value:f?.description??''}),
      field('scope','النطاق','select',{value:f?.scope??'all',options:Object.entries(data.scopes).map(([value,label])=>({value,label}))}),
      field('departments','الإدارات (لنطاق «إدارة»)','checks',{required:false,value:f?.scope==='department'?[...chosen]:[],options:data.departments.map(d=>({value:d.id,label:d.name}))}),
      field('users','الحسابات (لنطاق «مستخدم»)','checks',{required:false,value:f?.scope==='user'?[...chosen]:[],options:data.people.map(p=>({value:p.id,label:p.name}))}),
      field('enabled','الحالة','select',{value:f?.enabled?'on':'off',options:[{value:'off',label:'مطفأ'},{value:'on',label:'مضاء'}]}),
      field('expires_on','ينتهي في','date',{value:f?.expires_on??'',min:data.today,max:data.latest_expiry,hint:`إلزامي، وخلال ${data.max_days} يومًا على الأكثر. العلم المنتهي مطفأ حكمًا.`}),
      reason(f?'سبب التغيير':'سبب إنشاء العلم')];
    const toPayload=v=>({...(f?{version:f.version}:{key:v.key}),description:v.description,scope:v.scope,targets:v.scope==='department'?v.departments:v.scope==='user'?v.users:[],enabled:v.enabled==='on',expires_on:v.expires_on,reason:v.reason});
    return f?{title:`تعديل العلم ${f.key}`,endpoint:`/feature-flags/${id}`,fields,toPayload}:{title:'علم ميزة جديد',endpoint:'/feature-flags',idempotent:true,fields,toPayload};
  }
};

/* ───── جرد المساعدين وحزمة التقييم ───── */
function assetView(a,data,e,button){
  const x=a.approved,o=a.open;
  const facts=x?`<dl class="detail-data"><div><dt>المالك</dt><dd>${e(a.owner_name)}</dd></div><div><dt>فئات البيانات</dt><dd>${x.data_category_names.map(e).join('، ')}</dd></div><div><dt>تخرج البيانات من المملكة؟</dt><dd>${x.data_leaves_kingdom?`نعم — ${e(x.transfer_note)}`:'لا، وفق التقييم المعتمد'}</dd></div><div><dt>المخاطر</dt><dd>${e(x.risk_name)} — ${e(x.risk_notes)}</dd></div>${x.mitigations?`<div><dt>الضوابط</dt><dd>${e(x.mitigations)}</dd></div>`:''}<div><dt>الاعتماد</dt><dd>معتمد · النسخة ${e(x.revision)}</dd></div><div><dt>المراجعة التالية</dt><dd>${e(a.next_review_on)}${a.overdue?' — متأخرة':''}</dd></div></dl>`
    :`<p class="muted">ما فيه تقييم معتمد: ما له مالك، وما أحد جاوب للحين عن خروج البيانات من المملكة. الفئات المقترحة (ما اعتمدها أحد): ${a.suggested_categories.map(k=>e(data.data_categories[k]??k)).join('، ')||'—'}.</p>`;
  return `<details class="vn-card"><summary><span class="vn-code">${e(a.status_name)}</span><span class="vn-name"><strong>${e(a.name)}</strong><small>${e(a.purpose)}</small></span><span class="vn-flags">${a.overdue?'<span class="badge is-late">مراجعة متأخرة</span>':''}${o?'<span class="badge is-due">تقييم بانتظار القرار</span>':''}</span></summary><div class="vn-body">${facts}
    ${o?`<div class="vn-alert"><strong>تقييم بانتظار القرار (نسخة ${e(o.revision)})</strong><p>أعدّه ${e(o.prepared_by_name)}، ويبتّ فيه غيره · المالك المقترح ${e(o.owner_name)} · المخاطر ${e(o.risk_name)} · ${o.data_leaves_kingdom?'تخرج البيانات من المملكة':'لا تخرج البيانات من المملكة'}</p><p>${e(o.risk_notes)}</p></div>`:''}
    ${a.status==='suspended'?`<p class="subtle">موقوف: ${e(a.suspended_reason)}</p>`:''}
    ${a.history.length?`<p class="subtle">سجل التقييمات: ${a.history.map(h=>`نسخة ${e(h.revision)} ${e(h.status==='approved'?'معتمدة':h.status==='returned'?'مُرجعة':'منتظرة')}`).join(' · ')}</p>`:''}
    <div class="operation-actions">${a.actions.includes('submit_assessment')?button('submit_assessment',a.id,'إعداد تقييم مخاطر'):''}${a.actions.includes('decide_assessment')?button('decide_assessment',o.id,'البت في التقييم'):''}${a.actions.includes('activate_asset')?button('activate_asset',a.id,'تفعيل'):''}${a.actions.includes('suspend_asset')?button('suspend_asset',a.id,'إيقاف'):''}</div></div></details>`;
}
function suiteView(s,e,button){
  const last=s.last;
  return `<details class="vn-card"><summary><span class="vn-code">${last?`${e(last.passed)}/${e(last.total)}`:'—'}</span><span class="vn-name"><strong>${e(s.name)}</strong><small>${e(s.assistant_name)} · حساب التقييم: ${e(s.subject_name)} · ${e(s.cases.filter(c=>!c.retired_at).length)} حالة</small></span><span class="vn-flags">${last?.regressions.length?`<span class="badge is-late">${e(last.regressions.length)} تراجع</span>`:''}</span></summary><div class="vn-body">
    <ul class="vn-list">${s.cases.map(c=>`<li class="${c.retired_at?'is-old':''}"><strong>${e(c.title)}${c.retired_at?' — مسحوبة':''}</strong><span>${e(c.acceptance)}</span><span class="subtle">${c.checks.map(k=>e(k.name)+(k.min?` ≥ ${Math.round(k.min*100)}٪`:'')+(k.sections?`: ${k.sections.map(e).join(' ← ')}`:'')).join(' · ')}</span>${c.actions.includes('retire_case')?`<div class="operation-actions">${button('retire_case',c.id,'سحب الحالة')}</div>`:''}</li>`).join('')||'<li class="muted">ما فيه حالات للحين.</li>'}</ul>
    ${s.runs.length?`<h4>التشغيلات</h4><ul class="vn-list">${s.runs.map(r=>`<li><strong>${e(r.run_on)} · نجح ${e(r.passed)} · فشل ${e(r.failed)} · تعذّر ${e(r.errors)}</strong><span class="subtle">المزوّد: ${r.providers.map(e).join('، ')||'—'} · نسخة التعليمات ${e(r.instructions_version??'—')}</span>${r.regressions.length?`<span class="is-late">تراجع: ${r.regressions.map(x=>e(x.title)).join('، ')}</span>`:''}${r.recovered.length?`<span class="is-ok">تعافى: ${r.recovered.map(x=>e(x.title)).join('، ')}</span>`:''}<details><summary>التفاصيل</summary><ul class="vn-list">${r.results.map(x=>`<li><strong>${e(x.title)} — ${e(x.outcome==='passed'?'نجح':x.outcome==='failed'?'فشل':'تعذّر')}</strong>${x.error?`<span>${e(x.error)}</span>`:''}${x.checks.map(k=>`<span><span aria-hidden="true">${k.passed?'✓':'✗'}</span><span class="sr-only">${k.passed?'نجح':'رسب'}:</span> ${e(k.name)}: ${e(k.detail)}</span>`).join('')}</li>`).join('')}</ul></details></li>`).join('')}</ul>`:''}
    <div class="operation-actions">${s.actions.includes('add_case')?button('add_case',s.id,'إضافة حالة ذهبية'):''}${s.actions.includes('run_suite')?button('run_suite',s.id,'تشغيل الحزمة'):''}</div></div></details>`;
}
export const aiGovernanceUI={
  title:'حوكمة مساعدي الذكاء الاصطناعي',description:'جرد المساعدين: الغرض والمالك وفئات البيانات وخروجها من المملكة وتقييم المخاطر، وحزمة تقييم بفحوص حتمية. ما فيه درجة ثقة رقمية، ولا نموذج يحكم على نموذج.',
  load:async api=>{const board=await api('/ai-governance');let evals=null;if(board.can_govern)evals=await api('/ai-evals');return {...board,evals};},
  render(data,{e,button}){
    const count=s=>data.assets.filter(a=>a.status===s).length;
    const ev=data.evals;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${alerts(data.alerts,e)}${data.can_govern&&data.missing.length?`<div class="operation-actions">${button('seed_inventory','',`اقتراح ${data.missing.length} مساعد من الكود`)}</div>`:''}</section>
      <section class="vn-board"><div class="vn-tiles">${tile(e,count('active'),'مُفعَّل',count('active')?'is-ok':'')}${tile(e,count('assessed'),'مُقيَّم ينتظر التفعيل')}${tile(e,count('proposed'),'مقترح بلا تقييم',count('proposed')?'is-due':'')}${tile(e,count('suspended'),'موقوف')}${tile(e,data.assets.filter(a=>a.overdue).length,'مراجعة متأخرة',data.assets.some(a=>a.overdue)?'is-late':'')}</div></section>
      ${data.assets.map(a=>assetView(a,data,e,button)).join('')||'<section class="panel panel-body"><p class="muted">الجرد فاضي.</p></section>'}
      ${ev?`<section class="panel panel-body vn-head"><h2>حزمة التقييم</h2><p>${e(ev.note)}</p>${alerts(ev.alerts,e)}<div class="operation-actions">${button('create_suite','','حزمة جديدة')}</div></section>${ev.suites.map(s=>suiteView(s,e,button)).join('')}`:''}`;
  },
  form(action,id,data){
    const ev=data.evals;
    if(action==='seed_inventory'){guard(data.can_govern&&data.missing.length);return {title:'اقتراح الجرد من الكود',endpoint:'/ai-governance/seed',fields:[],toPayload:()=>({})};}
    if(action==='decide_assessment'){
      const a=data.assets.find(x=>x.open?.id===id);guard(a?.actions.includes('decide_assessment'));
      return {title:`البت في تقييم «${a.name}»`,endpoint:`/ai-governance/assessments/${id}/decide`,fields:[field('decision','القرار','select',{options:[{value:'approve',label:'اعتماد التقييم'},{value:'return',label:'إرجاع لمُعِدّه'}]}),field('next_review_on','موعد المراجعة التالية (عند الاعتماد)','date',{required:false,min:data.today}),field('note','سبب القرار','textarea',{hint:'لا تعتمد تقييمًا أعددته أو مساعدًا تملكه. الاعتماد لا يفعّل المساعد؛ التفعيل خطوة مستقلة.'})],
        toPayload:v=>({decision:v.decision,note:v.note,...(v.decision==='approve'?{next_review_on:v.next_review_on}:{})})};
    }
    if(['submit_assessment','activate_asset','suspend_asset'].includes(action)){
      const a=data.assets.find(x=>x.id===id);guard(a?.actions.includes(action));
      if(action==='activate_asset')return {title:`تفعيل «${a.name}»`,endpoint:`/ai-governance/assets/${id}/activate`,fields:[reason('سبب التفعيل')],toPayload:v=>({version:a.version,reason:v.reason})};
      if(action==='suspend_asset')return {title:`إيقاف «${a.name}»`,endpoint:`/ai-governance/assets/${id}/suspend`,fields:[reason('سبب الإيقاف')],toPayload:v=>({version:a.version,reason:v.reason})};
      const base=a.open??a.approved;
      return {title:`تقييم مخاطر «${a.name}»`,endpoint:`/ai-governance/assets/${id}/assessments`,fields:[
        field('owner_id','المالك البشري','select',{value:base?.owner_id??a.owner_id??'',options:[{value:'',label:'اختر'},...data.reviewers.map(p=>({value:p.id,label:p.name}))],hint:'موظف يُسأل عن المساعد ويملك إيقافه. لا يعتمد تقييم مساعده.'}),
        field('data_categories','فئات البيانات التي يعالجها','checks',{value:base?.data_categories??a.suggested_categories,options:Object.entries(data.data_categories).map(([value,label])=>({value,label}))}),
        field('data_leaves_kingdom','هل تخرج البيانات من المملكة؟','select',{value:'',options:[{value:'',label:'اختر صراحة'},{value:'yes',label:'نعم'},{value:'no',label:'لا'}],hint:data.transfer_hint}),
        field('transfer_note','إلى أين تخرج وعلى أي أساس','textarea',{required:false}),
        field('risk_level','مستوى المخاطر','select',{options:Object.entries(data.risk_levels).map(([value,label])=>({value,label}))}),
        field('risk_notes','أسباب التقدير','textarea',{hint:'حكم مكتوب بأسبابه، لا رقم.'}),field('mitigations','الضوابط','textarea',{required:false})],
        toPayload:v=>({version:a.version,owner_id:v.owner_id,data_categories:v.data_categories,data_leaves_kingdom:v.data_leaves_kingdom===''?null:v.data_leaves_kingdom==='yes',transfer_note:v.transfer_note||'',risk_level:v.risk_level,risk_notes:v.risk_notes,mitigations:v.mitigations||''})};
    }
    guard(ev);
    if(action==='create_suite')return {title:'حزمة تقييم جديدة',endpoint:'/ai-evals/suites',idempotent:true,fields:[field('name','اسم الحزمة'),field('assistant_key','المساعد المستهدف','select',{options:ev.assistants.map(a=>({value:a.key,label:a.name}))}),field('subject_user_id','حساب التقييم','select',{options:ev.subjects.map(p=>({value:p.id,label:p.name})),hint:'تُشغَّل الحالات بصلاحيات هذا الحساب وتُسجَّل في تشغيلاته. استعمل حسابًا تجريبيًا مخصصًا للتقييم.'}),field('description','الوصف','textarea',{required:false})],toPayload:v=>({name:v.name,assistant_key:v.assistant_key,subject_user_id:v.subject_user_id,description:v.description||''})};
    if(action==='retire_case'){
      const s=ev.suites.find(x=>x.cases.some(c=>c.id===id)),c=s?.cases.find(x=>x.id===id);guard(c?.actions.includes('retire_case'));
      return {title:`سحب الحالة «${c.title}»`,endpoint:`/ai-evals/cases/${id}/retire`,fields:[reason('سبب السحب')],toPayload:v=>({version:s.version,reason:v.reason})};
    }
    const s=ev.suites.find(x=>x.id===id);guard(s?.actions.includes(action));
    if(action==='run_suite')return {title:`تشغيل «${s.name}»`,endpoint:`/ai-evals/suites/${id}/run`,fields:[],toPayload:()=>({version:s.version}),
      after:(r,e)=>({title:'نتيجة التشغيل',html:`<p>نجح ${e(r.passed)} من ${e(r.total)} · فشل ${e(r.failed)} · تعذّر ${e(r.errors)}</p>${r.regressions.length?`<div class="vn-alert"><strong>تراجع:</strong> ${r.regressions.map(x=>e(x.title)).join('، ')}</div>`:''}<div class="form-actions"><button class="btn outline" type="button" data-action="close">إغلاق</button></div>`})};
    return {title:`حالة ذهبية — ${s.name}`,endpoint:`/ai-evals/suites/${id}/cases`,fields:[field('title','عنوان الحالة'),
      field('input','مدخل المساعد (JSON)','textarea',{hint:'مثل {"question":"…"} أو {"text":"…"} بحسب المساعد.'}),
      field('checks','الفحوص','checks',{options:Object.entries(ev.checks).map(([value,label])=>({value,label}))}),
      field('arabic_min','حد نسبة الحروف العربية (٪) لفحص العربية','number',{required:false,min:1,max:100}),
      field('sections','عناوين البنية بالترتيب (سطر لكل عنوان) لفحص البنية','textarea',{required:false}),
      field('acceptance','معيار القبول','textarea')],
      toPayload:v=>{let input;try{input=JSON.parse(v.input);}catch{throw Error('مدخل المساعد ليس JSON صالحًا');}
        return {version:s.version,title:v.title,input,acceptance:v.acceptance,checks:v.checks.map(type=>type==='arabic'?{type,min:Number(v.arabic_min)/100}:type==='structure'?{type,sections:String(v.sections||'').split('\n').map(x=>x.trim()).filter(Boolean)}:{type})};}};
  }
};

export const platformOpsModules={jobs:jobsUI,'feature-flags':featureFlagsUI,'ai-governance':aiGovernanceUI};
