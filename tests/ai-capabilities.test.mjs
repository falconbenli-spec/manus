import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { aiBoard, runAssistant, setAiSettings, setProvider } from '../app/ai.mjs';
import { createLead } from '../app/commercial.mjs';
import { aiUI } from '../app/static/ai-ui.mjs';
import { activateAssistants } from './ai-inventory-fixture.mjs';

// `activate` يسمّي المساعدين الذين يدخلون الجرد ويُفعَّلون قبل الاختبار، وnull تعني الكل.
// لازمٌ لأن «غير مجرود» = «لا يعمل»: لا يشغّل أحدٌ مساعدًا بلا مالك بشري وتقييم مخاطر معتمد.
function fixture(t,{activate=null}={}){
  const db=openDb(':memory:');seed(db,'synthetic-ai-capabilities');
  t.after(()=>{setProvider(null);db.close();});
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  transaction(db,()=>setAiSettings(db,users.admin,{enabled:true,daily_runs_per_user:20,monthly_cost_cap:'',input_price_per_mtok:'',output_price_per_mtok:'',disabled_assistants:[],reason:'تفعيل اختبارات المساعدات المحلية'}));
  activateAssistants(db,users,activate);
  const run=(who,key,input)=>runAssistant(db,users[who],key,input,transaction);
  return {db,users,run};
}

test('form draft assistant selects an accessible service and returns a sourced completion checklist without a model',async t=>{
  const {db,users,run}=fixture(t);
  const board=aiBoard(db,users.employee);
  assert.ok(board.form_services.some(s=>s.code==='HR-LETTER'));
  const result=await run('employee','form_draft',{description:'أحتاج خطابًا وظيفيًا موجّهًا إلى البنك',service_code:''});
  assert.equal(result.status,'completed');
  assert.equal(result.provider,'retrieval');
  assert.match(result.output,/HR-LETTER/);
  assert.match(result.output,/الغرض من الخطاب/);
  assert.match(result.output,/الجهة الموجه إليها/);
  assert.equal(result.sources[0].type,'service');
  assert.equal(result.sources[0].id,'HR-LETTER');
});

test('handoff checker reads only a commercial case visible to the user and identifies blocking gates deterministically',async t=>{
  const {db,users,run}=fixture(t);
  const lead=transaction(db,()=>createLead(db,users.employee,{name:'عميل تجريبي للتسليم',registration_number:'SYNTH-HANDOFF-1',contact:'جهة اتصال مصطنعة',source:'اختبار',sector:'تقنية'}));
  const board=aiBoard(db,users.employee);
  assert.ok(board.handoff_cases.some(c=>c.id===lead.id));
  const result=await run('employee','handoff_check',{case_id:lead.id});
  assert.equal(result.status,'completed');
  assert.equal(result.provider,'retrieval');
  assert.match(result.output,/غير جاهز للتسليم/);
  assert.match(result.output,/اعتماد التأهيل/);
  assert.match(result.output,/العقد/);
  assert.equal(result.sources[0].type,'commercial_handoff');
  await assert.rejects(run('it','handoff_check',{case_id:lead.id}),error=>error.code==='not_found');
});

test('an external provider cannot bypass the AI inventory, while local deterministic assistants keep working',async t=>{
  // brief_gaps يبقى «مقترحًا» في الجرد بلا تقييم معتمد: هو موضع الاختبار. وform_draft مُفعَّل ليثبت أن المحلي يعمل.
  const {db,users,run}=fixture(t,{activate:['form_draft']});let calls=0;
  setProvider({name:'external-test',model:'model-test',dataPolicy:'synthetic_only',requiresGovernance:true,async complete(){calls++;return {text:'يجب ألا يظهر',input_tokens:1,output_tokens:1,model:'model-test'};}});
  const board=aiBoard(db,users.employee);
  const external=board.assistants.find(a=>a.key==='brief_gaps'),local=board.assistants.find(a=>a.key==='form_draft');
  // كان السبب المعروض هنا سبب صلاحية المزود («غير مسجل في جرد الحوكمة»). صار سبب الجرد نفسه يسبقه
  // لأنه الحاجز الأول وغير المشروط بوجود مزود: أصلٌ بلا تقييم معتمد لا يعمل، بمزود أو بدونه.
  assert.equal(external.available,false);assert.match(external.state,/غير نشط في جرد الحوكمة/);
  // وهو لا يصل المزود أصلًا: الحجب قبل الإرسال، لا بعده.
  await assert.rejects(run('employee','brief_gaps',{text:'محضر اجتماع مصطنع طويل بما يكفي لتجاوز الحد الأدنى للنص المطلوب.'}),error=>error.code==='ai_not_available');
  assert.equal(calls,0,'المساعد المحجوب في الجرد لا تغادر بياناته إلى المزود');
  // والمساعد المحلي المجرود والمُفعَّل يعمل.
  //
  // كان هنا تأكيدان إضافيان: model_available===false وprovider==='retrieval'. وكانا صادقين لسببٍ واحد
  // هو أن لا مساعد مجرودًا أصلًا، فيرفض modelPermission المزود لغياب الأصل. وبعد وصل بوابة الجرد صار
  // «المحلي يعمل» يقتضي أن يكون مجرودًا ومُفعَّلًا — وعندها يصير المزود المشروط بالحوكمة مسموحًا له
  // بحقّ، فلا يجتمع «متاح» مع «لن يستعمل المزود». حُذف التأكيدان لأن ما كان يُثبتهما هو العطب نفسه؛
  // وامتناعُ المزود عن غير المجرود يثبته التأكيد أعلاه، وهو موضع هذا الاختبار.
  assert.equal(local.available,true);
});

test('a synthetic-only provider is not used when the runtime is classified internal',async t=>{
  const before=process.env.AI_RUNTIME_DATA_CLASS;process.env.AI_RUNTIME_DATA_CLASS='internal';
  t.after(()=>{if(before===undefined)delete process.env.AI_RUNTIME_DATA_CLASS;else process.env.AI_RUNTIME_DATA_CLASS=before;});
  const {db,users}=fixture(t);let calls=0;
  setProvider({name:'free-test',model:'model-test',dataPolicy:'synthetic_only',requiresGovernance:false,async complete(){calls++;return {text:'لا يظهر',input_tokens:1,output_tokens:1,model:'model-test'};}});
  const board=aiBoard(db,users.employee),external=board.assistants.find(a=>a.key==='brief_gaps');
  assert.equal(external.available,false);assert.match(external.state,/بيانات مصطنعة فقط/);assert.equal(calls,0);
});

test('handoff assistant does not offer a dead run action when no authorized case exists',()=>{
  const data={is_admin:false,rules:[],runs_today:0,daily_limit:20,runs:[],handoff_cases:[],assistants:[{key:'handoff_check',name:'فحص التسليم',purpose:'فحص البوابات',version:1,needs_model:false,state:'متاح محليًا',available:true}]};
  const html=aiUI.render(data,{e:value=>String(value),button:action=>`<button data-action="${action}">تشغيل</button>`,money:value=>String(value)});
  assert.match(html,/لا يوجد ملف تجاري مصرح لك/);
  assert.doesNotMatch(html,/data-action="run_handoff_check"/);
  assert.throws(()=>aiUI.form('run_handoff_check','',data),/الإجراء غير متاح/);
});
