import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { seedVendorsDemo } from '../scripts/seed-vendors-demo.mjs';
import { seedHrDemo } from '../scripts/seed-hr-demo.mjs';
import { seedPayrollDemo } from '../scripts/seed-payroll-demo.mjs';
import { seedOperationsDemo } from '../scripts/seed-operations-demo.mjs';
import { operationModules, operationFields, money } from '../app/static/operations.mjs';
// م0 «السور»: الشاشات المرحَّلة إلى العدّة تأخذ tile من ui، فيمررها الاختبار كما تمررها app.mjs في موضعها الواحد.
import { kit } from '../app/static/kit.mjs';
import { dispatch } from './definitions-fixture.mjs';

// كل شاشة تشغيلية تُحمَّل من الخادم الحقيقي لكل دور، وتُرسم، ويُفتح نموذج كل زر ظهر فيها.
// يلتقط هذا ما لا تلتقطه اختبارات الخلفية: حقل مفقود في الحمولة، أو نموذج يرمي خطأ عند فتحه.
const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
test('every operational screen renders for every seeded role and every offered button opens a valid form',async t=>{
  const db=openDb(':memory:');seed(db,'synthetic-ui-render');seedVendorsDemo(db);seedHrDemo(db);seedPayrollDemo(db);seedOperationsDemo(db);
  // بلا listen: معالج الطلبات الحقيقي يُستدعى داخل العملية (tests/definitions-fixture.mjs dispatch)، فالجلسة والتفويض
  // يجريان كما في الشبكة ويمر الاختبار في بيئة معزولة تمنع فتح منفذ — وكان لا يُشغَّل فيها أصلًا.
  const app=createApp(db);
  t.after(()=>db.close());
  const problems=[];let rendered=0,forms=0;
  for(const username of ['employee','manager','hr','admin','it']){
    const login=await dispatch(app,{method:'POST',path:'/api/login',body:{username,password:'synthetic-ui-render'}});
    assert.equal(login.status,200,username);
    const cookie=login.headers['Set-Cookie'].split(';')[0];
    const api=async path=>{const response=await dispatch(app,{path:'/api'+path,headers:{cookie}});const body=response.json();if(response.status>=400)throw Object.assign(Error(body.error?.code??String(response.status)),{status:response.status});return body;};
    for(const [key,module] of Object.entries(operationModules)){
      let data;
      try{data=await module.load(api);}catch(error){if([403,404].includes(error.status))continue;problems.push(`${username}/${key}: load ${error.message}`);continue;}
      const buttons=[],button=(action,id,label)=>{buttons.push([action,id]);return `<button>${e(label)}</button>`;};
      let html;
      try{html=module.render(data,{e,button,money,ui:kit(e)});}catch(error){problems.push(`${username}/${key}: render ${error.message}`);continue;}
      rendered++;
      const text=html.replace(/<[^>]+>/g,' ');
      if(/\bundefined\b|\bNaN\b|\[object /.test(text))problems.push(`${username}/${key}: rendered text contains ${text.match(/\bundefined\b|\bNaN\b|\[object /)[0]}`);
      for(const [action,id] of buttons){
        try{
          const spec=module.form(action,id,data);forms++;
          if(!spec||typeof spec.title!=='string'||!Array.isArray(spec.fields)||typeof spec.toPayload!=='function'||(!spec.endpoint&&!spec.dynamicEndpoint))problems.push(`${username}/${key}/${action}: incomplete form spec`);
          else if(/\bundefined\b/.test(spec.title+operationFields(spec.fields,e).replace(/<[^>]+>/g,' ')))problems.push(`${username}/${key}/${action}: form shows undefined`);
        }catch(error){problems.push(`${username}/${key}/${action}: form ${error.message}`);}
      }
    }
  }
  assert.deepEqual(problems,[]);
  assert.ok(rendered>60&&forms>120,`rendered ${rendered} screens and opened ${forms} forms`);
});
