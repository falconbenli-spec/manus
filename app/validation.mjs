import { fail, AppError } from './auth.mjs';
export function object(value, allowed) {
  if (!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))) fail(400,'invalid_fields','حقول الطلب مو صحيحة');
  return value;
}
// D-24 (تدقيق مسارات الوحدات، 20 سبتمبر): كل إخفاق طول كان يُعلن «قيمة غير صالحة» — لا القيد ولا الإصلاح.
// واللهجة نزلت على ما حولها: «أدخلت» و«كحد أقصى» تبقيان بحرفهما لأن tests/module-fixes-employee.test.mjs (D-24)
// يقرؤهما نصًّا، ولا يُعدَّل اختبار مسجَّل ليمرّ.
// الرسالة الآن تقول ما المطلوب وما أُدخل بالضبط، وتُرفق details ليبرز النموذج الحقل نفسه.
const CHAR=n=>n===1?'حرف واحد':n===2?'حرفان':n<=10?`${n} أحرف`:`${n} حرفًا`;
function badText(label,rule,details){
  throw Object.assign(new AppError(400,'invalid_text',`${label}: ${rule}`),{details});
}
export function text(value, label, max=3000, min=1) {
  // الحقل الاختياري (min=0) يقبل النص الفارغ كما كان؛ الفارغ لا يُعد ناقصًا إلا حين يكون له حد أدنى.
  if (value===undefined||value===null||(value===''&&min>0)) badText(label,`مطلوب — اكتب ${min<=1?'قيمة':`${CHAR(min)} على الأقل`}`,{label,min_length:min,max_length:max,reason:'missing'});
  if (typeof value!=='string') badText(label,'اكتب نص، مو رقم ولا قائمة',{label,min_length:min,max_length:max,reason:'type'});
  if (value.includes('\0')) badText(label,'فيه محرف مو مسموح — أعد كتابته نص عادي',{label,reason:'control_character'});
  const length=value.trim().length;
  if (length<min) badText(label,`${CHAR(min)} على الأقل — أدخلت ${CHAR(length)}`,{label,min_length:min,max_length:max,length,reason:'too_short'});
  if (value.length>max) badText(label,`${CHAR(max)} كحد أقصى — أدخلت ${CHAR(value.length)}، اختصر ${CHAR(value.length-max)}`,{label,min_length:min,max_length:max,length:value.length,reason:'too_long'});
  return value.trim();
}
// D-24: مبلغ غائب كان يُعلن «مبلغ بخانتين عشريتين كحد أقصى» كأنه مكتوب خطأ. مصدر واحد للرسالة تستعمله المصروفات والمزايا.
export function moneyMinor(value, label) {
  if (value===undefined||value===null||value==='')
    throw Object.assign(new AppError(400,'missing_field',`${label}: مطلوب — اكتب المبلغ بالريال، مثل 1250.00`),{details:{label,reason:'missing',example:'1250.00'}});
  if (typeof value!=='string')
    throw Object.assign(new AppError(400,'invalid_money',`${label}: اكتب المبلغ بالأرقام اللاتينية، مثل 1250.00`),{details:{label,reason:'type',example:'1250.00'}});
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value))
    throw Object.assign(new AppError(400,'invalid_money',`${label}: رقم موجب لين ثمان خانات صحيحة وخانتين عشريتين، مثل 1250.00 — أدخلت «${value.slice(0,40)}»`),{details:{label,reason:'format',example:'1250.00'}});
  const [whole,fraction='']=value.split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if (minor<=0) throw Object.assign(new AppError(400,'invalid_money',`${label}: خلّ المبلغ أكبر من صفر`),{details:{label,reason:'zero'}});
  return minor;
}
// D-14: «الإجراء غير متاح» وحده لا يقول شيئًا، بينما اللوحة المجاورة تحسب السبب الحقيقي أصلًا.
// الرفض يُبنى هنا من الحالة نفسها التي تبني بها الشاشة أزرارها: ما طُلب، وحالة السجل، ولماذا امتنع، وما المتاح الآن، ومن يفتحه.
export function actionUnavailable(action,{subject='هذا السجل',state_name=null,reason=null,available=[],names={},who=null,code='action_unavailable',status=409}={}){
  const label=key=>names[key]??key;
  const parts=[`ما ينفع «${label(action)}» على ${subject} الحين`];
  if(state_name)parts.push(`الحالة: ${state_name}`);
  if(reason)parts.push(reason);
  parts.push(available.length?`المتاح لك الآن: ${available.map(label).join('، ')}`:'ولا إجراء متاح لك عليه الحين');
  if(who)parts.push(who);
  throw Object.assign(new AppError(status,code,parts.join('. ')+'.'),
    {details:{action,state_name,reason,available,who}});
}
// «تغيرت المعاملة…» و«الحقل مطلوب: …» تبقيان بحرفهما: تثبّتهما اختبارات مسجَّلة (tests/catalog-home.test.mjs
// وtests/portal-fixes-round2.test.mjs)، ولا يُعدَّل اختبار مسجَّل ليمرّ. وكذلك «المتاح لك الآن» و«ولا إجراء متاح»
// في actionUnavailable أعلاه: نصّهما جزء مقروء في tests/module-fixes-employee.test.mjs.
export function version(value, expected) {
  if (!Number.isInteger(value)||value!==expected) fail(409,'stale_version','تغيرت المعاملة. أعد تحميلها قبل المتابعة');
}
export function date(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value) fail(400,'invalid_date','التاريخ هذا مو صحيح');
  return value;
}
// قواعد الحقل التي يفرضها هذا الملف، وهي وحدها ما يلزم تخزينه مع نسخة الخدمة (مسح الكتالوج 20 سبتمبر،
// العطبان 2 و3): ما لا يُخزَّن لا يصل validatePayload فلا يُفرض. تُعرَّف هنا لأن هذا هو الفارض،
// ولأن service-catalog.mjs وworkflow.mjs يستوردان أحدهما الآخر فلا يصلح أيٌّ منهما موضعًا لها.
export const FIELD_RULE_KEYS=['min_length','max_length','pattern','pattern_message','show_when'];
// نموذج الحقل الموسّع (hint/example/why/min_length/max_length/pattern/show_when) كله اختياري:
// حقل بلا أي من هذه المفاتيح يتحقق منه كما كان قبلها حرفًا بحرف.
// شرط الظهور يُقرأ من قيمة حقل آخر في النموذج نفسه. شرط يشير إلى حقل غير موجود لا يخفي شيئًا،
// حتى لا يختفي حقل مطلوب بسبب خطأ في التعريف.
export function fieldVisible(field, payload, fields) {
  const rule=field?.show_when;
  if(!rule||typeof rule!=='object'||typeof rule.field!=='string') return true;
  if(Array.isArray(fields)&&!fields.some(f=>f.key===rule.field)) return true;
  const expected=Array.isArray(rule.equals)?rule.equals:[rule.equals];
  return expected.includes(payload?.[rule.field]);
}
export const visibleFields=(fields,payload)=>fields.filter(f=>fieldVisible(f,payload,fields));
export function validatePayload(fields, payload, required) {
  object(payload,fields.map(f=>f.key));
  const clean={};
  // B9 (تدقيق 19 سبتمبر): كان النقص يُعلن حقلًا حقلًا، فيصحح صاحب الطلب واحدًا ليكتشف التالي، ثم التالي.
  // تُجمع الحقول الناقصة كلها في رسالة واحدة، وتبقى أسماؤها في details ليبرزها النموذج.
  const missing=[];
  for(const field of fields) {
    // الحقل المخفي بشرطه لا يُطلب ولا تدخل قيمته السجل، ولو أرسلتها الواجهة بعد تغيير الاختيار.
    if(!fieldVisible(field,payload,fields)) continue;
    const value=payload[field.key];
    if((value===undefined||value==='')&&required&&field.required) missing.push(field);
  }
  if(missing.length) throw Object.assign(new AppError(400,'missing_field',
    missing.length===1?`الحقل مطلوب: ${missing[0].label}`:`حقول مطلوبة ما كمّلتها (${missing.length}): ${missing.map(f=>f.label).join('، ')}`),
    {details:{fields:missing.map(f=>f.key)}});
  for(const field of fields) {
    const value=payload[field.key];
    if(!fieldVisible(field,payload,fields)) continue;
    if(value===undefined||value==='') continue;
    // الخطأ تحت حقله (مركز الخدمات، الدفعة الثالثة): كل رفضٍ على حقل يحمل details.field بمفتاح الحقل ليرسمه النموذج
    // تحت الحقل نفسه بـaria-invalid، والرسالة والرمز كما كانا حرفًا بحرف (الاختبارات المسجَّلة تقرؤهما لا المفتاح).
    const fieldFail=(code,message)=>{throw Object.assign(new AppError(400,code,message),{details:{field:field.key,label:field.label}});};
    try{
      // حدّ الطول المعلَن في الكتالوج يُرفض برسالة تقول المدى المقبول قبل الرسالة العامة، ورمز الرفض
      // كما هو (invalid_text) فلا يتغير عقد أي مسار آخر. الحقل بلا حدّ معلَن يمضي كما كان حرفًا بحرف.
      if(typeof value==='string'&&(field.min_length!==undefined||field.max_length!==undefined)){
        if(field.min_length!==undefined&&value.trim().length<field.min_length)fieldFail('invalid_text',`${field.label}: اكتب ${field.min_length} حرفًا على الأقل`);
        if(field.max_length!==undefined&&value.length>field.max_length)fieldFail('invalid_text',`${field.label}: ${field.max_length} حرف على الأكثر`);
      }
      clean[field.key]=text(value,field.label,field.max_length??3000,field.min_length??1);
      if(field.type==='date') date(clean[field.key]);
      if(field.type==='select'&&!field.options.includes(clean[field.key])) fieldFail('invalid_option','اختر قيمة من القائمة');
      if(field.type==='number'&&!/^\d{1,12}(?:\.\d{1,2})?$/.test(clean[field.key])) fieldFail('invalid_number',`${field.label}: اكتب رقم موجب بخانتين عشريتين على الأكثر`);
      // رسالة الصيغة تقول ما الصواب لا ما الخطأ، ولذلك تأتي من تعريف الحقل نفسه.
      if(field.pattern&&!new RegExp(field.pattern).test(clean[field.key])) fieldFail('invalid_format',`${field.label}: ${field.pattern_message??'الصيغة مو مطابقة للمطلوب'}`);
    }catch(error){
      // ما رفضه text() وdate() يحمل تفاصيله (السبب والحدود) ويُضاف إليه مفتاح الحقل وحده؛ لا يُمسّ رمزٌ ولا نصّ.
      if(error instanceof AppError&&error.status===400)error.details={...(error.details??{}),field:field.key,label:field.label};
      throw error;
    }
  }
  if(clean.start_date&&clean.end_date&&clean.end_date<clean.start_date) fail(400,'date_order','تاريخ النهاية قبل تاريخ البداية — صحّح التواريخ');
  return clean;
}
