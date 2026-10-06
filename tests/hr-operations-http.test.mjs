import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';

async function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-hcm-http');
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT 'hr-head-http','36t','hr','hr-head-http','مدير رأس المال البشري المصطنع',password_hash,'manager',NULL FROM users WHERE id='hr'").run();
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) SELECT 'hr-operator-http','36t','hr','hr-operator-http','موظف موارد بشرية مصطنع',password_hash,'employee','hr-head-http' FROM users WHERE id='hr'").run();
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=async username=>{const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'synthetic-hcm-http'})});assert.equal(response.status,200);const body=await response.json();return {cookie:response.headers.get('set-cookie').split(';')[0],csrf:body.csrf};};
  const sessions={hr:await login('hr'),employee:await login('employee'),head:await login('hr-head-http'),operator:await login('hr-operator-http')};
  const call=async(who,path,input,expected=200)=>{const response=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',cookie:sessions[who].cookie,'x-csrf-token':sessions[who].csrf,'Idempotency-Key':randomUUID()},...(input===undefined?{}:{body:JSON.stringify(input)})});const body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));return body;};
  return {base,call};
}

test('مركز عمليات الموارد البشرية وخدمته الثابتة يعملان عبر الخادم المحلي',async t=>{
  const {base,call}=await fixture(t);
  const asset=await fetch(base+'/hr-operations-ui.mjs');assert.equal(asset.status,200);assert.match(await asset.text(),/مركز عمليات الموارد البشرية/);
  const hr=await call('hr','/hr/operations');assert.equal(hr.sections.length,8);assert.ok(hr.permissions.includes('hr.operations.use'));
  const employee=await call('employee','/hr/operations');assert.equal(employee.sections.length,0);
  const created=await call('hr','/hr/competencies',{code:'SERVICE-DESIGN',name:'تصميم الخدمة',category:'تشغيلية',description:'تحويل رحلة الموظف إلى خدمة واضحة قابلة للقياس',levels:['يفهم الرحلة ومصطلحاتها الأساسية','يرسم رحلة محدودة بإشراف','يصمم خدمة مستقلة مع معيار نجاح','يقود تصميم خدمات مترابطة بين الإدارات','يضع منهج الشركة ويطور الممارسين']},201);
  assert.match(created.id,/^[a-f0-9-]{36}$/);
  assert.ok((await call('hr','/hr/operations')).competencies.some(row=>row.id===created.id));
});

test('مدير رأس المال البشري يحفظ صلاحيات موظفه عبر واجهة الخادم فقط',async t=>{
  const {call}=await fixture(t);
  const board=await call('head','/hr/operations');
  assert.equal(board.hcm_coverage.total,51);
  assert.equal(board.team_access.can_manage,true);
  const changed=await call('head','/hr/team-access',{user_id:'hr-operator-http',mode:'custom',capability_keys:['hr.operations.use','hr.compensation.review'],note:'تكليف واضح لمراجعة التعويضات وتشغيل مركز الموارد البشرية'},201);
  assert.deepEqual(new Set(changed.added),new Set(['hr.operations.use','hr.compensation.review']));
});
