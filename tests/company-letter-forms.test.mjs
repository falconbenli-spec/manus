import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { seedHrDemo } from '../scripts/seed-hr-demo.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { homeBoard } from '../app/home.mjs';
import { PLACEHOLDERS, LANGUAGE_BREAK, placeholdersIn, splitLanguages, templateGap, templatesBoard,
  adoptStarter, approveTemplate, previewLetter, requestLetter, letterAction, letterDocument,
  letterPrintable, lettersBoard } from '../app/letters.mjs';

// ترحيل 156: نصّا خطاب التعريف بالراتب وإشعار الجزاء بصيغة الشركة نفسها، مسودةً تحتاج اعتماد شخص ثانٍ.
const code=value=>error=>error.code===value;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const starterOf=(db,type)=>db.prepare('SELECT body,status_note FROM letter_template_starters WHERE type_code=?').get(type);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-company-letter-forms');seedHrDemo(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.letters.issue',note:'مالك إجراء الخطابات المصطنع'}));
  const draftOf=(who,type)=>templatesBoard(db,who).types.find(x=>x.code===type).draft;
  // النص المبدئي: يتبناه معدّ القوالب (hr) باسمه، ويعتمده شخص آخر يملك الإصدار (manager).
  const publish=type=>{
    tx(()=>adoptStarter(db,users.hr,type,{}));
    tx(()=>approveTemplate(db,users.manager,type,{effective_from:today(),note:'راجعت نص الشركة وأعتمده كمالك إجراء',version:draftOf(users.manager,type).version}));
  };
  const view=(who,id)=>lettersBoard(db,who).requests.find(r=>r.id===id);
  const issue=(id,subject=users.employee)=>{
    tx(()=>letterAction(db,users.hr,id,'prepare_letter',{version:view(users.hr,id).version,note:'طوبق على العقد الساري'}));
    tx(()=>letterAction(db,users.manager,id,'issue_letter',{version:view(users.manager,id).version,note:'صدر عن مالك الإجراء'}));
    return view(subject,id);
  };
  return {db,users,tx,draftOf,publish,view,issue};
}

test('156 — the company form ships as a starter draft whose every placeholder is one the server knows, and nothing is published by the migration',t=>{
  const {db,users,tx,draftOf}=fixture(t);
  const known=new Set(PLACEHOLDERS.map(p=>p.key));
  for(const type of ['salary','discipline_notice']){
    const starter=starterOf(db,type);
    assert.ok(starter,`${type} ships a starter text`);
    const scan=placeholdersIn(starter.body);
    assert.deepEqual(scan.unknown,[],`${type}: no placeholder outside PLACEHOLDERS`);
    assert.equal(scan.stray,false,`${type}: no half-written {{`);
    for(const key of scan.used)assert.ok(known.has(key),`${type}: {{${key}}}`);
    // لا اسم شخص في القالب: سطر التوقيع صفة، وهوية المُصدِر من سجل الإصدار.
    assert.match(starter.body,/مدير رأس المال البشري/,`${type}: the signature line carries the role`);
    for(const person of db.prepare('SELECT name FROM users').all())assert.equal(starter.body.includes(person.name),false,`${type}: ${person.name}`);
  }
  // العناصر المقيّدة بنوعها لا تُقبل في غيره، والخادم هو من يحكم: النصان يمرّان على saveTemplate كما هما.
  const disciplineOnly=PLACEHOLDERS.filter(p=>p.types?.includes('discipline_notice')).map(p=>p.key);
  assert.ok(disciplineOnly.length>=10);
  const notice=starterOf(db,'discipline_notice').body;
  for(const key of ['case_reference','violation_ar','violation_en','violation_date','article','penalty_ar','penalty_en','repeat_penalty_ar','repeat_penalty_en','grievance_days'])
    assert.ok(notice.includes(`{{${key}}}`),`the notice fills ${key} from the decided case`);
  assert.equal(disciplineOnly.some(key=>starterOf(db,'salary').body.includes(`{{${key}}}`)),false,'no discipline placeholder leaks into the salary letter');
  // لا قيمة ثابتة مكان عنصر نائب: نوع المخالفة والجزاء وجزاء التكرار لا تُكتب نصًّا في القالب.
  for(const fixed of ['مخالفة سياسات الشركة','التأخير أو المغادرة باكرًا','السلوك السيء','إنذار رسمي مع خصم','خصم يوم'])
    assert.equal(notice.includes(fixed),false,`the notice hardcodes no penalty or violation: ${fixed}`);
  // الترحيل لا ينشر: القالب مسودة تحتاج اعتماد شخص ثانٍ.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM letter_templates WHERE status='published'").get().n,0);
  for(const type of ['salary','discipline_notice']){
    const row=templatesBoard(db,users.hr).types.find(x=>x.code===type);
    assert.equal(row.published,null,`${type} is not published out of the box`);
    assert.ok(row.actions.includes('adopt_starter'),`${type} is adoptable`);
    assert.match(row.starter.status_note,/تحتاج اعتماد الموارد البشرية/);
  }
  tx(()=>adoptStarter(db,users.hr,'salary',{}));
  assert.equal(draftOf(users.hr,'salary').body,starterOf(db,'salary').body,'adopting copies the starter verbatim into a draft');
  assert.throws(()=>tx(()=>approveTemplate(db,users.hr,'salary',{effective_from:today(),note:'أعتمد ما تبنيته بنفسي',version:draftOf(users.hr,'salary').version})),code('not_permitted'));
  assert.throws(()=>db.prepare("UPDATE letter_template_starters SET body='نص بديل صامت طويل كفاية لتجاوز قيد الطول' WHERE type_code='salary'").run(),/replaced by a new migration/,'the guard trigger is back in place');
  assert.ok(verifyAudit(db));
});

test('156 — the bilingual form splits on the break line, and each side issues in its own language',t=>{
  const {db,users,tx,publish,issue}=fixture(t);
  for(const type of ['salary','discipline_notice']){
    const {ar,en}=splitLanguages(starterOf(db,type).body);
    assert.ok(ar.length>40&&en.length>40,`${type} is bilingual`);
    assert.equal(ar.includes(LANGUAGE_BREAK)||en.includes(LANGUAGE_BREAK),false,`${type}: the break line belongs to neither side`);
    assert.equal(/[؀-ۿ]/.test(en.replace(/\{\{[a-z_]+\}\}/g,'')),false,`${type}: the English side carries no Arabic`);
    assert.equal(/[A-Za-z]/.test(ar.replace(/\{\{[a-z_]+\}\}/g,'').replace(/3,6T/g,'')),false,`${type}: the Arabic side carries no Latin prose`);
  }
  const {ar,en}=splitLanguages(starterOf(db,'salary').body);
  assert.match(ar,/^الموضوع: خطاب تعريف بالراتب/);
  assert.match(ar,/السادة \/ \{\{addressee\}\} المحترمين/);
  assert.match(ar,/السلام عليكم ورحمة الله وبركاته/);
  assert.match(ar,/بهذا نفيد نحن شركة ثلاثمائة وستين درجة/);
  assert.match(ar,/مع أطيب التحيات ،،،،/);
  assert.match(en,/^To: \{\{addressee\}\}/);assert.match(en,/Subject: Salary certificate/);
  publish('salary');
  const e=users.employee;
  // العربية وحدها، والإنجليزية وحدها، والاثنتان: كل جزء يُملأ بقيم لغته.
  const arOnly=previewLetter(db,e,{type_code:'salary',addressee_kind:'bank',addressee_code:'rajhi',language:'ar',salary_detail:'total'});
  assert.match(arOnly.body,/السادة \/ مصرف الراجحي المحترمين/);assert.equal(/Subject/.test(arOnly.body),false);
  const enOnly=previewLetter(db,e,{type_code:'salary',addressee_kind:'bank',addressee_code:'rajhi',language:'en',salary_detail:'total'});
  assert.match(enOnly.body,/To: Al Rajhi Bank/);assert.equal(/السادة/.test(enOnly.body),false);
  const both=previewLetter(db,e,{type_code:'salary',addressee_kind:'bank',addressee_code:'rajhi',language:'both',salary_detail:'total'});
  assert.match(both.body,/السادة \/ مصرف الراجحي المحترمين/);assert.match(both.body,/To: Al Rajhi Bank/);
  assert.equal(both.body.includes(LANGUAGE_BREAK),false,'the break line never reaches the reader');
  assert.deepEqual(both.missing_values,[],'the company form asks for nothing the platform does not hold');
  // الراتب محجوب في المعاينة ويُحسب من العقد الساري يوم الإصدار.
  assert.equal(/\d{1,3},\d{3}\.\d{2}/.test(both.body),false);
  const id=tx(()=>requestLetter(db,e,{type_code:'salary',addressee_kind:'bank',addressee_code:'rajhi',language:'both',salary_detail:'total',purpose:'تمويل شخصي'})).id;
  const done=issue(id);
  assert.match(done.letter.body,/الراتب الأساسي: 8,000\.00 ريال/);
  assert.match(done.letter.body,/بدل السكن: 2,000\.00 ريال/);
  assert.match(done.letter.body,/بدل النقل: 500\.00 ريال/);
  assert.match(done.letter.body,/بدلات أخرى: 0\.00 ريال/,'a row the contract has no component for is a zero, not an empty cell');
  assert.match(done.letter.body,/الراتب الإجمالي: 10,500\.00 ريال/);
  assert.match(done.letter.body,/Basic salary: SAR 8,000\.00/);
  assert.match(done.letter.body,/Total salary: SAR 10,500\.00/);
  assert.equal(done.letter.body.includes(LANGUAGE_BREAK),false);
  const printable=letterPrintable(letterDocument(db,e,done.letter.id));
  assert.match(printable,/مدير رأس المال البشري/);assert.match(printable,/<svg/);
  assert.ok(verifyAudit(db));
});

test('156 — an allowance the active contract does not carry prints zero instead of blocking the letter',t=>{
  const {db,users,tx,publish,issue}=fixture(t);
  publish('salary');
  // موظف عقده بندان فقط (أساسي وسكن) وسياسته تسمح بأربعة: ثلاث خانات في جدول الشركة لا يحملها عقده.
  const officer=users.hr,subject=users.it;
  const {id:policyId}=tx(()=>preparePolicy(db,officer,{kind:'pay_components',title:'بنود راتب تجريبية بأربعة بنود',
    body:'يتكون الراتب الشهري من راتب أساسي وبدل سكن وبدل نقل وبدل آخر بمبالغ شهرية ثابتة بالريال، ويجوز أن يخلو العقد من أي بدل منها.',
    basis:'سياسة عرض تجريبية؛ لا تمثل قرارًا فعليًا للشركة',effective_from:'2026-06-01',parameters:{components:['basic','housing','transport','other_allowance']}}));
  tx(()=>decidePolicy(db,users.manager,policyId,'accept',{note:'قبول تجريبي لسياسة بنود الراتب بأربعة بنود'}));
  const {id:contractId}=tx(()=>prepareContract(db,officer,{user_id:subject.id,contract_type:'indefinite',job_title:'وظيفة مصطنعة ببندين',work_location:'الرياض',
    start_date:'2026-07-01',weekly_hours:40,probation_days:90,notice_days:60,
    pay_lines:[{component:'basic',amount:'7000.00'},{component:'housing',amount:'1750.00'}],document_reference:'عقد تجريبي؛ لا يوجد مستند فعلي'}));
  tx(()=>contractAction(db,officer,contractId,'submit_contract',{version:getContract(db,officer,contractId).version}));
  tx(()=>contractAction(db,users.manager,contractId,'approve_contract',{version:getContract(db,users.manager,contractId).version,note:'اعتماد تجريبي لعقد ببندين'}));
  const p=previewLetter(db,subject,{type_code:'salary',addressee_kind:'to_whom',language:'ar',salary_detail:'total'});
  assert.deepEqual(p.missing_values,[],'an allowance the contract does not carry is not «missing data»');
  assert.deepEqual(p.warnings,[],'and the employee is warned about nothing');
  const id=tx(()=>requestLetter(db,subject,{type_code:'salary',addressee_kind:'to_whom',language:'both',salary_detail:'total'})).id;
  const done=issue(id,subject);
  assert.equal(done.status,'issued','the letter issues; an unearned allowance never blocks it');
  assert.match(done.letter.body,/الراتب الأساسي: 7,000\.00 ريال/);
  assert.match(done.letter.body,/بدل السكن: 1,750\.00 ريال/);
  assert.match(done.letter.body,/بدل النقل: 0\.00 ريال/);
  assert.match(done.letter.body,/بدلات أخرى: 0\.00 ريال/);
  assert.match(done.letter.body,/الراتب الإجمالي: 8,750\.00 ريال/);
  assert.match(done.letter.body,/Transport allowance: SAR 0\.00/);
  assert.match(done.letter.body,/Other allowances: SAR 0\.00/);
  assert.ok(verifyAudit(db));
});

test('156 — adopting the form and having a second person approve it opens the «طلب خطاب» card on the employee home',t=>{
  const {db,users,tx,publish,draftOf}=fixture(t);
  const quick=who=>Object.fromEntries(homeBoard(db,who).quick_actions.map(q=>[q.key,q])).letter;
  assert.equal(quick(users.employee).ready,false);
  assert.equal(quick(users.employee).reason,'لا قالب خطاب معتمد بعد');
  // قبل الاعتماد الفجوة تسمّي الخطوة ومن يملكها، ولا تكتفي بالخبر.
  const before=templateGap(db,'36t','salary');
  assert.equal(before.ready,false);assert.equal(before.step,'adopt_starter');assert.equal(before.has_starter,true);
  tx(()=>adoptStarter(db,users.hr,'salary',{}));
  const mid=templateGap(db,'36t','salary');
  assert.equal(mid.step,'approve_template');assert.equal(mid.capability,'hr.letters.issue');
  assert.equal(mid.who.includes(users.hr.name),false,'whoever wrote the draft is not offered as its approver');
  assert.equal(quick(users.employee).ready,false,'a draft is not a template');
  tx(()=>approveTemplate(db,users.manager,'salary',{effective_from:today(),note:'راجعت نص الشركة وأعتمده كمالك إجراء',version:draftOf(users.manager,'salary').version}));
  assert.equal(templateGap(db,'36t','salary').ready,true);
  assert.equal(quick(users.employee).ready,true,'one published template for an active type opens the card');
  assert.equal(quick(users.employee).link,'#letters/new');
  const board=lettersBoard(db,users.employee);
  const salary=board.types.find(x=>x.code==='salary');
  assert.deepEqual([salary.template_ready,salary.shows_salary,salary.bilingual],[true,true,true]);
  assert.equal(board.types.some(x=>x.code==='discipline_notice'),false,'a letter HR issues is never offered to the employee to request');
  // إشعار الجزاء يُعتمد بالمسار نفسه ولا يفتح للموظف بطاقة طلب.
  publish('discipline_notice');
  assert.equal(templateGap(db,'36t','discipline_notice').ready,true);
  assert.equal(lettersBoard(db,users.employee).types.some(x=>x.code==='discipline_notice'),false);
  assert.ok(verifyAudit(db));
});
