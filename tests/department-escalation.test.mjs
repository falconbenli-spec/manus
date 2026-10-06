// مرجع تصعيد الإدارة: البابُ الذي لم يكن له باب — 23 سبتمبر 2026.
//
// القياس الذي استدعى هذا العمل، على القاعدة الحية: department_escalation يحمل السبع عشرة إدارة النشطة،
// وأربع عشرة منها تشير إلى حسابين مصطنعين («نائب الرئيس للخدمات المؤسسية (تجريبي)» و«نائب الرئيس للنمو
// والقنوات (تجريبي)») لا يحملهما أحد. والجدول كان يُكتب في موضع واحد: installServiceCatalog. فلا شاشة
// ولا دالة ولا تدقيق، والمالك لا يملك موضعًا يسمّي فيه من يغطّي إدارة.
//
// وأثره الذي أوقف العمل فعلًا: canApproveThresholds (app/workflow.mjs) تسأل هذا الجدول بعينه، فحساب
// المالك المسمّى head-hr لا يعتمد حدًّا ولا يتبنى مهلة، وحسابه الإداري admin يمنعه فصل المهام لأنه من اقترحها.
//
// كل اختبار هنا يمشي واقعة من هذه بنصها.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { canApproveThresholds } from '../app/workflow.mjs';
import { proposeTimer, adoptTimer } from '../app/workflow-timers.mjs';
import { assignDepartmentEscalation, escalationBoard, escalationSummary, escalationCandidates } from '../app/department-escalation.mjs';

const code=value=>error=>error.code===value;
const BASIS='قرار صاحب المنصة بتاريخ 2026-09-23: مدير رأس المال البشري يغطي إدارته حتى تُسمّى الرئاسة الحقيقية';

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-department-escalation');t.after(()=>db.close());
  installServiceCatalog(db);
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  const tx=f=>transaction(db,f);
  const assign=(who,input)=>tx(()=>assignDepartmentEscalation(db,users[who],input));
  const board=()=>escalationBoard(db,'36t');
  const rowOf=id=>board().find(x=>x.department_id===id);
  return {db,users,tx,assign,board,rowOf};
}

// ── (1) الحال المقيسة: الباب الوحيد كان التثبيت، وأكثر الإدارات تشير إلى حساب لا يحمله أحد ───────────
test('مرجع التصعيد: اللوح يسمّي من يغطّي كل إدارة، ويعلّم من يشير منها إلى حساب مصطنع',t=>{
  const {board}=fixture(t);
  const summary=escalationSummary(board());
  assert.equal(summary.departments,17,'السبع عشرة إدارة النشطة كلها في اللوح');
  assert.equal(summary.missing,0,'ولا واحدة بلا صف تصعيد — التثبيت يكتبها كلها');
  assert.ok(summary.synthetic>=13,`أكثرها يشير إلى حساب مصطنع: ${summary.synthetic}`);
  assert.equal(summary.synthetic+summary.healthy,17,'كل صف إما مصطنع وإما حساب حقيقي نشط بدور مدير');
  // العلامة ليست قائمة معرّفات محفوظة: الاسم نفسه يحمل «تجريبي».
  for(const item of board().filter(x=>x.synthetic))assert.match(item.holder_name,/تجريبي/);
});

test('مرجع التصعيد: قائمة المرشحين هي عين ما يقبله الخادم — نشط، في الكيان، بدور مدير',t=>{
  const {db,users}=fixture(t);
  const candidates=escalationCandidates(db,'36t');
  assert.ok(candidates.length>0);
  for(const c of candidates){
    const person=db.prepare('SELECT role,active,tenant_id FROM users WHERE id=?').get(c.id);
    assert.equal(person.role,'manager');assert.equal(person.active,1);assert.equal(person.tenant_id,'36t');
  }
  assert.ok(!candidates.some(c=>c.id===users.hr.id),'حساب بدور «موارد بشرية» ليس مرشحًا');
  assert.ok(!candidates.some(c=>c.id==='admin'),'حساب إدارة المنصة ليس مرشحًا');
});

// ── (2) المالك وحده يسمّي ────────────────────────────────────────────────────────────────────────
test('مرجع التصعيد: يسمّيه الأدمن الأول وحده، ويُرفض على كل حساب سواه برفض يسمّي الناقص ومالكه',t=>{
  const {assign,rowOf}=fixture(t);
  assign('admin',{department_id:'hr',user_id:'head-hr',basis:BASIS});
  assert.equal(rowOf('hr').user_id,'head-hr');

  for(const who of ['head-hr','manager','hr','employee']){
    assert.throws(()=>assign(who,{department_id:'it',user_id:'head-it',basis:BASIS}),error=>{
      assert.equal(error.code,'forbidden',who);
      const refusal=error.details.refusal;
      assert.match(refusal.what,/بحسابك/);
      assert.ok(refusal.missing.length&&refusal.missing[0].owner,'الرفض يسمّي من يملك الناقص');
      assert.match(refusal.missing[0].document,/الأدمن الأول/);
      assert.ok(refusal.next,'ويقول الخطوة التالية');
      return true;
    },who);
  }
  assert.ok(rowOf('it').synthetic,'ولم تتغير إدارة أخرى بمحاولة مرفوضة');
});

test('مرجع التصعيد: لا تُكتب التسمية خارج معاملة، ولا بسند أقصر من سطر',t=>{
  const {db,users,assign}=fixture(t);
  assert.throws(()=>assignDepartmentEscalation(db,users.admin,{department_id:'hr',user_id:'head-hr',basis:BASIS}),code('transaction_required'));
  assert.throws(()=>assign('admin',{department_id:'hr',user_id:'head-hr',basis:'قصير'}),code('invalid_text'));
});

// ── (3) من لا يصلح أن يُسمّى: موقوف، أو من كيان آخر، أو بدور لا يحمل الوقفة ──────────────────────────
test('مرجع التصعيد: الحساب الموقوف والحساب من كيان آخر والدور الذي لا يحمل الوقفة — ثلاثة رفضات مسمّاة',t=>{
  const {db,assign,rowOf}=fixture(t);

  db.prepare("UPDATE users SET active=0 WHERE id='head-it'").run();
  assert.throws(()=>assign('admin',{department_id:'it',user_id:'head-it',basis:BASIS}),error=>{
    assert.equal(error.code,'escalation_inactive');
    assert.match(error.details.refusal.what,/موقوف/);
    assert.match(error.details.refusal.missing[0].document,/حساب نشط/);
    assert.match(error.details.refusal.missing[0].why,/لا يصل إلى أحد/);
    return true;
  });

  // «external» حساب الكيان المعزول في البذرة: موجود في المنصة، وليس في كيان المالك.
  assert.throws(()=>assign('admin',{department_id:'it',user_id:'external',basis:BASIS}),error=>{
    assert.equal(error.code,'escalation_foreign_tenant');
    assert.match(error.details.refusal.what,/كيان آخر/);
    assert.ok(error.details.refusal.missing[0].owner);
    return true;
  });
  assert.throws(()=>assign('admin',{department_id:'it',user_id:'لا-حساب-بهذا-المعرّف',basis:BASIS}),code('escalation_user'));

  // دور «موارد بشرية» لا يحمل الوقفة: محرك العمل يقرأ المرجع بدور «مدير» وحده.
  assert.throws(()=>assign('admin',{department_id:'it',user_id:'hr',basis:BASIS}),error=>{
    assert.equal(error.code,'escalation_role');
    assert.match(error.details.refusal.missing[0].document,/مدير/);
    return true;
  });
  // وحساب إدارة المنصة كذلك: escalationApprover تستثنيه أصلًا، فالرفض يقع قبل الكتابة لا بعدها.
  assert.throws(()=>assign('admin',{department_id:'it',user_id:'admin',basis:BASIS}),code('escalation_role'));

  assert.equal(rowOf('it').user_id,'vp-corporate','ولم يُكتب شيء من كل ذلك');

  // وإدارة غير موجودة أو مؤرشفة.
  assert.throws(()=>assign('admin',{department_id:'لا-إدارة',user_id:'head-hr',basis:BASIS}),code('department'));
  db.prepare("UPDATE departments SET active=0 WHERE id='brand'").run();
  assert.throws(()=>assign('admin',{department_id:'brand',user_id:'head-hr',basis:BASIS}),code('department_archived'));
});

// ── (4) كل تسمية حدث تدقيق باسم من سمّى ومن كان قبله ────────────────────────────────────────────
test('مرجع التصعيد: التسمية تكتب حدث تدقيق يحمل من كان قبله ومن صار، وسلسلة التدقيق تبقى صحيحة',t=>{
  const {db,assign}=fixture(t);
  const before=db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='escalation.assigned'").get().n;
  assign('admin',{department_id:'hr',user_id:'head-hr',basis:BASIS});
  const events=db.prepare("SELECT * FROM audit_events WHERE action='escalation.assigned' ORDER BY seq DESC LIMIT 1").all();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='escalation.assigned'").get().n,before+1);
  const event=events[0];
  assert.equal(event.actor_id,'admin');
  assert.equal(event.entity_type,'department');
  assert.equal(event.entity_id,'hr');
  assert.equal(event.reason,BASIS,'السند المكتوب يُحفظ كما كُتب');
  assert.equal(JSON.parse(event.before_json).user_id,'vp-corporate','ومن كان قبله مسمّى في الحدث');
  assert.equal(JSON.parse(event.before_json).synthetic,true,'ومعلَّم أنه كان حسابًا مصطنعًا');
  assert.equal(JSON.parse(event.after_json).user_id,'head-hr');
  assert.equal(JSON.parse(event.after_json).internal,true,'والمرجع من داخل الإدارة نفسها مُعلَّم في الحدث لا مخفيًّا');
  assert.ok(verifyAudit(db),'وسلسلة التدقيق تبقى صحيحة');
});

// ── (5) الواقعة التي أوقفت العمل: المالك يتبنى مهلة اقترحها غيره بعد أن سُمّي مرجعَ إدارته ──────────
test('مرجع التصعيد: بعد تسمية المالك مرجعًا لإدارته يتبنى مهلة اقترحها غيره، ومن اقترحها لا يتبناها',t=>{
  const {db,users,tx,assign}=fixture(t);
  const owner=()=>db.prepare("SELECT * FROM users WHERE id='head-hr'").get();
  // على القاعدة الحية هذا الحساب حسابُ المالك المسمّى باسمه، وعلى البذرة يُنشئه التثبيت بلاصقة «تجريبي».
  // الفرق الوحيد الذي يهم هنا أنه حساب يحمله إنسان، فيُنزع اللاصق باسم الوظيفة وحدها: لا اسم شخص يُخترع.
  db.prepare("UPDATE users SET name='مدير رأس المال البشري' WHERE id='head-hr'").run();

  // قبل التسمية: حساب المالك المسمّى ليس مرجع تصعيد أي إدارة ولا الرئيس التنفيذي، فلا يعتمد حدًّا ولا يتبنى مهلة.
  assert.equal(canApproveThresholds(db,owner()),false);

  // يقترح الأدمن رقمًا (وهو من يدير دليل الخدمات)، ثم يمنعه فصل المهام من تبنّي ما اقترحه هو.
  const proposed=tx(()=>proposeTimer(db,users.admin,{timer_key:'approval_escalation',value:3,
    basis:'مسودة الرقم من دليل الخدمات، تنتظر تبنّي الرئاسة كما تقول القاعدة: لا يسري رقم بهوية واحدة'}));
  const open=db.prepare("SELECT * FROM workflow_timer_settings WHERE timer_key='approval_escalation' AND status='proposed'").get();
  assert.ok(open&&proposed,'المقترح مفتوح');
  assert.throws(()=>tx(()=>adoptTimer(db,users.admin,open.id,{note:''})),code('separation_of_duties'),'من اقترح لا يتبنى ولو كان الأدمن الأول');
  assert.throws(()=>tx(()=>adoptTimer(db,owner(),open.id,{note:''})),code('not_permitted'),'والمالك بحسابه المسمّى لا يتبنى قبل أن يُسمّى مرجعًا');

  // التسمية: المالك مرجع تصعيد إدارته. وهي الحالة المعلَّمة «من داخل الإدارة نفسها» — جائزة ومرئية.
  const written=assign('admin',{department_id:'hr',user_id:'head-hr',basis:BASIS});
  assert.equal(written.internal,true);
  assert.equal(written.board.healthy,true);
  assert.equal(written.board.synthetic,false);

  // وبعدها: الوقفة قائمة، والتبني يجري بيد ثانية غير يد من اقترح.
  assert.equal(canApproveThresholds(db,owner()),true);
  tx(()=>adoptTimer(db,owner(),open.id,{note:'تبنّي الرقم بعد مراجعته؛ التصعيد يبدأ عدّه من لحظة التبني'}));
  const adopted=db.prepare("SELECT * FROM workflow_timer_settings WHERE id=?").get(open.id);
  assert.equal(adopted.status,'adopted');
  assert.equal(adopted.adopted_by,'head-hr');
  assert.equal(adopted.proposed_by,'admin','ويبقى مكتوبًا أن اليدين اثنتان');

  // ومن يقترح يبقى ممنوعًا من تبنّي اقتراحه هو، ولو بعد أن صار لغيره الحق.
  tx(()=>proposeTimer(db,users.admin,{timer_key:'returned_reminder_first',value:3,
    basis:'التذكير الأول بالطلب المعاد، مسودة من دليل الخدمات تنتظر تبنّي الرئاسة'}));
  const second=db.prepare("SELECT * FROM workflow_timer_settings WHERE timer_key='returned_reminder_first' AND status='proposed'").get();
  assert.throws(()=>tx(()=>adoptTimer(db,users.admin,second.id,{note:''})),code('separation_of_duties'));
  assert.ok(verifyAudit(db));
});
