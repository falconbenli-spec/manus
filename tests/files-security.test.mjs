import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess, holds, capabilitiesFor } from '../app/access.mjs';
import { seedVendorsDemo } from '../scripts/seed-vendors-demo.mjs';
import { listVendors } from '../app/vendors.mjs';
import { submitClaim } from '../app/expenses.mjs';
import { listFiles, uploadFile, downloadFile } from '../app/files.mjs';
import { startTotp, confirmTotp, codeAt, securityPolicy, setSecurityPolicy } from '../app/totp.mjs';
import { backupDatabase, restoreCheck } from '../scripts/backup.mjs';

const code=value=>error=>error.code===value;
const pdf=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.from('synthetic document body')]).toString('base64');
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-files');t.after(()=>db.close());seedVendorsDemo(db);
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const vendor=listVendors(db,users.employee).vendors.find(x=>x.supplier_key==='DEMO-PRINT');
  return {db,users,vendor};
}

test('files: type comes from the content signature, access follows the record, restricted bank proofs need the finance grant, and nothing is overwritten',t=>{
  const {db,users,vendor}=fixture(t);
  const upload=(who,extra={})=>transaction(db,()=>uploadFile(db,users[who],{entity_type:'vendor',entity_id:vendor.id,label:'سجل تجاري مصطنع',filename:'cr.pdf',content:pdf,...extra})).id;
  assert.throws(()=>upload('employee',{content:Buffer.from('MZ executable pretending to be a pdf').toString('base64')}),code('file_type'));
  assert.throws(()=>upload('employee',{filename:'../etc/passwd'}),code('filename'));
  assert.throws(()=>upload('manager'),code('not_permitted'),'viewing a vendor does not allow uploading to it');
  assert.throws(()=>upload('it'),code('not_permitted'));
  const open=upload('employee');
  assert.throws(()=>upload('employee'),code('duplicate_file'));
  const secret=upload('employee',{label:'إثبات حساب بنكي مصطنع',filename:'bank.pdf',content:Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.from('bank letter')]).toString('base64'),restricted:true});
  const forManager=listFiles(db,users.manager,'vendor',vendor.id);
  assert.deepEqual(forManager.files.map(f=>f.downloadable),[true,false]);assert.equal(forManager.can_upload,false);
  assert.equal(downloadFile(db,users.manager,open).media_type,'application/pdf');
  assert.throws(()=>downloadFile(db,users.manager,secret),code('not_found'));
  assert.throws(()=>downloadFile(db,users.admin,secret),code('not_found'),'the first admin holds no finance grant by default');
  assert.equal(downloadFile(db,users.hr,secret).filename,'bank.pdf');
  assert.throws(()=>downloadFile(db,users.external,open),code('not_found'));
  assert.throws(()=>db.prepare('DELETE FROM stored_files').run(),/retained/);
  assert.throws(()=>db.prepare("UPDATE stored_files SET label='x'").run(),/immutable/);
  // مطالبة المصروف: صاحبها يرفع إيصاله وهي قيد التقديم، وزميله لا يراها.
  const claim=transaction(db,()=>submitClaim(db,users.employee,{expense_date:new Date(Date.now()+3*3600000).toISOString().slice(0,10),category:'transport',description:'أجرة نقل مصطنعة لها إيصال مرفوع',amount:'40.00',receipt_reference:'r-file'})).id;
  transaction(db,()=>uploadFile(db,users.employee,{entity_type:'expense_claim',entity_id:claim,label:'صورة الإيصال',filename:'r.png',content:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('png')]).toString('base64')}));
  assert.equal(listFiles(db,users.manager,'expense_claim',claim).files.length,1);
  assert.throws(()=>listFiles(db,users.outsider,'expense_claim',claim),code('not_found'));
  assert.ok(verifyAudit(db));
});

test('MFA policy: once required, a sensitive capability works only for accounts with two-step verification, and only the first admin sets the policy',t=>{
  const {db,users}=fixture(t);
  assert.equal(holds(db,users.hr,'vendors.bank'),true);
  assert.throws(()=>transaction(db,()=>setSecurityPolicy(db,users.manager,{require_mfa_for_sensitive:true,reason:'مدير فريق يحاول تغيير السياسة'})),code('forbidden'));
  assert.throws(()=>transaction(db,()=>setSecurityPolicy(db,users.admin,{require_mfa_for_sensitive:true,reason:'قصير'})),code('invalid_fields'));
  const before=securityPolicy(db,users.admin);
  assert.equal(before.require_mfa_for_sensitive,false);assert.ok(before.holders.some(h=>h.id==='hr'&&!h.mfa));
  transaction(db,()=>setSecurityPolicy(db,users.admin,{require_mfa_for_sensitive:true,reason:'بدء التشغيل ببيانات حقيقية يتطلب التحقق بخطوتين'}));
  assert.equal(holds(db,users.hr,'vendors.bank'),false,'the grant is kept but dormant without MFA');
  assert.equal(holds(db,users.hr,'hr.contracts.manage'),false);
  assert.equal(capabilitiesFor(db,users.hr).list.includes('hr.contracts.manage'),false);
  assert.equal(holds(db,users.employee,'vendors.manage'),true,'non-sensitive capabilities are unaffected');
  const pending=transaction(db,()=>startTotp(db,users.hr));
  transaction(db,()=>confirmTotp(db,users.hr,{code:codeAt(pending.secret,Math.floor(Date.now()/30000))}));
  assert.equal(holds(db,users.hr,'vendors.bank'),true);
  assert.equal(securityPolicy(db,users.admin).holders.find(h=>h.id==='hr').mfa,true);
  assert.equal(securityPolicy(db,users.manager),null);
});

test('criterion 15: a backup is proven by restoring it elsewhere and passing integrity, foreign-key, audit-chain and invoice-chain checks',t=>{
  const dir=mkdtempSync(join(tmpdir(),'36t-backup-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=join(dir,'live.sqlite'),db=openDb(source);seed(db,'synthetic-backup');seedVendorsDemo(db);
  const target=backupDatabase(source,join(dir,'backups'));
  db.prepare("UPDATE users SET name='تغيير بعد النسخة' WHERE id='employee'").run();
  const result=restoreCheck(target);
  assert.equal(result.passed,true);assert.equal(result.rows.vendors,7);assert.equal(result.audit_chain_ok,true);
  // نسخة عُبث بسجل تدقيقها لا تجتاز الفحص.
  const tampered=openDb(target);tampered.exec("DROP TRIGGER IF EXISTS audit_events_no_update");
  try{tampered.prepare("UPDATE audit_events SET reason='عبث' WHERE seq=(SELECT MIN(seq) FROM audit_events)").run();}catch{}
  const changed=tampered.prepare("SELECT reason FROM audit_events ORDER BY seq LIMIT 1").get().reason==='عبث';tampered.close();db.close();
  if(changed)assert.equal(restoreCheck(target).passed,false);
});

test('HTTP: files are listed per record, uploaded once per key, downloaded as sandboxed attachments, and the policy route is first-admin only',async t=>{
  const { once }=await import('node:events');const { randomUUID }=await import('node:crypto');const { createApp }=await import('../app/server.mjs');
  const db=openDb(':memory:');seed(db,'synthetic-files-http');seedVendorsDemo(db);
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`,sessions={};
  for(const username of ['employee','manager','admin']){
    const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'synthetic-files-http'})});
    sessions[username]={cookie:response.headers.get('set-cookie').split(';')[0],csrf:(await response.json()).csrf};
  }
  const request=(who,path,input,key=randomUUID())=>fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie:sessions[who].cookie,'x-csrf-token':sessions[who].csrf,'Idempotency-Key':key},...(input===undefined?{}:{body:JSON.stringify(input)})});
  const vendors=(await (await request('employee','/vendors')).json()).vendors,vendor=vendors.find(x=>x.supplier_key==='DEMO-PRINT');
  const input={entity_type:'vendor',entity_id:vendor.id,label:'سجل تجاري مصطنع',filename:'سجل.pdf',content:pdf},key=randomUUID();
  const first=await request('employee','/files',input,key);assert.equal(first.status,201);
  const saved=await first.json();assert.equal((await (await request('employee','/files',input,key)).json()).id,saved.id,'same key, same file');
  assert.equal((await request('manager','/files',input)).status,403);
  const index=await (await request('manager',`/files?entity_type=vendor&ids=${vendors.map(x=>x.id).join(',')}`)).json();
  assert.equal(index.index[vendor.id].files.length,1);assert.equal(index.index[vendor.id].can_upload,false);
  assert.equal((await request('employee','/files?entity_type=vendor&ids=not-an-id')).status,400);
  const download=await request('manager',`/files/${saved.id}`);
  assert.equal(download.status,200);assert.match(download.headers.get('content-security-policy'),/sandbox/);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.equal(download.headers.get('content-type'),'application/octet-stream');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from(pdf,'base64'));
  assert.equal((await (await request('employee','/account/totp')).json()).policy,null);
  assert.equal((await request('manager','/admin/security',{require_mfa_for_sensitive:true,reason:'محاولة من غير الأدمن الأول'})).status,403);
  const policy=await (await request('admin','/admin/security',{require_mfa_for_sensitive:true,reason:'فرض التحقق قبل إدخال بيانات حقيقية'})).json();
  assert.equal(policy.require_mfa_for_sensitive,true);assert.ok(policy.without_mfa>0);
});
