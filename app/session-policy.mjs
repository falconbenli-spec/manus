import { audit, now } from './db.mjs';
import { CAPABILITIES, isSuperAdmin } from './access.mjs';

// مهلة الخمول (P2-3). القيم قرار المالك: البذرة مسودة 30 دقيقة للجلسة التي تحمل تصريحًا حساسًا أو حساب إدارة المنصة،
// ولا مهلة لغيرها. المسودة مطبقة كما هي إلى أن يعتمد المالك قيمًا أخرى أو يلغيها.
// «نشاط» = طلب من الجلسة إلى الخادم. آخر نشاط يُحدَّث كل دقيقة على الأكثر، فلا كتابة مع كل طلب.
export const IDLE_DEFAULTS={sensitive:30,other:null};
// تُحسب عند أول استعمال لا عند التحميل: auth.mjs يستورد هذه الوحدة، وaccess.mjs قد يكون في منتصف تحميله (استيراد دائري).
let cached=null;
const sensitive=()=>{if(!cached){const list=CAPABILITIES.filter(c=>c.sensitive);cached={list,keys:JSON.stringify(list.map(c=>c.key)),roles:new Set(list.flatMap(c=>c.roles??[]))};}return cached;};

export function idlePolicy(db,tenantId){
  const row=db.prepare('SELECT idle_sensitive_minutes,idle_other_minutes,idle_policy_status,idle_policy_basis,updated_at FROM security_settings WHERE tenant_id=?').get(tenantId);
  if(!row)return {sensitive:IDLE_DEFAULTS.sensitive,other:IDLE_DEFAULTS.other,status:'draft',basis:''};
  return {sensitive:row.idle_sensitive_minutes??null,other:row.idle_other_minutes??null,status:row.idle_policy_status,basis:row.idle_policy_basis};
}
// الجلسة «حساسة» إن كان صاحبها مسؤول منصة، أو دوره يمنح تصريحًا حساسًا افتراضيًا، أو يحمل منحًا حساسًا ساريًا.
export function holdsSensitive(db,user){
  if(user.role==='admin'||sensitive().roles.has(user.role))return true;
  return !!db.prepare('SELECT 1 FROM access_grants WHERE user_id=? AND tenant_id=? AND revoked_at IS NULL AND capability IN (SELECT value FROM json_each(?)) LIMIT 1').get(user.id,user.tenant_id,sensitive().keys);
}
export function idleLimitMs(db,user){
  const policy=idlePolicy(db,user.tenant_id),minutes=holdsSensitive(db,user)?policy.sensitive:policy.other;
  return minutes?minutes*60000:null;
}
export function idlePolicyView(db,u){
  if(!isSuperAdmin(u))return null;
  const p=idlePolicy(db,u.tenant_id);
  return {...p,status_name:p.status==='approved'?'معتمدة':'مسودة — مطبقة حتى يعتمد المالك قيمة',sensitive_meaning:'حساب إدارة المنصة، أو من يحمل أيًا من التصاريح الحساسة: '+sensitive().list.map(c=>c.name).join('، ')};
}
export function setIdlePolicy(db,admin,input,fail){
  if(!db.isTransaction)fail(500,'transaction_required','يتطلب تغيير السياسة معاملة');
  if(!isSuperAdmin(admin))fail(403,'forbidden','مهلة الخمول للأدمن الأول بقرار المالك');
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['sensitive_minutes','other_minutes','reason'].includes(k)))fail(400,'invalid_fields','حقول الطلب غير صالحة');
  const check=(value,max,label)=>{if(value===null)return null;if(!Number.isInteger(value)||value<5||value>max)fail(400,'idle_minutes',`${label}: من 5 إلى ${max} دقيقة، أو فارغ لعدم المهلة`);return value;};
  const sensitive=check(input.sensitive_minutes??null,720,'مهلة الجلسات الحساسة'),other=check(input.other_minutes??null,1440,'مهلة بقية الجلسات');
  if(typeof input.reason!=='string'||input.reason.trim().length<10)fail(400,'reason','اكتب مصدر القرار ومن اتخذه');
  const before=idlePolicy(db,admin.tenant_id);
  db.prepare("INSERT INTO security_settings(tenant_id,idle_sensitive_minutes,idle_other_minutes,idle_policy_status,idle_policy_basis,updated_by,updated_at) VALUES(?,?,?,'approved',?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET idle_sensitive_minutes=excluded.idle_sensitive_minutes,idle_other_minutes=excluded.idle_other_minutes,idle_policy_status='approved',idle_policy_basis=excluded.idle_policy_basis,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
    .run(admin.tenant_id,sensitive,other,input.reason.trim(),admin.id,now());
  audit(db,admin,'security',admin.tenant_id,'security.idle_policy',{sensitive:before.sensitive,other:before.other,status:before.status},{sensitive,other,status:'approved'},input.reason.trim());
  return idlePolicyView(db,admin);
}
