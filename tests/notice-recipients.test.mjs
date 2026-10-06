import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { timesheetNotice, missionNotice } from '../app/module-notices.mjs';
import { resolveRecipient, deliverSubject, undeliverableBoard, resolveUndeliverable } from '../app/notice-recipients.mjs';
import { workflowControl } from '../app/workflow-sweep.mjs';
import { obligations } from '../app/obligations.mjs';
import { clearInboxCache } from '../app/inbox.mjs';

// العطب 10: إشعار بلا مستلم كان يسقط صامتًا (notifySubject يعيد null)، و25 من 28 موظفًا بلا مدير مباشر. كل ما هنا مصطنع.
const code=value=>error=>error.code===value;
function fixture(t,{catalog=true}={}){
  const db=openDb(':memory:');seed(db,'synthetic-notice-recipients');if(catalog)installServiceCatalog(db);t.after(()=>db.close());
  const tx=f=>transaction(db,f),user=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const sheet=userId=>({id:`ts-${userId}`,user_id:userId,week_start:'2026-09-13',week_end:'2026-09-17'});
  const notes=(who,kind)=>db.prepare('SELECT * FROM notifications WHERE user_id=? AND kind=?').all(who,kind);
  return {db,tx,user,sheet,notes};
}

test('defect 10: a decision notice for an employee with no manager reaches the department head, and says why it reached him',t=>{
  const {db,tx,user,sheet,notes}=fixture(t);
  assert.equal(user('hr').manager_id,null,'this employee has no direct manager, like 25 of the 28');
  tx(()=>timesheetNotice(db,user('hr'),'submitted',sheet('hr')));
  const got=notes('head-hr','timesheet_decision_needed');
  assert.equal(got.length,1,'before the fix this notice reached nobody and nothing recorded that');
  assert.match(got[0].body,/وصلك هذا الإشعار لأن لا مدير مباشر نشط مسجلًا لصاحب السجل، وأنت مدير إدارته/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM undeliverable_notices').get().n,0);
  // من له مدير نشط: يصله كما كان، بلا جملة «لماذا وصلك».
  tx(()=>timesheetNotice(db,user('employee'),'submitted',sheet('employee')));
  const direct=notes('manager','timesheet_decision_needed');assert.equal(direct.length,1);assert.doesNotMatch(direct[0].body,/وصلك هذا الإشعار/);
});

test('defect 10: past the department head it climbs the registered escalation ladder — never to the actor, never to the subject himself',t=>{
  const {db,tx,user,sheet,notes}=fixture(t);
  // مدير الإدارة نفسه صاحب السجل: لا يستلم قرارًا على سجله؛ يصل مرجع تصعيد إدارته.
  tx(()=>timesheetNotice(db,user('head-hr'),'submitted',sheet('head-hr')));
  const up=notes('vp-corporate','timesheet_decision_needed');assert.equal(up.length,1);assert.match(up[0].body,/وأنت مرجع تصعيد الإدارة/);
  assert.equal(notes('head-hr','timesheet_decision_needed').length,0);
  // مدير موقوف الحساب: لا يُرسل إليه؛ يصعد.
  db.prepare("UPDATE users SET active=0 WHERE id='manager'").run();
  assert.equal(resolveRecipient(db,{tenantId:'36t',userId:'manager',exclude:['employee']}).via,'escalation','creative has no other head, so its registered reference receives it');
  tx(()=>missionNotice(db,user('employee'),'requested',{id:'m-1',user_id:'employee',from_date:'2026-09-20',to_date:'2026-09-21'}));
  assert.equal(notes('vp-growth','mission_decision_needed').length,1);assert.equal(notes('manager','mission_decision_needed').length,0);
});

test('defect 10: when nobody at all can receive it, it is recorded where the structure manager sees it — without the notice text — and reaches «أقرّر»',t=>{
  const {db,tx,user,sheet}=fixture(t,{catalog:false});
  // البذرة الأساسية: إدارة خدمات الموظف بلا مدير وبلا مرجع تصعيد.
  tx(()=>timesheetNotice(db,user('hr'),'submitted',sheet('hr')));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='timesheet_decision_needed'").get().n,0);
  const rows=db.prepare('SELECT * FROM undeliverable_notices').all();
  assert.equal(rows.length,1,'not dropped silently');assert.equal(rows[0].kind,'timesheet_decision_needed');assert.equal(rows[0].department_id,'hr');
  const tried=JSON.parse(rows[0].tried);assert.deepEqual(tried.map(x=>x.step),['intended','department_head','escalation']);
  const board=undeliverableBoard(db,user('admin'));
  assert.equal(board.open_count,1);assert.equal(JSON.stringify(board).includes('كشف ساعات ينتظر'),false,'the notice text is not shown to whoever manages the structure');
  assert.equal(undeliverableBoard(db,user('manager')).visible,false);assert.equal(workflowControl(db,user('admin')).undeliverable.open_count,1);
  clearInboxCache();
  assert.ok(obligations(db,user('admin'),{watching:false}).items.some(i=>i.id===rows[0].id&&i.bucket==='decide'),'the new queue is in «ما عليّ»');
  assert.throws(()=>tx(()=>resolveUndeliverable(db,user('manager'),rows[0].id,{note:'عُيّن مدير للإدارة التجريبية'})),code('not_permitted'));
  tx(()=>resolveUndeliverable(db,user('admin'),rows[0].id,{note:'عُيّن مدير للإدارة التجريبية'}));
  assert.equal(undeliverableBoard(db,user('admin')).open_count,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM undeliverable_notices').get().n,1,'the row itself is kept');
  assert.throws(()=>tx(()=>resolveUndeliverable(db,user('admin'),rows[0].id,{note:'قرار ثانٍ على الإشعار نفسه'})),code('decided'));
  assert.ok(verifyAudit(db));
});

test('defect 10: an unknown notice subject is a programmer error — loud under test, never a silent null',t=>{
  const {db,tx}=fixture(t,{catalog:false});
  assert.throws(()=>tx(()=>deliverSubject(db,{tenantId:'36t',userId:'manager',kind:'made_up',subjectKind:'no_such_subject',subjectId:'x',title:'عنوان تجريبي'})),/موضوع إشعار غير معروف/);
});
