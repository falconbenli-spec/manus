// ملف الموظف الموحّد: خمسة تبويبات (نظرة عامة، العقد، الخبرة، المزايا، مستندات تهمني) على شاشة كاملة لا نافذة.
// النظام المرجعي يفتحها نافذةً فوق الجدول؛ على هاتف بعرض 390 بكسل تصير النافذة صندوقًا مزدحمًا لا يُقرأ، فهي هنا شاشة
// يقودها رابط من الدليل (#employee-profile/<معرّف>)، ترجع بزر الرجوع وتُشارَك برابطها.
//
// التبويبات بلا سطر برمجي واحد: خمسة أزرار اختيار (radio) وقوائم تتبعها، والتبديل بينها قاعدة CSS في style.css.
// سياسة الأمان تمنع <script> داخل الصفحة، وزرّ الاختيار مقروء بلوحة المفاتيح أصلًا (Tab يدخل المجموعة والأسهم تتنقل فيها)
// ومعلن لقارئ الشاشة بلا ARIA مزوَّرة. وشريط مدة العقد يأخذ نسبته من data-width الذي يرسمه app.mjs (paintBars).
//
// العدّة المشتركة (ui) تصل في سياق الرسم، فلا نسخة محلية لبلاطة ولا لصف ولا لجدول هنا.
// تمييز العدد العربي من وحدته الواحدة (arabic-count.mjs). ونص شريط المدة لا يُبنى هنا: يأتي مبنيًّا في الحمولة
// (progress_text)، فلا نسختان لجملة واحدة تنحرف إحداهما عن الأخرى بأول تعديل.
import { countNoun } from './arabic-count.mjs';
import { icon } from './icons.mjs';
const fallbackTr=ar=>ar;
const idFromHash=()=>{try{return decodeURIComponent(location.hash.slice(1).split('/').slice(1).join('/'));}catch{return '';}};
const TABS=[['overview','نظرة عامة'],['contract','العقد'],['experience','الخبرة'],['benefits','المزايا'],['important-documents','مستندات تهمني']];
const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/;

export const employeeProfileUI={
  title:'ملف الموظف',title_en:'Employee profile',
  description:'بيانات الموظف من سجلات المنصة: كل بند يطلع بمصدره، واللي ما له سجل يقول ليش ومن يكمّله. رقم الهوية والإقامة ما ينسجّل.',
  description_en:'Employee data from the platform records: what has a source shows it, and what has none says why and who can supply it. No national or residency number is stored.',
  load:api=>{const who=idFromHash();return api('/employee-profile'+(who?'/'+encodeURIComponent(who):''));},
  render(data,{e,button,ui,tr=fallbackTr,date=v=>v}){
    // القيمة التي هي يومٌ بصيغة ISO تُعرض بنصها داخل <time>؛ والعدد في أول نص معدود بأرقام مجدولة.
    const value=text=>ISO_DAY.test(String(text??''))?`<time datetime="${e(text)}">${e(text)}</time>`:e(text);
    const counted=(n,forms)=>e(countNoun(n,forms)).replace(/^-?\d[\d,.]*/,m=>`<span data-num>${m}</span>`);
    // بند واحد: إمّا قيمة ومصدرها، وإمّا «غير متاح» وسببه ومن يملك سدّه، وإمّا امتناع مقصود بسببه ولا مالك له.
    const fact=f=>{
      const body=f.kind==='unavailable'
        ?`<dd class="ep-blank"><strong>${e(f.text)}</strong><small>${e(f.reason)}</small><small>${tr('لسدّه','To fill it')}: ${e(f.needed)} — ${tr('عند','With')} ${e(f.owner)}</small>${f.note?`<small>${e(f.note)}</small>`:''}</dd>`
        :f.kind==='not_stored'
          ?`<dd class="ep-refused"><strong>${e(f.text)}</strong><small>${e(f.reason)}</small></dd>`
          :`<dd><strong>${value(f.text)}</strong><small>${tr('المصدر','Source')}: ${e(f.source)}</small>${f.note?`<small>${e(f.note)}</small>`:''}</dd>`;
      return `<div class="ep-fact is-${e(f.kind)}"><dt>${e(f.label)}</dt>${body}</div>`;
    };
    const facts=list=>list.length?`<dl class="ep-facts">${list.map(fact).join('')}</dl>`:ui.empty(tr('ما فيه بنود هنا','Nothing here'));
    const block=(heading,body)=>`<section class="vn-block"><h2>${e(heading)}</h2>${body}</section>`;

    const t=data.tabs;
    // ما حُجب يُقال فوق البنود لا بدلًا منها: بندا «الرقم الوظيفي» و«رقم الهوية الوطنية» لا يخصّان شخصًا ويراهما كل قارئ،
    // وأحدهما بندٌ غرضه كله أن يُعلن امتناع المنصة — فإخفاؤه عمن حُجبت عنه البقية يخفي الإعلان عمن يحتاجه.
    const withheld=t.overview.personal_withheld;
    const overview=`<section class="vn-block"><h2>${tr('البيانات الشخصية','Personal details')}</h2>
      ${withheld?`<div class="vn-alert is-block"><strong>${e(withheld.what)}</strong><p>${e(withheld.why)} · ${tr('عند','With')} ${e(withheld.owner)}</p></div>`:''}
      ${facts(t.overview.personal)}</section>
      ${block(tr('بيانات العمل','Work details'),facts(t.overview.work))}`;

    const p=t.contract.progress;
    // الشريط رسمٌ يكرر الجملة تحته، فيُخفى عن القارئ الآلي وتبقى الجملة.
    const meter=p.percent===null
      ?`<p class="subtle">${e(t.contract.indefinite?tr('عقد غير محدد المدة، فما له نسبة إنجاز.','Indefinite contract: no completion percentage for a term with no end.'):tr('حساب المدة يبي تاريخ بداية وتاريخ نهاية مسجَّلين، فما فيه نسبة للحين.','No percentage: the term needs both a recorded start and end date.'))}</p>`
      :`<div class="ep-meter"><div class="vn-bar" data-width="${e(p.percent)}" aria-hidden="true"></div><p>${e(t.contract.progress_text)}</p></div>`;
    // شارة حالة العقد من سجل العقود نفسه، بالعدّة المشتركة وبالقاموس الواحد: الحالة الموحدة وعبارة الوحدة («معتمد» و«ساري»).
    // وبلا عقد لا شارة: شارةٌ فوق لا عقد أسوأ من غيابها.
    // التأمينات الاجتماعية: حالة مشتقة لا حقل يُكتب، بمصدرها ونسبتها. ولمن لا يرى الجنسية تُقال القاعدة لا القيمة.
    // الاستثناء المسجَّل يُقرأ بنوعه وتاريخه وسنده؛ ومن سجّله في سجل التدقيق لا على الشاشة.
    const si=t.contract.social_insurance;
    const insuranceBlock=si?`<section class="vn-block"><h2>${tr('التأمينات الاجتماعية','Social insurance')}</h2>
      ${si.visible?facts(si.fields):''}
      ${si.visible&&si.override?`<p class="subtle">${tr('استثناء مسجَّل','Recorded override')}: ${e(si.override.kind_name)} — ${value(si.override.effective_from)}. ${e(si.override.basis)}</p>`:''}
      <p class="subtle measure">${e(si.note)}</p></section>`:'';
    const contract=`<section class="vn-block"><h2>${tr('العقد','Contract')}${t.contract.status?` ${ui.statusBadge(t.contract.status.key,{module:'contract'})}`:''}</h2>${facts(t.contract.fields)}${meter}</section>
      <section class="vn-block"><h2>${tr('الأجر','Pay')}</h2><p class="subtle measure">${e(t.contract.note)}</p></section>${insuranceBlock}`;

    const experience=block(tr('الخبرة','Experience'),facts(t.experience));

    const b=t.benefits;
    // عنوان البطاقة يُقرأ وحده في القائمة المطوية. ميزةٌ لم تُعتمد تحمل في عنوانها حالة كتالوجها («مسودة») لا حالة
    // استحقاقها («مؤهل»): الثانية فوق مسودة تعد بما لم يُقرَّر، وتحذير المسودة يبقى في جسمها.
    // وسطر الحالة لا يكرر كلمته: «مؤهل · مؤهل» تُقرأ «مؤهل».
    const benefitBody=item=>`<div class="vn-body"><p>${e(item.summary)}</p>
      <p class="ep-state"><strong>${e(item.state_name)}</strong>${item.held_text?` · ${e(item.held_text)}`:item.eligibility_text&&item.eligibility_text!==item.state_name?` · ${e(item.eligibility_text)}`:''}</p>
      ${item.draft_warning?`<p class="vn-alert"><strong>${e(item.status_name)}</strong> — ${e(item.draft_warning)}</p>`:''}
      <p class="ep-next"><strong>${tr('الخطوة التالية','Next step')}:</strong> ${e(item.next_step.text)}${item.next_step.owner?` — ${tr('عند','With')} ${e(item.next_step.owner)}`:''}</p>
      <p class="subtle">${e(item.citation)}${item.value_text?` · ${e(item.value_text)}`:''}${item.frequency_name?` · ${e(item.frequency_name)}`:''}</p></div>`;
    // العدد في الترويسة عددُ ما يُعرض، وما أسقطته البوابة يُقال بعدده وسببه ومالكه: عددٌ يُقدَّم كأنه الكل بينما جزء
    // منه أُسقط صامتًا هو بعينه ما تحرس منه بقية هذه الشاشة.
    const hidden=b.hidden_pending_count>0
      ?`<p class="vn-alert"><strong>${counted(b.hidden_pending_count,['ميزة واحدة أخرى','ميزتان أخريان','مزايا أخرى','ميزة أخرى'])} ${tr('لا تظهر هنا','not shown here')}</strong> — ${tr('مسودات تنتظر اعتماد مصفوفة المزايا','drafts awaiting the benefits matrix')} — ${tr('عند','With')} ${tr('مدير الموارد البشرية','the HR manager')}</p>`
      :'';
    const benefits=b.available
      ?`<section class="vn-group"><h2>${tr('المزايا','Benefits')} <span data-num>${e(b.items.length)}</span></h2>${hidden}
        ${b.items.length?b.items.map(item=>ui.card({code:item.category_name,title:item.name,meta:item.accepted?item.state_name:item.status_name,body:benefitBody(item)})).join(''):ui.empty(tr('ما فيه ميزة معتمدة في الكتالوج للحين','No accepted benefit in the catalogue yet'),tr('تطلع هنا المزايا أول ما يعتمدها مدير الموارد البشرية.','HR accepts benefits before they appear here.'))}
        <p class="subtle">${e(b.note)}</p></section>`
      :`<section class="vn-block"><h2>${tr('المزايا','Benefits')}</h2>${ui.refusal({what:tr('مزايا هذا الموظف ما تطلع في ملفه هنا','This employee’s benefits are not shown in the profile here'),
          missing:[{document:tr('صفة على بيانات المزايا','Standing on the benefits record'),why:b.reason,owner:b.owner}],next:b.needed})}
        <p class="subtle">${e(b.note)}</p></section>`;

    const documents=t.important_documents;
    const documentCard=item=>`<article class="ep-doc-card is-${e(item.status)}">
      <header class="ep-doc-head"><span class="ep-doc-icon">${icon(item.icon,'is-tinted')}</span><span><small>${e(item.group)}</small><h3>${e(item.title)}</h3></span></header>
      <p>${e(item.summary)}</p>
      <dl class="ep-doc-meta"><div><dt>${tr('الحالة','Status')}</dt><dd><span class="ep-doc-status">${e(item.status_name)}</span></dd></div>
        ${item.source?`<div><dt>${tr('المصدر','Source')}</dt><dd>${e(item.source)}</dd></div>`:''}
        ${item.updated_at?`<div><dt>${tr('تاريخ السجل','Record date')}</dt><dd><time datetime="${e(item.updated_at)}">${e(date(item.updated_at))}</time></dd></div>`:''}
        ${item.owner?`<div><dt>${tr('عند','With')}</dt><dd>${e(item.owner)}</dd></div>`:''}</dl>
      ${item.next_step?`<p class="ep-doc-next"><strong>${tr('الخطوة التالية','Next step')}:</strong> ${e(item.next_step)}</p>`:''}
      ${item.href?`<p class="ep-doc-actions"><a class="btn" href="${e(item.href)}">${tr('افتح السجل','Open record')}</a></p>`:''}
    </article>`;
    const groups=['دوري وأدائي','حقوقي ومرجعي'];
    const importantDocuments=`<section class="vn-block ep-doc-summary"><div><p class="eyebrow">${tr('مكتبتي الوظيفية','My work library')}</p>
      <h2>${tr('مستندات تهمني','Documents for me')}</h2><p data-num>${e(documents.available)} ${tr('من','of')} ${e(documents.total)} ${tr('متاح','available')}</p></div>
      <p class="subtle measure">${e(documents.note)}</p></section>
      ${groups.map(group=>`<section class="vn-block"><h2>${e(group)}</h2><div class="ep-doc-grid">${documents.items.filter(item=>item.group===group).map(documentCard).join('')}</div></section>`).join('')}`;

    const panels={overview,contract,experience,benefits,'important-documents':importantDocuments};
    const inputs=TABS.map(([key],i)=>`<input type="radio" name="ep-tab" id="ep-tab-${e(key)}" class="ep-tab-input"${i?'':' checked'}>`).join('');
    // أزرار الاختيار تبقى إخوةً للقائمة واللوحات (محدِّدات style.css تقوم على ذلك)، فيُسمّى أصلها بـaria-owns من قائمة التسميات
    // نفسها: «أقسام الملف» مجموعةٌ فيها الأقسام الخمسة. وكل لوحة منطقة تحمل اسم تسميتها، فيُعرف القسم المفتوح باسمه.
    const tabs=`<div class="ep-tablist" role="radiogroup" aria-label="${e(tr('أقسام الملف','Profile sections'))}" aria-owns="${TABS.map(([key])=>`ep-tab-${e(key)}`).join(' ')}">${TABS.map(([key,label])=>`<label for="ep-tab-${e(key)}" id="ep-tab-label-${e(key)}" class="ep-tab">${e(tr(label,label))}</label>`).join('')}</div>`;
    const bodies=TABS.map(([key])=>`<div class="ep-panel" id="ep-panel-${e(key)}" role="region" aria-labelledby="ep-tab-label-${e(key)}">${panels[key]}</div>`).join('');

    // رأس الملف: الاسم والمسمى والوسوم، ثم ما يحتاج انتباهًا، ثم الفعل وتاريخ آخر تحديث، وسطر الخصوصية مرجعًا في آخره.
    // معرّف الحساب لاتيني فيُعزل اتجاهه بين الوسوم العربية.
    const chips=[e(data.person.department??''),data.person.id?`<bdi>${e(data.person.id)}</bdi>`:'',...data.flags.map(f=>e(f.name))].filter(Boolean);
    const updated=data.personal_updated_at;
    const head=`<section class="panel panel-body ep-head">
      <div class="ep-identity"><span class="ep-avatar" aria-hidden="true">${e(data.person.initials)}</span>
        <div><h2>${e(data.person.name)}</h2><p>${e(data.person.job_title||tr('ما فيه مسمى وظيفي مسجَّل','No job title recorded'))}</p>
        <p class="vn-chips">${chips.map(c=>`<span>${c}</span>`).join('')}</p></div></div>
      ${data.flags.map(f=>`<p class="vn-alert"><strong>${e(f.name)}</strong> — ${e(f.detail)}${f.reason_withheld?` · ${tr('سبب الإعفاء ما يطلع لك','The exemption reason is not shown to you')}`:''}</p>`).join('')}
      ${data.can.edit_personal?`<div class="operation-actions">${button('save_personal',data.person.id,tr('تعديل البيانات الشخصية','Edit personal details'))}</div>`:''}
      ${['self','hr'].includes(data.scope)
        ?`<p class="subtle">${tr('آخر تحديث للبيانات الشخصية','Personal details last updated')}: ${updated?`<time datetime="${e(updated)}">${e(date(updated))}</time>`:e(tr('ما انسجّلت للحين','Not recorded yet'))}</p>`
        :''}
      <p class="subtle measure">${e(data.privacy_note)}</p></section>`;

    return `${head}<section class="ep-tabs">${inputs}${tabs}${bodies}</section>`;
  },
  form(action,id,data){
    if(action!=='save_personal'||!data.can.edit_personal)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');
    const current=key=>data.tabs.overview.personal.find(f=>f.key===key);
    const valueOf=key=>current(key)?.value??'';
    const options=names=>Object.entries(names).map(([value,label])=>({value,label}));
    return {title:`البيانات الشخصية — ${data.person.name}`,endpoint:`/employee-profile/${id}/personal`,
      fields:[
        {name:'birth_date',label:'تاريخ الميلاد',type:'date',required:false,value:valueOf('birth_date'),hint:'من وثيقة رسمية. العمر ينحسب منه، وما ينكتب.'},
        {name:'marital_status',label:'الحالة الاجتماعية',type:'select',required:false,options:[{value:'',label:'غير مسجَّلة'},...options(data.marital_statuses)],value:valueOf('marital_status')},
        {name:'education_level',label:'المستوى التعليمي',type:'select',required:false,options:[{value:'',label:'غير مسجَّل'},...options(data.education_levels)],value:data.tabs.overview.work.find(f=>f.key==='education_level')?.value??''},
        {name:'education_field',label:'التخصص',type:'text',required:false,maxLength:120,value:data.tabs.overview.work.find(f=>f.key==='education_field')?.value??'',hint:'اسم التخصص بس، بدون أرقام وثائق.'},
        {name:'prior_experience_months',label:'الخبرة السابقة بالأشهر',type:'number',required:false,value:data.tabs.experience.find(f=>f.key==='prior')?.value??'',hint:'صفر يعني «ما عنده خبرة سابقة». خلّه فاضي إذا ما تعرفها.'},
        {name:'source',label:'الوثيقة اللي اطّلعت عليها',type:'text',maxLength:200,hint:'نوع الوثيقة بس، مثل «الهوية الوطنية» أو «شهادة البكالوريوس» — رقمها ما ينقبل.'}
      ],
      toPayload:v=>({version:data.personal_version,
        ...(v.birth_date?{birth_date:v.birth_date}:{}),
        marital_status:v.marital_status||'',education_level:v.education_level||'',education_field:v.education_field||'',
        prior_experience_months:v.prior_experience_months===''||v.prior_experience_months===undefined?null:Number(v.prior_experience_months),
        source:v.source})};
  }
};
