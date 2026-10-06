// سقوف مدة الصلاحية المؤقتة. وحدة طرفية بلا استيرادات عمدًا: تقرأ منها app/delegations.mjs — وهي منخفضة في
// شجرة الاعتماد يستوردها app/access.mjs — فأي استيراد هنا يصير دورةً تكسر التحميل في 162 وحدة (جُرّب ووقع).

// السقف في الكود يعمل بلا تبنٍّ، وهذا مقصود ويخالف قاعدة app/workflow-timers.mjs «لا قيمة افتراضية في الكود».
// السبب أن هذين الرقمين يمنعان صلاحيةً دائمة بثوب مؤقت («حتى 2099»)، وتركُ ذلك مفتوحًا حتى يُعتمد رقمٌ
// تراجعٌ أمني لا حياد فيه. فالمُتبنّى لا يفتح شيئًا: حدّ المفتاح الأعلى هو هذا السقف نفسه، فالتبني يشدّ وحده.
export const MAX_DELEGATION_DAYS=180;         // تغطية غياب — أفق أعلام التشغيل نفسه (app/feature-flags.mjs)
export const MAX_FINANCE_AUTHORITY_DAYS=365;  // دورة مالية — مقيس: كل تفويض مالي سارٍ على قاعدة التشغيل مدته 365 يومًا

// قراءة السقف المتبنّى لمفتاح، بالحراس نفسها التي في adoptedTimerRows: الحالة «متبنّى»، والوحدة مطابقة،
// وأحدث تبنٍّ. لا يُستورد workflow-timers هنا لما سبق؛ والوحدة تُطابَق صراحةً فلا يسري رقمٌ بوحدة أخرى.
// وما يتجاوز السقف لا يمر أصلًا: حدّ المفتاح الأعلى في السجل هو السقف نفسه. والحدّ الأدنى هنا حارس ثانٍ.
export function authorityCapDays(db,tenantId,key,ceiling){
  let row=null;
  try{ row=db.prepare("SELECT value FROM workflow_timer_settings WHERE tenant_id=? AND timer_key=? AND unit='calendar_days' AND status='adopted' ORDER BY adopted_at DESC LIMIT 1").get(tenantId,key); }
  catch{ return ceiling; }   // قاعدة أقدم من ترحيل المهل: السقف هو الكود
  const v=row?.value;
  return Number.isInteger(v)&&v>=1&&v<=ceiling?v:ceiling;
}
