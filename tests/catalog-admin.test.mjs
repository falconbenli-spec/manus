// لوح شجرة مركز الخدمات ولوح صحتها (الدفعة الرابعة) — 23 سبتمبر 2026.
//
// ما يحرسه هذا الملف: اللوح لحامل «إعداد الخدمات» وحده وأعداده من placementFor؛ والجمهوران الخارجيان صفرٌ بسببهما؛
// والمرادفات سطح الكتابة الوحيد بحدث تدقيق لكل إضافة وحذف، وصفوف الكود لا تُحذف؛ ومرادف السرّي فعل شخصين لا يقرؤه البحث
// قبل التأكيد؛ وتقرير «بلا نتيجة» لا يُظهر سطرًا قبل ثلاث مرات؛ ولوح الصحة لا يطبع رقمًا لا يُحسب، ويذكر سابقة الأهلية
// بعددها الصحيح «13 مفتاح ميزة في 26 صفًّا، كلها مسودات».
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { grantAccess } from '../app/access.mjs';
import { catalogAdmin, addSynonym, removeSynonym, confirmSynonym, missesReport, MISS_MIN_COUNT, proposalOf } from '../app/catalog-admin.mjs';
import { synonymsFor, logSearchEvent, catalogTree } from '../app/catalog-home.mjs';
import { catalogQualityBoard } from '../app/catalog-quality.mjs';
import { catalogQualityUI } from '../app/static/catalog-quality-ui.mjs';
import { catalogTreeSection } from '../app/static/approval-settings-ui.mjs';
import { RANKING, RANKING_ZERO_REASONS, NAMING_RULE_DECISION, PINS, SEASONS, PROPOSAL_MARK } from '../app/catalog-tree.mjs';
import { REQUEST_STATUSES, stageOf } from '../app/static/vocabulary.mjs';
import { rankCatalog } from '../app/static/catalog-search.mjs';
import { kit } from '../app/static/kit.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=kit(e,ar=>ar);
const button=(action,id,label)=>`<button class="btn outline small" data-action="operation" data-module="approval-settings" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
const CSP=/<script|\sstyle=|\son[a-z]+=/i;
const hex=n=>String(n).padStart(32,'0').replace(/[^0-9a-f]/g,'0');

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-catalog-admin');installServiceCatalog(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const events=action=>db.prepare('SELECT * FROM audit_events WHERE action=? ORDER BY seq').all(action);
  return {db,users,tx,events};
}

test('اللوح: لحامل «إعداد الخدمات» وحده، وأعداده من placementFor، والجمهوران الخارجيان صفرٌ بسببهما، وتسعة تبويبات و«التسمية» بنصّها',t=>{
  const {db,users}=fixture(t);
  const forManager=catalogAdmin(db,users.manager);
  assert.equal(forManager.can_manage,false);assert.equal('categories' in forManager,false,'لا مادّة لغير حامل التصريح');
  const admin=catalogAdmin(db,users.admin);
  assert.equal(admin.can_manage,true);
  for(const key of ['categories','journeys','synonyms','pins','seasons','card_fields','status_map','ranking','publish','import_export','naming'])assert.ok(key in admin,`${key} في الحمولة`);
  const byKey=Object.fromEntries(admin.categories.audiences.map(a=>[a.key,a]));
  assert.deepEqual([byKey.employee.totals.cards,byKey.employee.totals.items],[63,143]);
  assert.deepEqual([byKey.manager.totals.cards,byKey.manager.totals.items],[63,143]);
  assert.equal(byKey.manager.rows,byKey.employee.rows,'المدير فرقٌ فوق الموظف: صفرٌ اليوم (مراجعة 23 سبتمبر)');
  for(const external of ['client','vendor']){assert.equal(byKey[external].rows,0);assert.match(byKey[external].why_empty,/لا دور لعميل ولا لمورّد/);}
  assert.equal(admin.categories.items_unplaced,0);assert.equal(admin.categories.release_version,0);
  assert.match(admin.categories.note,/النسخة صفر/);
  // خريطة الحالات من القاموس بالحرف، وأوزان الترتيب بنصّ صفريها، والتسمية بقرارها المكتوب.
  assert.deepEqual(admin.status_map.map(m=>[m.status,m.stage_name]),REQUEST_STATUSES.map(s=>[s,stageOf(s).name_ar]));
  const usage=admin.ranking.weights.find(w=>w.key==='usage_30d');
  // سبب الصفر بأرقامه المقيسة (لا «29 موظفًا وطلبان» مكتوبةً): الحسابات النشطة والمكتمل من الطلبات في هذه القاعدة.
  assert.equal(usage.weight,0);assert.ok(usage.zero_reason.includes(admin.facts.employees)&&!usage.zero_reason.includes('{'),usage.zero_reason);
  assert.notEqual(usage.zero_reason,RANKING_ZERO_REASONS.usage_30d,'النصّ الثابت بمواضعه لا يصل الشاشة');
  assert.equal(admin.ranking.weights.length,Object.keys(RANKING).length);
  assert.equal(admin.naming.decision,NAMING_RULE_DECISION);assert.match(admin.naming.decision,/139/);assert.equal(admin.naming.renames,19);assert.equal(admin.naming.fixed,9);
  assert.equal(admin.publish.deferred,true);assert.match(admin.publish.why,/registerEntity/);assert.equal(admin.import_export.deferred,true);
  assert.deepEqual([admin.pins.rows,PINS.length,admin.seasons.rows,SEASONS.length],[[],0,[],0]);
  assert.match(admin.pins.note,/لا شيء بعد/);assert.match(admin.seasons.note,/لا شيء بعد/);
  assert.equal(admin.journeys.built.length,1);assert.equal(admin.journeys.later.length,7);
  // الشاشة: تسعة تبويبات <details> من العدّة و«التسمية»، ولا شيء للمدير، ولا نمط سطري.
  const html=catalogTreeSection(admin,{e,button,ui});
  assert.doesNotMatch(html,CSP);
  assert.equal((html.match(/<details class="vn-card"/g)??[]).length>=9,true,'تسعة تبويبات على الأقل');
  const body=text(html);
  for(const title of ['الفئات والإسناد','الرحلات','المرادفات والبحث','التثبيت والمواسم','حقول بطاقة الخدمة','خريطة الحالات','أوزان الترتيب','المعاينة والنشر','الاستيراد/التصدير','التسمية'])assert.ok(body.includes(title),title);
  assert.ok(body.includes(NAMING_RULE_DECISION.slice(0,40)),'قرار التسمية بنصّه');
  assert.ok(body.includes('مؤجَّل'),'المؤجَّل مكتوب لا مرسوم فارغًا');
  assert.equal(catalogTreeSection(forManager,{e,button,ui}),'','لا قسم للمدير');
});

test('المرادفات: الإضافة والحذف بحدث تدقيق، والمكرر يُرفض، وصفوف الكود لا تُحذف من اللوح، والبحث يرى المضاف فورًا',t=>{
  const {db,users,tx,events}=fixture(t);
  const added=tx(()=>addSynonym(db,users.admin,{item_kind:'service',item_key:'HR-ATTENDANCE-FIX',term:'كلمه تجريبيه للحضور',note:'اختبار'}));
  assert.equal(added.pending,false);
  assert.equal(events('catalog.synonym_added').length,1);
  assert.ok(synonymsFor(db,'36t')['service:HR-ATTENDANCE-FIX'].includes(added.normalized),'البحث يقرؤه');
  const tree=catalogTree(db,users.employee);
  assert.equal(rankCatalog(tree,tree.synonyms,'كلمه تجريبيه للحضور')[0]?.item.key,'HR-ATTENDANCE-FIX','ويصل به إلى بنده أولًا');
  assert.throws(()=>tx(()=>addSynonym(db,users.admin,{item_kind:'service',item_key:'HR-ATTENDANCE-FIX',term:'كلمة تجريبية للحضور',note:''})),error=>error.code==='synonym_exists','المكرر بصورته المطبَّعة يُرفض');
  assert.throws(()=>tx(()=>addSynonym(db,users.admin,{item_kind:'service',item_key:'NO-SUCH-CODE',term:'شيء',note:''})),error=>error.code==='item_not_found');
  assert.throws(()=>tx(()=>addSynonym(db,users.admin,{item_kind:'service',item_key:'HR-ATTENDANCE-FIX',term:'a',note:''})),error=>error.code==='term');
  assert.throws(()=>tx(()=>addSynonym(db,users.manager,{item_kind:'service',item_key:'HR-ATTENDANCE-FIX',term:'كلمة أخرى',note:''})),error=>error.code==='forbidden'&&!!error.details?.refusal,'غير الحامل يُردّ رفضًا مكتوبًا');
  // صفٌّ من الكود لا يُحذف من هنا: يُعاد كتابته مع كل إسقاط، والرفض يسمّي مصدره.
  const fromCode=db.prepare("SELECT normalized FROM service_synonyms WHERE item_key='HR-ATTENDANCE-FIX' AND source='from_code' LIMIT 1").get().normalized;
  assert.throws(()=>tx(()=>removeSynonym(db,users.admin,{item_kind:'service',item_key:'HR-ATTENDANCE-FIX',normalized:fromCode,note:''})),error=>error.code==='from_code');
  tx(()=>removeSynonym(db,users.admin,{item_kind:'service',item_key:'HR-ATTENDANCE-FIX',normalized:added.normalized,note:'انتهى الاختبار'}));
  assert.equal(events('catalog.synonym_removed').length,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service_synonyms WHERE normalized=?').get(added.normalized).n,0);
  assert.ok(verifyAudit(db),'سلسلة التدقيق سليمة بعد الإضافة والحذف');
});

test('المرادفات السرّية: فعل شخصين — المقترَح لا يقرؤه البحث، والمقترِح لا يؤكّده، وحامل تصريح آخر يؤكّده فيدخل البحث',t=>{
  const {db,users,tx,events}=fixture(t);
  const proposed=tx(()=>addSynonym(db,users.admin,{item_kind:'service',item_key:'HR-PAYROLL-INQUIRY',term:'راتبي ناقص بشده',note:'من بحثٍ متكرر'}));
  assert.equal(proposed.pending,true);assert.match(proposed.next,/يؤكّده/);
  assert.equal(events('catalog.synonym_proposed').length,1);assert.equal(events('catalog.synonym_added').length,0);
  const row=db.prepare('SELECT note FROM service_synonyms WHERE item_key=? AND normalized=?').get('HR-PAYROLL-INQUIRY',proposed.normalized);
  assert.ok(row.note.startsWith(PROPOSAL_MARK+'|'));assert.equal(proposalOf(row.note).proposer,users.admin.id);
  assert.equal((synonymsFor(db,'36t')['service:HR-PAYROLL-INQUIRY']??[]).includes(proposed.normalized),false,'لا يقرؤه البحث قبل التأكيد');
  assert.throws(()=>tx(()=>confirmSynonym(db,users.admin,{item_kind:'service',item_key:'HR-PAYROLL-INQUIRY',normalized:proposed.normalized,note:''})),error=>error.code==='two_person');
  // حامل تصريح آخر: تصاريح إدارة المنصة تُمنح لحساب إداري فقط، فيُنشأ حساب إداري ثانٍ مصطنع ويُمنح «إعداد الخدمات» بيد الأدمن الأول، ثم يؤكّد.
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('admin2','36t','ops','admin2','مسؤول منصة ثانٍ تجريبي','synthetic','admin',NULL)").run();
  const admin2=db.prepare("SELECT * FROM users WHERE id='admin2'").get();
  assert.throws(()=>tx(()=>confirmSynonym(db,admin2,{item_kind:'service',item_key:'HR-PAYROLL-INQUIRY',normalized:proposed.normalized,note:''})),error=>error.code==='forbidden','قبل المنح لا يؤكّد');
  tx(()=>grantAccess(db,users.admin,{user_id:admin2.id,capability:'catalog.manage',department_id:null,note:'تجريبي: حامل ثانٍ لاختبار قاعدة الشخصين'}));
  const confirmed=tx(()=>confirmSynonym(db,admin2,{item_kind:'service',item_key:'HR-PAYROLL-INQUIRY',normalized:proposed.normalized,note:'أُكّد للاختبار'}));
  assert.equal(confirmed.pending,false);
  assert.equal(events('catalog.synonym_confirmed').length,1);
  assert.ok(synonymsFor(db,'36t')['service:HR-PAYROLL-INQUIRY'].includes(proposed.normalized),'دخل البحث بعد التأكيد');
  assert.equal(proposalOf(db.prepare('SELECT note FROM service_synonyms WHERE normalized=?').get(proposed.normalized).note),null);
  const admin=catalogAdmin(db,users.admin);
  assert.equal(admin.synonyms.totals.pending,0);
  assert.ok(admin.synonyms.items.find(i=>i.key==='HR-PAYROLL-INQUIRY').confidential);
  assert.ok(verifyAudit(db));
});

test('تقرير «بلا نتيجة»: لا سطر قبل ثلاث مرات، والثالثة تُظهره، وسؤالٌ أصاب سرّيًا لا يُسجَّل أصلًا',t=>{
  const {db,users,tx}=fixture(t);
  const log=(i,query)=>tx(()=>logSearchEvent(db,users.employee,{search_id:hex(i),event:'searched',query}));
  // «بلا نتيجة» بعد ترتيب الكلمات المصيبة (مراجعة 23 سبتمبر) يعني أن **لا كلمة** أصابت شيئًا: سؤالٌ كلماته خارج الدليل كله.
  assert.equal(log(1,'زحل عطارد').result_count,0);
  log(2,'زحل عطارد');
  assert.equal(missesReport(db,'36t').misses.length,0,'مرتان دون الحدّ');
  assert.equal(missesReport(db,'36t').below_minimum,1);
  log(3,'زحل عُطارد');
  const report=missesReport(db,'36t');
  assert.equal(MISS_MIN_COUNT,3);
  assert.equal(report.misses.length,1);assert.equal(report.misses[0].n,3,'الصور الثلاث تُجمع صفًّا واحدًا بعد التطبيع');
  // السرّي: «راتبي ناقص» يصيب HR-PAYROLL-INQUIRY فلا يُكتب صفٌّ، ولو تكرر عشرًا.
  for(let i=10;i<20;i++)assert.equal(log(i,'راتبي ناقص').logged,false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catalog_search_log WHERE query_normalized LIKE '%راتب%'").get().n,0);
  const admin=catalogAdmin(db,users.admin);
  assert.deepEqual(admin.synonyms.misses.map(m=>m.n),[3]);
});

test('لوح الصحة: المقاييس المحسوبة وحدها، وكل غير محسوب صفٌّ «غير متاح» بنصّه، ولا ٪، وسابقة الأهلية «13 مفتاح ميزة في 26 صفًّا، كلها مسودات»',t=>{
  const {db,users}=fixture(t);
  assert.equal('tree' in catalogQualityBoard(db,users.employee),false,'لا لوح لغير حامل التصريح');
  const board=catalogQualityBoard(db,users.admin),tree=board.tree;
  assert.deepEqual([tree.items_unplaced.value,tree.items_unplaced.target],[0,0]);
  assert.deepEqual(tree.audiences.map(a=>[a.key,a.totals.cards,a.totals.items]),[['employee',63,143],['manager',63,143]]);
  assert.deepEqual(tree.out_of_range,[],'لا فئة تحت 3 ولا فوق 12');
  assert.deepEqual(tree.cards_published,{value:0,of:142});
  assert.deepEqual(tree.targets_adopted,{value:0,of:142,derived:142},'صفر متبنًّى، والباقي مشتق');
  assert.equal(tree.synonyms.thin_count,0);
  assert.deepEqual([tree.funnel.searched,tree.funnel.opened,tree.funnel.submitted,tree.funnel.sessions_without_submit],[0,0,0,0]);
  // الجملة تُحسب لكل كيان لا تُكتب: البذرة تضع 13 مفتاحًا في 13 صفًّا للكيان 36t (والصفوف الـ26 المقيسة في المراجعة هي
  // الكيانان معًا). ما يُحرَّم هو صيغة «26 ميزة»؛ والرقمان يُطبعان كما حُسبا مع حالهما.
  assert.deepEqual([tree.benefits.keys,tree.benefits.rows,tree.benefits.all_draft],[13,13,true]);
  assert.equal(tree.benefits.sentence,'13 مفتاح ميزة في 13 صفًّا، كلها مسودات');
  assert.deepEqual(tree.unavailable.map(g=>g.key),['compliance','finding_time','deflection','usage']);
  for(const gap of tree.unavailable)assert.ok(gap.why&&gap.needs&&gap.owner,`${gap.key}: سبب وما يلزم وعند من`);
  const html=catalogQualityUI.render(board,{e,button,ui}),body=text(html);
  assert.doesNotMatch(html,CSP);
  assert.ok(body.includes('صحة شجرة مركز الخدمات'));
  assert.equal(/\d\s*٪/.test(html),false,'لا نسبة مرسومة');
  assert.equal(body.includes('26 ميزة'),false,'العدد الخاطئ لا يظهر');
  assert.ok(body.includes('13 مفتاح ميزة في 13 صفًّا، كلها مسودات'));
  assert.equal(/\d+ ميزة/.test(body.replace(/مفتاح ميزة/g,'')),false,'لا «N ميزة» بعدد الصفوف');
  for(const gap of tree.unavailable)assert.ok(body.includes(`${gap.label} — غير متاح`),`${gap.key} صفٌّ غير متاح`);
  // القمع يُسمّى بأعداده؛ وكلمة «إغناء» لا ترد إلا في صفّ «غير متاح» الذي يقول لماذا لا تُحسب.
  const funnel=body.slice(body.indexOf('قمع البحث'),body.indexOf('بنود بأقل من ثلاثة مرادفات'));
  assert.ok(funnel.includes('بحوثٌ انتهت بلا تقديم')&&!funnel.includes('إغناء'),'الاسم الصحيح لا «إغناء»');
  assert.ok(body.includes('نسبة إغناء البحث عن الطلب — غير متاح'),'والإغناء صفٌّ غير متاح لا رقم');
  // ولغير الحامل تُرسم الشاشة كما كانت بلا الكتلة.
  assert.equal(catalogQualityUI.render(catalogQualityBoard(db,users.employee),{e,button,ui}).includes('صحة شجرة'),false);
});
