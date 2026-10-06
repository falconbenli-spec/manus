import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { expandDemo, expandPeopleDemo, expandFinanceDemo } from '../scripts/expand-demo.mjs';
import { capabilitiesFor } from '../app/access.mjs';
import { financeCapabilities } from '../app/finance.mjs';
import { placeFor, HUBS, NAV_DEST, NO_PAGE_DEPARTMENTS, SECTIONS, SECTION_IDS, SECTION_CAP, SECTION_GROUPS, SECTION_GROUP_MIN, SECTION_OF, DEPT_SECTION, HUB_SECTION, sectionOf, sectionGroups, navSections, screensWithoutSection } from '../app/static/nav-map.mjs';
import { HUB_VIEWS, HUB_OF, hubLinks, hubPage } from '../app/static/hubs-ui.mjs';
import { groupedNavigation, navGlyph, workFrames, dashboardHero, departmentDirectory } from '../app/static/hr-design.mjs';
import { REQUEST_STATUS, ROLE_NAMES } from '../app/static/vocabulary.mjs';
import { kit } from '../app/static/kit.mjs';
import { parseDeepLink, unavailableText, unknownIntentText, resolveLink, BUILTIN_VIEWS, SUBROUTED_VIEWS } from '../app/static/deep-links.mjs';
import { operationModules } from '../app/static/operations.mjs';
import { requestLauncher, requestComposer, launcherResults, catalogBrowser, variantComposer } from '../app/static/request-picker.mjs';

// أقسام التنقل الثمانية (موجز المالك 30 سبتمبر 2026، البند 6) وقرار خطة التغيير: عشرة صفوف على الأكثر، ولا مجموعة
// بأقل من بندين، ولا شاشة تسقط في «أخرى». يُقاس على app.mjs الحقيقي في صندوق: القائمة تُبنى من «ما يصله الحساب»
// (navReach) فلا يُخترع تصريح ولا يُفترض وصول. بيانات مصطنعة وحدها، ولا خادم يُشغَّل ولا منفذ يُفتح.
const appSource=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
const screens=new Set([...Object.keys(operationModules),...BUILTIN_VIEWS]);

function world(){
  const db=openDb(':memory:');seed(db,'synthetic-nav-sections');expandDemo(db,2026);expandPeopleDemo(db,2026);expandFinanceDemo(db,2026);
  const meOf=u=>({...u,password_hash:undefined,can:capabilitiesFor(db,u).list,capabilities:{finance:financeCapabilities(db,u).includes('read')},
    delivery_member:!!(db.prepare('SELECT 1 FROM client_members WHERE user_id=? LIMIT 1').get(u.id)||db.prepare('SELECT 1 FROM project_members WHERE user_id=? LIMIT 1').get(u.id))});
  const users=db.prepare("SELECT * FROM users WHERE tenant_id='36t' ORDER BY id").all();
  const accounts=users.map(u=>[u.id,meOf(u)]);
  // حسابات مصطنعة إضافية: الحساب نفسه بتصاريحه في إدارة أخرى، حتى تُختبر أقسام إدارات لا حساب لها في البذرة.
  const byId=Object.fromEntries(accounts);
  for(const [id,base,department] of [['manager@finance','manager','finance'],['manager@hr','manager','hr'],['pm@production','pm','production'],
    ['pm@epmo','pm','epmo'],['employee@accounts','employee','accounts'],['employee@grc','employee','grc'],['it@procurement','it','procurement']])
    if(byId[base])accounts.push([id,{...byId[base],id,department_id:department}]);
  const departments=db.prepare("SELECT id,name FROM departments WHERE tenant_id='36t'").all();
  db.close();
  return {accounts,departments};
}

// الموجّه الحقيقي في صندوق، كما في tests/org-t1-nav.test.mjs: يعيد navReach — الشاشات التي يبلغها الحساب اليوم.
async function boot(me,{hash='#home',departments=[]}={}){
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',open:false,dataset:{},classList:{add(){},remove(){}},querySelectorAll(){return [];},querySelector(){return null;},showModal(){},close(){}});return nodes.get(id);};
  const reply=payload=>({ok:true,status:200,json:async()=>payload,text:async()=>JSON.stringify(payload)});
  const sandbox={console,URL,Intl,Date,Uint8Array,Event:class{},location:{hash},localStorage:{getItem(){return 'ar';},setItem(){}},crypto:{randomUUID},setTimeout(){},
    history:{replaceState:(a,b,url)=>{sandbox.location.hash=url;}},CSS:{escape:String},
    document:{querySelector:node,querySelectorAll:()=>[],documentElement:{dataset:{}},addEventListener(){}},window:{addEventListener(){}},FormData:class{},
    workFrames,dashboardHero,departmentDirectory,REQUEST_STATUS,ROLE_NAMES,kit,parseDeepLink,unavailableText,unknownIntentText,BUILTIN_VIEWS,groupedNavigation,
    requestLauncher,requestComposer,launcherResults,catalogBrowser,variantComposer,brandLogo:'',mountScenes:()=>()=>{},operationModules:{},operationFields:()=>'',money:String,
    placeFor,HUBS,NO_PAGE_DEPARTMENTS,SECTIONS,navSections,sectionGroups,HUB_VIEWS,HUB_OF,hubLinks,hubPage,
    catalogSkeleton:()=>'',servicePageSkeleton:()=>'',catalogHome:()=>'',categoryView:()=>'',journeyLensView:()=>'',journeyRunView:()=>'',servicePageView:()=>'',
    fetch:async path=>reply(path==='/api/me'?{user:me,csrf:'test'}:path==='/api/departments'?departments:[])};
  await runInNewContext('(async()=>{'+appSource.replace(/^import .+;$/gm,'')+';globalThis.ui={render};})()',sandbox);
  await sandbox.ui.render();await setImmediate();
  return Array.from(sandbox.navReach??[],n=>Array.from(n));
}
// صفحة الإدارة التي يفتحها الحساب: إدارته وحدها (قرار «بعد-ب»)، ولا صفحة لإدارة بلا صفحة.
const doorsOf=(me,departments)=>me.department_id&&!NO_PAGE_DEPARTMENTS.includes(me.department_id)
  ?[[me.department_id,departments.find(d=>d.id===me.department_id)?.name??me.department_id]]:[];
const cache=new Map();
async function rowsOf(id,me,departments){
  if(!cache.has(id)){const reach=await boot(me,{departments});cache.set(id,{reach,rows:navSections(reach,me,{departments:doorsOf(me,departments)})});}
  return cache.get(id);
}

test('الأقسام الثمانية: أسماء المالك وترتيبه، وسجلٌّ لا يضع مفتاحًا في مجموعتين ولا يسمّي قسمًا غير الثمانية',()=>{
  // البند 6 من الموجز حرفًا بحرف. الأسماء نصّ واجهة يقرؤه الموظف، فلا تُبدَّل ولا تُشتق من بيانات.
  assert.deepEqual(SECTIONS.map(s=>s.label),['الرئيسية','أعمالي','الإدارات','المشاريع','العملاء','المالية','الخدمات','التقارير']);
  assert.deepEqual(SECTION_IDS,['home','work','departments','projects','clients','finance','services','reports']);
  assert.equal(SECTIONS[0].id,'home','«الرئيسية» أول الأقسام');
  for(const s of SECTIONS){
    assert.ok(s.label_en&&s.glyph&&s.route,`${s.id}: كل قسم له تسمية إنجليزية ورمز ومسار`);
    assert.ok(s.id==='home'?s.route==='home':s.route===`section/${s.id}`,`${s.id}: مسار القسم`);
  }
  // ولكل قسم رمزه: سبعة من الثمانية تشترك في الرأس «section»، فمن قرأ الرأس وحده أعطاها رمزًا واحدًا وصارت
  // القائمة صفًّا مكرّرًا لا يميّزه القارئ إلا بالنص. الدعوى على ما يُرسم فعلًا (navGlyph) لا على السجل.
  const glyphs=SECTIONS.map(s=>{const g=navGlyph(s.route);return `${g.tint}|${g.svg}`;});
  assert.equal(new Set(glyphs).size,SECTIONS.length,'الأقسام الثمانية تتشارك رمزًا: '+SECTIONS.map((s,i)=>s.label+'='+glyphs[i].split('|')[0]).join(' '));
  for(const s of SECTIONS)assert.ok(navGlyph(s.route).svg,`${s.id}: رمز فارغ`);
  // كل قسم يُشار إليه في الخرائط الثلاث قسمٌ من الثمانية، فلا اسم قسم تاسع يتسرب.
  for(const [name,map] of [['SECTION_OF',SECTION_OF],['DEPT_SECTION',DEPT_SECTION],['HUB_SECTION',HUB_SECTION]])
    for(const [key,section] of Object.entries(map))assert.ok(SECTION_IDS.includes(section),`${name}.${key} → «${section}» ليس قسمًا من الثمانية`);
  // كل إدارة يذكرها سجل الوجهات لها قسم، فلا أداة تُنسب إلى إدارة بلا قسم.
  for(const [key,d] of Object.entries(NAV_DEST))
    if(d.dept&&d.dept!=='*own')assert.ok(Object.hasOwn(DEPT_SECTION,d.dept),`${key}: الإدارة «${d.dept}» بلا قسم في DEPT_SECTION`);
  // مجموعات القسم: كل مفتاح فيها شاشة مسجلة، ولا يرد مفتاح مرتين في القسم نفسه (وإلا ظهر الرابط مرتين في صفحة واحدة).
  for(const [section,groups] of Object.entries(SECTION_GROUPS)){
    assert.ok(SECTION_IDS.includes(section),`SECTION_GROUPS.${section} ليس قسمًا من الثمانية`);
    const seen=new Map();
    for(const [ar,en,keys] of groups){
      assert.ok(ar&&en,`${section}: كل مجموعة لها عنوان بالعربية والإنجليزية`);
      assert.notEqual(ar,'أخرى',`${section}: لا مجموعة باسم «أخرى»`);
      for(const key of keys){
        assert.ok(Object.hasOwn(NAV_DEST,key),`${section}/${ar}: «${key}» ليست في سجل الوجهات`);
        assert.ok(!seen.has(key),`${section}: «${key}» في «${ar}» و«${seen.get(key)}»`);
        seen.set(key,ar);
      }
    }
  }
});

test('كل شاشة يبلغها الحساب لها قسم واحد، والقسم يصل شاشةً مسجلة، وما لا قسم له يُسمّى لا يُخفى',async()=>{
  const {accounts,departments}=world();
  assert.ok(accounts.length>=12,`${accounts.length} حساب مصطنع`);
  for(const [id,me] of accounts){
    const {reach,rows}=await rowsOf(id,me,departments);
    // ولا شاشة تسقط في «أخرى» صامتة: القائمة فارغة، وغير ذلك يُقرأ هنا بأسماء الشاشات.
    assert.deepEqual(screensWithoutSection(reach,me),[],`${id}: شاشات يبلغها الحساب ولا قسم لها`);
    // كل شاشة في قسم واحد: رابطان لوجهة واحدة في قسمين يجعلان «أين أجدها؟» سؤالًا بجوابين.
    const where=new Map();
    for(const row of rows)for(const entry of row.entries){
      assert.ok(!where.has(entry.key),`${id}: «${entry.key}» في «${row.label}» و«${where.get(entry.key)}»`);
      where.set(entry.key,row.label);
    }
    // ولا بند بلا وجهة: كل رابط يصل شاشة مسجلة (سجل الوحدات + BUILTIN_VIEWS)، وصفحة الإدارة مسارٌ فرعي مسجَّل.
    for(const row of rows)for(const entry of row.entries){
      const verdict=resolveLink('#'+entry.key,screens);
      assert.ok(verdict.ok,`${id}: «${entry.key}» في «${row.label}» — ${verdict.reason}`);
      assert.ok(entry.label&&entry.label_en,`${id}: «${entry.key}» بلا تسمية`);
    }
    // ولا اسمان لوجهة واحدة ولا اسم واحد لوجهتين في القسم نفسه: «الخدمات» و«الإدارات» و«دليل الخدمات» مسجَّلة
    // ثلاثتها باسم «الخدمات» في سجل الوجهات، فلو أُخذت التسمية من السجل وحده لحمل ثلاثة روابط في صفحةٍ اسمًا واحدًا.
    for(const row of rows){
      const names=new Map();
      for(const entry of row.entries){
        assert.ok(!names.has(entry.label),`${id}: «${row.label}» فيه «${entry.label}» مرتين (${names.get(entry.label)} و${entry.key})`);
        names.set(entry.label,entry.key);
      }
      // وبندٌ يحمل اسم قسمه يُعطى تسمية مدخله إن كانت له واحدة («مركز الخدمات» داخل «الخدمات»). وسجل «العملاء»
      // لا يحمل للشاشة اسمًا غير اسم قسمها، فيبقى الرابط باسمه: شاشةٌ واحدة باسمها لا اسمان لوجهتين.
      if(!row.single&&names.has(row.label))assert.equal(names.get(row.label),row.id,`${id}: «${row.label}» فيه بندٌ باسم القسم (${names.get(row.label)})`);
    }
    // كل مفتاح يظهر هو مفتاح تبلغه القائمة اليوم أو صفحة إدارة الحساب: القسم لا يمنح وصولًا.
    const reachable=new Set([...reach.map(r=>r[0]),...doorsOf(me,departments).map(([d])=>'departments/'+d)]);
    for(const row of rows)for(const entry of row.entries)assert.ok(reachable.has(entry.key),`${id}: «${entry.key}» ليست فيما يبلغه الحساب`);
  }
});

test('عشرة صفوف على الأكثر، بترتيب الموجز الثابت، و«الرئيسية» في كل حساب',async()=>{
  const {accounts,departments}=world();
  for(const [id,me] of accounts){
    const {rows}=await rowsOf(id,me,departments);
    assert.ok(rows.length<=SECTION_CAP,`${id} (${me.role}): ${rows.length} صفًّا — ${rows.map(r=>r.label).join(' ')}`);
    assert.equal(rows[0].id,'home',`${id}: «الرئيسية» أول صف`);
    // الترتيب ترتيب الموجز: الأقسام تُحذف ولا تُقدَّم ولا تُؤخَّر.
    const at=rows.map(r=>SECTION_IDS.indexOf(r.id));
    assert.ok(at.every(i=>i>=0)&&at.every((v,i)=>!i||at[i-1]<v),`${id}: ترتيب ${rows.map(r=>r.id).join(' ')}`);
    // القسم الذي لا يجد إلا شاشةً واحدة لا يُعرض قسمًا: صفٌّ باسم القسم يقود إلى الشاشة نفسها، لا صفحةً برابط واحد.
    for(const row of rows){
      if(row.id==='home'){assert.ok(row.single&&row.route==='home',`${id}: «الرئيسية» صفٌّ مفرد`);continue;}
      assert.equal(row.single,row.entries.length===1,`${id}: «${row.label}» ${row.entries.length} شاشة وsingle=${row.single}`);
      assert.equal(row.label,SECTIONS.find(s=>s.id===row.id).label,`${id}: «${row.id}» بدّل اسمه`);
      if(row.single)assert.equal(row.route,row.entries[0].key,`${id}: «${row.label}» صفٌّ مفرد يقود إلى شاشته`);
      else assert.equal(row.route,`section/${row.id}`,`${id}: «${row.label}» صفحة قسم`);
    }
    // ولا قسم فارغ يُعرض صفًّا: صفٌّ لا يفتح شيئًا وعدٌ كاذب.
    for(const row of rows)assert.ok(row.id==='home'||row.entries.length,`${id}: «${row.label}» صفٌّ بلا شاشة`);
  }
});

test('ولا مجموعة مسمّاة بأقل من بندين، وكل بند في مجموعة من مجموعات قسمه',async()=>{
  const {accounts,departments}=world();
  for(const [id,me] of accounts){
    const {rows}=await rowsOf(id,me,departments);
    for(const row of rows.filter(r=>!r.single)){
      const inGroups=row.groups.flatMap(g=>g[2]);
      assert.equal(inGroups.length,row.entries.length,`${id}: «${row.label}» ${row.entries.length} شاشة في ${inGroups.length} بندًا`);
      assert.deepEqual([...new Set(inGroups.map(x=>x.key))].sort(),[...row.entries.map(x=>x.key)].sort(),`${id}: «${row.label}» بنود المجموعات تخالف بنود القسم`);
      for(const [ar,,list] of row.groups){
        // حدّ البندين حدُّ المسمّى: القائمة بلا عنوان روابطُ مسرودة (صفحة إدارةٍ أو متبقٍّ)، لا مجموعة يَعِد عنوانها بأكثر مما فيها.
        if(ar)assert.ok(list.length>=2,`${id}: «${row.label}» › «${ar}» مجموعة ببندٍ واحد (${list.map(x=>x.key).join(' ')})`);
        assert.notEqual(ar,'أخرى',`${id}: «${row.label}» فتح «أخرى»`);
        assert.ok(list.length,`${id}: «${row.label}» مجموعة فارغة`);
      }
      // قسمٌ بثلاث شاشات لا يُقسَّم: عنوانٌ لكل شاشتين ضجيجٌ لا ترتيب.
      if(row.entries.length<SECTION_GROUP_MIN)assert.deepEqual(row.groups.map(g=>g[0]),[''],`${id}: «${row.label}» قُسِّم وفيه ${row.entries.length} شاشة`);
    }
  }
});

test('الصلاحية هي التي تُظهر: ما لا يبلغه الحساب لا يُعرض، وسجلّ القسم لا يخترع طبقةً ثانية',async()=>{
  const {accounts,departments}=world();
  const me=Object.fromEntries(accounts);
  const keysOf=async id=>{const {rows}=await rowsOf(id,me[id],departments);return new Set(rows.flatMap(r=>r.entries.map(e=>e.key)));};
  const employee=await keysOf('employee'),hr=await keysOf('hr'),admin=await keysOf('admin');
  // شاشات الموارد البشرية الإدارية تظهر لمن يحمل تصريحها ولا تظهر للموظف، والفرق فرق التصريح لا فرق القسم.
  for(const key of ['employees','people','payroll-rules','letter-templates'])
    assert.ok(hr.has(key)&&!employee.has(key),`«${key}»: موارد بشرية ${hr.has(key)} / موظف ${employee.has(key)}`);
  for(const key of ['accounts','feature-flags','jobs'])
    assert.ok(admin.has(key)&&!hr.has(key)&&!employee.has(key),`«${key}»: أدمن ${admin.has(key)}`);
  // والوجه الشخصي للشاشة ذات الوجهين يبقى للموظف في «أعمالي»، فلا يُفقد وصولًا كان له.
  const {rows}=await rowsOf('employee',me.employee,departments);
  const work=rows.find(r=>r.id==='work');
  for(const key of ['profile','payroll','leave','attendance','my-benefits'])
    assert.ok(work.entries.some(e=>e.key===key),`«${key}» ليست في «أعمالي» عند الموظف`);
  // القسم يُشتق من placeFor: الشاشة نفسها بتسميتين تقع في قسمين لأن الموضع اختلف، لا لأن قاعدةً ثانية قررت.
  assert.equal(sectionOf('attendance','حضوري',me.employee).section,'work');
  // «الخدمات» و«الإدارات» و«دليل الخدمات» في قسم واحد: التسمية تسمية مدخلها لا تسمية السجل، فلا تتشابه الثلاثة.
  assert.equal(sectionOf('services','مركز الخدمات',me.employee).label,'مركز الخدمات');
  assert.equal(sectionOf('departments','الإدارات',me.manager).label,'الإدارات');
  assert.equal(sectionOf('catalog','دليل الخدمات',me.admin).label,'دليل الخدمات');
  assert.equal(sectionOf('work','عملي',me.employee).label,'عملي','صف العمل اليومي يحمل الاسم الموحّد');
  assert.equal(sectionOf('attendance','الحضور والانصراف',me.hr).section,'departments');
  assert.equal(sectionOf('reports','مركز التقارير',me.employee).section,'reports','سجلُّ مركز التقارير dept:*own ولا ينقله إلى قسم إدارة قارئه');
  // القسم صفة الشاشة: الشاشة المشتركة تُعرض على صفحة إدارة الحساب ولا تنتقل بقسمها إليها.
  assert.equal(sectionOf('clients','العملاء',me.employee).section,'clients');
  assert.equal(placeFor('clients','العملاء',me.employee).hub,'dept','ما زالت تُعرض على صفحة إدارة الحساب');
});

test('مجموعات القسم: الوحدة نقية، وصفحة الإدارة تتقدّم، والمتبقّي لا يلبس عنوانًا لا يصفه',()=>{
  const entry=key=>({key,label:key,label_en:key});
  // قسم بأقل من الحدّ: قائمة واحدة بلا عنوان.
  assert.deepEqual(sectionGroups('work',[entry('inbox'),entry('profile')]).map(g=>[g[0],g[2].length]),[['',2]]);
  assert.deepEqual(sectionGroups('work',[]),[]);
  // صفحة الإدارة أولًا وبلا عنوان، أيًّا كان عددها، فلا تنزل في متبقّي آخر الصفحة.
  const withDoor=sectionGroups('departments',[entry('departments/hr'),entry('employees'),entry('employee-profile'),entry('people'),entry('lifecycle')]);
  assert.equal(withDoor[0][0],'');
  assert.deepEqual(withDoor[0][2].map(x=>x.key),['departments/hr']);
  assert.ok(withDoor.slice(1).every(g=>g[0]&&g[2].length>=2),withDoor.map(g=>g[0]+':'+g[2].length).join(' '));
  // بندٌ لا تسمّيه مجموعة يبقى ظاهرًا في قائمة بلا عنوان، ولا يُلحق بعنوان لا يصفه ولا يُفتح له «أخرى».
  const loose=sectionGroups('clients',[entry('clients'),entry('approvals'),entry('client-reports'),entry('offerings')]);
  assert.deepEqual(loose.map(g=>[g[0],g[2].map(x=>x.key)]),[['العملاء',['clients','approvals','client-reports']],['',['offerings']]]);
  // مفتاح مجهول لا يُسقط ولا يُسمّى: يظهر في القائمة بلا عنوان.
  const unknown=sectionGroups('reports',[entry('reports'),entry('epmo'),entry('executive'),entry('unregistered-screen')]);
  assert.ok(unknown.some(g=>!g[0]&&g[2].some(x=>x.key==='unregistered-screen')),JSON.stringify(unknown.map(g=>g[0])));
});

test('العقد مع الموجّه: مسار صفحة القسم مسجَّل عند تبنّيه، والوحدة لا تنادي خادمًا ولا DOM',()=>{
  // صفوف الأقسام لا تُرسم حتى يسجّل الموجّه شاشة «section» (رقعة مقترحة على app.mjs و deep-links.mjs في التقرير).
  // هذا الشرط يحرس الترتيب: من سجّلها شاشةً وجب أن يسجّلها ذات مسار فرعي، وإلا فُهم «#section/work» نيةً غير مسجلة.
  assert.equal(BUILTIN_VIEWS.includes('section'),SUBROUTED_VIEWS.includes('section'),
    'شاشة «section» تُسجَّل في BUILTIN_VIEWS وSUBROUTED_VIEWS معًا (app/static/deep-links.mjs)');
  // وحدة نقية: لا fetch ولا document في مصدر الخريطة، فتُختبر بلا صندوق وتُقرأ في الخادم كما في المتصفح.
  const source=readFileSync(new URL('../app/static/nav-map.mjs',import.meta.url),'utf8');
  for(const forbidden of ['fetch(','document.','localStorage','innerHTML'])assert.ok(!source.includes(forbidden),`nav-map.mjs تنادي «${forbidden}»`);
  // ولا اسم موظف ولا عميل حقيقي في الخريطة: أسماء شاشات وإدارات ومجموعات وحدها.
  assert.doesNotMatch(source,/@(?!own)[a-z]/,'nav-map.mjs تحمل بريدًا');
});
