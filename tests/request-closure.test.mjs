import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import { closeWithEvidence, requestReopen, closureView, closureBoard, setReopenWindow } from '../app/request-closure.mjs';
import { timeline } from '../app/request-timeline.mjs';
import { saveCard, publishCard } from '../app/service-cards.mjs';
import { fixture, code, DELIVERED } from './request-transparency-fixture.mjs';

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());
const tomorrow=()=>new Date(Date.now()+27*3600000).toISOString().slice(0,10);
const window=(days=5,scope='*')=>({scope_code:scope,window_days:days,basis:'تجريبي: قرار مالك الإجراء في اجتماع تجريبي',confirmed_on:today()});
const REASON='تجريبي: ما زال الدخول إلى البريد متعذرًا من الجوال';

test('closure needs evidence: a request closes only with a description of what was delivered, and its requester is told',t=>{
  const f=fixture(t,'closure-evidence'),id=f.inProgress();
  assert.throws(()=>f.tx(()=>closeWithEvidence(f.db,f.users.it,id,{version:f.version(id),delivered:'تم'})),code('invalid_text'),'“done” is not evidence');
  assert.throws(()=>f.tx(()=>closeWithEvidence(f.db,f.users.it,id,{version:f.version(id)+1,delivered:DELIVERED})),code('stale_version'));
  assert.throws(()=>f.tx(()=>closeWithEvidence(f.db,f.users.manager,id,{version:f.version(id),delivered:DELIVERED})),code('transition_denied'),'an approver does not close the work of the handler');
  assert.throws(()=>f.tx(()=>closeWithEvidence(f.db,f.users.employee,id,{version:f.version(id),delivered:DELIVERED})),code('transition_denied'),'the requester does not certify their own delivery');
  assert.throws(()=>f.tx(()=>closeWithEvidence(f.db,f.users.external,id,{version:1,delivered:DELIVERED})),code('not_found'),'tenant isolation');
  assert.equal(f.db.prepare('SELECT status FROM requests WHERE id=?').get(id).status,'in_progress','a refused closure leaves nothing behind');

  const view=f.tx(()=>closeWithEvidence(f.db,f.users.it,id,{version:f.version(id),delivered:DELIVERED}));
  assert.equal(view.request.status,'completed');assert.equal(view.closures.length,1);assert.equal(view.closures[0].delivered,DELIVERED);assert.equal(view.first_time_right,true);
  assert.ok(f.db.prepare("SELECT 1 FROM notifications WHERE request_id=? AND user_id='employee' AND kind='execution_completed'").get(id),'no silent closure');
  // قيود SQL تحمي القاعدة حتى لو تجاوز أحدٌ الكود.
  assert.throws(()=>f.db.prepare("UPDATE request_closures SET delivered='تجريبي: إعادة كتابة صامتة لدليل التسليم'").run(),/written once/);
  assert.throws(()=>f.db.prepare('DELETE FROM request_closures').run(),/retained/);
  assert.throws(()=>f.db.prepare("INSERT INTO request_closures VALUES('x','36t',?,2,?,'employee','it',?)").run(id,DELIVERED,new Date().toISOString()),/does not certify/);
  assert.ok(verifyAudit(f.db));
});

test('reopening: the window is a setting owned by the procedure owner, never a constant, and without it reopening is simply unavailable',t=>{
  const f=fixture(t,'closure-window'),id=f.closed();
  assert.equal(closureView(f.db,f.users.employee,id).reopen.available,false);
  assert.match(closureView(f.db,f.users.employee,id).reopen.why,/لم يحددها مالك الإجراء/);
  assert.throws(()=>f.tx(()=>requestReopen(f.db,f.users.employee,id,{version:f.version(id),reason:REASON})),code('window_unset'));

  assert.throws(()=>f.tx(()=>setReopenWindow(f.db,f.users.manager,window())),code('not_permitted'));
  assert.throws(()=>f.tx(()=>setReopenWindow(f.db,f.users.it,window(5,'IT-SUPPORT'))),code('not_permitted'),'handling a service is not owning its procedure');
  assert.throws(()=>f.tx(()=>setReopenWindow(f.db,f.users.admin,{...window(),basis:'قصير'})),code('invalid_text'),'a window without a basis is refused');
  assert.throws(()=>f.tx(()=>setReopenWindow(f.db,f.users.admin,{...window(),confirmed_on:tomorrow()})),code('confirmed_on'));
  f.tx(()=>setReopenWindow(f.db,f.users.admin,window(5)));

  // مالك الإجراء المسمى في البطاقة المنشورة يحدد مهلة خدمته، وتتقدم على المهلة العامة.
  const card={owner_id:'it',requesters:'تجريبي: كل موظف',service_kind:'institutional',confidentiality:'internal',trigger_note:'تجريبي: عطل تقني',outputs:'تجريبي: حل موثق',acceptance_evidence:'تجريبي: تأكيد صاحب الطلب',financial_limit_note:'',exceptions_note:'',kpis:'تجريبي: الإنجاز ضمن الزمن',integrations:'',policy_reference:''};
  f.tx(()=>saveCard(f.db,f.users.admin,'IT-SUPPORT',card));
  f.tx(()=>publishCard(f.db,f.users.it,'IT-SUPPORT',{effective_from:tomorrow(),note:'تجريبي: أقر بملكية إجراء الدعم التقني'}));
  f.tx(()=>setReopenWindow(f.db,f.users.it,window(2,'IT-SUPPORT')));
  assert.equal(closureView(f.db,f.users.employee,id).reopen.window_days,2);
  f.tx(()=>setReopenWindow(f.db,f.users.it,window(3,'IT-SUPPORT')));
  assert.deepEqual(f.db.prepare("SELECT window_days,superseded_at IS NULL AS live FROM reopen_settings WHERE scope_code='IT-SUPPORT' ORDER BY created_at,window_days").all().map(r=>[r.window_days,r.live]),[[2,0],[3,1]],'the old window stays on record');
  assert.throws(()=>f.db.prepare("UPDATE reopen_settings SET window_days=90 WHERE superseded_at IS NULL").run(),/not edited/);
  assert.equal(closureBoard(f.db,f.users.external).settings.length,0,'another tenant reads none of these settings');
  assert.ok(verifyAudit(f.db));
});

test('reopening keeps the first closure: a second round is linked to it, so the record shows the service was not delivered first time',t=>{
  const f=fixture(t,'closure-reopen'),id=f.closed();
  f.tx(()=>setReopenWindow(f.db,f.users.admin,window(5)));
  assert.throws(()=>f.tx(()=>requestReopen(f.db,f.users.it,id,{version:f.version(id),reason:REASON})),code('forbidden'),'the handler does not reopen');
  assert.throws(()=>f.tx(()=>requestReopen(f.db,f.users.outsider,id,{version:f.version(id),reason:REASON})),code('not_found'));
  assert.throws(()=>f.tx(()=>requestReopen(f.db,f.users.employee,id,{version:f.version(id),reason:'لم يعمل'})),code('invalid_text'),'a written reason is required');
  assert.throws(()=>f.tx(()=>requestReopen(f.db,f.users.employee,id,{version:f.version(id)-1,reason:REASON})),code('stale_version'));

  const view=f.tx(()=>requestReopen(f.db,f.users.employee,id,{version:f.version(id),reason:REASON}));
  assert.equal(view.request.status,'in_progress');assert.equal(view.closures.length,1,'the first closure is untouched');
  assert.equal(view.closures[0].delivered,DELIVERED);assert.equal(view.reopenings[0].round,2);assert.equal(view.reopenings[0].closure_id,view.closures[0].id);
  assert.ok(f.db.prepare("SELECT 1 FROM notifications WHERE request_id=? AND user_id='it' AND kind='request_reopened'").get(id),'the handler is told');
  assert.throws(()=>f.tx(()=>requestReopen(f.db,f.users.employee,id,{version:f.version(id),reason:REASON})),code('not_completed'));

  f.tx(()=>closeWithEvidence(f.db,f.users.it,id,{version:f.version(id),delivered:'تجريبي: ضُبط تطبيق البريد على الجوال وجُرّب مع صاحبة الطلب'}));
  const after=closureView(f.db,f.users.employee,id);
  assert.deepEqual(after.closures.map(c=>c.round),[1,2]);assert.equal(after.first_time_right,false,'a second round is never “right first time”');
  const story=timeline(f.db,f.users.employee,id);
  assert.deepEqual(story.events.map(e=>e.action).filter(a=>['complete','request.reopened'].includes(a)),['complete','request.reopened','complete']);
  assert.ok(story.stages.some(s=>/إعادة عمل/.test(s.party)),'the rework shows as its own stage');assert.equal(story.rounds.delivered_first_time,false);
  assert.equal(closureBoard(f.db,f.users.it).totals.reopened,1);
  // القيود في SQL: إعادة الفتح لصاحب الطلب وحده، وتتبع إغلاق الجولة السابقة، ولا تُعدَّل.
  const closure=after.closures[1].id,stamp=new Date().toISOString();
  assert.throws(()=>f.db.prepare("INSERT INTO request_reopenings VALUES('y','36t',?,?,3,?,'it',5,'2099-01-01',?)").run(id,closure,REASON,stamp),/requester alone/);
  assert.throws(()=>f.db.prepare("INSERT INTO request_reopenings VALUES('y','36t',?,?,5,?,'employee',5,'2099-01-01',?)").run(id,closure,REASON,stamp),/follows the closure/);
  assert.throws(()=>f.db.prepare("UPDATE request_reopenings SET reason='تجريبي: سبب معاد كتابته'").run(),/written once/);
  assert.ok(verifyAudit(f.db));
});

test('reopening closes with its window, counted in working days; a request closed without evidence has nothing to reopen',t=>{
  const f=fixture(t,'closure-expiry'),id=f.closed();
  f.tx(()=>setReopenWindow(f.db,f.users.admin,window(2)));
  const open=closureView(f.db,f.users.employee,id);
  assert.equal(open.reopen.available,true);assert.ok(open.reopen.deadline_on>today(),'two working days never end today');assert.deepEqual(open.actions,['reopen']);
  assert.deepEqual(closureView(f.db,f.users.it,id).actions,[],'the handler is offered no reopening');

  // طلبٌ أُغلق قبل أن يصير الإغلاق بدليل هو الباب الوحيد: يظهر فجوةً في اللوحة ولا يُعاد فتحه.
  // مُحدَّث في 21 سبتمبر 2026 وسببه مكتوب: `POST /api/requests/:id/complete` صار يمر بـcloseWithEvidence، فلم يعد
  // هذا الإغلاق ممكنًا من شاشة. ما يُمشى هنا هو `transition(...,'complete')` مباشرةً — الحالة التاريخية بعينها،
  // فالتاريخ لم يُردَم بأثر رجعي. الاختبار باقٍ لأن هذه الطلبات قائمة في القاعدة ولها حق أن تشرح نفسها.
  const plain=f.inProgress();f.act('it',plain,'complete','تم الحل');
  // ولم يعد رفضًا مسدودًا: يسمّي الناقص ومن أغلقه بالاسم والخطوة التالية، على معيار app/refusal.mjs.
  assert.throws(()=>f.tx(()=>requestReopen(f.db,f.users.employee,plain,{version:f.version(plain),reason:REASON})),error=>{
    assert.ok(code('no_closure_record')(error));
    assert.equal(error.details.refusal.missing[0].owner,f.users.it.name);
    assert.ok(error.details.refusal.next.includes('طلبًا جديدًا'));
    return true;});
  const board=closureBoard(f.db,f.users.it);
  assert.deepEqual(board.gaps.without_evidence.map(r=>r.id),[plain]);assert.deepEqual(board.gaps.silent,[]);
  assert.equal(board.totals.closed_with_evidence,1);

  t.mock.timers.enable({apis:['Date'],now:Date.now()+20*86400000});
  assert.equal(closureView(f.db,f.users.employee,id).reopen.available,false);
  assert.throws(()=>f.tx(()=>requestReopen(f.db,f.users.employee,id,{version:f.version(id),reason:REASON})),code('window_closed'));
  t.mock.timers.reset();
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM request_reopenings').get().n,0);
  assert.ok(verifyAudit(f.db));
});
