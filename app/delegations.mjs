import { randomUUID } from 'node:crypto';
import { audit,now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { viewingAs } from './request-context.mjs';
import { MAX_DELEGATION_DAYS, authorityCapDays } from './authority-limits.mjs';

const roles=['manager','hr','it','pm'];
// أفق تقني لا نظامي، وهو أفق أعلام التشغيل نفسه (MAX_FLAG_DAYS في app/feature-flags.mjs) عمدًا لا مصادفة:
// ليس حكمًا على المدة التي تُغطّى بها غيبة، بل حدٌّ يمنع «حتى 2099». التفويض الدائم نقلُ صلاحية لا تفويض،
// ونقل الصلاحية بابه access.mjs بشروطه، لا هذا الباب. والتمديد بعده تفويض جديد بسببه المكتوب، لا تاريخ يُنسى.
// الرقم قابل لأن يقرره المالك كقيمة معتمدة مؤرَّخة (الترحيل 134: «النسخة 0 = افتراضات الكود»)، وهذا هو الافتراض.
// الثابت والقارئ في app/authority-limits.mjs — وحدة طرفية بلا استيرادات، لأن هذه الوحدة يستوردها access.mjs.
export { MAX_DELEGATION_DAYS } from './authority-limits.mjs';
// «جرّب كمستخدم»: صف صاحب التجربة يعود بدور الشخصية المختارة وبلا مستوى إداري، وهويته هي هي (app/view-as.mjs).
export const currentUser=(db,u)=>{const row=db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=? AND active=1').get(u?.id,u?.tenant_id),run=row&&viewingAs(row);return run?{...row,role:run.persona,admin_level:null}:row;};
function actor(db,u){const value=currentUser(db,u);if(!value)fail(403,'inactive','الحساب غير نشط');return value;}
function timestamp(value,label){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail(400,'date',`${label}: يلزم وقت UTC كامل`);
  return value;
}
export function delegationFor(db,u,principal,serviceCode){
  const a=currentUser(db,u),p=currentUser(db,principal);
  if(!a||!p||a.id===p.id||a.role!==p.role||a.department_id!==p.department_id||a.tenant_id!==p.tenant_id)return null;
  const time=new Date(Date.now()).toISOString();
  return db.prepare(`SELECT * FROM approval_delegations WHERE tenant_id=? AND grantor_id=? AND delegate_id=? AND service_code=? AND role=? AND department_id=? AND revoked_at IS NULL AND starts_at<=? AND ends_at>? ORDER BY created_at,id LIMIT 1`).get(a.tenant_id,p.id,a.id,serviceCode,a.role,a.department_id,time,time)??null;
}
export function listDelegations(db,u){
  u=actor(db,u);
  const records=db.prepare(`SELECT d.*,g.name AS grantor_name,r.name AS delegate_name FROM approval_delegations d JOIN users g ON g.id=d.grantor_id JOIN users r ON r.id=d.delegate_id WHERE d.tenant_id=? AND (d.grantor_id=? OR d.delegate_id=?) ORDER BY d.created_at DESC,d.id`).all(u.tenant_id,u.id,u.id);
  return {records:records.map(d=>({...d,effective:delegationFor(db,{id:d.delegate_id,tenant_id:d.tenant_id},{id:d.grantor_id,tenant_id:d.tenant_id},d.service_code)?.id===d.id,can_revoke:d.grantor_id===u.id&&!d.revoked_at})),
    candidates:roles.includes(u.role)?db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND department_id=? AND role=? AND active=1 AND id<>? ORDER BY name').all(u.tenant_id,u.department_id,u.role,u.id):[],
    services:roles.includes(u.role)?db.prepare('SELECT code,name_ar,approval_policy,department_id FROM services s WHERE s.tenant_id=? AND active=1 AND version=(SELECT MAX(version) FROM services n WHERE n.tenant_id=s.tenant_id AND n.code=s.code)').all(u.tenant_id).filter(s=>{const steps=JSON.parse(s.approval_policy).steps;return steps.some(step=>(typeof step==='string'?step:step?.role)===u.role)&&(u.role==='manager'||u.department_id===s.department_id)||u.role==='manager'&&steps.includes('department_manager')&&u.department_id===s.department_id;}).map(s=>({code:s.code,name:s.name_ar})):[]};
}
export function getDelegation(db,u,id){const record=listDelegations(db,u).records.find(d=>d.id===id);if(!record)fail(404,'not_found','التفويض غير متاح');return record;}
export function createDelegation(db,u,input){
  u=actor(db,u);v.object(input,['delegate_id','service_code','starts_at','ends_at','reason']);
  if(!roles.includes(u.role))fail(403,'forbidden','هذا الدور لا يفوض قرارات اعتماد');
  const available=listDelegations(db,u);
  if(!available.candidates.some(d=>d.id===input.delegate_id))fail(403,'delegate_scope','يلزم معتمد آخر نشط من الدور والإدارة نفسيهما');
  if(!available.services.some(s=>s.code===input.service_code))fail(403,'service_scope','الخدمة خارج نطاق اعتمادك');
  const starts=timestamp(input.starts_at,'بداية التفويض'),ends=timestamp(input.ends_at,'نهاية التفويض'),time=new Date(Date.now()).toISOString();
  if(ends<=starts||ends<=time)fail(400,'interval','الفترة منتهية أو غير صالحة');
  // السقف: ما تبنّاه المالك إن وُجد، وإلا سقف الكود. وحدّ المفتاح الأعلى هو السقف نفسه، فالتبني يشدّ ولا يوسّع.
  const capDays=authorityCapDays(db,u.tenant_id,'delegation_max_days',MAX_DELEGATION_DAYS);
  if(Date.parse(ends)-Date.parse(starts)>capDays*86400000)fail(400,'interval',`أقصى مدة للتفويض ${capDays} يومًا. التفويض الدائم نقلُ صلاحية لا تفويض`);
  if(db.prepare('SELECT 1 FROM approval_delegations WHERE grantor_id=? AND service_code=? AND revoked_at IS NULL AND starts_at<? AND ends_at>?').get(u.id,input.service_code,ends,starts))fail(409,'overlap','يوجد تفويض متداخل للخدمة؛ ألغِه قبل إنشاء بديل');
  const id=randomUUID(),reason=v.text(input.reason,'سبب التفويض',1000,3);
  db.prepare('INSERT INTO approval_delegations(id,tenant_id,grantor_id,delegate_id,service_code,role,department_id,starts_at,ends_at,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,u.tenant_id,u.id,input.delegate_id,input.service_code,u.role,u.department_id,starts,ends,reason,now());
  audit(db,u,'delegation',id,'delegation.created',{}, {delegate_id:input.delegate_id,service_code:input.service_code,starts_at:starts,ends_at:ends},reason);
  return getDelegation(db,u,id);
}
export function revokeDelegation(db,u,id,input){
  u=actor(db,u);v.object(input,['version','note']);const record=getDelegation(db,u,id);v.version(input.version,record.version);
  if(!record.can_revoke)fail(403,'forbidden','إلغاء التفويض متاح لصاحبه فقط');
  const note=v.text(input.note,'سبب الإلغاء',1000,3);
  db.prepare('UPDATE approval_delegations SET revoked_at=?,revocation_reason=?,version=version+1 WHERE id=?').run(now(),note,id);
  audit(db,u,'delegation',id,'delegation.revoked',{version:record.version},{version:record.version+1},note);
  return getDelegation(db,u,id);
}
