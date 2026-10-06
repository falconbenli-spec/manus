import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { companyDepartments, executiveLayer } from './service-catalog.mjs';
import { can } from './access.mjs';
import { obligations } from './obligations.mjs';
import { clockFor, holidaySet } from './work-calendar.mjs';
import { AXES, axisStateName, executiveAxesBoard } from './project-axes.mjs';
import { portfolioForecast } from './pipeline-estimates.mjs';
import { executiveCockpit } from './executive-cockpit.mjs';

// اللوحة التنفيذية، والهيكل التنظيمي الحي، ولوح العمل اليومي.
const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const open=['draft','pending','returned','approved','in_progress'];
function actor(db,u){const current=currentUser(db,u);if(!current)fail(403,'forbidden','الحساب غير متاح');return current;}
// شرط واحد للوحة التنفيذية: تصريح executive.view. يستعمله مسار ‎/api/executive‎ وهذه الدالة وزر الرئيسية معًا.
// كان هنا فحص دور (مدير، موارد بشرية، أدمن) بينما يفحص المسار التصريح، فرسمت الرئيسية زرًا إلى «#executive» ثم ردّ المسار
// «لا يوجد تصريح لهذه الشاشة» — والمالك نفسه ممنوع من لوحته. لا يُمنح أحد التصريح هنا: منحه قرار المالك (الموجة 3).
export const EXECUTIVE_CAPABILITY='executive.view';
export const canReadExecutive=(db,u)=>can(db,u,EXECUTIVE_CAPABILITY);
// المشروع «في الإقفال» متى بدأ إقفاله بأي وجه، و«مقفل» متى أُقفل نهائيًا وحده.
const CLOSING=['closed_technically','closed_financially','awaiting_final','closed'];

// محفظة المشاريع والقمع، بأعداد فقط. بابهما تصريح «اللوحة التنفيذية» وحده لا دور القارئ:
// من كان يرى هذه اللوحة بدوره (مدير إدارة، رأس المال البشري) يبقى على ما كان يراه بالضبط،
// وما يُضاف هنا لحامل التصريح الذي يقرأ الكيان في مكتبة التقارير أصلًا (R11/R14).
function portfolioSummary(db,u){
  const board=executiveAxesBoard(db,u),projects=board.projects;
  const axes=AXES.map(axis=>{
    const counts=new Map();
    for(const project of projects){const state=project.axes[axis.key];counts.set(state,(counts.get(state)??0)+1);}
    return {key:axis.key,name:axis.name,owner_role:axis.owner_role,
      states:[...counts.entries()].map(([state,count])=>({state,name:axisStateName(axis.key,state),count})).sort((a,b)=>b.count-a.count||a.state.localeCompare(b.state))};
  });
  const funnel=portfolioForecast(db,u);
  return {
    projects:projects.length,
    closed:projects.filter(p=>p.axes.closure==='closed').length,
    in_closure:projects.filter(p=>CLOSING.includes(p.axes.closure)).length,
    running:projects.filter(p=>p.axes.execution==='in_progress').length,
    on_hold:projects.filter(p=>p.axes.execution==='on_hold').length,
    blocked_start:projects.filter(p=>['awaiting_client_po','awaiting_advance'].includes(p.axes.readiness)).length,
    overdue_collection:projects.filter(p=>p.axes.collection==='overdue').length,
    axes,
    funnel:{warning:funnel.warning,from:funnel.from,to:funnel.to,open_count:funnel.open_count,open_value_minor:funnel.open_value_minor,
      weighted_minor:funnel.weighted_minor,unweighted_count:funnel.unweighted_count,by_stage:funnel.by_stage,closed:funnel.closed,loss_reasons:funnel.loss_reasons},
    note:'أعداد وقيم مجمّعة: لا اسم مشروع ولا فرصة ولا عميل ولا صاحب عمل في هذه اللوحة.'
  };
}

// أرقام مجمّعة فقط: لا عناوين طلبات ولا أسماء أصحابها.
export function executiveOverview(db,supplied,options={}){
  const u=actor(db,supplied);
  if(!canReadExecutive(db,u))fail(403,'forbidden','اللوحة التنفيذية لحامل تصريح «اللوحة التنفيذية» وحده. يمنحه الأدمن الأول من «الحسابات والتصاريح» بقرار المالك.');
  const tenant=u.tenant_id,day=today();
  const departments=db.prepare('SELECT id,name,sector FROM departments WHERE tenant_id=? AND active=1 ORDER BY sector,name').all(tenant);
  const services=db.prepare("SELECT s.id,s.code,s.department_id,d.target_days,d.target_hours FROM services s LEFT JOIN service_directory d ON d.tenant_id=s.tenant_id AND d.service_code=s.code WHERE s.tenant_id=? AND s.active=1 AND s.version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)").all(tenant);
  const serviceById=new Map(services.map(s=>[s.id,s])),holidays=holidaySet(db,tenant);
  const requests=db.prepare('SELECT r.id,r.status,r.service_id,r.handling_department_id,r.created_at,r.updated_at FROM requests r WHERE r.tenant_id=?').all(tenant);
  const submitted=new Map(db.prepare('SELECT request_id,MIN(created_at) AS at FROM request_versions GROUP BY request_id').all().map(r=>[r.request_id,r.at]));
  const rows=new Map(departments.map(d=>[d.id,{...d,open:0,overdue:0,completed:0,closed_days:[],people:0}]));
  let overdue=0,completed=0,openTotal=0,onTime=0,measured=0;
  const byStatus={};
  for(const r of requests){
    const service=serviceById.get(r.service_id)??db.prepare('SELECT s.id,s.code,s.department_id,d.target_days,d.target_hours FROM services s LEFT JOIN service_directory d ON d.tenant_id=s.tenant_id AND d.service_code=s.code WHERE s.id=? AND s.tenant_id=?').get(r.service_id,tenant);
    const target={days:service?.target_days??0,hours:service?.target_hours??0};
    const departmentId=r.handling_department_id??service?.department_id;
    const row=rows.get(departmentId);
    byStatus[r.status]=(byStatus[r.status]??0)+1;
    if(open.includes(r.status)){
      openTotal++;if(row)row.open++;
      if((target.days||target.hours)&&clockFor(db,{...r,tenant_id:tenant},target,holidays,day).overdue){overdue++;if(row)row.overdue++;}
    }
    if(r.status==='completed'){
      completed++;if(row)row.completed++;
      const clock=clockFor(db,{...r,tenant_id:tenant},target,holidays,day);
      if(typeof clock.met==='boolean'){measured++;if(clock.met)onTime++;}
      const start=submitted.get(r.id)??r.created_at;
      const days=(Date.parse(r.updated_at)-Date.parse(start))/86400000;
      if(row&&Number.isFinite(days))row.closed_days.push(days);
    }
  }
  for(const person of db.prepare("SELECT department_id FROM users WHERE tenant_id=? AND active=1 AND role<>'admin'").all(tenant)){
    const row=rows.get(person.department_id);if(row)row.people++;
  }
  const tasks=db.prepare("SELECT due_date FROM request_tasks WHERE tenant_id=? AND status='open'").all(tenant);
  const headcount=db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND active=1 AND role<>'admin'").get(tenant).n;
  const gaps=departments.filter(d=>!db.prepare("SELECT 1 FROM users WHERE tenant_id=? AND department_id=? AND active=1 AND role='manager'").get(tenant,d.id)).map(d=>d.name);
  // المسار التنفيذي (المرحلة الثانية): الشركة كان يُقاس هنا حملُ طلباتها وحده، وتقف محفظتها
  // وقمعها خلف عضوية مشروع أو فريق حساب لا يملكها الرئيس التنفيذي. يظهران هنا لحامل
  // `executive.view` وحده، فلا تتسع اللوحة لمن كان يقرؤها بدوره.
  const portfolio=can(db,u,'executive.view')?portfolioSummary(db,u):null;
  const legacy={
    generated_at:now(),scope:'أرقام مجمّعة للكيان، دون عناوين الطلبات أو أسماء أصحابها',
    portfolio,
    totals:{
      people:headcount,departments:departments.length,services:services.length,
      open:openTotal,overdue,completed,
      on_time:measured?Math.round(onTime/measured*100):null,
      on_time_measured:measured,on_time_unmeasured:completed-measured,
      on_time_basis:'زمن الخدمة المسجل حاليًا، بأيام أو ساعات العمل، مع استبعاد العطل وانتظار صاحب الطلب؛ لا يمثل نسخة تاريخية من سياسة الزمن.',
      tasks_open:tasks.length,tasks_overdue:tasks.filter(t=>t.due_date<day).length
    },
    by_status:byStatus,
    departments:[...rows.values()].map(r=>({
      id:r.id,name:r.name,sector:r.sector,people:r.people,open:r.open,overdue:r.overdue,completed:r.completed,
      average_days:r.closed_days.length?Number((r.closed_days.reduce((a,b)=>a+b,0)/r.closed_days.length).toFixed(1)):null
    })).sort((a,b)=>b.open-a.open||b.people-a.people),
    attention:[
      ...(overdue?[{kind:'overdue',text:`${overdue} طلبًا تجاوز زمن الخدمة`}]:[]),
      ...gaps.map(name=>({kind:'no_manager',text:`${name}: بلا مدير نشط`})),
      ...(byStatus.pending?[{kind:'pending',text:`${byStatus.pending} طلبًا ينتظر قرار اعتماد`}]:[])
    ]
  };
  const cockpit=executiveCockpit(db,u,{...options,to:options.to??day,portfolio});
  const attention=[...legacy.attention,...cockpit.attention]
    .filter((item,index,list)=>list.findIndex(candidate=>candidate.text===item.text)===index)
    .slice(0,5);
  return {...legacy,...cockpit,scope:legacy.scope,attention};
}

export function orgChart(db,supplied){
  const u=actor(db,supplied);
  const tenant=u.tenant_id;
  const departments=db.prepare('SELECT id,name,sector FROM departments WHERE tenant_id=? AND active=1').all(tenant);
  const person=id=>db.prepare('SELECT id,name,role,active FROM users WHERE id=? AND tenant_id=?').get(id,tenant)??null;
  const sectorOf=id=>companyDepartments.find(d=>d.id===id)?.sector??'';
  const executives=executiveLayer.map(e=>({...e,user:person(e.id)})).filter(e=>e.user?.active);
  const units=departments.map(d=>{
    const head=db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND department_id=? AND role='manager' AND active=1 ORDER BY id").all(tenant,d.id);
    const assigned=db.prepare("SELECT user_id FROM department_routing WHERE tenant_id=? AND department_id=? AND step_role='department_manager'").get(tenant,d.id);
    const approver=assigned?person(assigned.user_id):(head.length===1?head[0]:null);
    const escalation=db.prepare('SELECT user_id FROM department_escalation WHERE tenant_id=? AND department_id=?').get(tenant,d.id);
    return {
      id:d.id,name:d.name,sector:d.sector||sectorOf(d.id),
      approver:approver?{id:approver.id,name:approver.name}:null,
      managers:head.length,
      escalation:escalation?person(escalation.user_id):null,
      people:db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id=? AND department_id=? AND active=1 AND role<>'admin'").get(tenant,d.id).n,
      services:db.prepare("SELECT COUNT(*) AS n FROM services s WHERE tenant_id=? AND department_id=? AND active=1 AND version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)").get(tenant,d.id).n,
      is_mine:d.id===u.department_id
    };
  });
  const sectors=[...new Set(units.map(unit=>unit.sector))].filter(Boolean);
  return {
    source:'الهيكل المعتمد المستلم في 16 سبتمبر 2026؛ الحسابات الظاهرة تجريبية.',
    executives,
    sectors:sectors.map(name=>({name,units:units.filter(unit=>unit.sector===name).sort((a,b)=>b.people-a.people||a.name.localeCompare(b.name,'ar'))})),
    unplaced:units.filter(unit=>!unit.sector)
  };
}

// لوح العمل اليومي: كل ما يخص الشخص في مكان واحد. لا يحسب قوائمه بنفسه: السلال الثلاث من obligations.mjs،
// فعدد «ينتظر قرارك» هنا هو عدد بطاقة الرئيسية وشارة القائمة و«بانتظار قراري» نفسه، والمهام الخاصة جزء من «أنفّذ».
export function workBoard(db,supplied,{requests,projects}={}){
  const u=actor(db,supplied),day=today();
  const mine=obligations(db,u,{...(requests?{requests}:{}),...(projects?{projects}:{})});
  const bucket=name=>mine.items.filter(i=>i.bucket===name);
  // أعمدة المهام الخاصة تحتاج صفوفها الكاملة (القائمة والترتيب والملاحظات وما أُنجز هذا الأسبوع)؛ المفتوح منها هو نفسه ما في «أنفّذ».
  const personal=db.prepare("SELECT * FROM personal_tasks WHERE tenant_id=? AND user_id=? AND (status='open' OR done_at>=?) ORDER BY list,sort_order,created_at")
    .all(u.tenant_id,u.id,new Date(Date.now()-7*86400000).toISOString());
  const respond=bucket('respond');
  return {
    day,counts:mine.counts,waiting_limit_days:mine.waiting_limit_days,unavailable:mine.unavailable,
    decisions:bucket('decide'),
    respond:respond.filter(i=>!i.optional),optional:respond.filter(i=>i.optional),
    doing:bucket('do'),
    mine:mine.watching,returned_by_me:mine.returned_by_me,
    personal:personal.map(t=>({...t,overdue:t.status==='open'&&!!t.due_date&&t.due_date<day}))
  };
}
export function addPersonalTask(db,supplied,input){
  if(!db.isTransaction)fail(500,'transaction_required','يلزم تنفيذ العملية داخل معاملة');
  const u=actor(db,supplied);
  v.object(input,['title','notes','due_date','list']);
  const list=input.list??'today';
  if(!['today','week','later'].includes(list))fail(400,'list','القائمة غير صالحة');
  const count=db.prepare("SELECT COUNT(*) AS n FROM personal_tasks WHERE user_id=? AND status='open'").get(u.id).n;
  if(count>=200)fail(409,'task_limit','الحد مئتا مهمة مفتوحة');
  const taskId=id(),time=now();
  db.prepare('INSERT INTO personal_tasks(id,tenant_id,user_id,title,notes,due_date,list,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(taskId,u.tenant_id,u.id,v.text(input.title,'المهمة',180,2),input.notes?v.text(input.notes,'ملاحظات',2000):'',input.due_date?v.date(input.due_date):null,list,count,time,time);
  return taskId;
}
export function updatePersonalTask(db,supplied,taskId,input){
  if(!db.isTransaction)fail(500,'transaction_required','يلزم تنفيذ العملية داخل معاملة');
  const u=actor(db,supplied);
  v.object(input,['title','notes','due_date','list','status']);
  const task=db.prepare('SELECT * FROM personal_tasks WHERE id=? AND user_id=?').get(taskId,u.id);
  if(!task)fail(404,'not_found','المهمة غير متاحة');
  const status=input.status??task.status;
  if(!['open','done'].includes(status))fail(400,'status','الحالة غير صالحة');
  const list=input.list??task.list;
  if(!['today','week','later'].includes(list))fail(400,'list','القائمة غير صالحة');
  const time=now();
  db.prepare('UPDATE personal_tasks SET title=?,notes=?,due_date=?,list=?,status=?,done_at=?,updated_at=? WHERE id=?')
    .run(input.title===undefined?task.title:v.text(input.title,'المهمة',180,2),
      input.notes===undefined?task.notes:v.text(input.notes,'ملاحظات',2000,0),
      input.due_date===undefined?task.due_date:(input.due_date?v.date(input.due_date):null),
      list,status,status==='done'?(task.done_at??time):null,time,taskId);
  return db.prepare('SELECT * FROM personal_tasks WHERE id=?').get(taskId);
}
export function deletePersonalTask(db,supplied,taskId){
  if(!db.isTransaction)fail(500,'transaction_required','يلزم تنفيذ العملية داخل معاملة');
  const u=actor(db,supplied);
  const task=db.prepare('SELECT * FROM personal_tasks WHERE id=? AND user_id=?').get(taskId,u.id);
  if(!task)fail(404,'not_found','المهمة غير متاحة');
  db.prepare('DELETE FROM personal_tasks WHERE id=?').run(taskId);
  return {deleted:true};
}
