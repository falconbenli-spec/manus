import { randomUUID } from 'node:crypto';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { actorOrRefuse } from './refusal.mjs';
import { refuse } from './refusal.mjs';
import { personName } from './people-read.mjs';
import { holds } from './access.mjs';
import { acceptedPolicy, PAY_COMPONENTS } from './hr-contracts.mjs';
import { confirmedUnpaidDays } from './attendance.mjs';
import { blockingRuleChecks, roundingMode, roundMoney, paydayFor, shiftToWorkingDay, workdayWeek } from './payroll-rules.mjs';
import { assertCasesResolved, computeFor, insuranceGaps, insuranceRule } from './payroll-insurance.mjs';
import { holidaySet } from './work-calendar.mjs';
import { cycleDayBasis } from './hr-rule-basis.mjs';
import { pendingPricing, priceLeaveEffect } from './leave-types.mjs';
import { mySettlement , myDeductionConsents } from './payroll-extras.mjs';
// P4-HR-5: الشهر الموازي يدفعه النظام السابق (الترحيل 176). سطر واحد في كل مسار مال: app/payroll-parallel-guard.mjs.
import { assertPlatformPays, dropParallelMonths } from './payroll-parallel-guard.mjs';
import { notifySubject } from './notices.mjs';

// مسير الرواتب. القواعد تأتي من عقود سارية وسياسة دورة رواتب اعتمدها مدير الموارد البشرية (DEC16)؛
// المنصة تحسب وتفسر وتقفل، ولا تدفع: التحويل البنكي وحماية الأجور خارجها.
export const STATUS_NAMES={draft:'مسودة',in_review:'قيد المراجعة',reviewed:'روجِع — بانتظار الاعتماد',approved:'معتمد ومقفل',cancelled:'ملغى',reversed:'منعكس قبل صرفه'};
// عكس المسير المعتمد (P4-HR-4، الترحيل 175): مستند مستقل يطلبه واحد ويقرره غيره.
export const REVERSAL_STATUS_NAMES={requested:'عكس ينتظر قرار زميل',approved:'عكس معتمد',rejected:'عكس مرفوض'};
const CAPS=['payroll.prepare','payroll.review','payroll.approve'];
const riyadhToday=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const id=()=>randomUUID();
const halfUp=(numerator,denominator)=>Number((BigInt(numerator)*2n+BigInt(denominator))/(BigInt(denominator)*2n));

function actor(db,supplied){const u=actorOrRefuse(db,supplied);u.caps=CAPS.filter(key=>holds(db,u,key));return u;}
function staff(db,supplied){const u=actor(db,supplied);if(!u.caps.length)fail(403,'not_permitted','مسير الرواتب لحاملي تصريحه الصريح وبس');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','كتابة المسير تبي معاملة قاعدة بيانات');}
function monthRange(month){
  if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail(400,'invalid_month','اكتب الشهر بصيغة 2026-09 (سنة-شهر)');
  const [year,m]=month.split('-').map(Number),days=new Date(Date.UTC(year,m,0)).getUTCDate();
  return {from:`${month}-01`,to:`${month}-${String(days).padStart(2,'0')}`,days};
}
const dayCount=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;

// سطر موظف واحد: كل رقم مشتق من مصدر مسمى في basis حتى تُراجع القسيمة دون الرجوع للكود.
export function computeLine(contract,range,params,unpaidDates,remainderBp=null){
  const start=contract.start_date>range.from?contract.start_date:range.from;
  const contractEnd=contract.ended_on??contract.end_date??range.to,end=contractEnd<range.to?contractEnd:range.to;
  const activeDays=dayCount(start,end),whole=activeDays===range.days;
  // أساس اليوم من دالة واحدة يقرأها المسير وأثر الإجازة على الأجر معًا (app/hr-rule-basis.mjs).
  const basisDays=cycleDayBasis(params,range.to);
  // remainderBp: حين يكمل هذا العقد شهرًا بدأه عقد سابق للموظف نفسه يأخذ ما تبقى من الشهر، فيجتمع الجزءان على شهر كامل
  // حتى في فبراير وشهور الواحد والثلاثين على أساس الثلاثين يومًا.
  const fractionBp=whole?10000:remainderBp??Math.min(10000,halfUp(Math.min(activeDays,basisDays)*10000,basisDays));
  const lines=JSON.parse(contract.pay_lines);
  const earnings=lines.map(l=>({component:l.component,monthly_minor:l.amount_minor,amount_minor:halfUp(l.amount_minor*fractionBp,10000)}));
  const gross=earnings.reduce((n,l)=>n+l.amount_minor,0);
  const unpaid=Math.min(gross,halfUp(contract.monthly_total_minor*unpaidDates.length,basisDays));
  // النسبة الواحدة القديمة في سياسة دورة الرواتب: تبقى كما هي للشهور التي حكمتها، وتُستبدل في baseLines
  // بخصم الحالة متى كانت قاعدة التأمينات مقبولة وسارية في ذلك الشهر. السياسة الجديدة لا تطلب نسبة أصلًا،
  // فغياب المفتاحين يعني صفرًا هنا لا عطلًا.
  const insuranceBase=(params.social_insurance_base??[]).length?lines.filter(l=>params.social_insurance_base.includes(l.component)).reduce((n,l)=>n+l.amount_minor,0):0;
  const insurance=Math.min(gross-unpaid,halfUp(insuranceBase*(params.social_insurance_employee_bp??0),10000));
  return {paid_fraction_bp:fractionBp,earnings,gross_minor:gross,unpaid_absence_minor:unpaid,social_insurance_minor:insurance,employer_insurance_minor:0,net_minor:gross-unpaid-insurance,
    basis:{contract_id:contract.id,period:[start,end],active_days:activeDays,completes_month:remainderBp!==null,month_days:range.days,day_basis:params.day_basis,basis_days:basisDays,unpaid_dates:unpaidDates,insurance_base_minor:insuranceBase,insurance_bp:params.social_insurance_employee_bp??null,
      rule:'الاستحقاق = بنود العقد × نسبة أيام سريان العقد في الشهر. الغياب غير المدفوع = إجمالي الراتب ÷ أساس اليوم × الأيام المعتمدة. استقطاع التأمينات = النسبة المعتمدة × بنود الأجر الخاضع الشهرية كاملة.'}};
}
function contractsIn(db,tenantId,range){
  // العقد الساري أو المنتهي الذي يتقاطع مع الشهر؛ الأحدث لكل موظف إن تتابع عقدان يُحتسب كل منهما بمدته.
  return db.prepare("SELECT * FROM employment_contracts WHERE tenant_id=? AND status IN ('active','ended') AND start_date<=? AND COALESCE(ended_on,end_date,'9999-12-31')>=? ORDER BY user_id,start_date").all(tenantId,range.to,range.from);
}
// الاستحقاق الأساسي لكل موظف في الشهر من العقود والغياب المعتمد كما هي الآن، دون كتابة. يستخدمه المسير واحتساب الأثر الرجعي.
export function baseLines(db,tenantId,range,params){
  const byUser=new Map();
  for(const contract of contractsIn(db,tenantId,range)){
    const unpaid=confirmedUnpaidDays(db,contract.user_id,range.from,range.to).filter(d=>d>=contract.start_date&&d<=(contract.ended_on??contract.end_date??range.to));
    const merged=byUser.get(contract.user_id),lastPart=merged?.basis.parts.at(-1);
    const contractEnd=contract.ended_on??contract.end_date??range.to,start=contract.start_date>range.from?contract.start_date:range.from;
    const completes=merged&&merged.basis.parts[0].period[0]===range.from&&contractEnd>=range.to&&dayCount(lastPart.period[1],start)===2;
    const part=computeLine(contract,range,params,unpaid,completes?10000-merged.paid_fraction_bp:null);
    const insurancePart={pay_lines:JSON.parse(contract.pay_lines),service_days:part.basis.active_days};
    if(!merged){byUser.set(contract.user_id,{...part,contract_id:contract.id,insurance_parts:[insurancePart],basis:{parts:[part.basis]}});continue;}
    // موظف بعقدين متتابعين في الشهر نفسه: يُجمع الجزءان، ويُحتسب اشتراك التأمينات على كل جزء بأجره وأيامه ثم يُجمع.
    // (كان يُحتسب مرة واحدة على أجر العقد الأحدث شهرًا كاملًا، فمن رُفع راتبه في منتصف الشهر خُصم منه شهر كامل بالأجر الجديد.)
    merged.earnings=[...merged.earnings,...part.earnings];merged.gross_minor+=part.gross_minor;merged.unpaid_absence_minor+=part.unpaid_absence_minor;
    merged.social_insurance_minor=part.social_insurance_minor;merged.paid_fraction_bp=Math.min(10000,merged.paid_fraction_bp+part.paid_fraction_bp);merged.contract_id=contract.id;merged.basis.parts.push(part.basis);
    merged.insurance_parts.push(insurancePart);
    merged.net_minor=merged.gross_minor-merged.unpaid_absence_minor-merged.social_insurance_minor;
  }
  // خصم التأمينات بحسب حالة كل موظف، مرة واحدة بعد دمج العقود وقبل التقريب: القاعدة المقبولة السارية في آخر يوم من الشهر
  // تحكم الشهر، فالشهور التي سبقت قبولها تبقى على نسبة سياسة الدورة التي حكمتها فعلًا ولا تظهر فروقًا رجعية كاذبة.
  const insuranceRuleOfMonth=insuranceRule(db,tenantId,range.to);
  for(const [userId,line] of byUser){
    if(!insuranceRuleOfMonth){
      line.basis.insurance={method:'flat_policy',case:null,employee_bp:params.social_insurance_employee_bp??null,employee_minor:line.social_insurance_minor,employer_minor:0,
        rule:'قاعدة التأمينات بالحالة لم يقبلها مدير الموارد البشرية سارية في هذا الشهر، فالمطبَّق هو نسبة سياسة دورة الرواتب الواحدة كما كانت. حصة المنشأة غير محتسبة.'};
      continue;
    }
    const computed=computeFor(db,tenantId,userId,{range,rule:insuranceRuleOfMonth,parts:line.insurance_parts,
      capMinor:line.gross_minor-line.unpaid_absence_minor});
    line.social_insurance_minor=computed.employee_minor;line.employer_insurance_minor=computed.employer_minor;
    line.basis.insurance=computed.basis;
    line.net_minor=line.gross_minor-line.unpaid_absence_minor-line.social_insurance_minor;
  }
  for(const line of byUser.values())delete line.insurance_parts;
  // م50/5 إن قبله مدير الموارد البشرية: كل بند استحقاق وحسم يُقرب إلى الريال الأعلى، ثم يُعاد جمع الصافي. قبل القبول يبقى الحساب بالهللة.
  // وحصة الموظف في التأمينات تتبع employee_rounding في قاعدة التأمينات: القيمة المزروعة تتبع م50/5 كما هو اليوم،
  // ولمدير الموارد البشرية أن يبقيها بالهللة كما يوصي الموجز (الموجز لم يجد قاعدة تقريب رسمية أصلًا).
  const employeeRounding=insuranceRuleOfMonth?.parameters.employee_rounding??'pay_rules';
  if(roundingMode(db,tenantId,range.to)==='riyal_up')for(const line of byUser.values()){
    line.earnings=line.earnings.map(e=>({...e,amount_minor:roundMoney(e.amount_minor,'riyal_up')}));
    line.gross_minor=line.earnings.reduce((n,e)=>n+e.amount_minor,0);
    line.unpaid_absence_minor=Math.min(line.gross_minor,roundMoney(line.unpaid_absence_minor,'riyal_up'));
    const before={employee:line.social_insurance_minor,employer:line.employer_insurance_minor??0};
    if(employeeRounding==='pay_rules')line.social_insurance_minor=Math.min(line.gross_minor-line.unpaid_absence_minor,roundMoney(line.social_insurance_minor,'riyal_up'));
    // حصة المنشأة تُقرَّب بالقاعدة نفسها (م50/5 تقول «والحسميات» ولا تفرق بين حصتين)، ولا يحدّها أجر الموظف لأنها ليست خصمًا عليه.
    line.employer_insurance_minor=roundMoney(line.employer_insurance_minor??0,'riyal_up');
    line.net_minor=line.gross_minor-line.unpaid_absence_minor-line.social_insurance_minor;
    line.basis.rounding='riyal_up';
    // السند يحمل ما خُصم فعلًا: رقمٌ في السند غير الرقم في العمود يجعل القسيمة تعرض نسبةً لا تُنتج مبلغها.
    // ولا مفتاح جديد يحمل «قُرِّب»: الفرق بين employee_minor وemployee_uncapped_minor يقوله وحده.
    const insurance=line.basis.insurance;
    if(insurance){
      const moved=before.employee!==line.social_insurance_minor||before.employer!==line.employer_insurance_minor;
      insurance.employee_minor=line.social_insurance_minor;insurance.employer_minor=line.employer_insurance_minor;
      if(insurance.capped_by_net)insurance.shortfall_minor=insurance.employee_uncapped_minor-line.social_insurance_minor;
      if(moved)insurance.rule+=` ثم التقريب إلى الريال الأعلى بقاعدة م50/5 المقبولة: حصة الموظف ${line.social_insurance_minor/100} ريال وحصة المنشأة ${line.employer_insurance_minor/100} ريال.`;
    }
  }
  return byUser;
}
// ————— الاحتساب: قراءة نقية ثم كتابة —————
// ما يقرؤه الاحتساب مصنَّفًا، ليُسمّى حين يتغير بعد الاحتساب. «الحركات» ما لم يولّده باب آخر: العمل الإضافي والمكافآت والبدلات
// والخصومات وأقساط السلف والأثر الرجعي. وآثار الإجازات خصومها وردودها، والمزايا ما سلّمته وحدة المزايا إلى المسير.
export const INPUT_PARTS=Object.freeze({absences:'الغياب المعتمد بلا أجر',adjustments:'حركات الرواتب المعتمدة',leave_effects:'آثار الإجازات على الأجر',
  benefits:'المزايا المسلَّمة إلى المسير',contracts:'العقود السارية في الشهر',rules:'قواعد التأمينات والتقريب'});
const ADJUSTMENT_NAMES={overtime:'عمل إضافي',bonus:'مكافأة',allowance:'بدل لمرة واحدة',deduction:'خصم',advance_installment:'قسط سلفة'};
// صيغة ثابتة لا تتبدل بترتيب المفاتيح ولا بترتيب قراءة الصفوف: البصمة نفسها للمدخلات نفسها.
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`
  :value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value??null);
// هوية قاعدة التأمينات في السطر لا مبالغها: الطريقة والقاعدة والحالة والنسبة. المبالغ ناتج يتبع العقد والغياب ولهما صنفاهما.
const RULE_KEYS=['method','policy_id','case','rate_from','employee_bp','employer_bp','blocked','override'];
function adjustmentSources(db,tenantId){
  const leave=new Map(db.prepare('SELECT adjustment_id,status FROM leave_pay_effects WHERE tenant_id=? AND adjustment_id IS NOT NULL').all(tenantId).map(r=>[r.adjustment_id,r.status]));
  for(const r of db.prepare('SELECT refund_id FROM leave_pay_effect_refunds WHERE tenant_id=?').all(tenantId))leave.set(r.refund_id,'refund');
  const benefits=new Set([...db.prepare('SELECT payroll_adjustment_id AS id FROM benefit_payout_proposals WHERE tenant_id=? AND payroll_adjustment_id IS NOT NULL').all(tenantId),
    ...db.prepare('SELECT payroll_adjustment_id AS id FROM benefit_extra_instalments WHERE tenant_id=? AND payroll_adjustment_id IS NOT NULL').all(tenantId)].map(r=>r.id));
  return {leave,benefits};
}
// سطور الشهر كما تحسبها مصادرها الآن، بلا كتابة: يقرؤها الاحتساب ليكتبها، ويقرؤها التقديم والمراجعة والاعتماد ليتحققوا أن ما احتُسب
// منه المسير هو ما بين أيديهم. runId: الحركات المربوطة بهذا المسير تُقرأ معه. خصمُ إجازةٍ سُحب أثرها قبل صرفه لا يدخل: سقط سنده.
export function computeRunLines(db,tenantId,month,{runId=null,policyId=null}={}){
  const range=monthRange(month);
  const policy=policyId?db.prepare('SELECT * FROM hr_policies WHERE id=? AND tenant_id=?').get(policyId,tenantId):acceptedPolicy(db,tenantId,'payroll_cycle',range.to);
  if(!policy)refuse(409,'policy_required',{what:`ما فيه سياسة دورة رواتب اعتمدها مدير الموارد البشرية وسارية في ${month}`,
    missing:[{document:'سياسة دورة رواتب معتمدة سارية في الشهر',why:'الاحتساب يطبّق أساس اليوم وحد الفرق من سياستها',owner:'مدير الموارد البشرية',owner_role:'hr.policy.accept'}],
    next:'تُعد السياسة من «العقود وبنود الراتب» ويعتمدها مدير الموارد البشرية',link:'#contracts'});
  const params=JSON.parse(policy.parameters),byUser=baseLines(db,tenantId,range,params),{leave,benefits}=adjustmentSources(db,tenantId);
  const previousRun=db.prepare("SELECT id FROM payroll_runs WHERE tenant_id=? AND status='approved' AND month<? ORDER BY month DESC LIMIT 1").get(tenantId,month);
  const lines=[],parts={absences:{},adjustments:[],leave_effects:[],benefits:[],contracts:{},rules:{}};
  for(const [userId,line] of byUser){
    const rows=db.prepare("SELECT * FROM payroll_adjustments WHERE tenant_id=? AND user_id=? AND month=? AND status='approved' AND (run_id IS NULL OR run_id=?) ORDER BY created_at,id").all(tenantId,userId,month,runId)
      .filter(r=>leave.get(r.id)!=='withdrawn');
    const sum=kinds=>rows.filter(r=>kinds.includes(r.kind)).reduce((n,r)=>n+r.amount_minor,0);
    line.additions_minor=sum(['overtime','bonus','allowance']);line.advance_minor=sum(['advance_installment']);line.other_deductions_minor=sum(['deduction']);
    line.adjustments=rows.map(r=>({id:r.id,kind:r.kind,kind_name:ADJUSTMENT_NAMES[r.kind],amount_minor:r.amount_minor,reason:r.reason}));
    line.net_minor=line.gross_minor+line.additions_minor-line.unpaid_absence_minor-line.social_insurance_minor-line.advance_minor-line.other_deductions_minor;
    const previous=previousRun?db.prepare('SELECT net_minor FROM payroll_lines WHERE run_id=? AND user_id=?').get(previousRun.id,userId)?.net_minor??null:null;
    line.previous_net_minor=previous;
    line.variance_flag=previous===null?(previousRun?1:0):Math.abs(line.net_minor-previous)*10000>params.review_threshold_bp*previous?1:0;
    lines.push({user_id:userId,...line});
    parts.absences[userId]=line.basis.parts.flatMap(p=>p.unpaid_dates);
    parts.contracts[userId]=line.basis.parts.map(p=>[p.contract_id,p.period]);
    parts.rules[userId]={rounding:line.basis.rounding??null,insurance:Object.fromEntries(RULE_KEYS.map(key=>[key,line.basis.insurance?.[key]??null]))};
    for(const r of rows)parts[leave.has(r.id)?'leave_effects':benefits.has(r.id)?'benefits':'adjustments'].push([r.id,userId,r.kind,r.amount_minor]);
  }
  const digests=Object.fromEntries(Object.keys(INPUT_PARTS).map(key=>[key,hash(canonical(parts[key]))]));
  const gross=lines.reduce((n,l)=>n+l.gross_minor+l.additions_minor,0),deductions=lines.reduce((n,l)=>n+l.unpaid_absence_minor+l.social_insurance_minor+l.advance_minor+l.other_deductions_minor,0);
  return {tenant_id:tenantId,month,policy_id:policy.id,lines,parts:digests,digest:hash(canonical({month,policy_id:policy.id,parts:digests})),
    totals:{headcount:lines.length,gross_minor:gross,deductions_minor:deductions,net_minor:gross-deductions}};
}
const staleRun=()=>refuse(409,'stale_version',{what:'تغيّر المسير أثناء الحفظ، فما انكتب شيء فوق التغيير',next:'حدّث الشاشة وأعد المحاولة على النسخة الجديدة'});
function calculate(db,u,run){
  const computed=computeRunLines(db,run.tenant_id,run.month,{runId:run.id,policyId:run.cycle_policy_id});
  for(const line of computed.lines)if(line.net_minor<0)fail(409,'negative_net',`صافي ${personName(db,line.user_id)} طلع سالب بعد الخصومات — أجّل قسط ولا خصم لشهر جاي بقرار معتمد`);
  db.prepare('DELETE FROM payroll_lines WHERE run_id=?').run(run.id);
  // الإضافات والخصومات المعتمدة لهذا الشهر تدخل مرة واحدة: تُحرر مما سبق ربطه بهذه المسودة ثم تُربط من جديد.
  db.prepare('UPDATE payroll_adjustments SET run_id=NULL WHERE run_id=?').run(run.id);
  for(const line of computed.lines){
    // حصة المنشأة تُخزَّن في السطر ولا تدخل الصافي ولا استقطاعات المسير: تكلفة على الشركة لا خصم على الموظف،
    // فلا تُعاد كتابتها في المالية بيد إنسان ولا تُحسب مرتين في ملف حماية الأجور.
    db.prepare('INSERT INTO payroll_lines(id,run_id,user_id,contract_id,paid_fraction_bp,earnings,gross_minor,unpaid_absence_minor,social_insurance_minor,employer_insurance_minor,net_minor,previous_net_minor,variance_flag,basis,additions_minor,advance_minor,other_deductions_minor,adjustments) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id(),run.id,line.user_id,line.contract_id,line.paid_fraction_bp,JSON.stringify(line.earnings),line.gross_minor,line.unpaid_absence_minor,line.social_insurance_minor,line.employer_insurance_minor??0,line.net_minor,line.previous_net_minor,line.variance_flag,JSON.stringify(line.basis),line.additions_minor,line.advance_minor,line.other_deductions_minor,JSON.stringify(line.adjustments));
    for(const a of line.adjustments)db.prepare('UPDATE payroll_adjustments SET run_id=? WHERE id=?').run(run.id,a.id);
  }
  const t=computed.totals;
  // الكتابة مشروطة بالنسخة التي قُرئت: كاتبٌ آخر مسّ المسير في الأثناء يُرفض عمله هنا ولا يُكتب فوقه.
  if(db.prepare('UPDATE payroll_runs SET headcount=?,gross_minor=?,deductions_minor=?,net_minor=?,inputs_digest=?,inputs_parts=?,version=version+1,updated_at=? WHERE id=? AND version=?')
    .run(t.headcount,t.gross_minor,t.deductions_minor,t.net_minor,computed.digest,JSON.stringify(computed.parts),now(),run.id,run.version).changes!==1)staleRun();
}
// هل ما احتُسب منه المسير هو ما بين أيدينا الآن؟ يُسأل عند التقديم والمراجعة والاعتماد. الجواب «لا» يمنع الإجراء باسم ما تغيّر
// (قرار مطبَّق: المنع وإعادة الاحتساب، لا الاعتماد ثم الأثر الرجعي). ومسير بلا بصمة احتُسب قبل الترحيل 173، فلا يُعرف على ماذا قام.
function inputsChanged(db,run){
  const current=computeRunLines(db,run.tenant_id,run.month,{runId:run.id,policyId:run.cycle_policy_id});
  if(run.inputs_digest&&run.inputs_digest===current.digest)return [];
  const stored=run.inputs_digest&&run.inputs_parts?JSON.parse(run.inputs_parts):null;
  const changed=stored?Object.keys(INPUT_PARTS).filter(key=>stored[key]!==current.parts[key]):[];
  return changed.length?changed:['calculation'];
}
const inputName=key=>key==='calculation'?'بصمة الاحتساب نفسه':INPUT_PARTS[key];
function assertInputsCurrent(db,run){
  const changed=inputsChanged(db,run);
  if(!changed.length)return;
  const draft=run.status==='draft',owner=draft?{owner:'مُعد الرواتب',owner_role:'payroll.prepare'}:{owner:'مراجع الرواتب أو معتمده يعيده إلى المسودة، ثم يعيد مُعد الرواتب احتسابه',owner_role:'payroll.review'};
  refuse(409,'inputs_changed',{what:`مدخلات مسير ${run.month} تغيّرت بعد احتسابه، فسطوره ما عادت تطابق مصادرها: ${changed.map(inputName).join('، ')}`,
    missing:changed.map(key=>({doc_key:key,document:key==='calculation'?'احتساب يحفظ بصمة مدخلاته — هذا المسير احتُسب قبل حفظ البصمة':`احتساب على ${INPUT_PARTS[key]} كما هي الآن`,
      why:'المسير يُقدَّم ويُراجَع ويُعتمد على ما احتُسب منه؛ وما تغيّر بعد احتسابه ما يمر صامتًا ولا يُرحَّل إلى الأثر الرجعي',...owner})),
    next:draft?'أعد احتساب المسير ثم قدّمه':'يعيده المراجع أو المعتمد إلى المسودة بسبب مكتوب، ويعيد مُعد الرواتب احتسابه، ثم يمر بالمراجعة والاعتماد من جديد',link:'#payroll'});
}

// ————— يوم الصرف وقرار الصرف المبكر —————
// المالك: الرواتب في 27 وتُزاح إلى يوم العمل السابق (م48)، «وفي بعض الأحيان يتم صرفها قبل إجازة الأعياد».
// التاريخ النافذ يُحسب عند القراءة لا يُجمَّد: تغيّرُ عطلةٍ بعد القرار لا يدفع الصرف إلى ما بعد تاريخ اللائحة أبدًا.
const liveDecision=(db,tenantId,month)=>db.prepare("SELECT * FROM payroll_pay_date_decisions WHERE tenant_id=? AND month=? AND status IN ('proposed','confirmed') ORDER BY created_at DESC LIMIT 1").get(tenantId,month)??null;
function payDateOf(db,u,run){
  const regulation=paydayFor(db,run.tenant_id,run.month);
  if(!regulation)return null;
  const row=liveDecision(db,run.tenant_id,run.month),name=userId=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
  const early=row&&row.status==='confirmed'?(row.pay_on<regulation.actual?row.pay_on:regulation.actual):null;
  return {nominal:regulation.nominal,regulation:regulation.actual,shifted:regulation.shifted,shift_reason:regulation.reason,rule_active:regulation.active,
    effective:early??regulation.actual,
    decision:row?{id:row.id,status:row.status,pay_on:row.pay_on,reason:row.reason,regulation_date_at_decision:row.regulation_date,decided_by:row.decided_by,
      decided_by_name:name(row.decided_by),confirmed_by_name:name(row.confirmed_by),decided_at:row.decided_at,confirmed_at:row.confirmed_at}:null,
    note:'الصرف المبكر تعجيل لا تأجيل: التاريخ النافذ لا يتجاوز تاريخ اللائحة مهما تغيّرت العطل بعد القرار.'};
}
function payDateActions(db,u,run,payDate){
  if(!payDate||['cancelled','reversed'].includes(run.status))return [];
  const row=payDate.decision,out=[];
  if(!row&&(u.caps.includes('payroll.prepare')||u.caps.includes('payroll.approve')))out.push('propose_early_pay');
  // من اقترح لا يؤكد: تاريخ صرف يقرره شخص واحد ليس قرارًا، وهو ما يفرضه CHECK في الجدول أيضًا.
  if(row&&row.status==='proposed'&&u.caps.includes('payroll.approve')&&row.decided_by!==u.id)out.push('confirm_early_pay','reject_early_pay');
  // وتاريخ أُكِّد بالخطأ لا يبقى نافذًا إلى الأبد: يُسحب بسبب مكتوب بيد غير من اقترحه، فيتحرر الشهر لقرار جديد.
  if(row&&row.status==='confirmed'&&u.caps.includes('payroll.approve')&&row.decided_by!==u.id)out.push('withdraw_early_pay');
  return out;
}

function runView(db,u,run,withLines=true){
  const name=userId=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
  const lines=withLines?db.prepare('SELECT l.*,x.name AS employee_name FROM payroll_lines l JOIN users x ON x.id=l.user_id WHERE l.run_id=? ORDER BY x.name').all(run.id).map(l=>({...l,earnings:JSON.parse(l.earnings),basis:JSON.parse(l.basis),adjustments:JSON.parse(l.adjustments),variance_flag:!!l.variance_flag})):[];
  const range=monthRange(run.month);
  const missing=withLines&&run.status==='draft'?db.prepare("SELECT u.id,u.name FROM users u WHERE u.tenant_id=? AND u.active=1 AND u.role<>'admin' AND NOT EXISTS(SELECT 1 FROM employment_contracts c WHERE c.user_id=u.id AND c.status IN ('active','ended') AND c.start_date<=? AND COALESCE(c.ended_on,c.end_date,'9999-12-31')>=?) ORDER BY u.name").all(run.tenant_id,range.to,range.from):[];
  const unexplained=lines.filter(l=>l.variance_flag&&!l.variance_note).length,actions=[];
  // D-01a: خصم إجازة معتمدة لم يُسعَّر لا يسقط بصمت. يظهر هنا بندًا على المُعد، ويمنع تقديم المسير حتى يُحسم.
  const pending=['cancelled','reversed'].includes(run.status)?[]:pendingPricing(db,run.tenant_id,run.month);
  if(run.status==='draft'&&run.prepared_by===u.id&&u.caps.includes('payroll.prepare'))actions.push('recalculate',...(pending.some(x=>x.priceable)?['price_leave_effect']:[]),'submit_run','cancel_run');
  if(run.status==='in_review'&&run.prepared_by!==u.id&&u.caps.includes('payroll.review'))actions.push(...(lines.some(l=>l.variance_flag)?['justify']:[]),...(unexplained?[]:['pass_review']),'return_run');
  if(run.status==='reviewed'&&run.prepared_by!==u.id&&run.reviewed_by!==u.id&&u.caps.includes('payroll.approve'))actions.push('approve_run','return_run');
  // العكس (D6): لمسير معتمد قبل أي تحويل منفّذ وقبل أي رفع موثّق لملف أجوره، ولا شي بُني على صرفه. يطلبه حامل الإعداد أو الاعتماد
  // بسبب مكتوب، ويقرره حامل اعتماد غيره. ما يمنعه يُقال في reversal_blockers ولا يُعرض زرٌّ يُرفض حتمًا.
  const reversal=withLines?lastReversal(db,run.id):null,blockers=withLines&&run.status==='approved'?reversalBlockers(db,run):[];
  const requested=reversal?.status==='requested'&&run.status==='approved'?reversal:null;
  if(withLines&&run.status==='approved'&&!requested&&!blockers.length&&(u.caps.includes('payroll.prepare')||u.caps.includes('payroll.approve')))actions.push('request_run_reversal');
  if(requested&&u.caps.includes('payroll.approve')&&requested.requested_by!==u.id)actions.push(...(blockers.length?[]:['approve_run_reversal']),'reject_run_reversal');
  const payDate=payDateOf(db,u,run);
  actions.push(...payDateActions(db,u,run,payDate));
  // هل تغيّر شيء من مدخلات المسير منذ احتسابه؟ يُقرأ للمسير المفتوح وحده، والتقديم والمراجعة والاعتماد يمتنعون عليه بالاسم نفسه.
  const changed=withLines&&['draft','in_review','reviewed'].includes(run.status)?inputsChanged(db,run):null;
  const inputs=changed?{state:changed.length?(changed[0]==='calculation'?'unverified':'changed'):'current',changed:changed.map(key=>({key,name:inputName(key)}))}:null;
  // التأمينات: هل القاعدة مقبولة أصلًا، ومن بقي بلا حالة، وكم تتحمل المنشأة. اللوحة تقول ذلك صراحة
  // بدل أن يظن قارئ المسير أن صفرًا في عمود التأمينات يعني «لا يُخصم منه» بينما هو «لا نعرف حالته».
  const rule=insuranceRule(db,run.tenant_id,monthRange(run.month).to);
  const gaps=withLines&&rule?insuranceGaps(db,run.tenant_id,run):{missing:[],unanswered:[],stale:[]};
  // ما حُصر خصمه بما تبقى من الأجر: الفرق يبقى مستحقًا للمؤسسة على المنشأة، فيُقال قبل الاعتماد لا في سند السطر وحده.
  const capped=lines.filter(l=>l.basis.insurance?.capped_by_net);
  const insurance={rule_accepted:!!rule,policy_id:rule?.id??null,effective_from:rule?.effective_from??null,
    missing:gaps.missing,unanswered:gaps.unanswered,stale:gaps.stale,
    employer_total_minor:rule?lines.reduce((n,l)=>n+(l.employer_insurance_minor??0),0):null,
    employee_total_minor:lines.reduce((n,l)=>n+l.social_insurance_minor,0),
    capped:capped.map(l=>({user_id:l.user_id,name:l.employee_name,deducted_minor:l.social_insurance_minor,due_minor:l.basis.insurance.employee_uncapped_minor,shortfall_minor:l.basis.insurance.shortfall_minor})),
    capped_shortfall_minor:capped.reduce((n,l)=>n+l.basis.insurance.shortfall_minor,0),
    note:rule?'الخصم بحسب حالة كل موظف من القاعدة المقبولة. حصة المنشأة تكلفة عليها ولا تُخصم من أحد.'
      :'قاعدة التأمينات بالحالة لم تُقبل سارية في هذا الشهر، فالمطبَّق نسبة سياسة دورة الرواتب الواحدة على الجميع، وحصة المنشأة غير محتسبة.'};
  return {...run,status_name:STATUS_NAMES[run.status],prepared_by_name:name(run.prepared_by),reviewed_by_name:name(run.reviewed_by),approved_by_name:name(run.approved_by),lines,missing_contracts:missing,unexplained_variances:unexplained,
    pending_pricing:pending,pay_date:payDate,insurance,inputs,
    reversal:reversal?{id:reversal.id,status:reversal.status,status_name:REVERSAL_STATUS_NAMES[reversal.status],reason:reversal.reason,requested_by:reversal.requested_by,requested_by_name:name(reversal.requested_by),requested_at:reversal.requested_at,
      decided_by_name:name(reversal.decided_by),decided_at:reversal.decided_at,decision_note:reversal.decision_note,reversed_on:reversal.reversed_on,version:reversal.version}:null,
    reversal_blockers:blockers.map(({code,document,why,owner})=>({code,document,why,owner})),actions};
}

export function listPayroll(db,supplied){
  const u=actor(db,supplied),today=riyadhToday();
  // القسائم: سطر الموظف نفسه من مسيرات معتمدة فقط.
  const payslips=db.prepare("SELECT l.*,r.month,r.approved_at FROM payroll_lines l JOIN payroll_runs r ON r.id=l.run_id WHERE r.tenant_id=? AND r.status='approved' AND l.user_id=? ORDER BY r.month DESC").all(u.tenant_id,u.id)
    .map(l=>({id:l.id,month:l.month,approved_at:l.approved_at,earnings:JSON.parse(l.earnings),gross_minor:l.gross_minor,additions_minor:l.additions_minor,advance_minor:l.advance_minor,other_deductions_minor:l.other_deductions_minor,adjustments:JSON.parse(l.adjustments),unpaid_absence_minor:l.unpaid_absence_minor,social_insurance_minor:l.social_insurance_minor,net_minor:l.net_minor,basis:JSON.parse(l.basis)}));
  dropParallelMonths(db,u.tenant_id,payslips);
  const runs=u.caps.length?db.prepare('SELECT * FROM payroll_runs WHERE tenant_id=? ORDER BY month DESC,created_at DESC').all(u.tenant_id).map(r=>runView(db,u,r)):[];
  const policy=acceptedPolicy(db,u.tenant_id,'payroll_cycle',today);
  return {today,user_id:u.id,permissions:u.caps,status_names:STATUS_NAMES,pay_components:PAY_COMPONENTS,
    // D-15: تسوية نهاية الخدمة المعتمدة لصاحبها، بجوار قسائمه. لا تُقرأ من هنا تسوية غيره.
    settlement:mySettlement(db,u),
    // م51: خصومات مقترحة من أجر صاحب الشاشة تنتظر موافقته الخطية؛ لا تُقرأ من هنا خصومات غيره.
    deduction_consents:myDeductionConsents(db,u),
    cycle_policy:policy?{id:policy.id,title:policy.title,...JSON.parse(policy.parameters)}:null,runs,payslips,
    // على أي أساس يُخصم التأمين اليوم: قاعدة الحالات المقبولة، أو نسبة سياسة الدورة الواحدة، أو لا شيء.
    insurance_rule:(()=>{const rule=insuranceRule(db,u.tenant_id,today);
      return rule?{accepted:true,title:rule.title,effective_from:rule.effective_from,case_count:Object.keys(rule.parameters.cases).length}
        :{accepted:false,title:null,effective_from:null,case_count:0};})(),
    outside_platform:'المنصة تحسب وتقفل المسير ولا تحول أموالًا. ملف البنك وحماية الأجور وتنفيذ الدفع خارج المنصة ولم تُبنَ.'};
}
export function getRun(db,supplied,runId){
  const u=staff(db,supplied),run=typeof runId==='string'&&db.prepare('SELECT * FROM payroll_runs WHERE id=? AND tenant_id=?').get(runId,u.tenant_id);
  if(!run)fail(404,'not_found','ما لقينا المسير هذا');
  return runView(db,u,run);
}
// القسيمة لصاحبها فقط، ويُسجل كل اطلاع.
export function viewPayslip(db,supplied,lineId){
  const u=actor(db,supplied);
  const line=typeof lineId==='string'&&db.prepare("SELECT l.*,r.month FROM payroll_lines l JOIN payroll_runs r ON r.id=l.run_id WHERE l.id=? AND r.tenant_id=? AND r.status='approved' AND l.user_id=?").get(lineId,u.tenant_id,u.id);
  if(!line)fail(404,'not_found','ما لقينا القسيمة هذي');
  assertPlatformPays(db,u.tenant_id,line.month,'payslip');
  db.prepare('INSERT INTO payslip_views VALUES(?,?,?,?)').run(id(),line.id,u.id,now());
  return {id:line.id,month:line.month,earnings:JSON.parse(line.earnings),additions_minor:line.additions_minor,advance_minor:line.advance_minor,other_deductions_minor:line.other_deductions_minor,adjustments:JSON.parse(line.adjustments),gross_minor:line.gross_minor,unpaid_absence_minor:line.unpaid_absence_minor,social_insurance_minor:line.social_insurance_minor,net_minor:line.net_minor,basis:JSON.parse(line.basis)};
}

export function prepareRun(db,supplied,input){
  writing(db);
  const u=staff(db,supplied);
  if(!u.caps.includes('payroll.prepare'))fail(403,'not_permitted','إعداد المسير مو من صلاحيتك');
  v.object(input,['month']);
  const range=monthRange(input.month);
  if(input.month>riyadhToday().slice(0,7))fail(400,'future_month','ما نعدّ مسير لشهر ما بدأ');
  // الملغى والمنعكس لا يحجزان الشهر: المنعكس يُعدّ له مسير مصحَّح.
  if(db.prepare("SELECT 1 FROM payroll_runs WHERE tenant_id=? AND month=? AND status NOT IN ('cancelled','reversed')").get(u.tenant_id,input.month))fail(409,'run_exists','للشهر مسير قائم. والمعتمد ما يُعدَّل: يُعكس قبل صرفه بطلب يعتمده زميل، أو تتعالج فروقه في شهر جاي');
  // القاعدة المطبقة هي السارية في آخر يوم من الشهر نفسه، لا قاعدة اليوم.
  const policy=acceptedPolicy(db,u.tenant_id,'payroll_cycle',range.to);
  if(!policy)fail(409,'policy_required','ما فيه سياسة دورة رواتب اعتمدها مدير الموارد البشرية وسارية في هذا الشهر');
  const runId=id(),time=now();
  db.prepare("INSERT INTO payroll_runs(id,tenant_id,month,cycle_policy_id,status,headcount,gross_minor,deductions_minor,net_minor,prepared_by,created_at,updated_at) VALUES(?,?,?,?,'draft',0,0,0,0,?,?,?)").run(runId,u.tenant_id,input.month,policy.id,u.id,time,time);
  calculate(db,u,db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(runId));
  audit(db,u,'payroll_run',runId,'payroll.prepared',{}, {month:input.month});
  return {id:runId};
}

// اقتراح صرف الشهر قبل تاريخ اللائحة وتأكيده. شخصان: مقترح يحمل إعداد المسير أو اعتماده، ومؤكِّد غيره يحمل الاعتماد.
function earlyPayAction(db,u,run,action,input,time){
  const payDate=run.pay_date;
  if(action==='propose_early_pay'){
    const payOn=v.date(input.pay_on),reason=v.text(input.reason,'سبب الصرف المبكر (مثال: قبل إجازة العيد)',2000,10);
    if(payOn>=payDate.regulation)fail(400,'not_earlier',`الصرف المبكر أبكر من تاريخ اللائحة ${payDate.regulation}، مو فيه ولا بعده — اختر تاريخ يسبقه`);
    if(payOn<`${run.month}-01`)fail(400,'before_month',`ما يتصرف راتب شهر ${run.month} قبل أول يوم منه (${run.month}-01)`);
    // تاريخ الصرف المختار يُفحص بقاعدة م48 نفسها وبأسبوع دوام الكيان المقبول نفسه الذي حُسب به تاريخ اللائحة،
    // وإلا حُكم على الاقتراح بأسبوع افتراضي (الجمعة والسبت) فرُفض يوم عمل وقُبل يوم راحة في كيان دوامه الاثنين–الجمعة.
    const shifted=shiftToWorkingDay(payOn,holidaySet(db,run.tenant_id),workdayWeek(db,run.tenant_id,payOn));
    if(shifted.shifted)fail(400,'rest_day',`${payOn} ${shifted.reason}؛ وأقرب يوم عمل قبله ${shifted.date} — خذه ولا اختر يوم عمل ثاني يسبق ${payDate.regulation}`);
    const rowId=id();
    db.prepare("INSERT INTO payroll_pay_date_decisions(id,tenant_id,month,nominal_date,regulation_date,pay_on,reason,status,decided_by,decided_at,created_at) VALUES(?,?,?,?,?,?,?,'proposed',?,?,?)")
      .run(rowId,run.tenant_id,run.month,payDate.nominal,payDate.regulation,payOn,reason,u.id,time,time);
    audit(db,u,'payroll_pay_date',rowId,'payroll.early_pay_proposed',{regulation_date:payDate.regulation},{pay_on:payOn,month:run.month},reason);
    return getRun(db,u,run.id);
  }
  const row=payDate?.decision;
  // السحب: القرار المؤكد يبقى في السجل بحاله، ويُكتب عليه من سحبه ولماذا. الشهر يتحرر لقرار جديد بعده.
  if(action==='withdraw_early_pay'){
    if(!row||row.status!=='confirmed')fail(409,'no_decision','ما فيه قرار صرف مبكر مؤكد لهذا الشهر عشان تسحبه');
    const reason=v.text(input.note,'سبب سحب تاريخ الصرف المبكر وما الذي تبيّن',2000,10);
    db.prepare("UPDATE payroll_pay_date_decisions SET status='withdrawn',withdrawn_by=?,withdrawn_at=?,withdrawal_reason=? WHERE id=?").run(u.id,time,reason,row.id);
    audit(db,u,'payroll_pay_date',row.id,'payroll.early_pay_withdrawn',{status:'confirmed',pay_on:row.pay_on},{status:'withdrawn'},reason);
    return getRun(db,u,run.id);
  }
  if(!row||row.status!=='proposed')fail(409,'no_proposal','ما فيه اقتراح صرف مبكر قائم لهذا الشهر عشان تأكّده ولا ترفضه');
  const note=v.text(input.note,action==='confirm_early_pay'?'إقرارك بسبب التعجيل وأثره على السيولة':'سبب رفض التعجيل',2000,10);
  const status=action==='confirm_early_pay'?'confirmed':'rejected';
  db.prepare('UPDATE payroll_pay_date_decisions SET status=?,confirmed_by=?,confirmed_at=?,decision_note=? WHERE id=?').run(status,u.id,time,note,row.id);
  audit(db,u,'payroll_pay_date',row.id,`payroll.early_pay_${status}`,{status:'proposed',pay_on:row.pay_on},{status},note);
  return getRun(db,u,run.id);
}

// ————— عكس المسير المعتمد (P4-HR-4، D6، الترحيل 175) —————
// المسير المعتمد لا يُعدَّل: يُعكس بمستند مستقل قبل أي تحويل منفّذ وقبل أي رفع موثّق لملف أجوره. اعتماد العكس يلغي التحويلات الحية
// (المعدّة أو المعتمدة غير المنفذة) بسبب مكتوب، وينقل المسير إلى «منعكس»، ويحرر حركاته لمسيره المصحَّح، ويبلّغ أصحاب القسائم.
// وقيد العكس في الدفتر مستند «عكس مسير رواتب معتمد» يعكس قيد المسير المرحّل بحرفه (app/payroll-ledger.mjs).
const lastReversal=(db,runId)=>db.prepare('SELECT * FROM payroll_run_reversals WHERE run_id=? ORDER BY requested_at DESC,rowid DESC LIMIT 1').get(runId)??null;
function reversalBlockers(db,run){
  const out=[],later='مُعد الرواتب يقترح الفرق أثرًا رجعيًا في شهر لاحق';
  const paid=db.prepare("SELECT executed_on,bank_reference FROM payroll_payments WHERE run_id=? AND status='executed'").get(run.id);
  if(paid)out.push({code:'run_paid',document:`تحويل مسير ${run.month} منفّذ في البنك يوم ${paid.executed_on} بمرجع ${paid.bank_reference}`,
    why:'العكس قبل الصرف وبس (D6): ما انصرف يتصحّح بأثر رجعي، لا بمسح المسير اللي انصرف عليه',owner:later,owner_role:'payroll.prepare'});
  const uploaded=db.prepare('SELECT uploaded_on,upload_reference FROM wps_exports WHERE run_id=? AND uploaded_on IS NOT NULL').get(run.id);
  if(uploaded)out.push({code:'run_uploaded',document:`ملف حماية أجور مسير ${run.month} مرفوع يوم ${uploaded.uploaded_on} بمرجع ${uploaded.upload_reference}`,
    why:'اللي انرفع للجهة صار أجرًا مسجّلًا عندها؛ مسح المسير بعده يترك المنصة والجهة على رقمين',owner:later,owner_role:'payroll.prepare'});
  if(db.prepare("SELECT 1 FROM leave_pay_effect_refunds f JOIN payroll_adjustments a ON a.id=f.refund_id WHERE f.paid_run_id=? AND a.status<>'rejected'").get(run.id))
    out.push({code:'refund_from_run',document:'حركة ردّ خصم إجازة انلغت بعد ما انصرف خصمها في هالمسير',why:'الرد قام على إن هالمسير صرف الخصم؛ وعكسه يخلي الرد ردًّا لشي ما انخصم',owner:'معتمد الرواتب يرفض حركة الرد بسبب مكتوب',owner_role:'payroll.approve'});
  if(db.prepare("SELECT 1 FROM payroll_retro x JOIN payroll_adjustments a ON a.id=x.adjustment_id WHERE x.source_run_id=? AND a.status<>'rejected'").get(run.id))
    out.push({code:'retro_from_run',document:'حركة أثر رجعي قامت على سطور هالمسير',why:'الأثر الرجعي فرقٌ بين اللي صرفه هالمسير واللي يستحق؛ وعكسه يحسب الفرق مرتين مع المسير المصحَّح',owner:'معتمد الرواتب يرفض حركة الأثر الرجعي بسبب مكتوب',owner_role:'payroll.approve'});
  return out;
}
const blockedReversal=(run,blockers)=>refuse(409,blockers[0].code,{what:`ما ينعكس مسير ${run.month}: ${blockers.map(b=>b.document).join('؛ ')}`,
  missing:blockers.map(({code,...rest})=>rest),next:'يُرفض اللي بُني على هالمسير ثم يُطلب العكس، أو يتعالج الفرق بأثر رجعي في شهر لاحق يعتمده زميل',link:'#payroll'});
function reversalAction(db,u,run,action,input,time,set){
  if(action==='request_run_reversal'){
    const reason=v.text(input.reason,'سبب العكس: وش الخطأ في المسير المعتمد',2000,10),rowId=id();
    db.prepare("INSERT INTO payroll_run_reversals(id,tenant_id,run_id,month,net_minor,reason,status,requested_by,requested_at) VALUES(?,?,?,?,?,?,'requested',?,?)").run(rowId,run.tenant_id,run.id,run.month,run.net_minor,reason,u.id,time);
    audit(db,u,'payroll_run',run.id,'payroll.reversal_requested',{status:'approved'},{reversal_id:rowId},reason);
    return getRun(db,u,run.id);
  }
  const x=run.reversal,approve=action==='approve_run_reversal';
  const note=v.text(input.note,approve?'أساس اعتماد العكس: وش اللي تأكدت منه، ومنها إن ملف التحويل ما انصرف في البنك':'سبب رفض العكس',2000,10);
  if(!approve){
    if(db.prepare("UPDATE payroll_run_reversals SET status='rejected',decided_by=?,decided_at=?,decision_note=?,version=version+1 WHERE id=? AND status='requested' AND version=?").run(u.id,time,note,x.id,x.version).changes!==1)staleRun();
    audit(db,u,'payroll_run',run.id,'payroll.reversal_rejected',{reversal:'requested'},{reversal:'rejected',reversal_id:x.id},note);
    notifySubject(db,{userId:x.requested_by,kind:'payroll_reversal_rejected',subjectKind:'payroll_run',subjectId:run.id,title:`انرفض طلب عكس مسير ${run.month}`,body:'المسير باقٍ معتمد كما هو، وسبب الرفض في «الرواتب والقسائم».'});
    return getRun(db,u,run.id);
  }
  const day=riyadhToday();
  if(db.prepare("UPDATE payroll_run_reversals SET status='approved',decided_by=?,decided_at=?,decision_note=?,reversed_on=?,version=version+1 WHERE id=? AND status='requested' AND version=?").run(u.id,time,note,day,x.id,x.version).changes!==1)staleRun();
  for(const p of db.prepare("SELECT id,status FROM payroll_payments WHERE run_id=? AND status IN ('pending','approved')").all(run.id)){
    db.prepare("UPDATE payroll_payments SET status='cancelled',decision_note=?,version=version+1,updated_at=? WHERE id=?").run(`انلغى بعكس مسير ${run.month} المعتمد: ${note}`.slice(0,2000),time,p.id);
    audit(db,u,'payroll_payment',p.id,'payroll_payment.cancelled_by_reversal',{status:p.status},{status:'cancelled',reversal_id:x.id});
  }
  set("status='reversed'");
  db.prepare('UPDATE payroll_adjustments SET run_id=NULL WHERE run_id=?').run(run.id);
  audit(db,u,'payroll_run',run.id,'payroll.reversal_approved',{status:'approved'},{status:'reversed',reversal_id:x.id,reversed_on:day},note);
  // صاحب كل قسيمة يُبلَّغ أن قسيمته انسحبت؛ والإشعار لا يحمل مبلغًا (app/notices.mjs).
  for(const {user_id} of db.prepare('SELECT DISTINCT user_id FROM payroll_lines WHERE run_id=?').all(run.id))
    notifySubject(db,{userId:user_id,kind:'payroll_run_reversed',subjectKind:'payroll_run',subjectId:run.id,title:`انسحبت قسيمة راتب ${run.month}`,
      body:'المسير انعكس قبل صرفه لتصحيح فيه، وقسيمتك المصححة تطلع لك إذا انعتمد المسير من جديد.'});
  notifySubject(db,{userId:x.requested_by,kind:'payroll_reversal_approved',subjectKind:'payroll_run',subjectId:run.id,title:`انعتمد عكس مسير ${run.month}`,body:'الشهر مفتوح لمسير مصحَّح يعدّه مُعد الرواتب، وقيد العكس ينتظر في «القوائم المالية والترحيل».'});
  return getRun(db,u,run.id);
}

export function runAction(db,supplied,runId,action,input){
  writing(db);
  const u=staff(db,supplied);
  const fields={recalculate:[],submit_run:[],cancel_run:['note'],justify:['line_id','note'],pass_review:['note'],return_run:['note'],approve_run:['note'],price_leave_effect:['effect_id','note'],
    propose_early_pay:['pay_on','reason'],confirm_early_pay:['note'],reject_early_pay:['note'],withdraw_early_pay:['note'],
    request_run_reversal:['reason'],approve_run_reversal:['note'],reject_run_reversal:['note']}[action];
  if(!fields)fail(404,'not_found','ما فيه إجراء بهذا الاسم على المسير');
  v.object(input,['version',...fields]);
  const run=getRun(db,u,runId);
  v.version(input.version,run.version);
  // العكس: ما يمنعه يُرفض باسمه ومالكه قبل «الإجراء غير متاح»، واعتماد الطالب لطلبه رفضٌ يسمّي من يقرره.
  if(['request_run_reversal','approve_run_reversal'].includes(action)&&run.status==='approved'&&run.reversal_blockers.length)blockedReversal(run,reversalBlockers(db,run));
  if(action==='approve_run_reversal'&&run.reversal?.status==='requested'&&run.reversal.requested_by===u.id)refuse(403,'self_approval',{what:`اللي طلب عكس مسير ${run.month} ما يعتمده`,
    missing:[{document:'قرار زميل يحمل اعتماد الرواتب غير طالب العكس',why:'العكس يفتح شهرًا مقفلًا ويلغي تحويله المعدّ، فلا يقرره شخص واحد',owner:'معتمد الرواتب',owner_role:'payroll.approve'}],
    next:'يقرره زميل يحمل اعتماد الرواتب؛ يظهر عنده في «بانتظار قراري»'});
  if(!run.actions.includes(action))fail(409,'action_unavailable','ما ينفع هذا الإجراء في حالة المسير الحالية، ولا هو من صلاحيتك. اللي أعدّ ما يراجع، واللي راجع ما يعتمد');
  // كل كتابة على المسير مشروطة بالنسخة التي قُرئت وتحقق منها الطلب: كتابةٌ وقعت بين القراءة والكتابة تُرفض ولا يُكتب فوقها.
  const time=now(),set=(sql,...args)=>{if(db.prepare(`UPDATE payroll_runs SET ${sql},version=version+1,updated_at=? WHERE id=? AND version=?`).run(...args,time,run.id,run.version).changes!==1)staleRun();};
  // قرار تاريخ الصرف لا يمس المسير نفسه: سجل مستقل بالشهر، فلا يصطدم بقفل المسير المعتمد ولا يُلغى بإلغائه وإعادة إعداده.
  if(['propose_early_pay','confirm_early_pay','reject_early_pay','withdraw_early_pay'].includes(action))return earlyPayAction(db,u,run,action,input,time);
  if(['request_run_reversal','approve_run_reversal','reject_run_reversal'].includes(action))return reversalAction(db,u,run,action,input,time,set);
  if(action==='recalculate')calculate(db,u,run);
  // سقوف الاستقطاع المقبولة (م51، م116) مانعة: لا يُرسل مسير للمراجعة ولا يُعتمد وفيه حسم يتجاوز السقف.
  if(['submit_run','approve_run'].includes(action)){const blocks=blockingRuleChecks(db,u.tenant_id,run);if(blocks.length)fail(409,'deduction_cap',`ما ينرسل المسير ولا ينعتمد: ${blocks.map(b=>`${b.title} (${b.article})`).join('؛ ')}`);}
  // موظف بلا حالة تأمينات لا يُخمَّن له خصم ولا يمر صامتًا: المسودة تُعد وتُعرض «غير متاح»، والاعتماد يمتنع باسم كل ناقص.
  if(['submit_run','approve_run'].includes(action))assertCasesResolved(db,u.tenant_id,run);
  // D-01a: أثر أجر معتمد بلا سعر يعني خصمًا سقط من المسير. لا يُقدَّم مسير ولا يُعتمد وفيه بند بانتظار التسعير.
  if(['submit_run','approve_run'].includes(action)&&run.pending_pricing.length)
    fail(409,'pricing_required',`فيه خصوم إجازات معتمدة بانتظار التسعير وما دخلت المسير (${run.pending_pricing.length}): ${run.pending_pricing.map(x=>`${x.employee_name} — ${x.month} — ${x.lost_days} يوم أجر${x.priceable?' (جاهز للتسعير)':` (${x.blocked_note})`}`).join('؛ ')}. سعّرها أو ألغِ إجازاتها قبل تقديم المسير`);
  // سلامة المدخلات (P4-HR-2): ما احتُسب منه المسير هو ما يُقدَّم ويُراجَع ويُعتمد؛ وإلا يمتنع الإجراء باسم ما تغيّر. تأتي بعد البوابات
  // المسمّاة أعلاه: حين يكون ما تغيّر قاعدةَ التأمينات أو حالةَ موظف، فرفض «حالات التأمينات» يسمّي السطر والحالة بدقة أكبر.
  if(['submit_run','pass_review','approve_run'].includes(action))assertInputsCurrent(db,run);
  if(action==='submit_run'){if(!run.headcount)fail(409,'empty_run','ما فيه موظف بعقد ساري في هذا الشهر');set("status='in_review'");}
  if(action==='cancel_run'){set("status='cancelled',decision_note=?",v.text(input.note,'سبب الإلغاء',2000,10));db.prepare('UPDATE payroll_adjustments SET run_id=NULL WHERE run_id=?').run(run.id);}
  if(action==='justify'){
    const line=run.lines.find(l=>l.id===input.line_id&&l.variance_flag);
    if(!line)fail(404,'not_found','السطر ما فيه فرق يستدعي تبرير');
    db.prepare('UPDATE payroll_lines SET variance_note=? WHERE id=?').run(v.text(input.note,'تبرير الفرق',2000,10),line.id);set('review_note=review_note');
  }
  if(action==='price_leave_effect'){
    // التسعير لا يعتمد الخصم: يولّد حركة «مقترحة» يعتمدها حامل تصريح اعتماد الرواتب كأي حركة أخرى.
    priceLeaveEffect(db,u,input.effect_id,v.text(input.note,'سند التسعير',2000,10));
    set('review_note=review_note');
  }
  if(action==='pass_review')set("status='reviewed',reviewed_by=?,reviewed_at=?,review_note=?",u.id,time,v.text(input.note,'ما الذي راجعته',2000,10));
  if(action==='return_run')set("status='draft',reviewed_by=NULL,reviewed_at=NULL,decision_note=?",v.text(input.note,'سبب الإعادة',2000,10));
  if(action==='approve_run')set("status='approved',approved_by=?,approved_at=?,decision_note=?",u.id,time,input.note?v.text(input.note,'ملاحظة الاعتماد',2000):'');
  audit(db,u,'payroll_run',run.id,'payroll.'+action,{status:run.status},{version:run.version+1});
  return getRun(db,u,run.id);
}
