import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessWith, accessReason } from '../legacy/lovable/src/lib/access.ts';

test('F09: an unknown route is denied for every role', () => {
  for (const roles of [[], ['employee'], ['ceo']]) {
    assert.equal(canAccessWith('/unregistered-module', roles), false);
  }
  assert.match(accessReason('/unregistered-module', ['employee']), /مرفوض/);
});

test('F09: known rules and explicit empty overrides keep their meaning', () => {
  assert.equal(canAccessWith('/me', ['employee']), true);
  assert.equal(canAccessWith('/payroll', ['employee']), false);
  assert.equal(canAccessWith('/payroll', ['finance']), true);
  assert.equal(canAccessWith('/payroll', ['finance'], { '/payroll': [] }), false);
});
