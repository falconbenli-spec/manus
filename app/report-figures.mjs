import { fail } from './auth.mjs';
import { dual } from './dates.mjs';

// الأولية الصادقة للتقارير: تعميم للحارس الذي وُلد في تقرير العميل (client-reports.mjs) ولقاعدة الصفحة الرئيسية
// «لا يظهر رقم لمن لا يملك تفصيله» (home.mjs)، ليصير متاحًا لأي تقرير دون أن يستورد شاشةً ولا قاعدة بيانات.
// المبدأ في سطر: إمّا رقم بمصدره وتاريخه، وإمّا فراغ يقول لماذا هو فراغ وما الذي يلزم لقياسه. لا ثالث.
// الفراغ الصامت يوقف التوليد كما يوقفه الرقم بلا مصدر تمامًا، لأن الصمت يُقرأ صفرًا عند من يفتح الملف.
// ولا نسبة إنجاز مخترعة: الفجوة تُذكر بوحدة المؤشر نفسها كما في سجل الحوكمة (governance.mjs)، والتغطية
// المعلنة وحدها نسبة، وهي نسبة «كم بندًا قِسنا من كم بندًا صرّحنا به» لا نسبة أداء.
// لا استيراد هنا إلا `fail` ومساعد التاريخ: الوحدة أوّلية يستعملها أي تقرير، فلا تعرف قاعدة بيانات ولا مستخدمًا
// ولا كاتب XLSX. الكتابة إلى الملفات تتم عند المنادي: `workbook(compositeSheets(r))` و`csv(compositeRows(r))`.

export const FIGURE_KINDS={measured:'مقيس',unavailable:'غير متاح',unmeasurable:'غير قابل للقياس'};
export const FIGURE_TYPES={number:'رقم',money:'مبلغ',percent:'نسبة مئوية',ratio:'معامل',text:'نص',count:'عدد'};
export const DIRECTIONS={up:'الأعلى أفضل',down:'الأدنى أفضل'};
// النبرات رموز عرض لا أحكام: `weak` وصف لرقم مقيس دون مستهدفه المعلن، و`blank` وصف لغياب مصرَّح به.
// الرمزان لا يتساويان أبدًا ولا يُدمجان: الفراغ ليس ضعف أداء، والضعف ليس غيابًا، وخلط الاثنين هو الكذبة نفسها.
export const TONES={weak:'weak',blank:'blank',none:''};
const NUMERIC=['number','money','percent','ratio','count'];
const BLANK_TYPE='none';
const DASH='—';
const GAPS_SHEET='الفجوات المعلنة';
const str=(value,min)=>typeof value==='string'&&value.trim().length>=min;
const sar=minor=>Math.round(Number(minor))/100;

/* ───── سجل مفاتيح الفجوات ───── */
// كتالوج الفجوات المعلنة نفسه من نصيب المرحلة الثالثة؛ هذه الوحدة لا تملكه ولا تخترعه. حتى تُثبِّته
// setGapRegistry يُقبل أي مفتاح غير فارغ، ويُسجَّل على كل فراغ أن مفتاحه لم يُطابَق بسجل بعد
// (`gap_registered:false`)، فلا تُقرأ الموافقة المؤقتة على أنها تحقّق. ستستدعي المرحلة الثالثة
// setGapRegistry(keys) مرة واحدة عند الإقلاع، فيصير المفتاح المجهول خطأ يوقف التوليد.
let GAP_KEYS=null;
export function setGapRegistry(keys){
  if(keys===null||keys===undefined){GAP_KEYS=null;return {installed:false,keys:0};}
  const set=new Set([...keys].map(k=>String(k).trim()).filter(Boolean));
  if(!set.size)fail(500,'gap_registry_empty','سجل الفجوات المُثبَّت فارغ: ثبّت مفاتيح معلنة أو أعِده إلى null');
  GAP_KEYS=set;
  return {installed:true,keys:set.size};
}
export const gapRegistryInstalled=()=>GAP_KEYS!==null;
function gapKey(label,key,required){
  if(!str(key,1)){
    if(required)fail(500,'gap_key_required',`فراغ بلا مفتاح فجوة معلنة: ${label}`);
    return {gap_key:'',gap_registered:false};
  }
  const k=key.trim();
  if(GAP_KEYS&&!GAP_KEYS.has(k))fail(500,'gap_key_unknown',`مفتاح فجوة غير مسجَّل في كتالوج الفجوات: ${k}`);
  return {gap_key:k,gap_registered:GAP_KEYS!==null};
}

/* ───── البند: رقم مقيس، أو فراغ مصرَّح به ───── */
// «ضعيف» حكم على رقم مقيس تجاوز مستهدفه المعلن في اتجاهه المعلن، ويُشتق هنا وحده فلا تجتهد شاشة ولا تقرير.
// رقم بلا مستهدف معلن لا يُوصف بضعف ولا بقوة: غياب المستهدف ليس أداءً حسنًا، وإنما غياب مستهدف.
// المساواة بالمستهدف ليست ضعفًا. والنص لا يُقارن.
function weakness(value,type,target,better){
  if(!NUMERIC.includes(type)||!Number.isFinite(value)||!Number.isFinite(target)||(better!=='up'&&better!=='down'))return TONES.none;
  return (better==='up'?value<target:value>target)?TONES.weak:TONES.none;
}
// value للمبالغ بالهللات كما في بقية المنصة (amount_minor)، ويُحوَّل إلى ريال عند العرض والتصدير وحده.
export function figure(label,value,type,source,as_of,opts={}){
  if(!str(label,1))fail(500,'figure_label','بند في التقرير بلا اسم: كل رقم يُعرض باسمه ومصدره، فسمِّ البند عند إنشائه');
  if(!Object.hasOwn(FIGURE_TYPES,type))fail(500,'figure_type',`نوع بند غير معروف «${type}»: ${label}`);
  const {target=null,better=null,unit='',note=''}=opts??{};
  if(better!==null&&better!=='up'&&better!=='down')fail(500,'figure_direction',`اتجاه الأفضلية إمّا up أو down: ${label}`);
  if(target!==null&&!Number.isFinite(target))fail(500,'figure_target',`المستهدف المعلن رقم أو لا شيء: ${label}`);
  if(target!==null&&better===null)fail(500,'figure_direction',`مستهدف بلا اتجاه لا يُحكم به على رقم: ${label}`);
  return {kind:'measured',kind_name:FIGURE_KINDS.measured,label:label.trim(),value,type,
    source:typeof source==='string'?source.trim():'',as_of:typeof as_of==='string'?as_of.trim():'',
    unit:String(unit??''),note:String(note??''),target,better,tone:weakness(value,type,target,better),
    reason:'',needed:'',gap_key:'',gap_registered:false,owner:'',target_on:''};
}
// متابع الفجوة وتاريخه المستهدف: يسافران مع الفراغ نفسه لا في جدول ثانٍ، فتخرج ورقة الفجوات المعلنة
// ومعها من وعد ومتى. فراغ بلا متابع يُكتب شرطة صريحة، لا خلية فارغة تُقرأ «لا أحد يعرف».
const owner=value=>str(value,1)?value.trim():'';
const targetOn=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value??''))?String(value):'';
function blank(kind,label,opts,required){
  if(!str(label,1))fail(500,'figure_label','فراغ مصرَّح به بلا اسم بند: سمِّ البند الذي لا يُقاس حتى يُقرأ الفراغ منسوبًا إليه');
  const {reason='',needed=''}=opts??{};
  return {kind,kind_name:FIGURE_KINDS[kind],label:label.trim(),value:null,type:BLANK_TYPE,source:'',as_of:'',
    unit:String(opts?.unit??''),note:String(opts?.note??''),target:null,better:null,tone:TONES.blank,
    reason:typeof reason==='string'?reason.trim():'',needed:typeof needed==='string'?needed.trim():'',
    owner:owner(opts?.owner),target_on:targetOn(opts?.target_on),
    ...gapKey(label,opts?.gap_key,required)};
}
// «غير متاح»: المصدر قائم في المنصة لكن هذه الفترة بلا قيد فيه. غياب القيد ليس صفرًا.
export const unavailable=(label,opts={})=>blank('unavailable',label,opts,false);
// «غير قابل للقياس»: لا مصدر لهذا البند في المنصة أصلًا. هذا اعتراف لا عذر، ولذلك مفتاح الفجوة إلزامي:
// كل بند من هذا النوع يجب أن يشير إلى فجوة معلنة يتابعها أحد، وإلا صار الاعتراف ذريعة دائمة.
export const unmeasurable=(label,opts={})=>blank('unmeasurable',label,opts,true);

/* ───── التركيب ───── */
export const group=(title,figures=[],opts={})=>({title:String(title??''),subtitle:String(opts?.subtitle??''),note:String(opts?.note??''),figures:[...figures]});
export const section=(key,name,groups=[],opts={})=>({key:String(key??''),name:String(name??''),note:String(opts?.note??''),human:!!opts?.human,groups:[...groups]});
const sectionsOf=input=>!input?[]:Array.isArray(input)?input:Array.isArray(input.sections)?input.sections:[input];
function* walk(input){
  for(const s of sectionsOf(input))for(const g of s?.groups??[])for(const f of g?.figures??[])yield {s,g,f};
}

/* ───── التغطية المعلنة ───── */
// النسبة الوحيدة التي تحسبها هذه الوحدة، ومعناها محدود: كم بندًا قِسنا من كم بندًا صرّحنا به. قسم صرّح بعشرة
// وقاس ثلاثة يقول «3000 نقطة أساس» ويسمّي السبعة الباقية بأسمائها وأسبابها، فلا يُقرأ 30% على أنه أداء 30%.
// قسم بلا بند معلن تغطيته null لا صفر: لا تصريح ولا تغطية، والصفر هنا يكذب كما يكذب في خلية فارغة.
export function coverage(input){
  const missing=[];let declared=0,measured=0,unavailableCount=0,unmeasurableCount=0;
  for(const {f} of walk(input)){
    if(!Object.hasOwn(FIGURE_KINDS,f.kind))fail(500,'figure_kind',`بند بنوع مجهول: ${f.label}`);
    declared++;
    if(f.kind==='measured'){measured++;continue;}
    if(f.kind==='unavailable')unavailableCount++;else unmeasurableCount++;
    missing.push({label:f.label,kind:f.kind,reason:f.reason,needed:f.needed,gap_key:f.gap_key,owner:f.owner??'',target_on:f.target_on??''});
  }
  return {declared,measured,unavailable:unavailableCount,unmeasurable:unmeasurableCount,
    bp:declared?Math.round(measured*10000/declared):null,missing};
}

/* ───── الحارس: لا يخرج تقرير فيه رقم بلا مصدر ولا فراغ بلا سبب ───── */
export function assertSourced(body){
  for(const {s,f} of walk(body)){
    const where=`في قسم «${s?.name||s?.key||''}»: ${f?.label??''}`;
    if(!Object.hasOwn(FIGURE_KINDS,f.kind))fail(500,'figure_without_source',`بند بنوع مجهول ${where}`);
    if(f.kind==='measured'){
      if(!str(f.source,5)||!/^\d{4}-\d{2}-\d{2}$/.test(f.as_of??''))fail(500,'figure_without_source',`رقم بلا مصدر أو تاريخ ${where}`);
      // رقم «مقيس» قيمته فارغة فراغ متنكر في زي قياس: يُوقف كما يُوقف الرقم بلا مصدر.
      if(f.type==='text'?!str(f.value,1):!Number.isFinite(f.value))fail(500,'figure_without_source',`رقم معلن مقيسًا وقيمته غائبة ${where}`);
    }else if(!str(f.reason,10)||!str(f.needed,10)){
      // فراغ لا يقول لماذا هو فراغ يوقف التوليد كما يوقفه الرقم بلا مصدر: الصمت يُقرأ صفرًا.
      fail(500,'figure_without_source',`فراغ لا يقول لماذا هو فراغ وما الذي يلزم لقياسه ${where}`);
    }
  }
  return body;
}

/* ───── العرض والتصدير ───── */
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=minor=>sar(minor).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
// القيمة المصدَّرة: البند غير المقيس يخرج بعبارته العربية صريحةً، لا صفرًا ولا خلية فارغة. كاتب XLSX يُسقط
// الخلية الفارغة من الورقة، والخلية المُسقطة تُقرأ صفرًا عند من يفتح الملف، فيصير الغياب رقمًا لم يقله أحد.
function exportValue(f){
  if(f.kind!=='measured')return FIGURE_KINDS[f.kind];
  if(f.type==='text')return str(f.value,1)?String(f.value):DASH;
  if(f.type==='money')return sar(f.value);
  return Number.isFinite(f.value)?f.value:FIGURE_KINDS.unavailable;
}
function showValue(f){
  if(f.kind!=='measured')return FIGURE_KINDS[f.kind];
  if(f.type==='text')return str(f.value,1)?String(f.value):DASH;
  if(f.type==='money')return `${money(f.value)} ريال`;
  if(!Number.isFinite(f.value))return FIGURE_KINDS.unavailable;
  const n=f.value.toLocaleString('en-US');
  return f.type==='percent'?`${n}%`:f.unit?`${n} ${f.unit}`:n;
}
// الحالة نص مقروء لا لون: الطباعة قد تخرج بلا ورقة أنماط، فلا يُترك المعنى للصنف وحده.
const stateOf=f=>f.kind!=='measured'?FIGURE_KINDS[f.kind]:f.tone===TONES.weak?`${FIGURE_KINDS.measured} — دون المستهدف المعلن`:FIGURE_KINDS.measured;
const targetCell=f=>!Number.isFinite(f.target)?DASH:f.type==='money'?money(f.target):f.target.toLocaleString('en-US');
const FIGURE_COLUMNS=['البند','القيمة','الحالة','الوحدة','المستهدف المعلن','اتجاه الأفضلية','المصدر','بتاريخ','سبب الغياب','ما يلزم لقياسه','مفتاح الفجوة','من تسلّم إغلاق الفجوة','التاريخ المستهدف لإغلاقها'];
// لا خلية فارغة في أي صف: ما لا ينطبق يُكتب شرطة صريحة، لأن الفراغ في ملف يُقرأ صفرًا أو سهوًا.
const figureCells=f=>[f.label,exportValue(f),stateOf(f),f.unit||DASH,targetCell(f),f.better?DIRECTIONS[f.better]:DASH,
  f.source||DASH,f.as_of||DASH,f.reason||DASH,f.needed||DASH,f.gap_key||DASH,f.owner||DASH,f.target_on||DASH];

export function compositeRows(result){
  const rows=[['القسم','المجموعة',...FIGURE_COLUMNS]];
  for(const {s,g,f} of walk(result))rows.push([s.name||s.key||DASH,g.title||DASH,...figureCells(f)]);
  return rows;
}
export function compositeSheets(result){
  const used=new Map(),sheets=[];
  for(const s of sectionsOf(result)){
    const base=s.name||s.key||'قسم',seen=(used.get(base)??0)+1;used.set(base,seen);
    const rows=[['المجموعة',...FIGURE_COLUMNS]];
    for(const g of s.groups??[])for(const f of g.figures??[])rows.push([g.title||DASH,...figureCells(f)]);
    sheets.push({name:seen>1?`${base} ${seen}`:base,rows});
  }
  const gaps=[['القسم','البند','الحالة','سبب الغياب','ما يلزم لقياسه','مفتاح الفجوة','من تسلّم إغلاق الفجوة','التاريخ المستهدف لإغلاقها']];
  for(const {s,f} of walk(result))if(f.kind!=='measured')gaps.push([s.name||s.key||DASH,f.label,FIGURE_KINDS[f.kind],f.reason||DASH,f.needed||DASH,f.gap_key||DASH,f.owner||DASH,f.target_on||DASH]);
  // قسم اسمه «الفجوات المعلنة» يوجد في تقرير مركّب (E01 مثلًا)، وورقتان باسم واحد حزمة XLSX لا تُفتح.
  // الترقيم نفسه الذي يفصل قسمين متشابهي الاسم يفصل الورقة الجامعة عن قسمها.
  const seen=(used.get(GAPS_SHEET)??0)+1;
  sheets.push({name:seen>1?`${GAPS_SHEET} ${seen}`:GAPS_SHEET,rows:gaps});
  return sheets;
}

const NOTICE='كل رقم هنا مأخوذ من سجل في المنصة ومعه مصدره وتاريخه. ما لم يُقَس يُكتب «غير متاح» أو «غير قابل للقياس» بعبارته وسببه، ولا يُكتب صفرًا ولا يُترك فارغًا. التغطية المعلنة نسبة ما قيس إلى ما صُرِّح به، وليست نسبة أداء؛ ولا تحسب المنصة نسبة إنجاز.';
function figuresTable(figures){
  const head=`<thead><tr>${['البند','القيمة','الحالة','المستهدف المعلن','المصدر أو سبب الغياب','بتاريخ'].map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>`;
  const body=figures.map(f=>{
    const why=f.kind==='measured'?f.source:`${f.reason}${f.needed?` — يلزم لقياسه: ${f.needed}`:''}${f.gap_key?` (فجوة: ${f.gap_key})`:''}`;
    return `<tr class="figure-${esc(f.tone||'plain')}"><td>${esc(f.label)}</td><td class="num">${esc(showValue(f))}</td><td>${esc(stateOf(f))}</td><td class="num">${esc(targetCell(f))}${f.better?` ${esc(DIRECTIONS[f.better])}`:''}</td><td>${esc(why||DASH)}</td><td class="num">${esc(f.as_of?dual(f.as_of):DASH)}</td></tr>`;
  }).join('')||'<tr><td colspan="6">لا بنود معلنة في هذه المجموعة.</td></tr>';
  return `<table>${head}<tbody>${body}</tbody></table>`;
}
function coverageLine(c){
  if(!c.declared)return 'لا بند معلن في هذا القسم، فلا تغطية تُحسب له.';
  return `التغطية المعلنة: قِيس ${c.measured} من ${c.declared} (${c.bp} نقطة أساس). غير متاح: ${c.unavailable}. غير قابل للقياس: ${c.unmeasurable}.`;
}
// نسخة المتصفح للطباعة: من اليمين لليسار، بورقة أنماط المنصة وحدها، بلا نص برمجي ولا نمط داخل السمة
// ولا أي أصل من خارج المنصة — سياسة المحتوى صارمة (script-src 'self')، والطباعة تتم من المتصفح ثم «حفظ كـ PDF».
export function compositePrintable(result){
  const period=result?.params??result?.period??null;
  const total=coverage(result),sections=sectionsOf(result);
  const meta=[period?.from&&period?.to?`الفترة ${dual(period.from)} إلى ${dual(period.to)}`:'',
    result?.data_until?`البيانات حتى ${dual(result.data_until)}`:'',result?.generated_at?`أُنشئ في ${result.generated_at}`:''].filter(Boolean).map(esc).join(' · ');
  const body=sections.map(s=>{
    const c=coverage(s);
    const groups=(s.groups??[]).map(g=>`<h3>${esc(g.title)}${g.subtitle?` <span class="meta">${esc(g.subtitle)}</span>`:''}</h3>${g.note?`<p class="meta">${esc(g.note)}</p>`:''}${figuresTable(g.figures??[])}`).join('')
      ||'<p class="meta">لا مجموعات في هذا القسم. غياب البيانات ليس صفرًا.</p>';
    return `<section><h2>${esc(s.name)}</h2><p class="meta">${esc(coverageLine(c))}</p>${s.note?`<p class="meta">${esc(s.note)}</p>`:''}${groups}</section>`;
  }).join('');
  const gaps=total.missing.length
    ?`<table><thead><tr>${['البند','الحالة','سبب الغياب','ما يلزم لقياسه','مفتاح الفجوة','من تسلّم إغلاقها','التاريخ المستهدف'].map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${total.missing.map(m=>`<tr><td>${esc(m.label)}</td><td>${esc(FIGURE_KINDS[m.kind])}</td><td>${esc(m.reason||DASH)}</td><td>${esc(m.needed||DASH)}</td><td>${esc(m.gap_key||DASH)}</td><td>${esc(m.owner||DASH)}</td><td class="num">${esc(m.target_on?dual(m.target_on):DASH)}</td></tr>`).join('')}</tbody></table>`
    :'<p class="meta">لا فجوة معلنة: كل بند صُرِّح به في هذا التقرير مقيس بمصدره.</p>';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(result?.title??'تقرير')}</title><link rel="stylesheet" href="/report-print.css"></head><body class="doc"><header><p class="brand">3,6T</p><h1>${esc(result?.title??'تقرير')}</h1>${meta?`<p class="meta">${meta}</p>`:''}<p class="meta">${esc(coverageLine(total))}</p></header>
    <p class="notice">${esc(NOTICE)}</p>
    ${body}
    <section><h2>${esc(GAPS_SHEET)}</h2>${gaps}</section>
    <footer>للحفظ PDF: اطبع هذه الصفحة من المتصفح واختر «حفظ كـ PDF». أُنتج من منصة 3,6T.</footer></body></html>`;
}
