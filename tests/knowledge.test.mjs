import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { preparePolicy, decidePolicy } from '../app/hr-contracts.mjs';
import { knowledgeBoard, registerSource, sourceAction, annotateSources, knowledgeWarnings, WARNINGS } from '../app/knowledge.mjs';

const code=value=>error=>error.code===value;
const riyadh=(offset=0)=>new Date(Date.now()+3*3600000+offset*86400000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-knowledge-access');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  // سياسة تجريبية معتمدة: تعدها الموارد البشرية ويعتمدها المدير بعد منحه تصريح الاعتماد.
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.policy.accept',note:'تجريبي'}));
  const policyId=tx(()=>preparePolicy(db,users.hr,{kind:'working_time',title:'ساعات العمل التجريبية',body:'يبدأ الدوام التجريبي الساعة الثامنة صباحًا وينتهي الرابعة عصرًا من الأحد إلى الخميس.',basis:'قرار تجريبي للاختبار فقط',effective_from:riyadh(),parameters:{workdays:[0,1,2,3,4],start:'08:00',end:'16:00',grace_minutes:15}})).id;
  tx(()=>decidePolicy(db,users.manager,policyId,'accept',{note:'اعتماد تجريبي للاختبار'}));
  const cite=()=>db.prepare("INSERT INTO ai_runs(id,tenant_id,assistant_key,instructions_version,provider,model,user_id,sources,input_digest,input_chars,output,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(),'36t','policy_answer',1,'retrieval','','employee',JSON.stringify([{type:'hr_policy',id:policyId,title:'ساعات العمل التجريبية',effective_from:riyadh(),paragraph:1},{type:'hr_policy',id:policyId,title:'ساعات العمل التجريبية',effective_from:riyadh(),paragraph:2}]),'x',10,'تجريبي','completed',now());
  return {db,users,tx,policyId,cite};
}
const register=(db,u,extra={})=>registerSource(db,u,{kind:'policy',reference:'working_time',title:'سياسة ساعات العمل',location_note:'',owner_id:'hr',review_interval_days:180,...extra});

test('knowledge: registering is not verifying, the registrar never owns the source, and only the named owner confirms it by name and date',t=>{
  const {db,users,tx}=fixture(t);
  assert.throws(()=>tx(()=>register(db,users.employee)),code('not_permitted'));
  assert.throws(()=>tx(()=>register(db,users.manager,{owner_id:'manager'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>register(db,users.manager,{reference:'end_of_service'})),code('source_missing'),'a source must point at an accepted policy that exists');
  const id=tx(()=>register(db,users.manager)).id;
  assert.throws(()=>tx(()=>register(db,users.manager)),code('duplicate_source'));
  let s=knowledgeBoard(db,users.manager).sources.find(x=>x.id===id);
  assert.equal(s.state,'unverified');assert.equal(s.warning,WARNINGS.unverified);assert.equal(s.last_verified_on,null);
  assert.ok(knowledgeBoard(db,users.hr).awaiting_me.some(a=>a.id===id),'an unconfirmed source waits for its owner');
  // مدير قاعدة المعرفة لا يؤكد عن المالك، ولو كان يملك التصريح.
  assert.throws(()=>tx(()=>sourceAction(db,users.manager,id,'verify_source',{version:s.version,note:'راجعتها وما زالت صحيحة'})),code('not_owner'));
  assert.throws(()=>tx(()=>sourceAction(db,users.hr,id,'verify_source',{version:s.version+1,note:'راجعتها وما زالت صحيحة'})),code('stale_version'));
  tx(()=>sourceAction(db,users.hr,id,'verify_source',{version:s.version,note:'راجعت النص مقابل قرار الدوام وما زال صحيحًا'}));
  s=knowledgeBoard(db,users.manager).sources.find(x=>x.id===id);
  assert.equal(s.state,'verified');assert.equal(s.last_verified_on,riyadh());assert.equal(s.last_verified_by_name,users.hr.name);assert.equal(s.expires_on,riyadh(180));assert.equal(s.warning,null);
  assert.equal(s.history[0].decision,'confirmed');
  // لا طريق لتمديد الصلاحية دون تأكيد مسجل، ولا لإعادة كتابة التأكيد، ولا لحذف المصدر.
  assert.throws(()=>db.prepare("UPDATE knowledge_sources SET expires_on='2099-01-01',version=version+1 WHERE id=?").run(id),/recorded owner confirmation/);
  assert.throws(()=>db.prepare("UPDATE knowledge_verifications SET note='تعديل صامت للتأكيد'").run(),/never rewritten/);
  assert.throws(()=>db.prepare("INSERT INTO knowledge_verifications(id,tenant_id,source_id,decision,note,verified_by,verified_on,previous_expires_on,next_expires_on,created_at) VALUES('x','36t',?,'confirmed','تأكيد باسم غير المالك','manager',?,?,?,?)").run(id,riyadh(),riyadh(),riyadh(9),now()),/only the named owner/);
  assert.throws(()=>db.prepare('DELETE FROM knowledge_sources WHERE id=?').run(id),/never deleted/);
  // طلب التحديث لا يمدد شيئًا ويبقي المصدر موسومًا.
  tx(()=>sourceAction(db,users.hr,id,'request_update',{version:s.version,note:'تغير موعد الدوام في رمضان ويلزم تحديث النص'}));
  s=knowledgeBoard(db,users.manager).sources.find(x=>x.id===id);
  assert.equal(s.update_requested,true);assert.equal(s.expires_on,riyadh(180));assert.equal(s.warning,WARNINGS.update_requested);
  assert.ok(verifyAudit(db));
});

test('knowledge: an expired source is flagged in the assistant answer, never hidden or deleted, and the honesty board ranks the most-cited stale source first',t=>{
  const {db,users,tx,policyId,cite}=fixture(t);
  const id=tx(()=>register(db,users.manager,{review_interval_days:30})).id;
  // تأكيد قديم مسجل للمالك نفسه قبل أربعين يومًا، فانتهت صلاحيته قبل عشرة أيام.
  const s0=db.prepare('SELECT * FROM knowledge_sources WHERE id=?').get(id);
  db.prepare("INSERT INTO knowledge_verifications(id,tenant_id,source_id,decision,note,verified_by,verified_on,previous_expires_on,next_expires_on,created_at) VALUES(?,?,?,'confirmed','تأكيد تجريبي قديم للاختبار','hr',?,?,?,?)").run(randomUUID(),'36t',id,riyadh(-40),s0.expires_on,riyadh(-10),now());
  db.prepare('UPDATE knowledge_sources SET last_verified_on=?,last_verified_by=?,expires_on=?,version=version+1 WHERE id=?').run(riyadh(-40),'hr',riyadh(-10),id);
  cite();cite();cite();
  const [annotated]=annotateSources(db,users.employee,[{type:'hr_policy',id:policyId,title:'ساعات العمل التجريبية'}]);
  assert.equal(annotated.knowledge.state,'expired');assert.equal(annotated.id,policyId,'the source itself is still returned');
  const lines=knowledgeWarnings(db,users.employee,[{type:'hr_policy',id:policyId,title:'ساعات العمل التجريبية'}]);
  assert.equal(lines.length,1);assert.match(lines[0],/هذا المصدر تجاوز تاريخ مراجعته ولم يؤكده مالكه/);
  assert.deepEqual(knowledgeWarnings(db,users.employee,[{type:'report',id:'R01'}]),[],'sources outside the knowledge base are left alone');
  assert.equal(annotateSources(db,users.employee,[{type:'service',id:'HR-LETTER',title:'طلب خطاب'}])[0].knowledge.state,'unregistered');
  const honesty=knowledgeBoard(db,users.manager).honesty;
  assert.equal(honesty.live,1);assert.equal(honesty.verified,0);assert.equal(honesty.verified_percent,0);assert.equal(honesty.expired,1);
  assert.equal(honesty.cited_and_stale[0].id,id);assert.equal(honesty.cited_and_stale[0].citations,3,'several paragraphs of one policy in one answer count once');
  assert.ok(knowledgeBoard(db,users.hr).awaiting_me.some(a=>a.id===id),'an overdue review shows to its owner');
  // المالك يؤكده اليوم فيعود متحققًا، والنسبة تتحرك.
  tx(()=>sourceAction(db,users.hr,id,'verify_source',{version:s0.version+1,note:'راجعته اليوم وما زال صحيحًا'}));
  assert.equal(knowledgeBoard(db,users.manager).honesty.verified_percent,100);
  assert.deepEqual(knowledgeWarnings(db,users.employee,[{type:'hr_policy',id:policyId,title:'ساعات العمل التجريبية'}]),[]);
  assert.ok(verifyAudit(db));
});

test('knowledge: each role sees only what it may, and a tenant never reads or acts on another tenant’s sources',t=>{
  const {db,users,tx}=fixture(t);
  const id=tx(()=>register(db,users.manager)).id;
  assert.equal(knowledgeBoard(db,users.employee).sources.length,0);assert.equal(knowledgeBoard(db,users.employee).honesty,null);
  assert.equal(knowledgeBoard(db,users.hr).sources.length,1,'the owner sees what they own');
  assert.equal(knowledgeBoard(db,users.external).sources.length,0);
  assert.throws(()=>tx(()=>sourceAction(db,users.external,id,'verify_source',{version:1,note:'محاولة من كيان آخر'})),code('not_found'));
  assert.throws(()=>tx(()=>sourceAction(db,users.employee,id,'retire_source',{version:1,reason:'محاولة دون تصريح'})),code('not_found'));
  assert.throws(()=>sourceAction(db,users.hr,id,'verify_source',{version:1,note:'خارج معاملة قاعدة البيانات'}),code('transaction_required'));
  tx(()=>sourceAction(db,users.manager,id,'retire_source',{version:1,reason:'دُمجت في سياسة أشمل تجريبية'}));
  assert.throws(()=>tx(()=>sourceAction(db,users.hr,id,'verify_source',{version:2,note:'راجعته بعد سحبه'})),code('action_unavailable'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM knowledge_sources').get().n,1,'a retired source is kept');
  assert.ok(verifyAudit(db));
});
