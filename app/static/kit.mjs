// عدّة المكوّنات (م0 «السور»): tile وrow وcard وempty وtable وpageHead وstatusBadge وrefusal في مكان واحد.
// تُحقن في كل شاشة باسم ui من موضع واحد في app.mjs (module.render(loaded,{…,ui}))، فتتبنّاها الشاشة بإضافة ui إلى ما تفكّه
// من وسيطها الثاني، بلا سطر استيراد. وحدة نقية بلا DOM: تُرسم تحت Node في الاختبارات كما تُرسم في المتصفح.
// القاعدة: ما تصدره هنا مطابق بالحرف لأوسع نسخة محلية انتشارًا، فترحيل شاشة إلى العدّة لا يغيّر بايتًا من HTML
// (tests/kit.test.mjs يثبت المطابقة، وtests/ui-golden.test.mjs يثبت أن الشاشة لم تتغير). ومسنّنة scripts/check.mjs تمنع
// تعريفًا محليًا جديدًا لأي من هذه الأسماء.
import { statusName,statusTone,canonicalStatus } from './vocabulary.mjs';
import { icon } from './hr-design.mjs';
// أيقونة الصف تُستنتج من عنوانه (الأخص أولًا)، ولونه بصمة العنوان على لوحة iOS العشرية — ثابتان لكل عنوان.
const ROW_GLYPH_RULES=[
 ['اجاز|إجاز','calendar'],['دوام|حضور|انصراف|بصم|استئذان','clock'],['راتب|رواتب|أجر|اجور','banknote'],
 ['تعريف|شهاد','signed'],['عقد|اتفاقي','signed'],['خطاب|رسال|صادر|بريد','envelope'],
 ['سفر|انتداب','route'],['تدريب|دورة','book'],['توظيف|تعيين|مرشح','badge'],
 ['استقال|اخلاء|إخلاء','exit'],['تأمين|صحي','heart'],['سلفة|قرض','coins'],
 ['مصروف|عهدة|صرف','receipt'],['فاتور|سداد|دفع|تحصيل|مستحق','receipt'],['ميزاني','pie'],
 ['جهاز|حاسب|عتاد','cpu'],['صلاحي|وصول','key'],['دعم|عطل|مشكلة','gear'],['صيانة','gear'],
 ['قاعة|اجتماع','people'],['زائر|زيارة','person'],['قرطاسي|مستلزم','clipboard'],
 ['شراء|مشتر|مورد','cart'],['تصميم|هوية|شعار','sparkles'],['محتوى|كتابة|ترجم','note'],
 ['تصوير|فيديو|مونتاج|انتاج|إنتاج','film'],['معدات|كاميرا','camera'],['فعالية|حمل','megaphone'],
 ['تقرير|تحليل|لوحة|مؤشر','chart'],['مشروع|مهمة|مهام','briefcase'],['عميل|عملاء|حساب عميل','people'],
 ['شكوى|بلاغ|مخالف|تظلم','warning'],['ترخيص|تصريح|اقامة|إقامة','shield'],['قانون|امتثال|خصوصي','scale'],
 ['استبيان|تقييم','checklist'],['اعلان|إعلان|تعميم','megaphone'],['سياسة|لائحة','book']
].map(([p,n])=>[new RegExp(p),n]);
const rowGlyphName=title=>{const t=String(title??'');for(const [re,n] of ROW_GLYPH_RULES)if(re.test(t))return n;return 'doc';};
const rowTint=title=>{let h=0;for(const ch of String(title??''))h=(h*31+ch.codePointAt(0))%9973;return 'qa-c'+(h%10+1);};
const rowDisc=title=>`<span class="hm-disc row-disc ${rowTint(title)}" aria-hidden="true">${icon(rowGlyphName(title))}</span>`;

const plain=ar=>ar;
// سجل التعريفات (ترحيل 123): الوسيط الثالث اختياري، وافتراضه لا يفعل شيئًا — kit(e) وkit(e,tr) يرسمان البايتات نفسها كما كانا،
// فلا بصمة ذهبية تتحرك ولا اختبار يُعدَّل. app.mjs وحدها تمرّر الوصلة الحية (definitions-client.mjs defsFor): التسميات المتجاوَزة
// وعبارات الحالات والحقول المخصّصة تصل كل شاشة من هنا، والتجاوز **بيانات** تُقرأ عند الرسم؛ القاموس يبقى منزل العبارات الافتراضية الوحيد.
const NONE=Object.freeze({text:s=>s,label:(entity,key,fallback)=>fallback,status:()=>null,term:()=>null,entity:()=>null,preview:()=>false,remember:()=>{}});
// سمة data-cf-<مفتاح> تُقرأ من dataset باسم مُجمَّل (cf-lead_source ← cfLead_source)؛ مرشّح القائمة يحمل الاسم نفسه في data-filter-key.
const datasetKey=key=>`cf-${key}`.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
// e: دالة التهريب التي تمررها app.mjs. tr(ar,en): مترجم الواجهة، ويُقرأ عند الرسم لا عند البناء، فتبديل اللغة لا يحتاج عدّة جديدة.
export function kit(e,tr=plain,defs=NONE){
  if(typeof e!=='function')throw new TypeError('kit(e,tr): دالة التهريب e مطلوبة، فلا يُرسم نص بلا تهريب');
  const lang=()=>tr('ar','en'),d=defs===NONE?NONE:{...NONE,...defs};

  // بلاطة الرقم. مطابقة بالحرف للنسخة المنسوخة ستين مرة، بما فيها المسافة بعد vn-tile حين لا لون، ولون غير مهرَّب لأنه
  // اسم صنف يكتبه الكود لا المستخدم (is-late، is-due، is-ok، is-old). مع href تصير رابطًا يقود الرقم إلى قائمته.
  const tile=(value,label,tone='',href='')=>href
    ?`<a class="vn-tile ${tone}" href="${e(href)}"><strong>${e(value)}</strong><span>${e(d.text(label))}</span></a>`
    :`<div class="vn-tile ${tone}"><strong>${e(value)}</strong><span>${e(d.text(label))}</span></div>`;

  // صف في قائمة vn-list: عنوان (رابط إن كان للسجل شاشة) ثم سطر وصف. meta نص يُهرَّب؛ وما احتاج ترميزًا (شارة، أزرار)
  // يمرّ في html جاهزًا ومهرَّبًا من صاحبه. الهيكل هيكل صفوف الرئيسية، وهو الأوسع انتشارًا بين الاثنين والعشرين تعريفًا.
  const row=({title,meta='',tone='',href='',html='',glyph=true})=>
    `<li class="${tone}${glyph?' has-disc':''}">${glyph?rowDisc(title):''}${href?`<a href="${e(href)}"><strong>${e(title)}</strong></a>`:`<strong>${e(title)}</strong>`}${meta!==''?`<span>${e(meta)}</span>`:''}${html}</li>`;

  // بطاقة قابلة للطي vn-card: رمز قصير، ثم اسم وسطر وصف، ثم جسم تكتبه الشاشة. الهيكل هيكل النسخ الأربع عشرة، والجسم وحده يختلف.
  // code نص يُهرَّب؛ رمز يحتاج اتجاهًا (<bdi>) يمرّ في codeHtml.
  const card=({code='',codeHtml='',title,meta='',open=false,body='',glyph=true})=>
    `<details class="vn-card"${open?' open':''}><summary>${glyph?rowDisc(title):''}<span class="vn-code">${codeHtml||e(code)}</span><span class="vn-name"><strong>${e(title)}</strong>${meta!==''?`<small>${e(meta)}</small>`:''}</span></summary>${body}</details>`;

  // الحالة الفارغة: مطابقة بالحرف لـempty في app.mjs، فشاشة بلا سجلات تقول ذلك بجملة لا بفراغ.
  const empty=(title,body='')=>`<div class="empty"><div class="empty-symbol" aria-hidden="true">⌑</div><strong>${e(title)}</strong><p>${e(body)}</p></div>`;

  // جدول حقيقي: الرأس نصوص تُهرَّب، والصفوف <tr> جاهزة من الشاشة. الهيكل هو ما يقرؤه محسّن جداول الجوال في signature.mjs
  // (يأخذ data-label من <th>)، فلا يتغير. وبلا صفوف لا يُرسم رأس فوق فراغ: تُرسم الحالة الفارغة وحدها.
  const table=({head=[],rows=[],empty:none}={})=>{
    if(!rows.length){
      const state=typeof none==='string'?{title:none}:none??{};
      return empty(state.title??tr('لا سجلات هنا بعد','Nothing here yet'),state.body??'');
    }
    return `<div class="table-wrap"><table><thead><tr>${head.map(h=>`<th>${e(d.text(h))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  };

  // رأس الشاشة: مطابق بالحرف لـpageHead في app.mjs. action ترميز جاهز (زر الشاشة).
  const pageHead=(title,description,action='')=>`<div class="page-head"><div><h1>${e(title)}</h1>${description?`<p>${e(description)}</p>`:''}</div>${action?`<div class="page-actions">${action}</div>`:''}</div>`;

  // شارة الحالة من القاموس الواحد: مطابقة بالحرف لـbadge في app.mjs. مع module تُطابَق حالة الوحدة على إحدى الثماني
  // وتبقى عبارة الوحدة بجوارها («بانتظار الاعتماد» ثم «بانتظار المدير»)، فلا تضيع معلومة الوحدة ولا تتعدد عبارة الحالة.
  // التجاوز المنشور يُسأل أولًا (مفتاح القاموس status.request.<حالة> أو status.<وحدة>.<حالة>، أو حالة كيان مشارك)، ثم القاموس،
  // ثم المفتاح الخام. مع entity تُرسم شارة كيان من سجل التعريفات: العبارة من الخادم (name) ما لم تتجاوزها مسودة تُعاين الآن.
  const statusBadge=(status,{module,entity,name}={})=>{
    if(entity){const o=d.status(entity,status);return `<span class="badge${o?.tone?` ${e(o.tone)}`:''}">${e(o?.label??name??status)}</span>`;}
    if(!module)return `<span class="badge ${e(statusTone(status)||status)}">${e(d.term(`status.request.${status}`)??statusName(status,lang()))}</span>`;
    const c=canonicalStatus(module,status,lang()),canonicalName=d.term(`status.request.${c.status}`)??c.name,phrase=d.term(`status.${module}.${status}`)??c.module_phrase;
    return `<span class="badge ${e(statusTone(c.status)||c.status)}">${e(canonicalName)}</span>${phrase&&phrase!==canonicalName?` <small class="subtle">${e(phrase)}</small>`:''}`;
  };

  // الرفض المكتوب (app/refusal.mjs): ما الذي رُفض، وما الناقص ولماذا وعند من، وما الخطوة التالية. يقبل خطأ api() كما هو
  // (error.details.refusal)، أو الكائن نفسه، أو نصًا وحده لما لم يُرحَّل بعد من رسائل الرفض، فيبقى شكله شكل .error القائم.
  const refusal=problem=>{
    const r=problem?.details?.refusal??(problem&&typeof problem==='object'&&'what' in problem?problem:null);
    // اللهجة: «ما مشى الطلب» بدل «تعذر إكمال العملية». هذه جملة المنصة عن نفسها حين لا يصلها رفض مكتوب، لا نص نظام،
    // فتُقال كما يقولها زميل. وما حولها («عند»، «الخطوة التالية»، «فتح») مثبَّت بحرفه في tests/kit.test.mjs فبقي.
    if(!r)return `<div class="error" role="alert">${e(typeof problem==='string'?problem:problem?.message??tr('ما مشى الطلب — جرّب بعد شوي','The request failed'))}</div>`;
    const missing=(r.missing??[]).map(x=>`<li><strong>${e(x.document)}</strong><span>${x.why?`${e(x.why)} · `:''}${tr('عند','With')}: ${e(x.owner)}</span></li>`).join('');
    const next=r.next||r.link?`<p>${r.next?`${tr('الخطوة التالية','Next step')}: ${e(r.next)}`:''}${r.link?` <a class="btn outline small" href="${e(r.link)}">${tr('فتح','Open')}</a>`:''}</p>`:'';
    return `<div class="vn-alert is-block" role="alert"><strong>${e(r.what)}</strong>${missing?`<ul class="vn-list">${missing}</ul>`:''}${next}</div>`;
  };

  /* ───── سجل التعريفات: التسمية، والحقول المخصّصة في موضعها، والقائمة بأعمدتها ومرشحاتها ───── */
  // تسمية حقل نظامي: التجاوز المنشور (أو اسم الكيان المرجعي الموروث: «العميل» ← «الجهة») ثم ما كتبته الشاشة.
  const label=(entity,fieldKey,fallback)=>d.text(d.label(entity,fieldKey,fallback));

  // قيمة حقل مخصّص كما تُقرأ: شارة بلون الخيار، أو النص، أو «غير متاح» بسببه ومن يسدّه — لا فراغ ولا صفر.
  const missingText=()=>tr('غير متاح','Not available');
  const valueHtml=item=>item?.kind==='recorded'
    ?(item.tone?`<span class="badge ${e(item.tone)}">${e(item.text)}</span>`:e(item.text))
    :`<span class="cf-missing">${e(missingText())}</span>${item?.reason?`<small>${e(item.reason)}${item.needed?` — ${e(item.needed)}`:''}</small>`:''}`;
  // بنود الموضع. في الوضع العادي تأتي من الخادم كما أسقطها (record.custom)؛ وفي معاينة مسودة يقودها تعريف المسودة، فالحقل الذي لم
  // يُنشر بعد يظهر في موضعه «غير متاح» — الخادم لا يقبل له قيمة قبل النشر. الحقول غير الموضوعة في موضع تقع في «body».
  const itemsFor=(entity,record,slot)=>{
    const own=record?.custom??[],info=d.preview()?d.entity(entity):null;
    if(!info)return own.filter(i=>(i.slot??'body')===slot);
    const placed=new Set(Object.values(info.slots??{}).flat()),keys=slot==='body'?[...(info.slots?.body??[]),...info.fields.filter(f=>!placed.has(f.key)).map(f=>f.key)]:info.slots?.[slot]??[];
    return keys.map(key=>{
      const field=info.fields.find(f=>f.key===key),item=own.find(i=>i.key===key);
      if(!field||(field.retired&&!item))return null;
      return item?{...item,label:field.label.ar,label_en:field.label.en??''}
        :{key,label:field.label.ar,label_en:field.label.en??'',kind:'unavailable',reason:tr('حقل في مسودة ما اننشرت لين الحين','A field in an unpublished draft'),needed:'',editable:false};
    }).filter(Boolean);
  };
  const fields=(entity,record,slot='body')=>{
    d.remember(entity,record);
    const items=itemsFor(entity,record,slot),editable=slot==='body'&&(record?.custom??[]).some(i=>i.editable);
    if(!items.length&&!editable)return '';
    return `<dl class="detail-data cf-fields cf-${e(slot)}">${items.map(i=>`<div class="cf-item${i.kind==='recorded'?'':' is-missing'}" data-cf="${e(i.key)}"><dt>${e(tr(i.label,i.label_en||i.label))}</dt><dd>${valueHtml(i)}</dd></div>`).join('')}</dl>${
      editable?`<div class="operation-actions"><button type="button" class="btn outline small" data-action="custom-fields" data-entity="${e(entity)}" data-id="${e(record.id)}">${tr('تعديل الحقول المخصّصة','Edit custom fields')}</button></div>`:''}`;
  };

  // أعمدة القائمة المخصّصة: من اللقطة حين تصل (فتُعاين المسودة)، وإلا مما أسقطه الخادم لهذا القارئ (custom_columns). العمود المحجوب لا يصل أصلًا.
  const customColumns=(entity,custom)=>{
    const info=d.entity(entity);
    if(!info)return (custom??[]).map(c=>({key:c.field_key,label:tr(c.label,c.label_en||c.label),filter:!!c.filter&&c.type==='select',options:(c.options??[]).filter(o=>!o.retired).map(o=>({value:o.value,label:tr(o.label,o.label_en||o.label)}))}));
    const filterable=new Set(info.list?.filters??[]);
    return (info.list?.columns??[]).map(key=>info.fields.find(f=>f.key===key)).filter(Boolean).map(f=>({key:f.key,label:tr(f.label.ar,f.label.en||f.label.ar),filter:filterable.has(f.key)&&f.type==='select',
      options:(f.options??[]).filter(o=>!o.retired).map(o=>({value:o.value,label:tr(o.label.ar,o.label.en||o.label.ar)}))}));
  };
  // أدوات التصفية: بحث نصي ومرشّح لكل عمود اختيار. تحمل data-filter وdata-filter-key، فتعمل بها applyTableFilters القائمة في app.mjs كما هي.
  // والتصدير عام لكل كيان مشارك (GET /api/records/:entity/export.xlsx): أعمدة الشاشة ثم كل حقل مخصّص يراه هذا الحساب؛ العمود المحجوب ساقط من الملف.
  const filters=(entity,id,{custom,total=''}={})=>{
    const target='#'+id,columns=customColumns(entity,custom).filter(c=>c.filter);
    return `<div class="cf-filters"><label><span>${tr('دوّر في القائمة','Search the list')}</span><input type="search" data-filter="${e(target)}" autocomplete="off"></label>${
      columns.map(c=>`<label><span>${e(c.label)}</span><select data-filter="${e(target)}" data-filter-key="${e(datasetKey(c.key))}"><option value="">${tr('الكل','All')}</option>${c.options.map(o=>`<option value="${e(o.value)}">${e(o.label)}</option>`).join('')}</select></label>`).join('')
      }<small class="subtle">${tr('الظاهر','Shown')}: <span data-filter-count="${e(target)}">${e(total)}</span></small>
      <a class="btn outline small" href="/api/records/${e(entity)}/export.xlsx" download>${tr('نزّل القائمة','Export the list')}</a></div>`;
  };
  // القائمة: أعمدة الشاشة (نص يُهرَّب، أو html جاهز من صاحبه) ثم الأعمدة المخصّصة المنشورة. كل صف يحمل نصه للبحث وقيمة كل حقل اختيار للتصفية.
  const records=(entity,rows=[],{id,columns=[],custom,none}={})=>{
    const extra=customColumns(entity,custom),info=d.entity(entity),sort=info?.list?.sort??null;
    const cell=(row,key)=>(row.custom??[]).find(i=>i.key===key)??null;
    const sortText=row=>{if(!sort)return '';const item=cell(row,sort.field),column=columns.find(c=>c.key===sort.field);return item?.kind==='recorded'?String(item.text):column?String(column.value(row)??''):'';};
    const ordered=sort?[...rows].sort((a,b)=>sortText(a).localeCompare(sortText(b),'ar',{numeric:true})*(sort.direction==='desc'?-1:1)):rows;
    const body=ordered.map(row=>{
      const texts=[...columns.map(c=>String(c.value(row)??'')),...extra.map(c=>cell(row,c.key)?.kind==='recorded'?String(cell(row,c.key).text):'')];
      const marks=extra.map(c=>{const item=cell(row,c.key);return item?.kind==='recorded'&&typeof item.value==='string'?` data-cf-${e(c.key)}="${e(item.value)}"`:'';}).join('');
      return `<tr data-record="${e(row.id)}" data-filter-text="${e(texts.join(' '))}"${marks}>${columns.map(c=>`<td>${c.html?c.html(row):e(c.value(row)??'')}</td>`).join('')}${extra.map(c=>`<td>${valueHtml(cell(row,c.key)??{kind:'unavailable'})}</td>`).join('')}</tr>`;
    });
    return `<div class="cf-records" id="${e(id)}">${rows.length?filters(entity,id,{custom,total:rows.length}):''}${table({head:[...columns.map(c=>c.label),...extra.map(c=>c.label)],rows:body,empty:none})}</div>`;
  };

  return Object.freeze({tile,row,card,empty,table,pageHead,statusBadge,refusal,label,fields,records,filters});
}
