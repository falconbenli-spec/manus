import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { hash, audit, transaction } from './db.mjs';
import { checkLoginOtp } from './totp.mjs';
import { failedLoginAlert } from './security-alerts.mjs';
import { idleLimitMs } from './session-policy.mjs';

export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, code, message) => { throw new AppError(status, code, message); };
export const publicUser = u => ({ id:u.id, name:u.name, username:u.username, role:u.role, tenant_id:u.tenant_id, department_id:u.department_id, ...(u.must_change_password?{must_change_password:true}:{}) });
/* ───── اشتقاق كلمة المرور ─────────────────────────────────────────────────────
   المعاملات تُكتب **داخل الصف نفسه**: `scrypt$N$r$p$ملح$مفتاح`. كانت مكتوبة في الكود وحده،
   فرفعُها كان يكسر التحقق من كل تجزئة قائمة دفعةً واحدة — يُطرد كل من في المنصة ولا يدخل أحد.
   الصف الذي يحمل معاملاته يُقرأ بها هو، فالرفع لا يكسر شيئًا، والصف القديم (`ملح:مفتاح`) يُقرأ
   بمعاملات زمنه المكتوبة أدناه ويُعاد كتابته بالحالية عند أول دخول ناجح به (انظر login).
   والحد الحالي N=2^17 r=8 p=1 هو الأدنى الموصى به لـscrypt. مقيسًا على جهاز المالك يوم كتابة هذا:
   الاشتقاق الواحد 260 إلى 420 مللي ثانية بعد أن كان 31 — ثمانية أضعاف إلى ثلاثة عشر ضعفًا. من سرق
   نسخة من ملف القاعدة صار يدفعها عن كل كلمة يجرّبها، والدخول الواحد يدفعها مرة. وأقل كلمة في المنصة
   ثمانية محارف بلا شرط تعقيد، فهذه الكلفة هي الحارس الوحيد بينها وبين من يجرّب بلا اتصال.
   والاشتقاق **متزامن** يحجز حلقة الأحداث: زمنه يعني أن الخادم لا يخدم غيره في أثنائه، وسقوف
   login_attempts هي ما يحدّ ذلك (عشر لكل عنوان واسم، مئتان للعنوان، وACCOUNT_FAILURE_LIMIT للحساب). */
export const SCRYPT_PARAMS = {N:131072, r:8, p:1};
// معاملات ما كُتب قبل هذا الإصلاح، وهي غير مكتوبة في تلك الصفوف: تُعرَف بالصيغة وحدها.
const LEGACY_PARAMS = {N:16384, r:8, p:1};
const KEY_BYTES = 64;
// حدّ ذاكرة OpenSSL للاشتقاق الواحد: 128*r*(N+p+2). يُحسب من المعاملات ولا يُكتب رقمًا، فرفعُ N لاحقًا
// لا يحتاج تذكّر رفعه معه. عند N=2^17 هو 128 ميغابايت لاشتقاق واحد، والاشتقاق متزامن فواحد في آن.
const maxmem = ({N,r,p}) => 128*r*(N+p+2);
const derive = (password, salt, params) => scryptSync(password, salt, KEY_BYTES, {...params, maxmem:maxmem(params)});
const workFactor = ({N,r,p}) => N*r*p;

// يقرأ الصيغتين. صفّ لا يُقرأ يعود null ولا يُرمى: حساب بصفّ تالف يُرفض دخوله ولا يُسقط الطلب بخطأ 500
// (واختبارات كثيرة تكتب في العمود قيمًا مثل 'unused' لحسابات لا تسجّل دخولًا).
export function parsePasswordHash(stored) {
  if (typeof stored!=='string') return null;
  if (stored.startsWith('scrypt$')) {
    const parts=stored.split('$');
    if (parts.length!==6) return null;
    const [,n,r,p,salt,key]=parts, params={N:Number(n), r:Number(r), p:Number(p)};
    const sane=Number.isInteger(params.N)&&params.N>=2&&params.N<=2**22&&(params.N&(params.N-1))===0
      &&Number.isInteger(params.r)&&params.r>=1&&params.r<=32&&Number.isInteger(params.p)&&params.p>=1&&params.p<=16;
    if (!sane||!/^[0-9a-f]{16,128}$/.test(salt)||key.length!==KEY_BYTES*2||!/^[0-9a-f]+$/.test(key)) return null;
    return {salt, key, params};
  }
  const [salt,key,...rest]=stored.split(':');
  if (rest.length||!/^[0-9a-f]{32}$/.test(salt)||!/^[0-9a-f]{128}$/.test(key??'')) return null;
  return {salt, key, params:LEGACY_PARAMS};
}
export function passwordHash(password) {
  const salt=randomBytes(16).toString('hex'), {N,r,p}=SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt}$${derive(password,salt,SCRYPT_PARAMS).toString('hex')}`;
}
export function passwordPolicy(password, username='') {
  if (typeof password!=='string'||password.length<8||password.length>200) fail(400,'weak_password','كلمة المرور من 8 إلى 200 حرف');
  if (/^\d+$/.test(password)||password.toLowerCase().includes(String(username).toLowerCase())&&username) fail(400,'weak_password','اختر كلمة مرور لا تكون أرقامًا فقط ولا تتضمن اسم المستخدم');
  return password;
}
export function verifyPassword(password, stored) {
  const parsed=parsePasswordHash(stored);
  // صفّ بصيغة لا تُقرأ: يمرّ باشتقاق كامل ثم يُرفض، فلا يصير الرفض الفوري علامةً على شكل الصف.
  if (!parsed) { derive(String(password??''),'0'.repeat(32),SCRYPT_PARAMS); return false; }
  const expected=Buffer.from(parsed.key,'hex'), actual=derive(password,parsed.salt,parsed.params);
  const same=actual.length===expected.length&&timingSafeEqual(actual,expected);
  // صفّ بمعاملات أقدم يُكمَّل زمنه إلى زمن المعاملات الحالية. بدون هذا يصير زمنُ الرد نفسه دليلًا:
  // ردٌّ سريع = حسابٌ قائم لم يُرقَّ بعد، وردٌّ بطيء = اسمٌ غير موجود (يُقارَن بتجزئة وهمية حالية).
  if (workFactor(parsed.params)<workFactor(SCRYPT_PARAMS)) derive(password,parsed.salt,SCRYPT_PARAMS);
  return same;
}
// الترقية التدريجية: أيّ صفّ اشتُقّ بكلفة أقل من الحالية. المقارنة على الكلفة لا على التساوي، فخفضُ الحد
// لاحقًا (قرار مالك) لا يعيد كتابة الصفوف القائمة أضعفَ مما هي عليه.
export const needsRehash = stored => { const p=parsePasswordHash(stored); return !!p&&workFactor(p.params)<workFactor(SCRYPT_PARAMS); };
// تجزئة وهمية لاسم غير موجود، ليمرّ الاشتقاق نفسه فلا يفرّق زمن الرد بين اسم موجود وغير موجود.
// تُشتق عند أول حاجة لا عند استيراد الوحدة: استيرادها في كل اختبار لا يدفع ثمن اشتقاق كامل.
let dummyHash=null;
const dummy = () => dummyHash??=passwordHash(randomBytes(32).toString('hex'));

// سقف الفشل المتراكم على الحساب الواحد في نافذة ربع الساعة، مهما تعدّدت العناوين.
// قرار المالك: يُرفع إن ضاق بالموظفين، ويُخفض إن لزم تشديد. تغييره هنا وحده يسري على كل المسارات.
export const ACCOUNT_FAILURE_LIMIT = 30;

// ترقية تدريجية بلا أن يُطرد أحد: صفّ بمعاملات أضعف من الحالية يُعاد كتابته عند أول دخول ناجح به.
// الكلمة نفسها لا تتغير، ولا تُبطَل جلسة، ولا يُطلب من الموظف شيء — فتُرقّى المنصة كلها بمرور الأيام.
// وشرط `password_hash=?` يجعلها مقارنةً وتبديلًا: تغييرٌ للكلمة وقع في هذه اللحظة نفسها لا يُدهَس.
// وفشلها لا يمنع دخولًا صحيحًا (قاعدة مقفلة، قرص ممتلئ): يُترك الصف كما هو ويُعاد في الدخول التالي.
const scryptName = ({N,r,p}) => `N=${N},r=${r},p=${p}`;
function upgradeHash(db, user, password) {
  if (!needsRehash(user.password_hash)) return false;
  const was=parsePasswordHash(user.password_hash).params;
  const write=()=>{
    const {changes}=db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(passwordHash(password),user.id,user.password_hash);
    // التجزئة نفسها لا تدخل السجل، لا قبلُ ولا بعدُ: المسجَّل أن المعاملات رُفعت ومن أيٍّ إلى أيّ.
    if (changes) audit(db,user,'user',user.id,'user.password_rehashed',{scrypt:scryptName(was)},
      {scrypt:scryptName(SCRYPT_PARAMS),by:'login'},'ترقية معاملات اشتقاق كلمة المرور عند أول دخول ناجح؛ الكلمة نفسها لم تتغير');
    return !!changes;
  };
  try { return db.isTransaction?write():transaction(db,write); }
  catch { return false; }
}

export function login(db, username, password, address, otp) {
  if (typeof username!=='string'||typeof password!=='string'||username.length>100||password.length>200) fail(400,'invalid_login','بيانات الدخول غير صالحة');
  // العنوان يشتقه الخادم (server.mjs: clientAddress) لا الطلب. خلف نفق مشفَّر يكون عنوان الموظف نفسه،
  // ومن غير نفق يكون الطرف المتصل. العدّادان يبقيان لكل عنوان على حدة، فلا يقفل خطأ موظف بابَ زميله.
  const ip=typeof address==='string'&&address.trim()?address.trim():'unknown';
  // Offices share one address: lock the account from that address after 10 failures, and the address after 200.
  // والعدّاد الثالث على **الحساب وحده**: كان العدّادان كلاهما مفتاحهما العنوان، فمن يدوّر عنوان المصدر
  // يجرّب كلمة من كل عنوان ولا يبلغ سقفًا أبدًا — تخمين موزَّع بلا حدّ على حساب بعينه. وتدوير العنوان
  // يصير أسهل لا أصعب حين يُفتح النفق المشفَّر للوصول من أي مكان.
  // وسقفه أعلى بكثير من سقف (عنوان+حساب) عمدًا، لأن عدّادًا على الحساب يفتح حجبًا متعمَّدًا: من أراد
  // أن يقفل باب زميله يفتعل الفشل. ثلاثون في ربع ساعة لا يبلغها من يخطئ في كتابة كلمته، ويبلغها
  // المخمِّن في ثوانٍ. **والرقم قرار المالك**، فهو ثابت مسمّى يُقرأ من موضع واحد.
  const time=Date.now(), keys=[[hash(ip+'\n'+username.trim().toLowerCase()),10],[hash('ip\n'+ip),200],
    [hash('user\n'+username.trim().toLowerCase()),ACCOUNT_FAILURE_LIMIT]];
  for (const [key,limit] of keys) {
    const attempt=db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key);
    if (attempt && time-attempt.window_start>900000) { db.prepare('DELETE FROM login_attempts WHERE key=?').run(key); continue; }
    if (attempt?.failures>=limit) fail(429,'rate_limited','محاولات كثيرة. حاول بعد 15 دقيقة');
  }
  const user=db.prepare('SELECT * FROM users WHERE username=?').get(username.trim().toLowerCase());
  const valid=verifyPassword(password,user?.password_hash??dummy());
  // تنبيه مسؤولي المنصة عند بلوغ العتبة على حساب قائم (security-alerts.mjs). لا تنبيه لاسم غير موجود: لا كيان يُنبَّه.
  const failed=()=>{for (const [key] of keys) db.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=failures+1').run(key,time);
    if (user) {
      const failures=db.prepare('SELECT failures FROM login_attempts WHERE key=?').get(keys[0][0])?.failures;
      // الفشل يدخل سجل التدقيق لا عدّاد المحاولات وحده: صفوف login_attempts تُحذف بعد ربع ساعة، فلا يبقى أثر لمن حاول الدخول على حساب من ومتى.
      // الفاعل المكتوب هو الحساب المستهدف لا من حاول — من حاول مجهول بحكم فشل التحقق نفسه — والسبب مكتوب داخل الحدث كي لا يُقرأ الصفّ على أنه فعلٌ فعله صاحب الحساب.
      // ولا يُسجَّل شيء لاسم مستخدم غير موجود: لا كيان يُنسب إليه الحدث، وتسجيله يصنع بابًا لتعداد الأسماء. والعدد محدود أصلًا بسقف المحاولات (عشر لكل عنوان واسم).
      audit(db,user,'session',user.id,'login.failed',{},{address:ip,failures},'محاولة دخول فاشلة على هذا الحساب؛ الفاعل المسجَّل هو الحساب المستهدف لا من حاول');
      failedLoginAlert(db,user,failures);
    }};
  if (!valid||!user?.active) {
    failed();
    fail(401,'invalid_credentials','اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  // الخطوة الثانية بعد صحة كلمة المرور: رمز خاطئ يُحتسب محاولة فاشلة كغيره.
  const second=checkLoginOtp(db,user,otp);
  if (second==='required') fail(401,'otp_required','هذا الحساب مفعّل عليه التحقق بخطوتين. أدخل رمز تطبيق المصادقة في خانة «رمز التحقق»');
  if (second==='invalid') {
    failed();
    fail(401,'invalid_otp','رمز التحقق غير صحيح أو سبق استخدامه');
  }
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  // العنوان يُحفظ مع الجلسة وفي سجل التدقيق: بدونه يبدو كل فعل عن بُعد كأنه جرى على الجهاز نفسه.
  // قيمة after داخلة في سلسلة تجزئة سجل التدقيق، فالعنوان المسجَّل لا يُعدَّل لاحقًا بلا أن ينكشف.
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,last_seen,address) VALUES(?,?,?,?,?,?)').run(hash(token),user.id,csrf,time+8*3600000,time,ip);
  audit(db,user,'session',user.id,'login',{}, {address:ip});
  upgradeHash(db,user,password);
  return {token,csrf,user:publicUser(user)};
}
// الخروج بجانب الدخول: الدخول يُسجَّل ناجحًا وفاشلًا، وكان الخروج حذفَ صفٍّ بلا أثر — فيبيّن السجل متى فُتحت
// الجلسة ولا يبيّن متى أُغلقت، ولا يفرّق بين جلسة أنهاها صاحبها وجلسة بقيت حتى انتهت مدتها. والتسجيل قبل الحذف
// داخل معاملة واحدة، فلا يقع أحدهما وحده.
export function logout(db, user, session, address) {
  audit(db,user,'session',user.id,'logout',{},{address});
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
  return {logged_out:true};
}
export const IDLE_MESSAGE='انتهت الجلسة لعدم النشاط. سجّل الدخول من جديد';
// مهلة الخمول (session-policy.mjs): جلسة تجاوزت المهلة منذ آخر طلب تُحذف وتُرفض بـ401 session_expired وسبب idle.
// آخر نشاط يُكتب مرة في الدقيقة على الأكثر. الساعة محقونة (now) للاختبار.
export function authenticate(db, cookie='', {now:at=Date.now()}={}) {
  const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
  if (!token||!/^[a-f0-9]{64}$/.test(token)) fail(401,'login_required','سجّل الدخول للمتابعة');
  const session=db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token),at);
  const user=session&&db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(session.user_id);
  if (!user) fail(401,'session_expired','انتهت الجلسة أو توقف الحساب');
  const limit=idleLimitMs(db,user),seen=session.last_seen??at;
  if (limit&&at-seen>limit) {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
    throw Object.assign(new AppError(401,'session_expired',IDLE_MESSAGE),{details:{reason:'idle'}});
  }
  if (session.last_seen===null||at-session.last_seen>=60000) db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(at,session.token_hash);
  return {user,session};
}
export function checkCsrf(session, supplied) {
  if(typeof supplied!=='string'||supplied.length!==session.csrf.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(session.csrf))) fail(403,'csrf','تعذر التحقق من مصدر الطلب. أعد تحميل الصفحة');
}

export function changePassword(db, user, session, input) {
  if (!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['current_password','new_password'].includes(k))) fail(400,'invalid_fields','حقول الطلب غير صالحة');
  const current=db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(user.id);
  if (!current||typeof input.current_password!=='string'||input.current_password.length>200||!verifyPassword(input.current_password,current.password_hash)) fail(403,'invalid_credentials','كلمة المرور الحالية غير صحيحة');
  passwordPolicy(input.new_password,current.username);
  if (input.new_password===input.current_password) fail(400,'weak_password','اختر كلمة مرور مختلفة عن الحالية');
  db.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?').run(passwordHash(input.new_password),current.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(current.id,session.token_hash);
  audit(db,current,'user',current.id,'user.password_changed',{}, {other_sessions_revoked:true});
  return {changed:true};
}
