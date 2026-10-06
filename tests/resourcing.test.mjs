import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createProject } from '../app/projects.mjs';
import { grantLeaveOpening, createLeaveRequest, leaveAction } from '../app/leave.mjs';
import { capacityBoard, resourcingBoard, setCapacity, createBooking, getBooking, confirmBooking, releaseBooking, createPlaceholder, fillPlaceholder, cancelPlaceholder } from '../app/resourcing.mjs';
import { weekStart, weekEnd, addDays } from '../app/resource-weeks.mjs';
import { resourcingUI } from '../app/static/resourcing-ui.mjs';

const code=expected=>error=>error.code===expected;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const week=()=>weekStart(today());

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-resourcing');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع تجريبي للموارد',brief:'موجز تجريبي مصطنع',member_ids:['employee','outsider']}));
  const capacity=(who='employee',hours=40)=>tx(()=>setCapacity(db,users.manager,{user_id:who,effective_from:'2026-01-01',hours_per_week:hours,basis:'ساعات العقد التجريبي الموثقة بتاريخها'}));
  const book=(over={})=>tx(()=>createBooking(db,users.manager,{project_id:project.id,user_id:'employee',placeholder_id:null,
    from_date:week(),to_date:weekEnd(week()),hours_per_week:24,note:'تنفيذ مرحلة تجريبية',...over}));
  const cell=(who='employee',at=week())=>capacityBoard(db,users.manager,{from:at,to:weekEnd(at)}).people.find(p=>p.user_id===who).weeks[0];
  return {db,users,tx,project,capacity,book,cell};
}

test('resourcing: a tentative booking is shown but never counted — it stays out of scheduled hours and out of the overload figure until someone confirms it by name',t=>{
  const {db,users,tx,capacity,book,cell}=fixture(t);
  capacity();
  const booking=book();
  assert.equal(booking.status,'tentative','every booking starts as a possibility, not a commitment');
  const before=cell();
  assert.equal(before.capacity_hours,40);
  assert.equal(before.confirmed_hours,0,'tentative hours are not scheduled hours');
  assert.equal(before.tentative_hours,24,'and they are shown, separately');
  assert.equal(before.available_hours,40);
  assert.equal(before.overload_hours,0);

  const confirmed=tx(()=>confirmBooking(db,users.manager,booking.id,{version:booking.version,note:'أكّده المدير بعد موافقة العميل'}));
  assert.equal(confirmed.status,'confirmed');
  assert.equal(confirmed.confirmed_by,'manager','confirmation carries the name of whoever made it');
  assert.ok(confirmed.confirmed_at,'and the moment it was made');
  const after=cell();
  assert.equal(after.confirmed_hours,24);
  assert.equal(after.tentative_hours,0);
  assert.equal(after.available_hours,16);
  assert.throws(()=>db.prepare("UPDATE resource_bookings SET status='tentative',version=version+1 WHERE id=?").run(booking.id),/one way/,'confirmation is not quietly undone');
  const released=tx(()=>releaseBooking(db,users.manager,booking.id,{version:confirmed.version,note:'أُلغيت المرحلة بقرار العميل'}));
  assert.equal(released.status,'released');
  assert.equal(cell().confirmed_hours,0);
  assert.ok(verifyAudit(db));
});

test('resourcing: capacity is a figure its owner enters with a source; with none entered the board says so and invents no forty-hour week',t=>{
  const {db,users,tx,capacity,book,cell}=fixture(t);
  const empty=capacityBoard(db,users.manager,{});
  assert.ok(empty.missing_capacity.some(p=>p.user_id==='employee'));
  const blank=cell();
  assert.equal(blank.capacity_hours,null,'no capacity is assumed');
  assert.equal(blank.available_hours,null);
  assert.equal(blank.overload_hours,null);
  assert.match(empty.note,/بلا سعة/);

  for(const bad of [{hours_per_week:0},{hours_per_week:100},{hours_per_week:37.5},{basis:'قصير'}])
    assert.throws(()=>tx(()=>setCapacity(db,users.manager,{user_id:'employee',effective_from:'2026-01-01',hours_per_week:40,basis:'سند السعة الموثق بتاريخه',...bad})));
  capacity();
  assert.equal(cell().capacity_hours,40);
  assert.throws(()=>capacity(),code('duplicate_capacity'),'the same effective date is not overwritten');
  assert.throws(()=>db.prepare('UPDATE resource_capacity SET hours_per_week=60 WHERE user_id=?').run('employee'),/new dated figure/);
  // نسخة بتاريخ سريان لاحق تحل محلها من تاريخها فقط، ولا تعيد كتابة الماضي.
  tx(()=>setCapacity(db,users.manager,{user_id:'employee',effective_from:addDays(week(),7),hours_per_week:20,basis:'تخفيض الدوام بقرار موثق بتاريخه'}));
  assert.equal(cell().capacity_hours,40);
  assert.equal(cell('employee',addDays(week(),7)).capacity_hours,20);
  book();
  assert.ok(verifyAudit(db));
});

test('resourcing: approved leave, approved missions and public holidays come off capacity automatically and in hours',t=>{
  const {db,users,tx,capacity,cell}=fixture(t);
  capacity();
  const current=week();
  db.prepare("INSERT INTO leave_calendars VALUES(?,?,?,?,?,?,?,?,?,'Asia/Riyadh',1,?)")
    .run('creative-2026','36t','creative','hr','تقويم مصطنع للاختبار، ليس سياسة الشركة','2026-01-01','2026-12-31','[0,1,2,3,4]','[]',now());
  tx(()=>grantLeaveOpening(db,users.hr,{employee_id:'employee',leave_type:'synthetic_annual',balance_year:2026,days:12,effective_date:'2026-01-01',reason:'منح مصطنع محدد للاختبار',evidence:'بيانات عينة اختبار محلية',calendar_id:'creative-2026'}));
  let request=tx(()=>createLeaveRequest(db,users.employee,{leave_type:'synthetic_annual',balance_year:2026,start_date:addDays(current,1),end_date:addDays(current,2),reason:'طلب اختبار محلي مصطنع'}));
  assert.equal(cell().leave_hours,0,'a leave request that nobody approved changes nothing');
  request=tx(()=>leaveAction(db,users.manager,request.id,'approve',{version:request.version,note:'موافقة المدير في الاختبار'}));
  request=tx(()=>leaveAction(db,users.hr,request.id,'approve',{version:request.version,note:'موافقة خدمات الموظف في الاختبار'}));
  assert.equal(request.status,'approved');
  const withLeave=cell();
  assert.equal(withLeave.leave_days,2);
  assert.equal(withLeave.leave_hours,16,'two working days off a forty-hour five-day week is sixteen hours');
  assert.equal(withLeave.net_capacity_hours,24);

  db.prepare("INSERT INTO work_missions(id,tenant_id,user_id,from_date,to_date,destination,purpose,status,decided_by,decided_at,created_at) VALUES('m1','36t','employee',?,?,'وجهة تجريبية','غرض مهمة تجريبية للاختبار','approved','manager',?,?)")
    .run(addDays(current,3),addDays(current,3),now(),now());
  assert.equal(cell().mission_days,1);
  assert.equal(cell().mission_hours,8);
  assert.equal(cell().net_capacity_hours,16);

  db.prepare("INSERT INTO public_holidays(id,tenant_id,holiday_date,name,basis,status,proposed_by,decided_by,decided_at,created_at) VALUES('h1','36t',?,'عطلة تجريبية','سند تجريبي مكتوب للاختبار','approved','hr','manager',?,?)")
    .run(current,now(),now());
  const withHoliday=cell();
  assert.equal(withHoliday.working_days,4,'an approved holiday shortens the week');
  assert.equal(withHoliday.capacity_hours,32,'so it shortens the capacity too, without being deducted twice');
  assert.ok(verifyAudit(db));
});

test('resourcing: overload is reported in hours, not a percentage, and only confirmed hours can cause it',t=>{
  const {db,users,tx,capacity,book,cell}=fixture(t);
  capacity('employee',30);
  const first=book({hours_per_week:20}),second=book({hours_per_week:20});
  assert.equal(cell().overload_hours,0,'two overlapping possibilities are not an overload');
  tx(()=>confirmBooking(db,users.manager,first.id,{version:first.version,note:'تأكيد الحجز الأول'}));
  assert.equal(cell().overload_hours,0);
  tx(()=>confirmBooking(db,users.manager,second.id,{version:second.version,note:'تأكيد الحجز الثاني'}));
  const over=cell();
  assert.equal(over.confirmed_hours,40);
  assert.equal(over.overload_hours,10,'ten hours over, stated as hours');
  assert.equal(over.available_hours,-10);
  assert.equal(Object.keys(over).some(k=>k.includes('percent')||k.includes('utilization')),false,'no vague ratio stands in for the hours');
  assert.equal(capacityBoard(db,users.manager,{}).people.find(p=>p.user_id==='employee').overloaded_weeks>0,true);
  assert.ok(verifyAudit(db));
});

test('resourcing: a role placeholder is booked before anyone is hired and carries all its bookings to the real person in one move',t=>{
  const {db,users,tx,project,capacity,cell}=fixture(t);
  capacity('outsider',40);
  const holder=tx(()=>createPlaceholder(db,users.manager,{project_id:project.id,role_name:'مصمم قادم',note:'لم يُعيَّن بعد'}));
  const one=tx(()=>createBooking(db,users.manager,{project_id:project.id,user_id:null,placeholder_id:holder.id,from_date:week(),to_date:weekEnd(week()),hours_per_week:12,note:'المرحلة الأولى للدور'}));
  const two=tx(()=>createBooking(db,users.manager,{project_id:project.id,user_id:null,placeholder_id:holder.id,from_date:addDays(week(),7),to_date:addDays(week(),13),hours_per_week:8,note:'المرحلة الثانية للدور'}));
  assert.throws(()=>tx(()=>createBooking(db,users.manager,{project_id:project.id,user_id:'employee',placeholder_id:holder.id,from_date:week(),to_date:weekEnd(week()),hours_per_week:5,note:'حجز على شخص وعنصر نائب معًا'})),code('subject'));
  const board=capacityBoard(db,users.manager,{});
  assert.equal(board.placeholders.find(h=>h.id===holder.id).weeks[0].tentative_minutes,12*60,'the placeholder is shown on its own row, with no capacity of its own');
  assert.equal(cell('outsider').tentative_hours,0);
  assert.throws(()=>tx(()=>cancelPlaceholder(db,users.manager,holder.id,{version:1,note:'إلغاء دور له حجوزات قائمة'})),code('has_bookings'));

  const filled=tx(()=>fillPlaceholder(db,users.manager,holder.id,{version:1,user_id:'outsider',note:'عُيّن الشخص على الدور'}));
  assert.equal(filled.moved,2,'every booking moves, in one transaction');
  for(const b of [one,two]){
    const moved=db.prepare('SELECT user_id,placeholder_id,status FROM resource_bookings WHERE id=?').get(b.id);
    assert.equal(moved.user_id,'outsider');
    assert.equal(moved.placeholder_id,null);
    assert.equal(moved.status,'tentative','status travels unchanged; filling a role confirms nothing');
  }
  assert.equal(cell('outsider').tentative_hours,12);
  assert.equal(capacityBoard(db,users.manager,{}).placeholders.length,0,'a filled placeholder leaves the board');
  assert.throws(()=>tx(()=>fillPlaceholder(db,users.manager,holder.id,{version:2,user_id:'employee',note:'محاولة تعيين ثانية'})),code('not_found'),'a placeholder is filled once');
  assert.ok(verifyAudit(db));
});

test('resourcing: planning is refused without the capability, across tenants, on a stale version, and nobody confirms their own booking',t=>{
  const {db,users,tx,project,capacity,book}=fixture(t);
  capacity();
  for(const who of ['employee','outsider','hr','it','external'])
    assert.throws(()=>capacityBoard(db,users[who],{}),code('not_permitted'),'the board itself needs resourcing.view');
  assert.throws(()=>capacityBoard(db,users.admin,{}),code('forbidden'));
  for(const who of ['employee','outsider','hr','it'])
    assert.throws(()=>tx(()=>createBooking(db,users[who],{project_id:project.id,user_id:'employee',placeholder_id:null,from_date:week(),to_date:weekEnd(week()),hours_per_week:8,note:'حجز بلا تصريح'})),code('not_permitted'));

  const booking=book();
  assert.throws(()=>tx(()=>confirmBooking(db,users.manager,booking.id,{version:booking.version+5,note:'تأكيد بنسخة قديمة'})),code('stale_version'));
  tx(()=>confirmBooking(db,users.manager,booking.id,{version:booking.version,note:'تأكيد سليم'}));
  assert.throws(()=>tx(()=>confirmBooking(db,users.manager,booking.id,{version:2,note:'تأكيد مكرر'})),code('not_found'));

  // صاحب السجل لا يقرر فيه: يُفرض في الكود وفي CHECK على الجدول.
  const own=tx(()=>createBooking(db,users.manager,{project_id:project.id,user_id:'manager',placeholder_id:null,from_date:week(),to_date:weekEnd(week()),hours_per_week:5,note:'حجز المدير على نفسه'}));
  assert.throws(()=>tx(()=>confirmBooking(db,users.manager,own.id,{version:own.version,note:'تأكيد حجز نفسي'})),code('separation_of_duties'));
  assert.throws(()=>db.prepare("UPDATE resource_bookings SET status='confirmed',confirmed_by='manager',confirmed_at=?,version=version+1 WHERE id=?").run(now(),own.id),/CHECK constraint failed/);
  assert.equal(getBooking(db,users.manager,own.id).actions.includes('confirm_booking'),false,'the screen does not offer what the record forbids');
  assert.throws(()=>getBooking(db,users.external,booking.id),code('not_permitted'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM resource_bookings WHERE tenant_id<>'36t'").get().n,0);
  assert.ok(verifyAudit(db));
});

test('resourcing screen: the capacity table is plain text, tells tentative from confirmed with an existing CSS class, and carries no inline style',t=>{
  const {db,users,tx,capacity,book}=fixture(t);
  capacity();
  const booking=book();
  const e=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=(action,id,label)=>`<button data-action="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
  const html=resourcingUI.render(resourcingBoard(db,users.manager,{}),{e,button,money:String});
  assert.doesNotMatch(html,/style="/,'CSP forbids inline style');
  assert.doesNotMatch(html,/<script/i);
  assert.match(html,/class="badge subtle">مبدئي/,'tentative is marked by an existing class, not a colour');
  assert.match(html,/class="badge">مؤكد/);
  assert.match(resourcingUI.description,/لا جدولة آلية/,'the screen says it does not schedule anyone for you');

  const data=resourcingBoard(db,users.manager,{});
  const confirmForm=resourcingUI.form('confirm_booking',booking.id,data);
  assert.equal(confirmForm.endpoint,`/resourcing/bookings/${booking.id}/confirm`);
  assert.equal(confirmForm.toPayload({note:'أساس'}).version,booking.version);
  const created=resourcingUI.form('create_booking','',data);
  assert.deepEqual(created.toPayload({project_id:'p',subject:'user:employee',from_date:'2026-09-13',to_date:'2026-09-19',hours_per_week:'8',note:'ملاحظة'}),
    {project_id:'p',user_id:'employee',placeholder_id:null,from_date:'2026-09-13',to_date:'2026-09-19',hours_per_week:8,note:'ملاحظة'});
  tx(()=>confirmBooking(db,users.manager,booking.id,{version:booking.version,note:'تأكيد للاختبار'}));
  assert.throws(()=>resourcingUI.form('confirm_booking',booking.id,resourcingBoard(db,users.manager,{})),/غير متاح/);
  assert.ok(verifyAudit(db));
});
