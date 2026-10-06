import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDb,verifyAudit } from '../app/db.mjs';
import { approveVendors } from './vendor-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { expandDemo,expandPeopleDemo,expandFinanceDemo } from '../scripts/expand-demo.mjs';
import { createApp } from '../app/server.mjs';
// منذ الترحيل 182: الصفقة من ملف عميل، والعرض على عرض سعر العميل المقبول، والقبول يسمّي ممثل العميل المفوّض.
import { clientFileFor, boundQuote } from './proposal-fixture.mjs';

const riyadhDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

async function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-http-operations');expandDemo(db,2026);expandPeopleDemo(db,2026);expandFinanceDemo(db,2026);
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`,sessions={};
  for(const username of ['employee','manager','hr','deputy','admin','outsider','external','finance-preparer','finance-approver']){
    const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'synthetic-http-operations'})});
    assert.equal(response.status,200);const body=await response.json();sessions[username]={cookie:response.headers.get('set-cookie').split(';')[0],csrf:body.csrf};
  }
  const call=async(who,path,input,expected=200,key=randomUUID(),csrf=true)=>{
    const auth=sessions[who];const response=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(auth?{cookie:auth.cookie,...(csrf?{'x-csrf-token':auth.csrf}:{})}:{}),'Idempotency-Key':key},...(input===undefined?{}:{body:JSON.stringify(input)})});
    const body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));return body;
  };
  return {db,call};
}
test('WF-01/02/05 HTTP: a scoped commercial project funds a purchase that reaches an unpaid matched reference',async t=>{
  const {db,call}=await fixture(t);
  // الصفقة تُفتح من ملف العميل (الترحيل 180) ليُحفظ عرضها على عرض سعر العميل (الترحيل 182).
  const client=clientFileFor(db,{id:'employee',tenant_id:'36t'},{name:'عميل الربط المصطنع',registration_number:'SYNTH-HTTP-1',contact:'ممثل اختبار',sector:'اختبار'});
  const input={client_id:client,contact:'ممثل اختبار',source:'اختبار HTTP'};
  const key=randomUUID();let c=await call('employee','/commercial',input,201,key);
  assert.equal((await call('employee','/commercial',input,201,key)).id,c.id);
  await call('employee','/commercial',{...input,source:'مدخلات مختلفة'},409,key);
  await call('employee','/commercial/'+c.id+'/qualify',{version:c.version},403,randomUUID(),false);
  c=await call('employee','/commercial/'+c.id+'/qualify',{version:c.version,need:'احتياج حملة مصطنعة',budget:'1000.00',currency:'SAR',timing:'2099-10-01',decision_maker:'ممثل الاختبار',service_fit:'مخرج تجريبي محدد'},201);
  c=await call('manager','/commercial/'+c.id+'/approve_qualification',{version:c.version,note:'راجعنا ملاءمة الخدمة'},201);
  c=await call('employee','/commercial/'+c.id+'/save_quote',boundQuote(db,c.id,{version:c.version,scope:'مخرج حملة مصطنعة',currency:'SAR',valid_until:'2099-10-01',lines:[{description:'مخرج مصطنع',quantity:'1',unit_price:'1000.00',unit_cost:'400.00',discount:'0',tax_rate:'0',acceptance:'تسليم محتوى مطابق للموجز',revisions:2}]}),201);
  c=await call('employee','/commercial/'+c.id+'/submit_quote',{version:c.version},201);
  c=await call('manager','/commercial/'+c.id+'/approve_quote',{version:c.version,note:'اعتمدت نسخة العرض المحلي'},201);
  c=await call('employee','/commercial/'+c.id+'/register_contract',{version:c.version,agreement_evidence:'مرجع اتفاق مصطنع محفوظ دون توقيع رسمي',customer_representative:'ممثل العميل التجريبي'},201);
  c=await call('manager','/commercial/'+c.id+'/create_project',{version:c.version,member_ids:['pm']},201);
  assert.equal((await call('employee','/projects'))[0].id,c.project_id);
  // كان التاريخ 2099-12-31 راحةَ تهيئة لا تأكيدًا: الاختبار يؤكد أن المنح يعيد 201 ويفتح المسار المالي، لا أن النطاق بلا نهاية.
  // ومع سقف مدة الصلاحيات المؤقتة (MAX_FINANCE_AUTHORITY_DAYS) صار ذلك التاريخ مرفوضًا، فيُحسب من الآن داخل الأفق. التأكيد كما هو: 201.
  const scopeEnds=new Date(Date.now()+30*86400000).toISOString();
  for(const user_id of ['finance-preparer','finance-approver'])await call('manager',`/projects/${c.project_id}/finance-scope`,{user_id,ends_at:scopeEnds,reason:'نطاق مالي تجريبي'},201);
  let budget=await call('finance-preparer','/budgets',{project_id:c.project_id,cost_center:'LOCAL-1',currency:'SAR',cap_amount:'100',valid_from:'2026-01-01',valid_until:'2099-12-31',evidence:'مخصص صريح للاختبار'},201);
  budget=await call('finance-preparer',`/budgets/${budget.id}/submit`,{version:budget.version,note:'تقديم للاعتماد'},201);
  budget=await call('finance-approver',`/budgets/${budget.id}/approve`,{version:budget.version,note:'مراجعة مستقلة'},201);
  let p=await call('employee','/procurement',{project_id:c.project_id,title:'احتياج المخرج',specification:'وحدتان وفق قبول محدد',cost_center:'LOCAL-1',due_date:'2099-10-01',quantity:2,unit:'وحدة',budget_amount:'100.00',budget_evidence:'تخصيص مصطنع للاحتياج المحلي',currency:'SAR'},201);
  p=await call('employee',`/procurement/${p.id}/submit`,{version:p.version},201);
  // بوابة المورد (app/vendors.mjs): الكيان بلا ملف ما عاد يُقبل عرضه، فالمفاتيح الثلاثة تُسجَّل أولًا.
  approveVendors(db,['SYN-A','SYN-B','SYN-C']);
  for(const supplier_key of ['SYN-A','SYN-B','SYN-C'])p=await call('employee',`/procurement/${p.id}/add_quote`,{version:p.version,supplier_key,supplier_name:supplier_key,unit_price:'10.01',technical_assessment:'مطابق للمواصفات المسجلة',financial_terms:'سداد غير مهيأ للاختبار',delivery_date:'2099-10-01',evidence:'مرجع العرض المصطنع'},201);
  await call('employee',`/procurement/${p.id}/award`,{version:p.version,quote_id:p.quotes[0].id,note:'اعتماد ذاتي غير مسموح'},403);
  p=await call('manager',`/procurement/${p.id}/award`,{version:p.version,quote_id:p.quotes[0].id,note:'اعتمدت المقارنة والمخصص المحلي'},201);
  p=await call('manager',`/procurement/${p.id}/approve_order`,{version:p.version,terms:'شروط توريد مصطنعة فقط',delivery_date:'2099-10-01',note:'اعتماد الأمر الداخلي'},201);
  // أمر المباشرة (ترحيل 116): أمر الشراء ليس إذن البدء، ولا استلام قبل صدوره.
  await call('employee',`/procurement/${p.id}/commence`,{version:p.version,start_on:'2026-10-01',site_or_channel:'موقع المورد المصطنع',scope_confirmation:'طالب الشراء لا يأذن للمورد بالبدء على طلبه'},403);
  // الاستلام يُسجَّل اليوم، فالإذن يبدأ اليوم ويحمل آخر يوم يسري فيه ودليل إبلاغ المورد (الترحيل 162).
  p=await call('manager',`/procurement/${p.id}/commence`,{version:p.version,start_on:new Date(Date.now()+3*3600000).toISOString().slice(0,10),valid_until:'2099-12-31',site_or_channel:'موقع المورد المصطنع',scope_confirmation:'أذنّا للمورد بالبدء على النطاق المعتمد في الأمر',evidence:'بريد إذن المباشرة المرسل للمورد وردّه بالاستلام'},201);
  p=await call('employee',`/procurement/${p.id}/receive`,{version:p.version,quantity:2,reference:'SYN-RECEIPT-1',evidence:'فحص واستلام وحدتين'},201);
  p=await call('employee',`/procurement/${p.id}/record_invoice`,{version:p.version,quantity:2,amount:'20.02',supplier_reference:'SYN-INV-1',evidence:'مرجع فاتورة اختبار مصطنع'},201);
  p=await call('manager',`/procurement/${p.id}/match`,{version:p.version,invoice_id:p.invoices[0].id,note:'طابقت الأمر ومحضر الاستلام والمرجع'},201);
  assert.equal(p.payable_minor,2002);assert.equal(p.payables[0].payment_status,'not_paid');assert.equal(p.payables[0].posting_status,'not_posted');
  for(const who of ['outsider','admin','external']){assert.deepEqual(await call(who,'/commercial'),[]);assert.deepEqual(await call(who,'/procurement'),[]);await call(who,`/procurement/${p.id}/match`,{version:p.version,invoice_id:p.invoices[0].id,note:'خارج النطاق'},404);}
  assert.equal((await call('manager','/integrations')).last_success,null);assert.ok(verifyAudit(db));
});
test('WF-08 HTTP: opening, reservation, two approvals and cancellation update the same employee year once',async t=>{
  // يبقى تاريخ الطلب مستقبلًا مهما كان يوم تشغيل الحزمة؛ وإلا يتحول في يوم بدايته إلى إجازة جارية لا تقبل الإلغاء.
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-30T09:00:00+03:00')});
  const {db,call}=await fixture(t);
  await call('admin','/leave',undefined,403);
  const input={employee_id:'employee',leave_type:'synthetic_annual',balance_year:2026,days:10,effective_date:'2026-01-01',reason:'افتتاح اختبار محدد',evidence:'مرجع مصطنع للأيام',calendar_id:'synthetic-creative-2026'};
  await call('employee','/leave/openings',input,403);
  const key=randomUUID(),b=await call('hr','/leave/openings',input,201,key);assert.equal((await call('hr','/leave/openings',input,201,key)).id,b.id);
  const request={leave_type:'synthetic_annual',balance_year:2026,start_date:'2026-10-04',end_date:'2026-10-05',reason:'إجازة مصطنعة للربط'};
  const requestKey=randomUUID();let r=await call('employee','/leave/requests',request,201,requestKey);assert.equal((await call('employee','/leave/requests',request,201,requestKey)).id,r.id);
  await call('hr',`/leave/requests/${r.id}/approve`,{version:r.version,note:'محاولة قفز المدير'},403);
  r=await call('manager',`/leave/requests/${r.id}/approve`,{version:r.version},201);
  r=await call('hr',`/leave/requests/${r.id}/approve`,{version:r.version},201);
  let list=await call('employee','/leave');assert.equal(list.balances[0].available_days,8);assert.equal(list.calendar_entries.length,2);
  await call('outsider',`/leave/requests/${r.id}/cancel`,{version:r.version,note:'خارج الصلاحية'},404);
  r=await call('employee',`/leave/requests/${r.id}/cancel`,{version:r.version,note:'إلغاء تجربة الربط'},201);
  await call('employee',`/leave/requests/${r.id}/cancel`,{version:r.version,note:'تكرار الإلغاء'},403);
  list=await call('employee','/leave');assert.equal(list.balances[0].available_days,10);assert.equal(list.calendar_entries.length,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leave_ledger WHERE kind='refund'").get().n,1);assert.ok(verifyAudit(db));
});
test('PLT-04 HTTP: a temporary substitute loses the decision endpoint after revocation',async t=>{
  const {call}=await fixture(t),services=await call('employee','/catalog');
  let r=await call('employee','/requests',{service_id:services.find(s=>s.code==='HR-LETTER').id,title:'اختبار تفويض على HTTP',payload:{purpose:'غرض مصطنع',recipient:'جهة اختبار'}},201);
  r=await call('employee',`/requests/${r.id}/submit`,{version:r.version},201);
  const input={delegate_id:'deputy',service_code:'HR-LETTER',starts_at:new Date(Date.now()-60_000).toISOString(),ends_at:new Date(Date.now()+60_000).toISOString(),reason:'تغطية اختبار محلية'};
  const key=randomUUID(),g=await call('manager','/delegations',input,201,key);assert.equal((await call('manager','/delegations',input,201,key)).id,g.id);
  assert.ok((await call('deputy',`/requests/${r.id}`)).actions.includes('approve'));
  await call('manager',`/delegations/${g.id}/revoke`,{version:g.version,note:'إيقاف التغطية التجريبية'},201);
  await call('deputy',`/requests/${r.id}`,undefined,404);
  await call('deputy',`/requests/${r.id}/approve`,{version:r.version},404);
});
test('NFR-08: expanding synthetic fixtures twice preserves existing users, records and balances',()=>{
  const db=openDb(':memory:');try{seed(db,'synthetic-expand-only');
    const before=JSON.stringify(db.prepare('SELECT * FROM users ORDER BY id').all());assert.equal(expandDemo(db,2026).length,4);assert.equal(expandDemo(db,2026).length,0);
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM users WHERE id NOT IN ('pm','deputy') ORDER BY id").all()),before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leave_ledger').get().n,0);assert.ok(verifyAudit(db));
  }finally{db.close();}
});
test('FIN-06 HTTP: explicit financial accounts prepare, independently approve and post without external execution',async t=>{
  const {db,call}=await fixture(t),f=await call('finance-preparer','/finance');
  assert.equal((await call('finance-preparer','/me')).user.capabilities.finance,true);assert.equal((await call('manager','/me')).user.capabilities.finance,false);
  await call('manager','/finance',undefined,403);await call('admin','/finance',undefined,403);
  const center=f.cost_centers[0].id,expense=f.accounts.find(a=>a.account_type==='expense').id,liability=f.accounts.find(a=>a.account_type==='liability').id;
  const input={period_id:f.periods[0].id,entry_date:'2026-09-10',description:'قيد اختبار HTTP',evidence:'إثبات تجربة محلية',source_reference:'SYN-HTTP-FIN-01',currency:'SAR',lines:[{account_id:expense,cost_center_id:center,debit:'12.34',credit:'0',memo:'مصروف اختبار'},{account_id:liability,cost_center_id:center,debit:'0',credit:'12.34',memo:'التزام اختبار'}]};
  const key=randomUUID();let j=await call('finance-preparer','/finance/journals',input,201,key);assert.equal((await call('finance-preparer','/finance/journals',input,201,key)).id,j.id);
  j=await call('finance-preparer',`/finance/journals/${j.id}/submit`,{version:j.version,note:'تقديم نسخة المراجعة'},201);
  assert.ok((await call('finance-approver','/overview')).decisions.some(d=>d.id===j.id));
  await call('finance-preparer',`/finance/journals/${j.id}/approve`,{version:j.version,note:'محاولة اعتماد ذاتي'},403);
  j=await call('finance-approver',`/finance/journals/${j.id}/approve`,{version:j.version,note:'اعتماد مستقل موثق'},201);
  j=await call('finance-approver',`/finance/journals/${j.id}/post`,{version:j.version,note:'ترحيل داخل القاعدة المحلية'},201);
  const report=await call('finance-preparer','/finance');assert.equal(report.trial_balance.total_debit_minor,1234);assert.equal(report.external_posting_status,'not_configured');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,0);
});
test('TAL-01/02 HTTP: approved hiring scope admits one candidate and masks the profile from checklist outsiders',async t=>{
  const {call}=await fixture(t),data=await call('manager','/people');
  let need=await call('manager','/people/requisitions',{policy_id:data.policies[0].id,title:'وظيفة مصطنعة',need:'مبرر احتياج الاختبار',plan_reference:'خطة مصطنعة',budget_evidence:'دليل مخصص مصطنع',target_date:'2026-12-01',criteria:[{key:'craft',label:'جودة التنفيذ',weight:60,acceptance:'دليل مهارة'},{key:'planning',label:'التخطيط',weight:40,acceptance:'دليل خطة'}]},201);
  assert.ok((await call('hr','/overview')).decisions.some(d=>d.id===need.id));
  await call('manager',`/people/${need.id}/approve_need`,{version:need.version,note:'اعتماد ذاتي'},403);
  need=await call('hr',`/people/${need.id}/approve_need`,{version:need.version,note:'راجعت الخطة والمخصص'},201);
  const input={version:need.version,name:'مرشح مصطنع',contact:'ui-candidate@example.invalid',source:'اختبار محلي',consent_evidence:'موافقة مصطنعة',retention_until:'2026-12-31'},key=randomUUID();
  const c=await call('hr',`/people/${need.id}/add_candidate`,input,201,key);assert.equal((await call('hr',`/people/${need.id}/add_candidate`,input,201,key)).id,c.id);
  assert.equal((await call('outsider','/people')).candidates.length,0);assert.equal((await call('external','/people')).candidates.length,0);await call('admin','/people',undefined,403);
});
test('STR-08/CRT-09 HTTP: project members produce an approved text version and an internal delivery manifest',async t=>{
  const {call}=await fixture(t),project=await call('manager','/projects',{name:'استوديو HTTP',brief:'مشروع مصطنع للمراجعة',member_ids:['employee']},201);
  let s=await call('employee','/studio',{project_id:project.id,title:'موجز مصطنع',objective:'هدف قابل للمراجعة',audience:'جمهور مصطنع',audience_basis:'افتراض اختبار موضح',message:'رسالة تجربة محلية',prohibited_messages:'وعود غير مسندة',kpi:'عدد طلبات تجريبية',measurement_source:'سجل محلي غير متصل',channels:['internal'],scope:'مخرج نصي واحد'},201);
  const act=async(who,action,values={})=>{s=await call(who,`/studio/${s.id}/${action}`,{version:s.version,...values},201);};
  await act('employee','submit_brief');assert.ok((await call('manager','/overview')).decisions.some(d=>d.id===s.id));await act('manager','approve_brief',{note:'اعتماد الموجز المقدم'});
  await act('employee','add_asset',{name:'أصل النص المصطنع',internal_reference:'SYN_TEXT',rights_holder:'صاحب نص تجريبي',rights_basis:'owned',rights_evidence:'إفادة ملكية مصطنعة',valid_from:'2026-01-01',valid_until:'2099-12-31',channels:['internal']});
  await act('manager','inspect_asset',{asset_id:s.assets[0].id,outcome:'passed',evidence:'إفادة فحص حقوق العينة'});
  await act('employee','create_output',{title:'مخرج نصي',channel:'internal',format:'نص',dimensions:'فقرة داخلية',language:'العربية',brand_reference:'ATHAR-SYN',acceptance:'مطابقة الرسالة',content:'نص اختبار محفوظ للمراجعة.',asset_ids:[s.assets[0].id]});
  const output=s.outputs[0].id;await act('employee','submit_output',{output_id:output});await act('manager','approve_output',{output_id:output,note:'فحص الجودة المكتوب',quality_checks:{brand:'passed',language:'passed',claims:'passed',accessibility:'passed',specification:'passed'}});
  await act('employee','issue_package',{output_ids:[output],use_from:riyadhDay(),use_until:'2099-10-10',exclusions:'بيان نصي دون ملفات إنتاج'});await act('manager','accept_package',{package_id:s.packages[0].id,note:'مراجعة البيان',evidence:'إثبات قبول داخلي'});
  assert.equal(s.packages[0].snapshot.internal_only,true);assert.deepEqual(await call('outsider','/studio'),[]);
});
