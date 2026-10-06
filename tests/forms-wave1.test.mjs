import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { installCatalogue, formsBoard, acceptDefinition, createInstance, instanceAction, getInstance, validateSpec,
  aliasLookup } from '../app/forms.mjs';
import { FORM_CATALOGUE, catalogueForm } from '../app/forms-catalogue.mjs';
import { engagementRate, derivedKpis, ENGAGEMENT_KPI_PENDING } from '../app/form-kpis.mjs';
import { formsInventory, loadRegister, WAVE1 } from '../scripts/forms-inventory.mjs';

// حزمة الموجة الأولى (برومبت المالك 28 سبتمبر): جرد 24 مقابل 65، وسجل أداء المؤثرين MOD-PR-06، وحالة PR-04.
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const code=value=>error=>error.code===value;
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-forms-wave1');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  for(const [user,capability] of [['manager','forms.accept'],['outsider','influencers.manage'],['hr','pr.manage']])
    tx(()=>grantAccess(db,users.admin,{user_id:user,capability,note:'تصريح تجريبي لاختبار سجل أداء المؤثرين'}));
  tx(()=>installCatalogue(db,'36t'));
  const project=tx(()=>createProject(db,users.manager,{name:'حملة مؤثرين تجريبية',brief:'مشروع اختبار سجل الأداء',member_ids:['employee','outsider']}));
  return {db,users,tx,project};
}
const PERFORMANCE=(reach,engagement)=>({campaign_name:'حملة الإطلاق',client:'عميل تجريبي',specialist:'أخصائي المؤثرين',
  total_posts:'3',rows:'1، مؤثر أ، Instagram، Reel، 2026-09-20، …',total_reach:reach,total_views:'900',total_engagement:engagement,
  screenshots_taken:'نعم'});

test('the automated inventory keeps all 65 source forms, finds every one of the 24 wave-one forms built, and deletes nothing',()=>{
  const register=loadRegister();
  assert.equal(register.forms.length,65,'سجل المصادر يحمل النماذج الـ65 كلها');
  assert.equal(new Set(register.forms.map(f=>f.code)).size,65,'لا رمز مكرر في السجل');
  assert.equal(WAVE1.length,24);
  const inventory=formsInventory(register);
  assert.deepEqual(inventory.wave1_missing_from_register,[]);
  assert.deepEqual(inventory.wave1_not_built,[],'كل نماذج الموجة الأولى مبنية');
  assert.deepEqual(inventory.catalogue_outside_register,[],'لا نموذج في الكتالوج بلا سطر مصدر');
  assert.equal(inventory.totals.deleted,0);
  assert.equal(inventory.totals.disabled,0);
  assert.equal(inventory.totals.outside_wave,41,'النماذج خارج الموجة تبقى في السجل ولا تُحذف');
  // المالية والمشتريات والموارد البشرية لا تُخفى: الإدارات التسع كلها في السجل، ومنها التواصل الداخلي خارج الموجة.
  assert.deepEqual([...new Set(register.forms.map(f=>f.department))].sort(),['AD','BD','CR','CW','DS','IC','PM','PR','PROD']);
  // «Not uploaded» حالة «بانتظار اعتماد المصدر»، لا حذف.
  for(const row of register.forms.filter(f=>f.upload_status==='not_uploaded'))assert.equal(row.source_status,'بانتظار اعتماد المصدر');
  // نواة التسعير BD-02/BD-03 مبنية في وحدة التسعير ولا تُعدّ غير مبنية.
  for(const c of ['MOD-BD-02','MOD-BD-03'])assert.equal(inventory.rows.find(r=>r.code===c).platform,'built_elsewhere');
  // تعارض الرمز MOD-01 يُسجَّل ولا يُحسم آليًا.
  assert.ok(inventory.collisions.some(c=>c.code==='MOD-01'&&c.form_keys.length===2));
});

test('PR-04 is built but carries its pending governing-version status instead of being presented as confirmed',()=>{
  const form=catalogueForm('FORM-PR-BRIEFING');
  assert.equal(form.source_status,'بانتظار تأكيد النسخة الحاكمة');
  assert.ok(form.source_note.includes('بانتظار تأكيد النسخة الحاكمة'));
  assert.ok(form.warnings[0].includes('بانتظار تأكيد النسخة الحاكمة'));
  const row=loadRegister().forms.find(f=>f.code==='MOD-PR-04');
  assert.equal(row.upload_status,'not_in_index');
});

test('engagement rate is computed from totals, and zero or missing reach reads as not computed, never as zero or success',()=>{
  assert.deepEqual([engagementRate({engagement:50,reach:1000}).value,engagementRate({engagement:50,reach:1000}).display],[5,'5.00%']);
  for(const reach of [0,'0',null,undefined,'','abc',-5]){
    const r=engagementRate({engagement:10,reach});
    assert.equal(r.computed,false,`reach=${reach}`);
    assert.equal(r.value,null);
    assert.equal(r.display,'غير محسوب');
  }
  assert.equal(engagementRate({engagement:'',reach:100}).display,'غير محسوب');
  assert.equal(engagementRate({engagement:0,reach:100}).display,'0.00%','تفاعل صفر على وصول معلوم نتيجة حقيقية');
  // حدود المعادلة: لا تقريب يرفع النتيجة، وتفاعل أكبر من الوصول يُحسب كما هو.
  assert.equal(engagementRate({engagement:1,reach:3}).value,33.33);
  assert.equal(engagementRate({engagement:2,reach:3}).value,66.66);
  assert.equal(engagementRate({engagement:150,reach:100}).value,150);
  // لا يُقدَّم مؤشرًا معتمدًا حتى يعتمد المالك تعريف KPI.
  assert.equal(engagementRate({engagement:1,reach:2}).approved,false);
  assert.equal(engagementRate({engagement:1,reach:2}).approval_note,ENGAGEMENT_KPI_PENDING);
  assert.equal(engagementRate({engagement:1,reach:2},{kpiApproved:true}).approved,true);
  assert.deepEqual(derivedKpis('FORM-PR-BUDGET',{}),[]);
});

test('PR-06 is seeded as an unaccepted draft with stable id and aliases, and a filled log shows its computed rate through the normal approval chain',t=>{
  const {db,users,tx,project}=fixture(t);
  const form=catalogueForm('FORM-PR-PERFORMANCE');
  assert.equal(form.frm,null,'لا رمز FRM له في فهرس الـ41');
  assert.equal(form.source_status,'بانتظار اعتماد المصدر');
  assert.doesNotThrow(()=>validateSpec({sections:form.sections,author:form.author,chain:form.chain,attachments:form.attachments,
    subject_kinds:form.subject_kinds,warnings:form.warnings,depends_on:form.depends_on,classification:form.classification}));
  assert.equal(FORM_CATALOGUE.filter(f=>f.key==='FORM-PR-PERFORMANCE').length,1);
  const definition=formsBoard(db,users.manager).definitions.find(d=>d.form_key==='FORM-PR-PERFORMANCE');
  assert.equal(definition.status,'draft','يبدأ مسودة لا يُعبّأ حتى يقبله المالك');
  assert.ok(!definition.sections.flatMap(s=>s.fields).some(f=>/rate|معدل/.test(f.key+f.label)&&f.type==='number'),'معدل التفاعل لا يُكتب يدويًا');
  assert.deepEqual(aliasLookup(db,'36t','MOD-PR-06').matches.map(m=>m.form_key),['FORM-PR-PERFORMANCE']);
  // لا يُعبّأ قبل قبول التعريف.
  assert.throws(()=>tx(()=>createInstance(db,users.outsider,{form_key:'FORM-PR-PERFORMANCE',title:'سجل الأداء',
    subject_kind:'project',subject_id:project.id,payload:PERFORMANCE('1000','50')})),code('definition_draft'));
  tx(()=>acceptDefinition(db,users.manager,'FORM-PR-PERFORMANCE',{version:definition.row_version,effective_from:today(),
    note:'أقبل تعريف سجل الأداء مسودةً للتجربة'}));
  const zero=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-PR-PERFORMANCE',title:'سجل أداء بلا وصول',
    subject_kind:'project',subject_id:project.id,payload:PERFORMANCE('0','50')}));
  const zeroView=getInstance(db,users.outsider,zero.id);
  assert.equal(zeroView.kpis[0].display,'غير محسوب');
  const filled=tx(()=>createInstance(db,users.outsider,{form_key:'FORM-PR-PERFORMANCE',title:'سجل أداء الحملة',
    subject_kind:'project',subject_id:project.id,payload:PERFORMANCE('1000','50')}));
  tx(()=>instanceAction(db,users.outsider,filled.id,'submit',{version:getInstance(db,users.outsider,filled.id).row_version}));
  const submitted=getInstance(db,users.outsider,filled.id);
  assert.equal(submitted.kpis[0].display,'5.00%');
  // لا اعتماد ذاتي: المعِدّ لا يعتمد سجله.
  assert.throws(()=>tx(()=>instanceAction(db,users.outsider,filled.id,'approve',{version:submitted.row_version,note:'أعتمد سجلي'})));
  tx(()=>instanceAction(db,users.hr,filled.id,'approve',{version:getInstance(db,users.hr,filled.id).row_version,note:'مراجعة مدير العلاقات العامة'}));
  assert.equal(getInstance(db,users.hr,filled.id).status,'approved');
  assert.ok(verifyAudit(db));
});
