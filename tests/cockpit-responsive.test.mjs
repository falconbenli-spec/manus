import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = () => readFileSync(new URL('../app/static/cockpit.css', import.meta.url), 'utf8');

test('cockpit layout has explicit narrow-screen and reduced-motion behavior', () => {
  const source = css();
  assert.match(source, /@media\s*\(max-width:\s*720px\)/);
  assert.match(source, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(source, /minmax\(0,\s*1fr\)/);
  assert.match(source, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(source, /@import|https?:\/\//);
});

test('cockpit controls keep a mobile touch target and visible keyboard focus', () => {
  const source = css();
  assert.match(source, /min-height:\s*44px/);
  assert.match(source, /:focus-visible/);
  assert.match(source, /grid-template-columns:\s*1fr/);
});
