import { hash,now } from './db.mjs';
import { fail } from './auth.mjs';

function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value&&typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
// The caller wraps creation and this record in the same database transaction.
// `resourceId` reads the identifier of the row that was created out of whatever `create` returns. The default suits a
// creator that returns the row itself; a creator that returns a whole board or record (where `.id` means something else,
// or nothing) passes its own reader. The identifier is checked before it is bound: without this a creator whose shape
// does not carry one bound NULL into a NOT NULL column, and every call of that route failed as an opaque platform fault
// (the employee document and job-change routes did exactly that). A wiring mistake now names itself.
export function createOnce(db,user,operation,key,input,create,read,resourceId=result=>result?.id) {
  if(typeof key!=='string'||! /^[a-zA-Z0-9_-]{16,100}$/.test(key)) fail(400,'idempotency_required','يلزم مفتاح ثابت لمحاولة الإنشاء');
  const inputHash=hash(JSON.stringify(canonical(input)));
  const existing=db.prepare('SELECT * FROM idempotency_keys WHERE tenant_id=? AND user_id=? AND operation=? AND key=?').get(user.tenant_id,user.id,operation,key);
  if(existing) {
    if(existing.input_hash!==inputHash) fail(409,'idempotency_conflict','استُخدم المفتاح نفسه لمحتوى مختلف');
    return read(existing.resource_id);
  }
  const result=create();
  const id=resourceId(result);
  if(typeof id!=='string'||!id) fail(500,'idempotency_resource',`تعذر ربط مفتاح التكرار بالسجل المنشأ في «${operation}». خلل في ربط المسار يحتاج مسؤول المنصة`);
  db.prepare('INSERT INTO idempotency_keys VALUES(?,?,?,?,?,?,?)').run(user.tenant_id,user.id,operation,key,inputHash,id,now());
  return result;
}
