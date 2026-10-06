import { randomUUID } from 'node:crypto';
import { audit, hash, transaction } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';

// طابور المهام الخلفية. القواعد:
// 1) الطابور ينفّذ ما قرره إنسان ولا يقرر: كل مهمة تحمل من طلبها والفعل المعتمد الذي نشأت عنه (source)،
//    ولا مسار HTTP لإنشاء مهمة؛ تُنشئها وحدة أخرى داخل معاملة فعلها المعتمد نفسه.
// 2) المعالج الحساس (يكتب في سجل مالي أو موارد بشرية) لا يُسجَّل دون دالة authorise تتحقق عند التنفيذ أن الفعل ما زال معتمدًا.
// 3) المعالج متزامن ويكتب في القاعدة فقط: أثره وعلامة «done» في معاملة واحدة، فإما الاثنان وإما لا شيء.
//    لا معالج متزامن يرسل شيئًا خارج المنصة؛ أثر خارجي لا تحميه معاملة.
// 4) المعالج الخارجي (registerExternalHandler، أول مستعمل له البريد) ثلاث مراحل: prepare متزامن داخل معاملة يقرر ما يُرسل،
//    ثم perform غير متزامن خارج أي معاملة يكلم المزود، ثم settle متزامن داخل معاملة يسجل النتيجة. لا يُحجز له في runDue؛
//    يشغله runDueExternal وحده. التكرار محمي بحالة السجل الذي يرسله (settle يسجلها ولو فُقد القفل) وبمفتاح تكرار عند المزود.
const handlers=new Map();
const KEY=/^[A-Za-z0-9_.:-]{8,200}$/,TYPE=/^[a-z][a-z0-9_.-]{2,79}$/;
const STATUS_NAMES={queued:'في الانتظار',running:'قيد التنفيذ',done:'نُفذت',dead:'ميتة — تحتاج مسؤول المنصة',cancelled:'ملغاة'};
const DEFAULTS={limit:20,lockMs:5*60000,baseDelayMs:30000,maxDelayMs:3600000};

export function registerHandler(type,fn,options={}){
  if(typeof type!=='string'||!TYPE.test(type))throw new Error('Job type must look like "module.action".');
  if(typeof fn!=='function')throw new Error('Job handler must be a function.');
  if(options.sensitive&&typeof options.authorise!=='function')throw new Error(`Sensitive job "${type}" needs an authorise(db,job) check of the approved act behind it.`);
  if(handlers.has(type))throw new Error(`Job handler already registered: ${type}`);
  handlers.set(type,{fn,sensitive:!!options.sensitive,authorise:options.authorise??null});
}
export function registerExternalHandler(type,{prepare,perform,settle}){
  if(typeof type!=='string'||!TYPE.test(type))throw new Error('Job type must look like "module.action".');
  if([prepare,perform,settle].some(f=>typeof f!=='function'))throw new Error('External job handler needs prepare, perform and settle functions.');
  if(handlers.has(type))throw new Error(`Job handler already registered: ${type}`);
  handlers.set(type,{external:true,prepare,perform,settle,sensitive:false,authorise:null});
}
export const hasHandler=type=>handlers.has(type);
const externalTypes=()=>JSON.stringify([...handlers].filter(([,h])=>h.external).map(([type])=>type));
// للاختبارات فقط: سجل المعالجات حالة على مستوى العملية.
export function clearHandlers(){handlers.clear();}
export const backoffMs=(attempt,base=DEFAULTS.baseDelayMs,max=DEFAULTS.maxDelayMs)=>Math.min(max,base*2**Math.max(0,attempt-1));

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const iso=time=>new Date(time).toISOString();

// تُستدعى من وحدة أخرى داخل معاملة فعلها المعتمد. المفتاح نفسه بالحمولة نفسها يعيد المهمة القائمة؛ بحمولة مختلفة تعارض.
// options.audit=false لمهام آلية كثيرة العدد (بريد إشعار لكل صف): سجلها هو صف المهمة وصف الصادر، لا سطر تدقيق لكل منها.
export function enqueue(db,supplied,input,options={}){
  writing(db);const u=actor(db,supplied);
  v.object(input,['type','payload','idempotency_key','source','due_at','max_attempts']);
  if(typeof input.type!=='string'||!TYPE.test(input.type))fail(400,'job_type','نوع المهمة غير صالح');
  if(!handlers.has(input.type))fail(400,'job_type','لا معالج مسجلًا لهذا النوع');
  if(typeof input.idempotency_key!=='string'||!KEY.test(input.idempotency_key))fail(400,'idempotency_required','يلزم مفتاح ثابت للمهمة');
  v.object(input.source,['entity','id']);
  const entity=v.text(input.source.entity,'الفعل المعتمد الذي نشأت عنه المهمة',80),sourceId=v.text(input.source.id,'معرّف الفعل المعتمد',120);
  const payload=input.payload??{};
  if(typeof payload!=='object'||Array.isArray(payload))fail(400,'payload','حمولة المهمة كائن');
  const body=JSON.stringify(canonical(payload));if(body.length>20000)fail(400,'payload','حمولة المهمة أكبر من المسموح');
  const dueAt=input.due_at===undefined?iso(Date.now()):input.due_at;
  if(typeof dueAt!=='string'||!Number.isFinite(Date.parse(dueAt)))fail(400,'due_at','وقت الاستحقاق غير صالح');
  const max=input.max_attempts??5;if(!Number.isInteger(max)||max<1||max>20)fail(400,'max_attempts','المحاولات من 1 إلى 20');
  const digest=hash(`${input.type}\n${body}`),existing=db.prepare('SELECT id,payload_digest,status FROM jobs WHERE tenant_id=? AND idempotency_key=?').get(u.tenant_id,input.idempotency_key);
  if(existing){if(existing.payload_digest!==digest)fail(409,'idempotency_conflict','استُخدم المفتاح نفسه لمهمة مختلفة');return {id:existing.id,status:existing.status,duplicate:true};}
  const jobId=randomUUID(),time=iso(Date.now());
  db.prepare('INSERT INTO jobs(id,tenant_id,type,payload,payload_digest,idempotency_key,requested_by,source_entity,source_id,due_at,max_attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(jobId,u.tenant_id,input.type,body,digest,input.idempotency_key,u.id,entity,sourceId,iso(Date.parse(dueAt)),max,time,time);
  if(options.audit!==false)audit(db,u,'job',jobId,'job.enqueued',{}, {type:input.type,source:`${entity}:${sourceId}`,due_at:iso(Date.parse(dueAt))});
  return {id:jobId,status:'queued',duplicate:false};
}

// حجز ذرّي: جملة UPDATE واحدة تختار وتحجز، فلا تلتقط نسختان المهمة نفسها. مهمة «running» انتهى قفلها تُعاد للحجز (نسخة ماتت أثناء التنفيذ).
// الحجز المتزامن يستثني الأنواع الخارجية؛ الحجز الخارجي (only) يقتصر على الأنواع المطلوبة.
function claim(db,tenantId,worker,at,lockMs,only=null){
  return db.prepare(`UPDATE jobs SET status='running',attempts=attempts+1,locked_by=?,locked_until=?,version=version+1,updated_at=?
    WHERE id=(SELECT id FROM jobs WHERE tenant_id=? AND attempts<max_attempts AND ((status='queued' AND due_at<=?) OR (status='running' AND locked_until<?))
      AND type ${only?'IN':'NOT IN'} (SELECT value FROM json_each(?)) ORDER BY due_at,created_at LIMIT 1) RETURNING *`)
    .get(worker,iso(at+lockMs),iso(at),tenantId,iso(at),iso(at),only?JSON.stringify(only):externalTypes())??null;
}
// الحجز وحده، لإثبات أن نسختين لا تلتقطان المهمة نفسها. runDue يستعمل claim نفسها.
export function claimNext(db,tenantId,{worker,now:at=Date.now(),lockMs=DEFAULTS.lockMs}={}){
  if(typeof worker!=='string'||!worker)throw new Error('worker id required');
  return transaction(db,()=>claim(db,tenantId,worker,at,lockMs));
}
const requester=(db,job)=>db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(job.requested_by,job.tenant_id);
function execute(db,job,worker,at,options){
  const handler=handlers.get(job.type),user=requester(db,job);
  try{
    return transaction(db,()=>{
      if(!handler)throw Object.assign(new Error('لا معالج مسجلًا لهذا النوع في هذه النسخة'),{status:500});
      if(!user?.active)throw Object.assign(new Error('حساب من طلب المهمة غير نشط'),{permanent:true});
      if(handler.authorise&&handler.authorise(db,job)!==true)throw Object.assign(new Error('الفعل المعتمد الذي نشأت عنه المهمة لم يعد ساريًا'),{permanent:true});
      const result=handler.fn(db,{id:job.id,tenant_id:job.tenant_id,type:job.type,payload:JSON.parse(job.payload),attempt:job.attempts,requested_by:job.requested_by,source:{entity:job.source_entity,id:job.source_id}},{user,now:at});
      if(result&&typeof result.then==='function')throw Object.assign(new Error('المعالج غير متزامن: أثره لا تحميه المعاملة'),{permanent:true});
      // الشرط على القفل: لو انتهى قفلنا وحجزتها نسخة أخرى فلن يتغير صف، فتتراجع المعاملة بأثرها كله.
      const done=db.prepare("UPDATE jobs SET status='done',locked_by=NULL,locked_until=NULL,result=?,last_error='',finished_at=?,version=version+1,updated_at=? WHERE id=? AND status='running' AND locked_by=? AND attempts=?")
        .run(JSON.stringify(result??null),iso(at),iso(at),job.id,worker,job.attempts);
      if(done.changes!==1)throw Object.assign(new Error('lost the job lock'),{lost:true});
      audit(db,user,'job',job.id,'job.done',{}, {type:job.type,attempt:job.attempts,by:'job-worker'});
      return {id:job.id,type:job.type,outcome:'done'};
    });
  }catch(error){
    if(error.lost)return {id:job.id,type:job.type,outcome:'lost_lock'};
    const dead=!!error.permanent||job.attempts>=job.max_attempts,message=String(error.message??error).slice(0,500);
    return transaction(db,()=>{
      const changed=dead
        ?db.prepare("UPDATE jobs SET status='dead',locked_by=NULL,locked_until=NULL,last_error=?,finished_at=?,version=version+1,updated_at=? WHERE id=? AND status='running' AND locked_by=?").run(message,iso(at),iso(at),job.id,worker)
        :db.prepare("UPDATE jobs SET status='queued',locked_by=NULL,locked_until=NULL,last_error=?,due_at=?,version=version+1,updated_at=? WHERE id=? AND status='running' AND locked_by=?").run(message,iso(at+backoffMs(job.attempts,options.baseDelayMs,options.maxDelayMs)),iso(at),job.id,worker);
      if(changed.changes!==1)return {id:job.id,type:job.type,outcome:'lost_lock'};
      if(dead&&user)audit(db,user,'job',job.id,'job.dead',{}, {type:job.type,attempts:job.attempts,error:message,by:'job-worker'});
      return {id:job.id,type:job.type,outcome:dead?'dead':'retry',error:message};
    });
  }
}
// يُستدعى من مؤقّت الخادم. الساعة محقونة (now بالمللي ثانية) ليُختبر التراجع دون انتظار.
export function runDue(db,options={}){
  const o={...DEFAULTS,...options},at=o.now??Date.now(),worker=o.worker??`worker-${process.pid}`,results=[];
  for(const {id:tenantId} of db.prepare('SELECT id FROM tenants ORDER BY id').all()){
    // نسخة ماتت في محاولتها الأخيرة: لا تُعاد، بل تموت المهمة وتظهر لمسؤول المنصة.
    transaction(db,()=>{
      for(const stuck of db.prepare("SELECT * FROM jobs WHERE tenant_id=? AND status='running' AND locked_until<? AND attempts>=max_attempts").all(tenantId,iso(at))){
        db.prepare("UPDATE jobs SET status='dead',locked_by=NULL,locked_until=NULL,last_error=?,finished_at=?,version=version+1,updated_at=? WHERE id=? AND version=?").run('انتهى قفل المحاولة الأخيرة دون نتيجة',iso(at),iso(at),stuck.id,stuck.version);
        const user=requester(db,stuck);if(user)audit(db,user,'job',stuck.id,'job.dead',{}, {type:stuck.type,attempts:stuck.attempts,error:'lock expired',by:'job-worker'});
        results.push({id:stuck.id,type:stuck.type,outcome:'dead'});
      }
    });
    while(results.length<o.limit){
      const job=transaction(db,()=>claim(db,tenantId,worker,at,o.lockMs));
      if(!job)break;
      results.push(execute(db,job,worker,at,o));
    }
  }
  return results;
}

/* ───── المعالجات الخارجية ───── */
// verdict من settle: {status:'done',result} أو {status:'retry',error} أو {status:'dead',error}.
function closeExternal(db,job,worker,at,o,user,verdict){
  const message=String(verdict.error??'').slice(0,500);
  const mine="WHERE id=? AND status='running' AND locked_by=? AND attempts=?",args=[job.id,worker,job.attempts];
  let changed;
  if(verdict.status==='done')changed=db.prepare(`UPDATE jobs SET status='done',locked_by=NULL,locked_until=NULL,result=?,last_error='',finished_at=?,version=version+1,updated_at=? ${mine}`).run(JSON.stringify(verdict.result??null),iso(at),iso(at),...args);
  else if(verdict.status==='retry'&&job.attempts<job.max_attempts)changed=db.prepare(`UPDATE jobs SET status='queued',locked_by=NULL,locked_until=NULL,last_error=?,due_at=?,version=version+1,updated_at=? ${mine}`).run(message,iso(at+backoffMs(job.attempts,o.baseDelayMs,o.maxDelayMs)),iso(at),...args);
  else{
    changed=db.prepare(`UPDATE jobs SET status='dead',locked_by=NULL,locked_until=NULL,last_error=?,finished_at=?,version=version+1,updated_at=? ${mine}`).run(message,iso(at),iso(at),...args);
    if(changed.changes===1&&user)audit(db,user,'job',job.id,'job.dead',{}, {type:job.type,attempts:job.attempts,error:message,by:'job-worker'});
  }
  if(changed.changes!==1)return {id:job.id,type:job.type,outcome:'lost_lock'};
  const outcome=verdict.status==='done'?'done':verdict.status==='retry'&&job.attempts<job.max_attempts?'retry':'dead';
  return {id:job.id,type:job.type,outcome,...(message?{error:message}:{}),...(verdict.result?{result:verdict.result}:{})};
}
async function executeExternal(db,job,worker,at,o){
  const h=handlers.get(job.type),user=requester(db,job);
  const ctx={id:job.id,tenant_id:job.tenant_id,type:job.type,payload:JSON.parse(job.payload),attempt:job.attempts,max_attempts:job.max_attempts,final:job.attempts>=job.max_attempts,requested_by:job.requested_by,source:{entity:job.source_entity,id:job.source_id}};
  let plan;
  try{
    plan=transaction(db,()=>{
      if(!h?.external)throw Object.assign(new Error('لا معالج خارجيًا مسجلًا لهذا النوع في هذه النسخة'),{permanent:true});
      if(!user?.active)throw Object.assign(new Error('حساب من طلب المهمة غير نشط'),{permanent:true});
      return h.prepare(db,ctx,{...o.context,user,now:at});
    });
  }catch(error){return transaction(db,()=>closeExternal(db,job,worker,at,o,user,{status:error.permanent?'dead':'retry',error:error.message??error}));}
  // prepare يعيد {skip:result} حين لا يلزم إرسال (حُجب، أو أُرسل من قبل، أو أُلغي).
  if(!plan||'skip' in plan)return transaction(db,()=>closeExternal(db,job,worker,at,o,user,{status:'done',result:plan?.skip??null}));
  let outcome;
  try{outcome=await h.perform(plan,{...o.context,attempt:job.attempts});}
  catch(error){outcome={ok:false,retryable:true,error:String(error?.message??error)};}
  return transaction(db,()=>{
    let verdict;try{verdict=h.settle(db,ctx,plan,outcome,{...o.context,now:at});}catch(error){verdict={status:'dead',error:`تعذر تسجيل النتيجة: ${error?.message??error}`};}
    return closeExternal(db,job,worker,at,o,user,verdict);
  });
}
// يُستدعى من مؤقّت الخادم خارج أي معاملة. limit عدد أو دالة (tenantId)=>عدد، وبها يُحد معدل الإرسال لكل كيان.
export async function runDueExternal(db,options={}){
  const o={...DEFAULTS,...options},at=o.now??Date.now(),worker=o.worker??`worker-${process.pid}`,results=[];
  const types=o.types??JSON.parse(externalTypes());if(!types.length)return results;
  const tenants=o.tenantId?[{id:o.tenantId}]:db.prepare('SELECT id FROM tenants ORDER BY id').all();
  for(const {id:tenantId} of tenants){
    const limit=typeof o.limit==='function'?o.limit(tenantId):o.limit;
    for(let n=0;n<limit;n++){
      const job=transaction(db,()=>claim(db,tenantId,worker,at,o.lockMs,types));
      if(!job)break;
      results.push(await executeExternal(db,job,worker,at,o));
    }
  }
  return results;
}

/* ───── شاشة مسؤول المنصة ───── */
const mayOperate=(db,u)=>can(db,u,'platform.flags');
function present(job,operate){
  const actions=!operate?[]:job.status==='dead'?['retry_job','cancel_job']:job.status==='queued'?['cancel_job']:[];
  return {id:job.id,type:job.type,status:job.status,status_name:STATUS_NAMES[job.status],source:`${job.source_entity}:${job.source_id}`,requested_by_name:job.requested_by_name,due_at:job.due_at,attempts:job.attempts,max_attempts:job.max_attempts,last_error:job.last_error,finished_at:job.finished_at,created_at:job.created_at,version:job.version,handler_registered:handlers.has(job.type),
    // الحمولة تظهر للمهمة الميتة وحدها: هي ما يحتاجه المسؤول ليفهم الفشل.
    payload:job.status==='dead'?JSON.parse(job.payload):null,actions};
}
export function jobsBoard(db,supplied){
  const u=actor(db,supplied);if(!mayOperate(db,u))fail(403,'not_permitted','طابور المهام لمسؤول المنصة');
  const rows=status=>db.prepare(`SELECT j.*,x.name AS requested_by_name FROM jobs j JOIN users x ON x.id=j.requested_by WHERE j.tenant_id=? AND j.status${Array.isArray(status)?` IN (${status.map(()=>'?').join(',')})`:'=?'} ORDER BY j.updated_at DESC LIMIT 100`).all(u.tenant_id,...[status].flat()).map(j=>present(j,true));
  const counts=Object.fromEntries(Object.keys(STATUS_NAMES).map(k=>[k,0]));
  for(const r of db.prepare('SELECT status,COUNT(*) AS n FROM jobs WHERE tenant_id=? GROUP BY status').all(u.tenant_id))counts[r.status]=r.n;
  const oldest=db.prepare("SELECT MIN(due_at) AS t FROM jobs WHERE tenant_id=? AND status='queued'").get(u.tenant_id).t;
  return {counts,status_names:STATUS_NAMES,oldest_queued_due_at:oldest,dead:rows('dead'),pending:rows(['queued','running']),recent:rows(['done','cancelled']).slice(0,30),
    handlers:[...handlers].map(([type,h])=>({type,sensitive:h.sensitive})).sort((a,b)=>a.type.localeCompare(b.type)),
    alerts:counts.dead?[`${counts.dead} مهمة ميتة استنفدت محاولاتها أو سقط الفعل الذي نشأت عنه. لن تُعاد دون قرارك.`]:[],
    note:'الطابور ينفّذ ما قرره إنسان ولا يقرر: كل مهمة تحمل من طلبها والفعل المعتمد الذي نشأت عنه. المعالجات المتزامنة لا ترسل شيئًا خارج المنصة؛ بريد الإشعارات (mail.send) وحده معالج خارجي، ولا يرسل حتى يضبط المالك مزوّد البريد. المهمة المنفذة لا تُنفذ ثانية، والميتة لا تعود إلا بقرار مسجل بسببه. يعمل الطابور فقط إن شغّل الخادم مؤقّته.'};
}
function settle(db,supplied,jobId,input,action){
  writing(db);const u=actor(db,supplied);if(!mayOperate(db,u))fail(403,'not_permitted','طابور المهام لمسؤول المنصة');
  v.object(input,['version','reason']);
  const job=typeof jobId==='string'&&db.prepare('SELECT * FROM jobs WHERE id=? AND tenant_id=?').get(jobId,u.tenant_id);
  if(!job)fail(404,'not_found','المهمة غير متاحة');
  v.version(input.version,job.version);
  const reason=v.text(input.reason,'سبب القرار',1000,10),time=iso(Date.now());
  if(action==='retry'){
    if(job.status!=='dead')fail(409,'invalid_state','تُعاد المهمة الميتة فقط');
    if(!handlers.has(job.type))fail(409,'no_handler','لا معالج مسجلًا لهذا النوع في هذه النسخة');
    db.prepare("UPDATE jobs SET status='queued',attempts=0,due_at=?,finished_at=NULL,version=version+1,updated_at=? WHERE id=?").run(time,time,job.id);
  }else{
    if(!['dead','queued'].includes(job.status))fail(409,'invalid_state','تُلغى المهمة المنتظرة أو الميتة فقط');
    db.prepare("UPDATE jobs SET status='cancelled',finished_at=?,version=version+1,updated_at=? WHERE id=?").run(time,time,job.id);
  }
  audit(db,u,'job',job.id,action==='retry'?'job.retried':'job.cancelled',{status:job.status,attempts:job.attempts},{status:action==='retry'?'queued':'cancelled'},reason);
  return {id:job.id};
}
export const retryJob=(db,supplied,jobId,input)=>settle(db,supplied,jobId,input,'retry');
export const cancelJob=(db,supplied,jobId,input)=>settle(db,supplied,jobId,input,'cancel');
