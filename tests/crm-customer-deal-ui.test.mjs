// P4-CRM-1 في الشاشات — العميل غير الصفقة: ما وصّله الخادم (الترحيل 180) يُرسم ويعمل، ولا زرّ يرفضه الخادم.
//   • العملاء والعروض: إغلاق الصفقة خاسرة وسحبها بسبب من قائمة أسباب الخسارة المُدارة ودرس مكتوب (CRM-10)، والمقفلة بشكلها وكلمتها،
//     وبلا قائمة سارية لا يُرسم الزرّان ويُقال من يضيف الأسباب.
//   • عملائي: رقم السجل على الملف، يسجّله مسؤول الحساب ويثبت بعد أول صفقة، وفحص التكرار من الخادم أثناء الكتابة بلهجة واضحة
//     (CRM-01: «إنشاء جهة برقم سجل مكرر يعرض تعارضًا قبل الحفظ»).
// البيانات تجريبية كلها (tests/crm-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAudit } from '../app/db.mjs';
import * as agency from '../app/agency.mjs';
import * as commercial from '../app/commercial.mjs';
import * as pipeline from '../app/pipeline-estimates.mjs';
import { pipelineUI } from '../app/static/pipeline-estimates-ui.mjs';
import { commercialUI } from '../app/static/commercial-ui.mjs';
import * as agencyUI from '../app/static/agency-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { crmWorld, CLIENT } from './crm-fixture.mjs';
import { e, context, buttonsOf, named, cardOf, panelOf, errorOf, screens } from './ui-wiring-fixture.mjs';

/* ───── العملاء والعروض (P4-CRM-1) ───── */
test('commercial: a deal before its agreement closes lost or is withdrawn with a reason from the managed list and a written lesson; the closed deal reads as such by shape and word',async t=>{
  const w=crmWorld(t),{db,users,client,reasons}=w;
  const lead=w.tx(()=>commercial.createLead(db,users.employee,{client_id:client,source:'زيارة تجريبية'})).id;
  const oppId=w.opportunity({name:'فرصة تجريبية تُسحب صفقتها'}),fromOpp=w.openCase(oppId).id;
  const {api,submit}=await screens(db,['employee','manager']);
  let data=await commercialUI.load(api('employee'));
  assert.deepEqual(data.loss_reasons.map(r=>r.name).sort(),['السعر أعلى من المنافس','لا طاقة لدينا في الموعد'].sort(),'the active list the pipeline owner manages');
  let html=commercialUI.render(data,context('commercial'));
  assert.deepEqual(named(panelOf(html,lead),lead).filter(([a])=>['close_lost','withdraw'].includes(a)),[['close_lost','إغلاق الصفقة خاسرة'],['withdraw','سحب الصفقة']]);
  const spec=commercialUI.form('close_lost',lead,data);
  assert.equal(spec.endpoint,`/commercial/${lead}/close_lost`);
  assert.deepEqual(spec.fields.map(f=>[f.name,f.type,f.required!==false]),[['reason_id','select',true],['comment','textarea',true]]);
  assert.deepEqual(spec.fields[0].options.map(o=>o.value).sort(),[reasons.price,reasons.capacity].sort());
  const lesson='اختار العميل عرضًا أرخص <img src=x onerror=alert(1)> ونتعلم نوضّح القيمة قبل السعر';
  const version=data.rows.find(r=>r.id===lead).version;
  assert.deepEqual(spec.toPayload({reason_id:reasons.price,comment:lesson}),{version,reason_id:reasons.price,comment:lesson});
  const lost=await submit('employee',spec,{reason_id:reasons.price,comment:lesson});
  assert.equal(lost.status,201,lost.text);
  // السحب على صفقة فرصة: الفرصة تنقفل خاسرة معها بالسبب نفسه.
  data=await commercialUI.load(api('employee'));
  const withdraw=commercialUI.form('withdraw',fromOpp,data);
  assert.equal(withdraw.endpoint,`/commercial/${fromOpp}/withdraw`);
  const withdrawn=await submit('employee',withdraw,{reason_id:reasons.capacity,comment:'ما عندنا طاقة تجريبية في موعد العميل'});
  assert.equal(withdrawn.status,201,withdrawn.text);
  data=await commercialUI.load(api('employee'));
  html=commercialUI.render(data,context('commercial'));
  const closed=panelOf(html,lead),pulled=panelOf(html,fromOpp);
  assert.match(closed,/<span class="badge lost">خسرناها<\/span>/,'lost: the stop shape and its word');
  assert.match(pulled,/<span class="badge withdrawn">سحبناها<\/span>/,'withdrawn: the idle shape and its word');
  assert.match(closed,/<dt>سبب الخسارة<\/dt><dd>السعر أعلى من المنافس<\/dd>/);
  assert.match(pulled,/<dt>سبب السحب<\/dt><dd>لا طاقة لدينا في الموعد<\/dd>/);
  assert.ok(closed.includes(e(lesson))&&!closed.includes('<img src=x'),'the lesson is escaped');
  assert.match(closed,/<dt>انقفلت<\/dt><dd><time datetime="\d{4}-\d{2}-\d{2}">/);
  assert.equal(buttonsOf(closed).length+buttonsOf(pulled).length,0,'a closed deal is final: no button');
  assert.doesNotMatch(closed+pulled,/ما عليك خطوة/,'the closure says what happened instead');
  assert.equal(w.opp(oppId).status,'lost');
  assert.match(cardOf(pipelineUI.render(await pipelineUI.load(api('employee')),context('pipeline')),'فرصة تجريبية تُسحب صفقتها'),/لا طاقة لدينا في الموعد/,'the opportunity closed with the same reason');
  // المدير المباشر يقرأ الملف ولا يغلقه: الخادم لا يعرض عليه الإغلاق.
  const team=await commercialUI.load(api('manager'));
  assert.equal(buttonsOf(commercialUI.render(team,context('commercial'))).some(b=>['close_lost','withdraw'].includes(b.action)),false);
  assert.throws(()=>commercialUI.form('close_lost',lead,team),/غير متاح/);
  assert.ok(verifyAudit(db));
});

test('commercial: with no active loss reason the close buttons are not drawn — the screen says who adds the reasons',async t=>{
  const w=crmWorld(t),{db,users,client,reasons}=w;
  for(const id of Object.values(reasons))w.tx(()=>pipeline.lossReasonAction(db,users.employee,id,'deactivate_reason',{version:db.prepare('SELECT version FROM pipeline_loss_reasons WHERE id=?').get(id).version}));
  const lead=w.tx(()=>commercial.createLead(db,users.employee,{client_id:client,source:'زيارة تجريبية'})).id;
  const {api}=await screens(db,['employee']);
  const data=await commercialUI.load(api('employee'));
  assert.deepEqual(data.loss_reasons,[]);
  const panel=panelOf(commercialUI.render(data,context('commercial')),lead);
  assert.ok(data.rows.find(r=>r.id===lead).allowed_actions.includes('close_lost'),'the server lists the action');
  assert.equal(buttonsOf(panel).some(b=>['close_lost','withdraw'].includes(b.action)),false,'but refuses it without a reason (loss_reason_required)');
  assert.match(panel,/ما فيه أسباب خسارة سارية/);
  assert.match(panel,/«خط الفرص»/);
  assert.throws(()=>commercialUI.form('close_lost',lead,data),/أسباب خسارة/);
});

/* ───── عملائي: رقم السجل والتعارض (P4-CRM-1) ───── */
// نموذج حي صغير بلا متصفح: حقول بقيمها ومستمعيها، وصندوق يُلحق بعد شبكة الحقول، وزر حفظ. يكفي لما يلمسه watchConflicts.
function liveForm(names){
  const listeners={},after=[];
  const node=tag=>({tag,className:'',attrs:{},children:[],textContent:'',
    setAttribute(key,value){this.attrs[key]=String(value);},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    text(){return [this.textContent,...this.children.map(c=>typeof c==='string'?c:c.text())].filter(Boolean).join(' ');}});
  const submit={disabled:false},grid={after(box){after.push(box);}};
  const elements=Object.fromEntries(names.map(name=>[name,{value:'',addEventListener(type,fn){(listeners[`${name}:${type}`]??=[]).push(fn);}}]));
  const form={ownerDocument:{createElement:node},elements,querySelector:selector=>selector==='.form-grid'?grid:selector.startsWith('button')?submit:null};
  return {form,submit,box:()=>after[0],listens:(name,type)=>!!listeners[`${name}:${type}`]?.length,
    async change(name,value){elements[name].value=value;await Promise.all((listeners[`${name}:change`]??[]).map(fn=>fn()));}};
}

test('clients: the registration number sits on the file — recorded by the account owner until a deal carries it — and the create form asks the server about duplicates while it is filled',async t=>{
  const w=crmWorld(t),{db,users,client}=w;
  const sister=w.tx(()=>agency.createClient(db,users.outsider,{legal_name:'مؤسسة الأفق التجريبية للتجزئة',sector:'التجزئة',status:'prospect',registration_number:'7001700999'})).id;
  const {api,submit}=await screens(db,['outsider','employee']);
  const clients=agencyUI.clientsUI,load=who=>clients.load(api(who));
  let data=await load('outsider');
  let card=cardOf(clients.render(data,context('clients')),'<bdi>C-0001</bdi>');
  assert.match(card,/رقم السجل: <bdi>7001700170<\/bdi>/);
  assert.deepEqual(named(card,client).filter(([a])=>a==='set_registration'),[['set_registration','تصحيح رقم السجل']]);
  // عضو الفريق يقرأ الرقم ولا يسجّله: المالك وحده.
  const memberCard=cardOf(clients.render(await load('employee'),context('clients')),'<bdi>C-0001</bdi>');
  assert.match(memberCard,/<bdi>7001700170<\/bdi>/);
  assert.equal(named(memberCard,client).some(([a])=>a==='set_registration'),false);
  // نموذج الملف الجديد: رقم السجل اختياري، وفحص التكرار يبدأ لما ينفتح النموذج.
  const create=clients.form('create_client','',data);
  const registration=create.fields.find(f=>f.name==='registration_number');
  assert.equal(registration?.required,false);
  assert.equal(typeof create.opened,'function');
  // القارئ نفسه: اسم ملفٍ خارج فريق السائل لا يُكشف، ورمزه ومسؤوله يُذكران.
  const answer=await api('employee')('/clients/conflicts?'+new URLSearchParams({legal_name:'شركه الافق التجريبيه للتجزئه'}));
  const notice=agencyUI.clientConflictNotice(answer);
  assert.equal(notice.blocking,true);
  assert.deepEqual(notice.items.map(i=>i.code),['C-0001','C-0002']);
  assert.match(notice.items[0].text,new RegExp(`«${CLIENT.legal_name}».*مسؤوله: ${users.outsider.name}`));
  assert.ok(!notice.items[1].text.includes('مؤسسة الأفق'),'a file outside the reader’s team keeps its name');
  assert.match(notice.items[1].text,new RegExp(`مسؤوله: ${users.outsider.name}`));
  assert.match(notice.next,/افتح الملف القائم/);
  // أثناء الكتابة: الخادم يُسأل، والجواب في صندوق حالة، والحفظ موقوف ما دام فيه تعارض.
  const live=liveForm(['legal_name','trade_name','registration_number']);
  create.opened(live.form);
  const box=live.box();
  assert.equal(box.attrs.role,'status');assert.equal(box.attrs['aria-live'],'polite');
  assert.ok(live.listens('legal_name','input')&&live.listens('registration_number','change'));
  await live.change('legal_name','الأفق التجريبية للتجزئة');
  assert.match(box.text(),/لنفس الجهة، فما ينفتح ملف ثاني/);
  assert.match(box.text(),/C-0001/);
  assert.equal(live.submit.disabled,true,'the server would refuse duplicate_client');
  await live.change('registration_number','7001700555');
  assert.match(box.text(),/ما لقينا ملف عميل ثاني/,'a different known registration number proves a different entity');
  assert.equal(live.submit.disabled,false);
  await live.change('registration_number','ABC$');
  assert.match(box.text(),/رقم السجل «ABC\$» مو بالشكل المعتمد/,'the server’s written refusal, in its words');
  assert.equal(live.submit.disabled,false);
  // الحفظ يسأل مرة ثانية: الرفض المكتوب يُرسم بـui.refusal كما يرسمه الغلاف.
  const values=over=>({legal_name:'',trade_name:'',sector:'التجزئة',status:'prospect',notes:'',registration_number:'',...over});
  const duplicate=await submit('outsider',create,values({legal_name:'شركة الأُفُق التجريبيـة للتجزئة'}));
  assert.equal(duplicate.status,409);
  const refusal=kit(e).refusal(errorOf(duplicate));
  assert.match(refusal,/role="alert"/);assert.match(refusal,/C-0001/);
  const made=await submit('outsider',create,values({legal_name:'جهة تجريبية جديدة للحملات',registration_number:'٧٠٠٥ ٧٠٠ ٥٧٠'}));
  assert.equal(made.status,201,made.text);
  data=await load('outsider');
  assert.match(clients.render(data,context('clients')),/رقم السجل: <bdi>7005700570<\/bdi>/,'normalised by the server, isolated on screen');
  // تصحيح الرقم: مساره /registration، والرقم المكرر يُرفض، والصحيح يُحفظ مطبَّعًا.
  const fix=clients.form('set_registration',sister,data);
  assert.equal(fix.endpoint,`/clients/${sister}/registration`);
  assert.deepEqual(fix.fields.map(f=>[f.name,f.value]),[['registration_number','7001700999']]);
  assert.equal(typeof fix.opened,'function');
  const own=liveForm(['registration_number']);fix.opened(own.form);
  await own.change('registration_number','7001700999');
  assert.match(own.box().text(),/ما لقينا ملف عميل ثاني/,'the file itself is not its own duplicate');
  assert.equal((await submit('outsider',fix,{registration_number:'7001700170'})).status,409);
  const saved=await submit('outsider',fix,{registration_number:' 7006-700670 '});
  assert.equal(saved.status,201,saved.text);
  // بعد أول صفقة يثبت الرقم: لا زرّ يرفضه الخادم (registration_fixed)، وسطرٌ يقول ليش.
  w.tx(()=>commercial.createLead(db,users.employee,{client_id:client,source:'زيارة تجريبية'}));
  data=await load('outsider');
  card=cardOf(clients.render(data,context('clients')),'<bdi>C-0001</bdi>');
  assert.equal(named(card,client).some(([a])=>a==='set_registration'),false);
  assert.match(card,/ثابت: عليه صفقات انفتحت به/);
  assert.throws(()=>clients.form('set_registration',client,data),/غير متاح/);
  assert.ok(verifyAudit(db));
});
