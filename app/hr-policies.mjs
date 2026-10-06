import { fail } from './auth.mjs';
import { currentUser } from './delegations.mjs';
import { holds, CAPABILITIES } from './access.mjs';
import { capBasis, unpaidLeaveRule, PAY_COMPONENT_NAMES, riyadhToday, UNPAID_LEAVE_MODES } from './hr-rule-basis.mjs';
import { POLICY_KINDS } from './hr-contracts.mjs';
import { RULE_KINDS, CHOICES } from './payroll-rules.mjs';
import { unpaidLeaveBlock, compensatoryBlock } from './leave-types.mjs';
import { compensatoryRule } from './leave-compensatory.mjs';

// «سياسات الموارد البشرية»: شاشة واحدة يرى فيها مدير الموارد البشرية كل سياسة مسودة بمادتها وحالتها ومن أعدها ومتى،
// ويقبلها أو يرفضها من مكانها. قبلها كان عليه أن يمر على ست شاشات (العقود، الإجازات، استحقاق الإجازات، الجزاءات،
// قواعد اللائحة في الرواتب، إدارة المزايا) ليعرف ما الذي ينتظره.
//
// هذه الوحدة تقرأ فقط. كل قبول أو رفض يمر بنقطة النهاية الأصلية لوحدته، فتبقى قاعدة الشخصين وفحص التصريح حيث كُتبت
// أول مرة ولا يوجد طريق ثانٍ يلتف عليها. ما هنا هو العرض وقائمة الجاهزية لا غير.

export const POLICY_STORES={
  hr_policy:{name:'سياسات العقود والدوام والرواتب',module:'contracts',endpoint:'/hr/policies'},
  leave_types:{name:'أنواع الإجازات النظامية',module:'leave',endpoint:'/leave/types'},
  leave_accrual:{name:'قواعد استحقاق الإجازات',module:'leave-accrual',endpoint:'/leave-accrual/policies'},
  discipline_schedule:{name:'جدول المخالفات والجزاءات',module:'discipline',endpoint:'/discipline/schedules'},
  regulation_rule:{name:'قواعد اللائحة في الرواتب',module:'payroll-rules',endpoint:'/payroll-rules'},
  benefit:{name:'مصفوفة المزايا',module:'benefits-admin',endpoint:'/benefits-admin/catalog'}
};
export const STATUS_NAMES={draft:'مسودة بانتظار القرار',accepted:'معتمدة',rejected:'مرفوضة',retired:'استُبدلت بأحدث منها'};
// ما يبقى متوقفًا ما دامت السياسة غير معتمدة. نص صريح كي لا يظن أحد أن الميزة معطوبة.
const BLOCKED={
  'hr_policy:pay_components':['لا يُعد عقد موظف ولا يُعتمد: بنود الراتب المسموحة غير محددة.'],
  'hr_policy:working_time':['شاشة الحضور لا تحكم بتأخر ولا انصراف مبكر.','لا تسري ساعات رمضان ولا سقف الاستئذان ولا قواعد العمل الإضافي.','يوم صرف الراتب يُزاح على أسبوع تقويم الخدمات لا على أيام دوامكم.'],
  'hr_policy:payroll_cycle':['لا يُجهَّز مسير رواتب.','أثر الإجازة على الأجر يُسجَّل «غير مسعّر» بلا مبلغ.'],
  'hr_policy:end_of_service':['لا تُعد مخالصة نهاية خدمة.'],
  'leave_types:':['لا يُقبل طلب إجازة بنوع نظامي: تبقى الإجازات بالرصيد الافتتاحي وأيام العمل كما كانت.','لا يُحسب أثر الإجازة بلا أجر على الاستحقاق ولا على مدة الخدمة.'],
  'leave_accrual:':['لا يُقيَّد استحقاق سنوي آليًا؛ الرصيد من الافتتاحي وحده.'],
  'discipline_schedule:':['لا تقترح المنصة جزاءً ولا تسجل مخالفة.'],
  'regulation_rule:resignation':['ساعة القبول الحكمي للاستقالة متوقفة.'],
  'regulation_rule:settlement':['لا تُعتمد مخالصة: قراءة م36/2 غير مختارة.'],
  'regulation_rule:deductions':['سقوف الاستقطاع (م51، م116) لا تُفرض على المسير.'],
  'regulation_rule:pay_rules':['قاعدة التقريب (م50/5) وإزاحة يوم الصرف (م48) مقترحتان لا ساريتين.'],
  'regulation_rule:travel_per_diem':['لا يُحسب بدل انتداب.'],
  'regulation_rule:social_insurance':['خصم التأمينات يبقى نسبة واحدة من سياسة دورة الرواتب على كل موظف، سعوديًا كان أو غير سعودي.','لا تُحتسب حصة المنشأة في التأمينات ولا تظهر تكلفتها في أي سطر.'],
  'benefit:':['الميزة لا تظهر للموظف في «مزاياي» ولا تُقبل عليها مطالبة.']
};
const blockedFor=(store,kind)=>BLOCKED[`${store}:${kind??''}`]??BLOCKED[`${store}:`]??[];
const personName=(db,userId)=>userId?db.prepare('SELECT name FROM users WHERE id=?').get(userId)?.name??null:null;
const capabilityName=key=>CAPABILITIES.find(c=>c.key===key)?.name??key;
const anyoneHolds=(db,tenantId,capability)=>db.prepare("SELECT * FROM users WHERE tenant_id=? AND active=1 AND role<>'admin'").all(tenantId).some(p=>holds(db,p,capability));

function actor(db,supplied){
  const u=currentUser(db,supplied);
  if(!u||u.role==='admin')fail(403,'forbidden','هذه الشاشة لحسابات الموظفين');
  u.caps=['hr.policy.prepare','hr.policy.accept'].filter(k=>holds(db,u,k));
  if(!u.caps.length)fail(403,'not_permitted','شاشة سياسات الموارد البشرية لمن يعد السياسات أو يعتمدها');
  return u;
}
// القرار متاح بالقاعدة نفسها المكتوبة في وحدة كل سياسة: حامل hr.policy.accept، وليس من أعد المسودة.
const canDecide=(u,preparedBy)=>u.caps.includes('hr.policy.accept')&&preparedBy!==u.id;

function row(db,u,{store,id,kind,kind_name,title,articles,status,effective_from,prepared_by,prepared_at,decided_by,decided_at,decision_note,version,platform_draft=false,path=null,pending=[],decide_at=null,adopted=null}){
  // اختيار لم يُحسم بعد (قراءة م36/2، قاعدة التقريب): قبوله يحتاج نموذج الاختيارات في شاشة وحدته، فلا يُعرض هنا
  // زر قبول يعرف أنه سيُرفض. السطر يقول أين يُحسم الاختيار بدل أن يُخفي الشرط.
  // مستخرج المنصة يبقى مسودة إلى الأبد بحكم تصميمه (قبوله يكتب نسخة للكيان ولا يمسّه). فإن كان الكيان قد اعتمد
  // نسخته منه، فالمستخرج لم يعد قرارًا ينتظر أحدًا: لا زر قبول ثانٍ يكتب نسخة ثانية، ولا بند في «بانتظار قراري».
  const decide=status==='draft'&&canDecide(u,prepared_by)&&!decide_at&&!adopted;
  return {store,store_name:POLICY_STORES[store].name,module:POLICY_STORES[store].module,id,kind:kind??null,kind_name,title,decide_at,
    articles:articles??[],status,status_name:STATUS_NAMES[status]??status,effective_from:effective_from??null,
    platform_draft,prepared_by_name:platform_draft?'مستخرج المنصة':personName(db,prepared_by),prepared_at:prepared_at??null,
    decided_by_name:personName(db,decided_by),decided_at:decided_at??null,decision_note:decision_note??null,version:version??null,
    own_draft:status==='draft'&&prepared_by===u.id,pending_choices:pending,
    adopted_copy:adopted?{id:adopted.id,effective_from:adopted.effective_from,decided_at:adopted.decided_at,decided_by_name:personName(db,adopted.decided_by)}:null,
    blocked_while_unaccepted:status==='accepted'||adopted?[]:blockedFor(store,kind),
    // نقطة النهاية الأصلية لوحدة السياسة؛ الشاشة لا تملك طريق كتابة خاصًا بها.
    accept_path:decide?`${path??POLICY_STORES[store].endpoint}/${id}/accept`:null,
    reject_path:decide&&!platform_draft?`${path??POLICY_STORES[store].endpoint}/${id}/reject`:null,
    actions:decide?(platform_draft?['accept_policy']:['accept_policy','reject_policy']):[]};
}

function collect(db,u){
  const out=[];
  for(const p of db.prepare('SELECT * FROM hr_policies WHERE tenant_id=? ORDER BY created_at DESC').all(u.tenant_id))
    out.push(row(db,u,{store:'hr_policy',id:p.id,kind:p.kind,kind_name:POLICY_KINDS.find(k=>k.key===p.kind)?.name??p.kind,title:p.title,articles:[p.basis].filter(Boolean),
      status:p.status,effective_from:p.effective_from,prepared_by:p.prepared_by,prepared_at:p.created_at,decided_by:p.decided_by,decided_at:p.decided_at,decision_note:p.decision_note}));
  for(const p of db.prepare('SELECT * FROM leave_type_policies WHERE tenant_id=? ORDER BY created_at DESC').all(u.tenant_id)){
    const parameters=JSON.parse(p.parameters),unpaid=unpaidLeaveBlock(parameters),compensatory=compensatoryBlock(parameters);
    // الإصدار 3 يستشهد بنظام العمل بجوار اللائحة ويحمل الإجازة التعويضية. سياسة أقدم تبقى سارية كما اعتُمدت، ويُقال ما ليس فيها.
    out.push(row(db,u,{store:'leave_types',id:p.id,kind_name:'أنواع الإجازات وأحكامها',title:p.title,articles:compensatory?['م80–م94','م105','نظام العمل م107 وم109–م117 وم151 وم160','اللائحة التنفيذية م22 مكرر وم24–م26']:['م80–م94','م105'],status:p.status,effective_from:p.effective_from,
      prepared_by:p.prepared_by,prepared_at:p.created_at,decided_by:p.decided_by,decided_at:p.decided_at,decision_note:p.decision_note,
      pending:[...(unpaid&&!unpaid.mode?['طريقة حسم الإجازة بلا أجر من مدة الخدمة (م91/3) لم تُحسم في هذه المسودة؛ تُقرأ من سياسة المخالصة حتى تُحسم هنا']:[]),
        ...(compensatory?[]:['سابقة لمراجعة نظام العمل (21 سبتمبر 2026): لا إجازة حج فيها ولا إجازة تعويضية عن العمل الإضافي. تُستبدل بسياسة جديدة مؤرخة تُعد من شاشة «الإجازات»'])]}));
  }
  for(const p of db.prepare('SELECT * FROM leave_accrual_policies WHERE tenant_id=? ORDER BY created_at DESC LIMIT 40').all(u.tenant_id))
    out.push(row(db,u,{store:'leave_accrual',id:p.id,kind:p.leave_type,kind_name:`استحقاق ${p.leave_type}`,title:p.title??`قاعدة استحقاق ${p.leave_type}`,articles:[p.basis].filter(Boolean),
      status:p.status,effective_from:p.effective_from,prepared_by:p.prepared_by,prepared_at:p.created_at,decided_by:p.decided_by,decided_at:p.decided_at,decision_note:p.decision_note}));
  for(const s of db.prepare('SELECT * FROM discipline_schedules WHERE tenant_id=? OR tenant_id IS NULL ORDER BY tenant_id IS NOT NULL,created_at DESC').all(u.tenant_id))
    out.push(row(db,u,{store:'discipline_schedule',id:s.id,kind_name:'جدول المخالفات والجزاءات',title:s.title,articles:['م111–م126'],status:s.status,effective_from:s.effective_from,
      prepared_by:s.prepared_by,prepared_at:s.created_at,decided_by:s.decided_by,decided_at:s.decided_at,decision_note:s.decision_note,version:s.version,platform_draft:!s.tenant_id,
      adopted:s.tenant_id?null:db.prepare("SELECT * FROM discipline_schedules WHERE tenant_id=? AND source_id=? AND status='accepted' ORDER BY decided_at DESC LIMIT 1").get(u.tenant_id,s.id)??null}));
  for(const r of db.prepare('SELECT * FROM regulation_policies WHERE tenant_id IS NULL OR tenant_id=? ORDER BY kind,created_at DESC').all(u.tenant_id)){
    const parameters=JSON.parse(r.parameters),choices=Object.keys(CHOICES[r.kind]??{}).filter(k=>parameters[k]===null||parameters[k]===undefined);
    out.push(row(db,u,{store:'regulation_rule',id:r.id,kind:r.kind,kind_name:RULE_KINDS.find(k=>k.key===r.kind)?.name??r.kind,title:r.title,articles:JSON.parse(r.articles),
      status:r.status,effective_from:r.effective_from,prepared_by:r.prepared_by,prepared_at:r.created_at,decided_by:r.decided_by,decided_at:r.decided_at,decision_note:r.decision_note,
      platform_draft:r.tenant_id===null,decide_at:r.status==='draft'&&choices.length?'#payroll-rules':null,
      adopted:r.tenant_id===null?db.prepare("SELECT * FROM regulation_policies WHERE tenant_id=? AND based_on=? AND status='accepted' ORDER BY decided_at DESC LIMIT 1").get(u.tenant_id,r.id)??null:null,
      pending:choices.map(k=>`اختيار لم يُحسم: ${k==='art36_reading'?'قراءة م36/2':k==='rounding'?'قاعدة التقريب (م50/5)':k==='unpaid_leave_mode'?'طريقة حسم الإجازة بلا أجر (م91/3)':k==='partial_month_basis'?'مقسوم شهر الالتحاق وشهر الترك في التأمينات':k}. يُحسم عند القبول في «قواعد اللائحة في الرواتب».`)}));
  }
  for(const b of db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id=? AND status IN ('draft','accepted','rejected') ORDER BY sort_order,revision DESC").all(u.tenant_id))
    out.push(row(db,u,{store:'benefit',id:b.id,kind:b.benefit_key,kind_name:b.name,title:`${b.name} — مراجعة ${b.revision}`,articles:[b.article].filter(Boolean),status:b.status,
      effective_from:b.effective_from,prepared_by:b.proposed_by,prepared_at:b.created_at,decided_by:b.decided_by,decided_at:b.decided_at,decision_note:b.decision_note,version:b.version}));
  return out;
}

// ── قائمة الجاهزية ────────────────────────────────────────────────────────────
// كل سطر: ما الذي يمنع تشغيل وحدات الموارد البشرية، ولماذا، وأين يُصلَح. الروابط إلى الشاشة التي تُصلحه فعليًا.
const CAPABILITY_CHECKS=[
  ['hr.policy.accept','لا تُعتمد أي سياسة في هذه الشاشة؛ كل ما تحتها يبقى مسودة.'],
  ['hr.policy.prepare','لا تُعد مسودة سياسة جديدة ولا تُعدَّل قيم المستخرج.'],
  ['hr.discipline.decide','لا يوقع أحد جزاءً تأديبيًا (م113): تقف كل قضية عند «ثبتت» وتسقط بمضي المدة (م120).'],
  ['hr.leave.authority','تُرفض الإجازة بلا أجر فوق 5 أيام عمل وإجازة مرافقة المريض (م90، م91/5).'],
  ['hr.contracts.approve','لا يُعتمد عقد ولا تُقبل استقالة ولا يُعتمد انتداب.'],
  ['hr.letters.issue','لا يصدر خطاب، ومنه إشعار الجزاء (م121) الذي لا تبدأ مهلة التظلم دونه.'],
  ['hr.attendance.approve','لا يُعتمد غياب غير مدفوع ولا إعفاء من الحضور.'],
  ['payroll.approve','لا يُعتمد مسير رواتب ولا مخالصة.'],
  ['benefits.finance.confirm','تقف مطالبات المزايا عند «بانتظار التأكيد المالي».']
];
const POLICY_CHECKS=[
  ['hr_policy','pay_components','سياسة بنود الراتب','#contracts'],
  ['hr_policy','working_time','سياسة الدوام والحضور','#attendance'],
  ['hr_policy','payroll_cycle','سياسة دورة الرواتب','#contracts'],
  ['hr_policy','end_of_service','سياسة نهاية الخدمة','#contracts'],
  ['leave_types',null,'سياسة أنواع الإجازات','#leave'],
  ['discipline_schedule',null,'جدول المخالفات والجزاءات','#discipline'],
  ['regulation_rule','deductions','سياسة سقوف الاستقطاع (م51، م116)','#payroll-rules'],
  ['regulation_rule','settlement','سياسة المخالصة النهائية','#payroll-rules'],
  ['regulation_rule','pay_rules','سياسة قواعد صرف الأجر','#payroll-rules'],
  ['regulation_rule','resignation','سياسة الاستقالة','#payroll-rules'],
  ['regulation_rule','social_insurance','قاعدة التأمينات الاجتماعية بالحالة','#payroll-rules'],
  ['regulation_rule','travel_per_diem','سياسة الانتداب والبدل','#travel']
];
export function readinessChecklist(db,u,rows,today){
  const items=[],add=(key,ok,title,detail,link)=>items.push({key,ok,title,detail,link});
  for(const [capability,effect] of CAPABILITY_CHECKS){
    const ok=anyoneHolds(db,u.tenant_id,capability);
    add(`capability:${capability}`,ok,ok?`مُنح \`${capability}\` — ${capabilityName(capability)}`:`لم يُمنح \`${capability}\` لأحد`,
      ok?'':`${capabilityName(capability)}. الأثر: ${effect}`,'#accounts');
  }
  const accepted=(store,kind)=>rows.some(r=>r.store===store&&r.status==='accepted'&&(kind===null||r.kind===kind)&&(!r.effective_from||r.effective_from<=today));
  for(const [store,kind,name,link] of POLICY_CHECKS){
    const ok=accepted(store,kind),waiting=rows.filter(r=>r.store===store&&r.status==='draft'&&(kind===null||r.kind===kind)).length;
    add(`policy:${store}:${kind??''}`,ok,ok?`اعتُمدت ${name}`:`لم تُعتمد ${name}`,
      ok?'':`${waiting?`${waiting} مسودة تنتظر القرار. `:'لا مسودة معدة بعد. '}${blockedFor(store,kind).join(' ')}`,link);
  }
  const accrual=rows.some(r=>r.store==='leave_accrual'&&r.status==='accepted');
  add('policy:leave_accrual',accrual,accrual?'اعتُمدت قاعدة استحقاق إجازة واحدة على الأقل':'لم تُعتمد أي قاعدة استحقاق إجازة',accrual?'':blockedFor('leave_accrual').join(' '),'#leave-accrual');
  const benefit=rows.some(r=>r.store==='benefit'&&r.status==='accepted');
  add('policy:benefit',benefit,benefit?'اعتُمدت ميزة واحدة على الأقل في مصفوفة المزايا':'لم تُعتمد أي ميزة في مصفوفة المزايا',benefit?'':blockedFor('benefit').join(' '),'#benefits-admin');
  // قالب الخطاب: «مخالفاتي وجزاءاتي» لا تصل مرحلة الإبلاغ بلا قالب منشور لنوع discipline_notice (م121).
  const anyTemplate=db.prepare("SELECT 1 FROM letter_templates WHERE tenant_id=? AND status='published' LIMIT 1").get(u.tenant_id);
  add('letters:any',!!anyTemplate,anyTemplate?'يوجد قالب خطاب معتمد':'لا يوجد قالب خطاب معتمد',anyTemplate?'':'«خطاباتي» لا تقبل طلبًا، ولا يصدر إشعار جزاء (م121).','#letter-templates');
  const noticeTemplate=db.prepare("SELECT 1 FROM letter_templates WHERE tenant_id=? AND type_code='discipline_notice' AND status='published' LIMIT 1").get(u.tenant_id);
  add('letters:discipline_notice',!!noticeTemplate,noticeTemplate?'قالب إشعار الجزاء معتمد':'لا قالب معتمد لإشعار الجزاء (discipline_notice)',
    noticeTemplate?'':'لا يُبلَّغ الموظف كتابة بالجزاء، فلا تبدأ مهلة التظلم ولا يُقترح خصم الغرامة (م121، م126).','#letter-templates');
  // التناقضات: القيمة الواحدة مكتوبة في موضعين اختلفا.
  const unpaid=unpaidLeaveRule(db,u.tenant_id,today),basis=capBasis(db,u.tenant_id,today);
  const conflicts=[...(unpaid?.mismatch??[]),...basis.mismatch];
  add('consistency:one_value',!conflicts.length,conflicts.length?`${conflicts.length} قيمة مكتوبة في موضعين واختلفا`:'لا قيمة مكتوبة في موضعين مختلفين',conflicts.join(' — '),'#hr-policies');
  // الإجازة التعويضية (نظام العمل م107/1): اختيارها في نموذج العمل الإضافي يبقى مغلقًا حتى تُعتمد سياسة أنواع إجازات فيها النوع ونسبته ومهلته.
  const compensatoryReady=!!compensatoryRule(db,u.tenant_id,today);
  add('policy:leave_types:compensatory',compensatoryReady,compensatoryReady?'اعتُمدت سياسة أنواع إجازات فيها الإجازة التعويضية وإجازة الحج':'لا سياسة أنواع إجازات معتمدة فيها الإجازة التعويضية وإجازة الحج (نظام العمل م107/1 وم114)',
    compensatoryReady?'':'لا يستطيع موظف اختيار الإجازة بدل أجر العمل الإضافي ولا طلب إجازة الحج. تُعد المسودة من شاشة «الإجازات» ويعتمدها مدير الموارد البشرية.','#leave');
  const modeDecided=!!unpaid?.decided;
  add('choice:unpaid_leave_mode',modeDecided,modeDecided?`حُسمت طريقة حسم الإجازة بلا أجر (${unpaid.mode_source==='leave_policy'?'في سياسة أنواع الإجازات':'في سياسة المخالصة'})`:'لم تُحسم طريقة حسم الإجازة بلا أجر (م91/3)',
    modeDecided?'':'لا تُحسب مدة الخدمة في المخالصة حسمًا صحيحًا قبل اختيار: الزائد على الحد وحده أم المدة كلها.','#hr-policies');
  return items;
}

export function hrPolicyBoard(db,supplied){
  const u=actor(db,supplied),today=riyadhToday();
  const rows=collect(db,u);
  const checklist=readinessChecklist(db,u,rows,today);
  const unpaid=unpaidLeaveRule(db,u.tenant_id,today),basis=capBasis(db,u.tenant_id,today);
  const sourceName={leave_policy:'سياسة أنواع الإجازات',settlement_policy:'سياسة المخالصة',deductions_policy:'سياسة سقوف الاستقطاع',discipline_schedule:'جدول الجزاءات',default:'القيمة الافتراضية في الكود حتى تُعتمد سياسة'};
  return {today,user_id:u.id,permissions:u.caps,stores:POLICY_STORES,status_names:STATUS_NAMES,
    policies:rows,
    awaiting_me:rows.filter(r=>r.actions.includes('accept_policy')),
    my_drafts:rows.filter(r=>r.own_draft),
    checklist,blocking:checklist.filter(c=>!c.ok).length,
    // القيم التي تقرأها أكثر من وحدة: تُعرض هنا مرة واحدة بمصدرها، فلا يبحث عنها أحد في شاشتين.
    shared_values:[
      {key:'unpaid_leave',label:'حد الإجازة بلا أجر وأثره',articles:unpaid?.articles??['م86/2ب','م91/3','م91/6'],
       value:unpaid?`${unpaid.threshold_days} يومًا${unpaid.mode?` — ${UNPAID_LEAVE_MODES[unpaid.mode]??''}`:' — طريقة الحسم لم تُحسم'}`:'لم تُعتمد سياسة تحدده',
       source:unpaid?sourceName[unpaid.threshold_source]:null,read_by:['محرك استحقاق الإجازات (توقف الاستحقاق)','مخالصة نهاية الخدمة (حسم مدة الخدمة)'],mismatch:unpaid?.mismatch??[]},
      {key:'cap_basis',label:'أساس الأجر وسقف الغرامات الشهري',articles:basis.articles,
       value:`أجر ${basis.monthly_fine_cap_days} أيام شهريًا · الشهر ${basis.day_basis_days} يومًا · ${basis.wage_components.map(c=>PAY_COMPONENT_NAMES[c]).join('، ')}`,
       source:sourceName[basis.monthly_fine_cap_source],read_by:['اقتراح خصم الغرامة في وحدة الجزاءات (م116)','فحوص ما قبل مسير الرواتب (م51، م116)','سقف قسط السلفة وسقف الحكم القضائي'],mismatch:basis.mismatch}
    ],
    note:'هذه الشاشة تعرض ولا تكتب: كل قبول أو رفض ينفذ في وحدة السياسة نفسها بقاعدة الشخصين وفحص التصريح كما هما. القيم المشتركة تُقرَّر مرة واحدة في موضعها المذكور، وتقرأها بقية الوحدات منه.',
    acceptance_owner:'مدير الموارد البشرية (hr.policy.accept) — وليس من أعد المسودة'};
}
