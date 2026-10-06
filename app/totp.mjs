import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import { seal, unseal } from './crypto-fields.mjs';
import { isSuperAdmin, CAPABILITIES } from './access.mjs';
import { mfaResetAlert } from './security-alerts.mjs';

// التحقق بخطوتين بمعيار TOTP (RFC 6238: HMAC-SHA1، ثلاثون ثانية، ستة أرقام). يعمل مع أي تطبيق مصادقة دون خدمة خارجية.
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32=bytes=>{let bits='',out='';for(const b of bytes)bits+=b.toString(2).padStart(8,'0');for(let i=0;i<bits.length;i+=5)out+=ALPHABET[parseInt(bits.slice(i,i+5).padEnd(5,'0'),2)];return out;};
const fromBase32=text=>{let bits='';for(const c of text)bits+=ALPHABET.indexOf(c).toString(2).padStart(5,'0');const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));return Buffer.from(bytes);};
export function codeAt(secret,step){
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
  const digest=createHmac('sha1',fromBase32(secret)).update(counter).digest(),offset=digest[19]&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
const stepNow=(time=Date.now())=>Math.floor(time/30000);
// يقبل الخطوة الحالية وجارتيها لفرق الساعات، ويرفض أي خطوة استُخدمت من قبل.
function matchStep(secret,code,lastStep,time=Date.now()){
  if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
  for(const step of [stepNow(time),stepNow(time)-1,stepNow(time)+1])if(step>lastStep&&timingSafeEqual(Buffer.from(codeAt(secret,step)),Buffer.from(code)))return step;
  return null;
}
const recoveryHash=(userId,code)=>hash(`${userId}:recovery:${code}`);
const row=(db,userId)=>db.prepare('SELECT * FROM user_totp WHERE user_id=?').get(userId)??null;

export function totpStatus(db,user){
  const r=row(db,user.id);
  if(!r)return {enabled:false,pending:false};
  if(r.enabled_at)return {enabled:true,pending:false,enabled_at:r.enabled_at,recovery_left:JSON.parse(r.recovery).length};
  const secret=unseal(r.secret);
  // السر يظهر لصاحبه فقط وأثناء التفعيل فقط.
  return {enabled:false,pending:true,secret,uri:`otpauth://totp/${encodeURIComponent('3,6T:'+user.username)}?secret=${secret}&issuer=${encodeURIComponent('3,6T')}&algorithm=SHA1&digits=6&period=30`};
}
export function startTotp(db,user){
  if(!db.isTransaction)fail(500,'transaction_required','يتطلب تفعيل التحقق بخطوتين معاملة');
  const existing=row(db,user.id);
  if(existing?.enabled_at)fail(409,'already_enabled','التحقق بخطوتين مفعّل. عطّله أولًا لتبديل الجهاز');
  const secret=base32(randomBytes(20));
  db.prepare('INSERT INTO user_totp(user_id,tenant_id,secret,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,created_at=excluded.created_at,last_step=0').run(user.id,user.tenant_id,seal(secret),now());
  audit(db,user,'user',user.id,'totp.started');
  return totpStatus(db,user);
}
export function confirmTotp(db,user,input,keepTokenHash=''){
  if(!db.isTransaction)fail(500,'transaction_required','يتطلب تفعيل التحقق بخطوتين معاملة');
  const r=row(db,user.id);
  if(!r||r.enabled_at)fail(409,'not_pending','ابدأ التفعيل أولًا');
  const step=matchStep(unseal(r.secret),input?.code,r.last_step);
  if(step===null)fail(400,'invalid_otp','الرمز غير صحيح. تأكد من وقت جهازك وأدخل الرمز الحالي');
  const codes=Array.from({length:8},()=>`${randomBytes(2).toString('hex')}-${randomBytes(2).toString('hex')}`);
  db.prepare('UPDATE user_totp SET enabled_at=?,last_step=?,recovery=? WHERE user_id=?').run(now(),step,JSON.stringify(codes.map(c=>recoveryHash(user.id,c))),user.id);
  // الجلسات الأخرى فُتحت بكلمة المرور وحدها، فتنتهي؛ تبقى الجلسة التي أثبتت الرمز.
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id,keepTokenHash);
  audit(db,user,'user',user.id,'totp.enabled',{}, {other_sessions_revoked:true});
  // تظهر رموز الاسترداد مرة واحدة فقط؛ لا تُحفظ إلا بصماتها.
  return {enabled:true,recovery_codes:codes};
}
export function disableTotp(db,user,input,verifyPassword){
  if(!db.isTransaction)fail(500,'transaction_required','يتطلب التعطيل معاملة');
  const r=row(db,user.id);
  if(!r?.enabled_at)fail(409,'not_enabled','التحقق بخطوتين غير مفعّل');
  const current=db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
  if(typeof input?.current_password!=='string'||!verifyPassword(input.current_password,current.password_hash))fail(403,'invalid_credentials','كلمة المرور الحالية غير صحيحة');
  if(matchStep(unseal(r.secret),input?.code,r.last_step)===null)fail(400,'invalid_otp','رمز التحقق غير صحيح');
  db.prepare('DELETE FROM user_totp WHERE user_id=?').run(user.id);
  audit(db,user,'user',user.id,'totp.disabled');
  return {enabled:false};
}
// من فقد جهازه ورموزه: الأدمن الأول يعيد الضبط بسبب مكتوب، وتنتهي جلسات الحساب.
export function resetTotp(db,admin,userId,input){
  if(!db.isTransaction)fail(500,'transaction_required','يتطلب إعادة الضبط معاملة');
  if(!isSuperAdmin(admin))fail(403,'forbidden','إعادة ضبط التحقق بخطوتين للأدمن الأول فقط');
  const target=db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=?').get(userId,admin.tenant_id);
  if(!target||!row(db,target.id))fail(404,'not_found','لا يوجد تحقق بخطوتين لهذا الحساب');
  if(typeof input?.reason!=='string'||input.reason.trim().length<10)fail(400,'reason','اكتب سبب إعادة الضبط وكيف تحققت من هوية صاحب الحساب');
  db.prepare('DELETE FROM user_totp WHERE user_id=?').run(target.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
  audit(db,admin,'user',target.id,'totp.reset',{}, {sessions_revoked:true},input.reason.trim());
  mfaResetAlert(db,admin,target.id);
  return {reset:true};
}
// يُستدعى من تسجيل الدخول بعد صحة كلمة المرور. يعيد 'ok' أو 'required' أو 'invalid'.
export function checkLoginOtp(db,user,otp){
  const r=row(db,user.id);
  if(!r?.enabled_at)return 'ok';
  if(otp===undefined||otp===null||otp==='')return 'required';
  if(typeof otp!=='string'||otp.length>20)return 'invalid';
  const clean=otp.trim().toLowerCase();
  const step=matchStep(unseal(r.secret),clean,r.last_step);
  if(step!==null){db.prepare('UPDATE user_totp SET last_step=? WHERE user_id=?').run(step,user.id);return 'ok';}
  const hashes=JSON.parse(r.recovery),index=hashes.indexOf(recoveryHash(user.id,clean));
  if(index>=0){hashes.splice(index,1);db.prepare('UPDATE user_totp SET recovery=? WHERE user_id=?').run(JSON.stringify(hashes),user.id);audit(db,user,'user',user.id,'totp.recovery_used',{}, {left:hashes.length});return 'ok';}
  return 'invalid';
}

// سياسة الكيان: إلزام التحقق بخطوتين لحاملي التصاريح الحساسة (الرواتب، العقود، الحسابات البنكية، اعتماد السياسات).
export function securityPolicy(db,user){
  if(!isSuperAdmin(user))return null;
  const sensitive=CAPABILITIES.filter(c=>c.sensitive),keys=sensitive.map(c=>c.key),marks=keys.map(()=>'?').join(',');
  const holders=db.prepare(`SELECT DISTINCT x.id,x.name,x.role FROM users x LEFT JOIN access_grants g ON g.user_id=x.id AND g.revoked_at IS NULL AND g.capability IN (${marks}) WHERE x.tenant_id=? AND x.active=1 AND (g.id IS NOT NULL OR x.role IN (${sensitive.flatMap(c=>c.roles??[]).map(()=>'?').join(',')||"''"})) ORDER BY x.name`).all(...keys,user.tenant_id,...sensitive.flatMap(c=>c.roles??[]))
    .map(h=>({...h,mfa:!!db.prepare('SELECT 1 FROM user_totp WHERE user_id=? AND enabled_at IS NOT NULL').get(h.id)}));
  const row=db.prepare('SELECT * FROM security_settings WHERE tenant_id=?').get(user.tenant_id);
  return {require_mfa_for_sensitive:!!row?.require_mfa_for_sensitive,updated_at:row?.updated_at??null,sensitive_capabilities:sensitive.map(c=>c.name),holders,without_mfa:holders.filter(h=>!h.mfa).length};
}
export function setSecurityPolicy(db,admin,input){
  if(!db.isTransaction)fail(500,'transaction_required','يتطلب تغيير السياسة معاملة');
  if(!isSuperAdmin(admin))fail(403,'forbidden','سياسة الأمان للأدمن الأول فقط');
  if(!input||typeof input.require_mfa_for_sensitive!=='boolean'||typeof input.reason!=='string'||input.reason.trim().length<10||Object.keys(input).some(k=>!['require_mfa_for_sensitive','reason'].includes(k)))fail(400,'invalid_fields','حدد القيمة واكتب السبب');
  db.prepare('INSERT INTO security_settings(tenant_id,require_mfa_for_sensitive,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET require_mfa_for_sensitive=excluded.require_mfa_for_sensitive,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(admin.tenant_id,input.require_mfa_for_sensitive?1:0,admin.id,now());
  audit(db,admin,'security',admin.tenant_id,'security.mfa_policy',{}, {require_mfa_for_sensitive:input.require_mfa_for_sensitive},input.reason.trim());
  return securityPolicy(db,admin);
}
