import test from 'node:test';
import assert from 'node:assert/strict';
import { hijri, dual } from '../app/dates.mjs';
import { readFileSync } from 'node:fs';

test('dual dates: Umm al-Qura conversion matches known anchors, bad input yields nothing, and the browser copy is identical to the server copy',()=>{
  assert.equal(hijri('2026-03-20'),'1 شوال 1447 هـ','Eid al-Fitr 1447 in the Umm al-Qura calendar');
  assert.equal(hijri('2026-09-17'),'6 ربيع الآخر 1448 هـ');
  assert.equal(hijri('2026-09-17T10:00:00.000Z'),'6 ربيع الآخر 1448 هـ');
  assert.equal(hijri('not-a-date'),'');assert.equal(hijri(null),'');
  assert.equal(dual('2026-03-20'),'2026-03-20 · 1 شوال 1447 هـ');assert.equal(dual(''),'');
  assert.equal(readFileSync(new URL('../app/dates.mjs',import.meta.url),'utf8'),readFileSync(new URL('../app/static/dates.mjs',import.meta.url),'utf8'));
});
