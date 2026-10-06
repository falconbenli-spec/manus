import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { isWorkingDay, workingDaysBetween, addWorkingDays, holidaySet, clockFor, computeClock, pausedIntervals } from '../app/work-calendar.mjs';

const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
function setup(t){const db=openDb(':memory:');seed(db,'synthetic-work-calendar');installServiceCatalog(db);t.after(()=>db.close());return db;}
const holiday=(db,date)=>db.prepare("INSERT INTO public_holidays VALUES(?,?,?,?,?,'approved','hr','admin',?,'',?)").run(`h-${date}`,'36t',date,'عطلة مصطنعة','عطلة مصطنعة لاختبار تقويم العمل','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');

test('work calendar: Sunday to Thursday are working days, Friday, Saturday and approved holidays are not',t=>{
  const db=setup(t);
  // 2026-03-01 is a Sunday.
  holiday(db,'2026-03-03');
  db.prepare("INSERT INTO public_holidays VALUES('h-proposed','36t','2026-03-04','عطلة مقترحة','عطلة لم تُعتمد بعد فلا أثر لها','proposed','hr',NULL,NULL,'','2026-01-01T00:00:00.000Z')").run();
  const holidays=holidaySet(db,'36t');
  assert.equal(isWorkingDay('2026-03-01',holidays),true);
  assert.equal(isWorkingDay('2026-03-03',holidays),false,'an approved holiday');
  assert.equal(isWorkingDay('2026-03-04',holidays),true,'a proposed holiday changes nothing until someone else approves it');
  assert.equal(isWorkingDay('2026-03-06',holidays),false,'Friday');
  assert.equal(isWorkingDay('2026-03-07',holidays),false,'Saturday');
  assert.equal(workingDaysBetween('2026-03-01','2026-03-08',holidays),4,'Mon, Wed, Thu, then Sunday — the submission day itself is not counted');
  assert.equal(addWorkingDays('2026-03-05',1,holidays),'2026-03-08','Thursday plus one working day lands on Sunday');
  assert.equal(addWorkingDays('2026-03-02',1,holidays),'2026-03-04','the holiday is skipped');
});

test('service clock: a weekend is not a delay, and time waiting on the requester is not counted against the department',()=>{
  const holidays=new Set(),clock=(pauses,asOf,status='pending')=>computeClock({status,submitted:'2026-03-05',pauses},2,holidays,asOf);
  // Submitted Thursday 2026-03-05, with a two working-day target.
  assert.equal(clock([],'2026-03-08').days_left,1,'Friday and Saturday did not consume the target');
  assert.equal(clock([],'2026-03-08').due_on,'2026-03-09');
  assert.equal(clock([],'2026-03-10').overdue,true,'three working days have passed');
  // Returned to the requester on Sunday 8 March; still waiting on Thursday 12 March.
  const waiting=clock([{from:'2026-03-08',to:null}],'2026-03-12','returned');
  assert.equal(waiting.paused,true);assert.equal(waiting.overdue,false);assert.equal(waiting.days_left,1,'the clock is frozen where the return left it');assert.equal(waiting.due_on,null);
  // Resubmitted on Sunday 15 March.
  const resumed=clock([{from:'2026-03-08',to:'2026-03-15'}],'2026-03-16');
  assert.equal(resumed.paused,false);assert.equal(resumed.days_left,0,'one day before the return, one day after the resubmission');assert.equal(resumed.due_on,'2026-03-16');
  assert.equal(clock([{from:'2026-03-08',to:'2026-03-15'}],'2026-03-17').overdue,true);
  // مسح الكتالوج 20 سبتمبر (العطب 12): الطلب المغلق كان يفقد تاريخ استحقاقه (due_on:null لكل حالة مغلقة)،
  // فلا يُقرأ من صفحته هل التُزم بزمنه، وكان هذا السطر يثبّت ذلك الفقد. الاستحقاق يبقى الآن محسوبًا بلحظة
  // الإغلاق، ومعه هل بُلغ الزمن أم لا — والطلب الذي أُغلق بعد شهرين من زمن يومين متأخر، ويقول ذلك عن نفسه.
  const late=computeClock({status:'completed',submitted:'2026-03-05',closed_at:'2026-04-30T09:00:00.000Z',pauses:[]},2,holidays,'2026-04-30');
  assert.equal(late.due_on,'2026-03-09','a closed request keeps the date it was due');
  assert.equal(late.met,false,'and says whether that date was met');
  assert.equal(late.closed_on,'2026-04-30');
  const onTime=computeClock({status:'completed',submitted:'2026-03-05',closed_at:'2026-03-08T09:00:00.000Z',pauses:[]},2,holidays,'2026-03-20');
  assert.equal(onTime.due_on,'2026-03-09');assert.equal(onTime.met,true);assert.equal(onTime.overdue,false);
  // المسودة لم تُقدَّم، فلا يُخترع لها استحقاق.
  assert.equal(computeClock({status:'draft',submitted:null,pauses:[]},2,holidays,'2026-03-08').due_on,null);
});

test('service clock: a return pauses the live request and the resubmission resumes it',t=>{
  const db=setup(t),employee=user(db,'employee'),office=user(db,'head-ceo-office');
  const service=wf.catalog(db,employee).find(s=>s.code==='ADM-MAINTENANCE');
  let r=wf.createRequest(db,employee,{service_id:service.id,title:'عطل إنارة',payload:{category:'كهرباء',location:'الاستقبال',description:'إنارة مصطنعة',urgency:'عادي'},project_id:null});
  // الانتقال داخل معاملة كما يناديه الخادم: transition يشترطها منذ حارس المعاملة في app/workflow.mjs.
  r=transaction(db,()=>wf.transition(db,employee,r.id,'submit',{version:r.version}));
  assert.equal(clockFor(db,r,2).paused,false);
  r=transaction(db,()=>wf.transition(db,office,r.id,'return',{version:r.version,note:'حدد موقع العطل بدقة'}));
  assert.deepEqual(pausedIntervals(db,r.id).map(p=>p.to),[null]);
  assert.equal(clockFor(db,r,2).paused,true);
  r=transaction(db,()=>wf.transition(db,employee,r.id,'submit',{version:r.version}));
  assert.equal(clockFor(db,r,2).paused,false);
  assert.equal(pausedIntervals(db,r.id).every(p=>p.to),true);
});
