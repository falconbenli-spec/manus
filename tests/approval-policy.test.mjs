import test from 'node:test';
import assert from 'node:assert/strict';
import * as wf from '../app/workflow.mjs';

test('PLT-04 regression: the workflow exposes an authorized manual escalation operation',()=>{
  assert.equal(typeof wf.escalateApproval,'function');
});

import {openDb,transaction,verifyAudit} from '../app/db.mjs';
import {seed} from '../scripts/seed.mjs';
function fixture(t){
 const db=openDb(':memory:');seed(db,'synthetic-followup-test');t.after(()=>db.close());
 const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
 let r=transaction(db,()=>wf.createRequest(db,users.employee,{service_id:wf.catalog(db,users.employee).find(s=>s.code==='HR-LETTER').id,title:'اختبار متابعة',payload:{purpose:'متابعة مصطنعة',recipient:'جهة اختبار'}}));
 r=transaction(db,()=>wf.transition(db,users.employee,r.id,'submit',{version:r.version}));
 const follow=(who,request=r)=>transaction(db,()=>wf.escalateApproval(db,users[who],request.id,{version:request.version,note:'تأخر الرد على الخطوة'}));
 const later=()=>t.mock.method(Date,'now',()=>Date.parse(r.versions[0].created_at)+86400001);
 return {db,users,r,follow,later};
}
test('PLT-04: متابعة مؤرخة مرة واحدة لا تغير المعتمد ولا تقفز إلى الخطوة التالية',t=>{
 const {db,r,follow,later}=fixture(t);assert.throws(()=>follow('employee'),{code:'escalation_unavailable'});later();
 const after=follow('employee');assert.equal(after.status,'pending');assert.equal(after.followups.length,1);assert.equal(after.followups[0].recipient_id,'manager');assert.equal(after.approvals[0].approver_id,r.approvals[0].approver_id);
 assert.throws(()=>follow('employee',after),{code:'escalation_unavailable'});assert.throws(()=>follow('employee'),{code:'stale_version'});
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='approval_escalated'").get().n,1);assert.ok(verifyAudit(db));
});
test('PLT-04: سحب صلاحية المعتمد أو حسم الطلب يمنع المتابعة',t=>{
 const {db,users,r,follow,later}=fixture(t);later();assert.throws(()=>follow('outsider'),{code:'not_found'});
 db.exec("UPDATE users SET active=0 WHERE id='manager'");assert.throws(()=>follow('employee'),{code:'escalation_unavailable'});
 db.exec("UPDATE users SET active=1 WHERE id='manager'");const cancelled=transaction(db,()=>wf.transition(db,users.employee,r.id,'cancel',{version:r.version,note:'إنهاء الاختبار'}));
 assert.throws(()=>follow('employee',cancelled),{code:'escalation_unavailable'});assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_followups').get().n,0);
});
