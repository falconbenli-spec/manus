import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { login, verifyPassword } from '../app/auth.mjs';
import { codeAt, totpStatus, startTotp, confirmTotp, disableTotp, resetTotp } from '../app/totp.mjs';
import { seal, unseal, isSealed } from '../app/crypto-fields.mjs';

const code=value=>error=>error.code===value;
const PASSWORD='synthetic-totp-tests';
function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const current=offset=>codeAt(totpStatus(db,users.employee).secret??secretOf(db),Math.floor(Date.now()/30000)+(offset??0));
  const secretOf=database=>unseal(database.prepare("SELECT secret FROM user_totp WHERE user_id='employee'").get().secret);
  const enable=()=>{const pending=transaction(db,()=>startTotp(db,users.employee));return {pending,result:transaction(db,()=>confirmTotp(db,users.employee,{code:codeAt(pending.secret,Math.floor(Date.now()/30000))}))};};
  return {db,users,enable,secretOf,current};
}

test('RFC 6238 vector: the implementation matches the published SHA-1 test value',()=>{
  // السر المعياري "12345678901234567890" بترميز base32، عند الزمن 59 ثانية: 94287082 (آخر ستة أرقام 287082).
  assert.equal(codeAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',1),'287082');
  assert.equal(codeAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',37037036),'081804');
});

test('enrolment shows the secret only while pending, stores it sealed, signs other sessions out and issues recovery codes once',t=>{
  const {db,users,enable}=fixture(t);
  login(db,'employee',PASSWORD,'10.0.0.1');
  const {pending,result}=enable();
  assert.match(pending.secret,/^[A-Z2-7]{32}$/);assert.match(pending.uri,/^otpauth:\/\/totp\//);
  assert.equal(result.recovery_codes.length,8);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='employee'").get().n,0);
  const stored=db.prepare("SELECT secret,recovery FROM user_totp WHERE user_id='employee'").get();
  assert.ok(isSealed(stored.secret));assert.equal(stored.secret.includes(pending.secret),false);
  assert.equal(stored.recovery.includes(result.recovery_codes[0]),false,'only hashes of recovery codes are stored');
  const status=totpStatus(db,users.employee);
  assert.deepEqual([status.enabled,status.pending,status.secret,status.recovery_left],[true,false,undefined,8]);
  assert.throws(()=>transaction(db,()=>startTotp(db,users.employee)),code('already_enabled'));
  assert.ok(verifyAudit(db));
});

test('login needs the second step once enabled; a code works once, a recovery code works once, and wrong codes count as failures',t=>{
  const {db,enable,secretOf}=fixture(t);
  const {result}=enable(),step=Math.floor(Date.now()/30000);
  assert.throws(()=>login(db,'employee',PASSWORD,'10.0.0.2'),code('otp_required'));
  assert.throws(()=>login(db,'employee','wrong-password','10.0.0.2','123456'),code('invalid_credentials'),'the second step is never reached with a wrong password');
  assert.throws(()=>login(db,'employee',PASSWORD,'10.0.0.2','000000'),code('invalid_otp'));
  // رمز التفعيل نفسه استُهلك؛ الخطوة التالية صالحة مرة واحدة.
  assert.throws(()=>login(db,'employee',PASSWORD,'10.0.0.2',codeAt(secretOf(db),step)),code('invalid_otp'));
  const next=codeAt(secretOf(db),step+1);
  assert.ok(login(db,'employee',PASSWORD,'10.0.0.2',next).token);
  assert.throws(()=>login(db,'employee',PASSWORD,'10.0.0.2',next),code('invalid_otp'),'a used code is refused');
  assert.ok(login(db,'employee',PASSWORD,'10.0.0.2',result.recovery_codes[0]).token);
  assert.throws(()=>login(db,'employee',PASSWORD,'10.0.0.2',result.recovery_codes[0]),code('invalid_otp'));
  assert.ok(login(db,'manager',PASSWORD,'10.0.0.2').token,'accounts without the second step are unaffected');
  for(let i=0;i<9;i++)assert.throws(()=>login(db,'employee',PASSWORD,'10.0.0.3','111111'));
  assert.throws(()=>login(db,'employee',PASSWORD,'10.0.0.3','111111'),code('invalid_otp'));
  assert.throws(()=>login(db,'employee',PASSWORD,'10.0.0.3','111111'),code('rate_limited'),'ten wrong second steps lock the account from that address');
});

test('disabling needs the password and a live code; only the first admin can reset a lost device, with a reason',t=>{
  const {db,users,enable,secretOf}=fixture(t);
  enable();
  const live=()=>codeAt(secretOf(db),Math.floor(Date.now()/30000)+1);
  assert.throws(()=>transaction(db,()=>disableTotp(db,users.employee,{current_password:'wrong',code:live()},verifyPassword)),code('invalid_credentials'));
  assert.throws(()=>transaction(db,()=>disableTotp(db,users.employee,{current_password:PASSWORD,code:'000000'},verifyPassword)),code('invalid_otp'));
  assert.throws(()=>transaction(db,()=>resetTotp(db,users.manager,'employee',{reason:'مدير الفريق يحاول إعادة الضبط'})),code('forbidden'));
  assert.throws(()=>transaction(db,()=>resetTotp(db,users.admin,'employee',{reason:'قصير'})),code('reason'));
  assert.deepEqual(transaction(db,()=>resetTotp(db,users.admin,'employee',{reason:'فقد الموظف هاتفه وتحققنا من هويته حضوريًا'})),{reset:true});
  assert.ok(login(db,'employee',PASSWORD,'10.0.0.4').token);
  enable();
  assert.deepEqual(transaction(db,()=>disableTotp(db,users.employee,{current_password:PASSWORD,code:live()},verifyPassword)),{enabled:false});
});

test('field sealing round-trips, never repeats a ciphertext, rejects tampering and passes legacy plaintext through',()=>{
  const a=seal('SA0380000000608010167519'),b=seal('SA0380000000608010167519');
  assert.notEqual(a,b);assert.equal(unseal(a),'SA0380000000608010167519');assert.equal(unseal('SA-legacy-plaintext'),'SA-legacy-plaintext');
  const parts=a.split(':');parts[4]=Buffer.from('tampered-ciphertext-value').toString('base64');
  assert.throws(()=>unseal(parts.join(':')));
});
