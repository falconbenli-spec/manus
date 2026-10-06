import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { login, authenticate } from '../app/auth.mjs';
import { grantAccess, setAdminLevel } from '../app/access.mjs';
import { resetTotp } from '../app/totp.mjs';
import * as wf from '../app/workflow.mjs';
import { notifySubject, NOTICE_CATEGORIES } from '../app/notices.mjs';
import { runDue, jobsBoard, clearHandlers } from '../app/jobs.mjs';
import { mailConfig, renderNotificationMail, assertMailSafe, NOT_CONFIGURED_MESSAGE } from '../app/mailer.mjs';
import * as delivery from '../app/delivery.mjs';
import * as reminders from '../app/reminders.mjs';
import { setIdlePolicy, idlePolicy } from '../app/session-policy.mjs';
import { fail } from '../app/auth.mjs';
import { fileCase, caseAction } from '../app/hr-cases.mjs';
import { requestMission, decideMission } from '../app/attendance-extras.mjs';
import { requestTraining, trainingAction } from '../app/talent.mjs';
import { saveExpiryWatch } from '../app/expiry.mjs';

// الإشعارات والبريد والتذكيرات ومهلة الخمول وترويسات الأمان (docs/implementation/handoff/notifications-email.md).
const PASSWORD='synthetic-notifications-email';
const MINUTE=60000,DAY=86400000;
const ENV={MAIL_PROVIDER_URL:'https://mail.example.test/v1/emails',MAIL_API_KEY:'synthetic-provider-key-0001',MAIL_FROM:'noreply@example.test',MAIL_APP_URL:'https://platform.example.test'};
const code=value=>error=>error.code===value;
// الساعة: 08:30 بالرياض (05:30 بتوقيت غرينتش) يوم اثنين، فلا تعتمد النتيجة على ساعة التشغيل. كان اليوم ثابتًا (5 أكتوبر 2026)
// والطلب يُقدَّم بساعة الجهاز مفترضًا أنه قبله بأسبوعين؛ فلما بلغ التقويم أول أكتوبر صار الطلب أحدث من ثلاثة أيام عمل وسقط
// «التذكير اليومي». الآن: أول اثنين بعد أسبوعين من الآن على الأقل — الافتراضان (اثنين، وأسبوعان بعد التقديم) قائمان كل يوم.
const T0=(()=>{const d=new Date(Date.now()+14*DAY);d.setUTCHours(5,30,0,0);while(d.getUTCDay()!==1)d.setUTCDate(d.getUTCDate()+1);return d.getTime();})();
const riyadhDay=at=>new Date(at+3*3600000).toISOString().slice(0,10);
const plusDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);

function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id,admin_level) VALUES('admin2','36t','ops','admin2','مسؤول منصة ثانٍ','unused','admin',NULL,'scoped'),('hr2','36t','hr','hr2','منفذة خدمات الموظف','unused','hr',NULL,NULL)").run();
  // خطوة «hr» معيّنة لصاحبتها صراحة: موظفتان بدور hr في الإدارة نفسها تجعلان المسار ملتبسًا.
  db.prepare("INSERT INTO department_routing(tenant_id,department_id,step_role,user_id,assigned_by,assigned_at) VALUES('36t','hr','hr','hr','admin',?)").run(now());
  const users=()=>Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const profile=(userId,email)=>{
    db.prepare("INSERT INTO employee_profiles(user_id,tenant_id,job_title,employment_type,join_date,status,updated_by,updated_at) VALUES(?,'36t','مسمى تجريبي','full_time','2025-01-01','active','hr',?)").run(userId,now());
    if(email)tx(()=>delivery.setWorkEmail(db,users().hr,userId,{work_email:email},{env:{}}));
  };
  const notes=userId=>db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at,rowid').all(userId);
  return {db,users:users(),tx,profile,notes};
}
// مزود وهمي: يسجل كل طلب ويرد بما يحدده الاختبار.
function fakeProvider(replies){
  const calls=[];let i=0;
  const fetchImpl=async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});const r=replies[Math.min(i++,replies.length-1)];if(r instanceof Error)throw r;return new Response(JSON.stringify(r.body??{}),{status:r.status});};
  return {calls,fetchImpl};
}
function mailReady(t){
  const f=fixture(t);delivery.registerDeliveryHandlers();
  delivery.planDeliveries(f.db,{now:Date.now()-DAY,env:ENV}); // أول تشغيل يثبت المؤشر
  f.profile('employee','employee@example.test');
  // ساعة البريد: بعد لحظة الإنشاء الحقيقية بقليل، فالمهام المستحقة «الآن» مستحقة عندها، والتراجع يُقاس منها.
  f.T=Date.now()+5000;
  return f;
}
const noticeFor=(f,userId,title='اعتُمد طلبك «طابعة»')=>f.tx(()=>notifySubject(f.db,{userId,kind:'expense_approved',subjectKind:'expense_claim',subjectId:'claim-1',title,body:'التفاصيل في شاشتها.'}));

/* ───── البريد ───── */
test('mail is OFF by default: without MAIL_* the worker marks mail blocked and the admin screen says the owner must choose a provider',async t=>{
  const f=mailReady(t);
  assert.equal(mailConfig({}).enabled,false);
  assert.deepEqual(mailConfig({}).missing,['MAIL_PROVIDER_URL','MAIL_API_KEY','MAIL_FROM']);
  assert.equal(mailConfig({...ENV,MAIL_PROVIDER_URL:'http://mail.example.test'}).enabled,false,'plain http is refused');
  assert.equal(mailConfig({...ENV,MAIL_DELIVERY:'off'}).enabled,false,'the kill switch wins over a complete configuration');
  noticeFor(f,'employee');
  const planned=delivery.planDeliveries(f.db,{now:f.T,env:{}});
  assert.deepEqual(planned,{queued:0,blocked:1,suppressed:0});
  const row=f.db.prepare("SELECT * FROM outbox WHERE channel='email'").get();
  assert.equal(row.status,'blocked');assert.equal(row.reason,NOT_CONFIGURED_MESSAGE);
  // عنصر وُضع في الانتظار ثم أزيل الإعداد: العامل نفسه يحجبه ولا يتصل بأحد.
  noticeFor(f,'employee','إشعار ثانٍ');
  assert.equal(delivery.planDeliveries(f.db,{now:f.T+1000,env:ENV}).queued,1);
  const provider=fakeProvider([{status:200,body:{id:'x'}}]);
  const results=await delivery.drainMail(f.db,{now:f.T+2000,env:{},fetchImpl:provider.fetchImpl});
  assert.equal(results.length,1);assert.equal(results[0].outcome,'done');assert.equal(provider.calls.length,0,'nothing leaves the platform');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE channel='email' AND status='blocked'").get().n,2);
  const board=delivery.mailBoard(f.db,f.users.admin,{env:{}});
  assert.equal(board.status_message,'البريد غير مفعّل — يحتاج قرار المالك باختيار المزوّد');
  assert.equal(board.configured,false);assert.equal(board.counts.blocked,2);assert.deepEqual(board.actions,[],'nothing to requeue until the provider is configured');
  assert.throws(()=>f.tx(()=>delivery.requeueMail(f.db,f.users.admin,{status:'blocked',reason:'اختبار إعادة بلا مزود'},{env:{}})),code('mail_not_configured'));
  assert.throws(()=>delivery.mailBoard(f.db,f.users.employee,{env:{}}),code('not_permitted'));
  // الأحداث القديمة في الصادر لا تختلط بالبريد في شاشة التكاملات.
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE channel='event'").get().n,0);
  assert.ok(jobsBoard(f.db,f.users.admin).handlers.some(h=>h.type==='mail.send'),'the mail worker is a registered jobs handler');
  assert.equal(verifyAudit(f.db),true);
});

test('sending through a mocked provider: one request with Bearer key and idempotency key, provider id stored, the key never shown',async t=>{
  const f=mailReady(t);
  noticeFor(f,'employee');
  delivery.planDeliveries(f.db,{now:f.T,env:ENV});
  const provider=fakeProvider([{status:200,body:{id:'prov-123'}}]);
  const results=await delivery.drainMail(f.db,{now:f.T+1000,env:ENV,fetchImpl:provider.fetchImpl});
  assert.deepEqual(results.map(r=>r.outcome),['done']);
  assert.equal(provider.calls.length,1);
  const [call]=provider.calls,row=f.db.prepare("SELECT * FROM outbox WHERE channel='email'").get();
  assert.equal(call.url,ENV.MAIL_PROVIDER_URL);assert.equal(call.init.method,'POST');
  assert.equal(call.init.headers.Authorization,`Bearer ${ENV.MAIL_API_KEY}`);
  assert.equal(call.init.headers['Idempotency-Key'],row.id);
  assert.deepEqual(call.body.to,['employee@example.test']);
  assert.match(call.body.from,/<noreply@example\.test>$/);
  assert.match(call.body.html,/<html lang="ar" dir="rtl">/);assert.ok(call.body.text.length>20);
  assert.ok(call.body.html.includes('https://platform.example.test/#expenses'),'the link opens the record screen');
  assert.equal(row.status,'sent');assert.equal(row.provider_id,'prov-123');assert.ok(row.sent_at);
  // لا يُرسل ثانية: تشغيل آخر لا يجد شيئًا.
  assert.equal((await delivery.drainMail(f.db,{now:f.T+2000,env:ENV,fetchImpl:provider.fetchImpl})).length,0);
  const board=delivery.mailBoard(f.db,f.users.admin,{env:ENV});
  assert.equal(board.configured,true);assert.equal(board.counts.sent,1);assert.equal(board.config.provider_host,'mail.example.test');
  const shown=JSON.stringify(board);
  assert.ok(!shown.includes(ENV.MAIL_API_KEY),'the API key never reaches a screen');
  assert.ok(!shown.includes('employee@example.test'),'the recipient address is not copied to the outbox screen');
  assert.ok(!JSON.stringify(f.db.prepare("SELECT * FROM outbox").all()).includes('employee@example.test'),'the address is not stored in the outbox');
  // التفضيل: من أطفأ فئة «طلباتي» لا يصله بريدها، ويبقى إشعاره داخل المنصة.
  f.tx(()=>delivery.savePreferences(f.db,f.users.employee,{categories:NOTICE_CATEGORIES.map(c=>c.key).filter(k=>k!=='my_requests')}));
  noticeFor(f,'employee','إشعار بعد إطفاء الفئة');
  assert.deepEqual(delivery.planDeliveries(f.db,{now:f.T+3000,env:ENV}),{queued:0,blocked:0,suppressed:1});
  assert.equal(f.db.prepare("SELECT reason FROM outbox WHERE status='suppressed'").get().reason,'اختار صاحب الحساب ألا يصله بريد لهذه الفئة');
  assert.equal(f.notes('employee').length,2,'in-app notices are always written');
  // من لا بريد له لا يُرسل إليه.
  noticeFor(f,'outsider');
  assert.equal(delivery.planDeliveries(f.db,{now:f.T+4000,env:ENV}).suppressed,1);
});

test('retry with backoff through the jobs queue, rate limit per minute, a permanent refusal fails once, and exhausted retries dead-letter',async t=>{
  const f=mailReady(t);
  noticeFor(f,'employee');delivery.planDeliveries(f.db,{now:f.T,env:ENV});
  const provider=fakeProvider([{status:503,body:{message:`down ${ENV.MAIL_API_KEY}`}},{status:200,body:{id:'prov-2'}}]);
  let r=await delivery.drainMail(f.db,{now:f.T,env:ENV,fetchImpl:provider.fetchImpl});
  assert.deepEqual(r.map(x=>x.outcome),['retry']);
  let row=f.db.prepare("SELECT * FROM outbox WHERE channel='email'").get(),job=f.db.prepare("SELECT * FROM jobs WHERE type='mail.send'").get();
  assert.equal(row.status,'queued');assert.equal(row.attempts,1);assert.match(row.last_error,/503/);
  assert.ok(!row.last_error.includes(ENV.MAIL_API_KEY),'the key is scrubbed from stored errors');
  assert.equal(job.status,'queued');assert.equal(Date.parse(job.due_at)-f.T,MINUTE,'first retry after one minute');
  assert.equal((await delivery.drainMail(f.db,{now:f.T+30000,env:ENV,fetchImpl:provider.fetchImpl})).length,0,'not before the backoff');
  r=await delivery.drainMail(f.db,{now:f.T+MINUTE+1000,env:ENV,fetchImpl:provider.fetchImpl});
  assert.deepEqual(r.map(x=>x.outcome),['done']);
  row=f.db.prepare("SELECT * FROM outbox WHERE channel='email'").get();
  assert.equal(row.status,'sent');assert.equal(row.attempts,2);assert.equal(provider.calls.length,2);
  assert.equal(provider.calls[0].init.headers['Idempotency-Key'],provider.calls[1].init.headers['Idempotency-Key'],'a retry reuses the idempotency key');

  // حد المعدل: رسالة واحدة في الدقيقة.
  const t1=f.T+10*MINUTE,env={...ENV,MAIL_RATE_PER_MINUTE:'1'};
  noticeFor(f,'employee','أ');noticeFor(f,'employee','ب');
  assert.equal(delivery.planDeliveries(f.db,{now:t1,env}).queued,2);
  const ok=fakeProvider([{status:202,body:{id:'p'}}]);
  assert.equal((await delivery.drainMail(f.db,{now:t1,env,fetchImpl:ok.fetchImpl})).length,1);
  assert.equal((await delivery.drainMail(f.db,{now:t1+20000,env,fetchImpl:ok.fetchImpl})).length,0,'the minute budget is spent');
  assert.equal((await delivery.drainMail(f.db,{now:t1+MINUTE+1000,env,fetchImpl:ok.fetchImpl})).length,1);
  assert.equal(ok.calls.length,2);

  // رفض نهائي (400): فشل بلا إعادة، والمهمة ميتة تظهر لمسؤول المنصة.
  const t2=f.T+20*MINUTE;noticeFor(f,'employee','ج');delivery.planDeliveries(f.db,{now:t2,env:ENV});
  const refuse=fakeProvider([{status:400,body:{message:'invalid recipient'}}]);
  assert.deepEqual((await delivery.drainMail(f.db,{now:t2,env:ENV,fetchImpl:refuse.fetchImpl})).map(x=>x.outcome),['dead']);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status='failed'").get().n,1);
  assert.equal(delivery.mailBoard(f.db,f.users.admin,{env:ENV}).failed.length,1,'the dead letter is on the admin screen');

  // تعطل دائم في الشبكة: ست محاولات بتراجع مضاعف ثم فشل.
  const t3=f.T+60*MINUTE;noticeFor(f,'employee','د');delivery.planDeliveries(f.db,{now:t3,env:ENV});
  const down=fakeProvider([new TypeError('connect ECONNREFUSED')]);let at=t3;const outcomes=[];
  for(let i=0;i<6;i++){const res=await delivery.drainMail(f.db,{now:at,env:ENV,fetchImpl:down.fetchImpl});outcomes.push(...res.map(x=>x.outcome));at+=2*3600000;}
  assert.deepEqual(outcomes,['retry','retry','retry','retry','retry','dead']);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status='failed'").get().n,2);
  // بعد الإصلاح يعيد مسؤول المنصة الفاشل بقرار مسجل.
  const back=f.tx(()=>delivery.requeueMail(f.db,f.users.admin,{status:'failed',reason:'أصلح المزود الخلل وأعيد الإرسال'},{env:ENV,at:at}));
  assert.deepEqual(back,{queued:2,suppressed:0});
  assert.equal(verifyAudit(f.db),true);
});

test('templates: every value is escaped, the page is Arabic RTL with a text part, and a hostile link falls back to the notifications screen',()=>{
  const config={appUrl:'https://platform.example.test'};
  const mail=renderNotificationMail({category:'approvals',link:'#inbox',recipientName:'<script>alert(1)</script> "x" & \'y\''},config);
  assert.ok(!mail.html.includes('<script>'));assert.ok(mail.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot; &amp; &#39;y&#39;'));
  assert.match(mail.html,/^<!doctype html><html lang="ar" dir="rtl">/);
  assert.ok(mail.text.includes('https://platform.example.test/#inbox'));assert.ok(!mail.text.includes('<p'),'the text part is plain text');
  assert.ok(mail.subject.startsWith('3,6T: '));assert.ok(!/[\r\n]/.test(mail.subject),'no header injection through the subject');
  const hostile=renderNotificationMail({category:'approvals',link:'#x" onmouseover="alert(1)',recipientName:'سارة\r\nBcc: attacker@example.test'},config);
  assert.ok(hostile.html.includes('https://platform.example.test/#notifications'));assert.ok(!hostile.html.includes('onmouseover'));
  assert.ok(!hostile.text.includes('\r\nBcc'),'line breaks in a name are flattened');
  assert.ok(renderNotificationMail({category:'unknown',link:'#inbox'},{}).text.includes('افتح المنصة للاطلاع على التفاصيل'),'without MAIL_APP_URL there is no link');
});

test('no salary, ID or health data in any rendered mail, whatever the in-app notice says',async t=>{
  const f=mailReady(t);
  const title='اعتُمدت الإجازة المرضية · راتبك 15,000 ريال · إقامة 2345678901 · IBAN SA0380000000608010167519';
  noticeFor(f,'employee',title);delivery.planDeliveries(f.db,{now:f.T,env:ENV});
  const provider=fakeProvider([{status:200,body:{id:'p'}}]);
  await delivery.drainMail(f.db,{now:f.T,env:ENV,fetchImpl:provider.fetchImpl});
  const sent=JSON.stringify(provider.calls[0].body);
  for(const secret of ['15,000','2345678901','SA0380000000608010167519','راتب','المرضية','ريال',title.slice(0,12)])assert.ok(!sent.includes(secret),`mail must not contain ${secret}`);
  for(const category of NOTICE_CATEGORIES.map(c=>c.key))assertMailSafe(renderNotificationMail({category,link:'#inbox',recipientName:'الموظفة التجريبية'},{appUrl:'https://platform.example.test'}));
  assert.throws(()=>assertMailSafe({subject:'x',text:'راتبك 9000 ريال',html:''}),/mail_content_forbidden/);
  assert.throws(()=>assertMailSafe({subject:'x',text:'هوية 1098765432',html:''}),/mail_content_forbidden/);
  // اسم يطابق نمطًا صحيًا («مرضي» اسم علم) يُسقط من التحية ولا يوقف الرسالة.
  assert.ok(!renderNotificationMail({category:'approvals',link:'#inbox',recipientName:'مرضي'},{}).html.includes('مرضي'));
  // حالات الموارد البشرية: حتى الإشعار داخل المنصة لا يحمل العنوان ولا الوصف.
  const caseId=f.tx(()=>fileCase(f.db,f.users.employee,{category:'complaint',subject:'شكوى سرية بخصوص المدير',description:'وصف تفصيلي لا يجوز أن يظهر في أي إشعار أو بريد إطلاقًا'})).id;
  const intake=f.notes('hr').find(n=>n.subject_kind==='hr_case');
  assert.match(intake.title,/^حالة سرية جديدة بانتظار الاستلام رقم [0-9A-F]{8}$/);
  assert.ok(!JSON.stringify(f.notes('hr')).includes('شكوى سرية')&&!JSON.stringify(f.notes('hr')).includes('وصف تفصيلي'));
  f.tx(()=>caseAction(f.db,f.users.hr,caseId,'take_case',{version:1}));
  f.tx(()=>caseAction(f.db,f.users.hr,caseId,'reply_case',{version:2,body:'رد تفصيلي يخص المشكو منه بالاسم'}));
  const mine=f.notes('employee').filter(n=>n.subject_kind==='hr_case');
  assert.equal(mine.length,2);assert.ok(mine.every(n=>/^تحديث على حالتك رقم [0-9A-F]{8}$/.test(n.title)&&n.category==='hr_cases'));
  assert.ok(!JSON.stringify(mine).includes('رد تفصيلي'));
  f.tx(()=>caseAction(f.db,f.users.hr,caseId,'note_case',{version:3,body:'ملاحظة داخلية لا تُشعر أحدًا'}));
  assert.equal(f.notes('employee').filter(n=>n.subject_kind==='hr_case').length,2,'an internal note notifies nobody');
});

/* ───── التذكيرات اليومية ───── */
test('daily reminders: one job per Riyadh day from 08:00, idempotent across repeats and a restart, reminders sent once per stage',t=>{
  const f=fixture(t);reminders.registerReminderHandlers();
  const day=riyadhDay(T0);
  // وثيقة إقامة تنتهي بعد 20 يومًا، ومدة التذكير يدخلها مالك الإجراء (60 ثم 30).
  f.db.prepare("INSERT INTO employee_documents(id,tenant_id,user_id,doc_type,reference,expires_on,created_by,created_at) VALUES('doc-1','36t','employee','iqama','آخر 4 أرقام 1234',?,'hr',?)").run(plusDays(day,20),now());
  // بلا إعداد: لا يُرسل شيء، وتُسرد الأنواع التي تحتاج قرارًا.
  const bare=f.tx(()=>reminders.runDailyReminders(f.db,'36t',day,T0));
  assert.equal(bare.expiry.sent,0);assert.ok(bare.expiry.needs_owner_decision.some(k=>k.key==='employee.iqama'));assert.match(bare.expiry.note,/لم يُرسل شيء/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE subject_kind='expiry'").get().n,0);
  f.tx(()=>saveExpiryWatch(f.db,f.users.hr,'employee.iqama',{first_reminder_days:60,second_reminder_days:30,basis:'قرار مدير الموارد البشرية التجريبي بتاريخ اليوم'}));

  const before8=Date.parse(`${day}T04:59:00.000Z`);
  assert.deepEqual(reminders.scheduleDaily(f.db,{now:before8}),[],'nothing before 08:00 Riyadh');
  const first=reminders.scheduleDaily(f.db,{now:T0});
  assert.equal(first.find(x=>x.tenant_id==='36t').duplicate,false);
  assert.equal(reminders.scheduleDaily(f.db,{now:T0+3600000}).find(x=>x.tenant_id==='36t').duplicate,true,'the same day never gets a second job');
  const ran=runDue(f.db,{now:T0+1000,worker:'test'}).filter(r=>r.type==='reminders.daily');
  assert.deepEqual(ran.map(r=>r.outcome),['done']);
  const expiry=()=>f.db.prepare("SELECT user_id,title FROM notifications WHERE subject_kind='expiry' ORDER BY user_id").all();
  assert.deepEqual(expiry().map(n=>n.user_id),['employee','hr','hr2'],'the employee and the HR officers are reminded');
  assert.ok(expiry().every(n=>!n.title.includes('1234')),'no document number in the reminder');
  // «إعادة تشغيل»: المعالجات تُسجل من جديد والمؤقّت يعمل ثانية في اليوم نفسه.
  clearHandlers();reminders.registerReminderHandlers();
  assert.equal(reminders.scheduleDaily(f.db,{now:T0+2*3600000}).find(x=>x.tenant_id==='36t').duplicate,true);
  assert.equal(runDue(f.db,{now:T0+2*3600000,worker:'restarted'}).filter(r=>r.type==='reminders.daily').length,0);
  // تشغيل الدالة يدويًا لليوم نفسه لا يكرر تذكيرًا (سجل التذكيرات).
  assert.equal(f.tx(()=>reminders.runDailyReminders(f.db,'36t',day,T0)).expiry.sent,0);
  assert.equal(expiry().length,3);
  // اليوم التالي: مهمة جديدة، والوثيقة في المرحلة نفسها فلا تذكير مكرر.
  const next=T0+DAY;
  assert.equal(reminders.scheduleDaily(f.db,{now:next}).find(x=>x.tenant_id==='36t').duplicate,false);
  runDue(f.db,{now:next+1000,worker:'test'});
  assert.equal(expiry().length,3);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type='reminders.daily' AND tenant_id='36t'").get().n,2);
  assert.equal(verifyAudit(f.db),true);
});

test('daily reminders: probation report due two weeks before the end goes to the line manager; overdue decisions and the manager digest',t=>{
  const f=fixture(t);
  const day=riyadhDay(T0),start=plusDays(day,-80);
  // عقد ساري مدته التجريبية 90 يومًا: تنتهي بعد 9 أيام، فالتقرير مستحق منذ 5 أيام.
  f.db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,created_at) VALUES('pol','36t','pay_components','سياسة تجريبية','نص سياسة تجريبية لأغراض الاختبار فقط','{}','أساس تجريبي للاختبار',?,'draft','hr',?)").run(start,now());
  f.db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,created_at,updated_at) VALUES('con','36t','employee','pol','indefinite','مصممة','الرياض',?,40,90,30,'[]',100000,'SAR','ref-test','active','hr',?,?)").run(start,now(),now());
  // طلب ينتظر المدير منذ خمسة أيام.
  const service=wf.catalog(f.db,f.users.employee).find(s=>s.code==='IT-SUPPORT');
  const r=f.tx(()=>wf.createRequest(f.db,f.users.employee,{service_id:service.id,title:'حاسوب لا يعمل',payload:{issue:'لا يعمل',impact:'يمنع العمل'}}));
  f.tx(()=>wf.transition(f.db,f.users.employee,r.id,'submit',{version:r.version}));
  // الموجة 1: عمر الانتظار من لحظة وصول الخطوة إلى المعتمد لا من updated_at، والتذكير يقيسه بوقت مهمته (T0 بعد التقديم
  // بأسبوعين) بأيام العمل. تقديم updated_at إلى الآن — وهو ما يفعله زر المتابعة — لا يغيّر شيئًا، وكان يصفّر العمر.
  f.db.prepare('UPDATE requests SET updated_at=? WHERE id=?').run(new Date(T0).toISOString(),r.id);
  const result=f.tx(()=>reminders.runDailyReminders(f.db,'36t',day,T0));
  assert.equal(result.probation.sent,1);
  const probation=f.notes('manager').find(n=>n.subject_kind==='probation');
  assert.match(probation.title,/^تقرير فترة التجربة مستحق: الموظفة التجريبية$/);assert.match(probation.body,/المادة 25/);
  assert.ok(!JSON.stringify(f.notes('manager')).includes('100000'),'no pay in reminders');
  assert.equal(result.approvals.sent,1);
  assert.ok(f.notes('manager').some(n=>n.kind==='approvals_overdue'&&n.title.includes('1')&&n.body.includes('3 أيام عمل')),'the count in the title, the working-day rule in the body');
  assert.equal(result.digests.sent,1);assert.ok(f.notes('manager').some(n=>n.kind==='manager_digest'));
  assert.equal(f.tx(()=>reminders.runDailyReminders(f.db,'36t',day,T0)).probation.sent,0,'once only');
  assert.equal(reminders.reminderSettings(f.db,'36t').status,'draft');
  assert.throws(()=>f.tx(()=>reminders.setReminderSettings(f.db,f.users.hr,{pending_approval_days:5,manager_digest:true,basis:'قرار تجريبي للمالك'})),code('forbidden'));
  assert.equal(f.tx(()=>reminders.setReminderSettings(f.db,f.users.admin,{pending_approval_days:null,manager_digest:false,basis:'قرار المالك التجريبي بإيقافهما'})).status,'approved');
  assert.equal(f.tx(()=>reminders.runDailyReminders(f.db,'36t',plusDays(day,1),T0+DAY)).approvals.sent,0);
});

/* ───── الإشعارات ───── */
test('mark all as read, unread count and paging; nothing of a colleague is touched',async t=>{
  const f=fixture(t);
  for(let i=0;i<3;i++)noticeFor(f,'employee',`إشعار ${i}`);
  noticeFor(f,'outsider','إشعار الزميل');
  assert.equal(wf.unreadCount(f.db,f.users.employee).unread,3);
  assert.deepEqual(wf.unreadCount(f.db,f.users.employee).by_category,{my_requests:3});
  assert.equal(wf.notifications(f.db,f.users.employee,{limit:2}).length,2);
  const server=createApp(f.db);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const signIn=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'employee',password:PASSWORD})});
  const cookie=signIn.headers.get('set-cookie').split(';')[0],{csrf}=await signIn.json();
  const get=path=>fetch(base+path,{headers:{cookie}}).then(r=>r.json());
  assert.equal((await get('/api/notifications/unread-count')).unread,3);
  assert.equal((await get('/api/notifications?unread=1')).length,3);
  const marked=await fetch(base+'/api/notifications/read-all',{method:'POST',headers:{cookie,'x-csrf-token':csrf,'Content-Type':'application/json'},body:'{}'});
  assert.equal(marked.status,201);assert.deepEqual(await marked.json(),{marked:3});
  assert.equal((await get('/api/notifications/unread-count')).unread,0);
  assert.equal(wf.unreadCount(f.db,f.users.outsider).unread,1,'a colleague keeps his unread notice');
  assert.ok(readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8').includes('read-all-notifications'),'the page has the mark-all button');
});

test('B21 and the new modules: executors hear when a multi-step request is ready, and missions and training decisions notify',t=>{
  const f=fixture(t);
  const service=wf.catalog(f.db,f.users.employee).find(s=>s.code==='HR-LETTER');
  let r=f.tx(()=>wf.createRequest(f.db,f.users.employee,{service_id:service.id,title:'خطاب تعريف',payload:{purpose:'بنك',recipient:'بنك تجريبي'}}));
  r=f.tx(()=>wf.transition(f.db,f.users.employee,r.id,'submit',{version:r.version}));
  r=f.tx(()=>wf.transition(f.db,f.users.manager,r.id,'approve',{version:r.version}));
  assert.equal(f.notes('hr2').filter(n=>n.kind==='ready_for_execution').length,0,'not before the last step');
  r=f.tx(()=>wf.transition(f.db,f.users.hr,r.id,'approve',{version:r.version}));
  assert.equal(r.status,'approved');
  assert.equal(f.notes('hr2').filter(n=>n.kind==='ready_for_execution').length,1,'the other executor is told');
  assert.equal(f.notes('hr').filter(n=>n.kind==='ready_for_execution').length,0,'the final approver is not');
  assert.equal(f.notes('hr2').find(n=>n.kind==='ready_for_execution').category,'approvals');
  const today=riyadhDay(Date.now());
  const mission=f.tx(()=>requestMission(f.db,f.users.employee,{from_date:today,to_date:today,destination:'جدة',purpose:'زيارة عميل تجريبي للاختبار'}));
  assert.ok(f.notes('manager').some(n=>n.kind==='mission_decision_needed'&&n.subject_id===mission.id));
  f.tx(()=>decideMission(f.db,f.users.manager,mission.id,'approve',{note:'موافق'}));
  assert.equal(f.notes('employee').filter(n=>n.kind==='mission_approved'&&n.subject_id===mission.id).length,1,'integration: one decision notice, not one from each of 099 and 100');
  const training=f.tx(()=>requestTraining(f.db,f.users.employee,{title:'دورة تصميم',kind:'course',hours:8,start_date:today,end_date:today,purpose:'تطوير مهارات العمل الحالية'}));
  assert.ok(f.notes('manager').some(n=>n.kind==='training_decision_needed'));
  f.tx(()=>trainingAction(f.db,f.users.manager,training.id,'reject',{version:1,note:'الميزانية غير متاحة هذا الربع'}));
  const rejected=f.notes('employee').find(n=>n.kind==='training_rejected');
  assert.equal(rejected.category,'development');assert.ok(!rejected.body.includes('الميزانية'),'the free-text reason stays on the record');
});

/* ───── تنبيهات الأمان ───── */
test('security alerts reach platform admins: repeated failed logins, MFA reset, sensitive grant and a new admin',t=>{
  const f=fixture(t);
  const alerts=userId=>f.notes(userId).filter(n=>n.subject_kind==='security');
  for(let i=0;i<6;i++)assert.throws(()=>login(f.db,'employee','wrong-password-x','10.0.0.9'),code('invalid_credentials'));
  assert.equal(alerts('admin').length,1,'one alert at the threshold, not one per attempt');
  assert.match(alerts('admin')[0].title,/5 محاولات دخول فاشلة على الحساب employee/);
  assert.ok(!alerts('admin')[0].body.includes('10.0.0.9'),'no address in the alert');
  f.db.prepare("INSERT INTO user_totp(user_id,tenant_id,secret,recovery,enabled_at,created_at) VALUES('hr','36t','sealed','[]',?,?)").run(now(),now());
  f.tx(()=>resetTotp(f.db,f.users.admin,'hr',{reason:'فقدت الجهاز وتحققت من هويتها حضوريًا'}));
  assert.ok(alerts('admin2').some(n=>n.kind==='security_mfa_reset'));
  assert.ok(!alerts('admin').some(n=>n.kind==='security_mfa_reset'),'the actor is not alerted about his own act');
  assert.ok(f.notes('hr').some(n=>n.kind==='account_mfa_reset'),'the account owner is told');
  f.tx(()=>grantAccess(f.db,f.users.admin,{user_id:'manager',capability:'payroll.review',note:'مراجعة تجريبية'}));
  assert.ok(alerts('admin2').some(n=>n.kind==='security_sensitive_grant'&&n.title.includes('manager')));
  f.tx(()=>grantAccess(f.db,f.users.admin,{user_id:'manager',capability:'executive.view',note:'غير حساس'}));
  assert.equal(alerts('admin2').filter(n=>n.kind==='security_sensitive_grant').length,1,'a non-sensitive grant is not an alert');
  f.tx(()=>setAdminLevel(f.db,f.users.admin,'admin2',{admin_level:'super',reason:'تعيين أدمن أول ثانٍ'}));
  // الترقية إلى أدمن أول تنبّه كل مسؤولي المنصة عدا منفّذها (هنا: الحساب المرقّى نفسه وحده).
  const promoted=f.db.prepare("SELECT user_id,title,category FROM notifications WHERE kind='security_new_admin'").all();
  assert.deepEqual(promoted.map(n=>n.user_id),['admin2']);assert.match(promoted[0].title,/صلاحية إدارة جديدة للحساب admin2/);assert.equal(promoted[0].category,'security');
  assert.equal(verifyAudit(f.db),true);
});

/* ───── مهلة الخمول ───── */
test('idle timeout: a sensitive session idle past 30 minutes gets 401 session_expired, an active one does not, and other sessions have no limit until the owner sets one',t=>{
  const f=fixture(t);
  assert.deepEqual(idlePolicy(f.db,'36t'),{sensitive:30,other:null,status:'draft',basis:''},'the seed is a draft: 30 minutes for sensitive sessions, none otherwise');
  const start=Date.now();
  const hr=login(f.db,'hr',PASSWORD,'127.0.0.1'),employee=login(f.db,'employee',PASSWORD,'127.0.0.2');
  const cookie=s=>`session=${s.token}`;
  // نشاط كل 20 دقيقة يبقي الجلسة الحساسة.
  assert.equal(authenticate(f.db,cookie(hr),{now:start+20*MINUTE}).user.id,'hr');
  assert.equal(authenticate(f.db,cookie(hr),{now:start+45*MINUTE}).user.id,'hr');
  // ثم خمول 31 دقيقة: تنتهي وتُحذف.
  assert.throws(()=>authenticate(f.db,cookie(hr),{now:start+76*MINUTE}),e=>e.status===401&&e.code==='session_expired'&&e.details?.reason==='idle'&&e.message.startsWith('انتهت الجلسة لعدم النشاط'));
  assert.throws(()=>authenticate(f.db,cookie(hr),{now:start+77*MINUTE}),e=>e.code==='session_expired'&&!e.details,'the session row is gone');
  // جلسة غير حساسة: لا مهلة خمول (يبقى حد الثماني ساعات).
  assert.equal(authenticate(f.db,cookie(employee),{now:start+3*3600000}).user.id,'employee');
  // منح حساس يجعل الجلسة حساسة.
  f.tx(()=>grantAccess(f.db,f.users.admin,{user_id:'employee',capability:'payroll.review',note:'تجربة المهلة'}));
  assert.throws(()=>authenticate(f.db,cookie(employee),{now:start+3*3600000+31*MINUTE}),code('session_expired'));
  // قرار المالك: مهلة لبقية الجلسات.
  assert.throws(()=>f.tx(()=>setIdlePolicy(f.db,f.users.hr,{sensitive_minutes:15,other_minutes:60,reason:'قرار المالك التجريبي'},fail)),code('forbidden'));
  f.tx(()=>setIdlePolicy(f.db,f.users.admin,{sensitive_minutes:15,other_minutes:60,reason:'قرار المالك التجريبي'},fail));
  assert.equal(idlePolicy(f.db,'36t').status,'approved');
  const other=login(f.db,'outsider',PASSWORD,'127.0.0.3'),t1=Date.now();
  assert.equal(authenticate(f.db,cookie(other),{now:t1+59*MINUTE}).user.id,'outsider');
  assert.throws(()=>authenticate(f.db,cookie(other),{now:t1+59*MINUTE+61*MINUTE}),code('session_expired'));
  assert.ok(readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8').includes('انتهت الجلسة لعدم النشاط'),'the client shows the idle message');
  assert.equal(verifyAudit(f.db),true);
});

/* ───── ترويسات الأمان ───── */
test('security headers: COOP, cross-domain policies and origin-agent cluster on every response, CSP unchanged, HSTS only over HTTPS or a trusted proxy',async t=>{
  const f=fixture(t);
  const serve=async options=>{const server=createApp(f.db,options);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));return `http://127.0.0.1:${server.address().port}`;};
  const plain=await serve({trustProxy:false}),proxied=await serve({trustProxy:true});
  for(const path of ['/','/app.mjs','/api/me']){
    const response=await fetch(plain+path);
    assert.equal(response.headers.get('cross-origin-opener-policy'),'same-origin',path);
    assert.equal(response.headers.get('x-permitted-cross-domain-policies'),'none',path);
    assert.equal(response.headers.get('origin-agent-cluster'),'?1',path);
    assert.equal(response.headers.get('content-security-policy'),"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",path);
    assert.equal(response.headers.get('x-frame-options'),'DENY');
    assert.equal(response.headers.get('strict-transport-security'),null,'no HSTS on plain local HTTP');
  }
  assert.equal((await fetch(plain+'/',{headers:{'x-forwarded-proto':'https'}})).headers.get('strict-transport-security'),null,'an untrusted forwarded header is ignored');
  assert.equal((await fetch(proxied+'/',{headers:{'x-forwarded-proto':'https'}})).headers.get('strict-transport-security'),'max-age=31536000; includeSubDomains');
  assert.equal((await fetch(proxied+'/')).headers.get('strict-transport-security'),null,'a trusted proxy on plain HTTP still gets none');
});
