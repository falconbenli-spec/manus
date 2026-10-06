import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { validatePayload } from '../app/validation.mjs';
import { writeFeedback, feedbackBoard } from '../app/feedback.mjs';
import { submitClaim, claimAction, expensesBoard } from '../app/expenses.mjs';
import { countNoun, countEn, NOUNS } from '../app/static/arabic-count.mjs';
import { operationFields } from '../app/static/operations.mjs';
import { pulseUI } from '../app/static/engagement-ui.mjs';
import { timesheetsUI } from '../app/static/resourcing-ui.mjs';
import { contractsUI } from '../app/static/contracts-ui.mjs';
import { todayCard } from '../app/static/home-ui.mjs';

// الجولة الثانية من انحدارات تدقيق بوابة الموظف (docs/product/audits/EMPLOYEE-PORTAL-AUDIT-20260919.md):
// المتوسط والمنخفض المتبقيان بعد docs/implementation/handoff/portal-fixes-20260919.md.
const PASSWORD='synthetic-portal-round2-tests-only';
const code=value=>error=>error.code===value;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  const users=()=>Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,users:users(),reload:users,tx:f=>transaction(db,f)};
}

/* ───── B9: النقص يُعلن كاملًا لا حقلًا حقلًا ───── */

test('B9: every missing required field is named in one message, with its keys in details',()=>{
  const fields=[{key:'month',label:'شهر المسير',type:'text',required:true},
    {key:'amount',label:'المبلغ محل الاستفسار',type:'text',required:true},
    {key:'note',label:'تفاصيل إضافية',type:'textarea',required:false}];
  const caught=f=>{try{f();}catch(error){return error;}throw Error('expected a rejection');};
  const error=caught(()=>validatePayload(fields,{month:'',amount:'',note:''},true));
  assert.equal(error.code,'missing_field');
  assert.match(error.message,/شهر المسير/);
  assert.match(error.message,/المبلغ محل الاستفسار/,'الحقل الثاني يظهر في الرسالة نفسها لا بعد تصحيح الأول');
  assert.doesNotMatch(error.message,/تفاصيل إضافية/,'الاختياري ليس نقصًا');
  assert.deepEqual(error.details.fields,['month','amount']);
  // حقل واحد ناقص يبقى بالصيغة المفردة القديمة.
  assert.match(caught(()=>validatePayload(fields,{month:'2026-09',amount:'',note:''},true)).message,/^الحقل مطلوب: المبلغ محل الاستفسار$/);
  // الحفظ كمسودة (required=false) لا يُعلن نقصًا، فالمسودة نصف مكتملة غرضها.
  assert.deepEqual(validatePayload(fields,{month:'2026-09',amount:'',note:''},false),{month:'2026-09'});
});

/* ───── B10: كل فعل في سجل المعاملة له اسم، بالعربية والإنجليزية ───── */

test('B10: the activity record names every audit action the server writes, in both languages',()=>{
  const app=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  const timeline=readFileSync(new URL('../app/request-timeline.mjs',import.meta.url),'utf8');
  const written=[...timeline.matchAll(/^\s*'?([a-z_.]+)'?:\{text:/gm)].map(m=>m[1]);
  assert.ok(written.includes('service.feedback_recorded'),'الفعل الذي كشفه التدقيق ما زال يكتبه الخادم');
  const named=new Set([...app.matchAll(/[\s{,]'?([a-z_.]+)'?:\['/g)].map(m=>m[1]));
  // أفعال الأزرار (actionNames) تغطي submit/approve/return/reject/cancel/claim/complete/escalate.
  for(const action of written){
    assert.ok(named.has(action),`سجل المعاملة لا يعرف ${action}، فيقرأ «إجراء آخر»`);
  }
  // لا اسم عربي وحيد بلا مقابل إنجليزي في خريطة السجل.
  const map=app.slice(app.indexOf('const auditNames='),app.indexOf('const actionLabel='));
  assert.ok(map.includes("'service.feedback_recorded':['تقييم الخدمة','Service rated']"));
  assert.doesNotMatch(map,/:\['[^']*'\]/,'كل مدخل صورتان لا صورة واحدة');
});

/* ───── B13: بلاطات المعتمِد لا تظهر لمن لا يعتمد ───── */

test('B13: the weekly timesheet hides approver tiles and blocks from someone who cannot approve',()=>{
  const data={note:'ملاحظة تجريبية',week:{from:'2026-09-13',to:'2026-09-19',closed:true},
    my_period:{minutes:480,status:'submitted',status_name:'مُرسل',entries:[],actions:[],decision_note:null},
    pending:[{id:'p1',employee_name:'زميل','week_start':'2026-09-13',week_end:'2026-09-19',status:'submitted',status_name:'مُرسل',minutes:60,entry_count:1,actions:[],submit_note:''}],
    missing:[{name:'زميل',week_start:'2026-09-13',status:'submitted',entry_count:0,reminded_at:null}],
    reminders:[],team_weeks:[],correctable:[],lock:null,can_approve:false};
  const button=()=>'';
  const employee=timesheetsUI.render(data,{e:esc,button});
  assert.doesNotMatch(employee,/أسبوع ينتظر قراري/,'لا بلاطة قرار لمن لا يعتمد');
  assert.doesNotMatch(employee,/لم يرسلوا أسبوعًا منتهيًا/);
  assert.match(employee,/ساعاتي في الأسبوع/,'بلاطاته الشخصية تبقى');
  const approver=timesheetsUI.render({...data,can_approve:true},{e:esc,button});
  assert.match(approver,/أسبوع ينتظر قراري/);
  assert.match(approver,/لم يرسلوا أسبوعًا منتهيًا/);
});

/* ───── B17: استبيان النبض لا يبدأ على أدنى درجة ───── */

test('B17: a pulse question opens with no answer chosen, so an untouched question cannot submit 1',()=>{
  const cycle={id:'c1',title:'نبض تجريبي',version:1,actions:['answer_pulse'],
    questions:[{id:'q1',kind:'agreement',prompt:'أجد ما يلزمني لإنجاز عملي'},{id:'q2',kind:'enps',prompt:'أرشّح العمل هنا'},{id:'q3',kind:'comment',prompt:'ملاحظة حرة'}]};
  const spec=pulseUI.form('answer_pulse','c1',{cycles:[cycle],can_manage:false});
  const [agreement,enps,comment]=spec.fields;
  assert.equal(agreement.options[0].value,'','أول خيار فارغ');
  assert.equal(agreement.value,'','ولا قيمة مختارة مسبقًا');
  assert.equal(enps.options[0].value,'');
  assert.equal(comment.required,false,'التعليق وحده اختياري');
  const html=operationFields(spec.fields,esc);
  const firstSelect=html.slice(html.indexOf('<select'),html.indexOf('</select>'));
  assert.match(firstSelect,/required/,'السؤال مطلوب');
  assert.match(firstSelect,/<option value="" [^>]*>— اختر درجة —/,'الخيار الفارغ أولًا فلا تُرسل «1» دون قصد');
  assert.ok(firstSelect.indexOf('— اختر درجة —')<firstSelect.indexOf('>1<'),'الفارغ قبل أدنى درجة');
  assert.doesNotMatch(firstSelect,/value="1"\s*selected/);
});

/* ───── B18: مرئية الملاحظة تُثبَّت وقت كتابتها ───── */

test('B18: a note visible to the recipient’s manager stays with the manager of the day it was written',t=>{
  const {db,users,reload,tx}=fixture(t);
  // الكاتب زميل، والمستلم موظف يتبع المدير التجريبي.
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('colleague','36t','creative','colleague','زميل تجريبي','unused','employee','manager'),('manager-b','36t','creative','manager-b','مدير ثانٍ تجريبي','unused','manager',NULL)").run();
  const before=reload();
  tx(()=>writeFeedback(db,before.colleague,{subject_id:'employee',kind:'appreciation',visibility:'recipient_manager',
    body:'ملاحظة اختبار محلية مصطنعة عن إنجاز محدد في مشروع تجريبي.',occurred_on:new Date(Date.now()+3*3600000).toISOString().slice(0,10)}));
  const seenBy=who=>feedbackBoard(db,reload()[who]).notes.length;
  assert.equal(seenBy('manager'),1,'مدير المستلم وقت الكتابة يقرؤها');
  assert.equal(seenBy('manager-b'),0);
  const stored=db.prepare('SELECT visible_manager_id FROM feedback_notes').get();
  assert.equal(stored.visible_manager_id,'manager','المرئية مقيدة بالاسم لا محسوبة لحظة القراءة');
  // نقل الموظف إلى مدير آخر: لا المدير الجديد يقرأ ما كُتب قبله، ولا تُنزع من المدير الذي كُتبت له.
  db.prepare("UPDATE users SET manager_id='manager-b' WHERE id='employee'").run();
  assert.equal(seenBy('manager-b'),0,'المدير الجديد لا يقرأ ملاحظة كُتبت تحت غيره');
  assert.equal(seenBy('manager'),1);
  assert.equal(seenBy('employee'),1,'المستلم يقرأ ملاحظته دائمًا');
  // الصف لا يُعدَّل بعد كتابته، بما فيه المدير المثبت (ترحيل 106).
  assert.throws(()=>db.prepare("UPDATE feedback_notes SET visible_manager_id='manager-b',version=version+1").run(),/written once/);
  assert.equal(verifyAudit(db),true);
});

/* ───── B19: فصل المهام في مطالبات المصروفات ───── */

test('B19: one person cannot take both the manager step and the finance step on a claim',t=>{
  const {db,users,reload,tx}=fixture(t);
  // مطالب بلا مدير مباشر: هذه هي الحالة التي كانت تفتح خطوة المدير لحامل الاعتماد المالي.
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('orphan','36t','creative','orphan','موظف بلا مدير','unused','employee',NULL),('finance','36t','ops','finance-one','أمين خزينة مصطنع','unused','employee',NULL),('finance-b','36t','ops','finance-b','أمين خزينة ثانٍ مصطنع','unused','employee',NULL)").run();
  const seeded=reload();
  for(const who of ['finance','finance-b'])for(const action of ['read','configure','approve','post'])
    db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'36t',who,seeded[who].role,action,'2020-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z','admin','تفويض مالي مصطنع للاختبار',null,now());
  const claim=tx(()=>submitClaim(db,reload().orphan,{expense_date:new Date(Date.now()+3*3600000).toISOString().slice(0,10),
    category:'hospitality',amount:'230.00',receipt_reference:'INV-TEST-7781',description:'ضيافة اجتماع تجريبي محلي'}));
  const financeUser=()=>reload().finance;
  const mine=who=>expensesBoard(db,reload()[who]).claims.find(c=>c.id===claim.id);
  assert.ok(mine('finance').actions.includes('manager_approve'),'بلا مدير مباشر تفتح خطوة المدير لحامل الاعتماد');
  const approved=tx(()=>claimAction(db,financeUser(),claim.id,'manager_approve',{version:mine('finance').version,note:'أقر الغرض نيابة عن المدير الغائب'}));
  assert.equal(approved.status,'manager_approved');
  const same=mine('finance');
  assert.ok(!same.actions.includes('finance_approve'),'من أقرّها بصفة المدير لا يعتمدها ماليًا');
  assert.ok(same.actions.includes('reject_claim'),'الرفض يبقى له حتى لا تعلق المطالبة');
  assert.throws(()=>tx(()=>claimAction(db,financeUser(),claim.id,'finance_approve',{version:same.version,note:'محاولة جمع الخطوتين'})),code('action_unavailable'));
  // شخص ثانٍ يحمل الاعتماد المالي يكملها.
  const other=expensesBoard(db,reload()['finance-b']).claims.find(c=>c.id===claim.id);
  assert.ok(other.actions.includes('finance_approve'));
  assert.equal(tx(()=>claimAction(db,reload()['finance-b'],claim.id,'finance_approve',{version:other.version,note:'طابقت الإيصال ورقمه'})).status,'finance_approved');
  assert.equal(verifyAudit(db),true);
});

/* ───── B22: تمييز العدد في العربية ───── */

test('B22: counts read as Arabic, not as a number glued to a singular',()=>{
  assert.equal(countNoun(1,'service'),'خدمة واحدة');
  assert.equal(countNoun(2,'service'),'خدمتان');
  assert.equal(countNoun(3,'service'),'3 خدمات');
  assert.equal(countNoun(10,'service'),'10 خدمات');
  assert.equal(countNoun(11,'service'),'11 خدمة');
  assert.equal(countNoun(15,'day'),'15 يومًا');
  assert.equal(countNoun(6,'working_day'),'6 أيام عمل');
  assert.equal(countNoun(1,'working_day'),'يوم عمل واحد');
  assert.equal(countNoun(1,'department'),'إدارة واحدة');
  assert.equal(countNoun(1,'earlier_request'),'طلب سابق واحد');
  assert.equal(countNoun(0,'service'),'0 خدمات');
  assert.equal(countNoun(1.5,'day'),'1.5 يوم','الكسر بالمفرد بلا تنوين');
  assert.equal(countEn(1,'working day'),'1 working day');
  assert.equal(countEn(3,'working day'),'3 working days');
  // كل اسم أربع صور، ولا صورة فارغة.
  for(const [key,shapes] of Object.entries(NOUNS)){
    assert.equal(shapes.length,4,`${key}: أربع صور`);
    assert.ok(shapes.every(s=>typeof s==='string'&&s.trim()),`${key}: لا صورة فارغة`);
  }
  // الصور المعيبة التي رصدها التدقيق لم تعد تُنتج.
  for(const bad of ['3 خدمة','10 خدمة','1 إدارات','15 يوم','6 يوم عمل']){
    const [n,...rest]=bad.split(' ');
    assert.notEqual(`${countNoun(Number(n),rest.join(' ')==='يوم عمل'?'working_day':rest.join(' ')==='إدارات'?'department':rest.join(' ')==='يوم'?'day':'service')}`,bad);
  }
});

test('B22: the launcher, the catalog and the home screen use the shared helper',()=>{
  for(const file of ['request-picker.mjs','home-ui.mjs','app.mjs']){
    const source=readFileSync(new URL('../app/static/'+file,import.meta.url),'utf8');
    assert.match(source,/from '\.\/arabic-count\.mjs'/,`${file} لا يستورد وحدة تمييز العدد`);
  }
  const picker=readFileSync(new URL('../app/static/request-picker.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(picker,/\$\{total\} خدمة/,'عدد نتائج البحث لم يعد ملصقًا بالمفرد');
  assert.doesNotMatch(picker,/\$\{g\.count\} خدمة/);
  const home=readFileSync(new URL('../app/static/home-ui.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(home,/\$\{n\} يوم`/,'أيام الرئيسية تمر بالمساعد');
});

/* ───── B23 وB24 وB26 وB34: صفحة الطلب وحرف الحساب ───── */

test('B23/B24/B26/B34: the request page reads for its owner — «—» for optional, a reference, a time, and a real initial',()=>{
  const app=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  // B23: الاختياري الفارغ «—»، والمطلوب وحده «لم يُستكمل».
  assert.match(app,/const fieldValue=\(f,value\)=>value\|\|\(f\.required\?tr\('لم يُستكمل','Not provided'\):'—'\)/);
  assert.match(app,/\$\{e\(fieldValue\(f,r\.payload\[f\.key\]\)\)\}/);
  // B24: المسودة لا تقول «النسخة المقدمة 0»، وللطلب مرجع قصير مسمى.
  assert.match(app,/r\.revision\?.*:tr\('مسودة لم تُقدَّم بعد','Draft, not submitted yet'\)/);
  assert.match(app,/tr\('المرجع','Reference'\)/);
  assert.match(app,/tr\('المرجع الكامل','Full reference'\)/);
  // B34: سجل المعاملة بوقت لا بتاريخ وحده.
  assert.match(app,/const dateTime=value=>new Intl\.DateTimeFormat\([^)]*\{dateStyle:'medium',timeStyle:'short',timeZone:'Asia\/Riyadh'\}/);
  assert.match(app,/<time datetime="\$\{e\(a\.created_at\)\}">\$\{e\(dateTime\(a\.created_at\)\)\}<\/time>/);
  assert.doesNotMatch(app,/\$\{e\(date\(a\.created_at\)\)\} · \$\{e\(a\.actor_name/,'لم يبق سطر زمني بلا ساعة');
  // B26: حرف الصورة الرمزية يتخطى أداة التعريف.
  assert.match(app,/initial=e\(nameInitial\(me\.name\)\)/);
  const initial=new Function(app.slice(app.indexOf('function nameInitial'),app.indexOf('const badge=s=>'))+';return nameInitial;')();
  assert.equal(initial('الموظفة التجريبية'),'م','«ال» ليست حرف أحد');
  assert.equal(initial('محمد العتيبي'),'م');
  assert.equal(initial('Alice Example'),'A');
  assert.equal(initial('ال'),'ا','اسم من حرفين يبقى كما هو');
  assert.equal(initial(''),'؟');
  assert.equal(initial(null),'؟');
});

/* ───── B27: لوحة أرقام لحقل المبلغ على الجوال ───── */

test('B27: money fields open a number keypad without changing their type or server rules',()=>{
  const html=operationFields([{name:'amount',label:'المبلغ شامل الضريبة',type:'text',inputmode:'decimal',placeholder:'0.00'}],esc);
  assert.match(html,/inputmode="decimal"/);
  assert.match(html,/dir="ltr"/,'الرقم يُكتب من اليسار داخل صفحة عربية');
  assert.match(html,/type="text"/,'النوع نصي كما كان، فتبقى قاعدة الخانتين العشريتين على الخادم');
  const expenses=readFileSync(new URL('../app/static/expenses-ui.mjs',import.meta.url),'utf8');
  assert.match(expenses,/field\('amount','المبلغ شامل الضريبة','text',\{inputmode:'decimal'/);
  assert.match(expenses,/field\('amount','مبلغ العهدة','text',\{inputmode:'decimal'/);
  // الحقل بلا inputmode يبقى كما كان بلا سمة زائدة.
  assert.doesNotMatch(operationFields([{name:'note',label:'ملاحظة',type:'text'}],esc),/inputmode/);
});

/* ───── B28: صفحة العقد تشير إلى ما هو موجود فعلًا ───── */

test('B28: the contract page links to the screens and services that exist',()=>{
  const data={permissions:[],pay_components:[],contracts:[],policies:[],policy_kinds:[],employees_without_contract:[],acceptance_owner:'—',alerts:[],pay_policy:null,files:{}};
  const html=contractsUI.render(data,{e:esc,button:()=>'',money:String});
  assert.match(html,/href="#profile"/,'«تحديث البيانات» صارت شاشة ملفي');
  assert.match(html,/href="#catalog\/new"/,'واستفسار الراتب خدمة في الدليل تُفتح بنقرة');
  assert.doesNotMatch(html,/استخدم خدمة «تحديث البيانات» أو «استفسار الراتب»/,'لم يبق اسمان لا يطابقان الدليل ولا يُنقر عليهما');
});

/* ───── نتائج مسح 20 سبتمبر (docs/product/audits/MERGED-SWEEP-20260920.md) ───── */

test('S-01: the page links an icon and /favicon.ico is served, so no page load logs a 401',()=>{
  const html=readFileSync(new URL('../app/static/index.html',import.meta.url),'utf8');
  assert.match(html,/<link rel="icon" href="\/icons\/icon-192\.png"/,'بلا رابط أيقونة يطلب المتصفح favicon.ico من تلقائه');
  const server=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8');
  assert.match(server,/\['\/favicon\.ico',\['icons\/icon-192\.png','image\/png'\]\]/,'وإن لم يكن في خريطة الأصول سقط على موجّه الواجهة البرمجية فعاد 401');
});

test('S-04: the catalog heading counts the same list the department rail counts',()=>{
  const picker=readFileSync(new URL('../app/static/request-picker.mjs',import.meta.url),'utf8');
  const browser=picker.slice(picker.indexOf('export function catalogBrowser'));
  assert.match(browser,/const shown=variants\?\.length\?mergeVariants\(services,variants\):services;/);
  assert.match(browser,/countNoun\(shown\.length,'service'\)/,'العنوان يعدّ ما يُتصفَّح فعلًا');
  assert.doesNotMatch(browser,/countNoun\(services\.length,'service'\)/,'لا يعدّ الخام بينما الشريط يعدّ المدموجة');
  const results=picker.slice(picker.indexOf('export function launcherResults'),picker.indexOf('export function catalogBrowser'));
  assert.match(results,/const services=variants\?\.length\?mergeVariants\(rawServices,variants\):rawServices;/);
  assert.match(results,/كل الخدمات<\/span><small>\$\{services\.length\}/);
});

test('S-08: the «اليوم» card writes dates the way the rest of the screen does',()=>{
  const card=todayCard({attendance:{check_in:'08:12',check_out:null,can_check_in:false,can_check_out:true,policy:null},
    status:{kind:'work',name:'يوم عمل',name_en:'Working day'},
    upcoming_leave:{type_name:'الإجازة السنوية',start_date:'2026-10-04',end_date:'2026-10-06',approved:true},
    next_holiday:{name:'اليوم الوطني',date:'2026-09-23'},
    next_deadline:{kind:'request',title:'طلب تجريبي',link:'#requests',date:'2026-09-25',days_left:5,overdue:false}},{e:esc,tr:(ar)=>ar,lang:'ar'});
  // dual يبقي الميلادي ويضيف الهجري؛ المطلوب ألا يبقى تاريخ بلا صيغة الشاشة.
  assert.match(card,/2026-09-23 · [^<]*هـ/,'العطلة الرسمية بالصيغة المزدوجة');
  assert.match(card,/2026-09-25 · [^<]*هـ/,'وأقرب موعد كذلك');
  assert.match(card,/2026-10-04 — 2026-10-06 · [^<]*هـ/,'ومدى الإجازة ميلادي يتبعه هجري واحد لا أربعة تواريخ');
  // الوضع الإنجليزي يبقى على الصيغة الدولية كما في بقية الشاشات.
  const en=todayCard({attendance:{check_in:'08:12',check_out:null,can_check_in:false,can_check_out:true,policy:null},
    upcoming_leave:{type_name:'Annual',start_date:'2026-10-04',end_date:'2026-10-06',approved:true},next_deadline:null},{e:esc,tr:(ar,x)=>x,lang:'en'});
  assert.match(en,/2026-10-04/);
});

test('S-07: a screen the server refuses offers a way back, not only a retry that changes nothing',()=>{
  const app=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  const at=app.indexOf('}catch(error){if(turn===renderId&&me)');
  const block=app.slice(at,at+460);
  assert.match(block,/data-action="reload"/,'زر المحاولة يبقى لعطل الشبكة');
  assert.match(block,/href="#home"/,'ومعه طريق عودة');
  assert.match(block,/tr\('العودة إلى الرئيسية','Back to home'\)/);
});
