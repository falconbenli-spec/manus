import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../app/server.mjs';
import { saveValues } from '../app/custom-fields.mjs';
import { refreshIndex } from '../app/search.mjs';
import { fixture, MASKED_NOTE, LEAD_SOURCE, CANARY, sessionsFor, workbookText } from './definitions-fixture.mjs';

// اختبار الكناري (ترحيل 123). الخطر المعروف: المنصة تبني حمولاتها بـ{...row}، فعمود custom_fields الجديد يركب معها وكان
// سيحمل قيمة حقل محجوب إلى المتصفح. العلاج أن تكتب customFields.project() فوق المفتاح وتُنشر بعد الصف؛ وهذا الاختبار يزرع
// قيمة كناري في حقل محجوب على الكيانات الثلاثة، ثم يمشي **كل** مسار قراءة ثابت في الخادم بحساب غير مخوَّل ويؤكد أنها لا ترد
// في أي جسم رد — لا القيمة ولا اسم الحقل ولا مفتاحه. مسار جديد يُضاف إلى الخادم يدخل المسح من تلقائه.
const LABEL=MASKED_NOTE.label.ar;
const staticGetRoutes=()=>[...new Set([...readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8').matchAll(/p==='(\/api\/[a-z0-9/_-]+)'&&req\.method==='GET'/g)].map(m=>m[1].slice(4)))].sort();

test('leak: a canary value in a masked custom field appears in no response body for a reader who may not see it — every static read route, the record routes, the exports and the search',async t=>{
  const {db,users,tx,publish,client,opportunity,quote,row}=fixture(t);
  for(const entity of ['client','opportunity','client_quotation'])publish(entity,{fields:[LEAD_SOURCE,MASKED_NOTE],layout:{slots:{header:['internal_note']}},views:{list:{columns:['internal_note'],sort:{field:'internal_note',direction:'asc'}}}});
  // المدير وحده يحمل profitability.view. الفرصة يكتب فيها صاحبها، فتُزرع قيمتها بكتابة مباشرة كما لو أدخلها مخوَّل.
  tx(()=>saveValues(db,users.manager,'client',client,{version:row('clients',client).version,values:{internal_note:CANARY}}));
  tx(()=>saveValues(db,users.manager,'client_quotation',quote,{version:row('client_quotations',quote).version,values:{internal_note:CANARY}}));
  db.prepare("UPDATE opportunities SET custom_fields=json_set(custom_fields,'$.internal_note',?),version=version+1 WHERE id=?").run(CANARY,opportunity);
  for(const [table,id] of [['clients',client],['opportunities',opportunity],['client_quotations',quote]])assert.ok(row(table,id).custom_fields.includes(CANARY),`${table}: الكناري في القاعدة`);
  tx(()=>refreshIndex(db,users.outsider,{explicit:true,maxAgeMs:0}));

  const routes=staticGetRoutes();
  assert.ok(routes.length>100&&['/pricing','/pipeline','/clients','/inbox','/search','/definitions/snapshot','/definitions'].every(path=>routes.includes(path)),'المسح يقرأ مسارات الخادم الفعلية');
  const dynamic=[`/pricing/quotations/${quote}/record`,`/records/client/${client}/custom-fields/history`,`/records/opportunity/${opportunity}/custom-fields/history`,
    `/records/client_quotation/${quote}/custom-fields/history`,'/search?q='+encodeURIComponent('ملاحظة'),'/definitions/client_quotation','/definitions/snapshot?preview=1'];
  const {call}=await sessionsFor(createApp(db),['outsider','hr','admin','manager']);
  let answered=0;
  for(const who of ['outsider','hr','admin'])for(const path of [...routes,...dynamic]){
    const response=await call(who,path);
    assert.ok(response.status<500,`${who} ${path}: عطل خادم ${response.status}`);
    if(response.status===200)answered++;
    assert.ok(!response.text.includes(CANARY),`${who} ${path}: قيمة الحقل المحجوب وصلت`);
    // الأدمن الأول يحمل تصريح تعديل التعريفات (غير حساس)، فيرى **تعريف** الحقل في المحرّر والتصدير — يلزمه ليعدّله — ولا يرى قيمته أبدًا.
    const definitionTool=who==='admin'&&path.startsWith('/definitions/')&&!path.startsWith('/definitions/snapshot');
    if(!definitionTool)assert.ok(!response.text.includes(LABEL)&&!response.text.includes('internal_note'),`${who} ${path}: اسم الحقل المحجوب أو مفتاحه وصل`);
  }
  assert.ok(answered>60,'المسح وصل شاشات حقيقية ولم يُرفض كله');
  for(const who of ['outsider'])for(const entity of ['client','opportunity','client_quotation']){
    const cells=workbookText((await call(who,`/records/${entity}/export.xlsx`,undefined,200)).buffer);
    assert.ok(!cells.includes(CANARY)&&!cells.includes(LABEL),`${entity}: التصدير`);
  }
  // والمخوَّل يراها في الشاشات الثلاث وفي التصدير: الاختبار يفحص حجبًا لا غيابًا عامًّا.
  for(const path of ['/pricing','/pipeline','/clients'])assert.ok((await call('manager',path,undefined,200)).text.includes(CANARY),`manager ${path}`);
  assert.ok(workbookText((await call('manager','/records/opportunity/export.xlsx',undefined,200)).buffer).includes(CANARY));
  // حامل تصريح التعريفات يرى **تعريف** الحقل في المحرّر (يلزمه ليعدّله) ولا يرى قيمته في السجلات ما لم يحمل تصريح الحقل.
  const {call:asEmployee}=await sessionsFor(createApp(db),['employee']);
  assert.ok((await asEmployee('employee','/definitions/client_quotation',undefined,200)).text.includes(LABEL));
  assert.ok(!(await asEmployee('employee','/pricing',undefined,200)).text.includes(CANARY));
});
