import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// تشفير حقول بعينها داخل قاعدة البيانات (AES-256-GCM): حسابات الموردين البنكية وأسرار التحقق بخطوتين.
// المفتاح ملف محلي خارج قاعدة البيانات وخارج النسخ الاحتياطية لها؛ فقدانه يعني فقدان هذه الحقول، فيُنسخ احتياطيًا منفصلًا.
const PREFIX='enc:v1:';
let cached=null;
function keyPath(){return process.env.FIELD_KEY_PATH?resolve(process.env.FIELD_KEY_PATH):resolve(fileURLToPath(new URL('../work/keys/field.key',import.meta.url)));}
function key(){
  if(cached)return cached;
  // الاختبارات الآلية تستخدم مفتاحًا مؤقتًا في الذاكرة ولا تلمس مفتاح التشغيل.
  if(process.env.NODE_TEST_CONTEXT&&!process.env.FIELD_KEY_PATH)return cached=randomBytes(32);
  const path=keyPath();
  if(!existsSync(path)){mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,randomBytes(32).toString('hex')+'\n',{mode:0o600,flag:'wx'});}
  chmodSync(path,0o600);
  const material=Buffer.from(readFileSync(path,'utf8').trim(),'hex');
  if(material.length!==32)throw new Error('Field key must be 32 bytes in hex.');
  return cached=material;
}
export const isSealed=value=>typeof value==='string'&&value.startsWith(PREFIX);
export function seal(plain){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv),body=Buffer.concat([cipher.update(String(plain),'utf8'),cipher.final()]);
  return PREFIX+[iv,cipher.getAuthTag(),body].map(b=>b.toString('base64')).join(':');
}
// القيم القديمة غير المشفرة تُقرأ كما هي: صفوف كُتبت قبل التشفير، ومُطلِقات التاريخ تمنع تعديلها في مكانها.
// وهذا التمرير **صامت** بطبعه — القيمة تعمل فتبدو الأمور سليمة وهي في القاعدة نصٌّ صريح. فالعدّ أدناه
// يقولها، وscripts/seal-legacy-fields.mjs يختمها.
export function unseal(value){
  if(!isSealed(value))return value;
  const [iv,tag,body]=value.slice(PREFIX.length).split(':').map(part=>Buffer.from(part,'base64'));
  const decipher=createDecipheriv('aes-256-gcm',key(),iv);decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8');
}

/* ───── الحقول المختومة، وما بقي منها صريحًا ───────────────────────────────────
   قائمة واحدة يقرأها العدّ وسكربت الترحيل معًا، فمن يضيف حقلًا مختومًا يضيفه هنا مرة واحدة
   ولا يبقى خارج العدّ. `guard` اسم المُطلِق الذي يمنع تعديل الصف، ليعرف السكربت ما يرفعه ويعيده. */
export const SEALED_FIELDS=[
  {table:'vendor_bank_accounts', column:'iban',   key:'id', guard:'vendor_bank_fixed',   label:'حسابات الموردين البنكية'},
  {table:'employee_bank_accounts', column:'iban', key:'id', guard:'employee_bank_fixed', label:'حسابات الموظفين البنكية'},
  {table:'user_totp', column:'secret', key:'user_id', guard:null, label:'أسرار التحقق بخطوتين'},
];
const tableExists=(db,table)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
// يعدّ الصفوف الباقية صريحة. لا يقرأ قيمة ولا يعيدها — عددًا فقط.
export function unsealedCounts(db){
  return SEALED_FIELDS.filter(f=>tableExists(db,f.table)).map(f=>({...f,
    rows:db.prepare(`SELECT COUNT(*) AS n FROM ${f.table} WHERE ${f.column} IS NOT NULL AND ${f.column}<>'' AND ${f.column} NOT LIKE '${PREFIX}%'`).get().n}));
}
// على نمط keyNotice في environment.mjs: نصٌّ يُقال بوضوح، أو null حين لا شيء يُقال.
export function sealingNotice(db){
  const open=unsealedCounts(db).filter(f=>f.rows>0);
  if(!open.length)return null;
  return '[تشفير الحقول] صفوف ما زالت نصًّا صريحًا في القاعدة:\n'+
    open.map(f=>`  • ${f.table}.${f.column} (${f.label}): ${f.rows}`).join('\n')+
    '\n  مسار الكتابة يختم الجديد، والقديم يُقرأ كما هو فيمرّ صامتًا. من نسخ ملف القاعدة قرأها بلا مفتاح.\n'+
    '  الختم: node scripts/seal-legacy-fields.mjs --db <المسار>            يعدّ ولا يكتب\n'+
    '          node scripts/seal-legacy-fields.mjs --db <المسار> --write    يكتب بعد نسخة احتياطية';
}
