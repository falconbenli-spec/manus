import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { recordMedicalPolicy, recordEnrolment, enrolmentAction, addDependant, coverageOf } from '../app/benefits.mjs';
import { addMonths, monthsAndDays, durationText, evaluateEligibility, myBenefits, benefitsAdmin, submitBenefitRequest, withdrawBenefitRequest, hrDecision, financeDecision,
  handToPayroll, proposeBenefit, decideBenefit, uploadBenefitDocument, downloadBenefitDocument, MATRIX_LABEL } from '../app/benefits-portal.mjs';
import { myBenefitsUI, benefitsAdminUI } from '../app/static/benefits-portal-ui.mjs';
import { notifications } from '../app/workflow.mjs';
import { pinClock } from './riyadh-clock.mjs';

const code=expected=>error=>error.code===expected;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day=n=>new Date(Date.parse(today()+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const PDF=Buffer.from('%PDF-1.4\n% synthetic benefits test document\n').toString('base64');
const PDF2=Buffer.from('%PDF-1.4\n% another synthetic document\n').toString('base64');
const BIRTH='2019-06-17';

// الترحيل 099 (فرع الحضور) يجعل قيد موضوع الإشعار شرط شكل. على فرع لم يُدمج فيه بعد، يُطبَّق الشكل نفسه في الاختبار فقط
// ليُتحقق من نص الإشعارات؛ بعد الدمج لا يفعل شيئًا لأن موضوعات المزايا مقبولة أصلًا.
function ensureNotificationShape(db){
  db.exec('SAVEPOINT probe');
  let ok=true;
  try{db.prepare("INSERT INTO notifications(id,user_id,request_id,kind,created_at,subject_kind,subject_id,title) VALUES('probe','employee',NULL,'probe',?,'benefit_request','x','probe')").run(now());}catch{ok=false;}
  db.exec('ROLLBACK TO probe');db.exec('RELEASE probe');
  if(ok)return;
  const columns=db.prepare('PRAGMA table_info(notifications)').all().map(c=>c.name).join(',');
  db.exec(`ALTER TABLE notifications RENAME TO notifications_probe;
    CREATE TABLE notifications (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),request_id TEXT REFERENCES requests(id),kind TEXT NOT NULL,read_at TEXT,created_at TEXT NOT NULL,
      subject_kind TEXT,subject_id TEXT,title TEXT,body TEXT,
      CHECK(request_id IS NOT NULL OR (subject_kind IS NOT NULL AND subject_id IS NOT NULL AND length(trim(title))>0)),
      CHECK(subject_kind IS NULL OR (length(subject_kind) BETWEEN 3 AND 40 AND subject_kind NOT GLOB '*[^a-z_]*'))) STRICT;
    INSERT INTO notifications(${columns}) SELECT ${columns} FROM notifications_probe;DROP TABLE notifications_probe;`);
}

function fixture(t,{joinMonthsAgo=13,gender='female',nationality='saudi'}={}){
  const db=openDb(':memory:');seed(db,'synthetic-benefits-portal');t.after(()=>db.close());
  ensureNotificationShape(db);
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=run=>transaction(db,run);
  const grant=(who,capability)=>tx(()=>grantAccess(db,users.admin,{user_id:who,capability,department_id:null,note:'منح اختبار'}));
  // مدير الموارد البشرية المعتمِد: manager. التأكيد المالي: it. مسؤول المزايا ومُعد الرواتب: hr (افتراضيًا بدوره).
  grant('manager','hr.policy.accept');grant('it','benefits.finance.confirm');
  const time=now();
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('pol-1','36t','pay_components','بنود الراتب','سياسة بنود راتب تجريبية للاختبار فقط','{\"components\":[\"basic\",\"housing\",\"transport\"]}','مصدر تجريبي للاختبار','2020-01-01','accepted','hr','manager',?,?)").run(time,time);
  const contract=(who,start,lines)=>db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES(?,'36t',?,'pol-1','indefinite','وظيفة تجريبية','الرياض',?,40,90,30,?,?,'SAR','مرجع عقد تجريبي','active','hr','manager',?,?,?)")
    .run('c-'+who,who,start,JSON.stringify(lines),lines.reduce((n,l)=>n+l.amount_minor,0),time,time,time);
  const join=addMonths(today(),-joinMonthsAgo);
  contract('employee',join,[{component:'basic',amount_minor:1000000},{component:'housing',amount_minor:250000},{component:'transport',amount_minor:100000}]);
  db.prepare("INSERT INTO employee_profiles(user_id,tenant_id,job_title,employment_type,join_date,updated_by,updated_at) VALUES('employee','36t','وظيفة تجريبية','full_time',?,'hr',?)").run(join,time);
  db.prepare("INSERT INTO employee_demographics(user_id,tenant_id,nationality_group,gender,source,recorded_by,updated_at) VALUES('employee','36t',?,?,'سجل اختبار','hr',?)").run(nationality,gender,time);
  const policyId=tx(()=>recordMedicalPolicy(db,users.hr,{insurer_name:'شركة تأمين مصطنعة',policy_number:'SYN-778899',effective_from:day(-200),effective_to:day(200),tiers:['فئة ب','فئة أ','فئة VIP'],renewal_notice_days:30,note:''})).id;
  const enrolmentId=tx(()=>recordEnrolment(db,users.hr,{policy_id:policyId,employee_id:'employee',tier:'فئة ب',requested_on:day(-30)})).id;
  tx(()=>enrolmentAction(db,users.hr,enrolmentId,'confirm_enrolment',{version:1,confirmed_on:day(-20),member_reference:'MEM-55501234'}));
  const catalogId=key=>db.prepare("SELECT id,version FROM benefit_catalog WHERE tenant_id='36t' AND benefit_key=? AND status='draft'").get(key);
  const accept=(key,note='')=>{const row=catalogId(key);return tx(()=>decideBenefit(db,users.manager,row.id,'accept',{version:row.version,effective_from:day(-1),...(note?{note}:{})}));};
  const submit=(who,option,details,extra={})=>tx(()=>submitBenefitRequest(db,users[who],{option,details,...extra}));
  const request=id=>db.prepare('SELECT * FROM benefit_requests WHERE id=?').get(id);
  const hr=(id,decision,input,who='hr')=>tx(()=>hrDecision(db,users[who],id,decision,{version:request(id).version,...input}));
  const fin=(id,decision,input={},who='it')=>tx(()=>financeDecision(db,users[who],id,decision,{version:request(id).version,...input}));
  const noticesFor=(who,subject)=>db.prepare('SELECT * FROM notifications WHERE user_id=? AND subject_kind=? ORDER BY created_at').all(who,subject);
  return {db,users,tx,grant,policyId,enrolmentId,catalogId,accept,submit,request,hr,fin,noticesFor,join};
}

test('eligibility: tenure is counted in calendar months, month ends clamp, and the day before the boundary is not yet eligible',()=>{
  assert.equal(addMonths('2026-03-19',6),'2026-09-19');
  assert.equal(addMonths('2026-08-31',6),'2027-02-28','a month-end join date clamps to the last day of the target month');
  assert.equal(addMonths('2028-02-29',12),'2029-02-28');
  assert.equal(addMonths('2026-01-31',1),'2026-02-28');
  assert.equal(addMonths('2026-09-19',-13),'2025-08-19');
  const facts={join_date:'2026-03-19',nationality:'saudi',gender:'female',contract_type:'indefinite',employment_type:'full_time',probation_end:'2026-06-17'};
  const six={min_tenure_months:6};
  const before=evaluateEligibility(six,facts,'2026-09-18');
  assert.equal(before.state,'upcoming');assert.equal(before.eligible_from,'2026-09-19');
  assert.deepEqual(before.wait,{months:0,days:1});
  assert.match(before.text,/تصبح مؤهلًا بعد يوم/);
  assert.equal(evaluateEligibility(six,facts,'2026-09-19').state,'eligible','eligible on the boundary day itself');
  assert.equal(evaluateEligibility(six,facts,'2026-09-20').state,'eligible');
  const clamp=evaluateEligibility(six,{...facts,join_date:'2026-08-31'},'2027-02-27');
  assert.equal(clamp.state,'upcoming');assert.equal(clamp.eligible_from,'2027-02-28');
  assert.equal(evaluateEligibility(six,{...facts,join_date:'2026-08-31'},'2027-02-28').state,'eligible');
  const four=evaluateEligibility(six,{...facts,join_date:'2026-07-19'},'2026-09-19');
  assert.deepEqual(four.wait,{months:4,days:0});
  assert.match(four.text,/^تصبح مؤهلًا بعد 4 أشهر \(في 19 يناير 2027\)$/);
  assert.equal(durationText({months:1,days:0}),'شهر');assert.equal(durationText({months:2,days:0}),'شهرين');
  assert.equal(durationText({months:11,days:0}),'11 شهرًا');assert.equal(durationText({months:4,days:6}),'4 أشهر و6 أيام');
  assert.deepEqual(monthsAndDays('2026-01-31','2026-03-01'),{months:1,days:1});
  // ما يمنع صراحة يسبق ما ينقص: غير السعودي لا ينطبق عليه دعم التدريب (م42) ولو نقص تاريخ التحاقه.
  assert.equal(evaluateEligibility({nationality:'saudi',min_tenure_months:3},{...facts,nationality:'non_saudi',join_date:null},'2026-09-19').state,'not_eligible');
  const missing=evaluateEligibility(six,{...facts,join_date:null},'2026-09-19');
  assert.equal(missing.state,'unknown');assert.match(missing.text,/تاريخ الالتحاق/);
  assert.equal(evaluateEligibility({gender:'female',event:'childbirth'},facts,'2026-09-19').state,'on_event');
  assert.equal(evaluateEligibility({gender:'female',event:'childbirth'},{...facts,gender:'male'},'2026-09-19').state,'not_eligible');
  assert.equal(evaluateEligibility({grades:['G5']},facts,'2026-09-19').state,'unknown','no grade record exists in the platform, so a grade rule cannot pass silently');
  assert.equal(evaluateEligibility({contract_types:['fixed_term']},facts,'2026-09-19').state,'not_eligible');
});

test('the employee view: what I have from the contract, my insurance with masked numbers, and when I become eligible',t=>{
  const {db,users}=fixture(t,{joinMonthsAgo:2});
  const view=myBenefits(db,users.employee);
  assert.equal(view.viewing_self,true);
  assert.deepEqual(view.allowances.lines.map(l=>[l.component,l.amount_minor]),[['basic',1000000],['housing',250000],['transport',100000]]);
  assert.equal(view.allowance_notes.length,0,'housing equals 25% of basic, so no mismatch note');
  const card=key=>view.benefits.find(b=>b.key===key);
  assert.equal(card('housing').state,'held');assert.match(card('housing').held_text,/2,500\.00 ريال/);
  assert.match(card('housing').value_text,/25% من الأجر الأساسي/);
  assert.match(card('housing').citation,/م67/);
  assert.equal(card('medical_insurance').state,'held');
  const ticket=card('air_ticket');
  assert.equal(ticket.state,'upcoming');
  assert.match(ticket.eligibility.text,/^تصبح مؤهلًا بعد (10 أشهر|9 أشهر و\d+ (أيام|يومًا|يومين|يوم))/);
  assert.equal(ticket.accepted,false);assert.match(ticket.draft_warning,/مسودة/);
  assert.equal(card('nursing_hour').state,'on_event');
  assert.equal(card('training_support').state,'eligible');
  // مسودات المصفوفة (تأمين الوالدين، التعليم، النادي) لا تُعرض على الموظف قبل اعتمادها.
  assert.equal(view.hidden_pending_count,3);
  assert.equal(view.benefits.some(b=>b.matrix_label),false);
  assert.equal(view.insurance.tier,'فئة ب');
  assert.equal(view.insurance.policy_number_masked,'••••8899');assert.equal(view.insurance.member_reference_masked,'••••1234');
  assert.equal(JSON.stringify(view).includes('SYN-778899'),false,'the full policy number is not sent to the employee');
  assert.equal(JSON.stringify(view).includes('MEM-55501234'),false);
  // HR sees the placeholders with their matrix label.
  const hrView=myBenefits(db,users.hr,'employee');
  assert.equal(hrView.benefits.filter(b=>b.matrix_label===MATRIX_LABEL).length,3);
  assert.equal(hrView.options.length,0,'HR looking at an employee does not get the employee request options');
});

test('privacy: only the employee and the benefits capability see «مزاياي», dependants and benefit documents',t=>{
  const {db,users,submit,hr,tx}=fixture(t);
  const id=submit('employee','dependant_add',{relation:'child',birth_date:BIRTH},{document:{filename:'birth.pdf',content:PDF,label:'شهادة ميلاد'}}).id;
  hr(id,'approve',{added_on:day(-1)});
  for(const who of ['manager','outsider','it','external'])
    assert.throws(()=>myBenefits(db,users[who],'employee'),code('not_found'),who);
  const own=myBenefits(db,users.employee);
  assert.equal(own.insurance.dependants.length,1);assert.equal(own.insurance.dependants[0].birth_date,BIRTH);
  assert.equal(JSON.stringify(myBenefits(db,users.outsider)).includes(BIRTH),false,'another employee sees nothing of it in their own view');
  assert.throws(()=>coverageOf(db,users.outsider,'employee'),code('not_found'));
  // الشاشة الإدارية: الموظف العادي ممنوع، والمالية لا ترى تفاصيل التابع ولا مصفوفة الأهلية.
  assert.throws(()=>benefitsAdmin(db,users.outsider),code('not_permitted'));
  const finance=benefitsAdmin(db,users.it);
  assert.equal(finance.matrix,null);assert.equal(JSON.stringify(finance).includes(BIRTH),false);
  assert.equal(benefitsAdmin(db,users.hr).queue.recent[0].details.birth_date,BIRTH);
  const docId=db.prepare('SELECT id FROM benefit_documents LIMIT 1').get().id;
  for(const who of ['outsider','manager','it'])assert.throws(()=>tx(()=>downloadBenefitDocument(db,users[who],docId)),code('not_found'),who);
  assert.equal(tx(()=>downloadBenefitDocument(db,users.employee,docId)).filename,'birth.pdf');
  assert.equal(tx(()=>downloadBenefitDocument(db,users.hr,docId)).media_type,'application/pdf');
  // تاريخ الميلاد لا يدخل سجل التدقيق المشترك، والوحدة الجديدة لا تقرأ جدول التابعين مباشرة.
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM audit_events').all()).includes(BIRTH),false);
  assert.equal(readFileSync(new URL('../app/benefits-portal.mjs',import.meta.url),'utf8').includes('medical_'+'dependants'),false);
  assert.equal(verifyAudit(db),true);
});

test('dependant add and remove: the employee requests, HR confirms, and medical dependants are updated through benefits.mjs',t=>{
  const {db,users,submit,hr,request,enrolmentId,noticesFor,tx}=fixture(t);
  assert.throws(()=>submit('employee','dependant_add',{relation:'child',birth_date:BIRTH}),code('document_required'));
  assert.throws(()=>submit('employee','dependant_add',{relation:'parent',birth_date:'1960-01-01'},{document:{filename:'p.pdf',content:PDF}}),code('relation'),'parents only once the parents-insurance benefit is accepted');
  assert.throws(()=>submit('employee','dependant_add',{relation:'child',birth_date:BIRTH,document_reference:'1098765432'},{document:{filename:'b.pdf',content:PDF}}),code('full_identifier'));
  assert.throws(()=>submit('employee','dependant_add',{relation:'child',birth_date:day(3)},{document:{filename:'b.pdf',content:PDF}}),code('future_date'));
  assert.throws(()=>submit('outsider','dependant_add',{relation:'child',birth_date:BIRTH},{document:{filename:'b.pdf',content:PDF}}),code('option_unavailable'),'no enrolment, no dependant');
  const add=submit('employee','dependant_add',{relation:'spouse',birth_date:'1994-02-02',document_reference:'عقد زواج — آخر أربعة 4411'},{document:{filename:'marriage.pdf',content:PDF,label:'عقد الزواج'}});
  assert.match(add.reference,/^BEN-\d{4}-0001$/);
  assert.equal(request(add.id).status,'pending_hr');
  assert.equal(coverageOf(db,users.employee,'employee').dependants.length,0,'nothing changes before HR confirms');
  assert.equal(noticesFor('employee','benefit_request').length,1);
  assert.equal(noticesFor('hr','benefit_review').length,1);
  assert.throws(()=>hr(add.id,'approve',{added_on:day(-1)},'outsider'),code('not_permitted'));
  hr(add.id,'approve',{added_on:day(-1)});
  const done=request(add.id);
  assert.equal(done.status,'completed');
  const cover=coverageOf(db,users.employee,'employee');
  assert.equal(cover.dependants.length,1);assert.equal(cover.dependants[0].relation,'spouse');assert.equal(cover.enrolment_id,enrolmentId);
  assert.equal(JSON.parse(done.outcome).dependant_id,cover.dependants[0].id);
  assert.match(noticesFor('employee','benefit_request').at(-1).title,/اكتمل طلبك «إضافة تابع إلى التأمين»/);
  const view=myBenefits(db,users.employee);
  const remove=view.options.find(o=>o.key==='dependant_remove');
  assert.equal(remove.available,true);
  const rm=submit('employee','dependant_remove',{dependant_id:cover.dependants[0].id,reason:'divorce',effective_date:day(-1)});
  hr(rm.id,'approve',{removed_on:day(0)});
  assert.equal(coverageOf(db,users.employee,'employee').dependants[0].removed_on,day(0));
  assert.equal(request(rm.id).status,'completed');
  // HR rejects with a reason the employee reads.
  const third=submit('employee','dependant_add',{relation:'child',birth_date:BIRTH},{document:{filename:'b.pdf',content:PDF2}});
  assert.throws(()=>hr(third.id,'reject',{note:'x'}),code('invalid_text'));
  hr(third.id,'reject',{note:'شهادة الميلاد غير مقروءة؛ أرفق نسخة أوضح'});
  assert.equal(myBenefits(db,users.employee).requests.find(r=>r.id===third.id).hr_note,'شهادة الميلاد غير مقروءة؛ أرفق نسخة أوضح');
  // WIRING-SPEC §8.3: معرّف المسار يحكم؛ جسم يحمل تسجيلًا آخر مرفوض.
  assert.throws(()=>tx(()=>addDependant(db,users.hr,{enrolment_id:'00000000-0000-4000-8000-000000000000',relation:'child',birth_date:BIRTH,added_on:day(-1)},enrolmentId)),code('id_mismatch'));
  const viaPath=tx(()=>addDependant(db,users.hr,{relation:'child',birth_date:BIRTH,added_on:day(-1)},enrolmentId));
  assert.ok(coverageOf(db,users.hr,'employee').dependants.some(d=>d.id===viaPath.id));
  assert.equal(verifyAudit(db),true);
});

test('HR never decides their own benefit request, and the employee can withdraw only while it is pending',t=>{
  const {db,users,submit,hr,request,tx}=fixture(t);
  const own=submit('hr','benefit_letter',{purpose:'bank',addressee:'بنك تجريبي',language:'ar'});
  assert.throws(()=>hr(own.id,'approve',{letter_reference:'L-1'}),code('separation_of_duties'));
  const letter=submit('employee','benefit_letter',{purpose:'insurance_proof',addressee:'سفارة تجريبية',language:'en'});
  assert.throws(()=>tx(()=>withdrawBenefitRequest(db,users.outsider,letter.id,{version:1})),code('not_found'));
  tx(()=>withdrawBenefitRequest(db,users.employee,letter.id,{version:1}));
  assert.equal(request(letter.id).status,'withdrawn');
  assert.throws(()=>hr(letter.id,'approve',{letter_reference:'L-2'}),code('action_unavailable'));
  assert.throws(()=>db.prepare("UPDATE benefit_requests SET status='pending_hr',version=version+1 WHERE id=?").run(letter.id),/final/);
  const second=submit('employee','benefit_letter',{purpose:'bank',addressee:'بنك تجريبي',language:'ar'});
  hr(second.id,'approve',{letter_reference:'HR-LTR-2026-17'});
  tx(()=>uploadBenefitDocument(db,users.hr,{owner_kind:'request',owner_id:second.id,label:'خطاب المزايا الصادر',filename:'letter.pdf',content:PDF}));
  assert.equal(myBenefits(db,users.employee).requests.find(r=>r.id===second.id).documents.length,1);
  assert.throws(()=>tx(()=>uploadBenefitDocument(db,users.employee,{owner_kind:'request',owner_id:second.id,label:'ملف',filename:'x.pdf',content:PDF2})),code('action_unavailable'));
  assert.throws(()=>tx(()=>uploadBenefitDocument(db,users.employee,{owner_kind:'request',owner_id:second.id,label:'ملف',filename:'x.png',content:Buffer.from('not an image').toString('base64')})),code('action_unavailable'));
});

test('draft until accepted: nothing is claimable from a draft, the proposer never accepts, and the matrix needs a written basis',t=>{
  const {db,users,submit,catalogId,accept,tx,grant,noticesFor}=fixture(t);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM benefit_catalog WHERE tenant_id='36t' AND status<>'draft'").get().n,0,'every seeded benefit starts as a draft');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM benefit_catalog WHERE tenant_id='isolated'").get().n,13,'a tenant gets its own drafts');
  assert.throws(()=>submit('employee','ticket_claim',{mode:'cash',destination:'القاهرة',travel_from:day(30)}),code('benefit_not_accepted'));
  assert.throws(()=>submit('employee','class_upgrade',{target_tier:'فئة أ',consent:true}),code('benefit_not_accepted'));
  // hr يقترح مراجعة لتذكرة السفر ويحمل صلاحية الاعتماد أيضًا: لا يعتمد ما اقترحه.
  grant('hr','hr.policy.accept');
  const draft=catalogId('air_ticket'),row=db.prepare('SELECT * FROM benefit_catalog WHERE id=?').get(draft.id);
  tx(()=>proposeBenefit(db,users.hr,'air_ticket',{version:draft.version,name:row.name,summary:row.summary,source_kind:'regulation',article:'م39، م41',source_note:row.source_note,
    rules:{min_tenure_months:12,contract_clause:true},value_basis:'policy',value_params:{cash_equivalent:true},frequency:'annual',claim_method:'request',documents:['موافقة الإجازة'],change_note:'اعتماد سنة خدمة قبل أول تذكرة كما أقرها المالك'}));
  assert.equal(noticesFor('manager','benefit_catalog').length,1,'the HR manager is told a benefit awaits acceptance');
  const proposed=catalogId('air_ticket');
  assert.throws(()=>tx(()=>decideBenefit(db,users.hr,proposed.id,'accept',{version:proposed.version,effective_from:day(0)})),code('separation_of_duties'));
  assert.throws(()=>db.prepare("UPDATE benefit_catalog SET status='accepted',decided_by='hr',decided_at='x',effective_from='2026-01-01',version=version+1 WHERE id=?").run(proposed.id),/CHECK constraint failed/,'the schema refuses self-acceptance too');
  assert.throws(()=>tx(()=>decideBenefit(db,users.it,proposed.id,'accept',{version:proposed.version,effective_from:day(0)})),code('not_permitted'));
  accept('air_ticket');
  const accepted=db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id='36t' AND benefit_key='air_ticket' AND status='accepted'").get();
  assert.equal(accepted.proposed_by,'hr');assert.equal(accepted.decided_by,'manager');
  assert.throws(()=>db.prepare("UPDATE benefit_catalog SET name='تعديل',version=version+1 WHERE id=?").run(accepted.id),/replaced by a new revision/);
  assert.equal(submit('employee','ticket_claim',{mode:'cash',destination:'القاهرة',travel_from:day(30)}).reference.startsWith('BEN-'),true,'claimable once accepted');
  // ما أحالته اللائحة إلى المصفوفة لا يُعتمد بلا سند مكتوب.
  const edu=catalogId('children_education');
  assert.throws(()=>tx(()=>decideBenefit(db,users.manager,edu.id,'accept',{version:edu.version,effective_from:day(0)})),code('decision_note'));
  accept('children_education','مصفوفة المزايا المعتمدة من المالك بتاريخ اختبار');
  assert.equal(myBenefits(db,users.employee).hidden_pending_count,2);
  // مراجعة أحدث تستبدل المعتمدة ولا تعدّلها.
  const acc=db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id='36t' AND benefit_key='housing'").get();
  accept('housing');
  tx(()=>proposeBenefit(db,users.hr,'housing',{name:acc.name,summary:acc.summary,source_kind:'regulation',article:acc.article,source_note:acc.source_note,rules:{past_probation:true},value_basis:'percent_of_basic',value_params:{percent:25},frequency:'monthly',claim_method:'automatic',documents:[],change_note:'صرف مقدم بعد فترة التجربة (م67/1)'}));
  accept('housing');
  assert.deepEqual(db.prepare("SELECT revision,status FROM benefit_catalog WHERE tenant_id='36t' AND benefit_key='housing' ORDER BY revision").all().map(r=>[r.revision,r.status]),[[1,'retired'],[2,'accepted']]);
  assert.throws(()=>db.prepare("DELETE FROM benefit_catalog WHERE id=?").run(acc.id),/retained/);
  assert.equal(verifyAudit(db),true);
});

test('ticket claim chain: employee, then HR sets the class and amount, then a different person in finance confirms; money is only proposed',t=>{
  const {db,users,submit,hr,fin,request,accept,noticesFor,tx,grant}=fixture(t);
  accept('air_ticket');
  grant('hr','benefits.finance.confirm');
  const before=Object.fromEntries(['payroll_adjustments','payroll_runs','salary_advances','expense_claims'].map(tb=>[tb,db.prepare(`SELECT COUNT(*) AS n FROM ${tb}`).get().n]));
  const claim=submit('employee','ticket_claim',{mode:'cash',destination:'عمّان',travel_from:day(40),travel_to:day(55)},{document:{filename:'leave.pdf',content:PDF}});
  assert.throws(()=>submit('employee','ticket_claim',{mode:'cash',destination:'عمّان',travel_from:day(60)}),code('option_unavailable'),'one ticket claim a year');
  assert.throws(()=>fin(claim.id,'approve'),code('action_unavailable'),'finance cannot act before HR');
  assert.throws(()=>hr(claim.id,'approve',{travel_class:'first',amount:'2400.00'}),code('travel_class'));
  hr(claim.id,'approve',{travel_class:'staff',amount:'2400.00',note:'درجة الضيافة بحسب م41'});
  assert.equal(request(claim.id).status,'pending_finance');
  assert.equal(noticesFor('it','benefit_review').length,1,'finance is told');
  assert.equal(noticesFor('hr','benefit_review').filter(n=>n.kind==='benefit_finance_needed').length,0,'the HR decider is not asked to confirm their own decision');
  assert.throws(()=>fin(claim.id,'approve',{},'hr'),code('separation_of_duties'));
  assert.throws(()=>fin(claim.id,'approve',{},'outsider'),code('not_permitted'));
  const financeView=benefitsAdmin(db,users.it);
  assert.equal(financeView.queue.finance.length,1);assert.deepEqual(financeView.queue.finance[0].actions,['finance_approve','finance_reject']);
  assert.equal(financeView.queue.finance[0].documents.length,1,'finance reads the supporting document of a money claim');
  const result=fin(claim.id,'approve',{note:'مطابق لعرض السعر'});
  const done=request(claim.id);
  assert.equal(done.status,'completed');assert.equal(done.amount_minor,240000);
  const proposal=db.prepare('SELECT * FROM benefit_payout_proposals WHERE id=?').get(result.proposal_id);
  assert.equal(proposal.target,'payroll_addition');assert.equal(proposal.status,'proposed');assert.equal(proposal.amount_minor,240000);
  // لا شيء صُرف: لا حركة رواتب ولا مسير ولا مطالبة مصروفات أُنشئت، ولا حالة «صُرف» ممكنة.
  for(const [tb,n] of Object.entries(before))assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${tb}`).get().n,n,tb);
  assert.throws(()=>db.prepare("UPDATE benefit_payout_proposals SET status='paid',version=version+1 WHERE id=?").run(proposal.id),/handed over or withdrawn once|CHECK constraint failed/);
  assert.throws(()=>db.prepare("INSERT INTO benefit_payout_proposals(id,tenant_id,request_id,employee_id,target,amount_minor,status,payroll_adjustment_id,proposed_by,created_at) VALUES('x','36t',?,'employee','payroll_addition',1,'handed_to_payroll','y','it',?)").run(claim.id,now()),/only ever proposed/);
  assert.match(noticesFor('employee','benefit_request').at(-1).body,/مقترح للمسير ولم يُصرف/);
  assert.equal(noticesFor('employee','benefit_request').some(n=>/2,?400/.test(n.title+n.body)),false,'notices carry no amounts');
  // التسليم إلى حركات الرواتب: حركة «مقترحة» يعتمدها معتمد الرواتب هناك، لا اعتماد ولا صرف هنا.
  assert.throws(()=>tx(()=>handToPayroll(db,users.it,proposal.id,{version:1,month:'2099-01'})),code('not_permitted'));
  const handed=tx(()=>handToPayroll(db,users.hr,proposal.id,{version:1,month:'2099-01'}));
  const adjustment=db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(handed.payroll_adjustment_id);
  assert.equal(adjustment.status,'proposed');assert.equal(adjustment.kind,'allowance');assert.equal(adjustment.amount_minor,240000);assert.equal(adjustment.user_id,'employee');
  assert.equal(db.prepare('SELECT status FROM benefit_payout_proposals WHERE id=?').get(proposal.id).status,'handed_to_payroll');
  assert.throws(()=>tx(()=>handToPayroll(db,users.hr,proposal.id,{version:2,month:'2099-02'})),code('action_unavailable'));
  // حجز التذكرة مصروف على الشركة، لا حركة في المسير.
  db.prepare("UPDATE employee_profiles SET join_date=? WHERE user_id='employee'").run(addMonths(today(),-30));
  const view=myBenefits(db,users.employee);
  assert.equal(view.options.find(o=>o.key==='ticket_claim').available,false);
  assert.equal(verifyAudit(db),true);
});

test('the ticket option waits for tenure, and class upgrade and education follow the accepted policy only',t=>{
  const {db,users,submit,hr,fin,request,accept,tx,catalogId}=fixture(t,{joinMonthsAgo:5});
  accept('air_ticket');
  const ticket=myBenefits(db,users.employee).options.find(o=>o.key==='ticket_claim');
  assert.equal(ticket.available,false);assert.match(ticket.reason,/تصبح مؤهلًا بعد/);
  assert.throws(()=>submit('employee','ticket_claim',{mode:'ticket',destination:'جدة',travel_from:day(10)}),code('option_unavailable'));
  // الترقية على حساب الموظف: معتمدة في المسودة الأولى بـ«لا»، فتبقى غير متاحة حتى تُعتمد مراجعة تسمح بها.
  accept('medical_insurance');
  assert.throws(()=>submit('employee','class_upgrade',{target_tier:'فئة أ',consent:true}),code('option_unavailable'));
  const row=db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id='36t' AND benefit_key='medical_insurance' AND status='accepted'").get();
  tx(()=>proposeBenefit(db,users.hr,'medical_insurance',{name:row.name,summary:row.summary,source_kind:'regulation',article:row.article,source_note:row.source_note,rules:{},value_basis:'policy',
    value_params:{text:'فئة ب لكل الموظفين؛ الترقية على حساب الموظف',upgrade_at_employee_cost:true},frequency:'policy_term',claim_method:'enrolment',documents:[],change_note:'السماح بالترقية على حساب الموظف بقرار المالك'}));
  accept('medical_insurance');
  assert.throws(()=>submit('employee','class_upgrade',{target_tier:'فئة أ',consent:false}),code('consent'));
  assert.throws(()=>submit('employee','class_upgrade',{target_tier:'فئة ب',consent:true}),code('tier'),'the current tier is not an upgrade');
  const up=submit('employee','class_upgrade',{target_tier:'فئة أ',consent:true});
  hr(up.id,'approve',{amount:'1800.00'});fin(up.id,'approve');
  assert.equal(db.prepare('SELECT target FROM benefit_payout_proposals WHERE request_id=?').get(up.id).target,'payroll_deduction');
  // بدل التعليم: مسودة مصفوفة حتى يعتمدها المالك، ثم تنتظر ستة أشهر خدمة (موظف له خمسة).
  assert.throws(()=>submit('employee','education_claim',{stage:'ابتدائي',school:'مدرسة تجريبية',academic_year:'2026-2027',invoice_amount:'9000'},{document:{filename:'i.pdf',content:PDF}}),code('benefit_not_accepted'));
  accept('children_education','قرار المالك في اختبار: سقف 10000 ريال لكل طفل');
  assert.throws(()=>submit('employee','education_claim',{stage:'ابتدائي',school:'مدرسة تجريبية',academic_year:'2026-2027',invoice_amount:'9000'},{document:{filename:'i.pdf',content:PDF}}),code('option_unavailable'));
  db.prepare("UPDATE employee_profiles SET join_date=? WHERE user_id='employee'").run(addMonths(today(),-6));
  assert.throws(()=>submit('employee','education_claim',{stage:'ابتدائي',school:'مدرسة تجريبية',academic_year:'2026-2028',invoice_amount:'9000'},{document:{filename:'i.pdf',content:PDF}}),code('academic_year'));
  const edu=submit('employee','education_claim',{stage:'ابتدائي',school:'مدرسة تجريبية',academic_year:'2026-2027',invoice_amount:'9000'},{document:{filename:'i.pdf',content:PDF}});
  assert.throws(()=>hr(edu.id,'approve',{amount:'9500.00'}),code('amount_over_invoice'));
  hr(edu.id,'approve',{amount:'9000.00'});
  fin(edu.id,'reject',{note:'تجاوز السقف السنوي المعتمد'});
  assert.equal(request(edu.id).status,'rejected');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM benefit_payout_proposals WHERE request_id=?').get(edu.id).n,0,'a rejected claim proposes nothing');
  assert.equal(catalogId('children_education'),undefined);
});

test('the screens render for every role without undefined values or inline styles, and every offered button opens a usable form',t=>{
  const {db,users,submit,hr,accept}=fixture(t);
  accept('air_ticket');accept('medical_insurance');
  const a=submit('employee','ticket_claim',{mode:'cash',destination:'دبي',travel_from:day(20)});hr(a.id,'approve',{travel_class:'staff',amount:'1500.00'});
  submit('employee','dependant_add',{relation:'child',birth_date:BIRTH},{document:{filename:'b.pdf',content:PDF}});
  const money=v=>v===null||v===undefined?'—':`${(v/100).toFixed(2)} SAR`;
  const check=(ui,data,who)=>{
    const buttons=[];
    const html=ui.render(data,{e,money,button:(action,id,label)=>{buttons.push([action,id]);return `<button>${e(label)}</button>`;}});
    assert.equal(/\bundefined\b|\bNaN\b|\[object /.test(html.replace(/<[^>]+>/g,' ')),false,who);
    assert.equal(/ style=|<script/.test(html),false,`${who}: no inline styles and no scripts under the strict CSP`);
    for(const [action,id] of buttons){
      const spec=ui.form(action,id,data);
      assert.ok(spec.title&&spec.endpoint&&Array.isArray(spec.fields)&&typeof spec.toPayload==='function',`${who}/${action}`);
    }
    return {html,buttons};
  };
  for(const who of ['employee','outsider','hr','manager','it'])check(myBenefitsUI,myBenefits(db,users[who]),who);
  const own=check(myBenefitsUI,myBenefits(db,users.employee),'employee');
  assert.ok(own.buttons.some(([a,id])=>a==='request_option'&&id==='dependant_add'));
  assert.match(own.html,/يحتاج|مسودة/);
  for(const who of ['hr','manager','it']){
    const {buttons}=check(benefitsAdminUI,benefitsAdmin(db,users[who]),who);
    if(who==='hr')assert.ok(buttons.some(([a])=>a==='hr_approve')&&buttons.some(([a])=>a==='propose_benefit'));
    if(who==='manager')assert.ok(buttons.some(([a])=>a==='accept_benefit'));
    if(who==='it')assert.ok(buttons.some(([a])=>a==='finance_approve'));
  }
  // النموذج يبني حمولة يقبلها الخادم.
  const data=myBenefits(db,users.employee),spec=myBenefitsUI.form('request_option','benefit_letter',data);
  const payload=spec.toPayload({purpose:'bank',addressee:'بنك تجريبي',language:'ar'});
  assert.deepEqual(payload,{option:'benefit_letter',details:{purpose:'bank',addressee:'بنك تجريبي',language:'ar'}});
  const admin=benefitsAdmin(db,users.hr),propose=benefitsAdminUI.form('propose_benefit','gym',admin);
  const body=propose.toPayload({name:'اشتراك النادي الرياضي',summary:'مساهمة شهرية في اشتراك نادٍ رياضي معتمد.',source_kind:'needs_matrix',article:'',source_note:'قرار المالك في اختبار الواجهة',min_tenure_months:'6',nationality:'',gender:'',contract_types:[],past_probation:'no',contract_clause:'no',event:'',value_basis:'policy',percent:'',months:'',amount:'',value_text:'حتى 200 ريال شهريًا',frequency:'monthly',claim_method:'informational',documents:[{doc:'إيصال الاشتراك'}],change_note:'مقترح من الواجهة للاختبار'});
  const saved=transaction(db,()=>proposeBenefit(db,users.hr,'gym',body));
  assert.ok(saved.id);
});

test('notifications open the right screen and the unread list reads them',t=>{
  const {db,users,submit}=fixture(t);
  submit('employee','benefit_letter',{purpose:'bank',addressee:'بنك تجريبي',language:'ar'});
  const mine=notifications(db,users.employee).filter(n=>n.subject_kind==='benefit_request');
  assert.equal(mine.length,1);assert.equal(mine[0].link,'#my-benefits');assert.match(mine[0].title,/^استلمنا طلبك «خطاب بالمزايا» BEN-/);
  const review=notifications(db,users.hr).filter(n=>n.subject_kind==='benefit_review');
  assert.equal(review.length,1);assert.equal(review[0].link,'#benefits-admin');
});

// حدّ اليوم بين الرياض وUTC (app/riyadh-time.mjs): «طلب تذكرة هذه السنة» بسنة الرياض. طلبٌ الساعة 00:30 بتوقيت الرياض من 1 يناير
// (21:30 UTC من 31 ديسمبر) طلبُ السنة الجديدة؛ كان يُحسب بأول أربعة أحرف من طابعه على السنة الماضية، فيُفتح لصاحبه طلبٌ ثانٍ في السنة نفسها.
test('ticket claim year at the Riyadh boundary: a claim made at 00:30 Riyadh on 1 January is that year\'s one claim',t=>{
  pinClock(t,'2026-12-31T20:00:00.000Z');// 23:00 الرياض من 31 ديسمبر 2026
  const {submit,accept}=fixture(t);
  accept('air_ticket');
  assert.ok(submit('employee','ticket_claim',{mode:'cash',destination:'القاهرة',travel_from:day(30)}).reference.startsWith('BEN-'),'طلب 2026');
  t.mock.timers.setTime(Date.parse('2026-12-31T21:30:00.000Z'));// 00:30 الرياض من 1 يناير 2027
  assert.ok(submit('employee','ticket_claim',{mode:'cash',destination:'عمّان',travel_from:day(30)}).reference.startsWith('BEN-'),'أول طلب في 2027 بتوقيت الرياض');
  t.mock.timers.setTime(Date.parse('2027-01-15T09:00:00.000Z'));
  assert.throws(()=>submit('employee','ticket_claim',{mode:'cash',destination:'دبي',travel_from:day(30)}),code('option_unavailable'),'طلب واحد في السنة');
});
