// أعمدة صفحة الخدمة الأربعة (ترحيل 131): كاتبها، وحارسها، واشتقاقها، وما تقوله حين تبقى فارغة.
//
// العطب الذي يغلقه هذا الملف: أضاف الترحيل 131 أربعة أعمدة إلى service_cards — short_description
// وeligibility_rules وrequired_documents وfaq — ولم يكتبها شيءٌ في app/ قط. 142 صفًّا تحمل ''
// و'{}' و'[]' و'[]'، فتطبع صفحة كل خدمة «غير متاح» في «هل تنطبق عليك» و«ما تحتاجه» و«أسئلة شائعة».
//
// وما يحرسه هنا بعد إغلاقه:
//   (1) الكتابة تمرّ من باب saveCard نفسه: التصريح، والمعاملة، وقاعدة «المعدّ غير مالك الإجراء».
//   (2) شكل JSON يُفحص ويُردّ بسببٍ مسمًّى، فلا يصل العمود نصٌّ فاسد يُقرأ بعد شهر فراغًا صامتًا.
//   (3) الاشتقاق من بنية المنصة وحدها. و**faq لا تُشتق أبدًا**: لا مصدر صادق لها، وتوليدها اختراع.
//   (4) الفارغ يصل الشاشة ومعه سببه ومن يملك كتابته — لا «غير متاح» عارية.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { serviceCard, cardsBoard, saveCard, draftMissingCards, publishCard, contentSuggestion, documentsFrom, eligibilityFrom, shortDescriptionFrom } from '../app/service-cards.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { catalog } from '../app/workflow.mjs';

const code=value=>error=>error.code===value;
const tomorrow=()=>new Date(Date.now()+27*3600000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-card-content');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const full={owner_id:'hr',requesters:'كل موظف على رأس العمل',service_kind:'institutional',confidentiality:'restricted',trigger_note:'حاجة الموظف إلى خطاب لجهة خارجية',outputs:'خطاب موقّع يُسلَّم للموظف',acceptance_evidence:'تأكيد الموظف استلام الخطاب',financial_limit_note:'',exceptions_note:'',kpis:'نسبة الإنجاز ضمن الزمن المستهدف',integrations:'',policy_reference:''};
  return {db,users,tx,full};
}
// الدليل كاملًا (142 خدمة و15 مدير إدارة): الاشتقاق والطوابير لا يُقاسان على ثلاث خدمات مبذورة.
function wholeCatalog(t){
  const db=openDb(':memory:');seed(db,'synthetic-card-content-catalog');installServiceCatalog(db);
  t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,users,tx:f=>transaction(db,f),services:new Map(catalog(db,users.admin,{includeHidden:true}).map(s=>[s.code,s]))};
}

test('أعمدة الصفحة الأربعة: تُكتب من باب البطاقة نفسه، وتُقرأ على البطاقة، ويحرسها التصريح وفصل المهام',t=>{
  const {db,users,tx,full}=fixture(t);
  const content={short_description:'خطاب تعريف بالراتب لجهة خارجية',
    eligibility_rules:'كل موظف على رأس العمل\nما تنطبق على المتعاقد بأمر شراء',
    required_documents:'اسم الجهة المطلوب الخطاب لها',
    faq:'كم ياخذ الخطاب؟ | ثلاثة أيام عمل من التقديم\nينفع بالإنجليزي؟ | إي، اختر اللغة في النموذج'};
  // الباب نفسه: من لا يملك «إعداد الخدمات» لا يكتبها، كما لا يكتب بقية البطاقة.
  assert.throws(()=>tx(()=>saveCard(db,users.manager,'HR-LETTER',{...full,...content})),code('not_permitted'));
  // المعدّ لا يكون مالك الإجراء — القاعدة نفسها، لا استثناء للأعمدة الجديدة.
  assert.throws(()=>tx(()=>saveCard(db,users.admin,'HR-LETTER',{...full,...content,owner_id:'admin'})),error=>['owner_id','separation_of_duties'].includes(error.code));
  // والكتابة تتطلب معاملة كبقية الكتابة في المنصة.
  assert.throws(()=>saveCard(db,users.admin,'HR-LETTER',{...full,...content}),code('transaction_required'));

  tx(()=>saveCard(db,users.admin,'HR-LETTER',{...full,...content}));
  const draft=serviceCard(db,users.hr,'HR-LETTER').draft;
  assert.equal(draft.short_description,'خطاب تعريف بالراتب لجهة خارجية');
  assert.deepEqual(draft.eligibility.map(r=>r.text),['كل موظف على رأس العمل','ما تنطبق على المتعاقد بأمر شراء']);
  assert.deepEqual(draft.documents,['اسم الجهة المطلوب الخطاب لها']);
  assert.deepEqual(draft.faq_items,[{q:'كم ياخذ الخطاب؟',a:'ثلاثة أيام عمل من التقديم'},{q:'ينفع بالإنجليزي؟',a:'إي، اختر اللغة في النموذج'}]);
  // العمود يخرج من القاعدة JSON صحيحًا كما يشترط CHECK الترحيل، لا نصًّا حرًّا.
  const row=db.prepare("SELECT eligibility_rules,required_documents,faq FROM service_cards WHERE service_code='HR-LETTER'").get();
  assert.equal(JSON.parse(row.eligibility_rules).rules.length,2);
  assert.ok(Array.isArray(JSON.parse(row.required_documents))&&Array.isArray(JSON.parse(row.faq)));
  // وتصل المنشورة إلى قارئها كما كُتبت، ولا تُعدَّل بعد النشر إلا بنسخة جديدة.
  tx(()=>publishCard(db,users.hr,'HR-LETTER',{effective_from:tomorrow(),note:'أقر بملكية إجراء الخطابات ومخرجاته ومؤشراته'}));
  assert.deepEqual(serviceCard(db,users.employee,'HR-LETTER').published.documents,['اسم الجهة المطلوب الخطاب لها']);
  assert.throws(()=>db.prepare("UPDATE service_cards SET eligibility_rules='{}',version=version+1 WHERE status='published'").run(),/replaced by a new revision/);
  assert.ok(verifyAudit(db));
});

test('الشكل الفاسد يُردّ بسببٍ مسمًّى، لا يُخزَّن ولا يُبتلع صامتًا', t=>{
  const {db,users,tx,full}=fixture(t);
  const bad=(patch,expected)=>assert.throws(()=>tx(()=>saveCard(db,users.admin,'HR-LETTER',{...full,...patch})),code(expected));
  bad({faq:'سؤال بلا جواب'},'faq');                                    // ما فيه «|» فالجواب فاضي
  bad({faq:'ق | ج'},'faq');                                            // أقصر من الحد
  bad({faq:[{q:'كم ياخذ الخطاب؟'}]},'faq');                            // بنية بلا جواب
  bad({required_documents:[{name:'الفاتورة'}]},'required_documents');   // بند مو نصًّا
  bad({required_documents:'ا'},'required_documents');                   // أقصر من حرفين
  bad({eligibility_rules:{rules:'نص'}},'eligibility_rules');            // rules مو قائمة
  bad({eligibility_rules:{rules:[{kind:'خارج القائمة',text:'شرط طويل كفاية'}]}},'eligibility_rules');
  bad({eligibility_rules:{rules:[{text:'قصير'}]}},'eligibility_rules');
  bad({required_documents:Array.from({length:21},(_,i)=>`مستند رقم ${i}`)},'required_documents');
  bad({short_description:'ابج'},'invalid_text');                        // أقصر من خمسة أحرف
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM service_cards").get().n,0,'ما انحفظ ولا صفّ من المرفوض');
});

test('الاشتقاق: من بنية المنصة وحدها — الوصف من وصف الخدمة، والمستندات ممّا يسمّيه تعريفها، والأسئلة لا تُشتق أبدًا',t=>{
  const {db,users,tx,services}=wholeCatalog(t);
  tx(()=>draftMissingCards(db,users.admin));

  // (1) الوصف المختصر أول جملة من وصف الخدمة نفسه، بحرفه لا بإعادة صياغة.
  const letter=services.get('HR-LETTER');
  assert.equal(shortDescriptionFrom(letter),String(letter.description).split(/(?<=[.؟!])\s+/)[0]);
  assert.ok(shortDescriptionFrom(letter).length>0);

  // (2) المستندات ممّا يسمّيه التعريف: docs[] على خيار المجموعة، وعبارة «أرفق …» في الوصف — ولا شيء غيرهما.
  //     و«أرفق الفاتورة» يعطي «الفاتورة»؛ وخدمةٌ لا يسمّي تعريفها مستندًا تبقى بلا قائمة ولا تُخترع لها.
  assert.deepEqual(documentsFrom(services.get('FIN-PAYMENT-REQUEST')),['الفاتورة']);
  assert.deepEqual(documentsFrom(services.get('ACC-MEETING-MINUTES')),[],'لا يُخترع مستند لخدمة لا يسمّي تعريفها مستندًا');
  // الأخصّ يبقى والأعمّ الذي يقع داخله يسقط: «شهادة الآيبان» داخل «شهادة الآيبان من البنك باسم الموظف».
  const bank=documentsFrom(services.get('HR-BANK-CHANGE'));
  assert.ok(bank.some(d=>d.includes('شهادة الآيبان')));
  assert.equal(bank.filter(d=>d.includes('شهادة الآيبان')).length,1,'المستند الواحد مرة واحدة');

  // (3) الأهلية من بوابةٍ يفرضها الكود أو لا شيء. لا بوابة على هذه الخدمة اليوم، فالقيمة '{}' بالضبط
  //     — لا {"rules":[]}: صفحة الخدمة تقيس الغياب بعدد المفاتيح، فالثاني يمرّ عليها ممتلئًا فيُخفي السبب.
  assert.deepEqual(eligibilityFrom(db,users.admin,letter),[]);
  assert.equal(contentSuggestion(db,users.admin,letter).eligibility_rules,'{}');

  // (4) الأسئلة الشائعة لا تُشتق لأي خدمة، مهما كان تعريفها.
  for(const service of services.values())assert.equal(contentSuggestion(db,users.admin,service).faq,'[]','لا سؤال مولَّد');
  for(const row of db.prepare('SELECT faq FROM service_cards').all())assert.equal(row.faq,'[]');

  // والمولَّد لا يلمس ما يعرفه الإنسان وحده: المخرجات والمؤشرات وأدلة القبول والمحفز تبقى فارغة.
  for(const row of db.prepare('SELECT outputs,kpis,acceptance_evidence,trigger_note FROM service_cards').all())
    assert.deepEqual(Object.values(row),['','','','']);
});

test('الفارغ يصل الشاشة ومعه سببه ومن يكتبه، والطابور يُقسَّم على أصحابه',t=>{
  const {db,users,tx}=fixture(t);
  const gaps=serviceCard(db,users.admin,'HR-LETTER').content_gaps;
  assert.deepEqual(gaps.map(g=>g.key),['short_description','eligibility_rules','required_documents','faq']);
  for(const gap of gaps){
    assert.ok(gap.why.trim().length>20,`${gap.key}: السبب مكتوب`);
    assert.ok(gap.owner.trim().length>0,`${gap.key}: من يكتبها مسمّى`);
    assert.doesNotMatch(gap.why,/^غير متاح\.?$/,'لا «غير متاح» عارية');
  }
  assert.match(gaps.find(g=>g.key==='faq').why,/ما تعرف وش يسأل/,'سبب الأسئلة أنها لا تُعرف، لا أنها قيد الإنجاز');
  assert.match(gaps.find(g=>g.key==='eligibility_rules').why,/ما يفرض/,'سبب الأهلية أن الكود لا يفرض شيئًا');

});

test('طابور كل مالك على حدة: 142 مسودة تُقسَّم على أصحابها، وكل مالك يرى طابوره هو',t=>{
  const {db,users,tx}=wholeCatalog(t);
  tx(()=>draftMissingCards(db,users.admin));
  const board=cardsBoard(db,users.admin);
  assert.ok(board.owners.length>1,'المسودات مقسومة على أصحابها');
  assert.equal(board.owners.reduce((n,o)=>n+o.drafts,0),board.totals.draft,'مجموع الطوابير هو عدد المسودات');
  for(const owner of board.owners)assert.ok(owner.owner_name&&owner.codes.length===owner.drafts);
  // وغير حامل التصريح يرى طابوره وحده، لا طوابير الناس.
  const head=board.owners[0].owner_id,me=db.prepare('SELECT * FROM users WHERE id=?').get(head);
  assert.ok(cardsBoard(db,me).owners.every(o=>o.owner_id===head),'كل مالك يرى طابوره هو');
  // واللوح يعدّ ما بقي من أعمدة الصفحة قبل فتح أي بطاقة.
  assert.equal(board.totals.page_fields_missing,board.services.filter(s=>s.content_missing.length).length);
  // والأسئلة الشائعة ناقصة على كل بطاقة مولَّدة — فالعدّاد لا يهبط إلى صفر باشتقاق، وهذا مقصود.
  assert.equal(board.totals.page_fields_missing,board.totals.draft);
});
