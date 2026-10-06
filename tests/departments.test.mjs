import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { login } from '../app/auth.mjs';
import { createApp } from '../app/server.mjs';
import { departmentDirectory } from '../app/static/hr-design.mjs';
import { operationModules } from '../app/static/operations.mjs';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('الإدارات: بيانات الكيان وخدمات الإدارة وأزرار الطلب تظل مترابطة',async t=>{
 const db=openDb(':memory:');seed(db,'synthetic-directory-only');t.after(()=>db.close());
 const server=createApp(db);
 async function read(path,user){
  const auth=user?login(db,user,'synthetic-directory-only','directory-test'):null;
  const req={method:'GET',url:'/api'+path,headers:{host:'localhost',...(auth?{cookie:`session=${auth.token}`}:{})}};
  const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
  await server.listeners('request')[0](req,res);return res;
 }
 assert.equal((await read('/departments')).status,401);
 const departments=(await read('/departments','employee')).body;
 assert.equal(departments.length,4);assert.ok(!departments.some(d=>d.id==='other'));
 const external=(await read('/departments','external')).body;assert.deepEqual(external.map(d=>d.id),['other']);
 const services=(await read('/catalog','employee')).body,me={id:'employee',role:'employee',tenant_id:'36t',department_id:'creative'};
 const render=(selected='',overrides={})=>departmentDirectory({departments,services,me,modules:operationModules,selected,e,...overrides});
 const home=render();assert.equal((home.match(/class="department-card"/g)||[]).length,4);assert.match(home,/data-department-search=/);assert.match(home,/الإدارات وخدماتها/);assert.doesNotMatch(home,/href="#finance"/);
 const hr=render('hr'),service=services.find(s=>s.department_id==='hr');
 assert.match(hr,new RegExp(`data-id="${service.id}"`));assert.match(hr,/href="#leave"/);assert.match(hr,/href="#people"/);assert.doesNotMatch(hr,/IT-SUPPORT|CREATIVE-BRIEF/);
 assert.match(render('ops'),/لم تُهيأ خدمات طلب/);assert.match(render('other'),/الإدارة غير متاحة/);
 assert.doesNotMatch(render('hr',{me:{...me,role:'admin'}}),/data-action="new-request"|href="#people"/);
 assert.match(render('',{me:{...me,capabilities:{finance:true}}}),/href="#finance"/);
 const malicious=render('',{departments:[{id:'test',name:'<img src=x onerror=alert(1)>'}],services:[]});assert.doesNotMatch(malicious,/<img/);assert.match(malicious,/&lt;img/);
});
