import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { acceptedPolicy } from './hr-contracts.mjs';
import { notifySubject } from './notices.mjs';
import { registerHandler, enqueue } from './jobs.mjs';
import { classifyLocation, locationInput } from './attendance-policy.mjs';

// الحضور بالموقع قرينةً لا بوابة (P1 #5): الخادم يحسب المسافة إلى أقرب موقع معتمد ويعلّم البصمة، ولا يرفضها أبدًا.
// خارج النطاق أو بلا موقع ← «يحتاج توضيحًا». الإحداثيات الخام تُمسح بعد مدة السياسة بمهمة في الطابور، وتبقى النتيجة.
// الميزة لا تعمل إلا بسياسة ساعات عمل مقبولة فيها مدة الحفظ ونص إشعار الخصوصية، وبموقع واحد معتمد على الأقل.
// تنبيه أمانة: موقع المتصفح سهل التزييف. يثبت أن جهازًا «أبلغ» أنه في الموقع، لا أن صاحبه كان هناك.
export const ZONE_NAMES={in_zone:'داخل النطاق',out_of_zone:'خارج النطاق — يحتاج توضيحًا',no_location:'بلا موقع — يحتاج توضيحًا'};
export const ZONE_NOTES={low_accuracy:'دقة الموقع أضعف من الحد المقبول',denied:'لم يسمح المتصفح بالوصول إلى الموقع',unavailable:'تعذر تحديد الموقع',timeout:'انتهت مهلة تحديد الموقع',unsupported:'المتصفح لا يدعم تحديد الموقع',not_sent:'لم يُرسل موقع',notice_not_acknowledged:'لم يُطّلع على إشعار الخصوصية فلم تُحفظ الإحداثيات'};
const SITE_STATUS={proposed:'مقترح — لا يسري',approved:'معتمد',rejected:'مرفوض',retired:'موقوف'};
const PURGE_JOB='attendance.location_purge';
const id=()=>randomUUID();
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const isManagerOf=(db,u,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1').get(userId,u.tenant_id,u.id);

function actor(db,supplied){
  const u=currentUser(db,supplied);if(!u||u.role==='admin')fail(403,'forbidden','الحضور متاح لحسابات الموظفين');
  u.caps=['hr.attendance.manage','hr.attendance.approve'].filter(key=>holds(db,u,key));return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة الحضور معاملة قاعدة بيانات');}
const need=(u,cap,message)=>{if(!u.caps.includes(cap))fail(403,'not_permitted',message);};

// سياسة الموقع السارية: مدة الحفظ ونص الإشعار من سياسة ساعات العمل المقبولة.
export function locationPolicy(db,tenantId,date){
  const policy=acceptedPolicy(db,tenantId,'working_time',date),location=policy?JSON.parse(policy.parameters).location:null;
  return location?{policy_id:policy.id,title:policy.title,...location}:null;
}
export const approvedSites=(db,tenantId)=>db.prepare("SELECT id,name,lat,lng,radius_m FROM attendance_sites WHERE tenant_id=? AND status='approved' ORDER BY name").all(tenantId);
export function locationActive(db,tenantId,date){const policy=locationPolicy(db,tenantId,date),sites=policy?approvedSites(db,tenantId):[];return policy&&sites.length?{policy,sites}:null;}
const acknowledged=(db,userId,policyId)=>!!db.prepare('SELECT 1 FROM attendance_location_notices_seen WHERE user_id=? AND policy_id=?').get(userId,policyId);
const exemptOrMission=(db,userId,date)=>!!db.prepare("SELECT 1 FROM attendance_exemptions WHERE user_id=? AND status='approved' AND from_date<=? AND to_date>=?").get(userId,date,date)||!!db.prepare("SELECT 1 FROM work_missions WHERE user_id=? AND status='approved' AND from_date<=? AND to_date>=?").get(userId,date,date);

// المسح: يمسح كل إحداثيات انقضت مدتها في الكيان، لا صف المهمة وحده، فمهمة لاحقة تغطي ما فات غيرها.
export function purgeExpiredCoordinates(db,tenantId,at=Date.now()){
  const time=new Date(at).toISOString();
  return db.prepare('UPDATE attendance_punch_locations SET lat=NULL,lng=NULL,purged_at=? WHERE tenant_id=? AND lat IS NOT NULL AND purge_after<=?').run(time,tenantId,time).changes;
}
// يُسجَّل عند تحميل الوحدة. الاختبار الذي يمسح سجل المعالجات يعيد تسجيله بهذه الدالة.
export function registerLocationJobs(){
  try{registerHandler(PURGE_JOB,(db,job,{now:at})=>({purged:purgeExpiredCoordinates(db,job.tenant_id,at)}));}catch(error){if(!/already registered/.test(error.message))throw error;}
}
registerLocationJobs();

// يُستدعى من punch داخل معاملته. لا يرمي بسبب الموقع أبدًا إلا لمدخل مشوّه.
export function recordPunchLocation(db,u,{date,kind,location,locationError,noticeAck}){
  const active=locationActive(db,u.tenant_id,date);
  const point=locationInput(location);
  if(locationError!==undefined&&!['denied','unavailable','timeout','unsupported'].includes(locationError))fail(400,'invalid_location','سبب غياب الموقع غير معروف');
  if(noticeAck!==undefined&&noticeAck!==true)fail(400,'invalid_fields','الإقرار بإشعار الخصوصية قيمة true');
  // دون سياسة وموقع معتمد: السلوك كما كان، ولا تُحفظ أي إحداثيات أُرسلت.
  if(!active)return null;
  const {policy,sites}=active,time=now();
  if(noticeAck&&!acknowledged(db,u.id,policy.policy_id))db.prepare('INSERT INTO attendance_location_notices_seen VALUES(?,?,?,?)').run(u.tenant_id,u.id,policy.policy_id,time);
  const seen=acknowledged(db,u.id,policy.policy_id),usable=point&&seen;
  const result=classifyLocation(sites,usable?point:null,policy.max_accuracy_m);
  const note=result.zone_note??(point&&!seen?'notice_not_acknowledged':!point?(locationError??'not_sent'):'');
  const needs=result.zone!=='in_zone'&&!exemptOrMission(db,u.id,date)?1:0,rowId=id();
  const purgeAfter=usable?new Date(Date.parse(time)+policy.retention_days*86400000).toISOString():null;
  db.prepare('INSERT INTO attendance_punch_locations(id,tenant_id,user_id,work_date,kind,zone,zone_note,site_id,distance_m,accuracy_m,lat,lng,needs_explanation,policy_id,captured_at,purge_after) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(rowId,u.tenant_id,u.id,date,kind,result.zone,note,result.site_id,result.distance_m,result.accuracy_m,usable?point.lat:null,usable?point.lng:null,needs,policy.policy_id,time,purgeAfter);
  if(usable){
    registerLocationJobs();
    enqueue(db,u,{type:PURGE_JOB,payload:{location_id:rowId},idempotency_key:`attendance-location-purge:${rowId}`,source:{entity:'attendance_location',id:rowId},due_at:purgeAfter,max_attempts:5});
  }
  // الإحداثيات لا تدخل سجل التدقيق؛ تكفي النتيجة.
  audit(db,u,'attendance_location',rowId,'attendance.location_'+result.zone,{}, {work_date:date,kind,distance_m:result.distance_m,accuracy_m:result.accuracy_m,note});
  return {id:rowId,zone:result.zone,zone_name:ZONE_NAMES[result.zone],zone_note:note,distance_m:result.distance_m,accuracy_m:result.accuracy_m,needs_explanation:!!needs};
}

export function explainLocation(db,supplied,locationId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['explanation']);
  const row=typeof locationId==='string'&&db.prepare("SELECT * FROM attendance_punch_locations WHERE id=? AND tenant_id=? AND user_id=? AND needs_explanation=1 AND reviewed_by IS NULL").get(locationId,u.tenant_id,u.id);
  if(!row)fail(404,'not_found','لا توجد بصمة تحتاج توضيحك');
  db.prepare('UPDATE attendance_punch_locations SET explanation=?,explained_at=? WHERE id=?').run(v.text(input.explanation,'التوضيح',1000,5),now(),row.id);
  audit(db,u,'attendance_location',row.id,'attendance.location_explained',{}, {work_date:row.work_date});
  return {id:row.id};
}
export function reviewLocation(db,supplied,locationId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['note']);
  const row=typeof locationId==='string'&&db.prepare('SELECT * FROM attendance_punch_locations WHERE id=? AND tenant_id=? AND needs_explanation=1 AND reviewed_by IS NULL').get(locationId,u.tenant_id);
  if(!row||row.user_id===u.id||!(isManagerOf(db,u,row.user_id)||u.caps.includes('hr.attendance.manage')))fail(404,'not_found','البصمة غير متاحة للمراجعة');
  db.prepare('UPDATE attendance_punch_locations SET reviewed_by=?,reviewed_at=?,review_note=? WHERE id=?').run(u.id,now(),v.text(input.note,'نتيجة المراجعة',1000,3),row.id);
  audit(db,u,'attendance_location',row.id,'attendance.location_reviewed',{}, {work_date:row.work_date});
  notifySubject(db,{userId:row.user_id,kind:'attendance_location_reviewed',subjectKind:'attendance_location',subjectId:row.id,title:`روجعت بصمة ${row.kind==='in'?'حضورك':'انصرافك'} ليوم ${row.work_date}`,body:'نتيجة المراجعة مكتوبة في «حضوري». المراجعة لا تخصم شيئًا.'});
  return {id:row.id};
}

export function proposeSite(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.attendance.manage','اقتراح مواقع الحضور لموظفي الموارد البشرية المخولين');
  v.object(input,['name','lat','lng','radius_m']);
  const point=locationInput({lat:input.lat,lng:input.lng,accuracy:0});
  if(!Number.isInteger(input.radius_m)||input.radius_m<50||input.radius_m>2000||input.radius_m%25)fail(400,'radius','نصف القطر من 50 إلى 2000 متر بخطوات 25');
  const siteId=id();
  db.prepare("INSERT INTO attendance_sites(id,tenant_id,name,lat,lng,radius_m,status,proposed_by,created_at) VALUES(?,?,?,?,?,?,'proposed',?,?)").run(siteId,u.tenant_id,v.text(input.name,'اسم الموقع',120,2),point.lat,point.lng,input.radius_m,u.id,now());
  audit(db,u,'attendance_site',siteId,'attendance_site.proposed',{}, {radius_m:input.radius_m});
  return {id:siteId};
}
export function decideSite(db,supplied,siteId,decision,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['note']);
  const s=typeof siteId==='string'&&db.prepare('SELECT * FROM attendance_sites WHERE id=? AND tenant_id=?').get(siteId,u.tenant_id);
  if(!s)fail(404,'not_found','الموقع غير متاح');
  const time=now();
  if(decision==='retire'){
    need(u,'hr.attendance.manage','إيقاف المواقع لموظفي الموارد البشرية المخولين');
    if(s.status!=='approved')fail(409,'invalid_state','يُوقف الموقع المعتمد فقط');
    db.prepare("UPDATE attendance_sites SET status='retired',retired_by=?,retired_at=?,retire_reason=? WHERE id=?").run(u.id,time,v.text(input.note,'سبب الإيقاف',1000,10),s.id);
  }else if(['approve','reject'].includes(decision)){
    need(u,'hr.attendance.approve','اعتماد مواقع الحضور خارج صلاحيتك');
    if(s.status!=='proposed')fail(409,'invalid_state','الموقع ليس مقترحًا');
    if(s.proposed_by===u.id)fail(409,'separation_of_duties','من اقترح الموقع لا يعتمده');
    db.prepare('UPDATE attendance_sites SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(decision==='approve'?'approved':'rejected',u.id,time,v.text(input.note,'أساس القرار',1000,decision==='approve'?3:10),s.id);
    notifySubject(db,{userId:s.proposed_by,kind:'attendance_site_'+decision,subjectKind:'attendance_site',subjectId:s.id,title:decision==='approve'?`اعتُمد موقع الحضور «${s.name}»`:`رُفض موقع الحضور «${s.name}»`,body:decision==='approve'?'يُقاس عليه موقع البصمات من الآن، ولا يمنع أحدًا من التسجيل.':'سبب الرفض مكتوب في شاشة الحضور.'});
  }else fail(404,'not_found','الإجراء غير متاح');
  audit(db,u,'attendance_site',s.id,'attendance_site.'+decision,{status:s.status},{});
  return {id:s.id};
}

// ما يراه كل حساب من الموقع: المواقع المعتمدة (ليقيس المتصفح المسافة قبل البصمة للعرض فقط)، وإشعار الخصوصية، وبصماته المعلّمة.
export function locationBoard(db,u,today){
  const policy=locationPolicy(db,u.tenant_id,today),sites=approvedSites(db,u.tenant_id);
  const manage=u.caps.includes('hr.attendance.manage'),approve=u.caps.includes('hr.attendance.approve');
  const team=db.prepare('SELECT id FROM users WHERE tenant_id=? AND manager_id=? AND active=1').all(u.tenant_id,u.id).map(r=>r.id);
  const view=r=>({id:r.id,user_id:r.user_id,employee_name:name(db,r.user_id),work_date:r.work_date,kind:r.kind,zone:r.zone,zone_name:ZONE_NAMES[r.zone],zone_note:r.zone_note,zone_note_name:ZONE_NOTES[r.zone_note]??'',distance_m:r.distance_m,accuracy_m:r.accuracy_m,site_name:r.site_id?db.prepare('SELECT name FROM attendance_sites WHERE id=?').get(r.site_id)?.name??null:null,
    explanation:r.explanation,reviewed_by_name:name(db,r.reviewed_by),review_note:r.review_note,coordinates_kept:r.lat!==null,purge_after:r.purge_after,
    actions:r.reviewed_by||!r.needs_explanation?[]:r.user_id===u.id?(r.explanation?[]:['explain_location']):['review_location']});
  const mine=db.prepare('SELECT * FROM attendance_punch_locations WHERE user_id=? AND needs_explanation=1 ORDER BY captured_at DESC LIMIT 60').all(u.id).map(view);
  const scope=manage||approve?'':`AND user_id IN (${team.map(()=>'?').join(',')||"''"})`;
  const review=manage||approve||team.length?db.prepare(`SELECT * FROM attendance_punch_locations WHERE tenant_id=? AND needs_explanation=1 AND reviewed_by IS NULL AND user_id<>? ${scope} ORDER BY captured_at DESC LIMIT 100`).all(u.tenant_id,u.id,...(scope?team:[])).map(view):[];
  const allSites=manage||approve?db.prepare('SELECT * FROM attendance_sites WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100').all(u.tenant_id).map(s=>({...s,status_name:SITE_STATUS[s.status],proposed_by_name:name(db,s.proposed_by),decided_by_name:name(db,s.decided_by),
    actions:s.status==='proposed'&&s.proposed_by!==u.id&&approve?['approve_site','reject_site']:s.status==='approved'&&manage?['retire_site']:[]})):null;
  const overdue=manage?db.prepare('SELECT COUNT(*) AS n FROM attendance_punch_locations WHERE tenant_id=? AND lat IS NOT NULL AND purge_after<=?').get(u.tenant_id,now()).n:null;
  return {active:!!(policy&&sites.length),policy:policy?{policy_id:policy.policy_id,retention_days:policy.retention_days,max_accuracy_m:policy.max_accuracy_m,privacy_notice:policy.privacy_notice}:null,
    notice_acknowledged:policy?acknowledged(db,u.id,policy.policy_id):false,sites:sites.map(s=>({id:s.id,name:s.name,lat:s.lat,lng:s.lng,radius_m:s.radius_m})),
    mine,review,all_sites:allSites,coordinates_past_retention:overdue,zone_names:ZONE_NAMES,
    rule:'الموقع قرينة تُعلَّم ولا تمنع: البصمة تُسجَّل دائمًا، وخارج النطاق أو بلا موقع «يحتاج توضيحًا» فقط. موقع المتصفح سهل التزييف؛ يثبت أن جهازًا أبلغ بموقعه لا أن صاحبه كان هناك.'};
}
