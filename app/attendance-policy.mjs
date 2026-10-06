import { AppError, fail } from './auth.mjs';
import * as v from './validation.mjs';

// قواعد الحضور من اللائحة، دوال صافية بلا قاعدة بيانات.
// لا قيمة نظامية مكتوبة هنا تسري بذاتها: السقوف والنسب وساعات رمضان وسقف الاستئذان ومدة حفظ الإحداثيات
// معاملات في سياسة «ساعات العمل والحضور» (working_time) تستشهد بمادتها، ولا تسري إلا بعد قبول مدير الموارد البشرية.
// ما يلي «مسودة مقترحة» تُعرض على مُعد السياسة، والمواد المذكورة من لائحة الشركة كما وردت في تقرير الفجوات.
// نافذة رمضان 1448هـ كما يجدولها تقويم أم القرى: 1 رمضان = الاثنين 8 فبراير 2027، و29 رمضان = الاثنين 8 مارس 2027، و1 شوال = الثلاثاء 9 مارس
// (شهر من 29 يومًا في الجدولة). تحققٌ (مراجعة 22 سبتمبر): طوبقت على جدول تقويم أم القرى المضمّن في ICU (islamic-umalqura، المولَّد من جداول مدينة
// الملك عبدالعزيز للعلوم والتقنية وبه تعرض الأجهزة التاريخ الهجري في السعودية) — اختبار آلي في tests/signed-regulation-round-2.test.mjs — بعد أن اتفقت
// عليها ثلاثة مصادر ثانوية؛ موقع المدينة الرسمي نفسه تعذر فتحه من بيئة العمل. البداية ثابتة جدوليًا وقد تتقدم أو تتأخر يومًا بالرؤية، والنهاية أضعف:
// إن لم يُر الهلال مساء 8 مارس أُكمل الشهر ثلاثين إلى 9 مارس. لذلك النافذة «مبدئية حتى إعلان الرؤية» مهما كان مصدر الجدولة، والتعميم السنوي الذي
// توجبه م84(4) (ص 29) هو المصدر التشغيلي لا هذه الجدولة. ساعات الدوام (البداية والنهاية) قرار الشركة داخل حد الست ساعات، لا رقم من اللائحة.
export const RAMADAN_1448=Object.freeze({from:'2027-02-08',to:'2027-03-08',start:'09:00',end:'15:00',hijri:'1–29 رمضان 1448هـ',provisional:true,
  note:'النافذة من تقويم أم القرى كما تنشره مصادر ثانوية مبنية عليه (المصدر الرسمي تعذر فتحه): البداية قد تتقدم أو تتأخر يومًا بالرؤية، والنهاية قد تمتد إلى 9 مارس 2027 إن أُكمل الشهر ثلاثين. تعميم الموارد البشرية السنوي (م84(4)) هو المرجع عند الاختلاف، وتُعدَّل السياسة بنسخة جديدة لا بتصحيح صامت.',
  sources:['جدول تقويم أم القرى المضمّن في ICU/CLDR (islamic-umalqura، من جداول مدينة الملك عبدالعزيز للعلوم والتقنية) — تحقق آلي: 1 رمضان 1448 = 2027-02-08، 29 رمضان = 2027-03-08، 1 شوال = 2027-03-09','al-habib.info — تقويم أم القرى 2027م','hijri-gregorian.com — 1 رمضان 1448هـ','islamicdates.org — رمضان 2027 (محسوب فلكيًا على معيار أم القرى)']});
export const RULE_ARTICLES={
  // م73(2) (ص 25): «تكون ساعات العمل (ثماني) ساعات عمل يوميًا تخفض إلى (ست) ساعات يوميا في شهر رمضان للعمال المسلمين»؛ م74(2) (ص 25): «تخفض ساعات
  // العمل خلال شهر رمضان المبارك بحيث لا تزيد على (36) ست وثلاثين ساعة عمل فعلية في الأسبوع». الحدان لا يتصالحان حسابيًا (5 أيام × 6 = 30 لا 36)،
  // فيُفرضان معًا: لا يزيد اليوم على ست ولا الأسبوع على ست وثلاثين. وقيد «العمال المسلمين» في م73(2) وحدها؛ المنصة لا تحمل حقل ديانة
  // فتطبّق الكتلة على الجميع، وهذا قرار يُعرض على مدير الموارد البشرية مع المسودة لا تحسمه الشيفرة.
  ramadan:'م73(2) وم74(2) (ص 25 من النسخة الموقعة): ست ساعات يوميًا للعمال المسلمين، وبما لا يزيد على ست وثلاثين ساعة عمل فعلية أسبوعيًا؛ يُفرض الحدان معًا. المنصة تطبّق ساعات رمضان على كل من تحكمه السياسة لأنها لا تحمل حقل ديانة',
  // كل رقم بمادته المطبوعة في النسخة الموقعة (م76 ص 26–27، م77 ص 27). قسمة الأجر ليست من م76 ولا م77: الشهر ثلاثون يومًا من م50(1) (ص 19: «لغرض احتساب
  // الحقوق المالية يعد الشهر (30) يومًا»)، وساعات اليوم ثمانٍ من م73(2) (ص 25).
  overtime:'م76(1) تكليف كتابي أو إلكتروني بعدد الساعات والأيام؛ م77(2) مدير الإدارة يقر؛ م77(3) موافقة مسبقة من صاحب الصلاحية؛ م77(7) ميزانية معتمدة وموافقة مكتوبة من الموارد البشرية؛ م76(2) وم77(4) أجر الساعة مضافًا إليه 50% من أجر الساعة الأساسي ويُصرف نهاية الشهر؛ م77(5) سقف سنوي ستة أشهر من الأجر الأساسي؛ م77(8) سقوف 3 ساعات في يوم العمل و8 في العطلة الرسمية و20 أسبوعيًا؛ م77(6) إجازة تعويضية بموافقة العامل ويُدفع الأجر نقدًا عند انتهاء الخدمة؛ م77(9) لا جمع مع مهمة رسمية خلال أيام العمل المعتادة. قسمة الأجر: الشهر 30 يومًا من م50(1) واليوم 8 ساعات من م73(2)، لا من م76 ولا م77',
  permission:'م74(8) وم75: الانصراف المبكر بإذن المدير، وإشعار التأخر أو الغياب في يومه. السقف الشهري لم تحدده اللائحة — قرار مدير الموارد البشرية',
  location:'قرار الشركة ونظام حماية البيانات الشخصية: الموقع قرينة تُعلَّم ولا تمنع، وتُمسح الإحداثيات الخام بعد مدة معلنة'
};
export const RULE_DRAFT={
  // المسودة المعروضة على مُعد السياسة تحمل نافذة 1448هـ مبدئيةً؛ ما يُترك فارغًا لا يسري، وما يُقبل يُقبل بهوية مدير الموارد البشرية.
  ramadan:{from:RAMADAN_1448.from,to:RAMADAN_1448.to,start:RAMADAN_1448.start,end:RAMADAN_1448.end},
  overtime:{daily_cap_minutes:180,holiday_cap_minutes:480,weekly_cap_minutes:1200,annual_cap_basic_months:6,basic_share_bp:5000,hour_divisor_days:30,hour_divisor_hours:8},
  permission_monthly_cap_minutes:null,
  location:{retention_days:null,privacy_notice:'',max_accuracy_m:100}
};

// أيام العمل حين لا سياسة ساعات عمل معتمدة: نص م73(1) كما طُبع (ص 25 من النسخة الموقعة): «يكون عدد أيام العمل 5 أيام في الأسبوع، ويكون (يوم/ يومي)
// الجمعة, السبت الراحة الأسبوعية». ليست افتراضًا من الشيفرة بل الأصل المكتوب، والسياسة المعتمدة تغلبه (م73(1) تجيز الاستبدال). 0 الأحد … 6 السبت.
export const REGULATION_WORKDAYS=Object.freeze([0,1,2,3,4]);
const CLOCK=/^([01]\d|2[0-3]):[0-5]\d$/;
export const minutesOf=clock=>{const [h,m]=clock.split(':').map(Number);return h*60+m;};
export const clockOf=minutes=>`${String(Math.floor(minutes/60)%24).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
function integer(value,label,min,max){if(!Number.isInteger(value)||value<min||value>max)fail(400,'invalid_number',`${label}: عدد صحيح بين ${min} و${max}`);return value;}
function clock(value,label){if(typeof value!=='string'||!CLOCK.test(value))fail(400,'work_hours',`${label}: الوقت بصيغة 09:00`);return value;}
const span=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;

// المعاملات الاختيارية لسياسة ساعات العمل. تُستدعى من preparePolicy؛ ما لم يُرسل لا يُحفظ فلا يسري.
export const RULE_KEYS=['ramadan','overtime','permission_monthly_cap_minutes','location'];
export function attendanceRuleParameters(p,workdays){
  const out={},citations={};
  if(p.ramadan!==undefined&&p.ramadan!==null){
    const r=v.object(p.ramadan,['from','to','start','end']),from=v.date(r.from),to=v.date(r.to);
    if(to<from||span(from,to)>31)fail(400,'ramadan','فترة رمضان تاريخان متتاليان لا تزيد على 31 يومًا');
    const start=clock(r.start,'بداية دوام رمضان'),end=clock(r.end,'نهاية دوام رمضان'),daily=minutesOf(end)-minutesOf(start);
    if(daily<=0)fail(400,'ramadan','نهاية دوام رمضان بعد بدايته');
    if(daily>360)fail(400,'ramadan','دوام رمضان لا يزيد على ست ساعات يوميًا (م73(2))');
    if(daily*workdays.length>2160)fail(400,'ramadan','دوام رمضان لا يزيد على ست وثلاثين ساعة أسبوعيًا (م74(2))');
    // النافذة المبدئية لسنة 1448هـ تُعلَّم في المعاملات نفسها إن طابقتها، فيقرأ القابل أن النهاية رهن الرؤية ولا يظنها إعلانًا.
    const provisional=from===RAMADAN_1448.from&&to===RAMADAN_1448.to;
    out.ramadan={from,to,start,end,daily_minutes:daily,weekly_minutes:daily*workdays.length,...(provisional?{hijri:RAMADAN_1448.hijri,provisional:true,provisional_note:RAMADAN_1448.note}:{})};citations.ramadan=RULE_ARTICLES.ramadan;
  }
  if(p.overtime!==undefined&&p.overtime!==null){
    const o=v.object(p.overtime,Object.keys(RULE_DRAFT.overtime));
    out.overtime={daily_cap_minutes:integer(o.daily_cap_minutes,'سقف العمل الإضافي في يوم العمل بالدقائق',15,720),holiday_cap_minutes:integer(o.holiday_cap_minutes,'سقف العمل الإضافي في يوم العطلة بالدقائق',15,720),
      weekly_cap_minutes:integer(o.weekly_cap_minutes,'السقف الأسبوعي بالدقائق',15,3600),annual_cap_basic_months:integer(o.annual_cap_basic_months,'السقف السنوي بأشهر الأساسي',1,24),
      basic_share_bp:integer(o.basic_share_bp,'نسبة الأساسي المضافة بنقاط الأساس (50% = 5000)',0,20000),hour_divisor_days:integer(o.hour_divisor_days,'أيام الشهر في قسمة الأجر',28,31),hour_divisor_hours:integer(o.hour_divisor_hours,'ساعات اليوم في قسمة الأجر',1,12)};
    if(out.overtime.weekly_cap_minutes<out.overtime.daily_cap_minutes)fail(400,'overtime','السقف الأسبوعي لا يقل عن سقف اليوم');
    citations.overtime=RULE_ARTICLES.overtime;
  }
  if(p.permission_monthly_cap_minutes!==undefined&&p.permission_monthly_cap_minutes!==null){out.permission_monthly_cap_minutes=integer(p.permission_monthly_cap_minutes,'سقف الاستئذان الشهري بالدقائق',15,6000);citations.permission=RULE_ARTICLES.permission;}
  if(p.location!==undefined&&p.location!==null){
    const l=v.object(p.location,['retention_days','privacy_notice','max_accuracy_m']);
    out.location={retention_days:integer(l.retention_days,'مدة حفظ الإحداثيات الخام بالأيام',1,365),privacy_notice:v.text(l.privacy_notice,'نص إشعار الخصوصية',3000,40),max_accuracy_m:integer(l.max_accuracy_m,'أسوأ دقة تُقبل قرينةً بالأمتار',10,1000)};
    citations.location=RULE_ARTICLES.location;
  }
  if(Object.keys(citations).length)out.citations=citations;
  return out;
}

// ساعات اليوم الفعلية: الوردية المسندة أولًا، ثم ساعات رمضان إن وقع التاريخ في فترته، ثم الدوام العام.
export function effectiveHours(base,shift,date){
  if(!base)return null;
  if(shift)return {...base,...shift,ramadan_day:false};
  const r=base.ramadan;
  if(r&&r.from<=date&&date<=r.to)return {...base,start:r.start,end:r.end,ramadan_day:true};
  return {...base,ramadan_day:false};
}
export const expectedMinutes=hours=>{if(!hours)return 0;const d=minutesOf(hours.end)-minutesOf(hours.start);return d>0?d:d+1440;};

// هل يغطي إذن معتمد فترة التأخر (من بداية الدوام حتى الحضور) أو فترة الانصراف المبكر (من الانصراف حتى نهاية الدوام)؟
export function covers(permissions,from,to){return permissions.find(p=>minutesOf(p.from_time)<=from&&minutesOf(p.to_time)>=to)??null;}

// المسافة على سطح الأرض بالمتر (هافرساين، نصف قطر 6371008.8 م).
export function haversine(lat1,lng1,lat2,lng2){
  const R=6371008.8,rad=d=>d*Math.PI/180,dLat=rad(lat2-lat1),dLng=rad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(a)));
}
// الحكم من الخادم وحده: أقرب موقع معتمد، والمسافة مقربة إلى أقرب 10 أمتار. الدقة الأسوأ من الحد لا تُعد قرينة.
export function classifyLocation(sites,location,maxAccuracy){
  if(!location)return {zone:'no_location',site_id:null,distance_m:null,accuracy_m:null};
  let best=null;
  for(const s of sites){const d=haversine(location.lat,location.lng,s.lat,s.lng);if(!best||d-s.radius_m<best.d-best.site.radius_m)best={site:s,d};}
  const accuracy=Math.round(location.accuracy),distance=best?Math.round(best.d/10)*10:null;
  if(!best)return {zone:'no_location',site_id:null,distance_m:null,accuracy_m:accuracy};
  if(accuracy>maxAccuracy)return {zone:'no_location',zone_note:'low_accuracy',site_id:best.site.id,distance_m:distance,accuracy_m:accuracy};
  return {zone:best.d<=best.site.radius_m?'in_zone':'out_of_zone',site_id:best.site.id,distance_m:distance,accuracy_m:accuracy};
}
export function locationInput(value){
  if(value===undefined||value===null)return null;
  const l=v.object(value,['lat','lng','accuracy']);
  const ok=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  if(!ok(l.lat,-90,90)||!ok(l.lng,-180,180)||!ok(l.accuracy,0,100000))fail(400,'invalid_location','الموقع: خط عرض وطول ودقة بالأمتار');
  return {lat:Math.round(l.lat*1e6)/1e6,lng:Math.round(l.lng*1e6)/1e6,accuracy:l.accuracy};
}

// الأجر المقترح للعمل الإضافي بالهللات: الدقائق × (الأجر الفعلي للساعة + نسبة الأساسي من أجر الساعة الأساسي) — م76(2)، م77(4).
// أجر الساعة = الأجر الشهري ÷ أيام القسمة ÷ ساعات اليوم كما في السياسة؛ أيام القسمة (30) من م50(1) وساعات اليوم (8) من م73(2)، لا من م76/م77.
// التقريب هنا إلى الهللة (نصف فأعلى) قيمةً وسيطة مقترحة، وقاعدة التقريب ليست قرارًا مفتوحًا — م50(5) (ص 19 من النسخة الموقعة، الصفحة نفسها التي فيها
// م50(1)): «عند حساب كل من الأجور، والبدلات، والمكافآت، والتعويضات، والحسميات المنصوص عليها في هذه اللائحة؛ تُقرّب القيمة إلى أقرب ريال بالزيادة».
// المنصة تطبّقها في المسير حين يقبل مدير الموارد البشرية وضع riyal_up في سياسة قواعد الأجر (payroll-rules.mjs)؛ والمسير اليوم يقرّب بنود الاستحقاق والغياب
// والتأمينات (payroll.mjs) ويُدخل حركات الإضافات والخصومات المعتمدة — ومنها أجر العمل الإضافي هذا — بمبلغها المعتمد كما هو، وهذه فجوة مسجلة في تسليم
// الجولة الثانية لا تُسدّ صامتة هنا (مراجعة 22 سبتمبر: كان التعليق يقول إن القاعدة مفتوحة والصفحة تحسمها). وم77(4) كما طُبعت تخلط «الأجر الفعلي
// للساعة» بـ«أجر الساعة الأساسي» وأقواسها غير متوازنة، وم76(2) تقول «أجر الساعة مضافًا إليه 50% من أجره الأساسي»: أي أساس تُحسب عليه الـ50% حين يختلف
// الفعلي عن الأساسي سؤال للمالك لا تحسمه الشيفرة.
export function overtimeAmountMinor(minutes,{actual_minor,basic_minor},o){
  const divisor=o.hour_divisor_days*o.hour_divisor_hours*60;
  return Math.round(minutes*(actual_minor+basic_minor*o.basic_share_bp/10000)/divisor);
}
export const annualCapMinor=(basicMinor,o)=>basicMinor*o.annual_cap_basic_months;
// الأسبوع من الأحد إلى السبت (أيام العمل في السياسة تبدأ بالأحد).
export function weekOf(date){const d=new Date(date+'T00:00:00Z'),start=new Date(d.getTime()-d.getUTCDay()*86400000).toISOString().slice(0,10);return {from:start,to:new Date(Date.parse(start+'T00:00:00Z')+6*86400000).toISOString().slice(0,10)};}

// خدمة الكتالوج العامة «تصحيح حضور أو استئذان» (HR-ATTENDANCE-FIX): أنواعها التي صار لها سجل حضور تُوجَّه إلى شاشة الحضور
// بدل طلب عام لا يصل حالة اليوم. تُستدعى من workflow.createRequest (دالة صافية هنا كي لا تجر الوحدة سلسلة الحضور)؛ لا تكتب شيئًا.
// «نسيان بصمة» و«عمل خارج المكتب» يبقيان في الطلب العام حتى يقرر مالك الكتالوج (لهما شاشتا تصحيح ومهمة قائمتان).
export const CATALOG_ATTENDANCE_KINDS={'استئذان':'request_permission','تأخير بعذر':'request_permission'};
export function catalogAttendanceRoute(code,payload){
  if(code!=='HR-ATTENDANCE-FIX')return;
  const action=CATALOG_ATTENDANCE_KINDS[payload?.kind];
  if(action){const error=new AppError(409,'use_attendance_screen','الاستئذان والتأخير بعذر صارا سجل حضور يعتمده مديرك ويرفع علامة التأخر: اطلبه من «الحضور والانصراف» ← «طلب استئذان».');error.details={module:'attendance',action};throw error;}
}
