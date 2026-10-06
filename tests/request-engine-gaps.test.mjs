// ثلاث ثغرات في محرك الطلبات، كل وحدة معها اختبار يسقط قبل الإصلاح ويمر بعده:
//   (1) لقطة الطلب كانت تُنسخ كاملة إلى سجل التدقيق وإلى سجل التذكير، فتسافر معها حمولة الموظف.
//   (2) transition كان يكتب بلا معاملة، فينطبق نصف الانتقال ويسقط نصفه.
//   (3) النسخة المقدَّمة ما كان لها ختم، فما فيه شي يثبت إنها ما تغيّرت من يوم ما قُدّمت.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { redact } from '../app/pii.mjs';
import * as wf from '../app/workflow.mjs';

// قيم مصطنعة بالكامل: لا اسم موظف حقيقي ولا رقم حقيقي. الأولان يمسكهما حجب الأنماط في app/pii.mjs،
// والثالث لا يمسكه أي نمط — وهو المقصود: القائمة المسموحة تحجب ما لا يحجبه أي نمط.
const IBAN='SA0380000000608010167519';
const MOBILE='0551234567';
const FREE_TEXT='علاج بنتي في مستشفى الأحساء';
const RESTRICTED=[IBAN,MOBILE,FREE_TEXT];

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-request-engine-gaps');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const letter=()=>wf.catalog(db,users.employee).find(s=>s.code==='HR-LETTER').id;
  const make=(payload={purpose:`الغرض: ${FREE_TEXT}`,recipient:`حوالة على ${IBAN} وجوال ${MOBILE}`})=>
    transaction(db,()=>wf.createRequest(db,users.employee,{service_id:letter(),title:'خطاب تجريبي',payload}));
  const act=(who,r,action,note='سبب القرار التجريبي')=>transaction(db,()=>wf.transition(db,users[who],r.id,action,{version:r.version,note}));
  return {db,users,make,act};
}

// النص المطوي: يمسك القيمة ولو دخلت السجل بفواصل أو بأرقام غير لاتينية، مثل ما يفعل tests/custom-fields.test.mjs.
const collapse=text=>String(text).normalize('NFKC').replace(/[^\p{L}\p{Nd}]+/gu,'').replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x0660));
const auditText=(db,rid)=>db.prepare("SELECT before_json,after_json,reason FROM audit_events WHERE entity_type='request' AND entity_id=?").all(rid)
  .map(e=>e.before_json+e.after_json+e.reason).join('\n');

test('لقطة الطلب تبقى كاملة في النسخة المقدَّمة، وما تُنسخ حمولتها إلى سجل التدقيق ولا إلى سجل التذكير',t=>{
  const {db,users,make,act}=fixture(t);
  let r=make();
  // تعديل ثم تقديم ثم اعتماد الخطوتين ثم مباشرة وإغلاق: كل فعل يمر من transition ويكتب صفًّا في سجل التدقيق.
  r=transaction(db,()=>wf.editRequest(db,users.employee,r.id,{version:r.version,title:'خطاب تجريبي معدّل',
    payload:{purpose:`الغرض بعد التعديل: ${FREE_TEXT}`,recipient:`حوالة على ${IBAN} وجوال ${MOBILE}`}}));
  r=act('employee',r,'submit');
  r=act('manager',r,'approve');
  r=act('hr',r,'approve');
  assert.equal(r.status,'approved');

  // النسخة المقدَّمة تُعيد ما قُدّم بحرفه — هذا هو الجزء اللي ما ينقص.
  const [version]=wf.detail(db,users.employee,r.id).versions;
  assert.equal(version.snapshot.payload.purpose,`الغرض بعد التعديل: ${FREE_TEXT}`);
  assert.equal(version.snapshot.payload.recipient,`حوالة على ${IBAN} وجوال ${MOBILE}`);
  assert.equal(version.snapshot.title,'خطاب تجريبي معدّل','والعنوان كما كتبه صاحبه');

  // ولا قيمة منها في سجل التدقيق. السجل إلحاقي لا يُنقَّح، فاللي يدخله ما يطلع منه.
  const trail=collapse(auditText(db,r.id));
  for(const value of RESTRICTED)assert.ok(!trail.includes(collapse(value)),`«${value}» ما وصلت سجل التدقيق`);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='request' AND entity_id=? AND (before_json LIKE '%payload%' OR after_json LIKE '%payload%')").get(r.id).n,0,
    'ولا صف يحمل مفتاح الحمولة أصلًا');

  // والسجل ما زال يقول وش صار: الحالة قبل وبعد، وهذا اللي يلزم منه.
  const submitted=db.prepare("SELECT before_json,after_json FROM audit_events WHERE entity_type='request' AND entity_id=? AND action='submit'").get(r.id);
  assert.deepEqual(Object.keys(JSON.parse(submitted.after_json)).sort(),['assigned_to','revision','status','version']);
  assert.equal(JSON.parse(submitted.before_json).status,'draft');
  assert.equal(JSON.parse(submitted.after_json).status,'pending');
  assert.ok(verifyAudit(db),'وسلسلة التدقيق سليمة بعد كل هذا');
});

test('تذكير المعتمد يسجّل وش صار بلا ما ينسخ الحمولة معه',t=>{
  const {db,users,make,act}=fixture(t);
  let r=act('employee',make(),'submit');
  assert.equal(r.status,'pending');
  // التذكير ما ينفتح إلا بعد 24 ساعة من وصول الخطوة لصاحبها.
  const later=Date.now()+2*86400000;
  t.mock.method(Date,'now',()=>later);
  r=wf.detail(db,users.employee,r.id);
  assert.ok(r.actions.includes('escalate'),'التذكير صار متاحًا لصاحب الطلب');
  transaction(db,()=>wf.remindApprover(db,users.employee,r.id,{version:r.version,note:'تأخر القرار وأحتاج الخطاب'}));

  const reminder=db.prepare("SELECT before_json,after_json,reason FROM audit_events WHERE entity_type='request' AND entity_id=? AND action='escalate'").get(r.id);
  assert.deepEqual(Object.keys(JSON.parse(reminder.before_json)).sort(),['assigned_to','revision','status','version'],'صف التذكير يحمل الحالة لا اللقطة');
  assert.equal(JSON.parse(reminder.after_json).authority_changed,false,'والتذكير ما ينقل قرارًا، كما كان');
  const trail=collapse(auditText(db,r.id));
  for(const value of RESTRICTED)assert.ok(!trail.includes(collapse(value)),`«${value}» ما وصلت سجل التذكير`);
  // وسجل المتابعة نفسه ما فيه إلا سبب التذكير اللي كتبه صاحب الطلب.
  const followup=db.prepare('SELECT reason FROM approval_followups WHERE request_id=?').get(r.id);
  assert.equal(followup.reason,'تأخر القرار وأحتاج الخطاب');
});

test('القائمة المسموحة تحجب ما لا يحجبه أي نمط: هذا سبب اختيارها على الحجب بالأنماط',t=>{
  // app/pii.mjs يعلن عن نفسه إنه جزئي: يمسك الآيبان والجوال، وما يمسك الكلام الحر.
  assert.ok(!redact(IBAN).text.includes(IBAN),'الحجب بالأنماط يمسك الآيبان');
  assert.ok(!redact(MOBILE).text.includes(MOBILE),'ويمسك الجوال');
  assert.equal(redact(FREE_TEXT).text,FREE_TEXT,'وما يمسك الكلام الحر — ولو حجبنا به السجل لبقي هذا فيه للأبد');
});

test('transition يرفض التنفيذ خارج المعاملة بدل ما يطبّق نص الانتقال',t=>{
  const {db,users,make}=fixture(t);
  const r=make();
  const before={status:r.status,revision:r.revision,versions:db.prepare('SELECT COUNT(*) AS n FROM request_versions WHERE request_id=?').get(r.id).n,
    audit:db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='request' AND entity_id=?").get(r.id).n};
  assert.equal(db.isTransaction,false);
  assert.throws(()=>wf.transition(db,users.employee,r.id,'submit',{version:r.version}),
    {code:'transaction_required',status:500},'التقديم خارج المعاملة مرفوض');
  // وما انطبق منه شي: لا نسخة مقدَّمة، ولا خطوة اعتماد، ولا صف تدقيق، ولا تغيّرت حالة الطلب.
  const raw=db.prepare('SELECT status,revision FROM requests WHERE id=?').get(r.id);
  assert.deepEqual([raw.status,raw.revision],[before.status,before.revision]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM request_versions WHERE request_id=?').get(r.id).n,before.versions);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_steps WHERE request_id=?').get(r.id).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='request' AND entity_id=?").get(r.id).n,before.audit);
  // والأفعال الباقية كلها تمر من الحارس نفسه.
  for(const action of ['cancel','approve','claim','complete'])
    assert.throws(()=>wf.transition(db,users.employee,r.id,action,{version:r.version,note:'ملاحظة تجريبية'}),{code:'transaction_required'},action);
  // وداخل المعاملة يمشي كما كان.
  assert.equal(transaction(db,()=>wf.transition(db,users.employee,r.id,'submit',{version:r.version})).status,'pending');
});

test('ختم النسخة: السليمة تمر، والمبدَّلة من خارج المنصة تسقط، واللي بلا ختم تقول «ما نقدر نتأكد»',t=>{
  const {db,users,make,act}=fixture(t);
  const clean=act('employee',make(),'submit');

  // (1) نسخة انحفظت بختمها: سليمة.
  const verified=wf.verifyRequestVersions(db,clean.id);
  assert.equal(verified.state,'valid');
  assert.equal(verified.state_name,wf.VERSION_STATES.valid);
  assert.equal(verified.ok,true);
  assert.deepEqual([verified.valid,verified.altered,verified.not_verifiable],[1,0,0]);
  assert.equal(verified.versions[0].digest.length,64,'الختم صورة sha256 بالست عشري');
  assert.equal(verified.versions[0].digest,
    wf.versionDigest(clean.id,verified.versions[0].revision,verified.versions[0].created_at,
      JSON.parse(db.prepare('SELECT snapshot FROM request_versions WHERE request_id=? AND revision=?').get(clean.id,verified.versions[0].revision).snapshot)),
    'ويُعاد حسابه من الصف نفسه');

  // (2) النسخة ما تُعدَّل من داخل المنصة أصلًا — المشغّل يردّها.
  assert.throws(()=>db.prepare('UPDATE request_versions SET snapshot=? WHERE request_id=?').run('{}',clean.id),/immutable/);

  // فالتبديل الوحيد الممكن من خارج المنصة: يُسقط المشغّل ثم يُكتب في الملف. هذا اللي الختم موجود له.
  const tampered=act('employee',make({purpose:'غرض ثانٍ',recipient:'جهة ثانية'}),'submit');
  db.exec('DROP TRIGGER version_no_update');
  const row=db.prepare('SELECT * FROM request_versions WHERE request_id=?').get(tampered.id);
  db.prepare('UPDATE request_versions SET snapshot=? WHERE request_id=? AND revision=?')
    .run(JSON.stringify({...JSON.parse(row.snapshot),payload:{purpose:'غرض مدسوس',recipient:'جهة مدسوسة'}}),tampered.id,row.revision);
  db.exec("CREATE TRIGGER version_no_update BEFORE UPDATE ON request_versions BEGIN SELECT RAISE(ABORT,'submitted versions are immutable'); END");
  const broken=wf.verifyRequestVersions(db,tampered.id);
  assert.equal(broken.state,'altered');
  assert.equal(broken.ok,false);
  assert.equal(broken.altered,1);
  assert.equal(broken.versions[0].state_name,wf.VERSION_STATES.altered);
  assert.match(broken.versions[0].why,/ما يطابق/);
  assert.equal(wf.verifyRequestVersions(db,clean.id).state,'valid','والطلب الثاني ما تأثّر');

  // (3) صف من قبل الترحيل 146: بلا ختم. ما يُقال عنه سليم ولا يُقال عنه تغيّر.
  const old=make();
  db.prepare('INSERT INTO request_versions(request_id,revision,snapshot,created_at) VALUES(?,?,?,?)')
    .run(old.id,0,JSON.stringify({title:'نسخة قديمة مصطنعة',payload:{purpose:'غرض قديم'}}),new Date(Date.now()-90*86400000).toISOString());
  const unknown=wf.verifyRequestVersions(db,old.id);
  assert.equal(unknown.state,'not_verifiable');
  assert.equal(unknown.ok,false,'«ما نقدر نتأكد» ما هي «سليمة»');
  assert.deepEqual([unknown.valid,unknown.altered,unknown.not_verifiable],[0,0,1]);
  assert.equal(unknown.versions[0].digest,null);
  assert.equal(unknown.versions[0].state_name,wf.VERSION_STATES.not_verifiable);
  assert.match(unknown.versions[0].why,/ترحيل 146/);

  // (4) طلب ما قُدّم بعد: ما فيه نسخة تُفحص، وهذي غير «ما نقدر نتأكد».
  const draft=make();
  const nothing=wf.verifyRequestVersions(db,draft.id);
  assert.equal(nothing.state,'none');
  assert.equal(nothing.ok,false);
  assert.deepEqual(nothing.versions,[]);

  // (5) رقم طلب ما له وجود: رفض مكتوب يقول وش الناقص ووش الخطوة اللي بعده.
  let refused=null;
  try{wf.verifyRequestVersions(db,'request-does-not-exist');}catch(error){refused=error;}
  assert.ok(refused,'الرفض يُرمى');
  assert.equal(refused.code,'not_found');assert.equal(refused.status,404);
  assert.match(refused.details.refusal.what,/ما فيه طلب بهذا الرقم/);
  assert.ok(refused.details.refusal.next.length>0,'والرفض يقول الخطوة اللي بعده');
});

test('صفٌّ واحد مبدَّل يكسر جواب الطلب كله، وصفٌّ بلا ختم يمنع قول «سليمة»',t=>{
  const {db,users,make,act}=fixture(t);
  // طلب بنسختين: يُقدَّم، يُعاد للتعديل، ثم يُقدَّم من جديد.
  let r=act('employee',make(),'submit');
  r=act('manager',r,'return','ينقصه اسم الجهة');
  r=act('employee',wf.detail(db,users.employee,r.id),'submit');
  assert.equal(wf.verifyRequestVersions(db,r.id).versions.length,2);
  assert.equal(wf.verifyRequestVersions(db,r.id).state,'valid');

  // نسخة ثالثة بلا ختم بجوارهما: الجواب العام ينزل إلى «ما نقدر نتأكد» ولا يبقى «سليمة».
  db.prepare('INSERT INTO request_versions(request_id,revision,snapshot,created_at) VALUES(?,?,?,?)')
    .run(r.id,0,'{}',new Date(Date.now()-30*86400000).toISOString());
  const mixed=wf.verifyRequestVersions(db,r.id);
  assert.equal(mixed.state,'not_verifiable');
  assert.deepEqual([mixed.valid,mixed.not_verifiable],[2,1]);

  // ثم تُبدَّل وحدة من المختومتين: «تغيّرت» تغلب «ما نقدر نتأكد»، لأن الأسوأ هو الجواب.
  db.exec('DROP TRIGGER version_no_update');
  db.prepare("UPDATE request_versions SET created_at=? WHERE request_id=? AND revision=1").run('2020-01-01T00:00:00.000Z',r.id);
  db.exec("CREATE TRIGGER version_no_update BEFORE UPDATE ON request_versions BEGIN SELECT RAISE(ABORT,'submitted versions are immutable'); END");
  const worst=wf.verifyRequestVersions(db,r.id);
  assert.equal(worst.state,'altered','تأخير لحظة التقديم وحدها يكسر الختم');
  assert.equal(worst.altered,1);
});
