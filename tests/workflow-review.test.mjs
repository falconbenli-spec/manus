import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewWorkflows } from '../scripts/workflow-review.mjs';

test('REVIEW: every service routes the way its own nature requires',()=>{
  const findings=reviewWorkflows();
  const shown=f=>`${f.code} [${f.rule}] ${f.message}`;
  assert.deepEqual(findings.filter(f=>f.severity.trim()==='عالية').map(shown),[],'no service may skip a control its nature requires');
  assert.deepEqual(findings.filter(f=>f.severity.trim()==='متوسطة').map(shown),[],'no service may reach a decision without money control, context or a fitting service level');
  assert.deepEqual(findings.map(shown),[],'catalogue must stay clean of workflow findings');
});
