import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { preparePolicy, decidePolicy, prepareContract, contractAction } from '../app/hr-contracts.mjs';
import { compensationBoard, prepareBand, decideBand, createCompCycle, compCycleAction, proposeIncrease, proposalAction, recommendationAction, setGapPrivacy } from '../app/compensation.mjs';
import { recordDemographics } from '../app/workforce.mjs';

const code=value=>error=>error.code===value;
const time=()=>new Date().toISOString();
const contractInput=(user_id,basic)=>({user_id,contract_type:'indefinite',job_title:'وظيفة تجريبية',work_location:'الرياض',start_date:'2024-01-01',weekly_hours:40,probation_days:0,notice_days:30,pay_lines:[{component:'basic',amount:basic}],document_reference:'ملف عقد تجريبي'});
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-hr-cases-comp');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const grant=(user,cap,tenant='36t')=>db.prepare('INSERT INTO access_grants(id,tenant_id,user_id,capability,note,granted_by,granted_at) VALUES(?,?,?,?,?,?,?)').run(`g-${user}-${cap}`,tenant,user,cap,'تجريبي','admin',time());
  for(const cap of ['hr.policy.accept','hr.contracts.approve','hr.compensation.review'])grant('it',cap);
  grant('hr','hr.compensation.review');
  // الراتب الحالي مصدره العقد الساري، فيُنشأ عبر مسار العقود القائم نفسه.
  const policy=tx(()=>preparePolicy(db,users.hr,{kind:'pay_components',title:'بنود تجريبية',body:'سياسة بنود راتب تجريبية للاختبار فقط',basis:'قرار تجريبي للاختبار',effective_from:'2020-01-01',parameters:{components:['basic','housing']}}));
  tx(()=>decidePolicy(db,users.it,policy.id,'accept',{note:'اعتماد تجريبي للاختبار'}));
  const contracts={};
  for(const [who,basic] of [['employee','10000'],['outsider','10000'],['manager','20000']]){
    const {id}=tx(()=>prepareContract(db,users.hr,contractInput(who,basic)));
    tx(()=>contractAction(db,users.hr,id,'submit_contract',{version:1}));
    tx(()=>contractAction(db,users.it,id,'approve_contract',{version:2,note:'اعتماد تجريبي'}));
    contracts[who]=id;
  }
  db.prepare("INSERT INTO job_categories(id,tenant_id,code,name,created_by,created_at,updated_at) VALUES('cat-design','36t','DESIGN','مصمم تجريبي','hr',?,?)").run(time(),time());
  for(const who of ['employee','outsider'])db.prepare("INSERT INTO employee_job_categories(id,tenant_id,user_id,category_id,effective_from,basis,assigned_by,created_at) VALUES(?,'36t',?,'cat-design','2024-01-01','تعيين تجريبي','hr',?)").run('ejc-'+who,who,time());
  return {db,users,tx,contracts};
}
function openCycle(db,users,tx,budget='5000'){
  const band=tx(()=>prepareBand(db,users.hr,{category_id:'cat-design',level:'2',min:'9000',mid:'11000',max:'13000',effective_from:'2025-01-01',source:'جدول نطاقات تجريبي أقره المالك في محضر تجريبي'}));
  tx(()=>decideBand(db,users.it,band.id,'approve',{version:1,note:'مطابق للمحضر التجريبي'}));
  const cycle=tx(()=>createCompCycle(db,users.hr,{name:'مراجعة 2026 التجريبية',year:2026,budget,budget_source:'ميزانية تجريبية أقرها المالك',increases_effective_from:'2026-10-01'}));
  tx(()=>compCycleAction(db,users.it,cycle.id,'open',{version:1,note:'فتح تجريبي'}));
  return {band:band.id,cycle:cycle.id};
}
const proposal=(db,u,cycleId,userId)=>compensationBoard(db,u).cycles.find(c=>c.id===cycleId).proposals.find(p=>p.user_id===userId);

test('salary bands: entered with a written source, approved by someone other than the preparer, and never revised once approved',t=>{
  const {db,users,tx}=fixture(t);
  const input={category_id:'cat-design',level:'1',min:'8000',mid:'9000',max:'10000',effective_from:'2025-01-01',source:'جدول نطاقات تجريبي'};
  assert.throws(()=>tx(()=>prepareBand(db,users.manager,input)),code('not_permitted'));
  assert.throws(()=>tx(()=>prepareBand(db,users.hr,{...input,source:'قصير'})),code('invalid_text'),'no band without a source');
  assert.throws(()=>tx(()=>prepareBand(db,users.hr,{...input,mid:'11000'})),code('band_order'));
  const {id}=tx(()=>prepareBand(db,users.hr,input));
  assert.throws(()=>tx(()=>decideBand(db,users.hr,id,'approve',{version:1,note:'اعتماد ذاتي تجريبي'})),code('separation_of_duties'));
  assert.throws(()=>db.prepare("UPDATE salary_bands SET status='approved',decided_by='hr',decided_at='x',version=version+1 WHERE id=?").run(id),/CHECK constraint/);
  assert.throws(()=>tx(()=>decideBand(db,users.it,id,'approve',{version:9,note:'نسخة قديمة تجريبية'})),code('stale_version'));
  tx(()=>decideBand(db,users.it,id,'approve',{version:1,note:'مطابق للمصدر التجريبي'}));
  assert.throws(()=>db.prepare('UPDATE salary_bands SET max_minor=max_minor+1,version=version+1 WHERE id=?').run(id),/never revised/);
  assert.equal(compensationBoard(db,users.manager).bands.length,0,'managers do not see bands');
  assert.ok(verifyAudit(db));
});

test('compensation cycle: the budget is a hard ceiling in SQL, no one proposes for themselves, and only direct managers propose',t=>{
  const {db,users,tx,contracts}=fixture(t);
  const {cycle}=openCycle(db,users,tx);
  const created=tx(()=>createCompCycle(db,users.hr,{name:'دورة ثانية تجريبية',year:2027,budget:'100',budget_source:'ميزانية تجريبية ثانية',increases_effective_from:'2027-01-01'}));
  assert.throws(()=>tx(()=>compCycleAction(db,users.hr,created.id,'open',{version:1,note:'فتح ذاتي'})),code('separation_of_duties'),'whoever set the budget does not open the cycle');
  assert.throws(()=>tx(()=>proposeIncrease(db,users.manager,{cycle_id:cycle,user_id:'manager',increase:'100',rationale:'اقتراح لنفسي تجريبي مرفوض قطعًا'})),code('separation_of_duties'));
  assert.throws(()=>db.prepare("INSERT INTO compensation_proposals(id,tenant_id,cycle_id,user_id,proposed_by,increase_minor,currency,rationale,contract_id,current_monthly_minor,status,created_at,updated_at) VALUES('self','36t',?,'manager','manager',100,'SAR','اقتراح لنفسي تجريبي مرفوض قطعًا',?,1,'proposed','x','x')").run(cycle,contracts.manager),/CHECK constraint/);
  assert.throws(()=>tx(()=>proposeIncrease(db,users.outsider,{cycle_id:cycle,user_id:'employee',increase:'100',rationale:'زميل يقترح لزميل تجريبيًا'})),code('not_permitted'));
  tx(()=>proposeIncrease(db,users.manager,{cycle_id:cycle,user_id:'employee',increase:'1000',rationale:'أداء متسق وتوسع في المسؤوليات تجريبيًا'}));
  assert.throws(()=>tx(()=>proposeIncrease(db,users.manager,{cycle_id:cycle,user_id:'outsider',increase:'4500',rationale:'مقترح يتجاوز الميزانية تجريبيًا'})),error=>error.code==='over_budget'&&!/\d/.test(error.message),'the refusal does not disclose the remaining budget');
  assert.throws(()=>db.prepare("INSERT INTO compensation_proposals(id,tenant_id,cycle_id,user_id,proposed_by,increase_minor,currency,rationale,contract_id,current_monthly_minor,status,created_at,updated_at) VALUES('over','36t',?,'outsider','manager',450000,'SAR','تجاوز مباشر في القاعدة تجريبيًا',?,1000000,'proposed','x','x')").run(cycle,contracts.outsider),/exceed the cycle budget/);
  assert.throws(()=>tx(()=>proposeIncrease(db,users.external,{cycle_id:cycle,user_id:'employee',increase:'10',rationale:'محاولة من كيان معزول تجريبية'})),code('not_found'),'tenant isolation');
  assert.equal(compensationBoard(db,users.external).cycles.length,0);
  assert.ok(verifyAudit(db));
});

test('compensation confidentiality: a manager sees only their team’s proposals without salaries, and no one sees a proposal about themselves',t=>{
  const {db,users,tx}=fixture(t);
  const {cycle}=openCycle(db,users,tx);
  tx(()=>proposeIncrease(db,users.manager,{cycle_id:cycle,user_id:'employee',increase:'1000',rationale:'أداء متسق وتوسع في المسؤوليات تجريبيًا'}));
  // المدير بلا مدير نشط: يقترح له مراجع التعويضات.
  tx(()=>proposeIncrease(db,users.hr,{cycle_id:cycle,user_id:'manager',increase:'200',rationale:'اقتراح تجريبي من المراجع لمن لا مدير له'}));
  const managerView=compensationBoard(db,users.manager),text=JSON.stringify(managerView);
  const mine=managerView.cycles[0].proposals;
  assert.deepEqual(mine.map(p=>p.user_id),['employee'],'the manager does not see the proposal about himself');
  assert.equal(mine[0].salary_hidden,true);
  for(const hidden of ['current_monthly_minor','proposed_monthly_minor','band_position','budget_minor','1000000'])assert.ok(!text.includes(hidden),`manager view leaks ${hidden}`);
  for(const who of ['employee','outsider']){const view=compensationBoard(db,users[who]);assert.equal(view.cycles.flatMap(c=>c.proposals).length,0);assert.ok(!JSON.stringify(view).includes('current_monthly_minor'));}
  assert.throws(()=>tx(()=>proposalAction(db,users.outsider,proposal(db,users.hr,cycle,'employee').id,'withdraw',{version:1,note:'محاولة'})),code('not_found'));
  const reviewer=compensationBoard(db,users.hr).cycles[0];
  assert.equal(reviewer.remaining_minor,500000-120000);
  assert.ok(!reviewer.proposals.some(p=>p.user_id==='hr'));
  assert.equal(proposal(db,users.hr,cycle,'employee').current_monthly_minor,1000000,'the reviewer reads the salary from the active contract');
  assert.ok(verifyAudit(db));
});

test('compensation decision: out-of-band needs a written case and a higher, different approver; the proposer never approves; approval changes no contract',t=>{
  const {db,users,tx,contracts}=fixture(t);
  const {cycle,band}=openCycle(db,users,tx);
  // المعايرة معروضة لا محتسبة: درجة تجريبية تظهر بجانب المقترح ولا يتغير بها المبلغ.
  db.prepare("INSERT INTO review_cycles(id,tenant_id,name,period_from,period_to,scale_max,criteria,status,created_by,released_by,released_at,created_at,updated_at) VALUES('rc','36t','دورة أداء تجريبية','2025-01-01','2025-12-31',5,'[]','released','hr','it','2026-01-15T00:00:00.000Z','x','x')").run();
  db.prepare("INSERT INTO performance_reviews(id,tenant_id,cycle_id,user_id,reviewer_id,status,final_score_bp,created_at,updated_at) VALUES('pr','36t','rc','outsider','manager','released',420,'x','x')").run();
  tx(()=>proposeIncrease(db,users.manager,{cycle_id:cycle,user_id:'employee',increase:'1000',rationale:'أداء متسق وتوسع في المسؤوليات تجريبيًا'}));
  tx(()=>proposeIncrease(db,users.manager,{cycle_id:cycle,user_id:'outsider',increase:'3500',rationale:'استبقاء لمهارة نادرة في الفريق تجريبيًا'}));
  const out=proposal(db,users.hr,cycle,'outsider');
  assert.deepEqual(out.calibration,{cycle_name:'دورة أداء تجريبية',final_score:'4.20',scale_max:5,appeal_pending:false});
  assert.equal(out.increase_minor,350000,'the amount is what the manager wrote, not a function of the score');
  assert.throws(()=>tx(()=>proposalAction(db,users.hr,out.id,'assess',{version:1,band_id:band})),code('invalid_text'),'outside the band requires a written justification');
  tx(()=>proposalAction(db,users.hr,out.id,'assess',{version:1,band_id:band,exception_note:'يتجاوز أعلى النطاق للاستبقاء؛ الموافقة من مستوى أعلى'}));
  assert.equal(proposal(db,users.hr,cycle,'outsider').band_position,'above');
  assert.throws(()=>tx(()=>proposalAction(db,users.hr,out.id,'approve',{version:2,note:'اعتماد من المقيّم نفسه'})),code('higher_approval_required'));
  assert.throws(()=>db.prepare("UPDATE compensation_proposals SET status='approved',decided_by='hr',decided_at='x',decision_note='اعتماد صامت تجريبي',version=version+1 WHERE id=?").run(out.id),/CHECK constraint/);
  tx(()=>proposalAction(db,users.it,out.id,'approve',{version:2,note:'اعتماد أعلى تجريبي بعد الاطلاع على المبرر'}));
  const emp=proposal(db,users.hr,cycle,'employee');
  tx(()=>proposalAction(db,users.hr,emp.id,'assess',{version:1,band_id:band}));
  assert.equal(proposal(db,users.hr,cycle,'employee').band_position,'within');
  assert.throws(()=>tx(()=>proposalAction(db,users.manager,emp.id,'approve',{version:2,note:'المقترح يعتمد مقترحه'})),code('invalid_state'),'the proposer is not the approver');
  assert.throws(()=>tx(()=>proposalAction(db,users.it,emp.id,'approve',{version:1,note:'نسخة قديمة تجريبية'})),code('stale_version'));
  tx(()=>proposalAction(db,users.it,emp.id,'approve',{version:2,note:'داخل النطاق ومبرر تجريبيًا'}));
  assert.throws(()=>db.prepare("UPDATE compensation_proposals SET decision_note='تعديل صامت بعد الاعتماد',version=version+1 WHERE id=?").run(emp.id),/decided proposal is final/);
  // الاعتماد لا يمس العقد: يبقى الساري كما هو وتنشأ توصية.
  assert.equal(db.prepare('SELECT monthly_total_minor FROM employment_contracts WHERE id=?').get(contracts.employee).monthly_total_minor,1000000);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM employment_contracts WHERE user_id='employee'").get().n,1);
  const rec=compensationBoard(db,users.hr).recommendations.find(r=>r.user_id==='employee');
  assert.equal(rec.recommended_monthly_minor,1100000);assert.deepEqual(rec.actions,['link_contract','drop_recommendation']);
  assert.equal(compensationBoard(db,users.manager).recommendations.length,0);
  assert.deepEqual(compensationBoard(db,users.employee).my_increases.map(r=>r.recommended_monthly_minor),[1100000],'the employee sees their own outcome');
  assert.throws(()=>tx(()=>recommendationAction(db,users.hr,rec.id,'link',{version:1,contract_id:contracts.employee})),code('contract_not_eligible'));
  // نقطة الوصل: نسخة العقد الجديدة تُعد عبر مسار «تعديل العقد» القائم ثم تُربط.
  const amended=tx(()=>prepareContract(db,users.hr,{...contractInput(undefined,'11000'),start_date:'2026-10-01',change_reason:'تنفيذ زيادة معتمدة في مراجعة 2026 التجريبية'},contracts.employee));
  tx(()=>recommendationAction(db,users.hr,rec.id,'link',{version:1,contract_id:amended.id}));
  const done=compensationBoard(db,users.hr).recommendations.find(r=>r.id===rec.id);
  assert.equal(done.status,'fulfilled');assert.equal(done.new_contract.matches_recommendation,true);
  assert.throws(()=>db.prepare("UPDATE compensation_recommendations SET closing_note='تعديل صامت',version=version+1 WHERE id=?").run(rec.id),/settled recommendation is final/);
  tx(()=>compCycleAction(db,users.hr,cycle,'close',{version:2,note:'إقفال تجريبي'}));
  assert.throws(()=>tx(()=>proposeIncrease(db,users.manager,{cycle_id:cycle,user_id:'employee',increase:'10',rationale:'بعد الإغلاق تجريبيًا للتحقق'})),code('invalid_state'));
  assert.ok(verifyAudit(db));
});

test('pay gap analysis: aggregate only, unavailable until a minimum group size is set, and small groups are suppressed with their counts',t=>{
  const {db,users,tx}=fixture(t);
  assert.equal(compensationBoard(db,users.hr).pay_gap.available,false);
  assert.throws(()=>tx(()=>setGapPrivacy(db,users.manager,{min_group_size:5,effective_from:'2026-01-01',basis:'إعداد تجريبي للاختبار'})),code('not_permitted'));
  assert.throws(()=>tx(()=>setGapPrivacy(db,users.hr,{min_group_size:2,effective_from:'2026-01-01',basis:'إعداد تجريبي للاختبار'})),code('min_group_size'));
  tx(()=>setGapPrivacy(db,users.hr,{min_group_size:3,effective_from:'2026-01-01',basis:'إعداد تجريبي للاختبار'}));
  for(const [who,gender] of [['employee','female'],['outsider','male'],['manager','male']])tx(()=>recordDemographics(db,users.hr,who,{version:0,nationality_group:'saudi',gender,source:'هوية وطنية تجريبية'}));
  const gap=compensationBoard(db,users.hr).pay_gap;
  assert.equal(gap.available,true);
  for(const g of gap.groups){assert.equal(g.suppressed,true);assert.deepEqual(Object.keys(g).sort(),['label','suppressed']);}
  assert.equal(compensationBoard(db,users.manager).pay_gap,null);
  assert.ok(verifyAudit(db));
});
