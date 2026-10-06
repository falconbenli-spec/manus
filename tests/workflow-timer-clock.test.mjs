import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, fieldModel, approvalSettings } from '../app/service-catalog.mjs';
import { workflowControl } from '../app/workflow-sweep.mjs';
import { payloadForStored } from '../scripts/qa-catalog-sweep.mjs';
import { proposeTimer, adoptTimer, timersBoard, clockStart, CLOCK_RULE } from '../app/workflow-timers.mjs';
import { sweepReturned, returnedByMe } from '../app/returned-requests.mjs';
import { sweepApprovals, stuckApprovals } from '../app/step-escalation.mjs';
import { approvalSettingsUI } from '../app/static/approval-settings-ui.mjs';
import { backdate } from './escalation-equivalence.scenario.mjs';
import { workingDaysBetween, riyadhDate, holidaySet } from '../app/work-calendar.mjs';

// الوعد للمالك (22 سبتمبر 2026): تبني مهلة لا يعمل بأثر رجعي على الطلبات القائمة. طلب أُعيد قبل ستين يومًا كان يُذكَّر في أول تشغيل ويُسقط
// في الثاني؛ صار عدّه يبدأ من لحظة التبني. المهل الأربع مقترحة لا متبناة على القاعدة الحية، فهذا يسبق أي تبنٍّ. كل ما هنا مصطنع.
const code=value=>error=>error.code===value;
const BASIS='قرار تجريبي مصطنع للرئاسة بتاريخ 2026-09-22 لاختبار بداية الساعة';
const DAY=86400000;
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-timer-clock');installServiceCatalog(db);t.after(()=>db.close());
  const tx=f=>transaction(db,f),user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id),row=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const act=(who,rid,action,note='')=>tx(()=>wf.transition(db,user(who),rid,action,{version:row(rid).version,note}));
  const raise=(c,who='employee')=>{const d=wf.catalog(db,user('admin')).find(s=>s.code===c);
    const r=tx(()=>wf.createRequest(db,user(who),{service_id:d.id,title:`طلب تجريبي — ${c}`,payload:payloadForStored(d.fields,fieldModel(c))}));act(who,r.id,'submit');return r.id;};
  const adopt=(key,value)=>{const board=tx(()=>proposeTimer(db,user('admin'),{timer_key:key,value,basis:BASIS}));
    return tx(()=>adoptTimer(db,user('vp-growth'),board.timers.find(x=>x.key===key).proposed.id,{note:''}));};
  // إعادة مؤرخة: لحظة قرار الإعادة تُرجَع إلى الماضي كما تُرجَع لحظة التقديم في backdate (القادح يُرفع للتأريخ ثم يُعاد كما هو).
  const returnedAgo=(days,who='outsider')=>{const rid=raise('HR-LETTER',who);act('manager',rid,'return','ينقصه اسم الجهة كاملًا');
    const at=new Date(Date.now()-days*DAY).toISOString();backdate(db,rid,at);
    const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='decision_immutable'").get().sql;
    db.exec('DROP TRIGGER decision_immutable');db.prepare("UPDATE approval_steps SET decided_at=? WHERE request_id=? AND status='returned'").run(at,rid);db.exec(trigger);return rid;};
  const sweep=at=>tx(()=>sweepReturned(db,'36t',user('admin'),undefined,at));
  // أول لحظة يكون فيها عدد أيام العمل منذ «من» n على الأقل، بغض النظر عن يوم الأسبوع الذي يجري فيه الاختبار.
  const after=(from,n)=>{const holidays=holidaySet(db,'36t');let at=from;while(workingDaysBetween(riyadhDate(from),riyadhDate(at),holidays)<n)at+=DAY;return at;};
  const notes=(who,kind)=>db.prepare('SELECT * FROM notifications WHERE user_id=? AND kind=? ORDER BY created_at').all(who,kind);
  return {db,tx,user,row,act,raise,adopt,returnedAgo,sweep,notes,after};
}

test('the clock starts at adoption: a request returned sixty days ago is neither reminded nor lapsed on the first sweeps after the timers are adopted — it is counted from adoption, and the audit says so',t=>{
  const {db,user,row,adopt,returnedAgo,sweep,notes,after}=fixture(t);
  const old=returnedAgo(60),start=Date.now();
  assert.equal(clockStart('2026-01-01T00:00:00.000Z',{adopted_at:'2026-03-01T00:00:00.000Z'}),'2026-03-01T00:00:00.000Z');
  assert.equal(clockStart('2026-05-01T00:00:00.000Z',{adopted_at:'2026-03-01T00:00:00.000Z'}),'2026-05-01T00:00:00.000Z');
  assert.equal(clockStart('2026-05-01T00:00:00.000Z',null),'2026-05-01T00:00:00.000Z');
  adopt('returned_reminder_first',2);adopt('returned_reminder_second',4);adopt('returned_expiry',6);
  // كان: تذكير في أول تشغيل وإسقاط في الثاني. صار: لا شيء يوم التبني ولا قبل يومي عمل منه.
  assert.deepEqual([sweep(start).reminded_first,sweep(after(start,1)).reminded_first,sweep(after(start,1)).lapsed],[0,0,0]);
  assert.equal(row(old).status,'returned');assert.equal(notes('outsider','returned_reminder').length,0);
  // بعد يومي عمل من التبني: التذكير الأول، والعمر الحقيقي في الأثر مع لحظة بداية العدّ.
  const first=sweep(after(start,2));
  assert.equal(first.reminded_first,1);
  const reminded=JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='request.returned_reminded'").get(old).after_json);
  assert.ok(reminded.waited_days>=40,'the real age since the return is still recorded');assert.ok(reminded.counted_days<reminded.waited_days);assert.ok(reminded.clock_started_at,'and the moment the clock started');
  assert.equal(sweep(after(start,4)).reminded_second,1);
  assert.equal(sweep(after(start,5)).lapsed,0,'six working days from adoption have not passed');
  const lapse=sweep(after(start,6));
  assert.equal(lapse.lapsed,1);assert.equal(row(old).status,'cancelled');
  const lapsed=JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='request.lapsed'").get(old).after_json);
  assert.ok(lapsed.clock_started_at&&lapsed.counted_days>=6&&lapsed.waited_days>lapsed.counted_days);
  // طلب يُعاد بعد التبني يُعدّ من إعادته كما كان.
  const fresh=returnedAgo(0);
  assert.equal(sweep(after(start,8)).reminded_first,1);
  const freshAudit=JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='request.returned_reminded'").get(fresh).after_json);
  assert.equal(freshAudit.clock_started_at,undefined);
  assert.ok(verifyAudit(db));
});

test('the clock starts at adoption for step escalation too, and the timers screen says so before anyone adopts a number',t=>{
  const {db,tx,user,raise,adopt,after}=fixture(t);
  const late=raise('HR-LETTER');backdate(db,late,new Date(Date.now()-10*DAY).toISOString());
  adopt('approval_escalation',2);
  // كان: تُنقل الخطوة في أول تشغيل بعد التبني. صار: لا نقل يوم التبني.
  assert.deepEqual(tx(()=>sweepApprovals(db,'36t',user('admin'))).timeout,{escalated:0,blocked:0});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_step_escalations').get().n,0);
  assert.equal(stuckApprovals(db,user('admin')).rows.length,0,'not shown as late either');
  // بعد يومي عمل من التبني تُنقل، والسبب يذكر العمر الحقيقي والمعدود.
  const real=Date.now(),then=after(real,2);t.mock.method(Date,'now',()=>then);
  assert.deepEqual(tx(()=>sweepApprovals(db,'36t',user('admin'))).timeout,{escalated:1,blocked:0});
  t.mock.restoreAll();
  const moved=db.prepare('SELECT reason FROM approval_step_escalations WHERE request_id=?').get(late);
  assert.match(moved.reason,/المعدود من تبني المهلة/);
  // الشاشة تقول القاعدة قبل التبني ومعه.
  const board=timersBoard(db,user('admin'));
  assert.equal(board.clock_rule,CLOCK_RULE);assert.match(board.note,/أيهما لاحق/);
  const adopted=board.timers.find(x=>x.key==='approval_escalation').adopted;
  assert.ok(adopted.clock_from);assert.match(board.timers.find(x=>x.key==='approval_escalation').effect,/الساعة تُعدّ من/);
  const html=approvalSettingsUI.render({...approvalSettings(db,user('admin')),workflow:workflowControl(db,user('admin'))},{e:String,button:()=>''});
  assert.ok(String(html).includes(CLOCK_RULE));
  assert.ok(verifyAudit(db));
});

test('returned-by-me shows the counted days from adoption, never a retroactive «مضى ستون»',t=>{
  const {db,user,adopt,returnedAgo}=fixture(t);
  const old=returnedAgo(60);
  adopt('returned_reminder_first',2);adopt('returned_expiry',6);
  const mine=returnedByMe(db,user('manager')).find(x=>x.id===old);
  assert.ok(mine.age_days>=40,'the age itself is honest');
  assert.match(mine.lapse_note,/المعدود 0/);assert.match(mine.lapse_note,/من تبني المهلة/);
});
