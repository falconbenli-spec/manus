import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { serviceCard, cardsBoard, saveCard, draftMissingCards, publishCard, SERVICE_MODULES } from '../app/service-cards.mjs';
import { operationModules } from '../app/static/operations.mjs';
import { inbox } from '../app/inbox.mjs';

const code=value=>error=>error.code===value;
const tomorrow=()=>new Date(Date.now()+27*3600000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-service-cards');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const full={owner_id:'hr',requesters:'كل موظف على رأس العمل',service_kind:'institutional',confidentiality:'restricted',trigger_note:'حاجة الموظف إلى خطاب لجهة خارجية',outputs:'خطاب موقّع يُسلَّم للموظف خلال الزمن المستهدف',acceptance_evidence:'تأكيد الموظف استلام الخطاب',financial_limit_note:'',exceptions_note:'',kpis:'نسبة الإنجاز ضمن الزمن المستهدف، ومتوسط التقييم',integrations:'',policy_reference:''};
  return {db,users,tx,full};
}

test('service card: what the platform really does is derived, a service is not “ready” without a published complete card, and the named owner — not the author — publishes it',t=>{
  const {db,users,tx,full}=fixture(t);
  const before=serviceCard(db,users.employee,'HR-LETTER');
  assert.equal(before.ready,false);assert.match(before.readiness,/بلا بطاقة/);
  assert.deepEqual(before.service.steps,['المدير المباشر لصاحب الطلب','الموارد البشرية']);assert.ok(before.service.inputs.some(f=>f.required));assert.equal(before.service.self_approval_blocked,true);
  assert.throws(()=>tx(()=>saveCard(db,users.manager,'HR-LETTER',full)),code('not_permitted'));
  assert.throws(()=>tx(()=>saveCard(db,users.admin,'HR-LETTER',{...full,owner_id:'admin'})),error=>['owner_id','separation_of_duties'].includes(error.code));
  tx(()=>saveCard(db,users.admin,'HR-LETTER',{...full,kpis:''}));
  assert.equal(serviceCard(db,users.employee,'HR-LETTER').draft,null,'an unpublished draft is not shown to employees');
  assert.deepEqual(serviceCard(db,users.hr,'HR-LETTER').draft_missing,['المؤشرات']);
  assert.throws(()=>tx(()=>publishCard(db,users.hr,'HR-LETTER',{effective_from:tomorrow(),note:'أقر بملكية إجراء الخطابات'})),code('card_incomplete'));
  tx(()=>saveCard(db,users.admin,'HR-LETTER',full));
  assert.throws(()=>tx(()=>publishCard(db,users.manager,'HR-LETTER',{effective_from:tomorrow(),note:'لست المالك المسمى في البطاقة'})),code('not_found'));
  assert.ok(inbox(db,users.hr).groups.some(g=>g.key==='service-cards'),'the owner is told a card awaits them');
  tx(()=>publishCard(db,users.hr,'HR-LETTER',{effective_from:tomorrow(),note:'أقر بملكية إجراء الخطابات ومخرجاته ومؤشراته'}));
  const after=serviceCard(db,users.employee,'HR-LETTER');
  assert.equal(after.ready,true);assert.equal(after.published.owner_name,users.hr.name);assert.equal(after.published.revision,1);
  assert.throws(()=>db.prepare("UPDATE service_cards SET outputs='تعديل صامت',version=version+1 WHERE status='published'").run(),/replaced by a new revision/);
  // تعديل بطاقة منشورة = نسخة جديدة تحل محلها عند اعتمادها، وتبقى القديمة محفوظة.
  tx(()=>saveCard(db,users.admin,'HR-LETTER',{...full,outputs:'خطاب موقّع ومختوم يُسلَّم إلكترونيًا'}));
  assert.equal(serviceCard(db,users.employee,'HR-LETTER').published.revision,1,'the published revision stays in force until the owner accepts the new one');
  tx(()=>publishCard(db,users.hr,'HR-LETTER',{effective_from:tomorrow(),note:'أعتمد النسخة الثانية بعد تحديث المخرجات'}));
  assert.equal(serviceCard(db,users.employee,'HR-LETTER').published.revision,2);
  assert.deepEqual(db.prepare("SELECT status FROM service_cards WHERE service_code='HR-LETTER' ORDER BY revision").all().map(r=>r.status),['superseded','published']);
  assert.ok(verifyAudit(db));
});

test('service cards: bulk drafts suggest only what the platform knows, never outputs or KPIs, and every mapped service points to a screen that exists',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>draftMissingCards(db,users.manager)),code('not_permitted'));
  const created=tx(()=>draftMissingCards(db,users.admin)).created,board=cardsBoard(db,users.admin);
  assert.equal(created,board.totals.services);assert.equal(board.totals.draft,created);assert.equal(board.totals.ready,0,'a generated draft never counts as ready');
  assert.equal(tx(()=>draftMissingCards(db,users.admin)).created,0,'repeatable');
  for(const row of db.prepare('SELECT outputs,kpis,acceptance_evidence,trigger_note FROM service_cards').all())assert.deepEqual(Object.values(row),['','','',''],'nothing about what the service delivers is invented');
  assert.equal(cardsBoard(db,users.employee).services.length,0,'employees see published cards only');
  for(const [service,module] of Object.entries(SERVICE_MODULES))assert.ok(operationModules[module],`${service} points to a missing screen: ${module}`);
});
