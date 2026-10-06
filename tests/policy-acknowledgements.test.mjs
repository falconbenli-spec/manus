import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy } from '../app/hr-contracts.mjs';
import { acknowledgementsBoard, openRound, roundAction, acknowledgePolicy } from '../app/policy-acknowledgements.mjs';

const code=value=>error=>error.code===value;
const riyadh=(offset=0)=>new Date(Date.now()+3*3600000+offset*86400000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-knowledge-access');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.policy.accept',note:'تجريبي'}));
  const policy=body=>{const id=tx(()=>preparePolicy(db,users.hr,{kind:'working_time',title:'ساعات العمل التجريبية',body,basis:'قرار تجريبي للاختبار فقط',effective_from:riyadh(),parameters:{workdays:[0,1,2,3,4],start:'08:00',end:'16:00',grace_minutes:15}})).id;tx(()=>decidePolicy(db,users.manager,id,'accept',{note:'اعتماد تجريبي للاختبار'}));return id;};
  return {db,users,tx,policy};
}
const round=(db,u,policy_id,extra={})=>openRound(db,u,{policy_id,audience:'role',audience_value:'employee',due_on:riyadh(7),...extra});

test('policy acknowledgement: tied to the exact version, a new version needs a new acknowledgement, and the old one stays with its version',t=>{
  const {db,users,tx,policy}=fixture(t);
  const v1=policy('يبدأ الدوام التجريبي الساعة الثامنة صباحًا وينتهي الرابعة عصرًا.');
  assert.throws(()=>tx(()=>round(db,users.employee,v1)),code('not_permitted'));
  const r1=tx(()=>round(db,users.manager,v1)).id;
  assert.throws(()=>tx(()=>round(db,users.manager,v1)),code('round_exists'));
  let mine=acknowledgementsBoard(db,users.employee).pending_mine;
  assert.equal(mine.length,1);assert.equal(mine[0].policy_revision,1);assert.match(mine[0].body,/الثامنة صباحًا/,'the employee acknowledges the text, not a title');
  assert.ok(acknowledgementsBoard(db,users.employee).awaiting_me.length===1);
  // لا أحد يقر عن غيره، ولا إقرار دون تأكيد، ولا بنسخة غير المعروضة.
  assert.throws(()=>tx(()=>acknowledgePolicy(db,users.employee,r1,{policy_revision:1,confirm:true,user_id:'outsider'})),code('invalid_fields'));
  assert.throws(()=>tx(()=>acknowledgePolicy(db,users.hr,r1,{policy_revision:1,confirm:true})),code('not_found'),'hr was not asked for this round');
  assert.throws(()=>tx(()=>acknowledgePolicy(db,users.employee,r1,{policy_revision:1,confirm:false})),code('confirm'));
  assert.throws(()=>tx(()=>acknowledgePolicy(db,users.employee,r1,{policy_revision:2,confirm:true})),code('revision_mismatch'));
  const ack=tx(()=>acknowledgePolicy(db,users.employee,r1,{policy_revision:1,confirm:true}));
  assert.equal(ack.policy_revision,1);
  assert.throws(()=>tx(()=>acknowledgePolicy(db,users.employee,r1,{policy_revision:1,confirm:true})),code('already_acknowledged'));
  assert.throws(()=>db.prepare("UPDATE policy_acknowledgements SET policy_revision=2").run(),/never rewritten/);
  assert.throws(()=>db.prepare("INSERT INTO policy_acknowledgements(id,tenant_id,round_id,user_id,policy_id,policy_revision,content_digest,acknowledged_at) VALUES('x','36t',?,'outsider',?,1,?,'2026-01-01')").run(r1,v1,'0'.repeat(64)),/exact open policy version/);
  // نسخة جديدة = صف سياسة جديد = جولة جديدة وإقرار جديد؛ الإقرار الأول يبقى على النسخة 1.
  const v2=policy('يبدأ الدوام التجريبي الساعة التاسعة صباحًا وينتهي الخامسة مساءً.');
  const owner=acknowledgementsBoard(db,users.manager);
  assert.deepEqual(owner.policies_without_round.map(p=>[p.id,p.policy_revision]),[[v2,2]]);
  const r2=tx(()=>round(db,users.manager,v2)).id;
  mine=acknowledgementsBoard(db,users.employee).pending_mine;
  assert.deepEqual(mine.map(m=>[m.id,m.policy_revision]),[[r2,2]],'acknowledging version 1 does not cover version 2');
  assert.deepEqual(acknowledgementsBoard(db,users.employee).my_acknowledgements.map(a=>a.policy_revision),[1]);
  assert.ok(verifyAudit(db));
});

test('policy acknowledgement: the owner sees a clear list of who has not acknowledged, can remind them, and a closed round is final evidence',t=>{
  const {db,users,tx,policy}=fixture(t);
  const id=policy('يبدأ الدوام التجريبي الساعة الثامنة صباحًا وينتهي الرابعة عصرًا.');
  const r=tx(()=>round(db,users.manager,id)).id;
  tx(()=>acknowledgePolicy(db,users.employee,r,{policy_revision:1,confirm:true}));
  let view=acknowledgementsBoard(db,users.manager).rounds.find(x=>x.id===r);
  assert.equal(view.requested,2);assert.equal(view.acknowledged,1);assert.deepEqual(view.pending.map(p=>p.user_id),['outsider']);
  assert.equal(view.owner_name,users.manager.name,'the policy owner is whoever accepted this version');
  assert.ok(view.actions.includes('remind_round'));
  assert.throws(()=>tx(()=>roundAction(db,users.manager,r,'remind_round',{version:view.version+5})),code('stale_version'));
  tx(()=>roundAction(db,users.manager,r,'remind_round',{version:view.version}));
  assert.equal(acknowledgementsBoard(db,users.outsider).pending_mine[0].reminder_count,1);
  view=acknowledgementsBoard(db,users.manager).rounds.find(x=>x.id===r);
  assert.throws(()=>tx(()=>roundAction(db,users.employee,r,'close_round',{version:view.version,note:'إغلاق من غير المالك'})),code('not_found'));
  const closed=tx(()=>roundAction(db,users.manager,r,'close_round',{version:view.version,note:'انتهت مدة الإقرار التجريبية'}));
  assert.equal(closed.left_pending,1,'closing never assumes anyone acknowledged');
  assert.throws(()=>tx(()=>acknowledgePolicy(db,users.outsider,r,{policy_revision:1,confirm:true})),code('action_unavailable'));
  assert.throws(()=>db.prepare("UPDATE policy_ack_rounds SET due_on='2099-01-01',version=version+1 WHERE id=?").run(r),/closed round is final/);
  assert.throws(()=>db.prepare('DELETE FROM policy_ack_recipients').run(),/evidence/);
  assert.ok(verifyAudit(db));
});

test('policy acknowledgement: tenants are isolated, only accepted policies can be put to acknowledgement, and the screen never calls it a legal obligation',t=>{
  const {db,users,tx,policy}=fixture(t);
  const id=policy('يبدأ الدوام التجريبي الساعة الثامنة صباحًا وينتهي الرابعة عصرًا.');
  const draft=tx(()=>preparePolicy(db,users.hr,{kind:'working_time',title:'مسودة تجريبية',body:'نص مسودة تجريبية لم تعتمد بعد لاختبار المنع.',basis:'قرار تجريبي للاختبار فقط',effective_from:riyadh(),parameters:{workdays:[0,1,2,3,4],start:'08:00',end:'16:00',grace_minutes:15}})).id;
  assert.throws(()=>tx(()=>round(db,users.manager,draft)),code('not_found'));
  assert.throws(()=>tx(()=>round(db,users.manager,id,{due_on:riyadh(-1)})),code('due_on'));
  assert.throws(()=>tx(()=>round(db,users.external,id)),code('not_permitted'));
  const r=tx(()=>round(db,users.manager,id,{audience:'all',audience_value:''})).id;
  assert.equal(acknowledgementsBoard(db,users.external).pending_mine.length,0);assert.equal(acknowledgementsBoard(db,users.external).rounds.length,0);
  assert.throws(()=>tx(()=>acknowledgePolicy(db,users.external,r,{policy_revision:1,confirm:true})),code('not_found'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM policy_ack_recipients r JOIN users u ON u.id=r.user_id WHERE u.tenant_id<>'36t' OR u.role='admin'").get().n,0);
  const note=acknowledgementsBoard(db,users.manager).note;
  assert.match(note,/ضبط داخلي/);assert.match(note,/ليس توقيعًا ولا إلزامًا نظاميًا/);
  assert.ok(verifyAudit(db));
});
