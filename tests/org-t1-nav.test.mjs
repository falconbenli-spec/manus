import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { expandDemo, expandPeopleDemo, expandFinanceDemo } from '../scripts/expand-demo.mjs';
import { capabilitiesFor } from '../app/access.mjs';
import { financeCapabilities } from '../app/finance.mjs';
import { placeFor, HUBS, NAV_BUDGET, NAV_CAP, NO_PAGE_DEPARTMENTS, ADMIN_ALT, SECTIONS, SECTION_IDS, SECTION_CAP, SECTION_OF, navSections, sectionGroups, sectionOf } from '../app/static/nav-map.mjs';
import { HUB_VIEWS, HUB_OF, hubLinks, hubPage, composeOperationPage } from '../app/static/hubs-ui.mjs';
import { groupedNavigation, workFrames, dashboardHero, departmentDirectory } from '../app/static/hr-design.mjs';
import { REQUEST_STATUS, ROLE_NAMES } from '../app/static/vocabulary.mjs';
import { kit } from '../app/static/kit.mjs';
import { parseDeepLink, unavailableText, unknownIntentText, BUILTIN_VIEWS } from '../app/static/deep-links.mjs';
import { requestLauncher, requestComposer, launcherResults, catalogBrowser, variantComposer } from '../app/static/request-picker.mjs';

// ت1 (docs/org/nav-mapping.md، «بعد-ب» وب-تنقل-1..5): القائمة الجديدة ومعايير القبول ق-ت1-1..4، على app.mjs الحقيقي في صندوق،
// لكل حساب مصطنع في البذرة وفي expandDemo، وعلى حسابات مصطنعة إضافية تنقل حسابًا قائمًا إلى إدارة أخرى. لا خادم يُشغَّل ولا منفذ يُفتح.
const appSource=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
const BEFORE='37cef8b'; // آخر نسخة من القائمة قبل ت1 (سجل الحالة: اعتماد ت0)

function world(){
  const db=openDb(':memory:');seed(db,'synthetic-org-t1');expandDemo(db,2026);expandPeopleDemo(db,2026);expandFinanceDemo(db,2026);
  const meOf=u=>({...u,password_hash:undefined,can:capabilitiesFor(db,u).list,capabilities:{finance:financeCapabilities(db,u).includes('read')},
    delivery_member:!!(db.prepare('SELECT 1 FROM client_members WHERE user_id=? LIMIT 1').get(u.id)||db.prepare('SELECT 1 FROM project_members WHERE user_id=? LIMIT 1').get(u.id))});
  const users=db.prepare("SELECT * FROM users WHERE tenant_id='36t' ORDER BY id").all();
  const accounts=users.map(u=>[u.id,meOf(u)]);
  // حسابات مصطنعة إضافية: الحساب نفسه بتصاريحه في إدارة أخرى، حتى تُختبر إدارات لا حساب لها في البذرة.
  const byId=Object.fromEntries(accounts);
  for(const [id,base,department] of [['manager@finance','manager','finance'],['manager@hr','manager','hr'],['employee@ops','employee','ops'],['employee@epmo','employee','epmo'],['pm@production','pm','production'],['it@it','it','it']])
    if(byId[base])accounts.push([id,{...byId[base],id:base,department_id:department}]);
  const departments=db.prepare("SELECT id,name FROM departments WHERE tenant_id='36t'").all();
  db.close();
  return {accounts,departments};
}

// الموجّه الحقيقي في صندوق. القائمة تُرسم بـgroupedNavigation الحقيقية، ويُحفظ ما مُرِّر إليها.
async function boot(source,me,{hash='#home',departments=[]}={}){
  const nodes=new Map(),recorded={},replaced=[],posts=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',open:false,dataset:{},classList:{add(){},remove(){}},querySelectorAll(){return [];},querySelector(){return null;},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const reply=payload=>({ok:true,status:200,json:async()=>payload,text:async()=>JSON.stringify(payload)});
  const sandbox={console,URL,Intl,Date,Uint8Array,Event:class{},location:{hash},localStorage:{getItem(){return 'ar';},setItem(){}},crypto:{randomUUID},setTimeout(){},
    history:{replaceState:(a,b,url)=>{replaced.push(url);sandbox.location.hash=url;}},CSS:{escape:value=>String(value)},
    document:{querySelector:node,querySelectorAll:()=>[],documentElement:{dataset:{}},addEventListener(){}},window:{addEventListener(){}},FormData:class{},
    workFrames,dashboardHero,departmentDirectory,REQUEST_STATUS,ROLE_NAMES,kit,parseDeepLink,unavailableText,unknownIntentText,BUILTIN_VIEWS,
    requestLauncher,requestComposer,launcherResults,catalogBrowser,variantComposer,portalPage:()=>'<h1>بوابة الموظف</h1>',brandLogo:'',mountScenes:()=>()=>{},operationModules:{},operationFields:()=>'',money:String,
    placeFor,HUBS,NO_PAGE_DEPARTMENTS,SECTIONS,navSections,sectionGroups,HUB_VIEWS,HUB_OF,hubLinks,hubPage,
    // فرع «الخدمات» يملكه غير هذا الاختبار: رسّاماته بدائل صغيرة، والاختبار عن الموجّه والقائمة.
    catalogSkeleton:()=>'',servicePageSkeleton:()=>'',catalogHome:()=>'<h1>الخدمات</h1>',categoryView:()=>'',journeyLensView:()=>'',journeyRunView:()=>'',servicePageView:()=>'',
    groupedNavigation:(items,...rest)=>{recorded.items=items;recorded.args=rest;return groupedNavigation(items,...rest);},
    fetch:async(path,options={})=>{
      if(options.method==='POST')posts.push([path,options.body]);
      if(path==='/api/me')return reply({user:me,csrf:'test'});
      if(path==='/api/departments')return reply(departments);
      return reply([]);
    }};
  await runInNewContext('(async()=>{'+source.replace(/^import .+;$/gm,'')+';globalThis.ui={render};})()',sandbox);
  await sandbox.ui.render();await setImmediate();
  const items=Array.from(recorded.items??[],i=>Array.from(i));
  return {items,keys:items.map(i=>i[0]),reach:Array.from(sandbox.navReach??[],n=>Array.from(n)),shell:node('#app').innerHTML,main:node('#main').innerHTML,replaced,posts,hash:sandbox.location.hash};
}
// ما كانت القائمة القديمة تصله: app.mjs قبل ت1، بالشروط نفسها، في الصندوق نفسه.
function oldSource(){try{return execFileSync('git',['show',`${BEFORE}:app/static/app.mjs`],{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{return null;}}
const cache=new Map();
async function navOf(id,me,departments){if(!cache.has(id))cache.set(id,await boot(appSource,me,{departments}));return cache.get(id);}
// ت2: الصفوف صارت الأقسام الثمانية، فالمدخل الذي يُبلغ منه الموضعُ صار قسمَ الشاشة. تُحسب الصفوف هنا كما يحسبها
// الغلاف حرفًا بحرف: من «ما يصله الحساب» وصفحة إدارته وحدها، فما يُختبر هو ما يُرسم لا ما يُشتهى.
const doorsOf=(me,departments)=>me.department_id&&!NO_PAGE_DEPARTMENTS.includes(me.department_id)
  ?[[me.department_id,departments.find(d=>d.id===me.department_id)?.name??me.department_id]]:[];
const rowsOf=(nav,me,departments)=>navSections(nav.reach,me,{departments:doorsOf(me,departments)});
// الشاشات التي يضعها placeFor في موضعٍ بعينه عند هذا الحساب. الموضع قرار placeFor ولم يتغيّر بـت2؛ الذي تغيّر
// أين يُقرأ على الشاشة. فالحارس على «من يرى» يبقى على placeFor، والحارس على «أين يقع» ينتقل إلى القسم.
const inHub=(nav,me,hub)=>nav.reach.filter(([key,,label])=>placeFor(key,label,me).hub===hub).map(r=>r[0]);

test('ق-ت1-1: each account gets at most eight section rows, «إدارة المنصة» and «فريقي» keep their audience, and no «أخرى»',async()=>{
  const {accounts,departments}=world();
  assert.ok(accounts.length>=12,`${accounts.length} accounts`);
  for(const [id,me] of accounts){
    const nav=await navOf(id,me,departments),rows=rowsOf(nav,me,departments);
    // الميزانية: صفوف القائمة صارت الأقسام، فالحدّ ثمانية — أشدّ من ميزانية الدور القديمة (8–9) ومن NAV_CAP.
    assert.ok(nav.keys.length<=SECTIONS.length&&nav.keys.length<=SECTION_CAP,`${id} (${me.role}): ${nav.keys.length} rows — ${nav.keys.join(' ')}`);
    assert.ok(nav.keys.length<=NAV_BUDGET[me.role]&&nav.keys.length<=NAV_CAP,`${id} (${me.role}): ${nav.keys.length} rows exceed the old budget too`);
    // «إدارة المنصة» و«فريقي»: الحارس على مَن يراهما لا على أين يقعان. صارا مجموعتين في «الإدارات»، فيُقرأ
    // جمهورهما من placeFor نفسها — وهي التي تقرأ الدور والتصريح، ولم تمسّها ت2.
    assert.equal(inHub(nav,me,'admin').length>0,me.role==='admin',`${id}: «إدارة المنصة» audience`);
    assert.equal(inHub(nav,me,'team').length>0,me.role==='manager',`${id}: «فريقي» audience`);
    // وما لم يُنقَل باستثناءٍ مكتوب من هذين الموضعين يُقرأ في «الإدارات» وحدها، فلا يتناثر ولا يختفي. والاستثناءات
    // مقصودة ومسجَّلة في SECTION_OF: شاشات إعداد الخدمات تُقرأ في «الخدمات» («دليل الخدمات» و«الطلبات الواردة»
    // وأخواتها)، و«نطاق المنصة» في «التقارير» — فهي أدوات إعدادٍ وتقارير عند قارئها، لا إدارةَ منصةٍ ولا فريقًا.
    for(const hub of ['admin','team'])for(const key of inHub(nav,me,hub).filter(k=>!Object.hasOwn(SECTION_OF,k)))
      assert.equal(sectionOf(key,nav.reach.find(r=>r[0]===key)[2],me).section,'departments',`${id}: ${key} (${hub}) left «الإدارات»`);
    assert.ok(!nav.shell.includes('أخرى'),`${id}: no «أخرى» group`);
    // ولا شاشة بلا قسم: هذا «لا أخرى» بمعناه الجديد — ما لا مجموعة تسمّيه يُسرد بلا عنوان، ولا يسقط في سلّة مسمّاة.
    for(const [key,,label] of nav.reach)assert.ok(sectionOf(key,label,me).section,`${id}: ${key} has no section`);
    // الترتيب الثابت: ترتيب الأقسام في موجز المالك. تُحذف الأقسام ولا تُقدَّم ولا تُؤخَّر.
    const at=rows.map(r=>SECTION_IDS.indexOf(r.id));
    assert.ok(at.every(i=>i>=0)&&at.every((v,i)=>!i||at[i-1]<v),`${id}: order ${rows.map(r=>r.id).join(' ')}`);
    assert.deepEqual(nav.keys,rows.map(r=>r.route),`${id}: the shell draws exactly the section rows`);
    // «الإدارات»: صفحة إدارة الحساب وحدها (بعد-ب) ولا صفحة لإدارة بلا صفحة. انتقلت من صفٍّ في الشريط إلى بندٍ
    // في قسم «الإدارات»، والدعوى هي هي: بابٌ واحد إلى إدارته، ولا باب إلى إدارة غيره.
    const depts=(rows.find(r=>r.id==='departments')?.entries??[]).map(x=>x.key).filter(k=>k.startsWith('departments/'));
    assert.deepEqual(depts,me.department_id&&!NO_PAGE_DEPARTMENTS.includes(me.department_id)?[`departments/${me.department_id}`]:[],id);
  }
  // الفاصل <hr class="nav-sep"> كان يفصل صفَّ «إدارة المنصة» عمّا فوقه، ولا صفَّ له اليوم فلا موضوع للدعوى.
  // ما كان يحرسه — أن إدارة المنصة للأدمن وحده — محروسٌ أعلاه على placeFor، وهو أمتن من فاصلٍ بصري.
  assert.doesNotMatch(appSource,/a\[href="#notifications"\]/,'no badge is attached to the notifications entry');
});

test('ق-ت1-2: every screen the old menu reached is still reached, and has a place the account can open from its menu (or is tagged internal with a reason)',async t=>{
  const {accounts,departments}=world(),old=oldSource();
  // بلا تاريخ Git يفشل الاختبار، إلا حين يُطلب التخطي صراحةً بـALLOW_NO_GIT_HISTORY=1 (فتبقى مقارنة المواضع وحدها).
  if(!old){assert.equal(process.env.ALLOW_NO_GIT_HISTORY,'1',`git history unavailable (${BEFORE}): the old-menu comparison cannot run; set ALLOW_NO_GIT_HISTORY=1 to skip it`);t.diagnostic('ALLOW_NO_GIT_HISTORY=1: the old-menu comparison is skipped, the place check still runs');}
  for(const [id,me] of accounts){
    const nav=await navOf(id,me,departments),reach=new Map(nav.reach.map(r=>[r[0],r]));
    if(old){
      const before=await boot(old,me,{departments});
      // مفتاحٌ يحوّله ROUTE_ALIASES إلى وجهة ما زالت في المتناول ليس مفقودًا: ‎#catalog‎ لكل حساب غير
      // الأدمن يفتح ‎#services‎ نفسها، فكان المدخلان بابين إلى شاشة واحدة (حُذف أحدهما في 29 سبتمبر 2026).
      const aliased=key=>key==='catalog'&&me.role!=='admin'?'services':key;
      // وحذفٌ متعمَّد يُسجَّل هنا بسببه ولا يمرّ صامتًا. هذا هو الفرق بين قرار وبين سهو.
      const REMOVED={inbox:'استُبدل مدخل «بانتظار إجرائي» بمدخل «عملي» الذي يجمع القرارات والردود والمهام في وجهة يومية واحدة. بقي المسار القديم مسجّلًا للروابط المحفوظة، لكنه لم يعد صفًا مكررًا في التنقل (1 أكتوبر 2026).',
        appearance:'المظهر متاح دائمًا من قسم الحساب في القائمة نفسها؛ إزالة صفه المستقل تفسح مكانًا لبوابة الموظف من دون إخفاء أي اختيار أو تغيير صلاحية.',
        compensation:'«زياداتي»: نصّ الشاشة نفسه يقول «لا يرى أحد مقترحًا يخصه»، فالمدخل يَعِد '
        +'الموظف بما تمنعه قاعدتها. الزيادة تصله في نسخة عقده الجديدة ويقرؤها في «عقدي وراتبي». '
        +'بقي المدخل لمن يحمل hr.compensation.review، والشاشة نفسها لم تُقفل ولم يتغيّر تصريحها (29 سبتمبر 2026).'};
      const missing=before.keys.filter(k=>!reach.has(aliased(k))&&!Object.hasOwn(REMOVED,k));
      assert.deepEqual(missing,[],`${id}: the old menu reached these and the new reach lost them`);
      for(const key of Object.keys(REMOVED))assert.ok(REMOVED[key].length>80,`${key}: a deliberate removal needs a written reason`);
      // والإضافة المتعمَّدة بعد ت1 تُسجَّل كذلك بسببها وتصريحها: شاشةٌ جديدة بقرار منتج مسجَّل، لا قرار وصول من ت1.
      // ما لم يُسجَّل هنا يسقط كما كان — الفرق بين شاشة أُضيفت بقرار وبين باب انفتح سهوًا.
      const projects=me=>me.can.includes('projects.use');
      const ADDED={
        portal:{when:me=>me.can.includes('portal.use'),reason:'«بوابة الموظف»: وجهة شخصية مستقلة تجمع الطلبات والمهام وكل خدمات الدليل المسموحة للحساب وتفتح نموذج الطلب الموحد، ولا توسع الصلاحيات لأن مصدرها إسقاط الدليل نفسه.'},
        'hr-operations':{when:me=>me.can.includes('hr.operations.use'),reason:'«مركز عمليات الموارد البشرية»: شاشة موحدة تجمع وحدات الموارد البشرية القائمة وتضيف قاموس الكفاءات وخطط تحسين الأداء والاستبانات العامة، ولا تظهر إلا لحامل hr.operations.use وهو شرط الخادم نفسه.'},
                'project-participation':{when:projects,reason:'«مشاركة الإدارات»: شاشة المالك نفسه (الالتزام c88545c، الترحيل 142) لطلب مشاركة إدارة أخرى '
          +'وقرار رئيسها، لحامل projects.use. تفتح ما يفتحه تصريحه من قبل: مشاريعه التي هو عضو فيها، لا مشروعًا غيرها.'},
        'project-spine':{when:projects,reason:'«مسار المشاريع»: الموجة 5 «سلسلة المشروع» في خطة التغيير المعتمدة — مراحل المشروع الثمان والخطوة الجاية '
          +'وعند مين، وحزم العمل بأزرار القارئ. لحامل projects.use، على مشاريعه التي هو عضو فيها وحدها، وما يقبله الخادم من أزرارها.'},
        'finance-exceptions':{when:me=>me.can.includes('finance.use')&&!!me.capabilities?.finance,reason:'«الاستثناءات المالية»: الحزمة 3 من عقد التنفيذ — '
          +'طابور محسوب من مصادره (فاتورة موقوفة، سطر كشف بلا قرار، مستند بلا قيد) لمن يقرأ الدفتر، وهو شرط الخادم نفسه؛ الشاشة كانت مبنية بلا مدخل.'},
        'options':{when:me=>['vendors.manage','vendors.bank','finance.use','finance.close.manage','procurement.use'].some(c=>me.can.includes(c))||(me.admin_level==='super'&&!me.view_as),
          reason:'«الخيارات والقيم المعتمدة»: القيم التي تقف المنصة عندها حتى يقررها صاحبها (مهلة إعادة الإقفال، أيام التهدئة، سقف أول دفعة) '
          +'ما كان لها مسار ولا شاشة، فلا تُقرَّر أبدًا. لمن يحمل تصريح قيمة أو قائمة، وهو شرط canSeeOptions في الخادم.'},
        'payroll-parallel':{when:me=>['payroll.prepare','payroll.review','payroll.approve'].some(c=>me.can.includes(c)),reason:'«المسير الموازي»: الحزمة 4 (P4-HR-5، الترحيل 176) — '
          +'الشهور التي يدفعها النظام السابق وتحسبها المنصة وتقارنها بندًا بندًا، وتفسير كل فرق بشخص ثانٍ، وقرار الانتقال إلى الدفع من المنصة بشخصين. لحاملي تصاريح الرواتب، وهو شرط الخادم نفسه.'},
        'client-support':{when:me=>['manager','pm'].includes(me.role)||(me.role==='employee'&&me.delivery_member!==false),
          reason:'«دعم العملاء»: الحزمة 4 (P4-CRM-5، الترحيل 184) — بلاغ العميل وتصعيده سجلٌّ على العميل والصفقة بمهلته، بدل طلبين نصيين في الدليل. '
          +'مدخله بشرط «العملاء» نفسه (فريق حساب عميل)، والخادم يحصر ما يراه كل حساب بعضويته في فريق الحساب، فلا يفتح ملف عميل لم يكن يراه.'},
        'platform-health':{when:me=>me.can.includes('platform.flags'),reason:'«مركز تشغيل المنصة»: شاشة تشغيلية مجمعة للأدمن تعرض أدلة البناء والترحيل والنسخ والتدقيق والطوابير والتكاملات دون بيانات أفراد أو مؤشرات أعمال، ولا تظهر إلا لحامل platform.flags وهو شرط الخادم نفسه.'}};
      for(const key of Object.keys(ADDED))assert.ok(ADDED[key].reason.length>80,`${key}: a deliberate addition needs a written reason`);
      // الزيادة الوحيدة المقصودة من ت1 نفسها: باب «الخدمات» للموظف العادي.
      const added=[...reach.keys()].filter(k=>!before.keys.includes(k)&&!(Object.hasOwn(ADDED,k)&&ADDED[k].when(me)));
      assert.deepEqual(added,me.role==='employee'&&me.can.includes('requests.use')?['services']:[],`${id}: T1 makes no new access decision`);
      // ملاحظة: الحذف المُعلَّل أعلاه قرار منتج لاحق على ت1، لا قرار وصول من ت1 نفسها — الشاشة تبقى
      // مفتوحة بمسارها وتصريحها، والمحذوف مدخلُ قائمةٍ يَعِد بما لا تعطيه.
    }
    // ت2: الدعوى هي هي — كل شاشة يبلغها الحساب لها موضعٌ يفتحه من قائمته — والموضع اليوم قسمُها. ما تغيّر أن
    // الباب كان صفًّا لكل موضع وصار صفًّا لكل قسم؛ وما بقي أن يُفتح كلُّ ما يُبلغ من القائمة لا بالرابط وحده.
    const rows=rowsOf(nav,me,departments);
    for(const [key,,label] of reach.values()){
      const place=placeFor(key,label,me);
      // الموضع internal يبقى موضعًا بلا مدخل، وسببه مكتوب في nav-map كما كان.
      if(place.hub==='internal')assert.equal(ADMIN_ALT[key]?.[1],'internal',`${id}: ${key} is internal without a reason in nav-map`);
      if(place.hub==='dept')assert.ok(place.dept&&!NO_PAGE_DEPARTMENTS.includes(place.dept),`${id}: ${key} placed on a department without a page`);
      const {section}=sectionOf(key,label,me);
      assert.ok(section,`${id}: ${key} has no section`);
      const row=rows.find(r=>r.id===section);
      assert.ok(row,`${id}: ${key} is placed in «${section}» and the account has no such row`);
      // والقسم ذو الشاشة الواحدة صفٌّ يقودها، فبابها صفُّها نفسه.
      assert.ok(row.single?row.route===key:row.entries.some(x=>x.key===key),`${id}: ${key} is not listed under «${row.label}»`);
    }
  }
});

test('ق-ت1-3: each old route resolves to its new home, the address shows it, and the deep link still opens the launcher',async()=>{
  const {accounts,departments}=world(),me=Object.fromEntries(accounts);
  const go=async(who,hash)=>boot(appSource,me[who],{hash,departments});
  const catalog=await go('employee','#catalog');
  assert.deepEqual(catalog.replaced,['#services']);assert.match(catalog.main,/<h1>الخدمات<\/h1>/);
  const portal=await go('employee','#portal');
  assert.deepEqual(portal.replaced,[]);assert.match(portal.main,/<h1>بوابة الموظف<\/h1>/);
  const departmentsList=await go('manager','#departments');
  // #departments ← #services/department: عدسة الإدارة لهذا الرسم وحده، ثم يعود العنوان إلى #services. التنقل لا يكتب تفضيل العدسة.
  assert.deepEqual(departmentsList.replaced,['#services/department','#services']);
  assert.deepEqual(departmentsList.posts,[],'navigating to #departments writes nothing');
  const page=await go('manager','#departments/creative');
  assert.deepEqual(page.replaced,[],'a department page keeps its route');
  const focused=await go('employee','#catalog?focus=abc');
  assert.equal(focused.replaced[0],'#services?focus=abc','the query travels with the alias');
  // #catalog/new: النية تُنفَّذ (نافذة الطلب) والعنوان يعود إلى «الخدمات».
  const launcher=await go('employee','#catalog/new');
  assert.equal(launcher.hash,'#services');assert.ok(!launcher.replaced.some(u=>u.startsWith('#catalog')),launcher.replaced.join(' '));
  // «دليل الخدمات» عند الأدمن شاشة إعداد الخدمات، لا «طلب خدمة»: تبقى.
  const admin=await go('admin','#catalog');
  assert.deepEqual(admin.replaced,[]);
  // كل مسار قديم آخر يبقى كما هو.
  for(const hash of ['#leave','#work','#requests','#employees','#org'])assert.deepEqual((await go('manager',hash)).replaced,[],hash);
});

test('ق-ت1-4: a screen seen by more than one role keeps one label per lens, and pages take their title from it',async()=>{
  const {accounts,departments}=world(),labels=new Map();
  for(const [id,me] of accounts){
    const nav=await navOf(id,me,departments);
    for(const [key,,label] of nav.reach){
      const place=placeFor(key,label,me),lens=`${key}|${place.hub}|${place.dept??''}`;
      if(!labels.has(lens))labels.set(lens,new Map());
      labels.get(lens).set(place.label,[...(labels.get(lens).get(place.label)??[]),`${id}:${me.role}`]);
    }
  }
  const split=[...labels].filter(([,m])=>m.size>1).map(([lens,m])=>`${lens} → ${[...m].map(([l,who])=>`${l} (${who.join(',')})`).join(' / ')}`);
  assert.deepEqual(split,[]);
  // العنوان من placeFor لا من مدخل القائمة: «إجازاتي» للموظفة، و«إجازات فريقي» للمدير — وكلاهما بلا مدخل في القائمة.
  assert.match(appSource,/const heading=screenTitle\(view\)\|\|/);
  const leave={title:'الإجازات والأرصدة',description:'وصف',load:async()=>({}),render:()=>'<p>الإجازات</p>'};
  for(const [who,title] of [['employee','إجازاتي'],['manager','إجازات فريقي'],['hr','إجازات الموظفين']]){
    const me=Object.fromEntries(accounts)[who];
    const sandboxed=await bootModules(appSource.replace(/^import .+;$/gm,''),me,'#leave',{leave},departments);
    assert.match(sandboxed.main,new RegExp(`<h1>${title}</h1>`),who);
  }
});

// الموجّه نفسه مع وحدات مسجلة (operationModules) لشاشات بعينها.
async function bootModules(source,me,hash,modules,departments){
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',open:false,dataset:{},classList:{add(){},remove(){}},querySelectorAll(){return [];},querySelector(){return null;},showModal(){},close(){}});return nodes.get(id);};
  const reply=payload=>({ok:true,status:200,json:async()=>payload,text:async()=>JSON.stringify(payload)});
  const sandbox={console,URL,Intl,Date,Uint8Array,Event:class{},location:{hash},localStorage:{getItem(){return 'ar';},setItem(){}},crypto:{randomUUID},setTimeout(){},
    history:{replaceState(){}},CSS:{escape:String},document:{querySelector:node,querySelectorAll:()=>[],documentElement:{dataset:{}},addEventListener(){}},window:{addEventListener(){}},FormData:class{},
    workFrames,dashboardHero,departmentDirectory,REQUEST_STATUS,ROLE_NAMES,kit,parseDeepLink,unavailableText,unknownIntentText,BUILTIN_VIEWS,groupedNavigation,
    requestLauncher,requestComposer,launcherResults,catalogBrowser,variantComposer,brandLogo:'',mountScenes:()=>()=>{},operationModules:modules,operationFields:()=>'',money:String,
    placeFor,HUBS,NO_PAGE_DEPARTMENTS,SECTIONS,navSections,sectionGroups,HUB_VIEWS,HUB_OF,hubLinks,hubPage,composeOperationPage,
    fetch:async path=>reply(path==='/api/me'?{user:me,csrf:'test'}:path==='/api/departments'?departments:[])};
  await runInNewContext('(async()=>{'+source+';globalThis.ui={render};})()',sandbox);
  await sandbox.ui.render();await setImmediate();
  return {main:node('#main').innerHTML,shell:node('#app').innerHTML};
}

test('hubs: «فريقي» و«المنظمة» و«إدارة المنصة» list every placed screen, and «ملفي» keeps five clear groups after its main content',async()=>{
  const {accounts,departments}=world(),me=Object.fromEntries(accounts);
  const placed=(who,hub)=>{const reach=cache.get(who)?.reach??[];return reach.filter(([key,,label])=>placeFor(key,label,me[who]).hub===hub&&HUBS[hub]?.route!==key).map(r=>r[0]);};
  for(const who of ['manager','admin','employee'])await navOf(who,me[who],departments);
  for(const [who,view,hub] of [['manager','#team','team'],['manager','#organization','org'],['admin','#platform','admin'],['employee','#organization','org']]){
    const page=await boot(appSource,me[who],{hash:view,departments});
    const keys=placed(who,hub);
    assert.ok(keys.length,`${who} has screens in ${hub}`);
    for(const key of keys)assert.ok(page.main.includes(`href="#${key}"`),`${who} ${view} lacks #${key}`);
    assert.match(page.main,/<h2>/,'grouped under headings');
    assert.match(page.main,/class="glyph is-directional"/,'the forward chevron is mirrored in RTL');
    assert.ok(!/\bundefined\b/.test(page.main.replace(/<[^>]+>/g,' ')),view);
  }
  // من لا شاشة له في الموضع يُقال له ذلك، ولا رابط ميت.
  const empty=await boot(appSource,me.employee,{hash:'#team',departments});
  assert.match(empty.main,/لا شاشة لحسابك في هذا القسم/);
  // «ملفي»: المحتوى الأساسي أولًا، ثم خمسة أقسام واضحة بدل قائمة طويلة متكررة.
  const profile=await bootModules(appSource.replace(/^import .+;$/gm,''),me.employee,'#profile',{profile:{title:'ملفي',description:'وصف',load:async()=>({}),render:()=>'<section class="vn-head">الملف</section>'}},departments);
  const links=profile.main.indexOf('class="hub-links"'),content=profile.main.indexOf('vn-head');
  assert.ok(content>0&&content<links,'the profile content comes before the section links');
  for(const section of ['العقد والراتب والمزايا','الوقت والإجازات','الأداء والتطوير','الدعم وإعدادات الحساب'])assert.ok(profile.main.includes(section),`«ملفي» lacks «${section}»`);
  assert.match(profile.main,/href="#payroll"/);assert.match(profile.main,/href="#security"/);
  // الوجهة اليومية موحّدة: #work في الوصول، ولا صفّ #inbox مكرر في القائمة.
  assert.ok(cache.get('employee').reach.some(([key])=>key==='work'));
  assert.equal(cache.get('employee').reach.some(([key])=>key==='inbox'),false);
  // القائمة: معلم nav مسمّى، والصفُّ الحالي aria-current="page"، وصفُّ قسم الشاشة aria-current="true".
  // ت2: «ملفي» لم يعد صفًّا — الصفوف أقسامٌ ثمانية — فالصفُّ الحالي يُختبر على قسمٍ مفتوح، وعلامةُ الأبوّة
  // على القسم الذي تسكنه الشاشة. الدعويان باقيتان: أين أنا الآن، وتحت أي صفٍّ تقع شاشةٌ بلا صفّ.
  assert.match(profile.shell,/<nav class="nav" aria-label="التنقل الرئيسي">/);
  const workSection=await bootModules(appSource.replace(/^import .+;$/gm,''),me.employee,'#section/work',{},departments);
  assert.match(workSection.shell,/<a href="#section\/work" class="active" aria-current="page">/,'the open section marks itself');
  assert.match(profile.shell,/<a href="#section\/work" class="active" aria-current="true">/,'#profile lives under «أعمالي»');
  const leave=await bootModules(appSource.replace(/^import .+;$/gm,''),me.employee,'#leave',{leave:{title:'الإجازات',description:'وصف',load:async()=>({}),render:()=>''}},departments);
  assert.match(leave.shell,/<a href="#section\/work" class="active" aria-current="true">/,'#leave lives under «أعمالي»');
  // كل شاشة يصلها الحساب في كتلة البحث المخفية، فلا تضيع شاشة بلا مدخل.
  for(const [key] of cache.get('employee').reach)assert.ok(profile.shell.includes(`href="#${key}"`),`search lacks #${key}`);
  assert.match(profile.shell,/<div class="nav-reach" data-nav-reach hidden>/);
});

test('globals: the reach list and the account are published for the department page, and the shell keeps every old condition',async()=>{
  const {accounts,departments}=world(),me=Object.fromEntries(accounts);
  const nav=await navOf('manager',me.manager,departments);
  assert.ok(nav.reach.every(r=>typeof r[0]==='string'&&typeof r[2]==='string'),'[key, icon, oldLabel, en]');
  assert.match(appSource,/globalThis\.navReach=nav;globalThis\.navMe=me;/);
  // الأدوات التي تضعها placeFor في صفحة إدارة هي في navReach، فتقرؤها صفحة الإدارة («أدوات الإدارة»).
  const deptTools=nav.reach.filter(([key,,label])=>placeFor(key,label,me.manager).hub==='dept');
  assert.ok(deptTools.length>5,`${deptTools.length} department tools for the manager`);
  // الباب الوحيد الذي انعكس: «الخدمات» لكل من يحمل requests.use.
  assert.match(appSource,/if\(has\('requests\.use'\)\)nav\.push\(\['services'/);
});
