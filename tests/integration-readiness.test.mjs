import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { integrationReadiness } from '../app/integration-readiness.mjs';
import { integrationCards } from '../app/static/integrations-ui.mjs';

test('خريطة التكاملات ترفض الدور المزور وتسحب الوصول فور تغيير الدور',t=>{
  const db=openDb(':memory:');t.after(()=>db.close());seed(db,'synthetic-only');
  const employee=db.prepare("SELECT * FROM users WHERE id='employee'").get();
  assert.throws(()=>integrationReadiness(db,{...employee,role:'admin'}),{code:'forbidden'});
  const manager=db.prepare("SELECT * FROM users WHERE id='manager'").get();
  const result=integrationReadiness(db,manager);
  // الحزمة 3: البنك (تنفيذ الدفع والكشوف) جهةٌ في الخريطة، والحالة بمفردات العقد: محاكاة أو جاهز لبيئة اختبار أو موقوف — ولا «active».
  assert.equal(result.connections.length,13);
  assert.ok(result.connections.every(c=>!c.adapter_implemented&&['simulated','sandbox-ready','blocked'].includes(c.status)&&c.last_success===null&&c.blockers.length));
  db.prepare("UPDATE users SET role='employee' WHERE id='manager'").run();
  assert.throws(()=>integrationReadiness(db,manager),{code:'forbidden'});
});

test('واجهة الربط تعرض الموانع وتهرب المحتوى ولا توهم باتصال ناجح',()=>{
  const e=v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;');
  const html=integrationCards({reason:'<script>',blocked_events:0,connections:[{name:'<img>',purpose:'نقل',blockers:['<script>']}]},{e});
  assert.doesNotMatch(html,/<script>|<img>/);
  assert.match(html,/الموصل غير منفذ/);
  assert.doesNotMatch(html,/متصل ويعمل/);
  assert.match(html,/&lt;script&gt;/);
});
