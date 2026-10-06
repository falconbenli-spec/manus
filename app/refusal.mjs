// معيار الرفض (م0 «السور»): رسالة الرفض تقول ما الذي رُفض، وما الناقص، ومن يملكه، وما الخطوة التالية — لا «الإجراء غير متاح».
// النموذج هو gateMessage في app/project-intake.mjs (يسمّي كل وثيقة ناقصة ومن يقدّمها) والشكل الذي تشاركه معها
// app/project-axes.mjs: {code, doc_key, document, why, owner, owner_role}. لا يُعدَّل أيٌّ منهما؛ هذا هو الطريق نفسه لبقية الوحدات.
// النص المقروء يُركَّب «ما رُفض: الوثيقة — مالكها؛ الخطوة التالية»، والشكل المهيكل يسافر في error.details.refusal
// (الخادم يرسل details لكل خطأ دون 500، app/server.mjs)، فترسمه الواجهة بـui.refusal من العدّة (app/static/kit.mjs).
// مسنّنة scripts/check.mjs تعدّ رسائل الرفض التي لا تتجاوز 25 حرفًا في كل ملف خادم، والعدّ ينزل فقط.
import { AppError } from './auth.mjs';
import { currentUser } from './delegations.mjs';

const text=value=>typeof value==='string'?value.trim():'';

// النص المقروء وحده، لمن يحتاجه في سجل أو إشعار. بند الناقص يُكتب كما تكتبه gateMessage بالحرف: «الوثيقة — مالكها».
export function refusalMessage({what,missing=[],next}={}){
  const items=missing.map(item=>`${item.document} — ${item.owner}`).join('؛ ');
  const head=items?`${what}: ${items}`:what;
  return next?`${head}؛ ${next}`:head;
}

// يرمي رفضًا مكتوبًا. خطأ المبرمج (رفض بلا «ما» أو بلا ناقص ولا خطوة تالية، أو ناقص بلا مالك) يُرفع TypeError عند أول تشغيل،
// فلا يصل إلى مستخدم رفضٌ لا يقول له ماذا يفعل: المعيار يُفرض عند الكتابة لا يُرجى عند المراجعة.
export function refuse(status,code,{what,missing=[],next,link}={}){
  if(!Number.isInteger(status)||status<400||status>499)throw new TypeError('refuse: الرفض حالة 4xx؛ عطل الخادم ليس رفضًا');
  if(!text(code))throw new TypeError('refuse: رمز الرفض مطلوب');
  if(!text(what))throw new TypeError('refuse: «what» مطلوب — ما الذي رُفض بالضبط');
  if(!Array.isArray(missing))throw new TypeError('refuse: «missing» قائمة');
  if(!missing.length&&!text(next))throw new TypeError('refuse: اذكر ما الناقص (missing) أو الخطوة التالية (next)؛ رفض بلا أحدهما لا يقول للمستخدم ماذا يفعل');
  const items=missing.map((item,index)=>{
    if(!text(item?.document)||!text(item?.owner))throw new TypeError(`refuse: البند ${index+1} في «missing» يحتاج document وowner — ما الناقص ومن يملكه`);
    return {document:text(item.document),why:text(item.why)||null,owner:text(item.owner),owner_role:text(item.owner_role)||null,...(text(item.doc_key)?{doc_key:text(item.doc_key)}:{})};
  });
  const refusal={what:text(what),missing:items,next:text(next)||null,link:text(link)||null};
  throw Object.assign(new AppError(status,text(code),refusalMessage(refusal)),{details:{refusal}});
}

// بديل مسمّى لعبارة «الحساب غير متاح» المنسوخة في ثمانين ملفًا. currentUser لا يعيد الحساب حين يكون موقوفًا (active=0) أو غير مسجل
// في هذا الكيان، فهذا هو السبب الذي يُقال، ومعه من يعيد التفعيل وما يفعله صاحب الحساب. الرمز forbidden والحالة 403 كما كانا،
// فسجل «access denied» في الخادم وكل اختبار يقرأ الرمز يبقيان كما هما.
export function actorOrRefuse(db,supplied){
  // هوية غائبة أو ناقصة تُرفض هنا رفضًا مكتوبًا؛ كانت تصل إلى SQLite قيمةً غير معرَّفة فتصير عطل خادم (500) بلا سبب يُقرأ.
  const user=typeof supplied?.id==='string'&&typeof supplied?.tenant_id==='string'?currentUser(db,supplied):null;
  if(!user)refuse(403,'forbidden',{what:'لا يُنفَّذ هذا الإجراء بحسابك الآن',
    missing:[{document:'حساب مفعَّل في المنصة',why:'حسابك موقوف أو لم يعد مسجلًا في هذا الكيان',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'اطلب من مسؤول المنصة إعادة تفعيل حسابك، ثم سجّل الدخول من جديد'});
  return user;
}
