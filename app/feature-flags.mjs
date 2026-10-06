import { randomUUID } from 'node:crypto';
import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { currentUser } from './delegations.mjs';
import { can } from './access.mjs';

// أعلام الميزات: مفتاح تشغيل مؤقت لميزة قيد الإطلاق. العلم بلا انتهاء دَين دائم، فتاريخ الانتهاء إلزامي وله أفق أقصى،
// والعلم المنتهي مطفأ حكمًا. العلم لا يمنح صلاحية: ما يحجبه التصريح يبقى محجوبًا ولو كان العلم مضاءً.
export const SCOPES={all:'الكل',department:'إدارة',user:'مستخدم'};
// أفق تقني لا نظامي: تمديد العلم بعده قرار جديد مسجل بسببه، لا تاريخ بعيد يُنسى.
export const MAX_FLAG_DAYS=180;
const WARN_DAYS=14,KEY=/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const riyadhToday=(time=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date(time));
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function actor(db,supplied){const u=currentUser(db,supplied);if(!u)fail(403,'forbidden','الحساب غير متاح');return u;}
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','تتطلب الكتابة معاملة قاعدة بيانات');}
function manager(db,supplied){const u=actor(db,supplied);if(!can(db,u,'platform.flags'))fail(403,'not_permitted','أعلام الميزات لمسؤول المنصة');return u;}

// استعلام واحد محضَّر مرة لكل اتصال: تُستدعى في مسار كل طلب.
const prepared=new WeakMap();
const SQL=`SELECT 1 AS active FROM feature_flags f WHERE f.tenant_id=? AND f.key=? AND f.status='live' AND f.enabled=1 AND f.expires_on>=?
  AND (f.scope='all' OR EXISTS(SELECT 1 FROM feature_flag_targets t WHERE t.flag_id=f.id AND t.target_id=CASE f.scope WHEN 'department' THEN ? ELSE ? END))`;
// علم غير معرّف، أو منتهٍ، أو مسحوب، أو خارج نطاق المستخدم = مطفأ. today محقون للاختبار.
export function flagOn(db,u,key,today=riyadhToday()){
  if(!u?.tenant_id||!u.id||typeof key!=='string')return false;
  let statement=prepared.get(db);if(!statement){statement=db.prepare(SQL);prepared.set(db,statement);}
  return !!statement.get(u.tenant_id,key,today,u.department_id??'',u.id);
}

function targetsOf(db,flag){return db.prepare('SELECT target_id FROM feature_flag_targets WHERE flag_id=? AND tenant_id=? ORDER BY target_id').all(flag.id,flag.tenant_id).map(t=>t.target_id);}
function stateOf(flag,today){
  if(flag.status==='retired')return {state:'retired',state_name:'مسحوب'};
  if(flag.expires_on<today)return {state:'expired',state_name:flag.enabled?'منتهٍ — يُعامل مطفأً':'منتهٍ'};
  if(!flag.enabled)return {state:'off',state_name:'مطفأ'};
  return flag.expires_on<=addDays(today,WARN_DAYS)?{state:'expiring',state_name:'مضاء — ينتهي قريبًا'}:{state:'on',state_name:'مضاء'};
}
export function flagsBoard(db,supplied,today=riyadhToday()){
  const u=manager(db,supplied);
  const departments=db.prepare('SELECT id,name FROM departments WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id),people=db.prepare('SELECT id,name FROM users WHERE tenant_id=? AND active=1 ORDER BY name').all(u.tenant_id);
  const names=new Map([...departments,...people].map(x=>[x.id,x.name]));
  const flags=db.prepare("SELECT f.*,x.name AS updated_by_name FROM feature_flags f JOIN users x ON x.id=f.updated_by WHERE f.tenant_id=? ORDER BY f.status,f.expires_on,f.key LIMIT 300").all(u.tenant_id).map(f=>{
    const targets=targetsOf(db,f);
    return {...f,enabled:!!f.enabled,...stateOf(f,today),scope_name:SCOPES[f.scope],targets,target_names:targets.map(t=>names.get(t)??t),actions:f.status==='live'?['edit_flag','retire_flag']:[]};
  });
  const expired=flags.filter(f=>f.state==='expired'),expiring=flags.filter(f=>f.state==='expiring');
  return {today,max_days:MAX_FLAG_DAYS,latest_expiry:addDays(today,MAX_FLAG_DAYS),scopes:SCOPES,departments,people,flags,
    alerts:[...expired.map(f=>`العلم «${f.key}» انتهى في ${f.expires_on}${f.enabled?' ويُعامل مطفأً':''}. مدّده بسبب، أو اسحبه وأزل شرطه من الكود.`),...expiring.map(f=>`العلم «${f.key}» ينتهي في ${f.expires_on}.`)],
    note:`العلم مفتاح تشغيل مؤقت، لا صلاحية: ما يحجبه التصريح يبقى محجوبًا. كل علم ينتهي خلال ${MAX_FLAG_DAYS} يومًا على الأكثر، والمنتهي مطفأ حكمًا. العلم هنا لا يغيّر شيئًا وحده؛ أثره حيث يقرؤه الكود بـflagOn، وعلم لا يقرؤه أحد لا أثر له.`};
}
function clean(db,u,input,today){
  if(!Object.hasOwn(SCOPES,input.scope))fail(400,'scope','اختر نطاق العلم');
  if(typeof input.enabled!=='boolean')fail(400,'enabled','حدد حالة العلم');
  const expires=v.date(input.expires_on);
  if(expires<today)fail(400,'expires_on','تاريخ الانتهاء اليوم أو بعده');
  if(expires>addDays(today,MAX_FLAG_DAYS))fail(400,'expires_on',`أقصى مدة للعلم ${MAX_FLAG_DAYS} يومًا. العلم الدائم إعداد لا علم`);
  const targets=input.scope==='all'?[]:[...new Set(Array.isArray(input.targets)?input.targets:[])];
  if(input.scope!=='all'&&(!targets.length||targets.length>200))fail(400,'targets','حدد من يشملهم العلم');
  if(input.scope==='all'&&Array.isArray(input.targets)&&input.targets.length)fail(400,'targets','نطاق «الكل» لا يأخذ قائمة');
  const exists=input.scope==='department'?db.prepare('SELECT 1 FROM departments WHERE id=? AND tenant_id=?'):db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=? AND active=1');
  for(const t of targets)if(typeof t!=='string'||!exists.get(t,u.tenant_id))fail(400,'targets',input.scope==='department'?'إدارة غير موجودة':'حساب غير متاح');
  return {scope:input.scope,enabled:input.enabled?1:0,expires_on:expires,description:v.text(input.description,'ما الذي يشغّله العلم ومتى يُزال',600,10),targets};
}
function writeTargets(db,u,flagId,targets){
  db.prepare('DELETE FROM feature_flag_targets WHERE flag_id=? AND tenant_id=?').run(flagId,u.tenant_id);
  for(const t of targets)db.prepare('INSERT INTO feature_flag_targets(flag_id,tenant_id,target_id) VALUES(?,?,?)').run(flagId,u.tenant_id,t);
}
const snapshot=(f,targets)=>({scope:f.scope,enabled:!!f.enabled,expires_on:f.expires_on,targets});
export function createFlag(db,supplied,input,today=riyadhToday()){
  writing(db);const u=manager(db,supplied);
  v.object(input,['key','description','scope','targets','enabled','expires_on','reason']);
  if(typeof input.key!=='string'||input.key.length<3||input.key.length>60||!KEY.test(input.key))fail(400,'key','مفتاح العلم بحروف إنجليزية صغيرة ونقاط، مثل ai.asset_gate');
  const f=clean(db,u,input,today),reason=v.text(input.reason,'سبب إنشاء العلم',1000,10);
  if(db.prepare('SELECT 1 FROM feature_flags WHERE tenant_id=? AND key=?').get(u.tenant_id,input.key))fail(409,'duplicate_flag','المفتاح مستخدم. المفتاح المسحوب لا يعاد استخدامه');
  const flagId=randomUUID(),time=now();
  db.prepare('INSERT INTO feature_flags(id,tenant_id,key,description,scope,enabled,expires_on,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(flagId,u.tenant_id,input.key,f.description,f.scope,f.enabled,f.expires_on,u.id,time,u.id,time);
  writeTargets(db,u,flagId,f.targets);
  audit(db,u,'feature_flag',flagId,'flag.created',{}, {key:input.key,...snapshot(f,f.targets)},reason);
  return {id:flagId};
}
function liveFlag(db,u,flagId,input){
  const flag=typeof flagId==='string'&&db.prepare('SELECT * FROM feature_flags WHERE id=? AND tenant_id=?').get(flagId,u.tenant_id);
  if(!flag)fail(404,'not_found','العلم غير متاح');
  v.version(input.version,flag.version);
  if(flag.status!=='live')fail(409,'retired','العلم مسحوب');
  return flag;
}
export function updateFlag(db,supplied,flagId,input,today=riyadhToday()){
  writing(db);const u=manager(db,supplied);
  v.object(input,['version','description','scope','targets','enabled','expires_on','reason']);
  const flag=liveFlag(db,u,flagId,input),f=clean(db,u,input,today),reason=v.text(input.reason,'سبب التغيير',1000,10),before=snapshot(flag,targetsOf(db,flag));
  db.prepare('UPDATE feature_flags SET description=?,scope=?,enabled=?,expires_on=?,updated_by=?,updated_at=?,version=version+1 WHERE id=?').run(f.description,f.scope,f.enabled,f.expires_on,u.id,now(),flag.id);
  writeTargets(db,u,flag.id,f.targets);
  audit(db,u,'feature_flag',flag.id,'flag.changed',{key:flag.key,...before},{key:flag.key,...snapshot(f,f.targets)},reason);
  return {id:flag.id};
}
// السحب نهائي: يُطفأ العلم ويبقى سجله، ولا يعاد مفتاحه. يُسحب بعد إزالة شرطه من الكود.
export function retireFlag(db,supplied,flagId,input){
  writing(db);const u=manager(db,supplied);v.object(input,['version','reason']);
  const flag=liveFlag(db,u,flagId,input),reason=v.text(input.reason,'سبب السحب',1000,10),time=now();
  db.prepare("UPDATE feature_flags SET status='retired',enabled=0,retired_at=?,updated_by=?,updated_at=?,version=version+1 WHERE id=?").run(time,u.id,time,flag.id);
  audit(db,u,'feature_flag',flag.id,'flag.retired',{key:flag.key,...snapshot(flag,targetsOf(db,flag))},{key:flag.key,status:'retired'},reason);
  return {id:flag.id};
}
