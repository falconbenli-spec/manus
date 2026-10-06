import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { registerHandler, clearHandlers, enqueue, runDue, claimNext, jobsBoard, retryJob, cancelJob, backoffMs } from '../app/jobs.mjs';

const code=value=>error=>error.code===value;
const T0=Date.parse('2026-09-20T09:00:00Z');
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-platform-ops');clearHandlers();t.after(()=>{clearHandlers();db.close();});
  // جدول أثر تجريبي يملكه الاختبار: المعالج يكتب فيه، فيُعد الأثر فعلًا.
  db.exec('CREATE TABLE job_effects(job_id TEXT NOT NULL, note TEXT NOT NULL)');
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const job=(u,key,extra={})=>tx(()=>enqueue(db,u,{type:'demo.note',payload:{note:'تجريبي'},idempotency_key:key,source:{entity:'request',id:'REQ-TEST-1'},due_at:new Date(T0).toISOString(),...extra}));
  return {db,users,tx,job};
}
const effects=db=>db.prepare('SELECT COUNT(*) AS n FROM job_effects').get().n;

test('jobs: the same idempotency key yields one job and running twice never doubles the effect',t=>{
  const {db,users,job}=fixture(t);
  registerHandler('demo.note',(db,j)=>{db.prepare('INSERT INTO job_effects VALUES(?,?)').run(j.id,j.payload.note);return {written:1};});
  const first=job(users.manager,'approve-REQ-TEST-1'),again=job(users.manager,'approve-REQ-TEST-1');
  assert.equal(again.id,first.id);assert.equal(again.duplicate,true);
  assert.throws(()=>job(users.manager,'approve-REQ-TEST-1',{payload:{note:'مختلف'}}),code('idempotency_conflict'));
  assert.deepEqual(runDue(db,{now:T0}).map(r=>r.outcome),['done']);
  assert.deepEqual(runDue(db,{now:T0+3600000}),[],'a done job is never picked again');
  assert.equal(effects(db),1);
  assert.throws(()=>db.prepare("UPDATE jobs SET status='queued',finished_at=NULL,version=version+1").run(),/never rewritten/);
  assert.throws(()=>db.prepare('DELETE FROM jobs').run(),/retained/);
  assert.ok(verifyAudit(db));
});

test('jobs: claiming is atomic — a claimed job is invisible to another worker until its lock expires',t=>{
  const {db,users,job}=fixture(t);
  registerHandler('demo.note',()=>null);
  job(users.manager,'claim-test-0001');
  const a=claimNext(db,'36t',{worker:'A',now:T0,lockMs:60000});
  assert.equal(a.status,'running');assert.equal(a.locked_by,'A');assert.equal(a.attempts,1);
  assert.equal(claimNext(db,'36t',{worker:'B',now:T0+1000,lockMs:60000}),null);
  const b=claimNext(db,'36t',{worker:'B',now:T0+61000,lockMs:60000});
  assert.equal(b.id,a.id,'a worker that died holding the job gives it back after the lock expires');assert.equal(b.locked_by,'B');assert.equal(b.attempts,2);
});

test('jobs: a handler that loses its lock mid-run leaves no effect behind',t=>{
  const {db,users,job}=fixture(t);
  registerHandler('demo.note',(db,j)=>{
    db.prepare('INSERT INTO job_effects VALUES(?,?)').run(j.id,'أثر يجب أن يتراجع');
    // نسخة أخرى تلتقط المهمة بعد انتهاء القفل أثناء عمل المعالج.
    db.prepare("UPDATE jobs SET locked_by='other-worker',version=version+1 WHERE id=?").run(j.id);
  });
  job(users.manager,'lost-lock-0001');
  assert.deepEqual(runDue(db,{now:T0,worker:'A'}).map(r=>r.outcome),['lost_lock']);
  assert.equal(effects(db),0,'the effect and the done mark commit together or not at all');
});

test('jobs: failures back off exponentially, then the job dies and waits for the platform admin, whose retry needs a reason and the current version',t=>{
  const {db,users,tx,job}=fixture(t);
  let calls=0;registerHandler('demo.note',()=>{calls++;throw new Error('خدمة داخلية غير متاحة');});
  const {id}=job(users.manager,'retry-test-0001',{max_attempts:3});
  assert.equal(runDue(db,{now:T0})[0].outcome,'retry');
  assert.equal(db.prepare('SELECT due_at FROM jobs WHERE id=?').get(id).due_at,new Date(T0+backoffMs(1)).toISOString());
  assert.deepEqual(runDue(db,{now:T0+backoffMs(1)-1}),[],'not before its backoff');
  assert.equal(runDue(db,{now:T0+backoffMs(1)})[0].outcome,'retry');
  assert.equal(backoffMs(2),2*backoffMs(1));
  assert.equal(runDue(db,{now:T0+backoffMs(1)+backoffMs(2)})[0].outcome,'dead');
  assert.equal(calls,3);
  assert.deepEqual(runDue(db,{now:T0+86400000}),[],'a dead job never runs by itself');
  const board=jobsBoard(db,users.admin);
  assert.equal(board.counts.dead,1);assert.equal(board.alerts.length,1);assert.match(board.dead[0].last_error,/غير متاحة/);assert.deepEqual(board.dead[0].actions,['retry_job','cancel_job']);
  assert.throws(()=>jobsBoard(db,users.employee),code('not_permitted'));
  assert.throws(()=>tx(()=>retryJob(db,users.manager,id,{version:board.dead[0].version,reason:'إعادة بعد إصلاح الخدمة الداخلية'})),code('not_permitted'));
  assert.throws(()=>tx(()=>retryJob(db,users.admin,id,{version:board.dead[0].version-1,reason:'إعادة بعد إصلاح الخدمة الداخلية'})),code('stale_version'));
  assert.throws(()=>tx(()=>retryJob(db,users.admin,id,{version:board.dead[0].version,reason:'قصير'})),code('invalid_text'));
  tx(()=>retryJob(db,users.admin,id,{version:board.dead[0].version,reason:'إعادة بعد إصلاح الخدمة الداخلية'}));
  const row=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);assert.equal(row.status,'queued');assert.equal(row.attempts,0);
  tx(()=>cancelJob(db,users.admin,id,{version:row.version,reason:'لم تعد المهمة لازمة بعد القرار'}));
  assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE entity_id=? AND action='job.retried' AND reason<>''").get(id));
  assert.ok(verifyAudit(db));
});

test('jobs: a job that touches a sensitive record needs a live approved act behind it, and never runs on its own say',t=>{
  const {db,users,job}=fixture(t);
  assert.throws(()=>registerHandler('payroll.post',()=>null,{sensitive:true}),/authorise/);
  let approved=true;
  registerHandler('demo.note',(db,j)=>{db.prepare('INSERT INTO job_effects VALUES(?,?)').run(j.id,'x');},{sensitive:true,authorise:()=>approved});
  assert.throws(()=>job(users.manager,'no-source-0001',{source:undefined}),code('invalid_fields'));
  job(users.manager,'sensitive-0001');approved=false;
  const [r]=runDue(db,{now:T0});
  assert.equal(r.outcome,'dead');assert.match(r.error,/لم يعد ساريًا/);assert.equal(effects(db),0);
  assert.throws(()=>job(users.manager,'unknown-type-01',{type:'nobody.handles'}),code('job_type'));
});

test('jobs: tenants are isolated — keys, runs and the admin board never cross tenants',t=>{
  const {db,users,job}=fixture(t);
  registerHandler('demo.note',(db,j)=>{db.prepare('INSERT INTO job_effects VALUES(?,?)').run(j.id,j.tenant_id);});
  const mine=job(users.manager,'shared-key-0001'),theirs=job(users.external,'shared-key-0001');
  assert.notEqual(mine.id,theirs.id,'the same key in another tenant is another job');
  assert.equal(jobsBoard(db,users.admin).pending.length,1);
  assert.equal(runDue(db,{now:T0}).length,2);
  assert.deepEqual(db.prepare('SELECT note FROM job_effects ORDER BY note').all().map(r=>r.note),['36t','isolated']);
  assert.throws(()=>transaction(db,()=>retryJob(db,users.admin,theirs.id,{version:1,reason:'محاولة عبر الكيانات'})),code('not_found'));
  assert.ok(verifyAudit(db));
});
