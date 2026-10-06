// ت1 — باب «الخدمات» الواحد، وصفحة الإدارة، وموضع العرض (د2/د3/د4 من قرارات ت0) — 26 سبتمبر 2026.
//
// ثلاثة معايير قبول من خطة ت1 تُقاس هنا على HTML المرسومة نفسها لا على الحمولة وحدها:
//   ق-ت1-5  من الرئيسية تُبلَغ صفحة كل خدمة (أو بطاقة مجموعتها VAR-) في ثلاث ضغطات على سطح المكتب بالعدسة الافتراضية:
//           الرئيسية ← «الخدمات» (1) ← الإدارة (2) ← الخدمة (3). اختيار خيارٍ داخل مجموعة ضغطةٌ رابعة مسموحة.
//   ق-ت1-6  بحث «الخدمات» (ترتيب الخادم نفسه rankCatalog على catalogTree) يجد الخدمات كلها باسمها وبكل مرادفٍ لها بعد التطبيع.
//   ق-ت1-7  لا خدمة client_work (عدا الأربع عشرة الحدّية، د2) في «حسب الحاجة» ولا «خدمات مختارة» ولا «لك»، وكل واحدة من الأربعين
//           في قسم «الخدمات» من صفحة إدارتها.
// ومعها ما يحرس أن ت1 عرضٌ لا قرار: صفوف الإسقاط كما هي، والرابط المباشر يعمل، ولا اسم يتغيّر (لا تسمية معتمدة بعد).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog, variantCatalog, enrichCatalog } from '../app/service-catalog.mjs';
import { catalog } from '../app/workflow.mjs';
import { annotateCatalog } from '../app/module-routes.mjs';
import { annotateTargets } from '../app/service-target.mjs';
import { catalogTree, servicePage } from '../app/catalog-home.mjs';
import { DEPARTMENT_ONLY, CATALOG_RENAMES, placementFor } from '../app/catalog-tree.mjs';
import { rankCatalog } from '../app/static/catalog-search.mjs';
import { FEATURED_SERVICES, displayDepartment, ADMIN_AFFAIRS, INTERIM_EXECUTOR } from '../app/static/request-picker.mjs';
import { kit } from '../app/static/kit.mjs';
import { catalogHome, categoryView, forYouRow, departmentLens, departmentPageView, departmentTools } from '../app/static/catalog-home-ui.mjs';
import { servicePageView } from '../app/static/service-page.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=kit(e,ar=>ar),ctx={e,ui};
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');

// جدول التحويل المعتمد مصدرُ الأربعين والحدّيات، يُقرأ هنا ولا يُنسخ.
function mapping(){
  const lines=readFileSync(new URL('../docs/org/catalog-mapping.csv',import.meta.url),'utf8').split('\n').filter(l=>l&&!l.startsWith('#'));
  const parse=line=>{const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i];
    if(q){if(c==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}else if(c==='"')q=true;else if(c===','){out.push(cur);cur='';}else cur+=c;}
    out.push(cur);return out;};
  const head=parse(lines[0]);
  return lines.slice(1).map(l=>Object.fromEntries(parse(l).map((v,i)=>[head[i],v])));
}
const ROWS=mapping();
const DEPT_ONLY_FROM_MAPPING=ROWS.filter(r=>r['الموضع']==='صفحة الإدارة فقط').map(r=>r['الرمز']).sort();
const BORDERLINE=ROWS.filter(r=>/^د2/.test(r['دفعة تركي']??'')).map(r=>r['الرمز']).sort();

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-org-t1');installServiceCatalog(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const departments=db.prepare("SELECT id,name,sector FROM departments WHERE tenant_id='36t' AND active=1 ORDER BY sector,name").all();
  // ما يرسله الخادم في /api/catalog و/api/catalog/variants بالجملة نفسها (app/server.mjs).
  const servicesFor=u=>annotateTargets(db,u.tenant_id,enrichCatalog(annotateCatalog(db,u,catalog(db,u))));
  return {db,users,departments,servicesFor,variantsFor:u=>variantCatalog(db,u)};
}
const linkedCodes=html=>new Set([...html.matchAll(/href="#services\/([A-Z][A-Z0-9-]+)"/g)].map(m=>m[1]));
const linkedDepartments=html=>new Set([...html.matchAll(/href="#departments\/([a-z][a-z0-9-]*)"/g)].map(m=>m[1]));
const groupDoors=html=>new Set([...html.matchAll(/data-action="pick-variant" data-group="([^"]+)"/g)].map(m=>m[1]));

test('ت1: الأربعون في الكود هي صفوف «صفحة الإدارة فقط» في جدول التحويل، ومعها DAT-PROFITABILITY، ولا حدّيّة منها',()=>{
  assert.equal(DEPARTMENT_ONLY.length,40);
  assert.deepEqual([...DEPARTMENT_ONLY].sort(),DEPT_ONLY_FROM_MAPPING,'الثابت يخالف جدول التحويل المعتمد');
  assert.ok(DEPARTMENT_ONLY.includes('DAT-PROFITABILITY'),'د3: الربحية في صفحة إدارتها');
  assert.equal(BORDERLINE.length,14,'د2: أربع عشرة حدّية');
  assert.deepEqual(BORDERLINE.filter(code=>DEPARTMENT_ONLY.includes(code)),[],'الحدّيات تبقى في الباب الأمامي');
  assert.equal(FEATURED_SERVICES.length>=6&&FEATURED_SERVICES.length<=8,true,'«خدمات مختارة» بين ست وثماني');
  assert.deepEqual(FEATURED_SERVICES.filter(code=>DEPARTMENT_ONLY.includes(code)),[],'ولا واحدة منها منقولة');
  // لا تسمية معتمدة بعد (كلها «بانتظار مالك الإدارة»): CATALOG_RENAMES كما كانت، تسع عشرة.
  assert.equal(CATALOG_RENAMES.length,19);
});

test('ت1 عرضٌ لا قرار: صفوف الإسقاط وشروط الظهور كما هي، والرابط المباشر يفتح المنقولة بطريقها إلى صفحة إدارتها',t=>{
  const {db,users}=fixture(t);
  const rows=db.prepare(`SELECT item_key,audience,visible,required_capability,department_id FROM catalog_placement WHERE tenant_id='36t' AND item_kind='service' AND item_key IN (${DEPARTMENT_ONLY.map(()=>'?').join(',')})`).all(...DEPARTMENT_ONLY);
  assert.equal(new Set(rows.map(r=>r.item_key)).size,40,'لكل منقولة صفّ إسقاط باقٍ');
  assert.ok(rows.every(r=>r.visible===1&&r.required_capability===''&&r.department_id===null&&r.audience==='employee'),'ولا بوابة وُضعت عليه');
  const placed=placementFor(db,'36t',['employee'],'all');
  assert.deepEqual([placed.totals.cards,placed.totals.items],[63,143],'الإسقاط نفسه لم يتغيّر');
  for(const code of ['PRO-SHOOT','DAT-PROFITABILITY','ACC-BRIEF-INTAKE']){
    const page=servicePage(db,users.employee,code),service=catalog(db,users.employee).find(s=>s.code===code);
    assert.equal(page.placement.kind,'department');
    assert.equal(page.breadcrumb[1].href,`#departments/${service.department_id}`,`${code}: الطريق إلى صفحة الإدارة لا إلى فئة`);
    assert.equal(page.category,null);
    const html=servicePageView(page,ctx);
    assert.ok(html.includes(`href="#departments/${service.department_id}"`)&&html.includes('العودة إلى صفحة الإدارة'));
    // مادّة البطاقة التي لم تُكتب: «يكمله» إدارةٌ لا شخص.
    assert.ok(text(html).includes(`المستندات المطلوبة — لم يُكتب بعد. يكمله: ${page.owner.name}`),`${code}: ${page.owner.name}`);
    // خدمات قريبة: أخوة المجموعة كلهم (DAT-DASHBOARD الحدّية أخت DAT-PROFITABILITY)، ثم من الفئة ما نُقل معها وحده.
    assert.ok(page.nearby.filter(item=>item.from==='category').every(item=>['VAR-PRODUCTION','VAR-DIGITAL','VAR-INFLUENCER','VAR-CLIENT','VAR-OPPORTUNITY','VAR-RESEARCH'].includes(item.key)),`${code}: ${page.nearby.map(i=>i.key)}`);
  }
});

test('ق-ت1-7: لا منقولة في «حسب الحاجة» ولا «خدمات مختارة» ولا «لك»، والحدّيات باقية فيها، وكل منقولة في «الخدمات» من صفحة إدارتها',t=>{
  const {db,users,departments,servicesFor,variantsFor}=fixture(t);
  const moved=new Set(DEPARTMENT_ONLY);
  for(const who of ['employee','manager']){
    const u=users[who],tree=catalogTree(db,u);
    const front=tree.categories.flatMap(c=>[...c.cards,...c.members,...c.cards.flatMap(card=>card.members??[])]);
    assert.deepEqual(front.filter(item=>moved.has(item.key)).map(i=>i.key),[],`${who}: منقولة في بطاقات الفئات أو أعضاء مجموعاتها`);
    // المجموعات التي نُقل كل أعضائها تغيب بطاقتها، والتي بقي لها عضو تبقى بأعضائها الباقين.
    const cards=new Set(tree.categories.flatMap(c=>c.cards.map(card=>card.key)));
    for(const gone of ['VAR-PRODUCTION','VAR-DIGITAL','VAR-INFLUENCER','VAR-CLIENT','VAR-OPPORTUNITY','VAR-RESEARCH'])assert.equal(cards.has(gone),false,`${who}: ${gone}`);
    for(const kept of ['VAR-PR','VAR-BRAND','VAR-REPORT'])assert.ok(cards.has(kept),`${who}: ${kept}`);
    // الحدّيات الأربع عشرة في الباب الأمامي.
    const frontKeys=new Set(front.map(item=>item.key));
    assert.deepEqual(BORDERLINE.filter(code=>!frontKeys.has(code)),[],`${who}: حدّيّة غابت عن الباب الأمامي`);
    // المرسوم: الرئيسية بعدسة الحاجة وصفحات الفئات الثماني و«لك» و«خدمات مختارة».
    const pages=[catalogHome({...tree,lens:'need'},ctx),...tree.categories.map(c=>categoryView(tree,c.key,'tree',ctx)),forYouRow(tree,ctx)];
    for(const html of pages){
      const leaked=[...linkedCodes(html)].filter(code=>moved.has(code));
      assert.deepEqual(leaked,[],`${who}: رابط منقولة في «حسب الحاجة»`);
      assert.equal(/data-card="(VAR-PRODUCTION|VAR-DIGITAL|VAR-INFLUENCER|VAR-CLIENT|VAR-OPPORTUNITY|VAR-RESEARCH)"/.test(html),false);
    }
    assert.deepEqual(tree.featured.filter(item=>moved.has(item.key)),[],'خدمات مختارة');
    assert.ok(tree.featured.length>=6,'«خدمات مختارة» مرسومة');
    assert.deepEqual(tree.for_you.items.filter(item=>moved.has(item.key)||(item.members??[]).some(m=>moved.has(m.key))),[],'لك');
    // الرقم الرابع: يُقال ولا يُطرح صامتًا.
    assert.equal(tree.department_only_items,40);
    // وكل منقولة في قسم «الخدمات» من صفحة إدارتها — لقارئٍ ليس من الإدارة (يرى «الخدمات» وحدها).
    const services=servicesFor(u),variants=variantsFor(u);
    for(const code of DEPARTMENT_ONLY){
      const service=services.find(s=>s.code===code);
      assert.ok(service,`${who}: ${code} ليست في دليله`);
      const owner=displayDepartment(service);
      const page=departmentPageView({id:owner,departments,services,variants,me:{...u,department_id:'no-such-dept'},e,ui});
      const section=page.slice(page.indexOf('id="dept-services"'));
      assert.ok(section.includes(`href="#services/${code}"`),`${who}: ${code} ليست في «الخدمات» من صفحة ${owner}`);
    }
    // والعدسة الافتراضية تقود إلى صفحات إداراتها.
    const lens=linkedDepartments(departmentLens({departments,services,me:u,e,variants}));
    for(const code of DEPARTMENT_ONLY)assert.ok(lens.has(displayDepartment(services.find(s=>s.code===code))),`${who}: ${code}`);
  }
});

test('ق-ت1-5: كل خدمة (أو بطاقة مجموعتها) على بُعد ثلاث ضغطات من الرئيسية بالعدسة الافتراضية',t=>{
  const {db,users,departments,servicesFor,variantsFor}=fixture(t);
  for(const who of ['employee','manager','hr','it','outsider']){
    const u=users[who];if(!u)continue;
    const tree=catalogTree(db,u);
    assert.equal(tree.lens,'department',`${who}: الزيارة الأولى بعدسة الإدارة`);
    const services=servicesFor(u),variants=variantsFor(u);
    // الضغطة 1: «الخدمات» من القائمة. الشاشة كما يرسمها app.mjs: catalogHome ولوحها عدسة الإدارة.
    const door=catalogHome(tree,{...ctx,extra:departmentLens({departments,services,me:u,e,variants})});
    const depth=new Map(),groupDepth=new Map(),seen=new Set();
    const visit=(html,level)=>{
      for(const code of linkedCodes(html))if(!depth.has(code)||depth.get(code)>level+1)depth.set(code,level+1);
      for(const group of groupDoors(html))if(!groupDepth.has(group)||groupDepth.get(group)>level+1)groupDepth.set(group,level+1);
    };
    visit(door,1);
    // الضغطة 2: الإدارة من الشريط أو الشبكة، فصفحتها؛ والضغطة 3: الخدمة من قسم «الخدمات».
    for(const id of linkedDepartments(door)){
      if(seen.has(id))continue;seen.add(id);
      visit(departmentPageView({id,departments,services,variants,me:u,e,ui}),2);
    }
    const byGroup=new Map(variants.flatMap(g=>g.options.filter(o=>o.service_code).map(o=>[o.service_code,g.code])));
    const far=services.filter(s=>!((depth.get(s.code)??9)<=3||(groupDepth.get(byGroup.get(s.code))??9)<=3)).map(s=>s.code);
    assert.deepEqual(far,[],`${who}: خدمات أبعد من ثلاث ضغطات: ${far.join('، ')}`);
    assert.equal(services.filter(s=>(depth.get(s.code)??9)<=3).length,services.length,`${who}: صفحة كل خدمة نفسها (لا بطاقة مجموعتها وحدها) على بُعد ثلاث`);
    if(who==='employee')assert.equal(services.length,142);
  }
});

test('ق-ت1-6: بحث «الخدمات» يجد الخدمات الـ142 باسمها وبكل مرادفٍ لها، وبعد التطبيع (تشكيل ومدّ وهمزات)',t=>{
  const {db,users,servicesFor}=fixture(t);
  const u=users.employee,tree=catalogTree(db,u),services=servicesFor(u);
  assert.equal(services.length,142);
  const finds=(query,code)=>rankCatalog(tree,tree.synonyms,query).some(hit=>hit.item.key===code);
  // تشكيلٌ ومدٌّ بعد أول حرف من كل كلمة، وألفٌ بهمزة: كلها تُطبَّع إلى الصورة نفسها.
  const decorate=value=>value.split(' ').map(w=>w.length>1?w[0]+'ّـ'+w.slice(1):w).join(' ').replace(/^ا/,'أ');
  const missesByName=services.filter(s=>!finds(s.name_ar,s.code)).map(s=>s.code);
  assert.deepEqual(missesByName,[],`باسمها: ${missesByName.join('، ')}`);
  const missesDecorated=services.filter(s=>!finds(decorate(s.name_ar),s.code)).map(s=>s.code);
  assert.deepEqual(missesDecorated,[],`باسمها بعد التطبيع: ${missesDecorated.join('، ')}`);
  let checked=0;const missesBySynonym=[];
  for(const s of services)for(const synonym of tree.synonyms[`service:${s.code}`]??[]){checked++;if(!finds(synonym,s.code))missesBySynonym.push(`${s.code} «${synonym}»`);}
  assert.deepEqual(missesBySynonym,[],`بمرادفها: ${missesBySynonym.join('، ')}`);
  assert.ok(checked>300,`مرادفات مفحوصة: ${checked}`);
  // والمنقولة تُجمَّع في النتيجة تحت صفحة إدارتها لا تحت فئة حاجة.
  const hit=rankCatalog(tree,tree.synonyms,'تصوير فيديو').find(h=>h.item.key==='PRO-SHOOT');
  assert.ok(hit&&hit.category.department_page&&hit.category.href==='#departments/production');
});

test('صفحة الإدارة: غير العضو يرى «الخدمات» وحدها، والعضو يرى أقسامه، و«أدوات الإدارة» من navReach وحده',t=>{
  const {db,users,departments,servicesFor,variantsFor}=fixture(t);
  const u=users.employee,services=servicesFor(u),variants=variantsFor(u);
  const outsiderView=departmentPageView({id:'finance',departments,services,variants,me:{...u,department_id:'creative'},e,ui});
  assert.equal((outsiderView.match(/<section class="panel" id="dept-/g)??[]).length,1,'غير العضو: قسم واحد');
  assert.ok(outsiderView.includes('id="dept-services"')&&!outsiderView.includes('aria-label="أقسام صفحة الإدارة"'));
  assert.ok(outsiderView.includes('class="rq-rail"')&&outsiderView.includes('href="#departments/finance" aria-current="page"'),'مع شريط الإدارات');
  // مطالبة المصروفات تُعرض تحت المالية (ق3)، وخدمات ADM- الأخرى في صفحة الشؤون الإدارية بتسمية منفّذها المؤقت.
  assert.ok(outsiderView.includes('href="#services/ADM-EXPENSE-CLAIM"'));
  const admin=departmentPageView({id:ADMIN_AFFAIRS.id,departments,services,variants,me:u,e,ui});
  assert.ok(admin.includes('<h1>الشؤون الإدارية والمرافق</h1>')&&text(admin).includes(INTERIM_EXECUTOR));
  for(const code of ['ADM-MAINTENANCE','ADM-TRAVEL','ADM-SAFETY','ADM-GOVT-SERVICES','ADM-SUBSCRIPTION'])assert.ok(admin.includes(`href="#services/${code}"`),code);
  assert.equal(admin.includes('href="#services/ADM-EXPENSE-CLAIM"'),false);
  const ceo=departmentPageView({id:'ceo-office',departments,services,variants,me:u,e,ui});
  assert.equal(/href="#services\/ADM-/.test(ceo),false,'مكتب الرئيس التنفيذي لا يعرض ADM- (ملكية عرض)');
  // department_id لم يتغيّر: الملكية تسمية عرضٍ فقط.
  assert.ok(services.filter(s=>s.code.startsWith('ADM-')).every(s=>s.department_id==='ceo-office'));
  // العضو: نظرة عامة، والطلبات الواردة (حالة فارغة حين لا يرى شيئًا)، والخدمات، والفريق.
  const reach=[['budgets','◫','مخصصات المشاريع'],['invoices','◫','الفواتير الضريبية'],['leave','♙','إجازاتي']];
  const member={...u,department_id:'finance',role:'employee'};
  const org={sectors:[{name:'x',units:[{id:'finance',name:'المالية',people:4,approver:{id:'a',name:'مدير تجريبي'},escalation:null}]}],unplaced:[]};
  const memberView=departmentPageView({id:'finance',departments,services,variants,me:member,reach,requests:[
    {id:'r1',title:'طلب تجريبي قيد التنفيذ',status:'in_progress',service_name:'خدمة',handling_department_id:'finance'},
    {id:'r2',title:'طلب لإدارة أخرى',status:'in_progress',service_name:'خدمة',handling_department_id:'hr'},
    {id:'r3',title:'مسودة',status:'draft',service_name:'خدمة',handling_department_id:'finance'}],org,announcements:[],e,ui});
  for(const key of ['overview','incoming','services','team'])assert.ok(memberView.includes(`id="dept-${key}"`),key);
  assert.ok(memberView.includes('href="#departments/finance/incoming"')&&memberView.includes('aria-current="true"'),'تبويبات بروابط وaria-current');
  assert.ok(memberView.includes('href="#request/r1"')&&!memberView.includes('href="#request/r2"')&&!memberView.includes('href="#request/r3"'),'طابور التنفيذ لهذه الإدارة وحدها');
  // «أدوات الإدارة»: ما يضعه placeFor على المالية من navReach، بتسميته، ولا شيء غيره.
  const tools=departmentTools(reach,member,'finance').map(t=>t.key);
  assert.deepEqual(tools,['budgets','invoices']);
  assert.ok(memberView.includes('<h3>أدوات الإدارة</h3>')&&memberView.includes('href="#budgets"')&&!memberView.includes('href="#leave"'));
  const empty=departmentPageView({id:'finance',departments,services,variants,me:member,reach,requests:[],e,ui});
  assert.ok(text(empty).includes('لا طلبات واردة تراها لهذه الإدارة الآن'),'الحالة الفارغة');
  // بلا navReach: لا كتلة أدوات.
  const noReach=departmentPageView({id:'finance',departments,services,variants,me:member,e,ui});
  assert.equal(noReach.includes('أدوات الإدارة'),false);
  assert.equal(departmentTools(null,member,'finance'),null);
  // لا نمط سطري ولا سكربت (CSP).
  for(const html of [outsiderView,memberView,admin])assert.equal(/\sstyle=|<script|\son[a-z]+=/i.test(html),false);
});
