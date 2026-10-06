import { DatabaseSync } from 'node:sqlite';
import { existsSync,copyFileSync,chmodSync,constants } from 'node:fs';
import { resolve } from 'node:path';
import { openDb,verifyAudit } from '../app/db.mjs';
const [backup,target]=process.argv.slice(2);
if(!backup||!target)throw Error('Usage: node scripts/restore-check.mjs backup.sqlite new-target.sqlite');
if(!existsSync(backup)||existsSync(target))throw Error('Use an existing backup and a new target. No live file will be overwritten.');
const source=new DatabaseSync(resolve(backup),{readOnly:true});
try{if(source.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||!verifyAudit(source))throw Error('Backup integrity failed.');}finally{source.close();}
copyFileSync(resolve(backup),resolve(target),constants.COPYFILE_EXCL);chmodSync(resolve(target),0o600);
const db=openDb(resolve(target));
try{if(!verifyAudit(db))throw Error('Restored audit is invalid.');console.log(JSON.stringify({integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,requests:db.prepare('SELECT COUNT(*) AS count FROM requests').get().count,attachments:db.prepare('SELECT COUNT(*) AS count FROM attachments').get().count,audit:verifyAudit(db)}));}finally{db.close();}
