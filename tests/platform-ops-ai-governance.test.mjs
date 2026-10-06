import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { ASSISTANTS } from '../app/ai.mjs';
import { aiGovernanceBoard, seedInventory, submitAssessment, decideAssessment, activateAsset, suspendAsset, assetGate } from '../app/ai-governance.mjs';

const code=value=>error=>error.code===value;
const TODAY='2026-09-20',plus=n=>new Date(Date.parse(TODAY+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-platform-ops');t.after(()=>db.close());
  const tx=f=>transaction(db,f);
  // حوكمة الذكاء الاصطناعي تصريح إداري؛ نضيف أدمنًا ثانيًا (تجريبي) يمنحه الأدمن الأول التصريح، وأدمنًا في الكيان المعزول.
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,admin_level) VALUES('governor','36t','ops','governor','مراجع الحوكمة التجريبي','x','admin','scoped'),('iso-admin','isolated','other','iso-admin','أدمن الكيان المعزول التجريبي','x','admin','super')").run();
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  tx(()=>grantAccess(db,users.admin,{user_id:'governor',capability:'ai.govern',note:'مراجعة تقييمات المساعدين — تجريبي'}));
  return {db,users,tx};
}
const assessment=(version,extra={})=>({version,owner_id:'manager',data_categories:['pasted_text','client_confidential'],data_leaves_kingdom:true,transfer_note:'يعالجه مزوّد خارجي خارج المملكة وفق عقده — تجريبي',risk_level:'medium',risk_notes:'نص البريف قد يحوي بيانات عميل سرية وأسماء أشخاص لا يكشفها الحجب.',mitigations:'حجب الأنماط، ومراجعة بشرية لكل ناتج.',...extra});
const assetOf=(db,key)=>db.prepare("SELECT * FROM ai_assets WHERE tenant_id='36t' AND assistant_key=?").get(key);

test('ai inventory: the initial list is a proposal derived from the code, and nothing runs before it is activated',t=>{
  const {db,users,tx}=fixture(t);
  assert.equal(assetGate(db,'36t','brief_gaps',TODAY).allowed,false,'not inventoried means not allowed');
  assert.throws(()=>tx(()=>seedInventory(db,users.manager)),code('not_permitted'));
  assert.equal(tx(()=>seedInventory(db,users.admin)).created,ASSISTANTS.length);
  assert.equal(tx(()=>seedInventory(db,users.admin)).created,0,'repeatable without duplicates');
  const board=aiGovernanceBoard(db,users.admin,TODAY);
  assert.ok(board.assets.every(a=>a.status==='proposed'&&a.owner_id===null&&a.data_leaves_kingdom===null));
  assert.equal(board.missing.length,0);
  assert.ok(!/score|confidence|ثقة/i.test(JSON.stringify(board.assets)),'no numeric trust score anywhere');
  const a=assetOf(db,'brief_gaps');
  assert.throws(()=>tx(()=>activateAsset(db,users.admin,a.id,{version:a.version,reason:'تفعيل قبل أي تقييم'},TODAY)),code('not_assessed'));
  assert.throws(()=>db.prepare("UPDATE ai_assets SET status='active',owner_id='manager',next_review_on='2027-01-01',approved_assessment_id='none',version=version+1 WHERE id=?").run(a.id),/approved risk assessment/);
  assert.throws(()=>aiGovernanceBoard(db,users.employee,TODAY),code('not_permitted'));
});

test('ai inventory: activation needs a named owner and a risk assessment approved by someone other than its author or the owner',t=>{
  const {db,users,tx}=fixture(t);
  tx(()=>seedInventory(db,users.admin));
  let a=assetOf(db,'brief_gaps');
  assert.throws(()=>tx(()=>submitAssessment(db,users.manager,a.id,assessment(a.version))),code('not_permitted'),'not yet the owner, not a governor');
  assert.throws(()=>tx(()=>submitAssessment(db,users.admin,a.id,assessment(a.version,{data_leaves_kingdom:undefined}))),code('data_leaves_kingdom'));
  assert.throws(()=>tx(()=>submitAssessment(db,users.admin,a.id,assessment(a.version,{transfer_note:''}))),code('invalid_text'),'data leaving the kingdom must say where and why');
  assert.throws(()=>tx(()=>submitAssessment(db,users.admin,a.id,assessment(a.version-1))),code('stale_version'));
  const {id}=tx(()=>submitAssessment(db,users.admin,a.id,assessment(a.version)));
  assert.throws(()=>tx(()=>decideAssessment(db,users.admin,id,{decision:'approve',note:'أعتمد تقييمي بنفسي',next_review_on:plus(90)},TODAY)),code('separation_of_duties'));
  assert.throws(()=>tx(()=>decideAssessment(db,users.manager,id,{decision:'approve',note:'المالك يعتمد لنفسه',next_review_on:plus(90)},TODAY)),code('not_permitted'));
  assert.throws(()=>db.prepare("UPDATE ai_asset_assessments SET status='approved',decided_by=prepared_by,decided_at='t' WHERE id=?").run(id),/CHECK/,'the database refuses self-approval too');
  assert.deepEqual(aiGovernanceBoard(db,users.governor,TODAY).awaiting_me.map(x=>x.id),[id]);
  tx(()=>decideAssessment(db,users.governor,id,{decision:'approve',note:'الضوابط كافية لمرحلة التجربة',next_review_on:plus(90)},TODAY));
  a=assetOf(db,'brief_gaps');assert.equal(a.status,'assessed');assert.equal(a.owner_id,'manager');
  assert.equal(assetGate(db,'36t','brief_gaps',TODAY).allowed,false,'assessed is not yet active');
  assert.throws(()=>db.prepare("UPDATE ai_asset_assessments SET risk_level='low' WHERE id=?").run(id),/replaced by a new revision/);
  tx(()=>activateAsset(db,users.admin,a.id,{version:a.version,reason:'بدء التجربة على الفريق الإبداعي'},TODAY));
  assert.deepEqual(assetGate(db,'36t','brief_gaps',TODAY),{allowed:true,status:'active',overdue:false,reason:'مُفعَّل بتقييم معتمد'});
  assert.equal(assetGate(db,'isolated','brief_gaps',TODAY).allowed,false,'another tenant has its own inventory');
  assert.ok(aiGovernanceBoard(db,users.admin,TODAY).alerts.some(x=>/تخرج من المملكة/.test(x)));
  assert.ok(verifyAudit(db));
});

test('ai inventory: the owner can suspend, an overdue review raises an alert and blocks reactivation, and a new assessment keeps the old one',t=>{
  const {db,users,tx}=fixture(t);
  tx(()=>seedInventory(db,users.admin));
  let a=assetOf(db,'policy_answer');
  const first=tx(()=>submitAssessment(db,users.admin,a.id,assessment(a.version,{data_categories:['hr_policies'],data_leaves_kingdom:false,transfer_note:'',risk_level:'low'})));
  tx(()=>decideAssessment(db,users.governor,first.id,{decision:'approve',note:'نصوص سياسات منشورة داخليًا فقط',next_review_on:plus(30)},TODAY));
  a=assetOf(db,'policy_answer');tx(()=>activateAsset(db,users.admin,a.id,{version:a.version,reason:'تفعيل بعد التقييم المعتمد'},TODAY));
  assert.ok(aiGovernanceBoard(db,users.admin,plus(31)).alerts.some(x=>/متأخرة/.test(x)));
  assert.equal(assetGate(db,'36t','policy_answer',plus(31)).overdue,true);
  assert.deepEqual(aiGovernanceBoard(db,users.manager,TODAY).assets.map(x=>x.assistant_key),['policy_answer'],'an owner sees only what they own');
  assert.throws(()=>tx(()=>suspendAsset(db,users.employee,a.id,{version:a.version+1,reason:'لست المالك ولا المراجع'})),code('not_permitted'));
  a=assetOf(db,'policy_answer');tx(()=>suspendAsset(db,users.manager,a.id,{version:a.version,reason:'إجابات تستشهد بسياسة ملغاة'}));
  assert.equal(assetGate(db,'36t','policy_answer',TODAY).allowed,false);
  a=assetOf(db,'policy_answer');
  assert.throws(()=>tx(()=>activateAsset(db,users.admin,a.id,{version:a.version,reason:'إعادة تفعيل بعد انتهاء المراجعة'},plus(31))),code('review_overdue'));
  const second=tx(()=>submitAssessment(db,users.manager,a.id,assessment(a.version,{data_categories:['hr_policies'],data_leaves_kingdom:false,transfer_note:'',risk_level:'low',owner_id:'manager'})));
  tx(()=>decideAssessment(db,users.admin,second.id,{decision:'approve',note:'أُصلح مصدر السياسات الملغاة',next_review_on:plus(120)},plus(31)));
  a=assetOf(db,'policy_answer');tx(()=>activateAsset(db,users.admin,a.id,{version:a.version,reason:'إعادة التفعيل بعد التقييم الجديد'},plus(31)));
  assert.deepEqual(db.prepare('SELECT revision,status FROM ai_asset_assessments WHERE asset_id=? ORDER BY revision').all(a.id).map(r=>[r.revision,r.status]),[[1,'approved'],[2,'approved']]);
  assert.throws(()=>db.prepare('DELETE FROM ai_asset_assessments').run(),/retained/);
  assert.equal(aiGovernanceBoard(db,users['iso-admin'],TODAY).assets.length,0,'another tenant does not see this inventory');
  assert.throws(()=>tx(()=>suspendAsset(db,users['iso-admin'],a.id,{version:a.version+1,reason:'محاولة عبر الكيانات'})),code('not_found'));
  assert.ok(verifyAudit(db));
});
