// السجل الوظيفي: ملف الموظف ووثائقه بانتهائها وتغييراته المؤرخة. الموظف يرى ملفه، والمدير فريقه، والموارد البشرية الجميع.
import { countNoun } from './arabic-count.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
// حالة الخدمة في الملف الوظيفي قاموس هذه الشاشة، لا حالات الطلبات الثماني في vocabulary.mjs.
const typeNames={full_time:'دوام كامل',part_time:'دوام جزئي',contract:'تعاقد',intern:'متدرب'},employmentStates={active:'على رأس العمل',on_notice:'في فترة إشعار',left:'غادر'};
const docNames={national_id:'هوية وطنية',iqama:'إقامة',work_permit:'رخصة عمل',passport:'جواز سفر',contract:'عقد',qualification:'مؤهل',medical_insurance:'تأمين طبي',other:'أخرى'};
const changeNames={job_title:'المسمى الوظيفي',department:'الإدارة',manager:'المدير المباشر',employment_type:'نوع التعاقد',status:'الحالة',contract_end:'نهاية العقد'};
const EMPLOYEES=['موظف واحد','موظفَين','موظفين','موظفًا'];
const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/;
// اليوم بنصه كما يُخزَّن وقيمته الآلية في datetime؛ والعدد بأرقام مجدولة، ومع اسمه بصيغته الصحيحة.
const day=(e,iso)=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
const num=(e,n)=>`<span data-num>${e(n)}</span>`;
const counted=(e,n,forms)=>e(countNoun(n,forms)).replace(/^-?\d[\d,.]*/,m=>num(e,m));
const CHANGES=['تغيير واحد','تغييران','تغييرات','تغييرًا'];
// يوم الرياض من طابع الخادم (ISO بتوقيت UTC): «انربط في …» يُقرأ بيوم من يقرؤه في الرياض لا بيوم UTC.
const riyadhDay=iso=>iso?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso)):null;
// حال التغيير المؤرخ (الترحيل 172): الكلمة من الخادم (state_name)، والشكل صنف نبرة من طبقة الحالة. ينتظر الاعتماد وحلّ تاريخه
// ولم يسرِ يستحقان الانتباه؛ المجدول جارٍ، وما سرى صامت، والملغى خامل.
const changeTones={awaiting_approval:'awaiting',scheduled:'scheduled',due:'due_soon',applied:'approved',cancelled:'cancelled'};
const OPEN_CHANGES=['awaiting_approval','due','scheduled'];
const changeVerbs={approve_change:'اعتماد تغيير',cancel_change:'إلغاء تغيير'};
// قيمة التغيير كما تُقرأ: النوع والحالة بكلمتيهما، والإدارة والمدير باسميهما حين يُعرفان (وإلا المعرّف معزولًا)، ونهاية العقد تاريخًا.
// names خريطتان من بيانات الشاشة نفسها (الدليل وصفوف الموظفين)، فلا نداء خادم ولا اسم مخترع.
const namesOf=data=>({department:new Map((data.directory?.departments??[]).map(x=>[x.id,x.name])),
  manager:new Map([...(data.directory?.rows??[]).map(x=>[x.id,x.name]),...data.rows.map(r=>[r.user.id,r.user.name])])});
const changeText=(type,value,names)=>{
  if(value===''||value===null||value===undefined)return {manager:'بلا مدير مباشر',contract_end:'بلا تاريخ نهاية'}[type]??'—';
  if(type==='employment_type')return typeNames[value]??value;
  if(type==='status')return employmentStates[value]??value;
  if(type==='department'||type==='manager')return names[type].get(value)??value;
  return value;
};
const changeHtml=(e,type,value,names)=>{
  if(value===''||value===null||value===undefined)return e(changeText(type,value,names));
  if(type==='contract_end')return day(e,value);
  if((type==='department'||type==='manager')&&!names[type].has(value))return `<bdi>${e(value)}</bdi>`;
  return `«${e(changeText(type,value,names))}»`;
};
export const employeesUI={
  title:'السجل الوظيفي',description:'ملف كل موظف ووثائقه وتغييراته الوظيفية بتاريخ سريانها. أرقام الهوية والإقامة ما تنحفظ كاملة.',
  // الدليل بأعمدة المرجع يأتي من مسار مستقل (app/employee-profile.mjs) لا من /employees: فصلُ القراءتين يُبقي
  // السجل الوظيفي كما هو، ويضع حراسة الجنس والجنسية في الوحدة التي تملكها وحدها.
  load:async api=>{const [record,directory]=await Promise.all([api('/employees'),api('/employee-directory')]);return {...record,directory};},
  render(data,{e,button,ui}){
    const people=data.scope==='people';
    const tile=ui.tile; // العدّة نفسها باسم أقصر داخل هذه الشاشة؛ الترميز الناتج هو ترميزها بالحرف.
    const d=data.directory,seesDemographics=!!d.genders;
    // الجدول المرجعي: صفٌّ لكل موظف، واسمه رابط يفتح ملفه الموحّد. المرشّحات والعدّاد يعملون معًا بلا سطر برمجي في الصفحة
    // (data-filter في app.mjs): مرشّح الإدارة ومرشّح الجنس والبحث النصي يتقاطعون، والعدّاد يتبعهم.
    // العمود الأول معرّف الحساب باسمه: المنصة لا تُصدر رقمًا وظيفيًا، والملف نفسه يقول عن «الرقم الوظيفي» إنه غير متاح.
    // تسمية العمود بالاسم الذي لا يوجد كانت تعطي القارئ جوابين متناقضين عن الخانة نفسها بنقرة واحدة من الصف إلى الملف.
    const head=['معرّف الحساب','الاسم','المسمى الوظيفي','الإدارة',...(seesDemographics?['الجنس','الجنسية']:[]),'المستوى التعليمي','بداية العقد','نهاية العقد','إجمالي الخبرة'];
    // «غير مسجَّل» باهت بكلمته، والتاريخ في <time>.
    const cell=value=>`<td>${value==='غير مسجَّل'?`<span class="subtle">${e(value)}</span>`:ISO_DAY.test(String(value??''))?day(e,value):e(value)}</td>`;
    // نص المرشّح لا يحمل عمودًا محجوبًا: العمود المحجوب يخرج null من الخادم، فلا يدخل «غير مسجَّل» عن شيء لم يُسأل عنه.
    // والحساب الموقوف يقول حاله بكلمة بجانب الاسم، لا بالبهتان وحده. ورابط الاسم يمدّ هدفه إلى 44px (hit-area) والصف أطول منه فلا تداخل.
    const rows=d.rows.map(r=>`<tr data-filter-text="${e([r.name,r.id,r.job_title,r.department,r.gender_name,r.nationality_name,r.education_name].filter(Boolean).join(' '))}" data-department="${e(r.department_id||'')}" data-gender="${e(r.gender||'')}" class="${r.active?'':'is-inactive'}">
      <td><code>${e(r.id)}</code></td>
      <td><a class="hit-area" href="#employee-profile/${e(encodeURIComponent(r.id))}"><strong>${e(r.name)}</strong></a>${r.active?'':' <span class="badge suspended">موقوف</span>'}</td>
      ${cell(r.job_title)}<td><span class="badge">${e(r.department)}</span></td>
      ${seesDemographics?cell(r.gender_name)+cell(r.nationality_name):''}
      ${cell(r.education_name)}${cell(r.contract_start??'غير مسجَّل')}${cell(r.contract_end_text)}${cell(r.total_experience_text)}</tr>`);
    const picker=(label,key,options)=>`<label class="emp-filter"><span>${e(label)}</span><select data-filter="#employee-directory" data-filter-key="${e(key)}"><option value="">${e('الكل')}</option>${options.map(o=>`<option value="${e(o.value)}">${e(o.label)}</option>`).join('')}</select></label>`;
    const filters=`<div class="emp-filters">
      <label class="emp-filter"><span>دوّر في الدليل</span><input type="search" data-filter="#employee-directory" placeholder="بالاسم أو المعرّف أو المسمى" autocomplete="off"></label>
      ${picker('الإدارة','department',d.departments.map(x=>({value:x.id,label:x.name})))}
      ${seesDemographics?picker('الجنس','gender',Object.entries(d.genders).map(([value,label])=>({value,label}))):''}
      <p class="emp-count" role="status" aria-live="polite">الظاهر <strong data-filter-count="#employee-directory" data-num>${e(d.rows.length)}</strong> من ${counted(e,d.rows.length,EMPLOYEES)}</p></div>`;
    // عمود محجوب يُقال بسببه ومالكه؛ وأكثر من عمود قائمةٌ واحدة لا أسطر متتالية.
    const withheldLine=c=>`<strong>${e(c.column)}</strong> ما يطلع لك: ${e(c.why)} — عند ${e(c.owner)}`;
    const withheld=d.withheld_columns.length>1
      ?`<div class="vn-alert"><strong>أعمدة ما تطلع لك</strong><ul>${d.withheld_columns.map(c=>`<li>${withheldLine(c)}</li>`).join('')}</ul></div>`
      :d.withheld_columns.map(c=>`<p class="vn-alert">${withheldLine(c)}</p>`).join('');
    const unrecorded=[['gender','بلا جنس مسجَّل'],['nationality','بلا جنسية مسجَّلة'],['education','بلا مستوى تعليمي مسجَّل'],['prior_experience','بلا إجمالي خبرة محسوب']]
      .filter(([k])=>Number.isInteger(d.unrecorded[k])&&d.unrecorded[k]>0).map(([k,label])=>`<span>${num(e,d.unrecorded[k])} ${e(label)}</span>`).join('');
    // بلا صفوف لا تُرسم ترويسة فوق فراغ ولا مرشّحات على لا شيء: تُقال الحالة بجملة، كما تفعل ui.table.
    const directory=`<section class="vn-group"><h2>دليل الموظفين <span data-num>${e(d.rows.length)}</span></h2>
      <p class="subtle">${e(d.note)}</p>${withheld}
      ${d.rows.length?`${filters}<div class="table-wrap"><table id="employee-directory"><thead><tr>${head.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
        :ui.empty('ما فيه موظف ضمن نطاقك في هالدليل','الدليل كامل يشوفه صاحب تصريح السجل الوظيفي، والمدير يشوف فريقه المباشر.')}
      ${unrecorded?`<p class="vn-chips">${unrecorded}</p>`:''}</section>`;
    // أسماء الإدارات والأشخاص من بيانات الشاشة نفسها، لتُقرأ قيم التغيير المؤرخ بأسمائها لا بمعرّفاتها.
    const names=namesOf(data);
    // التغيير المؤرخ صفٌّ: ما تغيّر ومن أي قيمة إلى أي قيمة، وحاله بكلمته وشكله، وتاريخ سريانه، ثم سببه وأفعاله. من سجّله ومن اعتمده
    // يبقيان على المفتوح وحده لأن اعتماده بيد غير مسجّله (فصل المهام)؛ وما سرى أو انلغى يُقرأ مادةً وسندًا.
    const changeItem=c=>{
      const open=OPEN_CHANGES.includes(c.state),what=changeNames[c.change_type]??c.change_type;
      const hands=open?[`سجّله ${e(c.created_by_name)}`,c.approved_by?(c.two_person===false?'واعتمده معدّه لأنه ما فيه زميل ثاني':`واعتمده ${e(c.approved_by_name)}`):''].filter(Boolean).join(' '):'';
      // سطرٌ يقول لماذا لا زرّ أو ماذا يلزم الزر: سجّله القارئ نفسه وفي الكيان زميل يعتمده، أو اعتماده منه يحتاج سببًا مكتوبًا، أو حلّ تاريخه ولم يسرِ.
      const why=people&&c.state==='awaiting_approval'&&!c.actions.includes('approve_change')?'يعتمده زميل ثاني يحمل «السجل الوظيفي»، غير اللي سجّله وغير صاحب الملف.'
        :c.needs_reason?'ما فيه زميل ثاني يحمل «السجل الوظيفي»، فاعتمادك له يحتاج سبب مكتوب من 20 حرف أو أكثر.'
        :c.state==='due'?`حلّ تاريخه وما سرى للحين: يسري في التشغيل اليومي${people?'، أو الحين من «تطبيق التغييرات المستحقة الحين»':''}.`:'';
      const acts=c.actions.filter(a=>changeVerbs[a]).map(a=>button(a,c.id,`${changeVerbs[a]} ${what}`)).join('');
      return `<li${c.state==='awaiting_approval'||c.state==='due'?' class="is-due"':''}><strong>${e(what)}: ${changeHtml(e,c.change_type,c.from_value,names)} إلى ${changeHtml(e,c.change_type,c.to_value,names)}</strong><span class="badge ${changeTones[c.state]??''}">${e(c.state_name)}</span>
        <span>يسري من ${day(e,c.effective_from)}${hands?` · ${hands}`:''}</span><small>${e(c.reason)}</small>${open&&c.self_approval_reason?`<small>سبب اعتماده بيد معدّه: ${e(c.self_approval_reason)}</small>`:''}${why?`<small>${e(why)}</small>`:''}${acts?`<div class="operation-actions">${acts}</div>`:''}</li>`;
    };
    // المفتوح أولًا (ما ينتظر اعتمادًا، ثم ما حلّ تاريخه، ثم المجدول)، وما سرى أو انلغى مطويٌّ بعدده.
    const changesBlock=r=>{
      const list=r.changes??[],open=list.filter(c=>OPEN_CHANGES.includes(c.state)).sort((a,b)=>OPEN_CHANGES.indexOf(a.state)-OPEN_CHANGES.indexOf(b.state)),settled=list.filter(c=>!OPEN_CHANGES.includes(c.state));
      return `${open.length?`<div><strong>تغييرات وظيفية مفتوحة <span data-num>${e(open.length)}</span></strong><ul class="vn-list">${open.map(changeItem).join('')}</ul></div>`:''}${settled.length?`<details><summary>تغييرات سرت أو انلغت (${num(e,settled.length)})</summary><ul class="vn-list">${settled.map(changeItem).join('')}</ul></details>`:''}`;
    };
    // من أين جاء الموظف (الترحيل 172): مرشحٌ قَبِل العرض، ثم حسابه، ثم عقده. يصل لمن يعمل على السجل الوظيفي وحده.
    const hireBlock=r=>r.hire?`<p>جاء من التوظيف: انربط حسابه بملف ترشيحه في ${day(e,riyadhDay(r.hire.linked_at))}، ${r.hire.contract_id?`وعقده في ${day(e,riyadhDay(r.hire.contract_linked_at))}`:'وعقده ما انربط للحين — يربطه موظف خدمات الموظف من «التوظيف والتهيئة» بعد ما يُعتمد'}.</p>`:'';
    // بطاقة الموظف (رأسٌ يُقرأ مطويًّا بأعلامه وحالته، وجسمٌ بالوثائق والحقائق والتغييرات والأفعال) — ليست نسخة من ui.card التي لا أعلام في رأسها.
    // الوثيقة المنتهية حمراء والقريبة صفراء، وكلتاهما بكلمتها. والتغييرات علَمان: ما ينتظر اعتمادًا (انتباه) وما اعتُمد وينتظر تاريخه.
    const employeeCard=r=>{
      const expired=r.attention.some(a=>a.days_left<0),awaiting=r.awaiting_approval??0,scheduled=(r.pending_changes??0)-awaiting;
      return `<details class="vn-card"><summary><span class="vn-code"><bdi>${e(r.user.department_id||'—')}</bdi></span><span class="vn-name"><strong>${e(r.user.name)}</strong><small>${r.profile?[e(r.profile.job_title),e(typeNames[r.profile.employment_type]??''),r.profile.join_date?`باشر ${day(e,r.profile.join_date)}`:''].filter(Boolean).join(' · '):'ما له ملف وظيفي للحين'}</small></span><span class="vn-flags">${r.attention.length?`<span class="vn-flag ${expired?'is-late':'is-due'}">${expired?'وثائق منتهية أو قريبة':'وثائق تنتهي قريب'}: ${num(e,r.attention.length)}</span>`:''}${awaiting?`<span class="vn-flag is-due">تنتظر اعتماد: ${num(e,awaiting)}</span>`:''}${scheduled>0?`<span class="vn-flag">تغييرات مجدولة: ${num(e,scheduled)}</span>`:''}<span class="badge ${e(r.user.active?'approved':'suspended')}">${e(r.profile?employmentStates[r.profile.status]:r.user.active?'نشط':'موقوف')}</span></span></summary>
      <div class="vn-body">${r.attention.length?`<div class="vn-alert ${expired?'is-block':'is-due'}"><strong>وثائق تنتهي قريب أو انتهت</strong><ul>${r.attention.map(a=>`<li>${e(docNames[a.doc_type]||a.doc_type)} — ${day(e,a.expires_on)} (${a.days_left<0?'انتهت':`باقي ${counted(e,a.days_left,'day')}`})</li>`).join('')}</ul></div>`:''}
      ${r.profile?`<dl class="vn-facts"><div><dt>المسمى</dt><dd>${e(r.profile.job_title)}</dd></div><div><dt>نوع التعاقد</dt><dd>${e(typeNames[r.profile.employment_type])}</dd></div><div><dt>المباشرة</dt><dd>${day(e,r.profile.join_date)}</dd></div><div><dt>نهاية العقد</dt><dd>${day(e,r.profile.contract_end)}</dd></div></dl>`:'<p class="subtle">الموارد البشرية ما أنشأت له ملف وظيفي للحين.</p>'}
      ${hireBlock(r)}${changesBlock(r)}
      <div class="operation-actions">${people?button('save_profile',r.user.id,r.profile?'تحديث الملف':'إنشاء الملف'):''}${button('add_document',r.user.id,'إضافة وثيقة')}${people&&r.profile?button('record_change',r.user.id,'تغيير وظيفي مؤرخ'):''}${r.hire?`<a class="btn outline small" href="#people?focus=${e(encodeURIComponent(r.hire.candidate_id))}">فتح ملف التوظيف</a>`:''}</div></div></details>`;
    };
    // اللون للحالة القائمة وحدها: صفر بلا لون، والمنتهي أحمر، والقريب وحده أصفر. وما ينتظر اعتمادًا أصفر لمن يعتمده وحده.
    const anyExpired=data.rows.some(r=>r.attention.some(a=>a.days_left<0));
    const awaitingTotal=data.awaiting_approval??0,scheduledTotal=data.rows.reduce((n,r)=>n+(r.pending_changes??0),0)-awaitingTotal;
    // ما اعتُمد وحلّ تاريخه ولم يسرِ: يسري في التشغيل اليومي، ولمن يعمل على السجل أن يطبّقه الحين بطلب صريح (فتح الشاشة لا يطبّق شيئًا).
    const due=data.rows.flatMap(r=>(r.changes??[]).filter(c=>c.state==='due'));
    return `<section class="panel panel-body vn-head"><p>${people?'تشوف كل الموظفين لأنك من الموارد البشرية.':'تشوف ملفك وملفات فريقك المباشر.'} التغيير الوظيفي يسري من تاريخه بعد ما يعتمده زميل ثاني، مو من لحظة تسجيله.</p>${people&&due.length?`<p>تغييرات معتمدة حلّ تاريخها وما سرت للحين: ${num(e,due.length)}. تسري في التشغيل اليومي، أو الحين من الزر.</p><div class="operation-actions">${button('apply_due','','تطبيق التغييرات المستحقة الحين')}</div>`:''}</section>
      <section class="vn-board"><div class="vn-tiles">${tile(data.rows.length,'ملف ضمن نطاقك')}${tile(data.missing_profiles,'حساب نشط بلا ملف وظيفي',data.missing_profiles?'is-due':'')}${tile(data.expiring,'وثيقة تنتهي خلال 60 يومًا أو انتهت',data.expiring?(anyExpired?'is-late':'is-due'):'')}${tile(data.expiring_documents?.length??0,'تنبيه وثائق')}${tile(awaitingTotal,'تغيير وظيفي ينتظر اعتماد',people&&awaitingTotal?'is-due':'')}${tile(scheduledTotal,'تغيير معتمد ينتظر تاريخه')}</div></section>
      ${directory}
      <section class="vn-group"><h2>الموظفون <span data-num>${e(data.rows.length)}</span></h2>${data.rows.length?data.rows.map(employeeCard).join(''):'<p class="subtle">ما فيه ملفات ضمن نطاقك.</p>'}</section>`;
  },
  form(action,id,data){
    // تطبيق ما اعتُمد وحلّ تاريخه الحين، بطلب صريح ممن يعمل على السجل الوظيفي. الجواب عدد ما سرى، يُقال مرة بعد الحفظ.
    if(action==='apply_due'){guard(data.scope==='people');return {title:'تطبيق التغييرات المستحقة الحين',endpoint:'/employee-changes/apply-due',fields:[],toPayload:()=>({}),
      after:(saved,e)=>({title:'تطبيق التغييرات المستحقة',html:saved?.applied?`<p>سرى الحين: ${counted(e,saved.applied,CHANGES)}.</p>`
        :'<p>ما سرى شي: اللي حلّ تاريخه إما سرى قبل شوي، أو ينتظر إدارة مؤرشفة أو ملف وظيفي ما انشأ للحين.</p>'})};}
    // اعتماد التغيير المؤرخ وإلغاؤه بمعرّف التغيير نفسه. ما يُقرَّر يُقرأ في النموذج: ما تغيّر وإلى أي قيمة ومتى وسببه المسجّل.
    if(action==='approve_change'||action==='cancel_change'){
      const c=data.rows.flatMap(x=>x.changes??[]).find(x=>x.id===id);guard(c&&c.actions.includes(action));
      const names=namesOf(data),what=changeNames[c.change_type]??c.change_type,owner=data.rows.find(x=>x.user.id===c.user_id)?.user.name??'';
      const quoted=value=>value===''||value===null||value===undefined?changeText(c.change_type,value,names):`«${changeText(c.change_type,value,names)}»`;
      const summary=`${what}: من ${quoted(c.from_value)} إلى ${quoted(c.to_value)}، يسري من ${c.effective_from}. السبب المسجّل: ${c.reason}`;
      if(action==='cancel_change')return {title:`إلغاء تغيير ${what} — ${owner}`,endpoint:`/employee-changes/${c.id}/cancel`,fields:[field('reason','سبب الإلغاء','textarea',{maxLength:1000,hint:summary})],toPayload:v=>({reason:v.reason})};
      // من سجّل التغيير لا يعتمده ما دام في الكيان زميل يحمل «السجل الوظيفي»؛ وبلا زميل يعتمده هو بسبب مكتوب (20 حرفًا فأكثر) يُحفظ معه.
      return {title:`اعتماد تغيير ${what} — ${owner}`,endpoint:`/employee-changes/${c.id}/approve`,
        fields:c.needs_reason?[field('self_approval_reason','سبب الاعتماد بيد معدّه','textarea',{maxLength:1000,hint:`20 حرف أو أكثر: ليش تعتمد تغيير سجّلته بنفسك. ${summary}`})]
          :[field('note','ملاحظة الاعتماد','textarea',{required:false,maxLength:1000,hint:summary})],
        toPayload:v=>c.needs_reason?{self_approval_reason:v.self_approval_reason}:v.note?{note:v.note}:{}};
    }
    const r=data.rows.find(x=>x.user.id===id);guard(r);
    const options=(list,names)=>list.map(k=>({value:k,label:names[k]||k}));
    // بعد إنشاء الملف لا يتعدّل منه مباشرة إلا تاريخ المباشرة: المسمى ونوع التعاقد والحالة ونهاية العقد والإدارة والمدير لكلٍّ «تغيير وظيفي مؤرخ»
    // بتاريخ سريانه وسببه يعتمده زميل ثاني (والخادم يرفض غيره بـdated_field). قيمها تُقرأ في سطر لا أداة فيه، ولا تُرسل.
    if(action==='save_profile'&&r.profile){
      const names=namesOf(data),dated=[['job_title',r.profile.job_title],['employment_type',r.profile.employment_type],['status',r.profile.status],['contract_end',r.profile.contract_end],['department',r.user.department_id],['manager',r.user.manager_id]]
        .map(([type,value])=>`${changeNames[type]}: ${changeText(type,value,names)}`).join(' · ');
      return {title:`الملف الوظيفي — ${r.user.name}`,endpoint:`/employees/${id}/profile`,
        fields:[field('dated','يتغير بـ«تغيير وظيفي مؤرخ»','hidden',{required:false,value:'',hint:`${dated}. كل واحد منها ينسجّل من «تغيير وظيفي مؤرخ» في بطاقة الموظف بتاريخ سريانه وسببه، ويعتمده زميل ثاني.`}),
          field('join_date','تاريخ المباشرة','date',{value:r.profile.join_date})],
        toPayload:v=>({join_date:v.join_date,version:r.profile.version})};
    }
    if(action==='save_profile')return {title:`الملف الوظيفي — ${r.user.name}`,endpoint:`/employees/${id}/profile`,fields:[field('job_title','المسمى الوظيفي','text',{value:r.profile?.job_title}),field('employment_type','نوع التعاقد','select',{options:options(data.employment_types,typeNames),value:r.profile?.employment_type}),field('join_date','تاريخ المباشرة','date',{value:r.profile?.join_date}),field('contract_end','نهاية العقد','date',{required:false,value:r.profile?.contract_end??''}),field('status','الحالة','select',{options:options(data.statuses,employmentStates),value:r.profile?.status??'active'})],toPayload:v=>({job_title:v.job_title,employment_type:v.employment_type,join_date:v.join_date,...(v.contract_end?{contract_end:v.contract_end}:{}),status:v.status,...(r.profile?{version:r.profile.version}:{})})};
    if(action==='add_document')return {title:`وثيقة — ${r.user.name}`,endpoint:`/employees/${id}/documents`,idempotent:true,fields:[field('doc_type','نوع الوثيقة','select',{options:options(data.document_types,docNames)}),field('reference','مرجع مختصر','text',{maxLength:40,hint:'تسمية مو رقم كامل، مثل «آخر 4 أرقام 1234».'}),field('issued_on','تاريخ الإصدار','date',{required:false}),field('expires_on','تاريخ الانتهاء','date'),field('note','ملاحظة','textarea',{required:false})],toPayload:v=>({doc_type:v.doc_type,reference:v.reference,...(v.issued_on?{issued_on:v.issued_on}:{}),expires_on:v.expires_on,...(v.note?{note:v.note}:{})})};
    if(action==='record_change')return {title:`تغيير وظيفي — ${r.user.name}`,endpoint:`/employees/${id}/changes`,idempotent:true,fields:[field('change_type','نوع التغيير','select',{options:options(data.change_types,changeNames)}),field('to_value','القيمة الجديدة','text',{hint:'للإدارة أو المدير اكتب المعرّف؛ وللحالة: active أو on_notice أو left.'}),field('effective_from','يسري من','date'),field('reason','السبب والسند','textarea')],toPayload:v=>v};
    guard(false);
  }
};
