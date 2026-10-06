import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createCycle, cycleAction } from '../app/talent.mjs';
import {
  oneToOnesBoard, scheduleOneToOne, meetingAction, followUpAction, openFollowUps,
  feedbackBoard, writeFeedback, noteAction, requestFeedback, requestAction, feedbackEvidence,
  review360Board, setUpwardThreshold, nominate, nominationAction, submit360
} from '../app/feedback.mjs';

const code=value=>error=>error.code===value;
const day=offset=>new Date(Date.now()+offset*86400000+3*3600000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-feedback');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,users,tx:f=>transaction(db,f)};
}
// دورة تقييم مفتوحة: الموارد البشرية تنشئها وتفتحها، فتُنشأ تقييمات لمن لهم مدير مباشر.
function openCycle(db,tx,users){
  const cycle=tx(()=>createCycle(db,users.hr,{name:'دورة تجريبية',period_from:day(-120),period_to:day(30),scale_max:5,
    criteria:[{name:'جودة التسليم',weight:60},{name:'التعاون',weight:40}]}));
  const version=db.prepare('SELECT version FROM review_cycles WHERE id=?').get(cycle.id).version;
  tx(()=>cycleAction(db,users.hr,cycle.id,'open',{version}));
  return cycle.id;
}
const meeting=(db,tx,users,offset=1)=>tx(()=>scheduleOneToOne(db,users.manager,{counterpart_id:'employee',scheduled_on:day(offset)})).id;
const load=(db,u,meetingId)=>oneToOnesBoard(db,u).meetings.find(m=>m.id===meetingId);

test('one-to-one: the content belongs to the two parties, each private note to its writer alone, and HR sees that it happened and when — never what was said',t=>{
  const {db,users,tx}=fixture(t);
  const meetingId=meeting(db,tx,users);
  const v=()=>load(db,users.manager,meetingId).version;
  tx(()=>meetingAction(db,users.manager,meetingId,'add_agenda',{version:v(),topic:'توزيع العمل على الحملة القادمة'}));
  tx(()=>meetingAction(db,users.employee,meetingId,'add_agenda',{version:v(),topic:'رغبتي في التوسع بمهارة التحليل'}));
  tx(()=>meetingAction(db,users.employee,meetingId,'save_private_note',{version:v(),note:'ملاحظة الموظفة الخاصة جدًا'}));
  tx(()=>meetingAction(db,users.manager,meetingId,'save_private_note',{version:v(),note:'ملاحظة المدير الخاصة جدًا'}));

  const forEmployee=load(db,users.employee,meetingId),forManager=load(db,users.manager,meetingId);
  assert.equal(forEmployee.my_private_note,'ملاحظة الموظفة الخاصة جدًا');
  assert.ok(!JSON.stringify(forEmployee).includes('ملاحظة المدير الخاصة'),'a private note never reaches the other party');
  assert.ok(!JSON.stringify(forManager).includes('ملاحظة الموظفة الخاصة'));
  assert.equal(forEmployee.agenda.length,2,'the agenda is shared and both parties write in it before the meeting');

  // زميل ليس طرفًا في اللقاء لا يعرف أنه موجود أصلًا.
  assert.equal(oneToOnesBoard(db,users.outsider).meetings.length,0);
  assert.throws(()=>tx(()=>meetingAction(db,users.outsider,meetingId,'add_agenda',{version:v(),topic:'اقتحام اللقاء'})),code('not_found'));

  const hr=oneToOnesBoard(db,users.hr);
  assert.equal(hr.meetings.length,0,'HR is not a party to anyone else’s meeting');
  assert.ok(hr.cadence,'HR reads the cadence');
  const cadence=JSON.stringify(hr.cadence);
  for(const secret of ['توزيع العمل','التوسع بمهارة','الخاصة جدًا'])assert.ok(!cadence.includes(secret),`HR must not read: ${secret}`);
  assert.deepEqual(db.prepare('SELECT * FROM one_to_one_cadence LIMIT 1').all().flatMap(r=>Object.keys(r)).filter(k=>['shared_notes','employee_private_note','manager_private_note'].includes(k)),[],'the cadence view carries no content column');
  assert.equal(hr.cadence.rows.find(r=>r.employee_name===users.employee.name).held_count,0);

  const stale=v();
  tx(()=>meetingAction(db,users.manager,meetingId,'record_held',{version:stale,shared_notes:'اتفقنا على مراجعة خطة التعلم بعد شهر وتوزيع مهام الحملة'}));
  assert.equal(load(db,users.manager,meetingId).status,'held');
  assert.equal(oneToOnesBoard(db,users.hr).cadence.rows.find(r=>r.employee_name===users.employee.name).held_count,1,'HR now sees that it was held');
  assert.throws(()=>tx(()=>meetingAction(db,users.manager,meetingId,'add_agenda',{version:stale+1,topic:'بند بعد الإقفال'})),code('invalid_state'));
  assert.throws(()=>db.prepare("UPDATE one_to_ones SET shared_notes='تعديل صامت',version=version+1 WHERE id=?").run(meetingId),/final/);
  assert.ok(verifyAudit(db));
});

test('one-to-one follow-up items belong to their owner: only the owner closes one, and open items surface on the owner’s own list',t=>{
  const {db,users,tx}=fixture(t);
  const meetingId=meeting(db,tx,users);
  const v=()=>load(db,users.manager,meetingId).version;
  tx(()=>meetingAction(db,users.manager,meetingId,'add_follow_up',{version:v(),item:'ترشيح دورة تحليل بيانات للموظفة',due_date:day(7),owner_id:'manager'}));
  tx(()=>meetingAction(db,users.employee,meetingId,'add_follow_up',{version:v(),item:'كتابة ملخص الحملة السابقة',due_date:day(3),owner_id:'employee'}));

  const mine=openFollowUps(db,users.employee);
  assert.deepEqual(mine.map(i=>i.item),['كتابة ملخص الحملة السابقة'],'each person’s list carries their own items only');
  assert.equal(mine[0].counterpart_name,users.manager.name);
  assert.equal(openFollowUps(db,users.manager).length,1);
  assert.equal(oneToOnesBoard(db,users.employee).my_open_items.length,1);

  const item=load(db,users.employee,meetingId).follow_ups.find(f=>f.mine);
  assert.throws(()=>tx(()=>followUpAction(db,users.manager,item.id,'complete_item',{version:item.version,note:'أقفلها نيابة عنها'})),code('not_found'));
  tx(()=>followUpAction(db,users.employee,item.id,'complete_item',{version:item.version,note:'أُرسل الملخص إلى المدير'}));
  assert.equal(openFollowUps(db,users.employee).length,0);
  assert.throws(()=>tx(()=>followUpAction(db,users.employee,item.id,'drop_item',{version:item.version+1,note:'إعادة فتح'})),code('invalid_state'));
  assert.ok(verifyAudit(db));
});

test('a feedback note is owned by its author and its recipient: visibility alone decides who else reads it, and HR is no exception',t=>{
  const {db,users,tx}=fixture(t);
  const body=key=>`ملاحظة ${key}: سلّمت العمل قبل موعده وشرحت للفريق كيف بنت الجدول`;
  const privateNote=tx(()=>writeFeedback(db,users.outsider,{subject_id:'employee',kind:'appreciation',visibility:'recipient',body:body('مغلقة'),occurred_on:day(-2)}));
  const managerNote=tx(()=>writeFeedback(db,users.outsider,{subject_id:'employee',kind:'improvement',visibility:'recipient_manager',body:body('لمديرها'),occurred_on:day(-1)}));
  const publicNote=tx(()=>writeFeedback(db,users.outsider,{subject_id:'employee',kind:'appreciation',visibility:'public',body:body('علنية'),occurred_on:day(0)}));
  const seen=u=>new Set(feedbackBoard(db,u).notes.map(n=>n.id));

  assert.deepEqual([...seen(users.employee)].sort(),[privateNote.id,managerNote.id,publicNote.id].sort(),'the recipient reads everything about them');
  assert.deepEqual([...seen(users.outsider)].sort(),[privateNote.id,managerNote.id,publicNote.id].sort(),'so does the author');
  assert.deepEqual([...seen(users.manager)].sort(),[managerNote.id,publicNote.id].sort(),'the recipient’s manager reads only what its visibility allows');
  assert.deepEqual([...seen(users.hr)],[publicNote.id],'HR has no default window into someone’s feedback');
  assert.equal(feedbackBoard(db,users.external).notes.length,0,'another tenant reads nothing');

  assert.throws(()=>tx(()=>writeFeedback(db,users.employee,{subject_id:'employee',kind:'appreciation',visibility:'public',body:body('عن نفسي'),occurred_on:day(0)})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>writeFeedback(db,users.outsider,{subject_id:'employee',kind:'appreciation',visibility:'public',body:body('من الغد'),occurred_on:day(3)})),code('occurred_on'));
  assert.throws(()=>db.prepare("UPDATE feedback_notes SET body='نص بديل',version=version+1 WHERE id=?").run(managerNote.id),/written once/);

  const note=feedbackBoard(db,users.outsider).notes.find(n=>n.id===managerNote.id);
  assert.throws(()=>tx(()=>noteAction(db,users.employee,managerNote.id,'withdraw_note',{version:note.version,reason:'لا تعجبني'})),code('not_found'));
  tx(()=>noteAction(db,users.outsider,managerNote.id,'withdraw_note',{version:note.version,reason:'كتبتها عن الشخص الخطأ'}));
  assert.ok(!seen(users.manager).has(managerNote.id),'a withdrawn note leaves the readers it had');
  assert.ok(seen(users.employee).has(managerNote.id),'its recipient still sees it, marked withdrawn');
  assert.equal(feedbackBoard(db,users.employee).notes.find(n=>n.id===managerNote.id).withdrawn,true);
  assert.ok(verifyAudit(db));
});

test('feedback is requested with a specific question, and what the evaluator may see reaches the review cycle as evidence — never copied into it and never scored',t=>{
  const {db,users,tx}=fixture(t);
  const request=tx(()=>requestFeedback(db,users.employee,{respondent_id:'outsider',question:'كيف كان تعاوني معك في حملة الربع الأخير؟'}));
  assert.throws(()=>tx(()=>requestFeedback(db,users.employee,{respondent_id:'outsider',question:'سؤال مكرر عن التعاون نفسه'})),code('duplicate_request'));
  assert.equal(feedbackBoard(db,users.outsider).requests_to_me[0].question,'كيف كان تعاوني معك في حملة الربع الأخير؟');
  assert.throws(()=>tx(()=>requestAction(db,users.manager,request.id,'decline_request',{version:1,reason:'لست المقصود بالسؤال'})),code('not_found'));
  tx(()=>requestAction(db,users.outsider,request.id,'answer_request',{version:1,kind:'appreciation',visibility:'recipient_manager',body:'تعاونها كان واضحًا: شاركت ملفات الحملة مبكرًا وأجابت أسئلتي في وقتها'}));
  assert.equal(feedbackBoard(db,users.employee).my_requests[0].status,'answered');
  assert.throws(()=>tx(()=>requestAction(db,users.outsider,request.id,'decline_request',{version:2,reason:'تراجعت عن الإجابة'})),code('invalid_state'));

  tx(()=>writeFeedback(db,users.outsider,{subject_id:'employee',kind:'improvement',visibility:'recipient',body:'ملاحظة مغلقة لا يراها المدير ولا تصلح دليلًا له',occurred_on:day(-3)}));
  openCycle(db,tx,users);
  const review=db.prepare("SELECT id FROM performance_reviews WHERE user_id='employee'").get();
  const evidence=feedbackEvidence(db,users.manager,review.id);
  assert.equal(evidence.notes.length,1,'only what the evaluator may already read appears as evidence');
  assert.match(evidence.notes[0].body,/شاركت ملفات الحملة/);
  assert.match(evidence.rule,/لا تُنسخ/);
  assert.throws(()=>feedbackEvidence(db,users.outsider,review.id),code('not_found'));
  const row=db.prepare('SELECT scores,manager_score_bp,manager_summary FROM performance_reviews WHERE id=?').get(review.id);
  assert.deepEqual({...row},{scores:'[]',manager_score_bp:null,manager_summary:''},'evidence writes nothing into the review');
  assert.ok(feedbackBoard(db,users.manager).evidence.some(e=>e.review_id===review.id));
  assert.ok(verifyAudit(db));
});

test('360: the panel is approved by a third party — not the subject, not the nominator, not the rater',t=>{
  const {db,users,tx}=fixture(t);
  const cycleId=openCycle(db,tx,users);
  const nomination=tx(()=>nominate(db,users.manager,{cycle_id:cycleId,subject_id:'manager',rater_id:'employee',source:'upward'}));
  const version=()=>db.prepare('SELECT version FROM review_360_nominations WHERE id=?').get(nomination.id).version;

  assert.throws(()=>tx(()=>nominationAction(db,users.manager,nomination.id,'approve_nomination',{version:version(),note:'أعتمد من يقيّمني'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>nominationAction(db,users.employee,nomination.id,'approve_nomination',{version:version(),note:'أعتمد نفسي مقيّمًا'})),code('separation_of_duties'));
  tx(()=>nominationAction(db,users.hr,nomination.id,'approve_nomination',{version:version(),note:'الفريق كامل مرشح، لا انتقاء'}));
  assert.throws(()=>tx(()=>nominationAction(db,users.hr,nomination.id,'reject_nomination',{version:version(),note:'تراجع بعد الاعتماد'})),code('invalid_state'));
  assert.throws(()=>db.prepare("UPDATE review_360_nominations SET status='rejected',version=version+1 WHERE id=?").run(nomination.id),/final/);

  // مصدر التقييم يحكم من يصلح مقيّمًا: الصاعد من الفريق المباشر، والقرين ليس مديرًا ولا تابعًا.
  assert.throws(()=>tx(()=>nominate(db,users.hr,{cycle_id:cycleId,subject_id:'manager',rater_id:'hr',source:'upward'})),code('rater_id'));
  assert.throws(()=>tx(()=>nominate(db,users.manager,{cycle_id:cycleId,subject_id:'employee',rater_id:'manager',source:'peer'})),code('rater_id'));
  assert.throws(()=>tx(()=>nominate(db,users.manager,{cycle_id:cycleId,subject_id:'manager',rater_id:'employee',source:'upward'})),code('duplicate_nomination'));
  assert.throws(()=>tx(()=>nominate(db,users.employee,{cycle_id:cycleId,subject_id:'outsider',rater_id:'employee',source:'peer'})),code('not_permitted'));
  assert.throws(()=>tx(()=>submit360(db,users.outsider,nomination.id,{strengths:'ليست استجابتي أصلًا',improvements:'ولا يحق لي إرسالها'})),code('not_found'));
  assert.ok(verifyAudit(db));
});

test('360: upward feedback is never revealed below the threshold the HR manager set, the threshold lives in the query, and no source is scored or ranked',t=>{
  const {db,users,tx}=fixture(t);
  const cycleId=openCycle(db,tx,users);
  assert.throws(()=>tx(()=>setUpwardThreshold(db,users.employee,{min_upward_respondents:2,basis:'قرار غير مخول',confirmed_on:day(0)})),code('not_permitted'));
  assert.throws(()=>tx(()=>setUpwardThreshold(db,users.hr,{min_upward_respondents:1,basis:'حد يكشف المستجيب الوحيد',confirmed_on:day(0)})),code('min_upward_respondents'));

  const approve=(nominator,raterId)=>{
    const n=tx(()=>nominate(db,nominator,{cycle_id:cycleId,subject_id:'manager',rater_id:raterId,source:'upward'}));
    const version=db.prepare('SELECT version FROM review_360_nominations WHERE id=?').get(n.id).version;
    tx(()=>nominationAction(db,users.hr,n.id,'approve_nomination',{version,note:'الفريق المباشر كاملًا بلا انتقاء'}));
    return n.id;
  };
  const first=approve(users.manager,'employee'),second=approve(users.manager,'outsider');
  tx(()=>submit360(db,users.employee,first,{strengths:'يشرح الأولويات بوضوح ويحمي الفريق من التكليف المتأخر',improvements:'يحتاج إلى قرار أسرع في تعارض المواعيد'}));
  assert.throws(()=>tx(()=>submit360(db,users.employee,first,{strengths:'محاولة إرسال ثانية لنفس الترشيح',improvements:'محاولة إرسال ثانية لنفس الترشيح'})),code('already_submitted'));

  // لا حد مسجَّل بعد: لا يُعرض تقييم صاعد إطلاقًا، ولو بلغ عدد المستجيبين ما بلغ.
  const beforeSetting=review360Board(db,users.hr).cycles[0].panels.find(p=>p.subject_id==='manager');
  assert.deepEqual(beforeSetting.results.upward,[]);
  assert.match(beforeSetting.results.upward_note,/لم يحدد مدير الموارد البشرية/);

  // الترحيل 091: الحد لا يقل عن ثلاثة، ولا يُقرأ التقييم الصاعد قبل المعايرة (كان هنا حد اثنين وقراءة أثناء الدورة).
  assert.throws(()=>tx(()=>setUpwardThreshold(db,users.hr,{min_upward_respondents:2,basis:'حد اثنين يكشف بالطرح',confirmed_on:day(0)})),code('min_upward_respondents'));
  tx(()=>setUpwardThreshold(db,users.hr,{min_upward_respondents:3,basis:'قرار مدير الموارد البشرية: لا يُعرض تقييم صاعد بأقل من ثلاثة مستجيبين',confirmed_on:day(0)}));
  const oneRespondent=review360Board(db,users.hr).cycles[0].panels.find(p=>p.subject_id==='manager');
  assert.deepEqual(oneRespondent.results.upward,[],'a single respondent is never revealed');
  assert.match(oneRespondent.results.upward_note,/قبل انتقال الدورة إلى المعايرة/);
  assert.ok(!JSON.stringify(oneRespondent.results).includes('يشرح الأولويات'),'not one word of the single response leaks');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM review_360_responses WHERE source='upward'").get().n,1,'the response is stored; it is the reading that is withheld');

  tx(()=>submit360(db,users.outsider,second,{strengths:'متاح حين نحتاجه ويشرح سبب القرار لا القرار وحده',improvements:'التغذية الراجعة المكتوبة أقل مما نحتاج'}));
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT 'third',tenant_id,department_id,'third','عضو فريق ثالث تجريبي',password_hash,'employee','manager' FROM users WHERE id='employee'").run();
  const third=approve(users.manager,'third');
  tx(()=>submit360(db,db.prepare("SELECT * FROM users WHERE id='third'").get(),third,{strengths:'يوضح أولويات الأسبوع في اجتماع قصير ومفيد',improvements:'يحتاج إلى توزيع أوضح للمهام المفاجئة'}));
  const own=review360Board(db,users.manager).cycles[0].panels.find(p=>p.subject_id==='manager');
  assert.equal(own.results,null,'his own cycle results wait for calibration');
  db.prepare("UPDATE review_cycles SET status='calibration',version=version+1 WHERE id=?").run(cycleId);
  const revealed=review360Board(db,users.hr).cycles[0].panels.find(p=>p.subject_id==='manager');
  assert.equal(revealed.results.upward.length,3,'the aggregate opens once the threshold is met and collection has ended');
  const text=JSON.stringify(revealed.results.upward);
  for(const person of [users.employee.name,users.outsider.name,'employee','outsider','third'])assert.ok(!text.includes(person),`the aggregate carries no identity: ${person}`);
  assert.deepEqual(Object.keys(revealed.results.upward[0]).sort(),['improvements','strengths'],'a response is text, never a score');
  assert.ok(!('score' in revealed.results)&&!('rank' in revealed.results)&&!('composite' in revealed.results),'no composite score is derived from the sources');

  // صاحب اللوحة هو المدير المقيَّم: لا يعرف من رُشّح لتقييمه صاعدًا ولا من أجاب.
  const upward=own.nominations.filter(n=>n.source==='upward');
  assert.equal(upward.length,3);
  for(const n of upward){assert.equal(n.rater_name,'مخفي — تقييم صاعد');assert.equal(n.answered,null);}
  assert.equal(review360Board(db,users.external).cycles.length,0,'another tenant sees no cycle');
  assert.ok(verifyAudit(db));
});
