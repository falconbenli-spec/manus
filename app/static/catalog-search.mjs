// بحث مركز الخدمات (الدفعة الثالثة): ترتيبٌ معلَن على شجرة الدليل بمرادفاتها، في المتصفح وفي الخادم سواء.
//
// وحدة نقية: لا DOM، ولا استيراد من الخادم. تقرأ حمولة /api/catalog/tree كما هي (الفئات ببطاقاتها وأعضاء مجموعاتها،
// والمرادفات المطبَّعة من service_synonyms) وتعيد قائمةً مرتّبة. يستوردها الخادم أيضًا (app/catalog-home.mjs) ليعدّ نتائج
// البحث الذي يسجّله بالجملة نفسها التي عدّتها الشاشة — فلا يُسجَّل «بلا نتيجة» بحثٌ وجد شيئًا.
//
// المطبِّع واحد (normalizeArabic في request-picker.mjs)، ويجب أن يساوي app/arabic-text.mjs normalize على ما يكتبه
// الناس — وإلا لم تطابق مرادفاتُ الخادم استعلامَ المتصفح؛ يثبته اختبارٌ على خمسين سؤالًا. والجذر الخفيف ومسافة التحرير
// هنا نسختان **متطابقتان بالنصّ** من الوحدة نفسها (stem، withinDistance)، لأن ملفات الخادم لا تُقدَّم للمتصفح؛ والاختبار
// نفسه يثبت مساواتهما على كل كلمات الدليل، فلا يفترقان بصمت.
//
// الدرجة لكل كلمة استعلام أعلى طبقةٍ تطابقها (لا تُجمع الطبقات على الكلمة الواحدة)، ثم تُجمع الكلمات:
//   6 الاسم كله  ·  4 بداية الاسم أو كلمة فيه  ·  4 مرادف (كلّه أو كلمة فيه)، وكذلك الكلمة بعد نزع «ال» عنها («الحج» تجد «حج»)
//   3 اسم خيار في المجموعة  ·  2 الجذر نفسه  ·  1 ورودٌ في الوصف أو الرمز، أو خطأ إملائي بحرف (≥4 أحرف) أو حرفين (≥7)
// وكلمات الربط والنيّة («ابغى»، «في»، «كيف»، «ودي»، «اسوي») تُسقط قبل المطابقة. ومكافأة +6 حين يساوي الاستعلامُ كلُّه
// اسمَ البند أو مرادفًا له (الاسم القديم بعد إعادة التسمية يجد رمزه أولًا).
// **الكلمات التي أصابت أولًا** (مراجعة 23 سبتمبر): كان شرط «كل الكلمات يجب أن تصيب» يُسقط الاستعلام كله حين تسقط كلمةٌ
// واحدة («المكيف ما يبرد» بلا نتيجة لأن «يبرد» لم تكن في الدليل)، فسبعة عشر من عشرين سؤالًا دارجًا كانت تعود فارغة. الآن:
// البند الذي أصابته كل الكلمات يتقدّم، وإلا فالبنود التي أصابها أكبر عددٍ من الكلمات وحدها — ويُقال للطالب أي كلماته
// استُعملت وأيّها أُهملت (used/ignored) فلا يُوهَم أن «يبرد» وُجدت.
// التعادل: العضو قبل مجموعته (طلبُ «تصميم بوستر» أقرب من بطاقة «طلب شغل إبداعي»: ضغطتان لا ثلاث)، ثم ترتيب الشجرة.
import { normalizeArabic } from './request-picker.mjs';

// كلمات لا تُميّز خدمةً: أدوات وضمائر وأفعال النيّة والسؤال بالفصحى والدارج. تُسقط من الاستعلام قبل المطابقة.
// **بصورتها المطبَّعة**: «متى» تصير «متي» و«على» تصير «علي» بعد التطبيع، فكلمةٌ في هذه القائمة بلا تطبيع لا تُسقط شيئًا.
export const STOPWORDS=Object.freeze(new Set(['في','من','عن','على','الى','او','و','هل','كم','لي','لى','انا','ابي','ابغى','ابغي','ابغا','بغيت','اريد','ابيك','بدي','عايز','ودي',
  'نبي','نبغى','نبغي','محتاج','احتاج','اريد','كيف','وين','متى','ايش','وش','ما','لا','مو','مش','هذا','هذه','ال','عندي','عندنا','لنا','لكم','بعد','قبل','الان','اليوم','بكره','بكرا',
  'اطلب','طلب','عندك','عندكم','لو','سمحت','سمحتوا','ممكن','ليش','ليه','فيه','فيها','عليه','عليها','له','لها','مع','بس','ايضا','كمان','تكفى','تكفون',
  'حقي','حقتي','حقنا','اسوي','سوي','اطلع','اروح','اجي','اغير','ابدل','اضيف','ازيد','اخذ','اخذت','خلص','خلصت','انتهى','انتهت',
  'the','a','an','i','my','to','for','of','in','need','want'].map(normalizeArabic)));
// «طلب» تُسقط من الاستعلام لا من الأسماء: نصفُ أسماء الدليل يبدأ بها فلا تميّز شيئًا؛ لكن استعلامًا كله كلمات ربط يبقى كما هو.
export function terms(query){
  const all=normalizeArabic(query).split(' ').filter(Boolean);
  const kept=all.filter(t=>!STOPWORDS.has(t));
  return kept.length?kept:all;
}

/* ───── جذر خفيف ومسافة تحرير: نسختان مطابقتان لِما في app/arabic-text.mjs ───── */
const PREFIXES=['وال','بال','كال','فال','ولل','لل','ال'];
const SUFFIXES=['اتها','اتهم','تهما','هما','كما','تها','تهم','اتك','اته','ات','ون','ين','ان','ها','هم','هن','كم','ته','تي','نا','يه','ه','ي','ك'];
const MIN_STEM=3;
export function lightStem(word){
  let value=normalizeArabic(word);
  if(value.length<=MIN_STEM)return value;
  for(const prefix of PREFIXES)
    if(value.startsWith(prefix)&&value.length-prefix.length>=MIN_STEM){value=value.slice(prefix.length);break;}
  for(let pass=0;pass<2;pass++)
    for(const suffix of SUFFIXES){
      if(pass&&suffix.length<2)continue;
      if(value.endsWith(suffix)&&value.length-suffix.length>=MIN_STEM){value=value.slice(0,-suffix.length);break;}
    }
  return value;
}
export function withinDistance(a,b,limit){
  if(a===b)return 0;
  if(Math.abs(a.length-b.length)>limit)return -1;
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const row=[i];let best=i;
    for(let j=1;j<=b.length;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      row[j]=Math.min(previous[j]+1,row[j-1]+1,previous[j-1]+cost);
      if(row[j]<best)best=row[j];
    }
    if(best>limit)return -1;
    previous=row;
  }
  return previous[b.length]<=limit?previous[b.length]:-1;
}
const fuzzyLimit=term=>term.length>=7?2:term.length>=4?1:0;

/* ───── ما يُبحث فيه: البطاقات وأعضاء المجموعات، مسطَّحةً بترتيب الشجرة ───── */
const words=text=>normalizeArabic(text).split(' ').filter(Boolean);
// كل بندٍ يُبحث فيه مرة واحدة: بطاقات الفئة (خدمة، مجموعة، وحدة) ثم أعضاء مجموعاتها (browse=0) الذين تحملهم الحمولة في
// category.members. ترتيب العضو يسبق ترتيب مجموعته بكسر، فيتقدّمها عند التعادل ويبقى بعد ما قبلها في الشجرة.
// وبعد الفئات **خدمات صفحات الإدارات** (ت1، tree.department_only): الأربعون التي نُقل موضع عرضها إلى صفحة إدارتها بقرارَي د3 ود4
// تغيب عن «حسب الحاجة» ولا تغيب عن البحث — كلٌّ تحت «فئةٍ» باسم إدارته، بعد الباب الأمامي عند التعادل.
export function catalogEntries(tree){
  const entries=[];let order=0;
  for(const category of [...(tree.categories??[]),...(tree.department_only??[])]){
    const groupOrder=new Map();
    for(const item of category.cards??[]){order++;groupOrder.set(item.key,order);entries.push({category,item,order,member:false});}
    (category.members??[]).forEach((item,j)=>{
      const base=groupOrder.get(item.group_key)??order;
      entries.push({category,item,order:base-0.5+j*1e-4,member:true});
    });
  }
  return entries;
}
function prepared(entry,synonyms){
  const {item}=entry,key=`${item.kind}:${item.key}`;
  const name=normalizeArabic(item.name),nameWords=words(item.name);
  const syns=(synonyms?.[key]??[]).map(normalizeArabic).filter(Boolean),synWords=[...new Set(syns.flatMap(s=>s.split(' ')))];
  const optionWords=[...new Set((item.options??[]).flatMap(words))],options=(item.options??[]).map(normalizeArabic);
  const rest=normalizeArabic([item.description,item.key,item.module_name??''].join(' '));
  const stems=new Set([...nameWords,...synWords,...optionWords].map(lightStem));
  return {name,nameWords,syns,synWords,options,optionWords,rest,stems,fuzzyPool:[...new Set([...nameWords,...synWords])]};
}
// الكلمة بعد نزع «ال» حين يبقى منها حرفان فأكثر: الجذر الخفيف لا ينزعها دون ثلاثة (مطابقًا لخادم arabic-text.mjs)،
// فـ«الحج» و«الكرت» كانتا لا تجدان «حج» و«كرت». يُنظر في الاسم والمرادف وحدهما، لا في الوصف.
const bareOf=t=>t.length>=4&&t.startsWith('ال')?t.slice(2):null;
function termScore(t,p){
  if(p.name===t)return 6;
  if(p.name.startsWith(t)||p.nameWords.some(w=>w===t||(t.length>=2&&w.startsWith(t))))return 4;
  if(p.syns.includes(t)||p.synWords.includes(t))return 4;
  const bare=bareOf(t);
  if(bare&&(p.name===bare||p.nameWords.includes(bare)||p.syns.includes(bare)||p.synWords.includes(bare)))return 4;
  if(p.options.some(o=>o===t||o.startsWith(t))||p.optionWords.some(w=>w===t||(t.length>=2&&w.startsWith(t))))return 3;
  if(t.length>=3&&p.stems.has(lightStem(t)))return 2;
  if(p.rest.includes(t))return 1;
  const limit=fuzzyLimit(t);
  if(limit&&p.fuzzyPool.some(w=>w.length>=4&&withinDistance(t,w,limit)>=0))return 1;
  return 0;
}

// النتيجة: {hits:[{category,item,score,position,member}],used,ignored,partial}. البنود التي أصابتها كل الكلمات وحدها إن
// وُجدت، وإلا التي أصابها أكبر عددٍ منها — ثم بترتيب الدرجة، ثم العضو قبل مجموعته، ثم الشجرة. used الكلمات التي أصابت
// شيئًا فيما عُرض، وignored ما لم يُصِب (يُقال للطالب). الفارغة hits فارغة.
export function searchCatalog(tree,synonyms,query){
  const list=terms(query);
  if(!list.length)return {hits:[],used:[],ignored:[],partial:false};
  const q=list.join(' ');
  const scored=[];
  for(const entry of catalogEntries(tree)){
    const p=prepared(entry,synonyms);
    let score=0;const matched=[];
    for(const t of list){const s=termScore(t,p);if(s){score+=s;matched.push(t);}}
    if(!matched.length)continue;
    if(p.name===q||p.syns.includes(q))score+=6;
    scored.push({entry,score,matched});
  }
  scored.sort((a,b)=>b.matched.length-a.matched.length||b.score-a.score||a.entry.order-b.entry.order);
  const best=scored[0]?.matched.length??0;
  const kept=scored.filter(x=>x.matched.length===best);
  const used=list.filter(t=>kept.some(x=>x.matched.includes(t)));
  return {hits:kept.map((x,index)=>({category:x.entry.category,item:x.entry.item,score:x.score,position:index+1,member:x.entry.member})),
    used,ignored:list.filter(t=>!used.includes(t)),partial:best>0&&best<list.length};
}
// القائمة وحدها، للخادم الذي يعدّ النتائج ولمن لا يحتاج الكلمات المستعملة.
export const rankCatalog=(tree,synonyms,query)=>searchCatalog(tree,synonyms,query).hits;

// الجواب المباشر: ما تستطيع المنصة قوله بصدق عن النتيجة الأولى قبل أن تُفتح — مسارها وزمنها **بسنده** (preview من الخادم)
// وبابها. لا مادة سياسة (policy_reference نصّ حرّ بلا مفتاح)، ولا رصيد ولا نسبة: ما ليس في الحمولة لا يُقال.
export function directAnswer(hits){
  const first=hits[0]?.item;
  if(!first||first.kind!=='service'||!first.preview)return null;
  return {key:first.key,name:first.name,text:first.preview,target:first.target&&first.target.kind!=='unset'?first.target.label:null,href:first.href||null,
    via:first.group_name?`تُبلَغ أيضًا من بطاقة «${first.group_name}»`:null};
}
