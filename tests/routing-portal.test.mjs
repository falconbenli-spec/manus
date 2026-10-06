import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import * as routing from '../app/routing.mjs';
import * as projects from '../app/projects.mjs';
import * as admin from '../app/admin.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';

const password='synthetic-routing-only';
const code=c=>error=>error.code===c;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
const tomorrow=()=>new Date(Date.now()+86400000).toISOString().slice(0,10);
function setup(t){const db=openDb(':memory:');seed(db,password);installServiceCatalog(db);t.after(()=>db.close());return db;}
function approvedMaintenance(db){
  const employee=user(db,'employee'),service=wf.catalog(db,employee).find(s=>s.code==='ADM-MAINTENANCE');
  let r=wf.createRequest(db,employee,{service_id:service.id,title:'عطل تكييف',payload:{category:'تكييف',location:'الدور الثاني',description:'تسريب مصطنع',urgency:'عادي'},project_id:null});
  // الانتقال داخل معاملة كما يناديه الخادم: transition يشترطها منذ حارس المعاملة في app/workflow.mjs.
  r=transaction(db,()=>wf.transition(db,employee,r.id,'submit',{version:r.version}));
  return transaction(db,()=>wf.transition(db,user(db,'head-ceo-office'),r.id,'approve',{version:r.version}));
}

test('ROUTING: a request transfers to another department, and only its current owner may do it',t=>{
  const db=setup(t),office=user(db,'head-ceo-office'),facilities=user(db,'head-procurement'),employee=user(db,'employee');
  let r=approvedMaintenance(db);
  assert.ok(wf.detail(db,office,r.id).actions.includes('transfer'));
  assert.throws(()=>transaction(db,()=>routing.transferRequest(db,employee,r.id,{version:r.version,department_id:'procurement',reason:'ليست من المكتب'})),error=>[403,404].includes(error.status));
  assert.throws(()=>transaction(db,()=>routing.transferRequest(db,office,r.id,{version:r.version,department_id:'ceo-office',reason:'نفس الإدارة'})),code('same_department'));
  assert.throws(()=>transaction(db,()=>routing.transferRequest(db,office,r.id,{version:r.version,department_id:'legal',reason:'إدارة مؤرشفة'})),code('department'));
  assert.ok(routing.transferTargets(db,office,r).some(d=>d.id==='procurement'));
  r=transaction(db,()=>routing.transferRequest(db,office,r.id,{version:r.version,department_id:'procurement',reason:'الصيانة عبر عقد المورد'}));
  assert.equal(r.handling_department_id,'procurement');
  assert.equal(r.status,'approved','a transfer returns the request to the receiving department unclaimed');
  assert.equal(wf.detail(db,facilities,r.id).actions.includes('claim'),true,'the receiving department can now run it');
  const officeView=wf.detail(db,office,r.id);
  assert.deepEqual(officeView.actions.filter(a=>['transfer','assign_task','claim','complete'].includes(a)),[],'the previous department can no longer run the request');
  assert.equal(routing.listTransfers(db,r).length,1);
  assert.equal(wf.listRequests(db,facilities).some(row=>row.id===r.id),true);
  assert.equal(wf.listRequests(db,employee).some(row=>row.id===r.id),true,'the requester keeps following their own request');
});

test('ROUTING: assigned tasks hold the request open until they are settled by their owner',t=>{
  const db=setup(t),office=user(db,'head-ceo-office'),admin_=user(db,'admin');
  transaction(db,()=>admin.createAccount(db,admin_,{username:'office.tech',name:'فني مكتب مصطنع',role:'employee',department_id:'ceo-office',manager_id:null,temporary_password:'Welcome-2026'}));
  db.prepare("UPDATE users SET must_change_password=0 WHERE id='office.tech'").run();
  const tech=user(db,'office.tech');
  let r=approvedMaintenance(db);
  assert.throws(()=>transaction(db,()=>routing.assignRequestTask(db,office,r.id,{version:r.version,title:'فحص الوحدة',assignee_id:'employee',due_date:tomorrow(),acceptance:'تقرير فحص'})),code('assignee'),'tasks stay inside the handling department');
  r=transaction(db,()=>routing.assignRequestTask(db,office,r.id,{version:r.version,title:'فحص وحدة التكييف',assignee_id:tech.id,due_date:tomorrow(),acceptance:'تقرير فحص موقّع'}));
  assert.equal(r.status,'in_progress');
  const task=routing.listRequestTasks(db,r)[0];
  assert.equal(task.assignee_name,'فني مكتب مصطنع');
  assert.equal(routing.myTasks(db,tech).length,1);
  assert.ok(!wf.detail(db,office,r.id).actions.includes('complete'),'a request with an open task cannot be closed');
  assert.throws(()=>transaction(db,()=>wf.transition(db,office,r.id,'complete',{version:r.version,note:'أغلقناه'})),error=>['open_tasks','transition_denied'].includes(error.code));
  assert.throws(()=>transaction(db,()=>routing.settleRequestTask(db,office,r.id,task.id,{version:r.version,action:'complete',evidence:'أنهيتها عنه'})),code('forbidden'),'only the assignee completes their task');
  r=transaction(db,()=>routing.settleRequestTask(db,tech,r.id,task.id,{version:r.version,action:'complete',evidence:'فُحصت الوحدة ووُثق التسريب'}));
  assert.equal(routing.openTaskCount(db,r.id),0);
  assert.equal(routing.listRequestTasks(db,r)[0].status,'completed');
  assert.throws(()=>db.prepare("UPDATE request_tasks SET status='open' WHERE id=?").run(task.id),/settled request task is immutable/);
  r=transaction(db,()=>wf.transition(db,office,r.id,'complete',{version:r.version,note:'أُصلح التسريب وسُلم الموقع'}));
  assert.equal(r.status,'completed');
});

test('ROUTING: the service clock counts from submission and flags what is late',t=>{
  const db=setup(t),employee=user(db,'employee');
  const r=approvedMaintenance(db);
  const clock=routing.serviceClock(db,wf.getRequest(db,employee,r.id));
  assert.equal(clock.target_days,2,'maintenance carries a two-day target');
  assert.equal(clock.overdue,false);
  assert.equal(clock.due_on.length,10);
  // الأعمدة مسمّاة: request_versions صار له عمود خامس (digest) بالترحيل 146، وهذا صفُّ تثبيتٍ يبقى بلا ختم عمدًا.
  db.prepare('INSERT INTO request_versions(request_id,revision,snapshot,created_at) VALUES(?,0,?,?)').run(r.id,JSON.stringify({backdated:'fixture'}),new Date(Date.now()-9*86400000).toISOString());
  const late=routing.serviceClock(db,wf.getRequest(db,employee,r.id));
  assert.equal(late.overdue,true);
  assert.ok(late.days_left<0);
  const done=transaction(db,()=>wf.transition(db,user(db,'head-ceo-office'),r.id,'claim',{version:r.version}));
  const closed=transaction(db,()=>wf.transition(db,user(db,'head-ceo-office'),done.id,'complete',{version:done.version,note:'أُغلق بدليل'}));
  // مسح الكتالوج 20 سبتمبر (العطب 12): «يتوقف» كانت تعني «يُمحى»: due_on:null فلا يُعرف من الطلب المغلق
  // هل التُزم بزمنه. الساعة تتوقف عن الجري عند الإغلاق — ولا تُمحى: الاستحقاق يبقى، ومعه نتيجته.
  const after=routing.serviceClock(db,wf.getRequest(db,employee,closed.id));
  assert.equal(after.due_on?.length,10,'a closed request keeps the date it was due — it used to be null');
  assert.equal(after.met,false,'this one was closed nine days after a two-day target, and says so');
  assert.equal(after.overdue,true);
  assert.ok(after.closed_on,'with the day it was closed');
});

test('PORTAL: an employee sees their own requests, decisions, tasks and quick services',t=>{
  const db=setup(t),employee=user(db,'employee'),manager=user(db,'manager');
  const service=wf.catalog(db,employee).find(s=>s.code==='HR-LETTER');
  let r=wf.createRequest(db,employee,{service_id:service.id,title:'خطاب تعريف',payload:{purpose:'فتح حساب بنكي مصطنع',recipient:'بنك مصطنع'},project_id:null});
  r=transaction(db,()=>wf.transition(db,employee,r.id,'submit',{version:r.version}));
  const view=u=>routing.portal(db,u,{requests:wf.listRequests(db,u,'',''),projects:projects.listProjects(db,u),leave:null});
  const mine=view(employee);
  assert.equal(mine.me.department.name,'إدارة الخدمات الإبداعية');
  assert.equal(mine.counts.pending,1);
  assert.equal(mine.open[0].title,'خطاب تعريف');
  assert.equal(mine.decisions.length,0,'an employee is not asked to decide their own request');
  // الموجة 1: الخدمات السريعة من تاريخ طلبات الشخص نفسه؛ حُذفت قائمة الرموز الثمانية المكتوبة في الكود.
  assert.deepEqual(mine.quick_services.map(s=>s.code),['HR-LETTER'],'what this person has actually requested');
  assert.ok(mine.quick_services.every(s=>s.id&&s.name&&s.department_id));
  assert.deepEqual(view(user(db,'outsider')).quick_services,[],'no history means no suggestion, never a fixed menu');
  assert.ok(mine.department_services.some(s=>s.code==='CREATIVE-BRIEF'));
  assert.equal(mine.catalog_size,142,'the portal counts the full catalog');
  const managerView=view(manager);
  assert.equal(managerView.decisions.length,1,'the manager sees the decision waiting on them');
  assert.equal(managerView.decisions[0].id,r.id);
  assert.equal(managerView.counts.pending,undefined,'counts cover only the person’s own requests');
  assert.throws(()=>routing.portal(db,{id:'ghost',tenant_id:'36t'},{requests:[],projects:[],leave:null}),code('forbidden'));
});
