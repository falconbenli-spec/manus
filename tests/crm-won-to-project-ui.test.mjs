// P4-CRM-2 في الشاشات — الفرصة الرابحة إلى مشروع بلا إعادة إدخال (CRM-09: «لا يتطلب الانتقال إعادة إدخال العميل أو نطاق المخرجات»).
//   • خط الفرص: «فتح صفقة» باسمه ونموذجه (يقرأ ما ينتقل ويرسل نسخة الفرصة بمفتاح التكرار)، والصفقة على بطاقة الفرصة ورابطها،
//     والفوز ينتظر اتفاقها الموثّق، والفرصة الناقصة تقول ناقصها وعند من بدل زرٍّ يرفضه الخادم.
//   • محضر التسليم: المشروع المفتوح من صفقة رابحة يُعرض أولًا بما جاء من الصفقة، ونموذجه يقرأ الحقول المشتقة ويرسل ما لا مصدر له فيها
//     وحده، وما يمنع الحفظ رفضٌ مكتوب قبل الضغط.
// البيانات تجريبية كلها (tests/crm-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import * as projectAxes from '../app/project-axes.mjs';
import { DERIVED_INPUT_FIELDS } from '../app/project-intake.mjs';
import { createProject } from '../app/projects.mjs';
import { pipelineUI } from '../app/static/pipeline-estimates-ui.mjs';
import { handoverUI } from '../app/static/project-intake-ui.mjs';
import { operationFields } from '../app/static/operations.mjs';
import { crmWorld, CLIENT, QUOTE, CONTRACT } from './crm-fixture.mjs';
import { riyadh, e, context, named, cardOf, screens } from './ui-wiring-fixture.mjs';

/* ───── خط الفرص (P4-CRM-2) ───── */
test('pipeline: «فتح صفقة» is named and posts the opportunity version under an idempotency key; the card then names its deal, and «إغلاق رابحة» waits for the agreement on it',async t=>{
  const w=crmWorld(t),{db}=w;
  const oppId=w.opportunity({name:'حملة <b>إطلاق</b> تجريبية & عرض'});
  const {api,submit}=await screens(db,['employee']);
  let data=await pipelineUI.load(api('employee'));
  let card=cardOf(pipelineUI.render(data,context('pipeline')),'حملة &lt;b&gt;إطلاق&lt;/b&gt; تجريبية &amp; عرض');
  assert.ok(card,'the opportunity card is drawn, its name escaped');
  assert.doesNotMatch(card,/<b>إطلاق/,'user text is never drawn as markup');
  assert.deepEqual(named(card,oppId).filter(([a])=>['open_case','close_won','close_lost'].includes(a)),[['close_lost','إغلاق خاسرة'],['open_case','فتح صفقة']],
    'the open_case button has its name, and no «إغلاق رابحة» the server refuses before a contracted deal');
  assert.match(card,/الفوز ينسجّل على اتفاق موثّق/,'where the win comes from is said instead');
  const o=data.opportunities.find(x=>x.id===oppId);
  const spec=pipelineUI.form('open_case',oppId,data);
  assert.equal(spec.endpoint,`/pipeline/opportunities/${oppId}/open_case`);
  assert.equal(spec.idempotent,true,'opening a deal is a creation, so the shell sends an idempotency key');
  assert.ok(spec.fields.every(f=>f.type==='hidden'&&f.required===false),'nothing is typed twice: the form only reads what moves to the deal');
  assert.deepEqual(spec.toPayload(Object.fromEntries(spec.fields.map(f=>[f.name,'']))),{version:o.version});
  const read=spec.fields.map(f=>`${f.label}: ${f.hint}`).join('\n');
  for(const fact of [CLIENT.trade_name,'مدير تسويق تجريبي','2099-11-30','100000.00'])assert.ok(read.includes(fact),fact);
  const rendered=operationFields(spec.fields,e);
  assert.doesNotMatch(rendered,/<select|<textarea|type="(?:text|date|number)"/,'no control to fill');
  assert.match(rendered,/حملة &lt;b&gt;إطلاق&lt;\/b&gt;/,'the read line escapes user text');
  const opened=await submit('employee',spec,{});
  assert.equal(opened.status,201,opened.text);
  // الرد الأول من مساعد التكرار هو ناتج الإنشاء نفسه؛ ومرجع الصفقة المقروء أول ثمانية من معرّفها (dealRef).
  const deal=opened.json(),ref=deal.id.replace(/-/g,'').slice(0,8).toUpperCase();
  assert.equal(w.kase(deal.id).opportunity_id,oppId);
  data=await pipelineUI.load(api('employee'));
  card=cardOf(pipelineUI.render(data,context('pipeline')),'حملة &lt;b&gt;إطلاق&lt;/b&gt; تجريبية &amp; عرض');
  assert.ok(card.includes(`<a href="#commercial?focus=${deal.id}">الصفقة <bdi>${ref}</bdi></a>`),'the card names its deal and leads to it');
  assert.equal(named(card,oppId).some(([a])=>a==='open_case'),false,'a deal opens once');
  assert.equal(named(card,oppId).some(([a])=>a==='close_won'),false);
  assert.match(card,/الفوز بعد ما يتوثّق الاتفاق على صفقتها/);
  // الاتفاق الموثّق: «إغلاق رابحة» يظهر، و«إغلاق خاسرة» يختفي (الخادم يرفضه بـdeal_contracted)، وسند الفوز اختياري.
  w.contract(deal.id);
  data=await pipelineUI.load(api('employee'));
  card=cardOf(pipelineUI.render(data,context('pipeline')),'حملة &lt;b&gt;إطلاق&lt;/b&gt; تجريبية &amp; عرض');
  assert.deepEqual(named(card,oppId).filter(([a])=>['open_case','close_won','close_lost'].includes(a)),[['close_won','إغلاق رابحة']]);
  assert.match(card,/عليها اتفاق موثّق/);
  const win=pipelineUI.form('close_won',oppId,data);
  assert.equal(win.fields.find(f=>f.name==='note').required,false,'the agreement is the evidence; the note is optional');
  assert.deepEqual(win.toPayload({note:''}),{version:data.opportunities.find(x=>x.id===oppId).version},'an empty note is not sent');
  const won=await submit('employee',win,{note:''});
  assert.equal(won.status,201,won.text);
  assert.equal(w.opp(oppId).status,'won');
  assert.ok(verifyAudit(db));
});

test('pipeline: an opportunity the server would refuse to convert shows what it lacks and who completes it, not a live «فتح صفقة»',async t=>{
  const w=crmWorld(t),{db,users}=w;
  const thin=w.opportunity({name:'فرصة تجريبية ناقصة',decision_maker:'',expected_close_on:''});
  const {api}=await screens(db,['employee']);
  const data=await pipelineUI.load(api('employee'));
  const card=cardOf(pipelineUI.render(data,context('pipeline')),'فرصة تجريبية ناقصة');
  assert.ok(data.opportunities.find(o=>o.id===thin).actions.includes('open_case'),'the server lists the action');
  assert.equal(named(card,thin).some(([a])=>a==='open_case'),false,'but it would refuse it (opportunity_incomplete), so no live button');
  for(const text of ['صاحب القرار عند العميل','تاريخ الإغلاق المتوقع',users.employee.name])assert.ok(card.includes(e(text)),text);
  assert.throws(()=>pipelineUI.form('open_case',thin,data),/مو متاح|غير متاح/);
});

/* ───── محضر التسليم المشتق (P4-CRM-2) ───── */
const TERMS={requires_client_po:false,terms:[
  {label:'دفعة تجريبية عند اعتماد الهوية',amount:'46000.00',due_on:'2099-10-15',condition:'عند اعتماد العميل للهوية التجريبية',is_advance:false},
  {label:'دفعة تجريبية عند إطلاق الحملة',amount:'46000.00',due_on:'2099-11-15',condition:'',is_advance:false}]};

test('handover: a project opened from a won deal is listed first with what comes from the deal; its form reads the derived fields and posts only what the deal does not hold',async t=>{
  const w=crmWorld(t),{db,users,tx}=w;
  const won=(name,{quote=QUOTE(),terms=true}={})=>{
    const oppId=w.opportunity({name}),caseId=w.openCase(oppId).id;
    w.act('manager',caseId,'approve_qualification',{note:'الاحتياج والميزانية من الفرصة مراجعان'});
    w.act('employee',caseId,'save_quote',quote);w.act('employee',caseId,'submit_quote');
    w.act('manager',caseId,'approve_quote',{note:'العرض والنطاق والهامش مراجعة'});
    w.act('employee',caseId,'register_contract',CONTRACT);
    if(terms)tx(()=>projectAxes.recordPaymentTerms(db,users.employee,caseId,TERMS));
    w.oppAct('employee',oppId,'win',{});
    w.act('manager',caseId,'create_project',{member_ids:['pm1']});
    return {caseId,projectId:w.kase(caseId).project_id};
  };
  const tagged=QUOTE();tagged.lines[0].description='هوية الحملة <i>التجريبية</i>';
  const main=won('حملة إطلاق تجريبية SYN-7001',{quote:tagged});
  const blocked=won('فرصة تجريبية بلا جدول دفعات',{terms:false});
  const typed=tx(()=>createProject(db,users.manager,{name:'مشروع تجريبي بلا صفقة',brief:'موجز تجريبي لمشروع داخلي',member_ids:['employee','pm1']})).id;
  const {api,submit}=await screens(db,['employee']);
  let data=await handoverUI.load(api('employee'));
  assert.equal(data.sources[main.projectId].derived,true);
  assert.equal(data.sources[typed].derived,false);
  assert.deepEqual(data.sources[blocked.projectId].blockers.map(b=>b.code),['payment_terms_required']);
  let html=handoverUI.render(data,context('project-handover'));
  assert.ok(html.indexOf('<h2>مشاريع من صفقات تنتظر محضر التسليم</h2>')>0,'what awaits the reader has its heading, before any handover card');
  assert.deepEqual(named(html,main.projectId),[['create_handover','إعداد محضر التسليم']]);
  assert.deepEqual(named(html,blocked.projectId),[],'the server would refuse it (payment_terms_required), so no live button');
  assert.ok(html.includes('<div class="vn-alert is-block" role="alert"><strong>ما على الصفقة جدول دفعات'),'the blocker is the written refusal: what, who owns it, next step');
  assert.match(html,/سجّل جدول الدفعات على الصفقة من «العملاء والعروض»/);
  // المشروع بلا صفقة باقٍ على النموذج المكتوب كله، وقائمة مشاريعه بلا المشتق.
  assert.deepEqual(named(html,''),[['create_handover','محضر تسليم جديد']]);
  const typedForm=handoverUI.form('create_handover','',data);
  assert.deepEqual(typedForm.fields.find(f=>f.name==='project_id').options.map(o=>o.value),[typed]);
  assert.ok(['client_id','contract_value','deliverables','payment_terms'].every(name=>typedForm.fields.some(f=>f.name===name)));
  // النموذج المشتق: ما يجي من الصفقة يُقرأ، والمدخل ما لا مصدر له فيها.
  const spec=handoverUI.form('create_handover',main.projectId,data);
  assert.equal(spec.endpoint,'/project-intake/handovers');assert.equal(spec.idempotent,true);
  assert.deepEqual(spec.fields.filter(f=>f.type!=='hidden').map(f=>f.name),['project_manager_id','contract_signed_on','kickoff_planned_on','channels','timeline_start','timeline_end','risks','special_requirements']);
  assert.ok(spec.fields.filter(f=>f.type==='hidden').every(f=>f.required===false),'read lines carry no required mark');
  const read=spec.fields.filter(f=>f.type==='hidden').map(f=>`${f.label}: ${f.hint}`).join('\n');
  for(const fact of ['C-0001','اتفاق الصفقة','العرض المعتمد رقم 1','92000.00','هوية الحملة <i>التجريبية</i>','منشور تجريبي مصمم','2099-10-15','2099-11-15','ممثلة عميل تجريبية','46000.00'])
    assert.ok(read.includes(fact),fact);
  assert.ok(spec.fields.find(f=>f.name==='project_manager_id').options.some(o=>o.value==='pm1'));
  assert.match(spec.fields.find(f=>f.name==='timeline_start').hint,/2099-10-15.*2099-11-15/,'the timeline must hold the agreed dates');
  const rendered=operationFields(spec.fields,e);
  assert.ok(rendered.includes('هوية الحملة &lt;i&gt;التجريبية&lt;/i&gt;')&&!rendered.includes('<i>التجريبية'),'derived text is escaped');
  for(const name of ['client_id','contract_reference','contract_value','advance','services','deliverables','milestones','client_contacts','payment_terms'])
    assert.ok(!rendered.includes(`name="${name}"`)&&!rendered.includes(`data-rows="${name}"`),`${name} is not an input to retype`);
  const values={...Object.fromEntries(spec.fields.map(f=>[f.name,''])),project_manager_id:'pm1',contract_signed_on:riyadh(-1),channels:'البريد الرسمي وقناة المشروع التجريبية',
    timeline_start:riyadh(),timeline_end:'2099-12-31'};
  const payload=spec.toPayload(values);
  assert.equal(payload.project_id,main.projectId);
  assert.deepEqual(Object.keys(payload).filter(key=>!DERIVED_INPUT_FIELDS.includes(key)),[],'only what the deal does not hold is posted');
  const saved=await submit('employee',spec,values);
  assert.equal(saved.status,201,saved.text);
  const row=db.prepare('SELECT * FROM project_handovers WHERE id=?').get(saved.json().id);
  assert.match(row.contract_reference,/العرض المعتمد رقم 1/);
  assert.deepEqual(JSON.parse(row.services),['هوية الحملة <i>التجريبية</i>','منشور تجريبي مصمم']);
  data=await handoverUI.load(api('employee'));
  html=handoverUI.render(data,context('project-handover'));
  assert.deepEqual(named(html,main.projectId),[],'a handover exists: nothing awaits on that project');
  assert.ok(cardOf(html,'حملة إطلاق تجريبية SYN-7001')||html.includes(e(CLIENT.trade_name)),'the handover card is drawn');
  assert.ok(verifyAudit(db));
});
