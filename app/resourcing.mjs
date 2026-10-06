import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { holidaySet, isWorkingDay, riyadhDate } from './work-calendar.mjs';
import { addDays, weekStart, weekEnd, weekStarts, fullWeekDays, overlapWorkingDays } from './resource-weeks.mjs';

// تخطيط الموارد والسعة.
// الفكرة الأساسية: التمييز بين ما قد يحدث وما سيحدث. الحجز المبدئي معروض ومحسوب على حدة،
// ولا يدخل مجموع الساعات المجدولة ولا مؤشر فرط التحميل، فلا تُبنى خطة على احتمال.
// ولا جدولة آلية هنا ولا اقتراح أشخاص بخوارزمية: المنصة تُظهر التوفر والتعارض، والقرار للمدير.
// السعة رقم يدخله صاحبه بسنده؛ بلا رقم لا سعة، ولا تفترض المنصة أسبوعًا من أربعين ساعة.

const BOOKING_STATUS={tentative:'مبدئي',confirmed:'مؤكد',released:'مُطلق'};
const PLACEHOLDER_STATUS={open:'مفتوح',filled:'استُبدل بشخص',cancelled:'ملغى'};
const MAX_WEEKS=26;
const id=()=>randomUUID();
const today=()=>riyadhDate(Date.now());

function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة خطة الموارد معاملة قاعدة بيانات');}
function actor(db,supplied){
  const c=currentUser(db,supplied);
  if(!c||c.role==='admin')fail(403,'forbidden','خطة الموارد متاحة لحسابات الموظفين');
  return c;
}
const viewer=(db,u)=>can(db,u,'resourcing.view');
const planner=(db,u)=>can(db,u,'resourcing.plan');
function needView(db,u){if(!viewer(db,u))fail(403,'not_permitted','لوحة السعة تحتاج تصريح resourcing.view');}
function needPlan(db,u){if(!planner(db,u))fail(403,'not_permitted','الحجز والتأكيد يحتاج تصريح resourcing.plan');}

// نطاق الأشخاص: نفسه، ومن يديرهم، ومن يشاركهم مشروعًا. لا لوحة لكل الشركة لأن أيام الإجازة بيان شخصي.
function peopleInScope(db,u){
  return db.prepare(`SELECT DISTINCT x.id,x.name FROM users x
    WHERE x.tenant_id=? AND x.active=1 AND x.role<>'admin' AND (
      x.id=? OR x.manager_id=?
      OR EXISTS(SELECT 1 FROM project_members a JOIN project_members b ON b.project_id=a.project_id
        WHERE a.user_id=x.id AND b.user_id=?))
    ORDER BY x.name,x.id`).all(u.tenant_id,u.id,u.id,u.id);
}
function projectsInScope(db,u){
  return db.prepare('SELECT p.id,p.name FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.name,p.id').all(u.tenant_id,u.id);
}
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
// نطاق الحجز: مشروعه من مشاريع المستخدم، وصاحبه (إن كان شخصًا) من نطاق أشخاصه. ما خارج النطاق «غير متاح» للقراءة والكتابة معًا.
function scopeOf(db,u){
  return {projects:new Set(projectsInScope(db,u).map(p=>p.id)),people:new Set(peopleInScope(db,u).map(p=>p.id))};
}
const bookingInScope=(scope,b)=>scope.projects.has(b.project_id)&&(!b.user_id||scope.people.has(b.user_id));

function capacityRow(db,tenantId,userId,onDate){
  return db.prepare('SELECT * FROM resource_capacity WHERE tenant_id=? AND user_id=? AND effective_from<=? ORDER BY effective_from DESC,created_at DESC LIMIT 1').get(tenantId,userId,onDate)??null;
}
// أيام الإجازة المعتمدة الواقعة في الأسبوع وفي أيام العمل: العطلة لا تُخصم مرتين.
function leaveDaysIn(db,userId,week,holidays){
  const end=weekEnd(week);let days=0;
  for(const r of db.prepare("SELECT work_dates_json FROM leave_requests WHERE employee_id=? AND status='approved' AND end_date>=? AND start_date<=?").all(userId,week,end))
    days+=JSON.parse(r.work_dates_json).filter(d=>d>=week&&d<=end&&isWorkingDay(d,holidays)).length;
  return days;
}
function missionDaysIn(db,tenantId,userId,week,holidays){
  const end=weekEnd(week);let days=0;
  for(const m of db.prepare("SELECT from_date,to_date FROM work_missions WHERE tenant_id=? AND user_id=? AND status='approved' AND to_date>=? AND from_date<=?").all(tenantId,userId,week,end))
    days+=overlapWorkingDays(m.from_date,m.to_date,week,holidays);
  return days;
}
const round=value=>Math.round(value*10)/10;
const hours=minutes=>round(minutes/60);

/* ───── لوحة السعة: لكل شخص ولكل أسبوع السعة والمؤكد والمبدئي والإجازات والمتاح ───── */
export function capacityBoard(db,supplied,input={}){
  const u=actor(db,supplied);needView(db,u);
  v.object(input,['from','to']);
  const day=today(),from=input.from?v.date(input.from):weekStart(day),to=input.to?v.date(input.to):addDays(weekStart(day),27);
  if(to<from)fail(400,'date_order','تاريخ النهاية يسبق البداية');
  const weeks=weekStarts(from,to,MAX_WEEKS);
  if(!weeks.length)fail(400,'range','المدى لا يغطي أسبوعًا');
  const holidays=holidaySet(db,u.tenant_id),people=peopleInScope(db,u);
  const window={from:weeks[0],to:weekEnd(weeks[weeks.length-1])};
  const bookings=db.prepare(`SELECT b.*,p.name AS project_name FROM resource_bookings b JOIN projects p ON p.id=b.project_id
    WHERE b.tenant_id=? AND b.status<>'released' AND b.to_date>=? AND b.from_date<=?`).all(u.tenant_id,window.from,window.to);
  const rows=people.map(person=>{
    const cells=weeks.map(week=>{
      const perWeek=fullWeekDays(week),workingDays=perWeek?overlapWorkingDays(week,weekEnd(week),week,holidays):0;
      const rate=capacityRow(db,u.tenant_id,person.id,week);
      const dailyMinutes=rate&&perWeek?Math.round(rate.hours_per_week*60/perWeek):null;
      const capacity=dailyMinutes===null?null:dailyMinutes*workingDays;
      const leaveDays=leaveDaysIn(db,person.id,week,holidays),missionDays=missionDaysIn(db,u.tenant_id,person.id,week,holidays);
      const share=b=>{
        const daily=perWeek?Math.round(b.hours_per_week*60/perWeek):0;
        return daily*overlapWorkingDays(b.from_date,b.to_date,week,holidays);
      };
      const mine=bookings.filter(b=>b.user_id===person.id);
      const confirmed=mine.filter(b=>b.status==='confirmed').reduce((n,b)=>n+share(b),0);
      const tentative=mine.filter(b=>b.status==='tentative').reduce((n,b)=>n+share(b),0);
      const leave=dailyMinutes===null?null:dailyMinutes*leaveDays,mission=dailyMinutes===null?null:dailyMinutes*missionDays;
      const net=capacity===null?null:Math.max(0,capacity-leave-mission);
      return {week_start:week,week_end:weekEnd(week),working_days:workingDays,
        capacity_minutes:capacity,capacity_hours:capacity===null?null:hours(capacity),
        leave_days:leaveDays,leave_minutes:leave,leave_hours:leave===null?null:hours(leave),
        mission_days:missionDays,mission_minutes:mission,mission_hours:mission===null?null:hours(mission),
        net_capacity_minutes:net,net_capacity_hours:net===null?null:hours(net),
        confirmed_minutes:confirmed,confirmed_hours:hours(confirmed),
        // المبدئي معروض ولا يدخل المتاح ولا فرط التحميل.
        tentative_minutes:tentative,tentative_hours:hours(tentative),
        available_minutes:net===null?null:net-confirmed,available_hours:net===null?null:hours(net-confirmed),
        overload_minutes:net===null?null:Math.max(0,confirmed-net),overload_hours:net===null?null:hours(Math.max(0,confirmed-net)),
        capacity_known:capacity!==null};
    });
    return {user_id:person.id,name:person.name,capacity_known:cells.some(c=>c.capacity_known),
      capacity_basis:capacityRow(db,u.tenant_id,person.id,window.to)?.basis??null,weeks:cells,
      overloaded_weeks:cells.filter(c=>c.overload_minutes>0).length};
  });
  // العناصر النائبة تُعرض في صف مستقل: حجز على دور لم يُعيَّن شاغله بعد، فلا سعة له ولا فرط تحميل.
  const scope=scopeOf(db,u);
  const placeholders=db.prepare(`SELECT h.*,p.name AS project_name FROM role_placeholders h JOIN projects p ON p.id=h.project_id
    WHERE h.tenant_id=? AND h.status='open' ORDER BY h.created_at`).all(u.tenant_id).filter(h=>scope.projects.has(h.project_id)).map(h=>({
      id:h.id,role_name:h.role_name,project_id:h.project_id,project_name:h.project_name,
      weeks:weeks.map(week=>{
        const perWeek=fullWeekDays(week);
        const share=b=>(perWeek?Math.round(b.hours_per_week*60/perWeek):0)*overlapWorkingDays(b.from_date,b.to_date,week,holidays);
        const mine=bookings.filter(b=>b.placeholder_id===h.id);
        return {week_start:week,confirmed_minutes:mine.filter(b=>b.status==='confirmed').reduce((n,b)=>n+share(b),0),
          tentative_minutes:mine.filter(b=>b.status==='tentative').reduce((n,b)=>n+share(b),0)};
      })}));
  return {timezone:'Asia/Riyadh',today:day,window,weeks,people:rows,placeholders,
    missing_capacity:rows.filter(r=>!r.capacity_known).map(r=>({user_id:r.user_id,name:r.name})),
    note:'المبدئي لا يدخل المجدول ولا مؤشر فرط التحميل. السعة تُخصم من الإجازات المعتمدة والمهمات وأيام العطل. '+
      'من لم تُدخل سعته الأسبوعية يظهر بلا سعة ولا يُفترض له رقم. لا جدولة آلية: المنصة تُظهر التوفر والتعارض والقرار للمدير.'};
}

function bookingRecord(db,u,b,canPlan){
  const actions=[];
  if(canPlan&&b.status==='tentative')actions.push('confirm_booking','release_booking');
  if(canPlan&&b.status==='confirmed')actions.push('release_booking');
  // المحجوز لا يؤكد حجز نفسه، فلا يُعرض له الفعل أصلًا (والقيد مفروض في SQL أيضًا).
  return {...b,status_name:BOOKING_STATUS[b.status],person_name:personName(db,b.user_id),
    booked_by_name:personName(db,b.booked_by),confirmed_by_name:personName(db,b.confirmed_by),
    actions:b.user_id===u.id?actions.filter(a=>a!=='confirm_booking'):actions};
}

export function resourcingBoard(db,supplied,input={}){
  const u=actor(db,supplied);needView(db,u);
  const board=capacityBoard(db,u,input),canPlan=planner(db,u),scope=scopeOf(db,u);
  // الحجوزات والعناصر النائبة المعروضة هي ما يقع في نطاق المستخدم فقط: مشاريعه ونطاق أشخاصه.
  const bookings=db.prepare(`SELECT b.*,p.name AS project_name,h.role_name FROM resource_bookings b
    JOIN projects p ON p.id=b.project_id LEFT JOIN role_placeholders h ON h.id=b.placeholder_id
    WHERE b.tenant_id=? AND b.to_date>=? ORDER BY b.from_date,b.created_at`).all(u.tenant_id,addDays(board.today,-30))
    .filter(b=>bookingInScope(scope,b)).slice(0,200)
    .map(b=>bookingRecord(db,u,b,canPlan));
  const placeholders=db.prepare(`SELECT h.*,p.name AS project_name FROM role_placeholders h JOIN projects p ON p.id=h.project_id
    WHERE h.tenant_id=? ORDER BY h.created_at DESC`).all(u.tenant_id).filter(h=>scope.projects.has(h.project_id)).slice(0,100).map(h=>({...h,
      status_name:PLACEHOLDER_STATUS[h.status],filled_user_name:personName(db,h.filled_user_id),
      booking_count:db.prepare('SELECT COUNT(*) AS n FROM resource_bookings WHERE placeholder_id=?').get(h.id).n,
      actions:canPlan&&h.status==='open'?['fill_placeholder']:[]}));
  return {...board,can_plan:canPlan,bookings,placeholder_records:placeholders,
    people_options:peopleInScope(db,u),projects:projectsInScope(db,u),status_names:BOOKING_STATUS};
}

/* ───── السعة الأسبوعية للشخص ───── */
export function setCapacity(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['user_id','effective_from','hours_per_week','basis']);
  needPlan(db,u);
  const person=typeof input.user_id==='string'&&db.prepare("SELECT id,name FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id);
  if(!person)fail(404,'not_found','الموظف غير متاح');
  if(!peopleInScope(db,u).some(p=>p.id===person.id))fail(403,'scope','الموظف خارج نطاق فريقك ومشاريعك');
  const from=v.date(input.effective_from);
  if(!Number.isInteger(input.hours_per_week)||input.hours_per_week<1||input.hours_per_week>80)fail(400,'hours_per_week','ساعات الأسبوع عدد صحيح من 1 إلى 80');
  const basis=v.text(input.basis,'سند السعة ومصدرها',1000,10);
  if(db.prepare('SELECT 1 FROM resource_capacity WHERE tenant_id=? AND user_id=? AND effective_from=?').get(u.tenant_id,person.id,from))fail(409,'duplicate_capacity','لهذا التاريخ سعة مسجلة. أدخل تاريخ سريان جديدًا');
  const rowId=id();
  db.prepare('INSERT INTO resource_capacity(id,tenant_id,user_id,effective_from,hours_per_week,basis,set_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(rowId,u.tenant_id,person.id,from,input.hours_per_week,basis,u.id,now());
  audit(db,u,'resource_capacity',rowId,'capacity.set',{}, {user_id:person.id,effective_from:from,hours_per_week:input.hours_per_week},basis);
  return {id:rowId,user_id:person.id,effective_from:from,hours_per_week:input.hours_per_week};
}

/* ───── الحجوزات ───── */
export function createBooking(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['project_id','user_id','placeholder_id','from_date','to_date','hours_per_week','note']);
  needPlan(db,u);
  if(!projectsInScope(db,u).some(p=>p.id===input.project_id))fail(404,'not_found','المشروع غير متاح لك');
  const hasUser=typeof input.user_id==='string'&&input.user_id!=='',hasPlaceholder=typeof input.placeholder_id==='string'&&input.placeholder_id!=='';
  if(hasUser===hasPlaceholder)fail(400,'subject','الحجز على شخص أو على عنصر نائب، لا الاثنين معًا');
  if(hasUser&&!peopleInScope(db,u).some(p=>p.id===input.user_id))fail(403,'scope','الشخص خارج نطاق فريقك ومشاريعك');
  if(hasPlaceholder&&!db.prepare("SELECT 1 FROM role_placeholders WHERE id=? AND tenant_id=? AND project_id=? AND status='open'").get(input.placeholder_id,u.tenant_id,input.project_id))fail(404,'not_found','العنصر النائب غير متاح في هذا المشروع');
  const from=v.date(input.from_date),to=v.date(input.to_date);
  if(to<from)fail(400,'date_order','تاريخ النهاية يسبق البداية');
  if(to>addDays(from,365))fail(400,'range_too_long','مدة الحجز سنة على الأكثر');
  if(!Number.isInteger(input.hours_per_week)||input.hours_per_week<1||input.hours_per_week>80)fail(400,'hours_per_week','ساعات الأسبوع عدد صحيح من 1 إلى 80');
  const note=v.text(input.note,'سبب الحجز والعمل المتوقع',1000,5),bookingId=id();
  db.prepare("INSERT INTO resource_bookings(id,tenant_id,project_id,user_id,placeholder_id,from_date,to_date,hours_per_week,status,note,booked_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'tentative',?,?,?,?)")
    .run(bookingId,u.tenant_id,input.project_id,hasUser?input.user_id:null,hasPlaceholder?input.placeholder_id:null,from,to,input.hours_per_week,note,u.id,now(),now());
  audit(db,u,'resource_booking',bookingId,'booking.created',{}, {project_id:input.project_id,user_id:hasUser?input.user_id:null,placeholder_id:hasPlaceholder?input.placeholder_id:null,from_date:from,to_date:to,hours_per_week:input.hours_per_week,status:'tentative'},note);
  return getBooking(db,u,bookingId);
}

export function getBooking(db,supplied,bookingId){
  const u=actor(db,supplied);needView(db,u);
  const b=typeof bookingId==='string'&&db.prepare(`SELECT b.*,p.name AS project_name,h.role_name FROM resource_bookings b
    JOIN projects p ON p.id=b.project_id LEFT JOIN role_placeholders h ON h.id=b.placeholder_id WHERE b.id=? AND b.tenant_id=?`).get(bookingId,u.tenant_id);
  if(!b||!bookingInScope(scopeOf(db,u),b))fail(404,'not_found','الحجز غير متاح');
  return bookingRecord(db,u,b,planner(db,u));
}

// التحويل إلى مؤكد فعل مسجل باسم صاحبه ووقته، ولا رجعة عنه إلى المبدئي.
export function confirmBooking(db,supplied,bookingId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','note']);
  needPlan(db,u);
  const b=typeof bookingId==='string'&&db.prepare("SELECT * FROM resource_bookings WHERE id=? AND tenant_id=? AND status='tentative'").get(bookingId,u.tenant_id);
  if(!b||!bookingInScope(scopeOf(db,u),b))fail(404,'not_found','الحجز غير متاح للتأكيد');
  v.version(input.version,b.version);
  if(b.user_id===u.id)fail(403,'separation_of_duties','لا تؤكد حجز نفسك');
  const note=v.text(input.note,'أساس التأكيد',1000,5),stamp=now();
  db.prepare("UPDATE resource_bookings SET status='confirmed',confirmed_by=?,confirmed_at=?,confirm_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,stamp,note,stamp,b.id);
  audit(db,u,'resource_booking',b.id,'booking.confirmed',{status:'tentative',version:b.version},{status:'confirmed',version:b.version+1},note);
  return getBooking(db,u,b.id);
}

export function releaseBooking(db,supplied,bookingId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','note']);
  needPlan(db,u);
  const b=typeof bookingId==='string'&&db.prepare("SELECT * FROM resource_bookings WHERE id=? AND tenant_id=? AND status<>'released'").get(bookingId,u.tenant_id);
  if(!b||!bookingInScope(scopeOf(db,u),b))fail(404,'not_found','الحجز غير متاح للإطلاق');
  v.version(input.version,b.version);
  const note=v.text(input.note,'سبب الإطلاق',1000,10),stamp=now();
  db.prepare("UPDATE resource_bookings SET status='released',released_by=?,released_at=?,release_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,stamp,note,stamp,b.id);
  audit(db,u,'resource_booking',b.id,'booking.released',{status:b.status,version:b.version},{status:'released',version:b.version+1},note);
  return getBooking(db,u,b.id);
}

/* ───── العنصر النائب ───── */
export function createPlaceholder(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['project_id','role_name','note']);
  needPlan(db,u);
  if(!projectsInScope(db,u).some(p=>p.id===input.project_id))fail(404,'not_found','المشروع غير متاح لك');
  const role=v.text(input.role_name,'اسم الدور',120,2),note=input.note===undefined||input.note===''?'':v.text(input.note,'ملاحظة',1000);
  const placeholderId=id();
  db.prepare("INSERT INTO role_placeholders(id,tenant_id,project_id,role_name,note,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?,?)")
    .run(placeholderId,u.tenant_id,input.project_id,role,note,u.id,now(),now());
  audit(db,u,'role_placeholder',placeholderId,'placeholder.created',{}, {project_id:input.project_id,role_name:role},note);
  return {id:placeholderId,role_name:role,status:'open'};
}

// الاستبدال يحرك كل الحجوزات دفعة واحدة: إما أن تنتقل كلها أو لا تنتقل واحدة (المعاملة تضمن ذلك).
export function fillPlaceholder(db,supplied,placeholderId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','user_id','note']);
  needPlan(db,u);
  const h=typeof placeholderId==='string'&&db.prepare("SELECT * FROM role_placeholders WHERE id=? AND tenant_id=? AND status='open'").get(placeholderId,u.tenant_id);
  if(!h||!projectsInScope(db,u).some(p=>p.id===h.project_id))fail(404,'not_found','العنصر النائب غير متاح');
  v.version(input.version,h.version);
  const person=typeof input.user_id==='string'&&db.prepare("SELECT id,name FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.user_id,u.tenant_id);
  if(!person)fail(404,'not_found','الشخص غير متاح');
  if(!peopleInScope(db,u).some(p=>p.id===person.id))fail(403,'scope','الشخص خارج نطاق فريقك ومشاريعك');
  const note=v.text(input.note,'أساس التعيين',1000,5),stamp=now();
  const moving=db.prepare("SELECT * FROM resource_bookings WHERE placeholder_id=? AND status<>'released' ORDER BY from_date").all(h.id);
  // من أكّد حجزًا على الدور لا يصير هو المحجوز عليه: أطلق الحجز وأعد حجزه ليؤكده غيره.
  if(moving.some(b=>b.confirmed_by===person.id))fail(409,'separation_of_duties','هذا الشخص أكّد حجزًا على الدور نفسه؛ أطلق ذلك الحجز قبل تعيينه');
  for(const b of moving)db.prepare('UPDATE resource_bookings SET user_id=?,placeholder_id=NULL,version=version+1,updated_at=? WHERE id=?').run(person.id,stamp,b.id);
  db.prepare("UPDATE role_placeholders SET status='filled',filled_user_id=?,filled_by=?,filled_at=?,fill_note=?,version=version+1,updated_at=? WHERE id=?").run(person.id,u.id,stamp,note,stamp,h.id);
  audit(db,u,'role_placeholder',h.id,'placeholder.filled',{status:'open',bookings:moving.length},{status:'filled',user_id:person.id,moved:moving.length},note);
  return {id:h.id,user_id:person.id,moved:moving.length,
    note:'انتقلت حجوزات الدور كلها إلى الشخص بحالاتها كما هي، في معاملة واحدة.'};
}

export function cancelPlaceholder(db,supplied,placeholderId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','note']);
  needPlan(db,u);
  const h=typeof placeholderId==='string'&&db.prepare("SELECT * FROM role_placeholders WHERE id=? AND tenant_id=? AND status='open'").get(placeholderId,u.tenant_id);
  if(!h||!projectsInScope(db,u).some(p=>p.id===h.project_id))fail(404,'not_found','العنصر النائب غير متاح');
  v.version(input.version,h.version);
  const note=v.text(input.note,'سبب الإلغاء',1000,10);
  if(db.prepare("SELECT 1 FROM resource_bookings WHERE placeholder_id=? AND status<>'released'").get(h.id))fail(409,'has_bookings','أطلق حجوزات العنصر النائب قبل إلغائه');
  db.prepare("UPDATE role_placeholders SET status='cancelled',version=version+1,updated_at=?,fill_note=? WHERE id=?").run(now(),note,h.id);
  audit(db,u,'role_placeholder',h.id,'placeholder.cancelled',{status:'open'},{status:'cancelled'},note);
  return {id:h.id,status:'cancelled'};
}
