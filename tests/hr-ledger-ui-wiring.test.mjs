// الحزمة 4 (P4-HR-3/4) في الشاشات: ما يعرضه الخادم من أفعال يُرسم بزرٍّ مسمّى، وما لا يقبله لا يُرسم، والنموذج يُرسل إلى نقطة نهايته
// بحمولته فيقبله الخادم الحقيقي (createApp بلا منفذ، بالجلسة وCSRF). على منوال tests/hr-ui-wiring.test.mjs.
//   • الرواتب: «طلب عكس المسير» لمسير معتمد، وقرار العكس لمعتمدٍ غير طالبه، والمسير المنعكس بكلمته.
//   • حركات الرواتب: اعتماد التحويل لا يُرسم قبل ترحيل قيد مسيره وسطره يقول لماذا؛ وصرف السلفة لمن يحق له.
//   • القوائم المالية: مراكز تكلفة الإدارات — التسجيل والقرار بيدين.
// البيانات تجريبية كلها (tests/hr-cycle-fixture.mjs وtests/payroll-books.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollUI } from '../app/static/payroll-ui.mjs';
import { payrollExtrasUI } from '../app/static/payroll-extras-ui.mjs';
import { statementsUI } from '../app/static/statements-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { money } from '../app/static/operations.mjs';
import { recordEmployeeBank, decideEmployeeBank, preparePayrollPayment, proposeAdvance, decideAdvance } from '../app/payroll-extras.mjs';
import { riyadhToday } from '../app/riyadh-time.mjs';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';
import { hrCycle, PASSWORD } from './hr-cycle-fixture.mjs';
import { iban } from './wage-fixture.mjs';
import { payrollBooks } from './payroll-books.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context=view=>({e,money,tr:ar=>ar,lang:'ar',ui:kit(e),
  button:(action,id,label)=>`<button class="btn outline small" data-action="operation" data-module="${e(view)}" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`});
const buttonsOf=html=>[...html.matchAll(/data-operation="([a-z_]+)" data-id="([^"]*)">([^<]*)</g)].map(m=>({action:m[1],id:m[2],label:m[3]}));
// جلسات حقيقية بلا منفذ، كما في tests/hr-cycle-fixture.mjs، ومعها مفتاح ثبات لنموذج «إنشاء» يحمله الغلاف (idempotent).
async function sessions(w,names){
  const app=createApp(w.db),jar={};
  for(const username of names){
    const r=await dispatch(app,{method:'POST',path:'/api/login',body:{username,password:PASSWORD}});
    if(r.status!==200)throw new Error(`login failed for ${username}: ${r.text}`);
    jar[username]={cookie:r.headers['Set-Cookie'].split(';')[0],csrf:r.json().csrf};
  }
  const call=(who,method,path,body,extra={})=>dispatch(app,{method,path:'/api'+path,headers:{cookie:jar[who].cookie,'x-csrf-token':jar[who].csrf,origin:'http://127.0.0.1:3600',...extra},body});
  const api=who=>async path=>{const r=await call(who,'GET',path);if(r.status>=400)throw Object.assign(Error(r.text),{status:r.status});return r.json();};
  const submit=(who,spec,values)=>call(who,'POST',spec.endpoint,spec.toPayload(values),spec.idempotent?{'idempotency-key':randomUUID()}:{});
  return {call,api,submit};
}
const bank=(w,userId,bban)=>{const {id}=w.tx(()=>recordEmployeeBank(w.db,w.U.hr,{user_id:userId,bank_name:'بنك تجريبي',iban:iban(bban),effective_month:'2026-01',evidence:'خطاب بنكي تجريبي باسم صاحب الحساب'}));
  w.tx(()=>decideEmployeeBank(w.db,w.U['hr-manager'],id,'verify',{note:'طابقت الخطاب البنكي التجريبي مع الاسم'}));};

test('payroll: an approved run offers «طلب عكس المسير», the decision goes to an approver other than the requester, and the reversed run says so in its word',async t=>{
  const w=hrCycle(t);payrollBooks(w.db);
  const june=w.approveMonth('2026-06');
  const {api,submit}=await sessions(w,['hr','hr-manager']);
  let data=await payrollUI.load(api('hr'));
  assert.deepEqual(buttonsOf(payrollUI.render(data,context('payroll'))).filter(b=>b.id===june.id&&b.action.endsWith('run_reversal')).map(b=>[b.action,b.label]),[['request_run_reversal','طلب عكس المسير']]);
  const ask=payrollUI.form('request_run_reversal',june.id,data);
  assert.deepEqual(ask.fields.map(f=>f.name),['reason']);
  let response=await submit('hr',ask,{reason:'سطر الموظفة احتُسب على عقد قديم في البيئة التجريبية'});
  assert.ok(response.status<300,response.text);
  data=await payrollUI.load(api('hr'));
  let html=payrollUI.render(data,context('payroll'));
  assert.match(html,/<strong>عكس ينتظر قرار زميل<\/strong><p class="measure">سطر الموظفة احتُسب على عقد قديم في البيئة التجريبية<\/p>/);
  assert.deepEqual(buttonsOf(html).filter(b=>b.id===june.id&&b.action.endsWith('run_reversal')),[],'the requester decides nothing');
  data=await payrollUI.load(api('hr-manager'));
  html=payrollUI.render(data,context('payroll'));
  assert.deepEqual(buttonsOf(html).filter(b=>b.id===june.id&&b.action.endsWith('run_reversal')).map(b=>[b.action,b.label]),[['approve_run_reversal','اعتماد العكس'],['reject_run_reversal','رفض العكس']]);
  const approve=payrollUI.form('approve_run_reversal',june.id,data);
  response=await submit('hr-manager',approve,{note:'تأكدت أن ملف التحويل ما انعدّ للحين'});
  assert.ok(response.status<300,response.text);
  html=payrollUI.render(await payrollUI.load(api('hr')),context('payroll'));
  const card=html.split('<details class="vn-card"').find(c=>c.includes(`data-id="${june.id}"`)||c.includes('منعكس قبل صرفه'))??'';
  assert.match(card,/<span class="badge suspended">منعكس قبل صرفه<\/span>/);
  assert.match(card,/الشهر مفتوح لمسير مصحَّح/);
});

test('payroll extras: the transfer approval is drawn only after the run journal is posted, the row says why until then, and the advance payout has its named control',async t=>{
  const w=hrCycle(t),{db}=w,books=payrollBooks(db);
  bank(w,'employee','80000000000000000021');bank(w,'outsider','80000000000000000039');
  const june=w.approveMonth('2026-06'),paymentId=w.tx(()=>preparePayrollPayment(db,w.U.hr,{run_id:june.id})).id;
  const {api,submit}=await sessions(w,['hr-manager','reviewer']);
  let html=payrollExtrasUI.render(await payrollExtrasUI.load(api('hr-manager')),context('payroll-extras'));
  const row=()=>html.split('<li>').find(li=>li.includes(`payment:${paymentId}`))??'';
  assert.deepEqual(buttonsOf(html).filter(b=>b.id===`payment:${paymentId}`).map(b=>b.action),['cancel_payment']);
  assert.match(row(),/<small>تحويل رواتب 2026-06 ما ينعتمد: قيد المسير ما تجهّز للحين في الدفتر\. جهّز قيد المسير من «القوائم المالية والترحيل»/);
  books.postRun(june.id);
  html=payrollExtrasUI.render(await payrollExtrasUI.load(api('hr-manager')),context('payroll-extras'));
  assert.deepEqual(buttonsOf(html).filter(b=>b.id===`payment:${paymentId}`).map(b=>[b.action,b.label]),[['approve_payment','اعتماد الدفع'],['cancel_payment','إلغاء الدفع']]);
  assert.doesNotMatch(row(),/ما ينعتمد/);
  // صرف السلفة: يُرسم لمراجع الرواتب وحده (غير صاحبها ومقترحها ومعتمدها)، ونموذجه يقبله الخادم.
  const month=riyadhToday().slice(0,7);
  const advanceId=w.tx(()=>proposeAdvance(db,w.U.hr,{user_id:'outsider',amount:'900.00',installments:3,first_month:month,reason:'سلفة تجريبية موثقة بطلب تجريبي'})).id;
  w.tx(()=>decideAdvance(db,w.U['hr-manager'],advanceId,'approve',{note:'اعتماد تجريبي'}));
  assert.equal(buttonsOf(payrollExtrasUI.render(await payrollExtrasUI.load(api('hr-manager')),context('payroll-extras'))).some(b=>b.action==='record_disbursement'),false);
  let data=await payrollExtrasUI.load(api('reviewer'));
  html=payrollExtrasUI.render(data,context('payroll-extras'));
  assert.deepEqual(buttonsOf(html).filter(b=>b.id===`advance:${advanceId}`).map(b=>[b.action,b.label]),[['record_disbursement','تسجيل صرف السلفة']]);
  assert.match(html,/صرفها ما انسجّل للحين — يسجّله مراجع الرواتب بتاريخه ومرجعه البنكي/);
  const spec=payrollExtrasUI.form('record_disbursement',`advance:${advanceId}`,data);
  assert.deepEqual(spec.fields.map(f=>f.name),['disbursed_on','reference','evidence']);
  const response=await submit('reviewer',spec,{disbursed_on:riyadhToday(),reference:'syn-adv-ui',evidence:'إشعار تحويل السلفة التجريبي'});
  assert.ok(response.status<300,response.text);
  html=payrollExtrasUI.render(await payrollExtrasUI.load(api('reviewer')),context('payroll-extras'));
  assert.match(html,/انصرفت <time datetime="[0-9-]{10}">[0-9-]{10}<\/time> بمرجع <bdi dir="ltr">SYN-ADV-UI<\/bdi>/);
  assert.equal(buttonsOf(html).some(b=>b.id===`advance:${advanceId}`),false,'recorded once');
});

test('statements: a department without a cost centre is named, one finance holder records its centre through the form, and a second decides it through his',async t=>{
  const w=hrCycle(t),books=payrollBooks(w.db,{mapDepartments:false});
  const {api,submit}=await sessions(w,['books-preparer','books-approver']);
  let data=await statementsUI.load(api('books-preparer'));
  let html=statementsUI.render(data,context('statements'));
  assert.match(html,/<h3>مراكز تكلفة الإدارات<\/h3>/);
  assert.match(html,/<td>الفريق الإبداعي التجريبي<\/td><td>ما لها مركز معتمد — قيد مسيرها يوقف<\/td>/);
  assert.ok(buttonsOf(html).some(b=>b.action==='record_department_centre'&&b.label==='ربط إدارة بمركز تكلفة'));
  const spec=statementsUI.form('record_department_centre','',data);
  assert.deepEqual(spec.fields.map(f=>f.name),['department_id','cost_center_id','effective_from','reason']);
  let response=await submit('books-preparer',spec,{department_id:'creative',cost_center_id:books.general.id,effective_from:'2026-01-01',reason:'الفريق الإبداعي على المركز العام التجريبي'});
  assert.ok(response.status<300,response.text);
  html=statementsUI.render(await statementsUI.load(api('books-preparer')),context('statements'));
  assert.equal(buttonsOf(html).some(b=>b.action.endsWith('department_centre')&&b.action!=='record_department_centre'),false,'the recorder is offered no decision');
  data=await statementsUI.load(api('books-approver'));
  html=statementsUI.render(data,context('statements'));
  const pending=data.department_centres.pending[0];
  assert.deepEqual(buttonsOf(html).filter(b=>b.id===pending.id).map(b=>[b.action,b.label]),[['approve_department_centre','اعتماد المركز'],['reject_department_centre','رفض المركز']]);
  response=await submit('books-approver',statementsUI.form('approve_department_centre',pending.id,data),{note:'طابقت المركز مع هيكل الإدارات'});
  assert.ok(response.status<300,response.text);
  html=statementsUI.render(await statementsUI.load(api('books-approver')),context('statements'));
  assert.match(html,/<td>الفريق الإبداعي التجريبي<\/td><td><bdi dir="ltr">GEN<\/bdi> · مركز GEN التجريبي<\/td>/);
});
