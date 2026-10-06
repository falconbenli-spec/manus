// فهرس مكتبة السياسات: مبني باليد، بلا مكتبة بحث ولا حزمة خارجية.
//
// اللائحة 127 مادة. الفهرس المقلوب كله يسكن الذاكرة ويُبنى في أجزاء من الثانية، فلا داعي لـ FTS5 ولا لمكتبة:
// ما نحتاجه هو ما لا تعطيه المطابقة الحرفية — تطبيع عربي، جذر خفيف، مرادفات يحررها الأدمن، تسامح مع خطأ كتابة،
// وأرقام مكتوبة بالحروف. كلها مكتوبة هنا صراحةً كي يقرأها من يصونها.
//
// الترتيب tf-idf بأوزان حقول: العنوان أثقل من المتن لأن من يبحث «إجازة الوضع» يريد المادة المعنونة بها لا كل
// مادة ذكرتها عرضًا. المرادف والتقريب يدخلان بوزن أقل من الكلمة كما كُتبت، فلا يسبق تخمينٌ مطابقةً صريحة.
import { normalize, tokens, stem, withinDistance } from './arabic-text.mjs';
import { spelledNumbers } from './policy-extract.mjs';

const FIELD_WEIGHT={title:4,keywords:2.5,body:1};
const SYNONYM_WEIGHT=0.7;
const FUZZY_WEIGHT=0.45;
const STEM_WEIGHT=0.8;
// كلمات وظيفية تتكرر في كل مادة فلا تميز مادة عن أخرى. تُفهرس ولا تُرجّح.
const STOP=new Set(['في','من','على','عن','الى','او','التي','الذي','هذه','هذا','ما','لا','مع','كل','بعد','قبل','عند','غير','بين','ان','اذا','ذلك','لم','قد','به','له','لها','عليه','هو','هي','ثم','وان','او','كما','حتى','الا','اي','مما','وفق','وذلك','عليها']);

// رقم المادة من استعلام مباشر: «65» «٦٥» «مادة 65» «م65» «م/65» «المادة رقم 65».
const DIRECT=/^(?:(?:ال)?ماده|م)?\s*(?:رقم)?\s*[\/\-]?\s*(\d{1,3})$/;
export function directArticle(query){
  const match=normalize(query).match(DIRECT);
  if(!match)return null;
  const number=Number(match[1]);
  return number>=1&&number<=999?number:null;
}

// ── بناء الفهرس ────────────────────────────────────────────────────────────────
// صفوف المواد ← فهرس مقلوب. لا يُحفظ في قاعدة البيانات: بناؤه أرخص من صيانة جدول مشتق يمكن أن يتأخر عن مصدره.
export function buildIndex(articles){
  const postings=new Map();      // كلمة ← [{id, weight}]
  const byStem=new Map();        // جذر ← مجموعة كلمات الفهرس
  const byNumber=new Map();      // رقم مادة (رقمًا أو حروفًا) ← مجموعة معرفات
  const bigrams=new Map();       // ثنائية حروف ← مجموعة كلمات، لتوليد مرشحي التقريب بلا مسح كامل
  const docs=new Map();
  const add=(word,id,weight)=>{
    if(!word)return;
    let list=postings.get(word);
    if(!list)postings.set(word,list=new Map());
    list.set(id,(list.get(id)??0)+weight);
  };
  for(const article of articles){
    const fields={title:article.title??'',keywords:(article.keywords??[]).join(' '),body:article.body??''};
    let length=0;
    for(const [field,text] of Object.entries(fields)){
      const words=tokens(text);
      length+=words.length;
      for(const word of words){
        const weight=FIELD_WEIGHT[field]*(STOP.has(word)?0.1:1);
        add(word,article.id,weight);
        const root=stem(word);
        if(root!==word){add(root,article.id,weight*STEM_WEIGHT);let set=byStem.get(root);if(!set)byStem.set(root,set=new Set());set.add(word);}
        for(let i=0;i+2<=word.length;i++){const gram=word.slice(i,i+2);let set=bigrams.get(gram);if(!set)bigrams.set(gram,set=new Set());set.add(word);}
      }
    }
    // كلمات العنوان وجذورها: في مكتبة سياسات العنوان هو موضوع المادة، فمطابقته دليل أقوى من ورود الكلمة في المتن.
    const titleTokens=new Set();
    for(const word of tokens(fields.title)){titleTokens.add(word);titleTokens.add(stem(word));}
    docs.set(article.id,{article,length:Math.max(length,1),titleTokens});
    // الرقم يدخل الفهرس رقمًا وحروفًا معًا: «الثمانون» في متن م80 و«٨٠» و«80» تصل كلها إلى المادة نفسها.
    const numbers=new Set([article.number,...(article.numbers??[]),...spelledNumbers(normalize(`${article.title} ${article.body}`)).map(n=>n.value)]);
    for(const value of numbers){let set=byNumber.get(value);if(!set)byNumber.set(value,set=new Set());set.add(article.id);}
  }
  const averageLength=[...docs.values()].reduce((sum,d)=>sum+d.length,0)/Math.max(docs.size,1);
  return {postings,byStem,byNumber,bigrams,docs,averageLength,built_at:new Date().toISOString(),entries:postings.size};
}

// ── المرادفات ──────────────────────────────────────────────────────────────────
// قاموس يحرره الأدمن: «سكليف» ليست في نص اللائحة، لكنها ما يكتبه الموظف. المجموعة متكافئة في الاتجاهين.
export function synonymGroups(rows){
  const groups=new Map();
  for(const row of rows){
    if(row.active===0)continue;
    const head=normalize(row.head);
    let set=groups.get(head);
    if(!set)groups.set(head,set=new Set([head]));
    set.add(normalize(row.term));
  }
  // كل عضو مفتاح لمجموعته بصورتيه: المطبّعة وجذرها. «الأمومة» تُطبّع «الامومه» ولا تساوي «امومه»، لكن جذرهما واحد،
  // فالفهرسة بالجذر أيضًا تجعل المرادف يعمل مع «ال» التعريف وضمائر الإضافة.
  const byTerm=new Map();
  const put=(key,set)=>{
    if(!key)return;
    let all=byTerm.get(key);
    if(!all)byTerm.set(key,all=new Set());
    for(const other of set)all.add(other);
  };
  for(const set of groups.values())for(const term of set){
    put(term,set);
    if(!term.includes(' '))put(stem(term),set);
  }
  return byTerm;
}
// عبارة مرادفة من كلمتين («سفر عمل») لا تُلتقط كلمةً كلمة: تُطابق على النص المطبّع كاملًا قبل التقطيع.
export function expandQuery(query,byTerm){
  const normalized=normalize(query);
  const expanded=new Set();
  for(const [term,set] of byTerm)
    if(term.includes(' ')&&normalized.includes(term))for(const other of set)expanded.add(other);
  const words=tokens(query);
  for(const word of words){
    for(const other of byTerm.get(word)??[])expanded.add(other);
    const root=stem(word);
    for(const other of byTerm.get(root)??[])expanded.add(other);
  }
  for(const word of words)expanded.delete(word);
  return [...expanded];
}

// ── التقريب ────────────────────────────────────────────────────────────────────
// «انتذاب» ← «انتداب». المرشحون من الثنائيات المشتركة وحدها، فلا تُقاس المسافة على كل كلمات الفهرس.
const limitFor=word=>word.length<=4?0:word.length<=6?1:2;
export function fuzzyMatches(word,index){
  const limit=limitFor(word);
  if(!limit||index.postings.has(word))return [];
  const seen=new Set(),out=[];
  for(let i=0;i+2<=word.length;i++)for(const candidate of index.bigrams.get(word.slice(i,i+2))??[]){
    if(seen.has(candidate))continue;
    seen.add(candidate);
    const distance=withinDistance(word,candidate,limit);
    if(distance>0)out.push({word:candidate,distance,seen:index.postings.get(candidate)?.size??0});
  }
  if(!out.length)return out;
  // عند تساوي المسافة تُقدَّم الكلمة الأكثر ورودًا: من أخطأ حرفًا أراد على الأرجح الكلمة التي تتكرر في اللائحة.
  const nearest=Math.min(...out.map(c=>c.distance));
  return out.filter(c=>c.distance===nearest).sort((a,b)=>b.seen-a.seen||a.word.length-b.word.length).slice(0,2);
}

// ── البحث ──────────────────────────────────────────────────────────────────────
// BM25: تكرار الكلمة يُشبع بدل أن يتراكم. بدونها تتصدّر مادةٌ كررت «إجازة» عشر مرات على المادة التي فيها «زواج»
// مرة واحدة، ومن كتب «إجازة زواج» يريد الثانية. k1 حد الإشباع، وb قدر أثر طول المادة.
const K1=1.2,B=0.6;
// أثر مطابقة العنوان. «إجازة الأمومة» يجب أن تُنزل على المادة المعنونة بإجازة الوضع، لا على كل مادة ذكرت ولادة.
const TITLE_BOOST=1.6;
// درجة مطابقة كلمة واحدة في مادة واحدة (BM25 معدّلة بطول المادة).
function termScores(index,word,weight){
  const list=index.postings.get(word);
  if(!list)return null;
  // idf: كلمة في كل المواد لا تميّز شيئًا؛ كلمة في مادتين تميّز كثيرًا.
  const idf=Math.log(1+(index.docs.size-list.size+0.5)/(list.size+0.5));
  const out=new Map();
  for(const [id,raw] of list){
    const doc=index.docs.get(id);
    const norm=K1*(1-B+B*doc.length/index.averageLength);
    out.set(id,weight*idf*((raw*(K1+1))/(raw+norm)));
  }
  return out;
}
// «براتب» = ب + راتب. لا يُقشَّر الحرف الواحد في الفهرس (يُتلف «كامل» و«بيان»)، لكن في الاستعلام وحده
// تُجرَّب الصورة المقشورة كمرشح إضافي بوزن أقل: خطأ هنا يكلّف نتيجة زائدة لا فهرسًا تالفًا.
const stripParticle=word=>/^[بلكفوس][ء-ي]{3,}$/.test(word)?word.slice(1):null;

// المفهوم لا الكلمة: «أمومة» و«ولادة» و«وضع» مفهوم واحد سجّله الأدمن. تُجمع صوره في مفهوم واحد فلا تُحتسب
// المادة التي صادفت صورة نادرة منه ثلاث مرات كأنها طابقت ثلاثة معانٍ، وتبقى التغطية قياسًا لما فهمه البحث فعلًا.
function concepts(index,query,byTerm,trace,fuzzy,unmatched){
  const words=tokens(query).filter(w=>w.length>1||/\d/.test(w));
  const out=[];
  for(const word of words){
    if(/^\d+$/.test(word))continue;
    const group=byTerm.get(word)??byTerm.get(stem(word));
    const variants=[{words:[word],weight:1,why:'word'}];
    const root=stem(word);
    if(root!==word)variants.push({words:[root],weight:STEM_WEIGHT,why:'stem'});
    const bare=stripParticle(word);
    if(bare){variants.push({words:[bare],weight:STEM_WEIGHT,why:'particle'});const bareRoot=stem(bare);if(bareRoot!==bare)variants.push({words:[bareRoot],weight:STEM_WEIGHT*STEM_WEIGHT,why:'particle'});}
    // المرادف المكوَّن من كلمتين («إجازة مرضية») صورة واحدة تُجمع كلماتها، لا كلمتين تتنافسان: «سكليف» تعني
    // العبارة كلها. لولا الجمع لغلب «إجازة» وحدها وهي شائعة، ولضاعت المادة التي فيها العبارة كاملة.
    if(group)for(const term of group){
      if(term===word)continue;
      const parts=tokens(term);
      if(!parts.length)continue;
      variants.push({words:parts,weight:SYNONYM_WEIGHT,why:'synonym'},{words:parts.map(stem),weight:SYNONYM_WEIGHT*STEM_WEIGHT,why:'synonym'});
    }
    // الكلمة التي لها مرادف مسجّل لا تُقرَّب: «سكليف» لها معنى معروف، وتقريبها يجرّها إلى «تكليف».
    if(!group&&!index.postings.has(word)&&!index.postings.has(root))
      for(const candidate of fuzzyMatches(word,index)){
        variants.push({words:[candidate.word],weight:FUZZY_WEIGHT/candidate.distance,why:'fuzzy'});
        fuzzy.push({from:word,to:candidate.word,distance:candidate.distance});
      }
    const known=variants.filter(x=>x.words.some(w=>index.postings.has(w)));
    if(!known.length){unmatched.push(word);continue;}
    for(const x of known)for(const w of x.words)if(index.postings.has(w))trace.push({word:w,matched:index.postings.get(w).size,why:x.why});
    out.push({key:word,content:!STOP.has(word)&&word.length>2,variants:known});
  }
  // عبارة مرادفة من كلمتين («سفر عمل») مفهوم مستقل: تُطابق على النص كاملًا لا كلمةً كلمة.
  const normalized=normalize(query);
  for(const [term,group] of byTerm){
    if(!term.includes(' ')||!normalized.includes(term))continue;
    const variants=[];
    for(const other of group){
      const parts=tokens(other);
      if(parts.length)variants.push({words:parts,weight:SYNONYM_WEIGHT,why:'synonym'},{words:parts.map(stem),weight:SYNONYM_WEIGHT*STEM_WEIGHT,why:'synonym'});
    }
    const known=variants.filter(x=>x.words.some(w=>index.postings.has(w)));
    if(known.length)out.push({key:'phrase:'+term,content:true,variants:known});
  }
  return out;
}

export function search(index,query,{byTerm=new Map(),limit=20,filter=null}={}){
  const words=tokens(query).filter(w=>w.length>1||/\d/.test(w));
  const trace=[],unmatched=[],fuzzy=[];
  const totals=new Map(),matched=new Map(),why=new Map();
  const add=(id,value,reason,key)=>{
    totals.set(id,(totals.get(id)??0)+value);
    if(!why.has(id))why.set(id,new Set());
    why.get(id).add(reason);
    if(key){if(!matched.has(id))matched.set(id,new Set());matched.get(id).add(key);}
  };
  // رقم في الاستعلام: مطابقة رقم المادة أقوى من أي مطابقة نصية، فمن كتب «٨٢» يريد المادة 82 لا كل مادة ذكرت 82.
  for(const word of words){
    if(!/^\d+$/.test(word))continue;
    for(const id of index.byNumber.get(Number(word))??[])add(id,60,'number','number:'+word);
  }
  for(const value of spelledNumbers(normalize(query)))
    for(const id of index.byNumber.get(value.value)??[])add(id,30,'number_words','number:'+value.value);
  const found=concepts(index,query,byTerm,trace,fuzzy,unmatched);
  const synonyms=expandQuery(query,byTerm);
  for(const concept of found){
    // أعلى صورة للمفهوم في كل مادة، لا مجموع صوره: المادة لا تُكافأ على أن اللغة تعرف للمعنى ألفاظًا كثيرة.
    const best=new Map(),reason=new Map();
    for(const variant of concept.variants){
      const sum=new Map();
      for(const word of variant.words){
        const scores=termScores(index,word,variant.weight);
        if(!scores)continue;
        for(const [id,value] of scores)sum.set(id,(sum.get(id)??0)+value);
      }
      for(const [id,value] of sum)if(!best.has(id)||value>best.get(id)){best.set(id,value);reason.set(id,variant.why);}
    }
    for(const [id,value] of best)add(id,value,reason.get(id),concept.content?concept.key:null);
  }
  const contentConcepts=found.filter(c=>c.content);
  // المقام كل كلمة ذات معنى كتبها السائل، لا ما عرفه الفهرس منها وحده: الكلمة التي لم يعرفها الفهرس جزء من سؤاله،
  // وتجاهلها يجعل مادةً لامست كلمة واحدة تبدو جوابًا كاملًا.
  const askedContent=new Set(words.filter(w=>!STOP.has(w)&&w.length>2&&!/^\d+$/.test(w)));
  const expected=Math.max(askedContent.size,contentConcepts.length,1);
  const scored=[];
  for(const [id,total] of totals){
    const doc=index.docs.get(id);
    if(!doc)continue;
    const hits=matched.get(id)??new Set();
    // لا نتيجة بلا كلمة ذات معنى: «في» و«على» وحدهما لا تجعلان مادةً جوابًا لسؤال.
    if(contentConcepts.length&&!hits.size)continue;
    const coverage=Math.min(hits.size/expected,1);
    // سؤال طويل لم يُفهم منه إلا كلمة واحدة ليس له جواب هنا. عرض مادة لامست كلمة عابرة أسوأ من قول «لا يوجد نص»:
    // الأول يوهم القارئ أنه وجد سنده، والثاني يرسله إلى الموارد البشرية.
    if(expected>=3&&coverage<0.4)continue;
    // مطابقة العنوان: نسبة مفاهيم الاستعلام التي يحملها عنوان المادة نفسه.
    const inTitle=contentConcepts.filter(c=>c.variants.some(v=>v.words.some(w=>doc.titleTokens.has(w)))).length;
    const titleCoverage=inTitle/expected;
    // النص المستبدل أو المعدّل يُنزَّل عن النص المعمول به: الباحث يجب أن يقع على ما يسري اليوم، والقديم يبقى
    // ظاهرًا تحته مع شارته ورابط «عرض النص الأصلي» فلا يُخفى عنه شيء.
    const inForce=doc.article.status==='in_force'?1:0.8;
    scored.push({article:doc.article,score:total*(0.4+0.6*coverage)*(1+TITLE_BOOST*titleCoverage)*inForce,why:[...(why.get(id)??[])],coverage,title_coverage:titleCoverage});
  }
  const best=scored.reduce((m,r)=>Math.max(m,r.score),0);
  const results=scored
    .filter(r=>!filter||filter(r.article))
    // أرضية نسبية: ما دون عُشر أفضل نتيجة ضجيج لا جواب، فلا تمتلئ الصفحة بمواد لامست كلمة واحدة شائعة.
    .filter(r=>r.score>=Math.max(best*0.1,0.35))
    // المادة السارية قبل المعدلة أو المستبدلة عند تساوي الدرجة: البحث يُنزل من يبحث على النص المعمول به.
    .sort((a,b)=>b.score-a.score||(a.article.status==='in_force'?0:1)-(b.article.status==='in_force'?0:1)||a.article.number-b.article.number)
    .slice(0,limit);
  return {results,trace,unmatched,fuzzy,synonyms,words};
}

// ── المقتطف الموسوم ────────────────────────────────────────────────────────────
// يعيد قطعًا {text,hit}؛ الواجهة تُهرّب كل قطعة ثم تلف المطابقة بـ<mark>. لا HTML يخرج من هنا.
export function excerpt(text,query,{words=26}={}){
  const source=String(text??'').split(/\s+/).filter(Boolean);
  if(!source.length)return {parts:[],truncated:false};
  const wanted=new Set(tokens(query).flatMap(w=>[w,stem(w)]));
  const hit=word=>{const n=normalize(word);return n&&(wanted.has(n)||wanted.has(stem(n))||[...wanted].some(w=>w.length>2&&n.includes(w)));};
  const at=source.findIndex(hit);
  const start=Math.max(0,(at<0?0:at)-6);
  const slice=source.slice(start,start+words);
  const parts=[];
  for(const word of slice){
    const isHit=hit(word);
    const last=parts.at(-1);
    if(last&&last.hit===isHit)last.text+=' '+word;else parts.push({text:word,hit:isHit});
  }
  return {parts,truncated:start>0||start+words<source.length,leading:start>0};
}

// موضع الفقرة التي طابقت داخل المادة: الواجهة تنتقل إليها وتُبرزها بدل أن تترك القارئ يمسح المادة كلها.
export function matchingParagraph(paragraphs,query){
  const wanted=tokens(query).flatMap(w=>[w,stem(w)]).filter(Boolean);
  if(!wanted.length)return null;
  let best=null;
  for(const paragraph of paragraphs??[]){
    const words=tokens(paragraph.text).flatMap(w=>[w,stem(w)]);
    const score=wanted.filter(w=>words.includes(w)).length;
    if(score&&(!best||score>best.score))best={index:paragraph.index,score};
  }
  return best?.index??null;
}
