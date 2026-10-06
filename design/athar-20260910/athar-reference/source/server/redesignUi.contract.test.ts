import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');
const css=read('client/public/brand/people-design.css');
const app=read('client/src/App.tsx');
const layout=read('client/src/components/layout/MainLayout.tsx');
const states=read('client/src/components/feedback/AsyncState.tsx');
const scene=read('client/src/components/experience/AtharScene.tsx');
const native=read('client/public/brand/athar-motion.js');
const portal=read('server/portal-app.html');
describe('3,6T Athar redesign contract',()=>{
 it('keeps local Alexandria, both themes and a reduced-motion fallback',()=>{
  expect(css).toContain('Alexandria');expect(css).toContain('.dark');
  expect(css).toContain('prefers-reduced-motion: reduce');
  expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  expect(portal).toContain('<html lang="ar" dir="rtl">');
 });
 it('provides recoverable loading, empty and error states',()=>{
  for(const component of ['LoadingState','EmptyState','ErrorState'])expect(states).toContain(`export function ${component}`);
  expect(states).toContain('onRetry');expect(states).toContain('role="alert"');expect(css).toContain(':focus-visible');
 });
 it('keeps navigation searchable and exposes the main-content landmark',()=>{
  expect(layout).toContain('aria-label="البحث في المنصة"');expect(layout).toContain('id="main-content"');expect(layout).toContain('aria-label="أقسام المنصة"');
  expect(app).toContain('if (loading) return;');
 });
 it('uses contained canvas artwork instead of the cancelled bees or sculpture',()=>{
  for(const code of [scene,native]){expect(code).toContain('IntersectionObserver');expect(code).toContain('visibilitychange');expect(code).toContain('cancelAnimationFrame');expect(code).toContain('prefers-reduced-motion');expect(code).toContain('people36t-motion-paused');}
  expect(portal).toContain('/brand/athar-motion.js');expect(portal).not.toMatch(/bee-scene\.js|impact-sculpture\.webp|data-impact-scene/);
  expect(read('client/src/components/brand/AuthShell.tsx')).toContain('<AtharScene');expect(read('client/src/pages/EmployeePortal.tsx')).toContain('<AtharScene');
 });
 it('labels both independent native login fields',()=>{expect(portal).toContain('for="emp-id"');expect(portal).toContain('for="emp-pass"');expect(portal).toContain('autocomplete="current-password"');});
});
