import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can, holds } from './access.mjs';
import { financeCapabilities } from './finance.mjs';
import { payableBalance } from './payables.mjs';
import { registerAdoption, adopted } from './options.mjs';
import { workbook, csv } from './xlsx.mjs';
import { MORE_REPORTS } from './reports-more.mjs';
import { GOVERNANCE_REPORTS } from './reports-governance.mjs';
import { SPECIALIST_REPORTS } from './reports-specialist.mjs';
import { dayStates } from './attendance.mjs';
import { targetsByCode, DERIVED_MARK } from './service-target.mjs';
import { compositeSheets, compositeRows, compositePrintable } from './report-figures.mjs';
import { buildEpmoBody, canRead as epmoCanRead } from './epmo-report.mjs';

// مركز التقارير. كل تقرير: تعريف ومصدر وصلاحية، ويُحسب من سجلات المنصة لحظة الطلب.
// الصلاحية تُفحص عند الفتح والتصدير وقراءة اللقطة؛ حفظ لقطة لا يمنح حقًا على بياناتها.
const riyadhDate=iso=>new Date(Date.parse(iso)+3*3600000).toISOString().slice(0,10);
const days=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const sar=minor=>Math.round(minor)/100;
const finance=(db,u)=>financeCapabilities(db,u).includes('read');
// مهلة سداد الموردين (أيام من تاريخ فاتورتهم الضريبية): قرار المالية لا رقمٌ تخترعه المنصة. مسجّلة بلا قيمة ({days:null})، وما دامت
// كذلك يقول تقرير الأعمار إنه يعدّ من تاريخ الفاتورة لا من الاستحقاق ويسمّي القرار ومالكه. شروط الدفع في ملف المورد نصٌّ حر
// («ثلاثون يومًا بعد المطابقة») لا يُحلَّل تخمينًا؛ والمهلة لكل مورد بعينه تأتي بعد أن تكون لها بنية في ملفه.
export const PAYMENT_TERMS='payables.payment_terms_days';
registerAdoption({key:PAYMENT_TERMS,label:'مهلة سداد الموردين من تاريخ فاتورتهم',module:'payables',
  owner:'المالية — من يحمل تصريح «الدفتر المالي والمستحقات»',owner_role:'finance',manage_capability:'finance.use',
  governance:'managed',shape:'object',default:{days:null},
  basis:'ما قرّرها أحد بعد، والمنصة ما تخترع مهلة: حتى يقرّرها المالك ويعتمدها شخص ثانٍ تُعدّ أعمار مستحقات الموردين من تاريخ الفاتورة لا من تاريخ استحقاقها. القيمة {"days": عدد صحيح من 0 إلى 365} تُضاف إلى تاريخ الفاتورة الضريبية المتحقَّق منها (أو تاريخ المطابقة إن لم تُسجَّل)'});
function paymentTerms(db,tenantId,date){
  const decision=adopted(db,tenantId,PAYMENT_TERMS,date),days=decision.value?.days;
  return {days:Number.isInteger(days)&&days>=0&&days<=365?days:null,decision};
}
const plusDays=(date,n)=>new Date(Date.parse(`${date}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);
const bucketOf=late=>late<=0?'لم يحل':late<=30?'1–30':late<=60?'31–60':late<=90?'61–90':'أكثر من 90';
const vendorsAccess=(db,u)=>['vendors.view','vendors.manage','vendors.assess'].some(k=>can(db,u,k))||holds(db,u,'vendors.bank');

export const REPORTS=[
  {key:'R07',group:'الإدارات والخدمات',title:'الطلبات وأزمنة الخدمة',definition:'الطلبات المنشأة في الفترة بحسب الخدمة: عددها وحالتها، ومتوسط أيام الإنجاز للمكتمل منها مقارنة بالزمن المستهدف.',source:'requests + service_directory',
    allowed:(db,u)=>can(db,u,'executive.view')||u.role==='manager',
    run(db,u,{from,to}){
      const scoped=!can(db,u,'executive.view');
      const rows=db.prepare(`SELECT s.code,s.name_ar,d.name AS department,COALESCE(sd.target_days,0) AS target,COUNT(*) AS total,SUM(r.status='completed') AS completed,SUM(r.status IN ('pending','approved','in_progress','returned')) AS open,SUM(r.status IN ('rejected','cancelled')) AS closed_without,AVG(CASE WHEN r.status='completed' THEN julianday(r.updated_at)-julianday(r.created_at) END) AS avg_days FROM requests r JOIN services s ON s.id=r.service_id JOIN departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id LEFT JOIN service_directory sd ON sd.tenant_id=s.tenant_id AND sd.service_code=s.code WHERE r.tenant_id=? AND r.status<>'draft' AND date(r.created_at,'+3 hours') BETWEEN ? AND ? ${scoped?'AND s.department_id=?':''} GROUP BY s.id ORDER BY total DESC`).all(...(scoped?[u.tenant_id,from,to,u.department_id]:[u.tenant_id,from,to]));
      // عمود «ضمن المستهدف» يحكم على إدارة بمقياس؛ فيُقال عن المقياس نفسه من وضعه (app/service-target.mjs).
      const targets=targetsByCode(db,u.tenant_id);
      const withTarget=rows.filter(r=>r.target).length;
      const unadopted=rows.filter(r=>r.target&&targets.get(r.code)&&!targets.get(r.code).adopted).length;
      return {columns:[['code','الرمز','text'],['name','الخدمة','text'],['department','الإدارة','text'],['total','الطلبات','number'],['completed','مكتمل','number'],['open','مفتوح','number'],['closed_without','مرفوض أو ملغى','number'],['avg_days','متوسط أيام الإنجاز','number'],['target','المستهدف بالأيام','number'],['target_source','مصدر المستهدف','text'],['within','ضمن المستهدف','text']],
        rows:rows.map(r=>({code:r.code,name:r.name_ar,department:r.department,total:r.total,completed:r.completed,open:r.open,closed_without:r.closed_without,avg_days:r.avg_days===null?null:Math.round(r.avg_days*10)/10,target:r.target||null,
          target_source:r.target?(targets.get(r.code)?.note??''):'—',
          within:r.avg_days===null||!r.target?'—':r.avg_days<=r.target?'نعم':'لا'})),
        notes:[scoped?'النطاق: خدمات إدارتك فقط.':'النطاق: كل الإدارات.','الزمن تقويمي من الإنشاء إلى الإكمال؛ لا يستبعد أيام الانتظار ولا العطل بعد.',
          // تقريرٌ فارغ لا يُطمئن: «كل زمن هنا متبنّى» تُقال حين يكون هنا زمنٌ فعلًا، لا حين لا يكون هنا صف واحد.
          unadopted?`${unadopted} من الخدمات في هذا التقرير زمنها المستهدف ${DERIVED_MARK} ولم يتبنَّه أحد: عمود «ضمن المستهدف» فيها يقيس إلى رقم لم تلتزم به إدارة.`
            :withTarget?'كل زمن مستهدف في هذا التقرير تبنّاه مالك إجراء بقرار مكتوب.'
            :'لا خدمة في هذا النطاق لها زمن مستهدف مسجَّل في الدليل، فعمود «ضمن المستهدف» لا يقيس إلى شيء.']};
    }},
  {key:'R10',group:'الإدارات والخدمات',title:'رضا الموظفين عن الخدمات',definition:'تقييمات أصحاب الطلبات بعد الإنجاز (1–5) بحسب الخدمة، وعدد التقييمات المنخفضة.',source:'request_feedback',
    allowed:(db,u)=>can(db,u,'executive.view')||u.role==='manager',
    run(db,u,{from,to}){
      const scoped=!can(db,u,'executive.view');
      const rows=db.prepare(`SELECT s.code,s.name_ar,d.name AS department,COUNT(*) AS ratings,AVG(f.rating) AS average,SUM(f.rating<=2) AS low FROM request_feedback f JOIN requests r ON r.id=f.request_id JOIN services s ON s.id=r.service_id JOIN departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id WHERE f.tenant_id=? AND date(f.created_at,'+3 hours') BETWEEN ? AND ? ${scoped?'AND s.department_id=?':''} GROUP BY s.id ORDER BY average`).all(...(scoped?[u.tenant_id,from,to,u.department_id]:[u.tenant_id,from,to]));
      return {columns:[['code','الرمز','text'],['name','الخدمة','text'],['department','الإدارة','text'],['ratings','عدد التقييمات','number'],['average','المتوسط من 5','number'],['low','تقييم 1 أو 2','number']],rows:rows.map(r=>({code:r.code,name:r.name_ar,department:r.department,ratings:r.ratings,average:Math.round(r.average*100)/100,low:r.low})),notes:['التقييم اختياري؛ الخدمات بلا تقييم لا تظهر، وغيابها ليس رضا.']};
    }},
  {key:'R26',group:'المشتريات والموردون',title:'تسجيل الموردين وتأهيلهم والنواقص',definition:'كل مورد بحالته وتصنيفاته ووثائقه الإلزامية غير المستوفاة وتاريخ آخر قرار.',source:'vendors + vendor_documents + vendor_decisions',allowed:vendorsAccess,
    run(db,u){
      const names={draft:'مسودة',in_review:'قيد التأهيل',approved:'معتمد',conditional:'معتمد بشروط',rejected:'مرفوض',suspended:'موقوف',requalification:'إعادة تأهيل',merged:'مدموج'};
      const rows=db.prepare('SELECT * FROM vendors WHERE tenant_id=? ORDER BY code').all(u.tenant_id).map(x=>{
        const docs=db.prepare("SELECT kind,verification,expires_on FROM vendor_documents WHERE vendor_id=? AND superseded_by IS NULL").all(x.id),today=riyadhDate(now());
        const last=db.prepare('SELECT created_at FROM vendor_decisions WHERE vendor_id=? ORDER BY created_at DESC LIMIT 1').get(x.id);
        return {code:x.code,name:x.legal_name,status:names[x.status],categories:JSON.parse(x.categories).join('، '),pending_docs:docs.filter(d=>d.verification==='pending').length,expired_docs:docs.filter(d=>d.verification==='verified'&&d.expires_on&&d.expires_on<today).length,valid_until:x.valid_until??'',last_decision:last?riyadhDate(last.created_at):''};});
      return {columns:[['code','الرقم','text'],['name','المورد','text'],['status','الحالة','text'],['categories','التصنيفات','text'],['pending_docs','وثائق بانتظار التحقق','number'],['expired_docs','وثائق منتهية','number'],['valid_until','نهاية الاعتماد المشروط','text'],['last_decision','آخر قرار','text']],rows,notes:['الحالة لحظية بتاريخ الاستخراج ولا تتأثر بالفترة.']};
    }},
  {key:'R28',group:'المشتريات والموردون',title:'الإنفاق والالتزامات حسب المورد',definition:'أوامر الشراء الداخلية المعتمدة في الفترة لكل مورد، وما طوبق من فواتيره، وما نُفذ دفعه فعلًا.',source:'procurement_orders + procurement_payables + payment_orders',allowed:(db,u)=>vendorsAccess(db,u)||finance(db,u),
    run(db,u,{from,to}){
      const rows=db.prepare("SELECT o.supplier_key,MAX(o.supplier_name) AS name,COUNT(*) AS orders,SUM(o.total_minor) AS committed FROM procurement_orders o JOIN procurement_purchases p ON p.id=o.purchase_id WHERE p.tenant_id=? AND p.status<>'cancelled' AND date(o.created_at,'+3 hours') BETWEEN ? AND ? GROUP BY o.supplier_key ORDER BY committed DESC").all(u.tenant_id,from,to);
      const total=rows.reduce((n,r)=>n+r.committed,0);
      return {columns:[['supplier','المورد','text'],['orders','أوامر','number'],['committed','التزام (ريال)','money'],['share','الحصة %','number'],['matched','مطابَق (ريال)','money'],['paid','مدفوع وموثق (ريال)','money']],
        rows:rows.map(r=>{const matched=db.prepare('SELECT COALESCE(SUM(y.amount_minor),0) AS n FROM procurement_payables y JOIN procurement_invoices i ON i.id=y.invoice_id WHERE i.tenant_id=? AND i.supplier_key=?').get(u.tenant_id,r.supplier_key).n,paid=db.prepare("SELECT COALESCE(SUM(po.amount_minor),0) AS n FROM payment_orders po JOIN procurement_payables y ON y.id=po.payable_id JOIN procurement_invoices i ON i.id=y.invoice_id WHERE i.tenant_id=? AND i.supplier_key=? AND po.status='executed'").get(u.tenant_id,r.supplier_key).n;return {supplier:r.name,orders:r.orders,committed:sar(r.committed),share:total?Math.round(r.committed*1000/total)/10:0,matched:sar(matched),paid:sar(paid)};}),
        totals:{committed:sar(total)},notes:['الالتزام والمطابَق والمدفوع مراحل للمعاملة نفسها؛ لا تُجمع معًا.','المدفوع هو ما وُثق تنفيذه البنكي فقط.']};
    }},
  {key:'R29',group:'المشتريات والموردون',title:'أداء الموردين',definition:'متوسط التقييم الموزون لكل مورد من تقييماته السارية (غير المصححة) في الفترة.',source:'vendor_evaluations',allowed:vendorsAccess,
    run(db,u,{from,to}){
      const rows=db.prepare("SELECT x.code,x.legal_name,COUNT(*) AS evaluations,AVG(e.weighted_score) AS score,MIN(e.weighted_score) AS lowest FROM vendor_evaluations e JOIN vendors x ON x.id=e.vendor_id WHERE x.tenant_id=? AND date(e.created_at,'+3 hours') BETWEEN ? AND ? AND NOT EXISTS(SELECT 1 FROM vendor_evaluations c WHERE c.corrects_id=e.id) GROUP BY x.id ORDER BY score DESC").all(u.tenant_id,from,to);
      return {columns:[['code','الرقم','text'],['name','المورد','text'],['evaluations','تقييمات','number'],['score','المتوسط من 5','number'],['lowest','أدنى تقييم','number']],rows:rows.map(r=>({code:r.code,name:r.legal_name,evaluations:r.evaluations,score:Math.round(r.score)/100,lowest:r.lowest/100})),notes:['التقييم دليل لقرار يتخذه مسؤول؛ لا يوقف موردًا تلقائيًا.']};
    }},
  {key:'R31',group:'المالية',title:'أعمار ذمم العملاء',definition:'الاستحقاقات المعتمدة اللي باقي عليها شي بعد الإشعارات الدائنة والمحصَّل، مصنفة بأيام التأخر عن تاريخ الاستحقاق، ومعها المتنازع عليه في شريحته.',source:'ar_claims + ar_claim_collection (الصافي والمحصَّل) + ar_disputes',allowed:finance,
    run(db,u,{to}){
      // الأرقام من منظور التحصيل الواحد (ar_claim_collection، الترحيل 170) الذي تفرضه قيود القاعدة: الصافي بعد الإشعارات الدائنة
      // الصادرة، والمحصَّل = المؤكد غير المرتد + المخصص الحي من القبض على الحساب. كان التقرير يطرح كل قبض مؤكد من القيمة الأصلية،
      // فالقبض المرتد يُخفي الذمة، والإشعار الدائن والتخصيص لا يظهران.
      const rows=db.prepare(`SELECT c.id,c.due_date,c.currency,k.name,s.net_minor,s.received_minor+s.allocated_minor AS collected FROM ar_claims c JOIN commercial_cases k ON k.id=c.case_id
          JOIN ar_claim_collection s ON s.claim_id=c.id WHERE c.tenant_id=? AND c.status='approved'`).all(u.tenant_id).map(c=>{
        const balance=Math.max(0,c.net_minor-c.collected),late=days(c.due_date,to);
        const disputed=!!db.prepare('SELECT 1 FROM ar_disputes WHERE claim_id=? AND resolved_at IS NULL').get(c.id);
        return {customer:c.name,due_date:c.due_date,amount:sar(c.net_minor),received:sar(c.collected),balance:sar(balance),days_late:Math.max(0,late),bucket:disputed?'متنازع عليه':late<=0?'لم يحل':late<=30?'1–30':late<=60?'31–60':late<=90?'61–90':'أكثر من 90',currency:c.currency,_balance:balance};}).filter(r=>r._balance>0);
      return {columns:[['customer','العميل','text'],['due_date','تاريخ الاستحقاق','text'],['amount','الصافي بعد الإشعارات الدائنة','money'],['received','المحصَّل','money'],['balance','الرصيد','money'],['days_late','أيام التأخر','number'],['bucket','الشريحة','text'],['currency','العملة','text']],rows:rows.map(({_balance,...r})=>r),totals:{balance:sar(rows.reduce((n,r)=>n+r._balance,0))},
        notes:['المحصَّل = القبض المؤكد اللي ما ارتد + المخصص من قبض العميل على الحساب. القبض المرتد يرجّع الرصيد.','الصافي بعد الإشعارات الدائنة الصادرة؛ المسودة ما تنقص شي.','وعد السداد ليس قبضًا ولا يخفض الرصيد.','المتنازع عليه يظهر في شريحة مستقلة لا مع المتأخر العادي.','الرصيد كما هو اليوم، والأعمار محسوبة حتى نهاية الفترة المختارة.']};
    }},
  {key:'R32',group:'المالية',title:'مستحقات الموردين',definition:'كل مستحق مطابَق: مبلغه، وتسوياته المعتمدة، والمحوَّل منه فعلًا، وما في الطريق، والباقي عليه.',source:'payable_balances (procurement_payables + payment_order_lines + payment_returns + payable_adjustments)',allowed:finance,
    run(db,u){
      // من الرؤية payable_balances (الترحيل 166) نفسها التي يقرؤها قادح الرصيد: الدفعة الجزئية والمجمّعة بسطورها، والمرتجع يرجّع
      // الرصيد، والإشعار الدائن من المورد ينقصه. كان التقرير يقرأ أول أمر على payment_orders.payable_id، فيقول «منفذ وموثق» عن
      // مستحق دُفع ربعه، ويقول «بلا أمر دفع» عن مستحق في أمر مجمّع.
      const rows=db.prepare(`SELECT b.*,y.created_at,i.supplier_reference,o.supplier_name FROM payable_balances b JOIN procurement_payables y ON y.id=b.payable_id
          JOIN procurement_invoices i ON i.id=y.invoice_id JOIN procurement_orders o ON o.purchase_id=y.purchase_id WHERE i.tenant_id=? ORDER BY y.created_at,y.id`).all(u.tenant_id)
        .map(r=>({r,balance:payableBalance(db,r.payable_id)}));
      return {columns:[['supplier','المورد','text'],['reference','مرجع الفاتورة','text'],['matched_on','تاريخ المطابقة','text'],['amount','المبلغ المطابق','money'],['adjustments','التسويات المعتمدة','money'],
          ['paid','المحوَّل وما رجع','money'],['in_flight','في الطريق (أوامر معلّقة ومعتمدة)','money'],['outstanding','الباقي','money'],['state','حالة الدفع','text']],
        rows:rows.map(({r,balance})=>({supplier:r.supplier_name,reference:r.supplier_reference,matched_on:riyadhDate(r.created_at),amount:sar(r.amount_minor),adjustments:sar(r.debit_minor-r.credit_minor),
          paid:sar(r.paid_minor),in_flight:sar(r.in_flight_minor),outstanding:sar(r.outstanding_minor),state:balance.status_name})),
        totals:{outstanding:sar(rows.reduce((n,x)=>n+x.r.outstanding_minor,0)),in_flight:sar(rows.reduce((n,x)=>n+x.r.in_flight_minor,0))},
        notes:['«المحوَّل» تنفيذٌ وثّقه موظف بمرجعه البنكي وما رجع؛ التحويل الراجع يرجّع الباقي كما كان.','الأمر المعتمد اللي ما انحوّل التزامٌ في الطريق، مو مدفوع.','التسويات: إشعار مدين من المورد يزيد الباقي، وإشعار دائن ينقصه.']};
    }},
  {key:'R41',group:'المالية',title:'أعمار مستحقات الموردين',definition:'كل مستحق مورد باقي عليه شي، بتاريخ فاتورته وتاريخ استحقاقه (الفاتورة زائد مهلة السداد اللي تقررها المالية) وأيام تأخره، بالباقي عليه بعد المحوَّل والتسويات.',
    source:'payable_balances + procurement_invoice_tax (المتحقَّق منها) + قرار payables.payment_terms_days',allowed:finance,
    run(db,u,{to}){
      // الباقي من الرؤية payable_balances (الترحيل 166)، وتاريخ الفاتورة من سجلها الضريبي المتحقَّق منه — التاريخ الذي تقيّد به ضريبة
      // المدخلات — وإلا تاريخ المطابقة، وهو لحظة اعتراف الدفتر بالالتزام.
      const terms=paymentTerms(db,u.tenant_id,to);
      const rows=db.prepare(`SELECT b.payable_id,b.outstanding_minor,b.in_flight_minor,y.created_at,i.supplier_reference,o.supplier_name,
          (SELECT t.invoice_date FROM procurement_invoice_tax t WHERE t.invoice_id=i.id AND t.status='verified') AS tax_date
        FROM payable_balances b JOIN procurement_payables y ON y.id=b.payable_id JOIN procurement_invoices i ON i.id=y.invoice_id JOIN procurement_orders o ON o.purchase_id=y.purchase_id
        WHERE i.tenant_id=? AND b.outstanding_minor>0 ORDER BY y.created_at,y.id`).all(u.tenant_id).map(r=>{
        const invoiced=r.tax_date??riyadhDate(r.created_at),due=terms.days===null?'':plusDays(invoiced,terms.days);
        const late=due?days(due,to):days(invoiced,to),balance=payableBalance(db,r.payable_id);
        return {supplier:r.supplier_name,reference:r.supplier_reference,invoice_date:invoiced,invoice_date_basis:r.tax_date?'الفاتورة الضريبية':'تاريخ المطابقة',due_date:due,days_late:Math.max(0,late),
          bucket:due?bucketOf(late):`منذ الفاتورة: ${bucketOf(late)}`,outstanding:sar(r.outstanding_minor),in_flight:sar(r.in_flight_minor),state:balance.status_name,_outstanding:r.outstanding_minor};
      });
      return {columns:[['supplier','المورد','text'],['reference','مرجع الفاتورة','text'],['invoice_date','تاريخ الفاتورة','text'],['invoice_date_basis','أساس التاريخ','text'],['due_date','تاريخ الاستحقاق','text'],
          ['days_late',terms.days===null?'أيام منذ الفاتورة':'أيام التأخر','number'],['bucket','الشريحة','text'],['outstanding','الباقي','money'],['in_flight','في الطريق','money'],['state','حالة الدفع','text']],
        rows:rows.map(({_outstanding,...r})=>r),totals:{outstanding:sar(rows.reduce((n,r)=>n+r._outstanding,0))},
        notes:[terms.days===null?`مهلة سداد الموردين ما تقررت (${PAYMENT_TERMS}): الأعمار من تاريخ الفاتورة لا من تاريخ الاستحقاق. يقررها ${terms.decision.owner} ويعتمدها زميل ثانٍ.`
            :`تاريخ الاستحقاق = تاريخ الفاتورة + ${terms.days} يومًا (${PAYMENT_TERMS}).`,
          'تاريخ الفاتورة من سجلها الضريبي المتحقَّق منه، وإلا تاريخ المطابقة.','الباقي بعد المحوَّل اللي ما رجع والتسويات المعتمدة؛ «في الطريق» أوامر معلّقة ومعتمدة ما انحوّلت.','الأعمار حتى نهاية الفترة المختارة.']};
    }},
  {key:'R34',group:'المالية',title:'العهد والمصروفات والتسويات',definition:'مطالبات المصروفات في الفترة بحسب التصنيف والحالة، والعهد المصروفة غير المسوّاة.',source:'expense_claims + custodies',allowed:finance,
    run(db,u,{from,to}){
      const names={travel:'سفر وانتداب',hospitality:'ضيافة',supplies:'مستلزمات',transport:'نقل',subscriptions:'اشتراكات',production:'إنتاج ميداني',other:'أخرى'};
      // D-09: المطالبة المسحوبة قبل أول قرار لا تدخل العدد ولا المجموع؛ صفها محفوظ للأثر لا للتقرير.
      const rows=db.prepare("SELECT category,COUNT(*) AS claims,SUM(amount_minor) AS total,SUM(CASE WHEN status IN ('finance_approved','reimbursed') THEN amount_minor ELSE 0 END) AS approved,SUM(CASE WHEN status='reimbursed' THEN amount_minor ELSE 0 END) AS reimbursed,SUM(status='rejected') AS rejected FROM expense_claims WHERE tenant_id=? AND expense_date BETWEEN ? AND ? AND withdrawn_at IS NULL GROUP BY category ORDER BY total DESC").all(u.tenant_id,from,to);
      const open=db.prepare("SELECT COALESCE(SUM(c.amount_minor-c.returned_minor-(SELECT COALESCE(SUM(e.amount_minor),0) FROM expense_claims e WHERE e.custody_id=c.id AND e.status='finance_approved')),0) AS n FROM custodies c WHERE c.tenant_id=? AND c.status='issued'").get(u.tenant_id).n;
      return {columns:[['category','التصنيف','text'],['claims','مطالبات','number'],['total','المطالب به','money'],['approved','المعتمد','money'],['reimbursed','المعوَّض','money'],['rejected','مرفوض','number']],rows:rows.map(r=>({category:names[r.category],claims:r.claims,total:sar(r.total),approved:sar(r.approved),reimbursed:sar(r.reimbursed),rejected:r.rejected})),totals:{open_custody:sar(open)},notes:['«عهد مصروفة غير مسوّاة» لحظية بتاريخ الاستخراج.']};
    }},
  {key:'R36',group:'الموظفون والتشغيل',title:'القوى العاملة والعقود',definition:'عدد الحسابات النشطة لكل إدارة، ومن له عقد ساري في المنصة ومن ليس له، والعقود المحددة المدة التي تنتهي خلال 90 يومًا.',source:'users + employment_contracts',allowed:(db,u)=>can(db,u,'employees.view')||holds(db,u,'hr.contracts.approve'),
    run(db,u){
      const today=riyadhDate(now()),limit=new Date(Date.parse(today)+90*86400000).toISOString().slice(0,10);
      const rows=db.prepare("SELECT d.name,COUNT(*) AS headcount,SUM(EXISTS(SELECT 1 FROM employment_contracts c WHERE c.user_id=x.id AND c.status='active')) AS with_contract,SUM(EXISTS(SELECT 1 FROM employment_contracts c WHERE c.user_id=x.id AND c.status='active' AND c.end_date IS NOT NULL AND c.end_date<=?)) AS ending FROM users x JOIN departments d ON d.id=x.department_id AND d.tenant_id=x.tenant_id WHERE x.tenant_id=? AND x.active=1 AND x.role<>'admin' GROUP BY d.id ORDER BY headcount DESC").all(limit,u.tenant_id);
      return {columns:[['department','الإدارة','text'],['headcount','حسابات نشطة','number'],['with_contract','لهم عقد ساري','number'],['without_contract','بلا عقد مسجل','number'],['ending','عقود تنتهي خلال 90 يومًا','number']],rows:rows.map(r=>({department:r.name,headcount:r.headcount,with_contract:r.with_contract,without_contract:r.headcount-r.with_contract,ending:r.ending})),notes:['لا رواتب في هذا التقرير. العدد يعتمد على الحسابات النشطة لا على كشف رسمي للموظفين.']};
    }},
  {key:'R37',group:'الموظفون والتشغيل',title:'الحضور والغياب المعتمد',definition:'لكل موظف في الفترة: أيام سُجل فيها حضور، وأيام التأخر والانصراف المبكر بلا إذن، وأيام بسجل ناقص، وأيام غياب غير مدفوع معتمدة، وطلبات تصحيح.',source:'attendance_records + attendance_absences + attendance_corrections + attendance_permissions + attendance_notices + attendance_exemptions',allowed:(db,u)=>holds(db,u,'hr.attendance.manage')||holds(db,u,'hr.attendance.approve'),
    run(db,u,{from,to}){
      const rows=db.prepare("SELECT x.id,x.name,d.name AS department,(SELECT COUNT(*) FROM attendance_records r WHERE r.user_id=x.id AND r.work_date BETWEEN ? AND ? AND r.check_in_at IS NOT NULL AND r.check_out_at IS NOT NULL) AS complete,(SELECT COUNT(*) FROM attendance_records r WHERE r.user_id=x.id AND r.work_date BETWEEN ? AND ? AND (r.check_in_at IS NULL OR r.check_out_at IS NULL)) AS incomplete,(SELECT COUNT(*) FROM attendance_absences a WHERE a.user_id=x.id AND a.status='confirmed' AND a.work_date BETWEEN ? AND ?) AS unpaid,(SELECT COUNT(*) FROM attendance_corrections c WHERE c.user_id=x.id AND c.work_date BETWEEN ? AND ?) AS corrections FROM users x JOIN departments d ON d.id=x.department_id AND d.tenant_id=x.tenant_id WHERE x.tenant_id=? AND x.active=1 AND x.role<>'admin' ORDER BY x.name").all(from,to,from,to,from,to,from,to,u.tenant_id);
      // أيام التأخر والانصراف المبكر بلا إذن من حالة اليوم نفسها (قواعد الحضور 099): الاستئذان المعتمد والإعفاء يرفعانها.
      const tally=r=>{const days=dayStates(db,{id:r.id,tenant_id:u.tenant_id},from,to);return {late:days.filter(d=>d.state==='late').length,early_leave:days.filter(d=>d.state==='early_leave').length,excused:days.filter(d=>d.state==='present_permission').length};};
      return {columns:[['name','الموظف','text'],['department','الإدارة','text'],['complete','أيام حضور مكتملة','number'],['late','أيام تأخر','number'],['early_leave','انصراف مبكر بلا إذن','number'],['excused','بإذن أو عذر مقبول','number'],['incomplete','سجل ناقص','number'],['unpaid','غياب غير مدفوع معتمد','number'],['corrections','طلبات تصحيح','number']],
        rows:rows.map(({id,...r})=>({...r,...tally({id})})),notes:['السجل الناقص يحتاج توضيحًا وليس مخالفة.','أيام التأخر بعد مهلة السياسة المقبولة؛ الاستئذان المعتمد أو إشعار التأخر المقبول يرفعها. التأخر ليس خصمًا ولا جزاءً تلقائيًا.','لا يُستخدم هذا التقرير لترتيب الموظفين.']};
    }},
  // ───── تقرير مركّب: أقسام وبنود لا جدول واحد ─────
  // `shape:'composite'` يعني أن النتيجة أقسامٌ فيها مجموعات فيها بنود (app/report-figures.mjs)، لا صفوفًا
  // وأعمدة. ومع ذلك يبقى `columns` و`rows` موجودَين فارغَين في كل لقطة مركّبة، لأن قواعد الرؤية
  // (`governs`) تقرأ `rows` على لقطة `executive_finance`؛ غيابهما يجعلها تنغلق لسبب خاطئ لا لقاعدة.
  {key:'E01',group:'القيادة والحوكمة',title:'تقرير الإدارة التنفيذية للمشاريع',shape:'composite',
    definition:'تقرير الإدارة التنفيذية للمشاريع للفترة: المحفظة والمعوّقات والأهداف والمخاطر والقرارات، وكل قسم بتغطيته المعلنة. ما لا يُقاس يُكتب فجوةً معلنة باسم إدارتها وسببها وما يلزم لقياسها، ولا يُكتب صفرًا. لا نسبة إنجاز في هذا التقرير.',
    source:'epmo-report.mjs (SECTIONS + MEASUREMENT_GAPS) + epmo_section_notes + epmo_gap_plans + governance_* + projects + tasks + requests',
    allowed:(db,u)=>epmoCanRead(db,u),
    run(db,u,{from,to}){
      const body=buildEpmoBody(db,u,{from,to});
      return {shape:'composite',sections:body.sections,coverage:body.coverage,section_coverage:body.section_coverage,
        columns:[],rows:[],totals:{},
        notes:['التغطية المعلنة نسبة ما قيس إلى ما صُرِّح به في التقرير، وليست نسبة أداء ولا نسبة إنجاز.',
          'البند «غير متاح» مصدره قائم في المنصة وهذه الفترة بلا قيد فيه؛ و«غير قابل للقياس» لا سجل له أصلًا ولكل واحد منها فجوة معلنة باسم من تسلّمها.',
          'قراءة الإدارة لكل قسم مطوية داخل التقرير نفسه، فتُختم الكلمات مع الأرقام في بصمة اللقطة الواحدة.']};
    }}
];
REPORTS.push(...MORE_REPORTS,...GOVERNANCE_REPORTS,...SPECIALIST_REPORTS);REPORTS.sort((a,b)=>a.key.localeCompare(b.key));
const byKey=new Map(REPORTS.map(r=>[r.key,r]));

function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function period(input){
  const today=riyadhDate(now()),from=input?.from?v.date(input.from):`${today.slice(0,4)}-01-01`,to=input?.to?v.date(input.to):today;
  if(to<from)fail(400,'date_order','نهاية الفترة بعد بدايتها');
  if(days(from,to)>1100)fail(400,'period_too_long','الفترة لا تتجاوز ثلاث سنوات');
  return {from,to};
}
function definition(db,u,key){const report=byKey.get(key);if(!report||!report.allowed(db,u))fail(404,'not_found','التقرير غير متاح لك');return report;}
const LIVE_NOTE='تقرير حي: قد تتغير أرقامه مع تغير السجلات. اللقطة المعتمدة وحدها ثابتة.';
export function runReport(db,supplied,key,input){
  const u=actor(db,supplied),report=definition(db,u,key),params=period(input),result=report.run(db,u,params);
  const meta={key:report.key,title:report.title,group:report.group,definition:report.definition,source:report.source,params,generated_at:now(),data_until:params.to,live:true};
  // التقرير المركّب: أقسامه هي بيانه، ويبقى `columns` و`rows` و`totals` موجودةً فارغة كما تقتضيه قواعد الرؤية.
  if(report.shape==='composite')
    return {...meta,shape:'composite',sections:result.sections,coverage:result.coverage,section_coverage:result.section_coverage??{},
      columns:[],rows:[],totals:{},notes:[...(result.notes??[]),LIVE_NOTE]};
  return {...meta,
    columns:result.columns.map(([k,label,type])=>({key:k,label,type})),rows:result.rows,totals:result.totals??{},notes:[...(result.notes??[]),LIVE_NOTE]};
}
// من يرى لقطة حفظها غيره ويعتمدها (B1 وB2 في تدقيق 19 سبتمبر): اللقطة نسخة مجمّدة من بيانات مُعِدّها، فلا يكفي
// أن يحق للقارئ فتح التقرير نفسه؛ يلزم أن تغطي صلاحيته اليوم كامل ما رآه المُعِدّ. تُفحص عند كل قراءة لا عند الحفظ.
//  uniform:   بيانات التقرير لا تختلف بين من يحق لهم فتحه؛ حق التقرير نفسه يكفي.
//  executive: التقرير يُقصر على إدارة القارئ أو مشاريعه أو فريقه ما لم يحمل executive.view؛ النسخة الكاملة لحامله.
//  executive_finance: R01 يضيف قسمًا ماليًا لمن يحمل تفويض قراءة مالية؛ لقطة فيها ذلك القسم لا يراها غيره.
//  creator:   تقارير فرق العملاء تُقصر على عضوية الحساب ولا تصريح يتجاوزها، فلا يرى اللقطة إلا مُعِدّها.
// تقرير جديد بلا تصنيف هنا يُعامل «creator»: الخطأ في جهة الإغلاق لا الكشف.
// E01 «executive»: تقرير مركّب يعرض المحفظة والأهداف والمخاطر على مستوى الشركة كاملة. تركه بلا تصنيف
// يجعله «creator» فلا يراه إلا مُعِدّه، ولا يجد من يعتمده — فيصير فصل التفويضات مستحيلًا بنية لا بقاعدة.
// R42–R45 (الحزمة 4، DOMAIN-4): الإنتاج والتغطية «uniform» — تصريح وحدتهما يفتح سجلها كله في الكيان، فلا تختلف بياناتهما بين حامليه؛
// وتسليم المؤثرين وجولات المراجعة «creator» — مقصوران على عضوية فريق العميل وعضوية المشروع كشاشتيهما، ولا تصريح يتجاوزهما.
export const AUDIENCE={uniform:['R02','R03','R04','R05','R09','R12','R26','R27','R28','R29','R30','R31','R32','R33','R34','R35','R36','R37','R38','R39','R40','R41','R42','R44'],
  executive:['E01','R06','R07','R08','R10','R11','R14','R16','R17','R24','R25'],executive_finance:['R01'],creator:['R15','R19','R20','R21','R22','R43','R45']};
const audienceOf=new Map(Object.entries(AUDIENCE).flatMap(([kind,keys])=>keys.map(k=>[k,kind])));
export const snapshotAudience=key=>audienceOf.get(key)??'creator';
const executive=(db,u)=>can(db,u,'executive.view');
function governs(db,u,report,s){
  if(!report.allowed(db,u))return false;
  const kind=snapshotAudience(report.key);
  if(kind==='uniform')return true;
  if(kind==='executive')return executive(db,u);
  if(kind==='executive_finance'){
    if(!executive(db,u))return false;
    if(finance(db,u))return true;
    try{return !JSON.parse(s.result).rows.some(r=>r.area==='المالية');}catch{return false;}
  }
  return false;
}
// اللقطة مرئية لمُعِدّها ما دام يحق له التقرير، ولمن تغطي صلاحيته بياناتها. الاعتماد لمن تغطيه صلاحيته وليس المُعِدّ.
function snapshotAccess(db,u,s){
  const report=byKey.get(s.report_key);
  if(!report||!report.allowed(db,u))return {read:false,approve:false};
  const covers=governs(db,u,report,s);
  return {read:s.created_by===u.id||covers,approve:covers&&s.created_by!==u.id};
}
export function visibleSnapshotIds(db,supplied){
  const u=actor(db,supplied);
  return db.prepare('SELECT id,report_key,created_by,result FROM report_snapshots WHERE tenant_id=?').all(u.tenant_id).filter(s=>snapshotAccess(db,u,s).read).map(s=>s.id);
}
export function reportsIndex(db,supplied){
  const u=actor(db,supplied),available=REPORTS.filter(r=>r.allowed(db,u));
  const snapshots=db.prepare('SELECT s.id,s.report_key,s.title,s.params,s.status,s.created_by,s.created_at,s.approved_at,s.result,c.name AS created_by_name,a.name AS approved_by_name FROM report_snapshots s JOIN users c ON c.id=s.created_by LEFT JOIN users a ON a.id=s.approved_by WHERE s.tenant_id=? ORDER BY s.created_at DESC LIMIT 100').all(u.tenant_id)
    .map(s=>({s,access:snapshotAccess(db,u,s)})).filter(x=>x.access.read)
    .map(({s:{result,...s},access})=>({...s,params:JSON.parse(s.params),actions:s.status==='draft'?(s.created_by===u.id?['discard_snapshot']:access.approve?['approve_snapshot']:[]):[]}));
  return {today:riyadhDate(now()),user_id:u.id,reports:available.map(({key,group,title,definition:d,source})=>({key,group,title,definition:d,source})),snapshots,
    not_built:'تصدير PDF عربي مباشر غير مبني؛ استخدم «نسخة للطباعة» ثم «حفظ كـ PDF» من المتصفح. الجدولة داخلية فقط (لقطة مسودة دورية)؛ الإرسال خارج المنصة غير مبني.'};
}
export function saveSnapshot(db,supplied,key,input){
  if(!db.isTransaction)fail(500,'transaction_required','يتطلب حفظ اللقطة معاملة');
  const result=runReport(db,supplied,key,input),u=actor(db,supplied),frozen={...result,live:false,notes:result.notes.slice(0,-1)},body=JSON.stringify(frozen),snapshotId=randomUUID();
  db.prepare("INSERT INTO report_snapshots(id,tenant_id,report_key,title,params,result,digest,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,'draft',?,?)").run(snapshotId,u.tenant_id,key,result.title,JSON.stringify(result.params),body,hash(body),u.id,now());
  audit(db,u,'report_snapshot',snapshotId,'report.snapshot_saved',{}, {report:key,...result.params});
  return {id:snapshotId};
}
export function readSnapshot(db,supplied,snapshotId){
  const u=actor(db,supplied),s=typeof snapshotId==='string'&&db.prepare('SELECT * FROM report_snapshots WHERE id=? AND tenant_id=?').get(snapshotId,u.tenant_id);
  // الطباعة والتصدير يمران من هنا أيضًا (server.mjs)، فالفحص واحد للفتح والطباعة وCSV وXLSX.
  if(!s||!snapshotAccess(db,u,s).read)fail(404,'not_found','اللقطة غير متاحة');
  if(hash(s.result)!==s.digest)fail(409,'snapshot_corrupted','بصمة اللقطة لا تطابق محتواها');
  return {...JSON.parse(s.result),snapshot:{id:s.id,status:s.status,created_at:s.created_at,approved_at:s.approved_at,digest:s.digest}};
}
export function snapshotAction(db,supplied,snapshotId,action,input){
  if(!db.isTransaction)fail(500,'transaction_required','تتطلب العملية معاملة');
  const u=actor(db,supplied),s=typeof snapshotId==='string'&&db.prepare("SELECT * FROM report_snapshots WHERE id=? AND tenant_id=? AND status='draft'").get(snapshotId,u.tenant_id);
  const access=s&&snapshotAccess(db,u,s);
  if(!s||!access.read)fail(404,'not_found','اللقطة غير متاحة للإجراء');
  if(action==='discard_snapshot'){if(s.created_by!==u.id)fail(403,'forbidden','يحذف المسودة من أنشأها');db.prepare('DELETE FROM report_snapshots WHERE id=?').run(s.id);audit(db,u,'report_snapshot',s.id,'report.snapshot_discarded');return {discarded:true};}
  if(action!=='approve_snapshot')fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['note']);
  if(s.created_by===u.id)fail(409,'separation_of_duties','من أعد اللقطة لا يعتمدها');
  if(!access.approve)fail(403,'forbidden','اعتماد اللقطة لمن تغطي صلاحيته بيانات التقرير كاملة');
  db.prepare("UPDATE report_snapshots SET status='approved',approved_by=?,approved_at=?,approval_note=? WHERE id=?").run(u.id,now(),v.text(input.note,'ما الذي راجعته',2000,10),s.id);
  audit(db,u,'report_snapshot',s.id,'report.snapshot_approved',{}, {report:s.report_key});
  return {id:s.id,status:'approved'};
}
// التصدير من النتيجة نفسها التي تُعرض على الشاشة، فتتطابق الإجماليات. المبالغ أرقام بالريال لا نصوص.
function tabular(result){
  const header=result.columns.map(c=>c.label),body=result.rows.map(r=>result.columns.map(c=>r[c.key]??''));
  const meta=[['البند','القيمة'],['التقرير',`${result.key} — ${result.title}`],['التعريف',result.definition],['المصدر',result.source],['الفترة',`${result.params.from} إلى ${result.params.to}`],['البيانات حتى',result.data_until],['أُنشئ في',result.generated_at],['النوع',result.live?'تقرير حي':'لقطة محفوظة'],...Object.entries(result.totals).map(([k,val])=>[`إجمالي: ${k}`,val]),...result.notes.map((n,i)=>[`ملاحظة ${i+1}`,n])];
  return {header,body,meta};
}
const CSV_TYPE='text/csv; charset=utf-8',XLSX_TYPE='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function exportReport(result,format){
  const base=`${result.key}-${result.params.from}-${result.params.to}`;
  // التقرير المركّب يُصدَّر بأولية المرحلة الأولى نفسها التي تعرضه: ورقة لكل قسم وورقة جامعة للفجوات
  // المعلنة بمن تسلّمها وتاريخه، وCSV مسطّح بالبنود نفسها. فلا يختلف ملف عن شاشة ولا ملف عن ملف.
  if(result.shape==='composite'){
    if(format==='csv')return {filename:`${base}.csv`,type:CSV_TYPE,content:Buffer.from(csv(compositeRows(result)),'utf8')};
    if(format==='xlsx')return {filename:`${base}.xlsx`,type:XLSX_TYPE,content:workbook(compositeSheets(result))};
    fail(400,'format','صيغة التصدير غير مدعومة. اختر إحدى الصيغ المعروضة في شاشة التقرير');
  }
  const {header,body,meta}=tabular(result);
  if(format==='csv')return {filename:`${base}.csv`,type:CSV_TYPE,content:Buffer.from(csv([header,...body]),'utf8')};
  if(format==='xlsx')return {filename:`${base}.xlsx`,type:XLSX_TYPE,content:workbook([{name:result.key,rows:[header,...body]},{name:'التعريفات والمصادر',rows:meta,widths:[24,90]}])};
  fail(400,'format','صيغة التصدير غير مدعومة. اختر إحدى الصيغ المعروضة في شاشة التقرير');
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function printable(result){
  if(result.shape==='composite')return compositePrintable(result);
  const cell=(c,r)=>c.type==='money'&&typeof r[c.key]==='number'?r[c.key].toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):esc(r[c.key]??'—');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(result.key)} — ${esc(result.title)}</title><link rel="stylesheet" href="/report-print.css"></head><body><header><p class="brand">3,6T</p><h1>${esc(result.title)}</h1><p class="meta">${esc(result.key)} · ${esc(result.group)} · الفترة ${esc(result.params.from)} إلى ${esc(result.params.to)}</p><p class="meta">البيانات حتى ${esc(result.data_until)} · أُنشئ في <bdi dir="ltr">${esc(result.generated_at)}</bdi> · ${result.live?'تقرير حي':'لقطة محفوظة '+esc(result.snapshot?.status==='approved'?'معتمدة':'غير معتمدة')} · داخلي</p></header><section><h2>التعريف</h2><p>${esc(result.definition)}</p></section><table><thead><tr>${result.columns.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${result.rows.map(r=>`<tr>${result.columns.map(c=>`<td class="${c.type==='text'?'':'num'}">${cell(c,r)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${result.columns.length}">لا بيانات في هذه الفترة. غياب البيانات ليس صفرًا.</td></tr>`}</tbody></table>${Object.keys(result.totals).length?`<section><h2>الإجماليات</h2><ul>${Object.entries(result.totals).map(([k,val])=>`<li>${esc(k)}: ${esc(typeof val==='number'?val.toLocaleString('en-US',{minimumFractionDigits:2}):val)}</li>`).join('')}</ul></section>`:''}<section><h2>المنهج والملاحظات</h2><ul>${result.notes.map(n=>`<li>${esc(n)}</li>`).join('')}<li>المصدر: <bdi dir="ltr">${esc(result.source)}</bdi></li></ul></section><footer>للحفظ PDF: اطبع هذه الصفحة واختر «حفظ كـ PDF».</footer></body></html>`;
}
