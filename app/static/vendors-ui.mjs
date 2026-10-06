import { attachFiles, filesBlock, fileForm } from './files-ui.mjs';
// البلاطة والجدول والبطاقة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
// مركز الموردين: تسجيل وتأهيل وبيانات دفع بتحقق مستقل. المورد لا يملك حساب دخول.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const optional={required:false};
const decisionOptions=[{value:'passed',label:'اجتاز'},{value:'needs_info',label:'يحتاج استكمال — يرجع للمسجّل'},{value:'failed',label:'ما اجتاز'}];
const actionLabels={
  edit:'تعديل البيانات',submit:'تقديم للتأهيل',add_contact:'إضافة جهة اتصال',trust_contact:'توثيق جهة اتصال',add_document:'إضافة وثيقة',verify_document:'التحقق من وثيقة',
  review_duplicate:'فحص التكرار',review_technical:'التقييم الفني',review_procurement:'مراجعة المشتريات',review_finance:'التحقق المالي',review_legal:'المراجعة القانونية',
  approve:'قرار الاعتماد',reject:'رفض الملف',suspend:'إيقاف المورد',requalify:'إعادة تأهيل',propose_bank:'تسجيل حساب بنكي أو تغييره',verify_bank:'تحقق مستقل من الحساب',
  evaluate:'تقييم أداء',grant_exception:'استثناء لطلب شراء',merge:'دمج في ملف آخر',allow_shared_iban:'قبول آيبان مشترك بقرار مسبَّب'
};
const stateLabels={ok:'مستوفاة',pending:'تنتظر التحقق',missing:'ناقصة',expired:'منتهية',rejected:'مرفوضة',not_applicable:'ما تنطبق'};
const verificationLabels={pending:'تنتظر التحقق',verified:'متحقق منها',rejected:'مرفوضة',not_applicable:'ما تنطبق'};
const bankLabels={pending:'ينتظر تحقق مستقل',verified:'متحقق منه',rejected:'مرفوض',superseded:'حل محله حساب أحدث'};
const methodLabels={trusted_contact_callback:'اتصال مرتد بجهة اتصال موثقة سابقًا',bank_letter:'خطاب بنكي',approved_channel:'وسيلة معتمدة أخرى'};
// تغيير الحساب (الترحيل 166): مهلة تهدئة ثم أول دفعة يطلقها شخص ثالث. الجملة تقول ما يمنع الدفع اليوم ومتى ينتهي.
const changeLine=c=>({unadopted:'تغيير حساب — مهلة التهدئة ما تقررت للحين، فالدفع له موقوف',cooling_off:`تغيير حساب — الدفع له موقوف لين ${c.payable_from}`,
  first_payment:'تغيير حساب — انقضت المهلة، وأول دفعة له يطلقها شخص ثالث',settled:'تغيير حساب — انحوّلت له أول دفعة وصار حسابًا عاديًا',replaced:'تغيير حساب — حل محله حساب أحدث'})[c.state]??'تغيير حساب';
const channelLabels={email:'البريد',phone:'الهاتف',none:'—'};
const signalLabels={entity_ref:'معرّف المنشأة نفسه',vat_number:'الرقم الضريبي نفسه',bank_account:'حساب بنكي مشترك',name:'اسم متشابه'};
const groups=[['in_review','قيد التأهيل'],['draft','مسودات واستكمال'],['requalification','إعادة تأهيل'],['approved','معتمدون'],['conditional','معتمدون بشروط'],['suspended','موقوفون'],['rejected','مرفوضون'],['merged','ملفات مدموجة']];

// ما ينتظر قرار القارئ في ملف المورد: مراحل التأهيل وقراره، والتحقق من الوثائق والحساب البنكي وجهات الاتصال.
// التعديل والتقديم والإضافة خطوات صاحب الملف على ملفه، لا قرار.
const DECIDES=new Set(['review_duplicate','review_technical','review_procurement','review_finance','review_legal','approve','reject','verify_document','verify_bank','trust_contact','allow_shared_iban']);
const day=(e,iso)=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(String(iso).slice(0,10))}</time>`:'—';

function pipeline(x,e){
  const kinds=[['duplicate','التكرار'],['technical','فني'],['procurement','مشتريات'],...(x.bank.length?[['finance','مالي']]:[]),...(x.legal_review_required?[['legal','قانوني']]:[])];
  const latest={};for(const r of [...x.reviews].reverse())if(r.current)latest[r.kind]=r;
  const steps=kinds.map(([kind,name])=>{const r=latest[kind],state=r?r.decision:'waiting';return `<li class="vn-step is-${e(state)}"><span>${e(name)}</span><small>${e(r?`${{passed:'اجتاز',failed:'ما اجتاز',needs_info:'يحتاج استكمال'}[r.decision]} · ${r.reviewer_name}`:'ما بدأت')}</small></li>`;}).join('');
  return `<ol class="vn-pipeline" aria-label="مراحل التأهيل للدورة ${e(x.cycle||1)}">${steps}</ol>`;
}
function vendorCard(x,data,{e,button}){
  // الاسم يُقرأ من القائمة الكاملة (بالمعطَّل): ملفٌّ يحمل تصنيفًا عُطِّل كان يُعرض بمفتاحه اللاتيني الخام.
  const name=key=>(data.categories_all??data.categories).find(c=>c.key===key)?.name??key;
  const kindName=key=>(data.document_kinds_all??data.document_kinds).find(d=>d.key===key)?.name??key;
  const gate=x.gate.allowed?'<span class="vn-flag is-ok">مؤهل للترسية</span>':`<span class="vn-flag is-block">ممنوع من أمر جديد</span>`;
  // الحساب المتغيّر في مهلته حسابٌ موجود موقوف مؤقتًا، لا «لا حساب»: الشارة تقول الفرق (الترحيل 166) بشكل الانتظار لا بشكل المنجز.
  const held=x.bank.some(b=>b.active&&b.change&&['unadopted','cooling_off'].includes(b.change.state));
  const pay=x.payment_ready?'<span class="vn-flag is-ok">حساب دفع ساري</span>':held?'<span class="vn-flag is-due">الحساب الجديد موقوف في مهلة التهدئة</span>':'<span class="vn-flag is-late">ما فيه حساب دفع ساري</span>';
  const requirements=x.requirements.length?x.requirements.map(r=>`<li class="vn-req is-${e(r.state)}"><strong>${e(kindName(r.kind))}</strong><span>${e(stateLabels[r.state])}${r.level==='when_applicable'?' · عند الانطباق':''}</span><small class="measure">${e(r.why)}</small></li>`).join(''):'<li class="vn-req is-ok"><strong>ما فيه وثائق إلزامية لهالنوع</strong></li>';
  const documents=x.documents.map(d=>`<li class="${d.expired?'is-late':d.expiring?'is-due':d.verification==='pending'?'is-pending':''}"><strong>${e(kindName(d.kind))}</strong><span>${e(verificationLabels[d.verification])}${d.expires_on?` · تنتهي ${day(e,d.expires_on)}`:''}${d.expired?' · منتهية':d.expiring?' · قرّبت تنتهي':''}</span><small><bdi>${e(d.reference)}</bdi>${d.verification_note?` — ${e(d.verification_note)}`:''}</small></li>`).join('');
  const contacts=x.contacts.map(c=>`<li><strong>${e(c.name)}</strong><span>${e(c.role)}${c.trusted_at?' · موثقة':' · غير موثقة'}</span><small>${[c.email,c.phone].filter(Boolean).map(v=>`<bdi dir="ltr">${e(v)}</bdi>`).join(' · ')}</small></li>`).join('');
  // رسالة جهة الاتصال محاكاة: مسجَّلة ولا ترسلها المنصة، والشاشة تقول ذلك بجوارها.
  const notices=c=>c.notices.map(n=>`<small>${n.status==='simulated'?`رسالة لجهة الاتصال الموثقة قبل التغيير (محاكاة — ما انرسلت): ${e(n.contact_name)} عبر ${e(channelLabels[n.channel])}`:'ما فيه جهة اتصال موثقة قبل التغيير تنكتب لها الرسالة (محاكاة — ما انرسلت)'}</small>`).join('');
  const sharedLine=b=>b.shared_with.length?`<small>الآيبان نفسه على ${b.shared_with.map(s=>`<bdi>${e(s.code)}</bdi>${s.decided?' (بقرار مسبَّب)':' (بدون قرار — ما ينتحقق منه)'}`).join('، ')}</small>`:'';
  const bank=x.bank.map(b=>`<li class="${b.active?'is-active':b.status==='pending'?'is-pending':b.status==='superseded'?'is-old':''}"><strong>${e(b.bank_name)} · <bdi dir="ltr">${e(b.iban)}</bdi></strong><span>${e(bankLabels[b.status])}${b.effective_from?` · يسري من ${day(e,b.effective_from)}`:''}${b.active?' · الساري الحين':''}</span><small class="measure">${e(b.reason)} — جمعها ${e(b.collected_by)}${b.verified_by?`، وتحقق منها ${e(b.verified_by)} عبر ${e(methodLabels[b.verification_method]??'—')}`:''}${b.masked?' · التفاصيل مخفية عن غير المخولين ماليًا':''}</small>${b.change?`<small>${e(changeLine(b.change))}</small>${notices(b.change)}`:''}${sharedLine(b)}</li>`).join('');
  const evaluations=x.evaluations.map(v=>`<li class="${v.superseded?'is-old':''}"><strong><span class="ltr">${(v.weighted_score/100).toFixed(2)} / 5</span> · ${e(name(v.category))}</strong><span>${e(v.evaluator_name)} · ${day(e,v.created_at)}${v.superseded?' · تصحّح بتقييم بعده':''}${v.corrects_id?' · تصحيح':''}</span><small class="measure">${e(v.evidence)}</small></li>`).join('');
  const decisions=x.decisions.map(d=>`<li><strong>${e(data.status_names[d.to_status])}</strong><span>${e(d.decided_by_name)} · ${day(e,d.created_at)}${d.valid_until?` · لين ${day(e,d.valid_until)}`:''}</span><small class="measure">${e(d.reason)}</small></li>`).join('');
  const duplicates=x.duplicates.length?`<div class="vn-alert is-due"><strong>إشارات تكرار تحتاج مراجعة</strong><ul>${x.duplicates.map(d=>`<li><bdi>${e(d.code)}</bdi> · ${e(d.legal_name)} — ${e(signalLabels[d.signal])}${d.strength==='weak'?' (إشارة ضعيفة)':''}</li>`).join('')}</ul></div>`:'';
  const blockers=x.gate.allowed||!['approved','conditional','suspended'].includes(x.status)?'':`<div class="vn-alert is-block"><strong>سبب المنع</strong><ul>${x.gate.blockers.map(b=>`<li>${e(b.message)}</li>`).join('')}</ul></div>`;
  const section=(title,items,empty)=>`<section class="vn-block"><h3>${e(title)}</h3>${items?`<ul class="vn-list">${items}</ul>`:`<p class="subtle">${e(empty)}</p>`}</section>`;
  const decides=x.actions.some(a=>DECIDES.has(a));
  const tone=decides?'is-decision':x.status==='in_review'||x.status==='requalification'?'is-pending':['draft','merged','suspended'].includes(x.status)?'is-old':x.status==='rejected'?'is-late':'';
  return `<details class="vn-card ${tone}"${decides?' open':''}><summary><span class="vn-code"><bdi>${e(x.code)}</bdi></span><span class="vn-name"><strong>${e(x.legal_name)}</strong><small>${x.categories.map(c=>e(name(c))).join(' · ')}</small></span><span class="vn-flags">${decides?'<span class="badge is-decision">ينتظر قرارك</span>':''}${['approved','conditional'].includes(x.status)?gate+pay:''}<span class="badge ${e(x.status)}">${e(data.status_names[x.status])}</span></span></summary>
    <div class="vn-body">
      ${x.actions.length?`<div class="operation-actions">${x.actions.map(a=>button(a,x.id,actionLabels[a])).join('')}</div>`:''}
      ${x.status==='conditional'?`<div class="vn-alert is-due"><strong>اعتماد مشروط لين ${day(e,x.valid_until)}</strong><p class="measure">${e(x.condition_note)}</p></div>`:''}${blockers}${duplicates}
      ${['in_review','draft','requalification'].includes(x.status)?pipeline(x,e):''}
      <dl class="vn-facts"><div><dt>نوع الكيان</dt><dd>${e(data.entity_types.find(t=>t.key===x.entity_type)?.name)} · <bdi>${e(x.country)}</bdi></dd></div><div><dt>معرّف المنشأة</dt><dd><bdi dir="ltr">${e(x.entity_ref||'—')}</bdi></dd></div><div><dt>الرقم الضريبي</dt><dd><bdi dir="ltr">${e(x.vat_number||'—')}</bdi></dd></div><div><dt>معرّف المشتريات</dt><dd><bdi dir="ltr">${e(x.supplier_key)}</bdi></dd></div><div><dt>شروط الدفع</dt><dd>${e(x.payment_terms||'—')}</dd></div><div><dt>مصدر البيانات</dt><dd>${e(x.data_source)}</dd></div><div><dt>أوامر داخلية</dt><dd><span data-num>${e(x.spend.orders)}</span> أمر</dd></div><div><dt>مطابَق ما انحوّل</dt><dd><span data-num>${e(x.spend.open_payables)}</span> مرجع</dd></div></dl>
      <div class="vn-grid"><section class="vn-block"><h3>متطلبات الوثائق لهالنوع</h3><ul class="vn-list vn-reqs">${requirements}</ul></section>${section('الوثائق المسجلة',documents,'ما انسجلت وثائق للحين.')}${section('جهات الاتصال',contacts,'ما فيه جهة اتصال.')}${section('بيانات الدفع',bank,'ما انسجل حساب بنكي. ما ينصرف لمورد بدون حساب متحقق منه.')}${section('تقييم الأداء',evaluations,'ما فيه تقييم للحين.')}${section('سجل القرارات',decisions,'ما فيه قرارات للحين.')}</div>
      ${filesBlock(data,x.id,{e,button})}
    </div></details>`;
}
function board(d,{e,money,ui}){
  if(!d)return '';
  const waiting=d.awaiting.in_review+d.awaiting.draft+d.awaiting.requalification,expired=d.expiring_documents.filter(x=>x.expired).length;
  const expiring=d.expiring_documents.slice(0,6).map(x=>`<li class="${x.expired?'is-late':'is-due'}"><strong><bdi>${e(x.code)}</bdi> · ${e(x.kind_name)}</strong><span>${day(e,x.expires_on)}${x.expired?' · منتهية':''}</span></li>`).join('');
  const top=d.concentration.top.map(o=>`<li><strong>${e(o.supplier_name)}</strong><span><span class="ltr">${e(o.share)}%</span> · <span class="ltr">${e(money(o.total_minor,'').trim())}</span> ريال</span><div class="vn-bar" data-width="${e(Math.max(2,Math.round(o.share)))}" aria-hidden="true"></div></li>`).join('');
  const late=d.late_orders.slice(0,5).map(o=>`<li class="is-late"><strong>${e(o.title)}</strong><span>${e(o.supplier_name)} · كان ${day(e,o.delivery_date)}</span></li>`).join('');
  const block=(title,body)=>`<section class="vn-block"><div class="panel-head"><h2>${e(title)}</h2></div>${body}</section>`;
  return `<section class="vn-board" aria-label="لوحة المشتريات"><div class="vn-tiles">${ui.tile(waiting,'ملف ينتظر إجراء',waiting?'is-due':'')}${ui.tile(d.bank_pending,'تغيير بنكي ينتظر التحقق',d.bank_pending?'is-due':'')}${ui.tile(d.expiring_documents.length,`وثيقة تنتهي خلال 60 يوم${expired?` · ${expired} منتهية`:''}`,expired?'is-late':d.expiring_documents.length?'is-due':'')}${ui.tile(d.thin_categories.length,'فئة بدون بديل مؤهل')}</div>
    <div class="vn-grid">${block('وثائق قرّبت تنتهي',expiring?`<ul class="vn-list">${expiring}</ul>`:'<p class="subtle">ما فيه وثائق تنتهي قريب.</p>')}
    ${block('تركز الإنفاق',top?`<ul class="vn-list vn-bars">${top}</ul><p class="subtle">محسوب من الأوامر الداخلية المعتمدة، مو من مدفوعات فعلية.</p>`:'<p class="subtle">ما فيه أوامر شراء معتمدة للحين.</p>')}
    ${block('فئات بأقل من موردين مؤهلين',`<p class="vn-chips">${d.thin_categories.map(c=>`<span>${e(c.name)} · <span data-num>${e(c.qualified)}</span></span>`).join('')}</p>`)}
    ${block('أوامر متأخرة',late?`<ul class="vn-list">${late}</ul>`:'<p class="subtle">ما فيه أوامر متأخرة.</p>')}</div>
    <p class="subtle">مو متاح في هالنسخة: ${d.not_available.map(e).join('، ')}. البيانات لين ${day(e,d.as_of)}.</p></section>`;
}

export const vendorsUI={
  title:'الموردون والتأهيل',description:'ملف موحد لكل مورد: تسجيل، فحص تكرار، تأهيل، وبيانات دفع ما تسري إلا بتحقق مستقل. المورد ما يدخل المنصة.',
  load:async api=>{const data=await api('/vendors');return attachFiles(api,data,'vendor',data.vendors.map(x=>x.id));},
  render(data,helpers){
    const {e,button,ui=kit(e)}=helpers,manage=data.permissions.includes('vendors.manage');
    // ───── القوائم المُدارة لهذه الشاشة (الترحيل 134) ─────
    // كل شاشة تعرض قوائمها هي: تصنيف المورد، ونوع وثيقته، وحالة ملفه، وتدل على شاشة تعديلها وقاعدته.
    const stateOf=o=>o.awaiting_second_person?'ينتظر اعتماد شخص ثاني':o.state==='disabled'?(o.disabled_from?`معطَّل من ${day(e,o.disabled_from)}`:'معطَّل في الكود — لم يفعّله المالك بعد'):'نشط';
    const why=list=>list.governance==='db_locked'
      ?`مقفلة بقيد في قاعدة البيانات منذ الترحيل ${e(list.db_locked.migration)}: <code dir="ltr">${e(list.db_locked.check)}</code>`
      :list.governance==='legally_fixed'?`مثبّتة بـ${e(list.article.ref)}`:`يملكها: ${e(list.owner)}`;
    const optionLists=(data.managed_options?.lists??[]).map(list=>ui.card({code:String(list.active_count),title:list.label,
      meta:`${list.governance_name}${list.second_person?' · الخيار الجديد ينتظر شخص ثاني':''}`,
      body:`<div class="vn-body"><p class="subtle">${why(list)}${list.note?` — ${e(list.note)}`:''}</p>${
        ui.table({head:['الخيار','القيمة المخزَّنة','الحالة'],rows:list.options.map(o=>`<tr class="${o.state==='disabled'?'is-old':o.awaiting_second_person?'is-pending':''}"><td>${e(o.label)}</td><td><bdi dir="ltr">${e(o.value)}</bdi></td><td>${stateOf(o)}</td></tr>`)})}${
        list.changes.length?ui.table({head:['التغيير','الخيار','السبب','يسري من'],rows:list.changes.map(c=>`<tr><td>${e(c.change)}</td><td><bdi dir="ltr">${e(c.value)}</bdi></td><td>${e(c.reason)}</td><td>${day(e,c.effective_on)}</td></tr>`)}):''}</div>`})).join('');
    const managed=optionLists?`<section class="vn-group"><h2>قوائم هذه الشاشة <span>${data.managed_options.lists.length}</span></h2><p class="subtle measure">تتعدّل هالقوائم وقيمها من شاشة <a href="#options">الخيارات والقيم المعتمدة</a> لمن يحمل تصريحها: كل تغيير بسبب وتاريخ، والقيمة ما تسري إلا إذا اعتمدها شخص ثاني.</p>${optionLists}</section>`:'';
    const waiting=data.vendors.filter(x=>x.actions.some(a=>DECIDES.has(a)));
    const lists=groups.map(([status,title])=>{const rows=data.vendors.filter(x=>x.status===status&&!waiting.includes(x));return rows.length?`<section class="vn-group"><h2>${e(title)} <span>${rows.length}</span></h2>${rows.map(x=>vendorCard(x,data,helpers)).join('')}</section>`:'';}).join('');
    return `<section class="panel panel-body vn-head">${manage?`<div class="operation-actions">${button('create_vendor','','تسجيل مورد جديد')}</div>`:''}<p>الوثائق تنسجّل بمرجع حفظها، وصحة صيغة الآيبان ما تثبت ملكية الحساب.</p></section>${board(data.dashboard,{...helpers,ui})}
      ${waiting.length?`<section class="vn-group"><h2>ينتظر قرارك <span>${waiting.length}</span></h2>${waiting.map(x=>vendorCard(x,data,helpers)).join('')}</section>`:''}
      ${lists||(waiting.length?'':ui.empty('ما فيه موردين مسجلين للحين',manage?'ابدأ من «تسجيل مورد جديد» بسجله ووثائقه، ويتأهل بمراجعات مستقلة.':'تطلع هنا ملفات الموردين أول ما يسجّلها مسؤول الموردين.'))}${managed}`;
  },
  form(action,id,data){
    const categoryOptions=data.categories.map(c=>({value:c.key,label:c.name})),none=[{value:'',label:'— ما فيه —'}];
    // القيمة المخزَّنة التي لم تعد بين الخيارات تُحقن موسومة بدل أن تُسقَط: القائمة المنسدلة التي لا تحوي قيمتها
    // تعرض الخيار الأول محدَّدًا، فأيّ تعديل على حقل آخر يُعيد تصنيف المورد صامتًا. الوسم يقول لماذا هي هنا.
    const keep=(stored,options)=>{
      if(!stored||options.some(o=>o.value===stored))return options;
      const known=(data.categories_all??[]).find(c=>c.key===stored);
      return [{value:stored,label:`${known?.name??stored} — معطَّل، يبقى حتى يُستبدل`},...options];
    };
    const vendorFields=x=>[
      field('legal_name','الاسم القانوني','text',{value:x?.legal_name}),field('legal_name_en','الاسم بالإنجليزية','text',{...optional,value:x?.legal_name_en}),field('trade_name','الاسم التجاري','text',{...optional,value:x?.trade_name}),
      field('entity_type','نوع الكيان','select',{options:data.entity_types.map(t=>({value:t.key,label:t.name})),value:x?.entity_type}),field('country','رمز البلد (حرفان)','text',{value:x?.country??'SA',maxLength:2}),
      field('entity_ref','السجل التجاري أو رقم التسجيل','text',{...optional,value:x?.entity_ref??'',hint:'للفرد: رقم وثيقة العمل الحر إذا عنده. رقم الهوية ما ينسجل.'}),field('vat_number','الرقم الضريبي إذا انطبق','text',{...optional,value:x?.vat_number??''}),
      field('category_1','التصنيف الرئيسي','select',{options:keep(x?.categories[0],categoryOptions),value:x?.categories[0]}),field('category_2','تصنيف إضافي','select',{...optional,options:keep(x?.categories[1],[...none,...categoryOptions]),value:x?.categories[1]??''}),field('category_3','تصنيف إضافي','select',{...optional,options:keep(x?.categories[2],[...none,...categoryOptions]),value:x?.categories[2]??''}),
      field('regions','مناطق التغطية','text',{...optional,value:x?.regions}),field('payment_terms','شروط الدفع','text',{...optional,value:x?.payment_terms}),field('capacity_note','الطاقة والمواعيد المتوقعة','textarea',{...optional,value:x?.capacity_note}),
      field('data_source','مصدر البيانات وتاريخ الحصول عليها','textarea',{value:x?.data_source}),field('legal_review_required','يحتاج مراجعة قانونية أو مخاطر؟','select',{options:[{value:'no',label:'لا'},{value:'yes',label:'نعم'}],value:x?.legal_review_required?'yes':'no'})
    ];
    const vendorPayload=v=>({legal_name:v.legal_name,legal_name_en:v.legal_name_en,trade_name:v.trade_name,entity_type:v.entity_type,country:v.country,entity_ref:v.entity_ref,vat_number:v.vat_number,categories:[v.category_1,v.category_2,v.category_3].filter(Boolean),regions:v.regions,payment_terms:v.payment_terms,capacity_note:v.capacity_note,data_source:v.data_source,legal_review_required:v.legal_review_required==='yes'});
    if(action==='create_vendor'){
      if(!data.permissions.includes('vendors.manage'))throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');
      return {title:'تسجيل مورد جديد',endpoint:'/vendors',idempotent:true,fields:[...vendorFields(null),field('supplier_key','معرّف المورد في طلبات الشراء','text',{...optional,hint:'حروف لاتينية وأرقام. اتركه فاضي ويأخذ رقم الملف.'})],toPayload:v=>({...vendorPayload(v),...(v.supplier_key?{supplier_key:v.supplier_key}:{})})};
    }
    const x=data.vendors.find(r=>r.id===id);
    if(action==='upload_file'&&x&&data.files?.[id]?.can_upload)return fileForm('vendor',id,x.code,{restrictable:true});
    if(!x||!x.actions.includes(action))throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');
    const spec=(fields,toPayload=v=>v)=>({title:`${actionLabels[action]} — ${x.code}`,endpoint:`/vendors/${id}/${action}`,fields,toPayload:v=>({...toPayload(v),version:x.version})});
    const pick=(rows,label)=>rows.map(r=>({value:r.id,label:label(r)}));
    if(action==='edit')return spec(vendorFields(x),vendorPayload);
    if(action==='submit')return spec([]);
    if(action==='add_contact')return spec([field('name','الاسم'),field('role','دورها عند المورد'),field('email','البريد','email',optional),field('phone','الهاتف','text',optional)]);
    if(action==='trust_contact')return spec([field('contact_id','جهة الاتصال','select',{options:pick(x.contacts.filter(c=>!c.trusted_at&&c.created_by!==data.user_id),c=>`${c.name} · ${c.role}`)}),field('basis','أساس الثقة بهالجهة','textarea',{hint:'مثال: مذكورة في العقد الموقّع، أو تعامل سابق موثّق.'})]);
    if(action==='add_document')return spec([field('kind','نوع الوثيقة','select',{options:data.document_kinds.map(d=>({value:d.key,label:d.name}))}),field('reference','مرجع الوثيقة ومكان حفظها','textarea'),field('issued_on','تاريخ الإصدار','date',optional),field('expires_on','تاريخ الانتهاء','date',optional),field('replaces_id','تحل محل وثيقة سابقة','select',{...optional,options:[{value:'',label:'— لا —'},...pick(x.documents,d=>`${data.document_kinds.find(k=>k.key===d.kind)?.name} · ${d.reference.slice(0,40)}`)]})],v=>({kind:v.kind,reference:v.reference,issued_on:v.issued_on,expires_on:v.expires_on,...(v.replaces_id?{replaces_id:v.replaces_id}:{})}));
    if(action==='verify_document')return spec([field('document_id','الوثيقة','select',{options:pick(x.documents.filter(d=>d.verification==='pending'&&d.added_by!==data.user_id),d=>`${data.document_kinds.find(k=>k.key===d.kind)?.name} · ${d.reference.slice(0,40)}`)}),field('verification','النتيجة','select',{options:[{value:'verified',label:'متحقق منها'},{value:'rejected',label:'مرفوضة'},{value:'not_applicable',label:'ما تنطبق على هالمورد'}]}),field('note','أساس التحقق','textarea')]);
    if(action.startsWith('review_'))return spec([field('decision','النتيجة','select',{options:decisionOptions}),field('note','أساس القرار','textarea',{hint:action==='review_duplicate'&&x.duplicates.length?'فيه إشارات تكرار. اشرح ليش الملف مكرر أو مو مكرر.':''})]);
    if(action==='approve')return spec([field('outcome','القرار','select',{options:[{value:'approved',label:'معتمد'},{value:'conditional',label:'معتمد بشروط ومدة'}]}),field('reason','سبب القرار','textarea'),field('valid_until','نهاية الاعتماد المشروط','date',optional),field('condition_note','الشروط','textarea',optional)],v=>v.outcome==='approved'?{outcome:v.outcome,reason:v.reason}:v);
    if(['reject','suspend','requalify'].includes(action))return spec([field('reason','سبب القرار','textarea')]);
    if(action==='propose_bank')return spec([field('bank_name','اسم البنك'),field('account_holder','اسم صاحب الحساب'),field('iban','رقم الآيبان','text',{hint:'يبقى ينتظر تحقق مستقل من موظف مالي ثاني؛ صحة الصيغة ما تثبت الملكية.'}),field('reason','سبب التسجيل أو التغيير ومصدر الطلب','textarea')]);
    if(action==='verify_bank'){const pending=x.bank.find(b=>b.status==='pending'),change=x.bank.some(b=>['verified','superseded'].includes(b.status));
      const hint=[x.spend.open_payables?`تنبيه: ${x.spend.open_payables} مرجع مطابَق ما انصرف بيتأثر بالحساب الجديد.`:'',change?'هذا تغيير حساب: الحساب الساري يوقف، والجديد يدخل مهلة تهدئة، وأول دفعة له يطلقها شخص ثالث.':''].filter(Boolean).join(' ');
      return spec([field('decision','النتيجة','select',{options:[{value:'verified',label:'تم التحقق'},{value:'rejected',label:'رفض التغيير'}]}),field('verification_method','وسيلة التحقق المستقل','select',{...optional,options:Object.entries(methodLabels).map(([value,label])=>({value,label}))}),field('verification_evidence','دليل التحقق','textarea'),field('effective_from','تاريخ السريان','date',{...optional,hint})],v=>({bank_id:pending.id,...v}));}
    if(action==='allow_shared_iban'){const pending=x.bank.find(b=>b.status==='pending'&&b.shared_with.some(s=>!s.decided));
      return spec([field('other_vendor_id','المورد اللي عنده الآيبان نفسه','select',{options:pending.shared_with.filter(s=>!s.decided).map(s=>({value:s.vendor_id,label:s.code}))}),field('reason','ليش يصح يشترك الموردين في حساب واحد','textarea',{hint:'مثال: وكيل تحصيل بعقد وكالة محفوظ في الملفين. عشرين حرف على الأقل، والتحقق بعدها بيد شخص غيرك.'})],v=>({bank_id:pending.id,...v}));}
    if(action==='evaluate')return spec([field('category','تصنيف العمل المقيَّم','select',{options:categoryOptions.filter(c=>x.categories.includes(c.value))}),...data.score_keys.map(s=>field('score_'+s.key,s.name,'select',{options:[5,4,3,2,1].map(n=>({value:n,label:String(n)}))})),field('evidence','أدلة التقييم','textarea'),field('corrects_id','تصحيح لتقييم سابق','select',{...optional,options:[{value:'',label:'— تقييم جديد —'},...pick(x.evaluations.filter(v=>!v.superseded),v=>`${(v.weighted_score/100).toFixed(2)} · ${v.created_at.slice(0,10)}`)]})],v=>({category:v.category,scores:Object.fromEntries(data.score_keys.map(s=>[s.key,Number(v['score_'+s.key])])),evidence:v.evidence,...(v.corrects_id?{corrects_id:v.corrects_id}:{})}));
    if(action==='grant_exception')return spec([field('purchase_id','طلب الشراء','select',{options:pick(data.purchases,p=>p.title)}),field('reason','مبرر الاستثناء لهالطلب بس','textarea')]);
    if(action==='merge')return spec([field('into_id','الملف الباقي','select',{options:pick(data.vendors.filter(r=>r.id!==x.id&&r.status!=='merged'),r=>`${r.code} · ${r.legal_name}`)}),field('reason','سبب الدمج','textarea')]);
    throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');
  }
};
