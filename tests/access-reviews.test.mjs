import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, audit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess, can } from '../app/access.mjs';
import { accessReviewBoard, openCampaign, decideItem, closeCampaign, revocationAction } from '../app/access-reviews.mjs';

const code=value=>error=>error.code===value;
const riyadh=(offset=0)=>new Date(Date.now()+3*3600000+offset*86400000).toISOString().slice(0,10);
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-knowledge-access');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const grant=(user_id,capability)=>tx(()=>grantAccess(db,users.admin,{user_id,capability,note:'منح تجريبي'}));
  grant('employee','vendors.manage');grant('employee','bank.reconcile');grant('manager','vendors.bank');
  // أثر استعمال تجريبي: الموظفة كتبت في سجل مورد، ولم تلمس المطابقة البنكية.
  tx(()=>audit(db,users.employee,'vendor','synthetic-vendor','vendor.synthetic_touch'));
  const open=()=>tx(()=>openCampaign(db,users.admin,{title:'مراجعة الربع التجريبية',usage_since:riyadh(-90),due_on:riyadh(14),top_reviewer_id:'manager',second_reviewer_id:'hr'})).id;
  const items=(u,campaignId)=>accessReviewBoard(db,u).campaigns.find(c=>c.id===campaignId).items;
  return {db,users,tx,open,items};
}

test('access review: each manager reviews those under them, sensitive and unused permissions come first, and no one reviews their own',t=>{
  const {db,users,tx,open,items}=fixture(t);
  assert.throws(()=>tx(()=>openCampaign(db,users.manager,{title:'حملة من غير المسؤول',usage_since:riyadh(-30),due_on:riyadh(7)})),code('not_permitted'));
  assert.throws(()=>tx(()=>openCampaign(db,users.admin,{title:'حملة بلا مراجع أعلى',usage_since:riyadh(-30),due_on:riyadh(7)})),code('reviewer_required'));
  const id=open();
  assert.throws(()=>open(),code('campaign_open'));
  const mine=items(users.manager,id);
  assert.ok(mine.every(i=>i.reviewer_id==='manager'&&i.subject_id!=='manager'));
  const employee=mine.filter(i=>i.subject_id==='employee');
  assert.deepEqual(employee.map(i=>[i.capability,i.usage_state,i.sensitive]),[['bank.reconcile','unused',true],['vendors.manage','used',false]],'the sensitive unused permission is shown first');
  assert.ok(mine.some(i=>i.subject_id==='admin'&&i.source==='admin_level'),'the super admin’s full access is reviewed too');
  assert.ok(mine.some(i=>i.subject_id==='hr'&&i.source==='role'&&i.sensitive),'sensitive permissions that come with a role are reviewed');
  const own=items(users.hr,id).find(i=>i.subject_id==='manager');
  assert.ok(own,'the manager’s own permission goes to the reviewer above them');
  assert.throws(()=>tx(()=>decideItem(db,users.manager,own.id,{version:own.version,decision:'keep',reason:'أحتاجه لعملي اليومي'})),code('separation_of_duties'));
  assert.throws(()=>tx(()=>decideItem(db,users.outsider,employee[0].id,{version:1,decision:'keep',reason:'لست المراجع المسمى'})),code('not_found'));
  // القيد في قاعدة البيانات نفسها: لا بند يراجع فيه أحد نفسه.
  assert.throws(()=>db.prepare("INSERT INTO access_review_items(id,tenant_id,campaign_id,subject_id,reviewer_id,capability,capability_name,source,sensitive) VALUES('x','36t',?,'manager','manager','vendors.view','x','role',0)").run(id),/CHECK constraint/);
  // الإبقاء على الحساس يحتاج سببًا مكتوبًا، وغير الحساس لا يحتاجه.
  const [sensitive,plain]=employee;
  assert.throws(()=>tx(()=>decideItem(db,users.manager,sensitive.id,{version:sensitive.version,decision:'keep'})),code('invalid_text'));
  assert.throws(()=>tx(()=>decideItem(db,users.manager,plain.id,{version:plain.version+1,decision:'keep'})),code('stale_version'));
  tx(()=>decideItem(db,users.manager,plain.id,{version:plain.version,decision:'keep'}));
  assert.throws(()=>tx(()=>decideItem(db,users.manager,plain.id,{version:plain.version+1,decision:'revoke',reason:'تغيير الرأي بعد القرار'})),code('action_unavailable'));
  assert.ok(accessReviewBoard(db,users.manager).awaiting_me.some(a=>a.id==='employee'),'what remains waits in the manager’s inbox');
  assert.ok(verifyAudit(db));
});

test('access review: revoking creates a request a human with access.manage executes — the platform never revokes by itself',t=>{
  const {db,users,tx,open,items}=fixture(t);
  const id=open(),bank=items(users.manager,id).find(i=>i.subject_id==='employee'&&i.capability==='bank.reconcile');
  const result=tx(()=>decideItem(db,users.manager,bank.id,{version:bank.version,decision:'revoke',reason:'لم تستعمله منذ تسعين يومًا ولا تحتاجه'}));
  assert.ok(can(db,users.employee,'bank.reconcile'),'still granted: nothing is revoked automatically');
  const request=accessReviewBoard(db,users.admin).revocation_requests.find(r=>r.id===result.revocation_request_id);
  assert.equal(request.status,'open');assert.deepEqual(request.actions,['execute_revocation','decline_revocation']);
  assert.ok(accessReviewBoard(db,users.admin).awaiting_me.some(a=>a.id===request.id),'the executor is told a request waits');
  assert.throws(()=>tx(()=>revocationAction(db,users.manager,request.id,'execute_revocation',{version:1,note:'تنفيذ من غير المخول'})),code('not_permitted'));
  tx(()=>revocationAction(db,users.admin,request.id,'execute_revocation',{version:1,note:'سحبت المنح بعد التأكد مع مديرها'}));
  assert.equal(can(db,users.employee,'bank.reconcile'),false);
  assert.throws(()=>tx(()=>revocationAction(db,users.admin,request.id,'decline_revocation',{version:2,note:'محاولة حسم ثانٍ للطلب'})),code('action_unavailable'));
  // طلب سحب صلاحية الأدمن الأول لا ينفذه صاحبها.
  const adminItem=items(users.manager,id).find(i=>i.subject_id==='admin');
  const adminRequest=tx(()=>decideItem(db,users.manager,adminItem.id,{version:adminItem.version,decision:'revoke',reason:'يكفي أدمن محدد لهذه المرحلة التجريبية'})).revocation_request_id;
  assert.throws(()=>tx(()=>revocationAction(db,users.admin,adminRequest,'execute_revocation',{version:1,note:'أنفذ سحب صلاحيتي بنفسي'})),code('separation_of_duties'));
  assert.ok(verifyAudit(db));
});

test('access review: a closed campaign is dated evidence — who reviewed what, when, with which decision — and cannot be edited',t=>{
  const {db,users,tx,open,items}=fixture(t);
  const id=open(),plain=items(users.manager,id).find(i=>i.capability==='vendors.manage');
  tx(()=>decideItem(db,users.manager,plain.id,{version:plain.version,decision:'keep'}));
  let campaign=accessReviewBoard(db,users.admin).campaigns.find(c=>c.id===id);
  assert.throws(()=>tx(()=>closeCampaign(db,users.admin,id,{version:campaign.version,note:'إغلاق الحملة التجريبية'})),code('review_incomplete'));
  assert.throws(()=>tx(()=>closeCampaign(db,users.manager,id,{version:campaign.version,note:'إغلاق من غير المسؤول',accept_incomplete:true})),code('not_permitted'));
  const closed=tx(()=>closeCampaign(db,users.admin,id,{version:campaign.version,note:'إغلاق الحملة التجريبية مع الإقرار بالنقص',accept_incomplete:true}));
  assert.equal(closed.left_undecided,campaign.totals.undecided);
  campaign=accessReviewBoard(db,users.admin).campaigns.find(c=>c.id===id);
  const kept=campaign.items.find(i=>i.id===plain.id);
  assert.equal(kept.decision,'keep');assert.equal(kept.decided_by,'manager');assert.ok(kept.decided_at);assert.equal(kept.usage_state,'used');
  assert.ok(campaign.items.filter(i=>!i.decision).every(i=>i.usage_state),'undecided items keep their usage snapshot as of closing');
  const other=campaign.items.find(i=>!i.decision&&i.reviewer_id==='manager');
  assert.throws(()=>tx(()=>decideItem(db,users.manager,other.id,{version:other.version,decision:'keep',reason:'قرار بعد الإغلاق'})),code('action_unavailable'));
  assert.throws(()=>db.prepare("UPDATE access_review_items SET decision='revoke',reason='تعديل صامت بعد الإغلاق',decided_by=reviewer_id,decided_at='x',version=version+1 WHERE id=?").run(other.id),/after the campaign closes/);
  assert.throws(()=>db.prepare("UPDATE access_review_campaigns SET due_on='2099-01-01',version=version+1 WHERE id=?").run(id),/never edited/);
  assert.throws(()=>db.prepare('DELETE FROM access_review_items').run(),/retained/);
  // عزل الكيان: موظف كيان آخر لا يرى الحملة ولا يقرر فيها.
  assert.equal(accessReviewBoard(db,users.external).campaigns.length,0);
  assert.throws(()=>tx(()=>decideItem(db,users.external,other.id,{version:other.version,decision:'keep',reason:'من كيان آخر'})),code('not_found'));
  assert.ok(verifyAudit(db));
});
