import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { RETENTION, sweepRetention, runWorkflowSweep } from '../app/workflow-sweep.mjs';

// أول قاعدة احتفاظ تُطبَّق فعلًا على المنصة: الجلسة المنتهية وصفّ المحاولات خارج نافذته كانا يبقيان إلى الأبد،
// وفي الجلسة user_id وcsrf وعنوان العميل. الكنس اليومي يحذفهما ولا يقترب من سجل التدقيق. كل ما هنا مصطنع.
const DAY=86400000,MINUTE=60000;
const NOW=Date.parse('2026-09-29T09:00:00.000Z');
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-retention-sweep');t.after(()=>db.close());
  const session=(name,expiresAt)=>db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,last_seen,address) VALUES(?,?,?,?,?,?)')
    .run(hash(name),'employee',`csrf-${name}`,expiresAt,expiresAt-3600000,'10.0.0.9');
  const attempt=(name,windowStart)=>db.prepare('INSERT INTO login_attempts VALUES(?,?,?)').run(hash(name),3,windowStart);
  const tokens=()=>db.prepare('SELECT token_hash FROM sessions').all().map(r=>r.token_hash).sort();
  const keys=()=>db.prepare('SELECT key FROM login_attempts').all().map(r=>r.key).sort();
  return {db,session,attempt,tokens,keys};
}

test('retention: the periods are named constants that the owner can change in one place',()=>{
  assert.ok(Number.isFinite(RETENTION.expired_session_days)&&RETENTION.expired_session_days>0);
  assert.ok(Number.isFinite(RETENTION.login_attempt_minutes)&&RETENTION.login_attempt_minutes>=15,'never shorter than the 15-minute counting window in auth.mjs');
});

test('retention: expired sessions and spent login attempts are deleted, live ones are left alone',t=>{
  const {db,session,attempt,tokens,keys}=fixture(t);
  session('live',NOW+4*3600000);
  session('just-expired',NOW-3600000);
  session('long-expired',NOW-(RETENTION.expired_session_days+1)*DAY);
  session('ancient',NOW-40*DAY);
  attempt('counting',NOW-5*MINUTE);
  attempt('spent',NOW-(RETENTION.login_attempt_minutes+5)*MINUTE);
  attempt('thirteen-days',NOW-13*DAY);
  const auditBefore=db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;

  const result=transaction(db,()=>sweepRetention(db,{now:NOW}));
  assert.equal(result.expired_sessions_deleted,2);
  assert.equal(result.login_attempts_deleted,2);
  assert.deepEqual(tokens(),[hash('just-expired'),hash('live')].sort(),'a session expired inside the grace period is kept for the incident trail');
  assert.deepEqual(keys(),[hash('counting')]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,auditBefore,'the audit trail is never swept');
});

test('retention: a second run in the same day deletes nothing and does not fail',t=>{
  const {db,session,attempt}=fixture(t);
  session('long-expired',NOW-30*DAY);attempt('spent',NOW-30*DAY);
  const first=transaction(db,()=>sweepRetention(db,{now:NOW}));
  assert.equal(first.expired_sessions_deleted,1);assert.equal(first.login_attempts_deleted,1);
  const again=transaction(db,()=>sweepRetention(db,{now:NOW}));
  assert.equal(again.expired_sessions_deleted,0);assert.equal(again.login_attempts_deleted,0);
});

test('retention: the daily sweep carries it, and the shape the sweep already reported is unchanged',t=>{
  const {db,session,attempt}=fixture(t);
  session('long-expired',NOW-30*DAY);attempt('spent',NOW-30*DAY);
  const user=db.prepare("SELECT * FROM users WHERE id='admin'").get();
  const result=transaction(db,()=>runWorkflowSweep(db,'36t','2026-09-29',user,NOW));
  assert.equal(result.retention.expired_sessions_deleted,1,'the daily job is what runs it — no new timer in server.mjs');
  assert.equal(result.retention.login_attempts_deleted,1);
  assert.deepEqual(Object.keys(result.acted).sort(),['departed_work_returned','employee_changes_applied','returned_lapsed','returned_reminded','steps_blocked','steps_moved_timeout','steps_moved_unqualified'],'retention is reported beside acted, not inside it');
  assert.equal(result.failures,undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  assert.ok(verifyAudit(db));
});
