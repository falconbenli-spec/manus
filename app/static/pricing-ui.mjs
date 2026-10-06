// تسعير المشاريع (MOD-BD-02)، واستثناء التسعير (MOD-BD-03)، وعرض سعر العميل — ثلاث شاشات على لوحة واحدة.
// لا طباعة ولا سطر توقيع في أي منها: مقاعد الاعتماد الأربعة أحداث هوية، والعرض سجل إلكتروني يُقرأ في الشاشة.
// البلاطة والحالة الفارغة من العدّة المشتركة (ctx.ui)؛ ومن يرسم الشاشة بلا صفحة (اختبار) يأخذ العدّة نفسها.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('هالإجراء غير متاح لك الحين. حدّث الصفحة.');};
const pct=bp=>bp===null||bp===undefined?'—':`${(bp/100).toFixed(2)}%`;
const qty=centi=>(centi/100).toFixed(2).replace(/\.00$/,'');
const rial=minor=>minor===null||minor===undefined?'':(minor/100).toFixed(2);
const sheetLabels={edit_sheet:'تعديل المسودة',submit_sheet:'إرسال للاعتمادات الأربعة',withdraw_sheet:'سحب من الاعتماد',decide_sheet:'قراري على مقعدي',
  request_exception:'طلب استثناء تسعير (MOD-BD-03)',create_quotation:'إنشاء عرض السعر'};
const sheetRoutes={edit_sheet:'edit',submit_sheet:'submit',withdraw_sheet:'withdraw',decide_sheet:'decide'};
const quoteLabels={issue_quotation:'إصدار العرض للعميل',revise_quotation:'نسخة جديدة',accept_quotation:'تسجيل قبول العميل',reject_quotation:'تسجيل رفض العميل'};
const quoteRoutes={issue_quotation:'issue',revise_quotation:'revise',accept_quotation:'accept',reject_quotation:'reject'};

function lineRows(data,sheet){
  return field('lines','بنود التكلفة','rows',{maxRows:120,value:(sheet?.totals?.lines??[]).map(l=>({cost_group:l.cost_group,description:l.description,basis:l.basis,quantity:qty(l.quantity_centi),unit_price:rial(l.unit_price_minor),cost_reference_kind:l.cost_reference_kind,cost_reference_id:l.cost_reference_id,note:l.note})),
    columns:[{name:'cost_group',label:'المجموعة',type:'select',options:data.cost_groups.map(g=>({value:g.key,label:g.name}))},
      {name:'description',label:'الوصف'},
      {name:'basis',label:'الأساس',type:'select',options:Object.entries(data.bases).map(([value,label])=>({value,label}))},
      {name:'quantity',label:'الكمية أو الساعات'},{name:'unit_price',label:'سعر الوحدة بالريال'},
      {name:'cost_reference_kind',label:'نوع مرجع الصرف (للإعلانات الممولة)',type:'select',required:false,options:[{value:'',label:'بدون مرجع'},...Object.entries(data.reference_kinds).map(([value,label])=>({value,label}))]},
      {name:'cost_reference_id',label:'مرجع الصرف',required:false},{name:'note',label:'ملاحظات',required:false}],
    hint:`الإجمالي ينحسب من الكمية × سعر الوحدة. ${data.double_count_notice}`});
}
const linesPayload=rows=>(rows??[]).map(l=>({cost_group:l.cost_group,description:l.description,basis:l.basis,quantity:String(l.quantity).trim(),unit_price:String(l.unit_price).trim(),
  cost_reference_kind:l.cost_reference_kind||'',cost_reference_id:l.cost_reference_id||'',note:l.note||''}));
function headFields(data,sheet){
  return [field('name','اسم المشروع','text',{value:sheet?.name}),
    field('contract_kind','نوع العقد','select',{value:sheet?.contract_kind,options:Object.entries(data.contract_kinds).map(([value,label])=>({value,label}))}),
    field('duration_note','مدة المشروع','text',{value:sheet?.duration_note}),
    field('proposed_pm_id','مدير المشروع المقترح','select',{required:false,value:sheet?.proposed_pm_id??'',options:[{value:'',label:'ما تحدد للحين'},...data.team.map(x=>({value:x.id,label:x.name}))]}),
    field('scope_note','النطاق والافتراضات','textarea',{value:sheet?.scope_note}),
    field('discount','الخصم بالريال','text',{required:false,value:sheet?rial(sheet.discount_minor)||'':'',hint:'حساب لحاله ينخصم من الهامش وما ينضاف للتكلفة.'}),
    field('discount_basis','سند الخصم ومين وافق عليه','textarea',{required:false,value:sheet?.discount_basis}),
    field('admin_fee_percent','الرسوم الإدارية %','text',{required:false,value:sheet&&sheet.admin_fee_bp?(sheet.admin_fee_bp/100).toFixed(2):'',hint:'حساب لحاله برّا الهامش.'}),
    field('admin_fee_basis','سند الرسوم الإدارية','textarea',{required:false,value:sheet?.admin_fee_basis}),
    field('vat_rate','نسبة ضريبة القيمة المضافة %','text',{value:sheet?(sheet.vat_rate_bp/100).toFixed(2):'',hint:'تكتبها من مصدرها.'}),
    field('vat_basis','سند نسبة الضريبة','textarea',{value:sheet?.vat_basis}),
    field('review_notes','ملاحظات المراجعة','textarea',{required:false,value:sheet?.review_notes})];
}
const headPayload=v=>({name:v.name,contract_kind:v.contract_kind,duration_note:v.duration_note,proposed_pm_id:v.proposed_pm_id||'',
  scope_note:v.scope_note,discount:v.discount?String(v.discount).trim():'',discount_basis:v.discount_basis||'',
  admin_fee_percent:v.admin_fee_percent?String(v.admin_fee_percent).trim():'',admin_fee_basis:v.admin_fee_basis||'',
  vat_rate:String(v.vat_rate).trim(),vat_basis:v.vat_basis,review_notes:v.review_notes||'',lines:linesPayload(v.lines)});

/* ───── ورقة التسعير ───── */
// الجدول من العدّة (ui.table) لا من نسخة محلية: رؤوسه تتبع التسميات المتجاوَزة في سجل التعريفات، والمسنّنة تنزل واحدًا.
function totalsBlock(e,money,x,ui){
  const t=x.totals;
  if(!t)return '<p class="subtle">ما فيه بنود تكلفة للحين.</p>';
  return `<div class="vn-tiles">${ui.tile(money(t.direct_total_minor),'إجمالي التكاليف المباشرة')}${ui.tile(money(t.contingency_minor),`احتياطي الطوارئ ${pct(t.contingency_rate_bp)}`)}${ui.tile(money(t.total_cost_minor),'إجمالي التكاليف الكلية')}${ui.tile(money(t.sale_price_pre_tax_minor),`سعر البيع عند هامش ${pct(t.target_margin_bp)}`)}
      ${ui.tile(money(t.net_pre_tax_minor),'صافي السعر بعد الخصم')}${ui.tile(pct(t.net_margin_bp),'هامش الربح الفعلي',t.below_target?'is-late':'is-ok')}${ui.tile(pct(t.markup_bp),'هامش الربح على التكلفة (مو الهامش)')}${ui.tile(money(t.grand_total_minor),'الإجمالي شامل الضريبة')}</div>
    ${t.below_target?`<p class="vn-alert">${e(t.status_name)} — الفارق ${e(pct(t.shortfall_bp))}. ما ينرسل العرض قبل اعتماد الاستثناء.</p>`:''}
    ${ui.table({head:['المجموعة','عدد البنود','الإجمالي'],rows:t.groups.map(g=>`<tr><td>${e(g.name)}</td><td>${e(g.line_count)}</td><td>${e(money(g.amount_minor))}</td></tr>`)})}
    ${ui.table({head:['الوصف','المجموعة','الأساس','الكمية/الساعات','سعر الوحدة','الإجمالي','مرجع الصرف','ملاحظات'],rows:t.lines.map(l=>`<tr><td>${e(l.description)}</td><td>${e((x.group_names||{})[l.cost_group]||l.cost_group)}</td><td>${e(l.basis==='hours'?'ساعات':'كمية')}</td><td>${e(qty(l.quantity_centi))}</td><td>${e(rial(l.unit_price_minor))}</td><td>${e(money(l.amount_minor))}</td><td>${e(l.cost_reference_id||'—')}</td><td>${e(l.note||'—')}</td></tr>`)})}
    <section class="vn-block"><h3>كل معادلة بأرقامها</h3><ul class="vn-list">${t.formulas.map(f=>`<li><strong>${e(f.label)}</strong><span>${e(f.expression)}</span></li>`).join('')}</ul>
      <p class="subtle">${e(t.margin_note)}</p></section>`;
}
function seatsBlock(e,x){
  return `<section class="vn-block"><h3>مقاعد الاعتماد الأربعة</h3><ul class="vn-list">${x.approval_seats.map(s=>`<li class="${s.decision==='approved'?'is-ok':s.decision?'is-late':s.mine_to_decide?'is-decision':'is-due'}"><strong>${e(s.name)}</strong><span>${s.decision?`${e(s.decision_name)} — ${e(s.decided_by_name)} · ${e(s.decided_at)}`:'ينتظر القرار'}${s.mine_to_decide?' · دورك':''}</span>${s.note?`<small>${e(s.note)}</small>`:''}</li>`).join('')}</ul>
    ${x.approval_history.length>x.approval_seats.filter(s=>s.decision).length?`<p class="subtle">جولات سابقة: ${x.approval_history.filter(a=>a.approval_round<x.approval_round).map(a=>`${e(a.seat_name)} ${e(a.decision_name)}`).join(' · ')}</p>`:''}</section>`;
}
export const pricingUI={
  title:'تسعير المشاريع',
  description:'ورقة تسعير المشروع (MOD-BD-02) بالمجموعات الخمس واحتياطي الطوارئ الإلزامي وسعر البيع المشتق من الهامش المستهدف، بإجمالياتها الحية ومعادلاتها المعروضة. كل نسبة فيها سياسة معتمدة بسندها.',
  load:api=>api('/pricing'),
  render(data,{e,button,money,ui=kit(e)}){
    const groupNames=Object.fromEntries(data.cost_groups.map(g=>[g.key,g.name]));
    const card=x=>`<details class="vn-card"${x.status==='submitted'?' open':''}><summary><span class="vn-code"><bdi>${e(x.code)}</bdi></span><span class="vn-name"><strong>${e(x.name)}</strong><small>${e(x.client_name)} · ${e(x.contract_kind_name)} · ${e(x.duration_note)} · أعدّها ${e(x.prepared_by_name)}</small></span><span class="vn-flags">${x.exception_required&&!x.exception_satisfied?'<span class="vn-flag is-block">يحتاج MOD-BD-03</span>':''}${x.price_card?'':'<span class="vn-flag is-warn">بلا بطاقة أسعار</span>'}<span class="badge">${e(x.status_name)}</span></span></summary>
      <div class="vn-body"><p class="measure">${e(x.scope_note)}</p>
      ${x.price_card?`<p class="subtle">مربوطة ببطاقة الأسعار «${e(x.price_card.name)}» سريان ${e(x.price_card.pinned_on)}.</p>`:`<p class="vn-alert">${e(x.rate_card_notice)}</p>`}
      ${x.minimum_margin_notice?`<p class="subtle">${e(x.minimum_margin_notice)}</p>`:''}
      ${totalsBlock(e,money,{...x,group_names:groupNames},ui)}
      ${seatsBlock(e,x)}
      ${x.review_notes?`<p class="subtle">ملاحظات المراجعة: ${e(x.review_notes)}</p>`:''}
      ${x.exception?`<p class="${x.exception.live?'subtle':'vn-alert'}">استثناء التسعير <bdi>${e(x.exception.code)}</bdi>: ${e(x.exception.status_name)}${x.exception.expired?' — منتهي الصلاحية':''} · ${e(pct(x.exception.requested_margin_bp))} بدل ${e(pct(x.exception.policy_margin_bp))} · ينتهي ${e(x.exception.expires_on)}</p>`:''}
      ${x.quotation?`<p class="subtle">عرض السعر <bdi>${e(x.quotation.code)}</bdi> (${e(x.quotation.status)}).</p>`:''}
      ${x.actions.length?`<div class="operation-actions">${x.actions.map(a=>button(a,x.id,sheetLabels[a])).join('')}</div>`:''}</div></details>`;
    const groups=[['submitted','بانتظار الاعتمادات الأربعة'],['draft','مسودات'],['approved','معتمدة'],['rejected','مرفوضة']]
      .map(([s,t])=>{const rows=data.sheets.filter(x=>x.status===s);return rows.length?`<section class="vn-group"><h2>${e(t)} <span>${rows.length}</span></h2>${rows.map(card).join('')}</section>`:'';}).join('');
    const policies=data.policies.map(p=>`<li class="${p.status==='approved'?'is-ok':p.status==='draft'?(p.actions.length?'is-decision':'is-due'):'is-old'}"><strong>${e(p.policy_name)} — ${e(p.display)} · ${e(p.status_name)}</strong><span>${e(p.source_reference)}</span><small>${e(p.basis)}</small>${p.actions.length?`<div class="operation-actions">${p.actions.map(a=>button(a,p.id,a==='approve_policy'?'اعتماد السياسة':'رفض')).join('')}</div>`:''}</li>`).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.note)}</p>
      ${data.setup_needed.map(s=>`<p class="vn-alert">${e(s)}</p>`).join('')}
      <p class="${data.double_count_checked?'subtle':'vn-alert'}">${e(data.double_count_notice)}</p>
      <p class="subtle">${e(data.clocks.note)}</p>
      ${data.clients.length?`<div class="operation-actions">${data.clients.map(c=>button('create_sheet',c.id,`ورقة تسعير — ${c.name}`)).join('')}${button('prepare_policy','','سياسة تسعير')}${data.issuer_decision?'':button('prepare_decision','','حسم قرار جهة الإصدار')}</div>`:'<p class="subtle">ما أنت ضمن فريق أي حساب عميل.</p>'}</section>
      ${groups||ui.empty('ما فيه أوراق تسعير في حساباتك للحين','الورقة تبدأ من زر «ورقة تسعير» على عميل أنت ضمن فريق حسابه.')}
      <section class="panel panel-body"><h2>سياسات التسعير</h2>${policies?`<ul class="vn-list">${policies}</ul>`:'<p class="subtle">ما فيه سياسات تسعير للحين. تبدأ فاضية ويعبيها مالك الإجراء بسندها من النموذج.</p>'}</section>`;
  },
  form(action,id,data){
    if(action==='prepare_policy'){
      // الحقلان معروضان معًا ولا يختفي أحدهما: السياسة تحدد أيهما يُقرأ، والخادم يرفض الفارغ منهما.
      const units=data.policy_defs.map(p=>`${p.name}: ${p.unit==='percent'?'نسبة %':data.units[p.unit]}`).join(' · ');
      return {title:'سياسة تسعير',endpoint:'/pricing/policies',idempotent:true,fields:[
        field('policy_key','السياسة','select',{options:data.policy_defs.map(p=>({value:p.key,label:`${p.name} (${p.source})`})),hint:units}),
        field('percent','النسبة %','text',{required:false,hint:'لسياسات النسب بس (الطوارئ، الهامش المستهدف، الحد الأدنى). اكتب اللي ينص عليه النموذج.'}),
        field('duration','المهلة بوحدتها','number',{required:false,min:1,max:8760,hint:'لسياسات المهل بس: ساعات لعرض العميل، وأيام عمل للتحقق المالي.'}),
        field('source_reference','سند الرقم: أي نموذج أو مخطط نص عليه ووين','textarea'),
        field('basis','ليش هالرقم','textarea'),field('effective_from','تاريخ السريان','date',{value:data.today})],
        toPayload:v=>({policy_key:v.policy_key,percent:v.percent?String(v.percent).trim():'',duration:v.duration?Number(v.duration):null,
          source_reference:v.source_reference,basis:v.basis,effective_from:v.effective_from})};
    }
    if(action==='prepare_decision')return {title:'قرار جهة إصدار عرض السعر',endpoint:'/pricing/decisions',idempotent:true,fields:[
      field('chosen_option','الجهة اللي تصدر العرض','select',{options:data.issuer_options.map(o=>({value:o.key,label:`${o.name} — ${o.reading}`}))}),
      field('basis','على أي القراءتين استقر القرار وليش','textarea',{hint:data.issuer_notice})],
      toPayload:v=>({chosen_option:v.chosen_option,basis:v.basis})};
    const policy=data.policies.find(p=>p.id===id);
    if(policy){guard(policy.actions.includes(action));return {title:`${action==='approve_policy'?'اعتماد':'رفض'} — ${policy.policy_name}`,endpoint:`/pricing/policies/${id}/${action}`,
      fields:[field('note',action==='approve_policy'?'أساس الاعتماد':'سبب الرفض','textarea')],toPayload:v=>({version:policy.version,note:v.note})};}
    const decision=data.decisions.find(d=>d.id===id);
    if(decision){guard(decision.actions.includes(action));return {title:`${action==='approve_decision'?'حسم':'رفض'} — جهة الإصدار: ${decision.option_name}`,endpoint:`/pricing/decisions/${id}/${action}`,
      fields:[field('note',action==='approve_decision'?'أساس القرار':'سبب الرفض','textarea')],toPayload:v=>({version:decision.version,note:v.note})};}
    if(action==='create_sheet'){
      const client=data.clients.find(c=>c.id===id);guard(client);
      return {title:`ورقة تسعير — ${client.name}`,endpoint:'/pricing/sheets',idempotent:true,
        fields:[field('opportunity_id','الفرصة','select',{required:false,options:[{value:'',label:'بدون فرصة'},...client.opportunities.map(o=>({value:o.id,label:o.name}))]}),
          ...headFields(data,null),lineRows(data,null)],
        toPayload:v=>({client_id:client.id,opportunity_id:v.opportunity_id||'',...headPayload(v)})};
    }
    const x=data.sheets.find(s=>s.id===id);guard(x);guard(x.actions.includes(action));
    if(action==='edit_sheet')return {title:`تعديل ${x.code}`,endpoint:`/pricing/sheets/${id}/edit`,fields:[...headFields(data,x),lineRows(data,x)],
      toPayload:v=>({version:x.version,...headPayload(v)})};
    if(['submit_sheet','withdraw_sheet'].includes(action))return {title:`${sheetLabels[action]} — ${x.code}`,endpoint:`/pricing/sheets/${id}/${sheetRoutes[action]}`,fields:[],toPayload:()=>({version:x.version})};
    if(action==='decide_sheet'){
      const mine=x.approval_seats.filter(s=>s.mine_to_decide);guard(mine.length);
      return {title:`قراري على ${x.code}`,endpoint:`/pricing/sheets/${id}/decide`,fields:[
        field('seat','المقعد','select',{options:mine.map(s=>({value:s.key,label:s.name}))}),
        field('decision','القرار','select',{options:Object.entries(data.decisions_names).map(([value,label])=>({value,label}))}),
        field('note','ملاحظات القرار','textarea',{hint:data.approval_note})],
        toPayload:v=>({version:x.version,seat:v.seat,decision:v.decision,note:v.note})};
    }
    if(action==='request_exception')return {title:`استثناء تسعير (MOD-BD-03) — ${x.code}`,endpoint:`/pricing/sheets/${id}/exception`,idempotent:true,fields:[
      field('justification','مبرر الاستثناء: ليش ينقبل هالهامش الحين','textarea'),
      field('applies_to','نطاق الاستثناء: وش يسري عليه بالضبط','textarea'),
      field('attachments','المرفقات','rows',{required:false,maxRows:20,columns:[{name:'reference',label:'مرجع المرفق ووين انحفظ'}],hint:'مراجع، مو ملفات مطبوعة.'}),
      field('expires_on','تاريخ انتهاء الاستثناء','date',{hint:'الاستثناء اللي بلا نهاية يصير سياسة.'})],
      toPayload:v=>({justification:v.justification,applies_to:v.applies_to,attachments:(v.attachments??[]).map(a=>a.reference).filter(Boolean),expires_on:v.expires_on})};
    return {title:`عرض سعر من ${x.code}`,endpoint:`/pricing/sheets/${id}/quotation`,idempotent:true,entity:'client_quotation',
      fields:[field('valid_until','تاريخ صلاحية العرض','date'),field('note','ملاحظة النسخة','textarea',{required:false})],
      toPayload:v=>({valid_until:v.valid_until,note:v.note||''})};
  }
};

/* ───── استثناء التسعير: الطلبات وقرار الرئيس التنفيذي ───── */
export const marginExceptionsUI={
  title:'استثناءات التسعير',
  description:'طلبات استثناء التسعير (MOD-BD-03) بمبررها والهامش المطلوب وأثر القيمة ومرفقاتها وتاريخ انتهائها والنطاق اللي تسري عليه. القرار للرئيس التنفيذي بس.',
  load:api=>api('/pricing'),
  render(data,{e,button,money,ui=kit(e)}){
    const row=x=>`<details class="vn-card"${x.status==='pending'?' open':''}><summary><span class="vn-code"><bdi>${e(x.code)}</bdi></span><span class="vn-name"><strong>${e(x.client_name)} · ورقة ${e(x.sheet_code)}</strong><small>طلبه ${e(x.requested_by_name)} · ${e(x.requested_at)}</small></span><span class="vn-flags">${x.expired?'<span class="vn-flag is-warn">منتهي الصلاحية</span>':''}<span class="badge">${e(x.status_name)}</span></span></summary>
      <div class="vn-body"><div class="vn-tiles">${ui.tile(pct(x.requested_margin_bp),'الهامش المطلوب',x.status==='approved'?'is-ok':'is-late')}${ui.tile(pct(x.policy_margin_bp),'هامش السياسة')}${ui.tile(money(x.value_impact_minor),'أثر القيمة بالريال')}${ui.tile(x.expires_on,'ينتهي في')}</div>
      <dl class="detail-data"><dt>المبرر</dt><dd>${e(x.justification)}</dd><dt>النطاق اللي يسري عليه</dt><dd>${e(x.applies_to)}</dd><dt>المرفقات</dt><dd>${x.attachments.length?x.attachments.map(a=>e(a)).join(' · '):'—'}</dd></dl>
      ${x.decided_at?`<p class="subtle">القرار ${e(x.decided_at)} — ${e(x.decision_note)}</p>`:''}
      ${x.actions.length?`<div class="operation-actions">${x.actions.map(a=>button(a,x.id,a==='approve_exception'?'اعتماد الاستثناء':'رفض الاستثناء')).join('')}</div>`:''}</div></details>`;
    const pending=data.exceptions.filter(x=>x.status==='pending'),decided=data.exceptions.filter(x=>x.status!=='pending');
    return `<section class="panel panel-body vn-head"><p>${e(data.approval_note)}</p>
      <p class="subtle">الهامش الفعلي إذا نزل عن المستهدف، لازم له هالطلب قبل إرسال عرض السعر (نموذج التسعير).</p>
      ${data.can_decide?'':'<p class="subtle">القرار لصاحب صلاحية «اعتماد سياسات التسعير واستثناء التسعير»؛ أنت تشوف الطلبات بس.</p>'}</section>
      ${pending.length?`<section class="vn-group"><h2>تنتظر قرار الرئيس التنفيذي <span>${pending.length}</span></h2>${pending.map(row).join('')}</section>`:''}
      ${decided.length?`<section class="vn-group"><h2>انحسمت <span>${decided.length}</span></h2>${decided.map(row).join('')}</section>`:''}
      ${data.exceptions.length?'':ui.empty('ما فيه طلبات استثناء','الطلب ينرفع من ورقة التسعير لما يقل هامشها عن المستهدف.')}`;
  },
  form(action,id,data){
    const x=data.exceptions.find(r=>r.id===id);guard(x&&x.actions.includes(action));
    return {title:`${action==='approve_exception'?'اعتماد':'رفض'} استثناء ${x.code}`,endpoint:`/pricing/exceptions/${id}/${action}`,
      fields:[field('note',action==='approve_exception'?'أساس الاعتماد ومداه':'سبب الرفض','textarea',{hint:'قرارك ينسجل باسمك ووقته.'})],
      toPayload:v=>({version:x.version,note:v.note})};
  }
};

/* ───── عرض السعر ونسخه ───── */
export const quotationsUI={
  title:'عروض أسعار العملاء',
  description:'العرض سجل إلكتروني بنسخه، مربوط بإصدار بطاقة الأسعار اللي انبنى عليها وبتاريخ صلاحيته، ومعه سبب الفوز أو الخسارة.',
  load:api=>api('/pricing'),
  // سجل التعريفات (ترحيل 123): الحقول المخصّصة في موضعيها (ui.fields)، والقائمة بأعمدتها ومرشحاتها (ui.records)، وشارة الحالة
  // بعبارتها المنشورة. بسجل فارغ لا يتغير في البطاقة بايت واحد.
  render(data,{e,button,money,ui=kit(e)}){
    const ENTITY='client_quotation',hidden=q=>(q.withheld??[]).some(w=>w.key==='cost_margin');
    const versionRow=v=>`<tr><td>${e(v.revision)}</td><td>${e(v.price_card_effective_from)}</td><td>${e(v.valid_until)}</td><td>${e(money(v.snapshot.net_pre_tax_minor))}</td><td>${e(pct(v.snapshot.net_margin_bp))}</td><td>${e(money(v.snapshot.grand_total_minor))}</td><td>${e(v.margin_exception_id?'مع استثناء':'—')}</td></tr>`;
    const row=q=>`<details class="vn-card"${q.status==='issued'?' open':''}><summary><span class="vn-code"><bdi>${e(q.code)}</bdi></span><span class="vn-name"><strong>${e(q.client_name)}</strong><small>ورقة <bdi>${e(q.sheet_code)}</bdi> · ${q.issuer_name?`أصدرته ${e(q.issuer_name)}`:'ما صدر للحين'}</small></span><span class="vn-flags">${q.expired?'<span class="vn-flag is-warn">انتهت الصلاحية</span>':''}${ui.statusBadge(q.status,{entity:ENTITY,name:q.status_name})}</span></summary>
      <div class="vn-body">${ui.fields(ENTITY,q,'header')}${q.current?`<div class="vn-tiles">${ui.tile(money(q.current.snapshot.net_pre_tax_minor),'صافي السعر قبل الضريبة')}${hidden(q)?ui.tile('محجوب','هامش الربح الفعلي'):ui.tile(pct(q.current.snapshot.net_margin_bp),'هامش الربح الفعلي')}${ui.tile(money(q.current.snapshot.grand_total_minor),'الإجمالي شامل الضريبة')}${ui.tile(q.current.valid_until,'صالح لين')}</div>`:''}
      ${q.issuer_ready?'':`<p class="vn-alert">${e(q.issuer_notice)}</p>`}
      ${q.issue_clock&&q.issue_clock.target_hours?`<p class="subtle">عداد الإصدار: ${e(q.issue_clock.elapsed_hours??'—')} ساعة من اكتمال المتطلبات، والمهلة ${e(q.issue_clock.target_hours)} ساعة. ${e(q.issue_clock.separate_clock_note)}</p>`:`<p class="subtle">${e(q.issue_clock?.notice||'')}</p>`}
      ${ui.table({head:['النسخة','سريان بطاقة الأسعار','صالح لين','صافي السعر','الهامش','الإجمالي','الاستثناء'],rows:q.versions.map(versionRow)})}
      ${ui.fields(ENTITY,q,'body')}
      ${q.outcome?`<p class="${q.outcome==='won'?'subtle':'vn-alert'}">${e(q.outcome==='won'?'فاز':'خسر')}: ${e(q.outcome_reason)}</p>`:''}
      ${q.deal?`<p class="subtle">مربوط بالصفقة <bdi>${e(q.deal.deal_ref)}</bdi> «${e(q.deal.deal_name)}» · ${q.deal.contracted?'اتفاقها موثّق على هالعرض':'نسخة عرضها محفوظة على هالعرض'} <a class="btn outline small" href="#commercial">افتح الصفقة</a></p>`
        :`<p class="subtle">ما رُبط بصفقة للحين. صاحب الصفقة يحفظ نسخة عرضه عليه من «العملاء والعروض»، والاتفاق يتوثّق عليه بعد قبول العميل.</p>`}
      ${q.actions.length?`<div class="operation-actions">${q.actions.map(a=>button(a,q.id,quoteLabels[a])).join('')}</div>`:''}</div></details>`;
    const groups=[['issued','صدرت للعملاء'],['draft','مسودات ما صدرت'],['accepted','مقبولة'],['rejected','مرفوضة']]
      .map(([s,t])=>{const rows=data.quotations.filter(q=>q.status===s);return rows.length?`<section class="vn-group"><h2>${e(t)} <span>${rows.length}</span></h2>${rows.map(row).join('')}</section>`:'';}).join('');
    return `<section class="panel panel-body vn-head"><p>${e(data.approval_note)}</p>
      <p class="${data.issuer_decision?'subtle':'vn-alert'}">${data.issuer_decision?`جهة الإصدار: ${e(data.issuer_decision.option_name)} — ${e(data.issuer_decision.basis)}`:e(data.issuer_notice)}</p>
      <p class="subtle">${e(data.clocks.note)}</p></section>
      ${data.quotations.length?`<section class="panel panel-body"><h2>قائمة العروض</h2>${ui.records(ENTITY,data.quotations,{id:'quotation-list',custom:data.custom_columns,columns:[
        {key:'code',label:ui.label(ENTITY,'code','رقم العرض'),value:q=>q.code,html:q=>`<a href="#quotations?focus=${e(q.id)}"><bdi>${e(q.code)}</bdi></a>`},
        {key:'client_id',label:ui.label(ENTITY,'client_id','العميل'),value:q=>q.client_name},
        {key:'status',label:ui.label(ENTITY,'status','الحالة'),value:q=>q.status_name,html:q=>ui.statusBadge(q.status,{entity:ENTITY,name:q.status_name})},
        {key:'valid_until',label:ui.label(ENTITY,'valid_until','صالح حتى'),value:q=>q.current?.valid_until??'—'},
        {key:'grand_total',label:ui.label(ENTITY,'grand_total','الإجمالي شامل الضريبة'),value:q=>q.current?money(q.current.snapshot.grand_total_minor):'—'}]})}</section>`:''}
      ${groups||ui.empty('ما فيه عروض أسعار للحين','العرض ينشأ من ورقة تسعير معتمدة.')}`;
  },
  form(action,id,data){
    const q=data.quotations.find(r=>r.id===id);guard(q&&q.actions.includes(action));
    // entity/record/transition: نموذج الانتقال يحمل الحقول المخصّصة الملزَمة عند هذا الانتقال التي ما زالت فارغة، فتُملأ داخل حواره نفسه.
    const spec=(fields,toPayload)=>({title:`${quoteLabels[action]} — ${q.code}`,endpoint:`/pricing/quotations/${id}/${quoteRoutes[action]}`,fields,toPayload:v=>({version:q.version,...toPayload(v)}),
      entity:'client_quotation',record:q,transition:quoteRoutes[action]});
    if(action==='revise_quotation')return spec([field('valid_until','تاريخ الصلاحية الجديد','date'),field('note','وش تغيّر في هالنسخة','textarea',{required:false})],v=>({valid_until:v.valid_until,note:v.note||''}));
    if(action==='issue_quotation')return spec([field('note','ملاحظة الإصدار','textarea',{required:false,hint:'الإصدار ينسجل باسمك ووقته.'})],v=>({note:v.note||''}));
    return spec([field('reason',action==='accept_quotation'?'سبب الفوز زي ما قاله العميل':'سبب الخسارة زي ما قاله العميل','textarea')],v=>({reason:v.reason}));
  }
};
