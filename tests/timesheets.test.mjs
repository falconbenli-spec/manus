import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { logTime } from '../app/agency.mjs';
import { timesheetsBoard, getPeriod, submitTimesheet, decideTimesheet, logCorrection, setLockWindow, lockDuePeriods, remindMissing, markReminderRead } from '../app/timesheets.mjs';
import { weekStart, weekEnd, addDays } from '../app/resource-weeks.mjs';
import { timesheetsUI } from '../app/static/resourcing-ui.mjs';

const code=expected=>error=>error.code===expected;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-timesheets');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع تجريبي للساعات',brief:'موجز تجريبي مصطنع',member_ids:['employee','outsider']}));
  const log=(who,date,minutes=120,billable=true)=>tx(()=>logTime(db,users[who],{project_id:project.id,work_date:date,minutes,billable,note:'عمل تجريبي مصطنع'}));
  return {db,users,tx,project,log};
}

test('timesheets: a week is submitted by the person who worked it and decided by their manager; nobody approves their own week, and SQL refuses it even if the code is bypassed',t=>{
  const {db,users,tx,log}=fixture(t);
  const day=today(),week=weekStart(day);
  assert.throws(()=>tx(()=>submitTimesheet(db,users.employee,{week_start:week,note:''})),code('empty_week'),'a week with no hours is not a week');
  const entry=log('employee',day);
  assert.throws(()=>tx(()=>submitTimesheet(db,users.employee,{week_start:addDays(week,1),note:''})),code('week_start'),'the week starts on Sunday');
  const submitted=tx(()=>submitTimesheet(db,users.employee,{week_start:week,note:'أسبوع مكتمل'}));
  assert.equal(submitted.status,'submitted');
  assert.throws(()=>tx(()=>submitTimesheet(db,users.employee,{week_start:week,note:''})),code('not_open'),'a week is submitted once');

  // لا تصريح اعتماد لأي دور آخر، والمالك نفسه لا يعتمد.
  for(const who of ['employee','outsider','hr','it','external'])
    assert.throws(()=>tx(()=>decideTimesheet(db,users[who],submitted.id,'approve',{version:submitted.version,note:'',entries:[{entry_id:entry.id,billable:true}]})));
  assert.throws(()=>tx(()=>decideTimesheet(db,users.admin,submitted.id,'return',{version:submitted.version,note:'قرار غير مسموح لحساب المنصة'})),code('forbidden'));

  // القيد في قاعدة البيانات لا في الكود وحده: صف يعتمده صاحبه مرفوض أصلًا.
  assert.throws(()=>db.prepare("INSERT INTO timesheet_periods(id,tenant_id,user_id,week_start,week_end,status,approved_by,approved_at,created_at,updated_at) VALUES('self','36t','employee',?,?,'approved','employee',?,?,?)")
    .run(addDays(week,-14),addDays(week,-8),now(),now(),now()),/CHECK constraint failed/);

  const approved=tx(()=>decideTimesheet(db,users.manager,submitted.id,'approve',{version:submitted.version,note:'اعتماد تجريبي',entries:[{entry_id:entry.id,billable:true}]}));
  assert.equal(approved.status,'approved');
  assert.equal(approved.approved_by,'manager');
  assert.ok(verifyAudit(db));
});

test('timesheets: billable is the approver’s determination, and what the logger claimed is kept beside it rather than overwritten silently',t=>{
  const {db,users,tx,log}=fixture(t);
  const day=today(),week=weekStart(day);
  // اليوم السابق قد يقع في الأسبوع الماضي إن كان اليوم بداية الأسبوع (الأحد)؛ يبقى السجلان داخل الأسبوع نفسه.
  const secondDay=day===week?day:addDays(day,-1);
  const claimed=log('employee',day,120,true),other=log('employee',secondDay,60,true);
  const submitted=tx(()=>submitTimesheet(db,users.employee,{week_start:week,note:''}));
  assert.throws(()=>tx(()=>decideTimesheet(db,users.manager,submitted.id,'approve',{version:submitted.version,note:'',entries:[{entry_id:claimed.id,billable:true}]})),code('entries'),'every entry in the week needs a determination');
  const approved=tx(()=>decideTimesheet(db,users.manager,submitted.id,'approve',{version:submitted.version,note:'اعتماد مع تعديل قابلية الفوترة',
    entries:[{entry_id:claimed.id,billable:false},{entry_id:other.id,billable:true}]}));
  assert.equal(approved.billable_minutes,60,'only what the approver marked billable counts');
  assert.equal(approved.minutes,180);
  const decision=db.prepare('SELECT * FROM timesheet_entry_decisions WHERE entry_id=?').get(claimed.id);
  assert.equal(decision.claimed_billable,1,'the logger’s claim is retained');
  assert.equal(decision.billable,0,'the approver’s determination is what stands');
  assert.equal(decision.decided_by,'manager');
  assert.equal(db.prepare('SELECT billable FROM time_entries WHERE id=?').get(claimed.id).billable,0,'the rest of the platform reads the determined figure');
  assert.throws(()=>db.prepare('UPDATE timesheet_entry_decisions SET billable=1 WHERE entry_id=?').run(claimed.id),/final/);
  assert.ok(verifyAudit(db));
});

test('timesheets: an approved week is closed to edits, additions and deletions, and the only correction is a later-week entry that points at the original',t=>{
  const {db,users,tx,project,log}=fixture(t);
  const day=today(),week=weekStart(day),past=addDays(week,-7);
  const original=log('employee',addDays(past,1),120,true);
  const submitted=tx(()=>submitTimesheet(db,users.employee,{week_start:past,note:''}));
  tx(()=>decideTimesheet(db,users.manager,submitted.id,'approve',{version:submitted.version,note:'اعتماد الأسبوع الماضي',entries:[{entry_id:original.id,billable:true}]}));

  assert.throws(()=>db.prepare('UPDATE time_entries SET minutes=480 WHERE id=?').run(original.id),/never edited/);
  assert.throws(()=>db.prepare('DELETE FROM time_entries WHERE id=?').run(original.id),/never edited/);
  assert.throws(()=>tx(()=>logTime(db,users.employee,{project_id:project.id,work_date:addDays(past,2),minutes:60,billable:true,note:'إضافة متأخرة'})),/closed|lock/);
  assert.throws(()=>db.prepare("UPDATE timesheet_periods SET status='open',version=version+1 WHERE id=?").run(submitted.id),/never reopened/);

  assert.throws(()=>tx(()=>logCorrection(db,users.employee,{original_entry_id:original.id,work_date:addDays(past,3),minutes:60,billable:false,note:'تصحيح داخل الأسبوع نفسه',reason:'محاولة تصحيح في الأسبوع المعتمد'})),code('work_date'));
  assert.throws(()=>tx(()=>logCorrection(db,users.outsider,{original_entry_id:original.id,work_date:day,minutes:60,billable:false,note:'تصحيح لسجل غيري',reason:'محاولة تصحيح سجل شخص آخر'})),code('not_found'));
  const correction=tx(()=>logCorrection(db,users.employee,{original_entry_id:original.id,work_date:day,minutes:60,billable:false,note:'تصحيح الساعات المسجلة خطأ',reason:'سُجلت على مشروع غير صحيح وتُصحح هنا'}));
  const link=db.prepare('SELECT * FROM timesheet_corrections WHERE correction_entry_id=?').get(correction.id);
  assert.equal(link.original_entry_id,original.id,'the correction points at what it corrects and the original stays');
  assert.equal(db.prepare('SELECT minutes FROM time_entries WHERE id=?').get(original.id).minutes,120,'the original is untouched');
  assert.ok(timesheetsBoard(db,users.employee).my_period.entries.some(e=>e.is_correction));
  assert.ok(verifyAudit(db));
});

test('timesheets: the lock window is a setting its owner enters with a source — with none entered nothing locks and no backdated entry is refused',t=>{
  const {db,users,tx,project,log}=fixture(t);
  const day=today(),week=weekStart(day),past=addDays(week,-14);
  assert.equal(timesheetsBoard(db,users.manager).lock,null,'the platform assumes no lock period of its own');
  assert.throws(()=>tx(()=>lockDuePeriods(db,users.manager,{basis:'قفل قبل إدخال المدة المعتمدة'})),code('lock_window_missing'));
  const old=log('employee',addDays(past,1),60,true);
  assert.ok(old.id,'with no lock window a backdated entry is accepted');
  const submitted=tx(()=>submitTimesheet(db,users.employee,{week_start:past,note:''}));

  // الترحيل 091: مدة القفل إعداد على الكيان كله يحدده الأدمن، لا مدير فريق حامل timesheets.approve.
  for(const who of ['employee','outsider','hr','it','manager'])
    assert.throws(()=>tx(()=>setLockWindow(db,users[who],{lock_after_days:10,basis:'مدة يحددها من لا يملك التصريح'})),code('not_permitted'));
  for(const bad of [{lock_after_days:0},{lock_after_days:400},{lock_after_days:10.5},{basis:'قصير'}])
    assert.throws(()=>tx(()=>setLockWindow(db,users.admin,{lock_after_days:10,basis:'سند مدة القفل الموثق في محضر المالك',...bad})));
  const setting=tx(()=>setLockWindow(db,users.admin,{lock_after_days:7,basis:'قرار المالك الموثق في محضر تجريبي بتاريخه'}));
  assert.equal(setting.lock_after_days,7);
  assert.equal(setting.cutoff,addDays(day,-7));
  assert.throws(()=>tx(()=>logTime(db,users.employee,{project_id:project.id,work_date:addDays(past,2),minutes:60,billable:true,note:'إدخال بأثر رجعي بعد القفل'})),/lock window|closed/);

  assert.throws(()=>tx(()=>submitTimesheet(db,users.employee,{week_start:past,note:''})),code('window_closed'),'a week past the window is not submitted after the fact');
  // الأسبوع المرسَل ينتظر قرار مديره ولا يُقفل (الترحيل 091)؛ يُعاد أولًا ثم يقفله القفل المجدول.
  assert.equal(tx(()=>lockDuePeriods(db,users.manager,{basis:'تنفيذ القفل الدوري وفق قرار المالك'})).locked,0,'a submitted week awaiting its decision is not locked');
  tx(()=>decideTimesheet(db,users.manager,submitted.id,'return',{version:submitted.version,note:'أُعيد لأن مدة القفل مضت قبل القرار'}));
  const run=tx(()=>lockDuePeriods(db,users.manager,{basis:'تنفيذ القفل الدوري وفق قرار المالك'}));
  assert.equal(run.locked,1);
  const locked=getPeriod(db,users.manager,submitted.id);
  assert.equal(locked.status,'locked');
  assert.equal(locked.locked_without_approval,true,'a week locked without an approval says so rather than passing as approved');
  assert.throws(()=>db.prepare("UPDATE timesheet_periods SET status='submitted',version=version+1 WHERE id=?").run(submitted.id),/never reopened/);
  const updated=tx(()=>setLockWindow(db,users.admin,{lock_after_days:14,basis:'تعديل المدة بقرار لاحق موثق',version:1}));
  assert.equal(updated.lock_after_days,14);
  assert.throws(()=>tx(()=>setLockWindow(db,users.admin,{lock_after_days:20,basis:'تعديل بنسخة قديمة من الإعداد',version:1})),code('stale_version'));
  assert.ok(verifyAudit(db));
});

test('timesheets: a stale version, another tenant’s week and a role without the capability are all refused',t=>{
  const {db,users,tx,log}=fixture(t);
  const day=today(),week=weekStart(day);
  const entry=log('employee',day);
  const first=tx(()=>submitTimesheet(db,users.employee,{week_start:week,note:''}));
  const returned=tx(()=>decideTimesheet(db,users.manager,first.id,'return',{version:first.version,note:'ينقص وصف ما أُنجز في يومين'}));
  assert.equal(returned.status,'returned');
  assert.equal(returned.decision_note,'ينقص وصف ما أُنجز في يومين');
  const again=tx(()=>submitTimesheet(db,users.employee,{week_start:week,note:'أعدت الإرسال بعد التوضيح'}));
  assert.throws(()=>tx(()=>decideTimesheet(db,users.manager,again.id,'approve',{version:first.version,note:'',entries:[{entry_id:entry.id,billable:true}]})),code('stale_version'));
  assert.throws(()=>getPeriod(db,users.external,again.id),code('not_found'),'another tenant sees nothing');
  assert.throws(()=>getPeriod(db,users.outsider,again.id),code('not_found'),'a colleague is not an approver');
  assert.equal(timesheetsBoard(db,users.external).pending.length,0);
  assert.equal(timesheetsBoard(db,users.hr).can_approve,false,'the capability is what grants approval, not the HR role');
  assert.equal(timesheetsBoard(db,users.manager).can_approve,true);
  assert.ok(verifyAudit(db));
});

test('timesheets: reminders name who has not submitted a finished week and stay inside the platform — no mail is claimed',t=>{
  const {db,users,tx,log}=fixture(t);
  const day=today(),week=weekStart(day),past=addDays(week,-7);
  log('employee',addDays(past,1));
  assert.throws(()=>tx(()=>remindMissing(db,users.manager,{week_start:week})),code('week_open'),'nobody is chased for a week still running');
  for(const who of ['employee','outsider','hr','it'])
    assert.throws(()=>tx(()=>remindMissing(db,users[who],{week_start:past})),code('not_permitted'));
  const board=timesheetsBoard(db,users.manager,past);
  assert.deepEqual(board.missing.map(m=>m.user_id).sort(),['employee','outsider']);
  assert.equal(board.missing.every(m=>m.reminded_at===null),true);
  const raised=tx(()=>remindMissing(db,users.manager,{week_start:past}));
  assert.equal(raised.created,2);
  assert.equal(raised.channel,'in_platform');
  assert.match(raised.note,/لا مزوّد بريد/);
  assert.equal(tx(()=>remindMissing(db,users.manager,{week_start:past})).created,0,'repeatable without duplicating a reminder');
  const mine=timesheetsBoard(db,users.employee,past).reminders;
  assert.equal(mine.length,1);
  assert.equal(mine[0].read_at,null);
  tx(()=>markReminderRead(db,users.employee,mine[0].id));
  assert.ok(timesheetsBoard(db,users.employee,past).reminders[0].read_at);
  assert.throws(()=>tx(()=>markReminderRead(db,users.outsider,mine[0].id)),code('not_found'));

  const submitted=tx(()=>submitTimesheet(db,users.employee,{week_start:past,note:''}));
  assert.equal(timesheetsBoard(db,users.manager,past).missing.map(m=>m.user_id).join(),'outsider');
  assert.equal(submitted.week_end,weekEnd(past));
  assert.ok(verifyAudit(db));
});

test('timesheets screen: it states what it does not do, offers only the actions the record allows, and carries no inline style',t=>{
  const {db,users,tx,log}=fixture(t);
  const day=today(),week=weekStart(day),entry=log('employee',day);
  const submitted=tx(()=>submitTimesheet(db,users.employee,{week_start:week,note:''}));
  const e=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=(action,id,label)=>`<button data-action="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
  for(const who of ['employee','manager']){
    const html=timesheetsUI.render(timesheetsBoard(db,users[who]),{e,button,money:String});
    assert.doesNotMatch(html,/style="/,'CSP forbids inline style');
    assert.doesNotMatch(html,/<script/i);
  }
  assert.match(timesheetsUI.description,/لا بريد/);
  const managerData=timesheetsBoard(db,users.manager);
  const approveForm=timesheetsUI.form('approve_timesheet',submitted.id,managerData);
  assert.equal(approveForm.endpoint,`/timesheets/${submitted.id}/approve`);
  assert.deepEqual(approveForm.toPayload({billable_entries:[],note:''}).entries,[{entry_id:entry.id,billable:false}],'an entry left unticked is approved as non-billable, never silently billable');
  assert.throws(()=>timesheetsUI.form('approve_timesheet',submitted.id,timesheetsBoard(db,users.employee)),/غير متاح/);
  assert.throws(()=>timesheetsUI.form('set_lock_window','',timesheetsBoard(db,users.employee)),/غير متاح/);
  assert.ok(verifyAudit(db));
});
