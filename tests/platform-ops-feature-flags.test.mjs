import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { flagOn, flagsBoard, createFlag, updateFlag, retireFlag, MAX_FLAG_DAYS } from '../app/feature-flags.mjs';

const code=value=>error=>error.code===value;
const TODAY='2026-09-20',plus=n=>new Date(Date.parse(TODAY+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-platform-ops');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const base={key:'ai.asset_gate',description:'يربط تشغيل المساعدين بجردهم — تجريبي',scope:'all',targets:[],enabled:true,expires_on:plus(30),reason:'تجربة الربط قبل تعميمه'};
  return {db,users,tx,base};
}

test('feature flags: an undefined flag is off, and a flag cannot be created without an expiry inside the horizon',t=>{
  const {db,users,tx,base}=fixture(t);
  assert.equal(flagOn(db,users.employee,'never.defined',TODAY),false);
  assert.throws(()=>tx(()=>createFlag(db,users.admin,{...base,expires_on:undefined},TODAY)),code('invalid_date'));
  assert.throws(()=>tx(()=>createFlag(db,users.admin,{...base,expires_on:plus(MAX_FLAG_DAYS+1)},TODAY)),code('expires_on'));
  assert.throws(()=>tx(()=>createFlag(db,users.admin,{...base,expires_on:plus(-1)},TODAY)),code('expires_on'));
  assert.throws(()=>tx(()=>createFlag(db,users.admin,{...base,reason:''},TODAY)),code('invalid_text'));
  assert.throws(()=>db.prepare("INSERT INTO feature_flags(id,tenant_id,key,description,scope,expires_on,created_by,created_at,updated_by,updated_at) VALUES('x','36t','raw.flag','بلا تاريخ انتهاء صالح','all','never','admin','t','admin','t')").run(),/CHECK/);
  tx(()=>createFlag(db,users.admin,base,TODAY));
  assert.equal(flagOn(db,users.employee,'ai.asset_gate',TODAY),true);
  assert.throws(()=>tx(()=>createFlag(db,users.admin,base,TODAY)),code('duplicate_flag'));
});

test('feature flags: only the platform admin manages flags, and every change is audited with its reason',t=>{
  const {db,users,tx,base}=fixture(t);
  for(const who of ['employee','manager','hr','it'])assert.throws(()=>tx(()=>createFlag(db,users[who],base,TODAY)),code('not_permitted'),who);
  assert.throws(()=>flagsBoard(db,users.manager,TODAY),code('not_permitted'));
  const {id}=tx(()=>createFlag(db,users.admin,base,TODAY));
  tx(()=>updateFlag(db,users.admin,id,{version:1,description:base.description,scope:'all',targets:[],enabled:false,expires_on:plus(30),reason:'إيقاف مؤقت لمراجعة الأثر'},TODAY));
  assert.equal(flagOn(db,users.employee,'ai.asset_gate',TODAY),false);
  assert.throws(()=>tx(()=>updateFlag(db,users.admin,id,{version:1,description:base.description,scope:'all',targets:[],enabled:true,expires_on:plus(30),reason:'تعديل على نسخة قديمة'},TODAY)),code('stale_version'));
  const trail=db.prepare("SELECT action,reason,before_json,after_json FROM audit_events WHERE entity_type='feature_flag' AND entity_id=? ORDER BY seq").all(id);
  assert.deepEqual(trail.map(a=>a.action),['flag.created','flag.changed']);
  assert.ok(trail.every(a=>a.reason.length>=10));assert.equal(JSON.parse(trail[1].before_json).enabled,true);assert.equal(JSON.parse(trail[1].after_json).enabled,false);
  assert.ok(verifyAudit(db));
});

test('feature flags: department and user scopes reach only their targets',t=>{
  const {db,users,tx,base}=fixture(t);
  tx(()=>createFlag(db,users.admin,{...base,key:'studio.new_board',scope:'department',targets:['creative'],reason:'تجربة على الفريق الإبداعي أولًا'},TODAY));
  tx(()=>createFlag(db,users.admin,{...base,key:'hr.preview',scope:'user',targets:['hr'],reason:'معاينة لحساب واحد قبل التعميم'},TODAY));
  assert.equal(flagOn(db,users.employee,'studio.new_board',TODAY),true);assert.equal(flagOn(db,users.hr,'studio.new_board',TODAY),false);
  assert.equal(flagOn(db,users.hr,'hr.preview',TODAY),true);assert.equal(flagOn(db,users.manager,'hr.preview',TODAY),false);
  assert.throws(()=>tx(()=>createFlag(db,users.admin,{...base,key:'empty.scope',scope:'user',targets:[]},TODAY)),code('targets'));
  assert.throws(()=>tx(()=>createFlag(db,users.admin,{...base,key:'foreign.user',scope:'user',targets:['external']},TODAY)),code('targets'),'a user of another tenant is not a valid target');
});

test('feature flags: an expired flag is treated as off and raises an alert; a retired flag is never revived',t=>{
  const {db,users,tx,base}=fixture(t);
  const {id}=tx(()=>createFlag(db,users.admin,{...base,expires_on:plus(10)},TODAY));
  assert.equal(flagOn(db,users.employee,'ai.asset_gate',plus(10)),true,'on through its last day');
  assert.equal(flagOn(db,users.employee,'ai.asset_gate',plus(11)),false,'expired means off even while enabled');
  const later=flagsBoard(db,users.admin,plus(11));
  assert.equal(later.flags[0].state,'expired');assert.match(later.alerts[0],/انتهى/);
  assert.equal(flagsBoard(db,users.admin,plus(1)).flags[0].state,'expiring');
  tx(()=>retireFlag(db,users.admin,id,{version:1,reason:'أُزيل الشرط من الكود بعد التعميم'}));
  assert.equal(flagOn(db,users.employee,'ai.asset_gate',TODAY),false);
  assert.throws(()=>tx(()=>updateFlag(db,users.admin,id,{version:2,description:base.description,scope:'all',targets:[],enabled:true,expires_on:plus(30),reason:'محاولة إحياء علم مسحوب'},TODAY)),code('retired'));
  assert.throws(()=>db.prepare("UPDATE feature_flags SET status='live',enabled=1,retired_at=NULL,version=version+1").run(),/never revived/);
  assert.throws(()=>db.prepare('DELETE FROM feature_flags').run(),/retired, not deleted/);
  assert.ok(verifyAudit(db));
});

test('feature flags: a flag in one tenant is invisible to another',t=>{
  const {db,users,tx,base}=fixture(t);
  tx(()=>createFlag(db,users.admin,base,TODAY));
  assert.equal(flagOn(db,users.external,'ai.asset_gate',TODAY),false);
  assert.equal(flagsBoard(db,users.admin,TODAY).flags.length,1);
  assert.ok(!flagsBoard(db,users.admin,TODAY).people.some(p=>p.id==='external'));
});
