import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { platformHealth } from '../app/platform-health.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';

const PASSWORD='synthetic-platform-health';
const NOW='2026-10-02T09:00:00.000Z';

function fixture(t){
  const db=openDb(':memory:');
  seed(db,PASSWORD);
  t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(row=>[row.id,row]));
  return {db,users};
}

test('missing, stale, and failed independent checks never report healthy',t=>{
  const {db,users}=fixture(t);
  const data=platformHealth(db,users.admin,{
    now:NOW,
    build:{commit:'a'.repeat(40),source_digest:'b'.repeat(64),files:712,computed_at:NOW},
    checks:{
      backup:null,
      audit:{ok:true,checked_at:'2026-09-28T09:00:00.000Z'},
      schema:{ok:false,checked_at:NOW,evidence:{expected:'one',actual:'two'},note:'لم تطابق البصمة المرجعية'}
    }
  });
  assert.equal(data.database.backup.state,'unknown');
  assert.equal(data.security.audit_chain.state,'warning');
  assert.equal(data.database.schema.state,'failed');
  assert.equal(data.database.schema.checked_at,NOW);
});

test('platform health is read-only, aggregate, and strips unapproved build fields',t=>{
  const {db,users}=fixture(t);
  const before=db.prepare('SELECT total_changes() AS n').get().n;
  const data=platformHealth(db,users.admin,{
    now:NOW,
    build:{commit:'a'.repeat(40),source_digest:'b'.repeat(64),files:712,computed_at:NOW,password:'canary',token:'canary',secret:'canary'},
    checks:{audit:{ok:true,checked_at:NOW},backup:{ok:true,checked_at:NOW,age_hours:2},schema:{ok:true,checked_at:NOW}}
  });
  const text=JSON.stringify(data);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
  assert.deepEqual(Object.keys(data).sort(),['access_reviews','build','data_quality','database','generated_at','integrations','jobs','security']);
  assert.doesNotMatch(text,/password|token|secret|DATABASE_URL|canary/i);
  assert.doesNotMatch(text,/employee|manager|admin@|اسم موظف/i);
  assert.deepEqual(Object.keys(data.build.evidence).sort(),['commit','files','source_digest']);
  for(const check of [data.build,data.database.migration,data.database.schema,data.database.backup,data.jobs.queue,data.jobs.feature_flags,
    data.security.audit_chain,data.security.ai_inventory,data.access_reviews.campaign,data.integrations.connections,data.data_quality.executive_metrics]){
    assert.deepEqual(Object.keys(check).sort(),['checked_at','evidence','note','state']);
  }
});

test('platform health requires the platform operations capability',t=>{
  const {db,users}=fixture(t);
  assert.throws(()=>platformHealth(db,users.employee,{now:NOW}),error=>error?.status===403);
  assert.doesNotThrow(()=>platformHealth(db,users.admin,{now:NOW}));
});

test('platform health API stays separate from employee access',async t=>{
  const {db}=fixture(t);
  // صحة دليل الإقلاع تُقاس إلى ساعة هذا الطلب. كان استخدام تاريخ ثابت يجعل الاختبار يفشل تلقائيًا بعد 24 ساعة
  // رغم أن الغرض هنا هو فصل صلاحية الموظف عن صلاحية مشغّل المنصة، لا اختبار تقادم الدليل (له اختبار مستقل أعلاه).
  const checkedAt=new Date().toISOString();
  const buildAtBoot={commit:'a'.repeat(40),source_digest:'b'.repeat(64),files:712,computed_at:checkedAt};
  const app=createApp(db,{buildAtBoot,auditCheckedAtBoot:{ok:true,at:checkedAt},platformChecks:{backup:{ok:true,checked_at:checkedAt,age_hours:2},schema:{ok:true,checked_at:checkedAt}}});
  const login=async username=>(await dispatch(app,{method:'POST',path:'/api/login',body:{username,password:PASSWORD}})).headers['Set-Cookie'].split(';')[0];
  assert.equal((await dispatch(app,{path:'/api/platform-health'})).status,401);
  assert.equal((await dispatch(app,{path:'/api/platform-health',headers:{cookie:await login('employee')}})).status,403);
  const response=await dispatch(app,{path:'/api/platform-health',headers:{cookie:await login('admin')}});
  assert.equal(response.status,200);
  assert.equal(response.json().database.backup.state,'healthy');
});
