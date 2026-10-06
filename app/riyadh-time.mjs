// حدّ اليوم بتوقيت الرياض: مصدرٌ واحد لكل «اليوم» و«هذا الشهر» يُقارَن بطابع زمني مخزَّن.
//
// المنصة تخزّن اللحظات بـUTC (db.mjs: now() = toISOString)، وتحسب «اليوم» وبداية الشهر بتوقيت الرياض (UTC+3 طوال السنة،
// بلا توقيت صيفي). والعطب الذي قيس في 1 أكتوبر 2026 الساعة 02:05 بتوقيت الرياض (23:05 UTC من 30 سبتمبر): تاريخ الرياض
// يُقارَن حرفيًّا بطابع UTC — «created_at>='2026-10-01'» أو «substr(created_at,1,10)<=?» أو «x_at.slice(0,10)» — فيختلف
// الاثنان من 00:00 إلى 03:00 بتوقيت الرياض كل يوم، وعند بداية كل شهر وكل سنة. تكلفة المساعدين في الشهر كانت صفرًا والسقف لا يمنع.
//
// القاعدة: لا يُقارَن تاريخ الرياض بطابع UTC مباشرة. إما أن يُحوَّل التاريخ إلى لحظتَي UTC ويُقارَن الطابع باللحظتين
// (riyadhDayRange / riyadhMonthRange / riyadhYearRange، والمدى نصف مفتوح [البداية، النهاية) )، وإما أن يُحوَّل الطابع إلى
// يوم الرياض (riyadhDateOf هنا، أو date(x,'+3 hours') في SQL كما في الترحيلين 162 و163) ثم يُقارَن اليومان.
// الحارس scripts/riyadh-time-guard.mjs (ويستدعيه tests/riyadh-time.test.mjs) يعدّ الأنماط الخطرة في كل ملف ويرفض الجديد منها.
export const RIYADH_OFFSET_MS=3*3600000;
const DAY_MS=86400000;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR=/^\d{4}$/;
const iso=ms=>new Date(ms).toISOString();

// اللحظة من رقم أو Date أو نص ISO. ما لا يُقرأ خطأ مبرمج لا رفضٌ للمستخدم.
function instant(value){
  const ms=value instanceof Date?value.getTime():typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
  if(!Number.isFinite(ms))throw new TypeError(`riyadh-time: لحظة غير مقروءة: ${String(value)}`);
  return ms;
}
function day(date){
  const ms=typeof date==='string'&&DATE.test(date)?Date.parse(`${date}T00:00:00Z`):NaN;
  if(!Number.isFinite(ms)||iso(ms).slice(0,10)!==date)throw new TypeError(`riyadh-time: تاريخ غير صالح: ${String(date)}`);
  return ms;
}

// يوم الرياض لِلَحظة (الافتراض: الآن) وشهره.
export const riyadhToday=(now=Date.now())=>iso(instant(now)+RIYADH_OFFSET_MS).slice(0,10);
export const riyadhMonth=(now=Date.now())=>riyadhToday(now).slice(0,7);

// يوم الرياض لطابع UTC مخزَّن. التاريخ المجرّد (YYYY-MM-DD) تاريخٌ أصلًا فيعود كما هو، والفارغ أو غير المقروء null.
export function riyadhDateOf(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='string'&&DATE.test(value))return value;
  const ms=value instanceof Date?value.getTime():typeof value==='number'?value:Date.parse(String(value));
  return Number.isFinite(ms)?riyadhToday(ms):null;
}

// يوم الرياض لحظتان بـUTC: [منتصف ليله، منتصف ليل اليوم التالي). «2026-10-01» ← [2026-09-30T21:00Z، 2026-10-01T21:00Z).
export function riyadhDayRange(date){
  const start=day(date)-RIYADH_OFFSET_MS;
  return [iso(start),iso(start+DAY_MS)];
}
// شهر الرياض: [أول لحظة في يومه الأول، أول لحظة في الشهر التالي).
export function riyadhMonthRange(month){
  if(typeof month!=='string'||!MONTH.test(month))throw new TypeError(`riyadh-time: شهر غير صالح: ${String(month)}`);
  const [y,m]=month.split('-').map(Number);
  return [iso(Date.UTC(y,m-1,1)-RIYADH_OFFSET_MS),iso(Date.UTC(y,m,1)-RIYADH_OFFSET_MS)];
}
// سنة الرياض كذلك: [1 يناير 00:00 الرياض، 1 يناير التالي 00:00 الرياض).
export function riyadhYearRange(year){
  const text=String(year);
  if(!YEAR.test(text))throw new TypeError(`riyadh-time: سنة غير صالحة: ${text}`);
  const y=Number(text);
  return [iso(Date.UTC(y,0,1)-RIYADH_OFFSET_MS),iso(Date.UTC(y+1,0,1)-RIYADH_OFFSET_MS)];
}
