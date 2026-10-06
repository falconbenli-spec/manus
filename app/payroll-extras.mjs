import { randomUUID } from 'node:crypto';
import { integrationStatus } from './integration-readiness.mjs';
import { audit, now, hash } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { holds } from './access.mjs';
import { acceptedPolicy } from './hr-contracts.mjs';
import { seal, unseal } from './crypto-fields.mjs';
import { acceptedRule, assertAdvanceWithinCap, assertClassWithinCap, unpaidLeaveDays, excludedServiceDays, settlementUnpaidRule, endedBy, duesDueOn, duesCountdown, roundMoney, roundingMode, riyadhToday as todayInRiyadh } from './payroll-rules.mjs';
// بوابة إخلاء الطرف (D-01b) وإشعار المغادر (D-15). الاستيراد متبادل مع lifecycle.mjs (تقرأ outstandingAdvances من هنا)،
// والاستعمال في الحالتين داخل جسم دالة لا عند التحميل، فالدورة تُحل كما تُحل في وحدات المنصة الأخرى.
import { clearanceBlockers } from './lifecycle.mjs';
import { settlementNotice } from './module-notices.mjs';
import { refuse, actorOrRefuse } from './refusal.mjs';
import { riyadhDateOf } from './riyadh-time.mjs';
// الإجازة التعويضية (ترحيل 125). الاستيراد متبادل مع leave-compensatory.mjs (تستدعي proposeAdjustment من هنا) والاستعمال في الحالتين داخل جسم دالة.
import { settlementCompensatoryGate, settlementCarryBlocker, unsettledTimeOff } from './leave-compensatory.mjs';
// أسماء حالات المسير للرفض الذي يسمّي شهرًا مقفلًا. الاستيراد متبادل مع payroll.mjs (تقرأ mySettlement من هنا)، والاستعمال داخل جسم دالة.
import { STATUS_NAMES as RUN_STATUS_NAMES } from './payroll.mjs';
// P4-HR-5: الشهر الموازي يدفعه النظام السابق (الترحيل 176). سطر واحد في كل مسار مال: app/payroll-parallel-guard.mjs.
import { assertPlatformPays, dropParallelMonths } from './payroll-parallel-guard.mjs';
// محاسبة الرواتب (الحزمة 4، P4-HR-3): لا يُعتمد تحويل قبل ترحيل قيد مسيره (D5)، ومن يسجّل صرف السلفة. الوحدة لا تستورد الدفتر ولا هذه الوحدة عند التحميل.
import { journalBeforeTransfer, canRecordDisbursement } from './payroll-ledger.mjs';

// ما يحيط بالمسير: الإضافات والخصومات والسلف، حسابات رواتب الموظفين وملف التحويل ودفع المسير، وتسوية نهاية الخدمة.
// القاعدة في كلها: من يقترح لا يعتمد، وصاحب الشأن لا يقرر لنفسه، والأموال لا تتحرك من المنصة.
export const ADJUSTMENT_KINDS=[['overtime','عمل إضافي'],['bonus','مكافأة'],['allowance','بدل لمرة واحدة'],['deduction','خصم']].map(([key,name])=>({key,name}));
// م51 (ص 19 من النسخة الموقعة): «لا يجوز حسم أي مبلغ من أجور العامل لقاء حقوقه دون موافقة خطيّة منه الا في الحلالات التالية». حركة الخصم تحمل سندًا واحدًا:
// موافقة العامل الخطية (تُسجَّل إلكترونيًا بهويته كما في طلبات المزايا) أو إحدى الحالات الست بترقيمها المطبوع. الأخطاء المطبعية في الأصل لا تُصحَّح هنا.
export const DEDUCTION_CASES=[
  {key:'employer_loan',item:1,name:'استرداد قروض صاحب العمل (م51/1: لا يزيد ما يُحسم على 10% من الأجر)',cap:'loan'},
  {key:'social_insurance',item:2,name:'اشتراكات التأمينات الاجتماعية المستحقة على العامل ومقررة نظامًا (م51/2)'},
  {key:'savings_fund',item:3,name:'اشتراكات العامل في صندوق الادخار والقروض المستحقة للصندوق (م51/3)'},
  {key:'housing_instalment',item:4,name:'أقساط مشروع صاحب العمل لبناء المساكن بقصد تمليكها للعمال أو أي مزية أخرى (م51/4)'},
  {key:'fine',item:5,name:'الغرامات التي توقع على العامل بسبب المخالفات التي يرتكبها (م51/5؛ سقفها في م116)',cap:'fines'},
  {key:'damage',item:5,name:'المبلغ الذي يقتطع من العامل مقابل ما أتلفه (م51/5)'},
  {key:'court_order',item:6,name:'استيفاء دين إنفاذًا لحكم قضائي (م51/6: لا يزيد ما يُحسم شهريًا على ربع الأجر المستحق ما لم يتضمن الحكم خلاف ذلك)',cap:'court'}
];
export const DEDUCTION_BASIS_NAMES={consent:'موافقة العامل الخطية (م51، صدر المادة)',exception:'حالة من الحالات الست في م51',not_a_deduction:'أجر غير مستحق أصلًا (أثر إجازة)، ليس حسمًا تحكمه م51',legacy:'اقتُرحت قبل اشتراط سند م51 (الترحيل 133)'};
// نص الإقرار الذي يوافق عليه العامل بهويته، على نسق CONSENT_TEXT في طلبات المزايا؛ يُلحق به المبلغ والشهر والسبب فتُحفظ الجملة كما قُرئت.
export const DEDUCTION_CONSENT_TEXT='أقر بموافقتي الخطية على حسم المبلغ الموضح أدناه من أجري، وأعلم أن المادة 51 من لائحة تنظيم العمل تمنع الحسم من الأجر لقاء حقوقي بغير موافقتي الخطية إلا في الحالات الست المذكورة فيها.';
export const END_REASONS=[['employer_termination','إنهاء من صاحب العمل'],['contract_expiry','انتهاء مدة العقد'],['resignation','استقالة'],['other','حالة أخرى تُوثق']].map(([key,name])=>({key,name}));
const CAPS=['payroll.prepare','payroll.review','payroll.approve'];
const riyadhToday=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const id=()=>randomUUID();
const halfUp=(n,d)=>Number((BigInt(n)*2n+BigInt(d))/(BigInt(d)*2n));
const nextMonth=(month,offset)=>{const [y,m]=month.split('-').map(Number),date=new Date(Date.UTC(y,m-1+offset,1));return date.toISOString().slice(0,7);};

function staff(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');u.caps=CAPS.filter(key=>holds(db,u,key));if(!u.caps.length)fail(403,'not_permitted','هذه الشاشة لحاملي تصريح الرواتب الصريح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
function need(u,key,message){if(!u.caps.includes(key))fail(403,'not_permitted',message);}
function month(value){if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))fail(400,'invalid_month','الشهر بصيغة 2026-09');return value;}
function money(value,label){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value))fail(400,'invalid_money',`${label}: مبلغ بخانتين عشريتين كحد أقصى`);
  const [whole,fraction='']=value.split('.'),minor=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(minor<=0)fail(400,'invalid_money',`${label}: مبلغ موجب`);return minor;
}
function employee(db,u,userId){
  const person=db.prepare("SELECT id,name,tenant_id FROM users WHERE id=? AND tenant_id=? AND active=1 AND role<>'admin'").get(userId,u.tenant_id);
  if(!person)fail(404,'not_found','الموظف غير متاح');
  if(person.id===u.id)fail(409,'separation_of_duties','لا يقترح الموظف لنفسه');
  return person;
}
function cleanIban(value){
  const iban=v.text(value,'رقم الآيبان',40,15).replace(/\s+/g,'').toUpperCase();
  if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)||(iban.startsWith('SA')&&iban.length!==24))fail(400,'invalid_iban','صيغة الآيبان غير صحيحة');
  const numeric=(iban.slice(4)+iban.slice(0,4)).replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));let r=0;for(const d of numeric)r=(r*10+Number(d))%97;
  if(r!==1)fail(400,'invalid_iban','رقم الآيبان لا يجتاز فحص الصيغة');return iban;
}
const name=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;

export function outstandingAdvances(db,userId){
  return db.prepare("SELECT COALESCE(SUM(a.amount_minor),0) AS n FROM payroll_adjustments a LEFT JOIN payroll_runs r ON r.id=a.run_id WHERE a.user_id=? AND a.kind='advance_installment' AND a.status='approved' AND (a.run_id IS NULL OR r.status<>'approved')").get(userId).n;
}

export function extrasBoard(db,supplied){
  const u=staff(db,supplied),today=riyadhToday();
  const decide=(row,who)=>row.status==='proposed'&&row.proposed_by!==u.id&&row.user_id!==u.id&&u.caps.includes(who);
  // مصدر الحركة ومآلها في المسير، لتقولها الشاشة لا لتخمّنها من نص السبب (الترحيل 173): خصمُ أثرِ إجازة وحالُ أثره (مسحوب بعد إلغائها؟ ورُدّ؟)،
  // أو ردُّ خصمِ إجازةٍ أُلغيت بعد صرفه، وشهر المسير المعتمد الذي صُرفت فيه. والأشهر التي تجاوز مسيرها المسودة: لا تُعتمد عليها حركة
  // ولا قسط سلفة (month_locked في decideRow)، فتقولها الشاشة قبل أن يضغط المعتمد زرًّا يُرفض.
  const runs=new Map(db.prepare('SELECT id,month,status FROM payroll_runs WHERE tenant_id=?').all(u.tenant_id).map(r=>[r.id,r]));
  const paidIn=runId=>runs.get(runId)?.status==='approved'?runs.get(runId).month:null;
  const effects=new Map(db.prepare('SELECT adjustment_id,status,month FROM leave_pay_effects WHERE tenant_id=? AND adjustment_id IS NOT NULL').all(u.tenant_id).map(r=>[r.adjustment_id,r]));
  const refunds=db.prepare('SELECT deduction_id,paid_run_id,refund_id FROM leave_pay_effect_refunds WHERE tenant_id=?').all(u.tenant_id);
  const refundOf=new Map(refunds.map(r=>[r.refund_id,r])),refunded=new Set(refunds.map(r=>r.deduction_id));
  const lockedSet=new Set([...runs.values()].filter(r=>['in_review','reviewed','approved'].includes(r.status)).map(r=>r.month));
  const adjustments=db.prepare("SELECT * FROM payroll_adjustments WHERE tenant_id=? AND kind<>'advance_installment' ORDER BY created_at DESC LIMIT 200").all(u.tenant_id).map(a=>{
    const basis=a.kind==='deduction'?deductionBasisOf(db,a.id):null,effect=effects.get(a.id),refund=refundOf.get(a.id);
    return {...a,employee_name:name(db,a.user_id),proposed_by_name:name(db,a.proposed_by),decided_by_name:name(db,a.decided_by),kind_name:ADJUSTMENT_KINDS.find(k=>k.key===a.kind)?.name,
      // سند الخصم (م51) يراه المعتمد قبل قراره: الحالة بترقيمها، أو موافقة العامل ووقتها، أو أنها سبقت اشتراط السند.
      deduction_basis:basis?{basis:basis.basis,basis_name:basis.basis_name,case_name:basis.case_name,item:basis.item,reference:basis.reference,consent_pending:basis.consent_pending,consent_at:basis.consent_at,consent_by_name:name(db,basis.consent_by)}:null,
      leave_effect:effect?{status:effect.status,month:effect.month,refunded:refunded.has(a.id)}:null,
      leave_refund:refund?{paid_run_month:runs.get(refund.paid_run_id)?.month??null}:null,
      paid_run_month:paidIn(a.run_id),
      // الاعتماد لا يُعرض حيث يرفضه decideRow (شهرٌ تجاوز مسيره المسودة، أو أثر إجازة انسحب): الصندوق يقرأ هذه القائمة نفسها،
      // فكان يعرض «اعتماد» يُرفض عند الضغط. الرفض يبقى متاحًا دائمًا.
      actions:decide(a,'payroll.approve')?[...(lockedSet.has(a.month)||effect?.status==='withdrawn'?[]:['approve_adjustment']),'reject_adjustment']:[]};});
  const lockedMonths=[...runs.values()].filter(r=>['in_review','reviewed','approved'].includes(r.status))
    .map(r=>({month:r.month,status:r.status,status_name:RUN_STATUS_NAMES[r.status]})).sort((a,b)=>b.month.localeCompare(a.month));
  // صرف السلفة (الترحيل 174): يسجّله حامل المراجعة أو الاعتماد غير صاحبها ومقترحها ومعتمدها، مرة واحدة؛ وهو مستند «صرف سلفة موظف» في الدفتر.
  const advances=db.prepare('SELECT * FROM salary_advances WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200').all(u.tenant_id).map(a=>({...a,employee_name:name(db,a.user_id),proposed_by_name:name(db,a.proposed_by),decided_by_name:name(db,a.decided_by),disbursed_by_name:name(db,a.disbursed_by),outstanding_minor:a.status==='approved'?db.prepare("SELECT COALESCE(SUM(x.amount_minor),0) AS n FROM payroll_adjustments x LEFT JOIN payroll_runs r ON r.id=x.run_id WHERE x.advance_id=? AND (x.run_id IS NULL OR r.status<>'approved')").get(a.id).n:null,
    actions:[...(decide(a,'payroll.approve')?['approve_advance','reject_advance']:[]),...(canRecordDisbursement(u,a)?['record_disbursement']:[])]}));
  const banks=db.prepare('SELECT * FROM employee_bank_accounts WHERE tenant_id=? ORDER BY created_at DESC LIMIT 300').all(u.tenant_id).map(b=>({id:b.id,user_id:b.user_id,employee_name:name(db,b.user_id),bank_name:b.bank_name,iban_masked:`••••${b.iban_last4}`,status:b.status,effective_month:b.effective_month,recorded_by_name:name(db,b.recorded_by),decided_by_name:name(db,b.decided_by),actions:b.status==='pending'&&b.recorded_by!==u.id&&u.caps.includes('payroll.approve')?['verify_employee_bank','reject_employee_bank']:[]}));
  const payments=db.prepare('SELECT p.*,r.month FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id WHERE p.tenant_id=? ORDER BY p.created_at DESC').all(u.tenant_id).map(p=>{
    const actions=[];
    // D5 (الحزمة 4، P4-HR-3): التحويل ما ينعتمد قبل ما يترحّل قيد مسيره. الزر لا يُعرض قبلها، والشاشة تقول ما الناقص وعند من.
    const journal_gate=p.status==='pending'?journalBeforeTransfer(db,u.tenant_id,{id:p.run_id,month:p.month}):null;
    if(p.status==='pending'&&p.prepared_by!==u.id&&u.caps.includes('payroll.approve')&&!journal_gate)actions.push('approve_payment');
    // تسجيل التنفيذ يفحص المُعِدّ **والمعتمِد** معًا، كما يفعل المسير نفسه في app/payroll.mjs:187.
    // كان يفحص المُعِدّ وحده، فمن يحمل payroll.approve وpayroll.review يعتمد ملف التحويل (وفيه
    // آيبانات الموظفين) ثم يسجّل تنفيذه بمرجع بنكي ودليل من كتابته هو — خطوتان من أربع في مسار
    // المال بشخص واحد. وقياس 29 سبتمبر 2026 على قاعدة التشغيل: حساب واحد يحمل التصريحين معًا.
    if(p.status==='approved'&&p.prepared_by!==u.id&&p.approved_by!==u.id&&u.caps.includes('payroll.review'))actions.push('record_payment_execution');
    if(['pending','approved'].includes(p.status)&&(p.prepared_by===u.id||u.caps.includes('payroll.approve')))actions.push('cancel_payment');
    return {...p,prepared_by_name:name(db,p.prepared_by),approved_by_name:name(db,p.approved_by),execution_recorded_by_name:name(db,p.execution_recorded_by),journal_gate,actions};
  });
  const payable=db.prepare("SELECT r.id,r.month,r.net_minor,r.headcount FROM payroll_runs r WHERE r.tenant_id=? AND r.status='approved' AND NOT EXISTS(SELECT 1 FROM payroll_payments p WHERE p.run_id=r.id AND p.status<>'cancelled') ORDER BY r.month DESC").all(u.tenant_id);
  dropParallelMonths(db,u.tenant_id,payable);
  const settlements=db.prepare('SELECT * FROM service_settlements WHERE tenant_id=? ORDER BY created_at DESC').all(u.tenant_id).map(s=>{
    const rule=settlementRuleView(db,s,today),actions=s.status==='draft'&&s.prepared_by!==u.id&&s.user_id!==u.id&&u.caps.includes('payroll.approve')?['approve_settlement','reject_settlement']:[];
    // ومثله صرف مستحقات المخالصة: من اعتمدها لا يسجّل صرفها.
    if(s.status==='approved'&&rule&&!rule.dues_paid_on&&s.prepared_by!==u.id&&s.user_id!==u.id&&s.decided_by!==u.id&&(u.caps.includes('payroll.review')||u.caps.includes('payroll.approve')))actions.push('record_dues_payment');
    return {...s,basis:JSON.parse(s.basis),employee_name:name(db,s.user_id),prepared_by_name:name(db,s.prepared_by),decided_by_name:name(db,s.decided_by),reason_name:END_REASONS.find(r=>r.key===s.end_reason).name,rule,actions};
  });
  const ended=db.prepare("SELECT c.id,c.user_id,c.ended_on,x.name FROM employment_contracts c JOIN users x ON x.id=c.user_id WHERE c.tenant_id=? AND c.status='ended' AND c.end_reason NOT LIKE 'حل محله عقد معدل%' AND NOT EXISTS(SELECT 1 FROM service_settlements s WHERE s.contract_id=c.id AND s.status<>'rejected') ORDER BY c.ended_on DESC").all(u.tenant_id);
  const employees=db.prepare("SELECT id,name FROM users WHERE tenant_id=? AND active=1 AND role<>'admin' AND id<>? ORDER BY name").all(u.tenant_id,u.id);
  const eosPolicy=acceptedPolicy(db,u.tenant_id,'end_of_service',today);
  return {today,user_id:u.id,permissions:u.caps,adjustment_kinds:ADJUSTMENT_KINDS,deduction_cases:DEDUCTION_CASES,deduction_basis_names:DEDUCTION_BASIS_NAMES,deduction_consent_text:DEDUCTION_CONSENT_TEXT,end_reasons:END_REASONS,employees,adjustments,advances,banks,payments,payable_runs:payable,settlements,ended_contracts:ended,locked_months:lockedMonths,
    eos_policy:eosPolicy?{id:eosPolicy.id,title:eosPolicy.title}:null,
    note:'ملف تحويل الرواتب ملف داخلي لإدخاله في بنك الشركة. ليس قبولًا مصرفيًا ولا رفعًا لحماية الأجور (مدد)، وتسوية نهاية الخدمة مسودة تُحسب من سياسة معتمدة وتحتاج مراجعة نظامية.'};
}

// سند الخصم (م51) كما يصل: من الوحدة المستدعية (basis في الوسائط الداخلية: {kind:'exception',case,reference} أو {kind:'consent',consent_text,consent_by,consent_at}
// أو {kind:'not_a_deduction',reference})، أو من نموذج الشاشة (deduction_basis وdeduction_case وdeduction_reference في input)، وإلا — وحدةٌ لم تسمِّ سندها —
// موافقةً معلقة يقرّها العامل بهويته قبل أن تُعتمد الحركة. لا حركة خصم بلا صف سند بعد الترحيل 133.
function deductionBasis(input,given){
  if(given){
    if(!['consent','exception','not_a_deduction'].includes(given.kind))throw new TypeError('proposeAdjustment: سند الخصم من الوحدة المستدعية غير معروف — consent أو exception أو not_a_deduction');
    return given;
  }
  if(!Object.hasOwn(input,'deduction_basis'))return {kind:'consent',reference:'لم تسمِّ الوحدة المقترِحة سندًا من م51؛ تُعتمد بموافقة العامل بهويته'};
  const choice=input.deduction_basis;
  if(choice==='consent')return {kind:'consent',reference:typeof input.deduction_reference==='string'?input.deduction_reference.trim():''};
  const found=DEDUCTION_CASES.find(c=>c.key===choice);
  if(!found)refuse(400,'deduction_basis_required',{what:'لا تُقترح حركة خصم من الأجر بسبب حر وحده',
    missing:[{document:'سند الخصم: موافقة العامل الخطية، أو إحدى الحالات الست في م51 بسندها',why:'م51 (ص 19 من النسخة الموقعة): لا يجوز حسم أي مبلغ من أجور العامل لقاء حقوقه دون موافقة خطية منه إلا في الحالات المذكورة',owner:'مُعد الرواتب يختار السند، والعامل يقرّ الموافقة بهويته',owner_role:'payroll.prepare'}],
    next:`اختر «${DEDUCTION_BASIS_NAMES.consent}» فيُقرّها العامل من شاشته قبل الاعتماد، أو إحدى الحالات: ${DEDUCTION_CASES.map(c=>c.name).join('؛ ')}`});
  return {kind:'exception',case:found.key,reference:v.text(input.deduction_reference,'سند الحالة: رقم الحكم أو القضية أو القرار أو الاشتراك',300,3)};
}
// يكتب صف السند بجوار الحركة. الحالات ذات السقف (قرض 10%، حكم ربع الأجر، غرامة م116) تُصنَّف في payroll_adjustment_classes أيضًا فتدخل سقوف المسير (102)،
// ما لم تكن الوحدة المستدعية قد صنّفتها بنفسها (class_recorded). موافقةٌ مسجلة من قبل بهوية العامل تُنقل كما هي؛ وإلا تبقى معلقة حتى يقرّ.
export function recordDeductionBasis(db,u,adjustmentId,basis,{person=null,month:m=null,amountMinor=null}={}){
  const time=now();
  if(basis.kind==='exception'){
    const found=DEDUCTION_CASES.find(c=>c.key===basis.case);
    if(!found)throw new TypeError(`recordDeductionBasis: حالة م51 غير معروفة: ${String(basis.case)}`);
    if(found.cap&&!basis.class_recorded){
      if(person&&m&&amountMinor!==null&&!basis.cap_checked)assertClassWithinCap(db,u.tenant_id,person.id,m,found.key,amountMinor);
      db.prepare('INSERT INTO payroll_adjustment_classes(adjustment_id,tenant_id,class,reference,source_kind,source_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(adjustmentId,u.tenant_id,found.key,basis.reference,basis.source_kind??null,basis.source_id??null,u.id,time);
    }
    db.prepare("INSERT INTO payroll_deduction_basis(adjustment_id,tenant_id,basis,exception_case,reference,recorded_by,created_at) VALUES(?,?,'exception',?,?,?,?)").run(adjustmentId,u.tenant_id,found.key,basis.reference,u.id,time);
    return {basis:'exception',exception_case:found.key,item:found.item};
  }
  if(basis.kind==='not_a_deduction'){
    db.prepare("INSERT INTO payroll_deduction_basis(adjustment_id,tenant_id,basis,reference,recorded_by,created_at) VALUES(?,?,'not_a_deduction',?,?,?)").run(adjustmentId,u.tenant_id,v.text(basis.reference,'لماذا ليس حسمًا تحكمه م51',600,10),u.id,time);
    return {basis:'not_a_deduction'};
  }
  const consented=basis.consent_at&&basis.consent_by&&basis.consent_text;
  // الموافقة بهوية صاحب الأجر وحده (م51، صدر المادة): وحدة تمرر موافقة مسجلة باسم غيره تُرفض قبل الكتابة، والقادح (الترحيل 135) يحرس الإدخال
  // كما يحرس القادح (133) التعديل — مراجعة 22 سبتمبر: كان صف يُدخَل بموافقة باسم غير صاحب الأجر يمر ويُعتمد.
  if(consented){
    const owner=person?.id??db.prepare('SELECT user_id FROM payroll_adjustments WHERE id=?').get(adjustmentId)?.user_id??null;
    if(basis.consent_by!==owner)refuse(409,'consent_owner',{what:`موافقة الخصم المنقولة مسجلة بهوية ${name(db,basis.consent_by)??basis.consent_by} لا بهوية صاحب الأجر؛ لا يوافق أحد عن العامل`,
      missing:[{document:'موافقة العامل الخطية بهويته هو',why:'م51 (ص 19 من النسخة الموقعة): لا يجوز حسم أي مبلغ من أجور العامل لقاء حقوقه دون موافقة خطية منه',owner:name(db,owner)??'صاحب الأجر',owner_role:'employee'}],
      next:'تُقترح الحركة بلا موافقة منقولة فيقرّها العامل بهويته من شاشة «الرواتب» ← «خصومات تنتظر موافقتي»، أو بحالة من حالات م51 الست بسندها'});
  }
  db.prepare("INSERT INTO payroll_deduction_basis(adjustment_id,tenant_id,basis,reference,consent_text,consent_by,consent_at,recorded_by,created_at) VALUES(?,?,'consent',?,?,?,?,?,?)")
    .run(adjustmentId,u.tenant_id,basis.reference??'',consented?basis.consent_text:null,consented?basis.consent_by:null,consented?basis.consent_at:null,u.id,time);
  return {basis:'consent',consent_pending:!consented};
}
export function deductionBasisOf(db,adjustmentId){
  const b=db.prepare('SELECT * FROM payroll_deduction_basis WHERE adjustment_id=?').get(adjustmentId);
  if(!b)return null;
  const found=b.exception_case?DEDUCTION_CASES.find(c=>c.key===b.exception_case):null;
  return {...b,basis_name:DEDUCTION_BASIS_NAMES[b.basis],case_name:found?.name??null,item:found?.item??null,consent_pending:b.basis==='consent'&&!b.consent_at,consent_by_name:null};
}
// linked: وسيط داخلي لا يصل من مسار HTTP (الخادم يمرر input وحده). يضعه من يحيل ساعات مرتبطة بسجلها: تحويل عمل إضافي معتمد، أو إحالة رصيد تعويضي.
// basis: سند الخصم من الوحدة المستدعية (انظر deductionBasis)؛ لا يصل من HTTP.
export function proposeAdjustment(db,supplied,input,{linked=false,basis=null}={}){
  writing(db);const u=staff(db,supplied);need(u,'payroll.prepare','اقتراح الإضافات والخصومات لمُعد الرواتب');
  v.object(input,['user_id','kind','month','amount','reason','deduction_basis','deduction_case','deduction_reference']);
  if(!ADJUSTMENT_KINDS.some(k=>k.key===input.kind))fail(400,'kind','اختر نوع الحركة');
  const person=employee(db,u,input.user_id),m=month(input.month);
  // م51: سند الخصم يُحسم قبل أي كتابة، فرفضه لا يترك حركة بلا سند.
  const deduction=input.kind==='deduction'?deductionBasis(input,basis):null;
  // الباب اليدوي: حركة «عمل إضافي» تُكتب باليد لا ترتبط بطلبها، فقد تدفع ساعات عُوِّضت بإجازة تعويضية. لا تُقاس بشهر الحركة: أجر آخر الشهر يُصرف
  // عادةً في مسير الشهر التالي، والاختيار يسبق اعتماده. تُرفض ما دام لصاحبها ساعات اختار لها الإجازة ولم تُسوَّ بعد (طلب قائم، أو معتمد لم يُقيَّد،
  // أو رصيد لم يُستعمل كله إجازةً ولم يُحل كله أجرًا). يبقى الطريق المرتبط (شاشة الحضور) مفتوحًا لما اختير له الأجر، وطريق الإحالة لما انقضت مهلة رصيده.
  if(input.kind==='overtime'&&!linked){
    const open=unsettledTimeOff(db,u.tenant_id,person.id);
    if(open.length)refuse(409,'compensated_by_leave',{what:`لا تُقترح حركة «عمل إضافي» يدوية لـ${person.name}: له ${open.length} طلب عمل إضافي اختار له الإجازة التعويضية بدل الأجر ولم يُسوَّ بعد (${open.slice(0,4).map(o=>`${o.work_date} ${o.state_name}`).join('، ')}${open.length>4?'…':''})`,
      next:'الساعة لا تُعوَّض مرتين (نظام العمل م107/1)، والحركة اليدوية لا ترتبط بطلبها فلا يُعرف أي ساعات تدفع. ما اختير له الأجر يُحوَّل من «الحضور والانصراف» ← «تحويل إلى المسير» فيرتبط بطلبه، وما انقضت مهلة رصيده يُحال من «أرصدة تعويضية مستحقة الصرف»',link:'#attendance'});
  }
  if(db.prepare("SELECT 1 FROM payroll_runs WHERE tenant_id=? AND month=? AND status IN ('in_review','reviewed','approved')").get(u.tenant_id,m))fail(409,'month_locked','مسير هذا الشهر تجاوز المسودة. اقترح الحركة لشهر لاحق');
  const adjustmentId=id(),amountMinor=money(input.amount,'المبلغ');
  db.prepare("INSERT INTO payroll_adjustments(id,tenant_id,user_id,kind,month,amount_minor,reason,status,proposed_by,created_at) VALUES(?,?,?,?,?,?,?,'proposed',?,?)").run(adjustmentId,u.tenant_id,person.id,input.kind,m,amountMinor,v.text(input.reason,'السبب والسند',2000,10),u.id,now());
  const recorded=deduction?recordDeductionBasis(db,u,adjustmentId,deduction,{person,month:m,amountMinor}):null;
  audit(db,u,'payroll_adjustment',adjustmentId,'adjustment.proposed',{}, {user_id:person.id,kind:input.kind,month:m,...(recorded?{deduction_basis:recorded.basis,...(recorded.exception_case?{exception_case:recorded.exception_case,article:`م51/${recorded.item}`}:{}),...(recorded.consent_pending?{consent_pending:true}:{})}:{})});
  return {id:adjustmentId,...(recorded?{deduction_basis:recorded.basis,consent_pending:!!recorded.consent_pending}:{})};
}
// موافقة العامل الخطية على خصم مقترح من أجره (م51، صدر المادة)، بهويته ووقتها ونصها كما في طلبات المزايا: لا يقرّها أحد عنه، ولا تُعتمد الحركة قبلها.
export function consentToDeduction(db,supplied,adjustmentId,input){
  writing(db);
  const u=actorOrRefuse(db,supplied);
  v.object(input,['consent']);
  const a=typeof adjustmentId==='string'&&db.prepare("SELECT * FROM payroll_adjustments WHERE id=? AND tenant_id=? AND kind='deduction'").get(adjustmentId,u.tenant_id);
  const b=a?deductionBasisOf(db,a.id):null;
  if(!a||a.user_id!==u.id||!b)refuse(404,'not_found',{what:'حركة الخصم غير متاحة لموافقتك',next:'تُقرّ الموافقة على خصم مقترح من أجرك أنت، من شاشة «الرواتب» ← «خصومات تنتظر موافقتي»'});
  if(b.basis!=='consent')refuse(409,'consent_not_needed',{what:`هذه الحركة سندها ${b.basis_name}${b.case_name?` — ${b.case_name}`:''} ولا تحتاج موافقتك`,next:'لا شيء يُطلب منك؛ للاعتراض استخدم خدمة «استفسار أو تصحيح في الراتب»'});
  if(b.consent_at)refuse(409,'already_consented',{what:'سُجلت موافقتك على هذا الخصم من قبل',next:'لا تُسجَّل مرتين'});
  if(a.status!=='proposed')refuse(409,'decided',{what:'حُسمت هذه الحركة من قبل',next:'لا موافقة على حركة اعتُمدت أو رُفضت'});
  if(input.consent!==true)refuse(400,'consent_required',{what:'الخصم من الأجر لا يجوز بغير موافقتك الخطية (م51)',next:`اقرأ الإقرار وأكّده في النموذج: «${DEDUCTION_CONSENT_TEXT}»`});
  const text=`${DEDUCTION_CONSENT_TEXT} المبلغ: ${(a.amount_minor/100).toFixed(2)} ريال. شهر المسير: ${a.month}. السبب: ${a.reason}`,time=now();
  db.prepare('UPDATE payroll_deduction_basis SET consent_text=?,consent_by=?,consent_at=? WHERE adjustment_id=?').run(text,u.id,time,a.id);
  audit(db,u,'payroll_adjustment',a.id,'adjustment.consented',{consent_pending:true},{consent_pending:false,amount_minor:a.amount_minor,month:a.month});
  return {id:a.id,consent_text:text,consent_at:time};
}
// خصومات مقترحة من أجري تنتظر موافقتي: لصاحب الأجر وحده، تُقرأ من شاشة الرواتب.
export function myDeductionConsents(db,supplied){
  const u=currentUser(db,supplied);if(!u)return [];
  return db.prepare("SELECT a.* FROM payroll_adjustments a JOIN payroll_deduction_basis b ON b.adjustment_id=a.id WHERE a.tenant_id=? AND a.user_id=? AND a.kind='deduction' AND a.status='proposed' AND b.basis='consent' AND b.consent_at IS NULL ORDER BY a.created_at").all(u.tenant_id,u.id)
    .map(a=>({id:a.id,month:a.month,amount_minor:a.amount_minor,reason:a.reason,proposed_by_name:name(db,a.proposed_by),created_at:a.created_at,consent_text:DEDUCTION_CONSENT_TEXT,
      note:`لا تُعتمد هذه الحركة ولا تدخل المسير قبل موافقتك الخطية (م51)؛ الموافقة بهويتك من هذه الشاشة، والاعتراض بخدمة «استفسار أو تصحيح في الراتب». ${CONSENT_ROUTE_NOTE}`}));
}
// الزر «أقرّ الموافقة بهويتي» في شاشة الرواتب يرسل إلى POST /api/payroll/adjustments/:id/consent، وهو موصول في app/server.mjs
// (الحزمة 4، P4-HR-2) بحراسة الجلسة وCSRF والمصدر كبقية مسارات الكتابة. كان الملصق يقول ماذا يعني أن يرد الزر 404 حين لم يكن موصولًا؛
// صار يقول الحقيقة الجديدة: الموافقة بهوية العامل وحده من شاشته، وما يردّه المسار لغيره «غير متاح».
export const CONSENT_ROUTE='/api/payroll/adjustments/:id/consent';
export const CONSENT_ROUTE_NOTE=`الموافقة تُسجَّل بهوية العامل وحده من شاشته (${CONSENT_ROUTE})؛ لا يقرّها أحد عنه، وحتى يقرّها تبقى الحركة معلقة ولا تُعتمد.`;
// شهرٌ تجاوز مسيره المسودة (قيد المراجعة، أو روجِع، أو اعتُمد) لا يُعاد احتسابه، فما يُعتمد له بعدها كان يُعتمد ولا يُدفع أبدًا.
const lockedRun=(db,tenantId,month)=>db.prepare("SELECT id,month,status FROM payroll_runs WHERE tenant_id=? AND month=? AND status IN ('in_review','reviewed','approved')").get(tenantId,month)??null;
function monthLocked(db,row,run,advance){
  const approved=run.status==='approved';
  refuse(409,'month_locked',{what:`ما ${advance?'تنعتمد سلفة':'تنعتمد حركة'} ${name(db,row.user_id)} على شهر ${run.month}: مسيره «${RUN_STATUS_NAMES[run.status]}»، فما يدخله شيء جديد`,
    missing:[{document:approved?'شهر لاحق ما اعتُمد مسيره':`مسير ${run.month} راجع للمسودة`,why:'الحركة المعتمدة تدخل المسير عند احتسابه، ومسيرٌ تجاوز المسودة ما يُعاد احتسابه؛ فكانت تُعتمد ولا تُدفع',
      owner:approved?'مُعد الرواتب':'مراجع الرواتب أو معتمده',owner_role:approved?'payroll.prepare':'payroll.review'}],
    next:approved?`ارفضها بسبب مكتوب، ويقترحها مُعد الرواتب ${advance?'بشهر بداية لاحق':'لشهر لاحق'}`:'يعيد المراجع أو المعتمد المسير إلى المسودة، ثم تُعتمد ويُعاد احتسابه — أو ارفضها وتُقترح لشهر لاحق',link:'#payroll-extras'});
}
function decideRow(db,u,table,rowId,decision,input,entity){
  v.object(input,['note']);
  if(!['approve','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  need(u,'payroll.approve','الاعتماد لحامل تصريح اعتماد الرواتب');
  const row=typeof rowId==='string'&&db.prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=? AND status='proposed'`).get(rowId,u.tenant_id);
  if(!row)fail(404,'not_found','السجل غير متاح للقرار');
  if(row.proposed_by===u.id||row.user_id===u.id)fail(409,'separation_of_duties','من اقترح الحركة أو صاحبها لا يعتمدها');
  // الاعتماد وحده يُحرس بالشهر؛ الرفض يبقى متاحًا دائمًا. السلفة تُحرس بكل شهر من أشهر أقساطها.
  if(decision==='approve'){
    const advance=table==='salary_advances',months=advance?Array.from({length:row.installments},(_,i)=>nextMonth(row.first_month,i)):[row.month];
    for(const month of months){const run=lockedRun(db,u.tenant_id,month);if(run)monthLocked(db,row,run,advance);}
  }
  const status=decision==='approve'?'approved':'rejected';
  db.prepare(`UPDATE ${table} SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?`).run(status,u.id,now(),v.text(input.note,'أساس القرار',2000,decision==='approve'?3:10),row.id);
  audit(db,u,entity,row.id,`${entity}.${status}`,{status:'proposed'},{status});
  return {...row,status};
}
export function decideAdjustment(db,supplied,adjustmentId,decision,input){
  writing(db);const u=staff(db,supplied);
  // خصم أثر إجازة أُلغيت وسُحب أثرها: لا سند له بعد الإلغاء، فلا يُعتمد. يُرفض بسبب مكتوب.
  const withdrawn=decision==='approve'&&typeof adjustmentId==='string'?db.prepare("SELECT month FROM leave_pay_effects WHERE adjustment_id=? AND tenant_id=? AND status='withdrawn'").get(adjustmentId,u.tenant_id):null;
  if(withdrawn)refuse(409,'leave_effect_withdrawn',{what:`ما تنعتمد هذه الحركة: الإجازة اللي ولّدتها انلغت وانسحب أثرها على أجر ${withdrawn.month}`,
    next:'ارفض الحركة بسبب مكتوب؛ أجر تلك الأيام ما عاد مخصومًا',link:'#payroll-extras'});
  // م51 عند الاعتماد: حركة خصم بلا صف سند لا تُعتمد (طريق لم يسمِّ سنده)، وسند «موافقة» بلا موافقة العامل ينتظرها. الحركات التي سبقت الترحيل 133 صفها «legacy» فتمر.
  if(decision==='approve'){
    const a=typeof adjustmentId==='string'?db.prepare("SELECT * FROM payroll_adjustments WHERE id=? AND tenant_id=? AND kind='deduction' AND status='proposed'").get(adjustmentId,u.tenant_id):null;
    if(a){
      const b=deductionBasisOf(db,a.id),who=name(db,a.user_id);
      if(!b)refuse(409,'deduction_basis_missing',{what:`لا تُعتمد حركة خصم ${who} لشهر ${a.month}: لا سند لها من م51`,
        missing:[{document:'سند الخصم: موافقة العامل الخطية أو إحدى الحالات الست في م51',why:'م51 (ص 19): لا يجوز الحسم من الأجر لقاء حقوق العامل بغير موافقته الخطية إلا في الحالات المذكورة',owner:'مُعد الرواتب',owner_role:'payroll.prepare'}],
        next:'يرفض معتمد الرواتب الحركة بسبب مكتوب ويقترحها مُعد الرواتب من جديد بسندها'});
      if(b.consent_pending)refuse(409,'consent_required',{what:`لا تُعتمد حركة خصم ${who} لشهر ${a.month} (${(a.amount_minor/100).toFixed(2)} ريال) قبل موافقته الخطية`,
        missing:[{document:'موافقة العامل الخطية على الخصم، مسجلة بهويته ووقتها ونصها',why:'م51 (ص 19 من النسخة الموقعة): لا يجوز حسم أي مبلغ من أجور العامل لقاء حقوقه دون موافقة خطية منه؛ وهذه الحركة ليست من الحالات الست',owner:who,owner_role:'employee'}],
        next:`يقرّ العامل الموافقة من شاشة «الرواتب» ← «خصومات تنتظر موافقتي». ${CONSENT_ROUTE_NOTE} فإن لم يوافق رُفضت الحركة بسبب مكتوب أو أُعيد اقتراحها بحالة من حالات م51 بسندها`,link:'#payroll'});
    }
  }
  const row=decideRow(db,u,'payroll_adjustments',adjustmentId,decision,input,'payroll_adjustment');return {id:row.id,status:row.status};
}

export function proposeAdvance(db,supplied,input){
  writing(db);const u=staff(db,supplied);need(u,'payroll.prepare','اقتراح السلف لمُعد الرواتب');
  v.object(input,['user_id','amount','installments','first_month','reason']);
  const person=employee(db,u,input.user_id),amount=money(input.amount,'مبلغ السلفة');
  if(!Number.isInteger(input.installments)||input.installments<1||input.installments>24)fail(400,'installments','عدد الأقساط من 1 إلى 24');
  const first=month(input.first_month);
  if(first<riyadhToday().slice(0,7))fail(400,'first_month','يبدأ الاسترداد من الشهر الحالي أو بعده');
  const contract=db.prepare("SELECT monthly_total_minor FROM employment_contracts WHERE user_id=? AND status='active'").get(person.id);
  if(!contract)fail(409,'contract_required','لا سلفة لموظف بلا عقد ساري في المنصة');
  // م51/1: القسط الشهري لا يتجاوز سقف القرض من الأجر متى قبل مدير الموارد البشرية سياسة سقوف الاستقطاع.
  assertAdvanceWithinCap(db,u.tenant_id,person.id,amount,input.installments,first);
  const advanceId=id();
  db.prepare("INSERT INTO salary_advances(id,tenant_id,user_id,amount_minor,installments,first_month,reason,status,proposed_by,created_at) VALUES(?,?,?,?,?,?,?,'proposed',?,?)").run(advanceId,u.tenant_id,person.id,amount,input.installments,first,v.text(input.reason,'سبب السلفة وسندها',2000,10),u.id,now());
  audit(db,u,'salary_advance',advanceId,'advance.proposed',{}, {user_id:person.id,installments:input.installments});
  return {id:advanceId};
}
export function decideAdvance(db,supplied,advanceId,decision,input){
  writing(db);const u=staff(db,supplied),row=decideRow(db,u,'salary_advances',advanceId,decision,input,'salary_advance');
  if(row.status==='approved'){
    // الأقساط متساوية والباقي على القسط الأخير، وتُنشأ معتمدة لأن اعتماد السلفة هو اعتماد جدولها.
    const each=Math.floor(row.amount_minor/row.installments);
    for(let i=0;i<row.installments;i++){
      const amount=i===row.installments-1?row.amount_minor-each*(row.installments-1):each;
      db.prepare("INSERT INTO payroll_adjustments(id,tenant_id,user_id,kind,month,amount_minor,reason,advance_id,status,proposed_by,decided_by,decided_at,created_at) VALUES(?,?,?,'advance_installment',?,?,?,?,'approved',?,?,?,?)").run(id(),u.tenant_id,row.user_id,nextMonth(row.first_month,i),amount,`قسط ${i+1} من ${row.installments} لسلفة معتمدة`,row.id,row.proposed_by,u.id,now(),now());
    }
  }
  return {id:row.id,status:row.status};
}

export function recordEmployeeBank(db,supplied,input){
  writing(db);const u=staff(db,supplied);need(u,'payroll.prepare','تسجيل حسابات الرواتب لمُعد الرواتب');
  v.object(input,['user_id','bank_name','iban','effective_month','evidence']);
  const person=employee(db,u,input.user_id),iban=cleanIban(input.iban);
  if(db.prepare("SELECT 1 FROM employee_bank_accounts WHERE user_id=? AND status='pending'").get(person.id))fail(409,'pending_exists','يوجد حساب بانتظار التحقق لهذا الموظف');
  const bankId=id();
  db.prepare("INSERT INTO employee_bank_accounts(id,tenant_id,user_id,bank_name,iban,iban_last4,evidence,status,recorded_by,effective_month,created_at) VALUES(?,?,?,?,?,?,?,'pending',?,?,?)").run(bankId,u.tenant_id,person.id,v.text(input.bank_name,'اسم البنك',180,2),seal(iban),iban.slice(-4),v.text(input.evidence,'دليل ملكية الحساب ومصدر الطلب',2000,10),u.id,month(input.effective_month),now());
  audit(db,u,'employee_bank',bankId,'employee_bank.recorded',{}, {user_id:person.id});
  return {id:bankId};
}
export function decideEmployeeBank(db,supplied,bankId,decision,input){
  writing(db);const u=staff(db,supplied);need(u,'payroll.approve','التحقق من حسابات الرواتب لمعتمد الرواتب');
  v.object(input,['note']);
  if(!['verify','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  const b=typeof bankId==='string'&&db.prepare("SELECT * FROM employee_bank_accounts WHERE id=? AND tenant_id=? AND status='pending'").get(bankId,u.tenant_id);
  if(!b)fail(404,'not_found','الحساب غير متاح للقرار');
  if(b.recorded_by===u.id)fail(409,'separation_of_duties','من سجل الحساب لا يتحقق منه');
  const status=decision==='verify'?'verified':'rejected';
  db.prepare('UPDATE employee_bank_accounts SET status=?,decided_by=?,decided_at=?,decision_note=? WHERE id=?').run(status,u.id,now(),v.text(input.note,'أساس التحقق',2000,10),b.id);
  audit(db,u,'employee_bank',b.id,'employee_bank.'+status,{status:'pending'},{status});
  return {id:b.id,status};
}
const activeEmployeeBank=(db,userId,runMonth)=>db.prepare("SELECT * FROM employee_bank_accounts WHERE user_id=? AND status='verified' AND effective_month<=? ORDER BY effective_month DESC,decided_at DESC LIMIT 1").get(userId,runMonth)??null;

// ملف التحويل: سطر لكل موظف بحسابه المتحقق منه وصافيه. الخلايا النصية تُحمى من أن تُفسر صيغًا في برامج الجداول.
const csvCell=value=>{const text=String(value??'');const safe=/^[=+\-@\t\r]/.test(text)?`'${text}`:text;return /[",\n]/.test(safe)?`"${safe.replace(/"/g,'""')}"`:safe;};
function transferFile(db,run){
  const lines=db.prepare('SELECT l.user_id,l.net_minor,x.name FROM payroll_lines l JOIN users x ON x.id=l.user_id WHERE l.run_id=? AND l.net_minor>0 ORDER BY x.name').all(run.id);
  const missing=[],rows=[['employee_id','employee_name','bank_name','iban','net_amount_sar','month']];
  for(const l of lines){const bank=activeEmployeeBank(db,l.user_id,run.month);if(!bank){missing.push(l.name);continue;}rows.push([l.user_id,l.name,bank.bank_name,unseal(bank.iban),(l.net_minor/100).toFixed(2),run.month]);}
  return {missing,count:rows.length-1,total:lines.reduce((n,l)=>n+l.net_minor,0),csv:'﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n'};
}
export function preparePayrollPayment(db,supplied,input){
  writing(db);const u=staff(db,supplied);need(u,'payroll.prepare','إعداد دفع المسير لمُعد الرواتب');
  v.object(input,['run_id']);
  const run=typeof input.run_id==='string'&&db.prepare("SELECT * FROM payroll_runs WHERE id=? AND tenant_id=? AND status='approved'").get(input.run_id,u.tenant_id);
  if(!run)fail(404,'not_found','المسير المعتمد غير متاح');
  assertPlatformPays(db,u.tenant_id,run.month,'payment');
  if(db.prepare("SELECT 1 FROM payroll_payments WHERE run_id=? AND status<>'cancelled'").get(run.id))fail(409,'payment_exists','للمسير دفع قائم');
  const file=transferFile(db,run);
  if(file.missing.length)fail(409,'bank_accounts_missing',`موظفون بلا حساب راتب متحقق منه: ${file.missing.join('، ')}`);
  const paymentId=id(),time=now();
  db.prepare("INSERT INTO payroll_payments(id,tenant_id,run_id,amount_minor,headcount,file_digest,status,prepared_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?,?)").run(paymentId,u.tenant_id,run.id,file.total,file.count,hash(file.csv),u.id,time,time);
  audit(db,u,'payroll_payment',paymentId,'payroll_payment.prepared',{}, {month:run.month,headcount:file.count});
  return {id:paymentId};
}
// الملف يُولَّد عند الطلب ولا يُخزَّن؛ بصمته محفوظة ليُكتشف أي تغير في الحسابات بين الإعداد والتنزيل.
export function payrollPaymentFile(db,supplied,paymentId){
  const u=staff(db,supplied);
  const p=typeof paymentId==='string'&&db.prepare("SELECT p.*,r.month FROM payroll_payments p JOIN payroll_runs r ON r.id=p.run_id WHERE p.id=? AND p.tenant_id=? AND p.status IN ('approved','executed')").get(paymentId,u.tenant_id);
  if(!p)fail(404,'not_found','ملف التحويل متاح بعد اعتماد الدفع فقط');
  const file=transferFile(db,db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(p.run_id));
  if(hash(file.csv)!==p.file_digest)fail(409,'file_changed','تغيرت حسابات الموظفين بعد إعداد الدفع. ألغِ الدفع وأعد إعداده');
  audit(db,u,'payroll_payment',p.id,'payroll_payment.file_downloaded',{}, {month:p.month,simulated:true});
  // الحزمة 3: تنفيذ التحويل محاكاة حتى يوجد وصول بنكي معتمد (app/integration-readiness.mjs، جهة «البنك»). الملف يقول ذلك في أول
  // سطر وفي اسمه، والاستجابة تقوله؛ والبصمة المحفوظة بصمة السطور نفسها بلا العلامة، فتبقى مقارنة التغيّر كما هي.
  const marker=`SIMULATED,${csvCell('ملف محاكاة من منصة 3,6T: ما يُرفع لبنك ولا يحوّل ريالًا. التحويل ينفّذه البنك ويُسجَّل تنفيذه يدويًا بمرجعه')}`;
  return {filename:`payroll-transfer-${p.month}-SIMULATED.csv`,content:file.csv.replace(/^\ufeff/,`\ufeff${marker}\r\n`),simulated:true,integration_status:integrationStatus('bank')};
}
export function payrollPaymentAction(db,supplied,paymentId,action,input){
  writing(db);const u=staff(db,supplied);
  const fields={approve_payment:['note'],cancel_payment:['note'],record_payment_execution:['executed_on','bank_reference','evidence']}[action];
  if(!fields)fail(404,'not_found','الإجراء غير متاح');
  v.object(input,['version',...fields]);
  const p=extrasBoard(db,u).payments.find(x=>x.id===paymentId);
  if(!p)fail(404,'not_found','الدفع غير متاح');
  v.version(input.version,p.version);
  // D5: لمن يملك الاعتماد، الرفض يسمّي القيد الناقص ومالكه بدل «الإجراء غير متاح».
  if(action==='approve_payment'&&p.journal_gate&&p.prepared_by!==u.id&&u.caps.includes('payroll.approve'))refuse(409,'payroll_journal_unposted',p.journal_gate);
  if(!p.actions.includes(action))fail(409,'action_unavailable','الإجراء غير متاح في حالة الدفع الحالية أو لصلاحيتك');
  const time=now(),set=(sql,...args)=>db.prepare(`UPDATE payroll_payments SET ${sql},version=version+1,updated_at=? WHERE id=?`).run(...args,time,p.id);
  if(action==='approve_payment'){
    if(hash(transferFile(db,db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(p.run_id)).csv)!==p.file_digest)fail(409,'file_changed','تغيرت حسابات الموظفين بعد إعداد الدفع. ألغِ الدفع وأعد إعداده');
    set("status='approved',approved_by=?,approved_at=?,decision_note=?",u.id,time,v.text(input.note,'أساس الاعتماد',2000,3));
  }
  if(action==='cancel_payment')set("status='cancelled',decision_note=?",v.text(input.note,'سبب الإلغاء',2000,10));
  if(action==='record_payment_execution'){
    const executed=v.date(input.executed_on);
    // يوم اعتماد الدفع بتوقيت الرياض: approved_at طابع UTC، وأول عشرة أحرف منه تسبق يوم الرياض بيوم بين 00:00 و03:00.
    if(executed>riyadhToday()||executed<riyadhDateOf(p.approved_at))fail(400,'executed_on','تاريخ التنفيذ بين اعتماد الدفع واليوم');
    set("status='executed',executed_on=?,bank_reference=?,execution_evidence=?,execution_recorded_by=?",executed,v.text(input.bank_reference,'المرجع البنكي',120,4).toUpperCase(),v.text(input.evidence,'دليل التنفيذ',3000,10),u.id);
  }
  audit(db,u,'payroll_payment',p.id,'payroll_payment.'+action,{status:p.status},{version:p.version+1});
  return extrasBoard(db,u).payments.find(x=>x.id===p.id);
}

// مكافأة نهاية الخدمة من السياسة المعتمدة: أجر الأساس × (سنوات الشريحة الأولى × معدلها + ما بعدها × معدله) × معامل سبب الإنهاء.
export function computeSettlement(params,{wageBase,serviceDays,reason,leaveDays,dailyWage,advances}){
  const yearsBp=halfUp(serviceDays*10000,365),firstBp=Math.min(yearsBp,params.first_years*10000),laterBp=Math.max(0,yearsBp-firstBp);
  // حساب بأعداد كبيرة صحيحة: حاصل الضرب يتجاوز دقة الأعداد العادية قبل القسمة.
  const product=BigInt(wageBase)*(BigInt(firstBp)*BigInt(params.first_rate_bp)+BigInt(laterBp)*BigInt(params.later_rate_bp)),full=Number((product*2n+100000000n)/200000000n);
  const years=Math.floor(serviceDays/365);
  const factor=reason==='resignation'?[...params.resignation_tiers].reverse().find(t=>years>=t.min_years).factor_bp:params.reason_factors_bp[reason];
  const award=halfUp(full*factor,10000),leave=halfUp(dailyWage*leaveDays,1);
  return {award_minor:award,leave_payout_minor:leave,net_minor:award+leave-advances,detail:{service_years_bp:yearsBp,completed_years:years,full_award_minor:full,reason_factor_bp:factor}};
}
export function prepareSettlement(db,supplied,input){
  writing(db);const u=staff(db,supplied);need(u,'payroll.prepare','إعداد التسوية لمُعد الرواتب');
  v.object(input,['contract_id','end_reason','leave_days','evidence','death']);
  if(!END_REASONS.some(r=>r.key===input.end_reason))fail(400,'end_reason','صنّف سبب الإنهاء؛ لا تُحسب التسوية بمعادلة واحدة لكل الحالات');
  if(input.death!==undefined&&typeof input.death!=='boolean')fail(400,'death','حدد إن كان الإنهاء بالوفاة');
  const death=input.death===true;
  if(death&&input.end_reason!=='other')fail(400,'death','الوفاة تُصنف «حالة أخرى تُوثق» مع تحديد الوفاة');
  const contract=typeof input.contract_id==='string'&&db.prepare("SELECT * FROM employment_contracts WHERE id=? AND tenant_id=? AND status='ended'").get(input.contract_id,u.tenant_id);
  if(!contract)fail(404,'not_found','التسوية لعقد منتهٍ مسجل');
  if(contract.user_id===u.id)fail(409,'separation_of_duties','لا يعد الموظف تسويته');
  if(db.prepare("SELECT 1 FROM service_settlements WHERE contract_id=? AND status<>'rejected'").get(contract.id))fail(409,'settlement_exists','للعقد تسوية قائمة');
  const policy=acceptedPolicy(db,u.tenant_id,'end_of_service',contract.ended_on);
  if(!policy)fail(409,'policy_required','لا توجد سياسة نهاية خدمة اعتمدها مدير الموارد البشرية سارية في تاريخ انتهاء العقد');
  const params=JSON.parse(policy.parameters);
  if(!Number.isInteger(input.leave_days)||input.leave_days<0||input.leave_days>365)fail(400,'leave_days','أيام الإجازة المستحقة من 0 إلى 365');
  // مدة الخدمة من أول عقد للموظف في المنصة، فالعقود المعدلة خدمة متصلة.
  const start=db.prepare("SELECT MIN(start_date) AS d FROM employment_contracts WHERE user_id=? AND status IN ('active','ended')").get(contract.user_id).d;
  const spanDays=Math.round((Date.parse(contract.ended_on)-Date.parse(start))/86400000)+1;
  // قواعد اللائحة المقبولة (م36/2، م50/2، م91/3، م38/3). قبل قبولها تُحسب التسوية كما كانت وتُعلَّم بأن القراءة لم تُختر، فلا تُعتمد.
  const rule=acceptedRule(db,u.tenant_id,'settlement',contract.ended_on),rp=rule?.parameters??null;
  // حد الإجازة بلا أجر وطريقة حسمه: قرار واحد يُقرأ من سياسة أنواع الإجازات إن حُسم فيها، وإلا من سياسة المخالصة.
  const unpaidRule=settlementUnpaidRule(db,u.tenant_id,contract.ended_on);
  const unpaid=unpaidLeaveDays(db,contract.user_id,start,contract.ended_on,unpaidRule?.unpaid_leave_types??rp?.unpaid_leave_types??['unpaid','synthetic_unpaid']),excluded=excludedServiceDays(unpaid,unpaidRule);
  const serviceDays=spanDays-excluded;
  if(serviceDays<=0)fail(409,'service_days','مدة الخدمة بعد حسم الإجازات بلا أجر ليست موجبة');
  const lines=JSON.parse(contract.pay_lines),wageBase=lines.filter(l=>params.wage_base.includes(l.component)).reduce((n,l)=>n+l.amount_minor,0);
  const advances=outstandingAdvances(db,contract.user_id),mode=roundingMode(db,u.tenant_id,contract.ended_on);
  const calcParams=death?{...params,reason_factors_bp:{...params.reason_factors_bp,death:rp?.death_award_factor_bp??params.reason_factors_bp.other}}:params;
  const readings=settlementReadings(calcParams,{wageBase,serviceDays,reason:death?'death':input.end_reason,leaveDays:input.leave_days,dailyWage:halfUp(contract.monthly_total_minor,30),advances});
  const chosen=rp?.art36_reading??null,picked=readings[chosen??'labor_law'];
  const award=roundMoney(picked.award_minor,mode),leave=roundMoney(picked.leave_payout_minor,mode),result={...picked,award_minor:award,leave_payout_minor:leave,net_minor:award+leave-advances};
  if(result.net_minor<0)fail(409,'negative_settlement','السلف القائمة تتجاوز المستحقات؛ تُعالج بقرار موثق خارج التسوية الآلية');
  const settlementId=id(),by=endedBy(input.end_reason),time=now();
  db.prepare("INSERT INTO service_settlements(id,tenant_id,user_id,contract_id,policy_id,end_reason,service_start,service_end,service_days,wage_base_minor,award_minor,leave_days,leave_payout_minor,advances_outstanding_minor,net_minor,basis,evidence,status,prepared_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)")
    .run(settlementId,u.tenant_id,contract.user_id,contract.id,policy.id,input.end_reason,start,contract.ended_on,serviceDays,wageBase,result.award_minor,input.leave_days,result.leave_payout_minor,advances,result.net_minor,JSON.stringify({...result.detail,policy_title:policy.title,parameters:params,daily_wage_basis:'إجمالي الراتب الشهري ÷ 30',
      art36_reading:chosen,art36_readings:{literal_award_minor:roundMoney(readings.literal.award_minor,mode),labor_law_award_minor:roundMoney(readings.labor_law.award_minor,mode)},
      calendar_service_days:spanDays,unpaid_leave_days:unpaid,excluded_service_days:excluded,rounding:mode,death,regulation_policy_id:rule?.id??null}),v.text(input.evidence,'مستند إنهاء الخدمة ورصيد الإجازة',3000,10),u.id,time);
  db.prepare('INSERT INTO settlement_rule_basis(settlement_id,tenant_id,policy_id,art36_reading,literal_award_minor,labor_law_award_minor,unpaid_leave_days,excluded_days,ended_by,death,heirs_month_wage_minor,rounding,dues_due_on,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(settlementId,u.tenant_id,rule?.id??null,chosen,roundMoney(readings.literal.award_minor,mode),roundMoney(readings.labor_law.award_minor,mode),unpaid,excluded,by,death?1:0,death?roundMoney(contract.monthly_total_minor,mode):null,mode,duesDueOn(contract.ended_on,by,rp),time);
  audit(db,u,'service_settlement',settlementId,'settlement.prepared',{}, {user_id:contract.user_id,end_reason:input.end_reason,death,art36_reading:chosen,excluded_service_days:excluded});
  return {id:settlementId};
}
// D-01b: بوابة إخلاء الطرف. سطر واحد يصف كل مانع: ما هو، وكم، ومن يقفله.
const blockerLine=b=>`${b.title}${b.amount_minor?` (${(b.amount_minor/100).toFixed(2)} SAR)`:''}${b.action_owner?` — ${b.action_owner}`:''}`;
export function decideSettlement(db,supplied,settlementId,decision,input){
  writing(db);const u=staff(db,supplied);need(u,'payroll.approve','اعتماد التسوية لمعتمد الرواتب');
  v.object(input,['note','clearance_override']);
  if(!['approve','reject'].includes(decision))fail(404,'not_found','الإجراء غير متاح');
  const s=typeof settlementId==='string'&&db.prepare("SELECT * FROM service_settlements WHERE id=? AND tenant_id=? AND status='draft'").get(settlementId,u.tenant_id);
  if(!s)fail(404,'not_found','التسوية غير متاحة للقرار');
  if(s.prepared_by===u.id||s.user_id===u.id)fail(409,'separation_of_duties','من أعد التسوية أو صاحبها لا يعتمدها');
  let blockers=[],override=null;
  if(decision==='approve'){
    // م36/2: لا تُعتمد مخالصة قبل أن يختار مدير الموارد البشرية قراءة المادة في سياسة المخالصة، وتُحسب المخالصة بها.
    const rule=acceptedRule(db,u.tenant_id,'settlement',s.service_end),basis=db.prepare('SELECT * FROM settlement_rule_basis WHERE settlement_id=?').get(s.id);
    if(!rule?.parameters.art36_reading)fail(409,'art36_reading_required','لا تُعتمد مخالصة قبل أن يقبل مدير الموارد البشرية سياسة المخالصة ويختار فيها قراءة م36/2 (الحرفية أو نظام العمل)');
    if(!basis||basis.art36_reading!==rule.parameters.art36_reading||basis.policy_id!==rule.id)fail(409,'art36_reading_mismatch','أُعدت هذه المخالصة قبل قبول سياسة المخالصة السارية أو بقراءة أخرى. ارفضها وأعد إعدادها');
    // م77(6) من لائحة الشركة (ص 27) واللائحة التنفيذية م22 مكرر/4: يُدفع الأجر الإضافي نقدًا إذا انتهت الخدمة قبل استعمال الإجازة. لا تُعتمد مخالصة ورصيده لم يُحل إلى المسير.
    const owed=settlementCompensatoryGate(db,u.tenant_id,s.user_id);
    // إجازة معتمدة بعد انتهاء الخدمة: ساعاتها مخصومة ولن تؤخذ، فليست «مستعملة». تُلغى أولًا فتعود إلى قيودها وتصير مستحقة الصرف.
    if(owed?.untaken.length)refuse(409,'compensatory_leave_untaken',{what:`لا تُعتمد مخالصة ${name(db,s.user_id)} وله إجازة تعويضية معتمدة لن تؤخذ: ${owed.untaken.map(x=>`${x.hours} ساعة من ${x.start_date} إلى ${x.end_date}`).join('، ')}، وخدمته انتهت في ${owed.untaken[0].ended_on}`,
      missing:[{document:'إلغاء الإجازة التعويضية المعتمدة التي تقع بعد انتهاء الخدمة',why:'ساعاتها خُصمت من الرصيد ولن تؤخذ إجازةً، وللعامل أجر إجازاته التعويضية المستحقة إذا ترك العمل قبل استعمالها (اللائحة التنفيذية م22 مكرر/4)',owner:'خدمات الموظف في نطاق إدارة صاحبها',owner_role:'hr'}],
      next:'تلغي خدمات الموظف الإجازة من «الإجازات» بسبب مكتوب، فتعود ساعاتها إلى قيودها نفسها وتظهر في «أرصدة تعويضية مستحقة الصرف» ليحيلها مُعد الرواتب. إن أُخذ جزء منها قبل انتهاء الخدمة خفّض مُعد الرواتب المبلغ عند الإحالة بأساس مكتوب',link:'#leave'});
    if(owed?.routable_minutes)refuse(409,'compensatory_unpaid',{what:`لا تُعتمد مخالصة ${name(db,s.user_id)} وله رصيد إجازة تعويضية ${owed.routable_hours} ساعة لم يُحل إلى المسير`,
      missing:[{document:'حركة مسير مقترحة عن الرصيد التعويضي الباقي',why:'يُدفع الأجر الإضافي نقدًا إذا انتهت خدمة العامل لأي سبب قبل استعماله للإجازة التعويضية (م77(6) من لائحة الشركة، ص 27؛ واللائحة التنفيذية م22 مكرر/4)',owner:'مُعد الرواتب',owner_role:'payroll.prepare'}],
      next:'يحيلها مُعد الرواتب من «الحضور والانصراف» ← «أرصدة تعويضية مستحقة الصرف»، وإن كان منها محجوز لطلب إجازة قائم فيُبت في الطلب أولًا. إن كان مسير شهر ترك العمل قيد المراجعة قال الرفض هناك من يعيده إلى المسودة',link:'#attendance'});
    // إخلاء الطرف يُقرأ لحظة القرار لا من قائمة قديمة: عهدة أو معدة أو أصل أو سلفة ما زالت قائمة تمنع الاعتماد.
    // ومعها ما لا مسير يحمله من الرصيد التعويضي (مسير شهر ترك العمل اعتُمد): بند مفتوح بمبلغه المقترح، يُحمل على المخالصة بالقرار المكتوب نفسه ويُحفظ معها.
    const clearance=clearanceBlockers(db,u,s.user_id),carry=settlementCarryBlocker(owed);
    blockers=carry?[...clearance.blockers,carry]:clearance.blockers;
    if(blockers.length){
      if(input.clearance_override===undefined)
        fail(409,'clearance_open',`لا تُعتمد التسوية النهائية وبنود إخلاء الطرف مفتوحة (${blockers.length}): ${blockers.map(blockerLine).join('؛ ')}. تُقفل في شاشاتها بأدلتها، أو يتجاوزها حامل تصريح التوظيف والتهيئة بسبب مكتوب`);
      // التجاوز ليس لمعتمد الرواتب بصفته تلك: هو قرار من يملك المغادرة وإخلاء الطرف (people.manage)، بسبب مكتوب ومسجَّل.
      if(!holds(db,u,'people.manage'))fail(403,'not_permitted','تجاوز بنود إخلاء الطرف لحامل تصريح التوظيف والتهيئة (people.manage) وحده. أقفل البنود في شاشاتها، أو اطلب التجاوز ممن يملكه');
      override=v.text(input.clearance_override,'سبب تجاوز بنود إخلاء الطرف ومن أقرّه',2000,20);
    }
  }
  const status=decision==='approve'?'approved':'rejected',time=now();
  db.prepare('UPDATE service_settlements SET status=?,decided_by=?,decided_at=?,decision_note=?,clearance_blockers=?,clearance_override_by=?,clearance_override_reason=?,clearance_override_at=? WHERE id=?')
    .run(status,u.id,time,v.text(input.note,'أساس القرار والتحقق النظامي',2000,10),JSON.stringify(blockers),override?u.id:null,override,override?time:null,s.id);
  audit(db,u,'service_settlement',s.id,'settlement.'+status,{status:'draft'},{status,clearance_blockers:blockers.length,clearance_overridden:!!override});
  if(override)audit(db,u,'service_settlement',s.id,'settlement.clearance_overridden',{blocked:true},{blockers},override);
  if(status==='approved'){
    const basis=db.prepare('SELECT dues_due_on,dues_paid_on FROM settlement_rule_basis WHERE settlement_id=?').get(s.id);
    const countdown=basis?duesCountdown(basis.dues_due_on,basis.dues_paid_on,todayInRiyadh()):null;
    settlementNotice(db,u,s,{dues_due_on:basis?.dues_due_on??null,days_left:countdown?.days_left??null});
  }
  return {id:s.id,status,clearance_blockers:blockers,clearance_overridden:!!override};
}

// ————— المخالصة بحسب اللائحة —————

// م36/2 بقراءتيها جنبًا إلى جنب: قراءة نظام العمل هي معادلة الشرائح المعتمدة كما هي، والحرفية تعطي معدل ما بعد الشريحة الأولى
// لكل السنوات متى بلغت الخدمة حد الشريحة الأولى. المثال: 7 سنوات بأجر 10,000 ← 45,000 مقابل 70,000.
export function settlementReadings(params,input){
  const labor=computeSettlement(params,input);
  const reached=labor.detail.service_years_bp>=params.first_years*10000;
  const literal=reached?computeSettlement({...params,first_years:0},input):labor;
  return {labor_law:labor,literal};
}
function settlementRuleView(db,s,today){
  const b=db.prepare('SELECT * FROM settlement_rule_basis WHERE settlement_id=?').get(s.id);
  if(!b)return null;
  return {art36_reading:b.art36_reading,literal_award_minor:b.literal_award_minor,labor_law_award_minor:b.labor_law_award_minor,readings_differ:b.literal_award_minor!==b.labor_law_award_minor,
    unpaid_leave_days:b.unpaid_leave_days,excluded_days:b.excluded_days,ended_by:b.ended_by,death:!!b.death,heirs_month_wage_minor:b.heirs_month_wage_minor,
    heirs_total_minor:b.death?s.net_minor+b.heirs_month_wage_minor:null,rounding:b.rounding,dues_due_on:b.dues_due_on,dues_paid_on:b.dues_paid_on,dues_reference:b.dues_reference,
    countdown:s.status==='rejected'?null:duesCountdown(b.dues_due_on,b.dues_paid_on,today),
    note:b.art36_reading?null:'قراءة م36/2 لم تُختر بعد في سياسة المخالصة؛ المبلغ المعروض بقراءة نظام العمل ولا تُعتمد المخالصة قبل الاختيار.'};
}
// D-15: مسار قراءة المخالصة لصاحبها وحده. لا تصريح رواتب هنا ولا معرّف موظف في المدخلات: الصفحة لصاحبها،
// وتُقرأ المعتمدة فقط (المسودة قرار لم يصدر بعد، والمرفوضة لا مستحق فيها). بيانات غيره لا تُقرأ من هنا أبدًا.
export function mySettlement(db,supplied,{log=false}={}){
  const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');
  const s=db.prepare("SELECT * FROM service_settlements WHERE tenant_id=? AND user_id=? AND status='approved' ORDER BY decided_at DESC LIMIT 1").get(u.tenant_id,u.id);
  if(!s)return null;
  const today=riyadhToday(),basis=JSON.parse(s.basis),rule=settlementRuleView(db,s,today);
  // القراءة المطبقة باسمها، ومبلغ القراءة الأخرى بجوارها كما تحفظهما المنصة: المغادر يرى على أي أساس حُسب مستحقه.
  const readingNames={literal:'القراءة الحرفية للمادة 36/2',labor_law:'قراءة نظام العمل للمادة 36/2'};
  const applied=rule?.art36_reading??null;
  // كل فتح صريح للمخالصة يُسجَّل كما تُسجَّل قسيمة الراتب. ظهورها ضمن لوحة الرواتب ليس فتحًا، فلا يُسجَّل.
  if(log)db.prepare('INSERT INTO settlement_views VALUES(?,?,?,?)').run(id(),s.id,u.id,now());
  return {id:s.id,status:s.status,end_reason:s.end_reason,end_reason_name:END_REASONS.find(r=>r.key===s.end_reason).name,
    service_start:s.service_start,service_end:s.service_end,service_days:s.service_days,completed_years:basis.completed_years,
    award_minor:s.award_minor,leave_days:s.leave_days,leave_payout_minor:s.leave_payout_minor,
    deductions:[{kind:'advance',name:'أقساط سلف معتمدة لم تُسدد',amount_minor:s.advances_outstanding_minor}].filter(d=>d.amount_minor>0),
    deductions_minor:s.advances_outstanding_minor,net_minor:s.net_minor,decided_at:s.decided_at,
    art36_reading:applied,art36_reading_name:applied?readingNames[applied]:null,
    art36_readings:rule?{literal_award_minor:rule.literal_award_minor,labor_law_award_minor:rule.labor_law_award_minor,readings_differ:rule.readings_differ}:null,
    art36_note:rule?.note??null,
    dues_due_on:rule?.dues_due_on??null,dues_paid_on:rule?.dues_paid_on??null,countdown:rule?.countdown??null,
    heirs_total_minor:rule?.heirs_total_minor??null,
    note:'المبالغ كما اعتمدها حامل تصريح اعتماد الرواتب. الصرف فعل بنكي خارج المنصة يُسجَّل تاريخه ومرجعه هنا؛ المنصة لا تحوّل أموالًا. للاعتراض استخدم خدمة «استفسار أو تصحيح في الراتب».',
    legal_note:'مهلة صرف المستحقات محسوبة من تاريخ انتهاء العلاقة بحسب من أنهاها (م50/2)، ومكافأة نهاية الخدمة بقراءة م36/2 التي اعتمدها مدير الموارد البشرية في سياسة المخالصة.'};
}
// م50/2: صرف المستحقات فعل خارج المنصة؛ يُسجل تاريخه ومرجعه البنكي هنا مرة واحدة ليُقاس بالمهلة.
export function recordSettlementDues(db,supplied,settlementId,input){
  writing(db);const u=staff(db,supplied);
  v.object(input,['paid_on','reference']);
  const s=extrasBoard(db,u).settlements.find(x=>x.id===settlementId);
  if(!s)fail(404,'not_found','المخالصة غير متاحة');
  if(!s.actions.includes('record_dues_payment'))fail(409,'action_unavailable','يُسجل الصرف لمخالصة معتمدة لم يُسجل صرفها، ومن غير مُعدها');
  const paid=v.date(input.paid_on);
  if(paid>todayInRiyadh()||paid<s.service_end)fail(400,'paid_on','تاريخ الصرف بين نهاية الخدمة واليوم');
  db.prepare('UPDATE settlement_rule_basis SET dues_paid_on=?,dues_reference=?,dues_recorded_by=?,dues_recorded_at=? WHERE settlement_id=?').run(paid,v.text(input.reference,'المرجع البنكي',120,4).toUpperCase(),u.id,now(),s.id);
  audit(db,u,'service_settlement',s.id,'settlement.dues_paid_recorded',{}, {paid_on:paid,within_deadline:paid<=s.rule.dues_due_on});
  return {id:s.id,within_deadline:paid<=s.rule.dues_due_on};
}
// خصم مصنف تحكمه سقوف اللائحة: حكم قضائي (م51/6) أو غرامة (م116) أو قرض لصاحب العمل (م51/1). يُقترح كحركة خصم عادية بسند «حالة من م51»،
// ويُرفض ما يتجاوز السقف. الأصناف الثلاثة هي حالات م51 ذات السقف نفسها، فيمر الاقتراح من الباب الواحد (proposeAdjustment مع basis).
export const DEDUCTION_CLASSES=[['court_order','حسم لتنفيذ حكم قضائي (م51/6)'],['fine','غرامة جزائية (م116)'],['employer_loan','قسط قرض لصاحب العمل (م51/1)']].map(([key,name])=>({key,name}));
export function proposeClassifiedDeduction(db,supplied,input){
  writing(db);const u=staff(db,supplied);need(u,'payroll.prepare','اقتراح الخصومات لمُعد الرواتب');
  v.object(input,['user_id','month','amount','reason','class','reference']);
  if(!DEDUCTION_CLASSES.some(c=>c.key===input.class))fail(400,'class','اختر صنف الخصم');
  const m=month(input.month),amount=money(input.amount,'المبلغ');
  assertClassWithinCap(db,u.tenant_id,input.user_id,m,input.class,amount);
  const {id:adjustmentId}=proposeAdjustment(db,u,{user_id:input.user_id,kind:'deduction',month:m,amount:input.amount,reason:input.reason},
    {basis:{kind:'exception',case:input.class,reference:v.text(input.reference,'سند الخصم: رقم الحكم أو القضية أو القرار',300,3),cap_checked:true}});
  audit(db,u,'payroll_adjustment',adjustmentId,'adjustment.classified',{}, {class:input.class});
  return {id:adjustmentId};
}
