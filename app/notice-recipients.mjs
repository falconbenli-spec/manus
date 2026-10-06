import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { notifySubject, SUBJECT_LINKS } from './notices.mjs';
import { can } from './access.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';

// الإشعار الذي لا مستلم له لا يسقط صامتًا (الموجة 2، العطب 10). كان notifySubject يعيد null حين يغيب المستلم، و25 من 28 موظفًا
// بلا مدير مباشر: كشف ساعات «ينتظر اعتمادك» لم يكن يصل أحدًا، ولا يعلم أحد أنه لم يصل. صار للإشعار سُلَّم مستلمين:
//   (1) المستلم المقصود إن كان حسابه نشطًا،
//   (2) مدير إدارة صاحب السجل: المسجل في department_routing بدور department_manager، وإلا مديرها النشط الوحيد،
//   (3) مرجع تصعيد الإدارة المسجل في department_escalation، فمرجعُ إدارتِه، حتى ثماني درجات،
//   (4) وإلا صفٌّ في undeliverable_notices يراه من يدير الهيكل والتصعيد في «إعداد الاعتماد»، ومسؤول المنصة في طابور المهام.
// من قام بالفعل وصاحب السجل نفسه لا يستلمان إشعار قرارٍ عليه. ومن وصله الإشعار بغير الطريق الأول يُقال له لماذا وصله.
// هذه الوحدة لا تستورد workflow.mjs ولا أي وحدة أعمال (SQL والتصاريح والرفض فقط)، فتستوردها كل وحدة بلا دورة استيراد.
const anyUser=(db,tenantId,userId)=>userId?db.prepare('SELECT id,name,department_id,active FROM users WHERE id=? AND tenant_id=?').get(userId,tenantId)??null:null;

export function departmentHeadOf(db,tenantId,departmentId){
  if(!departmentId)return null;
  const routed=db.prepare("SELECT u.id,u.name,u.department_id FROM department_routing r JOIN users u ON u.id=r.user_id AND u.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.department_id=? AND r.step_role='department_manager' AND u.active=1").get(tenantId,departmentId);
  if(routed)return routed;
  const managers=db.prepare("SELECT id,name,department_id FROM users WHERE tenant_id=? AND department_id=? AND role='manager' AND active=1 ORDER BY id").all(tenantId,departmentId);
  return managers.length===1?managers[0]:null;
}
// سُلَّم تصعيد الإدارة كما هو مسجل، بلا حساب إدارة المنصة وبلا تكرار. (نظير workflow.escalationLadder بلا استيراده.)
export function escalationRungs(db,tenantId,departmentId){
  const rungs=[],seen=new Set();let current=departmentId;
  for(let depth=0;depth<8&&current;depth++){
    const above=db.prepare("SELECT u.id,u.name,u.department_id FROM department_escalation e JOIN users u ON u.id=e.user_id AND u.tenant_id=e.tenant_id WHERE e.tenant_id=? AND e.department_id=? AND u.active=1 AND u.role<>'admin'").get(tenantId,current);
    if(!above||seen.has(above.id))break;
    seen.add(above.id);rungs.push({...above,depth});
    current=above.department_id===current?null:above.department_id;
  }
  return rungs;
}

// من يستلم؟ يعيد {user, via, tried}. via: intended | department_head | escalation | none. tried: كل ما جُرِّب ولماذا لم يصلح.
export function resolveRecipient(db,{tenantId,userId=null,departmentId=null,exclude=[]}){
  const barred=new Set(exclude.filter(Boolean)),tried=[];
  const intended=anyUser(db,tenantId,userId);
  if(intended?.active&&!barred.has(intended.id))return {user:intended,via:'intended',tried};
  tried.push({step:'intended',user_id:userId??null,outcome:!userId?'لا مستلم مسمّى':!intended?'الحساب غير موجود في هذا الكيان':!intended.active?'الحساب موقوف':'هو من قام بالفعل أو صاحب السجل'});
  const department=departmentId??intended?.department_id??null;
  if(!department){tried.push({step:'department_head',outcome:'لا إدارة معروفة لصاحب السجل'});return {user:null,via:'none',tried,department_id:null};}
  const head=departmentHeadOf(db,tenantId,department);
  if(head&&!barred.has(head.id))return {user:head,via:'department_head',tried,department_id:department};
  tried.push({step:'department_head',department_id:department,user_id:head?.id??null,outcome:head?'هو من قام بالفعل أو صاحب السجل':'لا مدير إدارة مسجلًا ولا مدير نشط وحيد فيها'});
  for(const rung of escalationRungs(db,tenantId,department)){
    if(!barred.has(rung.id))return {user:rung,via:'escalation',tried,department_id:department,depth:rung.depth};
    tried.push({step:'escalation',user_id:rung.id,depth:rung.depth,outcome:'هو من قام بالفعل أو صاحب السجل'});
  }
  if(!tried.some(x=>x.step==='escalation'))tried.push({step:'escalation',department_id:department,outcome:'لا مرجع تصعيد نشط مسجلًا للإدارة'});
  return {user:null,via:'none',tried,department_id:department};
}
const WHY={department_head:'لا مدير مباشر نشط مسجلًا لصاحب السجل، وأنت مدير إدارته',escalation:'لا مدير مباشر ولا مدير إدارة نشطًا يستلمه، وأنت مرجع تصعيد الإدارة'};

export function recordUndeliverable(db,{tenantId,kind,subjectKind,subjectId,userId=null,departmentId=null,tried=[],reason}){
  // المفتاحان الأجنبيان اختياريان: حساب أو إدارة من خارج الكيان لا يمنعان تسجيل أن الإشعار لم يصل.
  const noticeId=randomUUID(),department=departmentId&&db.prepare('SELECT 1 FROM departments WHERE id=? AND tenant_id=?').get(departmentId,tenantId)?departmentId:null;
  db.prepare('INSERT INTO undeliverable_notices(id,tenant_id,kind,subject_kind,subject_id,intended_user_id,department_id,tried,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(noticeId,tenantId,kind,subjectKind,String(subjectId),anyUser(db,tenantId,userId)?userId:null,department,JSON.stringify(tried),reason,now());
  return noticeId;
}

// إشعار سجل (ليس طلب خدمة) عبر السُلَّم. aboutUserId: صاحب السجل — إدارته هي التي يُبحث فيها، وهو لا يستلم قرارًا على سجله.
// يعيد {delivered:true,user_id,via} أو {delivered:false,undeliverable_id}. موضوع غير معروف: خطأ مبرمج يُرفع في الاختبار، ويُسجَّل في التشغيل.
export function deliverSubject(db,{tenantId,userId=null,aboutUserId=null,departmentId=null,actorId=null,...notice}){
  const tenant=tenantId??anyTenant(db,userId??aboutUserId??actorId);
  if(!SUBJECT_LINKS[notice.subjectKind]){
    if(process.env.NODE_TEST_CONTEXT)throw new TypeError(`deliverSubject: موضوع إشعار غير معروف «${notice.subjectKind}»؛ أضفه إلى SUBJECT_LINKS في app/notices.mjs`);
    return {delivered:false,undeliverable_id:recordUndeliverable(db,{tenantId:tenant,kind:notice.kind,subjectKind:String(notice.subjectKind??'unknown').slice(0,60).padEnd(3,'_'),subjectId:notice.subjectId??'-',userId,departmentId,
      tried:[],reason:'موضوع الإشعار غير معرَّف في SUBJECT_LINKS؛ لا شاشة يفتحها'})};
  }
  const about=anyUser(db,tenant,aboutUserId);
  const found=resolveRecipient(db,{tenantId:tenant,userId,departmentId:departmentId??about?.department_id??null,exclude:[actorId,aboutUserId]});
  if(!found.user)return {delivered:false,undeliverable_id:recordUndeliverable(db,{tenantId:tenant,kind:notice.kind,subjectKind:notice.subjectKind,subjectId:notice.subjectId,userId,departmentId:found.department_id,
    tried:found.tried,reason:'لا مستلم نشط: لا المقصود ولا مدير الإدارة ولا أي درجة في سُلَّم تصعيدها'})};
  const why=WHY[found.via];
  notifySubject(db,{...notice,userId:found.user.id,body:why?`${notice.body??''} وصلك هذا الإشعار لأن ${why}. إن لم يكن القرار متاحًا لك في شاشته فاطلب ممن يدير الهيكل تعيين مدير مباشر لصاحب السجل.`.trim():notice.body});
  return {delivered:true,user_id:found.user.id,via:found.via};
}
const anyTenant=(db,userId)=>userId?db.prepare('SELECT tenant_id FROM users WHERE id=?').get(userId)?.tenant_id??null:null;

// ── ما يراه من يدير الهيكل والتصعيد ────────────────────────────────────────────
const mayManage=(db,u)=>can(db,u,'structure.manage');
export function undeliverableBoard(db,supplied){
  const u=actorOrRefuse(db,supplied),manage=mayManage(db,u);
  if(!manage)return {visible:false,open:[],open_count:0,resolved_count:0,note:''};
  // السقف على المفتوحة وحدها: كان يُطبَّق على كل الإشعارات ثم تُصفّى بعده، فتزيح المعالَجةُ الحديثةُ المفتوحةَ القديمةَ
  // عن الشاشة الوحيدة التي بُنيت لالتقاطها — وهي بعينها السقطة الصامتة التي وُجدت هذه الموجة لإنهائها. والعدّ من
  // التعبير نفسه الذي يقرؤه التشغيل اليومي (undeliverableOpenCount)، فلا تعطي المنصة رقمين لسؤال واحد.
  const rows=db.prepare(`SELECT n.*,x.name AS intended_name,d.name AS department_name FROM undeliverable_notices n
    LEFT JOIN users x ON x.id=n.intended_user_id LEFT JOIN departments d ON d.id=n.department_id AND d.tenant_id=n.tenant_id
    WHERE n.tenant_id=? AND NOT EXISTS(SELECT 1 FROM undeliverable_notice_resolutions r WHERE r.notice_id=n.id AND r.tenant_id=n.tenant_id)
    ORDER BY n.created_at DESC LIMIT 200`).all(u.tenant_id);
  const open=rows.map(r=>({id:r.id,kind:r.kind,subject_kind:r.subject_kind,screen:SUBJECT_LINKS[r.subject_kind]??(r.subject_kind==='request'?'#requests':''),
    intended_name:r.intended_name??'',department_name:r.department_name??'',reason:r.reason,tried:JSON.parse(r.tried),created_at:r.created_at,actions:['resolve_undeliverable']}));
  const openCount=undeliverableOpenCount(db,u.tenant_id);
  return {visible:true,open,open_count:openCount,
    resolved_count:db.prepare('SELECT COUNT(*) AS n FROM undeliverable_notice_resolutions r WHERE r.tenant_id=?').get(u.tenant_id).n,
    note:`إشعار لم يجد من يستلمه: لا المقصود ولا مدير الإدارة ولا سُلَّم تصعيدها. لا يُعرض نصه هنا. سُدَّ الفراغ (عيّن مدير الإدارة أو مرجع تصعيدها) ثم علّمه «عولج» بما فعلت.${openCount>open.length?` معروض أحدث ${open.length} من ${openCount} مفتوحًا.`:''}`};
}
export const undeliverableOpenCount=(db,tenantId)=>db.prepare('SELECT COUNT(*) AS n FROM undeliverable_notices n WHERE n.tenant_id=? AND NOT EXISTS(SELECT 1 FROM undeliverable_notice_resolutions r WHERE r.notice_id=n.id AND r.tenant_id=n.tenant_id)').get(tenantId).n;
export function resolveUndeliverable(db,supplied,noticeId,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');
  const u=actorOrRefuse(db,supplied);v.object(input,['note']);
  if(!mayManage(db,u))refuse(403,'not_permitted',{what:'تعليم إشعار بلا مستلم «عولج» ليس لحسابك',
    missing:[{document:'تصريح الإدارات والهيكل والتصعيد',why:'معالجته تعني سدّ فراغ في الهيكل',owner:'مسؤول الصلاحيات',owner_role:'admin'}],next:'اطلب ممن يدير الهيكل معالجته'});
  const row=typeof noticeId==='string'?db.prepare('SELECT * FROM undeliverable_notices WHERE id=? AND tenant_id=?').get(noticeId,u.tenant_id):null;
  if(!row)refuse(404,'not_found',{what:'الإشعار غير موجود في سجل «بلا مستلم»',next:'حدّث الصفحة واختره من القائمة'});
  if(db.prepare('SELECT 1 FROM undeliverable_notice_resolutions WHERE notice_id=? AND tenant_id=?').get(row.id,u.tenant_id))refuse(409,'decided',{what:'عولج هذا الإشعار من قبل',next:'لا إجراء مطلوب'});
  const note=v.text(input.note,'ما الذي فُعل لسدّ الفراغ',1000,10);
  db.prepare('INSERT INTO undeliverable_notice_resolutions(notice_id,tenant_id,resolved_by,note,resolved_at) VALUES(?,?,?,?,?)').run(row.id,u.tenant_id,u.id,note,now());
  audit(db,u,'undeliverable_notice',row.id,'notice.undeliverable_resolved',{}, {kind:row.kind,subject_kind:row.subject_kind,department_id:row.department_id},note);
  return undeliverableBoard(db,u);
}
