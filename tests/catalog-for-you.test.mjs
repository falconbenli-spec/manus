// «لك» والمواسم والتثبيت (مركز الخدمات، الدفعة الرابعة) — 23 سبتمبر 2026.
//
// ما يحرسه هذا الملف: الصفّ يُخفى كله لمن لا إشارة له ولا يُملأ ببطاقات مخترعة؛ وكل بطاقة تحمل سببها وتنطقه؛ والسرّي
// لا يدخل الصفّ بأي إشارة؛ والدرجة مجموع أوزان مكتوبة تُحسب عند القراءة؛ و«لا تقترح هذه عليّ» يُحفظ ويبقى ويُرجَع عنه
// بلا حدث تدقيق؛ والموسم يعلّم بنوده في نافذته هجريًا وميلاديًا ويرفع شارته خارجها بوزن صفر؛ والتثبيت والمواسم فارغان.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog, CONFIDENTIAL_SERVICES } from '../app/service-catalog.mjs';
import { createRequest } from '../app/workflow.mjs';
import { RANKING, RANKING_NAMES, RANKING_ZERO_REASONS, fillReason, PINS, SEASONS, SEASON_CALENDARS, seasonsAt, seasonFor, MY_TEAM_LENS } from '../app/catalog-tree.mjs';
import { catalogTree, hideSuggestion, setSuggestionsHidden, markSeasons } from '../app/catalog-home.mjs';
import { transition } from '../app/workflow.mjs';
import { leaveTypeName } from '../app/leave.mjs';
import { catalogHome, serviceCard, forYouRow } from '../app/static/catalog-home-ui.mjs';
import { kit } from '../app/static/kit.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=kit(e,ar=>ar);
const ctx={e,ui};
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
const CSP=/<script|\sstyle=|\son[a-z]+=/i;

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-for-you');installServiceCatalog(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const latest=code=>db.prepare("SELECT * FROM services WHERE tenant_id='36t' AND code=? ORDER BY version DESC LIMIT 1").get(code);
  const audits=()=>db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  return {db,users,tx,latest,audits};
}
const reasons=item=>item.for_you.reasons.map(r=>r.key);

test('لك: الصفّ يُخفى كله لمن لا إشارة له، ولا يُملأ ببطاقات مخترعة، والأوزان تصل بأسمائها وصفريها بسببه',t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.employee);
  assert.deepEqual(tree.for_you.items,[]);assert.equal(tree.for_you.hidden_by_me,false);
  const html=catalogHome(tree,ctx);
  assert.equal(html.includes('sc-foryou'),false,'لا صفّ فارغ ولا مخترع');
  assert.deepEqual(tree.for_you.weights.map(w=>w.key),Object.keys(RANKING));
  for(const w of tree.for_you.weights){assert.equal(w.name,RANKING_NAMES[w.key]);assert.equal(w.weight,RANKING[w.key]);}
  // سبب الصفر بأرقامه المقيسة لحظتها (facts في الحمولة)، لا بالنصّ الثابت بمواضعه.
  const usage=tree.for_you.weights.find(w=>w.key==='usage_30d').zero_reason;
  assert.equal(usage,fillReason(RANKING_ZERO_REASONS.usage_30d,tree.facts));
  assert.equal(usage.includes('{'),false,'لا موضع فارغ يصل الشاشة');
  assert.ok(usage.includes(tree.facts.employees)&&usage.includes(`والمكتمل من الطلبات ${tree.facts.completed}`),`السبب بالمقيس: ${usage}`);
  assert.equal(tree.for_you.weights.find(w=>w.key==='seasonal').zero_reason,RANKING_ZERO_REASONS.seasonal);
  assert.equal(RANKING.usage_30d,0);assert.equal(RANKING.seasonal,0);
});

test('لك: المدير يرى عدسة فريقه بسببها، والسرّي لا يدخل الصفّ بأي إشارة، وكل بطاقة تنطق سببها',t=>{
  const {db,users,tx,latest}=fixture(t);
  // طلبٌ سرّي باسم المدير: «طلبتها من قبل» لا يجوز أن يُقرأ على شاشة.
  tx(()=>createRequest(db,users.manager,{service_id:latest('HR-PAYROLL-INQUIRY').id,title:'سرّي تجريبي',payload:{},project_id:null}));
  const tree=catalogTree(db,users.manager);
  const keys=tree.for_you.items.map(i=>i.key);
  for(const code of MY_TEAM_LENS.filter(c=>!CONFIDENTIAL_SERVICES.includes(c)))assert.ok(keys.includes(code),`${code}: من عدسة فريقي`);
  assert.ok(!keys.includes('HR-EXIT-INTERVIEW'),'السرّي في عدسة فريقي لا يدخل');
  assert.ok(!keys.includes('HR-PAYROLL-INQUIRY'),'ولا السرّي المطلوب من قبل');
  assert.ok(tree.for_you.items.length<=6);
  const team=tree.for_you.items.find(i=>i.key==='HR-HIRING-NEED');
  assert.deepEqual(reasons(team),['audience_match']);assert.equal(team.for_you.score,RANKING.audience_match);
  assert.equal(team.for_you.reasons[0].text,'من عدسة فريقي');
  const html=catalogHome(tree,ctx),body=text(html);
  assert.doesNotMatch(html,CSP,'CSP');
  assert.ok(html.includes('class="panel sc-foryou"'));
  assert.ok(html.includes(e('مقترحة لأن: من عدسة فريقي')),'aria-label ينطق السبب');
  assert.ok(body.includes('إدارة المقترحات')&&html.includes(`aria-label="${e('أخفِ طلب احتياج وظيفي من المقترحات')}"`),'إخفاء المقترح مجمّع تحت إدارة المقترحات وباسم البطاقة');
  assert.ok(html.includes('data-action="suggestions-hidden" data-hidden="1"'),'وإخفاء الصفّ كله');
  // الجسم رابطٌ إلى صفحة الخدمة ولا كلمة حالة خام.
  assert.ok(html.includes('href="#services/HR-HIRING-NEED"'));
});

test('لك: «طلبتها مرتين» من استعمالي أنا، و«رصيدك» من دفتر أرصدتي، والدرجة مجموع الأوزان بترتيب الشجرة عند التساوي',t=>{
  const {db,users,tx,latest}=fixture(t);
  const support=latest('IT-SUPPORT');
  // مسودةٌ لم تُقدَّم ليست «طلبتها» (مراجعة 23 سبتمبر): التعريف نفسه في لوح الجودة وفي «سياقك أنت».
  const draft=tx(()=>createRequest(db,users.employee,{service_id:support.id,title:'مسودة تجريبية لا تُقدَّم',payload:{issue:'عطل تجريبي في الشبكة',impact:'استفسار'},project_id:null}));
  assert.equal(catalogTree(db,users.employee).for_you.items.some(i=>i.key==='IT-SUPPORT'),false,'المسودة وحدها لا تجعلها «طلبتها»');
  for(const n of [1,2]){
    const r=tx(()=>createRequest(db,users.employee,{service_id:support.id,title:`دعم تجريبي ${n}`,payload:{issue:'عطل تجريبي في الشبكة',impact:'استفسار'},project_id:null}));
    tx(()=>transition(db,users.employee,r.id,'submit',{version:r.version,note:''}));
  }
  let tree=catalogTree(db,users.employee);
  const used=tree.for_you.items.find(i=>i.key==='IT-SUPPORT');
  assert.ok(draft.id,'والمسودة باقية في «طلباتي» ولا تُعدّ هنا');
  assert.ok(used,'عضو المجموعة يُقترح ببطاقته هو');
  assert.deepEqual(reasons(used),['my_usage']);assert.equal(used.for_you.score,RANKING.my_usage);
  assert.match(used.for_you.reasons[0].text,/^طلبتها مرتين، آخرها \d{4}-\d{2}-\d{2}$/);
  // رصيد إجازة افتتاحي مصطنع في دفتر الأرصدة (تقويم وصفّ رصيد وحركة افتتاحية) لصاحب الحساب وحده.
  const stamp='2026-01-01T00:00:00.000Z';
  db.prepare("INSERT INTO leave_calendars(id,tenant_id,employee_department_id,hr_department_id,name,effective_from,effective_to,weekdays_json,holidays_json,timezone,synthetic,created_at) VALUES('cal-test','36t','creative','hr','تقويم تجريبي','2026-01-01','2026-12-31','[0,1,2,3,4]','[]','Asia/Riyadh',1,?)").run(stamp);
  db.prepare("INSERT INTO leave_balances(id,tenant_id,employee_id,leave_type,balance_year,calendar_id,effective_date,created_at) VALUES('bal-test','36t','employee','annual',2026,'cal-test','2026-01-01',?)").run(stamp);
  db.prepare("INSERT INTO leave_ledger(id,tenant_id,balance_id,request_id,revision,kind,posted_delta,reserved_delta,effective_date,actor_id,reason,evidence,created_at) VALUES('led-test','36t','bal-test',NULL,NULL,'opening',18,0,'2026-01-01','hr','رصيد افتتاحي تجريبي','مصطنع',?)").run(stamp);
  tree=catalogTree(db,users.employee);
  const leave=tree.for_you.items.find(i=>i.key==='VAR-LEAVE');
  assert.ok(leave,'بطاقة الإجازة تُقترح بالرصيد');
  // الرقم نوعًا نوعًا للسنة الجارية، كما تطبعه شاشة الإجازات لكل رصيد — لا مجموعًا عبر الأنواع والسنين (مراجعة 23 سبتمبر).
  assert.deepEqual(reasons(leave),['balance']);assert.equal(leave.for_you.reasons[0].text,`رصيدك لسنة 2026 — ${leaveTypeName('annual')}: 18 يومًا`);
  assert.equal(leave.for_you.score,RANKING.balance);
  // نوعٌ ثانٍ في السنة نفسها، ورصيدٌ لسنةٍ ماضية: يُطبع كل نوعٍ برقمه، والسنة الماضية لا تدخل — ولا يُجمع شيء (58 لا تظهر).
  db.prepare("INSERT INTO leave_balances(id,tenant_id,employee_id,leave_type,balance_year,calendar_id,effective_date,created_at) VALUES('bal-sick','36t','employee','sick',2026,'cal-test','2026-01-01',?)").run(stamp);
  db.prepare("INSERT INTO leave_ledger(id,tenant_id,balance_id,request_id,revision,kind,posted_delta,reserved_delta,effective_date,actor_id,reason,evidence,created_at) VALUES('led-sick','36t','bal-sick',NULL,NULL,'opening',30,0,'2026-01-01','hr','رصيد افتتاحي تجريبي','مصطنع',?)").run(stamp);
  db.prepare("INSERT INTO leave_balances(id,tenant_id,employee_id,leave_type,balance_year,calendar_id,effective_date,created_at) VALUES('bal-old','36t','employee','annual',2025,'cal-test','2025-01-01',?)").run(stamp);
  db.prepare("INSERT INTO leave_ledger(id,tenant_id,balance_id,request_id,revision,kind,posted_delta,reserved_delta,effective_date,actor_id,reason,evidence,created_at) VALUES('led-old','36t','bal-old',NULL,NULL,'opening',10,0,'2025-01-01','hr','رصيد افتتاحي تجريبي','مصطنع',?)").run(stamp);
  const twoTypes=catalogTree(db,users.employee).for_you.items.find(i=>i.key==='VAR-LEAVE').for_you.reasons[0].text;
  assert.ok(twoTypes.includes(`${leaveTypeName('annual')}: 18 يومًا`)&&twoTypes.includes(`${leaveTypeName('sick')}: 30 يومًا`),twoTypes);
  assert.ok(!/58|10 أيام|2025/.test(twoTypes),'لا مجموع ولا سنة ماضية');
  // الترتيب: الأعلى درجةً أولًا، ثم ترتيب الشجرة.
  assert.deepEqual(tree.for_you.items.map(i=>i.key),['IT-SUPPORT','VAR-LEAVE']);
  assert.ok(!tree.for_you.items.some(i=>i.key==='HR-PAYROLL-INQUIRY'));
  // والحساب الآخر لا يرى رصيدي ولا طلباتي.
  assert.deepEqual(catalogTree(db,users.outsider).for_you.items,[]);
});

test('لك: «لا تقترح هذه عليّ» يُحفظ ويبقى بعد إعادة الرسم، و«اقترحها من جديد» يعيدها، وإخفاء الصفّ يُحفظ — كله بلا حدث تدقيق',t=>{
  const {db,users,tx,audits}=fixture(t);
  const before=audits();
  tx(()=>hideSuggestion(db,users.manager,{item_kind:'service',item_key:'HR-HIRING-NEED',hidden:true}));
  let tree=catalogTree(db,users.manager);
  assert.ok(!tree.for_you.items.some(i=>i.key==='HR-HIRING-NEED'),'أُخفيت');
  assert.deepEqual(tree.for_you.dismissed.map(d=>d.key),['HR-HIRING-NEED']);
  let html=catalogHome(tree,ctx);
  assert.ok(html.includes(`aria-label="${e('اقترح طلب احتياج وظيفي من جديد')}"`),'زرّ الرجوع باسم البطاقة');
  assert.equal(catalogTree(db,users.manager).for_you.items.some(i=>i.key==='HR-HIRING-NEED'),false,'تبقى مخفية في قراءة ثانية');
  tx(()=>hideSuggestion(db,users.manager,{item_kind:'service',item_key:'HR-HIRING-NEED',hidden:false}));
  tree=catalogTree(db,users.manager);
  assert.ok(tree.for_you.items.some(i=>i.key==='HR-HIRING-NEED'),'عادت');assert.deepEqual(tree.for_you.dismissed,[]);
  tx(()=>setSuggestionsHidden(db,users.manager,{hidden:true}));
  tree=catalogTree(db,users.manager);
  assert.equal(tree.for_you.hidden_by_me,true);
  html=catalogHome(tree,ctx);
  assert.ok(text(html).includes('المقترحات مخفية بطلبك')&&html.includes('data-action="suggestions-hidden" data-hidden="0"'));
  assert.equal(html.includes('class="panel sc-foryou"'),false);
  tx(()=>setSuggestionsHidden(db,users.manager,{hidden:false}));
  assert.equal(catalogTree(db,users.manager).for_you.hidden_by_me,false);
  assert.equal(audits(),before,'تفضيلٌ شخصي: لا حدث تدقيق');
  assert.throws(()=>tx(()=>hideSuggestion(db,users.manager,{item_kind:'screen',item_key:'x',hidden:true})),error=>!!error.details?.refusal);
  assert.ok(verifyAudit(db));
  assert.doesNotMatch(forYouRow(tree,ctx),CSP);
});

test('المواسم: الموسم يعلّم بنوده في نافذته ويرفع الشارة خارجها، هجريًا وميلاديًا وعبر رأس السنة، ووزنه صفر؛ والتثبيت والمواسم فارغان',t=>{
  const {db,users}=fixture(t);
  assert.deepEqual([PINS.length,SEASONS.length],[0,0],'لا شيء مقرَّر بعد');
  assert.deepEqual(seasonFor(new Date('2026-09-20T06:00:00Z')),[]);
  assert.deepEqual(SEASON_CALENDARS,['gregorian','islamic-umalqura']);
  const ramadan={key:'ramadan',name_ar:'رمضان',calendar:'islamic-umalqura',from:'09-01',to:'09-30',items:['VAR-LEAVE']};
  const yearEnd={key:'year_end',name_ar:'إقفال السنة',calendar:'gregorian',from:'12-15',to:'01-15',items:['FIN-BUDGET-TRANSFER']};
  // رمضان 1447 يقع في أواخر فبراير ومارس 2026 بتقويم أم القرى المحسوب؛ ونافذة ميلادية تعبر رأس السنة.
  assert.deepEqual(seasonsAt('2026-03-01',[ramadan,yearEnd]).map(s=>s.key),['ramadan']);
  assert.deepEqual(seasonsAt('2026-06-01',[ramadan,yearEnd]),[]);
  assert.deepEqual(seasonsAt('2026-12-20',[ramadan,yearEnd]).map(s=>s.key),['year_end']);
  assert.deepEqual(seasonsAt('2027-01-10',[ramadan,yearEnd]).map(s=>s.key),['year_end']);
  assert.deepEqual(seasonsAt('2026-07-01',[{key:'bad',name_ar:'مكسور',calendar:'lunar',from:'01-01',to:'12-31',items:[]}]),[],'تقويمٌ مجهول لا يُقيَّم');
  // البطاقة في نافذة الموسم تحمل شارةً خبرية وتنطقها؛ وخارجها لا شارة. ولا يتحرك ترتيب «لك» بها (الوزن صفر).
  const tree=catalogTree(db,users.employee);
  markSeasons(tree.categories,seasonsAt('2026-03-01',[ramadan]));
  const leave=tree.categories.find(c=>c.key==='my_time').cards.find(i=>i.key==='VAR-LEAVE');
  assert.deepEqual(leave.season,{key:'ramadan',name:'رمضان',until:'09-30',calendar:'islamic-umalqura'});
  const drawn=serviceCard(leave,{e});
  assert.ok(drawn.includes('rq-chip sc-season')&&drawn.includes(e('موسم: رمضان حتى 09-30')),'الشارة ونطقها');
  assert.doesNotMatch(drawn,CSP);
  markSeasons(tree.categories,seasonsAt('2026-06-01',[ramadan]));
  assert.equal(leave.season,null);
  assert.equal(serviceCard(leave,{e}).includes('sc-season'),false,'تُرفع خارج النافذة');
  assert.equal(RANKING.seasonal,0);
});
