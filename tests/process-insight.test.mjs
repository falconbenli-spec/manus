import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyAudit } from '../app/db.mjs';
import { insightBoard } from '../app/process-insight.mjs';
import { editRequest, setServiceSection, setServiceTarget } from '../app/workflow.mjs';
import { requestReopen, setReopenWindow } from '../app/request-closure.mjs';
import { fixture, code } from './request-transparency-fixture.mjs';

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const service=(board,name)=>board.services.find(s=>s.code===name);

test('process insight: the path really taken is read from the audit log and compared with the designed path, naming why requests deviated',t=>{
  const f=fixture(t,'insight-paths');f.grantInsight('manager');
  f.closed('employee');f.closed('outsider');
  const bounced=f.submitted('IT-SUPPORT');f.act('manager',bounced,'return','تجريبي: وضّحي الأثر');
  const rejected=f.submitted('IT-SUPPORT','outsider');f.act('manager',rejected,'reject','تجريبي: خارج نطاق الدعم');
  f.submitted('IT-SUPPORT');f.draft('IT-SUPPORT');

  const it=service(insightBoard(f.db,f.users.manager),'IT-SUPPORT');
  assert.equal(it.designed,'تقديم ← اعتماد ← مباشرة ← إغلاق');
  assert.equal(it.requests,5,'drafts are not process instances');
  assert.equal(it.conforming,3,'two finished on the designed path, and one still open is on it so far');
  assert.equal(it.deviated,2);assert.equal(it.deviated_percent,40);
  assert.deepEqual([it.deviation_causes.returned,it.deviation_causes.rejected,it.deviation_causes.reopened],[1,1,0]);
  assert.deepEqual(it.variants[0],{path:'تقديم ← اعتماد ← مباشرة ← إغلاق',count:2,designed:true});
  assert.ok(it.variants.some(v=>v.path==='تقديم ← إرجاع'&&!v.designed));
  assert.equal(service(insightBoard(f.db,f.users.manager,{service_code:'it-support'}),'IT-SUPPORT').requests,5);
  assert.equal(insightBoard(f.db,f.users.manager,{service_code:'HR-LETTER'}).services.length,0);
  assert.ok(verifyAudit(f.db));
});

test('process insight rework: how often a request bounces before approval, and which field the requester had to fix',t=>{
  const f=fixture(t,'insight-rework');f.grantInsight('manager');
  const id=f.submitted('IT-SUPPORT');f.act('manager',id,'return','تجريبي: الوصف ناقص');
  f.tx(()=>editRequest(f.db,f.users.employee,id,{version:f.version(id),title:'تجريبي: طلب IT-SUPPORT',payload:{issue:'تجريبي: تعذر الدخول إلى البريد من جهاز المكتب رقم 12',impact:'يؤخر العمل'}}));
  f.act('employee',id,'submit');f.act('manager',id,'return','تجريبي: الأثر غير دقيق');
  f.tx(()=>editRequest(f.db,f.users.employee,id,{version:f.version(id),title:'تجريبي: طلب IT-SUPPORT',payload:{issue:'تجريبي: تعذر الدخول إلى البريد من جهاز المكتب رقم 12',impact:'يمنع العمل'}}));
  f.act('employee',id,'submit');f.act('manager',id,'approve');
  const clean=f.submitted('IT-SUPPORT','outsider');f.act('manager',clean,'approve');

  const board=insightBoard(f.db,f.users.manager),rework=service(board,'IT-SUPPORT').rework;
  assert.equal(rework.reached_approval,2);assert.equal(rework.average_returns,1,'two bounces over two approved requests');
  assert.deepEqual(rework.fields,[{field:'وصف المشكلة',count:1},{field:'أثر المشكلة',count:1}].sort((a,b)=>b.count-a.count));
  assert.equal(board.requester_wait.segments,2,'time at the requester is counted apart from any department');
  assert.ok(verifyAudit(f.db));
});

test('process insight timing: adherence in working days on the service target, first-time-right, and no target means no verdict',t=>{
  const f=fixture(t,'insight-timing');f.grantInsight('manager');
  const id=f.closed('employee');f.closed('outsider');
  let it=service(insightBoard(f.db,f.users.manager),'IT-SUPPORT');
  assert.equal(it.timing.target_days,0);assert.equal(it.timing.measured,0);assert.match(it.timing.note,/لا زمن مستهدف/);

  f.tx(()=>{setServiceSection(f.db,f.users.admin,'IT-SUPPORT','الدعم التقني');setServiceTarget(f.db,f.users.admin,'IT-SUPPORT',3);});
  it=service(insightBoard(f.db,f.users.manager),'IT-SUPPORT');
  assert.deepEqual([it.timing.measured,it.timing.on_time,it.timing.late,it.timing.on_time_percent],[2,2,0,100]);
  assert.deepEqual(it.first_time_right,{completed:2,without_reopening:2});

  f.tx(()=>setReopenWindow(f.db,f.users.admin,{scope_code:'*',window_days:5,basis:'تجريبي: قرار مالك الإجراء',confirmed_on:today()}));
  f.tx(()=>requestReopen(f.db,f.users.employee,id,{version:f.version(id),reason:'تجريبي: عادت المشكلة في اليوم نفسه'}));
  it=service(insightBoard(f.db,f.users.manager),'IT-SUPPORT');
  assert.equal(it.deviation_causes.reopened,1);assert.ok(it.variants.some(v=>v.path.endsWith('إغلاق ← إعادة فتح')));
  assert.ok(insightBoard(f.db,f.users.manager).bottlenecks.some(b=>/إعادة عمل/.test(b.where)&&b.open_now===1),'rework shows as its own stage');

  // طلب مفتوح تجاوز زمنه يُعد متأخرًا وهو مفتوح، ولا يدخل نسبة الالتزام حتى يُغلق.
  f.submitted('IT-SUPPORT','outsider');
  t.mock.timers.enable({apis:['Date'],now:Date.now()+30*86400000});
  it=service(insightBoard(f.db,f.users.manager),'IT-SUPPORT');
  assert.ok(it.timing.late_open>=1);assert.equal(it.timing.on_time_percent,100);
  t.mock.timers.reset();
  assert.ok(verifyAudit(f.db));
});

test('process insight: a bottleneck is a step or a department, never a named person — in the data, the screen, and the code',t=>{
  const f=fixture(t,'insight-no-blame');
  assert.throws(()=>insightBoard(f.db,f.users.manager),code('not_permitted'));
  assert.throws(()=>insightBoard(f.db,f.users.employee),code('not_permitted'));
  f.grantInsight('manager');
  f.closed('employee');const waiting=f.submitted('HR-LETTER');f.act('manager',waiting,'approve');
  const board=insightBoard(f.db,f.users.manager),payload=JSON.stringify(board);
  assert.deepEqual(board.bottlenecks.map(b=>b.where).sort(),['اعتماد الموارد البشرية','اعتماد المدير المباشر','اعتماد المدير المباشر',
    'الإدارة المنفذة (الدعم التقني التجريبي) — بانتظار من يباشر','الإدارة المنفذة (الدعم التقني التجريبي) — تنفيذ'].sort());
  for(const b of board.bottlenecks){assert.ok(b.passes>=1);assert.ok(Number.isFinite(b.average_working_days)&&Number.isFinite(b.median_working_days));}
  for(const person of Object.values(f.users))assert.equal(payload.includes(person.name),false,`${person.id} is named in a performance board`);
  assert.equal(/actor|approver|assigned|requester_id/.test(payload),false,'no per-person field is even present');
  assert.match(board.blame_notice,/لا الأشخاص/);
  // القاعدة مكتوبة في الكود نفسه، والوحدة لا تقرأ اسم أي مستخدم.
  const source=readFileSync(new URL('../app/process-insight.mjs',import.meta.url),'utf8');
  assert.match(source,/لا يُنسب بطء لموظف باسمه/);assert.equal(/u\.name|\.name AS|JOIN users/.test(source),false);

  // نطاق التصريح: منح مقيَّد بإدارة يحصر اللوحة فيها، وكيان آخر لا يقرأ شيئًا.
  f.db.prepare("UPDATE access_grants SET department_id='hr' WHERE user_id='manager' AND capability='executive.view'").run();
  const scoped=insightBoard(f.db,f.users.manager);
  assert.deepEqual(scoped.services.map(s=>s.code),['HR-LETTER']);assert.deepEqual(scoped.scope,['خدمات الموظف التجريبية']);
  // المانح غير الممنوح — قيد الترحيل 144؛ التهيئة كانت تكتب الاثنين واحدًا وهي حالة لا تقع.
  f.db.prepare("INSERT INTO access_grants(id,tenant_id,user_id,capability,note,granted_by,granted_at) VALUES('g-ext','isolated','external','executive.view','تجريبي','admin',?)").run(new Date().toISOString());
  assert.equal(insightBoard(f.db,f.users.external).totals.requests,0,'tenant isolation');
  assert.ok(verifyAudit(f.db));
});
