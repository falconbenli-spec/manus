import { now, transaction, audit } from './db.mjs';
import { fail, AppError } from './auth.mjs';
import { requestLetter } from './letters.mjs';
import { submitResignation } from './resignations.mjs';
import { travelFromRequest } from './travel.mjs';
import { riyadhToday } from './payroll-rules.mjs';
import { requireAcceptedServiceOutput } from './service-outputs.mjs';
// الرحلات: وحدة تستورد workflow داخل الدورة نفسها (workflow ← service-routes ← journeys)، ولا تُقرأ إلا داخل الدوال.
import { onRequestTransition } from './journeys.mjs';

// خدمات الكتالوج التي لها وحدة تنفذها فعلًا: الطلب العام يبقى مدخلًا للموظف، لكن العمل يجري في الوحدة، ولا يُغلق الطلب بلا مخرجها.
// - HR-SALARY-CERT وHR-EXPERIENCE-CERT: عند اعتماد الطلب يُفتح طلب خطاب في «خطاباتي» باسم الموظف، ولا يُغلق الطلب قبل إصدار الخطاب
//   (أو رفضه بسبب مكتوب). كان يُغلق بملاحظة نصية بلا مستند (تدقيق البوابة B15).
// - HR-RESIGNATION: عند التقديم يُسجل خطاب الاستقالة المؤرخ في وحدة الاستقالة بساعاتها (م34، م37)، ولا يُغلق الطلب قبل البت فيها.
// - ADM-TRAVEL: عند الاعتماد يُفتح قرار انتداب مقترح يكمله صاحب الصلاحية ويُحسب منه البدل (م63–65).
export const ROUTED_SERVICES={'HR-SALARY-CERT':'letters','HR-EXPERIENCE-CERT':'letters','HR-LETTER':'letters','HR-RESIGNATION':'resignations','ADM-TRAVEL':'travel'};
// عقد الرابط العميق لمعالج الخطاب: خدمات الكتالوج الشبيهة بالخطاب تفتح المعالج بالنوع مختارًا بدل النموذج العام.
export const LETTER_WIZARD_LINKS={'HR-SALARY-CERT':'#letters/new?type=salary','HR-EXPERIENCE-CERT':'#letters/new?type=experience','HR-LETTER':'#letters/new?type=employment'};
const serviceCode=(db,r)=>db.prepare('SELECT code FROM services WHERE id=?').get(r.service_id)?.code??null;
const linkOf=(db,requestId)=>db.prepare('SELECT * FROM service_request_links WHERE request_id=?').get(requestId)??null;
const link=(db,r,module,recordId)=>db.prepare('INSERT INTO service_request_links(request_id,tenant_id,module,record_id,created_at) VALUES(?,?,?,?,?)').run(r.id,r.tenant_id,module,recordId,now());
const within=(db,f)=>db.isTransaction?f():transaction(db,f);
const requester=r=>({id:r.requester_id,tenant_id:r.tenant_id});

function structuredAddressee(db,payload){
  const kinds={بنك:['bank','recipient_bank'],سفارة:['embassy','recipient_embassy'],'جهة حكومية':['government','recipient_government']};
  if(payload.recipient_kind==='لمن يهمه الأمر')return {addressee_kind:'to_whom',addressee_code:null,addressee:''};
  if(payload.recipient_kind==='جهة أخرى')return {addressee_kind:'other',addressee_code:null,addressee:String(payload.recipient_other??'').trim().slice(0,200)};
  const match=kinds[payload.recipient_kind];
  if(match){
    const [kind,key]=match,name=String(payload[key]??'').trim();
    const row=db.prepare('SELECT code FROM letter_addressees WHERE kind=? AND name_ar=? AND active=1').get(kind,name);
    if(!row)fail(409,'letter_addressee_inactive','الجهة المختارة لم تعد نشطة في دليل الخطابات؛ عدّل الطلب واختر جهة متاحة');
    return {addressee_kind:kind,addressee_code:row.code,addressee:''};
  }
  // نسخ الخدمة السابقة تحفظ اسم الجهة في recipient؛ تبقى قابلة للإكمال ولا يُعاد تفسير تاريخها.
  const legacy=String(payload.recipient??'').trim();
  return {addressee_kind:legacy?'other':'to_whom',addressee_code:null,addressee:legacy.slice(0,200)};
}

export function letterType(code,payload){
  if(code==='HR-EXPERIENCE-CERT')return 'experience';
  if(code==='HR-LETTER')return 'employment';
  return payload.show_salary==='بدون راتب'?'employment':'salary';
}
// طلب الخطاب باسم الموظف نفسه إن كان للنوع قالب معتمد؛ وإن كان له طلب مفتوح من النوع نفسه يُربط به.
function ensureLetter(db,r,code){
  const existing=linkOf(db,r.id);if(existing)return existing.record_id;
  const payload=JSON.parse(r.payload),type=letterType(code,payload);
  const published=db.prepare("SELECT 1 FROM letter_templates WHERE tenant_id=? AND type_code=? AND status='published'").get(r.tenant_id,type);
  if(!published)return null;
  const open=db.prepare("SELECT id FROM letter_requests WHERE tenant_id=? AND user_id=? AND type_code=? AND status IN ('requested','prepared')").get(r.tenant_id,r.requester_id,type);
  // خيارات النموذج العام تُترجم إلى خيارات المعالج: اللغة، وتفصيل الراتب، والجهة المرجعية المختارة.
  const recipient=structuredAddressee(db,payload);
  const letterId=open?.id??requestLetter(db,requester(r),{type_code:type,...recipient,
    language:payload.language==='الإنجليزية'?'en':'ar',...(type==='salary'?{salary_detail:payload.show_salary==='نعم'?'breakdown':'total',salary_period:'monthly'}:{}),
    purpose:`من طلب الخدمة «${r.title}»${payload.notes?` — ${payload.notes}`:''}`.slice(0,1000)}).id;
  link(db,r,'letters',letterId);
  return letterId;
}

// يُستدعى من workflow.transition بعد تحديث حالة الطلب.
export function afterTransition(db,u,r,action,status){
  // الرحلات (مركز الخدمات، الدفعة الرابعة): طلبٌ أب بلغ «معتمد» يولّد أبناءه باسم صاحبه، وطلبٌ اكتمل قد يُكمل رحلته.
  // نداءٌ واحد، وr هو الصفّ قبل التحديث كما يصل هنا؛ وما ليس أبًا في JOURNEYS ولا ابنًا في رحلة يمرّ بلا أثر.
  onRequestTransition(db,u,r,status);
  const code=serviceCode(db,r),module=ROUTED_SERVICES[code];
  if(!module)return;
  within(db,()=>{
    if(module==='resignations'&&action==='submit'&&!linkOf(db,r.id)){
      const payload=JSON.parse(r.payload),today=riyadhToday();
      const open=db.prepare("SELECT id FROM resignations WHERE tenant_id=? AND user_id=? AND status IN ('submitted','deferred')").get(r.tenant_id,r.requester_id);
      const resignationId=open?.id??submitResignation(db,requester(r),{letter_date:today,reason:payload.reason||'لم يذكر سببًا',
        proposed_last_day:payload.last_day&&payload.last_day>=today?payload.last_day:today,source_request_id:r.id}).id;
      link(db,r,'resignations',resignationId);
    }
    if(status==='approved'&&r.status!=='approved'){
      if(module==='letters')ensureLetter(db,r,code);
      if(module==='travel'&&!linkOf(db,r.id))link(db,r,'travel',travelFromRequest(db,r));
    }
  });
}
// ── PRC-VENDOR-BANK: التصريح القائم الذي لم تستدعه الخدمة قط (مسح 20 سبتمبر، القسم 4-أ) ──────
// التصريح `vendors.bank` («التحقق المالي من بيانات دفع الموردين») موجود في المنصة ومختبَر في ملف المورد،
// وخدمة «تحديث بيانات دفع مورد» كانت تُغلق بملاحظة نصية بلا أن تمسّه: يُكتب في الطلب أن التحقق جرى،
// ولا يُسجَّل تحقق في سجل المورد. هذا عطب يُصلح مباشرة لا مقترحًا: الطلب لا يُغلق حتى يوجد في سجل المورد
// حسابٌ حُقِّق ماليًا بعد تقديم هذا الطلب، بيد غير يد من جمعه — وهو ما يفرضه vendors.mjs أصلًا.
// المطابقة على المورد بالاسم أو الرمز كما كُتب في الطلب؛ مورد غير مسجل يُردّ بطلب تسجيله أولًا.
const normalize=value=>String(value??'').trim().toLocaleLowerCase('ar').replace(/\s+/g,' ');
export function vendorBankGate(db,r,u){
  const payload=JSON.parse(r.payload),wanted=normalize(payload.vendor);
  if(!wanted)fail(409,'vendor_unnamed','لا يُغلق الطلب بلا اسم مورد في النموذج');
  const vendors=db.prepare("SELECT id,code,legal_name,trade_name FROM vendors WHERE tenant_id=? AND status<>'merged'").all(r.tenant_id)
    // الرمز يُطابق حرفيًا؛ الاسم يُقبل احتواؤه في نص الطلب، بشرط ألا يكون من القصر بحيث يطابق بالمصادفة.
    .filter(x=>normalize(x.code)===wanted||[x.legal_name,x.trade_name].some(name=>{
      const n=normalize(name);return n.length>=3&&(n===wanted||wanted.includes(n));
    }));
  if(!vendors.length)fail(409,'vendor_not_registered',`المورد «${payload.vendor}» غير مسجل في ملف الموردين. سجّله أولًا، فالتحقق المالي من بيانات الدفع يجري في سجله لا في نص الطلب`);
  const submitted=db.prepare('SELECT created_at FROM request_versions WHERE request_id=? ORDER BY revision LIMIT 1').get(r.id)?.created_at??r.created_at;
  const verified=db.prepare(`SELECT id,vendor_id FROM vendor_bank_accounts WHERE vendor_id IN (${vendors.map(()=>'?').join(',')}) AND status='verified' AND verified_at>=?`).get(...vendors.map(x=>x.id),submitted);
  if(!verified)fail(409,'bank_verification_required','لا يُغلق الطلب قبل التحقق المالي من الحساب الجديد في سجل المورد: يسجله من يحمل تصريح «التحقق المالي من بيانات دفع الموردين»، بوسيلة مستقلة، وبيد غير يد من جمع البيانات');
  // أي تحقق أغلق هذا الطلب يبقى مقروءًا في سجله، فلا يُقرأ الإغلاق دليلًا على نفسه.
  if(u)audit(db,u,'request',r.id,'service.vendor_bank_verified',{},{vendor_id:verified.vendor_id,bank_account_id:verified.id});
}
// يُستدعى قبل إغلاق الطلب: الطلب المحوّل لا يُغلق دون مخرج وحدته.
export function beforeComplete(db,r,u){
  const code=serviceCode(db,r),module=ROUTED_SERVICES[code];
  if(code==='PRC-VENDOR-BANK')return vendorBankGate(db,r,u);
  if(module==='letters'){
    const letterId=within(db,()=>ensureLetter(db,r,code));
    if(!letterId)fail(409,'letter_template_required','لا قالب معتمد لهذا الخطاب بعد، فلا يُغلق الطلب بلا خطاب. يعتمد مالك الإجراء القالب ثم يُصدر الخطاب من «خطابات الموظفين»');
    const status=db.prepare('SELECT status FROM letter_requests WHERE id=?').get(letterId)?.status;
    if(!['issued','rejected','cancelled'].includes(status))fail(409,'letter_not_issued','لا يُغلق الطلب قبل إصدار الخطاب من «خطابات الموظفين» (أو رفضه بسبب مكتوب)');
  }
  if(module==='resignations'){
    const l=linkOf(db,r.id),status=l&&db.prepare('SELECT status FROM resignations WHERE id=?').get(l.record_id)?.status;
    if(l&&['submitted','deferred'].includes(status))fail(409,'resignation_open','لا يُغلق طلب الاستقالة قبل قبولها أو قبولها حكمًا أو سحبها في وحدة الاستقالة');
  }
  requireAcceptedServiceOutput(db,r);
}
export const requestLink=(db,requestId)=>linkOf(db,requestId);
// حين يُعتمد قالب نوع: كل طلب كتالوج معتمد من هذا النوع بلا خطاب بعد يُفتح له طلب خطاب. ما يتعذر (جهة نصها غير صالح) يبقى للموارد البشرية.
export function onTemplatePublished(db,tenantId,type){
  const codes=Object.keys(ROUTED_SERVICES).filter(c=>ROUTED_SERVICES[c]==='letters');
  const rows=db.prepare(`SELECT r.* FROM requests r JOIN services s ON s.id=r.service_id WHERE r.tenant_id=? AND r.status IN ('approved','in_progress') AND s.code IN (${codes.map(()=>'?').join(',')})
    AND NOT EXISTS(SELECT 1 FROM service_request_links l WHERE l.request_id=r.id)`).all(tenantId,...codes);
  for(const r of rows){
    const code=serviceCode(db,r);if(letterType(code,JSON.parse(r.payload))!==type)continue;
    db.exec('SAVEPOINT routed_letter');
    try{ensureLetter(db,r,code);db.exec('RELEASE routed_letter');}
    catch(error){db.exec('ROLLBACK TO routed_letter');db.exec('RELEASE routed_letter');if(!(error instanceof AppError))throw error;}
  }
}
// يفتح سجل الوحدة إن لم يُفتح بعد (للخطاب: متى صار للنوع قالب معتمد). يعيد معرف السجل أو null.
export function ensureRoutedRecord(db,r){
  const code=serviceCode(db,r);
  if(ROUTED_SERVICES[code]==='letters')return within(db,()=>ensureLetter(db,r,code));
  return linkOf(db,r.id)?.record_id??null;
}
