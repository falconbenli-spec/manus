import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { logTime, decideTime } from '../app/agency.mjs';
import { costRatesBoard, createCategory, categoryAction, prepareCostRate, costRateAction, assignCategory,
  prepareOverheadRate, overheadRateAction, tagProjectService,
  projectProfitability, clientProfitability, serviceProfitability, profitabilityBoard } from '../app/profitability.mjs';

const code=value=>error=>error.code===value;
const riyadh=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const back=n=>new Date(Date.parse(riyadh()+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-profitability');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  // حاملان لتصريح التكلفة حتى يعتمد أحدهما ما أعده الآخر، وحاملان للاطلاع على الربحية.
  for(const [user_id,capability] of [['manager','costing.manage'],['hr','costing.manage'],['manager','profitability.view'],['it','profitability.view']])
    tx(()=>grantAccess(db,users.admin,{user_id,capability,department_id:'',note:'تهيئة اختبار'}));
  const project=tx(()=>createProject(db,users.manager,{name:'مشروع تجريبي','brief':'موجز تجريبي للاختبار',member_ids:['employee']}));
  return {db,users,tx,project};
}

// فئة وظيفية لها معدل معتمد، جاهزة لتكلفة الساعات.
function pricedCategory(db,users,tx,{from,rate,codeText='SENIOR'}){
  const category=tx(()=>createCategory(db,users.manager,{code:codeText,name:'مصمم أول (تجريبي)',description:''}));
  tx(()=>assignCategory(db,users.manager,{user_id:'employee',category_id:category.id,effective_from:back(90),basis:'إسناد تجريبي موثق'}));
  const r=tx(()=>prepareCostRate(db,users.manager,{category_id:category.id,effective_from:from,rate_amount:rate,source:'مصدر تجريبي معتمد من صاحب الإجراء بتاريخه'}));
  tx(()=>costRateAction(db,users.hr,r.id,'approve_rate',{version:1,note:'اعتماد تجريبي بعد مراجعة المصدر'}));
  return category;
}
// فاتورة صادرة منسوبة لمشروع: تُبنى سلسلتها التجارية مباشرة لأن المختبَر هنا قراءة الإيراد لا مسار الفوترة.
function issuedInvoice(db,projectId,{netMinor,supplyDate,sequence=1}){
  const time=now(),ids={case:randomUUID(),qual:randomUUID(),quote:randomUUID(),contract:randomUUID(),claim:randomUUID(),invoice:randomUUID()};
  const snapshot=JSON.stringify({currency:'SAR',net_minor:String(netMinor),tax_minor:'0',total_minor:String(netMinor),lines:[]});
  db.prepare("INSERT INTO commercial_cases(id,tenant_id,department_id,owner_id,name,registration_number,contact,source,sector,status,project_id,created_at,updated_at) VALUES(?,'36t','creative','manager','عميل تجريبي',?,'جهة اتصال تجريبية','اختبار','خدمات','project_active',?,?,?)").run(ids.case,'REG-'+ids.case.slice(0,8),projectId,time,time);
  db.prepare("INSERT INTO commercial_qualifications VALUES(?,?,1,?, 'manager',?)").run(ids.qual,ids.case,snapshot,time);
  db.prepare("INSERT INTO commercial_quotes VALUES(?,?,?,1,?,'digest','manager',?)").run(ids.quote,ids.case,ids.qual,snapshot,time);
  db.prepare("INSERT INTO commercial_contracts VALUES(?,?,?,?,'سند اتفاق تجريبي','ممثل تجريبي','manager',?)").run(ids.contract,ids.case,ids.quote,snapshot,time);
  db.prepare("INSERT INTO ar_claims(id,tenant_id,contract_id,project_id,case_id,prepared_by,basis,advance_clause,source_snapshot,currency,amount_minor,due_date,entitlement_evidence,status,version,created_at,updated_at) VALUES(?,'36t',?,?,?,'manager','advance','بند دفعة مقدمة تجريبي','{}','SAR',?,?,'سند استحقاق تجريبي','approved',1,?,?)")
    .run(ids.claim,ids.contract,projectId,ids.case,String(netMinor),supplyDate,time,time);
    // الترحيل 151 أضاف رموز المستند إلزاميةً على tax_invoices (نوع المستند وفئة الضريبة ووسيلة السداد)،
  // فالإدراج المباشر في هذا الاختبار يحملها كما يحملها مسار prepareInvoice الحقيقي.
db.prepare("INSERT INTO tax_invoices(id,tenant_id,kind,claim_id,project_id,sequence,number,issued_at,supply_date,seller,buyer,lines,vat_category,vat_basis_points,vat_reason,currency,net_minor,vat_minor,total_minor,document_type_code,tax_category_code,payment_means_code,status,prepared_by,issued_by,chain_index,previous_hash,hash,qr_tlv,created_at,updated_at) VALUES(?,'36t','invoice',?,?,?,?,?,?,'{}','{}','[]','zero_rated',0,'سبب تجريبي لعدم تطبيق النسبة','SAR',?,0,?,388,'Z','1','issued','manager','hr',?,'','hash-'||?,'qr',?,?)")
    .run(ids.invoice,ids.claim,projectId,sequence,'INV-TEST-'+sequence,time,supplyDate,netMinor,netMinor,sequence,String(sequence),time,time);
  return ids;
}

test('cost rates: the rate belongs to a job category and never to a person, its author never approves it, and an approved dated rate is final',t=>{
  const {db,users,tx}=fixture(t);
  // القاعدة الحاكمة محمية في المخطط نفسه، لا في الكود وحده: لا عمود يربط المعدل بفرد.
  const columns=db.prepare('SELECT name FROM pragma_table_info(?)').all('category_cost_rates').map(c=>c.name);
  assert.ok(!columns.includes('user_id')&&!columns.includes('employee_id'),'a cost rate must never be attributable to one person');

  assert.throws(()=>costRatesBoard(db,users.employee),code('not_permitted'));
  assert.throws(()=>tx(()=>createCategory(db,users.employee,{code:'X',name:'فئة',description:''})),code('not_permitted'));
  assert.throws(()=>createCategory(db,users.manager,{code:'X',name:'فئة',description:''}),code('transaction_required'));

  const category=tx(()=>createCategory(db,users.manager,{code:'senior designer',name:'مصمم أول (تجريبي)',description:'وصف تجريبي'}));
  assert.equal(db.prepare('SELECT code FROM job_categories WHERE id=?').get(category.id).code,'SENIOR-DESIGNER');
  const rate=tx(()=>prepareCostRate(db,users.manager,{category_id:category.id,effective_from:back(30),rate_amount:'100.00',source:'مصدر تجريبي مكتوب بتاريخ تأكيده'}));
  assert.throws(()=>tx(()=>costRateAction(db,users.manager,rate.id,'approve_rate',{version:1,note:'أعتمد ما أعددته بنفسي'})),code('self_approval'));
  assert.throws(()=>tx(()=>costRateAction(db,users.hr,rate.id,'approve_rate',{version:7,note:'نسخة قديمة من الشاشة'})),code('stale_version'));
  assert.throws(()=>tx(()=>prepareCostRate(db,users.manager,{category_id:category.id,effective_from:back(30),rate_amount:'120.00',source:'محاولة معدل موازٍ لليوم نفسه'})),code('duplicate_rate'));

  assert.ok(costRatesBoard(db,users.hr).awaiting_me.some(x=>x.id===rate.id),'the other capability holder is told a rate awaits their decision');
  tx(()=>costRateAction(db,users.hr,rate.id,'approve_rate',{version:1,note:'اعتماد بعد مراجعة المصدر المكتوب'}));
  assert.throws(()=>tx(()=>costRateAction(db,users.hr,rate.id,'reject_rate',{version:2,note:'تراجع بعد الاعتماد'})),code('already_decided'));
  assert.throws(()=>db.prepare("UPDATE category_cost_rates SET rate_minor=1,version=version+1 WHERE id=?").run(rate.id),/never revised/);

  const live=costRatesBoard(db,users.manager).categories.find(c=>c.id===category.id);
  assert.equal(live.live_rate.rate,'100.00');
  assert.equal(costRatesBoard(db,users.manager).benchmark,null,'the aggregate payroll reference stays hidden from anyone who cannot already see salaries');
  assert.ok(verifyAudit(db));
});

test('profitability: every approved hour is valued at the rate in force on the date of that hour, not the rate in force today',t=>{
  const {db,users,tx,project}=fixture(t);
  const category=pricedCategory(db,users,tx,{from:back(90),rate:'100.00'});
  // معدل أحدث يبدأ سريانه بين الساعتين: الساعة القديمة تبقى بمعدلها القديم.
  const second=tx(()=>prepareCostRate(db,users.hr,{category_id:category.id,effective_from:back(10),rate_amount:'200.00',source:'مراجعة سنوية موثقة بمصدرها وتاريخها'}));
  tx(()=>costRateAction(db,users.manager,second.id,'approve_rate',{version:1,note:'اعتماد المراجعة السنوية بعد المطابقة'}));

  for(const [date,minutes,billable] of [[back(20),120,true],[back(2),60,false]]){
    const entry=tx(()=>logTime(db,users.employee,{project_id:project.id,work_date:date,minutes,billable,note:'عمل تجريبي مسجل'}));
    tx(()=>decideTime(db,users.manager,entry.id,'approve',{note:''}));
  }
  issuedInvoice(db,project.id,{netMinor:100000,supplyDate:riyadh()});

  const result=projectProfitability(db,users.manager,{project_id:project.id});
  // 120 دقيقة بمعدل 100 ريال + 60 دقيقة بمعدل 200 ريال = 200 + 200 ريال.
  assert.equal(result.cost.time_minor,40000);
  assert.equal(result.revenue.net_minor,100000);
  assert.equal(result.margin.amount_minor,60000);
  assert.equal(result.margin.bp,6000);
  assert.equal(result.hours.approved_minutes,180);
  assert.equal(result.hours.billable_bp,6667,'billable utilisation is billable approved minutes over approved minutes');
  assert.equal(result.coverage.uncosted_minutes,0);
  assert.equal(result.forecast.expected_revenue_source,'none','no baseline was recorded, so no margin at completion is claimed');

  // اعتماد معدل أعلى اليوم لا يعيد تسعير ما مضى.
  const third=tx(()=>prepareCostRate(db,users.hr,{category_id:category.id,effective_from:riyadh(),rate_amount:'900.00',source:'معدل جديد يسري من اليوم بمصدره المكتوب'}));
  tx(()=>costRateAction(db,users.manager,third.id,'approve_rate',{version:1,note:'اعتماد المعدل الجديد الساري من اليوم'}));
  assert.equal(projectProfitability(db,users.manager,{project_id:project.id}).cost.time_minor,40000,'a new rate never reprices hours already worked');
  assert.ok(verifyAudit(db));
});

test('profitability: unapproved hours and hours with no rate are declared, never silently valued at zero',t=>{
  const {db,users,tx,project}=fixture(t);
  const category=pricedCategory(db,users,tx,{from:back(90),rate:'100.00'});

  const approved=tx(()=>logTime(db,users.employee,{project_id:project.id,work_date:back(3),minutes:60,billable:true,note:'ساعة معتمدة'}));
  tx(()=>decideTime(db,users.manager,approved.id,'approve',{note:''}));
  tx(()=>logTime(db,users.employee,{project_id:project.id,work_date:back(2),minutes:120,billable:true,note:'ساعة لم يقررها أحد بعد'}));

  const partial=projectProfitability(db,users.manager,{project_id:project.id});
  assert.equal(partial.cost.time_minor,10000,'only approved hours are costed');
  assert.equal(partial.hours.unapproved_minutes,120);
  assert.equal(partial.hours.approval_coverage_bp,3333);
  assert.ok(partial.excluded.unapproved_hours_cost_minor>0,'what was left out is shown, not hidden');
  assert.ok(partial.caveats.some(x=>x.includes('غير معتمد')),'the screen says the figures rest on partly unapproved hours');

  // زميل بلا فئة وظيفية: ساعته لا تُحسب صفرًا، تُعلن غير مُكلَّفة بسببها.
  db.prepare('INSERT INTO project_members VALUES(?,?)').run(project.id,'outsider');
  const stranger=tx(()=>logTime(db,users.outsider,{project_id:project.id,work_date:back(1),minutes:180,billable:true,note:'عمل من خارج أي فئة'}));
  tx(()=>decideTime(db,users.manager,stranger.id,'approve',{note:''}));
  const gap=projectProfitability(db,users.manager,{project_id:project.id});
  assert.equal(gap.cost.time_minor,10000,'an hour with no category adds no cost and no pretend cost');
  assert.equal(gap.coverage.no_category_minutes,180);
  assert.ok(gap.caveats.some(x=>x.includes('بلا فئة وظيفية')));
  assert.ok(gap.caveats.some(x=>x.includes('تحميل عام')),'no approved overhead rate is stated, not assumed to be zero cost');

  // لا ساعة معتمدة إطلاقًا: أشد التحفظات وضوحًا.
  const empty=projectProfitability(db,users.manager,{project_id:project.id,from:back(60),to:back(40)});
  assert.ok(empty.caveats.some(x=>x.includes('لا ساعات مسجلة')));
  assert.ok(verifyAudit(db));
  assert.equal(category.id.length,36);
});

test('profitability: overhead is loaded only from an approved dated rate, and its author never approves it',t=>{
  const {db,users,tx,project}=fixture(t);
  pricedCategory(db,users,tx,{from:back(90),rate:'100.00'});
  const entry=tx(()=>logTime(db,users.employee,{project_id:project.id,work_date:back(3),minutes:120,billable:true,note:'ساعتان معتمدتان'}));
  tx(()=>decideTime(db,users.manager,entry.id,'approve',{note:''}));
  assert.equal(projectProfitability(db,users.manager,{project_id:project.id}).cost.overhead_minor,0);

  const overhead=tx(()=>prepareOverheadRate(db,users.manager,{effective_from:back(90),method:'per_hour',rate_amount:'25.00',percent:'',source:'مصاريف عمومية مقسومة على ساعات السنة بمصدرها'}));
  assert.throws(()=>tx(()=>overheadRateAction(db,users.manager,overhead.id,'approve_overhead',{version:1,note:'أعتمد ما أعددته بنفسي'})),code('self_approval'));
  assert.equal(projectProfitability(db,users.manager,{project_id:project.id}).cost.overhead_minor,0,'a draft overhead rate loads nothing');
  tx(()=>overheadRateAction(db,users.hr,overhead.id,'approve_overhead',{version:1,note:'اعتماد بعد مراجعة أساس القسمة'}));

  const loaded=projectProfitability(db,users.manager,{project_id:project.id});
  assert.equal(loaded.cost.overhead_minor,5000,'two hours at 25.00 an hour');
  assert.equal(loaded.cost.total_minor,loaded.cost.time_minor+5000);
  assert.throws(()=>db.prepare('UPDATE overhead_rates SET rate_minor=1,version=version+1 WHERE id=?').run(overhead.id),/never revised/);
  assert.ok(verifyAudit(db));
});

test('profitability: the forecast takes future commitments from outside this module and says plainly when it did not get them',t=>{
  const {db,users,tx,project}=fixture(t);
  pricedCategory(db,users,tx,{from:back(90),rate:'100.00'});
  const entry=tx(()=>logTime(db,users.employee,{project_id:project.id,work_date:back(4),minutes:600,billable:true,note:'عشر ساعات معتمدة'}));
  tx(()=>decideTime(db,users.manager,entry.id,'approve',{note:''}));

  const bare=projectProfitability(db,users.manager,{project_id:project.id});
  assert.equal(bare.forecast.committed_future_supplied,false);
  assert.equal(bare.forecast.remaining_basis,'none');
  assert.ok(bare.caveats.some(x=>x.includes('المحجوز مستقبلًا')));
  assert.ok(bare.caveats.some(x=>x.includes('المتبقي المجدول')));

  const supplied=projectProfitability(db,users.manager,{project_id:project.id,
    forecast:{budget_minor:500000,committed_future_minor:50000,remaining_minutes:600,expected_revenue_minor:300000}});
  assert.equal(supplied.forecast.budget_source,'supplied');
  assert.equal(supplied.forecast.committed_future_minor,50000);
  assert.equal(supplied.forecast.remaining_basis,'blended_actual_rate');
  assert.equal(supplied.forecast.remaining_cost_minor,100000,'ten more hours at the blended actual rate of this project');
  assert.equal(supplied.forecast.cost_at_completion_minor,100000+100000+50000);
  assert.equal(supplied.forecast.margin_at_completion_minor,300000-250000);
  assert.ok(supplied.forecast.daily_burn_minor>0&&supplied.forecast.exhausts_on);
  assert.ok(verifyAudit(db));
});

test('profitability: every read is bounded by tenant and by its own capability, and service lines are tagged by a person, never guessed',t=>{
  const {db,users,tx,project}=fixture(t);
  assert.throws(()=>profitabilityBoard(db,users.employee,{}),code('not_permitted'));
  assert.throws(()=>profitabilityBoard(db,users.hr,{}),code('not_permitted'),'managing cost rates does not by itself grant sight of margins');
  assert.throws(()=>costRatesBoard(db,users.it),code('not_permitted'),'seeing margins does not by itself grant control of rates');

  // مشروع في كيان آخر: لا يُقرأ من هذا الكيان مهما كان التصريح.
  const foreign=randomUUID();
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?)').run(foreign,'isolated','مشروع كيان معزول','موجز','external',now());
  assert.throws(()=>projectProfitability(db,users.manager,{project_id:foreign}),code('not_found'));
  assert.equal(profitabilityBoard(db,users.manager,{}).rows.some(r=>r.id===foreign),false);

  const untagged=serviceProfitability(db,users.manager,{});
  assert.equal(untagged.families.length,0);
  assert.equal(untagged.untagged.projects,1);
  assert.ok(untagged.caveats.some(x=>x.includes('بلا وسم')));
  assert.throws(()=>tx(()=>tagProjectService(db,users.manager,{project_id:project.id,family:'not_a_family',note:'',version:undefined})),code('family'));
  tx(()=>tagProjectService(db,users.manager,{project_id:project.id,family:'branding',note:'وسم تجريبي',version:undefined}));
  const tagged=serviceProfitability(db,users.manager,{});
  assert.equal(tagged.families.length,1);
  assert.equal(tagged.families[0].family,'branding');
  assert.equal(tagged.untagged.projects,0);

  assert.throws(()=>clientProfitability(db,users.manager,{client_id:randomUUID()}),code('not_found'));
  assert.ok(verifyAudit(db));
});

test('profitability: category lifecycle is versioned and an inactive category cannot be priced or assigned',t=>{
  const {db,users,tx}=fixture(t);
  const category=tx(()=>createCategory(db,users.manager,{code:'PRODUCER',name:'منتج (تجريبي)',description:''}));
  assert.throws(()=>tx(()=>categoryAction(db,users.manager,category.id,'deactivate_category',{version:9,reason:'نسخة قديمة'})),code('stale_version'));
  tx(()=>categoryAction(db,users.manager,category.id,'deactivate_category',{version:1,reason:'دمجت مع فئة أخرى بقرار موثق'}));
  assert.throws(()=>tx(()=>categoryAction(db,users.manager,category.id,'deactivate_category',{version:2,reason:'تكرار'})),code('already_in_state'));
  assert.throws(()=>tx(()=>prepareCostRate(db,users.manager,{category_id:category.id,effective_from:back(1),rate_amount:'50.00',source:'محاولة تسعير فئة موقوفة'})),code('inactive_category'));
  assert.throws(()=>tx(()=>assignCategory(db,users.manager,{user_id:'employee',category_id:category.id,effective_from:back(1),basis:'إسناد لفئة موقوفة'})),code('inactive_category'));
  assert.throws(()=>db.prepare('DELETE FROM job_categories WHERE id=?').run(category.id),/deactivated, not deleted/);
  tx(()=>categoryAction(db,users.manager,category.id,'activate_category',{version:2,reason:'أعيد تفعيلها بقرار موثق'}));
  assert.equal(costRatesBoard(db,users.manager).categories.find(c=>c.id===category.id).active,true);
  assert.ok(verifyAudit(db));
});
