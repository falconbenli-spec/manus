// حماية الأجور: مواصفة الملف وفحوص ما قبل التصدير · المطابقة الثلاثية للأجر · كشف شذوذ المسير.
// ثلاث شاشات تصرّح بحدودها: لا اتصال بأي جهة، ولا رفع آلي، ولا تصحيح آلي، والفحوص الاستشارية لا تمنع أحدًا.
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const levelClass={blocking:'is-late',warn:'is-due',info:'is-ok',attention:'is-due'};
const levelName={blocking:'يمنع التصدير',warn:'تنبيه',info:'معلومة',attention:'يستحق النظر'};
// المبلغ معزول الاتجاه بأرقام جدولية (.ltr)، والتاريخ والشهر بوسم time، والعدد في جملة بـdata-num.
const amountOf=(e,money,minor)=>`<span class="ltr">${e(money(minor))}</span>`;
const dateTag=(e,iso)=>iso?`<time datetime="${e(String(iso).slice(0,10))}">${e(String(iso).slice(0,10))}</time>`:'—';
const monthTag=(e,m)=>m?`<time datetime="${e(m)}">${e(m)}</time>`:'—';
const count=(e,n)=>`<span data-num>${e(n)}</span>`;
// نص مختلط (اسم صيغة، ترميز): كل مقطع لاتيني فيه معزول بـbdi فلا تقلبه الجملة العربية، والعربي حوله يبقى في اتجاهه.
const mixed=(e,text)=>String(text??'').split(/([A-Za-z][\w.\-]*(?:\s+[A-Za-z0-9][\w.\-]*)*)/).map((part,i)=>i%2?`<bdi>${e(part)}</bdi>`:e(part)).join('');

function checkList(items,e){
  // الأسماء العشرة الأولى، وما بعدها يقال عدده ولا يُبتر بنقاط.
  return items.map(c=>`<li${levelClass[c.level]?` class="${levelClass[c.level]}"`:''}><strong>${e(levelName[c.level]??c.level)} · ${e(c.title)}</strong>${c.detail?`<span>${e(c.detail)}</span>`:''}${c.employees?.length?`<small>${e(c.employees.map(x=>x.name).slice(0,10).join('، '))}${c.employees.length>10?` و${count(e,c.employees.length-10)} غيرهم`:''}</small>`:''}</li>`).join('');
}

const fileActions={confirm_format:'تأكيد المواصفة',reject_format:'رفض المواصفة',retire_format:'تقاعد المواصفة',withdraw_format:'سحب المسودة',record_upload:'توثيق الرفع اليدوي'};
export const wpsUI={
  title:'ملف حماية الأجور',
  description:'ملف الأجور ينبني من مواصفة تنتقل من حساب المنشأة لدى الجهة مثل ما هي، وينفحص قبل التصدير عشان ما ينرفض بعد الرفع. والرفع نفسه يدوي في حساب المنشأة.',
  load:api=>api('/wps'),
  render(data,{e,button,money,ui}){
    const prepare=data.permissions.includes('payroll.prepare');
    const amount=minor=>amountOf(e,money,minor);
    const nameOf=(list,key)=>(list??[]).find(x=>x.key===key)?.name??key;
    // أفعال الصف ورابط تنزيله في منطقة أفعال واحدة، ولا يُرسم زر لا تعرف الشاشة اسمه.
    const acts=(row,key,extra='')=>{const buttons=row.actions.filter(a=>fileActions[a]).map(a=>button(a,`${key}:${row.id}`,fileActions[a])).join('');return buttons||extra?`<div class="operation-actions">${extra}${buttons}</div>`:'';};
    // أعمدة المواصفة خلف تفصيل يسمّي ما يخفيه وعدده، وفي جدول: الترتيب واسم العمود ومصدره من المنصة بالعربي.
    const columns=f=>f.columns.length?`<details><summary>أعمدة الملف (${count(e,f.columns.length)})</summary>${ui.table({head:['الترتيب','اسم العمود','المصدر من المنصة','إلزامي'],rows:f.columns.map(c=>`<tr><td>${e(c.position)}</td><td><bdi>${e(c.name)}</bdi></td><td>${e(nameOf(data.source_fields,c.source))}</td><td>${c.required?'نعم':'لا'}</td></tr>`)})}</details>`:'';
    const formats=data.formats.map(f=>`<li><strong>${mixed(e,f.format_label)} · ${e(f.bank_name)} · نسخة ${count(e,f.revision)}</strong><span>${e(f.status_name)} · ${count(e,f.columns.length)} عمود · ${f.layout==='fixed'?'أطوال ثابتة':`فاصل «<bdi>${e(f.delimiter)}</bdi>»`} · ${mixed(e,nameOf(data.encodings,f.encoding))}</span><small>أدخلها ${e(f.recorded_by_name)} · مصدر المواصفة: ${e(f.spec_source)} · تاريخ تأكيدها لدى الجهة ${dateTag(e,f.spec_confirmed_on)}${f.confirmed_by_name?` · طابقها ${e(f.confirmed_by_name)}`:''}</small>${columns(f)}${acts(f,'format')}</li>`).join('');
    const runs=data.runs.map(r=>{const checks=[...r.blocking,...r.warnings,...r.info];
      return `<li class="${r.can_export?'is-ok':'is-late'}"><strong>مسير ${monthTag(e,r.month)} المعتمد · ${amount(r.net_minor)} · ${count(e,r.headcount)} موظف</strong><span>${r.can_export?`الملف جاهز: ${count(e,r.rows)} سطر بمجموع ${amount(r.file_total_minor)}`:`${count(e,r.blocking.length)} مانع قبل التصدير`}${r.warnings.length?` · ${count(e,r.warnings.length)} تنبيه`:''}</span>${checks.length?`<ul class="vn-list">${checkList(checks,e)}</ul>`:''}${r.actions.length?`<div class="operation-actions">${r.actions.map(a=>button(a,r.id,'تصدير ملف الأجور')).join('')}</div>`:''}</li>`;}).join('');
    const exports=data.exports.map(x=>`<li><strong>${monthTag(e,x.month)} · ${count(e,x.headcount)} سطر · ${amount(x.total_minor)}</strong><span>${e(x.bank_name)} — ${mixed(e,x.format_label)} (نسخة ${count(e,x.revision)}) · صدّره ${e(x.exported_by_name)}${x.warning_count?` · ${count(e,x.warning_count)} تنبيه وقت التصدير`:''}</span><small>${x.uploaded_on?`انرفع يدويًا في ${dateTag(e,x.uploaded_on)} · مرجع <bdi>${e(x.upload_reference)}</bdi> · وثّقه ${e(x.upload_recorded_by_name)}`:x.run_status==='reversed'?'مسيره انعكس قبل صرفه، فهالملف ما يُرفع — يتصدّر ملف المسير المصحَّح من تحويله.':x.actions.length||!x.run_status||x.run_status==='approved'?'ما انوثّق رفعه للحين — الرفع يدوي في حساب المنشأة مرة وحدة للمسير، ويوثّقه بعدها شخص ثاني هنا.':''}</small>${acts(x,'export',`<a class="btn outline small" href="/api/wps/exports/${e(x.id)}/file" download>تنزيل الملف</a>`)}</li>`).join('');
    // ما تُفتح الشاشة لأجله أولًا: المسيرات الجاهزة للتصدير وما يمنعها، ثم ما صُدّر وينتظر توثيق رفعه، ثم المواصفات (إعداد).
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p><div class="operation-actions">${prepare?button('record_format','','إدخال مواصفة ملف'):''}</div></section>
      ${data.active_format_id?'':'<div class="vn-alert is-due"><strong>ما فيه مواصفة ملف مؤكدة للحين.</strong><p>ما ينبني ملف بلا تعريف: أدخل الأعمدة وأطوالها وترتيبها والفاصل والترميز مثل ما هي في حساب المنشأة لدى الجهة، وبعدها يأكّدها شخص ثاني.</p></div>'}
      <div class="vn-board">
        <section class="vn-block"><h2>المسيرات المعتمدة وفحوص ما قبل التصدير</h2>${runs?`<ul class="vn-list">${runs}</ul>`:'<p class="subtle">ما فيه مسير معتمد للحين — الملف ينبني بعد اعتماد مسير الشهر.</p>'}</section>
        <section class="vn-block"><h2>الملفات المصدَّرة</h2>${exports?`<ul class="vn-list">${exports}</ul>`:'<p class="subtle">ما انصدّر ملف للحين.</p>'}</section>
        <section class="vn-block"><h2>مواصفات الملف</h2>${formats?`<ul class="vn-list">${formats}</ul>`:'<p class="subtle">ما فيه مواصفة مدخلة للحين — يدخلها مُعد الرواتب من زر «إدخال مواصفة ملف».</p>'}</section>
      </div><p class="subtle">${e(data.limits)}</p>`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    if(action==='record_format'){
      guard(data.permissions.includes('payroll.prepare'));
      return {title:'مواصفة ملف الأجور كما هي لدى الجهة',endpoint:'/wps/formats',idempotent:true,fields:[
        field('bank_name','البنك أو الجهة المستقبِلة'),
        field('format_label','اسم الصيغة وإصدارها كما تسميه الجهة'),
        field('layout','شكل الملف','select',{options:data.layouts.map(l=>({value:l.key,label:l.name}))}),
        field('delimiter','الفاصل (يُترك فاضي للأطوال الثابتة)','text',{required:false,value:','}),
        field('encoding','الترميز','select',{options:data.encodings.map(x=>({value:x.key,label:x.name})),hint:'الملف يطلع بترميز UTF-8 بس، وإذا طلبت الجهة غيره فالتحويل يصير برّا.'}),
        field('line_ending','نهاية السطر','select',{options:data.line_endings.map(x=>({value:x.key,label:x.name}))}),
        field('include_header','الملف يبدأ بسطر عناوين','select',{options:[{value:'no',label:'لا'},{value:'yes',label:'نعم'}]}),
        field('spec_source','من وين انأخذت المواصفة حرفيًا','textarea',{hint:'اسم الشاشة أو المستند في حساب المنشأة لدى الجهة، وتاريخ قراءتها. المواصفة تنتقل مثل ما هي.'}),
        field('spec_confirmed_on','تاريخ تأكيد المواصفة لدى الجهة','date',{value:data.today}),
        field('columns','أعمدة الملف بترتيبها','rows',{minRows:1,maxRows:60,hint:'المصدر من القائمة. اللي مو فيها خلّه فاضي أو اكتب له قيمة ثابتة.',columns:[
          {name:'position',label:'الترتيب',type:'number',min:1,max:60},
          {name:'name',label:'اسم العمود'},
          {name:'source',label:'المصدر من المنصة',type:'select',options:data.source_fields.map(f=>({value:f.key,label:f.name}))},
          {name:'type',label:'النوع',type:'select',options:[...new Set(data.source_fields.map(f=>f.type))].map(t=>({value:t,label:t}))},
          {name:'length',label:'الطول',type:'number',min:1,max:200,required:false},
          {name:'required',label:'إلزامي',type:'select',options:[{value:'no',label:'لا'},{value:'yes',label:'نعم'}]},
          {name:'pad',label:'التعبئة',type:'select',options:data.pads.map(p=>({value:p.key,label:p.name}))},
          {name:'pad_char',label:'حرف التعبئة',type:'select',options:data.pad_chars.map(p=>({value:p.key,label:p.name}))},
          {name:'value',label:'القيمة الثابتة',required:false}
        ]})
      ],toPayload:v=>({bank_name:v.bank_name,format_label:v.format_label,layout:v.layout,delimiter:v.layout==='fixed'?'':v.delimiter,encoding:v.encoding,line_ending:v.line_ending,
        include_header:v.include_header==='yes',spec_source:v.spec_source,spec_confirmed_on:v.spec_confirmed_on,
        columns:v.columns.map(c=>({name:c.name,position:c.position,length:c.length===null||c.length===''?null:c.length,type:c.type,source:c.source,required:c.required==='yes',value:c.value??'',pad:c.pad,pad_char:c.pad_char}))})};
    }
    if(action==='export_wage_file'){
      const run=data.runs.find(r=>r.id===id);guard(run&&run.actions.includes('export_wage_file'));
      return {title:`تصدير ملف الأجور — ${run.month}`,endpoint:'/wps/exports',idempotent:true,fields:[],toPayload:()=>({run_id:id})};
    }
    const [kind,rowId]=String(id).split(':');
    if(kind==='format'){
      const row=data.formats.find(f=>f.id===rowId);guard(row&&row.actions.includes(action));
      const decision={confirm_format:'confirm',reject_format:'reject',retire_format:'retire',withdraw_format:'withdraw'}[action];
      const labels={confirm:'وش اللي طابقته مع حساب المنشأة لدى الجهة',reject:'سبب الرفض',retire:'سبب التقاعد',withdraw:'سبب السحب'};
      return {title:`${row.format_label} — ${row.bank_name}`,endpoint:`/wps/formats/${rowId}/${decision}`,fields:[field('note',labels[decision],'textarea')],toPayload:v=>({...v,version:row.version})};
    }
    const row=data.exports.find(x=>x.id===rowId);guard(row&&row.actions.includes(action));
    return {title:`توثيق الرفع اليدوي — ${row.month}`,endpoint:`/wps/exports/${rowId}/record_upload`,fields:[
      field('uploaded_on','تاريخ الرفع','date',{value:data.today}),
      field('reference','مرجع الرفع لدى الجهة أو البنك'),
      field('note','وش اللي انرفع ووين ووش نتيجته الظاهرة','textarea',{hint:'الرفع ورد الجهة يصيرون في حساب المنشأة؛ هنا تقرّ وش صار.'})
    ],toPayload:v=>({...v,version:row.version})};
  }
};

export const wageReconciliationUI={
  title:'مطابقة الأجر الثلاثية',
  description:'تقارن أجر العقد بالأجر المسجّل في التأمينات وبأجر المسير، وتطلّع الفرق بمقداره. الرقم المسجّل ينكتب يدوي من حساب المنشأة، وأي فرق ينحسم بقرار مكتوب.',
  load:api=>api('/wage-reconciliation'),
  render(data,{e,button,money,ui}){
    const amount=value=>value===null?'—':amountOf(e,money,value);
    // حال كل موظف بكلمتها بجوار لونها: متطابق، أو فرق بمقداره، أو ما سُجّل له أجر، أو مطابقة ناقصة.
    const stateText=r=>r.state==='matched'?'متطابق':r.state==='different'?`فرق ${amount(r.largest_difference_minor)}`:r.state==='missing_registration'?'ما فيه أجر مسجّل لدى الجهة':r.state==='incomplete'?'مطابقة ناقصة':e(r.state);
    const rows=data.rows.map(r=>`<li class="${r.state==='different'?'is-late':r.state==='matched'?'is-ok':'is-due'}"><strong>${e(r.employee_name)} · ${stateText(r)}</strong>
      <span>العقد ${amount(r.contract_wage_minor)} · المسجّل لدى الجهة ${amount(r.registered_wage_minor)} · المسير ${amount(r.payroll_wage_minor)}${r.in_run&&r.paid_fraction_bp!==null&&r.paid_fraction_bp<10000?` · مصروف هالشهر ${amount(r.payroll_paid_minor)} (<span class="ltr">${e((r.paid_fraction_bp/100).toFixed(2))}%</span> من الشهر)`:''}</span>
      <small>${r.registration?`سجّله ${e(r.registration.recorded_by_name)} بتاريخ تسجيل ${dateTag(e,r.registration.registered_on)} · المصدر: ${e(r.registration.source_note)}`:'ما انسجّل أجر هالموظف لدى الجهة للحين.'}</small>
      ${r.notes.length?`<small>${e(r.notes.map(n=>`${n.resolution_name}: ${n.note} — ${n.recorded_by_name}`).join(' · '))}</small>`:''}
      ${r.actions.length?`<div class="operation-actions">${r.actions.map(a=>button(a,r.user_id,{record_registration:'تسجيل الأجر لدى الجهة',record_difference:'قرار في الفرق'}[a])).join('')}</div>`:''}</li>`).join('');
    const history=data.registration_history.map(h=>`<li${h.superseded?' class="is-old"':''}><strong>${e(h.employee_name)} · ${amount(h.registered_wage_minor)}</strong><span>تاريخ التسجيل لدى الجهة ${dateTag(e,h.registered_on)} · أدخله ${e(h.recorded_by_name)}${h.superseded?' · حل محله إدخال أحدث':''}</span><small>${e(h.source_note)}</small></li>`).join('');
    const t=data.totals;
    // البلاطة تُلوَّن حين يقع ما تعدّه فعلًا؛ الصفر بلا لون.
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p><span class="badge">${monthTag(e,data.month)}</span></section>
      <div class="vn-tiles">${ui.tile(t.people,'موظف في المطابقة')}${ui.tile(t.matched,'أرقامه الثلاثة متطابقة',t.matched?'is-ok':'')}${ui.tile(t.different,'فرق يحتاج قرار',t.different?'is-late':'')}${ui.tile(t.missing_registration,'بلا أجر مسجّل لدى الجهة',t.missing_registration?'is-due':'')}</div>
      <div class="vn-board">
        <section class="vn-block"><h2>المطابقة — الأكبر فرقًا أول</h2>${rows?`<ul class="vn-list">${rows}</ul>`:ui.empty('ما فيه موظف على رأس العمل هالشهر','المطابقة تطلع أول ما يكون فيه عقد ساري في الشهر.')}</section>
        <section class="vn-block"><h2>سجل أرقام الجهة المدخلة</h2>${history?`<ul class="vn-list">${history}</ul>`:'<p class="subtle">ما انكتب رقم من أرقام الجهة للحين.</p>'}</section>
      </div><p class="subtle">${e(data.rule)}</p>`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    const row=data.rows.find(r=>r.user_id===id);guard(row&&row.actions.includes(action));
    if(action==='record_registration')return {title:`الأجر المسجّل لدى الجهة — ${row.employee_name}`,endpoint:'/wage-reconciliation/registrations',idempotent:true,fields:[
      field('amount','الأجر المسجّل لدى الجهة'),
      field('registered_on','تاريخ التسجيل لدى الجهة','date',{value:data.today}),
      field('source_note','من وين قريت الرقم في حساب المنشأة','textarea',{hint:'إدخال يدوي: انقل الرقم مثل ما هو في حساب المنشأة.'})
    ],toPayload:v=>({...v,user_id:id})};
    return {title:`قرار في الفرق — ${row.employee_name}`,endpoint:'/wage-reconciliation/notes',idempotent:true,fields:[
      field('resolution','وش قرارك','select',{options:data.resolutions.map(r=>({value:r.key,label:r.name}))}),
      field('note','القرار وسنده','textarea',{hint:`العقد ${(row.contract_wage_minor??0)/100} · المسجّل ${(row.registered_wage_minor??0)/100} · المسير ${(row.payroll_wage_minor??0)/100}. اكتب قرارك وسنده.`})
    ],toPayload:v=>({...v,user_id:id,month:data.month})};
  }
};

export const payrollAnomalyUI={
  title:'كشف شذوذ المسير',
  description:'فحوص ثابتة بقواعد وعتبات تحددها الموارد البشرية، تطلع للمراجع والمعتمد قبل قرارهم. تنبّه بس: ما تمنع الاعتماد ولا تغيّر رقم في المسير.',
  load:api=>api('/payroll-anomaly'),
  render(data,{e,button,money,ui}){
    const settings=data.settings;
    const statusWords={draft:'مسودة',in_review:'قيد المراجعة',reviewed:'روجِع — بانتظار الاعتماد',approved:'معتمد ومقفل'};
    // مستوى النتيجة يُقال بكلمته لقارئ الشاشة بجوار لونها؛ وأهم فحص احتيال يُقال ظاهرًا.
    const findings=run=>run.findings.map(f=>`<li class="${f.critical?'is-late':levelClass[f.level]??''}"><strong>${f.critical?'أهم فحص احتيال · ':levelName[f.level]?`<span class="sr-only">${e(levelName[f.level])}: </span>`:''}${e(f.title)}</strong>${f.detail?`<span>${e(f.detail)}</span>`:''}${f.employees?.length?`<small>${e(f.employees.map(x=>x.name).join('، '))}</small>`:''}</li>`).join('');
    const runs=data.runs.map(r=>`<section class="vn-block"><h3>مسير ${monthTag(e,r.month)} · ${e(statusWords[r.status]??r.status)}</h3>
      <p class="subtle">${r.compared_with?`المقارنة مع مسير ${monthTag(e,r.compared_with)} المعتمد`:'ما فيه مسير معتمد قبله للمقارنة'} · ${count(e,r.counts.attention)} نتيجة تستحق النظر</p>
      ${r.findings.length?`<ul class="vn-list">${findings(r)}</ul>`:'<p class="subtle">ما طلعت نتيجة في هالمسير بالقواعد والعتبات الحالية.</p>'}</section>`).join('');
    const pct=bp=>`<span class="ltr">${e((bp/100).toFixed(2))}%</span>`;
    // العتبات السارية مرجعٌ بسندها بعد النتائج؛ وغيابها تنبيهٌ فوق، لأن الفحص بلا عتبة لا يعمل.
    const thresholds=settings?`<section class="vn-block"><h2>العتبات السارية</h2><dl class="vn-facts">
      <div><dt>فرق الشهر</dt><dd>${settings.variance_bp!==null?pct(settings.variance_bp):'غير محددة'}${settings.variance_amount_minor!==null?` أو ${amountOf(e,money,settings.variance_amount_minor)}`:''}</dd></div>
      <div><dt>نسبة الخصم</dt><dd>${settings.deduction_ratio_bp!==null?pct(settings.deduction_ratio_bp):'غير محددة'}</dd></div>
      <div><dt>معامل العمل الإضافي</dt><dd>${settings.overtime_factor_bp!==null?`<span class="ltr">${e((settings.overtime_factor_bp/10000).toFixed(2))}</span>`:'غير محدد'}</dd></div></dl>
      <p class="subtle">السند: ${e(settings.basis)}</p></section>`:'';
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p><div class="operation-actions">${data.can_set_thresholds?button('set_thresholds','',settings?'تعديل العتبات':'تحديد العتبات'):''}</div></section>
      ${settings?'':`<div class="vn-alert is-due"><strong>ما فيه عتبات محددة.</strong><p>${e(data.threshold_note)}</p></div>`}
      <section class="vn-board"><h2>نتائج الفحص حسب المسير</h2>${runs||ui.empty('ما فيه مسير مفتوح ولا معتمد للحين','الفحص يشتغل أول ما ينعدّ مسير شهر.')}</section>${thresholds}<p class="subtle">${e(data.rule)}</p>`;
  },
  form(action,id,data){
    const guard=ok=>{if(!ok)throw Error('الإجراء مو متاح لك الحين. حدّث الصفحة وشوف حالته.');};
    guard(action==='set_thresholds'&&data.can_set_thresholds);
    const s=data.settings;
    return {title:'عتبات كشف الشذوذ',endpoint:'/payroll-anomaly/thresholds',fields:[
      field('variance_bp','نسبة الفرق عن الشهر السابق بنقاط الأساس (500 = 5%)','number',{required:false,min:1,max:100000,value:s?.variance_bp??''}),
      field('variance_amount','أو مبلغ الفرق بالريال','text',{required:false,value:s?.variance_amount_minor!==null&&s?.variance_amount_minor!==undefined?(s.variance_amount_minor/100).toFixed(2):''}),
      field('deduction_ratio_bp','حد نسبة الخصم من الإجمالي بنقاط الأساس (3000 = 30%)','number',{required:false,min:1,max:10000,value:s?.deduction_ratio_bp??''}),
      field('overtime_factor_bp','معامل العمل الإضافي مقارنة بأعلى شهر سابق (20000 = ضعفان)','number',{required:false,min:10000,max:1000000,value:s?.overtime_factor_bp??''}),
      field('basis','سند العتبات ومن قررها','textarea',{value:s?.basis??'',hint:'ما فيه نسبة ولا مبلغ افتراضي: الفحص بلا عتبة ما يشتغل ويقول كذا.'})
    ],toPayload:v=>({version:s?.version,variance_bp:v.variance_bp===''||v.variance_bp===undefined?null:Number(v.variance_bp),
      variance_amount:v.variance_amount===undefined?null:v.variance_amount,
      deduction_ratio_bp:v.deduction_ratio_bp===''||v.deduction_ratio_bp===undefined?null:Number(v.deduction_ratio_bp),
      overtime_factor_bp:v.overtime_factor_bp===''||v.overtime_factor_bp===undefined?null:Number(v.overtime_factor_bp),basis:v.basis})};
  }
};
