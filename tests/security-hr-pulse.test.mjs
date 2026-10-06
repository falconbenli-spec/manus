import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import {
  setSurveyPrivacy, createCycle, editCycle, approveCycle, closeCycle, submitPulse, pulseBoard,
  draftAnnouncement, approveAnnouncement, acknowledgeAnnouncement
} from '../app/engagement.mjs';

// إثبات إغلاق ثغرات استبيان النبض والإعلانات (مراجعة الأمن 2026-09-18، الترحيل 091 القسم ج). كل البيانات مصطنعة.
const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const addDays=(iso,days)=>new Date(Date.parse(`${iso}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
const Q=[{kind:'scale',prompt:'أجد في عملي معنى واضحًا'},{kind:'enps',prompt:'إلى أي مدى ترشح الشركة'},{kind:'comment',prompt:'ما الذي تغيره لو استطعت'}];

function fixture(t,minimum=5){
  const db=openDb(':memory:');seed(db,'synthetic-security-pulse');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.survey.manage',department_id:null,note:'فصل المهام التجريبي'}));
  if(minimum)tx(()=>setSurveyPrivacy(db,users.hr,{min_respondents:minimum,effective_from:today(),basis:'قرار مدير الموارد البشرية التجريبي'}));
  const board=(u,id)=>pulseBoard(db,u).cycles.find(c=>c.id===id);
  const open=(closes=today(),questions=Q)=>{
    const id=tx(()=>createCycle(db,users.hr,{title:`نبض ${Math.random()}`,purpose:'',opens_on:today(),closes_on:closes,questions})).id;
    tx(()=>approveCycle(db,users.manager,id,{version:board(users.hr,id).version,note:'اعتماد الفتح'}));return id;
  };
  const answer=(id,uid,vals)=>{const c=board(users[uid],id);
    tx(()=>submitPulse(db,users[uid],id,{answers:c.questions.map((q,i)=>({question_id:q.id,value:q.kind==='comment'?null:vals[i],comment:q.kind==='comment'?(vals[i]??''):''}))}));};
  const close=id=>{tx(()=>closeCycle(db,users.hr,id,{version:board(users.hr,id).version,note:'انتهت المدة'}));return board(users.hr,id);};
  return {db,users,tx,board,open,answer,close};
}

test('pulse minimum: five respondents at least, refused in code and by a trigger on the setting and on opening a cycle',t=>{
  const {db,users,tx}=fixture(t,null);
  for(const min of [2,3,4])assert.throws(()=>tx(()=>setSurveyPrivacy(db,users.hr,{min_respondents:min,effective_from:today(),basis:'حد أدنى أقل من خمسة'})),code('min_respondents'));
  assert.throws(()=>db.prepare("INSERT INTO survey_privacy_settings(id,tenant_id,min_respondents,effective_from,basis,set_by,created_at) VALUES('p2','36t',2,?,'حد اثنين مباشرة في القاعدة','hr',?)").run(today(),today()),/at least five/);
  // إعداد قديم بحد اثنين (قبل الترحيل): الدورة تُفتح بالأدنى خمسة، والقاعدة ترفض فتحها بأقل.
  db.exec('DROP TRIGGER survey_privacy_floor');
  db.prepare("INSERT INTO survey_privacy_settings(id,tenant_id,min_respondents,effective_from,basis,set_by,created_at) VALUES('legacy','36t',2,?,'إعداد قديم بحد اثنين قبل الترحيل','hr',?)").run(today(),today());
  const id=tx(()=>createCycle(db,users.hr,{title:'نبض بإعداد قديم',purpose:'',opens_on:today(),closes_on:today(),questions:Q})).id;
  assert.throws(()=>db.prepare("UPDATE pulse_cycles SET status='open',opened_by='manager',opened_at='x',min_respondents=2,privacy_setting_id='legacy',version=version+1 WHERE id=?").run(id),/at least five/);
  tx(()=>approveCycle(db,users.manager,id,{version:pulseBoard(db,users.hr).cycles.find(c=>c.id===id).version,note:'فتح بإعداد قديم'}));
  assert.equal(db.prepare('SELECT min_respondents FROM pulse_cycles WHERE id=?').get(id).min_respondents,5,'a legacy setting below the floor opens at the floor');
});

test('pulse early close: a cycle is not closed before its announced closing date — in code and by a trigger — so two answers cannot be read by closing at once',t=>{
  const {db,users,tx,board,open,answer}=fixture(t);
  const id=open(addDays(today(),3));
  answer(id,'hr',[3,7,'تعليق مدير الموارد البشرية']);answer(id,'employee',[1,2,'مديري يتنمر علينا في الاجتماعات']);
  assert.ok(!board(users.hr,id).actions.includes('close_cycle'),'close is not offered before the closing date');
  assert.throws(()=>tx(()=>closeCycle(db,users.hr,id,{version:board(users.hr,id).version,note:'إغلاق فوري بعد إجابتين'})),code('closes_later'));
  assert.throws(()=>db.prepare("UPDATE pulse_cycles SET status='closed',closed_by='hr',closed_at='x',version=version+1 WHERE id=?").run(id),/before its closing date/);
  assert.equal(board(users.hr,id).results.available,false);
  assert.ok(!JSON.stringify(board(users.hr,id)).includes('يتنمر'));
  assert.ok(verifyAudit(db));
});

test('pulse reconstruction: when the distribution is withheld, the average and eNPS are withheld with it',t=>{
  const {users,open,answer,close}=fixture(t);
  const id=open();
  for(const u of ['manager','employee','outsider','hr'])answer(id,u,[5,10,'']);
  answer(id,'it',[1,5,'']);
  const [scale,enps]=close(id).results.questions;
  assert.equal(scale.bands_withheld,true);assert.equal(scale.average,null,'4.2 over five answers would name the lone 1');
  assert.equal(enps.bands_withheld,true);assert.equal(enps.enps,null);assert.equal(enps.average,null);
  assert.equal(scale.answered,5,'the head count alone reveals no band');
  void users;
});

test('pulse SoD: whoever edits the questions becomes their preparer and cannot open the cycle',t=>{
  const {db,users,tx,board}=fixture(t);
  const id=tx(()=>createCycle(db,users.hr,{title:'نبض الفصل',purpose:'',opens_on:today(),closes_on:today(),questions:Q})).id;
  tx(()=>editCycle(db,users.manager,id,{version:board(users.manager,id).version,title:'نبض معدل',purpose:'',opens_on:today(),closes_on:today(),questions:[{kind:'comment',prompt:'ما رأيك في مديرك المباشر فلان تحديدًا؟'}]}));
  assert.equal(db.prepare('SELECT prepared_by FROM pulse_cycles WHERE id=?').get(id).prepared_by,'manager');
  assert.ok(!board(users.manager,id).actions.includes('approve_cycle'));
  assert.throws(()=>tx(()=>approveCycle(db,users.manager,id,{version:board(users.manager,id).version,note:'فتحته بنفسي'})),code('separation_of_duties'));
  tx(()=>approveCycle(db,users.hr,id,{version:board(users.hr,id).version,note:'راجعت ما عدّله الزميل'}));
  assert.equal(db.prepare('SELECT opened_by FROM pulse_cycles WHERE id=?').get(id).opened_by,'hr');
  assert.ok(verifyAudit(db));
});

test('announcements: acknowledging a notice outside your audience answers «not found», not «forbidden»',t=>{
  const {db,users,tx}=fixture(t);
  const id=tx(()=>draftAnnouncement(db,users.hr,{title:'إعلان للإدارة التقنية',body:'نص إعلان تجريبي للإدارة التقنية فقط',audience_kind:'department',department_id:'it',publish_on:today(),expires_on:addDays(today(),5),requires_ack:true,ack_reason:'سياسة تقنية تلزم الإقرار'})).id;
  tx(()=>approveAnnouncement(db,users.manager,id,{version:1,note:'اعتماد النشر التجريبي'}));
  assert.throws(()=>tx(()=>acknowledgeAnnouncement(db,users.employee,id)),error=>error.code==='not_found'&&error.status===404);
  tx(()=>acknowledgeAnnouncement(db,users.it,id));
});
