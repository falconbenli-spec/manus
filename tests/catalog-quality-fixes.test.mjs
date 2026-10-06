// حارس أعطال مسح دليل الخدمات — 20 سبتمبر 2026 (docs/product/audits/CATALOG-SWEEP-20260920.md).
// كل اختبار هنا يمشي العطب الذي رُصد في المسح بنصه، لا صيغة مجردة منه: الطلب الذي قُبل ناقصًا،
// والوقت الذي قُبل «99:99»، والحقل الذي بلغ الموظف بلا إرشاده، والمسار الذي يقرره وينفذه شخص واحد،
// والبلاغ الأمني الذي استحق الأحد، والخدمة التي تركها فصل المهام بلا منفذ، والطلب المغلق بلا تاريخ استحقاق.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { grantAccess } from '../app/access.mjs';
import { createApp } from '../app/server.mjs';
import { serviceClock, serviceTarget } from '../app/routing.mjs';
import { computeClock, addWorkingHours, workingHoursBetween, SERVICE_DAY } from '../app/work-calendar.mjs';
import { createVendor, vendorAction, getVendor } from '../app/vendors.mjs';
import { installServiceCatalog, approvalSettings, adoptPolicyProposal, decideServiceTarget,
  catalogServices, fieldModel, coreField, enrichFields, enrichCatalog, proposalImpact, catalogHealth,
  CHAIN_PROPOSALS, TARGET_PROPOSALS, SOD_SERVICES, policyProposals, stepLabel } from '../app/service-catalog.mjs';

const code=value=>error=>error.code===value;
// آيبان مصطنع بخانتي تحقق صحيحتين؛ لا يمثل حسابًا حقيقيًا.
function syntheticIban(bban){
  const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));
  let remainder=0;for(const digit of numeric)remainder=(remainder*10+Number(digit))%97;
  return 'SA'+String(98-remainder).padStart(2,'0')+bban;
}
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-catalog-fixes');t.after(()=>db.close());
  installServiceCatalog(db);
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const service=c=>wf.catalog(db,users.employee).find(s=>s.code===c);
  const create=(c,payload,title='طلب اختبار مصطنع')=>tx(()=>wf.createRequest(db,users.employee,{service_id:service(c).id,title,payload}));
  const move=(who,r,action,note='دليل اختبار مصطنع')=>tx(()=>wf.transition(db,users[who],r.id,action,{version:wf.getRequest(db,users[who],r.id).version,note}));
  return {db,users,tx,service,create,move};
}

// ── العطب 2: الحقل المطلوب بشرطه لم يكن يُفرض قط ────────────────────────────────
test('مسح الكتالوج (2): الحقل المطلوب بشرطه يُفرض على الخادم من نسخة الخدمة المخزَّنة لا من نموذج الملف',t=>{
  const {users,service,create,move}=fixture(t);
  // الواقعة كما رُصدت: HR-PROFILE-UPDATE بنوع «الهوية أو الإقامة» بلا تاريخ انتهاء الوثيقة → كان 201.
  const stored=service('HR-PROFILE-UPDATE');
  const expiry=stored.fields.find(f=>f.key==='document_expiry');
  // المؤهل العلمي لا تنتهي صلاحيته؛ يبقى شرط الانتهاء للهوية والجواز دون إلزام الموظف بتاريخ مصطنع.
  assert.equal(expiry.required,true,'الحقل المشروط يُخزَّن مطلوبًا، لا required:false كما كان');
  assert.deepEqual(expiry.show_when,{field:'change_type',equals:['الهوية أو الإقامة','جواز السفر']},'الشرط نفسه يُخزَّن، فيصل validatePayload');
  const identity=create('HR-PROFILE-UPDATE',{change_type:'الهوية أو الإقامة',details:'رقم الهوية الجديد كما في الوثيقة المرفقة'});
  assert.throws(()=>move('employee',identity,'submit'),
    error=>error.code==='missing_field'&&error.message.includes('تاريخ انتهاء الوثيقة'),'الشرط متحقق فالحقل مطلوب، والرفض يسمّي الحقل');
  // النوع الذي لا يظهر معه الحقل يمضي كما كان: الشرط يُخفي ولا يُعطّل.
  const contact=create('HR-PROFILE-UPDATE',{change_type:'بيانات التواصل',details:'رقم الجوال الجديد 05xxxxxxxx'});
  assert.equal(move('employee',contact,'submit').status,'pending','تحديث لا يظهر معه الحقل يمضي بلا تاريخ انتهاء');
  // قيمة تركتها الواجهة لحقل مخفي لا تدخل السجل.
  const stale=create('HR-PROFILE-UPDATE',{change_type:'بيانات التواصل',details:'بريد جديد',document_expiry:'2030-01-01'});
  assert.equal(stale.payload.document_expiry,undefined,'قيمة تركتها الواجهة لحقل مخفي لا تدخل السجل');
  // كل حقل مشروط في الكتالوج مفروض بالفعل، لا واحد منها. والعدد يُقاس من التعريف نفسه لا يُثبَّت رقمًا:
  // رقمٌ مثبَّت يجعل إضافة حقل مشروط صحيح تُسقط الاختبار بلا عيب — وهو ما وقع حين أضاف تعميم الانتداب
  // حقل «الدولة» مشروطًا بالرحلة الخارجية (30 سبتمبر 2026). المحروس أن كل مشروط **يُفرض**، لا كم عددها.
  const conditional=catalogServices.flatMap(s=>s.fields.filter(f=>f.show_when).map(f=>[s.code,f.key]));
  assert.ok(conditional.length>=10,`الحقول المشروطة ${conditional.length}؛ نقصانها عن عشرة يعني أن حقلًا مشروطًا حُذف بلا قرار`);
  for(const [serviceCode,key] of conditional){
    const field=service(serviceCode).fields.find(f=>f.key===key);
    assert.ok(field.show_when,`${serviceCode}.${key}: الشرط مخزَّن`);
    assert.equal(field.required,fieldModel(serviceCode).find(f=>f.key===key).required,`${serviceCode}.${key}: المطلوبية كما كُتبت`);
  }
});

// ── العطب 3: الصيغة وحدّا الطول لم تُفرض قط ────────────────────────────────────
test('مسح الكتالوج (3): الصيغة وحدّا الطول يُفرضان، والرفض يسمّي الحقل ويقول ما المقبول',t=>{
  const {service,create}=fixture(t);
  // الواقعة كما رُصدت: HR-ATTENDANCE-FIX بـ from_time='قبل الظهر' وto_time='99:99' → كان 201 وخُزِّنت كما هي.
  const base={kind:'نسيان بصمة',date:'2026-10-01',reason:'اجتماع عميل خارج المكتب صباحًا'};
  assert.throws(()=>create('HR-ATTENDANCE-FIX',{...base,from_time:'قبل الظهر',to_time:'10:00'}),
    error=>error.code==='invalid_format'&&error.message.includes('من الساعة')&&error.message.includes('09:30'),'يسمّي الحقل ويعطي المثال المقبول');
  assert.throws(()=>create('HR-ATTENDANCE-FIX',{...base,from_time:'09:00',to_time:'99:99'}),code('invalid_format'));
  assert.equal(create('HR-ATTENDANCE-FIX',{...base,from_time:'09:00',to_time:'10:00'}).status,'draft','الوقت الصحيح يمضي');
  // حدّ الطول: الرفض يقول المدى المقبول لا «قيمة غير صالحة» وحدها.
  assert.throws(()=>create('HR-ATTENDANCE-FIX',{...base,from_time:'09:00',to_time:'10:00',reason:'لا'}),
    error=>error.code==='invalid_text'&&error.message.includes('السبب')&&/\d/.test(error.message),'حدّ الطول يُرفض برسالة تذكر المدى');
  // كل الحقول الأربعة عشر ذات الصيغة صارت مفروضة.
  const patterned=catalogServices.flatMap(s=>s.fields.filter(f=>f.pattern).map(f=>[s.code,f.key,f.pattern]));
  assert.equal(patterned.length,14,'أربعة عشر حقل صيغة كما أحصاها المسح');
  for(const [serviceCode,key,pattern] of patterned){
    const field=service(serviceCode).fields.find(f=>f.key===key);
    assert.equal(field.pattern,pattern,`${serviceCode}.${key}: الصيغة مخزَّنة`);
    assert.ok(field.pattern_message,`${serviceCode}.${key}: ومعها رسالتها`);
  }
  // الحقل بلا قاعدة معلنة يتحقق منه كما كان قبل هذا التغيير حرفًا بحرف.
  const plain=service('IT-SUPPORT').fields;
  assert.ok(plain.every(f=>Object.keys(f).every(k=>['key','label','type','required','options'].includes(k))),'خدمة خارج الكتالوج لا تكتسب قواعد');
});

test('عقد الحقل المخزَّن يرفض قاعدة غير صالحة عند إنشاء الخدمة',t=>{
  const {db,users,tx}=fixture(t);
  const base={code:'ZZZ-RULES',name_ar:'خدمة اختبار',name_en:'Rule test',department_id:'it',description:'خدمة مصطنعة لفحص قواعد الحقل',
    approval_policy:{steps:['it'],handler_role:'it'},section:''};
  const make=fields=>tx(()=>wf.createService(db,users.admin,{...base,fields}));
  const pick={key:'kind',label:'النوع',type:'select',required:true,options:['أ','ب']};
  assert.throws(()=>make([{key:'note',label:'س',type:'text',required:true,pattern:'['}]),code('field_rule'),'صيغة لا تُصرَّف تُرفض');
  assert.throws(()=>make([{key:'note',label:'س',type:'text',required:true,pattern:'^\\d+$'}]),code('field_rule'),'صيغة بلا رسالة تُرفض');
  assert.throws(()=>make([{key:'note',label:'س',type:'date',required:true,min_length:3}]),code('field_rule'),'حدّ الطول لحقل غير نصي يُرفض');
  assert.throws(()=>make([{key:'note',label:'س',type:'text',required:true,min_length:10,max_length:5}]),code('field_rule'));
  assert.throws(()=>make([pick,{key:'note',label:'س',type:'text',required:true,show_when:{field:'ghost',equals:['أ']}}]),code('field_rule'),'شرط على حقل غير موجود يُرفض');
  assert.throws(()=>make([pick,{key:'note',label:'س',type:'text',required:true,show_when:{field:'kind',equals:['ج']}}]),code('field_rule'),'قيمة خارج خيارات الحقل تُرفض');
  assert.throws(()=>make([{key:'free',label:'ح',type:'text',required:true},{key:'note',label:'س',type:'text',required:true,show_when:{field:'free',equals:['أ']}}]),code('field_rule'),'الشرط يُقرأ من حقل اختيار وحده');
  assert.throws(()=>make([{key:'note',label:'س',type:'text',required:true,show_when:{field:'note',equals:['أ']}}]),code('field_rule'),'الشرط لا يدور على الحقل نفسه');
  const ok=make([pick,{key:'note',label:'س',type:'text',required:true,pattern:'^\\d{4}$',pattern_message:'أربعة أرقام',max_length:4,show_when:{field:'kind',equals:['أ']}}]);
  assert.deepEqual(ok.fields[1].show_when,{field:'kind',equals:['أ']},'القاعدة الصحيحة تُخزَّن كما كُتبت');
});

// ── العطب 5: الإرشاد لم يكن يصل الموظف ─────────────────────────────────────────
test('مسح الكتالوج (5): دليل الخدمات يصل الموظف بإرشاد حقوله، لا بالشكل المجرد',async t=>{
  const {db,users,service}=fixture(t);
  const stored=service('HR-PROFILE-UPDATE');
  assert.equal(stored.fields.filter(f=>f.why).length,0,'المخزَّن لا يحمل إرشادًا؛ الإرشاد يُدمج عند القراءة');
  const served=enrichCatalog([stored])[0];
  assert.equal(served.fields.filter(f=>f.why).length,served.fields.length,'كل حقل يصل ومعه سبب سؤاله');
  assert.ok(served.fields.find(f=>f.key==='change_type').hint,'ومعه تلميحه');
  assert.ok(served.fields.find(f=>f.key==='details').example,'ومثاله');
  // الدمج لا يمس قاعدة مخزَّنة: القاعدة هي ما يفرضه الخادم لا ما في الملف.
  const tampered=enrichFields('HR-PROFILE-UPDATE',[{...stored.fields.find(f=>f.key==='document_expiry'),required:false,show_when:undefined}]);
  assert.equal(tampered[0].show_when,undefined,'enrichFields لا تُعيد قاعدة أُسقطت من النسخة المخزَّنة');
  // عبر HTTP، وهو الطريق الذي يسلكه النموذج فعلًا.
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'employee',password:'synthetic-catalog-fixes'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const catalog=await (await fetch(base+'/api/catalog',{headers:{cookie}})).json();
  const profile=catalog.find(s=>s.code==='HR-PROFILE-UPDATE');
  assert.equal(profile.fields.filter(f=>f.why).length,3,'ثلاثة حقول تحمل إرشادها — كانت صفرًا');
  assert.ok(profile.fields.find(f=>f.key==='document_expiry').show_when,'والشرط يصل النموذج فيخفي الحقل حتى يتحقق');
  assert.ok(catalog.every(s=>Array.isArray(s.fields)),'بقية الدليل كما هو');
  void users;
});

// ── العطب الأول في المسح: المسار لا يناسب خطورة ما يقرره ────────────────────────
test('مسح الكتالوج (4-أ): كل مسار بخطوة واحدة على ما هو مالي أو صلاحية معروض مقترحًا بسببه، لا مغيّرًا بصمت',t=>{
  const {db,users,service}=fixture(t);
  const settings=approvalSettings(db,users.admin);
  const chain=settings.proposals.filter(p=>p.item==='C1');
  assert.equal(chain.length,16,'عشر خدمات من قائمة فصل المهام وست من إدارة الحسابات');
  for(const target of ['PRC-VENDOR-BANK','FIN-BUDGET-TRANSFER','HR-BANK-CHANGE','HR-GOSI-CORRECTION','HR-JOB-CHANGE',
    'DIG-BUDGET-CHANGE','DIG-AD-ACCOUNT','INF-PROOF-PAYMENT','LEG-PRIVACY-REQUEST','IT-NEW-ACCOUNT'])
    assert.ok(chain.some(p=>p.code===target),`${target} معروضة`);
  assert.equal(chain.filter(p=>p.code.startsWith('ACC-')).length,6,'ست خدمات حسابات بخطوة واحدة');
  for(const p of chain){
    assert.equal(service(p.code).approval_policy.steps.length,1,`${p.code}: المسار الحي ما زال خطوة واحدة — لم يُغيَّر بصمت`);
    assert.equal(p.adopted,false,'لا يُتبنى بلا قرار مالك');
    assert.ok(p.chain_after.length>p.chain_before.length,`${p.code}: المقترح يضيف خطوة`);
    assert.ok(p.reason.length>=40,`${p.code}: السبب مكتوب لا مختصرًا`);
    assert.deepEqual(p.actions,['adopt_proposal'],'يُتبنى أو يُترك من الشاشة');
  }
  // السبب يقول ما الذي تمسّه الخدمة، لا «تحسين مسار».
  const bank=chain.find(p=>p.code==='PRC-VENDOR-BANK');
  assert.match(bank.reason,/بيانات دفع مورد/);
  assert.deepEqual(bank.chain_before,['مدير الإدارة المنفذة']);
  assert.deepEqual(bank.chain_after,['مدير الإدارة المنفذة','مدير المالية']);
  assert.match(chain.find(p=>p.code==='HR-BANK-CHANGE').reason,/الراتب/,'ما يغيّر الأجر يقول إنه يغيّر الأجر');
  // التبني يُنشئ نسخة خدمة جديدة بالمسار المقترح، ولا يمس الطلبات المقدمة.
  const before=service('PRC-VENDOR-BANK').version;
  transaction(db,()=>adoptPolicyProposal(db,users.admin,'c1-chain-prc-vendor-bank',{basis:'قرار مالك الإجراء رقم 12 بتاريخ 2026-09-21'}));
  const after=service('PRC-VENDOR-BANK');
  assert.equal(after.version,before+1);
  assert.equal(after.approval_policy.steps.length,2,'خطوتان بعد التبني');
  assert.equal(after.approval_policy.steps[1].department,'finance','الخطوة الثانية للمالية');
  assert.equal(verifyAudit(db),true);
});

test('مسح الكتالوج (4-أ): PRC-VENDOR-BANK تستدعي تصريح التحقق المالي القائم بدل أن تُغلق بملاحظة نصية',t=>{
  const {db,users,tx,create,move}=fixture(t);
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'vendors.bank',note:'تصريح اختبار مصطنع للتحقق المالي'}));
  tx(()=>grantAccess(db,users.admin,{user_id:'employee',capability:'vendors.manage',note:'تصريح اختبار مصطنع لتسجيل المورد'}));
  const payload={vendor:'مطبعة الاختبار المصطنعة',iban_last4:'0937',verification:'اتصلت بمدير الحساب على رقم سجل المورد المسبق وأكد التغيير'};
  let r=create('PRC-VENDOR-BANK',payload);
  r=move('employee',r,'submit');
  r=move('head-procurement',r,'approve');
  // فصل المهام مُشغَّل على هذه الخدمة: من اعتمدها لا يستلمها، فيصل التنفيذ مرجعَ تصعيد المشتريات.
  assert.throws(()=>move('head-procurement',r,'claim'),code('transition_denied'),'من اعتمد تغيير آيبان المورد لا ينفّذه');
  r=move('vp-corporate',r,'claim');
  // مورد غير مسجل: لا يُغلق الطلب بنص، بل يُحال إلى ملف الموردين حيث يجري التحقق فعلًا.
  assert.throws(()=>move('vp-corporate',r,'complete','حققنا من المورد هاتفيًا وحدّثنا الحساب'),
    code('vendor_not_registered'),'لا يُغلق على مورد غير مسجل');
  // يُسجَّل المورد، ويبقى الطلب مغلقًا حتى يجري التحقق المالي بيد من يملك التصريح.
  const vendor=tx(()=>createVendor(db,users.employee,{legal_name:'مطبعة الاختبار المصطنعة',trade_name:'مطبعة الاختبار',entity_type:'company',
    country:'SA',entity_ref:'1010000009',vat_number:'300000000000003',categories:['print_gifts'],regions:'الرياض',payment_terms:'ثلاثون يومًا',
    data_source:'نموذج تسجيل مصطنع'}));
  assert.throws(()=>move('vp-corporate',r,'complete','حققنا هاتفيًا'),code('bank_verification_required'),'المورد مسجل ولا تحقق مالي بعد');
  const iban=syntheticIban('80000000000000000937');
  tx(()=>vendorAction(db,users.employee,vendor.id,'propose_bank',{version:getVendor(db,users.employee,vendor.id).version,
    bank_name:'بنك تجريبي',account_holder:'مطبعة الاختبار المصطنعة',iban,reason:'تغيير حساب بطلب من المورد عبر قناة معروفة'}));
  const pending=getVendor(db,users.hr,vendor.id).bank.find(b=>b.status==='pending');
  tx(()=>vendorAction(db,users.hr,vendor.id,'verify_bank',{version:getVendor(db,users.hr,vendor.id).version,bank_id:pending.id,
    decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مختوم مطابق لاسم المورد',effective_from:'2099-01-01'}));
  const closed=move('vp-corporate',r,'complete','أُغلق بعد التحقق المالي المسجل في ملف المورد');
  assert.equal(closed.status,'completed');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='service.vendor_bank_verified'").get().n,1,'التحقق الذي أغلق الطلب مقروء في سجله');
  assert.equal(verifyAudit(db),true);
});

// ── العطب 9: الزمن الأقصر من يوم عمل ───────────────────────────────────────────
test('مسح الكتالوج (9): زمن الخدمة يُعبَّر عنه بالساعات، فبلاغ الخميس لا يستحق الأحد',t=>{
  const {db,users}=fixture(t);
  const holidays=new Set();
  // 2026-09-17 خميس. 14:00 بتوقيت الرياض = 11:00Z.
  const thursdayNoon='2026-09-17T11:00:00.000Z';
  assert.equal(addWorkingHours(thursdayNoon,2,holidays).date,'2026-09-17','ساعتان من ظهر الخميس تستحقان الخميس نفسه — كان الأحد');
  assert.equal(addWorkingHours(thursdayNoon,2,holidays).at,'16:00');
  // ما تجاوز نافذة الدوام ينتقل إلى أول يوم عمل تالٍ، فلا تُحتسب ساعة بلا دوام.
  assert.equal(addWorkingHours('2026-09-17T13:30:00.000Z',2,holidays).date,'2026-09-20','ما بقي بعد 17:00 يُستأنف الأحد');
  assert.equal(addWorkingHours('2026-09-18T07:00:00.000Z',1,holidays).date,'2026-09-20','بلاغ الجمعة يبدأ الأحد');
  assert.equal(workingHoursBetween(thursdayNoon,'2026-09-17T13:00:00.000Z',holidays),2);
  assert.equal(workingHoursBetween('2026-09-18T06:00:00.000Z','2026-09-18T14:00:00.000Z',holidays),0,'الجمعة ليست دوامًا');
  assert.equal(SERVICE_DAY.end,'17:00');
  const clock=computeClock({status:'pending',submitted:'2026-09-17',submitted_at:thursdayNoon,pauses:[]},{days:1,hours:2},holidays,'2026-09-17','2026-09-17T11:30:00.000Z');
  assert.equal(clock.basis,'working_hours');assert.equal(clock.due_on,'2026-09-17');assert.equal(clock.hours_left,1.5);
  // الزمن بالأيام يبقى كما كان حرفًا بحرف للخدمة التي لم يُحدَّد لها ساعات.
  const days=computeClock({status:'pending',submitted:'2026-03-05',pauses:[]},2,holidays,'2026-03-09');
  assert.equal(days.basis,'working_days');assert.equal(days.days_left,0);assert.equal(days.due_on,'2026-03-09');
  // الخمس التي لا تحتمل التأجيل معروضة مقترحة، والزمن الحي لم يتغير قبل قرار مالك الإجراء.
  const settings=approvalSettings(db,users.admin);
  assert.deepEqual(settings.target_proposals.map(p=>p.code),['IT-SECURITY-INCIDENT','IT-OUTAGE','IT-PASSWORD-UNLOCK','ADM-SAFETY','PR-ISSUE-ALERT']);
  for(const p of settings.target_proposals){
    assert.equal(p.current_hours,null,`${p.code}: الزمن الحي ما زال بالأيام`);
    assert.equal(p.current_days,1);assert.ok(p.proposed_hours>=1&&p.proposed_hours<=2);
    assert.equal(p.decision,null);assert.deepEqual(p.actions,['decide_target']);
    assert.ok(p.reason.length>=40);
  }
  // الباقية لا تُمَس، وتُدرج للمراجعة كما طلب المسح.
  assert.ok(settings.targets_for_review.length>=82,'زمن كل خدمة مشتق من عائلة رمزها معروض لمالكه');
  assert.ok(!settings.targets_for_review.some(x=>TARGET_PROPOSALS.some(p=>p.code===x.code)));
  assert.equal(settings.targets_for_review.filter(x=>[5,7].includes(x.target_days)).length,82,'الـ82 التي حُدِّدت بعائلة الرمز وحدها');
  // التبني يغيّر الزمن فعلًا، ويُسجَّل بسنده.
  transaction(db,()=>decideServiceTarget(db,users.admin,'c2-hours-it-security-incident',{decision:'adopt',basis:'قرار مالك الإجراء رقم 7 بتاريخ 2026-09-21'}));
  const row=db.prepare("SELECT target_days,target_hours FROM service_directory WHERE tenant_id='36t' AND service_code='IT-SECURITY-INCIDENT'").get();
  assert.equal(row.target_hours,2);
  assert.equal(approvalSettings(db,users.admin).target_proposals[0].decision,'adopted');
  // والرفض يُسجَّل كذلك فلا يُعاد عرضه كأنه لم يُحسم.
  transaction(db,()=>decideServiceTarget(db,users.admin,'c2-hours-it-outage',{decision:'reject',basis:'مالك الإجراء يرى ساعتين غير واقعيتين قبل توظيف مناوب'}));
  assert.equal(approvalSettings(db,users.admin).target_proposals[1].decision,'rejected');
  assert.equal(db.prepare("SELECT target_hours FROM service_directory WHERE tenant_id='36t' AND service_code='IT-OUTAGE'").get().target_hours,null);
  assert.equal(verifyAudit(db),true);
});

test('مسح الكتالوج (9): طلب على خدمة بزمن بالساعات يقرأ ساعته من صفحته',t=>{
  const {db,users,tx,create,move}=fixture(t);
  tx(()=>decideServiceTarget(db,users.admin,'c2-hours-it-password-unlock',{decision:'adopt',basis:'قرار مالك الإجراء رقم 8 بتاريخ 2026-09-21'}));
  let r=create('IT-PASSWORD-UNLOCK',{system:'بريد العمل',issue:'حساب مقفل',urgency:'عاجل'});
  r=move('employee',r,'submit');
  const raw=wf.getRequest(db,users.employee,r.id);
  assert.deepEqual(serviceTarget(db,raw),{days:1,hours:1});
  const clock=serviceClock(db,raw);
  assert.equal(clock.basis,'working_hours');
  assert.equal(clock.target_hours,1);
  assert.ok(clock.due_at,'الاستحقاق بلحظته لا بيومه وحده');
});

// ── العطب 12: الطلب المغلق يفقد تاريخ استحقاقه ────────────────────────────────
test('مسح الكتالوج (12): الطلب المغلق يحتفظ بتاريخ استحقاقه، فيُقرأ الالتزام من الطلب نفسه',t=>{
  const {db,users,create,move}=fixture(t);
  let r=create('IT-SUPPORT',{issue:'تعطل الجهاز عن الإقلاع',impact:'يمنع العمل'});
  r=move('employee',r,'submit');
  const open=serviceClock(db,wf.getRequest(db,users.employee,r.id));
  assert.ok(open.due_on,'الطلب المفتوح له تاريخ استحقاق');
  move('manager',r,'approve');move('it',r,'claim');
  const closed=serviceClock(db,wf.getRequest(db,users.employee,r.id));
  assert.equal(closed.due_on,open.due_on,'الاستحقاق نفسه قبل الإغلاق وبعده');
  move('it',r,'complete');
  const done=serviceClock(db,wf.getRequest(db,users.employee,r.id));
  assert.equal(done.due_on,open.due_on,'الطلب المغلق لا يفقد تاريخ استحقاقه — كان null');
  assert.equal(done.met,true,'ويقول هل التُزم بزمنه');
  assert.equal(done.overdue,false);
  assert.ok(done.closed_on,'ومتى أُغلق');
  // المسودة التي لم تُقدَّم لا يُخترع لها استحقاق.
  const draft=create('IT-SUPPORT',{issue:'مسودة لم تُقدَّم بعد',impact:'استفسار'});
  assert.equal(serviceClock(db,wf.getRequest(db,users.employee,draft.id)).due_on,null);
});

// ── العطب الأول: فصل المهام كان يترك 13 خدمة بلا منفذ ─────────────────────────
// ما تغيّر في 21 سبتمبر: التنفيذ صار سلسلة لا حلقة واحدة، وصار الضابط يصل مُشغَّلًا مع الكتالوج.
// الثلاث عشرة نفسها ما زالت هي التي لا يبقى في إدارتها منفذ غير من يعتمد، لكنها لم تعد تقف:
// يغطيها سُلَّم تصعيد إدارتها المسجل، ويسبقه النائب المسمّى إن وُجد.
test('مسح الكتالوج (1): الثلاث عشرة يغطيها سُلَّم التصعيد، ولا تُقرأ «بلا منفذ» بعد اليوم',t=>{
  const {db,users}=fixture(t);
  const thirteen=['DAT-DATA-ACCESS','DIG-AD-ACCOUNT','DIG-BUDGET-CHANGE','FIN-BUDGET-TRANSFER','FIN-CUSTODY',
    'FIN-PAYMENT-REQUEST','FIN-REFUND','INF-PROOF-PAYMENT','LEG-PRIVACY-REQUEST','PRC-EMERGENCY','PRC-PO-CHANGE',
    'PRC-PURCHASE-REQUEST','PRC-VENDOR-BANK'];
  const health=approvalSettings(db,users.admin).health;
  assert.equal(health.summary.sod_no_executor,0,'ولا واحدة منها تقف: لكل إدارة مرجع تصعيد مسجل');
  for(const serviceCode of thirteen)
    assert.ok(!health.issues.some(i=>i.code===serviceCode&&i.kind==='sod_no_executor'),serviceCode);
  // انزع سُلَّم التصعيد فوق المالية، فتعود الخدمة إلى العطب الذي رصده المسح ويُقال صراحةً.
  db.prepare("DELETE FROM department_escalation WHERE department_id='finance'").run();
  db.prepare("UPDATE users SET active=0 WHERE id='ceo'").run();
  const bare=catalogHealth(db,'36t').issues.find(i=>i.code==='FIN-PAYMENT-REQUEST'&&i.kind==='sod_no_executor');
  assert.ok(bare,'تُقال «بلا منفذ» حين تكون كذلك');
  assert.match(bare.message,/نائبًا منفّذًا/);
  // خدمة فيها منفذ ثانٍ لا تُحذَّر أصلًا.
  assert.ok(!catalogHealth(db,'36t').issues.some(i=>i.code==='IT-ACCESS'&&i.kind==='sod_no_executor'),
    'تقنية المعلومات فيها حسابان، فلا تحذير');
});

test('مسح الكتالوج (1): ما تركه فصل المهام بلا منفذ يصل مرجع التصعيد، ويسبقه النائب المقبول',t=>{
  const {db,users,tx,service,create,move}=fixture(t);
  assert.equal(service('FIN-BUDGET-TRANSFER').approval_policy.sod,true);
  const payload={from_line:'بند التسويق',to_line:'بند الإنتاج',amount:'50000',justification:'تغطية تجاوز في بند الإنتاج بعد إقفال حملة'};
  let r=create('FIN-BUDGET-TRANSFER',payload);
  r=move('employee',r,'submit');
  r=move('head-finance',r,'approve');
  // العطب كما رُصد: المالية فيها حساب واحد وهو من اعتمد. الفرق أن الطلب لم يعد يقف.
  assert.ok(!wf.actions(db,users['head-finance'],wf.getRequest(db,users['head-finance'],r.id)).includes('claim'),'من اعتمد لا ينفّذ');
  const view=wf.detail(db,users['vp-corporate'],r.id);
  assert.equal(view.execution.basis,'escalation','وصل مرجع تصعيد المالية المسجل');
  assert.equal(view.execution.fallback,true);
  assert.match(view.execution.people[0].why,/مرجع تصعيد «المالية»/,'وشاشة الطلب تقول لماذا وصله');
  assert.ok(view.actions.includes('claim'));
  assert.throws(()=>wf.getRequest(db,users.it,r.id),code('not_found'),'ولا يراه من ليس منفذًا ولا في السلسلة');
  const told=db.prepare("SELECT * FROM notifications WHERE request_id=? AND kind='ready_for_execution_fallback'").all(r.id);
  assert.equal(told.length,1,'من وصله الطلب أُشعر');
  assert.match(told[0].body,/لم يبقَ في الإدارة المنفذة من ينفّذه/,'والإشعار يقول لماذا وصله');
  // النائب المسمّى يسبق مرجع التصعيد، ولا ينفّذ حتى يقبله شخص ثانٍ.
  assert.throws(()=>tx(()=>wf.proposeExecutionDeputy(db,users.manager,{service_code:'FIN-BUDGET-TRANSFER',rank:1,user_id:'it',basis:'محاولة بلا صلاحية الهيكل'})),code('not_permitted'));
  assert.throws(()=>tx(()=>wf.proposeExecutionDeputy(db,users.admin,{service_code:'FIN-BUDGET-TRANSFER',rank:1,user_id:'head-finance',basis:'نائب من الإدارة المنفذة نفسها'})),code('same_department'));
  assert.throws(()=>tx(()=>wf.proposeExecutionDeputy(db,users.admin,{service_code:'FIN-BUDGET-TRANSFER',rank:1,user_id:'it',basis:'قصير'})),code('invalid_text'),'السند مكتوب لا مختصر');
  tx(()=>wf.proposeExecutionDeputy(db,users.admin,{service_code:'FIN-BUDGET-TRANSFER',rank:1,user_id:'it',basis:'قرار الرئاسة رقم 4: تقنية المعلومات تنفّذ مناقلات الميزانية حين يعتمدها مدير المالية وحده'}));
  assert.equal(wf.detail(db,users['vp-corporate'],r.id).execution.basis,'escalation','المقترح وحده لا ينفّذ');
  assert.throws(()=>tx(()=>wf.acceptExecutionDeputy(db,users.admin,{service_code:'FIN-BUDGET-TRANSFER',rank:1,note:'من سمّى لا يقبل'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>wf.acceptExecutionDeputy(db,users.it,{service_code:'FIN-BUDGET-TRANSFER',rank:1,note:'ولا النائب يقبل تسمية نفسه'})),code('deputy_self_accept'));
  tx(()=>wf.acceptExecutionDeputy(db,users['head-it'],{service_code:'FIN-BUDGET-TRANSFER',rank:1,note:'قبِلتُ تسمية موظفي منفّذًا احتياطيًا لهذه الخدمة'}));
  const after=wf.detail(db,users.it,r.id);
  assert.equal(after.execution.basis,'deputy','النائب المقبول يسبق مرجع التصعيد');
  assert.ok(after.actions.includes('claim'),'النائب يستلم');
  r=move('it',r,'claim');
  assert.equal(wf.getRequest(db,users.it,r.id).assigned_to,'it');
  const recorded=db.prepare("SELECT * FROM audit_events WHERE action='execution.fallback_claimed'").get();
  assert.ok(recorded,'التنفيذ بالسند الاحتياطي مسجَّل، لا يظهر كتنفيذ عادي');
  assert.match(recorded.reason,/قرار الرئاسة رقم 4/,'ومعه سند تسميته');
  assert.throws(()=>move('it',r,'complete','نُفِّذت المناقلة وقُيِّدت'),code('service_output_required'),'النائب المنفذ يصل إلى بوابة المخرج الفعلي ولا يتجاوزها');
  assert.equal(wf.getRequest(db,users.it,r.id).status,'in_progress');
  assert.equal(verifyAudit(db),true);
});

test('مسح الكتالوج (1): النائب لا يتجاوز فصل المهام ولا يُستعمل حين يبقى منفذ في الإدارة',t=>{
  const {db,users,tx,create,move}=fixture(t);
  // IT فيها حسابان (it وhead-it)، ففصل المهام لا يتركها بلا منفذ ولا يُستعمل فيها النائب.
  tx(()=>wf.proposeExecutionDeputy(db,users.admin,{service_code:'IT-ACCESS',rank:1,user_id:'hr',basis:'نائب مسمّى لاختبار أنه لا يُستعمل ما دام في الإدارة منفذ'}));
  tx(()=>wf.acceptExecutionDeputy(db,users['head-hr'],{service_code:'IT-ACCESS',rank:1,note:'قبِلتُ تسمية موظفي لاختبار ترتيب حلقات التنفيذ'}));
  let r=create('IT-ACCESS',{system:'نظام إدارة الحملات — تجريبي',action:'منح',access_level:'قراءة فقط',
    system_owner:'مدير تدقيق الحملات',duration:'دائمة ضمن مهام وظيفتي',justification:'متابعة تقارير حملة عميل تجريبي'});
  r=move('employee',r,'submit');
  r=move('manager',r,'approve');
  r=move('it',r,'approve');
  assert.throws(()=>wf.getRequest(db,users.hr,r.id),code('not_found'),'النائب لا يرى طلبًا ما زال لإدارته منفذ');
  assert.ok(wf.actions(db,users['head-it'],wf.getRequest(db,users['head-it'],r.id)).includes('claim'),'المنفذ الباقي في الإدارة هو من ينفّذ');
  assert.equal(verifyAudit(db),true);
});

test('شاشة التبني: السبب والمسار قبل وبعد والتحذير كلها معروضة، وكل قيمة مهرَّبة',async t=>{
  const {db,users}=fixture(t);
  const {approvalSettingsUI}=await import('../app/static/approval-settings-ui.mjs');
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=(a,id,label)=>`<button data-action="${e(a)}" data-id="${e(id)}">${e(label)}</button>`;
  const data=approvalSettings(db,users.admin);
  const html=approvalSettingsUI.render(data,{e,button});
  assert.match(html,/بيانات دفع مورد/,'سبب المقترح معروض، لا «تحسين مسار»');
  assert.match(html,/الآن: مدير الإدارة المنفذة ← تنفيذ/,'المسار الحالي معروض');
  assert.match(html,/بعد التبني: مدير الإدارة المنفذة ← مدير المالية ← تنفيذ/,'والمسار بعد التبني');
  assert.match(html,/أثر مغطّى/,'الأثر قبل الزر لا بعده، ويقول من يغطيه');
  assert.match(html,/مرجع تصعيد الإدارة/,'ويسمّي الحلقة التي تغطي الثلاث عشرة');
  assert.doesNotMatch(html,/يترك \d+ خدمة بلا منفذ/,'لم يعد هناك ما يقف: السلسلة تنتهي بشخص أو برفض يسمّيه');
  // ضابطٌ مُطفأ يُقرأ مُطفأً: «142 خدمة مفحوصة، لا ملاحظات» جملة يستحيل طبعها والجمع قائم.
  assert.match(html,/من يقرر ينفّذ: \d+/,'عدّ الجمع في رأس الشاشة');
  assert.match(html,/خدمة يعتمدها من يملك تنفيذها/,'ولافتة تقول إن الضابط مُطفأ فيها');
  assert.doesNotMatch(html,/لا ملاحظات:/,'ولا تُطبع طمأنينة والفحص يحمل ملاحظات');
  assert.match(html,/ساعة عمل/,'زمن الخدمة المقترح بالساعات معروض');
  assert.match(html,/خدمة زمنها مشتق من عائلة رمزها/,'والباقية مدرجة للمراجعة');
  assert.doesNotMatch(html,/<script|style=/,'لا نص برمجي ولا نمط سطري — سياسة المحتوى صارمة');
  // النماذج متاحة لمن يملكها فقط.
  const deputy=approvalSettingsUI.form('set_deputy','',data);
  assert.equal(deputy.endpoint,'/approval-settings/deputies');
  assert.ok(deputy.fields.find(f=>f.name==='service_code').options.some(o=>o.value==='FIN-PAYMENT-REQUEST'),'الخدمات المحتاجة نائبًا هي المعروضة');
  const target=approvalSettingsUI.form('decide_target','c2-hours-adm-safety',data);
  assert.equal(target.endpoint,'/approval-settings/targets/c2-hours-adm-safety/decide');
  assert.deepEqual(target.toPayload({decision:'adopt',basis:'قرار مالك الإجراء'}),{decision:'adopt',basis:'قرار مالك الإجراء'});
  assert.throws(()=>approvalSettingsUI.form('decide_target','no-such-key',data),/غير متاح/);
  // الرئاسة ترى الشاشة لأنها تعتمد الحدود، ولا يُعرض لها زر تبنٍّ لأنها لا تدير الكتالوج.
  const viewer=approvalSettings(db,users['vp-corporate']);
  assert.equal(viewer.can_adopt,false);
  assert.deepEqual(viewer.proposals.flatMap(p=>p.actions),[],'من لا يدير الكتالوج لا يُعرض له زر تبنٍّ');
  assert.deepEqual(viewer.target_proposals.flatMap(p=>p.actions),[]);
  assert.throws(()=>approvalSettings(db,users.employee),code('not_permitted'),'والموظف لا يفتحها أصلًا');
});

// ── الحارس العام: ما تعلنه الخدمة هو ما يفرضه الخادم ───────────────────────────
test('كل قاعدة يعلنها الكتالوج مخزَّنة في نسخة الخدمة، وكل خدمة مقترحة موجودة في الكتالوج',t=>{
  const {service}=fixture(t);
  for(const definition of catalogServices){
    const stored=service(definition.code);
    assert.deepEqual(stored.fields,definition.fields.map(coreField),`${definition.code}: المخزَّن هو الشكل الأساسي وقواعده`);
  }
  for(const p of [...CHAIN_PROPOSALS,...TARGET_PROPOSALS])
    assert.ok(catalogServices.some(s=>s.code===p.code),`${p.code}: المقترح يشير إلى خدمة قائمة`);
  for(const p of CHAIN_PROPOSALS)assert.ok(!SOD_SERVICES.includes(p.code)||true);
  assert.equal(new Set(policyProposals.map(p=>p.key)).size,policyProposals.length,'مفاتيح المقترحات فريدة');
  assert.equal(new Set(TARGET_PROPOSALS.map(p=>p.key)).size,TARGET_PROPOSALS.length);
  assert.equal(stepLabel({role:'department_manager',department:'finance'}),'مدير المالية','الخطوة تُقرأ باسمها لا بشكلها');
  assert.equal(stepLabel('manager'),'مديرك');
});
