import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, hash, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp, clientAddress, isLoopbackAddress } from '../app/server.mjs';
import { readiness } from '../scripts/remote-readiness.mjs';

// الوصول عن بُعد عبر نفق مشفَّر ينتهي على هذا الجهاز. النفق يتصل بالخادم من عنوان الاسترجاع،
// فكل ما يميز موظفًا عن آخر يأتي من ترويسة يكتبها النفق. هذه الاختبارات تثبت متى تُصدَّق ومتى لا تُصدَّق.

const password='synthetic-remote-access-only';
const LOOPBACK='127.0.0.1', TUNNEL_PEER='::1';
const EMPLOYEE_A='203.0.113.10', EMPLOYEE_B='198.51.100.7', FORGED='192.0.2.66';

function setup(t){const db=openDb(':memory:');seed(db,password);t.after(()=>db.close());return db;}

// يُستدعى معالج الطلب مباشرة، فيتحكم الاختبار بالطرف المتصل وبالترويسات معًا — وهما بالضبط ما يفرّق
// بين نفق موثوق على هذا الجهاز وبين مرسل بعيد يكتب الترويسة نفسها بيده.
function http(db,options={}){
  const server=createApp(db,options),handler=server.listeners('request')[0];
  return async function call(path,{method='GET',peer=LOOPBACK,host='127.0.0.1:3600',forwardedFor,forwardedProto,origin,token,csrf,input}={}){
    const body=input===undefined?[]:[Buffer.from(JSON.stringify(input))];
    const req={url:path,method,socket:{remoteAddress:peer},headers:{host,
      ...(forwardedFor?{'x-forwarded-for':forwardedFor}:{}),...(forwardedProto?{'x-forwarded-proto':forwardedProto}:{}),
      ...(origin?{origin}:{}),...(token?{cookie:`session=${token}`}:{}),...(csrf?{'x-csrf-token':csrf}:{}),
      ...(input!==undefined?{'content-type':'application/json'}:{})},
      async *[Symbol.asyncIterator](){yield* body;}};
    const res={headers:{},writeHead(status,values={}){this.status=status;this.headers=values;},end(value){this.body=value?JSON.parse(value):null;}};
    await handler(req,res);return res;
  };
}
const signIn=(call,username,extra={})=>call('/api/login',{method:'POST',input:{username,password},...extra});
const cookieOf=res=>String(res.headers['Set-Cookie']??'');
const attempts=(db,address)=>db.prepare('SELECT failures FROM login_attempts WHERE key=?').get(hash('ip\n'+address))?.failures??0;
const lastLoginAudit=db=>db.prepare("SELECT * FROM audit_events WHERE action='login' ORDER BY seq DESC LIMIT 1").get();

/* ───── 1) راية Secure تتبع النقل الفعلي ───── */
test('REMOTE: the session cookie carries Secure when the request arrived over the tunnel, and does not over plain local HTTP',async t=>{
  const db=setup(t);
  const tunnelled=await signIn(http(db,{trustProxy:true}),'employee',{peer:TUNNEL_PEER,forwardedProto:'https',forwardedFor:EMPLOYEE_A});
  assert.equal(tunnelled.status,200);
  assert.match(cookieOf(tunnelled),/; Secure/,'over the tunnel the cookie must not be allowed onto a plain request');
  assert.match(cookieOf(tunnelled),/HttpOnly/);
  assert.match(cookieOf(tunnelled),/SameSite=Strict/);

  const local=await signIn(http(db,{trustProxy:false}),'manager');
  assert.equal(local.status,200);
  assert.doesNotMatch(cookieOf(local),/Secure/,'a Secure cookie on plain local HTTP would never be sent back at all');

  // التصريح بالبروتوكول بلا TRUST_PROXY ترويسة كأي ترويسة: لا تُصدَّق، فلا راية.
  const untrusted=await signIn(http(db,{trustProxy:false}),'hr',{forwardedProto:'https'});
  assert.equal(untrusted.status,200);
  assert.doesNotMatch(cookieOf(untrusted),/Secure/);

  // تسجيل الخروج يمسح الملف بالرايات نفسها، وإلا بقي ملف الجلسة قائمًا عند المتصفح.
  const me=await http(db,{trustProxy:true})('/api/logout',{method:'POST',peer:TUNNEL_PEER,forwardedProto:'https',
    token:cookieOf(tunnelled).match(/session=([a-f0-9]{64})/)[1],csrf:tunnelled.body.csrf,input:{}});
  assert.equal(me.status,200);
  assert.match(cookieOf(me),/; Secure/);
});

/* ───── 2) اشتقاق عنوان العميل ───── */
test('REMOTE: the forwarded address is read only from a loopback peer under TRUST_PROXY, the last hop is taken, and anything else falls back to the peer',t=>{
  const req=(peer,forwarded)=>({socket:{remoteAddress:peer},headers:forwarded===undefined?{}:{'x-forwarded-for':forwarded}});

  // النفق: يصل من هذا الجهاز، والقفزة الموثوقة كتبت عنوان الموظف.
  assert.equal(clientAddress(req(LOOPBACK,EMPLOYEE_A),{trustProxy:true}),EMPLOYEE_A);
  assert.equal(clientAddress(req('::1',EMPLOYEE_A),{trustProxy:true}),EMPLOYEE_A);
  assert.equal(clientAddress(req('::ffff:127.0.0.1',EMPLOYEE_A),{trustProxy:true}),EMPLOYEE_A);

  // سلسلة: ما كتبته القفزة الموثوقة هو الحلقة الأخيرة وحدها. ما قبلها وصل من الخارج ويُزوَّر بحرية.
  assert.equal(clientAddress(req(LOOPBACK,`${FORGED}, ${EMPLOYEE_A}`),{trustProxy:true}),EMPLOYEE_A,
    'an attacker prepending an address to the chain must not displace what the tunnel wrote');

  // طرف غير استرجاع: الترويسة من صنع المرسل مهما قالت.
  assert.equal(clientAddress(req(EMPLOYEE_B,FORGED),{trustProxy:true}),EMPLOYEE_B);
  // TRUST_PROXY مطفأ: لا تُقرأ الترويسة أصلًا.
  assert.equal(clientAddress(req(LOOPBACK,FORGED),{trustProxy:false}),LOOPBACK);
  assert.equal(clientAddress(req(LOOPBACK,FORGED)),LOOPBACK,'the default must be not to trust');

  // قيمة لا تُقرأ كعنوان لا تدخل عدادًا ولا سجلًا: يُحتسب الطرف المتصل.
  for(const junk of ['','   ',',,','not-an-address','999.1.1.1','<script>','x'.repeat(80),'127.0.0.1 OR 1=1'])
    assert.equal(clientAddress(req(LOOPBACK,junk),{trustProxy:true}),LOOPBACK,junk);
  // شكل يلحقه منفذ أو قوسان يُقرأ، ولا يوسَّع ما يُقبل.
  assert.equal(clientAddress(req(LOOPBACK,`${EMPLOYEE_A}:51234`),{trustProxy:true}),EMPLOYEE_A);
  assert.equal(clientAddress(req(LOOPBACK,'[2001:db8::7]:443'),{trustProxy:true}),'2001:db8::7');
  assert.equal(clientAddress(req(LOOPBACK,`::ffff:${EMPLOYEE_A}`),{trustProxy:true}),EMPLOYEE_A);
  assert.equal(clientAddress({socket:{}},{trustProxy:true}),'unknown');

  assert.equal(isLoopbackAddress('127.0.0.1'),true);
  assert.equal(isLoopbackAddress('::1'),true);
  assert.equal(isLoopbackAddress(EMPLOYEE_A),false);
  assert.equal(isLoopbackAddress(null),false);
});

/* ───── 3) حد المحاولات يُحتسب على العنوان المشتق ───── */
test('REMOTE: failures are counted against the employee’s own address, so one employee cannot lock out the company',async t=>{
  const db=setup(t),call=http(db,{trustProxy:true});
  const wrong=(address,username='employee')=>call('/api/login',{method:'POST',peer:TUNNEL_PEER,forwardedProto:'https',
    forwardedFor:address,input:{username,password:'wrong-on-purpose'}});

  for(let i=0;i<10;i++) assert.ok([401,429].includes((await wrong(EMPLOYEE_A)).status));
  assert.equal((await wrong(EMPLOYEE_A)).status,429,'the account is locked from the address that kept failing');

  // العدّاد لكل عنوان يقع على عنوان الموظف، لا على عنوان النفق. لو وقع على الاسترجاع لجمع الشركة كلها في خانة واحدة.
  assert.equal(attempts(db,EMPLOYEE_A),10);
  assert.equal(attempts(db,LOOPBACK),0,'nothing may accumulate against the tunnel’s own address');
  assert.equal(attempts(db,'::1'),0);
  assert.equal(attempts(db,EMPLOYEE_B),0);

  // الحساب نفسه من عنوان آخر يمضي: القفل على اقتران الحساب بالعنوان، لا على الحساب وحده.
  const sameAccountElsewhere=await signIn(call,'employee',{peer:TUNNEL_PEER,forwardedProto:'https',forwardedFor:EMPLOYEE_B});
  assert.equal(sameAccountElsewhere.status,200,'a second employee at the same account from another address must not inherit the lock');
  // وزميل آخر من عنوانه غير معني بما جرى.
  assert.equal((await signIn(call,'manager',{peer:TUNNEL_PEER,forwardedProto:'https',forwardedFor:EMPLOYEE_B})).status,200);
});

test('REMOTE: with TRUST_PROXY off every employee collapses onto the tunnel address — which is exactly why it must be set',async t=>{
  const db=setup(t),call=http(db,{trustProxy:false});
  for(let i=0;i<3;i++) await call('/api/login',{method:'POST',forwardedFor:EMPLOYEE_A,input:{username:'employee',password:'wrong-on-purpose'}});
  assert.equal(attempts(db,EMPLOYEE_A),0,'an untrusted header must leave no trace in the counters');
  assert.equal(attempts(db,LOOPBACK),3,'untrusted, the failures land on the shared local address');
});

/* ───── 4) السجل والجلسة يحملان العنوان المشتق ───── */
test('REMOTE: the audit row and the session record carry the derived address, and a forged header from a distant peer is not believed',async t=>{
  const db=setup(t);
  const tunnelled=await signIn(http(db,{trustProxy:true}),'employee',{peer:TUNNEL_PEER,forwardedProto:'https',forwardedFor:EMPLOYEE_A});
  assert.equal(tunnelled.status,200);
  assert.deepEqual(JSON.parse(lastLoginAudit(db).after_json),{address:EMPLOYEE_A},'a remote action must not look like it happened on the Mac');
  const token=cookieOf(tunnelled).match(/session=([a-f0-9]{64})/)[1];
  assert.equal(db.prepare('SELECT address FROM sessions WHERE token_hash=?').get(hash(token)).address,EMPLOYEE_A);

  // مرسل بعيد يكتب الترويسة بيده: لا تُصدَّق، ويُسجَّل عنوانه هو.
  const forger=await signIn(http(db,{trustProxy:true}),'manager',{peer:EMPLOYEE_B,forwardedFor:FORGED});
  assert.equal(forger.status,200);
  assert.deepEqual(JSON.parse(lastLoginAudit(db).after_json),{address:EMPLOYEE_B},'the audit trail must not be writable by the person being audited');

  // ومع TRUST_PROXY مطفأ لا تُقرأ الترويسة بحال.
  const ignored=await signIn(http(db,{trustProxy:false}),'hr',{forwardedFor:FORGED});
  assert.equal(JSON.parse(lastLoginAudit(db).after_json).address,LOOPBACK);

  // العنوان يُكتب في after، وafter داخل سلسلة تجزئة السجل. تبديله ممنوع أصلًا، ولو مُرّ لانكسرت السلسلة.
  assert.equal(verifyAudit(db),true);
  const seq=lastLoginAudit(db).seq;
  assert.throws(()=>db.prepare('UPDATE audit_events SET after_json=? WHERE seq=?').run(JSON.stringify({address:FORGED}),seq),
    /append only/,'a recorded address is not rewritable');
  const row=lastLoginAudit(db);
  assert.equal(JSON.parse(row.after_json).address,LOOPBACK);
  assert.equal(hash(JSON.stringify([row.tenant_id,row.actor_id,row.entity_type,row.entity_id,row.action,row.before_json,
    row.after_json,row.reason,row.created_at,row.policy_version,row.previous_hash])),row.hash,'the address is inside the hashed value, not beside it');
});

/* ───── 5) قائمة العناوين المسموحة ───── */
test('REMOTE: a tunnel hostname set through LOCAL_ALLOWED_HOST is accepted while a lookalike is refused',async t=>{
  const db=setup(t),tunnelHost='36t-platform.example.com';
  const call=http(db,{allowedHost:tunnelHost});
  const at=host=>call('/api/me',{host});

  assert.equal((await at(tunnelHost)).status,401,'the host passed; what stops the request is the missing session, as it should');
  assert.equal((await at(tunnelHost+':8443')).status,401,'an explicit port on the same name is the same name');
  assert.equal((await at(tunnelHost.toUpperCase())).status,401,'host comparison is case-insensitive, as DNS is');
  assert.equal((await at('127.0.0.1:3600')).status,401,'the Mac itself keeps working');
  assert.equal((await at('localhost:3600')).status,401);

  // الشبيه مرفوض: الدفاع ضد إعادة ربط النطاق قائم، ولم تُفتح القائمة بنمط عام.
  for(const lookalike of [tunnelHost+'.evil.net','x'+tunnelHost,'36t-platform.example.com.evil.net','36t-platform.example.co',
      'evil.net','36tplatform.example.com','36t-platform.example.com.','203.0.113.10']) {
    const res=await at(lookalike);
    assert.equal(res.status,403,lookalike);
    assert.equal(res.body.error.code,'host_denied',lookalike);
  }

  // أسماء حقيقية تُقبل في الإعداد، بما فيها أسماء punycode ذات الشرطتين، ولا تُقبل نجمة ولا مقطع فارغ.
  for(const good of ['mac-mini.tail9f3c.ts.net','brave-cat-runs-fast.trycloudflare.com','xn--mgbh0fb.example.com','192.168.1.40'])
    assert.doesNotThrow(()=>createApp(db,{allowedHost:good}),good);
  for(const bad of ['*.example.com','36t..example.com','-lead.example.com','trail-.example.com','a'.repeat(300)+'.com','36t.example.com/path',' 36t.example.com'])
    assert.throws(()=>createApp(db,{allowedHost:bad}),/Invalid allowed host/,bad);
});

/* ───── 6) المصدر المتوقع يتبع النقل ───── */
test('REMOTE: behind the tunnel the browser’s https Origin is accepted, and it is not accepted when the transport is plain',async t=>{
  const db=setup(t),tunnelHost='36t-platform.example.com';
  const tunnelled=http(db,{trustProxy:true,allowedHost:tunnelHost});
  const signed=await signIn(tunnelled,'employee',{peer:TUNNEL_PEER,host:tunnelHost,forwardedProto:'https',
    forwardedFor:EMPLOYEE_A,origin:`https://${tunnelHost}`});
  assert.equal(signed.status,200,'without this, every write from a phone is refused with origin_denied');

  const mismatched=await signIn(tunnelled,'manager',{peer:TUNNEL_PEER,host:tunnelHost,forwardedProto:'https',
    forwardedFor:EMPLOYEE_A,origin:`https://${tunnelHost}.evil.net`});
  assert.equal(mismatched.status,403);
  assert.equal(mismatched.body.error.code,'origin_denied');

  // بلا تصريح النقل يبقى المتوقع http، فيُرفض مصدر https. هذا هو العرض الذي يظهره فحص الجاهزية حين يُنسى TRUST_PROXY.
  const untrusted=await signIn(http(db,{trustProxy:false,allowedHost:tunnelHost}),'hr',{host:tunnelHost,origin:`https://${tunnelHost}`});
  assert.equal(untrusted.status,403);
  assert.equal(untrusted.body.error.code,'origin_denied');
});

/* ───── 7) فحص الجاهزية يقول ما هو كائن ───── */
test('REMOTE: the readiness check reports the configuration as it is, including what is not ready',async t=>{
  const db=setup(t);
  const root=mkdtempSync(join(tmpdir(),'36t-remote-readiness-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const inspect=env=>readiness(db,env,root);
  const bare=inspect({});
  assert.equal(bare.trustProxy,false);
  assert.equal(bare.allowedHost,null);
  assert.equal(bare.bindLoopback,true,'the default bind is loopback, and nothing forces a LAN bind');
  assert.equal(bare.enforcing.length,0,'requiring a second factor stays off until the owner turns it on');
  assert.ok(bare.holders.length>0,'the seeded company has holders of sensitive capabilities');
  assert.equal(bare.withoutMfa.length,bare.holders.length,'none of them has enrolled a second factor yet');
  assert.equal(bare.backup.known,false,'no backup folder is reported as no backup, not as a promise');

  const configured=inspect({TRUST_PROXY:'1',LOCAL_ALLOWED_HOST:'36t-platform.example.com'});
  assert.equal(configured.trustProxy,true);
  assert.equal(configured.allowedHost,'36t-platform.example.com');
  assert.equal(inspect({LOCAL_BIND_HOST:'0.0.0.0'}).bindLoopback,false,'a LAN bind must be reported as not ready');

  // الجلسات السارية تُعدّ بعناوينها: بعيدة، أو من الجهاز، أو بلا عنوان مسجَّل.
  await signIn(http(db,{trustProxy:true}),'employee',{peer:TUNNEL_PEER,forwardedProto:'https',forwardedFor:EMPLOYEE_A});
  const after=inspect({});
  assert.equal(after.sessions.total,1);
  assert.equal(after.sessions.remote,1);
  assert.equal(after.sessions.unknown,0);
});
