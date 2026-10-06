// أوراق العمل الضريبية: ورقة القيمة المضافة وورقة وعاء الزكاة وسجل ضريبة الاستقطاع.
// كل شاشة تقول ما ليست عليه: ورقة عمل للمراجعة لا إقرارًا، ولا اتصال بأي جهة، ولا نسبة من عند المنصة.
import { dual } from './dates.mjs';
// البلاطة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');};
const riyal=minor=>minor===null||minor===undefined?'—':`${(minor/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} SAR`;
const amountField=(name,label,value,{signed=false,hint=''}={})=>field(name,label,'number',{step:'0.01',...(signed?{}:{min:'0'}),value,hint});
const LABELS={save_worksheet:'تعديل الأرقام',review_worksheet:'مراجعة وإقفال',record_filing:'توثيق التقديم',revise_worksheet:'نسخة جديدة',confirm_rate:'تأكيد النسبة',
  record_remittance:'توثيق التوريد',cancel_entry:'إلغاء السجل',save_zakat_lines:'بنود الورقة',review_zakat:'اعتماد الورقة',revise_zakat:'نسخة جديدة'};

// النسبة المؤرّخة قيمةٌ وسندها: نسبتها وسريانها ومصدرها وتأكيد المختص. اسم من أدخلها يُقال ما دامت تنتظر تأكيد غيره.
function rateList(data,e,button){
  if(!data.rate_settings.length)return '<p class="subtle measure">ما فيه نسب مسجّلة. المنصة ما تحمل نسبة ضريبية من عندها: اكتب النسبة بمصدرها وتاريخ تأكيدها ومين أكدها، ويأكدها شخص ثاني قبل ما تنستعمل.</p>';
  return `<ul class="vn-list">${data.rate_settings.map(s=>{const yours=s.actions.length>0;
    return `<li class="${yours?'is-decision':s.confirmed_by?'':'is-pending'}"><strong>${e(s.label)} · <bdi dir="ltr">${e(s.percent)}%</bdi></strong><span class="badge ${yours?'is-decision':s.confirmed_by?'confirmed':'pending'}">${e(yours?'ينتظر تأكيدك':s.state)}</span>
    <span>سارية من <time datetime="${e(s.effective_from)}">${e(dual(s.effective_from))}</time>${s.confirmed_by?'':` · أدخلها ${e(s.recorded_by_name)}، ويأكدها غيره`}</span>
    <small class="measure">المصدر: ${e(s.source)} — أكده ${e(s.specialist_name)} في <time datetime="${e(s.confirmed_on)}">${e(s.confirmed_on)}</time></small>
    ${s.actions.length?`<div class="operation-actions">${s.actions.map(a=>button(a,s.id,LABELS[a])).join('')}</div>`:''}</li>`;}).join('')}</ul>`;
}
function worksheetDetail(w,e){
  const line=l=>`<li class="${l.difference_minor?'is-due':''}"><strong>${e(l.label)}</strong><span>الورقة: <bdi dir="ltr">${e(riyal(l.worksheet_minor))}</bdi> · الدفتر: <bdi dir="ltr">${e(l.ledger_minor===null?'—':riyal(l.ledger_minor))}</bdi> · الفرق: <bdi dir="ltr">${e(l.difference_minor===null?'—':riyal(l.difference_minor))}</bdi></span>${l.note?`<small>${e(l.note)}</small>`:''}</li>`;
  return `<div class="vn-alert"><strong>${e(w.disclaimer)}</strong></div>
    <p class="subtle">الفترة ${e(dual(w.period_start))} لين ${e(dual(w.period_end))} · النسخة ${e(w.revision)} · ${e(w.status_name)} · أعدّها ${e(w.prepared_by_name)}${w.reviewed_by_name?` · راجعها ${e(w.reviewed_by_name)}`:''}${w.filed_by_name?` · وثّق تقديمها ${e(w.filed_by_name)} بمرجع ${e(w.filing_reference)}`:''}</p>
    <ul class="vn-list">${w.reconciliation.map(line).join('')}</ul>
    <div class="vn-alert ${w.variance_minor?'is-due':'is-ok'}"><strong>بند التسوية: فرق الورقة عن الدفتر <bdi dir="ltr">${e(riyal(w.variance_minor))}</bdi></strong>
      <p>${e(w.reconciliation_note||(w.variance_minor?'الفرق ما انفسّر للحين، والورقة ما تنقفل لين ينفسّر.':'ما فيه فرق عن الدفتر.'))}</p></div>
    ${w.adjustments_note?`<section class="vn-block"><h3>أساس التعديلات</h3><p>${e(w.adjustments_note)}</p></section>`:''}
    <section class="vn-block"><h3>نسبة الفترة</h3><p>${e(w.rate_note)}${w.rate?` — <bdi dir="ltr">${e(w.rate.percent)}%</bdi> سارية من ${e(w.rate.effective_from)} أكدها ${e(w.rate.specialist_name)} بتاريخ ${e(w.rate.confirmed_on)}.`:''}${w.expected_output_vat_minor===null?'':` مقارنة للمراجعة بس: ضريبة مخرجات متوقعة <bdi dir="ltr">${e(riyal(w.expected_output_vat_minor))}</bdi>.`}</p>
      ${w.rate?`<small class="subtle">المصدر: ${e(w.rate.source)}</small>`:''}</section>
    <section class="vn-block"><h3>الدفتر في هالفترة</h3><p class="subtle">فواتير صادرة: ${e(w.ledger.issued_invoices)} · ضريبة مدخلات متحقق منها: ${w.ledger.input_vat_available?`<bdi dir="ltr">${e(riyal(w.ledger.input_vat_minor))}</bdi>`:'ما تحقق أحد من أي فاتورة مورد ضريبية للحين — ما فيه رقم، ومو صفر'}</p></section>
    ${w.review_note?`<section class="vn-block"><h3>اللي راجعه المراجع</h3><p>${e(w.review_note)}</p></section>`:''}
    ${w.filing_evidence?`<section class="vn-block"><h3>دليل التقديم</h3><p>${e(w.filing_evidence)}</p><p class="subtle">المنصة ما قدّمت شي وما اتصلت بأي جهة؛ هذا توثيق لشي صار برّاها.</p></section>`:''}
    <div class="form-actions"><a class="btn outline" href="/api/tax-returns/vat/${e(w.id)}/export.csv" download>تصدير CSV</a><button class="btn dark" type="button" data-action="close">إغلاق</button></div>`;
}

export const vatWorksheetUI={
  title:'ورقة عمل الإقرار الضريبي',
  description:'ورقة عمل للمراجعة، وليست إقرارًا: تحط أرقام الدفتر جنب أرقام مُعِدّها عشان يطلع الفرق وينفسّر. ما تقدّم إقرار ولا تتصل بأي جهة، وما تحمل نسبة ضريبية من عندها.',
  load:api=>api('/tax-returns/vat'),
  render(data,{e,button,ui=kit(e)}){
    // المبلغ رقمٌ معزول الاتجاه، والعملة بعده مرة؛ والفرق بإشارته داخل العزل وبكلمته.
    const sar=minor=>`<span class="ltr">${e(riyal(minor).replace(/ SAR$/,''))}</span>`;
    const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
    const open=data.worksheets.filter(w=>w.status==='draft'||w.status==='reviewed');
    // الورقة: إن كان فيها فرق ما انفسّر فهو ما يُقرَّر عليه ويتقدّم، وإلا فصافيها. ثم حالها ومن عليه الخطوة.
    const worksheet=w=>{const unexplained=w.variance_minor&&!w.variance_explained,yours=w.actions.length>0;
      return `<li class="${yours?'is-decision':w.status==='superseded'?'is-old':unexplained?'is-late':w.status==='draft'?'is-pending':''}">
      <strong>من ${day(w.period_start)} لين ${day(w.period_end)} — ${unexplained?`فرق ما انفسّر ${sar(w.variance_minor)} ريال`:`الصافي ${sar(w.figures.net)} ريال`}</strong><span class="badge ${yours?'is-decision':w.status==='filed'?'filed':w.status==='reviewed'?'reviewed':w.status==='superseded'?'superseded':'draft'}">${e(yours?'ينتظرك':w.status_name)}</span>
      <span>النسخة <span data-num>${e(w.revision)}</span> · ${yours?`${e(w.status_name)} · `:''}الصافي ${sar(w.figures.net)} · فرق عن الدفتر ${sar(w.variance_minor)}${unexplained?' (ما انفسّر)':''}${w.status==='draft'?` · أعدّها ${e(w.prepared_by_name)}`:''}</span>
      <div class="operation-actions">${button('open_worksheet',w.id,'فتح الورقة')}${w.actions.map(a=>button(a,w.id,LABELS[a])).join('')}</div></li>`;};
    const pending=data.pending_input_vat;
    const pendingList=pending.rows.map(r=>`<li class="is-pending"><strong>فاتورة <bdi dir="ltr">${e(r.supplier_invoice_number)}</bdi> · <bdi dir="ltr">${e(r.supplier_key)}</bdi> — ضريبة ${sar(r.vat_minor)} ريال</strong><span>بتاريخ ${day(r.invoice_date)} · تنتظر تحقق شخص ثاني في «مدفوعات الموردين»</span></li>`).join('');
    const zakat=data.zakat_worksheets.map(z=>{const yours=z.actions.length>0;
      return `<li class="${yours?'is-decision':z.status==='superseded'?'is-old':z.status==='draft'?'is-pending':''}"><strong>وعاء الزكاة <span data-num>${e(z.fiscal_year)}</span> · النسخة <span data-num>${e(z.revision)}</span></strong><span class="badge ${yours?'is-decision':z.status==='reviewed'?'reviewed':z.status==='superseded'?'superseded':'draft'}">${e(yours?'ينتظرك':z.status_name)}</span>
      <span><span data-num>${e(z.line_count)}</span> بند${z.empty_lines?` · <span data-num>${e(z.empty_lines)}</span> بدون مبلغ`:''} · المختص ${e(z.specialist_name)}${z.status==='draft'?` · أعدّها ${e(z.prepared_by_name)}`:''}</span>
      <small class="measure">${e(z.note)}</small>
      ${z.lines.length?`<small>${z.lines.map(l=>`${e(l.label)}: ${l.amount_minor===null?'—':sar(l.amount_minor)}`).join(' · ')}</small>`:''}
      ${z.actions.length?`<div class="operation-actions">${z.actions.map(a=>button(a,z.id,LABELS[a])).join('')}</div>`:''}</li>`;}).join('');
    const confirmed=data.rate_settings.filter(s=>s.confirmed_by).length;
    const block=(title,hint,body)=>`<section class="vn-block"><div class="panel-head"><h2>${title}</h2>${hint?`<p>${hint}</p>`:''}</div>${body}</section>`;
    const waiting=data.worksheets.filter(w=>w.actions.length),rest=data.worksheets.filter(w=>!w.actions.length);
    return `<section class="panel panel-body vn-head">${data.can_prepare?`<div class="operation-actions">${button('create_worksheet','','ورقة فترة جديدة')}${button('record_rate','','تسجيل نسبة مؤرّخة')}${button('name_boxes','','تسمية خانات التصدير')}${button('create_zakat','','ورقة وعاء زكاة')}</div>`:''}<div class="vn-alert"><strong>${e(data.disclaimer)}</strong></div><p>${e(data.note)}</p></section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(open.length,'ورقة مفتوحة',open.length?'is-due':'')}${ui.tile(pending.count,'مدخلات تنتظر التحقق',pending.count?'is-due':'')}${ui.tile(confirmed,'نسبة مؤكدة',confirmed?'':'is-due')}${ui.tile(data.worksheets.filter(w=>w.status==='filed').length,'موثّق تقديمها')}${ui.tile(data.worksheets.length,'ورقة عمل')}</div></section>
      ${waiting.length?block(`ينتظرك <span data-num>(${waiting.length})</span>`,'',`<ul class="vn-list">${waiting.map(worksheet).join('')}</ul>`):''}
      ${block('أوراق ضريبة القيمة المضافة','',rest.length?`<ul class="vn-list">${rest.map(worksheet).join('')}</ul>`:`<p class="subtle">${data.worksheets.length?'ما فيه أوراق غير اللي تنتظرك.':'ما فيه أوراق. ابدأ بفترة ضريبية تعرف بدايتها ونهايتها.'}</p>`)}
      ${block(`مدخلات تنتظر التحقق${pending.window?` · من ${day(pending.window.from)} لين ${day(pending.window.to)}`:''}`,`${e(pending.note)} أثرها لو تحققت: ${sar(pending.vat_minor)} ريال.`,pendingList?`<ul class="vn-list">${pendingList}</ul>`:'<p class="subtle">ما فيه مدخلات معلّقة في هالفترة.</p>')}
      ${block('النسب المؤرّخة لضريبة القيمة المضافة','',rateList(data,e,button))}
      ${block('ورقة وعاء الزكاة','هيكل فاضي ببنود يسمّيها المختص ويملأها ويعتمدها. المنصة ما تحسب وعاء ولا تفترض بند ولا تجمع البنود.',zakat?`<ul class="vn-list">${zakat}</ul>`:'<p class="subtle">ما فيه أوراق زكاة — تبدأ من «ورقة وعاء زكاة».</p>')}`;
  },
  form(action,id,data){
    const w=data.worksheets.find(x=>x.id===id),z=data.zakat_worksheets.find(x=>x.id===id),s=data.rate_settings.find(x=>x.id===id);
    if(action==='create_worksheet'){guard(data.can_prepare);return {title:'ورقة عمل لفترة ضريبية',endpoint:'/tax-returns/vat',idempotent:true,
      fields:[field('period_start','بداية الفترة','date'),field('period_end','نهاية الفترة','date')],
      toPayload:v=>({period_start:v.period_start,period_end:v.period_end})};}
    if(action==='record_rate'){guard(data.can_prepare);return {title:'نسبة ضريبة قيمة مضافة مؤرّخة',endpoint:'/tax-returns/rates',idempotent:true,
      fields:[field('category','التصنيف الضريبي','select',{options:Object.entries(data.categories).map(([value,label])=>({value,label}))}),
        field('label','اسم التصنيف زي ما تسميه'),
        field('percent','النسبة المئوية','number',{step:'0.01',min:'0',max:'100',hint:'المنصة ما تعرف أي نسبة وما تقترح وحدة. اكتب اللي أكده المختص لهالفترة.'}),
        field('effective_from','سارية من','date',{hint:'النسبة تبقى مؤرّخة، فتنطبق نسبة الفترة مو نسبة اليوم.'}),
        field('source','مصدر النسبة مكتوبًا','textarea',{hint:'الوثيقة أو الخطاب أو صفحة الجهة زي ما اطلعت عليها.'}),
        field('specialist_name','المختص الضريبي اللي أكدها'),field('confirmed_on','تاريخ تأكيده','date')],
      toPayload:v=>({kind:'vat',category:v.category,label:v.label,percent:v.percent,effective_from:v.effective_from,source:v.source,specialist_name:v.specialist_name,confirmed_on:v.confirmed_on})};}
    if(action==='confirm_rate'){guard(s&&s.actions.includes('confirm_rate'));return {title:`تأكيد نسبة — ${s.label}`,endpoint:`/tax-returns/rates/${id}/confirm`,
      fields:[field('note','وش طابقت في المصدر','textarea')],toPayload:v=>({version:s.version,note:v.note})};}
    if(action==='name_boxes'){guard(data.can_prepare);return {title:'تسمية خانات التصدير',endpoint:'/tax-returns/vat/boxes',
      fields:[{name:'boxes',label:'الخانات',type:'rows',hint:'المنصة ما تفترض ترقيم خانات أي نموذج رسمي؛ تعيين البنود على الخانات مسؤوليتك ومسؤولية المختص الضريبي.',
        value:data.lines.map(l=>({line_key:l.key,box_label:data.export_boxes[l.key]??''})),
        columns:[{name:'line_key',label:'البند',type:'select',options:data.lines.map(l=>({value:l.key,label:l.label}))},{name:'box_label',label:'اسم الخانة في النموذج',required:false}]}],
      toPayload:v=>({boxes:v.boxes})};}
    if(action==='create_zakat'){guard(data.can_prepare);return {title:'ورقة وعاء زكاة',endpoint:'/tax-returns/zakat',idempotent:true,
      fields:[field('fiscal_year','السنة المالية','number',{min:'2000',max:'2999',step:'1'}),field('specialist_name','المختص اللي يسمّي البنود'),
        field('basis_note','مرجع البنود ومين أقرّها','textarea',{hint:'المنصة ما تحسب وعاء وما تفترض بنود؛ تحفظ اللي يسمّيه المختص ويعتمده.'})],
      toPayload:v=>({fiscal_year:String(v.fiscal_year),specialist_name:v.specialist_name,basis_note:v.basis_note})};}
    if(action==='open_worksheet')return {title:'ورقة عمل ضريبة القيمة المضافة',endpoint:`/tax-returns/vat/${id}/open`,fields:[],toPayload:()=>({}),
      after:(saved,e)=>({title:`ورقة ${saved.period_start} → ${saved.period_end}`,html:worksheetDetail(saved,e)})};
    if(action==='save_worksheet'){guard(w&&w.actions.includes('save_worksheet'));
      return {title:`أرقام الورقة — ${w.period_start} → ${w.period_end}`,endpoint:`/tax-returns/vat/${id}`,
        fields:[amountField('sales_standard','المبيعات الخاضعة بالنسبة الأساسية',(w.figures.sales_standard/100).toFixed(2)),
          amountField('output_vat','ضريبة المخرجات',(w.figures.output_vat/100).toFixed(2)),
          amountField('sales_zero_rated','المبيعات بنسبة الصفر',(w.figures.sales_zero_rated/100).toFixed(2)),
          amountField('sales_exempt','المبيعات المعفاة',(w.figures.sales_exempt/100).toFixed(2)),
          amountField('sales_out_of_scope','مبيعات خارج نطاق الضريبة',(w.figures.sales_out_of_scope/100).toFixed(2)),
          amountField('purchases','المشتريات ذات المدخلات المتحقق منها',(w.figures.purchases/100).toFixed(2)),
          amountField('input_vat','ضريبة المدخلات المتحقق منها',(w.figures.input_vat/100).toFixed(2),{hint:'المدخلات اللي ما تحقق منها أحد ما تدخل الورقة؛ تنتظر التحقق في شاشة مدفوعات الموردين.'}),
          amountField('adjustments','التعديلات',(w.figures.adjustments/100).toFixed(2),{signed:true,hint:'السالب مقبول، وأي تعديل يحتاج أساس مكتوب.'}),
          field('adjustments_note','أساس التعديلات','textarea',{required:false,value:w.adjustments_note}),
          field('reconciliation_note','بند التسوية: تفسير الفرق عن الدفتر','textarea',{required:false,value:w.reconciliation_note,hint:'الفرق يطلع وما ينخفى، والورقة ما تنقفل والفرق ما انفسّر.'})],
        toPayload:v=>({version:w.version,sales_standard:v.sales_standard,output_vat:v.output_vat,sales_zero_rated:v.sales_zero_rated,sales_exempt:v.sales_exempt,sales_out_of_scope:v.sales_out_of_scope,purchases:v.purchases,input_vat:v.input_vat,adjustments:v.adjustments,adjustments_note:v.adjustments_note||'',reconciliation_note:v.reconciliation_note||''})};}
    if(action==='review_worksheet'){guard(w&&w.actions.includes('review_worksheet'));return {title:'مراجعة وإقفال الورقة',endpoint:`/tax-returns/vat/${id}/review_worksheet`,
      fields:[field('note','وش راجعت','textarea',{hint:'المراجعة مو تقديم؛ الورقة تبقى ورقة عمل لين يأكدها المختص الضريبي.'})],toPayload:v=>({version:w.version,note:v.note})};}
    if(action==='record_filing'){guard(w&&w.actions.includes('record_filing'));return {title:'توثيق التقديم',endpoint:`/tax-returns/vat/${id}/record_filing`,
      fields:[field('filing_reference','مرجع التقديم عند الجهة'),field('filing_evidence','مين قدّمه ومتى ووين انحفظ الإيصال','textarea',{hint:'المنصة ما تقدّم شي وما تتصل بأي جهة؛ هذا توثيق لشي صار برّاها.'})],
      toPayload:v=>({version:w.version,filing_reference:v.filing_reference,filing_evidence:v.filing_evidence})};}
    if(action==='revise_worksheet'){guard(w&&w.actions.includes('revise_worksheet'));return {title:'نسخة جديدة من الورقة',endpoint:`/tax-returns/vat/${id}/revise_worksheet`,idempotent:true,
      fields:[field('note','سبب النسخة الجديدة','textarea',{hint:'النسخة المقدَّمة ما تتعدل؛ تبقى محفوظة، وتحل محلها نسخة جديدة إذا توثّق تقديمها.'})],toPayload:v=>({version:w.version,note:v.note})};}
    if(action==='save_zakat_lines'){guard(z&&z.actions.includes('save_zakat_lines'));return {title:`بنود وعاء الزكاة — ${z.fiscal_year}`,endpoint:`/tax-returns/zakat/${id}/lines`,
      fields:[{name:'lines',label:'بنود الوعاء',type:'rows',minRows:1,maxRows:60,hint:'المنصة ما تقترح بند وما تحسب مجموع؛ المختص يسمّي البنود ويعبّي مبالغها ومصادرها.',
        value:z.lines.map(l=>({label:l.label,amount:l.amount_minor===null?'':(l.amount_minor/100).toFixed(2),source_note:l.source_note})),
        columns:[{name:'label',label:'البند'},{name:'amount',label:'المبلغ (اتركه فاضي لين يحدده المختص)',type:'number',required:false},{name:'source_note',label:'المصدر',required:false}]}],
      toPayload:v=>({version:z.version,lines:v.lines.map(r=>({label:r.label,amount:r.amount===null||r.amount===undefined?'':String(r.amount),source_note:r.source_note||''}))})};}
    if(action==='review_zakat'){guard(z&&z.actions.includes('review_zakat'));return {title:`اعتماد ورقة وعاء الزكاة — ${z.fiscal_year}`,endpoint:`/tax-returns/zakat/${id}/review_zakat`,
      fields:[field('note','وش اعتمدت','textarea')],toPayload:v=>({version:z.version,note:v.note})};}
    if(action==='revise_zakat'){guard(z&&z.actions.includes('revise_zakat'));return {title:'نسخة جديدة من ورقة الزكاة',endpoint:`/tax-returns/zakat/${id}/revise_zakat`,idempotent:true,
      fields:[field('note','سبب النسخة الجديدة','textarea')],toPayload:v=>({version:z.version,note:v.note})};}
    throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');
  }
};

export const withholdingUI={
  title:'سجل ضريبة الاستقطاع',
  description:'سجل المدفوعات لغير المقيمين ونسبة استقطاعها المؤرّخة وموعد توريدها ودليله. نوع الخدمة والنسبة وأثر الاتفاقيات يحددها المختص الضريبي، والمنصة تسجّل قراره ولا تستنتجه.',
  load:api=>api('/tax-returns/withholding'),
  render(data,{e,button,ui=kit(e)}){
    const sar=minor=>`<span class="ltr">${e(riyal(minor).replace(/ SAR$/,''))}</span>`;
    const num=minor=>riyal(minor).replace(/ SAR$/,'');
    const day=iso=>iso?`<time datetime="${e(iso)}">${e(iso)}</time>`:'—';
    // السجل: المستفيد وما استُقطع منه، ثم حاله شكلًا وكلمة (المتأخر بشكل التوقف، والمسجّل ينتظر توريده، والمورَّد صامت)، ثم سنده.
    const entry=x=>{const yours=x.actions.length>0;
      return `<li class="${x.status==='cancelled'?'is-old':x.late?'is-late':yours?'is-decision':x.status==='remitted'?'':'is-due'}">
      <strong>${e(x.beneficiary_name)} · ${e(x.beneficiary_country)} — المستقطع ${sar(x.withheld_minor)} ريال</strong><span class="badge ${x.status==='cancelled'?'cancelled':x.late?'overdue':x.status==='remitted'?'remitted':'is-due'}">${e(x.late&&x.status==='recorded'?`${x.status_name} — متأخر`:x.status_name)}</span>
      <span>${e(x.service_kind)} · الدفعة ${sar(x.payment_amount_minor)} في ${day(x.payment_date)} · النسبة <bdi dir="ltr">${e(x.percent)}%</bdi></span>
      <span>استحقاق التوريد <time datetime="${e(x.remittance_due_date)}">${e(dual(x.remittance_due_date))}</time>${x.status==='recorded'?` · ${x.days_to_due<0?`متأخر <span data-num>${e(-x.days_to_due)}</span> يوم`:`باقي <span data-num>${e(x.days_to_due)}</span> يوم`}`:''}${x.payment_order_id?' · مرتبط بأمر دفع':' · مو مرتبط بأمر دفع'}</span>
      <small class="measure">صنّفها ${e(x.classified_by_name)} في ${day(x.classified_on)}: ${e(x.classification_note)}${x.treaty_note?` — الاتفاقيات: ${e(x.treaty_note)}`:''}</small>
      <small class="measure">سند الموعد: ${e(x.due_date_basis)}${x.remittance_reference?` — التوريد <bdi>${e(x.remittance_reference)}</bdi>`:''}${x.cancel_note?` — انلغى: ${e(x.cancel_note)}`:''}</small>
      ${x.actions.length?`<div class="operation-actions">${x.actions.map(a=>button(a,x.id,LABELS[a])).join('')}</div>`:''}</li>`;};
    const block=(title,hint,body)=>`<section class="vn-block"><div class="panel-head"><h2>${title}</h2>${hint?`<p>${hint}</p>`:''}</div>${body}</section>`;
    const late=data.entries.filter(x=>x.late&&x.status==='recorded'),rest=data.entries.filter(x=>!late.includes(x));
    return `<section class="panel panel-body vn-head">${data.can_prepare?`<div class="operation-actions">${data.confirmed_rates.length?button('record_entry','','تسجيل دفعة لغير مقيم'):''}${button('record_rate','','نسبة استقطاع مؤرّخة')}</div>`:''}<div class="vn-alert"><strong>${e(data.disclaimer)}</strong><p class="measure">${e(data.warning)}</p></div><p>${e(data.note)}</p>${data.can_prepare&&!data.confirmed_rates.length?'<p>ما فيه نسبة استقطاع مؤكدة للحين. سجّل النسبة بمصدرها وتاريخ تأكيدها، ويأكدها شخص ثاني أول.</p>':''}</section>
      <section class="vn-board"><div class="vn-tiles">${ui.tile(data.totals.late,'تجاوز موعد التوريد',data.totals.late?'is-late':'')}${ui.tile(num(data.totals.due_minor),'ما تورّد للحين بالريال',data.totals.due_minor?'is-due':'')}${ui.tile(num(data.totals.withheld_minor),'إجمالي المستقطع بالريال')}${ui.tile(data.totals.entries,'سجل استقطاع')}${ui.tile(data.payment_orders.length,'أمر دفع بدون سجل استقطاع')}</div></section>
      ${late.length?block(`فات موعد توريدها <span data-num>(${late.length})</span>`,'',`<ul class="vn-list">${late.map(entry).join('')}</ul>`):''}
      ${block('السجلات','',rest.length?`<ul class="vn-list">${rest.map(entry).join('')}</ul>`:`<p class="subtle">${data.entries.length?'ما فيه سجلات غير اللي فات موعدها.':'ما فيه سجلات. سجّل الدفعة بنسبتها المؤرّخة ومين أفتى بتصنيفها.'}</p>`)}
      ${block('النسب المؤرّخة للاستقطاع','',rateList(data,e,button))}
      ${block('أوامر دفع بدون سجل استقطاع','المنصة ما تستنتج إن الدفعة خاضعة للاستقطاع؛ تعرض الأوامر المعتمدة والمنفّذة والمختص يقرر.',data.payment_orders.length?`<ul class="vn-list">${data.payment_orders.map(o=>`<li><strong>${e(o.legal_name)} · ${e(o.country)} — ${sar(o.amount_minor)} ريال</strong><span>${e(o.status==='executed'?'انحوّل في البنك':'معتمد وما انحوّل')}${o.bank_reference?` · مرجع <bdi>${e(o.bank_reference)}</bdi>`:''}</span></li>`).join('')}</ul>`:'<p class="subtle">ما فيه أوامر دفع تنتظر التصنيف.</p>')}`;
  },
  form(action,id,data){
    const x=data.entries.find(r=>r.id===id),s=data.rate_settings.find(r=>r.id===id);
    if(action==='record_rate'){guard(data.can_prepare);return {title:'نسبة استقطاع مؤرّخة',endpoint:'/tax-returns/rates',idempotent:true,
      fields:[field('category','تصنيف الخدمة زي ما حدده المختص',"text",{hint:'مثال: إتاوة، خدمة فنية، خدمة إدارية — زي ما سمّاها المختص، مو زي ما تفترضها المنصة.'}),
        field('label','اسم التصنيف زي ما يطلع في السجل'),
        field('percent','النسبة المئوية','number',{step:'0.01',min:'0',max:'100',hint:'المنصة ما تعرف أي نسبة. اكتب اللي أفتى فيه المختص لهالتصنيف.'}),
        field('effective_from','سارية من','date'),field('source','مصدر النسبة مكتوبًا','textarea'),
        field('specialist_name','المختص الضريبي اللي أكدها'),field('confirmed_on','تاريخ تأكيده','date')],
      toPayload:v=>({kind:'withholding',category:v.category,label:v.label,percent:v.percent,effective_from:v.effective_from,source:v.source,specialist_name:v.specialist_name,confirmed_on:v.confirmed_on})};}
    if(action==='confirm_rate'){guard(s&&s.actions.includes('confirm_rate'));return {title:`تأكيد نسبة — ${s.label}`,endpoint:`/tax-returns/rates/${id}/confirm`,
      fields:[field('note','وش طابقت في المصدر','textarea')],toPayload:v=>({version:s.version,note:v.note})};}
    if(action==='record_entry'){guard(data.can_prepare);
      if(!data.confirmed_rates.length)throw Error('ما فيه نسبة استقطاع مؤكدة للحين. سجّل النسبة بمصدرها وتاريخ تأكيدها، ويأكدها شخص ثاني أول.');
      return {title:'دفعة لغير مقيم',endpoint:'/tax-returns/withholding',idempotent:true,
        fields:[field('payment_order_id','أمر الدفع المرتبط','select',{required:false,options:[{value:'',label:'بلا ربط بأمر دفع'},...data.payment_orders.map(o=>({value:o.id,label:`${o.legal_name} — ${riyal(o.amount_minor)}`}))]}),
          field('beneficiary_name','المستفيد'),field('beneficiary_country','بلد المستفيد'),
          field('service_kind','نوع الخدمة زي ما حدده المختص','text',{hint:'المنصة ما تصنّف الخدمة وما تستنتج نوعها.'}),
          field('payment_date','تاريخ الدفعة','date'),amountField('amount','مبلغ الدفعة',''),
          field('rate_setting_id','نسبة الاستقطاع المؤرّخة','select',{options:data.confirmed_rates.map(r=>({value:r.id,label:`${r.label} — ${r.percent}% سارية من ${r.effective_from}`})),hint:'تنطبق نسبة تاريخ الدفعة، مو نسبة اليوم.'}),
          field('remittance_due_date','تاريخ استحقاق التوريد','date'),
          field('due_date_basis','سند موعد التوريد ومين أكده','textarea',{hint:'المنصة ما تعرف المهلة النظامية؛ الموعد وسنده يدخلهم اللي يعرفهم.'}),
          field('classified_by_name','مين أفتى بهالتصنيف'),field('classified_on','تاريخ الفتوى','date'),
          field('classification_note','أساس التصنيف والنسبة','textarea'),
          field('treaty_note','أثر الاتفاقيات الدولية زي ما حدده المختص','textarea',{required:false})],
        toPayload:v=>({payment_order_id:v.payment_order_id||null,beneficiary_name:v.beneficiary_name,beneficiary_country:v.beneficiary_country,service_kind:v.service_kind,payment_date:v.payment_date,amount:v.amount,rate_setting_id:v.rate_setting_id,remittance_due_date:v.remittance_due_date,due_date_basis:v.due_date_basis,classified_by_name:v.classified_by_name,classified_on:v.classified_on,classification_note:v.classification_note,treaty_note:v.treaty_note||''})};}
    if(action==='record_remittance'){guard(x&&x.actions.includes('record_remittance'));return {title:`توثيق التوريد — ${x.beneficiary_name}`,endpoint:`/tax-returns/withholding/${id}/record_remittance`,
      fields:[field('remitted_on','تاريخ التوريد','date'),field('remittance_reference','مرجع التوريد'),field('remittance_evidence','دليل التوريد ومكان حفظه','textarea',{hint:'المنصة ما تورّد وما تتصل بأي جهة؛ هذا توثيق لشي صار برّاها.'})],
      toPayload:v=>({version:x.version,remitted_on:v.remitted_on,remittance_reference:v.remittance_reference,remittance_evidence:v.remittance_evidence})};}
    if(action==='cancel_entry'){guard(x&&x.actions.includes('cancel_entry'));return {title:`إلغاء سجل — ${x.beneficiary_name}`,endpoint:`/tax-returns/withholding/${id}/cancel_entry`,
      fields:[field('note','سبب الإلغاء','textarea')],toPayload:v=>({version:x.version,note:v.note})};}
    throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة وشوف حالته.');
  }
};
