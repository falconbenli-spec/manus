import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, fieldModel } from '../app/service-catalog.mjs';
import { payloadForStored } from '../scripts/qa-catalog-sweep.mjs';
import { proposeTimer, adoptTimer, adoptedTimerRows, NOT_ADOPTED } from '../app/workflow-timers.mjs';
import { sweepApprovals, stuckApprovals, overrideEscalation, escalationCandidates } from '../app/step-escalation.mjs';
import { obligations } from '../app/obligations.mjs';
import { clearInboxCache } from '../app/inbox.mjs';
import { backdate } from './escalation-equivalence.scenario.mjs';

// العطب 6: «التصعيد» كان يشعر المعتمد المتأخر نفسه بنص «تأخر المعتمد السابق» ويسجّل authority_changed:false.
// هنا التصعيد الحقيقي: القرار ينتقل إلى الدرجة التالية عبر الجدول الجانبي، ومعتمد الخطوة لا يُعدَّل. كل ما هنا مصطنع.
const code=value=>error=>error.code===value;
const BASIS='قرار تجريبي مصطنع للرئاسة بتاريخ 2026-09-22 لاختبار المهل';
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-step-escalation');installServiceCatalog(db);t.after(()=>db.close());
  const tx=f=>transaction(db,f),user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const service=c=>wf.catalog(db,user('admin')).find(s=>s.code===c);
  const raise=(c,who='employee')=>{const d=service(c);let r=tx(()=>wf.createRequest(db,user(who),{service_id:d.id,title:`طلب تجريبي — ${c}`,payload:payloadForStored(d.fields,fieldModel(c))}));
    return tx(()=>wf.transition(db,user(who),r.id,'submit',{version:r.version,note:''}));};
  const row=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const step=id=>db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND status='pending' ORDER BY revision DESC,position LIMIT 1").get(id);
  const adopt=(key,value)=>{const board=tx(()=>proposeTimer(db,user('admin'),{timer_key:key,value,basis:BASIS}));
    return tx(()=>adoptTimer(db,user('vp-growth'),board.timers.find(x=>x.key===key).proposed.id,{note:''}));};
  const sweep=()=>tx(()=>sweepApprovals(db,'36t',user('admin')));
  // الساعة تبدأ من لحظة الحدث أو لحظة تبنّي المهلة أيهما لاحق (تصحيحات اللائحة، الجولة الثانية):
  // تبنٍّ اليوم لا يُصعّد خطوة تأخرت أمس. وسيناريو «مهلة قائمة من قبل ثم تأخرت خطوة» يحتاج تبنّيًا أقدم من الخطوة.
  // صف المهلة لا يُعدَّل (مُطلِق يمنعه)، وsweepApprovals تقبل صفوف المهل وسيطًا، فتُمرَّر نسخة بتاريخ تبنٍّ أقدم.
  // تبنٍّ مؤرَّخ قبل الحدث. المُطلِق يمنع تعديل adopted_at بعد التبني، ويسمح بكتابته في الانتقال «مقترح ← متبنى» نفسه،
  // وهذا ما يجري هنا: اقتراح من بابه، ثم انتقال واحد مسموح بتاريخ أقدم. لا قادح يُسقط ولا صفّ يُعدَّل بعد استقراره.
  const adoptDated=(key,value,days)=>{
    const board=tx(()=>proposeTimer(db,user('admin'),{timer_key:key,value,basis:BASIS}));
    const id=board.timers.find(x=>x.key===key).proposed.id;
    db.prepare("UPDATE workflow_timer_settings SET status='adopted',adopted_by='vp-growth',adopted_at=? WHERE id=?").run(daysAgo(days),id);
  };
  const notes=(who,kind)=>db.prepare('SELECT * FROM notifications WHERE user_id=? AND kind=? ORDER BY created_at').all(who,kind);
  return {db,tx,user,raise,row,step,adopt,adoptDated,sweep,notes};
}
const daysAgo=n=>new Date(Date.now()-n*86400000).toISOString();

test('defect 6: with an adopted timer a late step really moves — the power to decide goes up the ladder, the approver row is untouched, and both people are told the truth',t=>{
  const {db,tx,user,raise,row,step,adopt,sweep,adoptDated,notes}=fixture(t);
  const r=raise('HR-LETTER');backdate(db,r.id,daysAgo(10));
  adoptDated('approval_escalation',2,20);
  const first=sweep();
  assert.deepEqual(first.timeout,{escalated:1,blocked:0});
  const moved=db.prepare('SELECT * FROM approval_step_escalations WHERE request_id=?').all(r.id);
  assert.equal(moved.length,1);assert.equal(moved[0].from_user_id,'manager');assert.equal(moved[0].to_user_id,'vp-growth','creative escalates to its registered reference');
  assert.equal(moved[0].basis,'timeout');assert.ok(moved[0].timer_row_id,'the row names the adopted timer it acted on');assert.equal(moved[0].actor_id,null,'the actor is the timer, not a person');
  assert.equal(step(r.id).approver_id,'manager','the step’s approver is immutable: escalation is a row beside it');
  // السلطة انتقلت فعلًا: المتأخر لا يقرر، ومن وصله القرار يقرر، و«ما عليّ» يتبع.
  assert.equal(wf.actions(db,user('manager'),row(r.id)).includes('approve'),false);
  assert.ok(wf.actions(db,user('vp-growth'),wf.getRequest(db,user('vp-growth'),r.id)).includes('approve'));
  assert.throws(()=>tx(()=>wf.transition(db,user('manager'),r.id,'approve',{version:row(r.id).version,note:''})),code('transition_denied'));
  clearInboxCache();
  assert.ok(obligations(db,user('vp-growth'),{watching:false}).items.some(i=>i.id===r.id&&i.bucket==='decide'));
  assert.equal(obligations(db,user('manager'),{watching:false}).items.some(i=>i.id===r.id&&i.bucket==='decide'),false);
  // إشعاران صادقان.
  const to=notes('vp-growth','approval_moved_to_you'),away=notes('manager','approval_moved_away');
  assert.equal(to.length,1);assert.match(to[0].body,/انقضت مهلة التصعيد المعتمدة/);assert.match(to[0].body,/مدير الفريق التجريبي/,'it names who held it');assert.match(to[0].body,/مرجع تصعيد/);
  assert.equal(away.length,1);assert.match(away[0].body,/لم يعد لك فيه اعتماد/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='manager' AND body LIKE '%تأخر القرار عند المعتمد السابق%'").get().n,0,'the late approver is never told «the previous approver was late»');
  assert.ok(wf.notifications(db,user('manager')).some(n=>n.kind==='approval_moved_away'),'the late approver keeps read access, so his notice is not hidden from him');
  const event=db.prepare("SELECT * FROM audit_events WHERE entity_id=? AND action='approval.escalated'").get(r.id),after=JSON.parse(event.after_json);
  assert.equal(after.authority_changed,true);assert.equal(after.timer_row_id,moved[0].timer_row_id);assert.equal(after.by,'workflow-sweep');
  // مرة لا مرتين: التشغيل الثاني في اليوم نفسه لا يفعل شيئًا (الخطوة وصلت صاحبها الجديد الآن).
  assert.deepEqual(sweep().timeout,{escalated:0,blocked:0});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_step_escalations').get().n,1);
  // سُلَّم لا درجة: إن تأخر من وصله القرار صعد إلى الدرجة التالية.
  const real=Date.now();t.mock.method(Date,'now',()=>real+12*86400000);
  assert.deepEqual(sweep().timeout,{escalated:1,blocked:0});
  t.mock.restoreAll();
  const levels=db.prepare('SELECT level,from_user_id,to_user_id FROM approval_step_escalations WHERE request_id=? ORDER BY level').all(r.id).map(x=>({...x}));
  assert.deepEqual(levels,[{level:1,from_user_id:'manager',to_user_id:'vp-growth'},{level:2,from_user_id:'vp-growth',to_user_id:'ceo'}]);
  assert.equal(wf.actions(db,user('vp-growth'),row(r.id)).includes('approve'),false,'whoever it passed no longer decides');
  const decided=tx(()=>wf.transition(db,user('ceo'),r.id,'approve',{version:row(r.id).version,note:''}));
  const done=decided.approvals.find(a=>a.position===0);
  assert.equal(done.approver_id,'manager');assert.equal(done.decided_by,'ceo');assert.equal(decided.escalations.length,2);
  assert.equal(decided.workflow.approves[0].name,'مدير الفريق التجريبي');
  assert.ok(verifyAudit(db));
});

test('defect 6: with no adopted timer nothing escalates, however old the step — and the result says why',t=>{
  const {db,raise,sweep,user}=fixture(t);
  const r=raise('HR-LETTER');backdate(db,r.id,daysAgo(40));
  const result=sweep();
  assert.deepEqual(result.timeout,{escalated:0,blocked:0,note:NOT_ADOPTED});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_step_escalations').get().n,0);
  assert.ok(wf.actions(db,user('manager'),wf.getRequest(db,user('manager'),r.id)).includes('approve'),'the approver still decides, exactly as before');
  assert.equal(stuckApprovals(db,user('admin')).rows.length,0,'lateness is not measured without an adopted timer');
});

test('defect 6: a confidential service never climbs by itself — it is recorded, the structure manager is told, and he moves it by name with a written reason',t=>{
  const {db,tx,user,raise,row,step,adopt,sweep,adoptDated,notes}=fixture(t);
  const r=raise('HR-SALARY-CERT');backdate(db,r.id,daysAgo(10));
  adoptDated('approval_escalation',2,20);
  assert.deepEqual(sweep().timeout,{escalated:0,blocked:1});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_step_escalations').get().n,0);
  const blocked=db.prepare("SELECT * FROM audit_events WHERE entity_id=? AND action='approval.escalation_blocked'").all(r.id);
  assert.equal(blocked.length,1);assert.equal(JSON.parse(blocked[0].after_json).authority_changed,false);
  sweep();assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id=? AND action='approval.escalation_blocked'").get(r.id).n,1,'recorded once, not every day');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='admin' AND kind='escalation_blocked'").get().n,1);
  const board=stuckApprovals(db,user('admin')),line=board.rows.find(x=>x.step_id===step(r.id).id);
  assert.ok(line&&line.guarded&&line.candidates.length>=1);
  assert.equal('title' in line||'requester_name' in line||'payload' in line,false,'metadata only: whoever manages the structure does not read requests');
  assert.equal(stuckApprovals(db,user('manager')).visible,false);
  const target=line.candidates[0].id,holder=step(r.id).approver_id;
  assert.throws(()=>tx(()=>overrideEscalation(db,user('manager'),line.step_id,{to_user_id:target,reason:'سبب مكتوب تجريبي لنقل القرار'})),code('not_permitted'));
  assert.throws(()=>tx(()=>overrideEscalation(db,user('admin'),line.step_id,{to_user_id:target,reason:'قصير'})),error=>error.status===400);
  assert.throws(()=>tx(()=>overrideEscalation(db,user('admin'),line.step_id,{to_user_id:'employee',reason:'سبب مكتوب تجريبي لنقل القرار'})),code('not_a_rung'));
  tx(()=>overrideEscalation(db,user('admin'),line.step_id,{to_user_id:target,reason:'سبب مكتوب تجريبي لنقل القرار'}));
  const moved=db.prepare('SELECT * FROM approval_step_escalations WHERE request_id=?').get(r.id);
  assert.equal(moved.basis,'admin_override');assert.equal(moved.actor_id,'admin');assert.equal(moved.from_user_id,holder);assert.equal(moved.to_user_id,target);
  assert.ok(wf.actions(db,user(target),wf.getRequest(db,user(target),r.id)).includes('approve'));
  assert.equal(wf.actions(db,user(holder),row(r.id)).includes('approve'),false);
  assert.ok(verifyAudit(db));
});

test('defect 6: an approver whose account is gone is a fact, not a threshold — his step moves without any timer, and never to a party of the request',t=>{
  const {db,user,raise,step,sweep,row}=fixture(t);
  // صاحب الطلب مدير الإدارة نفسه: خطوته عند مرجع تصعيد إدارته، والدرجة التالية هي الرئيس التنفيذي.
  const r=raise('HR-LETTER','manager');assert.equal(step(r.id).approver_id,'vp-growth');
  assert.deepEqual(escalationCandidates(db,row(r.id),step(r.id)).rungs.map(p=>p.id),['ceo'],'the current decider and the requester are skipped');
  db.prepare("UPDATE users SET active=0 WHERE id='vp-growth'").run();
  assert.equal(wf.actions(db,user('ceo'),row(r.id)).includes('approve'),false,'before the sweep nobody at all could decide this step');
  const result=sweep();
  assert.deepEqual(result.unqualified,{escalated:1,blocked:0});assert.equal(result.timeout.note,NOT_ADOPTED);
  const moved=db.prepare('SELECT * FROM approval_step_escalations WHERE request_id=?').get(r.id);
  assert.equal(moved.basis,'unqualified');assert.equal(moved.to_user_id,'ceo');assert.equal(moved.timer_row_id,null);
  assert.ok(wf.actions(db,user('ceo'),wf.getRequest(db,user('ceo'),r.id)).includes('approve'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='vp-growth' AND kind='approval_moved_away'").get().n,0,'a stopped account is not notified');
  assert.deepEqual(sweep().unqualified,{escalated:0,blocked:0});
  assert.ok(verifyAudit(db));
});

test('defect 6: the old button is named for what it does — «تذكير المعتمد» reminds the decider himself, moves nothing, and keeps its action key',t=>{
  const {db,tx,user,raise,row,step,adopt,sweep,adoptDated,notes}=fixture(t);
  const r=raise('HR-LETTER');backdate(db,r.id,daysAgo(2));
  assert.ok(wf.actions(db,user('employee'),row(r.id)).includes('escalate'),'the action key is unchanged');
  tx(()=>wf.remindApprover(db,user('employee'),r.id,{version:row(r.id).version,note:'تذكير تجريبي بخطوة متأخرة'}));
  const note=db.prepare("SELECT * FROM notifications WHERE user_id='manager' AND kind='approval_escalated'").get();
  assert.match(note.title,/^تذكير:/);assert.match(note.body,/القرار ما زال عندك ولم يُنقل/);assert.doesNotMatch(note.title+note.body,/صُعِّد|المعتمد السابق/);
  const event=JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='escalate'").get(r.id).after_json);
  assert.equal(event.authority_changed,false);assert.equal(event.kind,'reminder');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_step_escalations').get().n,0);assert.equal(step(r.id).approver_id,'manager');
  assert.throws(()=>tx(()=>wf.remindApprover(db,user('employee'),r.id,{version:row(r.id).version,note:'تذكير ثانٍ'})),code('escalation_unavailable'));
});
