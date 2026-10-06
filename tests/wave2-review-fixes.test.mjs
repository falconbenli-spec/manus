import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, fieldModel } from '../app/service-catalog.mjs';
import { payloadForStored } from '../scripts/qa-catalog-sweep.mjs';
import * as delegations from '../app/delegations.mjs';
import { can } from '../app/access.mjs';
import { escalationCandidates, overrideEscalation, stuckApprovals } from '../app/step-escalation.mjs';
import { departmentHeldWork, heldWorkBoard } from '../app/request-assignment.mjs';
import { assignRequestTask } from '../app/routing.mjs';
import { resubmitLapsed, departmentReturned, returnedByMe } from '../app/returned-requests.mjs';
import { undeliverableBoard, undeliverableOpenCount } from '../app/notice-recipients.mjs';
import { obligations } from '../app/obligations.mjs';
import { clearInboxCache } from '../app/inbox.mjs';
import { homeBoard } from '../app/home.mjs';
import { homeUI } from '../app/static/home-ui.mjs';

// مراجعة مستقلة للموجة 2 «لا طلب يضيع»: كل اختبار هنا يثبّت عطبًا أثبته القياس، ويفشل على الشيفرة قبل إصلاحه.
// كل ما هنا مصطنع: لا اسم إنسان حقيقي ولا رقم هوية.
const code=value=>error=>error.code===value;
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-wave2-review');installServiceCatalog(db);t.after(()=>db.close());
  const tx=f=>transaction(db,f),user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const service=c=>wf.catalog(db,user('admin')).find(s=>s.code===c);
  const row=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const raise=(c,who='employee')=>{const d=service(c);
    const r=tx(()=>wf.createRequest(db,user(who),{service_id:d.id,title:`طلب تجريبي — ${c}`,payload:payloadForStored(d.fields,fieldModel(c))}));
    return tx(()=>wf.transition(db,user(who),r.id,'submit',{version:r.version,note:''})).id;};
  const steps=rid=>db.prepare('SELECT * FROM approval_steps WHERE request_id=? AND revision=(SELECT revision FROM requests WHERE id=?) ORDER BY position').all(rid,rid);
  const act=(who,rid,action,note='ملاحظة تجريبية مكتوبة')=>tx(()=>wf.transition(db,user(who),rid,action,{version:row(rid).version,note}));
  const move=(rid,step,to)=>tx(()=>overrideEscalation(db,user('admin'),step.id,{to_user_id:to,reason:'نقل تجريبي مكتوب لقرار الخطوة'}));
  return {db,tx,user,service,row,raise,steps,act,move};
}
// عدّاد العبارات المحضّرة: يقيس أن قراءة جدول العطل خرجت من الحلقة، لا زمنًا يتقلب بحسب الآلة.
function counted(db,f){
  const original=db.prepare.bind(db),seen=new Map();
  db.prepare=sql=>{seen.set(sql,(seen.get(sql)??0)+1);return original(sql);};
  try{f();}finally{db.prepare=original;}
  return sql=>[...seen.entries()].filter(([text])=>text.includes(sql)).reduce((total,[,n])=>total+n,0);
}

test('review 1: separation of duties survives an escalation whose holder lets his delegate decide',t=>{
  const {db,tx,user,service,row,raise,steps,act,move}=fixture(t);
  // FIN-PAYMENT-REQUEST: sod:true، وخطوتها الثانية عند مدير المالية. القرار يُنقل إلى درجة أعلى، ثم يقرر عنها مفوَّضها.
  const rid=raise('FIN-PAYMENT-REQUEST');
  act(steps(rid)[0].approver_id,rid,'approve');
  const step=steps(rid)[1],holder=escalationCandidates(db,row(rid),step).rungs[0].id;
  move(rid,step,holder);
  // نائب منفّذ مسمّى ومقبول من ثانٍ، حتى يجد الطلبُ منفّذًا بعد اعتماده ولا يُرفض الاعتماد لخلو سلسلته.
  tx(()=>wf.proposeExecutionDeputy(db,user('admin'),{service_code:'FIN-PAYMENT-REQUEST',rank:1,user_id:'hr',basis:'تسمية تجريبية مصطنعة لنائب منفّذ'}));
  tx(()=>wf.acceptExecutionDeputy(db,user('head-finance'),{service_code:'FIN-PAYMENT-REQUEST',rank:1,note:'قبول تجريبي مصطنع للتسمية'}));
  const delegate='ceo';
  tx(()=>delegations.createDelegation(db,user(holder),{delegate_id:delegate,service_code:'FIN-PAYMENT-REQUEST',
    starts_at:new Date(Date.now()-60_000).toISOString(),ends_at:new Date(Date.now()+60_000).toISOString(),reason:'تغطية غياب تجريبية'}));
  act(delegate,rid,'approve');
  const approved=row(rid);
  assert.equal(approved.status,'approved');
  assert.equal(steps(rid)[1].approver_id,'head-finance','the step’s approver is immutable, as the escalation design requires');
  assert.equal(steps(rid)[1].decided_by,delegate,'and the delegate is the one who pressed the button');
  // من حمل القرار طرفٌ في الاعتماد: لا يستلم الخدمة المعلّمة sod ولو لم يظهر في عمودي الخطوة.
  const chain=wf.executionChain(db,service('FIN-PAYMENT-REQUEST'),approved);
  assert.equal(chain.people.some(p=>p.id===holder),false,'the escalated holder is out of the execution chain');
  assert.equal(wf.actions(db,user(holder),wf.getRequest(db,user(holder),rid)).includes('claim'),false);
  assert.throws(()=>act(holder,rid,'claim'),code('transition_denied'));
  assert.equal(row(rid).assigned_to,null);
  // والشاشة تسمّيه: «من قرر» ليس من ضغط الزر وحده.
  const view=wf.workflowView(db,user('admin'),row(rid));
  assert.ok(view.deciders.includes(db.prepare('SELECT name FROM users WHERE id=?').get(holder).name),'the screen names the person who actually held the decision');
  // والنائب المسمّى — وهو ليس طرفًا في أي قرار — ينفّذه كما صُمّم الاحتياط.
  assert.equal(chain.basis,'deputy');
  tx(()=>wf.transition(db,user('hr'),rid,'claim',{version:row(rid).version,note:''}));
  assert.equal(row(rid).assigned_to,'hr');
  assert.equal(wf.workflowView(db,user('admin'),row(rid)).decider_is_executor,false);
  assert.ok(verifyAudit(db));
});

test('review 2: whoever moves a decision by hand may not move it to himself',t=>{
  const {db,tx,user,row,raise,steps}=fixture(t);
  const rid=raise('HR-LETTER'),step=steps(rid)[0];
  const rung=escalationCandidates(db,row(rid),step).rungs[0].id;
  // درجة في السُلَّم تحمل تصريح الهيكل: القاعدة تُنفَّذ عند الكتابة كما تُنفَّذ كل قاعدة هويتين في المنصة.
  db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,department_id,note,granted_by,granted_at) VALUES(?,?,?,?,NULL,?,?,?)')
    .run(randomUUID(),'36t',rung,'structure.manage','منح تجريبي مصطنع','admin',now());
  assert.equal(can(db,user(rung),'structure.manage'),true);
  assert.equal(escalationCandidates(db,row(rid),step,undefined,user(rung)).rungs.some(p=>p.id===rung),false,'he is not offered to himself');
  assert.throws(()=>tx(()=>overrideEscalation(db,user(rung),step.id,{to_user_id:rung,reason:'نقل تجريبي مكتوب إلى نفسي'})),code('not_a_rung'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_step_escalations').get().n,0);
  // وغيره يبقى ينقله إليه: المنع على الفاعل لا على الدرجة.
  tx(()=>overrideEscalation(db,user('admin'),step.id,{to_user_id:rung,reason:'نقل تجريبي مكتوب لقرار الخطوة'}));
  assert.equal(db.prepare('SELECT to_user_id FROM approval_step_escalations WHERE step_id=?').get(step.id).to_user_id,rung);
});

test('review 3: a missing or non-string target is a refused request, never a silent automatic choice',t=>{
  const {db,tx,user,raise,steps}=fixture(t);
  const reason='سبب تجريبي مكتوب كافٍ لنقل القرار';
  for(const target of [undefined,null,'',' ',0,[],{},true]){
    const rid=raise('HR-LETTER'),step=steps(rid)[0];
    const input=target===undefined?{reason}:{to_user_id:target,reason};
    assert.throws(()=>tx(()=>overrideEscalation(db,user('admin'),step.id,input)),code('not_a_rung'),`to_user_id=${JSON.stringify(target)}`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_step_escalations WHERE step_id=?').get(step.id).n,0);
  }
});

test('review 4: the schema refuses an escalation to a stopped account, and a resolution from another tenant',t=>{
  const {db,tx,user,raise,steps}=fixture(t);
  const rid=raise('HR-LETTER'),step=steps(rid)[0];
  db.prepare("UPDATE users SET active=0 WHERE id='vp-growth'").run();
  assert.throws(()=>tx(()=>db.prepare('INSERT INTO approval_step_escalations(id,step_id,level,tenant_id,request_id,from_user_id,to_user_id,basis,reason,timer_row_id,actor_id,created_at) VALUES(?,?,1,?,?,?,?,?,?,NULL,?,?)')
    .run(randomUUID(),step.id,'36t',rid,step.approver_id,'vp-growth','admin_override','سبب تجريبي مكتوب كافٍ','admin',now())),
    error=>error.code==='ERR_SQLITE_ERROR','a stopped account would leave the step with nobody able to decide it');
  db.prepare("UPDATE users SET active=1 WHERE id='vp-growth'").run();
  // قرار «عولج» يُسنَد إلى الإشعار وكيانه معًا.
  const noticeId=randomUUID();
  tx(()=>db.prepare('INSERT INTO undeliverable_notices(id,tenant_id,kind,subject_kind,subject_id,intended_user_id,department_id,tried,reason,created_at) VALUES(?,?,?,?,?,NULL,?,?,?,?)')
    .run(noticeId,'36t','queue_without_executor','department_work',rid,'hr','[]','سبب تجريبي مكتوب كافٍ للاختبار',now()));
  assert.throws(()=>tx(()=>db.prepare('INSERT INTO undeliverable_notice_resolutions(notice_id,tenant_id,resolved_by,note,resolved_at) VALUES(?,?,?,?,?)')
    .run(noticeId,'isolated','external','عولج من كيان آخر تجريبيًا',now())),error=>error.code==='ERR_SQLITE_ERROR');
  assert.equal(undeliverableOpenCount(db,'36t'),1,'the notice is still open for the tenant that owns it');
});

test('review 5: assigning a sub-task does not reset the age of held work, and the structure manager reads no request title',t=>{
  const {db,tx,user,row,raise,act}=fixture(t);
  const rid=raise('IT-SUPPORT');
  act('manager',rid,'approve');act('it',rid,'claim');
  const before=departmentHeldWork(db,user('head-it')).find(x=>x.id===rid);
  assert.ok(before?.held_since);
  tx(()=>assignRequestTask(db,user('it'),rid,{version:row(rid).version,assignee_id:'head-it',title:'مهمة تجريبية داخل الطلب',
    due_date:new Date(Date.now()+5*86400000).toISOString().slice(0,10),acceptance:'معيار قبول تجريبي مكتوب'}));
  const after=departmentHeldWork(db,user('head-it')).find(x=>x.id===rid);
  assert.equal(after.held_since,before.held_since,'a sub-task does not move the work to anyone, so it does not restart its age');
  // ما يراه مدير الإدارة المنفذة: العنوان، وهو التوسعة المعلنة. وما يراه من يدير الهيكل: لا عنوان.
  assert.equal(after.title,row(rid).title);
  db.prepare("UPDATE users SET active=0 WHERE id='it'").run();
  const board=heldWorkBoard(db,user('admin'));
  const line=board.rows.find(x=>x.id===rid);
  assert.ok(line,'the request is on the structure manager’s board');
  assert.equal(line.title,'','a request title is the requester’s free text: the platform admin does not read business requests');
  assert.ok(line.reference&&line.service_code,'reference and service code are what the override form needs');
  assert.throws(()=>wf.getRequest(db,user('admin'),rid),error=>error.status===404,'and getRequest says the same thing');
});

test('review 6: a stuck approval step reaches «أقرّر» with the age the board already computed',t=>{
  const {db,user,raise,steps}=fixture(t);
  const rid=raise('HR-LETTER');
  db.prepare("UPDATE users SET active=0 WHERE id='manager'").run();
  const board=stuckApprovals(db,user('admin')),line=board.rows.find(x=>x.step_id===steps(rid)[0].id);
  assert.ok(line,'the step whose decider is stopped');
  assert.equal(line.arrived_at,wf.stepArrivedAt(db,db.prepare('SELECT * FROM requests WHERE id=?').get(rid),steps(rid)[0]));
  clearInboxCache();
  const item=obligations(db,user('admin'),{watching:false}).items.find(i=>i.id===line.step_id);
  assert.ok(item,'the queue reaches the inbox');
  assert.equal(item.since,line.arrived_at);
  assert.equal(item.age_days,line.waited_working_days,'the one queue that exists because something waited says how long it waited');
  assert.notEqual(item.due_basis,'none');
});

test('review 7: with no adopted timer the boards never read a step’s arrival, and the holiday table is read once per board',t=>{
  const {db,user,raise,act}=fixture(t);
  for(let i=0;i<6;i++){const rid=raise('HR-LETTER');if(i%2)act('manager',rid,'return','ينقصه اسم الجهة كاملًا');}
  for(let i=0;i<4;i++){const rid=raise('IT-SUPPORT');act('manager',rid,'approve');act('it',rid,'claim');}
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workflow_timer_settings').get().n,0,'zero adopted timers: the state the platform ships in');
  const stuck=counted(db,()=>stuckApprovals(db,user('admin')));
  assert.equal(stuck('FROM public_holidays'),1,'the holiday table is read once, not once per step');
  assert.equal(stuck('FROM request_versions'),0,'and no step’s arrival is computed at all: lateness is not measured without an adopted timer');
  const held=counted(db,()=>departmentHeldWork(db,user('head-it')));
  assert.equal(held('FROM public_holidays'),1);
  assert.equal(counted(db,()=>departmentReturned(db,user('head-hr')))('FROM public_holidays'),1);
  assert.equal(counted(db,()=>returnedByMe(db,user('manager')))('FROM public_holidays'),1);
});

test('review 8: an undeliverable notice stays on the board however many resolved ones were written after it',t=>{
  const {db,user,raise}=fixture(t);
  const rid=raise('HR-LETTER');
  const write=(at,resolved)=>{const id=randomUUID();
    db.prepare('INSERT INTO undeliverable_notices(id,tenant_id,kind,subject_kind,subject_id,intended_user_id,department_id,tried,reason,created_at) VALUES(?,?,?,?,?,NULL,?,?,?,?)')
      .run(id,'36t','queue_without_executor','department_work',rid,'hr','[]','سبب تجريبي مكتوب كافٍ للاختبار',at);
    if(resolved)db.prepare('INSERT INTO undeliverable_notice_resolutions(notice_id,tenant_id,resolved_by,note,resolved_at) VALUES(?,?,?,?,?)').run(id,'36t','admin','عولج تجريبيًا بسدّ الفراغ',at);
    return id;};
  const open=[];for(let i=0;i<5;i++)open.push(write('2020-01-01T00:00:0'+i+'.000Z',false));
  for(let i=0;i<220;i++)write('2026-09-2'+(i%9)+'T00:00:00.000Z',true);
  const board=undeliverableBoard(db,user('admin'));
  assert.equal(board.open_count,5);
  assert.equal(board.open.length,5,'the cap applies to open notices, not to notices');
  assert.deepEqual(board.open.map(n=>n.id).sort(),open.sort());
  assert.equal(board.open_count,undeliverableOpenCount(db,'36t'),'the screen and the daily run read one expression, so they cannot disagree');
  assert.equal(board.resolved_count,220);
  clearInboxCache();
  assert.equal(obligations(db,user('admin'),{watching:false}).items.filter(i=>open.includes(i.id)).length,5);
});

test('review 9: the owner of a lapsed request has a way back into it, and the lapsed request stays closed',t=>{
  const {db,tx,user,row,raise,act}=fixture(t);
  const rid=raise('HR-LETTER');
  act('manager',rid,'approve');act('hr',rid,'return','ينقصه اسم الجهة كاملًا');
  // انقضاء مصطنع بالحد الأدنى: صفّ الانقضاء هو ما يميّز المنقضي عن الملغى بيد صاحبه.
  const timer=randomUUID(),stamp=at=>new Date(Date.now()+at).toISOString();
  tx(()=>{db.prepare("INSERT INTO workflow_timer_settings(id,tenant_id,timer_key,unit,value,basis,status,proposed_by,proposed_at) VALUES(?,?,'returned_expiry','working_days',3,?,'proposed','admin',?)")
      .run(timer,'36t','قرار تجريبي مصطنع للرئاسة بتاريخ 2026-09-22 لاختبار المهل',stamp(-9e7));
    db.prepare("UPDATE workflow_timer_settings SET status='adopted',adopted_by='vp-growth',adopted_at=? WHERE id=?").run(stamp(-8e7),timer);});
  const back=db.prepare("SELECT decided_at FROM approval_steps WHERE request_id=? AND status='returned'").get(rid).decided_at;
  tx(()=>{db.prepare('INSERT INTO request_lapses(request_id,tenant_id,revision,returned_at,returned_by,reminded_at,waited_days,timer_row_id,lapsed_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(rid,'36t',row(rid).revision,back,'hr',stamp(1000),4,timer,stamp(2000));
    db.prepare("UPDATE requests SET status='cancelled',version=version+1,updated_at=? WHERE id=?").run(stamp(2000),rid);});
  assert.ok(wf.actions(db,user('employee'),row(rid)).includes('resubmit'));
  assert.equal(wf.actions(db,user('outsider'),row(rid)).includes('resubmit'),false,'only its owner');
  const fresh=tx(()=>resubmitLapsed(db,user('employee'),rid,{version:row(rid).version,note:''}));
  assert.notEqual(fresh.id,rid);
  assert.equal(fresh.status,'draft');
  assert.equal(fresh.title,row(rid).title);
  assert.deepEqual(fresh.payload,JSON.parse(row(rid).payload),'his own words come back, he does not retype the request');
  assert.equal(fresh.resubmitted_from,rid);
  assert.match(fresh.resubmit_note,/المرفقات لا تُنسخ/);
  assert.equal(row(rid).status,'cancelled','the lapsed request is not reopened: the status list is closed and a lapse is written once');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM request_lapses WHERE request_id=?').get(rid).n,1);
  assert.throws(()=>tx(()=>resubmitLapsed(db,user('hr'),rid,{version:row(rid).version,note:''})),code('not_lapsed'));
  assert.ok(verifyAudit(db));
});

test('review 10: the inline reassign form carries one id per row',t=>{
  const {db,user,raise,act}=fixture(t);
  // منفّذ ثانٍ في الإدارة، فتكون لكل صف قائمةُ إسناد ونموذجٌ داخله.
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) SELECT 'it2',tenant_id,department_id,'it2','منفّذ دعم تقني تجريبي ثانٍ',password_hash,role FROM users WHERE id='it'").run();
  for(let i=0;i<3;i++){const rid=raise('IT-SUPPORT');act('manager',rid,'approve');act('it',rid,'claim');}
  const html=homeUI.render(homeBoard(db,user('head-it')),{e:String,tr:ar=>ar,lang:'ar',date:String,money:String,ui:{},button:()=>''});
  const ids=[...html.matchAll(/<form id="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(ids.length>=3,`three rows carry a form: ${ids.length}`);
  assert.equal(new Set(ids).size,ids.length,'a DOM id appears once in a document');
  assert.equal(/class="vn-inline"/.test(html),false,'no class that no stylesheet defines');
  assert.ok(ids.every(id=>id.startsWith('wf2-form-')));
  assert.equal([...html.matchAll(/data-form="wf2"/g)].length,ids.length,'and the handler keys on the data attribute, not the id');
});
