import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can, capabilityName } from './access.mjs';
import { catalog } from './workflow.mjs';
// خيارات المجموعات: مصدر أسماء المستندات الوحيد الذي كتبه إنسان في التعريف (docs[] على الخيار).
// الاستيراد لا يُحدث دورة: workflow.mjs يستورد service-catalog.mjs أصلًا، وservice-catalog لا يعرف هذا الملف.
import { SERVICE_VARIANTS } from './service-catalog.mjs';
import { targetProvenance } from './service-target.mjs';
// مفتاح تفعيل الخدمة (ترحيل 129): وحدة ورقية لا تستورد هذه، فلا دورة.
import { hiddenServiceCodes } from './service-availability.mjs';
import { CONNECTED_SERVICE_MODULES } from './service-outputs.mjs';

// بطاقة الخدمة: نصفها مشتق من تعريف الخدمة كما يعمل فعلًا (الحقول، مسار الاعتماد، الزمن المستهدف، التصعيد)،
// ونصفها يكتبه معدّ الدليل ويعتمده مالك الإجراء المسمى. لا تُعد الخدمة «جاهزة» إلا ببطاقة منشورة مكتملة.
export const KINDS={institutional:'خدمة مؤسسية داخلية',client_work:'عمل يُنفذ لحساب عميل'};
export const CONFIDENTIALITY={internal:'داخلي',restricted:'مقيد — لأصحاب العلاقة',confidential:'سري'};
const STEP_NAMES={manager:'المدير المباشر لصاحب الطلب',department_manager:'مدير الإدارة المالكة',hr:'الموارد البشرية',it:'تقنية المعلومات',executive:'الرئاسة (نائب القطاع أو الرئيس التنفيذي)',member:'أي عضو نشط في الإدارة المنفذة'};
// اسم الخطوة كما يراه الموظف. الخطوة النصية تُعرض كما كانت؛ الكائنية تذكر الإدارة والشرط.
function stepName(db,u,step){
  if(typeof step==='string')return STEP_NAMES[step]??step;
  const department=step.department?db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(step.department,u.tenant_id)?.name??step.department:null;
  let label=step.role==='department_manager'&&department?`مدير ${department}`:(STEP_NAMES[step.role]??step.role)+(department&&step.role!=='department_manager'?` — ${department}`:'');
  if(step.when?.gte_setting)label+=` (إذا بلغ المبلغ حد «${step.when.gte_setting}»)`;
  else if(step.when)label+=` (${step.when.in?'إذا كان':'إلا إذا كان'} ${step.when.field}: ${(step.when.in??step.when.not_in).join('، ')})`;
  return label;
}
// خدمات صار لها شاشة تشغيل كاملة: الطلب يبقى متاحًا، لكن البطاقة توجه الموظف إلى الشاشة التي تنفذ العمل فعلًا.
// كل وحدة هنا مسجلة في operationModules بالواجهة (يتحقق منه اختبار service-cards).
export const SERVICE_MODULES={'ADM-EXPENSE-CLAIM':'expenses','FIN-CUSTODY':'expenses','HR-ATTENDANCE-FIX':'attendance','HR-OVERTIME':'attendance','HR-HIRING-NEED':'people','TAL-TRAINING':'growth','TAL-PERFORMANCE-REVIEW':'performance',
  'DIG-CAMPAIGN':'campaigns','DIG-CAMPAIGN-CLOSE':'campaigns','DIG-SOCIAL-POST':'content','ACC-CHANGE-REQUEST':'scope','CRM-OPPORTUNITY':'commercial','CRM-HANDOVER':'commercial','CRM-PRICING':'commercial',
  'PRC-PURCHASE-REQUEST':'procurement','PRC-EMERGENCY':'procurement-extras','PRC-PO-CHANGE':'procurement-extras','PRC-VENDOR-REGISTRATION':'vendors','PRC-VENDOR-EVALUATION':'vendors','PRC-VENDOR-BANK':'vendors','PMO-TIMESHEET':'time','CRT-DESIGN':'studio','CREATIVE-BRIEF':'studio','PRO-DELIVERY':'studio','DAT-DASHBOARD':'reports','DIG-PERFORMANCE-REPORT':'reports',
  // B8 (تدقيق سير العمل): ربط إلى وحدات مسجلة.
  'HR-BANK-CHANGE':'payroll-extras','HR-SALARY-ADVANCE':'payroll-extras','HR-RETRO-ADJUSTMENT':'payroll-extras','GOV-CONFLICT-DISCLOSURE':'procurement-extras',
  'FIN-PAYMENT-REQUEST':'payables','FIN-CLIENT-INVOICE':'receivables','FIN-REFUND':'invoices','PMO-NEW-PROJECT':'commercial',
  // قرار الانتداب وبدله (م63–65) بدل النموذج العام.
  'ADM-TRAVEL':'travel',
  // خدمات لها وحدة قائمة أصلًا: بطاقة الخدمة تشير إلى الوحدة، وبوابة الإغلاق
  // تتحقق من سجل فعلي فيها عبر service-outputs.mjs.
  ...CONNECTED_SERVICE_MODULES};
// B8: ربط صحيح إلى وحدات لم تُسجَّل بعد في operationModules. تُدمج في SERVICE_MODULES عند تسجيل كل وحدة
// (serviceModulesFor أدناه يفعل ذلك آليًا بمجرد تمرير الوحدات المسجلة). DIG-BUDGET-CHANGE نُقلت من campaigns:
// الحملة لا تُعدَّل بعد التخطيط، وتغيير الميزانية نسخة جديدة من خطة الصرف في media-spend.
export const PENDING_SERVICE_MODULES={'DIG-BUDGET-CHANGE':'media-spend',
  'INF-CAMPAIGN':'influencers','INF-CONTRACT':'influencers','INF-CONTENT-APPROVAL':'influencers','INF-PROOF-PAYMENT':'influencers',
  'PRO-SHOOT':'productions','PRO-LOCATION':'productions','PRO-FREELANCER':'productions','PRO-EQUIPMENT':'equipment',
  'HR-SALARY-CERT':'letters','HR-EXPERIENCE-CERT':'letters','HR-LETTER':'letters','LEG-PRIVACY-REQUEST':'privacy',
  'HR-RESIGNATION':'resignations','IT-NEW-ACCOUNT':'lifecycle','DAT-AI-USE':'ai-governance'};
export const serviceModulesFor=registered=>({...SERVICE_MODULES,...Object.fromEntries(Object.entries(PENDING_SERVICE_MODULES).filter(([,key])=>Object.hasOwn(registered??{},key)))});
// الوحدات الثماني المعلقة صارت كلها مسجلة في operationModules (ربط الوحدات الجديدة)، فالبطاقة تعرض ربطها.
// تُذكر بأسمائها هنا لا بقراءة operationModules، لأن ملفات الواجهة لا تُستورد في الخادم؛
// واختبار service-cards يتحقق أن كل وحدة مربوطة لها شاشة مسجلة، واختبار B8 يتحقق أن القائمتين بقيتا منفصلتين.
const REGISTERED_MODULES=['media-spend','influencers','productions','equipment','letters','privacy','lifecycle','ai-governance','resignations'];
// معالج الخطاب يُفتح بالنوع مختارًا من الخدمات الشبيهة بالخطاب (service-routes.mjs LETTER_WIZARD_LINKS).
const WIZARD_LINKS={'HR-SALARY-CERT':'#letters/new?type=salary','HR-EXPERIENCE-CERT':'#letters/new?type=experience','HR-LETTER':'#letters/new?type=employment'};
const LINKED_MODULES=serviceModulesFor(Object.fromEntries(REGISTERED_MODULES.map(key=>[key,true])));
const MODULE_NAMES={expenses:'المصروفات والعهد',attendance:'الحضور والانصراف',people:'التوظيف والتهيئة',growth:'التدريب والتطوير',performance:'تقييم الأداء',campaigns:'الحملات',content:'تقويم المحتوى',scope:'حارس النطاق',commercial:'المبيعات والعروض',procurement:'المشتريات','procurement-extras':'الطارئ وتعديل الأوامر والتعارض',vendors:'الموردون والتأهيل',time:'ساعاتي وسعة الفريق',studio:'الاستوديو والتسليم',reports:'مركز التقارير',
  'payroll-extras':'السلف والحسابات والفروقات',payables:'المستحقات وأوامر الدفع',receivables:'الاستحقاقات والتحصيل',invoices:'الفواتير والإشعارات الدائنة',
  'media-spend':'خطط الصرف الإعلامي',influencers:'المؤثرون',productions:'الإنتاج والتصوير',equipment:'حجز المعدات',letters:'الخطابات والشهادات',privacy:'حماية البيانات الشخصية',lifecycle:'الانضمام والمغادرة','ai-governance':'حوكمة الذكاء الاصطناعي',resignations:'الاستقالة',travel:'الانتداب',
  'policy-library':'مكتبة السياسات',risks:'سجل المخاطر','hr-cases':'حالات الموظفين',budgets:'موازنات المشاريع','einvoice-selfcheck':'فحص الفوترة الإلكترونية','catalog-quality':'جودة دليل الخدمات','payroll-insurance':'التأمينات الاجتماعية',employees:'بيانات الموظفين','contracts-register':'سجل العقود'};
const CLIENT_WORK=new Set(['accounts','creative','production','marketing','pr','brand','business-dev','campaigns-audit']),RESTRICTED=new Set(['hr','finance','grc','ceo-office']);
const REQUIRED=[['owner_id','مالك إجراء مسمى'],['requesters','من يحق له الطلب'],['trigger_note','محفز البدء'],['outputs','المخرجات'],['acceptance_evidence','أدلة القبول'],['kpis','المؤشرات']];
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);

// مسار الخدمة بجملة واحدة يقرؤها الموظف: من يقرر، ومن ينفّذ، وبأي سند، وهل يجوز أن يكونا شخصًا واحدًا.
// الجواب الأخير ليس تفصيلًا تقنيًا: في 115 طلبًا من 142 نفّذ الطلبَ الحسابُ نفسه الذي اعتمده، فصار
// «هل يجوز أن يكونا واحدًا؟» أهمَّ سطر في البطاقة. مصدره علم `sod` في سياسة الخدمة لا تخمين.
function workflowStatement(db,u,s,escalationName){
  const approves=s.approval_policy.steps.map(k=>stepName(db,u,k));
  const executes=STEP_NAMES[s.approval_policy.handler_role]??s.approval_policy.handler_role;
  const separated=!!s.approval_policy.sod;
  const same=separated
    ?'لا: فصل المهام مُشغَّل على هذه الخدمة، فمن اعتمد أي خطوة فيها لا يستلمها ولا يغلقها. حين لا يبقى في الإدارة المنفذة منفذ غير من اعتمد، يصل الطلبُ نائبًا منفّذًا مسمًّى، فإن لم يوجد فمرجعَ تصعيد الإدارة — ويُكتب سند التنفيذ في شاشة الطلب.'
    :'نعم: فصل المهام غير مُشغَّل على هذه الخدمة، فقد يكون المعتمِد هو المنفّذ نفسه. الجمع لا يُمنع هنا، لكنه يُسجَّل ويظهر في شاشة الطلب وفي فحص الكتالوج.';
  return {approves,executes,
    // سند التنفيذ: من تملك الإدارة المنفذة تنفيذه أصلًا، ثم الاحتياط المسجَّل إن لم يبقَ أحد.
    execution_basis:`منفذو ${s.approval_policy.handler_role==='member'?'الإدارة المنفذة (أي عضو نشط فيها)':executes}، ثم نائب منفّذ مسمًّى مقبول، ثم مرجع تصعيد الإدارة${escalationName?`: ${escalationName}`:' إن كان مسجلًا'}`,
    separation_of_duties:separated,same_person_allowed:!separated,same_person_note:same,
    statement:`يعتمدها: ${approves.join(' ثم ')||'لا خطوة اعتماد — مسار مباشر'}. ينفّذها: ${executes}. هل يكون المعتمِد هو المنفّذ؟ ${same}`};
}
function derived(db,u,s){
  const department=db.prepare('SELECT name,sector FROM departments WHERE id=? AND tenant_id=?').get(s.department_id,u.tenant_id),escalation=db.prepare('SELECT user_id FROM department_escalation WHERE department_id=? AND tenant_id=?').get(s.department_id,u.tenant_id);
  const escalationName=name(db,escalation?.user_id);
  return {code:s.code,name:s.name_ar,description:s.description,department_id:s.department_id,department:department?.name??'',sector:department?.sector??'',section:s.section??'',service_version:s.version,
    inputs:s.fields.map(f=>({label:f.label,type:f.type,required:!!f.required,options:f.options??null})),
    steps:s.approval_policy.steps.map(k=>stepName(db,u,k)),handler:STEP_NAMES[s.approval_policy.handler_role]??s.approval_policy.handler_role,self_approval_blocked:true,
    direct:s.approval_policy.mode==='direct',separation_of_duties:!!s.approval_policy.sod,confidential:!!s.approval_policy.confidential,
    workflow:workflowStatement(db,u,s,escalationName),
    // الرقم ومصدره معًا: «سبعة أيام عمل» وحدها تُقرأ وعدًا، و«مشتق من عائلة رمز الخدمة» تقول من قطعه.
    target:targetProvenance(db,u.tenant_id,s.code,{target_days:s.target_days??0,target_hours:s.target_hours??0}),
    target_days:s.target_days??null,escalates_to:escalationName,
    lifecycle:'مسودة ← مقدَّم ← اعتماد بحسب المسار ← تنفيذ ← مكتمل. يمكن الإرجاع للاستكمال والرفض بسبب، ويلغي صاحب الطلب ما لم يكتمل.',
    clock:'الزمن المستهدف بأيام العمل (الأحد–الخميس دون العطل المعتمدة) من التقديم، وتتوقف ساعته من إرجاع الطلب لصاحبه حتى إعادة تقديمه.',audit:'كل إنشاء وقرار وتحويل وإسناد مسجل في سجل التدقيق باسم صاحبه ووقته.',
    module:LINKED_MODULES[s.code]?{key:LINKED_MODULES[s.code],name:MODULE_NAMES[LINKED_MODULES[s.code]],...(WIZARD_LINKS[s.code]?{link:WIZARD_LINKS[s.code]}:{})}:null};
}
function cardRow(db,u,code,statuses){return db.prepare(`SELECT * FROM service_cards WHERE tenant_id=? AND service_code=? AND status IN (${statuses.map(()=>'?').join(',')}) ORDER BY revision DESC LIMIT 1`).get(u.tenant_id,code,...statuses)??null;}
const missing=card=>!card?REQUIRED.map(([,label])=>label):REQUIRED.filter(([key])=>!String(card[key]??'').trim()).map(([,label])=>label);
function present(db,card){return card?{...card,owner_name:name(db,card.owner_id),prepared_by_name:name(db,card.prepared_by),published_by_name:name(db,card.published_by),kind_name:KINDS[card.service_kind],confidentiality_name:CONFIDENTIALITY[card.confidentiality],
  documents:readDocuments(card),faq_items:readFaq(card),eligibility:readEligibility(card)}:null;}
// ما لم يُكتب بعد من أعمدة الصفحة الأربعة: بسببه ومن يملك كتابته. لا «غير متاح» عارية ولا فراغ صامت.
// يُبنى هنا لا في الشاشة، فالسبب واحدٌ في شاشة البطاقات وفي صفحة الخدمة ولا ينحرف أحدهما عن الآخر.
function contentGaps(db,u,s,card){
  const owner=card?.owner_id?`${name(db,card.owner_id)} — مالك الإجراء`:'مالك الإجراء المسمّى في البطاقة',gaps=[];
  if(!String(card?.short_description??'').trim())gaps.push({key:'short_description',label:'الوصف المختصر',
    why:shortDescriptionFrom(s)?'ما انكتب بعد. يُشتق من أول جملة في وصف الخدمة، والمسودة ما مرّت على الاشتقاق':'ما انكتب بعد. وصف الخدمة ما ينفع مختصرًا كما هو: فاضي أو أطول من المسموح',
    owner:'معدّ الدليل يكتبه، ومالك الإجراء يعتمده'});
  if(!readEligibility(card).length)gaps.push({key:'eligibility_rules',label:'هل تنطبق عليك',
    why:eligibilityFrom(db,u,s).length?'فيه شرط يفرضه الكود على هذي الخدمة وما انحفظ على البطاقة بعد':'ما انكتبت بعد. والكود ما يفرض على هذي الخدمة أي شرط أهلية: لا تصريح لازم، ولا حصر بإدارة، ولا شرط على خطوة اعتماد. فمن تنطبق عليه كلامٌ يكتبه إنسان، مو شيئًا تعرفه المنصة',
    owner});
  if(!readDocuments(card).length)gaps.push({key:'required_documents',label:'المستندات المطلوبة',
    why:documentsFrom(s).length?'فيه مستند يسمّيه تعريف الخدمة وما انحفظ على البطاقة بعد':'ما انكتبت بعد. وتعريف الخدمة ما يسمّي مستندًا: لا في خيارات مجموعتها ولا في وصفها، وما في نوع حقل «ملف» يُشتق منه',
    owner});
  if(!readFaq(card).length)gaps.push({key:'faq',label:'الأسئلة الشائعة',
    why:'ما انكتبت بعد. وما لها مصدر يُشتق منه: المنصة ما تعرف وش يسأل عنه الناس، فما تُولَّد لها أسئلة من عندها',
    owner:`${owner}، ومعدّ الدليل — من الأسئلة اللي توصلهم فعلًا`});
  return gaps;
}

export function serviceCard(db,supplied,code){
  // حامل التصريح يفتح بطاقة الخدمة الموقوفة: اللوح يعرض صفّها ويعرض عليه «عرض البطاقة» و«تعديل المسودة»،
  // فبابٌ يردّ 404 على ما عرضه اللوح تناقضٌ في الشاشة نفسها. والموظف لا يبلغها: لا تُعرض له في اللوح أصلًا.
  const u=actor(db,supplied),manage=can(db,u,'catalog.manage');
  const s=typeof code==='string'&&catalog(db,u,{includeHidden:manage}).find(x=>x.code===code.toUpperCase());
  if(!s)fail(404,'not_found','الخدمة غير متاحة');
  const published=cardRow(db,u,s.code,['published']),draft=cardRow(db,u,s.code,['draft']);
  const showDraft=draft&&(manage||draft.owner_id===u.id),actions=[];
  if(manage)actions.push(draft?'edit_card':'draft_card');
  if(draft&&draft.owner_id===u.id&&draft.prepared_by!==u.id&&!missing(draft).length)actions.push('publish_card');
  return {service:derived(db,u,s),published:present(db,published),draft:showDraft?present(db,draft):null,draft_missing:showDraft?missing(draft):[],
    content_gaps:contentGaps(db,u,s,published??(showDraft?draft:null)),
    ready:!!published&&!missing(published).length,readiness:published?(missing(published).length?'منشورة ناقصة':'جاهزة: بطاقة منشورة مكتملة'):draft?'مسودة بانتظار اعتماد مالك الإجراء':'بلا بطاقة: النموذج يعمل، لكن الخدمة غير موثقة',actions};
}
export function cardsBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'catalog.manage');
  // الموقوفة بمفتاح الإعدادات (ترحيل 129) تبقى في لوح البطاقات معلَّمة، كما في فحص الدليل وتقرير الجودة
  // (مراجعة 22 سبتمبر): البطاقة هي ما يقرؤه منفّذ الطلب المفتوح، وخدمةٌ أُوقفت لها طلبات مفتوحة — فلو سقطت
  // من اللوح لهبطت بلاطات «خدمة في الدليل» و«بلا بطاقة» و«لها شاشة تشغيل» بلا كلمة واحدة تقول لماذا.
  // وتبقى خارج قائمة غير حامل التصريح وحدها: لا بطاقة تُعرض للموظف عن خدمة لا يستطيع طلبها.
  const hidden=hiddenServiceCodes(db,u.tenant_id);
  const rows=catalog(db,u,{includeHidden:true}).map(s=>{const published=cardRow(db,u,s.code,['published']),draft=cardRow(db,u,s.code,['draft']);
    const card=draft??published;
    return {code:s.code,name:s.name_ar,department_id:s.department_id,section:s.section??'',state:published?(missing(published).length?'incomplete':'ready'):draft?'draft':'none',owner_name:name(db,(published??draft)?.owner_id),draft_owner_id:draft?.owner_id??null,draft_prepared_by:draft?.prepared_by??null,draft_missing:draft?missing(draft):[],module:SERVICE_MODULES[s.code]??null,hidden:hidden.has(s.code),
      // ما بقي فارغًا من أعمدة الصفحة الأربعة على البطاقة القائمة: يُعدّ في اللوح فيُرى الرقم قبل فتح أي بطاقة.
      content_missing:card?CONTENT_FIELDS.filter(k=>emptyContent(k,card[k])):CONTENT_FIELDS.slice(),
      values:manage?Object.fromEntries(FIELDS.map(k=>[k,(card??suggestion(db,u,s))[k]??''])):null,
      // المشتق من التعريف، مفصولًا عن المخزَّن: الشاشة تعرضه اقتراحًا في الصندوق الفارغ ولا تحسبه محفوظًا.
      suggested:manage?contentSuggestion(db,u,s):null};});
  const mine=rows.filter(r=>r.state==='draft'&&r.draft_owner_id===u.id);
  // طابور كل مالك على حدة (طلب القيادة): 142 مسودة على 16 مالكًا، فصاحب الطابور يرى طابوره لا 142 صفًّا.
  const owners=[...rows.filter(r=>r.state==='draft'&&r.draft_owner_id).reduce((map,r)=>map.set(r.draft_owner_id,[...(map.get(r.draft_owner_id)??[]),r]),new Map())]
    .map(([id,list])=>({owner_id:id,owner_name:name(db,id)??id,drafts:list.length,ready_to_publish:list.filter(r=>!r.draft_missing.length&&r.draft_prepared_by!==id).length,
      missing_fields:[...new Set(list.flatMap(r=>r.draft_missing))],codes:list.map(r=>r.code)}))
    .sort((a,b)=>b.drafts-a.drafts||String(a.owner_name).localeCompare(String(b.owner_name),'ar'));
  return {can_manage:manage,user_id:u.id,owners:manage?owners:owners.filter(o=>o.owner_id===u.id),totals:{services:rows.length,hidden:rows.filter(r=>r.hidden).length,ready:rows.filter(r=>r.state==='ready').length,draft:rows.filter(r=>r.state==='draft').length,none:rows.filter(r=>r.state==='none').length,with_module:rows.filter(r=>r.module).length,
      page_fields_missing:rows.filter(r=>r.content_missing.length).length},
    departments:db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id),kinds:KINDS,confidentiality:CONFIDENTIALITY,
    people:manage?db.prepare("SELECT id,name,department_id FROM users WHERE tenant_id=? AND active=1 AND role IN ('manager','hr','it','pm') ORDER BY name").all(u.tenant_id):[],
    services:manage?rows:rows.filter(r=>!r.hidden&&(r.state==='ready'||r.draft_owner_id===u.id)),awaiting_me:mine.filter(r=>r.draft_prepared_by!==u.id&&!r.draft_missing.length).map(r=>({id:r.code,title:`${r.code} · ${r.name}`,actions:['publish_card']})),
    note:'الخدمة «جاهزة» حين تكون لها بطاقة منشورة مكتملة اعتمدها مالك الإجراء المسمى فيها. المسودات المولدة اقتراح يراجعه المالك؛ ليست وصفًا معتمدًا.'};
}
// أعمدة صفحة الخدمة الأربعة (ترحيل 131) تدخل من باب saveCard نفسه لا من باب ثانٍ: التصريح نفسه
// (catalog.manage)، والمعاملة نفسها، وحدث التدقيق نفسه، وقاعدة «المعدّ غير مالك الإجراء» نفسها.
// أضافها الترحيل ولم يكتبها شيء في app/ قط: 142 صفًّا تحمل '' و'{}' و'[]' و'[]'، فصفحة كل خدمة تطبع
// «غير متاح» في «هل تنطبق عليك» و«ما تحتاجه» و«أسئلة شائعة».
const CONTENT_FIELDS=['short_description','eligibility_rules','required_documents','faq'];
const FIELDS=['owner_id','requesters','service_kind','confidentiality','trigger_note','outputs','acceptance_evidence','financial_limit_note','exceptions_note','kpis','integrations','policy_reference',...CONTENT_FIELDS];
// الثلاثة الأخيرة أعمدة JSON عليها CHECK في المخطط (object وarray وarray). فشكلها يُفحص هنا ويُردّ
// برسالة تسمّي السبب والسطر، ولا يصل العمود نصٌّ فاسد يكسر قارئه بعد شهر: صفحة الخدمة تقرؤها
// بـJSON.parse داخل try/catch، والفاسد يُقرأ فراغًا صامتًا — وهو أسوأ من رفضٍ مكتوب عند الكتابة.
const SHORT_MAX=200,ITEMS_MAX=20;
// ما تكتبه الشاشة سطورٌ يقرؤها إنسان؛ وما يمرره الاشتقاق أو السكربت بنيةٌ جاهزة. الاثنان يدخلان من هنا.
const RULE_KINDS=['capability','department','audience','approval_condition','written'];
const lines=value=>String(value).split('\n').map(x=>x.trim()).filter(Boolean);
// نصٌّ هو بالضبط JSON من نوعٍ متوقَّع يُقرأ بنيةً (رجوعُ ما خزّناه كما هو)، وما عداه يُقرأ سطورًا.
function structured(value,expect){
  if(typeof value!=='string')return value;
  const trimmed=value.trim();
  if(!(expect==='array'?trimmed.startsWith('['):trimmed.startsWith('{')))return null;
  try{const parsed=JSON.parse(trimmed);return (expect==='array'?Array.isArray(parsed):parsed&&typeof parsed==='object'&&!Array.isArray(parsed))?parsed:null;}catch{return null;}
}
function documentsValue(input){
  if(input===undefined||input===null||input==='')return '[]';
  const list=Array.isArray(input)?input:(structured(input,'array')??(typeof input==='string'?lines(input):null));
  if(!Array.isArray(list))fail(400,'required_documents','المستندات سطر لكل مستند، مو رقم ولا كائن');
  if(list.length>ITEMS_MAX)fail(400,'required_documents',`أكثر شيء ${ITEMS_MAX} مستند — عندك ${list.length}`);
  const out=[];
  for(const [i,item] of list.entries()){
    if(typeof item!=='string')fail(400,'required_documents',`المستند رقم ${i+1} لازم يكون نص`);
    const value=item.trim();
    if(value.length<2||value.length>SHORT_MAX)fail(400,'required_documents',`المستند رقم ${i+1}: من حرفين إلى ${SHORT_MAX} حرف — كتبت ${value.length}`);
    if(!out.includes(value))out.push(value);
  }
  return JSON.stringify(out);
}
function faqValue(input){
  if(input===undefined||input===null||input==='')return '[]';
  const raw=Array.isArray(input)?input:(structured(input,'array')??(typeof input==='string'?lines(input).map(line=>{const at=line.indexOf('|');return at<0?{q:line,a:''}:{q:line.slice(0,at),a:line.slice(at+1)};}):null));
  if(!Array.isArray(raw))fail(400,'faq','الأسئلة سطر لكل سؤال: السؤال ثم | ثم الجواب');
  if(raw.length>ITEMS_MAX)fail(400,'faq',`أكثر شيء ${ITEMS_MAX} سؤال — عندك ${raw.length}`);
  const out=[];
  for(const [i,item] of raw.entries()){
    if(!item||typeof item!=='object'||Array.isArray(item))fail(400,'faq',`السؤال رقم ${i+1}: اكتبه «السؤال | الجواب»`);
    const q=String(item.q??'').trim(),a=String(item.a??'').trim();
    if(q.length<5||q.length>SHORT_MAX)fail(400,'faq',`السؤال رقم ${i+1}: من 5 إلى ${SHORT_MAX} حرف`);
    if(a.length<5||a.length>1000)fail(400,'faq',`جواب السؤال رقم ${i+1} ناقص — اكتب الجواب بعد علامة |، من 5 إلى 1000 حرف`);
    out.push({q,a});
  }
  return JSON.stringify(out);
}
function eligibilityValue(input){
  if(input===undefined||input===null||input==='')return '{}';
  const object=Array.isArray(input)?{rules:input}:(typeof input==='object'&&input?input:(structured(input,'object')??(typeof input==='string'?{rules:lines(input).map(text=>({kind:'written',text}))}:null)));
  if(!object||typeof object!=='object'||Array.isArray(object))fail(400,'eligibility_rules','شروط الأهلية: اكتب شرطًا في كل سطر، أو اتركها فاضية إذا ما فيه شرط');
  const raw=object.rules??[];
  if(!Array.isArray(raw))fail(400,'eligibility_rules','شروط الأهلية لازم تكون قائمة داخل المفتاح rules');
  if(raw.length>ITEMS_MAX)fail(400,'eligibility_rules',`أكثر شيء ${ITEMS_MAX} شرط — عندك ${raw.length}`);
  const out=[];
  for(const [i,item] of raw.entries()){
    if(!item||typeof item!=='object'||Array.isArray(item))fail(400,'eligibility_rules',`الشرط رقم ${i+1}: اكتبه نصًّا في سطر`);
    const kind=String(item.kind??'written');
    if(!RULE_KINDS.includes(kind))fail(400,'eligibility_rules',`الشرط رقم ${i+1}: نوعه «${kind}» مو من الأنواع المعروفة (${RULE_KINDS.join('، ')})`);
    const text=String(item.text??'').trim();
    if(text.length<5||text.length>400)fail(400,'eligibility_rules',`الشرط رقم ${i+1}: من 5 إلى 400 حرف`);
    if(out.some(r=>r.text===text))continue;
    out.push({kind,text,...(item.source?{source:String(item.source).slice(0,120)}:{})});
  }
  // '{}' بالضبط حين لا شرط: صفحة الخدمة تقيس الغياب بـObject.keys(...).length===0، و{"rules":[]} تمرّ
  // عليها ممتلئةً فتُخفي نصّ «لم يُكتب بعد» ولا تعرض مكانه شيئًا — فراغٌ بلا سبب، وهو ما نمنعه.
  return out.length?JSON.stringify({rules:out}):'{}';
}
// «فارغ» لكل عمود بصيغته المخزَّنة: '' ونصٌّ بلا قواعد ومصفوفة بلا بنود — لا طول النص وحده.
export const emptyContent=(key,value)=>key==='short_description'?!String(value??'').trim()
  :key==='eligibility_rules'?!readEligibility({eligibility_rules:value}).length
  :key==='required_documents'?!readDocuments({required_documents:value}).length:!readFaq({faq:value}).length;
export const readDocuments=card=>{try{const x=JSON.parse(card?.required_documents??'[]');return Array.isArray(x)?x:[];}catch{return [];}};
export const readFaq=card=>{try{const x=JSON.parse(card?.faq??'[]');return Array.isArray(x)?x:[];}catch{return [];}};
export const readEligibility=card=>{try{const x=JSON.parse(card?.eligibility_rules??'{}');return Array.isArray(x?.rules)?x.rules:[];}catch{return [];}};
function clean(db,u,input){
  if(!Object.hasOwn(KINDS,input.service_kind))fail(400,'service_kind','اختر نوع الخدمة');
  if(!Object.hasOwn(CONFIDENTIALITY,input.confidentiality))fail(400,'confidentiality','اختر تصنيف السرية');
  const owner=input.owner_id?db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(input.owner_id,u.tenant_id):null;
  if(input.owner_id&&!owner)fail(400,'owner_id','مالك الإجراء غير متاح');
  const text=(key,label,max=1500)=>input[key]?v.text(input[key],label,max,3):'';
  return {owner_id:owner?.id??null,requesters:text('requesters','من يحق له الطلب',600),service_kind:input.service_kind,confidentiality:input.confidentiality,trigger_note:text('trigger_note','محفز البدء',600),outputs:text('outputs','المخرجات'),acceptance_evidence:text('acceptance_evidence','أدلة القبول'),
    financial_limit_note:text('financial_limit_note','الحدود المالية والتفويض',800),exceptions_note:text('exceptions_note','الاستثناءات وحالات إيقاف الساعة',800),kpis:text('kpis','المؤشرات',800),integrations:text('integrations','التكاملات',600),policy_reference:text('policy_reference','السياسة المرجعية ونسختها',600),
    short_description:input.short_description?v.text(input.short_description,'الوصف المختصر',SHORT_MAX,5):'',
    eligibility_rules:eligibilityValue(input.eligibility_rules),required_documents:documentsValue(input.required_documents),faq:faqValue(input.faq)};
}

// ── اشتقاق أعمدة الصفحة الأربعة ───────────────────────────────────────────────
// القاعدة نفسها التي تحكم suggestion أدناه: من بنية المنصة فقط، وما لا تعرفه المنصة يبقى فارغًا
// ومعه سببُه ومن يملك كتابته — لا نصًّا معقولًا يقرؤه الموظف فيحسبه معتمدًا.

// الوصف المختصر: أول جملة من وصف الخدمة نفسه (app/service-catalog.mjs). نصٌّ مكتوب أصلًا لهذا الغرض،
// فلا يُعاد كتابته ولا يُبتر: أطول جملة أولى في الـ142 سبعٌ وثمانون حرفًا، والحدّ مئتان.
const firstSentence=text=>String(text??'').trim().split(/(?<=[.؟!])\s+/)[0]?.trim()??'';
export function shortDescriptionFrom(s){const one=firstSentence(s.description);return one.length>=5&&one.length<=SHORT_MAX?one:'';}

// المستندات: ممّا يقوله التعريف نفسه، لا ممّا قد يطلبه إجراء. مصدران لا ثالث لهما اليوم:
//   (1) docs[] على خيار المجموعة الذي يشير إلى هذه الخدمة — أسماء مستندات كتبها إنسان في التعريف،
//       وهي المصدر الذي تقرؤه صفحة الخدمة أصلًا (documentsFor في app/catalog-home.mjs).
//   (2) عبارة «أرفق …» أو «إرفاق …» في وصف الخدمة: الإشارة نفسها التي يفرضها app/request-intake.mjs
//       اليوم تنبيهًا («وصف الخدمة يطلب إرفاق مستند ولم يُرفق شيء») — فما تعترف به المنصة تنبيهًا
//       تعترف به هنا بندًا، بلفظ التعريف نفسه بعد إسقاط الفعل وحده.
// **ولا اشتقاق من أسماء الحقول**: ليس في تعريف الحقول نوع «ملف» أصلًا — الأنواع الخمسة text وtextarea
// وdate وnumber وselect — و«رقم فاتورة المورد» يسأل عن رقم لا عن مستند. فاشتقاق مستند من اسم حقل تخمين،
// وهو ما يمنعه عرف هذه الدالة. القياس: 7 خدمات من 142 يسمّي تعريفها مستندًا، و135 لا يسمّي شيئًا.
const ATTACH=/(?:أرفق|إرفاق)\s+([^.،؛:]+)/g;
export function documentsFrom(s){
  const curated=[];
  for(const group of SERVICE_VARIANTS)for(const option of group.options??[])if(option.service===s.code)for(const doc of option.docs??[])if(typeof doc==='string'&&doc.trim())curated.push(doc.trim());
  const out=[...new Set(curated)];
  for(const [,phrase] of String(s.description??'').matchAll(ATTACH)){
    const value=phrase.trim();
    // «شهادة الآيبان» من الوصف و«شهادة الآيبان من البنك باسم الموظف» من خيار المجموعة مستندٌ واحد.
    // الأخصّ يبقى، والأعمّ الذي يقع داخله يسقط — احتواءٌ محسوب لا تشابهٌ مقدَّر.
    if(value.length>=2&&!out.some(kept=>kept.includes(value)))out.push(value);
  }
  return out.slice(0,ITEMS_MAX);
}

// الأهلية: البوابات التي يفرضها الكود على هذه الخدمة بعينها، لا ما «يُفترض» أن تكون عليه. ثلاث بوابات
// يفرضها الكود فعلًا اليوم: تصريح لازم وحصرٌ بإدارة على صفّ الإسقاط (catalog_placement، وهو الصفّ الذي
// يبني منه visibleSql شرطَ الظهور في التصفّح والبحث والبطاقات سواء)، وشرطٌ في خطوة اعتماد.
// وحين لا يفرض الكود شيئًا تبقى القيمة '{}' وتقول الشاشةُ ذلك بنصّه — لا فراغًا يُقرأ «يطلبها من شاء».
export function eligibilityFrom(db,u,s){
  const rules=[],placement=db.prepare("SELECT audience,required_capability,department_id FROM catalog_placement WHERE tenant_id=? AND item_kind='service' AND item_key=? ORDER BY audience").all(u.tenant_id,s.code);
  for(const row of placement){
    if(String(row.required_capability??'').trim())rules.push({kind:'capability',text:`لازم يكون بحسابك تصريح «${capabilityName(row.required_capability)}»`,source:'catalog_placement.required_capability'});
    if(row.department_id){const name=db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(row.department_id,u.tenant_id)?.name??row.department_id;
      rules.push({kind:'department',text:`الخدمة هذي لمنسوبي ${name} وبس`,source:'catalog_placement.department_id'});}
  }
  // خدمةٌ لها صفوف في الإسقاط وما فيها صفٌّ لجمهور «employee»: ما يفتحها موظفٌ بلا صفة أصلًا.
  if(placement.length&&!placement.some(r=>r.audience==='employee'))rules.push({kind:'audience',text:'ما يفتحها إلا من يطلب نيابة عن غيره: مدير أو موارد بشرية أو تقنية معلومات أو مدير مشروع',source:'catalog_placement.audience'});
  // شرطٌ على خطوة اعتماد: stepName يكتبه بالعربية أصلًا («إذا كان المبلغ…»)، فلا صياغة ثانية تفترق عنه.
  for(const step of s.approval_policy?.steps??[])if(step&&typeof step==='object'&&step.when)rules.push({kind:'approval_condition',text:`يمر طلبك بخطوة ${stepName(db,u,step)}`,source:'approval_policy.steps[].when'});
  return rules;
}
function suggestion(db,u,s){
  // اقتراح من بنية المنصة فقط: نوع الخدمة من طبيعة الإدارة، والسرية من حساسيتها، والمالك مدير الإدارة المسجل. لا مخرجات ولا مؤشرات مفترضة.
  // وأعمدة الصفحة الأربعة على العرف نفسه: الوصف المختصر والمستندات والأهلية ممّا تعرفه المنصة، والأسئلة
  // الشائعة تبقى فارغة — لا مصدر صادق لها: المنصة لا تعرف ما يسأل عنه الناس، وتوليدها اختراعٌ لا اشتقاق.
  const head=db.prepare("SELECT id FROM users WHERE tenant_id=? AND department_id=? AND role='manager' AND active=1 ORDER BY id LIMIT 1").get(u.tenant_id,s.department_id);
  return {owner_id:head?.id??null,requesters:'',service_kind:CLIENT_WORK.has(s.department_id)?'client_work':'institutional',confidentiality:s.approval_policy.confidential?'confidential':RESTRICTED.has(s.department_id)?'restricted':'internal',trigger_note:'',outputs:'',acceptance_evidence:'',financial_limit_note:'',exceptions_note:'',kpis:'',integrations:SERVICE_MODULES[s.code]?`تُنفذ في شاشة «${MODULE_NAMES[SERVICE_MODULES[s.code]]}» داخل المنصة.`:'',policy_reference:'',
    ...contentSuggestion(db,u,s)};
}
// أعمدة الصفحة الأربعة مشتقةً وحدها، بصيغتها المخزَّنة. تُقرأ في اللوح اقتراحًا وفي المسودة قيمةً،
// ومن هنا وحده يأخذها سكربت التعبئة — فلا نسخة ثانية من الاشتقاق تفترق عن هذه بعد أول تحرير.
export function contentSuggestion(db,u,s){
  return {short_description:shortDescriptionFrom(s),eligibility_rules:eligibilityValue({rules:eligibilityFrom(db,u,s)}),required_documents:documentsValue(documentsFrom(s)),
    // الأسئلة الشائعة تبقى فارغة عمدًا: لا مصدر صادق لها في المنصة، وتوليدها اختراعٌ لا اشتقاق.
    faq:'[]'};
}
function insertDraft(db,u,s,f){
  const previous=db.prepare('SELECT COALESCE(MAX(revision),0) AS n FROM service_cards WHERE tenant_id=? AND service_code=?').get(u.tenant_id,s.code).n,cardId=randomUUID(),time=now();
  db.prepare("INSERT INTO service_cards(id,tenant_id,service_code,revision,owner_id,requesters,service_kind,confidentiality,trigger_note,outputs,acceptance_evidence,financial_limit_note,exceptions_note,kpis,integrations,policy_reference,short_description,eligibility_rules,required_documents,faq,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)")
    .run(cardId,u.tenant_id,s.code,previous+1,f.owner_id,f.requesters,f.service_kind,f.confidentiality,f.trigger_note,f.outputs,f.acceptance_evidence,f.financial_limit_note,f.exceptions_note,f.kpis,f.integrations,f.policy_reference,f.short_description??'',f.eligibility_rules??'{}',f.required_documents??'[]',f.faq??'[]',u.id,time,time);
  return cardId;
}
export function saveCard(db,supplied,code,input){
  writing(db);const u=actor(db,supplied);if(!can(db,u,'catalog.manage'))fail(403,'not_permitted','إعداد بطاقات الخدمات لمن يدير دليل الخدمات');
  // الموقوفة تُعدَّل بطاقتها كما تُولَّد: باب البطاقة لحامل التصريح وحده أصلًا (السطر قبله)، وهي ما يقرؤه
  // منفّذ طلبها المفتوح. وردُّ 404 هنا كان يقفل الزرّ الذي عرضه اللوح على الصف نفسه.
  const s=catalog(db,u,{includeHidden:true}).find(x=>x.code===String(code).toUpperCase());if(!s)fail(404,'not_found','الخدمة غير متاحة');
  v.object(input,FIELDS);const f=clean(db,u,input),draft=cardRow(db,u,s.code,['draft']);
  if(f.owner_id===u.id)fail(409,'separation_of_duties','معدّ البطاقة لا يكون مالك الإجراء الذي يعتمدها');
  if(draft)db.prepare('UPDATE service_cards SET owner_id=?,requesters=?,service_kind=?,confidentiality=?,trigger_note=?,outputs=?,acceptance_evidence=?,financial_limit_note=?,exceptions_note=?,kpis=?,integrations=?,policy_reference=?,short_description=?,eligibility_rules=?,required_documents=?,faq=?,prepared_by=?,version=version+1,updated_at=? WHERE id=?').run(f.owner_id,f.requesters,f.service_kind,f.confidentiality,f.trigger_note,f.outputs,f.acceptance_evidence,f.financial_limit_note,f.exceptions_note,f.kpis,f.integrations,f.policy_reference,f.short_description,f.eligibility_rules,f.required_documents,f.faq,u.id,now(),draft.id);
  const cardId=draft?.id??insertDraft(db,u,s,f);
  audit(db,u,'service_card',cardId,draft?'card.edited':'card.drafted',{}, {service:s.code});
  return {id:cardId};
}
export function draftMissingCards(db,supplied){
  writing(db);const u=actor(db,supplied);if(!can(db,u,'catalog.manage'))fail(403,'not_permitted','إعداد بطاقات الخدمات لمن يدير دليل الخدمات');
  // الموقوفة تُولَّد لها مسودة كغيرها: البطاقة وصف الإجراء لمن ينفّذ طلبًا مفتوحًا عليها، لا عرضٌ للموظف.
  // تخطّيها كان يترك خدمةً لها طلبات تمشي بلا بطاقة، ويعود العدد المسجَّل في التدقيق ساكتًا عمّن تُرك.
  let created=0;
  for(const s of catalog(db,u,{includeHidden:true})){if(cardRow(db,u,s.code,['draft','published']))continue;insertDraft(db,u,s,suggestion(db,u,s));created++;}
  audit(db,u,'service_card','bulk','card.bulk_drafted',{}, {created});
  return {created};
}
export function publishCard(db,supplied,code,input){
  writing(db);const u=actor(db,supplied);v.object(input,['effective_from','note']);
  const draft=cardRow(db,u,String(code).toUpperCase(),['draft']);
  if(!draft||draft.owner_id!==u.id)fail(404,'not_found','لا مسودة بطاقة تنتظر اعتمادك');
  if(draft.prepared_by===u.id)fail(409,'separation_of_duties','من أعد البطاقة لا يعتمدها');
  const gaps=missing(draft);if(gaps.length)fail(409,'card_incomplete',`ينقص البطاقة: ${gaps.join('، ')}`);
  const effective=v.date(input.effective_from);if(effective<today())fail(400,'effective_from','تاريخ السريان اليوم أو بعده');
  v.text(input.note,'إقرارك بملكية الإجراء',1000,10);
  const time=now(),previous=cardRow(db,u,draft.service_code,['published']);
  if(previous)db.prepare("UPDATE service_cards SET status='superseded',version=version+1,updated_at=? WHERE id=?").run(time,previous.id);
  db.prepare("UPDATE service_cards SET status='published',effective_from=?,published_by=?,published_at=?,version=version+1,updated_at=? WHERE id=?").run(effective,u.id,time,time,draft.id);
  audit(db,u,'service_card',draft.id,'card.published',{}, {service:draft.service_code,revision:draft.revision},input.note.trim());
  return {id:draft.id};
}
