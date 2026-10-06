import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { LEAVE_EXPERIENCE, leaveExperienceOf, orderLeaveTypes } from '../app/leave-types.mjs';
import { portal } from '../app/routing.mjs';
import { leaveUI } from '../app/static/leave-ui.mjs';
import { portalPage } from '../app/static/portal-ui.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,character=>`&#${character.charCodeAt(0)};`);

test('تجربة الإجازات تحفظ ترتيب HCM ولونًا ثابتًا لكل نوع وتضيف التعويضية',()=>{
  const ordered=orderLeaveTypes([
    {code:'unpaid'},{code:'compensatory'},{code:'iddah'},{code:'exam'},{code:'death_sibling'},
    {code:'death_close'},{code:'marriage'},{code:'hajj'},{code:'birth'},{code:'maternity'},
    {code:'sick'},{code:'annual'}
  ]);
  assert.deepEqual(ordered.map(type=>type.code),[
    'annual','sick','maternity','birth','hajj','marriage','death_close','death_sibling','exam','iddah','compensatory','unpaid'
  ]);
  assert.equal(leaveExperienceOf('birth').hcm_family,'paternity');
  assert.equal(leaveExperienceOf('exam').hcm_family,'study');
  assert.equal(leaveExperienceOf('death_sibling').hcm_family,'bereavement');
  assert.equal(leaveExperienceOf('compensatory').source_link,'#attendance/overtime');
  assert.ok(Object.values(LEAVE_EXPERIENCE).every(item=>/^#[0-9A-F]{6}$/i.test(item.color)));
  assert.equal(new Set(Object.values(LEAVE_EXPERIENCE).map(item=>item.color)).size,Object.keys(LEAVE_EXPERIENCE).length,'كل نوع له لون مخصص');
});

test('نموذج الطلب يرتب الأنواع مثل HCM ويحتفظ بالأنواع النظامية الإضافية',()=>{
  const types=['unpaid','compensatory','iddah','exam','death_sibling','death_close','marriage','hajj','birth','maternity','sick','annual']
    .map(code=>({code,name_ar:code,unit_name:'يوم',experience:leaveExperienceOf(code),variants:[],documents:[]}));
  const spec=leaveUI.form('request','new',{operational_date:'2026-10-04',statutory:{ready:true,types}});
  const options=spec.fields.find(field=>field.name==='leave_type').options;
  assert.deepEqual(options.map(option=>option.value),['annual','sick','maternity','birth','hajj','marriage','death_close','death_sibling','exam','iddah','compensatory','unpaid']);
  assert.match(spec.fields.find(field=>field.name==='reason').hint,/يساعد المعتمد/);
});

test('بوابة الموظف تقرأ الرصيد النظامي والتعويضي من وحدة الإجازات وتعرض مداخل HCM',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-hcm-leave-portal');installServiceCatalog(db);t.after(()=>db.close());
  const employee=db.prepare("SELECT * FROM users WHERE id='employee'").get();
  const leave={
    statutory:{ready:true,balances:[
      {code:'annual',name_ar:'الإجازة السنوية',available_days:'18',reserved_days:'2',unit_name:'يوم',experience:leaveExperienceOf('annual')},
      {code:'compensatory',name_ar:'الإجازة التعويضية عن العمل الإضافي',available_days:'1.5',reserved_days:'0',unit_name:'يوم',experience:leaveExperienceOf('compensatory'),compensatory:{available_hours:'12',available_days:'1.5',next_expiry:'2026-11-30'}}
    ]},
    balances:[{employee_id:'employee',leave_type:'annual',leave_type_name:'قديم',available_days:99,balance_year:2026}]
  };
  const data=portal(db,employee,{requests:[],projects:[],leave});
  assert.deepEqual(data.leave.map(balance=>balance.type_code),['annual','compensatory']);
  assert.equal(data.leave[0].remaining,'18');
  assert.equal(data.leave[1].available_hours,'12');
  assert.equal(data.leave[1].source_link,'#attendance/overtime');
  assert.ok(data.employee_portal.some(item=>item.key==='leave'&&item.href==='#leave'));
  assert.ok(data.employee_portal.some(item=>item.key==='attendance'&&item.href==='#attendance'));
  assert.ok(data.employee_portal.some(item=>item.key==='letters'&&item.href==='#letters'));
  assert.ok(data.employee_portal.some(item=>item.key==='requests'&&item.href==='#my-requests'));
  assert.equal(data.employee_requests[0].key,'leave');
  assert.equal(data.employee_requests[0].href,'#leave/new');
  assert.ok(data.employee_requests.some(item=>item.code==='HR-SALARY-CERT'));
  assert.ok(data.employee_requests.some(item=>item.code==='HR-ATTENDANCE-FIX'));

  const html=portalPage(data,{e:esc,date:String});
  assert.match(html,/بوابة الموظف/);
  assert.match(html,/employee-portal-dock/);
  assert.match(html,/leave-balance-card/);
  assert.match(html,/الإجازة التعويضية عن العمل الإضافي/);
  assert.match(html,/#attendance\/overtime/);
  assert.match(html,/طلباتك بدون لف ودوران/);
  assert.match(html,/data-employee-request="leave"/);
});
