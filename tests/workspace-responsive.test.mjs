import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css=readFileSync(new URL('../app/static/workspace.css',import.meta.url),'utf8');
test('workspace keeps mobile tools reachable and respects reduced motion',()=>{
  assert.match(css,/@media\s*\(max-width:\s*760px\)/);assert.match(css,/position:\s*sticky/);assert.match(css,/overflow-x:\s*auto/);
  assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)/);assert.match(css,/min-height:\s*44px/);
  assert.doesNotMatch(css,/min-width:\s*(?:[89]\d\d|\d{4,})px/,'no desktop minimum forces horizontal page overflow');
});
