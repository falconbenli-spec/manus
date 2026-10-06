import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { projectManagerOfRecord } from './project-authority.mjs';
import { createTask } from './projects.mjs';
import { assertExecutionAllowed } from './project-intake.mjs';
import { financeCapabilities } from './finance.mjs';
import { refuse } from './refusal.mjs';
import { registerEntity, projector, prepare, forTransition, columnsFor } from './custom-fields.mjs';
import { statusLabel } from './definitions.mjs';
import { normalize, withinDistance } from './arabic-text.mjs';
import { registerAdoption, adopted } from './options.mjs';
import { personName } from './people-read.mjs';
// تاريخ ما بعد البيع على ملف العميل (الحزمة 4، P4-CRM-5).
import { supportOnClient } from './client-support.mjs';
// إنهاء العلاقة وإعادة فتحها بسجل معتمد، والحارس على كل عمل جديد لعميل مقفل (الحزمة 4، P4-CRM-7، الترحيل 186).
import { assertClientOpen, offboardingPanel, offboardingAwaiting } from './client-offboarding.mjs';

// تشغيل الوكالة. العزل بين الحسابات بالعضوية: من ليس في فريق حساب العميل لا يراه، حتى لو حمل تصريح إدارة ملفات العملاء.
export const FAMILIES=[
  ['research_strategy','بحوث السوق والجمهور واستراتيجية التسويق والاتصال'],['branding','بناء العلامات والتسمية والهوية والأدلة'],['campaigns','الأفكار والحملات المتكاملة وإطلاق المنتجات'],['content_social','المحتوى والكتابة والتصميم وإدارة القنوات والمجتمع'],
  ['performance_media','الإعلانات الرقمية والشراء الإعلامي وتحسين الأداء'],['seo_aeo','البحث العضوي والمحلي ومحركات الإجابة'],['ux_web','تجربة المستخدم والمواقع وصفحات الهبوط وتحسين التحويل'],['commerce','نمو المتاجر والتجارة الاجتماعية وكتالوجات المنتجات'],
  ['crm_automation','CRM ورحلات العملاء والبريد وأتمتة التواصل المصرح به'],['pr_reputation','العلاقات العامة والسمعة والمتحدثون واتصال الأزمات'],['influencers','المؤثرون وصناع المحتوى وUGC وحقوق الاستخدام'],['production','التصوير والفيديو والموشن والصوت والبودكاست'],
  ['events','الفعاليات والمعارض والتجارب وتنشيط العلامة والرعايات'],['analytics','التحليلات والقياس والتجارب ولوحات النتائج'],['internal_comms','الاتصال الداخلي والعلامة الوظيفية للعميل'],['ai_consulting','استشارات وأتمتة العمليات التسويقية بالذكاء الاصطناعي']
].map(([key,name])=>({key,name}));
export const PRICING_MODELS=[['fixed','عقد ثابت'],['retainer','اشتراك خدمات دوري'],['hourly','بالساعات'],['per_output','بالمخرجات'],['fee_plus_media','أتعاب مع إنفاق إعلامي منفصل']].map(([key,name])=>({key,name}));
const CLIENT_STATUS={prospect:'محتمل',active:'نشط',paused:'متوقف مؤقتًا',closed:'مقفل'};
const riyadhToday=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const id=()=>randomUUID();
function actor(db,supplied){const u=currentUser(db,supplied);if(!u||!['employee','manager','pm'].includes(u.role))fail(403,'forbidden','هذه المساحة لفرق التشغيل');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const isMember=(db,u,clientId)=>!!db.prepare('SELECT 1 FROM clients c LEFT JOIN client_members m ON m.client_id=c.id AND m.user_id=? AND m.removed_at IS NULL WHERE c.id=? AND c.tenant_id=? AND (c.owner_id=? OR m.user_id IS NOT NULL)').get(u.id,clientId,u.tenant_id,u.id);
function client(db,u,clientId,{owner=false}={}){
  const c=typeof clientId==='string'&&db.prepare('SELECT * FROM clients WHERE id=? AND tenant_id=?').get(clientId,u.tenant_id);
  if(!c||!isMember(db,u,c.id))fail(404,'not_found','ملف العميل غير متاح');
  if(owner&&c.owner_id!==u.id)fail(403,'forbidden','هذا الإجراء لمسؤول الحساب');
  return c;
}

/* ───── هوية العميل: رقم السجل والاسم المطبَّع (الحزمة 4، الترحيل 180، القرار D1) ───── */
// العميل ملف واحد، وهويته رقم سجله التجاري. الصفقات (commercial_cases) تنفتح منه ولا تكتب اسمه ولا رقمه مرة ثانية.
// رقم السجل: الأرقام العربية الهندية والفارسية إلى لاتينية، بلا مسافات، بأحرف كبيرة — الشكل الذي يفرضه createLead منذ 004
// ويفرضه قيد العمود في 180. فارغٌ يعني «ما سُجّل بعد».
export function registrationNumber(value,{required=false}={}){
  if(value===undefined||value===null||value===''){
    if(required)refuse(400,'registration_number',{what:'رقم السجل التجاري مطلوب هنا',next:'اكتب رقم السجل كما في شهادة السجل التجاري — أرقام وأحرف لاتينية وشرطة، مثل 1010123456'});
    return null;
  }
  const clean=normalize(v.text(value,'رقم السجل',60,3)).replace(/\s+/g,'').toUpperCase();
  if(!/^[A-Z0-9-]{3,40}$/.test(clean))refuse(400,'registration_number',{what:`رقم السجل «${clean.slice(0,40)}» مو بالشكل المعتمد`,
    next:'اكتبه أرقامًا وأحرفًا لاتينية وشرطة فقط، من 3 إلى 40 خانة — مثل 1010123456'});
  return clean;
}
// مفتاح المقارنة للاسم في وحدة صغيرة (app/client-names.mjs) يقرؤها الباب الأمامي للعملاء دون أن يحمّل هذه الوحدة؛ يُعاد تصديره من هنا كما كان.
import { clientNameKey } from './client-names.mjs';
export { clientNameKey };
// كم حرفًا يفرق اسمين متقاربين ويبقيان «جهة واحدة»؟ رقم بلا قياس، فما تخترعه المنصة: حتى يقرّره مسؤول ملفات العملاء
// ويعتمده شخص ثانٍ، التطابق بعد التطبيع وحده تعارض.
export const NAME_EDITS='clients.duplicate_name_edits';
registerAdoption({key:NAME_EDITS,label:'أخطاء الكتابة التي يُعدّ بها اسمان لعميلين جهة واحدة',module:'clients',
  owner:'مسؤول ملفات العملاء — من يحمل تصريح clients.manage',owner_role:'account_manager',manage_capability:'clients.manage',
  governance:'managed',shape:'object',default:{max_edits:null},
  basis:'ما قرّرها أحد بعد، والمنصة ما تخترع رقمًا: حتى تُعتمد يتعارض الاسمان إذا تطابقا بعد التطبيع وحده (الهمزات والتاء المربوطة والتشكيل والمسافات وألفاظ الشكل النظامي). القيمة {"max_edits": عدد صحيح من 1 إلى 3} تضيف الأسماء التي يفرقها هذا العدد من أخطاء الكتابة أو أقل'});
const maxEdits=(db,tenantId)=>{const value=adopted(db,tenantId,NAME_EDITS).value?.max_edits;return Number.isInteger(value)&&value>=1&&value<=3?value:0;};
const CONFLICT_REASONS={registration_number:'رقم السجل نفسه',legal_name:'الاسم القانوني نفسه بعد التطبيع',trade_name:'الاسم التجاري نفسه بعد التطبيع'};
// ما يتعارض مع جهةٍ تُكتب الآن، في الكيان كله لا في فريقي وحده: التكرار لا يُكشف بالنظر في ما أراه فقط.
// رقم السجل نفسه تعارض دائمًا. والاسم المطبَّع نفسه تعارض ما لم يثبت رقما سجلٍ مختلفان معلومان أنهما جهتان.
// اسم العميل خارج فريق السائل لا يُكشف: يُذكر رمز ملفه ومالكه ليعرف من يسأل.
function conflictsFor(db,u,{legal_name,trade_name,registration_number},excludeId=null){
  const keys=[legal_name,trade_name].filter(x=>typeof x==='string'&&x.trim()).map(clientNameKey).filter(Boolean),edits=maxEdits(db,u.tenant_id);
  const close=(a,b)=>a===b||(edits>0&&Math.min(a.length,b.length)>=4&&withinDistance(a,b,edits)>=0);
  const out=[];
  // «*» لا قائمة أعمدة: اختبارات الترقية (الترحيلان 164 و167) تنشئ عميلًا بهذه الدالة على مخطط قبل 180، فلا يُسمّى فيها عمود 180.
  for(const c of db.prepare('SELECT * FROM clients WHERE tenant_id=? ORDER BY code').all(u.tenant_id)){
    if(c.id===excludeId)continue;
    const reasons=[];
    if(registration_number&&c.registration_number===registration_number)reasons.push('registration_number');
    const provenOther=registration_number&&c.registration_number&&c.registration_number!==registration_number;
    if(!provenOther)for(const field of ['legal_name','trade_name'])
      if(c[field]&&c[field].trim()&&keys.some(key=>close(key,clientNameKey(c[field]))))reasons.push(field);
    if(!reasons.length)continue;
    const visible=isMember(db,u,c.id);
    out.push({code:c.code,reasons,owner_name:personName(db,c.owner_id),visible,...(visible?{client_id:c.id,name:c.legal_name,registration_number:c.registration_number}:{})});
  }
  return out;
}
function refuseDuplicate(found){
  refuse(409,'duplicate_client',{what:'فيه ملف عميل لنفس الجهة، فما ينفتح ملف ثاني',
    missing:found.map(c=>({document:`ملف العميل ${c.code}${c.name?` «${c.name}»`:''}`,why:c.reasons.map(r=>CONFLICT_REASONS[r]).join('، '),
      owner:c.owner_name??'مسؤول ملفات العملاء',owner_role:'account_manager',doc_key:'client'})),
    next:'افتح الملف القائم، واطلب من مسؤوله يضيفك لفريق حسابه إذا ما كنت فيه. وإذا كانت جهة ثانية فعلًا، اكتب رقم سجلها التجاري وتأكد إن الملف القائم عليه رقم سجله'});
}
// القارئ نفسه قبل الحفظ (CRM-01: «إنشاء جهة برقم سجل مكرر يعرض تعارضًا قبل الحفظ»): الشاشة تسأله وهو يكتب، والحفظ يسأله مرة ثانية.
export function clientConflicts(db,supplied,input={}){
  const u=actor(db,supplied);
  if(!can(db,u,'clients.manage')&&!can(db,u,'commercial.use',u.department_id))refuse(403,'not_permitted',{what:'فحص تكرار ملفات العملاء لمن ينشئ ملفات العملاء أو يفتح صفقاتهم',
    missing:[{document:'تصريح «ملفات العملاء» أو «المبيعات والتسليم»',why:'الفحص يكشف وجود ملفات في الكيان كله',owner:'مسؤول الصلاحيات',owner_role:'admin'}],next:'اطلب التصريح من مسؤول الصلاحيات'});
  const text=value=>typeof value==='string'&&value.trim()?value:undefined;
  const asked={legal_name:text(input.legal_name),trade_name:text(input.trade_name),registration_number:registrationNumber(text(input.registration_number))};
  return {asked:{registration_number:asked.registration_number,name_keys:[asked.legal_name,asked.trade_name].filter(Boolean).map(clientNameKey)},
    name_edits:maxEdits(db,u.tenant_id),conflicts:asked.legal_name||asked.trade_name||asked.registration_number?conflictsFor(db,u,asked):[]};
}

// تستخدمه وحدات التشغيل الأخرى (الحملات والمحتوى وحارس النطاق) لتطبيق عزل فريق الحساب نفسه.
export function clientFor(db,supplied,clientId,options={}){const u=actor(db,supplied);return {u,c:client(db,u,clientId,options)};}
export function memberClients(db,supplied){const u=actor(db,supplied);return db.prepare('SELECT id,code,legal_name,trade_name,owner_id FROM clients WHERE tenant_id=? ORDER BY legal_name').all(u.tenant_id).filter(c=>isMember(db,u,c.id));}

/* ───── ملف العميل ───── */
// projectRow: مُسقِط الحقول المخصّصة (ترحيل 123). يُنشر بعد {...c} فيكتب فوق العمود الخام custom_fields بالكائن المحجوب لهذا
// القارئ — القاعدة نفسها التي تحجب بها هذه الدالة المبالغ (invoiced_minor:null وfinance_hidden) عمّن لا تفويض ماليًّا له.
function clientView(db,u,c,projectRow=projector(db,u,'client')){
  const finance=financeCapabilities(db,u).includes('read');
  const cases=db.prepare('SELECT k.id,k.name,k.status,k.project_id FROM client_links l JOIN commercial_cases k ON k.id=l.case_id WHERE l.client_id=? ORDER BY k.updated_at DESC').all(c.id);
  const caseIds=cases.map(k=>k.id),marks=caseIds.map(()=>'?').join(',');
  // الأرقام المالية لمن يحمل تفويضًا ماليًا فقط؛ فريق الحساب يرى الحالة لا المبالغ.
  const money=finance&&caseIds.length?db.prepare(`SELECT COALESCE(SUM(CASE WHEN t.kind='invoice' THEN t.total_minor ELSE -t.total_minor END),0) AS invoiced FROM tax_invoices t JOIN ar_claims a ON a.id=t.claim_id WHERE a.case_id IN (${marks}) AND t.status='issued'`).get(...caseIds):null;
  const retainers=db.prepare('SELECT * FROM retainers WHERE client_id=? ORDER BY period_month DESC LIMIT 12').all(c.id).map(r=>retainerView(db,r));
  return {...c,...projectRow(c),status_name:statusLabel(db,u.tenant_id,'client',c.status,CLIENT_STATUS[c.status]),owner_name:name(db,c.owner_id),is_owner:c.owner_id===u.id,
    members:db.prepare('SELECT m.user_id,m.role,x.name FROM client_members m JOIN users x ON x.id=m.user_id WHERE m.client_id=? AND m.removed_at IS NULL ORDER BY x.name').all(c.id),
    brands:db.prepare('SELECT * FROM client_brands WHERE client_id=? ORDER BY name').all(c.id),
    contacts:db.prepare('SELECT * FROM client_contacts WHERE client_id=? AND active=1 ORDER BY name').all(c.id),
    cases,retainers,invoiced_minor:money?money.invoiced:null,finance_hidden:!finance,support_cases:supportOnClient(db,c.id),offboarding:offboardingPanel(db,u,c)};
}
export function clientsBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'clients.manage');
  const rows=db.prepare('SELECT DISTINCT c.* FROM clients c LEFT JOIN client_members m ON m.client_id=c.id AND m.removed_at IS NULL WHERE c.tenant_id=? AND (c.owner_id=? OR m.user_id=?) ORDER BY c.updated_at DESC').all(u.tenant_id,u.id,u.id);
  const unlinked=manage?db.prepare("SELECT k.id,k.name FROM commercial_cases k WHERE k.tenant_id=? AND k.owner_id=? AND k.status NOT IN ('lost','withdrawn') AND NOT EXISTS(SELECT 1 FROM client_links l WHERE l.case_id=k.id) ORDER BY k.name").all(u.tenant_id,u.id):[];
  const team=manage?db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role IN ('employee','manager','pm') AND id<>? ORDER BY name").all(u.tenant_id,u.id):[];
  const projectRow=projector(db,u,'client');
  return {today:riyadhToday(),user_id:u.id,can_manage:manage,status_names:CLIENT_STATUS,clients:rows.map(c=>clientView(db,u,c,projectRow)),custom_columns:columnsFor(db,u,'client'),unlinked_cases:unlinked,team,
    // سجلات إقفال أو إعادة فتح سمّاني طالبها معتمدًا (P4-CRM-7): معتمد إعادة الفتح قد لا يكون في فريق ملف مقفل.
    offboarding_awaiting:offboardingAwaiting(db,u)};
}
export function createClient(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'clients.manage'))fail(403,'not_permitted','إنشاء ملفات العملاء لحامل تصريحها');
  v.object(input,['legal_name','trade_name','sector','status','notes','custom_fields','registration_number']);
  if(!CLIENT_STATUS[input.status??'prospect'])fail(400,'status','حالة العميل غير صالحة');
  // الملف لا يولد مقفلًا (الترحيل 186): الإقفال سجلٌّ يعتمده شخص ثانٍ بعد فحص ما بقي مفتوحًا.
  if(input.status==='closed')refuse(400,'status',{what:'ملف العميل ما ينفتح مقفلًا',next:'افتحه بحالة «محتمل» أو «نشط» أو «متوقف مؤقتًا»؛ والإقفال بعدين بسجل إقفال يعتمده شخص ثاني'});
  const legal=v.text(input.legal_name,'الاسم القانوني',180,3),trade=input.trade_name?v.text(input.trade_name,'الاسم التجاري',180):'';
  // التعارض قبل الحفظ: رقم السجل نفسه، أو الاسم نفسه بعد التطبيع — لا ملف عميل مختلف في كل قسم ولا لكل تهجئة.
  const registration=registrationNumber(input.registration_number),found=conflictsFor(db,u,{legal_name:legal,trade_name:trade,registration_number:registration});
  if(found.length)refuseDuplicate(found);
// الرقم من أعلى رقم مستعمل لا من عدد الصفوف: العدّ يفترض تتابعًا بلا فجوة ولا شيء يفرضه.
// اليوم لا فجوة (حارس منع الحذف قائم ونطاق العدّ يطابق القيد الفريد) فالنتيجتان واحدة؛ لكن أول مسار
// استيراد أو ترحيل بيانات يُدخل رقمًا خارج التتابع يجعل العدّ يعيد رقمًا مستعملًا فيسقط الإدراج أمام المستخدم.
  const clientId=id(),time=now(),code='C-'+String(db.prepare("SELECT COALESCE(MAX(CAST(substr(code,3) AS INTEGER)),0)+1 AS n FROM clients WHERE tenant_id=? AND code LIKE 'C-%'").get(u.tenant_id).n).padStart(4,'0');
  // الحقول المخصّصة تُحكم بالتعريف المنشور وحده وتُكتب مع الصف. بلا تعريف منشور تبقى '{}' ولا يتغير شيء.
  const custom=prepare(db,u,'client',null,input.custom_fields,{creating:true});
  // عمود رقم السجل يُكتب حين يوجد رقم فقط (للسبب نفسه: الإدراج بلا رقم يبقى على أعمدة ما قبل 180).
  const values=[clientId,u.tenant_id,code,legal,trade,v.text(input.sector,'القطاع',120,2),input.status??'prospect',u.id,input.notes?v.text(input.notes,'ملاحظات',3000):'',time,time,custom.json,...(registration?[registration]:[])];
  db.prepare(`INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at,custom_fields${registration?',registration_number':''}) VALUES(${values.map(()=>'?').join(',')})`).run(...values);
  audit(db,u,'client',clientId,'client.created',{}, {code,registration_number:registration,definition_version:custom.version});
  custom.audit(clientId);
  return {id:clientId};
}
export function clientAction(db,supplied,clientId,action,input){
  writing(db);const u=actor(db,supplied);
  const fields={add_member:['user_id','role'],remove_member:['user_id'],add_brand:['name','guideline_reference'],add_contact:['name','title','email','phone'],link_case:['case_id'],set_status:['status','note','custom_fields'],set_registration:['registration_number']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,fields);
  const c=client(db,u,clientId,{owner:['add_member','remove_member','link_case','set_status','set_registration'].includes(action)}),time=now();
  // الملف المقفل لا يتغير إلا بسجل إعادة فتح معتمد (P4-CRM-7)؛ والإقفال نفسه سجلٌّ لا تغيير حالة.
  assertClientOpen(db,u.tenant_id,c.id,'ما يتغيّر ملف عميل مقفل');
  if(action==='set_status'&&input.status==='closed')refuse(409,'offboarding_required',{what:`ملف العميل ${c.code} ما ينقفل بتغيير الحالة`,
    missing:[{document:'سجل إقفال معتمد',why:'الإقفال يفحص ما بقي مفتوحًا (فرص، صفقات، بنود، ذمم، مال العميل، فوترة، عقود، بلاغات) ويقرّه شخص ثاني يحمل تصريح ملفات العملاء',owner:personName(db,c.owner_id)??CLIENT_OWNER,owner_role:'account_manager',doc_key:'offboarding'}],
    next:'ارفع «طلب إقفال الملف» من بطاقة العميل في «العملاء»'});
  let change={};
  if(action==='add_member'){
    const person=db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role IN ('employee','manager','pm')").get(input.user_id,u.tenant_id);
    if(!person||person.id===c.owner_id)fail(400,'member','العضو غير متاح');
    db.prepare('INSERT INTO client_members(client_id,user_id,role,added_by,added_at) VALUES(?,?,?,?,?) ON CONFLICT(client_id,user_id) DO UPDATE SET removed_at=NULL,role=excluded.role,added_by=excluded.added_by,added_at=excluded.added_at').run(c.id,person.id,v.text(input.role,'دوره في الحساب',120,2),u.id,time);
  }
  if(action==='remove_member'){if(!db.prepare('UPDATE client_members SET removed_at=? WHERE client_id=? AND user_id=? AND removed_at IS NULL').run(time,c.id,input.user_id).changes)fail(404,'not_found','العضو ليس في فريق الحساب');}
  if(action==='add_brand')db.prepare('INSERT INTO client_brands(id,client_id,name,guideline_reference,created_by,created_at) VALUES(?,?,?,?,?,?)').run(id(),c.id,v.text(input.name,'اسم العلامة',180,2),input.guideline_reference?v.text(input.guideline_reference,'مرجع دليل الهوية',500):'',u.id,time);
  if(action==='add_contact'){
    const email=input.email?v.text(input.email,'البريد',180):'';if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'email','البريد غير صالح');
    db.prepare('INSERT INTO client_contacts(id,client_id,name,title,email,phone,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id(),c.id,v.text(input.name,'الاسم',180,3),v.text(input.title,'الصفة',180,2),email,input.phone?v.text(input.phone,'الهاتف',30):'',u.id,time);
  }
  if(action==='link_case'){
    const k=db.prepare('SELECT id,status,version,client_id FROM commercial_cases WHERE id=? AND tenant_id=? AND owner_id=?').get(input.case_id,u.tenant_id,u.id);
    if(!k)fail(404,'not_found','السجل التجاري غير متاح لك');
    if(db.prepare('SELECT 1 FROM client_links WHERE case_id=?').get(k.id))fail(409,'already_linked','السجل مرتبط بملف عميل');
    // الصفقة المغلقة (خسرناها أو سحبناها) نهائية في القاعدة (الترحيل 180)، فما يُكتب عليها عميل بعد إغلاقها.
    if(['lost','withdrawn'].includes(k.status))refuse(409,'deal_closed',{what:'الصفقة مقفلة (خسرناها أو سحبناها)، فما تنربط بملف عميل الحين',
      next:'الصفقة الجديدة لنفس الجهة تنفتح من ملف العميل مباشرة'});
    db.prepare('INSERT INTO client_links VALUES(?,?,?,?)').run(c.id,k.id,u.id,time);
    // الربط يكتب عميل الصفقة (D1): القرّاء القدامى يقرؤون client_links، والجدد commercial_cases.client_id، فيتفقان.
    if(db.prepare('UPDATE commercial_cases SET client_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND client_id IS NULL').run(c.id,time,k.id,k.version).changes)
      audit(db,u,'commercial',k.id,'client_linked',{client_id:null,version:k.version},{client_id:c.id,version:k.version+1});
    change={case_id:k.id};
  }
  if(action==='set_registration'){
    const registration=registrationNumber(input.registration_number,{required:true});
    if(registration!==c.registration_number){
      // الرقم منسوخ على كل صفقة انفتحت للعميل (commercial_cases.registration_number لا يتغير)، فبعد أول صفقة يثبت.
      if(c.registration_number&&db.prepare('SELECT 1 FROM commercial_cases WHERE client_id=?').get(c.id))refuse(409,'registration_fixed',{
        what:`رقم سجل العميل ${c.code} ثابت: عليه صفقات انفتحت به`,
        missing:[{document:'تصحيح بيانات العميل بقرار مكتوب',why:'الرقم منسوخ على صفقاته وعقودها، فتغييره هنا يفرّق بين العميل وصفقاته',owner:'مسؤول المنصة',owner_role:'admin'}],
        next:'إذا تغيّر السجل التجاري للجهة فعلًا، افتح ملف عميل جديد برقمها الجديد واربط صفقاتها الجديدة به'});
      const found=conflictsFor(db,u,{registration_number:registration},c.id).filter(x=>x.reasons.includes('registration_number'));
      if(found.length)refuseDuplicate(found);
      db.prepare('UPDATE clients SET registration_number=?,version=version+1 WHERE id=?').run(registration,c.id);
      change={registration_number:{before:c.registration_number,after:registration}};
    }
  }
  let gate=null;
  if(action==='set_status'){
    if(!CLIENT_STATUS[input.status])fail(400,'status','حالة غير صالحة');
    // تغيير حالة العميل هو انتقال هذا الكيان: حقل ألزمه تعريف الصفحة المنشور عنده يوقفه برفض يسمّيه، وقيمه تُكتب في UPDATE نفسها.
    gate=forTransition(db,u,'client',c,'set_status',input.custom_fields);
    db.prepare('UPDATE clients SET status=?,notes=notes||?,custom_fields=?,version=version+1 WHERE id=?').run(input.status,`\n${time.slice(0,10)}: ${v.text(input.note,'سبب تغيير الحالة',1000,5)}`,gate.json,c.id);
  }
  db.prepare('UPDATE clients SET updated_at=? WHERE id=?').run(time,c.id);
  audit(db,u,'client',c.id,'client.'+action,{}, gate?{definition_version:gate.version}:change);
  gate?.audit(c.id);
  return clientView(db,u,db.prepare('SELECT * FROM clients WHERE id=?').get(c.id));
}

/* ───── رصيد العقد الدوري ───── */
function retainerView(db,r){
  const allowances=JSON.parse(r.allowances),usage=db.prepare('SELECT u.*,x.name AS recorded_by_name FROM retainer_usage u JOIN users x ON x.id=u.recorded_by WHERE u.retainer_id=? ORDER BY u.created_at').all(r.id);
  return {...r,allowances:allowances.map(a=>{const used=usage.filter(x=>x.deliverable_type===a.type).reduce((n,x)=>n+x.quantity,0);return {...a,used,remaining:a.quantity-used,over:used>a.quantity};}),usage};
}
export function createRetainer(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['client_id','name','period_month','allowances','contract_reference','carry_over_rule']);
  const c=client(db,u,input.client_id,{owner:true});
  assertClientOpen(db,u.tenant_id,c.id,'ما ينفتح اشتراك');
  if(typeof input.period_month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period_month))fail(400,'period_month','الشهر بصيغة 2026-09');
  if(!Array.isArray(input.allowances)||!input.allowances.length||input.allowances.length>20)fail(400,'allowances','أدخل بندًا واحدًا إلى عشرين');
  const seen=new Set(),allowances=input.allowances.map(a=>{v.object(a,['type','quantity']);const type=v.text(a.type,'نوع المخرج',120,2);if(seen.has(type))fail(400,'allowances','النوع مكرر');seen.add(type);if(!Number.isInteger(a.quantity)||a.quantity<1||a.quantity>1000)fail(400,'allowances','الكمية من 1 إلى 1000');return {type,quantity:a.quantity};});
  const retainerId=id();
  db.prepare('INSERT INTO retainers VALUES(?,?,?,?,?,?,?,?,?,?)').run(retainerId,u.tenant_id,c.id,v.text(input.name,'اسم الاشتراك',180,3),input.period_month,JSON.stringify(allowances),v.text(input.contract_reference,'مرجع بند العقد',500,5),v.text(input.carry_over_rule,'قاعدة الترحيل والتجاوز كما في العقد',1000,5),u.id,now());
  audit(db,u,'retainer',retainerId,'retainer.created',{}, {client:c.code,period:input.period_month});
  return {id:retainerId};
}
export function recordRetainerUsage(db,supplied,retainerId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['deliverable_type','quantity','reference','overage_note']);
  const r=typeof retainerId==='string'&&db.prepare('SELECT * FROM retainers WHERE id=? AND tenant_id=?').get(retainerId,u.tenant_id);
  if(!r)fail(404,'not_found','الاشتراك غير متاح');
  client(db,u,r.client_id);
  assertClientOpen(db,u.tenant_id,r.client_id,'ما ينسجّل استهلاك');
  const view=retainerView(db,r),line=view.allowances.find(a=>a.type===input.deliverable_type);
  if(!line)fail(400,'deliverable_type','النوع ليس من بنود هذا الاشتراك. ما خارج الرصيد يحتاج طلب تغيير نطاق');
  if(!Number.isInteger(input.quantity)||input.quantity<1||input.quantity>1000)fail(400,'quantity','الكمية من 1 إلى 1000');
  // التجاوز لا يُمنع ولا يمر صامتًا: يلزم سببه ومن وافق عليه بحسب العقد.
  const over=line.used+input.quantity>line.quantity;
  if(over&&!(typeof input.overage_note==='string'&&input.overage_note.trim().length>=10))fail(409,'overage_requires_note',`هذا يتجاوز الرصيد المتبقي (${line.remaining}). اكتب سند التجاوز بحسب العقد`);
  db.prepare('INSERT INTO retainer_usage VALUES(?,?,?,?,?,?,?,?)').run(id(),r.id,line.type,input.quantity,v.text(input.reference,'مرجع المخرج',500,3),over?input.overage_note.trim():'',u.id,now());
  audit(db,u,'retainer',r.id,'retainer.usage',{}, {type:line.type,quantity:input.quantity,over});
  return retainerView(db,r);
}

/* ───── كتالوج الباقات التجارية ───── */
function cleanOffering(input){
  if(!FAMILIES.some(f=>f.key===input.family))fail(400,'family','اختر عائلة الخدمة');
  if(!PRICING_MODELS.some(m=>m.key===input.pricing_model))fail(400,'pricing_model','اختر نموذج التسعير');
  const c=v.object(input.content,['audience','problem','scope','deliverables','inputs','exclusions','rights','acceptance','kpis','roles_hours','dependencies']);
  if(!Array.isArray(c.deliverables)||!c.deliverables.length||c.deliverables.length>30)fail(400,'deliverables','أدخل مخرجًا واحدًا إلى ثلاثين، قابلة للعد');
  const deliverables=c.deliverables.map(d=>{v.object(d,['name','unit','quantity','revisions']);if(!Number.isInteger(d.quantity)||d.quantity<1||d.quantity>10000||!Number.isInteger(d.revisions)||d.revisions<0||d.revisions>20)fail(400,'deliverables','الكمية وعدد التعديلات أعداد صحيحة');return {name:v.text(d.name,'اسم المخرج',180,2),unit:v.text(d.unit,'الوحدة',60,1),quantity:d.quantity,revisions:d.revisions};});
  const text=(key,label,min=10)=>v.text(c[key],label,3000,min);
  let price=null;
  if(input.price!==undefined&&input.price!==''){if(typeof input.price!=='string'||!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(input.price))fail(400,'price','السعر مبلغ بخانتين عشريتين');const [w,f='']=input.price.split('.');price=Number(BigInt(w)*100n+BigInt(f.padEnd(2,'0')));if(price<=0)price=null;}
  return {family:input.family,name:v.text(input.name,'اسم الباقة',180,3),pricing_model:input.pricing_model,price_minor:price,
    content:JSON.stringify({audience:text('audience','الجمهور المناسب'),problem:text('problem','المشكلة'),scope:text('scope','النطاق'),deliverables,inputs:text('inputs','المدخلات المطلوبة من العميل',5),exclusions:text('exclusions','ما يُستثنى',5),rights:text('rights','حقوق الاستخدام',5),acceptance:text('acceptance','تعريف القبول',5),kpis:text('kpis','المؤشرات',5),roles_hours:c.roles_hours?v.text(c.roles_hours,'الأدوار والساعات المتوقعة',3000):'',dependencies:c.dependencies?v.text(c.dependencies,'التبعيات',3000):''})};
}
function offeringView(db,u,o,manage){
  const actions=[];
  if(o.status==='draft'&&o.prepared_by!==u.id&&manage)actions.push('approve_offering','reject_offering');
  if(o.status==='approved'&&manage)actions.push('revise_offering','retire_offering');
  return {...o,content:JSON.parse(o.content),family_name:FAMILIES.find(f=>f.key===o.family)?.name,pricing_name:PRICING_MODELS.find(m=>m.key===o.pricing_model).name,prepared_by_name:name(db,o.prepared_by),decided_by_name:name(db,o.decided_by),actions};
}
export function offeringsBoard(db,supplied){
  const u=actor(db,supplied),manage=can(db,u,'offerings.manage');
  // الكل يرى الباقات المعتمدة؛ المسودات والأسعار لحامل تصريح الكتالوج.
  const rows=db.prepare(`SELECT * FROM offerings WHERE tenant_id=? ${manage?'':"AND status='approved'"} ORDER BY family,code,revision DESC`).all(u.tenant_id).map(o=>offeringView(db,u,o,manage)).map(o=>manage?o:{...o,price_minor:null,price_hidden:true});
  return {user_id:u.id,can_manage:manage,families:FAMILIES,pricing_models:PRICING_MODELS,offerings:rows,note:'لا أسعار افتراضية ولا هوامش مفترضة: السعر يدخله صاحب العمل، والباقة بلا سعر تُسعَّر عند العرض.'};
}
export function prepareOffering(db,supplied,input,revisesId=null){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'offerings.manage'))fail(403,'not_permitted','إعداد الباقات لحامل تصريح الكتالوج');
  v.object(input,['family','name','pricing_model','price','content']);
  const o=cleanOffering(input);let code,revision=1;
  if(revisesId){
    const previous=db.prepare("SELECT * FROM offerings WHERE id=? AND tenant_id=? AND status='approved'").get(revisesId,u.tenant_id);
    if(!previous)fail(404,'not_found','الباقة المعتمدة غير متاحة للتنقيح');
    if(db.prepare("SELECT 1 FROM offerings WHERE tenant_id=? AND code=? AND status='draft'").get(u.tenant_id,previous.code))fail(409,'draft_exists','توجد مسودة تنقيح لهذه الباقة');
    code=previous.code;revision=db.prepare('SELECT MAX(revision) AS n FROM offerings WHERE tenant_id=? AND code=?').get(u.tenant_id,code).n+1;
  }else code='OF-'+String(db.prepare("SELECT COALESCE(MAX(CAST(substr(code,4) AS INTEGER)),0)+1 AS n FROM offerings WHERE tenant_id=? AND code LIKE 'OF-%'").get(u.tenant_id).n).padStart(3,'0');
  const offeringId=id();
  db.prepare("INSERT INTO offerings(id,tenant_id,code,revision,family,name,content,pricing_model,price_minor,status,prepared_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?)").run(offeringId,u.tenant_id,code,revision,o.family,o.name,o.content,o.pricing_model,o.price_minor,u.id,now());
  audit(db,u,'offering',offeringId,'offering.prepared',{}, {code,revision});
  return {id:offeringId};
}
export function offeringAction(db,supplied,offeringId,action,input){
  writing(db);const u=actor(db,supplied);
  if(!can(db,u,'offerings.manage'))fail(403,'not_permitted','قرار الباقات لحامل تصريح الكتالوج');
  v.object(input,['note']);
  const o=typeof offeringId==='string'&&db.prepare('SELECT * FROM offerings WHERE id=? AND tenant_id=?').get(offeringId,u.tenant_id);
  if(!o||!offeringView(db,u,o,true).actions.includes(action)||action==='revise_offering')fail(409,'action_unavailable','الإجراء غير متاح. من أعد الباقة لا يعتمدها');
  const status={approve_offering:'approved',reject_offering:'rejected',retire_offering:'retired'}[action],time=now();
  // اعتماد تنقيح يسحب الإصدار المعتمد السابق، فلا تُباع نسختان من الباقة نفسها.
  if(status==='approved')db.prepare("UPDATE offerings SET status='retired' WHERE tenant_id=? AND code=? AND status='approved'").run(u.tenant_id,o.code);
  db.prepare('UPDATE offerings SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,status==='retired'?o.decided_by:u.id,status==='retired'?o.decided_at:time,v.text(input.note,'أساس القرار',2000,status==='approved'?3:10),o.id);
  audit(db,u,'offering',o.id,'offering.'+status,{status:o.status},{status});
  return offeringView(db,u,db.prepare('SELECT * FROM offerings WHERE id=?').get(o.id),true);
}

/* ───── قوالب المشاريع ───── */
export function templatesBoard(db,supplied){
  const u=actor(db,supplied);
  const templates=db.prepare('SELECT * FROM project_templates WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id).map(t=>({...t,phases:JSON.parse(t.phases),created_by_name:name(db,t.created_by)}));
  const projects=db.prepare('SELECT p.* FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.created_at DESC').all(u.tenant_id,u.id).filter(p=>{const manager=projectManagerOfRecord(db,p);return manager.available&&manager.id===u.id;}).map(p=>({id:p.id,name:p.name,members:db.prepare('SELECT x.id,x.name FROM project_members m JOIN users x ON x.id=m.user_id WHERE m.project_id=? AND x.active=1').all(p.id)}));
  return {today:riyadhToday(),user_id:u.id,can_create:['manager','pm'].includes(u.role),templates,projects};
}
export function createTemplate(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  if(!['manager','pm'].includes(u.role))fail(403,'forbidden','إنشاء القوالب لمديري المشاريع والفرق');
  v.object(input,['name','service_kind','phases']);
  if(!Array.isArray(input.phases)||!input.phases.length||input.phases.length>12)fail(400,'phases','أدخل مرحلة واحدة إلى اثنتي عشرة');
  let count=0;
  const phases=input.phases.map(p=>{v.object(p,['name','tasks']);if(!Array.isArray(p.tasks)||!p.tasks.length||p.tasks.length>25)fail(400,'tasks','لكل مرحلة مهمة واحدة إلى خمس وعشرين');
    return {name:v.text(p.name,'اسم المرحلة',120,2),tasks:p.tasks.map(t=>{v.object(t,['title','offset_days','acceptance']);if(!Number.isInteger(t.offset_days)||t.offset_days<0||t.offset_days>730)fail(400,'offset_days','موعد المهمة بالأيام من بداية المشروع، من 0 إلى 730');count++;return {title:v.text(t.title,'عنوان المهمة',150,3),offset_days:t.offset_days,acceptance:v.text(t.acceptance,'معيار القبول',2000,3)};})};});
  if(count>80)fail(400,'tasks','القالب لا يتجاوز ثمانين مهمة');
  const templateId=id();
  db.prepare('INSERT INTO project_templates(id,tenant_id,name,service_kind,phases,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(templateId,u.tenant_id,v.text(input.name,'اسم القالب',180,3),v.text(input.service_kind,'نوع الخدمة',120,2),JSON.stringify(phases),u.id,now());
  audit(db,u,'project_template',templateId,'template.created',{}, {tasks:count});
  return {id:templateId};
}
export function applyTemplate(db,supplied,templateId,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['project_id','start_date','assignee_id']);
  const template=typeof templateId==='string'&&db.prepare('SELECT * FROM project_templates WHERE id=? AND tenant_id=? AND active=1').get(templateId,u.tenant_id);
  if(!template)fail(404,'not_found','القالب غير متاح');
  if(db.prepare('SELECT 1 FROM project_template_uses WHERE template_id=? AND project_id=?').get(template.id,input.project_id))fail(409,'already_applied','طُبق هذا القالب على المشروع؛ تكراره يكرر المهام');
  // بوابة PM-01 (ترحيل 109): قالب المهام خطة تنفيذ. الرفض يسمي الوثيقة الناقصة ومن يقدّمها.
  assertExecutionAllowed(db,u.tenant_id,input.project_id,'تطبيق قالب مهام على مشروع مستلَم');
  const start=v.date(input.start_date);let created=0;
  // المهام تُنشأ بمسار المشاريع نفسه، فتسري عليها صلاحياته: مالك المشروع فقط، والمكلف عضو فيه.
  for(const phase of JSON.parse(template.phases))for(const task of phase.tasks){createTask(db,u,input.project_id,{title:`${phase.name} — ${task.title}`.slice(0,180),assignee_id:input.assignee_id,due_date:addDays(start,task.offset_days),acceptance:task.acceptance});created++;}
  db.prepare('INSERT INTO project_template_uses VALUES(?,?,?,?,?,?,?)').run(id(),template.id,input.project_id,start,created,u.id,now());
  audit(db,u,'project',input.project_id,'template.applied',{}, {template_id:template.id,tasks:created});
  return {tasks_created:created};
}

/* ───── ساعات العمل والسعة ───── */
function weekOf(date){const d=new Date(date+'T00:00:00Z'),start=addDays(date,-d.getUTCDay());return {from:start,to:addDays(start,6)};}
export function timeBoard(db,supplied,weekDate){
  const u=actor(db,supplied),today=riyadhToday(),week=weekOf(weekDate?v.date(weekDate):today);
  const projects=db.prepare('SELECT p.id,p.name FROM projects p JOIN project_members m ON m.project_id=p.id WHERE p.tenant_id=? AND m.user_id=? ORDER BY p.name').all(u.tenant_id,u.id);
  const mine=db.prepare('SELECT t.*,p.name AS project_name FROM time_entries t JOIN projects p ON p.id=t.project_id WHERE t.user_id=? AND t.work_date BETWEEN ? AND ? ORDER BY t.work_date,t.created_at').all(u.id,week.from,week.to);
  const team=db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND manager_id=? AND active=1 ORDER BY name').all(u.tenant_id,u.id);
  const capacity=person=>{
    // السعة من ساعات العقد الساري إن وُجد، وإلا أربعون ساعة افتراضًا معلنًا؛ تُطرح أيام الإجازة المعتمدة.
    const contract=db.prepare("SELECT weekly_hours FROM employment_contracts WHERE user_id=? AND status='active'").get(person.id),weekly=(contract?.weekly_hours??40)*60;
    let leaveDays=0;for(const r of db.prepare("SELECT work_dates_json FROM leave_requests WHERE employee_id=? AND status='approved' AND end_date>=? AND start_date<=?").all(person.id,week.from,week.to))leaveDays+=JSON.parse(r.work_dates_json).filter(d=>d>=week.from&&d<=week.to).length;
    const available=Math.max(0,weekly-Math.round(weekly/5)*leaveDays);
    const sums=db.prepare("SELECT COALESCE(SUM(minutes),0) AS total,COALESCE(SUM(CASE WHEN billable=1 THEN minutes ELSE 0 END),0) AS billable FROM time_entries WHERE user_id=? AND work_date BETWEEN ? AND ? AND status<>'rejected'").get(person.id,week.from,week.to);
    return {id:person.id,name:person.name,available_minutes:available,assumed_hours:!contract,leave_days:leaveDays,logged_minutes:sums.total,billable_minutes:sums.billable,utilization_bp:available?Math.round(sums.total*10000/available):null};
  };
  const pending=db.prepare("SELECT t.*,x.name AS employee_name,p.name AS project_name FROM time_entries t JOIN users x ON x.id=t.user_id JOIN projects p ON p.id=t.project_id WHERE t.tenant_id=? AND t.status='logged' AND x.manager_id=? ORDER BY t.work_date").all(u.tenant_id,u.id);
  return {today,week,user_id:u.id,projects,entries:mine,me:capacity({id:u.id,name:u.name}),team:team.map(capacity),pending,note:'الاستغلال مؤشر تخطيط لا هدف: لا تُستهدف نسبة 100%، ولا تُستخدم الدقائق المسجلة لتقييم الأشخاص.'};
}
export function logTime(db,supplied,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['project_id','work_date','minutes','billable','note']);
  if(!db.prepare('SELECT 1 FROM project_members m JOIN projects p ON p.id=m.project_id WHERE m.project_id=? AND m.user_id=? AND p.tenant_id=?').get(input.project_id,u.id,u.tenant_id))fail(404,'not_found','المشروع غير متاح لك');
  const date=v.date(input.work_date),today=riyadhToday();
  if(date>today||date<addDays(today,-31))fail(400,'work_date','تُسجل الساعات ليوم مضى خلال 31 يومًا');
  if(!Number.isInteger(input.minutes)||input.minutes<15||input.minutes>960||input.minutes%15)fail(400,'minutes','المدة بمضاعفات 15 دقيقة، من 15 إلى 960');
  const day=db.prepare("SELECT COALESCE(SUM(minutes),0) AS n FROM time_entries WHERE user_id=? AND work_date=? AND status<>'rejected'").get(u.id,date).n;
  if(day+input.minutes>960)fail(409,'day_exceeded','مجموع ساعات اليوم يتجاوز ست عشرة ساعة');
  const entryId=id();
  db.prepare("INSERT INTO time_entries(id,tenant_id,user_id,project_id,work_date,minutes,billable,note,status,created_at) VALUES(?,?,?,?,?,?,?,?,'logged',?)").run(entryId,u.tenant_id,u.id,input.project_id,date,input.minutes,input.billable===true?1:0,v.text(input.note,'ما الذي أُنجز',1000,3),now());
  audit(db,u,'time_entry',entryId,'time.logged',{}, {project_id:input.project_id,minutes:input.minutes});
  return {id:entryId};
}
export function decideTime(db,supplied,entryId,decision,input){
  writing(db);const u=actor(db,supplied);
  v.object(input,['note']);
  if(!['approve','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  const t=typeof entryId==='string'&&db.prepare("SELECT t.*,x.manager_id FROM time_entries t JOIN users x ON x.id=t.user_id WHERE t.id=? AND t.tenant_id=? AND t.status='logged'").get(entryId,u.tenant_id);
  if(!t||t.manager_id!==u.id||t.user_id===u.id)fail(404,'not_found','السجل غير متاح لك');
  const status=decision==='approve'?'approved':'rejected';
  db.prepare('UPDATE time_entries SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),decision==='reject'?v.text(input.note,'سبب الرفض',1000,10):(input.note?v.text(input.note,'ملاحظة',1000):''),t.id);
  audit(db,u,'time_entry',t.id,'time.'+status,{status:'logged'},{status});
  return {id:t.id,status};
}
export function removeTime(db,supplied,entryId){
  writing(db);const u=actor(db,supplied);
  const t=typeof entryId==='string'&&db.prepare("SELECT * FROM time_entries WHERE id=? AND user_id=? AND status='logged'").get(entryId,u.id);
  if(!t)fail(404,'not_found','لا يُحذف إلا سجلك غير المعتمد');
  db.prepare('DELETE FROM time_entries WHERE id=?').run(t.id);
  audit(db,u,'time_entry',t.id,'time.removed',{minutes:t.minutes,work_date:t.work_date},{});
  return {removed:true};
}

/* ───── واصف الكيان في سجل التعريفات (ترحيل 123) ───── */
// «العميل» اسم هذا الكيان، وحقل client_id المرجعي في عرض السعر والفرصة يرث تسميته منه: تبديل واحد («العميل» ← «الجهة»)
// يصل الشاشات الثلاث ونماذج الطلبات والنماذج الإلكترونية (definitions.applyTerms). القراءة لفرق التشغيل بعضوية فريق الحساب
// كما تحكم هذه الوحدة، وتعديل التعريف لحامل clients.manage. وتغيير الحالة لمسؤول الحساب بملكيته لا بتصريح، فانتقاله بلا تصريح
// بعينه (capability:null): حقل يُلزَم عنده لا يُحجب ولا يُقيَّد تعديله، ويرفض validateSpec غير ذلك.
const CLIENT_OWNER='مسؤول الحساب في فريق العميل';
const memberRows=(db,u)=>db.prepare('SELECT DISTINCT c.* FROM clients c LEFT JOIN client_members m ON m.client_id=c.id AND m.removed_at IS NULL WHERE c.tenant_id=? AND (c.owner_id=? OR m.user_id=?) ORDER BY c.code').all(u.tenant_id,u.id,u.id);
registerEntity({key:'client',table:'clients',label:{ar:'العميل',en:'Client'},views:['clients'],
  working_capability:'clients.manage',owner:CLIENT_OWNER,owner_role:'pm',
  statuses:CLIENT_STATUS,final_statuses:[],
  transitions:{set_status:{label:'تغيير حالة العميل',capability:null}},
  system_fields:[{key:'code',label:'رمز العميل',label_en:'Client code'},{key:'legal_name',label:'الاسم القانوني',label_en:'Legal name'},
    {key:'trade_name',label:'الاسم التجاري',label_en:'Trade name'},{key:'sector',label:'القطاع',label_en:'Sector'},
    {key:'status',label:'الحالة',label_en:'Status',type:'status'},{key:'owner_id',label:'مسؤول الحساب',label_en:'Account owner'},{key:'notes',label:'ملاحظات',label_en:'Notes'}],
  slots:['header','body'],slot_names:{header:'ترويسة ملف العميل',body:'متن ملف العميل'},
  code:c=>c.code,link:c=>`#clients?focus=${c.id}`,
  is_final:()=>false,
  readable:(db,u)=>['employee','manager','pm'].includes(u.role),
  // التفويض على مستوى السجل: عضوية فريق الحساب (client). الكتابة لمسؤول الحساب، أو لعضو فيه يحمل تصريح ملفات العملاء.
  load(db,supplied,clientId,{write=false}={}){
    const u=actor(db,supplied),c=client(db,u,clientId);
    if(write&&c.owner_id!==u.id&&!can(db,u,'clients.manage'))refuse(403,'forbidden',{what:`حقول ملف العميل ${c.code} يعدّلها مسؤول حسابه`,
      missing:[{document:'مسؤول الحساب، أو عضو في فريقه يحمل تصريح «ملفات العملاء وفرق الحسابات»',why:'بيانات الملف يعدّلها من يملك الحساب',owner:name(db,c.owner_id)??CLIENT_OWNER,owner_role:'pm'}],
      next:'اطلب من مسؤول الحساب إدخال القيمة'});
    return c;
  },
  list:(db,supplied)=>memberRows(db,actor(db,supplied)),
  columns:[{key:'code',label:'رمز العميل',value:c=>c.code},{key:'legal_name',label:'الاسم القانوني',value:c=>c.legal_name},{key:'trade_name',label:'الاسم التجاري',value:c=>c.trade_name},
    {key:'sector',label:'القطاع',value:c=>c.sector},{key:'status',label:'الحالة',value:(c,db,u)=>statusLabel(db,u.tenant_id,'client',c.status,CLIENT_STATUS[c.status])},
    {key:'owner_id',label:'مسؤول الحساب',value:(c,db)=>name(db,c.owner_id)??''}]});
