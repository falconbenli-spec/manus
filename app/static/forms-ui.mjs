// النماذج الإلكترونية: كتالوج نماذج الشركة، ومعبئ النموذج بأقسامه وتحققه الحي، وسجل النسخة الإلكتروني
// بنسخها واعتماداتها. شاشة أولًا: لا زر طباعة ولا تخطيط ورقة ولا سطر توقيع — قرار المالك (20 سبتمبر).
// كل سطر توقيع في النموذج الأصلي يظهر هنا سطرَ اعتماد: «اعتمد: الاسم · الدور · التاريخ والوقت» ومرجع السجل.
// الرابط #forms/<معرّف النسخة> يفتح سجلها، و#forms?department=PR&step=7&q=PR-02 يرشّح الكتالوج.
// ترتيب الشاشة: ما ينتظر قرارك، ثم النماذج المعبّأة (شغلك)، ثم الكتالوج الذي تبدأ منه. ورقم كل عنوان طول قائمته.
// ما يخص إعداد الكتالوج (مصدر التعريف وتنبيهاته، والملفات التي تعذّرت قراءتها) مطويٌّ أو لمن يملك قبول التعريف.
import { kit } from './kit.mjs';

const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لك الحين. حدّث الصفحة.');};
const ACTION_LABELS={fill_form:'تعبئة النموذج',accept_definition:'قبول التعريف',search_forms:'بحث في الكتالوج',
  edit_form:'تعديل المسودة',submit_form:'تقديم وإقرار',cancel_form:'إلغاء النموذج',claim_review:'بدء المراجعة',
  mark_incomplete:'تعليمه ناقصًا',approve_form:'اعتماد',return_form:'إعادة للتعديل',reject_form:'رفض',revise_form:'فتح نسخة جديدة'};
// نبرة الصف من حال النسخة: المعاد والناقص ينتظران صاحبهما (انتباه لا تأخر)، والمنتهي خامل.
const STATE={draft:'',submitted:'is-due',incomplete:'is-due',under_review:'is-due',returned:'is-due',
  approved:'is-ok',rejected:'is-old',cancelled:'is-old',superseded:'is-old'};
// شارة حال النسخة بأصناف الحالات القائمة؛ ما لا صنف له يأخذ أقرب معنى.
const BADGE={incomplete:'needs_info',under_review:'in_review'};
const pad=step=>String(step ?? '—').padStart(2,'0');
const ISO_DAY=/^\d{4}-\d{2}-\d{2}/;
const dateTag=(e,iso)=>ISO_DAY.test(String(iso??''))?`<time datetime="${e(String(iso).slice(0,10))}">${e(String(iso).slice(0,10))}</time>`:e(iso||'—');
// اسمٌ مسموع للزر المتكرر في كل صف يحمل نموذجه، ويبدأ بنصه الظاهر (WCAG 2.5.3). النص الظاهر نفسه لا يتغيّر.
const named=(e,html,label)=>html.replace(/^<button\b/,`<button aria-label="${e(label)}"`);
const FORMS_NOUN=['نموذج واحد','نموذجين','نماذج','نموذج'];
const count=(n,[one,two,few,many])=>n===1?one:n===2?two:`${n} ${n>=3&&n<=10?few:many}`;

// معاملات الترشيح من العنوان: #forms?q=…&department=…&step=… ، والمقطع الثاني معرّف نسخة يُفتح سجلها.
function hashParts(){
  let hash='';
  try{hash=String(globalThis.location?.hash??'');}catch{hash='';}
  const [path='',query='']=hash.replace(/^#/,'').split('?');
  const focus=path.split('/')[1]??'';
  const params={};
  for(const pair of query.split('&')){
    const [key,value=''] = pair.split('=');
    if(['q','department','step','project_id'].includes(key)&&value)params[key]=decodeURIComponent(value);
  }
  return {focus,params};
}
const queryString=params=>{const parts=Object.entries(params).map(([k,x])=>`${k}=${encodeURIComponent(x)}`);return parts.length?'?'+parts.join('&'):'';};

// حقول النموذج كما يعرضها المعبئ: قسمًا قسمًا، ولكل حقل قسمه ومن يستكمله في التلميح.
function fillFields(definition,values={}){
  const out=[];
  for(const section of definition.sections)
    for(const item of section.fields){
      const hint=[`${section.title} · يعبّيه ${section.owner}`,item.help??'',item.inferred?'مقترح — يحتاج اعتماد':'',
        item.undefined_in_source?`غير محدد في المصدر: ${item.undefined_in_source}`:'',
        item.template_default?`قيمة قالب في المصدر: ${item.template_default}`:''].filter(Boolean).join(' · ');
      const base={required:item.required,hint,value:values[item.key]??(item.type==='checks'?[]:'')};
      if(item.type==='checks')out.push(field(item.key,item.label,'checks',{...base,options:(item.options??[]).map(o=>({value:o,label:o}))}));
      else if(item.type==='select')out.push(field(item.key,item.label,'select',{...base,options:[{value:'',label:'اختر…'},...(item.options??[]).map(o=>({value:o,label:o}))]}));
      else if(item.type==='textarea')out.push(field(item.key,item.label,'textarea',{...base,maxLength:item.max_length??3000}));
      else if(item.type==='number')out.push(field(item.key,item.label,'number',{...base,...(item.min!==undefined?{min:item.min}:{}),...(item.max!==undefined?{max:item.max}:{}),inputmode:'decimal'}));
      else if(item.type==='date')out.push(field(item.key,item.label,'date',base));
      else out.push(field(item.key,item.label,'text',{...base,maxLength:item.max_length??500}));
    }
  return out;
}
const flatFields=definition=>definition.sections.flatMap(s=>s.fields.map(x=>({...x,section:s.key,owner:s.owner})));
// شرط الظهور يُقرأ من قيمة حقل آخر، كما يقرؤه الخادم. شرط يشير إلى حقل غير موجود لا يخفي شيئًا.
function visible(item,values,all){
  const rule=item.show_when;
  if(!rule||!all.some(x=>x.key===rule.field))return true;
  const expected=Array.isArray(rule.equals)?rule.equals:[rule.equals];
  return expected.includes(values[rule.field]);
}
function payloadOf(definition,values){
  const all=flatFields(definition),payload={};
  for(const item of all){
    if(!visible(item,values,all))continue;
    const value=values[item.key];
    if(item.type==='checks'){if(Array.isArray(value)&&value.length)payload[item.key]=value;continue;}
    if(value!==undefined&&value!=='')payload[item.key]=String(value);
  }
  return payload;
}
// التحقق الحي: ما ينقص الآن ومن يستكمله، وما تمنعه بوابة من تنبيهات المصدر. الخادم يعيد التحقق عند الحفظ.
function liveCheck(definition,values,e){
  const all=flatFields(definition),shown=all.filter(item=>visible(item,values,all));
  const missing=shown.filter(item=>item.required&&(item.type==='checks'
    ?!(Array.isArray(values[item.key])&&values[item.key].length):!values[item.key]));
  const blocked=(definition.gates??[]).map(gateItem=>{
    const item=all.find(x=>x.key===gateItem.field);
    if(!item||!visible(item,values,all))return null;
    const value=values[gateItem.field];
    const passed=gateItem.rule==='equals'?value===gateItem.value
      :gateItem.rule==='not_equals'?!!value&&value!==gateItem.value
      :gateItem.rule==='includes'?Array.isArray(value)&&value.includes(gateItem.value)
      :Array.isArray(value)&&(item.options??[]).every(option=>value.includes(option));
    return passed?null:gateItem.message;
  }).filter(Boolean);
  const lines=[];
  lines.push(missing.length
    ?`<p class="error">باقي ${e(missing.length)}: ${missing.map(x=>`${e(x.label)} (${e(x.owner)})`).join('، ')}</p>`
    :'<p>كمّلت الحقول المطلوبة الظاهرة.</p>');
  for(const message of blocked)lines.push(`<p class="subtle">شرط المصدر عند الاعتماد: ${e(message)}</p>`);
  return lines.join('');
}

// صف التعريف: الاسم والرمز، ثم إدارته وبنده وتصنيفه وإلزامه وحاله، ثم ما يتطلبه ومن يعتمده إلكترونيًا، ثم سريانه.
// المصدر وتفاصيل التعريف وتنبيهاته مطويّة بعدّها: هي لمن يقبل التعريف، لا لمن يعبّي النموذج.
function definitionRow(definition,data,button,e){
  const aliases=definition.aliases.map(a=>`<bdi dir="ltr">${e(a.alias)}</bdi>${a.ambiguous?' <span class="badge">رمز مكرر — مو معرّف</span>':''}`).join(' · ');
  const actions=[];
  if(definition.status==='draft'&&data.can_accept)actions.push(named(e,button('accept_definition',definition.form_key,ACTION_LABELS.accept_definition),`${ACTION_LABELS.accept_definition}: ${definition.title}`));
  if(definition.fillable&&data.can_fill)actions.push(named(e,button('fill_form',definition.form_key,ACTION_LABELS.fill_form),`${ACTION_LABELS.fill_form}: ${definition.title}`));
  // «يتطلب: …» — شبكة التبعيات من عمود «المرفقات / الارتباطات» في فهرس الشركة.
  const requires=(definition.requires||[]).map(r=>`${e(r.title)} (<bdi dir="ltr">${e(r.form_key)}</bdi>)`).join('، ');
  const accepted=definition.status==='accepted',deciding=definition.status==='draft'&&data.can_accept;
  const signed=definition.chain.filter(s=>s.from_signature).map(s=>e(s.title)).join('، ');
  const notes=[...definition.warnings.map(w=>`<p class="is-warn-text">${e(w)}</p>`),
    ...(definition.unverified_items||[]).map(x=>`<p class="is-warn-text">${e(x.note)} — ${e(x.label)}: ${e(x.reason)}</p>`)];
  const details=[`<p class="subtle">الاسم الإنجليزي: <bdi dir="ltr" lang="en">${e(definition.title_en||'—')}</bdi></p>`,
    `<p class="subtle">المصدر: ${e(definition.source_note)}</p>`,`<p class="subtle">الأسماء البديلة: ${aliases||'—'}</p>`,
    signed?`<p class="subtle">خطوات كانت سطور توقيع في النموذج الأصلي: ${signed}</p>`:'',...notes,
    (definition.template_defaults||[]).length?`<p class="subtle">افتراضيات القالب الأصلي (${e(definition.template_defaults.length)}): ${definition.template_defaults.map(x=>`${e(x.label)} = ${e(x.value)}`).join('، ')} — ${e(definition.template_defaults[0].note)}</p>`:'',
    definition.inferred_fields.length?`<p class="subtle">حقول مقترحة تحتاج اعتماد (${e(definition.inferred_fields.length)}): ${definition.inferred_fields.map(x=>e(x.label)).join('، ')}</p>`:''].filter(Boolean).join('');
  return `<li class="${accepted?'':deciding?'is-decision':'is-pending'}">
    <strong>${e(definition.title)} · <bdi dir="ltr">${e(definition.form_key)}</bdi></strong>
    <span>${e(definition.department_name)} · البند ${e(pad(definition.step_no))} · ${e(definition.classification||'—')} · ${e(definition.mandate||'—')} · ${e(definition.status_name)} (نسخة ${e(definition.version)})</span>
    ${requires?`<small>يتطلب: ${requires}</small>`:''}
    <small>يعتمده إلكترونيًا: ${definition.chain.map(s=>e(s.title)).join(' ← ')} · ويقرّ بتقديمه: ${e(definition.author.title)}</small>
    ${accepted?`<small>ساري من ${dateTag(e,definition.effective_from)}</small>`
      :`<small>مسودة ما تتعبّى لين يقبلها مالك النموذج، واللي جهّزها ما يقبلها.${definition.fillable?` السارية للتعبئة الحين: النسخة ${e(definition.accepted_version)}.`:''}</small>`}
    <details><summary>${e(`المصدر وتفاصيل التعريف${notes.length?` — فيها ${notes.length} تنبيه`:''}`)}</summary>${details}</details>
    ${actions.length?`<div class="operation-actions">${actions.join('')}</div>`:''}</li>`;
}

// صف النسخة المعبّأة: عنوانها وشارة حالها، ثم من عبّأها وعلى أي سجل، ثم سطر الإقرار الإلكتروني (بديل التوقيع)، ثم ما ينقصها
// أو يمنع اعتمادها، ثم سجلها الإلكتروني مطويًّا، ثم أفعالها. ما ينقص انتباه؛ وما يمنع الاعتماد (شرط أو نموذج سابق) منع.
function instanceRow(instance,data,button,e,focus){
  const approvals=instance.approvals.length
    ?`<ul class="vn-list">${instance.approvals.map(a=>`<li class="${a.status==='approved'?'is-ok':a.status==='pending'?'is-due':'is-old'}">
        <strong>${e(a.line)}</strong>
        <small class="subtle">مرجع السجل <bdi dir="ltr">${e(a.record_reference)}</bdi>${a.from_signature?' · كان سطر توقيع في النموذج الأصلي':''}</small>
        ${a.carried?`<small class="subtle">${e(a.carried_note)}</small>`:''}
        ${a.note?`<small>${e(a.note)}</small>`:''}</li>`).join('')}</ul>`
    :'<p class="subtle">ما انقدّم للاعتماد للحين.</p>';
  const sections=instance.sections?instance.sections.map(section=>`<section class="vn-block"><h3>${e(section.title)} <small class="subtle">يعبّيه ${e(section.owner)}</small></h3>
    <dl class="vn-list">${section.fields.map(item=>{
      const value=instance.payload[item.key];
      const shown=Array.isArray(value)?(value.length?value.join(' · '):'—'):(value===undefined||value===''?'—':String(value));
      return `<div><dt>${e(item.label)}${item.inferred?' <span class="badge">مقترح — يحتاج اعتماد</span>':''}</dt><dd>${e(shown).replace(/\n/g,'<br>')}</dd></div>`;
    }).join('')}</dl></section>`).join(''):'';
  // النسخة الحالية ما تحتاج رابطًا إلى نفسها؛ غيرها رابط يفتح سجله.
  const versions=instance.versions.map(x=>`<li class="${x.current?'is-ok':'is-old'}">نسخة ${e(x.instance_version)} · ${e(x.status_name)}${x.current?' · هذي النسخة':` · <a href="#forms/${e(x.id)}">فتح سجلها</a>`}</li>`).join('');
  const verb={edit:'edit_form',submit:'submit_form',cancel:'cancel_form',claim_review:'claim_review',
    mark_incomplete:'mark_incomplete',approve:'approve_form',return:'return_form',reject:'reject_form',revise:'revise_form'};
  return `<li class="${STATE[instance.status]??''}">
    <strong>${e(instance.title)} — ${e(instance.definition_title)}</strong>
    <span class="badge ${e(BADGE[instance.status]??instance.status)}">${e(instance.status_name)}</span>
    <span>نسخة ${e(instance.instance_version)} · ${e(instance.subject_kind_name)} <bdi dir="ltr">${e(instance.subject_id)}</bdi> · عبّأه ${e(instance.created_by_name)}</span>
    ${instance.submission?`<small class="subtle">${e(instance.submission.line)}</small>`:'<small class="subtle">ما انقدّم للحين — التقديم إقرار إلكتروني من اللي جهّزه.</small>'}
    ${instance.missing.length?`<span class="vn-flag is-warn">باقي ${e(instance.missing.length)}: ${instance.missing.map(m=>`${e(m.label)} (${e(m.owner)})`).join('، ')}</span>`:''}
    ${(instance.requires||[]).length?`<small class="subtle">يتطلب: ${instance.requires.map(r=>`${e(r.title)} (<bdi dir="ltr">${e(r.form_key)}</bdi>)`).join('، ')}</small>`:''}
    ${(instance.missing_prerequisites||[]).map(r=>`<span class="vn-flag is-block">نموذج مطلوب ما انعبّى على ${e(instance.subject_kind_name)} <bdi dir="ltr">${e(instance.subject_id)}</bdi>: ${e(r.title)} (<bdi dir="ltr">${e(r.form_key)}</bdi>) — ${e(r.source)}</span>`).join('')}
    ${instance.open_gates.map(g=>`<span class="vn-flag is-block">${e(g.message)}</span>`).join('')}
    ${instance.pending_documents.length?`<small class="subtle">بنود ما تأشّرت: ${instance.pending_documents.map(d=>`${e(d.item)} (${e(d.owner)})`).join('، ')}</small>`:''}
    ${instance.decision_note?`<small>${e(instance.decision_note)}</small>`:''}
    <details${focus===instance.id?' open':''}><summary>السجل الإلكتروني: الأقسام والنسخ والاعتمادات</summary>
      ${sections}
      <section class="vn-block"><h3>الاعتمادات الإلكترونية</h3>${approvals}</section>
      <section class="vn-block"><h3>النسخ</h3><ul class="vn-list">${versions}</ul></section>
      <p class="subtle">رابط هالسجل: <bdi dir="ltr">${e(instance.record_link)}</bdi> — تفتحه وتشاركه، وما يحتاج طباعة.</p>
    </details>
    <div class="operation-actions">${instance.actions.map(a=>{
      const key=verb[a];
      return key?named(e,button(key,instance.id,ACTION_LABELS[key]),`${ACTION_LABELS[key]}: ${instance.title}`):'';
    }).join('')}<a class="btn outline small" href="/api/forms/instances/${e(instance.id)}/export" aria-label="${e(`تصدير بيانات السجل للأرشفة: ${instance.title}`)}">تصدير بيانات السجل (أرشفة)</a></div></li>`;
}

export const formsUI={
  title:'النماذج الإلكترونية',
  title_en:'Electronic forms',
  description:'نماذج الشركة إلكترونية: تعبّيها هنا وتقدّمها بإقرار منك، وكل سطر توقيع في النموذج الأصلي صار خطوة اعتماد باسم من اعتمد ودوره ووقته ونسخة النموذج.',
  async load(api){
    const {focus,params}=hashParts();
    const data=await api('/forms'+queryString(params));
    return {...data,focus,params};
  },
  render(data,{e,button,ui:given}){
    const ui=typeof given?.tile==='function'?given:kit(e);
    const filters=data.filters||{};
    const departmentName=code=>(data.departments||[]).find(d=>d.code===code)?.name??code;
    // روابط الترشيح: المختار منها يقول إنه المختار (aria-current)، وإلغاء الترشيح لا يُرسم ما لم يكن ترشيح.
    const departmentLinks=(data.departments||[]).map(d=>`<a class="btn outline small" href="#forms?department=${e(d.code)}"${filters.department===d.code?' aria-current="true"':''}>${e(d.name)}</a>`).join(' ');
    const steps=[...new Set((data.definitions||[]).map(d=>d.step_no).filter(x=>x))].sort((a,b)=>a-b);
    const stepLinks=steps.map(step=>`<a class="btn outline small" href="#forms?step=${e(step)}"${String(filters.step)===String(step)?' aria-current="true"':''}>البند ${e(pad(step))}</a>`).join(' ');
    const active=[filters.q?`بحث: ${filters.q}`:'',filters.department?`الإدارة: ${departmentName(filters.department)}`:'',
      filters.step?`البند: ${filters.step}`:'',filters.project_id?`المشروع: ${filters.project_id}`:''].filter(Boolean).join(' · ');
    const byDepartment=(data.departments||[]).map(d=>{
      const rows=(data.definitions||[]).filter(x=>x.department_code===d.code);
      if(!rows.length)return '';
      return `<section class="vn-block"><h3>${e(d.name)} <small class="subtle">${e(count(rows.length,FORMS_NOUN))}</small></h3>
        <ul class="vn-list">${rows.map(x=>definitionRow(x,data,button,e)).join('')}</ul></section>`;
    }).join('');
    const instances=(data.instances||[]),definitions=(data.definitions||[]),awaiting=data.awaiting_me||[];
    const waitingVerb={approve:'اعتماد',claim_review:'بدء المراجعة'};
    // الملفات التي تعذّرت قراءتها: لمن يقبل التعريفات أو يصممها وحده، ومطويّة — هي مادة إعداد الكتالوج لا قراءة الموظف.
    const sources=(data.can_accept||data.can_design)&&(data.unverified_sources||[]).length?ui.card({code:'؟',title:`ملفات مصدر ما انقرت (${data.unverified_sources.length})`,meta:data.unverified_note??'',
      body:`<div class="vn-body"><p class="subtle measure">ما يستند إليها مذكور هنا صراحةً، وما انبنى عليها شي في الكتالوج. تحتاج فتحًا يدويًا من المالك.</p>
        <ul class="vn-list">${data.unverified_sources.map(s=>`<li class="is-due"><strong><bdi dir="ltr">${e(s.file)}</bdi> — ${e(s.folder)}</strong>
          <small class="subtle">ليش ما انقرا: ${e(s.reason)}</small>
          <span class="vn-flag is-warn">يستند إليه: ${s.rests_on.map(x=>e(x)).join(' · ')}</span>
          <small class="subtle">أثره على الكتالوج: ${e(s.catalogue_impact)}</small></li>`).join('')}</ul></div>`}):'';
    const sourceAudit=data.source_audit?`<section class="vn-block"><h3>تدقيق مصادر Google Drive · ${e(data.source_audit.audited_on)}</h3>
        <p class="subtle">الفهرس الموحد يحوي ${e(data.source_audit.unified_index.records)} نموذجًا ومستندًا. الموجة الأولى ${e(data.source_audit.coverage.wave1)} نموذجًا: ${e(data.source_audit.coverage.wave1_built)} مبنية، و${e(data.source_audit.coverage.wave1_readable_sources)} لها مصادر مقروءة، ومصدر واحد مفقود. النماذج المتخصصة لا تُنسخ إلى محرك النماذج العام.</p>
        <div class="operation-actions"><a class="btn outline small" target="_blank" rel="noopener noreferrer" href="${e(data.source_audit.root_url)}">فتح مجلد المصادر</a>
          <a class="btn outline small" target="_blank" rel="noopener noreferrer" href="${e(data.source_audit.unified_index.url)}">فتح فهرس الـ41</a></div>
        <ul class="vn-list">${data.source_audit.blockers.map(x=>`<li class="is-due"><strong><bdi dir="ltr">${e(x.code)}</bdi> · ${e(x.name)}</strong><small class="subtle">${e(x.effect)}</small></li>`).join('')}</ul>
        <p class="subtle">التفاصيل والمكرر والمؤقت وما لا ينبغي تحويله إلى خدمات: <bdi dir="ltr">${e(data.source_audit.report_file)}</bdi></p>
      </section>`:'';
    return `<section class="panel panel-body vn-head">
      <div class="operation-actions">${button('search_forms','','بحث بالاسم أو الرمز أو الإدارة أو البند')}${active?`<a class="btn outline small" href="#forms">إلغاء الترشيح</a>`:''}</div>
      ${active?`<p>الترشيح الحالي: ${e(active)}</p>`:''}
      <nav aria-label="ترشيح الكتالوج"><p class="subtle">بالإدارة: ${departmentLinks}</p><p class="subtle">بالبند: ${stepLinks||'—'}</p></nav>
      <details class="rq-help"><summary>كيف تشتغل النماذج هنا؟</summary><p class="measure">${e(data.note)}</p></details></section>
      <section class="vn-board"><div class="vn-tiles">
        ${ui.tile(data.counts.definitions,'نموذج في الكتالوج')}
        ${ui.tile(data.counts.accepted,'تعريف مقبول',data.counts.accepted?'is-ok':'')}
        ${ui.tile(data.counts.drafts,'مسودة تنتظر مالكها',data.counts.drafts?'is-due':'')}
        ${ui.tile(data.counts.open,'نسخة مفتوحة',data.counts.open?'is-due':'')}</div></section>
      ${sourceAudit}
      ${awaiting.length?`<section class="vn-group"><h2>ينتظر قرارك <span>${e(awaiting.length)}</span></h2><ul class="vn-list">${awaiting.map(x=>ui.row({title:x.title,href:`#forms/${x.id}`,tone:'is-decision',meta:x.actions.map(a=>waitingVerb[a]??a).join('، ')})).join('')}</ul></section>`:''}
      <section class="vn-group"><h2>النماذج المعبّأة <span>${e(instances.length)}</span></h2>
        ${instances.length?`<ul class="vn-list">${instances.map(x=>instanceRow(x,data,button,e,data.focus)).join('')}</ul>`
          :ui.empty('ما فيه نماذج معبّأة تشوفها الحين','تبدأ من «تعبئة النموذج» عند أي نموذج مقبول في الكتالوج تحت — والنموذج ما يتعبّى قبل ما يقبل تعريفه مالكه.')}</section>
      <section class="vn-group"><h2>كتالوج النماذج <span>${e(definitions.length)}</span></h2>
        ${byDepartment||ui.empty('ما فيه نموذج يطابق الترشيح','جرّب إدارة أو بند ثاني، أو «إلغاء الترشيح».')}</section>
      ${sources}`;
  },
  form(action,id,data){
    if(action==='search_forms')return {title:'بحث في كتالوج النماذج',submit:'بحث',endpoint:'/forms/search',
      fields:[field('q','الاسم أو الرمز','text',{required:false,hint:'مثل: استلام المشروع، أو PR-02، أو FRM-003، أو MOD-01 (رمز مكرر يعيد كل ما يطابقه).'}),
        field('department','الإدارة','select',{required:false,options:[{value:'',label:'كل الإدارات'},...(data.departments||[]).map(d=>({value:d.code,label:d.name}))]}),
        field('step','البند (01–24)','number',{required:false,min:1,max:24})],
      toPayload:v=>({q:v.q||'',department:v.department||'',step:v.step||''}),
      after:(saved,e)=>({title:`نتائج البحث (${saved.definitions.length})`,html:`
        ${saved.alias.matches.length?`<p class="subtle">بالاسم البديل «${e(saved.alias.alias)}»: ${saved.alias.matches.map(m=>`${e(m.title)} (<bdi dir="ltr">${e(m.form_key)}</bdi>)`).join('، ')}${saved.alias.ambiguous?` — ${e(saved.alias.note||'رمز مكرر؛ المعرّف الداخلي هو المرجع')}`:''}</p>`:''}
        <ul class="vn-list">${saved.definitions.map(d=>`<li><strong>${e(d.title)} · <bdi dir="ltr">${e(d.form_key)}</bdi></strong>
          <span>${e(d.department_name)} · البند ${e(String(d.step_no??'—').padStart(2,'0'))} · ${e(d.mandate)} · ${e(d.status_name)}</span>
          <small class="subtle">${d.aliases.map(a=>e(a.alias)).join(' · ')}</small>
          <small><a href="#forms?q=${encodeURIComponent(d.form_key)}">فتحه في الكتالوج</a></small></li>`).join('')||'<li class="subtle">ما فيه نتائج — جرّب جزء من الاسم أو الرمز.</li>'}</ul>`})};

    if(action==='accept_definition'){
      const definition=(data.definitions||[]).find(x=>x.form_key===id&&x.status==='draft');
      guard(definition&&data.can_accept);
      return {title:`قبول تعريف — ${definition.title}`,submit:'أقبل هذا التعريف',endpoint:`/forms/definitions/${id}/accept`,
        fields:[field('effective_from','تاريخ السريان','date'),
          field('note','إقرارك بقبول التعريف','textarea',{hint:`بقبولك يصير هالتعريف ساري وينفتح للتعبئة. المصدر: ${definition.source_note}. اللي جهّز التعريف ما يقبله، والمقبول ما يتعدّل — تعديله نسخة جديدة.`})],
        toPayload:v=>({version:definition.row_version,effective_from:v.effective_from,note:v.note})};
    }

    if(action==='fill_form'){
      const definition=(data.definitions||[]).find(x=>x.form_key===id&&x.fillable);
      guard(definition&&data.can_fill);
      const subjects=(definition.subject_kinds||['project']).map(k=>({value:k,label:data.subject_names[k]??k}));
      return {title:`تعبئة — ${definition.title}`,submit:'حفظ مسودة النموذج',endpoint:'/forms/instances',idempotent:true,
        fields:[field('title','عنوان هالنسخة','text',{hint:'اسم يميّزها في القائمة، مثل اسم المشروع أو الحملة.'}),
          field('subject_kind','يرتبط بـ','select',{options:subjects}),
          field('subject_id','معرّف السجل المرتبط','text',{hint:'معرّف المشروع (أو الطلب أو الفرصة أو المورد). المشروع لازم تكون عضو فيه.'}),
          ...fillFields(definition)],
        live:(values,e)=>liveCheck(definition,values,e),
        toPayload:v=>({form_key:definition.form_key,title:v.title,subject_kind:v.subject_kind,subject_id:v.subject_id,
          payload:payloadOf(definition,v)})};
    }

    const instance=(data.instances||[]).find(x=>x.id===id);
    guard(instance);
    if(action==='edit_form'){
      guard(instance.actions.includes('edit'));
      const definition={sections:instance.sections,gates:(data.definitions||[]).find(d=>d.form_key===instance.form_key)?.gates??[]};
      return {title:`تعديل مسودة — ${instance.definition_title}`,submit:'حفظ المسودة',method:'PATCH',endpoint:`/forms/instances/${id}`,
        fields:[field('title','عنوان هالنسخة','text',{value:instance.title}),...fillFields(definition,instance.payload)],
        live:(values,e)=>liveCheck(definition,values,e),
        toPayload:v=>({version:instance.row_version,title:v.title,payload:payloadOf(definition,v)})};
    }
    if(action==='submit_form'){
      guard(instance.actions.includes('submit'));
      return {title:`تقديم وإقرار — ${instance.definition_title}`,submit:'أقدّمه وأقرّ بمحتواه',endpoint:`/forms/instances/${id}/submit`,
        fields:[field('confirm',`بتقديمك ينسجّل اسمك ووقتك ونسخة النموذج بصفتك «${instance.author_role}». هذا هو الإقرار الإلكتروني بدل التوقيع.`,'checkbox')],
        toPayload:()=>({version:instance.row_version})};
    }
    if(action==='claim_review'){
      guard(instance.actions.includes('claim_review'));
      return {title:`بدء المراجعة — ${instance.definition_title}`,submit:'أبدأ المراجعة',endpoint:`/forms/instances/${id}/claim_review`,
        fields:[field('confirm','أبدأ مراجعة هالنسخة، ويطلع ذلك لصاحبها.','checkbox')],toPayload:()=>({version:instance.row_version})};
    }
    if(action==='approve_form'){
      guard(instance.actions.includes('approve'));
      const open=instance.open_gates.map(g=>g.message).join(' ');
      return {title:`اعتماد — ${instance.definition_title}`,submit:'أعتمد',endpoint:`/forms/instances/${id}/approve`,
        fields:[field('note','ملاحظة القرار','textarea',{required:false,
          hint:`باعتمادك ينسجّل اسمك ودورك ووقتك ونسخة النموذج في سجل ما يتعدّل.${open?` شرط المصدر يمنع الاعتماد الحين: ${open}`:''}`})],
        toPayload:v=>({version:instance.row_version,note:v.note||''})};
    }
    const settings={cancel_form:['cancel','إلغاء النموذج','سبب الإلغاء'],mark_incomplete:['mark_incomplete','تعليمه ناقصًا','ما الناقص ومن يورّده'],
      return_form:['return','إعادة للتعديل','ما الذي يُصحَّح ومن يصححه'],reject_form:['reject','رفض','سبب الرفض'],
      revise_form:['revise','فتح نسخة جديدة','سبب فتح نسخة جديدة']}[action];
    guard(settings&&instance.actions.includes(settings[0]));
    return {title:`${settings[1]} — ${instance.definition_title}`,submit:settings[1],endpoint:`/forms/instances/${id}/${settings[0]}`,
      fields:[field('note',settings[2],'textarea',{hint:action==='revise_form'
        ?'النسخة الحالية تبقى بكل اعتماداتها، وتنفتح نسخة جديدة. إذا قدّمتها ينعاد بس الاعتماد اللي مسّه التعديل.'
        :'ينكتب نصه في سجل النسخة وفي سجل التدقيق.'})],
      toPayload:v=>({version:instance.row_version,note:v.note})};
  }
};
