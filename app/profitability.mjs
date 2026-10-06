import { randomUUID } from 'node:crypto';
import { audit, hash, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can, holds } from './access.mjs';
import { FAMILIES } from './agency.mjs';

// تكلفة الساعة والربحية.
//
// قرار مقصود — الخصوصية قبل الدقة: معدل التكلفة يُحدَّد بالفئة الوظيفية لا بالشخص. لو نُسبت التكلفة للفرد
// لاستنتج كل من يفتح تقرير ربحية راتبَ زميله من قسمة التكلفة على ساعاته. لذلك لا يحمل جدول المعدلات
// معرّف مستخدم، ولا يُشتق معدل من جدول الرواتب: يدخله صاحب الإجراء بمصدره ويعتمده شخص آخر.
//
// وقرار ثانٍ: المعدل المطبق هو الساري **في تاريخ الساعة** لا اليوم. رفع المعدل هذا الشهر لا يعيد
// تسعير ساعات الربع الماضي، وإلا تغيّرت ربحية مشروع مقفل بلا حدث.

export const METHODS={per_hour:'مبلغ ثابت لكل ساعة',percent_of_direct_cost:'نسبة من التكلفة المباشرة'};
export const RATE_STATUS={draft:'مسودة',approved:'معتمد',rejected:'مرفوض'};
// حد التجميع: الرقم المجمّع من الرواتب لا يُعرض لمجموعة أصغر من هذا، وإلا صار كشفًا لراتب فرد بصيغة متوسط.
const MIN_GROUP=5;
const FAR_PAST='1900-01-01';

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const id=()=>randomUUID();
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const c=currentUser(db,supplied);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
function costing(db,u){if(!can(db,u,'costing.manage'))fail(403,'not_permitted','معدلات التكلفة لحامل تصريح إدارة التكلفة');}
function viewing(db,u){if(!can(db,u,'profitability.view'))fail(403,'not_permitted','تقارير الربحية لحامل تصريح الاطلاع عليها');}

// المبالغ بالهللات. المعدل بالساعة، والنسبة بنقاط أساس (10000 = 100%).
function money(value,label){
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: أدخل مبلغًا عشريًا بمنزلتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(minor<1)fail(400,'invalid_money',`${label}: المبلغ موجب`);
  return minor;
}
function percent(value,label){
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(value))fail(400,'invalid_percent',`${label}: أدخل نسبة مئوية بمنزلتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),points=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(points<1||points>100000)fail(400,'invalid_percent',`${label}: النسبة من 0.01 إلى 1000`);
  return points;
}
const decimal=minor=>`${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`;

/* ───── البحث عن الساري في تاريخ ───── */
// آخر نسخة معتمدة بدأ سريانها في ذلك التاريخ أو قبله. غياب النسخة ليس صفرًا: هو «غير مُكلَّف» ويُعلن كذلك.
// الذاكرة المؤقتة مدتها حسبة واحدة، وكيانها ثابت فيها؛ بدونها يستعلم كل سطر ساعة مرتين وتتضاعف الكلفة بعدد السجلات.
const cached=(cache,key,load)=>{if(!cache)return load();if(!cache.has(key))cache.set(key,load());return cache.get(key);};
const rateAt=(db,tenantId,categoryId,date,cache)=>cached(cache,`rate:${categoryId}:${date}`,()=>db.prepare("SELECT * FROM category_cost_rates WHERE tenant_id=? AND category_id=? AND status='approved' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1").get(tenantId,categoryId,date)??null);
const categoryAt=(db,tenantId,userId,date,cache)=>cached(cache,`cat:${userId}:${date}`,()=>db.prepare('SELECT * FROM employee_job_categories WHERE tenant_id=? AND user_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1').get(tenantId,userId,date)??null);
const overheadAt=(db,tenantId,date,cache)=>cached(cache,`over:${date}`,()=>db.prepare("SELECT * FROM overhead_rates WHERE tenant_id=? AND status='approved' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1").get(tenantId,date)??null);

/* ───── شاشة معدلات التكلفة ───── */
function categoryRow(db,u,categoryId){
  const c=typeof categoryId==='string'&&db.prepare('SELECT * FROM job_categories WHERE id=? AND tenant_id=?').get(categoryId,u.tenant_id);
  if(!c)fail(404,'not_found','الفئة الوظيفية غير متاحة');
  return c;
}
function rateView(db,u,r){
  const actions=[];
  if(r.status==='draft'&&r.prepared_by!==u.id)actions.push('approve_rate','reject_rate');
  return {...r,status_name:RATE_STATUS[r.status],rate:decimal(r.rate_minor),prepared_by_name:name(db,r.prepared_by),decided_by_name:name(db,r.decided_by),actions};
}
function overheadView(db,u,r){
  const actions=[];
  if(r.status==='draft'&&r.prepared_by!==u.id)actions.push('approve_overhead','reject_overhead');
  return {...r,status_name:RATE_STATUS[r.status],method_name:METHODS[r.method],rate:r.rate_minor===null?null:decimal(r.rate_minor),percent:r.basis_points===null?null:(r.basis_points/100).toFixed(2),
    prepared_by_name:name(db,r.prepared_by),decided_by_name:name(db,r.decided_by),actions};
}

// الرقم المجمّع الاختياري من الرواتب: مرجع لمن يرى الرواتب أصلًا، لا يُخزَّن في جدول المعدلات ولا يُملأ به حقل.
// يُحجب عن أي مجموعة أصغر من حد التجميع حتى لا يكون «المتوسط» راتب شخص واحد.
function payrollBenchmark(db,u,categories){
  if(!can(db,u,'hr.compensation.review'))return null;
  const date=today();
  const contracts=db.prepare("SELECT user_id,monthly_total_minor FROM employment_contracts WHERE tenant_id=? AND status='active'").all(u.tenant_id);
  if(contracts.length<MIN_GROUP)return {available:false,reason:`عدد العقود السارية أقل من ${MIN_GROUP}؛ أي متوسط هنا يكشف راتب فرد.`,groups:[]};
  const groups=[];
  for(const c of categories){
    const members=contracts.filter(x=>categoryAt(db,u.tenant_id,x.user_id,date)?.category_id===c.id);
    if(members.length<MIN_GROUP)continue;
    const total=members.reduce((n,x)=>n+x.monthly_total_minor,0);
    groups.push({category_id:c.id,category_name:c.name,people:members.length,average_monthly_minor:Math.round(total/members.length)});
  }
  return {available:true,people:contracts.length,average_monthly_minor:Math.round(contracts.reduce((n,x)=>n+x.monthly_total_minor,0)/contracts.length),groups,
    note:`مرجع مجمّع من العقود السارية لمن يرى الرواتب أصلًا. لا يتحول إلى معدل تلقائيًا ولا يُخزَّن: المعدل يدخله صاحب الإجراء بمصدره. الفئات التي يقل أفرادها عن ${MIN_GROUP} محجوبة.`};
}

export function costRatesBoard(db,supplied){
  const u=actor(db,supplied);costing(db,u);
  const categories=db.prepare('SELECT * FROM job_categories WHERE tenant_id=? ORDER BY active DESC,code').all(u.tenant_id);
  const rates=db.prepare('SELECT * FROM category_cost_rates WHERE tenant_id=? ORDER BY effective_from DESC,created_at DESC').all(u.tenant_id).map(r=>rateView(db,u,r));
  const overhead=db.prepare('SELECT * FROM overhead_rates WHERE tenant_id=? ORDER BY effective_from DESC,created_at DESC').all(u.tenant_id).map(r=>overheadView(db,u,r));
  const date=today();
  const people=db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id);
  const assignments=db.prepare('SELECT a.*,x.name AS user_name,c.name AS category_name FROM employee_job_categories a JOIN users x ON x.id=a.user_id JOIN job_categories c ON c.id=a.category_id WHERE a.tenant_id=? ORDER BY x.name,a.effective_from DESC').all(u.tenant_id);
  const uncategorised=people.filter(p=>!categoryAt(db,u.tenant_id,p.id,date));
  const view=categories.map(c=>{const live=rateAt(db,u.tenant_id,c.id,date);
    return {...c,active:!!c.active,live_rate:live?{rate_minor:live.rate_minor,rate:decimal(live.rate_minor),effective_from:live.effective_from,source:live.source}:null,
      people:assignments.filter(a=>a.category_id===c.id&&categoryAt(db,u.tenant_id,a.user_id,date)?.id===a.id).length,
      actions:[c.active?'deactivate_category':'activate_category']};});
  const liveOverhead=overheadAt(db,u.tenant_id,date);
  return {today:date,user_id:u.id,methods:METHODS,status_names:RATE_STATUS,
    categories:view,rates,overhead,assignments,people,uncategorised,
    live_overhead:liveOverhead?overheadView(db,u,liveOverhead):null,
    benchmark:payrollBenchmark(db,u,categories),
    awaiting_me:[...rates.filter(r=>r.actions.includes('approve_rate')).map(r=>({id:r.id,title:`معدل ساعة — ${categories.find(c=>c.id===r.category_id)?.name??''} · ${r.rate} ريال من ${r.effective_from}`,created_at:r.created_at,actions:['approve_rate']})),
      ...overhead.filter(r=>r.actions.includes('approve_overhead')).map(r=>({id:r.id,title:`معدل تحميل عام — سريان ${r.effective_from}`,created_at:r.created_at,actions:['approve_overhead']}))],
    note:'معدل التكلفة بالفئة الوظيفية لا بالشخص: قرار مقصود يحمي راتب الموظف من الانكشاف في كل تقرير ربحية. '
      +'المعدل يدخله صاحب الإجراء بمصدره ويعتمده شخص آخر، والنسخة المعتمدة لا تُعدَّل بأثر رجعي؛ التغيير نسخة جديدة بتاريخ سريان جديد. '
      +'لا معدل افتراضي: بلا نسخة معتمدة تبقى الساعة غير مُكلَّفة ويظهر ذلك في تقرير الربحية بدل أن يُحسب صفرًا.'};
}

export function createCategory(db,supplied,input){
  writing(db);const u=actor(db,supplied);costing(db,u);
  v.object(input,['code','name','description']);
  const code=v.text(input.code,'رمز الفئة',40,2).normalize('NFKC').replace(/\s+/gu,'-').toUpperCase();
  if(db.prepare('SELECT 1 FROM job_categories WHERE tenant_id=? AND code=?').get(u.tenant_id,code))fail(409,'duplicate_category','يوجد فئة بهذا الرمز');
  const categoryId=id(),time=now();
  db.prepare('INSERT INTO job_categories(id,tenant_id,code,name,description,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(categoryId,u.tenant_id,code,v.text(input.name,'اسم الفئة',180,2),input.description?v.text(input.description,'وصف الفئة',1000):'',u.id,time,time);
  audit(db,u,'job_category',categoryId,'category.created',{}, {code});
  return {id:categoryId};
}
export function categoryAction(db,supplied,categoryId,action,input){
  writing(db);const u=actor(db,supplied);costing(db,u);
  if(!['activate_category','deactivate_category'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','reason']);
  const c=categoryRow(db,u,categoryId);v.version(input.version,c.version);
  const active=action==='activate_category'?1:0;
  if(c.active===active)fail(409,'already_in_state','الفئة في هذه الحالة أصلًا');
  const reason=v.text(input.reason,'سبب التغيير',1000,5);
  db.prepare('UPDATE job_categories SET active=?,version=version+1,updated_at=? WHERE id=?').run(active,now(),c.id);
  audit(db,u,'job_category',c.id,'category.'+action,{active:!!c.active},{active:!!active},reason);
  return {id:c.id,active:!!active};
}

export function prepareCostRate(db,supplied,input){
  writing(db);const u=actor(db,supplied);costing(db,u);
  v.object(input,['category_id','effective_from','rate_amount','source']);
  const c=categoryRow(db,u,input.category_id);
  if(!c.active)fail(409,'inactive_category','الفئة موقوفة؛ فعّلها قبل تسعير ساعتها');
  const from=v.date(input.effective_from),rate=money(input.rate_amount,'تكلفة الساعة');
  if(db.prepare("SELECT 1 FROM category_cost_rates WHERE tenant_id=? AND category_id=? AND effective_from=? AND status<>'rejected'").get(u.tenant_id,c.id,from))fail(409,'duplicate_rate','يوجد معدل لهذه الفئة بتاريخ السريان نفسه');
  const rateId=id(),time=now();
  db.prepare("INSERT INTO category_cost_rates(id,tenant_id,category_id,effective_from,rate_minor,currency,source,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,'SAR',?,'draft',?,?,?)")
    .run(rateId,u.tenant_id,c.id,from,rate,v.text(input.source,'مصدر المعدل وكيف احتُسب',2000,10),u.id,time,time);
  audit(db,u,'cost_rate',rateId,'cost_rate.prepared',{}, {category_id:c.id,effective_from:from,rate_minor:rate});
  return {id:rateId};
}
export function costRateAction(db,supplied,rateId,action,input){
  writing(db);const u=actor(db,supplied);costing(db,u);
  if(!['approve_rate','reject_rate'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','note']);
  const r=typeof rateId==='string'&&db.prepare('SELECT * FROM category_cost_rates WHERE id=? AND tenant_id=?').get(rateId,u.tenant_id);
  if(!r)fail(404,'not_found','المعدل غير متاح');
  v.version(input.version,r.version);
  if(r.status!=='draft')fail(409,'already_decided','المعدل المعتمد لا يُعدَّل؛ اعتمد معدلًا جديدًا بتاريخ سريان جديد');
  if(r.prepared_by===u.id)fail(403,'self_approval','من أدخل المعدل لا يعتمده');
  const status=action==='approve_rate'?'approved':'rejected',time=now();
  db.prepare('UPDATE category_cost_rates SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=? AND version=?')
    .run(status,u.id,time,v.text(input.note,'أساس القرار',2000,10),time,r.id,r.version);
  audit(db,u,'cost_rate',r.id,'cost_rate.'+status,{status:r.status},{status});
  return {id:r.id,status};
}

export function assignCategory(db,supplied,input){
  writing(db);const u=actor(db,supplied);costing(db,u);
  v.object(input,['user_id','category_id','effective_from','basis']);
  const c=categoryRow(db,u,input.category_id);
  if(!c.active)fail(409,'inactive_category','الفئة موقوفة');
  const person=typeof input.user_id==='string'&&db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id);
  if(!person)fail(404,'not_found','الحساب غير متاح');
  const from=v.date(input.effective_from);
  if(db.prepare('SELECT 1 FROM employee_job_categories WHERE tenant_id=? AND user_id=? AND effective_from=?').get(u.tenant_id,person.id,from))fail(409,'duplicate_assignment','يوجد إسناد لهذا الشخص بتاريخ السريان نفسه');
  const assignmentId=id();
  db.prepare('INSERT INTO employee_job_categories(id,tenant_id,user_id,category_id,effective_from,basis,assigned_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(assignmentId,u.tenant_id,person.id,c.id,from,v.text(input.basis,'سند الإسناد',1000,5),u.id,now());
  audit(db,u,'job_category_assignment',assignmentId,'assignment.recorded',{}, {user_id:person.id,category_id:c.id,effective_from:from});
  return {id:assignmentId};
}

export function prepareOverheadRate(db,supplied,input){
  writing(db);const u=actor(db,supplied);costing(db,u);
  v.object(input,['effective_from','method','rate_amount','percent','source']);
  if(!Object.hasOwn(METHODS,input.method))fail(400,'method','اختر طريقة التحميل');
  const from=v.date(input.effective_from);
  const perHour=input.method==='per_hour';
  const rate=perHour?money(input.rate_amount,'مبلغ التحميل لكل ساعة'):null;
  const points=perHour?null:percent(input.percent,'نسبة التحميل');
  if(db.prepare("SELECT 1 FROM overhead_rates WHERE tenant_id=? AND effective_from=? AND status<>'rejected'").get(u.tenant_id,from))fail(409,'duplicate_overhead','يوجد معدل تحميل بتاريخ السريان نفسه');
  const overheadId=id(),time=now();
  db.prepare("INSERT INTO overhead_rates(id,tenant_id,effective_from,method,rate_minor,basis_points,currency,source,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'SAR',?,'draft',?,?,?)")
    .run(overheadId,u.tenant_id,from,input.method,rate,points,v.text(input.source,'مصدر معدل التحميل وكيف احتُسب',2000,10),u.id,time,time);
  audit(db,u,'overhead_rate',overheadId,'overhead_rate.prepared',{}, {effective_from:from,method:input.method});
  return {id:overheadId};
}
export function overheadRateAction(db,supplied,overheadId,action,input){
  writing(db);const u=actor(db,supplied);costing(db,u);
  if(!['approve_overhead','reject_overhead'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','note']);
  const r=typeof overheadId==='string'&&db.prepare('SELECT * FROM overhead_rates WHERE id=? AND tenant_id=?').get(overheadId,u.tenant_id);
  if(!r)fail(404,'not_found','معدل التحميل غير متاح');
  v.version(input.version,r.version);
  if(r.status!=='draft')fail(409,'already_decided','معدل التحميل المعتمد لا يُعدَّل؛ اعتمد معدلًا جديدًا بتاريخ سريان جديد');
  if(r.prepared_by===u.id)fail(403,'self_approval','من أدخل معدل التحميل لا يعتمده');
  const status=action==='approve_overhead'?'approved':'rejected',time=now();
  db.prepare('UPDATE overhead_rates SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=? AND version=?')
    .run(status,u.id,time,v.text(input.note,'أساس القرار',2000,10),time,r.id,r.version);
  audit(db,u,'overhead_rate',r.id,'overhead_rate.'+status,{status:r.status},{status});
  return {id:r.id,status};
}

export function tagProjectService(db,supplied,input){
  writing(db);const u=actor(db,supplied);viewing(db,u);
  // وسم الخدمة يغيّر تقرير الربحية لكل من يقرؤه؛ تصريح القراءة لا يكفي لكتابته.
  if(!holds(db,u,'costing.manage'))fail(403,'not_permitted','وسم خدمة المشروع لحامل تصريح إدارة التكلفة');
  v.object(input,['project_id','family','note','version']);
  if(!FAMILIES.some(f=>f.key===input.family))fail(400,'family','اختر عائلة الخدمة');
  const p=typeof input.project_id==='string'&&db.prepare('SELECT id FROM projects WHERE id=? AND tenant_id=?').get(input.project_id,u.tenant_id);
  if(!p)fail(404,'not_found','المشروع غير متاح');
  const existing=db.prepare('SELECT * FROM project_service_tags WHERE project_id=?').get(p.id),time=now(),note=input.note?v.text(input.note,'سند الوسم',1000):'';
  if(existing){v.version(input.version,existing.version);db.prepare('UPDATE project_service_tags SET family=?,note=?,tagged_by=?,version=version+1,updated_at=? WHERE project_id=?').run(input.family,note,u.id,time,p.id);}
  else db.prepare('INSERT INTO project_service_tags(project_id,tenant_id,family,note,tagged_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(p.id,u.tenant_id,input.family,note,u.id,time,time);
  audit(db,u,'project_service_tag',p.id,'service_tag.set',{family:existing?.family??null},{family:input.family});
  return {project_id:p.id,family:input.family};
}

/* ───── حساب الربحية ───── */
function period(input){
  const to=input?.to?v.date(input.to):today(),from=input?.from?v.date(input.from):FAR_PAST;
  if(to<from)fail(400,'invalid_interval','نهاية الفترة تسبق بدايتها');
  return {from,to};
}
const marks=list=>list.map(()=>'?').join(',');

// تكلفة الوقت: لكل ساعة معدل فئة صاحبها الساري في تاريخ تلك الساعة. الساعة بلا فئة أو بلا معدل معتمد
// لا تُحسب صفرًا: تُعدّ «غير مُكلَّفة» وتُعلن بسببها، لأن الصفر كذب يرفع الهامش.
function timeCost(db,tenantId,projectIds,from,to,cache){
  const rows=projectIds.length?db.prepare(`SELECT id,user_id,project_id,work_date,minutes,billable,status FROM time_entries WHERE tenant_id=? AND project_id IN (${marks(projectIds)}) AND work_date BETWEEN ? AND ? AND status<>'rejected'`).all(tenantId,...projectIds,from,to):[];
  const bucket=()=>({minutes:0,billable_minutes:0,cost_minor:0,overhead_minor:0,costed_minutes:0,uncosted_minutes:0,no_category_minutes:0,no_rate_minutes:0});
  const approved=bucket(),unapproved=bucket();
  for(const row of rows){
    const into=row.status==='approved'?approved:unapproved;
    into.minutes+=row.minutes;
    if(row.billable)into.billable_minutes+=row.minutes;
    const assignment=categoryAt(db,tenantId,row.user_id,row.work_date,cache);
    const rate=assignment?rateAt(db,tenantId,assignment.category_id,row.work_date,cache):null;
    if(!assignment){into.uncosted_minutes+=row.minutes;into.no_category_minutes+=row.minutes;continue;}
    if(!rate){into.uncosted_minutes+=row.minutes;into.no_rate_minutes+=row.minutes;continue;}
    const cost=Math.round(row.minutes*rate.rate_minor/60);
    into.costed_minutes+=row.minutes;into.cost_minor+=cost;
    const overhead=overheadAt(db,tenantId,row.work_date,cache);
    if(overhead?.method==='per_hour')into.overhead_minor+=Math.round(row.minutes*overhead.rate_minor/60);
    else if(overhead?.method==='percent_of_direct_cost')into.overhead_minor+=Math.round(cost*overhead.basis_points/10000);
  }
  return {approved,unapproved,entries:rows.length};
}
// التحميل بالنسبة يسري على المشتريات والمصروفات أيضًا؛ التحميل بالساعة لا يسري عليها لأنه مربوط بالساعة.
function overheadOnAmount(db,tenantId,date,amountMinor,cache){
  const o=overheadAt(db,tenantId,date,cache);
  return o?.method==='percent_of_direct_cost'?Math.round(amountMinor*o.basis_points/10000):0;
}
// تكلفة المشتريات صافيةً من ضريبة المدخلات المتحقَّق منها، مقابل إيراد صافٍ من ضريبة المخرجات (revenue أدناه): الضريبة أمانة
// تُسترد لا تكلفة. كان المستحق يدخل بإجماليه مع الضريبة فيقارَن إجمالٌ بصافٍ وينخفض الهامش بقدر ضريبة المدخلات. والصافي هو نفسه
// ما يقيّده الدفتر على «تكلفة فواتير الموردين» (app/ledger.mjs supplierInvoiceBuild). فاتورةٌ ضريبتها ما تحقق منها أحد (أو مورد غير
// مسجّل ضريبيًا) تدخل بإجماليها وتُعدّ في تحفّظ مكتوب. وتسويات المورد المعتمدة (إشعار دائن ينقص، ومدين يزيد) تدخل بصافيها بتاريخ قرارها.
function purchaseCost(db,tenantId,projectIds,from,to,cache){
  const rows=projectIds.length?db.prepare(`SELECT p.project_id,y.amount_minor,date(y.created_at,'+3 hours') AS matched_on,
      (SELECT t.vat_minor FROM procurement_invoice_tax t WHERE t.invoice_id=y.invoice_id AND t.status='verified') AS verified_vat
    FROM procurement_payables y JOIN procurement_purchases p ON p.id=y.purchase_id WHERE p.tenant_id=? AND p.project_id IN (${marks(projectIds)}) AND date(y.created_at,'+3 hours') BETWEEN ? AND ?`).all(tenantId,...projectIds,from,to):[];
  const adjustments=projectIds.length?db.prepare(`SELECT a.kind,a.amount_minor,a.vat_minor,date(a.decided_at,'+3 hours') AS decided_on FROM payable_adjustments a JOIN procurement_payables y ON y.id=a.payable_id
      JOIN procurement_purchases p ON p.id=y.purchase_id WHERE a.tenant_id=? AND a.status='approved' AND p.project_id IN (${marks(projectIds)}) AND date(a.decided_at,'+3 hours') BETWEEN ? AND ?`).all(tenantId,...projectIds,from,to):[];
  const acc={amount_minor:0,overhead_minor:0,count:0,gross_minor:0,vat_excluded_minor:0,vat_unverified:0,adjustments_minor:0};
  for(const r of rows){
    const net=r.amount_minor-(r.verified_vat??0);
    acc.amount_minor+=net;acc.gross_minor+=r.amount_minor;acc.vat_excluded_minor+=r.verified_vat??0;acc.count++;
    if(r.verified_vat===null)acc.vat_unverified++;
    acc.overhead_minor+=overheadOnAmount(db,tenantId,r.matched_on,net,cache);
  }
  for(const a of adjustments){
    const net=(a.kind==='debit'?1:-1)*(a.amount_minor-a.vat_minor);
    acc.amount_minor+=net;acc.adjustments_minor+=net;
    acc.overhead_minor+=overheadOnAmount(db,tenantId,a.decided_on,net,cache);
  }
  return acc;
}
function expenseCost(db,tenantId,projectIds,from,to,cache){
  const rows=projectIds.length?db.prepare(`SELECT amount_minor,expense_date FROM expense_claims WHERE tenant_id=? AND project_id IN (${marks(projectIds)}) AND status IN ('finance_approved','reimbursed') AND expense_date BETWEEN ? AND ?`).all(tenantId,...projectIds,from,to):[];
  return rows.reduce((acc,r)=>({amount_minor:acc.amount_minor+r.amount_minor,overhead_minor:acc.overhead_minor+overheadOnAmount(db,tenantId,r.expense_date,r.amount_minor,cache),count:acc.count+1}),{amount_minor:0,overhead_minor:0,count:0});
}
// الإيراد بالصافي دون ضريبة القيمة المضافة: الضريبة أمانة للدولة لا إيراد للوكالة. الإشعار الدائن يخصم.
function revenue(db,tenantId,projectIds,from,to){
  const rows=projectIds.length?db.prepare(`SELECT kind,net_minor FROM tax_invoices WHERE tenant_id=? AND project_id IN (${marks(projectIds)}) AND status='issued' AND supply_date BETWEEN ? AND ?`).all(tenantId,...projectIds,from,to):[];
  return {net_minor:rows.reduce((n,r)=>n+(r.kind==='invoice'?r.net_minor:-r.net_minor),0),
    invoices:rows.filter(r=>r.kind==='invoice').length,credit_notes:rows.filter(r=>r.kind==='credit_note').length};
}
// قيمة العقد المعتمدة كما اعتُمدت في خط الأساس، لا تقدير.
function contractValue(db,projectIds){
  let net=0,found=0,skipped=0;
  for(const pid of projectIds){
    const row=db.prepare('SELECT snapshot FROM commercial_project_baselines WHERE project_id=?').get(pid);
    if(!row){skipped++;continue;}
    const snapshot=JSON.parse(row.snapshot);
    if(snapshot.currency!=='SAR'){skipped++;continue;}
    net+=Number(snapshot.net_minor);found++;
  }
  return {net_minor:net,projects_with_baseline:found,projects_without_baseline:skipped};
}
function activeBudget(db,tenantId,projectIds){
  if(!projectIds.length)return {cap_minor:0,budgets:0};
  const row=db.prepare(`SELECT COALESCE(SUM(cap_minor),0) AS cap,COUNT(*) AS n FROM project_budgets WHERE tenant_id=? AND project_id IN (${marks(projectIds)}) AND status='active'`).get(tenantId,...projectIds);
  return {cap_minor:row.cap,budgets:row.n};
}
const bp=(part,whole)=>whole?Math.round(part*10000/whole):null;
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

// نواة الحساب لأي مجموعة مشاريع. forecast كله اختياري ويأتي من خارج الدالة:
// «المحجوز مستقبلًا» و«المتبقي المجدول» تملكهما وحدة تخطيط الموارد، ولا تستوردها هذه الوحدة ولا تعتمد عليها.
function compute(db,tenantId,projectIds,range,forecast={}){
  const cache=new Map();
  const time=timeCost(db,tenantId,projectIds,range.from,range.to,cache);
  const purchases=purchaseCost(db,tenantId,projectIds,range.from,range.to,cache);
  const expenses=expenseCost(db,tenantId,projectIds,range.from,range.to,cache);
  const income=revenue(db,tenantId,projectIds,range.from,range.to);
  const overheadMinor=time.approved.overhead_minor+purchases.overhead_minor+expenses.overhead_minor;
  const costMinor=time.approved.cost_minor+purchases.amount_minor+expenses.amount_minor+overheadMinor;
  const marginMinor=income.net_minor-costMinor;
  const logged=time.approved.minutes+time.unapproved.minutes;

  const date=today();
  const budgetMinor=Number.isInteger(forecast.budget_minor)?forecast.budget_minor:activeBudget(db,tenantId,projectIds).cap_minor||null;
  const committed=Number.isInteger(forecast.committed_future_minor)?forecast.committed_future_minor:null;
  // معدل الحرق من بداية الإنفاق الفعلي لا من بداية الفترة النظرية، حتى لا تُخفّض أيامٌ بلا عمل المعدلَ.
  const firstDay=projectIds.length?db.prepare(`SELECT MIN(work_date) AS d FROM time_entries WHERE tenant_id=? AND project_id IN (${marks(projectIds)}) AND status='approved'`).get(tenantId,...projectIds).d:null;
  const elapsed=firstDay?Math.max(1,Math.round((Date.parse(date)-Date.parse(firstDay))/86400000)+1):null;
  const dailyBurn=elapsed?Math.round(costMinor/elapsed):null;
  const remainingBudget=budgetMinor===null?null:budgetMinor-costMinor-(committed??0);
  const exhaustsIn=remainingBudget!==null&&dailyBurn?Math.floor(remainingBudget/dailyBurn):null;

  // الهامش عند الاكتمال: التكلفة الفعلية + المتبقي المجدول + المحجوز مستقبلًا، مقابل قيمة العقد المعتمدة.
  const blendedHourMinor=time.approved.costed_minutes?Math.round(time.approved.cost_minor*60/time.approved.costed_minutes):null;
  let remainingCost=null,remainingBasis='none';
  if(Number.isInteger(forecast.remaining_cost_minor)){remainingCost=forecast.remaining_cost_minor;remainingBasis='supplied_cost';}
  else if(Number.isInteger(forecast.remaining_minutes)&&blendedHourMinor!==null){remainingCost=Math.round(forecast.remaining_minutes*blendedHourMinor/60);remainingBasis='blended_actual_rate';}
  const contract=contractValue(db,projectIds);
  const expectedRevenue=Number.isInteger(forecast.expected_revenue_minor)?forecast.expected_revenue_minor:(contract.projects_with_baseline?contract.net_minor:null);
  const expectedSource=Number.isInteger(forecast.expected_revenue_minor)?'supplied':contract.projects_with_baseline?'contract_baseline':'none';
  const costAtCompletion=costMinor+(remainingCost??0)+(committed??0);
  const marginAtCompletion=expectedRevenue===null?null:expectedRevenue-costAtCompletion;

  return {
    period:range,
    revenue:{...income,basis:'الفواتير الصادرة بالصافي دون ضريبة القيمة المضافة، ناقص الإشعارات الدائنة الصادرة، منسوبة بتاريخ التوريد.'},
    cost:{time_minor:time.approved.cost_minor,purchases_minor:purchases.amount_minor,expenses_minor:expenses.amount_minor,overhead_minor:overheadMinor,total_minor:costMinor,
      purchase_count:purchases.count,expense_count:expenses.count},
    // أساس تكلفة المشتريات معروضًا بجانبها: الإجمالي، وما استُبعد من ضريبة متحقَّق منها، والتسويات، وعدد ما دخل بإجماليه.
    purchases_basis:{basis:'net_of_verified_input_vat',gross_minor:purchases.gross_minor,vat_excluded_minor:purchases.vat_excluded_minor,adjustments_minor:purchases.adjustments_minor,
      counted_gross:purchases.vat_unverified},
    margin:{amount_minor:marginMinor,bp:bp(marginMinor,income.net_minor)},
    hours:{approved_minutes:time.approved.minutes,unapproved_minutes:time.unapproved.minutes,logged_minutes:logged,
      billable_minutes:time.approved.billable_minutes,billable_bp:bp(time.approved.billable_minutes,time.approved.minutes),
      approval_coverage_bp:bp(time.approved.minutes,logged),entries:time.entries},
    coverage:{costed_minutes:time.approved.costed_minutes,uncosted_minutes:time.approved.uncosted_minutes,
      no_category_minutes:time.approved.no_category_minutes,no_rate_minutes:time.approved.no_rate_minutes,
      costed_bp:bp(time.approved.costed_minutes,time.approved.minutes),
      overhead_applied:!!overheadMinor,blended_hour_minor:blendedHourMinor},
    // ما لم يدخل في الأرقام أعلاه، معروضًا صراحة بدل أن يُدسّ فيها.
    excluded:{unapproved_hours_cost_minor:time.unapproved.cost_minor,unapproved_hours_overhead_minor:time.unapproved.overhead_minor},
    forecast:{budget_minor:budgetMinor,budget_source:Number.isInteger(forecast.budget_minor)?'supplied':budgetMinor===null?'none':'project_budgets',
      spent_minor:costMinor,committed_future_minor:committed,committed_future_supplied:committed!==null,
      first_cost_day:firstDay,elapsed_days:elapsed,daily_burn_minor:dailyBurn,remaining_budget_minor:remainingBudget,
      days_to_exhaustion:exhaustsIn,exhausts_on:exhaustsIn===null?null:addDays(date,Math.max(0,exhaustsIn)),
      remaining_cost_minor:remainingCost,remaining_basis:remainingBasis,
      expected_revenue_minor:expectedRevenue,expected_revenue_source:expectedSource,
      cost_at_completion_minor:costAtCompletion,margin_at_completion_minor:marginAtCompletion,
      margin_at_completion_bp:marginAtCompletion===null?null:bp(marginAtCompletion,expectedRevenue)}
  };
}

// الصدق: قائمة تحفظات تُعرض كما هي فوق كل رقم. الرقم بلا تحفظه ليس أصدق، هو أخطر.
function caveats(result){
  const out=[];
  const h=result.hours,c=result.coverage,f=result.forecast;
  if(!h.logged_minutes)out.push('لا ساعات مسجلة على هذا النطاق في الفترة: التكلفة أدناه لا تشمل وقت الفريق إطلاقًا.');
  else if(!h.approved_minutes)out.push('لا ساعة واحدة معتمدة في هذه الفترة. الأرقام مبنية على ساعات غير معتمدة لم يقرّها مدير، فلا تُقرأ كحقيقة.');
  else if(h.approval_coverage_bp<10000)out.push(`المعتمد ${(h.approval_coverage_bp/100).toFixed(1)}% من الساعات المسجلة فقط؛ الباقي غير معتمد ولم يدخل في التكلفة.`);
  if(c.uncosted_minutes)out.push(`${(c.uncosted_minutes/60).toFixed(1)} ساعة معتمدة بلا تكلفة: ${(c.no_category_minutes/60).toFixed(1)} بلا فئة وظيفية و${(c.no_rate_minutes/60).toFixed(1)} بلا معدل معتمد في تاريخها. التكلفة أقل من الحقيقة بهذا المقدار.`);
  if(!c.overhead_applied)out.push('لا معدل تحميل عام معتمد ساري: الهامش أدناه قبل المصاريف العمومية.');
  if(result.purchases_basis?.counted_gross)out.push(`${result.purchases_basis.counted_gross} فاتورة مورد داخلة بإجماليها: ضريبة مدخلاتها ما تحقق منها أحد للحين (أو المورد غير مسجّل ضريبيًا)، فالتكلفة أعلى من صافيها بقدر ضريبتها.`);
  if(!result.revenue.invoices)out.push('لا فاتورة صادرة منسوبة لهذا النطاق في الفترة: الهامش محسوب على إيراد صفر.');
  if(f.budget_source==='none')out.push('لا ميزانية معتمدة لهذا النطاق، فلا حرق ميزانية يُحسب.');
  else if(f.budget_source==='project_budgets')out.push('«الميزانية» هنا مجموع مخصصات المشتريات المعتمدة للمشروع، وليست ميزانية تكلفة كاملة اعتمدها المالك.');
  if(!f.committed_future_supplied)out.push('«المحجوز مستقبلًا» لم يُمرَّر من وحدة تخطيط الموارد: حرق الميزانية يحسب الفعلي حتى اليوم فقط.');
  if(f.remaining_basis==='none')out.push('«المتبقي المجدول» لم يُمرَّر: الهامش عند الاكتمال يفترض ألّا عمل متبقيًا، وهو افتراض متفائل.');
  else if(f.remaining_basis==='blended_actual_rate')out.push('كلفة المتبقي قُدّرت بمتوسط تكلفة ساعة هذا النطاق فعلًا، لا بفئات من سيعملون؛ تقدير لا رقم.');
  if(f.expected_revenue_source==='none')out.push('لا قيمة عقد معتمدة في خط الأساس، فلا هامش عند الاكتمال.');
  return out;
}

// نتيجة الهامش كما تُقبل عند الإقفال المالي (ترحيل 163): الحساب نفسه الذي تعرضه شاشة الربحية، على عمر
// المشروع كله حتى اليوم، لا حسبة ثانية تفترق عنه. تُعاد الأرقام الثابتة وحدها وبصمتها: الإقفال المالي يعيد
// الحساب ويقارن البصمة، فقبولٌ على رقم تغيّر بعده (فاتورة أو ساعة أو مشتريات جديدة) لا يُحتسب.
// التنبؤ (الحرق اليومي وأيام النفاد) خارج البصمة عمدًا: يتغير بمرور الأيام وحدها ولا يغيّر نتيجة المشروع.
// لا فحص تصريح هنا: من يقرأ الرقم يُفحص في موضع القراءة (ربحية المشاريع والعملاء)، والدالة لا تُعرض مباشرة.
export function projectMarginFigures(db,tenantId,projectId){
  const r=compute(db,tenantId,[projectId],{from:FAR_PAST,to:today()},{});
  const row=db.prepare('SELECT snapshot FROM commercial_project_baselines WHERE project_id=?').get(projectId);
  const planned=row?JSON.parse(row.snapshot):null;
  const figures={currency:'SAR',revenue_net_minor:r.revenue.net_minor,invoices:r.revenue.invoices,credit_notes:r.revenue.credit_notes,
    cost:{time_minor:r.cost.time_minor,purchases_minor:r.cost.purchases_minor,expenses_minor:r.cost.expenses_minor,overhead_minor:r.cost.overhead_minor,
      total_minor:r.cost.total_minor,purchase_count:r.cost.purchase_count,expense_count:r.cost.expense_count},
    margin_minor:r.margin.amount_minor,margin_bp:r.margin.bp,
    hours:{approved_minutes:r.hours.approved_minutes,unapproved_minutes:r.hours.unapproved_minutes,uncosted_minutes:r.coverage.uncosted_minutes},
    planned:planned?{net_minor:Number(planned.net_minor),cost_minor:Number(planned.cost_minor),margin_minor:Number(planned.margin_minor),currency:planned.currency}:null};
  return {figures,digest:hash(JSON.stringify(figures)),caveats:caveats(r)};
}
function projectScope(db,u,projectId){
  const p=typeof projectId==='string'&&db.prepare('SELECT id,name FROM projects WHERE id=? AND tenant_id=?').get(projectId,u.tenant_id);
  if(!p)fail(404,'not_found','المشروع غير متاح');
  return p;
}
export function projectProfitability(db,supplied,input){
  const u=actor(db,supplied);viewing(db,u);
  v.object(input??{},['project_id','from','to','forecast']);
  const p=projectScope(db,u,input?.project_id),range=period(input);
  const result=compute(db,u.tenant_id,[p.id],range,input?.forecast??{});
  return {scope:'project',project:{id:p.id,name:p.name},...result,caveats:caveats(result)};
}
// نطاق العميل: مشاريع سجلاته التجارية المربوطة بملفه. الإيراد والتكلفة يقرآن النطاق نفسه فلا يُقارن مقامان مختلفان.
export function clientProjects(db,tenantId,clientId){
  return db.prepare('SELECT k.project_id AS id FROM client_links l JOIN commercial_cases k ON k.id=l.case_id WHERE l.client_id=? AND k.tenant_id=? AND k.project_id IS NOT NULL').all(clientId,tenantId).map(r=>r.id);
}
export function clientProfitability(db,supplied,input){
  const u=actor(db,supplied);viewing(db,u);
  v.object(input??{},['client_id','from','to','forecast']);
  const c=typeof input?.client_id==='string'&&db.prepare('SELECT id,code,legal_name FROM clients WHERE id=? AND tenant_id=?').get(input.client_id,u.tenant_id);
  if(!c)fail(404,'not_found','ملف العميل غير متاح');
  const projectIds=clientProjects(db,u.tenant_id,c.id),range=period(input);
  const result=compute(db,u.tenant_id,projectIds,range,input?.forecast??{});
  const extra=projectIds.length?[]:['لا مشروع مربوطًا بملف هذا العميل عبر سجل تجاري: لا إيراد ولا تكلفة تُنسب إليه.'];
  return {scope:'client',client:{id:c.id,code:c.code,legal_name:c.legal_name},projects:projectIds.length,...result,caveats:[...extra,...caveats(result)]};
}
export function serviceProfitability(db,supplied,input){
  const u=actor(db,supplied);viewing(db,u);
  v.object(input??{},['from','to']);
  const range=period(input);
  const tags=db.prepare('SELECT project_id,family FROM project_service_tags WHERE tenant_id=?').all(u.tenant_id);
  const tagged=new Set(tags.map(t=>t.project_id));
  const all=db.prepare('SELECT id,name FROM projects WHERE tenant_id=?').all(u.tenant_id);
  const families=FAMILIES.map(f=>{
    const ids=tags.filter(t=>t.family===f.key).map(t=>t.project_id);
    return {family:f.key,family_name:f.name,projects:ids.length,...(ids.length?compute(db,u.tenant_id,ids,range,{}):null)};
  }).filter(f=>f.projects);
  const untagged=all.filter(p=>!tagged.has(p.id));
  return {scope:'service',period:range,families,
    untagged:{projects:untagged.length,names:untagged.slice(0,20).map(p=>p.name)},
    caveats:[untagged.length?`${untagged.length} مشروعًا بلا وسم عائلة خدمة: لا يدخل في أي عائلة ولا يُوزَّع بالتخمين. وسمه ليُحتسب.`:'كل المشاريع موسومة بعائلة خدمة.',
      'الوسم يدخله صاحب الإجراء يدويًا؛ المنصة لا تستنتج نوع الخدمة من المشروع.']};
}

/* ───── لوحة الشاشة ───── */
export function profitabilityBoard(db,supplied,query){
  const u=actor(db,supplied);viewing(db,u);
  v.object(query??{},['project_id','client_id','from','to']);
  const range=period(query);
  const projects=db.prepare('SELECT id,name FROM projects WHERE tenant_id=? ORDER BY name').all(u.tenant_id);
  const clients=db.prepare('SELECT id,code,legal_name FROM clients WHERE tenant_id=? ORDER BY legal_name').all(u.tenant_id);
  const tags=Object.fromEntries(db.prepare('SELECT project_id,family,version FROM project_service_tags WHERE tenant_id=?').all(u.tenant_id).map(t=>[t.project_id,t]));
  const selected=query?.project_id?projectProfitability(db,u,{project_id:query.project_id,from:range.from,to:range.to}):null;
  const selectedClient=query?.client_id?clientProfitability(db,u,{client_id:query.client_id,from:range.from,to:range.to}):null;
  const rows=projects.map(p=>{const r=compute(db,u.tenant_id,[p.id],range,{});
    return {id:p.id,name:p.name,family:tags[p.id]?.family??null,tag_version:tags[p.id]?.version??null,
      revenue_minor:r.revenue.net_minor,cost_minor:r.cost.total_minor,margin_minor:r.margin.amount_minor,margin_bp:r.margin.bp,
      approved_minutes:r.hours.approved_minutes,approval_coverage_bp:r.hours.approval_coverage_bp,billable_bp:r.hours.billable_bp,
      costed_bp:r.coverage.costed_bp,caveats:caveats(r).length};});
  return {today:today(),user_id:u.id,period:range,families:FAMILIES,
    projects,clients,rows,selected,selected_client:selectedClient,services:serviceProfitability(db,u,{from:range.from,to:range.to}),
    can_tag:true,
    note:'الربحية هنا محسوبة من المسجل داخل المنصة لا من نظام محاسبي: الإيراد من الفواتير الصادرة بالصافي، والتكلفة من الساعات المعتمدة بمعدل فئة صاحبها الساري في تاريخ الساعة، زائد المشتريات المطابقة والمصروفات المعتمدة والتحميل العام المعتمد. '
      +'معدل التكلفة بالفئة الوظيفية لا بالشخص حمايةً لرواتب الموظفين، فالرقم تقريب مقصود لا تكلفة فرد. '
      +'كل نقص في التغطية معلن أعلى كل بطاقة؛ اقرأ التحفظات قبل الرقم.'};
}
