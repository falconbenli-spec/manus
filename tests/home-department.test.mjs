import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { homeBoard } from '../app/home.mjs';
import { homeUI } from '../app/static/home-ui.mjs';
import { NAV_DEST, placeFor } from '../app/static/nav-map.mjs';
import { resolveLink } from '../app/static/deep-links.mjs';
import { knownScreens } from '../scripts/quality-ratchet.mjs';
import { createRequest, transition, catalog } from '../app/workflow.mjs';
import { departmentHeldWork } from '../app/request-assignment.mjs';

/* «شغل إدارتي» — موجز المالك (30 سبتمبر 2026) البند 3: «تخصيص الصفحة حسب الدور. مدير الحسابات يرى التحصيل
 * والإقفال والسيولة. مدير الأعمال يرى العملاء والفرص والمشاريع».
 *
 * والعيب الذي أوجب هذا الملف: الرئيسية كانت تعرف «المدير» و«الموارد البشرية» و«المالية» و«القيادة» ولا تعرف
 * شغلَ إدارة صاحب الحساب نفسه، فمدير إدارة الأعمال لا يجد العملاء ولا الفرص في رئيسيته. والعلاج ليس سبعة عشر
 * قسمًا مكتوبًا بيد — سبعة عشر تعريفًا لسؤال واحد تتقادم واحدًا واحدًا — بل قسم واحد مشتقٌّ من البيانات.
 * فالمحروس هنا ثلاثة ثوابت:
 *   (1) شاشات القسم من سجل الوجهات بموضع placeFor لهذا الحساب، لا من قائمة تُكتب في app/home.mjs،
 *   (2) رقمُ كل كتلة طولُ قائمتها، ولا يُعرض رقمٌ لمن لم تُقرأ له قائمته،
 *   (3) لا يُرسم اسم شاشة لا يبلغها الحساب اليوم، فلا نقرة تنتهي برفض.
 * البيانات كلها اصطناعية: إدارات وأسماء حسابات مصطنعة لهذا الملف وحده.
 */

const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

// navReach عقدُ الشاشة مع app.mjs: تُنشر على globalThis فتقرأها الشاشات. تُعطى للرسم هنا صراحةً وتُعاد كما كانت.
function render(data,reach){
  const before=Object.hasOwn(globalThis,'navReach')?globalThis.navReach:undefined;
  if(reach===undefined)delete globalThis.navReach;else globalThis.navReach=reach;
  try{return homeUI.render(data,{e,tr:ar=>ar,lang:'ar'});}
  finally{if(before===undefined)delete globalThis.navReach;else globalThis.navReach=before;}
}
// الشاشات التي يبلغها الحساب في اختبار: صيغة navReach نفسها [مفتاح، رمز، عربي، إنجليزي].
const reachOf=(...keys)=>keys.map(key=>[key,'▦',NAV_DEST[key]?.label??key,key]);
const countIn=(html,title)=>{
  const at=html.indexOf(`<h2>${title} <small>`);
  return at<0?null:Number(html.slice(at).match(/<small>(\d+)<\/small>/)?.[1]);
};

// إدارات ومسؤولوها بيانات اصطناعية: الإدارات الثلاث التي سمّاها الموجز (الحسابات، الأعمال، المالية) ليست في البذرة.
const EXTRA=[['accounts','إدارة حسابات العملاء (بيانات اصطناعية)','ملاك حساب اصطناعي'],
  ['business-dev','إدارة تطوير الأعمال (بيانات اصطناعية)','مسؤول أعمال اصطناعي'],
  ['finance','الإدارة المالية (بيانات اصطناعية)','مسؤول مالي اصطناعي']];

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-home-department');t.after(()=>db.close());
  const digest=db.prepare("SELECT password_hash AS h FROM users WHERE id='employee'").get().h;
  const addUser=(id,department,name,role)=>db.prepare('INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id,active) VALUES(?,?,?,?,?,?,?,NULL,1)')
    .run(id,'36t',department,id,name,digest,role);
  for(const [id,name,person] of EXTRA){
    db.prepare('INSERT INTO departments(id,tenant_id,name) VALUES(?,?,?)').run(id,'36t',name);
    addUser(`head-${id}`,id,person,'manager');
  }
  // إدارة بلا صفحة بقصد (ops تقنية بلا خدمات): حسابٌ فيها غير الأدمن، ليُفحص غيابُ القسم عنه لا عن الأدمن وحده.
  addUser('ops-staff','ops','منسوب تشغيل اصطناعي','employee');
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const service=code=>catalog(db,users.admin).find(s=>s.code===code);
  return {db,users,tx,service};
}

test('home department: the section is derived from the destination registry, so each department head is shown the screens of their own department and nobody else’s',t=>{
  const {db,users}=fixture(t);
  const screens=homeBoard(db,users.manager).department;
  assert.ok(screens,'a department head with screens in their department gets the section');
  assert.equal(screens.id,'creative');
  assert.equal(screens.name,db.prepare("SELECT name FROM departments WHERE id='creative'").get().name,'the name is the department row, not a label written on the page');
  assert.equal(screens.link,'#departments/creative');
  assert.ok(screens.screens.length>0,'and it names screens, not an empty shell');

  // الثابت: كل شاشة في القسم هي ما يضعه سجل الوجهات على إدارة هذا الحساب — تُحسب هنا من السجل نفسه لا من نسخة مكتوبة.
  const fromRegistry=me=>Object.entries(NAV_DEST).filter(([key,d])=>{
    const place=placeFor(key,d.label,me);return place.hub==='dept'&&place.dept===me.department_id;
  }).map(([key])=>key).sort();
  for(const id of ['manager','employee','hr','it','head-accounts','head-business-dev','head-finance']){
    const home=homeBoard(db,users[id]);
    assert.deepEqual(home.department.screens.map(s=>s.key).sort(),fromRegistry(users[id]),`${id}: the section is the registry’s own placement, not a hand-written list`);
  }

  // وموجز المالك بعينه: الحسابات ترى العملاء والموافقات، والأعمال ترى الفرص والعروض، والمالية ترى التحصيل والإقفال والسيولة.
  const keysOf=id=>new Set(homeBoard(db,users[id]).department.screens.map(s=>s.key));
  const accounts=keysOf('head-accounts'),business=keysOf('head-business-dev'),finance=keysOf('head-finance');
  for(const key of ['clients','approvals','client-reports'])assert.ok(accounts.has(key),`accounts: ${key}`);
  for(const key of ['pipeline','commercial','quotations','offerings'])assert.ok(business.has(key),`business development: ${key}`);
  for(const key of ['receivables','close-checklist','cash-forecast'])assert.ok(finance.has(key),`finance: ${key}`);
  // ولا تتسرّب شاشة إدارة إلى رئيسية إدارة أخرى.
  for(const key of ['receivables','close-checklist','cash-forecast'])assert.equal(business.has(key),false,`business development is not shown ${key}`);
  for(const key of ['pipeline','quotations'])assert.equal(finance.has(key),false,`finance is not shown ${key}`);
  for(const key of ['employees','payroll-rules'])assert.equal(accounts.has(key),false,`account management is not shown ${key}`);
  assert.ok(keysOf('hr').has('employees')&&keysOf('it').has('integrations'),'and each other department is placed by the same rule');
  assert.ok(verifyAudit(db));
});

test('home department: every link in the section reaches a registered screen — no silent dead click',async t=>{
  const {db,users}=fixture(t);
  const registered=await knownScreens();
  for(const id of ['manager','employee','hr','it','head-accounts','head-business-dev','head-finance']){
    const section=homeBoard(db,users[id]).department;
    const page=resolveLink(section.link,registered);
    assert.ok(page.ok,`${id}: the department page link does not resolve — ${page.reason}`);
    for(const screen of section.screens){
      assert.equal(screen.link,`#${screen.key}`);
      const verdict=resolveLink(screen.link,registered);
      assert.ok(verdict.ok,`${id}: «${screen.link}» does not resolve — ${verdict.reason}`);
      assert.ok(screen.label,`${id}: «${screen.key}» is drawn without a name`);
    }
  }
});

test('home department: no section for the platform administrator, and none for a department kept without a page on purpose',t=>{
  const {db,users}=fixture(t);
  assert.equal(homeBoard(db,users.admin).department,null,'the administrator has no department work to show');
  assert.equal(homeBoard(db,users['ops-staff']).department,null,'ops is a technical department with no services by design, so it has no screens and no section');
  assert.equal(render(homeBoard(db,users['ops-staff']),reachOf('home','reports')).includes('شغل إدارتي'),false,'and the page draws no empty shell for it');
});

test('home department: each block’s number is the length of its own list, read from the source that owns it and never recomputed',t=>{
  const {db,users,tx,service}=fixture(t);
  const brief=service('CREATIVE-BRIEF');
  const raised=tx(()=>createRequest(db,users.employee,{service_id:brief.id,title:'تكليف إبداعي اصطناعي',
    payload:{objective:'قياس ما تنفّذه الإدارة',deliverable:'صف واحد في الرئيسية',due_date:today()}}));
  const version=()=>db.prepare('SELECT version FROM requests WHERE id=?').get(raised.id).version;
  tx(()=>transition(db,users.employee,raised.id,'submit',{version:version(),note:''}));
  tx(()=>transition(db,users.manager,raised.id,'approve',{version:version(),note:''}));
  tx(()=>transition(db,users.manager,raised.id,'claim',{version:version(),note:''}));

  const home=homeBoard(db,users.manager),section=home.department;
  assert.equal(section.work_read,true,'the department head is the account the sources were read for');
  assert.equal(section.held.length,1,'the request in progress is counted once');
  assert.deepEqual(section.held,departmentHeldWork(db,users.manager),'read from its own source, not computed a second time');
  assert.deepEqual(section.held,home.manager.department_held,'and the manager section and this one read the very same list');
  assert.deepEqual(section.overruns,home.manager.department_overruns);
  assert.deepEqual(section.returned,home.manager.department_returned);

  const html=render(home,reachOf('home','projects','reports'));
  assert.equal(countIn(html,'ما تنفّذه إدارتي الآن'),section.held.length,'the block’s number is the length of the list drawn under it');
  // وما لا صفوف له لا يأخذ خانةً فارغة: لا عنوان ولا رقم، وسطرٌ واحد يسمّي ما قُرئ ولم يوجد فيه شيء.
  assert.equal(countIn(html,'تجاوزت المدة في إدارتي'),null,'a list with no rows is not drawn as an empty box with a zero on it');
  assert.equal(countIn(html,'معادة تنتظر أصحابها'),null);
  assert.match(html,/إدارتك اليوم: ما فيه تجاوز مدة ظاهر لك، ولا طلب معاد ينتظر صاحبه\./,'the one line still says what was read and found empty');
  assert.match(html,/<bdi>[0-9A-F]{8}<\/bdi>/,'the reference is direction-isolated, never bare inside an Arabic line');
  assert.ok(html.includes(e('تكليف إبداعي اصطناعي')),'and the row names the work the department is carrying');
  assert.ok(verifyAudit(db));
});

test('home department: what the account’s own authorisation withholds is neither counted nor given a number',t=>{
  const {db,users,tx,service}=fixture(t);
  const brief=service('CREATIVE-BRIEF');
  const raised=tx(()=>createRequest(db,users.employee,{service_id:brief.id,title:'تكليف إبداعي اصطناعي ثانٍ',
    payload:{objective:'قياس ما لا يُعدّ',deliverable:'لا شيء في رئيسية غير المخوّل',due_date:today()}}));
  const version=()=>db.prepare('SELECT version FROM requests WHERE id=?').get(raised.id).version;
  tx(()=>transition(db,users.employee,raised.id,'submit',{version:version(),note:''}));
  tx(()=>transition(db,users.manager,raised.id,'approve',{version:version(),note:''}));
  tx(()=>transition(db,users.manager,raised.id,'claim',{version:version(),note:''}));
  assert.equal(departmentHeldWork(db,users.manager).length,1,'the work exists and its own department head reads it');

  // موظفة الإدارة نفسها: القسم شاشاتٌ بلا أرقام. مصدر «ما تنفّذه إدارتي» يردّها فارغة لغير مدير الإدارة،
  // فلا يُحسب لها عدد ولا تُرسم لها كتلة — ورقمٌ بلا تفصيلٍ يملكه صاحبه أسوأ من غيابه.
  const member=homeBoard(db,users.employee);
  assert.ok(member.department,'she has a department and screens in it');
  assert.equal(member.department.work_read,false);
  assert.deepEqual([member.department.held,member.department.returned,member.department.overruns],[[],[],[]]);
  assert.deepEqual(departmentHeldWork(db,users.employee),[],'the source itself withholds it, so the page invents nothing');
  const memberHtml=render(member,reachOf('home','projects'));
  assert.ok(memberHtml.includes('شغل إدارتي'),'the screens of her department are still her way in');
  for(const title of ['ما تنفّذه إدارتي الآن','تجاوزت المدة في إدارتي','معادة تنتظر أصحابها'])
    assert.equal(memberHtml.includes(title),false,`a number she cannot detail is not drawn: ${title}`);

  // ومدير إدارة أخرى: كل مصدر يُقرأ بهوية صاحبه ونطاقه، فلا يبلغه شغل إدارة ليست إدارته.
  const other=homeBoard(db,users['head-finance']).department;
  assert.equal(other.work_read,true,'he is a department head, so the sources were read for him');
  assert.deepEqual(other.held,[],'but the work of another department is not his to count');
});

test('home department: a screen the account does not reach today is never drawn, and with no reach at all no screen name is drawn',t=>{
  const {db,users}=fixture(t);
  const home=homeBoard(db,users.manager);
  const keys=home.department.screens.map(s=>s.key);
  assert.ok(keys.includes('projects')&&keys.includes('clients'),'both are registry screens of this department');

  const narrow=render(home,reachOf('home','projects'));
  // ولا شغل مفتوح في هذه الإدارة، فلا ثلاث خانات فارغة متجاورة: سطرٌ واحد يقولها.
  assert.match(narrow,/إدارتك اليوم: ما فيه تجاوز مدة ظاهر لك، ولا شي قيد التنفيذ، ولا طلب معاد ينتظر صاحبه\./);
  for(const title of ['تجاوزت المدة في إدارتي','ما تنفّذه إدارتي الآن','معادة تنتظر أصحابها'])
    assert.equal(narrow.includes(title),false,`no empty box titled «${title}»`);
  assert.match(narrow,/href="#projects"/,'the screen the account reaches is drawn');
  assert.equal(/href="#clients"/.test(narrow),false,'and the one it does not reach is not — the gate is the account’s own reach, not this screen');
  assert.match(narrow,/شاشة وحدة من إدارتك بين يدك/,'and the count is the length of what was drawn, not of the registry');

  const wide=render(home,reachOf('home','projects','clients','campaigns'));
  assert.match(wide,/href="#clients"/);
  assert.match(wide,/3 شاشات من إدارتك بين يدك/);

  const blind=render(home,undefined);
  assert.equal(/من إدارتك بين يدك/.test(blind),false,'with no reach published, no screen name is drawn — not all of them');
  assert.equal(/href="#clients"/.test(blind),false);
  assert.ok(blind.includes('شغل إدارتي'),'the department’s own open work still stands on its own');
  // ولا كتلة فارغة لمن لا شاشات له ولا شغل: القسم كله يغيب.
  const bare=homeBoard(db,users['ops-staff']);
  assert.equal(render(bare,undefined).includes('شغل إدارتي'),false);
});
