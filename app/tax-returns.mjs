import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { verifiedInputVat } from './payables.mjs';
import { csv } from './xlsx.mjs';

// أوراق عمل ضريبية: ورقة القيمة المضافة وسجل الاستقطاع وورقة وعاء الزكاة.
// المنصة لا تقدّم إقرارًا ولا تتصل بأي جهة، ولا تعرف نسبة من عندها: كل نسبة إعداد مؤرّخ يدخله صاحبه ويؤكده غيره.
export const DISCLAIMER='ورقة عمل للمراجعة، وليست إقرارًا. يحتاج تأكيد المختص الضريبي قبل التقديم.';
export const VAT_CATEGORIES={standard:'خاضع بالنسبة الأساسية',zero_rated:'خاضع لنسبة الصفر',exempt:'معفى',out_of_scope:'خارج نطاق الضريبة'};
export const WORKSHEET_STATUS={draft:'مسودة',reviewed:'مراجَعة',filed:'مقدَّمة',superseded:'محل نسخة أحدث'};
export const ENTRY_STATUS={recorded:'مسجل — لم يورَّد بعد',remitted:'مورَّد وموثق',cancelled:'ملغى'};
// بنود الورقة وأيها يقابله رقم في الدفتر. ما لا يقابله رقم (التعديلات) يُفسَّر نصًا ولا يُطابَق.
export const VAT_LINES=[
  {key:'sales_standard',label:'المبيعات الخاضعة بالنسبة الأساسية',column:'sales_standard_minor',ledger:'sales_standard_minor'},
  {key:'output_vat',label:'ضريبة المخرجات',column:'output_vat_minor',ledger:'output_vat_minor'},
  {key:'sales_zero_rated',label:'المبيعات بنسبة الصفر',column:'sales_zero_rated_minor',ledger:'sales_zero_rated_minor'},
  {key:'sales_exempt',label:'المبيعات المعفاة',column:'sales_exempt_minor',ledger:'sales_exempt_minor'},
  {key:'sales_out_of_scope',label:'مبيعات خارج نطاق الضريبة',column:'sales_out_of_scope_minor',ledger:'sales_out_of_scope_minor'},
  {key:'purchases',label:'المشتريات ذات المدخلات المتحقق منها',column:'purchases_minor',ledger:'purchases_minor'},
  {key:'input_vat',label:'ضريبة المدخلات المتحقق منها',column:'input_vat_minor',ledger:'input_vat_minor'},
  {key:'adjustments',label:'التعديلات',column:'adjustments_minor',ledger:null},
  {key:'net',label:'الصافي (المخرجات − المدخلات + التعديلات)',column:null,ledger:null}
];
const FIGURE_FIELDS=VAT_LINES.filter(l=>l.column).map(l=>l.key);
const riyadhToday=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const id=()=>randomUUID();
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
function actor(db,supplied){const c=currentUser(db,supplied);if(!c)fail(403,'forbidden','الحساب غير متاح');return c;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
function reader(db,supplied){
  const u=actor(db,supplied);
  const prepare=can(db,u,'tax.returns.prepare'),review=can(db,u,'tax.returns.review');
  if(!prepare&&!review)fail(403,'not_permitted','أوراق العمل الضريبية لحاملي تصريحها');
  return {...u,may_prepare:prepare,may_review:review};
}
function money(value,label,{signed=false}={}){
  const pattern=signed?/^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/:/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
  if(typeof value!=='string'||!pattern.test(value))fail(400,'invalid_money',`${label}: مبلغ بالريال بخانتين عشريتين كحد أقصى`);
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace('-','').split('.');
  const minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  return negative?-minor:minor;
}
const abs=n=>n<0?-n:n;
// نص اختياري: يُقبل فارغًا، ويُهذَّب إن كُتب. لا يُستورد من validation.mjs فذلك ملف مشترك.
const optionalText=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';

// ===== النسب المؤرّخة =====
// نسبة الفترة لا نسبة اليوم: الساري ما تاريخ سريانه يسبق التاريخ المطلوب أو يساويه، وأحدثها هو المطبَّق.
export function rateAt(db,tenantId,kind,category,date){
  return db.prepare("SELECT * FROM tax_rate_settings WHERE tenant_id=? AND kind=? AND category=? AND confirmed_by IS NOT NULL AND effective_from<=? ORDER BY effective_from DESC LIMIT 1").get(tenantId,kind,category,date)??null;
}
// نسبة تغيرت داخل الفترة: لا نطبّق نسبة واحدة على فترة نسبتها ليست واحدة، ونقول ذلك بدل أن نجمع رقمًا مضللًا.
function rateChangedInPeriod(db,tenantId,kind,category,from,to){
  return !!db.prepare("SELECT 1 FROM tax_rate_settings WHERE tenant_id=? AND kind=? AND category=? AND confirmed_by IS NOT NULL AND effective_from>? AND effective_from<=?").get(tenantId,kind,category,from,to);
}
function settingView(db,u,s){
  const actions=[];
  if(!s.confirmed_by&&u.may_review&&s.recorded_by!==u.id)actions.push('confirm_rate');
  return {...s,kind_name:s.kind==='vat'?'ضريبة القيمة المضافة':'ضريبة الاستقطاع',percent:(s.basis_points/100).toFixed(2),
    recorded_by_name:name(db,s.recorded_by),confirmed_by_name:name(db,s.confirmed_by),state:s.confirmed_by?'مؤكدة':'بانتظار تأكيد شخص آخر',actions};
}
export function recordRateSetting(db,supplied,input){
  writing(db);const u=reader(db,supplied);
  if(!u.may_prepare)fail(403,'not_permitted','إدخال النسب المؤرّخة لحامل تصريح الإعداد');
  v.object(input,['kind','category','label','percent','effective_from','source','confirmed_on','specialist_name']);
  if(!['vat','withholding'].includes(input.kind))fail(400,'kind','اختر نوع الضريبة');
  if(input.kind==='vat'&&!Object.hasOwn(VAT_CATEGORIES,input.category))fail(400,'category','تصنيف القيمة المضافة من تصنيفات الدفتر');
  const category=input.kind==='vat'?input.category:v.text(input.category,'تصنيف الخدمة كما حدده المختص',80,2);
  // النسبة رقم يدخله صاحبه؛ المنصة لا تحمل نسبة افتراضية ولا تقترح واحدة.
  if(typeof input.percent!=='string'||!/^\d{1,3}(?:\.\d{1,2})?$/.test(input.percent))fail(400,'percent','النسبة رقم مئوي بخانتين عشريتين كحد أقصى');
  const basisPoints=Math.round(Number(input.percent)*100);
  if(basisPoints>10000)fail(400,'percent','النسبة لا تتجاوز 100');
  const effective=v.date(input.effective_from),confirmedOn=v.date(input.confirmed_on);
  if(confirmedOn>riyadhToday())fail(400,'confirmed_on','تاريخ تأكيد المصدر لا يكون مستقبليًا');
  if(db.prepare('SELECT 1 FROM tax_rate_settings WHERE tenant_id=? AND kind=? AND category=? AND effective_from=?').get(u.tenant_id,input.kind,category,effective))fail(409,'duplicate_rate','لهذا التصنيف نسبة مسجلة بتاريخ السريان نفسه');
  const settingId=id(),time=now();
  db.prepare('INSERT INTO tax_rate_settings(id,tenant_id,kind,category,label,basis_points,effective_from,source,confirmed_on,specialist_name,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(settingId,u.tenant_id,input.kind,category,v.text(input.label,'اسم التصنيف',120,2),basisPoints,effective,v.text(input.source,'مصدر النسبة مكتوبًا',1500,10),confirmedOn,v.text(input.specialist_name,'المختص الذي أكد النسبة',120,3),u.id,time,time);
  audit(db,u,'tax_rate',settingId,'tax_rate.recorded',{}, {kind:input.kind,category,basis_points:basisPoints,effective_from:effective});
  return {id:settingId};
}
export function confirmRateSetting(db,supplied,settingId,input){
  writing(db);const u=reader(db,supplied);
  if(!u.may_review)fail(403,'not_permitted','تأكيد النسب لحامل تصريح المراجعة');
  v.object(input,['version','note']);
  const s=typeof settingId==='string'&&db.prepare('SELECT * FROM tax_rate_settings WHERE id=? AND tenant_id=?').get(settingId,u.tenant_id);
  if(!s)fail(404,'not_found','الإعداد غير متاح');
  v.version(input.version,s.version);
  if(s.confirmed_by)fail(409,'already_confirmed','النسبة مؤكدة. التصحيح بإعداد جديد بتاريخ سريان جديد');
  if(s.recorded_by===u.id)fail(403,'self_approval','من أدخل النسبة لا يؤكدها');
  const note=v.text(input.note,'ما الذي طابقته في المصدر',1500,10);
  db.prepare('UPDATE tax_rate_settings SET confirmed_by=?,confirmed_at=?,confirmation_note=?,version=version+1,updated_at=? WHERE id=?').run(u.id,now(),note,now(),s.id);
  audit(db,u,'tax_rate',s.id,'tax_rate.confirmed',{version:s.version},{version:s.version+1},note);
  return {id:s.id};
}

// ===== قراءة الدفتر =====
// مخرجات الفترة من الفواتير الصادرة بتاريخ التوريد، والإشعار الدائن يطرح. المسودة والملغاة خارج الحساب.
export function ledgerVat(db,tenantId,from,to){
  const sales={sales_standard_minor:0,output_vat_minor:0,sales_zero_rated_minor:0,sales_exempt_minor:0,sales_out_of_scope_minor:0};
  const rows=db.prepare(`SELECT vat_category,
      SUM(CASE WHEN kind='credit_note' THEN -net_minor ELSE net_minor END) AS net,
      SUM(CASE WHEN kind='credit_note' THEN -vat_minor ELSE vat_minor END) AS vat
    FROM tax_invoices WHERE tenant_id=? AND status='issued' AND supply_date BETWEEN ? AND ? GROUP BY vat_category`).all(tenantId,from,to);
  for(const r of rows){
    if(r.vat_category==='standard'){sales.sales_standard_minor=r.net;sales.output_vat_minor=r.vat;}
    if(r.vat_category==='zero_rated')sales.sales_zero_rated_minor=r.net;
    if(r.vat_category==='exempt')sales.sales_exempt_minor=r.net;
    if(r.vat_category==='out_of_scope')sales.sales_out_of_scope_minor=r.net;
  }
  // ضريبة المدخلات المتحقق منها وحدها. verifiedInputVat يعيد null ما لم يُتحقق من أي فاتورة مورد بعد.
  const verified=verifiedInputVat(db,tenantId,from,to);
  const purchases=db.prepare("SELECT COALESCE(SUM(i.amount_minor),0) AS n FROM procurement_invoice_tax t JOIN procurement_invoices i ON i.id=t.invoice_id WHERE t.tenant_id=? AND t.status='verified' AND t.invoice_date BETWEEN ? AND ?").get(tenantId,from,to).n;
  const invoices=db.prepare("SELECT COUNT(*) AS n FROM tax_invoices WHERE tenant_id=? AND status='issued' AND supply_date BETWEEN ? AND ?").get(tenantId,from,to).n;
  return {...sales,purchases_minor:verified===null?0:purchases,input_vat_minor:verified??0,input_vat_available:verified!==null,issued_invoices:invoices,from,to};
}
// مدخلات تنتظر التحقق: لا تدخل الورقة، وتظهر وحدها مع أثرها لو تحققت.
export function pendingInputVat(db,tenantId,from,to){
  const rows=db.prepare(`SELECT t.id,t.invoice_id,t.supplier_invoice_number,t.invoice_date,t.vat_minor,t.status,i.supplier_key,i.amount_minor
    FROM procurement_invoice_tax t JOIN procurement_invoices i ON i.id=t.invoice_id
    WHERE t.tenant_id=? AND t.status='pending' AND t.invoice_date BETWEEN ? AND ? ORDER BY t.invoice_date`).all(tenantId,from,to);
  return {rows,vat_minor:rows.reduce((n,r)=>n+r.vat_minor,0),count:rows.length};
}

// ===== ورقة عمل القيمة المضافة =====
function figures(w){
  const values=Object.fromEntries(VAT_LINES.filter(l=>l.column).map(l=>[l.key,w[l.column]]));
  return {...values,net:values.output_vat-values.input_vat+values.adjustments};
}
// بند التسوية: الفرق بين الدفتر والورقة بندًا بندًا، ظاهرًا ولو كان الشرح ناقصًا.
function reconciliation(w,ledger){
  const values=figures(w),lines=VAT_LINES.map(line=>{
    const worksheet=line.column?values[line.key]:values.net;
    const book=line.ledger?ledger[line.ledger]:null;
    const comparable=line.ledger!==null&&(line.key!=='input_vat'&&line.key!=='purchases'||ledger.input_vat_available);
    return {key:line.key,label:line.label,worksheet_minor:worksheet,ledger_minor:line.ledger?book:null,
      difference_minor:line.ledger?worksheet-book:null,comparable,
      note:line.ledger===null?'بند لا يقابله رقم في الدفتر؛ يُفسَّر نصًا':comparable?'':'الدفتر لا يوفر رقمًا بعد: لم يُتحقق من أي فاتورة مورد ضريبية'};
  });
  return {lines,variance_minor:lines.reduce((n,l)=>n+(l.difference_minor===null?0:abs(l.difference_minor)),0)};
}
function worksheetView(db,u,w){
  const ledger=ledgerVat(db,u.tenant_id,w.period_start,w.period_end),recon=reconciliation(w,ledger);
  const rate=rateAt(db,u.tenant_id,'vat','standard',w.period_end),changed=rateChangedInPeriod(db,u.tenant_id,'vat','standard',w.period_start,w.period_end);
  const expected=rate&&!changed?Math.round(w.sales_standard_minor*rate.basis_points/10000):null;
  const actions=[];
  if(w.status==='draft'&&u.may_prepare&&w.prepared_by===u.id)actions.push('save_worksheet');
  if(w.status==='draft'&&u.may_review&&w.prepared_by!==u.id)actions.push('review_worksheet');
  if(w.status==='reviewed'&&u.may_review)actions.push('record_filing');
  if(w.status==='filed'&&u.may_prepare)actions.push('revise_worksheet');
  return {...w,status_name:WORKSHEET_STATUS[w.status],figures:figures(w),ledger,reconciliation:recon.lines,
    variance_minor:recon.variance_minor,variance_explained:recon.variance_minor===0||w.reconciliation_note.trim().length>=10,
    stored_variance_minor:w.variance_minor,ledger_snapshot:JSON.parse(w.ledger_snapshot),
    prepared_by_name:name(db,w.prepared_by),reviewed_by_name:name(db,w.reviewed_by),filed_by_name:name(db,w.filed_by),
    rate:rate?{percent:(rate.basis_points/100).toFixed(2),effective_from:rate.effective_from,source:rate.source,specialist_name:rate.specialist_name,confirmed_on:rate.confirmed_on}:null,
    rate_changed_in_period:changed,expected_output_vat_minor:expected,
    rate_note:changed?'تغيرت النسبة داخل الفترة؛ لا تُطبَّق نسبة واحدة على الفترة كلها. راجع البنود بنسبة كل جزء':rate?'النسبة المعروضة نسبة الفترة لا نسبة اليوم، وهي مقارنة للمراجعة لا قيمة تُقدَّم':'لم تُدخل نسبة مؤرّخة مؤكدة لهذه الفترة، فلا مقارنة تُعرض',
    disclaimer:DISCLAIMER,actions};
}
function worksheetRow(db,u,worksheetId){
  const w=typeof worksheetId==='string'&&db.prepare('SELECT * FROM vat_worksheets WHERE id=? AND tenant_id=?').get(worksheetId,u.tenant_id);
  if(!w)fail(404,'not_found','ورقة العمل غير متاحة');
  return w;
}
export function getVatWorksheet(db,supplied,worksheetId){const u=reader(db,supplied);return worksheetView(db,u,worksheetRow(db,u,worksheetId));}

export function vatBoard(db,supplied){
  const u=reader(db,supplied),today=riyadhToday();
  const worksheets=db.prepare('SELECT * FROM vat_worksheets WHERE tenant_id=? ORDER BY period_start DESC,revision DESC').all(u.tenant_id).map(w=>worksheetView(db,u,w));
  const settings=db.prepare("SELECT * FROM tax_rate_settings WHERE tenant_id=? AND kind='vat' ORDER BY category,effective_from DESC").all(u.tenant_id).map(s=>settingView(db,u,s));
  const open=worksheets.find(w=>w.status!=='filed'&&w.status!=='superseded')??null;
  const scope=open??worksheets[0]??null;
  const pending=scope?pendingInputVat(db,u.tenant_id,scope.period_start,scope.period_end):{rows:[],vat_minor:0,count:0};
  const zakat=db.prepare('SELECT * FROM zakat_worksheets WHERE tenant_id=? ORDER BY fiscal_year DESC,revision DESC').all(u.tenant_id).map(z=>zakatView(db,u,z));
  const boxes=db.prepare('SELECT line_key,box_label FROM vat_export_boxes WHERE tenant_id=?').all(u.tenant_id);
  return {today,user_id:u.id,disclaimer:DISCLAIMER,
    can_prepare:u.may_prepare,can_review:u.may_review,categories:VAT_CATEGORIES,status_names:WORKSHEET_STATUS,lines:VAT_LINES.map(l=>({key:l.key,label:l.label,ledger:l.ledger!==null})),
    rate_settings:settings,worksheets,zakat_worksheets:zakat,
    pending_input_vat:{...pending,window:scope?{from:scope.period_start,to:scope.period_end}:null,
      note:'ضريبة مدخلات لم يتحقق منها أحد بعد؛ لا تدخل ورقة العمل. الرقم أدناه أثرها لو تحقق منها.'},
    export_boxes:Object.fromEntries(boxes.map(b=>[b.line_key,b.box_label])),
    // ما ينتظر قرار هذا المستخدم، بالشكل الذي يقرؤه صندوق «بانتظار قراري».
    inbox:[...settings.filter(s=>s.actions.length).map(s=>({id:s.id,title:`نسبة ${s.label} سارية من ${s.effective_from}`,created_at:s.created_at,actions:s.actions})),
      ...worksheets.filter(w=>w.actions.some(a=>['review_worksheet','record_filing'].includes(a))).map(w=>({id:w.id,title:`ورقة ضريبة القيمة المضافة ${w.period_start} → ${w.period_end}`,created_at:w.created_at,actions:w.actions.filter(a=>['review_worksheet','record_filing'].includes(a))})),
      ...zakat.filter(z=>z.actions.includes('review_zakat')).map(z=>({id:z.id,title:`ورقة وعاء الزكاة ${z.fiscal_year}`,created_at:z.created_at,actions:['review_zakat']}))],
    note:`${DISCLAIMER} الأرقام أرقام مُعِدّ الورقة، ولقطة الدفتر بجانبها ليظهر الفرق ويُفسَّر. المنصة لا تقدّم إقرارًا ولا تتصل بأي جهة، ولا تحمل نسبة ضريبية من عندها.`};
}
export function createVatWorksheet(db,supplied,input){
  writing(db);const u=reader(db,supplied);
  if(!u.may_prepare)fail(403,'not_permitted','إعداد أوراق العمل لحامل تصريح الإعداد');
  v.object(input,['period_start','period_end']);
  const from=v.date(input.period_start),to=v.date(input.period_end);
  if(to<=from)fail(400,'period','نهاية الفترة بعد بدايتها');
  if(from>riyadhToday())fail(400,'period','لا تُفتح ورقة لفترة لم تبدأ');
  if(db.prepare("SELECT 1 FROM vat_worksheets WHERE tenant_id=? AND period_start=? AND period_end=? AND status IN ('draft','reviewed')").get(u.tenant_id,from,to))fail(409,'worksheet_open','للفترة ورقة مفتوحة. أكملها أو راجعها');
  const previous=db.prepare('SELECT COALESCE(MAX(revision),0) AS n FROM vat_worksheets WHERE tenant_id=? AND period_start=? AND period_end=?').get(u.tenant_id,from,to).n;
  const ledger=ledgerVat(db,u.tenant_id,from,to),worksheetId=id(),time=now();
  db.prepare("INSERT INTO vat_worksheets(id,tenant_id,period_start,period_end,revision,status,ledger_snapshot,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?,?,?)")
    .run(worksheetId,u.tenant_id,from,to,previous+1,JSON.stringify(ledger),u.id,time,time);
  audit(db,u,'vat_worksheet',worksheetId,'vat_worksheet.created',{}, {period_start:from,period_end:to,revision:previous+1});
  return {id:worksheetId};
}
export function saveVatWorksheet(db,supplied,worksheetId,input){
  writing(db);const u=reader(db,supplied);
  v.object(input,['version',...FIGURE_FIELDS,'adjustments_note','reconciliation_note']);
  const w=worksheetRow(db,u,worksheetId);
  v.version(input.version,w.version);
  if(w.status!=='draft')fail(409,'not_draft','الورقة المراجَعة لا تُعدل. التصحيح بنسخة جديدة');
  if(w.prepared_by!==u.id||!u.may_prepare)fail(403,'not_permitted','يعدّل الورقة مُعِدّها');
  const values=Object.fromEntries(FIGURE_FIELDS.map(key=>[key,money(input[key],VAT_LINES.find(l=>l.key===key).label,{signed:key==='adjustments'})]));
  const adjustmentsNote=values.adjustments===0?optionalText(input.adjustments_note,2000):v.text(input.adjustments_note,'أساس التعديلات',2000,10);
  const ledger=ledgerVat(db,u.tenant_id,w.period_start,w.period_end);
  // ضريبة المدخلات غير المتحقق منها لا تدخل الورقة إطلاقًا.
  if(values.input_vat>ledger.input_vat_minor)fail(409,'unverified_input_vat',`ضريبة المدخلات في الورقة تتجاوز المتحقق منه في الدفتر (${(ledger.input_vat_minor/100).toFixed(2)} ريال). المدخلات غير المتحقق منها تنتظر التحقق ولا تدخل الورقة`);
  const draft={...w,...Object.fromEntries(FIGURE_FIELDS.map(key=>[VAT_LINES.find(l=>l.key===key).column,values[key]]))};
  const recon=reconciliation(draft,ledger),reconciliationNote=recon.variance_minor===0?optionalText(input.reconciliation_note,3000):v.text(input.reconciliation_note,'تفسير الفرق عن الدفتر',3000,10);
  const time=now();
  db.prepare('UPDATE vat_worksheets SET sales_standard_minor=?,output_vat_minor=?,sales_zero_rated_minor=?,sales_exempt_minor=?,sales_out_of_scope_minor=?,purchases_minor=?,input_vat_minor=?,adjustments_minor=?,adjustments_note=?,reconciliation_note=?,ledger_snapshot=?,variance_minor=?,version=version+1,updated_at=? WHERE id=?')
    .run(values.sales_standard,values.output_vat,values.sales_zero_rated,values.sales_exempt,values.sales_out_of_scope,values.purchases,values.input_vat,values.adjustments,adjustmentsNote,reconciliationNote,JSON.stringify(ledger),recon.variance_minor,time,w.id);
  audit(db,u,'vat_worksheet',w.id,'vat_worksheet.saved',{version:w.version},{version:w.version+1,variance_minor:recon.variance_minor});
  return getVatWorksheet(db,u,w.id);
}
export function vatWorksheetAction(db,supplied,worksheetId,action,input){
  writing(db);const u=reader(db,supplied);
  const fields={review_worksheet:['note'],record_filing:['filing_reference','filing_evidence'],revise_worksheet:['note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const w=worksheetRow(db,u,worksheetId),view=worksheetView(db,u,w);
  v.version(input.version,w.version);
  if(!view.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة الورقة أو لصلاحيتك');
  const time=now();
  if(action==='review_worksheet'){
    if(w.prepared_by===u.id)fail(403,'self_approval','من أعدّ الورقة لا يراجعها');
    // الفرق عن الدفتر يُفسَّر قبل الإقفال، ولا يُقفل بفرق مسكوت عنه.
    if(view.variance_minor!==0&&w.reconciliation_note.trim().length<10)fail(409,'unexplained_variance',`فرق غير مفسَّر عن الدفتر: ${(view.variance_minor/100).toFixed(2)} ريال. اكتب بند التسوية قبل الإقفال`);
    if(view.variance_minor!==w.variance_minor)fail(409,'ledger_moved','تغير الدفتر بعد آخر حفظ. أعد حفظ الورقة لتُظهر الفرق الجديد');
    db.prepare("UPDATE vat_worksheets SET status='reviewed',reviewed_by=?,reviewed_at=?,review_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,v.text(input.note,'ما الذي راجعته',3000,10),time,w.id);
  }
  if(action==='record_filing'){
    // النسخة الأحدث تحل محل المقدَّمة السابقة للفترة نفسها، وتبقى القديمة محفوظة.
    const previous=db.prepare("SELECT id FROM vat_worksheets WHERE tenant_id=? AND period_start=? AND period_end=? AND status='filed' AND id<>?").get(u.tenant_id,w.period_start,w.period_end,w.id);
    if(previous)db.prepare("UPDATE vat_worksheets SET status='superseded',version=version+1,updated_at=? WHERE id=?").run(time,previous.id);
    db.prepare("UPDATE vat_worksheets SET status='filed',filed_by=?,filed_at=?,filing_reference=?,filing_evidence=?,version=version+1,updated_at=? WHERE id=?")
      .run(u.id,time,v.text(input.filing_reference,'مرجع التقديم لدى الجهة',120,3),v.text(input.filing_evidence,'من قدّمه ومتى وأين حُفظ الإيصال',3000,10),time,w.id);
  }
  if(action==='revise_worksheet'){
    const note=v.text(input.note,'سبب النسخة الجديدة',2000,10);
    const ledger=ledgerVat(db,u.tenant_id,w.period_start,w.period_end),next=id();
    const last=db.prepare('SELECT COALESCE(MAX(revision),0) AS n FROM vat_worksheets WHERE tenant_id=? AND period_start=? AND period_end=?').get(u.tenant_id,w.period_start,w.period_end).n;
    db.prepare("INSERT INTO vat_worksheets(id,tenant_id,period_start,period_end,revision,status,ledger_snapshot,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?,?,?)")
      .run(next,u.tenant_id,w.period_start,w.period_end,last+1,JSON.stringify(ledger),u.id,time,time);
    audit(db,u,'vat_worksheet',next,'vat_worksheet.revised',{supersedes:w.id},{revision:last+1},note);
    return {id:next};
  }
  audit(db,u,'vat_worksheet',w.id,'vat_worksheet.'+action,{status:w.status},{version:w.version+1});
  return getVatWorksheet(db,u,w.id);
}
export function nameExportBoxes(db,supplied,input){
  writing(db);const u=reader(db,supplied);
  if(!u.may_prepare)fail(403,'not_permitted','تسمية الخانات لحامل تصريح الإعداد');
  v.object(input,['boxes']);
  if(!Array.isArray(input.boxes)||!input.boxes.length)fail(400,'boxes','أدخل صفًا واحدًا على الأقل');
  const keys=new Set(VAT_LINES.map(l=>l.key)),time=now();
  for(const row of input.boxes){
    v.object(row,['line_key','box_label']);
    if(!keys.has(row.line_key))fail(400,'line_key','بند غير معروف');
    const label=String(row.box_label??'').trim();
    if(!label){db.prepare('DELETE FROM vat_export_boxes WHERE tenant_id=? AND line_key=?').run(u.tenant_id,row.line_key);continue;}
    db.prepare('INSERT INTO vat_export_boxes(tenant_id,line_key,box_label,named_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,line_key) DO UPDATE SET box_label=excluded.box_label,named_by=excluded.named_by,created_at=excluded.created_at')
      .run(u.tenant_id,row.line_key,v.text(label,'اسم الخانة',80,1),u.id,time);
  }
  audit(db,u,'vat_export_boxes',u.tenant_id,'vat_boxes.named',{}, {count:input.boxes.length});
  return {named:input.boxes.length};
}
// تصدير CSV: خانات يسمّيها المستخدم. المنصة لا تفترض ترقيم خانات نموذج رسمي، وتقول ذلك في الملف نفسه.
export function exportVatWorksheet(db,supplied,worksheetId){
  const u=reader(db,supplied),view=getVatWorksheet(db,u,worksheetId);
  const boxes=Object.fromEntries(db.prepare('SELECT line_key,box_label FROM vat_export_boxes WHERE tenant_id=?').all(u.tenant_id).map(b=>[b.line_key,b.box_label]));
  const riyal=minor=>minor===null||minor===undefined?'':(minor/100).toFixed(2);
  const meta=[
    ['ورقة عمل ضريبة القيمة المضافة',''],
    ['تنبيه',DISCLAIMER],
    ['تعيين الخانات','أسماء الخانات أدناه أدخلها المستخدم. المنصة لا تفترض ترقيم خانات نموذج رسمي؛ التعيين على المستخدم والمختص الضريبي.'],
    ['الفترة',`${view.period_start} إلى ${view.period_end}`],
    ['النسخة',String(view.revision)],
    ['الحالة',view.status_name],
    ['أعدّها',view.prepared_by_name??''],
    ['راجعها',view.reviewed_by_name??'لم تُراجع بعد'],
    ['فرق الورقة عن الدفتر بالريال',riyal(view.variance_minor)],
    ['بند التسوية',view.reconciliation_note||'لا فرق'],
    ['أُنشئ الملف في',now()],
    ['',''] ];
  const header=['الخانة كما سماها المستخدم','بند ورقة العمل','المبلغ بالريال','رقم الدفتر بالريال','الفرق بالريال'];
  const body=view.reconciliation.map(line=>[boxes[line.key]??'',line.label,riyal(line.worksheet_minor),line.ledger_minor===null?'—':riyal(line.ledger_minor),line.difference_minor===null?'—':riyal(line.difference_minor)]);
  return {filename:`vat-worksheet-${view.period_start}-${view.period_end}-r${view.revision}.csv`,type:'text/csv; charset=utf-8',content:Buffer.from(csv([...meta,header,...body]),'utf8')};
}

// ===== سجل ضريبة الاستقطاع =====
function entryView(db,u,e){
  const actions=[];
  if(e.status==='recorded'&&u.may_review&&e.recorded_by!==u.id)actions.push('record_remittance');
  if(e.status==='recorded'&&u.may_review)actions.push('cancel_entry');
  const order=e.payment_order_id?db.prepare('SELECT status,bank_reference,executed_on,amount_minor FROM payment_orders WHERE id=? AND tenant_id=?').get(e.payment_order_id,u.tenant_id):null;
  const today=riyadhToday(),late=e.status==='recorded'&&e.remittance_due_date<today;
  // الالتزام تجاه الهيئة صار له قيد في الدفتر (نوع المستند withholding في app/ledger.mjs). الربط في
  // finance_source_links لا في عمود على هذا الجدول، والسجل يقول هنا هل وصل الدفتر أم ما زال خارجه.
  const journal=db.prepare("SELECT j.id,j.status,j.entry_date FROM finance_source_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.source_kind='withholding' AND l.source_id=? AND l.tenant_id=?").get(e.id,u.tenant_id)??null;
  return {...e,status_name:ENTRY_STATUS[e.status],percent:(e.rate_basis_points/100).toFixed(2),
    recorded_by_name:name(db,e.recorded_by),remitted_by_name:name(db,e.remitted_by),
    payment_order:order?{...order,status_name:order.status}:null,late,ledger_journal:journal,
    days_to_due:Math.round((Date.parse(e.remittance_due_date)-Date.parse(today))/86400000),actions};
}
export function withholdingBoard(db,supplied){
  const u=reader(db,supplied);
  const entries=db.prepare('SELECT * FROM withholding_entries WHERE tenant_id=? ORDER BY payment_date DESC').all(u.tenant_id).map(e=>entryView(db,u,e));
  const settings=db.prepare("SELECT * FROM tax_rate_settings WHERE tenant_id=? AND kind='withholding' ORDER BY category,effective_from DESC").all(u.tenant_id).map(s=>settingView(db,u,s));
  const linked=new Set(entries.filter(e=>e.status!=='cancelled'&&e.payment_order_id).map(e=>e.payment_order_id));
  // أوامر الدفع المعتمدة أو المنفذة التي لا سجل استقطاع لها بعد: تُعرض للربط، ولا تستنتج المنصة منها استقطاعًا.
  const orders=db.prepare("SELECT o.id,o.amount_minor,o.status,o.executed_on,o.bank_reference,v.legal_name,v.country FROM payment_orders o JOIN vendors v ON v.id=o.vendor_id WHERE o.tenant_id=? AND o.status IN ('approved','executed') ORDER BY o.created_at DESC").all(u.tenant_id).filter(o=>!linked.has(o.id));
  const live=entries.filter(e=>e.status!=='cancelled');
  return {today:riyadhToday(),user_id:u.id,disclaimer:DISCLAIMER,
    can_prepare:u.may_prepare,can_review:u.may_review,status_names:ENTRY_STATUS,
    rate_settings:settings,confirmed_rates:settings.filter(s=>s.confirmed_by),entries,payment_orders:orders,
    totals:{entries:live.length,withheld_minor:live.reduce((n,e)=>n+e.withheld_minor,0),
      due_minor:live.filter(e=>e.status==='recorded').reduce((n,e)=>n+e.withheld_minor,0),
      late:live.filter(e=>e.late).length},
    inbox:entries.filter(e=>e.actions.includes('record_remittance')).map(e=>({id:e.id,title:`استقطاع ${e.beneficiary_name} — استحقاق التوريد ${e.remittance_due_date}`,created_at:e.created_at,actions:['record_remittance']})),
    warning:'نوع الخدمة ونسبة الاستقطاع وأثر الاتفاقيات الدولية يحددها المختص الضريبي. المنصة تسجّل قراره ولا تستنتجه، ولا تورّد ولا تتصل بأي جهة.',
    note:`${DISCLAIMER} كل نسبة هنا إعداد مؤرّخ مؤكد، وتُطبَّق نسبة تاريخ الدفعة لا نسبة اليوم.`};
}
export function recordWithholding(db,supplied,input){
  writing(db);const u=reader(db,supplied);
  if(!u.may_prepare)fail(403,'not_permitted','تسجيل الاستقطاع لحامل تصريح الإعداد');
  v.object(input,['payment_order_id','beneficiary_name','beneficiary_country','service_kind','payment_date','amount','rate_setting_id','remittance_due_date','due_date_basis','classified_by_name','classified_on','classification_note','treaty_note']);
  const paymentDate=v.date(input.payment_date),today=riyadhToday();
  if(paymentDate>today)fail(400,'payment_date','تاريخ الدفعة لا يكون مستقبليًا');
  const amount=money(input.amount,'مبلغ الدفعة');
  if(amount<=0)fail(400,'amount','مبلغ الدفعة أكبر من صفر');
  const setting=typeof input.rate_setting_id==='string'&&db.prepare("SELECT * FROM tax_rate_settings WHERE id=? AND tenant_id=? AND kind='withholding' AND confirmed_by IS NOT NULL").get(input.rate_setting_id,u.tenant_id);
  if(!setting)fail(400,'rate_setting_id','اختر نسبة استقطاع مؤرّخة مؤكدة');
  if(setting.effective_from>paymentDate)fail(409,'rate_not_effective','النسبة المختارة تسري بعد تاريخ الدفعة. تُطبَّق نسبة تاريخ الدفعة');
  // نسبة الفترة: أحدث نسبة سارية في تاريخ الدفعة لهذا التصنيف، لا نسبة اليوم ولا نسبة أخرى.
  const effective=rateAt(db,u.tenant_id,'withholding',setting.category,paymentDate);
  if(!effective||effective.id!==setting.id)fail(409,'rate_not_effective',`النسبة السارية في ${paymentDate} لهذا التصنيف غيرها. اختر نسبة تاريخ الدفعة`);
  let orderId=null;
  if(input.payment_order_id){
    const order=db.prepare("SELECT * FROM payment_orders WHERE id=? AND tenant_id=? AND status IN ('approved','executed')").get(input.payment_order_id,u.tenant_id);
    if(!order)fail(404,'not_found','أمر الدفع غير متاح للربط');
    if(db.prepare("SELECT 1 FROM withholding_entries WHERE payment_order_id=? AND status<>'cancelled'").get(order.id))fail(409,'order_linked','لأمر الدفع سجل استقطاع قائم');
    if(amount>order.amount_minor)fail(409,'amount_exceeds_order','مبلغ الدفعة يتجاوز أمر الدفع المرتبط');
    orderId=order.id;
  }
  const dueDate=v.date(input.remittance_due_date);
  if(dueDate<paymentDate)fail(400,'remittance_due_date','تاريخ استحقاق التوريد بعد تاريخ الدفعة أو يساويه');
  const classifiedOn=v.date(input.classified_on);
  if(classifiedOn>today)fail(400,'classified_on','تاريخ التصنيف لا يكون مستقبليًا');
  const withheld=Math.round(amount*setting.basis_points/10000),entryId=id(),time=now();
  db.prepare("INSERT INTO withholding_entries(id,tenant_id,payment_order_id,beneficiary_name,beneficiary_country,service_kind,payment_date,payment_amount_minor,currency,rate_setting_id,rate_basis_points,withheld_minor,remittance_due_date,due_date_basis,classified_by_name,classified_on,classification_note,treaty_note,status,recorded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'SAR',?,?,?,?,?,?,?,?,?,'recorded',?,?,?)")
    .run(entryId,u.tenant_id,orderId,v.text(input.beneficiary_name,'المستفيد',200,2),v.text(input.beneficiary_country,'بلد المستفيد',80,2),v.text(input.service_kind,'نوع الخدمة كما حدده المختص',200,2),paymentDate,amount,
      setting.id,setting.basis_points,withheld,dueDate,v.text(input.due_date_basis,'سند موعد التوريد ومن أكده',1500,10),
      v.text(input.classified_by_name,'من أفتى بهذا التصنيف',120,3),classifiedOn,v.text(input.classification_note,'أساس التصنيف والنسبة',3000,10),
      typeof input.treaty_note==='string'?input.treaty_note.trim().slice(0,2000):'',u.id,time,time);
  audit(db,u,'withholding',entryId,'withholding.recorded',{}, {beneficiary:input.beneficiary_name,amount_minor:amount,withheld_minor:withheld,rate_setting_id:setting.id});
  return {id:entryId};
}
export function withholdingAction(db,supplied,entryId,action,input){
  writing(db);const u=reader(db,supplied);
  const fields={record_remittance:['remitted_on','remittance_reference','remittance_evidence'],cancel_entry:['note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const e=typeof entryId==='string'&&db.prepare('SELECT * FROM withholding_entries WHERE id=? AND tenant_id=?').get(entryId,u.tenant_id);
  if(!e)fail(404,'not_found','السجل غير متاح');
  v.version(input.version,e.version);
  const view=entryView(db,u,e);
  if(!view.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة السجل أو لصلاحيتك');
  const time=now();
  if(action==='record_remittance'){
    if(e.recorded_by===u.id)fail(403,'self_approval','من سجّل الاستقطاع لا يوثّق توريده');
    const remitted=v.date(input.remitted_on);
    if(remitted<e.payment_date||remitted>riyadhToday())fail(400,'remitted_on','تاريخ التوريد بين تاريخ الدفعة واليوم');
    db.prepare("UPDATE withholding_entries SET status='remitted',remitted_on=?,remittance_reference=?,remittance_evidence=?,remitted_by=?,version=version+1,updated_at=? WHERE id=?")
      .run(remitted,v.text(input.remittance_reference,'مرجع التوريد',120,3),v.text(input.remittance_evidence,'دليل التوريد ومكان حفظه',3000,10),u.id,time,e.id);
  }else{
    db.prepare("UPDATE withholding_entries SET status='cancelled',cancel_note=?,version=version+1,updated_at=? WHERE id=?").run(v.text(input.note,'سبب الإلغاء',2000,10),time,e.id);
  }
  audit(db,u,'withholding',e.id,'withholding.'+action,{status:e.status},{version:e.version+1});
  return {id:e.id};
}

// ===== ورقة وعاء الزكاة =====
// هيكل فارغ: البنود يسميها المختص ويملؤها ويعتمدها، ولا تحسب المنصة وعاءً ولا تفترض بندًا.
function zakatView(db,u,z){
  const lines=db.prepare('SELECT * FROM zakat_worksheet_lines WHERE worksheet_id=? ORDER BY position').all(z.id);
  const actions=[];
  if(z.status==='draft'&&u.may_prepare&&z.prepared_by===u.id)actions.push('save_zakat_lines');
  if(z.status==='draft'&&u.may_review&&z.prepared_by!==u.id&&lines.length)actions.push('review_zakat');
  return {...z,status_name:WORKSHEET_STATUS[z.status],lines,line_count:lines.length,
    empty_lines:lines.filter(l=>l.amount_minor===null).length,
    prepared_by_name:name(db,z.prepared_by),reviewed_by_name:name(db,z.reviewed_by),disclaimer:DISCLAIMER,
    note:'هيكل ورقة عمل فقط: المنصة لا تحسب وعاء الزكاة ولا تفترض بنوده. البنود ومبالغها ومصادرها من المختص، والمجموع يحتسبه هو.',actions};
}
export function createZakatWorksheet(db,supplied,input){
  writing(db);const u=reader(db,supplied);
  if(!u.may_prepare)fail(403,'not_permitted','فتح ورقة وعاء الزكاة لحامل تصريح الإعداد');
  v.object(input,['fiscal_year','specialist_name','basis_note']);
  const year=String(input.fiscal_year??'');
  if(!/^\d{4}$/.test(year))fail(400,'fiscal_year','السنة المالية أربعة أرقام');
  if(db.prepare("SELECT 1 FROM zakat_worksheets WHERE tenant_id=? AND fiscal_year=? AND status<>'superseded'").get(u.tenant_id,year))fail(409,'worksheet_open','للسنة ورقة قائمة');
  const previous=db.prepare('SELECT COALESCE(MAX(revision),0) AS n FROM zakat_worksheets WHERE tenant_id=? AND fiscal_year=?').get(u.tenant_id,year).n;
  const worksheetId=id(),time=now();
  db.prepare("INSERT INTO zakat_worksheets(id,tenant_id,fiscal_year,revision,status,specialist_name,basis_note,prepared_by,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?,?,?,?)")
    .run(worksheetId,u.tenant_id,year,previous+1,v.text(input.specialist_name,'المختص الذي يسمي البنود',120,3),v.text(input.basis_note,'مرجع البنود ومن أقرّها',2000,10),u.id,time,time);
  audit(db,u,'zakat_worksheet',worksheetId,'zakat.created',{}, {fiscal_year:year,revision:previous+1});
  return {id:worksheetId};
}
export function saveZakatLines(db,supplied,worksheetId,input){
  writing(db);const u=reader(db,supplied);
  v.object(input,['version','lines']);
  const z=typeof worksheetId==='string'&&db.prepare('SELECT * FROM zakat_worksheets WHERE id=? AND tenant_id=?').get(worksheetId,u.tenant_id);
  if(!z)fail(404,'not_found','الورقة غير متاحة');
  v.version(input.version,z.version);
  if(z.status!=='draft')fail(409,'not_draft','الورقة المعتمدة لا تُعدل. التصحيح بنسخة جديدة');
  if(z.prepared_by!==u.id||!u.may_prepare)fail(403,'not_permitted','يعدّل الورقة مُعِدّها');
  if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>60)fail(400,'lines','من بند واحد إلى ستين');
  const time=now(),rows=input.lines.map((row,index)=>{
    v.object(row,['label','amount','source_note']);
    // المبلغ اختياري: البند يُسمى أولًا ويملؤه المختص لاحقًا.
    const amount=row.amount===''||row.amount===null||row.amount===undefined?null:money(String(row.amount),`مبلغ البند ${index+1}`,{signed:true});
    return {position:index+1,label:v.text(row.label,`اسم البند ${index+1}`,200,2),amount,source_note:typeof row.source_note==='string'?row.source_note.trim().slice(0,1000):''};
  });
  db.prepare('DELETE FROM zakat_worksheet_lines WHERE worksheet_id=?').run(z.id);
  for(const row of rows)db.prepare('INSERT INTO zakat_worksheet_lines(id,worksheet_id,position,label,amount_minor,source_note,created_at) VALUES(?,?,?,?,?,?,?)').run(id(),z.id,row.position,row.label,row.amount,row.source_note,time);
  db.prepare('UPDATE zakat_worksheets SET version=version+1,updated_at=? WHERE id=?').run(time,z.id);
  audit(db,u,'zakat_worksheet',z.id,'zakat.lines_saved',{version:z.version},{version:z.version+1,lines:rows.length});
  return {id:z.id};
}
export function zakatAction(db,supplied,worksheetId,action,input){
  writing(db);const u=reader(db,supplied);
  const fields={review_zakat:['note'],revise_zakat:['note']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const z=typeof worksheetId==='string'&&db.prepare('SELECT * FROM zakat_worksheets WHERE id=? AND tenant_id=?').get(worksheetId,u.tenant_id);
  if(!z)fail(404,'not_found','الورقة غير متاحة');
  v.version(input.version,z.version);
  const view=zakatView(db,u,z);
  const time=now(),note=v.text(input.note,'ما الذي اعتمدته',2000,10);
  if(action==='review_zakat'){
    if(!view.actions.includes('review_zakat'))fail(409,'action_unavailable','الإجراء غير متاح في حالة الورقة أو لصلاحيتك');
    if(z.prepared_by===u.id)fail(403,'self_approval','من أعدّ الورقة لا يعتمدها');
    if(view.empty_lines)fail(409,'lines_incomplete',`بقي ${view.empty_lines} بندًا بلا مبلغ. يملؤها المختص قبل الاعتماد`);
    db.prepare("UPDATE zakat_worksheets SET status='reviewed',reviewed_by=?,reviewed_at=?,review_note=?,version=version+1,updated_at=? WHERE id=?").run(u.id,time,note,time,z.id);
    audit(db,u,'zakat_worksheet',z.id,'zakat.reviewed',{status:z.status},{version:z.version+1},note);
    return {id:z.id};
  }
  if(z.status!=='reviewed'||!u.may_prepare)fail(409,'action_unavailable','النسخة الجديدة تُفتح بعد اعتماد الحالية');
  db.prepare("UPDATE zakat_worksheets SET status='superseded',version=version+1,updated_at=? WHERE id=?").run(time,z.id);
  const next=id();
  db.prepare("INSERT INTO zakat_worksheets(id,tenant_id,fiscal_year,revision,status,specialist_name,basis_note,prepared_by,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?,?,?,?)")
    .run(next,u.tenant_id,z.fiscal_year,z.revision+1,z.specialist_name,z.basis_note,u.id,time,time);
  audit(db,u,'zakat_worksheet',next,'zakat.revised',{supersedes:z.id},{revision:z.revision+1},note);
  return {id:next};
}
