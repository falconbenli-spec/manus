import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createLeaveRequest, grantLeaveOpening, leaveAction, listLeave } from '../app/leave.mjs';
import { prepareLeaveTypesDraft, decideLeaveTypes, createLeaveCalendar, leavePolicies, statutoryHolidayPlan, articlesText, REGULATION_LEAVE_TYPES, REGULATION_PUBLIC_HOLIDAYS, REGULATION_COMPENSATORY, REGULATION_LAW_GAPS, REGULATION_UNPAID_LEAVE, LEGAL_NOTE, LEGAL_BASIS, SOURCE_NAMES } from '../app/leave-types.mjs';
import { articlesOf } from '../app/policy-retrieval.mjs';
import { leaveUI, leavePreview } from '../app/static/leave-ui.mjs';
import { kit } from '../app/static/kit.mjs';

// سياسة الإجازات وفق نظام العمل بتعديلات المرسوم م/44 ولائحته التنفيذية (مراجعة 21 سبتمبر 2026). كل البيانات مصطنعة «تجريبي».
const code=expected=>error=>error.code===expected;
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const pdf=label=>({filename:`${label}.pdf`,content:Buffer.from(`%PDF-1.4 synthetic ${label}`).toString('base64')});
const helpers={e,ui:kit(e),button:(action,id,label)=>`<button data-operation="${action}" data-id="${id}">${e(label)}</button>`};

const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
// أول أحد بعد n يومًا من اليوم: بداية يومي امتحان (أحد واثنين) بعد مهلة الإشعار، في سنة واحدة.
const sundayAfter=n=>{let d=addDays(today(),n);while(new Date(d+'T00:00:00Z').getUTCDay()!==0||addDays(d,1).slice(0,4)!==d.slice(0,4))d=addDays(d,1);return d;};

function fixture(t,{mutate=null,outsiderStart='2026-06-01',years=[]}={}){
  const db=openDb(':memory:');seed(db,'synthetic-leave-law');t.after(()=>db.close());
  db.exec("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('hr-manager','36t','hr','hr-manager','مدير الموارد البشرية التجريبي','unused-test-hash','manager',NULL)");
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=fn=>transaction(db,fn);
  tx(()=>grantAccess(db,users.admin,{user_id:'hr-manager',capability:'hr.policy.accept',note:'مالك اعتماد سياسات الموارد البشرية في الاختبار'}));
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('pay-policy','36t','pay_components','بنود راتب مصطنعة','نص سياسة مصطنع للاختبار المحلي فقط ولا يمثل قرار شركة.','{\"components\":[\"basic\"]}','سند مصطنع للاختبار المحلي','2020-01-01','accepted','hr','hr-manager',?,?)").run(now(),now());
  const contract=(userId,start)=>db.prepare("INSERT INTO employment_contracts(id,tenant_id,user_id,policy_id,contract_type,job_title,work_location,start_date,weekly_hours,probation_days,notice_days,pay_lines,monthly_total_minor,currency,document_reference,status,prepared_by,decided_by,decided_at,created_at,updated_at) VALUES(?,'36t',?,'pay-policy','indefinite','وظيفة تجريبية','الرياض',?,40,90,60,'[{\"component\":\"basic\",\"amount_minor\":1000000}]',1000000,'SAR','مستند تجريبي لا وجود له','active','hr','hr-manager',?,?,?)")
    .run(`contract-${userId}`,userId,start,now(),now(),now());
  // الموظفة أكملت سنتين في 1 يناير 2027؛ الموظف الآخر لم يكملهما.
  contract('employee','2025-01-01');contract('outsider',outsiderStart);
  let policyId=tx(()=>prepareLeaveTypesDraft(db,users.hr,{effective_from:'2025-01-01'})).id;
  if(mutate){
    // سياسة معدَّلة القيمة تُكتب مباشرة بشكل الإصدار 3 (المسودة لا تُعدَّل بعد كتابتها): لاختبار قيمة تحددها الشركة لاحقًا كعدد الحجاج السنوي.
    const parameters=JSON.parse(db.prepare('SELECT parameters FROM leave_type_policies WHERE id=?').get(policyId).parameters);mutate(parameters);
    tx(()=>decideLeaveTypes(db,users['hr-manager'],policyId,'reject',{note:'تُستبدل بمسودة معدلة القيمة في الاختبار'}));
    policyId='policy-mutated';
    db.prepare("INSERT INTO leave_type_policies(id,tenant_id,title,body,parameters,basis,effective_from,status,prepared_by,created_at) VALUES(?,'36t','أنواع الإجازات (تجريبي معدل)','سياسة مصطنعة معدلة القيمة لاختبار محلي فقط.',?,'سند مصطنع للاختبار','2025-01-01','draft','hr',?)").run(policyId,JSON.stringify(parameters),now());
  }
  tx(()=>decideLeaveTypes(db,users['hr-manager'],policyId,'accept',{note:'راجعت الأنواع ومواد النظام واللائحة قبل الاعتماد في الاختبار'}));
  const calendars={};
  for(const year of new Set([2026,2027,...years]))calendars[year]=tx(()=>createLeaveCalendar(db,users.hr,{employee_department_id:'creative',name:`تقويم إجازات تجريبي ${year}`,effective_from:`${year}-01-01`,effective_to:`${year}-12-31`,weekdays:[0,1,2,3,4]})).id;
  const ask=(input,who='employee')=>tx(()=>createLeaveRequest(db,users[who],{balance_year:Number(input.start_date.slice(0,4)),reason:'طلب اختبار تجريبي لأنواع نظام العمل',...input}));
  const act=(who,r,action,input={})=>tx(()=>leaveAction(db,users[who],r.id,action,{version:r.version,note:'قرار اختبار مصطنع',...input}));
  const opening=(who,type,days,year=2026)=>tx(()=>grantLeaveOpening(db,users.hr,{employee_id:who,leave_type:type,balance_year:year,days,effective_date:`${year}-01-01`,reason:'رصيد افتتاحي مصطنع للاختبار',evidence:'بيانات اختبار محلية',calendar_id:calendars[year]}));
  const holiday=date=>db.prepare("INSERT INTO public_holidays(id,tenant_id,holiday_date,name,basis,status,proposed_by,decided_by,decided_at,created_at) VALUES(?,'36t',?,'عطلة عيد مصطنعة','تعميم مصطنع لبيئة الاختبار','approved','hr','hr-manager',?,?)").run(`holiday-${date}`,date,now(),now());
  return {db,users,tx,policyId,ask,act,opening,holiday};
}

test('leave law 2025: every type cites the labor law beside the company regulation, and nothing the regulation grants is lowered',()=>{
  const by=Object.fromEntries(REGULATION_LEAVE_TYPES.map(x=>[x.code,x]));
  for(const type of REGULATION_LEAVE_TYPES){
    assert.ok(Array.isArray(type.law_articles),`${type.code}: law_articles is always an array`);
    assert.ok(type.articles.length||type.law_articles.length,`${type.code}: cites the regulation, the law, or both`);
    assert.ok(type.law_articles.length||type.law_note_ar,`${type.code}: a company benefit with no statutory article says so`);
    for(const rule of type.rules_ar)if(/\d/.test(rule))assert.match(rule,/م\d|م\s?\d|نظام العمل|اللائحة|سياسة/,`${type.code}: a sentence with a number carries its article — ${rule}`);
  }
  // الأكرم من النظام باقٍ كما هو: 30 يومًا من المباشرة، والطارئة والمرافقة، وأيام العمل في الزواج والمولود والوفاة.
  assert.equal(by.annual.entitlement.days,30);assert.match(by.annual.law_note_ar,/21 يومًا/);
  // «أكرم» مقيَّدة بما هي أكرم فيه: العدد في السنوات الخمس الأولى. بعدها تتوقف على وحدة العد، وهي أول ما لم يتأكد؛ فلا تناقض الملاحظةُ السؤالَ المفتوح.
  assert.match(by.annual.law_note_ar,/أكرم في العدد خلال السنوات الخمس الأولى/);assert.match(by.annual.law_note_ar,/إن كانت أيام النظام تقويمية فقط/);assert.match(by.annual.law_note_ar,/السؤال المفتوح الأول/);
  assert.doesNotMatch(by.annual.law_note_ar,/فهي أكرم وتبقى الحاكمة/);assert.match(by.annual.open[0],/أقل من 30 يوم عمل/);
  assert.equal(by.emergency.entitlement.days,3);assert.equal(by.companion.entitlement.days,15);assert.deepEqual(by.emergency.law_articles,[]);assert.match(by.companion.law_note_ar,/ميزة من لائحة الشركة/);
  for(const event of ['marriage','birth','death_close','death_sibling']){assert.equal(by[event].unit,'working');assert.deepEqual(by[event].law_articles,['نظام العمل م113']);}
  assert.deepEqual(by.sick.pay_tiers.map(x=>x.days),[30,60,30]);assert.ok(by.sick.law_articles.includes('نظام العمل م117'));
  assert.equal(by.maternity.entitlement.days,84);assert.deepEqual(by.maternity.law_articles,['نظام العمل م151']);
  assert.ok(by.unpaid.law_articles.includes('نظام العمل م116'));assert.ok(by.iddah.law_articles.includes('نظام العمل م160'));
  // ما أُضيف لأن المسودة كانت دون النظام.
  for(const added of ['hajj','iddah_ext_pregnant','compensatory'])assert.ok(by[added],added);
  assert.deepEqual(REGULATION_LEAVE_TYPES.slice(-3).map(x=>x.code),['hajj','iddah_ext_pregnant','compensatory'],'new types are appended: the numbering of accepted paragraphs does not move');
  assert.equal(SOURCE_NAMES.overtime.includes('عمل إضافي'),true);
  assert.deepEqual([REGULATION_COMPENSATORY.ratio_bp,REGULATION_COMPENSATORY.use_within_days,REGULATION_COMPENSATORY.annual_cap_days],[15000,60,30]);
  // العيدان يُعوَّضان الآن، والمذكرة القانونية تقول ما رُوجع ومتى وأن النظام حد أدنى.
  assert.ok(REGULATION_PUBLIC_HOLIDAYS.items.every(i=>i.compensate));assert.ok(REGULATION_PUBLIC_HOLIDAYS.law_articles.includes('اللائحة التنفيذية م24'));
  assert.match(LEGAL_NOTE,/21 سبتمبر 2026/);assert.match(LEGAL_NOTE,/هيئة الخبراء/);assert.match(LEGAL_NOTE,/حد أدنى/);assert.match(LEGAL_NOTE,/ليست رأيًا قانونيًا/);
  assert.equal(LEGAL_BASIS.checked_on,'2026-09-21');
  // ما لم يتأكد يسكن السياسة التي تُعتمد، لا وثيقة التسليم وحدها: إعادة بناء كلمتين من م22 مكرر، وسقوف م106، ومعنى الشهر، وقراءة م116.
  for(const item of [/وحدة عدّ الإجازة السنوية/,/بعد ملف أبريل 2025/,/115921/,/م22 مكرر.*أُعيد بناؤهما.*م29\/2/,/نظام العمل م106/,/أساس أجر الرصيد غير المستعمل/,/اشتراط «الكتابة»/,/م116.*لكل إجازة/,/«الشهر» في نظام العمل م151/])
    assert.ok(LEGAL_BASIS.not_verified.some(x=>item.test(x)),String(item));
  assert.deepEqual(REGULATION_LAW_GAPS.map(g=>g.key),['nursing_hour','overtime_annual_hours','sick_during_annual']);
  // كل مادة يستشهد بها بند «لم يُبنَ» لها قاعدتها مكتوبة في نصه، لا رقم مادة معلّق على قاعدة غيرها.
  for(const article of REGULATION_LAW_GAPS[1].law_articles)assert.ok(REGULATION_LAW_GAPS[1].rule_ar.includes(article),`overtime_annual_hours: ${article} is cited and its rule is stated`);
  assert.match(REGULATION_LAW_GAPS[1].rule_ar,/عشر ساعات في اليوم أو ستين ساعة في الأسبوع \(نظام العمل م106\)/);assert.match(REGULATION_LAW_GAPS[1].rule_ar,/أيام العطل والأعياد ساعات إضافية \(نظام العمل م107\/3\)/);
  // الشهر المدفوع لمرض المولود يحمل سؤال «الشهر» حيث يكلف يومًا بأجر، لا تحت التمديد بلا أجر وحده.
  assert.ok(by.maternity_ext_sick_child.open.some(q=>/«الشهر» المدفوع/.test(q)&&/31 يومًا/.test(q)&&/م151/.test(q)));assert.equal(by.maternity_ext_sick_child.entitlement.days,30,'no figure raised without a source');
  // لائحة الشركة م84(1)–(2) في النص الذي يعتمده مدير الموارد البشرية. عُدِّل هذا السطر مرة واحدة في 22 سبتمبر 2026 (fix/signed-regulation-2):
  // كان يثبّت أن التقديم والتأخير «لم يُبنَ في المنصة»، والنسخة الموقعة (م84، ص 29) تنص عليهما بشرطهما واتجاههما، فبُنيا في خطة العطل والنص يقول ذلك.
  assert.match(REGULATION_PUBLIC_HOLIDAYS.compensation_ar,/م84\(1\)–\(2\)/);assert.match(REGULATION_PUBLIC_HOLIDAYS.shift_ar,/مبنيان في خطة العطل/);
  // كتلة قرار حسم الإجازة بلا أجر تستشهد بالنظام بجوار اللائحة، وتقول إن خيار «المجموع كله» ينزل عن ظاهر نصه.
  assert.deepEqual(REGULATION_UNPAID_LEAVE.law_articles,['نظام العمل م116','اللائحة التنفيذية م25']);assert.ok(REGULATION_UNPAID_LEAVE.rules_ar.some(r=>/فيما زاد على عشرين يومًا/.test(r)&&/نظام العمل م116/.test(r)));
  assert.ok(REGULATION_UNPAID_LEAVE.open.some(q=>/ينزل عن ظاهر النص النظامي/.test(q)&&/نظام العمل م116/.test(q)));
  // الإجازة التعويضية: ترك العمل له مادته، وانقضاء المهلة على رأس العمل سكوتٌ يُقال سكوتًا لا مادةً.
  const leaving=by.compensatory.rules_ar.find(r=>/م22 مكرر\/4/.test(r)),lapsed=by.compensatory.rules_ar.find(r=>/ساكتة/.test(r));
  assert.match(leaving,/ترك العامل العمل/);assert.doesNotMatch(leaving,/انقضاء مهلته/);assert.ok(lapsed&&!/م22 مكرر\/4/.test(lapsed),'the expiry branch is not attributed to an article that does not cover it');
  assert.ok(by.compensatory.rules_ar.some(r=>/أكبر القراءتين/.test(r)));assert.ok(by.compensatory.open.some(q=>/أجر الإجازات التعويضية المستحقة/.test(q)&&/أكبرهما/.test(q)));
  assert.equal(articlesText(by.hajj),'نظام العمل م114');assert.equal(articlesText(by.annual).startsWith('م80، م86، نظام العمل م109'),true);assert.equal(articlesText({articles:['87']}),'م87','a version-2 type without law_articles reads as before');
});

test('leave law 2025: Hajj leave — two years of service, once, ten to fifteen calendar days including Eid, with an electronic declaration',t=>{
  const {db,ask,act,holiday}=fixture(t);
  for(const day of ['2027-05-16','2027-05-17','2027-05-18','2027-05-19'])holiday(day);
  const range={leave_type:'hajj',start_date:'2027-05-10',end_date:'2027-05-21',declaration:true};
  // سنتان متصلتان (نظام العمل م114): من بدأ في يونيو 2026 لا تتحقق له في مايو 2027.
  assert.throws(()=>ask(range,'outsider'),error=>error.code==='service_required'&&/730 يومًا/.test(error.message)&&/نظام العمل م114/.test(error.message)&&/2028-05-31/.test(error.message));
  assert.throws(()=>ask({...range,declaration:undefined}),error=>error.code==='declaration_required'&&/لم أؤدِّ فريضة الحج/.test(error.message));
  assert.throws(()=>ask({...range,end_date:'2027-05-18'}),error=>error.code==='entitlement_minimum'&&/لا تقل عن 10 أيام/.test(error.message));
  assert.throws(()=>ask({...range,end_date:'2027-05-25'}),code('entitlement_exceeded'));
  assert.throws(()=>ask({...range,half_day:true,end_date:range.start_date}),code('half_day_not_allowed'));
  const hajj=ask(range);
  assert.equal(hajj.days,12,'calendar days, and the four Eid days inside are counted: «including the Eid al-Adha holiday»');assert.equal(hajj.unit,'calendar');assert.equal(hajj.terms.source,'none');
  assert.ok(hajj.terms.warnings.some(w=>/إقرار مقدم الطلب بهويته/.test(w)&&/لم أؤدِّ فريضة الحج/.test(w)),'the declaration is kept with the immutable terms');
  assert.equal(hajj.terms.articles_text,'نظام العمل م114');assert.ok(hajj.terms.pay_summary.fully_paid);
  // مرة واحدة طوال الخدمة: القائم يمنع، والمرفوض لا يمنع.
  assert.throws(()=>ask({...range,start_date:'2027-11-01',end_date:'2027-11-10'}),error=>error.code==='once_in_service'&&/مرة واحدة/.test(error.message));
  act('manager',hajj,'reject',{note:'رفض تجريبي لاختبار إعادة التقديم'});
  assert.equal(ask(range).days,12);
  assert.throws(()=>ask({leave_type:'emergency',start_date:'2027-06-01',end_date:'2027-06-01',declaration:true}),code('declaration'));
  assert.equal(verifyAudit(db),true);
});

test('leave law 2025: the yearly number of Hajj leaves is the company\'s to set — an open question until written, enforced once it is',t=>{
  assert.equal(REGULATION_LEAVE_TYPES.find(x=>x.code==='hajj').limits.annual_quota,null);
  assert.ok(REGULATION_LEAVE_TYPES.find(x=>x.code==='hajj').open.some(q=>/العدد السنوي/.test(q)));
  const {ask}=fixture(t,{outsiderStart:'2024-06-01',mutate:p=>{p.types.find(x=>x.code==='hajj').limits.annual_quota=1;}});
  assert.equal(ask({leave_type:'hajj',start_date:'2027-05-10',end_date:'2027-05-21',declaration:true}).days,12);
  assert.throws(()=>ask({leave_type:'hajj',start_date:'2027-05-10',end_date:'2027-05-21',declaration:true},'outsider'),error=>error.code==='annual_quota'&&/نظام العمل م114/.test(error.message));
});

test('leave law 2025: exam leave without the company\'s approval comes from annual leave if there is any, otherwise it is unpaid as of right (Art. 115/2)',t=>{
  const {db,ask,opening}=fixture(t);
  const day={leave_type:'exam',start_date:'2026-12-06',end_date:'2026-12-07',document:pdf('exam')};
  assert.throws(()=>ask({...day,variant:'not_approved'}),error=>error.code==='exam_not_approved'&&/بلا أجر بعدد أيام الامتحان/.test(error.message)&&/بحالة «أيام امتحان»/.test(error.message)&&/م115\/2/.test(error.message));
  // لا رصيد سنوي يمكن التحقق منه: يُقبل بتنبيه للمعتمدين، بلا أجر.
  const unverified=ask({...day,variant:'not_approved_unpaid'});
  assert.equal(unverified.terms.pay.every(p=>p.rate_bp===0),true);assert.ok(unverified.terms.warnings.some(w=>/تعذر التحقق من نفاد رصيد/.test(w)));
  // رصيد سنوي يغطي اليومين: تؤخذ منه. ورصيد لا يغطيهما: بلا أجر كحق.
  const covered=fixture(t);covered.opening('employee','annual',5);
  assert.throws(()=>covered.ask({...day,variant:'not_approved_unpaid'}),error=>error.code==='balance_remaining'&&/م115\/2/.test(error.message));
  const short=fixture(t);short.opening('employee','annual',1);
  const unpaid=short.ask({...day,variant:'not_approved_unpaid'});
  assert.equal(unpaid.days,2);assert.equal(unpaid.terms.pay_summary.unpaid_days,2);
  void db;void opening;
});

test('leave law 2025: a pregnant widow extends iddah without pay, and birth leave past the seventh day warns the approvers without refusing',t=>{
  const {ask}=fixture(t);
  const extension=ask({leave_type:'iddah_ext_pregnant',start_date:'2026-10-01',end_date:'2026-11-15',document:pdf('pregnancy')});
  assert.equal(extension.unit,'calendar');assert.equal(extension.terms.pay_summary.fully_paid,false);assert.equal(extension.terms.articles_text,'نظام العمل م160');assert.equal(extension.terms.document_required,true);
  const late=ask({leave_type:'birth',start_date:'2026-12-20',end_date:'2026-12-22',event_date:'2026-12-01'});
  assert.ok(late.terms.warnings.some(w=>/بعد اليوم 7 من تاريخ الولادة/.test(w)&&/نظام العمل م113/.test(w)),'the regulation did not limit it, so it is a warning, not a refusal');
  const onTime=fixture(t).ask({leave_type:'birth',start_date:'2026-12-02',end_date:'2026-12-06',event_date:'2026-12-01'});
  assert.equal(onTime.terms.warnings.some(w=>/بعد اليوم 7/.test(w)),false);
});

test('leave law 2025: Eid days that fall on the weekly rest are compensated after the holiday (Executive Regulation Art. 24)',()=>{
  // عيد الفطر 2027 يبدأ الأربعاء 10 مارس: الجمعة 12 والسبت 13 داخل أيامه، فيُعوَّضان بالأحد 14 والاثنين 15.
  const fitr=statutoryHolidayPlan(2027,{eid_al_fitr_start:'2027-03-10'}).filter(h=>h.key==='eid_al_fitr');
  assert.deepEqual(fitr.filter(h=>h.kind==='holiday').map(h=>h.date),['2027-03-10','2027-03-11','2027-03-12','2027-03-13']);
  assert.deepEqual(fitr.filter(h=>h.kind==='compensation').map(h=>h.date),['2027-03-14','2027-03-15']);
  assert.match(fitr.at(-1).basis,/اللائحة التنفيذية م24/);
  // عيد يبدأ الأحد: لا يوم منه في الراحة الأسبوعية، فلا تعويض.
  assert.equal(statutoryHolidayPlan(2027,{eid_al_adha_start:'2027-05-16'}).filter(h=>h.key==='eid_al_adha'&&h.kind==='compensation').length,0);
  // اليوم الوطني داخل أيام عيد: لا تعويض له ولا تكرار.
  const inside=statutoryHolidayPlan(2033,{eid_al_adha_start:'2033-09-22'});
  assert.equal(inside.filter(h=>h.key==='national_day').length,0);
});

test('leave law 2025: the policy assistant reads the new types with their law articles, and the HR screen shows the parameters, the sources and what is not built',t=>{
  const {db,users,policyId}=fixture(t);
  const article=articlesOf(db,users.hr,'2026-09-21').find(a=>a.id===policyId);
  const paragraph=code=>article.paragraphs.find(p=>p.code===code);
  assert.match(paragraph('hajj').text,/إجازة الحج \(نظام العمل م114\)/);assert.match(paragraph('compensatory').text,/ساعة ونصف/);
  assert.equal(paragraph('annual').number,2,'accepted numbering is unchanged: new types come last');
  assert.equal(paragraph('unpaid_limit').number,REGULATION_LEAVE_TYPES.length+2);assert.ok(paragraph('compensatory_rule'));
  const view=leavePolicies(db,users.hr).find(p=>p.id===policyId);
  assert.equal(view.version,3);assert.ok(view.types.every(x=>typeof x.articles_text==='string'&&x.articles_text.length>2));
  const hrData={...listLeave(db,users.hr),user:users.hr},html=leaveUI.render(hrData,helpers);
  for(const phrase of ['إجازة الحج','الإجازة التعويضية عن العمل الإضافي','كل ساعة عمل إضافية =','ما رُوجع وعلى أي مصدر','laws.boe.gov.sa','ساعة الرضاعة','غير متاح في المنصة بعد','نظام العمل م114'])assert.ok(html.includes(phrase),phrase);
  assert.equal(/م<\/small>|· م<|· م /.test(html),false,'a type with no regulation article never prints a bare «م»');
  // نموذج الطلب: الإقرار يُرسل للنوع الذي يشترطه فقط، والمعاينة الحية تذكره.
  const data={...listLeave(db,users.employee),user:users.employee},spec=leaveUI.form('request','new',data);
  assert.ok(spec.fields.some(f=>f.name==='declaration'&&/لم أؤدِّ فريضة الحج/.test(f.label)));
  assert.equal(spec.toPayload({leave_type:'hajj',start_date:'2027-05-10',end_date:'2027-05-21',declaration:'on',reason:'حج'}).declaration,true);
  assert.equal('declaration' in spec.toPayload({leave_type:'annual',start_date:'2026-11-01',end_date:'2026-11-02',declaration:'on',reason:'سنوية'}),false);
  assert.match(leavePreview({leave_type:'hajj'},data,e),/يلزم تأكيد الإقرار/);
});

test('leave law 2025: the draft form lets HR set the compensatory ratio and deadline, in hours per hour and days, within the legal bounds',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-leave-law-draft');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const hrData={...listLeave(db,users.hr),user:users.hr},spec=leaveUI.form('prepare_types','new',hrData);
  const ratio=spec.fields.find(f=>f.name==='compensatory_ratio'),within=spec.fields.find(f=>f.name==='compensatory_use_within_days');
  assert.deepEqual([ratio.value,ratio.min,within.value,within.max],['1.5','1.5',60,60]);
  assert.deepEqual(spec.toPayload({effective_from:'2026-01-01',compensatory_ratio:'1.75',compensatory_use_within_days:'45'}),{effective_from:'2026-01-01',compensatory_ratio_bp:17500,compensatory_use_within_days:45});
  const id=transaction(db,()=>prepareLeaveTypesDraft(db,users.hr,spec.toPayload({effective_from:'2026-01-01',compensatory_ratio:'1.75',compensatory_use_within_days:'45'}))).id;
  assert.equal(JSON.parse(db.prepare('SELECT parameters FROM leave_type_policies WHERE id=?').get(id).parameters).compensatory.ratio_bp,17500);
  // قبل أي سياسة: الشاشة ترسم مسودة الشيفرة بموادها ومصادرها.
  const html=leaveUI.render(hrData,helpers);
  assert.ok(html.includes('إعداد مسودة من نص اللائحة ونظام العمل'));assert.ok(html.includes(`الأنواع وأحكامها (${REGULATION_LEAVE_TYPES.length})`));
});

test('leave law 2025: exam days are never left without a door — in probation or at the split limit they still come from annual leave (Art. 115/2)',t=>{
  // موظف في فترة التجربة (بدأ قبل 30 يومًا، التجربة 90) وله رصيد سنوي يغطي يومي الامتحان: كانت الأبواب الأربعة كلها مغلقة.
  const start=sundayAfter(20),end=addDays(start,1),year=Number(start.slice(0,4)),exam={start_date:start,end_date:end,document:pdf('exam')};
  const probation=fixture(t,{outsiderStart:addDays(today(),-30),years:[year]});probation.opening('outsider','annual',10,year);
  assert.throws(()=>probation.ask({...exam,leave_type:'annual',document:undefined},'outsider'),error=>error.code==='probation'&&/حالة «أيام امتحان»/.test(error.message)&&/م115\/2/.test(error.message));
  assert.throws(()=>probation.ask({...exam,leave_type:'exam',variant:'not_approved_unpaid'},'outsider'),error=>error.code==='balance_remaining'&&/بحالة «أيام امتحان»/.test(error.message));
  const fromAnnual=probation.ask({...exam,leave_type:'annual',variant:'exam_days'},'outsider');
  assert.equal(fromAnnual.days,2);assert.equal(fromAnnual.terms.variant,'exam_days');assert.ok(fromAnnual.terms.pay_summary.fully_paid,'taken from the annual balance, at full pay');assert.equal(fromAnnual.terms.document_required,true);
  assert.ok(fromAnnual.terms.warnings.some(w=>/لا يسري عليها قيد فترة التجربة ولا حد التجزئة/.test(w)&&/م115\/2/.test(w)),'the approvers are told why the restriction did not apply');
  // مهلة الإشعار النظامية (م115/3–4) تسري على الحالة، والحالة المكتوبة يجب أن تكون من حالات النوع.
  assert.throws(()=>probation.ask({leave_type:'annual',variant:'exam_days',start_date:addDays(today(),3),end_date:addDays(today(),3)},'outsider'),error=>error.code==='notice_required'&&/م115\/3–4/.test(error.message));
  assert.throws(()=>probation.ask({...exam,leave_type:'annual',variant:'nonsense'},'outsider'),code('variant'));
  // حد التجزئة: ست تجزئات قائمة، والسابعة العادية تُرفض، وأيام الامتحان لا تُعد تجزئة ولا يمنعها الحد.
  const split=fixture(t,{years:[year]});split.opening('employee','annual',20,year);
  const firstWorkday=from=>{let d=from;while(new Date(d+'T00:00:00Z').getUTCDay()>4||d.slice(0,4)!==String(year))d=addDays(d,d.slice(0,4)===String(year)?1:-400);return d;};
  let day=firstWorkday(addDays(end,2));
  for(let i=0;i<6;i++){split.ask({leave_type:'annual',start_date:day,end_date:day});day=firstWorkday(addDays(day,1));}
  assert.throws(()=>split.ask({leave_type:'annual',start_date:day,end_date:day}),error=>error.code==='split_limit'&&/حالة «أيام امتحان»/.test(error.message));
  assert.equal(split.ask({...exam,leave_type:'annual',variant:'exam_days'}).days,2);
  assert.throws(()=>split.ask({leave_type:'annual',start_date:day,end_date:day}),code('split_limit'),'an exam request neither consumes nor frees a split');
  // سياسة اعتُمدت بلا حالة «أيام امتحان»: الرصيد يغطي لكنه لا يُنال في التجربة، فقد «تعذر ذلك»: تُمنح بلا أجر ويُقال السبب للمعتمدين.
  const older=fixture(t,{outsiderStart:addDays(today(),-30),years:[year],mutate:p=>{const annual=p.types.find(x=>x.code==='annual');delete annual.variants;delete annual.variant_optional;}});
  older.opening('outsider','annual',10,year);
  const unpaid=older.ask({...exam,leave_type:'exam',variant:'not_approved_unpaid'},'outsider');
  assert.equal(unpaid.terms.pay_summary.unpaid_days,2);assert.ok(unpaid.terms.warnings.some(w=>/لا يُنال فيها/.test(w)&&/فترة التجربة/.test(w)&&/م115\/2/.test(w)));
  // خارج التجربة وبلا حد بلغه: الرصيد يغطي ويُنال، فتؤخذ منه كما كان.
  const normal=fixture(t,{years:[year]});normal.opening('employee','annual',5,year);
  assert.throws(()=>normal.ask({...exam,leave_type:'exam',variant:'not_approved_unpaid'}),code('balance_remaining'));
});
