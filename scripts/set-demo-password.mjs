import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction, audit } from '../app/db.mjs';
import { passwordHash } from '../app/auth.mjs';

const synthetic={'36t':'3,6T — بيئة تجريبية',isolated:'كيان اختبار معزول'};

export function setDemoPassword(db,password){
  if(typeof password!=='string'||password.length<4||password.length>200)throw new Error('Provide a password of 4 to 200 characters.');
  const tenants=db.prepare('SELECT id,name FROM tenants').all();
  if(!tenants.length||tenants.some(t=>synthetic[t.id]!==t.name))throw new Error('Synthetic tenants only. Refusing to change passwords in this database.');
  const admin=db.prepare("SELECT * FROM users WHERE id='admin' AND tenant_id='36t' AND role='admin'").get();
  if(!admin)throw new Error('Synthetic admin account is missing.');
  return transaction(db,()=>{
    const digest=passwordHash(password);
    const users=db.prepare('SELECT id FROM users').all();
    for(const u of users)db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(digest,u.id);
    db.prepare('DELETE FROM sessions').run();
    audit(db,admin,'user','*','user.demo_password_reset',{}, {accounts:users.length,sessions_revoked:true},'إعادة تعيين كلمة مرور مشتركة لحسابات التجربة المحلية');
    return users.length;
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==='production')throw new Error('Demo password reset is disabled in production.');
  const db=openDb(resolve(process.env.LOCAL_DB_PATH||'work/local.sqlite'));
  try{console.log(`Password updated for ${setDemoPassword(db,process.env.DEMO_PASSWORD)} synthetic accounts. Existing sessions were signed out.`);}
  finally{db.close();}
}
