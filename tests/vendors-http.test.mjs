import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createApp } from '../app/server.mjs';
import { seedVendorsDemo } from '../scripts/seed-vendors-demo.mjs';

async function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-vendors-http');
  const admin=db.prepare("SELECT * FROM users WHERE id='admin'").get();
  transaction(db,()=>grantAccess(db,admin,{user_id:'employee',capability:'vendors.manage',note:'اختبار HTTP'}));
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`,sessions={};
  for(const username of ['employee','manager','hr','admin','external']){
    const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'synthetic-vendors-http'})});
    const body=await response.json();sessions[username]={cookie:response.headers.get('set-cookie').split(';')[0],csrf:body.csrf,can:body.user.can};
  }
  const call=async(who,path,input,expected=200,key=randomUUID())=>{
    const auth=sessions[who];const response=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie:auth.cookie,'x-csrf-token':auth.csrf,'Idempotency-Key':key},...(input===undefined?{}:{body:JSON.stringify(input)})});
    const body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));return body;
  };
  return {db,call,sessions,base};
}

test('HTTP: vendor centre routes enforce grants, idempotent registration and versioned actions',async t=>{
  const {call,sessions,base}=await fixture(t);
  assert.ok(sessions.employee.can.includes('vendors.manage'));
  assert.ok(!sessions.admin.can.includes('vendors.bank'),'first admin does not hold the finance verification grant by default');
  assert.ok(!sessions.hr.can.some(c=>c.startsWith('vendors.')));
  await call('hr','/vendors',undefined,403);
  await call('external','/vendors',undefined,403);
  const input={legal_name:'مورد HTTP مصطنع',entity_type:'company',country:'SA',entity_ref:'1010000777',categories:['web_tech'],data_source:'اختبار واجهة HTTP'};
  const key=randomUUID();
  const created=await call('employee','/vendors',input,201,key);
  assert.equal((await call('employee','/vendors',input,201,key)).id,created.id,'same key returns the same vendor');
  assert.equal((await call('employee','/vendors')).vendors.length,1);
  await call('manager','/vendors',input,403);
  await call('employee',`/vendors/${created.id}/submit`,{version:created.version},409);
  const withContact=await call('employee',`/vendors/${created.id}/add_contact`,{version:created.version,name:'ممثل مصطنع',role:'مبيعات',email:'a@vendor.invalid',phone:''},201);
  await call('employee',`/vendors/${created.id}/add_contact`,{version:created.version,name:'ممثل مصطنع',role:'مبيعات',email:'a@vendor.invalid',phone:''},409);
  assert.equal(withContact.contacts.length,1);
  const script=await fetch(base+'/vendors-ui.mjs');assert.equal(script.status,200);
  assert.equal((await fetch(base+'/approvals-ui.mjs')).status,200);
  await call('hr','/approvals',undefined,403);
  assert.deepEqual((await call('manager','/approvals')).records,[]);
});

test('demo vendors seed once, on synthetic tenants only, and cover every state the screen shows',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-vendors-demo');t.after(()=>db.close());
  assert.equal(seedVendorsDemo(db),7);
  assert.equal(seedVendorsDemo(db),0);
  const states=db.prepare('SELECT status,COUNT(*) AS n FROM vendors GROUP BY status').all().map(r=>r.status).sort();
  assert.deepEqual(states,['approved','conditional','draft','in_review','suspended']);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM vendors WHERE legal_name NOT LIKE '%(تجريبي)%'").get().n===0,'every demo vendor is labelled synthetic');
  db.prepare("UPDATE tenants SET name='شركة حقيقية' WHERE id='36t'").run();
  assert.throws(()=>seedVendorsDemo(db),/Synthetic tenants only/);
});
