// الحزمة 4 (P4-HR-1/2) في الشاشات: ما وصّله الخادم من أفعال وحقول يُرسم ويعمل. كل شاشة تُحمَّل بحمولة الخادم الحقيقي
// (createApp بلا منفذ، بالجلسة وCSRF)، وتُرسم كما يرسمها app.mjs (العدّة ui وزرٌّ بسماته)، ثم يُرسل نموذجها إلى نقطة نهايته
// بحمولته هو — فلا يمر اختبارٌ على زرٍّ يُرسم ويُرفض، ولا على نموذج يرسل ما لا يقبله الخادم.
//   • السجل الوظيفي: حال التغيير المؤرخ بكلمته وشكله، واعتماده وإلغاؤه، وسبب الاعتماد بيد معدّه حين لا زميل، وتطبيق المستحق الحين،
//     والملف الوظيفي لا يحرّر حقلًا مؤرخًا، ورابط التوظيف لمن يعمل على السجل وحده.
//   • التوظيف: زر «ربط المرشح بحسابه وعقده» باسمه ونموذجه (الحساب ثم العقد)، والرابط ظاهر على المرشح.
//   • الرواتب: شريط سلامة المدخلات بأسماء ما تغيّر، ولا زرّ تقديم أو مراجعة أو اعتماد يُرفض بـinputs_changed.
//   • حركات الرواتب: الشهر المقفل وخصم الإجازة الملغاة لا يُعرض لهما زر اعتماد، وردّ الخصم مسمّى، والخصم المستبعد «مستبعد من المسير».
//   • الإجازات: صاحب الإجازة التي صُرف خصمها لا يُعرض له زر إلغاء يرفضه الخادم بـpaid_leave_effect.
// البيانات تجريبية كلها (tests/hr-cycle-fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as employees from '../app/employees.mjs';
import * as people from '../app/people.mjs';
import { listLeave } from '../app/leave.mjs';
import { employeesUI } from '../app/static/employees-ui.mjs';
import { peopleUI } from '../app/static/people-ui.mjs';
import { payrollUI } from '../app/static/payroll-ui.mjs';
import { payrollExtrasUI } from '../app/static/payroll-extras-ui.mjs';
import { leaveUI } from '../app/static/leave-ui.mjs';
import { kit } from '../app/static/kit.mjs';
import { money, operationFields } from '../app/static/operations.mjs';
import { hrCycle } from './hr-cycle-fixture.mjs';

const DAY=86400000;
const riyadh=(offset=0,from=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(from+offset*DAY));
// سياق الرسم كما يمرره app.mjs في موضعه الواحد: e وbutton بسماته وmoney والعدّة ui.
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context=view=>({e,money,tr:ar=>ar,lang:'ar',ui:kit(e),
  button:(action,id,label)=>`<button class="btn outline small" data-action="operation" data-module="${e(view)}" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`});
const buttonsOf=html=>[...html.matchAll(/data-operation="([a-z_]+)" data-id="([^"]*)">([^<]*)</g)].map(m=>({action:m[1],id:m[2],label:m[3]}));
// جلسات حقيقية بلا منفذ: GET للتحميل كما تفعل الشاشة، وPOST لحفظ النموذج كما يفعل الغلاف.
async function sessions(w,names){
  const call=await w.http(names);
  const api=who=>async path=>{const r=await call(who,'GET',path);if(r.status>=400)throw Object.assign(Error(r.text),{status:r.status});return r.json();};
  const submit=(who,spec,values)=>call(who,'POST',spec.endpoint,spec.toPayload(values));
  return {call,api,submit};
}
const cardOf=(html,name)=>html.split('<details class="vn-card">').slice(1).find(card=>card.includes(`<strong>${name}</strong>`))??'';

test('employees: a dated change awaiting approval shows its state, the second holder approves it from the card, and the recorder sees why not',async t=>{
  const w=hrCycle(t),{db}=w;
  const id=w.tx(()=>employees.recordChange(db,w.U.hr,'employee',{change_type:'job_title',to_value:'مصممة أولى تجريبية',effective_from:riyadh(20),reason:'ترقية تجريبية موثقة'})).change_id;
  const {api,submit}=await sessions(w,['hr','hr-manager','manager']);
  // من سجّله: الحال بكلمته وشكله، وزر الإلغاء وحده، وسطرٌ يقول من يعتمده.
  let data=await employeesUI.load(api('hr'));
  let html=employeesUI.render(data,context('employees')),card=cardOf(html,'الموظفة التجريبية');
  assert.match(card,/<span class="badge awaiting">ينتظر اعتماد زميل<\/span>/,'the state word from the server, with its shape');
  assert.match(card,/المسمى الوظيفي: «مصممة تجريبية» إلى «مصممة أولى تجريبية»/);
  assert.match(card,/<span class="vn-flag is-due">تنتظر اعتماد: <span data-num>1<\/span><\/span>/,'the row flag counts what awaits approval');
  assert.match(html,/<div class="vn-tile is-due"><strong>1<\/strong><span>تغيير وظيفي ينتظر اعتماد<\/span><\/div>/,'and so does the board');
  assert.deepEqual(buttonsOf(card).filter(b=>b.id===id).map(b=>b.action),['cancel_change'],'the recorder does not approve while a colleague can');
  assert.match(card,/يعتمده زميل ثاني يحمل «السجل الوظيفي»/);
  // الزميل الثاني: زر الاعتماد باسم ما يعتمده، ونموذجه يقول ما يُقرَّر ويرسل ما يقبله الخادم.
  data=await employeesUI.load(api('hr-manager'));
  card=cardOf(employeesUI.render(data,context('employees')),'الموظفة التجريبية');
  assert.deepEqual(buttonsOf(card).filter(b=>b.id===id).map(b=>[b.action,b.label]),[['approve_change','اعتماد تغيير المسمى الوظيفي'],['cancel_change','إلغاء تغيير المسمى الوظيفي']]);
  const spec=employeesUI.form('approve_change',id,data);
  assert.equal(spec.endpoint,`/employee-changes/${id}/approve`);
  assert.deepEqual(spec.fields.map(f=>[f.name,f.required]),[['note',false]]);
  assert.match(spec.fields[0].hint,/من «مصممة تجريبية» إلى «مصممة أولى تجريبية»، يسري من/);
  assert.deepEqual(spec.toPayload({note:''}),{},'an empty note is not sent');
  const approved=await submit('hr-manager',spec,{note:'اعتماد تجريبي من البطاقة'});
  assert.equal(approved.status,201,approved.text);
  data=await employeesUI.load(api('hr-manager'));
  html=employeesUI.render(data,context('employees'));card=cardOf(html,'الموظفة التجريبية');
  assert.match(card,/<span class="badge scheduled">معتمد — يسري في تاريخه<\/span>/);
  assert.match(card,/سجّله معتمدة خدمات الموظف واعتمده مديرة رأس المال البشري التجريبية/,'an open change names its two hands');
  assert.match(card,/<span class="vn-flag">تغييرات مجدولة: <span data-num>1<\/span><\/span>/);
  assert.match(html,/<div class="vn-tile "><strong>1<\/strong><span>تغيير معتمد ينتظر تاريخه<\/span><\/div>/);
  // الإلغاء بسبب مكتوب ينقله إلى «سرت أو انلغت» مطويًّا بعدده، بلا أسماء.
  const cancel=employeesUI.form('cancel_change',id,data);
  assert.equal(cancel.endpoint,`/employee-changes/${id}/cancel`);
  assert.equal((await submit('hr-manager',cancel,{reason:'أُلغيت الترقية التجريبية بقرار لاحق'})).status,201);
  card=cardOf(employeesUI.render(await employeesUI.load(api('hr-manager')),context('employees')),'الموظفة التجريبية');
  assert.match(card,/<details><summary>تغييرات سرت أو انلغت \(<span data-num>1<\/span>\)<\/summary>/);
  assert.match(card,/<span class="badge cancelled">ملغى<\/span>/);
  assert.doesNotMatch(card,/سجّله|اعتمده/,'a settled change is read as substance, not as who did what');
  // المدير يرى حال فريقه ولا يقرر فيه.
  const team=await employeesUI.load(api('manager'));
  assert.ok(team.rows.find(r=>r.user.id==='employee').changes.every(c=>c.actions.length===0));
  assert.throws(()=>employeesUI.form('approve_change',id,team),/مو متاح/);
});

test('employees: with no second holder the recorder approves with «سبب الاعتماد بيد معدّه», and the server holds the twenty-character line',async t=>{
  const w=hrCycle(t,{secondOfficer:false}),{db}=w;
  const id=w.tx(()=>employees.recordChange(db,w.U.hr,'employee',{change_type:'department',to_value:'production',effective_from:'2026-07-01',reason:'نقل تجريبي بقرار تجريبي'})).change_id;
  const {api,submit}=await sessions(w,['hr']);
  const data=await employeesUI.load(api('hr'));
  const card=cardOf(employeesUI.render(data,context('employees')),'الموظفة التجريبية');
  assert.match(card,/الإدارة: «الفريق الإبداعي التجريبي» إلى <bdi>production<\/bdi>/,'a department the screen cannot name stays isolated');
  assert.match(card,/فاعتمادك له يحتاج سبب مكتوب من 20 حرف أو أكثر/);
  const spec=employeesUI.form('approve_change',id,data);
  assert.deepEqual(spec.fields.map(f=>[f.name,f.label,f.required]),[['self_approval_reason','سبب الاعتماد بيد معدّه',undefined]]);
  const short=await submit('hr',spec,{self_approval_reason:'لا أحد غيري'});
  assert.equal(short.status,400);assert.equal(short.json().error.code,'invalid_text');
  const done=await submit('hr',spec,{self_approval_reason:'لا يحمل «السجل الوظيفي» في هذا الكيان التجريبي غيري، والنقل مستحق من أول يوليو'});
  assert.equal(done.status,201,done.text);assert.equal(done.json().applied,true);
});

test('employees: an approved change that came due is applied on request from the head of the screen, and the count is said once',async t=>{
  const w=hrCycle(t),{db}=w;
  const id=w.tx(()=>employees.recordChange(db,w.U.hr,'employee',{change_type:'employment_type',to_value:'part_time',effective_from:riyadh(2),reason:'تحويل تجريبي إلى دوام جزئي'})).change_id;
  w.tx(()=>employees.approveChange(db,w.U['hr-manager'],id,{}));
  t.mock.timers.enable({apis:['Date'],now:Date.now()+4*DAY});
  const {api,submit}=await sessions(w,['hr']);
  const data=await employeesUI.load(api('hr'));
  const html=employeesUI.render(data,context('employees'));
  assert.match(cardOf(html,'الموظفة التجريبية'),/<span class="badge due_soon">معتمد وحلّ تاريخه — لم يسرِ بعد<\/span>/);
  assert.match(html,/تغييرات معتمدة حلّ تاريخها وما سرت للحين: <span data-num>1<\/span>/);
  assert.deepEqual(buttonsOf(html).filter(b=>b.action==='apply_due').map(b=>b.label),['تطبيق التغييرات المستحقة الحين']);
  const spec=employeesUI.form('apply_due','',data);
  assert.equal(spec.endpoint,'/employee-changes/apply-due');
  const saved=await submit('hr',spec,{});
  assert.equal(saved.status,201,saved.text);
  assert.match(spec.after(saved.json(),e).html,/سرى الحين: تغيير واحد/);
  assert.match(spec.after({applied:0},e).html,/ما سرى شي/);
  const after=await employeesUI.load(api('hr'));
  assert.equal(after.rows.find(r=>r.user.id==='employee').profile.employment_type,'part_time');
  assert.equal(buttonsOf(employeesUI.render(after,context('employees'))).some(b=>b.action==='apply_due'),false,'nothing due, no button');
});

test('employees: once a profile exists its dated fields are read, not edited — the form sends the join date alone and points to «تغيير وظيفي مؤرخ»',async t=>{
  const w=hrCycle(t);
  const {api,submit}=await sessions(w,['hr']);
  const data=await employeesUI.load(api('hr'));
  const spec=employeesUI.form('save_profile','employee',data);
  assert.deepEqual(spec.fields.map(f=>[f.name,f.type]),[['dated','hidden'],['join_date','date']]);
  for(const fact of ['المسمى الوظيفي: مصممة تجريبية','نوع التعاقد: دوام كامل','الحالة: على رأس العمل','نهاية العقد: بلا تاريخ نهاية','الإدارة: الفريق الإبداعي التجريبي','المدير المباشر: مدير الفريق التجريبي','«تغيير وظيفي مؤرخ»'])
    assert.ok(spec.fields[0].hint.includes(fact),fact);
  const rendered=operationFields(spec.fields,e);
  assert.match(rendered,/<label class=""><span>يتغير بـ«تغيير وظيفي مؤرخ» <\/span><input name="dated"\s+type="hidden" value=""\s*><small class="subtle">/,'a line to read, with no control and no required mark');
  assert.deepEqual(spec.toPayload({dated:'',join_date:'2025-01-05'}),{join_date:'2025-01-05',version:1});
  const saved=await submit('hr',spec,{dated:'',join_date:'2025-01-05'});
  assert.equal(saved.status,201,saved.text);
  assert.deepEqual([saved.json().profile.join_date,saved.json().profile.job_title],['2025-01-05','مصممة تجريبية']);
  // ملفٌ لم يُنشأ بعد: بداية سجل، فحقوله كلها تُكتب.
  assert.deepEqual(employeesUI.form('save_profile','outsider',data).fields.map(f=>f.name),['job_title','employment_type','join_date','contract_end','status']);
});

test('employees: the hire link (candidate, then contract) is on the card for those who work on the record, and nowhere else',async t=>{
  const w=hrCycle(t),{db}=w,h=w.hire();
  w.tx(()=>people.linkHire(db,w.U.hr,h.candidate.id,{version:h.candidate.version,user_id:h.userId,evidence:'ربط تجريبي للحساب وحده'}));
  const {api}=await sessions(w,['hr','manager']);
  let card=cardOf(employeesUI.render(await employeesUI.load(api('hr')),context('employees')),`موظف جديد تجريبي ${h.userId}`);
  assert.match(card,/جاء من التوظيف: انربط حسابه بملف ترشيحه في <time datetime="\d{4}-\d{2}-\d{2}">/);
  assert.match(card,/وعقده ما انربط للحين/);
  assert.ok(card.includes(`<a class="btn outline small" href="#people?focus=${h.candidate.id}">فتح ملف التوظيف</a>`));
  w.tx(()=>people.linkHire(db,w.U.hr,h.candidate.id,{version:people.getPeopleRecord(db,w.U.hr,h.candidate.id).version,contract_id:h.contractId,evidence:'ربط تجريبي للعقد'}));
  card=cardOf(employeesUI.render(await employeesUI.load(api('hr')),context('employees')),`موظف جديد تجريبي ${h.userId}`);
  assert.match(card,/وعقده في <time datetime="\d{4}-\d{2}-\d{2}">/);
  const team=await employeesUI.load(api('manager'));
  assert.equal(team.rows.find(r=>r.user.id===h.userId)?.hire,null,'the hiring manager reads the team, not the candidate file');
  assert.doesNotMatch(employeesUI.render(team,context('employees')),/جاء من التوظيف/);
});

test('people: «link_hire» has its label and its form — account, then that account’s own contract — and the link shows on the candidate',async t=>{
  const w=hrCycle(t),h=w.hire();
  const {api,submit}=await sessions(w,['hr','manager']);
  let data=await peopleUI.load(api('hr'));
  assert.ok(data.hire_options.accounts.some(a=>a.id===h.userId));
  assert.equal(data.hire_options.accounts.some(a=>a.id==='hr'),false,'not the linker’s own account');
  assert.ok(data.hire_options.contracts.every(c=>c.status_name&&!('monthly_total_minor' in c)),'contracts by state and dates, no money');
  let html=peopleUI.render(data,context('people'));
  const link=buttonsOf(html).find(b=>b.action==='link_hire');
  assert.deepEqual([link.id,link.label],[h.candidate.id,'ربط المرشح بحسابه وعقده'],'no blank button');
  let spec=peopleUI.form('link_hire',h.candidate.id,data);
  assert.equal(spec.endpoint,`/people/${h.candidate.id}/link_hire`);
  const fields=Object.fromEntries(spec.fields.map(f=>[f.name,f]));
  assert.deepEqual(spec.fields.map(f=>f.name),['user_id','contract_id','evidence']);
  assert.ok(fields.user_id.options.some(o=>o.value===h.userId));
  const name=`موظف جديد تجريبي ${h.userId}`;
  assert.ok(fields.contract_id.options.some(o=>o.value===h.contractId&&o.label===`${name} — ساري · من 2026-06-01`),'each contract carries its owner’s name');
  assert.equal(fields.contract_id.required,false,'the contract can follow later');
  assert.throws(()=>spec.toPayload({user_id:'outsider',contract_id:h.contractId,evidence:'عقد لغير الحساب'}),/لحساب غير الحساب المختار/,'another account’s contract is stopped before sending');
  // الحساب وحده أولًا، ثم العقد بنموذجه هو.
  assert.deepEqual(spec.toPayload({user_id:h.userId,contract_id:'',evidence:'ربط الحساب أولًا'}),{version:h.candidate.version,user_id:h.userId,evidence:'ربط الحساب أولًا'});
  let saved=await submit('hr',spec,{user_id:h.userId,contract_id:'',evidence:'ربط الحساب أولًا'});
  assert.equal(saved.status,201,saved.text);
  data=await peopleUI.load(api('hr'));html=peopleUI.render(data,context('people'));
  assert.ok(html.includes(`<a href="#employee-profile/${h.userId}">موظف جديد تجريبي ${h.userId}</a>`),'the candidate names the account it became');
  assert.match(html,/<dt>العقد المربوط<\/dt><dd>ينتظر الربط<\/dd>/);
  assert.equal(buttonsOf(html).find(b=>b.action==='link_hire').label,'ربط عقد الموظف بملف توظيفه');
  spec=peopleUI.form('link_hire',h.candidate.id,data);
  assert.deepEqual(spec.fields.map(f=>f.name),['contract_id','evidence']);
  saved=await submit('hr',spec,{contract_id:h.contractId,evidence:'ربط العقد بعد اعتماده'});
  assert.equal(saved.status,201,saved.text);assert.equal(saved.json().hire.contract_id,h.contractId);
  html=peopleUI.render(await peopleUI.load(api('hr')),context('people'));
  assert.match(html,/<dt>العقد المربوط<\/dt><dd>مربوط من <time datetime="\d{4}-\d{2}-\d{2}">/);
  assert.equal(buttonsOf(html).some(b=>b.action==='link_hire'),false,'a complete link has no button');
  // مدير الاحتياج يقرأ الرابط ولا يربط.
  const manager=await peopleUI.load(api('manager'));
  assert.equal(manager.hire_options,null);
  assert.match(peopleUI.render(manager,context('people')),/<dt>الحساب المربوط<\/dt>/);
});

test('people: a candidate waiting for a contract that does not exist yet says what is missing instead of opening an empty list',async t=>{
  const w=hrCycle(t),{db}=w,h=w.hire();
  // الحساب المربوط بلا عقد قائم (منفذ الدعم التقني في هذا العالم بلا عقد): لا قائمة عقود تُفتح فارغة.
  w.tx(()=>people.linkHire(db,w.U.hr,h.candidate.id,{version:h.candidate.version,user_id:'it',evidence:'ربط تجريبي للحساب وحده'}));
  const {api}=await sessions(w,['hr']);
  const data=await peopleUI.load(api('hr'));
  const html=peopleUI.render(data,context('people'));
  assert.equal(buttonsOf(html).some(b=>b.action==='link_hire'),false);
  assert.match(html,/ربط العقد ينتظر عقد الموظف: يُعد ويُقدَّم من «العقود وبنود الراتب»/);
  assert.throws(()=>peopleUI.form('link_hire',h.candidate.id,data),/مو متاح/);
});

test('payroll: the run says when its inputs changed after calculation, by name, in the refusal’s own shape — and draws no button the server refuses',async t=>{
  const w=hrCycle(t);
  let september=w.prepare('2026-09');
  w.absence('employee','2026-09-14');
  const {api,call}=await sessions(w,['hr','reviewer']);
  let html=payrollUI.render(await payrollUI.load(api('hr')),context('payroll'));
  assert.match(html,/<div class="vn-alert is-block" role="alert"><strong>مدخلات مسير 2026-09 تغيّرت بعد احتسابه، فسطوره ما عادت تطابق مصادرها<\/strong><ul class="vn-list"><li><strong>الغياب<\/strong><span>تغيّر بعد الاحتساب · عند: مُعد الرواتب<\/span><\/li><\/ul><p>الخطوة التالية: أعد احتساب المسير، وبعدها قدّمه<\/p><\/div>/);
  let actions=buttonsOf(html).map(b=>b.action);
  assert.ok(actions.includes('recalculate'));assert.equal(actions.includes('submit_run'),false,'submission would be refused by inputs_changed');
  // والرفض نفسه حين يصل من الخادم يحمل ما يرسمه ui.refusal في نافذة الإجراء (error.details.refusal).
  const refused=await call('hr','POST',`/payroll/runs/${september.id}/submit_run`,payrollUI.form('recalculate',september.id,await payrollUI.load(api('hr'))).toPayload({}));
  assert.equal(refused.status,409);assert.equal(refused.json().error.code,'inputs_changed');
  assert.match(kit(e).refusal({details:refused.json().error.details}),/الغياب المعتمد بلا أجر/);
  // بعد إعادة الاحتساب: سطرٌ هادئ، وزر التقديم.
  september=w.run('hr',w.view('hr',september),'recalculate');
  html=payrollUI.render(await payrollUI.load(api('hr')),context('payroll'));
  assert.match(html,/<p class="subtle">مدخلات المسير ما تغيّرت بعد احتسابه.<\/p>/);
  assert.ok(buttonsOf(html).some(b=>b.action==='submit_run'));
  // بعد التقديم: تغيّرٌ يمنع المراجعة، والخطوة إعادته للمسودة.
  september=w.run('hr',september,'submit_run');
  w.absence('outsider','2026-09-15');
  html=payrollUI.render(await payrollUI.load(api('reviewer')),context('payroll'));
  assert.match(html,/<strong>الغياب<\/strong><span>تغيّر بعد الاحتساب · عند: المراجع أو المعتمد يرجّعه للمسودة، ومُعد الرواتب يعيد احتسابه<\/span>/);
  assert.match(html,/الخطوة التالية: يرجّعه المراجع أو المعتمد للمسودة بسبب مكتوب/);
  actions=buttonsOf(html).filter(b=>b.id===september.id).map(b=>b.action);
  assert.ok(actions.includes('return_run'));assert.equal(actions.includes('pass_review'),false);
  // التعليق القديم «يربطه فريق الخادم» خرج: المسار موصول.
  assert.doesNotMatch(readFileSync(new URL('../app/static/payroll-ui.mjs',import.meta.url),'utf8'),/يربطه فريق الخادم/);
});

test('payroll extras: a locked month and a withdrawn leave effect draw no approve button, a refund is named, and an approved withdrawn deduction is «مستبعد من المسير»',async t=>{
  const w=hrCycle(t);
  // يوليو: خصم إجازة اعتُمد وصُرف، ثم أُلغيت الإجازة فاقتُرح ردّه.
  const paid=w.unpaidLeave('2026-07-05','2026-07-09');
  const [paidEffect]=w.effectsOf(paid.id);w.decide(paidEffect.adjustment_id);
  w.approveMonth('2026-07');
  w.leaveAct('hr',w.leave('hr',paid.id),'cancel',{note:'إلغاء تجريبي بعد صرف المسير'});
  // أغسطس: خصمٌ اعتُمد ولم يُصرف ثم أُلغيت إجازته، وخصمٌ مقترح أُلغيت إجازته، ومكافأة مقترحة ثم تقدّم مسير الشهر للمراجعة.
  const kept=w.unpaidLeave('2026-08-02','2026-08-03');const [keptEffect]=w.effectsOf(kept.id);w.decide(keptEffect.adjustment_id);
  const open=w.unpaidLeave('2026-08-10','2026-08-10');const [openEffect]=w.effectsOf(open.id);
  w.leaveAct('hr',w.leave('hr',kept.id),'cancel',{note:'إلغاء تجريبي قبل صرف المسير'});
  w.leaveAct('hr',w.leave('hr',open.id),'cancel',{note:'إلغاء تجريبي للمقترح'});
  const bonus=w.propose({user_id:'outsider',kind:'bonus',month:'2026-08',amount:'250.00'});
  w.run('hr',w.prepare('2026-08'),'submit_run');
  const {api,call}=await sessions(w,['hr','hr-manager']);
  const data=await payrollExtrasUI.load(api('hr-manager'));
  assert.deepEqual(data.locked_months.map(m=>[m.month,m.status]),[['2026-08','in_review'],['2026-07','approved']]);
  const html=payrollExtrasUI.render(data,context('payroll-extras'));
  const item=id=>html.split('<li>').find(li=>li.includes(`adjustment:${id}`)||li.includes(id))??'';
  const rowOf=adjustmentId=>html.split('<li>').find(li=>li.includes(`data-id="adjustment:${adjustmentId}"`))??'';
  const actionsOf=adjustmentId=>buttonsOf(html).filter(b=>b.id===`adjustment:${adjustmentId}`).map(b=>b.action);
  // الشهر المقفل: لا زر اعتماد، والسطر يقول لماذا وما التالي؛ والخادم يرفض فعلًا بـmonth_locked.
  assert.deepEqual(actionsOf(bonus),['reject_adjustment']);
  assert.match(rowOf(bonus),/مسير <time datetime="2026-08">2026-08<\/time> «قيد المراجعة»، وما يدخله شي جديد: يرجّع المراجع أو المعتمد المسير للمسودة/);
  const locked=await call('hr-manager','POST',`/payroll/adjustments/${bonus}/approve`,{note:'محاولة اعتماد على شهر مقفل'});
  assert.equal(locked.json().error.code,'month_locked');
  // خصم إجازة انلغت وهو مقترح: الرفض وحده، والخادم يرفض الاعتماد بـleave_effect_withdrawn.
  assert.deepEqual(actionsOf(openEffect.adjustment_id),['reject_adjustment']);
  assert.match(rowOf(openEffect.adjustment_id),/· خصم أثر إجازة ·/);
  assert.match(rowOf(openEffect.adjustment_id),/الإجازة اللي ولّدته انلغت، فما ينعتمد: ارفضه بسبب مكتوب/);
  const withdrawn=await call('hr-manager','POST',`/payroll/adjustments/${openEffect.adjustment_id}/approve`,{note:'محاولة اعتماد خصم إجازة ملغاة'});
  assert.equal(withdrawn.json().error.code,'leave_effect_withdrawn');
  // المعتمد قبل صرفه: معتمد ولا يُصرف أبدًا.
  const keptRow=html.split('<li>').find(li=>li.includes('2 يوم بأجر 0%'))??'';
  assert.match(keptRow,/<span class="vn-flag withdrawn">مستبعد من المسير<\/span>/);
  assert.match(keptRow,/فهالخصم يبقى معتمد وما يدخل أي مسير/);
  // المصروف قبل الإلغاء: ردّه حركة مسمّاة.
  const refund=data.adjustments.find(a=>a.leave_refund);
  assert.equal(refund.leave_refund.paid_run_month,'2026-07');
  assert.match(item(refund.id),/· ردّ خصم إجازة انلغت ·/);
  assert.match(item(refund.id),/يرد خصم إجازة انلغت بعد ما انصرف في مسير <time datetime="2026-07">2026-07<\/time>/);
  assert.match(html.split('<li>').find(li=>li.includes('5 يوم بأجر 0%'))??'',/انصرف في مسير <time datetime="2026-07">2026-07<\/time> قبل ما تنلغي الإجازة، وردّه حركة رد مستقلة/);
  // ومن يقترح يعرف الأشهر المقفلة قبل الحفظ.
  const propose=payrollExtrasUI.form('propose_adjustment','',await payrollExtrasUI.load(api('hr')));
  assert.equal(propose.fields.find(f=>f.name==='month').hint,'ما تنقبل حركة على شهر تجاوز مسيره المسودة: 2026-08 (قيد المراجعة)، 2026-07 (معتمد ومقفل).');
});

test('leave: the employee whose leave deduction was paid has no cancel button the server would refuse — HR keeps it, and the effect says it was deducted',async t=>{
  const w=hrCycle(t),{db}=w;
  const paid=w.unpaidLeave('2026-07-05','2026-07-09');
  const [effect]=w.effectsOf(paid.id);w.decide(effect.adjustment_id);
  // قبل الصرف: الإجازة قادمة (الساعة في أول يوليو)، وخصمها معتمد لم يُصرف، فلصاحبتها أن تلغيها.
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-07-01T06:00:00.000Z')});
  let own={...listLeave(db,w.U.employee),user:w.U.employee},request=own.requests.find(r=>r.id===paid.id);
  assert.equal(request.pay_effect_paid,false);
  assert.ok(buttonsOf(leaveUI.render(own,context('leave'))).some(b=>b.action==='cancel'&&b.id===paid.id));
  assert.match(leaveUI.render(own,context('leave')),/خصم معتمد، وينخصم مع مسير <time datetime="2026-07">2026-07<\/time>/);
  t.mock.timers.reset();
  w.approveMonth('2026-07');
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-07-01T06:00:00.000Z')});
  own={...listLeave(db,w.U.employee),user:w.U.employee};request=own.requests.find(r=>r.id===paid.id);
  assert.ok(request.actions.includes('cancel'),'the server still lists the action');
  assert.equal(request.pay_effect_paid,true);
  const html=leaveUI.render(own,context('leave'));
  assert.equal(buttonsOf(html).some(b=>b.action==='cancel'&&b.id===paid.id),false,'no button that paid_leave_effect refuses');
  assert.match(html,/خصم هالإجازة انصرف في مسير معتمد، فإلغاؤها يمر بخدمات الموظف/);
  assert.match(html,/انخصم من مسير <time datetime="2026-07">2026-07<\/time>/,'the effect is not called «not deducted yet» any more');
  assert.throws(()=>leaveUI.form('cancel',paid.id,own),/فإلغاؤها يمر بخدمات الموظف/);
  const hr={...listLeave(db,w.U.hr),user:w.U.hr};
  assert.ok(buttonsOf(leaveUI.render(hr,context('leave'))).some(b=>b.action==='cancel'&&b.id===paid.id),'HR cancels it, and the refund is proposed');
});
