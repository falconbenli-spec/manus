import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { randomBytes, randomUUID } from 'node:crypto';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { seedHrDemo } from '../scripts/seed-hr-demo.mjs';
import { createApp } from '../app/server.mjs';
import { createAccount, importAccounts, updateAccount } from '../app/admin.mjs';
import { CAPABILITIES, defaultCapabilities, grantAccess } from '../app/access.mjs';
import { saveTemplate, approveTemplate, templatesBoard, requestLetter, letterAction, lettersBoard } from '../app/letters.mjs';
import { createClient } from '../app/agency.mjs';
import { createProject } from '../app/projects.mjs';

// الباب المغلق (الحزمة 4، P4-PORTAL-1). قرار المالك القائم: المنصة للموظفين فقط — لا بوابة عملاء ولا موردين، ولا حساب
// لأي جهة خارجية (docs/product/MASTER-PROMPT-20260917.md، السطر 15؛ وACC-04 مستبعد بالسطر 33). فبند العقد «بوابات العملاء
// والموردين» مسجَّل مستبعدًا بذلك القرار، وما يُبنى بدله هو هذا: حراسة الباب المغلق وإثباته.
//
// الثغرة الكامنة التي يحرسها الملف (لا ثغرة مفتوحة اليوم): الطريق الوحيد لإدخال شخص من خارج الشركة هو صفٌّ في users بدور
// موظف (admin.createAccount). صفٌّ كهذا يحمل كل تصريح «للجميع» (portal.use وrequests.use وorg.view وleave.use وsearch.use
// وforms.fill)، ويقرأ بلا فحص تصريح: /api/departments و/api/org و/api/catalog و/api/search؛ ولو أُضيف إلى client_members
// لصار delivery_member وفُتحت له شاشات العميل بتعليقاتها الداخلية. فالحراسة هنا ثلاث: لا هوية في المنصة إلا موظف، ولا شيء
// يُجاب قبل المصادقة إلا الملفات الثابتة والتحقق من الخطاب والدخول، ولا مخزن اعتماد غير حساب الموظف وجلسته.

const PASSWORD='synthetic-closed-door';
const SERVER=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8');
const code=value=>error=>error.code===value;

// طلب داخل العملية بلا منفذ (نمط tests/definitions-fixture.mjs)، مع عنوان طرف قابل للتغيير لاختبار حد التحقق لكل عنوان.
function request(app,{method='GET',path,headers={},body,address='127.0.0.1'}){
  return new Promise((resolve,reject)=>{
    const req=Object.assign(Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]),{method,url:path,
      headers:{host:'127.0.0.1:3600',...(body===undefined?{}:{'content-type':'application/json'}),...Object.fromEntries(Object.entries(headers).map(([k,x])=>[k.toLowerCase(),x]))},
      socket:{remoteAddress:address,encrypted:false}});
    let status=0,head={};
    const res={writeHead(s,h={}){status=s;head=h;return res;},setHeader(){},getHeader(){},
      end(data){const buffer=data===undefined?Buffer.alloc(0):Buffer.isBuffer(data)?data:Buffer.from(String(data));
        resolve({status,headers:head,buffer,text:buffer.toString('utf8'),json(){return JSON.parse(buffer.toString('utf8'));}});}};
    try{app.emit('request',req,res);}catch(error){reject(error);}
  });
}
async function login(app,username,password=PASSWORD){
  const response=await request(app,{method:'POST',path:'/api/login',body:{username,password}});
  assert.equal(response.status,200,`login ${username}: ${response.text.slice(0,300)}`);
  return {cookie:response.headers['Set-Cookie'].split(';')[0],csrf:response.json().csrf};
}
function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u]));
  return {db,users,tx:f=>transaction(db,f)};
}

/* ───── قراءة بنية المعالج: ما يجري قبل auth=authenticate( ───── */
// ماسح خفيف: يتخطى التعليقات والنصوص والقوالب، ويقسم الكود إلى عبارات في العمق صفر. التعابير النمطية في هذا الجزء
// متوازنة الأقواس فتُقرأ كودًا بلا ضرر. ما لا يُفهم هنا لا يُخمَّن: يسقط الاختبار ويُقرأ المعالج بالعين.
function skipQuoted(code,i){const q=code[i];i++;while(i<code.length&&code[i]!==q){if(code[i]==='\\')i++;i++;}return i+1;}
function skipTemplate(code,i){
  i++;
  while(i<code.length&&code[i]!=='`'){
    if(code[i]==='\\'){i+=2;continue;}
    if(code[i]==='$'&&code[i+1]==='{'){let depth=1;i+=2;while(i<code.length&&depth){const c=code[i];if(c==="'"||c==='"'){i=skipQuoted(code,i);continue;}if(c==='`'){i=skipTemplate(code,i);continue;}if(c==='{')depth++;else if(c==='}')depth--;i++;}continue;}
    i++;
  }
  return i+1;
}
function topLevelStatements(code){
  const out=[];let depth=0,start=0,i=0;
  const push=end=>{const s=code.slice(start,end).trim();if(s&&s!==';')out.push(s);start=end;};
  while(i<code.length){
    const c=code[i],n=code[i+1];
    if(c==='/'&&n==='/'){const e=code.indexOf('\n',i);i=e<0?code.length:e;continue;}
    if(c==='/'&&n==='*'){const e=code.indexOf('*/',i+2);i=e<0?code.length:e+2;continue;}
    if(c==="'"||c==='"'){i=skipQuoted(code,i);continue;}
    if(c==='`'){i=skipTemplate(code,i);continue;}
    if('([{'.includes(c))depth++;
    else if(')]}'.includes(c)){depth--;if(depth===0&&c==='}'&&!/^\s*(?:else\b|[;,)])/.test(code.slice(i+1)))push(i+1);}
    else if(c===';'&&depth===0)push(i+1);
    i++;
  }
  push(code.length);
  return out;
}
const condition=statement=>{
  if(!statement.startsWith('if('))return null;
  let depth=0;
  for(let i=2;i<statement.length;i++){if(statement[i]==='(')depth++;else if(statement[i]===')'&&--depth===0)return statement.slice(3,i);}
  return null;
};
const EMITS=/\bsend\(|\bres\.end\(|\bres\.writeHead\(/;
function preAuthHandlers(source){
  const open='runRequest(async()=>{',at=source.indexOf(open),auth=source.indexOf('auth=authenticate(db,req.headers.cookie)',at);
  assert.ok(at>0&&auth>at,'معالج الطلبات ونقطة المصادقة الأولى في مكانهما');
  const region=source.slice(at+open.length,auth),tryAt=region.indexOf('try {');
  assert.ok(tryAt>0,'كتلة try في المعالج');
  const before=topLevelStatements(region.slice(0,tryAt)),inside=topLevelStatements(region.slice(tryAt+'try {'.length));
  return {
    // قبل try لا يُرسل شيء: الموضع الوحيد الذي يحمل res.end هو تعريف send نفسه.
    beforeTry:before.filter(s=>EMITS.test(s)).map(s=>s.startsWith('const send=')?'const send':s.slice(0,80)),
    handlers:inside.filter(s=>EMITS.test(s)).map(s=>condition(s)??`(عبارة ترسل ردًّا خارج شرط: ${s.slice(0,80)})`),
    bodies:inside.filter(s=>EMITS.test(s))
  };
}
// المسارات الثابتة بالماسح نفسه في tests/definitions-leak.test.mjs (مسار جديد يدخل المسح من تلقائه).
const staticRoutes=method=>[...new Set([...SERVER.matchAll(new RegExp(`p==='(\\/api\\/[a-z0-9/_-]+)'&&req\\.method==='${method}'`,'g'))].map(m=>m[1]))].sort();

test('closed door: an account is an employee by construction — the role CHECK refuses client, vendor and guest, and creating, importing or editing an account refuses them too',t=>{
  const {db,users,tx}=fixture(t);
  for(const role of ['client','vendor','guest','supplier','customer','external','portal']){
    assert.throws(()=>db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role) VALUES(?,'36t','creative',?,'هوية خارجية مصطنعة','unused',?)").run(`x-${role}`,`x-${role}`,role),
      /CHECK constraint failed/,`the database refuses the role ${role}`);
    assert.throws(()=>db.prepare("UPDATE users SET role=? WHERE id='employee'").run(role),/CHECK constraint failed/,`an existing employee is never turned into ${role}`);
  }
  // الأدوار المقبولة كلها أدوار موظفين: ستة في القيد، والشاشة تمنح خمسة منها (الأدمن لا يُنشأ من شاشة الحسابات).
  const check=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get().sql.match(/CHECK\(role IN \(([^)]*)\)\)/)[1];
  assert.deepEqual(check.split(',').map(x=>x.trim().replace(/'/g,'')).sort(),['admin','employee','hr','it','manager','pm']);
  for(const role of ['client','vendor','guest']){
    assert.throws(()=>tx(()=>createAccount(db,users.admin,{username:`ext.${role}`,name:'جهة خارجية مصطنعة',role,department_id:'creative',manager_id:'',temporary_password:'Synthetic-Outsider-2026!'})),code('role'));
    assert.throws(()=>tx(()=>importAccounts(db,users.admin,{csv:`username,name,department_id,role,manager_username\next.csv.${role},جهة مصطنعة,creative,${role},`})),code('role'));
    assert.throws(()=>tx(()=>updateAccount(db,users.admin,'outsider',{role})),code('role'));
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role NOT IN ('employee','manager','hr','it','admin','pm')").get().n,0);
});

test('closed door: before authentication the server answers exactly three things — the static files, the letter check and the login — and nothing is sent before try but the send helper itself',()=>{
  const {beforeTry,handlers,bodies}=preAuthHandlers(SERVER);
  assert.deepEqual(beforeTry,['const send'],'the only response writer before the route checks is the definition of send');
  assert.deepEqual(handlers,["req.method==='GET'&&assets.has(p)",'letterVerify',"p==='/api/login'&&req.method==='POST'"],
    'a new handler before auth=authenticate( opens a door without a session: review it against the employees-only decision before adding it here');
  // والتحقق من الخطاب لا يرسل إلا ما تعيده verifyLetter، أو رفض الحد.
  const letter=bodies[1];
  assert.deepEqual([...letter.matchAll(/send\((\d{3}),/g)].map(m=>m[1]),['429','200']);
  assert.match(letter,/send\(200,letters\.verifyLetter\(db,letterVerify\[1\]\)\)/);
  assert.match(bodies[0],/readFileSync\(resolve\(root,'app\/static',file\)\)/,'the static branch serves files from app/static only');
});

test('closed door: every route answers 401 with no session cookie, with a random 64-hex cookie and with a malformed one, and the answer carries nothing but the refusal',async t=>{
  const {db}=fixture(t);
  const app=createApp(db);
  const gets=staticRoutes('GET'),posts=staticRoutes('POST');
  assert.ok(gets.length>150&&posts.length>100&&gets.includes('/api/departments')&&gets.includes('/api/search'),'the scan reads the real routes of the server');
  // مسارات بمعرّف: المواد التي تخرج (المراجعة والمعدات والملفات والخطابات) ومسار لا وجود له. المصادقة قبل أي مطابقة، فالنتيجة واحدة.
  const id=randomUUID();
  const dynamic=[`/api/review-rounds/media/${id}`,`/api/equipment/photos/${id}`,`/api/files/${id}`,`/api/attachments/${id}`,`/api/letters/${id}/print`,
    `/api/client-reports/${id}/print`,`/api/call-sheets/${id}/print`,`/api/employees/employee`,`/api/requests/${id}`,`/api/${randomUUID()}`,'/api/','/api/me/../admin/accounts'];
  const cookies=[undefined,`session=${randomBytes(32).toString('hex')}`,'session=not-a-token',`session=${'A'.repeat(64)}`];
  let checked=0;
  for(const cookie of cookies){
    const headers=cookie?{cookie}:{};
    const calls=[...gets.map(path=>({method:'GET',path})),...dynamic.map(path=>({method:'GET',path})),
      ...posts.filter(path=>path!=='/api/login').map(path=>({method:'POST',path,body:{}})),
      ...['PUT','DELETE','PATCH','HEAD','OPTIONS'].map(method=>({method,path:'/api/me'}))];
    for(const call of calls){
      const response=await request(app,{...call,headers});
      assert.equal(response.status,401,`${call.method} ${call.path} with ${cookie??'no cookie'}: ${response.status} ${response.text.slice(0,200)}`);
      const body=response.json();
      assert.deepEqual(Object.keys(body),['error']);assert.deepEqual(Object.keys(body.error).sort(),['code','message']);
      assert.ok(['login_required','session_expired'].includes(body.error.code));
      checked++;
    }
  }
  assert.equal(checked,cookies.length*(gets.length+dynamic.length+posts.length-1+5),`${checked} calls checked`);
  // ورابط التحقق بأي طريقة غير GET يُرفض قبل أي قراءة.
  const posted=await request(app,{method:'POST',path:'/verify/letter/ABCDEFGH',body:{}});
  assert.equal(posted.status,405);assert.equal(posted.json().error.code,'method_not_allowed');
});

test('closed door: the public letter check returns found, issued_on and statement only, and answers 429 after the configured per-minute limit for one address while another address is unaffected',async t=>{
  const db=openDb(':memory:');seed(db,PASSWORD);seedHrDemo(db);t.after(()=>db.close());
  const users=Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u=>[u.id,u])),tx=f=>transaction(db,f);
  tx(()=>grantAccess(db,users.admin,{user_id:'manager',capability:'hr.letters.issue',note:'تصريح مصطنع لاختبار التحقق من الخطاب'}));
  const draft=()=>templatesBoard(db,users.hr).types.find(x=>x.code==='employment').draft;
  tx(()=>saveTemplate(db,users.hr,'employment',{body:'إلى {{addressee}}\n\nنفيدكم بأن {{employee_name}} يعمل لدينا بوظيفة {{job_title}} منذ {{hire_date}}.'}));
  tx(()=>approveTemplate(db,users.manager,'employment',{effective_from:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date()),note:'اعتماد مصطنع لصيغة الخطاب',version:draft().version}));
  const requestId=tx(()=>requestLetter(db,users.employee,{type_code:'employment',addressee:'جهة مصطنعة للتحقق',purpose:'اختبار مسار التحقق العام'})).id;
  const of=who=>lettersBoard(db,users[who]).requests.find(r=>r.id===requestId);
  tx(()=>letterAction(db,users.hr,requestId,'prepare_letter',{version:of('hr').version,note:'طوبق على السجل المصطنع'}));
  tx(()=>letterAction(db,users.manager,requestId,'issue_letter',{version:of('manager').version,note:'إصدار مصطنع'}));
  const letter=of('employee').letter;
  const app=createApp(db);

  const found=await request(app,{path:`/verify/letter/${letter.verify_code}`});
  assert.equal(found.status,200);
  assert.deepEqual(Object.keys(found.json()).sort(),['found','issued_on','statement']);
  assert.equal(found.json().found,true);assert.equal(found.json().issued_on,letter.issued_on);
  for(const secret of [users.employee.name,letter.reference,'جهة مصطنعة للتحقق',letter.id,'36t'])assert.equal(found.text.includes(secret),false,`the public answer never carries ${secret}`);
  for(const unknown of ['ZZZZZZZZZZZZ','abc','A'.repeat(40)]){
    const missing=await request(app,{path:`/verify/letter/${unknown}`});
    assert.equal(missing.status,200);assert.deepEqual(Object.keys(missing.json()).sort(),['found','statement']);assert.equal(missing.json().found,false);
  }

  // الحد يُقرأ من الخادم نفسه ولا يُكتب هنا رقم آخر.
  const limit=Number(SERVER.match(/VERIFY_LIMIT=(\d+)/)[1]),windowMs=Number(SERVER.match(/VERIFY_WINDOW_MS=(\d+)/)[1]);
  assert.ok(limit>=1&&windowMs===60000,'a per-minute limit is configured');
  const fresh=createApp(db),address='198.51.100.7';
  for(let i=1;i<=limit;i++){
    const ok=await request(fresh,{path:`/verify/letter/${letter.verify_code}`,address});
    assert.equal(ok.status,200,`request ${i} of ${limit} is answered`);
  }
  const limited=await request(fresh,{path:`/verify/letter/${letter.verify_code}`,address});
  assert.equal(limited.status,429);
  assert.deepEqual(Object.keys(limited.json()),['error']);assert.equal(limited.json().error.code,'rate_limited');
  const retry=Number(limited.headers['Retry-After']);
  assert.ok(retry>=1&&retry<=60,'Retry-After names the seconds left in the minute');
  assert.equal(limited.text.includes(letter.issued_on),false,'the refusal carries no letter data');
  const other=await request(fresh,{path:`/verify/letter/${letter.verify_code}`,address:'198.51.100.8'});
  assert.equal(other.status,200,'the limit counts per address');
});

test('closed door: a deactivated account is dead on its next request — when the admin switches it off (sessions removed) and when the row alone is switched off (sessions still on disk)',async t=>{
  const {db}=fixture(t);
  const app=createApp(db);
  const employee=await login(app,'employee'),outsider=await login(app,'outsider'),admin=await login(app,'admin');
  for(const session of [employee,outsider])assert.equal((await request(app,{path:'/api/me',headers:{cookie:session.cookie}})).status,200);
  const off=await request(app,{method:'PATCH',path:'/api/admin/accounts/employee',headers:{cookie:admin.cookie,'x-csrf-token':admin.csrf},body:{active:false}});
  assert.equal(off.status,200,off.text.slice(0,300));
  const dead=await request(app,{path:'/api/me',headers:{cookie:employee.cookie}});
  assert.equal(dead.status,401);assert.equal(dead.json().error.code,'session_expired');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='employee'").get().n,0);
  // الصف وحده: الجلسة باقية في القاعدة، والمصادقة تقرأ active=1 في كل طلب فلا تمر.
  db.prepare("UPDATE users SET active=0 WHERE id='outsider'").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='outsider'").get().n,1);
  for(const [method,path] of [['GET','/api/me'],['GET','/api/departments'],['GET','/api/search?q=x'],['POST','/api/notifications/read-all']]){
    const response=await request(app,{method,path,headers:{cookie:outsider.cookie,'x-csrf-token':outsider.csrf},body:method==='POST'?{}:undefined});
    assert.equal(response.status,401,`${method} ${path}`);assert.equal(response.json().error.code,'session_expired');
  }
  const again=await request(app,{method:'POST',path:'/api/login',body:{username:'outsider',password:PASSWORD}});
  assert.equal(again.status,401,'a switched-off account cannot log in again');
});

test('closed door: the latent hole stays fenced — the only credential stores are the employee account and its session, the everyone capabilities are pinned, and the capability-less readers stay inside the tenant',async t=>{
  const {db,users,tx}=fixture(t);
  // مخازن الاعتماد: كلمة مرور الموظف وجلسته وسرّ التحقق بخطوتين ورمز البلاغ المجهول (يستعمله موظف مسجَّل الدخول). جدول
  // روابط مشاركة أو جلسات خارجية أو حسابات عملاء يُسقط هذا السطر ويُراجَع بقرار المالك قبل أن يُضاف هنا.
  const columns=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    .flatMap(({name})=>db.prepare(`PRAGMA table_info("${name}")`).all().map(c=>`${name}.${c.name}`));
  assert.deepEqual(columns.filter(c=>/\.(?:password_hash|passcode\w*|\w*token_hash|\w*secret|csrf|\w*api_key|access_token|refresh_token|share_token|magic_\w+|invite_token)$/.test(c)).sort(),
    ['anonymous_reports.token_hash','sessions.csrf','sessions.token_hash','user_totp.secret','users.password_hash']);
  const tables=[...new Set(columns.map(c=>c.split('.')[0]))];
  assert.deepEqual(tables.filter(name=>/portal|share_link|guest|external_(?:user|session|account|login)|(?:client|vendor|supplier|customer)_(?:user|account|login|session)/.test(name)),[],'no external identity table');
  // ما يحمله أي حساب بلا منح: ستة تصاريح «للجميع». السابع يوسّع ما يراه أي حساب — والحساب لا يُنشأ إلا لموظف.
  assert.deepEqual(CAPABILITIES.filter(c=>c.everyone).map(c=>c.key).sort(),['forms.fill','leave.use','org.view','portal.use','requests.use','search.use']);
  assert.deepEqual([...defaultCapabilities({...users.employee})].sort(),['forms.fill','leave.use','org.view','portal.use','requests.use','search.use']);

  // القرّاء بلا فحص تصريح لا يعبرون الكيان: حساب الكيان المعزول لا يرى من 36t اسمًا ولا إدارة ولا سجلًا.
  const CANARY='كناري-الباب-المغلق-36T';
  tx(()=>createClient(db,users.manager,{legal_name:`شركة ${CANARY}`,sector:'التجزئة',status:'prospect'}));
  tx(()=>createProject(db,users.manager,{name:`مشروع ${CANARY}`,brief:'سجل مصطنع لاختبار العزل',member_ids:['employee']}));
  const foreign=[CANARY,...db.prepare("SELECT name FROM users WHERE tenant_id='36t'").all().map(r=>r.name),...db.prepare("SELECT name FROM departments WHERE tenant_id='36t'").all().map(r=>r.name)];
  const app=createApp(db),external=await login(app,'external');
  for(const path of ['/api/departments','/api/org','/api/catalog','/api/catalog/tree','/api/search?q='+encodeURIComponent(CANARY),'/api/search?q='+encodeURIComponent('التجريبي')]){
    const response=await request(app,{path,headers:{cookie:external.cookie}});
    assert.ok(response.status<500,`${path}: ${response.status}`);
    // البحث يعيد نص السؤال كما كُتب؛ المفحوص نتائجه لا صدى السؤال.
    const searched=path.startsWith('/api/search'),seen=searched?JSON.stringify(response.json().groups):response.text;
    if(searched)assert.equal(response.json().total,0,`${path}: no result from another tenant`);
    for(const marker of foreign)assert.equal(seen.includes(marker),false,`${path} leaks «${marker}» across the tenant`);
  }
  // وحساب الشركة نفسها يرى ما يخصه: الاختبار يفحص عزلًا لا رفضًا عامًّا.
  const own=await login(app,'employee');
  assert.ok((await request(app,{path:'/api/departments',headers:{cookie:own.cookie}})).text.includes('الفريق الإبداعي التجريبي'));
  assert.ok((await request(app,{path:'/api/search?q='+encodeURIComponent(CANARY),headers:{cookie:own.cookie}})).json().total>=1,'a member of the canary project finds it');
});
