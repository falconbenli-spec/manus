import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { notifySubject, dayName } from './notices.mjs';
import { riyadhDateOf } from './riyadh-time.mjs';

// اللقاءات الفردية والتغذية الراجعة المستمرة وتقييم 360.
// تبني فوق دورات التقييم في app/talent.mjs ولا تعدّلها: التقييم 360 خيار داخل الدورة القائمة، والملاحظات أدلة للمقيِّم لا أرقام.
// ثلاث قواعد تحكم كل ما في هذا الملف: محتوى اللقاء بين طرفيه، والملاحظة ملك كاتبها ومستلمها، والتقييم الصاعد لا يُكشف مصدره.
const CAP='hr.feedback.manage';
export const FEEDBACK_KINDS=[['appreciation','تقدير'],['improvement','اقتراح تحسين']].map(([key,name])=>({key,name}));
export const VISIBILITY=[['recipient','للمستلم فقط'],['recipient_manager','للمستلم ومديره'],['public','علنية داخل الكيان']].map(([key,name])=>({key,name}));
export const SOURCES=[['self','تقييم ذاتي'],['peer','تقييم الأقران'],['upward','تقييم صاعد من الفريق']].map(([key,name])=>({key,name}));
export const DEVELOPMENT_ONLY='هذه أدوات تطوير لا أدوات قرار إداري آلي: لا تُحتسب ملاحظة ولا استجابة في درجة، ولا يُرتب بها أحد. كل قرار توظيفي — راتب أو ترقية أو إنهاء خدمة — قرار بشري موثق في شاشته ومسؤولية من اتخذه.';
const MEETING_STATES={scheduled:'مجدول',held:'انعقد',cancelled:'ألغي'};
const ITEM_STATES={open:'مفتوح',done:'أُنجز',dropped:'أُسقط'};
const NOMINATION_STATES={proposed:'بانتظار اعتماد طرف ثالث',approved:'معتمد',rejected:'مرفوض'};
const CYCLE_STATES={draft:'مسودة',open:'مفتوحة للتقييم',calibration:'في المعايرة',released:'صدرت النتائج'};
const KIND_NAMES=Object.fromEntries(FEEDBACK_KINDS.map(k=>[k.key,k.name]));
const VISIBILITY_NAMES=Object.fromEntries(VISIBILITY.map(k=>[k.key,k.name]));
const SOURCE_NAMES=Object.fromEntries(SOURCES.map(s=>[s.key,s.name]));

const id=()=>randomUUID();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','هذه الشاشة لحسابات الموظفين');u.feedback_manage=holds(db,u,CAP);return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
// D-21 (تدقيق مسارات الوحدات، 20 سبتمبر): هذا الملف كان بلا أي استدعاء إشعار — تسعة أحداث تصل لا أحد،
// فاللقاء المجدول لا يعرف به الطرف الآخر حتى يفتح الشاشة صدفة، والملاحظة تُكتب عن زميل فلا يعلم بها.
// القاعدة هنا كقاعدة بقية المنصة: العنوان يقول ما حدث، والمتن يقول الخطوة التالية أو أين يُقرأ التفصيل.
// ولا ينتقل نص ملاحظة ولا محضر ولا أجندة إلى الإشعار: مرئيتها محسوبة في استعلامها وحده.
// والتقييم الصاعد استثناء مقصود: لا إشعار عند الإرسال ولا عنه، حفاظًا على عدم ربط استجابة بمرسلها.
function tell(db,userId,actorId,subjectKind,subjectId,kind,title,body){
  if(!userId||userId===actorId)return;
  notifySubject(db,{userId,kind,subjectKind,subjectId,title,body});
}
function versioned(row,input){if(!Number.isInteger(input?.version)||input.version!==row.version)fail(409,'stale_version','تغير السجل منذ فتحه. أعد التحميل');}
function person(db,u,userId){const p=typeof userId==='string'&&db.prepare("SELECT id,name,manager_id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(userId,u.tenant_id);if(!p)fail(404,'not_found','الموظف غير متاح');return p;}
const reports=(db,u,userId)=>db.prepare("SELECT id,name,manager_id FROM users WHERE tenant_id=? AND manager_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id,userId);

// ================= اللقاءات الفردية =================
// من ليس طرفًا في اللقاء لا يصل إلى صفه أصلًا، ولو حمل تصريح الموارد البشرية: خطأ «غير متاح» لا «ممنوع».
function meetingRow(db,u,meetingId){
  const m=typeof meetingId==='string'&&db.prepare('SELECT * FROM one_to_ones WHERE id=? AND tenant_id=?').get(meetingId,u.tenant_id);
  if(!m||(m.employee_id!==u.id&&m.manager_id!==u.id))fail(404,'not_found','اللقاء غير متاح: محتواه بين طرفيه');
  return m;
}
function meetingView(db,u,m){
  const side=m.employee_id===u.id?'employee':'manager',other=side==='employee'?m.manager_id:m.employee_id;
  const agenda=db.prepare('SELECT a.id,a.topic,a.author_id,x.name AS author_name FROM one_to_one_agenda_items a JOIN users x ON x.id=a.author_id WHERE a.meeting_id=? ORDER BY a.created_at').all(m.id);
  const items=db.prepare("SELECT f.*,x.name AS owner_name FROM one_to_one_follow_ups f JOIN users x ON x.id=f.owner_id WHERE f.meeting_id=? ORDER BY f.status<>'open',f.due_date").all(m.id)
    .map(f=>({id:f.id,item:f.item,due_date:f.due_date,owner_name:f.owner_name,mine:f.owner_id===u.id,status:f.status,status_name:ITEM_STATES[f.status],closing_note:f.closing_note,version:f.version,
      overdue:f.status==='open'&&f.due_date<today(),actions:f.status==='open'&&f.owner_id===u.id?['complete_item','drop_item']:[]}));
  const actions=m.status==='scheduled'?['add_agenda','add_follow_up','save_private_note','record_held','cancel_meeting']:[];
  return {id:m.id,scheduled_on:m.scheduled_on,status:m.status,status_name:MEETING_STATES[m.status],my_side:side,
    employee_name:name(db,m.employee_id),manager_name:name(db,m.manager_id),other_id:other,other_name:name(db,other),
    agenda:agenda.map(a=>({id:a.id,topic:a.topic,author_name:a.author_name,mine:a.author_id===u.id})),
    shared_notes:m.shared_notes,
    // الملاحظة الخاصة تُقرأ من عمود صاحبها وحده: عمود الطرف الآخر لا يغادر قاعدة البيانات.
    my_private_note:side==='employee'?m.employee_private_note:m.manager_private_note,
    held_at:m.held_at,closed_by_name:name(db,m.closed_by),cancel_reason:m.cancel_reason,follow_ups:items,version:m.version,actions};
}
// ما تراه الموارد البشرية: انعقاد اللقاء وموعده من العرض الذي لا يحمل نصًا. لا أجندة ولا محضر ولا ملاحظة خاصة.
function cadence(db,u){
  const rows=db.prepare('SELECT employee_id,manager_id,status,scheduled_on,held_at FROM one_to_one_cadence WHERE tenant_id=? ORDER BY scheduled_on DESC').all(u.tenant_id);
  const people=db.prepare("SELECT id,name,manager_id FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND manager_id IS NOT NULL ORDER BY name").all(u.tenant_id);
  const day=today();
  return {rows:people.map(p=>{
      const mine=rows.filter(r=>r.employee_id===p.id),held=mine.filter(r=>r.status==='held'),last=riyadhDateOf(held[0]?.held_at);
      return {employee_name:p.name,manager_name:name(db,p.manager_id),held_count:held.length,last_held_on:last,
        days_since_last:last?Math.max(0,Math.round((Date.parse(day)-Date.parse(last))/86400000)):null,
        next_scheduled_on:mine.filter(r=>r.status==='scheduled'&&r.scheduled_on>=day).at(-1)?.scheduled_on??null,
        never_held:!held.length};}),
    note:'انعقاد ومواعيد فقط، مقروءة من عرض `one_to_one_cadence` الذي لا يحمل أعمدة المحتوى. لا تصل الموارد البشرية إلى أجندة اللقاء ولا محضره ولا الملاحظات الخاصة، ولا وسيلة في هذه الشاشة لطلبها.'};
}
export function openFollowUps(db,supplied){
  const u=actor(db,supplied),day=today();
  return db.prepare(`SELECT f.id,f.item,f.due_date,m.scheduled_on,
      CASE WHEN m.employee_id=? THEN g.name ELSE e.name END AS counterpart_name
    FROM one_to_one_follow_ups f JOIN one_to_ones m ON m.id=f.meeting_id
    JOIN users g ON g.id=m.manager_id JOIN users e ON e.id=m.employee_id
    WHERE f.tenant_id=? AND f.owner_id=? AND f.status='open' ORDER BY f.due_date`).all(u.id,u.tenant_id,u.id)
    .map(f=>({...f,overdue:f.due_date<day,link:'#one-to-ones'}));
}
export function oneToOnesBoard(db,supplied){
  const u=actor(db,supplied);
  const rows=db.prepare('SELECT * FROM one_to_ones WHERE tenant_id=? AND (employee_id=? OR manager_id=?) ORDER BY scheduled_on DESC,created_at DESC LIMIT 100').all(u.tenant_id,u.id,u.id);
  const manager=u.manager_id?db.prepare("SELECT id,name FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(u.manager_id,u.tenant_id)??null:null;
  return {today:today(),user_id:u.id,can_read_cadence:u.feedback_manage,
    meetings:rows.map(m=>meetingView(db,u,m)),team:reports(db,u,u.id),my_manager:manager,
    counterparts:[...(manager?[{id:manager.id,name:`${manager.name} (مديري)`}]:[]),...reports(db,u,u.id).map(p=>({id:p.id,name:p.name}))],
    my_open_items:openFollowUps(db,u),cadence:u.feedback_manage?cadence(db,u):null,
    privacy:'الخصوصية هي القاعدة: الأجندة والمحضر والملاحظات بين طرفي اللقاء وحدهما. الموارد البشرية ترى أن اللقاء انعقد ومتى، لا ما قيل فيه. الملاحظة الخاصة لكل طرف لا يراها الطرف الآخر.',
    note:DEVELOPMENT_ONLY};
}
export function scheduleOneToOne(db,supplied,input){
  writing(db);const u=actor(db,supplied);v.object(input,['counterpart_id','scheduled_on']);
  const other=person(db,u,input.counterpart_id),asManager=other.manager_id===u.id,asEmployee=u.manager_id===other.id;
  if(!asManager&&!asEmployee)fail(403,'not_permitted','اللقاء الفردي بينك وبين مديرك المباشر أو أحد من يرفعون لك');
  const day=v.date(input.scheduled_on);if(day<today())fail(400,'scheduled_on','موعد اللقاء اليوم أو بعده');
  const employeeId=asManager?other.id:u.id,managerId=asManager?u.id:other.id;
  if(db.prepare("SELECT 1 FROM one_to_ones WHERE tenant_id=? AND employee_id=? AND manager_id=? AND scheduled_on=? AND status='scheduled'").get(u.tenant_id,employeeId,managerId,day))fail(409,'duplicate_meeting','بينكما لقاء مجدول في اليوم نفسه');
  const meetingId=id(),time=now();
  db.prepare("INSERT INTO one_to_ones(id,tenant_id,employee_id,manager_id,scheduled_on,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'scheduled',?,?,?)").run(meetingId,u.tenant_id,employeeId,managerId,day,u.id,time,time);
  // سجل التدقيق يحفظ الموعد والطرفين فقط: محتوى اللقاء لا يدخل السجل.
  audit(db,u,'one_to_one',meetingId,'one_to_one.scheduled',{},{employee_id:employeeId,manager_id:managerId,scheduled_on:day});
  tell(db,other.id,u.id,'one_to_one',meetingId,'one_to_one_scheduled',`لقاء فردي مجدول مع ${u.name} ${dayName(day)}`,'افتح «اللقاءات الفردية» لإضافة بنودك إلى الأجندة قبل الموعد.');
  return {id:meetingId};
}
export function meetingAction(db,supplied,meetingId,action,input){
  writing(db);const u=actor(db,supplied),m=meetingRow(db,u,meetingId);versioned(m,input);
  if(!meetingView(db,u,m).actions.includes(action))fail(409,'invalid_state','الإجراء غير متاح في حالة اللقاء أو لحسابك');
  const time=now(),bump=(fields,values)=>db.prepare(`UPDATE one_to_ones SET ${fields}${fields?',':''}version=version+1,updated_at=? WHERE id=?`).run(...values,time,m.id);
  if(action==='add_agenda'){
    v.object(input,['version','topic']);
    db.prepare('INSERT INTO one_to_one_agenda_items(id,meeting_id,author_id,topic,created_at) VALUES(?,?,?,?,?)').run(id(),m.id,u.id,v.text(input.topic,'بند الأجندة',600,3),time);
    bump('',[]);
  }else if(action==='save_private_note'){
    v.object(input,['version','note']);
    bump(`${m.employee_id===u.id?'employee_private_note':'manager_private_note'}=?`,[v.text(input.note,'ملاحظتك الخاصة',3000,3)]);
  }else if(action==='add_follow_up'){
    v.object(input,['version','item','due_date','owner_id']);
    const owner=person(db,u,input.owner_id).id;
    if(![m.employee_id,m.manager_id].includes(owner))fail(400,'owner_id','مالك البند أحد طرفي اللقاء');
    const due=v.date(input.due_date);if(due<today())fail(400,'due_date','موعد البند اليوم أو بعده');
    const itemId=id();
    db.prepare("INSERT INTO one_to_one_follow_ups(id,tenant_id,meeting_id,owner_id,item,due_date,status,created_by,created_at) VALUES(?,?,?,?,?,?,'open',?,?)").run(itemId,u.tenant_id,m.id,owner,v.text(input.item,'بند المتابعة',600,5),due,u.id,time);
    tell(db,owner,u.id,'follow_up_item',itemId,'follow_up_assigned',`أُسند إليك بند متابعة من لقائكما الفردي، موعده ${dayName(due)}`,'افتح «اللقاءات الفردية» لقراءة البند وإقفاله عند إنجازه.');
    bump('',[]);
  }else if(action==='record_held'){
    v.object(input,['version','shared_notes']);
    bump("shared_notes=?,status='held',held_at=?,closed_by=?",[v.text(input.shared_notes,'محضر اللقاء المشترك',6000,20),time,u.id]);
  }else{
    v.object(input,['version','reason']);
    bump("status='cancelled',cancel_reason=?",[v.text(input.reason,'سبب الإلغاء',600,5)]);
  }
  audit(db,u,'one_to_one',m.id,'one_to_one.'+action,{status:m.status},{});
  const other=m.employee_id===u.id?m.manager_id:m.employee_id;
  if(action==='add_agenda')tell(db,other,u.id,'one_to_one',m.id,'one_to_one_agenda_added',`أُضيف بند إلى أجندة لقائكما ${dayName(m.scheduled_on)}`,'افتح «اللقاءات الفردية» لقراءته قبل الموعد.');
  else if(action==='record_held')tell(db,other,u.id,'one_to_one',m.id,'one_to_one_held',`سُجل محضر لقائكما ${dayName(m.scheduled_on)}`,'افتح «اللقاءات الفردية» لقراءة المحضر وبنود المتابعة.');
  else if(action==='cancel_meeting')tell(db,other,u.id,'one_to_one',m.id,'one_to_one_cancelled',`أُلغي لقاؤكما الفردي ${dayName(m.scheduled_on)}`,'سبب الإلغاء في «اللقاءات الفردية».');
  return {id:m.id};
}
export function followUpAction(db,supplied,itemId,action,input){
  writing(db);const u=actor(db,supplied);
  const f=typeof itemId==='string'&&db.prepare('SELECT * FROM one_to_one_follow_ups WHERE id=? AND tenant_id=?').get(itemId,u.tenant_id);
  if(!f||f.owner_id!==u.id)fail(404,'not_found','البند غير متاح: يقفله مالكه');
  versioned(f,input);v.object(input,['version','note']);
  if(f.status!=='open')fail(409,'invalid_state','البند مقفل');
  if(!['complete_item','drop_item'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  db.prepare('UPDATE one_to_one_follow_ups SET status=?,closing_note=?,closed_at=?,version=version+1 WHERE id=?').run(action==='complete_item'?'done':'dropped',v.text(input.note,'ما الذي أُنجز أو لماذا أُسقط',1000,5),now(),f.id);
  audit(db,u,'one_to_one_follow_up',f.id,'follow_up.'+action,{status:f.status},{});
  const m=db.prepare('SELECT employee_id,manager_id,scheduled_on FROM one_to_ones WHERE id=?').get(f.meeting_id);
  if(m)tell(db,m.employee_id===u.id?m.manager_id:m.employee_id,u.id,'follow_up_item',f.id,'follow_up_closed',
    `${action==='complete_item'?'أُنجز':'أُسقط'} بند متابعة من لقائكما ${dayName(m.scheduled_on)}`,'التفصيل في «اللقاءات الفردية».');
  return {id:f.id};
}

// ================= التغذية الراجعة المستمرة =================
// المرئية مفروضة في الاستعلام: الملاحظة تصل كاتبها ومستلمها دائمًا، ومدير المستلم إن سمحت مرئيتها، والبقية إن كانت علنية.
// لا استثناء للموارد البشرية: من لا تشمله المرئية لا يقرأ الملاحظة مهما كان تصريحه.
// B18: «مدير المستلم» هو من كان مديره وقت الكتابة (visible_manager_id، ترحيل 106)، لا من صار مديره بعدها.
// COALESCE للصفوف السابقة على الترحيل وحدها: لا مدير مثبتًا لها، فتقرأ بالسلوك القديم بدل أن تختفي.
const VISIBLE_NOTES=`SELECT n.*,a.name AS author_name,s.name AS subject_name FROM feedback_notes n
  JOIN users a ON a.id=n.author_id JOIN users s ON s.id=n.subject_id
  WHERE n.tenant_id=? AND (n.author_id=? OR n.subject_id=? OR n.visibility='public' OR (n.visibility='recipient_manager' AND COALESCE(n.visible_manager_id,s.manager_id)=?))
    AND (n.withdrawn_at IS NULL OR n.author_id=? OR n.subject_id=?)`;
const noteParams=u=>[u.tenant_id,u.id,u.id,u.id,u.id,u.id];
function noteView(u,n){
  return {id:n.id,kind:n.kind,kind_name:KIND_NAMES[n.kind],visibility:n.visibility,visibility_name:VISIBILITY_NAMES[n.visibility],body:n.body,occurred_on:n.occurred_on,
    author_name:n.author_name,subject_name:n.subject_name,mine:n.author_id===u.id,about_me:n.subject_id===u.id,
    from_request:!!n.request_id,withdrawn:!!n.withdrawn_at,withdrawal_reason:n.withdrawal_reason,version:n.version,
    actions:n.author_id===u.id&&!n.withdrawn_at?['withdraw_note']:[]};
}
export function feedbackBoard(db,supplied){
  const u=actor(db,supplied);
  const notes=db.prepare(`${VISIBLE_NOTES} ORDER BY n.occurred_on DESC,n.created_at DESC LIMIT 200`).all(...noteParams(u)).map(n=>noteView(u,n));
  const toMe=db.prepare("SELECT r.*,x.name AS requester_name FROM feedback_requests r JOIN users x ON x.id=r.requester_id WHERE r.tenant_id=? AND r.respondent_id=? ORDER BY r.status<>'open',r.created_at DESC LIMIT 50").all(u.tenant_id,u.id)
    .map(r=>({id:r.id,question:r.question,counterpart_name:r.requester_name,status:r.status,decline_reason:r.decline_reason,version:r.version,actions:r.status==='open'?['answer_request','decline_request']:[]}));
  const mine=db.prepare("SELECT r.*,x.name AS respondent_name FROM feedback_requests r JOIN users x ON x.id=r.respondent_id WHERE r.tenant_id=? AND r.requester_id=? ORDER BY r.status<>'open',r.created_at DESC LIMIT 50").all(u.tenant_id,u.id)
    .map(r=>({id:r.id,question:r.question,counterpart_name:r.respondent_name,status:r.status,decline_reason:r.decline_reason,version:r.version,actions:[]}));
  return {today:today(),user_id:u.id,kinds:FEEDBACK_KINDS,visibility_options:VISIBILITY,
    colleagues:db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id),
    notes,received:notes.filter(n=>n.about_me).length,given:notes.filter(n=>n.mine).length,
    requests_to_me:toMe,my_requests:mine,evidence:reviewEvidence(db,u),
    ownership:'الملاحظة ملك كاتبها ومستلمها. لا يراها غيرهما إلا بما تسمح به مرئيتها المكتوبة وقت كتابتها، ولا تُوسَّع المرئية بعد الكتابة. الموارد البشرية ليست استثناءً.',
    note:DEVELOPMENT_ONLY};
}
export function writeFeedback(db,supplied,input){
  writing(db);const u=actor(db,supplied);v.object(input,['subject_id','kind','visibility','body','occurred_on']);
  const subject=person(db,u,input.subject_id);
  if(subject.id===u.id)fail(409,'separation_of_duties','الملاحظة تُكتب عن غيرك لا عن نفسك');
  if(!FEEDBACK_KINDS.some(k=>k.key===input.kind))fail(400,'kind','اختر نوع الملاحظة');
  if(!VISIBILITY.some(k=>k.key===input.visibility))fail(400,'visibility','اختر من يرى الملاحظة');
  const day=v.date(input.occurred_on);if(day>today())fail(400,'occurred_on','الملاحظة عن واقعة حدثت: تاريخها اليوم أو قبله');
  const noteId=id();
  db.prepare('INSERT INTO feedback_notes(id,tenant_id,author_id,subject_id,kind,visibility,body,occurred_on,visible_manager_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(noteId,u.tenant_id,u.id,subject.id,input.kind,input.visibility,v.text(input.body,'نص الملاحظة',4000,15),day,
      input.visibility==='recipient_manager'?subject.manager_id??null:null,now());
  // نص الملاحظة لا يدخل سجل التدقيق: السجل يثبت الواقعة ومرئيتها، والنص يبقى لمن تشملهم المرئية.
  audit(db,u,'feedback_note',noteId,'feedback.written',{},{subject_id:subject.id,kind:input.kind,visibility:input.visibility});
  // نص الملاحظة لا يدخل الإشعار: الملاحظة نفسها في شاشتها بقاعدة مرئيتها.
  tell(db,subject.id,u.id,'feedback_note',noteId,'feedback_received',`كتب ${u.name} ملاحظة عنك`,'اقرأها في «ملاحظات الزملاء».');
  return {id:noteId};
}
export function noteAction(db,supplied,noteId,action,input){
  writing(db);const u=actor(db,supplied);
  const n=typeof noteId==='string'&&db.prepare('SELECT * FROM feedback_notes WHERE id=? AND tenant_id=?').get(noteId,u.tenant_id);
  if(!n||n.author_id!==u.id)fail(404,'not_found','الملاحظة غير متاحة: يسحبها كاتبها وحده');
  if(action!=='withdraw_note')fail(404,'not_found','الإجراء غير متاح');
  versioned(n,input);v.object(input,['version','reason']);
  if(n.withdrawn_at)fail(409,'invalid_state','الملاحظة مسحوبة');
  db.prepare('UPDATE feedback_notes SET withdrawn_at=?,withdrawal_reason=?,version=version+1 WHERE id=?').run(now(),v.text(input.reason,'سبب السحب',600,5),n.id);
  audit(db,u,'feedback_note',n.id,'feedback.withdrawn',{},{subject_id:n.subject_id});
  tell(db,n.subject_id,u.id,'feedback_note',n.id,'feedback_withdrawn','سحب كاتبها ملاحظة كانت عنك','سبب السحب في «ملاحظات الزملاء».');
  return {id:n.id};
}
export function requestFeedback(db,supplied,input){
  writing(db);const u=actor(db,supplied);v.object(input,['respondent_id','question']);
  const other=person(db,u,input.respondent_id);
  if(other.id===u.id)fail(409,'separation_of_duties','تطلب الرأي من زميل لا من نفسك');
  if(db.prepare("SELECT 1 FROM feedback_requests WHERE tenant_id=? AND requester_id=? AND respondent_id=? AND status='open'").get(u.tenant_id,u.id,other.id))fail(409,'duplicate_request','لديك طلب مفتوح لدى هذا الزميل');
  const requestId=id();
  db.prepare("INSERT INTO feedback_requests(id,tenant_id,requester_id,respondent_id,question,status,created_at) VALUES(?,?,?,?,?,'open',?)").run(requestId,u.tenant_id,u.id,other.id,v.text(input.question,'سؤالك المحدد',1000,10),now());
  audit(db,u,'feedback_request',requestId,'feedback.requested',{},{respondent_id:other.id});
  tell(db,other.id,u.id,'feedback_request',requestId,'feedback_request_received',`طلب ${u.name} رأيك`,'افتح «ملاحظات الزملاء» للإجابة أو الاعتذار.');
  return {id:requestId};
}
export function requestAction(db,supplied,requestId,action,input){
  writing(db);const u=actor(db,supplied);
  const r=typeof requestId==='string'&&db.prepare('SELECT * FROM feedback_requests WHERE id=? AND tenant_id=?').get(requestId,u.tenant_id);
  if(!r||r.respondent_id!==u.id)fail(404,'not_found','الطلب غير متاح: يجيب عنه من وُجّه إليه');
  versioned(r,input);
  if(r.status!=='open')fail(409,'invalid_state','الطلب مغلق');
  const time=now();
  if(action==='answer_request'){
    v.object(input,['version','kind','visibility','body']);
    if(!FEEDBACK_KINDS.some(k=>k.key===input.kind))fail(400,'kind','اختر نوع الملاحظة');
    if(!VISIBILITY.some(k=>k.key===input.visibility))fail(400,'visibility','اختر من يرى الملاحظة');
    const noteId=id();
    const requesterManager=db.prepare('SELECT manager_id FROM users WHERE id=? AND tenant_id=?').get(r.requester_id,u.tenant_id)?.manager_id??null;
    db.prepare('INSERT INTO feedback_notes(id,tenant_id,author_id,subject_id,kind,visibility,body,occurred_on,request_id,visible_manager_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(noteId,u.tenant_id,u.id,r.requester_id,input.kind,input.visibility,v.text(input.body,'إجابتك',4000,15),today(),r.id,
        input.visibility==='recipient_manager'?requesterManager:null,time);
    db.prepare("UPDATE feedback_requests SET status='answered',closed_at=?,version=version+1 WHERE id=?").run(time,r.id);
    audit(db,u,'feedback_note',noteId,'feedback.written',{},{subject_id:r.requester_id,kind:input.kind,visibility:input.visibility,request_id:r.id});
    tell(db,r.requester_id,u.id,'feedback_note',noteId,'feedback_request_answered',`أجاب ${u.name} عن طلب رأيك`,'اقرأ الإجابة في «ملاحظات الزملاء».');
    return {id:noteId};
  }
  if(action==='decline_request'){
    v.object(input,['version','reason']);
    db.prepare("UPDATE feedback_requests SET status='declined',decline_reason=?,closed_at=?,version=version+1 WHERE id=?").run(v.text(input.reason,'سبب الاعتذار',600,5),time,r.id);
    audit(db,u,'feedback_request',r.id,'feedback.request_declined',{},{requester_id:r.requester_id});
    tell(db,r.requester_id,u.id,'feedback_request',r.id,'feedback_request_declined',`اعتذر ${u.name} عن طلب رأيك`,'سبب الاعتذار في «ملاحظات الزملاء».');
    return {id:r.id};
  }
  fail(404,'not_found','الإجراء غير متاح');
}
// أدلة المقيِّم: ملاحظات مرئية له عن الموظف داخل فترة الدورة. تُعرض ولا تُنسخ ولا تُحتسب — القرار للمقيِّم وحده.
function evidenceFor(db,u,r){
  const rows=db.prepare(`${VISIBLE_NOTES} AND n.subject_id=? AND n.withdrawn_at IS NULL AND n.occurred_on BETWEEN ? AND ? ORDER BY n.occurred_on DESC`).all(...noteParams(u),r.user_id,r.period_from,r.period_to);
  return {review_id:r.id,cycle_name:r.cycle_name,period_from:r.period_from,period_to:r.period_to,employee_name:name(db,r.user_id),
    notes:rows.map(n=>noteView(u,n)),
    rule:'أدلة للاطلاع فقط: لا تُنسخ في التقييم ولا تُحتسب في درجة، ولا تظهر هنا ملاحظة لا تشملك مرئيتها. الدرجة والملخص يكتبهما المقيِّم بمسؤوليته في شاشة تقييم الأداء.'};
}
export function feedbackEvidence(db,supplied,reviewId){
  const u=actor(db,supplied);
  const r=typeof reviewId==='string'&&db.prepare('SELECT r.id,r.user_id,r.reviewer_id,c.name AS cycle_name,c.period_from,c.period_to FROM performance_reviews r JOIN review_cycles c ON c.id=r.cycle_id WHERE r.id=? AND r.tenant_id=?').get(reviewId,u.tenant_id);
  if(!r||(r.reviewer_id!==u.id&&r.user_id!==u.id))fail(404,'not_found','التقييم غير متاح');
  return evidenceFor(db,u,r);
}
function reviewEvidence(db,u){
  const rows=db.prepare("SELECT r.id,r.user_id,c.name AS cycle_name,c.period_from,c.period_to FROM performance_reviews r JOIN review_cycles c ON c.id=r.cycle_id WHERE r.tenant_id=? AND r.reviewer_id=? AND r.status IN ('self','manager','submitted') ORDER BY c.period_to DESC LIMIT 20").all(u.tenant_id,u.id);
  return rows.map(r=>evidenceFor(db,u,r));
}

// ================= تقييم 360 داخل الدورة القائمة =================
// أدنى حد يقبله الكود وقاعدة البيانات (الترحيل 091): باثنين يطرح أحدهما نصه فيبقى نص الآخر مكشوفًا.
export const MIN_UPWARD_FLOOR=3;
// نتائج التقييم الصاعد لا تُقرأ قبل انتهاء جمع الاستجابات: القراءة أثناء الدورة ثم بعد إجابة جديدة تكشف صاحبها بالطرح.
const UPWARD_READABLE=['calibration','released'];
export function currentThreshold(db,tenantId){return db.prepare('SELECT * FROM review_360_settings WHERE tenant_id=? AND superseded_at IS NULL').get(tenantId)??null;}
// الحد الساري على دورة بعينها: المثبَّت فيها لحظة فتحها. الدورة المفتوحة قبل الترحيل بلا قيمة مثبتة
// تأخذ الأعلى من الإعداد الحالي والحد الأدنى، فلا يُخفض وعدها بقرار لاحق ولا يقل عن ثلاثة أبدًا.
function cycleThreshold(db,cycle,current){
  const pinned=db.prepare('SELECT min_upward_respondents FROM review_360_cycle_thresholds WHERE cycle_id=? AND tenant_id=?').get(cycle.id,cycle.tenant_id);
  if(pinned)return {min_upward_respondents:Math.max(pinned.min_upward_respondents,MIN_UPWARD_FLOOR),pinned:true};
  if(!current)return null;
  return {min_upward_respondents:Math.max(current.min_upward_respondents,MIN_UPWARD_FLOOR),pinned:false};
}
export function setUpwardThreshold(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!u.feedback_manage)fail(403,'not_permitted','حد كشف التقييم الصاعد يحدده مدير الموارد البشرية');
  v.object(input,['min_upward_respondents','basis','confirmed_on']);
  if(!Number.isInteger(input.min_upward_respondents)||input.min_upward_respondents<MIN_UPWARD_FLOOR||input.min_upward_respondents>20)fail(400,'min_upward_respondents',`الحد عدد صحيح من ${MIN_UPWARD_FLOOR} إلى 20: بمستجيبين اثنين يطرح أحدهما نصه فيُكشف نص الآخر`);
  const day=v.date(input.confirmed_on);if(day>today())fail(400,'confirmed_on','تاريخ تأكيد الإعداد اليوم أو قبله');
  const basis=v.text(input.basis,'أساس الحد ومصدره',1000,10),time=now(),current=currentThreshold(db,u.tenant_id),settingId=id();
  // الدورات المفتوحة بلا حد مثبت (فُتحت قبل وجود إعداد أو قبل الترحيل) تُثبَّت على وعدها القائم قبل تغييره:
  // الحد الحالي إن وُجد (ولا يقل عن ثلاثة)، وإلا هذا الإعداد الأول. تغيير الحد بعدها لا يمس دورة جارية.
  const unpinned=db.prepare("SELECT c.id FROM review_cycles c WHERE c.tenant_id=? AND c.status<>'draft' AND NOT EXISTS(SELECT 1 FROM review_360_cycle_thresholds t WHERE t.cycle_id=c.id)").all(u.tenant_id);
  if(current)db.prepare('UPDATE review_360_settings SET superseded_at=? WHERE id=?').run(time,current.id);
  db.prepare('INSERT INTO review_360_settings(id,tenant_id,min_upward_respondents,basis,confirmed_on,set_by,created_at) VALUES(?,?,?,?,?,?,?)').run(settingId,u.tenant_id,input.min_upward_respondents,basis,day,u.id,time);
  for(const c of unpinned)db.prepare('INSERT INTO review_360_cycle_thresholds(cycle_id,tenant_id,min_upward_respondents,setting_id,pinned_on) VALUES(?,?,?,?,?)')
    .run(c.id,u.tenant_id,current?Math.max(current.min_upward_respondents,MIN_UPWARD_FLOOR):input.min_upward_respondents,current?current.id:settingId,today());
  audit(db,u,'review_360_setting',settingId,'review_360.threshold_set',{min:current?.min_upward_respondents??null},{min:input.min_upward_respondents,confirmed_on:day,pinned_cycles:unpinned.length},basis);
  return {id:settingId};
}
// الحد مفروض في الاستعلام نفسه لا في الواجهة: ما لم يبلغ عدد المستجيبين الحد، لا يعود صف واحد.
// وبلا حد مسجَّل تُقيَّد المقارنة برقم يستحيل بلوغه، فالافتراض الآمن هو ألا يُعرض شيء.
// الجدول `review_360_answers` بلا rowid ومفتاحه عشوائي وبلا أي وقت: ترتيبه لا يطابق ترتيب الإرسال ولا سجل التدقيق.
function upwardAggregate(db,tenantId,cycleId,subjectId,threshold){
  return db.prepare(`SELECT r.strengths,r.improvements FROM review_360_answers r
    WHERE r.tenant_id=? AND r.cycle_id=? AND r.subject_id=? AND r.source='upward'
      AND (SELECT COUNT(*) FROM review_360_answers c WHERE c.tenant_id=r.tenant_id AND c.cycle_id=r.cycle_id AND c.subject_id=r.subject_id AND c.source='upward')>=max(?,${MIN_UPWARD_FLOOR})
    ORDER BY r.id`).all(tenantId,cycleId,subjectId,threshold?.min_upward_respondents??2147483647);
}
function thirdParty(db,u,subject,nomination){
  if(u.id===subject.id||u.id===nomination.rater_id||u.id===nomination.nominated_by)return false;
  const higher=subject.manager_id?db.prepare('SELECT manager_id FROM users WHERE id=?').get(subject.manager_id)?.manager_id??null:null;
  return u.feedback_manage||(!!higher&&u.id===higher);
}
function panelView(db,u,cycle,subject,threshold){
  const isSubject=subject.id===u.id,isManager=subject.manager_id===u.id;
  const noms=db.prepare(`SELECT n.*,x.name AS rater_name,p.name AS nominated_by_name,d.name AS decided_by_name,
      (SELECT 1 FROM review_360_submissions s WHERE s.nomination_id=n.id) AS answered
    FROM review_360_nominations n JOIN users x ON x.id=n.rater_id JOIN users p ON p.id=n.nominated_by LEFT JOIN users d ON d.id=n.decided_by
    WHERE n.cycle_id=? AND n.subject_id=? ORDER BY n.source,n.created_at`).all(cycle.id,subject.id);
  const nominations=noms.map(n=>{
    // اسم المقيِّم الصاعد لا يصل صاحب اللوحة إطلاقًا، وواقعة إجابته لا تظهر لغير صاحبها.
    const hideRater=n.source==='upward'&&isSubject&&n.rater_id!==u.id;
    return {id:n.id,source:n.source,source_name:SOURCE_NAMES[n.source],status:n.status,status_name:NOMINATION_STATES[n.status],
      rater_name:hideRater?'مخفي — تقييم صاعد':n.rater_name,nominated_by_name:n.nominated_by_name,decided_by_name:n.decided_by_name,decision_note:n.decision_note,version:n.version,
      answered:n.rater_id===u.id?!!n.answered:n.source==='upward'?null:!!n.answered,
      actions:n.status==='proposed'&&['draft','open'].includes(cycle.status)&&thirdParty(db,u,subject,n)?['approve_nomination','reject_nomination']:[]};
  });
  // من قيّم في هذه اللوحة لا يقرأ نتائجها بتصريح الموارد البشرية: يطرح نصه فيبقى نص غيره.
  const isRater=!isSubject&&noms.some(n=>n.rater_id===u.id);
  const mayRead=isSubject?['calibration','released'].includes(cycle.status):(isManager||u.feedback_manage)&&!isRater&&cycle.status!=='draft';
  const upwardReadable=mayRead&&UPWARD_READABLE.includes(cycle.status);
  const rows=mayRead?db.prepare("SELECT source,strengths,improvements FROM review_360_answers WHERE tenant_id=? AND cycle_id=? AND subject_id=? AND source IN ('self','peer') ORDER BY source,id").all(u.tenant_id,cycle.id,subject.id):[];
  const upward=upwardReadable?upwardAggregate(db,u.tenant_id,cycle.id,subject.id,threshold):[];
  const min=threshold?.min_upward_respondents??null;
  return {subject_id:subject.id,subject_name:subject.name,is_me:isSubject,
    upward_panel_size:nominations.filter(n=>n.source==='upward'&&n.status==='approved').length,
    nominations,can_nominate:(isSubject||isManager||u.feedback_manage)&&['draft','open'].includes(cycle.status),
    results:mayRead?{
      self:rows.filter(r=>r.source==='self'),peer:rows.filter(r=>r.source==='peer'),upward,
      upward_threshold:min,
      upward_note:min===null
        ?'لم يحدد مدير الموارد البشرية الحد الأدنى لعدد المستجيبين بعد، فلا يُعرض تقييم صاعد إطلاقًا.'
        :!upwardReadable?'لا يُعرض التقييم الصاعد قبل انتقال الدورة إلى المعايرة: قراءته أثناء جمع الاستجابات ثم بعد إجابة جديدة تكشف صاحبها بالطرح.'
        :upward.length?`عُرض بعد انتهاء جمع الاستجابات وبلوغ الحد الأدنى المثبَّت في الدورة (${min}). النصوص محفوظة بلا هوية كاتبها ولا وقت إرسالها ولا ترتيبه، ولا وسيلة في المنصة لربطها به. ما يبقى خارج قدرة المنصة: أسلوب الكتابة أو تفصيلة يذكرها الكاتب قد تدل عليه، ومن يصل إلى ملف قاعدة البيانات نفسه خارج المنصة قد يستنتج ترتيب الكتابة من بنيته الداخلية.`
        :`لم يبلغ عدد المستجيبين الحد الأدنى (${min})، فلا يُعرض شيء — ولا يُعرض عددهم.`,
      rule:'كل مصدر معروض منفصلًا بنصه. لا درجة مركّبة ولا ترتيب آلي: الدمج قرار بشري يُكتب بأساسه في معايرة الدورة.'
    }:null,
    results_note:mayRead?'':isSubject?'تظهر لك نتائج دورتك بعد انتقالها إلى المعايرة.'
      :isRater&&(isManager||u.feedback_manage)?'أنت مقيِّم في هذه اللوحة، فلا تقرأ نتائجها: من يعرف نصه يطرحه فيبقى نص غيره مكشوفًا.'
      :'نتائج هذه اللوحة لصاحبها ومديره المباشر وحاملي تصريح الموارد البشرية.'};
}
export function review360Board(db,supplied){
  const u=actor(db,supplied),threshold=currentThreshold(db,u.tenant_id);
  const cycles=db.prepare("SELECT * FROM review_cycles WHERE tenant_id=? AND status IN ('draft','open','calibration','released') ORDER BY period_to DESC,created_at DESC LIMIT 6").all(u.tenant_id);
  const me=db.prepare('SELECT id,name,manager_id FROM users WHERE id=?').get(u.id);
  const skip=reports(db,u,u.id).flatMap(p=>reports(db,u,p.id));
  const all=u.feedback_manage?db.prepare("SELECT id,name,manager_id FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id):[];
  const subjects=[...new Map([me,...reports(db,u,u.id),...skip,...all].map(p=>[p.id,p])).values()];
  const boards=cycles.map(c=>{
    const tasks=db.prepare(`SELECT n.id,n.source,n.subject_id,s.name AS subject_name FROM review_360_nominations n JOIN users s ON s.id=n.subject_id
      WHERE n.tenant_id=? AND n.cycle_id=? AND n.rater_id=? AND n.status='approved' AND NOT EXISTS(SELECT 1 FROM review_360_submissions x WHERE x.nomination_id=n.id) ORDER BY s.name`).all(u.tenant_id,c.id,u.id)
      .map(t=>({id:t.id,source:t.source,source_name:SOURCE_NAMES[t.source],subject_name:t.subject_name,actions:c.status==='open'?['submit_360']:[]}));
    const pinned=c.status==='draft'?(threshold?{min_upward_respondents:Math.max(threshold.min_upward_respondents,MIN_UPWARD_FLOOR)}:null):cycleThreshold(db,c,threshold);
    return {id:c.id,name:c.name,status:c.status,status_name:CYCLE_STATES[c.status],period_from:c.period_from,period_to:c.period_to,
      upward_threshold:pinned?.min_upward_respondents??null,upward_threshold_pinned:!!pinned?.pinned,
      panels:subjects.map(s=>panelView(db,u,c,s,pinned)),my_tasks:tasks};
  });
  return {today:today(),user_id:u.id,can_set_threshold:u.feedback_manage,sources:SOURCES,
    cycles:boards,people:db.prepare("SELECT id,name,manager_id FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(u.tenant_id),
    threshold:threshold?{min_upward_respondents:threshold.min_upward_respondents,basis:threshold.basis,confirmed_on:threshold.confirmed_on,set_by_name:name(db,threshold.set_by)}:null,
    threshold_note:threshold?'':'الحد الأدنى لعدد المستجيبين في التقييم الصاعد غير محدد بعد. لا قيمة افتراضية في الكود: يدخلها مدير الموارد البشرية بأساسها وتاريخ تأكيدها، وقبلها لا يُعرض تقييم صاعد.',
    confidentiality:`اختيار المقيِّمين يعتمده طرف ثالث لا المقيَّم ولا مديره. التقييم الصاعد يُحفظ بلا هوية كاتبه ولا وقت إرساله، ويُعرض مجمّعًا بعد انتقال الدورة إلى المعايرة وبلوغ الحد الأدنى المثبَّت فيها (لا يقل عن ${MIN_UPWARD_FLOOR}). ولا يقرأ اللوحةَ مَن قيّم فيها.`,
    note:DEVELOPMENT_ONLY};
}
export function nominate(db,supplied,input){
  writing(db);const u=actor(db,supplied);v.object(input,['cycle_id','subject_id','rater_id','source']);
  const cycle=typeof input.cycle_id==='string'&&db.prepare('SELECT * FROM review_cycles WHERE id=? AND tenant_id=?').get(input.cycle_id,u.tenant_id);
  if(!cycle)fail(404,'not_found','الدورة غير متاحة');
  if(!['draft','open'].includes(cycle.status))fail(409,'invalid_state','ترشيح المقيِّمين قبل انتقال الدورة إلى المعايرة');
  const subject=person(db,u,input.subject_id);
  if(subject.id!==u.id&&subject.manager_id!==u.id&&!u.feedback_manage)fail(403,'not_permitted','ترشح مقيِّميك أو مقيِّمي فريقك المباشر');
  if(!SOURCES.some(s=>s.key===input.source))fail(400,'source','اختر مصدر التقييم');
  const rater=person(db,u,input.rater_id);
  if(input.source==='self'&&rater.id!==subject.id)fail(400,'rater_id','التقييم الذاتي يكتبه صاحبه');
  if(input.source==='peer'&&(rater.id===subject.id||rater.id===subject.manager_id||rater.manager_id===subject.id))fail(400,'rater_id','القرين زميل: ليس مديره ولا أحدًا من فريقه المباشر');
  if(input.source==='upward'&&rater.manager_id!==subject.id)fail(400,'rater_id','التقييم الصاعد من أعضاء فريقه المباشر');
  if(db.prepare('SELECT 1 FROM review_360_nominations WHERE cycle_id=? AND subject_id=? AND rater_id=?').get(cycle.id,subject.id,rater.id))fail(409,'duplicate_nomination','هذا المقيِّم مرشح في هذه الدورة');
  const nominationId=id();
  db.prepare("INSERT INTO review_360_nominations(id,tenant_id,cycle_id,subject_id,rater_id,source,nominated_by,status,created_at) VALUES(?,?,?,?,?,?,?,'proposed',?)").run(nominationId,u.tenant_id,cycle.id,subject.id,rater.id,input.source,u.id,now());
  audit(db,u,'review_360_nomination',nominationId,'review_360.nominated',{},{cycle_id:cycle.id,subject_id:subject.id,source:input.source});
  // اعتماد المقيِّمين لطرف ثالث؛ بلا إشعار كان الترشيح ينتظر من لا يعلم به.
  for(const person of db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role<>'admin'").all(u.tenant_id).filter(p=>thirdParty(db,{...p,feedback_manage:holds(db,p,CAP)},subject,{nominated_by:u.id,rater_id:rater.id})))
    tell(db,person.id,u.id,'review_nomination',nominationId,'review_nomination_needed','ترشيح مقيِّم ينتظر اعتماد طرف ثالث','افتح «ملاحظات الزملاء» لاعتماده أو رفضه. لا يعتمد المرشِّح ترشيحه ولا المقيَّم مقيِّميه.');
  return {id:nominationId};
}
export function nominationAction(db,supplied,nominationId,action,input){
  writing(db);const u=actor(db,supplied);
  const n=typeof nominationId==='string'&&db.prepare('SELECT * FROM review_360_nominations WHERE id=? AND tenant_id=?').get(nominationId,u.tenant_id);
  if(!n)fail(404,'not_found','الترشيح غير متاح');
  versioned(n,input);v.object(input,['version','note']);
  if(n.status!=='proposed')fail(409,'invalid_state','بُت في هذا الترشيح');
  if(!['approve_nomination','reject_nomination'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  const subject=db.prepare('SELECT id,name,manager_id FROM users WHERE id=?').get(n.subject_id);
  if(!thirdParty(db,u,subject,n))fail(403,'separation_of_duties','اعتماد المقيِّمين لطرف ثالث: المدير الأعلى أو الموارد البشرية. لا يعتمد المرشِّح ترشيحه ولا المقيَّم مقيِّميه ولا المقيِّم نفسه');
  db.prepare('UPDATE review_360_nominations SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1 WHERE id=?')
    .run(action==='approve_nomination'?'approved':'rejected',u.id,now(),v.text(input.note,'أساس القرار',1000,5),n.id);
  audit(db,u,'review_360_nomination',n.id,'review_360.'+action,{status:n.status},{subject_id:n.subject_id,source:n.source});
  if(action==='approve_nomination')tell(db,n.rater_id,u.id,'review_nomination',n.id,'review_rating_needed','اعتُمد ترشيحك لتقييم زميل في دورة 360',
    'افتح «ملاحظات الزملاء» لكتابة استجابتك. استجابتك تُحفظ بلا هوية ولا وقت، وتُعرض مجمّعة فقط.');
  return {id:n.id};
}
export function submit360(db,supplied,nominationId,input){
  writing(db);const u=actor(db,supplied);v.object(input,['strengths','improvements']);
  const n=typeof nominationId==='string'&&db.prepare('SELECT n.*,c.status AS cycle_status FROM review_360_nominations n JOIN review_cycles c ON c.id=n.cycle_id WHERE n.id=? AND n.tenant_id=?').get(nominationId,u.tenant_id);
  if(!n||n.rater_id!==u.id)fail(404,'not_found','الترشيح غير متاح');
  if(n.status!=='approved')fail(409,'invalid_state','لم يعتمد الطرف الثالث ترشيحك بعد');
  if(n.cycle_status!=='open')fail(409,'invalid_state','الدورة ليست مفتوحة للتقييم');
  if(db.prepare('SELECT 1 FROM review_360_submissions WHERE nomination_id=?').get(n.id))fail(409,'already_submitted','أرسلت استجابتك في هذه الدورة');
  // الاستجابة تُكتب في `review_360_answers`: مفتاح عشوائي بلا rowid، وبلا وقت ولا تاريخ ولا إشارة إلى كاتبها أو ترشيحه.
  // واقعة الإرسال تُسجَّل في جدول منفصل باليوم لا باللحظة، فلا عمود مشترك بين الجدولين غير الدورة والمقيَّم.
  db.prepare('INSERT INTO review_360_answers(id,tenant_id,cycle_id,subject_id,source,strengths,improvements) VALUES(?,?,?,?,?,?,?)')
    .run(id(),u.tenant_id,n.cycle_id,n.subject_id,n.source,v.text(input.strengths,'ما الذي يفعله جيدًا بدليل',3000,15),v.text(input.improvements,'ما الذي يطوره بدليل',3000,15));
  db.prepare('INSERT INTO review_360_submissions(nomination_id,submitted_at) VALUES(?,?)').run(n.id,today());
  // سجل التدقيق يثبت أن الترشيح أُجيب ومن أجابه، كما يثبته جدول الإرسال أصلًا. ولا يطابق ترتيبُه شيئًا في جدول الاستجابات:
  // لا وقت فيها ولا rowid، والنتائج لا تُقرأ إلا بعد انتهاء جمعها، فلا قراءتان يُطرح بينهما إرسال واحد.
  audit(db,u,'review_360_nomination',n.id,'review_360.submitted',{},{source:n.source});
  return {id:n.id};
}
