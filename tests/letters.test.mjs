import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { seedHrDemo } from '../scripts/seed-hr-demo.mjs';
import { grantAccess } from '../app/access.mjs';
import { lettersBoard, templatesBoard, saveTemplate, approveTemplate, addLetterType, letterTypeAction,
  requestLetter, letterAction, letterDocument, letterPrintable, verifyLetter } from '../app/letters.mjs';

const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const BODY='إلى {{addressee}}\n\nنفيدكم بأن {{employee_name}} يعمل لدينا بوظيفة {{job_title}} منذ {{hire_date}}.';
const SALARY_BODY='إلى {{addressee}}\n\nنفيد بأن {{employee_name}} يعمل لدينا بوظيفة {{job_title}} وإجمالي راتبه الشهري {{salary_total}}.';

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-letters');seedHrDemo(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  // مالك إجراء الخطابات تجريبيًا: المدير. و«it» يحمل التصريحين معًا لاختبار أن حمل التصريحين لا يلغي فصل المهام.
  for(const [user,capability] of [['manager','hr.letters.issue'],['it','hr.letters.prepare'],['it','hr.letters.issue']])
    tx(()=>grantAccess(db,users.admin,{user_id:user,capability,note:'تصريح تجريبي لاختبار خطابات الموظفين'}));
  return {db,users,tx};
}
const draftOf=(db,u,code)=>templatesBoard(db,u).types.find(t=>t.code===code).draft;
function publish(db,users,tx,code,body){
  tx(()=>saveTemplate(db,users.hr,code,{body,version:draftOf(db,users.hr,code)?.version}));
  tx(()=>approveTemplate(db,users.manager,code,{effective_from:today(),note:'أعتمد صيغة هذا الخطاب وأتحملها كمالك إجراء',version:draftOf(db,users.manager,code).version}));
}
const requestOf=(db,u,id)=>lettersBoard(db,u).requests.find(r=>r.id===id);

test('letter templates: the platform writes no letter text, only the approved placeholders pass, and whoever writes a template never approves it',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>templatesBoard(db,users.employee),code('not_permitted'));
  const start=templatesBoard(db,users.hr);
  assert.ok(start.types.some(x=>x.code==='employment')&&start.types.some(x=>x.code==='salary'),'the five base types come from the types table, not from code');
  assert.ok(start.types.every(x=>!x.published&&!x.draft),'no type ships with a template');
  // القالب يبدأ فارغًا: لا نص ولا صيغة رسمية من المنصة.
  tx(()=>saveTemplate(db,users.hr,'employment',{body:''}));
  const empty=draftOf(db,users.hr,'employment');
  assert.equal(empty.body,'');
  assert.throws(()=>tx(()=>approveTemplate(db,users.manager,'employment',{effective_from:today(),note:'اعتماد قالب فارغ',version:empty.version})),code('empty_template'));
  assert.throws(()=>tx(()=>saveTemplate(db,users.hr,'employment',{body:'رقم الحساب {{iban}}',version:empty.version})),code('unknown_placeholder'));
  assert.throws(()=>tx(()=>saveTemplate(db,users.hr,'employment',{body:'{{employee_name} ناقص',version:empty.version})),code('placeholder_syntax'));
  // من يحمل التصريحين معًا لا يعتمد ما كتبه بنفسه.
  tx(()=>saveTemplate(db,users.it,'employment',{body:BODY,version:draftOf(db,users.it,'employment').version}));
  assert.throws(()=>tx(()=>approveTemplate(db,users.it,'employment',{effective_from:today(),note:'أعتمد ما كتبته بنفسي',version:draftOf(db,users.it,'employment').version})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>approveTemplate(db,users.hr,'employment',{effective_from:today(),note:'أعتمد القالب بلا تصريح إصدار',version:draftOf(db,users.hr,'employment').version})),code('not_permitted'));
  tx(()=>approveTemplate(db,users.manager,'employment',{effective_from:today(),note:'أعتمد صيغة هذا الخطاب وأتحملها كمالك إجراء',version:draftOf(db,users.manager,'employment').version}));
  const published=templatesBoard(db,users.hr).types.find(x=>x.code==='employment').published;
  assert.equal(published.revision,1);assert.deepEqual(published.placeholders.sort(),['addressee','employee_name','hire_date','job_title']);
  assert.throws(()=>db.prepare("UPDATE letter_templates SET body='صيغة بديلة صامتة',version=version+1 WHERE status='published'").run(),/replaced by a new revision/);
  // التصحيح نسخة جديدة: المنشورة تبقى سارية حتى يعتمد المالك بديلها.
  tx(()=>saveTemplate(db,users.hr,'employment',{body:BODY+'\n\nصدر بناء على طلبه.'}));
  assert.equal(templatesBoard(db,users.hr).types.find(x=>x.code==='employment').published.revision,1);
  tx(()=>approveTemplate(db,users.manager,'employment',{effective_from:today(),note:'أعتمد النسخة الثانية بعد إضافة سطر الختام',version:draftOf(db,users.manager,'employment').version}));
  assert.deepEqual(db.prepare("SELECT status FROM letter_templates WHERE type_code='employment' ORDER BY revision").all().map(r=>r.status),['superseded','published']);
  assert.ok(verifyAudit(db));
});

test('letter types are rows, not a list in code: the procedure owner adds and retires them, and a type without an approved template cannot be requested',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>requestLetter(db,users.employee,{type_code:'employment',addressee:'البنك التجريبي',purpose:'فتح حساب راتب'})),code('template_required'));
  assert.throws(()=>tx(()=>addLetterType(db,users.hr,{code:'clearance',name:'إخلاء طرف'})),code('not_permitted'));
  assert.throws(()=>tx(()=>addLetterType(db,users.manager,{code:'salary',name:'نوع مكرر'})),code('duplicate_type'));
  tx(()=>addLetterType(db,users.manager,{code:'clearance',name:'إخلاء طرف'}));
  const added=templatesBoard(db,users.manager).types.find(x=>x.code==='clearance');
  assert.ok(added.own&&added.active);
  assert.throws(()=>tx(()=>letterTypeAction(db,users.manager,'employment','retire_letter_type',{version:1,note:'نوع أساسي مشترك'})),code('not_found'));
  tx(()=>letterTypeAction(db,users.manager,'clearance','retire_letter_type',{version:added.version,note:'لم تُعتمد صيغته بعد'}));
  assert.equal(lettersBoard(db,users.employee).types.some(x=>x.code==='clearance'),false,'a retired type is not offered');
  assert.ok(verifyAudit(db));
});

test('employment letter: the employee requests it, one person prepares and another issues, and the reference is a gapless yearly serial carrying a QR verification path',t=>{
  const {db,users,tx}=fixture(t);
  publish(db,users,tx,'employment',BODY);
  const first=tx(()=>requestLetter(db,users.employee,{type_code:'employment',addressee:'سفارة تجريبية',purpose:'إجراءات تأشيرة زيارة'})).id;
  assert.throws(()=>tx(()=>requestLetter(db,users.employee,{type_code:'employment',addressee:'سفارة تجريبية',purpose:'طلب مكرر لنفس النوع'})),code('open_request'));
  const mine=requestOf(db,users.employee,first);
  assert.deepEqual(mine.actions,['cancel_request'],'the employee requests and withdraws; they never prepare or issue their own letter');
  assert.throws(()=>tx(()=>letterAction(db,users.employee,first,'prepare_letter',{version:mine.version,note:'أعدّ خطابي بنفسي'})),code('action_unavailable'));
  assert.throws(()=>tx(()=>letterAction(db,users.hr,first,'prepare_letter',{version:mine.version+5,note:'نسخة قديمة'})),code('stale_version'));
  tx(()=>letterAction(db,users.hr,first,'prepare_letter',{version:mine.version,note:'طوبق على العقد الساري'}));
  const prepared=requestOf(db,users.hr,first);
  assert.equal(prepared.status,'prepared');
  assert.equal(prepared.actions.includes('issue_letter'),false,'the preparer holds no issuing permission here');
  assert.ok(requestOf(db,users.manager,first).actions.includes('issue_letter'));
  assert.ok(lettersBoard(db,users.manager).awaiting_me.some(x=>x.id===first),'the issuer is told a letter awaits their decision');
  assert.throws(()=>tx(()=>letterAction(db,users.employee,first,'issue_letter',{version:prepared.version,note:'أصدر خطابي بنفسي'})),code('action_unavailable'));
  const issued=tx(()=>letterAction(db,users.manager,first,'issue_letter',{version:prepared.version,note:'صدر عن مالك الإجراء'}));
  assert.equal(issued.reference,`${today().slice(0,4)}-00001`);
  const letter=requestOf(db,users.employee,first).letter;
  assert.match(letter.body,/الموظفة التجريبية/);assert.match(letter.body,/سفارة تجريبية/);assert.match(letter.body,/مصممة أولى/);
  assert.equal(letter.verify_path,`/verify/letter/${letter.verify_code}`);
  assert.throws(()=>db.prepare("UPDATE letters SET body='نص مبدّل بعد الإصدار' WHERE id=?").run(letter.id),/never edited/);
  // مسار التحقق قراءة فقط: يقول إن الخطاب صدر ومتى، ولا يكشف اسمًا ولا راتبًا.
  const check=verifyLetter(db,letter.verify_code);
  assert.equal(check.found,true);assert.equal(check.issued_on,today());
  assert.equal(check.statement.includes(users.employee.name),false);assert.equal(/\d{1,3},\d{3}/.test(check.statement),false);
  assert.equal(verifyLetter(db,'ZZZZZZZZZZZZ').found,false);assert.equal(verifyLetter(db,null).found,false);
  const printable=letterPrintable(letterDocument(db,users.employee,letter.id));
  assert.match(printable,/<svg/);assert.ok(printable.includes(letter.verify_path));assert.ok(printable.includes(letter.reference));
  // لا تُخترع قيمة ناقصة: موظف بلا عقد ساري لا يُعدّ له خطاب يذكر وظيفته.
  const noContract=tx(()=>requestLetter(db,users.outsider,{type_code:'employment',addressee:'بنك تجريبي',purpose:'فتح حساب راتب'})).id;
  assert.deepEqual(requestOf(db,users.hr,noContract).missing_values,['job_title','hire_date']);
  assert.throws(()=>tx(()=>letterAction(db,users.hr,noContract,'prepare_letter',{version:requestOf(db,users.hr,noContract).version,note:'لا عقد ساري'})),code('missing_values'));
  // من أعدّ لا يصدر، حتى لو ملك التصريحين.
  const second=tx(()=>requestLetter(db,users.employee,{type_code:'employment',addressee:'جهة تجريبية أخرى',purpose:'إثبات عمل ثانٍ'})).id;
  tx(()=>letterAction(db,users.it,second,'prepare_letter',{version:requestOf(db,users.it,second).version,note:'أعددته'}));
  assert.equal(requestOf(db,users.it,second).actions.includes('issue_letter'),false);
  assert.throws(()=>tx(()=>letterAction(db,users.it,second,'issue_letter',{version:requestOf(db,users.it,second).version,note:'أصدر ما أعددته'})),code('action_unavailable'));
  tx(()=>letterAction(db,users.manager,second,'issue_letter',{version:requestOf(db,users.manager,second).version,note:'صدر عن مالك الإجراء'}));
  assert.equal(requestOf(db,users.employee,second).letter.reference,`${today().slice(0,4)}-00002`,'the yearly serial has no gaps');
  // الإلغاء سجل جديد يبطل رمز التحقق ولا يمس نسخة الخطاب.
  tx(()=>letterAction(db,users.manager,first,'cancel_letter',{version:requestOf(db,users.manager,first).version,reason:'صدر إلى جهة خاطئة وأعيد إصداره بطلب جديد'}));
  assert.equal(verifyLetter(db,letter.verify_code).found,false);
  assert.equal(requestOf(db,users.employee,first).letter.body,letter.body,'the issued copy is retained exactly as it was issued');
  assert.ok(verifyAudit(db));
});

test('salary letter: the amount is derived from the live contract at issue time, is stored in no column, and its text reaches only its owner and whoever may issue it',t=>{
  const {db,users,tx}=fixture(t);
  publish(db,users,tx,'salary',SALARY_BODY);
  const columns=db.prepare("SELECT name FROM pragma_table_info('letters')").all().map(r=>r.name);
  assert.equal(columns.some(name=>/amount|minor|salary|pay/.test(name)),false,'no salary column on the letters table');
  const request=tx(()=>requestLetter(db,users.employee,{type_code:'salary',addressee:'بنك تجريبي',purpose:'تمويل شخصي'})).id;
  assert.equal(requestOf(db,users.employee,request).shows_salary,true);
  tx(()=>letterAction(db,users.hr,request,'prepare_letter',{version:requestOf(db,users.hr,request).version,note:'العقد ساري'}));
  tx(()=>letterAction(db,users.manager,request,'issue_letter',{version:requestOf(db,users.manager,request).version,note:'صدر عن مالك الإجراء'}));
  const own=requestOf(db,users.employee,request).letter;
  assert.match(own.body,/10,500\.00 ريال/,'the total is the live contract read at issue time');
  assert.equal(requestOf(db,users.hr,request).letter.body,null,'a preparer does not read a salary letter');
  assert.equal(requestOf(db,users.hr,request).letter.body_hidden,true);
  assert.ok(requestOf(db,users.manager,request).letter.body.includes('10,500.00'),'the issuer reads what they signed');
  assert.throws(()=>letterDocument(db,users.hr,own.id),code('forbidden'));
  assert.throws(()=>letterDocument(db,users.outsider,own.id),code('not_found'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='letter' AND after_json LIKE '%10,500%'").get().n,0,'the amount never reaches the audit trail');
  assert.ok(verifyAudit(db));
});

test('letters stay inside their tenant, and SQL refuses a request whose preparer is also its issuer or its subject',t=>{
  const {db,users,tx}=fixture(t);
  publish(db,users,tx,'employment',BODY);
  const request=tx(()=>requestLetter(db,users.employee,{type_code:'employment',addressee:'جهة تجريبية',purpose:'إثبات عمل'})).id;
  tx(()=>letterAction(db,users.hr,request,'prepare_letter',{version:requestOf(db,users.hr,request).version,note:'جاهز'}));
  assert.throws(()=>db.prepare("UPDATE letter_requests SET issued_by=prepared_by,status='issued',issued_at='2026-01-01T00:00:00.000Z',version=version+1 WHERE id=?").run(request),/CHECK/);
  assert.throws(()=>db.prepare("UPDATE letter_requests SET prepared_by=user_id,version=version+1 WHERE id=?").run(request),/CHECK/);
  assert.equal(lettersBoard(db,users.external).requests.length,0,'another tenant sees nothing');
  assert.throws(()=>tx(()=>letterAction(db,users.external,request,'prepare_letter',{version:2,note:'من كيان آخر'})),code('not_found'));
  assert.throws(()=>tx(()=>saveTemplate(db,users.external,'employment',{body:BODY})),code('not_permitted'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM letter_templates WHERE tenant_id='isolated'").get().n,0);
  assert.ok(verifyAudit(db));
});
