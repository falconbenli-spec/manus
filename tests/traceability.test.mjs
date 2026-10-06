import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTraceability,readJson } from '../scripts/trace.mjs';
test('TRACE: all 220 original rows and acceptance criteria match the workbook and evidence',()=>{
  const summary=validateTraceability();assert.equal(summary.total,220);assert.equal(summary.domains,22);
});
test('TRACE: changing acceptance or declaring partial work complete is rejected',()=>{
  const changed=readJson('docs/implementation/REQUIREMENTS.json');changed.requirements[0].acceptance='changed';
  assert.throws(()=>validateTraceability(changed,{checkMirror:false}),/source field changed/);
  const partial=readJson('docs/implementation/REQUIREMENTS.json');const r=partial.requirements.find(r=>r.implementation.coverage==='جزئي');r.implementation.status='متحقق تقنيًا';
  assert.throws(()=>validateTraceability(partial,{checkMirror:false}),/partial requirement/);
});
