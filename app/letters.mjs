import { randomUUID, randomBytes } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail, AppError } from './auth.mjs';
import * as v from './validation.mjs';
import { notifySubject } from './notices.mjs';
import { letterNotice } from './module-notices.mjs';
import { actorOrRefuse } from './refusal.mjs';
import { holds } from './access.mjs';
import { qrSvg } from './qr.mjs';
import { dual } from './dates.mjs';
import { holidaySet, addWorkingDays } from './work-calendar.mjs';
import { documentFooter, SYNTHETIC } from './tenant-identity.mjs';
// استيراد دائري آمن: يُستدعى داخل الدالة فقط بعد اكتمال تحميل الوحدتين.
import { onTemplatePublished } from './service-routes.mjs';

// خطابات الموظفين: الموظف يطلب، والموارد البشرية تعدّ، ومالك الإجراء يصدر.
// المنصة لا تكتب نص خطاب ولا صيغة رسمية. القالب يكتبه بشر بعناصر نائبة، والمنصة تملأها من سجلاتها وحدها.
// خطاب الراتب حساس: المبلغ لا يُخزَّن في جدول الخطابات، بل يُشتق عند الإصدار من العقد الساري ويُثبَّت في النص المُصدَر.

// العناصر النائبة المسموحة ومصدر كل منها. ما ليس في هذه القائمة يُرفض عند حفظ القالب.
export const PLACEHOLDERS=[
  {key:'employee_name',name:'اسم الموظف',source:'حساب الموظف في المنصة'},
  {key:'job_title',name:'المسمى الوظيفي',source:'العقد الساري، وإلا الملف الوظيفي'},
  {key:'hire_date',name:'تاريخ المباشرة',source:'الملف الوظيفي، وإلا بداية العقد الساري'},
  {key:'salary_total',name:'الراتب (الإجمالي أو التفصيل، شهريًا أو سنويًا بحسب اختيار الموظف)',source:'العقد الساري وقت الإصدار — لا يُخزَّن مبلغًا في جدول الخطابات',sensitive:true},
  {key:'addressee',name:'الجهة الموجه إليها',source:'طلب الموظف: من قائمة الجهات أو نص حر متحقق منه'},
  // عناصر معالج الطلب (19 سبتمبر). بنود الراتب تحت قاعدة salary_total نفسها: تُشتق عند الإصدار ولا تُخزَّن.
  {key:'salary_basic',name:'الراتب الأساسي',source:'العقد الساري وقت الإصدار — لا يُخزَّن',sensitive:true},
  {key:'salary_housing',name:'بدل السكن',source:'العقد الساري وقت الإصدار — لا يُخزَّن',sensitive:true},
  {key:'salary_transport',name:'بدل النقل',source:'العقد الساري وقت الإصدار — لا يُخزَّن',sensitive:true},
  {key:'salary_other',name:'البدلات الأخرى',source:'العقد الساري وقت الإصدار — لا يُخزَّن',sensitive:true},
  {key:'service_end_date',name:'تاريخ نهاية الخدمة',source:'العقد المنتهي أو آخر يوم عمل حدده صاحب الصلاحية، وإلا «حتى تاريخه»'},
  {key:'travel_from',name:'بداية السفر',source:'طلب الموظف (خطاب السفارة)'},
  {key:'travel_to',name:'نهاية السفر',source:'طلب الموظف (خطاب السفارة)'},
  {key:'destination',name:'بلد الوجهة',source:'طلب الموظف (خطاب السفارة)'},
  // إشعار الجزاء (م121، ترحيل 097): عناصر لا تُملأ إلا في خطاب تصدره الموارد البشرية من قضية انضباط محسومة.
  ...[['case_reference','رقم قضية الانضباط'],['violation_ar','المخالفة (عربي)'],['violation_en','المخالفة (إنجليزي)'],['violation_date','تاريخ المخالفة'],
    ['article','البند والمادة من اللائحة'],['penalty_ar','الجزاء الموقع (عربي)'],['penalty_en','الجزاء الموقع (إنجليزي)'],
    ['repeat_penalty_ar','جزاء التكرار (عربي)'],['repeat_penalty_en','جزاء التكرار (إنجليزي)'],['grievance_days','مهلة التظلم بالأيام']]
    .map(([key,name])=>({key,name,source:'سجل المخالفات والجزاءات — القرار المحسوم',types:['discipline_notice']}))
];
// أنواع يصدرها صاحب الإجراء من سجل آخر ولا يطلبها الموظف. نصها لصاحبها ولمن يملك الإصدار فقط.
export const HR_INITIATED=new Set(['discipline_notice']);
const SENSITIVE_KEYS=new Set(PLACEHOLDERS.filter(p=>p.sensitive).map(p=>p.key));
// القالب ثنائي اللغة: النص العربي ثم سطر الفاصل ثم الإنجليزي. قالب بلا فاصل نص واحد يصدر كما هو.
export const LANGUAGE_BREAK='---- English ----';
export const LANGUAGES=[['ar','العربية'],['en','الإنجليزية'],['both','العربية والإنجليزية']].map(([key,name])=>({key,name}));
export const DELIVERY=[['digital','نسخة رقمية للطباعة وحفظها PDF برمز تحقق QR'],['printed','نسخة مطبوعة مختومة تُستلم من الموارد البشرية']].map(([key,name])=>({key,name}));
// قواعد كل نوع في المعالج: هل يعرض الراتب، ومن يُخاطب، وهل الغرض مطلوب، وهل يلزم تاريخا السفر.
export const TYPE_RULES={
  salary:{salary:true,addressees:['bank','embassy','government','to_whom','other'],purpose:'optional'},
  employment:{salary:false,addressees:['bank','embassy','government','to_whom','other'],purpose:'optional'},
  experience:{salary:false,addressees:['to_whom','government','other'],purpose:'optional',former:true},
  embassy:{salary:true,addressees:['embassy','other'],purpose:'required',travel:true},
  bank:{salary:true,addressees:['bank','other'],purpose:'required'},
  to_whom:{salary:false,addressees:['to_whom'],purpose:'optional'},
  // «خطاب بالمزايا» (ترحيل 105): يفتحه الموظف من «مزاياي» بجهة يكتبها، ولا يعرض راتبًا.
  benefit_letter:{salary:false,addressees:['bank','embassy','government','to_whom','other'],purpose:'optional'}
};
const defaultRule={salary:true,addressees:['bank','embassy','government','to_whom','other'],purpose:'optional'};
export const ruleOf=code=>TYPE_RULES[code]??defaultRule;
// زمن الخدمة المقترح بأيام العمل حتى يعتمد مالك الإجراء غيره: عادي 3 أيام، ومستعجل يوم واحد.
export const LETTER_SLA_DAYS={normal:3,urgent:1};
export const TO_WHOM={ar:'لمن يهمه الأمر',en:'To whom it may concern'};
export const STATUS_NAMES={requested:'مطلوب',prepared:'مُعدّ بانتظار الإصدار',issued:'صادر',rejected:'مرفوض',cancelled:'ملغى الطلب'};
export const VERIFY_PATH='/verify/letter/';
const CAPS=['hr.letters.prepare','hr.letters.issue'];
const PLACEHOLDER_KEYS=new Set(PLACEHOLDERS.map(p=>p.key));
const PLACEHOLDER_RE=/\{\{\s*([a-z_]{2,40})\s*\}\}/g;
// أبجدية رمز التحقق بلا حروف تلتبس عند النقل اليدوي (0/O و1/I). طولها 32 فالقسمة على 256 منتظمة.
const ALPHABET='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const id=()=>randomUUID();
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const amount=minor=>{const n=Number(minor),abs=Math.abs(n);return `${n<0?'-':''}${Math.floor(abs/100).toLocaleString('en-US')}.${String(abs%100).padStart(2,'0')}`;};
const riyals=minor=>`${amount(minor)} ريال`;
const MASK='••••••';

function actor(db,supplied){const u=actorOrRefuse(db,supplied);u.caps=CAPS.filter(key=>holds(db,u,key));return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','كتابة الخطابات تبي معاملة قاعدة بيانات');}
function need(u,key,message){if(!u.caps.includes(key))fail(403,'not_permitted',message);}
export function verifyCode(){const bytes=randomBytes(12);let out='';for(const byte of bytes)out+=ALPHABET[byte%ALPHABET.length];return out;}

// أنواع الخطابات من الجدول لا من الكود: الأنواع الأساسية مشتركة، وما يضيفه الكيان يظهر معها.
export function letterTypes(db,tenantId,{includeInactive=false}={}){
  const rows=db.prepare('SELECT * FROM letter_types WHERE tenant_id=? OR tenant_id IS NULL ORDER BY tenant_id IS NOT NULL,name').all(tenantId);
  return rows.filter(t=>includeInactive||t.active).map(t=>({id:t.id,code:t.code,name:t.name,active:!!t.active,version:t.version,own:!!t.tenant_id}));
}
const typeOf=(db,tenantId,code,options)=>letterTypes(db,tenantId,options).find(t=>t.code===code)??null;

export function placeholdersIn(body){
  const text=String(body??'');
  const used=[...new Set([...text.matchAll(PLACEHOLDER_RE)].map(m=>m[1]))];
  return {used,unknown:used.filter(k=>!PLACEHOLDER_KEYS.has(k)),stray:text.replace(PLACEHOLDER_RE,'').includes('{{')};
}
function templateRow(db,u,code,statuses){
  return db.prepare(`SELECT * FROM letter_templates WHERE tenant_id=? AND type_code=? AND status IN (${statuses.map(()=>'?').join(',')}) ORDER BY revision DESC LIMIT 1`).get(u.tenant_id,code,...statuses)??null;
}
const usesSalary=body=>placeholdersIn(body).used.some(k=>SENSITIVE_KEYS.has(k));
const templateView=(db,t)=>t?{...t,prepared_by_name:name(db,t.prepared_by),published_by_name:name(db,t.published_by),placeholders:placeholdersIn(t.body).used,shows_salary:usesSalary(t.body),bilingual:!!splitLanguages(t.body).en}:null;
export function splitLanguages(body){
  const text=String(body??''),lines=text.split('\n'),at=lines.findIndex(l=>l.trim()===LANGUAGE_BREAK);
  if(at<0)return {ar:text,en:null};
  return {ar:lines.slice(0,at).join('\n').trim(),en:lines.slice(at+1).join('\n').trim()};
}
// أجزاء القالب التي يصدر بها الخطاب بحسب اللغة المختارة.
function parts(body,language){
  const {ar,en}=splitLanguages(body);
  if(!en)return [{lang:'ar',text:ar}];
  return language==='en'?[{lang:'en',text:en}]:language==='both'?[{lang:'ar',text:ar},{lang:'en',text:en}]:[{lang:'ar',text:ar}];
}

// حقائق الموظف كما تعرفها المنصة: العقد الساري أولًا، ثم الملف الوظيفي. لا تُخمَّن قيمة ناقصة.
function facts(db,tenantId,userId){
  const person=db.prepare('SELECT id,name,active FROM users WHERE id=? AND tenant_id=?').get(userId,tenantId)??null;
  const profile=db.prepare('SELECT job_title,join_date FROM employee_profiles WHERE user_id=? AND tenant_id=?').get(userId,tenantId)??null;
  const contract=db.prepare("SELECT * FROM employment_contracts WHERE user_id=? AND tenant_id=? AND status='active' ORDER BY start_date DESC LIMIT 1").get(userId,tenantId)??null;
  // لشهادة الخبرة بعد المغادرة: آخر عقد منتهٍ ليس مستبدلًا بتعديل، وآخر يوم عمل حدده صاحب الصلاحية في الاستقالة.
  const ended=contract?null:db.prepare("SELECT * FROM employment_contracts WHERE user_id=? AND tenant_id=? AND status='ended' AND end_reason NOT LIKE 'حل محله عقد معدل%' ORDER BY ended_on DESC LIMIT 1").get(userId,tenantId)??null;
  const resigned=db.prepare("SELECT last_working_day FROM resignations WHERE user_id=? AND tenant_id=? AND status IN ('accepted','deemed_accepted') AND last_working_day IS NOT NULL ORDER BY accepted_on DESC LIMIT 1").get(userId,tenantId)?.last_working_day??null;
  return {person,profile,contract,ended,resigned};
}
const SALARY_PARTS=[['basic','الراتب الأساسي','basic salary'],['housing','بدل السكن','housing allowance'],['transport','بدل النقل','transport allowance'],['other_allowance','بدلات أخرى','other allowances']];
// قيمة الراتب بحسب الاختيار: الإجمالي أو التفصيل، شهريًا أو سنويًا. بلا اختيار (الطلبات القديمة) يبقى الإجمالي الشهري كما كان.
function salaryText(contract,o,lang,mask){
  if(!contract)return '';
  const factor=o?.salary_period==='annual'?12:1,money=minor=>mask?MASK:amount(minor*factor);
  const total=lang==='en'?`SAR ${money(contract.monthly_total_minor)}`:`${money(contract.monthly_total_minor)} ريال`;
  const period=!o?.salary_period?'':lang==='en'?(factor===12?' per year':' per month'):(factor===12?' سنويًا':' شهريًا');
  if(o?.salary_detail!=='breakdown')return total+period;
  const lines=JSON.parse(contract.pay_lines),detail=SALARY_PARTS.map(([key,ar,en])=>{const l=lines.find(x=>x.component===key);return l?`${lang==='en'?en:ar} ${money(l.amount_minor)}`:null;}).filter(Boolean);
  return `${total}${period} (${detail.join(lang==='en'?', ':'، ')})`;
}
// بندٌ لا يحمله العقد الساري ليس بيانًا ناقصًا: العقد يعرف الجواب وهو صفر، فيُطبع صفرًا. والفراغ يبقى محجوزًا
// لغياب العقد نفسه، فلا يمنع الإصدار إلا ما لا تعرفه المنصة فعلًا. (ترحيل 156: نموذج الشركة لخطاب الراتب جدول
// بنودٍ بخمس خانات ثابتة، فكان موظفٌ لا يستحق بدل نقل يقف خطابه عند «بيانات ناقصة» على بندٍ ليس له.)
// التفصيل داخل {{salary_total}} يبقى كما هو: لا يعدّ إلا البنود التي يحملها العقد، فلا سطر صفري في سرد البنود.
function componentText(contract,key,o,lang,mask){
  if(!contract)return '';
  const line=JSON.parse(contract.pay_lines).find(x=>x.component===key);
  const value=mask?MASK:amount((line?.amount_minor??0)*(o?.salary_period==='annual'?12:1));
  return lang==='en'?`SAR ${value}`:`${value} ريال`;
}
function addresseeText(db,request,o,lang){
  if(o?.addressee_kind==='to_whom')return TO_WHOM[lang];
  if(o?.addressee_code){const a=db.prepare('SELECT name_ar,name_en FROM letter_addressees WHERE kind=? AND code=?').get(o.addressee_kind,o.addressee_code);if(a)return lang==='en'?a.name_en:a.name_ar;}
  return request.addressee??'';
}
// القيم لكل لغة. mask يحجب مبالغ الراتب في المعاينة قبل التقديم.
function fieldValues(f,request,{db=null,options=null,lang='ar',mask=false}={}){
  const o=options,contract=f.contract,last=contract??f.ended;
  const end=f.ended?.ended_on??f.resigned??(lang==='en'?'present':'حتى تاريخه');
  const country=db&&o?.addressee_kind==='embassy'&&o.addressee_code?db.prepare("SELECT country_ar,country_en FROM letter_addressees WHERE kind='embassy' AND code=?").get(o.addressee_code):null;
  return {employee_name:f.person?.name??'',job_title:last?.job_title??f.profile?.job_title??'',hire_date:f.profile?.join_date??last?.start_date??'',
    salary_total:contract?(o?salaryText(contract,o,lang,mask):mask?`${MASK} ريال`:riyals(contract.monthly_total_minor)):'',
    salary_basic:componentText(contract,'basic',o,lang,mask),salary_housing:componentText(contract,'housing',o,lang,mask),salary_transport:componentText(contract,'transport',o,lang,mask),salary_other:componentText(contract,'other_allowance',o,lang,mask),
    addressee:db?addresseeText(db,request,o,lang):request.addressee??'',service_end_date:end,
    travel_from:o?.travel_from??'',travel_to:o?.travel_to??'',destination:o?.destination??(country?(lang==='en'?country.country_en:country.country_ar):'')};
}
const fillBody=(body,values)=>String(body).replace(PLACEHOLDER_RE,(whole,key)=>Object.hasOwn(values,key)?values[key]:whole);
// نص الخطاب بلغته: كل جزء يُملأ بقيم لغته، والجزءان يفصل بينهما سطر فارغ.
function renderLetter(db,body,f,request,options,{mask=false}={}){
  const chosen=parts(body,options?.language??'ar'),missing=new Set();
  const text=chosen.map(part=>{const values=fieldValues(f,request,{db,options,lang:part.lang,mask});for(const key of placeholdersIn(part.text).used)if(!values[key])missing.add(key);return fillBody(part.text,values);}).join('\n\n');
  return {text,missing:[...missing],used:[...new Set(chosen.flatMap(p=>placeholdersIn(p.text).used))]};
}
const optionsOf=(db,requestId)=>db.prepare('SELECT * FROM letter_request_options WHERE request_id=?').get(requestId)??null;

function cancellation(db,letterId){
  const row=db.prepare('SELECT * FROM letter_cancellations WHERE letter_id=?').get(letterId);
  return row?{...row,cancelled_by_name:name(db,row.cancelled_by)}:null;
}
// نص الخطاب المُصدَر قد يحمل الراتب، فلا يراه إلا صاحبه أو من يملك الإصدار.
// الحكم من القالب الذي صدر عنه لا من النص بعد الملء: العنصر النائب يختفي بالملء، والقالب المنشور لا يُعدَّل.
function showsSalary(db,letter){
  const template=db.prepare('SELECT body FROM letter_templates WHERE id=?').get(letter.template_id);
  return usesSalary(template?.body??'');
}
const seesBody=(u,row,salary)=>row.user_id===u.id||u.caps.includes('hr.letters.issue')||(!salary&&!HR_INITIATED.has(row.type_code)&&u.caps.includes('hr.letters.prepare'));
// خطاب تصدره الموارد البشرية (إشعار جزاء) لا يظهر لمن يعدّ الخطابات فقط؛ يراه صاحبه ومن يملك الإصدار.
const seesRequest=(u,r)=>r.user_id===u.id||(u.caps.length>0&&(!HR_INITIATED.has(r.type_code)||u.caps.includes('hr.letters.issue')));

function requestView(db,u,r,types){
  const type=types.find(t=>t.code===r.type_code)??null,published=templateRow(db,u,r.type_code,['published']);
  const template=templateView(db,published),hr=u.caps.length>0,own=r.user_id===u.id;
  const letter=db.prepare('SELECT * FROM letters WHERE request_id=?').get(r.id)??null;
  const salary=letter?showsSalary(db,letter):!!template?.shows_salary;
  const options=optionsOf(db,r.id);
  const rendered=template?renderLetter(db,template.body,facts(db,u.tenant_id,r.user_id),r,options,{mask:true}):null;
  const ready=rendered?rendered.used:[],missing=rendered?rendered.missing:[];
  const actions=[];
  if(r.status==='requested'&&own)actions.push('cancel_request');
  if(r.status==='requested'&&hr&&!own)actions.push('prepare_letter');
  if(['requested','prepared'].includes(r.status)&&hr&&!own)actions.push('reject_letter');
  if(r.status==='prepared'&&u.caps.includes('hr.letters.issue')&&!own&&r.prepared_by!==u.id&&template&&!missing.length)actions.push('issue_letter');
  if(letter&&u.caps.includes('hr.letters.issue')&&!cancellation(db,letter.id))actions.push('cancel_letter');
  if(letter&&options?.delivery==='printed'&&!options.handed_over_at&&hr&&!own&&!cancellation(db,letter.id))actions.push('record_handover');
  if(own&&['issued','rejected','cancelled'].includes(r.status))actions.push('request_again');
  const sla=options?{due_on:options.due_on,urgent:!!options.urgent,late:['requested','prepared'].includes(r.status)&&options.due_on<today()}:null;
  return {options:options&&(own||hr)?{addressee_kind:options.addressee_kind,addressee_code:options.addressee_code,language:options.language,salary_detail:options.salary_detail,salary_period:options.salary_period,
      travel_from:options.travel_from,travel_to:options.travel_to,destination:options.destination,delivery:options.delivery,copies:options.copies,urgent:!!options.urgent,urgent_reason:options.urgent_reason,
      handed_over_at:options.handed_over_at,handover_note:options.handover_note,reused_from:options.reused_from}:null,sla,id:r.id,type_code:r.type_code,type_name:type?.name??r.type_code,user_id:r.user_id,employee_name:name(db,r.user_id),addressee:r.addressee,purpose:r.purpose,
    status:r.status,status_name:STATUS_NAMES[r.status],version:r.version,created_at:r.created_at,own,
    prepared_by_name:name(db,r.prepared_by),prepare_note:r.prepare_note,issued_by_name:name(db,r.issued_by),decision_note:r.decision_note,
    template_ready:!!template,template_placeholders:ready,missing_values:missing,shows_salary:salary,
    letter:letter?{id:letter.id,reference:letter.reference,issued_on:letter.issued_on,verify_code:letter.verify_code,verify_path:VERIFY_PATH+letter.verify_code,
      body:seesBody(u,letter,salary)?letter.body:null,body_hidden:!seesBody(u,letter,salary),cancelled:cancellation(db,letter.id)}:null,
    actions};
}

export function lettersBoard(db,supplied){
  const u=actor(db,supplied),hr=u.caps.length>0,types=letterTypes(db,u.tenant_id,{includeInactive:true});
  const rows=(hr?db.prepare('SELECT * FROM letter_requests WHERE tenant_id=? ORDER BY created_at DESC').all(u.tenant_id)
    :db.prepare('SELECT * FROM letter_requests WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC').all(u.tenant_id,u.id)).filter(r=>seesRequest(u,r)).map(r=>requestView(db,u,r,types));
  const open=types.filter(t=>t.active&&!HR_INITIATED.has(t.code)).map(t=>{const published=templateView(db,templateRow(db,u,t.code,['published']));
    return {...t,template_ready:!!published,shows_salary:!!published?.shows_salary&&ruleOf(t.code).salary,bilingual:!!published?.bilingual,effective_from:published?.effective_from??null,rule:ruleOf(t.code)};});
  return {today:today(),user_id:u.id,permissions:u.caps,status_names:STATUS_NAMES,types:open,requests:rows,
    addressees:letterAddressees(db),languages:LANGUAGES,delivery:DELIVERY,sla_days:LETTER_SLA_DAYS,
    // المعالج يُفتح من الكتالوج أو من رابط: #letters/new?type=salary (أو experience، embassy، bank، employment، to_whom).
    new_request_route:'#letters/new?type=',
    awaiting_me:rows.filter(r=>r.actions.some(a=>['prepare_letter','issue_letter'].includes(a))).map(r=>({id:r.id,title:`${r.type_name} — ${r.employee_name}`,created_at:r.created_at,actions:r.actions.filter(a=>['prepare_letter','issue_letter'].includes(a))})),
    note:'اختر نوع الخطاب ثم الجهة واللغة وتفصيل الراتب وطريقة التسليم، وراجع المعاينة قبل التقديم. الراتب يُحسب من عقدك الساري يوم الإصدار ولا يُحفظ في الطلب. من يعدّ الخطاب لا يصدره، ولا يعدّ أحد خطاب نفسه. الخطاب الصادر لا يُعدَّل؛ الإلغاء سجل جديد يبطل رمز التحقق. نوع بلا قالب معتمد لا يمكن طلبه.'};
}

export function templatesBoard(db,supplied){
  const u=actor(db,supplied);
  if(!u.caps.length)fail(403,'not_permitted','قوالب الخطابات لمن يملك إعدادها ولا إصدارها');
  const types=letterTypes(db,u.tenant_id,{includeInactive:true}).map(t=>{
    const published=templateView(db,templateRow(db,u,t.code,['published'])),draft=templateView(db,templateRow(db,u,t.code,['draft'])),actions=[];
    actions.push(draft?'edit_template':'draft_template');
    // نص مبدئي ثنائي اللغة من الترحيل 102: مسودة تحتاج اعتماد الموارد البشرية، يتبناها معد القالب باسمه ولا يعتمدها هو.
    const starter=db.prepare('SELECT body,status_note FROM letter_template_starters WHERE type_code=?').get(t.code)??null;
    if(starter&&!published&&(!draft||!draft.body.trim()))actions.push('adopt_starter');
    if(draft&&draft.prepared_by!==u.id&&u.caps.includes('hr.letters.issue')&&draft.body.trim())actions.push('approve_template');
    if(t.own)actions.push(t.active?'retire_letter_type':'activate_letter_type');
    return {...t,published,draft,starter,actions};
  });
  return {today:today(),user_id:u.id,permissions:u.caps,can_approve:u.caps.includes('hr.letters.issue'),placeholders:PLACEHOLDERS,types,
    awaiting_me:types.filter(t=>t.actions.includes('approve_template')).map(t=>({id:t.code,title:`قالب ${t.name}`,created_at:t.draft?.updated_at??null,actions:['approve_template']})),
    note:'القالب يبدأ فارغًا. لأنواع التعريف بالراتب وبالعمل والخبرة والسفارة والبنك نص مبدئي ثنائي اللغة مسودةً تحتاج اعتماد الموارد البشرية: يتبناه معد القالب ويراجعه، ويعتمده شخص آخر يملك الإصدار. النص عناصر نائبة فقط تملؤها المنصة من سجلاتها، ومن يكتب القالب لا يعتمده. القالب المعتمد لا يُعدَّل؛ تعديله نسخة جديدة تحل محلها عند اعتمادها.'};
}

// D-11 (تدقيق مسارات الوحدات، 20 سبتمبر): «لا قالب معتمد» كان يقف عند الخبر ولا يقول ما الناقص ولا من يوفّره،
// وشاشة السجل المصدر (قضية الانضباط) تتجمد بلا أي بيان. هذه الدالة تحسب الفجوة مرة واحدة بلغة من ينتظرها:
// ما الخطوة التالية بالضبط، ومَن يملك تنفيذها بالاسم، وما العناصر النائبة التي يملؤها القالب.
export function templateGap(db,tenantId,code){
  const type=letterTypes(db,tenantId,{includeInactive:true}).find(t=>t.code===String(code))??null;
  const row=status=>db.prepare(`SELECT * FROM letter_templates WHERE tenant_id=? AND type_code=? AND status=? ORDER BY revision DESC LIMIT 1`).get(tenantId,String(code),status)??null;
  const published=type?row('published'):null,draftRow=type?row('draft'):null;
  const draft=draftRow&&draftRow.body.trim()?draftRow:null;
  const starter=db.prepare('SELECT body FROM letter_template_starters WHERE type_code=?').get(String(code))??null;
  const holderNames=capability=>db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' ORDER BY name").all(tenantId)
    .filter(p=>holds(db,p,capability)).map(p=>p.name);
  const prepare=type?holderNames('hr.letters.prepare'):[],issue=type?holderNames('hr.letters.issue'):[];
  const owners=list=>list.length?`يفعلها: ${list.join('، ')}`:'ولا حساب يحمل هذا التصريح الآن؛ يمنحه الأدمن الأول من «الموظفون والصلاحيات»';
  const keys=[...new Set(placeholdersIn(published?.body??draft?.body??starter?.body??'').used)];
  const placeholders=keys.map(key=>({key,name:PLACEHOLDERS.find(p=>p.key===key)?.name??key}));
  const gap=(step,missing,capability,who)=>({ready:false,step,missing,capability,who,holders:capability==='hr.letters.issue'?issue:prepare});
  let state;
  if(!type)state={ready:false,step:'add_letter_type',missing:'نوع الخطاب غير مسجل في المنصة',capability:'hr.letters.issue',who:owners(issue),holders:issue};
  else if(!type.active)state={ready:false,step:'activate_letter_type',missing:`نوع «${type.name}» موقوف`,capability:'hr.letters.issue',who:owners(issue),holders:issue};
  else if(published)state={ready:true,step:null,missing:null,capability:null,who:null,holders:[]};
  else if(draft)state=gap('approve_template',`للنوع مسودة قالب كتبها ${name(db,draft.prepared_by)??'معد القوالب'} تنتظر الاعتماد`,'hr.letters.issue',owners(issue.filter(n=>n!==name(db,draft.prepared_by))));
  else if(starter)state=gap('adopt_starter','لا قالب ولا مسودة؛ وللنوع نص مبدئي ثنائي اللغة جاهز للتبني من «قوالب الخطابات»','hr.letters.prepare',owners(prepare));
  else state=gap('draft_template','لا قالب ولا مسودة ولا نص مبدئي لهذا النوع','hr.letters.prepare',owners(prepare));
  const message=state.ready?null
    :`لا قالب معتمد لنوع «${type?.name??code}» بعد. ${state.missing}. الخطوة التالية: ${({add_letter_type:'إضافة النوع',activate_letter_type:'إعادة تفعيل النوع',approve_template:'اعتماد المسودة (ويعتمدها غير من كتبها)',adopt_starter:'تبني النص المبدئي مسودةً ثم اعتمادها من شخص آخر',draft_template:'كتابة القالب مسودةً ثم اعتمادها من شخص آخر'})[state.step]} — ${state.who}${placeholders.length?`. عناصر القالب النائبة التي تملؤها المنصة: ${placeholders.map(p=>`{{${p.key}}} (${p.name})`).join('، ')}`:''}`;
  return {...state,type_code:String(code),type_name:type?.name??String(code),has_starter:!!starter,has_draft:!!draft,placeholders,message};
}
export function templateRequired(db,tenantId,code){
  const gap=templateGap(db,tenantId,code);
  throw Object.assign(new AppError(409,'template_required',gap.message),{details:gap});
}

// يتبنى معد القالب النص المبدئي مسودةً باسمه (saveTemplate)، فيبقى فصل المهام: لا يعتمده هو.
export function adoptStarter(db,supplied,code,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.length)fail(403,'not_permitted','تبنّي النص المبدئي لمن يملك إعداد الخطابات ولا إصدارها');
  v.object(input,['version']);
  const starter=typeof code==='string'&&db.prepare('SELECT body FROM letter_template_starters WHERE type_code=?').get(code);
  if(!starter){const gap=templateGap(db,u.tenant_id,code);
    throw Object.assign(new AppError(404,'not_found',`لا نص مبدئي لنوع «${gap.type_name}». ${gap.ready?'للنوع قالب معتمد أصلًا':`${gap.missing}. الخطوة التالية: كتابة القالب مسودةً بعناصره النائبة — ${gap.who}`}`),{details:gap});}
  const draft=templateRow(db,u,code,['draft']);
  if(draft&&draft.body.trim())fail(409,'draft_exists','للنوع مسودة مكتوبة — عدّلها بدال ما تتبنّى النص المبدئي');
  return saveTemplate(db,u,code,{body:starter.body,...(draft?{version:input.version}:{})});
}

export function addLetterType(db,supplied,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.letters.issue','إضافة نوع خطاب لمالك إجراء الخطابات');
  v.object(input,['code','name']);
  const code=v.text(input.code,'رمز النوع',40,3).toLowerCase();
  if(!/^[a-z][a-z0-9_-]{2,39}$/.test(code))fail(400,'code','رمز النوع حروف إنجليزية صغيرة وأرقام وشرطات وبس');
  if(typeOf(db,u.tenant_id,code,{includeInactive:true}))fail(409,'duplicate_type','النوع هذا مسجّل عندنا من قبل');
  const typeId=id();
  db.prepare('INSERT INTO letter_types(id,tenant_id,code,name,created_by,created_at) VALUES(?,?,?,?,?,?)').run(typeId,u.tenant_id,code,v.text(input.name,'اسم النوع',120,3),u.id,now());
  audit(db,u,'letter_type',typeId,'letter_type.added',{}, {code});
  return {id:typeId};
}
export function letterTypeAction(db,supplied,code,action,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.letters.issue','تغيير أنواع الخطابات لمالك إجراء الخطابات');
  v.object(input,['version','note']);
  if(!['retire_letter_type','activate_letter_type'].includes(action))fail(404,'not_found','الإجراء لازم يكون سحب النوع ولا تفعيله');
  const type=db.prepare('SELECT * FROM letter_types WHERE tenant_id=? AND code=?').get(u.tenant_id,String(code));
  if(!type)fail(404,'not_found','النوع مو متاح لهذا الكيان — الأنواع الأساسية مشتركة وما تتعدّل من هنا');
  v.version(input.version,type.version);
  const active=action==='activate_letter_type'?1:0;
  if(active===type.active)fail(409,'no_change','النوع أصلًا في هذي الحالة');
  db.prepare('UPDATE letter_types SET active=?,version=version+1 WHERE id=?').run(active,type.id);
  audit(db,u,'letter_type',type.id,'letter_type.'+action,{active:!!type.active},{active:!!active},v.text(input.note,'سبب التغيير',1000,5));
  return {id:type.id};
}

export function saveTemplate(db,supplied,code,input){
  writing(db);const u=actor(db,supplied);
  if(!u.caps.length)fail(403,'not_permitted','كتابة قوالب الخطابات لمن يملك إعدادها ولا إصدارها');
  v.object(input,['body','version']);
  const type=typeOf(db,u.tenant_id,String(code),{includeInactive:true});
  if(!type)fail(404,'not_found','ما لقينا نوع الخطاب هذا');
  // النص قد يُحفظ فارغًا: القالب يبدأ فارغًا ولا يملؤه الكود.
  const body=input.body===''?'':v.text(input.body,'نص القالب',8000,1);
  const scan=placeholdersIn(body);
  if(scan.unknown.length)fail(400,'unknown_placeholder',`عنصر نائب ما نعرفه: ${scan.unknown.map(k=>`{{${k}}}`).join('، ')}`);
  if(scan.stray)fail(400,'placeholder_syntax','عنصر نائب ناقص — الصيغة كذا: {{employee_name}}');
  const foreign=scan.used.filter(k=>{const types=PLACEHOLDERS.find(p=>p.key===k)?.types;return types&&!types.includes(type.code);});
  if(foreign.length)fail(400,'placeholder_type',`عنصر نائب ما ينملي في هذا النوع: ${foreign.map(k=>`{{${k}}}`).join('، ')}`);
  const draft=templateRow(db,u,type.code,['draft']),time=now();
  if(draft){
    v.version(input.version,draft.version);
    db.prepare('UPDATE letter_templates SET body=?,prepared_by=?,version=version+1,updated_at=? WHERE id=?').run(body,u.id,time,draft.id);
    audit(db,u,'letter_template',draft.id,'letter_template.edited',{}, {type_code:type.code});
    return {id:draft.id};
  }
  const previous=db.prepare('SELECT COALESCE(MAX(revision),0) AS n FROM letter_templates WHERE tenant_id=? AND type_code=?').get(u.tenant_id,type.code).n,templateId=id();
  db.prepare("INSERT INTO letter_templates(id,tenant_id,type_code,revision,body,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?,?)").run(templateId,u.tenant_id,type.code,previous+1,body,u.id,time,time);
  audit(db,u,'letter_template',templateId,'letter_template.drafted',{}, {type_code:type.code,revision:previous+1});
  return {id:templateId};
}
export function approveTemplate(db,supplied,code,input){
  writing(db);const u=actor(db,supplied);need(u,'hr.letters.issue','اعتماد قوالب الخطابات لمالك إجراء الخطابات');
  v.object(input,['effective_from','note','version']);
  const type=typeOf(db,u.tenant_id,String(code),{includeInactive:true});
  if(!type)fail(404,'not_found','ما لقينا نوع الخطاب هذا');
  const draft=templateRow(db,u,type.code,['draft']);
  if(!draft)fail(404,'not_found','ما فيه مسودة قالب تنتظر اعتمادك');
  v.version(input.version,draft.version);
  if(draft.prepared_by===u.id)fail(409,'separation_of_duties','اللي كتب القالب ما يعتمده');
  if(!draft.body.trim())fail(409,'empty_template','القالب فاضي — اكتب نصه بعناصره النائبة قبل الاعتماد');
  const effective=v.date(input.effective_from);
  if(effective<today())fail(400,'effective_from','خلّ تاريخ السريان اليوم ولا بعده');
  v.text(input.note,'إقرارك باعتماد نص القالب',1000,10);
  const time=now(),previous=templateRow(db,u,type.code,['published']);
  if(previous)db.prepare("UPDATE letter_templates SET status='superseded',version=version+1,updated_at=? WHERE id=?").run(time,previous.id);
  db.prepare("UPDATE letter_templates SET status='published',effective_from=?,published_by=?,published_at=?,version=version+1,updated_at=? WHERE id=?").run(effective,u.id,time,time,draft.id);
  audit(db,u,'letter_template',draft.id,'letter_template.approved',{}, {type_code:type.code,revision:draft.revision},input.note.trim());
  // طلبات الكتالوج المعتمدة التي كانت تنتظر قالب هذا النوع تُفتح الآن في «خطاباتي» (service-routes.mjs).
  onTemplatePublished(db,u.tenant_id,type.code);
  return {id:draft.id};
}

// ————— معالج طلب الخطاب —————

export function letterAddressees(db){
  const rows=db.prepare('SELECT kind,code,name_ar,name_en,country_ar,country_en FROM letter_addressees WHERE active=1 ORDER BY kind,name_ar').all();
  return {bank:rows.filter(r=>r.kind==='bank'),embassy:rows.filter(r=>r.kind==='embassy'),government:rows.filter(r=>r.kind==='government'),
    note:'قائمة مرجعية بالأسماء فقط يراجعها مالك الإجراء. إن لم تجد الجهة فاكتب اسمها كما يجب أن يظهر في الخطاب.'};
}
const REQUEST_FIELDS=['type_code','addressee','purpose','user_id','addressee_kind','addressee_code','language','salary_detail','salary_period','travel_from','travel_to','destination','delivery','copies','urgent','urgent_reason','reused_from'];
// اسم جهة حر: حروف فعلية، بلا روابط ولا وسوم ولا عناصر نائبة ولا أرقام وحدها.
function freeAddressee(value){
  const text=v.text(value,'اسم الجهة الموجه إليها',200,2).replace(/\s+/g,' ');
  if(!/[\p{L}]{2}/u.test(text))fail(400,'addressee','اكتب اسم الجهة بالحروف لا بالأرقام');
  if(/[<>{}]|https?:|www\.|@/i.test(text))fail(400,'addressee','اسم الجهة نص وبس، بلا روابط ولا رموز');
  return text;
}
// يوحّد خيارات الطلب ويتحقق منها بقواعد النوع. لا يكتب شيئًا، فيخدم المعاينة والتقديم معًا.
function cleanRequest(db,u,input){
  v.object(input,REQUEST_FIELDS);
  const subject=input.user_id&&input.user_id!==u.id?input.user_id:u.id;
  // الموظف يطلب لنفسه؛ ومن يملك الإعداد يفتح طلبًا نيابة عن موظف آخر لا عن نفسه.
  if(subject!==u.id&&!u.caps.length)fail(403,'not_permitted','ما تقدر تفتح طلب خطاب لغيرك');
  const type=typeOf(db,u.tenant_id,String(input.type_code));
  if(!type||HR_INITIATED.has(type.code))fail(404,'not_found','ما لقينا نوع الخطاب هذا');
  const rule=ruleOf(type.code);
  // شهادة الخبرة لمن غادر: تفتحها الموارد البشرية نيابة عنه، فحسابه غير نشط.
  const person=db.prepare(`SELECT id,active FROM users WHERE id=? AND tenant_id=? AND role<>'admin'${rule.former&&subject!==u.id?'':' AND active=1'}`).get(subject,u.tenant_id);
  if(!person)fail(404,'not_found','ما لقينا الموظف هذا');
  const template=templateRow(db,u,type.code,['published']);
  if(!template)fail(409,'template_required','ما فيه قالب معتمد لهذا النوع لين الحين — مالك الإجراء يكتبه ويعتمده قبل الطلب');
  const used=placeholdersIn(template.body).used;
  // الجهة: من القائمة (بنك، سفارة، جهة حكومية)، أو «لمن يهمه الأمر»، أو نص حر متحقق منه. الطلب القديم بلا نوع جهة = نص حر.
  const kind=input.addressee_kind??(rule.addressees.includes('other')?'other':rule.addressees[0]);
  if(!rule.addressees.includes(kind))fail(400,'addressee_kind',`هذا النوع يتوجّه لـ: ${rule.addressees.join('، ')}`);
  let code=null,addressee='';
  if(['bank','embassy','government'].includes(kind)){
    const a=typeof input.addressee_code==='string'&&db.prepare('SELECT * FROM letter_addressees WHERE kind=? AND code=? AND active=1').get(kind,input.addressee_code);
    if(!a)fail(400,'addressee_code','اختر الجهة من القائمة اللي فوق');
    code=a.code;addressee=a.name_ar;
  }else if(kind==='to_whom')addressee=TO_WHOM.ar;
  else addressee=used.includes('addressee')?freeAddressee(input.addressee):(input.addressee?freeAddressee(input.addressee):'');
  const language=input.language??'ar';
  if(!LANGUAGES.some(l=>l.key===language))fail(400,'language','اختر لغة الخطاب من القائمة');
  const salary=rule.salary&&usesSalary(template.body);
  const detail=salary?(input.salary_detail??'total'):null,period=salary?(input.salary_period??(input.salary_detail?'monthly':null)):null;
  if(salary&&!['total','breakdown'].includes(detail))fail(400,'salary_detail','اختر: الإجمالي ولا التفصيل');
  if(salary&&period!==null&&!['monthly','annual'].includes(period))fail(400,'salary_period','اختر: شهري ولا سنوي');
  let travel={travel_from:null,travel_to:null,destination:null};
  if(rule.travel){
    const from=v.date(input.travel_from),to=v.date(input.travel_to);
    if(to<from)fail(400,'travel_to','خلّ نهاية السفر بعد بدايته');
    if(from<today())fail(400,'travel_from','خلّ بداية السفر اليوم ولا بعده');
    const country=code?db.prepare("SELECT country_ar FROM letter_addressees WHERE kind='embassy' AND code=?").get(code)?.country_ar:null;
    // بلد الوجهة من السفارة المختارة يُملأ بلغة كل جزء عند الإصدار؛ لا يُحفظ إلا ما كتبه الموظف.
    if(!input.destination&&!country)fail(400,'destination','اكتب بلد الوجهة اللي بتسافر لها');
    travel={travel_from:from,travel_to:to,destination:input.destination?v.text(input.destination,'بلد الوجهة',120,2):null};
  }
  const purposeText=typeof input.purpose==='string'?input.purpose.trim():'';
  if(rule.purpose==='required'&&purposeText.length<5)fail(400,'purpose',rule.travel?'اذكر الغرض من السفر (سياحة، عمل، زيارة…)':'اذكر الغرض من الخطاب (فتح حساب، تمويل…)');
  const purpose=purposeText?v.text(purposeText,'الغرض من الخطاب',1000,5):'';
  const delivery=input.delivery??'digital';
  if(!DELIVERY.some(d=>d.key===delivery))fail(400,'delivery','اختر طريقة التسليم من القائمة');
  const copies=input.copies===undefined||input.copies===null||input.copies===''?1:Number(input.copies);
  if(!Number.isInteger(copies)||copies<1||copies>5)fail(400,'copies','عدد النسخ من 1 لين 5 نسخ وبس');
  if(delivery==='digital'&&copies!==1)fail(400,'copies','النسخة الرقمية وحدة — إذا تبي كم نسخة مختومة اختر المطبوعة');
  const urgent=input.urgent===true||input.urgent==='on';
  const urgentReason=urgent?v.text(input.urgent_reason,'سبب الاستعجال',500,5):'';
  let reused=null;
  if(input.reused_from){reused=db.prepare('SELECT id FROM letter_requests WHERE id=? AND tenant_id=? AND user_id=?').get(input.reused_from,u.tenant_id,person.id)?.id;if(!reused)fail(404,'not_found','ما لقينا الطلب السابق هذا');}
  const due=addWorkingDays(today(),urgent?LETTER_SLA_DAYS.urgent:LETTER_SLA_DAYS.normal,holidaySet(db,u.tenant_id));
  return {person,type,template,addressee,purpose,options:{addressee_kind:kind,addressee_code:code,language,salary_detail:detail,salary_period:period,...travel,delivery,copies,urgent:urgent?1:0,urgent_reason:urgentReason,due_on:due,reused_from:reused}};
}
// المعاينة قبل التقديم: النص كما سيصدر، والراتب محجوب. لا تكتب شيئًا.
export function previewLetter(db,supplied,input){
  const u=actor(db,supplied),c=cleanRequest(db,u,input);
  const r={addressee:c.addressee},rendered=renderLetter(db,c.template.body,facts(db,u.tenant_id,c.person.id),r,c.options,{mask:true});
  const warnings=[];
  if(!splitLanguages(c.template.body).en&&c.options.language!=='ar')warnings.push('القالب المعتمد بلغة واحدة؛ سيصدر كما هو.');
  if(rendered.missing.length)warnings.push(`بيانات ناقصة في سجلك تمنع الإصدار: ${rendered.missing.map(k=>PLACEHOLDERS.find(p=>p.key===k)?.name??k).join('، ')}. تكملها الموارد البشرية.`);
  return {type_code:c.type.code,type_name:c.type.name,addressee:c.addressee,language:c.options.language,body:rendered.text,salary_masked:usesSalary(c.template.body),
    delivery:c.options.delivery,copies:c.options.copies,urgent:!!c.options.urgent,due_on:c.options.due_on,missing_values:rendered.missing,warnings,
    note:'معاينة فقط: الراتب محجوب هنا ويُحسب من عقدك الساري يوم الإصدار ولا يُحفظ في الطلب. بعد التقديم تعدّه الموارد البشرية ويصدره مالك الإجراء، ويصلك إشعار لتحميله.'};
}
export function requestLetter(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  const c=cleanRequest(db,u,input),requestId=id(),time=now();
  if(db.prepare("SELECT 1 FROM letter_requests WHERE tenant_id=? AND user_id=? AND type_code=? AND status IN ('requested','prepared')").get(u.tenant_id,c.person.id,c.type.code))fail(409,'open_request','عندك طلب مفتوح على نفس النوع');
  db.prepare("INSERT INTO letter_requests(id,tenant_id,user_id,type_code,addressee,purpose,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'requested',?,?)").run(requestId,u.tenant_id,c.person.id,c.type.code,c.addressee,c.purpose,time,time);
  const o=c.options;
  db.prepare('INSERT INTO letter_request_options(request_id,tenant_id,addressee_kind,addressee_code,language,salary_detail,salary_period,travel_from,travel_to,destination,delivery,copies,urgent,urgent_reason,due_on,reused_from,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(requestId,u.tenant_id,o.addressee_kind,o.addressee_code,o.language,o.salary_detail,o.salary_period,o.travel_from,o.travel_to,o.destination,o.delivery,o.copies,o.urgent,o.urgent_reason,o.due_on,o.reused_from,time);
  audit(db,u,'letter_request',requestId,'letter.requested',{}, {type_code:c.type.code,user_id:c.person.id,language:o.language,delivery:o.delivery,urgent:!!o.urgent,reused_from:o.reused_from});
  return {id:requestId};
}

function requestRow(db,u,requestId){
  const r=typeof requestId==='string'&&db.prepare('SELECT * FROM letter_requests WHERE id=? AND tenant_id=?').get(requestId,u.tenant_id);
  if(!r||!seesRequest(u,r))fail(404,'not_found','ما لقينا طلب الخطاب هذا');
  return r;
}
// الرقم المرجعي متسلسل بلا فجوات داخل السنة: يؤخذ أعلى رقم في الكيان والسنة ويُزاد واحدًا داخل المعاملة نفسها.
function nextReference(db,tenantId,year){
  const serial=db.prepare('SELECT COALESCE(MAX(serial),0) AS n FROM letters WHERE tenant_id=? AND year=?').get(tenantId,year).n+1;
  return {serial,reference:`${year}-${String(serial).padStart(5,'0')}`};
}
export function letterAction(db,supplied,requestId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields={prepare_letter:['note'],reject_letter:['note'],cancel_request:['note'],issue_letter:['note'],cancel_letter:['reason'],record_handover:['note']}[action];
  if(!fields)fail(404,'not_found','ما فيه إجراء بهذا الاسم على طلب الخطاب');
  v.object(input,['version',...fields]);
  const r=requestRow(db,u,requestId),current=requestView(db,u,r,letterTypes(db,u.tenant_id,{includeInactive:true}));
  v.version(input.version,r.version);
  // D-14: الرفض يسمّي حالة الطلب وسببه والمتاح لك الآن ومن يملك الخطوة التالية.
  if(!current.actions.includes(action))v.actionUnavailable(action,{subject:`طلب «${current.type_name}»`,state_name:STATUS_NAMES[r.status],available:current.actions,
    names:{prepare_letter:'إعداد الخطاب',issue_letter:'إصدار الخطاب',reject_letter:'رفض الطلب',cancel_request:'إلغاء الطلب',cancel_letter:'إلغاء الخطاب الصادر',record_handover:'تسجيل تسليم النسخ المطبوعة',request_again:'طلب مرة أخرى'},
    reason:action==='issue_letter'&&current.missing_values.length?`بيانات ناقصة في سجل الموظف تمنع الإصدار: ${current.missing_values.map(k=>PLACEHOLDERS.find(p=>p.key===k)?.name??k).join('، ')}`
      :action==='issue_letter'&&r.prepared_by===u.id?'من أعدّ الخطاب لا يصدره (فصل المهام)'
      :action==='issue_letter'&&r.user_id===u.id?'لا يصدر أحد خطاب نفسه'
      :!current.template_ready?'لا قالب معتمد لهذا النوع بعد'
      :'حالة الطلب لا تقبل هذا الإجراء أو لا يحمله تصريحك',
    who:r.status==='requested'?'الخطوة التالية إعداد الخطاب لحامل تصريح إعداد خطابات الموظفين (hr.letters.prepare)'
      :r.status==='prepared'?'الخطوة التالية الإصدار لحامل تصريح إصدار الخطابات (hr.letters.issue)، وهو غير من أعدّه':null});
  const time=now();
  if(action==='record_handover'){
    db.prepare('UPDATE letter_request_options SET handed_over_at=?,handed_over_by=?,handover_note=? WHERE request_id=?').run(time,u.id,v.text(input.note,'من استلم النسخ المطبوعة ومتى',500,5),r.id);
    audit(db,u,'letter_request',r.id,'letter.handed_over',{}, {copies:optionsOf(db,r.id).copies});
    return {id:r.id};
  }
  if(action==='prepare_letter'){
    const note=input.note?v.text(input.note,'ملاحظة الإعداد',1000):'';
    if(current.missing_values.length)fail(409,'missing_values',`ما نقدر نجهّزه: ناقص من سجل الموظف — ${current.missing_values.map(k=>PLACEHOLDERS.find(p=>p.key===k)?.name??k).join('، ')}`);
    db.prepare("UPDATE letter_requests SET status='prepared',prepared_by=?,prepared_at=?,prepare_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,time,r.id);
  }else if(action==='reject_letter'||action==='cancel_request'){
    db.prepare('UPDATE letter_requests SET status=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(action==='reject_letter'?'rejected':'cancelled',v.text(input.note,'السبب',1000,5),time,r.id);
  }else if(action==='issue_letter'){
    const template=templateRow(db,u,r.type_code,['published']);
    if(!template)fail(409,'template_required','ما فيه قالب معتمد لهذا النوع');
    // الراتب يُقرأ من العقد الساري الآن ويُثبَّت في نص الخطاب وحده؛ لا يُخزَّن في الطلب ولا في خياراته ولا في السجل.
    const f=facts(db,u.tenant_id,r.user_id),rendered=renderLetter(db,template.body,f,r,optionsOf(db,r.id));
    if(rendered.missing.length)fail(409,'missing_values',`ناقص من سجل الموظف: ${rendered.missing.map(k=>PLACEHOLDERS.find(p=>p.key===k)?.name??k).join('، ')}`);
    const date=today(),year=Number(date.slice(0,4)),{serial,reference}=nextReference(db,u.tenant_id,year);
    db.prepare('INSERT INTO letters(id,tenant_id,request_id,type_code,template_id,contract_id,user_id,year,serial,reference,verify_code,body,issued_on,prepared_by,issued_by,issued_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,r.id,r.type_code,template.id,rendered.used.some(k=>SENSITIVE_KEYS.has(k))?f.contract?.id??null:null,r.user_id,year,serial,reference,verifyCode(),rendered.text,date,r.prepared_by,u.id,time);
    db.prepare("UPDATE letter_requests SET status='issued',issued_by=?,issued_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,input.note?v.text(input.note,'ملاحظة الإصدار',1000):'',time,r.id);
    // المبلغ لا يدخل سجل التدقيق: يكفي أثر الإصدار ومرجعه.
    audit(db,u,'letter',r.id,'letter.issued',{}, {reference,type_code:r.type_code,user_id:r.user_id});
    // إشعار صاحب الخطاب (B6): نوعه ورقمه المرجعي فقط؛ لا مبلغ ولا رقم هوية ولو كانا في نص الخطاب.
    if(r.user_id!==u.id)notifySubject(db,{userId:r.user_id,kind:'letter_issued',subjectKind:'letter_request',subjectId:r.id,title:`صدر خطابك: ${current.type_name}`,body:`الرقم المرجعي ${reference}. افتحه من «خطاباتي» للطباعة.`});
    return {id:r.id,reference};
  }else{
    const letter=db.prepare('SELECT * FROM letters WHERE request_id=?').get(r.id);
    if(!letter)fail(404,'not_found','ما فيه خطاب صادر على هذا الطلب');
    db.prepare('INSERT INTO letter_cancellations(id,letter_id,tenant_id,reason,cancelled_by,cancelled_at) VALUES(?,?,?,?,?,?)').run(id(),letter.id,u.tenant_id,v.text(input.reason,'سبب الإلغاء',1000,10),u.id,time);
    audit(db,u,'letter',letter.id,'letter.cancelled',{reference:letter.reference},{verify_code_invalid:true},input.reason.trim());
    letterNotice(db,u,'letter_cancelled',r,current.type_name,letter.reference);
    return {id:r.id};
  }
  audit(db,u,'letter_request',r.id,'letter.'+action,{status:r.status},{version:r.version+1});
  if(action==='prepare_letter')letterNotice(db,u,'prepared',r,current.type_name);
  if(action==='cancel_request')letterNotice(db,u,'request_cancelled',r,current.type_name);
  if(action==='reject_letter'&&r.user_id!==u.id)notifySubject(db,{userId:r.user_id,kind:'letter_rejected',subjectKind:'letter_request',subjectId:r.id,title:`رُفض طلب خطاب: ${current.type_name}`,body:'سبب الرفض مكتوب في «خطاباتي».'});
  return {id:r.id};
}

// خطاب تصدره الموارد البشرية من سجل آخر (إشعار الجزاء، م121): لا طلب من الموظف ولا خطوة إعداد منفصلة.
// المُعِدّ من قرر مضمونه في السجل المصدر (preparedBy)، والمُصدِر حامل تصريح الإصدار وليس المعد ولا صاحب الخطاب.
// القالب المعتمد وحده يحدد النص؛ السجل المصدر يمرر قيم العناصر النائبة الخاصة بنوعه فقط.
export function issueInitiatedLetter(db,supplied,{typeCode,userId,purpose,preparedBy,values}){
  writing(db);const u=actor(db,supplied);need(u,'hr.letters.issue','إصدار الخطاب لحامل تصريح إصدار الخطابات');
  if(!HR_INITIATED.has(typeCode))fail(400,'type','هذا النوع مو خطاب تصدره الموارد البشرية');
  if(userId===u.id)fail(409,'separation_of_duties','ما ينفع الموظف يصدر خطاب عن نفسه');
  if(preparedBy===u.id)fail(409,'separation_of_duties','اللي قرر مضمون الخطاب ما يصدره');
  const type=typeOf(db,u.tenant_id,typeCode);
  if(!type)templateRequired(db,u.tenant_id,typeCode);
  const template=templateRow(db,u,typeCode,['published']);
  // D-11: الرفض يسمّي الناقص والخطوة التالية ومن يملكها بالاسم، بدل «لا قالب معتمد» وحدها.
  if(!template)templateRequired(db,u.tenant_id,typeCode);
  const f=facts(db,u.tenant_id,userId),filled={...fieldValues(f,{addressee:''}),...values},used=placeholdersIn(template.body).used;
  const missing=used.filter(key=>!filled[key]);
  if(missing.length)fail(409,'missing_values',`ناقص للقالب: ${missing.map(k=>PLACEHOLDERS.find(p=>p.key===k)?.name??k).join('، ')}`);
  const time=now(),date=today(),year=Number(date.slice(0,4)),{serial,reference}=nextReference(db,u.tenant_id,year),requestId=id(),letterId=id();
  db.prepare("INSERT INTO letter_requests(id,tenant_id,user_id,type_code,addressee,purpose,status,prepared_by,prepared_at,issued_by,issued_at,created_at,updated_at) VALUES(?,?,?,?,'',?,'issued',?,?,?,?,?,?)")
    .run(requestId,u.tenant_id,userId,typeCode,v.text(purpose,'الغرض',1000,5),preparedBy,time,u.id,time,time,time);
  db.prepare('INSERT INTO letters(id,tenant_id,request_id,type_code,template_id,contract_id,user_id,year,serial,reference,verify_code,body,issued_on,prepared_by,issued_by,issued_at) VALUES(?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)')
    .run(letterId,u.tenant_id,requestId,typeCode,template.id,userId,year,serial,reference,verifyCode(),fillBody(template.body,filled),date,preparedBy,u.id,time);
  audit(db,u,'letter',requestId,'letter.issued',{}, {reference,type_code:typeCode,user_id:userId});
  return {request_id:requestId,letter_id:letterId,reference};
}

// ————— قراءة مختصرة لوحدة أخرى فتحت طلب خطاب نيابة عن سجلها (مثل «مزاياي»، ترحيل 103) —————
// حالة الطلب ورقم الخطاب الصادر فقط: لا نص الخطاب ولا رمز التحقق. النص ورمزه في «خطاباتي» بقاعدة seesBody نفسها.
export function letterRequestSummary(db,tenantId,requestId){
  const r=typeof requestId==='string'&&db.prepare('SELECT id,type_code,status FROM letter_requests WHERE id=? AND tenant_id=?').get(requestId,tenantId);
  if(!r)return null;
  const letter=db.prepare('SELECT id,reference,issued_on FROM letters WHERE request_id=?').get(r.id)??null;
  const cancelled=letter?!!db.prepare('SELECT 1 FROM letter_cancellations WHERE letter_id=?').get(letter.id):false;
  return {request_id:r.id,type_code:r.type_code,status:r.status,status_name:STATUS_NAMES[r.status]??r.status,
    reference:letter?.reference??null,issued_on:letter?.issued_on??null,cancelled,link:'#letters'};
}
// هل يستطيع الموظف طلب هذا النوع الآن؟ نوع نشط وله قالب معتمد. تُسألها «مزاياي» قبل أن تعرض خيار الخطاب.
export const letterTypeReady=(db,tenantId,code)=>
  !!letterTypes(db,tenantId).find(t=>t.code===code)&&!!db.prepare("SELECT 1 FROM letter_templates WHERE tenant_id=? AND type_code=? AND status='published'").get(tenantId,code);

// مسار التحقق العام: لا اسم ولا راتب ولا مرجع — «صدر» أو «لا يوجد» فقط.
// بلا مصادقة فبلا حساب، فلا نطاق كيان هنا؛ ولا يُعيد المسار أي بيان يخص كيانًا. الخطاب الملغى يعامل معاملة غير الموجود.
export function verifyLetter(db,code){
  const row=typeof code==='string'&&/^[0-9A-Z]{8,40}$/.test(code)
    ?db.prepare('SELECT l.issued_on,c.id AS cancellation FROM letters l LEFT JOIN letter_cancellations c ON c.letter_id=l.id WHERE l.verify_code=?').get(code)
    :null;
  if(!row||row.cancellation)return {found:false,statement:'لا يوجد خطاب ساري بهذا الرمز.'};
  return {found:true,issued_on:row.issued_on,statement:`صدر هذا الخطاب من المنصة بتاريخ ${dual(row.issued_on)} لموظف لدينا.`};
}

export function letterDocument(db,supplied,letterId){
  const u=actor(db,supplied);
  const letter=typeof letterId==='string'&&db.prepare('SELECT * FROM letters WHERE id=? AND tenant_id=?').get(letterId,u.tenant_id);
  // من ليس صاحب الخطاب ولا يعمل على الخطابات لا يعرف أصلًا أن هذا الخطاب موجود.
  if(!letter||!seesRequest(u,letter))fail(404,'not_found','ما لقينا الخطاب هذا');
  const salary=showsSalary(db,letter);
  if(!seesBody(u,letter,salary))fail(403,'forbidden','نص الخطاب هذا لصاحبه ولمن يملك إصداره وبس');
  const type=typeOf(db,u.tenant_id,letter.type_code,{includeInactive:true});
  const o=optionsOf(db,letter.request_id);
  return {reference:letter.reference,type_name:type?.name??letter.type_code,employee_name:name(db,letter.user_id),body:letter.body,issued_on:letter.issued_on,delivery:o?.delivery??'digital',copies:o?.copies??1,language:o?.language??'ar',
    verify_code:letter.verify_code,verify_path:VERIFY_PATH+letter.verify_code,prepared_by_name:name(db,letter.prepared_by),issued_by_name:name(db,letter.issued_by),
    cancelled:cancellation(db,letter.id)};
}

// نسخة للطباعة على نمط باقي مستندات المنصة: المستخدم يحفظها PDF من المتصفح.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// الذيل يقرأ tenants.demo_data (الترحيل 137) بدل أن يكتب بحرفه أن البيانات مصطنعة. الوسيط الأخير اختياري وافتراضه
// الحالة المصطنعة: موضع نداء لم يُحدَّث يبقى يطبع التحذير، ولا يسقطه صامتًا عن خطاب صار حقيقيًا.
export function letterPrintable(d,demoData=SYNTHETIC){
  const body=esc(d.body).split(/\n{2,}/).map(part=>`<p>${part.replace(/\n/g,'<br>')}</p>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.type_name)} ${esc(d.reference)}</title><link rel="stylesheet" href="/report-print.css"></head><body class="doc">
    <header><p class="brand">3,6T</p><h1>${esc(d.type_name)}</h1><p class="meta">الرقم المرجعي <bdi dir="ltr">${esc(d.reference)}</bdi> · تاريخ الإصدار ${esc(dual(d.issued_on))}</p></header>
    <p class="notice">${d.cancelled?`أُلغي هذا الخطاب بتاريخ ${esc(d.cancelled.cancelled_at.slice(0,10))} ورمز التحقق مُبطل. هذه النسخة للأرشيف فقط.`:'صادر من المنصة. للتحقق من صحته امسح الرمز أو افتح مسار التحقق أدناه؛ لا يكشف المسار اسمًا ولا راتبًا.'}</p>
    ${body}
    <section class="qr">${qrSvg(d.verify_path,{scale:3})}<div><p><strong>التحقق من الخطاب</strong></p><p class="meta">المسار: <bdi dir="ltr">${esc(d.verify_path)}</bdi></p><p class="meta">رمز التحقق: <bdi dir="ltr">${esc(d.verify_code)}</bdi></p></div></section>
    <p class="meta">أعدّه ${esc(d.prepared_by_name)} · أصدره ${esc(d.issued_by_name)}${d.delivery==='printed'?` · نسخة مطبوعة مختومة (${esc(d.copies)} ${d.copies===1?'نسخة':'نسخ'}) تُستلم من الموارد البشرية`:''}</p>
    <footer>${esc(documentFooter(demoData))}</footer></body></html>`;
}
