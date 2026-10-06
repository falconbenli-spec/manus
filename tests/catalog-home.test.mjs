// مركز الخدمات — الشاشات: ما لا يجوز أن تقوله شاشة، وما يجب أن تقوله — 22 سبتمبر 2026.
//
// هذا الملف يختبر **HTML المرسومة نفسها** لا الحمولة وحدها، لأن العطب الذي بُنيت هذه الدفعة لمنعه عطبُ
// رسمٍ لا عطبُ استعلام: مسح 20 سبتمبر (S-04) وجد «142 خدمة» في الترويسة فوق «كل الخدمات 127» في الشاشة
// نفسها. فالعدّ هنا يُستخرج من النصّ المرسوم ويُقارن بالترويسة المرسومة، لكل جمهور.
//
// و**هذا الملف هو الشبكة الوحيدة تحت هذه الشاشات**: tests/ui-golden.test.mjs يغطي شاشات operationModules
// وحدها (540 زوجًا)، وشاشات الدليل ليست منها — يرسمها موجّه app.mjs خارج تلك القائمة. أي لا بصمة ذهبية
// تتحرك في هذه الدفعة، وليست تلك طمأنينة بل سببٌ لأن يكون هذا الاختبار أوسع لا أضيق.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { catalogTree, servicePage, setLens, readLens, UNAVAILABLE, FEEDBACK_SERVICE } from '../app/catalog-home.mjs';
import { createService } from '../app/workflow.mjs';
import { setAvailability } from '../app/service-availability.mjs';
import { DERIVED_MARK } from '../app/service-target.mjs';
import { kit } from '../app/static/kit.mjs';
import { catalogHome, categoryView, searchResults, categoryGrid, serviceCard, catalogSkeleton, sortCards, searchCards, visibleCountsLine } from '../app/static/catalog-home-ui.mjs';
import { servicePageView, servicePageSkeleton } from '../app/static/service-page.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=kit(e,ar=>ar);
const ctx={e,ui};
// الأرقام المرجعية نفسها التي يثبتها tests/catalog-tree.test.mjs، مقيسةً لا مكتوبة.
// مراجعة 23 سبتمبر: IT-NEW-ACCOUNT عادت إلى إسناد الموظف، فالجمهوران يريان الشجرة نفسها (8 · 63 · 143).
// ت1 (د3/د4): الأربعون المنقول موضعها إلى صفحات إداراتها تُرفع من الباب الأمامي — ستّ مجموعات نُقل كل أعضائها (63−6=57 بطاقة)
// و40 بندًا (143−40=103). الإسقاط نفسه (placementFor) ما زال 63 · 143 ويثبته tests/catalog-tree.test.mjs.
const EMPLOYEE={categories:8,cards:57,items:103},MANAGER={categories:8,cards:57,items:103},MOVED=40;

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-catalog-home');installServiceCatalog(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,users};
}
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
// عدد البطاقات المرسومة فعلًا في الشبكة، من الترميز لا من الحمولة.
const drawnCards=html=>(html.match(/class="sc-card/g)??[]).length;

/* ───── العدّ: الترويسة هي ما ترسمه الشبكة ───────────────────────────────────── */

test('الشاشة: العدّاد العام بسيط ويشمل الخدمات المرئية في المركز وصفحات الإدارات، لكل جمهور', t=>{
  const {db,users}=fixture(t);
  for(const [label,who,expected] of [['الموظف','employee',EMPLOYEE],['المدير','manager',MANAGER]]){
    const tree=catalogTree(db,users[who]);
    const home=text(catalogHome(tree,ctx));
    const visible=expected.items+MOVED;
    assert.equal(visibleCountsLine(tree),`${visible} خدمة متاحة لك`,`${label}: العدّاد يصف ما يستطيع الموظف فتحه`);
    assert.ok(home.includes(`${visible} خدمة متاحة لك`),`${label}: العدّاد العام ظاهر — ${home.slice(0,400)}`);
    assert.equal(home.includes(`${expected.cards} بطاقة`),false,`${label}: لا عدّ تقني للبطاقات في الترويسة`);
    assert.equal(tree.totals.categories,expected.categories);
    // ومجموع ما ترسمه صفحات الفئات الثماني هو الرقمان نفسهما بالضبط.
    let cards=0,items=0;
    for(const category of tree.categories){
      const page=categoryView(tree,category.key,'tree',ctx);
      assert.equal(drawnCards(page),category.cards_count,`${label}/${category.key}: بطاقات مرسومة تخالف العدّاد`);
      cards+=drawnCards(page);items+=category.drawn_items;
    }
    assert.equal(cards,expected.cards,`${label}: «${expected.cards} في الترويسة وغيرها في الشبكة» مستحيلة`);
    assert.equal(items,expected.items,`${label}: مجموع بنود البطاقات المرسومة`);
    // وشبكة الفئات تطبع عدّاد كل فئة، ومجموعها هو ما في الترويسة.
    const grid=text(categoryGrid(tree,ctx));
    for(const category of tree.categories)assert.ok(grid.includes(category.name),`${label}: ${category.key} غائبة عن الشبكة`);
  }
});

test('الشاشة: الموقوفة تغيب عن الشبكة والبحث ولا تُعرض تفاصيل الإعدادات للموظف', t=>{
  const {db,users}=fixture(t);
  transaction(db,()=>setAvailability(db,users.admin,{kind:'service',target_key:'HR-OVERTIME',state:'hidden',reason:'تجريبي: قرار مصطنع لاختبار غياب الموقوفة عن الشاشة'}));
  const tree=catalogTree(db,users.employee),home=text(catalogHome(tree,ctx));
  assert.equal(tree.totals.cards,EMPLOYEE.cards-1);
  assert.equal(tree.totals.items,EMPLOYEE.items-1);
  assert.equal(tree.hidden_services,1);
  assert.equal(visibleCountsLine(tree),`${EMPLOYEE.items-1+MOVED} خدمة متاحة لك`,'العدّاد ينزل مع الخدمات المرئية');
  assert.ok(home.includes(visibleCountsLine(tree)));
  assert.equal(home.includes('موقوفة من الإعدادات'),false,'تفاصيل تهيئة الدليل لا تظهر للموظف');
  // وغيابها كامل: لا بطاقة في الفئة، ولا سطر في البحث.
  const time=categoryView(tree,'my_time','tree',ctx);
  assert.equal(time.includes('data-card="HR-OVERTIME"'),false,'الموقوفة لا بطاقة لها');
  assert.deepEqual(searchCards(tree,'اضافي').map(hit=>hit.item.key),[],'ولا تُبلَغ من البحث');
  assert.ok(verifyAudit(db),'وسلسلة التدقيق سليمة');
});

/* ───── الصدق: الزمن بسنده، ولا نسبة التزام ─────────────────────────────────── */

test('الشاشة: كل بطاقة خدمة تحمل زمنها **وسنده**، ولا «٪» التزام في أي مخرج', t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.employee);
  let withTarget=0;
  for(const category of tree.categories)for(const item of category.cards){
    if(item.kind!=='service')continue;
    const html=serviceCard(item,ctx);
    assert.ok(item.target,`${item.key}: بطاقة خدمة بلا سند زمن`);
    if(item.target.kind==='unset')continue;
    withTarget++;
    // الشارة الضيقة تسمي الرقم «إرشاديًا» بلغة الموظف، والعبارة الكاملة في aria-label تحفظ مصدره وحال اعتماده.
    assert.ok(html.includes(`${item.target.amount} · إرشادي`),`${item.key}: شارة زمن غير معتمد بلا تسمية مفهومة`);
    assert.ok(html.includes(e(item.target.label)),`${item.key}: aria-label بلا العبارة الكاملة`);
  }
  // سبعٌ وثلاثون بطاقة خدمة مفردة، والباقي أعضاء مجموعاتٍ لا بطاقة لهم في الشبكة (ترحيل 131: browse=0).
  assert.equal(withTarget,37,`قُرئ سند ${withTarget} بطاقة خدمة`);
  // **على 142 خدمة اليوم يقرأ الجميع «مشتق»**: صفر زمن متبنّى، والمقطع عقدٌ مع القارئ.
  const page=servicePage(db,users.employee,'HR-ATTENDANCE-FIX');
  assert.equal(page.target.kind,'derived');
  assert.ok(page.target.label.includes(DERIVED_MARK));
  const drawn=[catalogHome(tree,ctx),categoryView(tree,'my_time','tree',ctx),servicePageView(page,ctx)];
  for(const html of drawn){
    assert.equal(/\d\s*٪/.test(html),false,'نسبة التزام مرسومة');
    assert.equal(html.includes('الالتزام الفعلي: 100'),false);
  }
  // ومكان النسبة نصٌّ مكتوب لا فراغ ولا صفر.
  const view=text(servicePageView(page,ctx));
  assert.ok(view.includes('الالتزام الفعلي: لا يُعرض'),'الغياب يُكتب');
  assert.ok(view.includes(UNAVAILABLE.compliance.needs.slice(0,30)),'ومعه ما يلزم قبل أول عرض');
});

test('الشاشة: بطاقة المجموعة تطبع عدد بنودها ولا تطبع زمنًا، ومجموع بنود البطاقات = بنود الفئة', t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.employee);
  const groups=tree.categories.flatMap(c=>c.cards).filter(item=>item.kind==='group');
  // ت1: عشرون في الباب الأمامي، والستّ التي نُقل كل أعضائها (الإنتاج، الرقمي، المؤثرون، الحسابات، الفرص، البحث) في صفحات إداراتها.
  assert.equal(groups.length,20,'عشرون بطاقة مجموعة في الباب الأمامي');
  for(const group of groups){
    assert.equal(group.target,null,`${group.key}: شارة زمن فوق خيارات تختلف أزمنتها`);
    const html=serviceCard(group,ctx);
    assert.equal(html.includes('rq-chip is-time'),false,`${group.key}: شارة زمن مرسومة`);
    assert.ok(group.items>=1&&group.options.length===group.items,`${group.key}: عدد الخيارات لا يطابق عدد بنودها`);
  }
  for(const category of tree.categories)
    assert.equal(category.cards.reduce((n,item)=>n+item.items,0),category.items,`${category.key}: مجموع بنود البطاقات يخالف عدّاد الفئة`);
});

/* ───── العدسة والفرز والبحث ─────────────────────────────────────────────────── */

test('العدسة: تُحفظ للحساب وتعود به، وعدسة الرحلة حيّة وتعرض التفاصيل في موضعها', t=>{
  const {db,users}=fixture(t);
  assert.equal(readLens(db,'36t','employee'),null,'لا تفضيل قبل أول اختيار');
  // ت1: الزيارة الأولى تفتح «حسب الإدارة»، ومن اختار عدسةً تعود له.
  assert.equal(catalogTree(db,users.employee).lens,'department','والافتراض «حسب الإدارة»');
  transaction(db,()=>setLens(db,users.employee,{lens:'need'}));
  assert.equal(readLens(db,'36t','employee').last_lens,'need');
  assert.equal(catalogTree(db,users.employee).lens,'need','العدسة تعود مع الحمولة');
  // ولا تتسرّب إلى حساب آخر.
  assert.equal(catalogTree(db,users.manager).lens,'department');
  transaction(db,()=>setLens(db,users.employee,{lens:'department'}));
  assert.equal(catalogTree(db,users.employee).lens,'department');
  transaction(db,()=>setLens(db,users.employee,{lens:'need'}));
  assert.equal(catalogTree(db,users.employee).lens,'need','والرجوع عنها قرار ثانٍ يُكتب فوق الأول');
  assert.throws(()=>transaction(db,()=>setLens(db,users.employee,{lens:'journeys'})),/عدسة/,'قيمة خارج الثلاث تُرفض رفضًا مكتوبًا');

  const html=catalogHome(catalogTree(db,users.employee),ctx);
  assert.ok(html.includes('data-action="catalog-lens" data-lens="need"'));
  assert.ok(html.includes('data-action="catalog-lens" data-lens="department"'));
  // «حسب الرحلة» حيّة؛ تفاصيل الرحلات اللاحقة تظهر بعد اختيار العدسة لا في الصفحة الرئيسية.
  assert.ok(html.includes('data-action="catalog-lens" data-lens="journey"'),'زرّ العدسة الثالثة');
  assert.equal(html.includes('حسب الرحلة — غير متاحة'),false);
  assert.equal(text(html).includes(UNAVAILABLE.journey.why.slice(0,30)),false,'لا تشخيص داخلي في الصفحة الرئيسية');
  transaction(db,()=>setLens(db,users.employee,{lens:'journey'}));
  const journeyTree=catalogTree(db,users.employee);
  assert.equal(journeyTree.lens,'journey');
  assert.equal(journeyTree.journeys.definitions.length,1,'رحلة واحدة مبنيّة');
  assert.equal(journeyTree.journeys.later.length,7,'وسبعٌ معرّفة لاحقًا بمادّتها');
  assert.equal(catalogTree(db,users.manager).journeys,null,'ولا تُحمَّل حمولة الرحلات لغير عدستها');
});

test('صفحة الفئة: الفرز يعيد الترتيب ولا يغيّر العدّ، وترتيبٌ مجهول يعود إلى ترتيب الشجرة', t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.employee),category=tree.categories.find(c=>c.key==='my_workplace');
  const counts=new Set();
  for(const sort of ['tree','name','time','bogus']){
    const page=categoryView(tree,category.key,sort,ctx);
    counts.add(drawnCards(page));
    assert.ok(text(page).includes(category.name));
  }
  assert.equal(counts.size,1,'الفرز لا يضيف بطاقة ولا يسقط واحدة');
  assert.equal([...counts][0],category.cards_count);
  // المجموعة بلا زمن تبقى في آخر الترتيب الزمني: لا يُخترع لها رقم ليُفرز به.
  const byTime=sortCards(category.cards,'time');
  const firstGroup=byTime.findIndex(item=>item.kind==='group');
  if(firstGroup>=0)assert.ok(byTime.slice(firstGroup).every(item=>!item.target||item.target.kind==='unset'),'مجموعة سبقت خدمةً لها زمن');
  assert.deepEqual(sortCards(category.cards,'name').map(item=>item.name),[...category.cards.map(item=>item.name)].sort((a,b)=>a.localeCompare(b,'ar')));
  // فئة لا يعرفها دليل هذا الحساب تقول ذلك وتعطي طريق عودة، ولا تكون نهاية مسدودة.
  const missing=text(categoryView(tree,'no_such_category','tree',ctx));
  assert.ok(missing.includes('لا فئة بهذا المفتاح'));
  assert.ok(missing.includes('العودة إلى الخدمات'));
});

test('البحث في الشاشة: يجد البطاقة باسمها وبرمزها وباسم خيار داخل مجموعتها، والفارغة تقول ماذا يفعل', t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.employee);
  assert.ok(searchCards(tree,'تعريف').some(hit=>hit.item.key==='VAR-LETTER'),'اسم خيار يجد بطاقة مجموعته');
  assert.ok(searchCards(tree,'HR-ATTENDANCE-FIX').some(hit=>hit.item.key==='HR-ATTENDANCE-FIX'),'والرمز يجد خدمته');
  const empty=text(searchResults(tree,'زززز',ctx));
  assert.ok(empty.includes('لم نجد ما تبحث عنه'));
  assert.ok(empty.includes('جرّب كلمة أقصر'));
  const hits=searchResults(tree,'تعريف',ctx);
  // العدّاد نصٌّ مرئي في رأس النتائج؛ والإعلان لقارئ الشاشة من لوح الحالة **الدائم** في الرئيسية (#catalog-counts) الذي يكتب فيه
  // app.mjs نصّ catalogResults.announce — لوحٌ يُنشأ مع نصّه في كل ضغطة لا يُنطق (مراجعة 23 سبتمبر).
  assert.ok(/<p class="sc-counts">\d+ خدمات مطابقة<\/p>/.test(hits)||/<p class="sc-counts">[^<]*مطابقة<\/p>/.test(hits),'عدّاد النتائج مرئي');
  assert.equal(hits.includes('aria-live'),false,'ولا لوح حالة يُنشأ مع نصّه');
  assert.ok(hits.includes('<h2>نتائج «تعريف»</h2>'),'رأس النتائج h2 تحت h1 الصفحة مباشرة');
  const home=catalogHome(tree,ctx);
  assert.ok(home.includes('role="status" aria-live="polite" id="catalog-counts"'),'لوح الحالة الدائم في الرئيسية');
});

/* ───── صفحة الخدمة: تسعة أقسام، ورفضٌ مكتوب ─────────────────────────────────── */

test('صفحة الخدمة: تسعة أقسام، كلٌّ من بياناته أو مكتوبٌ غيابُه وما يلزمه وعند من', t=>{
  const {db,users}=fixture(t);
  const page=servicePage(db,users.employee,'HR-ATTENDANCE-FIX'),html=servicePageView(page,ctx),body=text(html);
  assert.deepEqual(page.breadcrumb.map(step=>step.label),['الخدمات','وقتي وحضوري','تصحيح حضور أو استئذان']);
  for(const heading of ['ما الذي ستحتاجه؟','كيف يتحرك طلبك؟','هل يكون المعتمِد هو المنفّذ؟','كم تستغرق؟','خدمات قريبة'])
    assert.ok(body.includes(heading),`قسم «${heading}» غير مرسوم`);
  assert.ok(page.inputs.length>=4&&body.includes(page.inputs[0].label),'حقول التعريف مرسومة بتسمياتها');
  // «هل يكون المعتمِد هو المنفّذ؟» بنصّها القائم: شفافيةٌ اشتُريت بثمن ولا تُحذف ولا تُختصر.
  assert.ok(body.includes('فصل المهام'),'جملة فصل المهام');
  assert.equal(page.workflow.same_person_note.length>100,true);
  // **الأقسام التي لا محتوى لها لا تُرسم عنوانًا فوق فراغ**، وغيابها مكتوب في كتلة واحدة بسببه وما يلزمه.
  // يُفحص الترميز لا النصّ المجرَّد: العنوان <h2> هو ما يبحث عنه قارئ الشاشة بالتنقّل بالعناوين.
  for(const heading of ['هل تنطبق عليك','المستندات المطلوبة','الأسئلة المتكررة','السياسة المرجعية'])
    assert.equal(html.includes(`<h2>${heading}`),false,`عنوان «${heading}» فوق فراغ`);
  // والأقسام الطويلة الحاضرة <details class="vn-card sc-fold"> مفتوحةً، ورأسها <h2> داخل <summary> فيبقى التنقّل
  // بالعناوين، ورمزها زخرفة بـaria-hidden. «سياقك أنت» وحده يبقى قسمًا مفتوحًا لا يُطوى.
  const folds=(html.match(/<details class="vn-card sc-fold" open/g)??[]).length;
  assert.equal(folds,5,`خمسة أقسام قابلة للطيّ (حقول، مسار، فصل، زمن، قريب): ${folds}`);
  for(const heading of ['ما الذي ستحتاجه؟','كيف يتحرك طلبك؟','هل يكون المعتمِد هو المنفّذ؟','كم تستغرق؟','خدمات قريبة'])
    assert.ok(html.includes(`<span class="vn-name"><h2>${heading}</h2>`),`«${heading}» عنوانٌ داخل الملخّص`);
  assert.ok(html.includes('<section class="panel"><div class="panel-head"><h2>سياقك أنت</h2>'),'سياقك أنت لا يُطوى');
  // أزيلت رموز الأقسام المتكررة لأنها زخرفة لا تضيف معنى. تبقى كتلة الغياب وحدها بعلامتها المحجوبة عن قارئ الشاشة.
  assert.equal((html.match(/<span class="vn-code" aria-hidden="true">/g)??[]).length,1,'كتلة الغياب وحدها تحتفظ بالرمز الزخرفي');
  // الدفعة الثالثة أضافت غيابين مكتوبين على الصفحة: الحفظ التلقائي والتعبئة من طلب سابق (لم يُبنَ أيٌّ منهما، وسببه مكتوب).
  assert.deepEqual(page.gaps.map(gap=>gap.key).sort(),['autosave','compliance','documents','eligibility','faq','policy','prefill','urgency']);
  // ت1: مادّة البطاقة التي يكتبها مالكها (المستندات، الأهلية، الأسئلة، السياسة) تقول «لم يُكتب بعد. يكمله: <الإدارة المالكة>» — إدارةٌ
  // لا اسم شخص — مكان «غير متاح»؛ والباقي بوسمه القائم ومن يملكه.
  for(const gap of page.gaps){
    if(['documents','eligibility','faq','policy'].includes(gap.key)){
      assert.equal(gap.pending,`لم يُكتب بعد. يكمله: ${page.owner.name}`);
      assert.ok(body.includes(`${gap.label} — لم يُكتب بعد. يكمله: ${page.owner.name}`),`«${gap.label}» بلا مَن يكمله`);
      assert.equal(body.includes(`${gap.label} — غير متاح`),false,`«${gap.label}» ما زالت «غير متاح»`);
      assert.ok(body.includes(`عند: ${gap.owner}`.slice(0,15)),`«${gap.label}» فقد «عند:»`);
    }else{
      assert.ok(body.includes(`${gap.label} — غير متاح`),`«${gap.label}» بلا وسم`);
      assert.ok(body.includes(gap.owner.slice(0,10)),`«${gap.label}» بلا من يملكه`);
    }
    assert.ok(body.includes(gap.needs.slice(0,25)),`«${gap.label}» بلا ما يلزمه`);
  }
  assert.equal(page.owner.name,db.prepare("SELECT name FROM departments WHERE tenant_id='36t' AND id='hr'").get().name,'المالك إدارةٌ لا شخص');
  // خدمة ADM-: مالك عرضها وحدة عرض بلا صفّ في departments، فيكملها منفّذها المؤقت لا الوحدة.
  const adm=servicePage(db,users.employee,'ADM-MAINTENANCE');
  assert.equal(adm.owner.id,'admin-affairs');
  for(const gap of adm.gaps.filter(g=>['documents','eligibility','faq','policy'].includes(g.key)))assert.equal(gap.pending,'لم يُكتب بعد. يكمله: مكتب الرئيس التنفيذي (منفّذ مؤقت)');
  // صفر بطاقة تعريف منشورة اليوم: يُقال للطالب بصيغته لا بصيغة معدّ الدليل.
  assert.equal(page.documented,false);
  assert.ok(body.includes('لم يعتمدها مالكها بعد'));
});

test('صفحة الخدمة: تردّ **رفضًا مكتوبًا** على رمزٍ ليس في دليل هذا الحساب، ويُرسم بـui.refusal', t=>{
  const {db,users}=fixture(t);
  // صفّ فرقٍ اصطناعي: IT-NEW-ACCOUNT إلى جمهور المدير وحده بالجملة مباشرة (لا قرار في الكود لم يتخذه المالك — مراجعة 23 سبتمبر).
  // الموظف لا يجدها تصفّحًا ولا بحثًا، وفتح رابطها يردّ رفضًا يسمّي.
  db.prepare("UPDATE catalog_placement SET audience='manager' WHERE tenant_id='36t' AND item_key='IT-NEW-ACCOUNT'").run();
  assert.ok(servicePage(db,users.manager,'IT-NEW-ACCOUNT').name,'والمدير يفتحها');
  const problem=(()=>{try{servicePage(db,users.employee,'IT-NEW-ACCOUNT');return null;}catch(error){return error;}})();
  assert.ok(problem,'فُتحت لمن لا يراها');
  assert.equal(problem.status,404);
  assert.equal(problem.code,'not_available');
  const refusal=problem.details.refusal;
  assert.ok(refusal.what.includes('IT-NEW-ACCOUNT'),'يسمّي ما رُفض');
  assert.ok(refusal.missing[0].owner.length>2,'ومن يملكه بالاسم');
  assert.ok(refusal.next.includes('مركز الخدمات'),'والخطوة التالية');
  const drawn=text(ui.refusal(problem));
  assert.ok(drawn.includes(refusal.what)&&drawn.includes(refusal.next));
  // ورمزٌ لا وجود له يردّ الرفض نفسه لا عطل خادم.
  assert.throws(()=>servicePage(db,users.employee,'NO-SUCH-CODE'),/دليلك/);
  // وخدمةٌ أوقفها المالك يقرأ من بلغ رابطها **سبب الإيقاف بنصّه** ومن يعيد تفعيلها — لا «غير متاحة».
  transaction(db,()=>setAvailability(db,users.admin,{kind:'service',target_key:'HR-OVERTIME',state:'hidden',reason:'تجريبي: قرار مصطنع لاختبار رفض الموقوفة'}));
  const stopped=(()=>{try{servicePage(db,users.employee,'HR-OVERTIME');return null;}catch(error){return error;}})();
  assert.equal(stopped.code,'service_hidden');
  assert.ok(stopped.details.refusal.missing[0].why.includes('تجريبي: قرار مصطنع'),'سبب الإيقاف المكتوب يصل الطالب');
});

/* ───── الوصول وسلامة الرسم ─────────────────────────────────────────────────── */

test('الرسم: لا نمط سطري ولا سكربت سطري في أي مخرج (CSP)، والهيكل يقول لقارئ الشاشة إنه يحمّل', t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.manager),page=servicePage(db,users.manager,'IT-NEW-ACCOUNT');
  const outputs=[catalogHome(tree,ctx),categoryGrid(tree,ctx),categoryView(tree,'my_pay','name',ctx),
    searchResults(tree,'تعريف',ctx),servicePageView(page,ctx),catalogSkeleton(),servicePageSkeleton()];
  for(const html of outputs){
    assert.equal(/\sstyle=/.test(html),false,'نمط سطري في الترميز');
    assert.equal(/<script/i.test(html),false,'سكربت سطري في الترميز');
    assert.equal(/\son[a-z]+=/.test(html),false,'معالج حدث سطري');
  }
  for(const skeleton of [catalogSkeleton(),servicePageSkeleton()]){
    assert.ok(skeleton.includes('aria-busy="true"')&&skeleton.includes('role="status"'));
    assert.ok(skeleton.includes('sr-only'),'وجملة واحدة تقول ماذا يُحمَّل');
  }
});

test('الوصول: البطاقة هدفان متتاليان، وغير المؤهلة تبقى مرسومة قابلة للقراءة بسببها لا مخفيّة', t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.employee);
  const leave=tree.categories.flatMap(c=>c.cards).find(item=>item.key==='VAR-LEAVE');
  assert.ok(leave,'بطاقة الإجازة مرسومة');
  const service=tree.categories.flatMap(c=>c.cards).find(item=>item.kind==='service'&&!item.link);
  const html=serviceCard(service,ctx);
  // هدفان في ترتيب Tab: الجسم ← صفحة الخدمة، و«ابدأ الطلب» ← النموذج. هذا ما يحفظ «الضغطتين».
  assert.ok(html.includes(`href="#services/${service.key}"`),'الجسم يفتح صفحة الخدمة');
  assert.ok(html.includes('data-action="pick-service"'),'و«ابدأ الطلب» يفتح النموذج مباشرة');
  assert.ok(html.includes('aria-label='),'ووصفٌ واحد كامل لقارئ الشاشة');
  // وخدمةٌ لها شاشة تشغيل جاهزة تقول ذلك في زرّها بدل أن تفتح نموذجًا موازيًا بمسار اعتماد ثانٍ.
  const routed=tree.categories.flatMap(c=>c.cards).find(item=>item.kind==='service'&&item.link);
  if(routed)assert.ok(serviceCard(routed,ctx).includes(`href="${e(routed.link)}"`),'زرّ البدء يقود إلى شاشة التنفيذ');

  // **الحالة الوحيدة المحسوبة اليوم لـ«يراها ولا يستطيع طلبها»**: بندٌ شاشتُه وحدة مخصصة وحسابُ القارئ
  // بلا تصريحها. وحقيقة مقيسة تُقال ولا تُخفى: **على القاعدة المبذورة لا تقع هذه الحالة** — كل الخمسة
  // والعشرين حسابًا تملك «leave.use»، فلا بطاقة تُرسم باهتة اليوم. فيُختبر **عقد الرسم** مباشرةً بدل
  // اختلاق حسابٍ منزوع التصريح: بطاقة غير مؤهلة تبقى مرسومة ومقروءة، ولا تُخفى ولا يُحمَّل معناها على لون.
  // ورقمان مقيسان يُقالان بدل أن يُفترضا: صفر بطاقة غير مؤهلة اليوم على كل الجماهير، لأن البند الوحيد
  // الذي يحمل تصريحًا (HR-LEAVE) يسكن مجموعة «إجازة» بـbrowse=0 فلا بطاقة له أصلًا، ولأن الخمسة
  // والعشرين حسابًا في البذرة كلها تملك «leave.use».
  for(const who of ['employee','manager'])
    assert.deepEqual(catalogTree(db,users[who]).categories.flatMap(c=>c.cards).filter(item=>item.eligible===false),[],`${who}: بطاقة غير مؤهلة على القاعدة المبذورة`);
  const blocked={...leave,eligible:false,eligibility_reason:'تُقدَّم من شاشتها المخصصة، وحسابك لا يملك تصريح «طلب إجازة». يمنحه مسؤول المنصة.'};
  const drawn=serviceCard(blocked,ctx);
  assert.ok(drawn.includes('is-blocked')&&drawn.includes('aria-disabled="true"'),'غير المؤهلة موسومة');
  assert.ok(drawn.includes(`aria-describedby="why-${blocked.key}"`),'وسببها مربوط بها لقارئ الشاشة');
  assert.ok(text(drawn).includes(blocked.eligibility_reason),'والسبب مكتوب في البطاقة نفسها');
  // «hidden» تُطابَق سمةً أو صنفًا لا مقطعًا داخل aria-hidden: الرمز الزخرفي على الأيقونة يحمل aria-hidden عمدًا (٢-٥).
  assert.equal(/opacity|display:\s*none|\shidden[\s>=]/.test(drawn),false,'ولا تُخفى ولا يُحمَّل المعنى على الشفافية');
  assert.equal(drawn.includes('data-action="pick-variant"'),false,'ولا زرّ حيّ يُنقر فيُردّ');
  // وعلى كل حال تبقى مرسومة في شبكة فئتها: الظهور غير الأهلية.
  assert.ok(categoryView(tree,'my_time','tree',ctx).includes(`data-card="${leave.key}"`));
});

test('الشاشة: طلباتك المفتوحة من بيانات القاعدة، وبيانات الإسقاط تبقى خلف الواجهة', t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.employee);
  // بيانات الإسقاط لازمة للتحقق الداخلي، ولا تُعرض لموظف يطلب خدمة.
  assert.equal(tree.projection.release_version,0);
  assert.equal(tree.projection.items_unplaced,0);
  const home=text(catalogHome(tree,ctx));
  assert.equal(home.includes('ترتيب النسخة'),false);
  assert.equal(home.includes('ولا بند فيها بلا فئة'),false);
  // القاعدة المبذورة بلا طلبات: اللوحة لا تُرسم فارغة ولا تُملأ ببطاقات مخترعة.
  assert.deepEqual(tree.open_requests,[]);
  assert.equal(home.includes('طلباتك المفتوحة'),false,'لا عنوان فوق فراغ');
  // وجمهور المدير يرى عدسة «فريقي» مسرودة وموسومة بأنها عُدّت في فئاتها، فلا ترفع عدّادًا.
  const manager=catalogTree(db,users.manager);
  assert.equal(manager.my_team.items.length,5);
  assert.ok(text(catalogHome(manager,ctx)).includes('بطاقات عُدّت في فئاتها'));
  assert.equal(manager.totals.cards,MANAGER.cards,'والعدسة لا تضيف بطاقة إلى العدّاد');
});

/* ───── قائمة الإنهاء (الدفعة الثانية): روابط الأعضاء، والقريب من مجموعته، والمخرج باسم صفّه ───── */

test('بطاقة المجموعة: كل عضو رابطٌ إلى صفحته من الفئة مباشرة، وعضو الوحدة المخصصة رابطُ شاشته', t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.employee);
  const projects=categoryView(tree,'my_projects','tree',ctx);
  // داخل بطاقة VAR-CREATIVE نفسها لا في أي موضع آخر من الصفحة.
  const start=projects.indexOf('data-card="VAR-CREATIVE"'),end=projects.indexOf('</article>',start);
  assert.ok(start>=0,'بطاقة VAR-CREATIVE مرسومة');
  const card=projects.slice(start,end);
  assert.ok(card.includes('href="#services/CRT-DESIGN"'),'اسم الخيار رابطٌ إلى صفحة خدمته');
  assert.ok(card.includes('href="#services/CRT-CONTENT"'));
  // خمسة أعضاء (طلب الأصل من المكتبة انتقل إلى مجموعة الهوية: إدارته brand — مراجعة 23 سبتمبر)، وكلُّهم روابط بلا سقف.
  const creative=tree.categories.find(c=>c.key==='my_projects').cards.find(item=>item.key==='VAR-CREATIVE');
  assert.equal(creative.members.length,5);
  assert.ok(creative.members.every(m=>m.kind==='service'&&m.href===`#services/${m.key}`),'كل عضو خدمة يحمل رابط صفحته');
  for(const m of creative.members)assert.ok(card.includes(`href="${m.href}"`),`${m.key}: رابطه في البطاقة`);
  assert.equal(text(card).includes('أخرى'),false,'لا «وN أخرى» نصًّا: كل عضو رابط');
  // والمجموعة التي أعضاؤها ثمانية (الخدمات الإدارية) تُرسم روابطهم الثمانية كلهم من الفئة.
  const workplace=categoryView(tree,'my_workplace','tree',ctx);
  const adminStart=workplace.indexOf('data-card="VAR-ADMIN"'),adminCard=workplace.slice(adminStart,workplace.indexOf('</article>',adminStart));
  for(const code of ['ADM-VEHICLE','ADM-COURIER','ADM-WORKSPACE'])assert.ok(adminCard.includes(`href="#services/${code}"`),`${code}: العضو الثامن وما قبله روابط`);
  // وHR-LEAVE داخل «إجازة» بندُ وحدةٍ مخصصة: رابطه شاشتها لأن الحساب يملك leave.use، لا صفحة خدمة لا وجود لها.
  const leave=tree.categories.find(c=>c.key==='my_time').cards.find(item=>item.key==='VAR-LEAVE');
  assert.deepEqual(leave.members.map(m=>[m.kind,m.key,m.href]),[['module','HR-LEAVE','#leave/request']]);
  assert.ok(categoryView(tree,'my_time','tree',ctx).includes('href="#leave/request"'));
  // الروابط في جسم المجموعة لا تُقصّ: صنفها sc-members لا sc-desc ذات السطرين.
  assert.ok(card.includes('class="sc-members"')&&!card.includes('class="sc-desc"'));
});

test('صفحة الخدمة: «خدمات قريبة» تسرد أخوة المجموعة أولًا ثم بطاقات الفئة، ستةً على الأكثر، بلا مجموعتها', t=>{
  const {db,users}=fixture(t);
  const page=servicePage(db,users.employee,'CRT-DESIGN');
  assert.equal(page.group.key,'VAR-CREATIVE');
  const keys=page.nearby.map(item=>item.key);
  // أخوة المجموعة كلهم بلا سقف، وبطاقات الفئة ستةً على الأكثر (مراجعة 23 سبتمبر: السقف كان يُسقط الأخ الثامن في VAR-ADMIN).
  const groupSiblings=page.nearby.filter(item=>item.from==='group').length;
  assert.ok(page.nearby.filter(item=>item.from==='category').length<=6,'بطاقات الفئة ستةً على الأكثر');
  assert.equal(groupSiblings,4,'أخوة CRT-DESIGN الأربعة في مجموعتها كلهم');
  // ت1: VAR-PRODUCTION نُقل كل أعضائها إلى صفحة إدارتها (د4)، فلا تُسرد قريبةً من خدمة في الباب الأمامي؛ أول بطاقة فئة بعدها VAR-PR.
  assert.ok(keys.indexOf('CRT-CONTENT')>=0&&keys.indexOf('VAR-PR')>=0,`القريب: ${keys.join('، ')}`);
  assert.equal(keys.includes('VAR-PRODUCTION'),false,'ما نُقل إلى صفحة إدارته لا يُسرد قريبًا في الباب الأمامي');
  assert.ok(keys.indexOf('CRT-CONTENT')<keys.indexOf('VAR-PR'),'أخو المجموعة قبل بطاقة الفئة');
  assert.equal(keys.includes('VAR-CREATIVE'),false,'مجموعتها ذُكرت في سطرها فلا تُذكر مرتين');
  assert.equal(keys.includes('CRT-DESIGN'),false,'ولا الخدمة نفسها');
  // أخوة المجموعة كلهم قبل أول بطاقة فئة، وكلٌّ موسوم بمصدره.
  const firstCategory=page.nearby.findIndex(item=>item.from==='category');
  assert.ok(page.nearby.slice(0,firstCategory).every(item=>item.from==='group'));
  const html=servicePageView(page,ctx);
  assert.ok(html.includes('href="#services/CRT-CONTENT"'),'الخدمة القريبة رابطٌ إلى صفحتها');
  assert.ok(html.includes('data-action="pick-variant" data-group="VAR-PR"'),'والمجموعة القريبة بابها زرّ الخيارات لا سطر ميت');
  assert.ok(text(html).includes('من مجموعتها أولًا'));
  // خدمة مفردة بلا مجموعة: القريب من فئتها وحدها.
  const single=servicePage(db,users.employee,'HR-ATTENDANCE-FIX');
  assert.equal(single.group,null);
  assert.ok(single.nearby.length&&single.nearby.every(item=>item.from==='category'));
  assert.ok(text(servicePageView(single,ctx)).includes('من الفئة نفسها'));
});

test('المخرج «لم تجد خدمتك؟»: اسم الخدمة من صفّها الحيّ في الحمولة، ولا اسم مكتوب في الشاشة، ومن لا يراها لا يُعطى رابطًا', t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.employee);
  const live=db.prepare('SELECT name_ar FROM services WHERE tenant_id=? AND code=? ORDER BY version DESC LIMIT 1').get('36t',FEEDBACK_SERVICE).name_ar;
  assert.deepEqual(tree.feedback_service,{code:FEEDBACK_SERVICE,name:live,href:`#services/${FEEDBACK_SERVICE}`});
  const home=catalogHome(tree,ctx);
  assert.ok(text(home).includes(`اطلب «${live}»`),'الاسم المطبوع هو اسم الصفّ الحيّ');
  assert.ok(home.includes(`href="#services/${FEEDBACK_SERVICE}"`));
  // القاعدة C2: لا اسم عرضٍ لخدمة مكتوبًا في ملف الشاشة — يُقرأ من services.name_ar وحده.
  const source=readFileSync(new URL('../app/static/catalog-home-ui.mjs',import.meta.url),'utf8');
  assert.equal(source.includes(live),false,'اسم الخدمة الحيّ لا يُكتب في الشاشة');
  assert.equal(source.includes('ملاحظة على المنصة أو اقتراح خدمة'),false,'ولا اسمها القديم');
  // أوقفها المالك: لا رابط إلى باب مغلق، والجملة تسقط إلى الفئات.
  transaction(db,()=>setAvailability(db,users.admin,{kind:'service',target_key:FEEDBACK_SERVICE,state:'hidden',reason:'تجريبي: قرار مصطنع لاختبار المخرج بلا خدمة'}));
  const stopped=catalogTree(db,users.employee);
  assert.equal(stopped.feedback_service,null);
  const drawn=catalogHome(stopped,ctx);
  assert.equal(drawn.includes(`#services/${FEEDBACK_SERVICE}`),false);
  assert.ok(text(drawn).includes('لم تجد خدمتك؟'),'الجملة تبقى وتقود إلى البحث والفئات');
});

test('زرّ البدء في صفحة الخدمة يحمل معرّف **أحدث** نسخة: خدمةٌ لها نسختان بعد تحريرها', t=>{
  const {db,users}=fixture(t);
  // نسخة ثانية لـHR-LETTER تُنشأ هنا بـcreateService (شكلها نفسه واسمها مختلف): إعادة التسمية نسخةٌ جديدة لا تعديل (C1).
  const current=db.prepare("SELECT * FROM services WHERE tenant_id='36t' AND code='HR-LETTER' ORDER BY version DESC LIMIT 1").get();
  transaction(db,()=>createService(db,users.admin,{code:'HR-LETTER',name_ar:'خطاب تعريف تجريبي',name_en:current.name_en,department_id:current.department_id,
    description:current.description,fields:JSON.parse(current.fields),approval_policy:JSON.parse(current.approval_policy)}));
  const versions=db.prepare('SELECT id,version FROM services WHERE tenant_id=? AND code=? ORDER BY version DESC').all('36t','HR-LETTER');
  assert.ok(versions.length>=2,'إعادة التسمية نسخةٌ جديدة لا تعديل (C1)');
  const page=servicePage(db,users.employee,'HR-LETTER');
  assert.equal(page.start.service_id,versions[0].id,'المعرّف الأحدث لا الأول');
  assert.notEqual(page.start.service_id,versions.at(-1).id);
  const html=servicePageView(page,ctx);
  assert.ok(html.includes(`data-action="pick-service" data-id="${versions[0].id}"`),'الزرّان الملتصقان يحملان المعرّف الأحدث');
  // وتغيّر النسخة بعد فتح النموذج يردّه الخادم برسالته القائمة (validation.mjs) ويرسمه معالج التقديم في #dialog-error؛
  // لا نصّ جديد في هذه الدفعة — يُتحقق من وجود المسارين لا من اختراعهما.
  const app=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  assert.ok(app.includes("error.details?.refusal?uiKit.refusal(error)")&&app.includes('#dialog-error'),'معالج التقديم يرسم الرفض المكتوب أو الخطأ في موضعه القائم');
  assert.ok(readFileSync(new URL('../app/validation.mjs',import.meta.url),'utf8').includes("'stale_version','تغيرت المعاملة. أعد تحميلها قبل المتابعة'"));
});

/* ───── الجوال 390 بلا متصفح: ما يمكن تأكيده من الأنماط نفسها ─────────────────── */

test('الأنماط: لا قاعدة .sc-* تثبّت عرضًا أكبر من 358 بكسل، وأهداف اللمس ≥44/56/64، وعمود واحد تحت 480', t=>{
  const css=readFileSync(new URL('../app/static/style.css',import.meta.url),'utf8');
  // كل قاعدة تخاطب صنفًا من sc-: تُفحص قيم العرض المكتوبة بالبكسل. 358 = 390 ناقص هامش 16 من كل جانب.
  const rules=[...css.matchAll(/([^{}]*\.sc-[^{}]*)\{([^{}]*)\}/g)];
  assert.ok(rules.length>=10,'قواعد مركز الخدمات موجودة');
  for(const [,selector,body] of rules){
    for(const m of body.matchAll(/(?:^|;)\s*(?:min-)?(?:inline-size|width)\s*:\s*(\d+(?:\.\d+)?)px/g))
      assert.ok(Number(m[1])<=358,`${selector.trim()}: عرض ثابت ${m[1]}px يتجاوز 358`);
  }
  const rule=name=>rules.filter(([,selector])=>selector.includes(name)).map(([,,body])=>body).join(';');
  assert.ok(/min-block-size:\s*64px/.test(rule('.sc-cat')),'بطاقة الفئة ≥64');
  assert.ok(/min-block-size:\s*44px/.test(rule('.sc-open')),'جسم البطاقة ≥44');
  assert.ok(/min-block-size:\s*44px/.test(rule('.sc-actions')),'أزرار البطاقة ≥44');
  assert.ok(/min-block-size:\s*56px/.test(rule('.sc-sticky .btn')),'شريط البدء الملتصق ≥56');
  assert.ok(rule('.sc-sticky').includes('env(safe-area-inset-bottom)'),'ومع المنطقة الآمنة');
  assert.ok(/min-block-size:\s*56px/.test(rule('.sc-search')),'حقل البحث أكبر هدف في الشاشة');
  // تحت 480: شبكة البطاقات عمود واحد. شبكة الفئات (rq-dept-grid) عمود واحد أصلًا بقاعدة minmax(min(280px,100%),1fr).
  const narrow=css.slice(css.indexOf('@media (max-width:480px)'));
  assert.ok(/\.sc-grid\{grid-template-columns:1fr\}/.test(narrow),'عمود واحد تحت 480');
  // ولا نمط سطري يُرسم من الشاشات (CSP): البحث هنا في المصدر لا في الناتج فحسب.
  for(const file of ['catalog-home-ui.mjs','service-page.mjs'])
    assert.equal(/style="/.test(readFileSync(new URL('../app/static/'+file,import.meta.url),'utf8')),false,`${file}: نمط سطري`);
});

test('ترتيب الشاشة: البحث أول عنصر بعد الرأس، ثم العدسات، ثم الشبكة بلا تشخيص إسقاط', t=>{
  const {db,users}=fixture(t);
  const home=catalogHome(catalogTree(db,users.employee),ctx);
  const at=needle=>{const i=home.indexOf(needle);assert.ok(i>=0,`«${needle}» غائب`);return i;};
  assert.ok(at('</h1>')<at('id="catalog-search"'),'البحث بعد العنوان مباشرة');
  assert.ok(at('id="catalog-search"')<at('data-action="catalog-lens"'),'ثم العدسات');
  assert.ok(at('data-action="catalog-lens"')<at('class="rq-dept-grid"'),'ثم الفئات');
  assert.equal(home.includes('ترتيب النسخة'),false,'لا تشخيص إسقاط في واجهة الموظف');
  assert.ok(home.includes('class="rq-dept sc-cat"'),'بطاقة الفئة تحمل صنف اللمس');
  // ت1 (تغيّر مقصود): قرّر المالك في ت0 قائمة من ثمانية مداخل «الخدمات» أحدها، فالمدخل لكل من يحمل requests.use والموظف العادي منهم.
  const app=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  assert.ok(app.includes("if(has('requests.use'))nav.push(['services'"),'«الخدمات» باب كل من يطلب، والموظف العادي منهم');
  assert.ok(/view==='catalog'[\s\S]{0,800}href="#services"/.test(app),'ورأس «طلب خدمة» يقود إلى المركز');
});
