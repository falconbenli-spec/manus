import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { refuse } from './refusal.mjs';
import { looksLikeIdentifier, NO_NATIONAL_ID } from './pii.mjs';
import { riyadhDate, holidaySet, workingDaysBetween } from './work-calendar.mjs';
import { monthsAndDays, durationText, myBenefits, STATE_NAMES } from './benefits-portal.mjs';
import { coverageOf } from './benefits.mjs';
import { STATUS_NAMES as CONTRACT_STATUS_NAMES } from './hr-contracts.mjs';
import { caseOf, insuranceRule, rateFor, CASE_NAMES as INSURANCE_CASE_NAMES } from './payroll-insurance.mjs';
import { countNoun } from './static/arabic-count.mjs';
import { latestEmploymentContractMeta } from './people-read.mjs';

// ملف الموظف الموحّد: خمسة تبويبات (نظرة عامة، العقد، الخبرة، المزايا، مستندات تهمني) مركّبة من سجلات المنصة القائمة.
// لا تكتب هذه الوحدة سجلًا إلا في employee_personal (الترحيل 121)؛ كل ما عداه قراءة من مالكه:
//   المسمى والالتحاق والحالة      → employee_profiles (app/employees.mjs)
//   نوع العقد وتواريخه وبنوده     → employment_contracts (app/hr-contracts.mjs)
//   الجنس والجنسية                → employee_demographics (app/workforce.mjs) اختيارًا لا افتراضًا
//   التأمين الصحي ومزوّده وفئته   → medical_enrolments (app/benefits.mjs)
//   المزايا وحالتها               → كتالوج المزايا وبوابتها (app/benefits-portal.mjs)
//   الإعفاء من البصمة             → attendance_exemptions (app/attendance-rules.mjs)
//
// القاعدة الحاكمة: كل قيمة تحمل مصدرها. ما لا سجل له يخرج «غير متاح» ومعه سببه ومن يملك سدّه — لا صفرًا ولا خانة فارغة،
// لأن الفراغ يُقرأ صفرًا والصفر يُقرأ حقيقةً. وما امتنعت المنصة عن تسجيله عمدًا (رقم الهوية) يخرج «لا يُسجَّل في المنصة»
// بسببه، فلا يُفهم امتناعٌ مقصود على أنه نقص بيانات يُسدّ.

const CAP='employees.view';
// الجنس والجنسية سجلٌّ تملكه لوحة تركيبة القوى العاملة (app/workforce.mjs) وتحرسه بتصريحها وحده. تصريح السجل الوظيفي
// لا يفتحهما: دمج التصريحين هنا كان يوسّع جمهور حقلين اختياريين تُسجّلهما الموارد البشرية بفعل صريح، بلا قرار يوسّعه.
const DEMOGRAPHICS_CAP='hr.workforce.view';
// الإعفاء من البصمة يُعرض علمًا لكل من يفتح الملف، وسببه نصٌّ حرٌّ قد يحمل تفصيلًا صحيًّا: يقرؤه من تقرأه شاشة الحضور
// نفسها (app/attendance-rules.mjs) — صاحبه ومديره المباشر وحامل تصريحَي الحضور — لا كل من فتح الملف.
const ATTENDANCE_CAPS=['hr.attendance.manage','hr.attendance.approve'];
export const MARITAL_STATUS=Object.freeze({single:'أعزب/عزباء',married:'متزوج/متزوجة',divorced:'مطلّق/مطلّقة',widowed:'أرمل/أرملة'});
export const EDUCATION_LEVELS=Object.freeze({secondary:'ثانوية عامة',diploma:'دبلوم',bachelor:'بكالوريوس',master:'ماجستير',doctorate:'دكتوراه'});
export const NATIONALITY_GROUPS=Object.freeze({saudi:'سعودي/سعودية',non_saudi:'غير سعودي/سعودية'});
export const GENDERS=Object.freeze({female:'أنثى',male:'ذكر'});
export const EMPLOYMENT_TYPES=Object.freeze({full_time:'دوام كامل',part_time:'دوام جزئي',contract:'تعاقد',intern:'متدرب'});
export const PROFILE_STATUS=Object.freeze({active:'على رأس العمل',on_notice:'في فترة إشعار',left:'غادر'});
export const CONTRACT_KINDS=Object.freeze({indefinite:'غير محدد المدة',fixed_term:'محدد المدة'});
// مالكو سدّ الفراغات، بالاسم لا بالدور المجرد: الرفض الذي لا يسمّي صاحبه يترك القارئ حيث وجده.
const HR='فريق رأس المال البشري';
const BENEFITS_TEAM='فريق المزايا في الموارد البشرية';
const DOCUMENTS_TEAM='فريق رأس المال البشري';
// نص واحد لامتناع المنصة عن رقم الهوية، مكرر في employees.mjs وworkforce.mjs وbenefits-portal.mjs كقاعدة رفض.
export { NO_NATIONAL_ID };
const today=()=>riyadhDate(Date.now());
const text=value=>typeof value==='string'?value.trim():'';
// حارس «ستة أرقام متتالية فأكثر» انتقل بحرفه إلى app/pii.mjs (looksLikeIdentifier) ليحرس به سجل التعريفات الحقول المخصّصة أيضًا؛ لا تغيير في السلوك.

/* ───── البند: قيمة بمصدرها، أو فراغ يقول لماذا هو فراغ ───── */
// الشكل مطابق عمدًا لأولية الأرقام الصادقة (app/report-figures.mjs على فرع stage1/report-figures، غير مدموج في هذه السلالة
// حتى كتابة هذا السطر): kind وlabel وvalue وsource وreason وneeded. حين تُدمج، يُستبدل هذا المقطع باستيراد منها بلا تغيير
// في شكل البيانات ولا في الاختبارات. انظر docs/implementation/handoff/employee-profile.md.
export const FIELD_KINDS=Object.freeze({recorded:'مسجَّل',derived:'مشتق',unavailable:'غير متاح',not_stored:'لا يُسجَّل في المنصة'});
const present=(key,label,value,source,opts={})=>({key,label,kind:opts.derived?'derived':'recorded',kind_name:FIELD_KINDS[opts.derived?'derived':'recorded'],
  value,text:opts.text??String(value??''),source,reason:'',needed:'',owner:'',note:opts.note??''});
// «غير متاح»: السجل قائم في المنصة وهذه الخانة منه بلا قيد. غياب القيد ليس صفرًا ولا فراغًا.
const absent=(key,label,{reason,needed,owner=HR,note=''})=>({key,label,kind:'unavailable',kind_name:FIELD_KINDS.unavailable,
  value:null,text:FIELD_KINDS.unavailable,source:'',reason,needed,owner,note});
// «لا يُسجَّل في المنصة»: امتناع مقصود لا نقص بيانات. لا مالك له ولا خطوة تسدّه، فلا يُعرض كأنه ناقص يُستكمل.
const notStored=(key,label,reason)=>({key,label,kind:'not_stored',kind_name:FIELD_KINDS.not_stored,
  value:null,text:FIELD_KINDS.not_stored,source:'',reason,needed:'',owner:'',note:''});

/* ───── الهوية والصلاحية ───── */
function actor(db,supplied){
  const u=typeof supplied?.id==='string'?currentUser(db,supplied):null;
  if(!u)refuse(403,'forbidden',{what:'لا يُفتح ملف موظف بحسابك الآن',
    missing:[{document:'حساب مفعَّل في المنصة',why:'حسابك موقوف أو لم يعد مسجلًا في هذا الكيان',owner:'مسؤول المنصة',owner_role:'admin'}],
    next:'اطلب من مسؤول المنصة إعادة تفعيل حسابك، ثم سجّل الدخول من جديد'});
  return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة البيانات الشخصية معاملة قاعدة بيانات');}
const isManagerOf=(db,u,userId)=>!!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND manager_id=? AND active=1').get(userId,u.tenant_id,u.id);
// موظف الموارد البشرية هو من يسجّل البيانات الشخصية، كما يسجّل الجنسية (app/workforce.mjs) والملف الوظيفي (app/employees.mjs).
const isRecorder=u=>u.role==='hr';

// ثلاثة نطاقات لا رابع: صاحب الملف والموارد البشرية يريان كل شيء، والمدير المباشر يرى بيانات العمل وحدها،
// ومن عداهم لا يرى الملف أصلًا. النطاق يُحسم هنا مرة، وكل تبويب يقرؤه ولا يعيد استنتاجه.
// holds لا can: امتياز الأدمن الأول لا يفتح بيانات شخصية. هذه قاعدة المنصة المكتوبة في app/my-profile.mjs
// («ولا يكفي امتياز الأدمن وحده (holds لا can)») والمطبَّقة في app/workforce.mjs، وcan كانت تُمرّر الأدمن الأول
// بلا منح مسجَّل لأن employees.view ليس تصريحًا حساسًا — فيصل إلى تاريخ ميلاد كل موظف وحالته الاجتماعية.
export function profileScope(db,u,userId){
  if(userId===u.id)return 'self';
  if(holds(db,u,CAP))return 'hr';
  if(isManagerOf(db,u,userId))return 'manager';
  return 'none';
}
function subject(db,u,userId){
  // حساب إدارة المنصة ليس موظفًا في السجل، فاستعلام الشخص يستثنيه ويقع على الرفض العام: «لا صفة لك على ملف زميلك»
  // وهو يطلب ملفه هو. الناقص الحقيقي غير ذلك، ولا خطوة تسدّه، فيُقال كما هو.
  if(u.role==='admin'&&userId===u.id)refuse(404,'not_found',{what:'حساب إدارة المنصة لا ملف موظف له',
    missing:[{document:'حساب موظف في السجل الوظيفي',why:'ملف الموظف لحسابات الموظفين؛ وحساب إدارة المنصة حساب تشغيل لا يُسجَّل له ملف ولا عقد ولا بيانات شخصية',owner:HR,owner_role:'hr'}],
    next:'إن كان لك حساب موظف في المنصة فافتح ملفك منه؛ ولا يُنشأ ملف لحساب إدارة المنصة'});
  const person=typeof userId==='string'?db.prepare("SELECT u.id,u.name,u.username,u.role,u.department_id,u.manager_id,u.active,d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id AND d.tenant_id=u.tenant_id WHERE u.id=? AND u.tenant_id=? AND u.role<>'admin'").get(userId,u.tenant_id):null;
  const scope=person?profileScope(db,u,person.id):'none';
  if(!person||scope==='none')refuse(404,'not_found',{what:'ملف هذا الموظف لا يُفتح بحسابك',
    missing:[{document:'صفة على هذا الملف: صاحبه، أو مديره المباشر، أو تصريح السجل الوظيفي',why:'ملف الموظف يراه صاحبه ومديره المباشر ورأس المال البشري فقط، ولا يراه زميل',owner:HR,owner_role:'hr'}],
    next:'إن كنت تحتاج بيانات زميل لإجراء، اطلبها من رأس المال البشري بذكر الإجراء'});
  return {person,scope};
}

/* ───── الاشتقاقات ───── */
// العمر يُشتق من تاريخ الميلاد ولا يُخزَّن: رقم محفوظ يصير كذبة بعد أول عيد ميلاد، وتصحيحه يحتاج مهمة دورية لا تملكها المنصة.
export function ageOn(birthDate,date){
  if(!birthDate||birthDate>date)return null;
  const [by,bm,bd]=birthDate.split('-').map(Number),[y,m,d]=date.split('-').map(Number);
  return y-by-((m<bm||(m===bm&&d<bd))?1:0);
}
const yearsWord=n=>n===1?'سنة':n===2?'سنتان':n<=10?`${n} سنوات`:`${n} سنة`;
// حرفا الاسم للصورة الرمزية. أداة التعريف «ال» تُسقَط أولًا: «الموظفة التجريبية» بلا إسقاطها تعطي «اا» — حرفين
// متطابقين لكل اسم معرَّف في الشركة، فلا تميّز أحدًا عن أحد وهو كل الغرض منها.
export function lettersOf(name){
  const words=String(name??'').split(/\s+/).map(w=>w.replace(/^(?:ال|Al-|al-)/,'')).filter(Boolean);
  return words.slice(0,2).map(w=>[...w][0]).join('')||[...String(name??'').trim()].slice(0,1).join('');
}
export const monthsToText=months=>{
  if(!Number.isInteger(months)||months<0)return '';
  const y=Math.floor(months/12),m=months%12;
  if(!y&&!m)return 'أقل من شهر';
  if(!m)return yearsWord(y);
  const rest=m===1?'شهر':m===2?'شهران':m<=10?`${m} أشهر`:`${m} شهرًا`;
  return y?`${yearsWord(y)} و${rest}`:rest;
};

/* ───── العقد ───── */
// مدة العقد بأيام العمل من تقويم المنصة (العطل الرسمية المسجَّلة ونهاية الأسبوع)، لا بأيام التقويم:
// «ثلاثة أيام متبقية» التي ثلاثتها إجازة ليست ثلاثة أيام. وبلا تاريخ نهاية لا نسبة أصلًا: العقد غير محدد المدة
// مقامُه غير موجود، ونسبة بلا مقام رقم مخترع.
export function contractProgress(start,end,date,holidays){
  if(!start)return {state:'unknown',percent:null,elapsed_days:null,remaining_days:null,total_days:null};
  if(!end)return {state:'indefinite',percent:null,elapsed_days:workingDaysBetween(start,date<start?start:date,holidays),remaining_days:null,total_days:null};
  const total=workingDaysBetween(start,end,holidays);
  const capped=date>end?end:date<start?start:date;
  const elapsed=workingDaysBetween(start,capped,holidays);
  return {state:date>end?'expired':'running',percent:total>0?Math.min(100,Math.round(elapsed*100/total)):null,
    elapsed_days:elapsed,remaining_days:Math.max(0,total-elapsed),total_days:total};
}

function contractOf(db,tenantId,userId){
  return db.prepare("SELECT * FROM employment_contracts WHERE user_id=? AND tenant_id=? AND status='active' ORDER BY start_date DESC LIMIT 1").get(userId,tenantId)
    ??db.prepare("SELECT * FROM employment_contracts WHERE user_id=? AND tenant_id=? AND status='ended' ORDER BY start_date DESC LIMIT 1").get(userId,tenantId)??null;
}
function exemptionOf(db,tenantId,userId,date){
  return db.prepare("SELECT from_date,to_date,reason FROM attendance_exemptions WHERE user_id=? AND tenant_id=? AND status='approved' AND from_date<=? AND to_date>=? ORDER BY to_date DESC LIMIT 1").get(userId,tenantId,date,date)??null;
}
// التأمين الصحي من تسجيل الوثيقة لا من عمود في ملف الموظف. قد يمنع الخادم القارئَ من تفصيله (فريق المزايا وصاحبه فقط)،
// وامتناعٌ لصلاحية ليس غيابَ سجل: يُقال أيهما وقع.
function insuranceOf(db,supplied,userId,scope){
  try{return {coverage:coverageOf(db,supplied,userId),blocked:false};}
  catch(error){
    if(![403,404].includes(error?.status))throw error;
    return {coverage:null,blocked:scope!=='self'};
  }
}

/* ───── التبويب الأول: نظرة عامة ───── */
// بندان لا يخصّان شخصًا: ما لا تُصدره المنصة (رقم وظيفي)، وما تمتنع عن تسجيله عمدًا (رقم الهوية). يراهما كل قارئ
// يفتح الملف. حجبهما عن المدير كان يجعل الامتناع المقصود يختفي عمن يحتاج أن يعرفه، ويُنقص المحجوب عن المسمّى.
function identityFields(person){
  return [
    absent('employee_number','الرقم الوظيفي',{reason:'المنصة لا تُصدر رقمًا وظيفيًا منفصلًا؛ المعرّف المستعمل في كل سجلاتها هو معرّف الحساب',
      needed:`قرار من ${HR} بترقيم وظيفي معتمد ثم ترحيل يسجّله`,note:`المعرّف في المنصة: ${person.id}`}),
    notStored('national_id','رقم الهوية الوطنية',NO_NATIONAL_ID)
  ];
}
// الجنس والجنسية: تصريحهما غير تصريح الملف، فقد يقرأ الملفَ من لا يقرؤهما. حين يُحجبان يُقال «محجوب» لا «غير مسجَّل»:
// الثانية جوابٌ عن سؤال لم يُسأل، وتنفي وجود سجلٍّ قائم فعلًا.
function demographicFields(demographics,seesDemographics){
  if(!seesDemographics)return [
    absent('nationality','الجنسية',{reason:'الجنسية والجنس يراهما حامل تصريح لوحة تركيبة القوى العاملة، وليست لك هذه الصفة',
      needed:'اطلب ما تحتاجه من رأس المال البشري بذكر الإجراء، أو اطلب التصريح من مسؤول المنصة إن كان من عملك'}),
    absent('gender','الجنس',{reason:'الجنسية والجنس يراهما حامل تصريح لوحة تركيبة القوى العاملة، وليست لك هذه الصفة',
      needed:'اطلب ما تحتاجه من رأس المال البشري بذكر الإجراء، أو اطلب التصريح من مسؤول المنصة إن كان من عملك'})
  ];
  return [
    demographics?.nationality_group
      ?present('nationality','الجنسية',demographics.nationality_group,`سجل تركيبة القوى العاملة — ${demographics.source}`,{text:NATIONALITY_GROUPS[demographics.nationality_group]})
      :absent('nationality','الجنسية',{reason:'تسجيل الجنسية اختياري في المنصة ولم يُسجَّل لهذا الحساب',needed:'تسجيل الجنسية من لوحة تركيبة القوى العاملة بذكر الوثيقة'}),
    demographics?.gender
      ?present('gender','الجنس',demographics.gender,`سجل تركيبة القوى العاملة — ${demographics.source}`,{text:GENDERS[demographics.gender]})
      :absent('gender','الجنس',{reason:'تسجيل الجنس اختياري في المنصة ولم يُسجَّل لهذا الحساب',needed:'تسجيله من لوحة تركيبة القوى العاملة'})
  ];
}
function personalFields(personal,date){
  const out=[];
  out.push(personal?.birth_date
    ?present('birth_date','تاريخ الميلاد',personal.birth_date,`سجل البيانات الشخصية — ${personal.source}`)
    :absent('birth_date','تاريخ الميلاد',{reason:'لم تسجّل الموارد البشرية تاريخ الميلاد من وثيقة',needed:'تسجيل تاريخ الميلاد في البيانات الشخصية بذكر الوثيقة المطّلَع عليها'}));
  const age=personal?.birth_date?ageOn(personal.birth_date,date):null;
  out.push(age===null
    ?absent('age','العمر',{reason:'العمر مشتق من تاريخ الميلاد، وتاريخ الميلاد غير مسجَّل',needed:'تسجيل تاريخ الميلاد؛ العمر يُحسب ولا يُدخَل'})
    :present('age','العمر',age,'مشتق من تاريخ الميلاد',{derived:true,text:yearsWord(age),note:'يُحسب عند العرض ولا يُخزَّن'}));
  out.push(personal?.marital_status
    ?present('marital_status','الحالة الاجتماعية',personal.marital_status,`سجل البيانات الشخصية — ${personal.source}`,{text:MARITAL_STATUS[personal.marital_status]})
    :absent('marital_status','الحالة الاجتماعية',{reason:'لم تُسجَّل الحالة الاجتماعية',needed:'تسجيلها في البيانات الشخصية بذكر الوثيقة المطّلَع عليها'}));
  return out;
}
// ما حُجب يُسمّى ببنوده لا بجملة تُجمل ثلاثة وتُسقط اثنين. والسبب سببُ كل بند: بعضه لأن المدير يرى عملًا لا شخصًا،
// وبعضه لأن تصريح تركيبة القوى العاملة غير تصريح الملف.
function withheldPersonal(seesPersonal,seesDemographics){
  const names=[...(seesPersonal?[]:['تاريخ الميلاد','العمر','الحالة الاجتماعية']),...(seesDemographics?[]:['الجنسية','الجنس'])];
  if(!names.length)return null;
  const why=[...(seesPersonal?[]:['المدير المباشر يرى بيانات عمل فريقه لا بياناتهم الشخصية']),
    ...(seesDemographics?[]:['الجنسية والجنس سجلٌّ اختياري تحرسه لوحة تركيبة القوى العاملة ويراه حامل تصريحها'])].join('؛ ');
  return {what:`محجوب عنك: ${names.join('، ')}`,why,owner:HR,fields:names};
}
function workFields(person,profile,contract,personal,insurance){
  const out=[];
  out.push(person.department
    ?present('department','الإدارة',person.department_id,'الهيكل التنظيمي في المنصة',{text:person.department})
    :absent('department','الإدارة',{reason:'الحساب غير مربوط بإدارة قائمة في الهيكل',needed:'ربط الحساب بإدارة من شاشة الموظفين والصلاحيات',owner:'مسؤول المنصة'}));
  const title=contract?.job_title??profile?.job_title??'';
  out.push(title
    ?present('job_title','المسمى الوظيفي',title,contract?.job_title?'العقد الساري':'السجل الوظيفي')
    :absent('job_title','المسمى الوظيفي',{reason:'لا ملف وظيفي ولا عقد مسجَّل لهذا الحساب',needed:'إنشاء الملف الوظيفي من السجل الوظيفي، أو إعداد عقد واعتماده'}));
  out.push(profile?.employment_type
    ?present('employment_type','نوع التعاقد',profile.employment_type,'السجل الوظيفي',{text:EMPLOYMENT_TYPES[profile.employment_type]})
    :absent('employment_type','نوع التعاقد',{reason:'لم يُنشأ ملف وظيفي لهذا الحساب بعد',needed:'إنشاء الملف الوظيفي من السجل الوظيفي'}));
  out.push(personal?.education_level
    ?present('education_level','المستوى التعليمي',personal.education_level,`سجل البيانات الشخصية — ${personal.source}`,{text:EDUCATION_LEVELS[personal.education_level]})
    :absent('education_level','المستوى التعليمي',{reason:'لم يُسجَّل المستوى التعليمي من مؤهل مطّلَع عليه',needed:'تسجيل المستوى التعليمي في البيانات الشخصية'}));
  out.push(personal?.education_field
    ?present('education_field','التخصص',personal.education_field,`سجل البيانات الشخصية — ${personal.source}`)
    :absent('education_field','التخصص',{reason:'لم يُسجَّل التخصص',needed:'تسجيل التخصص في البيانات الشخصية'}));
  if(insurance.blocked)out.push(absent('insurance','التأمين الصحي',{reason:'تفصيل التأمين لا يُعرض إلا لصاحبه ولفريق المزايا، وليست لك هذه الصفة',
    needed:'طلب البيان من فريق المزايا بذكر الإجراء الذي يحتاجه',owner:BENEFITS_TEAM}));
  else if(insurance.coverage)out.push(present('insurance','التأمين الصحي',insurance.coverage.tier,`تسجيل وثيقة التأمين — ${insurance.coverage.insurer_name}`,
    {text:`${insurance.coverage.insurer_name} · فئة ${insurance.coverage.tier}`,note:insurance.coverage.policy_current?'':'الوثيقة خارج فترة سريانها المسجَّلة'}));
  else out.push(absent('insurance','التأمين الصحي',{reason:'لا تسجيل تأمين طبي قائم لهذا الحساب',needed:'تسجيل الموظف في وثيقة التأمين من بوابة المزايا',owner:BENEFITS_TEAM}));
  out.push(profile?.status
    ?present('status','حالة الخدمة',profile.status,'السجل الوظيفي',{text:PROFILE_STATUS[profile.status]})
    :absent('status','حالة الخدمة',{reason:'لم يُنشأ ملف وظيفي لهذا الحساب بعد',needed:'إنشاء الملف الوظيفي من السجل الوظيفي'}));
  return out;
}

/* ───── التبويب الثاني: العقد ───── */
// نهاية العقد من العقد وحده حين يوجد عقد. كان البديل `contract?.end_date??profile?.contract_end` يسقط على عمود السجل
// الوظيفي حين يكون العقد غير محدد المدة (وend_date فيه NULL بقيد القاعدة)، فيُعرض تاريخُ سجلٍ آخر منسوبًا إلى «العقد
// المسجَّل» وفي البند الذي يليه «نوع العقد: غير محدد المدة». السجلان مصدران اثنان: العقد يُعِدّه شخص ويعتمده آخر،
// وcontract_end يكتبه موظف الموارد البشرية وحده بلا مقابلة (employees.saveProfile)، فالعقد هو المصدر، واختلافهما يُقال.
function endDateField(profile,contract){
  const filed=profile?.contract_end??null;
  if(!contract)return filed
    ?present('end_date','تاريخ نهاية العقد',filed,'السجل الوظيفي')
    :absent('end_date','تاريخ نهاية العقد',{reason:'لا عقد مسجَّل يحدد المدة ولا نهاية عقد في الملف الوظيفي',needed:'إعداد عقد بنوعه ومدته واعتماده من مسار العقود'});
  const indefinite=contract.contract_type==='indefinite';
  const clash=filed&&filed!==contract.end_date
    ?`يتعارض مع «نهاية العقد» في السجل الوظيفي (${filed}): العقد هو المصدر، ويُصحَّح السجل الوظيفي عند ${HR}`:'';
  const join=(...parts)=>parts.filter(Boolean).join(' · ');
  if(indefinite)return present('end_date','تاريخ نهاية العقد',null,'العقد المسجَّل',{text:CONTRACT_KINDS.indefinite,
    note:join('عقد غير محدد المدة: لا تاريخ نهاية، ولا نسبة إنجاز لمدة لا منتهى لها',clash)});
  if(contract.end_date)return present('end_date','تاريخ نهاية العقد',contract.end_date,'العقد المسجَّل',{note:clash});
  return absent('end_date','تاريخ نهاية العقد',{reason:'العقد مسجَّل محدد المدة ولا تاريخ نهاية مسجَّل فيه',
    needed:'إكمال تاريخ نهاية العقد في سجل العقود',note:clash});
}
// نص المدة بتمييز العدد العربي (app/static/arabic-count.mjs): «8 أيام عمل» لا «8 يوم عمل»، و«لا يوم عمل متبقيًا» لا «0».
// يُبنى هنا مرة واحدة وتقرؤه الشاشة من الحمولة (progress_text): نسخة ثانية منه في الواجهة تنحرف عن هذه بأول تعديل.
const progressText=progress=>progress.percent===null?''
  :`${progress.percent}% مكتمل · ${progress.remaining_days===0?'لا يوم عمل متبقيًا':`${countNoun(progress.remaining_days,'working_day')} متبقٍ`} من ${countNoun(progress.total_days,'working_day')}`;
// حالة التأمينات الاجتماعية: مشتقة من الجنسية وتاريخ المباشرة، لا حقل يُكتب. تكشف الجنسية فتُحجب بحجابها نفسه،
// وما ينقص منها يُقال «غير متاح» بسببه ومن يسدّه، ولا يُعرض صفرًا ولا يُخمَّن. (ترحيل 127)
function socialInsuranceBlock(db,tenantId,userId,date,seesDemographics){
  if(!seesDemographics)return {visible:false,fields:[],note:'حالة التأمينات تُشتق من الجنسية، فلا تظهر إلا لمن يرى الجنسية: صاحب الملف وحامل تصريح بيانات القوى العاملة.'};
  const rule=insuranceRule(db,tenantId,date),parameters=rule?.parameters??null;
  const state=caseOf(db,tenantId,userId,date,parameters);
  const rate=state.case_key&&parameters?rateFor(parameters,state.case_key,date):null;
  const fields=[];
  fields.push(state.case_key
    ?present('insurance_case','حالة الاشتراك في التأمينات',state.case_key,'مشتقة من الجنسية وتاريخ المباشرة',{derived:true,text:rate?.case_name??INSURANCE_CASE_NAMES[state.case_key],note:state.note})
    :absent('insurance_case','حالة الاشتراك في التأمينات',{
      reason:state.blocked==='gcc_national'?'مواطن خليجي: خارج جدول الخصم بقرار المالك، فلا حالة تنطبق عليه'
        :state.blocked==='no_rule'?'قاعدة التأمينات بالحالة لم يقبلها مدير الموارد البشرية بعد'
        :`الملف ينقصه: ${state.missing.map(m=>m.document).join('؛ ')}`,
      needed:state.blocked==='gcc_national'?'قرار مكتوب في شأن مواطني دول مجلس التعاون قبل اعتماد مسير يضمّه'
        :state.blocked==='no_rule'?'قبول قاعدة التأمينات من «قواعد اللائحة في الرواتب»'
        :'تسجيل الجنسية في ملف الموظف واعتماد عقد بتاريخ مباشرة'}));
  fields.push(rate
    ?present('insurance_rate','نسبة الخصم السارية',rate.employee_bp,`القاعدة المقبولة — درجة ${rate.from}`,{derived:true,
      text:`${(rate.employee_bp/100).toFixed(2)}% على الموظف · ${(rate.employer_bp/100).toFixed(2)}% على المنشأة`,note:rate.note})
    :absent('insurance_rate','نسبة الخصم السارية',{reason:'لا نسبة تُقرأ قبل حسم الحالة',needed:'حسم الحالة أولًا'}));
  return {visible:true,fields,case_key:state.case_key,
    override:state.override,
    note:'الحصة التي تُخصم من الراتب تظهر في القسيمة بمادتها ومصدرها. حصة المنشأة تكلفة عليها ولا تُخصم من الموظف.'};
}
function contractTab(profile,contract,progress,indefinite,insurance=null){
  const fields=[];
  const start=contract?.start_date??profile?.join_date??null;
  fields.push(start
    ?present('start_date','تاريخ بداية العقد',start,contract?'العقد المسجَّل':'السجل الوظيفي (تاريخ المباشرة)')
    :absent('start_date','تاريخ بداية العقد',{reason:'لا عقد مسجَّل ولا تاريخ مباشرة في الملف الوظيفي',needed:'تسجيل تاريخ المباشرة في السجل الوظيفي، أو إعداد عقد واعتماده'}));
  fields.push(endDateField(profile,contract));
  fields.push(contract
    ?present('contract_type','نوع العقد',contract.contract_type,'العقد المسجَّل',{text:CONTRACT_KINDS[contract.contract_type]})
    :absent('contract_type','نوع العقد',{reason:'لا عقد مسجَّل لهذا الحساب في سجل العقود',needed:'إعداد عقد واعتماده من مسار العقود (مُعِدّ ثم معتمِد)'}));
  fields.push(contract?.work_location
    ?present('work_location','مكان العمل',contract.work_location,'العقد المسجَّل')
    :absent('work_location','مكان العمل',{reason:'لا عقد مسجَّل يذكر مكان العمل',needed:'إعداد عقد واعتماده من مسار العقود'}));
  // نسبة المدة: بندٌ كالبنود، فإن لم تكن قابلة للقياس قالت لماذا بدل أن تُرسم صفرًا في شريط.
  // «غير محدد المدة» تُقال عن العقد الذي نوعه كذلك وحده. عقدٌ محدد المدة بلا تاريخ نهاية مسجَّل نقصٌ يُسدّ، لا لا-نهاية.
  // وملاحظة انقضاء المدة تتبع حالة العقد لا تاريخه: «ما زال مسجلًا ساريًا» فوق عقدٍ حالته «منتهٍ» تكذّبها الحمولة نفسها.
  const expiredNote=contract?.status==='active'
    ?'انقضت المدة المسجَّلة وما زال العقد مسجلًا ساريًا'
    :'انقضت المدة المسجَّلة، والعقد مسجَّل منتهيًا';
  const duration=indefinite
    ?present('duration','مدة العقد',null,'العقد المسجَّل',{derived:true,text:CONTRACT_KINDS.indefinite,note:'لا نسبة إنجاز لعقد بلا تاريخ نهاية'})
    :progress.percent===null
      ?absent('duration','مدة العقد',{reason:'حساب المدة يحتاج تاريخ بداية وتاريخ نهاية؛ أحدهما غير مسجَّل',needed:'إكمال تاريخي العقد في سجل العقود'})
      :present('duration','مدة العقد',progress.percent,'مشتق من تاريخي العقد وتقويم العمل',{derived:true,
        text:progressText(progress),note:progress.state==='expired'?expiredNote:''});
  fields.push(duration);
  return {fields,progress,indefinite,progress_text:progressText(progress),social_insurance:insurance,
    // «ساري» في النظام المرجعي شارة على العقد. عندنا الحالة من سجل العقود نفسه وبعبارته الواحدة (hr-contracts.mjs)،
    // وبلا عقد لا تُخترع شارة: شارة «ساري» فوق لا عقد أسوأ من غيابها. ترسمها الشاشة بعدّة الشارة المشتركة.
    status:contract?{key:contract.status,name:CONTRACT_STATUS_NAMES[contract.status]}:null,
    pay_visible:false,
    note:'بنود الأجر ومجموعها لا تُعرض في هذا الملف لأي قارئ: يراها صاحب العقد وحامل تصريح العقود من شاشة العقود وحدها.'};
}

/* ───── التبويب الثالث: الخبرة ───── */
function experienceTab(profile,contract,personal,date){
  const fields=[];
  const joined=profile?.join_date??contract?.start_date??null;
  const joinSource=profile?.join_date?'تاريخ المباشرة في السجل الوظيفي':'تاريخ بداية العقد';
  // تاريخ مباشرة لم يحلّ بعد حالٌ عادية: عقدٌ وُقِّع قبل المباشرة. الخبرة الداخلية حينها صفرٌ معلوم لا مجهول،
  // وقول «لا تاريخ مباشرة» فوق التاريخ نفسه معروضًا في تبويب العقد كذبٌ يكذّبه البند الذي قبله.
  const notStarted=!!joined&&joined>date;
  const internal=joined&&!notStarted?monthsAndDays(joined,date):null;
  const internalMonths=notStarted?0:internal?internal.months:null;
  const internalText=notStarted?`تبدأ الخدمة في ${joined}؛ لا خبرة داخلية بعد`:internal?durationText(internal):'';
  fields.push(joined
    ?present('internal','الخبرة في 3,6T',internalMonths,joinSource,{derived:true,text:internalText,
      note:notStarted?'تُحسب من يوم المباشرة، ولم يحلّ بعد':`محسوبة من ${joined} إلى اليوم`})
    :absent('internal','الخبرة في 3,6T',{reason:'لا تاريخ مباشرة في الملف الوظيفي ولا تاريخ بداية عقد',needed:'تسجيل تاريخ المباشرة في السجل الوظيفي'}));
  const prior=personal?.prior_experience_months;
  const priorKnown=Number.isInteger(prior);
  fields.push(priorKnown
    ?present('prior','الخبرة السابقة',prior,`سجل البيانات الشخصية — ${personal.source}`,{text:prior===0?'لا خبرة سابقة مسجَّلة قبل الالتحاق':monthsToText(prior)})
    :absent('prior','الخبرة السابقة',{reason:'لم تُسجَّل سنوات الخبرة قبل الالتحاق',needed:'تسجيل الخبرة السابقة بالأشهر في البيانات الشخصية من سيرة أو شهادات خبرة'}));
  // الإجمالي لا يساوي الداخلي صامتًا حين تكون السابقة مجهولة: مجموعٌ أحد طرفيه مجهول مجهولٌ، وإظهاره مساويًا للطرف
  // المعروف يحوّل «لا نعرف» إلى «صفر» — وهي الكذبة التي تحرس منها هذه الوحدة كلها.
  fields.push(internalMonths===null||!priorKnown
    ?absent('total','إجمالي الخبرة',{reason:internalMonths===null&&!priorKnown?'طرفا المجموع غير معروفين: لا تاريخ مباشرة ولا خبرة سابقة مسجَّلة'
      :internalMonths===null?'الخبرة في 3,6T غير معروفة لغياب تاريخ المباشرة':'الخبرة السابقة غير مسجَّلة، فمجموعها مع الخبرة الداخلية غير معروف',
      needed:internalMonths===null?'تسجيل تاريخ المباشرة، ثم تسجيل الخبرة السابقة':'تسجيل الخبرة السابقة بالأشهر في البيانات الشخصية',
      note:internalMonths===null?'':`الخبرة في 3,6T وحدها: ${internalText}`})
    :present('total','إجمالي الخبرة',internalMonths+prior,'مجموع الخبرة الداخلية والخبرة السابقة المسجَّلة',{derived:true,text:monthsToText(internalMonths+prior)}));
  return fields;
}

/* ───── التبويب الرابع: المزايا ───── */
// النظام المرجعي يعرض لكل ميزة حالة «لم يستفد بعد» وزر «تأكيد الاستفادة». عندنا لا يوجد فعل اسمه «تأكيد الاستفادة»
// ولا يُخترع زر لا يكتب شيئًا: تُعرض الحالة الحقيقية من بوابة المزايا، ومعها الخطوة الحقيقية الموجودة فعلًا —
// خيار طلب يفتحه صاحب الملف بنفسه من بوابة المزايا، أو اسم من يملك الخطوة حين لا تكون بيد القارئ.
function benefitsTab(db,supplied,person,scope){
  let portal=null,blocked=null;
  // يُبتلع رفض الصلاحية وحده (403/404) فيصير حالةً معلنة في التبويب؛ أي خطأ آخر عطلٌ يُرفع كما هو ولا يُخفى خلف «غير متاح».
  try{portal=myBenefits(db,supplied,person.id);}
  catch(error){
    if(![403,404].includes(error?.status))throw error;
    blocked={reason:scope==='manager'?'مزايا الموظف لا تُعرض لمديره المباشر: يراها صاحبها وفريق المزايا فقط'
      :'عرض مزايا موظف آخر يحتاج تصريح إدارة المزايا، ولا يحمله حسابك',
      needed:'اطلب من فريق المزايا ما تحتاجه بذكر الإجراء، أو اطلب التصريح من مسؤول المنصة إن كان من عملك',owner:BENEFITS_TEAM};
  }
  if(!portal)return {available:false,...blocked,items:[],states:STATE_NAMES,
    note:'لا تُعرض هنا حالة أي ميزة ما دام تفصيلها محجوبًا عن هذا الحساب: عرض قائمة بلا حالات يوحي بأنها كلها غير مستحقة.'};
  const own=portal.viewing_self;
  const options=new Map((portal.options??[]).map(o=>[o.key,o]));
  const items=(portal.benefits??[]).map(b=>{
    const option=b.request_option?options.get(b.request_option):null;
    // الخطوة التالية الحقيقية لا زرًا مخترعًا: إمّا خيار طلب قائم لصاحب الملف، وإمّا اسم مالك الخطوة.
    const step=!b.accepted?{kind:'blocked',text:'الميزة مسودة لم يعتمدها مدير الموارد البشرية بعد، فلا تُطلب',owner:'مدير الموارد البشرية'}
      :b.state==='held'?{kind:'none',text:'قائمة لك الآن؛ لا إجراء مطلوب',owner:''}
      :option&&option.available&&own?{kind:'request',text:`قدّم الطلب من بوابة المزايا: ${b.name}`,owner:'',option:b.request_option}
      :option&&!option.available&&own?{kind:'blocked',text:option.reason??'الخيار غير متاح لك الآن',owner:BENEFITS_TEAM}
      :own?{kind:'owner',text:b.claim_name,owner:BENEFITS_TEAM}
      :{kind:'owner',text:`الطلب يقدّمه صاحب الملف بنفسه من بوابة مزاياه؛ لا يُقدَّم عنه: ${b.claim_name}`,owner:BENEFITS_TEAM};
    // حالة الاستحقاق وحالة الكتالوج شيئان: «مؤهل» تصف الموظف، و«مسودة» تصف الميزة نفسها. عنوان البطاقة يُقرأ وحده
    // في القائمة المطوية، فحمله لحالة الاستحقاق فوق ميزة لم تُعتمد يوصل «مؤهل» ولا يوصل «مسودة». يسافران معًا.
    return {key:b.key,name:b.name,summary:b.summary,category_name:b.category_name,state:b.state,state_name:b.state_name,
      status_name:b.status_name,draft_warning:b.draft_warning??'',
      held_text:b.held_text,eligibility_text:b.eligibility?.text??'',accepted:b.accepted,citation:b.citation,
      value_text:b.value_text,frequency_name:b.frequency_name,next_step:step};
  });
  return {available:true,reason:'',needed:'',owner:'',items,states:STATE_NAMES,
    counts:portal.counts,hidden_pending_count:portal.hidden_pending_count,
    note:'الحالة والخطوة من بوابة المزايا نفسها. لا فعل اسمه «تأكيد الاستفادة» في المنصة: ما يُقدَّم طلبٌ يمر بالموارد البشرية ويبقى أثره.'};
}

/* ───── التبويب الخامس: مستندات تهمني ───── */
// هذه مكتبة قراءة مركّبة لا مخزن وثائق جديد. البطاقة لا تصبح «متاحة» إلا إذا دلّ عليها سجل قائم في وحدته الأصلية،
// ولا تحمل محتوى العقد أو مرجعه أو أجره. غياب المصدر يظهر كعملٍ مطلوب من مالكه بدل رابط تنزيل لا يقود إلى شيء.
export const IMPORTANT_DOCUMENT_STATUS=Object.freeze({
  available:'متاح',needs_setup:'يحتاج إعداد',pending_approval:'بانتظار الاعتماد',needs_update:'يحتاج تحديث'
});
const documentCard=(key,title,summary,group,icon,status,extra={})=>({
  key,title,summary,group,icon,status,status_name:IMPORTANT_DOCUMENT_STATUS[status],
  source:'',updated_at:'',owner:'',next_step:'',href:'',action:'',confidential:false,...extra
});
const missingDocument=(key,title,summary,group,icon,nextStep)=>documentCard(key,title,summary,group,icon,'needs_setup',{
  owner:DOCUMENTS_TEAM,next_step:nextStep
});
function importantDocuments(db,u,person,scope,benefits){
  const own=scope==='self',tenant=u.tenant_id;
  const goal=db.prepare("SELECT id,status,created_at FROM development_goals WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1").get(tenant,person.id)??null;
  const review=db.prepare("SELECT id,status,updated_at FROM performance_reviews WHERE tenant_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 1").get(tenant,person.id)??null;
  const contract=latestEmploymentContractMeta(db,tenant,person.id);
  const policies=db.prepare("SELECT code,title,status,verification,created_at FROM policy_documents WHERE tenant_id=? OR tenant_id IS NULL ORDER BY created_at DESC").all(tenant);
  const handbook=policies.find(row=>row.code==='employee_handbook'||row.title.includes('دليل الموظف'))??null;
  const published=policies.filter(row=>row.status==='published');
  const policyStatus=published.length?(published.every(row=>row.verification==='verified')?'available':'needs_update')
    :policies.some(row=>row.status==='draft')?'pending_approval':'needs_setup';
  const benefitItems=benefits.available?benefits.items:[];
  const acceptedBenefits=benefitItems.filter(item=>item.accepted).length;
  const benefitStatus=acceptedBenefits?'available':benefitItems.length?'pending_approval':'needs_setup';
  const contractStatus=contract?.status==='active'?'available'
    :['draft','pending'].includes(contract?.status)?'pending_approval'
      :contract?.status==='ended'?'needs_update':'needs_setup';
  const reviewStatus=review?(['released','acknowledged','appealed','appeal_decided'].includes(review.status)?'available':'pending_approval'):'needs_setup';

  const items=[
    missingDocument('job_description','الوصف الوظيفي','مهام الدور ومسؤولياته وحدوده والنتائج المتوقعة منه.','دوري وأدائي','briefcase','اعتماد وصف وظيفي لهذا المسمى وربطه بالموظف داخل المنصة.'),
    goal
      ?documentCard('key_performance_indicators','مؤشرات الأداء الرئيسية','الأهداف والمقاييس المسجلة التي يُتابع عليها أداء الموظف.','دوري وأدائي','target','available',{
        source:`سجل الأهداف والتطوير — ${goal.status==='achieved'?'هدف منجز':'هدف مسجّل'}`,updated_at:goal.created_at,href:own?'#growth':''})
      :missingDocument('key_performance_indicators','مؤشرات الأداء الرئيسية','المؤشرات والأهداف التي يتم قياس أداء الموظف بناءً عليها.','دوري وأدائي','target','تسجيل أهداف قابلة للقياس وربطها بدورة الأداء الحالية.'),
    missingDocument('workflow_model','نموذج سير العمل','العمليات ومسارات العمل المرتبطة بمهام الموظف.','دوري وأدائي','route','ربط الدور بمسارات العمل المعتمدة التي يشارك فيها الموظف.'),
    missingDocument('standard_operating_procedures','إجراءات التشغيل الموحدة (SOP)','الخطوات التشغيلية المعتمدة لتنفيذ الأعمال اليومية.','دوري وأدائي','checklist','اعتماد إجراءات التشغيل الخاصة بالدور وربط نسخها النافذة بالموظف.'),
    policyStatus==='needs_setup'
      ?missingDocument('policies_and_procedures','السياسات والإجراءات','السياسات والإجراءات الداخلية التي يحتاج الموظف معرفتها.','حقوقي ومرجعي','shield','نشر سياسة أو إجراء معتمد في مكتبة السياسات.')
      :documentCard('policies_and_procedures','السياسات والإجراءات','السياسات والإجراءات الداخلية التي يحتاج الموظف معرفتها.','حقوقي ومرجعي','shield',policyStatus,{
        source:`مكتبة السياسات — ${published.length?`${published.length} منشور`:'مسودات تنتظر الاعتماد'}`,
        updated_at:(published[0]??policies[0])?.created_at??'',owner:policyStatus==='pending_approval'?'مدير الموارد البشرية':'مسؤول السياسات',
        next_step:policyStatus==='needs_update'?'مطابقة النص المستخرج مع النسخة الأصلية الموقعة وتوثيق التحقق.':'',href:'#policy-library'}),
    benefitStatus==='needs_setup'
      ?missingDocument('employee_benefits','المزايا الوظيفية','تفاصيل المزايا والخدمات المقدمة للموظف.','حقوقي ومرجعي','heart','إعداد مصفوفة المزايا واعتماد البنود التي تنطبق على الموظف.')
      :documentCard('employee_benefits','المزايا الوظيفية','تفاصيل المزايا والخدمات المقدمة للموظف.','حقوقي ومرجعي','heart',benefitStatus,{
        source:`بوابة المزايا — ${acceptedBenefits?`${acceptedBenefits} ميزة معتمدة`:`${benefitItems.length} مسودة`}`,
        owner:benefitStatus==='pending_approval'?'مدير الموارد البشرية':'',next_step:benefitStatus==='pending_approval'?'اعتماد مصفوفة المزايا قبل إتاحتها للموظف.':'',href:own?'#my-benefits':''}),
    handbook
      ?documentCard('employee_handbook','دليل الموظف','الدليل الرسمي للموظفين ومرجع البداية والعمل اليومي.','حقوقي ومرجعي','book',
        handbook.status==='draft'?'pending_approval':handbook.verification==='verified'?'available':'needs_update',{
          source:`مكتبة السياسات — ${handbook.title}`,updated_at:handbook.created_at,owner:handbook.status==='draft'?'مدير الموارد البشرية':'مسؤول السياسات',
          next_step:handbook.status==='draft'?'اعتماد الدليل ونشر نسخته النافذة.':handbook.verification==='verified'?'':'مطابقة الدليل مع النسخة الأصلية واعتماد التحقق.',href:'#policy-library'})
      :missingDocument('employee_handbook','دليل الموظف','الدليل الرسمي للموظفين ومرجع البداية والعمل اليومي.','حقوقي ومرجعي','book','إعداد دليل الموظف واعتماده ثم نشره في مكتبة السياسات.'),
    missingDocument('plan_30_60_90','خطة 30-60-90 يوم','خطة الموظف خلال أول ثلاثة أشهر وما ينتظر إنجازه في كل مرحلة.','دوري وأدائي','calendar','إنشاء خطة مرتبطة بالموظف ومديره وتسجيل مخرجات الأيام 30 و60 و90.'),
    reviewStatus==='needs_setup'
      ?missingDocument('performance_evaluation_system','نظام تقييم الأداء الشامل','شرح دورة التقييم ومعاييرها وحالة تقييم الموظف.','دوري وأدائي','chart','فتح دورة تقييم بمعايير معتمدة وربط تقييم الموظف بها.')
      :documentCard('performance_evaluation_system','نظام تقييم الأداء الشامل','شرح دورة التقييم ومعاييرها وحالة تقييم الموظف.','دوري وأدائي','chart',reviewStatus,{
        source:`سجل تقييم الأداء — ${review.status}`,updated_at:review.updated_at,owner:reviewStatus==='pending_approval'?'مدير الموظف وفريق الأداء':'',
        next_step:reviewStatus==='pending_approval'?'استكمال مراحل التقييم والمعايرة قبل إصدار النتيجة.':'',href:own?'#performance':''}),
    contractStatus==='needs_setup'
      ?documentCard('employment_contract','العقد الوظيفي','سجل العقد الخاص بالموظف وحالته الحالية.','حقوقي ومرجعي','signed','needs_setup',{
        owner:DOCUMENTS_TEAM,next_step:'إعداد عقد الموظف ومراجعته واعتماده وفق فصل المهام.',confidential:true})
      :documentCard('employment_contract','العقد الوظيفي','سجل العقد الخاص بالموظف وحالته الحالية.','حقوقي ومرجعي','signed',contractStatus,{
        source:`سجل العقود — ${CONTRACT_STATUS_NAMES[contract.status]}`,updated_at:contract.updated_at??contract.created_at,
        owner:contractStatus==='pending_approval'?'مدير الموارد البشرية':'',next_step:contractStatus==='needs_update'?'إعداد عقد نافذ أو توثيق انتهاء العلاقة.':'',
        href:own?'#contracts':'',confidential:true})
  ];
  return {total:items.length,available:items.filter(item=>item.status==='available').length,
    actionable:items.filter(item=>item.href).length,items,statuses:IMPORTANT_DOCUMENT_STATUS,
    note:'تعرض البطاقة حالة السجل في وحدته الأصلية. لا يظهر رابط إلا عندما يوجد سجل فعلي يمكن فتحه بصلاحية القارئ.'};
}

/* ───── الملف الموحّد ───── */
// كل اطلاع على ملف غير ملفك يُسجَّل بصفٍّ إلحاقي. هذه أول شاشة في المنصة يصل منها قارئٌ إلى تاريخ ميلاد زميله
// وحالته الاجتماعية، ومن يقرأ سجلًا كهذا يُعرف — كما تُسجَّل قراءة القسيمة (payslip_views) والمخالصة والمادة النظامية.
function recordView(db,u,person,scope){
  if(scope==='self')return;
  db.prepare('INSERT INTO employee_profile_views(id,tenant_id,subject_user_id,viewer_id,scope,created_at) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(),u.tenant_id,person.id,u.id,scope,now());
}
export function employeeProfile(db,supplied,userId){
  const u=actor(db,supplied),{person,scope}=subject(db,u,userId??u.id),date=today();
  const seesPersonal=scope==='self'||scope==='hr';
  // الجنس والجنسية بتصريحهما لا بتصريح الملف؛ وصاحب الملف يرى بياناته هو.
  const seesDemographics=scope==='self'||holds(db,u,DEMOGRAPHICS_CAP);
  const seesExemptionReason=scope==='self'||scope==='manager'||ATTENDANCE_CAPS.some(cap=>holds(db,u,cap));
  const profile=db.prepare('SELECT * FROM employee_profiles WHERE user_id=? AND tenant_id=?').get(person.id,u.tenant_id)??null;
  const contract=contractOf(db,u.tenant_id,person.id);
  const record=db.prepare('SELECT * FROM employee_personal WHERE user_id=? AND tenant_id=?').get(person.id,u.tenant_id)??null;
  // القسمة بين «شخصي» و«عملي» تمر داخل هذا السجل الواحد لا حوله: المؤهل والتخصص والخبرة السابقة بيانات عمل يحتاجها
  // المدير المباشر ليوزّع المهام، وتاريخ الميلاد والحالة الاجتماعية لا يحتاجهما لشيء. فيصله المؤهل ولا يصله الميلاد.
  const personal=seesPersonal?record:null;
  const qualifications=record?{education_level:record.education_level,education_field:record.education_field,
    prior_experience_months:record.prior_experience_months,source:record.source}:null;
  const demographics=db.prepare('SELECT nationality_group,gender,source FROM employee_demographics WHERE user_id=? AND tenant_id=?').get(person.id,u.tenant_id)??null;
  const insurance=insuranceOf(db,supplied,person.id,scope);
  const holidays=holidaySet(db,u.tenant_id);
  // المدة من العقد وحده حين يوجد عقد: تاريخ نهاية في السجل الوظيفي لا يصنع مدةً لعقدٍ آخر.
  const indefinite=!!contract&&contract.contract_type==='indefinite';
  const start=contract?.start_date??profile?.join_date??null;
  const end=contract?(indefinite?null:contract.end_date??null):(profile?.contract_end??null);
  const progress=contractProgress(start,end,date,holidays);
  const exemption=exemptionOf(db,u.tenant_id,person.id,date);
  const initials=lettersOf(person.name);
  const benefits=benefitsTab(db,supplied,person,scope);
  recordView(db,u,person,scope);
  return {
    today:date,scope,own:scope==='self',
    person:{id:person.id,name:person.name,initials,department:person.department??'',department_id:person.department_id,
      job_title:contract?.job_title??profile?.job_title??'',active:!!person.active},
    // «مستثنى من البصمة» في النظام المرجعي علمٌ ثابت على الشخص. عندنا إعفاء مؤرخ باقتراح وقرار من شخصين، فيُعرض بمداه.
    // وسببه نصٌّ حرٌّ قد يحمل تفصيلًا صحيًّا: يصل لمن تصله رفوف الإعفاءات في شاشة الحضور، ولا يصل لغيرهم.
    flags:exemption?[{key:'attendance_exempt',name:'مستثنى من البصمة',
      detail:seesExemptionReason?`من ${exemption.from_date} إلى ${exemption.to_date} — ${exemption.reason}`:`من ${exemption.from_date} إلى ${exemption.to_date}`,
      reason_withheld:!seesExemptionReason}]:[],
    tabs:{
      overview:{
        personal:[...identityFields(person),
          ...(seesPersonal?personalFields(personal,date):[]),
          ...demographicFields(demographics,seesDemographics)],
        personal_withheld:withheldPersonal(seesPersonal,seesDemographics),
        work:workFields(person,profile,contract,qualifications,insurance)
      },
      contract:contractTab(profile,contract,progress,indefinite,socialInsuranceBlock(db,u.tenant_id,person.id,date,seesDemographics)),
      experience:experienceTab(profile,contract,qualifications,date),
      benefits,
      important_documents:importantDocuments(db,u,person,scope,benefits)
    },
    can:{edit_personal:isRecorder(u)&&person.id!==u.id},
    // النسخة تُسلّح النموذج، ولا نموذج لمن لا يرى البيانات. ورقمٌ يتصاعد على سجل شخصيٍّ لزميل، بطابع وقته، يقول إن شيئًا
    // في حياته تغيّر ومتى — وهو بعينه ما تحرسه هذه الوحدة. والطابع يُسمّى بما يقيسه: سجل البيانات الشخصية وحده لا الملف كله.
    personal_version:seesPersonal?(record?.version??0):null,
    personal_updated_at:seesPersonal?(record?.updated_at??null):null,
    // قوائم النموذج تُرسل لمن يملك النموذج وحده. إرسالها لغيره لا يفتح له بابًا، لكنه يضع «متزوج» و«مطلّق» في حمولة
    // من مُنع من رؤية الحالة الاجتماعية أصلًا، فيبدو تسريبًا لمن يقرأ الشبكة ويصعّب إثبات أن التسريب لم يقع.
    ...(isRecorder(u)&&person.id!==u.id?{marital_statuses:MARITAL_STATUS,education_levels:EDUCATION_LEVELS}:{}),
    privacy_note:'يرى هذا الملف صاحبه ورأس المال البشري كاملًا، ويرى مديره المباشر بيانات العمل وحدها. لا يراه زميل، '
      +'ولا يراه حساب إدارة المنصة. وكل فتح لملف غير ملفك يُسجَّل باسمك وتاريخه. '+NO_NATIONAL_ID
  };
}

/* ───── الدليل: صفٌّ لكل موظف بأعمدة المرجع، بقدر ما تحمله سجلاتنا ───── */
// النظام المرجعي يعرض 53 موظفًا في جدول واحد بأعمدة: الرقم الوظيفي والاسم والمسمى والإدارة والجنس والجنسية والمستوى
// التعليمي وبداية العقد ونهايته وإجمالي الخبرة، مع مرشّح إدارة ومرشّح جنس وعدّ نتائج.
// عندنا عمودان من هذه لا يراهما كل من يرى الدليل: الجنس والجنسية سجلٌّ اختياري تحرسه لوحة القوى العاملة، فيُقصران على
// حامل تصريحها هو (hr.workforce.view) لا على حامل تصريح السجل الوظيفي: تصريحان لا يُدمجان بلا قرار يُكتب.
// المدير المباشر يرى فريقه بأعمدة العمل، ويُقال له صراحةً أي عمود حُجب ولماذا — لا يُترك فارغًا ولا يُكتب «غير مسجَّل».
export function employeeDirectory(db,supplied){
  const u=actor(db,supplied),date=today();
  const officer=holds(db,u,CAP),seesDemographics=holds(db,u,DEMOGRAPHICS_CAP);
  const people=officer
    ?db.prepare("SELECT u.id,u.name,u.department_id,u.active,d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id AND d.tenant_id=u.tenant_id WHERE u.tenant_id=? AND u.role<>'admin' ORDER BY u.active DESC,u.name").all(u.tenant_id)
    :db.prepare("SELECT u.id,u.name,u.department_id,u.active,d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id AND d.tenant_id=u.tenant_id WHERE u.tenant_id=? AND u.role<>'admin' AND (u.id=? OR u.manager_id=?) ORDER BY u.name").all(u.tenant_id,u.id,u.id);
  const profiles=new Map(db.prepare('SELECT user_id,job_title,join_date,contract_end FROM employee_profiles WHERE tenant_id=?').all(u.tenant_id).map(p=>[p.user_id,p]));
  const contracts=new Map(db.prepare("SELECT user_id,job_title,contract_type,start_date,end_date FROM employment_contracts WHERE tenant_id=? AND status='active'").all(u.tenant_id).map(c=>[c.user_id,c]));
  const personal=new Map(db.prepare('SELECT user_id,education_level,prior_experience_months FROM employee_personal WHERE tenant_id=?').all(u.tenant_id).map(p=>[p.user_id,p]));
  const demographics=seesDemographics?new Map(db.prepare('SELECT user_id,nationality_group,gender FROM employee_demographics WHERE tenant_id=?').all(u.tenant_id).map(g=>[g.user_id,g])):new Map();
  const BLANK='غير مسجَّل';
  const rows=people.map(person=>{
    const profile=profiles.get(person.id)??null,contract=contracts.get(person.id)??null,extra=personal.get(person.id)??null,demo=demographics.get(person.id)??null;
    const start=contract?.start_date??profile?.join_date??null;
    const end=contract?(contract.contract_type==='indefinite'?null:contract.end_date):profile?.contract_end??null;
    const internal=start&&start<=date?monthsAndDays(start,date).months:null;
    const prior=extra&&Number.isInteger(extra.prior_experience_months)?extra.prior_experience_months:null;
    // الإجمالي في عمود الجدول يتبع قاعدة الملف نفسها: مجموع طرفٍ مجهول مجهول، ويُكتب مجهولًا لا مساويًا للمعروف.
    const total=internal===null||prior===null?null:internal+prior;
    return {id:person.id,name:person.name,active:!!person.active,
      department:person.department??BLANK,department_id:person.department_id,
      job_title:contract?.job_title??profile?.job_title??BLANK,
      // العمود المحجوب لا يُملأ بـ«غير مسجَّل»: تلك جوابٌ عن سؤال لم يُسأل، وتنفي سجلًا قائمًا. يخرج null، ويحمل
      // withheld_columns وحده السبب والمالك — ولا يدخل النص الكاذب حتى في نص المرشّح المخفي في الصف.
      gender:demo?.gender??null,gender_name:seesDemographics?(demo?.gender?GENDERS[demo.gender]:BLANK):null,
      nationality:demo?.nationality_group??null,nationality_name:seesDemographics?(demo?.nationality_group?NATIONALITY_GROUPS[demo.nationality_group]:BLANK):null,
      education_level:extra?.education_level??null,education_name:extra?.education_level?EDUCATION_LEVELS[extra.education_level]:BLANK,
      contract_start:start,contract_end:end,
      contract_end_text:end??(contract?.contract_type==='indefinite'?CONTRACT_KINDS.indefinite:BLANK),
      total_experience_months:total,total_experience_text:total===null?BLANK:monthsToText(total)};
  });
  const departments=[...new Map(rows.filter(r=>r.department_id).map(r=>[r.department_id,r.department])).entries()]
    .map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'ar'));
  return {today:date,scope:officer?'people':'team',rows,departments,
    genders:seesDemographics?GENDERS:null,
    // العمود المحجوب يُسمّى ويُعلَّل. جدولٌ بعمود فارغ بلا كلمة يُقرأ «لا أحد سجّل جنسه»، وهو غير «ليس من حقك أن تراه».
    withheld_columns:seesDemographics?[]:[{column:'الجنس والجنسية',why:'سجلٌّ اختياري تحرسه لوحة تركيبة القوى العاملة (تصريح hr.workforce.view)، ويراه حامل تصريحها',owner:HR}],
    unrecorded:{gender:seesDemographics?rows.filter(r=>!r.gender).length:null,nationality:seesDemographics?rows.filter(r=>!r.nationality).length:null,
      education:rows.filter(r=>!r.education_level).length,prior_experience:rows.filter(r=>r.total_experience_months===null).length},
    // العمود الأول معرّف الحساب باسمه: تسميته «الرقم الوظيفي» في ترويسة الجدول تسمّي شيئًا باسم شيء لا يوجد،
    // والملف نفسه يقول عن «الرقم الوظيفي» إنه غير متاح — فنقرةٌ واحدة كانت تعطي القارئ جوابين متناقضين عن الخانة نفسها.
    note:'العمود الأول معرّف الحساب في المنصة، لا رقمًا وظيفيًا: لا ترقيم وظيفي منفصل معتمد بعد. وما لم يُسجَّل يُكتب «غير مسجَّل»، فالخانة الفارغة تُقرأ صفرًا.'};
}

/* ───── الكتابة: الموارد البشرية وحدها، بنسخة وتدقيق ───── */
export function saveEmployeePersonal(db,supplied,userId,input){
  writing(db);
  const u=actor(db,supplied);
  if(!isRecorder(u))refuse(403,'not_permitted',{what:'تسجيل البيانات الشخصية لا يتم بحسابك',
    missing:[{document:'صفة موظف رأس المال البشري',why:'تاريخ الميلاد والحالة الاجتماعية والمؤهل تُسجَّل من وثيقة يطّلع عليها موظف الموارد البشرية',owner:HR,owner_role:'hr'}],
    next:'أرسل الوثيقة إلى رأس المال البشري ليسجّلها، أو اطلب التصريح إن كان التسجيل من عملك'});
  const {person}=subject(db,u,userId);
  if(person.id===u.id)refuse(409,'separation_of_duties',{what:'لا تُسجَّل بياناتك الشخصية بحسابك أنت',
    missing:[{document:'مُسجِّل غير صاحب البيانات',why:'مُعِدّ السجل غير صاحبه في كل سجلات المنصة، والقيد مفروض في قاعدة البيانات أيضًا',owner:HR,owner_role:'hr'}],
    next:'اطلب من زميل في رأس المال البشري تسجيل بياناتك من الوثيقة'});
  v.object(input,['version','birth_date','marital_status','education_level','education_field','prior_experience_months','source']);
  const date=today();
  const birth=input.birth_date?v.date(input.birth_date):null;
  if(birth&&birth>=date)refuse(400,'birth_date',{what:'تاريخ الميلاد المُدخَل لم يأتِ بعد',
    missing:[{document:'تاريخ ميلاد سابق لليوم من وثيقة رسمية',why:`التاريخ المُدخَل ${birth} يقع اليوم أو بعده`,owner:HR,owner_role:'hr'}],
    next:'راجع الوثيقة وأعد إدخال التاريخ'});
  if(birth&&ageOn(birth,date)<15)refuse(400,'birth_date',{what:'تاريخ الميلاد المُدخَل يعطي عمرًا دون الخامسة عشرة',
    missing:[{document:'تاريخ ميلاد مطابق للوثيقة',why:'عمر دون الخامسة عشرة لا يصح لموظف؛ الأرجح خطأ في سنة الميلاد',owner:HR,owner_role:'hr'}],
    next:'راجع سنة الميلاد في الوثيقة وأعد الإدخال'});
  const marital=text(input.marital_status)||null;
  if(marital&&!Object.hasOwn(MARITAL_STATUS,marital))refuse(400,'marital_status',{what:'الحالة الاجتماعية المُدخَلة ليست من القائمة',
    missing:[{document:'اختيار من: أعزب، متزوج، مطلّق، أرمل',why:'الحالة الاجتماعية قائمة مغلقة في القاعدة، ونص حر خارجها يُرفض',owner:HR,owner_role:'hr'}],next:'اختر واحدة من القائمة'});
  const level=text(input.education_level)||null;
  if(level&&!Object.hasOwn(EDUCATION_LEVELS,level))refuse(400,'education_level',{what:'المستوى التعليمي المُدخَل ليس من القائمة',
    missing:[{document:'اختيار من: ثانوية، دبلوم، بكالوريوس، ماجستير، دكتوراه',why:'المستوى التعليمي قائمة مغلقة في القاعدة',owner:HR,owner_role:'hr'}],next:'اختر واحدًا من القائمة'});
  const field=input.education_field?v.text(input.education_field,'التخصص',120,2):null;
  const months=input.prior_experience_months;
  if(months!==undefined&&months!==null&&months!==''&&(!Number.isInteger(months)||months<0||months>720))
    refuse(400,'prior_experience_months',{what:'الخبرة السابقة المُدخَلة ليست عدد أشهر صالحًا',
      missing:[{document:'عدد صحيح من الأشهر بين صفر و720 (ستون سنة)',why:'الخبرة تُسجَّل بالأشهر لا بالسنوات الكسرية، وصفر يعني «لا خبرة سابقة» لا «غير معروفة»',owner:HR,owner_role:'hr'}],
      next:'احسب الأشهر من شهادات الخبرة وأعد الإدخال، أو اترك الحقل فارغًا إن كانت غير معروفة'});
  const prior=months===undefined||months===null||months===''?null:months;
  const source=v.text(input.source,'الوثيقة التي اطُّلع عليها',200,5);
  // القاعدة الصريحة: لا يدخل رقم هوية ولا إقامة في أي حقل نصي، ولو كتبه المسجِّل في «التخصص» أو في وصف الوثيقة.
  for(const [label,value] of [['التخصص',field],['وصف الوثيقة',source]])
    if(looksLikeIdentifier(value))refuse(400,'national_id_refused',{what:`رُفض ما كُتب في «${label}»: يحتوي رقمًا كاملًا يشبه رقم هوية أو إقامة`,
      missing:[{document:'نص بلا أرقام متسلسلة طويلة — نوع الوثيقة يكفي',why:NO_NATIONAL_ID,owner:HR,owner_role:'hr'}],
      next:'اكتب نوع الوثيقة وحده مثل «الهوية الوطنية» أو «شهادة البكالوريوس»، بلا رقمها'});
  const existing=db.prepare('SELECT * FROM employee_personal WHERE user_id=? AND tenant_id=?').get(person.id,u.tenant_id)??null;
  v.version(input.version,existing?.version??0);
  const time=now();
  if(existing)db.prepare('UPDATE employee_personal SET birth_date=?,marital_status=?,education_level=?,education_field=?,prior_experience_months=?,source=?,recorded_by=?,version=version+1,updated_at=? WHERE user_id=?')
    .run(birth,marital,level,field,prior,source,u.id,time,person.id);
  else db.prepare('INSERT INTO employee_personal(user_id,tenant_id,birth_date,marital_status,education_level,education_field,prior_experience_months,source,recorded_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(person.id,u.tenant_id,birth,marital,level,field,prior,source,u.id,time);
  // القيم نفسها لا تدخل سجل التدقيق العام (تاريخ ميلاد وحالة اجتماعية بيانات شخصية): يكفي أن سجلًا تغيّر، ومن غيّره،
  // وعلى أي وثيقة، وأي الخانات مُلئت. هذا هو نهج employee_demographics نفسه (app/workforce.mjs).
  audit(db,u,'employee_personal',person.id,existing?'personal.updated':'personal.recorded',
    {version:existing?.version??0},{version:(existing?.version??0)+1,
      recorded:{birth_date:birth!==null,marital_status:marital!==null,education_level:level!==null,education_field:field!==null,prior_experience_months:prior!==null}},source);
  return employeeProfile(db,u,person.id);
}
