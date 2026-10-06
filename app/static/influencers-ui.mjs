// المؤثرون: السجل ورخصته المعلنة، والارتباطات بحملات بمخرجاتها وحقوق استخدامها وإفصاحها وإثبات نشرها.
// لا رقم جمهور يُقرأ آليًا، ولا تحقق آلي من نشر، ولا مسار دفع موازٍ: كل ذلك مذكور في الشاشة نفسها.
// البلاطة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
import { attachFiles, filesBlock, fileForm } from './files-ui.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const opts=list=>list.map(x=>({value:x.key??x.id,label:x.name??x.label}));

const influencerLabels={edit_influencer:'تعديل الملف',add_account:'إضافة حساب',retire_account:'تعطيل حساب',record_snapshot:'تسجيل رقم من لقطة',set_licence:'تسجيل الرخصة',link_vendor:'ربط بملف مورد',set_status:'تغيير الحالة'};
const licenceTone={missing:'is-late',expired:'is-late',lapses:'is-late',recorded:'is-ok'};

export const influencersUI={
  title:'المؤثرون',
  description:'سجل المؤثرين وحساباتهم ورخصة الترويج الإعلاني المعلنة. كل رقم ينكتب باليد بمصدره وتاريخه.',
  load:api=>api('/influencers'),
  render(data,{e,button,ui=kit(e)}){
    const snapshot=m=>`<li class="${m.superseded?'is-old':''}"><strong>${e(m.metric)}: ${e(m.value.toLocaleString('en-US'))} ${e(m.unit)}</strong><span>${e(data.manual_metric_note)} · لقطة بتاريخ ${e(m.captured_on)}${m.superseded?' · تصحح برقم أحدث':''}</span><small>${e(m.source)}</small></li>`;
    const account=a=>`<li class="${a.active?'':'is-old'}"><strong>${e(a.platform_name)} · <bdi>${e(a.handle)}</bdi></strong><span>${a.active?'حساب قائم':'حساب معطّل'}${a.profile_url?` · <bdi>${e(a.profile_url)}</bdi>`:''}</span>${a.snapshots.length?`<ul class="vn-list">${a.snapshots.map(snapshot).join('')}</ul>`:'<small class="subtle">ما فيه أرقام مدخلة لهالحساب.</small>'}</li>`;
    const card=x=>`<section class="panel panel-body vn-block">
      <div class="panel-head"><div><h2>${e(x.stage_name)}</h2><p><bdi>${e(x.code)}</bdi> · ${e(x.category_name)}</p></div><span class="badge">${e(x.status_name)}</span></div>
      <p class="subtle">${e(x.contact_mode_name)}${x.agency_name?` · ${e(x.agency_name)}`:''} · ${e(x.contact_name)} · ${e(x.contact_channel)}</p>
      <p class="vn-alert ${e(licenceTone[x.licence.state]??'')}">${e(x.licence.name)}${x.licence.state==='recorded'&&x.licence.expiring?' · تنتهي خلال ستين يوم':''}</p>
      ${x.licence.expires_on?`<p class="subtle">مصدر معلومة الرخصة: ${e(x.licence_source)}</p>`:''}
      <p class="subtle">${x.vendor?`ملف المورد: <bdi>${e(x.vendor.code)}</bdi> — ${e(x.vendor.legal_name)} (${e(x.vendor.status)})`:'ما هو مرتبط بملف مورد، وأتعابه ما تندفع قبل تسجيله مورد بحساب بنكي متحقق منه.'} · ارتباطات: ${e(x.engagements_count)}</p>
      ${x.notes?`<p class="muted measure">${e(x.notes)}</p>`:''}
      ${x.accounts.length?`<ul class="vn-list">${x.accounts.map(account).join('')}</ul>`:'<p class="subtle">ما فيه حسابات مسجلة للحين.</p>'}
      ${x.actions.length?`<div class="operation-actions">${x.actions.map(a=>button(a,x.id,influencerLabels[a])).join('')}</div>`:''}</section>`;
    // INF-01: حساب واحد على أكثر من ملف (سُجّل قبل الترحيل 189) ينتظر قرار — أول الشاشة، ولا يُرسم شيء حين لا زوج.
    const duplicates=(data.duplicate_accounts??[]).length?`<section class="panel panel-body vn-block"><h2>حساب واحد على أكثر من ملف — ينتظر قرار</h2><ul class="vn-list">${data.duplicate_accounts.map(d=>`<li class="is-due"><strong>${e(d.platform_name)} · <bdi>${e(d.handle)}</bdi></strong><span>على ${d.files.map(f=>`<bdi>${e(f.code)}</bdi> «${e(f.stage_name)}»`).join(' و')}</span><small>عطّل الحساب من الملف الخطأ من «تعطيل حساب»، أو كمّل على ملف واحد</small></li>`).join('')}</ul></section>`:'';
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      <p class="vn-alert">${e(data.licence_notice)}</p>
      <div class="vn-tiles">${ui.tile(data.influencers.length,'ملف مؤثر')}${ui.tile(data.alerts.licence_missing,'بدون رخصة مسجلة',data.alerts.licence_missing?'is-late':'')}${ui.tile(data.alerts.licence_expired,'رخصة منتهية',data.alerts.licence_expired?'is-late':'')}${ui.tile(data.alerts.licence_expiring,'رخصة تنتهي خلال ستين يوم',data.alerts.licence_expiring?'is-due':'')}${ui.tile(data.alerts.unlinked_vendor,'متاح للتعاقد بدون ملف مورد')}</div>
      <div class="operation-actions">${button('create_influencer','','ملف مؤثر جديد')}</div></section>
      ${duplicates}${data.influencers.map(card).join('')||ui.empty('ما فيه ملفات مؤثرين للحين','أول ملف يبدأ من «ملف مؤثر جديد».')}`;
  },
  form(action,id,data){
    const base=x=>[field('stage_name','الاسم المهني','text',{value:x?.stage_name}),field('category','فئة المحتوى','select',{value:x?.category,options:opts(data.categories)}),
      field('contact_mode','جهة التواصل','select',{value:x?.contact_mode,options:opts(data.contact_modes)}),
      field('agency_name','اسم الوكيل (إذا التواصل عن طريق وكيل)','text',{required:false,value:x?.agency_name}),
      field('contact_name','اسم من نتواصل معه','text',{value:x?.contact_name}),field('contact_channel','بريده أو هاتفه','text',{value:x?.contact_channel}),
      field('notes','ملاحظات','textarea',{required:false,value:x?.notes})];
    const payload=v=>({stage_name:v.stage_name,category:v.category,contact_mode:v.contact_mode,agency_name:v.agency_name||'',contact_name:v.contact_name,contact_channel:v.contact_channel,notes:v.notes||''});
    if(action==='create_influencer')return {title:'ملف مؤثر جديد',endpoint:'/influencers',idempotent:true,fields:base(null),toPayload:payload};
    const x=data.influencers.find(r=>r.id===id);guard(x&&x.actions.includes(action));
    const spec=(fields,toPayload=v=>v)=>({title:`${influencerLabels[action]} — ${x.stage_name}`,endpoint:`/influencers/${id}/${action}`,fields,toPayload:v=>({version:x.version,...toPayload(v)})});
    if(action==='edit_influencer')return spec(base(x),payload);
    if(action==='add_account')return spec([field('platform','المنصة','select',{options:opts(data.platforms)}),field('handle','اسم الحساب'),field('profile_url','رابط الحساب','text',{required:false})],
      v=>({platform:v.platform,handle:v.handle,profile_url:v.profile_url||''}));
    if(action==='retire_account')return spec([field('account_id','الحساب','select',{options:x.accounts.filter(a=>a.active).map(a=>({value:a.id,label:`${a.platform_name} · ${a.handle}`}))}),field('note','سبب التعطيل','textarea')]);
    if(action==='record_snapshot'){
      const live=x.accounts.filter(a=>a.active);
      return spec([field('account_id','الحساب','select',{options:live.map(a=>({value:a.id,label:`${a.platform_name} · ${a.handle}`}))}),
        field('metric','اسم الرقم زي ما طلع في اللقطة','text',{hint:'مثال: متابعين، مشاهدات منشور.'}),
        field('value','القيمة','number',{min:0,step:1}),field('unit','الوحدة','text',{required:false}),
        field('captured_on','تاريخ اللقطة','date',{value:data.today}),
        field('source','مصدر اللقطة ومكان حفظها','textarea',{hint:'اكتب مين أرسل اللقطة ومتى ووين انحفظت.'}),
        field('corrects_id','يصحح لقطة سابقة','select',{required:false,options:[{value:'',label:'ما يصحح شي'},...live.flatMap(a=>a.snapshots.filter(m=>!m.superseded).map(m=>({value:m.id,label:`${a.handle} · ${m.metric} ${m.value} · ${m.captured_on}`})))]})],
        v=>({account_id:v.account_id,metric:v.metric,value:Number(v.value),unit:v.unit||'',captured_on:v.captured_on,source:v.source,corrects_id:v.corrects_id||''}));
    }
    if(action==='set_licence')return spec([field('licence_number','رقم الرخصة','text',{required:false,value:x.licence_number,hint:data.licence_notice}),
      field('licence_expires_on','تاريخ انتهاء الرخصة','date',{required:false,value:x.licence.expires_on??''}),
      field('licence_source','مصدر المعلومة ومكان حفظ نسختها','textarea',{required:false,value:x.licence_source,hint:'اترك الحقول فاضية إذا ما فيه رخصة مسجلة؛ الفراغ يعني «ما انسجلت» مو «مو مطلوبة».'})],
      v=>({licence_number:v.licence_number||'',licence_expires_on:v.licence_expires_on||'',licence_source:v.licence_source||''}));
    if(action==='link_vendor')return spec([field('vendor_id','ملف المورد','select',{options:data.vendors.map(y=>({value:y.id,label:`${y.code} — ${y.legal_name}`}))}),
      field('note','أساس الربط','textarea',{hint:'الدفع يمشي عن طريق ملف المورد وحسابه البنكي المتحقق منه.'})]);
    return spec([field('status','الحالة','select',{value:x.status,options:Object.entries(data.status_names).map(([value,label])=>({value,label}))}),field('note','سبب التغيير','textarea')]);
  }
};

const engagementLabels={edit_engagement:'تعديل الارتباط',request_review:'طلب الاعتماد الداخلي',approve_engagement:'اعتماد الارتباط',return_engagement:'إعادة للإعداد',complete_engagement:'إقفال الارتباط',cancel_engagement:'إلغاء الارتباط',add_content:'اقتراح محتوى',link_payment:'ربط أمر دفع'};
const contentLabels={edit_content:'تعديل المحتوى',submit_content:'إرسال للمراجعة الداخلية',approve_content:'اعتماد داخلي',return_content:'إعادة للتعديل',record_client_approval:'توثيق موافقة العميل',record_proof:'تسجيل إثبات النشر',cancel_content:'إلغاء المحتوى'};
const usageTone={expired:'is-late',expiring:'is-due',valid:'is-ok'};
// حالات أمر الدفع كما تسميها شاشة المدفوعات؛ تُعرض هنا للقراءة فقط: القرار المالي في شاشته.
const orderStatus={pending:'ينتظر اعتماد المالية',approved:'معتمد — ما انفذ في البنك للحين',executed:'انفذ في البنك وموثق',rejected:'مرفوض',cancelled:'ملغى'};

export const influencerCampaignsUI={
  title:'ارتباطات المؤثرين',
  description:'ارتباط المؤثر بحملة: مخرجات محددة وحقوق استخدام بمدة ونطاق، إفصاح إعلاني إلزامي، اعتماد داخلي ثم موافقة عميل موثقة، إثبات نشر يتحقق منه إنسان، ودفعة تمر بأمر دفع في مسار المدفوعات.',
  // لقطة إثبات النشر ملفٌّ على الإثبات نفسه (نوع influencer_proof)، يُحمَّل فهرسها مع الصفحة.
  load:async api=>{const data=await api('/influencer-campaigns');return attachFiles(api,data,'influencer_proof',data.engagements.flatMap(g=>g.content.filter(c=>c.proof).map(c=>c.proof.id)));},
  render(data,{e,button,money,ui=kit(e)}){
    const proof=p=>!p?'<small class="subtle">ما انسجل إثبات نشر للحين.</small>'
      :`<small class="${p.verified_by?'is-ok':'is-due'}">إثبات النشر: <bdi>${e(p.post_url)}</bdi> · انشر ${e(p.published_on)} · لقطة: ${e(p.screenshot_reference)}${p.attachments?` · ملفات مرفقة: ${e(p.attachments)}`:''} · إفصاح: ${e(p.disclosure_evidence)}${p.verified_by?` · تحقّق بـ${e(p.method_name)}: ${e(p.verification_note)}`:' · ما تحقق منه أحد للحين'}</small>
        ${p.actions.length?`<div class="operation-actions">${button('verify_proof',p.id,'التحقق من إثبات النشر')}</div>`:''}${filesBlock(data,p.id,{e,button})}`;
    const item=x=>`<li class="${x.status==='cancelled'?'is-old':x.proof&&!x.proof.verified_by?'is-due':''}"><strong>${e(x.kind_name)} · ${e(x.title)}</strong>
      <span>${e(x.status_name)}${x.client_approver_name?` · وافق العميل عبر ${e(x.client_approver_name)} (${e(x.channel_name)}) بتاريخ ${e(x.client_approval_received_on)}`:''}</span>
      ${x.output?`<small class="subtle">النسخة المعتمدة: ${e(x.output.title)} · النسخة ${e(x.output.revision)} · بصمة <bdi>${e(String(x.output.digest).slice(0,12))}</bdi></small>`:''}${x.draft_reference?`<small class="subtle">المسودة: ${e(x.draft_reference)}</small>`:''}${x.internal_note?`<small class="subtle">${e(x.internal_note)}</small>`:''}${x.client_approval_reference?`<small class="subtle">دليل موافقة العميل: ${e(x.client_approval_reference)}</small>`:''}
      ${proof(x.proof)}
      ${x.actions.length?`<div class="operation-actions">${x.actions.map(a=>button(a,x.id,contentLabels[a])).join('')}</div>`:''}</li>`;
    const payment=p=>`<li class="${p.proof_state==='written_exception'?'is-late':''}"><strong>أمر دفع <bdi>${e(p.payment_order_id)}</bdi> · ${e(money(p.amount_minor))}</strong>
      <span>حالة الأمر في المدفوعات: ${e(orderStatus[p.order_status]??p.order_status)}${p.bank_reference?` · مرجع بنكي <bdi>${e(p.bank_reference)}</bdi>`:''}</span>
      <small class="subtle">${e(p.basis)}${p.proof_state==='written_exception'?` — استثناء مكتوب بالدفع قبل اكتمال إثبات النشر: ${e(p.exception_note)}`:' — مرتبط بإثبات نشر متحقق منه'}</small></li>`;
    const card=g=>`<section class="panel panel-body vn-block">
      <div class="panel-head"><div><h2>${e(g.title)}</h2><p>${e(g.influencer_name)} · ${e(g.client_name)}</p></div><span class="badge">${e(g.status_name)}</span></div>
      <p class="subtle">الحملة: ${e(g.campaign_name)} · من ${e(g.starts_on)} لين ${e(g.ends_on)} · الأتعاب ${e(money(g.fee_minor))}</p>
      <p class="vn-alert ${e(licenceTone[g.licence.state]??'')}">${e(g.licence.name)}</p>
      ${g.licence_ack_note?`<p class="muted">إقرار المعتمد بالمضي مع حالة الرخصة: ${e(g.licence_ack_note)}</p>`:''}
      ${g.actions.length?`<div class="operation-actions">${g.actions.map(a=>button(a,g.id,engagementLabels[a])).join('')}</div>`:''}
      <div class="vn-tiles">${g.deliverables.map(d=>ui.tile(`${d.verified}/${d.promised}`,`${d.name} بإثبات متحقق منه`,d.promised&&d.verified<d.promised?'is-due':'')).join('')}
        ${ui.tile(g.usage_days_left<0?'انتهت':`${g.usage_days_left} يوم`,`حقوق الاستخدام لين ${g.usage_until}`,usageTone[g.usage_state])}</div>
      <p class="subtle">نطاق حقوق الاستخدام: ${e(g.usage_scope_name)} · من ${e(g.usage_from)} لين ${e(g.usage_until)} — ${e(g.usage_terms)}</p>
      <p class="subtle">الإفصاح الإعلاني المطلوب: ${e(g.disclosure_requirement)}</p>
      <p class="subtle">شروط الإلغاء: ${e(g.cancellation_terms)}</p>
      ${g.brief?`<p class="muted measure">${e(g.brief)}</p>`:''}
      ${g.return_note?`<p class="muted">انعاد للإعداد: ${e(g.return_note)}</p>`:''}
      ${g.closing_note?`<p class="muted measure">${e(g.closing_note)}</p>`:''}
      ${g.content.length?`<ul class="vn-list">${g.content.map(item).join('')}</ul>`:'<p class="subtle">ما فيه محتوى مقترح للحين.</p>'}
      <p class="vn-alert ${g.payment_gate.allowed?'is-ok':'is-due'}">${g.payment_gate.allowed?'مستوفي شروط إعداد الدفعة: إثبات نشر متحقق منه وملف مورد بحساب متحقق منه.':`قبل الدفع: ${e(g.payment_gate.blockers.map(b=>b.message).join('؛ '))}`}</p>
      ${g.payments.length?`<ul class="vn-list">${g.payments.map(payment).join('')}</ul>`:''}</section>`;
    // إشعار الرخصة مرة وحدة أعلى الشاشة، لا في كل بطاقة؛ والبطاقة تقول حالة رخصة مؤثرها.
    const notice=data.engagements.find(g=>g.licence_notice)?.licence_notice;
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${notice?`<p class="vn-alert">${e(notice)}</p>`:''}
      <div class="vn-tiles">${ui.tile(data.engagements.length,'ارتباط')}${ui.tile(data.alerts.proofs_awaiting,'إثبات نشر ينتظر تحقق بشري',data.alerts.proofs_awaiting?'is-due':'')}${ui.tile(data.alerts.usage_expiring,'حقوق استخدام تنتهي خلال شهر',data.alerts.usage_expiring?'is-due':'')}${ui.tile(data.alerts.usage_expired,'حقوق استخدام منتهية',data.alerts.usage_expired?'is-late':'')}${ui.tile(data.alerts.paid_without_proof,'دفعات باستثناء مكتوب',data.alerts.paid_without_proof?'is-late':'')}</div>
      ${data.clients.length?`<div class="operation-actions">${data.clients.map(c=>button('create_engagement',c.id,`ارتباط جديد — ${c.name}`)).join('')}</div>`:'<p class="subtle">ما أنت ضمن فريق أي حساب عميل.</p>'}</section>
      ${data.engagements.map(card).join('')||ui.empty('ما فيه ارتباطات مؤثرين في حساباتك','الارتباط يبدأ من «ارتباط جديد» على عميل له حملة.')}`;
  },
  form(action,id,data){
    const engagementFields=g=>[field('title','عنوان الارتباط','text',{value:g?.title}),field('brief','الوصف والرسالة','textarea',{required:false,value:g?.brief}),
      field('posts_count','عدد المنشورات','number',{min:0,max:500,step:1,value:g?.posts_count??0}),field('stories_count','عدد القصص','number',{min:0,max:500,step:1,value:g?.stories_count??0}),field('videos_count','عدد الفيديوهات','number',{min:0,max:500,step:1,value:g?.videos_count??0}),
      field('fee','أتعاب المؤثر بالريال','text',{value:g?(g.fee_minor/100).toFixed(2):''}),
      field('starts_on','بداية الارتباط','date',{value:g?.starts_on??data.today}),field('ends_on','نهايته','date',{value:g?.ends_on}),
      field('cancellation_terms','شروط الإلغاء كما في الاتفاق','textarea',{value:g?.cancellation_terms}),
      field('disclosure_requirement','نص الإفصاح الإعلاني المطلوب على المنشور','textarea',{value:g?.disclosure_requirement,hint:'إلزامي: المنشور يوضح إنه إعلان، ودليله ينطلب وقت تسجيل إثبات النشر.'}),
      field('usage_scope','نطاق حقوق الاستخدام','select',{value:g?.usage_scope,options:opts(data.usage_scopes)}),
      field('usage_from','بداية مدة الاستخدام','date',{value:g?.usage_from??data.today}),field('usage_until','نهايتها','date',{value:g?.usage_until}),
      field('usage_terms','شروط حقوق الاستخدام','textarea',{value:g?.usage_terms,hint:'تطلع تنبيه لما يقرب انتهاؤها وبعده.'})];
    const engagementPayload=v=>({title:v.title,brief:v.brief||'',posts_count:Number(v.posts_count),stories_count:Number(v.stories_count),videos_count:Number(v.videos_count),
      fee:String(v.fee).trim(),starts_on:v.starts_on,ends_on:v.ends_on,cancellation_terms:v.cancellation_terms,disclosure_requirement:v.disclosure_requirement,
      usage_scope:v.usage_scope,usage_from:v.usage_from,usage_until:v.usage_until,usage_terms:v.usage_terms});
    if(action==='create_engagement'){
      const client=data.clients.find(c=>c.id===id);guard(client&&client.campaigns.length&&data.influencers.length);
      return {title:`ارتباط مؤثر — ${client.name}`,endpoint:'/influencer-engagements',idempotent:true,
        fields:[field('influencer_id','المؤثر','select',{options:data.influencers.map(x=>({value:x.id,label:`${x.code} — ${x.stage_name}`}))}),
          field('campaign_id','الحملة','select',{options:client.campaigns.map(c=>({value:c.id,label:c.name}))}),...engagementFields(null)],
        toPayload:v=>({influencer_id:v.influencer_id,client_id:id,campaign_id:v.campaign_id,...engagementPayload(v)})};
    }
    const g=data.engagements.find(x=>x.id===id);
    if(g&&engagementLabels[action]){
      guard(g.actions.includes(action));
      const spec=(fields,toPayload=v=>v,endpoint=`/influencer-engagements/${id}/${action}`)=>({title:`${engagementLabels[action]} — ${g.title}`,endpoint,fields,toPayload:v=>({version:g.version,...toPayload(v)})});
      if(action==='edit_engagement')return spec(engagementFields(g),engagementPayload);
      if(action==='request_review')return spec([],()=>({}));
      if(action==='approve_engagement')return spec([field('note','أساس الاعتماد','textarea'),
        field('licence_ack','إقرارك المكتوب بشأن الرخصة','textarea',{required:false,hint:`${g.licence.name}. ${data.licence_notice} الإقرار مطلوب إذا الرخصة مو مسجلة وسارية طول مدة الارتباط.`})],
        v=>({note:v.note,licence_ack:v.licence_ack||''}));
      if(action==='add_content')return spec([field('kind','نوع المخرج','select',{options:opts(data.content_kinds)}),field('title','عنوان المخرج'),field('description','وصف المحتوى المقترح','textarea',{required:false})],
        v=>({kind:v.kind,title:v.title,description:v.description||''}),`/influencer-engagements/${id}/content`);
      if(action==='link_payment')return spec([field('payment_order_id','معرّف أمر الدفع','text',{hint:'أمر الدفع ينعدّ في شاشة مدفوعات الموردين على ملف مورد المؤثر، وينربط هنا قبل اعتماد المالية له.'}),
        field('basis','سبب استحقاق الدفعة ومرجعها','textarea'),
        field('exception_note','قرار الاستثناء المكتوب (للدفع قبل اكتمال إثبات النشر)','textarea',{required:false,hint:'يكتبه شخص غير صاحب الارتباط، ويبقى ظاهر في سجل الدفعات.'})],
        v=>({payment_order_id:v.payment_order_id,basis:v.basis,exception_note:v.exception_note||''}));
      return spec([field('note',action==='complete_engagement'?'خلاصة الإقفال ووش انسلّم فعلًا':action==='cancel_engagement'?'سبب الإلغاء وأثره على شروط الإلغاء':'وش يلزم قبل الاعتماد','textarea')],v=>({note:v.note}));
    }
    const all=data.engagements.flatMap(x=>x.content);
    if(action==='upload_file'){
      const x=all.find(c=>c.proof&&c.proof.id===id);guard(x&&data.files?.[id]?.can_upload);
      return fileForm('influencer_proof',id,`لقطة إثبات — ${x.title}`);
    }
    if(action==='verify_proof'){
      const x=all.find(c=>c.proof&&c.proof.id===id);guard(x&&x.proof.actions.includes('verify_proof'));
      return {title:`التحقق من إثبات النشر — ${x.title}`,endpoint:`/influencer-proofs/${id}/verify`,
        fields:[field('method','كيف تحققت بنفسك','select',{options:opts(data.verification_methods)}),field('note','وش طابقت في الرابط أو اللقطة','textarea',{hint:'التحقق بشري.'})],
        toPayload:v=>v};
    }
    const x=all.find(c=>c.id===id);guard(x&&x.actions.includes(action));
    const spec=(fields,toPayload=v=>v)=>({title:`${contentLabels[action]} — ${x.title}`,endpoint:`/influencer-content/${id}/${action}`,fields,toPayload:v=>({version:x.version,...toPayload(v)})});
    if(action==='edit_content')return spec([field('kind','نوع المخرج','select',{value:x.kind,options:opts(data.content_kinds)}),field('title','عنوان المخرج','text',{value:x.title}),field('description','وصف المحتوى','textarea',{required:false,value:x.description})],
      v=>({kind:v.kind,title:v.title,description:v.description||''}));
    // مسودة المؤثر نسخة اعتمدها الاستوديو في عمل مفتوح لحملة الارتباط؛ البصمة تنقرأ من الاستوديو وما تنكتب.
    if(action==='submit_content'){
      const g=data.engagements.find(y=>y.content.some(c=>c.id===id)),fit=(data.versions??[]).filter(v=>v.campaign_id===g.campaign_id&&(!v.client_id||v.client_id===g.client_id));
      return spec([field('output_version_id','النسخة المعتمدة لمسودة المؤثر','select',{value:x.output?.version_id??'',
        options:fit.length?[{value:'',label:'اختيار نسخة معتمدة'},...fit.map(v=>({value:v.id,label:`${v.title} · النسخة ${v.revision} · ${v.studio_title}`}))]:[{value:'',label:'ما فيه نسخة معتمدة لحملة الارتباط للحين'}],
        hint:'سجّل مسودة المؤثر مخرجًا في عمل استوديو مفتوح لحملة الارتباط، وبعد اعتمادها تطلع هنا.'})],v=>({output_version_id:v.output_version_id}));
    }
    if(action==='record_client_approval')return spec([field('approver_name','مين وافق من جهة العميل','text'),
      field('channel','وسيلة ورود الموافقة','select',{options:opts(data.approval_channels)}),
      field('received_on','تاريخ ورودها','date',{value:data.today}),
      field('reference','وين انحفظ دليل الموافقة','textarea',{hint:'تسجيل لموافقة وصلت برّا المنصة؛ مو توقيع من العميل.'})],
      v=>({approver_name:v.approver_name,channel:v.channel,received_on:v.received_on,reference:v.reference}));
    if(action==='record_proof'){
      const g2=data.engagements.find(y=>y.content.some(c=>c.id===id));
      return spec([field('post_url','رابط المنشور','text',{hint:'يبدأ بـ http أو https.'}),
        field('published_on','تاريخ النشر','date',{value:data.today}),
        field('screenshot_reference','مرجع اللقطة المرفقة ومكان حفظها','textarea'),
        field('disclosure_confirmed','أؤكد ظهور الإفصاح الإعلاني على المنشور','checkbox',{hint:g2?g2.disclosure_requirement:'الإفصاح الإعلاني إلزامي.'}),
        field('disclosure_evidence','كيف ظهر الإفصاح ودليله','textarea')],
        v=>({post_url:v.post_url,published_on:v.published_on,screenshot_reference:v.screenshot_reference,disclosure_confirmed:v.disclosure_confirmed==='on',disclosure_evidence:v.disclosure_evidence}));
    }
    return spec([field('note',action==='approve_content'?'أساس الاعتماد الداخلي':action==='cancel_content'?'سبب الإلغاء':'المطلوب تعديله','textarea')],v=>({note:v.note}));
  }
};
