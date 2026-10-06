// الخيارات المُدارة (app/options.mjs + الترحيل 134): الآلة نفسها، معزولة عن أي تحويل.
//
// القوائم هنا مصطنعة ومسجَّلة في الاختبار وحده، لأن ما يُختبَر هو **القاعدة** لا محتوى قائمة بعينها:
// قائمةٌ مبذورة بقيم اليوم تتصرف كما كان الكود يتصرف قبلها؛ والإضافة تجعل الخيار قابلًا للاختيار؛ والتعطيل
// يمنع الاستعمال الجديد ولا يمسّ السجل القديم؛ والمستعمَل لا يُحذف؛ والمثبّتة نظامًا ترفض التوسيع باسم مادتها؛
// وكل تغيير يسجَّل بفاعله وسببه وتاريخه في السلسلة نفسها التي يتحقق منها verifyAudit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { registerOptionList, registerAdoption, optionsFor, optionLabel, validOption, requireOption,
  adopted, addOption, optionAction, adoptionAction, optionsBoard, listsBoard, CHANGE_CLASS } from '../app/options.mjs';

const code=expected=>error=>error.code===expected;
// assert.throws لا يعيد الخطأ، ونصّ الرفض نفسه هو ما يُختبَر هنا: ما رُفض، وما الناقص، ومن يملكه، والخطوة التالية.
const thrown=fn=>{try{fn();}catch(error){return error;}throw new Error('لم يقع الرفض المتوقع');};

// قائمة مبذورة بما هو سارٍ اليوم بالحرف: هذه هي «النسخة 0 = افتراضات الكود».
const TONES=[{value:'print',label:'مطابع وهدايا'},{value:'video',label:'تصوير وفيديو'},{value:'events',label:'تنظيم فعاليات'}];
registerOptionList({key:'test.category',label:'تصنيف المورد التجريبي',module:'test',owner:'مسؤول المشتريات',owner_role:'pm',
  governance:'managed',columns:['vendors.categories'],defaults:TONES});
registerOptionList({key:'test.document',label:'نوع وثيقة المورد التجريبي',module:'test',owner:'مسؤول المشتريات',owner_role:'pm',
  governance:'managed',second_person:true,columns:['vendor_documents.kind'],defaults:[{value:'cr',label:'سجل تجاري'},{value:'zakat',label:'شهادة الزكاة',state:'disabled'}]});
registerOptionList({key:'test.ramadan',label:'ساعات العمل في رمضان',module:'test',owner:'مدير الموارد البشرية',owner_role:'hr',
  governance:'legally_fixed',article:{ref:'م73/2',source:'اللائحة الموقّعة — ساعات العمل في رمضان'},
  columns:['attendance_days.ramadan_hours'],defaults:[{value:'six',label:'ست ساعات في اليوم'}]});
registerOptionList({key:'test.bounded',label:'قائمة محدودة بمحرس',module:'test',owner:'مسؤول المشتريات',owner_role:'pm',
  governance:'bounded',columns:['procurement_quotes.supplier_key'],bound:{floor:2,because:'محرس قاعدة البيانات يشترط خيارين نشطين على الأقل'},
  defaults:[{value:'a',label:'الخيار الأول'},{value:'b',label:'الخيار الثاني'}]});
registerOptionList({key:'test.gated',label:'قائمة خلف تصريح',module:'test',owner:'مسؤول الموردين',owner_role:'pm',
  governance:'managed',manage_capability:'vendors.manage',columns:['vendors.status'],defaults:[{value:'x',label:'خيار'}]});
// قائمة مرآة لجدول: الخيار صفٌّ مُحال إليه، فكل ما يغيّر وجوده أو اسمه يقع هناك لا في الطبقة.
registerOptionList({key:'test.mirror',label:'قائمة مرآة تجريبية',module:'probe',owner:'المالية',owner_role:'finance',
  governance:'managed',defaults:[],columns:['procurement_purchases.cost_center'],
  mirror:{table:'finance_cost_centers',value:'code',label:'name',creates:'صفّ مركز تكلفة في المالية',screen:'«الدفتر المالي» ← مراكز التكلفة'}});
// قائمة عمودها محروس بقيد CHECK لا تعرفه القائمة: الشكل يُعلَن في الواصف فيُرفض قبل القاعدة لا بعدها.
registerOptionList({key:'test.shaped',label:'قائمة بقيد عمود',module:'probe',owner:'المالية',owner_role:'finance',
  governance:'managed',columns:['finance_account_mappings.purpose'],
  value_shape:{pattern:/^[a-z_]{3,40}$/,min:3,max:40,because:"حروف لاتينية صغيرة وشرطة سفلية، من 3 إلى 40",migration:'031'},
  extra_shape:{account_type:'نوع الحساب الذي يقبله هذا الخيار'},extra_values:{account_type:['asset','income','expense']},
  defaults:[{value:'revenue',label:'إيراد',extra:{account_type:'income'}}]});
registerAdoption({key:'test.minimum_quotes',label:'أقل عدد عروض للترسية',module:'test',owner:'مسؤول المشتريات',owner_role:'pm',
  governance:'managed',default:3,basis:'قاعدة الكود اليوم: ثلاثة عروض من موردين مختلفين'});
registerAdoption({key:'test.field_closed',label:'إغلاق حقل تجريبي على قائمته',module:'probe',owner:'مسؤول المشتريات',owner_role:'pm',
  governance:'managed',default:false,basis:'سلوك اليوم: الحقل نصّ حرّ حتى يُغلق بقرار مؤرَّخ'});
registerAdoption({key:'test.vat_rate',label:'نسبة ضريبة القيمة المضافة',module:'test',owner:'المختص الضريبي',owner_role:'finance',
  // الأداة مسمّاة ولا مادة لها في المستودع: الإقرار الصريح هو البديل الوحيد عن اختراع رقم مادة.
  governance:'legally_fixed',article:{ref:'نظام ضريبة القيمة المضافة',source:'أداة تنظيمية لا قرار داخلي',
    pending:{why:'نصّ النظام غير محفوظ في هذا الاختبار',owner:'المختص الضريبي'}},default:15,
  basis:'النسبة السارية اليوم',schedule:[{from:'2018-01-01',value:5,instrument:'بدء تطبيق الضريبة بنسبة 5%'},
    {from:'2020-07-01',value:15,instrument:'رفع النسبة إلى 15%'}]});

function fixture(t){
  const db=openDb(':memory:');
  seed(db,'synthetic-managed-options-test-only');
  t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const reason=(extra='')=>({reason:'سبب تجريبي مكتوب بالكامل لاختبار الخيارات المُدارة'+extra,reason_code:'new_activity'});
  const add=(who,key,input)=>transaction(db,()=>addOption(db,users[who],key,{...reason(),...input}));
  const act=(who,key,value,action,input={})=>transaction(db,()=>optionAction(db,users[who],key,value,action,{...reason(),...input}));
  return {db,users,reason,add,act};
}

test('قائمة مبذورة بقيم اليوم: الخيارات هي مصفوفة الكود بترتيبها، وكل قيمة فيها مقبولة',t=>{
  const {db}=fixture(t);
  const list=optionsFor(db,'36t','test.category');
  assert.deepEqual(list.options.map(o=>o.value),TONES.map(o=>o.value),'القيم بترتيب الكود');
  assert.deepEqual(list.options.map(o=>o.label),TONES.map(o=>o.label),'والأسماء كما كتبها الكود');
  assert.equal(list.editable,true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM option_values').get().n,0,'ولا صفّ في الطبقة: لم يمسّ أحد شيئًا');
  for(const o of TONES)assert.equal(validOption(db,'36t','test.category',o.value),true);
  // والخيار المبذور معطَّلًا لا يُعرض، فاليوم الأول لا يتغيّر بإضافته إلى الواصف.
  assert.deepEqual(optionsFor(db,'36t','test.document').options.map(o=>o.value),['cr']);
  assert.equal(validOption(db,'36t','test.document','zakat'),false);
});

test('الإضافة تجعل الخيار قابلًا للاختيار، وتُسجَّل بفاعلها وسببها وتصنيفها',t=>{
  const {db,users,add}=fixture(t);
  add('admin','test.category',{value:'logistics',label:'نقل وشحن'});
  assert.equal(validOption(db,'36t','test.category','logistics'),true);
  assert.equal(optionLabel(db,'36t','test.category','logistics'),'نقل وشحن');
  // الخيار الجديد يلحق بآخر القائمة ولا يقفز فوق خيارات الكود.
  assert.equal(optionsFor(db,'36t','test.category').options.at(-1).value,'logistics');
  const change=db.prepare("SELECT * FROM option_changes WHERE value='logistics'").get();
  assert.equal(change.change,'added');
  assert.equal(change.class,CHANGE_CLASS.added,'الإضافة تخفيف: المجموعة المقبولة تتسع');
  assert.equal(change.actor_id,'admin');
  assert.ok(change.reason.length>=10,'ولا تغيير بلا سبب مكتوب');
  const event=db.prepare("SELECT * FROM audit_events WHERE action='option.added'").get();
  assert.equal(event.actor_id,'admin');
  assert.equal(JSON.parse(event.after_json).value,'logistics');
  assert.equal(verifyAudit(db),true);
  assert.equal(users.admin.tenant_id,'36t');
});

test('التعطيل يمنع الاستعمال الجديد ويترك السجل القديم مقروءًا، والمستعمَل لا يُحذف',t=>{
  const {db,act}=fixture(t);
  act('admin','test.category','video','disable',{reason_code:'superseded',reason:'حلّ محلها تصنيف أدق في القائمة الجديدة',effective_on:'2026-09-23'});
  // (أ) لا يُختار من جديد.
  assert.equal(validOption(db,'36t','test.category','video',{date:'2026-09-23'}),false);
  assert.deepEqual(optionsFor(db,'36t','test.category',{date:'2026-09-23'}).options.map(o=>o.value),['print','events']);
  // (ب) والسجل القديم يقرأ اسم خياره كما كُتب: هذا هو الفرق بين التعطيل والحذف.
  assert.equal(validOption(db,'36t','test.category','video',{on:'read',date:'2026-09-23'}),true);
  assert.equal(optionLabel(db,'36t','test.category','video'),'تصوير وفيديو');
  // (ج) والقاعدة نفسها ترفض الحذف، فلا يلتفّ عليه نصّ برمجي.
  assert.throws(()=>db.prepare("DELETE FROM option_values WHERE value='video'").run(),/disabled, never deleted/);
  assert.equal(db.prepare("SELECT class FROM option_changes WHERE value='video'").get().class,'tightening','التعطيل تشديد');
  assert.equal(verifyAudit(db),true);
});

test('قيمة خارج القائمة تُرفض برفض يسمّي الحقل بالعربية ومالكه وخطوته التالية',t=>{
  const {db,act}=fixture(t);
  const outside=thrown(()=>requireOption(db,'36t','test.category','crypto',{field:'تصنيف المورد'}));
  assert.ok(code('option_not_offered')(outside));
  assert.match(outside.message,/تصنيف المورد/,'الحقل مسمّى بالعربية');
  assert.equal(outside.details.refusal.missing[0].owner,'مسؤول المشتريات','والمالك مسمّى');
  assert.match(outside.details.refusal.missing[0].why,/مطابع وهدايا/,'والخيارات المتاحة معروضة');
  assert.match(outside.details.refusal.next,/مسؤول المشتريات/,'والخطوة التالية تقول عند من');
  // والمعطَّل يُرفض برسالته الخاصة: «معطَّل منذ…» لا «غير موجود».
  act('admin','test.category','print','disable',{reason_code:'superseded',reason:'سبب تجريبي مكتوب بالكامل للتعطيل',effective_on:'2026-09-23'});
  const disabled=thrown(()=>requireOption(db,'36t','test.category','print',{date:'2026-09-23'}));
  assert.ok(code('option_not_offered')(disabled));
  assert.match(disabled.message,/معطَّل منذ 2026-09-23/);
});

test('القائمة المثبّتة نظامًا: للقراءة فقط، وكل كتابة عليها تُرفض باسم مادتها',t=>{
  const {db,users,reason}=fixture(t);
  const list=optionsFor(db,'36t','test.ramadan');
  assert.equal(list.editable,false,'لا تُحرَّر');
  assert.equal(list.article.ref,'م73/2','ومادتها بجوارها');
  assert.equal(list.governance_name,'مثبّتة نظامًا — للقراءة فقط');
  const widen=thrown(()=>transaction(db,()=>addOption(db,users.admin,'test.ramadan',{value:'seven',label:'سبع ساعات',...reason()})));
  assert.ok(code('legally_fixed')(widen));
  assert.match(widen.message,/م73\/2/,'الرفض يسمّي المادة');
  const narrow=thrown(()=>transaction(db,()=>optionAction(db,users.admin,'test.ramadan','six','disable',{...reason()})));
  assert.ok(code('legally_fixed')(narrow));
  assert.match(narrow.message,/م73\/2/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM option_values').get().n,0,'ولا صفّ كُتب');
});

test('القائمة التي تفتح بوابة لا تتسع بيد واحدة: الخيار ينتظر شخصًا ثانيًا',t=>{
  const {db,users,add,act}=fixture(t);
  add('admin','test.document',{value:'gosi',label:'شهادة التأمينات'});
  assert.equal(validOption(db,'36t','test.document','gosi'),false,'لا يُعرض قبل الاعتماد');
  assert.equal(optionsFor(db,'36t','test.document',{include_disabled:true}).options.find(o=>o.value==='gosi').awaiting_second_person,true);
  const self=thrown(()=>act('admin','test.document','gosi','approve',{reason:'اعتماد تجريبي من المضيف نفسه'}));
  assert.ok(code('separation_of_duties')(self));
  assert.match(self.message,/لا يعتمده بنفسه/);
  transaction(db,()=>optionAction(db,users.manager,'test.document','gosi','approve',{reason:'راجعت الحاجة إلى الوثيقة واعتمدت إضافتها'}));
  assert.equal(validOption(db,'36t','test.document','gosi'),true,'وبعد الشخص الثاني يصير خيارًا');
  assert.equal(verifyAudit(db),true);
});

test('القائمة المحدودة بمحرس لا تنزل تحت حدّها، والرفض يسمّي المحرس',t=>{
  const {db,act}=fixture(t);
  const floor=thrown(()=>act('admin','test.bounded','a','disable',{reason_code:'policy_change',reason:'محاولة تجريبية للنزول تحت الحدّ',effective_on:'2026-09-23'}));
  assert.ok(code('bound_floor')(floor));
  assert.match(floor.details.refusal.missing[0].why,/خيارين نشطين/,'الرفض يقول أي محرس يحدّه');
});

test('التصريح يحرس القائمة: من لا يحمله لا يغيّرها، والرفض يسمّي التصريح ومالك القائمة',t=>{
  const {db,users,reason}=fixture(t);
  const denied=thrown(()=>transaction(db,()=>addOption(db,users.employee,'test.gated',{value:'y',label:'خيار آخر',...reason()})));
  assert.ok(code('not_permitted')(denied));
  assert.match(denied.details.refusal.missing[0].document,/vendors\.manage/);
  assert.equal(denied.details.refusal.missing[0].owner,'مسؤول الموردين');
});

test('القيمة ذات الأساس المعتمد: افتراض الكود حتى يقررها إنسان ويعتمدها آخر، ثم تسري من تاريخها',t=>{
  const {db,users}=fixture(t);
  const before=adopted(db,'36t','test.minimum_quotes');
  assert.equal(before.value,3);
  assert.equal(before.source,'code_default','لا اعتماد بعد، فالقيمة قيمة الكود ومعها أساسها');
  assert.ok(before.basis.length>=10);
  const recorded=transaction(db,()=>adoptionAction(db,users.admin,'test.minimum_quotes','record',
    {value:2,basis:'قرار تجريبي: عرضان يكفيان للمشتريات الصغيرة، والمرجع محضر تجريبي',effective_from:'2026-10-01'}));
  assert.equal(recorded.source,'code_default','قرارٌ لم يُعتمد بعدُ لا يسري');
  const pending=db.prepare("SELECT id FROM option_adoptions WHERE key='test.minimum_quotes'").get();
  assert.throws(()=>transaction(db,()=>adoptionAction(db,users.admin,'test.minimum_quotes','approve',{adoption_id:pending.id,note:'اعتماد من المسجِّل نفسه'})),code('separation_of_duties'));
  transaction(db,()=>adoptionAction(db,users.manager,'test.minimum_quotes','approve',{adoption_id:pending.id,note:'راجعت المحضر التجريبي واعتمدت القرار'}));
  assert.equal(adopted(db,'36t','test.minimum_quotes','2026-09-30').value,3,'قبل تاريخ السريان تبقى قيمة الكود');
  const after=adopted(db,'36t','test.minimum_quotes','2026-10-01');
  assert.equal(after.value,2);
  assert.equal(after.source,'adopted');
  assert.equal(after.approved_by,'manager');
  assert.equal(verifyAudit(db),true);
});

test('القيمة المثبّتة نظامًا جدول مؤرَّخ يُقرأ ولا يُقرَّر: النسبة بتاريخ الفاتورة، وأداتها بجوارها',t=>{
  const {db,users}=fixture(t);
  assert.equal(adopted(db,'36t','test.vat_rate','2019-06-01').value,5,'قبل الرفع: خمسة بالمئة');
  assert.equal(adopted(db,'36t','test.vat_rate','2026-01-01').value,15);
  assert.equal(adopted(db,'36t','test.vat_rate','2026-01-01').source,'legal_schedule');
  assert.equal(adopted(db,'36t','test.vat_rate','2026-01-01').editable,false);
  assert.match(adopted(db,'36t','test.vat_rate','2026-01-01').basis,/15%/,'ومعها أداتها لا مجرد رقم');
  const fixed=thrown(()=>transaction(db,()=>adoptionAction(db,users.admin,'test.vat_rate','record',
    {value:10,basis:'محاولة تجريبية لتغيير نسبة مثبّتة نظامًا',effective_from:'2026-10-01'})));
  assert.ok(code('legally_fixed')(fixed));
  assert.match(fixed.message,/نظام ضريبة القيمة المضافة/);
});

test('لوحة المالك تعرض القوائم وحوكمتها وسجل تغيّرها، وحمولة الوحدة تعرض قوائمها وحدها',t=>{
  const {db,users,add}=fixture(t);
  add('admin','test.category',{value:'logistics',label:'نقل وشحن'});
  const board=optionsBoard(db,users.admin);
  const category=board.lists.find(l=>l.key==='test.category');
  assert.equal(category.active_count,4);
  assert.equal(category.changes[0].value,'logistics');
  assert.equal(category.changes[0].actor_name,'مسؤولة المنصة','ومن غيّر يُقرأ باسمه لا بمعرّفه');
  assert.equal(board.lists.find(l=>l.key==='test.ramadan').can_manage,false,'والمثبّتة نظامًا لا تُدار');
  assert.ok(board.adopted.some(a=>a.key==='test.vat_rate'));
  const module=listsBoard(db,'36t','test');
  assert.equal(module.lists.length,5);
  assert.equal(module.adopted.length,2);
  // المسارات وُصلت (1 أكتوبر 2026، tests/options-routes.test.mjs): الحمولة تسمّي مسار التحرير الحي لا حدًّا ينتظر.
  assert.equal(module.manage_routes,'/api/options','الحمولة تسمّي مسار التحرير الذي تقرؤه شاشة «الخيارات والقيم المعتمدة»');
});

test('الخيار المشحون معطَّلًا في الكود لم يُعطَّل «منذ» تاريخ: الرفض يقول إنه لم يُفعَّل بعد',t=>{
  const {db,users,act}=fixture(t);
  const refused=thrown(()=>requireOption(db,'36t','test.document','zakat'));
  assert.ok(code('option_not_offered')(refused));
  assert.match(refused.message,/لم يفعّله مسؤول المشتريات بعد/,'لا «معطَّل منذ null»');
  const again=thrown(()=>act('admin','test.document','zakat','disable',{reason_code:'superseded',reason:'محاولة تعطيل ما هو معطَّل أصلًا',effective_on:'2026-09-23'}));
  assert.ok(code('already_disabled')(again));
  assert.ok(!again.message.includes('null'),'ولا «null» في نصّ يقرؤه إنسان');
  // وإعادة تفعيله **توسيع** على قائمة تفتح بوابة، فيخضع لقاعدة الإضافة نفسها لا لقاعدة أخرى: يد واحدة لا تكفي.
  act('admin','test.document','zakat','enable',{reason_code:'policy_change',reason:'قرّرنا طلب شهادة الزكاة من الموردين'});
  assert.equal(validOption(db,'36t','test.document','zakat'),false,'المفعِّل وحده لا يجعله خيارًا');
  assert.equal(optionsFor(db,'36t','test.document',{include_disabled:true}).options.find(o=>o.value==='zakat').awaiting_second_person,true);
  const alone=thrown(()=>requireOption(db,'36t','test.document','zakat'));
  assert.match(alone.message,/فُعِّل وينتظر اعتماد شخص ثانٍ/,'والرفض يقول إنه فُعِّل لا إنه أُضيف');
  const self=thrown(()=>act('admin','test.document','zakat','approve',{reason:'اعتماد تجريبي من المفعِّل نفسه'}));
  assert.ok(code('separation_of_duties')(self));
  assert.match(self.message,/من فعّل/,'ومن فعّل — لا من أضاف — هو الممنوع من الاعتماد');
  transaction(db,()=>optionAction(db,users.manager,'test.document','zakat','approve',{reason:'راجعت قرار طلب شهادة الزكاة واعتمدته'}));
  assert.equal(validOption(db,'36t','test.document','zakat'),true,'وبعد الشخص الثاني يصير خيارًا');
  assert.equal(verifyAudit(db),true);
});

// الترتيب والتسمية «إضافة» (CHANGE_CLASS.reordered/relabelled='additive'): لا تقول شيئًا عن التشغيل.
// كان صفّ الطبقة يُكتب 'active' عند أول مسّ، فيُفعِّل ترتيبٌ خيارًا شحنه الكود معطَّلًا — ويتخطّى شرط الشخص الثاني
// لأن الصفّ origin='code'. الحالة الثالثة 'base' تجعل الصفّ يقول «مُسَّ» لا «شُغِّل».
test('إعادة الترتيب وإعادة التسمية لا تفعّلان خيارًا شحنه الكود معطَّلًا',t=>{
  const {db,act}=fixture(t);
  for(const [action,input] of [['reorder',{sort_order:0}],['relabel',{label:'شهادة الزكاة والدخل'}]]){
    act('admin','test.document','zakat',action,{reason_code:'error',reason:`تصحيح عرض الخيار: ${action}`,...input});
    assert.equal(validOption(db,'36t','test.document','zakat'),false,`${action} لا يجعله قابلًا للاختيار`);
    const merged=optionsFor(db,'36t','test.document',{include_disabled:true}).options.find(o=>o.value==='zakat');
    assert.equal(merged.state,'disabled',`${action} يُبقي حالة الكود`);
    assert.equal(merged.awaiting_second_person,false,'ولا يدّعي أنه ينتظر اعتمادًا: لم يوسّعه أحد');
    assert.equal(db.prepare("SELECT state FROM option_values WHERE value='zakat'").get().state,'base','والصفّ يقول «مُسَّ» لا «شُغِّل»');
  }
  // وما زال التعطيل مرفوضًا لأنه معطَّل أصلًا، والرفض لا يخترع تاريخًا.
  const again=thrown(()=>act('admin','test.document','zakat','disable',{reason_code:'superseded',reason:'محاولة تعطيل ما هو معطَّل أصلًا',effective_on:'2026-09-23'}));
  assert.ok(code('already_disabled')(again));
  assert.equal(verifyAudit(db),true);
});

// القائمة المرآة كانت محروسة في الإضافة وحدها، فكان التعطيل يقع في الطبقة بينما الصفّ نشط في جدوله: مصدرا
// حقيقة يتفرّقان عن الشيء نفسه. والترتيب عرضٌ محض فيبقى حيث كان.
test('القائمة المرآة: ما يغيّر وجود الخيار أو اسمه يقع في جدولها لا في الطبقة',t=>{
  const {db,users,act,reason}=fixture(t);
  db.prepare('INSERT INTO finance_cost_centers(id,tenant_id,code,name,active,created_by,created_at) VALUES(?,?,?,?,1,?,?)')
    .run('cc-probe','36t','CC-MIRROR','مركز مرآة تجريبي','admin','2026-09-23T09:00:00.000Z');
  assert.deepEqual(optionsFor(db,'36t','test.mirror').options.map(o=>o.value),['CC-MIRROR']);
  for(const [action,input] of [['disable',{effective_on:'2026-09-23'}],['enable',{}],['relabel',{label:'اسم آخر'}]]){
    const refused=thrown(()=>act('admin','test.mirror','CC-MIRROR',action,input));
    assert.ok(code('mirrored_list')(refused),`${action} يقع في جدول المرآة لا في الطبقة`);
    assert.match(refused.details.refusal.next,/الدفتر المالي/,'والرفض يقول أين يقع');
  }
  assert.equal(db.prepare('SELECT active FROM finance_cost_centers WHERE id=?').get('cc-probe').active,1,'والصفّ لم يُمسّ');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM option_values').get().n,0,'ولا صفّ طبقة كُتب');
  // والترتيب عرضٌ لا وجود: يبقى في الطبقة.
  transaction(db,()=>optionAction(db,users.admin,'test.mirror','CC-MIRROR','reorder',{sort_order:7,...reason()}));
  assert.equal(optionsFor(db,'36t','test.mirror').options[0].sort_order,7);
});

// قيد العمود يسافر مع الواصف: بلا ذلك كانت القيمة تمرّ القائمة ثم تسقط عند أول كتابة بخطأ SQLite خام (500).
test('الشكل المعلَن يُفرض عند الإضافة: قيمة خارج قيد العمود وحقل إضافي ناقص يُرفضان رفضًا مكتوبًا',t=>{
  const {db,add}=fixture(t);
  const arabic=thrown(()=>add('admin','test.shaped',{value:'مصروف_تجريبي',label:'مصروف تجريبي',extra:{account_type:'expense'}}));
  assert.ok(code('option_value_shape')(arabic));
  assert.match(arabic.details.refusal.missing[0].why,/الترحيل 031/,'الرفض يقول أي ترحيل طبّق القيد');
  assert.ok(code('option_value_shape')(thrown(()=>add('admin','test.shaped',{value:'a'.repeat(45),label:'اسم عربي',extra:{account_type:'expense'}}))));
  const bare=thrown(()=>add('admin','test.shaped',{value:'new_purpose',label:'غرض بلا نوع حساب'}));
  assert.ok(code('option_extra_required')(bare));
  assert.match(bare.details.refusal.missing[0].document,/account_type/,'ويسمّي الحقل الناقص');
  const wrong=thrown(()=>add('admin','test.shaped',{value:'new_purpose',label:'غرض بنوع مخترع',extra:{account_type:'مصروف'}}));
  assert.ok(code('option_extra_value')(wrong));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM option_values').get().n,0,'ولا صفّ كُتب');
  add('admin','test.shaped',{value:'new_purpose',label:'غرض جديد',extra:{account_type:'expense'}});
  assert.equal(optionsFor(db,'36t','test.shaped').options.at(-1).extra.account_type,'expense');
});

// قرارٌ مؤرَّخ يوقّعه شخصان ولا يفعل شيئًا: القيمة "true" نصًّا تمرّ، والمنصة تقرأ ===true. النوع يُفحص عند التسجيل.
test('القيمة المعتمدة تُرفض إن خالف نوعها نوع القرار، والرفض يقول أي نوع يُنتظر',t=>{
  const {db,users}=fixture(t);
  const refused=thrown(()=>transaction(db,()=>adoptionAction(db,users.admin,'test.field_closed','record',
    {value:'true',basis:'قرار تجريبي بقيمة نصّية على قرار منطقي',effective_from:'2026-10-01'})));
  assert.ok(code('adoption_shape')(refused));
  assert.match(refused.message,/صواب أو خطأ/,'والرفض يسمّي النوع المنتظر بالعربية');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM option_adoptions WHERE key='test.field_closed'").get().n,0);
  transaction(db,()=>adoptionAction(db,users.admin,'test.field_closed','record',{value:true,basis:'قرار تجريبي بالقيمة المنطقية الصحيحة',effective_from:'2026-10-01'}));
  const pending=db.prepare("SELECT id FROM option_adoptions WHERE key='test.field_closed'").get();
  transaction(db,()=>adoptionAction(db,users.manager,'test.field_closed','approve',{adoption_id:pending.id,note:'راجعت القرار التجريبي واعتمدته'}));
  assert.equal(adopted(db,'36t','test.field_closed','2026-10-01').value,true);
  assert.equal(typeof adopted(db,'36t','test.field_closed','2026-10-01').value,'boolean');
});

// «مثبّتة نظامًا» أقوى تصنيف: يقفل القائمة للقراءة ويقول للمستخدم «ليست تفضيلًا». فلا تُقبل بدعوى مجرّدة.
test('المثبّت نظامًا لا يُسجَّل بدعوى بلا مادة: إمّا استشهاد يجده القارئ، وإمّا إقرار صريح بمن يملك تسجيله',t=>{
  fixture(t);
  assert.throws(()=>registerOptionList({key:'test.claimed',label:'قائمة تدّعي التثبيت',module:'probe',owner:'مسؤول',
    governance:'legally_fixed',article:{ref:'نظام ما'},columns:['vendors.status'],defaults:[{value:'x',label:'خيار'}]}),
    /يسمّي الأداة ولا يسمّي مادتها/);
  // والمادة المكتوبة تُقبل كما هي.
  const cited=registerOptionList({key:'test.cited',label:'قائمة بمادتها',module:'probe',owner:'مسؤول',
    governance:'legally_fixed',article:{ref:'اللائحة — م111',source:'نصّ المادة محفوظ في الترحيل 110'},
    columns:['discipline_cases.penalty_kind'],defaults:[{value:'warning',label:'إنذار كتابي'}]});
  assert.equal(cited.governance,'legally_fixed');
});

test('الاستشهاد المُقرّ بغيابه يُقال في الرفض ويُسمّى مالكه، فلا يُرسَل القارئ إلى إعادة صياغة للقاعدة',t=>{
  const {db}=fixture(t);
  registerOptionList({key:'test.pending_cite',label:'قائمة مثبّتة باستشهاد لم يُسجَّل',module:'probe',owner:'المختص الضريبي',
    governance:'legally_fixed',columns:['tax_rate_settings.category'],defaults:[{value:'standard',label:'النسبة الأساسية'}],
    article:{ref:'نظام ضريبة القيمة المضافة',source:'أداة تنظيمية',
      pending:{why:'نصّ النظام غير محفوظ في المستودع',owner:'المختص الضريبي — المالية'}}});
  const refused=thrown(()=>requireOption(db,'36t','test.pending_cite','zero_rated'));
  assert.ok(code('option_not_offered')(refused));
  assert.match(refused.details.refusal.next,/غير مسجّلة في المستودع بعد/,'الرفض يقول إن المادة غير مسجّلة');
  assert.match(refused.details.refusal.next,/المختص الضريبي — المالية/,'ويسمّي من يملك تسجيلها');
});
