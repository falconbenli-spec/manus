import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction, verifyAudit } from '../app/db.mjs';
import { pricingBoard, quotationAction, quotationRecord, createQuotation } from '../app/pricing.mjs';
import { pipelineBoard, createOpportunity, opportunityAction } from '../app/pipeline-estimates.mjs';
import { clientsBoard, createClient, clientAction } from '../app/agency.mjs';
import { refreshIndex, searchAll } from '../app/search.mjs';
import { project, clean, forTransition, saveValues, valueHistory, columnsFor, exportRows, withhold, toCoreField, searchText, optionUsage } from '../app/custom-fields.mjs';
import { validatePayload } from '../app/validation.mjs';
import { looksLikeNationalId } from '../app/pii.mjs';
import { validateForm } from '../app/forms.mjs';
import { rollbackTo } from '../app/definitions.mjs';
import { createApp } from '../app/server.mjs';
import { fixture, code, caught, riyadh, approvedSheet, LEAD_SOURCE, GOVERNING_SPEC, MASKED_NOTE, CANARY, sessionsFor, workbookText } from './definitions-fixture.mjs';
// الفوز صار يشترط صفقة متعاقدًا عليها مفتوحة من الفرصة (الحزمة 4، الترحيل 181): المساعد يفتحها ويوصلها إلى اتفاق موثّق.
import { contractedDealFor } from './crm-fixture.mjs';

// بيانات تجريبية مصطنعة بالكامل. قيم الحقول المخصّصة تُحكم بالتعريف المنشور وحده، والحجب والإلزام عند الانتقال حكم الخادم.
const QUOTE='client_quotation';
const RICH={fields:[LEAD_SOURCE,
  {key:'event_name',label:{ar:'اسم الفعالية'},type:'text',required:false,min_length:3,max_length:40,show_when:{field:'lead_source',equals:['event']}},
  {key:'campaign_code',label:{ar:'رمز الحملة'},type:'text',required:false,pattern:'^CMP-[0-9]{3}$',pattern_message:'الرمز بصيغة CMP- ثم ثلاثة أرقام'},
  {key:'seats',label:{ar:'عدد المقاعد'},type:'number',required:false,min:1,max:500},
  {key:'kickoff_on',label:{ar:'موعد الانطلاق'},type:'date',required:false},
  {key:'channels',label:{ar:'القنوات المطلوبة'},type:'checks',required:false,options:[{value:'social',label:{ar:'قنوات التواصل'}},{value:'outdoor',label:{ar:'إعلانات الطرق'}},{value:'radio',label:{ar:'إذاعة'}}]},
  {key:'brief',label:{ar:'ملخص الطلب'},type:'textarea',required:false}]};
const values=(db,table,id)=>JSON.parse(db.prepare(`SELECT custom_fields FROM ${table} WHERE id=?`).get(id).custom_fields);

test('custom fields: one validator judges them — the stored definition is the service-field shape plus «checks», adapted once for the platform’s existing validators',t=>{
  const {db,users,tx,publish,quote,quotationRow}=fixture(t);
  publish(QUOTE,RICH);
  const save=input=>tx(()=>saveValues(db,users.employee,QUOTE,quote,{version:quotationRow().version,values:input}));
  // المحوّل يعطي شكل الحقل الذي يقرؤه validatePayload وvalidateForm كما هو: لا محقّق ثانٍ للحقول المخصّصة.
  const core=RICH.fields.map(f=>toCoreField(f));
  assert.deepEqual(core[0],{key:'lead_source',label:'مصدر الفرصة',type:'select',required:false,options:['referral','event','inbound']});
  assert.deepEqual(validatePayload(core.filter(f=>f.type!=='checks'),{lead_source:'event',seats:'12'},false),{lead_source:'event',seats:'12'});
  assert.deepEqual(validateForm({sections:[{key:'s',title:'قسم',owner:'مالك',fields:core}]},{channels:['radio']}).clean,{channels:['radio']});
  for(const [input,expected,what] of [
    [{lead_source:'word_of_mouth'},'invalid_option','خيار خارج القائمة'],[{seats:'اثنا عشر'},'invalid_number','رقم غير صالح'],[{seats:'900'},'out_of_range','فوق الحد الأعلى'],
    [{kickoff_on:'2026-13-40'},'invalid_date','تاريخ غير صالح'],[{channels:['tv']},'invalid_option','بند خارج القائمة'],[{channels:'social'},'invalid_option','الاختيار المتعدد قائمة'],
    [{campaign_code:'حملة'},'invalid_format','صيغة'],[{brief:42},'invalid_text','نص لا رقم'],[{unknown_key:'x'},'unknown_custom_field','مفتاح مخترَع'],['text','invalid_fields','ليس كائنًا']])
    assert.throws(()=>save(input),code(expected),what);
  assert.match(caught(()=>save({campaign_code:'حملة'})).message,/CMP- ثم ثلاثة أرقام/,'رسالة الصيغة تقول ما الصواب');
  assert.deepEqual(values(db,'client_quotations',quote),{},'رفض واحد لا يحفظ شيئًا');
  save({lead_source:'event',event_name:'معرض تجريبي',campaign_code:'CMP-204',seats:'120',kickoff_on:'2026-10-01',channels:['social','radio'],brief:'  ملخص تجريبي  '});
  assert.deepEqual(values(db,'client_quotations',quote),{lead_source:'event',event_name:'معرض تجريبي',campaign_code:'CMP-204',seats:'120',kickoff_on:'2026-10-01',channels:['social','radio'],brief:'ملخص تجريبي'});
  const items=Object.fromEntries(pricingBoard(db,users.employee).quotations[0].custom.map(i=>[i.key,i.text]));
  assert.equal(items.channels,'قنوات التواصل، إذاعة');assert.equal(items.lead_source,'فعالية أو معرض');
  // شرط الظهور: قيمة معلّقة على شرط لم يعد متحققًا تخرج من السجل، ولا تُقبل وشرطها غير متحقق ولو أرسلتها الواجهة.
  save({lead_source:'referral'});
  assert.equal(values(db,'client_quotations',quote).event_name,undefined);
  assert.ok(!pricingBoard(db,users.employee).quotations[0].custom.some(i=>i.key==='event_name'),'حقل أخفاه شرطه لا يُعرض حتى «غير متاح»');
  save({event_name:'فعالية بلا شرطها'});assert.equal(values(db,'client_quotations',quote).event_name,undefined);
  // التفريغ يحذف المفتاح، وما لم يتغير لا يتقدّم به السجل نسخة.
  save({seats:'',channels:[]});assert.deepEqual(Object.keys(values(db,'client_quotations',quote)).sort(),['brief','campaign_code','kickoff_on','lead_source']);
  const version=quotationRow().version;assert.deepEqual(save({brief:'ملخص تجريبي'}).changed,[]);assert.equal(quotationRow().version,version);
  assert.throws(()=>tx(()=>saveValues(db,users.employee,QUOTE,quote,{version:1,values:{brief:'نسخة قديمة'}})),code('stale_version'));
  assert.ok(verifyAudit(db));
});

test('custom fields: required-on-transition is the server’s judgement — the refusal names the field, the transition, its owner and the next step, and a request that skips the screen gets the same answer',async t=>{
  const {db,users,tx,publish,quote,quotationRow}=fixture(t);
  publish(QUOTE,GOVERNING_SPEC);
  const issue=(extra={})=>tx(()=>quotationAction(db,users.employee,quote,'issue',{version:quotationRow().version,note:'',...extra}));
  const refused=caught(()=>issue()),refusal=refused.details.refusal;
  assert.equal(refused.status,409);assert.equal(refused.code,'required_on_transition');
  assert.equal(refusal.what,'لا يُنفَّذ «إصدار العرض للعميل» على عرض السعر QT-0001 قبل استكمال حقوله الإلزامية عند هذا الانتقال');
  assert.deepEqual(refusal.missing,[{document:'مصدر الفرصة',why:'إلزامي عند «إصدار العرض للعميل» بحسب تعريف الصفحة، النسخة 1',owner:'معدّ العرض — حامل تصريح تسعير المشاريع',owner_role:'pm',doc_key:'lead_source'}]);
  assert.equal(refusal.next,'افتح عرض السعر QT-0001 وأكمل «مصدر الفرصة» ثم أعد «إصدار العرض للعميل»');assert.equal(refusal.link,`#quotations?focus=${quote}`);
  assert.equal(quotationRow().status,'draft');
  // المسار نفسه، بطلب مباشر لا يمر بالشاشة: الرفض نفسه بتفصيله المهيكل، والقيمة داخل طلب الإصدار تمرّره.
  const {call}=await sessionsFor(createApp(db),['employee']);
  const direct=(await call('employee',`/pricing/quotations/${quote}/issue`,{version:quotationRow().version,note:''},409)).json();
  assert.equal(direct.error.code,'required_on_transition');assert.equal(direct.error.details.refusal.missing[0].document,'مصدر الفرصة');
  await call('employee',`/pricing/quotations/${quote}/issue`,{version:quotationRow().version,note:'',custom_fields:{lead_source:'not-an-option'}},400);
  assert.equal(quotationRow().status,'draft','قيمة مرفوضة لا تُصدر العرض');
  await call('employee',`/pricing/quotations/${quote}/issue`,{version:quotationRow().version,note:'',custom_fields:{lead_source:'inbound'}},201);
  // الانتقال وقيمه جملة واحدة: نسخة واحدة تقدّمت، والقيمة والحالة كُتبتا معًا.
  const row=quotationRow();assert.equal(row.status,'issued');assert.deepEqual(JSON.parse(row.custom_fields),{lead_source:'inbound'});
  assert.equal(pricingBoard(db,users.employee).quotations[0].status_name,'مُرسل');
  // حدث التدقيق يسجّل أي نسخة تعريف حكمت الانتقال.
  assert.equal(JSON.parse(db.prepare("SELECT after_json FROM audit_events WHERE action='quotation.issued'").get().after_json).definition_version,1);
  // تخفيف الإلزام لا ينشره من أعدّه؛ وبعد أن يُرفع بشخصين يمر إصدار بلا الحقل.
  const secondSheet=approvedSheet(db,users,quotationRow().client_id,{name:'مشروع تجريبي ثانٍ'});
  const second=tx(()=>createQuotation(db,users.employee,secondSheet,{valid_until:riyadh(30),note:''})).id;
  assert.throws(()=>tx(()=>quotationAction(db,users.employee,second,'issue',{version:db.prepare('SELECT version FROM client_quotations WHERE id=?').get(second).version,note:''})),code('required_on_transition'));
  publish(QUOTE,{...GOVERNING_SPEC,transitions:{}},{by:users.employee,publisher:users.manager});
  tx(()=>quotationAction(db,users.employee,second,'issue',{version:db.prepare('SELECT version FROM client_quotations WHERE id=?').get(second).version,note:''}));
  assert.equal(db.prepare('SELECT status FROM client_quotations WHERE id=?').get(second).status,'issued');
  assert.ok(verifyAudit(db));
});

test('custom fields: the registry extends the platform’s own stage gate — a required custom field joins the data-defined stage requirements in one refusal',t=>{
  const {db,users,tx,publish,opportunity,row}=fixture(t,{quotation:false});
  publish('opportunity',{fields:[LEAD_SOURCE,{...LEAD_SOURCE,key:'closing_channel',label:{ar:'قناة الإغلاق'}}],transitions:{move:{require:['lead_source']},win:{require:['closing_channel']}}});
  const act=(action,input)=>tx(()=>opportunityAction(db,users.employee,opportunity,action,{version:row('opportunities',opportunity).version,...input}));
  // المرحلة PROPOSED تشترط «صاحب القرار» بياناتٍ معتمدة، والتعريف يُلزم «مصدر الفرصة» عند النقل: رفض واحد يسمّي الاثنين.
  const refused=caught(()=>act('move',{stage_code:'PROPOSED',note:''}));
  assert.equal(refused.code,'stage_requirements');assert.equal(refused.status,409);
  assert.deepEqual(refused.details.refusal.missing.map(m=>m.document),['صاحب القرار لدى العميل مسجّل','مصدر الفرصة']);
  assert.match(refused.details.refusal.missing[1].why,/إلزامي عند «نقل الفرصة إلى مرحلة» بحسب تعريف الصفحة، النسخة 1/);
  act('edit',{name:'فرصة تجريبية لحملة إطلاق',service_family:'campaigns',value:'100000.00',expected_close_on:'',decision_maker:'مدير تسويق تجريبي',budget_note:'',next_step:'',next_step_on:'',custom_fields:{lead_source:'event'}});
  assert.deepEqual(values(db,'opportunities',opportunity),{lead_source:'event'},'«تعديل البيانات» يحمل الحقول المخصّصة في UPDATE نفسها');
  act('move',{stage_code:'PROPOSED',note:''});
  assert.equal(row('opportunities',opportunity).stage_code,'PROPOSED');
  contractedDealFor(db,users,opportunity);
  assert.throws(()=>act('win',{note:'موافقة العميل التجريبية'}),code('required_on_transition'));
  act('win',{note:'موافقة العميل التجريبية',custom_fields:{closing_channel:'referral'}});
  assert.deepEqual(values(db,'opportunities',opportunity),{lead_source:'event',closing_channel:'referral'});
  // الفرصة المغلقة نهائية: زناد الجدول يحكم العمود الجديد، والحفظ العام يرفض قبله برفض مكتوب.
  assert.throws(()=>tx(()=>saveValues(db,users.employee,'opportunity',opportunity,{version:row('opportunities',opportunity).version,values:{lead_source:'inbound'}})),code('record_final'));
  assert.equal(pipelineBoard(db,users.employee).opportunities[0].custom.find(i=>i.key==='lead_source').editable,false);
  // العميل: تغيير الحالة انتقاله الوحيد، وينفّذه مسؤول الحساب بملكيته.
  publish('client',{fields:[{key:'pause_reason',label:{ar:'سبب التوقف'},type:'text',required:false}],transitions:{set_status:{require:['pause_reason']}}});
  const client=row('opportunities',opportunity).client_id;
  assert.throws(()=>tx(()=>clientAction(db,users.employee,client,'set_status',{status:'paused',note:'توقف تجريبي مؤقت'})),code('required_on_transition'));
  tx(()=>clientAction(db,users.employee,client,'set_status',{status:'paused',note:'توقف تجريبي مؤقت',custom_fields:{pause_reason:'مراجعة العقد السنوية'}}));
  assert.equal(clientsBoard(db,users.employee).clients[0].custom[0].text,'مراجعة العقد السنوية');
  assert.ok(verifyAudit(db));
});

test('custom fields: a field marked required is demanded when a record is created and whenever its custom values are entered, for whoever may edit it',t=>{
  const {db,users,tx,publish,client}=fixture(t,{quotation:false});
  publish('client',{fields:[{key:'segment',label:{ar:'شريحة العميل'},type:'select',required:true,options:[{value:'enterprise',label:{ar:'منشآت كبرى'}},{value:'sme',label:{ar:'منشآت صغيرة ومتوسطة'}}]}]});
  const create=extra=>tx(()=>createClient(db,users.employee,{legal_name:'جهة تجريبية للصحة',sector:'الصحة',status:'prospect',...extra}));
  const refused=caught(()=>create({}));
  assert.equal(refused.code,'missing_field');assert.deepEqual(refused.details.refusal.missing.map(m=>[m.document,m.doc_key]),[['شريحة العميل','segment']]);
  assert.match(refused.details.refusal.next,/أكمل «شريحة العميل»/);
  const created=create({custom_fields:{segment:'sme'}}).id;
  assert.deepEqual(values(db,'clients',created),{segment:'sme'});
  // سجل أقدم من الحقل لا يُمنع تعديل بقية بياناته، ويُطالَب بالحقل حين تُدخل قيمه المخصّصة.
  assert.throws(()=>tx(()=>saveValues(db,users.employee,'client',client,{version:db.prepare('SELECT version FROM clients WHERE id=?').get(client).version,values:{}})),code('missing_field'));
  tx(()=>clientAction(db,users.employee,client,'add_brand',{name:'علامة تجريبية',guideline_reference:''}));
  assert.equal(clientsBoard(db,users.employee).clients.find(c=>c.id===client).custom[0].kind,'unavailable');
});

test('custom fields: a masked field is absent for a reader who may not see it — through the function, the route, the list columns, the export, the search index and the value history',async t=>{
  const {db,users,tx,publish,quote,client,quotationRow}=fixture(t);
  publish(QUOTE,{fields:[LEAD_SOURCE,MASKED_NOTE],layout:{slots:{header:['lead_source','internal_note']}},views:{list:{columns:['lead_source','internal_note']}}});
  publish('client',{fields:[MASKED_NOTE,{key:'segment',label:{ar:'شريحة العميل'},type:'text',required:false,searchable:true}]});
  // المدير يحمل profitability.view فيكتب القيمة؛ outsider عضو في فريق الحساب بلا ذلك التصريح.
  tx(()=>saveValues(db,users.manager,QUOTE,quote,{version:quotationRow().version,values:{lead_source:'event',internal_note:CANARY}}));
  tx(()=>saveValues(db,users.manager,'client',client,{version:db.prepare('SELECT version FROM clients WHERE id=?').get(client).version,values:{internal_note:CANARY,segment:'منشآت التجزئة الكبرى'}}));
  // (1) الدالة: الكائن المحجوب يحل محل العمود الخام، فلا يحمل {...row} القيمة.
  const raw=quotationRow();assert.ok(raw.custom_fields.includes(CANARY),'القيمة في القاعدة');
  const seen=project(db,users.manager,QUOTE,raw),hidden=project(db,users.outsider,QUOTE,raw);
  assert.equal(seen.custom_fields.internal_note,CANARY);assert.deepEqual(hidden.custom_fields,{lead_source:'event'});
  assert.deepEqual(hidden.custom.map(i=>i.key),['lead_source']);assert.ok(!JSON.stringify({...raw,...hidden}).includes(CANARY));
  assert.deepEqual(columnsFor(db,users.outsider,QUOTE).map(c=>c.field_key),['lead_source']);assert.deepEqual(columnsFor(db,users.manager,QUOTE).map(c=>c.field_key),['lead_source','internal_note']);
  // (2) المسارات: لا مخرج واحد يحمل الكناري أو اسم الحقل لغير المخوَّل؛ والمخوَّل يراه.
  const {call}=await sessionsFor(createApp(db),['outsider','manager']);
  await tx(()=>refreshIndex(db,users.outsider,{explicit:true,maxAgeMs:0}));
  for(const path of ['/pricing','/pipeline','/clients',`/pricing/quotations/${quote}/record`,'/definitions/snapshot',
    `/records/${QUOTE}/${quote}/custom-fields/history`,`/records/client/${client}/custom-fields/history`]){
    const body=(await call('outsider',path,undefined,200)).text;
    assert.ok(!body.includes(CANARY),`${path}: قيمة الحقل المحجوب وصلت`);assert.ok(!body.includes('ملاحظة داخلية للإدارة')&&!body.includes('internal_note'),`${path}: اسم الحقل المحجوب وصل`);
  }
  // البحث يردّ نص الاستعلام نفسه، فيُحكم على نتائجه لا على جسم الرد: لا سجل يُعثر عليه بقيمة محجوبة.
  for(const q of ['كناري',CANARY]){const found=(await call('outsider','/search?q='+encodeURIComponent(q),undefined,200)).json();assert.equal(found.total,0,q);assert.ok(!JSON.stringify(found.groups??found.results??[]).includes(CANARY));}
  assert.ok((await call('manager','/pricing',undefined,200)).text.includes(CANARY),'المخوَّل يراها');
  // (3) التصدير: العمود المحجوب ساقط من الملف، لا خانة فارغة فيه.
  for(const entity of [QUOTE,'client']){
    const file=await call('outsider',`/records/${entity}/export.xlsx`,undefined,200),cells=workbookText(file.buffer);
    assert.ok(!cells.includes(CANARY)&&!cells.includes('ملاحظة داخلية للإدارة'),`${entity}: التصدير`);
    assert.ok(workbookText((await call('manager',`/records/${entity}/export.xlsx`,undefined,200)).buffer).includes(CANARY));
  }
  assert.ok(workbookText((await call('outsider','/records/client/export.xlsx',undefined,200)).buffer).includes('منشآت التجزئة الكبرى'),'الحقل غير المحجوب في الملف');
  assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE action='records.exported'").get(),'التصدير حدث مسجَّل');
  // (4) البحث: الفهرس مشترك، فلا يدخله إلا حقل قابل للبحث قائمةُ «من يرى» فيه فارغة. المحجوب ممتنعٌ عنه حتى على المخوَّل.
  assert.equal(searchText(db,'36t','client',db.prepare('SELECT * FROM clients WHERE id=?').get(client)),'منشآت التجزئة الكبرى');
  assert.equal(searchAll(db,users.manager,CANARY).total,0);assert.equal(searchAll(db,users.outsider,'التجزئة الكبرى').total,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM search_index WHERE body LIKE ?').get(`%${CANARY}%`).n,0);
  // (5) سجل تغيّر القيمة: المتتبَّع يُسجَّل، ولا يرى تاريخه إلا من يراه.
  assert.deepEqual(valueHistory(db,users.manager,QUOTE,quote).map(h=>[h.label,h.before,h.after]),[['ملاحظة داخلية للإدارة','غير متاح',CANARY]]);
  assert.deepEqual(valueHistory(db,users.outsider,QUOTE,quote),[]);
  // (6) الكتابة: حقل محجوب يُرفض كأنه غير موجود (الرفض لا يكشفه)؛ وحقل مرئي لا يملك تعديله يُرفض باسمه وبمن يحمل التصريح.
  const blind=caught(()=>tx(()=>saveValues(db,users.outsider,QUOTE,quote,{version:quotationRow().version,values:{internal_note:'كتابة عمياء'}})));
  assert.equal(blind.code,'unknown_custom_field');assert.ok(!blind.message.includes('ملاحظة داخلية'));
  publish(QUOTE,{fields:[{...LEAD_SOURCE,editable_by:['pricing.exception.approve']},MASKED_NOTE],layout:{slots:{header:['lead_source','internal_note']}},views:{list:{columns:['lead_source','internal_note']}}});
  const locked=caught(()=>tx(()=>saveValues(db,users.outsider,QUOTE,quote,{version:quotationRow().version,values:{lead_source:'inbound'}})));
  assert.equal(locked.status,403);assert.equal(locked.code,'field_not_editable');assert.match(locked.message,/«مصدر الفرصة» لا يُعدَّل بحسابك/);assert.match(locked.details.refusal.missing[0].owner,/مدير الفريق التجريبي/);
  assert.equal(values(db,'client_quotations',quote).lead_source,'event','لم تُسقط الكتابة صامتة ولم تُنفَّذ');
  assert.equal(project(db,users.outsider,QUOTE,quotationRow()).custom[0].editable,false);
  // (7) بعد استرجاعٍ يُسقط الحقل تبقى قيمته في السجل بلا تعريف يُخرجها: لا تخرج لأحد، ولا للمخوَّل.
  tx(()=>rollbackTo(db,users.employee,QUOTE,{to_version:0,note:'إسقاط الحقول بالاسترجاع'}));
  assert.ok(quotationRow().custom_fields.includes(CANARY));assert.deepEqual(project(db,users.manager,QUOTE,quotationRow()).custom_fields,{});
  assert.ok(!(await call('manager','/pricing',undefined,200)).text.includes(CANARY));
});

test('custom fields: the registry subtracts from the code floor and never grants — declared cost and margin figures are withheld from a reader the definition masks them from',t=>{
  const {db,users,tx,publish,quote,quotationRow}=fixture(t);
  const figures=q=>['total_cost_minor','net_margin_bp','markup_bp','formulas','groups'].filter(key=>Object.hasOwn(q.current.snapshot,key));
  assert.equal(figures(pricingBoard(db,users.outsider).quotations[0]).length,5,'بلا تعريف: أرضية الكود كما هي');
  publish(QUOTE,{system:{cost_margin:{visible_to:['profitability.view']}}});
  const masked=pricingBoard(db,users.outsider).quotations[0],open=pricingBoard(db,users.manager).quotations[0];
  assert.deepEqual(figures(masked),[]);assert.deepEqual(masked.versions.flatMap(v=>figures({current:v})),[]);
  assert.deepEqual(masked.withheld,[{key:'cost_margin',label:'التكلفة والاحتياطي وهامش الربح والمعادلات في لقطة العرض'}],'يُقال للشاشة ما حُجب باسمه، فلا تكتب رقمًا ناقصًا');
  assert.equal(typeof masked.current.snapshot.grand_total_minor,'number','سعر العميل ليس مما يُحجب');
  assert.equal(figures(open).length,5);assert.equal(open.withheld,undefined);
  // سجل العرض الإلكتروني: الأرقام نفسها، وأسطر المسار التي تحمل نسبة احتياطي أو هامش تسقط معها.
  const record=quotationRecord(db,users.outsider,quote),full=quotationRecord(db,users.manager,quote);
  assert.deepEqual(figures(record),[]);assert.ok(!record.approval_trail.some(e=>/احتياطي|هامش/.test(e.step)));assert.ok(full.approval_trail.some(e=>/هامش/.test(e.step)));
  // لا يفتح التعريف ما أغلقه الكود: hr لا تحمل تصريح التسعير، وقائمة «من يرى» لا تمنحها الشاشة.
  assert.throws(()=>pricingBoard(db,users.hr),error=>error.status===403);
  // withhold عامة: تُسقط المسارات المعلنة من أي حمولة بالشكل نفسه، ولا تمس الأصل.
  const payload={current:{snapshot:{total_cost_minor:1,grand_total_minor:2}},versions:[{snapshot:{net_margin_bp:3,grand_total_minor:2}}]};
  assert.deepEqual(withhold(db,users.outsider,QUOTE,payload).versions,[{snapshot:{grand_total_minor:2}}]);assert.equal(payload.current.snapshot.total_cost_minor,1);
});

test('custom fields: a national or iqama number typed into any custom text field is refused in Latin, Arabic-Indic and Persian digits, and a number field is no back door',t=>{
  const {db,users,tx,publish,quote,client,quotationRow}=fixture(t);
  publish(QUOTE,RICH);publish('client',{fields:[{key:'contact_note',label:{ar:'ملاحظة عن جهة الاتصال'},type:'text',required:false}]});
  const save=input=>tx(()=>saveValues(db,users.employee,QUOTE,quote,{version:quotationRow().version,values:input}));
  for(const [script,value] of [['لاتينية','1098765432'],['عربية-هندية','١٠٩٨٧٦٥٤٣٢'],['فارسية','۱۰۹۸۷۶۵۴۳۲'],['بفواصل','1.098.765.432'],['بفراغات وشرطات','٢٠٩٨ ٧٦٥-٤٣٢ ١'],['داخل جملة','هوية المفوَّض 2098765431 للتوقيع']]){
    const refused=caught(()=>save({brief:value}));
    assert.equal(refused.code,'national_id_refused',script);assert.match(refused.message,/«ملخص الطلب»/,script);assert.match(refused.details.refusal.missing[0].why,/لا تُسجَّل أرقام الهوية أو الإقامة/,script);
    assert.throws(()=>tx(()=>createClient(db,users.employee,{legal_name:`جهة تجريبية ${script}`,sector:'الصحة',status:'prospect',custom_fields:{contact_note:value}})),code('national_id_refused'),script+' عند الإنشاء');
  }
  // عبر الانتقال أيضًا: القيمة المرسلة مع «الإصدار» تمر بالحارس نفسه.
  assert.throws(()=>tx(()=>quotationAction(db,users.employee,quote,'issue',{version:quotationRow().version,note:'',custom_fields:{brief:'۱۰۹۸۷۶۵۴۳۲'}})),code('national_id_refused'));
  // الحقل الرقمي: عشرة أرقام تبدأ بـ1 أو 2 صورة رقم هوية أو إقامة؛ كمية عادية تمر.
  assert.throws(()=>publish(QUOTE,{fields:[...RICH.fields.filter(f=>f.key!=='seats'),{key:'seats',label:{ar:'عدد المقاعد'},type:'number',required:false}]}),code('second_publisher_required'),'رفع حدّي الرقم تخفيف');
  publish(QUOTE,{fields:[...RICH.fields,{key:'reference_no',label:{ar:'مرجع داخلي'},type:'number',required:false}]});
  for(const value of ['1098765432','2098765431'])assert.throws(()=>save({reference_no:value}),code('national_id_refused'),value);
  save({reference_no:'4500',brief:'الحملة 2026 على 12 قناة، و5 فعاليات',seats:'250'});
  assert.deepEqual(values(db,'client_quotations',quote),{reference_no:'4500',brief:'الحملة 2026 على 12 قناة، و5 فعاليات',seats:'250'},'أرقام قصيرة في النص ليست وثائق');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM clients WHERE legal_name LIKE 'جهة تجريبية %'").get().n,0,'رفضٌ عند الإنشاء لا يترك ملفًا');
});

test('custom fields: a record that is already final keeps the gap honest — «غير متاح — أُضيف الحقل بعد إقفال السجل», with no owner and no next step, never blank',t=>{
  const {db,users,tx,publish,quote,quotationRow}=fixture(t);
  // «قبل الإقفال» و«بعده» يُقرآن من طوابع بالمللي ثانية، وقاعدة في الذاكرة تنشر وتقفل في المللي ثانية نفسها فيتأرجح الاختبار.
  // وقفة قصيرة بين الخطوات تجعل الترتيب ترتيبًا في الزمن كما هو عند إنسانين حقيقيين.
  const pause=()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,4);
  publish(QUOTE,{fields:[LEAD_SOURCE]});pause();
  tx(()=>quotationAction(db,users.employee,quote,'issue',{version:quotationRow().version,note:''}));
  tx(()=>quotationAction(db,users.employee,quote,'accept',{version:quotationRow().version,reason:'قبل العميل العرض بخطاب تجريبي'}));pause();
  // حقل كان قائمًا قبل الإقفال ولم يُملأ، وحقل يُنشر بعده.
  publish(QUOTE,{fields:[LEAD_SOURCE,{key:'renewal_note',label:{ar:'ملاحظة التجديد'},type:'text',required:false}]});
  const items=Object.fromEntries(pricingBoard(db,users.employee).quotations[0].custom.map(i=>[i.key,i]));
  assert.deepEqual([items.lead_source.text,items.lead_source.reason],['غير متاح','لم يُدخل قبل إقفال السجل']);
  assert.deepEqual([items.renewal_note.text,items.renewal_note.reason,items.renewal_note.value],['غير متاح','أُضيف الحقل بعد إقفال السجل',null]);
  assert.deepEqual([items.renewal_note.owner,items.renewal_note.needed,items.renewal_note.editable],['','',false],'ليس نقصًا يُستكمل عند أحد');
  assert.throws(()=>tx(()=>saveValues(db,users.employee,QUOTE,quote,{version:quotationRow().version,values:{renewal_note:'بعد الإقفال'}})),code('record_final'));
  assert.ok(workbookText(exportRows(db,users.employee,QUOTE).content).includes('غير متاح'),'الخانة في التصدير تقول «غير متاح» ولا تُترك فارغة');
});

test('custom fields: a retired option stays readable on the records that chose it and is no longer offered, and the count of records using it is known before retiring',t=>{
  const {db,users,tx,publish,quote,quotationRow}=fixture(t);
  publish(QUOTE,{fields:[LEAD_SOURCE,{key:'brief',label:{ar:'ملخص الطلب'},type:'text',required:false}]});
  tx(()=>saveValues(db,users.employee,QUOTE,quote,{version:quotationRow().version,values:{lead_source:'event'}}));
  assert.equal(optionUsage(db,'36t',QUOTE,'lead_source','event'),1);assert.equal(optionUsage(db,'36t',QUOTE,'lead_source','referral'),0);
  publish(QUOTE,{fields:[{...LEAD_SOURCE,options:LEAD_SOURCE.options.map(o=>o.value==='event'?{...o,retired:true}:o)},{key:'brief',label:{ar:'ملخص الطلب'},type:'text',required:false}]});
  assert.equal(pricingBoard(db,users.employee).quotations[0].custom[0].text,'فعالية أو معرض','القيمة القديمة تُقرأ باسمها');
  tx(()=>saveValues(db,users.employee,QUOTE,quote,{version:quotationRow().version,values:{lead_source:'event',brief:'تعديل جاره لا يمنعه خيار مسحوب'}}));
  tx(()=>saveValues(db,users.employee,QUOTE,quote,{version:quotationRow().version,values:{lead_source:'inbound'}}));
  assert.throws(()=>tx(()=>saveValues(db,users.employee,QUOTE,quote,{version:quotationRow().version,values:{lead_source:'event'}})),code('invalid_option'),'الخيار المسحوب لا يُختار من جديد');
  // حقل مسحوب: قيمته باقية ومعروضة كما أُدخلت، ولا يُكتب فيه.
  publish(QUOTE,{fields:[{...LEAD_SOURCE,options:LEAD_SOURCE.options.map(o=>o.value==='event'?{...o,retired:true}:o)},{key:'brief',label:{ar:'ملخص الطلب'},type:'text',required:false,retired:true}]});
  const brief=pricingBoard(db,users.employee).quotations[0].custom.find(i=>i.key==='brief');
  assert.deepEqual([brief.retired,brief.editable,brief.text],[true,false,'تعديل جاره لا يمنعه خيار مسحوب']);
  assert.throws(()=>tx(()=>saveValues(db,users.employee,QUOTE,quote,{version:quotationRow().version,values:{brief:'كتابة في حقل مسحوب'}})),code('field_retired'));
});

test('custom fields: record-level authorisation is the module’s own — the generic endpoint opens nothing the screen would not',async t=>{
  const {db,users,tx,publish,quote,opportunity,client,quotationRow}=fixture(t);
  publish(QUOTE,{fields:[LEAD_SOURCE]});publish('opportunity',{fields:[LEAD_SOURCE]});publish('client',{fields:[LEAD_SOURCE]});
  // it وhr ليستا في فريق الحساب ولا تحملان تصريح الكيان: الحفظ العام والتصدير والتاريخ تُرفض برفض الوحدة نفسها.
  assert.throws(()=>tx(()=>saveValues(db,users.hr,QUOTE,quote,{version:quotationRow().version,values:{lead_source:'event'}})),code('forbidden'));
  assert.throws(()=>exportRows(db,users.hr,QUOTE),code('forbidden'));assert.throws(()=>valueHistory(db,users.hr,'client',client),code('forbidden'));
  // الفرصة يعدّلها صاحبها؛ زميله في الفريق يراها ولا يكتب فيها.
  const mine=caught(()=>tx(()=>saveValues(db,users.outsider,'opportunity',opportunity,{version:1,values:{lead_source:'event'}})));
  assert.equal(mine.code,'forbidden');assert.match(mine.details.refusal.missing[0].owner,/الموظفة التجريبية/);
  // كيان آخر (external في كيان معزول) لا يصل سجلات هذا الكيان ولا تعريفاته.
  assert.throws(()=>tx(()=>saveValues(db,users.external,'client',client,{version:1,values:{lead_source:'event'}})),error=>[403,404].includes(error.status));
  const {call}=await sessionsFor(createApp(db),['employee','hr']);
  await call('hr',`/records/${QUOTE}/${quote}/custom-fields`,{version:quotationRow().version,values:{lead_source:'event'}},403);
  await call('employee','/records/payroll_run/export.xlsx',undefined,404);
  await call('employee',`/records/${QUOTE}/${quote}/custom-fields`,{version:quotationRow().version,values:{lead_source:'event'}},201);
  assert.equal(values(db,'client_quotations',quote).lead_source,'event');
  assert.deepEqual(forTransition(db,users.employee,QUOTE,quotationRow(),'issue',undefined).changed,[]);
  assert.equal(clean(db,users.employee,QUOTE,quotationRow(),undefined),'{"lead_source":"event"}');
  assert.throws(()=>forTransition(db,users.employee,QUOTE,quotationRow(),'archive',undefined),TypeError,'انتقال غير معلن في الواصف خطأ مبرمج لا رفض');
});

/* ───── نقيصة أمنية قِيست على هذا الفرع (05e7002) وأُصلحت عند سببها ───── */

// (4) الحارس كان يمحو الفراغ والنقطة والشرطة وحدها قبل العدّ، فيمر رقم الهوية نفسه بفاصل لا يُرى بينه (صفري العرض، والشرطة
// اللينة، وعلامات الاتجاه) أو بفاصلة أو شرطة مائلة أو بأرقام العرض الكامل. القيمة تُخزَّن ثم تنطوي إلى الرقم الكامل في كل
// مخرج: القراءة، وفهرس البحث المشترك، والتصدير، وسجل التدقيق الإلحاقي الذي لا يُنقَّح. الفاصل لا يكسر الرقم إلا في عين حارس.
test('custom fields: a national id smuggled past the guard with invisible separators, punctuation or full-width digits is refused before it is stored, indexed, exported or audited',t=>{
  const {db,users,tx,publish,quote,quotationRow}=fixture(t);
  publish(QUOTE,{fields:[{key:'brief',label:{ar:'ملخص الطلب'},type:'textarea',required:false,searchable:true,tracked:true},
    {key:'reference_no',label:{ar:'مرجع داخلي'},type:'number',required:false}]});
  const save=input=>tx(()=>saveValues(db,users.employee,QUOTE,quote,{version:quotationRow().version,values:input}));
  const ID='1098765432',weave=(digits,separator)=>[...digits].join(separator);
  const smuggled=[
    ['فاصل صفري العرض (U+200B)',weave(ID,'​')],
    ['رابط كلمي (U+200D)',weave(ID,'‍')],
    ['شرطة لينة (U+00AD)',weave(ID,'­')],
    ['علامة اتجاه (U+200F)',weave(ID,'‏')],
    ['فاصلة',weave(ID,',')],
    ['شرطة مائلة','10/98/76/54/32'],
    ['شرطة سفلية',weave(ID,'_')],
    ['أرقام العرض الكامل','１０９８７６５４３２'],
    ['العرض الكامل بفاصل صفري',weave('１０９８７６５４３２','​')],
    ['داخل جملة','هوية المفوَّض '+weave(ID,'​')+' للتوقيع']];
  for(const [name,value] of smuggled){
    const refused=caught(()=>save({brief:value}));
    assert.equal(refused.code,'national_id_refused',name);
    assert.match(refused.details.refusal.next,/بأي فاصل بينها/,name);
  }
  // الحقل الرقمي لا يكون بابًا خلفيًا: الكسر العشري كان يفلت لأن القطع يقع بعد محو النقطة فيصير الرقم اثني عشر خانة.
  assert.throws(()=>save({reference_no:'1098765432.50'}),code('national_id_refused'),'بكسر عشري');
  // وصورة العرض الكامل يردّها محقّق الرقم قبل الحارس؛ والحارس نفسه يقرؤها رقم هوية، فلا يمر لو مرّت من محقّق آخر.
  assert.throws(()=>save({reference_no:'１０９８７６５４３２'}),/رقمًا موجبًا|هوية/,'العرض الكامل');
  assert.equal(looksLikeNationalId('１０９８７６５４３２'),true);
  assert.equal(looksLikeNationalId('450000'),false,'مبلغ عادي ليس رقم وثيقة');

  // لا شيء منها وصل السجل ولا الفهرس ولا التصدير ولا سلسلة التدقيق — والسلسلة إلحاقية لا تُنقَّح، فالمنع قبلها هو المنع الوحيد.
  const collapse=text=>String(text).normalize('NFKC').replace(/[^\p{L}\p{Nd}]+/gu,'').replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x0660));
  assert.deepEqual(JSON.parse(quotationRow().custom_fields),{},'لا قيمة في السجل');
  assert.equal(searchText(db,'36t',QUOTE,quotationRow()),'','لا شيء في نص البحث');
  assert.ok(!collapse(workbookText(exportRows(db,users.employee,QUOTE).content)).includes(ID),'ولا في ملف التصدير');
  const audits=db.prepare("SELECT before_json,after_json FROM audit_events WHERE entity_type=? AND entity_id=?").all(QUOTE,quote);
  assert.ok(!audits.some(e=>collapse(e.before_json+e.after_json).includes(ID)),'ولا في سجل تغيّر القيمة');

  // وما ليس رقم وثيقة يمر كما كان: أرقام قصيرة يفصلها كلام، ومبلغ في حقل رقمي.
  save({brief:'الحملة 2026 على 12 قناة، و5 فعاليات',reference_no:'4500'});
  assert.deepEqual(JSON.parse(quotationRow().custom_fields),{brief:'الحملة 2026 على 12 قناة، و5 فعاليات',reference_no:'4500'});
});
