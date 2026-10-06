import { randomUUID } from 'node:crypto';
import { audit, now, transaction } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { NOTICE_CATEGORIES, categoryOf, SUBJECT_LINKS } from './notices.mjs';
import { registerExternalHandler, hasHandler, enqueue, runDueExternal } from './jobs.mjs';
import { mailConfig, publicConfig, renderNotificationMail, sendMail, isEmail, NOT_CONFIGURED_MESSAGE } from './mailer.mjs';
import { reminderSettingsView, lastDailyRun } from './reminders.mjs';

// إيصال الإشعارات بالبريد. المسار: إشعار داخل المنصة (يُكتب دائمًا) ← المخطِّط يقرر لكل إشعار جديد هل يُرسل بريدًا
// (تفضيل صاحبه، وبريده الوظيفي، وإعداد المزود) ويكتب صفًا في الصادر ← مهمة mail.send في طابور المهام ترسله عبر mailer.mjs.
// الرسالة تنبيه ورابط فقط (انظر renderNotificationMail). عنوان البريد يُقرأ من سجل الموظف لحظة الإرسال ولا يُنسخ إلى الصادر.
export const MAIL_JOB='mail.send';
const MAX_ATTEMPTS=6,BASE_DELAY_MS=60000,MAX_DELAY_MS=3600000;
const iso=time=>new Date(time).toISOString();
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
// عنوان مقنّع لما يُعرض لغير صاحبه ولسجل التدقيق.
export const maskEmail=value=>{const [local,domain]=String(value??'').split('@');return domain?`${local.slice(0,1)}***@${domain}`:'';};

/* ───── التفضيلات والعنوان ───── */
// الافتراضي: كل الفئات تصل بالبريد متى فُعّل البريد وسُجل للموظف عنوان. تغييره قرار للمالك (انظر ملف التسليم).
const DEFAULT_CATEGORIES=NOTICE_CATEGORIES.map(c=>c.key);
export function emailCategories(db,userId){
  const row=db.prepare('SELECT categories FROM notification_email_prefs WHERE user_id=?').get(userId);
  return new Set(row?JSON.parse(row.categories):DEFAULT_CATEGORIES);
}
const workEmail=(db,userId)=>db.prepare('SELECT work_email FROM employee_profiles WHERE user_id=?').get(userId)?.work_email??null;

export function preferencesView(db,supplied,{env=process.env}={}){
  const u=actor(db,supplied),chosen=emailCategories(db,u.id),config=mailConfig(env);
  const row=db.prepare('SELECT version FROM notification_email_prefs WHERE user_id=?').get(u.id);
  const profile=db.prepare('SELECT work_email FROM employee_profiles WHERE user_id=?').get(u.id);
  const manage=can(db,u,'employees.view');
  return {
    categories:NOTICE_CATEGORIES.map(c=>({...c,email:chosen.has(c.key)})),version:row?.version??null,
    in_app:'الإشعار داخل المنصة يصلك دائمًا ولا يُطفأ. هنا تختار ما يصلك منه بالبريد أيضًا.',
    work_email:profile?.work_email??null,has_profile:!!profile,
    mail:{enabled:config.enabled,message:config.enabled?'البريد مفعّل. الرسالة تنبيه ورابط فقط، والتفاصيل داخل المنصة.':NOT_CONFIGURED_MESSAGE},
    can_manage_addresses:manage,
    people:manage?db.prepare("SELECT x.id,x.name,p.work_email,p.user_id IS NOT NULL AS has_profile FROM users x LEFT JOIN employee_profiles p ON p.user_id=x.id WHERE x.tenant_id=? AND x.active=1 AND x.role<>'admin' ORDER BY x.name").all(u.tenant_id)
      .map(p=>({id:p.id,name:p.name,work_email:p.work_email?maskEmail(p.work_email):null,has_email:!!p.work_email,has_profile:!!p.has_profile})):[]
  };
}
export function savePreferences(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['categories','version']);
  if(!Array.isArray(input.categories)||input.categories.length>NOTICE_CATEGORIES.length||input.categories.some(c=>!NOTICE_CATEGORIES.some(x=>x.key===c)))fail(400,'categories','اختر من الفئات المعروضة فقط');
  const categories=[...new Set(input.categories)].sort(),current=db.prepare('SELECT * FROM notification_email_prefs WHERE user_id=?').get(u.id),time=now();
  if(current){
    v.version(input.version,current.version);
    db.prepare('UPDATE notification_email_prefs SET categories=?,version=version+1,updated_at=? WHERE user_id=?').run(JSON.stringify(categories),time,u.id);
  }else{
    if(input.version!==undefined&&input.version!==null)fail(409,'stale_version','أعد تحميل الشاشة');
    db.prepare('INSERT INTO notification_email_prefs(user_id,tenant_id,categories,updated_at) VALUES(?,?,?,?)').run(u.id,u.tenant_id,JSON.stringify(categories),time);
  }
  audit(db,u,'notification_prefs',u.id,'notification_prefs.saved',{}, {email_categories:categories});
  return {categories};
}
// الموارد البشرية تسجل البريد الوظيفي في سجل الموظف. قيد النطاق اختياري عبر MAIL_ALLOWED_DOMAIN.
export function setWorkEmail(db,supplied,userId,input,{env=process.env}={}){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'employees.view'))fail(403,'not_permitted','البريد الوظيفي يسجله موظفو الموارد البشرية');
  v.object(input,['work_email']);
  const person=typeof userId==='string'&&db.prepare('SELECT id,name FROM users WHERE id=? AND tenant_id=?').get(userId,u.tenant_id);
  if(!person)fail(404,'not_found','الموظف غير موجود');
  const profile=db.prepare('SELECT work_email FROM employee_profiles WHERE user_id=?').get(person.id);
  if(!profile)fail(409,'profile_required','أنشئ الملف الوظيفي للموظف أولًا من «السجل الوظيفي»');
  const raw=typeof input.work_email==='string'?input.work_email.trim().toLowerCase():null;
  const email=raw===''?null:raw;
  if(email!==null&&!isEmail(email))fail(400,'work_email','عنوان البريد غير صالح');
  const domain=String(env.MAIL_ALLOWED_DOMAIN??'').trim().toLowerCase();
  if(email&&domain&&!email.endsWith('@'+domain))fail(400,'work_email',`البريد الوظيفي من نطاق الشركة @${domain} فقط`);
  if(email&&db.prepare('SELECT 1 FROM employee_profiles p JOIN users x ON x.id=p.user_id WHERE p.work_email=? AND x.tenant_id=? AND p.user_id<>?').get(email,u.tenant_id,person.id))fail(409,'work_email_taken','هذا البريد مسجل لموظف آخر');
  db.prepare('UPDATE employee_profiles SET work_email=? WHERE user_id=?').run(email,person.id);
  audit(db,u,'employee',person.id,'employee.work_email',{work_email:profile.work_email?maskEmail(profile.work_email):null},{work_email:email?maskEmail(email):null});
  return {id:person.id,work_email:email?maskEmail(email):null};
}

/* ───── المخطِّط ───── */
const linkOf=n=>n.request_id?`#request/${n.request_id}`:(SUBJECT_LINKS[n.subject_kind]??'#notifications');
function outboxRow(db,n,tenantId,status,reason,time){
  const outboxId=randomUUID();
  db.prepare("INSERT INTO outbox(id,tenant_id,channel,notification_id,user_id,category,event_key,event_type,status,reason,created_at,updated_at) VALUES(?,?,'email',?,?,?,?,?,?,?,?,?)")
    .run(outboxId,tenantId,n.id,n.user_id,categoryOf(n.request_id?{...n,subject_kind:'request'}:n),`email:${n.id}`,'notification.email',status,reason,time,time);
  return outboxId;
}
function enqueueSend(db,user,outboxId,notificationId,key=`${MAIL_JOB}:${outboxId}`){
  return enqueue(db,user,{type:MAIL_JOB,payload:{outbox_id:outboxId},idempotency_key:key,source:{entity:'notification',id:notificationId},max_attempts:MAX_ATTEMPTS},{audit:false});
}
// لماذا لا يُرسل: يُعاد نصًا أو null إن جاز الإرسال.
function holdReason(db,user,category){
  if(!user.active)return ['suppressed','الحساب غير نشط'];
  if(!emailCategories(db,user.id).has(category))return ['suppressed','اختار صاحب الحساب ألا يصله بريد لهذه الفئة'];
  if(!workEmail(db,user.id))return ['suppressed','لا بريد وظيفي في سجل الموظف'];
  return null;
}
// يُستدعى من مؤقّت الخادم. أول تشغيل لكل كيان يثبت المؤشر ولا يرسل شيئًا مما سبق.
export function planDeliveries(db,{now:at=Date.now(),env=process.env,limit=500}={}){
  const config=mailConfig(env),totals={queued:0,blocked:0,suppressed:0};
  for(const {id:tenantId} of db.prepare('SELECT id FROM tenants ORDER BY id').all())transaction(db,()=>{
    const state=db.prepare('SELECT planned_since FROM mail_delivery_state WHERE tenant_id=?').get(tenantId);
    if(!state){db.prepare('INSERT INTO mail_delivery_state(tenant_id,planned_since) VALUES(?,?)').run(tenantId,iso(at));return;}
    const rows=db.prepare(`SELECT n.* FROM notifications n JOIN users x ON x.id=n.user_id WHERE x.tenant_id=? AND n.created_at>=?
      AND NOT EXISTS(SELECT 1 FROM outbox o WHERE o.event_key='email:'||n.id) ORDER BY n.created_at LIMIT ?`).all(tenantId,state.planned_since,limit);
    const time=iso(at);
    for(const n of rows){
      const user=db.prepare('SELECT * FROM users WHERE id=?').get(n.user_id),category=categoryOf(n.request_id?{...n,subject_kind:'request'}:n);
      const hold=holdReason(db,user,category);
      if(hold){outboxRow(db,n,tenantId,hold[0],hold[1],time);totals.suppressed++;continue;}
      if(!config.enabled||!hasHandler(MAIL_JOB)){outboxRow(db,n,tenantId,'blocked',config.enabled?'عامل البريد غير مسجل في هذه النسخة':NOT_CONFIGURED_MESSAGE,time);totals.blocked++;continue;}
      const outboxId=outboxRow(db,n,tenantId,'queued','بانتظار الإرسال',time);
      enqueueSend(db,user,outboxId,n.id);totals.queued++;
    }
  });
  return totals;
}

/* ───── العامل: معالج mail.send ───── */
function setOutbox(db,outboxId,status,reason,time){
  db.prepare("UPDATE outbox SET status=?,reason=?,updated_at=? WHERE id=? AND status='queued'").run(status,reason,time,outboxId);
}
const handler={
  prepare(db,job,context){
    const time=iso(context.now),row=db.prepare("SELECT * FROM outbox WHERE id=? AND tenant_id=? AND channel='email'").get(job.payload.outbox_id,job.tenant_id);
    if(!row)return {skip:{missing:true}};
    // أُرسل أو حُجب أو أُلغي من قبل: لا يُرسل ثانية (يحمي من الإعادة بعد فقد القفل).
    if(row.status!=='queued')return {skip:{status:row.status}};
    const config=mailConfig(context.env??process.env);
    if(!config.enabled){setOutbox(db,row.id,'blocked',NOT_CONFIGURED_MESSAGE,time);return {skip:{blocked:true}};}
    const user=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(row.user_id,row.tenant_id);
    const hold=user?holdReason(db,user,row.category):['suppressed','الحساب غير موجود'];
    if(hold){setOutbox(db,row.id,hold[0],hold[1],time);return {skip:{[hold[0]]:true}};}
    const n=db.prepare('SELECT * FROM notifications WHERE id=?').get(row.notification_id);
    if(!n){setOutbox(db,row.id,'suppressed','الإشعار غير موجود',time);return {skip:{suppressed:true}};}
    const message=renderNotificationMail({category:row.category,link:linkOf(n),recipientName:user.name},config);
    return {config,outboxId:row.id,message:{...message,to:workEmail(db,user.id),idempotencyKey:row.id}};
  },
  perform(plan,context){return sendMail(plan.config,plan.message,{fetchImpl:context.fetchImpl??globalThis.fetch,timeoutMs:context.timeoutMs??15000});},
  settle(db,job,plan,outcome,context){
    const time=iso(context.now);
    if(outcome?.ok){
      db.prepare("UPDATE outbox SET status='sent',provider_id=?,sent_at=?,attempts=attempts+1,last_error='',reason=?,updated_at=? WHERE id=? AND status='queued'").run(outcome.providerId??null,time,'أرسله المزود',time,plan.outboxId);
      return {status:'done',result:{sent:true,provider_id:outcome.providerId??null}};
    }
    const error=String(outcome?.error??'فشل غير معروف').slice(0,500);
    if(outcome?.retryable&&!job.final){
      db.prepare("UPDATE outbox SET attempts=attempts+1,last_error=?,reason=?,updated_at=? WHERE id=? AND status='queued'").run(error,'إعادة المحاولة بعد مهلة',time,plan.outboxId);
      return {status:'retry',error};
    }
    db.prepare("UPDATE outbox SET status='failed',attempts=attempts+1,last_error=?,reason=?,updated_at=? WHERE id=? AND status='queued'").run(error,outcome?.retryable?'استنفدت المحاولات':'رفض المزود الرسالة',time,plan.outboxId);
    return {status:'dead',error};
  }
};
export function registerDeliveryHandlers(){if(!hasHandler(MAIL_JOB))registerExternalHandler(MAIL_JOB,handler);}

// حد المعدل: ما أُرسل في آخر دقيقة يُخصم من سعة الدقيقة لكل كيان. بلا إعداد يعمل العامل ليحجب ما في الانتظار.
export async function drainMail(db,{now:at=Date.now(),env=process.env,fetchImpl=globalThis.fetch,timeoutMs=15000,worker=`mail-${process.pid}`}={}){
  const config=mailConfig(env);
  const capacity=tenantId=>config.enabled?Math.max(0,config.ratePerMinute-db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE tenant_id=? AND channel='email' AND sent_at>?").get(tenantId,iso(at-60000)).n):200;
  return runDueExternal(db,{types:[MAIL_JOB],limit:capacity,now:at,worker,baseDelayMs:BASE_DELAY_MS,maxDelayMs:MAX_DELAY_MS,context:{env,fetchImpl,timeoutMs}});
}

/* ───── شاشة مسؤول المنصة ───── */
const STATUS_NAMES={queued:'في الانتظار',sent:'أُرسل',failed:'فشل',blocked:'محجوب — البريد غير مفعّل',suppressed:'لم يُرسل بقرار (تفضيل أو لا عنوان)'};
export const ENV_VARS=[
  {name:'MAIL_PROVIDER_URL',required:true,purpose:'رابط HTTPS لنقطة الإرسال لدى المزود'},
  {name:'MAIL_API_KEY',required:true,purpose:'مفتاح المزود؛ يُقرأ من البيئة فقط ولا يظهر في أي شاشة'},
  {name:'MAIL_FROM',required:true,purpose:'عنوان المرسل من نطاق الشركة الموثّق (SPF وDKIM وDMARC)'},
  {name:'MAIL_APP_URL',required:false,purpose:'رابط المنصة الذي يفتحه زر الرسالة (HTTPS)'},
  {name:'MAIL_FROM_NAME',required:false,purpose:'اسم المرسل الظاهر'},
  {name:'MAIL_RATE_PER_MINUTE',required:false,purpose:'حد الإرسال في الدقيقة (الافتراضي 30)'},
  {name:'MAIL_ALLOWED_DOMAIN',required:false,purpose:'يقصر البريد الوظيفي على نطاق الشركة'},
  {name:'MAIL_DELIVERY',required:false,purpose:'off لإيقاف كل إرسال فورًا'}
];
export function mailBoard(db,supplied,{env=process.env}={}){
  const u=actor(db,supplied);if(!can(db,u,'platform.flags'))fail(403,'not_permitted','حالة البريد لمسؤول المنصة');
  const config=mailConfig(env),counts=Object.fromEntries(Object.keys(STATUS_NAMES).map(k=>[k,0]));
  for(const r of db.prepare("SELECT status,COUNT(*) AS n FROM outbox WHERE tenant_id=? AND channel='email' GROUP BY status").all(u.tenant_id))counts[r.status]=r.n;
  const rows=status=>db.prepare(`SELECT o.id,o.status,o.category,o.reason,o.attempts,o.last_error,o.provider_id,o.created_at,o.sent_at,x.name AS recipient_name FROM outbox o JOIN users x ON x.id=o.user_id WHERE o.tenant_id=? AND o.channel='email' ${status?'AND o.status=?':''} ORDER BY o.created_at DESC LIMIT 50`).all(u.tenant_id,...(status?[status]:[]))
    .map(r=>({...r,status_name:STATUS_NAMES[r.status],category_name:NOTICE_CATEGORIES.find(c=>c.key===r.category)?.name??r.category}));
  const actions=[];
  if(config.enabled&&counts.blocked)actions.push('requeue_blocked');
  if(config.enabled&&counts.failed)actions.push('requeue_failed');
  return {configured:config.enabled,status_message:config.enabled?'البريد مفعّل':NOT_CONFIGURED_MESSAGE,config:publicConfig(config),env_vars:ENV_VARS,
    counts,status_names:STATUS_NAMES,recent:rows(null),failed:rows('failed'),handler_registered:hasHandler(MAIL_JOB),
    reminders:{settings:reminderSettingsView(db,u),last_run:lastDailyRun(db,u.tenant_id)},actions,
    note:'الرسالة تنبيه ورابط فقط: لا عنوان إشعار ولا مبلغ ولا رقم هوية ولا بيان صحي. الإشعار داخل المنصة يُكتب دائمًا مهما كانت حالة البريد. عنوان المستلم يُقرأ من سجل الموظف لحظة الإرسال ولا يُخزَّن في الصادر.'};
}
// إعادة ما حُجب أو فشل بعد تفعيل المزود. آخر سبعة أيام فقط، وبحد 500 رسالة للقرار الواحد.
export function requeueMail(db,supplied,input,{env=process.env,at=Date.now()}={}){
  writing(db);const u=actor(db,supplied);if(!can(db,u,'platform.flags'))fail(403,'not_permitted','حالة البريد لمسؤول المنصة');
  v.object(input,['status','reason']);
  if(!['blocked','failed'].includes(input.status))fail(400,'status','اختر المحجوب أو الفاشل');
  const reason=v.text(input.reason,'سبب الإعادة',1000,10);
  if(!mailConfig(env).enabled)fail(409,'mail_not_configured',NOT_CONFIGURED_MESSAGE);
  if(!hasHandler(MAIL_JOB))fail(409,'no_handler','عامل البريد غير مسجل في هذه النسخة');
  const rows=db.prepare("SELECT * FROM outbox WHERE tenant_id=? AND channel='email' AND status=? AND created_at>? ORDER BY created_at LIMIT 500").all(u.tenant_id,input.status,iso(at-7*86400000));
  const time=iso(at);let queued=0,suppressed=0;
  for(const row of rows){
    const user=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(row.user_id,u.tenant_id),hold=user?holdReason(db,user,row.category):['suppressed','الحساب غير موجود'];
    if(hold){db.prepare('UPDATE outbox SET status=?,reason=?,updated_at=? WHERE id=?').run(hold[0],hold[1],time,row.id);suppressed++;continue;}
    db.prepare("UPDATE outbox SET status='queued',reason='أُعيد للإرسال بقرار مسؤول المنصة',last_error='',updated_at=? WHERE id=?").run(time,row.id);
    enqueueSend(db,user,row.id,row.notification_id,`${MAIL_JOB}:${row.id}:${randomUUID().slice(0,8)}`);queued++;
  }
  audit(db,u,'mail','outbox','mail.requeued',{status:input.status},{queued,suppressed},reason);
  return {queued,suppressed};
}
