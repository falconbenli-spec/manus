// الحزمة 4 (P4-HR-1): سجل الموظف الرئيسي والتغيير التنظيمي. ما يثبته هذا الملف:
//   • التوظيف يُربط مرة واحدة: مرشح مقبول ← حساب نشط في الكيان ← عقد ذلك الحساب نفسه. لا مرشح بحسابين ولا حساب بمرشحين.
//   • التغيير الوظيفي المؤرخ يعتمده حامل ثانٍ لـ«السجل الوظيفي» غير من سجّله وغير صاحبه. وحين لا حامل آخر في الكيان
//     يعتمده من سجّله بسبب مكتوب (20 حرفًا فأكثر)، ويُكتب في سجل التدقيق two_person:false والسبب، باسمه هو لا باسم مصطنع.
//   • لا يسري تغيير قبل اعتماده؛ ويسري عند اعتماده إن حلّ تاريخه، أو في التشغيل اليومي، أو بطلب صريح — ولا يسري بفتح الشاشة.
//   • الملف الوظيفي لا يعدّل حقلًا مؤرخًا مباشرة؛ الرفض يدل على مسار التغيير المؤرخ.
//   • orgOn يقرأ الإدارة والمدير والمسمى في أي تاريخ من التاريخ المعتمد وحده، ولا يقرأ عبر الكيانات.
// البيانات تجريبية كلها (tests/hr-cycle-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import * as people from '../app/people.mjs';
import * as employees from '../app/employees.mjs';
import { runWorkflowSweep } from '../app/workflow-sweep.mjs';
import { personDepartment } from '../app/people-read.mjs';
import { hrCycle, code, caught } from './hr-cycle-fixture.mjs';

const DAY=86400000;
const riyadh=(offset=0,from=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(from+offset*DAY));
const audits=(db,action)=>db.prepare('SELECT * FROM audit_events WHERE action=? ORDER BY seq').all(action).map(e=>({...e,after:JSON.parse(e.after_json)}));
const changeOf=(db,id)=>db.prepare('SELECT * FROM employee_changes WHERE id=?').get(id);
const title=(db,userId)=>db.prepare('SELECT job_title FROM employee_profiles WHERE user_id=?').get(userId)?.job_title;

test('hire link: HR in scope links an accepted candidate to one active account of this tenant and to that account’s own contract — anything else is refused by name',t=>{
  const w=hrCycle(t),{db}=w,h=w.hire();
  const link=(input,{who='hr',candidate=h.candidate}={})=>w.tx(()=>people.linkHire(db,w.U[who],candidate.id,{version:candidate.version,evidence:'ربط تجريبي موثق بعد فتح الحساب',...input}));
  assert.equal(caught(()=>link({user_id:h.userId},{who:'manager'})).code,'transition_denied','the hiring manager does not link accounts');
  for(const userId of ['admin','external','no-such-user'])assert.equal(caught(()=>link({user_id:userId})).code,'hire_user',userId);
  assert.equal(caught(()=>link({user_id:'hr'})).code,'separation_of_duties','HR does not link a hire to their own account');
  assert.equal(caught(()=>link({user_id:h.userId,contract_id:w.contracts.employee})).code,'hire_contract','another person’s contract is not this hire’s');
  // الحساب أولًا ثم العقد حين يُعتمد: الرابط يكتمل على مرحلتين، وكل مرحلة مرة واحدة.
  let c=link({user_id:h.userId});
  assert.deepEqual([c.hire.user_id,c.hire.contract_id],[h.userId,null]);
  assert.ok(c.actions.includes('link_hire'),'the contract is still to be linked');
  assert.equal(caught(()=>link({user_id:'outsider'},{candidate:c})).code,'hire_linked','the account of a linked hire does not change');
  // الموظف المربوط إن صار هو نفسه من خدمات الموظف في النطاق لا يربط عقده برابطه.
  db.prepare("UPDATE users SET role='hr',department_id='hr' WHERE id=?").run(h.userId);w.refresh();
  assert.equal(caught(()=>link({contract_id:h.contractId},{who:h.userId,candidate:c})).code,'separation_of_duties');
  db.prepare("UPDATE users SET role='employee',department_id='creative' WHERE id=?").run(h.userId);w.refresh();
  c=link({contract_id:h.contractId},{candidate:c});
  assert.equal(c.hire.contract_id,h.contractId);assert.equal(c.actions.includes('link_hire'),false);
  assert.equal(caught(()=>link({contract_id:h.contractId},{candidate:c})).code,'hire_linked');
  // مرشح لم يُقبل لا يُربط.
  let r=w.tx(()=>people.createRequisition(db,w.U.manager,{policy_id:'cycle-hiring',title:'وظيفة تجريبية ثانية',need:'احتياج تجريبي ثانٍ',plan_reference:'خطة تجريبية',budget_evidence:'مخصص تجريبي',target_date:h.requisition.target_date,criteria:h.requisition.criteria}));
  r=w.tx(()=>people.peopleAction(db,w.U.hr,r.id,'approve_need',{version:r.version,note:'راجع HR الاحتياج التجريبي'}));
  const applied=w.tx(()=>people.addCandidate(db,w.U.hr,r.id,{version:r.version,name:'مرشح تجريبي لم يُقبل',contact:'not-accepted@example.invalid',source:'ترشيح تجريبي',consent_evidence:'موافقة تجريبية',retention_until:h.candidate.retention_until}));
  assert.equal(caught(()=>link({user_id:'outsider'},{candidate:applied})).code,'transition_denied');
  const events=audits(db,'people.hire_linked');
  assert.deepEqual(events.map(e=>[e.after.user_id,e.after.contract_id]),[[h.userId,null],[h.userId,h.contractId]]);
  assert.ok(verifyAudit(db));
});

test('hire link: the link is shown on the candidate and on the employee record to those who may read them, and never across tenants',t=>{
  const w=hrCycle(t),{db}=w,h=w.hire();
  w.tx(()=>people.linkHire(db,w.U.hr,h.candidate.id,{version:h.candidate.version,user_id:h.userId,contract_id:h.contractId,evidence:'ربط تجريبي كامل'}));
  assert.equal(people.getPeopleRecord(db,w.U.hr,h.candidate.id).hire.user_id,h.userId);
  assert.equal(employees.employeeRecord(db,w.U.hr,h.userId).hire.candidate_id,h.candidate.id,'HR sees where the person came from');
  assert.equal(employees.employeeRecord(db,w.U[h.userId],h.userId).hire,null,'the employee’s own record does not carry the candidate file');
  assert.throws(()=>people.getPeopleRecord(db,w.U.external,h.candidate.id),code('not_found'));
  assert.throws(()=>employees.employeeRecord(db,w.U.external,h.userId),code('not_found'));
  assert.equal(people.listPeople(db,w.U.external).candidates.length,0);
});

test('change approval: a second holder of «السجل الوظيفي» approves once; the recorder and the subject do not; settled rows stay fixed',t=>{
  const w=hrCycle(t),{db}=w;
  const record=(userId,input,who='hr')=>w.tx(()=>employees.recordChange(db,w.U[who],userId,{reason:'قرار تجريبي موثق',...input}));
  const approve=(id,who,input={})=>w.tx(()=>employees.approveChange(db,w.U[who],id,input));
  const future=record('employee',{change_type:'job_title',to_value:'مصممة أولى تجريبية',effective_from:riyadh(20)}).change_id;
  const self=caught(()=>approve(future,'hr'));
  assert.equal(self.code,'self_approval');
  assert.match(self.details.refusal.missing[0].owner,/مديرة رأس المال البشري التجريبية/,'the refusal names who can approve');
  assert.equal(caught(()=>approve(future,'hr',{self_approval_reason:'لا أحد غيري يحمل التصريح في هذا الاختبار'})).code,'self_approval','a reason does not open self-approval while a second holder exists');
  assert.equal(caught(()=>approve(future,'manager')).code,'forbidden','approval needs the record capability');
  const own=record('hr-manager',{change_type:'job_title',to_value:'مديرة رأس مال بشري أولى',effective_from:riyadh(20)}).change_id;
  assert.equal(caught(()=>approve(own,'hr-manager')).code,'separation_of_duties','nobody approves a change to their own record');
  const approved=approve(future,'hr-manager',{note:'اعتماد تجريبي للترقية'});
  assert.equal(approved.applied,false,'a future change waits for its date after approval');
  const row=changeOf(db,future);
  assert.equal(row.approved_by,'hr-manager');assert.ok(row.approved_at);assert.equal(row.applied_at,null);
  assert.equal(title(db,'employee'),'مصممة تجريبية');
  assert.equal(caught(()=>approve(future,'hr-manager')).code,'already_approved');
  assert.deepEqual(audits(db,'employee.change_approved').map(e=>[e.after.change_id,e.after.two_person]),[[future,true]]);
  // القاعدة في القاعدة نفسها: الاعتماد مرة واحدة، ولا سريان بلا اعتماد، والمستقر لا يُمس.
  assert.throws(()=>db.prepare("UPDATE employee_changes SET approved_by='hr' WHERE id=?").run(future),/approved once/);
  assert.throws(()=>db.prepare('UPDATE employee_changes SET applied_at=? WHERE id=?').run(new Date().toISOString(),own),/only after approval/);
  assert.throws(()=>db.prepare('UPDATE employee_changes SET to_value=? WHERE id=?').run('مسمى معدل خارج المنصة',future),/approved once/);
  w.tx(()=>employees.cancelChange(db,w.U.hr,future,{reason:'أُلغيت الترقية التجريبية بقرار لاحق'}));
  assert.throws(()=>db.prepare('UPDATE employee_changes SET reason=? WHERE id=?').run('سبب معدل',future),/settled employee change is immutable/);
  assert.ok(verifyAudit(db));
});

test('awaiting approval: the queue a decision inbox reads lists what this holder may approve — not their own record, not what they recorded while a colleague can, and nothing across tenants',t=>{
  const w=hrCycle(t),{db}=w;
  const record=(userId,who='hr')=>w.tx(()=>employees.recordChange(db,w.U[who],userId,{change_type:'job_title',to_value:'مسمى تجريبي ينتظر الاعتماد',effective_from:riyadh(15),reason:'قرار تجريبي موثق'})).change_id;
  const byHr=record('employee'),aboutManager=record('hr-manager'),byManager=record('outsider','hr-manager');
  const ids=who=>employees.changesAwaitingApproval(db,w.U[who]).map(c=>c.id).sort();
  assert.deepEqual(ids('hr-manager'),[byHr].sort(),'not the change to her own record, not the one she recorded');
  assert.deepEqual(ids('hr'),[aboutManager,byManager].sort());
  const [row]=employees.changesAwaitingApproval(db,w.U['hr-manager']);
  assert.deepEqual(row.actions,['approve_change']);assert.equal(row.employee_name,'الموظفة التجريبية');assert.equal(row.needs_reason,false);
  assert.deepEqual(employees.changesAwaitingApproval(db,w.U.employee),[],'no record capability, no queue');
  assert.deepEqual(employees.changesAwaitingApproval(db,w.U.external),[],'another tenant sees none of these');
  w.tx(()=>employees.approveChange(db,w.U['hr-manager'],byHr,{}));
  assert.deepEqual(ids('hr-manager'),[],'an approved change leaves the queue');
});

test('change approval: with no second holder in the tenant the recorder approves only with a written reason of twenty characters, recorded as two_person:false under their own name',t=>{
  const w=hrCycle(t,{secondOfficer:false}),{db}=w;
  const id=w.tx(()=>employees.recordChange(db,w.U.hr,'employee',{change_type:'department',to_value:'production',effective_from:'2026-07-01',reason:'نقل تجريبي بقرار تجريبي'})).change_id;
  const missing=caught(()=>w.tx(()=>employees.approveChange(db,w.U.hr,id,{})));
  assert.equal(missing.code,'self_approval_reason');assert.match(missing.message,/20/);
  assert.equal(caught(()=>w.tx(()=>employees.approveChange(db,w.U.hr,id,{self_approval_reason:'لا أحد غيري'}))).code,'invalid_text','a short reason is not a reason');
  const reason='لا يحمل «السجل الوظيفي» في هذا الكيان التجريبي غيري، والنقل مستحق من أول يوليو';
  const done=w.tx(()=>employees.approveChange(db,w.U.hr,id,{self_approval_reason:reason}));
  assert.equal(done.applied,true);assert.equal(personDepartment(db,'employee'),'production');
  const row=changeOf(db,id);
  assert.deepEqual([row.created_by,row.approved_by],['hr','hr'],'the actor is the real person, never a synthetic one');
  const [event]=audits(db,'employee.change_approved');
  assert.equal(event.actor_id,'hr');assert.equal(event.after.two_person,false);assert.equal(event.reason,reason);
  assert.throws(()=>db.prepare("UPDATE employee_changes SET approved_by=NULL,approved_at=NULL,self_approval_reason=NULL WHERE id=?").run(id),/settled employee change is immutable/);
  assert.ok(verifyAudit(db));
});

test('applying: only approved changes apply — at approval when due, in the daily sweep, or by an explicit POST — and opening the employees screen changes nothing',async t=>{
  const w=hrCycle(t),{db}=w;
  const record=(input)=>w.tx(()=>employees.recordChange(db,w.U.hr,'employee',{reason:'قرار تجريبي موثق',...input})).change_id;
  const pending=record({change_type:'job_title',to_value:'مسمى بلا اعتماد',effective_from:riyadh(-1)});
  assert.equal(w.tx(()=>employees.applyDueChanges(db,'36t')),0,'an unapproved change never applies, however due');
  const first=record({change_type:'employment_type',to_value:'part_time',effective_from:riyadh(2)});
  const second=record({change_type:'contract_end',to_value:'2027-12-31',effective_from:riyadh(3)});
  w.tx(()=>employees.approveChange(db,w.U['hr-manager'],first,{}));w.tx(()=>employees.approveChange(db,w.U['hr-manager'],second,{}));
  // اليوم الرابع: كلاهما حلّ تاريخه. فتح الشاشة لا يطبّق شيئًا؛ الطلب الصريح يطبّق، والتشغيل اليومي يطبّق.
  t.mock.timers.enable({apis:['Date'],now:Date.now()+4*DAY});
  const call=await w.http(['hr','employee']);
  const list=await call('hr','GET','/employees');
  assert.equal(list.status,200,list.text);
  assert.equal(changeOf(db,first).applied_at,null,'a GET applies nothing');
  assert.equal((await call('employee','POST','/employee-changes/apply-due',{})).status,403,'only an HR record holder asks for it');
  const applied=await call('hr','POST','/employee-changes/apply-due',{});
  assert.equal(applied.status,201,applied.text);
  assert.equal(applied.json().applied,2);
  assert.ok(changeOf(db,first).applied_at&&changeOf(db,second).applied_at);
  assert.equal(changeOf(db,pending).applied_at,null);
  const third=record({change_type:'employment_type',to_value:'full_time',effective_from:riyadh(1,Date.now())});
  w.tx(()=>employees.approveChange(db,w.U['hr-manager'],third,{}));
  t.mock.timers.setTime(Date.now()+2*DAY);
  const swept=w.tx(()=>runWorkflowSweep(db,'36t',riyadh(0),w.U.admin));
  assert.equal(swept.acted.employee_changes_applied,1,'the daily sweep applies approved changes that have come due');
  assert.ok(changeOf(db,third).applied_at);
  assert.ok(verifyAudit(db));
});

test('profile: every dated field is refused with the dated route as the next step; what is not dated still saves, and a new profile takes its starting values',async t=>{
  const w=hrCycle(t),{db}=w;
  const current=()=>employees.employeeRecord(db,w.U.hr,'employee').profile;
  const base=()=>({job_title:current().job_title,employment_type:current().employment_type,join_date:current().join_date,status:current().status,version:current().version});
  const save=input=>w.tx(()=>employees.saveProfile(db,w.U.hr,'employee',input));
  for(const [field,value] of [['job_title','مسمى من الملف'],['status','on_notice'],['employment_type','contract'],['contract_end','2027-06-30'],['department','production'],['manager_id','hr-manager']]){
    const refused=caught(()=>save({...base(),[field]:value}));
    assert.equal(refused.code,'dated_field',field);
    assert.match(refused.details.refusal.next,/تغيير وظيفي مؤرخ/,field);
    assert.equal(refused.details.refusal.link,'#employees',field);
  }
  const moved=save({...base(),join_date:'2025-01-05'});
  assert.equal(moved.profile.join_date,'2025-01-05');assert.equal(moved.profile.version,2);
  const {status,...withoutStatus}=base();
  assert.equal(save(withoutStatus).profile.status,'active','an omitted dated field is kept, not reset');
  const created=w.tx(()=>employees.saveProfile(db,w.U.hr,'outsider',{job_title:'منسق تجريبي',employment_type:'contract',join_date:'2025-06-01',contract_end:'2027-05-31',status:'active'}));
  assert.equal(created.profile.contract_end,'2027-05-31','the first profile is a starting record, not a change');
  const call=await w.http(['hr']);
  const http=await call('hr','POST','/employees/employee/profile',{...base(),job_title:'مسمى عبر الخادم'});
  assert.equal(http.status,409);assert.equal(http.json().error.code,'dated_field');
});

test('orgOn: the department, manager and title on any date come from the approved history only, and never cross tenants',t=>{
  const w=hrCycle(t),{db}=w;
  const record=input=>w.tx(()=>employees.recordChange(db,w.U.hr,'employee',{reason:'قرار تجريبي موثق',...input})).change_id;
  const approve=id=>w.tx(()=>employees.approveChange(db,w.U['hr-manager'],id,{}));
  approve(record({change_type:'department',to_value:'production',effective_from:'2026-07-01'}));
  approve(record({change_type:'job_title',to_value:'مصممة أولى تجريبية',effective_from:'2026-08-01'}));
  record({change_type:'status',to_value:'on_notice',effective_from:'2026-08-15'});
  approve(record({change_type:'department',to_value:'creative',effective_from:riyadh(30)}));
  const on=date=>employees.orgOn(db,'employee',date,{tenantId:'36t'});
  assert.deepEqual([on('2026-06-15').department_id,on('2026-06-15').manager_id,on('2026-06-15').job_title],['creative','manager','مصممة تجريبية']);
  assert.deepEqual([on('2026-07-15').department_id,on('2026-07-15').manager_id],['production',null],'a transfer leaves the old manager behind');
  assert.equal(on('2026-08-10').job_title,'مصممة أولى تجريبية');
  assert.equal(on('2026-08-20').status,'active','an unapproved change is not history');
  assert.equal(on(riyadh(0)).department_id,'production');
  assert.equal(on(riyadh(31)).department_id,'creative','an approved future change is read on its date');
  assert.equal(employees.orgOn(db,'employee','2026-07-15',{tenantId:'isolated'}),null);
  assert.equal(employees.orgOn(db,'external','2026-07-15',{tenantId:'36t'}),null);
  assert.equal(employees.orgOn(db,'external','2026-07-15',{tenantId:'isolated'}).department_id,'other');
  assert.throws(()=>employees.orgOn(db,'employee','2026-13-01',{tenantId:'36t'}),code('invalid_date'));
});

test('HTTP: approving a change and linking a hire go through the real server with its session and CSRF checks',async t=>{
  const w=hrCycle(t),{db}=w,h=w.hire();
  const id=w.tx(()=>employees.recordChange(db,w.U.hr,'employee',{change_type:'department',to_value:'production',effective_from:'2026-07-01',reason:'نقل تجريبي عبر الخادم'})).change_id;
  const call=await w.http(['hr','hr-manager']);
  assert.equal((await call('hr','POST',`/employee-changes/${id}/approve`,{})).status,409,'the recorder is refused');
  const approved=await call('hr-manager','POST',`/employee-changes/${id}/approve`,{note:'اعتماد تجريبي عبر الخادم'});
  assert.equal(approved.status,201,approved.text);assert.equal(approved.json().applied,true);
  const linked=await call('hr','POST',`/people/${h.candidate.id}/link_hire`,{version:h.candidate.version,user_id:h.userId,contract_id:h.contractId,evidence:'ربط تجريبي عبر الخادم'});
  assert.equal(linked.status,201,linked.text);assert.equal(linked.json().hire.contract_id,h.contractId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM employee_hires').get().n,1);
});
