import { transaction } from './db.mjs';
import { registerHandler, hasHandler, enqueue } from './jobs.mjs';
import { riyadhParts } from './reminders.mjs';
import { applyDueChanges } from './employees.mjs';
import { actorOrRefuse } from './refusal.mjs';
import { adoptedTimerRows, timersBoard, TIMER_KEYS, NOT_ADOPTED } from './workflow-timers.mjs';
import { sweepApprovals, stuckApprovals } from './step-escalation.mjs';
import { sweepReturned } from './returned-requests.mjs';
import { sweepDepartedWork, heldWorkBoard } from './request-assignment.mjs';
import { undeliverableBoard, undeliverableOpenCount } from './notice-recipients.mjs';
import { unsealedCounts, sealingNotice } from './crypto-fields.mjs';

// التشغيل اليومي لمحرك العمل (الموجة 2، العطب 9): كان لا شيء في المنصة يتصرف بناءً على التأخر. مهمة workflow.sweep مرة لكل كيان
// في اليوم، عند 08:00 بتوقيت الرياض أو بعدها، بجانب reminders.daily لا داخلها: نوع مستقل بمفتاحه، فعطل هنا لا يُسقط تذكير
// الوثائق وفترة التجربة، وتلك لا تُسقط هذه. القواعد:
//   • تعمل من الحالة لا من الأحداث: «كم مضى على هذا الآن؟» لا «ماذا حدث أمس؟». يوم فائت لا يضيع معه شيء.
//   • لا تقرأ إلا المهل المتبناة (adoptedTimerRows). بلا مهلة متبناة لا تذكّر ولا تصعّد ولا تُسقط، وتقول ذلك في نتيجتها.
//     ما تفعله بلا مهلة حقيقتان لا عتبتان: حساب موقوف يحمل عملًا يعود عمله إلى الطابور، وخطوة صاحب قرارها موقوف يُنقل قرارها.
//   • لا تقرأ requests.updated_at أبدًا: العمر من وصول الخطوة (stepArrivedAt) ومن لحظة الإعادة.
//   • مرتان = مرة: صف التصعيد يصفّر عمر الخطوة، والانقضاء يغيّر الحالة، وكل تذكير بمفتاح في reminder_log.
//   • كل أثر بسطر تدقيق باسم صاحب المهمة (السجل يشترط فاعلًا) ومعه by:'workflow-sweep' وtimer_row_id، فيُقرأ أنه الآلة وبأي قرار.
//   • المعاملة واحدة للمهمة (jobs.execute): إما أثر اليوم كله وعلامة «done»، وإما لا شيء ويُعاد.
// لا يقرأ هذا التشغيل reminder_settings.pending_approval_days: تلك قيمة لها افتراضي (3) يسري وهي «مسودة»، فلا تُبنى عليها أتمتة.
export const SWEEP_JOB='workflow.sweep';
const SWEEP_MINUTE=8*60;
const iso=time=>new Date(time).toISOString();

/* ───── الاحتفاظ: أول قاعدة احتفاظ تُطبَّق فعلًا على المنصة ─────────────────────
   قبل هذا لم يكن في المستودع `DELETE FROM sessions` واحد: الجلسة تنتهي فتُصفّى من القراءة
   (`expires_at>?` في authenticate) وتبقى في القاعدة إلى الأبد ومعها user_id وcsrf **وعنوان العميل**.
   وصفوف login_attempts تنظيفها كسول لا يقع إلا عند ملامسة المفتاح نفسه، فيبقى ما لا يُلامَس.
   المقيس على قاعدة التشغيل يوم كتابة هذا: 30 جلسة منتهية من 31، و15 صفّ محاولات أقدمها من 13 يومًا.

   المدد أدناه **قابلة للضبط** وهي في موضع واحد. ما تعنيه:
     • expired_session_days: مهلة بعد الانتهاء تُبقى فيها الجلسة لأثر الحوادث، ثم تُحذف. الجلسة تنتهي بعد 8 ساعات
       من فتحها (auth.mjs)، فسبعة أيام بعدها هامش واسع لمن يسأل «من دخل من أين» ولم يصل إلى سجل التدقيق بعد.
     • login_attempt_minutes: نافذة العدّ نفسها ربع ساعة (auth.mjs)، وما بعدها لا يُقرأ أصلًا. ساعةٌ كاملة هامشٌ
       يجعل الحذف بعيدًا عن أي عدّ جارٍ، ولا يجوز أن ينزل دون خمس عشرة دقيقة وإلا حُذف عدّاد يعمل.
   ولا يُمسّ سجل التدقيق: هو محميّ بمُطلِقين (audit_no_update وaudit_no_delete) ولا قاعدة احتفاظ عليه. */
export const RETENTION={expired_session_days:7, login_attempt_minutes:60};
export function sweepRetention(db,{now:at=Date.now(),retention=RETENTION}={}){
  const minutes=Math.max(15,retention.login_attempt_minutes);
  // الجدولان ليسا لكيان بعينه (لا tenant_id فيهما): الكنس على مستوى المنصة، ومن يصل أولًا من كيانات
  // اليوم يحذف، وما بعده يجد صفرًا. تكرارُه لا يضرّ — حذفُ ما مضى عليه الأمد لا يعتمد على من نفّذه.
  return {
    expired_sessions_deleted:db.prepare('DELETE FROM sessions WHERE expires_at<?').run(at-retention.expired_session_days*86400000).changes,
    login_attempts_deleted:db.prepare('DELETE FROM login_attempts WHERE window_start<?').run(at-minutes*60000).changes,
    policy:{expired_session_days:retention.expired_session_days,login_attempt_minutes:minutes,audit_events:'لا تُحذف'},
  };
}

export function runWorkflowSweep(db,tenantId,date,auditor,at=Date.now()){
  // التغييرات الوظيفية المعتمدة التي حلّ تاريخها تُطبَّق هنا يوميًا (وعند اعتمادها إن حلّ تاريخها، وبطلب صريح من السجل الوظيفي)،
  // فمن كان آخر يوم له أمس يُوقف حسابه اليوم. فتح شاشة الموظفين لا يطبّق شيئًا (الحزمة 4، P4-HR-1)، وما لم يُعتمد لا يسري.
  const applied=applyDueChanges(db,tenantId);
  const timers=adoptedTimerRows(db,tenantId),adopted=Object.fromEntries(Object.entries(timers).map(([key,row])=>[key,{value:row.value,timer_row_id:row.id}]));
  const departed=sweepDepartedWork(db,tenantId,auditor);
  const approvals=sweepApprovals(db,tenantId,auditor,timers);
  const returned=sweepReturned(db,tenantId,auditor,timers,at);
  const acted={employee_changes_applied:applied,departed_work_returned:departed.returned,steps_moved_timeout:approvals.timeout.escalated,steps_moved_unqualified:approvals.unqualified.escalated,
    steps_blocked:approvals.timeout.blocked+approvals.unqualified.blocked,returned_reminded:returned.reminded_first+returned.reminded_second,returned_lapsed:returned.lapsed};
  const none=!Object.keys(adopted).length,failures=[...(departed.failures??[]),...(approvals.failures??[]),...(returned.failures??[])];
  // الاحتفاظ وحالة ختم الحقول بنداهما بجانب ما «فُعل» لا داخله: acted عمّا فعلته المهل، وهذان عن حالة القاعدة.
  // وكلاهما يتراجع وحده إن تعذّر، فلا يُسقط يوم التصعيدات والتذكيرات ما هو تنظيفٌ ونظر.
  let retention=null,sealing=null;
  try{retention=sweepRetention(db,{now:at});}catch(error){failures.push({item:'retention',error:String(error?.message??error)});}
  try{
    const open=unsealedCounts(db).filter(f=>f.rows>0),notice=sealingNotice(db);
    sealing={unsealed:open.reduce((n,f)=>n+f.rows,0),fields:open.map(f=>({field:`${f.table}.${f.column}`,rows:f.rows})),notice};
    // يُقال بصوت مسموع كما يُقال تنبيه المفتاح عند الإقلاع (server.mjs يطبع keyNotice)، فلا يمرّ صامتًا
    // إلى أن يفتح أحدٌ نتيجة المهمة. مرة في اليوم، فلا يغرق السجل.
    if(notice)console.warn(notice);
  }catch(error){failures.push({item:'field_sealing',error:String(error?.message??error)});}
  return {date,adopted,acted,detail:{departed,approvals,returned},undeliverable_open:undeliverableOpenCount(db,tenantId),
    ...(retention?{retention}:{}),...(sealing?{field_sealing:sealing}:{}),
    // بند تعذّر يتراجع وحده ويُذكر هنا باسمه؛ بقية اليوم تمضي. لا يُخفى: يظهر في «إعداد الاعتماد» وفي نتيجة المهمة.
    ...(failures.length?{failures}:{}),
    not_adopted:Object.entries(TIMER_KEYS).filter(([key,spec])=>spec.wired&&!adopted[key]).map(([key,spec])=>({key,name:spec.name,state:NOT_ADOPTED})),
    ...(none?{note:'لا مهلة متبناة؛ لم يُفعل شيء بناءً على مهلة. ما عُولج اليوم، إن وُجد، حسابات موقوفة تحمل عملًا أو قرارًا.'}:{})};
}
export function registerSweepHandlers(){
  if(!hasHandler(SWEEP_JOB))registerHandler(SWEEP_JOB,(db,job,context)=>runWorkflowSweep(db,job.tenant_id,job.payload.date,context.user,context.now));
}
// يُستدعى من مؤقّت الخادم كل دقيقة مع scheduleDaily. المهمة باسم أول أدمن أول نشط: لا مهمة بلا صاحب، وهو من يُسجَّل باسمه التدقيق.
export function scheduleSweep(db,{now:at=Date.now()}={}){
  const {date,minutes}=riyadhParts(at),out=[];
  if(minutes<SWEEP_MINUTE||!hasHandler(SWEEP_JOB))return out;
  for(const {id:tenantId} of db.prepare('SELECT id FROM tenants ORDER BY id').all()){
    const owner=db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role='admin' AND admin_level='super' ORDER BY id LIMIT 1").get(tenantId);
    if(!owner)continue;
    out.push({tenant_id:tenantId,...transaction(db,()=>enqueue(db,owner,{type:SWEEP_JOB,payload:{date},idempotency_key:`${SWEEP_JOB}:${date}`,source:{entity:'schedule',id:`workflow-sweep-0800:${date}`},due_at:iso(at),max_attempts:3}))});
  }
  return out;
}
export function lastSweep(db,tenantId){
  const row=db.prepare('SELECT payload,status,result,last_error,finished_at FROM jobs WHERE tenant_id=? AND type=? ORDER BY created_at DESC LIMIT 1').get(tenantId,SWEEP_JOB);
  return row?{date:JSON.parse(row.payload).date,status:row.status,result:row.result?JSON.parse(row.result):null,last_error:row.last_error,finished_at:row.finished_at}:null;
}

// ── لوحة «مهل محرك العمل وما يتوقف عليها» داخل «إعداد الاعتماد» ────────────────────
// المهل لكل من يفتح الشاشة؛ وما يخص من يدير الهيكل (خطوات تنتظر من يسمّي صاحب قرارها، وعمل عند حساب موقوف، وإشعارات بلا مستلم) له وحده.
export function workflowControl(db,supplied){
  const u=actorOrRefuse(db,supplied),last=lastSweep(db,u.tenant_id);
  return {...timersBoard(db,u),stuck_approvals:stuckApprovals(db,u),held_work:heldWorkBoard(db,u),undeliverable:undeliverableBoard(db,u),
    last_sweep:last,sweep_note:last?`آخر تشغيل يومي: ${last.date} — ${last.status==='done'?'نُفذ':last.status}${last.result?.failures?.length?`، وتعذّر فيه ${last.result.failures.length} بند يحتاج نظر مسؤول المنصة`:''}.`:'لم يُشغَّل التشغيل اليومي بعد. يعمل مرة يوميًا عند الثامنة صباحًا بتوقيت الرياض ما دام الخادم يشغّل مؤقّته.'};
}
