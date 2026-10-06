import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import * as v from './validation.mjs';
import { personName } from './people-read.mjs';
import { getRequest } from './workflow.mjs';
import { validateOutputRecordState } from './service-output-validation.mjs';

export const DEEPEN_OUTPUT_SERVICES=Object.freeze([
  'CRM-HANDOVER','CRM-OPPORTUNITY','CRM-PRICING','PRO-DELIVERY','PRO-EQUIPMENT','PRO-FREELANCER','PRO-LOCATION','PRO-SHOOT',
  'DIG-BUDGET-CHANGE','DIG-CAMPAIGN','DIG-CAMPAIGN-CLOSE','DIG-PERFORMANCE-REPORT','DIG-SOCIAL-POST','ACC-CHANGE-REQUEST','CRT-DESIGN',
  'INF-CAMPAIGN','INF-CONTENT-APPROVAL','INF-CONTRACT','INF-PROOF-PAYMENT','PR-ISSUE-ALERT','DAT-AI-USE','DAT-DASHBOARD','PMO-NEW-PROJECT',
  'GOV-CONFLICT-DISCLOSURE','LEG-PRIVACY-REQUEST','FIN-CLIENT-INVOICE','FIN-PAYMENT-REQUEST','FIN-REFUND','PRC-EMERGENCY','PRC-PO-CHANGE',
  'PRC-PURCHASE-REQUEST','PRC-VENDOR-EVALUATION','PRC-VENDOR-REGISTRATION','IT-NEW-ACCOUNT','IT-OUTAGE','IT-PASSWORD-UNLOCK',
  'IT-SECURITY-INCIDENT','HR-BANK-CHANGE','HR-HIRING-NEED','HR-RETRO-ADJUSTMENT','ADM-SAFETY','ADM-TRAVEL'
]);

export const CONNECTED_SERVICE_MODULES=Object.freeze({
  'GOV-POLICY':'policy-library','GOV-RISK':'risks','LEG-WHISTLEBLOW':'hr-cases','FIN-BUDGET-TRANSFER':'budgets',
  'FIN-TAX-QUERY':'einvoice-selfcheck','IT-PLATFORM-FEEDBACK':'catalog-quality','HR-EXIT-INTERVIEW':'lifecycle',
  'HR-GOSI-CORRECTION':'payroll-insurance','HR-JOB-CHANGE':'employees','HR-REFERRAL':'people',
  'TAL-SUCCESSION':'growth','ADM-SUBSCRIPTION':'contracts-register'
});

const c=(module,output_label,route,source)=>({module,output_label,route,source,requires_attachment:source==='attachment'});
const CONTRACTS={
  'CRM-HANDOVER':c('commercial','ملف فرصة مسلّم للتشغيل','#commercial','commercial_cases'),
  'CRM-OPPORTUNITY':c('commercial','فرصة مسجلة','#commercial','commercial_cases'),
  'CRM-PRICING':c('commercial','ملف تجاري بالتسعير المعتمد','#commercial','commercial_cases'),
  'PRO-DELIVERY':c('studio','حزمة تسليم نهائية','#studio','studio_workspaces'),
  'PRO-EQUIPMENT':c('equipment','حجز معدات مسجل','#equipment','equipment_bookings'),
  'PRO-FREELANCER':c('productions','إنتاج مسجل بطاقمه','#productions','productions'),
  'PRO-LOCATION':c('productions','إنتاج مسجل بموقعه','#productions','productions'),
  'PRO-SHOOT':c('productions','سجل إنتاج وتصوير','#productions','productions'),
  'DIG-BUDGET-CHANGE':c('media-spend','نسخة خطة صرف إعلامي','#media-spend','media_plans'),
  'DIG-CAMPAIGN':c('campaigns','حملة رقمية مسجلة','#campaigns','campaigns'),
  'DIG-CAMPAIGN-CLOSE':c('campaigns','حملة مقفلة بنتيجتها','#campaigns','campaigns'),
  'DIG-PERFORMANCE-REPORT':c('reports','لقطة تقرير أداء محفوظة','#reports','report_snapshots'),
  'DIG-SOCIAL-POST':c('content','عنصر محتوى مجدول','#content','content_items'),
  'ACC-CHANGE-REQUEST':c('scope','سجل تغيير نطاق','#scope','scope_baselines'),
  'CRT-DESIGN':c('studio','مساحة تصميم بمخرجها','#studio','studio_workspaces'),
  'INF-CAMPAIGN':c('influencers','ارتباط حملة مؤثرين','#influencers','influencer_engagements'),
  'INF-CONTENT-APPROVAL':c('influencers','ارتباط مؤثر بمحتواه المعتمد','#influencers','influencer_engagements'),
  'INF-CONTRACT':c('influencers','ارتباط مؤثر بعقده','#influencers','influencer_engagements'),
  'INF-PROOF-PAYMENT':c('influencers','ارتباط مؤثر بإثباته وسداده','#influencers','influencer_engagements'),
  'PR-ISSUE-ALERT':c('request-evidence','تقرير معالجة القضية الإعلامية','#request','attachment'),
  'DAT-AI-USE':c('ai-governance','أصل ذكاء اصطناعي مقيم','#ai-governance','ai_assets'),
  'DAT-DASHBOARD':c('reports','لقطة تقرير أو لوحة محفوظة','#reports','report_snapshots'),
  'PMO-NEW-PROJECT':c('commercial','ملف تجاري مرتبط بالمشروع','#commercial','commercial_cases'),
  'GOV-CONFLICT-DISCLOSURE':c('procurement-extras','إفصاح تضارب مصالح مسجل','#procurement-extras','vendor_conflict_disclosures'),
  'LEG-PRIVACY-REQUEST':c('privacy','طلب صاحب بيانات مسجل','#privacy','subject_requests'),
  'FIN-CLIENT-INVOICE':c('receivables','استحقاق عميل مسجل','#receivables','ar_claims'),
  'FIN-PAYMENT-REQUEST':c('payables','أمر دفع مسجل','#payables','payment_orders'),
  'FIN-REFUND':c('invoices','مستند فاتورة أو إشعار دائن','#invoices','tax_invoices'),
  'PRC-EMERGENCY':c('procurement-extras','طلب شراء طارئ مسجل','#procurement-extras','procurement_purchases'),
  'PRC-PO-CHANGE':c('procurement-extras','أمر شراء بسجل تعديله','#procurement-extras','procurement_purchases'),
  'PRC-PURCHASE-REQUEST':c('procurement','طلب شراء مسجل','#procurement','procurement_purchases'),
  'PRC-VENDOR-EVALUATION':c('vendors','ملف مورد بتقييمه','#vendors','vendors'),
  'PRC-VENDOR-REGISTRATION':c('vendors','ملف مورد مسجل','#vendors','vendors'),
  'IT-NEW-ACCOUNT':c('lifecycle','حزمة انضمام مسجلة','#lifecycle','lifecycle_bundles'),
  'IT-OUTAGE':c('request-evidence','تقرير سبب الانقطاع والمعالجة','#request','attachment'),
  'IT-PASSWORD-UNLOCK':c('request-evidence','محضر تحقق الاستعادة دون بيانات سرية','#request','attachment'),
  'IT-SECURITY-INCIDENT':c('request-evidence','تقرير احتواء الحادث الأمني','#request','attachment'),
  'HR-BANK-CHANGE':c('payroll-extras','حساب راتب متحقق','#payroll-extras','employee_bank_accounts'),
  'HR-HIRING-NEED':c('people','احتياج وظيفي مسجل','#people','people_requisitions'),
  'HR-RETRO-ADJUSTMENT':c('payroll-extras','تسوية أثر رجعي مسجلة','#payroll-extras','payroll_retro'),
  'ADM-SAFETY':c('request-evidence','تقرير معالجة بلاغ السلامة','#request','attachment'),
  'ADM-TRAVEL':c('travel','قرار انتداب مسجل','#travel','travel_decisions'),
  'GOV-POLICY':c('policy-library','وثيقة سياسة منشورة أو مسودة تنتظر اعتمادها','#policy-library','policy_documents'),
  'GOV-RISK':c('risks','خطر مؤسسي مسجل','#risks','governance_risks'),
  'LEG-WHISTLEBLOW':c('hr-cases','حالة مقيدة مسجلة','#hr-cases','hr_cases'),
  'FIN-BUDGET-TRANSFER':c('budgets','نسخة مخصص مشروع مسجلة','#budgets','project_budgets'),
  'FIN-TAX-QUERY':c('einvoice-selfcheck','سجل فاتورة ضريبية محل الفحص','#einvoice-selfcheck','tax_invoices'),
  'IT-PLATFORM-FEEDBACK':c('catalog-quality','ملاحظة جودة كتالوج مسجلة','#catalog-quality','service_field_feedback'),
  'HR-EXIT-INTERVIEW':c('lifecycle','حزمة مغادرة ونقل معرفة','#lifecycle','lifecycle_bundles'),
  'HR-GOSI-CORRECTION':c('payroll-insurance','تصحيح تأمينات مسجل','#payroll-insurance','employee_insurance_overrides'),
  'HR-JOB-CHANGE':c('employees','تغيير وظيفي مسجل','#employees','employee_changes'),
  'HR-REFERRAL':c('people','مرشح مسجل على احتياج','#people','people_candidates'),
  'TAL-SUCCESSION':c('growth','خطة تعاقب مسجلة','#growth','succession_plans'),
  'ADM-SUBSCRIPTION':c('contracts-register','عقد اشتراك مسجل','#contracts-register','contract_records'),
  'HR-SALARY-ADVANCE':c('payroll-extras','سلفة معتمدة بخطة سداد؛ لا إثبات تحويل بنكي','#payroll-extras','salary_advances'),
  'HR-DOC-RENEWAL':c('employees','وثيقة سارية في ملف الموظف؛ التجديد الخارجي يدوي','#employees','employee_documents')
};

const TABLES=new Set(Object.values(CONTRACTS).map(x=>x.source).filter(x=>x!=='attachment'));
if(DEEPEN_OUTPUT_SERVICES.some(code=>!CONTRACTS[code])||Object.keys(CONNECTED_SERVICE_MODULES).some(code=>!CONTRACTS[code]))throw new Error('Every governed service needs an output contract');

const actor=actorOrRefuse;
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تسجيل المخرج يحتاج معاملة قاعدة بيانات');}
const row=(db,id,tenantId)=>db.prepare('SELECT * FROM service_outputs WHERE id=? AND tenant_id=?').get(id,tenantId)??null;
const serviceCode=(db,requestId)=>db.prepare('SELECT s.code FROM requests r JOIN services s ON s.id=r.service_id WHERE r.id=?').get(requestId)?.code??null;
const currentRound=(db,request)=>{
  const closed=db.prepare('SELECT COUNT(*) AS n FROM request_closures WHERE request_id=?').get(request.id).n;
  return request.status==='completed'?Math.max(1,closed):closed+1;
};

const contractFor=code=>CONTRACTS[String(code??'').toUpperCase()]??null;
export function outputContract(code){const contract=contractFor(code);if(!contract)return null;const {source,...visible}=contract;return Object.freeze({code:String(code).toUpperCase(),...visible});}
export const requiresServiceOutput=code=>!!outputContract(code);

function validateRecord(db,request,code,contract,recordId){
  if(!TABLES.has(contract.source))fail(500,'output_contract','مصدر المخرج غير مضبوط في عقد الخدمة؛ راجع تعريفه قبل إعادة المحاولة');
  const found=db.prepare(`SELECT * FROM ${contract.source} WHERE id=? AND tenant_id=?`).get(recordId,request.tenant_id);
  if(!found)refuse(409,'output_record_not_found',{what:`لا يوجد سجل مطابق في وحدة «${contract.module}» ضمن كيانك`,next:'افتح الوحدة وسجّل المخرج الفعلي، ثم انسخ معرّفه إلى الطلب'});
  validateOutputRecordState(db,request,code,contract.source,found);
}

function validateStoredOutput(db,request,output){
  const contract=contractFor(output.service_code);
  if(contract.requires_attachment){
    if(!db.prepare('SELECT 1 FROM attachments WHERE id=? AND request_id=?').get(output.attachment_id,request.id))refuse(409,'output_attachment_not_found',{what:'مرفق المخرج غير موجود على الطلب',next:'ارفع المخرج الصحيح ثم سجّله في جولة التنفيذ الحالية'});
  }else validateRecord(db,request,output.service_code,contract,output.record_id);
}

function present(db,u,output,request,round,accepted){
  const recorded=personName(db,output.recorded_by)??'',decided=personName(db,output.decided_by)??'';
  return {...output,recorded_by_name:recorded,decided_by_name:decided,
    actions:output.status==='submitted'&&request.status==='in_progress'&&output.round===round&&!accepted&&u.id===request.requester_id&&u.id!==output.recorded_by?['accept_output','reject_output']:[]};
}

export function serviceOutputView(db,supplied,requestId){
  const u=actor(db,supplied),request=getRequest(db,u,requestId);
  const code=serviceCode(db,request.id),contract=outputContract(code),round=currentRound(db,request);
  const raw=db.prepare('SELECT * FROM service_outputs WHERE request_id=? ORDER BY round,created_at,id').all(request.id);
  const acceptedRaw=raw.find(output=>output.round===round&&output.status==='accepted')??null;
  const outputs=raw.map(output=>present(db,u,output,request,round,acceptedRaw)),current=outputs.filter(output=>output.round===round),accepted=current.find(output=>output.status==='accepted')??null;
  let invalidReason=null;
  if(accepted)try{validateStoredOutput(db,request,accepted);}catch(error){
    if(!['output_record_not_ready','output_record_not_found','output_attachment_not_found'].includes(error.code))throw error;
    invalidReason=error.message;
  }
  return {required:!!contract,contract,round,outputs,current,accepted,closure_ready:!contract||(!!accepted&&!invalidReason),invalid_reason:invalidReason,
    actions:contract&&request.status==='in_progress'&&request.assigned_to===u.id&&!accepted&&!current.some(output=>output.status==='submitted')?['record_output']:[]};
}

// The requester's acceptance is an operational decision, so it must appear in the
// same inbox used by every other decision in the platform.  Keep the board small:
// it exposes only submitted outputs from the request's current execution round.
export function serviceOutputsBoard(db,supplied){
  const u=actor(db,supplied);
  const rows=db.prepare(`SELECT o.*,r.title AS request_title,r.requester_id,r.status AS request_status,
      s.name_ar AS service_name
    FROM service_outputs o
    JOIN requests r ON r.id=o.request_id AND r.tenant_id=o.tenant_id
    JOIN services s ON s.id=r.service_id
    WHERE o.tenant_id=? AND r.requester_id=? AND r.status='in_progress' AND o.status='submitted'
      AND o.recorded_by<>r.requester_id
      AND o.round=(SELECT COUNT(*)+1 FROM request_closures c WHERE c.request_id=r.id)
    ORDER BY o.created_at,o.id`).all(u.tenant_id,u.id);
  return {awaiting_me:rows.map(output=>({
    id:output.request_id,
    title:output.request_title,
    service_name:output.service_name,
    output_title:output.title,
    created_at:output.created_at,
    actions:['accept_output','reject_output']
  }))};
}

export function recordServiceOutput(db,supplied,requestId,input){
  writing(db);const u=actor(db,supplied),request=db.prepare('SELECT * FROM requests WHERE id=? AND tenant_id=?').get(requestId,u.tenant_id);
  if(!request)refuse(404,'not_found',{what:'لا يمكن تسجيل مخرج للطلب المحدد بحسابك',next:'ارجع إلى قائمة الطلبات وافتح الطلب المسند إليك'});
  const code=serviceCode(db,request.id),contract=contractFor(code);
  if(!contract)refuse(409,'output_not_required',{what:'هذه الخدمة لا تستخدم عقد المخرج المحكوم',next:'أكملها من الخطوة التالية العادية في شاشة الطلب'});
  if(request.status!=='in_progress'||request.assigned_to!==u.id)refuse(403,'output_recorder',{what:'تسجيل المخرج لمن يباشر الطلب في جولة التنفيذ الحالية',next:'استلم الطلب للتنفيذ أولًا، أو افتحه بحساب المنفذ المسند إليه'});
  v.object(input,['version','record_id','attachment_id','title','evidence']);v.version(input.version,request.version);
  const title=v.text(input.title,'اسم المخرج',240,5),evidence=v.text(input.evidence,'دليل المخرج',3000,20),round=currentRound(db,request);
  if(db.prepare("SELECT 1 FROM service_outputs WHERE request_id=? AND round=? AND status='accepted'").get(request.id,round))refuse(409,'output_already_accepted',{what:'لجولة الطلب الحالية مخرج قبله صاحب الطلب',next:'أغلق الطلب بوصف ما سُلّم، أو اتركه لصاحب الصلاحية المسند إليه'});
  if(db.prepare("SELECT 1 FROM service_outputs WHERE request_id=? AND round=? AND status='submitted'").get(request.id,round))refuse(409,'output_pending',{what:'يوجد مخرج ينتظر قرار صاحب الطلب',next:'انتظر قبوله أو رفضه؛ إذا رفضه سجّل المخرج المصحح بدلًا منه'});
  let recordId=null,attachmentId=null;
  if(contract.requires_attachment){
    attachmentId=v.text(input.attachment_id,'المرفق',80,1);
    if(!db.prepare('SELECT 1 FROM attachments WHERE id=? AND request_id=?').get(attachmentId,request.id))refuse(409,'output_attachment_not_found',{what:'الملف المختار ليس مرفقًا محفوظًا على هذا الطلب',next:'ارفع ملف التسليم من قسم المرفقات، ثم اختره عند تسجيل المخرج'});
  }else{
    recordId=v.text(input.record_id,'مرجع سجل الوحدة',100,1);validateRecord(db,request,code,contract,recordId);
  }
  const outputId=randomUUID(),time=now();
  db.prepare("INSERT INTO service_outputs(id,tenant_id,request_id,round,service_code,module,record_id,attachment_id,title,evidence,status,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'submitted',?,?)")
    .run(outputId,u.tenant_id,request.id,round,code,contract.module,recordId,attachmentId,title,evidence,u.id,time);
  audit(db,u,'service_output',outputId,'service_output.recorded',{},{request_id:request.id,round,service_code:code,module:contract.module,record_id:recordId,attachment_id:attachmentId},evidence);
  return present(db,u,row(db,outputId,u.tenant_id),request,round,null);
}

export function decideServiceOutput(db,supplied,outputId,input){
  writing(db);const u=actor(db,supplied),output=row(db,outputId,u.tenant_id);
  if(!output)refuse(404,'not_found',{what:'لا يمكن فتح المخرج المحدد بحسابك',next:'افتح الطلب من قائمة طلباتك واختر المخرج الظاهر داخله'});
  const request=db.prepare('SELECT * FROM requests WHERE id=? AND tenant_id=?').get(output.request_id,u.tenant_id);
  if(!request||request.requester_id!==u.id||output.recorded_by===u.id)refuse(403,'requester_only',{what:'قبول المخرج أو رفضه لصاحب الطلب، بيد تختلف عن يد من سجله',next:'اطلب من صاحب الطلب فتحه واتخاذ القرار من حسابه'});
  v.object(input,['version','decision','note']);v.version(input.version,output.version);
  if(output.status!=='submitted')refuse(409,'output_final',{what:'سبق اتخاذ قرار نهائي على هذا المخرج',next:'راجع القرار المسجل في الطلب؛ وإذا كان مرفوضًا ينتظر المنفذ مخرجًا مصححًا'});
  const round=currentRound(db,request);
  if(request.status!=='in_progress'||output.round!==round)refuse(409,'output_round_closed',{what:'هذا المخرج خارج جولة التنفيذ الحالية',next:'افتح المخرج المسجل في الجولة الحالية واتخذ القرار عليه'});
  const status=input.decision==='accept'?'accepted':input.decision==='reject'?'rejected':null;
  if(!status)refuse(400,'decision',{what:'قيمة قرار المخرج غير معروفة',next:'اختر قبول المخرج أو رفضه من الزرين الظاهرين في الطلب'});
  if(status==='accepted')validateStoredOutput(db,request,output);
  if(status==='accepted'&&db.prepare("SELECT 1 FROM service_outputs WHERE request_id=? AND round=? AND status='accepted' AND id<>?").get(request.id,round,output.id))refuse(409,'output_already_accepted',{what:'جولة الطلب الحالية لها مخرج مقبول بالفعل',next:'أغلق الطلب على المخرج المقبول الظاهر في قسم المخرج الفعلي'});
  const note=v.text(input.note,status==='accepted'?'دليل قبول المخرج':'سبب رفض المخرج',1200,10),time=now();
  db.prepare('UPDATE service_outputs SET status=?,decided_by=?,decision_note=?,decided_at=?,version=version+1 WHERE id=?').run(status,u.id,note,time,output.id);
  audit(db,u,'service_output',output.id,`service_output.${status}`,{status:'submitted'},{status,request_id:request.id,round:output.round},note);
  return present(db,u,row(db,output.id,u.tenant_id),request,round,status==='accepted');
}

export function requireAcceptedServiceOutput(db,request){
  const code=serviceCode(db,request.id),contract=contractFor(code);if(!contract)return null;
  const round=currentRound(db,request),accepted=db.prepare("SELECT * FROM service_outputs WHERE request_id=? AND round=? AND status='accepted' ORDER BY decided_at DESC LIMIT 1").get(request.id,round);
  if(!accepted)refuse(409,'service_output_required',{what:`لا يُغلق طلب «${code}» قبل قبول صاحب الطلب للمخرج الفعلي`,missing:[{document:contract.output_label,why:'لم يسجل المنفذ مخرجًا فعليًا ويقبله صاحب الطلب في الجولة الحالية',owner:'منفذ الطلب ثم صاحب الطلب',owner_role:'handler/requester'}],next:'افتح قسم «المخرج الفعلي وإغلاق الخدمة» في الطلب وسجّل المخرج ثم اطلب قبوله',link:`#request/${request.id}`});
  validateStoredOutput(db,request,accepted);
  return accepted;
}
