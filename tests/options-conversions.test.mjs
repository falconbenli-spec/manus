// التحويلات: الحقول التي صارت قوائم مُدارة أو قيمًا باعتماد مؤرَّخ (الترحيل 134 + app/options.mjs).
//
// لكل تحويل سؤالان: هل بقي اليوم الأول كما كان بالضبط؟ وهل صار الحقل في يد المالك بدل أن يكون في يد مبرمج؟
// وحيث تغيّر شيء في اليوم الأول — وهما موضعان اثنان لا ثالث لهما — فالاختبار يقوله بصراحة بدل أن يخفيه.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { optionsFor, validOption, adopted, adoptionAction, addOption, optionAction, registeredLists } from '../app/options.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase, listProcurement, resolveCostCenter } from '../app/procurement.mjs';
import { listVendors, getVendor, createVendor, vendorAction, DOCUMENT_RULES } from '../app/vendors.mjs';
import { grantAccess } from '../app/access.mjs';
import { listPayables } from '../app/payables.mjs';
import { createFinanceReference } from '../app/finance.mjs';
import { recordMapping, approveMapping, activeMappings, statements, journalFromSource } from '../app/ledger.mjs';
import { vendorsUI } from '../app/static/vendors-ui.mjs';
import { statementsUI } from '../app/static/statements-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { fundProject } from './budget-fixture.mjs';

// التهريب نفسه الذي تمرره app.mjs إلى كل شاشة.
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const STAMP='2026-09-23T09:00:00.000Z';
const thrown=fn=>{try{fn();}catch(error){return error;}throw new Error('لم يقع الرفض المتوقع');};

function fixture(t){
  const db=openDb(':memory:');
  seed(db,'synthetic-options-conversions-test-only');
  t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  // مركزا تكلفة تجريبيان في المالية: هما خيارا القائمة المرآة، لا نصّان في قائمة.
  const center=(id,code,name,active=1)=>db.prepare('INSERT INTO finance_cost_centers(id,tenant_id,code,name,active,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(id,'36t',code,name,active,'admin',STAMP);
  center('cc-mkt','SYNTHETIC-CC-1','مركز التسويق التجريبي');
  center('cc-ops','SYNTHETIC-CC-2','مركز التشغيل التجريبي');
  center('cc-old','SYNTHETIC-CC-OLD','مركز تجريبي موقوف',0);
  // المعتمِد الثاني يحتاج التصريح نفسه: القرار لا يوقّعه من سجّله وحده.
  db.prepare("INSERT INTO access_grants(id,tenant_id,user_id,capability,granted_by,granted_at) VALUES('g-fin','36t','manager','finance.use','admin',?)").run(STAMP);
  const project=transaction(db,()=>createProject(db,users.manager,{name:'مشروع تحويلات تجريبي',brief:'اختبار الخيارات المُدارة على المشتريات',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const input={project_id:project.id,title:'احتياج تجريبي',specification:'مواصفات تجريبية للاختبار',cost_center:'SYNTHETIC-CC-1',
    due_date:'2026-10-20',quantity:5,unit:'نسخة',budget_amount:'100.00',budget_evidence:'مخصص اختبار داخلي قدره مئة ريال',currency:'SAR'};
  const make=(overrides={})=>transaction(db,()=>createPurchase(db,users.employee,{...input,...overrides}));
  const close=value=>transaction(db,()=>{
    const recorded=adoptionAction(db,users.admin,'procurement.cost_center_closed','record',
      {value,basis:'قرار تجريبي: حُسمت الطلبات التي بلا مركز، فأُغلق الحقل على قائمة المالية',effective_from:'2026-01-01'});
    const pending=db.prepare("SELECT id FROM option_adoptions WHERE key='procurement.cost_center_closed' AND approved_by IS NULL").get();
    adoptionAction(db,users.manager,'procurement.cost_center_closed','approve',{adoption_id:pending.id,note:'راجعت القرار التجريبي واعتمدته'});
    return recorded;
  });
  return {db,users,project,input,make,close};
}

test('مركز التكلفة: قائمة مرآة لصفوف المالية، والطلب يحمل معرّف الصفّ لا نصًّا وحده',t=>{
  const {db,make}=fixture(t);
  const list=optionsFor(db,'36t','procurement.cost_center');
  assert.deepEqual(list.options.map(o=>o.value),['SYNTHETIC-CC-1','SYNTHETIC-CC-2'],'المركز الموقوف ليس خيارًا');
  assert.equal(list.options[0].ref_id,'cc-mkt','والخيار صفٌّ مُحال إليه لا نصّ');
  assert.equal(list.editable,true);
  assert.equal(list.owner_role,'finance');
  const p=make();
  assert.equal(p.cost_center,'SYNTHETIC-CC-1','النصّ يبقى كما كتبه صاحبه');
  assert.equal(p.cost_center_id,'cc-mkt','ومعه معرّف الصفّ');
  // والمطابقة لا تتعلّق بحالة الحروف: التطبيع هو تطبيع budgets.center نفسه.
  assert.equal(resolveCostCenter(db,'36t','synthetic-cc-1').id,'cc-mkt');
  assert.equal(resolveCostCenter(db,'36t','SYNTHETIC-CC-OLD').id,null,'والمركز الموقوف لا يُحلّ');
});

test('اليوم الأول لم يتغيّر: مركز خارج قائمة المالية يبقى مقبولًا نصًّا حتى يقرّر المالك إغلاق الحقل',t=>{
  const {db,make,close}=fixture(t);
  const open=make({cost_center:'مركز تجريبي غير مسجّل'});
  assert.equal(open.cost_center,'مركز تجريبي غير مسجّل','يُقبل كما كان قبل الترحيل');
  assert.equal(open.cost_center_id,null,'ولا يُخمَّن له مركز');
  assert.equal(adopted(db,'36t','procurement.cost_center_closed').value,false,'القرار افتراضه سلوك اليوم');
  // ثم يقرر المالك الإغلاق — بقرار مؤرَّخ يسجّله واحد ويعتمده آخر — فيصير الحقل قائمة.
  close(true);
  assert.equal(adopted(db,'36t','procurement.cost_center_closed').value,true);
  assert.equal(adopted(db,'36t','procurement.cost_center_closed').source,'adopted');
  const refused=thrown(()=>make({cost_center:'مركز تجريبي غير مسجّل'}));
  assert.equal(refused.code,'option_not_offered');
  assert.match(refused.message,/مركز التكلفة/,'الرفض يسمّي الحقل بالعربية');
  assert.match(refused.details.refusal.missing[0].why,/مركز التسويق التجريبي/,'ويعرض الخيارات المتاحة');
  assert.match(refused.details.refusal.next,/المالية/,'ويقول عند من الخطوة التالية');
  // والطلب المسجَّل قبل الإغلاق يبقى مقروءًا كما كُتب: الإغلاق يمنع الجديد ولا يعيد كتابة القديم.
  assert.equal(listProcurement(db,{id:'employee',tenant_id:'36t'}).find(x=>x.id===open.id).cost_center,'مركز تجريبي غير مسجّل');
});

test('الطلب والمخصص يشيران إلى الصفّ نفسه، فالحجز يقع على المخصص المقصود',t=>{
  const {db,make}=fixture(t);
  const p=make();
  const budget=db.prepare('SELECT * FROM project_budgets WHERE project_id=?').get(p.project_id);
  assert.equal(budget.cost_center_id,'cc-mkt','المخصص يحمل المعرّف كما يحمله الطلب');
  assert.equal(budget.cost_center_id,p.cost_center_id);
});

test('كل قائمة مسجّلة تحمل مالكًا وحوكمة، والمثبّتة نظامًا تحمل مادتها',t=>{
  fixture(t);
  const lists=registeredLists();
  assert.ok(lists.length>0);
  for(const d of lists){
    assert.ok(d.owner.length>0,`${d.key}: لكل قائمة مالك يسمّيه الرفض`);
    assert.ok(['managed','legally_fixed','bounded','db_locked'].includes(d.governance));
    if(d.governance==='legally_fixed')assert.ok(d.article?.ref,`${d.key}: المثبّتة نظامًا تحمل مادتها`);
    // القائمة المقفلة بالقاعدة تقول نصّ قيدها ورقم ترحيله: يرى المالك القائمة **ولماذا** لا تُحرَّر.
    if(d.governance==='db_locked')assert.ok(d.db_locked?.check&&d.db_locked?.migration,`${d.key}: المقفلة بالقاعدة تقول قيدها وترحيله`);
  }
});

test('قيمة غير معروفة في قائمة معروفة تُرفض، والقيمة المخزَّنة قديمًا تبقى مقروءة',t=>{
  const {db}=fixture(t);
  assert.equal(validOption(db,'36t','procurement.cost_center','SYNTHETIC-CC-1'),true);
  assert.equal(validOption(db,'36t','procurement.cost_center','LA-SUCH-CENTER'),false);
  assert.equal(validOption(db,'36t','procurement.cost_center','SYNTHETIC-CC-OLD',{on:'read'}),true,'الموقوف يُقرأ ولا يُختار');
});

// ───── الشاشة: ما يراه المالك من اليوم الأول ─────
// الحدّ الصادق مرسوم في الشاشة نفسها لا في حاشية: القوائم تُقرأ ولا تُحرَّر حتى تصل مسارات /api/options.
test('شاشة الموردين تعرض قوائمها المُدارة وتدل على شاشة تعديلها: خياراتها وحالتها وسبب إقفال المقفلة منها',t=>{
  const {db,users}=fixture(t);
  const data=listVendors(db,users.admin);
  assert.ok(data.managed_options.lists.length>=3,'قوائم الوحدة تصل في الحمولة');
  const html=vendorsUI.render(data,{e:escapeHtml,button:()=>'',money:v=>String(v),ui:kit(escapeHtml)});
  assert.match(html,/قوائم هذه الشاشة/,'القسم مرسوم');
  // وُصلت مسارات /api/options وشاشتها (1 أكتوبر 2026): القسم لا يقول «للقراءة» بل يدل على شاشة التعديل وقاعدتها.
  assert.match(html,/href="#options"/,'الرابط إلى «الخيارات والقيم المعتمدة»');
  assert.match(html,/اعتمدها شخص ثاني/,'ومعه قاعدة التعديل');
  assert.ok(!/للقراءة فقط في هذه النسخة/.test(html),'ولا يقول إن التعديل ينتظر مسارات وُصلت');
  assert.match(html,/شهادة الزكاة والدخل/,'والخيار المشحون معطَّلًا ظاهر');
  assert.match(html,/معطَّل في الكود — لم يفعّله المالك بعد/,'بحالته لا بتاريخ لا وجود له');
  assert.match(html,/مقفلة بقيد في قاعدة البيانات منذ الترحيل 022/,'والمقفلة بالقاعدة تقول ترحيل قيدها');
  assert.ok(!html.includes('undefined'),'ولا «undefined» في نصّ يقرؤه إنسان');
});

test('حمولة المدفوعات تحمل نسبة الضريبة بجدولها المؤرَّخ وحالات الأمر بقيدها',t=>{
  const {db,users}=fixture(t);
  db.prepare("INSERT INTO finance_grants VALUES('fg-read','36t','manager','manager','read','2026-01-01T00:00:00.000Z','2099-12-31T00:00:00.000Z','admin','تفويض تجريبي للقراءة',NULL,?)").run(STAMP);
  const data=listPayables(db,users.manager);
  const rate=data.managed_options.adopted.find(a=>a.key==='finance.vat_rate');
  assert.equal(rate.value,15);
  assert.equal(rate.editable,false,'النسبة تُقرأ ولا تُقرَّر داخليًا');
  assert.match(rate.basis,/15%/,'ومعها أداتها لا رقم مجرد');
  const status=data.managed_options.lists.find(l=>l.key==='payables.order_status');
  assert.equal(status.governance,'db_locked');
  assert.match(status.db_locked.check,/pending/);
  assert.equal(status.editable,false);
});

// ───── ما يفعله التشديد والتعطيل بسجلٍّ **قائم** ─────
// قاعدة المنصة في التحرير: يُفحص ما تغيّر. بدونها كل تشديد صيغةٍ أو تعطيل خيارٍ يجمّد كل سجلّ يحمل القديم.
test('تشديد صيغة الرقم الضريبي يسري على الجديد ولا يجمّد ملفًا قائمًا كُتب قبله',t=>{
  const {db,users}=fixture(t);
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'employee',capability:'vendors.manage',note:'تصريح اختبار مصطنع'}));
  const base={legal_name:'مؤسسة تجريبية للاختبار',trade_name:'تجريبية',entity_type:'establishment',country:'SA',
    entity_ref:'1010000001',categories:['print_gifts'],regions:'الرياض',payment_terms:'ثلاثون يومًا',
    data_source:'نموذج تسجيل تجريبي أرسله المورد بالبريد'};
  const {id}=transaction(db,()=>createVendor(db,users.employee,{...base,vat_number:'300000000000003'}));
  // ملفٌّ كُتب برقمٍ كان يقبله التسجيل على e704e61 (`^\d{15}$`) ولا تقبله صيغة اليوم (`^3\d{13}3$`).
  // يُحاكى بكتابة مباشرة ترفع النسخة كما يشترط قادح 022، لا بتخطّي حارس.
  db.prepare("UPDATE vendors SET vat_number='399999999900004',version=version+1 WHERE id=?").run(id);
  const stored=getVendor(db,users.employee,id);
  assert.equal(stored.vat_number,'399999999900004','القراءة تعيد الرقم كما كُتب');
  const fields=(over={})=>({legal_name:stored.legal_name,legal_name_en:stored.legal_name_en,trade_name:stored.trade_name,
    entity_type:stored.entity_type,country:stored.country,entity_ref:stored.entity_ref,vat_number:stored.vat_number,
    categories:stored.categories,regions:stored.regions,payment_terms:stored.payment_terms,capacity_note:stored.capacity_note,
    data_source:stored.data_source,legal_review_required:stored.legal_review_required,...over});
  const renamed=transaction(db,()=>vendorAction(db,users.employee,id,'edit',{version:stored.version,...fields({legal_name:'اسم جديد للمؤسسة'})}));
  assert.equal(renamed.legal_name,'اسم جديد للمؤسسة','تعديل الاسم وحده يمرّ');
  assert.equal(renamed.vat_number,'399999999900004','والرقم يبقى كما كُتب، لا يُعاد كتابته ولا يُمحى');
  // والتشديد يبقى كاملًا حيث يجب: على الحقل حين يُغيَّر، وعلى كل إدخال جديد.
  const changed=thrown(()=>transaction(db,()=>vendorAction(db,users.employee,id,'edit',{version:renamed.version,...fields({legal_name:renamed.legal_name,vat_number:'499999999900004'})})));
  assert.equal(changed.code,'vat_number');
  const fresh=thrown(()=>transaction(db,()=>createVendor(db,users.employee,{...base,entity_ref:'1010000002',supplier_key:'V-NEW',vat_number:'499999999900004'})));
  assert.equal(fresh.code,'vat_number','والملف الجديد يخضع للصيغة الصارمة كاملة');
});

test('تعطيل تصنيف لا يجمّد ملفًا يحمله ولا يبدّل تصنيفه صامتًا في نموذج التحرير',t=>{
  const {db,users}=fixture(t);
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'employee',capability:'vendors.manage',note:'تصريح اختبار مصطنع'}));
  const {id}=transaction(db,()=>createVendor(db,users.employee,{legal_name:'مؤسسة تصوير تجريبية',trade_name:'تجريبية',
    entity_type:'establishment',country:'SA',entity_ref:'1010000001',categories:['photo_video'],regions:'الرياض',
    payment_terms:'ثلاثون يومًا',data_source:'نموذج تسجيل تجريبي أرسله المورد بالبريد'}));
  transaction(db,()=>optionAction(db,users.admin,'vendors.category','photo_video','disable',
    {reason_code:'superseded',reason:'قرار تجريبي: حلّ محلّ التصنيف تصنيفٌ أدقّ',effective_on:'2026-09-23'}));
  const x=getVendor(db,users.employee,id);
  const fields=over=>({legal_name:x.legal_name,legal_name_en:x.legal_name_en,trade_name:x.trade_name,entity_type:x.entity_type,
    country:x.country,entity_ref:x.entity_ref,vat_number:x.vat_number,categories:x.categories,regions:x.regions,
    payment_terms:x.payment_terms,capacity_note:x.capacity_note,data_source:x.data_source,legal_review_required:x.legal_review_required,...over});
  // (أ) التحرير بما لم يتغيّر يمرّ: القراءة صحيحة **والتحرير كذلك**.
  const edited=transaction(db,()=>vendorAction(db,users.employee,id,'edit',{version:x.version,...fields({regions:'الرياض وجدة'})}));
  assert.deepEqual(edited.categories,['photo_video'],'التصنيف المخزَّن يبقى كما هو');
  // (ب) وتصنيف **جديد** معطَّل يُرفض كما كان: الرخصة على ما هو مخزَّن وحده، لا على ما يُضاف.
  transaction(db,()=>optionAction(db,users.admin,'vendors.category','motion_design','disable',
    {reason_code:'superseded',reason:'قرار تجريبي ثانٍ: تصنيف آخر حلّ محلّه',effective_on:'2026-09-23'}));
  const y=getVendor(db,users.employee,id);
  const refused=thrown(()=>transaction(db,()=>vendorAction(db,users.employee,id,'edit',{version:y.version,...fields({categories:['photo_video','motion_design']})})));
  assert.equal(refused.code,'option_not_offered','التصنيف المعطَّل لا يُضاف من جديد');
  assert.match(refused.message,/موشن وتصميم/,'والرفض يسمّي التصنيف المرفوض لا المخزَّن');
  // (ج) والنموذج يحقن القيمة المخزَّنة خيارًا موسومًا بدل أن يُسقطها، فلا يختار المتصفّح بدلًا عن الإنسان.
  const data=listVendors(db,users.employee);
  assert.ok(!data.categories.some(c=>c.key==='photo_video'),'المعطَّل ليس بين ما يُختار في ملف جديد');
  assert.equal(data.categories_all.find(c=>c.key==='photo_video').state,'disabled','ومعروضٌ في القائمة الكاملة بحالته');
  const field=vendorsUI.form('edit',id,data).fields.find(f=>f.name==='category_1');
  assert.equal(field.value,'photo_video');
  assert.ok(field.options.some(o=>o.value==='photo_video'),'القيمة المخزَّنة بين خيارات النموذج');
  assert.match(field.options.find(o=>o.value==='photo_video').label,/معطَّل، يبقى حتى يُستبدل/,'موسومة بسبب بقائها');
  // (د) والملف يُقرأ باسم تصنيفه لا بمفتاحه اللاتيني الخام.
  assert.match(vendorsUI.render(data,{e:escapeHtml,button:()=>'',money:v=>String(v),ui:kit(escapeHtml)}),/تصوير وفيديو/);
});

// نوعُ وثيقةٍ ما زالت مصفوفة المتطلبات تفرضه: تعطيله كان يحبس الملف بين رفضين — لا الوثيقة تُسجَّل ولا الملف يُقدَّم.
test('نوع وثيقة تفرضه مصفوفة المتطلبات لا يُعطَّل، والرفض يسمّي ما يفرضه ومن يملك تغييره',t=>{
  const {db,users}=fixture(t);
  for(const kind of DOCUMENT_RULES.map(r=>r.kind)){
    const refused=thrown(()=>transaction(db,()=>optionAction(db,users.admin,'vendors.document_kind',kind,'disable',
      {reason_code:'policy_change',reason:'محاولة تجريبية لتعطيل نوع تفرضه المتطلبات',effective_on:'2026-09-23'})));
    assert.equal(refused.code,'option_in_use',`${kind}: يفرضه الكود فلا يُعطَّل من القائمة`);
    assert.ok(refused.details.refusal.missing[0].why.length>10,'والرفض يقول ما الذي يفرضه');
    assert.match(refused.details.refusal.next,/STATUS\.md/,'ويقول أين يُقرأ متى يتغيّر ذلك');
  }
  // ونوعٌ لا تفرضه المصفوفة يُعطَّل كما كان.
  transaction(db,()=>optionAction(db,users.admin,'vendors.document_kind','permit','disable',
    {reason_code:'superseded',reason:'قرار تجريبي: لم يعد هذا النوع مطلوبًا',effective_on:'2026-09-23'}));
  assert.equal(validOption(db,'36t','vendors.document_kind','permit',{date:'2026-09-23'}),false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM option_values WHERE list_key='vendors.document_kind'").get().n,1,'ولا صفّ كُتب للمرفوضة');
});

// الربط المحاسبي المعتمد على غرضٍ عُطِّل: activeMappings تُبقيه عمدًا (والدفتر يبني القيود منه)، وكانت الشاشة
// وحدها تُسقطه — فيختفي الربط الذي يقرّر حساب الإيراد لكل فاتورة من الشاشة الوحيدة التي تعرضه، بلا سطر يقول ذلك.
test('غرض معطَّل ما زال ربطه ساريًا يبقى في القوائم المالية موسومًا، لا يختفي منها',t=>{
  const {db,users}=fixture(t);
  for(const [who,actions] of [['employee',['read','configure','prepare']],['manager',['read','configure','approve','post']]])
    for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(`fg-${who}-${action}`,'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-12-31T00:00:00.000Z','admin','تفويض دفتر تجريبي',null,STAMP);
  const account=transaction(db,()=>createFinanceReference(db,users.manager,'accounts',{code:'4000',name:'إيراد الخدمات',account_type:'income',currency:'SAR'}));
  const mapping=transaction(db,()=>recordMapping(db,users.employee,{purpose:'revenue',account_id:account.id,cost_center_id:'cc-mkt',effective_from:'2026-01-01'}));
  transaction(db,()=>approveMapping(db,users.manager,mapping.id,{note:'طابقت الحساب مع دليل الحسابات'}));
  const before=statements(db,users.employee);
  assert.ok(before.mappings.find(m=>m.key==='revenue')?.active,'الربط معتمد وسارٍ');
  transaction(db,()=>optionAction(db,users.admin,'ledger.purpose','revenue','disable',
    {reason_code:'superseded',reason:'قرار تجريبي: حلّ محلّ غرض الإيراد غرضٌ أدقّ',effective_on:'2026-09-23'}));
  assert.deepEqual(Object.keys(activeMappings(db,'36t','2026-09-23')),['revenue'],'الدفتر ما زال يبني القيود منه');
  const after=statements(db,users.employee);
  const row=after.mappings.find(m=>m.key==='revenue');
  assert.ok(row,'والشاشة لا تُسقطه');
  assert.equal(row.state,'disabled','بل تَسِمه بحالته');
  assert.ok(row.active,'وربطه المعتمد ما زال معروضًا');
  const html=statementsUI.render(after,{e:escapeHtml,button:()=>'',money:v=>String(v),ui:kit(escapeHtml)});
  assert.match(html,/معطَّل — ربطه ما زال ساريًا/,'والوسم مرسوم في الشاشة');
  assert.ok(!html.includes('undefined'),'ولا «undefined» في نصّ يقرؤه إنسان');
});

// أربعة رموز رفض تبدّلت مع التحويل من اسم الحقل إلى option_not_offered. التبدّل مقصود — الرمز الواحد يقول
// **لماذا** رُفضت القيمة، والحقل مسمًّى بالعربية في الحمولة المهيكلة — لكنه كان بلا اختبار يحرسه: مجموعة
// الاختبارات كانت متطابقة قبله وبعده. هذا الاختبار يثبّت الأربعة، ويثبّت أن `categories` لم يختفِ بل انقسم.
test('رموز الرفض بعد التحويل: option_not_offered على القيمة خارج القائمة، واسم الحقل حيث لم يتغيّر السبب',t=>{
  const {db,users}=fixture(t);
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'employee',capability:'vendors.manage',note:'تصريح اختبار مصطنع'}));
  for(const [who,actions] of [['employee',['read','configure','prepare']],['manager',['read','configure','approve','post']]])
    for(const action of actions)db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(`fgc-${who}-${action}`,'36t',who,users[who].role,action,'2026-01-01T00:00:00.000Z','2099-12-31T00:00:00.000Z','admin','تفويض دفتر تجريبي',null,STAMP);
  const base={legal_name:'مؤسسة رموز تجريبية',trade_name:'رموز',entity_type:'establishment',country:'SA',
    entity_ref:'1010000001',regions:'الرياض',payment_terms:'ثلاثون يومًا',data_source:'نموذج تسجيل تجريبي أرسله المورد بالبريد'};
  // (1) ledger.recordMapping بغرض مجهول — كان `purpose` 400 «اختر الغرض المحاسبي».
  assert.equal(thrown(()=>transaction(db,()=>recordMapping(db,users.employee,
    {purpose:'no_such_purpose',account_id:'x',cost_center_id:'cc-mkt',effective_from:'2026-01-01'}))).code,'option_not_offered');
  // (2) ledger.journalFromSource بنوع مستند مجهول — كان `source_kind` 400 «نوع المستند غير مدعوم».
  assert.equal(thrown(()=>transaction(db,()=>journalFromSource(db,users.employee,
    {source_kind:'no_such_kind',source_id:'x',period_id:'y'}))).code,'option_not_offered');
  // (3) vendors.add_document بنوع مجهول — كان `document_kind` 400 «اختر نوع الوثيقة».
  const {id}=transaction(db,()=>createVendor(db,users.employee,{...base,categories:['print_gifts']}));
  const x=getVendor(db,users.employee,id);
  assert.equal(thrown(()=>transaction(db,()=>vendorAction(db,users.employee,id,'add_document',
    {version:x.version,kind:'no_such_kind',reference:'مرجع حفظ تجريبي للوثيقة'}))).code,'option_not_offered');
  // (4) createVendor بتصنيف خارج القائمة — كان `categories`.
  assert.equal(thrown(()=>transaction(db,()=>createVendor(db,users.employee,
    {...base,entity_ref:'1010000002',supplier_key:'V-X1',categories:['no_such_category']}))).code,'option_not_offered');
  // والرمز `categories` لم يختفِ: العدد صفر أو فوق ستة سببٌ آخر، فيبقى باسم الحقل.
  assert.equal(thrown(()=>transaction(db,()=>createVendor(db,users.employee,
    {...base,entity_ref:'1010000003',supplier_key:'V-X2',categories:[]}))).code,'categories');
  // وكل واحد من الأربعة يحمل الحقل بالعربية في الحمولة المهيكلة، فلا يضيع ما كان الرمز يقوله.
  const refusal=thrown(()=>transaction(db,()=>recordMapping(db,users.employee,
    {purpose:'no_such_purpose',account_id:'x',cost_center_id:'cc-mkt',effective_from:'2026-01-01'}))).details.refusal;
  assert.match(refusal.what,/الغرض المحاسبي/);
  assert.ok(refusal.missing[0].owner.length>0);
});

test('القائمة المقفلة بقيد في القاعدة ترفض كل كتابة، ويسمّي الرفض القيد وترحيله',t=>{
  const {db,users}=fixture(t);
  const reason={reason:'محاولة تجريبية لتوسيع قائمة مقفلة بقيد',reason_code:'policy_change'};
  const widen=thrown(()=>transaction(db,()=>addOption(db,users.admin,'procurement.purchase_status',{value:'on_hold',label:'معلّق',...reason})));
  assert.equal(widen.code,'db_locked');
  assert.match(widen.details.refusal.missing[0].why,/الترحيل 005/,'الرفض يقول أي ترحيل طبّق القيد');
  assert.match(widen.details.refusal.next,/031/,'ويقول ما الذي يفتحه: ترحيل يعيد بناء الجدول');
  const narrow=thrown(()=>transaction(db,()=>optionAction(db,users.admin,'procurement.purchase_status','draft','disable',{...reason,effective_on:'2026-09-23'})));
  assert.equal(narrow.code,'db_locked');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM option_values').get().n,0,'ولا صفّ كُتب');
});
