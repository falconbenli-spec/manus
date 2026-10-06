import { notifySubject } from './notices.mjs';

// تنبيهات الأمان لمسؤولي المنصة (REF-APP-ENGINEERING §3، P2-5): محاولات دخول فاشلة متكررة، وإعادة ضبط التحقق بخطوتين،
// ومنح تصريح حساس، وحساب إداري جديد. التنبيه إشعار داخل المنصة (والبريد يتبع تفضيل المستلم وفئة «تنبيهات الأمان»).
// لا عنوان IP ولا كلمة مرور ولا رمز في النص: اسم الحساب وما حدث فقط. من قام بالفعل لا يُنبَّه بفعله.
export const FAILED_LOGIN_THRESHOLD=5;
const admins=(db,tenantId)=>db.prepare("SELECT id FROM users WHERE tenant_id=? AND role='admin' AND active=1 ORDER BY id").all(tenantId).map(r=>r.id);

export function alertAdmins(db,tenantId,{kind,subjectId,title,body='',actorId=null}){
  let sent=0;
  for(const userId of admins(db,tenantId)){if(userId===actorId)continue;notifySubject(db,{userId,kind:'security_'+kind,subjectKind:'security',subjectId,title,body,category:'security'});sent++;}
  return sent;
}
// صاحب الحساب يُبلَّغ بما جرى على حسابه ولو لم يكن مسؤولًا (إعادة ضبط، منح حساس).
export function alertAccountOwner(db,{userId,kind,title,body=''}){
  return notifySubject(db,{userId,kind:'account_'+kind,subjectKind:'account_security',subjectId:userId,title,body,category:'security'});
}

const accountName=(db,userId)=>db.prepare('SELECT name,username,tenant_id FROM users WHERE id=?').get(userId);

// تُستدعى بعد تسجيل محاولة فاشلة. التنبيه مرة واحدة عند بلوغ العتبة في نافذة الحساب ذاتها (15 دقيقة لكل حساب وعنوان).
export function failedLoginAlert(db,user,failures){
  if(!user||failures!==FAILED_LOGIN_THRESHOLD)return 0;
  return alertAdmins(db,user.tenant_id,{kind:'failed_logins',subjectId:user.id,title:`تنبيه أمني: ${FAILED_LOGIN_THRESHOLD} محاولات دخول فاشلة على الحساب ${user.username}`,body:'قد تكون محاولة تخمين لكلمة المرور. الحساب يُقفل مؤقتًا بعد عشر محاولات. راجع الحساب وتواصل مع صاحبه.'});
}
export function mfaResetAlert(db,admin,targetId){
  const target=accountName(db,targetId);if(!target)return 0;
  alertAccountOwner(db,{userId:targetId,kind:'mfa_reset',title:'أُعيد ضبط التحقق بخطوتين لحسابك',body:'سُجّلت خارجًا من كل الأجهزة. فعّل التحقق من جديد من «أمان حسابي». إن لم تطلب ذلك فأبلغ مسؤول المنصة فورًا.'});
  return alertAdmins(db,target.tenant_id,{kind:'mfa_reset',subjectId:targetId,actorId:admin.id,title:`تنبيه أمني: أُعيد ضبط التحقق بخطوتين للحساب ${target.username}`,body:`نفّذه ${admin.name}. السبب في سجل التدقيق.`});
}
export function sensitiveGrantAlert(db,admin,targetId,capabilityName){
  const target=accountName(db,targetId);if(!target)return 0;
  alertAccountOwner(db,{userId:targetId,kind:'sensitive_grant',title:`مُنحت تصريحًا حساسًا: ${capabilityName}`,body:'إن لم تتوقع هذا المنح فأبلغ مسؤول المنصة.'});
  return alertAdmins(db,target.tenant_id,{kind:'sensitive_grant',subjectId:targetId,actorId:admin.id,title:`تنبيه أمني: منح تصريح حساس للحساب ${target.username}`,body:`التصريح: ${capabilityName}. منحه ${admin.name}.`});
}
export function newAdminAlert(db,admin,targetId,levelName){
  const target=accountName(db,targetId);if(!target)return 0;
  return alertAdmins(db,target.tenant_id,{kind:'new_admin',subjectId:targetId,actorId:admin.id,title:`تنبيه أمني: صلاحية إدارة جديدة للحساب ${target.username}`,body:`المستوى: ${levelName}. نفّذه ${admin.name}.`});
}
