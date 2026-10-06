import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from '../app/db.mjs';
import { passwordHash } from '../app/auth.mjs';
import { createApp } from '../app/server.mjs';
import { seed } from './seed.mjs';

if(process.env.NODE_ENV==='production') throw new Error('Preview only');
const origin=process.argv[2];
if(!/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(origin??'')) throw new Error('Exact HTTPS preview origin required');
mkdirSync('work',{recursive:true,mode:0o700});
const directory=mkdtempSync(resolve('work/mobile-preview-'));
const db=openDb(resolve(directory,'synthetic.sqlite'));
seed(db,randomBytes(32).toString('base64url'));
const credentials={};
for(const user of db.prepare('SELECT id FROM users').all()) {
  const password=randomBytes(18).toString('base64url');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash(password),user.id);
  if(['manager','employee'].includes(user.id)) credentials[user.id]=password;
}
writeFileSync(resolve(directory,'access.json'),JSON.stringify({origin,credentials}),{mode:0o600,flag:'wx'});
const server=createApp(db,{previewOrigin:origin});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(3601,'127.0.0.1',()=>console.log(JSON.stringify({origin,directory,expiresAfterHours:8})));
const stop=()=>server.close(()=>{db.close();process.exit(0);});
setTimeout(stop,8*60*60*1000).unref();
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,stop);
