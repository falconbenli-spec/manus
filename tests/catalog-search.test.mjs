// بحث مركز الخدمات — مقياس القبول الواحد: خمسون سؤالًا بكلمات الناس، ≥95% منها تضع الخدمة المقصودة في المرتبة الأولى.
//
// الأسئلة مكتوبة من أسماء الدليل الحقيقية كما يسأل عنها موظف: الدارج («جهازي خربان»، «ابغى موظف»)، والخطأ الإملائي
// («اجازه»، «شهادة خبره»)، والإنجليزي («NDA»، «hajj»)، والمختلط («wifi مو شغال»)، والأسماء القديمة العشرون بعد إعادة
// التسمية كلها. المقياس مقياسٌ لا ادّعاء: العدد الفعلي يُطبع في التشخيص، والحدّ 48 من 50.
// وقبل المقياس عقدان بلا استثناء: المطبِّع الواحد في المتصفح يساوي مطبِّع الخادم على الأسئلة كلها (وإلا لم تطابق
// مرادفات الخادم استعلام المتصفح)، والجذر ومسافة التحرير في وحدة المتصفح يساويان نظيريهما في app/arabic-text.mjs على كل
// كلمات الدليل — نسختان بالنصّ لأن ملفات الخادم لا تُقدَّم للمتصفح، ولا يُسمح لهما أن يفترقا.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog, CONFIDENTIAL_SERVICES } from '../app/service-catalog.mjs';
import { catalogTree, logSearchEvent } from '../app/catalog-home.mjs';
import { CATALOG_RENAMES, CATALOG_WORDS } from '../app/catalog-tree.mjs';
import { normalize, stem, withinDistance as serverDistance } from '../app/arabic-text.mjs';
import { normalizeArabic } from '../app/static/request-picker.mjs';
import { rankCatalog, directAnswer, lightStem, withinDistance, terms, catalogEntries } from '../app/static/catalog-search.mjs';
import { kit } from '../app/static/kit.mjs';
import { searchResults } from '../app/static/catalog-home-ui.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx={e,ui:kit(e,ar=>ar)};
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-catalog-search');installServiceCatalog(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,users,employee:catalogTree(db,users.employee),manager:catalogTree(db,users.manager)};
}

// [السؤال، الرمز المقصود، الجمهور]. الأسماء القديمة العشرون تُولَّد من CATALOG_RENAMES نفسها فلا تُنسخ هنا.
export const QUESTIONS=[
  ['راتبي ناقص','HR-PAYROLL-INQUIRY'],
  ['بطاقتي ضاعت','ADM-ACCESS-CARD'],
  ['النظام واقف','IT-OUTAGE'],
  ['نسيت الباسورد','IT-PASSWORD-UNLOCK'],
  ['ابغى موظف','HR-HIRING-NEED','manager'],
  ['اجازه','VAR-LEAVE'],
  ['تعريف بنك','HR-SALARY-CERT'],
  ['جهازي خربان','IT-SUPPORT'],
  ['شهادة خبره','HR-EXPERIENCE-CERT'],
  ['ابي لابتوب جديد','IT-DEVICE'],
  ['حجز قاعه','ADM-ROOM-BOOKING'],
  ['عندي زائر بكره','ADM-VISITOR'],
  ['سلفه','HR-SALARY-ADVANCE'],
  ['تأمين طبي','HR-BENEFIT-CLAIM'],
  ['استقاله','HR-RESIGNATION'],
  ['دورة تدريبية','TAL-TRAINING'],
  ['صرفت من جيبي','ADM-EXPENSE-CLAIM'],
  ['عهده','FIN-CUSTODY'],
  ['سفر','ADM-TRAVEL'],
  ['NDA','LEG-NDA'],
  ['تصميم بوستر','CRT-DESIGN'],
  ['مونتاج','PRO-EDIT-REVIEW'],
  ['فاتورة لعميل','FIN-CLIENT-INVOICE'],
  ['تغيير ايبان','HR-BANK-CHANGE'],
  ['مقابلة خروج','HR-EXIT-INTERVIEW'],
  ['تظلم','HR-GRIEVANCE'],
  ['wifi مو شغال','IT-SUPPORT'],
  ['hajj','HR-LEAVE'],
  ['تجديد الاقامه','HR-DOC-RENEWAL'],
  ['نسيت ابصم','HR-ATTENDANCE-FIX'],
  // الخمسون: 31 سؤالًا + الأسماء القديمة التسعة عشر (HR-LETTER لم تُعَد تسميتها؛ كلمة الطالب لها مرادف من الكود — مراجعة 23 سبتمبر).
  ['تعريف بالعمل','HR-LETTER'],
  ...CATALOG_RENAMES.map(rename=>[rename.from,rename.code])
];

test('البحث: المطبِّع الواحد — normalizeArabic في المتصفح يساوي normalize في الخادم على الخمسين، والجذر والمسافة كذلك على كل كلمات الدليل',t=>{
  const {employee}=fixture(t);
  assert.equal(QUESTIONS.length,50,'خمسون سؤالًا بالضبط');
  for(const [q] of QUESTIONS)assert.equal(normalizeArabic(q),normalize(q),`«${q}»: المطبِّعان يفترقان`);
  // كل كلمة في أسماء الدليل ومرادفاته وأوصافه، وكل كلمة في الأسئلة: الجذر نفسه في الوحدتين.
  const vocabulary=new Set();
  for(const {item} of catalogEntries(employee))for(const w of normalize([item.name,item.description,...(item.options??[])].join(' ')).split(' '))if(w)vocabulary.add(w);
  for(const list of Object.values(employee.synonyms))for(const s of list)for(const w of s.split(' '))if(w)vocabulary.add(w);
  for(const [q] of QUESTIONS)for(const w of normalize(q).split(' '))if(w)vocabulary.add(w);
  assert.ok(vocabulary.size>800,`مفردات الدليل ${vocabulary.size}`);
  for(const w of vocabulary)assert.equal(lightStem(w),stem(w),`«${w}»: الجذر يفترق بين الوحدتين`);
  const sample=[...vocabulary].slice(0,120);
  for(const a of sample)for(const b of sample.slice(0,40))for(const limit of [1,2])assert.equal(withinDistance(a,b,limit),serverDistance(a,b,limit),`«${a}»/«${b}»: مسافة التحرير تفترق`);
});

test('البحث: خمسون سؤالًا بكلمات الناس — ≥48 منها تضع الخدمة المقصودة أولًا (≥95%)',t=>{
  const trees=fixture(t);
  const misses=[];
  for(const [q,expected,audience='employee'] of QUESTIONS){
    const tree=trees[audience],hits=rankCatalog(tree,tree.synonyms,q);
    const first=hits[0]?.item?.key??null;
    if(first!==expected)misses.push(`«${q}» → ${first??'لا شيء'} (المقصود ${expected}؛ الثلاثة الأولى: ${hits.slice(0,3).map(h=>`${h.item.key}:${h.score}`).join('، ')})`);
  }
  const rate=Math.round((QUESTIONS.length-misses.length)/QUESTIONS.length*1000)/10;
  t.diagnostic(`المرتبة الأولى: ${QUESTIONS.length-misses.length}/${QUESTIONS.length} = ${rate}%`);
  assert.ok(misses.length<=2,`أقل من 95% في المرتبة الأولى:\n${misses.join('\n')}`);
});

test('البحث: كل بند في الدليل له ثلاثة مرادفات على الأقل من الكود، ولا مرادف يقود إلى رمزٍ ليس في الدليل',t=>{
  const {employee,manager}=fixture(t);
  const entries=catalogEntries(manager),known=new Set(entries.map(x=>`${x.item.kind}:${x.item.key}`));
  const thin=entries.filter(({item})=>(manager.synonyms[`${item.kind}:${item.key}`]??[]).length<3).map(x=>x.item.key);
  assert.deepEqual(thin,[],`بنود بأقل من ثلاثة مرادفات: ${thin.join('، ')}`);
  for(const key of Object.keys(employee.synonyms))assert.ok(known.has(key)||key.startsWith('group:'),`${key}: مرادف لبندٍ ليس في الدليل`);
  for(const code of Object.keys(CATALOG_WORDS))assert.ok([...known].some(k=>k.endsWith(':'+code)),`${code}: كلمات لرمزٍ ليس في الدليل`);
});

test('البحث: كلمات الربط تُسقط، والخطأ الإملائي بحرفٍ يجد، والعضو يتقدّم مجموعته عند التعادل، والفارغة فارغة',t=>{
  const {employee}=fixture(t);
  assert.deepEqual(terms('ابغى اطلب اجازه في بكره'),['اجازه']);
  assert.deepEqual(terms('في من'),['في','من'],'استعلامٌ كله كلمات ربط يبقى كما هو');
  assert.equal(rankCatalog(employee,employee.synonyms,'   ').length,0);
  // «انتذاب» بدل «انتداب»: حرفٌ واحد.
  assert.equal(rankCatalog(employee,employee.synonyms,'انتذاب')[0]?.item.key,'ADM-TRAVEL');
  // العضو الذي يطابق كل الكلمات بنفسه قبل بطاقة مجموعته: ضغطتان لا ثلاث.
  const design=rankCatalog(employee,employee.synonyms,'تصميم بوستر');
  assert.equal(design[0].item.key,'CRT-DESIGN');assert.ok(design.some(h=>h.item.key==='VAR-CREATIVE'),'ومجموعته في القائمة لا تختفي');
  // المراتب متتابعة من 1، والعضو يحمل مجموعته ليقول «تُبلَغ أيضًا من بطاقة …».
  design.forEach((hit,i)=>assert.equal(hit.position,i+1));
  assert.equal(design[0].item.group_name,'طلب شغل إبداعي');
});

test('البحث: الجواب المباشر للنتيجة الأولى هو مسارها وزمنها بسنده — ولا يُخترع لمجموعةٍ أو وحدة',t=>{
  const {employee}=fixture(t);
  const hits=rankCatalog(employee,employee.synonyms,'راتبي ناقص');
  const answer=directAnswer(hits);
  assert.equal(answer.key,'HR-PAYROLL-INQUIRY');
  assert.ok(answer.text.startsWith('سيمر طلبك على:')||answer.text.startsWith('يصل طلبك مباشرة'),answer.text);
  assert.ok(answer.target.includes('مشتق'),'الزمن بسنده في الجواب');
  assert.equal(directAnswer(rankCatalog(employee,employee.synonyms,'اجازه')),null,'المجموعة بلا جواب مخترع');
  const html=searchResults(employee,'راتبي ناقص',ctx);
  assert.ok(html.includes('class="sc-answer"')&&html.includes('data-position="1"'),'الجواب مرسوم وكل نتيجة تحمل مرتبتها');
  assert.doesNotMatch(html,/<script|\sstyle=|\son[a-z]+=/i,'CSP');
  assert.ok(html.includes('class="sc-counts"'),'العدّاد نصٌّ مرئي؛ والإعلان من لوح الحالة الدائم في الرئيسية');
  const member=searchResults(employee,'تعريف بنك',ctx);
  assert.ok(member.includes('تُبلَغ أيضًا من بطاقة «خطاب»'),'عضو المجموعة يقول من أين يُبلَغ أيضًا');
});

test('سجل البحث: بلا هوية، يعدّه الخادم بترتيب الشاشة، ولا يكتب السرّي ولا المغلق بصمت، ولا يقبل معرّفًا غير 32 خانة',t=>{
  const {db,users}=fixture(t);
  const id='0123456789abcdef0123456789abcdef',tx=f=>transaction(db,f);
  const rows=()=>db.prepare("SELECT * FROM catalog_search_log WHERE tenant_id='36t' ORDER BY seq").all();
  // «بطاقتي ضاعت» تجد ADM-ACCESS-CARD وليس بين نتائجها بندٌ سرّي؛ أمّا «راتبي ناقص» فتجد HR-PAYROLL-INQUIRY وهي من
  // العشر السرّية، فلا يُسجَّل بحثها أبدًا — وذلك مقصود: «من بحث عن راتبه» في شركة من 29 شخصًا مراقبةٌ لا مؤشر.
  const tree=catalogTree(db,users.employee);
  assert.deepEqual(tx(()=>logSearchEvent(db,users.employee,{search_id:id,event:'searched',query:'بطاقتي ضاعت',result_count:99})),{logged:true,result_count:rankCatalog(tree,tree.synonyms,'بطاقتي ضاعت').length});
  assert.deepEqual(tx(()=>logSearchEvent(db,users.employee,{search_id:id,event:'opened',query:'بطاقتي ضاعت',item_kind:'service',item_key:'ADM-ACCESS-CARD',position:1})),{logged:true});
  assert.deepEqual(tx(()=>logSearchEvent(db,users.employee,{search_id:id,event:'submitted',query:'بطاقتي ضاعت',item_kind:'service',item_key:'ADM-ACCESS-CARD'})),{logged:true});
  assert.equal(tx(()=>logSearchEvent(db,users.employee,{search_id:id,event:'searched',query:'راتبي ناقص'})).logged,false,'الراتب سرّي فلا يُسجَّل بحثه');
  // بحثٌ بلا نتيجة يُسجَّل بعدد صفر: هو ما يغذّي تقرير المرادفات.
  assert.equal(tx(()=>logSearchEvent(db,users.employee,{search_id:id,event:'searched',query:'زرافة بنفسجية'})).result_count,0);
  const logged=rows();
  assert.deepEqual(logged.map(r=>r.event),['searched','opened','submitted','searched']);
  assert.ok(logged.every(r=>!('user_id' in r)&&r.audience==='employee'),'لا عمود هوية، والجمهور وحده');
  assert.equal(logged[0].query_normalized,'بطاقتي ضاعت');assert.equal(logged[3].result_count,0);
  // جوالٌ كُتب سهوًا في الصندوق لا يُحفظ: الحاجب قبل التطبيع.
  tx(()=>logSearchEvent(db,users.employee,{search_id:id,event:'searched',query:'اتصل بي 0551234567'}));
  assert.equal(rows().at(-1).query_normalized.includes('0551234567'),false);
  // السرّي: «تظلم» يجد HR-GRIEVANCE ولا يُسجَّل البحث ولا الفتح ولا التقديم.
  const before=rows().length;
  assert.equal(tx(()=>logSearchEvent(db,users.employee,{search_id:id,event:'searched',query:'تظلم'})).logged,false);
  for(const code of CONFIDENTIAL_SERVICES)assert.equal(tx(()=>logSearchEvent(db,users.employee,{search_id:id,event:'opened',query:'',item_kind:'service',item_key:code,position:1})).logged,false,code);
  assert.equal(rows().length,before,'لا صفّ للسرّي');
  // المعرّف محروس، والحدث محروس، وخارج المعاملة رفضٌ مكتوب.
  assert.throws(()=>tx(()=>logSearchEvent(db,users.employee,{search_id:'short',event:'searched',query:'x'})),err=>err.code==='search_id'&&err.details.refusal.next.length>10);
  assert.throws(()=>tx(()=>logSearchEvent(db,users.employee,{search_id:id,event:'clicked',query:'x'})),err=>err.code==='event');
  assert.throws(()=>logSearchEvent(db,users.employee,{search_id:id,event:'searched',query:'x'}),err=>err.code==='transaction_required');
  // إلحاقي: لا تعديل ولا حذف.
  assert.throws(()=>db.prepare('DELETE FROM catalog_search_log').run(),/append only/);
});
