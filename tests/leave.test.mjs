import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createOnce } from '../app/idempotency.mjs';
import { createLeaveRequest, getLeaveRequest, getLeaveBalance, grantLeaveOpening, leaveAction, listLeave, riyadhDate } from '../app/leave.mjs';
import { leaveUI } from '../app/static/leave-ui.mjs';

const code=expected=>error=>error.code===expected;
function fixture(t) {
  const db=openDb(':memory:');seed(db,'synthetic-leave-tests-only');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const year of [2026,2027,2028]) db.prepare("INSERT INTO leave_calendars VALUES(?,?,?,?,?,?,?,?,?,'Asia/Riyadh',1,?)")
    .run(`creative-${year}`,'36t','creative','hr','تقويم مصطنع للاختبار، ليس سياسة الشركة',`${year}-01-01`,`${year}-12-31`,'[0,1,2,3,4]',JSON.stringify(year===2026?['2026-09-23']:[]),now());
  const grant=(overrides={},who='hr')=>transaction(db,()=>grantLeaveOpening(db,users[who],{employee_id:'employee',leave_type:'synthetic_annual',balance_year:2026,days:12,effective_date:'2026-01-01',reason:'منح مصطنع محدد للاختبار',evidence:'بيانات عينة اختبار محلية',calendar_id:'creative-2026',...overrides}));
  const make=(overrides={},who='employee')=>transaction(db,()=>createLeaveRequest(db,users[who],{leave_type:'synthetic_annual',balance_year:2026,start_date:'2026-09-13',end_date:'2026-09-14',reason:'طلب اختبار محلي مصطنع',...overrides}));
  const act=(who,r,action,input={})=>transaction(db,()=>leaveAction(db,users[who],r.id,action,{version:r.version,note:'قرار اختبار مصطنع',...input}));
  // B20: الإجازة المعتمدة لا تُلغى بعد أن تبدأ. اختبارات الإلغاء بعد الاعتماد تحجز يومَي عمل قادمين
  // يُحسبان من تاريخ التشغيل لا من تاريخ ثابت، فلا يصيران ماضيًا بمرور الوقت.
  const ahead=n=>{const d=new Date(riyadhDate()+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const holidays=new Set(['2026-09-23']);
  const soon=()=>{
    for(let n=10;n<40;n++){
      const start=ahead(n),end=ahead(n+1),day=new Date(start+'T00:00:00Z').getUTCDay();
      if([0,1,2,3].includes(day)&&!holidays.has(start)&&!holidays.has(end))return {start_date:start,end_date:end};
    }
    throw Error('no future working pair');
  };
  return {db,users,grant,make,act,soon};
}

test('HR-04: opening balance requires an explicit amount, effective date, evidence and HR scope',t=>{
  const {db,users,grant,make}=fixture(t);
  assert.deepEqual(listLeave(db,users.employee).balances,[]);
  assert.throws(()=>make(),code('balance_unavailable'));
  for(const who of ['employee','manager','outsider','admin','external']) assert.throws(()=>grant({},who),code('forbidden'));
  for(const input of [{days:0},{days:-1},{days:1.5},{days:undefined},{evidence:''},{reason:''},{effective_date:'2025-12-31'}]) assert.throws(()=>grant(input));
  assert.throws(()=>grant({employee_id:'external'}),code('forbidden'));
  const b=grant();assert.equal(b.posted_days,12);assert.equal(b.reserved_days,0);assert.equal(b.available_days,12);
  assert.equal(b.ledger.length,1);assert.equal(b.ledger[0].kind,'opening');assert.equal(b.ledger[0].effective_date,'2026-01-01');
  assert.throws(()=>grant(),code('opening_exists'));
  assert.equal(verifyAudit(db),true);
});

test('HR-04/05 PLT-04: manager then HR approves one debit and cancellation returns it once',t=>{
  const {db,users,grant,make,act,soon}=fixture(t);const b=grant();let r=make(soon());
  assert.equal(r.status,'pending_manager');assert.equal(r.days,2);
  assert.equal(getLeaveBalance(db,users.employee,b.id).reserved_days,2);
  assert.equal(getLeaveBalance(db,users.employee,b.id).posted_days,12);
  assert.throws(()=>act('hr',r,'approve'),code('transition_denied'));
  assert.throws(()=>act('employee',r,'approve'),code('transition_denied'));
  r=act('manager',r,'approve');assert.equal(r.status,'pending_hr');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leave_ledger WHERE kind='debit'").get().n,0);
  const pending=r;r=act('hr',r,'approve');assert.equal(r.status,'approved');
  assert.throws(()=>act('hr',pending,'approve'),code('stale_version'));
  assert.throws(()=>act('hr',r,'approve'),code('transition_denied'));
  let balance=getLeaveBalance(db,users.employee,b.id);assert.equal(balance.posted_days,10);assert.equal(balance.reserved_days,0);
  assert.equal(balance.ledger.filter(x=>x.kind==='debit').length,1);
  const approved=r;r=act('employee',r,'cancel');assert.equal(r.status,'cancelled');
  assert.throws(()=>act('employee',approved,'cancel'),code('stale_version'));
  assert.throws(()=>act('employee',r,'cancel'),code('transition_denied'));
  balance=getLeaveBalance(db,users.employee,b.id);assert.equal(balance.posted_days,12);assert.equal(balance.available_days,12);
  assert.equal(balance.ledger.filter(x=>x.kind==='refund').length,1);assert.equal(verifyAudit(db),true);
});

// B20 (تدقيق الموظفين 19 سبتمبر 2026): الإجازة المعتمدة كانت تُلغى في أي وقت — حتى بعد أخذها — وتُرد أيامها،
// فيُحسب الموظف حاضرًا ويسترد الرصيد معًا. الإلغاء الآن قبل يوم البداية وحده.
test('B20: an approved leave can be cancelled before it starts and not after',t=>{
  const {db,users,grant,make,act,soon}=fixture(t);const b=grant();
  const started=act('hr',act('manager',make(),'approve'),'approve');
  assert.equal(started.status,'approved');
  assert.ok(started.start_date<=riyadhDate(),'الطلب الثابت في الملف بدأ فعلًا');
  const asEmployee=r=>getLeaveRequest(db,users.employee,r.id);
  assert.ok(!asEmployee(started).actions.includes('cancel'),'لا زر إلغاء لإجازة بدأت');
  assert.throws(()=>act('employee',started,'cancel'),code('transition_denied'));
  assert.equal(getLeaveBalance(db,users.employee,b.id).posted_days,10,'لا يُرد شيء إلى الرصيد');
  const upcoming=act('hr',act('manager',make(soon()),'approve'),'approve');
  assert.ok(asEmployee(upcoming).actions.includes('cancel'),'الإجازة القادمة تُلغى');
  assert.equal(act('employee',upcoming,'cancel').status,'cancelled');
  assert.equal(getLeaveBalance(db,users.employee,b.id).posted_days,10);
  assert.equal(verifyAudit(db),true);
});

test('HR-04: reservations prevent a second request from spending unavailable days',t=>{
  const {db,users,grant,make,act}=fixture(t);const b=grant({days:3});let r=make();
  assert.throws(()=>make({start_date:'2026-09-15',end_date:'2026-09-16'}),code('insufficient_balance'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leave_requests').get().n,1);
  r=act('manager',r,'reject');assert.equal(r.status,'rejected');
  const balance=getLeaveBalance(db,users.employee,b.id);assert.equal(balance.available_days,3);assert.equal(balance.reserved_days,0);
  assert.equal(balance.ledger.filter(x=>x.kind==='release').length,1);
  assert.throws(()=>transaction(db,()=>leaveAction(db,users.employee,r.id,'resubmit',{version:r.version,start_date:'2026-09-15',end_date:'2026-09-16',reason:'محاولة إعادة طلب مرفوض'})),code('transition_denied'));
  assert.equal(make({start_date:'2026-09-15',end_date:'2026-09-16'}).days,2);
});

test('HR-04: overlapping periods are rejected across leave types and approved requests',t=>{
  const {grant,make,act,soon}=fixture(t);grant();grant({leave_type:'synthetic_other'});const window=soon();let r=make(window);
  assert.throws(()=>make(window),code('leave_overlap'));
  assert.throws(()=>make({leave_type:'synthetic_other',start_date:window.start_date,end_date:window.end_date}),code('leave_overlap'));
  r=act('manager',r,'approve');r=act('hr',r,'approve');
  assert.throws(()=>make(window),code('leave_overlap'));
  act('employee',r,'cancel');assert.equal(make(window).status,'pending_manager');
});

test('HR-04: dates use the configured weekdays and holidays with separate balance years',t=>{
  const {db,users,grant,make}=fixture(t);const b=grant();
  const next=grant({balance_year:2027,calendar_id:'creative-2027',effective_date:'2027-01-01',days:8});
  const r=make({start_date:'2026-09-20',end_date:'2026-09-26'});
  assert.deepEqual(r.work_dates,['2026-09-20','2026-09-21','2026-09-22','2026-09-24']);assert.equal(r.days,4);
  assert.equal(getLeaveBalance(db,users.employee,b.id).available_days,8);assert.equal(getLeaveBalance(db,users.employee,next.id).available_days,8);
  assert.throws(()=>make({start_date:'2026-12-31',end_date:'2027-01-03'}),code('balance_year'));
  assert.throws(()=>make({start_date:'2026-02-29',end_date:'2026-03-01'}),code('invalid_date'));
  assert.throws(()=>make({start_date:'2026-09-13T00:00:00+03:00'}),code('invalid_date'));
  assert.throws(()=>make({start_date:'2026-09-12',end_date:'2026-09-11'}),code('date_order'));
  assert.throws(()=>make({start_date:'2026-09-11',end_date:'2026-09-12'}),code('no_workdays'));
  assert.equal(make({balance_year:2027,start_date:'2027-01-03',end_date:'2027-01-04'}).days,2);
  assert.equal(getLeaveBalance(db,users.employee,next.id).available_days,6);
});

test('HR-04 F05/F10: employee identity and Riyadh date boundaries do not depend on names or UTC dates',t=>{
  const {db,users,grant,make}=fixture(t);grant();
  db.prepare("UPDATE users SET name=(SELECT name FROM users WHERE id='employee') WHERE id='outsider'").run();
  const other=grant({employee_id:'outsider',days:4});make();
  assert.equal(getLeaveBalance(db,users.hr,other.id).available_days,4);
  assert.throws(()=>getLeaveBalance(db,users.employee,other.id),code('not_found'));
  assert.equal(riyadhDate('2026-09-09T21:30:00.000Z'),'2026-09-10');
  assert.equal(riyadhDate('2026-12-31T21:30:00.000Z'),'2027-01-01');
  assert.equal(riyadhDate('2026-09-09T20:59:59.999Z'),'2026-09-09');
  assert.equal(riyadhDate('2026-09-10T00:30:00+03:00'),'2026-09-10');
  assert.throws(()=>riyadhDate('not-a-date'),code('invalid_timestamp'));
});

test('HR-05 PLT-01/05: reads and actions exclude unrelated employees, tenants and technical admins',t=>{
  const {db,users,grant,make,act}=fixture(t);const b=grant(),r=make();
  for(const who of ['outsider','external']) {
    assert.equal(listLeave(db,users[who]).requests.length,0);
    assert.throws(()=>getLeaveRequest(db,users[who],r.id),code('not_found'));
    assert.throws(()=>getLeaveBalance(db,users[who],b.id),code('not_found'));
    assert.throws(()=>act(who,r,'approve'),code('not_found'));
  }
  for(const action of [()=>listLeave(db,users.admin),()=>getLeaveRequest(db,users.admin,r.id),()=>getLeaveBalance(db,users.admin,b.id),()=>act('admin',r,'approve')]) assert.throws(action,code('forbidden'));
  assert.equal(listLeave(db,users.manager).requests[0].id,r.id);assert.equal(listLeave(db,users.hr).requests[0].id,r.id);
  db.prepare("UPDATE users SET department_id='it' WHERE id='hr'").run();
  assert.throws(()=>getLeaveRequest(db,users.hr,r.id),code('not_found'));
  assert.equal(listLeave(db,users.hr).requests.length,0);
  db.prepare("UPDATE users SET manager_id=NULL WHERE id='employee'").run();
  assert.throws(()=>getLeaveRequest(db,users.manager,r.id),code('not_found'));
  assert.equal(listLeave(db,users.manager).requests.length,0);
});

test('HR-05 PLT-05: every call rechecks active role and scope after account changes',t=>{
  const {db,users,grant,make,act}=fixture(t);grant();const r=make();
  assert.throws(()=>getLeaveRequest(db,{...users.outsider,role:'hr',department_id:'hr'},r.id),code('not_found'));
  db.prepare("UPDATE users SET role='employee' WHERE id='manager'").run();
  assert.throws(()=>act('manager',r,'approve'),code('not_found'));
  db.prepare("UPDATE users SET active=0 WHERE id='employee'").run();
  assert.throws(()=>getLeaveRequest(db,users.employee,r.id),code('forbidden'));
  assert.throws(()=>make(),code('forbidden'));
});

test('HR-05 PLT-04: clients cannot choose identity, approvers, state or request days',t=>{
  const {db,users,grant,make,act}=fixture(t);grant();
  for(const field of ['employee_id','tenant_id','status','days','approver_id','calendar_id','version']) assert.throws(()=>make({[field]:'forged'}),code('invalid_fields'));
  const r=make();assert.throws(()=>act('employee',r,'approve'),code('transition_denied'));
  assert.throws(()=>act('manager',r,'complete'),code('transition_denied'));
  assert.throws(()=>act('manager',r,'approve',{stage:'hr'}),code('invalid_fields'));
  db.prepare("UPDATE users SET role='manager',manager_id='employee' WHERE id='employee'").run();
  assert.throws(()=>make({start_date:'2026-09-15',end_date:'2026-09-16'}),code('routing_unavailable'));
  assert.throws(()=>leaveAction(db,users.employee,r.id,'approve',{version:r.version}),code('transition_denied'));
});

test('HR-04/05 PLT-04: returned requests release their hold and resubmit an immutable new revision',t=>{
  const {db,users,grant,make,act}=fixture(t);const b=grant();let r=make();
  r=act('manager',r,'approve');r=act('hr',r,'return');assert.equal(r.status,'returned');
  assert.equal(getLeaveBalance(db,users.employee,b.id).available_days,12);
  const first=r.versions[0].snapshot;
  r=transaction(db,()=>leaveAction(db,users.employee,r.id,'resubmit',{version:r.version,start_date:'2026-09-15',end_date:'2026-09-17',reason:'تعديل موعد الإجازة المصطنعة'}));
  assert.equal(r.status,'pending_manager');assert.equal(r.revision,2);assert.equal(r.days,3);
  assert.deepEqual(r.versions[0].snapshot,first);assert.equal(r.versions[1].snapshot.days,3);
  assert.throws(()=>act('hr',r,'approve'),code('transition_denied'));
  r=act('manager',r,'approve');r=act('hr',r,'approve');
  const balance=getLeaveBalance(db,users.employee,b.id);assert.equal(balance.posted_days,9);assert.equal(balance.reserved_days,0);
  assert.deepEqual(balance.ledger.map(x=>x.kind),['opening','reserve','release','reserve','debit']);
});

test('HR-05 PLT-04: HR cannot finalize approval after the employee manager changes',t=>{
  const {db,users,grant,make,act}=fixture(t);grant();let r=act('manager',make(),'approve');
  db.prepare("UPDATE users SET role='manager' WHERE id='outsider'").run();
  db.prepare("UPDATE users SET manager_id='outsider' WHERE id='employee'").run();
  assert.throws(()=>getLeaveRequest(db,users.manager,r.id),code('not_found'));
  assert.throws(()=>act('hr',r,'approve'),code('routing_changed'));
  r=act('hr',r,'return');
  r=transaction(db,()=>leaveAction(db,users.employee,r.id,'resubmit',{version:r.version,start_date:r.start_date,end_date:r.end_date,reason:'إعادة تقديم للمدير الحالي'}));
  r=act('outsider',r,'approve');r=act('hr',r,'approve');
  assert.equal(r.status,'approved');assert.equal(r.decisions.find(x=>x.revision===2&&x.stage==='manager').actor_id,'outsider');
});

test('HR-04 PLT-09: creation retries reuse one request and recheck access before returning it',t=>{
  const {db,users,grant}=fixture(t);grant();
  const input={leave_type:'synthetic_annual',balance_year:2026,start_date:'2026-09-13',end_date:'2026-09-14',reason:'إعادة محاولة مصطنعة'};
  const key=randomUUID(),create=()=>transaction(db,()=>createOnce(db,users.employee,'leave.create',key,input,()=>createLeaveRequest(db,users.employee,input),id=>getLeaveRequest(db,users.employee,id)));
  const first=create(),second=create();assert.equal(first.id,second.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leave_requests').get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leave_ledger WHERE kind='reserve'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='leave.submitted'").get().n,1);
  db.prepare("UPDATE users SET active=0 WHERE id='employee'").run();assert.throws(create,code('forbidden'));
});

test('HR-04 PLT-06: ledger, decisions and submitted snapshots cannot be changed or deleted',t=>{
  const {db,grant,make,act}=fixture(t);grant();let r=make();r=act('manager',r,'approve');r=act('hr',r,'approve');
  for(const table of ['leave_ledger','leave_decisions','leave_request_versions','leave_balances','leave_calendars']) {
    assert.throws(()=>db.exec(`DELETE FROM ${table}`),/immutable|append only/);
  }
  assert.throws(()=>db.exec('UPDATE leave_ledger SET posted_delta=500'),/append only/);
  assert.throws(()=>db.exec("UPDATE leave_decisions SET note='forged'"),/immutable/);
  assert.throws(()=>db.exec("UPDATE leave_request_versions SET snapshot_json='{}'"),/immutable/);
  assert.throws(()=>db.prepare('UPDATE leave_requests SET days=1,version=version+1 WHERE id=?').run(r.id),/immutable|invalid leave transition/);
  assert.throws(()=>db.prepare("UPDATE leave_requests SET status='pending_manager',version=version+1 WHERE id=?").run(r.id),/invalid leave transition/);
});

test('HR-04 PLT-06: an audit write failure rolls back the reservation and request together',t=>{
  const {db,users,grant,make}=fixture(t);const b=grant();
  db.exec("CREATE TRIGGER test_leave_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='leave.submitted' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");
  assert.throws(()=>make(),/synthetic audit failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leave_requests').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leave_request_versions').get().n,0);
  assert.equal(getLeaveBalance(db,users.employee,b.id).available_days,12);
  assert.equal(getLeaveBalance(db,users.employee,b.id).ledger.length,1);
});

test('HR-04: future effective dates, leap days and a different workweek follow the stored calendar',t=>{
  const {db,grant,make}=fixture(t);grant({effective_date:'2026-10-01'});
  assert.throws(()=>make(),code('calendar_range'));
  db.prepare("INSERT INTO leave_calendars VALUES(?,?,?,?,?,?,?,?,?,'Asia/Riyadh',1,?)")
    .run('leap-week','36t','creative','hr','تقويم مصطنع بأيام عمل مختلفة','2028-01-01','2028-12-31','[1,2,3,4,5]','[]',now());
  grant({calendar_id:'leap-week',balance_year:2028,effective_date:'2028-01-01'});
  const r=make({balance_year:2028,start_date:'2028-02-28',end_date:'2028-03-01'});
  assert.deepEqual(r.work_dates,['2028-02-28','2028-02-29','2028-03-01']);
});

test('HR-04/05: pending cancellation releases a hold without posting a debit or refund',t=>{
  const {db,users,grant,make,act}=fixture(t);const b=grant();const r=act('employee',make(),'cancel');
  assert.equal(r.status,'cancelled');const balance=getLeaveBalance(db,users.employee,b.id);
  assert.equal(balance.available_days,12);assert.deepEqual(balance.ledger.map(x=>x.kind),['opening','reserve','release']);
  assert.throws(()=>act('manager',r,'approve'),code('transition_denied'));
  // حُذف من هنا تأكيدٌ على أن حمولة الإجازات تحمل environment:'synthetic'. الحقل نفسه حُذف من الحمولات:
  // لم يكن مشتقًّا من شيء فلا ينطفئ أبدًا، وكان يقول عن الهيكل التنظيمي الحقيقي والسياسات المعتمدة إنها
  // مصطنعة، ولا وحدة واجهة تقرؤه أصلًا. بيان البيئة الصحيح مصدره environmentBadge في app/environment.mjs
  // ويصل الشاشة عبر ‎/api/me‎ و‎/api/login‎. تثبيتُ هذا التأكيد كان يجعل الاختبارات تحرس الكذبة.
  // الحارس الدائم على ذلك في tests/server-truthfulness.test.mjs.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,0);
});

test('HR-05 F04: the local calendar includes approved authorized days and removes cancelled leave',t=>{
  const {db,users,grant,make,act,soon}=fixture(t);grant();let r=make(soon());
  assert.deepEqual(listLeave(db,users.employee).calendar_entries,[]);
  r=act('manager',r,'approve');assert.deepEqual(listLeave(db,users.employee).calendar_entries,[]);
  r=act('hr',r,'approve');assert.equal(listLeave(db,users.employee).calendar_entries.length,2);
  assert.equal(listLeave(db,users.hr).calendar_entries[0].request_id,r.id);
  assert.deepEqual(listLeave(db,users.outsider).calendar_entries,[]);
  act('employee',r,'cancel');assert.deepEqual(listLeave(db,users.employee).calendar_entries,[]);
});

test('HR-05 SEC-01: leave forms retain the selected request version and escape stored text',async t=>{
  const {db,users,grant,make}=fixture(t);grant();const request=make({reason:'<script>synthetic()</script>'});
  const managerData=await leaveUI.load(async path=>path==='/leave'?listLeave(db,users.manager):{user:users.manager});
  const spec=leaveUI.form('approve',request.id,managerData);
  managerData.requests[0].version=999;
  assert.equal(spec.toPayload({version:'999',note:'قرار مصطنع'}).version,request.version);
  assert.equal(spec.endpoint,`/leave/requests/${request.id}/approve`);
  assert.equal(spec.fields.some(x=>x.name==='version'),false);
  const escaped=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html=leaveUI.render(managerData,{e:escaped,button:(action,id,label)=>`<button>${escaped(label)}</button>`});
  assert.equal(html.includes('<script>'),false);assert.equal(html.includes('&lt;script&gt;'),true);
  const employeeData={...listLeave(db,users.employee),user:users.employee};
  const create=leaveUI.form('create',employeeData.balances[0].id,employeeData);
  assert.equal(create.idempotent,true);assert.equal(create.toPayload({start_date:'2026-10-04',end_date:'2026-10-05',reason:'تجربة'}).balance_year,2026);
  assert.throws(()=>leaveUI.form('opening',employeeData.calendars[0].id,employeeData),/خارج نطاق/);
  const hrData={...listLeave(db,users.hr),user:users.hr},opening=leaveUI.form('opening',hrData.calendars[0].id,hrData);
  assert.equal(opening.fields.find(x=>x.name==='days').value,undefined);
  assert.equal(opening.toPayload({balance_year:'2026',days:'7'}).days,7);
  assert.equal(opening.toPayload({balance_year:'2026',days:'7'}).balance_year,2026);
});
