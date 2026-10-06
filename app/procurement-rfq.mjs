import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { financeCapabilities } from './finance.mjs';
import { holidaySet, addWorkingDays, riyadhDate } from './work-calendar.mjs';
import { personAssignment, personDepartment, personName } from './people-read.mjs';
import { refuse } from './refusal.mjs';

const MAX_MINOR=1_000_000_000_000;
const DECISIONS=new Set(['approved','changes_required','rejected']);
const RESULTS=new Set(['within_rate','exception','no_reference']);

const requireTransaction=db=>{if(!db.isTransaction)fail(500,'transaction_required','كتابة التحقق المالي تحتاج معاملة قاعدة بيانات');};
const installed=db=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='procurement_rfqs'").get();
const optionalText=(value,label,max=180)=>value===undefined||value===null||String(value).trim()===''?null:v.text(value,label,max).normalize('NFKC').trim();
const money=(value,{zero=false,label='المبلغ'}={})=>{
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label} رقم عشري وبمنزلتين على الأكثر`);
  const [whole,fraction='']=value.split('.'),minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if((zero?minor<0n:minor<1n)||minor>BigInt(MAX_MINOR))fail(400,'invalid_money',`${label} خارج الحد العددي المحلي`);
  return Number(minor);
};
const actor=(db,supplied)=>{
  const u=supplied&&personAssignment(db,supplied.tenant_id,supplied.id);
  if(!u?.active)refuse(403,'forbidden',{what:'لا يمكن فتح مسار التحقق المالي بهذا الحساب',missing:[{document:'حساب نشط في الكيان',owner:'مسؤول المنصة'}],next:'فعّل الحساب ثم سجّل الدخول من جديد'});
  return u;
};
const policy=(db,tenantId)=>installed(db)?db.prepare('SELECT * FROM procurement_rfq_policies WHERE tenant_id=?').get(tenantId)??null:null;
export const rfqGateRequired=(db,tenantId)=>policy(db,tenantId)?.required===1;

const reviewOf=(db,rfqId)=>{
  const row=db.prepare('SELECT * FROM procurement_rfq_finance_reviews WHERE rfq_id=?').get(rfqId)??null;
  if(!row)return null;
  return {...row,reviewed_by_name:personName(db,row.reviewed_by),lines:db.prepare('SELECT * FROM procurement_rfq_finance_lines WHERE review_id=? ORDER BY rowid').all(row.id)};
};
const snapshot=(db,row)=>({...row,
  created_by_name:personName(db,row.created_by),
  lines:db.prepare('SELECT * FROM procurement_rfq_lines WHERE rfq_id=? ORDER BY line_no,id').all(row.id),
  finance_review:reviewOf(db,row.id),
  overdue:row.status==='pending_finance'&&row.finance_due_on<riyadhDate(Date.now())
});

export function rfqsForPurchase(db,purchaseId){
  if(!installed(db))return [];
  return db.prepare('SELECT * FROM procurement_rfqs WHERE purchase_id=? ORDER BY revision DESC').all(purchaseId).map(row=>snapshot(db,row));
}

export function currentRfq(db,purchaseId){
  if(!installed(db))return null;
  const row=db.prepare("SELECT * FROM procurement_rfqs WHERE purchase_id=? ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending_finance' THEN 1 ELSE 2 END,revision DESC LIMIT 1").get(purchaseId);
  return row?snapshot(db,row):null;
}

export function rfqActionsForPurchase(db,u,p){
  if(!installed(db))return [];
  const reviewer=p.requester_id!==u.id&&['manager','pm'].includes(u.role),latest=db.prepare('SELECT status FROM procurement_rfqs WHERE purchase_id=? ORDER BY revision DESC LIMIT 1').get(p.id);
  if(!reviewer||p.status!=='awarded'||db.prepare('SELECT 1 FROM procurement_orders WHERE purchase_id=?').get(p.id))return [];
  return !latest||['changes_required','rejected'].includes(latest.status)?['submit_rfq']:[];
}

function rfqNumber(db,tenantId,year){
  const n=Number(db.prepare("SELECT COUNT(*) AS n FROM procurement_rfqs WHERE tenant_id=? AND substr(request_on,1,4)=?").get(tenantId,year).n)+1;
  return `RFQ-${year}-${String(n).padStart(5,'0')}`;
}

export function submitRfq(db,u,p,input){
  requireTransaction(db);
  v.object(input,['purchase_version','quotation_on','vendor_quote_reference','rfp_reference','proposed_payment_terms','valid_until','vat_amount','po_required']);
  v.version(input.purchase_version,p.version);
  if(p.status!=='awarded')fail(409,'award_required','يُرفع طلب عرض السعر للتحقق المالي بعد حفظ الترسية');
  if(p.requester_id===u.id||!['manager','pm'].includes(u.role))fail(403,'rfq_submit_denied','يرفعه مراجع المشتريات المستقل عن صاحب الاحتياج');
  const existing=db.prepare("SELECT status FROM procurement_rfqs WHERE purchase_id=? AND status IN ('pending_finance','approved')").get(p.id);
  if(existing)fail(409,'rfq_already_active',existing.status==='approved'?'التحقق المالي معتمد أصلًا':'طلب عرض السعر ينتظر قرار المالية');
  const award=db.prepare('SELECT * FROM procurement_awards WHERE purchase_id=?').get(p.id),quote=award&&db.prepare('SELECT * FROM procurement_quotes WHERE id=? AND purchase_id=?').get(award.quote_id,p.id);
  if(!quote)refuse(409,'award_required',{what:'لا يُرفع طلب F-03 لأن العرض المرسي غير موجود في الملف',missing:[{document:'عرض مورد مرسي ومحفوظ',owner:'إدارة المشتريات'}],next:'أعد فتح الطلب وحدد عرض المورد قبل رفعه للمالية'});
  const quoteLines=db.prepare('SELECT * FROM procurement_quote_lines WHERE quote_id=? ORDER BY line_no,id').all(quote.id);
  if(!quoteLines.length)fail(409,'quote_lines_missing','العرض المختار بلا تسعير بنود كامل');
  const requestOn=riyadhDate(Date.now()),quotationOn=v.date(input.quotation_on),validUntil=v.date(input.valid_until);
  if(validUntil<quotationOn)fail(400,'rfq_validity','صلاحية العرض لا تسبق تاريخ العرض');
  const vatMinor=money(input.vat_amount,{zero:true,label:'ضريبة العرض'}),total=BigInt(quote.total_minor)+BigInt(vatMinor);
  if(total>BigInt(MAX_MINOR))fail(400,'invalid_money','إجمالي العرض مع الضريبة يتجاوز الحد العددي المحلي');
  if(typeof input.po_required!=='boolean')fail(400,'po_required','حدد هل يحتاج الإجراء أمر شراء');
  const departmentId=personDepartment(db,p.requester_id);
  const department=departmentId?db.prepare('SELECT name FROM departments WHERE id=? AND tenant_id=?').get(departmentId,p.tenant_id)?.name??'غير محددة':'غير محددة';
  const revision=Number(db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM procurement_rfqs WHERE purchase_id=?').get(p.id).n),id=randomUUID(),time=now();
  const values=[id,p.tenant_id,p.id,quote.id,revision,rfqNumber(db,p.tenant_id,requestOn.slice(0,4)),requestOn,optionalText(input.rfp_reference,'مرجع RFP'),department,quotationOn,
    v.text(input.vendor_quote_reference,'مرجع عرض المورد',180),v.text(input.proposed_payment_terms,'شروط الدفع المقترحة',3000,3),validUntil,quote.total_minor,vatMinor,Number(total),'SAR',input.po_required?1:0,
    'pending_finance',addWorkingDays(requestOn,1,holidaySet(db,p.tenant_id)),'F-03/F-04',u.id,p.version,time];
  db.prepare(`INSERT INTO procurement_rfqs(id,tenant_id,purchase_id,quote_id,revision,rfq_number,request_on,rfp_reference,requesting_department,quotation_on,vendor_quote_reference,proposed_payment_terms,valid_until,subtotal_minor,vat_minor,total_minor,currency,po_required,status,finance_due_on,source_reference,created_by,purchase_version,created_at)
    VALUES(${values.map(()=>'?').join(',')})`).run(...values);
  const insert=db.prepare('INSERT INTO procurement_rfq_lines(id,rfq_id,purchase_id,purchase_line_id,line_no,description,specification,quantity,unit,quote_unit_price_minor,quote_total_minor,currency,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const line of quoteLines)insert.run(randomUUID(),id,p.id,line.purchase_line_id,line.line_no,line.description,line.description,line.quantity,line.unit,line.unit_price_minor,line.total_minor,p.currency,time);
  audit(db,u,'procurement_rfq',id,'rfq.submitted',{}, {purchase_id:p.id,quote_id:quote.id,revision,rfq_number:values[5],finance_due_on:values[19],po_required:input.po_required,subtotal_minor:quote.total_minor,vat_minor:vatMinor,total_minor:Number(total)},'F-03/F-04');
  return snapshot(db,db.prepare('SELECT * FROM procurement_rfqs WHERE id=?').get(id));
}

export function submitPurchaseRfq(db,supplied,p,input){
  return submitRfq(db,actor(db,supplied),p,input);
}

export function listFinanceRfqs(db,supplied){
  if(!installed(db))return [];
  const u=actor(db,supplied),permissions=financeCapabilities(db,u);
  if(!permissions.includes('read'))return [];
  return db.prepare("SELECT * FROM procurement_rfqs WHERE tenant_id=? ORDER BY CASE status WHEN 'pending_finance' THEN 0 ELSE 1 END,finance_due_on DESC,created_at DESC LIMIT 200").all(u.tenant_id)
    .map(row=>({...snapshot(db,row),purchase_title:db.prepare('SELECT title FROM procurement_purchases WHERE id=?').get(row.purchase_id)?.title??'',supplier_name:db.prepare('SELECT supplier_name FROM procurement_quotes WHERE id=?').get(row.quote_id)?.supplier_name??'',actions:row.status==='pending_finance'&&permissions.includes('approve')?['finance_review_rfq']:[]}));
}

const signedDifference=(quote,rate)=>{
  const difference=BigInt(quote)-BigInt(rate),basis=rate===0?0:Number((difference*10000n)/BigInt(rate));
  if(difference>BigInt(Number.MAX_SAFE_INTEGER)||difference<BigInt(Number.MIN_SAFE_INTEGER))fail(400,'invalid_money','فرق السعر خارج الحد العددي المحلي');
  return {difference_minor:Number(difference),difference_basis_points:basis};
};

export function reviewRfq(db,supplied,rfqId,input){
  requireTransaction(db);
  const u=actor(db,supplied),permissions=financeCapabilities(db,u);
  if(!permissions.includes('approve'))fail(403,'finance_action_denied','القرار يحتاج تفويض اعتماد مالي صالح');
  v.object(input,['decision','finance_notes','report_number','report_date','lines']);
  if(!DECISIONS.has(input.decision))refuse(400,'invalid_decision',{what:'قيمة قرار المالية لا تطابق القرارات المتاحة',next:'اختر اعتماد الطلب أو إعادته للتعديل أو رفضه'});
  const row=typeof rfqId==='string'&&db.prepare('SELECT * FROM procurement_rfqs WHERE id=? AND tenant_id=?').get(rfqId,u.tenant_id);
  if(!row)refuse(404,'not_found',{what:'طلب عرض السعر المطلوب غير موجود ضمن كيانك',next:'أعد تحميل قائمة المراجعة المالية وافتح طلبًا ظاهرًا فيها'});
  if(row.status!=='pending_finance')fail(409,'rfq_already_decided','اتخذت المالية قرارها على هذا الإصدار');
  const purchase=db.prepare('SELECT * FROM procurement_purchases WHERE id=? AND tenant_id=?').get(row.purchase_id,u.tenant_id),award=db.prepare('SELECT * FROM procurement_awards WHERE purchase_id=?').get(row.purchase_id);
  if([purchase.requester_id,award?.approved_by,row.created_by].includes(u.id))fail(409,'rfq_separation_of_duties','مراجع المالية لازم يكون مختلفًا عن صاحب الاحتياج ومعتمد الترسية ورافع الطلب المالي');
  const sourceLines=db.prepare('SELECT * FROM procurement_rfq_lines WHERE rfq_id=? ORDER BY line_no,id').all(row.id);
  if(!Array.isArray(input.lines)||input.lines.length!==sourceLines.length)refuse(400,'rfq_review_lines',{what:'المراجعة المالية لم تشمل كل بنود عرض المورد مرة واحدة',missing:[{document:'قرار مقارنة لكل بند',owner:'مراجع المالية'}],next:'أكمل نتائج البنود الظاهرة من دون حذف أو تكرار'});
  const byId=new Map(sourceLines.map(line=>[line.id,line])),seen=new Set(),clean=input.lines.map(item=>{
    v.object(item,['rfq_line_id','rate_card_unit_price','result','note']);
    const line=typeof item.rfq_line_id==='string'&&byId.get(item.rfq_line_id);
    if(!line||seen.has(line.id))fail(400,'rfq_review_lines','مقارنة المالية فيها بند ناقص أو مكرر أو غير تابع للطلب');
    seen.add(line.id);
    if(!RESULTS.has(item.result))fail(400,'rfq_review_result','نتيجة مقارنة السعر غير معروفة');
    const note=optionalText(item.note,'ملاحظة مقارنة السعر',1000)??'';
    if(item.result==='no_reference'){
      if(item.rate_card_unit_price!==undefined&&item.rate_card_unit_price!==null&&String(item.rate_card_unit_price)!=='')fail(400,'rfq_review_rate','لا تدخل سعر بطاقة عند اختيار عدم توفر مرجع');
      if(note.length<3)fail(400,'rfq_review_note','عدم توفر سعر مرجعي يحتاج مبررًا مكتوبًا');
      return {line,result:item.result,note,rate:null,difference:null};
    }
    const rate=money(item.rate_card_unit_price,{label:'سعر بطاقة الأسعار'}),difference=signedDifference(line.quote_unit_price_minor,rate);
    if(item.result==='exception'&&note.length<3)fail(400,'rfq_review_note','استثناء السعر يحتاج مبررًا مكتوبًا');
    return {line,result:item.result,note,rate,difference};
  });
  const financeNotes=v.text(input.finance_notes,'ملاحظات المالية',3000,3),reportNumber=v.text(input.report_number,'رقم تقرير التحقق',180),reportDate=v.date(input.report_date);
  const reviewId=randomUUID(),time=now();
  const insert=db.prepare('INSERT INTO procurement_rfq_finance_lines(id,review_id,rfq_id,rfq_line_id,quote_unit_price_minor,rate_card_unit_price_minor,difference_minor,difference_basis_points,result,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for(const item of clean)insert.run(randomUUID(),reviewId,row.id,item.line.id,item.line.quote_unit_price_minor,item.rate,item.difference?.difference_minor??null,item.difference?.difference_basis_points??null,item.result,item.note,time);
  db.prepare('INSERT INTO procurement_rfq_finance_reviews(id,tenant_id,rfq_id,purchase_id,decision,finance_notes,report_number,report_date,reviewed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(reviewId,u.tenant_id,row.id,row.purchase_id,input.decision,financeNotes,reportNumber,reportDate,u.id,time);
  audit(db,u,'procurement_rfq',row.id,'rfq.finance_reviewed',{status:'pending_finance'}, {status:input.decision,report_number:reportNumber,report_date:reportDate,review_id:reviewId},financeNotes);
  return snapshot(db,db.prepare('SELECT * FROM procurement_rfqs WHERE id=?').get(row.id));
}

export function assertApprovedRfqForOrder(db,p,approvedBy){
  if(!rfqGateRequired(db,p.tenant_id))return null;
  const row=db.prepare("SELECT r.*,f.reviewed_by FROM procurement_rfqs r JOIN procurement_rfq_finance_reviews f ON f.rfq_id=r.id AND f.decision='approved' JOIN procurement_awards a ON a.purchase_id=r.purchase_id AND a.quote_id=r.quote_id WHERE r.purchase_id=? AND r.status='approved' ORDER BY r.revision DESC LIMIT 1").get(p.id);
  if(!row)fail(409,'rfq_finance_required','أمر الشراء ينتظر طلب عرض سعر F-03 وتقرير تحقق مالي F-04 معتمد');
  if(row.po_required!==1)fail(409,'rfq_no_po_route','التحقق المالي سجل أن الإجراء لا يحتاج أمر شراء؛ أكمل المسار المالي المباشر بدل إصدار أمر');
  if(row.reviewed_by===approvedBy)fail(409,'rfq_authority_independence','معتمد أمر الشراء لازم يكون مختلفًا عن مراجع المالية');
  return row;
}
