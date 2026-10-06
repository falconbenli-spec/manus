// حجب البيانات الشخصية قبل إرسال نص إلى مزوّد نموذج خارجي.
// ما يُكشف: رقم الهوية والإقامة، IBAN السعودي، الجوال السعودي، البريد الإلكتروني.
// ما لا يُكشف: الأسماء العربية. لا نمط يميّز «سارة» أو «عبدالله» عن كلمة عادية، ولا قائمة أسماء تكفي،
// فالاسم يمر كما هو. هذا حجب جزئي لا كامل، ولا يُعرض على أنه كامل. الحل الحقيقي تقليل البيانات المرسلة أصلًا:
// لا يُرسل إلى المزوّد إلا ما يحتاجه السؤال.
// خريطة البديل ← الأصل تبقى في الذاكرة لمدة الاستدعاء فقط، ولا تُخزَّن ولا تُسلسل (انظر toJSON أدناه).

export const KINDS={iban:'IBAN سعودي',email:'بريد إلكتروني',mobile:'جوال سعودي',national_id:'رقم هوية أو إقامة'};
const TOKEN={iban:'IBAN',email:'EMAIL',mobile:'MOBILE',national_id:'NID'};
// الترتيب مقصود: IBAN أولًا لأن داخله سلاسل أرقام قد تُقرأ هوية أو جوالًا، ثم البريد، ثم الجوال، ثم الهوية.
const PATTERNS=[
  ['iban',/(?<![A-Za-z0-9])SA[ -]?\d{2}(?:[ -]?[0-9A-Z]){20}(?![A-Za-z0-9])/gi],
  ['email',/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9])/g],
  ['mobile',/(?<![\d+])(?:(?:\+|00)966[ -]?|0)5\d(?:[ -]?\d){7}(?!\d)/g],
  ['national_id',/(?<!\d)[12]\d{9}(?!\d)/g]
];
// صفر كل مجموعة أرقام عشرية في يونيكود: المجموعة عشرةُ محارف متتابعة، فصفرها أقرب محرف قبله لا يسبقه رقم (تسع خطوات كحد أقصى).
// جدولٌ كان يحصر التحويل في العربية-الهندية والفارسية يترك أرقام العرض الكامل (１٢٣) والأرقام الهندية وغيرها خارج كل فحص.
const DIGIT_ZERO=new Map();
function digitZero(code){
  if(DIGIT_ZERO.has(code))return DIGIT_ZERO.get(code);
  let base=code;
  while(base>0&&code-base<9&&/\p{Nd}/u.test(String.fromCodePoint(base-1)))base--;
  DIGIT_ZERO.set(code,base);return base;
}
// الأرقام العشرية كلها تُحوَّل لاتينية. التحويل حرف بحرف لمحارف المستوى الأساسي وحدها، فتبقى المواضع كما هي ويُقتطع الأصل من
// النص الأصلي (scan تعتمد على ذلك). الأرقام خارج المستوى الأساسي (الرياضية) تُترك هنا ويطويها NFKC في حارس الهوية أدناه.
export const normaliseDigits=text=>String(text??'').replace(/\p{Nd}/gu,d=>d.length===1?String(d.codePointAt(0)-digitZero(d.codePointAt(0))):d);
// نص واحد لامتناع المنصة عن رقم الهوية. كان في app/employee-profile.mjs (وما زال يُصدَّر منه كما هو)، ونُقل إلى هنا ليقرأه سجل التعريفات
// (app/definitions.mjs وapp/custom-fields.mjs) بلا أن يستورد وحدة عمل: الامتناع نفسه يسري على الحقول المخصّصة وقيمها.
export const NO_NATIONAL_ID='لا تُسجَّل أرقام الهوية أو الإقامة في المنصة بأي حقل، ولا يلزم تسجيلها لأي إجراء فيها.';
// ستة أرقام متتالية فأكثر = رقم هوية أو إقامة أو وثيقة كامل. (نُقل بحرفه من app/employee-profile.mjs ليحرس به سجل التعريفات
// الحقول المخصّصة أيضًا — app/custom-fields.mjs — فيبقى حارسًا واحدًا لا نسختين تنحرفان.)
//
// الفاصل لا يكسر الرقم، والحارس لا يعدّ إلا ما يبقى بعد طيّ كل فاصل. صنفُ محوٍ يحذف الفراغ والنقطة والشرطة وحدها كان يمرّر
// الرقم نفسه بثلاث صور، كلها تنطوي إلى «1098765432» في أي نسخ أو قراءة أو تصدير:
//   • محارف تنسيق لا تُرى — صفرية العرض (U+200B‑U+200D) والشرطة اللينة (U+00AD) وعلامات الاتجاه — و\s في جافاسكربت لا تشملها؛
//   • فواصل مكتوبة أخرى: الفاصلة والشرطة المائلة والشرطة السفلية وما شابهها؛
//   • أرقام العرض الكامل (１０９…) و\d لا تطابق إلا اللاتينية.
// فالقاعدة الآن: تُطبَّع القيمة NFKC، ثم يُمحى كل ما ليس حرفًا ولا رقمًا عشريًا (فيسقط كل فاصل، مرئيًّا كان أو لا)، ثم تُطوى
// الأرقام كلها لاتينيةً، ثم يُعدّ. الحروف تبقى حاجزًا: «طلب 123 وبند 456» لا يلتحمان. وسلسلةٌ طويلة من الأرقام يفصلها
// ترقيم — مبلغ أو تاريخ مكتوب بفواصل — تُرفض أيضًا، وهذا اتجاه الخطأ المقصود: الامتناع عن رقم الوثيقة قبل راحة الكتابة.
const collapse=value=>normaliseDigits(String(value??'').normalize('NFKC').replace(/[^\p{L}\p{Nd}]+/gu,''));
export const looksLikeIdentifier=value=>/\d{6,}/.test(collapse(value));
// عشرة أرقام تبدأ بـ1 أو 2 صورةُ رقم هوية أو إقامة. تُفحص على القيمة المطوية نفسها، فلا يفتح الحقل الرقمي بابًا خلفيًا.
// الكسر يُقطع قبل الطيّ لا بعده: الطيّ يمحو النقطة نفسها، فـ«1098765432.50» كان يصير اثني عشر رقمًا ويفلت من الصورة.
export const looksLikeNationalId=value=>/^[12]\d{9}$/.test(collapse(String(value??'').split('.')[0]));
const canonical=(kind,value)=>{const v=normaliseDigits(value).replace(/[ -]/g,'').toUpperCase();return kind==='mobile'?v.replace(/^(?:\+966|00966|0)/,''):v;};

// خريطة لا تُسلسل: JSON.stringify عليها يرمي خطأ، حتى لا تنتهي في قاعدة أو سجل أو استجابة سهوًا.
export class RedactionMap extends Map{
  toJSON(){throw new Error('A redaction map is held in memory only and is never serialised.');}
}
function scan(text){
  const source=String(text??''),normal=normaliseDigits(source),taken=new Array(normal.length).fill(false),found=[];
  for(const [kind,pattern] of PATTERNS){
    pattern.lastIndex=0;
    for(const m of normal.matchAll(pattern)){
      const start=m.index,end=start+m[0].length;
      if(taken.slice(start,end).some(Boolean))continue;
      for(let i=start;i<end;i++)taken[i]=true;
      found.push({kind,start,end,original:source.slice(start,end)});
    }
  }
  return {source,found:found.sort((a,b)=>a.start-b.start)};
}
// القيمة نفسها تأخذ البديل نفسه في النص كله، فيبقى المعنى مفهومًا للنموذج («[[MOBILE_1]] هو نفسه [[MOBILE_1]]»).
// لذلك تعيد restore القيمة بأول صيغة وردت بها: 0551234567 و+966551234567 بديل واحد يعود بصيغته الأولى.
export function redact(text){
  const {source,found}=scan(text),map=new RedactionMap(),seen=new Map(),counters={};
  let out='',cursor=0;
  for(const f of found){
    const key=`${f.kind}:${canonical(f.kind,f.original)}`;
    let token=seen.get(key);
    if(!token){counters[f.kind]=(counters[f.kind]??0)+1;token=`[[${TOKEN[f.kind]}_${counters[f.kind]}]]`;seen.set(key,token);map.set(token,f.original);}
    out+=source.slice(cursor,f.start)+token;cursor=f.end;
  }
  return {text:out+source.slice(cursor),map};
}
export function restore(text,map){
  if(!(map instanceof Map)||!map.size)return String(text??'');
  return String(text??'').replace(/\[\[(?:IBAN|EMAIL|MOBILE|NID)_\d+\]\]/g,token=>map.has(token)?map.get(token):token);
}
// ماذا حُجب وكم، دون القيم نفسها.
export function redactionReport(text){
  const {found}=scan(text),counts=Object.fromEntries(Object.keys(KINDS).map(k=>[k,0]));
  for(const f of found)counts[f.kind]++;
  const total=found.length;
  return {total,counts,items:Object.entries(counts).filter(([,n])=>n).map(([kind,n])=>({kind,name:KINDS[kind],count:n})),
    covers:Object.values(KINDS),
    not_covered:'الأسماء، والعناوين، وأرقام الحسابات غير السعودية، وأي وصف يعرّف الشخص دون رقم. الحجب بالأنماط جزئي؛ الأصل ألا يُرسل إلا ما يحتاجه السؤال.'};
}
// نقطة الوصل للمنسّق في app/ai.mjs: لفّ المزوّد قبل استخدامه، مثلًا في provider():
//   return withRedaction({name:'anthropic',async complete(...){...}});
// يُحجب نص المستخدم (البيانات والسؤال) قبل الإرسال، ويُعاد الأصل في الناتج قبل حفظه وعرضه لصاحبه.
// نص التعليمات (system) ثابت من الكود ولا يُحجب.
export function withRedaction(provider){
  if(!provider||typeof provider.complete!=='function')return provider;
  return {...provider,name:provider.name,redacting:true,async complete(request){
    const {text,map}=redact(request.user);
    const result=await provider.complete({...request,user:text});
    return {...result,text:restore(result?.text,map),redacted:redactionReport(request.user).counts};
  }};
}
