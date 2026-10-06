import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import * as wf from '../app/workflow.mjs';
import { executiveOverview } from '../app/workspace.mjs';

test('المؤشر التنفيذي يقيس المكتمل مقابل زمن الخدمة ويستبعد غير القابل للقياس',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-timeliness-only');installServiceCatalog(db);t.after(()=>db.close());
  const user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const service=wf.catalog(db,user('employee')).find(s=>s.code==='IT-SUPPORT');
  const board=()=>executiveOverview(db,user('admin')).totals;
  assert.equal(board().on_time,null);
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-20T06:00:00Z')});
  function completed(end){
    let r=wf.createRequest(db,user('employee'),{service_id:service.id,title:'طلب مصطنع لقياس الزمن',payload:{issue:'اختبار مؤشر الزمن فقط',impact:'استفسار'},project_id:null});
    // الانتقال داخل معاملة كما يناديه الخادم: transition يشترطها منذ حارس المعاملة في app/workflow.mjs.
    r=transaction(db,()=>wf.transition(db,user('employee'),r.id,'submit',{version:r.version}));
    db.prepare("UPDATE requests SET status='completed',updated_at=? WHERE id=?").run(end,r.id);
  }
  db.prepare("UPDATE service_directory SET target_days=1,target_hours=NULL WHERE service_code='IT-SUPPORT'").run();
  completed('2026-09-23T06:00:00Z');
  assert.equal(board().on_time,0);
  completed('2026-09-21T06:00:00Z');
  assert.equal(board().on_time,50);
  assert.equal(board().on_time_measured,2);
  db.prepare("UPDATE service_directory SET target_days=0,target_hours=NULL WHERE service_code='IT-SUPPORT'").run();
  assert.equal(board().on_time,null);
  assert.equal(board().on_time_unmeasured,2);
  db.prepare("UPDATE service_directory SET target_days=1,target_hours=2 WHERE service_code='IT-SUPPORT'").run();
  db.prepare("UPDATE requests SET updated_at='2026-09-20T09:00:00Z' WHERE status='completed'").run();
  assert.equal(board().on_time,0);
});
