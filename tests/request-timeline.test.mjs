import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import { timeline, myTimelineBoard, dwellStages } from '../app/request-timeline.mjs';
import { transferRequest } from '../app/routing.mjs';
import { setServiceSection, setServiceTarget, escalateApproval } from '../app/workflow.mjs';
import { holidaySet } from '../app/work-calendar.mjs';
import { fixture, code } from './request-transparency-fixture.mjs';

const INTERNAL='تجريبي: مداولة داخلية لا تُكتب لصاحب الطلب';
const later=days=>new Date(Date.now()+days*86400000).toISOString();

test('timeline: one ordered story of who did what and when, read from the sealed audit log',t=>{
  const f=fixture(t,'timeline-story'),id=f.closed();
  const view=timeline(f.db,f.users.it,id);
  assert.deepEqual(view.events.map(e=>e.action).filter(a=>a!=='request.closed'),['created','submit','approve','claim','complete']);
  assert.deepEqual(view.events.map(e=>e.seq),[...view.events.map(e=>e.seq)].sort((a,b)=>a-b),'events keep audit order');
  for(const event of view.events){assert.ok(event.actor_name);assert.ok(event.text);assert.match(event.on,/^\d{4}-\d{2}-\d{2}$/);}
  assert.equal(view.events.find(e=>e.action==='approve').actor_name,f.users.manager.name);
  assert.match(view.events.find(e=>e.action==='request.closed').detail,/ما سُلِّم/);
  assert.equal(view.rounds.delivered_first_time,true);
  assert.ok(verifyAudit(f.db));
});

test('timeline isolation: the requester sees a decision and the reason addressed to them, never the internal deliberation between handlers',t=>{
  const f=fixture(t,'timeline-isolation');
  // سبب الإرجاع مكتوب لصاحب الطلب فيراه.
  const returned=f.submitted('IT-SUPPORT');f.act('manager',returned,'return','تجريبي: وضّحي رقم الجهاز المتأثر');
  const mineReturned=timeline(f.db,f.users.employee,returned);
  assert.equal(mineReturned.events.find(e=>e.action==='return').reason,'تجريبي: وضّحي رقم الجهاز المتأثر');

  // ملاحظة الاعتماد وسبب التحويل ومداولات المهام ليست له.
  // CREATIVE-BRIEF: المدير معتمد ومنفذ معًا، فيبقى الطلب ظاهرًا له بعد تحويله.
  const id=f.submitted('CREATIVE-BRIEF');f.act('manager',id,'approve',INTERNAL);
  f.db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) SELECT 'manager-hr','36t','hr','manager-hr','مدير تجريبي في إدارة أخرى',password_hash,'manager' FROM users WHERE id='manager'").run();
  f.tx(()=>transferRequest(f.db,f.users.manager,id,{version:f.version(id),department_id:'hr',reason:INTERNAL}));
  const mine=timeline(f.db,f.users.employee,id),inside=timeline(f.db,f.users.manager,id);
  assert.equal(JSON.stringify(mine).includes(INTERNAL),false,'no internal note leaks to the requester anywhere in the payload');
  assert.ok(JSON.stringify(inside).includes(INTERNAL),'a handler still reads the internal note');
  const approval=mine.events.find(e=>e.action==='approve'),transfer=mine.events.find(e=>e.action==='request.transferred');
  assert.ok(approval,'the decision itself is visible');assert.equal(approval.reason,'');assert.equal(approval.reason_withheld,true);
  assert.match(transfer.detail,/إلى/,'the requester learns where the request went');assert.equal(transfer.reason,'');
  assert.equal(mine.viewer.requester,true);assert.equal(inside.viewer.sees_internal,true);
  assert.throws(()=>timeline(f.db,f.users.outsider,id),code('not_found'),'a colleague with no part in the request sees nothing');
  assert.throws(()=>timeline(f.db,f.users.external,id),code('not_found'),'another tenant sees nothing');
});

test('timeline honesty: a request waiting on its requester gets no expected date, and the wait is not charged to the department',t=>{
  const f=fixture(t,'timeline-honesty');
  f.tx(()=>{setServiceSection(f.db,f.users.admin,'IT-SUPPORT','الدعم التقني');setServiceTarget(f.db,f.users.admin,'IT-SUPPORT',3);});
  const id=f.submitted('IT-SUPPORT');
  const pending=timeline(f.db,f.users.employee,id).next_step;
  assert.match(pending.with,/المدير المباشر/);assert.ok(pending.with.includes(f.users.manager.name),'the requester is told who holds the request');
  assert.match(pending.awaiting,/قرار اعتماد/);assert.match(pending.expected_on,/^\d{4}-\d{2}-\d{2}$/);assert.equal(pending.paused,false);
  assert.ok(pending.you_can.length,'the requester is told what to do if it stalls');

  f.act('manager',id,'return','تجريبي: أكملي وصف المشكلة');
  const waiting=timeline(f.db,f.users.employee,id).next_step;
  assert.equal(waiting.with,'صاحب الطلب');assert.equal(waiting.expected_on,null);assert.equal(waiting.paused,true);
  assert.match(waiting.expectation_note,/الساعة متوقفة/);
  const r=f.db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const stages=dwellStages(f.db,r,holidaySet(f.db,'36t'),later(14));
  const own=stages.find(s=>s.kind==='requester');
  assert.ok(own.open&&own.paused&&own.working_days>=9,'two weeks at the requester are shown as the requester’s time');
  assert.equal(stages.filter(s=>s.kind==='approval').every(s=>!s.open),true,'and no approval stage keeps running meanwhile');

  // خدمة بلا زمن مستهدف: لا تاريخ، ويُقال لماذا.
  const untimed=f.submitted('HR-LETTER'),step=timeline(f.db,f.users.employee,untimed).next_step;
  assert.equal(step.expected_on,null);assert.match(step.expectation_note,/لا زمن مستهدف/);
});

test('timeline dwell: time is attributed to the party holding the request, so the real bottleneck shows',t=>{
  const f=fixture(t,'timeline-dwell'),id=f.submitted('HR-LETTER');
  f.act('manager',id,'approve');
  const r=f.db.prepare('SELECT * FROM requests WHERE id=?').get(id),stages=dwellStages(f.db,r,holidaySet(f.db,'36t'),later(21));
  assert.deepEqual(stages.map(s=>[s.party,s.open]),[['المدير المباشر لصاحب الطلب',false],['الموارد البشرية',true]]);
  assert.ok(stages[1].working_days>=14&&stages[0].working_days===0,'three weeks sit at the second step, not the first');
  f.act('hr',id,'approve');f.act('hr',id,'claim');
  const view=timeline(f.db,f.users.employee,id);
  assert.deepEqual(view.stages.map(s=>s.kind),['approval','approval','execution','execution']);
  assert.match(view.stages.at(-1).party,/تنفيذ/);assert.equal(view.stages.at(-1).open,true);
  assert.ok(view.dwell_by_party.some(p=>p.party==='الموارد البشرية'&&p.segments===1));
});

test('my-request-timeline board: one line per own request, with the follow-up offered only when the platform really allows it',t=>{
  const f=fixture(t,'timeline-board'),id=f.submitted('IT-SUPPORT');f.draft('HR-LETTER');
  f.submitted('IT-SUPPORT','outsider');
  const board=myTimelineBoard(f.db,f.users.employee);
  assert.equal(board.rows.length,2,'only my requests');assert.equal(board.open,2);assert.equal(board.waiting_on_me,1,'the draft waits on me');
  assert.match(board.rows.find(r=>r.id===id).you_can[0],/بعد مضي يوم/);
  t.mock.timers.enable({apis:['Date'],now:Date.now()+2*86400000});
  const row=myTimelineBoard(f.db,f.users.employee).rows.find(r=>r.id===id);
  assert.match(row.you_can[0],/إرسال متابعة/);
  // المتابعة نفسها مداولة موجهة للمعتمد: يراها كاتبها، ولا تتغير بها صلاحية أحد.
  f.tx(()=>escalateApproval(f.db,f.users.employee,id,{version:f.version(id),note:'تجريبي: متابعة بعد يومين'}));
  assert.ok(timeline(f.db,f.users.employee,id).events.some(e=>e.action==='escalate'),'the author sees their own follow-up');
  t.mock.timers.reset();
  assert.ok(verifyAudit(f.db));
});
