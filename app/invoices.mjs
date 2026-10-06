import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import { refuse } from './refusal.mjs';
import { financeCapabilities } from './finance.mjs';
import { adopted } from './options.mjs';
// نسبة ضريبة المخرجات تُقرأ من الجدول المؤرَّخ نفسه الذي تقرؤه ضريبة المدخلات: واصف `finance.vat_rate`
// مسجَّل في app/payables.mjs بأداته التنظيمية لكل مرحلة (5% من 2018-01-01، و15% من 2020-07-01).
// الاستيراد هنا لأثره وحده — التسجيل يقع عند تحميل الوحدة — فلا يُنسخ الجدول مرتين فيفترق النسخان.
import './payables.mjs';
import * as v from './validation.mjs';
import { riyadhDateOf } from './riyadh-time.mjs';

// الفوترة الضريبية داخل المنصة: تُبنى الفاتورة من استحقاق معتمد، ويصدرها شخص غير من أعدها.
// الإصدار هنا داخلي: الترقيم والتسلسل والبصمة جاهزة، والإبلاغ لمنصة «فاتورة» غير متصل ويظهر كذلك.
const CATEGORY_NAMES={standard:'خاضع للنسبة الأساسية',zero_rated:'خاضع لنسبة الصفر',exempt:'معفى',out_of_scope:'خارج نطاق الضريبة'};
// النسبة الأساسية ليست رقمًا مكتوبًا هنا: تُقرأ من الجدول المؤرَّخ وتُلحق بالاسم بنسبة تاريخها.
export const vatCategories=percent=>Object.entries(CATEGORY_NAMES).map(([key,name])=>({key,name:key==='standard'?`${name} ${percent}%`:name}));
export const VAT_CATEGORIES=Object.entries(CATEGORY_NAMES).map(([key,name])=>({key,name}));

// رموز المستند من قوائم UN/ECE. تُكتب مع المستند فتدخل نسخته المؤرشفة لحظة الإصدار، والأرشيف لا
// يُعدَّل بعدها (المحفّز einvoice_archive_no_update) — فما لم يُكتب اليوم لا يدخل تلك النسخة أبدًا.
// **وهذا تثبيت حقول في أرشيف المنصة لا أكثر:** المنصة غير مربوطة بأي جهة ولم تُرسل شيئًا، ولا شيء
// هنا يدّعي توافقًا مع أي مرحلة ولا مطابقة أي مواصفة.
export const DOCUMENT_TYPE_CODES={invoice:'388',credit_note:'381'};                        // UN/CEFACT 1001
export const TAX_CATEGORY_CODES={standard:'S',zero_rated:'Z',exempt:'E',out_of_scope:'O'}; // UN/ECE 5305
// وسيلة السداد: 1 = «غير محددة» في UN/ECE 4461، وهي الصادقة هنا — المستند يصدر قبل القبض، والمنصة
// لا تلتقط وسيلة سداد وقت الإصدار. والقيد في القاعدة لا يقبل غيرها، فلا تُخترع وسيلة لم تُلتقط.
export const PAYMENT_MEANS_CODE='1';
// وحدة السطر: C62 = «وحدة» في توصية UN/ECE رقم 20 — وحدة العدّ حين لا يحمل بند العقد وحدة قياس،
// وبنود العقد في المنصة لا تحمل واحدة. **يحتاج تأكيد المختص الضريبي** إن لزمت وحدات أخرى (ساعة، شهر).
export const UNIT_CODE='C62';
export const STATUS_NAMES={draft:'مسودة',pending:'بانتظار الإصدار',issued:'صادرة',rejected:'مرفوضة'};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const id=()=>randomUUID();

function actor(db,supplied,action='read'){
  const u=supplied&&db.prepare('SELECT id,tenant_id,role,active FROM users WHERE id=? AND tenant_id=? AND active=1').get(supplied.id,supplied.tenant_id);
  if(!u)fail(403,'invoice_access_denied','الحساب غير متاح');
  u.permissions=financeCapabilities(db,u);
  if(!u.permissions.includes(action))fail(403,'invoice_access_denied','لا يوجد تفويض مالي صالح لهذا الإجراء');
  return u;
}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب كتابة الفاتورة معاملة قاعدة بيانات');}
function cleanAddress(input){
  v.object(input,['building','street','district','city','postal_code','country']);
  const country=v.text(input.country??'SA','رمز البلد',2,2).toUpperCase();
  if(!/^[A-Z]{2}$/.test(country))fail(400,'country','رمز البلد حرفان لاتينيان');
  const postal=v.text(input.postal_code,'الرمز البريدي',12,3);
  if(country==='SA'&&!/^\d{5}$/.test(postal))fail(400,'postal_code','الرمز البريدي السعودي خمسة أرقام');
  return {building:v.text(input.building,'رقم المبنى',20,1),street:v.text(input.street,'الشارع',180,2),district:v.text(input.district,'الحي',180,2),city:v.text(input.city,'المدينة',120,2),postal_code:postal,country};
}
const vatNumber=(value,label)=>{const text=v.text(value,label,15,15);if(!/^3\d{13}3$/.test(text))fail(400,'vat_number',`${label}: خمسة عشر رقمًا تبدأ وتنتهي بالرقم 3`);return text;};

export function activeSeller(db,tenantId,date){
  return db.prepare('SELECT * FROM company_tax_profiles WHERE tenant_id=? AND approved_by IS NOT NULL AND effective_from<=? ORDER BY effective_from DESC,approved_at DESC LIMIT 1').get(tenantId,date)??null;
}
const latestBuyer=(db,caseId)=>db.prepare('SELECT * FROM customer_tax_profiles WHERE case_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(caseId)??null;

// وقت الإصدار في الوسم 3 بصيغة YYYY-MM-DDTHH:mm:ssZ: ثانية كاملة بلا كسر. وساعة المنصة تكتب
// بالميلي ثانية (now() في app/db.mjs)، فلو مرّت كما هي لتجمّد الكسر داخل رمز كل مستند — والرمز
// يُكتب في الأرشيف عند الإصدار ولا يُعدَّل بعده (المحفّز einvoice_archive_no_update). التجريد هنا،
// في بناء الرمز وحده: issued_at في السجل يبقى بدقته كما كُتب.
const tlvInstant=value=>String(value).replace(/\.\d+(?=Z$)/,'');
// رمز المرحلة الأولى (TLV): اسم البائع، رقمه الضريبي، وقت الإصدار، الإجمالي، الضريبة. صحته لا تثبت توافق الفاتورة.
export function qrTlv(sellerName,vat,timestamp,total,vatTotal){
  const field=(tag,value)=>{const bytes=Buffer.from(String(value),'utf8');if(bytes.length>255)fail(400,'qr_field','قيمة أطول من حد رمز الفاتورة');return Buffer.concat([Buffer.from([tag,bytes.length]),bytes]);};
  return Buffer.concat([field(1,sellerName),field(2,vat),field(3,tlvInstant(timestamp)),field(4,total),field(5,vatTotal)]).toString('base64');
}
const decimal=minor=>`${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`;
// المبلغ في الاستحقاق شامل الضريبة؛ يُستخرج الصافي بتقريب نصفي للأعلى وتبقى الضريبة هي الفرق فيتطابق الإجمالي دائمًا.
export function splitGross(grossMinor,basisPoints){
  const gross=BigInt(grossMinor),divisor=10000n+BigInt(basisPoints),net=(gross*10000n+divisor/2n)/divisor;
  return {net_minor:Number(net),vat_minor:Number(gross-net),total_minor:Number(gross)};
}

function credited(db,invoiceId,statuses=['issued']){
  return db.prepare(`SELECT COALESCE(SUM(total_minor),0) AS n FROM tax_invoices WHERE original_invoice_id=? AND status IN (${statuses.map(()=>'?').join(',')})`).get(invoiceId,...statuses).n;
}
function actionsFor(db,u,row){
  const out=[];
  if(row.status==='draft'&&row.prepared_by===u.id&&u.permissions.includes('prepare'))out.push('submit');
  if(row.status==='pending'&&row.prepared_by!==u.id&&u.permissions.includes('approve'))out.push('issue','return','reject');
  if(row.kind==='invoice'&&row.status==='issued'&&u.permissions.includes('prepare')&&credited(db,row.id,['draft','pending','issued'])<row.total_minor)out.push('credit');
  return out;
}
// الإبلاغ (الحزمة 3): لا بوابة فوترة إلكترونية مربوطة — المزوّد الافتراضي في app/einvoice-gateway.mjs يرفض كل استدعاء ولا يرسل
// شيئًا — فكل مستند صادر «ما انبلّغ»، مهما قال طابور الإرسال: حالةٌ فيه غير «بانتظار الإرسال» لا تأتي إلا من مزوّد محاكٍ.
// النسخة المطبوعة تقول هذا سطرًا (app/print-documents.mjs)، والواجهة تقوله الآن حقلًا لكل مستند: issuance وreporting وreporting_note.
// وsimulated: المستند أو حالته ليست حقيقة خارجية — الكيان يعلن بياناته تجريبية (tenants.demo_data، الترحيل 137)، أو طابوره يحمل
// حالة من مزوّد محاكٍ. والعمود reporting_status يبقى كما هو ('not_reported' بقيد CHECK)؛ المسودة لا تُقرأ منه «ما انبلّغت» بل «ما صدرت».
export const REPORTING_NOTES={not_reported:'صادرة داخليًا من المنصة وما انبلّغت لمنصة «فاتورة»؛ الربط غير متصل',not_issued:'ما صدرت: لا رقم ضريبي ولا إبلاغ'};
const demoTenant=(db,tenantId)=>db.prepare('SELECT demo_data FROM tenants WHERE id=?').get(tenantId)?.demo_data===1;
function reportingOf(db,row,demo){
  const queue=row.status==='issued'?db.prepare('SELECT status,attempts FROM einvoice_submissions WHERE document_id=?').get(row.id)??null:null;
  const simulatedQueue=!!queue&&queue.status!=='queued',reporting=row.status==='issued'?'not_reported':'not_issued';
  return {issuance:'internal',reporting,reporting_note:REPORTING_NOTES[reporting],simulated:demo||simulatedQueue,
    einvoice_queue:queue&&{status:queue.status,attempts:queue.attempts,simulated:simulatedQueue}};
}
function view(db,u,row,demo=demoTenant(db,u.tenant_id)){
  const name=userId=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
  const issuedCredits=row.kind==='invoice'?credited(db,row.id):0;
  return {...row,...reportingOf(db,row,demo),seller:JSON.parse(row.seller),buyer:JSON.parse(row.buyer),lines:JSON.parse(row.lines),status_name:STATUS_NAMES[row.status],
    prepared_by_name:name(row.prepared_by),issued_by_name:name(row.issued_by),
    original_number:row.original_invoice_id?db.prepare('SELECT number FROM tax_invoices WHERE id=?').get(row.original_invoice_id).number:null,
    credited_minor:issuedCredits,net_after_credits_minor:row.kind==='invoice'?row.total_minor-issuedCredits:null,
    actions:actionsFor(db,u,row)};
}
function invoiceRow(db,u,invoiceId){
  const row=typeof invoiceId==='string'&&db.prepare('SELECT * FROM tax_invoices WHERE id=? AND tenant_id=?').get(invoiceId,u.tenant_id);
  if(!row)fail(404,'not_found','المستند الضريبي غير متاح');
  return row;
}

export function listInvoices(db,supplied){
  const u=actor(db,supplied),date=today(),demo=demoTenant(db,u.tenant_id);
  const documents=db.prepare('SELECT * FROM tax_invoices WHERE tenant_id=? ORDER BY COALESCE(issued_at,created_at) DESC').all(u.tenant_id).map(row=>view(db,u,row,demo));
  const profiles=db.prepare('SELECT p.*,r.name AS recorded_by_name,a.name AS approved_by_name FROM company_tax_profiles p JOIN users r ON r.id=p.recorded_by LEFT JOIN users a ON a.id=p.approved_by WHERE p.tenant_id=? ORDER BY p.created_at DESC').all(u.tenant_id).map(p=>({...p,address:JSON.parse(p.address)}));
  const seller=activeSeller(db,u.tenant_id,date);
  // الاستحقاقات المعتمدة بالريال التي لم تُفوتر بعد. استحقاق المقدمة لا يُفوتر بعد (القرار D3، الترحيل 183).
  const claims=db.prepare("SELECT c.id,c.case_id,c.amount_minor,c.currency,c.due_date,c.source_snapshot,k.name AS customer_name FROM ar_claims c JOIN commercial_cases k ON k.id=c.case_id WHERE c.tenant_id=? AND c.status='approved' AND c.basis<>'advance' AND NOT EXISTS(SELECT 1 FROM tax_invoices t WHERE t.claim_id=c.id AND t.kind='invoice' AND t.status<>'rejected') ORDER BY c.due_date").all(u.tenant_id)
    .map(c=>{const source=JSON.parse(c.source_snapshot);return {id:c.id,case_id:c.case_id,customer_name:c.customer_name,amount_minor:Number(c.amount_minor),currency:c.currency,due_date:c.due_date,line_description:source.line_description,buyer_ready:!!latestBuyer(db,c.case_id)};});
  const customers=db.prepare("SELECT DISTINCT k.id,k.name FROM commercial_cases k JOIN ar_claims c ON c.case_id=k.id WHERE k.tenant_id=? ORDER BY k.name").all(u.tenant_id).map(k=>({...k,profile:(p=>p?{...p,address:JSON.parse(p.address)}:null)(latestBuyer(db,k.id))}));
  const issued=documents.filter(d=>d.status==='issued');
  const sum=(kind,key)=>issued.filter(d=>d.kind===kind).reduce((n,d)=>n+d[key],0);
  // النسبة الأساسية السارية اليوم بأداتها التنظيمية: نصّها ومرجعها، تُقرأ ولا تُكتب في الكود.
  const rate=adopted(db,u.tenant_id,'finance.vat_rate',date);
  return {today:date,user_id:u.id,permissions:u.permissions,vat_categories:vatCategories(rate.value),status_names:STATUS_NAMES,
    vat_rate:{percent:rate.value,basis_points:Math.round(rate.value*100),basis:rate.basis,article:rate.article,effective_from:rate.effective_from},
    seller:seller?{...seller,address:JSON.parse(seller.address)}:null,profiles,customers,claims,documents,
    totals:{invoiced_minor:sum('invoice','total_minor'),credited_minor:sum('credit_note','total_minor'),output_vat_minor:sum('invoice','vat_minor')-sum('credit_note','vat_minor'),currency:'SAR',basis:'المستندات الصادرة داخليًا فقط؛ ليست إقرارًا ضريبيًا'},
    e_invoicing:{reporting:'not_connected',reported:0,simulated:demo,note:'الترقيم والتسلسل ورمز المرحلة الأولى جاهزة. الربط بمنصة «فاتورة» (المرحلة الثانية) لم يُبنَ ويحتاج تسجيلًا يجريه مالك المنشأة.'}};
}
export function getInvoice(db,supplied,invoiceId){const u=actor(db,supplied);return view(db,u,invoiceRow(db,u,invoiceId));}

export function recordCompanyProfile(db,supplied,input){
  writing(db);
  const u=actor(db,supplied,'prepare');
  v.object(input,['legal_name','vat_number','cr_number','address','effective_from']);
  const cr=v.text(input.cr_number,'السجل التجاري',10,10);if(!/^\d{10}$/.test(cr))fail(400,'cr_number','السجل التجاري عشرة أرقام');
  const profileId=id();
  db.prepare('INSERT INTO company_tax_profiles(id,tenant_id,legal_name,vat_number,cr_number,address,effective_from,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(profileId,u.tenant_id,v.text(input.legal_name,'الاسم القانوني للمنشأة',180,3),vatNumber(input.vat_number,'الرقم الضريبي للمنشأة'),cr,JSON.stringify(cleanAddress(input.address)),v.date(input.effective_from),u.id,now());
  audit(db,u,'tax_profile',profileId,'tax_profile.recorded',{}, {effective_from:input.effective_from});
  return {id:profileId};
}
export function approveCompanyProfile(db,supplied,profileId,input){
  writing(db);
  const u=actor(db,supplied,'approve');
  v.object(input,['note']);
  const profile=typeof profileId==='string'&&db.prepare('SELECT * FROM company_tax_profiles WHERE id=? AND tenant_id=? AND approved_by IS NULL').get(profileId,u.tenant_id);
  if(!profile)fail(404,'not_found','بيانات المنشأة غير متاحة للاعتماد');
  if(profile.recorded_by===u.id)fail(403,'self_approval','من أدخل بيانات المنشأة الضريبية لا يعتمدها');
  db.prepare('UPDATE company_tax_profiles SET approved_by=?,approved_at=? WHERE id=?').run(u.id,now(),profile.id);
  audit(db,u,'tax_profile',profile.id,'tax_profile.approved',{}, {approved:true},v.text(input.note,'ما الذي طوبق',2000,10));
  return {id:profile.id,approved:true};
}
export function recordCustomerProfile(db,supplied,input){
  writing(db);
  const u=actor(db,supplied,'prepare');
  v.object(input,['case_id','legal_name','vat_number','address','source']);
  const customer=typeof input.case_id==='string'&&db.prepare('SELECT id FROM commercial_cases WHERE id=? AND tenant_id=?').get(input.case_id,u.tenant_id);
  if(!customer)fail(404,'not_found','العميل غير متاح');
  const profileId=id();
  db.prepare('INSERT INTO customer_tax_profiles VALUES(?,?,?,?,?,?,?,?,?)').run(profileId,u.tenant_id,customer.id,v.text(input.legal_name,'الاسم القانوني للعميل',180,3),input.vat_number?vatNumber(input.vat_number,'الرقم الضريبي للعميل'):null,JSON.stringify(cleanAddress(input.address)),v.text(input.source,'مصدر البيانات',500,3),u.id,now());
  audit(db,u,'customer_tax_profile',profileId,'customer_tax_profile.recorded',{}, {case_id:customer.id});
  return {id:profileId};
}

export function prepareInvoice(db,supplied,input){
  writing(db);
  const u=actor(db,supplied,'prepare');
  v.object(input,['claim_id','supply_date','vat_category','vat_reason']);
  const claim=typeof input.claim_id==='string'&&db.prepare("SELECT * FROM ar_claims WHERE id=? AND tenant_id=? AND status='approved'").get(input.claim_id,u.tenant_id);
  if(!claim)fail(404,'claim_not_billable','يلزم استحقاق معتمد. قبول المخرج وحده لا يكفي للفوترة');
  // القرار D3 (الترحيل 183): البوابة وحدها. استحقاق المقدمة يحجز مكانه من جدول الاتفاق ويُحصَّل بالسحب من الدفعة المقدمة المؤكدة،
  // ولا تصدر عليه فاتورة ضريبية حتى تتقرر معاملة ضريبة الدفعة المقدمة عند قبضها (ZATCA_ADVANCE_WARNING في app/ledger.mjs).
  if(claim.basis==='advance')refuse(409,'advance_not_invoiced',{what:'استحقاق الدفعة المقدمة ما تصدر عليه فاتورة ضريبية للحين',
    missing:[{document:'قرار فوترة الدفعات المقدمة وضريبتها (ز11)',why:'ضريبة المقدمة عند قبضها قرار مختص ضريبي ما انتخذ، والمنصة ما تخمّنه',owner:'المالك بعد رأي المختص الضريبي',owner_role:'owner'}],
    next:'المقدمة تتحصّل بسحبها من الدفعة المقدمة المؤكدة على استحقاقها، وفاتورة المخرجات تصدر من استحقاقاتها'});
  if(claim.currency!=='SAR')fail(409,'currency_policy','الفوترة بغير الريال تحتاج سياسة سعر صرف معتمدة لم تُحدد بعد');
  if(db.prepare("SELECT 1 FROM tax_invoices WHERE claim_id=? AND kind='invoice' AND status<>'rejected'").get(claim.id))fail(409,'already_invoiced','للاستحقاق فاتورة قائمة');
  const supply=v.date(input.supply_date),date=today();
  if(supply>date)fail(400,'supply_date','تاريخ التوريد لا يكون مستقبليًا');
  const seller=activeSeller(db,u.tenant_id,date);
  if(!seller)fail(409,'seller_profile_required','سجّل بيانات المنشأة الضريبية واعتمدها قبل إعداد أي فاتورة');
  const buyer=latestBuyer(db,claim.case_id);
  if(!buyer)fail(409,'buyer_profile_required','سجّل البيانات الضريبية للعميل قبل إعداد فاتورته');
  const source=JSON.parse(claim.source_snapshot);
  const contract=JSON.parse(db.prepare('SELECT snapshot FROM commercial_contracts WHERE id=?').get(claim.contract_id).snapshot),line=contract.lines[source.line_index];
  const basisPoints=Number(line.tax_basis_points);
  // النسبة الأساسية تُقرأ **بتاريخ التوريد** لا بتاريخ اليوم، من الجدول المؤرَّخ نفسه الذي تقرؤه ضريبة
  // المدخلات: توريدٌ قبل يوليو 2020 يُفوتر بنسبة يومه. والقيد في القاعدة يقبل النسب المؤرَّخة وحدها.
  const rate=adopted(db,u.tenant_id,'finance.vat_rate',supply),standard=Math.round(rate.value*100);
  if(!VAT_CATEGORIES.some(c=>c.key===input.vat_category))fail(400,'vat_category','اختر التصنيف الضريبي');
  if(![0,standard].includes(basisPoints))fail(409,'unsupported_rate',`بند العقد يحمل نسبة ضريبة ${basisPoints/100}% والنسبة الأساسية في تاريخ التوريد ${rate.value}% (${rate.basis}). صحح العرض بإصدار جديد`);
  if((input.vat_category==='standard')!==(basisPoints===standard))fail(409,'vat_mismatch','التصنيف الضريبي لا يطابق نسبة الضريبة في بند العقد المعتمد');
  const reason=input.vat_category==='standard'?'':v.text(input.vat_reason,'سبب عدم تطبيق النسبة الأساسية',1000,10);
  const amounts=splitGross(claim.amount_minor,basisPoints),invoiceId=id(),time=now();
  // الدفعة التي ما تساوي بند مخرج بسعره (تجمع بنودًا أو جزءًا منها، الترحيل 183) تُفوتر باسمها وببنودها، بكمية واحدة. ورقم أمر شراء
  // العميل الذي نشأ تحته الاستحقاق يدخل بنود الفاتورة، فيدخل بصمتها عند الإصدار.
  const term=source.term??null,whole=!term||(term.lines.length===1&&Number(term.amount_minor)===Number(line.total_minor));
  const description=whole?line.description:`${term.label} — ${term.lines.map(index=>contract.lines[index]?.description).filter(Boolean).join('، ')}`.slice(0,1000);
  const lines=[{description,quantity:whole?line.quantity:'1',unit_code:UNIT_CODE,net_minor:amounts.net_minor,vat_minor:amounts.vat_minor,total_minor:amounts.total_minor,contract_id:claim.contract_id,line_index:source.line_index,delivery_id:source.delivery_id,
    ...(source.client_po?{client_po_number:source.client_po.number,client_po_revision:source.client_po.revision}:{})}];
  db.prepare("INSERT INTO tax_invoices(id,tenant_id,kind,claim_id,project_id,supply_date,seller,buyer,lines,vat_category,vat_basis_points,vat_reason,currency,net_minor,vat_minor,total_minor,document_type_code,tax_category_code,payment_means_code,status,prepared_by,created_at,updated_at) VALUES(?,?,'invoice',?,?,?,?,?,?,?,?,?,'SAR',?,?,?,?,?,?,'draft',?,?,?)")
    .run(invoiceId,u.tenant_id,claim.id,claim.project_id,supply,JSON.stringify({profile_id:seller.id,legal_name:seller.legal_name,vat_number:seller.vat_number,cr_number:seller.cr_number,address:JSON.parse(seller.address)}),JSON.stringify({profile_id:buyer.id,legal_name:buyer.legal_name,vat_number:buyer.vat_number,address:JSON.parse(buyer.address)}),JSON.stringify(lines),input.vat_category,basisPoints,reason,amounts.net_minor,amounts.vat_minor,amounts.total_minor,DOCUMENT_TYPE_CODES.invoice,TAX_CATEGORY_CODES[input.vat_category],PAYMENT_MEANS_CODE,u.id,time,time);
  audit(db,u,'tax_invoice',invoiceId,'tax_invoice.prepared',{}, {claim_id:claim.id,total_minor:amounts.total_minor});
  return {id:invoiceId};
}

export function prepareCreditNote(db,supplied,invoiceId,input){
  writing(db);
  const u=actor(db,supplied,'prepare');
  v.object(input,['amount','reason']);
  const original=invoiceRow(db,u,invoiceId);
  if(original.kind!=='invoice'||original.status!=='issued')fail(409,'original_not_issued','الإشعار الدائن يصدر على فاتورة صادرة فقط');
  if(typeof input.amount!=='string'||!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(input.amount))fail(400,'invalid_money','أدخل المبلغ الشامل للضريبة بخانتين عشريتين كحد أقصى');
  const [whole,fraction='']=input.amount.split('.'),gross=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(gross<=0)fail(400,'invalid_money','المبلغ موجب');
  // المسودات والمعلقة تحجز من الرصيد حتى لا يتجاوز مجموع الإشعارات الفاتورة عند إصدارها معًا.
  if(gross+credited(db,original.id,['draft','pending','issued'])>original.total_minor)fail(409,'credit_exceeds_invoice','مجموع الإشعارات الدائنة يتجاوز قيمة الفاتورة');
  const amounts=splitGross(gross,original.vat_basis_points),noteId=id(),time=now(),reason=v.text(input.reason,'سبب الإشعار الدائن',2000,10);
  const lines=[{description:`تصحيح على الفاتورة ${original.number}: ${reason}`,quantity:'1',unit_code:UNIT_CODE,...amounts}];
  db.prepare("INSERT INTO tax_invoices(id,tenant_id,kind,claim_id,original_invoice_id,project_id,supply_date,seller,buyer,lines,vat_category,vat_basis_points,vat_reason,currency,net_minor,vat_minor,total_minor,document_type_code,tax_category_code,payment_means_code,reason,status,prepared_by,created_at,updated_at) VALUES(?,?,'credit_note',?,?,?,?,?,?,?,?,?,?,'SAR',?,?,?,?,?,?,?,'draft',?,?,?)")
    .run(noteId,u.tenant_id,original.claim_id,original.id,original.project_id,original.supply_date,original.seller,original.buyer,JSON.stringify(lines),original.vat_category,original.vat_basis_points,original.vat_reason,amounts.net_minor,amounts.vat_minor,amounts.total_minor,DOCUMENT_TYPE_CODES.credit_note,TAX_CATEGORY_CODES[original.vat_category],PAYMENT_MEANS_CODE,reason,u.id,time,time);
  audit(db,u,'tax_invoice',noteId,'credit_note.prepared',{}, {original:original.number,total_minor:amounts.total_minor});
  return {id:noteId};
}

export function invoiceAction(db,supplied,invoiceId,action,input){
  writing(db);
  const u=actor(db,supplied);
  if(!['submit','issue','return','reject'].includes(action))fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','note']);
  const row=invoiceRow(db,u,invoiceId);
  v.version(input.version,row.version);
  if(!actionsFor(db,u,row).includes(action))fail(403,'transition_denied','لا تسمح الحالة أو الصلاحية بهذا الإجراء. من أعد المستند لا يصدره');
  const time=now();
  if(action==='submit')db.prepare("UPDATE tax_invoices SET status='pending',version=version+1,updated_at=? WHERE id=? AND version=?").run(time,row.id,row.version);
  if(action==='return'||action==='reject'){
    db.prepare('UPDATE tax_invoices SET status=?,decision_note=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(action==='return'?'draft':'rejected',v.text(input.note,'سبب القرار',2000,10),time,row.id,row.version);
  }
  if(action==='issue'){
    if(row.kind==='credit_note'){
      const original=db.prepare('SELECT total_minor FROM tax_invoices WHERE id=?').get(row.original_invoice_id);
      if(row.total_minor+credited(db,row.original_invoice_id)>original.total_minor)fail(409,'credit_exceeds_invoice','مجموع الإشعارات الصادرة يتجاوز قيمة الفاتورة');
    }else if(!db.prepare("SELECT 1 FROM ar_claims WHERE id=? AND status='approved'").get(row.claim_id))fail(409,'claim_not_billable','الاستحقاق لم يعد معتمدًا؛ لا تصدر الفاتورة');
    const sequence=db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM tax_invoices WHERE tenant_id=? AND kind=?').get(u.tenant_id,row.kind).n;
    // سنة الرقم سنة الرياض يوم الإصدار: time طابع UTC، وأول أربعة أحرف منه سنةٌ سابقة لما يصدر بين 00:00 و03:00 من 1 يناير.
    const number=`${row.kind==='invoice'?'INV':'CN'}-${riyadhDateOf(time).slice(0,4)}-${String(sequence).padStart(6,'0')}`;
    const last=db.prepare("SELECT hash,chain_index FROM tax_invoices WHERE tenant_id=? AND status='issued' ORDER BY chain_index DESC LIMIT 1").get(u.tenant_id);
    const previous=last?.hash??'',chainIndex=(last?.chain_index??0)+1;
    const seller=JSON.parse(row.seller);
    const digest=hash(JSON.stringify([previous,row.kind,number,time,row.seller,row.buyer,row.lines,row.net_minor,row.vat_minor,row.total_minor,row.original_invoice_id]));
    db.prepare("UPDATE tax_invoices SET status='issued',chain_index=?,sequence=?,number=?,issued_at=?,issued_by=?,decision_note=?,previous_hash=?,hash=?,qr_tlv=?,version=version+1,updated_at=? WHERE id=? AND version=?")
      .run(chainIndex,sequence,number,time,u.id,input.note?v.text(input.note,'ملاحظة الإصدار',2000):'',previous,digest,qrTlv(seller.legal_name,seller.vat_number,time,decimal(row.total_minor),decimal(row.vat_minor)),time,row.id,row.version);
  }
  audit(db,u,'tax_invoice',row.id,'tax_invoice.'+action,{status:row.status},{version:row.version+1});
  return getInvoice(db,u,row.id);
}

// تحقق سلسلة البصمات: أي تعديل خارج المنصة على مستند صادر يكسر السلسلة.
export function verifyInvoiceChain(db,tenantId){
  let previous='';
  for(const row of db.prepare("SELECT * FROM tax_invoices WHERE tenant_id=? AND status='issued' ORDER BY chain_index").all(tenantId)){
    const digest=hash(JSON.stringify([previous,row.kind,row.number,row.issued_at,row.seller,row.buyer,row.lines,row.net_minor,row.vat_minor,row.total_minor,row.original_invoice_id]));
    if(row.previous_hash!==previous||row.hash!==digest)return false;
    previous=row.hash;
  }
  return true;
}
