import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { auditLifecycles, auditEndings, auditSelfService } from '../scripts/lifecycle-audit.mjs';
import { DEEPEN_OUTPUT_SERVICES, CONNECTED_SERVICE_MODULES } from '../app/service-outputs.mjs';

test('LIFECYCLE: every service either closes normally or reaches its declared output-acceptance gate, and its other endings hold',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-lifecycle-test');installServiceCatalog(db);t.after(()=>db.close());
  const results=auditLifecycles(db);
  const broken=results.filter(r=>!r.ok);
  assert.deepEqual(broken.map(r=>`${r.code} توقف عند ${r.stage}: ${r.error}`),[],'every service must close or reach its governed output gate');
  assert.ok(results.length>=142,`expected the full catalog, got ${results.length}`);
  assert.ok(results.every(r=>r.clock>=1),'every service carries a service level');
  const governed=[...DEEPEN_OUTPUT_SERVICES,...Object.keys(CONNECTED_SERVICE_MODULES)].sort();
  assert.deepEqual(results.filter(r=>r.gated).map(r=>r.code).sort(),governed,'the lifecycle audit reaches the output gate for exactly the audited 42 + 12 services');
  assert.ok(results.filter(r=>r.gated).every(r=>r.stage==='output_acceptance'));
  assert.ok(results.filter(r=>!r.gated).every(r=>r.stage==='closed'));
  const endings=auditEndings(db);
  assert.deepEqual(endings.filter(e=>!e.ok).map(e=>`${e.name}: ${e.actual}`),[],'rejection, return, cancel, transfer and task endings must all hold');
  assert.equal(endings.length,5);
  const blocked=auditSelfService(db);
  assert.deepEqual(blocked.map(b=>`${b.department}/${b.code}: ${b.reason}`),[],'a department head must be able to request their own department’s services through escalation');
});
