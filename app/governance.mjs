import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';

// ثلاثة سجلات حوكمة: الأهداف والمبادرات، المخاطر، القرارات والالتزامات.
// المنصة تحفظ ما يُدخله أصحابه وتعرضه كما هو: لا تحسب نسبة إنجاز، ولا تعرف مقياس مخاطر، ولا تقدّر أثر قرار.
export const INITIATIVE_STATUS={proposed:'مقترحة',approved:'معتمدة',running:'جارية',done:'منجزة',stopped:'متوقفة',cancelled:'ملغاة'};
export const RESPONSES={avoid:'تجنب',reduce:'تقليل',transfer:'نقل',accept_proposed:'قبول مقترح — بانتظار اعتماد أعلى',accept:'قبول معتمد'};
export const DIRECTIONS={up:'الأعلى أفضل',down:'الأدنى أفضل'};
export const LINK_TYPES={initiative:'مبادرة',project:'مشروع',obligation:'التزام نظامي'};
export const ATTENDANCE={present:'حاضر',absent:'غائب',delegate:'مفوَّض عنه'};
export const COMMITMENT_STATUS={open:'مفتوح',done:'منجز',cancelled:'ملغى'};
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'});
const today=()=>riyadh.format(new Date());
const id=()=>randomUUID();

function actor(db,supplied){const c=currentUser(db,supplied);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
function num(value,label){if(typeof value!=='number'||!Number.isFinite(value))fail(400,'invalid_number',`${label}: أدخل رقمًا`);return value;}
// المبلغ يدخل نصًا عشريًا بالريال ويُخزَّن هللات صحيحة؛ لا حساب عشري عائم على المال.
function amount(value,label){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: أدخل قيمة بالريال بمنزلتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(minor>1000000000000n)fail(400,'invalid_money',`${label}: المبلغ خارج الحد العددي`);
  return Number(minor);
}
function person(db,u,userId,code){
  const row=db.prepare("SELECT id,name FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(userId,u.tenant_id);
  if(!row)fail(400,code,'الشخص غير متاح في هذا الكيان');
  return row;
}
const nameOf=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const staff=(db,u)=>db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id);
// سلسلة من هم أعلى من الشخص في الهيكل. تُستعمل لقبول المخاطر؛ من لا مدير له لا يقبل أحدٌ مخاطره في المنصة.
function chainAbove(db,userId){
  const above=new Set();
  let current=db.prepare('SELECT manager_id FROM users WHERE id=?').get(userId)?.manager_id??null;
  while(current&&!above.has(current)){above.add(current);current=db.prepare('SELECT manager_id FROM users WHERE id=?').get(current)?.manager_id??null;}
  return above;
}
// تحقق تفاؤلي: كل تعديل يحمل رقم النسخة التي فُتحت عليها الشاشة.
function nextVersion(record,input){
  if(!Number.isInteger(input?.version)||input.version!==record.version)fail(409,'stale_version','تغير السجل منذ فتحه. أعد التحميل');
  return record.version+1;
}

// ============================== أ. الأهداف والمبادرات ==============================
const liveMeasurements=(db,indicatorId)=>db.prepare(
  'SELECT m.*,x.name AS recorded_by_name FROM governance_measurements m JOIN users x ON x.id=m.recorded_by WHERE m.indicator_id=? AND NOT EXISTS(SELECT 1 FROM governance_measurements c WHERE c.corrects_id=m.id) ORDER BY m.measured_on DESC,m.recorded_at DESC').all(indicatorId);

function shapeIndicator(db,u,indicator,initiative,manage){
  const measurements=liveMeasurements(db,indicator.id),latest=measurements[0]??null;
  const mayMeasure=manage||initiative.owner_id===u.id;
  return {...indicator,direction_name:DIRECTIONS[indicator.direction],created_by_name:nameOf(db,indicator.created_by),
    measurements:measurements.map(m=>({id:m.id,value:m.value,measured_on:m.measured_on,source:m.source,recorded_at:m.recorded_at,recorded_by_name:m.recorded_by_name,corrects_id:m.corrects_id})),
    latest:latest?{value:latest.value,measured_on:latest.measured_on,source:latest.source,recorded_by_name:latest.recorded_by_name}:null,
    // لا نسبة إنجاز: القياس الفعلي مقابل المستهدف، والفجوة فرق عددي بالوحدة نفسها.
    gap:latest?Math.round((indicator.target_value-latest.value)*1000)/1000:null,
    actions:mayMeasure&&!['done','stopped','cancelled'].includes(initiative.status)?['record_measurement']:[]};
}
function shapeInitiative(db,u,initiative,objective,manage,date){
  const indicators=db.prepare('SELECT * FROM governance_indicators WHERE initiative_id=? ORDER BY title').all(initiative.id).map(x=>shapeIndicator(db,u,x,initiative,manage));
  const owner=initiative.owner_id===u.id,proposer=initiative.proposed_by===u.id,actions=[];
  if(initiative.status==='proposed'&&(manage||proposer))actions.push('edit_initiative');
  // من يعتمد المبادرة ليس من اقترحها.
  if(initiative.status==='proposed'&&manage&&!proposer)actions.push('approve_initiative');
  if(initiative.status==='approved'&&(manage||owner))actions.push('start_initiative');
  if(initiative.status==='running'&&(manage||owner))actions.push('complete_initiative');
  if(['approved','running'].includes(initiative.status)&&(manage||owner))actions.push('stop_initiative');
  if(['proposed','approved'].includes(initiative.status)&&manage)actions.push('cancel_initiative');
  if(!['done','stopped','cancelled'].includes(initiative.status)&&(manage||owner))actions.push('add_indicator');
  return {...initiative,status_name:INITIATIVE_STATUS[initiative.status],owner_name:nameOf(db,initiative.owner_id),proposed_by_name:nameOf(db,initiative.proposed_by),
    approved_by_name:nameOf(db,initiative.approved_by),objective_title:objective.title,department_id:objective.department_id,
    late:initiative.due_date<date&&['proposed','approved','running'].includes(initiative.status),
    indicators,actions,needs_approval:initiative.status==='proposed'&&manage&&!proposer};
}
function shapeObjective(db,u,objective,manage,date){
  const initiatives=db.prepare('SELECT * FROM governance_initiatives WHERE objective_id=? ORDER BY due_date').all(objective.id).map(x=>shapeInitiative(db,u,x,objective,manage,date));
  const actions=[];
  if(objective.status==='open'&&manage)actions.push('edit_objective','close_objective');
  if(objective.status==='open'&&(manage||objective.owner_id===u.id))actions.push('add_initiative');
  return {...objective,owner_name:nameOf(db,objective.owner_id),department_name:db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(objective.department_id,objective.tenant_id)?.name??objective.department_id,
    status_name:objective.status==='open'?'قائم':'مقفل',initiatives,actions};
}

export function objectivesBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'governance.objectives.manage'),view=manage||can(db,u,'executive.view'),date=today();
  const all=db.prepare('SELECT * FROM governance_objectives WHERE tenant_id=? ORDER BY period_from DESC,title').all(u.tenant_id).map(o=>shapeObjective(db,u,o,manage,date));
  const mine=o=>o.owner_id===u.id||o.initiatives.some(i=>i.owner_id===u.id||i.proposed_by===u.id);
  const objectives=view?all:all.filter(mine);
  const initiatives=objectives.flatMap(o=>o.initiatives);
  return {today:date,can_manage:manage,can_view:view,statuses:INITIATIVE_STATUS,directions:DIRECTIONS,
    departments:db.prepare('SELECT id,name FROM departments WHERE tenant_id=? ORDER BY name').all(u.tenant_id),
    people:manage||objectives.length?staff(db,u):[],
    budgets:manage?db.prepare("SELECT b.id,b.cost_center,b.cap_minor,p.name AS project_name FROM project_budgets b JOIN projects p ON p.id=b.project_id WHERE b.tenant_id=? AND b.status='active' ORDER BY p.name").all(u.tenant_id):[],
    objectives,
    counters:{objectives:objectives.length,initiatives:initiatives.length,late:initiatives.filter(i=>i.late).length,
      proposed:initiatives.filter(i=>i.status==='proposed').length,running:initiatives.filter(i=>i.status==='running').length,
      indicators:initiatives.flatMap(i=>i.indicators).length,unmeasured:initiatives.flatMap(i=>i.indicators).filter(x=>!x.latest).length},
    inbox:initiatives.filter(i=>i.needs_approval).map(i=>({id:i.id,title:i.title,created_at:i.created_at,actions:['approve_initiative']})),
    note:'المنصة لا تحسب نسبة إنجاز للمبادرة من عدد المهام. ما تراه هو القياس الفعلي المسجَّل مقابل المستهدف، وكل قياس بمصدره وتاريخه ومن أدخله. القياس المسجَّل لا يُعدَّل؛ التصحيح قياس جديد يشير إليه. مؤشر بلا قياس فراغ لا صفر.'};
}

export function createObjective(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'governance.objectives.manage'))fail(403,'not_permitted','سجل الأهداف لحامل تصريحه');
  v.object(input,['department_id','title','statement','owner_id','period_from','period_to']);
  const department=db.prepare('SELECT id FROM departments WHERE id=? AND tenant_id=?').get(input.department_id,u.tenant_id);
  if(!department)fail(400,'department_id','الإدارة غير موجودة');
  const owner=person(db,u,input.owner_id,'owner_id'),from=v.date(input.period_from),to=v.date(input.period_to);
  if(to<=from)fail(400,'date_order','نهاية الفترة بعد بدايتها');
  const title=v.text(input.title,'الهدف',200,5),statement=v.text(input.statement,'ما الذي يقيس تحقق الهدف',2000,10),time=now(),objectiveId=id();
  if(db.prepare('SELECT 1 FROM governance_objectives WHERE tenant_id=? AND department_id=? AND period_from=? AND title=?').get(u.tenant_id,department.id,from,title))fail(409,'duplicate_objective','الهدف مسجل لهذه الإدارة والفترة');
  db.prepare('INSERT INTO governance_objectives(id,tenant_id,department_id,title,statement,owner_id,period_from,period_to,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(objectiveId,u.tenant_id,department.id,title,statement,owner.id,from,to,u.id,time,time);
  audit(db,u,'governance_objective',objectiveId,'objective.created',{}, {title,department_id:department.id,period_from:from,period_to:to});
  return {id:objectiveId};
}

export function objectiveAction(db,supplied,objectiveId,action,input){
  writing(db);const u=actor(db,supplied),manage=can(db,u,'governance.objectives.manage'),date=today();
  const row=typeof objectiveId==='string'&&db.prepare('SELECT * FROM governance_objectives WHERE id=? AND tenant_id=?').get(objectiveId,u.tenant_id);
  if(!row)fail(404,'not_found','الهدف غير متاح');
  const current=shapeObjective(db,u,row,manage,date);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة الهدف أو لحسابك');
  const time=now();
  if(action==='edit_objective'){
    v.object(input,['version','title','statement','owner_id','period_from','period_to']);
    const version=nextVersion(row,input),owner=person(db,u,input.owner_id,'owner_id');
    const from=v.date(input.period_from),to=v.date(input.period_to);
    if(to<=from)fail(400,'date_order','نهاية الفترة بعد بدايتها');
    db.prepare('UPDATE governance_objectives SET title=?,statement=?,owner_id=?,period_from=?,period_to=?,version=?,updated_at=? WHERE id=?')
      .run(v.text(input.title,'الهدف',200,5),v.text(input.statement,'ما الذي يقيس تحقق الهدف',2000,10),owner.id,from,to,version,time,row.id);
  }else{
    v.object(input,['version','closure_note']);
    const version=nextVersion(row,input),note=v.text(input.closure_note,'خلاصة الإقفال',2000,5);
    if(row.owner_id===u.id)fail(409,'separation_of_duties','صاحب الهدف لا يقفل هدفه بنفسه');
    db.prepare("UPDATE governance_objectives SET status='closed',closure_note=?,version=?,updated_at=? WHERE id=?").run(note,version,time,row.id);
  }
  audit(db,u,'governance_objective',row.id,'objective.'+action,{title:row.title,status:row.status},{status:action==='close_objective'?'closed':row.status});
  return {id:row.id};
}

export function createInitiative(db,supplied,input){
  writing(db);const u=actor(db,supplied),manage=can(db,u,'governance.objectives.manage');
  v.object(input,['objective_id','title','owner_id','due_date','budget_amount','budget_id','budget_note']);
  const objective=typeof input.objective_id==='string'&&db.prepare("SELECT * FROM governance_objectives WHERE id=? AND tenant_id=? AND status='open'").get(input.objective_id,u.tenant_id);
  if(!objective)fail(404,'not_found','الهدف غير متاح أو مقفل');
  if(!manage&&objective.owner_id!==u.id)fail(403,'not_permitted','اقتراح المبادرة لحامل تصريح السجل أو صاحب الهدف');
  const owner=person(db,u,input.owner_id,'owner_id'),due=v.date(input.due_date),title=v.text(input.title,'المبادرة',200,5);
  if(due<objective.period_from||due>objective.period_to)fail(400,'due_date','موعد المبادرة خارج فترة الهدف');
  const budgetMinor=amount(input.budget_amount,'ميزانية المبادرة');
  const budget=input.budget_id?db.prepare("SELECT id FROM project_budgets WHERE id=? AND tenant_id=? AND status='active'").get(input.budget_id,u.tenant_id):null;
  if(input.budget_id&&!budget)fail(400,'budget_id','المخصص غير متاح أو غير نشط');
  if(db.prepare('SELECT 1 FROM governance_initiatives WHERE objective_id=? AND title=?').get(objective.id,title))fail(409,'duplicate_initiative','المبادرة مسجلة تحت هذا الهدف');
  const time=now(),initiativeId=id();
  db.prepare('INSERT INTO governance_initiatives(id,tenant_id,objective_id,title,owner_id,due_date,budget_minor,budget_id,budget_note,proposed_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(initiativeId,u.tenant_id,objective.id,title,owner.id,due,budgetMinor,budget?.id??null,input.budget_note?v.text(input.budget_note,'بيان الميزانية',1000):'',u.id,time,time);
  audit(db,u,'governance_initiative',initiativeId,'initiative.proposed',{}, {objective_id:objective.id,title,due_date:due});
  return {id:initiativeId};
}

export function initiativeAction(db,supplied,initiativeId,action,input){
  writing(db);const u=actor(db,supplied),manage=can(db,u,'governance.objectives.manage'),date=today();
  const row=typeof initiativeId==='string'&&db.prepare('SELECT * FROM governance_initiatives WHERE id=? AND tenant_id=?').get(initiativeId,u.tenant_id);
  if(!row)fail(404,'not_found','المبادرة غير متاحة');
  const objective=db.prepare('SELECT * FROM governance_objectives WHERE id=?').get(row.objective_id);
  const current=shapeInitiative(db,u,row,objective,manage,date);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة المبادرة أو لحسابك');
  const time=now();
  if(action==='edit_initiative'){
    v.object(input,['version','title','owner_id','due_date','budget_amount','budget_id','budget_note']);
    const version=nextVersion(row,input),owner=person(db,u,input.owner_id,'owner_id'),due=v.date(input.due_date);
    if(due<objective.period_from||due>objective.period_to)fail(400,'due_date','موعد المبادرة خارج فترة الهدف');
    const budget=input.budget_id?db.prepare("SELECT id FROM project_budgets WHERE id=? AND tenant_id=? AND status='active'").get(input.budget_id,u.tenant_id):null;
    if(input.budget_id&&!budget)fail(400,'budget_id','المخصص غير متاح أو غير نشط');
    db.prepare('UPDATE governance_initiatives SET title=?,owner_id=?,due_date=?,budget_minor=?,budget_id=?,budget_note=?,version=?,updated_at=? WHERE id=?')
      .run(v.text(input.title,'المبادرة',200,5),owner.id,due,amount(input.budget_amount,'ميزانية المبادرة'),budget?.id??null,input.budget_note?v.text(input.budget_note,'بيان الميزانية',1000):'',version,time,row.id);
  }else if(action==='approve_initiative'){
    v.object(input,['version','note']);
    const version=nextVersion(row,input),note=v.text(input.note,'ما الذي اعتمدته ولماذا',2000,10);
    if(row.proposed_by===u.id)fail(409,'separation_of_duties','من اقترح المبادرة لا يعتمدها');
    db.prepare("UPDATE governance_initiatives SET status='approved',approved_by=?,approved_at=?,decision_note=?,version=?,updated_at=? WHERE id=?").run(u.id,time,note,version,time,row.id);
  }else if(action==='start_initiative'){
    v.object(input,['version']);
    db.prepare("UPDATE governance_initiatives SET status='running',version=?,updated_at=? WHERE id=?").run(nextVersion(row,input),time,row.id);
  }else{
    v.object(input,['version','outcome_note']);
    const version=nextVersion(row,input),note=v.text(input.outcome_note,'ما الذي انتهت إليه المبادرة',2000,10);
    const target={complete_initiative:'done',stop_initiative:'stopped',cancel_initiative:'cancelled'}[action];
    db.prepare('UPDATE governance_initiatives SET status=?,outcome_note=?,version=?,updated_at=? WHERE id=?').run(target,note,version,time,row.id);
  }
  audit(db,u,'governance_initiative',row.id,'initiative.'+action,{status:row.status},{status:db.prepare('SELECT status FROM governance_initiatives WHERE id=?').get(row.id).status});
  return {id:row.id};
}

export function createIndicator(db,supplied,input){
  writing(db);const u=actor(db,supplied),manage=can(db,u,'governance.objectives.manage');
  v.object(input,['initiative_id','title','unit','baseline_value','target_value','direction','measurement_source']);
  const initiative=typeof input.initiative_id==='string'&&db.prepare('SELECT * FROM governance_initiatives WHERE id=? AND tenant_id=?').get(input.initiative_id,u.tenant_id);
  if(!initiative||['done','stopped','cancelled'].includes(initiative.status))fail(404,'not_found','المبادرة غير متاحة لإضافة مؤشر');
  if(!manage&&initiative.owner_id!==u.id)fail(403,'not_permitted','إضافة المؤشر لحامل تصريح السجل أو مالك المبادرة');
  if(!Object.hasOwn(DIRECTIONS,input.direction))fail(400,'direction','اختر الاتجاه المطلوب للمؤشر');
  const title=v.text(input.title,'المؤشر',200,3);
  if(db.prepare('SELECT 1 FROM governance_indicators WHERE initiative_id=? AND title=?').get(initiative.id,title))fail(409,'duplicate_indicator','المؤشر مسجل تحت هذه المبادرة');
  const baseline=num(input.baseline_value,'خط الأساس'),target=num(input.target_value,'المستهدف');
  if(baseline===target)fail(400,'target_value','المستهدف يساوي خط الأساس؛ اكتب مستهدفًا يختلف عنه أو راجع خط الأساس');
  const time=now(),indicatorId=id();
  db.prepare('INSERT INTO governance_indicators(id,tenant_id,initiative_id,title,unit,baseline_value,target_value,direction,measurement_source,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(indicatorId,u.tenant_id,initiative.id,title,v.text(input.unit,'وحدة القياس',60,1),baseline,target,input.direction,v.text(input.measurement_source,'مصدر القياس: من أين يُقرأ الرقم ومن يقرؤه',1500,10),u.id,time,time);
  audit(db,u,'governance_indicator',indicatorId,'indicator.created',{}, {initiative_id:initiative.id,title,baseline,target});
  return {id:indicatorId};
}

// القياس إدخال موثّق بمصدره وتاريخه ومن أدخله. لا يُعدَّل، والتصحيح قياس جديد يشير إلى المصحَّح.
export function recordMeasurement(db,supplied,indicatorId,input){
  writing(db);const u=actor(db,supplied),manage=can(db,u,'governance.objectives.manage');
  const indicator=typeof indicatorId==='string'&&db.prepare('SELECT * FROM governance_indicators WHERE id=? AND tenant_id=?').get(indicatorId,u.tenant_id);
  if(!indicator)fail(404,'not_found','المؤشر غير متاح');
  const initiative=db.prepare('SELECT * FROM governance_initiatives WHERE id=?').get(indicator.initiative_id);
  if(['done','stopped','cancelled'].includes(initiative.status))fail(409,'invalid_state','المبادرة انتهت؛ لا يُسجل عليها قياس جديد');
  if(!manage&&initiative.owner_id!==u.id)fail(403,'not_permitted','تسجيل القياس لحامل تصريح السجل أو مالك المبادرة');
  v.object(input,['value','measured_on','source','corrects_id','correction_reason']);
  const value=num(input.value,'القيمة المقاسة'),measured=v.date(input.measured_on),date=today();
  if(measured>date)fail(400,'measured_on','تاريخ القياس في المستقبل');
  let corrects=null;
  if(input.corrects_id){
    corrects=db.prepare('SELECT * FROM governance_measurements WHERE id=? AND indicator_id=?').get(input.corrects_id,indicator.id);
    if(!corrects)fail(400,'corrects_id','القياس المراد تصحيحه غير موجود لهذا المؤشر');
    if(db.prepare('SELECT 1 FROM governance_measurements WHERE corrects_id=?').get(corrects.id))fail(409,'already_corrected','هذا القياس صُحح من قبل');
  }
  const measurementId=id();
  db.prepare('INSERT INTO governance_measurements(id,indicator_id,value,measured_on,source,recorded_by,recorded_at,corrects_id,correction_reason) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(measurementId,indicator.id,value,measured,v.text(input.source,'مصدر هذا القياس بعينه',1000,5),u.id,now(),corrects?.id??null,corrects?v.text(input.correction_reason,'سبب التصحيح',1000,5):'');
  audit(db,u,'governance_indicator',indicator.id,corrects?'measurement.corrected':'measurement.recorded',corrects?{value:corrects.value,measured_on:corrects.measured_on}:{}, {value,measured_on:measured});
  return {id:measurementId};
}

// ============================== ب. سجل المخاطر ==============================
function scaleOf(db,u){
  const levels=db.prepare('SELECT * FROM governance_risk_levels WHERE tenant_id=? ORDER BY kind,value').all(u.tenant_id);
  return {likelihood:levels.filter(l=>l.kind==='likelihood'),impact:levels.filter(l=>l.kind==='impact'),
    bands:db.prepare('SELECT * FROM governance_risk_bands WHERE tenant_id=? ORDER BY min_score').all(u.tenant_id)};
}
function shapeRisk(db,u,risk,scale,manage,date){
  const score=risk.likelihood_value*risk.impact_value,band=scale.bands.find(b=>score>=b.min_score&&score<=b.max_score)??null;
  const above=chainAbove(db,risk.owner_id),mine=risk.owner_id===u.id||risk.treatment_owner_id===u.id;
  const acceptance=db.prepare('SELECT a.*,x.name AS accepted_by_name FROM governance_risk_acceptances a JOIN users x ON x.id=a.accepted_by WHERE a.risk_id=? AND a.owner_id=? ORDER BY a.accepted_at DESC LIMIT 1').get(risk.id,risk.owner_id)??null;
  const reviewOverdue=risk.status==='open'&&risk.next_review_on<date,actions=[];
  if(risk.status==='open'&&(manage||mine))actions.push('edit_risk','review_risk');
  if(risk.status==='open'&&risk.response==='accept_proposed'&&above.has(u.id))actions.push('accept_risk');
  if(risk.status==='open'&&manage)actions.push('close_risk');
  return {...risk,score,band:band?.label??null,response_name:RESPONSES[risk.response],owner_name:nameOf(db,risk.owner_id),
    treatment_owner_name:nameOf(db,risk.treatment_owner_id),created_by_name:nameOf(db,risk.created_by),
    likelihood_label:scale.likelihood.find(l=>l.value===risk.likelihood_value)?.label??String(risk.likelihood_value),
    impact_label:scale.impact.find(l=>l.value===risk.impact_value)?.label??String(risk.impact_value),
    link_type_name:risk.link_type?LINK_TYPES[risk.link_type]:null,link_title:linkTitle(db,risk),
    review_overdue:reviewOverdue,treatment_late:risk.status==='open'&&!!risk.treatment_due&&risk.treatment_due<date,
    awaiting_acceptance:risk.status==='open'&&risk.response==='accept_proposed',
    acceptance_blocked:risk.response==='accept_proposed'&&above.size===0,
    acceptance:acceptance&&risk.response==='accept'?{accepted_by_name:acceptance.accepted_by_name,accepted_at:acceptance.accepted_at,reason:acceptance.reason}:null,
    reviews:db.prepare('SELECT r.*,x.name AS reviewed_by_name FROM governance_risk_reviews r JOIN users x ON x.id=r.reviewed_by WHERE r.risk_id=? ORDER BY r.reviewed_at DESC LIMIT 6').all(risk.id),
    actions,needs_me:(reviewOverdue&&(manage||mine))||(risk.response==='accept_proposed'&&risk.status==='open'&&above.has(u.id))};
}
function linkTitle(db,risk){
  if(!risk.link_id)return null;
  const q={initiative:'SELECT title AS t FROM governance_initiatives WHERE id=? AND tenant_id=?',project:'SELECT name AS t FROM projects WHERE id=? AND tenant_id=?',obligation:'SELECT title AS t FROM compliance_obligations WHERE id=? AND tenant_id=?'}[risk.link_type];
  return q?db.prepare(q).get(risk.link_id,risk.tenant_id)?.t??null:null;
}

export function risksBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'governance.risks.manage'),view=manage||can(db,u,'executive.view'),date=today(),scale=scaleOf(db,u);
  const all=db.prepare('SELECT * FROM governance_risks WHERE tenant_id=? ORDER BY status,next_review_on').all(u.tenant_id).map(r=>shapeRisk(db,u,r,scale,manage,date));
  const risks=view?all:all.filter(r=>r.owner_id===u.id||r.treatment_owner_id===u.id||r.actions.includes('accept_risk'));
  const open=risks.filter(r=>r.status==='open');
  return {today:date,can_manage:manage,can_view:view,responses:RESPONSES,link_types:LINK_TYPES,
    scale:{likelihood:scale.likelihood.map(l=>({value:l.value,label:l.label,description:l.description})),impact:scale.impact.map(l=>({value:l.value,label:l.label,description:l.description})),
      bands:scale.bands.map(b=>({label:b.label,min_score:b.min_score,max_score:b.max_score})),
      defined:scale.likelihood.length>0&&scale.impact.length>0,defined_by:nameOf(db,scale.likelihood[0]?.defined_by)},
    people:manage?staff(db,u):[],
    links:manage?{initiative:db.prepare("SELECT id,title FROM governance_initiatives WHERE tenant_id=? AND status NOT IN ('done','cancelled') ORDER BY title").all(u.tenant_id),
      project:db.prepare('SELECT id,name AS title FROM projects WHERE tenant_id=? ORDER BY name').all(u.tenant_id),
      obligation:db.prepare('SELECT id,title FROM compliance_obligations WHERE tenant_id=? AND active=1 ORDER BY title').all(u.tenant_id)}:{initiative:[],project:[],obligation:[]},
    risks,
    counters:{open:open.length,review_overdue:open.filter(r=>r.review_overdue).length,awaiting_acceptance:open.filter(r=>r.awaiting_acceptance).length,
      treatment_late:open.filter(r=>r.treatment_late).length,closed:risks.length-open.length},
    inbox:risks.filter(r=>r.needs_me).map(r=>({id:r.id,title:r.title,due_date:r.next_review_on,created_at:r.updated_at,
      actions:[r.review_overdue?'review_risk':null,r.actions.includes('accept_risk')?'accept_risk':null].filter(Boolean)})),
    note:scale.likelihood.length&&scale.impact.length
      ?'مقياس الاحتمال والأثر ونطاقات الدرجة يعرّفها صاحب الإجراء في هذه الشاشة، والمنصة لا تفرض مقياسًا ولا مصفوفة. الدرجة = الاحتمال × الأثر بالقيم التي عرّفها، ولا معنى لها خارج هذا المقياس.'
      :'لم يُعرَّف مقياس المخاطر بعد. لا يُسجَّل خطر قبل أن يعرّف صاحب الإجراء درجات الاحتمال والأثر بنفسه؛ المنصة لا تفترض مقياس 1–5 ولا مصفوفة جاهزة.'};
}

// المقياس إعداد كامل يُستبدل دفعة واحدة؛ درجة مستعملة في خطر مسجل لا تُسحب.
export function saveRiskScale(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'governance.risks.manage'))fail(403,'not_permitted','تعريف مقياس المخاطر لحامل تصريح السجل');
  v.object(input,['likelihood','impact','bands']);
  const levels=[];
  for(const kind of ['likelihood','impact']){
    const list=Array.isArray(input[kind])?input[kind]:null;
    if(!list||!list.length)fail(400,kind,'عرّف درجة واحدة على الأقل لكل من الاحتمال والأثر');
    if(list.length>20)fail(400,kind,'عدد الدرجات كبير؛ عشرون درجة حد كافٍ');
    for(const level of list){
      v.object(level,['value','label','description']);
      if(!Number.isInteger(level.value)||level.value<1||level.value>99)fail(400,kind,'قيمة الدرجة عدد صحيح من 1 إلى 99');
      levels.push({kind,value:level.value,label:v.text(level.label,'اسم الدرجة',120,2),description:level.description?v.text(level.description,'شرح الدرجة',600):''});
    }
    if(new Set(list.map(l=>l.value)).size!==list.length)fail(400,kind,'قيمة الدرجة مكررة');
  }
  const bands=[];
  for(const band of Array.isArray(input.bands)?input.bands:[]){
    v.object(band,['label','min_score','max_score']);
    if(!Number.isInteger(band.min_score)||!Number.isInteger(band.max_score)||band.min_score<1||band.max_score<band.min_score)fail(400,'bands','نطاق الدرجة عددان صحيحان والأعلى ليس أقل من الأدنى');
    bands.push({label:v.text(band.label,'اسم النطاق',120,2),min_score:band.min_score,max_score:band.max_score});
  }
  // درجة مستعملة في خطر مسجل لا تُسحب ولا يتغير معناها، وإلا فقد تقدير ذلك الخطر معناه.
  const wanted=new Map(levels.map(l=>[`${l.kind}:${l.value}`,l])),time=now();
  for(const level of db.prepare('SELECT * FROM governance_risk_levels WHERE tenant_id=?').all(u.tenant_id)){
    const key=`${level.kind}:${level.value}`,match=wanted.get(key);
    if(match&&match.label===level.label&&match.description===level.description){wanted.delete(key);continue;}
    if(db.prepare(`SELECT 1 FROM governance_risks WHERE tenant_id=? AND ${level.kind==='likelihood'?'likelihood_value':'impact_value'}=?`).get(u.tenant_id,level.value))
      fail(409,'scale_in_use',`الدرجة «${level.label}» مستعملة في خطر مسجل؛ لا تُسحب من المقياس ولا يتغير معناها. أضف درجة جديدة بدلًا منها`);
    db.prepare('DELETE FROM governance_risk_levels WHERE id=?').run(level.id);
  }
  for(const level of wanted.values())
    db.prepare('INSERT INTO governance_risk_levels(id,tenant_id,kind,value,label,description,defined_by,defined_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,level.kind,level.value,level.label,level.description,u.id,time);
  db.prepare('DELETE FROM governance_risk_bands WHERE tenant_id=?').run(u.tenant_id);
  for(const band of bands)db.prepare('INSERT INTO governance_risk_bands(id,tenant_id,label,min_score,max_score,defined_by,defined_at) VALUES(?,?,?,?,?,?,?)').run(id(),u.tenant_id,band.label,band.min_score,band.max_score,u.id,time);
  audit(db,u,'governance_risk_scale',u.tenant_id,'risk_scale.defined',{}, {likelihood:levels.filter(l=>l.kind==='likelihood').length,impact:levels.filter(l=>l.kind==='impact').length,bands:bands.length});
  return {id:u.tenant_id};
}

function riskFields(db,u,input){
  if(!Object.hasOwn(RESPONSES,input.response)||input.response==='accept')fail(400,'response','الاستجابة: تجنب أو تقليل أو نقل أو قبول مقترح. القبول النافذ يسجله من هو أعلى من المالك');
  const owner=person(db,u,input.owner_id,'owner_id'),scale=scaleOf(db,u);
  if(!scale.likelihood.some(l=>l.value===input.likelihood_value))fail(400,'likelihood_value','الاحتمال من درجات المقياس المعرَّف');
  if(!scale.impact.some(l=>l.value===input.impact_value))fail(400,'impact_value','الأثر من درجات المقياس المعرَّف');
  // استجابة غير القبول تلزمها خطة معالجة بمالك وموعد؛ والقبول لا يحمل خطة ولا مالك معالجة.
  const accepted=input.response==='accept_proposed';
  if(!accepted&&(!input.treatment_owner_id||!input.treatment_due))fail(400,'treatment','استجابة غير القبول تلزمها خطة معالجة بمالك وموعد');
  const plan=accepted?'':v.text(input.treatment_plan,'خطة المعالجة',3000,10);
  const treatmentOwner=accepted?null:person(db,u,input.treatment_owner_id,'treatment_owner_id');
  const treatmentDue=accepted?null:v.date(input.treatment_due);
  return {title:v.text(input.title,'الخطر',200,5),description:v.text(input.description,'وصف الخطر',3000,10),category:v.text(input.category,'الفئة',120,2),
    owner_id:owner.id,likelihood_value:input.likelihood_value,impact_value:input.impact_value,response:input.response,
    existing_controls:input.existing_controls?v.text(input.existing_controls,'الضوابط القائمة',2000):'',
    treatment_plan:plan,
    treatment_owner_id:treatmentOwner?.id??null,treatment_due:treatmentDue,next_review_on:v.date(input.next_review_on),
    link_type:input.link_type||null,link_id:input.link_type?input.link_id:null};
}

export function createRisk(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'governance.risks.manage'))fail(403,'not_permitted','تسجيل المخاطر لحامل تصريح السجل');
  v.object(input,['title','description','category','owner_id','likelihood_value','impact_value','response','existing_controls','treatment_plan','treatment_owner_id','treatment_due','next_review_on','link_type','link_id']);
  const scale=scaleOf(db,u);
  if(!scale.likelihood.length||!scale.impact.length)fail(409,'scale_undefined','عرّف مقياس الاحتمال والأثر أولًا؛ المنصة لا تفترض مقياسًا');
  const fields=riskFields(db,u,input);
  if(fields.next_review_on<today())fail(400,'next_review_on','تاريخ المراجعة التالية في الماضي');
  if(db.prepare('SELECT 1 FROM governance_risks WHERE tenant_id=? AND title=?').get(u.tenant_id,fields.title))fail(409,'duplicate_risk','الخطر مسجل بهذا العنوان');
  const time=now(),riskId=id();
  db.prepare('INSERT INTO governance_risks(id,tenant_id,title,description,category,owner_id,likelihood_value,impact_value,response,existing_controls,treatment_plan,treatment_owner_id,treatment_due,next_review_on,link_type,link_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(riskId,u.tenant_id,fields.title,fields.description,fields.category,fields.owner_id,fields.likelihood_value,fields.impact_value,fields.response,fields.existing_controls,fields.treatment_plan,fields.treatment_owner_id,fields.treatment_due,fields.next_review_on,fields.link_type,fields.link_id,u.id,time,time);
  audit(db,u,'governance_risk',riskId,'risk.registered',{}, {title:fields.title,response:fields.response,likelihood:fields.likelihood_value,impact:fields.impact_value});
  return {id:riskId};
}

// هل آخر قبول لهذا المالك قُبل على هذه الدرجة وهذا العنوان والوصف حرفيًا؟ قبول بلا لقطة (أقدم من الهجرة 091) لا يثبت شيئًا.
function acceptedAsIs(db,riskId,ownerId,fields){
  const snap=db.prepare(`SELECT s.* FROM governance_risk_acceptances a JOIN governance_risk_acceptance_snapshots s ON s.acceptance_id=a.id
    WHERE a.risk_id=? AND a.owner_id=? ORDER BY a.accepted_at DESC,a.rowid DESC LIMIT 1`).get(riskId,ownerId);
  return !!snap&&snap.likelihood_value===fields.likelihood_value&&snap.impact_value===fields.impact_value&&snap.title===fields.title&&snap.description===fields.description;
}
export function riskAction(db,supplied,riskId,action,input){
  writing(db);const u=actor(db,supplied),manage=can(db,u,'governance.risks.manage'),date=today(),scale=scaleOf(db,u);
  const row=typeof riskId==='string'&&db.prepare('SELECT * FROM governance_risks WHERE id=? AND tenant_id=?').get(riskId,u.tenant_id);
  if(!row)fail(404,'not_found','الخطر غير متاح');
  const current=shapeRisk(db,u,row,scale,manage,date);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة الخطر أو لحسابك');
  const time=now();
  if(action==='edit_risk'){
    v.object(input,['version','title','description','category','owner_id','likelihood_value','impact_value','response','existing_controls','treatment_plan','treatment_owner_id','treatment_due','next_review_on','link_type','link_id']);
    const version=nextVersion(row,input),fields=riskFields(db,u,input);
    if(!manage&&fields.owner_id!==row.owner_id)fail(403,'not_permitted','نقل ملكية الخطر لحامل تصريح السجل');
    // القبول النافذ يبقى نافذًا ما بقي مالكه، وما بقي الخطر هو نفسه الذي قُبل: الاحتمال والأثر والعنوان والوصف
    // كما في لقطة القبول. أي تغيير فيها أو في المالك يعيد الخطر إلى «قبول مقترح» ويحتاج اعتمادًا جديدًا ممن هو أعلى.
    const acceptanceStands=row.response==='accept'&&fields.response==='accept_proposed'&&fields.owner_id===row.owner_id
      &&acceptedAsIs(db,row.id,row.owner_id,fields);
    const response=acceptanceStands?'accept':fields.response;
    db.prepare('UPDATE governance_risks SET title=?,description=?,category=?,owner_id=?,likelihood_value=?,impact_value=?,response=?,existing_controls=?,treatment_plan=?,treatment_owner_id=?,treatment_due=?,next_review_on=?,link_type=?,link_id=?,version=?,updated_at=? WHERE id=?')
      .run(fields.title,fields.description,fields.category,fields.owner_id,fields.likelihood_value,fields.impact_value,response,fields.existing_controls,fields.treatment_plan,fields.treatment_owner_id,fields.treatment_due,fields.next_review_on,fields.link_type,fields.link_id,version,time,row.id);
  }else if(action==='review_risk'){
    v.object(input,['version','note','likelihood_value','impact_value','next_review_on']);
    const version=nextVersion(row,input),note=v.text(input.note,'خلاصة المراجعة',2000,5),next=v.date(input.next_review_on);
    if(!scale.likelihood.some(l=>l.value===input.likelihood_value))fail(400,'likelihood_value','الاحتمال من درجات المقياس المعرَّف');
    if(!scale.impact.some(l=>l.value===input.impact_value))fail(400,'impact_value','الأثر من درجات المقياس المعرَّف');
    if(next<=date)fail(400,'next_review_on','تاريخ المراجعة التالية بعد اليوم');
    db.prepare('INSERT INTO governance_risk_reviews(id,risk_id,reviewed_by,reviewed_at,note,likelihood_value,impact_value,next_review_on) VALUES(?,?,?,?,?,?,?,?)')
      .run(id(),row.id,u.id,time,note,input.likelihood_value,input.impact_value,next);
    // مراجعة غيّرت تقدير خطر مقبول تعيده إلى «قبول مقترح»: القبول كان لتلك الدرجة لا لهذه.
    const response=row.response==='accept'&&!acceptedAsIs(db,row.id,row.owner_id,{...row,likelihood_value:input.likelihood_value,impact_value:input.impact_value})?'accept_proposed':row.response;
    db.prepare('UPDATE governance_risks SET likelihood_value=?,impact_value=?,response=?,next_review_on=?,version=?,updated_at=? WHERE id=?').run(input.likelihood_value,input.impact_value,response,next,version,time,row.id);
  }else if(action==='accept_risk'){
    v.object(input,['version','reason']);
    const version=nextVersion(row,input),reason=v.text(input.reason,'سبب قبول الخطر',2000,10);
    if(row.owner_id===u.id)fail(409,'separation_of_duties','مالك الخطر لا يقبل خطره بنفسه');
    if(!chainAbove(db,row.owner_id).has(u.id))fail(403,'not_above_owner','قبول الخطر لمن هو أعلى من مالكه في الهيكل');
    const acceptanceId=id();
    db.prepare('INSERT INTO governance_risk_acceptances(id,risk_id,owner_id,accepted_by,reason,accepted_at) VALUES(?,?,?,?,?,?)').run(acceptanceId,row.id,row.owner_id,u.id,reason,time);
    // لقطة ما قُبل فعلًا: القبول لا ينتقل إلى خطر غيّر مالكه درجته أو وصفه بعده.
    db.prepare('INSERT INTO governance_risk_acceptance_snapshots(acceptance_id,risk_id,likelihood_value,impact_value,score,title,description) VALUES(?,?,?,?,?,?,?)')
      .run(acceptanceId,row.id,row.likelihood_value,row.impact_value,row.likelihood_value*row.impact_value,row.title,row.description);
    db.prepare("UPDATE governance_risks SET response='accept',version=?,updated_at=? WHERE id=?").run(version,time,row.id);
  }else{
    v.object(input,['version','closure_note']);
    const version=nextVersion(row,input),note=v.text(input.closure_note,'سبب إقفال الخطر',2000,5);
    if(row.owner_id===u.id)fail(409,'separation_of_duties','مالك الخطر لا يقفل خطره بنفسه');
    db.prepare("UPDATE governance_risks SET status='closed',closure_note=?,version=?,updated_at=? WHERE id=?").run(note,version,time,row.id);
  }
  audit(db,u,'governance_risk',row.id,'risk.'+action,{response:row.response,status:row.status,next_review_on:row.next_review_on},
    {...db.prepare('SELECT response,status,next_review_on FROM governance_risks WHERE id=?').get(row.id)});
  return {id:row.id};
}

// ============================== ج. القرارات والالتزامات والمحاضر ==============================
function shapeCommitment(db,u,commitment,record,date){
  const actions=[];
  if(commitment.status==='open'&&(commitment.owner_id===u.id||record))actions.push('record_execution');
  if(commitment.status==='open'&&record)actions.push('cancel_commitment');
  return {...commitment,status_name:COMMITMENT_STATUS[commitment.status],owner_name:nameOf(db,commitment.owner_id),
    closed_by_name:nameOf(db,commitment.closed_by),created_by_name:nameOf(db,commitment.created_by),
    late:commitment.status==='open'&&commitment.due_date<date,
    source_title:commitment.decision_id?db.prepare('SELECT title FROM governance_decisions WHERE id=?').get(commitment.decision_id)?.title??''
      :db.prepare('SELECT title FROM governance_minutes WHERE id=?').get(commitment.minute_id)?.title??'',
    actions,needs_me:commitment.status==='open'&&commitment.owner_id===u.id&&commitment.due_date<date};
}
function shapeMinute(db,u,minute,record){
  const draft=minute.status==='draft',actions=[];
  if(draft&&record&&minute.prepared_by===u.id)actions.push('edit_minute');
  // من أعدّ المحضر لا يعتمده.
  if(draft&&record&&minute.prepared_by!==u.id)actions.push('approve_minute');
  if(record)actions.push('add_commitment');
  return {...minute,status_name:draft?'مسودة':'معتمد',prepared_by_name:nameOf(db,minute.prepared_by),approved_by_name:nameOf(db,minute.approved_by),
    attendees:db.prepare('SELECT a.*,x.name FROM governance_minute_attendees a JOIN users x ON x.id=a.user_id WHERE a.minute_id=? ORDER BY x.name').all(minute.id)
      .map(a=>({user_id:a.user_id,name:a.name,attendance:a.attendance,attendance_name:ATTENDANCE[a.attendance],note:a.note})),
    items:db.prepare('SELECT position,title,note FROM governance_minute_items WHERE minute_id=? ORDER BY position').all(minute.id),
    actions,needs_approval:draft&&record&&minute.prepared_by!==u.id};
}
function shapeDecision(db,u,decision,record){
  return {...decision,decided_by_name:nameOf(db,decision.decided_by),recorded_by_name:nameOf(db,decision.recorded_by),
    minute_title:decision.minute_id?db.prepare('SELECT title FROM governance_minutes WHERE id=?').get(decision.minute_id)?.title??'':'',
    reverses_title:decision.reverses_id?db.prepare('SELECT title FROM governance_decisions WHERE id=?').get(decision.reverses_id)?.title??'':'',
    reversed_by:db.prepare('SELECT id,title,decided_on FROM governance_decisions WHERE reverses_id=? ORDER BY decided_on LIMIT 1').get(decision.id)??null,
    actions:record?['reverse_decision','add_commitment']:[]};
}

export function decisionsBoard(db,supplied){
  const u=actor(db,supplied),record=can(db,u,'governance.decisions.record'),view=record||can(db,u,'executive.view'),date=today();
  const decisions=view?db.prepare('SELECT * FROM governance_decisions WHERE tenant_id=? ORDER BY decided_on DESC,recorded_at DESC LIMIT 200').all(u.tenant_id).map(d=>shapeDecision(db,u,d,record)):[];
  const minutes=db.prepare('SELECT * FROM governance_minutes WHERE tenant_id=? ORDER BY meeting_date DESC LIMIT 100').all(u.tenant_id).map(m=>shapeMinute(db,u,m,record))
    .filter(m=>view||m.prepared_by===u.id||m.attendees.some(a=>a.user_id===u.id));
  const allCommitments=db.prepare('SELECT * FROM governance_commitments WHERE tenant_id=? ORDER BY status,due_date').all(u.tenant_id).map(c=>shapeCommitment(db,u,c,record,date));
  const commitments=view?allCommitments:allCommitments.filter(c=>c.owner_id===u.id);
  const open=commitments.filter(c=>c.status==='open');
  return {today:date,can_record:record,can_view:view,attendance:ATTENDANCE,commitment_statuses:COMMITMENT_STATUS,
    people:record?staff(db,u):[],decisions,minutes,commitments,
    counters:{decisions:decisions.length,reversed:decisions.filter(d=>d.reversed_by).length,minutes:minutes.length,
      draft_minutes:minutes.filter(m=>m.status==='draft').length,open:open.length,late:open.filter(c=>c.late).length,
      done:commitments.filter(c=>c.status==='done').length},
    inbox:[...minutes.filter(m=>m.needs_approval).map(m=>({id:m.id,title:m.title,created_at:m.created_at,actions:['approve_minute']})),
      ...commitments.filter(c=>c.needs_me).map(c=>({id:c.id,title:c.title,due_date:c.due_date,created_at:c.created_at,actions:['record_execution']}))],
    note:'القرار المسجَّل لا يُعدَّل إطلاقًا: العدول عنه قرار جديد يشير إليه ويبقى القديم ظاهرًا. المحضر المعتمد كذلك. «الأثر» هنا هو ما كتبه متخذ القرار وقتها، والمنصة لا تقيس أثرًا متحققًا ولا تربطه بأرقام تلقائيًا.'};
}

export function recordDecision(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'governance.decisions.record'))fail(403,'not_permitted','تسجيل القرارات لحامل تصريح السجل');
  v.object(input,['title','context','alternatives','decision','impact','decided_by','decided_on','reference','minute_id','reverses_id','reversal_reason']);
  const decidedBy=person(db,u,input.decided_by,'decided_by'),decidedOn=v.date(input.decided_on),date=today();
  if(decidedOn>date)fail(400,'decided_on','تاريخ القرار في المستقبل');
  const minute=input.minute_id?db.prepare('SELECT id FROM governance_minutes WHERE id=? AND tenant_id=?').get(input.minute_id,u.tenant_id):null;
  if(input.minute_id&&!minute)fail(400,'minute_id','المحضر غير متاح');
  const reverses=input.reverses_id?db.prepare('SELECT id,title FROM governance_decisions WHERE id=? AND tenant_id=?').get(input.reverses_id,u.tenant_id):null;
  if(input.reverses_id&&!reverses)fail(400,'reverses_id','القرار المراد العدول عنه غير موجود');
  const time=now(),decisionId=id(),title=v.text(input.title,'عنوان القرار',200,5);
  db.prepare('INSERT INTO governance_decisions(id,tenant_id,title,context,alternatives,decision,impact,decided_by,decided_on,reference,minute_id,reverses_id,reversal_reason,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(decisionId,u.tenant_id,title,v.text(input.context,'السياق',4000,10),v.text(input.alternatives,'البدائل التي نُظر فيها',4000,10),
      v.text(input.decision,'نص القرار',4000,10),v.text(input.impact,'أثر القرار كما يراه متخذه',4000,10),decidedBy.id,decidedOn,
      input.reference?v.text(input.reference,'مرجع القرار',500):'',minute?.id??null,reverses?.id??null,reverses?v.text(input.reversal_reason,'سبب العدول',2000,10):'',u.id,time);
  audit(db,u,'governance_decision',decisionId,'decision.recorded',{}, {title,decided_by:decidedBy.id,decided_on:decidedOn,reverses_id:reverses?.id??null});
  return {id:decisionId};
}

export function createMinute(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'governance.decisions.record'))fail(403,'not_permitted','تسجيل المحاضر لحامل تصريح السجل');
  v.object(input,['title','meeting_date','location','attendees','items']);
  const fields=minuteFields(db,u,input),time=now(),minuteId=id();
  db.prepare('INSERT INTO governance_minutes(id,tenant_id,title,meeting_date,location,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(minuteId,u.tenant_id,fields.title,fields.meeting_date,fields.location,u.id,time,time);
  writeMinuteChildren(db,minuteId,fields);
  audit(db,u,'governance_minute',minuteId,'minute.drafted',{}, {title:fields.title,meeting_date:fields.meeting_date,attendees:fields.attendees.length,items:fields.items.length});
  return {id:minuteId};
}
function minuteFields(db,u,input){
  const attendees=Array.isArray(input.attendees)?input.attendees:[];
  if(!attendees.length)fail(400,'attendees','محضر بلا حاضرين ليس محضرًا');
  if(attendees.length>60)fail(400,'attendees','عدد الحاضرين كبير');
  const seen=new Set(),rows=[];
  for(const a of attendees){
    v.object(a,['user_id','attendance','note']);
    const who=person(db,u,a.user_id,'attendees');
    if(seen.has(who.id))fail(400,'attendees','الحاضر مكرر');
    seen.add(who.id);
    if(!Object.hasOwn(ATTENDANCE,a.attendance))fail(400,'attendees','حالة الحضور غير صالحة');
    rows.push({user_id:who.id,attendance:a.attendance,note:a.note?v.text(a.note,'ملاحظة الحاضر',300):''});
  }
  const items=Array.isArray(input.items)?input.items:[];
  if(!items.length)fail(400,'items','محضر بلا بنود ليس محضرًا');
  if(items.length>60)fail(400,'items','عدد البنود كبير');
  const list=items.map((item,index)=>{v.object(item,['title','note']);return {position:index+1,title:v.text(item.title,'بند المحضر',300,3),note:item.note?v.text(item.note,'تفصيل البند',2000):''};});
  const meeting=v.date(input.meeting_date);
  if(meeting>today())fail(400,'meeting_date','تاريخ الاجتماع في المستقبل');
  return {title:v.text(input.title,'عنوان المحضر',200,5),meeting_date:meeting,location:input.location?v.text(input.location,'مكان الاجتماع',200):'',attendees:rows,items:list};
}
function writeMinuteChildren(db,minuteId,fields){
  db.prepare('DELETE FROM governance_minute_items WHERE minute_id=?').run(minuteId);
  db.prepare('DELETE FROM governance_minute_attendees WHERE minute_id=?').run(minuteId);
  for(const a of fields.attendees)db.prepare('INSERT INTO governance_minute_attendees(minute_id,user_id,attendance,note) VALUES(?,?,?,?)').run(minuteId,a.user_id,a.attendance,a.note);
  for(const item of fields.items)db.prepare('INSERT INTO governance_minute_items(id,minute_id,position,title,note) VALUES(?,?,?,?,?)').run(id(),minuteId,item.position,item.title,item.note);
}

export function minuteAction(db,supplied,minuteId,action,input){
  writing(db);const u=actor(db,supplied),record=can(db,u,'governance.decisions.record');
  const row=typeof minuteId==='string'&&db.prepare('SELECT * FROM governance_minutes WHERE id=? AND tenant_id=?').get(minuteId,u.tenant_id);
  if(!row)fail(404,'not_found','المحضر غير متاح');
  const current=shapeMinute(db,u,row,record);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة المحضر أو لحسابك');
  const time=now();
  if(action==='edit_minute'){
    v.object(input,['version','title','meeting_date','location','attendees','items']);
    const version=nextVersion(row,input),fields=minuteFields(db,u,input);
    db.prepare('UPDATE governance_minutes SET title=?,meeting_date=?,location=?,version=?,updated_at=? WHERE id=?').run(fields.title,fields.meeting_date,fields.location,version,time,row.id);
    writeMinuteChildren(db,row.id,fields);
  }else{
    v.object(input,['version','note']);
    const version=nextVersion(row,input);
    v.text(input.note,'ما الذي راجعته في المحضر',2000,5);
    if(row.prepared_by===u.id)fail(409,'separation_of_duties','من أعدّ المحضر لا يعتمده');
    db.prepare("UPDATE governance_minutes SET status='approved',approved_by=?,approved_at=?,version=?,updated_at=? WHERE id=?").run(u.id,time,version,time,row.id);
  }
  audit(db,u,'governance_minute',row.id,'minute.'+action,{status:row.status},{status:action==='approve_minute'?'approved':'draft'},action==='approve_minute'?input.note:'');
  return {id:row.id};
}

export function createCommitment(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'governance.decisions.record'))fail(403,'not_permitted','تسجيل الالتزامات لحامل تصريح السجل');
  v.object(input,['decision_id','minute_id','title','detail','owner_id','due_date']);
  const decision=input.decision_id?db.prepare('SELECT id FROM governance_decisions WHERE id=? AND tenant_id=?').get(input.decision_id,u.tenant_id):null;
  const minute=input.minute_id?db.prepare('SELECT id FROM governance_minutes WHERE id=? AND tenant_id=?').get(input.minute_id,u.tenant_id):null;
  if(input.decision_id&&!decision)fail(400,'decision_id','القرار غير متاح');
  if(input.minute_id&&!minute)fail(400,'minute_id','المحضر غير متاح');
  if(!decision&&!minute)fail(400,'source','الالتزام ينشأ عن قرار أو محضر؛ اختر مصدره');
  const owner=person(db,u,input.owner_id,'owner_id'),due=v.date(input.due_date),time=now(),commitmentId=id(),title=v.text(input.title,'الالتزام',200,5);
  db.prepare('INSERT INTO governance_commitments(id,tenant_id,decision_id,minute_id,title,detail,owner_id,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(commitmentId,u.tenant_id,decision?.id??null,minute?.id??null,title,input.detail?v.text(input.detail,'تفصيل الالتزام',2000):'',owner.id,due,u.id,time,time);
  audit(db,u,'governance_commitment',commitmentId,'commitment.created',{}, {title,owner_id:owner.id,due_date:due});
  return {id:commitmentId};
}

export function commitmentAction(db,supplied,commitmentId,action,input){
  writing(db);const u=actor(db,supplied),record=can(db,u,'governance.decisions.record'),date=today();
  const row=typeof commitmentId==='string'&&db.prepare('SELECT * FROM governance_commitments WHERE id=? AND tenant_id=?').get(commitmentId,u.tenant_id);
  if(!row)fail(404,'not_found','الالتزام غير متاح');
  const current=shapeCommitment(db,u,row,record,date);
  if(!current.actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة الالتزام أو لحسابك');
  v.object(input,['version','closure_evidence']);
  const version=nextVersion(row,input);
  const evidence=v.text(input.closure_evidence,action==='record_execution'?'دليل الإغلاق: ما الذي أُنجز وأين دليله':'سبب الإلغاء',2000,5),time=now();
  db.prepare('UPDATE governance_commitments SET status=?,closure_evidence=?,closed_by=?,closed_at=?,version=?,updated_at=? WHERE id=?')
    .run(action==='record_execution'?'done':'cancelled',evidence,u.id,time,version,time,row.id);
  audit(db,u,'governance_commitment',row.id,'commitment.'+action,{status:'open'},{status:action==='record_execution'?'done':'cancelled'},evidence);
  return {id:row.id};
}
