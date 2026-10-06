import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog } from '../app/service-catalog.mjs';
import * as access from '../app/access.mjs';
import * as admin from '../app/admin.mjs';
import { login, authenticate } from '../app/auth.mjs';
import { createApp } from '../app/server.mjs';

const password='synthetic-access-only';
const code=c=>error=>error.code===c;
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
function setup(t){const db=openDb(':memory:');seed(db,password);installServiceCatalog(db);t.after(()=>db.close());return db;}
function http(db){
  const server=createApp(db),handler=server.listeners('request')[0];
  return async function call(path,{method='GET',token,csrf,input}={}){
    const body=input===undefined?[]:[Buffer.from(JSON.stringify(input))];
    const req={url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3600',...(token?{cookie:`session=${token}`}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...(input!==undefined?{'content-type':'application/json'}:{})},async *[Symbol.asyncIterator](){yield* body;}};
    const res={writeHead(status){this.status=status;},end(value){this.body=value?JSON.parse(value):null;}};
    await handler(req,res);return res;
  };
}

test('ACCESS: an employee holds only their own portal, and every other screen is closed',t=>{
  const db=setup(t),employee=user(db,'employee');
  const mine=access.capabilitiesFor(db,employee).list;
  assert.ok(mine.includes('portal.use')&&mine.includes('requests.use')&&mine.includes('leave.use'));
  for(const closed of ['executive.view','accounts.manage','catalog.manage','structure.manage','access.manage','people.manage','commercial.use','finance.use'])
    assert.equal(mine.includes(closed),false,closed);
  assert.equal(access.can(db,employee,'executive.view'),false);
  assert.throws(()=>access.require(db,employee,'accounts.manage'),code('not_permitted'));
  assert.equal(access.isSuperAdmin(user(db,'admin')),true,'the seeded platform account is the first admin');
  assert.equal(access.capabilitiesFor(db,user(db,'admin')).super,true);
});

test('ACCESS: the first admin grants a scoped capability, and revoking it ends the session',t=>{
  const db=setup(t),first=user(db,'admin'),employee=user(db,'employee');
  assert.throws(()=>transaction(db,()=>access.grantAccess(db,user(db,'manager'),{user_id:'employee',capability:'commercial.use'})),code('forbidden'),'only the first admin grants');
  assert.throws(()=>transaction(db,()=>access.grantAccess(db,first,{user_id:'employee',capability:'portal.use'})),code('capability'),'a capability everyone already has cannot be granted');
  assert.throws(()=>transaction(db,()=>access.grantAccess(db,first,{user_id:'employee',capability:'accounts.manage'})),code('capability'),'platform administration is for admin accounts only');
  const grant=transaction(db,()=>access.grantAccess(db,first,{user_id:'employee',capability:'commercial.use',department_id:'creative',note:'عضو في مشاريع الإبداع'}));
  assert.equal(access.can(db,employee,'commercial.use','creative'),true);
  assert.equal(access.can(db,employee,'commercial.use','finance'),false,'a scoped grant does not spill to another department');
  assert.throws(()=>transaction(db,()=>access.grantAccess(db,first,{user_id:'employee',capability:'commercial.use',department_id:'creative'})),code('already_granted'));
  const session=login(db,'employee',password,'access-test');
  transaction(db,()=>access.revokeAccess(db,first,grant.id,{reason:'انتهت مشاركته في المشاريع'}));
  assert.equal(access.can(db,employee,'commercial.use','creative'),false);
  assert.throws(()=>authenticate(db,`session=${session.token}`),code('session_expired'),'revoking access signs the person out');
});

test('ACCESS: a scoped admin only reaches what was granted, and the last first admin cannot be demoted',t=>{
  const db=setup(t),first=user(db,'admin');
  transaction(db,()=>admin.createAccount(db,first,{username:'ops.admin',name:'مسؤول منصة محدد',role:'employee',department_id:'ops',manager_id:null,temporary_password:'Welcome-2026'}));
  db.prepare("UPDATE users SET role='admin',must_change_password=0 WHERE id='ops.admin'").run();
  assert.throws(()=>transaction(db,()=>access.setAdminLevel(db,first,'ops.admin',{admin_level:'nothing'})),code('admin_level'));
  transaction(db,()=>access.setAdminLevel(db,first,'ops.admin',{admin_level:'scoped',reason:'مسؤول حسابات فقط'}));
  const scoped=user(db,'ops.admin');
  assert.equal(access.isSuperAdmin(scoped),false);
  assert.equal(access.can(db,scoped,'accounts.manage'),false,'a scoped admin starts with nothing');
  transaction(db,()=>access.grantAccess(db,first,{user_id:'ops.admin',capability:'accounts.manage',note:'إدارة الحسابات'}));
  assert.equal(access.can(db,user(db,'ops.admin'),'accounts.manage'),true);
  assert.equal(access.can(db,user(db,'ops.admin'),'catalog.manage'),false,'nothing else comes with it');
  assert.throws(()=>transaction(db,()=>access.grantAccess(db,user(db,'ops.admin'),{user_id:'employee',capability:'commercial.use'})),code('forbidden'),'a scoped admin cannot grant');
  assert.throws(()=>transaction(db,()=>access.setAdminLevel(db,first,'admin',{admin_level:'scoped'})),code('last_super'));
});

test('ACCESS: the server refuses screens without a grant and reports what the account holds',async t=>{
  const db=setup(t),call=http(db);
  const employee=login(db,'employee',password,'access-http');
  const me=await call('/api/me',{token:employee.token});
  assert.equal(me.status,200);
  assert.ok(me.body.user.can.includes('portal.use'));
  assert.equal(me.body.user.can.includes('executive.view'),false);
  assert.equal(me.body.user.admin_level,null);
  assert.equal((await call('/api/executive',{token:employee.token})).status,403);
  assert.equal((await call('/api/admin/accounts',{token:employee.token})).status,403);
  assert.equal((await call('/api/portal',{token:employee.token})).status,200);
  const first=login(db,'admin',password,'access-http-admin');
  const board=await call('/api/executive',{token:first.token});
  assert.equal(board.status,200);
  const directory=await call('/api/admin/accounts',{token:first.token});
  assert.equal(directory.status,200);
  assert.equal(directory.body.access.can_manage_access,true);
  assert.ok(directory.body.access.capabilities.length>=10);
  const denied=await call('/api/access/grants',{method:'POST',token:employee.token,csrf:employee.csrf,input:{user_id:'employee',capability:'finance.use'}});
  assert.equal(denied.status,403);
  const deniedMatrix=await call('/api/access/matrix',{method:'POST',token:employee.token,csrf:employee.csrf,input:{user_id:'outsider',mode:'custom',capability_keys:['executive.view'],department_id:null,note:'طلب غير مصرح'}});
  assert.equal(deniedMatrix.status,403);
  const matrix=await call('/api/access/matrix',{method:'POST',token:first.token,csrf:first.csrf,input:{user_id:'outsider',mode:'custom',capability_keys:['executive.view'],department_id:null,note:'منح مخصص من الشاشة'}});
  assert.equal(matrix.status,201);assert.deepEqual(matrix.body.granted,['executive.view']);
});

test('إعادة كلمة مرور حساب إداري تتطلب أدمن أول وتبقي بياناته وجلساته سليمة عند الرفض',t=>{
  const db=setup(t),first=user(db,'admin');
  transaction(db,()=>admin.createAccount(db,first,{username:'limited.admin',name:'مسؤول حسابات تجريبي',role:'employee',department_id:'ops',manager_id:null,temporary_password:'Temporary-2026!'}));
  db.prepare("UPDATE users SET role='admin',admin_level='scoped',must_change_password=0 WHERE id='limited.admin'").run();
  transaction(db,()=>access.grantAccess(db,first,{user_id:'limited.admin',capability:'accounts.manage'}));
  const session=login(db,'admin',password,'protected-admin');
  const before=user(db,'admin').password_hash;
  assert.throws(()=>transaction(db,()=>admin.resetAccountPassword(db,user(db,'limited.admin'),'admin',{temporary_password:'Replacement-2026!'})),code('admin_reset_forbidden'));
  assert.equal(user(db,'admin').password_hash,before);
  assert.equal(authenticate(db,`session=${session.token}`).user.id,'admin');
  transaction(db,()=>admin.resetAccountPassword(db,user(db,'limited.admin'),'employee',{temporary_password:'Replacement-2026!'}));
  assert.equal(user(db,'employee').must_change_password,1);
  transaction(db,()=>admin.resetAccountPassword(db,first,'limited.admin',{temporary_password:'Replacement-2026!'}));
  assert.equal(user(db,'limited.admin').must_change_password,1);
});

test('التصريح العام لا يقبل نطاق إدارة يوحي بقيد غير مطبق',t=>{
  const db=setup(t),first=user(db,'admin');
  assert.throws(()=>transaction(db,()=>access.grantAccess(db,first,{user_id:'employee',capability:'executive.view',department_id:'creative'})),code('scope_not_supported'));
  assert.equal(access.can(db,user(db,'employee'),'executive.view'),false);
  const grant=transaction(db,()=>access.grantAccess(db,first,{user_id:'employee',capability:'commercial.use',department_id:'creative'}));
  assert.ok(grant.id);
  assert.equal(access.can(db,user(db,'employee'),'commercial.use','creative'),true);
  assert.equal(access.can(db,user(db,'employee'),'commercial.use','finance'),false);
});

test('مصفوفة الصلاحيات: الشامل يمنح الحزمة الآمنة المتوافقة ويستبعد الحساس والمحصور وإدارة المنصة',t=>{
  const db=setup(t),first=user(db,'admin');
  const result=transaction(db,()=>access.applyAccessMatrix(db,first,{
    user_id:'employee',mode:'comprehensive',capability_keys:[],department_id:null,note:'حزمة عامة لموظف تجريبي'
  }));
  const granted=db.prepare("SELECT capability,department_id FROM access_grants WHERE user_id='employee' AND revoked_at IS NULL ORDER BY capability").all();
  const keys=granted.map(row=>row.capability);
  assert.equal(result.mode,'comprehensive');
  assert.ok(keys.includes('executive.view'),'a safe general work permission is included');
  assert.equal(keys.includes('payroll.approve'),false,'sensitive approval rights are never automatic');
  assert.equal(keys.includes('commercial.use'),false,'scoped rights require a deliberate department choice');
  assert.equal(keys.includes('accounts.manage'),false,'platform administration is not added to an employee');
  assert.ok(result.excluded.sensitive>0&&result.excluded.scoped>0&&result.excluded.incompatible>0);
});

test('مصفوفة الصلاحيات: المخصص يرفض جمع الإعداد والاعتماد كلها أو لا يكتب شيئًا',t=>{
  const db=setup(t),first=user(db,'admin');
  assert.throws(()=>transaction(db,()=>access.applyAccessMatrix(db,first,{
    user_id:'employee',mode:'custom',capability_keys:['hr.contracts.manage','hr.contracts.approve'],department_id:null,note:'يجب رفض هذا الجمع'
  })),error=>error.code==='separation_of_duties'&&error.details?.conflicts?.[0]?.includes('hr.contracts.manage')&&error.details?.conflicts?.[0]?.includes('hr.contracts.approve'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM access_grants WHERE user_id='employee'").get().n,0,'the failed matrix is atomic');
});

test('مصفوفة الصلاحيات: المخصص يتطلب نطاقًا للمفاتيح المحصورة ويمنح المختار فقط',t=>{
  const db=setup(t),first=user(db,'admin');
  const input={user_id:'employee',mode:'custom',capability_keys:['commercial.use','executive.view'],department_id:null,note:'عمل تجريبي داخل إدارة'};
  assert.throws(()=>transaction(db,()=>access.applyAccessMatrix(db,first,input)),code('department_required'));
  const result=transaction(db,()=>access.applyAccessMatrix(db,first,{...input,department_id:'creative'}));
  assert.deepEqual(new Set(result.granted),new Set(['commercial.use','executive.view']));
  assert.deepEqual(db.prepare("SELECT capability,department_id FROM access_grants WHERE user_id='employee' ORDER BY capability").all().map(row=>({...row})),[
    {capability:'commercial.use',department_id:'creative'},
    {capability:'executive.view',department_id:null}
  ]);
});

test('الخادم يمنع الاستيلاء على حساب الأدمن الأول عبر إعادة كلمة المرور المباشرة',async t=>{
  const db=setup(t),first=user(db,'admin'),call=http(db);
  transaction(db,()=>admin.createAccount(db,first,{username:'support.admin',name:'دعم تجريبي',role:'employee',department_id:'ops',manager_id:null,temporary_password:password}));
  db.prepare("UPDATE users SET role='admin',admin_level='scoped',must_change_password=0 WHERE id='support.admin'").run();
  transaction(db,()=>access.grantAccess(db,first,{user_id:'support.admin',capability:'accounts.manage'}));
  const session=login(db,'support.admin',password,'reset-http');
  const result=await call('/api/admin/accounts/admin/password',{method:'POST',token:session.token,csrf:session.csrf,input:{temporary_password:'Replacement-2026!'}});
  assert.equal(result.status,403);
  assert.equal(login(db,'admin',password,'reset-http-check').user.id,'admin');
});
