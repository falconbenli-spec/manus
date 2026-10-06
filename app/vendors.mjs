import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can, holds } from './access.mjs';
import { seal, unseal } from './crypto-fields.mjs';
import { registerOptionList, registerAdoption, optionsFor, optionLabel, requireOption, adopted, listsBoard } from './options.mjs';
import { MODULE_STATUS_MAP } from './static/vocabulary.mjs';
import { notifyMany, SUBJECT_LINKS } from './notices.mjs';

// ما تقابله حالة الملف من الحالات الثماني، حيث تقابلها واحدة. الثلاث الباقية تبقى بلا مقابل عمدًا.
const VENDOR_CANONICAL=Object.fromEntries(Object.entries(MODULE_STATUS_MAP.vendor).map(([key,entry])=>[key,entry.status]));

// مركز الموردين داخل المشتريات. المورد لا يدخل المنصة؛ الموظف المخول يسجل ويتابع.
export const CATEGORIES=[
  ['print_gifts','مطابع وهدايا'],['photo_video','تصوير وفيديو'],['motion_design','موشن وتصميم'],['writing_translation','كتابة وترجمة'],
  ['influencers','مؤثرون وصناع محتوى'],['events','تنظيم فعاليات ومعارض'],['venues_hospitality','مواقع وقاعات وضيافة'],['equipment_rental','معدات وتأجير'],
  ['media_buying','شراء إعلامي'],['web_tech','تطوير ومواقع وتقنية'],['logistics','نقل وشحن'],['consulting_training','استشارات وتدريب'],
  ['facilities','مرافق وصيانة'],['other','خدمات أخرى']
].map(([key,name])=>({key,name}));
export const ENTITY_TYPES=[['company','شركة'],['establishment','مؤسسة فردية'],['individual','فرد أو مستقل'],['foreign','كيان خارج السعودية']].map(([key,name])=>({key,name}));
export const DOCUMENT_KINDS=[
  ['commercial_registration','سجل تجاري'],['foreign_registration','وثيقة تسجيل الكيان في بلده'],['freelance_license','وثيقة عمل حر'],
  ['vat_certificate','شهادة تسجيل ضريبي'],['bank_proof','إثبات حساب بنكي'],['nda','اتفاقية سرية'],['media_license','ترخيص إعلامي للمحتوى الإعلاني'],
  ['insurance','وثيقة تأمين'],['permit','تصريح خاص بالخدمة'],['usage_rights','وثيقة حقوق استخدام'],['professional_license','ترخيص مهني أو نشاط']
].map(([key,name])=>({key,name}));
export const SCORE_KEYS=[['quality','الجودة'],['commitment','الالتزام بالمواعيد'],['total_cost','التكلفة الكلية'],['invoice_accuracy','دقة الفواتير'],['responsiveness','سرعة الاستجابة'],['remediation','معالجة الملاحظات'],['usage_rights','حقوق الاستخدام']].map(([key,name])=>({key,name}));
const REVIEW_KINDS={duplicate:'فحص التكرار',technical:'التقييم الفني',procurement:'مراجعة المشتريات',finance:'التحقق المالي',legal:'المراجعة القانونية والمخاطر'};
const creative=new Set(['photo_video','motion_design','writing_translation','influencers']);
const entityKeys=new Set(ENTITY_TYPES.map(c=>c.key));

/* ───── الخيارات المُدارة (الترحيل 134): تصنيفات الموردين وأنواع وثائقهم ───── */
// تصنيف المورد مخزَّن نصًّا داخل JSON على كل ملف مورد، فحذف تصنيف يُفقد ملفاتِ سنواتٍ أسماءَ تصنيفاتها.
// ولهذا بالذات يجب أن توجد قاعدة «المستعمَل يُعطَّل ولا يُحذف» **قبل** أن يفتح أحد هذه القائمة للتحرير.
registerOptionList({key:'vendors.category',label:'تصنيف المورد',label_en:'Vendor category',module:'vendors',
  owner:'مسؤول الموردين — من يحمل تصريح تسجيل الموردين',owner_role:'pm',manage_capability:'vendors.manage',
  governance:'managed',columns:['vendors.categories'],defaults:CATEGORIES.map(c=>({value:c.key,label:c.name})),
  note:'التصنيف محفوظ نصًّا في ملف كل مورد. تعطيله يمنع اختياره في ملف جديد ويُبقي الملفات القديمة تقرأ اسمه.'});
// نوع الوثيقة: العمود vendor_documents.kind بلا CHECK أصلًا، فالكود كان القفل الوحيد. والقائمة تفتح بوابة
// الترسية (requireVendorGate)، فاتساعها يراه شخصان: second_person. وتُشحن ثلاثة أنواع **معطَّلة** — الزكاة
// والتأمينات والسعودة — فاليوم الأول لا يتغيّر بشيء، ويفعّلها المالك حين يقرر طلبها.
registerOptionList({key:'vendors.document_kind',label:'نوع وثيقة المورد',label_en:'Vendor document kind',module:'vendors',
  owner:'مسؤول الموردين — من يحمل تصريح تسجيل الموردين',owner_role:'pm',manage_capability:'vendors.manage',
  governance:'managed',second_person:true,columns:['vendor_documents.kind'],
  // حارس التعطيل: نوعٌ ما زالت مصفوفة المتطلبات تفرضه لا يُعطَّل. شُغّل السيناريو قبل الحارس: بتعطيل «سجل
  // تجاري» صار `add_document` يُرفض `option_not_offered` و`submit` يُرفض `documents_required` طالبًا وثيقةً
  // صار تسجيلها مستحيلًا — الملف لا يتقدّم ولا يُستكمل، والنوع لا يظهر في الشاشة أصلًا.
  guard_disable:(db,tenantId,value)=>{
    const rules=DOCUMENT_RULES.filter(r=>r.kind===value);
    if(!rules.length)return null;
    return {what:'مصفوفة متطلبات الوثائق ما زالت تفرضه، فتعطيله يحبس كل ملف يقع عليه شرطها',
      document:'تعديل مصفوفة المتطلبات (requiredDocuments) أولًا',
      why:`يفرضه اليوم: ${rules.map(r=>r.demands).join('؛ ')}`,
      next:'المصفوفة في الكود ولم تتحوّل إلى قائمة مُدارة بعد — راجع قسم «سُلّم إلى فريق آخر» في STATUS.md'};
  },
  defaults:[...DOCUMENT_KINDS.map(k=>({value:k.key,label:k.name})),
    {value:'zakat_certificate',label:'شهادة الزكاة والدخل',state:'disabled'},
    {value:'gosi_certificate',label:'شهادة التأمينات الاجتماعية',state:'disabled'},
    {value:'saudization_certificate',label:'شهادة نطاقات (السعودة)',state:'disabled'}],
  note:'تفعيل نوع يجعله قابلًا للتسجيل والتحقق على ملف المورد. جعلُه **مطلوبًا** لبوابة الترسية قرارُ مصفوفة المتطلبات، وهي لم تُحوَّل بعد.'});
// صيغة الرقم الضريبي: قيمة **واحدة** يقرؤها تسجيل المورد وتسجيل ضريبة الفاتورة معًا. قبل هذا كان الملف يقبل
// خمسة عشر رقمًا أيًّا كانت، وترفضها payables بصيغتها الأدقّ — فرقمٌ يمرّ عند التسجيل يسقط عند الفاتورة.
// الصيغة مثبّتة بأداة الهيئة لا بتفضيل داخلي، فهي للقراءة ومعها مصدرها، وواصفها هنا لأن هذه الوحدة تُحمَّل أولًا.
registerAdoption({key:'finance.vat_number_format',label:'صيغة الرقم الضريبي السعودي',module:'finance',
  owner:'المختص الضريبي — المالية',owner_role:'finance',governance:'legally_fixed',
  // «المصدر» كان إعادة صياغة للقاعدة نفسها («خمسة عشر رقمًا…»)، فالرفض كان يحيل القارئ إلى القاعدة لا إلى
  // مصدرها. الصيغة صحيحة، ونصّها النظامي غير محفوظ في المستودع، فيُقرّ بذلك ويُسمّى من يملك تسجيله.
  article:{ref:'صيغة الرقم الضريبي لدى هيئة الزكاة والضريبة والجمارك',source:'أداة الهيئة، لا قرار داخلي للشركة',
    pending:{why:'نصّ الهيئة الذي يقرّر الصيغة غير محفوظ في المستودع، فلا مادة تُنقل منه',owner:'المختص الضريبي — المالية',
      next:'احفظ نصّ الأداة التي تقرّر صيغة الرقم، ثم اكتب مادتها في article.ref'}},
  default:{pattern:'^3\\d{13}3$',digits:15,message:'الرقم الضريبي السعودي خمسة عشر رقمًا تبدأ وتنتهي بالرقم 3'},
  basis:'صيغة الهيئة، وهي الصيغة التي كانت payables تفرضها وحدها قبل توحيد القراءة'});
export const vatNumberRule=(db,tenantId)=>adopted(db,tenantId,'finance.vat_number_format').value;

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const plusDays=(date,days)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
const id=()=>randomUUID();

/* ───── تغيير الحساب البنكي: مهلة تهدئة وخطوة إطلاق (الترحيل 166) ───── */
// عدد أيام التهدئة قرار المالك لا قرار المنصة: القيمة مسجّلة بلا رقم ({days:null})، وما دامت كذلك يبقى كل حساب
// متغيّر موقوفًا عن الدفع برفض يسمّي القرار ومالكه. والشكل كائنٌ لأن واصف القيمة لا يقبل null رقمًا (app/options.mjs).
export const COOLING_OFF='vendors.bank_change_cooling_off_days';
registerAdoption({key:COOLING_OFF,label:'أيام التهدئة بعد تغيير حساب المورد البنكي',module:'vendors',
  owner:'المالية — من يحمل تصريح التحقق المالي من بيانات دفع الموردين',owner_role:'finance',manage_capability:'vendors.bank',
  governance:'managed',shape:'object',default:{days:null},
  basis:'ما قرّرها أحد بعد، والمنصة ما تخترع رقمًا: حتى يقرّرها المالك ويعتمدها شخص ثانٍ يبقى كل حساب متغيّر موقوفًا عن الدفع. القيمة {"days": عدد صحيح من 0 إلى 365} تُحسب من يوم التحقق'});
// إشعار المالية يفتح شاشة المدفوعات: من يُبلَّغ هم من يعدّون الدفع ويعتمدونه ويوثّقونه، لا بالضرورة من يرى مركز الموردين.
Object.assign(SUBJECT_LINKS,{vendor_bank_change:'#payables'});
export function coolingOffDays(db,tenantId,date=today()){
  const decision=adopted(db,tenantId,COOLING_OFF,date),days=decision.value?.days;
  return {days:Number.isInteger(days)&&days>=0&&days<=365?days:null,decision};
}
// حالة الحساب المتغيّر: unadopted (المهلة بلا قرار) · cooling_off (قبل انقضائها) · first_payment (انقضت، وأول دفعة
// تنتظر إطلاق شخص ثالث) · settled (نُفّذ إليه تحويل لم يرجع) · replaced (حلّ محله حساب أحدث). والنافذة المفتوحة
// تُقرأ من الرؤية vendor_bank_change_windows نفسها التي تقرؤها القوادح، فلا تختلف الشاشة والقاعدة على «مفتوح».
export function bankChangeState(db,tenantId,bankAccountId,date=today()){
  const change=typeof bankAccountId==='string'?db.prepare('SELECT c.*,b.effective_from,b.status AS bank_status FROM vendor_bank_changes c JOIN vendor_bank_accounts b ON b.id=c.bank_account_id WHERE c.bank_account_id=? AND c.tenant_id=?').get(bankAccountId,tenantId):null;
  if(!change)return null;
  const open=!!db.prepare('SELECT 1 FROM vendor_bank_change_windows WHERE id=?').get(change.id);
  const {days,decision}=coolingOffDays(db,tenantId,date);
  const payableFrom=days===null?null:[change.effective_from,plusDays(change.verified_on,days)].sort().at(-1);
  const state=change.bank_status==='superseded'?'replaced':!open?'settled':days===null?'unadopted':date<payableFrom?'cooling_off':'first_payment';
  return {id:change.id,vendor_id:change.vendor_id,bank_account_id:change.bank_account_id,replaces_id:change.replaces_id,
    collected_by:change.collected_by,verified_by:change.verified_by,verified_on:change.verified_on,open,state,days,payable_from:payableFrom,
    decision:{key:COOLING_OFF,label:decision.label,owner:decision.owner,owner_role:decision.owner_role,source:decision.source}};
}
// الحساب الساري اليوم لمورد: المتحقق منه الذي حلّ تاريخ سريانه (واحد بعد الترحيل 166)، ومعه حالة تغييره إن كان تغييرًا.
export function currentBankAccount(db,tenantId,vendorId,date=today()){
  const rows=db.prepare("SELECT b.* FROM vendor_bank_accounts b JOIN vendors x ON x.id=b.vendor_id WHERE b.vendor_id=? AND x.tenant_id=? AND b.status='verified' ORDER BY b.effective_from DESC,b.verified_at DESC,b.rowid DESC").all(vendorId,tenantId);
  const bank=rows.find(b=>b.effective_from<=date)??null,upcoming=bank?null:rows.at(-1)?.effective_from??null;
  return {bank,upcoming,change:bank?bankChangeState(db,tenantId,bank.id,date):null};
}
// نافذة التغيير المفتوحة لمورد (واحدة على الأكثر: حساب ساري واحد)، بمن جمع بياناتها ومن تحقق منها.
export const openBankChange=(db,tenantId,vendorId)=>db.prepare('SELECT * FROM vendor_bank_change_windows WHERE vendor_id=? AND tenant_id=?').get(vendorId,tenantId)??null;
// من يُبلَّغ من المالية: كل من يحمل اليوم تفويض إعداد أو اعتماد أو توثيق بالدور الذي مُنح به، وحسابه نشط.
export function financeRecipients(db,tenantId){
  const time=now();
  const rows=db.prepare("SELECT DISTINCT user_id,granted_role FROM finance_grants WHERE tenant_id=? AND revoked_at IS NULL AND valid_from<=? AND valid_until>? AND action IN ('prepare','approve','post') ORDER BY user_id").all(tenantId,time,time);
  return [...new Set(rows.filter(r=>currentUser(db,{id:r.user_id,tenant_id:tenantId})?.role===r.granted_role).map(r=>r.user_id))];
}
// الموردون النشطون الآخرون الذين يحملون الآيبان نفسه (بالبصمة، داخل الكيان)، ومعهم القرار المسبَّب إن سُجّل.
function sharedIbanVendors(db,tenantId,bank){
  return db.prepare(`SELECT x.id AS vendor_id,x.code,MAX(d.decided_by) AS decided_by,MAX(d.reason) AS reason,MAX(d.created_at) AS decided_at
    FROM vendor_bank_accounts b JOIN vendors x ON x.id=b.vendor_id LEFT JOIN vendor_bank_shared_decisions d ON d.bank_account_id=? AND d.other_vendor_id=x.id
    WHERE x.tenant_id=? AND b.iban_digest=? AND b.vendor_id<>? AND b.status IN ('pending','verified') AND x.status NOT IN ('merged','rejected')
    GROUP BY x.id,x.code ORDER BY x.code`).all(bank.id,tenantId,bank.iban_digest,bank.vendor_id);
}

export function weightsFor(category){
  return creative.has(category)
    ?{quality:30,commitment:20,total_cost:10,invoice_accuracy:5,responsiveness:10,remediation:10,usage_rights:15}
    :{quality:25,commitment:20,total_cost:15,invoice_accuracy:10,responsiveness:10,remediation:10,usage_rights:10};
}
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة سجل الموردين معاملة قاعدة بيانات');}
function permissions(db,u){
  const list=[];
  for(const key of ['vendors.view','vendors.assess','vendors.manage','vendors.legal'])if(can(db,u,key))list.push(key);
  if(holds(db,u,'vendors.bank'))list.push('vendors.bank');
  return list;
}
function requireAny(db,u){const list=permissions(db,u);if(!list.length)fail(403,'not_permitted','لا يوجد تصريح لمركز الموردين. اطلبه من مسؤول الصلاحيات');return list;}
function need(list,key,message){if(!list.includes(key))fail(403,'not_permitted',message);}

// تطبيع الاسم للمقارنة فقط؛ التشابه إشارة مراجعة وليس دليل تكرار.
const stopWords=new Set(['شركه','مؤسسه','مجموعه','company','co','ltd','llc','est','inc','group','limited']);
export function normalizeName(value){
  return String(value).normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).map(t=>t.startsWith('ال')&&t.length>4?t.slice(2):t).filter(t=>t&&!stopWords.has(t));
}
export function nameSimilarity(a,b){
  const x=new Set(normalizeName(a)),y=new Set(normalizeName(b));
  if(!x.size||!y.size)return 0;
  const shared=[...x].filter(t=>y.has(t)).length;
  return shared/(x.size+y.size-shared);
}
function cleanIban(value){
  const iban=v.text(value,'رقم الآيبان',40,15).replace(/\s+/g,'').toUpperCase();
  if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)||(iban.startsWith('SA')&&iban.length!==24))fail(400,'invalid_iban','صيغة الآيبان غير صحيحة');
  const rearranged=(iban.slice(4)+iban.slice(0,4)).replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));
  let remainder=0;for(const digit of rearranged)remainder=(remainder*10+Number(digit))%97;
  if(remainder!==1)fail(400,'invalid_iban','رقم الآيبان لا يجتاز فحص الصيغة');
  return iban;
}
const maskIban=iban=>`${iban.slice(0,2)}•••• ${iban.slice(-4)}`;
const ibanDigest=(tenantId,iban)=>hash(`${tenantId}:iban:${iban}`);

const vendorFields=['legal_name','legal_name_en','trade_name','entity_type','country','entity_ref','vat_number','categories','regions','capacity_note','payment_terms','data_source','legal_review_required'];
// previous = الملف المخزَّن حين يكون هذا تحريرًا. قاعدة التحرير في بقية المنصة: يُفحص ما **تغيّر**.
// بدونها يتجمّد ملفٌ قائم تمامًا حين يُشدَّد فحصٌ أو يُعطَّل خيارٌ يحمله: لا اسمه يُعدَّل ولا شروط دفعه،
// حتى يُغيَّر حقلٌ لم يطلب أحد تغييره. والتشديد يبقى كاملًا على الإدخال الجديد وعلى الحقل حين يُغيَّر.
function cleanVendor(db,tenantId,input,previous=null){
  const was=previous?{vat:previous.vat_number??'',categories:JSON.parse(previous.categories)}:null;
  const entity=input.entity_type;if(!entityKeys.has(entity))fail(400,'entity_type','اختر نوع الكيان');
  const country=v.text(input.country??'SA','بلد الكيان',2,2).toUpperCase();
  if(!/^[A-Z]{2}$/.test(country))fail(400,'country','رمز البلد حرفان لاتينيان');
  if(entity==='foreign'&&country==='SA')fail(400,'country','الكيان الخارجي يحتاج بلدًا غير السعودية');
  if(['company','establishment'].includes(entity)&&country!=='SA')fail(400,'entity_type','الكيان المسجل خارج السعودية يُسجل بنوع «كيان خارج السعودية»');
  const optional=(value,label,max)=>value===undefined||value===null||value===''?'':v.text(value,label,max);
  let ref=optional(input.entity_ref,'معرّف المنشأة',30);
  if(ref&&!/^[A-Za-z0-9/-]{4,30}$/.test(ref))fail(400,'entity_ref','معرّف المنشأة أرقام وحروف لاتينية فقط');
  if(['company','establishment'].includes(entity)){
    if(!/^\d{10}$/.test(ref))fail(400,'entity_ref','رقم السجل التجاري السعودي عشرة أرقام');
  }else if(entity==='foreign'){
    if(!ref)fail(400,'entity_ref','أدخل رقم تسجيل الكيان في بلده');
  }else if(/^[12]\d{9}$/.test(ref))fail(400,'entity_ref','لا يُسجل رقم الهوية أو الإقامة. استخدم رقم وثيقة العمل الحر أو اترك الحقل فارغًا');
  let vat=optional(input.vat_number,'الرقم الضريبي',20);
  // القاعدة نفسها التي تفرضها payables عند تسجيل ضريبة الفاتورة: مصدر واحد لا صيغتان تتناقضان.
  // والصيغة صارت أدقّ على هذا الفرع (`^3\d{13}3$` بدل `^\d{15}$`)، فرقمٌ قبِله التسجيل قبل التشديد يبقى
  // مخزَّنًا ومقروءًا — ويُفحص عند تغييره لا عند كل حفظ. هذا هو الفرق بين تشديدٍ يسري على الجديد وتشديدٍ يحبس القديم.
  const rule=vatNumberRule(db,tenantId);
  if(vat&&vat!==was?.vat){
    if(country==='SA'&&!new RegExp(rule.pattern).test(vat))fail(400,'vat_number',rule.message);
    if(!/^[A-Za-z0-9-]{5,20}$/.test(vat))fail(400,'vat_number','الرقم الضريبي غير صالح');
  }
  const categories=Array.isArray(input.categories)?[...new Set(input.categories)]:[];
  if(!categories.length||categories.length>6)fail(400,'categories','اختر تصنيفًا واحدًا إلى ستة من القائمة');
  // كل تصنيف **جديد** يمرّ على القائمة المُدارة: الخارج عنها — أو المعطَّل — يُرفض برفض يسمّي الحقل ومالكه.
  // وتصنيفٌ يحمله الملف أصلًا لا يُعاد فحصه: تعطيله يمنع اختياره في ملف جديد ويُبقي القديم يُقرأ **ويُحرَّر**،
  // وهو ما يقوله تعليق الواصف نفسه. قبل هذا كان تعطيل تصنيف يجمّد كل ملف يحمله.
  for(const key of categories)if(!was?.categories.includes(key))requireOption(db,tenantId,'vendors.category',key,{field:'تصنيف المورد'});
  return {
    legal_name:v.text(input.legal_name,'الاسم القانوني',180,3),legal_name_en:optional(input.legal_name_en,'الاسم بالإنجليزية',180),trade_name:optional(input.trade_name,'الاسم التجاري',180),
    entity_type:entity,country,entity_ref:ref||null,vat_number:vat||null,categories:JSON.stringify(categories),
    regions:optional(input.regions,'مناطق التغطية',500),capacity_note:optional(input.capacity_note,'الطاقة والمواعيد المتوقعة',1000),payment_terms:optional(input.payment_terms,'شروط الدفع',1000),
    data_source:v.text(input.data_source,'مصدر البيانات',500,3),legal_review_required:input.legal_review_required===true?1:0
  };
}

// المتطلبات شرطية: لا يُطلب من الفرد أو الكيان الأجنبي ما لا ينطبق على نوعه.
// المصفوفة **معلَنة** لا مبنيّة بسطور متفرقة، لأن حارس التعطيل يقرؤها: نوعٌ تفرضه هذه المصفوفة لا يجوز
// تعطيله من قائمة الخيارات، وإلا حُبس ملفٌ جارٍ حبسًا تامًّا — لا الوثيقة تُسجَّل ولا الملف يُقدَّم.
// وهي نفسها ما سيتحوّل إلى قائمة مُدارة في موجة لاحقة (انظر «سُلّم إلى فريق آخر» في STATUS.md).
export const DOCUMENT_RULES=Object.freeze([
  {kind:'commercial_registration',level:'required',why:'كيان تجاري مسجل في السعودية',demands:'المورد من نوع «شركة» أو «مؤسسة فردية»',when:v=>['company','establishment'].includes(v.entity_type)},
  {kind:'foreign_registration',level:'required',why:'كيان مسجل خارج السعودية',demands:'المورد من نوع «كيان خارج السعودية»',when:v=>v.entity_type==='foreign'},
  {kind:'freelance_license',level:'when_applicable',why:'فرد يقدم خدمة مهنية؛ تُطلب عند انطباقها',demands:'المورد من نوع «فرد أو مستقل»',when:v=>v.entity_type==='individual'},
  {kind:'vat_certificate',level:'required',why:'المورد مسجل ضريبيًا',demands:'للمورد رقم ضريبي مسجَّل',when:v=>!!v.vat_number},
  {kind:'bank_proof',level:'required',why:'سُجل حساب بنكي للدفع',demands:'للمورد حساب بنكي مسجَّل',when:(v,hasBank)=>hasBank},
  {kind:'media_license',level:'when_applicable',why:'محتوى إعلاني عبر حسابات التواصل؛ يُتحقق من الترخيص عند انطباقه',demands:'تصنيف «مؤثرون وصناع محتوى»',when:v=>JSON.parse(v.categories).includes('influencers')},
  {kind:'insurance',level:'when_applicable',why:'أعمال ميدانية أو معدات؛ بحسب نوع الخدمة',demands:'تصنيف فعاليات أو تصوير أو تأجير معدات',when:v=>JSON.parse(v.categories).some(c=>['events','photo_video','equipment_rental'].includes(c))},
  {kind:'nda',level:'when_applicable',why:'تعامل يستلزم مراجعة قانونية',demands:'الملف موسوم بأنه يحتاج مراجعة قانونية',when:v=>!!v.legal_review_required}
]);
export function requiredDocuments(vendor,hasBank){
  return DOCUMENT_RULES.filter(r=>r.when(vendor,hasBank)).map(({kind,level,why})=>({kind,level,why}));
}
function currentDocuments(db,vendorId){return db.prepare('SELECT d.*,x.name AS added_by_name FROM vendor_documents d JOIN users x ON x.id=d.added_by WHERE d.vendor_id=? AND d.superseded_by IS NULL ORDER BY d.created_at').all(vendorId);}
function requirementState(requirements,documents,date){
  return requirements.map(r=>{
    const docs=documents.filter(d=>d.kind===r.kind);
    let state='missing';
    if(docs.some(d=>d.verification==='verified'&&(!d.expires_on||d.expires_on>=date)))state='ok';
    else if(r.level==='when_applicable'&&docs.some(d=>d.verification==='not_applicable'))state='not_applicable';
    else if(docs.some(d=>d.verification==='verified'))state='expired';
    else if(docs.some(d=>d.verification==='pending'))state='pending';
    else if(docs.length)state='rejected';
    return {...r,state};
  });
}
function bankRows(db,vendorId){return db.prepare('SELECT b.*,c.name AS collected_by_name,x.name AS verified_by_name FROM vendor_bank_accounts b JOIN users c ON c.id=b.collected_by LEFT JOIN users x ON x.id=b.verified_by WHERE b.vendor_id=? ORDER BY b.collected_at DESC').all(vendorId);}
function activeBank(rows,date){return rows.filter(b=>b.status==='verified'&&b.effective_from<=date).sort((a,b)=>b.effective_from.localeCompare(a.effective_from)||b.verified_at.localeCompare(a.verified_at))[0]??null;}
function cycleOf(db,vendorId){return db.prepare("SELECT COUNT(*) AS n FROM vendor_decisions WHERE vendor_id=? AND to_status='in_review'").get(vendorId).n;}

export function duplicateSignals(db,vendor){
  const others=db.prepare("SELECT id,code,legal_name,trade_name,entity_ref,vat_number,status FROM vendors WHERE tenant_id=? AND id<>? AND status<>'merged'").all(vendor.tenant_id,vendor.id??'');
  const digests=vendor.id?db.prepare("SELECT iban_digest FROM vendor_bank_accounts WHERE vendor_id=? AND status<>'rejected'").all(vendor.id).map(r=>r.iban_digest):[];
  const signals=[];
  for(const other of others){
    const add=(signal,strength)=>signals.push({vendor_id:other.id,code:other.code,legal_name:other.legal_name,status:other.status,signal,strength});
    if(vendor.entity_ref&&other.entity_ref===vendor.entity_ref)add('entity_ref','strong');
    if(vendor.vat_number&&other.vat_number===vendor.vat_number)add('vat_number','strong');
    if(digests.length&&db.prepare(`SELECT 1 FROM vendor_bank_accounts WHERE vendor_id=? AND status<>'rejected' AND iban_digest IN (${digests.map(()=>'?').join(',')})`).get(other.id,...digests))add('bank_account','review');
    const similarity=Math.max(nameSimilarity(vendor.legal_name,other.legal_name),vendor.trade_name&&other.trade_name?nameSimilarity(vendor.trade_name,other.trade_name):0);
    if(similarity>=0.6)add('name','weak');
  }
  return signals;
}

function allowedActions(db,u,list,vendor,detail){
  const actions=[],manage=list.includes('vendors.manage'),other=vendor.registered_by!==u.id;
  if(manage){
    if(['draft','requalification'].includes(vendor.status))actions.push('edit','submit');
    if(vendor.status!=='merged')actions.push('add_contact','add_document');
    if(detail.contacts.some(c=>!c.trusted_at&&c.created_by!==u.id))actions.push('trust_contact');
    if(vendor.status==='in_review'&&other)actions.push('review_duplicate','review_procurement','approve','reject');
    if(['approved','conditional'].includes(vendor.status))actions.push('suspend');
    if(['approved','conditional','suspended','rejected'].includes(vendor.status))actions.push('requalify');
    if(!['merged'].includes(vendor.status)&&!detail.bank.some(b=>b.status==='pending'))actions.push('propose_bank');
    if(!['merged','draft'].includes(vendor.status))actions.push('grant_exception');
    if(vendor.status!=='merged'&&other)actions.push('merge');
  }
  if(detail.documents.some(d=>d.verification==='pending'&&d.added_by!==u.id&&(d.kind==='bank_proof'?list.includes('vendors.bank'):manage)))actions.push('verify_document');
  if(vendor.status==='in_review'){
    if(list.includes('vendors.assess')&&other)actions.push('review_technical');
    if(list.includes('vendors.bank'))actions.push('review_finance');
    if(list.includes('vendors.legal')&&vendor.legal_review_required)actions.push('review_legal');
  }
  if(list.includes('vendors.bank')&&detail.bank.some(b=>b.status==='pending'&&b.collected_by_id!==u.id))actions.push('verify_bank');
  // الآيبان على مورد نشط آخر: القرار المسبَّب بيد مالي غير جامع البيانات، ويبقى الزر ما بقي مورد بلا قرار.
  if(list.includes('vendors.bank')&&detail.bank.some(b=>b.status==='pending'&&b.collected_by_id!==u.id&&b.shared_with.some(x=>!x.decided)))actions.push('allow_shared_iban');
  if((list.includes('vendors.assess')||manage)&&['approved','conditional','suspended'].includes(vendor.status))actions.push('evaluate');
  return [...new Set(actions)];
}

function spend(db,vendor){
  const orders=db.prepare("SELECT COUNT(*) AS orders,COALESCE(SUM(o.total_minor),0) AS committed_minor FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id WHERE p.tenant_id=? AND o.supplier_key=? AND p.status<>'cancelled'").get(vendor.tenant_id,vendor.supplier_key);
  // «مطابَق غير مدفوع» من الرصيد نفسه الذي تقرؤه المدفوعات (payable_balances، الترحيل 166). كان يصفّي بـ
  // payment_status='not_paid'، وقيد الترحيل 005 يجبر العمود على هذه القيمة أبدًا، فكان المدفوع يُعدّ مفتوحًا.
  const payables=db.prepare("SELECT COUNT(*) AS open_payables,COALESCE(SUM(b.outstanding_minor),0) AS payable_minor FROM payable_balances b JOIN procurement_payables y ON y.id=b.payable_id JOIN procurement_orders o ON o.purchase_id=y.purchase_id JOIN procurement_purchases p ON p.id=o.purchase_id WHERE p.tenant_id=? AND o.supplier_key=? AND b.outstanding_minor>0").get(vendor.tenant_id,vendor.supplier_key);
  return {...orders,...payables,currency:'SAR'};
}
// كشف آيبان المورد كاملًا فكُّ تشفيرٍ لقيمة مقيدة، فيُسجَّل كما يُسجَّل تنزيل ملف مقيد (app/files.mjs) وتنزيل ملف
// تحويل الرواتب (app/payroll-extras.mjs): السجل يقول من طلبه (actor_id)، ومتى (created_at)، وفي أي مورد (entity_id).
// والحساب المحجوب لا يُسجَّل: الحجب هو امتناع المنصة عن الكشف، لا كشفٌ. وحدثٌ واحد لكل ملف مورد يُكشف فيه، لا حدث
// لكل حساب، لأن السؤال المحاسَب عليه «من فتح حسابات هذا المورد» لا «كم صفًّا قرأ».
function revealBank(db,u,vendor,rows){
  if(rows.length)audit(db,u,'vendor',vendor.id,'vendor.bank_iban_revealed',{}, {code:vendor.code,accounts:rows.length,bank_account_ids:rows.map(b=>b.id)});
}
// disclose:false ⟵ عرضٌ داخلي لا يصل مستخدمًا: بوابة vendorAction تبني التفاصيل لتقرأ الحالات والصلاحيات وحدها
// (status وcollected_by_id والعدد — لا آيبان)، ثم تعيد بناءها بـgetVendor لتردّها. بلا هذا الفصل يُسجَّل الكشف مرتين
// على الفعل الواحد، ويُفكّ تشفير قيمة لا تخرج من الدالة أصلًا.
function detailOf(db,u,list,vendor,{disclose=true}={}){
  const date=today(),bankAll=bankRows(db,vendor.id),seeBank=disclose&&list.includes('vendors.bank');
  if(seeBank)revealBank(db,u,vendor,bankAll);
  const documents=currentDocuments(db,vendor.id),requirements=requirementState(requiredDocuments(vendor,bankAll.some(b=>b.status!=='rejected')),documents,date);
  const active=activeBank(bankAll,date),cycle=cycleOf(db,vendor.id);
  // تغيير الحساب (الترحيل 166): حالته ومهلته، والرسالة المحاكاة لجهة الاتصال الموثقة سابقًا.
  const changes=new Map(db.prepare('SELECT bank_account_id FROM vendor_bank_changes WHERE vendor_id=?').all(vendor.id).map(r=>[r.bank_account_id,bankChangeState(db,vendor.tenant_id,r.bank_account_id,date)]));
  const outbox=db.prepare('SELECT o.subject_id,o.channel,o.status,o.created_at,c.name AS contact_name FROM vendor_outbox o LEFT JOIN vendor_contacts c ON c.id=o.contact_id WHERE o.vendor_id=? ORDER BY o.created_at,o.rowid').all(vendor.id);
  const changeView=state=>state&&{state:state.state,open:state.open,days:state.days,payable_from:state.payable_from,verified_on:state.verified_on,replaces_id:state.replaces_id,
    notices:outbox.filter(n=>n.subject_id===state.id).map(n=>({contact_name:n.contact_name,channel:n.channel,status:n.status,simulated:true,created_at:n.created_at}))};
  const shared=b=>b.status==='pending'?sharedIbanVendors(db,vendor.tenant_id,b).map(x=>({vendor_id:x.vendor_id,code:x.code,decided:!!x.decided_by,reason:x.reason,decided_at:x.decided_at})):[];
  const activeChange=active?changes.get(active.id):null;
  const detail={
    ...vendor,categories:JSON.parse(vendor.categories),legal_review_required:!!vendor.legal_review_required,cycle,
    contacts:db.prepare('SELECT id,name,role,email,phone,trusted_at,trusted_basis,active,created_by FROM vendor_contacts WHERE vendor_id=? ORDER BY created_at').all(vendor.id),
    documents:documents.map(d=>({...d,expired:!!d.expires_on&&d.expires_on<date,expiring:!!d.expires_on&&d.expires_on>=date&&d.expires_on<=plusDays(date,60)})),
    requirements,
    reviews:db.prepare('SELECT r.*,x.name AS reviewer_name FROM vendor_reviews r JOIN users x ON x.id=r.reviewer_id WHERE r.vendor_id=? ORDER BY r.created_at DESC').all(vendor.id).map(r=>({...r,kind_name:REVIEW_KINDS[r.kind],current:r.cycle===cycle})),
    decisions:db.prepare('SELECT d.*,x.name AS decided_by_name FROM vendor_decisions d JOIN users x ON x.id=d.decided_by WHERE d.vendor_id=? ORDER BY d.created_at DESC').all(vendor.id),
    evaluations:db.prepare('SELECT e.*,x.name AS evaluator_name FROM vendor_evaluations e JOIN users x ON x.id=e.evaluator_id WHERE e.vendor_id=? ORDER BY e.created_at DESC').all(vendor.id).map(e=>({...e,scores:JSON.parse(e.scores),weights:JSON.parse(e.weights)})),
    exceptions:db.prepare('SELECT e.*,x.name AS granted_by_name FROM vendor_exceptions e JOIN users x ON x.id=e.granted_by WHERE e.vendor_id=? ORDER BY e.created_at DESC').all(vendor.id),
    // تفاصيل الحساب لمن يحمل تصريح التحقق المالي فقط؛ غيره يرى الحالة وآخر أربع خانات.
    bank:bankAll.map(b=>{const with_=shared(b);return {id:b.id,bank_name:b.bank_name,account_holder:seeBank?b.account_holder:'',iban:seeBank?unseal(b.iban):maskIban(unseal(b.iban)),masked:!seeBank,reason:b.reason,status:b.status,collected_by_id:b.collected_by,collected_by:b.collected_by_name,collected_at:b.collected_at,verification_method:b.verification_method,verification_evidence:seeBank?b.verification_evidence:'',verified_by:b.verified_by_name,verified_at:b.verified_at,effective_from:b.effective_from,active:active?.id===b.id,
      change:changeView(changes.get(b.id)??null),shared_with:with_,shared_decisions:with_.filter(x=>x.decided)};}),
    // جاهز للدفع: حساب ساري، وإن كان تغييرًا فقد انقضت مهلته (أول دفعة بعدها تنتظر إطلاقًا، وتقوله شاشة المدفوعات).
    payment_ready:!!active&&(!activeChange||['first_payment','settled'].includes(activeChange.state)),
    duplicates:duplicateSignals(db,vendor),
    spend:spend(db,vendor),
    gate:gateFor(db,vendor,requirements,date)
  };
  detail.evaluations=detail.evaluations.map(e=>({...e,superseded:detail.evaluations.some(x=>x.corrects_id===e.id)}));
  detail.actions=allowedActions(db,u,list,vendor,detail);
  return detail;
}
function gateFor(db,vendor,requirements,date){
  const blockers=[];
  if(!['approved','conditional'].includes(vendor.status))blockers.push({code:'status',message:`حالة المورد: ${STATUS_NAMES[vendor.status]}`});
  if(vendor.status==='conditional'&&vendor.valid_until&&vendor.valid_until<date)blockers.push({code:'condition_expired',message:`انتهت مدة الاعتماد المشروط في ${vendor.valid_until}`});
  for(const r of requirements)if(r.level==='required'&&r.state==='expired')blockers.push({code:'document_expired',message:`وثيقة منتهية: ${optionLabel(db,vendor.tenant_id,'vendors.document_kind',r.kind)}`});
  return {allowed:!blockers.length,blockers};
}
export const STATUS_NAMES={draft:'مسودة تسجيل',in_review:'قيد التأهيل',approved:'معتمد',conditional:'معتمد بشروط',rejected:'مرفوض',suspended:'موقوف',requalification:'بحاجة لإعادة تأهيل',merged:'مدموج في ملف آخر'};
// حالة ملف المورد مقفلة بقيد CHECK في الترحيل 022. تُعرض بقيدها ورقم ترحيله: يرى المالك القائمة **ويرى لماذا
// لا تُحرَّر**. وثلاث حالات منها لا تقابل شيئًا في القاموس الواحد بصدق، فتبقى عبارتها هنا ولا تُلبَّس حالة أخرى.
registerOptionList({key:'vendors.vendor_status',label:'حالة ملف المورد',label_en:'Vendor file status',module:'vendors',
  owner:'مسؤول الموردين — من يحمل تصريح تسجيل الموردين',owner_role:'pm',governance:'db_locked',columns:['vendors.status'],
  db_locked:{check:"status IN ('draft','in_review','approved','conditional','rejected','suspended','requalification','merged')",migration:'022'},
  defaults:Object.entries(STATUS_NAMES).map(([value,label])=>({value,label,extra:{canonical:VENDOR_CANONICAL[value]??null}})),
  extra_shape:{canonical:'الحالة المقابلة من الحالات الثماني، وnull حيث لا تقابلها واحدة بصدق'},
  note:'انتقالات الحالة محروسة بفصل مهام مكتوب (من سجّل لا يراجع، ومن راجع لا يعتمد وحده).'});

function resolveVendor(db,tenantId,supplierKey){
  let vendor=db.prepare('SELECT * FROM vendors WHERE tenant_id=? AND supplier_key=?').get(tenantId,supplierKey);
  for(let hops=0;vendor?.merged_into&&hops<5;hops++)vendor=db.prepare('SELECT * FROM vendors WHERE id=? AND tenant_id=?').get(vendor.merged_into,tenantId);
  return vendor??null;
}
// مالك الناقص في كل رفض بوابة: من يسجّل المورد ومن يكمل تأهيله. نصّ واحد لا عبارة تُعاد كتابتها كل موضع.
const VENDOR_OWNER={owner:'مسؤول الموردين — من يحمل تصريح تسجيل الموردين',owner_role:'pm'};
const UNREGISTERED={code:'unregistered',message:'ما له ملف في دليل الموردين'};

// بوابة الترسية، وحالتاها ليستا واحدة:
//   • **كيان بلا ملف**: ممنوع، وما فيه استثناء له. vendor_exceptions تحيل إلى ملف مورد (الترحيل 022)، فما
//     فيه ملف يُعلَّق عليه الاستثناء — وهذا هو المقصود لا نقص فيه: بلا ملف ما فيه سجل تجاري ولا شهادة
//     ضريبية ولا فحص تكرار، ولا يقدر موظف يفصح عن تعارض معه أصلًا (discloseConflict يشترط ملفًا مسجَّلًا).
//     وكان يمر بـallowed:true حتى الترحيل 152، فيصير أمر شراء باسم نصّ يكتبه من يسجّل العرض.
//   • **مورد مسجَّل غير مؤهل**: ممنوع كذلك، لكن له ملف — فيمنحه موظف مشتريات آخر استثناءً **لعملية الشراء
//     هذه وحدها**، مكتوبًا بسببه ومحسوبًا على مانحه، بدل أن يُفتح الباب لكل الطلبات.
export function vendorGate(db,tenantId,supplierKey,purchaseId){
  const vendor=resolveVendor(db,tenantId,supplierKey);
  if(!vendor)return {state:'unregistered',vendor_id:null,code:null,allowed:false,exception_id:null,blockers:[UNREGISTERED]};
  const date=today(),requirements=requirementState(requiredDocuments(vendor,bankRows(db,vendor.id).some(b=>b.status!=='rejected')),currentDocuments(db,vendor.id),date);
  const gate=gateFor(db,vendor,requirements,date);
  if(gate.allowed)return {state:'qualified',vendor_id:vendor.id,code:vendor.code,allowed:true,blockers:[]};
  const exception=db.prepare('SELECT id FROM vendor_exceptions WHERE vendor_id=? AND purchase_id=?').get(vendor.id,purchaseId);
  return {state:exception?'exception':'blocked',vendor_id:vendor.id,code:vendor.code,allowed:!!exception,exception_id:exception?.id??null,blockers:gate.blockers};
}
export function requireVendorGate(db,tenantId,supplierKey,purchaseId){
  const gate=vendorGate(db,tenantId,supplierKey,purchaseId);
  if(gate.allowed)return gate;
  if(gate.state==='unregistered')refuse(409,'vendor_not_registered',{
    what:`ما تنرسّى على «${supplierKey}» — ما له ملف في دليل الموردين`,
    missing:[{document:`ملف مورد بالمعرّف ${supplierKey}`,
      why:'الترسية التزام بمال، وما تصير على كيان بلا سجل تجاري ولا شهادة ضريبية ولا فحص تكرار',...VENDOR_OWNER}],
    next:'سجّل الكيان في مركز الموردين وكمّل تأهيله ثم أعد الترسية. وما فيه استثناء لكيان بلا ملف: الاستثناء يُعلَّق على ملف مورد'});
  fail(409,'vendor_blocked',`المورد ${gate.code} غير مؤهل للترسية: ${gate.blockers.map(b=>b.message).join('؛ ')}. يلزم استثناء مفوض من المشتريات`);
}

// **وجود** الملف، لا تأهيله: يُفحص عند تسجيل العرض نفسه، فما ينطلب عرض من كيان مجهول أصلًا. والتأهيل
// (الحالة والوثائق السارية) يبقى شرط الترسية وحدها، لأن العروض الثلاثة تُجمع والملفات قد تكون تحت التأهيل.
export function requireRegisteredVendor(db,tenantId,supplierKey){
  const vendor=resolveVendor(db,tenantId,supplierKey);
  if(!vendor)refuse(409,'vendor_not_registered',{
    what:`ما ينحفظ عرض باسم «${supplierKey}» — ما له ملف في دليل الموردين`,
    missing:[{document:`ملف مورد بالمعرّف ${supplierKey}`,
      why:'بلا ملف ما فيه سجل تجاري ولا شهادة ضريبية ولا فحص تكرار، ولا يقدر أحد يفصح عن تعارض معه',...VENDOR_OWNER}],
    next:'سجّل الكيان في مركز الموردين أول، وبعدها أضف عرضه بالمعرّف نفسه'});
  return vendor;
}

function dashboard(db,u,vendors){
  const date=today(),limit=plusDays(date,60);
  const live=vendors.filter(x=>['approved','conditional'].includes(x.status));
  const expiring=db.prepare("SELECT d.id,d.kind,d.expires_on,x.id AS vendor_id,x.code,x.legal_name FROM vendor_documents d JOIN vendors x ON x.id=d.vendor_id WHERE x.tenant_id=? AND d.superseded_by IS NULL AND d.verification='verified' AND d.expires_on IS NOT NULL AND d.expires_on<=? AND x.status IN ('approved','conditional','suspended') ORDER BY d.expires_on").all(u.tenant_id,limit)
    .map(d=>({...d,kind_name:optionLabel(db,u.tenant_id,'vendors.document_kind',d.kind),expired:d.expires_on<date}));
  const coverage=optionsFor(db,u.tenant_id,'vendors.category').options.map(c=>({key:c.value,name:c.label,qualified:live.filter(x=>JSON.parse(x.categories).includes(c.value)).length})).filter(c=>c.qualified<2);
  const orders=db.prepare("SELECT o.supplier_key,o.supplier_name,SUM(o.total_minor) AS total_minor,COUNT(*) AS orders FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id WHERE p.tenant_id=? AND p.status<>'cancelled' GROUP BY o.supplier_key ORDER BY total_minor DESC").all(u.tenant_id);
  const totalMinor=orders.reduce((sum,o)=>sum+o.total_minor,0);
  const late=db.prepare("SELECT o.purchase_id,o.supplier_name,o.delivery_date,p.title FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id WHERE p.tenant_id=? AND p.status IN ('ordered','part_received') AND o.delivery_date<? ORDER BY o.delivery_date").all(u.tenant_id,date);
  return {
    as_of:date,
    awaiting:{draft:vendors.filter(x=>x.status==='draft').length,in_review:vendors.filter(x=>x.status==='in_review').length,requalification:vendors.filter(x=>x.status==='requalification').length},
    bank_pending:db.prepare("SELECT COUNT(*) AS n FROM vendor_bank_accounts b JOIN vendors x ON x.id=b.vendor_id WHERE x.tenant_id=? AND b.status='pending'").get(u.tenant_id).n,
    expiring_documents:expiring,
    thin_categories:coverage,
    // التركز يُحسب من أوامر الشراء الداخلية المعتمدة فقط، لا من مدفوعات فعلية.
    concentration:{basis:'internal_orders',total_minor:totalMinor,top:orders.slice(0,5).map(o=>({...o,share:totalMinor?Math.round(o.total_minor*1000/totalMinor)/10:0}))},
    late_orders:late,
    not_available:['المشتريات الطارئة','فروق المطابقة الثلاثية']
  };
}

export function listVendors(db,supplied){
  const u=actor(db,supplied),list=requireAny(db,u);
  const vendors=db.prepare('SELECT * FROM vendors WHERE tenant_id=? ORDER BY updated_at DESC').all(u.tenant_id);
  const date=today();
  return {
    today:date,user_id:u.id,permissions:list,
    categories:optionsFor(db,u.tenant_id,'vendors.category').options.map(o=>({key:o.value,name:o.label})),
    entity_types:ENTITY_TYPES,
    document_kinds:optionsFor(db,u.tenant_id,'vendors.document_kind').options.map(o=>({key:o.value,name:o.label})),
    // القائمتان كاملتين بالمعطَّل: الملف القديم يحمل تصنيفًا أو وثيقةً عُطِّل نوعها، فيُقرأ **باسمه** لا بمفتاحه،
    // ويُحقن في نموذج التحرير خيارًا موسومًا بدل أن يُسقَط — فلا يختار المتصفّح الخيار الأول بدلًا عن الإنسان.
    // والقائمتان أعلاه تبقيان «ما يُختار»، فلا يتسلّل معطَّل إلى نموذج جديد.
    categories_all:optionsFor(db,u.tenant_id,'vendors.category',{include_disabled:true}).options.map(o=>({key:o.value,name:o.label,state:o.state})),
    document_kinds_all:optionsFor(db,u.tenant_id,'vendors.document_kind',{include_disabled:true}).options.map(o=>({key:o.value,name:o.label,state:o.state,awaiting_second_person:o.awaiting_second_person})),
    score_keys:SCORE_KEYS,status_names:STATUS_NAMES,
    // القوائم المُدارة كما يراها المالك: خياراتها وحالتها ومن غيّرها ولماذا (app/options.mjs).
    managed_options:listsBoard(db,u.tenant_id,'vendors'),
    vendors:vendors.map(x=>detailOf(db,u,list,x)),
    dashboard:list.includes('vendors.manage')||list.includes('vendors.bank')?dashboard(db,u,vendors):null,
    purchases:list.includes('vendors.manage')?db.prepare("SELECT id,title FROM procurement_purchases WHERE tenant_id=? AND status IN ('sourcing','awarded') ORDER BY updated_at DESC LIMIT 50").all(u.tenant_id):[]
  };
}
export function getVendor(db,supplied,vendorId){
  const u=actor(db,supplied),list=requireAny(db,u);
  const vendor=typeof vendorId==='string'&&db.prepare('SELECT * FROM vendors WHERE id=? AND tenant_id=?').get(vendorId,u.tenant_id);
  if(!vendor)fail(404,'not_found','ملف المورد غير متاح');
  return detailOf(db,u,list,vendor);
}

export function createVendor(db,supplied,input){
  writing(db);
  const u=actor(db,supplied),list=requireAny(db,u);
  need(list,'vendors.manage','تسجيل الموردين متاح لموظفي المشتريات المخولين');
  v.object(input,[...vendorFields,'supplier_key','source_request_id']);
  const fields=cleanVendor(db,u.tenant_id,input),time=now(),vendorId=id();
  const sequence=db.prepare('SELECT COUNT(*) AS n FROM vendors WHERE tenant_id=?').get(u.tenant_id).n+1;
  const code='V-'+String(sequence).padStart(4,'0');
  const supplierKey=input.supplier_key?v.text(input.supplier_key,'معرف المورد في المشتريات',80,3).toUpperCase():code;
  if(!/^[A-Z0-9_-]{3,80}$/.test(supplierKey))fail(400,'supplier_key','معرف المورد حروف لاتينية وأرقام وشرطات فقط');
  if(db.prepare('SELECT 1 FROM vendors WHERE tenant_id=? AND supplier_key=?').get(u.tenant_id,supplierKey))fail(409,'duplicate_supplier_key','معرف المورد مستخدم في ملف آخر');
  let requestId=null;
  if(input.source_request_id){
    const request=db.prepare("SELECT r.id FROM requests r JOIN services s ON s.id=r.service_id WHERE r.id=? AND r.tenant_id=? AND s.code='PRC-VENDOR-REGISTRATION'").get(input.source_request_id,u.tenant_id);
    if(!request)fail(400,'source_request','الطلب المصدر ليس طلب تسجيل مورد ضمن الكيان');
    requestId=request.id;
  }
  db.prepare('INSERT INTO vendors(id,tenant_id,code,supplier_key,legal_name,legal_name_en,trade_name,entity_type,country,entity_ref,vat_number,categories,regions,capacity_note,payment_terms,data_source,legal_review_required,status,source_request_id,registered_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(vendorId,u.tenant_id,code,supplierKey,fields.legal_name,fields.legal_name_en,fields.trade_name,fields.entity_type,fields.country,fields.entity_ref,fields.vat_number,fields.categories,fields.regions,fields.capacity_note,fields.payment_terms,fields.data_source,fields.legal_review_required,'draft',requestId,u.id,time,time);
  audit(db,u,'vendor',vendorId,'vendor.registered',{}, {code,entity_type:fields.entity_type,categories:fields.categories});
  return {id:vendorId};
}

function decide(db,u,vendor,toStatus,reason,validUntil=null){
  db.prepare('INSERT INTO vendor_decisions VALUES(?,?,?,?,?,?,?,?)').run(id(),vendor.id,vendor.status,toStatus,reason,validUntil,u.id,now());
}
function latestReviews(db,vendorId,cycle){
  const latest={};
  for(const r of db.prepare('SELECT * FROM vendor_reviews WHERE vendor_id=? AND cycle=? ORDER BY created_at').all(vendorId,cycle))latest[r.kind]=r;
  return latest;
}
const actionFields={
  edit:vendorFields,submit:[],
  add_contact:['name','role','email','phone'],trust_contact:['contact_id','basis'],
  add_document:['kind','reference','issued_on','expires_on','replaces_id'],verify_document:['document_id','verification','note'],
  review_duplicate:['decision','note'],review_technical:['decision','note'],review_procurement:['decision','note'],review_finance:['decision','note'],review_legal:['decision','note'],
  approve:['outcome','reason','valid_until','condition_note'],reject:['reason'],suspend:['reason'],requalify:['reason'],
  propose_bank:['bank_name','account_holder','iban','reason'],verify_bank:['bank_id','decision','verification_method','verification_evidence','effective_from'],
  allow_shared_iban:['bank_id','other_vendor_id','reason'],
  evaluate:['purchase_id','category','scores','evidence','corrects_id'],grant_exception:['purchase_id','reason'],merge:['into_id','reason']
};

// ما يتبع تغيير الحساب المتحقق منه: إشعار للمالية داخل المنصة، ورسالة لكل جهة اتصال وُثقت قبل طلب التغيير — مسجَّلة
// «محاكاة» في vendor_outbox ولا يرسلها شيء. النص يقول آخر أربع خانات فقط، ولا يقول من جمع البيانات ولا من تحقق منها.
function announceBankChange(db,u,vendor,bank,change,effective){
  const last4=unseal(bank.iban).slice(-4),state=bankChangeState(db,u.tenant_id,bank.id);
  const hold=state.state==='unadopted'?'مهلة التهدئة بعد تغيير الحساب ما تقررت للحين، فالدفع له موقوف لين يقررها المالك.'
    :state.state==='cooling_off'?`الدفع له موقوف لين ${state.payable_from}.`:'';
  const notified=notifyMany(db,financeRecipients(db,u.tenant_id),u.id,{kind:'vendor_bank_change_hold',subjectKind:'vendor_bank_change',subjectId:change.id,category:'approvals',
    title:`تغيّر الحساب البنكي للمورد ${vendor.code}`,
    body:`الحساب الجديد آخره ${last4} ويسري من ${effective}، والحساب السابق وقف عليه الدفع. ${hold} أول دفعة للحساب الجديد يطلقها شخص ثالث، وما يعدّها ولا يعتمدها اللي جمع البيانات ولا اللي تحقق منها.`.replace(/\s+/g,' ')});
  const contacts=db.prepare('SELECT id,name,email,phone FROM vendor_contacts WHERE vendor_id=? AND active=1 AND trusted_at IS NOT NULL AND trusted_at<? ORDER BY trusted_at,rowid').all(vendor.id,bank.collected_at);
  const write=db.prepare('INSERT INTO vendor_outbox(id,tenant_id,vendor_id,event_key,event_type,subject_id,contact_id,channel,status,simulated,subject,body,created_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)');
  const subject=`تغيير الحساب البنكي لـ${vendor.legal_name}`.slice(0,300),time=now();
  for(const c of contacts)write.run(id(),u.tenant_id,vendor.id,`bank_change:${change.id}:${c.id}`,'bank_change_notice',change.id,c.id,c.email?'email':'phone','simulated',subject,
    `هلا ${c.name}، سجّلنا عندنا حساب بنكي جديد لـ${vendor.legal_name} آخره ${last4} ويسري من ${effective}، ووقفنا الدفع على الحساب السابق. إذا ما طلبتوا هالتغيير كلّمونا على الرقم المعروف عندكم قبل أي تحويل.`.slice(0,1200),time);
  if(!contacts.length)write.run(id(),u.tenant_id,vendor.id,`bank_change:${change.id}:none`,'bank_change_notice',change.id,null,'none','no_recipient',subject,
    `ما عندنا جهة اتصال موثقة لـ${vendor.legal_name} قبل هالتغيير، فما فيه أحد تنكتب له الرسالة. تواصلوا مع المورد من قناة معروفة قبل أول دفعة للحساب الجديد.`.slice(0,1200),time);
  return {notified,simulated_messages:Math.max(contacts.length,1),recipient:contacts.length?'trusted_contact':'none'};
}

export function vendorAction(db,supplied,vendorId,action,input){
  writing(db);
  const u=actor(db,supplied),list=requireAny(db,u);
  if(!actionFields[action])fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...actionFields[action]]);
  const vendor=typeof vendorId==='string'&&db.prepare('SELECT * FROM vendors WHERE id=? AND tenant_id=?').get(vendorId,u.tenant_id);
  if(!vendor)fail(404,'not_found','ملف المورد غير متاح');
  v.version(input.version,vendor.version);
  const current=detailOf(db,u,list,vendor,{disclose:false});
  if(!current.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة الملف الحالية أو لصلاحيتك');
  const time=now(),date=today();
  let status=vendor.status,validUntil=vendor.valid_until,conditionNote=vendor.condition_note,mergedInto=null,after={};
  const optionalDate=value=>value===undefined||value===null||value===''?null:v.date(value);

  if(action==='edit'){
    // التعديل والترقيم في تحديث واحد: هوية الملف ثابتة وكل كتابة ترفع النسخة مرة واحدة.
    const f=cleanVendor(db,u.tenant_id,input,vendor);
    db.prepare('UPDATE vendors SET legal_name=?,legal_name_en=?,trade_name=?,entity_type=?,country=?,entity_ref=?,vat_number=?,categories=?,regions=?,capacity_note=?,payment_terms=?,data_source=?,legal_review_required=?,version=version+1,updated_at=? WHERE id=? AND version=?')
      .run(f.legal_name,f.legal_name_en,f.trade_name,f.entity_type,f.country,f.entity_ref,f.vat_number,f.categories,f.regions,f.capacity_note,f.payment_terms,f.data_source,f.legal_review_required,time,vendor.id,vendor.version);
    audit(db,u,'vendor',vendor.id,'vendor.edit',{version:vendor.version},{version:vendor.version+1});
    return getVendor(db,u,vendor.id);
  }
  if(action==='add_contact'){
    const email=input.email?v.text(input.email,'البريد',180):'',phone=input.phone?v.text(input.phone,'الهاتف',30):'';
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'email','البريد غير صالح');
    if(!email&&!phone)fail(400,'contact_channel','أدخل بريدًا أو هاتفًا واحدًا على الأقل');
    db.prepare('INSERT INTO vendor_contacts(id,vendor_id,name,role,email,phone,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id(),vendor.id,v.text(input.name,'اسم جهة الاتصال',180,3),v.text(input.role,'دورها لدى المورد',180,2),email,phone,u.id,time);
    after={contact_added:true};
  }
  if(action==='trust_contact'){
    const contact=db.prepare('SELECT * FROM vendor_contacts WHERE id=? AND vendor_id=? AND trusted_at IS NULL').get(input.contact_id,vendor.id);
    if(!contact)fail(404,'not_found','جهة الاتصال غير متاحة');
    if(contact.created_by===u.id)fail(409,'separation_of_duties','من أدخل جهة الاتصال لا يوثقها بنفسه');
    db.prepare('UPDATE vendor_contacts SET trusted_at=?,trusted_by=?,trusted_basis=? WHERE id=?').run(time,u.id,v.text(input.basis,'أساس الثقة بجهة الاتصال',1000,10),contact.id);
    after={contact_trusted:contact.id};
  }
  if(action==='add_document'){
    requireOption(db,u.tenant_id,'vendors.document_kind',input.kind,{field:'نوع وثيقة المورد'});
    const issued=optionalDate(input.issued_on),expires=optionalDate(input.expires_on);
    if(issued&&issued>date)fail(400,'issued_on','تاريخ الإصدار لا يكون مستقبليًا');
    if(issued&&expires&&expires<issued)fail(400,'date_order','تاريخ الانتهاء يسبق الإصدار');
    const documentId=id();
    db.prepare('INSERT INTO vendor_documents(id,vendor_id,kind,reference,issued_on,expires_on,verification,added_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(documentId,vendor.id,input.kind,v.text(input.reference,'مرجع الوثيقة أو مكان حفظها',500,3),issued,expires,'pending',u.id,time);
    if(input.replaces_id){
      const previous=db.prepare('SELECT * FROM vendor_documents WHERE id=? AND vendor_id=? AND kind=? AND superseded_by IS NULL').get(input.replaces_id,vendor.id,input.kind);
      if(!previous)fail(400,'replaces','الوثيقة المستبدلة غير متاحة أو من نوع آخر');
      db.prepare('UPDATE vendor_documents SET superseded_by=? WHERE id=?').run(documentId,previous.id);
    }
    after={document:input.kind};
  }
  if(action==='verify_document'){
    const document=db.prepare("SELECT * FROM vendor_documents WHERE id=? AND vendor_id=? AND verification='pending' AND superseded_by IS NULL").get(input.document_id,vendor.id);
    if(!document)fail(404,'not_found','الوثيقة غير متاحة للتحقق');
    if(document.added_by===u.id)fail(409,'separation_of_duties','من أضاف الوثيقة لا يتحقق منها بنفسه');
    if(document.kind==='bank_proof'?!list.includes('vendors.bank'):!list.includes('vendors.manage'))fail(403,'not_permitted','التحقق من هذه الوثيقة خارج صلاحيتك');
    if(!['verified','rejected','not_applicable'].includes(input.verification))fail(400,'verification','اختر نتيجة التحقق');
    db.prepare('UPDATE vendor_documents SET verification=?,verification_note=?,verified_by=?,verified_at=? WHERE id=?').run(input.verification,v.text(input.note,'أساس التحقق',1000,input.verification==='verified'?3:10),u.id,time,document.id);
    after={document:document.kind,verification:input.verification};
  }
  if(action==='submit'){
    if(!current.contacts.length)fail(409,'contact_required','أضف جهة اتصال واحدة على الأقل قبل التقديم');
    const missing=current.requirements.filter(r=>r.level==='required'&&r.state==='missing');
    // الرفض يقول **لماذا** لا تُسجَّل الوثيقة حين يكون نوعها خارج القائمة: طلبُ وثيقةٍ صار تسجيلها مستحيلًا
    // بلا ذكر السبب يترك المستخدم بين رفضين لا مخرج بينهما. الحارس على التعطيل يمنع هذا أصلًا، وهذا يقوله إن وقع.
    if(missing.length){
      const kinds=optionsFor(db,u.tenant_id,'vendors.document_kind',{include_disabled:true}).options;
      const name=r=>{const k=kinds.find(o=>o.value===r.kind);
        return k&&k.state!=='active'?`${k.label} (نوعها معطَّل في القائمة — يعيد تفعيله مسؤول الموردين)`:(k?.label??r.kind);};
      fail(409,'documents_required',`وثائق مطلوبة لنوع هذا المورد: ${missing.map(name).join('، ')}`);
    }
    status='in_review';decide(db,u,vendor,status,'تقديم ملف المورد للتأهيل');
  }
  if(action.startsWith('review_')){
    const kind=action.slice(7);
    if(!['passed','failed','needs_info'].includes(input.decision))fail(400,'decision','اختر نتيجة المراجعة');
    const note=v.text(input.note,'أساس القرار',3000,input.decision==='passed'?3:10);
    if(kind!=='finance'&&vendor.registered_by===u.id)fail(409,'separation_of_duties','مسجل المورد لا يراجع ملفه');
    if(kind==='duplicate'&&input.decision==='passed'&&current.duplicates.some(d=>d.strength==='strong')&&note.length<20)fail(400,'duplicate_reason','يوجد تطابق في معرّفات الكيان. اشرح لماذا ليس الملف مكررًا');
    if(kind==='finance'&&input.decision==='passed'){
      if(current.bank.some(b=>b.status==='pending'))fail(409,'bank_pending','يوجد حساب بنكي بانتظار التحقق المستقل');
      if(current.bank.length&&!current.bank.some(b=>b.status==='verified'))fail(409,'bank_unverified','لا يوجد حساب بنكي متحقق منه');
    }
    db.prepare('INSERT INTO vendor_reviews VALUES(?,?,?,?,?,?,?,?)').run(id(),vendor.id,current.cycle,kind,input.decision,note,u.id,time);
    // طلب الاستكمال يعيد الملف للمسجل دون فقد ما سُجل.
    if(input.decision==='needs_info'){status='draft';decide(db,u,vendor,status,`استكمال مطلوب — ${REVIEW_KINDS[kind]}: ${note}`);}
    after={review:kind,decision:input.decision};
  }
  if(action==='approve'){
    if(!['approved','conditional'].includes(input.outcome))fail(400,'outcome','اختر اعتمادًا كاملًا أو مشروطًا');
    const reason=v.text(input.reason,'سبب القرار',3000,10),latest=latestReviews(db,vendor.id,current.cycle);
    const required=['duplicate','technical','procurement',...(current.bank.length?['finance']:[]),...(vendor.legal_review_required?['legal']:[])];
    const open=required.filter(kind=>latest[kind]?.decision!=='passed');
    if(open.length)fail(409,'reviews_required',`مراجعات لم تُجتز في هذه الدورة: ${open.map(k=>REVIEW_KINDS[k]).join('، ')}`);
    const unmet=current.requirements.filter(r=>!['ok','not_applicable'].includes(r.state));
    if(input.outcome==='approved'){
      if(unmet.length)fail(409,'documents_unverified',`وثائق غير مستوفاة: ${unmet.map(r=>optionLabel(db,u.tenant_id,'vendors.document_kind',r.kind)).join('، ')}. يمكن الاعتماد المشروط بمدة`);
      validUntil=null;conditionNote='';
    }else{
      validUntil=v.date(input.valid_until);
      if(validUntil<=date||validUntil>plusDays(date,180))fail(400,'valid_until','مدة الاعتماد المشروط من الغد حتى 180 يومًا');
      conditionNote=v.text(input.condition_note,'الشروط',2000,10);
    }
    status=input.outcome;decide(db,u,vendor,status,reason,validUntil);
  }
  if(['reject','suspend','requalify'].includes(action)){
    status={reject:'rejected',suspend:'suspended',requalify:'requalification'}[action];
    decide(db,u,vendor,status,v.text(input.reason,'سبب القرار',3000,10));
  }
  if(action==='propose_bank'){
    const iban=cleanIban(input.iban);
    db.prepare('INSERT INTO vendor_bank_accounts(id,vendor_id,bank_name,account_holder,iban,iban_digest,reason,status,collected_by,collected_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id(),vendor.id,v.text(input.bank_name,'اسم البنك',180,2),v.text(input.account_holder,'اسم صاحب الحساب',180,3),seal(iban),ibanDigest(u.tenant_id,iban),v.text(input.reason,'سبب التسجيل أو التغيير',2000,10),'pending',u.id,time);
    after={bank:'pending'};
  }
  if(action==='verify_bank'){
    if(!list.includes('vendors.bank'))fail(403,'not_permitted','التحقق المالي خارج صلاحيتك');
    const bank=db.prepare("SELECT * FROM vendor_bank_accounts WHERE id=? AND vendor_id=? AND status='pending'").get(input.bank_id,vendor.id);
    if(!bank)fail(404,'not_found','لا يوجد حساب بانتظار التحقق');
    if(bank.collected_by===u.id)fail(409,'separation_of_duties','جامع بيانات الحساب لا يعتمد تغييرها');
    if(!['verified','rejected'].includes(input.decision))fail(400,'decision','اختر نتيجة التحقق');
    const evidence=v.text(input.verification_evidence,'دليل التحقق',3000,10);
    if(input.decision==='rejected'){
      db.prepare("UPDATE vendor_bank_accounts SET status='rejected',verification_evidence=?,verified_by=?,verified_at=? WHERE id=?").run(evidence,u.id,time,bank.id);
    }else{
      if(!['trusted_contact_callback','bank_letter','approved_channel'].includes(input.verification_method))fail(400,'verification_method','اختر وسيلة التحقق المستقل');
      // الاتصال المرتد لا يُقبل إلا بجهة اتصال وُثقت قبل طلب التغيير نفسه.
      if(input.verification_method==='trusted_contact_callback'&&!db.prepare('SELECT 1 FROM vendor_contacts WHERE vendor_id=? AND active=1 AND trusted_at IS NOT NULL AND trusted_at<?').get(vendor.id,bank.collected_at))
        fail(409,'trusted_contact_required','لا توجد جهة اتصال موثقة قبل طلب التغيير. استخدم خطابًا بنكيًا أو وسيلة معتمدة أخرى');
      const effective=v.date(input.effective_from);
      if(effective<date)fail(400,'effective_from','تاريخ السريان من اليوم فصاعدًا');
      // الآيبان على مورد نشط آخر: لا تحقق حتى يسجّل غيرُ جامع البيانات قرارًا مسبَّبًا، ولا يتحقق من سجّل القرار.
      const shared=sharedIbanVendors(db,u.tenant_id,bank),undecided=shared.filter(x=>!x.decided_by);
      if(undecided.length)refuse(409,'iban_on_another_vendor',{what:`ما ينتحقق من هالحساب — الآيبان نفسه مسجّل على ${undecided.map(x=>x.code).join('، ')}`,
        missing:[{document:'قرار مسبَّب يقبل الآيبان المشترك («قبول آيبان مشترك» في ملف المورد)',why:'حساب واحد على موردين نشطين علامة احتيال أو ملفات مكررة، وما يمرّ إلا بقرار مكتوب بسببه',
          owner:'المالية — زميل يحمل تصريح التحقق المالي غير اللي جمع بيانات الحساب',owner_role:'finance'}],
        next:'يسجّل الزميل القرار بسببه، وبعدها يتحقق من الحساب شخص غيره'});
      if(shared.some(x=>x.decided_by===u.id))refuse(409,'separation_of_duties',{what:'اللي سجّل قرار قبول الآيبان المشترك ما يتحقق من الحساب بنفسه',
        missing:[{document:'تحقق مستقل من زميل آخر',why:'القرار والتحقق خطوتان، وكل خطوة بيد',owner:'المالية — من يحمل تصريح التحقق المالي',owner_role:'finance'}],
        next:'اطلب التحقق من زميل مالي غيرك وغير جامع البيانات'});
      // حساب لمورد سبق له حساب متحقق منه = تغيير. الساري يُحَلّ (superseded) قبل التحقق من الجديد، ويُسجَّل التغيير
      // بمتحققه ويومه، فيدخل الحساب الجديد مهلة التهدئة وخطوة إطلاق أول دفعة. القوادح في الترحيل 166 تفرض الترتيب نفسه.
      const replaced=db.prepare("SELECT * FROM vendor_bank_accounts WHERE vendor_id=? AND status='verified' ORDER BY effective_from DESC,verified_at DESC,rowid DESC").all(vendor.id);
      let change=null;
      if(db.prepare("SELECT 1 FROM vendor_bank_accounts WHERE vendor_id=? AND status IN ('verified','superseded')").get(vendor.id)){
        for(const old of replaced)db.prepare("UPDATE vendor_bank_accounts SET status='superseded' WHERE id=?").run(old.id);
        const replacesId=replaced[0]?.id??db.prepare("SELECT b.id FROM vendor_bank_accounts b WHERE b.vendor_id=? AND b.status='superseded' AND NOT EXISTS(SELECT 1 FROM vendor_bank_changes c WHERE c.replaces_id=b.id) ORDER BY b.verified_at DESC,b.rowid DESC LIMIT 1").get(vendor.id)?.id;
        if(!replacesId)refuse(409,'bank_history_inconsistent',{what:'ما ينتحقق من الحساب — سجل حسابات هالمورد ما يبيّن أي حساب يحل محله',
          missing:[{document:'مراجعة سجل الحسابات البنكية للمورد',why:'كل حساب سابق حلّ محله حساب مسجَّل، فما بقي حساب يُربط به التغيير',owner:'مسؤول المنصة',owner_role:'admin'}],
          next:'راجع مع مسؤول المنصة سجل الحسابات قبل أي تحقق جديد'});
        change={id:id(),replaces_id:replacesId,superseded:replaced.map(r=>r.id)};
        db.prepare('INSERT INTO vendor_bank_changes(id,tenant_id,vendor_id,bank_account_id,replaces_id,collected_by,verified_by,verified_on,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(change.id,u.tenant_id,vendor.id,bank.id,replacesId,bank.collected_by,u.id,date,time);
      }
      db.prepare("UPDATE vendor_bank_accounts SET status='verified',verification_method=?,verification_evidence=?,verified_by=?,verified_at=?,effective_from=? WHERE id=?").run(input.verification_method,evidence,u.id,time,effective,bank.id);
      if(change)after={change_id:change.id,superseded:change.superseded,...announceBankChange(db,u,vendor,bank,change,effective)};
    }
    after={bank:input.decision,...after};
  }
  if(action==='allow_shared_iban'){
    const bank=db.prepare("SELECT * FROM vendor_bank_accounts WHERE id=? AND vendor_id=? AND status='pending'").get(input.bank_id,vendor.id);
    if(!bank)fail(404,'not_found','لا يوجد حساب بانتظار التحقق بهذا المعرّف في ملف المورد');
    const other=sharedIbanVendors(db,u.tenant_id,bank).find(x=>x.vendor_id===input.other_vendor_id);
    if(!other)refuse(409,'iban_not_shared',{what:'ما فيه مورد نشط آخر يحمل هالآيبان، فما فيه شيء يُقبل',next:'اختر المورد الذي يظهر في ملف الحساب المعلّق بأن الآيبان نفسه عليه'});
    if(other.decided_by)refuse(409,'already_decided',{what:`قرار قبول الآيبان المشترك مع ${other.code} مسجّل من قبل`,next:'افتح ملف المورد وراجع القرار المسجّل'});
    db.prepare('INSERT INTO vendor_bank_shared_decisions(id,tenant_id,bank_account_id,other_vendor_id,reason,decided_by,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,bank.id,other.vendor_id,v.text(input.reason,'سبب قبول الآيبان المشترك',3000,20),u.id,time);
    after={shared_iban_allowed:other.code,bank_account_id:bank.id};
  }
  if(action==='evaluate'){
    const category=input.category;
    if(!JSON.parse(vendor.categories).includes(category))fail(400,'category','التصنيف ليس من تصنيفات هذا المورد');
    const scores=v.object(input.scores,SCORE_KEYS.map(s=>s.key)),weights=weightsFor(category);
    let weighted=0;
    for(const {key} of SCORE_KEYS){if(!Number.isInteger(scores[key])||scores[key]<1||scores[key]>5)fail(400,'scores','كل معيار عدد صحيح من 1 إلى 5');weighted+=scores[key]*weights[key];}
    let purchaseId=null;
    if(input.purchase_id){
      const order=db.prepare('SELECT o.purchase_id FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id WHERE o.purchase_id=? AND p.tenant_id=? AND o.supplier_key=?').get(input.purchase_id,u.tenant_id,vendor.supplier_key);
      if(!order)fail(400,'purchase','أمر الشراء لا يخص هذا المورد');
      purchaseId=order.purchase_id;
    }
    let corrects=null;
    if(input.corrects_id){
      const previous=db.prepare('SELECT id FROM vendor_evaluations WHERE id=? AND vendor_id=?').get(input.corrects_id,vendor.id);
      if(!previous||db.prepare('SELECT 1 FROM vendor_evaluations WHERE corrects_id=?').get(input.corrects_id))fail(400,'corrects','التقييم المصحح غير متاح أو سبق تصحيحه');
      corrects=previous.id;
    }
    db.prepare('INSERT INTO vendor_evaluations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id(),vendor.id,purchaseId,category,JSON.stringify(scores),JSON.stringify(weights),weighted,v.text(input.evidence,'أدلة التقييم',3000,10),corrects,u.id,time);
    after={evaluation:weighted};
  }
  if(action==='grant_exception'){
    const purchase=db.prepare('SELECT * FROM procurement_purchases WHERE id=? AND tenant_id=?').get(input.purchase_id,u.tenant_id);
    if(!purchase)fail(400,'purchase','طلب الشراء غير متاح');
    if(purchase.requester_id===u.id)fail(409,'separation_of_duties','طالب الشراء لا يمنح الاستثناء لطلبه');
    if(current.gate.allowed)fail(409,'not_blocked','المورد مؤهل ولا يحتاج استثناءً');
    if(db.prepare('SELECT 1 FROM vendor_exceptions WHERE vendor_id=? AND purchase_id=?').get(vendor.id,purchase.id))fail(409,'already_granted','الاستثناء مسجل لهذا الطلب');
    db.prepare('INSERT INTO vendor_exceptions VALUES(?,?,?,?,?,?,?)').run(id(),vendor.id,purchase.id,current.gate.blockers.map(b=>b.message).join('؛ '),v.text(input.reason,'مبرر الاستثناء',3000,10),u.id,time);
    after={exception:purchase.id};
  }
  if(action==='merge'){
    const target=db.prepare("SELECT * FROM vendors WHERE id=? AND tenant_id=? AND status<>'merged'").get(input.into_id,u.tenant_id);
    if(!target||target.id===vendor.id)fail(400,'merge_target','ملف الدمج غير متاح');
    if(db.prepare("SELECT 1 FROM vendor_bank_accounts WHERE vendor_id=? AND status='pending'").get(vendor.id))fail(409,'bank_pending','أغلق طلب الحساب البنكي المعلق قبل الدمج');
    status='merged';mergedInto=target.id;decide(db,u,vendor,status,`دمج في ${target.code}: ${v.text(input.reason,'سبب الدمج',3000,10)}`);
  }
  db.prepare('UPDATE vendors SET status=?,valid_until=?,condition_note=?,merged_into=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(status,validUntil,conditionNote,mergedInto,time,vendor.id,vendor.version);
  audit(db,u,'vendor',vendor.id,'vendor.'+action,{status:vendor.status,version:vendor.version},{status,version:vendor.version+1,...after});
  return getVendor(db,u,vendor.id);
}
