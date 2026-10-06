import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { catalog } from '../app/workflow.mjs';
import { portal } from '../app/routing.mjs';
import { portalPage } from '../app/static/portal-ui.mjs';
import { parseDeepLink } from '../app/static/deep-links.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,character=>`&#${character.charCodeAt(0)};`);

test('بوابة الموظف تحمل كل خدمة يحق للحساب طلبها، بلا نسخة يدوية ناقصة',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-employee-portal');t.after(()=>db.close());
  for(const user of db.prepare("SELECT * FROM users WHERE id IN ('employee','manager','hr') ORDER BY id").all()){
    const allowed=catalog(db,user),data=portal(db,user,{requests:[],projects:[],leave:null});
    assert.deepEqual(data.all_services.map(service=>service.code).sort(),allowed.map(service=>service.code).sort(),user.id);
    assert.equal(data.catalog_size,data.all_services.length,user.id);
    assert.ok(data.all_services.every(service=>service.department_name&&service.section),user.id);
  }
});

test('بوابة الموظف تعرض خدمات الموارد البشرية أولًا وتفتحها بمسار الطلب الموحد',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-employee-portal-ui');installServiceCatalog(db);t.after(()=>db.close());
  const employee=db.prepare("SELECT * FROM users WHERE id='employee'").get();
  const data=portal(db,employee,{requests:[],projects:[],leave:null});
  const html=portalPage(data,{e:esc,date:String});
  const hr=data.all_services.filter(service=>service.department_id==='hr');
  assert.ok(hr.length>=1,'تصل خدمات الموارد البشرية من الدليل الفعلي');
  assert.match(html,/كل خدماتك المسموحة/);
  assert.match(html,/طلبات الموارد البشرية/);
  assert.match(html,/طلباتك بدون لف ودوران/);
  assert.match(html,/اسأل تركي/);
  assert.match(html,/راتبك ورصيد إجازاتك/);
  assert.match(html,/#policy-assistant\/ask/);
  assert.match(html,/بياناتك أنت بس/);
  assert.match(html,/id="portal-service-search"/);
  for(const service of hr)assert.match(html,new RegExp(`data-action="new-request" data-id="${service.id}"`),service.code);
  assert.deepEqual(data.employee_requests.map(request=>request.key),[
    'leave','attendance','overtime','travel','salary_letter','advance','profile','training','benefits','hr_contact','confidential_feedback','suggestion'
  ]);
  const confidential=data.employee_requests.find(request=>request.key==='confidential_feedback');
  assert.equal(confidential.href,'#hr-cases/anonymous');
  assert.equal(parseDeepLink(confidential.href).operation,'submit_anonymous');
  assert.equal(confidential.service_id,undefined,'البلاغ المجهول يفتح وحدته المحمية ولا يتحول إلى طلب عادي');
  assert.match(html,/ما ينربط بحسابك/);
  for(const request of data.employee_requests.filter(request=>request.service_id)){
    assert.ok(data.all_services.some(service=>service.id===request.service_id),request.code);
    assert.match(html,new RegExp(`data-employee-request="${request.key}"`));
  }
  assert.doesNotMatch(html,/اختر موظف|selectedEmployeeId/,'الموظف يرفع الطلب لنفسه ولا يختار سجل شخص آخر');
});

test('مسار بوابة الموظف مستقل، ولا يعاد توجيهه إلى الرئيسية',()=>{
  const source=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  assert.match(source,/import \{ portalPage \} from '\.\/portal-ui\.mjs'/);
  assert.doesNotMatch(source,/portal:\(\)=>\(\{route:'home'\}\)/);
  assert.match(source,/view==='portal'/);
  assert.match(source,/api\('\/portal'\)/);
});
