import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { hrCasesBoard, getCase, fileCase, caseAction, setCaseTarget, submitAnonymousReport, followAnonymousReport, replyAnonymousReport, reportAction } from '../app/hr-cases.mjs';

const code=value=>error=>error.code===value;
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-hr-cases-comp');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  // معالج ثانٍ بمنح صريح، حتى تُختبر حالة المعالج الذي هو نفسه طرف.
  db.prepare("INSERT INTO access_grants(id,tenant_id,user_id,capability,note,granted_by,granted_at) VALUES('g-it-cases','36t','it','hr.cases.handle','تجريبي','admin',?)").run(new Date().toISOString());
  const complaint={category:'complaint',subject:'شكوى تجريبية',description:'وصف تجريبي لسلوك متكرر في الاجتماعات الأسبوعية للفريق',respondent_id:'manager'};
  return {db,users,tx,complaint};
}

test('hr case: the direct manager named in a complaint never sees it, and anyone outside the case gets 404 rather than 403',t=>{
  const {db,users,tx,complaint}=fixture(t);
  const {id}=tx(()=>fileCase(db,users.employee,complaint));
  for(const who of ['manager','outsider','external']){
    assert.throws(()=>getCase(db,users[who],id),code('not_found'),`${who} must not learn the case exists`);
    assert.throws(()=>tx(()=>caseAction(db,users[who],id,'add_info',{version:1,body:'محاولة'})),code('not_found'));
  }
  const managerBoard=hrCasesBoard(db,users.manager);
  assert.equal([...managerBoard.my_cases,...managerBoard.handling,...managerBoard.intake].length,0);
  assert.ok(!JSON.stringify(managerBoard).includes(id));
  // الاستلام يكشف الفئة والتاريخ فقط حتى يتولى أحدهم الحالة.
  const intake=hrCasesBoard(db,users.hr).intake.find(c=>c.id===id);
  assert.equal(intake.triage,true);assert.equal(intake.description,undefined);assert.equal(intake.respondent_name,undefined);assert.equal(intake.reporter_name,undefined);
  tx(()=>caseAction(db,users.hr,id,'take_case',{version:1}));
  assert.equal(getCase(db,users.hr,id).description,complaint.description);
  assert.throws(()=>getCase(db,users.it,id),code('not_found'),'another handler loses sight once it is assigned');
  assert.equal(getCase(db,users.employee,id).assignee_name,users.hr.name);
  assert.ok(verifyAudit(db));
});

test('hr case: a handler who is the subject of a complaint cannot see it, take it or receive it, in code and in SQL',t=>{
  const {db,users,tx,complaint}=fixture(t);
  const {id}=tx(()=>fileCase(db,users.employee,{...complaint,respondent_id:'hr'}));
  assert.ok(!hrCasesBoard(db,users.hr).intake.some(c=>c.id===id),'the respondent does not see the case in intake');
  assert.throws(()=>tx(()=>caseAction(db,users.hr,id,'take_case',{version:1})),code('not_found'));
  tx(()=>caseAction(db,users.it,id,'take_case',{version:1}));
  const c=getCase(db,users.it,id);
  assert.ok(!c.reassign_candidates.some(x=>x.id==='hr'));
  assert.throws(()=>tx(()=>caseAction(db,users.it,id,'reassign_case',{version:c.version,assignee_id:'hr',reason:'نقل تجريبي للمعالج الآخر'})),code('conflict_of_interest'));
  assert.throws(()=>db.prepare("UPDATE hr_cases SET assignee_id='hr',version=version+1 WHERE id=?").run(id),/CHECK constraint/);
  assert.throws(()=>tx(()=>fileCase(db,users.employee,{...complaint,respondent_id:'employee'})),code('respondent_id'));
  assert.ok(verifyAudit(db));
});

test('hr case: every decision carries its reason, internal notes stay internal, a stale version is refused, and a closed case is final',t=>{
  const {db,users,tx,complaint}=fixture(t);
  assert.throws(()=>tx(()=>setCaseTarget(db,users.employee,{category:'complaint',target_working_days:10,effective_from:'2026-01-01',basis:'قرار تجريبي لمدير الموارد البشرية'})),code('not_permitted'));
  tx(()=>setCaseTarget(db,users.hr,{category:'complaint',target_working_days:10,effective_from:'2026-01-01',basis:'قرار تجريبي لمدير الموارد البشرية'}));
  const {id}=tx(()=>fileCase(db,users.employee,complaint));
  assert.ok(getCase(db,users.employee,id).target_due_on,'the target date comes from the dated setting, not a constant');
  const noTarget=tx(()=>fileCase(db,users.employee,{...complaint,category:'inquiry',respondent_id:''}));
  assert.equal(getCase(db,users.employee,noTarget.id).target_due_on,null,'no setting, no invented deadline');
  tx(()=>caseAction(db,users.hr,id,'take_case',{version:1}));
  assert.throws(()=>tx(()=>caseAction(db,users.hr,id,'note_case',{version:1,body:'ملاحظة'})),code('stale_version'));
  tx(()=>caseAction(db,users.hr,id,'note_case',{version:2,body:'ملاحظة داخلية تجريبية لا يراها صاحب الحالة'}));
  tx(()=>caseAction(db,users.hr,id,'reply_case',{version:3,body:'تم الاستماع إلى الطرفين'}));
  assert.throws(()=>tx(()=>caseAction(db,users.hr,id,'decide_case',{version:4,decision:'إنذار كتابي'})),code('invalid_text'));
  tx(()=>caseAction(db,users.hr,id,'decide_case',{version:4,decision:'إنذار كتابي',reason:'ثبتت الواقعة بشهادة زميلين تجريبيين'}));
  const seen=getCase(db,users.employee,id).events;
  assert.ok(!seen.some(ev=>ev.body.includes('ملاحظة داخلية')));assert.ok(seen.some(ev=>ev.kind==='decision'&&ev.body.includes('السبب')));
  assert.throws(()=>tx(()=>caseAction(db,users.employee,id,'close_case',{version:5,outcome:'resolved',reason:'أغلقها بنفسي تجريبيًا'})),code('invalid_state'),'the reporter does not decide the outcome');
  tx(()=>caseAction(db,users.hr,id,'close_case',{version:5,outcome:'resolved',reason:'عولجت بالقرار الموثق أعلاه'}));
  const closed=getCase(db,users.employee,id);assert.equal(closed.status,'closed');assert.deepEqual(closed.actions,[]);
  assert.throws(()=>tx(()=>caseAction(db,users.hr,id,'reply_case',{version:6,body:'إضافة بعد الإغلاق'})),code('invalid_state'));
  assert.throws(()=>db.prepare("UPDATE hr_cases SET closing_reason='تعديل صامت بعد الإغلاق',version=version+1 WHERE id=?").run(id),/closed case is final/);
  assert.throws(()=>db.prepare("INSERT INTO hr_case_events VALUES('x','36t',?,'hr','note','إضافة صامتة',0,'2026-01-01T00:00:00.000Z')").run(id),/closed case/);
  const filed=db.prepare("SELECT * FROM audit_events WHERE entity_id=? AND action='hr_case.filed'").get(id);
  assert.equal(filed.after_json,'{}','the audit trail does not carry the category or the respondent');
  assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE entity_id=? AND action='hr_case.close_case' AND reason<>''").get(id));
  assert.ok(verifyAudit(db));
});

test('anonymous report: no stored column or audit row can lead back to the reporter, and only the token holder can follow it',t=>{
  const {db,users,tx}=fixture(t);
  const auditBefore=db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,idemBefore=db.prepare('SELECT COUNT(*) AS n FROM idempotency_keys').get().n;
  const {token,...rest}=tx(()=>submitAnonymousReport(db,users.employee,{body:'بلاغ تجريبي عن تلاعب في مطالبات المصروفات لدى أحد الفرق',respondent_id:'hr'}));
  assert.deepEqual(Object.keys(rest),['notice'],'no record id is returned that could be logged next to the session');
  tx(()=>replyAnonymousReport(db,users.employee,{token,body:'إضافة تجريبية من المبلغ'}));
  followAnonymousReport(db,users.employee,{token});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,auditBefore,'submitting, adding and following write no audit row');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM idempotency_keys').get().n,idemBefore);
  // الهوية غير قابلة للاسترجاع: لا عمود يشير إلى صاحب البلاغ، ولا قيمة مخزنة تساوي معرّفه أو اسمه أو الرمز نفسه.
  const report=db.prepare('SELECT * FROM anonymous_reports').get(),messages=db.prepare('SELECT * FROM anonymous_report_messages').all();
  const stored=JSON.stringify([report,messages]);
  for(const value of [users.employee.id,users.employee.name,users.employee.username,token])assert.ok(!stored.includes(`"${value}"`),`stored rows reveal ${value}`);
  assert.equal(report.token_hash,hash(token));
  assert.match(report.received_on,/^\d{4}-\d{2}-\d{2}$/,'day only, no timestamp to match against sessions');
  const columns=db.prepare("SELECT name FROM pragma_table_info('anonymous_reports') UNION ALL SELECT name FROM pragma_table_info('anonymous_report_messages')").all().map(c=>c.name);
  assert.ok(!columns.some(c=>/reporter|submitted_by|created_by|user_id|created_at/.test(c)),columns.join(','));
  assert.equal(messages[0].author_id,null);
  // المذكور في البلاغ لا يراه؛ معالج آخر يتولاه.
  assert.equal(hrCasesBoard(db,users.hr).anonymous_reports.length,0);
  assert.equal(hrCasesBoard(db,users.manager).anonymous_reports.length,0,'no one without the capability sees reports');
  const r=hrCasesBoard(db,users.it).anonymous_reports[0];
  assert.throws(()=>tx(()=>reportAction(db,users.hr,r.id,'take_report',{version:1})),code('not_found'));
  tx(()=>reportAction(db,users.it,r.id,'take_report',{version:1}));
  tx(()=>reportAction(db,users.it,r.id,'reply_report',{version:2,body:'استلمنا البلاغ ونراجع المطالبات'}));
  assert.ok(followAnonymousReport(db,users.outsider,{token}).messages.some(m=>m.side==='handler'),'the token alone gives access, whoever holds it');
  assert.throws(()=>followAnonymousReport(db,users.employee,{token:'x'.repeat(32)}),code('not_found'));
  assert.throws(()=>followAnonymousReport(db,users.external,{token}),code('not_found'),'tenant isolation holds for tokens too');
  tx(()=>reportAction(db,users.it,r.id,'close_report',{version:3,outcome:'insufficient_information',reason:'لم تكفِ المعلومات للتحقق من الواقعة'}));
  assert.throws(()=>tx(()=>replyAnonymousReport(db,users.employee,{token,body:'بعد الإغلاق'})),code('invalid_state'));
  assert.throws(()=>db.prepare("UPDATE anonymous_reports SET closing_reason='تعديل صامت بعد الإغلاق',version=version+1").run(),/closed report is final/);
  assert.ok(!db.prepare("SELECT 1 FROM audit_events WHERE entity_type='anonymous_report' AND actor_id=?").get(users.employee.id));
  assert.ok(verifyAudit(db));
});
