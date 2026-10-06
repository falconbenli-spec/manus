import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, now, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction, getContract } from '../app/hr-contracts.mjs';
import { prepareLeaveTypesDraft, decideLeaveTypes } from '../app/leave-types.mjs';
import { grantLeaveOpening } from '../app/leave.mjs';
import { seededRule, decideRule, acceptedRule, roundMoney, roundingMode } from '../app/payroll-rules.mjs';
import { decideSchedule, BASE_SCHEDULE_ID } from '../app/discipline.mjs';
import { decideBenefit } from '../app/benefits-portal.mjs';
import { proposeTravel, travelAction, computePerDiem } from '../app/travel.mjs';
import { saveProfile } from '../app/employees.mjs';
import { saveCareer } from '../app/career-profile.mjs';
import { setAiSettings, runAssistant, setProvider } from '../app/ai.mjs';
import { answerQuestion, plainText, runGoldenSet, classify, otherPersonNamed, policyAssistantBoard, rateAnswer, resolveQuestion, skillsPath, GOLDEN_QUESTIONS } from '../app/policy-assistant.mjs';
import { retrieve, unknownTerms, buildIndex, articlesOf, retrieveHybrid, setEmbedder } from '../app/policy-retrieval.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { activateAssistants } from './ai-inventory-fixture.mjs';

const code=value=>error=>error.code===value;
const TODAY='2026-09-20';

// كيان مصطنع نصُّه من وحدات المنصة نفسها: سياسة دوام معتمدة، أنواع إجازات معتمدة، قواعد لائحة مقبولة،
// جدول جزاءات مقبول، مزايا معتمدة، عقد ساري للسائل، رصيد إجازة، وقرار انتداب معتمد يُقرأ منه درجته.
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-policy-assistant');installServiceCatalog(db);t.after(()=>{setProvider(null);db.close();});
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية المصطنع','unused','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  for(const capability of ['hr.policy.accept','hr.contracts.approve'])tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability,note:'مدير الموارد البشرية مالك القبول (DEC16)'}));

  const policy=(input)=>tx(()=>preparePolicy(db,users.hr,input)).id;
  const accept=id=>tx(()=>decidePolicy(db,users['hr-manager'],id,'accept',{note:'راجعت النص وطابقته مع اللائحة الموقعة'}));
  accept(policy({kind:'working_time',title:'ساعات العمل المصطنعة',body:'أيام العمل من الأحد إلى الخميس من التاسعة صباحًا إلى الخامسة مساءً.\nمهلة التأخير المسموحة ثلاثون دقيقة بعد بداية الدوام ولا تُحتسب تأخرًا.',basis:'قرار إدارة مصطنع رقم 2 لسنة 2026',effective_from:'2026-01-01',parameters:{workdays:[0,1,2,3,4],start:'09:00',end:'17:00',grace_minutes:30}}));
  accept(policy({kind:'pay_components',title:'بنود الراتب المعتمدة',body:'يتكون الراتب الشهري من أساسي وبدل سكن وبدل نقل فقط، بمبالغ شهرية ثابتة بالريال.',basis:'قرار إدارة مصطنع رقم 1 لسنة 2026',effective_from:'2026-01-01',parameters:{components:['basic','housing','transport']}}));

  // عقد ساري للسائلة: منه بنود الراتب وفترة التجربة.
  const draft=getContract(db,users.hr,tx(()=>prepareContract(db,users.hr,{user_id:'employee',contract_type:'indefinite',job_title:'مصممة أولى',work_location:'الرياض',start_date:'2026-02-01',weekly_hours:40,probation_days:90,notice_days:60,
    pay_lines:[{component:'basic',amount:'8000.00'},{component:'housing',amount:'2000.00'},{component:'transport',amount:'500.00'}],document_reference:'عقد مصطنع موقع محفوظ في ملف الموظفة'})).id);
  const submitted=getContract(db,users['hr-manager'],tx(()=>contractAction(db,users.hr,draft.id,'submit_contract',{version:draft.version})).id);
  tx(()=>contractAction(db,users['hr-manager'],submitted.id,'approve_contract',{version:submitted.version}));

  // أنواع الإجازات النظامية: منها مدة إجازة الزواج وإجازة الوضع (م105 التي حلت محل م101).
  const leaveTypes=tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2026-01-01',unpaid_leave_mode:'excess'})).id;
  tx(()=>decideLeaveTypes(db,users['hr-manager'],leaveTypes,'accept',{note:'راجعت الأنواع ومواد اللائحة قبل الاعتماد'}));
  db.prepare("INSERT INTO leave_calendars VALUES(?,?,?,?,?,?,?,?,?,'Asia/Riyadh',1,?)").run('creative-2026','36t','creative','hr','تقويم مصطنع للاختبار، ليس سياسة الشركة','2026-01-01','2026-12-31','[0,1,2,3,4]','[]',now());
  tx(()=>grantLeaveOpening(db,users.hr,{employee_id:'employee',leave_type:'synthetic_annual',balance_year:2026,days:12,effective_date:'2026-01-01',reason:'منح مصطنع محدد للاختبار',evidence:'بيانات عينة اختبار محلية',calendar_id:'creative-2026'}));
  tx(()=>grantLeaveOpening(db,users.hr,{employee_id:'outsider',leave_type:'synthetic_annual',balance_year:2026,days:30,effective_date:'2026-01-01',reason:'منح مصطنع لزميل آخر',evidence:'بيانات عينة اختبار محلية',calendar_id:'creative-2026'}));

  // قواعد اللائحة: الاستقالة وقواعد صرف الأجر وجدول بدل الانتداب.
  const adopt=(kind,choices={})=>tx(()=>decideRule(db,users['hr-manager'],seededRule(db,kind).id,'accept',{effective_from:'2026-01-01',choices,note:'طابقت القيم مع اللائحة الموقعة قبل القبول'})).id;
  adopt('resignation',{deferral_anchor:'submission'});
  adopt('pay_rules',{rounding:'halala'});
  adopt('travel_per_diem');
  tx(()=>decideSchedule(db,users['hr-manager'],BASE_SCHEDULE_ID,'accept',{effective_from:'2026-01-01',note:'طابقت جدول المخالفات مع الملف الموقع'}));

  // المزايا: ما يُسأل عنه في الحزمة الذهبية.
  for(const key of ['parents_insurance','air_ticket','training_support','housing']){
    const row=db.prepare("SELECT * FROM benefit_catalog WHERE tenant_id='36t' AND benefit_key=? AND status='draft'").get(key);
    if(row)tx(()=>decideBenefit(db,users['hr-manager'],row.id,'accept',{version:row.version,effective_from:'2026-01-01',note:'قرار المالك المدوّن في محضر مصطنع بتاريخ 2026-01-01'}));
  }

  // قرار انتداب معتمد: منه تُقرأ درجة السائلة في جدول البدل (لا سجل للدرجات في المنصة بعد).
  const travelId=tx(()=>proposeTravel(db,users.manager,{user_id:'employee',task:'تنفيذ مهمة تصوير مصطنعة خارج المملكة',destination:'الدوحة',scope:'abroad',start_date:'2026-03-01',end_date:'2026-03-03'})).id;
  const travel=db.prepare('SELECT * FROM travel_decisions WHERE id=?').get(travelId);
  tx(()=>travelAction(db,users['hr-manager'],travelId,'approve_travel',{version:travel.version,grade:'employee',housing:'none',transport:'none',note:'مهمة مصطنعة معتمدة للاختبار'}));

  // الملف المهني: منه مسار المهارات.
  tx(()=>saveProfile(db,users.hr,'employee',{version:0,job_title:'مصممة جرافيك',employment_type:'full_time',join_date:'2024-03-01',contract_end:''}));
  tx(()=>saveCareer(db,users.employee,{years_total:6,years_in_field:4,previous_roles:'مصممة في استوديو مصطنع ثلاث سنوات',skills:['تصميم الهوية','الموشن جرافيك'],career_interest:'الانتقال إلى الإدارة الإبداعية'}));

  tx(()=>setAiSettings(db,users.admin,{enabled:true,daily_runs_per_user:20,monthly_cost_cap:'',input_price_per_mtok:'',output_price_per_mtok:'',disabled_assistants:[],reason:'تفعيل تجريبي للمساعدين ببيانات مصطنعة'}));
  // «غير مجرود» = «لا يعمل»: يمرّ الجرد بخطوات الحوكمة كاملة قبل أي تشغيل لمساعد في هذا الملف.
  activateAssistants(db,users);
  const ask=(who,question)=>answerQuestion(db,users[who],question,{today:TODAY});
  const run=(who,question)=>runAssistant(db,users[who],'policy_assistant',{question},transaction);
  return {db,users,tx,ask,run};
}

test('answers come from the platform’s own text: a direct line, the paragraph quoted with its article and link, and a plain refusal when no text answers',async t=>{
  const {db,users,ask}=fixture(t);
  const marriage=await ask('employee','كم مدة إجازة الزواج؟');
  assert.equal(marriage.kind,'policy');assert.equal(marriage.answered,true);
  assert.ok(marriage.citations.length>=1,'the answer rests on at least one paragraph');
  assert.ok(marriage.citations.every(c=>c.text&&c.link&&c.title),'every citation carries its quote, title and link');
  assert.match(plainText(marriage),/5 أيام بأجر كامل/);
  assert.match(marriage.direct.join(' '),/5 أيام بأجر كامل/,'the chat bubble answers the question instead of pointing vaguely at the source');
  assert.match(plainText(marriage),/م94/);
  assert.ok(marriage.citations.some(c=>c.in_force),'the quoted paragraph is in force');
  assert.equal(marriage.direct.length>=1&&marriage.direct.length<=2,true,'one or two lines of direct answer');

  const penalty=await ask('employee','ما عقوبة التأخر 20 دقيقة للمرة الثانية؟');
  assert.equal(penalty.answered,true);assert.ok(penalty.citations.length>=1);
  assert.match(plainText(penalty),/غرامة|إنذار/);

  // لا نص: امتناع صريح بلا تخمين ولا معرفة عامة بنظام العمل.
  const none=await ask('employee','هل يصرفون بدل انترنت؟');
  assert.equal(none.answered,false);assert.equal(none.citations.length,0);
  assert.match(none.refusal,/لا يوجد نص/);assert.match(none.refusal,/الموارد البشرية/);
  assert.doesNotMatch(plainText(none),/نظام العمل السعودي ينص|يجوز عادة/);
  const outside=await ask('employee','ما سعر صرف الين الياباني مقابل الريال؟');
  assert.equal(outside.answered,false);assert.match(outside.refusal,/لا يوجد نص/);
  // العتبة نفسها مفحوصة على مستواها: كلمة السؤال الأصلية غير الموجودة في أي فقرة تمنع «الجواب القريب».
  const index=buildIndex(articlesOf(db,users.employee,TODAY));
  assert.deepEqual(unknownTerms(db,'هل يصرفون بدل انترنت؟',index),['انترنت']);
  assert.deepEqual(unknownTerms(db,'كم مدة إجازة الزواج؟',index),[]);
  assert.equal(retrieve(db,users.employee,'هل يصرفون بدل انترنت؟',{today:TODAY}).passages.length,0);
});

test('a conflict between two articles states which one is in force and links the amendment',async t=>{
  const {ask}=fixture(t);
  const maternity=await ask('employee','كم مدة إجازة الوضع؟');
  assert.equal(maternity.answered,true);
  const conflict=maternity.conflicts.find(c=>c.superseded==='م101');
  assert.ok(conflict,'the retrieved paragraph cites both م105 and م101, so the supersession is stated');
  assert.equal(conflict.in_force,'م105');
  assert.ok(conflict.link,'the amendment is linked');
  assert.match(plainText(maternity),/تعارض/);
  assert.match(plainText(maternity),/النافذ: م105/);
});

test('a calculation reads the asker’s own grade and contract, calls the travel module’s own function, and refuses a rate that is not accepted',async t=>{
  const {db,users,ask}=fixture(t);
  const answer=await ask('employee','كم بدل انتدابي 3 أيام برا؟');
  assert.equal(answer.kind,'calculation');
  assert.ok(!answer.calculation.blocked,'the per-diem table is accepted in this tenant');
  const rule=acceptedRule(db,'36t','travel_per_diem',TODAY);
  const expected=roundMoney(computePerDiem(rule.parameters,{scope:'abroad',grade:'employee',housing:'none',transport:'none',days:3}).allowance_minor,roundingMode(db,'36t',TODAY));
  assert.equal(answer.calculation.allowance_minor,expected,'the assistant does not compute its own figure; it calls computePerDiem');
  assert.equal(answer.calculation.grade,'employee');
  assert.ok(answer.calculation.steps.length>=4,'the working is shown step by step');
  assert.ok(answer.calculation.steps.every(s=>s.article),'every rule in the working names its article');
  assert.match(plainText(answer),/م65/);

  // سياسة غير مقبولة: يُقال أي قرار ينقص، ولا يُخترع سعر.
  const other=openDb(':memory:');seed(other,'synthetic-policy-assistant-unaccepted');t.after(()=>other.close());
  const fresh=Object.fromEntries(other.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const blocked=await answerQuestion(other,fresh.employee,'كم بدل انتدابي 3 أيام برا؟',{today:TODAY});
  assert.ok(blocked.calculation.blocked,'no accepted per-diem table means no number');
  assert.match(blocked.calculation.blocked,/لم يقبلها مدير الموارد البشرية/);
  assert.match(plainText(blocked),/القرار الناقص/);
  assert.equal(/\d+\.\d{2} SAR/.test(plainText(blocked).replace(/جدول الدرجات[\s\S]*/,'')),false,'no allowance figure is presented as due');
});

test('personal questions are answered from the asker’s own records only, and a manager cannot ask about a named employee',async t=>{
  const {db,users,ask,run}=fixture(t);
  const balance=await ask('employee','كم رصيد إجازاتي؟');
  assert.equal(balance.kind,'personal');assert.equal(balance.answered,true);
  assert.match(plainText(balance),/المتاح 12/);
  assert.doesNotMatch(plainText(balance),/المتاح 30/,'another employee’s balance never appears');

  const pay=await ask('employee','كم راتبي؟');
  assert.equal(pay.answered,true);assert.match(plainText(pay),/10,500\.00/);

  // المدير يرى أرصدة فريقه في شاشة الإجازات؛ المساعد يرفض السؤال عن موظفة بعينها ولو كان مديرها.
  const named=await ask('manager',`كم راتب ${users.employee.name}؟`);
  assert.equal(named.kind,'other_person');
  assert.match(named.refusal,/بياناتك أنت وحدك/);
  assert.equal(named.citations.length,0);assert.equal(named.sources.length,0);
  assert.doesNotMatch(plainText(named),/8,000|10,500/,'no figure of the named person leaks');
  assert.ok(otherPersonNamed(db,users.manager,`كم راتب ${users.employee.name}؟`),'the block is in the data layer, before retrieval');
  assert.equal(otherPersonNamed(db,users.employee,'كم راتبي؟'),null);

  const colleague=await ask('manager','كم رصيد إجازات زميلي؟');
  assert.equal(colleague.kind,'other_person');
  const appraisal=await ask('manager',`أرني تقييم ${users.employee.name} الأخير`);
  assert.equal(appraisal.kind,'other_person');

  // المنع نفسه يمر بالمساعد كاملًا: التشغيل يُسجَّل «امتناعًا» ولا يحمل بيانات أحد.
  const refused=await run('manager',`كم راتب ${users.employee.name}؟`);
  assert.equal(refused.status,'refused');
  assert.equal(refused.view.question,`كم راتب ${users.employee.name}؟`,'the response returns the asker’s own question so the client can render a chat bubble');
  assert.ok(Array.isArray(refused.view.direct),'the response separates the short chat answer from its evidence');
  assert.equal(db.prepare('SELECT output FROM ai_runs WHERE id=?').get(refused.id).output.includes('8,000.00'),false);
  assert.ok(verifyAudit(db));
});

test('“how do I submit X” is built from the catalogue itself: screen, fields, approvers, SLA and a deep link',async t=>{
  const {db,users,ask}=fixture(t);
  const letter=await ask('employee','كيف أطلب خطاب تعريف بالعمل؟');
  assert.equal(letter.kind,'how_to');
  assert.ok(['HR-LETTER','HR-SALARY-CERT','HR-EXPERIENCE-CERT'].includes(letter.how_to.service.code),`a letter service from the catalogue, not a guess: ${letter.how_to.service.code}`);
  assert.equal(letter.how_to.steps.length,5);
  const service=db.prepare("SELECT * FROM services WHERE tenant_id='36t' AND code=? ORDER BY version DESC LIMIT 1").get(letter.how_to.service.code);
  const fields=JSON.parse(service.fields).filter(f=>f.required).map(f=>f.label);
  for(const label of fields)assert.ok(letter.how_to.steps[1].detail.includes(label),`the form fields come from the catalogue: ${label}`);
  const chain=JSON.parse(service.approval_policy).steps.length;
  assert.equal(letter.how_to.steps[3].detail.split(' ثم ').length,chain,'the approval chain is the catalogue’s own chain, step for step');
  assert.equal(letter.deep_link.href,'#letters/new','the answer ends with the link that opens the form');

  const benefit=await ask('employee','كيف أطلب تأمين والدي؟');
  assert.equal(benefit.kind,'how_to');
  assert.ok(benefit.how_to.steps.some(s=>/الاعتماد/.test(s.title)));
  assert.ok(benefit.deep_link.href.length>1);
});

test('the skills path is built only from the asker’s own record, promises nothing, and hands the goals to the existing goals screen',async t=>{
  const {db,users,ask}=fixture(t);
  const path=skillsPath(db,users.employee,TODAY);
  assert.equal(path.user_id,'employee');
  assert.equal(path.job_title,'مصممة أولى','the title comes from the active contract, not from a guess');
  assert.deepEqual(path.skills,['تصميم الهوية','الموشن جرافيك']);
  assert.ok(path.gaps.join(' ').includes('الانتقال إلى الإدارة الإبداعية'));
  assert.ok(path.gaps.join(' ').includes('سلّمًا وظيفيًا'),'no career ladder is invented where the platform has none');
  assert.ok(path.support.some(s=>/م42/.test(s)),'the training articles come from the accepted benefit text');
  assert.ok(path.suggestions.length>=1&&path.suggestions.every(g=>g.goal&&g.measure));
  assert.equal(path.goals_link,'#growth');
  const text=path.limits.join(' ');
  assert.match(text,/لا وعد بترقية/);assert.match(text,/لا يلتزم المساعد بدورة مدفوعة/);
  const answer=await ask('employee','ما المهارات التي أطورها في دوري الحالي؟');
  assert.equal(answer.kind,'skills');
  assert.doesNotMatch(plainText(answer),/الموظف الآخر|زميل/);
  // سجل غيره لا يُقرأ من هنا مهما كان الطالب.
  assert.equal(skillsPath(db,users.manager,TODAY).user_id,'manager');
});

test('salary, family and appraisal details are masked before the provider call and restored only for their owner, and the daily limit still holds',async t=>{
  const {db,users,tx,run}=fixture(t),sent=[];
  setProvider({name:'fake',async complete(request){sent.push(request);return {text:'راتبك الشهري [[SALARY_1]] بحسب عقدك الساري.',input_tokens:100,output_tokens:20,model:'fake-1'};}});
  const pay=await run('employee','كم راتبي؟');
  assert.equal(sent.length,1);
  assert.match(sent[0].user,/\[\[SALARY_1\]\]/,'the figure leaves as a token');
  assert.doesNotMatch(sent[0].user,/10,500\.00|8,000\.00/,'no salary figure is in the prompt');
  assert.match(pay.output,/10,500\.00/,'the owner sees the restored figure');
  assert.equal(db.prepare('SELECT input_digest FROM ai_runs WHERE id=?').get(pay.id).input_digest.length>0,true);

  const appraisal=await run('employee','ما المهارات التي أطورها؟');
  assert.equal(appraisal.status,'completed');
  assert.match(sent[1].user,/\[\[APPRAISAL_1\]\]/,'appraisal areas leave as a token too');

  // سجل الأسئلة: ما لا نص له يصل فريق المحتوى، وصاحب السؤال وحده يقيّم إجابته.
  const missing=await run('employee','هل يصرفون بدل انترنت؟');
  assert.equal(missing.status,'refused');
  const board=policyAssistantBoard(db,users.employee);
  assert.equal(board.my_questions.length,3);
  assert.equal(board.my_questions.some(q=>!q.answered),true);
  assert.equal(board.can_curate,false);
  assert.equal(board.retrieval.semantic_active,false,'no embedding endpoint is configured, and the board says so');
  assert.match(board.retrieval.path,/lexical_bm25/);
  const open=policyAssistantBoard(db,users.hr).gaps;
  assert.equal(open.length,1);assert.match(open[0].question,/انترنت/);
  assert.throws(()=>tx(()=>rateAnswer(db,users.manager,open[0].id,{helpful:false,note:''})),code('not_found'),'only the asker rates the answer');
  tx(()=>rateAnswer(db,users.employee,open[0].id,{helpful:false,note:'لا يوجد نص عن بدل الإنترنت'}));
  assert.throws(()=>tx(()=>resolveQuestion(db,users.employee,open[0].id,{note:'الموظفة لا تغلق قائمة المحتوى'})),code('not_permitted'));
  tx(()=>resolveQuestion(db,users.hr,open[0].id,{note:'أُضيف نص بدل الإنترنت إلى مصفوفة المزايا بقرار المالك'}));
  assert.equal(policyAssistantBoard(db,users.hr).gaps.length,0);
  assert.throws(()=>db.prepare("UPDATE policy_questions SET question='سؤال آخر'").run(),/never rewritten/);

  // الحد اليومي يحكم مساعد السياسات كما يحكم غيره.
  tx(()=>setAiSettings(db,users.admin,{enabled:true,daily_runs_per_user:4,monthly_cost_cap:'',input_price_per_mtok:'',output_price_per_mtok:'',disabled_assistants:[],reason:'خفض الحد اليومي للاختبار'}));
  await run('employee','كم مدة إجازة الزواج؟');
  await assert.rejects(run('employee','كم مدة إجازة الزواج؟'),code('daily_limit'));
  assert.ok(verifyAudit(db));
});

test('the golden set runs on retrieval alone, with the provider stubbed, and reports what the text still lacks',async t=>{
  const {db,users}=fixture(t),sent=[];
  setProvider({name:'fake',async complete(request){sent.push(request);return {text:'لا ينبغي استدعاء المزود في الحزمة الذهبية.',input_tokens:1,output_tokens:1,model:'fake-1'};}});
  assert.ok(GOLDEN_QUESTIONS.length>=25,'at least 25 golden questions');
  const result=await runGoldenSet(db,users.hr,{subject_user_id:'employee',today:TODAY});
  assert.equal(sent.length,0,'the golden set costs nothing and calls no provider');
  assert.equal(result.total,GOLDEN_QUESTIONS.length);
  assert.ok(result.cases.every(c=>c.detail&&c.needs),'every case says what it needs and what happened');
  const failed=result.cases.filter(c=>c.outcome==='failed').map(c=>`${c.id} ${c.question} — ${c.detail}`);
  // هذا الكيان المصطنع يجتاز الحزمة كاملة (28 من 28). الحد 90٪ يترك مجالًا لتغير النص المعتمد،
  // ويبقى الرسوب دليلًا على نص ناقص: رسالة الفشل تسمي السؤال وما ينقصه.
  assert.ok(result.pass_rate_bp>=9000,`golden pass rate ${(result.pass_rate_bp/100).toFixed(1)}% — failing: ${failed.join(' | ')}`);
  // فئات لا يجوز أن ترسب مهما كان المحتوى: الخصوصية والامتناع.
  for(const expect of ['privacy','no_text'])
    assert.ok(result.cases.filter(c=>c.expect===expect).every(c=>c.outcome==='passed'),`${expect} cases must always pass`);
  await assert.rejects(runGoldenSet(db,users.employee,{}),code('not_permitted'));
  // التصنيف نفسه مفحوص مباشرة: السؤال الشخصي لا يُخلط بسؤال النص.
  assert.equal(classify('كم رصيد إجازاتي؟'),'personal');
  assert.equal(classify('كم مدة إجازة الزواج؟'),'policy');
  assert.equal(classify('كيف أطلب إجازة؟'),'how_to');
  assert.equal(classify('متى أستحق تذكرة السفر السنوية؟'),'eligibility');
  assert.equal(classify('كم بدل انتدابي 3 أيام برا؟'),'calculation');
});

// نقطة نهاية التمثيلات مسار ثانٍ يغادر فيه النص الجهاز، غير مسار المزوّد في app/ai.mjs. حين فُحصت تغطية الحجب
// بعد الدمج تبيّن أن هذا المسار كان يرسل سؤال الموظف كما كتبه. الاختبار يمسك المسار نفسه لا الإصلاح:
// يحقن مجسًّا يلتقط ما أُرسل فعلًا، ويتحقق أن أرقام الهوية والجوال والبريد غادرت محجوبة.
test('the semantic layer masks the question before it leaves the machine, exactly as the provider path does',async t=>{
  const {db,users}=fixture(t);
  const sent=[];
  setEmbedder({model:'probe',async embed(texts){sent.push(...texts);return texts.map((_,i)=>[i+1,0,0]);}});
  t.after(()=>setEmbedder(null));
  // الأرقام والبريد لا تمنعها بوابة «كلمة لا أعرفها»: الأرقام مستثناة منها صراحةً، فالسؤال يمضي إلى المسار الدلالي.
  const question='كم مدة إجازة الزواج؟ 0512345678 1234567890 a@b.sa';
  const found=await retrieveHybrid(db,users.employee,question,{today:TODAY});
  assert.equal(found.path.semantic,true,'the injected embedder makes the semantic layer active');
  assert.ok(sent.length>0,'the question and its paragraphs reached the endpoint');
  const outgoing=sent.join('\n');
  for(const secret of ['0512345678','1234567890','a@b.sa'])
    assert.equal(outgoing.includes(secret),false,`${secret} must not leave the machine`);
  assert.match(outgoing,/إجازة الزواج/,'the subject of the question still travels, so the search still works');
});
