import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { createProject } from '../app/projects.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { axesBoard, executiveAxesBoard } from '../app/project-axes.mjs';
import { pipelineBoard, portfolioForecast, prepareStage, stageAction, addLossReason, createOpportunity, opportunityAction } from '../app/pipeline-estimates.mjs';
import { executiveOverview } from '../app/workspace.mjs';
import { executiveBoard } from '../app/static/executive-ui.mjs';
import { money } from '../app/static/operations.mjs';
// الفوز صار يشترط صفقة متعاقدًا عليها مفتوحة من الفرصة (الحزمة 4، الترحيل 181): المساعد يفتحها ويوصلها إلى اتفاق موثّق.
import { contractedDealFor } from './crm-fixture.mjs';

// المسار التنفيذي: الرئيس التنفيذي لم يكن يرى شركته لأنه ليس عضوًا في مشاريعها ولا في فرق
// حساباتها. بيانات مصطنعة بالكامل؛ لا صلة لها ببيانات حقيقية.
const code=value=>error=>error.code===value;
const riyadh=(offset=0)=>new Date(Date.now()+3*3600000+offset*86400000).toISOString().slice(0,10);
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// أسماء وتعليقات مميزة يُبحث عنها حرفيًا في المخرج: وجود أي منها تسريبٌ لا التباس.
const SECRETS={
  opportunity:'فرصة سرية لإطلاق مستحيل التكرار',
  opportunityTwo:'فرصة سرية ثانية لا تُذكر',
  client:'عميل سري لا يُذكر اسمه في اللوحة',
  clientTwo:'جهة سرية ثانية بلا ذكر',
  comment:'تعليق خسارة سري: العميل اختار منافسًا أرخص بفارق ظاهر'
};

function fixture(t){
  const db=openDb(':memory:');
  seed(db,'synthetic-executive-scope-tests-only');
  t.after(()=>db.close());
  // رئيس تنفيذي: حساب بلا عضوية مشروع واحدة وبلا فريق حساب واحد. هذا هو محل العلة.
  // دوره `manager` لأن `executiveOverview` ما زالت تقف على الدور لا على التصريح — بابٌ ثانٍ
  // مذكور في التسليم لمرحلة لاحقة، ولا تعالجه هذه المرحلة حتى لا تتسع اللوحة بقرار غير مطلوب.
  db.exec(`INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES
    ('chief','36t','ops','chief','الرئيس التنفيذي المصطنع','unused-test-hash','manager',NULL)`);
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const grant=(user_id,capability,department_id='')=>tx(()=>grantAccess(db,users.admin,{user_id,capability,department_id,note:'منح تجريبي لاختبار النطاق التنفيذي'}));
  grant('chief','executive.view');
  for(const [who,capability] of [['employee','commercial.use'],['employee','clients.manage'],['manager','commercial.use']])
    grant(who,capability,capability==='commercial.use'?'creative':'');

  // ثلاثة مشاريع يفتحها مدير الفريق، والرئيس التنفيذي ليس عضوًا في أي منها.
  const projects=['مشروع الهوية المصطنع','مشروع الحملة المصطنع','مشروع الإنتاج المصطنع']
    .map(name=>tx(()=>createProject(db,users.manager,{name,brief:'موجز مصطنع لاختبار النطاق التنفيذي وحده',member_ids:['employee']})).id);
  return {db,users,tx,projects,grant};
}

// قمع مصطنع كامل: مرحلتان معتمدتان، فرص مفتوحة وفرصة مغلقة بخسارة بسببها وتعليقها.
function funnel(db,users,tx){
  const stage=(input)=>tx(()=>prepareStage(db,users.employee,{sort_order:1,probability_basis:'متوسط تجربة الشركة المصطنعة في آخر سنة',confirmed_on:riyadh(),required_fields:[],idle_days:7,...input})).id;
  const approve=id=>tx(()=>stageAction(db,users.manager,id,'approve_stage',{version:db.prepare('SELECT version FROM pipeline_stages WHERE id=?').get(id).version,note:'اعتماد مصطنع'}));
  approve(stage({code:'LEAD',name:'فرصة أولية',win_probability:'10'}));
  approve(stage({code:'PROPOSED',name:'عرض مقدَّم',sort_order:2,win_probability:'50'}));
  const client=tx(()=>createClient(db,users.employee,{legal_name:SECRETS.client,trade_name:'',sector:'التجزئة',status:'prospect',notes:''})).id;
  const second=tx(()=>createClient(db,users.employee,{legal_name:SECRETS.clientTwo,trade_name:'',sector:'الصحة',status:'prospect',notes:''})).id;
  for(const c of [client,second])tx(()=>clientAction(db,users.employee,c,'add_member',{user_id:'manager',role:'مدير الفريق المصطنع'}));
  const base={service_family:'campaigns',expected_close_on:'',decision_maker:'',budget_note:'',next_step:'',next_step_on:''};
  const open=tx(()=>createOpportunity(db,users.employee,{client_id:client,stage_code:'LEAD',name:SECRETS.opportunity,value:'100000.00',...base})).id;
  const lost=tx(()=>createOpportunity(db,users.employee,{client_id:second,stage_code:'LEAD',name:SECRETS.opportunityTwo,value:'40000.00',...base})).id;
  const won=tx(()=>createOpportunity(db,users.employee,{client_id:second,stage_code:'LEAD',name:'فرصة رابحة مصطنعة',value:'60000.00',...base})).id;
  const version=id=>db.prepare('SELECT version FROM opportunities WHERE id=?').get(id).version;
  tx(()=>opportunityAction(db,users.employee,open,'move',{version:version(open),stage_code:'PROPOSED',note:'انتقال مصطنع'}));
  const reason=tx(()=>addLossReason(db,users.employee,{code:'PRICE',name:'السعر أعلى من المنافس'})).id;
  tx(()=>opportunityAction(db,users.employee,lost,'lose',{version:version(lost),loss_reason_id:reason,comment:SECRETS.comment}));
  contractedDealFor(db,users,won);
  tx(()=>opportunityAction(db,users.employee,won,'win',{version:version(won),note:'موافقة العميل المصطنعة بالبريد'}));
  return {client,open,lost,won};
}

test('executive scope: the holder of executive.view reads every project in the entity, while the membership board he calls is untouched',t=>{
  const {db,users,projects}=fixture(t);
  // العلة كما كانت: لا عضوية، فلا محفظة.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE user_id=?').get('chief').n,0,'the chief executive is a member of no project');
  assert.equal(axesBoard(db,users.chief).projects.length,0,'axesBoard keeps its membership scope: the chief executive still sees none');
  const board=executiveAxesBoard(db,users.chief);
  assert.equal(board.projects.length,projects.length,'the entity board shows every active project');
  assert.deepEqual(board.projects.map(p=>p.id).sort(),[...projects].sort());
  assert.equal(board.scope,'tenant');assert.equal(board.capability,'executive.view');
  // نفس الإسقاط بالضبط: المحاور الثمانية نفسها بالترتيب نفسه، ومحتواها واحد لمن يرى المشروع من البابين.
  const mine=axesBoard(db,users.manager);
  assert.deepEqual(Object.keys(board.projects[0].axes),['commercial','readiness','execution','acceptance','invoicing','collection','supplier_settlement','closure']);
  assert.deepEqual(Object.keys(mine.projects[0].axes),Object.keys(board.projects[0].axes));
  const sameProject=board.projects.find(p=>p.id===mine.projects[0].id);
  assert.deepEqual(sameProject.axes,mine.projects[0].axes,'one projection, not two that drift');
  assert.equal(mine.projects.length,projects.length,'a member still reads his own projects exactly as before');
  assert.ok(verifyAudit(db));
});

test('executive scope: a project member without executive.view is refused by both new functions, and the capability is the only door',t=>{
  const {db,users,tx}=fixture(t);
  funnel(db,users,tx);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE user_id=?').get('employee').n>0,'the employee is a real project member');
  assert.throws(()=>executiveAxesBoard(db,users.employee),error=>error.status===403&&error.code==='not_permitted','membership is not the entity board');
  assert.throws(()=>portfolioForecast(db,users.employee,{}),error=>error.status===403&&error.code==='not_permitted','an account team seat is not the entity funnel');
  // مدير الفريق كذلك: دوره يفتح شاشاته لا الكيان.
  assert.throws(()=>executiveAxesBoard(db,users.manager),code('not_permitted'));
  assert.throws(()=>portfolioForecast(db,users.manager,{}),code('not_permitted'));
  // والرئيس التنفيذي لا يملك commercial.use، فالشاشة القائمة تبقى مغلقة عليه: التوسعة قراءة مجمّعة لا باب خلفي.
  assert.throws(()=>pipelineBoard(db,users.chief),error=>['forbidden','not_permitted'].includes(error.code));
  assert.ok(portfolioForecast(db,users.chief,{}),'the same reader passes through his own gate');
  assert.ok(verifyAudit(db));
});

test('executive scope: the portfolio forecast carries the funnel numbers and its warning, and not one opportunity, client or loss comment',t=>{
  const {db,users,tx}=fixture(t);
  funnel(db,users,tx);
  const forecast=portfolioForecast(db,users.chief,{from:riyadh(-30),to:riyadh()});
  // الأرقام: مفتوح وقيمته وموزونه، وغير الموزون، ونسبتا الفوز، وأسباب الخسارة.
  assert.equal(forecast.open_count,1);
  assert.equal(forecast.open_value_minor,10000000);
  assert.equal(forecast.weighted_minor,5000000,'100,000.00 × 50٪');
  assert.equal(forecast.unweighted_count,0);
  assert.deepEqual(forecast.by_stage.map(s=>[s.code,s.count,s.value_minor]),[['LEAD',0,0],['PROPOSED',1,10000000]]);
  assert.deepEqual([forecast.closed.won_count,forecast.closed.lost_count],[1,1]);
  assert.deepEqual([forecast.closed.won_value_minor,forecast.closed.lost_value_minor],[6000000,4000000]);
  assert.equal(forecast.closed.win_rate_count_bp,5000);
  assert.equal(forecast.closed.win_rate_value_bp,6000);
  assert.deepEqual(forecast.loss_reasons.map(r=>[r.code,r.count,r.value_minor]),[['PRICE',1,4000000]]);
  assert.match(forecast.warning,/تقدير لا إيراد/);
  // الحجب: المخرج المسلسل لا يحوي أيًّا من النصوص المصطنعة المميزة.
  const serialised=JSON.stringify(forecast);
  for(const [key,secret] of Object.entries(SECRETS))
    assert.equal(serialised.includes(secret),false,`تسريب «${key}» إلى توقع المحفظة`);
  assert.equal(/"name":"فرصة رابحة مصطنعة"/.test(serialised),false,'no opportunity name at all, not even a winning one');
  // وللمقارنة: شاشة فريق الحساب هي مكان الأسماء، ولم تتغير.
  const team=JSON.stringify(pipelineBoard(db,users.employee));
  assert.ok(team.includes(SECRETS.opportunity)&&team.includes(SECRETS.comment),'the account team still reads its own deals by name');
  assert.ok(verifyAudit(db));
});

test('executive scope: the executive board carries the portfolio counts for the capability holder and for nobody else',t=>{
  const {db,users,tx,projects}=fixture(t);
  funnel(db,users,tx);
  const chief=executiveOverview(db,users.chief);
  assert.ok(chief.portfolio,'the capability holder reads the portfolio on the board he already had');
  assert.equal(chief.portfolio.projects,projects.length);
  assert.equal(chief.portfolio.funnel.open_count,1);
  assert.equal(chief.portfolio.funnel.weighted_minor,5000000);
  assert.deepEqual(chief.portfolio.axes.map(a=>a.key),['commercial','readiness','execution','acceptance','invoicing','collection','supplier_settlement','closure']);
  assert.ok(chief.portfolio.axes.every(a=>a.states.every(s=>typeof s.name==='string'&&s.name.length>0)),'every state reaches the screen named');
  assert.equal(chief.portfolio.axes.find(a=>a.key==='execution').states.reduce((n,s)=>n+s.count,0),projects.length);
  // عند الدمج (21 سبتمبر 2026): الموجة 1 جعلت للوحة التنفيذية شرطًا واحدًا هو التصريح executive.view للزر والمسار معًا،
  // فلم يعد أحد يقرؤها بدوره. كُتب هذا الاختبار قبلها وكان ينتظر قارئًا بالدور يرى اللوحة بلا محفظة؛ صار ينتظر الرفض.
  assert.throws(()=>executiveOverview(db,users.hr),error=>error.status===403&&error.code==='forbidden','a role alone no longer opens the board');
  // ولا اسم في اللوحة: مذهبها «أرقام مجمّعة للكيان، دون عناوين الطلبات أو أسماء أصحابها».
  const serialised=JSON.stringify(chief.portfolio);
  for(const secret of Object.values(SECRETS))assert.equal(serialised.includes(secret),false,'تسريب إلى اللوحة التنفيذية');
  for(const name of ['مشروع الهوية المصطنع','مشروع الحملة المصطنع','مشروع الإنتاج المصطنع'])
    assert.equal(serialised.includes(name),false,'لا اسم مشروع في اللوحة، أعدادًا فقط');
  // الشاشة نفسها: بلاطات ووسوم وجداول وأشرطة بـ`data-width`، بلا نمط سطري تمنعه سياسة المحتوى.
  const html=executiveBoard(chief,{e,name:'3,6T',money});
  assert.match(html,/محاور المشاريع/);assert.match(html,/قمع الفرص/);
  assert.match(html,/تقدير لا إيراد/,'the forecast warning travels with the numbers to the screen');
  assert.match(html,/data-width="/);assert.doesNotMatch(html,/ style="/,'no inline styles, the content policy blocks them');
  for(const secret of Object.values(SECRETS))assert.equal(html.includes(secret),false,'تسريب إلى شاشة اللوحة');
  assert.doesNotMatch(executiveBoard({...chief,portfolio:null},{e,name:'3,6T',money}),/محاور المشاريع/,'no portfolio section when the board carries no portfolio');
  assert.ok(verifyAudit(db));
});
