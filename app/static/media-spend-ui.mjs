// الصرف الإعلامي وتقرير العميل الدوري — لفريق حساب العميل فقط.
// البلاطة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const amount=minor=>(minor/100).toFixed(2);

const spendLabels={prepare_plan:'إعداد خطة صرف',edit_plan:'تعديل المسودة',approve_plan:'اعتماد الخطة',discard_plan:'إهمال المسودة',record_spend:'تسجيل صرف يدوي',import_spend:'استيراد ملف من المنصة',set_threshold:'ضبط عتبة تنبيه',retire_threshold:'إيقاف العتبة',acknowledge_spend:'إقرار مكتوب بالتنبيه',record_billing:'تسجيل اللي انفوتر للعميل',correct_spend:'تصحيح القيد',link_commitment:'ربط بأمر شراء',cancel_import:'إلغاء دفعة الاستيراد',deactivate_profile:'إيقاف التعيين'};
function planFields(data,c,draft){
  return [field('budget_reference','مرجع اعتماد توزيع الميزانية','text',{value:draft?.budget_reference,hint:`ميزانية الحملة المعتمدة من العميل: ${amount(c.client_budget_minor)} ريال. الخطة توزعها وما تتعداها.`}),
    field('lines','سطور الخطة — سطر لكل قناة','rows',{value:draft?.lines?.map(l=>({channel:l.channel,start_date:l.start_date,end_date:l.end_date,planned:amount(l.planned_minor),target_metric:l.target_metric,target_value:l.target_value,target_unit:l.target_unit}))??c.channels.map(ch=>({channel:ch,start_date:c.start_date,end_date:c.end_date})),
      columns:[{name:'channel',label:'القناة',type:'select',options:c.channels.map(k=>({value:k,label:data.channels.find(x=>x.key===k)?.name??k}))},{name:'start_date',label:'من',type:'date'},{name:'end_date',label:'إلى',type:'date'},{name:'planned',label:'الميزانية المخططة (ريال)'},{name:'target_metric',label:'المؤشر المستهدف'},{name:'target_value',label:'المستهدف',type:'number',min:1},{name:'target_unit',label:'الوحدة'}],maxRows:c.channels.length,hint:'المسودة تتعدل لين يعتمدها شخص غيرك؛ وبعد الاعتماد التغيير بنسخة جديدة.'})];
}
const planPayload=v=>({budget_reference:v.budget_reference,lines:v.lines.map(l=>({...l,planned:String(l.planned).trim(),target_value:Number(l.target_value)}))});
const evidenceFields=data=>[field('evidence_kind','نوع المصدر','select',{options:Object.entries(data.evidence_kinds).map(([value,label])=>({value,label}))}),field('evidence_reference','مرجع المصدر ووين انحفظ','text',{hint:'الرقم اللي بلا مصدر ما ينقبل.'})];

export const mediaSpendUI={
  title:'الصرف الإعلامي',description:'خطة صرف لكل حملة يعتمدها شخص ثاني، وصرف فعلي بمصدر كل رقم (إدخال يدوي أو ملف CSV تصدّره أنت من المنصة الإعلانية)، ووتيرة الصرف، وتنبيهات بعتبات يضبطها مالك الحملة، والتزامات الوكالة نيابة عن العميل مقابل اللي انفوتر. ومو متصل بأي منصة إعلانية.',
  load:api=>api('/media-spend'),
  render(data,{e,button,money,ui=kit(e)}){
    const alertText=a=>a.kind==='threshold'?`بلغ الصرف عتبة ${a.percent}% (${money(a.level_minor)})`:`تجاوز الصرف الميزانية المخططة (${money(a.level_minor)})`;
    const card=c=>{
      const p=c.pacing;
      return `<details class="vn-card"${c.pending_acknowledgements||c.draft?' open':''}><summary><span class="vn-code">${e(c.client_name)}</span><span class="vn-name"><strong>${e(c.name)}</strong><small>${e(c.start_date)} لين ${e(c.end_date)} · ${e(c.owner_name)}</small></span><span class="vn-flags">${c.pending_acknowledgements?`<span class="vn-flag is-block">${e(c.pending_acknowledgements)} تنبيه بدون إقرار</span>`:''}${c.on_behalf.unbilled_minor>0?'<span class="vn-flag is-warn">التزام ما انفوتر</span>':''}<span class="badge">${e(c.plan?`الخطة ${c.plan.revision}`:'بدون خطة معتمدة')}</span></span></summary><div class="vn-body">
        ${c.actions.length?`<div class="operation-actions">${c.actions.map(a=>button(a,c.id,spendLabels[a])).join('')}</div>`:''}
        ${p?`<div class="vn-tiles">${ui.tile(money(p.planned_minor),'المخطط')}${ui.tile(money(p.expected_minor),'المتوقع لين اليوم لو توزع بالتساوي')}${ui.tile(money(p.actual_minor),'الفعلي لين اليوم')}${ui.tile(money(p.variance_minor),p.variance_minor>0?'متقدم عن الوتيرة':'متأخر عن الوتيرة',p.variance_minor>0?'is-late':'is-ok')}</div>
        <div class="table-wrap"><table><thead><tr><th>القناة</th><th>المدة</th><th>المخطط</th><th>المتوقع حتى اليوم</th><th>الفعلي</th><th>الفرق</th><th>المستهدف</th></tr></thead><tbody>${p.lines.map(l=>`<tr class="${l.over_line?'is-late':''}"><td>${e(l.channel_name)}</td><td>${e(l.days_elapsed)}/${e(l.days_total)} يوم</td><td>${e(money(l.planned_minor))}</td><td>${e(money(l.expected_minor))}</td><td>${e(money(l.actual_minor))}</td><td>${e(money(l.variance_minor))}</td><td>${e(l.target_value.toLocaleString('en-US'))} ${e(l.target_unit)} · ${e(l.target_metric)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="subtle">ما فيه خطة صرف معتمدة للحين؛ والفعلي ما ينسجل قبلها.</p>'}
        ${c.draft?`<section class="vn-block"><h3>مسودة الخطة ${e(c.draft.revision)}</h3><ul class="vn-list">${c.draft.lines.map(l=>`<li><strong>${e(l.channel_name)} · ${e(money(l.planned_minor))}</strong><span>${e(l.start_date)} لين ${e(l.end_date)} · ${e(l.target_value)} ${e(l.target_unit)}</span></li>`).join('')}</ul>${c.draft.actions.length?`<div class="operation-actions">${c.draft.actions.map(a=>button(a,c.id,spendLabels[a])).join('')}</div>`:''}</section>`:''}
        <section class="vn-block"><h3>التنبيهات والعتبات</h3>${c.thresholds.filter(t=>t.live).length?`<ul class="vn-list">${c.thresholds.filter(t=>t.live).map(t=>`<li><strong>${e(t.percent)}% من المخطط</strong><span>${e(t.basis)}</span>${t.actions.length?`<div class="operation-actions">${button('retire_threshold',`${c.id}:${t.id}`,spendLabels.retire_threshold)}</div>`:''}</li>`).join('')}</ul>`:'<p class="subtle">ما فيه عتبات؛ يضبطها مالك الحملة.</p>'}
          ${c.alerts.length?`<ul class="vn-list">${c.alerts.map(a=>`<li class="${a.acknowledgement?'is-old':'is-late'}"><strong>${e(alertText(a))}</strong><span>${a.acknowledgement?`انقرّ: ${e(a.acknowledgement.decision_name)} — ${e(a.acknowledgement.note)}`:'ينتظر إقرار مكتوب؛ والتنبيه ما يوقف الحملة.'}</span></li>`).join('')}</ul>`:''}</section>
        <section class="vn-block"><h3>الصرف نيابة عن العميل</h3><p class="subtle">التزمنا ${e(money(c.on_behalf.committed_minor))} (مربوط بأمر شراء ${e(money(c.on_behalf.linked_minor))}، بلا ربط ${e(money(c.on_behalf.unlinked_minor))}) · فوترنا ${e(money(c.on_behalf.billed_minor))} · <strong>ما انفوتر ${e(money(c.on_behalf.unbilled_minor))}</strong></p></section>
        ${c.entries.length?`<section class="vn-block"><h3>قيود الصرف</h3><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>القناة</th><th>المبلغ</th><th>المصدر</th><th>الدافع</th><th><span class="sr-only">الإجراءات</span></th></tr></thead><tbody>${c.entries.map(x=>`<tr class="${x.superseded||x.cancelled?'is-old':''}"><td>${e(x.spend_date)}</td><td>${e(x.channel_name)}${x.corrects_id?' · تصحيح':''}${x.superseded?' · مصحَّح':''}${x.cancelled?' · دفعة ملغاة':''}</td><td>${e(money(x.amount_minor))}</td><td>${e(x.evidence_kind_name)}: ${e(x.evidence_reference)}${x.entry_method==='file_import'?` · ملف <bdi>${e(x.file_name)}</bdi> سطر ${e(x.import_line_no)}`:' · إدخال يدوي'}</td><td>${e(x.funding_name)}${x.commitment?` · أمر ${e(x.commitment.supplier_name)}`:''}</td><td>${x.actions.length?`<div class="operation-actions">${x.actions.map(a=>button(a,`${c.id}:${x.id}`,spendLabels[a])).join('')}</div>`:''}</td></tr>`).join('')}</tbody></table></div></section>`:''}
        ${c.imports.length?`<section class="vn-block"><h3>دفعات الاستيراد</h3><ul class="vn-list">${c.imports.map(i=>`<li class="${i.status==='cancelled'?'is-old':''}"><strong><bdi>${e(i.file_name)}</bdi> · ${e(i.channel_name)} · ${e(i.row_count)} سطر · ${e(money(i.total_minor))}</strong><span>${e(i.imported_at.slice(0,10))} · بصمة <bdi dir="ltr">${e(i.file_digest.slice(0,12))}</bdi>${i.status==='cancelled'?` · ملغاة: ${e(i.cancel_reason)}`:''}</span>${i.actions.length?`<div class="operation-actions">${button('cancel_import',`${c.id}:${i.id}`,spendLabels.cancel_import)}</div>`:''}</li>`).join('')}</ul></section>`:''}
        </div></details>`;
    };
    const profiles=data.profiles.length?`<section class="panel panel-body"><h2>تعيين أعمدة ملفات المنصات</h2><ul class="vn-list">${data.profiles.map(p=>`<li class="${p.active?'':'is-old'}"><strong>${e(p.channel_name)} · ${e(p.name)}</strong><span>${e(p.delimiter_name)} · <bdi>${e(p.date_format)}</bdi> · ترويسة ${e(p.header_rows)}${p.active?'':' · موقوف'}</span>${p.actions.length?`<div class="operation-actions">${button('deactivate_profile',p.id,spendLabels.deactivate_profile)}</div>`:''}</li>`).join('')}</ul></section>`:'';
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${data.can_create_profile?`<div class="operation-actions">${button('save_profile','','تعيين أعمدة ملف منصة')}</div>`:'<p class="subtle">ما أنت ضمن فريق أي حساب عميل.</p>'}</section>${data.campaigns.map(card).join('')||ui.empty('ما فيه حملات في حساباتك','الصرف الإعلامي ينسجل على حملة لها خطة صرف معتمدة.')}${profiles}`;
  },
  form(action,id,data){
    if(action==='save_profile'){
      guard(data.can_create_profile);
      const column=(key,label,hint)=>field(key,label,'text',{required:false,hint});
      return {title:'تعيين أعمدة ملف منصة إعلانية',endpoint:'/media-spend/profiles',idempotent:true,
        fields:[field('channel','القناة','select',{options:data.channels.map(c=>({value:c.key,label:c.name}))}),field('name','اسم التعيين'),
          field('delimiter','الفاصل بين الأعمدة','select',{options:Object.entries(data.delimiters).map(([value,d])=>({value,label:d.name}))}),
          field('date_format','صيغة التاريخ في الملف','select',{options:Object.entries(data.date_formats).map(([value,sample])=>({value,label:`${value} (مثال ${sample})`}))}),
          field('header_rows','عدد أسطر الترويسة','number',{value:1,hint:'صفر إذا الملف بلا ترويسة؛ وقتها عيّن الأعمدة بأرقامها من صفر.'}),
          column('date','عمود التاريخ','اسم العمود زي ما هو في الترويسة، أو رقمه.'),column('amount','عمود المبلغ المصروف'),
          column('campaign','عمود اسم الحملة (اختياري)','إذا الملف فيه كل حملات الحساب الإعلاني، تنستورد سطور هالحملة بس.'),column('currency','عمود العملة (اختياري)','إذا موجود، أي سطر بغير الريال ينرفض.')],
        toPayload:v=>{const columns={};for(const key of ['date','amount','campaign','currency']){const raw=v[key];if(raw===undefined||raw==='')continue;columns[key]=/^\d+$/.test(String(raw).trim())?Number(raw):String(raw);}
          return {channel:v.channel,name:v.name,delimiter:v.delimiter,date_format:v.date_format,header_rows:Number(v.header_rows||0),columns};}};
    }
    if(action==='deactivate_profile'){const p=data.profiles.find(x=>x.id===id);guard(p&&p.active);return {title:`إيقاف التعيين — ${p.name}`,endpoint:`/media-spend/profiles/${id}/deactivate`,fields:[field('note','سبب الإيقاف','textarea')],toPayload:v=>({version:p.version,note:v.note})};}
    const [campaignId,subId]=String(id).split(':'),c=data.campaigns.find(x=>x.id===campaignId);guard(c);
    const title=`${spendLabels[action]} — ${c.name}`;
    if(action==='prepare_plan'){guard(c.actions.includes(action));return {title,endpoint:'/media-spend/plans',idempotent:true,fields:planFields(data,c,null),toPayload:v=>({campaign_id:c.id,...planPayload(v)})};}
    if(['edit_plan','approve_plan','discard_plan'].includes(action)){
      guard(c.draft&&c.draft.actions.includes(action));const endpoint=`/media-spend/plans/${c.draft.id}/${action}`,base={version:c.draft.version};
      if(action==='edit_plan')return {title,endpoint,fields:planFields(data,c,c.draft),toPayload:v=>({...base,...planPayload(v)})};
      return {title,endpoint,fields:[field('note',action==='approve_plan'?'وش راجعت قبل الاعتماد':'سبب الإهمال','textarea')],toPayload:v=>({...base,note:v.note})};
    }
    const fundingField=field('funding','من دفع للمنصة','select',{options:Object.entries(data.funding).map(([value,label])=>({value,label}))});
    if(action==='record_spend'){guard(c.actions.includes(action));return {title,endpoint:`/media-spend/campaigns/${c.id}/spend`,idempotent:true,
      fields:[field('channel','القناة','select',{options:c.pacing.lines.map(l=>({value:l.channel,label:l.channel_name}))}),field('spend_date','تاريخ الصرف','date',{value:data.today}),field('amount','المبلغ (ريال)'),...evidenceFields(data),fundingField],toPayload:v=>({...v,amount:String(v.amount).trim()})};}
    if(action==='import_spend'){guard(c.actions.includes(action));const planned=new Set(c.pacing.lines.map(l=>l.channel));return {title,endpoint:`/media-spend/campaigns/${c.id}/imports`,idempotent:true,
      fields:[field('profile_id','تعيين الأعمدة','select',{options:data.profiles.filter(p=>p.active&&planned.has(p.channel)).map(p=>({value:p.id,label:`${p.channel_name} · ${p.name}`}))}),field('file_name','اسم الملف كما حفظته'),
        field('content','محتوى ملف CSV','textarea',{maxLength:2000000,hint:'الصق محتوى الملف زي ما صدّرته من لوحة المنصة الإعلانية. نفس الملف ما ينستورد مرتين.'}),
        field('campaign_match','اسم الحملة زي ما يطلع في الملف','text',{required:false,hint:'يلزم إذا التعيين فيه عمود اسم الحملة.'}),...evidenceFields(data),fundingField],toPayload:v=>({...v,campaign_match:v.campaign_match||''})};}
    if(action==='set_threshold'){guard(c.actions.includes(action));return {title,endpoint:`/media-spend/campaigns/${c.id}/thresholds`,idempotent:true,fields:[field('percent','النسبة من الميزانية المخططة','text',{hint:'مثل 80.'}),field('basis','ليش هالعتبة ومين اتفق عليها','textarea')],toPayload:v=>({percent:String(v.percent).trim(),basis:v.basis})};}
    if(action==='retire_threshold'){const t=c.thresholds.find(x=>x.id===subId);guard(t&&t.actions.includes(action));return {title,endpoint:`/media-spend/thresholds/${t.id}/retire`,fields:[field('reason','السبب','textarea')],toPayload:v=>({version:t.version,reason:v.reason})};}
    if(action==='acknowledge_spend'){guard(c.actions.includes(action));const open=c.alerts.filter(a=>!a.acknowledgement);return {title,endpoint:`/media-spend/campaigns/${c.id}/acknowledge`,
      fields:[field('alert','التنبيه','select',{options:open.map(a=>({value:`${a.kind}|${a.threshold_id??''}`,label:a.kind==='threshold'?`عتبة ${a.percent}%`:'تجاوز الميزانية المخططة'}))}),field('decision','القرار','select',{options:Object.entries(data.ack_decisions).map(([value,label])=>({value,label}))}),field('note','الإقرار المكتوب: وش عرفت ووش قررت ومع مين','textarea',{hint:'الإقرار ما ينفذ شي؛ الإيقاف المؤقت خطوة لحالها في شاشة الحملات.'})],
      toPayload:v=>{const [kind,threshold='']=String(v.alert).split('|');return {kind,threshold_id:threshold,decision:v.decision,note:v.note};}};}
    if(action==='record_billing'){guard(c.actions.includes(action));const claims=data.claims.filter(a=>a.client_id===c.client_id);return {title,endpoint:`/media-spend/campaigns/${c.id}/billings`,idempotent:true,
      fields:[field('claim_id','الاستحقاق المعتمد في مسار الذمم','select',{options:claims.map(a=>({value:a.id,label:a.label}))}),field('amount','ما يخص الصرف الإعلامي منه (ريال)'),field('note','أي بند في الاستحقاق يغطي الصرف الإعلامي','textarea',{hint:'ما تنشأ فاتورة هنا؛ الاستحقاق ينعدّ وينعتمد في مستحقات العملاء.'})],toPayload:v=>({...v,amount:String(v.amount).trim()})};}
    if(action==='cancel_import'){const i=c.imports.find(x=>x.id===subId);guard(i&&i.actions.includes(action));return {title,endpoint:`/media-spend/imports/${i.id}/cancel`,fields:[field('reason','سبب الإلغاء','textarea')],toPayload:v=>({version:i.version,reason:v.reason})};}
    const x=c.entries.find(y=>y.id===subId);guard(x&&x.actions.includes(action));
    if(action==='correct_spend')return {title,endpoint:`/media-spend/entries/${x.id}/correct`,fields:[field('amount','المبلغ الصحيح (ريال)','text',{value:amount(x.amount_minor)}),...evidenceFields(data),field('reason','سبب التصحيح','textarea',{hint:'السطر السابق يبقى ظاهر كمصحَّح.'})],toPayload:v=>({...v,amount:String(v.amount).trim()})};
    return {title,endpoint:`/media-spend/entries/${x.id}/commitment`,fields:[field('purchase_id','أمر الشراء الداخلي','select',{options:data.purchases.map(o=>({value:o.purchase_id,label:`${o.title} · ${o.supplier_name} · ${amount(o.total_minor)}`}))}),
      field('invoice_id','فاتورة المورد (اختياري)','select',{required:false,options:[{value:'',label:'ما انسجلت للحين'},...data.purchases.flatMap(o=>o.invoices.map(i=>({value:i.id,label:`${o.title} · ${i.supplier_reference}`})))]}),field('note','وش يغطي الأمر','textarea')],toPayload:v=>({purchase_id:v.purchase_id,invoice_id:v.invoice_id||'',note:v.note})};
  }
};

const reportLabels={create_template:'قالب تقرير جديد',edit_template:'تعديل القالب',deactivate_template:'إيقاف القالب',generate_report:'توليد تقرير',write_commentary:'كتابة التعليق',sign_report:'التوقيع باسمي',discard_report:'إهمال المسودة',correct_report:'تقرير مصحَّح'};
const figureValue=(f,money)=>f.type==='money'?money(f.value):f.type==='none'?'لا قيد':Number(f.value).toLocaleString('en-US');
export const clientReportsUI={
  title:'تقارير العملاء',description:'تقرير دوري لكل عميل ينولّد من سجلات المنصة بس، ولكل رقم مصدره وتاريخه. مسؤول الحساب يكتب تعليقه ويوقّعه باسمه، وبعدين يرسله بنفسه.',
  load:api=>api('/client-reports'),
  render(data,{e,button,money,ui=kit(e)}){
    const sectionName=key=>data.sections.find(s=>s.key===key)?.name??key;
    const templates=data.templates.map(t=>`<li class="${t.active?'':'is-old'}"><strong>${e(t.client_name)} · ${e(t.name)}</strong><span>${e(t.cadence_name)} · ${t.sections.map(s=>e(sectionName(s))).join('، ')}${t.active?'':' · موقوف'}</span><div class="operation-actions">${t.can_generate?button('generate_report',t.id,reportLabels.generate_report):''}${t.actions.map(a=>button(a,t.id,reportLabels[a])).join('')}</div></li>`).join('');
    // أفعال التقرير أول جسم البطاقة (الخطوة الجاية)، والمستند ينفتح في تبويب جديد ويُقال ذلك للقارئ الآلي.
    const card=r=>`<details class="vn-card"${r.status==='draft'?' open':''}><summary><span class="vn-code">${e(r.client_name)}</span><span class="vn-name"><strong>${e(r.title)}</strong><small>${e(r.period_start)} لين ${e(r.period_end)}${r.signed_by_name?` · وقّعه ${e(r.signed_name)}`:''}</small></span><span class="vn-flags">${r.integrity?'':'<span class="vn-flag is-block">البصمة لا تطابق</span>'}<span class="badge">${e(r.status_name)}</span></span></summary><div class="vn-body">
      <div class="operation-actions">${r.actions.map(a=>button(a,r.id,reportLabels[a])).join('')}<a class="btn outline small" href="${e(r.print_path)}" target="_blank" rel="noopener">التقرير كمستند PDF<span class="sr-only"> (ينفتح في تبويب جديد)</span></a></div>
      ${r.sections.map(s=>s.human?`<section class="vn-block"><h3>${e(s.name)}</h3><p class="measure">${e(r.next_step||'ما انكتبت للحين — يكتبها مسؤول الحساب.')}</p></section>`:`<section class="vn-block"><h3>${e(s.name)}</h3>${s.groups.map(g=>`<h4>${e(g.title)}${g.subtitle?` <small class="subtle">${e(g.subtitle)}</small>`:''}</h4><div class="table-wrap"><table><thead><tr><th>البند</th><th>القيمة</th><th>المصدر</th><th>بتاريخ</th></tr></thead><tbody>${g.figures.map(f=>`<tr class="${f.type==='none'?'is-old':''}"><td>${e(f.label)}</td><td>${e(figureValue(f,money))}</td><td>${e(f.source)}</td><td>${e(f.as_of)}</td></tr>`).join('')}</tbody></table></div>`).join('')||'<p class="subtle">ما فيه سجلات في الفترة؛ وغياب البيانات مو صفر.</p>'}</section>`).join('')}
      <section class="vn-block"><h3>تعليق مسؤول الحساب</h3><p class="measure">${e(r.commentary||'ما انكتب للحين.')}</p>${r.signer_blocked?`<p class="vn-alert">${e(r.signer_blocked)}</p>`:''}</section></div></details>`;
    const owned=data.clients.filter(c=>c.is_owner);
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>${owned.length?`<div class="operation-actions">${button('create_template','',reportLabels.create_template)}</div>`:data.clients.length?'':'<p class="subtle">ما أنت ضمن فريق أي حساب عميل.</p>'}</section>
      ${templates?`<section class="panel panel-body"><h2>القوالب</h2><ul class="vn-list">${templates}</ul></section>`:''}
      ${data.reports.map(card).join('')||ui.empty('ما فيه تقارير في حساباتك للحين','التقرير ينولّد من قالب لعميل أنت مسؤول حسابه.')}`;
  },
  form(action,id,data){
    const sectionsField=value=>field('sections','الأقسام','checks',{value:value??data.sections.map(s=>s.key),options:data.sections.map(s=>({value:s.key,label:s.name}))});
    const cadenceField=value=>field('cadence','الدورية','select',{value,options:Object.entries(data.cadences).map(([v,label])=>({value:v,label}))});
    if(action==='create_template'){const owned=data.clients.filter(c=>c.is_owner);guard(owned.length);return {title:reportLabels.create_template,endpoint:'/client-reports/templates',idempotent:true,fields:[field('client_id','العميل','select',{options:owned.map(c=>({value:c.id,label:c.name}))}),field('name','اسم القالب'),cadenceField(),sectionsField()],toPayload:v=>v};}
    const t=data.templates.find(x=>x.id===id);
    if(action==='generate_report'){guard(t&&t.can_generate);return {title:`${reportLabels.generate_report} — ${t.client_name}`,endpoint:'/client-reports',idempotent:true,
      fields:[field('title','عنوان التقرير','text',{value:`${t.name} — ${data.today.slice(0,7)}`}),field('period_start','بداية الفترة','date',{value:`${data.today.slice(0,7)}-01`}),field('period_end','نهاية الفترة','date',{value:data.today})],toPayload:v=>({template_id:t.id,title:v.title,period_start:v.period_start,period_end:v.period_end,supersedes_id:''})};}
    if(action==='edit_template'){guard(t&&t.actions.includes(action));return {title:`${reportLabels.edit_template} — ${t.name}`,endpoint:`/client-reports/templates/${t.id}/edit_template`,fields:[field('name','اسم القالب','text',{value:t.name}),cadenceField(t.cadence),sectionsField(t.sections)],toPayload:v=>({version:t.version,...v})};}
    if(action==='deactivate_template'){guard(t&&t.actions.includes(action));return {title:`${reportLabels.deactivate_template} — ${t.name}`,endpoint:`/client-reports/templates/${t.id}/deactivate_template`,fields:[field('note','السبب','textarea')],toPayload:v=>({version:t.version,note:v.note})};}
    const r=data.reports.find(x=>x.id===id);guard(r&&r.actions.includes(action));
    const spec=(fields,toPayload)=>({title:`${reportLabels[action]} — ${r.title}`,endpoint:`/client-reports/${r.id}/${action}`,fields,toPayload:v=>({version:r.version,...toPayload(v)})});
    if(action==='write_commentary')return spec([field('commentary','تعليقك على الأداء','textarea',{value:r.commentary,maxLength:6000,hint:'تكتبه أنت وينوقّع باسمك.'}),field('next_step','الخطوة الجاية','textarea',{required:false,value:r.next_step})],v=>({commentary:v.commentary,next_step:v.next_step||''}));
    if(action==='sign_report')return spec([field('confirm','الإقرار','select',{options:[{value:'yes',label:'راجعت الأرقام ومصادرها وكتبت التعليق بنفسي، وأوقّع باسمي'}]})],v=>({confirm:v.confirm==='yes'}));
    if(action==='discard_report')return spec([field('note','سبب الإهمال','textarea')],v=>({note:v.note}));
    // التصحيح تقرير جديد من القالب نفسه يحل محل الموقّع عند توقيعه.
    return {title:`${reportLabels.correct_report} — ${r.title}`,endpoint:'/client-reports',idempotent:true,fields:[field('title','عنوان التقرير المصحَّح','text',{value:`${r.title} — مصحَّح`})],toPayload:v=>({template_id:r.template_id,title:v.title,period_start:r.period_start,period_end:r.period_end,supersedes_id:r.id})};
  }
};
