import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { normalize, tokens, snippet } from '../app/arabic-text.mjs';
import { searchAll, reindex, indexEntity, removeFromIndex, refreshIndex, ENTITY_TYPES } from '../app/search.mjs';
import { createClient, clientAction } from '../app/agency.mjs';
import { createCampaign } from '../app/campaigns.mjs';
import { createRequest } from '../app/workflow.mjs';
import { searchUI } from '../app/static/search-ui.mjs';
import { grantAccess } from '../app/access.mjs';

const code=value=>error=>error.code===value;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const titles=(board,key)=>(board.groups.find(g=>g.key===key)?.results??[]).map(r=>r.title);
const ids=(board,key)=>(board.groups.find(g=>g.key===key)?.results??[]).map(r=>r.id);

function fixture(t){
  const db=openDb(':memory:');seed(db,'synthetic-search');t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  const service=db.prepare("SELECT id FROM services WHERE code='HR-LETTER'").get().id;
  // عميل ومعه حملة: مسؤول الحساب هو المدير، وعضو الفريق الموظفة، و«موظف اختبار آخر» خارج الفريق.
  const clientId=tx(()=>createClient(db,users.manager,{legal_name:'شركة الإجازة السعودية للتسويق (تجريبي)',trade_name:'الإجازة',sector:'سياحة',status:'active',notes:'ملف تجريبي'})).id;
  tx(()=>clientAction(db,users.manager,clientId,'add_member',{user_id:'employee',role:'مديرة محتوى'}));
  tx(()=>createCampaign(db,users.manager,{client_id:clientId,name:'حملة الإجازة الصيفية (تجريبي)',objective:'رفع الوعي بوجهات الإجازة الصيفية بين المسافرين',channels:['instagram'],targets:[{metric:'وصول',target:100000,unit:'ظهور'}],media_budget:'0',budget_reference:'',start_date:'2026-06-01',end_date:'2026-08-31'}));
  // طلب مسودة للموظفة: لا يراه إلا هي ومن في مساره.
  const requestId=tx(()=>createRequest(db,users.employee,{service_id:service,title:'طلب خطاب تعريف للإجازة',payload:{purpose:'خطاب تعريف لجهة تأجير',recipient:'شركة تأجير تجريبية'},project_id:null})).id;
  // مورد وسياسة معتمدة ولقطة تقرير: تُدخل مباشرة لأن مساراتها الكاملة ليست موضوع هذا الاختبار.
  const time=now();
  db.prepare("INSERT INTO vendors(id,tenant_id,code,supplier_key,legal_name,legal_name_en,trade_name,entity_type,country,categories,data_source,status,registered_by,created_at,updated_at) VALUES('v1','36t','V-0001','SUPPLIER-TEST','مؤسسة الطباعة الموحدة (تجريبي)','Unified Printing','الطباعة','establishment','SA','[\"printing\"]','إدخال يدوي تجريبي','approved','manager',?,?)").run(time,time);
  db.prepare("INSERT INTO hr_policies(id,tenant_id,kind,title,body,parameters,basis,effective_from,status,prepared_by,decided_by,decided_at,created_at) VALUES('p1','36t','working_time','سياسة ساعات العمل والإجازة (تجريبي)','نص السياسة التجريبية لساعات العمل وأيام الإجازة المعتمدة داخل الشركة','{}','محضر اجتماع تجريبي','2026-01-01','accepted','hr','manager',?,?)").run(time,time);
  db.prepare("INSERT INTO report_snapshots(id,tenant_id,report_key,title,params,result,digest,status,created_by,created_at) VALUES('s1','36t','R07','لقطة الطلبات وأزمنة الخدمة (تجريبي)','{}','{}','x','draft','hr',?)").run(time);
  // كيان آخر تمامًا: عميل باسم يطابق البحث نفسه، لا يجوز أن يظهر لأحد من 3,6T.
  db.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at) VALUES('other-client','isolated','C-0001','شركة الإجازة المعزولة (تجريبي)','','سياحة','active','external','',?,?)").run(time,time);
  tx(()=>{reindex(db,'36t');reindex(db,'isolated');});
  return {db,users,tx,clientId,requestId,service};
}

test('Arabic normalisation: the same word matches however it is written — diacritics, hamza seats, taa marbuta, tatweel and Indic digits',()=>{
  assert.equal(normalize('الإجازة'),normalize('الاجازه'));
  assert.equal(normalize('الأجازة'),normalize('الاجازه'));
  assert.equal(normalize('الآجازة'),normalize('الاجازه'));
  assert.equal(normalize('ٱلإجازة'),normalize('الاجازه'));
  assert.equal(normalize('مُوَظَّف'),'موظف');
  assert.equal(normalize('مُوَظَّفٌ'),'موظف');
  assert.equal(normalize('مــــوظف'),'موظف','التطويل لا يغيّر الكلمة');
  assert.equal(normalize('رحمٰن'),'رحمن','الألف الخنجرية تُحذف');
  assert.equal(normalize('مصطفى'),normalize('مصطفي'),'الألف المقصورة والياء صورة واحدة');
  assert.equal(normalize('مسؤول'),'مسوول');
  assert.equal(normalize('رئيس'),'رييس');
  assert.equal(normalize('١٢٣'),'123');
  assert.equal(normalize('٠٩٨٧٦٥٤٣٢١'),'0987654321');
  assert.equal(normalize('  Hello   WORLD  '),'hello world','خفض الحروف اللاتينية وضغط المسافات');
  assert.equal(normalize('الإجازة‏السنوية'.replace('‏',' ')),normalize('الاجازه السنويه'));
  assert.equal(normalize(''),'');assert.equal(normalize(null),'');assert.equal(normalize(undefined),'');
  assert.deepEqual(tokens('الإجازة، السنوية!'),['الاجازه','السنويه']);
  assert.equal(normalize('طلبــخطاب'),'طلبخطاب','التطويل يُحذف ولا يُستبدل بمسافة');
  assert.match(snippet('نص تجريبي طويل فيه كلمة الإجازة في وسطه تمامًا','الاجازه',5),/الإجازة/);
});

test('the index is derived, not a source of truth: it rebuilds from the source tables and a stale entry cannot outlive its row',t=>{
  const {db,tx,users}=fixture(t);
  const before=db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE tenant_id='36t'").get().n;
  assert.ok(before>0);
  assert.ok(searchAll(db,users.manager,'الاجازه').total>0);
  // حذف الفهرس كله لا يفقد المنصة شيئًا: إعادة البناء تعيده كما كان.
  tx(()=>db.prepare("DELETE FROM search_index WHERE tenant_id='36t'").run());
  assert.equal(searchAll(db,users.manager,'الاجازه').total,0);
  tx(()=>reindex(db,'36t'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE tenant_id='36t'").get().n,before);
  // سطر مدسوس في الفهرس لا يصمد أمام إعادة البناء، لأن مصدر الحقيقة الجداول لا الفهرس.
  tx(()=>indexEntity(db,{tenant_id:'36t',entity_type:'client',entity_id:'ghost',title:'عميل لا وجود له (تجريبي)',body:'',department_id:null,client_id:null,updated_at:''}));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE entity_id='ghost'").get().n,1);
  assert.equal(searchAll(db,users.manager,'لا وجود له').total,0,'سطر بلا جدول مصدر لا يجتاز الوصلة فلا يظهر');
  tx(()=>reindex(db,'36t'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE entity_id='ghost'").get().n,0);
  assert.throws(()=>reindex(db,'36t'),code('transaction_required'));
  assert.throws(()=>indexEntity(db,{tenant_id:'36t',entity_type:'client',entity_id:'x',title:'ع',body:'',department_id:null,client_id:null,updated_at:''}),code('transaction_required'));
  assert.throws(()=>tx(()=>indexEntity(db,{tenant_id:'36t',entity_type:'salaries',entity_id:'x',title:'رواتب',body:'',department_id:null,client_id:null,updated_at:''})),code('entity_type'));
  tx(()=>removeFromIndex(db,'36t','client','ghost'));
  assert.ok(verifyAudit(db));
});

test('a client appears only to its account team: neither a colleague outside the team nor HR nor the platform admin finds it',t=>{
  const {db,users}=fixture(t);
  assert.deepEqual(titles(searchAll(db,users.manager,'الاجازه'),'client').length,1,'مسؤول الحساب يجد عميله');
  assert.equal(ids(searchAll(db,users.employee,'الاجازه'),'client').length,1,'عضو فريق الحساب يجده');
  assert.deepEqual(titles(searchAll(db,users.outsider,'الاجازه'),'client'),[],'زميل خارج فريق الحساب لا يجده');
  assert.deepEqual(titles(searchAll(db,users.hr,'الاجازه'),'client'),[],'الموارد البشرية ليست في فريق الحساب');
  assert.deepEqual(titles(searchAll(db,users.it,'الاجازه'),'client'),[]);
  // الحملة تتبع عزل عميلها نفسه.
  assert.equal(titles(searchAll(db,users.manager,'الاجازه'),'campaign').length,1);
  assert.deepEqual(titles(searchAll(db,users.outsider,'الاجازه'),'campaign'),[]);
  assert.deepEqual(titles(searchAll(db,users.hr,'الاجازه'),'campaign'),[]);
});

test('employee records need employees.view, and no salary, bank or identity field ever reaches the index',t=>{
  const {db,users}=fixture(t);
  assert.ok(titles(searchAll(db,users.hr,'التجريبية'),'employee').length>0,'حامل تصريح السجل الوظيفي يجد الموظفين');
  assert.deepEqual(titles(searchAll(db,users.employee,'التجريبية'),'employee'),[],'الموظفة لا ترى سجلات زملائها');
  assert.deepEqual(titles(searchAll(db,users.manager,'التجريبية'),'employee'),[],'المدير المباشر لا يحمل التصريح فلا يبحث في السجل الوظيفي');
  assert.ok(!searchAll(db,users.employee,'التجريبية').searchable.some(t=>t.key==='employee'),'النوع لا يُعرض أصلًا لمن لا يحق له');
  // الفهرس نفسه لا يحمل ما لا يُبحث فيه: لا رواتب ولا أرقام هوية ولا حسابات بنكية.
  const indexed=db.prepare("SELECT title||' '||body AS t FROM search_index WHERE tenant_id='36t'").all().map(r=>r.t).join(' ');
  for(const forbidden of ['password','iqama','national_id','IBAN','SA00','amount_minor','salary'])assert.ok(!indexed.includes(forbidden),`الفهرس لا يحمل ${forbidden}`);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE entity_type='employee' AND tenant_id='36t'").get().n,db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id='36t' AND active=1 AND role<>'admin'").get().n);
});

test('a request is found by its requester and the people on its path, and by nobody else',t=>{
  const {db,users,requestId}=fixture(t);
  assert.deepEqual(ids(searchAll(db,users.employee,'خطاب تعريف'),'request'),[requestId],'صاحبة الطلب تجده');
  assert.deepEqual(ids(searchAll(db,users.outsider,'خطاب تعريف'),'request'),[],'زميل من الإدارة نفسها لا يجد مسودة غيره');
  assert.deepEqual(ids(searchAll(db,users.manager,'خطاب تعريف'),'request'),[],'المدير لا يجد المسودة قبل أن تصل مساره');
  assert.deepEqual(ids(searchAll(db,users.hr,'خطاب تعريف'),'request'),[]);
  assert.deepEqual(ids(searchAll(db,users.it,'خطاب تعريف'),'request'),[]);
  // محتوى الطلب نفسه لا يتسرب في المقتطف لمن لا يراه.
  const leaked=searchAll(db,users.outsider,'تأجير');
  assert.equal(leaked.total,0,'كلمة من داخل الطلب لا تصل لمن لا يرى الطلب');
});

test('vendors, accepted HR policies and report snapshots each need their own capability before the index is even queried',t=>{
  const {db,users}=fixture(t);
  assert.equal(titles(searchAll(db,users.manager,'الطباعه'),'vendor').length,1,'حامل دليل الموردين يجد المورد');
  assert.deepEqual(titles(searchAll(db,users.employee,'الطباعه'),'vendor'),[]);
  assert.deepEqual(titles(searchAll(db,users.hr,'الطباعه'),'vendor'),[]);
  assert.equal(titles(searchAll(db,users.hr,'ساعات العمل'),'policy').length,1,'الموارد البشرية تجد السياسة المعتمدة');
  assert.deepEqual(titles(searchAll(db,users.employee,'ساعات العمل'),'policy'),[]);
  assert.deepEqual(titles(searchAll(db,users.outsider,'ساعات العمل'),'policy'),[]);
  // تعديل 19 سبتمبر (B1): كان الاختبار يتوقع أن يجد المدير لقطة R07 حفظها غيره لمجرد أن التقرير متاح له،
  // وهذا هو التسرب نفسه: R07 للمدير مقصور على إدارته. اللقطة الآن لمُعِدّها ولحامل executive.view.
  assert.deepEqual(titles(searchAll(db,users.manager,'ازمنه الخدمه'),'report'),[],'حق التقرير وحده لا يكشف لقطة زميل');
  transaction(db,()=>grantAccess(db,users.admin,{user_id:'manager',capability:'executive.view',note:'اختبار نطاق لقطات التقارير'}));
  assert.equal(titles(searchAll(db,users.manager,'ازمنه الخدمه'),'report').length,1,'من تغطي صلاحيته بيانات اللقطة يجدها');
  assert.deepEqual(titles(searchAll(db,users.employee,'ازمنه الخدمه'),'report'),[]);
  assert.deepEqual(titles(searchAll(db,users.it,'ازمنه الخدمه'),'report'),[]);
});

test('tenant isolation: a record of another entity never appears, whatever the query matches',t=>{
  const {db,users}=fixture(t);
  for(const u of ['manager','employee','hr','it','outsider'])
    assert.ok(!JSON.stringify(searchAll(db,users[u],'المعزوله')).includes('المعزولة'),`${u} لا يرى سجلات الكيان الآخر`);
  assert.ok(!JSON.stringify(searchAll(db,users.external,'الاجازه')).includes('السعودية'),'موظف الكيان الآخر لا يرى سجلات 3,6T');
  // فهرس الكيان الآخر قائم بذاته: سجلاته وحدها، ولا سطر من 3,6T فيه ولا العكس.
  assert.deepEqual(db.prepare("SELECT DISTINCT entity_type FROM search_index WHERE tenant_id='isolated' ORDER BY entity_type").all().map(r=>r.entity_type),['client','employee']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE tenant_id='isolated' AND entity_id IN (SELECT entity_id FROM search_index WHERE tenant_id='36t')").get().n,0);
});

test('the search finds the word inside the definite article and however it was typed, and says plainly that it is textual not semantic',t=>{
  const {db,users}=fixture(t);
  for(const query of ['الإجازة','الاجازه','الأجازة','إجازة','جازه'])
    assert.ok(searchAll(db,users.manager,query).total>0,`«${query}» يجد ما فُهرس بصورة أخرى`);
  assert.ok(searchAll(db,users.employee,'خطاب').total>0,'البحث بكلمة واحدة يعمل');
  assert.equal(searchAll(db,users.employee,'').total,0,'بحث فارغ لا نتائج له');
  assert.equal(searchAll(db,users.employee,'   ').total,0);
  assert.equal(searchAll(db,users.employee,'كلمةلاوجودلهاابدا').total,0);
  const board=searchAll(db,users.employee,'خطاب');
  assert.match(board.note,/نصي لا دلالي/);
  assert.ok(board.index.ready&&board.index.entries>0);
  assert.ok(board.groups.every(g=>g.results.every(r=>r.title&&r.href)),'لكل نتيجة عنوان ورابط');
  assert.ok(board.groups.find(g=>g.key==='request').results.every(r=>r.href.startsWith('#request/')));
  assert.throws(()=>searchAll(db,users.employee,'ا'.repeat(201)),code('query'));
  // حقن نص صيغة FTS5 لا يكسر الاستعلام ولا يوسّع نطاقه.
  for(const hostile of ['" OR 1=1 --','NEAR(a b)','*','^الاجازه','a" OR "b'])assert.ok(Number.isInteger(searchAll(db,users.employee,hostile).total));
});

test('the screen escapes every value it prints, adds no inline style or script, and admits plainly that the search is textual',t=>{
  const {db,users}=fixture(t);
  // ترسم لكل دور، بنتائج وبلا نتائج وبلا كلمة بحث، كما سيفعل اختبار رسم الشاشات حين تُربط الوحدة.
  for(const who of ['employee','manager','hr','it','outsider'])for(const q of ['الاجازه','',' كلمةلاوجودلها ']){
    const html=searchUI.render(searchAll(db,users[who],q),{e:escape,button:()=>'',money:()=>'—'});
    assert.doesNotMatch(html,/<script|\sstyle=|https?:\/\//,`${who}/${q}: لا سكربت ولا تنسيق داخلي ولا مورد خارجي`);
    assert.doesNotMatch(html.replace(/<[^>]+>/g,' '),/\bundefined\b|\bNaN\b|\[object /,`${who}/${q}`);
  }
  const board=searchAll(db,users.manager,'الاجازه');
  const buttons=[],button=(action,id,label)=>{buttons.push([action,id]);return `<button>${escape(label)}</button>`;};
  const html=searchUI.render(board,{e:escape,button,money:()=>'—'});
  assert.match(html,/نصي لا دلالي/);
  assert.deepEqual(buttons,[['run_search','']]);
  const spec=searchUI.form('run_search','',board);
  assert.equal(spec.method,'GET');
  assert.equal(spec.toPayload({q:'الاجازه'}),undefined,'بحث بلا جسم طلب: GET لا يحمل حمولة');
  assert.equal(spec.dynamicEndpoint({q:' الاجازه '}),'/search?q='+encodeURIComponent('الاجازه'));
  assert.equal(spec.dynamicEndpoint({q:'   '}),'/search');
  assert.throws(()=>searchUI.form('drop_index','',board),/غير متاح/);
  // قيمة معادية في اسم عميل لا تخرج وسمًا في الصفحة.
  const hostile={...board,query:'<img src=x>',normalized:'<img src=x>',groups:[{key:'client',name:'العملاء',count:1,results:[{id:'x',title:'<b>عميل</b>',snippet:'"خطر"',href:'#clients',updated_at:'2026-01-01'}]}]};
  const escaped=searchUI.render(hostile,{e:escape,button:()=>'',money:()=>'—'});
  assert.doesNotMatch(escaped,/<b>|<img/);
});

test('rebuilding the index is permitted work and is recorded when a person asks for it',t=>{
  const {db,users,tx}=fixture(t);
  const before=db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='search.reindexed'").get().n;
  const result=tx(()=>refreshIndex(db,users.employee,{explicit:true}));
  assert.ok(result.entries>0&&result.rebuilt);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='search.reindexed'").get().n,before+1);
  assert.equal(tx(()=>refreshIndex(db,users.employee)).rebuilt,false,'فهرس بُني للتو لا يُعاد بناؤه مع كل بحث');
  assert.equal(tx(()=>refreshIndex(db,users.employee,{maxAgeMs:0})).rebuilt,true,'ويُعاد بناؤه حين يُطلب بلا مهلة');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='search.reindexed'").get().n,before+1,'إعادة البناء الروتينية لا تغرق سجل التدقيق');
  // كل حساب يبني فهرس كيانه هو، لا فهرس غيره.
  assert.equal(tx(()=>refreshIndex(db,users.external,{maxAgeMs:0})).entries,db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE tenant_id='isolated'").get().n);
  assert.equal(new Set(ENTITY_TYPES.map(t=>t.key)).size,ENTITY_TYPES.length,'لا تكرار في مفاتيح الأنواع');
  assert.ok(verifyAudit(db));
});
