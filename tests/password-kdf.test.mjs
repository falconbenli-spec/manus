import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync, randomBytes } from 'node:crypto';
import { openDb, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { login, changePassword, passwordHash, verifyPassword, parsePasswordHash, needsRehash, SCRYPT_PARAMS } from '../app/auth.mjs';

// معاملات اشتقاق كلمة المرور: كانت N=2^14 مكتوبة في الكود وحده، فرفعُها يكسر التحقق من كل تجزئة قائمة.
// المعاملات صارت تُكتب داخل الصف نفسه (scrypt$N$r$p$ملح$مفتاح)، والتحقق يقرأ الصيغتين، والصف القديم يُرقّى
// عند أول دخول ناجح به. كل ما هنا مصطنع: لا كلمة مرور حقيقية ولا صفّ من قاعدة التشغيل.
const PASSWORD='synthetic-password-kdf';
const fixture=t=>{const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());return db;};
// الصيغة القديمة كما كانت تُكتب حرفيًا قبل هذا الإصلاح: ملح:مفتاح، بمعاملات 2^14 غير مكتوبة في الصف.
const legacyHash=password=>{const salt=randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password,salt,64,{N:16384,r:8,p:1}).toString('hex')}`;};

test('KDF: the parameters are written inside the row, and a row written the old way is still read with its own parameters',()=>{
  const fresh=passwordHash(PASSWORD);
  assert.match(fresh,/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/,'a new row carries its own N, r and p');
  const parsed=parsePasswordHash(fresh);
  assert.deepEqual(parsed.params,SCRYPT_PARAMS);
  assert.equal(parsePasswordHash(legacyHash(PASSWORD)).params.N,16384,'an old row is read as 2^14, because that is what wrote it');
  // صفّ لا يُقرأ لا يفتح الباب ولا يُسقط الطلب بخطأ 500 (اختبارات كثيرة تكتب 'unused' في العمود).
  for(const broken of ['unused','',null,'scrypt$0$8$1$aa$bb',`${'a'.repeat(32)}:zz`])assert.equal(verifyPassword(PASSWORD,broken),false,`refused: ${broken}`);
});

test('KDF: both shapes verify, and only the weaker one is marked for upgrade',()=>{
  const old=legacyHash(PASSWORD),fresh=passwordHash(PASSWORD);
  assert.equal(verifyPassword(PASSWORD,old),true,'an account hashed the old way still signs in');
  assert.equal(verifyPassword('wrong-synthetic',old),false);
  assert.equal(verifyPassword(PASSWORD,fresh),true);
  assert.equal(verifyPassword('wrong-synthetic',fresh),false);
  assert.equal(needsRehash(old),true);
  assert.equal(needsRehash(fresh),false);
});

test('KDF: the floor is the recommended minimum, and one derivation costs what that floor costs on this machine',()=>{
  assert.ok(SCRYPT_PARAMS.N>=131072&&SCRYPT_PARAMS.p===1,`N=${SCRYPT_PARAMS.N} p=${SCRYPT_PARAMS.p} is at or above the recommended scrypt minimum`);
  const started=process.hrtime.bigint();
  passwordHash(PASSWORD);
  const ms=Number(process.hrtime.bigint()-started)/1e6;
  // الحد فضفاض عمدًا (جهاز أسرع بمرتين ما زال فوقه): الغرض كشف خفضٍ صامت للمعاملات لا قياس أداء.
  assert.ok(ms>=100,`derivation took ${ms.toFixed(1)}ms — under the floor, the parameters were lowered`);
  console.log(`  [قياس] اشتقاق واحد بالمعاملات الحالية N=${SCRYPT_PARAMS.N} r=${SCRYPT_PARAMS.r} p=${SCRYPT_PARAMS.p}: ${ms.toFixed(1)} مللي ثانية`);
});

test('KDF: a successful sign-in on an old row rewrites it with the new parameters, and nobody is signed out to do it',t=>{
  const db=fixture(t);
  const before=legacyHash(PASSWORD);
  db.prepare("UPDATE users SET password_hash=? WHERE id='employee'").run(before);
  const stored=()=>db.prepare("SELECT password_hash FROM users WHERE id='employee'").get().password_hash;
  assert.equal(parsePasswordHash(stored()).params.N,16384);

  const session=login(db,'employee',PASSWORD,'10.0.0.1');
  assert.ok(session.token,'the sign-in itself succeeds with the old row');
  const after=stored();
  assert.notEqual(after,before,'the row was rewritten');
  assert.deepEqual(parsePasswordHash(after).params,SCRYPT_PARAMS,'with the current parameters');
  assert.equal(verifyPassword(PASSWORD,after),true,'and the same password still opens it');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='employee'").get().n,1,'the session just opened survives the upgrade');

  // الترقية مسجَّلة بمعاملاتها ولا تحمل التجزئة نفسها، ولا تتكرر في الدخول التالي.
  const event=db.prepare("SELECT * FROM audit_events WHERE entity_id='employee' AND action='user.password_rehashed'").get();
  assert.ok(event,'the upgrade is in the audit trail');
  assert.equal(event.before_json.includes(before.slice(0,16)),false,'and never carries the hash itself');
  assert.equal(event.after_json.includes(after.slice(0,16)),false);
  login(db,'employee',PASSWORD,'10.0.0.1');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id='employee' AND action='user.password_rehashed'").get().n,1,'twice is once');
  assert.equal(stored(),after,'and the row is left alone once it is current');
  assert.ok(verifyAudit(db));
});

test('KDF: a changed password is written in the new shape and the old password stops working',t=>{
  const db=fixture(t);
  db.prepare("UPDATE users SET password_hash=? WHERE id='employee'").run(legacyHash(PASSWORD));
  const user=db.prepare("SELECT * FROM users WHERE id='employee'").get();
  const session=login(db,'employee',PASSWORD,'10.0.0.1');
  const row=db.prepare('SELECT * FROM sessions WHERE user_id=?').get(user.id);
  changePassword(db,user,row,{current_password:PASSWORD,new_password:'synthetic-next-password'});
  const after=db.prepare("SELECT password_hash FROM users WHERE id='employee'").get().password_hash;
  assert.deepEqual(parsePasswordHash(after).params,SCRYPT_PARAMS);
  assert.equal(verifyPassword('synthetic-next-password',after),true);
  assert.equal(verifyPassword(PASSWORD,after),false);
  assert.ok(session.csrf);
});
