// تطبيع النص العربي للبحث. الكلمة الواحدة تُكتب في المنصة بصور كثيرة — «الإجازة» و«الاجازه» و«الأجازة» —
// فتسقط المطابقة الحرفية على فرق لا يقصده أحد. التطبيع يوحّد هذه الصور قبل الفهرسة وقبل الاستعلام معًا،
// فيبقى الفهرس والاستعلام على صورة واحدة. النص الأصلي يبقى كما أدخله صاحبه؛ المطبَّع نسخة للبحث فقط.

// العلامات التي لا تغيّر الكلمة: التشكيل (064B–0655 يشمل التنوين والحركات والسكون والشدة والمدة والهمزتين)
// والألف الخنجرية (0670)، وعلامات الاتجاه وصفر العرض التي تدخل مع النسخ واللصق فتكسر المطابقة دون أن تُرى.
const MARKS=/[ً-ٰٕ]/g;
const INVISIBLE=/[؜​-‏‪-‮⁦-⁩﻿]/g;
const TATWEEL=/ـ/g;
// توحيد صور الحرف الواحد. الهمزة على أي كرسي ألف ← ألف، والألف المقصورة ← ياء، والتاء المربوطة ← هاء.
const LETTERS={'آ':'ا','أ':'ا','إ':'ا','ٱ':'ا','ى':'ي','ة':'ه','ؤ':'و','ئ':'ي'};
const LETTER_PATTERN=/[آأإٱىةؤئ]/g;
// الأرقام الهندية (٠–٩) والفارسية (۰–۹) ← أرقام لاتينية، فيجد من كتب «١٢٣» ما سُجّل «123».
const DIGITS=/[٠-٩۰-۹]/g;
const digit=character=>{const code=character.codePointAt(0);return String(code-(code<=0x0669?0x0660:0x06F0));};

export function normalize(text){
  if(text===null||text===undefined)return '';
  // NFKC أولًا: يُرجع صور العرض والحروف المركبة إلى صورتها القياسية قبل أي استبدال.
  return String(text).normalize('NFKC')
    .replace(INVISIBLE,'')
    .replace(MARKS,'')
    .replace(TATWEEL,'')
    .replace(LETTER_PATTERN,character=>LETTERS[character])
    .replace(DIGITS,digit)
    .toLowerCase()
    .replace(/\s+/g,' ')
    .trim();
}

// كلمات البحث بعد التطبيع: ما ليس حرفًا ولا رقمًا فاصلٌ، فلا تدخل رموز صيغة FTS5 في الاستعلام.
export function tokens(text){
  return normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// ── جذر خفيف ───────────────────────────────────────────────────────────────────
// «إجازة» و«الإجازات» و«إجازته» كلمة واحدة عند من يبحث. لا نصرّف العربية تصريفًا كاملًا — ذلك يحتاج معجمًا —
// بل نقشر السوابق واللواحق الشائعة ونقف عند ثلاثة أحرف، فلا ينهار الجذر إلى حرفين يطابقان كل شيء.
// يعمل على الصورة المطبّعة (ة ← ه، ى ← ي)، فلا يحتاج إلى صور الهمزة.
// السوابق المقشورة أداة تعريف وجر فقط. الحرف الواحد (و ف ب ك ل س) لا يُقشر: هو أصلي في «كامل» و«بيان» و«وفاة»،
// وقشره يجعلها «امل» و«يان» و«فاه» فتتطابق كلمات لا علاقة بينها. «والإجازات» يغطيها «وال» المركبة.
const PREFIXES=['وال','بال','كال','فال','ولل','لل','ال'];
const SUFFIXES=['اتها','اتهم','تهما','هما','كما','تها','تهم','اتك','اته','ات','ون','ين','ان','ها','هم','هن','كم','ته','تي','نا','يه','ه','ي','ك'];
const MIN_STEM=3;
export function stem(word){
  let value=normalize(word);
  if(value.length<=MIN_STEM)return value;
  for(const prefix of PREFIXES)
    if(value.startsWith(prefix)&&value.length-prefix.length>=MIN_STEM){value=value.slice(prefix.length);break;}
  // الجولة الثانية للواحق المركبة وحدها؛ لو قشرت حرفًا واحدًا مرة أخرى لصارت «مملكه» ← «مملك» ← «ممل».
  for(let pass=0;pass<2;pass++)
    for(const suffix of SUFFIXES){
      if(pass&&suffix.length<2)continue;
      if(value.endsWith(suffix)&&value.length-suffix.length>=MIN_STEM){value=value.slice(0,-suffix.length);break;}
    }
  return value;
}

// مسافة تحرير محدودة: تتوقف فور تجاوز الحد بدل أن تكمل الجدول، فالبحث لا يدفع ثمن كلمة بعيدة.
// تُستعمل لأخطاء الكتابة الصغيرة («انتذاب» ← «انتداب») على الصورة المطبّعة وحدها.
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

// مقتطف من النص الأصلي حول أول كلمة طابقت. المطابقة على الصورة المطبّعة، والعرض بالنص كما كُتب.
export function snippet(text,query,words=14){
  const source=String(text??'').split(/\s+/).filter(Boolean);
  if(!source.length)return '';
  const wanted=tokens(query);
  const at=wanted.length?source.findIndex(word=>{const w=normalize(word);return wanted.some(token=>w.includes(token));}):0;
  const start=Math.max(0,(at<0?0:at)-Math.floor(words/3));
  const cut=source.slice(start,start+words).join(' ');
  return `${start>0?'… ':''}${cut}${start+words<source.length?' …':''}`;
}
