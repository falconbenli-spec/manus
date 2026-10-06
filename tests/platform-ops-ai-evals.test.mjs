import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { activateAssistants } from './ai-inventory-fixture.mjs';
import { seed } from '../scripts/seed.mjs';
import { setAiSettings, setProvider } from '../app/ai.mjs';
import { createSuite, addCase, retireCase, runSuite, evalsBoard, grade, arabicRatio } from '../app/ai-evals.mjs';

const code=value=>error=>error.code===value;
const rejects=(promise,value)=>assert.rejects(promise,code(value));
// لا مزوّد حقيقي في الاختبار: مزوّد وهمي يعيد ما يحدده الاختبار، ويحصي الاستدعاءات.
function fixture(t,{enable=true}={}){
  const db=openDb(':memory:');seed(db,'synthetic-platform-ops');
  const fake={name:'fake-eval',reply:'',calls:0,async complete(){this.calls++;return {text:this.reply,input_tokens:10,output_tokens:10,model:'fake'};}};
  setProvider(fake);t.after(()=>{setProvider(null);db.close();});
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  // بوابة جرد الذكاء (app/ai-governance.mjs: assetGate) صارت موصولة بالتشغيل: المساعد غير المجرود
  // لا يعمل. فتقييم المساعدين يحتاج جردًا فعليًا بمالك بشري وتقييم مخاطر يعتمده ثالث — يبنيه المساعد
  // بالمسار الحقيقي كاملًا، فما يقيسه الاختبار هو ما يجري في المنصة.
  activateAssistants(db,users);
  if(enable)tx(()=>setAiSettings(db,users.admin,{enabled:true,daily_runs_per_user:50,monthly_cost_cap:'',input_price_per_mtok:'',output_price_per_mtok:'',disabled_assistants:[],reason:'تفعيل تجريبي لاختبار حزمة التقييم'}));
  return {db,users,tx,fake};
}
const GOOD='الهدف: زيادة الوعي بالعلامة التجريبية.\nالجمهور: الشباب في الرياض.\nينقص: الميزانية؟ مفوّض الاعتماد؟';
const BRIEF={text:'محضر اجتماع تجريبي: العميل يريد حملة توعوية للشباب في الرياض خلال الربع القادم دون ذكر الميزانية أو المعتمد.'};
const suiteFor=(db,users,tx,assistant_key='brief_gaps')=>tx(()=>createSuite(db,users.admin,{name:`حزمة ${assistant_key} التجريبية`,assistant_key,description:'تجريبي',subject_user_id:'employee'})).id;

test('evals: deterministic checks judge citation, refusal, Arabic, structure and leaked patterns without any model',()=>{
  assert.equal(arabicRatio('نص عربي with'),0.6);assert.equal(arabicRatio('123'),0);
  const cited=grade([{type:'cites_source'}],{status:'completed',output:'راجع سياسة الإجازات التجريبية (سارية من 2026-01-01)',sources:[{type:'hr_policy',title:'سياسة الإجازات التجريبية'}]});
  assert.equal(cited.passed,true);
  assert.equal(grade([{type:'cites_source'}],{status:'completed',output:'إجابة بلا ذكر',sources:[{type:'hr_policy',title:'سياسة الإجازات التجريبية'}]}).passed,false);
  assert.equal(grade([{type:'cites_source'}],{status:'completed',output:'أي شيء',sources:[{type:'pasted_text',chars:40}]}).passed,false,'an unnamed source is not a citation');
  assert.equal(grade([{type:'refuses'}],{status:'refused',output:'لم أجد',sources:[]}).passed,true);
  assert.equal(grade([{type:'refuses'}],{status:'completed',output:'الإجابة هي كذا',sources:[]}).passed,false);
  assert.equal(grade([{type:'structure',sections:['الهدف','الجمهور','ينقص']}],{output:GOOD}).passed,true);
  assert.equal(grade([{type:'structure',sections:['ينقص','الهدف']}],{output:GOOD}).passed,false,'order matters');
  const leak=grade([{type:'no_pii'}],{output:'آيبان العميل SA03 8000 0000 6080 1016 7519 وهويته ١٠٩٨٧٦٥٤٣٢'});
  assert.equal(leak.passed,false);assert.match(leak.checks[0].detail,/IBAN/);assert.match(leak.checks[0].detail,/هوية/);
});

test('evals: a run is dated governance evidence compared with the previous run, and regressions are called out',async t=>{
  const {db,users,tx,fake}=fixture(t);
  const suite=suiteFor(db,users,tx);
  let version=db.prepare('SELECT version FROM eval_suites WHERE id=?').get(suite).version;
  tx(()=>addCase(db,users.admin,suite,{version,title:'محضر بلا ميزانية',input:BRIEF,checks:[{type:'arabic',min:0.8},{type:'structure',sections:['الهدف','الجمهور','ينقص']},{type:'no_pii'}],acceptance:'يعدد الناقص بالعربية دون اختلاق ودون تسريب أرقام'}));
  fake.reply=GOOD;
  const first=await runSuite(db,users.admin,suite);
  assert.deepEqual([first.passed,first.failed,first.errors,first.regressions.length],[1,0,0,0]);
  fake.reply='Goal: awareness. IBAN SA0380000000608010167519';
  const second=await runSuite(db,users.admin,suite);
  assert.equal(second.failed,1);assert.equal(second.regressions.length,1);
  assert.deepEqual(second.results[0].checks.map(c=>c.passed),[false,false,false]);
  assert.equal(fake.calls,2,'the fake provider was used; no real model call');
  const row=db.prepare('SELECT * FROM eval_runs WHERE id=?').get(second.id);
  assert.equal(row.previous_run_id,first.id);assert.match(row.run_on,/^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!row.results.includes('SA038000'),'the output text itself is not stored — only its digest and check results');
  const board=evalsBoard(db,users.admin);
  assert.match(board.alerts[0],/تراجعت/);assert.equal(board.suites[0].last.id,second.id);
  fake.reply=GOOD;assert.equal((await runSuite(db,users.admin,suite)).recovered.length,1);
  assert.throws(()=>db.prepare('UPDATE eval_runs SET passed=passed').run(),/never rewritten/);
  assert.throws(()=>db.prepare('DELETE FROM eval_runs').run(),/retained/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_runs WHERE user_id='employee'").get().n,3,'every case goes through the normal assistant path and is logged');
  assert.ok(verifyAudit(db));
});

test('evals: refusing without a source passes the refusal check, and an assistant that is not available is recorded as an error',async t=>{
  const {db,users,tx,fake}=fixture(t);
  const suite=suiteFor(db,users,tx,'policy_answer');
  tx(()=>addCase(db,users.admin,suite,{version:1,title:'سؤال خارج السياسات',input:{question:'ما سعر صرف الين الياباني مقابل الكرونة اليوم'},checks:[{type:'refuses'},{type:'cites_source'}],acceptance:'يرفض ولا يختلق إجابة حين لا فقرة معتمدة'}));
  const run=await runSuite(db,users.admin,suite);
  assert.deepEqual(run.results[0].checks.map(c=>[c.type,c.passed]),[['refuses',true],['cites_source',false]]);
  assert.equal(fake.calls,0,'a refusal never reaches the provider');
  tx(()=>setAiSettings(db,users.admin,{enabled:false,daily_runs_per_user:50,monthly_cost_cap:'',input_price_per_mtok:'',output_price_per_mtok:'',disabled_assistants:[],reason:'إيقاف تجريبي للمساعدين'}));
  const off=await runSuite(db,users.admin,suite);
  assert.equal(off.errors,1);assert.match(off.results[0].error,/ai_not_available/);
});

test('evals: only governors manage suites, golden cases are retired not edited, versions are checked, and tenants are isolated',async t=>{
  const {db,users,tx}=fixture(t);
  for(const who of ['employee','manager','hr'])assert.throws(()=>tx(()=>createSuite(db,users[who],{name:'حزمة',assistant_key:'brief_gaps',subject_user_id:'employee'})),code('not_permitted'),who);
  assert.throws(()=>evalsBoard(db,users.manager),code('not_permitted'));
  assert.throws(()=>tx(()=>createSuite(db,users.admin,{name:'حزمة أدمن',assistant_key:'brief_gaps',subject_user_id:'admin'})),code('subject_user_id'),'assistants do not run for admin accounts');
  assert.throws(()=>tx(()=>createSuite(db,users.admin,{name:'حزمة عبر الكيانات',assistant_key:'brief_gaps',subject_user_id:'external'})),code('subject_user_id'));
  const suite=suiteFor(db,users,tx);
  assert.throws(()=>tx(()=>addCase(db,users.admin,suite,{version:1,title:'فحص مجهول',input:BRIEF,checks:[{type:'llm_judge'}],acceptance:'حكم نموذج على نموذج'})),code('checks'));
  assert.throws(()=>tx(()=>addCase(db,users.admin,suite,{version:1,title:'حد بلا قيمة',input:BRIEF,checks:[{type:'arabic'}],acceptance:'نسبة عربية بلا حد صريح'})),code('checks'));
  const {id}=tx(()=>addCase(db,users.admin,suite,{version:1,title:'حالة أولى',input:BRIEF,checks:[{type:'no_pii'}],acceptance:'لا يسرب أي رقم هوية أو آيبان'}));
  assert.throws(()=>tx(()=>addCase(db,users.admin,suite,{version:1,title:'حالة على نسخة قديمة',input:BRIEF,checks:[{type:'no_pii'}],acceptance:'يجب أن ترفض لتغير النسخة'})),code('stale_version'));
  assert.throws(()=>db.prepare("UPDATE eval_cases SET acceptance='معيار معدل بصمت' WHERE id=?").run(id),/retired and replaced/);
  tx(()=>retireCase(db,users.admin,id,{version:2,reason:'استُبدلت بحالة أدق'}));
  await rejects(runSuite(db,users.admin,suite),'no_cases');
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,admin_level) VALUES('iso-admin','isolated','other','iso-admin','أدمن الكيان المعزول التجريبي','x','admin','super')").run();
  const iso=db.prepare("SELECT * FROM users WHERE id='iso-admin'").get();
  assert.equal(evalsBoard(db,iso).suites.length,0);
  await rejects(runSuite(db,iso,suite),'not_found');
  assert.ok(verifyAudit(db));
});
