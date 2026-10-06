// مركز الخدمات — ما وجدته المراجعة المستقلة الثلاثية على الدفعات الأربع، وما صار إليه (23 سبتمبر 2026).
//
// كل اختبار هنا يعيد إنتاج ملاحظة بعينها كما أثبتها المراجع، ويفشل على الكود قبل الإصلاح ويمرّ بعده. القاعدة الحاكمة:
// **لا رقم على شاشة لم يُقَس لحظته**، ولا زرّ حيّ يُنقر فيُردّ، ولا صفحة خدمة لا يبلغها رابطٌ من التصفّح، ولا اختبار مسجَّل يُمسّ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog, variantCatalog } from '../app/service-catalog.mjs';
import { createRequest, transition, catalog } from '../app/workflow.mjs';
import { grantAccess } from '../app/access.mjs';
import { saveDraft, publishDraft, termApplier } from '../app/definitions.mjs';
import { setAvailability } from '../app/service-availability.mjs';
import { catalogTree, servicePage, catalogFacts, unavailableFor, UNAVAILABLE, SCREEN_GAPS, logSearchEvent } from '../app/catalog-home.mjs';
import { CATALOG_RENAMES, RANKING_ZERO_REASONS } from '../app/catalog-tree.mjs';
import { catalogAdmin } from '../app/catalog-admin.mjs';
import { catalogQualityBoard } from '../app/catalog-quality.mjs';
import { catalogQualityUI } from '../app/static/catalog-quality-ui.mjs';
import { catalogTreeSection } from '../app/static/approval-settings-ui.mjs';
import { searchAll, refreshIndex } from '../app/search.mjs';
import { timeline } from '../app/request-timeline.mjs';
import { journeyRun, myJourneyRuns } from '../app/journeys.mjs';
import { mergeVariants } from '../app/static/request-picker.mjs';
import { searchCatalog, STOPWORDS, terms } from '../app/static/catalog-search.mjs';
import { kit } from '../app/static/kit.mjs';
import { catalogHome, categoryView, searchResults, catalogResults, visibleCountsLine } from '../app/static/catalog-home-ui.mjs';
import { servicePageView } from '../app/static/service-page.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=kit(e,ar=>ar);
const ctx={e,ui};
const button=(action,id,label)=>`<button class="btn outline small" data-action="operation" data-module="approval-settings" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-review-fixes');installServiceCatalog(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const latest=code=>db.prepare("SELECT * FROM services WHERE tenant_id='36t' AND code=? ORDER BY version DESC LIMIT 1").get(code);
  const version=id=>db.prepare('SELECT version FROM requests WHERE id=?').get(id).version;
  return {db,users,tx,latest,version};
}
const STAMP='2026-09-01T06:00:00.000Z';
// تبنٍّ صحيح لزمن خدمة: الأيام كما هي مسجَّلة في service_directory (وإلا لم يُصدَّق التبني — service-target.mjs).
function adopt(db,code,by='admin'){
  const stored=db.prepare("SELECT target_days FROM service_directory WHERE tenant_id='36t' AND service_code=?").get(code).target_days;
  db.prepare("INSERT INTO service_target_adoptions(id,tenant_id,service_code,proposal_key,decision,target_days,target_hours,previous_days,previous_hours,basis,decided_by,decided_at) VALUES(?,'36t',?,'code',?,?,NULL,?,0,?,?,?)")
    .run('adopt-'+code,code,'adopted',stored,stored,'تبنٍّ تجريبي مصطنع لاختبار الرقم المقيس',by,now());
}
const publishCard=(db,code)=>db.prepare(`INSERT INTO service_cards(id,tenant_id,service_code,revision,owner_id,service_kind,confidentiality,status,effective_from,prepared_by,published_by,published_at,version,created_at,updated_at)
  VALUES(?,'36t',?,1,'it','institutional','internal','published','2026-09-01','hr','manager',?,1,?,?)`).run('card-'+code,code,STAMP,STAMP,STAMP);

/* ───── (2)(3)(4) لا رقم مكتوب في نصٍّ ثابت: المقيس لحظته على كل شاشة ─────────── */

test('نصوص الغياب: لا رقم في النصّ الثابت، والمحقون يُقاس لحظته ويتحرك مع التبنّي والنشر والإكمال على الشاشات الثلاث معًا',t=>{
  const {db,users,tx,latest,version}=fixture(t);
  for(const key of ['compliance','eligibility','policy','usage'])assert.doesNotMatch(UNAVAILABLE[key].why,/\d|صفر/,`${key}: رقم مكتوب في النصّ الثابت`);
  assert.match(UNAVAILABLE.compliance.why,/\{adopted\} من \{of\}/);assert.match(UNAVAILABLE.usage.why,/\{employees\}/);
  let facts=catalogFacts(db,'36t');
  assert.deepEqual([facts.of,facts.adopted_n,facts.published_n,facts.completed_n],[142,0,0,0]);
  assert.ok(facts.employees_n>0&&facts.employees.includes(String(facts.employees_n)),'حجم القاعدة مقيس بتمييزه');
  let page=servicePage(db,users.employee,'HR-LETTER'),board=catalogQualityBoard(db,users.admin);
  assert.ok(page.compliance.why.includes('صفر من 142'),page.compliance.why);
  assert.ok(catalogTree(db,users.employee).gaps.home.find(g=>g.key==='usage').why.includes(`والمكتمل من الطلبات صفر`));
  assert.equal(board.tree.unavailable.find(g=>g.key==='compliance').why,page.compliance.why,'اللوح والصفحة جملة واحدة');
  // تبنٍّ واحد + بطاقة منشورة واحدة + طلب مكتمل واحد: تتحرك الأرقام على الصفحة واللوح والإعدادات معًا.
  adopt(db,'HR-LETTER');publishCard(db,'HR-LETTER');
  const r=tx(()=>createRequest(db,users.employee,{service_id:latest('HR-LETTER').id,title:'تجريبي',payload:{purpose:'خطاب تعريف تجريبي للاختبار',recipient:'جهة تجريبية'},project_id:null}));
  tx(()=>transition(db,users.employee,r.id,'submit',{version:r.version,note:''}));
  db.prepare("UPDATE requests SET status='completed' WHERE id=?").run(r.id);
  facts=catalogFacts(db,'36t');
  assert.deepEqual([facts.adopted_n,facts.published_n,facts.completed_n],[1,1,1]);
  page=servicePage(db,users.employee,'HR-LETTER');board=catalogQualityBoard(db,users.admin);
  assert.equal(page.target.kind,'adopted');
  assert.ok(page.compliance.why.includes('1 من 142'),`الصفحة: ${page.compliance.why}`);
  assert.deepEqual(board.tree.targets_adopted,{value:1,of:142,derived:141});
  assert.ok(board.tree.unavailable.find(g=>g.key==='compliance').why.includes('1 من 142'),'اللوح يقول الرقم نفسه بجوار بلاطته');
  assert.ok(page.gaps.find(g=>g.key==='eligibility').why.includes('1 من 142'),'المنشور من البطاقات 1 من 142 على الصفحة');
  assert.ok(catalogAdmin(db,users.admin).card_fields.note.includes('1 من 142'),'وتبويب حقول البطاقة');
  const usage=catalogTree(db,users.employee).gaps.home.find(g=>g.key==='usage').why;
  assert.ok(usage.includes('والمكتمل من الطلبات 1'),usage);
  assert.equal(catalogAdmin(db,users.admin).ranking.weights.find(w=>w.key==='usage_30d').zero_reason.includes('والمكتمل من الطلبات 1'),true);
  // ولا يزال لا نسبة على أي شاشة بعد التبنّي: الشرط الثاني (حدّ أدنى للعدد) لم يوجد.
  assert.equal(page.compliance.shown,false);
  for(const html of [servicePageView(page,ctx),catalogQualityUI.render(board,{e,button,ui})])assert.equal(/\d\s*٪/.test(html),false);
  assert.ok(verifyAudit(db));
  void version;
});

/* ───── (5) «طلبتها» و«طلباتك السابقة»: المقدَّم فعلًا وحده ─────────────────── */

test('«سياقك أنت»: المسودة ليست طلبًا سابقًا، والمقدَّم يُعدّ بالتعريف نفسه في لوح الجودة',t=>{
  const {db,users,tx,latest}=fixture(t);
  const letter=latest('HR-LETTER');
  const draft=tx(()=>createRequest(db,users.employee,{service_id:letter.id,title:'مسودة',payload:{purpose:'خطاب تعريف تجريبي للاختبار',recipient:'جهة'},project_id:null}));
  let facts=servicePage(db,users.employee,'HR-LETTER').facts;
  assert.equal(facts.earlier_requests,0,'المسودة لا تُعدّ');assert.equal(facts.last_request,null);
  assert.equal(catalogQualityBoard(db,users.admin).services.find(s=>s.code==='HR-LETTER').requests,0);
  tx(()=>transition(db,users.employee,draft.id,'submit',{version:draft.version,note:''}));
  facts=servicePage(db,users.employee,'HR-LETTER').facts;
  assert.equal(facts.earlier_requests,1);assert.equal(facts.last_request.id,draft.id);
  assert.equal(catalogQualityBoard(db,users.admin).services.find(s=>s.code==='HR-LETTER').requests,1,'تعريف واحد على الشاشتين');
});

/* ───── (6)(26) شاشة الإعدادات: الأعداد من الحمولة لا من نصّ ────────────────── */

test('الإعدادات: عدد المراحل يُعدّ من الخريطة، وفرق المدير من صفوف الجمهورين، وعدّاد المرادفات كل الصفوف عند الفتح، والمستثنى من السجل مسمًّى',t=>{
  const {db,users}=fixture(t);
  let html=catalogTreeSection(catalogAdmin(db,users.admin),{e,button,ui}),body=text(html);
  assert.ok(body.includes('8 حالات ← 6 مراحل تُبلَغ من حالة'),body.slice(body.indexOf('خريطة الحالات'),body.indexOf('خريطة الحالات')+120));
  assert.equal(body.includes('7 مراحل للطالب'),false,'لا عدد مكتوب يخالف الجدول تحته');
  assert.ok(body.includes('لا فرق فوق الموظف اليوم'),'الفرق من الحمولة: صفر');
  const rows=db.prepare("SELECT COUNT(*) AS n FROM service_synonyms WHERE tenant_id='36t'").get().n;
  assert.ok(html.includes(`data-filter-count="#catalog-synonyms">${rows}</span> من ${rows}`),'المعروض عند الفتح كل الصفوف');
  assert.ok(body.includes('لا يدخل هذا التقرير بحثٌ أصاب واحدةً من')&&body.includes('استفسار أو تصحيح في الراتب')||body.includes('لا يدخل هذا التقرير'),'المستثنى من سجل البحث مسمًّى');
  // صفّ فرقٍ اصطناعي للمدير: الجملة تتحرك إلى «صفٌّ واحد».
  db.prepare("UPDATE catalog_placement SET audience='manager' WHERE tenant_id='36t' AND item_key='IT-NEW-ACCOUNT'").run();
  body=text(catalogTreeSection(catalogAdmin(db,users.admin),{e,button,ui}));
  assert.ok(body.includes('فرقٌ فوق الموظف: صفٌّ واحد'),'الفرق يُعدّ لا يُكتب');
});

/* ───── (7) جملة المزايا بالعربية حين تختلط الحالات ─────────────────────────── */

test('لوح الصحة: حين تختلط حالات المزايا تُسمّى كلُّ حالة بكلمتها لا بمفتاحها الإنجليزي',t=>{
  const {db,users}=fixture(t);
  // نسخة ثانية مرفوضة لمفتاحٍ قائم: نسخُ الصفّ كما هو بأعمدته كلها وتبديل ما يلزم وحده.
  const row=db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id='36t' ORDER BY benefit_key LIMIT 1").get();
  const copy={...row,id:'benefit-rev-2',revision:row.revision+1,status:'rejected',proposed_by:null,change_note:'نسخة تجريبية مرفوضة',decided_by:'admin',decided_at:STAMP,decision_note:'رفض تجريبي',created_at:STAMP,updated_at:STAMP};
  const cols=Object.keys(copy);
  db.prepare(`INSERT INTO benefit_catalog(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...cols.map(c=>copy[c]));
  const {benefits}=catalogQualityBoard(db,users.admin).tree;
  assert.deepEqual([benefits.keys,benefits.rows,benefits.all_draft],[13,14,false]);
  assert.equal(benefits.sentence,'13 مفتاح ميزة في 14 صفًّا، 13 صفًّا بحالة «مسودة لم تُعتمد»، صفٌّ واحد بحالة «مرفوضة»');
  assert.equal(/\b(draft|rejected|accepted|retired)\b/.test(benefits.sentence),false,'لا مفتاح إنجليزي في الجملة');
  assert.equal(text(catalogQualityUI.render(catalogQualityBoard(db,users.admin),{e,button,ui})).includes('26 ميزة'),false);
});

/* ───── (8) زمن العثور: ما ينقص قرارٌ لا بيانٌ ──────────────────────────────── */

test('زمن العثور: نصّ «ما يلزم» لا يطلب بياناتٍ تحملها المنصة فعلًا (الأحداث مختومة ومربوطة بمعرّف الجلسة)',()=>{
  assert.doesNotMatch(UNAVAILABLE.finding_time.needs,/حدث فتحٍ بختمٍ|مربوطين بمعرّف بحث/);
  assert.match(UNAVAILABLE.finding_time.needs,/قرار المالك/);
  assert.match(UNAVAILABLE.finding_time.needs,/ختمَي البحث والفتح المسجَّلين فعلًا/);
});

/* ───── (11) لا زرّ حيّ يُنقر فيُردّ: بطاقة «إجازة» بابها شاشة وحدتها ─────────── */

test('كل زرّ «اختر النوع» على الشاشات المرسومة له مجموعة في نافذة الخيارات لهذا الحساب، وبطاقة «إجازة» بابها رابط شاشتها',t=>{
  const {db,users}=fixture(t);
  for(const who of ['employee','manager','hr','it','outsider']){
    const u=users[who],tree=catalogTree(db,u),known=new Set(variantCatalog(db,u).map(g=>g.code));
    const pages=[catalogHome(tree,ctx),...tree.categories.map(c=>categoryView(tree,c.key,'tree',ctx)),searchResults(tree,'اجازه',ctx)];
    for(const code of tree.categories.flatMap(c=>c.cards).filter(i=>i.kind==='service').slice(0,3).map(i=>i.key))pages.push(servicePageView(servicePage(db,u,code),ctx));
    pages.push(servicePageView(servicePage(db,u,'HR-ATTENDANCE-FIX'),ctx));
    for(const html of pages)for(const [,group] of html.matchAll(/data-action="pick-variant" data-group="([^"]+)"/g))
      assert.ok(known.has(group),`${who}: زرّ خيارات لمجموعة «${group}» لا تعرفها نافذة الخيارات`);
    const time=categoryView(tree,'my_time','tree',ctx),start=time.indexOf('data-card="VAR-LEAVE"'),card=time.slice(start,time.indexOf('</article>',start));
    assert.ok(card.includes('class="btn dark small" href="#leave/request"'),`${who}: زرّ بدء «إجازة» رابط شاشتها`);
    assert.equal(card.includes('data-action="pick-variant"'),false);
  }
  const leave=catalogTree(db,users.employee).categories.find(c=>c.key==='my_time').cards.find(i=>i.key==='VAR-LEAVE');
  assert.deepEqual([leave.link,leave.module_name,leave.eligible],['#leave/request','مديرك ← خدمات الموظف',true]);
  // وفي «خدمات قريبة» على صفحة خدمةٍ في الفئة نفسها: سطر «إجازة» رابطٌ إلى شاشتها لا زرّ خيارات.
  const nearby=servicePage(db,users.employee,'HR-ATTENDANCE-FIX').nearby.find(i=>i.key==='VAR-LEAVE');
  assert.equal(nearby.link,'#leave/request');
  assert.ok(servicePageView(servicePage(db,users.employee,'HR-ATTENDANCE-FIX'),ctx).includes('<a href="#leave/request"><strong>إجازة</strong></a>'));
});

/* ───── (10ب) كل صفحة خدمة تُبلَغ برابطٍ من التصفّح ─────────────────────────── */

test('مسحُ روابطٍ من #services عبر الرئيسية والفئات وصفحات الخدمة يبلغ كل صفحة خدمة في الدليل لكل جمهور',t=>{
  const {db,users}=fixture(t);
  for(const who of ['employee','manager']){
    const u=users[who],tree=catalogTree(db,u);
    const expected=new Set(tree.categories.flatMap(c=>[...c.cards,...c.members]).filter(i=>i.kind==='service').map(i=>i.key));
    const seen=new Set(),queue=[catalogHome(tree,ctx)];
    const visitedCategories=new Set();
    while(queue.length){
      const html=queue.shift();
      for(const [,key] of html.matchAll(/href="#services\/category\/([a-z_]+)"/g))if(!visitedCategories.has(key)){visitedCategories.add(key);queue.push(categoryView(tree,key,'tree',ctx));}
      for(const [,code] of html.matchAll(/href="#services\/([A-Z][A-Z0-9-]+)"/g))if(!seen.has(code)){seen.add(code);queue.push(servicePageView(servicePage(db,u,code),ctx));}
    }
    const unreachable=[...expected].filter(code=>!seen.has(code));
    assert.deepEqual(unreachable,[],`${who}: صفحات لا يبلغها رابط: ${unreachable.join('، ')}`);
    assert.equal(seen.size,tree.totals.items-1,`${who}: ${tree.totals.items-1} صفحة خدمة (البنود ناقص HR-LEAVE الوحدة)`);
  }
});

/* ───── (12) تسميات الحقول تتبع المعجم على صفحة الخدمة كما في /api/catalog ──── */

test('صفحة الخدمة: تجاوز تسمية كيان منشور («العميل» ← «الجهة») يصل قسم «ما الذي ستحتاجه؟» كما يصل دليل الخدمات والنموذج',t=>{
  const {db,users,tx}=fixture(t);
  for(const cap of ['definitions.configure','definitions.publish'])tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:cap,department_id:null,note:'منح تجريبي لاختبار المعجم'}));
  const before=servicePage(db,users.employee,'FIN-REFUND').inputs.find(f=>f.key==='client');
  assert.equal(before.label,'العميل');
  const draft=tx(()=>saveDraft(db,users.manager,'client',{spec:{entity:{label:{ar:'الجهة',en:'Account'}}}}));
  tx(()=>publishDraft(db,users.manager,'client',{row_version:draft.row_version,note:'نشر تجريبي لتسمية الكيان'}));
  const page=servicePage(db,users.employee,'FIN-REFUND');
  assert.equal(page.inputs.find(f=>f.key==='client').label,'الجهة','الصفحة تتبع المعجم');
  const fromCatalog=termApplier(db,'36t')(catalog(db,users.employee).find(s=>s.code==='FIN-REFUND').fields).find(f=>f.key==='client').label;
  assert.equal(page.inputs.find(f=>f.key==='client').label,fromCatalog,'الصفحة و/api/catalog اسمٌ واحد');
  assert.ok(text(servicePageView(page,ctx)).includes('الجهة'));
});

/* ───── (13) البحث الشامل يجد الأسماء القديمة ────────────────────────────────── */

test('البحث الشامل: كل اسمٍ قديم من التسع عشرة يجد خدمته، وكلمة الطالب «تعريف بالعمل» تجد الخطاب المبذور، ولا رمز يُفهرس مرتين',t=>{
  const {db,users,tx}=fixture(t);
  tx(()=>refreshIndex(db,users.admin,{explicit:true,maxAgeMs:0}));
  const find=(who,q,code)=>(searchAll(db,who,q,{limit:50}).groups.find(g=>g.key==='service')?.results??[]).some(r=>r.href?.includes(code)||r.title===db.prepare("SELECT name_ar FROM services WHERE tenant_id='36t' AND code=? ORDER BY version DESC LIMIT 1").get(code).name_ar);
  const misses=CATALOG_RENAMES.filter(r=>!find(users.employee,r.from,r.code)).map(r=>`${r.code} «${r.from}»`);
  assert.deepEqual(misses,[],`أسماء قديمة لا يجدها البحث الشامل: ${misses.join('، ')}`);
  assert.ok(find(users.employee,'تعريف بالعمل','HR-LETTER'));
  const indexed=db.prepare("SELECT s.code,COUNT(*) AS n FROM search_index i JOIN services s ON s.id=i.entity_id WHERE i.tenant_id='36t' AND i.entity_type='service' GROUP BY s.code HAVING n>1").all();
  assert.deepEqual(indexed,[],'لا رمز مفهرس مرتين');
});

/* ───── (14) ابن الرحلة يسمّي رحلته ومن اعتمد أباه ──────────────────────────── */

test('الرحلة: الابن المقدَّم آليًا يحمل ملاحظةً تسمّي الرحلة والأب ومن اعتمده، وحدثًا باسم المعتمِد يقرؤه خطّ الطلب',t=>{
  const {db,users,tx,latest,version}=fixture(t);
  const parent=tx(()=>createRequest(db,users.manager,{service_id:latest('IT-NEW-ACCOUNT').id,title:'تجهيز حسابات موظف جديد — تجريبي',
    payload:{employee_name:'موظف جديد تجريبي',department:'الفريق الإبداعي التجريبي',start_date:'2026-10-01',systems:'البريد ومساحة الملفات'},project_id:null}));
  tx(()=>transition(db,users.manager,parent.id,'submit',{version:parent.version,note:''}));
  tx(()=>transition(db,users.it,parent.id,'approve',{version:version(parent.id),note:''}));
  const run=journeyRun(db,users.manager,myJourneyRuns(db,users.manager)[0].id);
  const workspace=run.steps.find(s=>s.key==='workspace');
  assert.equal(workspace.child.status,'pending','المقعد قُدّم آليًا');
  const events=db.prepare("SELECT action,actor_id,reason FROM audit_events WHERE entity_type='request' AND entity_id=? ORDER BY seq").all(workspace.child.id);
  const submit=events.find(x=>x.action==='submit');
  assert.ok(submit.reason.includes('ضمن رحلة «انضمام موظف جديد»')&&submit.reason.includes(parent.id)&&submit.reason.includes(users.it.name),`ملاحظة التقديم تسمّي: ${submit.reason}`);
  const origin=events.find(x=>x.action==='journey.child_created');
  assert.equal(origin.actor_id,users.it.id,'حدث الأصل باسم من اعتمد الأب');
  // ومن يقرّر في الابن (خطّ الطلب) يقرأ الأصل نصًّا لا مفتاحًا خامًا.
  const line=timeline(db,users.manager,workspace.child.id);
  const shown=line.events.find(x=>x.action==='journey.child_created');
  assert.ok(shown&&shown.text.includes('رحلة')&&shown.reason.includes(users.it.name),'الأصل في الخطّ باسم المعتمِد');
  // والمسودات الثلاث كذلك تحمل حدث أصلها.
  for(const key of ['device','access_card','welcome'])assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE action='journey.child_created' AND entity_id=?").get(run.steps.find(s=>s.key===key).child.id),`${key}: حدث الأصل`);
  assert.ok(verifyAudit(db),'السلسلة سليمة بعد الأحداث الجديدة');
});

/* ───── (15) كل خدمة تُتصفَّح تحت إدارتها في المشغّل القديم ──────────────────── */

test('المشغّل القديم: بطاقة المجموعة تُسنَد إلى إدارة أعضائها، فلا خدمة تغيب عن رفّ إدارتها',t=>{
  const {db,users}=fixture(t);
  for(const who of ['employee','manager']){
    const u=users[who],services=catalog(db,u),groups=variantCatalog(db,u);
    const merged=mergeVariants(services,groups);
    const shelf=new Map();
    for(const item of merged){
      if(item.variant){for(const option of item.variant.options)if(option.service_code)shelf.set(option.service_code,item.department_id);}
      else shelf.set(item.code,item.department_id);
    }
    const mismatch=services.filter(s=>shelf.has(s.code)&&shelf.get(s.code)!==s.department_id).map(s=>`${s.code} (${s.department_id} ← ${shelf.get(s.code)})`);
    assert.deepEqual(mismatch,[],`${who}: خدمات على رفّ إدارةٍ غير إدارتها: ${mismatch.join('، ')}`);
    assert.equal(services.filter(s=>!shelf.has(s.code)).length,0,`${who}: خدمة بلا رفّ`);
  }
  assert.ok(variantCatalog(db,users.employee).find(g=>g.code==='VAR-BRAND').options.some(o=>o.service_code==='CRT-ASSET-REQUEST'),'طلب الأصل من المكتبة في مجموعة الهوية (إدارته brand)');
});

/* ───── (17) الموقوف يُعدّ لجمهور القارئ ────────────────────────────────────── */

test('الترويسة: عدّ الموقوف دقيق حسب الجمهور ويبقى في بيانات الإدارة لا واجهة الاستخدام',t=>{
  const {db,users,tx}=fixture(t);
  db.prepare("UPDATE catalog_placement SET audience='manager' WHERE tenant_id='36t' AND item_key='IT-NEW-ACCOUNT'").run();
  tx(()=>setAvailability(db,users.admin,{kind:'service',target_key:'IT-NEW-ACCOUNT',state:'hidden',reason:'تجريبي: إيقاف مصطنع لاختبار عدّاد الموقوف لكل جمهور'}));
  const employee=catalogTree(db,users.employee),manager=catalogTree(db,users.manager);
  assert.equal(employee.hidden_services,0,'لم تكن في دليله فلا تُقال له موقوفة');
  assert.equal(manager.hidden_services,1);
  assert.equal(text(catalogHome(employee,ctx)).includes('موقوفة من الإعدادات'),false);
  assert.equal(text(catalogHome(manager,ctx)).includes('موقوفة من الإعدادات'),false);
  // وخدمةٌ بلا صفٍّ في الإسقاط أصلًا كانت ظاهرة للجميع، فتُعدّ للجميع حين تُوقف.
  db.prepare("DELETE FROM catalog_placement WHERE tenant_id='36t' AND item_key='HR-OVERTIME'").run();
  tx(()=>setAvailability(db,users.admin,{kind:'service',target_key:'HR-OVERTIME',state:'hidden',reason:'تجريبي: إيقاف مصطنع لخدمة بلا موضع'}));
  assert.equal(catalogTree(db,users.employee).hidden_services,1);assert.equal(catalogTree(db,users.manager).hidden_services,2);
  assert.ok(verifyAudit(db));
});

/* ───── (19) البحث بكلمات الناس: مقياسان خارج المرادفات ─────────────────────── */
// (أ) عشرون سؤالًا من المراجع الثالث بالدارج السعودي: كانت 3 من 20 (17 بلا نتيجة). أُضيفت لها كلماتٌ فهي **مضبوطة عليها**
//     ولا تُقاس بها القدرة على غير المعروف. (ب) عشرون سؤالًا محجوزة لم تُضَف لها كلمة واحدة: هي المقياس الصادق لكلمات الناس،
//     وحدّها ما قِيس فعلًا ناقصَ واحد (14 من 20 عند كتابتها)؛ من يرفع الحدّ يرفعه بقياسٍ لا بكلمات تُضاف لأسئلته.
const REVIEWER_QUERIES=[
  ['ابي اطلع اجازة مرضية','HR-LEAVE'],['ودي اروح الحج','HR-LEAVE'],['متى ينزل الراتب','HR-PAYROLL-INQUIRY'],['خصموا علي','HR-PAYROLL-INQUIRY'],
  ['اللابتوب علق','IT-SUPPORT'],['المكيف ما يبرد','ADM-MAINTENANCE'],['الكهربا مقطوعة','ADM-MAINTENANCE'],['ابي كرت الدخول حقي','ADM-ACCESS-CARD'],
  ['محتاج اقلام وورق','ADM-SUPPLIES'],['ابي اسوي تذكرة طيران','ADM-TRAVEL'],['خطاب للسفارة','HR-LETTER'],['ابي اغير الايبان حقي','HR-BANK-CHANGE'],
  ['ابغى اضيف زوجتي على التأمين','HR-BENEFIT-CLAIM'],['رخصة الشغل خلصت','HR-DOC-RENEWAL'],['ابي اشتكي على مديري','HR-GRIEVANCE'],['نبي نصور فيديو','PRO-SHOOT'],
  ['فوتوشوب','CRT-DESIGN'],['ابغى ايميل لموظف جديد','IT-NEW-ACCOUNT','manager'],['الحساب مقفل','IT-PASSWORD-UNLOCK'],['بوست انستقرام','DIG-SOCIAL-POST']];
const HELD_OUT_QUERIES=[
  ['تاخرت اليوم عن الدوام','HR-ATTENDANCE-FIX'],['ابغى اشتغل من البيت بكرة','HR-ATTENDANCE-FIX'],['كم باقي لي اجازات',['HR-LEAVE','VAR-LEAVE']],['راتبي ما نزل','HR-PAYROLL-INQUIRY'],
  ['ابي شهادة اني موظف عندكم للبنك','HR-SALARY-CERT'],['الطابعة ما تطبع','IT-SUPPORT'],['النت ضعيف','IT-SUPPORT'],['ابغى اوفيس على جهازي','IT-SOFTWARE'],
  ['ابي قاعة لاجتماع بكرة','ADM-ROOM-BOOKING'],['عندي ضيوف جايين المكتب','ADM-VISITOR'],['صرفت فلوس على غداء العميل','ADM-EXPENSE-CLAIM'],['ابغى احضر مؤتمر','TAL-TRAINING'],
  ['بقدم استقالتي','HR-RESIGNATION'],['نحتاج نوظف مصمم','HR-HIRING-NEED','manager'],['طلب شراء كراسي مكتب','PRC-PURCHASE-REQUEST'],['فاتورة المورد ما انصرفت','FIN-PAYMENT-REQUEST'],
  ['ابغى ترجمة ملف للانجليزي','CRT-TRANSLATION'],['تعديل على التصميم','CRT-REVISION'],['سيارة للمشوار','ADM-VEHICLE'],['ابغى ارسل طرد لعميل','ADM-COURIER']];
export const HELD_OUT_MINIMUM=13;
function firstPlace(trees,list){
  const misses=[];
  for(const [q,expected,audience='employee'] of list){
    const tree=trees[audience],r=searchCatalog(tree,tree.synonyms,q),first=r.hits[0]?.item.key??null;
    if(![].concat(expected).includes(first))misses.push(`«${q}» → ${first??'لا شيء'}`);
  }
  return {ok:list.length-misses.length,misses};
}
test('البحث بكلمات الناس: عشرون سؤالًا دارجًا مضبوطًا ≥18، وعشرون محجوزًا بلا كلمة مضافة ≥13، ولا سؤال يعود فارغًا حين تُصيب كلمةٌ واحدة',t=>{
  const {db,users}=fixture(t);
  const trees={employee:catalogTree(db,users.employee),manager:catalogTree(db,users.manager)};
  const tuned=firstPlace(trees,REVIEWER_QUERIES),held=firstPlace(trees,HELD_OUT_QUERIES);
  t.diagnostic(`المضبوطة (مراجع): ${tuned.ok}/20 · المحجوزة (بلا كلمة مضافة): ${held.ok}/20 — الأخيرة هي مقياس كلمات الناس`);
  assert.ok(tuned.ok>=18,`المضبوطة دون 18: ${tuned.misses.join('؛ ')}`);
  assert.ok(held.ok>=HELD_OUT_MINIMUM,`المحجوزة دون ${HELD_OUT_MINIMUM}: ${held.misses.join('؛ ')}`);
  for(const [q] of [...REVIEWER_QUERIES,...HELD_OUT_QUERIES])assert.ok(searchCatalog(trees.employee,trees.employee.synonyms,q).hits.length>0||searchCatalog(trees.manager,trees.manager.synonyms,q).hits.length>0,`«${q}»: بلا نتيجة`);
  // الكلمات المستعملة والمهملة تصل الطالب: «المكيف ما يبرد» قبل إضافة «يبرد» كانت تعود فارغة؛ الآن كلمةٌ غريبة تُقال مهملة.
  const partial=searchCatalog(trees.employee,trees.employee.synonyms,'المكيف زبرجد');
  assert.equal(partial.partial,true);assert.deepEqual([partial.used,partial.ignored],[['المكيف'],['زبرجد']]);
  assert.equal(partial.hits[0].item.key,'ADM-MAINTENANCE');
  const html=searchResults(trees.employee,'المكيف زبرجد',ctx);
  assert.ok(html.includes('بحثنا بكلمات: المكيف')&&html.includes('وتجاهلنا: زبرجد'),'الشاشة تقول أي الكلمات استُعملت');
  // وكل الكلمات حين تصيب: لا سطر «بحثنا بكلمات».
  assert.equal(searchResults(trees.employee,'تعريف بنك',ctx).includes('بحثنا بكلمات'),false);
  // «الحج» تجد «حج» بنزع «ال» في المرادف، ولا تنزلق إلى «الحجز» في وصف قاعة الاجتماعات.
  assert.equal(searchCatalog(trees.employee,trees.employee.synonyms,'الحج').hits[0].item.key,'HR-LEAVE');
  // كلمات الربط بصورتها المطبَّعة: «متى» و«على» تُسقطان فعلًا.
  assert.ok(STOPWORDS.has('متي')&&STOPWORDS.has('علي'));
  assert.deepEqual(terms('متى ينزل الراتب على حسابي'),['ينزل','الراتب','حسابي']);
  // والخمسون في ملف البحث مقياسٌ ذاتي لجدول المرادفات (39 منها مرادفٌ أو اسمٌ بالحرف) لا مقياس كلمات الناس؛ يُقال ذلك في STATUS.md.
});

/* ───── (21)(25) الأنماط: الشريط الملتصق فوق شريط التبويب، والروابط أهداف لمس ──── */

test('الأنماط: الشريط الملتصق يقف فوق شريط التبويب السفلي على الجوال ويعود إلى الصفر فوق 760، وروابط النصّ في البطاقات ≥44',()=>{
  const css=read('../app/static/style.css');
  const sticky=css.match(/\.sc-sticky\{([^}]*)\}/)[1];
  assert.ok(sticky.includes('inset-block-end:calc(var(--tabbar-h,64px) + var(--safe-b,0px))'),'يقف فوق شريط التبويب لا خلفه');
  assert.ok(sticky.includes('z-index:calc(var(--z-tabs,35) - 1)'),'ودون طبقة الشريط');
  assert.ok(/@media \(min-width:760px\)\{\.sc-sticky\{inset-block-end:0\}\}/.test(css),'وفوق 760 (الشريط علوي) يعود الصفر');
  const members=css.match(/\.sc-members a\{([^}]*)\}/)[1];
  assert.ok(members.includes('display:inline-block')&&members.includes('padding-block:.55rem'),'رابط العضو: 14px×1.9 + 2×.55rem ≈ 44');
  const inline=css.match(/\.sc-why a,\.sc-answer strong a,\.sc-feedback a\{([^}]*)\}/)[1];
  assert.ok(inline.includes('min-block-size:44px')&&inline.includes('display:inline-block'),'روابط السبب والجواب والمخرج ≥44');
});

/* ───── (22)(23)(24) لوح النتائج في موضعٍ واحد، والعدّاد يُنطق، وقائمة التبويبات كاملة ── */

test('لوح النتائج: الاستعلام الفارغ يعيد ما رُسم أولًا (مشغّل الإدارة)، والعدّاد نصٌّ للوح الدائم، وقائمة التبويبات بترتيب Tab واحد',t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.employee);
  const launcher='<div class="rq" data-launcher>مشغّل الإدارة التجريبي</div>';
  const empty=catalogResults(tree,'   ',{...ctx,extra:launcher});
  assert.equal(empty.html,launcher,'تفريغ الصندوق يعيد ما رُسم أولًا لا شبكة الحاجة');
  assert.equal(empty.announce,visibleCountsLine(tree));
  assert.equal(empty.announce,'143 خدمة متاحة لك');
  const found=catalogResults(tree,'تعريف',{...ctx,extra:launcher});
  assert.ok(found.html.includes('<h2>نتائج «تعريف»</h2>')&&!found.html.includes(launcher));
  assert.match(found.announce,/خدمات مطابقة$|خدمة مطابقة$|خدمتان مطابقة$/);
  assert.equal(catalogResults(tree,'زحل عطارد',ctx).announce,'لا توجد خدمة مطابقة');
  // app.mjs يستعمل الدالة نفسها ويحفظ ما رُسم أولًا ويكتب الإعلان في اللوح الدائم ويعيد التبئير إلى التبويب المختار.
  const app=read('../app/static/app.mjs');
  assert.ok(app.includes('catalogResults(catalogTree,catalogQuery,{e,ui:uiKit,extra:catalogExtra,counts:catalogCounts})'),'إعادة الرسم من الدالة نفسها بما رُسم أولًا (وبعدّ العدسة المرسومة: tests/services-counts.test.mjs)');
  assert.ok(app.includes("document.querySelector('#catalog-counts');if(counts)counts.textContent=pane.announce"),'العدّاد في اللوح الدائم');
  assert.ok(app.includes(`document.querySelector('[data-action="catalog-lens"][aria-selected="true"]')?.focus?.`),'التبئير يعود إلى التبويب');
  assert.equal(app.includes('searchResults(catalogTree'),false,'لا رسم ثانٍ للنتائج خارج الدالة الواحدة');
  // قائمة التبويبات: المختار وحده في ترتيب Tab، وكلٌّ يشير إلى اللوح، واللوح tabpanel مسمًّى بالمختار.
  const home=catalogHome(tree,ctx);
  // ت1: العدسة الافتراضية للزيارة الأولى «حسب الإدارة».
  assert.ok(home.includes('role="tab" id="lens-tab-department" aria-selected="true" aria-controls="catalog-results" tabindex="0"'));
  assert.ok(home.includes('role="tab" id="lens-tab-need" aria-selected="false" aria-controls="catalog-results" tabindex="-1"'));
  assert.ok(home.includes('<div id="catalog-results" role="tabpanel" aria-labelledby="lens-tab-department">'));
});

/* ───── (16) ما لا يُسجَّل بحثه مكتوبٌ على اللوح، والسلوك كما قرّره المالك ──────── */

test('سجل البحث: بحثٌ أصاب سرّيًا لا يُسجَّل (قرار المالك §8-7 كما هو)، وتبويب المرادفات يسمّي المستثنى بأسمائه',t=>{
  const {db,users,tx}=fixture(t);
  assert.equal(tx(()=>logSearchEvent(db,users.employee,{search_id:'0123456789abcdef0123456789abcdef',event:'searched',query:'تعريف بنك'})).logged,false);
  const admin=catalogAdmin(db,users.admin);
  assert.equal(admin.synonyms.excluded_from_log.length,10,'العشر السرّية ومغلقة الدائرة');
  assert.ok(admin.synonyms.excluded_from_log.every(x=>x.name&&x.name!==x.key),'بأسمائها الحيّة');
  assert.ok(text(catalogTreeSection(admin,{e,button,ui})).includes('لا يدخل هذا التقرير بحثٌ أصاب واحدةً من 10 خدمة'));
  assert.deepEqual(SCREEN_GAPS.home,['usage','journey','finding_time']);
  void unavailableFor;void RANKING_ZERO_REASONS;
});
