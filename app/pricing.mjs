import { audit, hash, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { can } from './access.mjs';
import { currentUser } from './delegations.mjs';
import { clientFor, memberClients } from './agency.mjs';
import { id, today, nameOf, writing, decimal } from './pipeline-shared.mjs';
import { registerEntity, projector, prepare, forTransition, withholder, columnsFor } from './custom-fields.mjs';
import { statusLabel } from './definitions.mjs';
// الملف المقفل لا تنفتح له ورقة تسعير ولا عرض سعر (P4-CRM-7، الترحيل 186).
import { assertClientOpen } from './client-offboarding.mjs';

// تسعير المشروع (MOD-BD-02)، واستثناء التسعير (MOD-BD-03)، وعرض سعر العميل (FRM-024).
// المرجع: docs/product/workflow/SOURCE-APPENDIX.md §3 وتعارضا §4 رقم 1 و9 واختبار القبول §5 رقم 4.
//
// الورقة تنفّذ النموذج حرفيًا:
//   بنود التكلفة في خمس مجموعات، لكل بند وصف وكمية أو ساعات وسعر وحدة وإجمالي وملاحظات
//   → إجمالي التكاليف المباشرة → احتياطي طوارئ إلزامي → إجمالي التكاليف الكلية
//   → سعر البيع = التكاليف ÷ (1 − هامش الربح المستهدف) → هامش الربح الفعلي بالريال وبالنسبة.
// وتنبيه المصدر مفروض هنا: هامش فعلي أقل من المستهدف يوجب MOD-BD-03 من الرئيس التنفيذي قبل إرسال العرض.
//
// ثلاث قواعد لا تُكسر:
//   (1) لا رقم سياسة في الكود: كل نسبة وعتبة ومهلة صف معتمد بسنده من النموذج، ويُلتقط على الورقة وقت الحفظ.
//   (2) الهامش ليس هامش الربح على التكلفة (mark-up): الأول مقسوم على سعر البيع والثاني على التكلفة، ويُعرضان معًا.
//   (3) لا طباعة ولا توقيع مصوَّر: تواقيع النموذج الأربعة مقاعد اعتماد إلكترونية، كلٌّ حدث هوية في سلسلة التدقيق.

// بنود التكلفة الخمسة بأسمائها في النموذج.
export const COST_GROUPS=[
  ['internal_team','رواتب الفريق الداخلي'],
  ['external_production','تكاليف إنتاج خارجي'],
  ['paid_media','ميزانية إعلانات ممولة'],
  ['operations','تكاليف تشغيلية'],
  ['subscriptions_software','اشتراكات وبرامج خاصة بالمشروع']
].map(([key,name])=>({key,name}));
export const BASES={quantity:'كمية × سعر الوحدة',hours:'ساعات × سعر الوحدة'};
export const CONTRACT_KINDS={one_off:'مشروع منفصل',monthly_retainer:'عقد شهري مستمر'};
export const REFERENCE_KINDS={media_entry:'سطر صرف إعلامي مسجَّل',supplier_invoice:'فاتورة مورد'};
export const SHEET_STATUS={draft:'مسودة',submitted:'بانتظار الاعتمادات الأربعة',approved:'معتمدة',rejected:'مرفوضة'};
export const POLICY_STATUS={draft:'بانتظار الاعتماد',approved:'معتمدة',rejected:'مرفوضة',retired:'حلّت محلها نسخة أحدث'};
export const EXCEPTION_STATUS={pending:'بانتظار قرار الرئيس التنفيذي',approved:'معتمد',rejected:'مرفوض'};
export const QUOTATION_STATUS={draft:'مسودة لم تُصدر',issued:'صدر للعميل',accepted:'مقبول',rejected:'مرفوض'};
export const DECISIONS={approved:'معتمد',rejected:'مرفوض',returned:'يحتاج تعديل'};

// كل قيمة في النموذج بلا رقم في الكود. المهلتان مفتاحان منفصلان بوحدتين مختلفتين (التعارض 9): لا تُجمعان ولا يُحوَّل بينهما.
export const POLICY_DEFS=[
  {key:'contingency_rate',unit:'percent',required:true,name:'احتياطي الطوارئ الإلزامي على إجمالي التكاليف المباشرة',source:'MOD-BD-02 — الإجماليات'},
  {key:'target_margin',unit:'percent',required:true,name:'هامش الربح المستهدف الذي يُشتق منه سعر البيع',source:'MOD-BD-02 — التسعير'},
  {key:'minimum_margin',unit:'percent',required:false,name:'الحد الأدنى المقبول للهامش',source:'MOD-BD-02 — التسعير (حقل في النموذج بلا قيمة في المصدر)'},
  {key:'quotation_issue_sla_hours',unit:'hours',required:false,name:'مهلة إصدار عرض سعر العميل بعد اكتمال المتطلبات',source:'المخطط الثاني، البنود 09–16 — ساعة إلى ساعتين'},
  {key:'finance_verification_sla_days',unit:'working_days',required:false,name:'مهلة التحقق المالي في مسار طلب عرض سعر المورد (F-04)',source:'F-03/F-04 — يوم عمل واحد'}
];
const POLICY_BY_KEY=new Map(POLICY_DEFS.map(p=>[p.key,p]));
export const POLICY_KEYS=Object.fromEntries(POLICY_DEFS.map(p=>[p.key,p.name]));
export const UNITS={percent:'%',hours:'ساعة',working_days:'يوم عمل'};
export const TWO_CLOCKS='مهلتان منفصلتان لا عداد واحد: إصدار عرض سعر العميل يُقاس بالساعات من اكتمال متطلباته، '
  +'والتحقق المالي في مسار عرض سعر المورد (F-04) يُقاس بأيام العمل. ساعتان ليستا يوم عمل، ولا يُغني قياس أحدهما عن الآخر.';

// تواقيع النموذج الأربعة، مقاعد اعتماد إلكترونية. القرار ثلاثي كما في النموذج.
export const APPROVAL_SEATS=[
  {key:'requesting_department',name:'الإدارة الطالبة',capability:'pricing.sheets.use'},
  {key:'procurement_finance',name:'المشتريات/المالية',capability:'finance.use'},
  {key:'epmo',name:'فريق EPMO',capability:'pricing.epmo.approve'},
  {key:'vp_corporate_services',name:'نائب الرئيس التنفيذي للخدمات المؤسسية',capability:'pricing.vp.approve'}
];
const SEAT_BY_KEY=new Map(APPROVAL_SEATS.map(s=>[s.key,s]));
export const APPROVAL_IS_ELECTRONIC='كل اعتماد هنا حدث هوية مسجَّل في سلسلة التدقيق: من قرر وبأي تصريح وعلى أي جولة ومتى. '
  +'لا توقيع مصوَّر ولا سطر توقيع ولا نسخة للطباعة: العرض سجل إلكتروني يُقرأ في الشاشة.';

// القراءتان المتعارضتان (التعارض 1) محفوظتان كما وردتا. المنصة لا ترجّح بينهما ولا تختار افتراضًا.
export const ISSUER_OPTIONS=[
  {key:'procurement',name:'المشتريات',capability:'procurement.use',reading:'الفهرس العام للنماذج الـ41 يدرج «عرض سعر العميل» (FRM-024) تحت المشتريات.'},
  {key:'finance',name:'المالية',capability:'finance.use',reading:'تبويب «دورة العميل» والمخطط الثاني (البنود 09–16) ينصّان على أن المالية تُصدر عرض السعر.'}
];
export const ISSUER_DECISION_CODE='quotation_issuer';
export const ISSUER_UNSET='قرار غير محسوم: من يُصدر عرض سعر العميل. الفهرس العام يقول المشتريات، وتبويب «دورة العميل» والمخطط الثاني يقولان المالية. '
  +'المصدران متعارضان (التعارض 1)، ولا ترجّح المنصة بينهما نيابة عن المالك. سجّل القرار «جهة إصدار عرض السعر» في شاشة التسعير واعتمده، ثم يُصدر العرض. '
  +'المشتريات تُعدّ الأسعار في القراءتين؛ المتنازع عليه جهة الإصدار وحدها.';
const DOUBLE_COUNT_UNCHECKED='مصدر التحقق من ازدواج الصرف الإعلامي غير موصول بهذه الشاشة: السطر المرتبط بمرجع خارجي يُقبل دون التأكد من أنه لم يصل فاتورةَ مورد أيضًا.';

/* ───── الحساب النقي ───── */
const LIMIT=999999999999n;
// نصف لأعلى بعيدًا عن الصفر، على أعداد صحيحة فقط. لا أعداد عشرية عائمة في أي خطوة.
const halfUp=(num,den)=>num<0n?-((2n*(-num)+den)/(2n*den)):(2n*num+den)/(2n*den);
function bounded(value,label){
  if(value<-LIMIT||value>LIMIT)fail(400,'money_limit',`${label}: تجاوز الحد المحلي للمبلغ`);
  return value;
}
const rateOf=(value,label)=>{
  if(!Number.isInteger(value)||value<0||value>10000)fail(400,'invalid_rate',`${label}: نسبة بنقاط الأساس من صفر إلى 10000`);
  return BigInt(value);
};

// تحسب ورقة التسعير كاملة من سطورها ونسب السياسة الملتقطة عليها. دالة نقية: لا قاعدة بيانات ولا وقت ولا حالة.
export function computePricing(lines,policy){
  v.object(policy,['contingency_rate_bp','target_margin_bp','minimum_margin_bp','discount_minor','admin_fee_bp','vat_rate_bp']);
  const contingencyBp=rateOf(policy.contingency_rate_bp,'احتياطي الطوارئ'),vatBp=rateOf(policy.vat_rate_bp,'نسبة الضريبة');
  const adminBp=rateOf(policy.admin_fee_bp??0,'نسبة الرسوم الإدارية'),targetBp=rateOf(policy.target_margin_bp,'هامش الربح المستهدف');
  // هامش 100% أو أكثر يعني القسمة على صفر أو على عدد سالب: لا سعر بيع له مهما بلغت التكلفة.
  if(targetBp>=10000n)fail(400,'impossible_margin','هامش مستهدف 100% أو أكثر مستحيل: سعر البيع = التكاليف ÷ (1 − هامش الربح)، والمقام يصير صفرًا أو سالبًا. اختر هامشًا أقل من 100%');
  const minimumBp=policy.minimum_margin_bp===null||policy.minimum_margin_bp===undefined?null:Number(rateOf(policy.minimum_margin_bp,'الحد الأدنى المقبول'));
  if(!Array.isArray(lines)||!lines.length)fail(400,'lines','ورقة التسعير تبدأ ببند تكلفة واحد على الأقل');

  const priced=lines.map((l,index)=>{
    const units=BigInt(l.quantity_centi),unit=BigInt(l.unit_price_minor);
    if(units<1n||unit<1n)fail(400,'lines',`البند ${index+1}: الكمية أو الساعات وسعر الوحدة أكبر من صفر`);
    return {...l,amount_minor:Number(bounded(halfUp(units*unit,100n),`البند ${index+1}`))};
  });
  const direct=bounded(priced.reduce((n,l)=>n+BigInt(l.amount_minor),0n),'إجمالي التكاليف المباشرة');
  // تكلفة صفرية تعني قسمة على صفر في نسبة الهامش لاحقًا، وتعني أن الورقة لا تصف مشروعًا.
  if(direct<=0n)fail(400,'no_cost','إجمالي التكاليف المباشرة صفر: لا سعر يُشتق من تكلفة صفرية، ولا نسبة هامش تُقسم على صفر');
  const contingency=bounded(halfUp(direct*contingencyBp,10000n),'احتياطي الطوارئ');
  const totalCost=bounded(direct+contingency,'إجمالي التكاليف الكلية');
  const sale=bounded(halfUp(totalCost*10000n,10000n-targetBp),'سعر البيع قبل الضريبة');
  const margin=sale-totalCost;

  const discount=BigInt(policy.discount_minor??0);
  if(discount<0n)fail(400,'discount','الخصم مبلغ غير سالب');
  if(discount>=sale)fail(400,'discount','الخصم يبلغ سعر البيع أو يتجاوزه: لا عرض بقيمة صفر أو سالبة');
  const net=bounded(sale-discount,'صافي السعر قبل الضريبة');
  const netMargin=net-totalCost;

  const adminFee=bounded(halfUp(net*adminBp,10000n),'الرسوم الإدارية');
  const taxable=bounded(net+adminFee,'الوعاء الخاضع للضريبة');
  const vat=bounded(halfUp(taxable*vatBp,10000n),'ضريبة القيمة المضافة');
  const grand=bounded(taxable+vat,'الإجمالي شامل الضريبة');

  const actualBp=Number(halfUp(margin*10000n,sale));
  const netBp=Number(halfUp(netMargin*10000n,net));
  // هامش الربح على التكلفة يُحسب ويُعرض باسمه، لأن الخلط بينه وبين الهامش يرفع السعر أو يخفضه بلا قصد.
  const markupBp=Number(halfUp(margin*10000n,totalCost));
  const netMarkupBp=Number(halfUp(netMargin*10000n,totalCost));
  const groups=COST_GROUPS.map(g=>{const rows=priced.filter(l=>l.cost_group===g.key);
    return {key:g.key,name:g.name,line_count:rows.length,amount_minor:rows.reduce((n,l)=>n+l.amount_minor,0)};});

  const n=value=>decimal(Number(value));
  const pct=bp=>`${(Number(bp)/100).toFixed(2)}%`;
  const belowTarget=netBp<Number(targetBp);
  return {
    lines:priced,groups,
    direct_total_minor:Number(direct),
    contingency_rate_bp:Number(contingencyBp),contingency_minor:Number(contingency),
    total_cost_minor:Number(totalCost),
    target_margin_bp:Number(targetBp),minimum_margin_bp:minimumBp,
    sale_price_pre_tax_minor:Number(sale),
    margin_minor:Number(margin),actual_margin_bp:actualBp,markup_bp:markupBp,
    discount_minor:Number(discount),net_pre_tax_minor:Number(net),
    net_margin_minor:Number(netMargin),net_margin_bp:netBp,net_markup_bp:netMarkupBp,
    admin_fee_bp:Number(adminBp),admin_fee_minor:Number(adminFee),
    taxable_base_minor:Number(taxable),vat_rate_bp:Number(vatBp),vat_minor:Number(vat),
    grand_total_minor:Number(grand),
    // الهامش الذي يُقاس عليه القرار هو الهامش بعد الخصم: الخصم يخرج من الهامش ولا يُضاف إلى التكلفة.
    below_target:belowTarget,shortfall_bp:belowTarget?Number(targetBp)-netBp:0,
    // «الحد الأدنى المقبول» حقل في النموذج بلا قيمة في المصدر: بلا سياسة معتمدة يبقى null ولا يُخترع له رقم.
    below_minimum:minimumBp===null?null:netBp<minimumBp,
    status_name:belowTarget?'الهامش الفعلي دون المستهدف — يلزم MOD-BD-03':'الهامش الفعلي يبلغ المستهدف أو يتجاوزه',
    // كل معادلة تُعرض بأرقامها، لأن من يوقّع على السعر يحتاج أن يرى من أين جاء لا أن يثق به.
    formulas:[
      {key:'direct_total',label:'إجمالي التكاليف المباشرة',expression:`مجموع بنود المجموعات الخمس = ${n(direct)}`},
      {key:'contingency',label:'احتياطي الطوارئ (إلزامي)',expression:`${n(direct)} × ${pct(contingencyBp)} = ${n(contingency)}`},
      {key:'total_cost',label:'إجمالي التكاليف الكلية',expression:`${n(direct)} + ${n(contingency)} = ${n(totalCost)}`},
      {key:'sale_price',label:'سعر البيع قبل الضريبة',expression:`${n(totalCost)} ÷ (1 − ${pct(targetBp)}) = ${n(sale)}`},
      {key:'margin',label:'هامش الربح الفعلي قبل الخصم',expression:`(${n(sale)} − ${n(totalCost)}) ÷ ${n(sale)} = ${pct(actualBp)} · ${n(margin)} ريال`},
      {key:'markup',label:'هامش الربح على التكلفة (mark-up) — ليس هامش الربح',expression:`(${n(sale)} − ${n(totalCost)}) ÷ ${n(totalCost)} = ${pct(markupBp)}`},
      {key:'discount',label:'الخصم (حساب مستقل، يخرج من الهامش)',expression:`${n(sale)} − ${n(discount)} = ${n(net)}`},
      {key:'net_margin',label:'هامش الربح الفعلي بعد الخصم',expression:`(${n(net)} − ${n(totalCost)}) ÷ ${n(net)} = ${pct(netBp)} · ${n(netMargin)} ريال`},
      {key:'admin_fee',label:'الرسوم الإدارية (حساب مستقل، خارج الهامش)',expression:`${n(net)} × ${pct(adminBp)} = ${n(adminFee)}`},
      {key:'vat',label:'ضريبة القيمة المضافة (حساب مستقل، خارج الهامش)',expression:`(${n(net)} + ${n(adminFee)}) × ${pct(vatBp)} = ${n(vat)}`},
      {key:'grand_total',label:'الإجمالي شامل الضريبة',expression:`${n(taxable)} + ${n(vat)} = ${n(grand)}`}
    ],
    margin_note:'هامش الربح نسبة من سعر البيع، وهامش الربح على التكلفة نسبة من التكلفة. الرقمان مختلفان دائمًا ولا يُستبدل أحدهما بالآخر. '
      +'الخصم والرسوم الإدارية والضريبة خارج معادلة الهامش، ولكلٍّ حسابه المعروض أعلاه.'};
}

/* ───── التحقق من ازدواج الصرف الإعلامي ───── */
// عقد mediaInvoice: ({tenant_id,kind,reference}) => {conflict:string} | null
// يُستدعى عند حفظ المسودة فقط. غيابه لا يخترع نتيجة: يبقى التحقق «غير موصول» ويُعلن ذلك في الشاشة.
export function checkDoubleCount(lines,context,mediaInvoice){
  const seen=new Map();
  for(const l of lines){
    if(!l.cost_reference_id)continue;
    const key=`${l.cost_reference_kind} ${l.cost_reference_id}`;
    if(seen.has(key))fail(409,'double_counted',`المرجع «${l.cost_reference_id}» مكرر في بندين من الورقة نفسها (${seen.get(key).description} و${l.description}). الصرف الواحد بند واحد`);
    seen.set(key,l);
  }
  if(typeof mediaInvoice!=='function')return {checked:false,references:seen.size,notice:DOUBLE_COUNT_UNCHECKED};
  for(const l of seen.values()){
    const found=mediaInvoice({tenant_id:context.tenant_id,kind:l.cost_reference_kind,reference:l.cost_reference_id});
    if(found===null||found===undefined)continue;
    if(typeof found!=='object'||typeof found.conflict!=='string'||found.conflict.trim().length<3)fail(500,'media_invoice_resolver','مصدر التحقق من ازدواج الصرف الإعلامي أعاد قيمة غير صالحة');
    fail(409,'double_counted',`«${l.description}» مسجَّل تكلفةً مباشرة على المشروع، والصرف نفسه يصل عبر ${found.conflict.trim()}. `
      +'احتسابه مرتين يضاعف التكلفة الحقيقية ويشوّه الهامش المعروض. احذف البند أو اربطه بما لم يُفوتر بعد');
  }
  return {checked:true,references:seen.size,notice:''};
}

/* ───── المدخلات ───── */
function quantity(value,label){
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,5})(\.\d{1,2})?$/.test(value))fail(400,'invalid_quantity',`${label}: عدد بمنزلتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),centi=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(centi<1)fail(400,'invalid_quantity',`${label}: أكبر من صفر`);
  if(centi>100000000)fail(400,'invalid_quantity',`${label}: تجاوز الحد المسموح`);
  return centi;
}
function unitPrice(value,label){
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بالريال بمنزلتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(minor<1)fail(400,'invalid_money',`${label}: مبلغ موجب`);
  if(minor>100000000)fail(400,'invalid_money',`${label}: تجاوز الحد المسموح`);
  return minor;
}
function amount(value,label){
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بالريال بمنزلتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.');
  return Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
}
function percent(value,label){
  if(typeof value!=='string'||!/^(0|[1-9]\d?|100)(\.\d{1,2})?$/.test(value))fail(400,'invalid_rate',`${label}: نسبة مئوية من 0 إلى 100 بمنزلتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),bp=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(bp>10000)fail(400,'invalid_rate',`${label}: النسبة لا تتجاوز 100%`);
  return bp;
}
function duration(value,label,max){
  if(!Number.isInteger(value)||value<1||value>max)fail(400,'invalid_duration',`${label}: عدد صحيح من 1 إلى ${max}`);
  return value;
}

/* ───── النطاق والتصاريح ───── */
// «تسعير المشاريع» تصريح مستقل لمن يُعدّ الأسعار. العزل بعضوية فريق حساب العميل أولًا كبقية شاشات الوكالة.
function permitted(db,u){
  if(!can(db,u,'pricing.sheets.use',u.department_id))fail(403,'not_permitted','هذه الشاشة لحامل تصريح «تسعير المشاريع وعروض الأسعار». اطلبه من مسؤول الصلاحيات');
  return u;
}
function pricer(db,supplied){
  const clients=memberClients(db,supplied);
  return {u:permitted(db,currentUser(db,supplied)),clients};
}
function pricerClient(db,supplied,clientId){
  const {u,c}=clientFor(db,supplied,clientId);
  return {u:permitted(db,u),c};
}

/* ───── السياسات والقرارات ───── */
const livePolicy=(db,tenantId,key)=>db.prepare("SELECT * FROM pricing_policies WHERE tenant_id=? AND policy_key=? AND status='approved'").get(tenantId,key)??null;
export const liveIssuerDecision=(db,tenantId)=>db.prepare("SELECT * FROM pricing_decisions WHERE tenant_id=? AND decision_code=? AND status='approved'").get(tenantId,ISSUER_DECISION_CODE)??null;
// بطاقة الأسعار السارية (FRM-025): آخر بطاقة معتمدة بدأ سريانها في التاريخ أو قبله، وبطاقة العميل تتقدم على القائمة العامة.
function liveCard(db,tenantId,clientId,date){
  const pick=client=>db.prepare("SELECT * FROM price_cards WHERE tenant_id=? AND coalesce(client_id,'')=? AND status='approved' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1").get(tenantId,client??'',date);
  return pick(clientId)??pick(null)??null;
}
const policyView=(db,u,r)=>({...r,policy_name:POLICY_KEYS[r.policy_key],unit:r.value_unit,unit_name:UNITS[r.value_unit],
  display:r.value_unit==='percent'?`${(r.value_raw/100).toFixed(2)}%`:`${r.value_raw} ${UNITS[r.value_unit]}`,
  percent:r.value_unit==='percent'?(r.value_raw/100).toFixed(2):null,status_name:POLICY_STATUS[r.status],
  prepared_by_name:nameOf(db,r.prepared_by),decided_by_name:nameOf(db,r.decided_by),
  actions:r.status==='draft'&&r.prepared_by!==u.id&&can(db,u,'pricing.exception.approve')?['approve_policy','reject_policy']:[]});

export function preparePolicy(db,supplied,input){
  writing(db);v.object(input,['policy_key','percent','duration','source_reference','basis','effective_from']);
  const {u}=pricer(db,supplied),def=POLICY_BY_KEY.get(input.policy_key);
  if(!def)fail(400,'policy_key','اختر السياسة من مفاتيح نموذج التسعير ومساره');
  const raw=def.unit==='percent'?percent(input.percent,def.name):duration(input.duration,def.name,def.unit==='hours'?8760:260);
  if(input.policy_key==='target_margin'&&raw>=10000)fail(400,'impossible_margin','هامش مستهدف 100% أو أكثر مستحيل: سعر البيع = التكاليف ÷ (1 − هامش الربح)، والمقام يصير صفرًا');
  if(db.prepare("SELECT 1 FROM pricing_policies WHERE tenant_id=? AND policy_key=? AND status='draft'").get(u.tenant_id,input.policy_key))fail(409,'draft_exists','لهذه السياسة مسودة قائمة بانتظار الاعتماد');
  const revision=(db.prepare('SELECT MAX(revision) AS n FROM pricing_policies WHERE tenant_id=? AND policy_key=?').get(u.tenant_id,input.policy_key).n??0)+1;
  const policyId=id(),time=now();
  db.prepare("INSERT INTO pricing_policies(id,tenant_id,policy_key,revision,value_unit,value_raw,source_reference,basis,effective_from,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?,?)")
    .run(policyId,u.tenant_id,input.policy_key,revision,def.unit,raw,v.text(input.source_reference,'سند الرقم: أي نموذج أو مخطط نصّ عليه وأين',1500,10),v.text(input.basis,'لماذا هذا الرقم',1500,10),v.date(input.effective_from),u.id,time,time);
  audit(db,u,'pricing_policy',policyId,'pricing_policy.prepared',{}, {policy_key:input.policy_key,revision,value_raw:raw,value_unit:def.unit});
  return {id:policyId};
}
export function policyAction(db,supplied,policyId,action,input){
  writing(db);v.object(input,['version','note']);
  const {u}=pricer(db,supplied);
  const row=typeof policyId==='string'&&db.prepare('SELECT * FROM pricing_policies WHERE id=? AND tenant_id=?').get(policyId,u.tenant_id);
  if(!row)fail(404,'not_found','السياسة غير متاحة');
  v.version(input.version,row.version);
  if(!['approve_policy','reject_policy'].includes(action)||row.status!=='draft')fail(409,'action_unavailable','السياسة قُرر فيها. التغيير نسخة جديدة');
  // النسب والمهل سياسة شركة: يعتمدها صاحب صلاحية استثناء التسعير (الرئيس التنفيذي)، لا من أعدّها ولا أي حامل تصريح تسعير.
  if(row.prepared_by===u.id)fail(403,'self_approval','من أعدّ السياسة لا يعتمدها، مهما حمل من تصاريح');
  if(!can(db,u,'pricing.exception.approve'))fail(403,'not_permitted','اعتماد سياسات التسعير لصاحب صلاحية استثناء التسعير (الرئيس التنفيذي)');
  const status=action==='approve_policy'?'approved':'rejected',time=now();
  const note=v.text(input.note,'أساس القرار',1500,status==='approved'?3:10);
  if(status==='approved')db.prepare("UPDATE pricing_policies SET status='retired',version=version+1,updated_at=? WHERE tenant_id=? AND policy_key=? AND status='approved'").run(time,u.tenant_id,row.policy_key);
  db.prepare('UPDATE pricing_policies SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(status,u.id,time,note,time,row.id);
  audit(db,u,'pricing_policy',row.id,'pricing_policy.'+status,{status:'draft',version:row.version},{status,value_raw:row.value_raw},note);
  return {id:row.id,status};
}

export function prepareIssuerDecision(db,supplied,input){
  writing(db);v.object(input,['chosen_option','basis']);
  const {u}=pricer(db,supplied);
  if(!ISSUER_OPTIONS.some(o=>o.key===input.chosen_option))fail(400,'chosen_option','اختر جهة إصدار عرض السعر من القراءتين المسجلتين');
  if(db.prepare("SELECT 1 FROM pricing_decisions WHERE tenant_id=? AND decision_code=? AND status='draft'").get(u.tenant_id,ISSUER_DECISION_CODE))fail(409,'draft_exists','للقرار مسودة قائمة بانتظار الاعتماد');
  const revision=(db.prepare('SELECT MAX(revision) AS n FROM pricing_decisions WHERE tenant_id=? AND decision_code=?').get(u.tenant_id,ISSUER_DECISION_CODE).n??0)+1;
  const decisionId=id(),time=now();
  db.prepare("INSERT INTO pricing_decisions(id,tenant_id,decision_code,revision,chosen_option,basis,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,?,?)")
    .run(decisionId,u.tenant_id,ISSUER_DECISION_CODE,revision,input.chosen_option,v.text(input.basis,'على أي القراءتين استقر القرار ولماذا',1500,10),u.id,time,time);
  audit(db,u,'pricing_decision',decisionId,'pricing_decision.prepared',{}, {decision_code:ISSUER_DECISION_CODE,revision,chosen_option:input.chosen_option});
  return {id:decisionId};
}
export function issuerDecisionAction(db,supplied,decisionId,action,input){
  writing(db);v.object(input,['version','note']);
  const {u}=pricer(db,supplied);
  const row=typeof decisionId==='string'&&db.prepare('SELECT * FROM pricing_decisions WHERE id=? AND tenant_id=?').get(decisionId,u.tenant_id);
  if(!row)fail(404,'not_found','القرار غير متاح');
  v.version(input.version,row.version);
  if(!['approve_decision','reject_decision'].includes(action)||row.status!=='draft')fail(409,'action_unavailable','القرار حُسم. تغييره نسخة جديدة');
  if(row.prepared_by===u.id)fail(403,'self_approval','من رفع القرار لا يعتمده، مهما حمل من تصاريح');
  if(!can(db,u,'pricing.exception.approve'))fail(403,'not_permitted','حسم قرار جهة الإصدار لصاحب صلاحية استثناء التسعير (الرئيس التنفيذي)');
  const status=action==='approve_decision'?'approved':'rejected',time=now();
  const note=v.text(input.note,'أساس القرار',1500,status==='approved'?3:10);
  if(status==='approved')db.prepare("UPDATE pricing_decisions SET status='retired',version=version+1,updated_at=? WHERE tenant_id=? AND decision_code=? AND status='approved'").run(time,u.tenant_id,row.decision_code);
  db.prepare('UPDATE pricing_decisions SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(status,u.id,time,note,time,row.id);
  audit(db,u,'pricing_decision',row.id,'pricing_decision.'+status,{status:'draft'},{status,chosen_option:row.chosen_option},note);
  return {id:row.id,status};
}

/* ───── ورقة التسعير ───── */
function cleanLines(input){
  if(!Array.isArray(input)||!input.length||input.length>120)fail(400,'lines','بنود التكلفة من بند واحد إلى مئة وعشرين');
  return input.map((l,index)=>{
    v.object(l,['cost_group','description','basis','quantity','unit_price','cost_reference_kind','cost_reference_id','note']);
    if(!COST_GROUPS.some(g=>g.key===l.cost_group))fail(400,'cost_group',`البند ${index+1}: اختر المجموعة من مجموعات النموذج الخمس`);
    if(!Object.hasOwn(BASES,l.basis))fail(400,'basis',`البند ${index+1}: الأساس كمية أو ساعات`);
    const description=v.text(l.description,`البند ${index+1}: الوصف`,300,2);
    const kind=l.cost_reference_kind||'',reference=l.cost_reference_id?v.text(l.cost_reference_id,`البند ${index+1}: مرجع التكلفة`,120,3):'';
    if(kind&&!Object.hasOwn(REFERENCE_KINDS,kind))fail(400,'cost_reference_kind',`البند ${index+1}: نوع المرجع غير معروف`);
    if(!!kind!==!!reference)fail(400,'cost_reference_id',`البند ${index+1}: المرجع يحتاج نوعه، والنوع يحتاج مرجعه`);
    if(kind&&l.cost_group!=='paid_media')fail(400,'cost_reference_kind',`البند ${index+1}: مرجع الصرف الخارجي لميزانية الإعلانات الممولة وحدها`);
    return {line_no:index+1,cost_group:l.cost_group,description,basis:l.basis,
      quantity_centi:quantity(l.quantity,`البند ${index+1}: ${l.basis==='hours'?'الساعات':'الكمية'}`),
      unit_price_minor:unitPrice(l.unit_price,`البند ${index+1}: سعر الوحدة`),
      cost_reference_kind:kind,cost_reference_id:reference,note:l.note?v.text(l.note,`البند ${index+1}: ملاحظات`,500):''};
  });
}
const sheetLines=(db,sheetId)=>db.prepare('SELECT * FROM pricing_sheet_lines WHERE sheet_id=? ORDER BY line_no').all(sheetId);
function writeLines(db,sheetId,computed,time){
  db.prepare('DELETE FROM pricing_sheet_lines WHERE sheet_id=?').run(sheetId);
  const insert=db.prepare('INSERT INTO pricing_sheet_lines(id,sheet_id,line_no,cost_group,description,basis,quantity_centi,unit_price_minor,amount_minor,cost_reference_kind,cost_reference_id,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const l of computed.lines)insert.run(id(),sheetId,l.line_no,l.cost_group,l.description,l.basis,l.quantity_centi,l.unit_price_minor,l.amount_minor,l.cost_reference_kind,l.cost_reference_id,l.note,time);
}
const policySnapshot=r=>({contingency_rate_bp:r.contingency_rate_bp,target_margin_bp:r.target_margin_bp,minimum_margin_bp:r.minimum_margin_bp,
  discount_minor:r.discount_minor,admin_fee_bp:r.admin_fee_bp,vat_rate_bp:r.vat_rate_bp});
export function sheetTotals(db,row){return computePricing(sheetLines(db,row.id),policySnapshot(row));}
const approvalsOf=(db,sheetId)=>db.prepare('SELECT * FROM pricing_sheet_approvals WHERE sheet_id=? ORDER BY approval_round,decided_at').all(sheetId);
function exceptionOf(db,sheetId){return db.prepare('SELECT * FROM margin_exceptions WHERE sheet_id=? ORDER BY requested_at DESC LIMIT 1').get(sheetId)??null;}

function sheetView(db,u,row,clientName,date){
  const totals=sheetLines(db,row.id).length?sheetTotals(db,row):null,mine=row.prepared_by===u.id,actions=[];
  if(row.status==='draft'&&mine)actions.push('edit_sheet','submit_sheet');
  if(row.status==='submitted'&&mine)actions.push('withdraw_sheet');
  const all=approvalsOf(db,row.id),round=all.filter(a=>a.approval_round===row.approval_round);
  const seats=APPROVAL_SEATS.map(s=>{
    const decided=round.find(a=>a.seat===s.key)??null;
    const open=row.status==='submitted'&&!decided&&!mine&&can(db,u,s.capability,u.department_id);
    return {...s,decision:decided?.decision??null,decision_name:decided?DECISIONS[decided.decision]:null,
      decided_by:decided?.decided_by??null,decided_by_name:nameOf(db,decided?.decided_by),decided_at:decided?.decided_at??null,note:decided?.note??'',
      mine_to_decide:open};
  });
  if(seats.some(s=>s.mine_to_decide))actions.push('decide_sheet');
  const exception=exceptionOf(db,row.id),quotation=db.prepare('SELECT id,code,status FROM client_quotations WHERE sheet_id=? ORDER BY created_at DESC LIMIT 1').get(row.id)??null;
  const expired=!!exception&&exception.status==='approved'&&exception.expires_on<date;
  const exceptionLive=!!exception&&exception.status==='approved'&&!expired;
  if(row.status==='approved'){
    if(totals?.below_target&&(!exception||exception.status==='rejected'||expired))actions.push('request_exception');
    if(!quotation)actions.push('create_quotation');
  }
  const card=row.price_card_id?db.prepare('SELECT id,name,effective_from FROM price_cards WHERE id=?').get(row.price_card_id):null;
  return {...row,client_name:clientName,status_name:SHEET_STATUS[row.status],contract_kind_name:CONTRACT_KINDS[row.contract_kind],
    prepared_by_name:nameOf(db,row.prepared_by),proposed_pm_name:nameOf(db,row.proposed_pm_id),is_mine:mine,totals,
    approval_seats:seats,approval_history:all.map(a=>({...a,decision_name:DECISIONS[a.decision],seat_name:SEAT_BY_KEY.get(a.seat).name,decided_by_name:nameOf(db,a.decided_by)})),
    approvals_outstanding:seats.filter(s=>!s.decision).map(s=>s.name),
    price_card:card?{...card,pinned_on:row.price_card_effective_from}:null,
    rate_card_notice:card?'':'لا بطاقة أسعار معتمدة سارية عند حفظ هذه الورقة. لا يُصدر عرض سعر غير مربوط بإصدار بطاقة',
    minimum_margin_notice:row.minimum_margin_bp===null?'«الحد الأدنى المقبول» حقل في النموذج بلا قيمة في المصدر، ولم تُعتمد له سياسة بعد. لا رقم مفترض له':'',
    exception:exception?{...exception,status_name:EXCEPTION_STATUS[exception.status],expired,live:exceptionLive,
      requested_by_name:nameOf(db,exception.requested_by),decided_by_name:nameOf(db,exception.decided_by),attachments:JSON.parse(exception.attachments)}:null,
    exception_required:!!totals?.below_target,exception_satisfied:!totals?.below_target||exceptionLive,
    quotation,actions};
}

const FIELDS=['client_id','opportunity_id','name','scope_note','contract_kind','duration_note','proposed_pm_id','review_notes',
  'discount','discount_basis','admin_fee_percent','admin_fee_basis','vat_rate','vat_basis','lines'];
function sheetInput(db,u,c,input,date,mediaInvoice){
  const contingency=livePolicy(db,u.tenant_id,'contingency_rate'),target=livePolicy(db,u.tenant_id,'target_margin');
  const missing=[!contingency&&POLICY_KEYS.contingency_rate,!target&&POLICY_KEYS.target_margin].filter(Boolean);
  if(missing.length)fail(409,'policy_required',`لم تُعتمد بعد سياسة: ${missing.join(' و')}. الأرقام ليست في الكود: يدخلها مالك الإجراء بسندها من نموذج التسعير ويعتمدها صاحب الصلاحية قبل أول تسعيرة`);
  const minimum=livePolicy(db,u.tenant_id,'minimum_margin');
  if(!Object.hasOwn(CONTRACT_KINDS,input.contract_kind))fail(400,'contract_kind','نوع العقد: مشروع منفصل أو عقد شهري مستمر');
  const pm=input.proposed_pm_id?db.prepare("SELECT id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role IN ('employee','manager','pm')").get(input.proposed_pm_id,u.tenant_id):null;
  if(input.proposed_pm_id&&!pm)fail(400,'proposed_pm_id','مدير المشروع المقترح حساب نشط في فرق التشغيل');
  const discount=input.discount?amount(input.discount,'الخصم'):0;
  const adminBp=input.admin_fee_percent?percent(input.admin_fee_percent,'نسبة الرسوم الإدارية'):0;
  const vatBp=percent(input.vat_rate,'نسبة ضريبة القيمة المضافة');
  const lines=cleanLines(input.lines);
  const doubleCount=checkDoubleCount(lines,{tenant_id:u.tenant_id},mediaInvoice);
  const computed=computePricing(lines,{contingency_rate_bp:contingency.value_raw,target_margin_bp:target.value_raw,
    minimum_margin_bp:minimum?minimum.value_raw:null,discount_minor:discount,admin_fee_bp:adminBp,vat_rate_bp:vatBp});
  return {contingency,target,minimum,discount,adminBp,vatBp,lines,computed,doubleCount,pm:pm?.id??null,
    card:liveCard(db,u.tenant_id,c.id,date),contractKind:input.contract_kind,
    durationNote:v.text(input.duration_note,'مدة المشروع كما في النموذج',300,2),
    reviewNotes:input.review_notes?v.text(input.review_notes,'ملاحظات المراجعة',2000):'',
    discountBasis:discount?v.text(input.discount_basis,'سند الخصم ومن وافق عليه',1000,5):'',
    adminBasis:adminBp?v.text(input.admin_fee_basis,'سند الرسوم الإدارية',1000,5):'',
    vatBasis:v.text(input.vat_basis,'سند نسبة الضريبة',1000,3),
    name:v.text(input.name,'اسم المشروع في النموذج',180,3),scope:v.text(input.scope_note,'النطاق والافتراضات',4000,10)};
}
export function saveSheet(db,supplied,input,{mediaInvoice}={}){
  writing(db);v.object(input,FIELDS);
  const {u,c}=pricerClient(db,supplied,input.client_id),date=today(),time=now();
  assertClientOpen(db,u.tenant_id,c.id,'ما تنفتح ورقة تسعير');
  if(input.opportunity_id&&!db.prepare("SELECT 1 FROM opportunities WHERE id=? AND client_id=? AND tenant_id=? AND status='open'").get(input.opportunity_id,c.id,u.tenant_id))fail(400,'opportunity_id','الفرصة ليست فرصة مفتوحة لهذا العميل');
  const f=sheetInput(db,u,c,input,date,mediaInvoice),sheetId=id();
  const sheetCode=`PS-${String(db.prepare('SELECT COUNT(*) AS n FROM pricing_sheets WHERE tenant_id=?').get(u.tenant_id).n+1).padStart(4,'0')}`;
  db.prepare(`INSERT INTO pricing_sheets(id,tenant_id,client_id,opportunity_id,code,name,scope_note,contract_kind,duration_note,proposed_pm_id,review_notes,quoted_on,
      price_card_id,price_card_effective_from,rates_on,contingency_rate_bp,contingency_policy_id,target_margin_bp,target_margin_policy_id,minimum_margin_bp,minimum_margin_policy_id,
      discount_minor,discount_basis,admin_fee_bp,admin_fee_basis,vat_rate_bp,vat_basis,status,prepared_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`)
    .run(sheetId,u.tenant_id,c.id,input.opportunity_id||null,sheetCode,f.name,f.scope,f.contractKind,f.durationNote,f.pm,f.reviewNotes,date,
      f.card?.id??null,f.card?.effective_from??'',date,f.contingency.value_raw,f.contingency.id,f.target.value_raw,f.target.id,
      f.minimum?f.minimum.value_raw:null,f.minimum?f.minimum.id:null,
      f.discount,f.discountBasis,f.adminBp,f.adminBasis,f.vatBp,f.vatBasis,u.id,time,time);
  writeLines(db,sheetId,f.computed,time);
  audit(db,u,'pricing_sheet',sheetId,'pricing_sheet.created',{}, {code:sheetCode,client:c.code,lines:f.lines.length,
    direct_total_minor:f.computed.direct_total_minor,net_margin_bp:f.computed.net_margin_bp,double_count_checked:f.doubleCount.checked});
  return {id:sheetId};
}
function sheetRow(db,supplied,sheetId){
  const row=typeof sheetId==='string'&&db.prepare('SELECT * FROM pricing_sheets WHERE id=?').get(sheetId);
  if(!row)fail(404,'not_found','ورقة التسعير غير متاحة');
  const {u,c}=pricerClient(db,supplied,row.client_id);
  if(row.tenant_id!==u.tenant_id)fail(404,'not_found','ورقة التسعير غير متاحة');
  return {u,c,row};
}
export function sheetAction(db,supplied,sheetId,action,input,{mediaInvoice}={}){
  writing(db);const {u,c,row}=sheetRow(db,supplied,sheetId),date=today(),time=now();
  const view=sheetView(db,u,row,'',date);
  const key={edit:'edit_sheet',submit:'submit_sheet',withdraw:'withdraw_sheet',decide:'decide_sheet'}[action];
  if(!key)fail(404,'not_found','الإجراء غير متاح');
  if(!view.actions.includes(key))fail(409,'action_unavailable',['approved','rejected'].includes(row.status)?'الورقة قُرر فيها ولا تُعدَّل. التصحيح ورقة جديدة':'الإجراء غير متاح في حالة الورقة أو لحسابك');
  const bump=(fields,values)=>db.prepare(`UPDATE pricing_sheets SET ${fields?fields+',':''}version=version+1,updated_at=? WHERE id=? AND version=?`).run(...values,time,row.id,row.version);

  if(action==='edit'){
    v.object(input,['version',...FIELDS.filter(f=>f!=='client_id'&&f!=='opportunity_id')]);
    v.version(input.version,row.version);
    const f=sheetInput(db,u,c,{...input,client_id:c.id},date,mediaInvoice);
    bump(`name=?,scope_note=?,contract_kind=?,duration_note=?,proposed_pm_id=?,review_notes=?,quoted_on=?,price_card_id=?,price_card_effective_from=?,rates_on=?,
      contingency_rate_bp=?,contingency_policy_id=?,target_margin_bp=?,target_margin_policy_id=?,minimum_margin_bp=?,minimum_margin_policy_id=?,
      discount_minor=?,discount_basis=?,admin_fee_bp=?,admin_fee_basis=?,vat_rate_bp=?,vat_basis=?`,
      [f.name,f.scope,f.contractKind,f.durationNote,f.pm,f.reviewNotes,date,f.card?.id??null,f.card?.effective_from??'',date,
        f.contingency.value_raw,f.contingency.id,f.target.value_raw,f.target.id,f.minimum?f.minimum.value_raw:null,f.minimum?f.minimum.id:null,
        f.discount,f.discountBasis,f.adminBp,f.adminBasis,f.vatBp,f.vatBasis]);
    writeLines(db,row.id,f.computed,time);
    audit(db,u,'pricing_sheet',row.id,'pricing_sheet.edited',{version:row.version},{lines:f.lines.length,direct_total_minor:f.computed.direct_total_minor,net_margin_bp:f.computed.net_margin_bp});
    return {id:row.id};
  }
  if(action==='submit'||action==='withdraw'){
    v.object(input,['version']);v.version(input.version,row.version);
    // السحب يفتح جولة جديدة: اعتماد جزئي على نسخة سُحبت لا يُحسب على النسخة التالية.
    bump('status=?,submitted_at=?,approval_round=?',action==='submit'?['submitted',time,row.approval_round]:['draft',null,row.approval_round+1]);
    audit(db,u,'pricing_sheet',row.id,'pricing_sheet.'+action,{status:row.status,version:row.version},{status:action==='submit'?'submitted':'draft',round:action==='submit'?row.approval_round:row.approval_round+1});
    return {id:row.id};
  }
  // مقعد من مقاعد الاعتماد الأربعة. القرار ثلاثي كما في النموذج: معتمد / مرفوض / يحتاج تعديل.
  v.object(input,['version','seat','decision','note']);v.version(input.version,row.version);
  const seat=view.approval_seats.find(s=>s.key===input.seat);
  if(!seat)fail(400,'seat','اختر مقعد الاعتماد من مقاعد النموذج الأربعة');
  if(!seat.mine_to_decide)fail(403,'seat_scope',seat.decision?`قرار مقعد «${seat.name}» مسجَّل في هذه الجولة`:`مقعد «${seat.name}» لحامل تصريحه، ولا يقرره من أعدّ الورقة`);
  if(!Object.hasOwn(DECISIONS,input.decision))fail(400,'decision','القرار: معتمد أو مرفوض أو يحتاج تعديل');
  const note=v.text(input.note,'ملاحظات القرار',2000,input.decision==='approved'?3:10);
  db.prepare('INSERT INTO pricing_sheet_approvals(id,sheet_id,approval_round,seat,decision,capability,note,decided_by,decided_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id(),row.id,row.approval_round,seat.key,input.decision,seat.capability,note,u.id,time);
  const decided=approvalsOf(db,row.id).filter(a=>a.approval_round===row.approval_round);
  let status=row.status,after={seat:seat.key,decision:input.decision};
  if(input.decision==='rejected'){status='rejected';bump('status=?,decided_at=?,decision_note=?',[status,time,note]);}
  else if(input.decision==='returned'){status='draft';bump('status=?,submitted_at=?,approval_round=?,review_notes=?',[status,null,row.approval_round+1,note]);}
  else if(APPROVAL_SEATS.every(s=>decided.find(a=>a.seat===s.key&&a.decision==='approved'))){status='approved';bump('status=?,decided_at=?,decision_note=?',[status,time,note]);}
  else bump('',[]);
  after={...after,status,outstanding:APPROVAL_SEATS.filter(s=>!decided.some(a=>a.seat===s.key)).map(s=>s.key)};
  audit(db,u,'pricing_sheet',row.id,'pricing_sheet.seat_'+input.decision,{status:row.status,version:row.version,seat:seat.key},{...after,version:row.version+1},note);
  return {id:row.id,seat:seat.key,decision:input.decision,status};
}

/* ───── استثناء التسعير (MOD-BD-03) ───── */
export function requestMarginException(db,supplied,sheetId,input){
  writing(db);v.object(input,['justification','applies_to','attachments','expires_on']);
  const {u,row}=sheetRow(db,supplied,sheetId),date=today(),time=now();
  if(row.status!=='approved')fail(409,'sheet_not_approved','الاستثناء يُطلب على ورقة تسعير معتمدة من مقاعدها الأربعة');
  const totals=sheetTotals(db,row);
  if(!totals.below_target)fail(409,'no_exception_needed',`هامش الربح الفعلي ${(totals.net_margin_bp/100).toFixed(2)}% لا يقل عن المستهدف ${(row.target_margin_bp/100).toFixed(2)}%. لا استثناء لما لا يخالف السياسة`);
  if(db.prepare("SELECT 1 FROM margin_exceptions WHERE sheet_id=? AND status IN ('pending','approved')").get(row.id))fail(409,'exception_exists','لهذه الورقة طلب استثناء قائم أو معتمد');
  const expires=v.date(input.expires_on);
  if(expires<=date)fail(400,'expires_on','تاريخ انتهاء الاستثناء بعد اليوم: استثناء بلا نهاية يصير سياسة');
  if(!Array.isArray(input.attachments)||input.attachments.length>20)fail(400,'attachments','المرفقات قائمة مراجع حتى عشرين');
  const attachments=input.attachments.map((a,index)=>v.text(a,`المرفق ${index+1}: مرجعه وأين حُفظ`,500,3));
  const code=`MX-${String(db.prepare('SELECT COUNT(*) AS n FROM margin_exceptions WHERE tenant_id=?').get(u.tenant_id).n+1).padStart(4,'0')}`;
  // أثر القيمة يُحسب ولا يُسأل عنه: ما تنازلت عنه الشركة = سعر البيع عند الهامش المستهدف ناقص ما ستقبضه فعلًا.
  const impact=totals.sale_price_pre_tax_minor-totals.net_pre_tax_minor,exceptionId=id();
  db.prepare("INSERT INTO margin_exceptions(id,tenant_id,sheet_id,code,requested_margin_bp,policy_margin_bp,value_impact_minor,justification,applies_to,attachments,expires_on,status,requested_by,requested_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)")
    .run(exceptionId,u.tenant_id,row.id,code,totals.net_margin_bp,row.target_margin_bp,impact,
      v.text(input.justification,'مبرر الاستثناء: لماذا يُقبل هذا الهامش الآن',3000,20),v.text(input.applies_to,'نطاق الاستثناء: ما الذي يسري عليه بالضبط',1000,5),
      JSON.stringify(attachments),expires,u.id,time,time);
  audit(db,u,'margin_exception',exceptionId,'margin_exception.requested',{}, {code,sheet_id:row.id,requested_margin_bp:totals.net_margin_bp,policy_margin_bp:row.target_margin_bp,value_impact_minor:impact,expires_on:expires});
  return {id:exceptionId};
}
export function marginExceptionAction(db,supplied,exceptionId,action,input){
  writing(db);v.object(input,['version','note']);
  const {u}=pricer(db,supplied);
  const row=typeof exceptionId==='string'&&db.prepare('SELECT * FROM margin_exceptions WHERE id=? AND tenant_id=?').get(exceptionId,u.tenant_id);
  if(!row)fail(404,'not_found','طلب الاستثناء غير متاح');
  pricerClient(db,supplied,db.prepare('SELECT client_id FROM pricing_sheets WHERE id=?').get(row.sheet_id).client_id);
  v.version(input.version,row.version);
  if(!['approve_exception','reject_exception'].includes(action)||row.status!=='pending')fail(409,'action_unavailable','الطلب قُرر فيه. الاستثناء الجديد طلب جديد');
  // MOD-BD-03 قرار الرئيس التنفيذي وحده، ولا يُقرَّه من طلبه.
  if(row.requested_by===u.id)fail(403,'self_approval','من طلب الاستثناء لا يعتمده، مهما حمل من تصاريح');
  if(!can(db,u,'pricing.exception.approve'))fail(403,'not_permitted','استثناء التسعير يعتمده الرئيس التنفيذي وحده. اطلب التصريح من مسؤول الصلاحيات');
  const status=action==='approve_exception'?'approved':'rejected',time=now();
  const note=v.text(input.note,'أساس القرار',2000,10);
  db.prepare('UPDATE margin_exceptions SET status=?,decided_by=?,decided_at=?,decision_note=?,version=version+1,updated_at=? WHERE id=?').run(status,u.id,time,note,time,row.id);
  audit(db,u,'margin_exception',row.id,'margin_exception.'+status,{status:'pending'},{status,requested_margin_bp:row.requested_margin_bp,value_impact_minor:row.value_impact_minor,expires_on:row.expires_on},note);
  return {id:row.id,status};
}

/* ───── عرض سعر العميل (FRM-024) ───── */
function quotationSnapshot(row,totals,card){
  return {sheet_id:row.id,sheet_code:row.code,name:row.name,scope:row.scope_note,currency:'SAR',
    contract_kind:row.contract_kind,duration_note:row.duration_note,
    price_card_id:card.id,price_card_name:card.name,price_card_effective_from:card.effective_from,
    contingency_rate_bp:row.contingency_rate_bp,target_margin_bp:row.target_margin_bp,minimum_margin_bp:row.minimum_margin_bp,
    groups:totals.groups,direct_total_minor:totals.direct_total_minor,contingency_minor:totals.contingency_minor,total_cost_minor:totals.total_cost_minor,
    sale_price_pre_tax_minor:totals.sale_price_pre_tax_minor,discount_minor:totals.discount_minor,net_pre_tax_minor:totals.net_pre_tax_minor,
    actual_margin_bp:totals.actual_margin_bp,net_margin_bp:totals.net_margin_bp,markup_bp:totals.markup_bp,
    admin_fee_bp:totals.admin_fee_bp,admin_fee_minor:totals.admin_fee_minor,
    vat_rate_bp:totals.vat_rate_bp,vat_minor:totals.vat_minor,grand_total_minor:totals.grand_total_minor,
    formulas:totals.formulas,rounding:'half-up-on-integers'};
}
function writeVersion(db,u,quotation,row,validUntil,note,time){
  const card=db.prepare('SELECT id,name,effective_from FROM price_cards WHERE id=?').get(row.price_card_id);
  if(!card)fail(409,'rate_card_required','ورقة التسعير غير مربوطة بإصدار بطاقة أسعار معتمدة. لا يُرسل عرض برقم لا يُعرف من أي بطاقة جاء');
  const totals=sheetTotals(db,row),exception=exceptionOf(db,row.id);
  const snapshot=JSON.stringify(quotationSnapshot(row,totals,card));
  const revision=(db.prepare('SELECT MAX(revision) AS n FROM quotation_versions WHERE quotation_id=?').get(quotation.id).n??0)+1;
  const versionId=id();
  db.prepare('INSERT INTO quotation_versions(id,quotation_id,revision,price_card_id,price_card_effective_from,valid_until,snapshot,digest,margin_exception_id,note,prepared_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(versionId,quotation.id,revision,card.id,card.effective_from,validUntil,snapshot,hash(snapshot),exception?.status==='approved'?exception.id:null,note,u.id,time);
  return {versionId,revision,totals};
}
export function createQuotation(db,supplied,sheetId,input){
  writing(db);v.object(input,['valid_until','note','custom_fields']);
  const {u,c,row}=sheetRow(db,supplied,sheetId),date=today(),time=now();
  assertClientOpen(db,u.tenant_id,c.id,'ما ينفتح عرض سعر');
  if(row.status!=='approved')fail(409,'sheet_not_approved','العرض يُبنى على ورقة تسعير معتمدة من مقاعدها الأربعة');
  if(db.prepare('SELECT 1 FROM client_quotations WHERE sheet_id=?').get(row.id))fail(409,'quotation_exists','لهذه الورقة عرض قائم. النسخة الجديدة تُضاف إليه');
  const validUntil=v.date(input.valid_until);
  if(validUntil<date)fail(400,'valid_until','تاريخ صلاحية العرض لا يسبق اليوم');
  const code=`QT-${String(db.prepare('SELECT COUNT(*) AS n FROM client_quotations WHERE tenant_id=?').get(u.tenant_id).n+1).padStart(4,'0')}`;
  const quotationId=id();
  // الحقول المخصّصة (ترحيل 123): تُحكم بالتعريف المنشور وحده، وتُكتب مع الصف نفسه. بلا تعريف منشور تبقى '{}' ولا يتغير شيء.
  const custom=prepare(db,u,'client_quotation',null,input.custom_fields,{creating:true});
  db.prepare("INSERT INTO client_quotations(id,tenant_id,client_id,sheet_id,code,status,created_by,created_at,updated_at,custom_fields) VALUES(?,?,?,?,?,'draft',?,?,?,?)").run(quotationId,u.tenant_id,c.id,row.id,code,u.id,time,time,custom.json);
  const {versionId,revision}=writeVersion(db,u,{id:quotationId},row,validUntil,input.note?v.text(input.note,'ملاحظة النسخة',1000):'',time);
  db.prepare('UPDATE client_quotations SET current_version_id=?,version=version+1,updated_at=? WHERE id=?').run(versionId,time,quotationId);
  audit(db,u,'client_quotation',quotationId,'quotation.created',{}, {code,sheet_id:row.id,revision,valid_until:validUntil,definition_version:custom.version});
  custom.audit(quotationId);
  return {id:quotationId};
}
function quotationRow(db,supplied,quotationId){
  const q=typeof quotationId==='string'&&db.prepare('SELECT * FROM client_quotations WHERE id=?').get(quotationId);
  if(!q)fail(404,'not_found','عرض السعر غير متاح');
  const {u,c}=pricerClient(db,supplied,q.client_id);
  if(q.tenant_id!==u.tenant_id)fail(404,'not_found','عرض السعر غير متاح');
  return {u,c,q,row:db.prepare('SELECT * FROM pricing_sheets WHERE id=?').get(q.sheet_id)};
}
export function quotationAction(db,supplied,quotationId,action,input){
  writing(db);const {u,q,row}=quotationRow(db,supplied,quotationId),date=today(),time=now();
  const fields={issue:['note'],revise:['valid_until','note'],accept:['reason'],reject:['reason']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version','custom_fields',...fields]);v.version(input.version,q.version);
  if(['accepted','rejected'].includes(q.status))fail(409,'action_unavailable','العرض سُجِّلت نتيجته ولا يُعدَّل');
  const current=db.prepare('SELECT * FROM quotation_versions WHERE id=?').get(q.current_version_id);
  // بوابة التعريف المنشور: حقل إلزامي عند هذا الانتقال ولم يُستكمل يوقفه برفض يسمّيه، ولو تجاوز الطلبُ الواجهة.
  // gate.json يُكتب في UPDATE الانتقال نفسه: الانتقال وقيمه جملة واحدة، فزناد النسخة والنهائية يحكمهما معًا.
  const gate=forTransition(db,u,'client_quotation',q,action,input.custom_fields);

  if(action==='revise'){
    const validUntil=v.date(input.valid_until);
    if(validUntil<date)fail(400,'valid_until','تاريخ صلاحية العرض لا يسبق اليوم');
    const {versionId,revision}=writeVersion(db,u,q,row,validUntil,input.note?v.text(input.note,'ما الذي تغيّر في هذه النسخة',1000):'',time);
    // النسخة الجديدة تعيد العرض إلى المسودة: ما لم يُصدر بعد لا يُقال للعميل إنه صدر.
    db.prepare("UPDATE client_quotations SET status='draft',current_version_id=?,custom_fields=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(versionId,gate.json,time,q.id,q.version);
    audit(db,u,'client_quotation',q.id,'quotation.revised',{status:q.status,version:q.version},{status:'draft',revision,valid_until:validUntil,definition_version:gate.version});
    gate.audit();
    return {id:q.id,revision};
  }
  if(action==='issue'){
    if(q.status!=='draft')fail(409,'action_unavailable','العرض صدر بالفعل. التغيير نسخة جديدة تُصدر بعدها');
    // التعارض 1: بلا قرار مالك لا إصدار، ولا تختار المنصة جهةً عنه.
    const decision=liveIssuerDecision(db,u.tenant_id);
    if(!decision)fail(409,'issuer_unset',ISSUER_UNSET);
    const option=ISSUER_OPTIONS.find(o=>o.key===decision.chosen_option);
    if(!can(db,u,option.capability,u.department_id))fail(403,'issuer_role',`قرار المالك أن يُصدر عرض سعر العميل: ${option.name}. الإصدار لحامل تصريح تلك الجهة وحده`);
    if(!current)fail(409,'version_required','لا نسخة للعرض');
    if(current.valid_until<date)fail(409,'expired_quote','انتهت صلاحية نسخة العرض. أصدر نسخة جديدة بتاريخ صلاحية جديد');
    const totals=sheetTotals(db,row);
    // تنبيه المصدر في MOD-BD-02: هامش فعلي أقل من المستهدف يوجب MOD-BD-03 قبل إرسال العرض.
    if(totals.below_target){
      const exception=exceptionOf(db,row.id);
      if(!exception||exception.status!=='approved')fail(409,'margin_exception_required',
        `هامش الربح الفعلي ${(totals.net_margin_bp/100).toFixed(2)}% أقل من المستهدف ${(row.target_margin_bp/100).toFixed(2)}%. لا يُرسل العرض قبل طلب استثناء تسعير (MOD-BD-03) يعتمده الرئيس التنفيذي`);
      if(exception.expires_on<date)fail(409,'exception_expired',`انتهت صلاحية استثناء التسعير ${exception.code} بتاريخ ${exception.expires_on}. يلزم استثناء ساري`);
      if(totals.net_margin_bp<exception.requested_margin_bp)fail(409,'exception_scope',
        `الهامش الآن ${(totals.net_margin_bp/100).toFixed(2)}% أقل مما اعتُمد في الاستثناء ${exception.code} (${(exception.requested_margin_bp/100).toFixed(2)}%). يلزم استثناء جديد بالرقم الفعلي`);
    }
    db.prepare("UPDATE client_quotations SET status='issued',issuer_role=?,issuer_decision_id=?,issued_by=?,issued_at=?,custom_fields=?,version=version+1,updated_at=? WHERE id=? AND version=?")
      .run(decision.chosen_option,decision.id,u.id,time,gate.json,time,q.id,q.version);
    // definition_version: أي نسخة من تعريف الصفحة حكمت هذا الإصدار (0 = افتراضات الكود).
    audit(db,u,'client_quotation',q.id,'quotation.issued',{status:'draft',version:q.version},
      {status:'issued',issuer_role:decision.chosen_option,decision_id:decision.id,price_card_id:current.price_card_id,valid_until:current.valid_until,
        net_margin_bp:totals.net_margin_bp,grand_total_minor:totals.grand_total_minor,definition_version:gate.version},input.note?v.text(input.note,'ملاحظة الإصدار',1000):'');
    gate.audit();
    return {id:q.id,status:'issued',issuer_role:decision.chosen_option};
  }
  if(q.status!=='issued')fail(409,'action_unavailable','تُسجَّل نتيجة العرض بعد إصداره للعميل');
  const outcome=action==='accept'?'won':'lost';
  const reason=v.text(input.reason,outcome==='won'?'سبب الفوز كما ذكره العميل':'سبب الخسارة كما ذكره العميل',2000,10);
  db.prepare("UPDATE client_quotations SET status=?,outcome=?,outcome_reason=?,outcome_recorded_by=?,outcome_recorded_at=?,custom_fields=?,version=version+1,updated_at=? WHERE id=? AND version=?")
    .run(outcome==='won'?'accepted':'rejected',outcome,reason,u.id,time,gate.json,time,q.id,q.version);
  audit(db,u,'client_quotation',q.id,'quotation.'+outcome,{status:'issued',version:q.version},{status:outcome==='won'?'accepted':'rejected',outcome,definition_version:gate.version},reason);
  gate.audit();
  return {id:q.id,outcome};
}

/* ───── عداد الإصدار (التعارض 9) ───── */
// عداد واحد فقط يخص هذه الشاشة: من اكتمال متطلبات العرض (اعتماد الورقة من مقاعدها الأربعة) إلى إصداره، بالساعات.
// عداد التحقق المالي في مسار المورد يُقاس بأيام العمل ويخص F-04، ولا يُدمج بهذا ولا يُحوَّل إليه.
function issueClock(db,tenantId,row,q){
  const policy=livePolicy(db,tenantId,'quotation_issue_sla_hours');
  const from=row.decided_at,to=q.issued_at;
  const elapsed=from?Math.round((Date.parse(to??now())-Date.parse(from))/36000)/100:null;
  return {clock:'quotation_issue',unit:'hours',target_hours:policy?policy.value_raw:null,
    requirements_complete_at:from??null,issued_at:q.issued_at??null,elapsed_hours:elapsed,
    within_target:policy&&elapsed!==null?elapsed<=policy.value_raw:null,
    source:policy?policy.source_reference:'',
    notice:policy?'':'مهلة إصدار عرض سعر العميل لم تُعتمد بعد سياسةً. العداد يقيس ولا يحكم.',separate_clock_note:TWO_CLOCKS};
}

/* ───── سجل العرض الإلكتروني (للقراءة فقط) ───── */
// قرار المالك: لا طباعة ولا مستند ورقي. العرض سجل إلكتروني يُقرأ في الشاشة، والاعتماد حدث هوية في سلسلة التدقيق.
function approvalEvent(db,label,capability,userId,at,subject,note=''){
  return userId?{step:label,capability,decided_by:userId,decided_by_name:nameOf(db,userId),decided_at:at,subject,note,evidence:'سلسلة التدقيق'}:null;
}
export function quotationRecord(db,supplied,quotationId){
  const {u,c,q,row}=quotationRow(db,supplied,quotationId),date=today();
  const view=quotationView(db,u,q,date),exception=exceptionOf(db,row.id);
  const contingency=db.prepare('SELECT * FROM pricing_policies WHERE id=?').get(row.contingency_policy_id);
  const target=db.prepare('SELECT * FROM pricing_policies WHERE id=?').get(row.target_margin_policy_id);
  const decision=q.issuer_decision_id?db.prepare('SELECT * FROM pricing_decisions WHERE id=?').get(q.issuer_decision_id):null;
  const seats=approvalsOf(db,row.id).filter(a=>a.approval_round===row.approval_round);
  // أسطر المسار التي تحمل نسبة احتياطي أو هامش تُسقط مع الأرقام نفسها حين يحجبها تعريف الصفحة عن هذا القارئ:
  // حجب الهامش في اللقطة مع بقائه في سطر الاستثناء حجبٌ على الورق.
  const figures=event=>event&&{...event,figures:true};
  const trail=[
    figures(approvalEvent(db,'اعتماد احتياطي الطوارئ','pricing.exception.approve',contingency?.decided_by,contingency?.decided_at,`${(contingency?.value_raw??0)/100}% — ${contingency?.source_reference??''}`,contingency?.decision_note)),
    figures(approvalEvent(db,'اعتماد هامش الربح المستهدف','pricing.exception.approve',target?.decided_by,target?.decided_at,`${(target?.value_raw??0)/100}% — ${target?.source_reference??''}`,target?.decision_note)),
    ...seats.map(a=>approvalEvent(db,`${SEAT_BY_KEY.get(a.seat).name} — ${DECISIONS[a.decision]}`,a.capability,a.decided_by,a.decided_at,`${row.code} — ${row.name}`,a.note)),
    exception&&exception.status!=='pending'?figures(approvalEvent(db,`استثناء التسعير MOD-BD-03 (${EXCEPTION_STATUS[exception.status]})`,'pricing.exception.approve',exception.decided_by,exception.decided_at,`${exception.code} — ${(exception.requested_margin_bp/100).toFixed(2)}% حتى ${exception.expires_on}`,exception.decision_note)):null,
    approvalEvent(db,'قرار جهة إصدار عرض السعر','pricing.exception.approve',decision?.decided_by,decision?.decided_at,decision?ISSUER_OPTIONS.find(o=>o.key===decision.chosen_option).name:'',decision?.decision_note),
    approvalEvent(db,'إصدار العرض للعميل',q.issuer_role?ISSUER_OPTIONS.find(o=>o.key===q.issuer_role).capability:'',q.issued_by,q.issued_at,view.current?`النسخة ${view.current.revision} · صلاحية ${view.current.valid_until}`:'',''),
    approvalEvent(db,q.outcome==='won'?'قبول العميل':'رفض العميل','pricing.sheets.use',q.outcome_recorded_by,q.outcome_recorded_at,q.outcome?QUOTATION_STATUS[q.status]:'',q.outcome_reason)
  ].filter(Boolean);
  const held=withholder(db,u,'client_quotation')({today:date,record_kind:'electronic',printable:false,
    client_name:c.trade_name||c.legal_name,code:q.code,status:q.status,status_name:view.status_name,custom_fields:view.custom_fields,custom:view.custom,
    sheet:{code:row.code,name:row.name,scope_note:row.scope_note,contract_kind_name:CONTRACT_KINDS[row.contract_kind],duration_note:row.duration_note},
    current:view.current,versions:view.versions,expired:view.expired,
    issuer_role:q.issuer_role,issuer_name:view.issuer_name,
    issue_clock:issueClock(db,q.tenant_id,row,q),
    approval_trail:trail,note:APPROVAL_IS_ELECTRONIC});
  // الوسم figures داخلي: يُسقط به السطر عن المحجوب عنه، ولا يخرج في الحمولة لأحد.
  return {...held,approval_trail:held.approval_trail.filter(event=>!held.withheld?.length||!event.figures).map(({figures:_,...event})=>event)};
}

/* ───── اللوحة ───── */
// projectRow: مُسقِط الحقول المخصّصة، يُبنى مرة في اللوحة ويُمرَّر لكل صف. يُنشر بعد {...q} عمدًا: يكتب فوق العمود الخام
// custom_fields بالكائن المحجوب لهذا القارئ، فلا يحمل {...q} قيمة حقل محجوب إلى المتصفح.
function quotationView(db,u,q,date,projectRow=projector(db,u,'client_quotation')){
  const versions=db.prepare('SELECT * FROM quotation_versions WHERE quotation_id=? ORDER BY revision').all(q.id).map(r=>({...r,snapshot:JSON.parse(r.snapshot),prepared_by_name:nameOf(db,r.prepared_by)}));
  const current=versions.find(r=>r.id===q.current_version_id)??null,expired=!!current&&current.valid_until<date;
  const actions=[];
  if(!['accepted','rejected'].includes(q.status)){
    actions.push('revise_quotation');
    if(q.status==='draft'&&!expired)actions.push('issue_quotation');
    if(q.status==='issued')actions.push('accept_quotation','reject_quotation');
  }
  const decision=liveIssuerDecision(db,u.tenant_id);
  // عبارة الحالة: تجاوز منشور في تعريف الصفحة، وإلا عبارة الكود. «صدر للعميل» تصير «مُرسل» من المحرّر بلا سطر كود.
  return {...q,...projectRow(q),status_name:statusLabel(db,u.tenant_id,'client_quotation',q.status,QUOTATION_STATUS[q.status]),issuer_name:q.issuer_role?ISSUER_OPTIONS.find(o=>o.key===q.issuer_role).name:'',
    created_by_name:nameOf(db,q.created_by),issued_by_name:nameOf(db,q.issued_by),outcome_recorded_by_name:nameOf(db,q.outcome_recorded_by),
    versions,current,expired,issuer_ready:!!decision,issuer_notice:decision?'':ISSUER_UNSET,deal:dealOfQuotation(db,q.id),actions};
}
// الصفقة التي رُبط بها العرض (الترحيل 182، القرار D2): نسخة عرضها على هذا العرض، وهل توثّق اتفاقها عليه. عرض السعر لصفقة واحدة.
function dealOfQuotation(db,quotationId){
  const p=db.prepare('SELECT p.case_id,k.name,k.status FROM commercial_quote_proposals p JOIN commercial_cases k ON k.id=p.case_id WHERE p.quotation_id=? ORDER BY p.bound_at DESC LIMIT 1').get(quotationId);
  if(!p)return null;
  const contract=db.prepare('SELECT bound_at FROM commercial_contract_proposals WHERE quotation_id=?').get(quotationId);
  return {case_id:p.case_id,deal_ref:String(p.case_id).replace(/-/g,'').slice(0,8).toUpperCase(),deal_name:p.name,deal_status:p.status,contracted:!!contract,contracted_at:contract?.bound_at??null};
}
export function pricingBoard(db,supplied,{mediaInvoice}={}){
  const {u,clients}=pricer(db,supplied),date=today();
  const ids=clients.map(c=>c.id),marks=ids.map(()=>'?').join(','),names=new Map(clients.map(c=>[c.id,c.trade_name||c.legal_name]));
  const policies=db.prepare('SELECT * FROM pricing_policies WHERE tenant_id=? ORDER BY policy_key,revision DESC').all(u.tenant_id).map(r=>policyView(db,u,r));
  const decisions=db.prepare('SELECT * FROM pricing_decisions WHERE tenant_id=? ORDER BY revision DESC').all(u.tenant_id).map(r=>({...r,
    status_name:POLICY_STATUS[r.status],option_name:ISSUER_OPTIONS.find(o=>o.key===r.chosen_option).name,
    prepared_by_name:nameOf(db,r.prepared_by),decided_by_name:nameOf(db,r.decided_by),
    actions:r.status==='draft'&&r.prepared_by!==u.id&&can(db,u,'pricing.exception.approve')?['approve_decision','reject_decision']:[]}));
  const rows=ids.length?db.prepare(`SELECT * FROM pricing_sheets WHERE tenant_id=? AND client_id IN (${marks}) ORDER BY updated_at DESC LIMIT 300`).all(u.tenant_id,...ids):[];
  const sheets=rows.map(r=>sheetView(db,u,r,names.get(r.client_id),date));
  // hold: أرقام اللقطة التي أعلنها الواصف قابلة للحجب تُسقط هنا لمن حجبها عنه تعريف الصفحة — بعد فحوص الوحدة، فالتعريف يطرح ولا يمنح.
  const projectRow=projector(db,u,'client_quotation'),hold=withholder(db,u,'client_quotation');
  const quotations=ids.length?db.prepare(`SELECT * FROM client_quotations WHERE tenant_id=? AND client_id IN (${marks}) ORDER BY updated_at DESC LIMIT 300`).all(u.tenant_id,...ids)
    .map(q=>hold({...quotationView(db,u,q,date,projectRow),client_name:names.get(q.client_id),sheet_code:rows.find(r=>r.id===q.sheet_id)?.code??'',
      issue_clock:issueClock(db,u.tenant_id,rows.find(r=>r.id===q.sheet_id),q)})):[];
  const exceptions=sheets.filter(s=>s.exception).map(s=>({...s.exception,sheet_code:s.code,client_name:s.client_name,
    actions:s.exception.status==='pending'&&s.exception.requested_by!==u.id&&can(db,u,'pricing.exception.approve')?['approve_exception','reject_exception']:[]}));
  const live=Object.fromEntries(POLICY_DEFS.map(p=>[p.key,livePolicy(db,u.tenant_id,p.key)])),decision=liveIssuerDecision(db,u.tenant_id);
  const setup=[...POLICY_DEFS.filter(p=>p.required&&!live[p.key]).map(p=>`لم تُعتمد بعد سياسة: ${p.name}`),!decision&&ISSUER_UNSET].filter(Boolean);
  const connected=typeof mediaInvoice==='function';
  return {today:date,user_id:u.id,currency:'SAR',
    cost_groups:COST_GROUPS,bases:BASES,contract_kinds:CONTRACT_KINDS,reference_kinds:REFERENCE_KINDS,policy_defs:POLICY_DEFS,units:UNITS,
    status_names:SHEET_STATUS,decisions_names:DECISIONS,approval_seats:APPROVAL_SEATS,approval_note:APPROVAL_IS_ELECTRONIC,
    issuer_options:ISSUER_OPTIONS,issuer_decision:decision?{...decision,option_name:ISSUER_OPTIONS.find(o=>o.key===decision.chosen_option).name}:null,issuer_notice:decision?'':ISSUER_UNSET,
    can_decide:can(db,u,'pricing.exception.approve'),
    live_policies:Object.fromEntries(POLICY_DEFS.map(p=>[p.key,live[p.key]?{id:live[p.key].id,unit:p.unit,value_raw:live[p.key].value_raw,
      display:p.unit==='percent'?`${(live[p.key].value_raw/100).toFixed(2)}%`:`${live[p.key].value_raw} ${UNITS[p.unit]}`,
      percent:p.unit==='percent'?(live[p.key].value_raw/100).toFixed(2):null,source_reference:live[p.key].source_reference}:null])),
    // المهلتان تُعرضان منفصلتين بوحدتيهما، ولا يُجمعان في عداد واحد.
    clocks:{quotation_issue:live.quotation_issue_sla_hours?{target:live.quotation_issue_sla_hours.value_raw,unit:'hours',source:live.quotation_issue_sla_hours.source_reference}:null,
      finance_verification:live.finance_verification_sla_days?{target:live.finance_verification_sla_days.value_raw,unit:'working_days',source:live.finance_verification_sla_days.source_reference}:null,
      note:TWO_CLOCKS},
    double_count_checked:connected,
    double_count_notice:connected?'كل بند إعلانات ممولة يحمل مرجعًا يُفحص عند الحفظ: إن كان الصرف نفسه يصل فاتورةَ مورد رُفض الحفظ بدل أن يُحتسب مرتين.':DOUBLE_COUNT_UNCHECKED,
    setup_needed:setup,
    clients:clients.map(c=>({id:c.id,name:names.get(c.id),sector:c.sector??'',
      live_card:(card=>card?{id:card.id,name:card.name,effective_from:card.effective_from,own:!!card.client_id}:null)(liveCard(db,u.tenant_id,c.id,date)),
      opportunities:db.prepare("SELECT id,name FROM opportunities WHERE client_id=? AND tenant_id=? AND status='open' ORDER BY name").all(c.id,u.tenant_id)})),
    team:db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role IN ('employee','manager','pm') ORDER BY name").all(u.tenant_id),
    // أعمدة القائمة التي نشرها تعريف الصفحة لعروض الأسعار، محجوبةً لهذا القارئ: تُرسم بها القائمة ومرشحاتها.
    policies,decisions,sheets,exceptions,quotations,custom_columns:columnsFor(db,u,'client_quotation'),
    awaiting_me:[...sheets.filter(s=>s.actions.includes('decide_sheet')).map(s=>({id:s.id,kind:'sheet',
        title:`ورقة تسعير ${s.code} — ${s.client_name} · مقعد ${s.approval_seats.filter(x=>x.mine_to_decide).map(x=>x.name).join('، ')}`,created_at:s.submitted_at,actions:['decide_sheet']})),
      ...exceptions.filter(x=>x.actions.includes('approve_exception')).map(x=>({id:x.id,kind:'exception',title:`استثناء تسعير ${x.code} — ${x.client_name} · ${(x.requested_margin_bp/100).toFixed(2)}% بدل ${(x.policy_margin_bp/100).toFixed(2)}%`,created_at:x.requested_at,actions:['approve_exception']})),
      ...policies.filter(p=>p.actions.includes('approve_policy')).map(p=>({id:p.id,kind:'policy',title:`سياسة تسعير: ${p.policy_name} ${p.display}`,created_at:p.created_at,actions:['approve_policy']})),
      ...decisions.filter(d=>d.actions.includes('approve_decision')).map(d=>({id:d.id,kind:'decision',title:`قرار جهة إصدار عرض السعر: ${d.option_name}`,created_at:d.created_at,actions:['approve_decision']}))],
    note:'التسعير يتبع MOD-BD-02 حرفيًا: بنود التكلفة في خمس مجموعات، ثم احتياطي طوارئ إلزامي، ثم سعر بيع مشتق من هامش الربح المستهدف. '
      +'النسب والمهل كلها سياسة معتمدة بسندها لا رقم في الكود. هامش الربح غير هامش الربح على التكلفة، والخصم والرسوم الإدارية والضريبة خارج الهامش ولكلٍّ حسابه المعروض. '
      +'وهامش فعلي دون المستهدف يوجب MOD-BD-03 من الرئيس التنفيذي قبل إرسال العرض. '+APPROVAL_IS_ELECTRONIC};
}

/* ───── واصف الكيان في سجل التعريفات (ترحيل 123) ───── */
// خمسة عشر سطرًا تجعل عرض السعر قابلًا للإعداد من «تعديل هذه الصفحة»: حقول مخصّصة، وتسميات، وعبارات حالات، وإلزام عند
// الانتقال، وأعمدة، وحجب. الحالات والانتقالات نفسها تبقى كودًا: وراء كل انتقال قرار مالك وصلاحية وزناد نهائية، فلا تُضاف
// ولا تُحذف من المحرّر. كل انتقال يمر من quotationAction، ومنفّذه يحمل pricing.sheets.use دائمًا (permitted)، والإصدار يلزمه فوق
// ذلك تصريح جهة الإصدار بقرار المالك.
const SNAPSHOT_FIGURES=['groups','direct_total_minor','contingency_rate_bp','contingency_minor','total_cost_minor','target_margin_bp','minimum_margin_bp','actual_margin_bp','net_margin_bp','markup_bp','formulas'];
const currentSnapshot=(db,q)=>{const r=q.current_version_id?db.prepare('SELECT valid_until,snapshot FROM quotation_versions WHERE id=?').get(q.current_version_id):null;return r?{valid_until:r.valid_until,...JSON.parse(r.snapshot)}:null;};
registerEntity({key:'client_quotation',table:'client_quotations',label:{ar:'عرض السعر',en:'Quotation'},views:['quotations'],
  working_capability:'pricing.sheets.use',owner:'معدّ العرض — حامل تصريح تسعير المشاريع',owner_role:'pm',
  statuses:QUOTATION_STATUS,final_statuses:['accepted','rejected'],
  transitions:{issue:{label:'إصدار العرض للعميل',capability:'pricing.sheets.use'},revise:{label:'نسخة جديدة من العرض',capability:'pricing.sheets.use'},
    accept:{label:'تسجيل قبول العميل',capability:'pricing.sheets.use'},reject:{label:'تسجيل رفض العميل',capability:'pricing.sheets.use'}},
  system_fields:[{key:'code',label:'رقم العرض',label_en:'Quotation no.'},{key:'client_id',label:'العميل',label_en:'Client',ref:'client'},
    {key:'sheet_code',label:'ورقة التسعير',label_en:'Pricing sheet'},{key:'status',label:'الحالة',label_en:'Status',type:'status'},
    {key:'valid_until',label:'صالح حتى',label_en:'Valid until',type:'date'},{key:'net_pre_tax',label:'صافي السعر قبل الضريبة',label_en:'Net price before VAT',type:'number'},
    {key:'grand_total',label:'الإجمالي شامل الضريبة',label_en:'Total incl. VAT',type:'number'}],
  // التكلفة والهامش والمعادلات مفتاح واحد عمدًا: كلٌّ منها يُستنتج من الآخرَين ومن سعر البيع، فحجب أحدها وحده حجب على الورق.
  maskable:[{key:'cost_margin',label:'التكلفة والاحتياطي وهامش الربح والمعادلات في لقطة العرض',
    paths:SNAPSHOT_FIGURES.flatMap(f=>[`current.snapshot.${f}`,`versions[].snapshot.${f}`])}],
  slots:['header','body'],slot_names:{header:'ترويسة بطاقة العرض',body:'متن بطاقة العرض'},
  code:q=>q.code,link:q=>`#quotations?focus=${q.id}`,
  is_final:q=>['accepted','rejected'].includes(q.status),finalised_at:q=>q.outcome_recorded_at,
  readable:(db,u)=>can(db,u,'pricing.sheets.use',u.department_id),
  // التفويض على مستوى السجل هو تفويض الوحدة نفسه: تصريح التسعير ثم عزل فريق حساب العميل.
  load:(db,u,quotationId)=>quotationRow(db,u,quotationId).q,
  list(db,supplied){const {u,clients}=pricer(db,supplied),ids=clients.map(c=>c.id);
    return ids.length?db.prepare(`SELECT * FROM client_quotations WHERE tenant_id=? AND client_id IN (${ids.map(()=>'?').join(',')}) ORDER BY code`).all(u.tenant_id,...ids):[];},
  columns:[{key:'code',label:'رقم العرض',value:q=>q.code},
    {key:'client_id',label:'العميل',value:(q,db)=>(c=>c?c.trade_name||c.legal_name:'')(db.prepare('SELECT legal_name,trade_name FROM clients WHERE id=?').get(q.client_id))},
    {key:'sheet_code',label:'ورقة التسعير',value:(q,db)=>db.prepare('SELECT code FROM pricing_sheets WHERE id=?').get(q.sheet_id)?.code??''},
    {key:'status',label:'الحالة',value:(q,db,u)=>statusLabel(db,u.tenant_id,'client_quotation',q.status,QUOTATION_STATUS[q.status])},
    {key:'valid_until',label:'صالح حتى',value:(q,db)=>currentSnapshot(db,q)?.valid_until??''},
    {key:'net_pre_tax',label:'صافي السعر قبل الضريبة',value:(q,db)=>(s=>s?Number(decimal(s.net_pre_tax_minor)):'')(currentSnapshot(db,q))},
    {key:'grand_total',label:'الإجمالي شامل الضريبة',value:(q,db)=>(s=>s?Number(decimal(s.grand_total_minor)):'')(currentSnapshot(db,q))}]});
