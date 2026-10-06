import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { seedHrDemo } from '../scripts/seed-hr-demo.mjs';
import { employeeProfile, employeeDirectory, saveEmployeePersonal, contractProgress, ageOn, NO_NATIONAL_ID } from '../app/employee-profile.mjs';
import { grantAccess, holds } from '../app/access.mjs';
import { saveProfile } from '../app/employees.mjs';
import { prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { recordDemographics } from '../app/workforce.mjs';
import { proposeExemption, decideExemption } from '../app/attendance-rules.mjs';
import { employeeProfileUI } from '../app/static/employee-profile-ui.mjs';
import { employeesUI } from '../app/static/employees-ui.mjs';
import { kit } from '../app/static/kit.mjs';

// الأسماء كلها مصطنعة وموسومة «تجريبي». المرجع الذي أرسله المالك صور نظام آخر فيه أسماء موظفين حقيقيين وتواريخ ميلادهم؛
// لا يُنقل منها اسم ولا تاريخ إلى بذرة ولا اختبار ولا وثيقة. ما هنا من بذرة المنصة المصطنعة وحدها.
const code=value=>error=>error.code===value;
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-employee-profile');seedHrDemo(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,users,tx:f=>transaction(db,f)};
}
const flatten=value=>value&&typeof value==='object'?Object.entries(value).flatMap(([k,x])=>[...(Array.isArray(value)?[]:[k]),...flatten(x)]):[];
const texts=value=>value&&typeof value==='object'?Object.values(value).flatMap(texts):[String(value??'')];
const fieldsOf=profile=>[...profile.tabs.overview.personal,...profile.tabs.overview.work,...profile.tabs.contract.fields,...profile.tabs.experience];
const byKey=(profile,key)=>fieldsOf(profile).find(f=>f.key===key);

// البنود التي يعرضها النظام المرجعي في صوره، بأسمائها فيه. القائمة هي العقد: كل بند منها إمّا مصدرٌ حقيقي وإمّا
// «غير متاح» بسببه ومن يسدّه — ولا ثالث. بند يسقط من الملف يُسقط هذا الاختبار.
const REFERENCE_FIELDS=[
  ['employee_number','الرقم الوظيفي'],['birth_date','تاريخ الميلاد'],['age','العمر'],['marital_status','الحالة الاجتماعية'],
  ['national_id','رقم الهوية الوطنية'],['nationality','الجنسية'],['gender','الجنس'],
  ['department','الإدارة'],['job_title','المسمى الوظيفي'],['education_level','المستوى التعليمي'],['education_field','التخصص'],['insurance','التأمين الصحي'],
  ['start_date','تاريخ بداية العقد'],['end_date','تاريخ نهاية العقد'],['duration','مدة العقد'],
  ['internal','الخبرة في 3,6T'],['prior','الخبرة السابقة'],['total','إجمالي الخبرة']
];

test('employee-profile: every field the reference shows has a real source or says «غير متاح» with a reason, an owner and a next step', t => {
  const {db,users}=fixture(t);
  const profile=employeeProfile(db,users.hr,'employee');
  for(const [key,label] of REFERENCE_FIELDS){
    const field=byKey(profile,key);
    assert.ok(field,`بند المرجع «${label}» (${key}) غير معروض في الملف`);
    assert.equal(field.label,label,`${key}: اسم البند يخالف اسمه في المرجع`);
    assert.ok(['recorded','derived','unavailable','not_stored'].includes(field.kind),`${key}: صنف بند غير معروف`);
    if(field.kind==='recorded'||field.kind==='derived'){
      assert.ok(field.source.length>3,`${key}: قيمة بلا مصدر مكتوب`);
      assert.ok(field.text!=='',`${key}: قيمة بنص فارغ`);
    }else if(field.kind==='unavailable'){
      assert.equal(field.text,'غير متاح',`${key}: الفراغ لا يقول «غير متاح»`);
      assert.ok(field.reason.length>10,`${key}: فراغ بلا سبب مكتوب`);
      assert.ok(field.needed.length>10,`${key}: فراغ لا يقول ما يلزم لسدّه`);
      assert.ok(field.owner.length>3,`${key}: فراغ بلا مالك يُسدّ عنده`);
      assert.equal(field.value,null,`${key}: فراغ يحمل قيمة`);
    }else{
      assert.equal(field.text,'لا يُسجَّل في المنصة',`${key}: الامتناع المقصود لا يُعلن`);
      assert.ok(field.reason.length>10,`${key}: امتناع بلا سبب`);
      assert.equal(field.needed,'','امتناع مقصود لا يُعرض كنقص يُستكمل بخطوة');
    }
  }
  // لا خانة فارغة ولا صفر صامت في أي بند: كل بند يحمل نصًّا يُقرأ.
  for(const field of fieldsOf(profile))assert.ok(String(field.text).trim().length>0,`${field.key}: بند بنص فارغ`);
});

test('employee-profile: رقم الهوية الوطنية is never stored — no column carries it, and a number typed into any free-text field is refused', t => {
  const {db,users,tx}=fixture(t);
  const columns=db.prepare("SELECT name FROM pragma_table_info('employee_personal')").all().map(r=>r.name);
  assert.ok(!columns.some(c=>/national|iqama|identity|id_number/i.test(c)),`عمود يشبه رقم الهوية في الجدول: ${columns.join(',')}`);
  const field=byKey(employeeProfile(db,users.hr,'employee'),'national_id');
  assert.equal(field.kind,'not_stored');
  assert.equal(field.reason,NO_NATIONAL_ID);
  // رقم كامل في «التخصص» أو في وصف الوثيقة يُرفض، ولو كتبه موظف الموارد البشرية نفسه.
  // وبكل صورة يكتب بها العدد: اللاتينية، والعربية-الهندية (وهي صورة لوحة المفاتيح العربية، أي الحالة الغالبة في
  // واجهة عربية لا النادرة)، والفارسية، وبالنقاط أو الشرطات فاصلةً. صنف محوٍ كان يضم ٠-٩ فيحذفها قبل الفحص،
  // فكان الرقم يمر ويُخزَّن ثم يُعرض — وللمدير المباشر الذي يُمنع أصلًا من البيانات الشخصية.
  for(const payload of [{education_field:'هندسة 1098765432',source:'شهادة تجريبية'},{education_field:'هندسة',source:'هوية وطنية 1098765432'},
    {education_field:'هندسة ١٠٩٨٧٦٥٤٣٢',source:'شهادة تجريبية'},{education_field:'هندسة',source:'الهوية الوطنية ١٠٩٨٧٦٥٤٣٢'},
    {education_field:'هندسة ۱۰۹۸۷۶۵۴۳۲',source:'شهادة تجريبية'},{education_field:'هندسة',source:'إقامة ۱۰۹۸۷۶۵۴۳۲'},
    {education_field:'هندسة',source:'هوية 1.098.765.432'},{education_field:'هندسة',source:'هوية 10987-65432'}])
    assert.throws(()=>tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:0,...payload})),code('national_id_refused'),JSON.stringify(payload));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM employee_personal').get().n,0,'رفضٌ ترك سجلًا خلفه');
  // وما ليس رقم وثيقة يمر: سنة تخرّج وتخصص فيه رقم قصير.
  tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:0,education_field:'هندسة حاسب ٢٠٢٠',source:'شهادة بكالوريوس تجريبية'}));
  assert.equal(db.prepare("SELECT education_field FROM employee_personal WHERE user_id='employee'").get().education_field,'هندسة حاسب ٢٠٢٠');
});

test('employee-profile: العمر is derived from تاريخ الميلاد and never stored', t => {
  const {db,users,tx}=fixture(t);
  tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:0,birth_date:'1996-03-10',marital_status:'married',
    education_level:'bachelor',education_field:'تصميم جرافيكي',prior_experience_months:30,source:'شهادة ميلاد تجريبية'}));
  const stored=db.prepare('SELECT * FROM employee_personal WHERE user_id=?').get('employee');
  assert.ok(!Object.keys(stored).some(k=>/age|عمر/i.test(k)),'عمود عمر مخزَّن في الجدول');
  const profile=employeeProfile(db,users.hr,'employee'),age=byKey(profile,'age');
  assert.equal(age.kind,'derived');
  assert.equal(age.value,ageOn('1996-03-10',profile.today),'العمر لا يطابق الاشتقاق من تاريخ الميلاد إلى اليوم');
  assert.equal(age.source,'مشتق من تاريخ الميلاد');
  // نفس تاريخ الميلاد يعطي عمرين مختلفين في سنتين مختلفتين: هذا هو سبب ألا يُخزَّن.
  assert.equal(ageOn('1996-03-10','2026-03-09'),29);
  assert.equal(ageOn('1996-03-10','2026-03-10'),30);
  // الخبرة السابقة صارت مسجَّلة، فالإجمالي صار معروفًا بعد أن كان «غير متاح».
  assert.equal(byKey(profile,'prior').value,30);
  assert.equal(byKey(profile,'total').kind,'derived');
  assert.equal(byKey(profile,'total').value,byKey(profile,'internal').value+30);
  assert.ok(verifyAudit(db));
  // قيم البيانات الشخصية نفسها لا تدخل سجل التدقيق العام: يكفي أثر الحدث ومن أحدثه وعلى أي وثيقة.
  const entry=db.prepare("SELECT * FROM audit_events WHERE entity_type='employee_personal' ORDER BY seq DESC LIMIT 1").get();
  assert.ok(!`${entry.before_json}${entry.after_json}`.includes('1996-03-10'),'تاريخ الميلاد مكتوب في سجل التدقيق');
});

test('employee-profile: إجمالي الخبرة says it is unknown instead of silently equalling the internal experience', t => {
  const {db,users}=fixture(t);
  const profile=employeeProfile(db,users.hr,'employee');
  const internal=byKey(profile,'internal'),prior=byKey(profile,'prior'),total=byKey(profile,'total');
  assert.equal(internal.kind,'derived','الخبرة الداخلية تُشتق من تاريخ المباشرة');
  assert.equal(prior.kind,'unavailable');
  assert.equal(total.kind,'unavailable','مجموعٌ أحد طرفيه مجهول عُرض كأنه معروف');
  assert.notEqual(total.value,internal.value);
  assert.ok(total.reason.includes('الخبرة السابقة'),total.reason);
  assert.ok(total.note.includes('الخبرة في 3,6T وحدها'),'الإجمالي المجهول لا يذكر ما هو معروف منه');
});

test('employee-profile: a contract with no end date shows «غير محدد المدة» and computes no percentage', t => {
  const {db,users}=fixture(t);
  const profile=employeeProfile(db,users.hr,'employee'),p=profile.tabs.contract.progress;
  assert.equal(p.state,'indefinite');
  assert.equal(p.percent,null,'نسبة إنجاز لعقد بلا تاريخ نهاية');
  assert.equal(p.total_days,null);
  assert.equal(p.remaining_days,null);
  const duration=byKey(profile,'duration');
  assert.equal(duration.text,'غير محدد المدة');
  assert.ok(!/%/.test(duration.text),'نسبة مئوية في نص مدة عقد غير محدد المدة');
  assert.equal(byKey(profile,'end_date').text,'غير محدد المدة');
  // ومحدد المدة يحسب نسبته من تقويم العمل: بلا عطل، 2026-01-01 → 2026-12-31 وفي منتصفها تقريبًا.
  const holidays=new Set();
  const half=contractProgress('2026-01-01','2026-12-31','2026-06-30',holidays);
  assert.equal(half.state,'running');
  assert.ok(half.percent>45&&half.percent<55,`النسبة ${half.percent}`);
  assert.equal(half.elapsed_days+half.remaining_days,half.total_days);
  const done=contractProgress('2026-01-01','2026-12-31','2027-03-01',holidays);
  assert.equal(done.state,'expired');
  assert.equal(done.percent,100);
  assert.equal(done.remaining_days,0,'أيام متبقية على عقد انقضت مدته');
  // وبلا تاريخ بداية لا حالة ولا نسبة: الفراغ لا يصير صفرًا.
  assert.deepEqual(contractProgress(null,'2026-12-31','2026-06-30',holidays),{state:'unknown',percent:null,elapsed_days:null,remaining_days:null,total_days:null});
});

test('employee-profile: an employee can never read another employee’s profile, and the refusal names who to ask', t => {
  const {db,users,tx}=fixture(t);
  tx(()=>saveEmployeePersonal(db,users.hr,'outsider',{version:0,birth_date:'1993-07-22',marital_status:'single',source:'هوية تجريبية'}));
  // «الموظفة التجريبية» و«موظف اختبار آخر» زميلان: كلاهما تابع للمدير نفسه، ولا أحدهما مدير الآخر.
  assert.equal(db.prepare('SELECT manager_id FROM users WHERE id=?').get('employee').manager_id,'manager');
  assert.equal(db.prepare('SELECT manager_id FROM users WHERE id=?').get('outsider').manager_id,'manager');
  let refused=null;
  try{employeeProfile(db,users.employee,'outsider');}catch(error){refused=error;}
  assert.ok(refused,'زميل فتح ملف زميله');
  assert.equal(refused.code,'not_found');
  const refusal=refused.details?.refusal;
  assert.ok(refusal,'رفض بلا شكل مهيكل يُرسم');
  assert.ok(refusal.missing.length&&refusal.missing[0].owner.includes('رأس المال البشري'),'الرفض لا يسمّي من يُطلب منه');
  assert.ok(refusal.next.length>10,'رفض بلا خطوة تالية');
  // ولا يتسرب تاريخ ميلاد الزميل من أي طريق آخر: الكتابة كذلك ممنوعة على غير الموارد البشرية.
  assert.throws(()=>tx(()=>saveEmployeePersonal(db,users.employee,'outsider',{version:0,birth_date:'1990-01-01',source:'محاولة تجريبية'})),code('not_permitted'));
  assert.throws(()=>tx(()=>saveEmployeePersonal(db,users.manager,'employee',{version:0,birth_date:'1990-01-01',source:'محاولة تجريبية'})),code('not_permitted'));
  // ولا يسجّل أحد بيانات نفسه: مُعِدّ السجل غير صاحبه.
  assert.throws(()=>tx(()=>saveEmployeePersonal(db,users.hr,'hr',{version:0,birth_date:'1990-01-01',source:'محاولة تجريبية'})),code('separation_of_duties'));
});

test('employee-profile: a line manager sees work data but never a birth date, an age or a marital status', t => {
  const {db,users,tx}=fixture(t);
  tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:0,birth_date:'1996-03-10',marital_status:'married',
    education_level:'bachelor',education_field:'تصميم جرافيكي',prior_experience_months:30,source:'شهادة ميلاد تجريبية'}));
  const asManager=employeeProfile(db,users.manager,'employee');
  assert.equal(asManager.scope,'manager');
  // ما يبقى للمدير من قائمة البيانات الشخصية بندان لا يخصّان شخصًا: المعرّف في المنصة، وامتناعها عن رقم الهوية.
  // البند الثاني غرضه كله أن يُعلن الامتناع، فإخفاؤه عن المدير يجعل امتناعًا مقصودًا يبدو نقصًا يُسدّ — أو لا يُرى أصلًا.
  assert.deepEqual(asManager.tabs.overview.personal.map(f=>f.key),['employee_number','national_id','nationality','gender']);
  assert.equal(byKey(asManager,'national_id').kind,'not_stored');
  assert.equal(byKey(asManager,'national_id').reason,NO_NATIONAL_ID);
  const withheld=asManager.tabs.overview.personal_withheld;
  assert.ok(withheld&&withheld.why.length>10&&withheld.owner.length>3,'الحجب بلا سبب ولا مالك');
  // ويُسمّى كل ما حُجب لا ثلاثة من خمسة: الجنسية والجنس يسقطان بتصريحهما هما، ولا يُتركان بلا اسم.
  assert.deepEqual(withheld.fields,['تاريخ الميلاد','العمر','الحالة الاجتماعية','الجنسية','الجنس']);
  for(const name of withheld.fields)assert.ok(withheld.what.includes(name),`«${name}» محجوب بلا اسم`);
  // والجنسية والجنس يقولان «محجوب» لا «غير مسجَّل»: الثانية تنفي سجلًا قائمًا وتجيب عن سؤال لم يُسأل.
  for(const key of ['nationality','gender'])assert.match(byKey(asManager,key).reason,/تصريح لوحة تركيبة القوى العاملة/,key);
  // لا تسرب في أي موضع من الحمولة كلها، لا في قيمة ولا في نص ولا في مفتاح.
  const all=texts(asManager).join(' '),names=flatten(asManager);
  for(const secret of ['1996-03-10','married','متزوج'])assert.ok(!all.includes(secret),`تسرّب «${secret}» إلى حمولة المدير`);
  for(const key of ['birth_date','marital_status'])assert.ok(!names.includes(key),`مفتاح «${key}» في حمولة المدير`);
  // ولا عدّادُ نسخةٍ ولا طابع وقت على سجل شخصي لزميل: رقم يتصاعد بتاريخه يقول إن شيئًا في حياة إنسان تغيّر ومتى،
  // وهو ما تحرس منه هذه الوحدة. النسخة تُسلّح النموذج، ولا نموذج لمن لا يرى البيانات (can.edit_personal كاذبة له).
  assert.equal(asManager.can.edit_personal,false);
  assert.equal(asManager.personal_version,null,'نسخة السجل الشخصي في حمولة من لا يراه');
  assert.equal(asManager.personal_updated_at,null,'طابع تحديث السجل الشخصي في حمولة من لا يراه');
  // وما يخص العمل يصل إليه كاملًا.
  assert.equal(byKey(asManager,'job_title').kind,'recorded');
  assert.equal(byKey(asManager,'department').kind,'recorded');
  assert.equal(byKey(asManager,'start_date').kind,'recorded');
  assert.equal(byKey(asManager,'internal').kind,'derived');
  // المستوى التعليمي بيانُ عملٍ يراه المدير؛ والراتب لا يراه أحد من هذه الشاشة.
  assert.equal(byKey(asManager,'education_level').kind,'recorded');
  assert.equal(asManager.tabs.contract.pay_visible,false);
  assert.ok(!names.some(k=>/pay_lines|monthly_total|amount_minor|salary/i.test(k)),'بند أجر في حمولة الملف');
  // ومزايا الموظف ليست من بيانات العمل: تُحجب عن المدير بسببها لا بصمت.
  assert.equal(asManager.tabs.benefits.available,false);
  assert.ok(asManager.tabs.benefits.reason.includes('مديره المباشر'),asManager.tabs.benefits.reason);
  assert.equal(asManager.tabs.benefits.items.length,0);
  // وصاحبة الملف ترى كل ذلك، والموارد البشرية كذلك.
  for(const who of ['employee','hr']){
    const seen=employeeProfile(db,users[who],'employee');
    assert.equal(byKey(seen,'birth_date').value,'1996-03-10',who);
    assert.equal(byKey(seen,'marital_status').value,'married',who);
    assert.equal(byKey(seen,'age').kind,'derived',who);
  }
});

test('employee-profile: the personal record is version-checked, validated against its enumerations and append-only', t => {
  const {db,users,tx}=fixture(t);
  tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:0,birth_date:'1996-03-10',source:'شهادة ميلاد تجريبية'}));
  // نسخة قديمة تُرفض، والصحيحة تمر.
  assert.throws(()=>tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:0,marital_status:'single',source:'شهادة ميلاد تجريبية'})),code('stale_version'));
  tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:1,marital_status:'single',source:'شهادة ميلاد تجريبية'}));
  assert.equal(db.prepare('SELECT version FROM employee_personal WHERE user_id=?').get('employee').version,2);
  // قيمة خارج القائمة المغلقة تُرفض في الوحدة قبل القاعدة.
  for(const [payload,expected] of [[{marital_status:'مخطوب'},'marital_status'],[{education_level:'روضة'},'education_level'],
    [{prior_experience_months:-1},'prior_experience_months'],[{prior_experience_months:5.5},'prior_experience_months'],[{birth_date:'2030-01-01'},'birth_date']])
    assert.throws(()=>tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:2,source:'وثيقة تجريبية',...payload})),code(expected),JSON.stringify(payload));
  // صفر خبرة سابقة قيمةٌ مسجَّلة تختلف عن «غير مسجَّلة»: الأولى تُجمع، والثانية تُعلن مجهولة.
  tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:2,prior_experience_months:0,source:'إفادة خبرة تجريبية'}));
  const zero=employeeProfile(db,users.hr,'employee');
  assert.equal(byKey(zero,'prior').kind,'recorded');
  assert.equal(byKey(zero,'prior').value,0);
  assert.equal(byKey(zero,'total').kind,'derived');
  tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:3,source:'إفادة خبرة تجريبية'}));
  assert.equal(byKey(employeeProfile(db,users.hr,'employee'),'prior').kind,'unavailable','المحو أعاد الحقل مجهولًا كما يجب');
  // السجل لا يُحذف ولا تُقفز نسخته، والقيد في القاعدة لا في الوحدة وحدها.
  assert.throws(()=>db.exec("DELETE FROM employee_personal WHERE user_id='employee'"),/retained/);
  assert.throws(()=>db.exec("UPDATE employee_personal SET version=99 WHERE user_id='employee'"),/stale personal record/);
  assert.ok(verifyAudit(db));
});

test('NFR-08: migration 121 upgrades a pre-121 database without touching its rows, and applies once', t => {
  const directory=mkdtempSync(join(tmpdir(),'36t-migrate-121-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'local.sqlite'),db=new DatabaseSync(path);
  const schema=readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8');
  db.exec(schema);db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(schema));
  seed(db,'synthetic-migration-121');
  // قاعدة ما قبل 121 حقيقية: تُطبَّق كل الترحيلات المرقّمة دون 121 بالترتيب، ويُترك 121 وحده غائبًا.
  const directoryUrl=new URL('../app/migrations/',import.meta.url);
  const earlier=readdirSync(directoryUrl).filter(f=>/^\d{3}-.+\.sql$/.test(f)&&Number(f.slice(0,3))<121).sort();
  for(const file of earlier){
    const sql=readFileSync(new URL(file,directoryUrl),'utf8');
    db.exec(sql);db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(Number(file.slice(0,3)),hash(sql));
  }
  const usersBefore=JSON.stringify(db.prepare('SELECT id,username,role FROM users ORDER BY id').all());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='employee_personal'").get().n,0,'الجدول موجود قبل ترحيله');
  db.close();
  const upgraded=openDb(path);
  assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=121').get().n,1,'الترحيل 121 لم يُطبَّق');
  assert.equal(JSON.stringify(upgraded.prepare('SELECT id,username,role FROM users ORDER BY id').all()),usersBefore,'الترقية غيّرت صفوف القاعدة القديمة');
  const columns=upgraded.prepare("SELECT name,\"notnull\" AS required FROM pragma_table_info('employee_personal')").all();
  assert.deepEqual(columns.map(c=>c.name),['user_id','tenant_id','birth_date','marital_status','education_level','education_field','prior_experience_months','source','recorded_by','version','updated_at']);
  // كل حقل بيانات قابل لـNULL: المجهول يبقى مجهولًا ولا يأخذ قيمة افتراضية تُقرأ لاحقًا كأن إنسانًا سجّلها.
  for(const column of columns.filter(c=>['birth_date','marital_status','education_level','education_field','prior_experience_months'].includes(c.name)))
    assert.equal(column.required,0,`${column.name}: حقل بيانات شخصية غير قابل لـNULL`);
  assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM employee_personal').get().n,0,'الترحيل بذر بيانات شخصية');
  assert.ok(upgraded.prepare('SELECT COUNT(*) AS n FROM users').get().n>0,'الترحيل أضاع حسابات القاعدة القديمة');
  // القيود المعلنة مفروضة في القاعدة نفسها.
  const insert=(user,extra='')=>upgraded.exec(`INSERT INTO employee_personal(user_id,tenant_id,source,recorded_by,updated_at${extra?',marital_status':''}) VALUES('${user}','36t','وثيقة تجريبية','hr','2026-09-21T00:00:00.000Z'${extra?`,'${extra}'`:''})`);
  assert.throws(()=>insert('hr'),/CHECK/,'سجّل موظف بياناته بنفسه');
  assert.throws(()=>insert('employee','مخطوب'),/CHECK/,'حالة اجتماعية خارج القائمة المغلقة');
  insert('employee');
  const checksums=JSON.stringify(upgraded.prepare('SELECT * FROM schema_migrations ORDER BY version').all());upgraded.close();
  const again=openDb(path);
  assert.equal(JSON.stringify(again.prepare('SELECT * FROM schema_migrations ORDER BY version').all()),checksums,'الترحيل طُبِّق مرتين');
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM employee_personal').get().n,1,'إعادة الفتح أضاعت السجل');
  again.close();
});

/* ───── الخصوصية: من يقرأ ماذا، ومن يُسجَّل أنه قرأ ───── */

test('employee-profile: the platform administrator reads no employee’s birth date, marital status, gender or nationality', t => {
  const {db,users,tx}=fixture(t);
  tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:0,birth_date:'1996-03-10',marital_status:'married',source:'شهادة ميلاد تجريبية'}));
  tx(()=>recordDemographics(db,users.hr,'employee',{version:0,nationality_group:'saudi',gender:'female',source:'وثيقة تجريبية'}));
  // امتياز الأدمن الأول يمر في can لأن employees.view ليس تصريحًا حساسًا، ولا يمر في holds بلا منح مسجَّل.
  // القاعدة مكتوبة في app/my-profile.mjs ومطبَّقة في app/workforce.mjs، وهذه الوحدة كانت الباب الوحيد الذي يخالفها.
  assert.equal(holds(db,users.admin,'employees.view'),false,'الأدمن يحمل تصريح السجل الوظيفي بمنح مسجَّل');
  let refused=null;
  try{employeeProfile(db,users.admin,'employee');}catch(error){refused=error;}
  assert.ok(refused,'حساب إدارة المنصة فتح ملف موظفة وقرأ تاريخ ميلادها');
  assert.equal(refused.status,404);
  // وملفه هو: لا ملف لحساب إدارة المنصة أصلًا، فيُقال ذلك بدل «لا صفة لك على ملف زميلك» وهو صاحب الطلب.
  let own=null;
  try{employeeProfile(db,users.admin,'admin');}catch(error){own=error;}
  assert.ok(own,'حساب إدارة المنصة فُتح له ملف موظف');
  const refusal=own.details?.refusal;
  assert.ok(refusal.what.includes('حساب إدارة المنصة'),refusal.what);
  assert.ok(!refusal.missing[0].why.includes('زميل'),'الرفض يصف صاحب الطلب زميلًا بلا صفة، وهو صاحبه');
  // والدليل: لا جنس ولا جنسية لحساب لا يحمل تصريح لوحة تركيبة القوى العاملة.
  const directory=employeeDirectory(db,users.admin);
  assert.equal(directory.genders,null);
  assert.equal(directory.withheld_columns.length,1);
  for(const row of directory.rows)assert.equal(row.gender_name,null,row.id);
});

test('employee-profile: the employee-records capability alone does not unlock gender and nationality', t => {
  const {db,users,tx}=fixture(t);
  tx(()=>recordDemographics(db,users.hr,'employee',{version:0,nationality_group:'saudi',gender:'female',source:'وثيقة تجريبية'}));
  tx(()=>grantAccess(db,users.admin,{user_id:'it',capability:'employees.view',department_id:null,note:'تصريح السجل الوظيفي وحده — حالة اختبار'}));
  const it=db.prepare("SELECT * FROM users WHERE id='it'").get();
  assert.equal(holds(db,it,'employees.view'),true);
  assert.equal(holds(db,it,'hr.workforce.view'),false,'الحساب يحمل تصريح لوحة القوى العاملة، فالاختبار لا يقيس شيئًا');
  // الملف يُفتح بتصريح السجل الوظيفي، والجنس والجنسية يبقيان عند تصريحهما هما — لا يُدمج تصريحان بلا قرار يُكتب.
  const profile=employeeProfile(db,it,'employee');
  assert.equal(profile.scope,'hr');
  for(const key of ['nationality','gender']){
    assert.equal(byKey(profile,key).kind,'unavailable',key);
    assert.match(byKey(profile,key).reason,/تصريح لوحة تركيبة القوى العاملة/,key);
  }
  assert.ok(!texts(profile).join(' ').includes('أنثى'),'الجنس المسجَّل تسرّب إلى حامل تصريح السجل الوظيفي وحده');
  const directory=employeeDirectory(db,it);
  assert.equal(directory.scope,'people','حامل تصريح السجل الوظيفي يرى الدليل كله');
  assert.equal(directory.genders,null,'مرشّح الجنس مفتوح لمن لا يحمل تصريح تركيبة القوى العاملة');
  assert.equal(directory.withheld_columns[0].why.includes('hr.workforce.view'),true);
  for(const row of directory.rows)assert.equal(row.nationality_name,null,row.id);
  // وحامل تصريح تركيبة القوى العاملة يراهما: الحجب عن الصفة لا عن الجميع.
  const asHr=employeeDirectory(db,users.hr);
  assert.deepEqual(asHr.withheld_columns,[]);
  assert.equal(asHr.rows.find(r=>r.id==='employee').gender_name,'أنثى');
});

test('employee-profile: reading a colleague’s profile leaves an append-only record of who read it', t => {
  const {db,users}=fixture(t);
  const count=()=>db.prepare('SELECT COUNT(*) AS n FROM employee_profile_views').get().n;
  employeeProfile(db,users.employee,'employee');
  assert.equal(count(),0,'اطلاع الموظف على ملفه هو سُجِّل اطلاعًا على غيره');
  employeeProfile(db,users.hr,'employee');
  employeeProfile(db,users.manager,'employee');
  assert.equal(count(),2,'قراءة ملف زميل لم تترك أثرًا');
  const rows=db.prepare('SELECT * FROM employee_profile_views ORDER BY created_at').all();
  assert.deepEqual(rows.map(r=>[r.viewer_id,r.subject_user_id,r.scope]),[['hr','employee','hr'],['manager','employee','manager']]);
  for(const row of rows)assert.match(row.created_at,/^\d{4}-\d{2}-\d{2}T/);
  // سجل من اطّلع لا يُنقّح بعد وقوعه ولا يُمحى، والقيد في القاعدة لا في الوحدة وحدها.
  assert.throws(()=>db.exec(`UPDATE employee_profile_views SET viewer_id='employee' WHERE id='${rows[0].id}'`),/append-only/);
  assert.throws(()=>db.exec('DELETE FROM employee_profile_views'),/retained/);
  assert.ok(verifyAudit(db),'سلسلة التدقيق انكسرت');
});

test('employee-profile: the attendance-exemption reason reaches only the readers the attendance screen itself allows', t => {
  const {db,users,tx}=fixture(t);
  const REASON='إعفاء لحالة صحية مزمنة موثقة بتقرير طبي (نص تجريبي)';
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.attendance.approve',department_id:null,note:'اعتماد الإعفاء — حالة اختبار'}));
  const exemption=tx(()=>proposeExemption(db,users.hr,{user_id:'employee',from_date:'2026-01-01',to_date:'2026-12-31',reason:REASON})).id;
  tx(()=>decideExemption(db,users.manager,exemption,'approve',{note:'اعتماد تجريبي'}));
  tx(()=>grantAccess(db,users.admin,{user_id:'it',capability:'employees.view',department_id:null,note:'تصريح السجل الوظيفي وحده — حالة اختبار'}));
  const it=db.prepare("SELECT * FROM users WHERE id='it'").get();
  // صاحبه ومديره المباشر وحامل تصريحَي الحضور: يصلهم السبب، كما تصلهم رفوف الإعفاءات في شاشة الحضور نفسها.
  for(const who of [users.employee,users.manager,users.hr]){
    const flag=employeeProfile(db,who,'employee').flags[0];
    assert.ok(flag.detail.includes(REASON),`${who.id}: صفة تقرأ الإعفاء ولم يصلها سببه`);
    assert.equal(flag.reason_withheld,false,who.id);
  }
  // ومن ليست له تلك الصفة يرى العلم ومداه بلا السبب: نصٌّ حرٌّ قد يحمل تفصيلًا صحيًّا.
  const flag=employeeProfile(db,it,'employee').flags[0];
  assert.equal(flag.name,'مستثنى من البصمة');
  assert.equal(flag.detail,'من 2026-01-01 إلى 2026-12-31');
  assert.equal(flag.reason_withheld,true);
  assert.ok(!texts(employeeProfile(db,it,'employee')).join(' ').includes('صحية'),'سبب الإعفاء تسرّب في موضع آخر من الحمولة');
});

/* ───── العقد والخبرة: ما يُنسب إلى مصدره، وما يقوله عن نفسه ───── */

test('employee-profile: an indefinite contract never borrows an end date from the employment record, and a clash is disclosed', t => {
  const {db,users,tx}=fixture(t);
  // حالة قابلة للوقوع من الواجهة: employees.saveProfile يقبل contract_end بلا مقابلة بسجل العقود.
  tx(()=>saveProfile(db,users.hr,'employee',{job_title:'مصممة أولى (تجريبي)',employment_type:'full_time',join_date:'2026-02-01',contract_end:'2026-10-01',status:'active'}));
  const contract=db.prepare("SELECT * FROM employment_contracts WHERE user_id='employee' AND status='active'").get();
  assert.equal(contract.contract_type,'indefinite');
  assert.equal(contract.end_date,null,'العقد يحمل تاريخ نهاية، فالحالة المقيسة ليست هي');
  const profile=employeeProfile(db,users.hr,'employee'),end=byKey(profile,'end_date');
  // العقد هو المصدر، وغير محدد المدة لا نهاية له: تاريخُ سجلٍ آخر منسوبًا إلى «العقد المسجَّل» كذبٌ يكذّبه البند الذي يليه.
  assert.equal(end.text,'غير محدد المدة');
  assert.notEqual(end.value,'2026-10-01');
  assert.equal(byKey(profile,'contract_type').text,'غير محدد المدة');
  assert.equal(profile.tabs.contract.indefinite,true);
  assert.equal(profile.tabs.contract.progress.percent,null,'نسبة إنجاز لعقد بلا تاريخ نهاية');
  // واختلاف السجلين يُقال، ويُقال عند من يُحسم.
  assert.ok(end.note.includes('2026-10-01'),end.note);
  assert.ok(end.note.includes('يتعارض'),end.note);
  assert.ok(end.note.includes('رأس المال البشري'),end.note);
  // والدليل يقول عن الشخص نفسه في اللحظة نفسها ما يقوله الملف.
  assert.equal(employeeDirectory(db,users.hr).rows.find(r=>r.id==='employee').contract_end_text,'غير محدد المدة');
  // وبلا عقد أصلًا، يُنسب تاريخ الملف الوظيفي إلى الملف الوظيفي باسمه. (العقد المرفوض ليس عقدًا ساريًا ولا منتهيًا،
  // والعقود لا تُحذف: يُرفض عقد «موظف اختبار آخر» المعلَّق فيبقى الحساب بلا عقد مسجَّل.)
  const {db:plain,users:people,tx:tx2}=fixture(t);
  const open=plain.prepare("SELECT * FROM employment_contracts WHERE user_id='outsider'").get();
  tx2(()=>contractAction(plain,people.manager,open.id,'reject_contract',{version:open.version,note:'رفض تجريبي لبناء حالة الاختبار'}));
  tx2(()=>saveProfile(plain,people.hr,'outsider',{job_title:'كاتب (تجريبي)',employment_type:'full_time',join_date:'2026-02-01',contract_end:'2026-10-01',status:'active'}));
  const filed=byKey(employeeProfile(plain,people.hr,'outsider'),'end_date');
  assert.equal(filed.value,'2026-10-01');
  assert.equal(filed.source,'السجل الوظيفي');
});

test('employee-profile: a contract recorded as ended is not described as still running', t => {
  const {db,users,tx}=fixture(t);
  const pending=db.prepare("SELECT * FROM employment_contracts WHERE user_id='outsider'").get();
  tx(()=>contractAction(db,users.manager,pending.id,'reject_contract',{version:pending.version,note:'رفض تجريبي لبناء حالة الاختبار'}));
  const id=tx(()=>prepareContract(db,users.hr,{user_id:'outsider',contract_type:'fixed_term',job_title:'كاتب محتوى (تجريبي)',work_location:'الرياض',
    start_date:'2026-01-01',end_date:'2026-06-30',weekly_hours:40,probation_days:90,notice_days:60,
    pay_lines:[{component:'basic',amount:'6500.00'}],document_reference:'عقد تجريبي محدد المدة'})).id;
  const version=()=>getContract(db,users.hr,id).version;
  tx(()=>contractAction(db,users.hr,id,'submit_contract',{version:version()}));
  tx(()=>contractAction(db,users.manager,id,'approve_contract',{version:version(),note:'اعتماد تجريبي'}));
  // ما دام مسجَّلًا ساريًا وقد انقضت مدته، فهذا ما يُقال بالضبط.
  const running=employeeProfile(db,users.hr,'outsider');
  assert.equal(running.tabs.contract.status.key,'active');
  assert.equal(byKey(running,'duration').note,'انقضت المدة المسجَّلة وما زال العقد مسجلًا ساريًا');
  tx(()=>contractAction(db,users.manager,id,'end_contract',{version:version(),ended_on:'2026-06-30',reason:'انتهاء المدة المسجَّلة — حالة اختبار'}));
  const ended=employeeProfile(db,users.hr,'outsider');
  // وحين يُسجَّل منتهيًا، لا تبقى الملاحظة تقول إنه ساري: الحمولة نفسها تكذّبها في السطر المجاور.
  assert.equal(ended.tabs.contract.status.name,'منتهٍ');
  assert.equal(byKey(ended,'duration').note,'انقضت المدة المسجَّلة، والعقد مسجَّل منتهيًا');
  assert.ok(!byKey(ended,'duration').note.includes('ما زال'),byKey(ended,'duration').note);
  // وتمييز العدد العربي: «لا يوم عمل متبقيًا» لا «0 يوم عمل متبقٍ».
  assert.ok(byKey(ended,'duration').text.includes('لا يوم عمل متبقيًا'),byKey(ended,'duration').text);
  assert.ok(!/\d+ يوم عمل متبقٍ/.test(byKey(ended,'duration').text),byKey(ended,'duration').text);
});

test('employee-profile: a start date that has not arrived yet is said so, not reported as a missing date', t => {
  const {db,users,tx}=fixture(t);
  const profile=employeeProfile(db,users.hr,'employee');
  tx(()=>saveProfile(db,users.hr,'employee',{job_title:'مصممة أولى (تجريبي)',employment_type:'full_time',join_date:'2026-12-01',status:'active'}));
  const future=employeeProfile(db,users.hr,'employee');
  assert.ok(future.today<'2026-12-01','اليوم تجاوز تاريخ المباشرة المستقبلي، فالحالة المقيسة ليست هي');
  const internal=byKey(future,'internal');
  // البند الذي قبله يعرض التاريخ نفسه، فلا يصح أن يقول هذا «لا تاريخ مباشرة».
  assert.equal(byKey(future,'start_date').kind,'recorded');
  assert.equal(internal.kind,'derived','خبرة داخلية معلومة (صفر) عُرضت مجهولة');
  assert.equal(internal.value,0);
  assert.ok(internal.text.includes('2026-12-01'),internal.text);
  assert.ok(!internal.reason.includes('لا تاريخ مباشرة'),internal.reason);
  // والإجمالي يتبعه بالسبب الصحيح: الناقص الخبرة السابقة وحدها.
  const total=byKey(future,'total');
  assert.equal(total.kind,'unavailable');
  assert.ok(total.reason.includes('الخبرة السابقة'),total.reason);
  assert.ok(!total.reason.includes('لا تاريخ مباشرة'),total.reason);
  // وبتسجيل الخبرة السابقة يصير الإجمالي معروفًا، وهو الخبرة السابقة وحدها.
  tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:0,prior_experience_months:30,source:'شهادات خبرة تجريبية'}));
  assert.equal(byKey(employeeProfile(db,users.hr,'employee'),'total').value,30);
  assert.equal(profile.tabs.experience.length,3);
});

/* ───── الدليل: حمولته مقيسة، لا ترميزه وحده ───── */

test('employee-profile: the directory withholds gender and nationality by their own capability and names the column', t => {
  const {db,users,tx}=fixture(t);
  tx(()=>recordDemographics(db,users.hr,'employee',{version:0,nationality_group:'saudi',gender:'female',source:'وثيقة تجريبية'}));
  const asManager=employeeDirectory(db,users.manager);
  assert.equal(asManager.scope,'team');
  assert.ok(asManager.rows.length&&asManager.rows.every(r=>r.id==='manager'||r.id==='employee'||r.id==='outsider'));
  // لا «غير مسجَّل» عن عمود لم يُسأل عنه: القيمة null، والسبب والمالك في withheld_columns وحده.
  for(const row of asManager.rows){
    assert.equal(row.gender,null,row.id);assert.equal(row.gender_name,null,row.id);
    assert.equal(row.nationality,null,row.id);assert.equal(row.nationality_name,null,row.id);
  }
  assert.equal(asManager.genders,null);
  assert.equal(asManager.unrecorded.gender,null);
  assert.deepEqual(asManager.withheld_columns.map(c=>c.column),['الجنس والجنسية']);
  assert.ok(asManager.withheld_columns[0].owner.includes('رأس المال البشري'));
  // ولا يدخل النص الكاذب شجرة الصفحة حتى في نص المرشّح المخفي في الصف.
  const html=employeesUI.render({scope:'team',rows:[],missing_profiles:0,expiring:0,expiring_documents:[],directory:asManager},
    {e:value=>String(value??''),button:()=>'',ui:kit(value=>String(value??''))});
  assert.ok(!html.includes('غير مسجَّل غير مسجَّل'),'«غير مسجَّل» عن عمود محجوب في نص المرشّح');
  assert.ok(html.includes('معرّف الحساب'),'ترويسة العمود الأول');
  assert.ok(!html.includes('<th>الرقم الوظيفي</th>'),'العمود يسمّي معرّف الحساب «رقمًا وظيفيًا»، والملف يقول إنه غير متاح');
  // وحامل تصريح تركيبة القوى العاملة يرى العمودين وعدّ «غير مسجَّل» فيهما.
  const asHr=employeeDirectory(db,users.hr);
  assert.deepEqual(asHr.withheld_columns,[]);
  assert.equal(asHr.rows.find(r=>r.id==='employee').gender_name,'أنثى');
  assert.equal(asHr.rows.find(r=>r.id==='outsider').gender_name,'غير مسجَّل');
  assert.equal(asHr.unrecorded.gender,asHr.rows.filter(r=>!r.gender).length);
  // وإجمالي الخبرة يبقى مجهولًا ما دامت الخبرة السابقة غير مسجَّلة، ولا يساوي الداخلية صامتًا.
  for(const row of asHr.rows)assert.equal(row.total_experience_months,null,row.id);
  assert.equal(asHr.unrecorded.prior_experience,asHr.rows.length);
});

/* ───── الشاشة: ما حُسب يُرسم، وما أُسقط يُقال ───── */

test('employee-profile: the screen draws the contract badge, the hidden benefits and the Arabic count', t => {
  const {db,users,tx}=fixture(t);
  tx(()=>saveEmployeePersonal(db,users.hr,'employee',{version:0,birth_date:'1996-03-10',marital_status:'married',
    education_level:'bachelor',education_field:'تصميم جرافيكي',prior_experience_months:30,source:'شهادة ميلاد تجريبية'}));
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const render=who=>employeeProfileUI.render(employeeProfile(db,users[who],'employee'),
    {e,button:()=>'',ui:kit(e),tr:ar=>ar,date:value=>String(value)});
  const own=render('employee'),data=employeeProfile(db,users.employee,'employee');
  // شارة حالة العقد: محسوبة في الوحدة، وكانت تُسقط من الشاشة صامتة — وهي في صور المرجع صراحةً.
  assert.equal(data.tabs.contract.status.key,'active');
  assert.ok(own.includes('class="badge approved"'),'شارة حالة العقد لا تُرسم');
  assert.ok(own.includes('ساري'),'عبارة الوحدة لحالة العقد لا تصل الشاشة');
  // المزايا المخفية: عددٌ يُقدَّم كأنه الكل بينما أُسقط منه جزء صامتًا.
  assert.ok(data.tabs.benefits.hidden_pending_count>0,'لا مزايا مخفية في البذرة، فالحالة المقيسة ليست هي');
  assert.ok(own.includes('لا تظهر هنا'),'العدد المخفي لا يُذكر في الشاشة');
  assert.ok(own.includes('مصفوفة المزايا'),'العدد المخفي بلا سبب');
  assert.ok(own.includes('مدير الموارد البشرية'),'العدد المخفي بلا مالك');
  // ميزة مسودة: عنوانها حالة كتالوجها لا حالة استحقاقها، وتحذيرها في جسمها.
  const draft=data.tabs.benefits.items.find(item=>!item.accepted);
  assert.ok(draft&&draft.status_name&&draft.draft_warning,'بطاقة مسودة بلا حالة كتالوج ولا تحذير');
  assert.ok(own.includes(`<small>${e(draft.status_name)}</small>`),'عنوان بطاقة المسودة يحمل حالة الاستحقاق');
  assert.ok(own.includes(draft.draft_warning),'تحذير المسودة أُسقط من البطاقة');
  // «آخر تحديث» يُسمّى بما يقيسه: سجل البيانات الشخصية وحده، لا الملف المركّب من ستة سجلات.
  assert.ok(own.includes('آخر تحديث للبيانات الشخصية'),'طابع سجل واحد يُقدَّم على أنه تحديث الملف كله');
  // ولا يُعرض هذا السطر لمن لا يرى السجل أصلًا.
  assert.ok(!render('manager').includes('آخر تحديث'),'طابع سجل شخصي في شاشة من لا يراه');
});

test('employee-profile: «مستندات تهمني» is a truthful ten-card library with no invented download', t => {
  const {db,users}=fixture(t);
  const profile=employeeProfile(db,users.employee,'employee');
  const documents=profile.tabs.important_documents;
  assert.ok(documents,'تبويب «مستندات تهمني» غير موجود');
  assert.equal(documents.total,10);
  assert.equal(documents.items.length,10);
  assert.deepEqual(documents.items.map(item=>item.key),[
    'job_description','key_performance_indicators','workflow_model','standard_operating_procedures',
    'policies_and_procedures','employee_benefits','employee_handbook','plan_30_60_90',
    'performance_evaluation_system','employment_contract'
  ]);
  assert.deepEqual([...new Set(documents.items.map(item=>item.group))],['دوري وأدائي','حقوقي ومرجعي']);
  for(const item of documents.items){
    assert.ok(['available','needs_setup','pending_approval','needs_update'].includes(item.status),`${item.key}: حالة غير معروفة`);
    assert.ok(item.status_name.length>3,`${item.key}: حالة بلا اسم`);
    assert.ok(item.summary.length>10,`${item.key}: وصف ناقص`);
    if(item.status==='needs_setup'){
      assert.equal(item.href,'',`${item.key}: رابط على مستند غير موجود`);
      assert.ok(item.owner.length>3,`${item.key}: ناقص بلا مالك`);
      assert.ok(item.next_step.length>10,`${item.key}: ناقص بلا خطوة تالية`);
    }else assert.ok(item.source.length>3,`${item.key}: مستند أو سجل قائم بلا مصدر`);
  }
  for(const key of ['job_description','workflow_model','standard_operating_procedures','plan_30_60_90'])
    assert.equal(documents.items.find(item=>item.key===key).href,'',`${key}: رابط مخترع`);
  assert.equal(documents.items.find(item=>item.key==='employment_contract').status,'available');
  assert.equal(documents.available,documents.items.filter(item=>item.status==='available').length);
  assert.equal(documents.actionable,documents.items.filter(item=>item.href).length);

  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html=employeeProfileUI.render(profile,{e,button:()=>'',ui:kit(e),tr:ar=>ar,date:value=>String(value)});
  assert.ok(html.includes('مستندات تهمني'));
  assert.equal((html.match(/class="ep-doc-card/g)??[]).length,10);
  assert.ok(html.includes(`${documents.available} من 10 متاح`),'ملخص الإتاحة غير معروض');
  for(const item of documents.items)assert.ok(html.includes(item.title),`بطاقة ${item.title} غير مرسومة`);
  assert.ok(!html.includes('job_description-download'),'زر تنزيل مخترع للوصف الوظيفي');
  assert.ok(!/<script\b|\sstyle=/i.test(html),'التبويب خالف سياسة الأمان بترميز تنفيذي أو نمط سطري');

  const css=readFileSync(new URL('../app/static/style.css',import.meta.url),'utf8');
  assert.ok(css.includes('#ep-tab-important-documents:checked ~ #ep-panel-important-documents'),'التبويب الخامس غير موصول بلوحته');
  assert.match(css,/\.ep-doc-grid\s*\{[^}]*grid-template-columns/s,'شبكة المستندات بلا أعمدة متجاوبة');
  assert.match(css,/@media \(max-width:480px\)[\s\S]*\.ep-doc-grid\s*\{[^}]*grid-template-columns:1fr/,'شبكة المستندات لا تتحول إلى عمود واحد على الجوال');
});

test('employee-profile: important documents keep coworker privacy and manager payloads free of contract secrets', t => {
  const {db,users}=fixture(t);
  assert.throws(()=>employeeProfile(db,users.employee,'outsider'),code('not_found'));
  const manager=employeeProfile(db,users.manager,'employee');
  const documents=manager.tabs.important_documents;
  assert.equal(documents.items.length,10);
  const payload=JSON.stringify(documents);
  for(const secret of ['pay_lines','monthly_total_minor','document_reference'])
    assert.ok(!payload.includes(secret),`تسرّب حقل عقد سري: ${secret}`);
  const contract=documents.items.find(item=>item.key==='employment_contract');
  assert.equal(contract.href,'','رابط بوابة عقد شخص آخر ظهر لمديره');
  assert.equal(contract.confidential,true);
  const hr=employeeProfile(db,users.hr,'employee');
  assert.equal(hr.tabs.important_documents.items.length,10,'رأس المال البشري لا يرى مكتبة الموظف المخوّل بها');
});

test('employee-profile: a rejected amendment never hides the standing active contract in important documents', t => {
  const {db,users,tx}=fixture(t);
  const active=db.prepare("SELECT * FROM employment_contracts WHERE user_id='employee' AND status='active'").get();
  const input={contract_type:active.contract_type,job_title:active.job_title,work_location:active.work_location,
    start_date:'2026-07-01',weekly_hours:active.weekly_hours,probation_days:active.probation_days,notice_days:active.notice_days,
    pay_lines:JSON.parse(active.pay_lines).map(line=>({component:line.component,amount:(line.amount_minor/100).toFixed(2)})),
    document_reference:'تعديل تجريبي مرفوض؛ لا يوجد مستند فعلي',change_reason:'تعديل تجريبي لاختبار بقاء العقد الساري'};
  let amendment=getContract(db,users.hr,tx(()=>prepareContract(db,users.hr,input,active.id)).id);
  amendment=tx(()=>contractAction(db,users.hr,amendment.id,'submit_contract',{version:amendment.version}));
  amendment=getContract(db,users.manager,amendment.id);
  tx(()=>contractAction(db,users.manager,amendment.id,'reject_contract',{version:amendment.version,note:'رُفض التعديل التجريبي وبقي العقد الحالي ساريًا'}));

  const contract=employeeProfile(db,users.employee,'employee').tabs.important_documents.items.find(item=>item.key==='employment_contract');
  assert.equal(contract.status,'available','التعديل المرفوض أخفى العقد الساري');
  assert.ok(contract.source.includes('ساري'),contract.source);
});
