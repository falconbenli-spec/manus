import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { installCatalogue, formsBoard, aliasLookup, searchForms, acceptDefinition, draftDefinition, validateSpec,
  createInstance, saveInstance, instanceAction, getInstance, instanceRecord, instanceExport, currentDefinition,
  validateForm, openGates, bantSummary, changedSections, fieldsOf } from '../app/forms.mjs';
import { FORM_CATALOGUE, RECEIPT_DOCUMENTS, ADVANCE_DOCUMENT, BANT, BANT_COLUMNS, bantFieldKeys, dependencyGraph,
  AD01_PLATFORMS, AD02_PLATFORMS, PR_DELIVERABLES, INFLUENCER_TIERS, BD04_PAYMENT_COLUMNS, PM01_PAYMENT_COLUMNS,
  UNVERIFIED_SOURCES, VERIFIED, HR_INVENTORY } from '../app/forms-catalogue.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

// الصلاحيات موزّعة على أشخاص مختلفين عمدًا: من يعدّ لا يقبل، ومن يعبّئ لا يعتمد.
const GRANTS=[
  ['manager','forms.accept'],            // مالك النماذج: يقبل التعريفات المزروعة
  ['outsider','commercial.use'],         // معدّ نماذج تطوير الأعمال والوسائط
  ['hr','commercial.use'],               // مدير تطوير الأعمال / مدير الحملات الذي يعتمد
  ['it','finance.use'],                  // المالية
  ['it','clients.manage']                // مدير الحسابات
];
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-forms');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  for(const [user,capability] of GRANTS)tx(()=>grantAccess(db,users.admin,{user_id:user,capability,note:'تصريح تجريبي لاختبار النماذج الإلكترونية'}));
  tx(()=>installCatalogue(db,'36t'));
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع تجريبي للنماذج',brief:'مشروع اختبار النماذج الإلكترونية',member_ids:['employee','outsider']}));
  return {db,users,tx,project};
}
const accept=(db,users,tx,key)=>tx(()=>acceptDefinition(db,users.manager,key,
  {version:definitionOf(db,users.manager,key).row_version,effective_from:today(),note:'أقبل هذا التعريف مسؤولية مني كمالك للنموذج'}));
const definitionOf=(db,u,key)=>formsBoard(db,u).definitions.find(d=>d.form_key===key);
const instanceOf=(db,u,id)=>getInstance(db,u,id);

const QUALIFY={company:'شركة تجريبية',sector:'تجزئة',contact_name:'جهة تواصل',contact_title:'مدير تسويق',
  contact_email:'contact@example.test',contact_phone:'0500000000',reached_us:'ترشيح من عميل سابق',
  bant_budget:'محدد',bant_authority:'نعم',bant_need:'واضحة',bant_timing:'فوري',
  services:'هوية بصرية وحملة إطلاق',expected_value:'250000',above_minimum:'الحد الأدنى غير محدد',
  duration:'ثلاثة أشهر',capacity:'الفريق متاح',experience:'سبق العمل في القطاع نفسه',
  decision:'مؤهل',priority:'عالية',justification:'ميزانية محددة وحاجة واضحة وتوقيت فوري',next_step:'إعداد التسعير'};
const MEDIAPLAN={campaign_name:'حملة الإطلاق',duration:'أربعة أسابيع',
  platforms_used:['Meta (Facebook & Instagram)','Google Ads (Search)','YouTube Ads'],
  platform_rows:'Meta: إعلان فيديو، 1000 يوميًا، 28 يومًا، 28000، 60%، وعي، الوصول، الجمهور العام',total_budget:'28000'};
const AD_REQUEST=collected=>({requested_on:today(),client:'عميل تجريبي',project_manager:'مدير المشروع',
  campaign_name:'حملة الإطلاق',duration:'أربعة أسابيع',objective:'رفع الوعي بالعلامة',
  age_group:'25–34',interests:'تقنية وتسوق',location:'الرياض',geography:'المملكة',key_message:'رسالة الإطلاق',
  kpis:'الوصول 500000 على Meta، النقرات 20000',platforms_used:['Meta (Facebook & Instagram)','TikTok Ads'],
  platform_details:'Meta: 20000 ريال، فيديو. TikTok: 8000 ريال، فيديو قصير.',
  budget_collected:collected,...(collected==='نعم'?{receipt_number:'REC-1'}:{})});
// نسخة التعريف كما تعيدها اللوحة، لإعداد نسخة جديدة منه: تحمل التبعيات والتصنيف كما تحملهما المواصفة المزروعة.
const specOf=definition=>({sections:definition.sections,author:definition.author,chain:definition.chain,
  attachments:definition.attachments,subject_kinds:definition.subject_kinds,warnings:definition.warnings,
  gates:definition.gates,mandate:definition.mandate,cycle:definition.cycle,classification:definition.classification,
  depends_on:definition.requires.map(r=>({form_key:r.form_key,source:r.source}))});

test('the seeded catalogue is faithful to the verified Drive originals: every definition validates, cites the verified file, and starts a draft nobody has accepted',t=>{
  const {db,users}=fixture(t);
  const board=formsBoard(db,users.manager);
  assert.equal(board.definitions.length,FORM_CATALOGUE.length);
  assert.equal(board.counts.drafts,FORM_CATALOGUE.length,'كل نموذج مزروع يبدأ مسودة');
  assert.equal(board.counts.accepted,0);
  for(const definition of board.definitions){
    // لكل نموذج سندُه هو، لا سندٌ واحد للكتالوج كله: نماذج دورة المشروع سندها سجل القراءة المباشرة
    // من درايف، ونماذج الموارد البشرية سندها جردُ مجلدها — لأن سجل القراءة يحصر نفسه في مجلدَي دورة
    // العمل ولا يذكر الموارد البشرية بحرف، فالإحالة إليه كانت إحالةً إلى وثيقة لا تذكر النموذج.
    assert.ok([VERIFIED,HR_INVENTORY].includes(definition.source_file),`${definition.form_key} سنده أحد سجلَّي المصادر`);
    assert.ok(definition.source_note.startsWith(definition.source_file),`${definition.form_key} يذكر ملف سنده هو`);
    assert.ok(!definition.source_note.includes('SOURCE-APPENDIX.md'),`${definition.form_key} لا يقدّم الملحق المتجاوَز مصدرًا`);
    // بند المصدر رقمٌ في فهرس دورة المشروع؛ ونموذج الموارد البشرية خارج ذلك الفهرس فلا بند له.
    assert.ok(definition.step_no===null||(definition.step_no>=1&&definition.step_no<=24),`${definition.form_key} بنده من الفهرس أو لا بند له`);
    assert.ok(definition.mandate,`${definition.form_key} يحمل إلزام المصدر`);
    // عمود «التصنيف» في فهرس الشركة لم يكن منقولًا إطلاقًا، وصار على كل نموذج.
    assert.ok(definition.classification,`${definition.form_key} يحمل تصنيف الفهرس`);
    assert.doesNotThrow(()=>validateSpec(specOf(definition)),`${definition.form_key} تعريف صالح`);
    // لا سطر توقيع: التقديم إقرار المعدّ، وكل خطوة اعتماد تحمل تصريح من يقررها.
    assert.ok(definition.author.capability&&definition.chain.every(s=>s.capability));
  }
  // البنود الثمانية في محضر الاستلام بنصها من المصدر، وبند الدفعة المقدمة منها.
  const receipt=board.definitions.find(d=>d.form_key==='FORM-PM-RECEIPT');
  const documents=fieldsOf({sections:receipt.sections}).find(f=>f.key==='documents_received');
  assert.deepEqual(documents.options,RECEIPT_DOCUMENTS);
  assert.equal(documents.options.length,8);
  assert.ok(RECEIPT_DOCUMENTS.includes(ADVANCE_DOCUMENT));
  // عمودا الأصل «موجودة؟» و«ملاحظات»: حقل الملاحظات لم يعد مقترحًا، فله عمود في المصدر.
  assert.ok(documents.label.includes('موجودة؟'));
  const receiptNotes=fieldsOf({sections:receipt.sections}).find(f=>f.key==='missing_note');
  assert.equal(receiptNotes.inferred,false,'عمود «ملاحظات» موجود في الأصل، فلا يُعرض مقترحًا');
});

test('BD-01 carries the seven BANT columns of the original, not the four the appendix transcribed, and the platform records the assessment and score without computing either',t=>{
  const {db,users}=fixture(t);
  const qualify=formsBoard(db,users.manager).definitions.find(d=>d.form_key==='FORM-BD-QUALIFY');
  const fields=fieldsOf({sections:qualify.sections});
  assert.equal(BANT_COLUMNS.length,7);
  // أوزان المصدر وخياراته كما هي، ومعها الأعمدة الثلاثة التي أسقطها الملحق: التقييم والدرجة والملاحظات.
  const weights=fields.filter(f=>f.weight!==undefined);
  assert.deepEqual(weights.map(w=>w.weight),BANT.map(b=>b.weight));
  assert.deepEqual(weights.map(w=>w.options),BANT.map(b=>b.options));
  for(const criterion of BANT){
    const keys=bantFieldKeys(criterion.key);
    for(const key of [keys.answer,keys.assessment,keys.score,keys.notes])
      assert.ok(fields.some(f=>f.key===key),`عمود ${key} من جدول BANT السباعي موجود`);
    assert.equal(fields.find(f=>f.key===keys.score).type,'number');
    // الأعمدة المستعادة غير إلزامية: المصدر لا يضع لها مقياسًا.
    assert.equal(fields.find(f=>f.key===keys.assessment).required,false);
    assert.equal(fields.find(f=>f.key===keys.score).undefined_in_source,'سلّم الدرجات وحد النجاح');
  }
  assert.equal(fields.filter(f=>f.section==='bant').length,BANT.length*4);
  // خيارات الأولوية الثلاثة وردت في الأصل ولم ينقلها الملحق.
  assert.deepEqual(fields.find(f=>f.key==='priority').options,['عالية','متوسطة','منخفضة']);
  assert.equal(fields.find(f=>f.key==='priority').type,'select');
  // ترقيم النموذج MOD-BD-01-____ حقل في الأصل.
  assert.ok(fields.some(f=>f.key==='form_serial'));
  // تُسجَّل الدرجة ولا تُحسب: لا مجموع، ولا حكم تأهيل، حتى يضع المالك سلّمًا وحد نجاح.
  const summary=bantSummary({sections:qualify.sections},
    {bant_budget:'محدد',bant_budget_assessment:'ميزانية معتمدة من مجلس الإدارة',bant_budget_score:'20',
      bant_budget_notes:'تأكيد كتابي',bant_authority:'نعم',bant_need:'واضحة',bant_timing:'فوري'});
  assert.equal(summary.score,null,'المصدر لا يحدد درجات الخيارات ولا حد النجاح، فلا تحسب المنصة درجة');
  assert.equal(summary.computed,false);
  assert.deepEqual(summary.columns,BANT_COLUMNS);
  assert.equal(summary.scored,1,'درجة واحدة سُجّلت كما كتبها المقيّم');
  assert.equal(summary.parts[0].assessment,'ميزانية معتمدة من مجلس الإدارة');
  assert.equal(summary.parts[0].score,'20');
  assert.equal(summary.parts[0].notes,'تأكيد كتابي');
  assert.ok(summary.rule.includes('غير محددة في المصدر')&&summary.rule.includes('لا تجمعها'));
  // والنموذج يُقدَّم دون تقييم أو درجة: عمودان بلا مقياس في المصدر لا يُفرضان.
  const definition=currentDefinition(db,'36t','FORM-BD-QUALIFY');
  assert.doesNotThrow(()=>validateForm(definition.spec,QUALIFY,{full:true}));
});

test('definition versioning and the two-person accept: whoever prepares a definition never accepts it, and an accepted definition is replaced by a new version, never edited',t=>{
  const {db,users,tx}=fixture(t);
  const draft=definitionOf(db,users.manager,'FORM-BD-QUALIFY');
  assert.equal(draft.status,'draft');
  assert.throws(()=>tx(()=>acceptDefinition(db,users.hr,'FORM-BD-QUALIFY',{version:draft.row_version,effective_from:today(),note:'أقبل بلا تصريح قبول'})),code('not_permitted'));
  accept(db,users,tx,'FORM-BD-QUALIFY');
  const accepted=definitionOf(db,users.manager,'FORM-BD-QUALIFY');
  assert.equal(accepted.status,'accepted');
  assert.equal(accepted.version,1);
  assert.equal(accepted.accepted_by_name,users.manager.name);
  // التعريف المقبول لا يُعدَّل في مكانه، ولو من القاعدة مباشرة.
  assert.throws(()=>db.prepare("UPDATE form_definitions SET spec='{}' WHERE form_key='FORM-BD-QUALIFY'").run(),/never edited/);
  // نسخة جديدة: يعدّها حامل تصريح الإعداد، ولا يقبلها هو.
  const spec=specOf(accepted);
  const drafted=tx(()=>draftDefinition(db,users.manager,{form_key:'FORM-BD-QUALIFY',title_ar:'تأهيل العميل المحتمل',title_en:'Lead Qualification Form (MOD-BD-01)',
    department_code:'BD',department_name:'تطوير الأعمال',step_no:1,sla_days:null,source_note:'مراجعة الملحق مع المالك',spec}));
  assert.equal(drafted.version,2);
  const second=definitionOf(db,users.manager,'FORM-BD-QUALIFY');
  assert.equal(second.status,'draft');
  assert.equal(second.version,2,'الكتالوج يعرض أحدث نسخة ولو كانت مسودة');
  assert.equal(second.accepted_version,1,'والنسخة السارية للتعبئة تبقى المقبولة');
  assert.ok(second.fillable);
  assert.throws(()=>tx(()=>acceptDefinition(db,users.manager,'FORM-BD-QUALIFY',{version:second.row_version,effective_from:today(),note:'أقبل ما أعددته بنفسي'})),code('separation_of_duties'));
  assert.ok(verifyAudit(db));
});

test('alias lookup keeps every source code and never presents one as the identifier: MOD-01 answers with both forms, and VD-03 is flagged as the mislabelled style guide file',t=>{
  const {db,users}=fixture(t);
  const duplicate=aliasLookup(db,'36t','MOD-01');
  assert.equal(duplicate.matches.length,2,'MOD-01 مستعمل للموجز الإبداعي ولموجز المحتوى');
  assert.deepEqual(duplicate.matches.map(m=>m.form_key).sort(),['FORM-CR-BRIEF','FORM-CW-BRIEF']);
  assert.ok(duplicate.ambiguous);
  assert.ok(duplicate.matches.every(m=>m.ambiguous));
  const style=aliasLookup(db,'36t','VD-03');
  assert.deepEqual(style.matches.map(m=>m.form_key),['FORM-CW-STYLE']);
  assert.ok(style.matches[0].ambiguous&&style.matches[0].note.includes('CW-02'));
  // تعارض الأسماء الإنجليزية الثلاثي بين BD-04 وPM-01 وPM-02: كل اسم محفوظ بديلًا موسومًا،
  // والاسم المعروض يحمل رمز مصدره فلا يلتبس نموذج بآخر.
  const handover=aliasLookup(db,'36t','Project Handover Minutes');
  assert.deepEqual(handover.matches.map(m=>m.form_key).sort(),['FORM-BD-HANDOVER','FORM-PM-RECEIPT']);
  assert.ok(handover.ambiguous&&handover.matches.every(m=>m.ambiguous));
  const kickoffMinutes=aliasLookup(db,'36t','Project Kick-off Minutes');
  assert.deepEqual(kickoffMinutes.matches.map(m=>m.form_key),['FORM-BD-HANDOVER'],'اسم رأس ملف BD-04 محفوظ ولو خالف الفهرس');
  assert.ok(kickoffMinutes.matches[0].ambiguous);
  const kickoffMeeting=aliasLookup(db,'36t','Kickoff Meeting');
  assert.deepEqual(kickoffMeeting.matches.map(m=>m.form_key),['FORM-PM-KICKOFF']);
  assert.ok(kickoffMeeting.matches[0].note.includes('لا اسم إنجليزي في رأس ملف MOD-PM-02'));
  // ولا اسم معروض يتكرر بين النماذج الثلاثة والعشرين.
  const displayed=formsBoard(db,users.manager).definitions.map(d=>d.title_en);
  assert.equal(new Set(displayed).size,displayed.length,'كل اسم إنجليزي معروض يخص نموذجًا واحدًا');
  for(const key of ['FORM-BD-HANDOVER','FORM-PM-RECEIPT','FORM-PM-KICKOFF']){
    const shown=formsBoard(db,users.manager).definitions.find(d=>d.form_key===key).title_en;
    assert.match(shown,/\(MOD-(BD-04|PM-01|PM-02)\)$/,'الاسم المعروض يحمل رمز مصدره');
  }
  // الرمز غير المكرر يحسم نموذجًا واحدًا، والاسم العربي والرمز FRM يفعلان الشيء نفسه.
  assert.deepEqual(aliasLookup(db,'36t','PR-02').matches.map(m=>m.form_key),['FORM-PR-INFLUENCERS']);
  assert.deepEqual(aliasLookup(db,'36t','FRM-003').matches.map(m=>m.form_key),['FORM-PM-RECEIPT']);
  assert.deepEqual(aliasLookup(db,'36t','محضر استلام المشروع').matches.map(m=>m.form_key),['FORM-PM-RECEIPT']);
  assert.deepEqual(aliasLookup(db,'36t','لا رمز كهذا').matches,[]);
  // البحث في الكتالوج: بالاسم والرمز والإدارة والبند.
  const search=searchForms(db,users.manager,{q:'',department:'PR',step:''});
  // سبعة: الستة من فهرس الـ41 وسجل أداء المؤثرين MOD-PR-06 (الموجة الأولى، 28 سبتمبر).
  assert.ok(search.definitions.length===7&&search.definitions.every(d=>d.department_code==='PR'));
  assert.equal(searchForms(db,users.manager,{q:'',department:'',step:2}).definitions.length,3);
  assert.ok(searchForms(db,users.manager,{q:'استلام',department:'',step:''}).definitions.some(d=>d.form_key==='FORM-PM-RECEIPT'));
  assert.ok(searchForms(db,users.manager,{q:'MOD-01',department:'',step:''}).alias.ambiguous);
});

test('server-side validation refuses in Arabic, names the missing field and who must supply it, and honours conditional requirements',t=>{
  const {db,users,tx}=fixture(t);
  accept(db,users,tx,'FORM-BD-QUALIFY');
  const definition=currentDefinition(db,'36t','FORM-BD-QUALIFY');
  // الحقل المخفي بشرطه لا يُطلب: «اذكر نوع الإنتاج» في موجز الإنتاج يظهر عند اختيار «أخرى» فقط.
  const production=currentDefinition(db,'36t','FORM-PROD-BRIEF');
  const shown=fieldsOf(production.spec).find(f=>f.key==='production_type_other');
  assert.ok(shown&&shown.show_when.field==='production_type');
  // النقص يُعلن كاملًا بأسماء الحقول وأصحابها.
  const error=(()=>{try{validateForm(definition.spec,{company:'شركة'},{full:true});return null;}catch(e){return e;}})();
  assert.equal(error.code,'missing_field');
  assert.ok(error.message.includes('تطوير الأعمال'),'الرسالة تذكر من يستكمل الحقل');
  assert.ok(error.details.fields.length>10);
  // حقل مخفي بشرطه لا يُحسب ناقصًا: رقم الإيصال في طلب الحملة يظهر عند «نعم» فقط.
  const campaign=currentDefinition(db,'36t','FORM-AD-REQUEST');
  assert.doesNotThrow(()=>validateForm(campaign.spec,AD_REQUEST('لا'),{full:true}));
  const missingReceipt=(()=>{try{validateForm(campaign.spec,{...AD_REQUEST('نعم'),receipt_number:undefined},{full:true});return null;}catch(e){return e;}})();
  assert.equal(missingReceipt,null,'رقم الإيصال اختياري في المصدر حتى عند التحصيل');
  // اختيار خارج القائمة وبند قائمة غير معروف يُرفضان بالعربية.
  assert.throws(()=>validateForm(definition.spec,{...QUALIFY,bant_budget:'ربما'},{full:true}),code('invalid_option'));
  assert.throws(()=>validateForm(campaign.spec,{...AD_REQUEST('لا'),platforms_used:['منصة غير موجودة']},{full:true}),code('invalid_option'));
  // البنود غير المؤشَّرة تُذكر باسمها وباسم من يورّدها، ولا تمنع الحفظ بذاتها.
  const receipt=currentDefinition(db,'36t','FORM-PM-RECEIPT');
  const checked=validateForm(receipt.spec,{documents_received:[RECEIPT_DOCUMENTS[0]]},{full:false});
  assert.equal(checked.pending_documents.length,7);
  assert.ok(checked.pending_documents.every(d=>d.owner==='إدارة الحسابات'));
});

test('the source gates block the electronic approval with the source warning, not the saving of the form',t=>{
  const {db,users,tx,project}=fixture(t);
  accept(db,users,tx,'FORM-AD-REQUEST');
  const definition=currentDefinition(db,'36t','FORM-AD-REQUEST');
  assert.equal(openGates(definition.spec,AD_REQUEST('لا')).length,1);
  assert.equal(openGates(definition.spec,AD_REQUEST('نعم')).length,0);
  // النموذج يسجّل الواقع: ميزانية غير محصلة تُحفظ وتُقدَّم، والبوابة تمنع الاعتماد وحده.
  const created=tx(()=>createInstance(db,users.manager,{form_key:'FORM-AD-REQUEST',title:'طلب حملة الإطلاق',
    subject_kind:'project',subject_id:project.id,payload:AD_REQUEST('لا')}));
  tx(()=>instanceAction(db,users.manager,created.id,'submit',{version:instanceOf(db,users.manager,created.id).row_version}));
  const submitted=instanceOf(db,users.manager,created.id);
  assert.equal(submitted.status,'submitted');
  assert.equal(submitted.open_gates.length,1);
  const blocked=(()=>{try{tx(()=>instanceAction(db,users.hr,created.id,'approve',{version:submitted.row_version,note:''}));return null;}catch(e){return e;}})();
  assert.equal(blocked.code,'source_gate');
  assert.ok(blocked.message.includes('يُمنع منعاً باتاً إطلاق أي حملة إعلانية قبل تحصيل الميزانية كاملة من العميل'),
    'الرسالة نص تنبيه المصدر كما قُرئ، بلا إكمال لذيله المبتور');
  // نسخة جديدة بالتحصيل المؤكد تمر.
  tx(()=>instanceAction(db,users.manager,created.id,'cancel',{version:instanceOf(db,users.manager,created.id).row_version,note:'تُفتح نسخة بعد التحصيل'}));
  const second=tx(()=>createInstance(db,users.manager,{form_key:'FORM-AD-REQUEST',title:'طلب حملة الإطلاق بعد التحصيل',
    subject_kind:'project',subject_id:project.id,payload:AD_REQUEST('نعم')}));
  tx(()=>instanceAction(db,users.manager,second.id,'submit',{version:instanceOf(db,users.manager,second.id).row_version}));
  const ready=instanceOf(db,users.hr,second.id);
  assert.equal(ready.open_gates.length,0);
  tx(()=>instanceAction(db,users.hr,second.id,'approve',{version:ready.row_version,note:'اعتماد مدير الحملات'}));
  assert.equal(instanceOf(db,users.hr,second.id).status,'under_review','ما زالت خطوتا المالية ومدير الحسابات مفتوحتين');
  assert.ok(verifyAudit(db));
});

test('the state machine runs on identity: submission is the author electronic acknowledgement, approvals record who decided on which version, and nobody decides their own form',t=>{
  const {db,users,tx}=fixture(t);
  accept(db,users,tx,'FORM-BD-QUALIFY');
  // المسودة لغير من يملك تصريح دور فيها غير متاحة أصلًا.
  const created=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-BD-QUALIFY',title:'فرصة شركة تجريبية',
    subject_kind:'opportunity',subject_id:'OPP-001',payload:{company:'شركة تجريبية'}}));
  const draft=instanceOf(db,users.outsider,created.id);
  assert.equal(draft.status,'draft');
  assert.equal(draft.submission,null);
  assert.deepEqual(draft.actions.sort(),['cancel','edit','submit']);
  // التقديم قبل الاستكمال يُرفض بالعربية.
  assert.throws(()=>tx(()=>instanceAction(db,users.outsider,created.id,'submit',{version:draft.row_version})),code('missing_field'));
  tx(()=>saveInstance(db,users.outsider,created.id,{version:draft.row_version,title:'فرصة شركة تجريبية',payload:QUALIFY}));
  const ready=instanceOf(db,users.outsider,created.id);
  tx(()=>instanceAction(db,users.outsider,created.id,'submit',{version:ready.row_version}));
  const submitted=instanceOf(db,users.outsider,created.id);
  assert.equal(submitted.status,'submitted');
  assert.ok(submitted.submission.line.includes(users.outsider.name)&&submitted.submission.line.includes('أعدّه أخصائي تطوير الأعمال'));
  assert.equal(submitted.submission.instance_version,1);
  // صاحب النموذج لا يعتمده ولو حمل تصريح الخطوة.
  assert.ok(!submitted.actions.includes('approve'));
  assert.throws(()=>tx(()=>instanceAction(db,users.outsider,created.id,'approve',{version:submitted.row_version,note:''})),code('action_unavailable'));
  // من لا يحمل تصريح الخطوة لا يعتمد.
  assert.throws(()=>tx(()=>instanceAction(db,users.it,created.id,'approve',{version:submitted.row_version,note:''})),code('not_found'));
  tx(()=>instanceAction(db,users.hr,created.id,'claim_review',{version:submitted.row_version}));
  const reviewing=instanceOf(db,users.hr,created.id);
  assert.equal(reviewing.status,'under_review');
  tx(()=>instanceAction(db,users.hr,created.id,'approve',{version:reviewing.row_version,note:'أعتمد التأهيل'}));
  const approved=instanceOf(db,users.hr,created.id);
  assert.equal(approved.status,'approved');
  const [decision]=approved.approvals;
  assert.equal(decision.decided_by_name,users.hr.name);
  assert.equal(decision.capability,'commercial.use');
  assert.equal(decision.definition_version,1);
  assert.equal(decision.instance_version,1);
  assert.ok(decision.from_signature,'هذه الخطوة كانت سطر توقيع في النموذج الأصلي');
  assert.ok(decision.line.startsWith('اعتمد: '+users.hr.name));
  assert.ok(decision.record_reference);
  // الاعتماد لا يُعاد كتابته، ولا يُحذف صف اعتماد.
  assert.throws(()=>db.prepare("UPDATE form_approvals SET decided_by='outsider' WHERE instance_id=?").run(created.id),/never rewritten/);
  assert.throws(()=>db.prepare('DELETE FROM form_approvals WHERE instance_id=?').run(created.id),/retained/);
  assert.throws(()=>db.prepare('DELETE FROM form_instances WHERE id=?').run(created.id),/retained/);
  assert.ok(verifyAudit(db));
});

test('editing an approved form opens a new version: the old version and its approvals stay readable, and only the approvals the change touches are reopened',t=>{
  const {db,users,tx,project}=fixture(t);
  accept(db,users,tx,'FORM-AD-MEDIAPLAN');
  const created=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-AD-MEDIAPLAN',title:'الخطة الإعلامية للإطلاق',
    subject_kind:'project',subject_id:project.id,payload:MEDIAPLAN}));
  const decide=(user,id)=>tx(()=>instanceAction(db,user,id,'approve',{version:instanceOf(db,user,id).row_version,note:'اعتماد'}));
  tx(()=>instanceAction(db,users.outsider,created.id,'submit',{version:instanceOf(db,users.outsider,created.id).row_version}));
  assert.deepEqual(instanceOf(db,users.outsider,created.id).approvals.map(a=>a.status),['pending','pending','pending']);
  decide(users.hr,created.id);      // مدير الحملات (commercial.use)
  decide(users.manager,created.id); // مدير المشروع (projects.use)
  decide(users.it,created.id);      // المالية (finance.use)
  const first=instanceOf(db,users.outsider,created.id);
  assert.equal(first.status,'approved');
  assert.deepEqual(first.approvals.map(a=>a.decided_by_name),[users.hr.name,users.manager.name,users.it.name]);
  // التعديل لا يمس النسخة المعتمدة: يفتح نسخة جديدة وتصير القديمة «محل نسخة أحدث».
  const revised=tx(()=>instanceAction(db,users.outsider,created.id,'revise',{version:first.row_version,note:'تصحيح اسم الحملة في الترويسة'}));
  const old=instanceOf(db,users.outsider,created.id);
  assert.equal(old.status,'superseded');
  assert.equal(old.superseded_by,revised.id);
  assert.deepEqual(old.approvals.map(a=>a.status),['approved','approved','approved'],'اعتمادات النسخة القديمة تبقى كما هي');
  assert.deepEqual(old.payload,MEDIAPLAN,'محتوى النسخة القديمة لم يمسّه التعديل');
  // التعديل يمسّ قسم «meta» وحده: خطوة المالية تغطي «plan» فقط فتُحمل، والخطوتان الأخريان تُفتحان.
  const changed={...MEDIAPLAN,campaign_name:'حملة الإطلاق — النسخة الثانية'};
  const definition=currentDefinition(db,'36t','FORM-AD-MEDIAPLAN');
  assert.deepEqual([...changedSections(definition.spec,MEDIAPLAN,changed)],['meta']);
  tx(()=>saveInstance(db,users.outsider,revised.id,{version:instanceOf(db,users.outsider,revised.id).row_version,
    title:'الخطة الإعلامية للإطلاق',payload:changed}));
  tx(()=>instanceAction(db,users.outsider,revised.id,'submit',{version:instanceOf(db,users.outsider,revised.id).row_version}));
  const second=instanceOf(db,users.outsider,revised.id);
  assert.deepEqual(second.approvals.map(a=>a.status),['pending','pending','approved']);
  const carried=second.approvals[2];
  assert.ok(carried.carried,'اعتماد المالية محمول لأن التعديل لم يمسّ قسمه');
  assert.equal(carried.decided_by_name,users.it.name);
  assert.equal(carried.instance_version,1,'الاعتماد المحمول يقول أي نسخة اعتمدها فعلًا');
  assert.equal(second.instance_version,2);
  assert.equal(second.status,'submitted');
  assert.equal(second.versions.length,2);
  // النسخة الجديدة تكتمل باعتماد الخطوتين المفتوحتين وحدهما.
  decide(users.hr,revised.id);decide(users.manager,revised.id);
  assert.equal(instanceOf(db,users.outsider,revised.id).status,'approved');
  assert.ok(verifyAudit(db));
});

test('a revision that touches nothing an approval covers needs no new decision at all',t=>{
  const {db,users,tx,project}=fixture(t);
  accept(db,users,tx,'FORM-AD-MEDIAPLAN');
  const created=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-AD-MEDIAPLAN',title:'خطة إعلامية',
    subject_kind:'project',subject_id:project.id,payload:MEDIAPLAN}));
  tx(()=>instanceAction(db,users.outsider,created.id,'submit',{version:instanceOf(db,users.outsider,created.id).row_version}));
  for(const user of [users.hr,users.manager,users.it])
    tx(()=>instanceAction(db,user,created.id,'approve',{version:instanceOf(db,user,created.id).row_version,note:'اعتماد'}));
  const revised=tx(()=>instanceAction(db,users.outsider,created.id,'revise',
    {version:instanceOf(db,users.outsider,created.id).row_version,note:'إعادة تقديم بلا تغيير في المحتوى'}));
  tx(()=>instanceAction(db,users.outsider,revised.id,'submit',{version:instanceOf(db,users.outsider,revised.id).row_version}));
  const second=instanceOf(db,users.outsider,revised.id);
  assert.equal(second.status,'approved','لم يتغير شيء، فكل الاعتمادات محمولة ولا خطوة تُفتح');
  assert.ok(second.approvals.every(a=>a.carried));
  assert.deepEqual(second.approvals.map(a=>a.instance_version),[1,1,1]);
});

test('a returned form is not edited in place: the returned version keeps its decision, and the correction is a new version',t=>{
  const {db,users,tx}=fixture(t);
  accept(db,users,tx,'FORM-BD-QUALIFY');
  const created=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-BD-QUALIFY',title:'فرصة',
    subject_kind:'opportunity',subject_id:'OPP-002',payload:QUALIFY}));
  tx(()=>instanceAction(db,users.outsider,created.id,'submit',{version:instanceOf(db,users.outsider,created.id).row_version}));
  tx(()=>instanceAction(db,users.hr,created.id,'mark_incomplete',{version:instanceOf(db,users.hr,created.id).row_version,
    note:'سند الدرجات ناقص؛ يورّده أخصائي تطوير الأعمال'}));
  const incomplete=instanceOf(db,users.outsider,created.id);
  assert.equal(incomplete.status,'incomplete');
  assert.ok(!incomplete.actions.includes('edit'),'النسخة المقدَّمة لا تُعدَّل في مكانها');
  assert.ok(incomplete.actions.includes('revise'));
  const revised=tx(()=>instanceAction(db,users.outsider,created.id,'revise',{version:incomplete.row_version,note:'استكمال سند الدرجات'}));
  tx(()=>saveInstance(db,users.outsider,revised.id,{version:instanceOf(db,users.outsider,revised.id).row_version,
    title:'فرصة',payload:{...QUALIFY,justification:'سند مفصّل للدرجات الأربع'}}));
  tx(()=>instanceAction(db,users.outsider,revised.id,'submit',{version:instanceOf(db,users.outsider,revised.id).row_version}));
  tx(()=>instanceAction(db,users.hr,revised.id,'reject',{version:instanceOf(db,users.hr,revised.id).row_version,note:'الفرصة خارج قطاعنا'}));
  const rejected=instanceOf(db,users.outsider,revised.id);
  assert.equal(rejected.status,'rejected');
  assert.equal(rejected.approvals[0].status,'rejected');
  assert.equal(rejected.approvals[0].decided_by_name,users.hr.name);
  assert.equal(instanceOf(db,users.outsider,created.id).status,'superseded');
});

test('privacy: only the person who filled the form, its project members and the holders of its own roles can read it',t=>{
  const {db,users,tx,project}=fixture(t);
  accept(db,users,tx,'FORM-BD-QUALIFY');
  accept(db,users,tx,'FORM-AD-MEDIAPLAN');
  const opportunity=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-BD-QUALIFY',title:'فرصة سرية',
    subject_kind:'opportunity',subject_id:'OPP-003',payload:QUALIFY}));
  // صاحبها يراها، وحامل تصريح خطوتها يراها.
  assert.ok(getInstance(db,users.outsider,opportunity.id));
  assert.ok(getInstance(db,users.hr,opportunity.id));
  // موظف بلا تصريح دور فيها ولا عضوية مشروع لا يعرف أنها موجودة.
  assert.throws(()=>getInstance(db,users.employee,opportunity.id),code('not_found'));
  assert.throws(()=>getInstance(db,users.it,opportunity.id),code('not_found'));
  assert.equal(formsBoard(db,users.employee).instances.length,0);
  assert.equal(formsBoard(db,users.hr).instances.length,1);
  // كيان آخر لا يرى شيئًا مهما كان المعرّف.
  assert.throws(()=>getInstance(db,users.external,opportunity.id),code('not_found'));
  // نموذج معلّق على مشروع: أعضاؤه يقرؤونه ولو لم يحملوا تصريح خطوة فيه.
  const onProject=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-AD-MEDIAPLAN',title:'خطة المشروع',
    subject_kind:'project',subject_id:project.id,payload:MEDIAPLAN}));
  assert.ok(getInstance(db,users.employee,onProject.id),'عضو المشروع يقرأ نماذجه');
  // ولا يُعلَّق نموذج على مشروع لست فيه.
  assert.throws(()=>tx(()=>createInstance(db,users.hr,{form_key:'FORM-AD-MEDIAPLAN',title:'خطة',
    subject_kind:'project',subject_id:project.id,payload:MEDIAPLAN})),code('project_scope'));
});

test('the electronic record is a link, not a printout: it carries the versions, the approval identities and an archive export, and nothing renders a signature line',t=>{
  const {db,users,tx,project}=fixture(t);
  accept(db,users,tx,'FORM-AD-MEDIAPLAN');
  const created=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-AD-MEDIAPLAN',title:'الخطة الإعلامية',
    subject_kind:'project',subject_id:project.id,payload:MEDIAPLAN}));
  tx(()=>instanceAction(db,users.outsider,created.id,'submit',{version:instanceOf(db,users.outsider,created.id).row_version}));
  tx(()=>instanceAction(db,users.hr,created.id,'approve',{version:instanceOf(db,users.hr,created.id).row_version,note:'اعتماد مدير الحملات'}));
  const record=instanceRecord(db,users.outsider,created.id);
  assert.equal(record.record_link,`#forms/${created.id}`);
  assert.ok(record.sections.length&&record.versions.length===1);
  assert.ok(record.approvals[0].line.startsWith('اعتمد: '+users.hr.name));
  assert.equal(record.approvals[0].note,'اعتماد مدير الحملات');
  assert.ok(record.submission.line.includes(users.outsider.name));
  assert.ok(record.aliases.some(a=>a.alias==='AD-02'));
  const exported=instanceExport(db,users.outsider,created.id);
  assert.equal(exported.filename,'FORM-AD-MEDIAPLAN-v1.json');
  const parsed=JSON.parse(exported.content);
  assert.equal(parsed.payload.campaign_name,MEDIAPLAN.campaign_name);
  assert.equal(parsed.approvals[0].decided_by_name,users.hr.name);
  assert.ok(parsed.note.includes('لا توقيع مصور ولا نسخة مطبوعة'));
  // لا شيء في المحرك يصدر ورقة أو سطر توقيع.
  const engine=Object.keys(record);
  assert.ok(!engine.some(key=>/print|signature/i.test(key)),'السجل لا يحمل مفاتيح طباعة أو توقيع');
});

test('PR-01 carries the two sections the appendix dropped entirely: the six PR deliverables and the four influencer tiers',t=>{
  const {db,users}=fixture(t);
  const campaign=formsBoard(db,users.manager).definitions.find(d=>d.form_key==='FORM-PR-CAMPAIGN');
  const sections=Object.fromEntries(campaign.sections.map(s=>[s.key,s]));
  assert.ok(sections.pr_outputs,'قسم «المخرجات من العلاقات العامة» موجود');
  assert.equal(sections.pr_outputs.title,'المخرجات من العلاقات العامة');
  assert.equal(PR_DELIVERABLES.length,6);
  for(const item of PR_DELIVERABLES)
    assert.ok(sections.pr_outputs.fields.some(f=>f.key===item.key&&f.label.startsWith(item.label)),`المهمة «${item.label}» موجودة`);
  assert.ok(PR_DELIVERABLES.some(x=>x.label==='دليل أزمات')&&PR_DELIVERABLES.some(x=>x.label==='تقرير الرصد الإعلامي'));
  assert.ok(sections.influencer_tiers,'قسم «متطلبات / مقترحات المؤثرين» موجود');
  assert.deepEqual(INFLUENCER_TIERS.map(x=>x.label),['Mega (1M+)','Macro (100K-1M)','Micro (10K-100K)','Nano (1K-10K)']);
  for(const tier of INFLUENCER_TIERS){
    assert.ok(sections.influencer_tiers.fields.some(f=>f.key===`${tier.key}_platforms`),`منصات ${tier.label}`);
    assert.ok(sections.influencer_tiers.fields.some(f=>f.key===`${tier.key}_count`),`عدد ${tier.label}`);
  }
  // خطوة الاعتماد تغطي القسمين الجديدين كذلك، فلا يمر قسم بلا اعتماد.
  assert.ok(campaign.chain[0].covers.includes('pr_outputs')&&campaign.chain[0].covers.includes('influencer_tiers'));
  assert.ok(campaign.warnings.some(w=>w.includes('قسمان كاملان')));
});

test('PR-01 ships the three template answers as the original template fills them — yes / yes / no — marked as template defaults the filler may change, not as open questions',t=>{
  const {db,users,tx,project}=fixture(t);
  const campaign=formsBoard(db,users.manager).definitions.find(d=>d.form_key==='FORM-PR-CAMPAIGN');
  const defaults=Object.fromEntries(campaign.template_defaults.map(x=>[x.key,x.value]));
  assert.equal(defaults.brand_mention,'نعم');
  assert.equal(defaults.discount_code,'نعم');
  assert.equal(defaults.reuse_rights,'لا','القالب الأصلي يصل بـ«لا» لحقوق إعادة الاستخدام');
  assert.ok(campaign.template_defaults.every(x=>x.note.includes('افتراضي يغيّره من يعبّئ النموذج')));
  // الافتراضي افتراضي لا قيد: من يعبّئ النموذج يخالفه ويُقبل منه.
  accept(db,users,tx,'FORM-PR-CAMPAIGN');
  const definition=currentDefinition(db,'36t','FORM-PR-CAMPAIGN');
  const payload={project_manager:'مدير المشروع',project_number:'PRJ-1',duration:'شهر',client:'عميل',campaign_name:'إطلاق',
    total_budget:'150000',objective:'إطلاق المنتج',audience:'الشباب',key_message:'رسالة',media_fields:'صحف',
    influencer_fields:'تقنية',media_requirements:'الصحف: منصتان، عدد 3',
    posts_count:'4',stories_count:'6',videos_count:'2',brand_mention:'نعم',discount_code:'نعم',reuse_rights:'نعم'};
  assert.doesNotThrow(()=>validateForm(definition.spec,payload,{full:true}));
  const created=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-PR-CAMPAIGN',title:'حملة مؤثرين',
    subject_kind:'project',subject_id:project.id,payload:{...payload,reuse_rights:'نعم'}}));
  assert.equal(getInstance(db,users.outsider,created.id).payload.reuse_rights,'نعم','ما يكتبه المعبّئ يعلو على افتراضي القالب');
});

test('PM-01 and BD-04 carry two different payment tables, as the originals do, not one table copied over both',t=>{
  const {db,users}=fixture(t);
  const board=formsBoard(db,users.manager);
  const column=key=>fieldsOf({sections:board.definitions.find(d=>d.form_key===key).sections})
    .find(f=>f.key==='payment_schedule');
  const handover=column('FORM-BD-HANDOVER'),receipt=column('FORM-PM-RECEIPT');
  assert.equal(handover.label,BD04_PAYMENT_COLUMNS.join('، '));
  assert.equal(receipt.label,PM01_PAYMENT_COLUMNS.join('، '));
  assert.notEqual(handover.label,receipt.label,'الجدولان مختلفان في المصدر فلا يتطابق تعريفهما');
  // الفرق الحقيقي: تسمية العمود الأول، وترتيب شرط الاستحقاق قبل تاريخه في PM-01 وبعده في BD-04.
  assert.equal(BD04_PAYMENT_COLUMNS[0],'المرحلة / الدفعة');
  assert.equal(PM01_PAYMENT_COLUMNS[0],'الدفعة');
  assert.ok(BD04_PAYMENT_COLUMNS.indexOf('تاريخ الاستحقاق')<BD04_PAYMENT_COLUMNS.indexOf('شرط الاستحقاق'));
  assert.ok(PM01_PAYMENT_COLUMNS.indexOf('شرط الاستحقاق')<PM01_PAYMENT_COLUMNS.indexOf('تاريخ الاستحقاق المتوقع'));
  // أربعة صفوف ثابتة في كل قالب، مذكورة لمن يعبّئ.
  assert.ok(handover.help.includes('4 صفوف ثابتة')&&receipt.help.includes('4 صفوف ثابتة'));
});

test('the PM-01 execution gate waits on the advance payment alone: the minutes-signature condition the appendix added is gone, and the migration 109 clash is declared',t=>{
  const {db,users,tx,project}=fixture(t);
  const receipt=formsBoard(db,users.manager).definitions.find(d=>d.form_key==='FORM-PM-RECEIPT');
  assert.equal(receipt.gates.length,1);
  assert.ok(receipt.gates[0].message.includes('لا يُبدأ في أي عمل تنفيذي قبل التحقق من استلام الدفعة المقدمة'));
  assert.ok(!receipt.gates[0].message.includes('وتوقيع المحضر'),'شرط التوقيع ليس في المصدر فلا تفرضه البوابة');
  assert.ok(receipt.warnings[0].includes('لا سند له في الأصل، وقد حُذف'),'ويُقال للقارئ صراحةً أنه حُذف ولماذا');
  // القارئ يُخبَر صراحة أن ترحيل 109 يطبّق النسخة الثلاثية وأنها تحتاج مصالحة.
  assert.ok(receipt.warnings.some(w=>w.includes('ترحيل 109')&&w.includes('مصالحة')));
  // والبوابة تعمل بشرطها الواحد: بند الدفعة المقدمة غير مؤشَّر يمنع الاعتماد، وتأشيره يفتحه.
  accept(db,users,tx,'FORM-PM-RECEIPT');
  const definition=currentDefinition(db,'36t','FORM-PM-RECEIPT');
  const base={received_on:today(),project_name:'مشروع',client:'عميل',contract_value:'500000',
    handed_by:'مدير تطوير الأعمال',received_by:'مدير المشروع',services:'خدمات',deliverables:'مخرجات',
    timeline:'ثلاثة أشهر',rounds_per_deliverable:'جولتان لكل مخرج',channels:'البريد',
    payment_schedule:'الدفعة الأولى، 150000، عند التوقيع، 2026-10-01، مستحقة، —'};
  assert.equal(openGates(definition.spec,{...base,documents_received:[RECEIPT_DOCUMENTS[0]]}).length,1);
  assert.equal(openGates(definition.spec,{...base,documents_received:[ADVANCE_DOCUMENT]}).length,0,
    'التحقق من الدفعة المقدمة وحده يفتح البوابة');
  assert.ok(project.id);
});

test('AD-01 keeps its six platforms and AD-02 carries its eight: Google split into Search and Display, and YouTube Ads restored',t=>{
  const {db,users}=fixture(t);
  const board=formsBoard(db,users.manager);
  const options=key=>fieldsOf({sections:board.definitions.find(d=>d.form_key===key).sections})
    .find(f=>f.key==='platforms_used').options;
  assert.equal(AD01_PLATFORMS.length,6);
  assert.equal(AD02_PLATFORMS.length,8);
  assert.deepEqual(options('FORM-AD-REQUEST'),AD01_PLATFORMS);
  assert.deepEqual(options('FORM-AD-MEDIAPLAN'),AD02_PLATFORMS);
  for(const platform of ['Google Ads (Search)','Google Ads (Display)','YouTube Ads'])
    assert.ok(AD02_PLATFORMS.includes(platform)&&!AD01_PLATFORMS.includes(platform),`${platform} في الخطة الإعلامية وحدها`);
  assert.ok(AD01_PLATFORMS.includes('Google Ads'),'طلب الحملة يدمج Google في بند واحد كما في أصله');
  // والخطة الإعلامية ترفض منصة خارج قائمتها الثمانية.
  const plan=currentDefinition(db,'36t','FORM-AD-MEDIAPLAN');
  assert.throws(()=>validateForm(plan.spec,{...MEDIAPLAN,platforms_used:['Google Ads']},{full:true}),code('invalid_option'));
});

test('the form dependency graph from the index attachments column is modelled: each form declares what it requires, and a filled form warns when a prerequisite is missing on the same subject',t=>{
  const {db,users,tx,project}=fixture(t);
  const board=formsBoard(db,users.manager);
  const graph=dependencyGraph();
  assert.equal(graph.length,11,'أحد عشر نموذجًا لها مرفقات في عمود «المرفقات / الارتباطات»');
  assert.ok(graph.every(g=>g.sources.every(s=>s.includes('المرفقات / الارتباطات'))),'كل تبعية تحمل سطر مصدرها');
  const requires=key=>board.definitions.find(d=>d.form_key===key).requires.map(r=>r.form_key);
  assert.deepEqual(requires('FORM-AD-SETUP'),['FORM-AD-REQUEST','FORM-AD-MEDIAPLAN']);
  assert.deepEqual(requires('FORM-AD-MEDIAPLAN'),['FORM-AD-REQUEST']);
  assert.deepEqual(requires('FORM-DS-QA'),['FORM-DS-BRIEF']);
  assert.deepEqual(requires('FORM-DS-REVISIONS'),['FORM-DS-BRIEF']);
  assert.deepEqual(requires('FORM-CR-CONCEPT'),['FORM-CR-BRIEF']);
  assert.deepEqual(requires('FORM-PROD-SCRIPT'),['FORM-PROD-BRIEF']);
  assert.deepEqual(requires('FORM-PR-BRIEFING'),['FORM-PR-CAMPAIGN','FORM-PR-INFLUENCERS']);
  assert.deepEqual(requires('FORM-PR-BUDGET'),['FORM-PR-CAMPAIGN','FORM-PR-INFLUENCERS']);
  assert.deepEqual(requires('FORM-CW-STYLE'),['FORM-CW-BRIEF']);
  assert.deepEqual(requires('FORM-BD-QUALIFY'),[],'ما لا مرفق له في الفهرس لا يتطلب شيئًا');
  assert.ok(board.definitions.find(d=>d.form_key==='FORM-AD-MEDIAPLAN').requires[0].title.includes('طلب الحملة'));
  // التبعية تُقال ولا تمنع: الخطة الإعلامية تُعبَّأ ويُنبَّه أن طلب الحملة لم يُعبَّأ على المشروع نفسه.
  accept(db,users,tx,'FORM-AD-MEDIAPLAN');accept(db,users,tx,'FORM-AD-REQUEST');
  const plan=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-AD-MEDIAPLAN',title:'الخطة الإعلامية',
    subject_kind:'project',subject_id:project.id,payload:MEDIAPLAN}));
  const before=getInstance(db,users.outsider,plan.id);
  assert.deepEqual(before.missing_prerequisites.map(x=>x.form_key),['FORM-AD-REQUEST']);
  assert.ok(before.missing_prerequisites[0].source.includes('مرفق: طلب الحملة'));
  assert.deepEqual(before.requires.map(x=>x.form_key),['FORM-AD-REQUEST']);
  tx(()=>instanceAction(db,users.outsider,plan.id,'submit',{version:before.row_version}));
  assert.equal(getInstance(db,users.outsider,plan.id).status,'submitted','التنبيه لا يمنع التقديم');
  // فإذا عُبِّئ طلب الحملة على المشروع نفسه، سكت التنبيه.
  tx(()=>createInstance(db,users.outsider,{form_key:'FORM-AD-REQUEST',title:'طلب الحملة',
    subject_kind:'project',subject_id:project.id,payload:AD_REQUEST('نعم')}));
  assert.deepEqual(getInstance(db,users.outsider,plan.id).missing_prerequisites,[]);
});

test('what no readable file supports is declared unverified rather than presented as sourced: the two unreadable Drive files and everything resting on them',t=>{
  const {db,users}=fixture(t);
  const board=formsBoard(db,users.manager);
  // أربعة ملفات لا تُقرأ الآن: اثنان من دورة العمل، واثنان من نماذج الموارد البشرية (أحدهما منعه
  // مصنِّف حماية البيانات). كلها معلنة غير متحقَّقة ولا يُبنى عليها شيء — وهو الفرق بين النقص المعلَن والادّعاء.
  assert.equal(board.unverified_sources.length,4);
  assert.deepEqual(board.unverified_sources.map(s=>s.file),
    ['Workflow .key','طلب عرض السعر RFQ — نسخة 14 سبتمبر 2026','مخالفة عمل.docx','خطاب الإنذار والخصم.pdf']);
  assert.equal(board.unverified_note,'غير مُتحقَّق — الملف غير مقروء');
  for(const source of board.unverified_sources){
    assert.ok(source.reason.length>20&&source.rests_on.length,'يُذكر سبب تعذّر القراءة وما يستند إليه');
    assert.ok(source.catalogue_impact.includes('لا'),'ويُذكر أن الكتالوج لا يبني عليه');
  }
  assert.deepEqual(UNVERIFIED_SOURCES,board.unverified_sources);
  assert.ok(board.unverified_sources[0].rests_on.some(x=>x.includes('المخططات الثلاثة')));
  assert.ok(board.unverified_sources[1].rests_on.some(x=>x.includes('One-Year Subscription for EPMO Members')));
  // وما مستنده ذيل نص مبتور موسوم كذلك على النموذج نفسه، خطوةً كان أو حقلًا.
  const unverified=key=>board.definitions.find(d=>d.form_key===key).unverified_items;
  assert.ok(unverified('FORM-AD-MEDIAPLAN').some(x=>x.kind==='step'&&x.key==='finance'&&x.reason.includes('مبتور')));
  assert.ok(unverified('FORM-PROD-BRIEF').some(x=>x.kind==='step'&&x.key==='finance'));
  assert.ok(unverified('FORM-PR-BRIEFING').some(x=>x.kind==='field'&&x.key==='assets_folder'));
  assert.ok(unverified('FORM-PR-CONTRACT').length);
  assert.ok(board.definitions.every(d=>d.unverified_items.every(x=>x.note==='غير مُتحقَّق — الملف غير مقروء')));
  // ونموذج بلا مصدر مبتور لا يحمل وسم غير المتحقَّق أصلًا.
  assert.deepEqual(unverified('FORM-PM-KICKOFF'),[]);
});

test('the rest of the differences the comparison document lists are applied: structures, truncated warnings and fixed-row capacities',t=>{
  const {db,users}=fixture(t);
  const board=formsBoard(db,users.manager);
  const of=key=>board.definitions.find(d=>d.form_key===key);
  const fields=key=>fieldsOf({sections:of(key).sections});
  // PM-03: «تصنيف التعديل» و«استنفاد الجولات» تحت قسم مستقل اسمه «تقييم مدير المشروع».
  const change=of('FORM-PM-CHANGE');
  const evaluation=change.sections.find(s=>s.key==='impact');
  assert.equal(evaluation.title,'تقييم مدير المشروع');
  assert.ok(evaluation.fields.some(f=>f.key==='classification')&&evaluation.fields.some(f=>f.key==='free_rounds_used'));
  assert.ok(!change.sections.find(s=>s.key==='details').fields.some(f=>f.key==='classification'));
  assert.ok(change.warnings.some(w=>w.includes('CR-PM')&&w.includes('CR-AD')),'تصادم بادئات الترقيم مذكور');
  // CR-01: التنبيه ينتهي عند «من الطرفين» ولا يضيف «واكتمال بياناته».
  assert.ok(of('FORM-CR-BRIEF').warnings[0].includes('لا يبدأ أي عمل إبداعي قبل توقيع هذا الملخص من الطرفين'));
  assert.ok(!of('FORM-CR-BRIEF').gates.length);
  assert.ok(of('FORM-CR-BRIEF').warnings.some(w=>w.includes('«واكتمال بياناته» كانت مضافة')));
  // DS-01: سياسة التعديلات حقلان، أولهما عدد الجولات المجانية، وبلا «مدة رد العميل».
  const designRevisions=of('FORM-DS-BRIEF').sections.find(s=>s.key==='revisions');
  assert.deepEqual(designRevisions.fields.map(f=>f.key),['free_rounds','feedback_method']);
  assert.ok(!fields('FORM-DS-BRIEF').some(f=>f.key==='client_response_time'));
  // PROD-01: سياسة التعديلات قسم مستقل بحقل واحد.
  const prodRevisions=of('FORM-PROD-BRIEF').sections.find(s=>s.key==='revisions');
  assert.equal(prodRevisions.fields.length,1);
  assert.equal(prodRevisions.fields[0].key,'free_rounds');
  // DS-03: التنبيه مبتور عند «للجولات ال» ولا يُكمَل، وسعة السجل خمسة عشر صفًا.
  assert.ok(of('FORM-DS-REVISIONS').warnings.some(w=>w.includes('للجولات ال…')&&w.includes('مبتور')));
  assert.ok(fields('FORM-DS-REVISIONS').find(f=>f.key==='rows').help.includes('خمسة عشر صفًا'));
  // CW-02: قيم الملحق «—» كانت خطأ؛ الأصل يقول «غير مطلوب» و«حسب المدة»، وعمود الملاحظات موجود.
  const lengths=fields('FORM-CW-STYLE').find(f=>f.key==='length_rules').options;
  assert.ok(lengths[4].includes('الإيموجي غير مطلوب'),'الإيموجي في المقال «غير مطلوب» لا «—»');
  assert.ok(lengths[5].includes('الأقصى حسب المدة')&&lengths[5].includes('الإيموجي غير مطلوب'));
  assert.ok(lengths.every(x=>x.includes('هاشتاق')||x.includes('الهاشتاقات')));
  assert.ok(lengths[1].includes('100-150 كلمة')&&lengths[1].includes('280 حرف'),'تعارض المصدر محفوظ كما ورد');
  assert.equal(fields('FORM-CW-STYLE').find(f=>f.key==='length_notes').inferred,false,'عمود «ملاحظات» سابع في الأصل');
  // سعات الجداول الثابتة مذكورة حيث رصدها المصدر.
  assert.ok(fields('FORM-PM-KICKOFF').find(f=>f.key==='attendees').help.includes('ستة صفوف ثابتة'));
  assert.ok(fields('FORM-PR-INFLUENCERS').find(f=>f.key==='rows').help.includes('ثمانية صفوف ثابتة'));
  assert.ok(fields('FORM-PR-BUDGET').find(f=>f.key==='rows').help.includes('ثمانية صفوف ثابتة'));
  assert.ok(fields('FORM-CR-CONCEPT').find(f=>f.key==='proposals').help.includes('ثلاثة صفوف'));
  assert.ok(fields('FORM-PROD-SCRIPT').find(f=>f.key==='scenes').help.includes('ستة مشاهد'));
  // PR-05: القالب الأصلي غير مكتمل، فبنية الفقرات مقترحة لا مسنَدة.
  assert.ok(of('FORM-PR-RELEASE').warnings.some(w=>w.includes('القالب الأصلي غير مكتمل')&&w.includes('تت')));
  assert.equal(fields('FORM-PR-RELEASE').find(f=>f.key==='content').inferred,true);
  // PR-01: خطأ الترقيم في الأصل مذكور ولم يُصحَّح من عندنا.
  assert.ok(of('FORM-PR-CAMPAIGN').warnings.some(w=>w.includes('1، 1، 2')));
});

test('a definition stays a draft until its owner accepts it, and nothing can be filled on it before that',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>createInstance(db,users.outsider,{form_key:'FORM-BD-QUALIFY',title:'فرصة',
    subject_kind:'opportunity',subject_id:'OPP-004',payload:QUALIFY})),code('definition_draft'));
  assert.throws(()=>tx(()=>createInstance(db,users.outsider,{form_key:'FORM-NOT-REAL',title:'فرصة',
    subject_kind:'opportunity',subject_id:'OPP-004',payload:{}})),code('not_found'));
  accept(db,users,tx,'FORM-BD-QUALIFY');
  // حساب إدارة المنصة لا يعبئ نماذج أعمال.
  assert.throws(()=>tx(()=>createInstance(db,users.admin,{form_key:'FORM-BD-QUALIFY',title:'فرصة',
    subject_kind:'opportunity',subject_id:'OPP-005',payload:QUALIFY})),code('forbidden'));
  // التقديم إقرار من صاحب الدور المكتوب في التعريف، فمن لا يحمل تصريحه لا يقدّم.
  const created=tx(()=>createInstance(db,users.employee,{form_key:'FORM-BD-QUALIFY',title:'فرصة',
    subject_kind:'opportunity',subject_id:'OPP-006',payload:QUALIFY}));
  assert.throws(()=>tx(()=>instanceAction(db,users.employee,created.id,'submit',
    {version:instanceOf(db,users.employee,created.id).row_version})),code('author_capability'));
});
