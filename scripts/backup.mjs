import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, copyFileSync, rmSync, writeFileSync, readdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb, verifyAudit, hash } from '../app/db.mjs';
import { verifyInvoiceChain } from '../app/invoices.mjs';

// نسخة احتياطية متسقة أثناء عمل الخدمة (VACUUM INTO)، ثم تجربة استعادة فعلية: تُفتح النسخة في مكان مستقل وتُفحص.
// وجود ملف نسخة ليس دليلًا؛ الدليل أن النسخة تُفتح وتجتاز الفحوص. لا تُحذف نسخ قديمة تلقائيًا.
const stamp=()=>new Date().toISOString().replace(/[-:]/g,'').slice(0,13);
export function backupDatabase(sourcePath,targetDir){
  mkdirSync(targetDir,{recursive:true,mode:0o700});
  const target=join(targetDir,`36t-${stamp()}.sqlite`);
  const source=new DatabaseSync(sourcePath,{readOnly:true});
  try{source.exec(`VACUUM INTO '${target.replace(/'/g,"''")}'`);}finally{source.close();}
  chmodSync(target,0o600);
  return target;
}
export function restoreCheck(backupPath){
  // الاستعادة في مجلد مؤقت مستقل: لا تُلمس قاعدة التشغيل ولا ملف النسخة نفسه.
  const dir=mkdtempSync(join(tmpdir(),'36t-restore-')),restored=join(dir,'restored.sqlite'),started=Date.now();
  try{
    copyFileSync(backupPath,restored);
    const db=openDb(restored);
    try{
      const integrity=db.prepare('PRAGMA integrity_check').all().map(r=>Object.values(r)[0]),foreign=db.prepare('PRAGMA foreign_key_check').all();
      const tenants=db.prepare('SELECT id FROM tenants').all().map(t=>t.id);
      const count=table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      const result={backup:backupPath,checked_at:new Date().toISOString(),seconds:0,migration:db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,
        integrity_ok:integrity.length===1&&integrity[0]==='ok',foreign_key_violations:foreign.length,audit_chain_ok:verifyAudit(db),invoice_chain_ok:tenants.every(t=>verifyInvoiceChain(db,t)),
        rows:{users:count('users'),requests:count('requests'),audit_events:count('audit_events'),vendors:count('vendors'),tax_invoices:count('tax_invoices'),stored_files:count('stored_files')}};
      result.seconds=Math.round((Date.now()-started)/100)/10;
      result.passed=result.integrity_ok&&!result.foreign_key_violations&&result.audit_chain_ok&&result.invoice_chain_ok;
      return result;
    }finally{db.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url)),source=resolve(root,process.env.LOCAL_DB_PATH||'work/local.sqlite'),dir=resolve(root,process.env.BACKUP_DIR||'work/backups/auto');
  const target=backupDatabase(source,dir),result=restoreCheck(target);
  writeFileSync(join(dir,'last-restore-check.json'),JSON.stringify({...result,backup_sha256:hash(readFileSync(target))},null,2),{mode:0o600});
  const kept=readdirSync(dir).filter(f=>f.endsWith('.sqlite')).length;
  console.log(`${result.passed?'PASSED':'FAILED'} restore check in ${result.seconds}s — ${target} (migration ${result.migration}, ${kept} backups kept)`);
  if(!result.passed){console.error(JSON.stringify(result,null,2));process.exit(1);}
}
