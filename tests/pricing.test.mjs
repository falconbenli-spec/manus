import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { preparePriceCard, priceCardAction } from '../app/estimates.mjs';
import { computePricing, checkDoubleCount, preparePolicy, policyAction, prepareIssuerDecision, issuerDecisionAction,
  saveSheet, sheetAction, requestMarginException, marginExceptionAction, createQuotation, quotationAction,
  quotationRecord, pricingBoard, APPROVAL_SEATS } from '../app/pricing.mjs';

// بيانات تجريبية مصطنعة بالكامل. المرجع: docs/product/workflow/SOURCE-APPENDIX.md §3 (MOD-BD-02) و§4 (التعارضان 1 و9) و§5 (اختبار القبول 4).
// لا طباعة ولا توقيع مصوَّر في أي اختبار هنا: تواقيع النموذج الأربعة مقاعد اعتماد إلكترونية في سلسلة التدقيق.
const code=value=>error=>error.code===value;
const caught=fn=>{try{fn();}catch(error){return error;}throw new Error('لم يُرفض ما كان يجب رفضه');};
const riyadh=(offset=0)=>new Date(Date.now()+3*3600000+offset*86400000).toISOString().slice(0,10);
const HEAD={contract_kind:'one_off',duration_note:'ثمانية أسابيع',proposed_pm_id:'',review_notes:'',
  vat_rate:'15',vat_basis:'نسبة ضريبة القيمة المضافة النظامية كما أدخلها المستخدم بمرجعها'};
// اختبار القبول 4: تكلفة مباشرة 100,000 موزعة على بنود التكلفة الخمسة في النموذج.
const OWNER_LINES=[
  {cost_group:'internal_team',description:'رواتب الفريق الداخلي المحمّلة على المشروع',basis:'hours',quantity:'100',unit_price:'500.00'},
  {cost_group:'external_production',description:'إنتاج فيديو خارجي',basis:'quantity',quantity:'1',unit_price:'30000.00'},
  {cost_group:'paid_media',description:'ميزانية إعلانات ممولة',basis:'quantity',quantity:'1',unit_price:'10000.00'},
  {cost_group:'operations',description:'تكاليف تشغيلية',basis:'quantity',quantity:'1',unit_price:'5000.00'},
  {cost_group:'subscriptions_software',description:'اشتراكات وبرامج خاصة بالمشروع',basis:'quantity',quantity:'1',unit_price:'5000.00'}
].map(l=>({...l,cost_reference_kind:'',cost_reference_id:'',note:''}));

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-pricing');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>{
    for(const [user,capability,department] of [
      // من يُعدّ الأسعار: المشتريات، بتصريح التسعير وتصريح المشتريات معًا.
      ['employee','pricing.sheets.use','creative'],['employee','clients.manage',''],['employee','commercial.use','creative'],['employee','procurement.use','creative'],
      // مقعدا «الإدارة الطالبة» و«المشتريات/المالية».
      ['outsider','pricing.sheets.use','creative'],['outsider','finance.use','creative'],
      // مقعدا EPMO ونائب الرئيس التنفيذي، والرئيس التنفيذي صاحب MOD-BD-03 وسياسات التسعير.
      ['manager','pricing.sheets.use','creative'],['manager','commercial.use','creative'],
      ['manager','pricing.epmo.approve','creative'],['manager','pricing.vp.approve',''],['manager','pricing.exception.approve','']])
      grantAccess(db,users.admin,{user_id:user,capability,department_id:department,note:'منح تجريبي'});
  });
  const client=tx(()=>createClient(db,users.employee,{legal_name:'شركة تجريبية للتجزئة',sector:'التجزئة',status:'prospect'})).id;
  for(const member of ['manager','outsider'])tx(()=>clientAction(db,users.employee,client,'add_member',{user_id:member,role:'عضو الفريق التجريبي'}));

  const policyVersion=pid=>db.prepare('SELECT version FROM pricing_policies WHERE id=?').get(pid).version;
  const policy=(key,value,by=users.employee)=>tx(()=>preparePolicy(db,by,{policy_key:key,
    percent:typeof value==='string'?value:'',duration:typeof value==='number'?value:null,
    source_reference:`نموذج تسعير المشروع MOD-BD-02 المعتمد في الشركة — حقل ${key}`,
    basis:'الرقم منصوص عليه في النموذج الذي تستخدمه الشركة اليوم',effective_from:riyadh(-1)})).id;
  const approvePolicy=(pid,by=users.manager)=>tx(()=>policyAction(db,by,pid,'approve_policy',{version:policyVersion(pid),note:'اعتماد الرقم كما في النموذج'}));
  const policies=({contingency='10',target='20'}={})=>{approvePolicy(policy('contingency_rate',contingency));approvePolicy(policy('target_margin',target));};

  const card=(price='300.00',from=riyadh(-1))=>{
    const cardId=tx(()=>preparePriceCard(db,users.employee,{client_id:'',name:`بطاقة الأسعار العامة ${from}`,effective_from:from,
      source:'قرار التسعير الداخلي التجريبي ومرجعه المحفوظ',lines:[{kind:'role',name:'مصمم',category_code:'',price}]})).id;
    tx(()=>priceCardAction(db,users.manager,cardId,'approve_card',{version:db.prepare('SELECT version FROM price_cards WHERE id=?').get(cardId).version,note:'اعتماد تجريبي'}));
    return cardId;
  };
  const sheetVersion=sid=>db.prepare('SELECT version FROM pricing_sheets WHERE id=?').get(sid).version;
  const sheet=(lines=OWNER_LINES,extra={},options={})=>tx(()=>saveSheet(db,users.employee,{client_id:client,opportunity_id:'',
    name:'مشروع تجريبي',scope_note:'نطاق تجريبي مكتوب بما يكفي من التفصيل',discount:'',discount_basis:'',admin_fee_percent:'',admin_fee_basis:'',
    ...HEAD,...extra,lines},options)).id;
  // المقاعد الأربعة: «الإدارة الطالبة» و«المشتريات/المالية» لحساب، وEPMO ونائب الرئيس لآخر. لا يقرر أيها من أعدّ الورقة.
  const seatHolder={requesting_department:users.outsider,procurement_finance:users.outsider,epmo:users.manager,vp_corporate_services:users.manager};
  const decide=(sid,seat,decision='approved',note='راجعت البنود والنسب واعتمدت')=>tx(()=>sheetAction(db,seatHolder[seat],sid,'decide',{version:sheetVersion(sid),seat,decision,note}));
  const approveSheet=sid=>{
    tx(()=>sheetAction(db,users.employee,sid,'submit',{version:sheetVersion(sid)}));
    for(const seat of APPROVAL_SEATS.map(s=>s.key))decide(sid,seat);
    return sid;
  };
  const decideIssuer=(option='procurement')=>{
    const decisionId=tx(()=>prepareIssuerDecision(db,users.employee,{chosen_option:option,basis:'قرار المالك بعد عرض القراءتين المتعارضتين عليه'})).id;
    tx(()=>issuerDecisionAction(db,users.manager,decisionId,'approve_decision',{version:db.prepare('SELECT version FROM pricing_decisions WHERE id=?').get(decisionId).version,note:'حسم القرار'}));
    return decisionId;
  };
  const quoteVersion=qid=>db.prepare('SELECT version FROM client_quotations WHERE id=?').get(qid).version;
  const quote=(sid,valid=riyadh(30))=>tx(()=>createQuotation(db,users.employee,sid,{valid_until:valid,note:''})).id;
  const board=(by=users.employee)=>pricingBoard(db,by);
  return {db,users,tx,client,policy,approvePolicy,policies,card,sheet,sheetVersion,decide,approveSheet,decideIssuer,quote,quoteVersion,board};
}

test('pricing: the company’s own worked example — 100,000 direct becomes 110,000 with the mandatory contingency and sells for 137,500 before VAT at a 20% margin',t=>{
  const {db,users,tx,policies,card,sheet,approveSheet,board}=fixture(t);
  policies();card();
  const sheetId=approveSheet(sheet());
  const view=board().sheets.find(s=>s.id===sheetId),totals=view.totals;
  assert.equal(totals.direct_total_minor,10000000,'إجمالي التكاليف المباشرة مئة ألف ريال');
  assert.equal(totals.contingency_rate_bp,1000,'احتياطي الطوارئ عشرة بالمئة من السياسة المعتمدة لا من الكود');
  assert.equal(totals.contingency_minor,1000000,'الاحتياطي عشرة آلاف');
  assert.equal(totals.total_cost_minor,11000000,'إجمالي التكاليف الكلية مئة وعشرة آلاف');
  assert.equal(totals.target_margin_bp,2000);
  assert.equal(totals.sale_price_pre_tax_minor,13750000,'سعر البيع قبل الضريبة مئة وسبعة وثلاثون ألفًا وخمسمئة');
  assert.equal(totals.actual_margin_bp,2000,'هامش الربح الفعلي يطابق المستهدف تمامًا حين لا خصم');
  assert.equal(totals.margin_minor,2750000,'هامش الربح الفعلي بالريال كما في النموذج');
  assert.equal(totals.vat_minor,2062500);
  assert.equal(totals.grand_total_minor,15812500);
  assert.equal(totals.below_target,false);
  // بنود التكلفة الخمسة كلها معروضة، ولو كانت إحداها فارغة، فلا تُقرأ المجموعة الغائبة كأنها صفر منسي.
  assert.deepEqual(totals.groups.map(g=>g.name),['رواتب الفريق الداخلي','تكاليف إنتاج خارجي','ميزانية إعلانات ممولة','تكاليف تشغيلية','اشتراكات وبرامج خاصة بالمشروع']);
  assert.deepEqual(totals.groups.map(g=>g.amount_minor),[5000000,3000000,1000000,500000,500000]);
  assert.ok(totals.formulas.some(f=>f.key==='sale_price'&&f.expression.includes('137500.00')),'المعادلة تُعرض بأرقامها لا نتيجتها وحدها');
  // «الحد الأدنى المقبول» حقل في النموذج بلا قيمة في المصدر: يبقى فارغًا ولا يُخترع له رقم.
  assert.equal(totals.minimum_margin_bp,null);
  assert.equal(totals.below_minimum,null);
  assert.ok(view.minimum_margin_notice.includes('بلا قيمة في المصدر'));
  assert.ok(verifyAudit(db));
});

test('pricing: the four signatures at the foot of the form are four electronic approval seats, each an identity event, with no printable copy',t=>{
  const {db,users,tx,policies,card,sheet,sheetVersion,decide,board}=fixture(t);
  policies();card();
  const sheetId=sheet();
  assert.deepEqual(board().approval_seats.map(s=>s.name),['الإدارة الطالبة','المشتريات/المالية','فريق EPMO','نائب الرئيس التنفيذي للخدمات المؤسسية']);
  tx(()=>sheetAction(db,users.employee,sheetId,'submit',{version:sheetVersion(sheetId)}));
  // من أعدّ الورقة لا يملأ أي مقعد، ولا يملأ مقعدًا من لا يحمل تصريحه.
  assert.throws(()=>tx(()=>sheetAction(db,users.employee,sheetId,'decide',{version:sheetVersion(sheetId),seat:'epmo',decision:'approved',note:'اعتماد ذاتي'})),code('action_unavailable'));
  assert.throws(()=>tx(()=>sheetAction(db,users.outsider,sheetId,'decide',{version:sheetVersion(sheetId),seat:'epmo',decision:'approved',note:'بلا تصريح المقعد'})),code('seat_scope'));
  decide(sheetId,'requesting_department');
  assert.equal(board().sheets.find(s=>s.id===sheetId).status,'submitted','مقعد واحد لا يكفي: الورقة تبقى بانتظار البقية');
  assert.deepEqual(board().sheets.find(s=>s.id===sheetId).approvals_outstanding,['المشتريات/المالية','فريق EPMO','نائب الرئيس التنفيذي للخدمات المؤسسية']);
  assert.throws(()=>tx(()=>sheetAction(db,users.outsider,sheetId,'decide',{version:sheetVersion(sheetId),seat:'requesting_department',decision:'approved',note:'قرار مكرر'})),code('seat_scope'));
  // القرار ثلاثي كما في النموذج: «يحتاج تعديل» يعيد الورقة مسودةً ويفتح جولة جديدة، وقرار الجولة السابقة يبقى.
  decide(sheetId,'procurement_finance','returned','التكاليف التشغيلية تحتاج تفصيلًا قبل الاعتماد المالي');
  const returned=board().sheets.find(s=>s.id===sheetId);
  assert.equal(returned.status,'draft');
  assert.equal(returned.approval_round,2);
  assert.equal(returned.approval_history.length,2,'قرارات الجولة الأولى محفوظة كما كُتبت');
  assert.deepEqual(returned.approval_seats.map(s=>s.decision),[null,null,null,null],'الجولة الجديدة تبدأ بمقاعد فارغة');
  assert.equal(returned.review_notes,'التكاليف التشغيلية تحتاج تفصيلًا قبل الاعتماد المالي');
  tx(()=>sheetAction(db,users.employee,sheetId,'submit',{version:sheetVersion(sheetId)}));
  for(const seat of ['requesting_department','procurement_finance','epmo'])decide(sheetId,seat);
  assert.equal(board().sheets.find(s=>s.id===sheetId).status,'submitted');
  decide(sheetId,'vp_corporate_services');
  const approved=board().sheets.find(s=>s.id===sheetId);
  assert.equal(approved.status,'approved','الورقة تُعتمد حين يكتمل المقاعد الأربعة في جولة واحدة');
  assert.ok(approved.approval_seats.every(s=>s.decided_by&&s.decided_at&&s.capability),'كل مقعد حدث هوية: من قرر وبأي تصريح ومتى');
  // لا توقيع مصوَّر ولا نسخة للطباعة في أي مكان من السجل.
  const quoteId=tx(()=>createQuotation(db,users.employee,sheetId,{valid_until:riyadh(30),note:''})).id;
  const record=quotationRecord(db,users.employee,quoteId);
  assert.equal(record.printable,false);
  assert.equal(record.record_kind,'electronic');
  assert.equal(record.approval_trail.filter(e=>e.step.includes('EPMO')||e.step.includes('نائب الرئيس')||e.step.includes('الإدارة الطالبة')||e.step.includes('المشتريات/المالية')).length,4);
  assert.ok(record.note.includes('لا توقيع مصوَّر ولا سطر توقيع'),'السجل يقول صراحة إنه بلا توقيع مصوَّر');
  assert.ok(!/signature|توقيع_|sign_here/i.test(JSON.stringify(Object.keys(record))),'لا حقل توقيع في السجل');
  assert.throws(()=>db.prepare('UPDATE pricing_sheet_approvals SET decision=? WHERE sheet_id=?').run('rejected',sheetId),/not rewritten/);
  assert.ok(verifyAudit(db));
});

test('pricing: margin is never mark-up — the same numbers give 20% on the price and 25% on the cost, and both are shown with their own formula',t=>{
  const totals=computePricing([{cost_group:'internal_team',basis:'hours',quantity_centi:10000,unit_price_minor:100000}],
    {contingency_rate_bp:1000,target_margin_bp:2000,minimum_margin_bp:null,discount_minor:0,admin_fee_bp:0,vat_rate_bp:1500});
  assert.equal(totals.total_cost_minor,11000000);
  assert.equal(totals.sale_price_pre_tax_minor,13750000);
  assert.equal(totals.actual_margin_bp,2000,'هامش الربح مقسوم على سعر البيع');
  assert.equal(totals.markup_bp,2500,'هامش الربح على التكلفة مقسوم على التكلفة، ولا يساوي هامش الربح أبدًا');
  assert.notEqual(totals.actual_margin_bp,totals.markup_bp);
  // لو حُسب السعر بزيادة 20% على التكلفة (mark-up) لكان 132,000 لا 137,500 — فرق 5,500 على مشروع واحد.
  assert.equal(totals.sale_price_pre_tax_minor-13200000,550000);
  const margin=totals.formulas.find(f=>f.key==='margin'),markup=totals.formulas.find(f=>f.key==='markup');
  assert.ok(margin.expression.includes('÷ 137500.00')&&markup.expression.includes('÷ 110000.00'),'كل معادلة تُظهر مقامها');
  assert.ok(markup.label.includes('ليس هامش الربح'));
  assert.ok(totals.margin_note.includes('لا يُستبدل أحدهما بالآخر'));
});

test('pricing: a margin of 100% or more, a zero cost and an over-reaching discount are refused instead of dividing by zero',t=>{
  const {db,tx,policy,policies,card,sheet}=fixture(t);
  const line=[{cost_group:'internal_team',basis:'hours',quantity_centi:10000,unit_price_minor:100000}];
  const base={contingency_rate_bp:1000,target_margin_bp:2000,minimum_margin_bp:null,discount_minor:0,admin_fee_bp:0,vat_rate_bp:0};
  assert.throws(()=>computePricing(line,{...base,target_margin_bp:10000}),code('impossible_margin'));
  assert.throws(()=>computePricing(line,{...base,target_margin_bp:12000}),code('invalid_rate'),'نسبة فوق 100% ليست نسبة أصلًا');
  assert.throws(()=>computePricing([],base),code('lines'));
  assert.throws(()=>computePricing([{cost_group:'internal_team',basis:'hours',quantity_centi:0,unit_price_minor:100000}],base),code('lines'),'كمية صفرية لا تصنع تكلفة صفرية صامتة');
  // خصم يبلغ سعر البيع يترك عرضًا بقيمة صفر: يُرفض قبل أن تُقسم نسبة الهامش على صفر.
  assert.throws(()=>computePricing(line,{...base,discount_minor:13750000}),code('discount'));
  assert.throws(()=>policy('target_margin','100'),code('impossible_margin'),'السياسة نفسها لا تقبل هامشًا مستحيلًا');
  assert.throws(()=>db.prepare("INSERT INTO pricing_policies(id,tenant_id,policy_key,revision,value_unit,value_raw,source_reference,basis,effective_from,status,prepared_by,created_at,updated_at) VALUES('x','36t','target_margin',9,'percent',10000,'نموذج التسعير MOD-BD-02','أساس مكتوب بطول كاف','2026-01-01','draft','employee','t','t')").run(),
    /CHECK constraint/,'قاعدة البيانات ترفض هامش 100% ولو تجاوزته الشيفرة');
  policies();card();
  assert.throws(()=>sheet(OWNER_LINES,{discount:'200000.00',discount_basis:'خصم تجريبي مبالغ فيه'}),code('discount'));
  assert.ok(verifyAudit(db));
});

test('pricing: the 10% and the 20% are approved policy with their source, not numbers in the code, and the person who wrote them does not approve them',t=>{
  const {db,users,policy,approvePolicy,card,sheet,board}=fixture(t);
  card();
  const empty=board();
  assert.equal(empty.live_policies.contingency_rate,null);
  assert.equal(empty.live_policies.target_margin,null);
  assert.equal(empty.setup_needed.length,3,'نسبتان إلزاميتان وقرار جهة الإصدار: ثلاثة نواقص معلنة قبل أول تسعيرة');
  assert.throws(()=>sheet(),code('policy_required'),'لا تسعير قبل اعتماد النسب: لا رقم افتراضي في الكود');
  const contingency=policy('contingency_rate','10');
  assert.throws(()=>approvePolicy(contingency,users.employee),code('self_approval'));
  // حامل تصريح التسعير وحده لا يكفي: النسب سياسة شركة يعتمدها الرئيس التنفيذي.
  assert.throws(()=>approvePolicy(contingency,users.outsider),code('not_permitted'));
  approvePolicy(contingency);
  approvePolicy(policy('target_margin','20'));
  const ready=board();
  assert.equal(ready.live_policies.contingency_rate.percent,'10.00');
  assert.equal(ready.live_policies.target_margin.percent,'20.00');
  assert.ok(ready.live_policies.target_margin.source_reference.includes('MOD-BD-02'),'كل نسبة تحمل سند النموذج');
  assert.throws(()=>db.prepare('UPDATE pricing_policies SET value_raw=3000,version=version+1 WHERE id=?').run(contingency),/replaced by a new revision/);
  // النسبة الجديدة نسخة جديدة تسحب السابقة عند اعتمادها، والورقة المحفوظة تحتفظ بلقطتها.
  const sheetId=sheet();
  approvePolicy(policy('contingency_rate','15'));
  assert.equal(board().live_policies.contingency_rate.percent,'15.00');
  assert.equal(board().sheets.find(s=>s.id===sheetId).totals.contingency_rate_bp,1000,'تغيّر السياسة بعد الحفظ لا يغيّر رقمًا في ورقة قائمة');
  assert.deepEqual(db.prepare("SELECT status FROM pricing_policies WHERE policy_key='contingency_rate' ORDER BY revision").all().map(r=>r.status),['retired','approved']);
  assert.ok(verifyAudit(db));
});

test('pricing: the quotation clock and the finance verification clock stay two separate clocks in their own units',t=>{
  const {db,users,tx,policy,approvePolicy,policies,card,sheet,approveSheet,decideIssuer,quote,quoteVersion,board}=fixture(t);
  policies();card();decideIssuer('procurement');
  // لا مهلة مفترضة: العداد يقيس ولا يحكم قبل اعتماد سياستها.
  const sheetId=approveSheet(sheet());
  const quoteId=quote(sheetId);
  assert.equal(board().clocks.quotation_issue,null);
  assert.equal(board().quotations.find(q=>q.id===quoteId).issue_clock.target_hours,null);
  approvePolicy(policy('quotation_issue_sla_hours',2));
  approvePolicy(policy('finance_verification_sla_days',1));
  const clocks=board().clocks;
  assert.deepEqual([clocks.quotation_issue.target,clocks.quotation_issue.unit],[2,'hours']);
  assert.deepEqual([clocks.finance_verification.target,clocks.finance_verification.unit],[1,'working_days'],'مهلة التحقق المالي بأيام العمل، لا تُحوَّل إلى ساعات');
  assert.ok(clocks.note.includes('ساعتان ليستا يوم عمل'));
  tx(()=>quotationAction(db,users.employee,quoteId,'issue',{version:quoteVersion(quoteId),note:''}));
  const clock=board().quotations.find(q=>q.id===quoteId).issue_clock;
  assert.equal(clock.clock,'quotation_issue');
  assert.equal(clock.unit,'hours');
  assert.equal(clock.target_hours,2);
  assert.ok(clock.requirements_complete_at&&clock.issued_at,'العداد يبدأ من اكتمال المتطلبات لا من إنشاء الورقة');
  assert.equal(clock.within_target,true);
  assert.ok(verifyAudit(db));
});

test('pricing: a discount that pushes the margin under the target blocks the quotation until the CEO approves a pricing exception',t=>{
  const {db,users,tx,policies,card,sheet,approveSheet,decideIssuer,quote,quoteVersion,board}=fixture(t);
  policies();card();decideIssuer('procurement');
  // خصم 15,000 على سعر 137,500 يترك 122,500 مقابل تكلفة 110,000 — هامش 10.20% دون العشرين.
  const sheetId=approveSheet(sheet(OWNER_LINES,{discount:'15000.00',discount_basis:'خصم تفاوضي وافق عليه مدير الحساب بمرجعه'}));
  const view=board().sheets.find(s=>s.id===sheetId);
  assert.equal(view.totals.net_pre_tax_minor,12250000);
  assert.equal(view.totals.net_margin_bp,1020);
  assert.equal(view.totals.below_target,true);
  assert.equal(view.totals.shortfall_bp,980);
  assert.equal(view.exception_satisfied,false);
  assert.ok(view.actions.includes('request_exception'));
  assert.ok(view.totals.status_name.includes('MOD-BD-03'));
  // الخصم يخرج من الهامش ولا يُضاف إلى التكلفة: التكلفة لم تتغير.
  assert.equal(view.totals.total_cost_minor,11000000);

  const quoteId=quote(sheetId);
  assert.throws(()=>tx(()=>quotationAction(db,users.employee,quoteId,'issue',{version:quoteVersion(quoteId),note:''})),code('margin_exception_required'));
  const exceptionId=tx(()=>requestMarginException(db,users.employee,sheetId,{justification:'عميل استراتيجي وأول مشروع معه، والخصم يفتح باقة سنوية لاحقة',
    applies_to:'هذه الورقة وحدها ولا يسري على تجديد أو نطاق إضافي',attachments:['محضر اجتماع التفاوض المحفوظ في ملف العميل'],expires_on:riyadh(45)})).id;
  const raised=board().exceptions.find(x=>x.id===exceptionId);
  assert.equal(raised.requested_margin_bp,1020,'الهامش المطلوب');
  assert.equal(raised.policy_margin_bp,2000);
  assert.equal(raised.value_impact_minor,1500000,'أثر القيمة يُحسب: ما تنازلت عنه الشركة بالريال');
  assert.equal(raised.status,'pending');
  assert.equal(raised.expires_on,riyadh(45),'تاريخ انتهاء الاستثناء');
  assert.deepEqual(raised.attachments,['محضر اجتماع التفاوض المحفوظ في ملف العميل'],'المرفقات');
  assert.ok(raised.applies_to.includes('هذه الورقة وحدها'),'النطاق الذي يسري عليه');
  // الاستثناء ما زال معلقًا: العرض لا يُرسل.
  assert.throws(()=>tx(()=>quotationAction(db,users.employee,quoteId,'issue',{version:quoteVersion(quoteId),note:''})),code('margin_exception_required'));
  const exceptionVersion=()=>db.prepare('SELECT version FROM margin_exceptions WHERE id=?').get(exceptionId).version;
  assert.throws(()=>tx(()=>marginExceptionAction(db,users.employee,exceptionId,'approve_exception',{version:exceptionVersion(),note:'أعتمد طلبي بنفسي'})),code('self_approval'));
  assert.throws(()=>tx(()=>marginExceptionAction(db,users.outsider,exceptionId,'approve_exception',{version:exceptionVersion(),note:'اعتماد من غير صاحب الصلاحية'})),code('not_permitted'),'مقاعد اعتماد الورقة لا تعتمد استثناء التسعير');
  tx(()=>marginExceptionAction(db,users.manager,exceptionId,'approve_exception',{version:exceptionVersion(),note:'أقبل الهامش لهذه الصفقة وحدها وبالمدة المذكورة'}));
  // النسخة التي تُصدر بعد اعتماد الاستثناء تحمل معرّفه؛ النسخة الأولى سبقت الاستثناء فلا تدّعيه.
  tx(()=>quotationAction(db,users.employee,quoteId,'revise',{version:quoteVersion(quoteId),valid_until:riyadh(30),note:'نسخة بعد اعتماد الاستثناء'}));
  const issued=tx(()=>quotationAction(db,users.employee,quoteId,'issue',{version:quoteVersion(quoteId),note:'صدر للعميل'}));
  assert.equal(issued.status,'issued');
  const record=quotationRecord(db,users.employee,quoteId);
  assert.ok(record.approval_trail.some(e=>e.step.includes('MOD-BD-03')&&e.decided_by==='manager'),'قرار الرئيس التنفيذي حدث هوية في سجل العرض');
  const revisions=db.prepare('SELECT margin_exception_id FROM quotation_versions WHERE quotation_id=? ORDER BY revision').all(quoteId);
  assert.equal(revisions[0].margin_exception_id,null);
  assert.equal(revisions[1].margin_exception_id,exceptionId);
  assert.ok(verifyAudit(db));
});

test('pricing: a sheet at or above the target needs no exception, and no exception is accepted for a margin that does not breach the policy',t=>{
  const {db,users,tx,policies,card,sheet,approveSheet,decideIssuer,quote,quoteVersion,board}=fixture(t);
  policies();card();decideIssuer('procurement');
  const sheetId=approveSheet(sheet());
  assert.equal(board().sheets.find(s=>s.id===sheetId).exception_required,false);
  assert.throws(()=>tx(()=>requestMarginException(db,users.employee,sheetId,{justification:'لا مبرر حقيقي، الهامش مطابق للسياسة تمامًا',
    applies_to:'هذه الورقة',attachments:[],expires_on:riyadh(30)})),code('no_exception_needed'));
  const quoteId=quote(sheetId);
  assert.equal(tx(()=>quotationAction(db,users.employee,quoteId,'issue',{version:quoteVersion(quoteId),note:''})).status,'issued');
  assert.ok(verifyAudit(db));
});

test('pricing: nothing is issued to a client until the owner settles who issues the quotation, and the refusal names the conflict',t=>{
  const {db,users,tx,policies,card,sheet,approveSheet,quote,quoteVersion,board}=fixture(t);
  policies();card();
  const sheetId=approveSheet(sheet());
  const before=board();
  assert.equal(before.issuer_decision,null,'لا جهة افتراضية: المنصة لا ترجّح بين المصدرين');
  assert.deepEqual(before.issuer_options.map(o=>o.key),['procurement','finance'],'القراءتان محفوظتان معًا');
  assert.ok(before.issuer_options.every(o=>o.reading.length>20),'كل قراءة بنص مصدرها');
  assert.ok(before.issuer_notice.includes('المشتريات')&&before.issuer_notice.includes('المالية'));
  const quoteId=quote(sheetId);
  const refused=caught(()=>tx(()=>quotationAction(db,users.employee,quoteId,'issue',{version:quoteVersion(quoteId),note:''})));
  assert.equal(refused.code,'issuer_unset');
  assert.ok(refused.message.includes('جهة إصدار عرض السعر'),'الرفض يسمي القرار المطلوب لا «غير متاح»');
  // القرار للمالك وحده، ولا يعتمده من رفعه.
  const decisionId=tx(()=>prepareIssuerDecision(db,users.employee,{chosen_option:'finance',basis:'قرار المالك على قراءة تبويب دورة العميل والمخطط الثاني'})).id;
  const decisionVersion=()=>db.prepare('SELECT version FROM pricing_decisions WHERE id=?').get(decisionId).version;
  assert.throws(()=>tx(()=>issuerDecisionAction(db,users.employee,decisionId,'approve_decision',{version:decisionVersion(),note:'اعتماد ذاتي'})),code('self_approval'));
  tx(()=>issuerDecisionAction(db,users.manager,decisionId,'approve_decision',{version:decisionVersion(),note:'حسم القرار على المالية'}));
  // القرار استقر على المالية: حامل تصريح المشتريات وحده لا يُصدر بعد ذلك.
  assert.throws(()=>tx(()=>quotationAction(db,users.employee,quoteId,'issue',{version:quoteVersion(quoteId),note:''})),code('issuer_role'));
  assert.equal(tx(()=>quotationAction(db,users.outsider,quoteId,'issue',{version:quoteVersion(quoteId),note:''})).issuer_role,'finance');
  assert.equal(quotationRecord(db,users.employee,quoteId).issuer_name,'المالية');
  assert.ok(verifyAudit(db));
});

test('pricing: media spend booked as a project cost is refused when the same spend also arrives as a supplier invoice',t=>{
  const {db,users,policies,card,sheet,board}=fixture(t);
  policies();card();
  const media=(reference,description='ميزانية إعلانات ممولة')=>({cost_group:'paid_media',description,basis:'quantity',quantity:'1',unit_price:'10000.00',
    cost_reference_kind:'media_entry',cost_reference_id:reference,note:''});
  const plain=OWNER_LINES.filter(l=>l.cost_group!=='paid_media');
  // نفس المرجع في بندين من الورقة نفسها: أبسط صور الازدواج، وتُرفض بلا حاجة إلى أي مصدر خارجي.
  assert.throws(()=>sheet([...plain,media('SPEND-1'),media('SPEND-1','إعلانات ممولة مكررة')]),code('double_counted'));
  // المرجع موجود وفاتورة المورد وصلت عنه: الاحتساب مرتين مرفوض، والرسالة تسمي الفاتورة.
  const invoiced=new Set(['SPEND-1']);
  const mediaInvoice=({kind,reference})=>kind==='media_entry'&&invoiced.has(reference)?{conflict:'فاتورة المورد INV-77 من وكالة الشراء الإعلامي'}:null;
  const refused=caught(()=>sheet([...plain,media('SPEND-1')],{},{mediaInvoice}));
  assert.equal(refused.code,'double_counted');
  assert.ok(refused.message.includes('INV-77')&&refused.message.includes('مرتين'));
  // صرف لم يُفوتر: يُقبل تكلفةً مباشرة.
  const sheetId=sheet([...plain,media('SPEND-2')],{},{mediaInvoice});
  assert.equal(board().sheets.find(s=>s.id===sheetId).totals.direct_total_minor,10000000);
  // بلا مصدر موصول لا تُخترع نتيجة: الشاشة تعلن أن التحقق غير موصول بدل أن تدّعي سلامة الرقم.
  assert.equal(board().double_count_checked,false);
  assert.ok(board().double_count_notice.includes('غير موصول'));
  assert.equal(pricingBoard(db,users.employee,{mediaInvoice}).double_count_checked,true);
  assert.deepEqual(checkDoubleCount([{cost_reference_kind:'media_entry',cost_reference_id:'SPEND-2',description:'بند'}],{tenant_id:'36t'},mediaInvoice),{checked:true,references:1,notice:''});
  assert.throws(()=>db.prepare("INSERT INTO pricing_sheet_lines(id,sheet_id,line_no,cost_group,description,basis,quantity_centi,unit_price_minor,amount_minor,cost_reference_kind,cost_reference_id,created_at) VALUES('z',?,99,'paid_media','تكرار مباشر','quantity',100,1000,1000,'media_entry','SPEND-2','t')").run(sheetId),
    /UNIQUE constraint|pricing lines change only/,'قاعدة البيانات ترفض تكرار المرجع في الورقة نفسها');
  assert.ok(verifyAudit(db));
});

test('pricing: a quotation is pinned to the rate-card version it was built on and to its own validity date',t=>{
  const {db,users,tx,policies,card,sheet,approveSheet,decideIssuer,quote,quoteVersion,board}=fixture(t);
  policies();
  // ورقة قبل أي بطاقة معتمدة: لا يُبنى عليها عرض، لأن رقمها لا يُعرف من أي بطاقة جاء.
  const orphan=approveSheet(sheet());
  assert.equal(board().sheets.find(s=>s.id===orphan).price_card,null);
  assert.ok(board().sheets.find(s=>s.id===orphan).rate_card_notice.includes('لا بطاقة أسعار'));
  assert.throws(()=>quote(orphan),code('rate_card_required'));
  const first=card('300.00',riyadh(-2));
  decideIssuer('procurement');
  const sheetId=approveSheet(sheet());
  assert.equal(board().sheets.find(s=>s.id===sheetId).price_card.id,first);
  const quoteId=quote(sheetId,riyadh(20));
  const versionOne=db.prepare('SELECT * FROM quotation_versions WHERE quotation_id=? AND revision=1').get(quoteId);
  assert.equal(versionOne.price_card_id,first);
  assert.equal(versionOne.price_card_effective_from,riyadh(-2));
  assert.equal(versionOne.valid_until,riyadh(20));
  assert.equal(JSON.parse(versionOne.snapshot).price_card_id,first);
  tx(()=>quotationAction(db,users.employee,quoteId,'issue',{version:quoteVersion(quoteId),note:''}));
  // بطاقة أحدث تصدر بعد الإصدار: العرض المرسل يبقى على بطاقته، فلا يتغير سعر قرأه العميل.
  const second=card('450.00',riyadh(0));
  assert.equal(db.prepare('SELECT price_card_id FROM quotation_versions WHERE quotation_id=? AND revision=1').get(quoteId).price_card_id,first);
  assert.notEqual(second,first);
  assert.throws(()=>db.prepare('UPDATE quotation_versions SET price_card_id=? WHERE id=?').run(second,versionOne.id),/not rewritten/);
  // النسخة الجديدة تعيد العرض مسودةً حتى يُصدر ثانية، وتُحفظ إلى جانب سابقتها لا مكانها.
  tx(()=>quotationAction(db,users.employee,quoteId,'revise',{version:quoteVersion(quoteId),valid_until:riyadh(40),note:'مدّدنا الصلاحية'}));
  const view=board().quotations.find(q=>q.id===quoteId);
  assert.equal(view.versions.length,2);
  assert.equal(view.status,'draft');
  assert.equal(view.current.revision,2);
  assert.equal(view.current.valid_until,riyadh(40));
  assert.equal(view.versions[0].valid_until,riyadh(20),'النسخة الأولى تبقى كما صدرت');
  assert.ok(verifyAudit(db));
});

test('pricing: both the win and the loss are kept with their reason, and a quotation with a recorded outcome is final',t=>{
  const {db,users,tx,policies,card,sheet,approveSheet,decideIssuer,quote,quoteVersion,board}=fixture(t);
  policies();card();decideIssuer('procurement');
  const won=quote(approveSheet(sheet()));
  tx(()=>quotationAction(db,users.employee,won,'issue',{version:quoteVersion(won),note:''}));
  assert.throws(()=>tx(()=>quotationAction(db,users.employee,won,'accept',{version:quoteVersion(won),reason:'قصير'})),code('invalid_text'),'لا نتيجة بلا سبب مكتوب');
  tx(()=>quotationAction(db,users.employee,won,'accept',{version:quoteVersion(won),reason:'قبل العميل العرض بعد اجتماع المراجعة وأكد الجدول الزمني'}));
  const lost=quote(approveSheet(sheet()));
  tx(()=>quotationAction(db,users.employee,lost,'issue',{version:quoteVersion(lost),note:''}));
  tx(()=>quotationAction(db,users.employee,lost,'reject',{version:quoteVersion(lost),reason:'اختار العميل عرضًا أقل سعرًا من منافس بنطاق أضيق'}));
  const rows=board().quotations;
  assert.equal(rows.find(q=>q.id===won).outcome,'won');
  assert.equal(rows.find(q=>q.id===lost).outcome,'lost');
  assert.ok(rows.find(q=>q.id===lost).outcome_reason.includes('منافس'));
  assert.deepEqual(rows.find(q=>q.id===lost).actions,[],'العرض المرفوض لا يُعدَّل ولا يُعاد إصداره');
  assert.throws(()=>tx(()=>quotationAction(db,users.employee,lost,'revise',{version:quoteVersion(lost),valid_until:riyadh(10),note:'محاولة إحياء'})),code('action_unavailable'));
  assert.throws(()=>db.prepare('DELETE FROM client_quotations WHERE id=?').run(lost),/retained, won or lost/);
  assert.ok(verifyAudit(db));
});

test('pricing: VAT, the discount and the administrative fee are three separate computations outside the margin, and money is rounded half-up on integers',t=>{
  const totals=computePricing([{cost_group:'operations',basis:'quantity',quantity_centi:300,unit_price_minor:3333}],
    {contingency_rate_bp:1000,target_margin_bp:2000,minimum_margin_bp:null,discount_minor:100,admin_fee_bp:250,vat_rate_bp:1500});
  // 3.00 × 33.33 = 99.99 → 9999 هللة بلا كسر عائم.
  assert.equal(totals.direct_total_minor,9999);
  assert.equal(totals.contingency_minor,1000,'999.9 هللة تُقرَّب نصفًا لأعلى إلى 1000');
  assert.equal(totals.total_cost_minor,10999);
  assert.equal(totals.sale_price_pre_tax_minor,13749,'13748.75 تُقرَّب نصفًا لأعلى');
  assert.equal(totals.net_pre_tax_minor,13649);
  assert.equal(totals.admin_fee_minor,341,'341.225 تُقرَّب إلى 341');
  assert.equal(totals.taxable_base_minor,13990);
  assert.equal(totals.vat_minor,2099,'2098.5 تُقرَّب نصفًا لأعلى إلى 2099');
  assert.equal(totals.grand_total_minor,16089);
  // الهامش لا يعرف الرسوم ولا الضريبة: مقامه صافي السعر وحده.
  assert.equal(totals.net_margin_bp,Math.round((13649-10999)*10000/13649));
  assert.ok(totals.formulas.find(f=>f.key==='admin_fee').label.includes('خارج الهامش'));
  assert.ok(totals.formulas.find(f=>f.key==='vat').label.includes('خارج الهامش'));
  assert.ok(totals.formulas.find(f=>f.key==='discount').label.includes('يخرج من الهامش'));
  assert.equal(Number.isInteger(totals.grand_total_minor),true,'كل مبلغ عدد صحيح بالهللات');
});

test('pricing: the sheet is isolated to the client team, decided once, and never edited after a decision',t=>{
  const {db,users,tx,policies,card,sheet,sheetVersion,decide,approveSheet,board}=fixture(t);
  policies();card();
  const sheetId=sheet();
  assert.deepEqual(board().sheets.find(s=>s.id===sheetId).actions,['edit_sheet','submit_sheet']);
  assert.deepEqual(board(users.outsider).sheets.find(s=>s.id===sheetId).actions,[],'غير معدّ المسودة لا يعدلها');
  assert.throws(()=>pricingBoard(db,users.it),code('forbidden'),'من ليس في فرق التشغيل لا يرى الشاشة');
  assert.throws(()=>pricingBoard(db,users.external),code('not_permitted'),'حساب كيان آخر لا يصل إلى الشاشة ولا إلى أوراقها');
  tx(()=>sheetAction(db,users.employee,sheetId,'submit',{version:sheetVersion(sheetId)}));
  // رفض من أي مقعد يُنهي الورقة: التصحيح ورقة جديدة.
  decide(sheetId,'requesting_department','rejected','النطاق لا يطابق ما اتفق عليه مع العميل، والورقة تُعاد من جديد');
  assert.equal(board().sheets.find(s=>s.id===sheetId).status,'rejected');
  assert.throws(()=>tx(()=>sheetAction(db,users.employee,sheetId,'edit',{version:sheetVersion(sheetId),name:'محاولة تعديل بعد القرار',
    scope_note:'نطاق تجريبي مكتوب بما يكفي من التفصيل',discount:'',discount_basis:'',admin_fee_percent:'',admin_fee_basis:'',...HEAD,lines:OWNER_LINES})),code('action_unavailable'));
  assert.throws(()=>db.prepare('DELETE FROM pricing_sheet_lines WHERE sheet_id=?').run(sheetId),/only while the sheet is a draft/);
  const second=approveSheet(sheet());
  assert.notEqual(second,sheetId);
  assert.deepEqual(board().sheets.map(s=>s.code).sort(),['PS-0001','PS-0002']);
  assert.ok(verifyAudit(db));
});
