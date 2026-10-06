// عدّ أيام الإجازة: الوحدة نفسها يستعملها الخادم عند الحفظ ونموذج الطلب في العدّ الحي، فلا يختلف الرقمان.
// لا استيراد هنا عمدًا: الملف يعمل في المتصفح وفي الخادم بالنتيجة نفسها. الأيام بالألف من اليوم (نصف يوم = 500).
const DAY=86400000;
export const shiftDate=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*DAY).toISOString().slice(0,10);
export const weekdayOf=date=>new Date(`${date}T00:00:00Z`).getUTCDay();
export const daysText=milli=>String(Math.round(milli)/1000);
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const validDate=value=>typeof value==='string'&&ISO.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;

// كل الأيام من البداية إلى النهاية شاملة. سقف 400 يوم يمنع حلقة طويلة من إدخال خاطئ.
export function datesBetween(start,end){
  if(!validDate(start)||!validDate(end)||end<start)return [];
  const out=[];
  for(let day=start,guard=0;day<=end&&guard<400;day=shiftDate(day,1),guard++)out.push(day);
  return out;
}
// unit: working = أيام العمل في التقويم بلا العطل الرسمية؛ calendar = كل الأيام، وتُستثنى العطل الرسمية إن نصت عليها المادة.
export function countLeaveDays({start,end,unit='working',weekdays=[0,1,2,3,4],holidays=[],excludeHolidays=true,halfDay=false}){
  const off=new Set(holidays),all=datesBetween(start,end);
  const work=all.filter(d=>weekdays.includes(weekdayOf(d))&&!off.has(d));
  const counted=unit==='calendar'?all.filter(d=>!(excludeHolidays&&off.has(d))):work;
  const milli=halfDay?(counted.length===1&&start===end?500:0):counted.length*1000;
  return {counted,work_dates:work,days_milli:milli,working_days:work.length,calendar_days:all.length};
}
// آخر يوم مسموح لمدة تُقاس بالأشهر والأيام من تاريخ البداية (العدة: أربعة أشهر وعشرة أيام).
export function lastDayOf(start,{months=0,days=0}){
  const [y,m,d]=start.split('-').map(Number);
  const moved=new Date(Date.UTC(y,m-1+months,d));
  // 31 يناير + شهر = آخر فبراير لا 3 مارس.
  if(moved.getUTCDate()!==d)moved.setUTCDate(0);
  return shiftDate(moved.toISOString().slice(0,10),days-1);
}

// شرائح أجر الإجازة المرضية (م88): نافذة سنة تبدأ من أول يوم مرضي، وتُستهلك الشرائح بالترتيب الزمني.
// earlier: أيام مرضية سابقة محسوبة (معتمدة أو بانتظار الاعتماد). next: أيام الطلب الجديد. tiers: [{days,rate_bp}].
// النتيجة لكل يوم جديد نسبة أجره، أو null إن تجاوز مجموع الشرائح (يُحال إلى اللجنة الطبية ولا يُقبل آليًا).
export function sickTiers(earlier,next,tiers){
  const fresh=new Set(next),all=[...new Set([...earlier,...next])].sort();
  const limits=[];let edge=0;for(const t of tiers){edge+=t.days;limits.push({edge,rate_bp:t.rate_bp});}
  let windowStart=null,windowEnd=null,used=0;const out=[];
  for(const date of all){
    if(windowStart===null||date>windowEnd){windowStart=date;windowEnd=lastDayOf(date,{months:12,days:0});used=0;}
    const tier=limits.find(l=>used<l.edge);used++;
    if(fresh.has(date))out.push({date,rate_bp:tier?tier.rate_bp:null,window_start:windowStart,day_in_window:used});
  }
  return out;
}
// ملخص الشرائح للعرض: كم يومًا بكل نسبة.
export function tierSummary(pay){
  const map=new Map();for(const p of pay)map.set(p.rate_bp,(map.get(p.rate_bp)??0)+1);
  return [...map].sort((a,b)=>b[0]-a[0]).map(([rate_bp,days])=>({rate_bp,days}));
}

// ── الإجازة التعويضية عن العمل الإضافي (نظام العمل م107/1، اللائحة التنفيذية م22 مكرر) ──
// الحساب نفسه في الخادم وفي نموذج طلب العمل الإضافي، فالجملة التي يوافق عليها الموظف هي الجملة التي تُحفظ باسمه.
// النسبة بنقاط الأساس (ساعة ونصف = 15000) من السياسة المعتمدة لا من هنا. الكسر يُجبر لمصلحة العامل: النص «لا يقل عن».
export const compensatoryLeaveMinutes=(overtimeMinutes,ratioBp)=>Math.ceil(overtimeMinutes*ratioBp/10000);
// ردّ ساعات الإجازة غير المستعملة إلى ساعات عمل إضافي (÷ النسبة): القيد كاملًا يعود بدقائقه الأصلية، والجزء يُجبر ولا يتجاوزها.
// alreadyBack: ما رُدّ من القيد نفسه في إحالات سابقة لم تُرفض. السقف على مجموع الإحالات لا على كل إحالة، فالإحالة الأخيرة تأخذ الباقي
// ولا يعود من القيد أكثر مما عُمل (كان الجبر في كل إحالة يزيد دقيقة عند نسبة لا تقسم بلا كسر).
export function overtimeMinutesBack(leaveMinutes,credit,alreadyBack=0){
  const left=Math.max(0,credit.overtime_minutes-alreadyBack);
  if(leaveMinutes>=credit.leave_minutes)return left;
  return Math.min(left,Math.ceil(leaveMinutes*10000/credit.ratio_bp));
}
export const hoursText=minutes=>String(Math.round(minutes/60*100)/100);
export const ratioText=ratioBp=>String(Math.round(ratioBp/100)/100);
// الأيام من الساعات بساعات اليوم في سياسة ساعات العمل المعتمدة؛ بلا سياسة لا رقم: «غير قابل للقياس» لا ثمانية مفترضة.
export const compensatoryDaysText=(minutes,dailyMinutes)=>dailyMinutes?String(Math.floor(minutes*100/dailyMinutes)/100):null;
// نص موافقة الموظف. يُعرض عليه قبل الإرسال ويُحفظ كما عُرض، فلا يُسأل لاحقًا «على ماذا وافقت؟».
export function compensatoryConsentSentence({work_date,overtime_minutes,ratio_bp,use_within_days}){
  const leave=compensatoryLeaveMinutes(overtime_minutes,ratio_bp),expires=shiftDate(work_date,use_within_days);
  return `أوافق باختياري على أن أُعوَّض عن ${hoursText(overtime_minutes)} ساعة عمل إضافي يوم ${work_date} بإجازة تعويضية مدفوعة الأجر مقدارها ${hoursText(leave)} ساعة (${ratioText(ratio_bp)} ساعة إجازة عن كل ساعة عمل) بدل الأجر الإضافي، تؤخذ حتى ${expires} (${use_within_days} يومًا من يوم العمل). ما لم أستعمله منها لا يسقط: إن تركت العمل قبل استعماله فلي أجر الإجازة التعويضية المستحقة (اللائحة التنفيذية م22 مكرر/4)، وإن انقضت المهلة وأنا على رأس العمل — واللائحة ساكتة عن ذلك — اقترحت المنصة صرف أجره في المسير، ولا يقل المقترح في الحالتين عن أجر ساعاتي الإضافية الأصلية (نظام العمل م107/1).`;
}
