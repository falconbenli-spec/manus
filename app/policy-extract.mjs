// إصلاح نص مستخرج من PDF عربي، وتفكيكه إلى مواد.
//
// المشكلة: مستخرج PDF يكتب الحروف بصور العرض (Arabic Presentation Forms) ويكتب الكلمات بترتيب الرسم لا بترتيب
// القراءة. في ملف اللائحة المعتمدة صنفان من السطور:
//   1) سطر حروفه سليمة وكلماته معكوسة: «العمل تنظيم لائحة» = «لائحة تنظيم العمل».
//   2) سطر معكوس بالكامل حرفًا حرفًا: «ةحئلالا هذه سمت لا» = «لا تمس هذه اللائحة».
// الصنف الثاني يُصلح بعكس السطر الخام قبل NFKC لا بعده: «ﻻ» حرف ربط واحد (lam-alef) يتحول بعد NFKC إلى حرفين،
// فعكسه بعدها يقلبهما فيصير «ال». العكس قبل NFKC يبقيه حرفًا واحدًا فيفك صحيحًا.
// الأرقام داخل السطر المعكوس تُعاد إلى اتجاهها: «٤٩١٥٥٨٢-١» تُقرأ «١-٢٨٥٥١٩٤».
//
// ما لا يُصلح آليًا: الكلمة التي رسمها PDF على دفعات فتركت تطويلًا داخلها («ﺣـﻘـ قﻮ» مكان «حقوق»). ترتيب الدفعات
// ليس ترتيب الموضع، فأي إعادة ترتيب تخمين. هذه المواضع تُوسم ولا تُخمَّن، ويبقى نصها للمطابقة مع الأصل الموقّع.

const PRESENTATION=/[ﭐ-﷿ﹰ-ﻼ]/;
const ARABIC=/[؀-ۿﭐ-﷿ﹰ-ﻼ]/;
const INVISIBLE=/[؜​-‏‪-‮⁦-⁩﻿]/g;
const TATWEEL=/ـ/g;
const MIRROR={'(':')',')':'(','[':']',']':'[','{':'}','}':'{','«':'»','»':'«','<':'>','>':'<'};

// كلمات تتكرر في نص نظامي عربي. وجودها في أحد الاتجاهين دليل على أنه اتجاه القراءة.
const COMMON=new Set(['في','من','على','عن','إلى','الى','أو','او','التي','الذي','هذه','هذا','ما','لا','مع','كل','بعد','قبل','عند','غير','بين','أن','ان','إذا','اذا','ذلك','لم','قد','به','له','لها','عليه','العمل','العامل','العاملين','المنشأة','المنشاة','اللائحة','الأجر','الاجر','المادة','يوم','أيام','ايام','سنة','الإجازة','الاجازة','يجوز','يجب','الرئيس','التنفيذي','نظام','وفق','طبقًا','حسب','وذلك','التالية','الحالات','مدة','خلال','حال','عقد']);

const nfkc=text=>text.normalize('NFKC').replace(INVISIBLE,'');
const reverseChars=text=>[...text].reverse().join('');
const mirror=text=>[...text].map(c=>MIRROR[c]??c).join('');

// موضع علامة الترقيم في النص المستخرج لا يدل على موضعها في القراءة: المستخرج يحل الأحرف المحايدة بقواعد
// اتجاه مختلفة عن الكلمات، فتظهر النقطة يمين كلمتها مرة ويسارها مرة. تُعاد بقاعدة الكتابة العربية لا بموضعها:
// علامة النهاية تلحق آخر كلمة في السطر، وفي وسط السطر تلحق الكلمة التي قبلها.
const CLOSING=/^[.،؛:!؟?]+/;
// «تصرف أو، إجراء» ← «تصرف، أو إجراء»: الفاصلة تسبق حرف العطف في الكتابة العربية، فتتخطاه إلى ما قبله.
const CONNECTOR=new Set(['أو','او','و','ثم','أم','ام']);
function placePunctuation(words){
  const out=words.slice();
  for(let i=0;i<out.length;i++){
    const mark=out[i].match(CLOSING)?.[0];
    if(!mark||out[i].length===mark.length)continue;
    const rest=out[i].slice(mark.length);
    if(i===out.length-1){out[i]=rest+mark;continue;}
    out[i]=rest;
    const back=i>1&&CONNECTOR.has(out[i-1])?i-2:i-1;
    if(back>=0)out[back]+=mark;else out[i]=mark+rest;
  }
  // حرف عطف حمل الفاصلة وحده («أو،») يردّها إلى الكلمة التي قبله.
  for(let i=1;i<out.length;i++){
    const m=out[i].match(/^(أو|او|و|ثم|أم|ام)([،؛:.]+)$/u);
    if(!m)continue;
    out[i-1]+=m[2];out[i]=m[1];
  }
  // التشكيل في أول الكلمة تنوين انفصل عن آخرها، ولو سبقته شرطة أو قوس: «-ًذكرا» ← «-ذكراً».
  return out.map(w=>w.replace(/^([^\p{L}\p{N}]*)([ً-ٕ]+)(.+)$/u,(_,lead,marks,rest)=>lead+rest+marks));
}

// احتمال أن يكون النص في اتجاه القراءة. إشارات بنيوية في العربية: «ال» بادئة لا لاحقة، والتاء المربوطة
// والألف المقصورة لا تبدأ كلمة. تُضاف إليها الكلمات الشائعة. الدرجة نسبية: تُقارن بدرجة النص معكوسًا.
export function readingScore(text){
  const words=String(text).replace(TATWEEL,'').split(/[^\p{L}]+/u).filter(w=>w.length>1&&ARABIC.test(w));
  if(!words.length)return 0;
  let score=0;
  for(const word of words){
    if(COMMON.has(word))score+=3;
    if(word.startsWith('ال'))score+=2;
    if(/[ةىء]$/.test(word))score+=2;
    if(/(ات|ين|ون|ها|هم)$/.test(word))score+=1;
    if(/^[ةى]/.test(word))score-=3;
  }
  return score/words.length;
}

// «اً» أو «ً» وحدها كلمة: تنوين انفصل عن كلمته عند الاستخراج. يلتحق بالكلمة التي تسبقه في القراءة:
// «يوم اً» ← «يوماً». لا يلتحق بشيء إن جاء أول السطر، فيُحذف بدل أن يُلصق بالخطأ.
const LOOSE_TANWEEN=/^[ً-ٕ]{1,2}ا?$|^ا[ً-ٕ]$/;
function joinLooseMarks(words){
  const out=[];
  for(const word of words){
    if(LOOSE_TANWEEN.test(word)&&out.length){out[out.length-1]+=word;continue;}
    out.push(word);
  }
  return out;
}

// سطر واحد. تُعاد صورته في اتجاه القراءة مع وسم ما بقي مشكوكًا فيه.
export function repairLine(raw){
  const line=String(raw??'').replace(INVISIBLE,'');
  if(!ARABIC.test(line))return {text:nfkc(line).trim(),mode:'plain',artifacts:[]};
  const artifacts=[];
  if(TATWEEL.test(line))artifacts.push('tatweel_split');
  const forward=nfkc(line);
  // الرقم داخل السطر المقلوب مقلوب مثله: «٤٩١٥٥٨٢-١» تُقرأ بعد العكس «١-٢٨٥٥١٩٤» وهو رقم الملف الصحيح،
  // فلا يُعاد تتابع الأرقام إلى اتجاهه مرة ثانية.
  const reversed=mirror(nfkc(reverseChars(line)));
  let text,mode;
  if(readingScore(reversed)>readingScore(forward)){text=reversed;mode='reversed';}
  else{
    // حروف الكلمة سليمة وترتيب الكلمات مرسوم من اليسار: تُعكس الكلمات ثم تُردّ علامات الترقيم إلى مواضعها.
    text=placePunctuation(mirror(forward).split(/\s+/).filter(Boolean).reverse()).join(' ');
    mode='word-order';
  }
  // حروف تُكتب موصولة دائمًا (و ف ب ل ك) خرجت منفصلة: تُوصل بما بعدها، فلا تُعد حرفًا يتيمًا.
  const words=joinLooseMarks(text.replace(TATWEEL,'').split(/\s+/).filter(Boolean)),joined=[];
  for(let i=0;i<words.length;i++){
    if(/^[وفبلك]$/.test(words[i])&&i+1<words.length&&/^[ء-ي]/.test(words[i+1])){joined.push(words[i]+words[i+1]);i++;continue;}
    joined.push(words[i]);
  }
  text=joined.join(' ');
  // حرف عربي وحيد بين فراغين ليس كلمة: بقية كلمة قطعها الاستخراج.
  if(/(^|\s)[ء-ي](\s|$)/.test(text))artifacts.push('orphan_letter');
  return {text:text.trim(),mode,artifacts};
}

export function repairText(raw){
  const lines=String(raw??'').split(/\r?\n/).map(repairLine);
  return {text:lines.map(l=>l.text).join('\n'),lines};
}

// ── إعادة ترتيب الجملة المعلّقة ────────────────────────────────────────────────
// في اللائحة المستخرجة تظهر «؛» وحدها في سطر. حولها نمط ثابت: السطر الذي قبلها قطعة رُسمت قبل موضعها،
// وموضعها بعد السطر الذي يلي «؛». مثال من م46:
//   «تدفع أجور العمال بالعملة الرسمية للبلاد في مواعيد» / «؛» / «مع مراعاة … برنامج حماية الأجور» / «استحقاقها وتودع…»
//   تُقرأ: «مع مراعاة … برنامج حماية الأجور؛ تدفع أجور العمال … في مواعيد استحقاقها وتودع…».
// الاستثناء: إن كانت القطعة أول سطر في المادة وكانت عنوانًا (اسم لا فعل) فهي عنوان المادة لا قطعة، فتبقى مكانها.
// هذا استنتاج من النمط لا نص موقّع: كل مادة أُعيد فيها الترتيب تُوسم clause_reflow وتدخل قائمة المطابقة.
const CLAUSE_START=/^(?:[يتنأ]\p{L}{2,}|و?(?:على|في|من|مع|أو|إذا|مالم|ما|سواء|بما|عند|بعد|قبل|دون|حسب|وفق|أن|لا|ولا|ثم|كما|غير|حتى|إلى|بحيث|التي|الذي|كل|لكل|لل\p{L}+|ل\p{L}+))(?:$|\s|[،؛:.])/u;
const looksLikeClause=line=>CLAUSE_START.test(line.trim());
export function reflowClauses(lines){
  // «؛ على أن تسترجع…» في أول سطر: الفاصلة المنقوطة علامة القطعة نفسها ولو لم تنفرد بسطر. تُفصل ثم يُطبَّق النمط.
  const out=[];let moved=0;
  for(const line of lines){
    const split=line.trim().match(/^؛\s*(.+)$/);
    if(split){out.push('؛',split[1]);continue;}
    out.push(line);
  }
  for(let i=0;i<out.length;i++){
    if(out[i].trim()!=='؛')continue;
    // القطعة أول المادة: موضعها بعد السطر الذي يليها، فيتقدم السطر التالي ويلحقه الباقي.
    if(i===0&&out.length>=3){out.splice(0,3,`${out[2]}؛`,out[1]);moved++;continue;}
    if(i===0||i+1>=out.length){out.splice(i,1);i--;continue;}
    const fragment=out[i-1],next=out[i+1];
    if(i-1===0&&!looksLikeClause(fragment)){out[i]=`${next}؛`;out.splice(i+1,1);continue;}
    out.splice(i-1,3,`${next}؛`,fragment);moved++;i--;
  }
  return {lines:out,moved};
}

// ── الفقرات المرقّمة ───────────────────────────────────────────────────────────
// البنود تخرج «.1» و«.2» و«أ.» و«ب.». تُعاد إلى صورتها ويُفتح ببند جديد فقرة جديدة؛ ما بينها استكمال للفقرة.
const ITEM=/^(?:\.\s*(\d{1,2})|(\d{1,2})\s*[.\-])\s+|^([أ-ي])\s*[.\-]\s+/u;
export function splitParagraphs(lines){
  const items=[];
  for(const line of lines){
    const text=line.trim();if(!text)continue;
    const m=text.match(ITEM);
    if(m||!items.length)items.push({marker:m?(m[1]??m[2]??m[3]):null,text:m?text.slice(m[0].length).trim():text});
    else items[items.length-1].text+=' '+text;
  }
  return items.map((item,index)=>({index:index+1,marker:item.marker,text:item.text.replace(/\s+/g,' ').trim()})).filter(p=>p.text);
}

// ── أرقام المواد بالحروف ───────────────────────────────────────────────────────
// «وفق المادة السادسة والعشرين» إحالة إلى م26، و«الثمانون» في متن م80 اسمها. الفهرس يخزن الرقمين معًا
// فيجد الباحث المادة سواء كتب «٨٠» أو «الثمانون».
const UNITS={'اول':1,'اولي':1,'حادي':1,'حاديه':1,'واحد':1,'ثاني':2,'ثانيه':2,'اثنان':2,'اثني':2,'ثالث':3,'ثالثه':3,'ثلاث':3,'رابع':4,'رابعه':4,'اربع':4,'خامس':5,'خامسه':5,'خمس':5,'سادس':6,'سادسه':6,'ست':6,'سابع':7,'سابعه':7,'سبع':7,'ثامن':8,'ثامنه':8,'ثمان':8,'ثمانيه':8,'تاسع':9,'تاسعه':9,'تسع':9};
const TENS={'عاشر':10,'عاشره':10,'عشر':10,'عشره':10,'عشرون':20,'عشرين':20,'ثلاثون':30,'ثلاثين':30,'اربعون':40,'اربعين':40,'خمسون':50,'خمسين':50,'ستون':60,'ستين':60,'سبعون':70,'سبعين':70,'ثمانون':80,'ثمانين':80,'تسعون':90,'تسعين':90};
const HUNDRED={'مائه':100,'مئه':100,'ماءه':100,'مايه':100};
// يُطبَّق على صورة مطبّعة (أ إ آ ← ا، ة ← ه، ى ← ي) كما يخرجها arabic-text.normalize.
const bare=word=>word.replace(/^(?:و)?(?:ال)?/,'');
export function numberFromWords(words){
  let total=0,seen=false,unit=null;
  for(const word of words){
    const w=bare(word);
    if(Object.hasOwn(UNITS,w)){if(unit!==null)return seen?total:null;unit=UNITS[w];seen=true;continue;}
    if(Object.hasOwn(TENS,w)){
      // «الحادية عشرة» = 11 (وحدة ثم عشرة)، و«السادسة والعشرين» = 26 (وحدة ثم عشرون).
      total+=TENS[w]+(unit??0);unit=null;seen=true;continue;
    }
    if(Object.hasOwn(HUNDRED,w)){total+=HUNDRED[w];seen=true;continue;}
    if(unit!==null){total+=unit;unit=null;}
    if(seen)break;
  }
  if(unit!==null)total+=unit;
  return seen&&total>0?total:null;
}
// يمسح نصًا مطبّعًا فيعيد كل رقم مادة مكتوب بالحروف مع موضعه.
export function spelledNumbers(normalizedText){
  const words=String(normalizedText).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const found=[];
  for(let i=0;i<words.length;i++){
    const w=bare(words[i]);
    if(!Object.hasOwn(UNITS,w)&&!Object.hasOwn(TENS,w)&&!Object.hasOwn(HUNDRED,w))continue;
    let best=null,bestEnd=i;
    for(let end=i+1;end<=Math.min(words.length,i+5);end++){
      const value=numberFromWords(words.slice(i,end));
      if(value!==null&&value<=200){best=value;bestEnd=end;}
    }
    if(best!==null){found.push({value:best,at:i});i=bestEnd-1;}
  }
  return found;
}
