import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import { experienceQuestion, answerExperience, experienceSummary, setExperienceThreshold, bucketOf, QUESTION } from '../app/service-experience.mjs';
import { recordFeedback } from '../app/service-feedback.mjs';
import { fixture, code } from './request-transparency-fixture.mjs';

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const threshold=(min=3)=>({min_responses:min,basis:'تجريبي: قرار مالك الإجراء حمايةً لصاحب الرأي',confirmed_on:today()});
const answer=(f,user,id,choice,comment='')=>f.tx(()=>answerExperience(f.db,f.users[user],id,{version:f.version(id),answer:choice,comment}));

test('experience: one question with three options after closure — not a survey — answered once by the requester alone',t=>{
  const f=fixture(t,'experience-question'),open=f.inProgress(),id=f.closed();
  const question=experienceQuestion(f.db,f.users.employee,id);
  assert.equal(question.question,QUESTION);assert.deepEqual(question.options.map(o=>o.value),['met','partly','not_met']);assert.equal(question.can_answer,true);
  assert.equal(experienceQuestion(f.db,f.users.employee,open).can_answer,false,'no question before the request is closed');
  assert.equal(experienceQuestion(f.db,f.users.it,id).can_answer,false,'the handler does not rate their own work');
  assert.throws(()=>answer(f,'it',id,'met'),code('forbidden'));
  assert.throws(()=>answer(f,'external',id,'met'),code('not_found'),'tenant isolation');
  assert.throws(()=>answer(f,'employee',id,'excellent'),code('answer'));
  assert.throws(()=>answer(f,'employee',id,'not_met'),code('invalid_text'),'“no” needs one line saying what was missing');
  assert.throws(()=>f.tx(()=>answerExperience(f.db,f.users.employee,id,{version:f.version(id)+1,answer:'met'})),code('version_conflict'));

  const saved=answer(f,'employee',id,'partly');
  assert.equal(saved.answered.answer,'partly');assert.equal(saved.can_answer,false);
  assert.throws(()=>answer(f,'employee',id,'met'),code('already_rated'),'the answer is not replaced');
  // البناء على الوحدة القائمة: سجل واحد للرأي لا سجلان.
  assert.deepEqual(f.db.prepare('SELECT rating FROM request_feedback WHERE request_id=?').all(id).map(r=>r.rating),[3]);
  assert.deepEqual([5,4,3,2,1].map(bucketOf),['met','met','partly','not_met','not_met'],'ratings from the older five-point screen stay readable');
  assert.ok(verifyAudit(f.db));
});

test('experience summary: nothing aggregated is shown below the owner-set minimum, and no opinion is ever tied to a person',t=>{
  const f=fixture(t,'experience-summary');
  const first=f.closed('employee'),second=f.closed('outsider');
  answer(f,'employee',first,'met','تجريبي: حُلّت المشكلة سريعًا');answer(f,'outsider',second,'not_met','تجريبي: عادت المشكلة بعد يوم');

  assert.throws(()=>experienceSummary(f.db,f.users.manager),code('not_permitted'),'a manager without the grant reads no satisfaction numbers');
  assert.throws(()=>experienceSummary(f.db,f.users.employee),code('not_permitted'));
  f.grantInsight('manager');
  const unset=experienceSummary(f.db,f.users.manager);
  assert.equal(unset.available,false);assert.deepEqual(unset.groups,[]);assert.match(unset.reason,/الحد الأدنى/);

  assert.throws(()=>f.tx(()=>setExperienceThreshold(f.db,f.users.manager,threshold())),code('not_permitted'));
  assert.throws(()=>f.tx(()=>setExperienceThreshold(f.db,f.users.admin,threshold(2))),code('min_responses'),'two answers in a team of three name the respondent');
  assert.throws(()=>f.db.prepare("INSERT INTO experience_settings VALUES('x','36t',2,'تجريبي: سند طويل بما يكفي',?, 'admin',?,NULL)").run(today(),new Date().toISOString()),/CHECK/,'the floor holds in SQL too');
  f.tx(()=>setExperienceThreshold(f.db,f.users.admin,threshold(3)));

  const hidden=experienceSummary(f.db,f.users.manager);
  assert.equal(hidden.available,true);assert.deepEqual(hidden.groups,[]);assert.equal(hidden.suppressed,1,'two answers stay folded');
  assert.equal(JSON.stringify(hidden).includes('عادت المشكلة'),false,'and so do their comments');

  const third=f.closed('employee');answer(f,'employee',third,'met');
  const shown=experienceSummary(f.db,f.users.manager);
  assert.equal(shown.groups.length,1);
  assert.deepEqual([shown.groups[0].answers,shown.groups[0].met,shown.groups[0].partly,shown.groups[0].not_met,shown.groups[0].met_percent],[3,2,0,1,67]);
  assert.equal(experienceSummary(f.db,f.users.manager,{group_by:'department'}).groups[0].label,'الدعم التقني التجريبي');
  // لا اسم ولا معرّف لصاحب رأي أو منفّذ في أي مخرج مجمّع.
  const payload=JSON.stringify([shown,experienceSummary(f.db,f.users.manager,{group_by:'department'})]);
  // في seed التجريبي يتطابق معرّفا الحسابين hr وit مع معرّفي إدارتيهما، فيُستثنيان من فحص المعرّف ويبقى فحص الاسم.
  const departmentIds=new Set(f.db.prepare('SELECT id FROM departments').all().map(d=>d.id));
  for(const person of Object.values(f.users))assert.equal(payload.includes(person.name)||!departmentIds.has(person.id)&&payload.includes(`"${person.id}"`),false,`${person.id} appears in an aggregate`);
  assert.equal(/assigned|requester_id|user_id/.test(payload),false,'no per-person dimension exists to group by');

  // تقييم خماسي قديم مسجَّل من الشاشة القائمة يُقرأ ضمن النتيجة ولا يُهدر.
  const legacy=f.closed('outsider');f.tx(()=>recordFeedback(f.db,f.users.outsider,legacy,{version:f.version(legacy),rating:4,comment:''}));
  assert.equal(experienceSummary(f.db,f.users.manager).groups[0].met,3);

  // العزل بين الكيانات: حساب من كيان آخر، حتى بتصريحه، لا يقرأ إجابة واحدة من هنا.
  // المانح غير الممنوح — قيد الترحيل 144؛ التهيئة كانت تكتب الاثنين واحدًا وهي حالة لا تقع.
  f.db.prepare("INSERT INTO access_grants(id,tenant_id,user_id,capability,note,granted_by,granted_at) VALUES('g-ext','isolated','external','executive.view','تجريبي','admin',?)").run(new Date().toISOString());
  assert.equal(experienceSummary(f.db,f.users.external).answers,0);
  assert.throws(()=>f.db.prepare('UPDATE experience_settings SET min_responses=50 WHERE superseded_at IS NULL').run(),/not edited/);
  assert.ok(verifyAudit(f.db));
});
