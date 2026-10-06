import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';

test('the database refuses a payment execution recorded by whoever prepared or approved the order',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-payment-third-party');t.after(()=>db.close());
  const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='payment_orders_execution_third_party'").get();
  assert.ok(trigger,'the guard exists in the schema, not only in the code path');
  assert.match(trigger.sql,/NEW\.prepared_by,NEW\.approved_by/);
});
