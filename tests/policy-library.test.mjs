import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { normalize, stem, withinDistance } from '../app/arabic-text.mjs';
import { repairLine, reflowClauses, splitParagraphs, numberFromWords, spelledNumbers, readingScore } from '../app/policy-extract.mjs';
import { directArticle, buildIndex, search, synonymGroups, excerpt, matchingParagraph, fuzzyMatches } from '../app/policy-index.mjs';
import { libraryHome, searchLibrary, articleView, compareVersions, articleAction, acknowledgeReading, adminBoard,
  synonymBoard, addSynonym, synonymAction, createDocument, publishDocument, analytics, recordView, logSearch,
  basis, basisView, basisCatalog, refusal, completenessReport, libraryIndex, diffLines, retrievalSource, CHAPTER_PLAN, PENALTY_PLAN, SOURCE_NOTE } from '../app/policy-library.mjs';

// مكتبة السياسات (ترحيل 110). النص مستخرج من لائحة تنظيم العمل المعتمدة رقم 351743؛ الاختبارات على البيانات المصطنعة.
const code=value=>error=>error.code===value;
const status=value=>error=>error.status===value;

// تهيئة قاعدة كاملة تكلف ثوانٍ، والمكتبة في معظمها قراءة. الاختبارات التي لا تكتب تتشارك نسخة واحدة،
// والتي تكتب تأخذ نسخة خاصة بها فلا يتسرب أثر اختبار إلى غيره.
function build(){
  const db=openDb(':memory:');seed(db,'synthetic-policy-library');
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const grant=(user_id,capability)=>{
    try{tx(()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح تجريبي لمكتبة السياسات'}));}
    catch(error){if(error.code!=='already_default')throw error;}
  };
  grant('hr','hr.policy.prepare');
  grant('it','hr.policy.accept');
  return {db,users,tx,grant};
}
function fixture(t){const made=build();t.after(()=>made.db.close());return made;}
let shared=null;
const readOnly=()=>(shared??=build());
after(()=>shared?.db.close());
const numbers=results=>results.map(r=>r.number);

// ── إصلاح النص المستخرج ────────────────────────────────────────────────────────
test('المستخرج يعيد السطر المعكوس كلمةً كلمة إلى اتجاه القراءة', () => {
  // «شهادة اعتماد لائحة تنظيم العمل» كُتبت في الملف بترتيب الرسم من اليسار.
  assert.equal(repairLine('اﻟﻌﻤﻞ ﺗﻨﻈﻴﻢ ﻻﺋﺤﺔ اﻋﺘﻤﺎد ﺷﻬﺎدة').text,'شهادة اعتماد لائحة تنظيم العمل');
});

test('المستخرج يعكس السطر المقلوب حرفًا حرفًا قبل NFKC فلا تنقلب «لا» إلى «ال»', () => {
  const fixed=repairLine('ﺔﺤﺋﻼﻟا هﺬﻫ ﺲﻤﺗ ﻻ');
  assert.equal(fixed.mode,'reversed');
  assert.ok(fixed.text.startsWith('لا تمس هذه اللائحة'),fixed.text);
  assert.ok(!fixed.text.includes('الالئحة'),'ligature order must survive the reversal');
});

test('الأرقام داخل السطر المعكوس تعود إلى اتجاهها', () => {
  assert.ok(repairLine('٤٩١٥٥٨٢-١: ﻢﻗﺮﺑ نﻼﻋﻻاو ﺔﻳﺎﻋﺪﻠﻟ ﺔﺟرد نﻮﺘﺳو ﺔﺋﺎﻤﺛﻼﺛ').text.includes('١-٢٨٥٥١٩٤'));
});

test('التنوين المنفصل يلتحق بكلمته والتشكيل في أول الكلمة ينتقل إلى آخرها', () => {
  assert.equal(repairLine('اً ﻳﻮم ﺛﻼﺛﻮن').text,'ثلاثون يوماً');
  assert.ok(repairLine('أﻧﺜﻰ أو -ًذﻛﺮا').text.includes('ذكراً'));
});

test('الفاصلة تسبق حرف العطف كما تُكتب العربية', () => {
  assert.ok(repairLine('ﺗﻌﻮﻳﺾ أو، إﻧﺬار أو، ﻣﻜﺎﻓﺄة دون').text.includes('مكافأة، أو إنذار، أو تعويض'));
});

test('readingScore يميّز اتجاه القراءة من اتجاه الرسم', () => {
  assert.ok(readingScore('لا تمس هذه اللائحة')>readingScore('ةحئلالا هذه سمت لا'));
});

test('«؛» المنفردة تُعيد القطعة إلى موضعها وتوسم المادة بإعادة الترتيب', () => {
  const {lines,moved}=reflowClauses(['تدفع أجور العمال في مواعيد','؛','مع مراعاة برنامج حماية الأجور','استحقاقها وتودع في حسابات العمال']);
  assert.equal(moved,1);
  assert.deepEqual(lines,['مع مراعاة برنامج حماية الأجور؛','تدفع أجور العمال في مواعيد','استحقاقها وتودع في حسابات العمال']);
});

test('«؛» في أول سطر تُفصل ثم يُطبَّق النمط نفسه', () => {
  const {lines,moved}=reflowClauses(['؛ على أن تسترجع على شكل أقساط','للرئيس التنفيذي منح سلفة اضطرارية','من راتب العامل']);
  assert.equal(moved,1);
  assert.equal(lines[0],'للرئيس التنفيذي منح سلفة اضطرارية؛');
});

test('عنوان المادة في أول سطر لا يُعامل قطعةً معلّقة', () => {
  const {lines}=reflowClauses(['المحافظة على الصحة والسلامة في العمل','؛','أ. التقيد بقواعد السلامة','ب. إبلاغ المشرفين']);
  assert.equal(lines[0],'المحافظة على الصحة والسلامة في العمل','a heading stays a heading');
  assert.ok(lines[1].endsWith('؛'));
});

test('الفقرات المرقّمة تُفصل ويُستكمل السطر التالي في فقرته', () => {
  const items=splitParagraphs(['يحق للعامل ما يلي:','1. خمسة أيام عند زواجه.','2. ثلاثة أيام في حالة ولادة','مولود له.']);
  assert.equal(items.length,3);
  assert.equal(items[1].marker,'1');
  assert.equal(items[2].text,'ثلاثة أيام في حالة ولادة مولود له.');
});

// ── الأرقام بالحروف ────────────────────────────────────────────────────────────
test('الأرقام المكتوبة بالحروف تُقرأ أرقامًا', () => {
  assert.equal(numberFromWords(['الثمانون']),80);
  assert.equal(numberFromWords(['السادسه','والعشرين']),26);
  assert.equal(numberFromWords(['الحاديه','عشره']),11);
  assert.equal(numberFromWords(['الخامسه','والسبعون']),75);
  assert.equal(numberFromWords(['ورد','نص']),null);
});

test('spelledNumbers يمسح النص فيلتقط كل رقم مكتوب بالحروف', () => {
  const found=spelledNumbers(normalize('طبقا للمادة الثمانون من نظام العمل وللمادة الثالثة والسبعون'));
  assert.deepEqual(found.map(f=>f.value),[80,73]);
});

// ── التطبيع والجذر والتقريب ────────────────────────────────────────────────────
test('التطبيع يوحّد الهمزة والتاء المربوطة والألف المقصورة والتشكيل والأرقام', () => {
  assert.equal(normalize('الإجَازَة'),normalize('الاجازه'));
  assert.equal(normalize('مُستشفى'),normalize('مستشفي'));
  assert.equal(normalize('٦٥'),'65');
  assert.equal(normalize('مــادة'),'ماده');
});

test('الجذر الخفيف يجمع إجازة وإجازاته دون أن يتلف كلمة أصلها حرف سابقة', () => {
  assert.equal(stem('إجازة'),stem('الإجازات'));
  assert.equal(stem('إجازته'),stem('إجازة'));
  assert.equal(stem('كامل'),'كامل','the kaf is a root letter here');
  assert.equal(stem('وفاة'),'وفا','the waw is a root letter here');
});

test('مسافة التحرير محدودة وتتوقف عند تجاوز الحد', () => {
  assert.equal(withinDistance('انتذاب','انتداب',1),1);
  assert.equal(withinDistance('انتذاب','اجازه',1),-1);
  assert.equal(withinDistance('نص','نص',2),0);
});

// ── الانتقال المباشر ───────────────────────────────────────────────────────────
test('الرقم المباشر يُقرأ بصوره كلها', () => {
  for(const query of ['65','٦٥','مادة 65','م65','م/65','المادة رقم 65','م 65'])
    assert.equal(directArticle(query),65,query);
  assert.equal(directArticle('إجازة'),null);
});

// ── الاكتمال ───────────────────────────────────────────────────────────────────
test('فحص الاكتمال: 127 مادة في 22 بابًا و50 صفًا في الجداول الثلاثة', t => {
  const {db}=readOnly();
  const report=completenessReport(db);
  assert.equal(report.found_articles,127);
  assert.deepEqual(report.missing,[]);
  assert.deepEqual(report.misplaced,[]);
  assert.equal(report.found_chapters,22);
  assert.equal(report.expected_chapters,CHAPTER_PLAN.length);
  assert.equal(report.found_penalty_rows,50);
  assert.deepEqual(report.penalties.map(p=>[p.table,p.found]),PENALTY_PLAN);
  assert.ok(report.complete);
  // الاكتمال ليس المطابقة: كل مادة تبقى «مستخرج — يحتاج مطابقة» حتى يعتمدها الأدمن.
  assert.equal(report.needs_verification,127);
});

test('كل باب في الفهرس المعتمد موجود بمداه', t => {
  const {db}=readOnly();
  for(const [name,first,last] of CHAPTER_PLAN){
    const rows=db.prepare('SELECT number FROM policy_articles WHERE chapter=? ORDER BY number').all(name).map(r=>r.number);
    assert.equal(rows[0],first,name);
    assert.equal(rows.at(-1),last,name);
    assert.equal(rows.length,last-first+1,name);
  }
});

// ── جدول القبول الذي كتبه المالك ───────────────────────────────────────────────
test('«٨٢» تفتح المادة 82 مباشرة', t => {
  const {db,users}=readOnly();
  const result=searchLibrary(db,users.employee,{q:'٨٢'});
  assert.equal(result.direct_article.number,82);
  assert.equal(result.direct_article.chapter,'الإجازات');
});

test('«اجازه زواج» تعيد المادة 82 أولًا', t => {
  const {db,users}=readOnly();
  assert.equal(searchLibrary(db,users.employee,{q:'اجازه زواج'}).results[0].number,82);
});

test('«كم يوم سكليف براتب كامل» تُظهر المادتين 83 و88', t => {
  const {db,users}=readOnly();
  const found=numbers(searchLibrary(db,users.employee,{q:'كم يوم سكليف براتب كامل'}).results);
  assert.ok(found.includes(83),`expected 83 in ${found}`);
  assert.ok(found.includes(88),`expected 88 in ${found}`);
});

test('«مدة التظلم» تعيد المادة 126 أولًا موسومة بأنها تحل محل 125', t => {
  const {db,users}=readOnly();
  const top=searchLibrary(db,users.employee,{q:'مدة التظلم'}).results[0];
  assert.equal(top.number,126);
  assert.ok(top.badges.some(b=>b.key==='replaces'&&b.article_number===125),JSON.stringify(top.badges));
});

test('«إجازة الأمومة» تعيد المادة 105 أولًا والمادة 101 تحتها مع بديلها', t => {
  const {db,users}=readOnly();
  const results=searchLibrary(db,users.employee,{q:'إجازة الأمومة'}).results;
  assert.equal(results[0].number,105);
  const old=results.find(r=>r.number===101);
  assert.ok(old,'the replaced article stays visible');
  assert.equal(old.in_force_instead,105);
});

test('سؤال لا نص له يعيد «لا يوجد نص» ولا يعرض مادة لامست كلمة عابرة', t => {
  const {db,users}=readOnly();
  const result=searchLibrary(db,users.employee,{q:'زقزقة العصافير في المكتب'});
  assert.equal(result.results.length,0);
  assert.equal(result.direct_article,null);
  assert.equal(result.empty_message,'لا يوجد نص');
});

// ── البحث: مرادفات وتقريب وأرقام ───────────────────────────────────────────────
test('المرادف الذي بذره المالك يوسّع البحث دون تغيير النص', t => {
  const {db,users}=readOnly();
  const result=searchLibrary(db,users.employee,{q:'سفر عمل'});
  assert.equal(result.results[0].number,65);
  assert.ok(result.explain.synonyms.includes('انتداب'));
});

test('خطأ كتابة صغير يجد الكلمة الصحيحة', t => {
  const {db,users}=readOnly();
  const result=searchLibrary(db,users.employee,{q:'انتذاب'});
  assert.ok(result.explain.fuzzy.some(f=>f.from==='انتذاب'&&f.to==='انتداب'),JSON.stringify(result.explain.fuzzy));
  assert.ok(numbers(result.results).some(n=>n>=63&&n<=65),numbers(result.results).join(','));
});

test('الكلمة التي لها مرادف مسجّل لا تُقرَّب إلى كلمة أخرى', t => {
  const {db,users}=readOnly();
  const result=searchLibrary(db,users.employee,{q:'سكليف'});
  assert.ok(!result.explain.fuzzy.some(f=>f.from==='سكليف'),JSON.stringify(result.explain.fuzzy));
});

test('الرقم المكتوب بالحروف يصل إلى المادة كما يصل الرقم', t => {
  const {db}=readOnly();
  const {index}=libraryIndex(db);
  assert.ok((index.byNumber.get(80)??new Set()).size>0);
  assert.ok((index.byNumber.get(26)??new Set()).size>0);
});

test('البحث يستوي مهما كُتبت صورة الحرف أو نوع الرقم', t => {
  const {db,users}=readOnly();
  const a=numbers(searchLibrary(db,users.employee,{q:'الإجازة السنوية'}).results).slice(0,3);
  const b=numbers(searchLibrary(db,users.employee,{q:'الاجازه السنويه'}).results).slice(0,3);
  assert.deepEqual(a,b);
});

test('المرشحات تحصر النتائج في الباب والحالة والمحتوى', t => {
  const {db,users}=readOnly();
  const chapter=searchLibrary(db,users.employee,{q:'إجازة',chapter:'الإجازات'});
  assert.ok(chapter.results.length);
  assert.ok(chapter.results.every(r=>r.chapter==='الإجازات'));
  const replaced=searchLibrary(db,users.employee,{q:'وضع',status:'replaced'});
  assert.ok(replaced.results.every(r=>r.status==='replaced'));
  const penalties=searchLibrary(db,users.employee,{q:'جزاء',content:'penalties'});
  assert.ok(penalties.results.every(r=>r.number===112));
});

test('النتيجة تحمل مقتطفًا موسومًا ورقم الفقرة المطابقة', t => {
  const {db,users}=readOnly();
  const top=searchLibrary(db,users.employee,{q:'زواجه'}).results[0];
  assert.ok(top.excerpt.parts.some(p=>p.hit),JSON.stringify(top.excerpt));
  assert.ok(Number.isInteger(top.scroll_to));
});

test('البحث على حجم هذه البيانات دون 300 مللي ثانية', t => {
  const {db,users}=readOnly();
  searchLibrary(db,users.employee,{q:'تهيئة الفهرس'});
  const started=Date.now();
  for(let i=0;i<20;i++)searchLibrary(db,users.employee,{q:'إجازة مرضية بأجر كامل'});
  const each=(Date.now()-started)/20;
  assert.ok(each<300,`${each}ms per search`);
});

// ── صفحة المادة والشارات ───────────────────────────────────────────────────────
test('المادة 65 تعرض شارة التعديل وزر «تقديم طلب انتداب»', t => {
  const {db,users}=readOnly();
  const view=articleView(db,users.employee,'65');
  assert.ok(view.article.badges.some(b=>b.key==='amended_by'));
  assert.ok(view.article.actions.some(a=>a.name==='تقديم طلب انتداب'&&a.link==='#travel'));
  assert.equal(view.article.permalink,'#policy-library/article/65');
});

test('المادة المستبدلة تعرض شارتها ونصها الأصلي من المادة التي حلت محلها', t => {
  const {db,users}=readOnly();
  const view=articleView(db,users.employee,'105');
  assert.ok(view.article.badges.some(b=>b.key==='replaces'&&b.article_number===101));
  assert.equal(view.original_text[0].number,101);
  assert.ok(view.original_text[0].body.length>20);
  const old=articleView(db,users.employee,'101');
  assert.equal(old.article.status,'replaced');
  assert.ok(old.article.badges.some(b=>b.key==='replaced_by'&&b.article_number===105));
});

test('المادة 72 تحل محل مواد بدل السكن والنقل', t => {
  const {db,users}=readOnly();
  const view=articleView(db,users.employee,'72');
  const replaced=view.article.badges.filter(b=>b.key==='replaces').map(b=>b.article_number).sort((a,b)=>a-b);
  assert.deepEqual(replaced,[66,67,68]);
});

test('كل مادة موسومة «مستخرج — يحتاج مطابقة مع الأصل الموقّع»', t => {
  const {db,users}=readOnly();
  for(const number of [1,40,80,105,127]){
    const view=articleView(db,users.employee,String(number));
    assert.equal(view.article.source_note,SOURCE_NOTE);
    assert.ok(view.article.badges.some(b=>b.key==='unverified'));
  }
});

test('جداول الجزاءات تُعرض من وحدة الجزاءات ولا تُنسخ في المكتبة', t => {
  const {db,users}=readOnly();
  const view=articleView(db,users.employee,'112');
  const counts=view.article.penalties.tables.map(x=>x.rows.length);
  assert.deepEqual(counts,[16,18,16]);
  assert.equal(view.article.penalties.source.link,'#discipline');
  // النص نفسه غير مخزّن في جداول المكتبة: المكتبة تحفظ الربط فقط.
  const stored=db.prepare('SELECT COUNT(*) n FROM policy_table_rows').get().n;
  assert.equal(stored,50);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pragma_table_info('policy_table_rows') WHERE name='text'").get().n,0);
});

test('المادة تعرض السابقة والتالية وفهرس بابها ومواد ذات صلة', t => {
  const {db,users}=readOnly();
  const view=articleView(db,users.employee,'83');
  assert.equal(view.previous.number,82);
  assert.equal(view.next.number,84);
  assert.ok(view.chapter_index.some(x=>x.number===83));
  assert.ok(view.article.related.length>0);
  assert.ok(view.article.related.every(r=>r.number!==83));
});

test('البحث داخل المادة يحدد الفقرة المطابقة', t => {
  const {db,users}=readOnly();
  const view=articleView(db,users.employee,'82',{q:'زواجه'});
  assert.equal(view.article.scroll_to,2,'الفقرة الثانية هي «خمسة أيام عند زواجه»');
});

test('الإحالة إلى نظام العمل تُوسم مرجعًا خارجيًا ولا تفتح مادة', t => {
  const {db,users}=readOnly();
  const view=articleView(db,users.employee,'118');
  assert.ok(view.article.external_references.length>0);
  assert.ok(view.article.external_references[0].note.includes('مرجع خارجي'));
});

// ── لا طباعة ───────────────────────────────────────────────────────────────────
test('لا نقطة طباعة ولا تصدير: السجل إلكتروني ورابط يُنسخ', t => {
  const {db,users}=readOnly();
  assert.ok(libraryHome(db,users.employee).no_print.includes('لا طباعة'));
  assert.ok(articleView(db,users.employee,'80').article.no_print.includes('لا طباعة'));
});

// ── المفضلة والإقرار ───────────────────────────────────────────────────────────
test('المفضلة لصاحبها وحده', t => {
  const {db,users,tx}=fixture(t);
  tx(()=>articleAction(db,users.employee,'80','favourite_article',{}));
  assert.ok(articleView(db,users.employee,'80').article.favourite);
  assert.equal(articleView(db,users.manager,'80').article.favourite,false);
  assert.deepEqual(libraryHome(db,users.employee).favourites.map(f=>f.number),[80]);
  assert.deepEqual(libraryHome(db,users.manager).favourites,[]);
  tx(()=>articleAction(db,users.employee,'80','unfavourite_article',{}));
  assert.equal(articleView(db,users.employee,'80').article.favourite,false);
});

test('«قرأت واطلعت» على المادة مرتبط بنسختها ولا يُكرَّر', t => {
  const {db,users,tx}=fixture(t);
  const revision=articleView(db,users.employee,'80').article.revision;
  const done=tx(()=>articleAction(db,users.employee,'80','acknowledge_article',{confirm:true,revision}));
  assert.ok(done.acknowledged_at);
  assert.throws(()=>tx(()=>articleAction(db,users.employee,'80','acknowledge_article',{confirm:true,revision})),code('already_acknowledged'));
  assert.throws(()=>tx(()=>articleAction(db,users.manager,'80','acknowledge_article',{confirm:true,revision:revision+5})),code('revision_mismatch'));
  assert.throws(()=>tx(()=>articleAction(db,users.manager,'80','acknowledge_article',{confirm:false,revision})),code('confirm'));
});

test('«قرأت واطلعت» على اللائحة يُسجَّل مرة لكل نسخة', t => {
  const {db,users,tx}=fixture(t);
  const home=libraryHome(db,users.employee);
  assert.deepEqual(home.acknowledgement.actions,['acknowledge_reading']);
  tx(()=>acknowledgeReading(db,users.employee,home.acknowledgement.document_id,{confirm:true}));
  const after=libraryHome(db,users.employee);
  assert.ok(after.acknowledgement.acknowledged_at);
  assert.deepEqual(after.acknowledgement.actions,[]);
  assert.throws(()=>tx(()=>acknowledgeReading(db,users.employee,home.acknowledgement.document_id,{confirm:true})),code('already_acknowledged'));
});

test('الوثيقة المسودة لا يُقر بقراءتها', t => {
  const {db,users,tx}=readOnly();
  const draft=db.prepare("SELECT id FROM policy_documents WHERE status='draft' LIMIT 1").get();
  assert.throws(()=>tx(()=>acknowledgeReading(db,users.employee,draft.id,{confirm:true})),code('not_found'));
});

// ── الخصوصية والتصاريح ─────────────────────────────────────────────────────────
test('المكتبة يقرؤها كل موظف بلا تصريح، والتحرير محصور في الموارد البشرية', t => {
  const {db,users,tx}=readOnly();
  for(const person of [users.employee,users.manager,users.outsider]){
    assert.equal(libraryHome(db,person).total_articles,127);
    assert.equal(articleView(db,person,'80').article.number,80);
    assert.equal(libraryHome(db,person).can_edit,false);
  }
  const article=articleView(db,users.employee,'80');
  assert.ok(!article.actions.includes('edit_article'));
  assert.throws(()=>tx(()=>articleAction(db,users.employee,'80','edit_article',
    {version:article.article.version,title:'عنوان',body:'نص جديد كافٍ الطول',status:'in_force',effective_from:'2026-01-01',note:'محاولة غير مصرح بها'})),code('not_permitted'));
  assert.throws(()=>adminBoard(db,users.employee),code('not_permitted'));
  assert.throws(()=>analytics(db,users.employee),code('not_permitted'));
  assert.throws(()=>tx(()=>addSynonym(db,users.employee,{head:'اجازه',term:'عطله'})),code('not_permitted'));
});

test('حساب الأدمن لا يحرر المكتبة ولا يعتمد عناوينها', t => {
  const {db,users,tx}=readOnly();
  assert.throws(()=>adminBoard(db,users.admin),code('not_permitted'));
  assert.throws(()=>tx(()=>addSynonym(db,users.admin,{head:'اجازه',term:'عطله'})),code('not_permitted'));
});

// ── تحرير الموارد البشرية والنسخ ───────────────────────────────────────────────
test('التعديل ينشئ نسخة جديدة بتاريخ سريان وتبقى السابقة للمقارنة', t => {
  const {db,users,tx}=fixture(t);
  const before=articleView(db,users.hr,'80');
  assert.ok(before.actions.includes('edit_article'));
  tx(()=>articleAction(db,users.hr,'80','edit_article',{version:before.article.version,
    title:'الإجازة السنوية',body:'يستحق العامل إجازة سنوية مدتها واحد وعشرون يوماً بأجر كامل.',
    status:'in_force',effective_from:'2026-01-01',note:'تصحيح تجريبي بعد مطابقة النص مع الأصل الموقّع'}));
  const after=articleView(db,users.hr,'80');
  assert.equal(after.article.revision,before.article.revision+1);
  assert.equal(after.article.title,'الإجازة السنوية');
  assert.equal(after.versions.length,2);
  const diff=compareVersions(db,users.employee,'80',{});
  assert.equal(diff.from.revision,1);
  assert.equal(diff.to.revision,2);
  assert.ok(diff.lines.some(l=>l.side==='removed'));
  assert.ok(diff.lines.some(l=>l.side==='added'));
  assert.ok(verifyAudit(db));
});

test('التعديل يحتاج رقم النسخة الصحيح ولا يُقبل بلا تغيير', t => {
  const {db,users,tx}=readOnly();
  const article=articleView(db,users.hr,'81').article;
  const payload={version:article.version,title:article.title,body:article.body,status:article.status,effective_from:article.effective_from,note:'لا تغيير في هذه المحاولة'};
  assert.throws(()=>tx(()=>articleAction(db,users.hr,'81','edit_article',payload)),code('no_change'));
  assert.throws(()=>tx(()=>articleAction(db,users.hr,'81','edit_article',{...payload,version:article.version+3,title:'عنوان آخر'})),code('stale_version'));
});

test('النسخة المحفوظة لا تُعاد كتابتها ولا تُحذف', t => {
  const {db}=readOnly();
  assert.throws(()=>db.prepare("UPDATE policy_article_versions SET body='نص مبدّل' WHERE revision=1").run());
  assert.throws(()=>db.prepare('DELETE FROM policy_article_versions WHERE revision=1').run());
  assert.throws(()=>db.prepare('DELETE FROM policy_articles WHERE number=1').run());
});

test('تأكيد المطابقة يرفع الوسم عن مادة واحدة لا عن المكتبة كلها', t => {
  const {db,users,tx}=fixture(t);
  const article=articleView(db,users.hr,'2').article;
  tx(()=>articleAction(db,users.hr,'2','verify_article',{version:article.version,note:'طوبقت مع الصفحة الرابعة من الأصل الموقّع'}));
  assert.equal(articleView(db,users.employee,'2').article.verification,'verified');
  assert.ok(!articleView(db,users.employee,'2').article.badges.some(b=>b.key==='unverified'));
  assert.equal(completenessReport(db).needs_verification,126);
  assert.ok(articleView(db,users.employee,'3').article.badges.some(b=>b.key==='unverified'));
});

test('تعديل نص مادة مطابَقة يُسقط المطابقة، وتغيير حالتها وحدها لا يُسقطها', t => {
  // المطابقة إقرار بأن نصنا هو نص الأصل الموقّع. فإن أُعيدت كتابة النص بقي الوسم يشهد لنصّ لم يره أحد.
  const {db,users,tx}=fixture(t);
  const fresh=()=>articleView(db,users.hr,'2').article;
  const baseline=completenessReport(db).needs_verification;
  tx(()=>articleAction(db,users.hr,'2','verify_article',{version:fresh().version,note:'طوبقت مع الصفحة الرابعة من الأصل الموقّع'}));
  assert.equal(articleView(db,users.employee,'2').article.verification,'verified');
  assert.equal(completenessReport(db).needs_verification,baseline-1);

  const verified=fresh();
  tx(()=>articleAction(db,users.hr,'2','edit_article',{version:verified.version,title:verified.title,
    body:'نص أُعيدت كتابته بعد المطابقة، وطوله كافٍ للتحقق من الحقل.',
    status:verified.status,effective_from:'2026-01-01',note:'تصحيح تجريبي على نص مادة سبق أن طوبقت'}));
  const after=articleView(db,users.employee,'2').article;
  assert.equal(after.verification,'extracted');
  assert.ok(after.badges.some(b=>b.key==='unverified'));
  assert.equal(after.source_note,SOURCE_NOTE);
  assert.equal(completenessReport(db).needs_verification,baseline);
  // والمساعد يقتبسها موسومة من جديد، لا نصًّا نظيف الشكل بلا سند.
  const quoted=retrievalSource.articles(db,users.employee.tenant_id,'2026-09-26').find(a=>a.code==='م2');
  assert.ok(quoted.source.includes(SOURCE_NOTE),quoted.source);

  // وحال المادة حالُ اللائحة لا حالُ نقلنا عنها: إلغاؤها بلا مساس بنصها لا يُسقط مطابقةً قائمة.
  tx(()=>articleAction(db,users.hr,'2','verify_article',{version:fresh().version,note:'طوبقت من جديد بعد التصحيح'}));
  const again=fresh();
  tx(()=>articleAction(db,users.hr,'2','edit_article',{version:again.version,title:again.title,body:again.body,
    status:'repealed',effective_from:again.effective_from,note:'إلغاء المادة بموجب تعميم، بلا مساس بنصها'}));
  assert.equal(articleView(db,users.employee,'2').article.verification,'verified');
  assert.ok(verifyAudit(db));
});

test('العنوان المقترح يعتمده الأدمن فيصير معتمدًا', t => {
  const {db,users,tx}=fixture(t);
  const proposed=db.prepare("SELECT number FROM policy_articles WHERE title_source='proposed' ORDER BY number LIMIT 1").get();
  const article=articleView(db,users.hr,String(proposed.number)).article;
  assert.equal(article.title_source,'proposed');
  tx(()=>articleAction(db,users.hr,String(proposed.number),'approve_title',{version:article.version,title:'عنوان معتمد للمادة'}));
  const after=articleView(db,users.employee,String(proposed.number)).article;
  assert.equal(after.title,'عنوان معتمد للمادة');
  assert.equal(after.title_source,'approved');
});

test('الفهرس يُعاد بناؤه وحده بعد التعديل', t => {
  const {db,users,tx}=fixture(t);
  assert.equal(searchLibrary(db,users.employee,{q:'زقزقة'}).results.length,0);
  const article=articleView(db,users.hr,'106').article;
  tx(()=>articleAction(db,users.hr,'106','edit_article',{version:article.version,title:article.title,
    body:'تنظم المنشأة زقزقة الطيور في حديقة المقر ضمن الخدمات الاجتماعية.',
    status:'in_force',effective_from:'2026-02-01',note:'نص تجريبي للتحقق من إعادة الفهرسة الآلية'}));
  assert.equal(searchLibrary(db,users.employee,{q:'زقزقة'}).results[0].number,106);
});

// ── قاموس المرادفات ────────────────────────────────────────────────────────────
test('قائمة المالك مبذورة في القاموس', t => {
  const {db,users}=readOnly();
  const board=synonymBoard(db,users.employee);
  const heads=board.groups.map(g=>g.head);
  for(const head of ['انتداب','اجر','اجازة مرضية','فصل','نهاية الخدمة','تأخر','غياب','ولادة','تذكرة','نادي','تأمين الوالدين'])
    assert.ok(heads.includes(head),`${head} missing from ${heads.join(', ')}`);
  assert.equal(board.can_edit,false);
});

test('الأدمن يضيف مرادفًا فيعمل فورًا ويعطّله فيتوقف', t => {
  const {db,users,tx}=fixture(t);
  assert.equal(searchLibrary(db,users.employee,{q:'بيرمت'}).results.length,0);
  const added=tx(()=>addSynonym(db,users.hr,{head:'إجازة','term':'بيرمت'}));
  assert.ok(searchLibrary(db,users.employee,{q:'بيرمت'}).results.length>0);
  tx(()=>synonymAction(db,users.hr,added.id,'deactivate_synonym',{note:'تعطيل تجريبي'}));
  assert.equal(searchLibrary(db,users.employee,{q:'بيرمت'}).results.length,0);
  assert.ok(verifyAudit(db));
});

// ── الأساس النظامي والرفض الآلي ────────────────────────────────────────────────
test('كل نموذج مسجّل يحمل أساسًا نظاميًا يفتح مادته', t => {
  const {db,users}=readOnly();
  const catalog=basisCatalog(db,users.employee);
  assert.ok(catalog.forms.length>=5,`${catalog.forms.length} forms`);
  assert.ok(catalog.refusals.length>=5,`${catalog.refusals.length} refusals`);
  for(const row of [...catalog.forms,...catalog.refusals]){
    assert.ok(row.article_number>=1&&row.article_number<=127,row.key);
    assert.equal(row.link,`#policy-library/article/${row.article_number}`);
    assert.ok(row.article_title.length>1,row.key);
  }
  for(const key of ['leave.annual','leave.marriage','leave.sick','overtime.request','secondment.request'])
    assert.ok(catalog.forms.some(f=>f.key===key),key);
  for(const key of ['leave.unpaid.over_limit','deduction.over_cap','penalty.stale','grievance.late','overtime.unapproved'])
    assert.ok(catalog.refusals.some(f=>f.key===key),key);
});

test('الأساس النظامي يتبع المادة السارية حين تُستبدل', t => {
  const {db,users}=readOnly();
  // إجازة الوضع سندها م101 في الأصل، وم105 حلت محلها، فالنموذج يشير إلى 105.
  assert.equal(basis(db,'leave.maternity').article_number,105);
  assert.equal(basis(db,'grievance.file').article_number,126);
  assert.equal(basisView(db,users.employee,'leave.annual').basis.article_number,80);
  assert.throws(()=>basisView(db,users.employee,'no.such.key'),status(404));
});

test('الرفض الآلي يسمي المادة التي منعت', t => {
  const {db}=readOnly();
  const message=refusal(db,'deduction.over_cap','تعذّر تسجيل الاستقطاع');
  assert.ok(message.includes('الأساس النظامي'));
  assert.ok(message.includes('المادة 116'));
  // مفتاح غير مسجل يعيد الرسالة كما هي بلا اختراع مادة.
  assert.equal(refusal(db,'unknown.key','رسالة'),'رسالة');
});

// ── التحليلات ──────────────────────────────────────────────────────────────────
test('التحليلات تجمع الأكثر بحثًا والأسئلة بلا نتيجة والأكثر زيارة', t => {
  const {db,users,tx}=fixture(t);
  tx(()=>logSearch(db,users.employee,{q:'إجازة زواج',results:4}));
  tx(()=>logSearch(db,users.employee,{q:'إجازة زواج',results:4}));
  tx(()=>logSearch(db,users.manager,{q:'بدل رضاعة',results:0}));
  tx(()=>recordView(db,users.employee,'82'));
  tx(()=>recordView(db,users.manager,'82'));
  const board=analytics(db,users.hr);
  assert.equal(board.most_searched[0].term,normalize('إجازة زواج'));
  assert.equal(board.most_searched[0].count,2);
  assert.ok(board.no_results.some(x=>x.query==='بدل رضاعة'));
  assert.equal(board.most_visited[0].number,82);
  assert.equal(board.most_visited[0].n,2);
  assert.equal(libraryHome(db,users.employee).popular_terms[0].term,normalize('إجازة زواج'));
});

// ── رفع تعميم جديد ─────────────────────────────────────────────────────────────
test('التعميم الجديد يُلصق فيُصلَح ويُربط بالمواد التي يعدّلها ثم يُنشر', t => {
  const {db,users,tx}=fixture(t);
  const created=tx(()=>createDocument(db,users.hr,{code:'allowance_circular',title:'تعميم بدل السكن',
    text:'اﻟﺴﻜﻦ ﺑﺪل ﺗﻌﺪﻳﻞ\nﺑﺎﻷﺟﺮ ﻳُﺪﻓﻊ ﻧﻘﺪي ﺑﺪل إﻟﻰ اﻟﺴﻜﻦ ﺑﺪل ﻳُﺤﻮّل',
    amends:[69],note:'نص لُصق من ملف التعميم الذي سلّمته الموارد البشرية للاختبار'}));
  assert.ok(created.repaired_lines>=2);
  assert.ok(created.preview.includes('تعديل بدل السكن'),created.preview);
  assert.deepEqual(created.amended,[69]);
  assert.equal(articleView(db,users.employee,'69').article.status,'amended');
  const board=adminBoard(db,users.hr);
  const document=board.documents.find(d=>d.id===created.id);
  assert.equal(document.status,'draft');
  const published=tx(()=>publishDocument(db,users.hr,created.id,{version:document.version,effective_from:'2026-03-01',note:'ينشر التعميم ويصبح بدل السكن نقديًا'}));
  assert.equal(published.status,'published');
  assert.ok(published.notified.includes('قرأت واطلعت'));
  assert.ok(verifyAudit(db));
});

test('رمز وثيقة مكرر أو نص قصير يُرفض', t => {
  const {db,users,tx}=readOnly();
  const payload={code:'work_regulation',title:'تكرار',text:'نص طويل كافٍ لتجاوز الحد الأدنى للاختبار',note:'محاولة تكرار الرمز في الاختبار'};
  assert.throws(()=>tx(()=>createDocument(db,users.hr,payload)),code('code_exists'));
  assert.throws(()=>tx(()=>createDocument(db,users.hr,{...payload,code:'Bad-Code'})),code('code'));
  assert.throws(()=>tx(()=>createDocument(db,users.hr,{...payload,code:'short_one',text:'قصير'})),code('invalid_text'));
});

// ── تفاصيل الفهرس والمقتطف ─────────────────────────────────────────────────────
test('buildIndex وsearch يعملان على بيانات مصغّرة بلا قاعدة بيانات', () => {
  const articles=[
    {id:'a',number:1,title:'الإجازة السنوية',body:'يستحق العامل إجازة سنوية بأجر كامل.',keywords:['اجاز'],status:'in_force',chapter:'الإجازات'},
    {id:'b',number:2,title:'بدل الانتداب',body:'يصرف بدل الانتداب عن كل يوم فعلي خارج مقر العمل.',keywords:['انتداب'],status:'in_force',chapter:'الانتداب'}];
  const index=buildIndex(articles);
  const byTerm=synonymGroups([{head:'انتداب',term:'سفر عمل',active:1}]);
  assert.equal(search(index,'انتداب',{byTerm}).results[0].article.id,'b');
  assert.equal(search(index,'سفر عمل',{byTerm}).results[0].article.id,'b');
  assert.equal(search(index,'اجازه سنويه',{byTerm}).results[0].article.id,'a');
  assert.ok(fuzzyMatches('انتذاب',index).some(c=>c.word==='انتداب'));
});

test('المقتطف يعيد قطعًا موسومة ولا يخرج HTML', () => {
  const piece=excerpt('يستحق العامل إجازة سنوية بأجر كامل عن كل سنة خدمة','إجازة');
  assert.ok(piece.parts.some(p=>p.hit&&p.text.includes('إجازة')));
  assert.ok(piece.parts.every(p=>!/[<>]/.test(p.text)));
});

test('matchingParagraph يعيد رقم الفقرة التي فيها الكلمة', () => {
  const paragraphs=[{index:1,text:'أحكام عامة'},{index:2,text:'خمسة أيام عند زواجه'}];
  assert.equal(matchingParagraph(paragraphs,'زواجه'),2);
  assert.equal(matchingParagraph(paragraphs,'انتداب'),null);
});

test('diffLines يسمّي الباقي والمحذوف والمضاف', () => {
  const lines=diffLines('سطر أول\nسطر ثان','سطر أول\nسطر ثالث');
  assert.deepEqual(lines.map(l=>l.side),['same','removed','added']);
});
