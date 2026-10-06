// حساب الأسابيع المشترك بين كشوف الوقت وتخطيط الموارد.
// وُضع في ملف ثالث لأن الوحدتين تحتاجانه ولا تستورد إحداهما الأخرى.
// الأسبوع يبدأ الأحد لأن أسبوع العمل هنا الأحد–الخميس (انظر work-calendar.mjs).
import { workingDaysBetween } from './work-calendar.mjs';

const DAY=86400000;
export const addDays=(date,n)=>new Date(Date.parse(`${date}T00:00:00Z`)+n*DAY).toISOString().slice(0,10);
export const weekStart=date=>addDays(date,-new Date(`${date}T00:00:00Z`).getUTCDay());
export const weekEnd=date=>addDays(weekStart(date),6);

// workingDaysBetween لا تحسب يوم البداية، فيُمرَّر اليوم السابق ليكون العد شاملًا للطرفين.
export const workingDaysIn=(from,to,holidays)=>from>to?0:workingDaysBetween(addDays(from,-1),to,holidays);

// أيام العمل في أسبوع كامل بلا عطل: الأساس الذي تُقسَّم عليه ساعات الأسبوع إلى ساعات يوم.
// يُشتق من التقويم نفسه حتى لا يكون الرقم 5 ثابتًا مكتوبًا في الكود.
export const fullWeekDays=weekFrom=>workingDaysIn(weekFrom,addDays(weekFrom,6),new Set());

export function weekStarts(from,to,max=26){
  const weeks=[];
  for(let day=weekStart(from);day<=to&&weeks.length<max;day=addDays(day,7))weeks.push(day);
  return weeks;
}

// تقاطع مدى الحجز مع الأسبوع، بأيام العمل وحدها: عطلة أو نهاية أسبوع لا تستهلك ساعات أحد.
export function overlapWorkingDays(from,to,weekFrom,holidays){
  const start=from>weekFrom?from:weekFrom,end=to<addDays(weekFrom,6)?to:addDays(weekFrom,6);
  return workingDaysIn(start,end,holidays);
}
