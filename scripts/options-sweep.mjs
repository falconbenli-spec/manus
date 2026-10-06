// «شيك على كل الخدمات» — مسح الخيارات المُدارة على المنصة كلها.
//
// قرار المالك: «لازم يكون فيه خيارات لكل معلومه مهمه بكل المنصه». هذا النص يقيس كم من ذلك تحقّق، وأين بقي
// الباقي بالضبط، فيصير ما تبقّى **مقيسًا لا مظنونًا**. لا يصلح شيئًا ولا يكتب في القاعدة: يقرأ ويعدّ ويطبع.
//
// ثلاثة مصادر تُقرأ معًا:
//   (1) واصفات القوائم المسجَّلة في الكود (app/options.mjs)، ومعها الأعمدة التي تقول إنها تحكمها.
//   (2) المخطط وكل ترحيل: كل عمود، ونوعه، وهل يحرسه قيد CHECK ... IN (…).
//   (3) تعريفات الخدمات في قاعدة مبذورة: حقول كل خدمة وأنواعها، فيُرى أي حقل خدمة قائمةٌ وأيها نصّ حرّ.
//
// التصنيف لكل عمود مهم:
//   managed    — تحكمه قائمة مُدارة أو قيمة باعتماد مؤرَّخ: المالك يبلغه.
//   db_locked  — مقفل بقيد في القاعدة: يُقرأ ولا يُحرَّر إلا بترحيل يعيد بناء الجدول (نمط الترحيل 031).
//   free_text  — نصّ بلا قيد ولا قائمة: إما حرٌّ فعلًا، وإما قائمةٌ يحرسها الكود وحده. هذا ما يقصده القرار
//                بـ«معلومة مهمة بلا خيارات»، وقسم «قواميس الكود» أدناه يقول كم منه قائمةٌ في يد مبرمج.
//   by_design  — لا تصير خيارًا بقرار: مشتقّة من مستند، أو سجل وقائع. جعلُها اختيارًا يتيح مناقضة المستند.
//
// التشغيل:  node scripts/options-sweep.mjs            تقرير مقروء
//           node scripts/options-sweep.mjs --json     الأرقام نفسها بصيغة JSON
import { readdirSync, readFileSync } from 'node:fs';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { registeredLists, registeredAdoptions } from '../app/options.mjs';

const appUrl=new URL('../app/',import.meta.url);
const read=path=>readFileSync(new URL(path,appUrl),'utf8');
const modules=readdirSync(appUrl).filter(f=>f.endsWith('.mjs')).sort();

/* ───── (1) تحميل كل وحدة ليسجّل صاحبُها واصفَه ───── */
// الواصف يعيش في وحدته (اصطلاح registerEntity نفسه)، فلا تُرى القوائم إلا بتحميل أصحابها. وحدة تتعثّر في
// التحميل تُسمَّى ولا تُبتلع: مسحٌ يصمت عن وحدة لم يقرأها يكذب في العدّ.
const loadFailures=[];
for(const file of modules){
  if(file==='server.mjs')continue; // الموجّه يبني تطبيقًا ولا يسجّل قائمة
  try{await import(new URL(file,appUrl).href);}catch(error){loadFailures.push(`${file}: ${error.message}`);}
}
const lists=registeredLists(),adoptions=registeredAdoptions();
const managedColumns=new Map();
for(const d of lists)for(const column of d.columns)managedColumns.set(column,d);
// أيّ عمود **يُفرض اليوم**؟ القائمة المسجَّلة لا تعني أن مسار كتابة يستدعيها: بعض النداءات مشروطة بقرار
// معتمد لم يُتَّخذ بعد (`if(adopted(...).value===true) requireOption(...)`)، والقرار افتراضه false. عدُّ ذلك
// «تحوَّل» يقول للمالك إن الحقل تحت يده وهو ما زال نصًّا حرًّا. يُقرأ من الكود لا من الظنّ: نداء requireOption
// داخل سطر يبدأ بـif(adopted(...)) نداءٌ مشروط، وما عداه غير مشروط.
const ENFORCEMENT=new Map();
for(const file of modules){
  const source=readFileSync(new URL(file,appUrl),'utf8');
  for(const line of source.split('\n')){
    for(const call of line.matchAll(/requireOption\([^)]*?'([a-z][a-z._]+)'/g)){
      const key=call[1],conditional=/^\s*if\s*\(\s*adopted\(/.test(line)?line.match(/adopted\([^)]*?'([a-z][a-z._]+)'/)?.[1]??true:null;
      const previous=ENFORCEMENT.get(key);
      // نداء غير مشروط واحد يكفي ليصير العمود مفروضًا؛ المشروط لا يلغي غير المشروط.
      if(previous&&!previous.conditional)continue;
      ENFORCEMENT.set(key,{conditional,file});
    }
  }
}

/* ───── (2) المخطط وكل ترحيل: كل عمود وقيده ───── */
// قراءة نصّية مقصودة: الهدف عدّ الأعمدة وقيودها لا تنفيذ SQL. الترحيل اللاحق يعلو السابق، فآخر تعريف للجدول هو الساري.
const SQL=[read('schema.sql'),...readdirSync(new URL('migrations/',appUrl)).filter(f=>/^\d{3}-.+\.sql$/.test(f)).sort()
  .map(f=>readFileSync(new URL('migrations/'+f,appUrl),'utf8'))].join('\n');
const tables=new Map();
for(const match of SQL.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n?\)\s*STRICT?\s*;/gi)){
  const [,table,body]=match,columns=new Map();
  // كل سطر عمود: الاسم ثم النوع ثم بقية القيود. السطور التي تبدأ بكلمة قيد (CHECK/FOREIGN/UNIQUE/PRIMARY) ليست أعمدة.
  for(const line of body.split('\n').map(l=>l.trim()).filter(Boolean)){
    const column=line.match(/^([a-z_][a-z0-9_]*)\s+(TEXT|INTEGER|REAL|BLOB|ANY)\b(.*)$/i);
    if(!column)continue;
    const [,name,type,rest]=column;
    columns.set(name,{name,type:type.toUpperCase(),check_in:/CHECK\s*\([^)]*\bIN\s*\(/i.test(rest)||new RegExp(`CHECK\\s*\\(\\s*${name}\\s+IN\\s*\\(`,'i').test(body),line});
  }
  // ALTER TABLE ... ADD COLUMN بعد الإنشاء
  tables.set(table,columns);
}
for(const match of SQL.matchAll(/ALTER TABLE ([a-z_][a-z0-9_]*) ADD COLUMN ([a-z_][a-z0-9_]*)\s+(TEXT|INTEGER|REAL|BLOB|ANY)\b([^;]*);/gi)){
  const [,table,name,type,rest]=match;
  if(tables.has(table))tables.get(table).set(name,{name,type:type.toUpperCase(),check_in:/CHECK\s*\([^)]*\bIN\s*\(/i.test(rest),line:match[0]});
}

/* ───── (3) ما هو «حقل مهم» ───── */
// اسم العمود هو الدليل الوحيد المتاح على أن القيمة تصنيف لا نصّ حرّ. القائمتان صريحتان حتى يُقرأ الحكم ويُناقَش:
// ما يسمّي **تصنيفًا** مهم، وما يسمّي **نثرًا أو مرجعًا أو هوية** ليس كذلك ولو حمل كلمة من الأولى.
const CLASSIFIER=/(^|_)(status|state|kind|type|category|categories|purpose|unit|method|level|mode|class|source|decision|outcome|verification|origin|severity|priority|frequency|cadence|channel|reason_code|grade|tier|scope|role|action)s?$/;
const PROSE=/(^|_)(note|notes|reason|evidence|description|brief|summary|comment|message|body|text|title|name|label|justification|basis|remark)s?$/;
const IDENTITY=/(^|_)(id|ids|key|code|ref|reference|number|hash|digest|token|url|path|email|phone|iban|at|on|date|by)$/;
const SKIP_TABLES=/^(sqlite_|audit_events|schema_migrations|outbox|attachments|sessions)/;
// أعمدة لا تصير خيارات **عمدًا**، ومعها سببها. جعلُها قابلة للاختيار يتيح لإنسان أن يناقض المستند نفسه.
// تُعدّ «بقرار» لا «متبقّية»، فلا يتضخّم الباقي بما لا يُراد تحويله أصلًا.
const BY_DESIGN=new Map(Object.entries({
  'procurement_payables.payment_status':'مشتقّة من أمر الدفع نفسه (payment_orders)، لا تُختار',
  'procurement_payables.posting_status':'مشتقّة من ربط القيد بالدفتر (finance_payable_links)، لا تُختار',
  'procurement_orders.execution_status':'مشتقّة من واقعة التنفيذ الموثّقة، لا تُختار',
  'tax_invoices.reporting_status':'مشتقّة من حالة الإرسال إلى الهيئة، لا تُختار',
  'procurement_versions.action':'اسم الفعل الذي وقع فعلًا في سجل النسخ؛ سجل لا حقل إدخال',
  'finance_versions.action':'اسم الفعل الذي وقع فعلًا في سجل النسخ؛ سجل لا حقل إدخال',
  'vendor_decisions.from_status':'لقطة من حالة الملف وقت القرار؛ تتبع vendors.status ولا تُختار وحدها',
  'vendor_decisions.to_status':'لقطة من حالة الملف وقت القرار؛ تتبع vendors.status ولا تُختار وحدها',
  'people_events.from_status':'لقطة من حالة سابقة؛ سجل لا حقل إدخال',
  'vendors.data_source':'نثر: من أين جاءت بيانات المورد ومتى — يُكتب ولا يُختار'
}));
// TEXT وحده: عمودٌ صحيحٌ اسمه «units» أو «level» كمّيةٌ أو رتبة لا تصنيف، وعدّه «بلا خيارات» يضخّم الباقي بالباطل.
// ومن أين يُعرف أن نصًّا بلا قيد قائمةٌ مقفلة في الكود لا نصٌّ حرّ حقًّا؟ لا يُعرف من المخطط، فلا يُدَّعى:
// قسم «قواميس الكود» أدناه هو قياس ذلك، ويُقرأ بجواره.
const important=(table,column)=>!SKIP_TABLES.test(table)&&column.type==='TEXT'&&CLASSIFIER.test(column.name)&&!PROSE.test(column.name)&&!IDENTITY.test(column.name);

// الحكم يتبع الحوكمة بأمانة. كان يميّز db_locked وحدها ويعدّ كل ما سواها «يديرها المالك»، فقائمةٌ مثبّتة
// نظامًا — يقول عنها optionsFor نفسه editable:false — تُطبع في «ما تحوَّل» وتُحسب على سطر «يديرها المالك».
// وهذا أخطر اتجاه للخطأ في الأثر الوحيد الذي يقرؤه المالك: أن يُقال له إن قائمةً يثبّتها النظام هي له.
const VERDICT_OF=Object.freeze({managed:'managed',bounded:'bounded',legally_fixed:'legally_fixed',db_locked:'db_locked'});
// قوائم يقفلها نصّ نظامي، مفتاحها عمود أو قاموس. هذه لا تصير «متبقّيًا يُسلَّم للمالك» أبدًا: توسيعها مخالفة،
// لا تأخّر في التحويل. والسطر يحمل مادته ليُراجَع، لا ليُصدَّق.
const LEGALLY_CLOSED=new Map(Object.entries({
  'discipline.mjs:PENALTY_KINDS':{article:'اللائحة م111 (الجزاءات الستّة) وم113 (لا يُستبدل إلا الأخفّ)',
    because:'نصّ م111 محفوظ بالحرف في الترحيل 110؛ جزاءٌ سابعٌ لا يقوم عليه نصّ'}
}));

const findings=[];
for(const [table,columns] of tables)for(const column of columns.values()){
  if(!important(table,column))continue;
  const key=`${table}.${column.name}`,list=managedColumns.get(key);
  const enforcement=list?ENFORCEMENT.get(list.key)??null:null;
  const verdict=list?VERDICT_OF[list.governance]
    :BY_DESIGN.has(key)?'by_design'
    :column.check_in?'db_locked':'free_text';
  findings.push({column:key,type:column.type,verdict,list:list?.key??null,owner:list?.owner??null,
    article:list?.article?.ref??null,article_pending:!!list?.article?.pending,
    // مفروض اليوم، أو مسجَّل بانتظار قرار إغلاق لم يُتَّخذ بعد. الفرق هو الفرق بين «تحت يد المالك» و«معروضٌ له».
    enforced:list&&['managed','bounded'].includes(list.governance)?!!enforcement&&!enforcement.conditional:null,
    awaiting_decision:enforcement?.conditional??null,
    because:BY_DESIGN.get(key)??null});
}

/* ───── (4) حقول تعريفات الخدمات ───── */
// «شيك على كل الخدمات» بالمعنى الحرفي: كل حقل في كل خدمة مسجَّلة. حقل الاختيار قائمةٌ بالفعل (خياراته في تعريف
// الخدمة، ويحرّرها محرّر الصفحة عبر سجل التعريفات، الترحيل 123)؛ والحقل النصّي الذي يسمّي تصنيفًا نصٌّ حرّ.
const db=openDb(':memory:');
seed(db,'synthetic-options-sweep-read-only');
const services=db.prepare('SELECT code,name_ar,fields FROM services ORDER BY code').all();
const serviceFields=[];
for(const service of services)for(const field of JSON.parse(service.fields)){
  const name=String(field.key??''),classifier=CLASSIFIER.test(name)&&!PROSE.test(name);
  serviceFields.push({service:service.code,service_name:service.name_ar,field:name,label:field.label??'',type:field.type,
    verdict:field.type==='select'?'service_option_list':classifier?'free_text':'prose'});
}
db.close();

/* ───── (5) قوائم مقفلة في الكود لم تُسجَّل بعد ───── */
// نمط «قاموس ثابت في وحدة»: مصفوفة أزواج تُحوَّل إلى {key,name}، أو كائن من ثلاثة مفاتيح فأكثر قيمها نصوص عربية.
// وجودها لا يعني عيبًا بذاته (بعضها مشتقّ أو نثر)، لكنه يقول أين يبقى **الاختيار في يد مبرمج**.
const registeredValues=new Set(lists.flatMap(d=>d.defaults.map(o=>o.value)));
// حدّ القاموس يُقرأ بموازنة الأقواس لا بعدد محارف مقطوع: بلا ذلك يبتلع الماسح القاموس التالي فيعدّ مدخلاته مرتين.
function literalAt(source,start){
  const open=source[start],close=open==='['?']':'}';
  let depth=0,quote='';
  for(let i=start;i<source.length&&i<start+20000;i++){
    const c=source[i];
    if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
    if(c==="'"||c==='"'||c==='`'){quote=c;continue;}
    if(c===open)depth++;
    else if(c===close&&--depth===0)return source.slice(start,i+1);
  }
  return source.slice(start,start+2000);
}
const codeDictionaries=[];
for(const file of modules){
  const source=readFileSync(new URL(file,appUrl),'utf8');
  for(const match of source.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*=\s*[\[{]/g)){
    const [,name]=match,start=match.index+match[0].length-1;
    const body=literalAt(source,start);
    // مفاتيح القاموس: 'key': أو ['key', — لا كل نصّ في الجسم.
    let keys=[...new Set([...body.matchAll(/(?:\[\s*'([a-z][a-z0-9_]{1,39})'\s*,|(?:^|[{,\s])'?([a-z][a-z0-9_]{1,39})'?\s*:)/gm)].map(m=>m[1]??m[2]))];
    // ومصفوفة نصوص **مسطّحة** قاموسٌ كذلك، والصيغتان أعلاه لا تريانها: تُخرجان مفتاحًا واحدًا فيُسقطها حدّ
    // الثلاثة. مثالها PENALTY_KINDS في app/discipline.mjs — خمسة جزاءات كان الماسح يعدّها «ليست قاموسًا».
    // الشرط: كل عنصر مفتاحٌ لاتيني صغير، ولا عنصر آخر في الجسم — فمصفوفة عربية أو مختلطة ليست قاموس مفاتيح.
    if(keys.length<3&&body[0]==='['){
      const items=body.slice(1,-1).split(',').map(s=>s.trim()).filter(Boolean);
      const flat=items.map(s=>/^'([a-z][a-z0-9_]{1,39})'$/.exec(s)?.[1]).filter(Boolean);
      if(flat.length>=3&&flat.length===items.length)keys=[...new Set(flat)];
    }
    if(keys.length<3)continue;
    const covered=keys.filter(k=>registeredValues.has(k)).length;
    const closed=LEGALLY_CLOSED.get(`${file}:${name}`)??null;
    codeDictionaries.push({file,name,entries:keys.length,covered,
      verdict:closed?'legally_fixed':covered>=Math.ceil(keys.length*0.8)?'managed':'free_text',
      article:closed?.article??null,because:closed?.because??null,
      managed:covered>=Math.ceil(keys.length*0.8)});
  }
}

/* ───── التقرير ───── */
const count=verdict=>findings.filter(f=>f.verdict===verdict).length;
const owned=findings.filter(f=>['managed','bounded'].includes(f.verdict));
const summary={
  generated_at:new Date().toISOString(),
  modules_read:modules.length,load_failures:loadFailures,
  registered_lists:lists.length,registered_adoptions:adoptions.length,
  tables_read:tables.size,important_columns:findings.length,
  managed:count('managed'),bounded:count('bounded'),legally_fixed:count('legally_fixed'),
  db_locked:count('db_locked'),free_text:count('free_text'),by_design:count('by_design'),
  // القراءة الصادقة للرقم: المفروض اليوم، والمسجَّل بانتظار قرار إغلاق لم يُتَّخذ بعد.
  enforced_today:owned.filter(f=>f.enforced).length,
  registered_not_closed:owned.filter(f=>!f.enforced).length,
  services:services.length,service_fields:serviceFields.length,
  service_option_lists:serviceFields.filter(f=>f.verdict==='service_option_list').length,
  service_free_text_classifiers:serviceFields.filter(f=>f.verdict==='free_text').length,
  code_dictionaries:codeDictionaries.length,
  code_dictionaries_unmanaged:codeDictionaries.filter(d=>d.verdict==='free_text').length,
  code_dictionaries_legally_fixed:codeDictionaries.filter(d=>d.verdict==='legally_fixed').length
};
if(process.argv.includes('--json')){
  console.log(JSON.stringify({summary,findings,service_fields:serviceFields,code_dictionaries:codeDictionaries},null,1));
}else{
  const pct=n=>summary.important_columns?`${Math.round(n*1000/summary.important_columns)/10}%`:'—';
  console.log('مسح الخيارات المُدارة — «شيك على كل الخدمات»');
  console.log(`قُرئت ${summary.modules_read} وحدة و${summary.tables_read} جدولًا و${summary.services} خدمة. القوائم المسجَّلة: ${summary.registered_lists}، والقيم ذات الأساس المعتمد: ${summary.registered_adoptions}.`);
  if(loadFailures.length)console.log(`  ⚠ وحدات لم تُقرأ (لا تُحتسب قوائمها): ${loadFailures.join(' | ')}`);
  console.log('');
  console.log(`أعمدة تحمل تصنيفًا مهمًا: ${summary.important_columns}`);
  console.log(`  يديرها المالك (قائمة مُدارة)           ${String(summary.managed).padStart(4)}  ${pct(summary.managed)}   منها ${summary.enforced_today} مفروضة اليوم و${summary.registered_not_closed} مسجَّلة بانتظار قرار إغلاق`);
  if(summary.bounded)console.log(`  يديرها المالك داخل حدّ محروس           ${String(summary.bounded).padStart(4)}  ${pct(summary.bounded)}`);
  console.log(`  مثبّتة نظامًا — للقراءة فقط             ${String(summary.legally_fixed).padStart(4)}  ${pct(summary.legally_fixed)}   ليست متبقّيًا ولا «تحوَّلت»: توسيعها مخالفة`);
  console.log(`  مقفلة بقيد في القاعدة                 ${String(summary.db_locked).padStart(4)}  ${pct(summary.db_locked)}   تُفتح بترحيل يعيد بناء الجدول`);
  console.log(`  نصّ حرّ باسم تصنيف                     ${String(summary.free_text).padStart(4)}  ${pct(summary.free_text)}   هذا ما يقصده القرار بـ«بلا خيارات»`);
  console.log(`  لا تصير خيارًا بقرار (مشتقّة أو سجل)      ${String(summary.by_design).padStart(4)}  ${pct(summary.by_design)}   جعلُها اختيارًا يتيح مناقضة المستند`);
  console.log('');
  console.log('المتبقّي بالاسم — نصّ حرّ:');
  for(const f of findings.filter(f=>f.verdict==='free_text'))console.log(`  ${f.column}`);
  console.log('');
  // «ما تحوَّل» = ما صار تحت يد المالك فعلًا. المثبّت نظامًا لا يدخل هنا: لم يتحوَّل إلى أحد، وله سطره أدناه.
  console.log(`ما تحوَّل — مفروض اليوم (${summary.enforced_today}):`);
  for(const f of owned.filter(f=>f.enforced))console.log(`  ${f.column} ← ${f.list} · ${f.owner}`);
  if(summary.registered_not_closed){
    console.log(`مسجَّل وغير مفروض بعد (${summary.registered_not_closed}) — القائمة معروضة والحقل ما زال نصًّا حرًّا حتى يُتَّخذ قرار الإغلاق:`);
    for(const f of owned.filter(f=>!f.enforced))console.log(`  ${f.column} ← ${f.list} · ينتظر قرار ${f.awaiting_decision??'إغلاق لم يُسجَّل بعد'}`);
  }
  if(summary.legally_fixed){
    console.log('مثبّت نظامًا (يُقرأ ولا يُوسَّع):');
    for(const f of findings.filter(f=>f.verdict==='legally_fixed'))
      console.log(`  ${f.column} ← ${f.list} · ${f.article}${f.article_pending?' ⚠ المادة غير مسجّلة في المستودع بعد':''}`);
  }
  console.log('');
  console.log(`حقول الخدمات في قاعدة مبذورة (${summary.services} خدمات تجريبية، ${summary.service_fields} حقلًا — لا دليل الخدمات الحيّ): قائمة اختيار ${summary.service_option_lists}، نصّ حرّ باسم تصنيف ${summary.service_free_text_classifiers}.`);
  for(const f of serviceFields.filter(f=>f.verdict==='free_text'))console.log(`  ${f.service}.${f.field} — ${f.label}`);
  console.log('ملاحظة نطاق: حقول الخدمات وشاشاتها يملكها فريق الكتالوج في هذه الموجة، فما فوق يُقاس ولا يُحوَّل هنا.');
  console.log('');
  console.log(`قواميس ثابتة في الكود: ${summary.code_dictionaries}، منها ${summary.code_dictionaries_unmanaged} لم تصر قائمة مُدارة بعد، و${summary.code_dictionaries_legally_fixed} يقفلها نصّ نظامي فلا تُسلَّم للمالك أصلًا.`);
  for(const d of codeDictionaries.filter(d=>d.verdict==='legally_fixed'))
    console.log(`  ⚖ ${d.file}: ${d.name} (${d.entries} مدخلًا) — ${d.article}؛ ${d.because}`);
  for(const d of codeDictionaries.filter(d=>d.verdict==='free_text').slice(0,40))console.log(`  ${d.file}: ${d.name} (${d.entries} مدخلًا)`);
  if(summary.code_dictionaries_unmanaged>40)console.log(`  … و${summary.code_dictionaries_unmanaged-40} أخرى`);
}
