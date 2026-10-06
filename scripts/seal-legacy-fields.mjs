import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, transaction } from '../app/db.mjs';
import { seal, unseal, isSealed, SEALED_FIELDS, unsealedCounts } from '../app/crypto-fields.mjs';

// ترحيل لمرة واحدة: يختم الصفوف التي كُتبت قبل تشفير الحقول وبقيت نصًّا صريحًا في القاعدة.
// مسار الكتابة يختم الجديد منذ زمن، و`unseal` تمرّر القديم كما هو فيعمل ويبدو سليمًا — وهو في الملف مقروء لمن نسخه.
//
// القواعد التي يقوم عليها هذا السكربت:
//   • التشغيل الجاف هو الافتراضي: بلا ‎--write‎ يفتح القاعدة للقراءة فقط، يعدّ، ويطبع، ولا يكتب حرفًا.
//   • القيمة لا تتغير، تتغير صورتها في الملف وحدها: بعد الختم يُفكّ كل صفّ داخل المعاملة نفسها ويُطابَق بما كان،
//     وأي اختلاف يُسقط الترحيل كله بلا أثر.
//   • مُطلِقات «bank records keep their history» تمنع تعديل الآيبان في مكانه — وهي المقصودة: تاريخ الحسابات
//     البنكية لا يُعدَّل. فتُرفع بنصّها كما هو مكتوب في sqlite_master داخل المعاملة، وتُعاد بنصّه نفسه قبل انتهائها.
//     لا تُكتب هنا نسخة ثانية من نصّها: نسخةٌ تتخلّف عن الأصل تعني بابًا يُفتح ولا يُقفل.
//   • الصفوف المختومة أصلًا لا تُمسّ، وثانيةً = مرة.
//   • البصمة (iban_digest) ولا عمود آخر يتغير: هي على القيمة الصريحة نفسها وما زالت تطابقها.
// لا يُسجَّل في سجل التدقيق حدثٌ لهذا: لا قيمة تغيّرت ولا قرار اتُّخذ، والدليل الباقي أن عدّ غير المختوم
// في نتيجة الكنس اليومي (field_sealing) يصير صفرًا.

const tableExists=(db,table)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
const triggerSql=(db,name)=>db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)?.sql??null;

export function sealLegacyFields(db,{dry=true,fields=SEALED_FIELDS}={}){
  const work=fields.filter(f=>tableExists(db,f.table)).map(f=>({...f,
    rows:db.prepare(`SELECT ${f.key} AS k, ${f.column} AS v FROM ${f.table} WHERE ${f.column} IS NOT NULL AND ${f.column}<>''`).all().filter(r=>!isSealed(r.v))}))
    .filter(f=>f.rows.length);
  const total=work.reduce((n,f)=>n+f.rows.length,0);
  const summary={dry:!!dry,total,fields:work.map(f=>({field:`${f.table}.${f.column}`,rows:f.rows.length,guard:f.guard}))};
  if(dry||!total)return summary;

  transaction(db,()=>{
    for(const f of work){
      const guard=f.guard?triggerSql(db,f.guard):null;
      if(f.guard&&!guard)throw new Error(`Guard trigger ${f.guard} is missing from ${f.table}; refusing to write.`);
      if(guard)db.exec(`DROP TRIGGER ${f.guard}`);
      const update=db.prepare(`UPDATE ${f.table} SET ${f.column}=? WHERE ${f.key}=? AND ${f.column}=?`);
      const read=db.prepare(`SELECT ${f.column} AS v FROM ${f.table} WHERE ${f.key}=?`);
      for(const row of f.rows){
        if(update.run(seal(row.v),row.k,row.v).changes!==1)throw new Error(`${f.table}.${f.column}: row changed under the migration; nothing was written.`);
        if(unseal(read.get(row.k).v)!==row.v)throw new Error(`${f.table}.${f.column}: the sealed value does not read back identical; nothing was written.`);
      }
      // يعود المُطلِق داخل المعاملة نفسها: لا لحظة بعد COMMIT تكون فيها الحراسة مرفوعة.
      if(guard)db.exec(guard);
    }
  });
  return {...summary,dry:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),at=args.indexOf('--db'),path=at>=0?args[at+1]:null,write=args.includes('--write');
  if(!path)throw new Error('Usage: node scripts/seal-legacy-fields.mjs --db <path.sqlite> [--write]\n  No default path: the database is named on purpose, never assumed.');
  if(!existsSync(resolve(path)))throw new Error(`No database at ${resolve(path)}`);
  if(!write){
    // القراءة فقط فعلًا: لا فتحٌ يطبّق ترحيلات، فالتشغيل الجاف لا يكتب شيئًا ولو ترحيلًا.
    const db=new DatabaseSync(resolve(path),{readOnly:true});
    try{
      const plan=sealLegacyFields(db);
      console.log(JSON.stringify({...plan,counts:unsealedCounts(db).map(f=>({field:`${f.table}.${f.column}`,unsealed:f.rows}))},null,2));
      console.log(plan.total?`\n${plan.total} صفًّا سيُختم. أوقف الخدمة، خذ نسخة احتياطية، ثم أعد الأمر مع --write.`:'\nلا صفّ غير مختوم. لا شيء يُفعل.');
    }finally{db.close();}
  }else{
    const db=openDb(resolve(path));
    try{
      const done=sealLegacyFields(db,{dry:false});
      console.log(JSON.stringify({...done,remaining:unsealedCounts(db).map(f=>({field:`${f.table}.${f.column}`,unsealed:f.rows}))},null,2));
    }finally{db.close();}
  }
}
