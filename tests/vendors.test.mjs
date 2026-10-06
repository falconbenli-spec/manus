import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { createPurchase, procurementAction, listProcurement } from '../app/procurement.mjs';
import { fundProject } from './budget-fixture.mjs';
import { approveVendor } from './vendor-fixture.mjs';
import { listVendors, getVendor, createVendor, vendorAction, vendorGate, nameSimilarity, weightsFor } from '../app/vendors.mjs';

const errorCode=expected=>error=>error.code===expected;
// آيبان مصطنع بخانتي تحقق صحيحتين؛ لا يمثل حسابًا حقيقيًا.
function syntheticIban(bban){
  const numeric=(bban+'SA00').replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));
  let remainder=0;for(const digit of numeric)remainder=(remainder*10+Number(digit))%97;
  return 'SA'+String(98-remainder).padStart(2,'0')+bban;
}
const IBAN_A=syntheticIban('80000000000000000001'),IBAN_B=syntheticIban('80000000000000000002');

function fixture(t){
  const db=openDb(':memory:');
  seed(db,'synthetic-vendors-test-only');
  t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const grant=(user_id,capability)=>transaction(db,()=>grantAccess(db,users.admin,{user_id,capability,note:'تصريح اختبار مصطنع'}));
  // employee يسجل، outsider يراجع ويعتمد، manager يقيّم فنيًا بحكم دوره، hr تحقق مالي، it مراجعة قانونية.
  grant('employee','vendors.manage');grant('outsider','vendors.manage');grant('hr','vendors.bank');grant('it','vendors.legal');
  const base={legal_name:'شركة الطباعة المصطنعة',trade_name:'مطبعة الاختبار',entity_type:'company',country:'SA',entity_ref:'1010000001',vat_number:'300000000000003',categories:['print_gifts'],regions:'الرياض',payment_terms:'ثلاثون يومًا بعد المطابقة',data_source:'نموذج تسجيل مصطنع أرسله المورد بالبريد'};
  const register=(overrides={},who='employee')=>{const {id}=transaction(db,()=>createVendor(db,users[who],{...base,...overrides}));return getVendor(db,users[who],id);};
  const act=(who,vendor,action,values={})=>transaction(db,()=>vendorAction(db,users[who],vendor.id,action,{version:vendor.version,...values}));
  const read=(vendor,who='employee')=>getVendor(db,users[who],vendor.id);
  const document=(vendor,kind,values={})=>act('employee',vendor,'add_document',{kind,reference:'مرجع وثيقة مصطنع '+kind,issued_on:'2026-01-01',expires_on:'2099-01-01',...values});
  const verifyAll=(vendor,who='outsider')=>{for(const d of read(vendor).documents.filter(d=>d.verification==='pending'))vendor=act(d.kind==='bank_proof'?'hr':who,read(vendor),'verify_document',{document_id:d.id,verification:'verified',note:'طابقنا الوثيقة مع مصدرها'});return read(vendor);};
  const submitted=(overrides={})=>{
    let x=register(overrides);
    x=act('employee',x,'add_contact',{name:'ممثل المورد المصطنع',role:'مدير الحساب',email:'contact@vendor.invalid',phone:''});
    x=document(x,'commercial_registration');x=document(x,'vat_certificate');
    return act('employee',x,'submit');
  };
  const approved=(overrides={})=>{
    let x=verifyAll(submitted(overrides));
    x=act('outsider',x,'review_duplicate',{decision:'passed',note:'لا يوجد ملف آخر بالمعرّفات نفسها'});
    x=act('outsider',read(x),'review_procurement',{decision:'passed',note:'الوثائق مكتملة والشروط مقبولة'});
    x=act('manager',read(x,'manager'),'review_technical',{decision:'passed',note:'عينات الطباعة مطابقة للمواصفات'});
    return act('outsider',read(x),'approve',{outcome:'approved',reason:'اجتاز فحص التكرار والتقييم الفني ومراجعة المشتريات'});
  };
  return {db,users,grant,base,register,act,read,document,verifyAll,submitted,approved};
}

test('PRC-02 criterion 19: a vendor is qualified by separate people and never becomes a platform user',t=>{
  const {db,users,act,read,approved}=fixture(t);
  const before=db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const x=approved();
  assert.equal(x.status,'approved');
  assert.equal(x.code,'V-0001');
  assert.equal(x.gate.allowed,true);
  assert.equal(x.payment_ready,false,'no verified bank account yet');
  assert.deepEqual(x.decisions.map(d=>d.to_status),['approved','in_review']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,before,'registering a vendor must not create a login');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,0);
  assert.ok(verifyAudit(db));
  // مسجل الملف لا يراجعه ولا يعتمده.
  const y=act('employee',read(x),'requalify',{reason:'مراجعة دورية لملف المورد بعد عام'});
  const z=act('employee',y,'submit');
  assert.throws(()=>act('employee',z,'review_procurement',{decision:'passed',note:'مراجعة ذاتية'}),errorCode('action_unavailable'));
  assert.throws(()=>act('employee',z,'approve',{outcome:'approved',reason:'اعتماد ذاتي غير مسموح به'}),errorCode('action_unavailable'));
  // دورة إعادة التأهيل لا ترث مراجعات الدورة السابقة.
  assert.throws(()=>act('outsider',read(z,'outsider'),'approve',{outcome:'approved',reason:'اعتماد دون مراجعات الدورة الجديدة'}),errorCode('reviews_required'));
  assert.equal(users.employee.role,'employee');
});

test('criterion 19: matching entity identifiers raise a duplicate signal that must be reviewed with a reason',t=>{
  const {act,read,approved,submitted,verifyAll}=fixture(t);
  approved();
  let copy=verifyAll(submitted({legal_name:'مؤسسة مختلفة الاسم تمامًا',trade_name:'',supplier_key:'second-file'}));
  assert.ok(copy.duplicates.some(d=>d.signal==='entity_ref'&&d.strength==='strong'));
  assert.ok(copy.duplicates.some(d=>d.signal==='vat_number'));
  copy=act('outsider',copy,'review_procurement',{decision:'passed',note:'الوثائق مكتملة'});
  copy=act('manager',read(copy,'manager'),'review_technical',{decision:'passed',note:'العينات مقبولة'});
  assert.throws(()=>act('outsider',read(copy,'outsider'),'approve',{outcome:'approved',reason:'اعتماد دون فحص التكرار المطلوب'}),errorCode('reviews_required'));
  assert.throws(()=>act('outsider',read(copy,'outsider'),'review_duplicate',{decision:'passed',note:'ليس مكررًا'}),errorCode('duplicate_reason'));
  copy=act('outsider',read(copy,'outsider'),'review_duplicate',{decision:'failed',note:'السجل التجاري والرقم الضريبي يطابقان الملف V-0001؛ الملف مكرر'});
  assert.throws(()=>act('outsider',copy,'approve',{outcome:'approved',reason:'اعتماد رغم فشل فحص التكرار'}),errorCode('reviews_required'));
  // تشابه الاسم إشارة ضعيفة فقط ولا يدمج شيئًا.
  assert.ok(nameSimilarity('شركة الطباعة المصطنعة','مؤسسة الطباعه المصطنعه')>=0.6);
  assert.equal(nameSimilarity('شركة الطباعة المصطنعة','استوديو التصوير'),0);
});

test('criterion 20: a bank change needs independent verification, an effective date and keeps the previous record',t=>{
  const {db,users,grant,act,read,approved}=fixture(t);
  grant('outsider','vendors.bank');
  let x=approved();
  assert.throws(()=>act('outsider',read(x,'outsider'),'propose_bank',{bank_name:'بنك مصطنع',account_holder:'شركة الطباعة المصطنعة',iban:'SA0000000000000000000000',reason:'تسجيل الحساب الأول للمورد'}),errorCode('invalid_iban'));
  x=act('outsider',read(x,'outsider'),'propose_bank',{bank_name:'بنك مصطنع',account_holder:'شركة الطباعة المصطنعة',iban:IBAN_A,reason:'تسجيل الحساب الأول للمورد'});
  const pending=x.bank[0];
  assert.equal(pending.status,'pending');assert.equal(x.payment_ready,false);
  // جامع البيانات يحمل تصريح التحقق المالي أيضًا، ومع ذلك لا يعتمد ما جمعه.
  assert.throws(()=>act('outsider',x,'verify_bank',{bank_id:pending.id,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع مطابق',effective_from:x.created_at.slice(0,10)}),errorCode('action_unavailable'));
  const asFinance=read(x,'hr');
  assert.equal(asFinance.bank[0].iban,IBAN_A);
  assert.throws(()=>act('hr',asFinance,'verify_bank',{bank_id:pending.id,decision:'verified',verification_method:'trusted_contact_callback',verification_evidence:'اتصال مرتد بالمورد للتأكيد',effective_from:'2099-01-01'}),errorCode('trusted_contact_required'));
  x=act('hr',asFinance,'verify_bank',{bank_id:pending.id,decision:'verified',verification_method:'bank_letter',verification_evidence:'خطاب بنكي مصطنع يطابق اسم صاحب الحساب',effective_from:'2099-01-01'});
  assert.equal(x.bank[0].status,'verified');
  assert.equal(x.bank[0].active,false,'verified but not effective before its date');
  assert.equal(x.payment_ready,false);
  // تغيير لاحق لا يمحو السابق.
  x=act('outsider',read(x,'outsider'),'propose_bank',{bank_name:'بنك مصطنع آخر',account_holder:'شركة الطباعة المصطنعة',iban:IBAN_B,reason:'المورد أبلغ عن تغيير حسابه البنكي'});
  assert.equal(x.bank.length,2);
  assert.deepEqual(x.bank.map(b=>b.status).sort(),['pending','verified']);
  assert.throws(()=>db.prepare("UPDATE vendor_bank_accounts SET iban='SA00' WHERE id=?").run(pending.id),/bank records keep their history/);
  assert.throws(()=>db.prepare('DELETE FROM vendor_bank_accounts WHERE id=?').run(pending.id),/bank records keep their history/);
  // الإخفاء: المقيم الفني والأدمن الأول دون منح صريح يريان آخر أربع خانات فقط.
  for(const who of ['manager','admin','employee']){
    const view=read(x,who);
    assert.ok(view.bank.every(b=>b.masked&&!b.iban.includes(IBAN_A.slice(4,20))&&b.account_holder===''&&b.verification_evidence===''),who+' must not see bank details');
  }
  assert.equal(JSON.stringify(listVendors(db,users.manager)).includes(IBAN_A),false);
});

test('criterion 21: an expired qualifying document blocks a new award unless procurement grants a recorded exception',t=>{
  const {db,users,act,read,approved}=fixture(t);
  let x=approved({supplier_key:'supplier-a'});
  const project=transaction(db,()=>createProject(db,users.manager,{name:'مشروع بوابة المورد',brief:'اختبار منع الترسية لمورد منتهي الوثائق',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const pAct=(who,p,action,values={})=>transaction(db,()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  let p=transaction(db,()=>createPurchase(db,users.employee,{project_id:project.id,title:'احتياج طباعة مصطنع',specification:'خمس نسخ اختبار بالمواصفات المحددة',cost_center:'SYNTHETIC-CC-1',due_date:'2099-10-20',quantity:5,unit:'نسخة',budget_amount:'100.00',budget_evidence:'مخصص اختبار داخلي قدره مئة ريال',currency:'SAR'}));
  p=pAct('employee',p,'submit');
  // العارضان الآخران ملفان مسجلان أيضًا: الكيان الذي بلا ملف ما ينطلب منه عرض (app/vendors.mjs).
  for(const key of ['supplier-b','supplier-c'])approveVendor(db,key);
  for(const [key,price] of [['supplier-a','10.00'],['supplier-b','11.00'],['supplier-c','12.00']])p=pAct('employee',p,'add_quote',{supplier_key:key,supplier_name:'مورد اختبار '+key,unit_price:price,technical_assessment:'العرض يطابق المواصفات المسجلة',financial_terms:'استحقاق بعد الاستلام والمطابقة',delivery_date:'2099-10-20',evidence:'عرض مصطنع محفوظ برقم '+key});
  const quote=p.quotes.find(q=>q.supplier_key==='SUPPLIER-A');
  assert.equal(listProcurement(db,users.employee).find(r=>r.id===p.id).vendor_gates[quote.id].state,'qualified');
  assert.equal(vendorGate(db,'36t','SUPPLIER-B',p.id).state,'qualified');
  // انتهت صلاحية السجل التجاري بعد الاعتماد.
  db.prepare("UPDATE vendor_documents SET expires_on='2020-01-01' WHERE vendor_id=? AND kind='commercial_registration'").run(x.id);
  x=read(x);
  assert.equal(x.status,'approved','expiry is shown, not hidden behind a status change');
  assert.equal(x.gate.allowed,false);assert.equal(x.gate.blockers[0].code,'document_expired');
  assert.throws(()=>pAct('manager',p,'award',{quote_id:quote.id,note:'ترسية على المورد الأقل سعرًا بعد تأكيد المخصص'}),errorCode('vendor_blocked'));
  // طالب الشراء لا يستثني طلبه؛ موظف مشتريات آخر يوثق الاستثناء.
  assert.throws(()=>act('employee',x,'grant_exception',{purchase_id:p.id,reason:'التجديد قيد الإجراء لدى المورد'}),errorCode('separation_of_duties'));
  x=act('outsider',read(x,'outsider'),'grant_exception',{purchase_id:p.id,reason:'التجديد قيد الإجراء وقدم المورد إيصال الطلب؛ استثناء لهذا الأمر فقط'});
  assert.equal(x.exceptions.length,1);
  p=pAct('manager',p,'award',{quote_id:quote.id,note:'ترسية باستثناء موثق من المشتريات بعد تأكيد المخصص'});
  assert.equal(p.status,'awarded');
  assert.equal(p.vendor_gates[quote.id].state,'exception');
  // المورد الموقوف يُمنع أيضًا، والاستثناء لا ينتقل إلى طلب شراء آخر.
  x=act('outsider',read(x,'outsider'),'suspend',{reason:'تأخر متكرر في التسليم قيد المراجعة'});
  assert.equal(vendorGate(db,'36t','SUPPLIER-A','another-purchase').allowed,false);
});

test('6أ: document requirements follow the vendor type and identity numbers are refused',t=>{
  const {users,register,act,read,document}=fixture(t);
  assert.throws(()=>register({entity_type:'individual',entity_ref:'1012345678',vat_number:'',categories:['influencers']}),errorCode('entity_ref'));
  assert.throws(()=>register({entity_type:'company',country:'AE'}),errorCode('entity_type'));
  let person=register({legal_name:'صانعة محتوى مصطنعة',trade_name:'',entity_type:'individual',entity_ref:'',vat_number:'',categories:['influencers'],supplier_key:'creator-one'});
  assert.deepEqual(person.requirements.map(r=>[r.kind,r.level]),[['freelance_license','when_applicable'],['media_license','when_applicable']]);
  const foreign=register({legal_name:'Synthetic Media FZ',entity_type:'foreign',country:'AE',entity_ref:'AE-778899',vat_number:'',categories:['media_buying'],supplier_key:'foreign-one'});
  assert.deepEqual(foreign.requirements.map(r=>r.kind),['foreign_registration']);
  // الفرد يُقدَّم دون سجل تجاري، وتوثَّق عدم انطباق الترخيص بسبب مكتوب.
  person=act('employee',person,'add_contact',{name:'صانعة المحتوى',role:'المتعاقدة',email:'',phone:'+966500000000'});
  person=act('employee',person,'submit');
  person=document(person,'media_license',{expires_on:''});
  const doc=person.documents.find(d=>d.kind==='media_license');
  assert.throws(()=>act('outsider',read(person,'outsider'),'verify_document',{document_id:doc.id,verification:'not_applicable',note:'لا'}),errorCode('invalid_text'));
  person=act('outsider',read(person,'outsider'),'verify_document',{document_id:doc.id,verification:'not_applicable',note:'المحتوى المطلوب غير إعلاني ولا يتطلب الترخيص في هذه الحالة'});
  assert.equal(person.requirements.find(r=>r.kind==='media_license').state,'not_applicable');
  assert.equal(users.employee.tenant_id,'36t');
});

test('conditional approval carries conditions and an end date; needs_info returns the file without losing it',t=>{
  const {act,read,submitted}=fixture(t);
  let x=submitted();
  x=act('outsider',read(x,'outsider'),'review_procurement',{decision:'needs_info',note:'شهادة الضريبة غير مقروءة؛ أعد رفع نسخة واضحة'});
  assert.equal(x.status,'draft');assert.equal(x.documents.length,2);
  x=act('employee',read(x),'submit');
  assert.equal(x.cycle,2);
  const cr=x.documents.find(d=>d.kind==='commercial_registration');
  x=act('outsider',read(x,'outsider'),'verify_document',{document_id:cr.id,verification:'verified',note:'طابقنا السجل'});
  for(const [kind,who] of [['duplicate','outsider'],['procurement','outsider'],['technical','manager']])x=act(who,read(x,who),'review_'+kind,{decision:'passed',note:'اجتاز المراجعة في الدورة الثانية'});
  assert.throws(()=>act('outsider',read(x,'outsider'),'approve',{outcome:'approved',reason:'اعتماد كامل مع وثيقة ضريبية غير متحقق منها'}),errorCode('documents_unverified'));
  assert.throws(()=>act('outsider',read(x,'outsider'),'approve',{outcome:'conditional',reason:'اعتماد مشروط باستكمال الشهادة',valid_until:'2020-01-01',condition_note:'استكمال شهادة الضريبة'}),errorCode('valid_until'));
  const until=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  x=act('outsider',read(x,'outsider'),'approve',{outcome:'conditional',reason:'اعتماد مشروط باستكمال الشهادة الضريبية',valid_until:until,condition_note:'تقديم شهادة ضريبية مقروءة قبل نهاية المدة'});
  assert.equal(x.status,'conditional');assert.equal(x.valid_until,until);assert.equal(x.gate.allowed,true);
});

test('evaluation uses category weights, is corrected by a new record and never suspends by itself',t=>{
  const {act,read,approved}=fixture(t);
  let x=approved();
  const scores={quality:4,commitment:3,total_cost:5,invoice_accuracy:4,responsiveness:3,remediation:4,usage_rights:5};
  assert.throws(()=>act('manager',read(x,'manager'),'evaluate',{category:'events',scores,evidence:'تقييم على تصنيف لا يخص المورد'}),errorCode('category'));
  x=act('manager',read(x,'manager'),'evaluate',{category:'print_gifts',scores,evidence:'أمر طباعة مصطنع: جودة جيدة وتأخر يوم واحد'});
  const w=weightsFor('print_gifts');
  assert.equal(x.evaluations[0].weighted_score,Object.keys(scores).reduce((sum,k)=>sum+scores[k]*w[k],0));
  assert.equal(Object.values(weightsFor('photo_video')).reduce((a,b)=>a+b),100);
  x=act('manager',read(x,'manager'),'evaluate',{category:'print_gifts',scores:{...scores,commitment:1},evidence:'تصحيح: التأخر كان خمسة أيام بحسب محضر الاستلام',corrects_id:x.evaluations[0].id});
  assert.equal(x.evaluations.length,2);
  assert.equal(x.evaluations.find(e=>!e.corrects_id).superseded,true);
  assert.equal(x.status,'approved','a low score is evidence for a decision, not the decision');
});

test('access: no grant means no vendor centre, other tenants see nothing, merged files keep their orders pointing to the survivor',t=>{
  const {db,users,act,read,approved,register}=fixture(t);
  const x=approved();
  assert.throws(()=>listVendors(db,users.it).vendors.length&&transaction(db,()=>createVendor(db,users.it,{})),errorCode('not_permitted'));
  assert.throws(()=>listVendors(db,users.external),errorCode('not_permitted'));
  // المانح غير الممنوح — قيد الترحيل 144؛ التهيئة كانت تكتب الاثنين واحدًا وهي حالة لا تقع.
  db.prepare("INSERT INTO access_grants(id,tenant_id,user_id,capability,granted_by,granted_at) VALUES('g-ext','isolated','external','vendors.view','admin','2026-01-01T00:00:00.000Z')").run();
  assert.equal(listVendors(db,users.external).vendors.length,0);
  assert.throws(()=>getVendor(db,users.external,x.id),errorCode('not_found'));
  let copy=register({legal_name:'شركة الطباعة المصطنعة فرع',entity_ref:'1010000009',vat_number:'',supplier_key:'old-key'},'outsider');
  copy=act('employee',read(copy),'merge',{into_id:x.id,reason:'الملف أُنشئ مرتين للمنشأة نفسها باسم فرعها'});
  assert.equal(copy.status,'merged');assert.equal(copy.merged_into,x.id);
  assert.equal(vendorGate(db,'36t','OLD-KEY','any').vendor_id,x.id);
  assert.throws(()=>db.prepare('DELETE FROM vendors WHERE id=?').run(copy.id),/vendors are retained/);
  const board=listVendors(db,users.employee).dashboard;
  assert.ok(board.thin_categories.some(c=>c.key==='print_gifts'&&c.qualified===1));
  assert.deepEqual(board.not_available,['المشتريات الطارئة','فروق المطابقة الثلاثية']);
  assert.equal(listVendors(db,users.manager).dashboard,null);
});

// العطب المثبت: البوابة كانت ترد allowed:true على الكيان غير المسجَّل، فيمر إلى الترسية كاملًا. والفرق بينه
// وبين المورد المسجَّل غير المؤهل أن الثاني له ملف يُستثنى لعملية بعينها (vendor_exceptions تحيل إلى ملف)،
// والأول ما عنده ملف يُستثنى أصلًا — فالباب مقفل عليه حتى يُسجَّل.
test('criterion 21: a supplier key with no vendor file is blocked at the gate, and has no file to except',t=>{
  const {db,users,act,read,approved}=fixture(t);
  const x=approved({supplier_key:'supplier-a'});
  const project=transaction(db,()=>createProject(db,users.manager,{name:'مشروع بوابة الكيان المجهول',brief:'اختبار منع الترسية لكيان بلا ملف مورد',member_ids:['employee']}));
  fundProject(db,project.id,'SYNTHETIC-CC-1');
  const pAct=(who,p,action,values={})=>transaction(db,()=>procurementAction(db,users[who],p.id,action,{version:p.version,...values}));
  let p=transaction(db,()=>createPurchase(db,users.employee,{project_id:project.id,title:'احتياج طباعة مصطنع',specification:'خمس نسخ اختبار بالمواصفات المحددة',cost_center:'SYNTHETIC-CC-1',due_date:'2099-10-20',quantity:5,unit:'نسخة',budget_amount:'100.00',budget_evidence:'مخصص اختبار داخلي قدره مئة ريال',currency:'SAR'}));
  p=pAct('employee',p,'submit');
  const gate=vendorGate(db,'36t','ACME-XYZ',p.id);
  assert.equal(gate.state,'unregistered');
  assert.equal(gate.allowed,false,'an entity with no vendor file must not pass the award gate');
  assert.deepEqual(gate.blockers.map(b=>b.code),['unregistered']);
  assert.equal(gate.vendor_id,null);
  // ولا عرض أصلًا من كيان مجهول: الفحص عند تسجيل العرض لا عند الترسية وحدها.
  assert.throws(()=>pAct('employee',p,'add_quote',{supplier_key:'acme-xyz',supplier_name:'كيان مصطنع بلا ملف',unit_price:'10.00',technical_assessment:'عرض من كيان غير مسجل',financial_terms:'استحقاق بعد الاستلام والمطابقة',delivery_date:'2099-10-20',evidence:'عرض مصطنع من كيان مجهول'}),errorCode('vendor_not_registered'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM procurement_quotes').get().n,0);
  // المورد المسجَّل الموقوف يبقى على مساره المعروف: ممنوع، لكن له ملف يحمل الاستثناء لطلب بعينه.
  const suspended=act('outsider',read(x,'outsider'),'suspend',{reason:'تأخر متكرر في التسليم قيد المراجعة'});
  assert.equal(vendorGate(db,'36t','SUPPLIER-A',p.id).state,'blocked');
  assert.equal(suspended.actions.includes('grant_exception'),true);
});
