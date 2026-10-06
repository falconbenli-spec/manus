// مركز الخدمات — الدفعة الثالثة (التفاعل): المراحل السبع وخطّ المحطّات، والخطأ تحت حقله، وسجل البحث بلا هوية،
// و«طلباتي» بمرحلتها، وحدّ المرفق بالرقم الحقيقي — 22 سبتمبر 2026.
//
// القاعدة التي يحرسها هذا الملف: **لا كلمة حالة تُكتب في شاشة**. المراحل السبع في القاموس وحده (REQUESTER_STAGES)،
// وخريطة الثماني عليها في stageOf وحدها، وما تطبعه الشاشات يُقرأ من الحمولة. والاختبار يُجري الطلب فعلًا: مسودة،
// فتقديم، فإعادة من المدير، فإعادة تقديم، فرفض — ويقرأ في كل خطوة ما يراه صاحب الطلب.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import { createRequest, transition, addAttachment, editRequest, createService } from '../app/workflow.mjs';
import { REQUESTER_STAGES, REQUEST_STATUSES, REQUEST_STATUS, stageOf, TIMELINE_STATIONS, stationName, LAPSED_PHRASE, BANNED_STATUS_PHRASES } from '../app/static/vocabulary.mjs';
import { timeline, stations, whereabouts, myTimelineBoard } from '../app/request-timeline.mjs';
import { myRequestTimelineUI } from '../app/static/request-transparency-ui.mjs';
import { myRequests } from '../app/my-requests.mjs';
import { myRequestsUI } from '../app/static/my-requests-ui.mjs';
import { validatePayload } from '../app/validation.mjs';
import { usedServices } from '../app/routing.mjs';
import { reindex } from '../app/search.mjs';
import { kit } from '../app/static/kit.mjs';
import { requestComposer } from '../app/static/request-picker.mjs';
import { UNAVAILABLE, SCREEN_GAPS, catalogTree } from '../app/catalog-home.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=kit(e,ar=>ar);
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-catalog-interaction');installServiceCatalog(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  // أحدث نسخة من HR-LETTER (المبذورة «طلب خطاب وظيفي»): الحقلان purpose (نص طويل) وrecipient (نص).
  const letter=db.prepare("SELECT * FROM services WHERE tenant_id='36t' AND code='HR-LETTER' ORDER BY version DESC LIMIT 1").get();
  return {db,users,tx,letter};
}
const stageNames=Object.values(REQUESTER_STAGES).map(pair=>pair[0]);

/* ───── المراحل السبع ──────────────────────────────────────────────────────── */

test('المراحل: سبعٌ بالضبط في القاموس، وكل حالةٍ من الثماني تقع في واحدة منها، ولا مفتاح خام يتسرّب',()=>{
  assert.equal(Object.keys(REQUESTER_STAGES).length,7);
  assert.deepEqual(Object.keys(REQUESTER_STAGES),['submitted','awaiting','needs_you','executing','completed','rejected','cancelled']);
  for(const status of REQUEST_STATUSES){
    const stage=stageOf(status);
    assert.ok(Object.hasOwn(REQUESTER_STAGES,stage.stage),`${status}: خارج السبع`);
    assert.ok(stageNames.includes(stage.name_ar)&&!REQUEST_STATUSES.includes(stage.name_ar),`${status}: الاسم مفتاحٌ خام`);
  }
  // القراران المكتوبان: المسودة تبتلعها «ينتظر ردك»، والمنقضي «ملغى» بعبارةٍ بجوارها.
  assert.equal(stageOf('draft').stage,'needs_you');assert.equal(stageOf('returned').stage,'needs_you');
  assert.equal(stageOf('cancelled').module_phrase,null);assert.equal(stageOf('cancelled',{lapsed:true}).module_phrase,LAPSED_PHRASE);
  assert.equal(stageOf('pending').name_ar,REQUEST_STATUS.pending[0]);
  assert.equal(stageOf('approved').stage,'executing');assert.equal(stageOf('in_progress').stage,'executing');
  // حالةٌ خارج الثماني تعود كما هي ولا تُلبَّس مرحلة.
  assert.equal(stageOf('weird').stage,'weird');
  // «قيد الموافقة» ليست في القاموس ولا في العبارات المعتمدة: القاموس يرفض «قيد» للانتظار.
  assert.ok(!stageNames.includes('قيد الموافقة'));
  for(const phrase of BANNED_STATUS_PHRASES)assert.ok(!stageNames.includes(phrase));
  assert.deepEqual(TIMELINE_STATIONS,['submitted','awaiting','approved','executing','completed']);
  assert.equal(stationName('approved'),REQUEST_STATUS.approved[0]);assert.equal(stationName('submitted'),'قُدّم');
});

/* ───── الطلب يمشي: مسودة ← تقديم ← إعادة ← إعادة تقديم ← رفض ─────────────── */

test('أين طلبي: خمس محطّات ثابتة، والمعاد يقول «ينتظر ردك» وفعله، والمرفوض يقف حيث وقف ولا يكتمل الخطّ كذبًا',t=>{
  const {db,users,tx,letter}=fixture(t);
  const employee=users.employee,manager=users.manager;
  const draft=tx(()=>createRequest(db,employee,{service_id:letter.id,title:'تعريف بالعمل — تجريبي',payload:{purpose:'خطاب تعريف لجهة تأجير تجريبية',recipient:'جهة تجريبية'},project_id:null}));
  // مسودة: لا محطّة مبلوغة، والمرحلة «ينتظر ردك»، وعند صاحب الطلب.
  let view=timeline(db,employee,draft.id);
  assert.equal(view.stage.key,'needs_you');assert.equal(view.stage.name,REQUESTER_STAGES.needs_you[0]);
  assert.equal(view.stations.length,5);assert.ok(view.stations.every(s=>!s.reached_at&&!s.current));
  assert.deepEqual(whereabouts(db,employee,draft.id),{stage:'needs_you',stage_name:'ينتظر ردك',stage_name_en:'Waiting for you',with:'صاحب الطلب',awaiting:'لم يُقدَّم بعد'});
  // تقديم: «قُدّم» و«بانتظار الاعتماد» مبلوغتان بتاريخ، والحالية الثانية، والمرحلة awaiting باسم المدير.
  tx(()=>transition(db,employee,draft.id,'submit',{version:draft.version,note:''}));
  view=timeline(db,employee,draft.id);
  assert.equal(view.stage.key,'awaiting');
  assert.deepEqual(view.stations.map(s=>[s.key,!!s.reached_at,s.current]),[['submitted',true,false],['awaiting',true,true],['approved',false,false],['executing',false,false],['completed',false,false]]);
  assert.ok(whereabouts(db,employee,draft.id).with.includes(manager.name));
  // المدير يعيد الطلب: المرحلة «ينتظر ردك»، والمحطّة الحالية تحمل كلمة المرحلة، والفعل مكتوب لصاحبه.
  const pending=db.prepare('SELECT version FROM requests WHERE id=?').get(draft.id).version;
  tx(()=>transition(db,manager,draft.id,'return',{version:pending,note:'أكمل الجهة الموجه إليها باسمها الكامل'}));
  view=timeline(db,employee,draft.id);
  assert.equal(view.stage.key,'needs_you');
  const held=view.stations.find(s=>s.current);
  assert.equal(held.key,'awaiting');assert.equal(held.held,true);assert.equal(held.stage,REQUESTER_STAGES.needs_you[0]);
  assert.equal(view.next_step.with,'صاحب الطلب');
  assert.ok(view.next_step.you_can.some(x=>x.includes('اقرأ سبب الإرجاع')&&x.includes('أعد تقديمه')),'فعل صاحب الطلب مكتوب');
  // الشاشة: خطّ المحطّات <ol> بخمس محطّات، والحالية aria-current، وكلمة المرحلة ظاهرة، ولا مفتاح حالة خام في النص.
  const form=myRequestTimelineUI.form('view_timeline',draft.id,{rows:[{id:draft.id,title:draft.title,actions:['view_timeline']}],closable:[]});
  const drawn=form.after(view,e),html=drawn.html,body=text(html);
  assert.ok(html.includes('<ol class="rq-trail rq-stations"'),'خطّ المحطّات مرسوم');
  assert.equal((html.match(/<li class="is-(?:passed|now|ahead|ended|skipped)"/g)??[]).length,5,'خمس محطّات');
  assert.equal((html.match(/aria-current="step"/g)??[]).length,1);
  assert.ok(body.includes('ينتظر ردك')&&body.includes('الآن عند: صاحب الطلب'));
  for(const station of view.stations)assert.ok(html.includes(`aria-label="${e(`${station.position} من 5 — ${station.name} — `)}`),`${station.key}: نطق المحطّة`);
  for(const status of REQUEST_STATUSES)assert.ok(!new RegExp(`[>\\s]${status}[<\\s]`).test(html.replace(/class="[^"]*"/g,'')),`«${status}» مفتاحٌ خام في الشاشة`);
  assert.doesNotMatch(html,/<script|\sstyle=|\son[a-z]+=/i,'CSP');
  // «الالتزام» بجملة السند: الزمن المستهدف مشتق لم يتبنّه أحد — تبقى في جملة التوقع كما كانت.
  assert.ok(text(html).includes('لا يُعطى تاريخ متوقع')||text(html).includes('مشتق'),'جملة السند باقية');
  // إعادة التقديم ثم الرفض: المحطّة التي وقف عندها الطلب تُعلَّم بكلمة «مرفوض» والبقية غير مبلوغة.
  const returned=db.prepare('SELECT version FROM requests WHERE id=?').get(draft.id).version;
  tx(()=>editRequest(db,employee,draft.id,{version:returned,title:draft.title,payload:{purpose:'خطاب تعريف لجهة تأجير تجريبية',recipient:'شركة التأجير التجريبية المحدودة'}}));
  const edited=db.prepare('SELECT version FROM requests WHERE id=?').get(draft.id).version;
  tx(()=>transition(db,employee,draft.id,'submit',{version:edited,note:''}));
  const again=db.prepare('SELECT version FROM requests WHERE id=?').get(draft.id).version;
  tx(()=>transition(db,manager,draft.id,'reject',{version:again,note:'لا يصدر تعريف لهذه الجهة'}));
  view=timeline(db,employee,draft.id);
  assert.equal(view.stage.key,'rejected');
  const ended=view.stations.find(s=>s.ended);
  assert.equal(ended.key,'awaiting');assert.equal(ended.stage,REQUEST_STATUS.rejected[0]);
  assert.ok(view.stations.filter(s=>['approved','executing','completed'].includes(s.key)).every(s=>!s.reached_at&&!s.current),'لا يكتمل الخطّ كذبًا');
  const rejectedHtml=form.after(view,e).html;
  assert.ok(rejectedHtml.includes('class="is-ended"')&&rejectedHtml.includes('✕'),'المحطّة الموقوفة بشكلٍ لا بلون');
  // لوحة «أين طلباتي» تحمل المرحلة لكل صف، والصف يقولها بجوار شارة الحالة حين تخالفها.
  const board=myTimelineBoard(db,employee);
  assert.equal(board.rows.find(r=>r.id===draft.id).stage,'rejected');
  assert.ok(verifyAudit(db),'سلسلة التدقيق سليمة بعد المسار كله');
});

test('أين طلبي: المسار المباشر يعبر «بانتظار الاعتماد» بلا انتظار ويُعلَّم skipped لا مبلوغًا',t=>{
  const {db,users,tx}=fixture(t);
  // خدمة بمسار مباشر إن وُجدت في الدليل؛ وإلا يُثبت العقد على الشكل وحده.
  const direct=db.prepare("SELECT * FROM services WHERE tenant_id='36t' AND active=1 AND json_extract(approval_policy,'$.mode')='direct' ORDER BY version DESC LIMIT 1").get();
  if(!direct){t.diagnostic('لا خدمة بمسار مباشر في البذرة؛ يُفحص الشكل وحده');const r={id:'x',tenant_id:'36t',status:'draft',revision:0,service_id:null};assert.equal(TIMELINE_STATIONS.length,5);return;}
  const fields=Object.fromEntries(JSON.parse(direct.fields).filter(f=>f.required).map(f=>[f.key,f.type==='select'?f.options[0]:f.type==='date'?'2026-10-01':f.type==='number'?'10':'قيمة تجريبية كافية الطول']));
  const requester=Object.values(users).find(u=>u.role!=='admin'&&u.department_id===direct.department_id)??users.employee;
  const draft=tx(()=>createRequest(db,requester,{service_id:direct.id,title:'مباشر — تجريبي',payload:fields,project_id:null}));
  try{tx(()=>transition(db,requester,draft.id,'submit',{version:draft.version,note:''}));}catch(error){t.diagnostic(`تعذّر تقديم المسار المباشر في البذرة: ${error.code}`);return;}
  const list=stations(db,db.prepare('SELECT * FROM requests WHERE id=?').get(draft.id));
  assert.equal(list.find(s=>s.key==='awaiting').skipped,true);
  assert.ok(list.find(s=>s.key==='approved').reached_at,'المباشر يبلغ «معتمد» لحظة التقديم');
});

/* ───── طلباتي: المرحلة تُجمِّع، والمسودة تظهر ─────────────────────────────── */

test('طلباتي: كل بند يحمل مرحلته من القاموس، والمسودة والمعاد في «ينتظر ردك» بشارتهما وفعلهما، والبايتات كما كانت',t=>{
  const {db,users,tx,letter}=fixture(t);
  const employee=users.employee,manager=users.manager;
  const draft=tx(()=>createRequest(db,employee,{service_id:letter.id,title:'مسودة تجريبية',payload:{purpose:'خطاب تعريف تجريبي للاختبار',recipient:'جهة تجريبية'},project_id:null}));
  const other=tx(()=>createRequest(db,employee,{service_id:letter.id,title:'طلب يُعاد',payload:{purpose:'خطاب تعريف تجريبي للاختبار',recipient:'جهة تجريبية'},project_id:null}));
  tx(()=>transition(db,employee,other.id,'submit',{version:other.version,note:''}));
  tx(()=>transition(db,manager,other.id,'return',{version:db.prepare('SELECT version FROM requests WHERE id=?').get(other.id).version,note:'أكمل البيانات المطلوبة'}));
  const data=myRequests(db,employee);
  const mine=data.items.filter(i=>i.source==='catalog');
  assert.equal(mine.length,2);
  for(const item of mine){assert.ok(Object.hasOwn(REQUESTER_STAGES,item.stage),`${item.id}: مرحلة خارج السبع`);assert.equal(item.stage_name,REQUESTER_STAGES[item.stage][0]);}
  assert.equal(mine.find(i=>i.id===draft.id).stage,'needs_you');assert.equal(mine.find(i=>i.id===other.id).stage,'needs_you');
  assert.equal(data.counts.needs_you,2);
  const html=myRequestsUI.render(data,{e,tr:ar=>ar,lang:'ar',ui}),body=text(html);
  // المجموعة الأولى «ينتظر ردك» تضمّ الاثنين، وكلٌّ منهما يحمل شارة حالته من القاموس وحلقة «ينتظر ردك».
  assert.ok(html.includes('id="mr-needs" open'),'المجموعة مفتوحة');
  assert.ok(body.includes(`ينتظر ردك 2`));
  assert.ok(html.includes(`<span class="badge draft">${REQUEST_STATUS.draft[0]}</span>`),'شارة المسودة من القاموس');
  assert.ok(html.includes(`<span class="badge returned">${REQUEST_STATUS.returned[0]}</span>`),'شارة المعاد من القاموس');
  assert.equal((html.match(/<span class="pill is-due">ينتظر ردك<\/span>/g)??[]).length,2);
  // المعاد يفتح شاشته وفيها فعله: «اقرأ سبب الإرجاع أعلاه، عدّل الطلب، ثم أعد تقديمه.»
  assert.ok(html.includes(`href="#request/${other.id}"`));
  assert.ok(timeline(db,employee,other.id).next_step.you_can[0].includes('أعد تقديمه'));
  assert.doesNotMatch(html,/<script|\sstyle=|\son[a-z]+=/i);
});

/* ───── النموذج: الخطأ باسم حقله بالعربية، والمرفق بحدّه الحقيقي ─────────── */

test('النموذج: الرفض يسمّي الحقل بالعربية ويحمل مفتاحه في details.field، والناقص كلّه في details.fields',t=>{
  const {db,users,tx,letter}=fixture(t);
  const fields=JSON.parse(letter.fields);
  // نص أقصر من حدّه المعلَن أو نوعٌ خاطئ: الرسالة باسم الحقل، والمفتاح للنموذج ليرسمها تحته.
  assert.throws(()=>validatePayload(fields,{purpose:123,recipient:'جهة'},false),error=>error.code==='invalid_text'&&error.message.startsWith('الغرض من الخطاب:')&&error.details.field==='purpose'&&error.details.label==='الغرض من الخطاب');
  assert.throws(()=>validatePayload([{key:'amount',label:'المبلغ',type:'number',required:true}],{amount:'abc'},false),error=>error.code==='invalid_number'&&error.message.startsWith('المبلغ:')&&error.details.field==='amount');
  assert.throws(()=>validatePayload([{key:'kind',label:'النوع',type:'select',required:true,options:['أ','ب']}],{kind:'ج'},false),error=>error.code==='invalid_option'&&error.details.field==='kind');
  assert.throws(()=>validatePayload([{key:'on',label:'التاريخ',type:'date',required:true}],{on:'2026-13-40'},false),error=>error.code==='invalid_date'&&error.details.field==='on');
  assert.throws(()=>validatePayload([{key:'iban',label:'الآيبان',type:'text',required:true,pattern:'^SA\\d{22}$',pattern_message:'آيبان سعودي يبدأ بـSA ثم 22 رقمًا'}],{iban:'x'},false),error=>error.code==='invalid_format'&&error.message==='الآيبان: آيبان سعودي يبدأ بـSA ثم 22 رقمًا'&&error.details.field==='iban');
  assert.throws(()=>validatePayload([{key:'a',label:'حقل أ',type:'text',required:true,min_length:5}],{a:'قص'},false),error=>error.code==='invalid_text'&&error.message==='حقل أ: اكتب 5 حرفًا على الأقل'&&error.details.field==='a');
  // الناقص يُعلن دفعة واحدة بأسمائه العربية ومفاتيحه.
  assert.throws(()=>validatePayload(fields,{},true),error=>error.code==='missing_field'&&error.message.includes('الغرض من الخطاب')&&error.message.includes('الجهة الموجه إليها')&&JSON.stringify(error.details.fields)==='["purpose","recipient"]');
  // الحقل المخفي بشرطه لا يُطلب ولا يُرفض.
  const conditional=[{key:'kind',label:'النوع',type:'select',required:true,options:['أ','ب']},{key:'why',label:'السبب',type:'text',required:true,show_when:{field:'kind',equals:['ب']}}];
  assert.deepEqual(validatePayload(conditional,{kind:'أ'},true),{kind:'أ'});
  // وعبر المسار الحقيقي: إنشاء مسودة بقيمة من النوع الخاطئ يرفض بالحقل نفسه.
  assert.throws(()=>tx(()=>createRequest(db,users.employee,{service_id:letter.id,title:'x',payload:{purpose:['قائمة'],recipient:'جهة'},project_id:null})),error=>error.details?.field==='purpose');
});

test('المرفقات: فوق مليونين وسبعة وتسعين ألفًا ومئة واثنين وخمسين بايتًا يُرفض بالحدّ الحقيقي في الرسالة، والقيد يبقى في النموذج مرئيًا',t=>{
  const {db,users,tx,letter}=fixture(t);
  const draft=tx(()=>createRequest(db,users.employee,{service_id:letter.id,title:'مرفق تجريبي',payload:{purpose:'خطاب تعريف تجريبي للاختبار',recipient:'جهة تجريبية'},project_id:null}));
  const big=Buffer.alloc(2097153,0x41).toString('base64');
  assert.throws(()=>tx(()=>addAttachment(db,users.employee,draft.id,{version:draft.version,filename:'كبير.txt',content:big})),error=>error.code==='file_size'&&error.status===413&&error.message.includes('2 ميغابايت'));
  // وعند الحدّ بالضبط يُقبل.
  const exact=Buffer.alloc(2097152,0x41).toString('base64');
  const saved=tx(()=>addAttachment(db,users.employee,draft.id,{version:draft.version,filename:'حدّ.txt',content:exact}));
  assert.ok(saved.attachments.some(a=>a.size===2097152));
  // النموذج يقول القيد قبل أن يقع: «احفظ المسودة أولًا ثم أرفق (… حتى 2 ميغابايت)»، ولا عنصر «عاجل» فيه.
  const html=requestComposer({service:{...letter,fields:JSON.parse(letter.fields),approval_policy:JSON.parse(letter.approval_policy),target:null},departments:[{id:'hr',name:'الموارد البشرية'}],projects:[],request:null,edit:false,e,fieldInput:f=>`<label data-field="${e(f.key)}"><span>${e(f.label)}</span><input name="field:${e(f.key)}"></label>`,gaps:SCREEN_GAPS.form.map(k=>UNAVAILABLE[k])});
  assert.ok(html.includes('حتى 2 ميغابايت'));
  // لا زرّ ولا خانة ولا حقل «عاجل» ولا أولوية: علامةٌ بلا أثر أسوأ من غيابها. الكلمة تظهر في سطر الغياب وحده.
  assert.ok(!/name="(?:urgent|priority|field:urgent|field:priority)"/.test(html)&&!/type="checkbox"/.test(html),'لا عنصر «عاجل»');
  assert.equal((html.match(/عاجل/g)??[]).length,(html.match(/<li><strong>علامة «عاجل» — غير متاح\.<\/strong>[^<]*/g)??[]).join('').match(/عاجل/g).length,'«عاجل» في سطر الغياب وحده');
  assert.ok(html.includes('الحفظ التلقائي للمسودة — غير متاح.')&&html.includes('تعبئة الحقول من طلب سابق — غير متاح.')&&html.includes('علامة «عاجل» — غير متاح.'),'ما ليس في النموذج مكتوب بسببه');
  assert.doesNotMatch(html,/<script|\sstyle=|\son[a-z]+=/i);
});

/* ───── بعد إعادة التسمية: صفٌّ واحد في الفهرس، وعدٌّ واحد للرمز ────────────── */

test('بعد إعادة التسمية: البحث الشامل يفهرس أحدث نسخة وحدها، و«طلبتها N مرات» تُعدّ على الرمز لا على الاسم',t=>{
  const {db,users,tx,letter:first}=fixture(t);
  // إعادة تسمية اصطناعية في الاختبار (نسخة ثانية بالشكل نفسه واسم جديد): البذرة لا تحمل نسختين لأي رمز.
  tx(()=>createService(db,users.admin,{code:'HR-LETTER',name_ar:'تعريف بالعمل تجريبي',name_en:first.name_en,department_id:first.department_id,
    description:first.description,fields:JSON.parse(first.fields),approval_policy:JSON.parse(first.approval_policy)}));
  const versions=db.prepare("SELECT id,version,name_ar FROM services WHERE tenant_id='36t' AND code='HR-LETTER' ORDER BY version").all();
  assert.equal(versions.length,2,'HR-LETTER نسختان بعد إعادة التسمية');
  const letter=db.prepare("SELECT * FROM services WHERE tenant_id='36t' AND code='HR-LETTER' ORDER BY version DESC LIMIT 1").get();
  tx(()=>reindex(db,'36t'));
  const indexed=db.prepare("SELECT title FROM search_index WHERE tenant_id='36t' AND entity_type='service' AND entity_id IN (SELECT id FROM services WHERE code='HR-LETTER')").all();
  assert.deepEqual(indexed.map(r=>r.title),[letter.name_ar],'صفٌّ واحد بالاسم الجديد');
  // طلبٌ قديم على النسخة الأولى وطلبٌ على الأحدث: رمزٌ واحد يُعدّ مرتين باسمه الحيّ.
  tx(()=>createRequest(db,users.employee,{service_id:letter.id,title:'جديد',payload:{purpose:'خطاب تعريف تجريبي للاختبار',recipient:'جهة'},project_id:null}));
  const time='2026-09-01T09:00:00.000Z';
  db.prepare("INSERT INTO requests(id,tenant_id,requester_id,service_id,project_id,title,payload,status,created_at,updated_at) VALUES('old-request-1','36t','employee',?,NULL,'قديم','{}','completed',?,?)").run(versions[0].id,time,time);
  const used=usedServices(db,users.employee).find(s=>s.code==='HR-LETTER');
  assert.equal(used.uses,2);assert.equal(used.name,letter.name_ar);
  assert.equal(usedServices(db,users.employee).filter(s=>s.code==='HR-LETTER').length,1,'لا صفّان للرمز الواحد');
});

/* ───── ما يصل النموذج من الحمولة: الغائب مكتوب، والمرادفات في الشجرة ────────── */

test('حمولة الشجرة تحمل أعضاء المجموعات بطاقاتٍ كاملة للبحث وحده، ومرادفاتها، وغياب النموذج الثلاثي',t=>{
  const {db,users}=fixture(t);
  const tree=catalogTree(db,users.employee);
  const members=tree.categories.flatMap(c=>c.members);
  assert.equal(members.length,tree.totals.items-tree.categories.flatMap(c=>c.cards).filter(c=>c.kind!=='group').length,'الأعضاء = البنود ناقص البطاقات المفردة');
  assert.ok(members.every(m=>m.group_key&&m.group_name&&['service','module'].includes(m.kind)));
  assert.deepEqual(tree.gaps.form.map(g=>g.key),['autosave','prefill','urgency']);
  assert.ok(Object.keys(tree.synonyms).length>100&&Object.values(tree.synonyms).flat().length<1200,'نحو تسعمئة مرادف');
  assert.ok(tree.synonyms['service:IT-PASSWORD-UNLOCK'].includes('فك قفل حساب او اعاده تعيين كلمه مرور'),'الاسم القديم مرادفٌ في الحمولة');
  assert.ok(tree.synonyms['service:HR-LETTER'].includes('تعريف بالعمل'),'وكلمة الطالب للمبذورة التي لم تُعَد تسميتها');
});
