import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can, holds } from './access.mjs';
import { notifySubject, dayName } from './notices.mjs';

// إقرار الاطلاع على السياسات: ضبط داخلي يثبت من اطلع ومتى وعلى أي نسخة بالضبط. ليس إلزامًا نظاميًا ولا توقيعًا، ولا يغني عن أي إجراء نظامي.
// الإقرار مربوط بصف السياسة المعتمد (لا يتغير بعد اعتماده) وبرقم نسخته وبصمة نصه؛ نسخة جديدة = جولة جديدة وإقرار جديد.
export const AUDIENCES={all:'كل الموظفين',department:'إدارة بعينها',role:'دور بعينه'};
const ROLES={employee:'موظف',manager:'مدير',hr:'موارد بشرية',it:'تقنية معلومات',pm:'مدير مشاريع'};
const POLICY_KIND_NAMES={pay_components:'بنود الراتب المسموحة',working_time:'ساعات العمل والحضور',payroll_cycle:'دورة الرواتب',end_of_service:'نهاية الخدمة'};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
const oversees=(db,u)=>can(db,u,'knowledge.manage')||holds(db,u,'hr.policy.accept');
// D-21 وD-20 (تدقيق مسارات الوحدات، 20 سبتمبر): فتح الجولة لم يكن يصل أحدًا، و«التذكير» كان يزيد عدادًا ويرد
// {"reminded":4} بلا إشعار واحد — واجهة تدّعي فعلًا لم تقع. الإشعار داخل المنصة فقط كما تقول الشاشة.
function tellRecipients(db,round,userIds,actorId,kind,title,body){
  let sent=0;
  for(const userId of userIds){if(!userId||userId===actorId)continue;notifySubject(db,{userId,kind,subjectKind:'policy_ack_round',subjectId:round.id,title,body});sent++;}
  return sent;
}
const pendingRecipients=(db,roundId)=>db.prepare(`SELECT c.user_id FROM policy_ack_recipients c JOIN users x ON x.id=c.user_id
  WHERE c.round_id=? AND x.active=1 AND NOT EXISTS(SELECT 1 FROM policy_acknowledgements a WHERE a.round_id=c.round_id AND a.user_id=c.user_id)`).all(roundId).map(r=>r.user_id);

// رقم النسخة = ترتيب اعتماد السياسة بين سياسات نوعها. وقت الاعتماد لا يتغير بعد تسجيله، فالرقم ثابت مهما اعتُمد بعدها.
export function policyRevision(db,policy){
  return db.prepare("SELECT COUNT(*) AS n FROM hr_policies WHERE tenant_id=? AND kind=? AND status='accepted' AND (decided_at<? OR (decided_at=? AND id<=?))").get(policy.tenant_id,policy.kind,policy.decided_at,policy.decided_at,policy.id).n;
}
export const policyDigest=policy=>hash(JSON.stringify([policy.kind,policy.title,policy.body,policy.parameters,policy.effective_from]));

function audienceUsers(db,tenantId,audience,value){
  const rows=db.prepare("SELECT id,department_id,role FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY id").all(tenantId);
  return rows.filter(r=>audience==='all'||(audience==='department'?r.department_id===value:r.role===value)).map(r=>r.id);
}
function roundView(db,u,r,detail){
  const date=today(),recipients=db.prepare('SELECT c.user_id,x.name,x.active,a.acknowledged_at FROM policy_ack_recipients c JOIN users x ON x.id=c.user_id LEFT JOIN policy_acknowledgements a ON a.round_id=c.round_id AND a.user_id=c.user_id WHERE c.round_id=? AND c.tenant_id=? ORDER BY x.name').all(r.id,u.tenant_id);
  const pending=recipients.filter(x=>!x.acknowledged_at),open=r.status==='open',mayRun=detail&&open;
  return {...r,status_name:open?'مفتوحة':'مغلقة',kind_name:POLICY_KIND_NAMES[r.policy_kind]??r.policy_kind,owner_name:name(db,r.owner_id),opened_by_name:name(db,r.opened_by),closed_by_name:name(db,r.closed_by),
    audience_name:r.audience==='all'?AUDIENCES.all:r.audience==='department'?`إدارة: ${db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(r.audience_value,u.tenant_id)?.name??r.audience_value}`:`دور: ${ROLES[r.audience_value]??r.audience_value}`,
    requested:recipients.length,acknowledged:recipients.length-pending.length,late:open&&r.due_on<date&&pending.length>0,
    pending:detail?pending.map(x=>({user_id:x.user_id,name:x.name,active:!!x.active})):[],
    acknowledged_list:detail?recipients.filter(x=>x.acknowledged_at).map(x=>({user_id:x.user_id,name:x.name,acknowledged_at:x.acknowledged_at})):[],
    actions:mayRun?[...(pending.length?['remind_round']:[]),'sync_recipients','close_round']:[]};
}

export function acknowledgementsBoard(db,supplied){
  const u=actor(db,supplied),all=oversees(db,u),date=today();
  const rounds=db.prepare(`SELECT * FROM policy_ack_rounds WHERE tenant_id=? ${all?'':'AND (owner_id=? OR opened_by=?)'} ORDER BY status DESC,opened_at DESC`).all(...(all?[u.tenant_id]:[u.tenant_id,u.id,u.id])).map(r=>roundView(db,u,r,true));
  // ما ينتظر إقراري: النص نفسه يُعرض هنا، فالموظف يقر بما قرأه لا بعنوان.
  const mine=db.prepare("SELECT r.*,p.body,p.effective_from FROM policy_ack_recipients c JOIN policy_ack_rounds r ON r.id=c.round_id JOIN hr_policies p ON p.id=r.policy_id AND p.tenant_id=r.tenant_id WHERE c.tenant_id=? AND c.user_id=? AND r.status='open' AND NOT EXISTS(SELECT 1 FROM policy_acknowledgements a WHERE a.round_id=c.round_id AND a.user_id=c.user_id) ORDER BY r.due_on").all(u.tenant_id,u.id)
    .map(r=>({id:r.id,version:r.version,policy_id:r.policy_id,title:r.policy_title,kind_name:POLICY_KIND_NAMES[r.policy_kind]??r.policy_kind,policy_revision:r.policy_revision,effective_from:r.effective_from,body:r.body,due_on:r.due_on,late:r.due_on<date,reminder_count:r.reminder_count,owner_name:name(db,r.owner_id),created_at:r.opened_at,actions:['acknowledge_policy']}));
  const history=db.prepare('SELECT a.acknowledged_at,a.policy_revision,r.policy_title,r.policy_kind FROM policy_acknowledgements a JOIN policy_ack_rounds r ON r.id=a.round_id WHERE a.tenant_id=? AND a.user_id=? ORDER BY a.acknowledged_at DESC LIMIT 30').all(u.tenant_id,u.id).map(a=>({...a,kind_name:POLICY_KIND_NAMES[a.policy_kind]??a.policy_kind}));
  // سياسة معتمدة بلا جولة = نسخة لم يُطلب الإقرار بها بعد. هذه القائمة هي ما يجعل «نسخة جديدة تعني إقرارًا جديدًا» مرئيًا.
  const without=all?db.prepare("SELECT p.* FROM hr_policies p WHERE p.tenant_id=? AND p.status='accepted' AND NOT EXISTS(SELECT 1 FROM policy_ack_rounds r WHERE r.policy_id=p.id AND r.tenant_id=p.tenant_id) ORDER BY p.decided_at DESC").all(u.tenant_id)
    .map(p=>({id:p.id,title:p.title,kind_name:POLICY_KIND_NAMES[p.kind]??p.kind,policy_revision:policyRevision(db,p),effective_from:p.effective_from,owner_name:name(db,p.decided_by),actions:['open_round']})):[];
  return {today:date,user_id:u.id,can_oversee:all,audiences:AUDIENCES,roles:ROLES,
    departments:all?db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id):[],
    pending_mine:mine,my_acknowledgements:history,rounds,policies_without_round:without,awaiting_me:mine.map(r=>({id:r.id,title:`${r.title} — النسخة ${r.policy_revision}`,context:`إقرار اطلاع مطلوب قبل ${r.due_on}`,created_at:r.created_at,actions:['acknowledge_policy']})),
    note:'الإقرار ضبط داخلي يثبت من اطلع ومتى وعلى أي نسخة؛ ليس توقيعًا ولا إلزامًا نظاميًا ولا يُغني عن أي إجراء تطلبه جهة خارجية. التذكير يظهر داخل المنصة فقط: لا بريد ولا رسائل تُرسل. نسخة جديدة من السياسة تحتاج جولة إقرار جديدة؛ الإقرار القديم يبقى مرتبطًا بنسخته.'};
}

export function openRound(db,supplied,input){
  writing(db);const u=actor(db,supplied);if(!oversees(db,u))fail(403,'not_permitted','طلب الإقرار لمالك السياسة أو لحامل تصريح قاعدة المعرفة');
  v.object(input,['policy_id','audience','audience_value','due_on']);
  const policy=typeof input.policy_id==='string'&&db.prepare("SELECT * FROM hr_policies WHERE id=? AND tenant_id=? AND status='accepted'").get(input.policy_id,u.tenant_id);
  if(!policy)fail(404,'not_found','السياسة المعتمدة غير متاحة');
  if(db.prepare('SELECT 1 FROM policy_ack_rounds WHERE tenant_id=? AND policy_id=?').get(u.tenant_id,policy.id))fail(409,'round_exists','طُلب الإقرار بهذه النسخة من قبل؛ أضف المستلمين الجدد إلى جولتها');
  if(!Object.hasOwn(AUDIENCES,input.audience))fail(400,'audience','اختر الفئة المعنية');
  let value='';
  if(input.audience==='department'){value=String(input.audience_value??'');if(!db.prepare('SELECT 1 FROM departments WHERE id=? AND tenant_id=?').get(value,u.tenant_id))fail(400,'audience_value','الإدارة غير موجودة');}
  else if(input.audience==='role'){value=String(input.audience_value??'');if(!Object.hasOwn(ROLES,value))fail(400,'audience_value','اختر الدور');}
  else if(input.audience_value)fail(400,'audience_value','«كل الموظفين» لا يقبل قيمة');
  const due=v.date(input.due_on);if(due<today())fail(400,'due_on','موعد الإقرار اليوم أو بعده');
  const users=audienceUsers(db,u.tenant_id,input.audience,value);if(!users.length)fail(409,'empty_audience','لا موظفين نشطين في هذه الفئة');
  const roundId=randomUUID(),time=now(),revision=policyRevision(db,policy);
  db.prepare('INSERT INTO policy_ack_rounds(id,tenant_id,policy_id,policy_kind,policy_title,policy_revision,content_digest,audience,audience_value,due_on,owner_id,opened_by,opened_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(roundId,u.tenant_id,policy.id,policy.kind,policy.title,revision,policyDigest(policy),input.audience,value,due,policy.decided_by,u.id,time);
  for(const userId of users)db.prepare('INSERT INTO policy_ack_recipients(round_id,tenant_id,user_id,added_at) VALUES(?,?,?,?)').run(roundId,u.tenant_id,userId,time);
  audit(db,u,'policy_ack_round',roundId,'policy_ack.opened',{}, {policy_id:policy.id,policy_revision:revision,audience:input.audience,audience_value:value,requested:users.length,due_on:due});
  const notified=tellRecipients(db,{id:roundId},users,u.id,'policy_ack_requested',`مطلوب إقرارك بالاطلاع على: ${policy.title} (النسخة ${revision})`,
    `اقرأ نص السياسة وأقرّ بالاطلاع عليه قبل ${dayName(due)} من «السياسات المطلوب إقرارها». الإقرار ضبط داخلي يثبت من اطلع ومتى وعلى أي نسخة.`);
  return {id:roundId,requested:users.length,notified};
}

const ROUND_FIELDS={remind_round:['note'],sync_recipients:[],close_round:['note']};
export function roundAction(db,supplied,roundId,action,input){
  writing(db);const u=actor(db,supplied),fields=ROUND_FIELDS[action];if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const r=typeof roundId==='string'&&db.prepare('SELECT * FROM policy_ack_rounds WHERE id=? AND tenant_id=?').get(roundId,u.tenant_id);
  if(!r||(!oversees(db,u)&&r.owner_id!==u.id&&r.opened_by!==u.id))fail(404,'not_found','جولة الإقرار غير متاحة');
  v.version(input.version,r.version);
  if(r.status!=='open')fail(409,'action_unavailable','الجولة مغلقة ولا تُعدَّل');
  const time=now(),pending=db.prepare('SELECT COUNT(*) AS n FROM policy_ack_recipients c WHERE c.round_id=? AND NOT EXISTS(SELECT 1 FROM policy_acknowledgements a WHERE a.round_id=c.round_id AND a.user_id=c.user_id)').get(r.id).n;
  if(action==='remind_round'){
    if(!pending)fail(409,'nothing_pending','أقر الجميع؛ لا أحد يُذكَّر');
    db.prepare('UPDATE policy_ack_rounds SET reminder_count=reminder_count+1,last_reminded_at=?,version=version+1 WHERE id=?').run(time,r.id);
    // D-20: «reminded» يعني إشعارات وصلت فعلًا، لا عدادًا ارتفع. الرقم المعاد هو عدد من وصلهم التذكير.
    const reminded=tellRecipients(db,r,pendingRecipients(db,r.id),u.id,'policy_ack_reminder',`تذكير: لم تُقرّ بعد بالاطلاع على ${r.policy_title} (النسخة ${r.policy_revision})`,
      `موعد الإقرار ${dayName(r.due_on)}${r.due_on<today()?' وقد مضى':''}. افتح «السياسات المطلوب إقرارها» لقراءة النص والإقرار به.`);
    audit(db,u,'policy_ack_round',r.id,'policy_ack.reminded',{}, {pending,reminded,reminder:r.reminder_count+1},input.note?v.text(input.note,'ملاحظة التذكير',600,3):'');
    return {id:r.id,pending,reminded,channel:'in_platform'};
  }
  if(action==='sync_recipients'){
    // من التحق بالفئة بعد فتح الجولة يُضاف؛ لا يُحذف أحد، فقائمة من طُلب منهم دليل.
    const have=new Set(db.prepare('SELECT user_id FROM policy_ack_recipients WHERE round_id=?').all(r.id).map(x=>x.user_id)),added=audienceUsers(db,u.tenant_id,r.audience,r.audience_value).filter(id=>!have.has(id));
    for(const userId of added)db.prepare('INSERT INTO policy_ack_recipients(round_id,tenant_id,user_id,added_at) VALUES(?,?,?,?)').run(r.id,u.tenant_id,userId,time);
    db.prepare('UPDATE policy_ack_rounds SET version=version+1 WHERE id=?').run(r.id);
    const notified=tellRecipients(db,r,added,u.id,'policy_ack_requested',`مطلوب إقرارك بالاطلاع على: ${r.policy_title} (النسخة ${r.policy_revision})`,
      `اقرأ نص السياسة وأقرّ بالاطلاع عليه قبل ${dayName(r.due_on)} من «السياسات المطلوب إقرارها».`);
    audit(db,u,'policy_ack_round',r.id,'policy_ack.recipients_added',{}, {added:added.length,notified});
    return {id:r.id,added:added.length,notified};
  }
  // الإغلاق لا يفترض إقرار أحد: من لم يقر يبقى مسجلًا «لم يقر» في الجولة المغلقة.
  const note=v.text(input.note,'ملاحظة الإغلاق',1000,10);
  db.prepare("UPDATE policy_ack_rounds SET status='closed',closed_by=?,closed_at=?,close_note=?,version=version+1 WHERE id=?").run(u.id,time,note,r.id);
  audit(db,u,'policy_ack_round',r.id,'policy_ack.closed',{status:'open'},{status:'closed',left_pending:pending},note);
  return {id:r.id,left_pending:pending};
}

export function acknowledgePolicy(db,supplied,roundId,input){
  writing(db);const u=actor(db,supplied);v.object(input,['policy_revision','confirm']);
  // الإقرار لصاحبه فقط: لا أحد يقر عن غيره، ولا مسار في الوحدة يقبل user_id.
  const r=typeof roundId==='string'&&db.prepare('SELECT r.* FROM policy_ack_rounds r JOIN policy_ack_recipients c ON c.round_id=r.id AND c.user_id=? WHERE r.id=? AND r.tenant_id=?').get(u.id,roundId,u.tenant_id);
  if(!r)fail(404,'not_found','لا إقرار مطلوب منك في هذه الجولة');
  if(r.status!=='open')fail(409,'action_unavailable','الجولة مغلقة');
  if(db.prepare('SELECT 1 FROM policy_acknowledgements WHERE round_id=? AND user_id=?').get(r.id,u.id))fail(409,'already_acknowledged','سبق أن أقررت بهذه النسخة');
  if(input.confirm!==true)fail(400,'confirm','أكّد اطلاعك على نص السياسة');
  // النسخة التي رآها الموظف على الشاشة هي التي يقر بها، لا «أحدث نسخة» أيًا كانت.
  if(!Number.isInteger(input.policy_revision)||input.policy_revision!==r.policy_revision)fail(409,'revision_mismatch','رقم النسخة لا يطابق النسخة المطلوب الإقرار بها. أعد تحميل الصفحة');
  const policy=db.prepare('SELECT * FROM hr_policies WHERE id=? AND tenant_id=?').get(r.policy_id,u.tenant_id);
  if(!policy||policyDigest(policy)!==r.content_digest)fail(409,'content_changed','نص السياسة لا يطابق ما فُتحت به الجولة');
  const ackId=randomUUID(),time=now();
  db.prepare('INSERT INTO policy_acknowledgements(id,tenant_id,round_id,user_id,policy_id,policy_revision,content_digest,acknowledged_at) VALUES(?,?,?,?,?,?,?,?)').run(ackId,u.tenant_id,r.id,u.id,r.policy_id,r.policy_revision,r.content_digest,time);
  audit(db,u,'policy_acknowledgement',ackId,'policy_ack.acknowledged',{}, {round_id:r.id,policy_id:r.policy_id,policy_revision:r.policy_revision});
  return {id:ackId,policy_revision:r.policy_revision,acknowledged_at:time};
}
