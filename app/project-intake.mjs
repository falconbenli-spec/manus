import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can, holds, capabilityHolders } from './access.mjs';
import { projectAccess } from './workflow.mjs';
import { clientFor } from './agency.mjs';
import { financeCapabilities } from './finance.mjs';
import { riyadhDate } from './work-calendar.mjs';
import { riyadhDateOf } from './riyadh-time.mjs';
import { advanceGate, agreedAdvance } from './project-axes.mjs';
import { refuse } from './refusal.mjs';
import { dealSheetOfProject, sheetDeal } from './proposal-of-record.mjs';

// سلسلة استلام المشروع: BD-04 ← PM-01 ← PM-02 ← PM-03.
// ثلاث قواعد تحكم هذا الملف:
//   (1) البوابة ترفض بالاسم: كل رفض يسمي الوثيقة الناقصة ومن يقدّمها، لا «الطلب غير مكتمل».
//   (2) التحديد والدراسة شيء، والتنفيذ المدفوع شيء آخر. مخطط الشركة يضع بعض نماذج الإدارات قبل التسعير،
//       وPM-01 يمنع بدء التنفيذ قبل الدفعة. القراءتان مدعومتان بإعداد، والتعارض معروض في الشاشة لا مطويّ.
//   (3) خطؤنا لا يُسعَّر على العميل، والجولة التي تتجاوز العقد ترفع عرضًا مسعّرًا لا عملًا صامتًا.

const id=()=>randomUUID();
const today=()=>riyadhDate(Date.now());
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

/* ───── القوائم المعرَّفة ───── */

// وثائق PM-01 الثماني بنصّ المصدر وترتيبه (ملحق المصادر §3، MOD-PM-01).
// «محضر Kick-off مع العميل إن وجد» هو الوحيد المشروط؛ السبعة الباقية إلزامية.
export const DOCUMENTS=[
  {key:'signed_contract',name:'العقد الموقع من الطرفين',required:true,owner_role:'business_development'},
  {key:'approved_pricing',name:'ملف تسعير المشروع المعتمد ماليًا',required:true,owner_role:'finance'},
  {key:'kickoff_minutes',name:'محضر Kick-off مع العميل (إن وجد)',required:false,owner_role:'project_manager'},
  {key:'creative_brief',name:'الملخص الإبداعي المعتمد من العميل',required:true,owner_role:'project_manager'},
  {key:'payment_schedule',name:'جدول الدفعات',required:true,owner_role:'business_development'},
  {key:'advance_confirmation',name:'تأكيد استلام الدفعة المقدمة من الإدارة المالية',required:true,owner_role:'finance'},
  {key:'client_contacts',name:'بيانات جهة التواصل',required:true,owner_role:'business_development'},
  {key:'client_assets',name:'ملفات وأصول العميل',required:true,owner_role:'account_manager'}
];
const DOCUMENT_BY_KEY=new Map(DOCUMENTS.map(d=>[d.key,d]));
export const OWNER_ROLES={business_development:'تطوير الأعمال (مُسلِّم BD-04)',finance:'المالية',project_manager:'مدير المشروع المسند',account_manager:'مسؤول حساب العميل'};

// أربعة تصنيفات لا اثنان. الفرق بينها ليس تسمية: هو من يدفع، وهل يُستهلك من رصيد الجولات، وهل يحتاج ملحق عقد.
export const CLASSIFICATIONS=[
  {key:'our_error',name:'تصحيح خطأ من عندنا',meaning:'العمل يُعاد على حسابنا. لا تكلفة على العميل ولا جولة تُخصم من رصيده.',charges_client:false,consumes_round:false},
  {key:'in_scope',name:'تغيير داخل النطاق',meaning:'ضمن ما وصفه العقد. يُنفَّذ ويُخصم من جولات المخرج إن كان جولة مراجعة.',charges_client:false,consumes_round:true},
  {key:'extra_round',name:'جولة مراجعة إضافية',meaning:'تجاوز جولات المخرج المتعاقد عليها. يحتاج عرضًا مسعّرًا قبل العمل.',charges_client:true,consumes_round:true},
  {key:'scope_change',name:'تغيير نطاق حقيقي',meaning:'خارج ما وصفه العقد. يحتاج تسعيرًا وموافقة العميل وملحق عقد.',charges_client:true,consumes_round:false}
];
const CLASSIFICATION_BY_KEY=new Map(CLASSIFICATIONS.map(c=>[c.key,c]));

export const GATE_READINGS=[
  {key:'block_paid_execution',name:'PM-01 يمنع بدء التنفيذ المدفوع',
   source:'تنبيه MOD-PM-01 في ملحق المصادر §3: «لا يُبدأ في أي عمل تنفيذي قبل التحقق من استلام الدفعة المقدمة وتوقيع المحضر».',
   effect:'التحديد والدراسة وما قبل البيع مسموحة دائمًا. إسناد مهام التنفيذ وبدء التنفيذ المدفوع ممنوعان حتى تكتمل الوثائق الإلزامية، وتؤكد المالية الدفعة، ويُعتمد المحضر من طرفيه.'},
  {key:'documents_advisory',name:'المخطط يضع نماذج التنفيذ قبل التسعير',
   source:'ملحق المصادر §4، التعارض 2: «المخطط يضع بعض نماذج التنفيذ والاعتمادات قبل التسعير والتعاقد».',
   effect:'النقص يُعرض ولا يمنع. بدء التنفيذ يُسجَّل مع ما كان ناقصًا وقتها، ويبقى ظاهرًا في سجل المشروع.'}
];
// التعارض يُعرض في كل قراءة للبوابة. لا يُحسم في الكود لأن مصدريه من الشركة نفسها ويتناقضان.
export const GATE_CONFLICT={
  reference:'ملحق المصادر §4، التعارض 2 — ترتيب التنفيذ',
  question:'هل تمنع قائمة PM-01 بدء العمل، أم تُملأ بعض نماذج الإدارات والاعتمادات قبل التسعير والتعاقد؟',
  readings:GATE_READINGS.map(r=>({key:r.key,source:r.source})),
  default:'block_paid_execution',
  source_proposal:'المصدر نفسه يقترح الحل: «فصل تقدير النطاق قبل البيع عن التنفيذ المدفوع بعد التعاقد». وهذا ما تفعله البوابة.',
  unresolved:'أي الإجراءات يُعدّ «تقدير نطاق» وأيها «تنفيذ مدفوع» لم يحسمه المصدر بقائمة، فالافتراضي هو القراءة المانعة لأن أثر الخطأ فيها أقل: عمل متأخر أهون من عمل غير مدفوع. يحسمه مالك الإجراء.'
};
export const MEETING_MODES={in_person:'حضوري',online:'أونلاين',hybrid:'هجين'};

/* ───── أدوات ───── */

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}

/* ───── الربط بمحرك النماذج (ترحيل 113) ───── */
// كل سجل في السلسلة هو نموذج في كتالوج الشركة: BD-04 وPM-01 وPM-02 وPM-03.
// الربط يحفظ الهوية (رقم النموذج ورمزه وسجله في الكتالوج) ويترك الحقول والبوابة حيث هي، فلا يُعبَّأ حقل مرتين.
export const formBinding=(db,recordKind)=>db.prepare('SELECT * FROM intake_form_bindings WHERE record_kind=?').get(recordKind)??null;
function linkForm(db,u,recordKind,recordId,projectId){
  const binding=formBinding(db,recordKind);
  if(!binding)return null;
  if(db.prepare('SELECT 1 FROM intake_form_links WHERE record_kind=? AND record_id=?').get(recordKind,recordId))return null;
  const linkId=id();
  db.prepare('INSERT INTO intake_form_links(id,tenant_id,record_kind,record_id,project_id,form_key,form_instance_id,linked_by,created_at) VALUES(?,?,?,?,?,?,NULL,?,?)')
    .run(linkId,u.tenant_id,recordKind,recordId,projectId,binding.form_key,u.id,now());
  return linkId;
}
// ما يُعرض على شاشة السجل وفي الكتالوج: النموذج الذي يقابله، وحالة تعريفه، وما لم يُربط بعد.
export function formOf(db,tenantId,recordKind,recordId){
  const binding=formBinding(db,recordKind);
  if(!binding)return null;
  const link=db.prepare('SELECT * FROM intake_form_links WHERE record_kind=? AND record_id=?').get(recordKind,recordId)??null;
  const definition=db.prepare('SELECT form_key,version,title_ar,status,step_no,department_name FROM form_definitions WHERE tenant_id=? AND form_key=? ORDER BY version DESC LIMIT 1')
    .get(tenantId,binding.form_key)??null;
  const aliases=db.prepare('SELECT alias FROM form_definition_aliases WHERE tenant_id=? AND form_key=? AND alias_kind=? ORDER BY alias')
    .all(tenantId,binding.form_key,'code').map(r=>r.alias);
  return {form_key:binding.form_key,aliases,catalogue_link:`#forms?q=${encodeURIComponent(binding.form_key)}`,
    title:definition?.title_ar??null,definition_status:definition?.status??null,definition_version:definition?.version??null,
    data_entry:binding.data_entry,unbound_note:binding.unbound_note,
    linked_at:link?.created_at??null,form_instance_id:link?.form_instance_id??null,
    note:'التعبئة في هذه الشاشة، والنموذج في الكتالوج هويةُ السجل وسنده. لا تُفتح نسخة ثانية من الكتالوج لهذا النموذج.'};
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة سلسلة الاستلام معاملة قاعدة بيانات');}
const person=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??'':'';
const parse=value=>{try{return JSON.parse(value);}catch{return [];}};
const seesFinance=(db,u)=>financeCapabilities(db,u).includes('read');
// من يقدّم وثيقة مالية: حامل تصريح مالي فعلي، لا أي عضو في المشروع. التصريح يُفحص بـholds الصارم.
const financeHolder=(db,u)=>holds(db,u,'finance.use')||holds(db,u,'billing.recurring.manage')||holds(db,u,'finance.close.manage');
const money=value=>{
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money','المبلغ بالريال بخانتين عشريتين كحد أقصى');
  const [whole,fraction='']=value.split('.');
  return Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
};
const integer=(value,label,min,max)=>{if(!Number.isInteger(value)||value<min||value>max)fail(400,'invalid_number',`${label}: عدد صحيح بين ${min} و${max}`);return value;};

// اسم من يجب أن يقدّم الوثيقة. الدور المالي لا يُسمّى شخصًا إلا إذا كان في الكيان حامل تصريح واحد لا لبس فيه.
function ownerLabel(db,tenantId,row){
  if(row.owner_id)return person(db,row.owner_id)||OWNER_ROLES[row.owner_role];
  if(row.owner_role==='finance'){
    // من access.capabilityHolders لا من access_grants مباشرةً: هي المصدر الواحد لبيان «من يحمل هذا
    // التصريح» وتمرّ بـholds، فترى ما يصل بالمستوى (ترحيل 130) كما ترى المنح. القراءة المباشرة كانت
    // تُسقط حامل التصريح بمستواه فيعود الرفض إلى اسم الدور بدل اسم الشخص الذي يملك الخطوة فعلًا.
    const holders=capabilityHolders(db,tenantId,'finance.use');
    if(holders.length===1)return holders[0].name;
  }
  return OWNER_ROLES[row.owner_role]??row.owner_role;
}

/* ───── BD-04: نموذج التسليم الداخلي ───── */

function handoverRow(db,u,handoverId){
  const row=typeof handoverId==='string'&&db.prepare('SELECT * FROM project_handovers WHERE id=? AND tenant_id=?').get(handoverId,u.tenant_id);
  if(!row)fail(404,'not_found','نموذج التسليم غير متاح');
  projectAccess(db,u,row.project_id);
  return row;
}

// حقول BD-04 كما تُكتب في مشروع بلا صفقة، وما يبقى منها مدخلًا حين يُشتق النموذج من الصفقة (P4-CRM-2، CRM-09).
const TYPED_FIELDS=['project_id','client_id','contract_reference','contract_signed_on','kickoff_planned_on','channels','contract_value','advance','advance_claimed_on','project_manager_id','services','deliverables','timeline_start','timeline_end','milestones','client_contacts','risks','special_requirements','payment_terms'];
// ما لا مصدر له في الصفقة ولا اتفاقها ولا عرضها المقبول: من يدير المشروع، ومتى وُقّع العقد فعلًا (تاريخ تسجيله في المنصة غير تاريخ توقيعه)،
// وموعد اجتماع الانطلاق، وقنوات التواصل، والجدول الزمني، وتاريخ تأكيد الدفعة المقدمة عند تطوير الأعمال، وأي جهات التواصل هي الرئيسية،
// والمخاطر والمتطلبات الخاصة.
export const DERIVED_INPUT_FIELDS=Object.freeze(['project_id','project_manager_id','contract_signed_on','kickoff_planned_on','channels','timeline_start','timeline_end','advance_claimed_on','primary_contact_id','risks','special_requirements']);
// وما يُشتق فلا يُكتب: العميل، ومرجع العقد، وقيمته، ودفعته المقدمة، والخدمات، والمخرجات، والمحطات، وجهات التواصل، وجدول الدفعات.
export const DERIVED_FIELDS=Object.freeze(['client_id','contract_reference','contract_value','advance','services','deliverables','milestones','client_contacts','payment_terms']);
const DERIVED_NAMES={client_id:'العميل',contract_reference:'مرجع العقد',contract_value:'قيمة العقد',advance:'الدفعة المقدمة',services:'الخدمات',deliverables:'المخرجات',
  milestones:'المحطات الزمنية',client_contacts:'جهات التواصل',payment_terms:'جدول الدفعات'};

// مدير المشروع المسند: حساب نشط بدور مدير أو مدير مشروع، غير المسلِّم، وعضو في المشروع.
function assignedManager(db,u,project,managerId){
  const manager=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role IN ('manager','pm')").get(managerId,u.tenant_id);
  if(!manager)fail(400,'project_manager_id','مدير المشروع المسند يجب أن يكون حسابًا نشطًا بدور مدير أو مدير مشروع');
  if(manager.id===u.id)fail(403,'separation_of_duties','من يسلّم لا يستلم: مدير المشروع المسند شخص آخر');
  if(!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(project.id,manager.id))fail(400,'project_manager_id','مدير المشروع المسند ليس عضوًا في المشروع');
  return manager;
}
// الجدول الزمني وتاريخ التوقيع وموعد الانطلاق وقنوات التواصل: مدخلات في المسارين.
function timelineFields(input){
  const start=v.date(input.timeline_start),end=v.date(input.timeline_end);
  if(end<start)fail(400,'timeline_end','نهاية الجدول الزمني تسبق بدايته');
  const signedOn=v.date(input.contract_signed_on);
  if(signedOn>today())fail(400,'contract_signed_on','تاريخ توقيع العقد لا يكون في المستقبل');
  // تاريخ اجتماع الانطلاق في BD-04 تخطيطي: قد لا يكون تحدد بعد، ولا تخترعه المنصة.
  const kickoffPlanned=input.kickoff_planned_on?v.date(input.kickoff_planned_on):null;
  const channels=v.text(input.channels,'قنوات التواصل المتفق عليها',1000,3);
  return {start,end,signedOn,kickoffPlanned,channels};
}

// مصدر BD-04 من الصفقة (P4-CRM-2): المشروع المفتوح من صفقة له خط أساس (commercial_project_baselines) يسمّي صفقته واتفاقها
// وعرضها المقبول. منها يُشتق كل ما كان يُكتب مرة ثانية. لا يرمي: يعيد المشتق وما يمنعه، فتعرضه الشاشة قبل الحفظ ويرفض به الحفظ.
function derivedHandover(db,u,project,baseline){
  const c=db.prepare('SELECT * FROM commercial_cases WHERE id=? AND tenant_id=?').get(baseline.case_id,u.tenant_id);
  const contract=JSON.parse(db.prepare('SELECT snapshot FROM commercial_contracts WHERE id=?').get(baseline.contract_id).snapshot);
  const client=c.client_id?db.prepare('SELECT id,code,legal_name,trade_name,owner_id FROM clients WHERE id=? AND tenant_id=?').get(c.client_id,u.tenant_id):null;
  const caseOwner=person(db,c.owner_id)||'صاحب الصفقة',accountOwner=client?person(db,client.owner_id)||'مسؤول حساب العميل':'مسؤول حساب العميل';
  const ref=String(c.id).replace(/-/g,'').slice(0,8).toUpperCase(),revision=contract.quote_revision??1;
  const terms=db.prepare('SELECT * FROM case_payment_terms WHERE case_id=? ORDER BY position').all(c.id);
  const contacts=client?db.prepare('SELECT id,name,title,email,phone FROM client_contacts WHERE client_id=? AND active=1 ORDER BY created_at,id').all(client.id):[];
  const value=Number(contract.total_minor),blockers=[];
  const block=(code,what,missing,next)=>blockers.push({code,what,missing,next});
  if(!client)block('customer_file_required','الصفقة ما ارتبطت بملف عميل، فما يُعرف العميل الذي يُسلَّم له المشروع',
    [{document:'ربط الصفقة بملف العميل',why:'العميل في نموذج التسليم يُقرأ من ملفه لا يُكتب',owner:caseOwner,owner_role:'business_development',doc_key:'client'}],'اربط الصفقة بعميلها من «العملاء»، ثم ارجع للتسليم');
  if(contract.currency!=='SAR')block('currency_not_supported',`الاتفاق بعملة ${contract.currency}، ونموذج التسليم بالريال وحده`,
    [{document:'اتفاق بالريال',why:'سجل التسليم أحادي العملة كما في سجل العقود (الترحيل 057)',owner:caseOwner,owner_role:'business_development',doc_key:'contract_value'}],'سلّم هذا المشروع بقرار مكتوب خارج النموذج حتى يُبنى التحويل');
  if(!terms.length)block('payment_terms_required','ما على الصفقة جدول دفعات، ونموذج التسليم يأخذ دفعاته ومحطاته منه',
    [{document:'جدول الدفعات على الصفقة',why:'الدفعات وشروطها ومواعيدها تُقرأ من الاتفاق لا تُكتب مرة ثانية',owner:caseOwner,owner_role:'business_development',doc_key:'payment_schedule'}],'سجّل جدول الدفعات على الصفقة من «العملاء والعروض»، ثم ارجع للتسليم');
  const total=terms.reduce((n,t)=>n+t.amount_minor,0);
  if(terms.length&&total!==value)block('payment_terms_mismatch',`مجموع جدول الدفعات (${(total/100).toFixed(2)}) لا يساوي قيمة الاتفاق شاملة الضريبة (${(value/100).toFixed(2)})`,
    [{document:'جدول دفعات يساوي قيمة الاتفاق',why:'قيمة العقد في النموذج هي قيمة الاتفاق، والدفعات تقسيمها',owner:caseOwner,owner_role:'business_development',doc_key:'payment_schedule'}],'الجدول يُستبدل ولا يُعدَّل: راجع الاتفاق وجدوله مع مالكهما');
  if(client&&!contacts.length)block('client_contacts_required',`ملف العميل ${client.code} ما فيه جهة تواصل`,
    [{document:'جهة تواصل في ملف العميل',why:'جهات التواصل في النموذج تُقرأ من ملف العميل',owner:accountOwner,owner_role:'account_manager',doc_key:'client_contacts'}],'أضف جهات التواصل في ملف العميل، ثم ارجع للتسليم');
  const lines=contract.lines??[];
  const unfit=lines.map((l,i)=>({l,i})).filter(({l})=>Number(l.quantity)>10000||String(l.acceptance??'').trim().length<5);
  if(unfit.length)block('contract_line_unfit',`بنود في الاتفاق ما تصلح مخرجات قابلة للقبول: ${unfit.map(({i})=>`البند ${i+1}`).join('، ')}`,
    unfit.map(({i})=>({document:`البند ${i+1} في الاتفاق`,why:'المخرج كميته حتى 10000 ومعيار قبوله خمسة أحرف على الأقل',owner:caseOwner,owner_role:'business_development',doc_key:'deliverables'})),'الاتفاق ثابت: عالج البند بطلب تغيير على الصفقة');
  const advanceTerm=terms.find(t=>t.is_advance);
  return {derived:true,project_id:project.id,case_id:c.id,contract_id:baseline.contract_id,quote_id:baseline.quote_id,
    client:client?{id:client.id,code:client.code,name:client.trade_name||client.legal_name}:null,
    contract_reference:`اتفاق الصفقة ${ref} — العرض المعتمد رقم ${revision}`,
    contract_value_minor:value,currency:contract.currency,advance_minor:advanceTerm?.amount_minor??0,
    services:[...new Set(lines.map(l=>l.description))],
    deliverables:lines.map((l,i)=>({position:i+1,name:l.description,unit:'',quantity:Number(l.quantity),acceptance:l.acceptance,revision_rounds:l.revisions,
      rounds_source:'contract',rounds_basis:`البند ${i+1} في الاتفاق الموثّق على العرض المعتمد رقم ${revision}`})),
    // محطات الجدول: مواعيد جدول الدفعات المتفق عليها، فهي المواعيد الوحيدة التي يحملها الاتفاق.
    milestones:terms.map(t=>({name:t.label,due_on:t.due_on,source:'payment_term'})),
    client_contacts:contacts,
    payment_terms:terms.map((t,i)=>({position:i+1,label:t.label,amount_minor:t.amount_minor,due_on:t.due_on,
      condition:t.condition.trim().length>=5?t.condition:`تستحق بتاريخ ${t.due_on} كما في جدول الدفعات المسجّل على الصفقة`,term_status:'planned',notes:'',is_advance:t.is_advance})),
    input_fields:[...DERIVED_INPUT_FIELDS],blockers};
}
// القارئ: ما سيُشتق للنموذج وما يبقى مدخلًا، قبل أن يُكتب شيء. مشروع بلا صفقة يعود بحقول النموذج المكتوب كما هي.
export function handoverSource(db,supplied,projectId){
  const u=actor(db,supplied),project=projectAccess(db,u,projectId);
  const baseline=db.prepare('SELECT * FROM commercial_project_baselines WHERE project_id=?').get(project.id);
  if(!baseline)return {derived:false,project_id:project.id,input_fields:[...TYPED_FIELDS],blockers:[]};
  return derivedHandover(db,u,project,baseline);
}

export function createHandover(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,[...new Set([...TYPED_FIELDS,...DERIVED_INPUT_FIELDS])]);
  if(!can(db,u,'intake.handover'))fail(403,'not_permitted','نموذج التسليم BD-04 يعدّه من يملك تصريح تسليم الأعمال');
  const project=projectAccess(db,u,input.project_id);
  const baseline=db.prepare('SELECT * FROM commercial_project_baselines WHERE project_id=?').get(project.id);
  if(baseline){
    // ما يأتي من الصفقة لا يُكتب مرة ثانية: يُرفض باسمه ولا يُتجاهل بصمت.
    const typed=DERIVED_FIELDS.filter(key=>input[key]!==undefined);
    if(typed.length)refuse(400,'derived_field',{what:`${typed.map(key=>DERIVED_NAMES[key]).join(' و')} تجي من الصفقة واتفاقها، فما تنكتب في نموذج التسليم`,
      next:`احذفها من الطلب. المدخل هنا: مدير المشروع وتاريخ توقيع العقد وموعد الانطلاق وقنوات التواصل والجدول الزمني وتاريخ تأكيد الدفعة المقدمة وجهة التواصل الرئيسية والمخاطر والمتطلبات الخاصة`});
  }else if(input.primary_contact_id!==undefined)v.object(input,TYPED_FIELDS);
  if(db.prepare('SELECT 1 FROM project_handovers WHERE project_id=?').get(project.id))fail(409,'handover_exists','لهذا المشروع نموذج تسليم قائم. التعديل عليه يكون بطلب تغيير');
  return baseline?createDerivedHandover(db,u,project,baseline,input):createTypedHandover(db,u,project,input);
}

function createDerivedHandover(db,u,project,baseline,input){
  const source=derivedHandover(db,u,project,baseline);
  if(source.blockers.length){const [first]=source.blockers;refuse(409,first.code,{what:first.what,missing:first.missing,next:first.next});}
  // العميل يُقرأ بقواعد عزل فريق الحساب نفسها؛ من ليس في الفريق لا يسلّم مشروعه.
  const {c}=clientFor(db,u,source.client.id);
  const manager=assignedManager(db,u,project,input.project_manager_id);
  const advance=source.advance_minor;
  // تاريخ تأكيد الدفعة عند إدارة الأعمال إدخال بشري؛ وليس هو تأكيد المالية الذي تقرؤه البوابة.
  const claimed=advance>0?v.date(input.advance_claimed_on):null;
  if(claimed&&claimed>today())fail(400,'advance_claimed_on','تاريخ تأكيد الدفعة لا يكون في المستقبل');
  if(!advance&&input.advance_claimed_on)refuse(400,'advance_claimed_on',{what:'ما في جدول الدفعات دفعة مقدمة، فما يُكتب تاريخ تأكيدها',next:'احذف تاريخ تأكيد الدفعة المقدمة من الطلب'});
  const {start,end,signedOn,kickoffPlanned,channels}=timelineFields(input);
  const outside=source.milestones.filter(m=>m.due_on<start||m.due_on>end);
  if(outside.length)refuse(400,'milestones',{what:`مواعيد في جدول الدفعات خارج الجدول الزمني المعلن: ${outside.map(m=>`«${m.name}» ${m.due_on}`).join('، ')}`,
    next:'وسّع بداية الجدول الزمني أو نهايته لتشمل مواعيد الاتفاق'});
  // جهة التواصل الرئيسية واحدة: إن كانت في الملف جهة واحدة فهي هي، وإلا يختارها المسلِّم من جهات الملف.
  const primary=source.client_contacts.length===1?source.client_contacts[0].id:input.primary_contact_id;
  if(!source.client_contacts.some(x=>x.id===primary))refuse(400,'primary_contact_required',{what:'في ملف العميل أكثر من جهة تواصل، والرئيسية ما تحددت',
    missing:[{document:'جهة التواصل الرئيسية من جهات ملف العميل',why:'«جهة التواصل الرئيسية» حقل مستقل في MOD-BD-04: واحدة لا أكثر',owner:person(db,u.id)||'المسلِّم',owner_role:'business_development',doc_key:'primary_contact_id'}],
    next:'اختر جهة التواصل الرئيسية من جهات ملف العميل (primary_contact_id)'});
  const contacts=source.client_contacts.map(x=>({name:x.name,title:x.title,email:x.email,phone:x.phone,is_primary:x.id===primary}));
  return insertHandover(db,u,project,{clientId:c.id,reference:source.contract_reference,signedOn,kickoffPlanned,channels,value:source.contract_value_minor,advance,claimed,
    managerId:manager.id,services:source.services,start,end,milestones:source.milestones.map(({name,due_on})=>({name,due_on})),contacts,
    risks:input.risks?v.text(input.risks,'نقاط المخاطرة المحتملة',3000):'',special:input.special_requirements?v.text(input.special_requirements,'متطلبات خاصة من العميل',3000):'',
    deliverables:source.deliverables,terms:source.payment_terms,derivedFrom:{case_id:source.case_id,contract_id:source.contract_id,quote_id:source.quote_id}});
}

function createTypedHandover(db,u,project,input){
  // العميل يُقرأ بقواعد عزل فريق الحساب نفسها؛ من ليس في الفريق لا يسلّم مشروعه.
  const {c}=clientFor(db,u,input.client_id);
  const manager=assignedManager(db,u,project,input.project_manager_id);

  const value=money(input.contract_value),advance=input.advance===undefined||input.advance===''?0:money(input.advance);
  if(advance>value)fail(400,'advance','الدفعة المقدمة أكبر من قيمة العقد');
  // تاريخ تأكيد الدفعة عند إدارة الأعمال إدخال بشري؛ وليس هو تأكيد المالية الذي تقرؤه البوابة.
  const claimed=advance>0?v.date(input.advance_claimed_on):null;
  if(claimed&&claimed>today())fail(400,'advance_claimed_on','تاريخ تأكيد الدفعة لا يكون في المستقبل');
  const {start,end,signedOn,kickoffPlanned,channels}=timelineFields(input);

  if(!Array.isArray(input.services)||!input.services.length||input.services.length>30)fail(400,'services','أدخل خدمة واحدة إلى ثلاثين');
  const services=input.services.map(s=>v.text(s,'الخدمة المتعاقد عليها',180,2));
  if(!Array.isArray(input.milestones)||!input.milestones.length||input.milestones.length>40)fail(400,'milestones','أدخل محطة زمنية واحدة إلى أربعين');
  const milestones=input.milestones.map(m=>{v.object(m,['name','due_on']);const due=v.date(m.due_on);
    if(due<start||due>end)fail(400,'milestones','المحطة خارج الجدول الزمني المعلن');
    return {name:v.text(m.name,'اسم المحطة',180,2),due_on:due};});
  if(!Array.isArray(input.client_contacts)||!input.client_contacts.length||input.client_contacts.length>20)fail(400,'client_contacts','أدخل جهة تواصل واحدة إلى عشرين');
  const contacts=input.client_contacts.map(x=>{v.object(x,['name','title','email','phone','is_primary']);
    return {name:v.text(x.name,'اسم جهة التواصل',180,3),title:v.text(x.title,'الصفة',180,2),
      email:x.email?v.text(x.email,'البريد',180):'',phone:x.phone?v.text(x.phone,'الهاتف',30):'',is_primary:x.is_primary===true};});
  // «جهة التواصل الرئيسية» حقل مستقل في MOD-BD-04: واحدة لا أكثر، لأن اثنتين تعنيان لا أحد عند أول خلاف.
  if(contacts.filter(x=>x.is_primary).length!==1)fail(400,'client_contacts','حدّد جهة تواصل رئيسية واحدة من جهة العميل');

  if(!Array.isArray(input.deliverables)||!input.deliverables.length||input.deliverables.length>60)fail(400,'deliverables','أدخل مخرجًا واحدًا إلى ستين، قابلة للعد');
  const seen=new Set();
  const deliverables=input.deliverables.map((d,index)=>{
    v.object(d,['name','unit','quantity','acceptance','revision_rounds','rounds_source','rounds_basis']);
    const name=v.text(d.name,'اسم المخرج',180,2);
    if(seen.has(name))fail(400,'deliverables','المخرج مكرر');
    seen.add(name);
    if(!['contract','template_default'].includes(d.rounds_source))fail(400,'rounds_source','مصدر عدد الجولات: من العقد، أو افتراضي قالب ينتظر التأكيد');
    // «جولتان» في سجل التصميم افتراضي قالب، لا سياسة شركة: يُسجَّل بمصدره ويبقى بانتظار التأكيد من العقد.
    const basis=d.rounds_source==='contract'?v.text(d.rounds_basis,'بند العقد الذي يحدد جولات هذا المخرج',500,5):(d.rounds_basis?v.text(d.rounds_basis,'ملاحظة على الافتراضي',500):'');
    return {position:index+1,name,unit:d.unit?v.text(d.unit,'الوحدة',60):'',quantity:integer(d.quantity,'كمية المخرج',1,10000),
      acceptance:v.text(d.acceptance,'معيار قبول المخرج',2000,5),
      revision_rounds:integer(d.revision_rounds,'جولات المراجعة',0,20),rounds_source:d.rounds_source,rounds_basis:basis};
  });

  if(!Array.isArray(input.payment_terms)||!input.payment_terms.length||input.payment_terms.length>40)fail(400,'payment_terms','جدول الدفعات لا يكون فارغًا');
  let total=0,advanceRows=0;
  const terms=input.payment_terms.map((t,index)=>{
    v.object(t,['label','amount','due_on','condition','term_status','notes','is_advance']);
    const amount=money(t.amount);total+=amount;
    if(t.is_advance===true)advanceRows++;
    if(t.term_status!==undefined&&t.term_status!==''&&!['planned','due','received'].includes(t.term_status))fail(400,'payment_terms','حالة الدفعة: مخططة أو مستحقة أو مستلمة');
    return {position:index+1,label:v.text(t.label,'مرحلة الدفعة',180,2),amount_minor:amount,
      due_on:t.due_on?v.date(t.due_on):null,
      // الشرط إلزامي: دفعة بلا شرط استحقاق تتحول خلافًا عند التحصيل.
      condition:v.text(t.condition,'شرط استحقاق الدفعة',1000,5),
      term_status:t.term_status||'planned',notes:t.notes?v.text(t.notes,'ملاحظات الدفعة',1000):'',
      is_advance:t.is_advance===true?1:0};
  });
  if(total!==value)fail(400,'payment_terms',`مجموع الدفعات (${(total/100).toFixed(2)}) لا يساوي قيمة العقد (${(value/100).toFixed(2)})`);
  if(advance>0&&advanceRows!==1)fail(400,'payment_terms','حدّد دفعة مقدمة واحدة في الجدول تطابق المبلغ المعلن');
  if(advance>0&&terms.find(t=>t.is_advance)?.amount_minor!==advance)fail(400,'payment_terms','مبلغ الدفعة المقدمة في الجدول لا يطابق المبلغ المعلن');
  if(advance===0&&advanceRows)fail(400,'payment_terms','لا دفعة مقدمة معلنة، فلا تُوسم دفعة بأنها مقدمة');

  return insertHandover(db,u,project,{clientId:c.id,reference:v.text(input.contract_reference,'مرجع العقد أو العرض المعتمد',500,5),signedOn,kickoffPlanned,channels,value,advance,claimed,
    managerId:manager.id,services,start,end,milestones,contacts,
    risks:input.risks?v.text(input.risks,'نقاط المخاطرة المحتملة',3000):'',special:input.special_requirements?v.text(input.special_requirements,'متطلبات خاصة من العميل',3000):'',
    deliverables,terms,derivedFrom:null});
}

function insertHandover(db,u,project,h){
  const handoverId=id(),time=now();
  db.prepare(`INSERT INTO project_handovers(id,tenant_id,project_id,client_id,contract_reference,contract_signed_on,kickoff_planned_on,channels,contract_value_minor,advance_minor,advance_claimed_on,project_manager_id,services,timeline_start,timeline_end,milestones,client_contacts,risks,special_requirements,status,prepared_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`)
    .run(handoverId,u.tenant_id,project.id,h.clientId,h.reference,h.signedOn,h.kickoffPlanned,h.channels,h.value,h.advance,h.claimed,h.managerId,
      JSON.stringify(h.services),h.start,h.end,JSON.stringify(h.milestones),JSON.stringify(h.contacts),h.risks,h.special,u.id,time,time);
  for(const d of h.deliverables)
    db.prepare('INSERT INTO project_deliverables(id,tenant_id,handover_id,position,name,unit,quantity,acceptance,revision_rounds,rounds_source,rounds_basis) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id(),u.tenant_id,handoverId,d.position,d.name,d.unit,d.quantity,d.acceptance,d.revision_rounds,d.rounds_source,d.rounds_basis);
  for(const t of h.terms)
    db.prepare('INSERT INTO handover_payment_terms(id,handover_id,position,label,amount_minor,due_on,condition,term_status,notes,is_advance) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id(),handoverId,t.position,t.label,t.amount_minor,t.due_on,t.condition,t.term_status,t.notes,t.is_advance);
  linkForm(db,u,'handover',handoverId,project.id);
  audit(db,u,'project_handover',handoverId,'intake.handover_prepared',{},{project_id:project.id,client_id:h.clientId,deliverables:h.deliverables.length,advance_minor:h.advance,...(h.derivedFrom?{derived_from:h.derivedFrom}:{})});
  return {id:handoverId};
}

export function handoverAction(db,supplied,handoverId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields={approve_handover:['statement'],receive_handover:['note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const row=handoverRow(db,u,handoverId);v.version(input.version,row.version);
  const time=now();
  if(action==='approve_handover'){
    if(row.status==='received')fail(409,'already_received','النموذج مستلم؛ التعديل عليه بطلب تغيير');
    // الاعتماد الإلكتروني بديل التوقيع: الطرفان مسجلان منفصلين، ولا يعتمد شخص واحد الطرفين.
    const side=u.id===row.prepared_by?'handing_over':u.id===row.project_manager_id?'receiving':null;
    if(!side)fail(403,'not_a_party','الاعتماد للمسلِّم المعدّ للنموذج ولمدير المشروع المسند فيه، لا لغيرهما');
    if(db.prepare('SELECT 1 FROM handover_approvals WHERE handover_id=? AND side=?').get(row.id,side))fail(409,'already_approved','اعتمدت هذا الطرف من قبل');
    // ما يقوم مقام التوقيع: الدور والتصريح المعتمد به ونسخة السجل وقت الاعتماد ووقته، وسلسلة التدقيق.
    const capability=side==='handing_over'?'intake.handover':'project_manager_of_record';
    if(side==='handing_over'&&!can(db,u,'intake.handover'))fail(403,'not_permitted','الاعتماد من جهة تطوير الأعمال لحامل تصريح تسليم الأعمال');
    db.prepare('INSERT INTO handover_approvals(id,handover_id,side,approved_by,approver_role,approver_capability,record_version,statement,approved_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id(),row.id,side,u.id,u.role,capability,row.version,v.text(input.statement,'ما الذي تقرّه باعتمادك',2000,10),time);
    const both=db.prepare('SELECT COUNT(*) AS n FROM handover_approvals WHERE handover_id=?').get(row.id).n===2;
    db.prepare('UPDATE project_handovers SET status=?,version=version+1,updated_at=? WHERE id=?').run(both?'handed_over':row.status,time,row.id);
    audit(db,u,'project_handover',row.id,'intake.handover_approved',{status:row.status},{side,role:u.role,capability,record_version:row.version,status:both?'handed_over':row.status},input.statement);
    return {id:row.id,side,status:both?'handed_over':row.status};
  }
  // الاستلام PM-01: ينشئ سجل الاستلام وقائمة وثائقه الثماني بأصحابها. لا يستلم إلا مدير المشروع المسند.
  if(row.status!=='handed_over')fail(409,'not_handed_over',row.status==='received'?'المشروع مستلم بالفعل':'النموذج ينتظر اعتماد الطرفين إلكترونيًا قبل الاستلام');
  if(u.id!==row.project_manager_id)fail(403,'not_permitted',`الاستلام لمدير المشروع المسند: ${person(db,row.project_manager_id)}`);
  const note=v.text(input.note,'ما الذي استلمته وما الناقص في نظرك',2000,10);
  const receiptId=id(),client=db.prepare('SELECT owner_id FROM clients WHERE id=?').get(row.client_id);
  const number=db.prepare('SELECT COUNT(*) AS n FROM project_receipts WHERE tenant_id=?').get(u.tenant_id).n+1;
  db.prepare("INSERT INTO project_receipts(id,tenant_id,project_id,handover_id,number,received_on,received_by,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'open',?,?)")
    .run(receiptId,u.tenant_id,row.project_id,row.id,number,today(),u.id,time,time);
  const ownerOf={business_development:row.prepared_by,project_manager:row.project_manager_id,account_manager:client?.owner_id??null,finance:null};
  for(const doc of DOCUMENTS)
    db.prepare("INSERT INTO receipt_documents(id,receipt_id,doc_key,required,owner_role,owner_id,status) VALUES(?,?,?,?,?,?,'missing')")
      .run(id(),receiptId,doc.key,doc.required?1:0,doc.owner_role,ownerOf[doc.owner_role]);
  db.prepare("UPDATE project_handovers SET status='received',version=version+1,updated_at=? WHERE id=?").run(time,row.id);
  linkForm(db,u,'receipt',receiptId,row.project_id);
  audit(db,u,'project_receipt',receiptId,'intake.project_received',{},{handover_id:row.id,project_id:row.project_id,number,documents:DOCUMENTS.length},note);
  return {id:receiptId,number,handover_id:row.id};
}

// «التوقيعان» في MOD-PM-01: اعتماد إلكتروني من المُسلِّم والمُستلِم. البوابة تشترطه مع تأكيد الدفعة، لا بدله.
export function approveReceipt(db,supplied,receiptId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','statement']);
  const receipt=receiptRow(db,u,receiptId);v.version(input.version,receipt.version);
  const handover=handoverOf(db,receipt);
  const side=u.id===handover.prepared_by?'handing_over':u.id===receipt.received_by?'receiving':null;
  if(!side)fail(403,'not_a_party',`اعتماد محضر الاستلام لطرفيه: ${person(db,handover.prepared_by)} مُسلِّمًا و${person(db,receipt.received_by)} مُستلِمًا`);
  if(db.prepare('SELECT 1 FROM receipt_approvals WHERE receipt_id=? AND side=?').get(receipt.id,side))fail(409,'already_approved','اعتمدت هذا الطرف من قبل');
  const time=now();
  db.prepare('INSERT INTO receipt_approvals(id,receipt_id,side,approved_by,approver_role,approver_capability,record_version,statement,approved_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id(),receipt.id,side,u.id,u.role,side==='handing_over'?'intake.handover':'project_manager_of_record',receipt.version,
      v.text(input.statement,'ما الذي تقرّه باعتمادك محضر الاستلام',2000,10),time);
  db.prepare('UPDATE project_receipts SET version=version+1,updated_at=? WHERE id=?').run(time,receipt.id);
  audit(db,u,'project_receipt',receipt.id,'intake.receipt_approved',{},{side,role:u.role,record_version:receipt.version},input.statement);
  return executionGate(db,u,receipt.project_id,'paid_execution');
}

/* ───── PM-01: قائمة الوثائق والبوابة ───── */

function receiptRow(db,u,receiptId){
  const row=typeof receiptId==='string'&&db.prepare('SELECT * FROM project_receipts WHERE id=? AND tenant_id=?').get(receiptId,u.tenant_id);
  if(!row)fail(404,'not_found','سجل الاستلام غير متاح');
  projectAccess(db,u,row.project_id);
  return row;
}
const handoverOf=(db,receipt)=>db.prepare('SELECT * FROM project_handovers WHERE id=?').get(receipt.handover_id);

// «ملف تسعير المشروع المعتمد ماليًا» (ترحيل 113): مرجع مباشر إلى ورقة تسعير معتمدة، لا جملة يكتبها إنسان.
// الاعتماد يُقرأ من مصدره: حالة الورقة ومقاعدها الأربعة وتاريخ قرارها. ومن يزعم اعتمادًا لا وجود له يُرد عليه باسمه.
export function approvedPricingSheet(db,tenantId,clientId,sheetId,projectId=null){
  const sheet=typeof sheetId==='string'&&sheetId
    ?db.prepare('SELECT * FROM pricing_sheets WHERE id=? AND tenant_id=?').get(sheetId,tenantId):null;
  if(!sheet)fail(404,'pricing_sheet_not_found','ورقة التسعير غير متاحة. «ملف تسعير المشروع المعتمد ماليًا» يشير إلى ورقة تسعير في المنصة، لا إلى مرجع مكتوب');
  if(sheet.client_id!==clientId)fail(409,'pricing_sheet_client','ورقة التسعير هذه لعميل آخر');
  // ورقة صفقة هذا المشروع لا أي ورقة معتمدة للعميل (الترحيل 182): صفقةٌ رُبط عرضها أو اتفاقها بعرض سعر، ورقتها هي ورقة ذلك العرض؛
  // والورقة المربوطة بصفقة ثانية لا تُقدَّم ملفَّ تسعير لمشروع غيرها.
  const dealSheet=projectId?dealSheetOfProject(db,projectId):null,owner=sheetDeal(db,sheet.id),projectDeal=projectId?db.prepare('SELECT id FROM commercial_cases WHERE project_id=?').get(projectId)?.id??null:null;
  if((dealSheet&&dealSheet!==sheet.id)||(owner&&owner!==projectDeal)){
    const expected=dealSheet?db.prepare('SELECT code FROM pricing_sheets WHERE id=?').get(dealSheet)?.code:null;
    refuse(409,'pricing_sheet_other_deal',{what:`ورقة التسعير «${sheet.code}» ما هي ورقة صفقة هذا المشروع`,
      missing:[{document:expected?`ورقة التسعير «${expected}» المربوطة بعرض صفقة المشروع`:'ورقة تسعير غير مربوطة بصفقة ثانية',
        why:'ملف تسعير المشروع هو الورقة التي سُعّرت عليها صفقته وقبل العميل عرضها، لا ورقة صفقة ثانية للعميل نفسه',owner:'المالية',owner_role:'finance',doc_key:'approved_pricing'}],
      next:expected?`اختر الورقة «${expected}»`:'اختر ورقة تسعير هذا المشروع'});
  }
  if(sheet.status!=='approved')fail(409,'pricing_sheet_not_approved',`ورقة التسعير «${sheet.code}» ليست معتمدة بعد (حالتها: ${sheet.status}). الاعتماد المالي يُقرأ من الورقة لا يُكتب في هذه الخانة`);
  const seats=db.prepare("SELECT seat,decision,decided_by,decided_at,capability FROM pricing_sheet_approvals WHERE sheet_id=? AND approval_round=? AND decision='approved' ORDER BY decided_at")
    .all(sheet.id,sheet.approval_round);
  return {sheet,seats};
}

export function provideDocument(db,supplied,receiptId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['doc_key','version','reference','amount','confirmed_on','pricing_sheet_id']);
  const receipt=receiptRow(db,u,receiptId),handover=handoverOf(db,receipt);
  const doc=typeof input.doc_key==='string'&&db.prepare('SELECT * FROM receipt_documents WHERE receipt_id=? AND doc_key=?').get(receipt.id,input.doc_key);
  if(!doc)fail(404,'not_found','هذه الوثيقة ليست من قائمة الاستلام');
  v.version(input.version,doc.version);
  if(doc.status==='present')fail(409,'already_present','الوثيقة مسجلة. إعادة فتحها تكون بطلب تغيير يمسّها');
  // الوثيقة المالية يسجلها حامل تصريح مالي؛ لا يعلن مدير المشروع بنفسه أن المالية أكدت.
  if(doc.owner_role==='finance'&&!financeHolder(db,u))fail(403,'not_permitted',`«${DOCUMENT_BY_KEY.get(doc.doc_key).name}» تسجّلها المالية. لا يعلن أحد نيابةً عنها أنها أكدت`);
  if(doc.owner_id&&doc.owner_id!==u.id&&!can(db,u,'intake.handover'))fail(403,'not_permitted',`«${DOCUMENT_BY_KEY.get(doc.doc_key).name}» يقدّمها ${ownerLabel(db,u.tenant_id,doc)}`);
  const time=now();
  let reference,pricingSheetId=null;
  if(doc.doc_key==='approved_pricing'){
    // المرجع لا يُكتب هنا: يُشتق من الورقة نفسها، فلا يتعارض نصٌّ مع مصدره.
    const {sheet,seats}=approvedPricingSheet(db,u.tenant_id,handover.client_id,input.pricing_sheet_id,receipt.project_id);
    if(input.reference!==undefined&&input.reference!=='')fail(400,'invalid_fields','مرجع هذه الوثيقة يُقرأ من ورقة التسعير المعتمدة ولا يُكتب');
    pricingSheetId=sheet.id;
    reference=`ورقة التسعير ${sheet.code} — ${sheet.name} · معتمدة في ${String(sheet.decided_at).slice(0,10)} · المقاعد المعتمِدة: ${seats.length}`;
  }else{
    reference=v.text(input.reference,'مرجع الوثيقة ومكان حفظ أصلها',600,3);
    if(input.pricing_sheet_id!==undefined&&input.pricing_sheet_id!=='')fail(400,'invalid_fields','ورقة التسعير تخص وثيقة «ملف تسعير المشروع المعتمد ماليًا» وحدها');
  }
  let amount=null,confirmed=null;
  if(doc.doc_key==='advance_confirmation'){
    // المبلغ لا يُكتب: يُقرأ من فاتورة دفعة مقدمة مؤكَّدة (advance_invoices.status='paid'، ترحيل 116)،
    // وهي التي مرّت بـconfirmAdvance بفصل تفويضاته. (تسوية يدوية عند الدمج، 20 سبتمبر.)
    if(input.amount!==undefined&&input.amount!=='')fail(400,'invalid_fields','مبلغ الدفعة المقدمة يُقرأ من القبض المؤكد ولا يُكتب هنا');
    const state=advanceGate(db,u.tenant_id,receipt.project_id);
    const paid=state.advances.filter(a=>a.status==='paid');
    if(!paid.length)fail(409,'advance_not_confirmed','لا قبض دفعة مقدمة مؤكَّدًا على هذا المشروع. تُسجَّل الفاتورة ويؤكدها القبض في «جاهزية البدء»، ثم تُسجَّل هنا');
    amount=state.confirmed_minor;
    confirmed=paid.map(a=>a.received_on).filter(Boolean).sort().at(-1)??today();
    if(amount>handover.contract_value_minor)fail(400,'amount','المبلغ المؤكد أكبر من قيمة العقد');
  }else if(input.amount!==undefined&&input.amount!==''||input.confirmed_on)fail(400,'invalid_fields','المبلغ وتاريخ التأكيد لتأكيد الدفعة المقدمة وحده');
  db.prepare("UPDATE receipt_documents SET status='present',reference=?,pricing_sheet_id=?,amount_minor=?,confirmed_on=?,provided_by=?,provided_at=?,reopened_reason='',version=version+1 WHERE id=? AND version=?")
    .run(reference,pricingSheetId,amount,confirmed,u.id,time,doc.id,doc.version);
  db.prepare('UPDATE project_receipts SET version=version+1,updated_at=? WHERE id=?').run(time,receipt.id);
  audit(db,u,'project_receipt',receipt.id,'intake.document_provided',{doc_key:doc.doc_key,status:'missing'},{doc_key:doc.doc_key,status:'present',amount_minor:amount,pricing_sheet_id:pricingSheetId},reference);
  return executionGate(db,u,receipt.project_id,'paid_execution');
}

export const liveGateReading=(db,tenantId)=>
  db.prepare('SELECT * FROM project_intake_settings WHERE tenant_id=? AND superseded_at IS NULL ORDER BY created_at DESC,id LIMIT 1').get(tenantId)??null;

export function setGateReading(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['gate_reading','basis','confirmed_on']);
  if(!can(db,u,'intake.policy.approve'))fail(403,'not_permitted','قراءة البوابة يقررها مالك الإجراء، لا أي عضو في المشروع');
  if(!GATE_READINGS.some(r=>r.key===input.gate_reading))fail(400,'gate_reading','القراءة غير معروفة');
  const basis=v.text(input.basis,'سند القراءة: من أقرّها ومتى وأي المصدرين رجّح',2000,10),confirmed=v.date(input.confirmed_on);
  if(confirmed>today())fail(400,'confirmed_on','تاريخ الإقرار لا يكون في المستقبل');
  const previous=liveGateReading(db,u.tenant_id),time=now();
  if(previous)db.prepare('UPDATE project_intake_settings SET superseded_at=? WHERE id=?').run(time,previous.id);
  const settingId=id();
  db.prepare('INSERT INTO project_intake_settings(id,tenant_id,gate_reading,basis,confirmed_on,set_by,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(settingId,u.tenant_id,input.gate_reading,basis,confirmed,u.id,time);
  audit(db,u,'project_intake_setting',settingId,'intake.gate_reading_set',previous?{gate_reading:previous.gate_reading}:{},{gate_reading:input.gate_reading},basis);
  return {id:settingId,gate_reading:input.gate_reading};
}

// البوابة. تُقرأ بلا كتابة، وتُستدعى من شاشة الاستلام ومن إسناد مهام المشروع وتطبيق القوالب.
export function executionGate(db,supplied,projectId,intent='paid_execution'){
  const u=actor(db,supplied),project=projectAccess(db,u,projectId);
  if(!['scoping','paid_execution'].includes(intent))fail(400,'intent','النية: تحديد ودراسة، أو تنفيذ مدفوع');
  const setting=liveGateReading(db,u.tenant_id),reading=setting?.gate_reading??GATE_CONFLICT.default;
  const receipt=db.prepare('SELECT * FROM project_receipts WHERE project_id=?').get(project.id)??null;
  const base={project_id:project.id,project_name:project.name,intent,reading,reading_name:GATE_READINGS.find(r=>r.key===reading).name,
    reading_basis:setting?.basis??'لم يقرر أحد بعد؛ تعمل المنصة بالقراءة المانعة افتراضًا وتقول ذلك.',reading_set_by_name:setting?person(db,setting.set_by):'',
    conflict:GATE_CONFLICT,receipt_id:receipt?.id??null,
    scoping_note:'التحديد والدراسة وما قبل البيع لا تمنعه هذه البوابة في أي من القراءتين. الممنوع هو التنفيذ المدفوع.'};
  if(!receipt){
    const refusals=[{code:'no_receipt',doc_key:null,document:'استلام المشروع (PM-01)',
      why:'لم يُستلم هذا المشروع بنموذج PM-01 بعد، فلا قائمة وثائق يُقاس عليها.',
      owner:person(db,project.created_by)||'مدير المشروع',owner_role:'project_manager'}];
    return {...base,advance:null,refusals:intent==='scoping'?[]:refusals,advisory:intent==='scoping'?refusals:[],
      allowed:intent==='scoping'||reading==='documents_advisory',blocked:intent==='paid_execution'&&reading==='block_paid_execution',
      execution_started_at:null};
  }
  const handover=handoverOf(db,receipt);
  const docs=db.prepare('SELECT * FROM receipt_documents WHERE receipt_id=?').all(receipt.id);
  const refusals=[];
  for(const doc of DOCUMENTS){
    const row=docs.find(d=>d.doc_key===doc.key);
    if(!row||!row.required||row.status==='present')continue;
    refusals.push({code:'document_missing',doc_key:doc.key,document:doc.name,
      why:row.reopened_reason?`أُعيد فتح هذه الوثيقة: ${row.reopened_reason}`:'لم تُسجَّل في قائمة استلام المشروع.',
      owner:ownerLabel(db,u.tenant_id,row),owner_role:row.owner_role});
  }
  // الدفعة المقدمة تُقرأ من مقبوض حقيقي، لا من رقم يكتبه أحد.
  // كانت البوابة تقرأ receipt_documents.advance_confirmation.amount_minor — مبلغًا يطبعه حامل تفويض مالي.
  // بوابةٌ تُفتح على رقم يعلنه صاحبه ليست بوابة. المصدر الآن advanceGate في app/project-axes.mjs:
  // صف advance_invoices بحالة paid، أي مرّ بـconfirmAdvance بفصل تفويضاته. (تسوية يدوية عند الدمج، 20 سبتمبر.)
  // المبلغ المتوقع من الجدول الواحد للمشروع (P4-CRM-4): جدول الصفقة إن كان لها جدول، وإلا جدول BD-04 لمشروع بلا صفقة.
  // كانت البوابة تقدّم رقم النموذج على جدول الصفقة، فتقرأ جاهزية البدء رقمًا وقائمة الاستلام رقمًا ثانيًا للدفعة نفسها.
  const gateState=advanceGate(db,u.tenant_id,project.id),agreed=agreedAdvance(db,u.tenant_id,project.id);
  const expected=agreed.amount_minor;
  const expectedSource=agreed.source==='case_payment_terms'?'case_payment_terms (جدول الصفقة)':'handover_payment_terms (BD-04)';
  const advance={agreed_minor:expected,expected_source:expectedSource,
    confirmed_minor:gateState.confirmed_minor,shortfall_minor:Math.max(0,expected-gateState.confirmed_minor),
    claimed_on:handover.advance_claimed_on,invoices:gateState.advances,waiver:gateState.waiver,
    source:gateState.source};
  // سطر رفض واحد للدفعة، لا سطران: إن كانت الوثيقة نفسها ناقصة فقد قيل ذلك أعلاه، ولا يُعاد بصيغة ثانية.
  const advanceListed=refusals.some(r=>r.doc_key==='advance_confirmation');
  if(!advanceListed&&expected>0&&gateState.confirmed_minor<expected&&!gateState.waiver)
    refusals.push({code:'advance_short',doc_key:'advance_confirmation',document:DOCUMENT_BY_KEY.get('advance_confirmation').name,
      why:`المقبوض المؤكد ${(gateState.confirmed_minor/100).toFixed(2)} من أصل ${(expected/100).toFixed(2)} ريال، والمصدر ${expectedSource}. التأكيد يكون بقبض مسجَّل ومؤكَّد لا برقم مكتوب.`,
      owner:'المالية',owner_role:'finance'});
  const blocking=intent==='paid_execution'&&reading==='block_paid_execution'&&refusals.length>0;
  return {...base,advance,
    refusals:intent==='scoping'?[]:refusals,
    advisory:intent==='scoping'||reading==='documents_advisory'?refusals:[],
    allowed:!blocking,blocked:blocking,
    execution_started_at:receipt.execution_started_at,
    documents_present:docs.filter(d=>d.status==='present').length,documents_required:docs.filter(d=>d.required).length};
}

// نص الرفض: يسمي كل وثيقة ناقصة ومن يقدّمها. لا «الطلب غير مكتمل».
export const gateMessage=gate=>gate.refusals.map(r=>`${r.document} — ${r.owner}`).join('؛ ');

export function startExecution(db,supplied,receiptId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','basis']);
  const receipt=receiptRow(db,u,receiptId);v.version(input.version,receipt.version);
  if(receipt.status==='executing')fail(409,'already_executing','بدء التنفيذ مسجَّل لهذا المشروع');
  if(u.id!==receipt.received_by)fail(403,'not_permitted',`بدء التنفيذ يسجّله مدير المشروع المستلم: ${person(db,receipt.received_by)}`);
  const gate=executionGate(db,u,receipt.project_id,'paid_execution');
  if(gate.blocked)fail(409,'execution_blocked',`لا يبدأ التنفيذ المدفوع قبل اكتمال ما يلي: ${gateMessage(gate)}`);
  const basis=v.text(input.basis,'سند بدء التنفيذ: على أي أساس بدأ ومتى',2000,10),time=now();
  db.prepare("UPDATE project_receipts SET status='executing',execution_started_at=?,execution_started_by=?,execution_basis=?,version=version+1,updated_at=? WHERE id=? AND version=?")
    .run(time,u.id,basis,time,receipt.id,receipt.version);
  // القراءة الإرشادية لا تمنع، لكنها لا تمحو الناقص: ما كان ناقصًا وقت البدء يبقى في السجل.
  audit(db,u,'project_receipt',receipt.id,'intake.execution_started',{status:'open'},{status:'executing',reading:gate.reading,missing:gate.advisory.map(r=>r.doc_key)},basis);
  return {id:receipt.id,status:'executing',started_with_missing:gate.advisory.map(r=>r.document)};
}

/* ───── جولات المراجعة لكل مخرج ───── */

function deliverableRow(db,u,deliverableId){
  const row=typeof deliverableId==='string'&&db.prepare('SELECT * FROM project_deliverables WHERE id=? AND tenant_id=?').get(deliverableId,u.tenant_id);
  if(!row)fail(404,'not_found','المخرج غير متاح');
  const handover=db.prepare('SELECT * FROM project_handovers WHERE id=?').get(row.handover_id);
  projectAccess(db,u,handover.project_id);
  return {row,handover};
}
const roundsOf=(db,deliverableId)=>db.prepare('SELECT * FROM deliverable_rounds WHERE deliverable_id=? ORDER BY round_number').all(deliverableId);

export function confirmRounds(db,supplied,deliverableId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['version','revision_rounds','basis']);
  const {row,handover}=deliverableRow(db,u,deliverableId);v.version(input.version,row.version);
  if(u.id!==handover.project_manager_id&&!can(db,u,'intake.handover'))fail(403,'not_permitted',`تأكيد جولات المخرج من العقد لمدير المشروع المسند: ${person(db,handover.project_manager_id)}`);
  const rounds=integer(input.revision_rounds,'جولات المراجعة كما في العقد',0,20);
  const used=roundsOf(db,row.id).length;
  if(rounds<used)fail(409,'rounds_already_used',`سُجلت ${used} جولة على هذا المخرج، فلا يُثبَّت العقد على ${rounds}`);
  const basis=v.text(input.basis,'بند العقد الذي يحدد جولات هذا المخرج',500,5),time=now();
  db.prepare("UPDATE project_deliverables SET revision_rounds=?,rounds_source='contract',rounds_basis=?,rounds_confirmed_by=?,rounds_confirmed_at=?,version=version+1 WHERE id=? AND version=?")
    .run(rounds,basis,u.id,time,row.id,row.version);
  audit(db,u,'project_deliverable',row.id,'intake.rounds_confirmed',{revision_rounds:row.revision_rounds,rounds_source:row.rounds_source},{revision_rounds:rounds,rounds_source:'contract'},basis);
  return {id:row.id,revision_rounds:rounds,rounds_source:'contract'};
}

export function recordRound(db,supplied,deliverableId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['item_reference','note','change_request_id']);
  const {row,handover}=deliverableRow(db,u,deliverableId);
  const used=roundsOf(db,row.id),next=used.length+1,reference=v.text(input.item_reference,'مرجع النسخة التي جرت عليها الجولة',300,3);
  const included=next<=row.revision_rounds;
  if(!included&&row.rounds_source==='template_default'&&!row.rounds_confirmed_by)
    fail(409,'rounds_unconfirmed',`عدد جولات «${row.name}» (${row.revision_rounds}) افتراضي قالب لم يؤكده أحد من العقد، فلا تُحتسب الجولة ${next} إضافية على أساسه. أكّد العدد من بند العقد أولًا`);
  let changeId=null;
  if(!included){
    // الجولة التي تتجاوز العقد لا تُسجَّل بلا طلب تغيير مطبَّق: هذا هو منع العمل الإضافي الصامت.
    const change=typeof input.change_request_id==='string'&&db.prepare("SELECT * FROM project_change_requests WHERE id=? AND tenant_id=? AND deliverable_id=? AND status='applied'").get(input.change_request_id,u.tenant_id,row.id);
    if(!change)fail(409,'extra_round_requires_change',`الجولة ${next} تتجاوز جولات العقد لهذا المخرج (${row.revision_rounds}). ارفع طلب تغيير بجولة إضافية مسعّرة قبل العمل`);
    changeId=change.id;
  }
  const roundId=id(),time=now();
  db.prepare('INSERT INTO deliverable_rounds(id,deliverable_id,round_number,kind,item_reference,note,change_request_id,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(roundId,row.id,next,included?'included':'extra',reference,input.note?v.text(input.note,'ملاحظة الجولة',2000):'',changeId,u.id,time);
  audit(db,u,'project_deliverable',row.id,'intake.round_recorded',{},{round_number:next,kind:included?'included':'extra',change_request_id:changeId,project_id:handover.project_id},reference);
  return {id:roundId,round_number:next,kind:included?'included':'extra',remaining:Math.max(0,row.revision_rounds-next)};
}

/* ───── PM-02: محضر الانطلاق ───── */

export function recordKickoff(db,supplied,receiptId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['held_on','mode','client_contact_name','attendees','agreed_scope','deliverables_note','milestones','revision_rounds_note','recurring_meetings','approval_policy','client_response_days','official_channel','special_constraints','revision_policy','written_changes_only','delay_policy','publication_policy','cancellation_policy','client_acknowledgement']);
  const receipt=receiptRow(db,u,receiptId),handover=handoverOf(db,receipt);
  if(u.id!==receipt.received_by&&u.id!==handover.project_manager_id)fail(403,'not_permitted',`محضر الانطلاق يسجّله مدير المشروع المستلم: ${person(db,receipt.received_by)}`);
  if(db.prepare('SELECT 1 FROM project_kickoffs WHERE receipt_id=?').get(receipt.id))fail(409,'kickoff_exists','لهذا المشروع محضر انطلاق مسجَّل. تصحيحه بطلب تغيير');
  const held=v.date(input.held_on);
  if(held>today())fail(400,'held_on','تاريخ الاجتماع لا يكون في المستقبل');
  if(!Object.hasOwn(MEETING_MODES,input.mode))fail(400,'mode','طريقة الاجتماع: حضوري أو أونلاين أو هجين');
  // «طلب التعديلات كتابيًا فقط» بند يوضَّح للعميل في المحضر؛ إقراره صريح ولا يُفترض.
  if(typeof input.written_changes_only!=='boolean')fail(400,'written_changes_only','أقرّ صراحةً: هل وُضّح للعميل أن طلب التعديلات كتابي فقط؟');
  if(!Array.isArray(input.attendees)||input.attendees.length<2||input.attendees.length>40)fail(400,'attendees','الحضور من شخصين إلى أربعين، من الطرفين');
  const company=db.prepare('SELECT name FROM tenants WHERE id=?').get(u.tenant_id)?.name??'الشركة';
  const clientName=db.prepare('SELECT trade_name,legal_name FROM clients WHERE id=?').get(handover.client_id);
  const attendees=input.attendees.map(a=>{
    v.object(a,['side','user_id','name','title','organisation','attended']);
    if(!['company','client'].includes(a.side))fail(400,'attendees','الجهة: الشركة أو العميل');
    // حضور الشركة يُختار من دليل المنصة فيأتي باسمه ودوره من السجل، لا بنص يكتبه أحد.
    if(a.side==='company'){
      const row=db.prepare('SELECT id,name,role FROM users WHERE id=? AND tenant_id=? AND active=1').get(a.user_id,u.tenant_id);
      if(!row)fail(400,'attendees','حاضر من جهة الشركة يُختار من دليل المنصة، ويجب أن يكون حسابًا نشطًا');
      return {side:'company',user_id:row.id,name:row.name,title:a.title?v.text(a.title,'الصفة',180):'',
        organisation:company,attendee_role:row.role,attended:a.attended===false?0:1};
    }
    // العميل لا يدخل المنصة ولا يُنشأ له حساب: اسم وصفة وجهة.
    if(a.user_id)fail(400,'attendees','حاضر العميل اسم وصفة وجهة؛ لا حساب له في المنصة');
    return {side:'client',user_id:null,name:v.text(a.name,'اسم الحاضر',180,2),title:a.title?v.text(a.title,'الصفة',180):'',
      organisation:a.organisation?v.text(a.organisation,'جهة الحاضر',180,2):(clientName?.trade_name||clientName?.legal_name||''),
      attendee_role:'',attended:a.attended===false?0:1};
  });
  if(attendees.some(a=>a.side==='client'&&a.organisation.trim().length<2))fail(400,'attendees','اكتب جهة كل حاضر من طرف العميل');
  if(!attendees.some(a=>a.side==='client'&&a.attended))fail(400,'attendees','محضر انطلاق بلا حاضر واحد من العميل ليس محضر انطلاق');
  if(!Array.isArray(input.milestones)||!input.milestones.length||input.milestones.length>40)fail(400,'milestones','أدخل محطة متفقًا عليها واحدة إلى أربعين');
  const milestones=input.milestones.map(m=>{v.object(m,['name','due_on']);return {name:v.text(m.name,'اسم المحطة',180,2),due_on:v.date(m.due_on)};});
  const text=(key,label,min=10)=>v.text(input[key],label,3000,min);
  const kickoffId=id(),time=now();
  db.prepare(`INSERT INTO project_kickoffs(id,tenant_id,receipt_id,held_on,mode,client_contact_name,agreed_scope,deliverables_note,milestones,revision_rounds_note,recurring_meetings,approval_policy,client_response_days,official_channel,special_constraints,revision_policy,written_changes_only,delay_policy,publication_policy,cancellation_policy,client_acknowledgement,recorded_by,recorder_role,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(kickoffId,u.tenant_id,receipt.id,held,input.mode,v.text(input.client_contact_name,'جهة التواصل لدى العميل',180,2),
      text('agreed_scope','نطاق العمل النهائي'),text('deliverables_note','المخرجات كما أُقرّت في الاجتماع'),JSON.stringify(milestones),
      text('revision_rounds_note','عدد جولات التعديل كما أُقرّت',5),text('recurring_meetings','موعد ومنهجية اجتماعات المتابعة',5),
      text('approval_policy','سياسة الموافقة على المخرجات'),
      integer(input.client_response_days,'مدة رد العميل بالأيام',1,30),text('official_channel','قناة التواصل الرسمية',3),
      input.special_constraints?v.text(input.special_constraints,'متطلبات أو قيود خاصة',3000):'',
      text('revision_policy','سياسة التعديلات داخل النطاق وخارجه'),input.written_changes_only?1:0,
      text('delay_policy','سياسة تأخر التسليم من جانب العميل'),text('publication_policy','سياسة الموافقة قبل النشر'),
      text('cancellation_policy','سياسة الإلغاء والغرامات حسب العقد'),
      input.client_acknowledgement?v.text(input.client_acknowledgement,'كيف أكّد العميل المحضر وأين حُفظ دليله',600,5):'',
      u.id,u.role,time);
  for(const a of attendees)
    db.prepare('INSERT INTO kickoff_attendees(id,kickoff_id,side,user_id,name,title,organisation,attendee_role,attended) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id(),kickoffId,a.side,a.user_id,a.name,a.title,a.organisation,a.attendee_role,a.attended);
  // المحضر هو نفسه البند الثالث في قائمة PM-01 «محضر Kick-off مع العميل إن وجد»: يُملأ من مصدره لا يدويًا مرة ثانية.
  const doc=db.prepare("SELECT * FROM receipt_documents WHERE receipt_id=? AND doc_key='kickoff_minutes'").get(receipt.id);
  if(doc&&doc.status!=='present')
    db.prepare("UPDATE receipt_documents SET status='present',reference=?,provided_by=?,provided_at=?,reopened_reason='',version=version+1 WHERE id=? AND version=?")
      .run(`محضر اجتماع الانطلاق المسجَّل في المنصة بتاريخ ${held}`,u.id,time,doc.id,doc.version);
  linkForm(db,u,'kickoff',kickoffId,receipt.project_id);
  audit(db,u,'project_kickoff',kickoffId,'intake.kickoff_recorded',{},{receipt_id:receipt.id,held_on:held,mode:input.mode,attendees:attendees.length});
  return {id:kickoffId};
}

/* ───── PM-03: طلب التغيير ───── */

// ما يعيد طلبُ التغيير فتحَه من اعتمادات الاستلام. مذكور صراحةً ليُقرأ: «أُعيد فتح التسعير وحده» جملة لها أثر.
function reopenPlan(row){
  const plan=new Map();
  if(row.budget_impact===1)plan.set('approved_pricing','تغيّرت القيمة، فاعتماد المالية للتسعير السابق لم يعد ساريًا');
  if(row.added_rounds>0||row.added_quantity>0)plan.set('creative_brief','تغيّر المخرج المعتمد من العميل');
  if(row.classification==='scope_change'){
    plan.set('signed_contract','تغيير نطاق حقيقي يحتاج ملحق عقد موقّعًا');
    plan.set('creative_brief','تغيير نطاق حقيقي يحتاج ملخصًا إبداعيًا معتمدًا من العميل');
  }
  return plan;
}
// من يجب أن يوافق قبل التنفيذ. التغيير داخل النطاق وتصحيح خطئنا لا ينتظران موافقة العميل ولا تسعيرًا.
const requiredApprovals=row=>({finance:row.budget_impact===1,client:row.budget_impact===1||row.classification==='scope_change'});

function changeRow(db,u,changeId){
  const row=typeof changeId==='string'&&db.prepare('SELECT * FROM project_change_requests WHERE id=? AND tenant_id=?').get(changeId,u.tenant_id);
  if(!row)fail(404,'not_found','طلب التغيير غير متاح');
  const receipt=db.prepare('SELECT * FROM project_receipts WHERE id=?').get(row.receipt_id);
  projectAccess(db,u,receipt.project_id);
  return {row,receipt};
}

export function raiseChange(db,supplied,receiptId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['description','reason','deliverable_id','classification','free_rounds_exhausted','schedule_impact_days','extra_cost','added_rounds','added_quantity','quotation_reference']);
  const receipt=receiptRow(db,u,receiptId),handover=handoverOf(db,receipt);
  if(!CLASSIFICATION_BY_KEY.has(input.classification))fail(400,'classification','اختر أحد التصنيفات الأربعة');
  const classification=input.classification;
  let deliverable=null,roundNumber=null;
  if(input.deliverable_id){
    deliverable=db.prepare('SELECT * FROM project_deliverables WHERE id=? AND handover_id=?').get(input.deliverable_id,handover.id);
    if(!deliverable)fail(400,'deliverable_id','المخرج ليس من مخرجات هذا المشروع');
  }
  if(classification==='extra_round'&&!deliverable)fail(400,'deliverable_id','الجولة الإضافية تخص مخرجًا بعينه؛ حدّده');

  // «هل استُنفدت الجولات المجانية» ليست خانة يملؤها الرأي: المنصة تعرف الجواب من سجل الجولات، وتردّ الادعاء المخالف.
  let exhausted=0;
  if(deliverable){
    const used=roundsOf(db,deliverable.id).length;
    roundNumber=used+1;
    exhausted=used>=deliverable.revision_rounds?1:0;
    const claimed=input.free_rounds_exhausted===true?1:0;
    if(claimed!==exhausted)fail(409,'rounds_mismatch',`سجل الجولات يقول غير ذلك: سُجلت ${used} جولة من ${deliverable.revision_rounds} على «${deliverable.name}»، فالجولات المجانية ${exhausted?'مستنفدة':'غير مستنفدة'}`);
    if(deliverable.rounds_source==='template_default'&&!deliverable.rounds_confirmed_by&&exhausted)
      fail(409,'rounds_unconfirmed',`عدد جولات «${deliverable.name}» افتراضي قالب لم يؤكده أحد من العقد؛ لا يُبنى عليه استنفاد`);
  }else if(input.free_rounds_exhausted===true)fail(400,'free_rounds_exhausted','استنفاد الجولات يُقاس على مخرج بعينه؛ حدّد المخرج');

  const extra=input.extra_cost===undefined||input.extra_cost===''?0:money(input.extra_cost);
  const addedRounds=input.added_rounds===undefined||input.added_rounds===''?0:integer(input.added_rounds,'الجولات المضافة',0,20);
  const addedQuantity=input.added_quantity===undefined||input.added_quantity===''?0:integer(input.added_quantity,'الكمية المضافة',0,1000);
  // القاعدة الصريحة: لا يُحمَّل العميل تكلفة خطئنا، ولا آليًا ولا بإدخال يدوي يمر بلا اعتراض.
  if(classification==='our_error'&&(extra>0||input.quotation_reference))fail(409,'no_charge_for_our_error','تصحيح خطأ من عندنا لا يُسعَّر على العميل. إن كان العمل مدفوعًا فتصنيفه ليس «خطأ من عندنا»');
  if(classification==='in_scope'&&extra>0)fail(409,'in_scope_is_not_priced','تغيير داخل النطاق لا يحمل تكلفة إضافية. إن كان مدفوعًا فهو جولة إضافية أو تغيير نطاق');
  if(classification==='extra_round'&&exhausted&&!(extra>0))fail(409,'quotation_required','استُنفدت جولات هذا المخرج. الجولة الإضافية ترفع عرضًا مسعّرًا قبل العمل، لا عملًا صامتًا');
  if(extra>0&&!(typeof input.quotation_reference==='string'&&input.quotation_reference.trim().length>=3))fail(400,'quotation_reference','اكتب مرجع العرض المسعّر الذي يقابل هذه التكلفة');
  if(classification==='extra_round'&&addedRounds<1)fail(400,'added_rounds','الجولة الإضافية تضيف جولة واحدة على الأقل إلى رصيد المخرج');
  if(addedQuantity>0&&classification!=='scope_change')fail(400,'added_quantity','زيادة الكمية تغيير نطاق، لا جولة');
  const schedule=input.schedule_impact_days===undefined||input.schedule_impact_days===''?0:integer(input.schedule_impact_days,'أثر الجدول الزمني بالأيام',-365,365);

  const number=db.prepare('SELECT COUNT(*) AS n FROM project_change_requests WHERE receipt_id=?').get(receipt.id).n+1;
  const changeId=id(),time=now();
  db.prepare(`INSERT INTO project_change_requests(id,tenant_id,receipt_id,number,description,reason,deliverable_id,round_number,classification,free_rounds_exhausted,schedule_impact_days,budget_impact,extra_cost_minor,added_rounds,added_quantity,quotation_reference,status,raised_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'raised',?,?,?)`)
    .run(changeId,u.tenant_id,receipt.id,number,v.text(input.description,'وصف التغيير المطلوب',3000,10),v.text(input.reason,'سبب التغيير',2000,10),
      deliverable?.id??null,classification==='extra_round'?roundNumber:null,classification,exhausted,schedule,extra>0?1:0,extra,addedRounds,addedQuantity,
      extra>0?v.text(input.quotation_reference,'مرجع العرض المسعّر',500,3):'',u.id,time,time);
  linkForm(db,u,'change_request',changeId,receipt.project_id);
  audit(db,u,'project_change_request',changeId,'intake.change_raised',{},{receipt_id:receipt.id,number,classification,extra_cost_minor:extra,free_rounds_exhausted:exhausted});
  return {id:changeId,number,classification,free_rounds_exhausted:!!exhausted,
    needs:requiredApprovals({budget_impact:extra>0?1:0,classification}),
    will_reopen:[...reopenPlan({budget_impact:extra>0?1:0,classification,added_rounds:addedRounds,added_quantity:addedQuantity}).keys()]};
}

export function changeAction(db,supplied,changeId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields={decide_finance:['decision','note'],record_client_approval:['reference','approved_on'],apply_change:['start_date','note'],decline_change:['note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const {row,receipt}=changeRow(db,u,changeId);v.version(input.version,row.version);
  if(['applied','declined'].includes(row.status))fail(409,'change_settled','طلب التغيير منتهٍ');
  const needs=requiredApprovals(row),time=now();

  if(action==='decide_finance'){
    if(!needs.finance)fail(409,'finance_not_required','هذا الطلب بلا أثر مالي، فلا قرار مالي عليه');
    if(!financeHolder(db,u))fail(403,'not_permitted','القرار المالي لحامل تصريح مالي');
    if(u.id===row.raised_by)fail(403,'separation_of_duties','من رفع الطلب لا يقرّ أثره المالي');
    if(row.finance_decision)fail(409,'already_decided','صدر القرار المالي على هذا الطلب');
    if(!['approved','rejected'].includes(input.decision))fail(400,'decision','القرار: اعتماد أو رفض');
    const note=v.text(input.note,input.decision==='approved'?'أساس الاعتماد المالي':'سبب الرفض المالي',2000,input.decision==='approved'?5:10);
    const status=input.decision==='approved'?'priced':'declined';
    db.prepare('UPDATE project_change_requests SET finance_decision=?,finance_note=?,finance_decided_by=?,finance_decided_at=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=?')
      .run(input.decision,note,u.id,time,status,time,row.id,row.version);
    audit(db,u,'project_change_request',row.id,'intake.change_finance_'+input.decision,{status:row.status},{status},note);
    return {id:row.id,status};
  }
  if(action==='decline_change'){
    const note=v.text(input.note,'سبب الاعتذار عن التغيير وكيف أُبلغ العميل',2000,10);
    db.prepare("UPDATE project_change_requests SET status='declined',version=version+1,updated_at=? WHERE id=? AND version=?").run(time,row.id,row.version);
    audit(db,u,'project_change_request',row.id,'intake.change_declined',{status:row.status},{status:'declined'},note);
    return {id:row.id,status:'declined'};
  }
  if(action==='record_client_approval'){
    if(!needs.client)fail(409,'client_approval_not_required','هذا التغيير لا يحتاج موافقة عميل: لا تكلفة عليه ولا تغيير نطاق');
    if(needs.finance&&row.finance_decision!=='approved')fail(409,'finance_first','موافقة العميل تُطلب على سعر اعتمدته المالية، لا على تقدير');
    if(row.client_approved_on)fail(409,'already_approved','موافقة العميل مسجلة');
    const approved=v.date(input.approved_on);
    if(approved>today())fail(400,'approved_on','تاريخ موافقة العميل لا يكون في المستقبل');
    // لا حساب للعميل في المنصة: الموافقة يوثّقها موظف بمرجع دليلها كما في سجل موافقات العملاء.
    const reference=v.text(input.reference,'من وافق من جهة العميل وأين حُفظ دليل موافقته',600,5);
    db.prepare("UPDATE project_change_requests SET client_approval_reference=?,client_approved_on=?,client_recorded_by=?,status='approved',version=version+1,updated_at=? WHERE id=? AND version=?")
      .run(reference,approved,u.id,time,row.id,row.version);
    audit(db,u,'project_change_request',row.id,'intake.change_client_approved',{status:row.status},{status:'approved'},reference);
    return {id:row.id,status:'approved'};
  }
  // التطبيق: هنا وحده تتغير الميزانية والجدول والمخرجات، وهنا وحده تُعاد الاعتمادات المتأثرة إلى «ناقصة».
  if(u.id!==receipt.received_by)fail(403,'not_permitted',`تطبيق التغيير لمدير المشروع المستلم: ${person(db,receipt.received_by)}`);
  if(needs.finance&&row.finance_decision!=='approved')fail(409,'finance_first','لا يُطبَّق تغيير بتكلفة قبل اعتماد المالية');
  if(needs.client&&!row.client_approved_on)fail(409,'client_approval_first','لا يُطبَّق تغيير مدفوع أو تغيير نطاق قبل موافقة موثقة من العميل');
  const start=v.date(input.start_date),note=v.text(input.note,'ما الذي بدأ فعلًا بهذا التغيير',2000,10);
  // يوم رفع الطلب بتوقيت الرياض: created_at طابع UTC وأول عشرة أحرف منه تسبق يوم الرياض بيوم بين 00:00 و03:00.
  if(start<riyadhDateOf(row.created_at))fail(400,'start_date','تاريخ البدء يسبق رفع طلب التغيير');
  if(row.added_rounds||row.added_quantity){
    const deliverable=db.prepare('SELECT * FROM project_deliverables WHERE id=?').get(row.deliverable_id);
    db.prepare('UPDATE project_deliverables SET revision_rounds=?,quantity=?,version=version+1 WHERE id=? AND version=?')
      .run(Math.min(20,deliverable.revision_rounds+row.added_rounds),Math.min(10000,deliverable.quantity+row.added_quantity),deliverable.id,deliverable.version);
  }
  const plan=reopenPlan(row);let reopened=0;
  for(const [docKey,reason] of plan){
    const doc=db.prepare('SELECT * FROM receipt_documents WHERE receipt_id=? AND doc_key=?').get(receipt.id,docKey);
    if(!doc)continue;
    db.prepare('INSERT OR IGNORE INTO change_request_reopenings(id,change_request_id,doc_key,reason,created_at) VALUES(?,?,?,?,?)').run(id(),row.id,docKey,reason,time);
    if(doc.status!=='present')continue;
    db.prepare("UPDATE receipt_documents SET status='missing',reference='',amount_minor=NULL,confirmed_on=NULL,provided_by=NULL,provided_at=NULL,reopened_reason=?,version=version+1 WHERE id=? AND version=?")
      .run(reason,doc.id,doc.version);
    reopened++;
  }
  // اعتماد إلكتروني بديل «توقيع مدير المشروع» في PM-03: الهوية والدور ونسخة السجل والوقت، وسلسلة التدقيق تحفظ الباقي.
  db.prepare("UPDATE project_change_requests SET status='applied',start_date=?,applied_by=?,applied_role=?,applied_record_version=?,applied_at=?,version=version+1,updated_at=? WHERE id=? AND version=?")
    .run(start,u.id,u.role,row.version,time,time,row.id,row.version);
  db.prepare('UPDATE project_receipts SET version=version+1,updated_at=? WHERE id=?').run(time,receipt.id);
  audit(db,u,'project_change_request',row.id,'intake.change_applied',{status:row.status},{status:'applied',start_date:start,role:u.role,record_version:row.version,reopened:[...plan.keys()],extra_cost_minor:row.extra_cost_minor,schedule_impact_days:row.schedule_impact_days},note);
  return {id:row.id,status:'applied',reopened_documents:[...plan.keys()],reopened_count:reopened};
}

/* ───── سياسة تصنيف التغيير: مسودة حتى تُعتمد ───── */

export const liveClassificationPolicy=(db,tenantId)=>db.prepare("SELECT * FROM change_classification_policies WHERE tenant_id=? AND status='approved' ORDER BY decided_at DESC,id LIMIT 1").get(tenantId)??null;

export function prepareClassificationPolicy(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['rules','basis']);
  if(!can(db,u,'intake.handover')&&!can(db,u,'intake.policy.approve'))fail(403,'not_permitted','إعداد سياسة التصنيف لمن يعمل في سلسلة الاستلام');
  if(!Array.isArray(input.rules)||input.rules.length!==CLASSIFICATIONS.length)fail(400,'rules','السياسة تغطي التصنيفات الأربعة كلها');
  const seen=new Set();
  const rules=input.rules.map(r=>{
    v.object(r,['classification','test','examples']);
    if(!CLASSIFICATION_BY_KEY.has(r.classification)||seen.has(r.classification))fail(400,'rules','تصنيف غير معروف أو مكرر');
    seen.add(r.classification);
    return {classification:r.classification,test:v.text(r.test,'الاختبار الذي يميّز هذا التصنيف عن غيره',2000,10),examples:v.text(r.examples,'مثالان من عمل الشركة',2000,10)};
  });
  if(db.prepare("SELECT 1 FROM change_classification_policies WHERE tenant_id=? AND status='draft'").get(u.tenant_id))fail(409,'draft_exists','توجد مسودة سياسة بانتظار الاعتماد');
  const policyId=id();
  db.prepare("INSERT INTO change_classification_policies(id,tenant_id,rules,basis,status,prepared_by,created_at) VALUES(?,?,?,?,'draft',?,?)")
    .run(policyId,u.tenant_id,JSON.stringify(rules),v.text(input.basis,'من أعدّ السياسة وعلى أي أساس',2000,10),u.id,now());
  audit(db,u,'change_classification_policy',policyId,'intake.policy_prepared',{},{status:'draft'});
  return {id:policyId,status:'draft'};
}

export function decideClassificationPolicy(db,supplied,policyId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['decision','note']);
  if(!can(db,u,'intake.policy.approve'))fail(403,'not_permitted','اعتماد سياسة التصنيف لمالك الإجراء');
  const row=typeof policyId==='string'&&db.prepare("SELECT * FROM change_classification_policies WHERE id=? AND tenant_id=? AND status='draft'").get(policyId,u.tenant_id);
  if(!row)fail(404,'not_found','المسودة غير متاحة');
  if(row.prepared_by===u.id)fail(403,'separation_of_duties','من أعدّ السياسة لا يعتمدها');
  if(!['approved','rejected'].includes(input.decision))fail(400,'decision','القرار: اعتماد أو رفض');
  const note=v.text(input.note,'أساس القرار',2000,input.decision==='approved'?5:10),time=now();
  if(input.decision==='approved')db.prepare("UPDATE change_classification_policies SET status='superseded' WHERE tenant_id=? AND status='approved'").run(u.tenant_id);
  db.prepare('UPDATE change_classification_policies SET status=?,approved_by=?,decision_note=?,decided_at=? WHERE id=?').run(input.decision,u.id,note,time,row.id);
  audit(db,u,'change_classification_policy',row.id,'intake.policy_'+input.decision,{status:'draft'},{status:input.decision},note);
  return {id:row.id,status:input.decision};
}

/* ───── قراءات تستعملها وحدات أخرى ───── */

// ملخص رخيص لشاشة المشاريع وحارس إسناد المهام. قراءة صرفة بلا استدعاء البوابة الكاملة.
export function intakeSummary(db,tenantId,projectId){
  const receipt=db.prepare('SELECT * FROM project_receipts WHERE project_id=?').get(projectId);
  if(!receipt)return {stage:'no_handover',receipt_id:null,blocked:false,missing:[]};
  const setting=db.prepare('SELECT gate_reading FROM project_intake_settings WHERE tenant_id=? AND superseded_at IS NULL ORDER BY created_at DESC,id LIMIT 1').get(tenantId);
  const reading=setting?.gate_reading??GATE_CONFLICT.default;
  const missing=db.prepare("SELECT doc_key,owner_role,owner_id FROM receipt_documents WHERE receipt_id=? AND required=1 AND status='missing'").all(receipt.id);
  const handover=db.prepare('SELECT advance_minor,prepared_by FROM project_handovers WHERE id=?').get(receipt.handover_id);
  // الدفعة المقدمة من مصدرها الواحد: قبضٌ مؤكَّد، لا رقم مكتوب في خانة الوثيقة.
  const state=advanceGate(db,tenantId,projectId);
  const expected=handover.advance_minor>0?handover.advance_minor:state.expected_minor;
  const short=expected>0&&state.confirmed_minor<expected&&!state.waiver;
  const outstanding=missing.map(m=>({doc_key:m.doc_key,document:DOCUMENT_BY_KEY.get(m.doc_key).name,owner:ownerLabel(db,tenantId,m)}));
  return {stage:receipt.status==='executing'?'executing':'received',receipt_id:receipt.id,reading,
    blocked:reading==='block_paid_execution'&&(outstanding.length>0||short),
    missing:outstanding,advance_short:short};
}

// يُستدعى من حارس إسناد مهام المشروع وتطبيق قوالبه. الرفض يسمي الوثيقة ومن يقدّمها.
export function assertExecutionAllowed(db,tenantId,projectId,what){
  const summary=intakeSummary(db,tenantId,projectId);
  if(!summary.blocked)return summary;
  const named=summary.missing.map(m=>`${m.document} — ${m.owner}`).join('؛ ');
  fail(409,'execution_blocked',`${what} تنفيذٌ مدفوع، ولم يكتمل استلام المشروع (PM-01). الناقص: ${named||'تأكيد المالية لمبلغ الدفعة المقدمة كاملًا'}. التحديد والدراسة غير ممنوعين`);
}

// التزامات سلسلة الاستلام المعلقة باسم شخص، لإخلاء طرف المغادرين (lifecycle.mjs).
export function intakeObligations(db,tenantId,employeeId){
  const rows=[];
  for(const h of db.prepare("SELECT h.id,h.project_id,p.name FROM project_handovers h JOIN projects p ON p.id=h.project_id WHERE h.tenant_id=? AND h.project_manager_id=? AND h.status<>'received'").all(tenantId,employeeId))
    rows.push({source:'project_handover',source_id:h.id,title:`تسليم مشروع باسمه لم يُستلم — ${h.name}`,detail:'نموذج BD-04 ينتظر توقيعه أو استلامه',
      action_owner:'تطوير الأعمال: إعادة إسناد مدير المشروع في نموذج التسليم قبل المغادرة'});
  for(const r of db.prepare("SELECT r.id,p.name FROM project_receipts r JOIN projects p ON p.id=r.project_id WHERE r.tenant_id=? AND r.received_by=?").all(tenantId,employeeId))
    rows.push({source:'project_receipt',source_id:r.id,title:`استلام مشروع باسمه — ${r.name}`,detail:'قائمة PM-01 وبوابة التنفيذ مسجلتان باسمه',
      action_owner:'مدير المشروع البديل: إعادة الاستلام وتوثيق ما سُلِّم'});
  for(const c of db.prepare("SELECT c.id,c.number,p.name FROM project_change_requests c JOIN project_receipts r ON r.id=c.receipt_id JOIN projects p ON p.id=r.project_id WHERE c.tenant_id=? AND c.raised_by=? AND c.status NOT IN ('applied','declined')").all(tenantId,employeeId))
    rows.push({source:'project_change_request',source_id:c.id,title:`طلب تغيير مفتوح رفعه — ${c.name} (رقم ${c.number})`,detail:'ينتظر قرارًا ماليًا أو موافقة عميل أو تطبيقًا',
      action_owner:'مدير المشروع: البت في الطلب أو الاعتذار عنه بسببه'});
  return rows;
}

/* ───── اللوحة ───── */

function deliverableView(db,row){
  const rounds=roundsOf(db,row.id);
  return {...row,rounds,used_rounds:rounds.length,extra_rounds:rounds.filter(r=>r.kind==='extra').length,
    remaining_rounds:Math.max(0,row.revision_rounds-rounds.length),exhausted:rounds.length>=row.revision_rounds,
    rounds_confirmed:!!row.rounds_confirmed_by,rounds_confirmed_by_name:person(db,row.rounds_confirmed_by),
    // التعارض 7 في ملحق المصادر: «جولات التصميم = 2» في DS-03 سجل تعديلات التصميم، بينما بقية النماذج تربط الجولات باتفاق المشروع.
    rounds_note:row.rounds_source==='contract'?`من العقد: ${row.rounds_basis}`
      :`افتراضي قالب (${row.revision_rounds}) مصدره DS-03 سجل تعديلات التصميم، وبقية النماذج تربط الجولات باتفاق المشروع. الرقم ليس سياسة شركة، ولا تُحتسب عليه جولة إضافية قبل تأكيده من العقد.`};
}

// الإثبات الإلكتروني المعروض بدل سطر التوقيع: «اعتمد: الاسم · الدور · التاريخ والوقت».
const ROLE_NAMES={employee:'موظف',manager:'مدير',hr:'موارد بشرية',it:'دعم تقني',pm:'مدير مشروع',admin:'إدارة المنصة'};
const approvalLabel=(name,role,at)=>name?`اعتمد: ${name} · ${ROLE_NAMES[role]??role} · ${at.slice(0,10)} ${at.slice(11,16)}`:'';
// سجل النسخ: سلسلة التدقيق نفسها، معروضة للقراءة. هي الإثبات، ولا يُطبع منها شيء.
const historyOf=(db,tenantId,type,entityId)=>db.prepare('SELECT action,actor_id,created_at,reason FROM audit_events WHERE tenant_id=? AND entity_type=? AND entity_id=? ORDER BY seq').all(tenantId,type,entityId)
  .map(r=>({action:r.action,at:r.created_at,by_name:person(db,r.actor_id),note:r.reason}));

function handoverView(db,u,row,finance){
  const approvals=db.prepare('SELECT * FROM handover_approvals WHERE handover_id=? ORDER BY side').all(row.id)
    .map(a=>({...a,approved_by_name:person(db,a.approved_by),label:approvalLabel(person(db,a.approved_by),a.approver_role,a.approved_at)}));
  const receipt=db.prepare('SELECT * FROM project_receipts WHERE handover_id=?').get(row.id)??null;
  const deliverables=db.prepare('SELECT * FROM project_deliverables WHERE handover_id=? ORDER BY position').all(row.id).map(d=>deliverableView(db,d));
  const changes=receipt?db.prepare('SELECT * FROM project_change_requests WHERE receipt_id=? ORDER BY number').all(receipt.id):[];
  const appliedCost=changes.filter(c=>c.status==='applied').reduce((n,c)=>n+c.extra_cost_minor,0);
  const appliedDays=changes.filter(c=>c.status==='applied').reduce((n,c)=>n+c.schedule_impact_days,0);
  const actions=[];
  if(row.status!=='received'&&[row.prepared_by,row.project_manager_id].includes(u.id)&&!approvals.some(a=>a.approved_by===u.id))actions.push('approve_handover');
  if(row.status==='handed_over'&&u.id===row.project_manager_id)actions.push('receive_handover');
  return {...row,
    // الأرقام المالية لمن يحمل تفويضًا ماليًا أو لطرفي التسليم؛ العضو في المشروع يرى النطاق لا المبالغ.
    contract_value_minor:finance?row.contract_value_minor:null,advance_minor:finance?row.advance_minor:null,
    effective_value_minor:finance?row.contract_value_minor+appliedCost:null,finance_hidden:!finance,
    services:parse(row.services),milestones:parse(row.milestones),client_contacts:parse(row.client_contacts),
    client_name:db.prepare('SELECT trade_name,legal_name FROM clients WHERE id=?').get(row.client_id)?.trade_name||db.prepare('SELECT legal_name FROM clients WHERE id=?').get(row.client_id)?.legal_name||'',
    project_name:db.prepare('SELECT name FROM projects WHERE id=?').get(row.project_id)?.name??'',
    prepared_by_name:person(db,row.prepared_by),project_manager_name:person(db,row.project_manager_id),
    payment_terms:db.prepare('SELECT * FROM handover_payment_terms WHERE handover_id=? ORDER BY position').all(row.id).map(t=>({...t,amount_minor:finance?t.amount_minor:null})),
    deliverables,approvals,receipt_id:receipt?.id??null,
    form:formOf(db,u.tenant_id,'handover',row.id),
    effective_timeline_end:appliedDays?addDays(row.timeline_end,appliedDays):row.timeline_end,schedule_shift_days:appliedDays,
    history:historyOf(db,u.tenant_id,'project_handover',row.id),
    electronic_note:'هذا سجل إلكتروني لا مستند مطبوع: الاعتماد هوية ودور ونسخة سجل ووقت في سلسلة تدقيق، لا صورة توقيع.',
    actions};
}

// مصدر «ملف تسعير المشروع المعتمد ماليًا»: الورقة نفسها بحالتها ومقاعدها، لا نص يُدّعى.
// الأرقام تُحجب عمن لا يحمل تفويضًا ماليًا، كما في بقية هذه الشاشة.
function pricingSourceOf(db,tenantId,row,finance){
  if(!row?.pricing_sheet_id)return row?.status==='present'
    ?{linked:false,note:'سُجِّلت قبل ربط الخانة بورقة التسعير، فمرجعها نصي. إعادة فتحها بطلب تغيير تُسجَّل بربط مباشر.'}
    :{linked:false,note:'تُسجَّل باختيار ورقة تسعير معتمدة، لا بكتابة مرجع.'};
  const sheet=db.prepare('SELECT * FROM pricing_sheets WHERE id=? AND tenant_id=?').get(row.pricing_sheet_id,tenantId);
  if(!sheet)return {linked:false,note:'ورقة التسعير المرتبطة غير متاحة لهذا الكيان.'};
  const seats=db.prepare("SELECT seat,decision,decided_by,decided_at FROM pricing_sheet_approvals WHERE sheet_id=? AND approval_round=? ORDER BY decided_at")
    .all(sheet.id,sheet.approval_round)
    .map(a=>({...a,decided_by_name:person(db,a.decided_by)}));
  return {linked:true,sheet_id:sheet.id,code:sheet.code,name:sheet.name,status:sheet.status,decided_at:sheet.decided_at,
    approval_round:sheet.approval_round,seats,link:'#pricing',
    note:'الاعتماد المالي يُقرأ من ورقة التسعير المعتمدة ومقاعدها، لا من مرجع مكتوب في هذه الخانة.'};
}

function receiptView(db,u,receipt,finance){
  const gate=executionGate(db,u,receipt.project_id,'paid_execution');
  const docs=db.prepare('SELECT * FROM receipt_documents WHERE receipt_id=?').all(receipt.id);
  const kickoff=db.prepare('SELECT * FROM project_kickoffs WHERE receipt_id=?').get(receipt.id)??null;
  const changes=db.prepare('SELECT * FROM project_change_requests WHERE receipt_id=? ORDER BY number DESC').all(receipt.id).map(c=>{
    const needs=requiredApprovals(c),actions=[];
    if(!['applied','declined'].includes(c.status)){
      if(needs.finance&&!c.finance_decision&&financeHolder(db,u)&&c.raised_by!==u.id)actions.push('decide_finance');
      if(needs.client&&!c.client_approved_on&&(!needs.finance||c.finance_decision==='approved'))actions.push('record_client_approval');
      if(u.id===receipt.received_by&&(!needs.finance||c.finance_decision==='approved')&&(!needs.client||c.client_approved_on))actions.push('apply_change');
      actions.push('decline_change');
    }
    return {...c,extra_cost_minor:finance?c.extra_cost_minor:null,
      classification_name:CLASSIFICATION_BY_KEY.get(c.classification).name,classification_meaning:CLASSIFICATION_BY_KEY.get(c.classification).meaning,
      deliverable_name:c.deliverable_id?db.prepare('SELECT name FROM project_deliverables WHERE id=?').get(c.deliverable_id)?.name??'':'',
      raised_by_name:person(db,c.raised_by),finance_decided_by_name:person(db,c.finance_decided_by),client_recorded_by_name:person(db,c.client_recorded_by),
      applied_label:approvalLabel(person(db,c.applied_by),c.applied_role,c.applied_at??''),
      history:historyOf(db,u.tenant_id,'project_change_request',c.id),
      form:formOf(db,u.tenant_id,'change_request',c.id),
      needs,will_reopen:[...reopenPlan(c).keys()],
      reopened:db.prepare('SELECT doc_key,reason FROM change_request_reopenings WHERE change_request_id=?').all(c.id),actions};
  });
  const handover=handoverOf(db,receipt);
  const approvals=db.prepare('SELECT * FROM receipt_approvals WHERE receipt_id=? ORDER BY side').all(receipt.id)
    .map(a=>({...a,approved_by_name:person(db,a.approved_by),label:approvalLabel(person(db,a.approved_by),a.approver_role,a.approved_at)}));
  const actions=[];
  if([handover.prepared_by,receipt.received_by].includes(u.id)&&!approvals.some(a=>a.approved_by===u.id))actions.push('approve_receipt');
  if(receipt.status==='open'&&u.id===receipt.received_by&&!gate.blocked)actions.push('start_execution');
  if(!kickoff&&u.id===receipt.received_by)actions.push('record_kickoff');
  actions.push('raise_change');
  return {...receipt,gate,approvals,
    form:formOf(db,u.tenant_id,'receipt',receipt.id),
    // أوراق التسعير المعتمدة لهذا العميل: منها يُختار «ملف التسعير المعتمد ماليًا»، ولا يُكتب مرجعه نصًا.
    pricing_options:db.prepare("SELECT id,code,name,decided_at FROM pricing_sheets WHERE tenant_id=? AND client_id=? AND status='approved' ORDER BY decided_at DESC")
      .all(u.tenant_id,handover.client_id),
    handing_over_name:person(db,handover.prepared_by),
    electronic_note:'محضر إلكتروني لا مستند مطبوع: الاعتماد هوية ودور وتصريح ونسخة سجل ووقت، في سلسلة تدقيق. لا صورة توقيع ولا سطر توقيع فارغ.',
    history:historyOf(db,u.tenant_id,'project_receipt',receipt.id),
    documents:DOCUMENTS.map(d=>{
      const row=docs.find(x=>x.doc_key===d.key);
      // «ملف التسعير المعتمد ماليًا» يُقرأ من ورقته: حالتها ومقاعدها ورقمها، لا من جملة كتبها أحد.
      const sheet=d.key==='approved_pricing'?pricingSourceOf(db,u.tenant_id,row,finance):null;
      return {...row,name:d.name,owner_name:ownerLabel(db,u.tenant_id,row),owner_role_name:OWNER_ROLES[row.owner_role],
        amount_minor:finance?row.amount_minor:null,provided_by_name:person(db,row.provided_by),
        pricing_source:sheet,
        actions:row.status==='missing'?['provide_document']:[]};
    }),
    kickoff:kickoff?{...kickoff,milestones:parse(kickoff.milestones),mode_name:MEETING_MODES[kickoff.mode],
      form:formOf(db,u.tenant_id,'kickoff',kickoff.id),
      recorded_by_name:person(db,kickoff.recorded_by),
      recorded_label:approvalLabel(person(db,kickoff.recorded_by),kickoff.recorder_role,kickoff.created_at),
      attendees:db.prepare('SELECT * FROM kickoff_attendees WHERE kickoff_id=? ORDER BY side,name').all(kickoff.id)
        .map(a=>({...a,role_name:a.side==='company'?(ROLE_NAMES[a.attendee_role]??a.attendee_role):''})),
      history:historyOf(db,u.tenant_id,'project_kickoff',kickoff.id)}:null,
    changes,received_by_name:person(db,receipt.received_by),execution_started_by_name:person(db,receipt.execution_started_by),actions};
}

export function intakeBoard(db,supplied){
  const u=actor(db,supplied),finance=seesFinance(db,u);
  // أعضاء كل مشروع تحتاجهم الشاشات: مدير المشروع المسند في BD-04، وحضور الشركة في PM-02 يُختارون من الدليل لا بأسمائهم مكتوبة.
  const projects=db.prepare('SELECT p.id,p.name FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.created_at DESC').all(u.tenant_id,u.id)
    .map(p=>({...p,members:db.prepare("SELECT x.id,x.name,x.role FROM project_members m JOIN users x ON x.id=m.user_id WHERE m.project_id=? AND x.active=1 AND x.role<>'admin' ORDER BY x.name").all(p.id)}));
  const ids=projects.map(p=>p.id),marks=ids.map(()=>'?').join(',');
  const handovers=ids.length?db.prepare(`SELECT * FROM project_handovers WHERE tenant_id=? AND project_id IN (${marks}) ORDER BY created_at DESC`).all(u.tenant_id,...ids).map(h=>handoverView(db,u,h,finance)):[];
  const receipts=ids.length?db.prepare(`SELECT * FROM project_receipts WHERE tenant_id=? AND project_id IN (${marks}) ORDER BY created_at DESC`).all(u.tenant_id,...ids).map(r=>receiptView(db,u,r,finance)):[];
  const setting=liveGateReading(db,u.tenant_id),policy=liveClassificationPolicy(db,u.tenant_id);
  const draftPolicy=db.prepare("SELECT * FROM change_classification_policies WHERE tenant_id=? AND status='draft'").get(u.tenant_id)??null;
  return {today:today(),user_id:u.id,finance_hidden:!finance,
    can_hand_over:can(db,u,'intake.handover'),can_set_reading:can(db,u,'intake.policy.approve'),
    projects,documents:DOCUMENTS,owner_roles:OWNER_ROLES,classifications:CLASSIFICATIONS,gate_readings:GATE_READINGS,meeting_modes:MEETING_MODES,
    gate_reading:setting?.gate_reading??GATE_CONFLICT.default,gate_reading_set:!!setting,
    gate_reading_basis:setting?.basis??'',gate_reading_by_name:setting?person(db,setting.set_by):'',
    conflict:GATE_CONFLICT,
    classification_policy:policy?{...policy,rules:parse(policy.rules),approved_by_name:person(db,policy.approved_by)}:null,
    classification_policy_draft:draftPolicy?{...draftPolicy,rules:parse(draftPolicy.rules),prepared_by_name:person(db,draftPolicy.prepared_by),
      actions:can(db,u,'intake.policy.approve')&&draftPolicy.prepared_by!==u.id?['approve_policy','reject_policy']:[]}:null,
    clients:ids.length?db.prepare('SELECT id,legal_name,trade_name FROM clients WHERE tenant_id=? ORDER BY legal_name').all(u.tenant_id)
      .filter(c=>{try{clientFor(db,u,c.id);return true;}catch{return false;}}).map(c=>({id:c.id,name:c.trade_name||c.legal_name})):[],
    handovers,receipts,
    note:'كل ما هنا إلكتروني: لا طباعة ولا صور تواقيع. ما كان في النموذج الورقي سطرَ توقيع صار اعتمادًا إلكترونيًا باسم صاحبه ودوره وتصريحه ونسخة السجل ووقته داخل سلسلة التدقيق. التحديد والدراسة لا تمنعهما هذه البوابة؛ الممنوع هو التنفيذ المدفوع قبل اكتمال وثائق PM-01 السبع الإلزامية وتأكيد المالية للدفعة المقدمة واعتماد المحضر من طرفيه. تصنيف التغيير أربعة لا اثنان، وخطؤنا لا يُسعَّر على العميل. جولات المراجعة تُعدّ لكل مخرج على حدة من عقده، والرقم الافتراضي (DS-03) ليس سياسة شركة حتى يؤكده أحد من العقد.'};
}
