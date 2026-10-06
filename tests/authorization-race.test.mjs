import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb } from '../app/db.mjs';
import { login } from '../app/auth.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';

test('SEC-07: role, account or session withdrawal while the body streams prevents a catalog write',async t=>{
  for(const change of ['role','account','session']){
    const db=openDb(':memory:');seed(db,'synthetic-authorization-race-only');const server=createApp(db);t.after(()=>{server.close();db.close();});
    const auth=login(db,'admin','synthetic-authorization-race-only','local-test');
    let releaseBody,enteredBody;const gate=new Promise(resolve=>releaseBody=resolve),reading=new Promise(resolve=>enteredBody=resolve);
    const input={code:'RACE-SERVICE',name_ar:'خدمة اختبار السباق',name_en:'Synthetic service',department_id:'it',description:'خدمة اختبار مصطنعة',fields:[{key:'detail',label:'التفاصيل',type:'text',required:true}],approval_policy:{steps:['manager'],handler_role:'it'}};
    const req={method:'POST',url:'/api/catalog',headers:{host:'127.0.0.1','content-type':'application/json',cookie:`session=${auth.token}`,'x-csrf-token':auth.csrf,'idempotency-key':randomUUID()},async *[Symbol.asyncIterator](){enteredBody();await gate;yield Buffer.from(JSON.stringify(input));}};
    const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
    const pending=server.listeners('request')[0](req,res);await reading;
    if(change==='role')db.exec("UPDATE users SET role='employee' WHERE id='admin'");
    if(change==='account')db.exec("UPDATE users SET active=0 WHERE id='admin'");
    if(change==='session')db.exec('DELETE FROM sessions');
    releaseBody();await pending;
    assert.equal(res.status,change==='role'?403:401);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM services WHERE code='RACE-SERVICE'").get().n,0);
  }
});
