import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, fieldModel, approvalSettings } from '../app/service-catalog.mjs';
import { payloadForStored } from '../scripts/qa-catalog-sweep.mjs';
import { runDue, clearHandlers } from '../app/jobs.mjs';
import { proposeTimer, adoptTimer, retireTimer, timersBoard, TIMER_KEYS, NOT_ADOPTED } from '../app/workflow-timers.mjs';
import { registerSweepHandlers, scheduleSweep, runWorkflowSweep, lastSweep, workflowControl, SWEEP_JOB } from '../app/workflow-sweep.mjs';
import { obligations } from '../app/obligations.mjs';
import { clearInboxCache } from '../app/inbox.mjs';
import { approvalSettingsUI } from '../app/static/approval-settings-ui.mjs';
import { backdate } from './escalation-equivalence.scenario.mjs';

// العطب 9: لا شيء في المنصة كان يتصرف بناءً على التأخر. التشغيل اليومي: بمهل متبناة وحدها، ومرتان = مرة، ومدقَّق، ويقول لماذا لم يفعل. كل ما هنا مصطنع.
const code=value=>error=>error.code===value;
const BASIS='قرار تجريبي مصطنع للرئاسة بتاريخ 2026-09-22 لاختبار المهل';
const DAY=86400000,NINE_AM=Date.parse('2026-09-22T06:00:00.000Z'); // 09:00 بتوقيت الرياض
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-workflow-sweep');installServiceCatalog(db);clearHandlers();registerSweepHandlers();
  t.after(()=>{clearHandlers();db.close();});
  const tx=f=>transaction(db,f),user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const row=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const act=(who,rid,action,note='')=>tx(()=>wf.transition(db,user(who),rid,action,{version:row(rid).version,note}));
  const raise=(c,who='employee')=>{const d=wf.catalog(db,user('admin')).find(s=>s.code===c);
    const r=tx(()=>wf.createRequest(db,user(who),{service_id:d.id,title:`طلب تجريبي — ${c}`,payload:payloadForStored(d.fields,fieldModel(c))}));act(who,r.id,'submit');return r.id;};
  const adopt=(key,value)=>{const board=tx(()=>proposeTimer(db,user('admin'),{timer_key:key,value,basis:BASIS}));
    return tx(()=>adoptTimer(db,user('vp-growth'),board.timers.find(x=>x.key===key).proposed.id,{note:''}));};

  // تبنٍّ مؤرَّخ قبل الحدث: الساعة تبدأ من الحدث أو من التبني أيهما لاحق (تصحيحات اللائحة، الجولة الثانية)،
  // فتبنٍّ اليوم لا يُصعّد خطوة تأخرت أمس. المُطلِق يسمح بكتابة adopted_at في انتقال «مقترح ← متبنى» نفسه.
  const adoptDated=(key,value,days)=>{const board=tx(()=>proposeTimer(db,user('admin'),{timer_key:key,value,basis:BASIS}));
    const id=board.timers.find(x=>x.key===key).proposed.id;
    db.prepare("UPDATE workflow_timer_settings SET status='adopted',adopted_by='vp-growth',adopted_at=? WHERE id=?").run(new Date(Date.now()-days*DAY).toISOString(),id);};  const counts=()=>({escalations:db.prepare('SELECT COUNT(*) AS n FROM approval_step_escalations').get().n,lapses:db.prepare('SELECT COUNT(*) AS n FROM request_lapses').get().n,
    events:db.prepare('SELECT COUNT(*) AS n FROM request_assignment_events').get().n,notices:db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n,
    reminders:db.prepare('SELECT COUNT(*) AS n FROM reminder_log').get().n,audit:db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='request'").get().n});
  return {db,tx,user,row,act,raise,adopt,adoptDated,counts};
}

test('defect 9: with no adopted timer the daily sweep is a no-op that says so — old pending and returned requests are untouched',t=>{
  const {db,tx,user,raise,act,row,counts}=fixture(t);
  const pending=raise('HR-LETTER');backdate(db,pending,new Date(Date.now()-40*DAY).toISOString());
  const returned=raise('HR-LETTER','outsider');act('manager',returned,'return','ينقصه اسم الجهة كاملًا');
  const before=counts();
  const result=tx(()=>runWorkflowSweep(db,'36t','2026-11-30',user('admin'),Date.now()+60*DAY));
  assert.deepEqual(result.adopted,{});assert.match(result.note,/لا مهلة متبناة؛ لم يُفعل شيء/);
  assert.deepEqual(result.acted,{employee_changes_applied:0,departed_work_returned:0,steps_moved_timeout:0,steps_moved_unqualified:0,steps_blocked:0,returned_reminded:0,returned_lapsed:0});
  assert.deepEqual(result.not_adopted.map(x=>x.key).sort(),Object.entries(TIMER_KEYS).filter(([,s])=>s.wired).map(([k])=>k).sort());
  assert.ok(result.not_adopted.every(x=>x.state===NOT_ADOPTED));
  assert.deepEqual(counts(),before,'nothing was written');assert.equal(row(pending).status,'pending');assert.equal(row(returned).status,'returned');
});

test('defect 9: the sweep is one job per tenant per day after 08:00 Riyadh, acts only on adopted timers, is audited, and twice is once',t=>{
  const {db,tx,user,raise,act,row,adopt,adoptDated,counts}=fixture(t);
  const late=raise('HR-LETTER');backdate(db,late,new Date(NINE_AM-10*DAY).toISOString());
  adoptDated('approval_escalation',2,30);
  assert.deepEqual(scheduleSweep(db,{now:NINE_AM-2*3600000}),[],'before 08:00 Riyadh nothing is queued');
  const queued=scheduleSweep(db,{now:NINE_AM});
  assert.equal(queued.filter(q=>q.tenant_id==='36t').length,1);assert.equal(scheduleSweep(db,{now:NINE_AM+60000}).find(q=>q.tenant_id==='36t').duplicate,true,'one job per day');
  // المعالج يقيس بساعة الحائط الحقيقية للعمر (stepArrivedAt مقابل الآن)، والطلب مؤرَّخ قبل عشرة أيام من الآن الحقيقي أيضًا.
  backdate(db,late,new Date(Date.now()-10*DAY).toISOString());
  const ran=runDue(db,{worker:'test-sweep',now:Math.max(Date.now(),NINE_AM)+1000}).filter(x=>x.type===SWEEP_JOB);
  assert.deepEqual(ran.map(x=>x.outcome),['done']);
  const last=lastSweep(db,'36t');
  assert.equal(last.status,'done');assert.equal(last.result.acted.steps_moved_timeout,1);assert.equal(last.result.adopted.approval_escalation.value,2);assert.ok(last.result.adopted.approval_escalation.timer_row_id);
  assert.equal(last.result.failures,undefined);
  const moved=db.prepare('SELECT * FROM approval_step_escalations WHERE request_id=?').get(late);assert.equal(moved.to_user_id,'vp-growth');
  const event=db.prepare("SELECT * FROM audit_events WHERE entity_id=? AND action='approval.escalated'").get(late);
  assert.equal(event.actor_id,'admin','audited under the job owner, because the chain needs an actor');assert.equal(JSON.parse(event.after_json).by,'workflow-sweep','and marked as the machine');
  // مرتان = مرة: تشغيل ثانٍ في اليوم نفسه (ولو بمفتاح آخر) لا يكتب شيئًا.
  const before=counts();
  const again=tx(()=>runWorkflowSweep(db,'36t','2026-09-22',user('admin')));
  assert.equal(again.acted.steps_moved_timeout,0);assert.deepEqual(counts(),before);
  assert.match(workflowControl(db,user('admin')).sweep_note,/آخر تشغيل يومي/);
  assert.ok(verifyAudit(db));
});

test('timers: nothing is seeded, a number is proposed with its basis and adopted by a second person, and the screen says plainly what stays manual',t=>{
  const {db,tx,user}=fixture(t);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workflow_timer_settings').get().n,0,'no invented value');
  const empty=timersBoard(db,user('admin'));
  assert.equal(empty.none_adopted,true);assert.match(empty.headline,/لا مهلة معتمدة/);
  assert.ok(empty.timers.filter(x=>x.wired).every(x=>x.state==='none'&&x.effect.startsWith(NOT_ADOPTED)&&x.manual.length>10));
  // ما لا قارئ له لا يُقترح: تبنّي مهلة لا يقرؤها شيء ادعاء بأتمتة غير موجودة.
  const unwired=Object.entries(TIMER_KEYS).find(([,s])=>!s.wired)[0];
  assert.throws(()=>tx(()=>proposeTimer(db,user('admin'),{timer_key:unwired,value:2,basis:BASIS})),code('timer_not_wired'));
  assert.throws(()=>tx(()=>proposeTimer(db,user('manager'),{timer_key:'approval_escalation',value:2,basis:BASIS})),code('not_permitted'));
  assert.throws(()=>tx(()=>proposeTimer(db,user('admin'),{timer_key:'approval_escalation',value:2,basis:'قصير'})),error=>error.status===400);
  const proposed=tx(()=>proposeTimer(db,user('admin'),{timer_key:'approval_escalation',value:3,basis:BASIS})).timers.find(x=>x.key==='approval_escalation');
  assert.equal(proposed.state,'proposed');assert.deepEqual(timersBoard(db,user('admin')).adopted,{},'a proposal does nothing');
  assert.throws(()=>tx(()=>adoptTimer(db,user('admin'),proposed.proposed.id,{note:''})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>adoptTimer(db,user('manager'),proposed.proposed.id,{note:''})),code('not_permitted'));
  // المقترح المفتوح يصل «أقرّر» عند من يملك تبنّيه، لا عند من اقترحه.
  clearInboxCache();
  assert.ok(obligations(db,user('vp-growth'),{watching:false}).items.some(i=>i.id===proposed.proposed.id&&i.bucket==='decide'&&i.action_keys.includes('adopt_timer')));
  assert.equal(obligations(db,user('admin'),{watching:false}).items.some(i=>i.id===proposed.proposed.id),false);
  const adopted=tx(()=>adoptTimer(db,user('vp-growth'),proposed.proposed.id,{note:'تبنٍّ تجريبي'}));
  assert.deepEqual(adopted.adopted,{approval_escalation:3});assert.equal(adopted.none_adopted,false);
  assert.throws(()=>tx(()=>proposeTimer(db,user('admin'),{timer_key:'returned_expiry',value:9,basis:BASIS}))&&tx(()=>adoptTimer(db,user('vp-growth'),timersBoard(db,user('admin')).timers.find(x=>x.key==='returned_expiry').proposed.id,{note:''})),code('reminder_required'),'no lapse without a reminder first');
  const live=timersBoard(db,user('vp-growth')).timers.find(x=>x.key==='approval_escalation');
  tx(()=>retireTimer(db,user('vp-growth'),live.adopted.id,{reason:'إيقاف تجريبي للمهلة بعد الاختبار'}));
  assert.deepEqual(timersBoard(db,user('admin')).adopted,{},'retired: the automation falls silent again');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workflow_timer_settings').get().n,2,'and every row is kept');
  // الشاشة: قسم داخل «إعداد الاعتماد» يقول الحقيقة بالكلمات.
  const html=approvalSettingsUI.render({...approvalSettings(db,user('admin')),workflow:workflowControl(db,user('admin'))},{e:String,button:(a,id,label)=>`[${a}:${label}]`});
  assert.match(html,/مهل محرك العمل/);assert.match(html,/لا مهلة معتمدة/);assert.match(html,/يبقى يدويًا/);assert.match(html,/\[propose_timer:اقتراح رقم\]/);
  assert.ok(verifyAudit(db));
});
