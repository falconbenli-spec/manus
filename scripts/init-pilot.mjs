import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction, audit, verifyAudit } from '../app/db.mjs';
import { seed } from './seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';

// قاعدة تجربة نظيفة: الهيكل التنظيمي ودليل الخدمات كاملان، وحساب الأدمن الأول وحده نشط.
// لا موظفين وهميين نشطين ولا معاملات عرض. ليست بيئة إنتاج: التشغيل الإنتاجي معطل حتى تُحسم قرارات TASK-0.
// كلمة المرور المؤقتة تُولَّد هنا وتُكتب في ملف محلي بصلاحية 600؛ لا تُطبع في الطرفية ولا تُرسل في أي محادثة.
export function initPilot(path,password){
  if(existsSync(path))throw new Error('Refusing to overwrite an existing database: '+path);
  mkdirSync(dirname(path),{recursive:true});
  const db=openDb(path);
  try{
    seed(db,password);const catalog=installServiceCatalog(db);
    const admin=db.prepare("SELECT * FROM users WHERE id='admin'").get();
    transaction(db,()=>{
      // الحسابات المصطنعة لازمة لتركيب الدليل فقط؛ تُعطَّل ولا تُحذف حتى تبقى مراجع الهيكل سليمة، ويستبدلها الأدمن بحسابات حقيقية.
      const off=db.prepare("UPDATE users SET active=0 WHERE id<>'admin' AND active=1").run().changes;
      db.prepare('DELETE FROM sessions').run();
      db.prepare("UPDATE users SET must_change_password=1 WHERE id='admin'").run();
      audit(db,admin,'synthetic_fixture','pilot','pilot.initialised',{}, {deactivated_accounts:off,services:catalog.services},'قاعدة تجربة نظيفة: حساب الأدمن الأول وحده نشط');
    });
    const summary={path,active_users:db.prepare('SELECT COUNT(*) AS n FROM users WHERE active=1').get().n,departments:db.prepare("SELECT COUNT(*) AS n FROM departments WHERE tenant_id='36t' AND active=1").get().n,
      services:db.prepare("SELECT COUNT(DISTINCT code) AS n FROM services WHERE tenant_id='36t' AND active=1").get().n,requests:db.prepare('SELECT COUNT(*) AS n FROM requests').get().n,audit_ok:verifyAudit(db)};
    return summary;
  }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.env.NODE_ENV==='production')throw new Error('Pilot initialisation is a local evaluation tool.');
  const path=resolve(process.env.PILOT_DB_PATH||'work/pilot.sqlite'),password=randomBytes(18).toString('base64url');
  const summary=initPilot(path,password);
  mkdirSync('outputs',{recursive:true});
  const file=resolve('outputs/pilot-credentials.txt');
  writeFileSync(file,`قاعدة التجربة النظيفة\nالقاعدة: ${path}\nالمستخدم: admin\nكلمة المرور المؤقتة: ${password}\nيُطلب تغييرها عند أول دخول. احذف هذا الملف بعد ذلك.\n`,{mode:0o600});chmodSync(file,0o600);
  console.log(`Pilot database ready: ${summary.departments} departments, ${summary.services} services, ${summary.active_users} active account (admin). Temporary password saved to outputs/pilot-credentials.txt (not shown here).`);
  console.log(`Run it with: LOCAL_DB_PATH=${path} PORT=3620 npm start`);
}
