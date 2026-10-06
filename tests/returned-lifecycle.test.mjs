import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, fieldModel } from '../app/service-catalog.mjs';
import { payloadForStored } from '../scripts/qa-catalog-sweep.mjs';
import { proposeTimer, adoptTimer, NOT_ADOPTED } from '../app/workflow-timers.mjs';
import { sweepReturned, departmentReturned, returnedByMe, lapseOf } from '../app/returned-requests.mjs';
import { escalationCandidates, overrideEscalation } from '../app/step-escalation.mjs';
import { obligations } from '../app/obligations.mjs';
import { homeBoard } from '../app/home.mjs';
import { workBoard } from '../app/workspace.mjs';
import { myRequests } from '../app/my-requests.mjs';
import { nextStep } from '../app/request-timeline.mjs';
import { serviceClock } from '../app/routing.mjs';
import { clockFor, holidaySet, riyadhDate } from '../app/work-calendar.mjs';
import { clearInboxCache } from '../app/inbox.mjs';
import { workBoard as workBoardView } from '../app/static/work-ui.mjs';

// العطب 4: الطلب المعاد كان يخرج من الوجود — ساعته تتوقف إلى الأبد، ولا يراه أحد غير صاحبه، ولا يذكّره أحد. كل ما هنا مصطنع.
const BASIS='قرار تجريبي مصطنع للرئاسة بتاريخ 2026-09-22 لاختبار المهل';
const DAY=86400000;
// الساعة تُجمَّد على الأربعاء 23 سبتمبر 2026، التاسعة صباحًا بتوقيت الرياض.
// كل اختبار هنا يقيس **أيام عمل** بين لحظة الإعادة ولحظة المسح، ولحظة الإعادة كانت تؤخذ من ساعة النظام
// الحقيقية بينما لحظة المسح تُحسب منها بأيام تقويمية. فيوم تشغيل الاختبار كان يقرّر النتيجة: تشغيله يوم
// خميس يجعل «بعد يومين» يقع على السبت، وبينهما صفر أيام عمل (الجمعة والسبت راحة)، فلا يُذكَّر أحد
// ويسقط assert.equal(first.owner_gone,1). عيبٌ في الاختبار لا في الشيفرة: حساب أيام العمل نفسه صحيح.
//
// والأربعاء بعينه لا الأحد: الفروق المكتوبة في الاختبارات تقويمية (start+4*DAY)، والمهل بأيام عمل.
// من الأحد يصير «بعد أربعة أيام» أربعةَ أيام عمل فيستحق التذكيران الأول (2) والثاني (4) في مسحٍ واحد،
// فينكسر «مرتان = مرة» لأنه يقيس التذكير الأول وحده. ومن الأربعاء تصير ثلاثة أيام عمل: الأول يستحق
// والثاني لا، وهو ما يقصده الاختبار. ويبقى «بعد يومين» يوم عمل في الاختبار الأخير.
const FROZEN=Date.parse('2026-09-23T06:00:00.000Z');
function fixture(t){
  t.mock.timers.enable({apis:['Date'],now:FROZEN});
  const db=openDb(':memory:');seed(db,'synthetic-returned-lifecycle');installServiceCatalog(db);t.after(()=>db.close());
  const tx=f=>transaction(db,f),user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const service=c=>wf.catalog(db,user('admin')).find(s=>s.code===c);
  const row=id=>db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  const act=(who,rid,action,note='')=>tx(()=>wf.transition(db,user(who),rid,action,{version:row(rid).version,note}));
  const returned=(code='HR-LETTER',who='employee')=>{const d=service(code);
    const r=tx(()=>wf.createRequest(db,user(who),{service_id:d.id,title:`طلب تجريبي — ${code}`,payload:payloadForStored(d.fields,fieldModel(code))}));
    act(who,r.id,'submit');act('manager',r.id,'approve');act('hr',r.id,'return','ينقصه اسم الجهة كاملًا');return r.id;};
  const adopt=(key,value)=>{const board=tx(()=>proposeTimer(db,user('admin'),{timer_key:key,value,basis:BASIS}));
    return tx(()=>adoptTimer(db,user('vp-growth'),board.timers.find(x=>x.key===key).proposed.id,{note:''}));};
  const sweep=at=>tx(()=>sweepReturned(db,'36t',user('admin'),undefined,at));
  const notes=(who,kind)=>db.prepare('SELECT * FROM notifications WHERE user_id=? AND kind=?').all(who,kind);
  return {db,tx,user,row,act,returned,adopt,sweep,notes};
}

test('defect 4: a returned request is visible in exactly three places, keeps an age in each, and needs no timer for any of it',t=>{
  const {db,user,returned,row}=fixture(t),rid=returned(),later=Date.now()+14*DAY;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workflow_timer_settings').get().n,0,'zero adopted timers');
  clearInboxCache();
  // (1) صاحب الطلب: «ما ينتظر ردّي»، معدود، وله عمر.
  const mine=obligations(db,user('employee'),{at:later}),item=mine.items.find(i=>i.id===rid&&i.bucket==='respond');
  assert.ok(item,'the requester’s «ما ينتظر ردّي»');assert.ok(item.age_days>=8,`age is kept: ${item.age_days} working days`);assert.equal(mine.counts.respond,1);
  // (2) من أعاده: يتابعه ولا يُعدّ عليه.
  const hr=obligations(db,user('hr'),{at:later}),watch=hr.returned_by_me.find(x=>x.id===rid);
  assert.ok(watch,'the returning approver’s watch list');assert.equal(watch.age_days,item.age_days);assert.match(watch.lapse_note,new RegExp(NOT_ADOPTED));
  assert.equal(hr.items.some(i=>i.id===rid),false,'watched, not counted: the ball is not with the returner');assert.deepEqual(hr.counts,{decide:0,respond:0,do:0,late:0});
  assert.ok(workBoard(db,user('hr')).returned_by_me.some(x=>x.id===rid));
  assert.match(workBoardView(workBoard(db,user('hr')),{e:String,date:String}),/أعدتُها وتنتظر صاحبها/);
  assert.ok(homeBoard(db,user('hr')).returned_by_me.some(x=>x.id===rid));
  // (3) عمل الإدارة المنفذة المفتوح، عند مديرها وحده، بلا حمولة.
  const department=departmentReturned(db,user('head-hr'),later),line=department.find(x=>x.id===rid);
  assert.ok(line,'the handling department’s head');assert.equal(line.age_days,item.age_days);assert.equal(line.returned_by_name,'معتمدة خدمات الموظف');
  assert.equal('payload' in line,false);assert.ok(homeBoard(db,user('head-hr')).manager.department_returned.some(x=>x.id===rid));
  // ولا موضع رابع: من ليس طرفًا لا يراه في أي سطح.
  for(const id of ['outsider','it','head-it','head-finance','vp-growth','ceo']){
    const other=obligations(db,user(id),{at:later});
    assert.equal(other.items.some(i=>i.id===rid)||other.returned_by_me.some(x=>x.id===rid),false,`${id}: not an obligation, not a watch`);
    assert.deepEqual(departmentReturned(db,user(id),later),[],`${id}: not a department view`);
    assert.equal(wf.listRequests(db,user(id),'','').some(r=>r.id===rid),false,`${id}: not in the requests list`);
  }
  assert.equal(departmentReturned(db,user('hr'),later).length,0,'a department member who is not its head has no department view');
  // الساعة متوقفة على الإدارة، والعمر معروف: paused_since وpaused_days إضافتان لا تغيّران حقلًا قائمًا.
  const clock=clockFor(db,row(rid),{days:3,hours:0},holidaySet(db,'36t'),riyadhDate(later));
  assert.equal(clock.paused,true);assert.equal(clock.due_on,null);assert.equal(clock.overdue,false);assert.equal(clock.paused_days,item.age_days);assert.ok(clock.paused_since);
  assert.equal(clockFor(db,row(rid),0,holidaySet(db,'36t'),riyadhDate(later)).paused_days,item.age_days,'a service with no target still ages while returned');
  assert.equal(serviceClock(db,row(rid)).paused_days,0,'returned today');
  assert.match(nextStep(db,user('employee'),row(rid)).lapse_note,new RegExp(NOT_ADOPTED));
});

test('defect 4: with no adopted timer nobody is reminded and nothing lapses — and the sweep says so',t=>{
  const {db,returned,row,sweep}=fixture(t),rid=returned();
  const result=sweep(Date.now()+200*DAY);
  assert.deepEqual({...result,note:undefined},{reminded_first:0,reminded_second:0,lapsed:0,owner_gone:0,note:undefined});assert.match(result.note,new RegExp(NOT_ADOPTED));
  assert.equal(row(rid).status,'returned');assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind LIKE 'returned_%' OR kind LIKE 'request_lapsed%'").get().n,0);
});

test('defect 4: adopted timers remind the owner once per stage, tell the returner, and lapse honestly — never on the day of the first reminder',t=>{
  const {db,user,returned,row,adopt,sweep,notes}=fixture(t),rid=returned(),start=Date.now();
  adopt('returned_reminder_first',2);adopt('returned_reminder_second',4);
  assert.deepEqual(sweep(start),{reminded_first:0,reminded_second:0,lapsed:0,owner_gone:0,lapse_note:`انقضاء الطلب المعاد ${NOT_ADOPTED}؛ الطلبات المعادة تبقى مفتوحة`},'returned today: nothing yet');
  const first=sweep(start+4*DAY);
  assert.equal(first.reminded_first,1);assert.equal(notes('employee','returned_reminder').length,1);
  assert.match(notes('employee','returned_reminder')[0].body,/ساعته متوقفة/);
  assert.equal(sweep(start+4*DAY).reminded_first,0,'twice = once');assert.equal(notes('employee','returned_reminder').length,1);
  const second=sweep(start+8*DAY);
  assert.equal(second.reminded_second,1);assert.equal(notes('employee','returned_reminder').length,2);assert.equal(notes('hr','returned_still_waiting').length,1,'the returner is told at the second reminder');
  assert.equal(sweep(start+60*DAY).lapsed,0,'no expiry timer: it stays open however long');assert.equal(row(rid).status,'returned');
  // مهلة الانقضاء تُتبنى الآن والطلب قديم: طلب ثانٍ لم يُذكَّر صاحبه لا ينقضي يوم تذكيره الأول.
  adopt('returned_expiry',6);
  const fresh=returned('HR-LETTER','outsider'),at=start+90*DAY;
  const run=sweep(at);
  assert.equal(run.lapsed,1,'the first request was reminded long ago and is past the limit');assert.equal(run.reminded_first,1,'the second is only reminded today');
  assert.equal(row(fresh).status,'returned','never lapsed on the day of its first reminder');
  assert.equal(sweep(at).lapsed,0,'twice = once');
  assert.equal(sweep(at+4*DAY).lapsed,1,'and lapses on a later working day');
  // الانقضاء الصادق: حالة مغلقة، وصف يقول لماذا، وإشعاران، وسطر تدقيق يحمل صف المهلة.
  const lapse=lapseOf(db,rid);assert.equal(row(rid).status,'cancelled');assert.ok(lapse.waited_days>=6);assert.equal(lapse.returned_by,'hr');
  assert.equal(db.prepare('SELECT timer_key,status FROM workflow_timer_settings WHERE id=?').get(lapse.timer_row_id).timer_key,'returned_expiry');
  assert.equal(notes('employee','request_lapsed').length,1);assert.match(notes('employee','request_lapsed')[0].body,/ذُكِّرت به/);assert.equal(notes('hr','request_lapsed_returner').filter(n=>n.request_id===rid).length,1);
  const event=JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE entity_id=? AND action='request.lapsed'").get(rid).after_json);
  assert.equal(event.timer_row_id,lapse.timer_row_id);assert.equal(event.by,'workflow-sweep');
  clearInboxCache();
  assert.match(myRequests(db,user('employee')).items.find(i=>i.id===rid).module_status,/انقضى لعدم الرد/);
  assert.equal(nextStep(db,user('employee'),row(rid)).awaiting,'انقضى لعدم الرد');
  assert.equal(obligations(db,user('employee')).items.some(i=>i.id===rid),false);assert.equal(returnedByMe(db,user('hr')).some(x=>x.id===rid),false);
  assert.ok(verifyAudit(db));
});

// ── ما أضافته المراجعة المستقلة ───────────────────────────────────────────────
test('review: after a decision is escalated away, the original approver is not shown «أعدتُها وتنتظر صاحبها»',t=>{
  const {db,tx,user,row,act}=fixture(t);
  const d=wf.catalog(db,user('admin')).find(s=>s.code==='HR-LETTER');
  const r=tx(()=>wf.createRequest(db,user('employee'),{service_id:d.id,title:'طلب تجريبي — HR-LETTER',payload:payloadForStored(d.fields,fieldModel('HR-LETTER'))}));
  act('employee',r.id,'submit');
  const step=db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND status='pending' ORDER BY position LIMIT 1").get(r.id);
  assert.equal(step.approver_id,'manager');
  const target=escalationCandidates(db,row(r.id),step).rungs[0].id;
  tx(()=>overrideEscalation(db,user('admin'),step.id,{to_user_id:target,reason:'نقل تجريبي مكتوب لقرار الخطوة'}));
  act(target,r.id,'return','ينقصه اسم الجهة كاملًا');
  const after=db.prepare('SELECT approver_id,decided_by,status FROM approval_steps WHERE id=?').get(step.id);
  assert.equal(after.approver_id,'manager','the step keeps its approver: escalation never edits it');
  assert.equal(after.decided_by,target);
  assert.equal(returnedByMe(db,user('manager')).some(x=>x.id===r.id),false,'he did not return it and no longer held the decision');
  assert.ok(returnedByMe(db,user(target)).some(x=>x.id===r.id),'whoever held the decision and returned it follows it');
});

test('review: a returned request that lapses while its owner is stopped still reaches a living person',t=>{
  const {db,user,returned,row,adopt,sweep,notes}=fixture(t),rid=returned(),start=Date.now();
  db.prepare("UPDATE users SET active=0 WHERE id='employee'").run();
  adopt('returned_reminder_first',1);adopt('returned_expiry',3);
  // ثمانية أيام تقويمية تضمن مرور خمسة أيام عمل مهما كان يوم بدء الاختبار.
  const first=sweep(start+8*DAY);
  assert.equal(first.owner_gone,1);
  assert.equal(notes('manager','returned_owner_gone').length,1,'his manager was told the request was waiting on an account that cannot reply');
  const lapse=sweep(start+16*DAY);
  assert.equal(lapse.lapsed,1);assert.equal(row(rid).status,'cancelled');
  assert.equal(lapse.owner_gone,1,'and he is told it closed, instead of the notice being dropped');
  assert.equal(notes('manager','request_lapsed_owner_gone').length,1);
  assert.match(notes('manager','request_lapsed_owner_gone')[0].body,/انقضى|أُغلق/);
  assert.equal(notes('hr','request_lapsed_returner').length,1,'the returner is told as before');
  assert.ok(verifyAudit(db));
});
