import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { installCatalogue, formsBoard, acceptDefinition, createInstance, instanceAction, getInstance,
  validateSpec } from '../app/forms.mjs';
import { FORM_CATALOGUE, FORM_DEPARTMENTS, UNVERIFIED_SOURCES, catalogueForm,
  VERIFIED, COMPARISON, APPENDIX, HR_INVENTORY, HR_REGISTER, HR_FOLDER, SPORTS_CLUB_COLUMNS } from '../app/forms-catalogue.mjs';

/* سندٌ يُفتح، وثمانية نماذج موارد بشرية لا تدّعي ما لم يُقرأ.
 *
 * العيبان اللذان أوجبا هذا الملف:
 *   ١. كل حقل في الكتالوج كان يذكر `SOURCE-FILES-VERIFIED.md` سندًا، **والملف غير موجود في الشجرة**. فالشاشة
 *      تطبع «المصدر: …» لوثيقة لا يفتحها أحد. الملف والمقارنة معه (`APPENDIX-VS-ORIGINAL.md`) كانا في إيداع
 *      `3f250b1` على `codex/local-foundation` ولم يصلا خط التكامل، فاستُعيدا بنصّهما لا بإعادة كتابته.
 *   ٢. الكتالوج أربعة وعشرون تعريفًا كلها نماذج دورة المشروع، ولا واحد من نماذج مجلد «نماذج الموارد البشرية 360»
 *      الثمانية. والمجلد ذاك لا يذكره سجل القراءة المباشرة (نطاقه مجلدا دورة العمل، اثنان وثلاثون ملفًا) ولا سجل
 *      الـ65 (تقاطعهما صفر). فلو أُضيفت الثمانية تستشهد بسجل القراءة لكانت إحالةً إلى وثيقة لا تذكرها —
 *      وهذا ما يمنعه هذا الملف: لكل نموذج ملفُ سندِه، ولكل حقل سنده باسم ملفه في درايف.
 *
 * والقاعدة الحاكمة: ما لم يذكره الجرد لا يُقدَّم مسنَدًا. قالبان من الثمانية لم يُقرآ أصلًا (مُنع أحدهما بمصنِّف
 * حماية البيانات الشخصية)، وثالث لا بنية له في الجرد — فحقولها موسومة، وحالتها «بانتظار اعتماد المصدر».
 */
const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const register=()=>JSON.parse(readFileSync(HR_REGISTER,'utf8'));
const hrForms=()=>FORM_CATALOGUE.filter(form=>form.department==='HR');
const fieldsOf=form=>form.sections.flatMap(s=>s.fields);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-forms-catalogue-hr');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  // `people.manage` و`hr.policy.accept` متاحان لدور hr أصلًا؛ المُنَح هنا لمن لا يحملهما بدوره.
  for(const [user,capability] of [['manager','forms.accept'],['hr','hr.policy.accept'],['outsider','people.manage']])
    tx(()=>grantAccess(db,users.admin,{user_id:user,capability,note:'تصريح اصطناعي لاختبار نماذج الموارد البشرية'}));
  tx(()=>installCatalogue(db,'36t'));
  // جهة ارتباط اصطناعية: نماذج هذه العائلة تُعلَّق على طلب خدمة، فيُسجَّل طلبٌ واحد بخدمة البيئة التجريبية.
  const service=db.prepare("SELECT id FROM services WHERE tenant_id='36t' LIMIT 1").get().id,stamp=today();
  db.prepare(`INSERT INTO requests(id,tenant_id,requester_id,service_id,title,payload,status,created_at,updated_at)
    VALUES('req-synthetic-hr','36t','employee',?,'طلب اصطناعي لاختبار النماذج','{}','draft',?,?)`).run(service,stamp,stamp);
  return {db,users,tx};
}

test('the cited source file opens: every form points at a document that exists, and the two recovered documents came back as they were',()=>{
  for(const path of [VERIFIED,COMPARISON,APPENDIX,HR_INVENTORY,HR_REGISTER])
    assert.ok(existsSync(path),`سند معروض على الشاشة ولا يُفتح: ${path}`);
  for(const form of FORM_CATALOGUE){
    assert.ok(existsSync(form.source_doc),`${form.key} يذكر سندًا لا يُفتح: ${form.source_doc}`);
    assert.ok(form.source_note.startsWith(form.source_doc),`${form.key}: سطر المصدر لا يبدأ بملف سنده`);
    assert.ok(!form.source_note.includes('البند null'),`${form.key}: «البند null» على الشاشة`);
  }
  // سجل القراءة المباشرة استُعيد بنصّه: ترويسته وأقسامه التي يحيل إليها الكتالوج (§2 و§11.3) موجودة.
  const verified=readFileSync(VERIFIED,'utf8');
  assert.ok(verified.includes('## 2. `Workflow .key` — **غير قابل للاستخراج**'));
  assert.ok(verified.includes('### 11.3 نسخة 14 سبتمبر (الملف 1) — **لم يُتحقق من محتواها**'));
  assert.ok(readFileSync(COMPARISON,'utf8').length>1000,'وثيقة المقارنة ليست قشرة فارغة');
});

test('the HR forms never cite the project-cycle register, because that register does not mention their folder at all',()=>{
  const verified=readFileSync(VERIFIED,'utf8');
  assert.ok(!verified.includes(HR_FOLDER),'سجل القراءة المباشرة لا يذكر مجلد نماذج الموارد البشرية — فلا يصح سندًا لها');
  for(const form of hrForms()){
    assert.equal(form.source_doc,HR_INVENTORY,`${form.key}: سنده جرد درايف لا سجل دورة المشروع`);
    assert.ok(!form.source_note.includes('SOURCE-FILES-VERIFIED'),`${form.key}: يستشهد بوثيقة لا تذكره`);
    assert.ok(form.source_note.includes(form.source_ref),`${form.key}: سطر المصدر لا يسمّي ملفه في درايف`);
  }
  for(const form of FORM_CATALOGUE.filter(x=>x.department!=='HR'))
    assert.equal(form.source_doc,VERIFIED,`${form.key}: نموذج دورة مشروع سنده سجل القراءة المباشرة`);
});

test('the eight forms of the templates folder are built, and the register and the catalogue say the same thing about each',()=>{
  const rows=register().forms,hr=hrForms();
  assert.equal(rows.length,8,'السجل ثمانية صفوف كما عُدّ المجلد: 11 ملفًا − 2 نسخة مكررة − 1 اختصار');
  assert.equal(hr.length,8,'الثمانية كلها مبنية في الكتالوج');
  assert.equal(new Set(rows.map(r=>r.code)).size,8);
  assert.deepEqual(FORM_DEPARTMENTS.find(d=>d.code==='HR'),{code:'HR',name:'الموارد البشرية'});
  for(const one of rows){
    const form=catalogueForm(one.catalogue_key);
    assert.ok(form,`صف السجل ${one.code} بلا تعريف في الكتالوج`);
    assert.deepEqual(form.aliases.code,[one.code],`${form.key}: رمز السجل هو رمزه الوحيد`);
    assert.ok(form.aliases.file.includes(one.file),`${form.key}: اسم ملفه في درايف اسمٌ بديل محفوظ`);
    assert.equal(form.source_ref,one.file,`${form.key}: سنده المعروض اسم ملفه`);
    assert.equal(form.source_status,one.source_status,`${form.key}: حالة المصدر واحدة في السجل والكتالوج`);
    assert.equal(form.step_no,null,`${form.key}: لا بند له في فهرس دورة المشروع`);
    assert.equal(form.frm,null,`${form.key}: لا رمز FRM له`);
    assert.equal(form.cycle,'دورة الموظف');
    assert.deepEqual(form.subject_kinds,['request']);
    // الرمز رمز سجلٍّ لا رمز مصدر: موسوم حتى لا يُقرأ معرّفًا.
    assert.ok(form.aliases.ambiguous[one.code].includes('لا رمز'),`${form.key}: الرمز يُقدَّم معرّفًا وهو ليس كذلك`);
  }
  assert.deepEqual(hr.map(f=>f.key).sort(),rows.map(r=>r.catalogue_key).sort());
});

test('every field of the eight carries its own basis: the name of its Drive file, or a written reason why it has none',()=>{
  for(const form of hrForms()){
    const fields=fieldsOf(form);
    assert.ok(fields.length,`${form.key}: بلا حقول`);
    for(const field of fields){
      assert.ok(field.help&&field.help.length>20,`${form.key}.${field.key}: حقل بلا سند`);
      const cites=field.help.includes(form.source_ref)||field.help.includes(HR_INVENTORY);
      assert.ok(cites,`${form.key}.${field.key}: سنده لا يسمّي ملفه في درايف ولا الجرد`);
      // ما لا سند له في القالب موسوم: غير متحقَّق، أو مقترح، أو غير محدد في المصدر — ولا يمرّ صامتًا.
      if(field.unverified)assert.ok(field.unverified.length>20,`${form.key}.${field.key}: وسم «غير متحقَّق» بلا سبب مكتوب`);
    }
    assert.ok(form.warnings.length,`${form.key}: بلا تنبيه مصدر`);
    for(const warning of form.warnings)assert.ok(warning.length>40,`${form.key}: تنبيه مصدر أقصر من أن يقول شيئًا`);
  }
});

test('what was never read is declared, not dressed up: the unread templates stay pending, and their unreadable files are listed',()=>{
  const rows=register().forms,unread=rows.filter(r=>r.structure_read==='none');
  assert.equal(unread.length,3,'ثلاثة قوالب لم تُقرأ بنيتها: مخالفة عمل، خطاب الإنذار والخصم، طلب انتداب');
  for(const one of unread){
    const form=catalogueForm(one.catalogue_key);
    assert.equal(form.source_status,'بانتظار اعتماد المصدر',`${form.key}: قالبه لم يُقرأ ويُقدَّم مصدرًا متاحًا`);
    assert.ok(fieldsOf(form).some(f=>f.unverified),`${form.key}: بلا حقل موسوم غير متحقَّق`);
    assert.ok(one.not_read.length>20,`${one.code}: بلا سبب مكتوب لما لم يُقرأ`);
  }
  // لا صف يدّعي قراءة كاملة: لم يُفتح قالبٌ بندًا بندًا في هذه العائلة.
  assert.deepEqual([...new Set(rows.map(r=>r.structure_read))].sort(),['none','partial']);
  // الملفان اللذان تعذّرت قراءتهما يظهران في قائمة ملفات المصدر غير المقروءة، بسببهما وأثرهما على الكتالوج.
  const files=UNVERIFIED_SOURCES.map(s=>s.file);
  for(const file of ['مخالفة عمل.docx','خطاب الإنذار والخصم.pdf'])assert.ok(files.includes(file),`${file} غير معلن`);
  for(const one of UNVERIFIED_SOURCES.filter(s=>s.folder===HR_FOLDER)){
    assert.ok(one.reason.includes('§7'),'سبب تعذّر القراءة يذكر موضعه في الجرد');
    assert.ok(one.catalogue_impact.length>40,'أثر الملف غير المقروء على الكتالوج غير مذكور');
  }
  assert.ok(UNVERIFIED_SOURCES.find(s=>s.file==='مخالفة عمل.docx').reason.includes('حماية البيانات الشخصية'));
});

test('the structure that was read is reproduced in the original order, so the record renders as the company form',()=>{
  // إخلاء الطرف: المحطات الست بترتيب القالب، وكل محطة قسمٌ تملكه، ولكلٍّ بنودها وملاحظتها.
  const clearance=catalogueForm('FORM-HR-CLEARANCE');
  assert.deepEqual(clearance.sections.map(s=>s.owner),
    ['الموارد البشرية','الشؤون الإدارية','المدير المباشر','الإدارة المالية','تقنية المعلومات','الموارد البشرية','الرئيس التنفيذي']);
  for(const key of ['admin_affairs','line_manager','finance','it','hr','ceo']){
    const station=clearance.sections.find(s=>s.key===key);
    assert.equal(station.fields.length,2,`محطة ${key}: بنود تحقّق وملاحظة`);
    assert.ok(station.fields[0].unverified,`محطة ${key}: نصوص بنودها غير مسجّلة في الجرد وتمرّ بلا وسم`);
  }
  // تقييم المقابلة: ثلاثة عشر مؤشرًا بسلّم 1–5، كلها اختيارية لأن القالب يجيز ترك غير المنطبق فارغًا.
  const interview=catalogueForm('FORM-HR-INTERVIEW-EVAL'),indicators=interview.sections.find(s=>s.key==='indicators').fields;
  assert.equal(indicators.length,13);
  for(const one of indicators){
    assert.deepEqual([one.type,one.min,one.max,one.required],['number',1,5,false]);
    assert.ok(one.unverified.includes('13'),'عدد المؤشرات وسلّمها مسنَدان، وعنوان المؤشر لا');
  }
  assert.ok(!fieldsOf(interview).some(f=>f.weight!==undefined),'القالب بلا أوزان، فلا وزن يُخترع');
  // بدل الأندية: أعمدة جدول المستفيدين بنصها من القالب اسمَ حقلٍ، كما تفعل جداول الدفعات في نماذج دورة المشروع.
  const sports=catalogueForm('FORM-HR-SPORTS-CLUB');
  assert.equal(SPORTS_CLUB_COLUMNS.length,5);
  assert.equal(sports.sections.find(s=>s.key==='beneficiaries').fields[0].label,SPORTS_CLUB_COLUMNS.join('، '));
  // النقل: موافقتا مديرين لا واحدة، وكلٌّ بحالتها وملاحظاتها، وبوابة القالب تمنع الاعتماد بغير موافقة المستقبلي.
  const transfer=catalogueForm('FORM-HR-TRANSFER'),keys=fieldsOf(transfer).map(f=>f.key);
  for(const key of ['current_manager_state','current_manager_notes','future_manager_state','future_manager_notes','current_title','future_title'])
    assert.ok(keys.includes(key),`النقل: ${key} مفقود وهو مقروء من القالب`);
  assert.deepEqual(transfer.gates,[{field:'future_manager_state',rule:'equals',value:'موافق',
    message:'القالب يشترط موافقة المدير المباشر المستقبلي: بغير «موافق» ما يمرّ الاعتماد'}]);
});

test('electronic all the way: no signature field and no identity-number field, and every approval seat is one the platform actually has',async()=>{
  const {CAPABILITIES}=await import('../app/access.mjs'),known=new Set(CAPABILITIES.map(c=>c.key));
  for(const form of hrForms()){
    for(const field of fieldsOf(form)){
      assert.ok(!/توقيع|signature/i.test(`${field.label} ${field.label_en??''}`),`${form.key}.${field.key}: سطر توقيع صار حقلًا`);
      // app/pii.mjs: لا تُسجَّل أرقام الهوية أو الإقامة في المنصة بأي حقل — وخانة القالب قرار سياسة لا حقل.
      assert.ok(!/هوية|إقامة|national_id|iqama/i.test(`${field.key} ${field.label}`),`${form.key}.${field.key}: حقل رقم هوية`);
    }
    assert.ok(known.has(form.author.capability),`${form.key}: تصريح معدّ النموذج غير مسجّل`);
    for(const one of form.chain){
      assert.ok(known.has(one.capability),`${form.key}.${one.title}: مقعد اعتماد بتصريح غير مسجّل`);
      assert.ok(one.source&&one.source.length>20,`${form.key}.${one.title}: خطوة اعتماد بلا سطر مصدر`);
    }
  }
  // خانة رقم الهوية في خطاب التعريف بالراتب لا تُدفن: تُقال تنبيهًا مع نص المنع وقرار المالك.
  const salary=catalogueForm('FORM-HR-SALARY-CERT');
  const warning=salary.warnings.find(w=>w.includes('رقم الهوية'));
  assert.ok(warning&&warning.includes('app/pii.mjs')&&warning.includes('قرار'),'خانة رقم الهوية بلا إعلان ولا قرار مالك');
  // ومقاعد القيادة التي لا تصريح عامًّا لها مذكورة في تنبيهات النقل، لا ملبوسة تصريحًا قريبًا.
  const transfer=catalogueForm('FORM-HR-TRANSFER');
  assert.ok(transfer.warnings.some(w=>w.includes('نائب الرئيس للخدمات المؤسسية')&&w.includes('قرار مالك')));
});

test('the eight seed as drafts nobody can fill, and an accepted one runs the ordinary electronic chain end to end',t=>{
  const {db,users,tx}=fixture(t);
  const board=formsBoard(db,users.manager);
  for(const form of hrForms()){
    const definition=board.definitions.find(d=>d.form_key===form.key);
    assert.ok(definition,`${form.key}: لم يُزرع في الكتالوج`);
    assert.equal(definition.status,'draft','يبدأ مسودة لا يُعبّأ حتى يقبله مالكه');
    assert.equal(definition.department_code,'HR');
    assert.doesNotThrow(()=>validateSpec({sections:form.sections,author:form.author,chain:form.chain,
      attachments:form.attachments,subject_kinds:form.subject_kinds,warnings:form.warnings,gates:form.gates,
      depends_on:form.depends_on,classification:form.classification}));
  }
  const transfer=board.definitions.find(d=>d.form_key==='FORM-HR-TRANSFER');
  const payload={employee_ref:'موظف اصطناعي ١',from_department:'إدارة اصطناعية أ',to_department:'إدارة اصطناعية ب',
    current_title:'مسمى اصطناعي حالي',future_title:'مسمى اصطناعي مستقبلي',
    current_manager_state:'موافق',future_manager_state:'موافق'};
  const make=()=>tx(()=>createInstance(db,users.outsider,{form_key:'FORM-HR-TRANSFER',title:'نقل اصطناعي للاختبار',
    subject_kind:'request',subject_id:'req-synthetic-hr',payload}));
  assert.throws(make,code('definition_draft'),'لا تعبئة قبل قبول التعريف');
  tx(()=>acceptDefinition(db,users.manager,'FORM-HR-TRANSFER',{version:transfer.row_version,effective_from:today(),
    note:'أقبل تعريف نموذج النقل مسودةً مزروعة من جرد درايف للتجربة'}));
  const instance=make();
  tx(()=>instanceAction(db,users.outsider,instance.id,'submit',{version:getInstance(db,users.outsider,instance.id).row_version}));
  const submitted=getInstance(db,users.outsider,instance.id);
  assert.equal(submitted.status,'submitted');
  // لا اعتماد ذاتي، ثم يعتمدها مالك المقعد فتُقرأ سلسلتها بالهوية لا بصورة توقيع.
  assert.throws(()=>tx(()=>instanceAction(db,users.outsider,instance.id,'approve',{version:submitted.row_version,note:'أعتمد نموذجي'})));
  tx(()=>instanceAction(db,users.hr,instance.id,'approve',{version:getInstance(db,users.hr,instance.id).row_version,
    note:'اعتماد اصطناعي لمقعد رأس المال البشري'}));
  const approved=getInstance(db,users.hr,instance.id);
  assert.equal(approved.status,'approved');
  assert.ok(verifyAudit(db));
});

test('the gate the template imposes is checked at the electronic approval, and a refused receiving manager blocks it',t=>{
  const {db,users,tx}=fixture(t);
  const transfer=formsBoard(db,users.manager).definitions.find(d=>d.form_key==='FORM-HR-TRANSFER');
  tx(()=>acceptDefinition(db,users.manager,'FORM-HR-TRANSFER',{version:transfer.row_version,effective_from:today(),
    note:'أقبل تعريف نموذج النقل لاختبار بوابة موافقة المدير المستقبلي'}));
  const instance=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-HR-TRANSFER',title:'نقل اصطناعي مرفوض',
    subject_kind:'request',subject_id:'req-synthetic-hr',
    payload:{employee_ref:'موظف اصطناعي ٢',from_department:'إدارة اصطناعية أ',to_department:'إدارة اصطناعية ب',
      current_title:'مسمى اصطناعي حالي',future_title:'مسمى اصطناعي مستقبلي',
      current_manager_state:'موافق',future_manager_state:'غير موافق'}}));
  tx(()=>instanceAction(db,users.outsider,instance.id,'submit',{version:getInstance(db,users.outsider,instance.id).row_version}));
  const submitted=getInstance(db,users.hr,instance.id);
  // البوابة تمنع الاعتماد ولا تمنع الحفظ: النموذج يسجّل الواقع، والبوابة تُفحص عند القرار.
  assert.ok(submitted.open_gates.some(g=>g.message.includes('المدير المباشر المستقبلي')),'بوابة القالب غير معروضة');
  assert.throws(()=>tx(()=>instanceAction(db,users.hr,instance.id,'approve',{version:submitted.row_version,
    note:'اعتماد اصطناعي يجب أن يُمنع ببوابة القالب'})),code('source_gate'));
});
