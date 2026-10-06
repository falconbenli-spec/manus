import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { seedHrDemo } from '../scripts/seed-hr-demo.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { REPORTS, reportsIndex, saveSnapshot, readSnapshot, snapshotAction, runReport, snapshotAudience } from '../app/reports.mjs';
import { inbox } from '../app/inbox.mjs';
import { createApp } from '../app/server.mjs';
import { grantLeaveOpening, createLeaveRequest, leaveAction, listLeave, leaveTypeName } from '../app/leave.mjs';
import { portal } from '../app/routing.mjs';
import { homeBoard } from '../app/home.mjs';
import * as wf from '../app/workflow.mjs';
import { submitClaim, claimAction } from '../app/expenses.mjs';
import { requestCorrection, decideCorrection } from '../app/attendance.mjs';
import { saveTemplate, approveTemplate, templatesBoard, requestLetter, letterAction, lettersBoard } from '../app/letters.mjs';
import { preparePolicy, decidePolicy } from '../app/hr-contracts.mjs';
import { acknowledgementsBoard, openRound, acknowledgePolicy } from '../app/policy-acknowledgements.mjs';
import { operationModules, operationFields } from '../app/static/operations.mjs';
import { dateRange } from '../app/notices.mjs';

// انحدارات تدقيق بوابة الموظف (docs/product/audits/EMPLOYEE-PORTAL-AUDIT-20260919.md): B1 وB2 وB4 وB5 وB6 وB7.
const PASSWORD='synthetic-portal-audit-fixes';
const code=value=>error=>error.code===value;
const riyadh=(offset=0)=>new Date(Date.now()+3*3600000+offset*86400000).toISOString().slice(0,10);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(t,{hr=false}={}){
  const db=openDb(':memory:');seed(db,PASSWORD);if(hr)seedHrDemo(db);t.after(()=>db.close());
  // مدير ثانٍ في إدارة أخرى، ومسؤول تنفيذي يحمل executive.view بلا تفويض مالي.
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('it-manager','36t','it','it-manager','مدير الدعم التجريبي','unused','manager',NULL),('ceo','36t','ops','ceo','الرئيس التنفيذي التجريبي','unused','employee',NULL)").run();
  const users=()=>Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users().admin,{user_id:'ceo',capability:'executive.view',note:'مسؤول تنفيذي تجريبي لاختبار اللقطات'}));
  return {db,users:users(),tx};
}

/* ───── B1: لقطات التقارير لا تتسرب ───── */
test('B1: an employee cannot list, open, approve, print or export a colleague\'s R11 snapshot, and its creator still can',async t=>{
  const {db,users,tx}=fixture(t);
  // المدير ينشئ مشروعًا ليست الموظفة عضوًا فيه، ثم يحفظ لقطة R11 تحوي اسمه.
  tx(()=>createProject(db,users.manager,{name:'مشروع سري للعميل س',brief:'مشروع تجريبي لاختبار تسرب اللقطات',member_ids:['outsider']}));
  const id=tx(()=>saveSnapshot(db,users.manager,'R11',{})).id;
  assert.ok(readSnapshot(db,users.manager,id).rows.some(r=>JSON.stringify(r).includes('مشروع سري')),'the creator opens her own snapshot');
  assert.deepEqual(reportsIndex(db,users.manager).snapshots.find(s=>s.id===id).actions,['discard_snapshot']);
  assert.ok(runReport(db,users.employee,'R11',{}).rows.every(r=>!JSON.stringify(r).includes('مشروع سري')),'her own live R11 does not show it');
  // الموظفة: لا في القائمة، ولا فتح، ولا اعتماد، ولا في صندوق القرارات.
  assert.equal(reportsIndex(db,users.employee).snapshots.some(s=>s.id===id),false);
  assert.throws(()=>readSnapshot(db,users.employee,id),code('not_found'));
  assert.throws(()=>tx(()=>snapshotAction(db,users.employee,id,'approve_snapshot',{note:'اعتماد من موظفة لا يحق لها'})),code('not_found'));
  assert.equal(inbox(db,users.employee).groups.some(g=>g.key==='reports'),false,'B2: no snapshot decision reaches her inbox');
  assert.equal(db.prepare('SELECT status FROM report_snapshots WHERE id=?').get(id).status,'draft');
  // الطباعة وCSV وXLSX تمر بالفحص نفسه عبر الخادم.
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,session=async who=>{
    const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:who,password:PASSWORD})});
    assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
  };
  const employee=await session('employee'),manager=await session('manager');
  for(const file of ['print','export.csv','export.xlsx']){
    const denied=await fetch(`${base}/api/reports/snapshots/${id}/${file}`,{headers:{cookie:employee}});
    assert.equal(denied.status,404,`${file} is refused to the employee`);assert.equal((await denied.text()).includes('مشروع سري'),false);
    const allowed=await fetch(`${base}/api/reports/snapshots/${id}/${file}`,{headers:{cookie:manager}});
    assert.equal(allowed.status,200,`${file} works for the creator`);
  }
  const listed=await (await fetch(base+'/api/reports',{headers:{cookie:employee}})).json();
  assert.equal(listed.snapshots.some(s=>s.id===id),false);
  assert.ok(verifyAudit(db));
});

test('B1/B2: the holder of executive.view sees and approves a manager\'s scoped snapshot; the creator cannot approve it',t=>{
  const {db,users,tx}=fixture(t);
  tx(()=>createProject(db,users.manager,{name:'مشروع للمراجعة التنفيذية',brief:'مشروع تجريبي',member_ids:['outsider']}));
  const id=tx(()=>saveSnapshot(db,users.manager,'R11',{})).id;
  const row=reportsIndex(db,users.ceo).snapshots.find(s=>s.id===id);
  assert.deepEqual(row.actions,['approve_snapshot']);
  assert.ok(inbox(db,users.ceo).groups.find(g=>g.key==='reports')?.items.some(i=>i.id===id),'the approver finds it in her inbox');
  assert.throws(()=>tx(()=>snapshotAction(db,users.manager,id,'approve_snapshot',{note:'اعتماد من مُعد اللقطة نفسه'})),code('separation_of_duties'));
  tx(()=>snapshotAction(db,users.ceo,id,'approve_snapshot',{note:'راجعت المشاريع والمهام المتأخرة'}));
  assert.equal(readSnapshot(db,users.ceo,id).snapshot.status,'approved');
});

test('B1: a manager\'s department-scoped R07 snapshot reaches executive.view only, and an all-department snapshot never reaches a manager',t=>{
  const {db,users,tx}=fixture(t);
  const scoped=tx(()=>saveSnapshot(db,users.manager,'R07',{})).id;
  assert.ok(readSnapshot(db,users.manager,scoped));
  assert.ok(runReport(db,users['it-manager'],'R07',{}),'the other manager may run R07 for her own department');
  assert.throws(()=>readSnapshot(db,users['it-manager'],scoped),code('not_found'),'but not open a colleague\'s department snapshot');
  assert.equal(reportsIndex(db,users['it-manager']).snapshots.length,0);
  assert.throws(()=>tx(()=>snapshotAction(db,users['it-manager'],scoped,'approve_snapshot',{note:'اعتماد من مدير إدارة أخرى'})),code('not_found'));
  assert.throws(()=>readSnapshot(db,users.employee,scoped),code('not_found'));
  assert.ok(readSnapshot(db,users.ceo,scoped),'executive.view covers every department');
  const company=tx(()=>saveSnapshot(db,users.ceo,'R07',{})).id;
  assert.match(readSnapshot(db,users.ceo,company).notes.join(' '),/كل الإدارات/);
  for(const who of ['manager','it-manager','employee'])assert.throws(()=>readSnapshot(db,users[who],company),code('not_found'),`${who} cannot open the company-wide snapshot`);
  // من فقد حق التقرير لا يفتح حتى لقطته هو.
  db.prepare("UPDATE users SET role='employee' WHERE id='manager'").run();
  assert.throws(()=>readSnapshot(db,{...users.manager,role:'employee'},scoped),code('not_found'));
});

test('B1: an R01 snapshot carrying the finance section stays with finance-cleared executives',t=>{
  const {db,users,tx}=fixture(t);
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('cfo','36t','ops','cfo','مدير مالي تنفيذي تجريبي','unused','employee',NULL)").run();
  const all=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  tx(()=>grantAccess(db,users.admin,{user_id:'cfo',capability:'executive.view',note:'تنفيذي بتفويض مالي تجريبي'}));
  db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t','cfo','employee','read','2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض قراءة مالية مصطنع',null,now());
  const withFinance=tx(()=>saveSnapshot(db,all.cfo,'R01',{})).id,without=tx(()=>saveSnapshot(db,all.ceo,'R01',{})).id;
  assert.ok(readSnapshot(db,all.cfo,withFinance).rows.some(r=>r.area==='المالية'));
  assert.throws(()=>readSnapshot(db,all.ceo,withFinance),code('not_found'),'an executive without finance rights does not see the finance section through a snapshot');
  assert.ok(readSnapshot(db,all.cfo,without),'a snapshot without the finance section is open to every executive');
});

// R43 (تسليم المؤثرين) وR45 (جولات المراجعة) من الحزمة 4 مقصوران على عضوية فريق العميل وعضوية المشروع كشاشتيهما، فهما «creator» أيضًا.
test('B1: every report declares who may see a snapshot of it; only the membership-scoped reports (client team or project team) are creator-only',()=>{
  const creatorOnly=REPORTS.filter(r=>snapshotAudience(r.key)==='creator').map(r=>r.key).sort();
  assert.deepEqual(creatorOnly,['R15','R19','R20','R21','R22','R43','R45']);
  assert.ok(REPORTS.every(r=>['uniform','executive','executive_finance','creator'].includes(snapshotAudience(r.key))));
  assert.equal(snapshotAudience('R99'),'creator','an unclassified report fails closed');
});

/* ───── B4 وB25: رصيد الإجازة الصحيح بأسماء الأنواع ───── */
function leaveFixture(t){
  const f=fixture(t),{db,users,tx}=f;
  db.prepare("INSERT INTO leave_calendars VALUES(?,?,?,?,?,?,?,?,?,'Asia/Riyadh',1,?)").run('creative-2026','36t','creative','hr','تقويم مصطنع للاختبار','2026-01-01','2026-12-31','[0,1,2,3,4]','[]',now());
  const open=(leave_type,days)=>tx(()=>grantLeaveOpening(db,users.hr,{employee_id:'employee',leave_type,balance_year:2026,days,effective_date:'2026-01-01',reason:'رصيد افتتاحي مصطنع للاختبار',evidence:'بيانات اختبار محلية',calendar_id:'creative-2026'}));
  const act=(who,r,action)=>tx(()=>leaveAction(db,users[who],r.id,action,{version:r.version,note:'قرار اختبار مصطنع'}));
  return {...f,open,act};
}
test('B4: الرئيسية and ملخصي show the available leave days per type, with Arabic type names instead of codes',t=>{
  const {db,users,tx,open,act}=leaveFixture(t);
  open('annual',21);open('sick',5);
  let r=tx(()=>createLeaveRequest(db,users.employee,{leave_type:'annual',balance_year:2026,start_date:'2026-10-04',end_date:'2026-10-05',reason:'إجازة اختبار محلية'}));
  r=act('manager',r,'approve');r=act('hr',r,'approve');assert.equal(r.status,'approved');
  const summary=portal(db,users.employee,{requests:[],projects:[],leave:listLeave(db,users.employee)}).leave;
  const annual=summary.find(b=>b.type_code==='annual'),sick=summary.find(b=>b.type_code==='sick');
  assert.equal(annual.remaining,19,'ملخصي: 21 opening − 2 approved days, not blank');
  assert.equal(annual.type,'الإجازة السنوية');assert.equal(sick.type,'الإجازة المرضية');assert.equal(sick.remaining,5);
  const home=homeBoard(db,users.employee);
  assert.equal(home.cards.find(c=>c.key==='leave').value,19,'الرئيسية card: the annual balance, not 0 and not annual+sick');
  assert.deepEqual(home.leave.map(b=>[b.type,b.remaining]).sort(),[['الإجازة السنوية',19],['الإجازة المرضية',5]]);
  // حجز قائم يُخصم من المتاح ويُذكر.
  tx(()=>createLeaveRequest(db,users.employee,{leave_type:'annual',balance_year:2026,start_date:'2026-10-11',end_date:'2026-10-11',reason:'إجازة يوم واحد للاختبار'}));
  const held=portal(db,users.employee,{requests:[],projects:[],leave:listLeave(db,users.employee)}).leave.find(b=>b.type_code==='annual');
  assert.deepEqual([held.remaining,held.reserved],[18,1]);
  assert.equal(leaveTypeName('synthetic_annual'),'الإجازة السنوية (رصيد تجريبي)');
  assert.equal(leaveTypeName('custom_x'),'نوع إجازة آخر (custom_x)');
  const board=listLeave(db,users.hr);
  assert.ok(board.balances.every(b=>b.leave_type_name&&!/^[a-z_]+$/.test(b.leave_type_name)));
  const opening=operationModules.leave.form('opening','creative-2026',{...board,user:users.hr});
  const typeField=opening.fields.find(f=>f.name==='leave_type');
  assert.equal(typeField.type,'select');assert.equal(typeField.value,'annual');assert.ok(typeField.options.some(o=>o.label==='الإجازة السنوية'));
});

/* ───── B5: إقرار السياسة من الشاشة ───── */
test('B5: ticking «اطلعت على نص هذه النسخة» sends confirm:true, and the server accepts the acknowledgement',t=>{
  const {db,users,tx}=fixture(t);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.policy.accept',note:'تجريبي'}));
  const policyId=tx(()=>preparePolicy(db,users.hr,{kind:'working_time',title:'ساعات العمل التجريبية',body:'يبدأ الدوام التجريبي الثامنة صباحًا.',basis:'قرار تجريبي للاختبار فقط',effective_from:riyadh(),parameters:{workdays:[0,1,2,3,4],start:'08:00',end:'16:00',grace_minutes:15}})).id;
  tx(()=>decidePolicy(db,users.manager,policyId,'accept',{note:'اعتماد تجريبي'}));
  const roundId=tx(()=>openRound(db,users.manager,{policy_id:policyId,audience:'role',audience_value:'employee',due_on:riyadh(7)})).id;
  const data=acknowledgementsBoard(db,users.employee),spec=operationModules['policy-acknowledgements'].form('acknowledge_policy',roundId,data);
  const html=operationFields(spec.fields,esc),box=html.match(/<input[^>]*name="confirm"[^>]*>/)[0];
  assert.match(box,/type="checkbox"/);assert.match(box,/value="on"/,'a ticked box submits "on", as FormData does');assert.doesNotMatch(box,/value=""/);
  // FormData: خانة مؤشرة تضيف قيمتها، وغير المؤشرة لا تضيف شيئًا.
  const ticked=spec.toPayload({confirm:box.match(/value="([^"]*)"/)[1]}),unticked=spec.toPayload({});
  assert.equal(ticked.confirm,true);assert.equal(unticked.confirm,false);
  assert.throws(()=>tx(()=>acknowledgePolicy(db,users.employee,roundId,unticked)),code('confirm'));
  const ack=tx(()=>acknowledgePolicy(db,users.employee,roundId,ticked));
  assert.equal(ack.policy_revision,spec.toPayload({confirm:'on'}).policy_revision);
  assert.match(operationFields([{name:'x',label:'خانة',type:'checkbox',value:true}],esc),/value="on" checked/,'a true value renders ticked');
});

/* ───── B6 وB7: الإشعارات ───── */
test('migration 096: notifications take a nullable request_id and a subject, and existing rows survive the rebuild',t=>{
  const {db,users,tx}=fixture(t);
  const columns=Object.fromEntries(db.prepare('PRAGMA table_info(notifications)').all().map(c=>[c.name,c]));
  assert.equal(columns.request_id.notnull,0);for(const name of ['subject_kind','subject_id','title','body'])assert.ok(columns[name],name);
  assert.throws(()=>db.prepare("INSERT INTO notifications(id,user_id,kind,created_at) VALUES('x','employee','orphan',?)").run(now()),/CHECK/,'a notification without a request needs a subject and a title');
  // صف بالشكل القديم (بلا عنوان) يبقى بعد إعادة البناء كما هو، ويُقرأ بعنوان الطلب.
  const services=wf.catalog(db,users.employee),request=tx(()=>wf.createRequest(db,users.employee,{service_id:services.find(s=>s.code==='IT-SUPPORT').id,title:'طابعة الطابق الثاني',payload:{issue:'تعذر الطباعة',impact:'يمنع العمل'}}));
  db.prepare("INSERT INTO notifications(id,user_id,request_id,kind,read_at,created_at) VALUES('legacy','employee',?,'execution_completed','2026-09-01T00:00:00.000Z','2026-08-31T00:00:00.000Z')").run(request.id);
  tx(()=>db.exec(readFileSync(new URL('../app/migrations/096-notifications-subjects.sql',import.meta.url),'utf8')));
  const kept=db.prepare("SELECT * FROM notifications WHERE id='legacy'").get();
  assert.deepEqual([kept.request_id,kept.kind,kept.read_at,kept.created_at],[request.id,'execution_completed','2026-09-01T00:00:00.000Z','2026-08-31T00:00:00.000Z']);
  const shown=wf.notifications(db,users.employee).find(n=>n.id==='legacy');
  assert.equal(shown.title,'اكتمل طلبك «طابعة الطابق الثاني»');assert.equal(shown.link,`#request/${request.id}`);
});

test('B7: request notifications carry the request title and outcome, the requester gets a receipt, and cancelling does not notify yourself',t=>{
  const {db,users,tx}=fixture(t);
  const services=wf.catalog(db,users.employee),make=title=>tx(()=>wf.createRequest(db,users.employee,{service_id:services.find(s=>s.code==='IT-SUPPORT').id,title,payload:{issue:'تعذر تشغيل الجهاز',impact:'يمنع العمل'}}));
  const act=(who,r,action,note='')=>tx(()=>wf.transition(db,users[who],r.id,action,{version:r.version,note}));
  let r=act('employee',make('جهاز لا يعمل'),'submit');
  const mine=()=>wf.notifications(db,users.employee).filter(n=>n.request_id===r.id).map(n=>n.title);
  assert.deepEqual(mine(),['استلمنا طلبك «جهاز لا يعمل»'],'receipt on submit');
  assert.ok(wf.notifications(db,users.manager).some(n=>n.title==='طلب ينتظر قرارك: «جهاز لا يعمل»'));
  r=act('manager',r,'approve');
  assert.ok(mine().includes('اعتُمد طلبك «جهاز لا يعمل»'));
  r=act('it',r,'claim');r=act('it',r,'complete','تم إصلاح الجهاز');
  assert.ok(mine().includes('بدأ تنفيذ طلبك «جهاز لا يعمل»')&&mine().includes('اكتمل طلبك «جهاز لا يعمل»'));
  assert.equal(new Set(mine()).size,mine().length,'no two identical rows for one request');
  let back=act('employee',make('شاشة مكسورة'),'submit');back=act('manager',back,'return','أرفق صورة الشاشة');
  assert.ok(wf.notifications(db,users.employee).some(n=>n.title==='أُعيد إليك طلبك «شاشة مكسورة» للتعديل'&&/معاد/.test(n.body)));
  let no=act('employee',make('برنامج غير مرخص'),'submit');no=act('manager',no,'reject','البرنامج غير معتمد');
  const rejected=wf.notifications(db,users.employee).find(n=>n.request_id===no.id&&n.kind==='decision_updated');
  assert.equal(rejected.title,'رُفض طلبك «برنامج غير مرخص»');assert.equal(rejected.body.includes('البرنامج غير معتمد'),false,'the approver\'s free note stays on the request page');
  let gone=act('employee',make('طلب سأسحبه'),'submit');gone=act('employee',gone,'cancel');
  assert.equal(wf.notifications(db,users.employee).some(n=>n.request_id===gone.id&&n.kind==='request_updated'),false);
});

test('B6: leave decisions notify the employee in plain Arabic with the dates, and the next approver is told',t=>{
  const {db,users,tx,open,act}=leaveFixture(t);open('annual',21);
  let r=tx(()=>createLeaveRequest(db,users.employee,{leave_type:'annual',balance_year:2026,start_date:'2026-10-04',end_date:'2026-10-05',reason:'إجازة اختبار محلية'}));
  const range=dateRange('2026-10-04','2026-10-05');assert.match(range,/^من 4 إلى 5 أكتوبر/);
  const titles=who=>wf.notifications(db,users[who]).map(n=>n.title);
  assert.ok(titles('employee').includes(`استلمنا طلب إجازتك ${range}`));
  assert.ok(titles('manager').includes(`طلب إجازة ينتظر قرارك: الموظفة التجريبية ${range}`));
  r=act('manager',r,'approve');
  assert.ok(titles('employee').includes(`وافق مديرك على إجازتك ${range}`));
  assert.ok(titles('hr').includes(`طلب إجازة ينتظر اعتمادك: الموظفة التجريبية ${range}`));
  r=act('hr',r,'approve');
  const approved=wf.notifications(db,users.employee).find(n=>n.kind==='leave_approved');
  assert.equal(approved.title,`اعتُمدت إجازتك ${range}`);assert.equal(approved.body,'خُصم 2 يوم عمل من رصيد الإجازة السنوية.');
  assert.equal(approved.link,'#leave');assert.equal(approved.request_id,null);assert.equal(approved.subject_kind,'leave_request');
  let back=tx(()=>createLeaveRequest(db,users.employee,{leave_type:'annual',balance_year:2026,start_date:'2026-11-01',end_date:'2026-11-01',reason:'إجازة ستعاد للتعديل'}));
  back=act('manager',back,'return');
  assert.ok(titles('employee').includes(`أُعيد إليك طلب إجازتك ${dateRange('2026-11-01','2026-11-01')} للتعديل`));
  assert.equal(titles('outsider').length,0,'nobody else reads her leave notices');
  // الإشعار يُعلَّم مقروءًا كغيره.
  tx(()=>wf.markNotification(db,users.employee,approved.id));
  assert.ok(wf.notifications(db,users.employee).find(n=>n.id===approved.id).read_at);
});

test('B6: expense, custody, attendance-correction and letter decisions notify their owner, without amounts or identity numbers',t=>{
  const {db,users,tx}=fixture(t,{hr:true});
  const claim=tx(()=>submitClaim(db,users.employee,{expense_date:riyadh(-1),category:'hospitality',description:'ضيافة اجتماع عميل تجريبي',amount:'230.00',receipt_reference:'INV-7781'}));
  const version=()=>db.prepare('SELECT version FROM expense_claims WHERE id=?').get(claim.id).version;
  tx(()=>claimAction(db,users.manager,claim.id,'manager_approve',{version:version(),note:'غرض الضيافة صحيح'}));
  const expense=wf.notifications(db,users.employee).find(n=>n.subject_kind==='expense_claim');
  assert.match(expense.title,/^أقرّ مديرك مطالبة المصروف \(ضيافة، /);assert.equal(expense.body,'الحالة: بانتظار اعتماد المالية.');
  assert.equal(/230/.test(expense.title+expense.body),false,'no amount in the notice');assert.equal(expense.link,'#expenses');
  const correction=tx(()=>requestCorrection(db,users.employee,{work_date:riyadh(-2),proposed_in:'09:00',proposed_out:'17:00',reason:'نسيت تسجيل الانصراف بعد اجتماع خارجي'})).id;
  tx(()=>decideCorrection(db,users.manager,correction,'approve',{note:'تحققت من الاجتماع'}));
  const attendance=wf.notifications(db,users.employee).find(n=>n.subject_kind==='attendance_correction');
  assert.match(attendance.title,/^اعتُمد تصحيح حضورك ليوم /);assert.equal(attendance.link,'#attendance');
  // خطاب تعريف: يُعد ثم يصدر من شخص آخر؛ الإشعار يذكر النوع والرقم المرجعي فقط.
  for(const [user,capability] of [['manager','hr.letters.issue']])tx(()=>grantAccess(db,users.admin,{user_id:user,capability,note:'تصريح تجريبي'}));
  const draft=code=>templatesBoard(db,users.hr).types.find(x=>x.code===code).draft;
  tx(()=>saveTemplate(db,users.hr,'salary',{body:'نفيد بأن {{employee_name}} يعمل لدينا وإجمالي راتبه الشهري {{salary_total}}.'}));
  tx(()=>approveTemplate(db,users.manager,'salary',{effective_from:riyadh(),note:'أعتمد صيغة هذا الخطاب وأتحملها كمالك إجراء',version:draft('salary').version}));
  const letterId=tx(()=>requestLetter(db,users.employee,{type_code:'salary',purpose:'فتح حساب بنكي'})).id;
  const request=()=>lettersBoard(db,users.hr).requests.find(x=>x.id===letterId);
  tx(()=>letterAction(db,users.hr,letterId,'prepare_letter',{version:request().version,note:'طوبق على العقد'}));
  const issued=tx(()=>letterAction(db,users.manager,letterId,'issue_letter',{version:request().version,note:'صدر'}));
  const letter=wf.notifications(db,users.employee).find(n=>n.kind==='letter_issued');
  assert.match(letter.title,/^صدر خطابك: /);assert.ok(letter.body.includes(issued.reference));
  const salary=db.prepare("SELECT body FROM letters WHERE request_id=?").get(letterId).body.match(/[\d,]{4,}(?:\.\d+)?/g)??[];
  for(const figure of salary.filter(x=>x!==issued.reference.split('-')[1]))assert.equal((letter.title+letter.body).includes(figure),false,'the salary in the letter never reaches the notice');
  assert.equal(/\b\d{10}\b/.test(letter.title+letter.body),false,'no national ID or iqama number');
  // من اتخذ القرار لا يصله إشعار عن قراره.
  assert.equal(wf.notifications(db,users.manager).some(n=>['expense_claim','attendance_correction','letter_request'].includes(n.subject_kind)),false);
  assert.ok(verifyAudit(db));
});
