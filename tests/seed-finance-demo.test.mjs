import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { seedFinanceDemo } from '../scripts/seed-finance-demo.mjs';
import { PURPOSES, statements } from '../app/ledger.mjs';

test('demo chart of accounts: covers every posting purpose with an account of the right type, leaves every mapping awaiting a second person, and is repeatable',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-finance-demo');t.after(()=>db.close());
  assert.equal(seedFinanceDemo(db).accounts,0,'without a finance grant holder nothing is created');
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  for(const action of ['read','configure','prepare'])db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t','employee','employee',action,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع',null,now());
  const first=seedFinanceDemo(db);
  assert.equal(first.mappings,PURPOSES.length,'one proposed mapping per purpose');assert.ok(first.accounts>=PURPOSES.length);
  const view=statements(db,users.employee);
  assert.equal(view.pending_mappings.length,PURPOSES.length);assert.ok(view.mappings.every(m=>m.active===null),'nothing is active until someone else approves');
  for(const m of view.pending_mappings)assert.equal(view.accounts.find(a=>a.id===m.account_id).account_type,PURPOSES.find(p=>p.key===m.purpose).account_type);
  assert.deepEqual(seedFinanceDemo(db),{accounts:0,mappings:0,skipped:null});
});
