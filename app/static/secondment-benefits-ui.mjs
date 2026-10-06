// شاشتا تعميم بدل الانتداب والمزايا الثلاث الجديدة (ترحيل 112).
// «إدارة الانتداب والبدل»: نسخ جدول البدل مؤرخةً، ودرجات التذاكر، وقرار تاريخ السريان المعلّق، والدرجات الوظيفية.
// «مزايا إضافية»: مداخل الموظف للمزايا الثلاث داخل «مزاياي»، وطوابير القرار لمن يملك تصريحها.
// لا أنماط مضمنة ولا سكربت (سياسة CSP صارمة). كل قرار على طلب يُعرض حدثَ هوية: من قرر ومتى وبأي صفة. ولا شيء للطباعة.
// تمريرة الشاشة (1 أكتوبر 2026، مهارات better-* وقواعد المالك): الأقسام h2 وما تحتها h3؛ النسخة السارية أولًا ومفتوحة؛ التاريخ
// <time> بصيغته المزدوجة بلا اتجاه يساري يقلب نصفيه؛ المبلغ رقمه مجدول معزول و«ريال» بعده؛ صوت المنصة نجدي يومي، والمعدلات
// والمواد كما نُقلت من التعميم واللائحة؛ والنسخة المفعّلة تُعرض بمضمونها وسريانها وسندها بلا من فعّلها (سجل التدقيق يحفظه).
import { dual } from './dates.mjs';
import { countNoun } from './arabic-count.mjs';

const field=(name,label,type='text',extra={})=>({name,label,type,required:true,...extra});
const optional=(name,label,type='text',extra={})=>field(name,label,type,{required:false,...extra});
// نصها مثبَّت في tests/service-switch-review.test.mjs (/الإجراء غير متاح|غير متاح/)، فيبقى حتى يُحدَّث الاختبار مع جملة المنصة
// «الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.» التي تقولها «مزاياي».
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح. أعد تحميل الصفحة.');};
// البلاطة المحلية باقية عمدًا، مطابقة بالحرف لـui.tile: tests/kit.test.mjs يشترط أربعين نسخة محلية على الأقل، فتُرحَّل نسخ
// شاشات الموارد البشرية كلها مرة واحدة مع ذلك الحد لا شاشةً شاشة (قرار الدفعة، 1 أكتوبر 2026).
const tile=(e,value,label,tone='')=>`<div class="vn-tile ${tone}"><strong>${e(value)}</strong><span>${e(label)}</span></div>`;
// الرموز والمراجع: اتجاه يساري معزول بأرقام مجدولة، حتى لا يقلبها السياق العربي.
const ltr=(e,value)=>`<span class="ltr">${e(value)}</span>`;
// المبلغ في جملة: رقمه معزول بأرقام مجدولة، و«ريال» بعده في مجرى السطر العربي، فيُقرأ «900.00 ريال» كما يُقال.
const amount=(e,money,minor)=>{if(minor===null||minor===undefined)return '—';const text=money(minor),m=/^(.*\S)\s*SAR$/.exec(text);return m?`${ltr(e,m[1])} ريال`:e(text);};
// التاريخ بصيغته المزدوجة (ميلادي · هجري) داخل <time> وdatetime أول عشرة أحرف. لا يُعزل يساريًا: الاتجاه اليساري كان يقلب
// ترتيب النصفين فيُقرأ الهجري قبل الميلادي.
const dualDay=(e,iso)=>`<time datetime="${e(String(iso).slice(0,10))}">${e(dual(iso))}</time>`;
// الشهر (YYYY-MM) كما هو، داخل <time>.
const monthTime=(e,ym)=>`<time datetime="${e(ym)}">${e(ym)}</time>`;
// العدد في عنوان أو جملة: رقمه وحده بأرقام مجدولة ([data-num])، والاسم بعده بصورته الصحيحة (arabic-count.mjs).
const num=(e,n)=>`<span data-num>${e(n)}</span>`;
const counted=(e,n,forms)=>e(countNoun(n,forms)).replace(/^-?\d+/,m=>num(e,m));
const GRADES=['درجة واحدة','درجتان','درجات','درجة'];
const VERSION_TONE={active:'is-ok',draft:'is-due',expired:'is-old'};
const VERSION_STATE={active:'سارية',draft:'مسودة ما تفعّلت',expired:'منتهية'};
// السارية أولًا، ثم ما ينتظر تفعيله، ثم المنتهية: يُقرأ اليوم قبل الغد قبل الأمس.
const VERSION_ORDER={active:0,draft:1,expired:2};
const STATUS_TONE={pending_hr:'is-due',pending_employee:'is-due',pending_authority:'is-due',pending_finance:'is-due',
  completed:'is-ok',rejected:'is-late',withdrawn:'is-old'};

// القرار المعلّق يُعرض بنصه ولا يُطوى: ما لم يحسمه المصدر لا ترجّح فيه الشاشة. حاله مكتوبة لقارئ الشاشة، لا باللون وحده.
const decision=(e,d)=>`<li class="is-warn"><strong><span class="sr-only">قرار معلّق: </span>${e(d.title)}</strong><span>${e(d.detail)}</span><small class="subtle">${ltr(e,d.key)}</small></li>`;
const decisions=(e,list)=>list.length?`<ul class="vn-list">${list.map(d=>decision(e,d)).join('')}</ul>`:'<p class="subtle">ما فيه قرار معلّق.</p>';

const gradeRow=(e,money,names)=>g=>`<li><strong><bdi>${e(g.grade_code)}</bdi> — ${e(names.grades[g.grade_code]??g.grade)}</strong>
  <span>داخل المملكة: ${amount(e,money,g.domestic_minor)} يوميًا · خارجها: ${amount(e,money,g.abroad_minor)} يوميًا</span>
  <small>درجة التذكرة: ${e(names.classes[g.ticket_class]??g.ticket_class)} · مصدرها: ${e(g.ticket_class_source)}</small>
  ${g.ticket_class_conflict?`<small class="is-warn-text measure">${e(g.ticket_class_conflict)}</small>`:''}</li>`;

const versionCard=(e,money,button,names)=>v=>{
  const grades=v.grades??[];
  return `<details class="vn-card"${v.status==='active'?' open':''}><summary>
    <span class="vn-code">${ltr(e,v.code)}</span>
    <span class="vn-name"><strong>${e(v.title)}</strong><small>${v.articles?.length?e(v.articles.join(' · ')):'ما لها سند مذكور'} · ${counted(e,grades.length,GRADES)}</small></span>
    <span class="vn-flags"><span class="vn-flag ${VERSION_TONE[v.status]??''}">${e(VERSION_STATE[v.status]??v.status)}</span>
      ${v.requires_attestation?'<span class="vn-flag">تحتاج إقرار المدير</span>':''}</span></summary>
  <div class="vn-body"><ul class="vn-list">
    <li><strong>السريان</strong><span>${v.effective_from?`من ${dualDay(e,v.effective_from)}`:'ما لها تاريخ سريان، فما تسري'}${v.effective_to?` إلى ${dualDay(e,v.effective_to)}`:''}</span></li>
    <li><strong>التقريب</strong><span>${e(v.rounding==='riyal_up'?'إلى أقرب ريال بالزيادة (م50/5)':'بالهللة، بلا تقريب')}</span></li>
    <li><strong>بدل الكيلومتر</strong><span>${amount(e,money,v.mileage_rate_minor)} لكل كيلومتر</span></li>
    ${v.pending_note?`<li class="is-warn"><strong>وش يمنع تفعيلها</strong><span>${e(v.pending_note)}</span></li>`:''}
  </ul>
  <section class="vn-block"><h3>البدل ودرجة التذكرة لكل درجة وظيفية</h3>
  ${grades.length?`<ul class="vn-list">${grades.map(gradeRow(e,money,names)).join('')}</ul>`:'<p class="subtle">ما فيه درجات في هذي النسخة.</p>'}</section>
  ${v.actions?.length?`<div class="operation-actions">${v.actions.map(a=>button(a,v.id,'تفعيل النسخة بتاريخ سريانها')).join('')}</div>`:''}</div></details>`;
};

export const secondmentUI={
  title:'الانتداب وبدلاته',
  description:'جدول بدل الانتداب بنسخه المؤرخة: بدل كل درجة داخل المملكة وخارجها، ودرجة تذكرتها، والدرجات الوظيفية.',
  load:api=>api('/secondment'),
  render(data,{e,button,money}){
    const drafts=data.versions.filter(v=>v.status==='draft');
    const live=data.version_in_force;
    // أسماء الدرجات ودرجات التذاكر تُقرأ من بيانات المرجع لا تُكتب هنا: الصف يحمل الرمز، والاسم مصدره الجدول.
    const names={grades:Object.fromEntries(data.grades.map(g=>[g.code,g.name_ar])),classes:data.ticket_classes};
    const versions=[...data.versions].sort((a,b)=>(VERSION_ORDER[a.status]??3)-(VERSION_ORDER[b.status]??3));
    // الشريط للأرقام وحدها، والأقسام بعده إخوةٌ له لا داخله؛ والجدول الساري — ما تُفتح الشاشة لأجله — أول قسم.
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p></section>
      <section class="vn-board">
      <div class="vn-tiles">
        ${tile(e,live?live.title:'ما فيه نسخة سارية','النسخة السارية اليوم',live?'is-ok':'is-late')}
        ${tile(e,drafts.length,'نسخ تنتظر تاريخ سريانها',drafts.length?'is-due':'')}
        ${tile(e,data.open_decisions.length,'قرارات معلّقة',data.open_decisions.length?'is-warn':'')}
        ${tile(e,data.grades.length,'درجات وظيفية في الجدول')}
      </div></section>
      <section class="vn-block"><div class="panel-head"><div><h2>نسخ جدول البدل (${num(e,data.versions.length)})</h2>
        <p>النسخة المنتهية تبقى مثل ما هي: القرار اللي صدر بها ينقرا بها، وما ينعاد حسابه بنسخة جت بعدها.</p></div></div>
        ${versions.map(versionCard(e,money,button,names)).join('')}</section>
      <section class="vn-block"><div class="panel-head"><div><h2>قرارات تنتظر صاحبها</h2>
        <p>ما حسمها المصدر، فتبقى بنصها لين يقررها مالك الإجراء.</p></div></div>
        ${decisions(e,data.open_decisions)}</section>
      <section class="vn-block"><div class="panel-head"><h2>درجات التذاكر (م41)</h2></div>
        <ul class="vn-list">${Object.entries(data.ticket_classes).map(([key,name])=>`<li><strong>${e(name)}</strong><small>${ltr(e,key)}</small></li>`).join('')}</ul>
        <h3>حالات التذكرة المعترف بها</h3>
        <ul class="vn-list">${data.ticket_modes.map(m=>`<li><strong>${e(m.name)}</strong>${m.note?`<span>${e(m.note)}</span>`:''}<small>${ltr(e,m.key)}</small></li>`).join('')}</ul></section>
      <section class="vn-block"><div class="panel-head"><div><h2>الدرجات الوظيفية</h2>
        <p>الطلب اللي يعتمد على الدرجة ينرفض لين تسجّل الموارد البشرية درجة الموظف وسندها.</p></div></div>
        <ul class="vn-list">${data.grades.map(g=>`<li><strong><bdi>${e(g.code)}</bdi> — ${e(g.name_ar)}</strong>
          ${g.note?`<small>${e(g.note)}</small>`:''}
          ${g.needs_confirmation?'<small class="is-warn-text">التسمية تنتظر تأكيد المالك.</small>':''}</li>`).join('')}</ul>
        <div class="operation-actions">${button('record_grade','new','تسجيل درجة موظف')}</div></section>`;
  },
  form(action,id,data){
    if(action==='record_grade')return {title:'تسجيل الدرجة الوظيفية',endpoint:'/secondment/grades',submit:'تسجيل الدرجة',
      fields:[field('user_id','معرّف الموظف','text',{maxLength:64,hint:'تلقاه في شاشة الموظفين. الدرجة يسجّلها فريق السجل الوظيفي، مو الموظف نفسه.'}),
        field('grade_code','الدرجة','select',{options:data.grades.map(g=>({value:g.code,label:`${g.code} — ${g.name_ar}`}))}),
        optional('note','سند الدرجة','textarea',{maxLength:600,hint:'العقد أو قرار التعيين اللي تنقرا منه الدرجة.'})],
      toPayload:v=>({user_id:v.user_id,grade_code:v.grade_code,note:v.note||''})};
    const version=data.versions.find(x=>x.id===id);
    guard(version&&version.actions.includes(action));
    return {title:`تفعيل ${version.title}`,endpoint:`/secondment/versions/${id}/activate`,submit:'تفعيل النسخة',
      fields:[field('effective_from','تاريخ السريان','date',
          {hint:'التعميم ما ذكر تاريخ سريان، فهذا التاريخ تقرره الإدارة. والنسخة السارية تنتهي في اليوم اللي قبله.'}),
        field('note','أساس التفعيل','textarea',{minLength:10,maxLength:2000,
          hint:'قرار الإدارة وتاريخه، وإقرارك إن قيم الجدول تطابق النسخة الموقعة — القيم انكتبت من نص مستخرج آليًا، فطابقها قبل التفعيل.'})],
      toPayload:v=>({version:version.version,effective_from:v.effective_from,note:v.note})};
  }
};

/* ───── المزايا الثلاث ───── */

const EXTRA_LABELS={withdraw_request:'سحب الطلب',consent_deduction:'الإقرار بالموافقة على الخصم',
  hr_quote:'إدخال عرض شركة التأمين',hr_approve:'اعتماد المطالبة',hr_reject:'رفض المطالبة',
  authority_approve:'اعتماد صاحب الصلاحية',finance_approve:'تأكيد شهر الصرف',finance_reject:'رفض ماليًا',
  hand_to_payroll:'تسليم إلى حركات الرواتب'};
// حال المبلغ المقترح في جدول الأقساط، صادقةً للخصم (تأمين الوالدين) وللصرف (الدراسة والأندية) معًا؛ والمفتاح الخام لا يظهر للقارئ.
const INSTALMENT_STATE={proposed:'ما انسلّم للرواتب للحين',handed_to_payroll:'انسلّم لحركات الرواتب',cancelled:'ملغى'};

const requestCard=(e,button,money)=>r=>{
  // كل خطوة حدث هوية — من قرر ومتى وبأي صفة — بترتيب وقوعها، من التقديم إلى آخر قرار. لا سطر توقيع ولا صورة توقيع ولا نسخة للطباعة.
  const event=(role,who,at,note)=>who?{at:at??'',html:`<div class="timeline-item"><strong>${e(role)}: ${e(who)}</strong>${at?`<small>${dualDay(e,at.slice(0,10))}</small>`:''}${note?`<p class="measure">${e(note)}</p>`:''}</div>`}:null;
  const history=[r.consent_at?event('إقرار الموظف (م51)',r.consent_by_name??'—',r.consent_at,r.consent_text):null,
    event('الموارد البشرية',r.hr_by_name,r.hr_at,r.hr_note),event('صاحب الصلاحية',r.authority_by_name,r.authority_at,r.authority_note),
    event('المالية',r.finance_by_name,r.finance_at,r.finance_note)].filter(Boolean).sort((a,b)=>(a.at||'\uffff').localeCompare(b.at||'\uffff'));
  const facts=[r.amount_minor?`<li><strong>المبلغ</strong><span>${amount(e,money,r.amount_minor)}</span><small>يمشي مع مسير الرواتب.</small></li>`:'',
    r.cap_minor?`<li><strong>السقف</strong><span>${amount(e,money,r.cap_minor)}</span></li>`:'',
    r.payment_mode?`<li><strong>طريقة السداد</strong><span>${r.payment_mode==='instalments'?`على ${num(e,r.instalment_months)} قسط شهري`:'خصم مرة وحدة'}</span></li>`:'',
    r.reimbursement_month?`<li><strong>شهر الصرف</strong><span>${monthTime(e,r.reimbursement_month)}</span><small>${e(r.outcome?.paid_on_note??'')}</small></li>`:''].join('');
  // أقسام الجسم تحت عنوان الشاشة h2: عناوينها h3 داخل vn-block فتبقى بهيئة التسمية الصغيرة.
  const part=(title,body)=>`<section class="vn-block"><h3>${title}</h3>${body}</section>`;
  return `<details class="vn-card"><summary>
    <span class="vn-code">${ltr(e,r.reference)}</span>
    <span class="vn-name"><strong>${e(r.kind_name)}${r.employee_name?` · ${e(r.employee_name)}`:''}</strong>
      <small>${e(r.grade_name??'بلا درجة مسجلة')} · سنة ${ltr(e,r.benefit_year)}</small></span>
    <span class="vn-flags"><span class="vn-flag ${STATUS_TONE[r.status]??''}">${e(r.status_name)}</span></span></summary>
  <div class="vn-body">
    ${r.calculation?.steps?.length?part('الحساب بخطواته',`<ol class="vn-list">${r.calculation.steps.map(s=>`<li><span>${e(s)}</span></li>`).join('')}</ol>`):''}
    ${facts?`<ul class="vn-list">${facts}</ul>`:''}
    ${part('سير الطلب',`<div class="timeline"><div class="timeline-item"><strong>انقدّم الطلب</strong><small>${dualDay(e,r.created_at.slice(0,10))}</small></div>${history.map(x=>x.html).join('')}</div>`)}
    ${r.parents?.length?part('الوالدان',`<ul class="vn-list">${r.parents.map(p=>`<li><strong>${e(p.parent_name)}</strong><span>${e(p.relation==='father'?'الوالد':'الوالدة')} · مواليد ${dualDay(e,p.birth_date)}</span></li>`).join('')}</ul>`):''}
    ${r.children?.length?part('الأبناء',`<ul class="vn-list">${r.children.map(c=>`<li><strong>${e(c.child_name)}</strong><span>${e(c.stage)} · ${e(c.school)}</span><small>المطلوب: ${amount(e,money,c.claimed_minor)}${c.approved_minor?` · المعتمد: ${amount(e,money,c.approved_minor)}`:''}</small></li>`).join('')}</ul>`):''}
    ${r.invoices?.length?part('الفواتير',`<ul class="vn-list">${r.invoices.map(x=>`<li><strong>${ltr(e,x.invoice_number)}</strong><span>${e(x.supplier_name)} · ${dualDay(e,x.invoice_date)} · ${amount(e,money,x.amount_minor)}</span></li>`).join('')}</ul>`):''}
    ${r.instalments?.length?part(r.kind==='parents_insurance'?'الأقساط المقترحة':'المبلغ المقترح للرواتب',`<ul class="vn-list">${r.instalments.map(i=>`<li><strong>${monthTime(e,i.month)}</strong><span>${amount(e,money,i.amount_minor)}</span><small>${e(INSTALMENT_STATE[i.status]??i.status)}</small></li>`).join('')}</ul>`):''}
    ${r.actions.length?`<div class="operation-actions">${r.actions.map(a=>button(a,r.id,EXTRA_LABELS[a]??a)).join('')}</div>`:''}</div></details>`;
};

// مدخل الميزة: اسمها وما هي، ثم سقفها وزر طلبها إن كانت متاحة، أو سبب عدم إتاحتها. summaryHtml ترميز جاهز مهرَّب من صاحبه.
const entry=(e,button,money,key,name,state,summaryHtml)=>{
  const limits=[state.cap_minor?`السقف: ${amount(e,money,state.cap_minor)}`:'',state.max_children?`لين ${num(e,state.max_children)} من الأبناء`:''].filter(Boolean).join(' · ');
  return `<article class="vn-card"><div class="vn-body">
  <h3>${e(name)}</h3><p class="measure">${summaryHtml}</p>
  ${state.available
    ?`${limits?`<p>${limits}</p>`:''}
      ${state.warning?`<p class="subtle measure">${e(state.warning)}</p>`:''}
      <div class="operation-actions">${button(`request_${key}`,key,'اطلبها')}</div>`
    :`<p class="subtle measure">${e(state.reason)}</p>`}</div></article>`;
};

export const benefitExtrasUI={
  title:'مزايا إضافية',
  description:'تأمين الوالدين ودراسة الأبناء والأندية الصحية والأجهزة الرياضية: شروطها ووش تستحق منها، ومن هنا تطلبها وتتابع قرارها.',
  load:api=>api('/benefit-extras'),
  render(data,{e,button,money}){
    const a=data.availability,s=data.settings;
    const kindName=key=>data.kinds.find(k=>k.key===key)?.name??key;
    const parents=`اشتراك والديك في وثيقة التأمين الطبي بنصيبك: ${ltr(e,s.parents_share_percent+'%')} من قيمة الوثيقة، بحد ${amount(e,money,s.parents_cap_minor)} لكل والد، تدفعه مرة وحدة أو على أقساط لين ${num(e,s.parents_max_instalments)} قسط.`;
    // عدد الموقوفة يُقال في العنوان بنصه المثبَّت في tests/service-switch-review.test.mjs («منها 3 أوقفها المالك…»)، فلا يُلفّ رقمه بوسم.
    const three=`<section class="vn-block"><div class="panel-head"><h2>المزايا الثلاث${data.switched_off_count?` — منها ${e(data.switched_off_count)} أوقفها المالك من إعدادات الخدمات`:''}</h2></div>
        <div class="vn-cards">
          ${entry(e,button,money,'parents',kindName('parents_insurance'),a.parents_insurance,parents)}
          ${entry(e,button,money,'education',kindName('children_education'),a.children_education,
            e('بدل دراسة أولادك بفاتورة ضريبية وإثبات قيد لكل واحد منهم. والفاتورة الوحدة ما تنصرف مرتين.'))}
          ${entry(e,button,money,'sports',kindName('sports'),a.sports,
            e('اشتراك نادي رياضي أو أجهزة رياضية بفاتورة ضريبية. طلب واحد في السنة الميلادية، وتاخذ الأقل من الفاتورة والسقف.'))}
        </div></section>`;
    const mine=`<section class="vn-block"><div class="panel-head"><h2>طلباتك (${num(e,data.requests.length)})</h2></div>
        ${data.requests.map(requestCard(e,button,money)).join('')||'<p class="subtle">ما عندك طلب في هذي المزايا للحين. تطلبها من بطاقتها في «المزايا الثلاث».</p>'}</section>`;
    // ما ينتظر قرار القارئ أولًا، ثم طلباته إن كانت له طلبات، ثم المزايا الثلاث؛ وبلا طلبات تنزل «طلباتك» بعدها.
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
        <p class="subtle">درجتك الوظيفية: ${data.grade?`<bdi>${e(data.grade.code)}</bdi> — ${e(data.grade.name)}`:'ما انسجّلت للحين'} · ${e(data.eligibility.text)}</p>
        <p class="subtle"><a href="#my-benefits">ارجع إلى «مزاياي»</a></p></section>
      <section class="vn-board">
      <div class="vn-tiles">
        ${tile(e,data.requests.length,'طلباتك')}
        ${tile(e,data.queue.length,'تنتظر قرارك',data.queue.length?'is-due':'')}
        ${tile(e,data.eligibility.ok?'مكتملة':'ناقصة','شروط الأهلية المشتركة',data.eligibility.ok?'is-ok':'is-late')}
        ${tile(e,s.min_appraisal_percent+'%','أقل تقييم أداء مطلوب')}
      </div></section>
      ${data.queue.length?`<section class="vn-block"><div class="panel-head"><h2>تنتظر قرارك (${num(e,data.queue.length)})</h2></div>
        ${data.queue.map(requestCard(e,button,money)).join('')}</section>`:''}
      ${data.requests.length?mine:''}
      ${three}
      ${data.requests.length?'':mine}
      <section class="vn-block"><div class="panel-head"><h2>قرارات معلّقة تخص هذه المزايا</h2></div>
        ${decisions(e,data.open_decisions)}</section>`;
  },
  form(action,id,data){
    const invoiceFields=[
      field('invoice_number','رقم الفاتورة الضريبية','text',{maxLength:60}),
      field('supplier_tax_number','الرقم الضريبي للمورد','text',{maxLength:40}),
      field('supplier_name','اسم المورد','text',{maxLength:160}),
      field('invoice_date','تاريخ الفاتورة','date'),
      field('amount','مبلغ الفاتورة بالريال','text',{maxLength:14,hint:'مثل 5500.00'})];
    const invoiceOf=v=>({invoice_number:v.invoice_number,supplier_tax_number:v.supplier_tax_number,
      supplier_name:v.supplier_name,invoice_date:v.invoice_date,amount:v.amount});

    if(action==='request_parents'){
      guard(data.availability.parents_insurance.available);
      return {title:'طلب تأمين الوالدين',endpoint:'/benefit-extras/parents',idempotent:true,submit:'إرسال الطلب',
        fields:[field('relation','صلة القرابة','select',{options:[{value:'father',label:'الوالد'},{value:'mother',label:'الوالدة'}]}),
          field('parent_name','الاسم','text',{maxLength:160}),
          field('id_reference','مرجع إثبات صلة القرابة','text',{maxLength:120,hint:'رقم كرت العائلة أو مرجع الوثيقة. لا تكتب رقم الهوية كامل.'}),
          field('birth_date','تاريخ الميلاد','date'),
          field('payment_mode','طريقة سداد نصيبك','select',{options:[{value:'single',label:'خصم مرة وحدة'},{value:'instalments',label:'أقساط شهرية'}]}),
          optional('instalment_months','عدد الأقساط','number',{min:2,max:data.settings.parents_max_instalments,
            hint:`لين ${data.settings.parents_max_instalments} شهر. خلّه فاضي إذا الخصم مرة وحدة.`}),
          optional('note','ملاحظة','textarea',{maxLength:1000})],
        toPayload:v=>({parents:[{relation:v.relation,parent_name:v.parent_name,id_reference:v.id_reference,birth_date:v.birth_date}],
          payment_mode:v.payment_mode,instalment_months:v.payment_mode==='instalments'?Number(v.instalment_months):undefined,note:v.note||''})};
    }
    if(action==='request_education'){
      guard(data.availability.children_education.available);
      return {title:'طلب بدل دراسة الأبناء',endpoint:'/benefit-extras/education',idempotent:true,submit:'إرسال الطلب',
        fields:[field('academic_year','العام الدراسي','text',{maxLength:9,hint:'بصيغة 2026-2027'}),
          field('child_name','اسم الابن أو الابنة','text',{maxLength:160}),
          field('birth_date','تاريخ الميلاد','date'),
          field('stage','المرحلة الدراسية','text',{maxLength:60}),
          field('school','اسم المدرسة','text',{maxLength:160}),
          field('enrolment_proof','مرجع إثبات القيد','text',{maxLength:120}),
          ...invoiceFields,
          optional('note','ملاحظة','textarea',{maxLength:1000})],
        toPayload:v=>({academic_year:v.academic_year,note:v.note||'',
          children:[{child_name:v.child_name,birth_date:v.birth_date,stage:v.stage,school:v.school,
            enrolment_proof:v.enrolment_proof,invoice:invoiceOf(v)}]})};
    }
    if(action==='request_sports'){
      guard(data.availability.sports.available);
      return {title:'طلب الأندية الصحية والأجهزة الرياضية',endpoint:'/benefit-extras/sports',idempotent:true,submit:'إرسال الطلب',
        fields:[field('category','نوع المصروف','select',{options:data.sports_categories.map(c=>({value:c.key,label:c.name}))}),
          ...invoiceFields,
          field('acknowledged_single_request','أقر بعلمي أن هذه الميزة طلب واحد في السنة الميلادية','checkbox',
            {hint:data.availability.sports.warning??'بعد هذا الطلب يتقفّل رصيد السنة لين السنة الجاية.'}),
          optional('note','ملاحظة','textarea',{maxLength:1000})],
        toPayload:v=>({category:v.category,invoice:invoiceOf(v),acknowledged_single_request:v.acknowledged_single_request==='on',note:v.note||''})};
    }

    const r=[...data.requests,...data.queue].find(x=>x.id===id);
    guard(r&&r.actions.includes(action));
    const base={title:`${EXTRA_LABELS[action]} — ${r.reference}`,submit:EXTRA_LABELS[action]};
    if(action==='withdraw_request')return {...base,endpoint:`/benefit-extras/${id}/withdraw`,fields:[],toPayload:()=>({version:r.version})};
    if(action==='consent_deduction')return {...base,endpoint:`/benefit-extras/${id}/consent`,
      fields:[field('consent',data.consent_text,'checkbox',{hint:'الخصم من الأجر ما يجوز بدون موافقتك الكتابية (م51)، وإقرارك ينحفظ بنصه.'}),
        optional('confirmed_amount','المبلغ كما تشوفه بالريال','text',{maxLength:14,hint:'اختياري، وإذا كتبته لازم يطابق المبلغ المعروض.'})],
      toPayload:v=>({version:r.version,consent:v.consent==='on',confirmed_amount:v.confirmed_amount||''})};
    if(action==='hr_quote')return {...base,endpoint:`/benefit-extras/${id}/hr_quote`,
      fields:[field('policy_value','قيمة وثيقة التأمين بالريال','text',{maxLength:14,hint:'من عرض شركة التأمين.'}),
        field('documents_verified','أقر بالتحقق من مستندات صلة القرابة','checkbox'),
        optional('note','ملاحظة','textarea',{maxLength:1000})],
      toPayload:v=>({version:r.version,policy_value:v.policy_value,documents_verified:v.documents_verified==='on',note:v.note||''})};
    if(action==='authority_approve')return {...base,endpoint:`/benefit-extras/${id}/authority_approve`,
      fields:[field('first_month','أول شهر خصم','text',{maxLength:7,hint:'بصيغة 2026-10'}),
        field('added_on','تاريخ إضافة الوالدين إلى الوثيقة','date'),
        optional('note','ملاحظة','textarea',{maxLength:1000})],
      toPayload:v=>({version:r.version,first_month:v.first_month,added_on:v.added_on,note:v.note||''})};
    if(action==='hr_approve'||action==='hr_reject')return {...base,endpoint:`/benefit-extras/${id}/${action}`,
      fields:[...(action==='hr_approve'?[optional('amount','المبلغ المعتمد بالريال','text',{maxLength:14,hint:'خلّه فاضي عشان يُعتمد المبلغ المحسوب.'})]:[]),
        field('note',action==='hr_approve'?'أساس الاعتماد':'سبب الرفض','textarea',{minLength:5,maxLength:1000})],
      toPayload:v=>({version:r.version,amount:v.amount||'',note:v.note})};
    if(action==='finance_approve')return {...base,endpoint:`/benefit-extras/${id}/finance_approve`,
      fields:[field('month','شهر الصرف','text',{maxLength:7,hint:'بصيغة 2026-10. الصرف يصير مع مسير الشهر في آخره.'}),
        optional('note','ملاحظة التأكيد','textarea',{maxLength:1000})],
      toPayload:v=>({version:r.version,month:v.month,note:v.note||''})};
    if(action==='finance_reject')return {...base,endpoint:`/benefit-extras/${id}/finance_reject`,
      fields:[field('note','سبب الرفض','textarea',{minLength:5,maxLength:1000})],
      toPayload:v=>({version:r.version,month:'',note:v.note})};
    if(action==='hand_to_payroll')return {...base,endpoint:'/benefit-extras/payroll',
      fields:[optional('instalment_seq','رقم القسط','number',{min:1,max:24,hint:'خلّه فاضي إذا المطالبة بدون أقساط.'}),
        field('month','شهر الحركة','text',{maxLength:7,hint:'بصيغة 2026-10'})],
      toPayload:v=>({request_id:id,instalment_seq:v.instalment_seq?Number(v.instalment_seq):undefined,month:v.month})};
    guard(false);
  }
};
