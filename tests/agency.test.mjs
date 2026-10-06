import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject, listProjects } from '../app/projects.mjs';
import { clientsBoard, createClient, clientAction, createRetainer, recordRetainerUsage, offeringsBoard, prepareOffering, offeringAction, templatesBoard, createTemplate, applyTemplate, timeBoard, logTime, decideTime, removeTime } from '../app/agency.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-agency');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('lead-b','36t','creative','lead-b','مديرة حساب أخرى','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  return {db,users,tx};
}

test('criterion 1: a client file is visible only to its account team, even to someone holding the clients capability',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>createClient(db,users.employee,{legal_name:'عميل مصطنع',sector:'تجزئة'})),code('not_permitted'));
  const id=tx(()=>createClient(db,users.manager,{legal_name:'شركة العميل أ المصطنعة',trade_name:'العميل أ',sector:'تجزئة',status:'active'})).id;
  assert.throws(()=>tx(()=>createClient(db,users['lead-b'],{legal_name:'شركة العميل أ المصطنعة',sector:'تجزئة'})),code('duplicate_client'),'one client file, not one per department');
  assert.equal(clientsBoard(db,users['lead-b']).clients.length,0);
  assert.throws(()=>tx(()=>clientAction(db,users['lead-b'],id,'add_brand',{name:'علامة دخيلة',guideline_reference:''})),code('not_found'));
  assert.equal(clientsBoard(db,users.employee).clients.length,0);
  tx(()=>clientAction(db,users.manager,id,'add_member',{user_id:'employee',role:'مصممة الحساب'}));
  let view=clientsBoard(db,users.employee).clients[0];
  assert.equal(view.code,'C-0001');assert.equal(view.finance_hidden,true);assert.equal(view.invoiced_minor,null);
  tx(()=>clientAction(db,users.employee,id,'add_brand',{name:'علامة العميل أ',guideline_reference:'دليل الهوية المصطنع v2'}));
  tx(()=>clientAction(db,users.employee,id,'add_contact',{name:'ممثلة العميل',title:'مديرة التسويق',email:'m@client.invalid',phone:''}));
  assert.throws(()=>tx(()=>clientAction(db,users.employee,id,'add_member',{user_id:'outsider',role:'كاتب'})),code('forbidden'),'only the account owner changes the team');
  tx(()=>clientAction(db,users.manager,id,'remove_member',{user_id:'employee'}));
  assert.equal(clientsBoard(db,users.employee).clients.length,0,'removal ends access at once');
  view=clientsBoard(db,users.manager).clients[0];
  assert.equal(view.brands.length,1);assert.equal(view.contacts.length,1);
  assert.ok(verifyAudit(db));
});

test('E44: retainer usage is counted per deliverable type, and going over the balance needs a written basis',t=>{
  const {db,users,tx}=fixture(t);
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'عميل الاشتراك المصطنع',sector:'مطاعم',status:'active'})).id;
  const input={client_id:clientId,name:'محتوى شهري',period_month:'2026-09',allowances:[{type:'منشور',quantity:3},{type:'فيديو قصير',quantity:1}],contract_reference:'البند 4 من العقد المصطنع',carry_over_rule:'لا ترحيل؛ التجاوز بطلب تغيير مسعّر'};
  assert.throws(()=>tx(()=>createRetainer(db,users['lead-b'],input)),code('not_found'));
  const id=tx(()=>createRetainer(db,users.manager,input)).id;
  const use=(type,quantity,extra={})=>tx(()=>recordRetainerUsage(db,users.manager,id,{deliverable_type:type,quantity,reference:'مخرج مصطنع في الاستوديو',...extra}));
  assert.throws(()=>use('بودكاست',1),code('deliverable_type'));
  assert.equal(use('منشور',2).allowances[0].remaining,1);
  assert.throws(()=>use('منشور',2),code('overage_requires_note'));
  const over=use('منشور',2,{overage_note:'وافق العميل على منشور إضافي بطلب تغيير مصطنع رقم 7'});
  assert.deepEqual([over.allowances[0].used,over.allowances[0].remaining,over.allowances[0].over],[4,-1,true]);
  assert.throws(()=>db.prepare('DELETE FROM retainer_usage').run(),/corrected by a new record/);
});

test('commercial catalogue: a package lists countable deliverables, carries no invented price, is approved by someone else and revised by a new revision',t=>{
  const {db,users,tx}=fixture(t);
  const input={family:'content_social',name:'إدارة محتوى شهرية',pricing_model:'retainer',content:{audience:'علامات تجزئة متوسطة في السعودية',problem:'حضور اجتماعي غير منتظم ولا يخدم المبيعات',scope:'تخطيط وإنتاج ونشر محتوى لقناتين شهريًا',deliverables:[{name:'منشور مصمم',unit:'منشور',quantity:12,revisions:2},{name:'فيديو قصير',unit:'فيديو',quantity:4,revisions:1}],inputs:'دليل الهوية والمنتجات',exclusions:'الإنفاق الإعلاني والتصوير الخارجي',rights:'استخدام رقمي مدة العقد',acceptance:'اعتماد التقويم الشهري',kpis:'الوصول والتفاعل'}};
  assert.throws(()=>tx(()=>prepareOffering(db,users.employee,input)),code('not_permitted'));
  assert.throws(()=>tx(()=>prepareOffering(db,users.manager,{...input,content:{...input.content,deliverables:[]}})),code('deliverables'));
  const id=tx(()=>prepareOffering(db,users.manager,input)).id;
  assert.equal(offeringsBoard(db,users.manager).offerings[0].price_minor,null,'no default price');
  assert.equal(offeringsBoard(db,users.employee).offerings.length,0,'drafts are not for sale');
  assert.throws(()=>tx(()=>offeringAction(db,users.manager,id,'approve_offering',{note:'اعتماد ذاتي'})),code('action_unavailable'));
  tx(()=>offeringAction(db,users['lead-b'],id,'approve_offering',{note:'راجعت النطاق والمخرجات'}));
  const second=tx(()=>prepareOffering(db,users.manager,{...input,price:'18000.00'},id)).id;
  tx(()=>offeringAction(db,users['lead-b'],second,'approve_offering',{note:'سعر معتمد من إدارة الأعمال'}));
  const rows=offeringsBoard(db,users.manager).offerings;
  assert.deepEqual(rows.map(o=>[o.code,o.revision,o.status]),[['OF-001',2,'approved'],['OF-001',1,'retired']]);
  const forStaff=offeringsBoard(db,users.employee).offerings;
  assert.equal(forStaff.length,1);assert.equal(forStaff[0].price_minor,null);assert.equal(forStaff[0].price_hidden,true);
  assert.throws(()=>db.prepare("UPDATE offerings SET name='اسم آخر' WHERE id=?").run(second),/publish a new revision/);
});

test('E21: a project template creates dated tasks through the project rules, once per project',t=>{
  const {db,users,tx}=fixture(t);
  const project=tx(()=>createProject(db,users.manager,{name:'حملة أداء مصطنعة',brief:'اختبار قالب المشروع',member_ids:['employee']}));
  const phases=[{name:'الإعداد',tasks:[{title:'اعتماد البريف',offset_days:0,acceptance:'بريف معتمد'},{title:'إعداد القياس',offset_days:3,acceptance:'حدث تحويل مختبر'}]},{name:'الإطلاق',tasks:[{title:'إطلاق الحملة',offset_days:7,acceptance:'إعلانات نشطة ضمن السقف'}]}];
  assert.throws(()=>tx(()=>createTemplate(db,users.employee,{name:'قالب',service_kind:'أداء',phases})),code('forbidden'));
  const id=tx(()=>createTemplate(db,users.manager,{name:'حملة أداء',service_kind:'إعلانات رقمية',phases})).id;
  assert.throws(()=>tx(()=>applyTemplate(db,users.employee,id,{project_id:project.id,start_date:'2026-10-01',assignee_id:'employee'})),code('not_project_manager'),'مدير المشروع المسجل وحده يسند مهام القالب');
  assert.equal(tx(()=>applyTemplate(db,users.manager,id,{project_id:project.id,start_date:'2026-10-01',assignee_id:'employee'})).tasks_created,3);
  const tasks=listProjects(db,users.manager)[0].tasks;
  assert.deepEqual(tasks.map(x=>x.due_date),['2026-10-01','2026-10-04','2026-10-08']);assert.match(tasks[2].title,/^الإطلاق — /);
  assert.throws(()=>tx(()=>applyTemplate(db,users.manager,id,{project_id:project.id,start_date:'2026-10-01',assignee_id:'employee'})),code('already_applied'));
  assert.equal(templatesBoard(db,users.manager).templates.length,1);
});

test('time: hours are logged against own projects in 15-minute steps, approved by the line manager, and capacity is planning data not a target',t=>{
  const {db,users,tx}=fixture(t);
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع الساعات المصطنع',brief:'اختبار الساعات',member_ids:['employee']}));
  const log=(who,extra={})=>tx(()=>logTime(db,users[who],{project_id:project.id,work_date:today(),minutes:120,billable:true,note:'تصميم منشورات الحملة',...extra})).id;
  assert.throws(()=>log('outsider'),code('not_found'));
  assert.throws(()=>log('employee',{minutes:50}),code('minutes'));
  assert.throws(()=>log('employee',{work_date:'2099-01-01'}),code('work_date'));
  const id=log('employee');log('employee',{minutes:60,billable:false,note:'اجتماع داخلي'});
  assert.throws(()=>log('employee',{minutes:900}),code('day_exceeded'));
  assert.throws(()=>tx(()=>decideTime(db,users.employee,id,'approve',{})),code('not_found'));
  tx(()=>decideTime(db,users.manager,id,'approve',{}));
  assert.throws(()=>tx(()=>removeTime(db,users.employee,id)),code('not_found'),'an approved entry stays');
  const board=timeBoard(db,users.manager);
  const member=board.team.find(m=>m.id==='employee');
  assert.deepEqual([member.logged_minutes,member.billable_minutes,member.available_minutes,member.assumed_hours],[180,120,2400,true]);
  assert.equal(board.pending.length,1);assert.match(board.note,/لا تُستهدف نسبة 100%/);
  assert.equal(timeBoard(db,users.employee).entries.length,2);
});
