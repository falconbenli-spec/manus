import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { openDb,transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { AppError } from '../app/auth.mjs';
import { createApp } from '../app/server.mjs';
import { refuse,refusalMessage,actorOrRefuse } from '../app/refusal.mjs';
import { gateMessage } from '../app/project-intake.mjs';
import { myRequests } from '../app/my-requests.mjs';
import { profileView } from '../app/my-profile.mjs';
import { countShortRefusals,SHORT_REFUSAL_LIMIT } from '../scripts/quality-ratchet.mjs';

// معيار الرفض (م0 «السور»): ما الذي رُفض، وما الناقص، ومن يملكه، وما الخطوة التالية — على نمط gateMessage.
const caught=run=>{try{run();}catch(error){return error;}assert.fail('لم يُرمَ رفض');};
const missing=[{document:'أمر شراء العميل',why:'لم يُرفع بعد',owner:'مسؤول الحساب',owner_role:'account_manager',doc_key:'client_purchase_order'},
  {document:'الدفعة المقدمة المؤكدة',why:'المقبوض أقل من المتفق عليه',owner:'المالية',owner_role:'finance'}];

test('refuse: the message reads «what: document — owner؛ next» and the structured form travels in error.details',()=>{
  const error=caught(()=>refuse(409,'execution_blocked',{what:'لا يبدأ التنفيذ المدفوع',missing,next:'ارفع أمر الشراء من ملف المشروع',link:'#project-receipt'}));
  assert.ok(error instanceof AppError);assert.equal(error.status,409);assert.equal(error.code,'execution_blocked');
  assert.equal(error.message,'لا يبدأ التنفيذ المدفوع: أمر شراء العميل — مسؤول الحساب؛ الدفعة المقدمة المؤكدة — المالية؛ ارفع أمر الشراء من ملف المشروع');
  assert.deepEqual(error.details.refusal,{what:'لا يبدأ التنفيذ المدفوع',
    missing:[{document:'أمر شراء العميل',why:'لم يُرفع بعد',owner:'مسؤول الحساب',owner_role:'account_manager',doc_key:'client_purchase_order'},
      {document:'الدفعة المقدمة المؤكدة',why:'المقبوض أقل من المتفق عليه',owner:'المالية',owner_role:'finance'}],
    next:'ارفع أمر الشراء من ملف المشروع',link:'#project-receipt'});
});

test('refuse: each missing item is written exactly as gateMessage writes it, and gateMessage itself is unchanged',()=>{
  // الشكل المشترك مع app/project-intake.mjs وapp/project-axes.mjs: {document, why, owner, owner_role}.
  assert.equal(refusalMessage({what:'x',missing}).slice('x: '.length),gateMessage({refusals:missing}));
  assert.match(readFileSync(new URL('../app/project-intake.mjs',import.meta.url),'utf8'),/export const gateMessage=gate=>gate\.refusals\.map\(r=>`\$\{r\.document\} — \$\{r\.owner\}`\)\.join\('؛ '\);/);
  assert.equal(refusalMessage({what:'لا يُحفظ الطلب',next:'أكمل تاريخ البداية'}),'لا يُحفظ الطلب؛ أكمل تاريخ البداية');
  assert.equal(refusalMessage({what:'لا يُعتمد المسير',missing:[missing[1]]}),'لا يُعتمد المسير: الدفعة المقدمة المؤكدة — المالية');
});

test('refuse: a lazy refusal cannot be written — the standard is enforced where the refusal is authored',()=>{
  const bad=[[{},/«what» مطلوب/],[{what:'   '},/«what» مطلوب/],[{what:'الإجراء غير متاح'},/اذكر ما الناقص/],[{what:'x',missing:[{document:'وثيقة'}]},/document وowner/],
    [{what:'x',missing:[{owner:'المالية'}]},/document وowner/],[{what:'x',missing:'وثيقة'},/«missing» قائمة/]];
  for(const [input,message] of bad)assert.throws(()=>refuse(403,'forbidden',input),error=>error instanceof TypeError&&message.test(error.message),JSON.stringify(input));
  assert.throws(()=>refuse(500,'x',{what:'x',next:'y'}),/4xx/,'عطل الخادم ليس رفضًا');
  assert.throws(()=>refuse(403,'',{what:'x',next:'y'}),/رمز الرفض/);
  // خطأ المبرمج TypeError لا AppError: يظهر 500 في أول تشغيل ولا يصل إلى مستخدم رفضًا أبكم.
  assert.ok(!(caught(()=>refuse(403,'c',{}))instanceof AppError));
});

test('actorOrRefuse: an active account passes through; a suspended one is told why, who re-activates it and what to do',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-refusal');t.after(()=>db.close());
  const employee=db.prepare("SELECT * FROM users WHERE id='employee'").get();
  assert.equal(actorOrRefuse(db,employee).id,'employee');
  transaction(db,()=>db.prepare("UPDATE users SET active=0 WHERE id='employee'").run());
  const error=caught(()=>actorOrRefuse(db,employee));
  // الرمز والحالة كما كانا، فسجل «access denied» في الخادم وكل ما يقرأ الرمز يبقيان كما هما.
  assert.equal(error.status,403);assert.equal(error.code,'forbidden');
  assert.equal(error.message,'لا يُنفَّذ هذا الإجراء بحسابك الآن: حساب مفعَّل في المنصة — مسؤول المنصة؛ اطلب من مسؤول المنصة إعادة تفعيل حسابك، ثم سجّل الدخول من جديد');
  assert.ok([...error.message].length>SHORT_REFUSAL_LIMIT);
  assert.deepEqual(error.details.refusal.missing,[{document:'حساب مفعَّل في المنصة',why:'حسابك موقوف أو لم يعد مسجلًا في هذا الكيان',owner:'مسؤول المنصة',owner_role:'admin'}]);
  // الوحدات اليومية التي تبنّت المساعد ترفض الحساب الموقوف بالنص نفسه، لا بـ«الحساب غير متاح».
  for(const read of [()=>myRequests(db,employee),()=>profileView(db,employee)])assert.equal(caught(read).message,error.message);
  assert.equal(actorOrRefuse(db,db.prepare("SELECT * FROM users WHERE id='manager'").get()).id,'manager');
  assert.equal(caught(()=>actorOrRefuse(db,null)).code,'forbidden');
  assert.equal(caught(()=>actorOrRefuse(db,{id:'employee',tenant_id:'isolated'})).code,'forbidden','حساب من كيان آخر');
});

test('actorOrRefuse: the seven daily modules that adopted it no longer carry the «الحساب غير متاح» idiom',()=>{
  for(const name of ['my-requests','my-profile','letters','payroll','request-timeline','engagement','search']){
    const source=readFileSync(new URL(`../app/${name}.mjs`,import.meta.url),'utf8');
    assert.ok(!source.includes('الحساب غير متاح'),`app/${name}.mjs`);
    assert.match(source,/import \{ actorOrRefuse \} from '\.\/refusal\.mjs';/,`app/${name}.mjs`);
  }
});

test('refusal over HTTP: the server sends the structured form beside the message, so the interface can draw it',async t=>{
  // app/server.mjs يرسل details لكل خطأ دون 500 ولم يُعدَّل؛ هنا يُثبت أن رفض refuse() يصل كاملًا. الحساب يُوقف بعد الدخول،
  // والجلسة تُرفض قبل الوحدة إن كانت تتحقق من التفعيل — أيهما وقع، لا يصل إلى صاحب الحساب رفض بلا سبب.
  const db=openDb(':memory:');seed(db,'synthetic-refusal-http');
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'outsider',password:'synthetic-refusal-http'})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/api/my-requests',{headers:{cookie}})).status,200);
  transaction(db,()=>db.prepare("UPDATE users SET active=0 WHERE id='outsider'").run());
  const response=await fetch(base+'/api/my-requests',{headers:{cookie}}),body=await response.json();
  assert.ok([401,403].includes(response.status),String(response.status));
  assert.ok(body.error.message.length>SHORT_REFUSAL_LIMIT||response.status===401,body.error.message);
  if(response.status===403)assert.equal(body.error.details.refusal.missing[0].owner_role,'admin');
});

test('short refusals: the counter sees «الإجراء غير متاح» and lets a refusal that names something through',()=>{
  assert.equal(countShortRefusals("fail(403,'forbidden','الإجراء غير متاح');fail(404,\"not_found\",\"الحساب غير متاح\");"),2);
  assert.equal(countShortRefusals("fail(409,'execution_blocked',`لا يبدأ التنفيذ المدفوع قبل اكتمال ما يلي: ${gateMessage(gate)}`);"),0,'نص باستيفاء يسمّي شيئًا بعينه');
  assert.equal(countShortRefusals("fail(403,'not_permitted','بدء التنفيذ يسجّله مدير المشروع المستلم وحده');"),0);
  assert.equal(countShortRefusals("fail(400,'x','"+'ح'.repeat(25)+"');fail(400,'x','"+'ح'.repeat(26)+"');"),1,'الحد 25 حرفًا');
  assert.equal(countShortRefusals("refuse(403,'forbidden',{what:'قصير',next:'افعل كذا'});"),0,'refuse() ليست fail()');
});
