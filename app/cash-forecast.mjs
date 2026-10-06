import { fail } from './auth.mjs';
import { now } from './db.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';
import { acceptedPolicy } from './hr-contracts.mjs';
import { baseLines } from './payroll.mjs';
// قاعدة «متى تُفوتر الجدولة» يملكها ملف الفوترة الدورية وحده؛ نستوردها ولا ننسخها حتى لا يوجد مصدران للحقيقة.
import { duePeriods } from './billing-recurring.mjs';
// سجلات النقد النهائية بقائمة وحدة البنك نفسها (cashRecords)، فلا تُكتب أنواع النقد مرتين.
import { cashRecords } from './bank-reconciliation.mjs';
import { refuse } from './refusal.mjs';
import { riyadhDateOf } from './riyadh-time.mjs';

// التنبؤ النقدي المتجدد لثلاثة عشر أسبوعًا. لا يخزّن شيئًا: كل رقم يُشتق من مستندات المنصة وقت العرض،
// والرصيد الافتتاحي والسيناريوهات معاملات إدخال تُحسب فورًا ولا تصير حقيقة محفوظة.
// المؤكد = مستند بمبلغ معتمد وتاريخ محدد. المتوقع = مبلغ أو تاريخ مستنتج. لا يُجمعان في رقم واحد.
export const WEEKS=13;
export const CERTAINTY={confirmed:'مؤكد',expected:'متوقع'};
const DAY=86400000;
const SMALL_SAMPLE=12;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const pad=n=>String(n).padStart(2,'0');
const shift=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*DAY).toISOString().slice(0,10);
const monthOf=date=>date.slice(0,7);
function monthRange(month){
  const [year,m]=month.split('-').map(Number),days=new Date(Date.UTC(year,m,0)).getUTCDate();
  return {from:`${month}-01`,to:`${month}-${pad(days)}`,days};
}
const nextMonth=month=>{const [y,m]=month.split('-').map(Number);return m===12?`${y+1}-01`:`${y}-${pad(m+1)}`;};
// بداية الأسبوع الأحد، وهو أول يوم عمل في تقويم العمل المعتمد في المنصة.
function weekStart(date){
  const d=new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime()-d.getUTCDay()*DAY).toISOString().slice(0,10);
}

function actor(db,supplied){
  const u=currentUser(db,supplied);
  if(!u)fail(403,'forbidden','الحساب غير متاح');
  if(!can(db,u,'finance.forecast.view'))fail(403,'not_permitted','التنبؤ النقدي لحامل تصريحه. اطلبه من مسؤول الصلاحيات');
  return u;
}
function amountMinor(value,label){
  if(typeof value!=='string'||!/^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بخانتين عشريتين كحد أقصى`);
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace('-','').split('.');
  const minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  return negative?-minor:minor;
}

// ===== مصادر التدفق =====
// كل مصدر يعيد بنودًا {date, amount_minor, certainty, label, case_id}. المبالغ بالهللات، موجبة دائمًا،
// والاتجاه (داخل/خارج) يحدده المصدر نفسه.

function inflowItems(db,tenantId,horizonEnd){
  const items=[],gaps=[];
  // استحقاق معتمد برصيد غير محصّل. المؤكد منه ما صدرت به فاتورة ضريبية؛ وما لم يُفوتر بعد متوقع. الرصيد من منظور التحصيل الواحد
  // (ar_claim_collection، الترحيل 170): الصافي بعد الإشعارات الدائنة ناقص المؤكد غير المرتد والمخصص من القبض على الحساب. كان
  // يطرح كل قبض مؤكد من القيمة الأصلية، فالقبض المرتد يُسقط تدفقًا ما زال منتظرًا، والإشعار الدائن يُدخل تدفقًا لن يأتي.
  const claims=db.prepare(`SELECT c.id,c.case_id,c.due_date,k.name AS case_name,s.net_minor-s.received_minor-s.allocated_minor AS balance,
      (SELECT COUNT(*) FROM tax_invoices t WHERE t.claim_id=c.id AND t.status='issued' AND t.kind='invoice') AS invoiced
    FROM ar_claims c JOIN commercial_cases k ON k.id=c.case_id JOIN ar_claim_collection s ON s.claim_id=c.id
    WHERE c.tenant_id=? AND c.status='approved' ORDER BY c.due_date,c.id`).all(tenantId);
  for(const c of claims){
    const balance=c.balance;
    if(balance<=0)continue;
    // وعد تحصيل مسجّل: يزيح ما وعد به العميل إلى تاريخ وعده ويبقى متوقعًا لا مؤكدًا.
    const promise=db.prepare('SELECT amount_minor,promised_on FROM ar_promises WHERE claim_id=? ORDER BY created_at DESC,id LIMIT 1').get(c.id);
    const promised=promise?Math.min(balance,Number(promise.amount_minor)):0;
    if(promised>0)items.push({stream:'collection_promises',certainty:'expected',date:promise.promised_on,amount_minor:promised,case_id:c.case_id,label:`وعد تحصيل — ${c.case_name}`});
    const remainder=balance-promised;
    if(remainder>0)items.push({stream:c.invoiced?'invoiced_receivables':'approved_claims_uninvoiced',certainty:c.invoiced?'confirmed':'expected',
      date:c.due_date,amount_minor:remainder,case_id:c.case_id,label:`${c.invoiced?'فاتورة صادرة غير محصّلة':'استحقاق معتمد لم يُفوتر بعد'} — ${c.case_name}`});
  }
  const pending=db.prepare("SELECT COUNT(*) AS n FROM ar_claims WHERE tenant_id=? AND status IN ('draft','pending')").get(tenantId).n;
  if(pending)gaps.push(`${pending} استحقاق لم يُعتمد بعد لا يدخل التنبؤ؛ يدخل فور اعتماده.`);
  // الاشتراكات المتعاقد عليها من جدولات الفوترة الدورية: التزام تعاقدي قائم لم تصدر فاتورته بعد، فهو متوقع لا مؤكد.
  // الفترة التي وُلّدت لها مسودة تُحسب من المسودة لا من الجدولة، والمسودة التي صدرت فاتورتها تُحسب كذمة صادرة. فلا ازدواج.
  for(const s of db.prepare("SELECT * FROM billing_schedules WHERE tenant_id=? AND status='active' ORDER BY created_at").all(tenantId))
    for(const period of duePeriods(s,horizonEnd)){
      if(db.prepare('SELECT 1 FROM billing_schedule_runs WHERE schedule_id=? AND period_start=?').get(s.id,period.start))continue;
      items.push({stream:'contracted_subscriptions',certainty:'expected',date:period.issue,amount_minor:s.total_minor,case_id:s.case_id,label:`اشتراك متعاقد عليه — ${s.title}`});
    }
  for(const d of db.prepare(`SELECT d.total_minor,d.period_start,s.issue_day,s.title,s.case_id FROM billing_drafts d JOIN billing_schedules s ON s.id=d.schedule_id
      WHERE d.tenant_id=? AND d.status='pending_review' ORDER BY d.period_start`).all(tenantId))
    items.push({stream:'subscription_drafts',certainty:'expected',date:`${d.period_start.slice(0,8)}${pad(d.issue_day)}`,amount_minor:d.total_minor,case_id:d.case_id,label:`مسودة فاتورة دورية بانتظار إصدار إنسان — ${d.title}`});
  const paused=db.prepare("SELECT COUNT(*) AS n FROM billing_schedules WHERE tenant_id=? AND status='paused'").get(tenantId).n;
  if(paused)gaps.push(`${paused} جدولة فوترة دورية موقوفة لا تدخل التنبؤ حتى تُستأنف.`);
  const advances=db.prepare("SELECT COUNT(*) AS n FROM advance_invoices WHERE tenant_id=? AND status='recorded'").get(tenantId).n;
  if(advances)gaps.push(`${advances} دفعة مقدمة مسجلة لم يُؤكد قبضها لا تدخل التنبؤ: الفوترة الدورية لا تحفظ لها تاريخ استحقاق، ووضعها في أسبوع بعينه تخمين.`);
  return {items,gaps};
}

function outflowItems(db,tenantId){
  const items=[],gaps=[],assumptions=[];
  // أمر دفع معتمد لم يُنفذ في البنك: مبلغ معتمد وذمة قائمة. لا يحمل تاريخ استحقاق، فيُنسب إلى تاريخ اعتماده.
  for(const o of db.prepare("SELECT id,amount_minor,approved_at FROM payment_orders WHERE tenant_id=? AND status='approved' ORDER BY approved_at").all(tenantId))
    items.push({stream:'approved_payment_orders',certainty:'confirmed',date:riyadhDateOf(o.approved_at),amount_minor:o.amount_minor,case_id:null,label:'أمر دفع معتمد لم يُنفذ'});
  if(db.prepare("SELECT 1 FROM payment_orders WHERE tenant_id=? AND status='approved'").get(tenantId))
    assumptions.push('أوامر الدفع المعتمدة لا تحمل تاريخ سداد في المنصة، فتُنسب إلى تاريخ اعتمادها ويظهر ما مضى منها في الأسبوع الأول.');
  // ما لا أمر معتمد عليه من كل مستحق مطابق: الباقي من الرؤية payable_balances (الترحيل 166) ناقص ما عليه أمر معتمد (يظهر فوق
  // بمبلغه). الأمر المعلّق ما اعتمده أحد، فيبقى مبلغه هنا متوقعًا. كان المستحق يسقط كله متى لمسه أمرٌ واحد على payment_orders.payable_id،
  // فالدفعة الجزئية والأمر المجمّع (يُنسب لأول مستحق) والتحويل الراجع كلها تُخفي خروجًا ما زال قادمًا.
  for(const p of db.prepare(`SELECT b.payable_id,b.outstanding_minor-b.approved_minor AS open_minor,y.created_at FROM payable_balances b JOIN procurement_payables y ON y.id=b.payable_id
      WHERE b.tenant_id=? AND b.outstanding_minor-b.approved_minor>0 ORDER BY y.created_at,y.id`).all(tenantId))
    items.push({stream:'matched_payables_unordered',certainty:'expected',date:riyadhDateOf(p.created_at),amount_minor:p.open_minor,case_id:null,label:'مستحق مورد مطابق ما عليه أمر دفع معتمد'});
  // أمر شراء ملتزم به: ما لم يصر منه مستحقًا مطابقًا بعد، والتوقيت مستنتج من تاريخ التسليم. المستحق المطابق يُنزل الالتزام بمبلغه
  // (ويظهر فوق بباقيه)، ويبقى الباقي — كان الأمر يسقط كله مع أول فاتورة ولو جزئية أو غير مطابقة، فيختفي ما لم يُفوتر بعد.
  for(const o of db.prepare(`SELECT o.purchase_id,o.total_minor-(SELECT COALESCE(SUM(y.amount_minor),0) FROM procurement_payables y WHERE y.purchase_id=o.purchase_id) AS open_minor,o.delivery_date,o.supplier_name FROM procurement_orders o
      JOIN procurement_purchases s ON s.id=o.purchase_id WHERE s.tenant_id=? AND s.status NOT IN ('cancelled','rejected') ORDER BY o.delivery_date`).all(tenantId).filter(o=>o.open_minor>0))
    items.push({stream:'committed_purchase_orders',certainty:'expected',date:o.delivery_date,amount_minor:o.open_minor,case_id:null,label:`أمر شراء ملتزم به ما صار مستحقًا مطابقًا — ${o.supplier_name}`});
  // مطالبة مصروف اعتمدتها المالية ولم تُعوَّض بعد.
  for(const c of db.prepare("SELECT id,amount_minor,finance_decided_at FROM expense_claims WHERE tenant_id=? AND status='finance_approved' ORDER BY finance_decided_at").all(tenantId))
    items.push({stream:'approved_expense_claims',certainty:'confirmed',date:riyadhDateOf(c.finance_decided_at),amount_minor:c.amount_minor,case_id:null,label:'مطالبة مصروف معتمدة لم تُعوَّض'});
  // سجل العقود يحفظ قيمة العقد كاملة بلا دورية سداد؛ توزيعها على الأشهر اختراع لا اشتقاق، فلا تدخل التنبؤ.
  const vendorContracts=db.prepare("SELECT COUNT(*) AS n FROM contract_records WHERE tenant_id=? AND status='active' AND party_kind IN ('vendor','freelancer') AND value_minor IS NOT NULL").get(tenantId).n;
  gaps.push('المصروفات المتكررة (إيجار، اشتراكات برمجية، مرافق) غير مشمولة: لا سجل التزامات متكررة بدورية سداد في المنصة.'+
    (vendorContracts?` سجل العقود فيه ${vendorContracts} عقد مورد ساري بقيمة إجمالية بلا دورية سداد، وتوزيعها على الأسابيع تخمين لا اشتقاق.`:'')+
    ' ما لم يُسجَّل كأمر شراء أو مستحق لا يظهر هنا.');
  return {items,gaps,assumptions};
}

// الرواتب: من العقود السارية عبر منطق المسير نفسه، مجموعة بالشهر فقط. لا يظهر راتب فرد ولا اسمه.
// حد أدنى لعدد الموظفين وراء أي رقم رواتب يظهر لغير أهل الرواتب. ليس قاعدة نظامية ولا مصدره جهة:
// هو حماية للخصوصية، لأن مجموع شهر فيه موظف واحد هو راتبه، وفرق شهرين زاد فيهما موظف واحد هو راتب الجديد.
export const PAYROLL_PRIVACY_MIN=5;
export const PAYROLL_WITHHELD_LABEL='محجوب لحماية الخصوصية';
function payrollItems(db,tenantId,asOf,horizonEnd){
  const items=[],gaps=[],assumptions=[],months=[],entries=[];
  for(let m=monthOf(asOf);m<=monthOf(horizonEnd);m=nextMonth(m))months.push(m);
  const paid=new Set(db.prepare("SELECT r.month FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id WHERE p.tenant_id=? AND p.status='executed'").all(tenantId).map(r=>r.month));
  for(const month of months){
    if(paid.has(month))continue;
    const range=monthRange(month),policy=acceptedPolicy(db,tenantId,'payroll_cycle',range.to);
    if(!policy){gaps.push(`رواتب ${month} غير محتسبة: لا توجد سياسة دورة رواتب معتمدة سارية في هذا الشهر.`);continue;}
    const params=JSON.parse(policy.parameters),payDate=`${month}-${pad(params.pay_day)}`;
    const run=db.prepare("SELECT id,headcount,net_minor FROM payroll_runs WHERE tenant_id=? AND month=? AND status='approved'").get(tenantId,month);
    if(run){
      if(run.net_minor>0)entries.push({month,headcount:run.headcount,people:db.prepare('SELECT user_id FROM payroll_lines WHERE run_id=?').all(run.id).map(r=>r.user_id),
        item:{stream:'payroll_approved_unpaid',certainty:'confirmed',date:payDate,amount_minor:run.net_minor,case_id:null,label:`مسير ${month} معتمد لم يُدفع (${run.headcount} موظف)`}});
      continue;
    }
    let total=0;const people=[];
    for(const [userId,line] of baseLines(db,tenantId,range,params)){total+=line.net_minor;people.push(userId);}
    if(!people.length){gaps.push(`رواتب ${month} صفر: لا عقد ساري يتقاطع مع الشهر.`);continue;}
    entries.push({month,headcount:people.length,people,
      item:{stream:'payroll_contracts',certainty:'confirmed',date:payDate,amount_minor:total,case_id:null,label:`رواتب ${month} من العقود السارية (${people.length} موظف، إجمالي فقط)`}});
  }
  // شهر يُحجب إن قل عدده عن الحد، أو تغيّر عدده عن الشهر الذي قبله بأقل من الحد (زيادة أو نقصًا):
  // الفرق بين شهرين يكشف راتب من دخل أو خرج. ويُحجب الشهر السابق معه، لأن الفرق يُحسب من طرفيه.
  const withheld=new Set();
  entries.forEach((entry,index)=>{
    if(entry.headcount<PAYROLL_PRIVACY_MIN)withheld.add(index);
    const previous=entries[index-1];
    if(previous&&previous.month===monthOf(shift(`${entry.month}-01`,-1))){
      const change=Math.abs(entry.headcount-previous.headcount);
      if(change>0&&change<PAYROLL_PRIVACY_MIN){withheld.add(index);withheld.add(index-1);}
    }
  });
  if(!withheld.size)items.push(...entries.map(e=>e.item));
  else{
    // المحجوب لا يظهر شهرًا شهرًا: رواتب الأفق كلها تُدمج في بند واحد بلا عدد موظفين، لأن إظهار الأشهر الأخرى
    // بجانب مجموع مدمج يسمح بطرحها منه. يُقيَّد في تاريخ أول صرف داخل الأفق، فلا يُظهر الرصيد أعلى مما هو.
    const total=entries.reduce((n,e)=>n+e.item.amount_minor,0),distinct=new Set(entries.flatMap(e=>e.people)).size;
    const first=entries.map(e=>e.item.date).sort()[0],confirmedOnly=entries.every(e=>e.item.certainty==='confirmed');
    if(distinct>=PAYROLL_PRIVACY_MIN){
      items.push({stream:'payroll_aggregated',certainty:confirmedOnly?'confirmed':'expected',date:first,amount_minor:total,case_id:null,withheld:true,
        label:`رواتب الأفق كله (${entries.map(e=>e.month).join('، ')}) في بند واحد — التفصيل الشهري ${PAYROLL_WITHHELD_LABEL}`});
      gaps.push(`تفصيل الرواتب الشهري وعدد الموظفين ${PAYROLL_WITHHELD_LABEL}: عدد الموظفين في شهر أقل من ${PAYROLL_PRIVACY_MIN} أو تغيّر بين شهرين بأقل من ${PAYROLL_PRIVACY_MIN}. رواتب الأفق مدمجة في بند واحد مقيد في تاريخ أول صرف (${first})، فالرصيد قبل بقية مواعيد الصرف أقل من حقيقته عمدًا.`);
    }else{
      // أقل من الحد في الأفق كله: حتى المجموع المدمج يكشف متوسط راتب فرد، فلا يدخل الرقم التنبؤ أصلًا.
      items.push({stream:'payroll_aggregated',certainty:'confirmed',date:first,amount_minor:null,case_id:null,withheld:true,
        label:`رواتب الأفق — ${PAYROLL_WITHHELD_LABEL}. لم تدخل الأرصدة، فلا تجيب المنصة هنا هل يغطيها الرصيد`});
      gaps.push(`الرواتب ${PAYROLL_WITHHELD_LABEL} ولم تدخل الأرصدة: من تشملهم رواتب الأفق أقل من ${PAYROLL_PRIVACY_MIN} موظفين، وأي رقم لها يكشف راتب فرد. الرصيد المعروض أعلى من حقيقته بمقدار الرواتب؛ من يحمل تصريح الرواتب يراها في شاشة المسير.`);
    }
  }
  if(entries.length)assumptions.push('موعد صرف الرواتب مأخوذ من «يوم الصرف» في سياسة دورة الرواتب المعتمدة، على الشهر نفسه. السياسة لا تحدد شهر الصرف، والوحدة لا تفترض غير ذلك.');
  gaps.push('حصة المنشأة في التأمينات الاجتماعية وأي مستحقات نهاية خدمة غير مشمولة: المنصة تحسب استقطاع الموظف فقط، ولا تعرف حصة المنشأة.');
  return {items,gaps,assumptions};
}

// ===== بناء الأسابيع =====
function buildWeeks(items,openingMinor,startWeek){
  const weeks=Array.from({length:WEEKS},(_,index)=>{
    const from=shift(startWeek,index*7);
    return {index:index+1,from,to:shift(from,6),confirmed_in_minor:0,expected_in_minor:0,confirmed_out_minor:0,expected_out_minor:0,overdue_items:0,items:[]};
  });
  const horizonEnd=weeks.at(-1).to,beyond={in_minor:0,out_minor:0,items:0};
  for(const item of items){
    if(item.date>horizonEnd){beyond[item.direction==='in'?'in_minor':'out_minor']+=item.amount_minor??0;beyond.items++;continue;}
    const offset=Math.floor((Date.parse(`${item.date}T00:00:00Z`)-Date.parse(`${startWeek}T00:00:00Z`))/(7*DAY));
    const week=weeks[Math.max(0,Math.min(WEEKS-1,offset))],overdue=offset<0;
    week[`${item.certainty}_${item.direction==='in'?'in':'out'}_minor`]+=item.amount_minor??0;
    if(overdue)week.overdue_items++;
    week.items.push({...item,overdue});
  }
  let confirmed=openingMinor,both=openingMinor;
  for(const week of weeks){
    confirmed+=week.confirmed_in_minor-week.confirmed_out_minor;
    both+=week.confirmed_in_minor+week.expected_in_minor-week.confirmed_out_minor-week.expected_out_minor;
    week.closing_confirmed_minor=confirmed;
    week.closing_with_expected_minor=both;
    week.negative_on_confirmed=confirmed<0;
    week.negative_with_expected=both<0;
  }
  return {weeks,beyond};
}
function summarize(weeks){
  const firstNegative=key=>weeks.find(w=>w[key])?.index??null;
  return {min_confirmed_minor:Math.min(...weeks.map(w=>w.closing_confirmed_minor)),min_with_expected_minor:Math.min(...weeks.map(w=>w.closing_with_expected_minor)),
    first_negative_week_confirmed:firstNegative('negative_on_confirmed'),first_negative_week_with_expected:firstNegative('negative_with_expected')};
}
// أسئلة المالك المباشرة: هل يغطي كل حدث رواتب رصيدُ الأسبوع الذي يقع فيه؟
function payrollCoverage(weeks){
  return weeks.flatMap(w=>w.items.filter(i=>i.stream.startsWith('payroll_')).map(i=>({
    week:w.index,date:i.date,amount_minor:i.amount_minor,label:i.label,withheld:!!i.withheld,
    // رقم لم يدخل الأرصدة لا يُقال عنه إن الرصيد يغطيه.
    covered_by_confirmed:i.amount_minor!==null&&w.closing_confirmed_minor>=0,covered_with_expected:i.amount_minor!==null&&w.closing_with_expected_minor>=0})));
}

// ===== السيناريوهات =====
// إدخال يدوي بمعاملاته، يُحسب فورًا ولا يُخزَّن. لا يغيّر مستندًا ولا يُسجَّل كحقيقة.
export const SCENARIO_KINDS={
  client_delay:{name:'تأخر عميل كبير',fields:['case_id','delay_days']},
  client_lost:{name:'خسارة عميل',fields:['case_id']},
  new_hire:{name:'تعيين جديد',fields:['monthly_amount','starts_on']},
  collection_delay:{name:'تأجيل تحصيل',fields:['delay_days']}
};
function scenarioInput(db,tenantId,raw){
  v.object(raw,['kind','case_id','delay_days','monthly_amount','starts_on','label']);
  const kind=SCENARIO_KINDS[raw.kind];
  if(!kind)fail(400,'scenario_kind','نوع السيناريو غير متاح');
  const clean={kind:raw.kind,name:kind.name,label:raw.label?v.text(raw.label,'اسم السيناريو',200,3):kind.name};
  if(kind.fields.includes('case_id')){
    const found=typeof raw.case_id==='string'&&db.prepare('SELECT id,name FROM commercial_cases WHERE id=? AND tenant_id=?').get(raw.case_id,tenantId);
    if(!found)fail(404,'case_not_found','العميل غير متاح');
    clean.case_id=found.id;clean.case_name=found.name;
  }
  if(kind.fields.includes('delay_days')){
    if(!Number.isInteger(raw.delay_days)||raw.delay_days<1||raw.delay_days>180)fail(400,'delay_days','التأخير من يوم إلى 180 يومًا');
    clean.delay_days=raw.delay_days;
  }
  if(kind.fields.includes('monthly_amount')){
    clean.monthly_minor=amountMinor(raw.monthly_amount,'التكلفة الشهرية');
    if(clean.monthly_minor<=0)fail(400,'invalid_money','التكلفة الشهرية أكبر من صفر');
    clean.starts_on=v.date(raw.starts_on);
  }
  return clean;
}
function applyScenario(items,scenario,horizonEnd){
  if(scenario.kind==='client_delay')
    return items.map(i=>i.direction==='in'&&i.case_id===scenario.case_id?{...i,date:shift(i.date,scenario.delay_days)}:i);
  if(scenario.kind==='collection_delay')
    return items.map(i=>i.direction==='in'?{...i,date:shift(i.date,scenario.delay_days)}:i);
  if(scenario.kind==='client_lost')
    // الفاتورة الصادرة تبقى ذمة قائمة على العميل حتى لو خسرناه؛ الذي يسقط هو المتوقع.
    return items.filter(i=>!(i.direction==='in'&&i.case_id===scenario.case_id&&i.certainty==='expected'));
  const added=[];
  for(let month=monthOf(scenario.starts_on);month<=monthOf(horizonEnd);month=nextMonth(month)){
    const date=month===monthOf(scenario.starts_on)?scenario.starts_on:`${month}-${scenario.starts_on.slice(8)}`;
    if(date>horizonEnd)break;
    added.push({stream:'scenario_new_hire',certainty:'expected',direction:'out',date,amount_minor:scenario.monthly_minor,case_id:null,label:`${scenario.label} — تكلفة شهرية مدخلة يدويًا`});
  }
  return [...items,...added];
}

// ===== سياق تاريخي محسوب، لا مفترض =====
// لا نسبة تحصيل ولا احتمال في هذا الملف إلا ما حُسب من سجلات المنصة، ومعه حجم عينته وتحذيره.
function collectionHistory(db,tenantId){
  const rows=db.prepare(`SELECT r.received_on,c.due_date FROM ar_receipts r JOIN ar_claims c ON c.id=r.claim_id
    WHERE r.tenant_id=? AND r.status='confirmed' ORDER BY r.received_on`).all(tenantId);
  if(!rows.length)return {sample_size:0,available:false,note:'لا مقبوضات مؤكدة في المنصة بعد، فلا سلوك تحصيل يُحسب منه شيء. لا تُفترض نسبة.'};
  const lags=rows.map(r=>Math.round((Date.parse(r.received_on)-Date.parse(r.due_date))/DAY)).sort((a,b)=>a-b);
  const median=lags.length%2?lags[(lags.length-1)/2]:Math.round((lags[lags.length/2-1]+lags[lags.length/2])/2);
  return {sample_size:lags.length,available:true,median_lag_days:median,min_lag_days:lags[0],max_lag_days:lags.at(-1),
    reliable:lags.length>=SMALL_SAMPLE,
    note:lags.length>=SMALL_SAMPLE
      ?`محسوب من ${lags.length} مقبوضًا مؤكدًا في المنصة. سياق للقراءة فقط: التنبؤ لا يطبّق هذا المتوسط على أي بند.`
      :`عينة صغيرة (${lags.length} مقبوضًا فقط) لا يُبنى عليها قرار. سياق للقراءة فقط: التنبؤ لا يطبّق هذا المتوسط على أي بند.`};
}

// ===== الرصيد الافتتاحي من التسوية البنكية المعتمدة =====
// لكل حساب بنكي نشط له تسوية معتمدة: رصيد حسابه في الدفتر اليوم (القيود المرحّلة)، والتسوية تشهد أن الدفتر طابق البنك لين تاريخها.
// ومعها مستندات النقد النهائية التي لم يُرحَّل قيدها بعد (منفّذ، مؤكد، معتمد) — مالٌ تحرّك ولم يصل الدفتر، فلا هو في الرصيد ولا في
// بنود التنبؤ. الحساب النشط بلا تسوية معتمدة لا يدخل رصيده ويُسمّى. وما لا تسوية معتمدة أصلًا يبقى الرقم فيه إدخالًا يدويًا مسمّى كذلك.
function reconciledOpening(db,tenantId,asOf){
  const reconciled=[],unreconciled=[];
  for(const a of db.prepare('SELECT id,label,gl_account_id FROM bank_accounts WHERE tenant_id=? AND active=1 ORDER BY label').all(tenantId)){
    const last=db.prepare("SELECT period_end,difference_minor FROM bank_reconciliations WHERE tenant_id=? AND bank_account_id=? AND status='approved' ORDER BY period_end DESC LIMIT 1").get(tenantId,a.id);
    if(!last){unreconciled.push({bank_account_id:a.id,label:a.label});continue;}
    const balance=db.prepare("SELECT COALESCE(SUM(l.debit_minor-l.credit_minor),0) AS n FROM finance_lines l JOIN finance_journals j ON j.id=l.journal_id WHERE j.tenant_id=? AND j.status='posted' AND l.account_id=? AND j.entry_date<=?").get(tenantId,a.gl_account_id,asOf).n;
    reconciled.push({bank_account_id:a.id,label:a.label,reconciled_to:last.period_end,reconciliation_difference_minor:last.difference_minor,ledger_balance_minor:balance});
  }
  if(!reconciled.length)return null;
  const posted=new Set(db.prepare("SELECT l.source_kind||':'||l.source_id AS k FROM finance_source_links l JOIN finance_journals j ON j.id=l.journal_id WHERE l.tenant_id=? AND j.status='posted'").all(tenantId).map(r=>r.k));
  const unposted=cashRecords(db,tenantId,'0000-01-01',asOf).filter(r=>!posted.has(`${r.source_kind}:${r.source_id}`));
  const unpostedMinor=unposted.reduce((n,r)=>n+(r.direction==='in'?r.amount_minor:-r.amount_minor),0);
  return {source:'bank_reconciliation',amount_minor:reconciled.reduce((n,a)=>n+a.ledger_balance_minor,0)+unpostedMinor,accounts:reconciled,unreconciled,
    unposted_cash_minor:unpostedMinor,unposted_count:unposted.length,
    label:`رصيد الدفتر اليوم على ${reconciled.length===1?'حساب بنكي مطابق':`${reconciled.length} حسابات بنكية مطابقة`} لين ${reconciled.map(a=>a.reconciled_to).sort()[0]}${unposted.length?`، ومعه ${unposted.length} مستند نقد نهائي ما ترحّل قيده`:''}`};
}

export function cashForecastBoard(db,supplied,input={}){
  const u=actor(db,supplied);
  v.object(input,['opening_balance','opening_source','opening_note','scenarios']);
  const asOf=today(),startWeek=weekStart(asOf),horizonEnd=shift(startWeek,WEEKS*7-1);
  const typed=input.opening_balance===undefined||input.opening_balance===''?null:amountMinor(input.opening_balance,'الرصيد الافتتاحي');
  // مصدر الرقم المكتوب: إدخال المحاسب وحده. «آخر تسوية بنكية معتمدة» تقرؤها المنصة بنفسها، فلا تُكتب رقمًا يُنسب إليها.
  const openingSource=input.opening_source?v.text(input.opening_source,'مصدر الرصيد الافتتاحي',60,3):null;
  if(openingSource&&openingSource!=='accountant')fail(400,'opening_source',openingSource==='bank_reconciliation'
    ?'الرصيد من التسوية البنكية المعتمدة تقرؤه المنصة بنفسها ولا يُكتب يدويًا؛ اكتب الرقم مصدره «إدخال المحاسب»، أو اعتمد تسوية الحساب البنكي'
    :'مصدر الرصيد المكتوب: إدخال المحاسب وحده');
  const reconciled=reconciledOpening(db,u.tenant_id,asOf);
  if(reconciled&&typed!==null)refuse(409,'opening_from_reconciliation',{what:'الرصيد الافتتاحي مأخوذ من التسوية البنكية المعتمدة، فما يُكتب رقم يحل محله',
    missing:[{document:'تسوية بنكية معتمدة أحدث',why:'رقمٌ مكتوب يغطّي رصيدًا طابقه الدفتر والكشف وشهد عليه معتمد',owner:'المالية — من يحمل تصريح المطابقة البنكية وتسويتها',owner_role:'finance'}],
    next:'إذا الرصيد تغيّر، استورد الكشف وطابقه وأعدّ تسويته ويعتمدها غيرك في «المطابقة البنكية»'});
  const opening=reconciled?reconciled.amount_minor:typed;
  const openingView=reconciled??(typed===null?{source:null,amount_minor:null,accounts:[],unreconciled:[],label:'ما فيه تسوية بنكية معتمدة ولا رقم مدخل'}
    :{source:'manual',amount_minor:typed,accounts:[],unreconciled:[],label:'إدخال يدوي من المحاسب — ما فيه تسوية بنكية معتمدة'});
  const inflow=inflowItems(db,u.tenant_id,horizonEnd),outflow=outflowItems(db,u.tenant_id),payroll=payrollItems(db,u.tenant_id,asOf,horizonEnd);
  const items=[...inflow.items.map(i=>({...i,direction:'in'})),...outflow.items.map(i=>({...i,direction:'out'})),...payroll.items.map(i=>({...i,direction:'out'}))];
  const scenarios=(Array.isArray(input.scenarios)?input.scenarios:[]).slice(0,8).map(s=>scenarioInput(db,u.tenant_id,s));
  const baseline=buildWeeks(items,opening??0,startWeek);
  const baseSummary=summarize(baseline.weeks);
  const projections=scenarios.map(scenario=>{
    const projected=buildWeeks(applyScenario(items,scenario,horizonEnd),opening??0,startWeek);
    const summary=summarize(projected.weeks);
    return {...scenario,weeks:projected.weeks.map(w=>({index:w.index,from:w.from,to:w.to,closing_confirmed_minor:w.closing_confirmed_minor,closing_with_expected_minor:w.closing_with_expected_minor})),
      ...summary,delta_min_confirmed_minor:summary.min_confirmed_minor-baseSummary.min_confirmed_minor,
      delta_min_with_expected_minor:summary.min_with_expected_minor-baseSummary.min_with_expected_minor,stored:false};
  });
  const combined=scenarios.length>1?(()=>{
    const projected=buildWeeks(scenarios.reduce((rows,s)=>applyScenario(rows,s,horizonEnd),items),opening??0,startWeek);
    return {label:'كل السيناريوهات معًا',...summarize(projected.weeks),stored:false};
  })():null;
  const streamTotals=Object.entries(items.reduce((map,i)=>{(map[i.stream]??={stream:i.stream,direction:i.direction,certainty:i.certainty,count:0,amount_minor:0});map[i.stream].count++;if(i.amount_minor===null)map[i.stream].amount_minor=null;else if(map[i.stream].amount_minor!==null)map[i.stream].amount_minor+=i.amount_minor;return map;},{})).map(([,value])=>value);
  return {currency:'SAR',generated_at:now(),as_of:asOf,user_id:u.id,horizon_weeks:WEEKS,week_starts_on:startWeek,horizon_ends_on:horizonEnd,
    certainty_names:CERTAINTY,scenario_kinds:SCENARIO_KINDS,
    opening_balance_minor:opening,opening_source:reconciled?'bank_reconciliation':typed===null?null:'accountant',opening:openingView,
    opening_note:!reconciled&&input.opening_note?v.text(input.opening_note,'سند الرصيد الافتتاحي',1000,3):'',
    opening_required:opening===null,
    weeks:baseline.weeks,beyond_horizon:baseline.beyond,...baseSummary,payroll_coverage:payrollCoverage(baseline.weeks),
    streams:streamTotals,scenarios:projections,combined_scenarios:combined,
    clients:db.prepare('SELECT id,name FROM commercial_cases WHERE tenant_id=? ORDER BY name').all(u.tenant_id),
    collection_history:collectionHistory(db,u.tenant_id),
    assumptions:[...outflow.assumptions,...payroll.assumptions],
    gaps:[...(reconciled?.unreconciled.length?[`حسابات بنكية نشطة بلا تسوية معتمدة ما دخل رصيدها الرصيد الافتتاحي: ${reconciled.unreconciled.map(a=>a.label).join('، ')}. تدخل حين تُعتمد تسويتها.`]:[]),
      ...inflow.gaps,...outflow.gaps,...payroll.gaps],
    note:'تنبؤ داخلي محسوب من مستندات المنصة وقت العرض، غير مخزّن وغير مرتبط بأي بنك. المؤكد والمتوقع منفصلان ولا يُجمعان. '+
      'الرصيد الافتتاحي من رصيد الدفتر على الحسابات البنكية اللي لها تسوية معتمدة في «المطابقة البنكية»، ومعه مستندات النقد النهائية اللي ما ترحّل قيدها؛ وإذا ما فيه تسوية معتمدة يبقى إدخالًا يدويًا من المحاسب ومسمّى كذلك. '+
      'السيناريوهات إدخال يدوي يُحسب فورًا ولا يُحفظ ولا يغيّر أي مستند. لا تُستخدم هنا أي نسبة تحصيل مفترضة.'};
}
