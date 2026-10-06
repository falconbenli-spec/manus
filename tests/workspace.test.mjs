import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import * as wf from '../app/workflow.mjs';
import * as workspace from '../app/workspace.mjs';
import { grantAccess } from '../app/access.mjs';
import { executiveBoard } from '../app/static/executive-ui.mjs';
import { orgPage } from '../app/static/org-ui.mjs';
import { workBoard as workBoardView } from '../app/static/work-ui.mjs';

const password='synthetic-workspace-only';
const code=c=>error=>error.code===c;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>String(value??'—');
function setup(t){const db=openDb(':memory:');seed(db,password);installServiceCatalog(db);t.after(()=>db.close());return db;}
function letter(db){
  const employee=user(db,'employee'),service=wf.catalog(db,employee).find(s=>s.code==='HR-LETTER');
  let r=wf.createRequest(db,employee,{service_id:service.id,title:'خطاب تعريف',payload:{purpose:'غرض مصطنع',recipient:'جهة مصطنعة'},project_id:null});
  // الانتقال داخل معاملة كما يناديه الخادم: transition يشترطها منذ حارس المعاملة في app/workflow.mjs.
  return transaction(db,()=>wf.transition(db,employee,r.id,'submit',{version:r.version}));
}

test('EXECUTIVE: the board reports aggregates only, and stays closed to accounts without a leadership role',t=>{
  const db=setup(t);
  letter(db);
  assert.throws(()=>workspace.executiveOverview(db,user(db,'employee')),code('forbidden'),'an employee does not read the company board');
  // الموجة 1: شرط واحد هو التصريح. كان الدور (مدير، موارد بشرية، أدمن) يفتح الدالة بينما يرفض المسار من لا يحمل executive.view.
  for(const id of ['hr','manager','ceo'])assert.throws(()=>workspace.executiveOverview(db,user(db,id)),code('forbidden'),`${id}: a role is not the capability`);
  assert.equal(workspace.canReadExecutive(db,user(db,'ceo')),false,'nobody is granted the capability by this wave — not even the chief executive account');
  transaction(db,()=>grantAccess(db,user(db,'admin'),{user_id:'hr',capability:'executive.view',note:'منح تجريبي لاختبار اللوحة التنفيذية'}));
  assert.equal(workspace.canReadExecutive(db,user(db,'hr')),true);
  const board=workspace.executiveOverview(db,user(db,'hr'));
  assert.equal(board.totals.departments,17);
  assert.equal(board.totals.open,1);
  assert.equal(board.by_status.pending,1);
  assert.equal(board.totals.completed,0);
  const serialized=JSON.stringify(board);
  assert.doesNotMatch(serialized,/خطاب تعريف/,'no request titles in an aggregate board');
  assert.doesNotMatch(serialized,/الموظفة التجريبية/,'no requester names in an aggregate board');
  assert.ok(board.departments.every(d=>typeof d.open==='number'&&typeof d.people==='number'));
  assert.ok(board.attention.some(a=>a.kind==='pending'));
  assert.ok(workspace.executiveOverview(db,user(db,'admin')).totals.people>0,'the first admin holds every non-sensitive capability');
  const html=executiveBoard(board,{e,name:'3,6T'});
  assert.match(html,/وضع الشركة الآن/);assert.match(html,/data-width="/);assert.doesNotMatch(html,/ style="/,'no inline styles, the content policy blocks them');
});

test('ORG: the chart shows each unit’s approver, escalation and size',t=>{
  const db=setup(t);
  const chart=workspace.orgChart(db,user(db,'employee'));
  assert.deepEqual(chart.executives.map(x=>x.id).sort(),['ceo','vp-corporate','vp-growth']);
  const growth=chart.sectors.find(s=>s.name==='قطاع النمو والقنوات');
  assert.ok(growth.units.length>=7);
  const office=chart.sectors.flatMap(s=>s.units).find(u=>u.id==='ceo-office');
  assert.equal(office.approver.id,'head-ceo-office','the named approver wins over the crowd of managers in the office');
  assert.equal(office.escalation.id,'ceo');
  const creative=chart.sectors.flatMap(s=>s.units).find(u=>u.id==='creative');
  assert.equal(creative.is_mine,true,'the employee’s own department is marked');
  assert.ok(creative.services>0&&creative.people>0);
  const html=orgPage(chart,{e});
  assert.match(html,/الهيكل التنظيمي/);assert.match(html,/نائب الرئيس للنمو والقنوات/);assert.doesNotMatch(html,/ style="/);
});

test('WORK: personal tasks belong to one person only, and the board gathers every kind of work',t=>{
  const db=setup(t);
  const employee=user(db,'employee'),manager=user(db,'manager');
  const submitted=letter(db);
  const taskId=transaction(db,()=>workspace.addPersonalTask(db,employee,{title:'تجهيز عرض العميل',list:'today',due_date:'2026-09-20'}));
  transaction(db,()=>workspace.addPersonalTask(db,employee,{title:'متابعة المورد',list:'later'}));
  const board=workspace.workBoard(db,employee,{requests:wf.listRequests(db,employee,'',''),projects:[]});
  assert.equal(board.personal.length,2);
  assert.equal(board.mine.length,1);
  assert.equal(board.mine[0].title,'خطاب تعريف');
  assert.equal(board.decisions.length,0);
  const managerBoard=workspace.workBoard(db,manager,{requests:wf.listRequests(db,manager,'',''),projects:[]});
  assert.equal(managerBoard.decisions.length,1,'the approver sees the decision waiting on them');
  assert.equal(managerBoard.personal.length,0,'personal lists are not shared');
  assert.throws(()=>transaction(db,()=>workspace.updatePersonalTask(db,manager,taskId,{status:'done'})),code('not_found'),'nobody edits another person’s task');
  assert.throws(()=>transaction(db,()=>workspace.deletePersonalTask(db,manager,taskId)),code('not_found'));
  const done=transaction(db,()=>workspace.updatePersonalTask(db,employee,taskId,{status:'done'}));
  assert.equal(done.status,'done');assert.ok(done.done_at);
  assert.equal(workspace.workBoard(db,employee,{requests:[],projects:[]}).personal.filter(t=>t.status==='open').length,1);
  transaction(db,()=>workspace.deletePersonalTask(db,employee,taskId));
  assert.equal(workspace.workBoard(db,employee,{requests:[],projects:[]}).personal.length,1);
  assert.throws(()=>transaction(db,()=>workspace.addPersonalTask(db,employee,{title:'x',list:'someday'})),code('list'));
  const html=workBoardView(workspace.workBoard(db,employee,{requests:wf.listRequests(db,employee,'',''),projects:[]}),{e,date});
  assert.match(html,/<h1>مهامي<\/h1>/,'عنوان #work اسمه في القائمة (اسمٌ واحد لكل شاشة)');assert.match(html,/data-action="finish-task"/);assert.doesNotMatch(html,/ style="/);
});
