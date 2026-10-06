// تقويم العمل: أيام العمل من الأحد إلى الخميس، وتُستبعد العطل الرسمية المعتمدة في الحضور.
// تُحسب به أزمنة الخدمات حتى لا يُعد يوم الجمعة أو عطلة معتمدة تأخيرًا على أحد.
const DAY=86400000;
const WEEKEND=new Set([5,6]); // الجمعة والسبت
const riyadh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
export const riyadhDate=value=>riyadh.format(new Date(value));
const shift=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*DAY).toISOString().slice(0,10);
const weekday=date=>new Date(`${date}T00:00:00Z`).getUTCDay();

export function holidaySet(db,tenantId){
  return new Set(db.prepare("SELECT holiday_date FROM public_holidays WHERE tenant_id=? AND status='approved'").all(tenantId).map(r=>r.holiday_date));
}
export const isWorkingDay=(date,holidays)=>!WEEKEND.has(weekday(date))&&!holidays.has(date);

// أيام العمل التي انقضت بعد يوم البداية حتى يوم النهاية (يوم التقديم نفسه لا يُحسب).
export function workingDaysBetween(from,to,holidays,paused=[]){
  let count=0;
  for(let day=shift(from,1);day<=to;day=shift(day,1))if(isWorkingDay(day,holidays)&&!paused.some(p=>day>p.from&&day<=p.to))count++;
  return count;
}
export function addWorkingDays(from,days,holidays){
  let day=from;
  for(let left=days,guard=0;left>0&&guard<2000;guard++){day=shift(day,1);if(isWorkingDay(day,holidays))left--;}
  return day;
}

// Waiting on the requester does not count against the department: the clock stops from a return until the resubmission.
export function pausedIntervals(db,requestId){
  return db.prepare("SELECT revision,decided_at FROM approval_steps WHERE request_id=? AND status='returned' ORDER BY decided_at").all(requestId).map(step=>{
    const resumed=db.prepare('SELECT created_at FROM request_versions WHERE request_id=? AND revision>? ORDER BY revision LIMIT 1').get(requestId,step.revision)?.created_at;
    return {from:riyadhDate(step.decided_at),to:resumed?riyadhDate(resumed):null};
  });
}
// ── الزمن الأقصر من يوم عمل (مسح 20 سبتمبر، العطب 9) ─────────────────────────────
// بلاغ أمني أو انقطاع خدمة أو بلاغ سلامة لا يحتمل «يوم عمل واحد» — وهو أقصر ما كان الدليل يقبله،
// فبلاغ الخميس ظهرًا يستحق الأحد. الزمن بالساعات يُقاس داخل نافذة عمل اليوم نفسها التي تُقاس بها الأيام:
// الأحد–الخميس دون العطل المعتمدة، ومن 09:00 إلى 17:00 بتوقيت الرياض — ثماني ساعات، وهو المقسوم نفسه
// المكتوب في مسودة قواعد الحضور (hour_divisor_hours:8). النافذة إعداد المنصة لا قرار مالك إجراء:
// من يملك الإجراء يحدد رقم الساعات، لا طول يوم العمل.
// بلاغ يصل خارج النافذة تبدأ ساعته عند فتحها التالي، فلا تُحتسب على المنفذ ساعة لم يكن فيها دوام.
export const SERVICE_DAY={start:'09:00',end:'17:00'};
const RIYADH_OFFSET=3*3600000; // الرياض UTC+3 بلا توقيت صيفي
const minutesOf=clock=>{const [h,m]=clock.split(':').map(Number);return h*60+m;};
const clockOf=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const OPEN=minutesOf(SERVICE_DAY.start),CLOSE=minutesOf(SERVICE_DAY.end);
// لحظة بتوقيت الرياض: يومها ودقيقتها من بدايته.
export function riyadhStamp(value){
  const t=new Date(Date.parse(value)+RIYADH_OFFSET);
  return {date:t.toISOString().slice(0,10),minutes:t.getUTCHours()*60+t.getUTCMinutes()};
}
const inPause=(day,paused)=>paused.some(p=>day>p.from&&day<=p.to);
// ساعات العمل المنقضية بين لحظتين، بإسقاط ما خرج عن النافذة وما وقع في انتظار صاحب الطلب.
export function workingHoursBetween(from,to,holidays,paused=[]){
  const a=riyadhStamp(from),b=riyadhStamp(to);
  if(b.date<a.date)return 0;
  let minutes=0;
  for(let day=a.date,guard=0;day<=b.date&&guard<2000;day=shift(day,1),guard++){
    if(!isWorkingDay(day,holidays)||inPause(day,paused))continue;
    const start=Math.max(OPEN,day===a.date?a.minutes:OPEN),end=Math.min(CLOSE,day===b.date?b.minutes:CLOSE);
    if(end>start)minutes+=end-start;
  }
  return minutes/60;
}
// موعد الاستحقاق بعد عدد ساعات عمل من لحظة: يعيد يومه ووقته بتوقيت الرياض.
export function addWorkingHours(from,hours,holidays){
  let {date,minutes}=riyadhStamp(from);
  if(!isWorkingDay(date,holidays)||minutes>=CLOSE){date=addWorkingDays(date,1,holidays);minutes=OPEN;}
  else if(minutes<OPEN)minutes=OPEN;
  for(let left=Math.round(hours*60),guard=0;left>0&&guard<2000;guard++){
    const available=CLOSE-minutes;
    if(left<=available){minutes+=left;break;}
    left-=available;date=addWorkingDays(date,1,holidays);minutes=OPEN;
  }
  return {date,at:clockOf(minutes),iso:new Date(Date.parse(`${date}T00:00:00Z`)+minutes*60000-RIYADH_OFFSET).toISOString()};
}

// المسودة لم تُقدَّم فلا استحقاق لها؛ وهذه هي الحالات النهائية التي تتوقف عندها الساعة ولا يُمحى استحقاقها.
const FINISHED=['completed','cancelled','rejected'];
// الزمن المستهدف إما عدد أيام (الشكل القديم حرفًا بحرف) أو {days,hours}. الساعات، حين تُحدَّد، هي المقياس.
const targetOf=target=>typeof target==='object'&&target!==null?{days:target.days??0,hours:target.hours??0}:{days:target,hours:0};
// الحساب نفسه بلا قاعدة بيانات: لحظة التقديم، وفترات الانتظار، واللحظة المرجعية.
export function computeClock({status,submitted,submitted_at=null,closed_at=null,pauses=[]},target,holidays,asOf,asOfAt=null){
  const {days,hours}=targetOf(target);
  const basis=hours?'working_hours':'working_days';
  // الطلب المعاد يحتفظ بعمر (الموجة 2، العطب 4): الساعة متوقفة على الإدارة، لكن «منذ متى ينتظر صاحبه» يبقى معروفًا —
  // paused_since يوم الإعادة، وpaused_days أيام العمل منذها. إضافتان فقط؛ لا حقل قائم يتغير معناه، وخدمة بلا زمن مستهدف تحملهما أيضًا.
  const open=FINISHED.includes(status)||status==='draft'?null:pauses.find(p=>!p.to)??null;
  const waiting={paused_since:open?.from??null,paused_days:open?workingDaysBetween(open.from,asOf,holidays):null};
  const none={target_days:days,target_hours:hours||null,due_on:null,due_at:null,overdue:false,days_left:null,paused:false,basis,...waiting};
  if((!days&&!hours)||status==='draft'||!submitted)return none;
  const closed=FINISHED.includes(status);
  // العطب 12: الطلب المغلق كان يفقد تاريخ استحقاقه، فلا يُقرأ من صفحته هل التُزم بزمنه. يُحسب الآن عند الإغلاق
  // بلحظة إغلاقه، فيبقى الالتزام مقروءًا من الطلب نفسه لا من لوحة أخرى.
  const reference=closed?(closed_at??asOfAt??`${asOf}T00:00:00Z`):(asOfAt??`${asOf}T23:59:59Z`);
  const referenceDay=closed?riyadhStamp(reference).date:asOf;
  const intervals=pauses.map(p=>({from:p.from,to:p.to??referenceDay}));
  if(hours){
    const start=submitted_at??`${submitted}T00:00:00Z`;
    const elapsed=workingHoursBetween(start,reference,holidays,intervals);
    const held=pauses.some(p=>!p.to)&&!closed;
    // الانتظار على صاحب الطلب يؤجل الاستحقاق بقدر ما استغرق، فلا يُحمَّل على الإدارة.
    const waited=workingHoursBetween(start,reference,holidays)-elapsed;
    const due=addWorkingHours(start,hours+waited,holidays);
    const left=hours-elapsed;
    return {target_days:days,target_hours:hours,due_on:held?null:due.date,due_at:held?null:due.iso,overdue:left<0,
      hours_left:Math.round(left*100)/100,elapsed_hours:Math.round(elapsed*100)/100,days_left:null,paused:held,closed_on:closed?referenceDay:null,
      met:closed?elapsed<=hours:null,basis,...waiting};
  }
  const paused=pauses.some(p=>!p.to)&&!closed;
  const elapsed=workingDaysBetween(submitted,referenceDay,holidays,intervals);
  const left=days-elapsed;
  if(closed){
    const waited=workingDaysBetween(submitted,referenceDay,holidays)-elapsed;
    return {target_days:days,target_hours:null,due_on:addWorkingDays(submitted,days+waited,holidays),due_at:null,overdue:left<0,
      days_left:left,elapsed_days:elapsed,paused:false,closed_on:referenceDay,met:elapsed<=days,basis};
  }
  // due_on يبقى «التاريخ المتوقع» فيُحجب بعد فواته (لا يُعطى تاريخ جديد لا يلتزم به أحد). target_on هو يوم الاستحقاق
  // نفسه ولو فات: تحتاجه قائمة «ما عليّ» لتقول متى استُحق البند المتأخر، لا أنه «متأخر» بلا تاريخ.
  return {target_days:days,target_hours:null,due_on:paused||left<0?null:addWorkingDays(asOf,left,holidays),due_at:null,overdue:left<0,
    days_left:left,elapsed_days:elapsed,paused,closed_on:null,met:null,basis,target_on:paused?null:targetDay(submitted,days,holidays,intervals),...waiting};
}
// اليوم الذي يكتمل فيه عدد أيام العمل المستهدفة من يوم التقديم، بإسقاط فترات الانتظار على صاحب الطلب.
function targetDay(submitted,days,holidays,intervals){
  let day=submitted;
  for(let left=days,guard=0;left>0&&guard<4000;guard++){day=shift(day,1);if(isWorkingDay(day,holidays)&&!inPause(day,intervals))left--;}
  return day;
}
export function clockFor(db,r,target,holidays=holidaySet(db,r.tenant_id),asOf=riyadhDate(Date.now())){
  const {days,hours}=targetOf(target);
  if(r.status==='draft')return computeClock({status:r.status,submitted:null,pauses:[]},target,holidays,asOf);
  // بلا زمن مستهدف لا استحقاق يُحسب، لكن عمر الانتظار عند صاحب الطلب المعاد يُحسب: فترات الانتظار تُقرأ في الحالتين.
  if(!days&&!hours)return computeClock({status:r.status,submitted:null,pauses:pausedIntervals(db,r.id)},target,holidays,asOf);
  const submitted=db.prepare('SELECT created_at FROM request_versions WHERE request_id=? ORDER BY revision LIMIT 1').get(r.id)?.created_at??r.created_at;
  // لحظة الإغلاق = آخر تحديث للطلب بعد انتقاله إلى حالة نهائية.
  const closedAt=FINISHED.includes(r.status)?r.updated_at??null:null;
  return computeClock({status:r.status,submitted:riyadhDate(submitted),submitted_at:submitted,closed_at:closedAt,pauses:pausedIntervals(db,r.id)},target,holidays,asOf);
}
