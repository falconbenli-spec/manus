// «تعريفات الصفحات» (ترحيل 123): ما يحكم كل صفحة مشاركة الآن — نسختها السارية، وسلامة سلسلة نسخها، ومسودتها، وما ينتظر ناشرًا
// ثانيًا — والنقل بين بيئتين بتقرير فرق قبل التطبيق، وسجل «جرّب كمستخدم». التعديل نفسه لا يجري هنا: يجري فوق الصفحة من
// «تعديل هذه الصفحة»، وهذه الشاشة تفتح الدرج نفسه على الكيان المختار.
// كل ما يُرسم من العدّة (ctx.ui، وkit(e) حيث لا يصل سياق الشاشة: تقرير الفرق داخل الحوار)؛ لا مكوّن محلي ولا عبارة حالة هنا.
import { kit } from './kit.mjs';
const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
const guard=ok=>{if(!ok)throw Error('الإجراء غير متاح لحسابك الآن. أعد تحميل الصفحة لترى حالته.');};
// أسماء بنود الفرق كما يكتبها الخادم (app/definitions.mjs diffSpecs). يقرؤها محرّر الصفحة من هنا أيضًا.
export const KIND_NAMES=Object.freeze({entity_label:'اسم الكيان',field_added:'حقل جديد',field_label:'تسمية حقل',field_help:'نص مساعدة',field_required_on:'إلزام حقل',field_required_off:'رفع إلزام',field_retired:'سحب حقل',field_restored:'إعادة حقل',
  field_rule_tightened:'تشديد قاعدة تحقق',field_rule_loosened:'تخفيف قاعدة تحقق',field_condition:'شرط ظهور',field_mask_narrowed:'تضييق من يرى',field_mask_widened:'توسيع من يرى',field_edit_narrowed:'تضييق من يعدّل',
  field_edit_widened:'توسيع من يعدّل',field_searchable:'قابلية البحث',field_tracked_on:'تتبّع التغيّر',field_tracked_off:'إيقاف التتبّع',field_default:'قيمة مقترحة',field_removed:'حذف حقل',field_type:'نوع حقل',
  option_added:'خيار جديد',option_retired:'سحب خيار',option_restored:'إعادة خيار',option_label:'اسم خيار أو لونه',option_removed:'حذف خيار',system_label:'تسمية حقل نظامي',system_mask_narrowed:'تضييق من يرى رقمًا',
  system_mask_widened:'توسيع من يرى رقمًا',layout_changed:'مواضع الحقول',list_changed:'أعمدة القائمة ومرشحاتها',status_label:'عبارة حالة',require_added:'إلزام عند انتقال',require_removed:'رفع إلزام عند انتقال',term_changed:'مصطلح'});
const CLASS_TONES={additive:'',tightening:'is-ok',loosening:'is-due'};
// تقرير الفرق كما يعيده فحص الاستيراد: لكل كيان ما سيتغير مصنَّفًا، وما يمنع التطبيق، وكم سجلًا هنا يحمل خيارًا تسحبه الحزمة.
function reportHtml(report,e){
  const ui=kit(e),entities=(report.entities??[]).map(x=>ui.card({code:x.entity_key,title:x.label,open:x.state!=='unchanged',
    meta:x.state==='blocked'?'ممنوع تطبيقه':x.state==='unchanged'?'مطابق للمنشور هنا':`${x.change_class_name} — من النسخة ${x.source_version} في المصدر على النسخة ${x.target_version} هنا`,
    body:`<div class="vn-body">${x.blocking.length?`<ul class="vn-list">${x.blocking.map(b=>ui.row({title:b.text,tone:'is-late'})).join('')}</ul>`:''}
      ${x.diff.length?`<ul class="vn-list">${x.diff.map(i=>ui.row({title:`${KIND_NAMES[i.kind]??i.kind}: ${i.label}`,meta:i.class==='loosening'?'تخفيف ضابط':i.class==='tightening'?'تشديد ضابط':'إضافة',tone:CLASS_TONES[i.class]??''})).join('')}</ul>`:''}
      ${(x.options_in_use??[]).filter(o=>o.records>0).map(o=>`<p class="vn-alert is-warn">${e(`«${o.label}» خيار تسحبه الحزمة وتحمله ${o.records} سجلات هنا. السحب ما يمحي القيمة: تبقى مقروءة وما تنعرض للاختيار.`)}</p>`).join('')}</div>`})).join('');
  return `<p class="${report.applicable?'notice':'vn-alert is-warn'}">${e(report.note)}</p>${report.second_person_required?'<p class="vn-alert is-due">في الحزمة تخفيف ضابط: يطبّقها شخص غير اللي فحصها.</p>':''}${entities}`;
}
export const definitionsUI={
  title:'تعريفات الصفحات',title_en:'Page definitions',
  description:'اللي يحكم كل صفحة مشاركة الحين: نسخة تعريفها السارية وسجل نسخها، ومسودتها واللي ينتظر ناشرًا ثانيًا، والنقل بين بيئتين بتقرير فرق قبل التطبيق، وسجل «جرّب كمستخدم». الكود هو الأصل، والسجل يحفظ اللي غيّره إنسان بس.',
  load:api=>api('/definitions'),
  render(data,{e,button,date,ui}){
    const pages=data.entities.map(x=>ui.card({code:x.key,title:x.label,meta:`${x.state_name}${x.published_at?` · ${date(x.published_at)}`:''} · ${x.custom_fields} حقل مخصّص${x.views.length?` · الشاشة: ${x.views.join('، ')}`:''}`,open:!!x.draft,
      body:`<div class="vn-body"><p class="${x.chain_intact?'subtle':'vn-alert is-block'}">${x.chain_intact?'سلسلة بصمات النسخ سليمة: كل نسخة تحمل بصمة سابقتها.':'سلسلة بصمات النسخ مكسورة: صفٌّ انحطّ أو تبدّل برّا المنصة. بلّغ مسؤول المنصة قبل أي نشر.'}</p>
        ${x.draft?`<p class="vn-alert is-due">${e(`مسودة باسم ${x.draft.prepared_by_name}${x.draft.submitted_at?` — تسلّمت للنشر في ${date(x.draft.submitted_at)}`:' — ما تسلّمت للحين'}`)}</p>`:''}
        <div class="operation-actions"><button type="button" class="btn outline small" data-action="page-editor" data-entity="${e(x.key)}" data-id="${e(x.key)}">${x.draft&&!x.draft.mine&&data.can.publish?'فتح المحرّر لمراجعتها ونشرها':'فتح المحرّر والنسخ'}</button></div></div>`})).join('');
    const awaiting=data.awaiting_me.map(i=>ui.row({title:i.title,meta:`${i.diff_count} تغيير · سُلّمت ${date(i.created_at)}`,tone:'is-due',
      html:`<div class="operation-actions"><button type="button" class="btn outline small" data-action="page-editor" data-entity="${e(i.entity_key)}" data-id="${e(i.entity_key)}">مراجعة ونشر</button></div>`})).join('');
    // كل فحص بطاقة تحمل تقرير فرقه كما حُفظ عند الفحص: ما يُعرض هنا هو ما يُطبَّق، والخادم يرفض التطبيق إن تغيّر المنشور بعده.
    const imports=(data.imports??[]).map(i=>ui.card({code:i.status_name,title:i.source_label||'حزمة بلا وصف',open:i.status==='checked',
      // الحزمة المنتظرة تسمّي فاحصها (تخفيف الضابط يطبّقه غيره)؛ المطبَّقة تقول متى طُبّقت، ومن فعل في سجل التدقيق.
      meta:`${i.worst_class_name??''} · ${i.applied_by_name?`طُبّقت ${date(i.applied_at)}`:`فحصها ${i.checked_by_name} ${date(i.checked_at)}`}`,
      body:`<div class="vn-body">${reportHtml(i.report,e)}${i.status==='checked'?`<div class="operation-actions">${i.can_apply?button('apply_import',i.id,'تطبيق على هذه البيئة'):''}${button('abandon_import',i.id,'ترك الفحص')}</div>${i.can_apply?'':'<p class="subtle">التطبيق لحامل تصريح نشر التعريفات، والحزمة اللي تخفّف ضابطًا يطبّقها غير اللي فحصها.</p>'}`:''}</div>`})).join('');
    const trial=data.view_as;
    const runs=(trial?.runs??[]).map(r=>`<tr><td>${e(r.actor_name)}</td><td>${e(r.persona_name)}</td><td>${e(r.reason)}</td><td>${e(date(r.started_at))}</td><td>${e(r.end_name)}</td><td>${e(r.screens.map(s=>s.replace('/api/','')).join('، ')||'—')}</td></tr>`);
    return `<section class="panel panel-body vn-head"><p>التعديل يصير فوق الصفحة نفسها من زر «تعديل هذه الصفحة»، وهنا النسخ والنقل والسجل.</p>
        <p class="subtle">${e(data.limits.layout)}</p><p class="subtle">${e(data.limits.translation)}</p>
        <div class="vn-tiles">${ui.tile(data.entities.filter(x=>x.version>0).length,'صفحة لها تعريف منشور')}${ui.tile(data.entities.filter(x=>x.draft).length,'مسودة مفتوحة',data.entities.some(x=>x.draft)?'is-due':'')}${ui.tile(data.awaiting_me.length,'تنتظر نشرك',data.awaiting_me.length?'is-late':'')}</div></section>
      ${awaiting?`<section class="vn-group"><h2>بانتظار نشري <span>${data.awaiting_me.length}</span></h2><ul class="vn-list">${awaiting}</ul></section>`:''}
      <section class="vn-group"><h2>الصفحات المشاركة <span>${data.entities.length}</span></h2>${pages}</section>
      <section class="panel panel-body"><h2>النقل بين بيئتين</h2><p class="subtle">الحزمة تحمل التعريفات المنشورة بس: ما فيها سجلات ولا حسابات ولا تصاريح. الفحص ما يغيّر شي؛ يعرض الفرق على المنشور هنا، وبعدها يطبّقه حامل النشر دفعة وحدة.</p>
        <div class="operation-actions">${data.can.configure?`<a class="btn outline small" href="/api/definitions/export" download>تصدير التعريفات المنشورة</a>${button('check_import','','فحص حزمة واردة')}`:''}</div>
        ${imports||ui.empty('ما فيه حزمة انفحصت هنا للحين','صدّر من بيئة، وبعدها افحص الملف هنا وتشوف تقرير الفرق قبل أي تطبيق.')}</section>
      ${trial?`<section class="panel panel-body"><h2>سجل «جرّب كمستخدم»</h2><p class="subtle">تنزيل تصاريح بهوية صاحبها وقراءة بس، مو دخول في حساب زميل. كل تجربة بسببها واللي انفتح فيها ونهايتها، وبدايتها ونهايتها حدثان في سلسلة التدقيق. تنتهي من نفسها بعد ${e(trial.ttl_minutes)} دقيقة.${trial.scope==='all'?' هذي القائمة فيها تجارب الكل.':''}</p>
        ${trial.can_start?'<div class="operation-actions"><button type="button" class="btn outline small" data-action="view-as">جرّب كمستخدم…</button></div>':''}
        ${ui.table({head:['صاحب التجربة','الدور المجرَّب','السبب','بدأت','انتهت','اللي انفتح'],rows:runs,empty:{title:'ما فيه تجارب مسجّلة للحين',body:'التجربة تبدأ من هنا أو من «الحساب» في الفهرس.'}})}</section>`:''}`;
  },
  form(action,id,data){
    if(action==='check_import'){guard(data.can.configure);return {title:'فحص حزمة تعريفات',submit:'افحص ولا تطبّق',endpoint:'/definitions/import/check',fields:[
      field('source_label','من أين جاءت الحزمة','text',{maxLength:120,hint:'مثل: بيئة التجربة، 21 سبتمبر.'}),
      field('bundle_text','محتوى ملف الحزمة (JSON)','textarea',{maxLength:2000000,hint:'افتح الملف المصدَّر وانسخ محتواه كله هنا. لا يُطبَّق شيء في هذه الخطوة.'})],
      toPayload(v){let bundle;try{bundle=JSON.parse(v.bundle_text);}catch{throw new Error('محتوى الحزمة ليس ملف تعريفات صالحًا. انسخ الملف المصدَّر كاملًا كما هو، من أول قوس إلى آخره.');}return {bundle,source_label:v.source_label};},
      after:(saved,e)=>({title:'تقرير الفرق — لم يُطبَّق شيء',html:reportHtml(saved,e)})};}
    const row=(data.imports??[]).find(i=>i.id===id);guard(row&&row.status==='checked');
    if(action==='apply_import'){guard(row.can_apply);return {title:`تطبيق الحزمة — ${row.source_label||''}`,submit:'طبّق على هذه البيئة',endpoint:`/definitions/import/${id}/apply`,
      fields:[field('note','سبب التطبيق','textarea',{hint:'من أين جاءت الحزمة ولماذا تُطبَّق. تُنشر كل كياناتها في معاملة واحدة أو لا يُنشر شيء.'})],toPayload:v=>({note:v.note})};}
    if(action==='abandon_import')return {title:'ترك فحص الحزمة',submit:'اترك الفحص',endpoint:`/definitions/import/${id}/abandon`,fields:[],toPayload:()=>({})};
    guard(false);
  }
};
