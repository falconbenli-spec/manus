import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { openDb,transaction,verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import * as wf from '../app/workflow.mjs';
import { recordFeedback,feedbackView } from '../app/service-feedback.mjs';
import { createApp } from '../app/server.mjs';
import { grantAccess } from '../app/access.mjs';
import { benchmarkPage,feedbackPanel } from '../app/static/service-quality-ui.mjs';
import { companyDepartments,catalogServices } from '../app/service-catalog.mjs';

const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
function setup(t){
 const db=openDb(':memory:');seed(db,'synthetic-quality-only');t.after(()=>db.close());
 const employee=user(db,'employee');
 const s=wf.catalog(db,employee).find(s=>s.code==='IT-SUPPORT');
 let r=transaction(db,()=>wf.createRequest(db,employee,{service_id:s.id,title:'طلب فحص الجودة',payload:{issue:'تعطل الجهاز',impact:'يمنع العمل'}}));
 const move=(id,action)=>r=transaction(db,()=>wf.transition(db,user(db,id),r.id,action,{version:r.version,note:'دليل فحص مصطنع'}));
 return {db,employee,get request(){return r;},finish(){move('employee','submit');move('manager','approve');move('it','claim');move('it','complete');return r;}};
}
test('جودة الخدمة: تقييم صاحب الطلب بعد الإغلاق فقط مع منع التكرار وتزوير النسخة',t=>{
 const f=setup(t),{db,employee}=f;
 const post=(u,input)=>transaction(db,()=>recordFeedback(db,u,f.request.id,input));
 assert.throws(()=>post(employee,{version:f.request.version,rating:5,comment:''}),{code:'not_completed'});
 const r=f.finish();
 for(const id of ['manager','it','outsider','external'])assert.throws(()=>post(user(db,id),{version:r.version,rating:5,comment:''}));
 assert.throws(()=>post(employee,{version:r.version-1,rating:5,comment:''}),{code:'version_conflict'});
 for(const rating of [0,6,1.5,'5'])assert.throws(()=>post(employee,{version:r.version,rating,comment:'تعليق'}),{code:'invalid_rating'});
 assert.throws(()=>post(employee,{version:r.version,rating:1,comment:''}),{code:'invalid_text'});
 assert.throws(()=>post(employee,{version:r.version,rating:4,requester_id:'outsider'}),{code:'invalid_fields'});
 const input={version:r.version,rating:2,comment:'تأخر إصلاح الجهاز'};
 assert.equal(post(employee,input).feedback.rating,2);
 assert.equal(post(employee,input).feedback.rating,2);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM request_feedback').get().n,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='service.feedback_recorded'").get().n,1);
 assert.throws(()=>post(employee,{...input,rating:5}),{code:'already_rated'});
 assert.equal(feedbackView(db,user(db,'it'),r.id).feedback,null);
 assert.throws(()=>db.prepare('UPDATE request_feedback SET rating=5').run(),/feedback_immutable/);
 assert.equal(verifyAudit(db),true);
 db.prepare("UPDATE users SET active=0 WHERE id='employee'").run();
 assert.throws(()=>post(employee,input),{code:'inactive'});
});

test('البحث: تغطية كل إدارة وكل رمز خدمة مع مصادر ومعايير قبول دون ادعاء اكتمال',()=>{
 const d=JSON.parse(readFileSync('docs/research/department-benchmark.json','utf8'));
 assert.deepEqual(d.departments.map(x=>x.id),companyDepartments.map(x=>x.id));
 const services=d.departments.flatMap(x=>x.services);
 const expected=[...catalogServices.map(x=>x.code),'HR-LETTER','IT-SUPPORT','CREATIVE-BRIEF'].sort();
 assert.deepEqual(services.map(x=>x.code).sort(),expected);
 for(const department of d.departments){
  assert.ok(department.capabilities.length>=3);
  for(const c of department.capabilities){assert.ok(c.acceptance);assert.notEqual(c.status,'مكتمل');}
  for(const id of department.source_ids)assert.ok(d.sources[id].url.startsWith('https://'));
 }
 const e=s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const html=benchmarkPage(d,{e});assert.match(html,/رأس المال البشري/);assert.match(html,/142 خدمة/);
 const feedback=feedbackPanel({feedback:{feedback:{rating:5,comment:'<script>alert(1)</script>'}}},{e});
 assert.doesNotMatch(feedback,/<script>/);assert.match(feedback,/&lt;script&gt;/);
});

test('جودة الخدمة عبر HTTP: حماية الجلسة وCSRF وإتاحة التقييم في تفاصيل الطلب',async t=>{
 const f=setup(t),r=f.finish(),server=createApp(f.db);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/api/service-benchmark')).status,401);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'employee',password:'synthetic-quality-only'})});
 const auth=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
 const headers={'Content-Type':'application/json',cookie};
 // B12: أبحاث تطوير الخدمات صفحة داخلية بتصريح requirements.view، لا لكل موظف افتراضيًا؛ المنح الصريح يفتحها.
 assert.equal((await fetch(base+'/api/service-benchmark',{headers})).status,403);
 transaction(f.db,()=>grantAccess(f.db,user(f.db,'admin'),{user_id:'employee',capability:'requirements.view',note:'منح صريح تجريبي لاختبار الصفحة'}));
 assert.equal((await fetch(base+'/api/service-benchmark',{headers})).status,200);
 const url=base+`/api/requests/${r.id}/feedback`,body=JSON.stringify({version:r.version,rating:5,comment:'خدمة مكتملة'});
 assert.equal((await fetch(url,{method:'POST',headers,body})).status,403);
 const response=await fetch(url,{method:'POST',headers:{...headers,'x-csrf-token':auth.csrf},body});
 assert.equal(response.status,201);const result=await response.json();
 assert.equal(result.feedback.feedback.rating,5);assert.equal(result.feedback.can_rate,false);
});
