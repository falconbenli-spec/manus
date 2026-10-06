// «مكتبة السياسات»: نص السياسات كاملًا، وكل مادة على بعد ثوانٍ — برقمها أو بكلمة فيها أو بسؤال عادي.
//
// ثلاثة مبادئ تحكم هذه الوحدة:
//   1) مصدر واحد لكل نص. جداول المخالفات والجزاءات الثلاثة لا تُنسخ هنا: تُقرأ من جدول وحدة الجزاءات (ترحيل 097)
//      ويُربط كل صف بمادته. نص المادة يُقرأ من هنا، ولا تحتفظ وحدة أخرى بنسخة منه.
//   2) لا شيء يُطبع. القرار أن كل شيء إلكتروني: المادة لها سجل إلكتروني ورابط يُنسخ ويُشارك، ولا تصدير PDF.
//   3) لا ادّعاء بصحة نص لم يُطابَق. ملف PDF الموقّع لم يصل جلسة البناء، فكل مادة موسومة
//      «مستخرج — يحتاج مطابقة مع الأصل الموقّع» حتى يعتمدها الأدمن مادةً مادة.
//
// القراءة لكل موظف: اللائحة نص يُلزم الجميع، فحجبها عن أحد يجعلها حجة عليه لا يملك قراءتها. الكتابة وحدها
// محصورة في الموارد البشرية، وكل تعديل يخلق نسخة بتاريخ سريان وتبقى السابقة للمقارنة.
import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { normalize } from './arabic-text.mjs';
import { buildIndex, search, synonymGroups, directArticle, excerpt, matchingParagraph } from './policy-index.mjs';
import { repairText } from './policy-extract.mjs';
import { BASE_SCHEDULE_ID } from './discipline.mjs';

export const ARTICLE_STATUS={in_force:'سارية',amended:'معدّلة',repealed:'ملغاة',replaced:'استُبدلت'};
export const DOCUMENT_STATUS={draft:'مسودة',published:'منشورة',superseded:'استُبدلت'};
export const LINK_NAMES={reference:'تحيل إلى',amends:'تعدّل',amended_by:'عُدّلت بـ',replaces:'تحل محل',replaced_by:'استُبدلت بـ',external:'مرجع خارجي',related:'ذات صلة'};
export const ARTIFACT_NAMES={
  clause_reflow:'أُعيد ترتيب قطعة من الجملة عند الاستخراج (نمط «؛» المنفردة) — يحتاج مطابقة',
  broken_glyphs:'حروف مفصولة أو كلمات ملتصقة بقيت من الاستخراج — يحتاج مطابقة',
  title_unavailable:'تعذّر اشتقاق عنوان من النص المستخرج؛ العنوان من اقتراح النظام'};
export const SOURCE_NOTE='مستخرج — يحتاج مطابقة مع الأصل الموقّع';
// الطباعة: قرار المالك أن كل شيء إلكتروني. النص هنا يُعرض في الواجهة كي لا يسأل أحد عن زر طباعة غير موجود.
export const NO_PRINT='لا طباعة ولا تصدير PDF: المادة سجل إلكتروني، ويُنسخ رابطها أو نصها.';

// الإجراءات التي تفتحها المادة. الرابط ثابت في الكود كما في app/module-routes.mjs، والرقم في قاعدة البيانات.
const BASIS_LINKS={
  'leave.annual':{link:'#leave',name:'طلب إجازة سنوية'},
  'leave.marriage':{link:'#leave',name:'طلب إجازة زواج'},
  'leave.sick':{link:'#leave',name:'طلب إجازة مرضية'},
  'leave.maternity':{link:'#leave',name:'طلب إجازة وضع'},
  'leave.bereavement':{link:'#leave',name:'طلب إجازة وفاة'},
  'overtime.request':{link:'#attendance/overtime',name:'طلب عمل إضافي'},
  'secondment.request':{link:'#travel',name:'تقديم طلب انتداب'},
  'grievance.file':{link:'#my-discipline',name:'تقديم تظلم'},
  'discipline.penalty':{link:'#discipline',name:'سجل المخالفات والجزاءات'},
  'payroll.deduction':{link:'#payroll-rules',name:'سقوف الاستقطاع'}};

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const nameOf=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
// من يحرر: الموارد البشرية وحدها — حامل تصريح إعداد سياسات الموارد البشرية أو اعتمادها. تصريح قاعدة المعرفة
// (knowledge.manage) لا يكفي هنا رغم قربه: الأدوار الإدارية تحمله افتراضًا، وفتح نص اللائحة لها أوسع مما قرره المالك.
// القراءة ليست مشروطة بتصريح — اللائحة تسري على الجميع فيقرؤها الجميع.
export const curates=(db,u)=>u.role!=='admin'&&(holds(db,u,'hr.policy.prepare')||holds(db,u,'hr.policy.accept'));
function curator(db,supplied){
  const u=actor(db,supplied);
  if(!curates(db,u))fail(403,'not_permitted','تحرير مكتبة السياسات لمن يعدّ سياسات الموارد البشرية أو يعتمدها');
  return u;
}
export const articleDigest=article=>hash(JSON.stringify([article.number,article.title,article.body,article.status,article.effective_from,article.revision]));

// ── الفهرس ─────────────────────────────────────────────────────────────────────
// يُبنى في الذاكرة ويُعاد بناؤه وحده متى تغيّر مصدره. البصمة عدّادات وأحدث تحديث: استعلام واحد رخيص يسبق كل بحث،
// فلا يوجد فهرس متأخر عن نصه ولا زر «أعد الفهرسة» يتذكره أحد.
const cache=new WeakMap();
const signature=db=>{
  const a=db.prepare('SELECT COUNT(*) n,MAX(updated_at) t,MAX(revision) r FROM policy_articles').get();
  const s=db.prepare('SELECT COUNT(*) n,MAX(created_at) t FROM policy_synonyms WHERE active=1').get();
  return `${a.n}:${a.t}:${a.r}:${s.n}:${s.t}`;
};
const rowToArticle=row=>({...row,paragraphs:JSON.parse(row.paragraphs),keywords:JSON.parse(row.keywords),artifacts:JSON.parse(row.artifacts)});
export function libraryIndex(db){
  const stamp=signature(db),held=cache.get(db);
  if(held&&held.stamp===stamp)return held;
  const articles=db.prepare('SELECT * FROM policy_articles ORDER BY number').all().map(rowToArticle);
  const built={stamp,index:buildIndex(articles),byTerm:synonymGroups(db.prepare('SELECT head,term,active FROM policy_synonyms').all()),articles};
  cache.set(db,built);
  return built;
}
export const clearIndex=db=>cache.delete(db);

// ── مصدرًا لمساعد السياسات (ترحيل 111) ────────────────────────────────────────
// المساعد يسأل عن فقرات بنصها ومصدرها، لا عن صفوف الجدول. هذا المحوّل يعطيه إياها بالشكل الذي يقرؤه،
// وقاعدتان فيه تُبقيان الجواب صادقًا:
//   1) مادة لم تُطابَق بعد مع الأصل الموقّع ليست نصًّا نافذًا في الجواب مهما كانت حالتها في الجدول.
//      تُعاد موسومة بما ينقصها، فيقتبسها المساعد ويقول إنها مستخرجة تنتظر المطابقة، ولا يقدّمها حكمًا قائمًا.
//   2) ما بقي فيه أثر استخراج (حروف مكسورة أو جملة أُعيد ترتيبها) يُقال في مصدره، لا يُخفى خلف نص نظيف الشكل.
const articleRefs=(db,articleId)=>db.prepare('SELECT target_number,target_label FROM policy_article_links WHERE article_id=?').all(articleId)
  .map(l=>l.target_number?`م${l.target_number}`:l.target_label).filter(Boolean);
export const retrievalSource={
  name:'مكتبة السياسات — لائحة تنظيم العمل',
  articles(db,tenantId,day){
    const documents=new Map(db.prepare('SELECT * FROM policy_documents WHERE tenant_id=? OR tenant_id IS NULL').all(tenantId).map(d=>[d.id,d]));
    return db.prepare('SELECT * FROM policy_articles WHERE tenant_id=? OR tenant_id IS NULL ORDER BY number').all(tenantId).map(rowToArticle)
      .filter(a=>documents.has(a.document_id)).map(a=>{
        const document=documents.get(a.document_id);
        const matched=a.verification==='verified'&&document.verification==='verified';
        const dated=(a.effective_from??document.effective_from??'9999')<=day;
        const artifacts=a.artifacts.map(key=>ARTIFACT_NAMES[key]).filter(Boolean);
        return {id:a.id,code:`م${a.number}`,title:a.title,effective_from:a.effective_from??document.effective_from,
          // النفاذ حال المادة في اللائحة المعتمدة، لا حال نسختنا منها: اللائحة رقم 351743 معتمدة وسارية،
          // والمطابقة مع الأصل الموقّع مسألة أمانة النقل. وسمها «غير نافذة» يكذب على حالتها؛ الصواب أن تُقتبس
          // نافذةً ويُقال في مصدرها إنها مستخرجة تنتظر المطابقة، فلا يبني عليها أحد قرارًا قبل أن تُطابَق.
          in_force:a.status==='in_force'&&dated&&document.status==='published',
          status:a.status,link:`#policy-library/article/${a.number}`,
          source:[`${document.title} (${document.reference_no??'بلا رقم'})، ${a.chapter}، المادة ${a.number}`,
            matched?null:SOURCE_NOTE,a.title_source==='proposed'?'العنوان اقتراح من النظام لا من النص':null,...artifacts].filter(Boolean).join(' — '),
          article_refs:articleRefs(db,a.id),
          blocked_by:null,
          paragraphs:a.paragraphs.map(p=>({number:p.index,code:p.marker?`فقرة ${p.marker}`:undefined,text:p.text}))};
      });
  },
  synonyms:db=>db.prepare('SELECT head,term FROM policy_synonyms WHERE active=1').all().map(r=>[r.head,r.term])};

// ── قراءة ──────────────────────────────────────────────────────────────────────
const linkRows=(db,articleId)=>db.prepare('SELECT * FROM policy_article_links WHERE article_id=? ORDER BY kind,target_number').all(articleId);
const numbersOf=(db,ids)=>db.prepare(`SELECT id,number,title,status FROM policy_articles WHERE id IN (${ids.map(()=>'?').join(',')})`).all(...ids);

function badges(db,article){
  const out=[];
  if(article.status!=='in_force')out.push({key:article.status,name:ARTICLE_STATUS[article.status],tone:'old'});
  for(const link of linkRows(db,article.id)){
    if(link.kind==='replaced_by')out.push({key:'replaced_by',name:`استُبدلت بالمادة ${link.target_number}`,tone:'old',article_number:link.target_number});
    if(link.kind==='replaces')out.push({key:'replaces',name:`تحل محل المادة ${link.target_number}`,tone:'new',article_number:link.target_number});
    if(link.kind==='amended_by')out.push({key:'amended_by',name:'عُدّلت بتعميم الانتداب',tone:'due'});
  }
  if(article.verification==='extracted')out.push({key:'unverified',name:SOURCE_NOTE,tone:'due'});
  return out;
}

// المواد ذات الصلة: اشتراك في الكلمات المميزة داخل الباب نفسه أولًا ثم خارجه. تُحسب عند الطلب فلا تتأخر عن تعديل.
function related(db,article,articles,limit=6){
  const mine=new Set(article.keywords);
  const scored=[];
  for(const other of articles){
    if(other.id===article.id)continue;
    const shared=other.keywords.filter(k=>mine.has(k)).length;
    if(!shared)continue;
    scored.push({article:other,score:shared+(other.chapter===article.chapter?1.5:0)+(other.status==='in_force'?0.5:0)});
  }
  return scored.sort((a,b)=>b.score-a.score||a.article.number-b.article.number).slice(0,limit)
    .map(r=>({id:r.article.id,number:r.article.number,title:r.article.title,chapter:r.article.chapter,status:r.article.status,status_name:ARTICLE_STATUS[r.article.status]}));
}

// صفوف جدول الجزاءات الخاصة بهذه المادة. النص من وحدة الجزاءات لا من هنا: مصدر واحد للجداول.
function penaltyRows(db,tenantId,number){
  const codes=db.prepare('SELECT row_code,table_key,table_name FROM policy_table_rows WHERE article_number=? ORDER BY row_code').all(number);
  if(!codes.length)return {tables:[],note:''};
  // الجدول الساري للكيان إن اعتُمد، وإلا مستخرج اللائحة الذي تعرضه وحدة الجزاءات نفسها. قراءة فقط: الصفوف ملك تلك الوحدة.
  const schedule=db.prepare("SELECT * FROM discipline_schedules WHERE tenant_id=? AND status='accepted' AND effective_from<=? ORDER BY effective_from DESC,decided_at DESC LIMIT 1").get(tenantId,today())
    ??db.prepare('SELECT * FROM discipline_schedules WHERE id=?').get(BASE_SCHEDULE_ID);
  if(!schedule)return {tables:[],note:'جدول المخالفات والجزاءات غير متاح في هذا الكيان.'};
  const parameters=JSON.parse(schedule.parameters),byCode=new Map((parameters.rows??[]).map(r=>[r.code,r]));
  const grouped=new Map();
  for(const {row_code,table_key,table_name} of codes){
    const row=byCode.get(row_code);
    if(!row)continue;
    if(!grouped.has(table_key))grouped.set(table_key,{key:table_key,name:table_name,rows:[]});
    grouped.get(table_key).rows.push({code:row.code,item:row.item,text:row.ar,penalties:row.penalties,extra_deduction:row.extra_deduction??null,note:row.note_ar??'',uncertain:row.uncertain??null});
  }
  return {tables:[...grouped.values()],
    source:{module:'discipline',link:'#discipline',schedule_title:schedule.title,accepted:schedule.status==='accepted'},
    note:'الجداول الثلاثة لا تُنسخ في المكتبة: تُعرض من جدول وحدة المخالفات والجزاءات، فالتعديل يقع في مكان واحد.'};
}

const articleActions=(db,number)=>db.prepare("SELECT key,label FROM policy_request_basis WHERE article_number=? AND kind='form'").all(number)
  .filter(b=>BASIS_LINKS[b.key]).map(b=>({key:b.key,name:BASIS_LINKS[b.key].name,link:BASIS_LINKS[b.key].link}));

function articleRow(db,u,article,{articles=null,query=''}={}){
  const links=linkRows(db,article.id);
  const internal=links.filter(l=>l.target_article_id&&l.kind==='reference');
  const targets=internal.length?new Map(numbersOf(db,[...new Set(internal.map(l=>l.target_article_id))]).map(a=>[a.id,a])):new Map();
  const ack=db.prepare('SELECT acknowledged_at FROM policy_reading_acknowledgements WHERE user_id=? AND article_id=? AND revision=?').get(u.id,article.id,article.revision);
  return {
    id:article.id,number:article.number,chapter:article.chapter,chapter_order:article.chapter_order,
    title:article.title,title_source:article.title_source,body:article.body,paragraphs:article.paragraphs,
    keywords:article.keywords,status:article.status,status_name:ARTICLE_STATUS[article.status],
    effective_from:article.effective_from,revision:article.revision,version:article.version,
    verification:article.verification,source_note:article.verification==='extracted'?SOURCE_NOTE:'طُوبقت مع الأصل الموقّع',
    artifacts:article.artifacts.map(key=>({key,name:ARTIFACT_NAMES[key]??key})),
    badges:badges(db,article),
    references:internal.map(l=>({number:l.target_number,title:targets.get(l.target_article_id)?.title??'',phrase:l.phrase,id:l.target_article_id})),
    external_references:links.filter(l=>l.kind==='external').map(l=>({label:l.target_label,phrase:l.phrase,note:'مرجع خارجي — نص نظام العمل ليس في هذه المكتبة'})),
    related:articles?related(db,article,articles):[],
    actions:articleActions(db,article.number),
    penalties:penaltyRows(db,u.tenant_id,article.number),
    favourite:!!db.prepare('SELECT 1 FROM policy_favourites WHERE user_id=? AND article_id=?').get(u.id,article.id),
    acknowledged_at:ack?.acknowledged_at??null,
    scroll_to:query?matchingParagraph(article.paragraphs,query):null,
    // «رابط يُنسخ» بدل الطباعة. المسار ثابت فلا يكسره ترتيب النتائج.
    permalink:`#policy-library/article/${article.number}`,
    no_print:NO_PRINT};
}

function findArticle(db,reference){
  if(typeof reference!=='string'&&typeof reference!=='number')fail(400,'invalid_fields','المادة غير محددة');
  const value=String(reference);
  const row=/^\d+$/.test(value)
    ?db.prepare("SELECT * FROM policy_articles WHERE number=? ORDER BY status='in_force' DESC LIMIT 1").get(Number(value))
    :db.prepare('SELECT * FROM policy_articles WHERE id=?').get(value);
  if(!row)fail(404,'not_found','المادة غير موجودة في المكتبة');
  return rowToArticle(row);
}

// ── الشاشة الرئيسية ────────────────────────────────────────────────────────────
export function libraryHome(db,supplied){
  const u=actor(db,supplied),{index}=libraryIndex(db);
  const documents=db.prepare('SELECT * FROM policy_documents ORDER BY status DESC,code').all().map(d=>({
    id:d.id,code:d.code,title:d.title,reference_no:d.reference_no,approved_on:d.approved_on,effective_from:d.effective_from,
    status:d.status,status_name:DOCUMENT_STATUS[d.status],source_note:d.source_note,verification:d.verification,
    articles:db.prepare('SELECT COUNT(*) n FROM policy_articles WHERE document_id=?').get(d.id).n}));
  const chapters=db.prepare('SELECT chapter,chapter_order,COUNT(*) n,MIN(number) first,MAX(number) last FROM policy_articles GROUP BY chapter,chapter_order ORDER BY chapter_order').all()
    .map(c=>({name:c.chapter,order:c.chapter_order,count:c.n,first:c.first,last:c.last,
      in_force:db.prepare("SELECT COUNT(*) n FROM policy_articles WHERE chapter=? AND status='in_force'").get(c.chapter).n}));
  // فاصل ترتيب ثالث بالرقم: مادتان صُحِّحتا في جملة واحدة (م65 وم76 في ترحيل 128) تحملان الختم نفسه والمراجعة نفسها،
  // وبلا فاصل يكون ترتيبهما غير محدد في SQLite فيتبدل ما يقرؤه الموظف بين تشغيل وآخر.
  const updates=db.prepare(`SELECT a.number,a.title,a.chapter,a.status,v.revision,v.effective_from,v.note,v.created_at,v.edited_by
    FROM policy_article_versions v JOIN policy_articles a ON a.id=v.article_id ORDER BY v.created_at DESC,v.revision DESC,a.number DESC LIMIT 8`).all()
    .map(r=>({...r,status_name:ARTICLE_STATUS[r.status],edited_by_name:nameOf(db,r.edited_by)}));
  const popularTerms=db.prepare(`SELECT normalized,COUNT(*) n FROM policy_searches WHERE tenant_id=? AND results>0 GROUP BY normalized ORDER BY n DESC,normalized LIMIT 8`).all(u.tenant_id);
  const favourites=db.prepare('SELECT a.id,a.number,a.title,a.chapter,a.status FROM policy_favourites f JOIN policy_articles a ON a.id=f.article_id WHERE f.user_id=? ORDER BY a.number').all(u.id)
    .map(a=>({...a,status_name:ARTICLE_STATUS[a.status]}));
  // جولات وحدة إقرار السياسات المعلّقة على هذا الموظف: تظهر هنا كي لا يبحث عنها في شاشة أخرى.
  const pendingRounds=db.prepare(`SELECT r.id,r.policy_title,r.due_on FROM policy_ack_recipients c JOIN policy_ack_rounds r ON r.id=c.round_id
    WHERE c.tenant_id=? AND c.user_id=? AND r.status='open' AND NOT EXISTS(SELECT 1 FROM policy_acknowledgements a WHERE a.round_id=c.round_id AND a.user_id=c.user_id) ORDER BY r.due_on`).all(u.tenant_id,u.id);
  const regulation=documents.find(d=>d.code==='work_regulation');
  const acknowledged=regulation?db.prepare('SELECT acknowledged_at FROM policy_reading_acknowledgements WHERE user_id=? AND document_id=? AND article_id IS NULL ORDER BY revision DESC LIMIT 1').get(u.id,regulation.id):null;
  return {today:today(),user_id:u.id,can_edit:curates(db,u),
    documents,chapters,
    total_articles:db.prepare('SELECT COUNT(*) n FROM policy_articles').get().n,
    latest_updates:updates,popular_terms:popularTerms.map(t=>({term:t.normalized,count:t.n})),
    favourites,
    completeness:completenessReport(db),
    acknowledgement:regulation?{document_id:regulation.id,title:regulation.title,acknowledged_at:acknowledged?.acknowledged_at??null,
      actions:acknowledged?[]:['acknowledge_reading'],
      note:'إقرار داخلي يثبت من قرأ ومتى وعلى أي نسخة. ليس توقيعًا ولا إلزامًا نظاميًا.'}:null,
    pending_acknowledgement_rounds:pendingRounds.map(r=>({id:r.id,title:r.policy_title,due_on:r.due_on,link:'#policy-acknowledgements'})),
    index:{entries:index.entries,built_at:index.built_at,articles:index.docs.size},
    no_print:NO_PRINT,
    note:`نص اللائحة المعتمدة (رقم 351743، 24 أبريل 2025) كما استخرجته المنصة من ملف PDF. ${SOURCE_NOTE}: ملف PDF الموقّع لم يصل إلى جلسة البناء، فكل مادة تبقى موسومة حتى يعتمدها الأدمن.`};
}

// ── البحث ──────────────────────────────────────────────────────────────────────
const FILTER_KEYS=['document','chapter','status','content'];
export function searchLibrary(db,supplied,params={}){
  const u=actor(db,supplied);
  const query=typeof params.q==='string'?params.q.slice(0,200):'';
  const {index,byTerm,articles}=libraryIndex(db);
  const filters=Object.fromEntries(FILTER_KEYS.filter(k=>params[k]).map(k=>[k,String(params[k]).slice(0,80)]));
  const started=Date.now();
  const jump=directArticle(query);
  const match=article=>(!filters.document||article.document_id===filters.document)
    &&(!filters.chapter||article.chapter===filters.chapter)
    &&(!filters.status||article.status===filters.status)
    &&(!filters.content||(filters.content==='penalties'?db.prepare('SELECT 1 FROM policy_table_rows WHERE article_number=?').get(article.number):
        filters.content==='amended'?article.status!=='in_force':filters.content==='unverified'?article.verification==='extracted':true));
  let results=[],direct=null,found;
  if(jump!==null){
    const row=db.prepare("SELECT * FROM policy_articles WHERE number=? ORDER BY status='in_force' DESC LIMIT 1").get(jump);
    if(row)direct=articleRow(db,u,rowToArticle(row),{articles});
  }
  found=query?search(index,query,{byTerm,limit:25,filter:match}):{results:[],trace:[],unmatched:[],fuzzy:[],synonyms:[],words:[]};
  results=found.results.map(r=>({
    id:r.article.id,number:r.article.number,title:r.article.title,chapter:r.article.chapter,
    status:r.article.status,status_name:ARTICLE_STATUS[r.article.status],
    score:Math.round(r.score*10)/10,why:r.why,
    excerpt:excerpt(r.article.body,query),
    badges:badges(db,r.article),
    scroll_to:matchingParagraph(r.article.paragraphs,query),
    link:`#policy-library/article/${r.article.number}`}));
  // مادة استُبدلت تصدّرت النتائج: تُعرض ومعها المادة السارية، فلا يقرأ أحد نصًا لم يعد معمولًا به دون أن يعلم.
  for(const result of results){
    const replacement=db.prepare("SELECT target_number FROM policy_article_links WHERE article_id=? AND kind='replaced_by'").get(result.id);
    if(replacement)result.in_force_instead=replacement.target_number;
  }
  const took=Date.now()-started;
  if(query&&db.isTransaction)recordSearch(db,u,query,results.length+(direct?1:0));
  return {query,normalized:normalize(query),direct_article:direct,results,
    total:results.length,took_ms:took,
    filters,filter_options:filterOptions(db),
    explain:{words:found.words,unmatched:found.unmatched,fuzzy:found.fuzzy,synonyms:found.synonyms,
      matched:found.trace.map(t=>({word:t.word,articles:t.matched,why:t.why}))},
    empty_message:query&&!results.length&&!direct?'لا يوجد نص': '',
    index:{entries:index.entries,built_at:index.built_at},
    note:'البحث يطبّع الهمزة والتاء المربوطة والألف المقصورة والتشكيل ونوع الأرقام، ويطابق الجذر الخفيف، ويحتمل خطأ كتابة صغيرًا، ويوسّع بالمرادفات التي يحررها الأدمن. الرقم المباشر يفتح المادة.'};
}
function filterOptions(db){
  return {
    documents:db.prepare('SELECT id,title FROM policy_documents ORDER BY code').all(),
    chapters:db.prepare('SELECT chapter,chapter_order FROM policy_articles GROUP BY chapter,chapter_order ORDER BY chapter_order').all().map(c=>c.chapter),
    statuses:Object.entries(ARTICLE_STATUS).map(([key,name])=>({key,name})),
    content:[{key:'penalties',name:'مواد لها صفوف في جداول الجزاءات'},{key:'amended',name:'مواد معدّلة أو مستبدلة'},{key:'unverified',name:'مواد لم تُطابق مع الأصل الموقّع'}]};
}
function recordSearch(db,u,query,results){
  db.prepare('INSERT INTO policy_searches(id,tenant_id,user_id,query,normalized,results,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(randomUUID(),u.tenant_id,u.id,query.slice(0,200),normalize(query).slice(0,200),results,now());
}
// البحث GET بلا معاملة؛ التسجيل يحتاج كتابة. نقطة منفصلة يستدعيها العميل بعد عرض النتيجة.
export function logSearch(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['q','results']);
  const query=v.text(input.q,'كلمة البحث',200,1);
  if(!Number.isInteger(input.results)||input.results<0)fail(400,'invalid_fields','عدد النتائج غير صالح');
  recordSearch(db,u,query,input.results);
  return {logged:true};
}

// ── صفحة المادة ────────────────────────────────────────────────────────────────
export function articleView(db,supplied,reference,params={}){
  const u=actor(db,supplied),{articles}=libraryIndex(db);
  const article=findArticle(db,reference);
  const view=articleRow(db,u,article,{articles,query:typeof params.q==='string'?params.q.slice(0,200):''});
  const neighbours=db.prepare('SELECT number,title FROM policy_articles WHERE number<? ORDER BY number DESC LIMIT 1').get(article.number);
  const next=db.prepare('SELECT number,title FROM policy_articles WHERE number>? ORDER BY number LIMIT 1').get(article.number);
  const versions=db.prepare('SELECT id,revision,title,status,effective_from,note,edited_by,created_at FROM policy_article_versions WHERE article_id=? ORDER BY revision DESC').all(article.id)
    .map(r=>({...r,status_name:ARTICLE_STATUS[r.status],edited_by_name:nameOf(db,r.edited_by)}));
  // «عرض النص الأصلي»: المادة المستبدلة نصها الكامل هنا، فلا يحتاج القارئ أن يغادر المادة السارية.
  const replaced=db.prepare("SELECT target_article_id FROM policy_article_links WHERE article_id=? AND kind='replaces'").all(article.id)
    .map(l=>rowToArticle(db.prepare('SELECT * FROM policy_articles WHERE id=?').get(l.target_article_id)))
    .map(a=>({number:a.number,title:a.title,body:a.body,status_name:ARTICLE_STATUS[a.status],effective_from:a.effective_from}));
  return {today:today(),user_id:u.id,can_edit:curates(db,u),
    article:view,previous:neighbours??null,next:next??null,versions,
    original_text:replaced,
    chapter_index:db.prepare('SELECT number,title,status FROM policy_articles WHERE chapter=? ORDER BY number').all(article.chapter).map(a=>({...a,status_name:ARTICLE_STATUS[a.status]})),
    actions:[...(view.favourite?['unfavourite_article']:['favourite_article']),
      ...(view.acknowledged_at?[]:['acknowledge_article']),
      ...(curates(db,u)?['edit_article','verify_article',...(article.title_source==='proposed'?['approve_title']:[])]:[])],
    no_print:NO_PRINT,
    note:'رابط المادة ونصها يُنسخان. لا طباعة ولا ملف PDF: السجل إلكتروني.'};
}

// مقارنة نسختين: سطرًا بسطر، يُبيّن ما بقي وما حُذف وما أُضيف. المقارنة على الأسطر لا على الحروف كي تبقى مقروءة.
export function compareVersions(db,supplied,reference,params={}){
  const u=actor(db,supplied);
  const article=findArticle(db,reference);
  const all=db.prepare('SELECT * FROM policy_article_versions WHERE article_id=? ORDER BY revision').all(article.id);
  if(all.length<2&&!params.against)fail(409,'no_previous_version','لا نسخة سابقة لهذه المادة');
  const to=all.find(x=>x.revision===Number(params.to))??all.at(-1);
  const from=all.find(x=>x.revision===Number(params.from))??all[all.indexOf(to)-1]??all[0];
  return {user_id:u.id,number:article.number,title:article.title,
    from:{revision:from.revision,effective_from:from.effective_from,note:from.note,created_at:from.created_at,edited_by_name:nameOf(db,from.edited_by)},
    to:{revision:to.revision,effective_from:to.effective_from,note:to.note,created_at:to.created_at,edited_by_name:nameOf(db,to.edited_by)},
    lines:diffLines(from.body,to.body),
    note:'النسخة السابقة محفوظة كما كانت؛ التعديل لا يكتب فوقها.'};
}
export function diffLines(before,after){
  const a=String(before).split('\n'),b=String(after).split('\n');
  const kept=new Set(),out=[];
  // مقارنة بسيطة: السطر الموجود في الاثنين «باقٍ»، وما في الأول وحده «محذوف»، وما في الثاني وحده «مضاف».
  const counts=new Map();
  for(const line of a)counts.set(line,(counts.get(line)??0)+1);
  for(const line of b)if(counts.get(line)){counts.set(line,counts.get(line)-1);kept.add(line);}
  for(const line of a)out.push({side:kept.has(line)?'same':'removed',text:line});
  for(const line of b)if(!kept.has(line))out.push({side:'added',text:line});
  return out;
}

// ── إجراءات الموظف ─────────────────────────────────────────────────────────────
export function articleAction(db,supplied,reference,action,input){
  writing(db);const u=actor(db,supplied);
  const article=findArticle(db,reference);
  if(action==='favourite_article'||action==='unfavourite_article'){
    v.object(input,[]);
    if(action==='favourite_article')db.prepare('INSERT OR IGNORE INTO policy_favourites(tenant_id,user_id,article_id,created_at) VALUES(?,?,?,?)').run(u.tenant_id,u.id,article.id,now());
    else db.prepare('DELETE FROM policy_favourites WHERE user_id=? AND article_id=?').run(u.id,article.id);
    return {id:article.id,favourite:action==='favourite_article'};
  }
  if(action==='acknowledge_article'){
    v.object(input,['revision','confirm']);
    if(input.confirm!==true)fail(400,'confirm','أكّد قراءتك لنص المادة');
    if(!Number.isInteger(input.revision)||input.revision!==article.revision)fail(409,'revision_mismatch','رقم النسخة لا يطابق النسخة المعروضة. أعد تحميل الصفحة');
    if(db.prepare('SELECT 1 FROM policy_reading_acknowledgements WHERE user_id=? AND article_id=? AND revision=?').get(u.id,article.id,article.revision))
      fail(409,'already_acknowledged','سبق أن أقررت بقراءة هذه النسخة');
    const id=randomUUID(),time=now();
    db.prepare('INSERT INTO policy_reading_acknowledgements(id,tenant_id,user_id,document_id,article_id,revision,content_digest,acknowledged_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id,u.tenant_id,u.id,article.document_id,article.id,article.revision,articleDigest(article),time);
    audit(db,u,'policy_article',article.id,'policy_library.acknowledged',{},{number:article.number,revision:article.revision});
    return {id,acknowledged_at:time};
  }
  return curatorAction(db,u,article,action,input);
}

export function acknowledgeReading(db,supplied,documentId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['confirm']);
  if(input.confirm!==true)fail(400,'confirm','أكّد اطلاعك على نص اللائحة');
  const document=typeof documentId==='string'&&db.prepare("SELECT * FROM policy_documents WHERE id=? AND status='published'").get(documentId);
  if(!document)fail(404,'not_found','الوثيقة المنشورة غير متاحة');
  if(db.prepare('SELECT 1 FROM policy_reading_acknowledgements WHERE user_id=? AND document_id=? AND article_id IS NULL AND revision=?').get(u.id,document.id,document.version))
    fail(409,'already_acknowledged','سبق أن أقررت بقراءة هذه النسخة من اللائحة');
  const id=randomUUID(),time=now();
  // بصمة نص الوثيقة كلها وقت الإقرار: الموظف يقر بما قرأه، وتغيّر أي مادة بعدها يجعل البصمة مختلفة فتُطلب نسخة جديدة.
  const rows=db.prepare('SELECT number,revision,body FROM policy_articles WHERE document_id=? ORDER BY number').all(document.id);
  const digest=hash(rows.map(r=>`${r.number}:${r.revision}:${r.body}`).join('\n'));
  db.prepare('INSERT INTO policy_reading_acknowledgements(id,tenant_id,user_id,document_id,article_id,revision,content_digest,acknowledged_at) VALUES(?,?,?,?,NULL,?,?,?)')
    .run(id,u.tenant_id,u.id,document.id,document.version,digest,time);
  audit(db,u,'policy_document',document.id,'policy_library.document_acknowledged',{},{revision:document.version});
  return {id,acknowledged_at:time};
}

// ── تحرير الموارد البشرية ──────────────────────────────────────────────────────
// كل تعديل نسخة جديدة بتاريخ سريان؛ النسخة السابقة تُحفظ كما كانت فتبقى المقارنة ممكنة، والفهرس يُعاد بناؤه وحده.
function curatorAction(db,u,article,action,input){
  if(!curates(db,u))fail(403,'not_permitted','تحرير مكتبة السياسات لمن يعدّ سياسات الموارد البشرية أو يعتمدها');
  if(action==='edit_article'){
    v.object(input,['version','title','body','status','effective_from','note']);
    v.version(input.version,article.version);
    const title=v.text(input.title,'عنوان المادة',300,2);
    const body=v.text(input.body,'نص المادة',20000,2);
    const status=String(input.status??article.status);
    if(!Object.hasOwn(ARTICLE_STATUS,status))fail(400,'status','حالة المادة غير معروفة');
    const effective=v.date(input.effective_from);
    const note=v.text(input.note,'سبب التعديل وسنده',2000,10);
    if(title===article.title&&body===article.body&&status===article.status&&effective===article.effective_from)
      fail(409,'no_change','لم يتغير شيء في هذه المادة');
    const paragraphs=JSON.stringify(body.split('\n').map(line=>line.trim()).filter(Boolean).map((text,i)=>({index:i+1,marker:text.match(/^(\d{1,2})[.\-]\s/)?.[1]??null,text:text.replace(/^\d{1,2}[.\-]\s/,'')})));
    const revision=article.revision+1,time=now();
    // المطابقة إقرار بأن هذا النص بعينه هو نص الأصل الموقّع. فإن أُعيدت كتابة النص أو العنوان أو تاريخ السريان،
    // صار الإقرار عن نصّ آخر: تسقط المطابقة ويعود وسم «مستخرج — يحتاج مطابقة» حتى يطابقها إنسان من جديد.
    // وحال المادة وحدها (سارية أو ملغاة) حالُ اللائحة لا حالُ نقلنا عنها، فلا تُسقط مطابقةً قائمة.
    const textChanged=title!==article.title||body!==article.body||effective!==article.effective_from;
    const verification=textChanged?'extracted':article.verification;
    db.prepare('UPDATE policy_articles SET title=?,title_source=?,body=?,paragraphs=?,status=?,effective_from=?,verification=?,revision=?,version=version+1,updated_at=? WHERE id=?')
      .run(title,article.title_source==='proposed'?'approved':article.title_source,body,paragraphs,status,effective,verification,revision,time,article.id);
    db.prepare('INSERT INTO policy_article_versions(id,article_id,tenant_id,revision,title,body,paragraphs,status,effective_from,note,edited_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),article.id,u.tenant_id,revision,title,body,paragraphs,status,effective,note,u.id,time);
    audit(db,u,'policy_article',article.id,'policy_library.article_edited',
      {title:article.title,status:article.status,revision:article.revision,verification:article.verification},
      {title,status,revision,effective_from:effective,verification},
      article.verification==='verified'&&verification==='extracted'
        ? `${note}\n— سقطت المطابقة مع الأصل الموقّع بتغيّر النص، وتُطابَق من جديد.`
        : note);
    clearIndex(db);
    return {id:article.id,revision,verification};
  }
  if(action==='verify_article'){
    v.object(input,['version','note']);
    v.version(input.version,article.version);
    if(article.verification==='verified')fail(409,'already_verified','طُوبقت هذه المادة من قبل');
    const note=v.text(input.note,'إقرارك بمطابقة نص المادة مع الأصل الموقّع',2000,10);
    db.prepare('UPDATE policy_articles SET verification=?,version=version+1,updated_at=? WHERE id=?').run('verified',now(),article.id);
    audit(db,u,'policy_article',article.id,'policy_library.article_verified',{verification:'extracted'},{verification:'verified'},note);
    clearIndex(db);
    return {id:article.id,verification:'verified'};
  }
  if(action==='approve_title'){
    v.object(input,['version','title']);
    v.version(input.version,article.version);
    if(article.title_source!=='proposed')fail(409,'action_unavailable','عنوان هذه المادة ليس اقتراحًا من النظام');
    const title=v.text(input.title,'عنوان المادة',300,2);
    db.prepare('UPDATE policy_articles SET title=?,title_source=?,version=version+1,updated_at=? WHERE id=?').run(title,'approved',now(),article.id);
    audit(db,u,'policy_article',article.id,'policy_library.title_approved',{title:article.title},{title});
    clearIndex(db);
    return {id:article.id,title};
  }
  fail(404,'not_found','الإجراء غير متاح');
}

// رفع تعميم جديد: يُلصق نصه أو يُرفع، فيُصلَح بالمستخرج نفسه، ويُربط بالمواد التي يعدّلها، ثم يُنشر بإشعار.
export function createDocument(db,supplied,input){
  writing(db);const u=curator(db,supplied);
  v.object(input,['code','title','reference_no','approved_on','effective_from','text','amends','note']);
  const code=v.text(input.code,'رمز الوثيقة',60,3);
  if(!/^[a-z][a-z0-9_]{2,59}$/.test(code))fail(400,'code','رمز الوثيقة أحرف لاتينية صغيرة وشرطة سفلية');
  if(db.prepare('SELECT 1 FROM policy_documents WHERE code=? AND (tenant_id=? OR tenant_id IS NULL)').get(code,u.tenant_id))fail(409,'code_exists','رمز الوثيقة مستعمل');
  const title=v.text(input.title,'عنوان الوثيقة',300,3);
  const note=v.text(input.note,'مصدر النص وكيف وصل',2000,10);
  const body=v.text(input.text,'نص الوثيقة',400000,20);
  const amends=Array.isArray(input.amends)?input.amends.filter(n=>Number.isInteger(n)&&n>=1&&n<=999):[];
  const repaired=repairText(body);
  const id=randomUUID(),time=now();
  db.prepare('INSERT INTO policy_documents(id,tenant_id,code,title,reference_no,approved_on,effective_from,status,source_note,verification,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)')
    .run(id,u.tenant_id,code,title,input.reference_no?v.text(input.reference_no,'الرقم المرجعي',60,1):null,
      input.approved_on?v.date(input.approved_on):null,input.effective_from?v.date(input.effective_from):null,
      'draft',`${SOURCE_NOTE} — ${note}`,'extracted',time);
  for(const number of amends){
    const target=db.prepare("SELECT id FROM policy_articles WHERE number=? AND status<>'replaced' ORDER BY number LIMIT 1").get(number);
    if(!target)continue;
    db.prepare('INSERT INTO policy_article_links(id,article_id,kind,target_article_id,target_number,target_label,phrase,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(randomUUID(),target.id,'amended_by',target.id,number,`عُدّلت بـ${title}`,'',time);
    db.prepare('UPDATE policy_articles SET status=?,version=version+1,updated_at=? WHERE id=?').run('amended',time,target.id);
  }
  audit(db,u,'policy_document',id,'policy_library.document_created',{},{code,title,amends,lines:repaired.lines.length},note);
  clearIndex(db);
  return {id,repaired_lines:repaired.lines.length,
    reversed_lines:repaired.lines.filter(l=>l.mode==='reversed').length,
    unrepaired:repaired.lines.filter(l=>l.artifacts.length).length,
    preview:repaired.text.slice(0,4000),amended:amends};
}

export function publishDocument(db,supplied,documentId,input){
  writing(db);const u=curator(db,supplied);
  v.object(input,['version','effective_from','note']);
  const document=typeof documentId==='string'&&db.prepare('SELECT * FROM policy_documents WHERE id=? AND (tenant_id=? OR tenant_id IS NULL)').get(documentId,u.tenant_id);
  if(!document)fail(404,'not_found','الوثيقة غير متاحة');
  v.version(input.version,document.version);
  if(document.status!=='draft')fail(409,'action_unavailable','الوثيقة منشورة أو مستبدلة');
  const effective=v.date(input.effective_from);
  const note=v.text(input.note,'ما الذي يتغير بنشر هذه الوثيقة',2000,10);
  db.prepare("UPDATE policy_documents SET status='published',effective_from=?,version=version+1 WHERE id=?").run(effective,document.id);
  audit(db,u,'policy_document',document.id,'policy_library.document_published',{status:'draft'},{status:'published',effective_from:effective},note);
  clearIndex(db);
  // الإشعار داخل المنصة: جولة إقرار جديدة تظهر لكل موظف في شاشة المكتبة. لا بريد ولا رسائل تُرسل.
  return {id:document.id,status:'published',notified:'كل موظف يرى إشعار «قرأت واطلعت» على هذه النسخة في مكتبة السياسات'};
}

// ── قاموس المرادفات ────────────────────────────────────────────────────────────
export function synonymBoard(db,supplied){
  const u=actor(db,supplied);
  const rows=db.prepare('SELECT * FROM policy_synonyms WHERE tenant_id IS NULL OR tenant_id=? ORDER BY head,term').all(u.tenant_id);
  const groups=new Map();
  for(const row of rows){
    if(!groups.has(row.head))groups.set(row.head,{head:row.head,terms:[]});
    groups.get(row.head).terms.push({id:row.id,term:row.term,active:!!row.active,seeded:row.tenant_id===null,created_by_name:nameOf(db,row.created_by)});
  }
  return {user_id:u.id,can_edit:curates(db,u),groups:[...groups.values()],
    actions:curates(db,u)?['add_synonym']:[],
    note:'المرادف يوسّع البحث ولا يغيّر نص المادة. الصفوف المرقّمة «بذرة المنصة» هي قائمة المالك الأولى، وتُعطّل ولا تُحذف.'};
}
export function addSynonym(db,supplied,input){
  writing(db);const u=curator(db,supplied);
  v.object(input,['head','term']);
  const head=normalize(v.text(input.head,'الكلمة كما في اللائحة',80,2));
  const term=normalize(v.text(input.term,'الكلمة كما يكتبها الموظف',80,2));
  if(head===term)fail(400,'term','الكلمتان متطابقتان بعد التطبيع');
  if(db.prepare('SELECT 1 FROM policy_synonyms WHERE tenant_id=? AND head=? AND term=?').get(u.tenant_id,head,term))fail(409,'exists','المرادف مسجل');
  const id=randomUUID();
  db.prepare('INSERT INTO policy_synonyms(id,tenant_id,head,term,active,created_by,created_at) VALUES(?,?,?,?,1,?,?)').run(id,u.tenant_id,head,term,u.id,now());
  audit(db,u,'policy_synonym',id,'policy_library.synonym_added',{},{head,term});
  clearIndex(db);
  return {id,head,term};
}
export function synonymAction(db,supplied,synonymId,action,input){
  writing(db);const u=curator(db,supplied);
  v.object(input,['note']);
  const row=typeof synonymId==='string'&&db.prepare('SELECT * FROM policy_synonyms WHERE id=? AND (tenant_id=? OR tenant_id IS NULL)').get(synonymId,u.tenant_id);
  if(!row)fail(404,'not_found','المرادف غير موجود');
  if(!['activate_synonym','deactivate_synonym'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  const active=action==='activate_synonym'?1:0;
  if(row.active===active)fail(409,'action_unavailable','المرادف على هذه الحالة أصلًا');
  db.prepare('UPDATE policy_synonyms SET active=? WHERE id=?').run(active,row.id);
  audit(db,u,'policy_synonym',row.id,'policy_library.synonym_'+(active?'activated':'deactivated'),{active:!!row.active},{active:!!active},input.note?v.text(input.note,'السبب',600,3):'');
  clearIndex(db);
  return {id:row.id,active:!!active};
}

// ── الأساس النظامي والرفض الآلي ────────────────────────────────────────────────
// الآلية: كل نموذج ورفض آلي يذكر مفتاحًا، والمفتاح يقود إلى مادة واحدة في المكتبة. الوحدة الأخرى لا تكتب رقم مادة
// في كودها ولا نصها، فإذا عُدّلت المادة أو استُبدلت تبعها كل ما يشير إليها.
export function basis(db,key){
  const row=typeof key==='string'&&db.prepare('SELECT * FROM policy_request_basis WHERE key=?').get(key);
  if(!row)return null;
  // المادة المستبدلة تُحوّل إلى التي حلّت محلها: «الأساس النظامي» يشير دائمًا إلى النص المعمول به.
  let article=db.prepare('SELECT * FROM policy_articles WHERE number=?').get(row.article_number);
  const replacement=article&&db.prepare("SELECT target_article_id FROM policy_article_links WHERE article_id=? AND kind='replaced_by'").get(article.id);
  if(replacement)article=db.prepare('SELECT * FROM policy_articles WHERE id=?').get(replacement.target_article_id);
  if(!article)return null;
  return {key:row.key,label:row.label,kind:row.kind,
    article_number:article.number,article_title:article.title,chapter:article.chapter,
    status:article.status,status_name:ARTICLE_STATUS[article.status],
    superseded_number:replacement?row.article_number:null,
    link:`#policy-library/article/${article.number}`,
    source_note:article.verification==='extracted'?SOURCE_NOTE:'طُوبقت مع الأصل الموقّع'};
}
export function basisView(db,supplied,key){
  actor(db,supplied);
  const found=basis(db,key);
  if(!found)fail(404,'not_found','لا أساس نظامي مسجل بهذا المفتاح');
  return {basis:found,no_print:NO_PRINT};
}
// نص الرفض الآلي: الرسالة ومعها المادة التي منعت. تستدعيها الوحدات بدل أن تكتب رقم المادة في رسالتها.
export function refusal(db,key,message){
  const found=basis(db,key);
  return found?`${message} — الأساس النظامي: المادة ${found.article_number} «${found.article_title}» (${found.chapter}).`:message;
}
export function basisCatalog(db,supplied){
  const u=actor(db,supplied);
  const rows=db.prepare('SELECT key FROM policy_request_basis ORDER BY kind,key').all().map(r=>basis(db,r.key)).filter(Boolean);
  return {user_id:u.id,
    forms:rows.filter(r=>r.kind==='form'),refusals:rows.filter(r=>r.kind==='refusal'),
    note:'كل نموذج طلب يعرض «الأساس النظامي» من هذه القائمة، وكل رفض آلي يذكر مادته. تغيير المادة يسري على كل ما يشير إليها.'};
}

// ── فحص الاكتمال ───────────────────────────────────────────────────────────────
// الفهرس الذي أعطاه المالك هو المرجع: 22 بابًا و127 مادة و50 صفًا في الجداول الثلاثة. الفحص يقارن ما في القاعدة به
// ويسمّي ما نقص، فلا تُقرأ مكتبة ناقصة على أنها كاملة.
export const CHAPTER_PLAN=[
  ['أحكام عامة',1,5],['التوظيف',6,17],['عقد العمل',18,38],['الإركاب',39,41],['التدريب',42,45],['الأجور',46,51],
  ['تقارير الأداء',52,55],['العلاوات والمكافآت',56,60],['الترقيات',61,62],['الانتداب',63,65],['المزايا والبدلات',66,72],
  ['أيام وساعات العمل',73,75],['العمل الإضافي',76,77],['التفتيش الإداري',78,79],['الإجازات',80,94],['الرعاية الطبية',95,100],
  ['أحكام خاصة بالمرأة',101,105],['الخدمات الاجتماعية',106,106],['ضوابط السلوك',107,110],['المخالفات والجزاءات',111,124],
  ['التظلم',125,126],['أحكام ختامية',127,127]];
export const PENALTY_PLAN=[['A',16],['B',18],['C',16]];
export function completenessReport(db){
  const rows=db.prepare('SELECT number,chapter,artifacts,verification,title_source FROM policy_articles ORDER BY number').all();
  const byNumber=new Map(rows.map(r=>[r.number,r]));
  const missing=[],misplaced=[];
  const chapters=CHAPTER_PLAN.map(([name,first,last])=>{
    const expected=[];
    for(let n=first;n<=last;n++){
      expected.push(n);
      const row=byNumber.get(n);
      if(!row)missing.push(n);
      else if(row.chapter!==name)misplaced.push({number:n,expected:name,found:row.chapter});
    }
    return {name,first,last,expected:expected.length,found:expected.filter(n=>byNumber.get(n)?.chapter===name).length};
  });
  const tableRows=db.prepare('SELECT table_key,COUNT(*) n FROM policy_table_rows GROUP BY table_key').all();
  const byTable=new Map(tableRows.map(r=>[r.table_key,r.n]));
  const penalties=PENALTY_PLAN.map(([key,expected])=>({table:key,expected,found:byTable.get(key)??0}));
  const clean=rows.filter(r=>JSON.parse(r.artifacts).length===0).length;
  return {
    expected_articles:127,found_articles:rows.length,missing,misplaced,
    expected_chapters:CHAPTER_PLAN.length,found_chapters:new Set(rows.map(r=>r.chapter)).size,chapters,
    expected_penalty_rows:50,found_penalty_rows:penalties.reduce((s,p)=>s+p.found,0),penalties,
    clean_articles:clean,
    needs_verification:rows.filter(r=>r.verification==='extracted').length,
    with_artifacts:rows.length-clean,
    proposed_titles:rows.filter(r=>r.title_source==='proposed').length,
    complete:rows.length===127&&!missing.length&&!misplaced.length&&penalties.every(p=>p.found===p.expected),
    note:'الاكتمال هنا يعني أن كل مادة في الفهرس المعتمد موجودة في مكانها، لا أن نصها طوبق مع الأصل الموقّع. المطابقة عدّاد منفصل.'};
}

// ── التحليلات ──────────────────────────────────────────────────────────────────
export function analytics(db,supplied){
  const u=curator(db,supplied);
  const terms=db.prepare('SELECT normalized,COUNT(*) n,MAX(created_at) t FROM policy_searches WHERE tenant_id=? GROUP BY normalized ORDER BY n DESC,normalized LIMIT 25').all(u.tenant_id);
  const empty=db.prepare('SELECT query,normalized,COUNT(*) n,MAX(created_at) t FROM policy_searches WHERE tenant_id=? AND results=0 GROUP BY normalized ORDER BY n DESC,normalized LIMIT 25').all(u.tenant_id);
  const views=db.prepare(`SELECT a.number,a.title,a.chapter,COUNT(*) n FROM policy_article_views w JOIN policy_articles a ON a.id=w.article_id
    WHERE w.tenant_id=? GROUP BY a.id ORDER BY n DESC,a.number LIMIT 25`).all(u.tenant_id);
  return {user_id:u.id,
    searches:db.prepare('SELECT COUNT(*) n FROM policy_searches WHERE tenant_id=?').get(u.tenant_id).n,
    most_searched:terms.map(t=>({term:t.normalized,count:t.n,last_at:t.t})),
    no_results:empty.map(t=>({query:t.query,term:t.normalized,count:t.n,last_at:t.t})),
    most_visited:views,
    completeness:completenessReport(db),
    note:'أسئلة بلا نتيجة هي قائمة العمل: إما مرادف ينقص القاموس، أو مادة نصها المستخرج تالف، أو موضوع لا تغطيه اللائحة أصلًا.'};
}
// لوحة الموارد البشرية: التحليلات والقاموس والوثائق وقائمة «الأساس النظامي» في شاشة واحدة.
export function adminBoard(db,supplied){
  const u=curator(db,supplied);
  return {today:today(),user_id:u.id,can_edit:true,
    analytics:analytics(db,u),synonyms:synonymBoard(db,u),basis:basisCatalog(db,u),
    documents:db.prepare('SELECT * FROM policy_documents ORDER BY status DESC,code').all().map(d=>({
      id:d.id,title:d.title,status:d.status,status_name:DOCUMENT_STATUS[d.status],source_note:d.source_note,version:d.version,
      articles:db.prepare('SELECT COUNT(*) n FROM policy_articles WHERE document_id=?').get(d.id).n})),
    no_print:NO_PRINT};
}

export function recordView(db,supplied,reference){
  writing(db);const u=actor(db,supplied);
  const article=findArticle(db,reference);
  db.prepare('INSERT INTO policy_article_views(id,tenant_id,article_id,user_id,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),u.tenant_id,article.id,u.id,now());
  return {id:article.id,number:article.number};
}
