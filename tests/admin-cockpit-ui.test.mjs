import test from 'node:test';
import assert from 'node:assert/strict';
import { adminCockpitUI } from '../app/static/admin-cockpit-ui.mjs';

const check=(state,note,evidence={})=>({state,checked_at:'2026-10-02T09:00:00.000Z',evidence,note});
const fixture={
  generated_at:'2026-10-02T09:00:00.000Z',
  build:check('healthy','بصمة حديثة',{commit:'a'.repeat(40),files:712}),
  database:{migration:check('healthy','آخر ترحيل',{latest:195}),schema:check('unknown','لا يوجد فحص مستقل'),backup:check('warning','النسخة أقدم من الحد',{age_hours:31})},
  jobs:{queue:check('failed','توجد مهمة ميتة',{dead:1,overdue:2}),feature_flags:check('healthy','الأعلام ضمن مددها',{enabled:2})},
  security:{audit_chain:check('healthy','السلسلة سليمة'),ai_inventory:check('warning','أصل بانتظار التقييم',{proposed:1})},
  access_reviews:{campaign:check('warning','لا توجد حملة مفتوحة',{open:0})},
  integrations:{connections:check('warning','الروابط بانتظار الإثبات',{active:0,blocked:8,simulated:3,sandbox_ready:1})},
  data_quality:{executive_metrics:check('warning','تعريفات بلا رصد',{without_observation:6})}
};

test('admin cockpit links to source tools and never renders business KPIs',()=>{
  const html=adminCockpitUI.render(fixture);
  for(const href of ['#jobs','#feature-flags','#access-reviews','#integrations','#ai-governance'])assert.match(html,new RegExp(`href="${href}"`));
  assert.match(html,/مركز تشغيل المنصة/);
  assert.match(html,/صحة الخدمة/);
  assert.match(html,/الأمن والصلاحيات/);
  assert.doesNotMatch(html,/رواتب|ربحية عميل|قيمة القمع/);
  assert.doesNotMatch(html,/undefined|\bNaN\b| style=|<script/);
});

test('every operational check shows its state and evidence time',()=>{
  const html=adminCockpitUI.render(fixture);
  assert.equal((html.match(/class="admin-health-card is-/g)||[]).length,11);
  assert.equal((html.match(/data-checked-at="2026-10-02T09:00:00.000Z"/g)||[]).length,11);
  assert.match(html,/سليم/);
  assert.match(html,/يحتاج متابعة/);
  assert.match(html,/فشل/);
  assert.match(html,/غير معروف/);
});

test('admin cockpit escapes notes and renders no individual records',()=>{
  const hostile=structuredClone(fixture);
  hostile.database.backup.note='<img src=x onerror=alert(1)>';
  hostile.jobs.queue.evidence={dead:1,employee_name:'شخص تجريبي'};
  const html=adminCockpitUI.render(hostile);
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img|شخص تجريبي/i);
});
