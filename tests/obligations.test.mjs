import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { seedVendorsDemo } from '../scripts/seed-vendors-demo.mjs';
import { seedHrDemo } from '../scripts/seed-hr-demo.mjs';
import { seedPayrollDemo } from '../scripts/seed-payroll-demo.mjs';
import { seedOperationsDemo } from '../scripts/seed-operations-demo.mjs';
import { createApp } from '../app/server.mjs';
import { obligations } from '../app/obligations.mjs';
import { inbox, inboxCount, clearInboxCache, SOURCES, labelFor, recordLink, INBOX_COVERAGE, SCREENS_WITHOUT_QUEUE, INBOX_PAGE } from '../app/inbox.mjs';
import { homeBoard, card } from '../app/home.mjs';
import { workBoard, addPersonalTask } from '../app/workspace.mjs';
import { createRequest, transition, catalog, escalateApproval, setServiceSection, setServiceTarget, stepArrivedAt } from '../app/workflow.mjs';
import { assignRequestTask } from '../app/routing.mjs';
import { createProject, createTask } from '../app/projects.mjs';
import { recordDecision, createCommitment } from '../app/governance.mjs';
import { grantAccess } from '../app/access.mjs';
import { recordFeedback } from '../app/service-feedback.mjs';
import { reminderSettings, setReminderSettings, runDailyReminders } from '../app/reminders.mjs';
import { parseFocus } from '../app/static/focus-record.mjs';
import { inboxUI } from '../app/static/inbox-ui.mjs';
import { workBoard as workBoardView } from '../app/static/work-ui.mjs';

// كل ما هنا مصطنع: حسابات seed التجريبية وطلبات ومهام لا وجود لها خارج قاعدة بيانات الاختبار.
const PASSWORD='synthetic-obligations-only';
const PERSONAS=['employee','manager','hr','it','admin','outsider'];
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=days=>new Date(Date.parse(day()+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);

function base(t,{demo=false}={}){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  if(demo){seedVendorsDemo(db);seedHrDemo(db);seedPayrollDemo(db);seedOperationsDemo(db);}
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const service=code=>catalog(db,users.admin).find(s=>s.code===code);
  const raise=(actor,code,title,payload,submit=true)=>tx(()=>{
    const created=createRequest(db,actor,{service_id:service(code).id,title,payload});
    return submit?transition(db,actor,created.id,'submit',{version:created.version,note:''}):created;
  });
  const act=(actor,r,action,note='')=>tx(()=>transition(db,actor,r.id,action,{version:r.version,note}));
  return {db,users,tx,raise,act};
}
// مشهد فيه من كل سلة شيء: قرار، وطلب معاد، ومسودة، واستبيان اختياري، ومهام طلب ومشروع وخاصة، والتزام قرار، وطابور إدارة.
function scene(t){
  const f=base(t,{demo:true}),{db,users,tx,raise,act}=f;
  const letter={purpose:'غرض مصطنع','recipient':'جهة مصطنعة'},fault={issue:'لا يعمل',impact:'يمنع العمل'};
  f.pending=raise(users.employee,'HR-LETTER','خطاب ينتظر المدير',letter);
  let returned=raise(users.outsider,'HR-LETTER','خطاب سيعاد إلى صاحبه',letter);
  returned=act(users.manager,returned,'approve');f.returned=act(users.hr,returned,'return','ينقصه اسم الجهة كاملًا');
  f.draft=raise(users.employee,'HR-LETTER','مسودة لم تُقدَّم',letter,false);
  let done=raise(users.employee,'IT-SUPPORT','عطل أُنجز وينتظر سؤال التجربة',fault);
  done=act(users.manager,done,'approve');done=act(users.it,done,'claim');f.done=act(users.it,done,'complete','استُبدل الكابل وعاد الجهاز للعمل');
  let queued=raise(users.outsider,'IT-SUPPORT','عطل في طابور الدعم',fault);f.queued=act(users.manager,queued,'approve');
  let running=raise(users.employee,'IT-SUPPORT','عطل يباشره منفذ الدعم',fault);
  running=act(users.manager,running,'approve');running=act(users.it,running,'claim');
  f.running=tx(()=>assignRequestTask(db,users.it,running.id,{version:running.version,title:'فحص مزود الطاقة',assignee_id:'it',due_date:shift(2),acceptance:'يعمل الجهاز ساعة كاملة بلا انقطاع'}));
  f.project=tx(()=>createProject(db,users.manager,{name:'مشروع اختبار المهام',brief:'مشروع مصطنع لاختبار قائمة المهام بلا سقف',member_ids:['employee']}));
  f.projectTasks=[];for(let i=1;i<=8;i++)f.projectTasks.push(tx(()=>createTask(db,users.manager,f.project.id,{title:`مهمة مشروع ${i}`,assignee_id:'employee',due_date:shift(i-3),acceptance:'معيار قبول مصطنع كافٍ'})));
  f.personal=[tx(()=>addPersonalTask(db,users.employee,{title:'مهمة خاصة بموعد',list:'today',due_date:shift(-1)})),tx(()=>addPersonalTask(db,users.employee,{title:'مهمة خاصة بلا موعد',list:'later'}))];
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'governance.decisions.record',note:'تصريح حوكمة مصطنع للاختبار'}));
  const decision=tx(()=>recordDecision(db,users.manager,{title:'قرار تجريبي لاختبار الالتزامات',context:'سياق تجريبي كافٍ الطول للاختبار',alternatives:'البديل الأول تنفيذ فوري والثاني تأجيل شهرًا',
    decision:'تأجيل الحملة شهرًا واحدًا لإعادة التسعير',impact:'الأثر المتوقع تأخر الإيراد شهرًا مقابل هامش أفضل',decided_by:'manager',decided_on:shift(-20),reference:'مرجع تجريبي',minute_id:null,reverses_id:null,reversal_reason:''}));
  f.commitment=tx(()=>createCommitment(db,users.manager,{decision_id:decision.id,minute_id:null,title:'إعادة تسعير الباقة قبل الإطلاق',detail:'',owner_id:'employee',due_date:shift(-5)}));
  clearInboxCache();
  return f;
}
// يؤرّخ وصول الخطوة الأولى بأثر رجعي في قاعدة الاختبار وحدها: نسخ الطلب لا تُعدَّل (مشغّل version_no_update)، فيُرفع المشغّل لسطر واحد ثم يُعاد.
function backdateArrival(db,requestId,iso){
  const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='version_no_update'").get().sql;
  db.exec('DROP TRIGGER version_no_update');
  db.prepare('UPDATE request_versions SET created_at=? WHERE request_id=?').run(iso,requestId);
  db.prepare('UPDATE requests SET created_at=?,updated_at=? WHERE id=?').run(iso,iso,requestId);
  db.exec(trigger);
}

test('obligations: for six personas the home decisions card, counts.decide, the nav badge and the #work decisions list are one number',t=>{
  const {db,users}=scene(t);
  let seen=0;
  for(const id of PERSONAS){
    clearInboxCache();
    const mine=obligations(db,users[id]),home=homeBoard(db,users[id]),work=workBoard(db,users[id]),badge=inboxCount(db,users[id]),box=inbox(db,users[id]);
    const tile=home.cards.find(c=>c.key==='decisions');
    assert.equal(tile.value,mine.counts.decide,`${id}: home tile = counts.decide`);
    assert.equal(badge.total,mine.counts.decide,`${id}: nav badge = counts.decide`);
    assert.equal(work.decisions.length,mine.counts.decide,`${id}: #work decisions list = counts.decide`);
    assert.equal(box.total,mine.counts.decide,`${id}: #inbox total = counts.decide`);
    assert.equal(home.decisions.length,tile.value,`${id}: the tile is the length of the list under it`);
    assert.equal(box.groups.reduce((n,g)=>n+g.total,0),box.total,`${id}: the groups add up to the total`);
    assert.deepEqual(work.counts,mine.counts);assert.deepEqual(home.obligation_counts,mine.counts);
    seen+=mine.counts.decide;
  }
  assert.ok(seen>10,'the scene gives the personas real decisions to agree on, not six zeros');
  const manager=homeBoard(db,users.manager);
  const approvals=manager.cards.find(c=>c.key==='request_approvals');
  assert.equal(approvals.title,'طلبات تنتظر اعتمادي');
  assert.equal(approvals.value,manager.decisions.filter(d=>d.source==='requests').length,'the manager tile is the requests subset of «أقرّر»');
  assert.ok(approvals.value>=1&&approvals.value<manager.cards.find(c=>c.key==='decisions').value,'a subset, named as one — never a second definition of the same phrase');
  assert.equal(manager.manager.pending_approvals.length,manager.decisions.length,'the block the page titles «اعتماداتي المعلقة» can no longer say none while decisions wait');
});

test('obligations: the nav badge endpoint serves the same number, cached per user and cleared by a write',async t=>{
  const {db,users,raise}=scene(t);
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root=`http://127.0.0.1:${server.address().port}`;
  const signIn=await fetch(root+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'manager',password:PASSWORD})});
  const cookie=signIn.headers.get('set-cookie').split(';')[0];
  const count=async()=>(await fetch(root+'/api/inbox/count',{headers:{cookie}})).json();
  const first=await count(),expected=obligations(db,users.manager).counts.decide;
  assert.equal(first.total,expected);
  assert.equal((await (await fetch(root+'/api/home',{headers:{cookie}})).json()).cards.find(c=>c.key==='decisions').value,expected);
  assert.equal((await (await fetch(root+'/api/work',{headers:{cookie}})).json()).decisions.length,expected);
  raise(users.employee,'HR-LETTER','طلب وصل بعد حفظ العداد',{purpose:'غرض','recipient':'جهة'});
  assert.equal((await count()).total,expected,'the badge is held for twenty seconds per user');
  clearInboxCache('manager');
  assert.equal((await count()).total,expected+1,'and the invalidation every successful write performs brings the new number');
});

test('obligations: card() throws when handed a number',()=>{
  assert.throws(()=>card('decisions','ما ينتظر قراري',6,'#inbox'),/تأخذ القائمة/);
  assert.equal(card('decisions','ما ينتظر قراري',[1,2,3],'#inbox').value,3);
});

test('obligations: every module that can emit an approve-type action has an inbox source or a written reason — the next missing queue fails loudly',()=>{
  // فعل من نوع الاعتماد: approve_* / accept_* / decide_* وما سُبق بجهة (hr_approve، finance_approve…).
  const ACTION=/'((?:(?:hr|finance|manager|authority)_approve|approve|accept|decide)(?:_[a-z0-9_]+)?)'/g;
  const files=readdirSync(new URL('../app/',import.meta.url)).filter(f=>f.endsWith('.mjs'));
  const source=readFileSync(new URL('../app/inbox.mjs',import.meta.url),'utf8');
  // «requests» مجموعة طلبات الدليل التي تبنيها obligations.mjs من خطوات الاعتماد المعلقة، لا مصدرًا في الماشي.
  const keys=new Set([...SOURCES.map(([key])=>key),'requests']),emitting=new Set(),gaps=[];
  for(const file of files){
    if(file==='inbox.mjs')continue;
    // اسم السلة «decide» عند قرّاء «ما عليّ» (bucket==='decide') ليس فعل لوحة.
    const code=readFileSync(new URL('../app/'+file,import.meta.url),'utf8').replace(/bucket\s*(?:===\s*|\()'decide'/g,'');
    const found=[...new Set([...code.matchAll(ACTION)].map(m=>m[1]))];
    if(!found.length)continue;
    emitting.add(file);
    if(source.includes(`from './${file}'`))continue;
    const entry=INBOX_COVERAGE[file];
    if(!entry){gaps.push(`${file}: ${found.join(', ')}`);continue;}
    assert.ok(typeof entry.reason==='string'&&entry.reason.trim().length>=30,`${file}: the exemption needs a written reason, not a flag`);
    assert.ok(entry.inbox===false||keys.has(entry.via),`${file}: either inbox:false or via:<an existing source key>`);
  }
  assert.deepEqual(gaps,[],'a board with an approve-type action and neither an inbox source nor a written reason:\n'+gaps.join('\n'));
  for(const file of Object.keys(INBOX_COVERAGE)){
    assert.ok(emitting.has(file),`${file}: a coverage entry for a module that emits no approve-type action is stale`);
    assert.ok(!source.includes(`from './${file}'`)||INBOX_COVERAGE[file].partial===true,`${file}: it is a source now; drop the exemption, or mark it partial and say which action stays out`);
  }
  // الطوابير التي سمّتها خطة الموجة 1 ناقصة: لكل منها مصدر، أو سبب مكتوب لأن لوحتها لا تعرض فعل اعتماد.
  for(const key of ['forms','project-handover','project-receipt','project-kickoff','change-requests','discipline','resignations','travel','hr-cases','benefits-admin'])
    assert.ok(keys.has(key)||(SCREENS_WITHOUT_QUEUE[key]??'').length>=30,`${key}: neither a source nor a reason`);
  assert.equal(new Set(SOURCES.map(([key])=>key)).size,SOURCES.length,'source keys are unique');
  // أفعال الطوابير الجديدة لها عنوان، و«الرد على تظلم» لا يقع على رأس «answer» فيُسمّى سؤال تجربة.
  for(const action of ['accept_resignation','approve_travel','approve_extension','approve_form','approve_handover','approve_receipt','decide_finance','decide_case','take_case','hr_approve','finance_approve','authority_approve','accept_benefit','approve_permission','accept_notice','approve_exemption','approve_site','approve_assignment_budget','accept_policy','decide_threshold'])
    assert.ok(labelFor(action),`${action}: an approve-type action with no label never reaches the inbox`);
  assert.equal(labelFor('answer_grievance'),'الرد على تظلم');assert.notEqual(labelFor('answer_grievance'),labelFor('answer'));
});

test('obligations: whoever must accept a resignation is told — a queue that had no inbox source, so nobody was',async t=>{
  const {db,users,tx}=base(t);
  const {submitResignation,resignationsBoard}=await import('../app/resignations.mjs');
  // قبول الاستقالة لصاحب الصلاحية (hr.contracts.approve): تصريح حساس يُمنح صراحة.
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.contracts.approve',note:'صاحب صلاحية مصطنع لاختبار صندوق الاستقالات'}));
  const filed=tx(()=>submitResignation(db,users.employee,{letter_date:day(),proposed_last_day:shift(45),reason:'سبب مصطنع لاختبار الصندوق'})).id;
  assert.ok(resignationsBoard(db,users.manager).awaiting_me.some(r=>r.id===filed),'the module always knew who it waits on');
  const item=obligations(db,users.manager).items.find(i=>i.source==='resignations');
  assert.ok(item,'and now «أقرّر» says so');
  assert.equal(item.bucket,'decide');assert.equal(item.id,filed);assert.equal(item.link,`#resignations?focus=${filed}`);
  assert.ok(item.actions.includes('قبول استقالة'));assert.equal(item.kind,'استقالة');
  assert.equal(inbox(db,users.manager).groups.find(g=>g.key==='resignations').total,1);
  assert.equal(obligations(db,users.employee).items.some(i=>i.source==='resignations'),false,'its author is not asked to decide it');
  assert.equal(obligations(db,users.it).items.some(i=>i.source==='resignations'),false,'nor is a colleague with no authority over it');
});

test('obligations: 100% of items carrying an id deep-link to that record, never to the bare screen',t=>{
  const {db,users}=scene(t);
  let checked=0;const sources=new Set();
  for(const id of PERSONAS){
    const mine=obligations(db,users[id]);
    for(const i of mine.items){
      for(const field of ['bucket','source','kind','title','context','link','since','due_on','due_basis','overdue','owner_of_record','unblocks','optional'])assert.ok(field in i,`${i.source}: every item carries «${field}»`);
      assert.ok(['decide','respond','do'].includes(i.bucket));
      if(!i.id)continue;
      checked++;sources.add(i.source);
      assert.ok(i.link.includes(encodeURIComponent(i.id)),`${id}/${i.source}: «${i.title}» links to ${i.link}, not to its record ${i.id}`);
      assert.notEqual(i.link,`#${i.source}`,'the record link is never overwritten with the screen key');
      const parsed=parseFocus(i.link);
      if(i.link.includes('?focus='))assert.equal(parsed.focus,i.id,'the generic handler reads back the same id');
    }
    for(const g of inbox(db,users[id]).groups)for(const i of g.items)if(i.id)assert.ok(i.link.includes(encodeURIComponent(i.id)),`#inbox ${g.key}: ${i.link}`);
    for(const w of mine.watching)assert.ok(w.link.includes(encodeURIComponent(w.id)),`watching ${w.source}: ${w.link}`);
  }
  assert.ok(checked>30&&sources.size>=8,`links checked on ${checked} items from ${sources.size} sources`);
  assert.equal(recordLink('leave',{id:'a b/c'}),'#leave?focus=a%20b%2Fc');assert.equal(recordLink('leave',{id:''}),'#leave','an item with no id has only its screen');
  assert.deepEqual(parseFocus('#leave?focus=a%20b%2Fc'),{path:'leave',view:'leave',focus:'a b/c'});
  assert.deepEqual(parseFocus('request/123'),{path:'request/123',view:'request',focus:null});
});

test('obligations: no optional item is ever late or counted — a satisfaction survey, a reopen prompt and my own draft do not make a first-day employee overdue',t=>{
  const {db,users,tx,raise,act}=base(t);
  let done=raise(users.employee,'IT-SUPPORT','عطل أُنجز',{issue:'لا يعمل',impact:'يمنع العمل'});
  done=act(users.manager,done,'approve');done=act(users.it,done,'claim');done=act(users.it,done,'complete','استُبدل الكابل وعاد الجهاز للعمل');
  raise(users.employee,'HR-LETTER','مسودة قديمة',{purpose:'غرض','recipient':'جهة'},false);
  // بعد شهرين: كل ما ينتظر هذا الموظف اختياري، فلا رقم ولا تأخر — وكان يُقال له «ينتظر قرارك، متأخر».
  const later=Date.now()+60*86400000,mine=obligations(db,users.employee,{at:later});
  const optional=mine.items.filter(i=>i.optional);
  assert.ok(optional.some(i=>i.kind==='مسودة طلب'),'the draft is listed');
  assert.ok(optional.some(i=>i.source==='my-request-timeline'),'the survey or reopen prompt is listed');
  assert.ok(optional.every(i=>i.bucket==='respond'&&i.overdue===false&&i.due_on===null&&i.due_basis==='optional'),'optional: never late, no due date');
  assert.deepEqual(mine.counts,{decide:0,respond:0,do:0,late:0},'and never counted');
  clearInboxCache();
  const home=homeBoard(db,users.employee);
  assert.equal(home.cards.find(c=>c.key==='decisions').value,0);assert.equal(home.cards.some(c=>c.key==='respond'),false,'no «ما ينتظر ردّي» tile for optional items');
  assert.deepEqual(inboxCount(db,users.employee),{total:0,late:0,respond:0,do:0});
  assert.equal(workBoard(db,users.employee).optional.length,optional.length,'#work shows them apart, as optional');
  // الإجابة عن السؤال تُخرج بنده؛ والاختياري لا يدخل تذكير القرارات المتأخرة.
  tx(()=>recordFeedback(db,users.employee,done.id,{version:done.version,rating:5,comment:''}));
  const reminded=tx(()=>runDailyReminders(db,'36t',day(),later));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='employee' AND kind='approvals_overdue'").get().n,0);
  assert.equal(reminded.approvals.sent,0);
  for(const id of PERSONAS)for(const i of obligations(db,users[id],{at:later}).items.filter(x=>x.optional))assert.equal(i.overdue,false);
});

test('obligations: waiting age runs from when the step reached the person, in working days — pressing follow-up does not reset it',t=>{
  const {db,users,tx,raise}=base(t);
  const r=raise(users.employee,'HR-LETTER','خطاب ينتظر منذ أيام',{purpose:'غرض','recipient':'جهة'});
  const arrived=new Date(Date.now()-10*86400000).toISOString();backdateArrival(db,r.id,arrived);
  const item=()=>obligations(db,users.manager).items.find(i=>i.id===r.id&&i.bucket==='decide');
  const before=item();
  assert.equal(before.since,arrived,'since = the arrival of my pending step');
  assert.ok(before.age_days>=6&&before.age_days<=8,`ten calendar days are six to eight working days, got ${before.age_days}`);
  assert.equal(before.due_basis,'working_days_waiting');assert.equal(before.overdue,true);
  const raw=db.prepare('SELECT * FROM requests WHERE id=?').get(r.id);
  assert.equal(stepArrivedAt(db,raw,db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND status='pending' ORDER BY position LIMIT 1").get(r.id)),arrived);
  // المتابعة ترفع updated_at إلى الآن؛ العمر القديم كان يُقرأ منه فيعود صفرًا ويسكت التذكير الآلي.
  tx(()=>escalateApproval(db,users.employee,r.id,{version:raw.version,note:'تأخر الرد على الخطوة'}));
  const touched=db.prepare('SELECT updated_at FROM requests WHERE id=?').get(r.id).updated_at;
  assert.ok(touched>arrived,'the follow-up did bump updated_at');
  const after=item();
  assert.equal(after.since,before.since);assert.equal(after.age_days,before.age_days,'chasing an approval does not cancel the automatic chase');
  assert.equal(after.overdue,true);
  const reminded=tx(()=>runDailyReminders(db,'36t',day()));
  assert.equal(reminded.approvals.sent,1,'the daily reminder still fires for the approver after the follow-up');
  assert.ok(db.prepare("SELECT body FROM notifications WHERE user_id='manager' AND kind='approvals_overdue'").get().body.includes('3 أيام عمل'));
  // خطوة ثانية في مسار متسلسل: وصولها قرار الخطوة التي قبلها، لا تقديم الطلب.
  const approved=tx(()=>transition(db,users.manager,r.id,'approve',{version:db.prepare('SELECT version FROM requests WHERE id=?').get(r.id).version,note:''}));
  const hrItem=obligations(db,users.hr).items.find(i=>i.id===r.id&&i.bucket==='decide');
  assert.equal(hrItem.since,approved.approvals.find(a=>a.status==='approved').decided_at);assert.equal(hrItem.age_days,0,'the second approver is not blamed for the first one’s ten days');
  assert.equal(hrItem.unblocks.startsWith('بدء التنفيذ لدى'),true);
});

test('obligations: honest time — no flat three calendar days: a weekend is not waiting, an approved holiday is not waiting, and a service target sets the due date',t=>{
  const {db,users,tx,raise}=base(t);
  const r=raise(users.employee,'HR-LETTER','خطاب قُدّم يوم خميس',{purpose:'غرض','recipient':'جهة'});
  backdateArrival(db,r.id,'2026-03-05T07:00:00.000Z'); // الخميس 5 مارس 2026
  const at=iso=>obligations(db,users.manager,{at:Date.parse(iso)}).items.find(i=>i.id===r.id);
  const sunday=at('2026-03-08T07:00:00.000Z');
  assert.equal(sunday.age_days,1,'Thursday to Sunday is one working day; Friday and Saturday are not waiting');
  assert.equal(sunday.overdue,false,'three calendar days are not three working days');
  assert.equal(sunday.due_on,'2026-03-10');assert.equal(sunday.due_basis,'working_days_waiting');
  assert.equal(at('2026-03-10T07:00:00.000Z').overdue,true,'late on the third working day, by the owner’s setting');
  db.prepare("INSERT INTO public_holidays(id,tenant_id,holiday_date,name,basis,status,proposed_by,decided_by,decided_at,created_at) VALUES('h-test','36t','2026-03-09','عطلة مصطنعة','أساس مصطنع لاختبار تقويم العمل','approved','hr','manager',?,?)").run(new Date().toISOString(),new Date().toISOString());
  const held=at('2026-03-10T07:00:00.000Z');
  assert.equal(held.age_days,2);assert.equal(held.overdue,false,'an approved holiday is not a working day');assert.equal(held.due_on,'2026-03-11');
  // المالك يغيّر المدة فيتغيّر الحكم؛ ويوقفها فلا يوصف بالتأخر ما لا موعد له.
  tx(()=>setReminderSettings(db,users.admin,{pending_approval_days:1,manager_digest:true,basis:'قرار المالك التجريبي بيوم عمل واحد'}));
  assert.equal(at('2026-03-08T07:00:00.000Z').overdue,true);
  tx(()=>setReminderSettings(db,users.admin,{pending_approval_days:null,manager_digest:true,basis:'قرار المالك التجريبي بإيقاف المدة',version:reminderSettings(db,'36t').version}));
  const unlimited=at('2026-06-01T07:00:00.000Z');
  assert.equal(unlimited.overdue,false);assert.equal(unlimited.due_basis,'none');assert.equal(unlimited.due_on,null);
  // خدمة لها زمن مستهدف: الموعد موعدها من ساعتها (أيام عمل، دون العطل)، لا مدة الانتظار العامة.
  tx(()=>{setServiceSection(db,users.admin,'HR-LETTER','خطابات',10);setServiceTarget(db,users.admin,'HR-LETTER',2);});
  const targeted=at('2026-03-08T07:00:00.000Z');
  assert.equal(targeted.due_basis,'service_target');assert.equal(targeted.due_on,'2026-03-10','two working days after Thursday, skipping the weekend and the holiday');
});

test('obligations: the «مهامي» tile equals what #work shows — request tasks, project tasks with no cap, personal tasks, my commitments and the department queue',t=>{
  const f=scene(t),{db,users}=f;
  const mine=obligations(db,users.employee),doing=mine.items.filter(i=>i.bucket==='do');
  const home=homeBoard(db,users.employee),work=workBoard(db,users.employee);
  const tile=home.cards.find(c=>c.key==='tasks');
  assert.equal(tile.value,mine.counts.do);assert.equal(tile.value,home.tasks.length);assert.equal(tile.value,work.doing.length,'tile = #work');
  assert.equal(doing.filter(i=>i.kind==='مهمة مشروع').length,8,'the seventh and eighth project tasks are no longer dropped in silence');
  assert.deepEqual(doing.filter(i=>i.kind==='مهمة خاصة').map(i=>i.id).sort(),[...f.personal].sort(),'personal tasks are part of «مهامي»');
  const dated=doing.find(i=>i.title==='مهمة خاصة بموعد'),undated=doing.find(i=>i.title==='مهمة خاصة بلا موعد');
  assert.equal(dated.overdue,true);assert.equal(undated.overdue,false);assert.equal(undated.due_basis,'none','a personal task with no date is never late');
  const commitment=doing.find(i=>i.id===f.commitment.id);
  assert.equal(commitment.kind,'التزام ناشئ عن قرار');assert.equal(commitment.overdue,true);assert.equal(commitment.link,`#decisions?focus=${f.commitment.id}`);
  assert.equal(mine.items.filter(i=>i.id===f.commitment.id).length,1,'the overdue commitment is one item in «أنفّذ», not a second one in «أقرّر»');
  const html=workBoardView(work,{e,date:v=>String(v??'')});
  assert.ok(html.includes(`<span class="badge">${tile.value}</span>`),'the #work heading shows the same number as the tile');
  assert.doesNotMatch(html,/ style="/);assert.doesNotMatch(html,/\bundefined\b|\bNaN\b|\[object /);
  // منفذ الدعم: طلب يباشره، ومهمته فيه، وطلب في طابور إدارته يستطيع أي منفذ فيها استلامه.
  const it=obligations(db,users.it).items.filter(i=>i.bucket==='do');
  assert.deepEqual(it.map(i=>i.kind).sort(),['طلب تباشر تنفيذه','طلب في طابور إدارتك','مهمة في طلب'].sort());
  assert.equal(it.find(i=>i.kind==='طلب في طابور إدارتك').shared,true);assert.equal(it.find(i=>i.kind==='طلب تباشر تنفيذه').shared,undefined);
  assert.match(it.find(i=>i.kind==='مهمة في طلب').unblocks,/لا يُغلق وفيه مهمة مفتوحة/);
  assert.equal(homeBoard(db,users.it).cards.find(c=>c.key==='tasks').value,3);
  // «أجيب»: الطلب المعاد يصل صاحبه ويُعدّ، وعمره من لحظة الإعادة.
  const back=obligations(db,users.outsider).items.find(i=>i.id===f.returned.id&&i.bucket==='respond');
  assert.equal(back.kind,'طلب معاد للتعديل');assert.equal(back.optional,false);assert.equal(back.link,`#request/${f.returned.id}`);
  assert.equal(obligations(db,users.outsider).counts.respond,1);
  assert.equal(homeBoard(db,users.outsider).cards.find(c=>c.key==='respond').value,1);
  // «طلباتي المفتوحة»: البطاقة والقائمة تحت العنوان نفسه رقم واحد، وهو رقم #work.
  for(const id of PERSONAS){
    const h=homeBoard(db,users[id]);
    assert.equal(h.cards.find(c=>c.key==='my_requests').value,h.my_requests.length,`${id}: tile = list`);
    assert.equal(workBoard(db,users[id]).mine.length,h.my_requests.length,`${id}: home = #work`);
  }
});

test('obligations: the inbox counts before it slices, says «يُعرض 50 من N», and one tenant or one colleague never reads another’s obligations',t=>{
  const {db,users,raise}=base(t);
  for(let i=1;i<=INBOX_PAGE+3;i++)raise(users.employee,'IT-SUPPORT',`عطل رقم ${i}`,{issue:'لا يعمل',impact:'يمنع العمل'});
  const box=inbox(db,users.manager),group=box.groups.find(g=>g.key==='requests');
  assert.equal(box.total,INBOX_PAGE+3,'the total is what waits, not what is shown');
  assert.equal(group.total,INBOX_PAGE+3);assert.equal(group.items.length,INBOX_PAGE);assert.equal(group.truncated,true);
  assert.equal(group.shown_note,`يُعرض ${INBOX_PAGE} من ${INBOX_PAGE+3}`);
  assert.equal(obligations(db,users.manager).items.filter(i=>i.bucket==='decide').length,INBOX_PAGE+3,'the function itself never truncates');
  const html=inboxUI.render(box,{e});
  assert.ok(html.includes(`يُعرض ${INBOX_PAGE} من ${INBOX_PAGE+3}`));assert.ok(html.includes('فتح السجل'));assert.doesNotMatch(html,/ style="/);
  assert.doesNotMatch(html.replace(/<[^>]+>/g,' '),/\bundefined\b|\bNaN\b|\[object /);
  assert.deepEqual(obligations(db,users.external).counts,{decide:0,respond:0,do:0,late:0},'another tenant reads none of it');
  assert.equal(obligations(db,users.it).items.some(i=>i.title.startsWith('عطل رقم')),false,'not yet approved, so not yet in the executing department’s queue');
  assert.throws(()=>obligations(db,{id:'ghost',tenant_id:'36t'}),error=>error.status===403);
});
