// «مزاياي» و«إدارة المزايا». الصدق أولًا: كل ميزة تُعرض بمصدرها (رقم المادة أو «يحتاج اعتماد مصفوفة المزايا»)
// وبحالتها (مسودة أو معتمدة)، والمال لا يظهر إلا مقترحًا لم يُصرف. لا أنماط مضمنة ولا سكربت (سياسة CSP صارمة).
// تمريرة الشاشة (1 أكتوبر 2026، مهارات better-* وقواعد المالك): ما يخص الموظف أولًا — تأمينه وبدلاته وما عنده وما يستحقه
// وطلبه المفتوح — ثم المرجع؛ الأقسام h2 وما تحتها h3؛ التاريخ <time> والمبلغ رقمه مجدول معزول و«ريال» بعده في مجرى الجملة؛
// صوت المنصة نجدي يومي ونص المادة ورقمها بحرفه؛ والمراجعة المعتمدة تُعرض بمضمونها وسندها وسريانها، ومُعدّ المسودة يبقى عليها.
import { kit } from './kit.mjs';
import { countNoun } from './arabic-count.mjs';

const field=(name,label,type='text',extra={})=>({name,label,type,required:true,...extra});
const optional=(name,label,type='text',extra={})=>field(name,label,type,{required:false,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
// البلاطة المحلية باقية عمدًا، مطابقة بالحرف لـui.tile: tests/kit.test.mjs يشترط أربعين نسخة محلية على الأقل، فتُرحَّل نسخ
// شاشات الموارد البشرية كلها مرة واحدة مع ذلك الحد لا شاشةً شاشة (قرار الدفعة، 1 أكتوبر 2026).
const tile=(e,value,label,tone='')=>`<div class="vn-tile ${tone}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
const size=n=>n<1024?`${n} B`:n<1048576?`${Math.ceil(n/1024)} KB`:`${(n/1048576).toFixed(1)} MB`;
// العدّة من app.mjs (ctx.ui). من يرسم الشاشة بلا عدّة أو ببعضها (اختبار يمرر e وbutton وحدهما) تُكمَّل له من العدّة نفسها، لا من نسخة محلية.
const kitOf=ctx=>({...kit(ctx.e),...(ctx.ui??{})});
// اليوم بصيغته كما كان يُعرض، داخل <time> بأرقام مجدولة؛ وdatetime أول عشرة أحرف منه.
const isoDay=(e,value)=>`<time datetime="${e(String(value).slice(0,10))}">${e(value)}</time>`;
// الأرقام المقنّعة والمراجع وأسماء الملفات: اتجاه يساري معزول بأرقام مجدولة، حتى لا يقلبها السياق العربي.
const ltr=(e,value)=>`<span class="ltr">${e(value)}</span>`;
const moneyText=(money,minor)=>money(minor).replace('SAR','ريال');
// المبلغ في جملة: رقمه معزول بأرقام مجدولة، و«ريال» بعده في مجرى السطر العربي، فيُقرأ «2,000.00 ريال» كما يُقال.
const amount=(e,money,minor)=>{const text=money(minor),m=/^(.*\S)\s*SAR$/.exec(text);return m?`${ltr(e,m[1])} ريال`:e(text);};
// العدد في عنوان أو جملة: رقمه وحده بأرقام مجدولة ([data-num])، والاسم بعده بصورته الصحيحة (arabic-count.mjs).
const num=(e,n)=>`<span data-num>${e(n)}</span>`;
const counted=(e,n,forms)=>e(countNoun(n,forms)).replace(/^-?\d+/,m=>num(e,m));
const NOUN={draft:['مسودة واحدة','مسودتان','مسودات','مسودة'],employee:['موظف واحد','موظفان','موظفين','موظفًا'],month:['شهر','شهرين','شهور','شهر']};
const docLinks=(e,docs)=>docs.length?`<ul class="vn-list">${docs.map(d=>`<li><strong>${e(d.label)}</strong><span>${ltr(e,d.filename)} · ${ltr(e,size(d.size))} · ${isoDay(e,d.created_at.slice(0,10))}</span><a class="btn outline small" href="/api/my-benefits/documents/${e(d.id)}">تنزيل<span class="sr-only"> ${e(d.label)}</span></a></li>`).join('')}</ul>`:'';
const STATE_TONE={held:'is-ok',eligible:'is-ok',upcoming:'is-due',on_event:'',not_eligible:'is-old',unknown:'is-warn'};
const STATUS_TONE={pending_hr:'is-due',pending_finance:'is-due',completed:'is-ok',rejected:'is-late',withdrawn:'is-old'};
const yesNo=[{value:'no',label:'لا'},{value:'yes',label:'نعم'}];
const fileValue=v=>v.document&&v.document.content?{filename:v.document.filename,content:v.document.content}:undefined;

function benefitCard(b,{e,button},data){
  const option=data.options.find(o=>o.key===b.request_option);
  const service=b.request_option.startsWith('service:')?b.request_option.slice(8):null;
  // الزر في منطقة الأزرار، وسبب عدم الإتاحة نصٌّ خارجها: ما ليس زرًّا لا يقف في صف الأزرار.
  let action='',reason='';
  if(option){if(option.available)action=button('request_option',option.key,`اطلب: ${option.name}`);else reason=option.reason;}
  else if(service&&data.viewing_self){
    const sid=data.service_links?.[service];
    action=!b.accepted?'':sid?`<button class="btn outline small" data-action="new-request" data-id="${e(sid)}">اطلبها من دليل الخدمات</button>`:'<a class="btn outline small" href="#catalog">اطلبها من دليل الخدمات</a>';
  }
  return `<details class="vn-card"><summary><span class="vn-code"><bdi dir="rtl">${e(b.source_kind==='regulation'?b.article:'مرفق 1')}</bdi></span>
    <span class="vn-name"><strong>${e(b.name)}</strong><small>${e(b.summary)}</small></span>
    <span class="vn-flags"><span class="vn-flag ${STATE_TONE[b.state]??''}">${e(b.state_name)}</span>${b.accepted?'':'<span class="vn-flag is-warn">مسودة لم تُعتمد</span>'}${b.matrix_label?`<span class="vn-flag is-warn">${e(b.matrix_label)}</span>`:''}${b.switched_off?'<span class="vn-flag is-warn">موقوفة من الإعدادات</span>':''}</span></summary>
    <div class="vn-body"><ul class="vn-list">
      ${b.switched_off?`<li><strong>موقوفة من إعدادات الخدمات</strong><span>${e(b.switched_off_reason)}</span><small class="measure">الموظف ما يشوفها وما ينفتح منها طلب لين تنرجع من «إعداد الاعتماد»، واللي كان مفتوح عليها يكمل مساره.</small></li>`:''}
      ${b.held_text?`<li><strong>اللي عندك</strong><span>${e(b.held_text)}</span></li>`:''}
      <li><strong>الأهلية</strong><span>${e(b.eligibility.text)}</span></li>
      ${b.company_choice?`<li><strong>من اختار هذا الشرط</strong><span>${e(b.company_choice)}</span></li>`:''}
      <li><strong>القيمة</strong><span>${e(b.value_text)}</span><small>${e(b.value_basis_name)} · ${e(b.frequency_name)}</small></li>
      <li><strong>كيف تاخذها</strong><span>${e(b.claim_name)}</span></li>
      ${b.documents.length?`<li><strong>المستندات المطلوبة</strong><span>${e(b.documents.join('، '))}</span></li>`:''}
      <li><strong>المصدر</strong><span>${e(b.citation)}</span><small class="measure">${e(b.source_note)}</small></li>
    </ul>${b.draft_warning?`<p class="subtle measure">${e(b.draft_warning)}</p>`:''}${reason?`<p class="subtle measure">${e(reason)}</p>`:''}${action?`<div class="operation-actions">${action}</div>`:''}</div></details>`;
}
function requestCard(r,{e,button,money},showName=true){
  const labels={withdraw_request:'سحب الطلب',upload_request_document:'إرفاق مستند',hr_approve:'اعتماد وتطبيق',hr_reject:'رفض',finance_approve:'تأكيد المبلغ مقترحًا',finance_reject:'رفض ماليًا'};
  // ما جرى على الطلب بترتيب وقوعه: تقديمه، ثم قرار الموارد البشرية، ثم المالية — من قرر ومتى، وملاحظته إن كتب.
  const step=(title,at,note='')=>`<div class="timeline-item"><strong>${title}</strong><small>${isoDay(e,at.slice(0,10))}</small>${note?`<p class="measure">${e(note)}</p>`:''}</div>`;
  const history=[step('انقدّم الطلب',r.created_at),
    r.hr_at?step(`الموارد البشرية: ${e(r.hr_by_name??'—')}`,r.hr_at,r.hr_note):'',
    r.finance_at?step(`المالية: ${e(r.finance_by_name??'—')}`,r.finance_at,r.finance_note):''].join('');
  return `<details class="vn-card"><summary><span class="vn-code">${ltr(e,r.reference)}</span><span class="vn-name"><strong>${e(r.option_name)}${showName&&r.employee_name?` · ${e(r.employee_name)}`:''}</strong><small>${e(r.summary)}</small></span>
    <span class="vn-flags"><span class="vn-flag ${STATUS_TONE[r.status]??''}">${e(r.status_name)}</span>${r.proposal?`<span class="vn-flag is-warn">${e(r.proposal.status_name)}</span>`:''}</span></summary>
    <div class="vn-body"><ul class="vn-list">
      <li><strong>المسار</strong><span>${e(r.chain)}</span></li>
      ${r.hr_details?.travel_class_name?`<li><strong>الدرجة</strong><span>${e(r.hr_details.travel_class_name)}</span></li>`:''}
      ${r.hr_details?.letter_reference?`<li><strong>مرجع الخطاب</strong><span>${ltr(e,r.hr_details.letter_reference)}</span></li>`:''}
      ${r.letter?`<li><strong>الخطاب</strong><span>${e(r.letter.status_name)}${r.letter.reference?` · الرقم المرجعي ${ltr(e,r.letter.reference)}`:''}${r.letter.cancelled?' · ملغى':''}</span><small><a href="${e(r.letter.link)}">شوف الخطاب ورمز تحققه في «خطاباتي»</a></small></li>`:''}
      ${r.amount_minor?`<li><strong>المبلغ</strong><span>${amount(e,money,r.amount_minor)}</span><small>${r.proposal?`${e(r.proposal.target_name)} · ${e(r.proposal.status_name)}`:'ما صدر تأكيد مالي للحين'}</small></li>`:''}
    </ul><section class="vn-block"><h3>سير الطلب</h3><div class="timeline">${history}</div></section>${docLinks(e,r.documents)}${r.actions.length?`<div class="operation-actions">${r.actions.map(a=>button(a,r.id,labels[a])).join('')}</div>`:''}</div></details>`;
}

export const myBenefitsUI={
  title:'مزاياي',
  description:'وش لك من مزايا الحين، ووش بتستحقه بعدين ومتى، وتأمينك الطبي وبدلات عقدك. ومن هنا تطلب الميزة وتتابع طلبك.',
  load:api=>api('/my-benefits'),
  render(data,ctx){
    const {e,button,money}=ctx,ui=kitOf(ctx);
    const ins=data.insurance;
    const insurance=ins?`<section class="vn-block"><div class="panel-head"><h2>تأميني الطبي</h2></div><ul class="vn-list">
        <li><strong>${e(ins.insurer_name)} · الفئة ${e(ins.tier)}</strong><span>${e(ins.status_name)}${ins.confirmed_on?` من ${isoDay(e,ins.confirmed_on)}`:''} · الوثيقة ${ltr(e,ins.policy_number_masked)}${ins.member_reference_masked?` · العضوية ${ltr(e,ins.member_reference_masked)}`:''}</span><small>تنتهي الوثيقة في ${isoDay(e,ins.policy_to)}${ins.policy_current?'':' — <span class="is-late-text">ما هي سارية اليوم</span>'}</small></li>
      </ul>
      <h3>التابعين (${num(e,ins.dependants.filter(d=>!d.removed_on).length)})</h3>${ins.dependants.length?`<ul class="vn-list">${ins.dependants.map(d=>`<li${d.removed_on?' class="is-old"':''}><strong>${e(d.relation_name)}</strong><span>مواليد ${isoDay(e,d.birth_date)}</span>${d.removed_on?`<small>انحذف من التأمين في ${isoDay(e,d.removed_on)}</small>`:''}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه تابعين مسجّلين على هذا التأمين.</p>'}
      <h3>بطاقة التأمين</h3>${ins.cards.length?docLinks(e,ins.cards):'<p class="subtle">ما انرفعت البطاقة للحين. يرفعها فريق المزايا أول ما توصل من شركة التأمين.</p>'}</section>`
      :'<section class="vn-block"><div class="panel-head"><h2>تأميني الطبي</h2></div><p class="subtle">التأمين الطبي حق لكل موظف (م95، م98)، وما فيه تسجيل تأمين قائم لك في المنصة. كلّم الموارد البشرية يسجّلونك.</p></section>';
    const a=data.allowances;
    const allowances=a?`<section class="vn-block"><div class="panel-head"><div><h2>بدلاتي من العقد</h2><p>من عقدك الساري: ${e(a.contract_type_name)}، من ${isoDay(e,a.start_date)}.</p></div></div>${ui.table({head:['البند','شهريًا'],rows:[...a.lines.map(l=>`<tr><td>${e(l.name)}</td><td>${e(moneyText(money,l.amount_minor))}</td></tr>`),`<tr><td><strong>الإجمالي</strong></td><td><strong>${e(moneyText(money,a.total_minor))}</strong></td></tr>`]})}${data.allowance_notes.map(n=>`<p class="subtle measure">${e(n)}</p>`).join('')}</section>`
      :'<section class="vn-block"><div class="panel-head"><h2>بدلاتي من العقد</h2></div><p class="subtle">ما فيه عقد ساري مسجّل لك للحين، فما فيه بدلات تنعرض. تطلع هنا أول ما ينسجّل عقدك.</p></section>';
    // المزايا بحالها: ما عندك وما تستحقه أولًا لأنه سؤال الشاشة، ثم ما يأتي لاحقًا أو بشرط أو ينقصه سجلك — مرجعًا بعد «اطلب ميزة».
    const group=([state,title])=>{const list=data.benefits.filter(b=>b.state===state);return list.length?`<section class="vn-group"><h2>${e(title)} <span data-num>${e(list.length)}</span></h2>${list.map(b=>benefitCard(b,ctx,data)).join('')}</section>`:'';};
    const mine=[['held','عندك الحين'],['eligible','تستحقها']].map(group).join('');
    const later=[['upcoming','تستحقها بعدين'],['on_event','تنطبق إذا صار سببها'],['unknown','تنتظر بيانات في سجلك'],['not_eligible','ما تنطبق عليك']].map(group).join('');
    const none=data.benefits.length?'':ui.empty('ما فيه مزايا تنعرض لك الحين','إذا تتوقع ميزة وما لقيتها هنا، اسأل الموارد البشرية.');
    const options=data.options.length?`<section class="vn-group"><h2>اطلب ميزة <span>المتاح لك الحين: ${num(e,data.options.filter(o=>o.available).length)} من ${num(e,data.options.length)}</span></h2><p>كل خيار له حقوله ومستنداته ومساره، واللي فيه مبلغ يوصل مسير الرواتب أو المصروفات مقترحًا والصرف يصير هناك.</p><div class="vn-grid">${data.options.map(o=>`<section class="vn-block"><h3>${e(o.name)}</h3><p class="subtle">${e(o.description)}</p><p class="subtle">المسار: ${e(o.chain)}</p>${o.documents.length?`<p class="subtle">المستندات: ${e(o.documents.join('، '))}</p>`:''}${o.company_choice?`<p class="subtle">${e(o.company_choice)}</p>`:''}${o.available?`<div class="operation-actions">${button('request_option',o.key,'ابدأ الطلب')}</div>`:`<p class="subtle">مو متاح لك الحين: ${e(o.reason)}</p>`}</section>`).join('')}</div></section>`:'';
    const requests=`<section class="vn-group"><h2>طلباتي <span data-num>${e(data.requests.length)}</span></h2>${data.requests.length?data.requests.map(r=>requestCard(r,ctx,!data.viewing_self)).join(''):`<p class="subtle">${data.viewing_self?'ما عندك طلبات مزايا للحين. تبدأ الطلب من «اطلب ميزة».':'ما فيه طلبات مزايا للحين.'}</p>`}</section>`;
    // المزايا الثلاث من عرض المزايا (ترحيل 112) لها مسارها وشروطها وحسابها في شاشة مستقلة.
    // المدخل هنا لأن «مزاياي» هي المكان الذي يبحث فيه الموظف، ولا تُكرَّر حقولها في هذه الشاشة.
    // الشروط والسقوف والمتاح منها تُقرأ هناك من المصدر؛ هذه المداخل لا تدّعي أهلية ولا مبلغًا ولا حالة اعتماد —
    // جملة ثابتة عن حالٍ تتغير («ما زالت مسودات») تصير خطأً مطبوعًا يوم تُعتمد، فلا تُكتب هنا.
    const extra=(name,text)=>`<section class="vn-block"><h3>${e(name)}</h3><p class="subtle">${e(text)}</p>
          <div class="operation-actions"><a class="btn outline small" href="#benefit-extras">افتحها في «مزايا إضافية»<span class="sr-only"> — ${e(name)}</span></a></div></section>`;
    const extras=data.viewing_self?`<section class="vn-group"><h2>مزايا إضافية <span data-num>3</span></h2>
      <p>من عرض المزايا، ولها مسار قرار خاص: شرط واحد مشترك (دوام كامل، وتجاوز فترة التجربة، وتقييم أداء عند الحد أو فوقه) ودرجة وظيفية مسجّلة.</p>
      <div class="vn-grid">
        ${extra('تأمين الوالدين','نصيبك من قيمة وثيقة والديك بسقف لكل والد، تدفعه مرة وحدة أو على أقساط. والخصم من راتبك ما يمشي إلا بإقرارك المكتوب (م51).')}
        ${extra('دراسة الأبناء','بفاتورة ضريبية وإثبات قيد لكل ابن، بسقف سنوي لكل درجة وظيفية.')}
        ${extra('الأندية الصحية والأجهزة الرياضية','اشتراك نادي أو أجهزة رياضية بفاتورة ضريبية، طلب واحد في السنة الميلادية.')}
      </div></section>`:'';
    const notes=[data.hidden_pending_count?`<p class="subtle measure">${num(e,data.hidden_pending_count)} من المزايا المقترحة ما اعتُمدت للحين، وتطلع هنا أول ما تنعتمد.</p>`:'',
      data.switched_off_count?`<p class="subtle measure">${num(e,data.switched_off_count)} من المزايا موقوفة من إعدادات الخدمات${data.can_manage
        ?': تشوفها هنا معلَّمة «موقوفة من الإعدادات» والموظف ما يشوفها. يرجّعها اللي عنده «إعداد الخدمات» من شاشة «إعداد الاعتماد».'
        :'، فما تطلع هنا وما ينفتح منها طلب.'}</p>`:''].join('');
    // الطلب المفتوح حال الموظف الجارية فيُقرأ قبل كل شيء؛ وبلا طلب مفتوح ينزل «طلباتي» إلى آخر الشاشة سجلًّا.
    const openFirst=data.counts.open_requests>0;
    return `<section class="panel panel-body vn-head"><p><strong>${e(data.employee?.name??'')}</strong> · ${e(data.employee?.join_text??'')}</p><p>${e(data.note)}</p><p class="subtle">${e(data.privacy_note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">${tile(e,data.counts.held,'ميزة عندك الحين',data.counts.held?'is-ok':'')}${tile(e,data.counts.eligible,'ميزة تستحقها')}${tile(e,data.counts.upcoming,'ميزة تستحقها بعدين',data.counts.upcoming?'is-due':'')}${tile(e,data.counts.open_requests,'طلب مفتوح',data.counts.open_requests?'is-due':'')}</div></section>
      ${openFirst?requests:''}
      <div class="vn-grid">${insurance}${allowances}</div>
      ${mine}${none}${options}${later}${extras}${notes}
      ${openFirst?'':requests}`;
  },
  form(action,id,data){
    if(action==='request_option'){
      const o=data.options.find(x=>x.key===id);guard(o&&o.available);
      const base={title:o.name,endpoint:'/my-benefits/requests',idempotent:true,submit:'إرسال الطلب'};
      const send=(details,v)=>({option:o.key,details,...(fileValue(v)?{document:{...fileValue(v),label:o.documents[0]?.replace(' (مطلوب)','')??'مستند الطلب'}}:{})});
      if(o.key==='dependant_add')return {...base,fields:[
        field('relation','صلة القرابة','select',{options:o.relations.map(r=>({value:r.key,label:r.name}))}),
        field('birth_date','تاريخ الميلاد','date',{hint:'صلة القرابة وتاريخ الميلاد بس — لا اسم كامل ولا رقم هوية ولا أي معلومة صحية.'}),
        optional('document_reference','مرجع المستند (اختياري)','text',{maxLength:60,hint:'مثل: شهادة ميلاد — آخر أربعة أرقام 1234. لا تكتب الرقم كامل.'}),
        field('document','عقد الزواج أو شهادة الميلاد','file',{hint:'PDF أو PNG أو JPEG لين 2 ميغابايت. ما يشوفه إلا فريق المزايا.'})],
        toPayload:v=>send({relation:v.relation,birth_date:v.birth_date,...(v.document_reference?{document_reference:v.document_reference}:{})},v)};
      if(o.key==='dependant_remove')return {...base,fields:[
        field('dependant_id','التابع','select',{options:o.dependants.map(d=>({value:d.id,label:d.name}))}),
        field('reason','السبب','select',{options:[['divorce','انفصال'],['married','زواج الابن أو الابنة'],['deceased','وفاة'],['left_kingdom','مغادرة نهائية'],['other','سبب آخر']].map(([value,label])=>({value,label}))}),
        field('effective_date','التاريخ','date')],
        toPayload:v=>send({dependant_id:v.dependant_id,reason:v.reason,effective_date:v.effective_date},v)};
      if(o.key==='class_upgrade')return {...base,fields:[
        field('target_tier',`الفئة المطلوبة (فئتك الحالية: ${o.current_tier})`,'select',{options:o.tiers.map(t=>({value:t,label:t}))}),
        field('consent','أوافق على تحمل فرق القسط خصمًا من راتبي بعد اعتماده','checkbox',{hint:'فريق المزايا يحدد الفرق من عرض شركة التأمين، والمالية تأكده مقترحًا للمسير.'})],
        toPayload:v=>send({target_tier:v.target_tier,consent:v.consent==='on'},v)};
      if(o.key==='ticket_claim')return {...base,fields:[
        field('mode','وش تطلب','select',{options:[{value:'ticket',label:'حجز تذكرة بالدرجة المستحقة'},...(o.cash_equivalent?[{value:'cash',label:'قيمة التذكرة نقدًا (م41/1/ث)'}]:[])]}),
        field('destination','الوجهة','text',{maxLength:120}),
        field('travel_from','تاريخ السفر','date'),optional('travel_to','تاريخ العودة (اختياري)','date'),
        optional('document','موافقة الإجازة أو عرض السعر (اختياري)','file',{hint:'PDF أو PNG أو JPEG لين 2 ميغابايت.'})],
        toPayload:v=>send({mode:v.mode,destination:v.destination,travel_from:v.travel_from,...(v.travel_to?{travel_to:v.travel_to}:{})},v)};
      if(o.key==='education_claim')return {...base,fields:[
        field('stage','المرحلة الدراسية','select',{options:o.stages.map(s=>({value:s,label:s}))}),
        field('school','اسم المدرسة','text',{maxLength:160}),field('academic_year','العام الدراسي','text',{maxLength:9,hint:'مثل 2026-2027'}),
        field('invoice_amount','مبلغ الفاتورة بالريال','text',{maxLength:12,hint:'مثل 12500.00'}),
        field('document','فاتورة المدرسة الرسمية','file',{hint:'PDF أو PNG أو JPEG لين 2 ميغابايت.'})],
        toPayload:v=>send({stage:v.stage,school:v.school,academic_year:v.academic_year,invoice_amount:v.invoice_amount},v)};
      return {...base,fields:[
        field('purpose','الغرض من الخطاب','select',{options:o.purposes.map(p=>({value:p.key,label:p.name}))}),
        field('addressee','الجهة الموجه إليها','text',{maxLength:180}),
        field('language','لغة الخطاب','select',{options:[{value:'ar',label:'العربية'},{value:'en',label:'الإنجليزية'}]})],
        toPayload:v=>send({purpose:v.purpose,addressee:v.addressee,language:v.language},v)};
    }
    const r=data.requests.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    if(action==='withdraw_request')return {title:`سحب الطلب ${r.reference}`,endpoint:`/my-benefits/requests/${id}/withdraw`,fields:[],toPayload:()=>({version:r.version})};
    if(action==='upload_request_document')return {title:`إرفاق مستند — ${r.reference}`,endpoint:'/my-benefits/documents',idempotent:true,
      fields:[field('label','وصف المستند','text',{maxLength:180}),field('file','الملف','file',{hint:'PDF أو PNG أو JPEG لين 2 ميغابايت.'})],
      toPayload:v=>({owner_kind:'request',owner_id:id,label:v.label,filename:v.file.filename,content:v.file.content})};
    guard(false);
  }
};

// ── إدارة المزايا ──────────────────────────────────────────────────────────
// شروط الأهلية سطرًا واحدًا، ترميزًا مهرَّبًا قطعةً قطعة: رقم مدة الخدمة وحده بأرقام مجدولة، والاسم بعده بصورته الصحيحة.
function ruleHtml(e,rules,names){
  const out=[];
  if(rules.min_tenure_months)out.push(`خدمة ${counted(e,rules.min_tenure_months,NOUN.month)} أو أكثر`);
  if(rules.past_probation)out.push('بعد فترة التجربة');
  if(rules.nationality)out.push(rules.nationality==='saudi'?'للسعوديين':'لغير السعوديين');
  if(rules.gender)out.push(rules.gender==='female'?'للعاملات':'للعاملين');
  if(rules.contract_types?.length)out.push(`العقد: ${e(rules.contract_types.map(t=>names.contract_types[t]??t).join('، '))}`);
  if(rules.grades?.length)out.push(`الدرجات: ${rules.grades.map(g=>`<bdi>${e(g)}</bdi>`).join('، ')}`);
  if(rules.event)out.push(e(names.events[rules.event]));
  if(rules.contract_clause)out.push('بحسب نص العقد');
  return out.length?out.join(' · '):'لكل الموظفين';
}
function catalogCard(entry,{e,button},data){
  const row=entry.draft??entry.accepted,acc=entry.accepted;
  // المراجعة بمضمونها وسندها: المصدر والأهلية والقيمة. المسودة تحمل من اقترحها وسبب التعديل (المراجِع يعرف ممن يستوضح)،
  // والمعتمدة سريانها وحده — لا سلسلة من أعدّ ومن اعتمد على سجل حُسم (تعليمات المالك؛ والسلسلة في سجل التدقيق).
  const revision=(r,label)=>r?`<section class="vn-block"><h3>${e(label)} · مراجعة ${num(e,r.revision)}</h3><ul class="vn-list">
      <li><strong>المصدر</strong><span>${e(r.citation)}</span><small class="measure">${e(r.source_note)}</small></li>
      <li><strong>الأهلية</strong><span>${ruleHtml(e,r.rules,data.names)}</span>${r.company_choice?`<small class="proposal-warning">${e(r.company_choice)}</small>`:''}</li>
      <li><strong>القيمة</strong><span>${e(r.value_text)}</span><small>${e(r.frequency_name)} · ${e(r.claim_name)}</small></li>
      ${r.documents.length?`<li><strong>المستندات المطلوبة</strong><span>${e(r.documents.join('، '))}</span></li>`:''}
      ${r.decided_by_name?`<li><strong>السريان</strong><span>${r.effective_from?`من ${isoDay(e,r.effective_from)}`:'—'}</span></li>`
        :`<li><strong>اقترحها</strong><span>${e(r.proposed_by_name)}</span>${r.change_note?`<small class="measure">${e(r.change_note)}</small>`:''}</li>`}
    </ul>${r.actions.length?`<div class="operation-actions">${r.actions.map(a=>button(a,r.id,a==='accept_benefit'?'اعتماد الميزة':'رفض المسودة')).join('')}</div>`:''}</section>`:'';
  return `<details class="vn-card"><summary><span class="vn-code"><bdi dir="rtl">${e(row.source_kind==='regulation'?row.article:'مرفق 1')}</bdi></span><span class="vn-name"><strong>${e(row.name)}</strong><small>${e(row.category_name)} · ${e(row.summary)}</small></span>
    <span class="vn-flags"><span class="vn-flag ${acc?'is-ok':'is-warn'}">${acc?'معتمدة':'ما لها مراجعة معتمدة'}</span>${entry.draft?'<span class="vn-flag is-warn">مسودة بانتظار الاعتماد</span>':''}${row.matrix_label?`<span class="vn-flag is-warn">${e(row.matrix_label)}</span>`:''}</span></summary>
    <div class="vn-body">${revision(entry.draft,'المسودة')}${revision(acc,'المعتمدة')}${entry.actions.length?`<div class="operation-actions">${button('propose_benefit',entry.key,entry.draft?'تعديل المسودة':'اقتراح مراجعة')}</div>`:''}</div></details>`;
}
const PROPOSAL_ACTIONS={hand_to_payroll:'تسليم إلى حركات الرواتب',record_booking:'تسجيل مرجع حجز التذكرة'};
export const benefitsAdminUI={
  title:'إدارة المزايا',
  description:'طلبات المزايا اللي تنتظر قرارك ومقترحات الصرف، وكتالوج المزايا بمواده واعتماده، وأهلية كل موظف.',
  load:api=>api('/benefits-admin'),
  render(data,ctx){
    const {e,button,money}=ctx,ui=kitOf(ctx);
    const drafts=data.catalog.filter(c=>c.draft).length,open=data.proposals.filter(p=>p.status==='proposed').length;
    const queue=(title,list,empty)=>`<section class="vn-group"><h2>${e(title)} <span data-num>${e(list.length)}</span></h2>${list.length?list.map(r=>requestCard(r,ctx)).join(''):`<p class="subtle">${e(empty)}</p>`}</section>`;
    const proposals=data.proposals.length?`<section class="vn-group"><h2>مقترحات الصرف والخصم <span>ما انسلّم منها: ${num(e,open)}</span></h2><p>التسليم يحوّل المقترح حركةً مقترحة في الرواتب يعتمدها معتمد الرواتب، وحجز التذكرة تتولاه المالية مصروفًا.</p><section class="vn-block">${ui.table({head:['المرجع','الموظف','الخيار','الوجهة','المبلغ','الحالة','الإجراء'],
      rows:data.proposals.map(p=>`<tr><td><bdi>${e(p.reference)}</bdi></td><td>${e(p.employee_name)}</td><td>${e(p.option_name)}</td><td>${e(p.target_name)}</td><td>${e(moneyText(money,p.amount_minor))}</td><td>${e(p.status_name)}</td><td>${p.actions.map(a=>button(a,p.id,PROPOSAL_ACTIONS[a]??a)).join('')}</td></tr>`)})}</section></section>`:'';
    const m=data.matrix;
    // علامة المسودة في رأس العمود: النجمة للعين، و«(مسودة)» في اسم الرأس لقارئ الشاشة (aria-label على th). لا نص مخفي بموضع مطلق
    // داخل الجدول: الجدول العريض يمرّ أفقيًا داخل .table-wrap، والعنصر المطلق يفلت من تمريره فيمدّ الصفحة كلها (قيس: 2137px بعرض 390).
    const draftHead=b=>b.accepted?`<th>${e(b.name)}</th>`:`<th aria-label="${e(b.name)} (مسودة)">${e(b.name)}<span aria-hidden="true"> *</span></th>`;
    const matrix=m?`<section class="vn-group"><h2>الأهلية عبر الموظفين <span>${counted(e,m.rows.length,NOUN.employee)}</span></h2><p>حالة كل ميزة لكل موظف من سجله وعقده وسجل التركيبة، بدون مبالغ. «بيانات ناقصة» يعني سجله ينقصه شي تحتاجه القاعدة.</p><section class="vn-block"><div class="table-wrap"><table><thead><tr><th>الموظف</th><th>الالتحاق</th>${m.benefits.map(draftHead).join('')}</tr></thead><tbody>${m.rows.map(r=>`<tr><td>${e(r.name)}</td><td>${r.join_date?isoDay(e,r.join_date):'—'}</td>${m.benefits.map(b=>`<td>${e(r.cells[b.key]?.short??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${m.benefits.some(b=>!b.accepted)?'<p class="subtle"><span aria-hidden="true">*</span> مسودة ما اعتُمدت للحين.</p>':''}</section></section>`:'';
    const catalog=data.catalog.length?`<section class="vn-group"><h2>كتالوج المزايا <span>${drafts?`${counted(e,drafts,NOUN.draft)} بانتظار الاعتماد`:'ما فيه مسودات'}</span></h2><p>يعتمدها: ${e(data.acceptance_owner)}.</p>${data.catalog.map(c=>catalogCard(c,ctx,data)).join('')}</section>`:'';
    const cards=data.enrolment_cards.length?`<section class="vn-group"><h2>بطاقات التأمين <span>تسجيلات قائمة: ${num(e,data.enrolment_cards.length)}</span></h2><section class="vn-block"><ul class="vn-list">${data.enrolment_cards.map(c=>`<li><strong>${e(c.employee_name)} · الفئة ${e(c.tier)}</strong><span>${c.cards.length?`الملفات المرفوعة: ${num(e,c.cards.length)}`:'ما انرفعت بطاقته للحين'}</span>${c.actions.length?`<div class="operation-actions">${button('upload_card',c.enrolment_id,'رفع بطاقة التأمين')}</div>`:''}</li>`).join('')}</ul></section></section>`:'';
    // ما ينتظر قرارًا أولًا (الطوابير ثم مقترحات الصرف ثم مسودات الكتالوج ثم بطاقات تنتظر رفعها)، والمرجع بعده: الأهلية ثم المنتهي.
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">${tile(e,data.queue.hr.length,'بانتظار الموارد البشرية',data.queue.hr.length?'is-due':'')}${tile(e,data.queue.finance.length,'بانتظار التأكيد المالي',data.queue.finance.length?'is-due':'')}${tile(e,open,'مقترح صرف ما انسلّم',open?'is-due':'')}${tile(e,drafts,'ميزة تنتظر الاعتماد',drafts?'is-due':'')}</div></section>
      ${data.permissions.manage?queue('طلبات بانتظار الموارد البشرية',data.queue.hr,'ما فيه طلب ينتظر قرارك. أول ما يقدّم موظف طلب مزايا يطلع هنا.'):''}
      ${data.permissions.finance||data.permissions.manage?queue('طلبات بانتظار التأكيد المالي',data.queue.finance,'ما فيه طلب ينتظر التأكيد المالي. يوصل هنا بعد ما تعتمده الموارد البشرية.'):''}
      ${proposals}${catalog}${cards}${matrix}
      ${data.queue.recent.length?queue('طلبات انتهت',data.queue.recent,''):''}`;
  },
  form(action,id,data){
    if(action==='propose_benefit'){
      const entry=data.catalog.find(c=>c.key===id);guard(entry&&entry.actions.includes(action));
      const r=entry.draft??entry.accepted,p=r.value_params,rules=r.rules,names=data.names;
      const select=(obj)=>Object.entries(obj).map(([value,label])=>({value,label}));
      return {title:`${entry.draft?'تعديل مسودة':'اقتراح مراجعة'} — ${r.name}`,endpoint:`/benefits-admin/catalog/${id}/propose`,submit:'حفظ المسودة',fields:[
        field('name','اسم الميزة','text',{value:r.name,maxLength:120}),field('summary','الوصف للموظف','textarea',{value:r.summary,maxLength:600}),
        field('source_kind','المصدر','select',{value:r.source_kind,options:[{value:'regulation',label:'مادة في لائحة تنظيم العمل'},{value:'needs_matrix',label:'يحتاج اعتماد مصفوفة المزايا (مرفق 1، م70)'}]}),
        optional('article','رقم المادة','text',{value:r.article,maxLength:80,hint:'لازم إذا المصدر مادة في اللائحة، مثل م67.'}),
        field('source_note','نص المصدر كما في اللائحة أو القرار','textarea',{value:r.source_note}),
        optional('min_tenure_months','أقل مدة خدمة بالأشهر','number',{value:rules.min_tenure_months??'',min:0,max:120}),
        optional('nationality','الجنسية','select',{value:rules.nationality??'',options:[{value:'',label:'الكل'},{value:'saudi',label:'السعوديون'},{value:'non_saudi',label:'غير السعوديين'}]}),
        optional('gender','الجنس','select',{value:rules.gender??'',options:[{value:'',label:'الكل'},{value:'female',label:'العاملات'},{value:'male',label:'العاملون'}]}),
        optional('contract_types','نوع العقد','checks',{value:rules.contract_types??[],options:select(names.contract_types),hint:'خلّها فاضية لكل العقود.'}),
        optional('past_probation','بعد فترة التجربة','select',{value:rules.past_probation?'yes':'no',options:yesNo}),
        optional('contract_clause','بحسب نص العقد','select',{value:rules.contract_clause?'yes':'no',options:yesNo}),
        optional('event','تنطبق عند حدث','select',{value:rules.event??'',options:[{value:'',label:'لا'},...select(names.events)]}),
        field('value_basis','أساس القيمة','select',{value:r.value_basis,options:select(names.value_basis)}),
        optional('percent','النسبة من الأساسي','number',{value:p.percent??'',min:1,max:100}),
        optional('months','عدد أشهر الأساسي','number',{value:p.months??'',min:1,max:24}),
        optional('amount','المبلغ الثابت بالريال','text',{value:p.amount_minor?String(p.amount_minor/100):'',maxLength:12}),
        optional('value_text','نص القيمة','textarea',{value:p.text??'',maxLength:600}),
        ...(id==='medical_insurance'?[optional('upgrade_at_employee_cost','ترقية الفئة على حساب الموظف مسموحة','select',{value:p.upgrade_at_employee_cost?'yes':'no',options:yesNo})]:[]),
        ...(id==='air_ticket'?[optional('cash_equivalent','صرف قيمة التذكرة نقدًا مسموح','select',{value:p.cash_equivalent===false?'no':'yes',options:yesNo})]:[]),
        field('frequency','التكرار','select',{value:r.frequency,options:select(names.frequency)}),
        field('claim_method','طريقة الاستحقاق','select',{value:r.claim_method,options:select(names.claim)}),
        optional('documents','المستندات المطلوبة','rows',{minRows:0,maxRows:10,value:r.documents.map(d=>({doc:d})),columns:[{name:'doc',label:'المستند'}]}),
        field('change_note','سبب التعديل ومصدره','textarea',{maxLength:1000,hint:'مثل: مصفوفة المزايا المعتمدة بتاريخ … أو قرار المالك.'})],
        toPayload:v=>({...(entry.draft?{version:entry.draft.version}:{}),name:v.name,summary:v.summary,source_kind:v.source_kind,article:v.article??'',source_note:v.source_note,
          rules:{...(v.min_tenure_months!==''&&v.min_tenure_months!==undefined?{min_tenure_months:Number(v.min_tenure_months)}:{}),...(v.nationality?{nationality:v.nationality}:{}),...(v.gender?{gender:v.gender}:{}),
            ...(v.contract_types?.length?{contract_types:v.contract_types}:{}),...(v.past_probation==='yes'?{past_probation:true}:{}),...(v.contract_clause==='yes'?{contract_clause:true}:{}),...(v.event?{event:v.event}:{})},
          value_basis:v.value_basis,value_params:{...(v.percent?{percent:Number(v.percent)}:{}),...(v.months?{months:Number(v.months)}:{}),...(v.amount?{amount:v.amount}:{}),...(v.value_text?{text:v.value_text}:{}),
            ...(v.upgrade_at_employee_cost?{upgrade_at_employee_cost:v.upgrade_at_employee_cost==='yes'}:{}),...(v.cash_equivalent?{cash_equivalent:v.cash_equivalent==='yes'}:{})},
          frequency:v.frequency,claim_method:v.claim_method,documents:(v.documents??[]).map(d=>d.doc).filter(Boolean),change_note:v.change_note})};
    }
    if(action==='accept_benefit'||action==='reject_benefit'){
      const entry=data.catalog.find(c=>c.draft?.id===id),r=entry?.draft;guard(r&&r.actions.includes(action));
      if(action==='reject_benefit')return {title:`رفض مسودة — ${r.name}`,endpoint:`/benefits-admin/catalog/${id}/reject`,fields:[field('note','سبب الرفض','textarea',{maxLength:1000})],toPayload:v=>({version:r.version,note:v.note})};
      return {title:`اعتماد الميزة — ${r.name}`,endpoint:`/benefits-admin/catalog/${id}/accept`,submit:'اعتماد',fields:[field('effective_from','تاريخ السريان','date'),
        (r.source_kind==='regulation'?optional:field)('note','أساس الاعتماد','textarea',{maxLength:1000,hint:r.source_kind==='regulation'?'اختياري إذا المصدر مادة منصوصة.':'لازم: مصدر القرار (مصفوفة المزايا المعتمدة أو قرار المالك وتاريخه).'})],
        toPayload:v=>({version:r.version,effective_from:v.effective_from,...(v.note?{note:v.note}:{})})};
    }
    if(action==='hand_to_payroll'){
      const p=data.proposals.find(x=>x.id===id);guard(p&&p.actions.includes(action));
      return {title:`تسليم ${p.reference} إلى حركات الرواتب`,endpoint:`/benefits-admin/proposals/${id}/hand_to_payroll`,submit:'تسليم مقترحًا',fields:[field('month','شهر المسير','text',{value:data.month,maxLength:7,hint:'بصيغة 2026-09. تنشأ حركة مقترحة يعتمدها معتمد الرواتب، والصرف يصير من المسير.'})],
        toPayload:v=>({version:p.version,month:v.month})};
    }
    if(action==='upload_card'){
      const c=data.enrolment_cards.find(x=>x.enrolment_id===id);guard(c&&c.actions.includes(action));
      return {title:`بطاقة التأمين — ${c.employee_name}`,endpoint:'/my-benefits/documents',idempotent:true,fields:[field('label','وصف الملف','text',{value:'بطاقة التأمين الطبي',maxLength:180}),field('file','الملف','file',{hint:'PDF أو PNG أو JPEG لين 2 ميغابايت. ما يشوفه إلا الموظف وفريق المزايا.'})],
        toPayload:v=>({owner_kind:'enrolment',owner_id:id,label:v.label,filename:v.file.filename,content:v.file.content})};
    }
    const r=[...data.queue.hr,...data.queue.finance,...data.queue.recent].find(x=>x.id===id);guard(r&&r.actions.includes(action));
    const endpoint=`/benefits-admin/requests/${id}/${action}`;
    if(action==='hr_reject'||action==='finance_reject')return {title:`رفض ${r.reference}`,endpoint,fields:[field('note','سبب الرفض','textarea',{maxLength:1000,hint:'يقراه الموظف في «مزاياي».'})],toPayload:v=>({version:r.version,note:v.note})};
    if(action==='finance_approve')return {title:`تأكيد ${r.reference} مقترحًا`,endpoint,submit:'تأكيد مقترحًا',fields:[optional('note','ملاحظة','textarea',{maxLength:1000,hint:'التأكيد ينشئ مقترح صرف أو خصم، ومُعد الرواتب يسلّمه لحركات المسير.'})],toPayload:v=>({version:r.version,...(v.note?{note:v.note}:{})})};
    if(action==='upload_request_document')return {title:`إرفاق مستند — ${r.reference}`,endpoint:'/my-benefits/documents',idempotent:true,
      fields:[field('label','وصف المستند','text',{maxLength:180,value:r.option==='benefit_letter'?'خطاب المزايا الصادر':''}),field('file','الملف','file')],
      toPayload:v=>({owner_kind:'request',owner_id:id,label:v.label,filename:v.file.filename,content:v.file.content})};
    const note=optional('note','ملاحظة القرار','textarea',{maxLength:1000});
    const extra={dependant_add:[field('added_on','تاريخ الإضافة لدى شركة التأمين','date',{hint:'أضف التابع عند شركة التأمين أول، والاعتماد هنا يسجّل الإضافة في وثيقة الموظف.'})],
      dependant_remove:[field('removed_on','تاريخ الحذف لدى شركة التأمين','date')],
      class_upgrade:[field('amount','فرق القسط بالريال','text',{maxLength:12,hint:'من عرض شركة التأمين، ويصير خصمًا مقترحًا بعد تأكيد المالية.'})],
      ticket_claim:[field('travel_class','الدرجة المستحقة (م41)','select',{options:data.ticket_classes.map(c=>({value:c.key,label:c.name}))}),field('amount','المبلغ بالريال','text',{maxLength:12,hint:'قيمة الدرجة المستحقة بأقل سعر متاح (م41/1/ث).'})],
      education_claim:[field('amount','المبلغ المعتمد بالريال','text',{maxLength:12,hint:'ما يزيد على الفاتورة ولا على السقف المعتمد.'})],
      // خطاب صار طلبًا في وحدة الخطابات (ترحيل 105) لا يُسأل عن مرجع يدوي: الاعتماد هنا يفسح الطريق لإعداده وإصداره هناك.
      benefit_letter:r.letter?[]:[field('letter_reference','مرجع الخطاب الصادر','text',{maxLength:120,hint:'ارفع الخطاب على الطلب بعد الاعتماد.'})]}[r.option];
    return {title:`اعتماد ${r.reference} — ${r.option_name}`,endpoint,submit:'اعتماد',fields:[...extra,note],
      toPayload:v=>({version:r.version,...Object.fromEntries(extra.map(f=>[f.name,v[f.name]])),...(v.note?{note:v.note}:{})})};
  }
};
