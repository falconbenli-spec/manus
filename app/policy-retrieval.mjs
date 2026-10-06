import { normalize, tokens } from './arabic-text.mjs';
import { redact } from './pii.mjs';
import { penaltyFor, penaltyLabel, acceptedSchedule, BASE_SCHEDULE_ID } from './discipline.mjs';

// استرجاع نص السياسات للإجابة عنها. قاعدتان لا تُكسران:
// 1) لا تُعاد إلا فقرة مكتوبة في المنصة، بعنوان مصدرها وتاريخ سريانها ورابطها. لا معرفة عامة عن نظام العمل السعودي.
// 2) ما لم يُقبل بعد يُعاد موسومًا «غير نافذ» مع اسم القرار الناقص، ولا يُقدَّم إجابةً قائمة.
//
// ── مكتبة السياسات (الترحيل 110، app/policy-library.mjs) ──────────────────────────────────────
// هذه الوحدة لا تستورد المكتبة استيرادًا ثابتًا: المكتبة تُبنى في فرع آخر. الواجهة المطلوبة منها:
//   library.name                              اسم يظهر في «مسار الاسترجاع»
//   library.articles(db,tenantId,today) -> [{ id, code, title, effective_from, in_force, status,
//                                             link, source, article_refs:[..], blocked_by,
//                                             paragraphs:[{ number, text }] }]
//   library.synonyms(db) -> [[term,variant],…]  (اختياري؛ الافتراضي جدول policy_search_terms)
// عند الدمج: setPolicyLibrary(policyLibrary) في app/server.mjs مرة واحدة، فيحل نص المكتبة محل البديل المحلي
// دون تغيير سطر في مساعد السياسات. البديل المحلي أدناه ليس نصًّا مخترعًا: يقرأ نص المنصة نفسه
// (سياسات الموارد البشرية، أنواع الإجازات، قواعد اللائحة، جدول الجزاءات، مصفوفة المزايا).
let library=null;
export function setPolicyLibrary(injected){library=injected;}
export const libraryName=()=>library?.name??'stand-in:platform-text';
export const usingStandIn=()=>!library;

/* ───── تطبيع ومصطلحات ───── */
// أدوات السؤال وأفعاله العامة وألفاظ الترتيب: لا تدل على موضوع، فلا تدخل الفهرس ولا الاستعلام.
// وجودها أو غيابها في النص لا يعني شيئًا، وإدخالها يجعل «هل يصرفون بدل إنترنت» يبدو مطابقًا لنص بدل الانتقال.
const STOP=new Set(['وش','ايش','سياسه','سياسات','سياس','في','من','على','الى','عن','هل','ما','ماذا','هو','هي','كم','كيف','متى','اين','لماذا','او','ان','لا','مع','هذا','هذه','التي','الذي','لي','يمكن','يحق',
  'يعتبر','تعتبر','يصرف','تصرف','يعطي','يعطى','اريد','ابغى','عندي','لدي','يوجد','يكون','عند','بعد','قبل','كل','بين','مره','مرات','اول','ثاني','ثالث','رابع','خامس','الاخير','الحالي','باقي','متبقي',
  'the','of','a','is','to','for','and','my','what','how','when','do','does','i','me']);
// جذر خفيف: يحذف حروف العطف والجر الملتصقة و«ال» التعريف ولواحق الجمع والضمائر الشائعة.
// لا يدّعي تحليلًا صرفيًا: غرضه أن يلتقي «إجازتي» و«الإجازات» و«إجازة» على صورة واحدة في الفهرس والاستعلام معًا.
export function stem(word){
  let w=word;
  if(w.length>4)w=w.replace(/^(?:وال|بال|كال|فال|لل)/,'').replace(/^(?:ال)/,'');
  // حرف جر أو عطف ملتصق: «لمدير» ← «مدير». لا يُقتطع إن بقي أقل من ثلاثة أحرف.
  if(w.length>4&&/^[لبكوف]/.test(w))w=w.slice(1);
  if(w.length>4)w=w.replace(/(?:اتها|اتهم|اتنا|يتها)$/,'');
  if(w.length>3)w=w.replace(/(?:ات|ون|ين|ان|ها|هم|نا|كم|تي|ته|هن)$/,'');
  if(w.length>3)w=w.replace(/(?:ه|ي|ا)$/,'');
  return w||word;
}
// الكلمة تُستبعد بصورتها وبجذرها معًا: «للمرة» تصير «مره» بعد الجذر، وهي من أدوات السؤال لا من موضوعه.
export const terms=text=>tokens(text).filter(t=>t.length>1&&!STOP.has(t)&&!STOP.has(stem(t)));
const variantsOf=db=>{
  const map=new Map();
  const rows=typeof library?.synonyms==='function'?library.synonyms(db):db.prepare('SELECT term,variant FROM policy_search_terms').all().map(r=>[r.term,r.variant]);
  for(const [term,variant] of rows){
    const a=stem(normalize(term)),b=stem(normalize(variant));
    if(!a||!b||a===b)continue;
    for(const [from,to] of [[a,b],[b,a]]){const set=map.get(from)??new Set();set.add(to);map.set(from,set);}
  }
  return map;
};
// مصطلحات الاستعلام: الكلمة وجذرها ومرادفاتها. الوزن ينقص للمرادف فلا يزيح المطابقة الحرفية.
export function queryTerms(db,question){
  const map=variantsOf(db),out=new Map();
  const add=(term,weight,origin)=>{if(!term)return;const seen=out.get(term);if(!seen||seen.weight<weight)out.set(term,{term,weight,origin:origin??seen?.origin});};
  for(const raw of terms(question)){
    const root=stem(raw);
    add(root,1,root);
    for(const variant of map.get(root)??[])add(variant,0.6,root);
  }
  return [...out.values()];
}
// موضوع لا يذكره النص أصلًا: كلمة أصلية في السؤال (لا مرادف لها ولا رقم) لا ترد في أي فقرة ولا في مرادف موجود.
// عندها لا تُعاد فقرة «قريبة»: «بدل إنترنت» لا يُجاب من نص بدل الانتقال لأن الاثنين فيهما كلمة «بدل».
export function unknownTerms(db,question,index){
  const query=queryTerms(db,question),known=new Map();
  for(const q of query)if((index.df.get(q.term)??0)>0)known.set(q.origin??q.term,true);
  const originals=[...new Set(query.filter(q=>q.weight===1).map(q=>q.term))];
  return originals.filter(term=>!/^\d+$/.test(term)&&term.length>=4&&!known.has(term));
}

/* ───── نص المنصة: البديل المحلي للمكتبة ───── */
const splitParagraphs=body=>String(body??'').split(/\n+|(?<=[.؟!])\s+/).map(s=>s.trim()).filter(s=>s.length>=12);
const paragraphsOf=body=>splitParagraphs(body).map((text,index)=>({number:index+1,text}));
const refsIn=text=>[...new Set(String(text??'').match(/م\d{1,3}(?:\/\d+)?/g)??[])].map(r=>r.replace(/\/\d+$/,''));

function hrPolicyArticles(db,tenantId,today){
  const rows=db.prepare('SELECT * FROM hr_policies WHERE tenant_id=? ORDER BY effective_from DESC').all(tenantId),out=[];
  for(const p of rows){
    if(p.status==='rejected')continue;
    const live=p.status==='accepted'&&p.effective_from<=today;
    const superseded=live&&db.prepare("SELECT 1 FROM hr_policies n WHERE n.tenant_id=? AND n.kind=? AND n.status='accepted' AND n.effective_from<=? AND (n.effective_from>? OR (n.effective_from=? AND n.decided_at>?))").get(tenantId,p.kind,today,p.effective_from,p.effective_from,p.decided_at??'');
    if(superseded)continue;
    out.push({id:p.id,code:`سياسة/${p.kind}`,title:p.title,effective_from:p.effective_from,in_force:live,status:p.status,link:'#hr-policies',
      source:p.basis??'',article_refs:refsIn(`${p.basis} ${p.body}`),blocked_by:live?null:'قبول مدير الموارد البشرية (hr.policy.accept)',paragraphs:paragraphsOf(p.body)});
  }
  return out;
}
// أحكام كل نوع إجازة مكتوبة في معاملات السياسة لا في متنها (الترحيل 098)، فتُقرأ فقرةً لكل نوع بنصه ومواده:
// «إجازة الزواج … 5 أيام بأجر كامل (م94/1)». لا صياغة جديدة: النص من rules_ar كما اعتمده مدير الموارد البشرية.
function leaveArticles(db,tenantId,today){
  return db.prepare('SELECT * FROM leave_type_policies WHERE tenant_id=? ORDER BY effective_from DESC').all(tenantId).filter(p=>p.status!=='rejected')
    .map(p=>{
      const parameters=JSON.parse(p.parameters),types=parameters.types??[];
      const unpaid=parameters.unpaid_leave;
      const typeParagraphs=types.map((t,index)=>({number:index+2,code:t.code,
        // مواد لائحة الشركة بحرف «م» ثم مواد نظام العمل ولائحته التنفيذية بأسمائها (الإصدار 3)؛ نوع لا مادة له في اللائحة يُقرأ بمواد النظام وحدها.
        text:`${t.name_ar} (${[...(t.articles??[]).map(a=>`م${a}`),...(t.law_articles??[])].join('، ')}): ${(t.rules_ar??[]).join(' ')}${t.entitlement?.days?` الاستحقاق ${t.entitlement.days} ${t.unit==='calendar'?'يومًا تقويميًا':'يوم عمل'}.`:''}`}));
      const tail=unpaid?[{number:types.length+2,code:'unpaid_limit',text:`${unpaid.label_ar}: الحد ${unpaid.threshold_days} يومًا (${[...(unpaid.articles??[]),...(unpaid.law_articles??[])].join('، ')}). ${(unpaid.rules_ar??[]).join(' ')}`}]:[];
      // كتلة الإجازة التعويضية (الإصدار 3): النسبة والمهلة والسقف كما اعتُمدت، فقرةً بعد حد الإجازة بلا أجر فلا يتحرك رقم فقرة سابقة.
      const comp=parameters.compensatory;
      if(comp&&Number.isInteger(comp.ratio_bp))tail.push({number:types.length+2+tail.length,code:'compensatory_rule',
        text:`${comp.label_ar}: ${comp.ratio_bp/10000} ساعة إجازة عن كل ساعة عمل إضافية، تؤخذ خلال ${comp.use_within_days} يومًا من يوم العمل، وسقفها ${comp.annual_cap_days} يومًا في السنة (${(comp.articles??[]).join('، ')}). ${(comp.rules_ar??[]).join(' ')}`});
      return {id:p.id,code:'أنواع الإجازات',title:p.title,effective_from:p.effective_from,in_force:p.status==='accepted'&&p.effective_from<=today,status:p.status,link:'#leave',
        source:p.basis,article_refs:refsIn(`${p.basis} ${p.body} ${typeParagraphs.map(x=>x.text).join(' ')}`),
        blocked_by:p.status==='accepted'?null:'قبول مدير الموارد البشرية لسياسة أنواع الإجازات',
        paragraphs:[{number:1,text:p.body.split('\n')[0]},...typeParagraphs,...tail]};
    });
}
function regulationArticles(db,tenantId,today){
  return db.prepare('SELECT * FROM regulation_policies WHERE tenant_id=? OR tenant_id IS NULL ORDER BY kind,created_at DESC').all(tenantId).filter(p=>p.status!=='rejected')
    .map(p=>({id:p.id,code:`قاعدة/${p.kind}`,title:p.title,effective_from:p.effective_from,in_force:p.status==='accepted'&&(p.effective_from??'9999')<=today,status:p.status,
      link:p.kind==='travel_per_diem'?'#travel':'#payroll-rules',source:p.source,article_refs:JSON.parse(p.articles).map(a=>a.replace(/\/\d+$/,'')),
      blocked_by:p.status==='accepted'?null:'قبول مدير الموارد البشرية لقواعد اللائحة في الرواتب',paragraphs:paragraphsOf(p.body)}));
}
// جدول الجزاءات: كل بند فقرة بنصه وجزاءاته بترتيب التكرار، بصياغة وحدة الجزاءات نفسها (penaltyLabel).
function disciplineArticles(db,tenantId,today){
  const accepted=acceptedSchedule(db,tenantId,today);
  const base=db.prepare('SELECT * FROM discipline_schedules WHERE id=?').get(BASE_SCHEDULE_ID);
  const rows=[accepted,accepted?null:base].filter(Boolean);
  return rows.map(s=>{
    const p=JSON.parse(s.parameters);
    return {id:s.id,code:'جدول الجزاءات',title:s.title,effective_from:s.effective_from,in_force:!!accepted&&s.id===accepted.id,status:s.status,link:'#discipline',source:s.basis,
      article_refs:['م111','م112','م114','م116','م126'],blocked_by:accepted?null:'قبول مدير الموارد البشرية لجدول المخالفات والجزاءات',
      paragraphs:[{number:0,code:'الإعدادات',
        text:`سقف الغرامة عن المخالفة الواحدة أجر ${p.fine_cap_days_per_violation} أيام، وسقف الغرامات في الشهر الواحد أجر ${p.monthly_fine_cap_days} أيام (م116). نافذة تكرار المخالفة ${p.repeat_window_days} يومًا (م114). مهلة بدء التحقيق ${p.investigation_limit_days} يومًا (م119) ومهلة توقيع الجزاء بعد الثبوت ${p.decision_limit_days} يومًا (م120). مهلة التظلم من الجزاء ${p.grievance_filing_days} يومًا ومهلة الرد على التظلم ${p.grievance_answer_days} أيام (م126/2).`},
      ...p.rows.map((row,index)=>({number:index+1,code:row.code,
        text:`${row.ar} (${row.article_ar}). الجزاء بترتيب التكرار: ${row.penalties.map((_,i)=>`${i+1}) ${penaltyLabel(penaltyFor(row,i+1),'ar')}`).join('، ')}${row.extra_deduction==='late_time'?'، بالإضافة إلى حسم أجر دقائق التأخر':''}.`}))]};
  });
}
function benefitArticles(db,tenantId){
  return db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id=? AND status IN ('draft','accepted') ORDER BY sort_order,revision DESC").all(tenantId).map(b=>({
    id:b.id,code:`ميزة/${b.benefit_key}`,title:b.name,effective_from:b.effective_from,in_force:b.status==='accepted',status:b.status,link:'#my-benefits',source:b.article||b.source_note.slice(0,120),
    article_refs:refsIn(`${b.article} ${b.source_note}`),blocked_by:b.status==='accepted'?null:'اعتماد مدير الموارد البشرية للميزة في مصفوفة المزايا',
    paragraphs:[{number:1,text:`${b.name}: ${b.summary}`},...(b.source_note?[{number:2,text:b.source_note}]:[])]}));
}
// المكتبة تضيف نص اللائحة ولا تحل محل نص المنصة: مصدراها يجيبان عن سؤالين مختلفين. اللائحة تقول ما نصّت عليه
// المادة، وسياسات المنصة تقول ما قبلته الشركة وطبّقته فعلًا في أنواع الإجازات وجدول الجزاءات ومصفوفة المزايا.
// الاكتفاء بأحدهما يترك نصف الجواب، فتُقرأ الاثنتان ويظهر مصدر كل فقرة في الاستشهاد.
export function articlesOf(db,u,today){
  if(library)return [...library.articles(db,u.tenant_id,today),...platformArticles(db,u,today)];
  return platformArticles(db,u,today);
}
function platformArticles(db,u,today){
  return [...hrPolicyArticles(db,u.tenant_id,today),...leaveArticles(db,u.tenant_id,today),...regulationArticles(db,u.tenant_id,today),
    ...disciplineArticles(db,u.tenant_id,today),...benefitArticles(db,u.tenant_id)];
}

/* ───── الفهرس وBM25 ───── */
const K1=1.2,B=0.75;
export function buildIndex(articles){
  const docs=[];
  for(const article of articles)for(const paragraph of article.paragraphs){
    const words=terms(`${paragraph.text} ${article.title}`).map(stem);
    const counts=new Map();for(const w of words)counts.set(w,(counts.get(w)??0)+1);
    const titleWords=new Set(terms(article.title).map(stem));
    docs.push({article,paragraph,counts,length:words.length||1,titleWords});
  }
  const df=new Map();
  for(const d of docs)for(const w of d.counts.keys())df.set(w,(df.get(w)??0)+1);
  const avg=docs.reduce((n,d)=>n+d.length,0)/(docs.length||1);
  return {docs,df,avg,count:docs.length};
}
// BM25 قياسي، بزيادة صغيرة إن طابقت الكلمة عنوان المادة، وبخفض للفقرة غير النافذة فلا تتصدر نافذة.
export function score(index,query){
  const {docs,df,avg}=index,N=docs.length||1;
  return docs.map(d=>{
    let total=0;const matched=[];
    for(const {term,weight} of query){
      const tf=d.counts.get(term)??0;if(!tf)continue;
      matched.push(term);
      const idf=Math.log(1+(N-(df.get(term)??0)+0.5)/((df.get(term)??0)+0.5));
      total+=weight*idf*(tf*(K1+1))/(tf+K1*(1-B+B*d.length/avg))*(d.titleWords.has(term)?1.35:1);
    }
    return {doc:d,score:total*(d.article.in_force?1:0.55),hits:matched.length,matched};
  }).filter(x=>x.hits>0).sort((a,b)=>b.score-a.score);
}
// عتبة الصلة: الفقرة لا تُعاد لمجرد أنها تشارك السؤال كلمة شائعة.
// تغطية بوزن الندرة: ما تطابقه الفقرة من كتلة الكلمات الموجودة في النص لا يقل عن 55٪، وكلمة مميزة واحدة على الأقل.
export function relevant(index,query,ranked){
  const {df,count}=index,N=count||1,specific=Math.max(1,Math.ceil(0.15*N));
  const idf=term=>Math.log(1+(N-(df.get(term)??0)+0.5)/((df.get(term)??0)+0.5));
  const present=query.filter(q=>(df.get(q.term)??0)>0);
  const mass=present.reduce((n,q)=>n+q.weight*idf(q.term),0)||1;
  const cover=r=>r.matched.reduce((n,term)=>n+(query.find(q=>q.term===term)?.weight??1)*idf(term),0);
  const best=ranked.reduce((n,r)=>Math.max(n,cover(r)),0);
  // أو ما يقارب أفضل تغطية: سؤال تتقاسمه فقرتان من مصدرين (نص الدوام وجدول الجزاءات) لا تُحجب إحداهما.
  return ranked.filter(r=>{
    const covered=cover(r);
    return (covered/mass>=0.55||covered>=0.75*best)&&r.matched.some(term=>(df.get(term)??0)<=specific);
  });
}

/* ───── الطبقة الدلالية (اختيارية، مطفأة ما لم تُهيّأ) ───── */
// لا نعد بما لا نملك: بلا نقطة نهاية تمثيلات مهيأة في بيئة الخادم يبقى الاسترجاع نصيًا صريحًا.
let embedder=null;
export function setEmbedder(injected){embedder=injected;}
export function embeddingConfig(){
  const url=process.env.POLICY_EMBEDDING_URL??'',model=process.env.POLICY_EMBEDDING_MODEL??'';
  if(embedder)return {configured:true,source:'injected',model:embedder.model??'stub',url:''};
  if(!url)return {configured:false,source:null,model:'',url:'',reason:'لا نقطة نهاية تمثيلات في بيئة الخادم (POLICY_EMBEDDING_URL). الطبقة الدلالية مطفأة.'};
  return {configured:true,source:'env',model:model||'unnamed',url};
}
// نص يغادر الجهاز إلى نقطة نهاية خارجية، فيُحجب كما يُحجب نص المزوّد في app/ai.mjs. سؤال الموظف يكتبه بيده
// وقد يضع فيه جواله أو رقم هويته أو بريده وهو يسأل، والفقرات المرسلة معه من اللائحة لا من سجل أحد.
// التمثيلات أرقام لا نص، فلا حاجة لإعادة الأصل بعد العودة؛ الحجب هنا في اتجاه الذهاب وحده.
async function embed(texts){
  // الحجب قبل اختيار الوجهة لا بعدها: المزوّد المحقون يمر بما يمر به المزوّد الحقيقي، فيختبر الاختبار المسار نفسه
  // لا نسخة منه. ولو حُجب داخل فرع الشبكة وحده لظل أي مزوّد يُركَّب لاحقًا يستقبل النص كما كتبه صاحبه.
  const masked=texts.map(t=>redact(t).text);
  if(embedder)return embedder.embed(masked);
  const {url,model}=embeddingConfig();
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,input:masked}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`embedding ${response.status}`);
  const body=await response.json();
  return (body.data??body.embeddings??[]).map(x=>Array.isArray(x)?x:x.embedding);
}
const cosine=(a,b)=>{let dot=0,na=0,nb=0;for(let i=0;i<Math.min(a.length,b.length);i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return na&&nb?dot/Math.sqrt(na*nb):0;};

/* ───── الاسترجاع ───── */
const passageOf=({doc,score:value})=>({article_id:doc.article.id,code:doc.article.code,title:doc.article.title,effective_from:doc.article.effective_from,
  in_force:doc.article.in_force,status:doc.article.status,link:doc.article.link,source:doc.article.source,blocked_by:doc.article.blocked_by,
  // مواد الفقرة نفسها إن ذكرتها، وإلا مواد المادة كلها: التعارض يُقاس على ما استُشهد به فعلًا.
  article_refs:refsIn(doc.paragraph.text).length?refsIn(doc.paragraph.text):doc.article.article_refs,paragraph:doc.paragraph.number,paragraph_code:doc.paragraph.code??null,text:doc.paragraph.text,score:Number(value.toFixed(4))});

export function retrieve(db,u,question,{today,limit=4,pool=12}={}){
  const articles=articlesOf(db,u,today),index=buildIndex(articles),query=queryTerms(db,question);
  if(!query.length)return {passages:[],index,query,ranked:[],unknown:[]};
  const unknown=unknownTerms(db,question,index);
  if(unknown.length)return {passages:[],index,query,ranked:[],unknown};
  const ranked=relevant(index,query,score(index,query)).slice(0,pool);
  return {passages:ranked.slice(0,limit).map(passageOf),index,query,ranked,unknown};
}
// المسار المعلن كما هو: نصي دائمًا، ودلالي فوقه إن كانت نقطة النهاية مهيأة ونجح الاستدعاء. لا ادعاء ثالث.
export async function retrieveHybrid(db,u,question,options={}){
  const lexical=retrieve(db,u,question,{...options,limit:options.limit??4,pool:options.pool??12});
  const config=embeddingConfig();
  const base={key:'lexical_bm25',name:'بحث نصي: فهرس مطبّع + BM25 + توسيع بالمرادفات والجذر',semantic:false,library:libraryName(),note:config.reason??''};
  if(!config.configured||!lexical.ranked.length)return {...lexical,path:base};
  try{
    const texts=lexical.ranked.map(r=>r.doc.paragraph.text);
    const vectors=await embed([question,...texts]);
    if(!Array.isArray(vectors)||vectors.length!==texts.length+1)throw new Error('embedding shape');
    const [q,...rest]=vectors;
    const blended=lexical.ranked.map((r,i)=>({...r,score:r.score*0.6+cosine(q,rest[i])*0.4*(r.doc.article.in_force?1:0.55)})).sort((a,b)=>b.score-a.score);
    return {...lexical,ranked:blended,passages:blended.slice(0,options.limit??4).map(passageOf),
      path:{key:'lexical_bm25+embeddings',name:`بحث نصي (BM25) ثم إعادة ترتيب بتمثيلات دلالية (${config.model})`,semantic:true,library:libraryName(),note:''}};
  }catch(error){
    return {...lexical,path:{...base,note:`نقطة نهاية التمثيلات مهيأة وتعذر استدعاؤها (${String(error?.message??'').slice(0,80)})؛ الإجابة من البحث النصي وحده.`}};
  }
}

/* ───── التعارض: أيهما النافذ ───── */
// المنصة لا تستنبط أيهما أحدث من النص: الأزواج مكتوبة في الترحيل 111 بقرار مدوّن.
export function supersessions(db){return db.prepare('SELECT later,earlier,note,source FROM policy_article_supersedes').all();}
// إن ظهرت المادة المنسوخة بين ما استُرجع، يُقال صراحة أيهما النافذ ويُربط التعديل إن كان نصه بين المسترجَع.
export function conflictsAmong(db,passages){
  const refs=new Map();
  for(const p of passages)for(const ref of p.article_refs??[])if(!refs.has(ref))refs.set(ref,p);
  return supersessions(db).filter(pair=>refs.has(pair.earlier)).map(pair=>{
    const later=refs.get(pair.later),earlier=refs.get(pair.earlier);
    return {in_force:pair.later,superseded:pair.earlier,note:pair.note,source:pair.source,
      amendment_title:later?later.title:null,link:(later??earlier).link,
      text:`${pair.note} النافذ: ${pair.later}؛ المنسوخ: ${pair.earlier}.${later?'':' نص التعديل لم يظهر ضمن ما استُرجع؛ افتحه من المكتبة قبل الاعتماد على الفقرة أعلاه.'}`};
  });
}
