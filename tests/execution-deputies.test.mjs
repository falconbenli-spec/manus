// سلسلة التنفيذ التي لا تترك خدمة بلا منفذ — 21 سبتمبر 2026.
// المسح الكامل لـ142 خدمة أثبت ثلاثة وقائع: 115 طلبًا من 142 نفّذها من اعتمدها، وتبنّي «فصل المهام» يترك
// 13 خدمة مال وصلاحيات بلا منفذ، وفحص الكتالوج يقول «لا ملاحظات» في اللحظة نفسها. كل اختبار هنا يمشي
// واحدة من هذه الوقائع بنصها: التنفيذ لا ينتهي إلى فراغ، والاحتياط لا يعيد صاحب القرار من باب آخر،
// والتسمية فعل شخصين، والتبني يُرفض إن قطع آخر منفذ، والفحص لا يطمئن وضابطه مُطفأ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { installServiceCatalog, adoptPolicyProposal, separationOfDutiesState, catalogHealth,
  approvalSettings, proposalImpact, policyProposals, SOD_SERVICES } from '../app/service-catalog.mjs';
import { saveIntake } from '../app/request-intake.mjs';

const code=value=>error=>error.code===value;
const BASIS='قرار الرئاسة بتاريخ 2026-09-21 بتفعيل فصل المهام على الخدمات الحسّاسة، محضر رقم 12';

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-execution-chain');t.after(()=>db.close());
  installServiceCatalog(db);
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const service=c=>wf.catalog(db,users.employee).find(s=>s.code===c);
  const create=(c,payload,who='employee',title='طلب اختبار سلسلة التنفيذ')=>tx(()=>wf.createRequest(db,users[who],{service_id:service(c).id,title,payload}));
  const move=(who,r,action,note='دليل اختبار مصطنع')=>tx(()=>wf.transition(db,users[who],r.id,action,{version:wf.getRequest(db,users[who],r.id).version,note}));
  // يمشي الطلب خطوة خطوة بحساب كل معتمد كما يحلّه المحرك نفسه، لا بافتراضنا من يعتمد.
  const approveAll=r=>{
    let guard=0;
    while(r.status==='pending'&&guard++<6){
      const step=db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' ORDER BY position LIMIT 1").get(r.id,r.revision);
      r=move(step.approver_id,r,'approve');
    }
    return r;
  };
  return {db,users,tx,service,create,move,approveAll};
}

// ── (1) لا خدمة تبلغ «معتمد» ومجموعة منفذيها فارغة ────────────────────────────
test('سلسلة التنفيذ: فصل المهام يصل مُشغَّلًا على الاثنتين والعشرين، ولا يترك خدمة واحدة بلا منفذ',t=>{
  const {db,users}=fixture(t);
  // لا تبنٍّ ولا قرار كيان: الضابط في تعريف الخدمة، فيصل مع الكتالوج.
  const state=separationOfDutiesState(db,'36t');
  assert.equal(state.services,22,'الاثنتان والعشرون وحدهما');
  assert.deepEqual(state.off,[],'ولا واحدة وصلت والضابط مُطفأ عليها');
  assert.deepEqual(state.missing,[]);
  assert.equal(state.on,22);
  const health=catalogHealth(db,'36t');
  assert.equal(health.summary.sod_no_executor,0,'ولا واحدة منها بقيت بلا منفذ');
  assert.equal(health.summary.no_executor,0);
  // الخدمات العادية لم تُمَس: الجمع فيها مُسجَّل ومعروض لا ممنوع.
  const sodOn=wf.catalog(db,users.admin).filter(s=>s.approval_policy.sod).map(s=>s.code).sort();
  assert.deepEqual(sodOn,[...SOD_SERVICES].sort(),'فصل المهام على الحسّاسة وحدها');
});

test('سلسلة التنفيذ: الطلب لا يصير «معتمدًا» ومجموعة منفذيه فارغة — يُرفض الاعتماد برفض يسمّي من يُسأل',t=>{
  const {db,users,tx,create,move}=fixture(t);
  // انزع الحلقتين الاحتياطيتين معًا: لا نائب أصلًا، ولا سُلَّم تصعيد للمالية (ولا رئيسًا تنفيذيًا نشطًا فوقه).
  db.prepare("DELETE FROM department_escalation WHERE department_id='finance'").run();
  db.prepare("UPDATE users SET active=0 WHERE id='ceo'").run();
  let r=create('FIN-CUSTODY',{action:'طلب عهدة',amount:'3000.00',purpose:'عهدة نثرية لتصوير ميداني تجريبي',settle_by:'2026-12-31'});
  r=move('employee',r,'submit');
  const last=()=>db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' ORDER BY position LIMIT 1").get(r.id,r.revision);
  let step=last();
  while(step&&r.status==='pending'){
    if(db.prepare("SELECT COUNT(*) n FROM approval_steps WHERE request_id=? AND revision=? AND status='pending'").get(r.id,r.revision).n>1){r=move(step.approver_id,r,'approve');step=last();continue;}
    break;
  }
  const decider=step.approver_id;
  assert.throws(()=>move(decider,r,'approve'),code('no_executor'),'لا يُسلَّم الطلب إلى فراغ');
  // والرفض مكتوب على المعيار: ما الناقص، ومن يملكه، وما الخطوة التالية.
  let refusal=null;
  try{move(decider,r,'approve');}catch(error){refusal=error.details?.refusal;}
  assert.ok(refusal,'الرفض يحمل شكله المهيكل');
  assert.match(refusal.what,/لا أحد يملك تنفيذ هذا الطلب/);
  assert.equal(refusal.missing[0].owner_role,'structure.manage');
  assert.match(refusal.next,/نائبًا منفّذًا/);
  assert.match(refusal.missing[0].document,/FIN-CUSTODY/);
  assert.equal(wf.getRequest(db,users.employee,r.id).status,'pending','والطلب بقي حيث كان، لم يُطوَ صامتًا');
});

// ── (2) الاحتياط لا يعيد صاحب القرار ولا صاحب الطلب ولا المستفيد ───────────────
test('سلسلة التنفيذ: الاحتياط لا يقع على من قرر ولا على صاحب الطلب ولا على المستفيد',t=>{
  const {db,users,create,move,approveAll}=fixture(t);
  const payload={from_line:'بند التسويق',to_line:'بند الإنتاج',amount:'50000',justification:'تغطية تجاوز في بند الإنتاج بعد إقفال حملة'};
  let r=create('FIN-BUDGET-TRANSFER',payload);
  r=approveAll(move('employee',r,'submit'));
  assert.equal(r.status,'approved');
  const chain=wf.detail(db,users['vp-corporate'],r.id).execution;
  assert.equal(chain.basis,'escalation');
  const people=chain.people.map(p=>p.id);
  assert.ok(!people.includes('employee'),'صاحب الطلب لا ينفّذ طلبه');
  assert.ok(!people.includes('head-finance'),'ومن اعتمد لا ينفّذ ما اعتمد');
  // حين تكون كل درجة في السُّلَّم صاحبَ الطلب أو من قرر فيه، لا يُنتقى أحد: السلسلة تمضي إلى الرفض لا إلى مخالفة.
  db.prepare("DELETE FROM department_escalation WHERE department_id='finance'").run();
  db.prepare("INSERT INTO department_escalation VALUES('finance','36t','employee','مرجع تصعيد مصطنع للاختبار','admin',?)").run(new Date().toISOString());
  // وأوقِف الدرجتين فوقه — مرجع إدارة هذا الشخص والرئيس التنفيذي — حتى يخلو السُّلَّم كله لا درجته الأولى وحدها.
  db.prepare("UPDATE users SET active=0 WHERE id IN ('ceo','vp-growth')").run();
  const gap=wf.detail(db,users.employee,r.id).execution;
  assert.equal(gap.basis,'none','مرجع التصعيد هو صاحب الطلب، ولا درجة فوقه، فلا يُنتقى');
  assert.ok(gap.refusal,'ويُقال ذلك رفضًا مكتوبًا لا صمتًا');
});

test('سلسلة التنفيذ: المستفيد المسجّل لا يصله الطلب تنفيذًا ولو كان مرجع تصعيد الإدارة',t=>{
  const {db,users,tx,create,move}=fixture(t);
  // الرئيس التنفيذي درجةٌ فوق مرجع المالية؛ هذا الاختبار يقيس الحلقتين تحته، فيُوقف حسابه.
  db.prepare("UPDATE users SET active=0 WHERE id='ceo'").run();
  // الموارد البشرية تقدّم نيابةً (request-intake)، والمستفيد هنا هو مرجع تصعيد إدارة التنفيذ نفسها.
  let r=create('FIN-BUDGET-TRANSFER',{from_line:'بند التسويق',to_line:'بند الإنتاج',amount:'50000',
    justification:'مناقلة تجريبية لمراجعة أثر المستفيد على سلسلة التنفيذ'},'hr');
  tx(()=>saveIntake(db,users.hr,r.id,{beneficiary_id:'vp-corporate',justification:'مناقلة تجريبية لمراجعة أثر المستفيد على سلسلة التنفيذ'}));
  r=move('hr',r,'submit');
  const step=db.prepare("SELECT * FROM approval_steps WHERE request_id=? AND revision=? AND status='pending' ORDER BY position LIMIT 1").get(r.id,r.revision);
  // المالية فيها مديرها وحده وهو من يعتمد، ومرجع تصعيدها هو المستفيد: الحلقتان مقطوعتان، فيُرفض التسليم.
  assert.throws(()=>move(step.approver_id,r,'approve'),code('no_executor'),'المستفيد لا يُنتقى منفّذًا ولو كان مرجع التصعيد');
  // سمِّ نائبًا من إدارة أخرى واقبله، فيمضي الاعتماد ويصل النائب لا المستفيد.
  tx(()=>wf.proposeExecutionDeputy(db,users.admin,{service_code:'FIN-BUDGET-TRANSFER',rank:1,user_id:'it',basis:'قرار الرئاسة رقم 13: تقنية المعلومات تنفّذ المناقلة حين تعتمدها المالية وحدها'}));
  tx(()=>wf.acceptExecutionDeputy(db,users['head-it'],{service_code:'FIN-BUDGET-TRANSFER',rank:1,note:'قبِلتُ التسمية بوصفي منفّذًا احتياطيًا للمناقلات'}));
  r=move(step.approver_id,r,'approve');
  assert.equal(r.status,'approved');
  const people=wf.detail(db,users.it,r.id).execution.people.map(p=>p.id);
  assert.deepEqual(people,['it'],'النائب وحده، لا المستفيد ولا صاحب الطلب ولا من اعتمد');
  assert.equal(verifyAudit(db),true);
});

// ── (3) التسمية فعل شخصين ─────────────────────────────────────────────────────
test('سلسلة التنفيذ: النائب المقترح لا ينفّذ حتى يقبله شخص ثانٍ، والسجل لا يُمحى',t=>{
  const {db,users,tx}=fixture(t);
  const name=(over={})=>tx(()=>wf.proposeExecutionDeputy(db,users.admin,{service_code:'FIN-REFUND',rank:1,user_id:'it',
    basis:'قرار الرئاسة رقم 7: تقنية المعلومات تنفّذ الاسترداد حين يعتمده مدير المالية وحده',...over}));
  const row=name();
  assert.equal(row.status,'proposed');
  assert.equal(wf.deputiesFor(db,'36t','FIN-REFUND').length,0,'المقترح وحده لا يُحتسب منفذًا');
  assert.throws(()=>tx(()=>wf.acceptExecutionDeputy(db,users.admin,{service_code:'FIN-REFUND',rank:1,note:'من سمّى لا يقبل تسميته'})),code('separation_of_duties'));
  tx(()=>wf.acceptExecutionDeputy(db,users['head-it'],{service_code:'FIN-REFUND',rank:1,note:'قبِلتُ التسمية بوصفي منفّذًا احتياطيًا لهذه الخدمة'}));
  assert.equal(wf.deputiesFor(db,'36t','FIN-REFUND').length,1,'وبعد القبول يُحتسب');
  assert.throws(()=>name(),code('deputy_named'),'رتبة مشغولة لا تُستبدل في مكانها');
  assert.throws(()=>name({rank:2}),code('deputy_duplicate'),'ولا يُسمّى الشخص نفسه في رتبتين');
  assert.throws(()=>name({rank:4,user_id:'hr'}),code('rank'),'الرتب ثلاث');
  // ثلاثة نواب ممكنون؛ السحب يُبقي الصف مسحوبًا ولا يحذفه، والحذف ممنوع في قاعدة البيانات نفسها.
  tx(()=>wf.proposeExecutionDeputy(db,users.admin,{service_code:'FIN-REFUND',rank:2,user_id:'hr',basis:'نائب الرتبة الثانية حين يتعذر الأول، بقرار الرئاسة نفسه'}));
  tx(()=>wf.acceptExecutionDeputy(db,users['head-hr'],{service_code:'FIN-REFUND',rank:2,note:'قبِلتُ التسمية بوصفي نائبًا في الرتبة الثانية'}));
  assert.deepEqual(wf.deputiesFor(db,'36t','FIN-REFUND').map(d=>d.user_id),['it','hr'],'يُسأل الأول ثم الذي يليه');
  tx(()=>wf.withdrawExecutionDeputy(db,users.admin,{service_code:'FIN-REFUND',rank:1,basis:'انتقل الموظف إلى إدارة أخرى، بقرار الرئاسة رقم 9'}));
  assert.deepEqual(wf.deputiesFor(db,'36t','FIN-REFUND').map(d=>d.user_id),['hr']);
  assert.equal(db.prepare("SELECT status FROM execution_deputies WHERE service_code='FIN-REFUND' AND rank=1").get().status,'withdrawn','المسحوب يبقى في السجل');
  assert.throws(()=>db.prepare("DELETE FROM execution_deputies WHERE service_code='FIN-REFUND'").run(),/append-only/);
  assert.equal(verifyAudit(db),true);
});

// ── (4) التبني يُرفض إن قطع آخر منفذ ───────────────────────────────────────────
test('سلسلة التنفيذ: تبنّي مقترح يُرفض حين يقطع آخر منفذ، ويسمّي الإدارة والناقص',t=>{
  const {db,users,tx}=fixture(t);
  const KEY='c1-chain-fin-budget-transfer';
  // اقطع سُلَّم التصعيد كله فوق المالية: لا مرجع للإدارة، ولا رئيس تنفيذي نشط فوقه.
  db.prepare("DELETE FROM department_escalation WHERE department_id='finance'").run();
  db.prepare("UPDATE users SET active=0 WHERE id='ceo'").run();
  let refusal=null;
  assert.throws(()=>tx(()=>adoptPolicyProposal(db,users.admin,KEY,{basis:BASIS})),
    error=>{refusal=error.details?.refusal;return error.code==='adoption_strands_service';});
  assert.match(refusal.what,/بلا منفذ/);
  assert.match(refusal.missing[0].document,/FIN-BUDGET-TRANSFER/);
  assert.equal(refusal.missing[0].owner_role,'structure.manage');
  assert.match(refusal.next,/نائبًا منفّذًا/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM approval_policy_adoptions WHERE proposal_key=?').get(KEY).n,0,'ولم يُكتب شيء');
  // سمِّ نائبًا واقبله، فيمضي التبني نفسه.
  tx(()=>wf.proposeExecutionDeputy(db,users.admin,{service_code:'FIN-BUDGET-TRANSFER',rank:1,user_id:'it',basis:'قرار الرئاسة رقم 11: تقنية المعلومات تنفّذ المناقلة حين تعتمدها المالية وحدها'}));
  assert.throws(()=>tx(()=>adoptPolicyProposal(db,users.admin,KEY,{basis:BASIS})),code('adoption_strands_service'),'المقترح وحده لا يرفع الحارس');
  tx(()=>wf.acceptExecutionDeputy(db,users['head-it'],{service_code:'FIN-BUDGET-TRANSFER',rank:1,note:'قبِلتُ تسمية موظفي نائبًا منفّذًا للمناقلات'}));
  assert.equal(tx(()=>adoptPolicyProposal(db,users.admin,KEY,{basis:BASIS})).adopted,true);
  // الرجوع عن المقترح لا يمر بالحارس: السحب لا يقطع منفذًا، بل يعيد الأوسع.
  assert.equal(tx(()=>adoptPolicyProposal(db,users.admin,KEY,{basis:BASIS,withdraw:true})).adopted,false);
});

// ── (5) الفحص لا يطمئن وضابطه مُطفأ ────────────────────────────────────────────
test('سلسلة التنفيذ: فحص الكتالوج يرفع «من يقرر ينفّذ» ملاحظةً أولى، ولا يقول «لا ملاحظات» والعدّ فوق الصفر',t=>{
  const {db,users}=fixture(t);
  const health=catalogHealth(db,'36t');
  // الحسّاسة خرجت من العدّ لأن ضابطها يصل مُشغَّلًا؛ والعادية تبقى معروضة لا مكتومة.
  assert.equal(health.decider_is_executor.sensitive,0,'لا خدمة حسّاسة يقرّرها من ينفّذها');
  assert.deepEqual(health.decider_is_executor.services.filter(c=>SOD_SERVICES.includes(c)),[]);
  assert.ok(health.decider_is_executor.count>0,'وما بقي من العادية معروض لا مكتوم');
  assert.ok(health.issues.some(i=>i.kind==='decider_is_executor'),'وله ملاحظة باسم خدمتها');
  // «142 خدمة مفحوصة، لا ملاحظات» جملة يستحيل طبعها ما دام العدّ فوق الصفر: العدّ نفسه ملاحظة.
  assert.equal(health.issues.filter(i=>i.kind==='decider_is_executor').length,health.decider_is_executor.count);
  assert.ok(health.issues.length>=health.decider_is_executor.count);
  assert.equal(approvalSettings(db,users.admin).health.decider_is_executor.count,health.decider_is_executor.count,'الشاشة تقرأ العدّ نفسه');
});

// ── (6) الترقية من قاعدة سابقة للترحيل 122 ────────────────────────────────────
test('الترحيل 122: قاعدة على الترحيل 121 تُرقّى، والشكل الجديد يفرض الرتبة والشخصين ومنع الحذف',()=>{
  const here=new URL('../app/migrations/',import.meta.url);
  const files=readdirSync(here).filter(f=>/^\d{3}-.+\.sql$/.test(f)).sort();
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../app/schema.sql',import.meta.url),'utf8'));
  for(const file of files.filter(f=>Number(f.slice(0,3))<122))db.exec(readFileSync(new URL(file,here),'utf8'));
  // الشكل قبل 122: نائب واحد لكل خدمة، بلا رتبة وبلا حالة وبلا من يقبل.
  const legacy=db.prepare("SELECT sql FROM sqlite_master WHERE name='execution_deputies'").get().sql;
  assert.match(legacy,/deputy_user_id/);assert.doesNotMatch(legacy,/\brank\b/);
  db.exec(readFileSync(new URL('122-execution-deputies.sql',here),'utf8'));
  const upgraded=db.prepare("SELECT sql FROM sqlite_master WHERE name='execution_deputies'").get().sql;
  for(const column of ['rank','user_id','status','proposed_by','accepted_by'])assert.match(upgraded,new RegExp(`\\b${column}\\b`),column);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM execution_deputies').get().n,0,'ولا بذرة: المنصة لا تسمّي نائبًا عن أحد');
  // القيود تُفرض في القاعدة نفسها لا في الكود وحده.
  db.exec("INSERT INTO tenants(id,name) VALUES('t','كيان اختبار'); INSERT INTO departments(id,tenant_id,name) VALUES('d','t','إدارة اختبار')");
  const person=(id,name)=>db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) VALUES(?,'t','d',?,?,'x','employee')").run(id,id,name);
  person('a','ألف');person('b','باء');person('c','جيم');
  const insert=(rank,user,by)=>db.prepare("INSERT INTO execution_deputies(tenant_id,service_code,rank,user_id,basis,status,proposed_by,proposed_at) VALUES('t','SVC',?,?,'سند تسمية مكتوب بما يكفي','proposed',?,'2026-09-21T00:00:00.000Z')").run(rank,user,by);
  assert.throws(()=>insert(1,'a','a'),/CHECK|constraint/,'من يسمّي النائب ليس النائب');
  assert.throws(()=>insert(4,'a','b'),/CHECK|constraint/,'الرتب من 1 إلى 3');
  insert(1,'a','b');
  assert.throws(()=>db.prepare("UPDATE execution_deputies SET status='accepted',accepted_by='b',accepted_at='2026-09-21T01:00:00.000Z' WHERE rank=1").run(),/CHECK|constraint/,'ومن سمّى لا يقبل');
  db.prepare("UPDATE execution_deputies SET status='accepted',accepted_by='c',accepted_at='2026-09-21T01:00:00.000Z' WHERE rank=1").run();
  assert.throws(()=>db.prepare("UPDATE execution_deputies SET user_id='c' WHERE rank=1").run(),/deputy row moves only/,'ولا يُبدَّل الشخص في مكانه بلا أثر');
  assert.throws(()=>db.prepare('DELETE FROM execution_deputies').run(),/append-only/,'ولا يُمحى نائب سُمّي يومًا');
  db.close();
});

test('فصل المهام ليس مقترحًا ينتظر تبنّيًا: لا مفتاح b3-sod في قائمة المقترحات، والضابط في التعريف',()=>{
  assert.equal(SOD_SERVICES.length,22);
  assert.deepEqual(policyProposals.filter(p=>p.key.startsWith('b3-sod')),[],'لا يُنتظر قرار كيان لضابط تحمله المنصة');
  assert.equal(hash('x').length,64);
});
