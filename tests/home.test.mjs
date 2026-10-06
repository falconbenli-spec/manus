import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { homeBoard, card, figure } from '../app/home.mjs';
import { grantAccess } from '../app/access.mjs';
import { executiveOverview } from '../app/workspace.mjs';
import { homeUI } from '../app/static/home-ui.mjs';
import { createRequest, transition, catalog, setServiceSection, setServiceTarget } from '../app/workflow.mjs';
import { addDocument } from '../app/employees.mjs';
import { saveExpiryWatch } from '../app/expiry.mjs';

const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=days=>new Date(Date.parse(day()+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const money=value=>value===null||value===undefined?'—':String(value);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-home');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const service=code=>catalog(db,users.admin).find(s=>s.code===code);
  const raise=(actor,code,title,payload,submit=true)=>tx(()=>{
    const created=createRequest(db,actor,{service_id:service(code).id,title,payload});
    return submit?transition(db,actor,created.id,'submit',{version:created.version,note:''}):created;
  });
  return {db,users,tx,service,raise};
}

test('home: the page is built per role — an employee is shown their own work only, and each extra section appears with the permission that backs it',t=>{
  const {db,users}=fixture(t);
  const employee=homeBoard(db,users.employee);
  assert.equal(employee.me.id,'employee');
  assert.equal(employee.manager,null,'an employee is not given a manager view');
  assert.equal(employee.hr,null);assert.equal(employee.executive,null);
  assert.deepEqual(employee.cards.map(c=>c.key),['decisions','my_requests','tasks','my_documents'],'no leave balance card without a balance to open');
  for(const card of employee.cards)assert.ok(card.link.startsWith('#'),'every card leads to its own screen');

  const manager=homeBoard(db,users.manager);
  assert.ok(manager.manager,'a line manager gets the team section');
  assert.equal(manager.manager.team_size,2);
  assert.ok(manager.cards.some(c=>c.key==='team_late'));
  assert.ok(manager.cards.some(c=>c.key==='department_overruns'));
  assert.equal(manager.hr,null,'managing a team is not reading personnel files');

  const hr=homeBoard(db,users.hr);
  assert.ok(hr.hr,'the people officer gets the documents and contracts section');
  assert.equal(hr.manager,null,'with no direct reports there is no team section to show');
  // الموجة 1: زر اللوحة التنفيذية والمسار شرط واحد (تصريح executive.view). الدور وحده لا يرسم زرًا يرفضه المسار.
  assert.equal(hr.executive,null,'a role alone no longer draws a button the route would refuse');
  assert.equal(manager.executive,null,'nor does managing a team');
  assert.throws(()=>executiveOverview(db,users.hr),error=>error.status===403,'the route agrees: no capability, no board');
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'hr',capability:'executive.view',note:'منح تجريبي لاختبار بوابة اللوحة التنفيذية'}));
  assert.ok(homeBoard(db,users.hr).executive,'with the capability the block and its button appear');
  assert.ok(executiveOverview(db,users.hr).totals,'and the same predicate opens the route');
  assert.ok(homeBoard(db,users.admin).executive,'the first admin holds every non-sensitive capability, this one included');

  const it=homeBoard(db,users.it);
  assert.equal(it.hr,null);assert.equal(it.finance,null);assert.equal(it.executive,null);
  assert.ok(verifyAudit(db));
});

test('home: leadership numbers stay aggregate — no request title and no person’s name reaches the leadership block',t=>{
  const {db,users,raise}=fixture(t);
  raise(users.employee,'HR-LETTER','خطاب تعريف للبنك التجريبي',{purpose:'فتح حساب','recipient':'بنك تجريبي'});
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'hr',capability:'executive.view',note:'منح تجريبي لاختبار أرقام القيادة'}));
  const hr=homeBoard(db,users.hr);
  const serialised=JSON.stringify(hr.executive);
  assert.ok(!serialised.includes('خطاب تعريف للبنك التجريبي'),'no request title');
  for(const person of ['الموظفة التجريبية','مدير الفريق التجريبي','معتمدة خدمات الموظف'])assert.ok(!serialised.includes(person),`leaks a person’s name: ${person}`);
  assert.equal(typeof hr.executive.totals.open,'number');
  assert.equal(hr.executive.link,'#executive','the aggregate leads to the screen that may detail it');
  assert.equal(homeBoard(db,users.employee).executive,null,'and an employee is shown no aggregate they cannot open');
});

test('home: the most used services are counted from this person’s own request history, never from a fixed list',t=>{
  const {db,users,raise}=fixture(t);
  const fresh=homeBoard(db,users.employee);
  assert.deepEqual(fresh.top_services,[],'no history means no suggestion, not a hardcoded menu');
  assert.match(fresh.top_services_note,/لا طلبات سابقة/);

  raise(users.employee,'HR-LETTER','خطاب أول',{purpose:'غرض','recipient':'جهة'});
  raise(users.employee,'HR-LETTER','خطاب ثانٍ',{purpose:'غرض','recipient':'جهة'});
  raise(users.employee,'IT-SUPPORT','عطل في الطابعة',{issue:'لا تطبع',impact:'يؤخر العمل'});
  raise(users.outsider,'IT-SUPPORT','عطل آخر',{issue:'الشبكة',impact:'يمنع العمل'});
  raise(users.outsider,'IT-SUPPORT','عطل ثالث',{issue:'الشبكة',impact:'يمنع العمل'});

  const mine=homeBoard(db,users.employee).top_services;
  assert.deepEqual(mine.map(s=>[s.code,s.uses]),[['HR-LETTER',2],['IT-SUPPORT',1]],'ordered by this person’s own use');
  assert.ok(mine.every(s=>s.available&&s.service_id),'each one points at a service that can still be started');
  assert.deepEqual(homeBoard(db,users.outsider).top_services.map(s=>[s.code,s.uses]),[['IT-SUPPORT',2]],'another colleague’s history is another list');
});

test('home: an open request carries the time left computed from the service clock, and a service with no agreed target time is never called on time or late',t=>{
  const {db,users,tx,raise}=fixture(t);
  raise(users.employee,'HR-LETTER','خطاب بزمن غير محدد',{purpose:'غرض','recipient':'جهة'});
  const before=homeBoard(db,users.employee).my_requests[0];
  assert.equal(before.status,'pending');
  assert.equal(before.clock.target_days,0);
  assert.match(before.time_note,/بلا زمن مستهدف/,'the platform does not invent a service level');
  assert.equal(before.clock.overdue,false);

  tx(()=>{setServiceSection(db,users.admin,'HR-LETTER','خطابات',10);setServiceTarget(db,users.admin,'HR-LETTER',3);});
  const after=homeBoard(db,users.employee).my_requests[0];
  assert.equal(after.clock.target_days,3);
  assert.equal(typeof after.clock.days_left,'number');
  assert.match(after.time_note,/يوم عمل/);
});

test('home: a decision awaiting the approver appears with its age, and the manager’s oldest approval is the oldest one they can open',t=>{
  const {db,users,raise}=fixture(t);
  raise(users.employee,'HR-LETTER','خطاب ينتظر قرار المدير',{purpose:'غرض','recipient':'جهة'});
  const manager=homeBoard(db,users.manager);
  assert.equal(manager.decisions.length,1);
  assert.equal(manager.decisions[0].title,'خطاب ينتظر قرار المدير');
  assert.equal(typeof manager.decisions[0].age_days,'number');
  assert.equal(manager.manager.oldest_approval.id,manager.decisions[0].id);
  // كانت «اعتماداتي المعلقة»؛ سُمّيت بما هي (طلبات الدليل التي تنتظر اعتماده)، ورقمها طول قائمتها.
  const approvals=manager.cards.find(c=>c.key==='request_approvals');
  assert.equal(approvals.title,'طلبات تنتظر اعتمادي');
  assert.equal(approvals.value,1);assert.equal(approvals.value,manager.manager.request_approvals.length);
  assert.equal(manager.cards.some(c=>c.key==='pending_approvals'),false,'the old name is gone, not kept beside the new one');
  assert.equal(manager.cards.find(c=>c.key==='decisions').value,manager.decisions.length,'the decisions tile is the length of the list under it');
  assert.equal(manager.decisions[0].link,`#request/${manager.decisions[0].id}`,'and each row opens its record');
  assert.equal(homeBoard(db,users.it).decisions.length,0,'a decision belongs to whoever must take it');
  assert.equal(homeBoard(db,users.employee).decisions.length,0,'and never to the person who asked');
});

test('home: expiring documents on the page are this person’s own, and a document is only called close to expiry once a window is recorded',t=>{
  const {db,users,tx}=fixture(t);
  tx(()=>addDocument(db,users.hr,'employee',{doc_type:'iqama',reference:'آخر 4 أرقام 5150',expires_on:shift(20)}));
  tx(()=>addDocument(db,users.hr,'outsider',{doc_type:'iqama',reference:'آخر 4 أرقام 6060',expires_on:shift(-3)}));

  const quiet=homeBoard(db,users.employee);
  assert.deepEqual(quiet.my_documents,[],'without a recorded window nothing of the employee’s is flagged');
  assert.match(quiet.my_documents_note,/مدة تذكير/);

  tx(()=>saveExpiryWatch(db,users.hr,'employee.iqama',{first_reminder_days:60,second_reminder_days:14,basis:'قرار داخلي أكدته مديرة الموارد البشرية بتاريخ '+day()}));
  const loud=homeBoard(db,users.employee);
  assert.equal(loud.my_documents.length,1);
  assert.equal(loud.my_documents[0].status,'due_soon');
  assert.equal(loud.cards.find(c=>c.key==='my_documents').value,1);
  assert.ok(!JSON.stringify(loud.my_documents).includes('6060'),'a colleague’s document is not on this person’s page');

  const officer=homeBoard(db,users.hr);
  assert.equal(officer.hr.expired_documents.length,1);
  assert.equal(officer.hr.due_soon_documents.length,1);
  assert.equal(officer.cards.find(c=>c.key==='expired_documents').value,officer.hr.expired_documents.length,'the card number is the length of the list it opens');
  assert.ok(verifyAudit(db));
});

test('home: a tenant reads nothing of another tenant, and a screen reads only the sources its account may open',t=>{
  const {db,users,raise}=fixture(t);
  raise(users.employee,'HR-LETTER','خطاب داخل الكيان',{purpose:'غرض','recipient':'جهة'});
  const outside=homeBoard(db,users.external);
  assert.deepEqual(outside.decisions,[]);assert.deepEqual(outside.my_requests,[]);assert.deepEqual(outside.top_services,[]);
  assert.equal(outside.executive,null);assert.equal(outside.finance,null);
  assert.ok(!JSON.stringify(outside).includes('خطاب داخل الكيان'));
  assert.ok(homeBoard(db,users.employee).unavailable.includes('مستحقات العملاء'),'a source refused to this account is named, not silently counted as zero');
  assert.equal(homeBoard(db,users.employee).finance,null);
});

test('home screen: renders for every seeded role with no escaping hole and no placeholder text',t=>{
  const {db,users,tx,raise}=fixture(t);
  raise(users.employee,'HR-LETTER','<b>خطاب باسم فيه وسم</b>',{purpose:'غرض','recipient':'جهة'});
  tx(()=>addDocument(db,users.hr,'employee',{doc_type:'passport',reference:'آخر 4 أرقام 4412',expires_on:shift(10)}));
  for(const id of ['employee','manager','hr','it','admin','outsider']){
    const data=homeBoard(db,users[id]);
    const buttons=[],button=(action,rowId,label)=>{buttons.push([action,rowId]);return `<button>${e(label)}</button>`;};
    const html=homeUI.render(data,{e,button,money});
    assert.equal(buttons.length,0,`${id}: the home page takes no decision itself`);
    assert.ok(!/<b>خطاب/.test(html),`${id}: a request title reached the page unescaped`);
    const text=html.replace(/<[^>]+>/g,' ');
    assert.ok(!/\bundefined\b|\bNaN\b|\[object /.test(text),`${id}: ${text.match(/\bundefined\b|\bNaN\b|\[object /)?.[0]}`);
    assert.ok(!/ style="/.test(html),`${id}: inline style breaks the content policy`);
    assert.ok(!/<script/i.test(html));
  }
  assert.throws(()=>homeUI.form('anything','',{}),/الإجراء غير متاح/);
  assert.ok(verifyAudit(db));
});

test('home: the tasks tile and block are named «مهامي» — the same name as the server card and the #work page',t=>{
  const {db,users}=fixture(t);
  const button=()=>'';
  const html=homeUI.render(homeBoard(db,users.employee),{e,button,money});
  assert.match(html,/<span>مهامي<\/span>/,'the stat tile is named مهامي');
  assert.match(html,/<h2>مهامي <small>/,'the block is named مهامي with its count');
  assert.ok(!html.includes('عليك تنفيذه'),'the old name is gone from the screen');
});

test('home welcome greets the signed-in employee by name and shows the weekday with both dates',t=>{
  const {db,users}=fixture(t),data=homeBoard(db,users.employee);
  const html=homeUI.render(data,{e,money}),welcome=html.match(/<section class="hm-welcome"[\s\S]*?<\/section>/)?.[0]??'';
  assert.ok(welcome,'المقدمة الشخصية موجودة في أول الرئيسية');
  assert.match(welcome,/(صبّحك الله بالخير|مسّاك الله بالخير)/);
  assert.ok(welcome.includes(e(data.me.name)),'اسم الحساب الحقيقي ظاهر');
  assert.ok(welcome.includes(e(data.today_card.weekday)),'اسم اليوم ظاهر');
  assert.ok(welcome.includes(data.today_card.date),'التاريخ الميلادي ظاهر');
  assert.match(welcome,/هـ/,'التاريخ الهجري ظاهر');
  assert.match(welcome,/<svg class="glyph is-tinted"/,'علامة المقدمة من مكتبة SVG نفسها');
});

test('home: a card takes the list it shows and derives its number from it — handed a number it throws, so a tile can never disagree with its list again',t=>{
  assert.throws(()=>card('decisions','ما ينتظر قراري',6,'#inbox'),TypeError,'a number is refused');
  assert.throws(()=>card('decisions','ما ينتظر قراري','6','#inbox'),TypeError);
  assert.throws(()=>card('decisions','ما ينتظر قراري',undefined,'#inbox'),TypeError);
  assert.deepEqual(card('tasks','مهامي',[{},{}],'#work','is-late'),{key:'tasks',title:'مهامي',value:2,link:'#work',tone:'is-late',basis:'list'});
  // الكمية الحقيقية (رصيد إجازة) لها منشئ آخر، ولا يقبل قائمة ولا نصًا.
  assert.deepEqual(figure('leave','رصيد إجازتي',21,'#leave'),{key:'leave',title:'رصيد إجازتي',value:21,link:'#leave',tone:'',basis:'quantity'});
  assert.equal(figure('leave','رصيد إجازتي',null,'#leave').value,null,'an unknown quantity stays unknown');
  assert.throws(()=>figure('leave','رصيد إجازتي',[1,2],'#leave'),TypeError);
  const {db,users,raise}=fixture(t);
  raise(users.employee,'HR-LETTER','خطاب لاختبار البطاقات',{purpose:'غرض','recipient':'جهة'});
  for(const id of ['employee','manager','hr','it','admin','outsider']){
    const home=homeBoard(db,users[id]);
    const lists={decisions:home.decisions,respond:home.respond,my_requests:home.my_requests,tasks:home.tasks,my_documents:home.my_documents,
      team_late:home.manager?.team_late,request_approvals:home.manager?.request_approvals,department_overruns:home.manager?.department_overruns,
      expired_documents:home.hr?.expired_documents,due_soon_documents:home.hr?.due_soon_documents,ended_contracts:home.hr?.ended_contracts,hr_requests:home.hr?.pending_requests,
      overdue_receivables:home.finance?.overdue_receivables,pending_payment_orders:home.finance?.pending_payment_orders,open_periods:home.finance?.open_periods};
    for(const c of home.cards.filter(c=>c.basis==='list'&&c.key!=='discipline'))
      assert.equal(c.value,lists[c.key]?.length,`${id}: the «${c.title}» tile is the length of the list the page shows for it`);
  }
});
