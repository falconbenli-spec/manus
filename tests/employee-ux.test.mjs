import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { openDb, transaction, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog, SERVICE_VARIANTS, variantCatalog, applyVariant, catalogServices } from '../app/service-catalog.mjs';
import { grantAccess, defaultCapabilities, capabilitiesFor } from '../app/access.mjs';
import { createApp } from '../app/server.mjs';
import * as wf from '../app/workflow.mjs';
import { serviceClock } from '../app/routing.mjs';
import { myRequests } from '../app/my-requests.mjs';
import { profileView, maskIban } from '../app/my-profile.mjs';
import { addDocument } from '../app/employees.mjs';
import { expiringSoon } from '../app/expiry.mjs';
import { grantLeaveOpening, createLeaveRequest } from '../app/leave.mjs';
import { submitClaim } from '../app/expenses.mjs';
import { requestCorrection } from '../app/attendance.mjs';
import { requestOvertime } from '../app/attendance-extras.mjs';
import { fileCase } from '../app/hr-cases.mjs';
import { requestTraining } from '../app/talent.mjs';
import { saveTemplate, approveTemplate, templatesBoard } from '../app/letters.mjs';
import { homeBoard } from '../app/home.mjs';
import { MODULE_ROUTES, KEPT_AS_REQUESTS, annotateCatalog } from '../app/module-routes.mjs';
import { parseDeepLink, DEEP_LINKS } from '../app/static/deep-links.mjs';
import { secureOrigin } from '../app/static/pwa.mjs';
import { searchVariants, mergeVariants, launcherResults, variantComposer } from '../app/static/request-picker.mjs';
import { operationModules } from '../app/static/operations.mjs';
import { profileUI } from '../app/static/profile-ui.mjs';
import { myRequestsUI } from '../app/static/my-requests-ui.mjs';
import { homeUI } from '../app/static/home-ui.mjs';
import { feedbackPanel } from '../app/static/service-quality-ui.mjs';
import { workFrames, dashboardHero, departmentDirectory } from '../app/static/hr-design.mjs';
// م0 «السور»: app.mjs يقرأ القاموس والعدّة عند تحميله، والصندوق يحذف الاستيراد فيمررهما كما يمرر operationModules.
import { REQUEST_STATUS, ROLE_NAMES } from '../app/static/vocabulary.mjs';
import { kit } from '../app/static/kit.mjs';
import { placeFor, HUBS, NO_PAGE_DEPARTMENTS, NAV_BUDGET, SECTIONS, navSections, sectionGroups } from '../app/static/nav-map.mjs';
import { HUB_VIEWS, HUB_OF, hubLinks, hubPage } from '../app/static/hubs-ui.mjs';

// الموظف أولًا (docs/implementation/handoff/employee-ux.md): «طلباتي» و«ملفي» والروابط العميقة ومدخل واحد للخدمة
// وقائمة الموظف والتطبيق القابل للتثبيت وبطاقات الخيارات. بيانات مصطنعة فقط.
const PASSWORD='synthetic-employee-ux';
const code=value=>error=>error.code===value;
const riyadh=(offset=0)=>new Date(Date.now()+3*3600000+offset*86400000).toISOString().slice(0,10);
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(t,{catalog=false}={}){
  const db=openDb(':memory:');seed(db,PASSWORD);if(catalog)installServiceCatalog(db);t.after(()=>db.close());
  const users=()=>Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,users:users(),refresh:users,tx:f=>transaction(db,f)};
}
async function http(t,db){
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=async who=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:who,password:PASSWORD})});assert.equal(r.status,200,who);const body=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:body.csrf,user:body.user};};
  const call=async(s,path,method='GET',data)=>{const r=await fetch(base+path,{method,headers:{...(s?{cookie:s.cookie,'x-csrf-token':s.csrf}:{}),'Content-Type':'application/json','Idempotency-Key':randomUUID()},...(data?{body:JSON.stringify(data)}:{})});
    const buffer=Buffer.from(await r.arrayBuffer());let body;try{body=JSON.parse(buffer.toString('utf8'));}catch{body=buffer;}return {status:r.status,body,headers:r.headers};};
  return {base,login,call};
}
const service=(db,codeName)=>wf.catalog(db,{tenant_id:'36t'}).find(s=>s.code===codeName);
function leaveCalendar(db,department='creative'){
  db.prepare("INSERT INTO leave_calendars VALUES(?,?,?,?,?,?,?,?,?,'Asia/Riyadh',1,?)").run(`${department}-2026`,'36t',department,'hr','تقويم مصطنع للاختبار','2026-01-01','2026-12-31','[0,1,2,3,4]','[]',now());
}

/* ───── 1. «طلباتي»: تجميع كل المصادر لصاحبها وحده ───── */
test('my requests: one list of the employee\'s own requests from every module, and nobody else\'s',async t=>{
  const {db,users,tx}=fixture(t);
  leaveCalendar(db);
  tx(()=>grantLeaveOpening(db,users.hr,{employee_id:'employee',leave_type:'annual',balance_year:2026,days:21,effective_date:'2026-01-01',reason:'رصيد افتتاحي مصطنع للاختبار',evidence:'بيانات اختبار محلية',calendar_id:'creative-2026'}));
  const leave=tx(()=>createLeaveRequest(db,users.employee,{leave_type:'annual',balance_year:2026,start_date:'2026-10-04',end_date:'2026-10-05',reason:'إجازة عائلية مصطنعة'}));
  const letter=service(db,'HR-LETTER');
  const draft=tx(()=>wf.createRequest(db,users.employee,{service_id:letter.id,title:'مسودة خطاب للبنك',payload:{purpose:'فتح حساب',recipient:'بنك تجريبي'}}));
  const sent=tx(()=>wf.createRequest(db,users.employee,{service_id:letter.id,title:'خطاب مقدم',payload:{purpose:'تأشيرة',recipient:'سفارة تجريبية'}}));
  tx(()=>wf.transition(db,users.employee,sent.id,'submit',{version:sent.version}));
  const claim=tx(()=>submitClaim(db,users.employee,{expense_date:riyadh(-1),category:'hospitality',description:'ضيافة اجتماع عميل تجريبي',amount:'230.00',receipt_reference:'INV-7781'}));
  const correction=tx(()=>requestCorrection(db,users.employee,{work_date:riyadh(-2),proposed_in:'09:00',proposed_out:'17:00',reason:'نسيت تسجيل الانصراف بعد اجتماع خارجي'}));
  const overtime=tx(()=>requestOvertime(db,users.employee,{work_date:riyadh(-1),minutes:60,reason:'إنهاء عرض العميل قبل الموعد'}));
  const hrCase=tx(()=>fileCase(db,users.employee,{category:'inquiry',subject:'استفسار عن البدل',description:'استفسار مصطنع عن بدل السكن في العقد التجريبي',respondent_id:null}));
  const training=tx(()=>requestTraining(db,users.employee,{user_id:'employee',title:'دورة تحليل البيانات',provider:'مزود تجريبي',kind:'course',hours:8,start_date:riyadh(20),end_date:riyadh(21),purpose:'تطوير مهارة التحليل'}));
  // زميلة في الفريق نفسه ومديرهما: لكل منهما طلبه، ولوحات وحدات المدير تعرض طلبات فريقه.
  const other=tx(()=>submitClaim(db,users.outsider,{expense_date:riyadh(-1),category:'transport',description:'مواصلات زميلة مصطنعة',amount:'40.00',receipt_reference:'INV-1'}));

  const mine=myRequests(db,users.employee),keys=new Set(mine.items.map(i=>i.key));
  for(const key of [`catalog:${draft.id}`,`catalog:${sent.id}`,`leave:${leave.id}`,`expense:${claim.id}`,`attendance_correction:${correction.id}`,`overtime:${overtime.id}`,`hr_case:${hrCase.id}`,`training:${training.id}`])
    assert.ok(keys.has(key),`missing ${key}`);
  assert.equal(keys.has(`expense:${other.id}`),false,'a colleague\'s claim never appears');
  assert.equal(mine.items[0].key,`catalog:${draft.id}`,'the draft waiting for her comes first');
  assert.equal(mine.items[0].needs_you,true);
  const leaveItem=mine.items.find(i=>i.source==='leave');
  assert.equal(leaveItem.status,'pending');assert.equal(leaveItem.link,'#leave');assert.equal(leaveItem.module_status,'بانتظار المدير');
  assert.equal(mine.items.find(i=>i.key===`catalog:${sent.id}`).status,'pending');
  assert.ok(mine.items.every(i=>i.link.startsWith('#')&&i.status_name&&i.source_name),'every row has a link, a status word and a source');
  assert.equal(mine.counts.all,mine.items.length);assert.equal(mine.counts.needs_you,1);

  // المدير يرى طلبات فريقه في شاشات الوحدات، لكن «طلباتي» له هو فقط.
  const managerKeys=new Set(myRequests(db,users.manager).items.map(i=>i.key));
  for(const key of keys)assert.equal(managerKeys.has(key),false,`the manager must not see ${key} in his own list`);
  assert.deepEqual(myRequests(db,users.outsider).items.map(i=>i.key),[`expense:${other.id}`]);

  // عبر الخادم: لا وسيط يغير صاحب القائمة.
  const {login,call}=await http(t,db),outsider=await login('outsider'),employee=await login('employee');
  const forged=await call(outsider,'/api/my-requests?user_id=employee');
  assert.equal(forged.status,200);assert.ok(forged.body.items.every(i=>!keys.has(i.key)));
  const own=await call(employee,'/api/my-requests');
  assert.equal(own.status,200);assert.equal(own.body.items.length,mine.items.length);
  assert.equal((await call(null,'/api/my-requests')).status,401);
  // الشاشة: كل عنوان مهرب، ولا undefined.
  const html=myRequestsUI.render(own.body,{e,tr:(ar)=>ar,lang:'ar',ui:kit(e)});
  assert.ok(!/\bundefined\b|\bNaN\b/.test(html.replace(/<[^>]+>/g,' ')));
  assert.match(html,/href="#request\//);assert.match(html,/href="#leave"/);
});

/* ───── 2. «ملفي»: أرقام مقنّعة، ولصاحبه وموظف الموارد البشرية وحدهما ───── */
test('my profile: numbers are masked, the owner and HR can open it, the line manager and colleagues cannot',async t=>{
  const {db,users,tx}=fixture(t,{catalog:true});
  const time=now();
  db.prepare("INSERT INTO employee_profiles(user_id,tenant_id,job_title,employment_type,join_date,status,version,updated_by,updated_at) VALUES('employee','36t','مصممة أولى','full_time','2024-03-01','active',1,'hr',?)").run(time);
  tx(()=>addDocument(db,users.hr,'employee',{doc_type:'iqama',reference:'آخر 4 أرقام 4412',expires_on:riyadh(40)}));
  tx(()=>addDocument(db,users.hr,'employee',{doc_type:'passport',reference:'آخر 4 أرقام 9031',expires_on:riyadh(400)}));
  db.prepare("INSERT INTO employee_bank_accounts(id,tenant_id,user_id,bank_name,iban,iban_last4,evidence,status,recorded_by,decided_by,decided_at,effective_month,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(),'36t','employee','بنك تجريبي','SEALED-FULL-IBAN-MUST-NOT-LEAK','7788','شهادة آيبان مصطنعة للاختبار','verified','hr','manager',time,'2026-09',time);

  const mine=profileView(db,users.employee),text=JSON.stringify(mine);
  assert.equal(mine.own,true);assert.equal(mine.job.job_title,'مصممة أولى');assert.equal(mine.job.hire_date,'2024-03-01');
  assert.equal(mine.job.manager,users.manager.name);assert.ok(mine.job.department);
  assert.deepEqual(mine.identity.map(d=>[d.doc_type,d.number_masked]).sort(),[['iqama','••••4412'],['passport','••••9031']]);
  assert.equal(mine.identity.find(d=>d.doc_type==='iqama').state,'expiring');
  assert.equal(mine.bank.current.iban_masked,'••••7788');assert.equal(maskIban('SA0380000000608010167519'),'••••7519');
  assert.ok(!text.includes('SEALED-FULL-IBAN'),'the stored IBAN column is never read into the page');
  assert.ok(!text.includes('آخر 4 أرقام'),'the stored reference is replaced by its mask');
  assert.deepEqual(mine.dependants,[],'the owner sees her dependants (none recorded here)');
  assert.ok(mine.change_services.find(s=>s.code==='HR-PROFILE-UPDATE').available,'changes go through the catalog request');

  // الخصوصية: المدير المباشر وزميلة الفريق لا يفتحانه، وموظف الموارد البشرية يفتحه.
  assert.throws(()=>profileView(db,users.manager,'employee'),code('not_found'));
  assert.throws(()=>profileView(db,users.outsider,'employee'),code('not_found'));
  assert.throws(()=>profileView(db,users.admin,'employee'),code('not_found'),'platform admin rights alone do not open a person\'s file');
  const officer=profileView(db,users.hr,'employee');
  assert.equal(officer.viewer_is_officer,true);assert.equal(officer.bank.current.iban_masked,'••••7788');assert.deepEqual(officer.dependants,[]);
  // صاحب employees.view الممنوح صراحة يفتح الملف، ولا يرى التابعين بلا hr.benefits.manage.
  tx(()=>grantAccess(db,users.admin,{user_id:'it',capability:'employees.view',note:'تصريح تجريبي'}));
  const granted=profileView(db,users.it,'employee');assert.equal(granted.dependants,null);assert.equal(granted.dependants_hidden,true);

  // B14: وثيقة الموظف نفسه في «انتهاء الوثائق» تفتح «ملفي» لا «السجل الوظيفي».
  assert.ok(expiringSoon(db,users.employee).filter(d=>d.scope==='own').every(d=>d.link==='#profile'));

  const {login,call}=await http(t,db);
  const employee=await login('employee'),manager=await login('manager'),hr=await login('hr');
  const own=await call(employee,'/api/profile');
  assert.equal(own.status,200);assert.ok(!JSON.stringify(own.body).includes('SEALED'));
  assert.equal((await call(manager,'/api/profile/employee')).status,404);
  assert.equal((await call(hr,'/api/profile/employee')).status,200);
  const html=profileUI.render(own.body,{e,tr:(ar)=>ar,lang:'ar'});
  assert.match(html,/••••4412/);assert.match(html,/data-action="new-request"/);
  assert.ok(!/<input|<textarea|<select/.test(html),'the profile page itself edits nothing');
  assert.ok(!/\bundefined\b|\bNaN\b/.test(html.replace(/<[^>]+>/g,' ')));
});

/* ───── 3. الروابط العميقة ───── */
test('deep links: each quick action opens a form, parameters only prefill known fields, and other routes are left alone',t=>{
  assert.deepEqual(['leave/new','letters/new','attendance/correction','expenses/new','hr-cases/new','growth/training'].map(h=>parseDeepLink('#'+h).operation),['create','request_letter','request_correction','submit_claim','file_case','request_training']);
  assert.equal(parseDeepLink('#payroll/latest').special,'payslip');
  assert.equal(parseDeepLink('#catalog/new').special,'launcher');
  const letter=parseDeepLink('#letters/new?type=salary');
  assert.equal(letter.valid,true);assert.deepEqual(letter.fields,{type_code:'salary'});assert.equal(letter.base,'#letters');
  const leave=parseDeepLink('#leave/new?type=annual&id=bal-1');
  assert.equal(leave.row,'bal-1');assert.deepEqual(leave.fields,{},'the leave type is chosen by the balance row, not a free field');
  assert.deepEqual(parseDeepLink('#letters/new?type=<script>').fields,{},'an unsafe value is dropped');
  for(const hash of ['#request/1d9713b2-0000','#departments/hr','#leave/delete','#home','','#constructor/new','#leave/__proto__'])assert.equal(parseDeepLink(hash).valid,false,hash);
  // كل رابط عميق يقود إلى شاشة مسجلة.
  for(const view of Object.keys(DEEP_LINKS))assert.ok(operationModules[view]||view==='catalog',view);
  // app.mjs يستدعيه محروسًا (الصندوق التجريبي بلا الوحدة) ويعيد العنوان إلى الشاشة بعد فتح النموذج.
  const app=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  assert.match(app,/typeof parseDeepLink!=='function'/);assert.match(app,/history\.replaceState\(null,'',link\.base\)/);
});
test('home: the Today card and quick actions are built for the employee, and an action the module cannot take is shown disabled with its reason',t=>{
  const {db,users,tx}=fixture(t);
  const home=homeBoard(db,users.employee);
  assert.equal(home.today_card.attendance.can_check_in,true);
  assert.equal(home.today_card.status.kind==='work'||home.today_card.status.kind==='off',true);
  const quick=Object.fromEntries(home.quick_actions.map(q=>[q.key,q]));
  // موجز المالك (30 سبتمبر 2026) البندان 1 و4: ما يُنشئ شيئًا ينتقل إلى قائمة «+ إنشاء» (create:true)، ويبقى
  // في الشريط ما ليس إنشاءً — «راتبي الجاي» قراءة، و«اسأل عن السياسة» سؤال. ولا مدخل لما لا نموذج له.
  assert.deepEqual(Object.keys(quick),['service','leave','letter','expense','custody','correction','overtime','mission','training','case','payslip','policy']);
  assert.deepEqual(home.quick_actions.filter(q=>!q.create).map(q=>q.key),['payslip','policy'],'غير الإنشاء يبقى شريحة في الشريط');
  assert.equal(quick.policy.ready,true);
  assert.equal(quick.leave.ready,false,'no balance: «طلب إجازة» is not ready, and never a dead link');
  assert.equal(quick.letter.ready,false,'no approved template: «طلب خطاب» is not ready');
  for(const q of home.quick_actions)assert.equal(parseDeepLink(q.link).valid,true,q.link);
  const html=homeUI.render(home,{e,tr:ar=>ar,lang:'ar'});
  assert.match(html,/data-action="punch" data-kind="in"/);assert.ok(!/#leave\/new/.test(html),'a chip that is not ready carries no link');
  // زرٌّ رئيسيٌّ واحد يفتح قائمةً واحدة، وبابٌ واحد إلى الدليل كله.
  assert.match(html,/data-action="create-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="create-menu"/);
  assert.match(html,/<div id="create-menu" class="hm-menu" role="menu" aria-label="إنشاء" hidden>/);
  assert.match(html,/<span class="hm-strip-card is-all"><a class="eu-chip" href="#services">/);
  assert.match(html,/role="menuitem" href="#attendance\/correction"/,'الجاهز بند برابطه فتعمل النقرة بلا جافاسكربت');
  // م0 «السور»: ما ليس جاهزًا لا يُحذف؛ يبقى بندًا معطّلًا وسببه الذي حسبه الخادم مكتوب فيه.
  assert.match(html,/<span role="menuitem" aria-disabled="true" tabindex="-1" data-quick="leave">.*?<small>لا رصيد إجازة متاح لك بعد<\/small>/);
  assert.match(html,/data-quick="letter">.*?<small>لا قالب خطاب معتمد بعد<\/small>/);
  assert.equal(homeBoard(db,users.admin).quick_actions.length,0);assert.equal(homeBoard(db,users.admin).today_card.attendance,null);
  // مع رصيد وقالب معتمد يظهر الزران.
  leaveCalendar(db);
  tx(()=>grantLeaveOpening(db,users.hr,{employee_id:'employee',leave_type:'annual',balance_year:2026,days:21,effective_date:'2026-01-01',reason:'رصيد افتتاحي مصطنع',evidence:'بيانات اختبار',calendar_id:'creative-2026'}));
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.letters.issue',note:'تصريح تجريبي'}));
  tx(()=>saveTemplate(db,users.hr,'salary',{body:'نفيد بأن {{employee_name}} يعمل لدينا.'}));
  tx(()=>approveTemplate(db,users.manager,'salary',{effective_from:riyadh(),note:'أعتمد صيغة هذا الخطاب كمالك إجراء',version:templatesBoard(db,users.hr).types.find(x=>x.code==='salary').draft.version}));
  const ready=Object.fromEntries(homeBoard(db,users.employee).quick_actions.map(q=>[q.key,q.ready]));
  assert.equal(ready.leave,true);assert.equal(ready.letter,true);
});

/* ───── 4. مدخل واحد: الخدمات المكررة تفتح نموذج وحدتها ───── */
test('catalog dedup: duplicated catalog services open their module form, keep their codes, and fall back to a request when the module cannot take it',async t=>{
  const {db,users,tx}=fixture(t,{catalog:true});
  const codes=new Set(wf.catalog(db,users.employee).map(s=>s.code));
  for(const r of MODULE_ROUTES){assert.ok(codes.has(r.code),`${r.code} stays in the catalog for search`);assert.ok(operationModules[r.module],r.module);}
  assert.equal(MODULE_ROUTES.length+KEPT_AS_REQUESTS.length>=13,true,'the audit\'s duplicated services are each routed or explained');
  const annotated=new Map(annotateCatalog(db,users.employee,wf.catalog(db,users.employee)).map(s=>[s.code,s]));
  assert.equal(annotated.get('ADM-EXPENSE-CLAIM').module_link,'#expenses/new');
  assert.equal(annotated.get('HR-ATTENDANCE-FIX').module_link,'#attendance/correction');
  assert.equal(annotated.get('HR-GRIEVANCE').module_link,'#hr-cases/new');
  assert.equal(annotated.get('HR-SALARY-CERT').module_link,undefined,'no approved letter template yet: the catalog request stays the path');
  assert.equal(annotated.get('TAL-PERFORMANCE-REVIEW').module_link,undefined,'no review cycle for her: the request stays');
  assert.equal(annotated.get('IT-SUPPORT').module_link,undefined,'services without a module are untouched');
  for(const s of annotated.values())if(s.module_link){const link=parseDeepLink(s.module_link);assert.ok(link.valid||operationModules[s.module_link.slice(1)],s.module_link);}
  assert.ok(annotateCatalog(db,users.admin,wf.catalog(db,users.admin)).every(s=>!s.module_link),'the admin configures services and is not redirected');
  // قالب خطاب معتمد: بطاقات الخطابات الثلاث تفتح «خطاباتي».
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.letters.issue',note:'تصريح تجريبي'}));
  tx(()=>saveTemplate(db,users.hr,'salary',{body:'نفيد بأن {{employee_name}} يعمل لدينا.'}));
  tx(()=>approveTemplate(db,users.manager,'salary',{effective_from:riyadh(),note:'أعتمد صيغة هذا الخطاب كمالك إجراء',version:templatesBoard(db,users.hr).types.find(x=>x.code==='salary').draft.version}));
  const after=new Map(annotateCatalog(db,users.employee,wf.catalog(db,users.employee)).map(s=>[s.code,s]));
  assert.equal(after.get('HR-SALARY-CERT').module_link,'#letters/new');assert.equal(after.get('HR-LETTER').module_link,'#letters/new');
  // البطاقة في الدليل رابط لا زر طلب عام.
  const departments=db.prepare('SELECT id,name,sector FROM departments WHERE tenant_id=?').all('36t');
  // ت1 (ق3/د1): مطالبة المصروفات تُعرض على رفّ المالية (ملكية عرض)، وتنفيذها كما هو.
  const html=launcherResults({departments,services:[...after.values()],me:{role:'employee',department_id:'finance'},selected:'finance',e});
  assert.match(html,/<a class="rq-row" href="#expenses\/new"/);
  assert.ok(!html.includes(`data-id="${after.get('ADM-EXPENSE-CLAIM').id}"`),'the duplicated service no longer opens a generic request');
  const {login,call}=await http(t,db),employee=await login('employee');
  const served=(await call(employee,'/api/catalog')).body;
  assert.equal(served.find(s=>s.code==='ADM-EXPENSE-CLAIM').module_link,'#expenses/new');
});

/* ───── 5. قائمة الموظف حسب الدور ───── */
async function navFor(me){
  const listeners={},nodes=new Map(),recorded={};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',open:false,classList:{add(){},remove(){}},querySelectorAll(){return [];},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const documentElement={dataset:{}};
  const sandbox={console,URL,Intl,Date,Uint8Array,location:{hash:'#home'},localStorage:{getItem(){return 'ar';},setItem(){}},crypto:{randomUUID},setTimeout(){},
    document:{querySelector:node,documentElement,addEventListener:(event,fn)=>{listeners[event]=fn;}},window:{addEventListener(){}},
    FormData:class{},feedbackPanel,workFrames,dashboardHero,departmentDirectory,REQUEST_STATUS,ROLE_NAMES,kit,brandLogo:'',mountScenes:()=>()=>{},operationModules:{},operationFields:()=>'',money:String,
    // ت1: القائمة الجانبية (items) مداخل ثابتة، وnavReach كل ما يصله الحساب اليوم بالشروط القائمة.
    placeFor,HUBS,NO_PAGE_DEPARTMENTS,SECTIONS,navSections,sectionGroups,HUB_VIEWS,HUB_OF,hubLinks,hubPage,
    groupedNavigation:(items)=>{recorded.items=items.map(i=>i[0]);return '';},
    fetch:async path=>{if(path==='/api/me')return {ok:true,json:async()=>({user:me,csrf:'test'}),text:async()=>JSON.stringify(({user:me,csrf:'test'}))};if(path==='/api/catalog')return {ok:true,json:async()=>[],text:async()=>JSON.stringify([])};throw Error(path);}};
  const source=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8').replace(/^import .+;$/gm,'');
  await runInNewContext('(async()=>{'+source+';globalThis.ui={render};})()',sandbox);
  await sandbox.ui.render();await setImmediate();
  return {items:Array.from(recorded.items),reach:Array.from(sandbox.navReach,n=>n[0]),audience:documentElement.dataset.audience};
}
test('navigation: an ordinary employee gets a short menu without development pages, gated by capability; other roles keep theirs',async t=>{
  const {db,users,tx}=fixture(t);
  const meFor=id=>({...users[id],can:capabilitiesFor(db,users[id]).list,capabilities:{finance:false},delivery_member:false});
  assert.equal(defaultCapabilities(users.employee).has('requirements.view'),false,'the scope register is no longer granted to everyone');
  const employee=await navFor(meFor('employee'));
  assert.equal(employee.audience,'employee');
  // ت2 (تغيّر مقصود، موجز المالك 30 سبتمبر 2026 البند 6): القائمة صارت الأقسام الثمانية الثابتة، والموظف العادي
  // لا يجد منها إلا أربعة — وكانت ثمانية صفوف في ت1 و31 قبلها. ما يصله الحساب (reach) باقٍ بشروطه القديمة حرفًا
  // بحرف، وكل شاشة فيه لها قسمٌ يفتحه من قائمته (tests/org-t1-nav.test.mjs وtests/nav-sections.test.mjs).
  assert.deepEqual(employee.items,['home','section/work','section/departments','section/services']);
  assert.ok(employee.items.length<=SECTIONS.length&&employee.items.length<=NAV_BUDGET.employee);
  for(const key of ['home','my-requests','notifications','leave','attendance','profile','payroll'])assert.ok(employee.reach.includes(key),`employee reach lacks ${key}`);
  // ‎#catalog‎ لغير الأدمن تحويلٌ إلى ‎#services‎ (ROUTE_ALIASES في app.mjs)، فكان المدخلان بابين إلى
  // شاشة واحدة في قائمة الموظف. حُذف مدخل catalog في 29 سبتمبر 2026 وبقيت الوجهة كما هي.
  assert.ok(employee.reach.includes('services'),'وجهة «الخدمات» باقية، وهي ما كان ‎#catalog‎ يفتحه أصلًا');
  assert.equal(employee.reach.includes('catalog'),false,'ولا يبقى المدخل المكرَّر إلى الوجهة نفسها');
  assert.ok(employee.reach.includes('portal'),'بوابة الموظف مدخل شخصي مستقل للحساب الذي يملك portal.use');
  for(const key of ['requirements','service-benchmark','catalog-quality','knowledge','service-cards','centres','departments','requests','my-request-timeline','assistants','clients','campaigns','expiry','call-sheets'])
    assert.equal(employee.reach.includes(key),false,`${key} must not be reachable from an ordinary employee's navigation`);
  // «مكتبة السياسات» بطاقة كل موظف بلا تصريح (ترحيل 110)، وموضعها الآن «المنظمة».
  assert.ok(employee.reach.includes('policy-library'),'the regulation is readable by every employee');
  // ت1 (تغيّر مقصود): «الخدمات» باب الموظف العادي أيضًا (كان #services مفتوحًا له بالرابط وحده)، فصار ما يصله 32 لا 31.
  assert.ok(employee.reach.includes('services'),'the services door is open to the ordinary employee');
  assert.ok(employee.reach.length<=32,`employee reach has ${employee.reach.length} screens (was 49 before B12, 31 before T1)`);
  const delivery=await navFor({...meFor('employee'),delivery_member:true});
  assert.ok(delivery.reach.includes('clients')&&delivery.reach.includes('time'),'an employee on a client team keeps the delivery screens');
  const manager=await navFor(meFor('manager'));
  assert.equal(manager.audience,'staff');
  for(const key of ['work','requests','departments','my-requests','knowledge'])assert.ok(manager.reach.includes(key),`manager reach lacks ${key}`);
  // ت2: «فريقي» لم يعد صفًّا بل مجموعةً في «الإدارات»، فالدعوى تنتقل من الصفّ إلى الشاشات: المدير يبلغ شاشات
  // فريقه، وصفُّ «الإدارات» هو بابها عنده. ومن يراها ومن لا يراها محروسٌ على placeFor في tests/org-t1-nav.test.mjs.
  for(const key of ['employees','discipline','delegations'])assert.ok(manager.reach.includes(key),`manager reach lacks ${key}`);
  assert.ok(manager.items.includes('section/departments'),manager.items.join(' '));
  assert.ok(manager.items.length<=SECTIONS.length&&manager.items.length<=NAV_BUDGET.manager,manager.items.join(' '));
  const admin=await navFor(meFor('admin'));
  assert.ok(admin.reach.includes('requirements')&&admin.reach.includes('service-benchmark'),'the platform admin keeps the development pages');
  // ت2: «إدارة المنصة» لم تعد صفًّا أخيرًا بل مجموعةً في «الإدارات» يراها الأدمن وحده. الذي كان يحرسه الصفّ —
  // أن شاشات المنصة للأدمن — يُحرس هنا على الشاشات نفسها: يبلغها هو ولا يبلغها الموظف.
  assert.ok(admin.items.includes('section/departments'),admin.items.join(' '));
  for(const key of ['accounts','feature-flags','jobs','mail','definitions','ai-governance']){
    assert.ok(admin.reach.includes(key),`admin reach lacks ${key}`);
    assert.equal(employee.reach.includes(key),false,`${key} must not be reachable from an ordinary employee's navigation`);
  }
  // الخادم يطبق التصريح نفسه على صفحتي التطوير.
  const {login,call}=await http(t,db),employeeSession=await login('employee'),adminSession=await login('admin');
  assert.equal((await call(employeeSession,'/api/requirements')).status,403);
  assert.equal((await call(employeeSession,'/api/service-benchmark')).status,403);
  assert.equal((await call(adminSession,'/api/requirements')).status,200);
  tx(()=>grantAccess(db,users.admin,{user_id:'employee',capability:'requirements.view',note:'منح صريح تجريبي'}));
  assert.equal((await call(employeeSession,'/api/requirements')).status,200,'an explicit grant opens it');
  // شريط التبويب على الجوال للجميع: الرئيسية، عملي، الخدمات، طلباتي، ثم «المزيد» (الفهرس).
  const signature=readFileSync(new URL('../app/static/signature.mjs',import.meta.url),'utf8');
  assert.match(signature,/employee:\['home','work','services','my-requests'\],staff:\['home','work','services','my-requests'\]/);
  assert.match(signature,/employee\?t\('المزيد','More'\)/);
  // الشارة: عدد غير المقروء من الخادم، لصاحبه.
  const count=await call(employeeSession,'/api/notifications/count');
  assert.equal(count.status,200);assert.equal(typeof count.body.unread,'number');
});

/* ───── 6. التطبيق القابل للتثبيت ───── */
const pngSize=buffer=>({signature:buffer.subarray(0,8).toString('hex'),width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)});
test('PWA: the manifest, icons and service worker are served with the right types, and the worker never caches /api',async t=>{
  const {db}=fixture(t),{call}=await http(t,db);
  const manifest=await call(null,'/manifest.webmanifest');
  assert.equal(manifest.status,200);assert.match(manifest.headers.get('content-type'),/^application\/manifest\+json/);
  const m=manifest.body;
  assert.equal(m.lang,'ar');assert.equal(m.dir,'rtl');assert.equal(m.start_url,'/#home');assert.equal(m.display,'standalone');assert.match(m.name,/3,6T/);
  assert.ok(m.theme_color&&m.user_preferences.color_scheme.light.theme_color&&m.user_preferences.color_scheme.dark.theme_color,'a theme colour per scheme');
  assert.ok(!JSON.stringify(m).includes('http'),'no external URL in the manifest');
  for(const icon of m.icons){
    const r=await call(null,icon.src);assert.equal(r.status,200,icon.src);assert.equal(r.headers.get('content-type'),'image/png');
    const size=pngSize(r.body),[w,h]=icon.sizes.split('x').map(Number);
    assert.equal(size.signature,'89504e470d0a1a0a');assert.deepEqual([size.width,size.height],[w,h],icon.src);
  }
  assert.ok(m.icons.some(i=>i.purpose==='maskable'));
  const sw=await call(null,'/sw.js');
  assert.equal(sw.status,200);assert.match(sw.headers.get('content-type'),/^text\/javascript/);assert.equal(sw.headers.get('cache-control'),'no-cache');
  assert.match(sw.headers.get('content-security-policy'),/default-src 'self'/,'the CSP is unchanged');
  const html=readFileSync(new URL('../app/static/index.html',import.meta.url),'utf8');
  assert.match(html,/<link rel="manifest" href="\/manifest\.webmanifest">/);
  // التسجيل في سياق آمن فقط.
  assert.equal(secureOrigin({protocol:'https:',hostname:'platform.example'}),true);
  assert.equal(secureOrigin({protocol:'http:',hostname:'localhost'}),true);
  assert.equal(secureOrigin({protocol:'http:',hostname:'10.0.0.5'}),false);
});
test('PWA: run inside a simulated worker, sw.js lets /api pass untouched, caches only static files, and serves an offline page for navigation',async()=>{
  const source=readFileSync(new URL('../app/static/sw.js',import.meta.url),'utf8');
  assert.ok(!/\beval\b|new Function/.test(source));
  const handlers={},puts=[],fetched=[];let online=true;
  const cache={put:async req=>{puts.push(typeof req==='string'?req:req.url);},add:async()=>{}};
  const self={location:{origin:'http://localhost:3690'},addEventListener:(type,fn)=>{handlers[type]=fn;},skipWaiting(){},clients:{claim(){}}};
  const sandbox={self,URL,Request:class{constructor(url){this.url=url;}},Response:class{constructor(body,init){this.body=body;this.status=init?.status??200;this.headers=init?.headers;}static error(){return {error:true};}},
    caches:{open:async()=>cache,keys:async()=>['36t-static-old','other-app'],match:async()=>null,delete:async()=>true},
    fetch:async request=>{fetched.push(request.url);if(!online)throw TypeError('offline');return {ok:true,type:'basic',clone(){return this;}};},Promise,console};
  runInNewContext(source,sandbox);
  const dispatch=async(url,mode='cors',method='GET')=>{let responded=null;handlers.fetch({request:{url,mode,method},respondWith:p=>{responded=p;}});return responded?await responded:null;};
  for(const path of ['/api/me','/api/home','/api/payroll/payslips/00000000-0000-0000-0000-000000000000/print','/verify/letter/ABC'])
    assert.equal(await dispatch('http://localhost:3690'+path),null,`${path} must not be intercepted`);
  assert.equal(await dispatch('https://evil.example/app.mjs'),null,'another origin is not handled');
  assert.equal(await dispatch('http://localhost:3690/api/x','cors','POST'),null);
  await dispatch('http://localhost:3690/app.mjs');await dispatch('http://localhost:3690/fonts/alexandria-arabic-400-normal.woff2');await dispatch('http://localhost:3690/icons/icon-192.png');
  await setImmediate();
  assert.deepEqual(puts.sort(),['http://localhost:3690/app.mjs','http://localhost:3690/fonts/alexandria-arabic-400-normal.woff2','http://localhost:3690/icons/icon-192.png']);
  assert.ok(puts.every(url=>!url.includes('/api/')));
  online=false;
  const offline=await dispatch('http://localhost:3690/','navigate');
  assert.equal(offline.status,503);assert.match(offline.body,/لا يوجد اتصال/);assert.match(offline.body,/لا يُسجَّل الحضور/);
  assert.match(offline.headers['Content-Security-Policy'],/script-src 'none'/);
  // الخروج يحذف نسخ المنصة وحدها (pwa.mjs يستدعي caches.delete بالبادئة نفسها).
  const pwa=readFileSync(new URL('../app/static/pwa.mjs',import.meta.url),'utf8');
  assert.match(pwa,/CACHE_PREFIX='36t-static-'/);assert.match(source,/'36t-static-'\+VERSION/);
  assert.match(readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8'),/action==='logout'\)\{await api\('\/logout'.*?clearOfflineCaches\(\)/);
});

/* ───── 7. بطاقات الخيارات ───── */
test('variants: the chosen option decides the service, the approval route and the due date',async t=>{
  const {db,refresh,tx}=fixture(t,{catalog:true}),users=refresh();
  const groups=variantCatalog(db,users.employee),it=groups.find(g=>g.code==='VAR-IT');
  assert.ok(it,'the devices card is offered');
  for(const optionCode of ['repair','device']){
    const option=it.options.find(o=>o.code===optionCode),expected=service(db,option.service_code);
    const draft=tx(()=>wf.createRequest(db,users.employee,applyVariant(db,users.employee,{title:`طلب ${option.name_ar}`,payload:{},variant:{group:'VAR-IT',option:optionCode}})));
    const row=db.prepare('SELECT s.code FROM requests r JOIN services s ON s.id=r.service_id WHERE r.id=?').get(draft.id);
    assert.equal(row.code,option.service_code,`${optionCode} creates a request on its own service`);
    const raw=db.prepare('SELECT * FROM requests WHERE id=?').get(draft.id);
    assert.equal(serviceClock(db,raw).target_days,expected.target_days,'the due date follows the option\'s service level');
  }
  // عبر الخادم: المتصفح يرسل الخيار، والخادم يحل الخدمة.
  const {login,call}=await http(t,db),employee=await login('employee');
  const served=(await call(employee,'/api/catalog/variants')).body;
  assert.deepEqual(served.map(g=>g.code),groups.map(g=>g.code));
  const created=await call(employee,'/api/requests','POST',{title:'صلاحية نظام',payload:{},variant:{group:'VAR-IT',option:'access'}});
  assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.service.code,'IT-ACCESS');
  assert.equal((await call(employee,'/api/requests','POST',{title:'خيار مجهول',payload:{},variant:{group:'VAR-IT',option:'teleport'}})).status,400);
});
test('variants: each option previews its own chain and service level before submit',t=>{
  const {db,refresh}=fixture(t,{catalog:true}),users=refresh();
  const groups=variantCatalog(db,users.employee);
  let checked=0;
  for(const g of groups)for(const o of g.options.filter(o=>o.service_code)){
    const s=service(db,o.service_code);
    assert.equal(o.preview.sla_days,s.target_days||null,`${g.code}/${o.code}: SLA`);
    assert.equal(o.preview.chain.length,s.approval_policy.steps.length,`${g.code}/${o.code}: chain`);
    assert.match(o.preview.text,s.approval_policy.steps.length?/^سيمر طلبك على: /:/^يصل طلبك مباشرة إلى /);
    if(s.target_days)assert.match(o.preview.text,/، خلال .*عمل.*\.$/);
    checked++;
  }
  assert.ok(checked>=15,`checked ${checked} options`);
  const hrLetter=groups.find(g=>g.code==='VAR-LETTER').options.find(o=>o.code==='salary');
  assert.match(hrLetter.preview.text,/الموارد البشرية/);
  const it=groups.find(g=>g.code==='VAR-IT').options;
  assert.equal(new Set(it.map(o=>o.service_code)).size,it.length,'each devices option routes to its own service');
});
test('variants: old service codes stay searchable and land on their card with the option preselected',t=>{
  const {db,refresh}=fixture(t,{catalog:true}),users=refresh();
  const groups=variantCatalog(db,users.employee);
  const hit=q=>{const [first]=searchVariants(groups,q);return first?`${first.group.code}/${first.option?.code??''}`:null;};
  assert.equal(hit('تعريف'),'VAR-LETTER/salary','«تعريف» lands on the letter card with the salary type chosen');
  assert.equal(hit('HR-SALARY-CERT'),'VAR-LETTER/salary','the old code is an alias');
  assert.equal(hit('شهادة خبرة'),'VAR-LETTER/experience');
  assert.equal(hit('IT-SUPPORT'),'VAR-IT/repair');
  assert.equal(hit('عنوان'),'VAR-PROFILE/address');
  assert.equal(hit('ايبان'),'VAR-PROFILE/bank');
  const services=wf.catalog(db,users.employee),merged=mergeVariants(services,groups);
  assert.equal(merged.some(s=>s.code==='HR-SALARY-CERT'),false,'the alias leaves the browse list');
  assert.ok(merged.some(s=>s.code==='VAR-LETTER'&&s.variant));
  assert.ok(services.some(s=>s.code==='HR-SALARY-CERT'),'but stays in the catalog, so existing requests and the API keep it');
  const departments=db.prepare('SELECT id,name,sector FROM departments WHERE tenant_id=?').all('36t');
  const html=launcherResults({departments,services,me:{role:'employee',department_id:'creative'},query:'تعريف',e,variants:groups});
  assert.match(html,/data-action="pick-variant" data-group="VAR-LETTER" data-option="salary"/);
  assert.ok(html.indexOf('VAR-LETTER')<html.indexOf('data-action="pick-service"')||!html.includes('data-action="pick-service"'),'the card comes before loose services');
});
test('variants: option fields are validated on the server; fixed values cannot be changed from the browser',async t=>{
  const {db,refresh,tx}=fixture(t,{catalog:true}),users=refresh();
  // كل قيمة ثابتة في البيانات تطابق حقول خدمتها في الدليل الكامل.
  for(const g of SERVICE_VARIANTS)if(Array.isArray(g.options))for(const o of g.options){
    if(!o.service)continue;
    const model=catalogServices.find(s=>s.code===o.service)??(o.service==='HR-LETTER'?{fields:[]}:null);
    assert.ok(model||service(db,o.service),`${g.code}/${o.code}: ${o.service} is a real catalog service`);
    for(const [key,value] of Object.entries(o.preset??{})){const f=(model?.fields??service(db,o.service).fields).find(x=>x.key===key);assert.ok(f&&(f.type!=='select'||f.options.includes(value)),`${g.code}/${o.code}: preset ${key}`);}
  }
  const profile=variantCatalog(db,users.employee).find(g=>g.code==='VAR-PROFILE'),address=profile.options.find(o=>o.code==='address');
  assert.equal(address.fields.some(f=>f.key==='change_type'),false,'the fixed field is not shown');
  assert.ok(address.docs.length,'the option lists its required documents');
  const input={title:'تحديث العنوان الوطني',payload:{change_type:'أخرى',details:'العنوان الوطني الجديد: حي تجريبي، الرياض'},variant:{group:'VAR-PROFILE',option:'address'}};
  const draft=tx(()=>wf.createRequest(db,users.employee,applyVariant(db,users.employee,input)));
  assert.equal(JSON.parse(db.prepare('SELECT payload FROM requests WHERE id=?').get(draft.id).payload).change_type,'بيانات التواصل','the preset overrides what the browser sent');
  assert.throws(()=>applyVariant(db,users.employee,{...input,variant:{group:'VAR-PROFILE',option:'nope'}}),code('variant_unknown'));
  assert.throws(()=>applyVariant(db,users.employee,{...input,variant:{group:'VAR-NONE',option:'address'}}),code('variant_unknown'));
  assert.throws(()=>applyVariant(db,users.employee,{...input,service_id:service(db,'IT-SUPPORT').id}),code('variant_mismatch'));
  assert.throws(()=>applyVariant(db,users.employee,{...input,variant:{group:'VAR-LETTER',option:'embassy'}}),code('variant_module'),'a module-only option is not a generic request');
  assert.throws(()=>applyVariant(db,users.employee,{...input,variant:{group:'VAR-PROFILE',option:'address',extra:1}}),code('invalid_fields'));
  assert.deepEqual(applyVariant(db,users.employee,{title:'بلا خيار',payload:{}}),{title:'بلا خيار',payload:{}},'a request without a variant is untouched');
  // الحقول المطلوبة للخيار تُفرض عند التقديم كأي طلب.
  const empty=tx(()=>wf.createRequest(db,users.employee,applyVariant(db,users.employee,{title:'ناقص',payload:{},variant:{group:'VAR-PROFILE',option:'qualifications'}})));
  assert.throws(()=>tx(()=>wf.transition(db,users.employee,empty.id,'submit',{version:empty.version})),error=>error.status===400);
  // نموذج الخيار: اختيار النوع أولًا، وحقول الخيار بلا الثابت منها، ومعاينة المسار، وإرسال الخيار مع الطلب.
  const departments=db.prepare('SELECT id,name,sector FROM departments WHERE tenant_id=?').all('36t');
  const html=variantComposer({group:profile,option:address,service:service(db,'HR-PROFILE-UPDATE'),departments,projects:[],e,fieldInput:f=>`<label data-field="${f.key}"></label>`});
  assert.match(html,/role="radiogroup"/);assert.match(html,/aria-checked="true"[^>]*data-option="address"/);
  assert.match(html,/name="variant_group" value="VAR-PROFILE"/);assert.match(html,/name="variant_option" value="address"/);
  assert.ok(!html.includes('data-field="change_type"'));assert.match(html,/data-field="details"/);
  assert.match(html,/سيمر طلبك على: /);assert.match(html,/المستندات المطلوبة/);
  // خيار «إجازة» من أرصدة الموظف يفتح نموذج إجازاتي على رصيده.
  leaveCalendar(db,users.employee.department_id);
  tx(()=>grantLeaveOpening(db,users.hr,{employee_id:'employee',leave_type:'annual',balance_year:2026,days:21,effective_date:'2026-01-01',reason:'رصيد افتتاحي مصطنع',evidence:'بيانات اختبار',calendar_id:`${users.employee.department_id}-2026`}));
  const leave=variantCatalog(db,users.employee).find(g=>g.code==='VAR-LEAVE');
  assert.ok(leave,'the leave card appears once there is a balance');
  const annual=leave.options.find(o=>o.code==='annual');
  assert.equal(annual.mode,'module');assert.equal(parseDeepLink(annual.link).operation,'create');assert.ok(parseDeepLink(annual.link).row);
  const {login,call}=await http(t,db),employee=await login('employee');
  const tampered=await call(employee,'/api/requests','POST',{...input,title:'عبر الخادم'});
  assert.equal(tampered.status,201);assert.equal(tampered.body.payload.change_type,'بيانات التواصل');
});

// دمج 20260919: رابط الخطاب العميق (101) يختار زر النوع في معالج الخطابات (102) بعقد route() نفسه، ولا يفتح نوعًا آخر مكان نوع غير متاح.
test('integration: #letters/new?type= opens the letter wizard on that type, and never on another type',()=>{
  for(const type of ['salary','employment','experience','embassy','bank','to_whom']){
    const link=parseDeepLink(`#letters/new?type=${type}`);
    assert.equal(link.row,operationModules.letters.route(new URLSearchParams(`type=${type}`)).id);assert.equal(link.exactRow,true);
    assert.equal(link.operation,operationModules.letters.route(new URLSearchParams(`type=${type}`)).action);
  }
  assert.equal(parseDeepLink('#letters/new').exactRow,false);
  assert.equal(parseDeepLink('#leave/new?type=annual&id=bal-1').exactRow,false,'a leave balance row keeps the first-button fallback');
  const app=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  assert.match(app,/link\.exactRow\?null:buttons\[0\]/);
});

// دمج 20260919: بطاقة «مزايا» (101) تقود إلى «مزاياي» (103)، والرابط العميق يفتح خيارًا بعينه بزر الشاشة نفسه.
test('integration: the benefits card offers «مزاياي» and #my-benefits/new?option= opens that option only',async t=>{
  const {db,users}=fixture(t,{catalog:true});
  const card=variantCatalog(db,users.employee).find(g=>g.code==='VAR-BENEFITS');
  const portal=card.options.find(o=>o.code==='my_benefits');
  assert.equal(portal.link,'#my-benefits');assert.equal(portal.mode,'module');
  assert.equal((variantCatalog(db,users.admin).find(g=>g.code==='VAR-BENEFITS')?.options??[]).some(o=>o.code==='my_benefits'),false,'the technical admin has no benefits');
  const link=parseDeepLink('#my-benefits/new?option=ticket_claim');
  assert.equal(link.valid,true);assert.equal(link.operation,'request_option');assert.equal(link.row,'ticket_claim');assert.equal(link.exactRow,true);assert.equal(link.base,'#my-benefits');
  const { myBenefitsUI } = await import('../app/static/benefits-portal-ui.mjs');
  assert.equal(operationModules['my-benefits'],myBenefitsUI);
});
