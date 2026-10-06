import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import {
  setSurveyPrivacy, createCycle, editCycle, approveCycle, closeCycle, submitPulse, pulseBoard,
  defineValue, retireValue, sendRecognition, recognitionBoard,
  draftAnnouncement, editAnnouncement, attachToAnnouncement, approveAnnouncement, withdrawAnnouncement,
  acknowledgeAnnouncement, createEvent, cancelEvent, announcementsBoard
} from '../app/engagement.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const addDays=(iso,days)=>new Date(Date.parse(`${iso}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
const PNG=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]).toString('base64');

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-engagement');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  // مدير الموارد البشرية وحده لا يكفي: فصل المهام يحتاج حاملَي تصريح، فيُمنح المدير التصريح نفسه.
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.survey.manage',department_id:null,note:'اختبار فصل المهام'}));
  return {db,users,tx};
}
// الحد الأدنى خمسة (الترحيل 091)، والكيان التجريبي ستة حسابات: توزيع آمن يحتاج موظفين تجريبيين إضافيين.
function extraStaff(db,count){
  for(let i=1;i<=count;i++)db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT ?,tenant_id,department_id,?,?,password_hash,'employee','manager' FROM users WHERE id='employee'").run(`staff${i}`,`staff${i}`,`موظف تجريبي ${i}`);
  return Object.fromEntries(db.prepare("SELECT * FROM users WHERE id LIKE 'staff%'").all().map(u=>[u.id,u]));
}
// دورة كاملة: إعداد بيد، وفتح بيد أخرى، وإجابات، ثم إغلاق.
function runCycle(db,users,tx,{title,questions,answers,minimumSet=null}){
  if(minimumSet)tx(()=>setSurveyPrivacy(db,users.hr,{min_respondents:minimumSet,effective_from:today(),basis:'قرار مدير الموارد البشرية رقم تجريبي بتاريخ اليوم'}));
  // الترحيل 091: لا تُغلق الدورة قبل تاريخ إغلاقها، فالدورة هنا تفتح وتغلق اليوم نفسه.
  const cycleId=tx(()=>createCycle(db,users.hr,{title,purpose:'قياس النبض — بيانات تجريبية',opens_on:today(),closes_on:today(),questions})).id;
  const draft=pulseBoard(db,users.hr).cycles.find(c=>c.id===cycleId);
  tx(()=>approveCycle(db,users.manager,cycleId,{version:draft.version,note:'اعتمدت الأسئلة ووعد السرية'}));
  for(const [userId,given] of answers){
    const cycle=pulseBoard(db,users[userId]).cycles.find(c=>c.id===cycleId);
    tx(()=>submitPulse(db,users[userId],cycleId,{answers:cycle.questions.map((q,index)=>({question_id:q.id,
      value:q.kind==='comment'?null:given[index],comment:q.kind==='comment'?(given[index]??''):''}))}));
  }
  return cycleId;
}
function closeAnd(db,users,tx,cycleId){
  const open=pulseBoard(db,users.hr).cycles.find(c=>c.id===cycleId);
  tx(()=>closeCycle(db,users.hr,cycleId,{version:open.version,note:'انتهت مدة الدورة'}));
  return pulseBoard(db,users.hr).cycles.find(c=>c.id===cycleId);
}
const SCALE_ENPS_COMMENT=[{kind:'scale',prompt:'أجد في عملي معنى واضحًا'},{kind:'enps',prompt:'إلى أي مدى ترشح الشركة للعمل'},{kind:'comment',prompt:'ما الذي تغيره لو استطعت'}];

test('pulse: an answer is stored with nothing that ties it to a person — not a name, not a time, not an insertion order',t=>{
  const {db,users,tx}=fixture(t);
  const cycleId=runCycle(db,users,tx,{title:'نبض الربع التجريبي',questions:SCALE_ENPS_COMMENT,minimumSet:5,
    answers:[['manager',[5,10,'']],['employee',[5,10,'أتمنى اجتماعات أقل']],['outsider',[5,10,'']],['hr',[4,10,'']],['it',[4,10,'مساحة عمل أهدأ']],['admin',[4,6,'']]]});

  const answerColumns=db.prepare('PRAGMA table_info(pulse_answers)').all().map(c=>c.name);
  assert.ok(!answerColumns.some(c=>/user|employee|person|department|actor|created|updated|submitted|time|date/.test(c)),`answers carry an identifying column: ${answerColumns}`);
  const participantColumns=db.prepare('PRAGMA table_info(pulse_participants)').all().map(c=>c.name);
  assert.deepEqual(answerColumns.filter(c=>participantColumns.includes(c)).sort(),['cycle_id','tenant_id'],'the only key the two tables share is the cycle, which is everybody');
  // الترتيب نفسه تسريب: بلا rowid لا يوجد «الإجابة الأولى» لتُطابق بأول من شارك.
  assert.throws(()=>db.prepare('SELECT rowid FROM pulse_answers LIMIT 1').all(),'answers have no insertion order to correlate with participation');
  // البرهان السلوكي: أوسع ربط ممكن بين إجابة ومشارك يعطي كل المشاركين، لا واحدًا.
  const answerId=db.prepare('SELECT id FROM pulse_answers LIMIT 1').get().id;
  const reachable=db.prepare('SELECT COUNT(DISTINCT p.user_id) AS n FROM pulse_answers a JOIN pulse_participants p ON p.cycle_id=a.cycle_id AND p.tenant_id=a.tenant_id WHERE a.id=?').get(answerId).n;
  assert.equal(reachable,6,'every answer resolves to the whole cohort, never to one person');
  for(const row of db.prepare("SELECT after_json,before_json FROM audit_events WHERE action='pulse.responded'").all()){
    assert.equal(row.after_json,'{"responded":true}','the audit trail records that someone took part, never what they said');
    assert.equal(row.before_json,'{}');
  }
  assert.equal(db.prepare('SELECT COUNT(DISTINCT responded_on) AS n FROM pulse_participants').get().n,1,'participation is dated by day, not stamped by the second');
  // الإجابة لا تُعدل ولا تُحذف: لا أحد يستطيع إثبات أي سطر يخصه.
  assert.throws(()=>db.prepare('UPDATE pulse_answers SET value=1 WHERE id=?').run(answerId),/cannot be edited/);
  assert.throws(()=>db.prepare('DELETE FROM pulse_answers WHERE id=?').run(answerId),/cannot be deleted/);
  assert.throws(()=>tx(()=>submitPulse(db,users.manager,cycleId,{answers:[]})),code('already_responded'));
  assert.ok(verifyAudit(db));
});

test('pulse: a distribution is withheld whole when any band is smaller than the minimum, because showing the rest with the total discloses it by subtraction',t=>{
  const {db,users:seeded,tx}=fixture(t);
  const users={...seeded,...extraStaff(db,4)};
  const wide=runCycle(db,users,tx,{title:'نبض بتوزيع آمن',questions:SCALE_ENPS_COMMENT,minimumSet:5,
    answers:[['manager',[5,10,'']],['employee',[5,10,'تعليق أول واضح']],['outsider',[5,10,'']],['hr',[5,10,'']],['it',[5,10,'تعليق ثانٍ واضح']],
      ['admin',[4,10,'']],['staff1',[4,10,'']],['staff2',[4,10,'']],['staff3',[4,10,'']],['staff4',[4,6,'']]]});
  const closed=closeAnd(db,users,tx,wide),[scale,enps,comment]=closed.results.questions;
  assert.equal(closed.results.available,true);
  assert.equal(closed.results.respondents,10);
  assert.deepEqual(scale.bands.map(b=>b.count),[0,0,0,5,5],'every non-empty band clears the minimum, so the whole distribution is shown');
  assert.equal(scale.average,4.5);
  // eNPS: فئة «غير مُرشِّح» واحدة فقط — عرض المُرشِّحين والمحايدين مع المجموع يكشفها طرحًا.
  assert.equal(enps.bands,null);
  assert.equal(enps.bands_withheld,true);
  assert.match(enps.bands_reason,/طرحًا/);
  // الترحيل 091: eNPS والمتوسط مع العدد يعيدان بناء الفئة المحجوبة (90 = 9 مرشحين ومنتقد واحد)، فيُحجبان معها.
  assert.equal(enps.enps,null,'the headline score is withheld with the bands: with the head count it rebuilds them');
  assert.equal(enps.average,null);
  // سؤال التعليق أجاب عليه اثنان فقط دون الحد الأدنى: محجوب هو وعدده.
  assert.equal(comment.withheld,true);
  assert.equal(comment.answered,null);
  assert.equal(comment.comments,undefined);

  const narrow=runCycle(db,users,tx,{title:'نبض بفئة مفردة',questions:[{kind:'scale',prompt:'أجد الدعم الذي أحتاجه'}],
    answers:[['manager',[5]],['employee',[5]],['outsider',[5]],['hr',[5]],['it',[4]]]});
  const single=closeAnd(db,users,tx,narrow).results;
  assert.equal(single.available,true);
  assert.equal(single.respondents,5);
  assert.equal(single.questions[0].bands,null,'one person chose 4; publishing the 5s and the total would name that band');
  assert.equal(single.questions[0].average,null,'the average is withheld with the bands: 4.8 over five answers names the one 4');
  assert.ok(verifyAudit(db));
});

test('pulse: no result exists before the cycle closes, none ever exists below the minimum, and nothing is ever split by department or compared to an industry',t=>{
  const {db,users,tx}=fixture(t);
  const live=runCycle(db,users,tx,{title:'نبض جارٍ',questions:[{kind:'scale',prompt:'أجد في عملي معنى واضحًا'}],minimumSet:5,
    answers:[['manager',[5]],['employee',[4]],['outsider',[5]],['hr',[4]]]});
  const open=pulseBoard(db,users.hr).cycles.find(c=>c.id===live);
  assert.equal(open.results.available,false,'a running total read twice discloses whoever answered in between');
  assert.match(open.results.reason,/بالطرح/);
  assert.deepEqual(open.results.questions,[]);

  const thin=runCycle(db,users,tx,{title:'نبض قليل المشاركة',questions:[{kind:'scale',prompt:'أجد الدعم الذي أحتاجه'}],
    answers:[['manager',[5]],['employee',[2]]]});
  const closed=closeAnd(db,users,tx,thin);
  assert.equal(closed.results.available,false);
  assert.match(closed.results.reason,/ولا لاحقًا/,'a promise made before collection is not revisited after it');

  const board=pulseBoard(db,users.hr),cycle=board.cycles.find(c=>c.id===live);
  assert.deepEqual(Object.keys(cycle.participation).sort(),['invited','names_withheld','responded'],'the board counts participation and never names who did or did not answer');
  assert.ok(!/department|قسم|إدارة|benchmark|قطاع/i.test(JSON.stringify(closeAnd.length&&board.cycles.map(c=>c.results))),'no result is keyed by any group smaller than the company');
  assert.match(board.note,/الشركة فقط/);
  assert.match(board.benchmarks,/لا نخترعها/);
  // لا تحليل مشاعر ولا نموذج لغوي: التعليق يعود كما كُتب، بلا درجة ولا وسم.
  const said='لدينا اجتماعات كثيرة ووقت تركيز قليل';
  const commented=runCycle(db,users,tx,{title:'نبض بتعليقات',questions:[{kind:'comment',prompt:'ما الذي تغيره لو استطعت'}],
    answers:[['manager',[said]],['employee',[said]],['outsider',[said]],['hr',[said]],['it',[said]]]});
  const comments=closeAnd(db,users,tx,commented).results.questions[0];
  assert.deepEqual(comments.comments,[said,said,said,said,said]);
  assert.match(comments.comments_note,/قد يكشف كاتبه/);
  assert.equal(pulseBoard(db,users.employee).cycles.find(c=>c.id===commented).results.questions[0].comments,null,'free comments are for the capability holder only');
  assert.ok(verifyAudit(db));
});

test('pulse: the minimum is a dated setting nobody can backdate, the author of the questions cannot open the cycle, and an opened cycle is closed rather than rewritten',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>setSurveyPrivacy(db,users.employee,{min_respondents:3,effective_from:today(),basis:'محاولة من غير صاحب التصريح'})),code('not_permitted'));
  assert.throws(()=>tx(()=>setSurveyPrivacy(db,users.hr,{min_respondents:5,effective_from:addDays(today(),-1),basis:'تخفيض بأثر رجعي يكشف نتائج جُمعت بوعد أعلى'})),code('effective_from'));
  const questions=[{kind:'scale',prompt:'أجد في عملي معنى واضحًا'}];
  // مسودة بلا إعداد سارٍ تجوز، لكن جمع إجابة واحدة قبل تثبيت وعد السرية لا يجوز.
  const early=tx(()=>createCycle(db,users.hr,{title:'قبل تثبيت الوعد',purpose:'',opens_on:today(),closes_on:today(),questions})).id;
  const earlyDraft=pulseBoard(db,users.hr).cycles.find(c=>c.id===early);
  assert.throws(()=>tx(()=>approveCycle(db,users.manager,early,{version:earlyDraft.version,note:'أفتح قبل تحديد الحد الأدنى'})),code('privacy_not_set'));
  tx(()=>setSurveyPrivacy(db,users.hr,{min_respondents:6,effective_from:today(),basis:'قرار مدير الموارد البشرية رقم تجريبي'}));
  assert.throws(()=>tx(()=>createCycle(db,users.employee,{title:'من غير صاحب تصريح',purpose:'',opens_on:today(),closes_on:today(),questions})),code('not_permitted'));
  const cycleId=tx(()=>createCycle(db,users.hr,{title:'نبض الفصل بين المهام',purpose:'',opens_on:today(),closes_on:addDays(today(),2),questions})).id;
  const draft=pulseBoard(db,users.hr).cycles.find(c=>c.id===cycleId);
  assert.throws(()=>tx(()=>approveCycle(db,users.hr,cycleId,{version:draft.version,note:'أفتح ما أعددته بنفسي'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>approveCycle(db,users.manager,cycleId,{version:draft.version+5,note:'نسخة قديمة'})),code('stale_version'));
  assert.throws(()=>tx(()=>approveCycle(db,users.external,cycleId,{version:draft.version,note:'من كيان آخر'})),error=>['not_permitted','not_found'].includes(error.code));
  tx(()=>editCycle(db,users.hr,cycleId,{version:draft.version,title:'نبض الفصل بين المهام',purpose:'نسخة معدلة',opens_on:today(),closes_on:addDays(today(),2),questions}));
  const edited=pulseBoard(db,users.hr).cycles.find(c=>c.id===cycleId);
  tx(()=>approveCycle(db,users.manager,cycleId,{version:edited.version,note:'راجعت الأسئلة قبل فتحها'}));
  const opened=pulseBoard(db,users.hr).cycles.find(c=>c.id===cycleId);
  assert.equal(opened.min_respondents,6,'the cycle carries the promise in force the moment it opened');
  assert.throws(()=>tx(()=>editCycle(db,users.hr,cycleId,{version:opened.version,title:'سؤال آخر',purpose:'',opens_on:today(),closes_on:addDays(today(),2),questions})),code('not_draft'));
  assert.throws(()=>db.prepare("UPDATE pulse_cycles SET title='تغيير صامت',version=version+1 WHERE id=?").run(cycleId),/never rewritten/);
  assert.throws(()=>db.prepare('DELETE FROM pulse_questions WHERE cycle_id=?').run(cycleId),/fixed/);
  // خفض الحد لاحقًا لا يفتح نتائج دورة جُمعت بوعد أعلى.
  tx(()=>setSurveyPrivacy(db,users.hr,{min_respondents:5,effective_from:addDays(today(),1),basis:'مراجعة لاحقة للإعداد المؤرّخ'}));
  assert.equal(pulseBoard(db,users.hr).cycles.find(c=>c.id===cycleId).min_respondents,6);
  assert.equal(pulseBoard(db,users.external).cycles.length,0,'a cycle never leaves its tenant');
  assert.throws(()=>tx(()=>submitPulse(db,users.external,cycleId,{answers:[]})),code('not_found'));
  assert.ok(verifyAudit(db));
});

test('recognition: a card is tied to a value its owner defined, never to itself, and nothing in the module counts, scores or ranks a person',t=>{
  const {db,users,tx}=fixture(t);
  const empty=recognitionBoard(db,users.employee);
  assert.equal(empty.values_missing,true);
  assert.ok(!empty.actions.includes('send_recognition'),'no invented values means no cards');
  assert.throws(()=>tx(()=>defineValue(db,users.employee,{name:'قيمة',description:'وصف كافٍ للقيمة',basis:'قرار',effective_from:today()})),code('not_permitted'));
  const valueId=tx(()=>defineValue(db,users.hr,{name:'إتقان',description:'ننهي العمل بجودة نفخر بها لا بأقل ما يمر',basis:'ميثاق العمل التجريبي',effective_from:today()})).id;
  assert.throws(()=>tx(()=>sendRecognition(db,users.manager,{to_user_id:'manager',value_id:valueId,message:'أقدّر نفسي على هذا العمل',visibility:'public'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>sendRecognition(db,users.manager,{to_user_id:'external',value_id:valueId,message:'من كيان آخر تمامًا',visibility:'public'})),code('not_found'));
  const cardId=tx(()=>sendRecognition(db,users.manager,{to_user_id:'employee',value_id:valueId,message:'أنهت ملف العميل قبل موعده بجودة واضحة',visibility:'public'})).id;
  tx(()=>sendRecognition(db,users.hr,{to_user_id:'employee',value_id:valueId,message:'ساعدت زميلها الجديد دون أن يطلب أحد',visibility:'private'}));

  const board=recognitionBoard(db,users.outsider);
  assert.equal(board.feed.length,1,'a private card stays between its two people');
  assert.equal(recognitionBoard(db,users.employee).received.length,2);
  assert.equal(recognitionBoard(db,users.hr).sent.length,1);
  assert.equal(recognitionBoard(db,users.external).feed.length,0);
  const cardColumns=db.prepare('PRAGMA table_info(recognition_cards)').all().map(c=>c.name);
  assert.ok(!cardColumns.some(c=>/point|score|weight|rank|level/.test(c)),`a recognition card carries no weight: ${cardColumns}`);
  const walk=(node,keys=new Set())=>{if(node&&typeof node==='object')for(const [k,x] of Object.entries(node)){keys.add(k);walk(x,keys);}return keys;};
  const leaderboard=[...walk(board)].filter(k=>/point|score|rank|leader|streak|top_/.test(k));
  assert.deepEqual(leaderboard,[],'no key in the board ranks anybody');
  assert.deepEqual(board.feed.map(c=>c.created_at),[...board.feed.map(c=>c.created_at)].sort().reverse(),'the feed is ordered by time, not by volume');
  assert.match(board.note,/لا نقاط ولا لوحة صدارة/);
  assert.match(board.performance_note,/لا يدخل تقييم الأداء آليًا/);
  assert.throws(()=>db.prepare("UPDATE recognition_cards SET message='تعديل صامت' WHERE id=?").run(cardId),/sent once/);
  assert.throws(()=>db.prepare('DELETE FROM recognition_cards WHERE id=?').run(cardId),/retained/);

  const value=recognitionBoard(db,users.hr).values.find(x=>x.id===valueId);
  assert.throws(()=>tx(()=>retireValue(db,users.hr,valueId,{version:value.version+3,reason:'نسخة قديمة'})),code('stale_version'));
  tx(()=>retireValue(db,users.hr,valueId,{version:value.version,reason:'دُمجت مع قيمة أخرى'}));
  assert.equal(recognitionBoard(db,users.manager).values_missing,true);
  assert.equal(recognitionBoard(db,users.employee).received.length,2,'retiring a value keeps the cards that cited it readable');
  assert.throws(()=>tx(()=>sendRecognition(db,users.manager,{to_user_id:'employee',value_id:valueId,message:'بقيمة مسحوبة لا تصلح',visibility:'public'})),code('value_id'));
  assert.ok(verifyAudit(db));
});

test('announcements: the author does not broadcast their own notice, a published notice is withdrawn rather than reworded, and read receipts exist only where they were justified',t=>{
  const {db,users,tx}=fixture(t);
  const base={title:'تحديث سياسة العمل المرن',body:'تسري السياسة المحدثة من بداية الشهر القادم على كل الفرق.',audience_kind:'all',department_id:'',
    publish_on:today(),expires_on:addDays(today(),14),requires_ack:true,ack_reason:'تغيير سياسة يلزم إثبات اطلاع كل موظف عليه'};
  assert.throws(()=>tx(()=>draftAnnouncement(db,users.employee,base)),code('not_permitted'));
  assert.throws(()=>tx(()=>draftAnnouncement(db,users.hr,{...base,requires_ack:true,ack_reason:''})),code('ack_reason'));
  assert.throws(()=>tx(()=>draftAnnouncement(db,users.hr,{...base,expires_on:addDays(today(),-2)})),error=>['expires_on','invalid_date'].includes(error.code));
  const announcementId=tx(()=>draftAnnouncement(db,users.hr,base)).id;
  const draft=announcementsBoard(db,users.hr).announcements.find(a=>a.id===announcementId);
  assert.equal(announcementsBoard(db,users.employee).announcements.length,0,'a draft is nobody’s notice yet');
  tx(()=>attachToAnnouncement(db,users.hr,announcementId,{label:'نص السياسة المحدثة',file:{filename:'policy.png',content:PNG}}));
  assert.throws(()=>tx(()=>attachToAnnouncement(db,users.hr,announcementId,{label:'ملف نصي مقنّع',file:{filename:'policy.pdf',content:Buffer.from('not a real pdf at all').toString('base64')}})),code('file_type'));
  assert.throws(()=>tx(()=>approveAnnouncement(db,users.hr,announcementId,{version:draft.version,note:'أنشر ما كتبته بنفسي'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>approveAnnouncement(db,users.manager,announcementId,{version:draft.version+4,note:'نسخة قديمة'})),code('stale_version'));
  assert.throws(()=>tx(()=>approveAnnouncement(db,users.employee,announcementId,{version:draft.version,note:'بلا تصريح'})),code('not_permitted'));
  tx(()=>approveAnnouncement(db,users.manager,announcementId,{version:draft.version,note:'راجعت النص والجمهور قبل بثه'}));

  const seen=announcementsBoard(db,users.employee).announcements.find(a=>a.id===announcementId);
  assert.ok(seen.actions.includes('acknowledge'));
  assert.equal(seen.attachments.length,1);
  tx(()=>acknowledgeAnnouncement(db,users.employee,announcementId));
  assert.throws(()=>tx(()=>acknowledgeAnnouncement(db,users.employee,announcementId)),code('already_acknowledged'));
  assert.throws(()=>tx(()=>acknowledgeAnnouncement(db,users.external,announcementId)),code('not_found'));
  const tracked=announcementsBoard(db,users.hr).announcements.find(a=>a.id===announcementId);
  assert.deepEqual(tracked.reads.map(r=>r.name),[users.employee.name]);
  assert.ok(tracked.pending.length>=4&&!tracked.pending.some(p=>p.id==='employee'),'the people still to read it are listed so they can be reminded');
  assert.match(announcementsBoard(db,users.hr).note,/لا بريد/);

  const published=announcementsBoard(db,users.hr).announcements.find(a=>a.id===announcementId);
  assert.throws(()=>tx(()=>editAnnouncement(db,users.hr,announcementId,{version:published.version,...base})),code('not_draft'));
  assert.throws(()=>db.prepare("UPDATE announcements SET body='نص آخر تمامًا',version=version+1 WHERE id=?").run(announcementId),/not rewritten/);
  assert.throws(()=>db.prepare('DELETE FROM announcement_attachments WHERE announcement_id=?').run(announcementId),/retained/);
  tx(()=>withdrawAnnouncement(db,users.manager,announcementId,{version:published.version,reason:'صدرت نسخة أدق من السياسة'}));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM announcement_reads WHERE announcement_id=?').get(announcementId).n,1,'withdrawing a notice does not erase who acknowledged it');
  assert.throws(()=>db.prepare('DELETE FROM announcement_reads WHERE announcement_id=?').run(announcementId),/retained/);

  // إعلان عادي لا يُتتبع من قرأه، وإعلان إدارة لا يصل غيرها.
  const plainId=tx(()=>draftAnnouncement(db,users.manager,{title:'موعد الصيانة الدورية',body:'تتوقف الأنظمة ساعة مساء الخميس للصيانة الدورية.',audience_kind:'department',department_id:'hr',publish_on:today(),expires_on:addDays(today(),3),requires_ack:false,ack_reason:''})).id;
  const plain=announcementsBoard(db,users.hr).announcements.find(a=>a.id===plainId);
  tx(()=>approveAnnouncement(db,users.hr,plainId,{version:plain.version,note:'راجعت الإعلان قبل نشره'}));
  assert.throws(()=>tx(()=>acknowledgeAnnouncement(db,users.hr,plainId)),code('ack_not_required'));
  assert.equal(announcementsBoard(db,users.employee).announcements.find(a=>a.id===plainId),undefined,'a department notice stays in its department');
  assert.equal(announcementsBoard(db,users.hr).announcements.find(a=>a.id===plainId).reads,null,'an ordinary notice keeps no record of who read it');
  assert.ok(verifyAudit(db));
});

test('events: a simple calendar anyone in the audience can read, cancelled with a reason and never deleted',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>createEvent(db,users.employee,{title:'لقاء الفريق',event_date:today(),start_time:'',location:'',note:'',audience_kind:'all',department_id:''})),code('not_permitted'));
  assert.throws(()=>tx(()=>createEvent(db,users.hr,{title:'لقاء الفريق',event_date:today(),start_time:'9 صباحًا',location:'',note:'',audience_kind:'all',department_id:''})),code('start_time'));
  const eventId=tx(()=>createEvent(db,users.hr,{title:'اللقاء الشهري للفريق',event_date:addDays(today(),5),start_time:'09:30',location:'قاعة الاجتماعات',note:'حضور اختياري',audience_kind:'all',department_id:''})).id;
  assert.equal(announcementsBoard(db,users.employee).events.length,1);
  const event=announcementsBoard(db,users.hr).events.find(x=>x.id===eventId);
  assert.throws(()=>tx(()=>cancelEvent(db,users.hr,eventId,{version:event.version+2,reason:'نسخة قديمة'})),code('stale_version'));
  tx(()=>cancelEvent(db,users.hr,eventId,{version:event.version,reason:'تعارض مع موعد تسليم'}));
  const cancelled=announcementsBoard(db,users.employee).events.find(x=>x.id===eventId);
  assert.equal(cancelled.cancelled,true);
  assert.match(cancelled.cancelled_reason,/تعارض/);
  assert.throws(()=>tx(()=>cancelEvent(db,users.hr,eventId,{version:cancelled.version,reason:'مرة أخرى'})),code('already_cancelled'));
  assert.throws(()=>db.prepare('DELETE FROM internal_events WHERE id=?').run(eventId),/not deleted/);
  assert.equal(announcementsBoard(db,users.external).events.length,0);
  assert.ok(verifyAudit(db));
});
