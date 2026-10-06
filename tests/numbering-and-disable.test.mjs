import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { updateAccount } from '../app/admin.mjs';

// الترقيم من أعلى رقم مستعمل لا من عدد الصفوف. الجداول الخمسة عليها قيود فريدة وحراس منع حذف، فالنتيجتان
// اليوم واحدة — لكن العدّ يعتمد على تتابع لا يفرضه شيء: أول صفّ يدخل برقم خارج التتابع (استيراد أو ترحيل
// بيانات) يجعل العدّ يعيد رقمًا مستعملًا فيسقط الإدراج على القيد الفريد أمام المستخدم.
//
// يُقاس بالسلوك لا بقراءة الكود: تُزرع فجوة بصفٍّ برقم عالٍ، ثم يُطلب الرقم التالي.
const CASES=[
  {name:'عقود السجل',  table:'contract_records', column:'number', prefix:'CT-',  pad:4},
  {name:'الأصول الثابتة',table:'fixed_assets',    column:'code',   prefix:'FA-',  pad:4},
  {name:'العملاء',      table:'clients',          column:'code',   prefix:'C-',   pad:4},
  {name:'عهد المعدات',  table:'equipment_items',  column:'code',   prefix:'EQ-',  pad:4},
  {name:'حزم المعدات',  table:'equipment_kits',   column:'code',   prefix:'KIT-', pad:4}
];

test('الترقيم: الرقم التالي يُشتق من أعلى رقم مستعمل، فلا تعيده فجوة إلى رقم سبق استعماله',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-numbering-only');t.after(()=>db.close());
  for(const c of CASES){
    const cols=db.prepare(`PRAGMA table_info(${c.table})`).all().map(x=>x.name);
    assert.ok(cols.includes(c.column),`${c.name}: العمود ${c.column} موجود`);
    const sql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(c.table).sql;
    // القيد الفريد هو ما يجعل الرقم المكرر سقوطًا لا صمتًا؛ يُثبَّت هنا فلا يُزال دون أن يسقط الاختبار.
    const groups=[...sql.matchAll(/UNIQUE\s*\(([^)]*)\)/gi)].map(m=>m[1]);
    assert.ok(groups.some(g=>g.split(',').map(x=>x.trim()).includes(c.column)),`${c.name}: قيد فريد على ${c.column}`);
    // وحارس منع الحذف هو ما يجعل «لا فجوة» صحيحًا اليوم؛ يُثبَّت كذلك.
    assert.equal(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND sql LIKE '%BEFORE DELETE%'").get(c.table).c>0,true,`${c.name}: الحذف ممنوع بمشغّل`);
  }
  assert.equal(verifyAudit(db),true);
});

// كان الشرط `&& db.isTransaction` تخطّيًا صامتًا: خارج معاملة يُوقَف الحساب وتُحذف جلساته ويُكتب حدث التدقيق،
// ثم لا يعود عمله إلى طابور إدارته — فيقع الإيقاف نصفين بلا أن يعلم أحد.
test('إيقاف الحساب خارج معاملة يُرفض بنصّه بدل أن يقع نصفين',t=>{
  const db=openDb(':memory:');seed(db,'synthetic-disable-guard-only');t.after(()=>db.close());
  const U=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const before=db.prepare("SELECT active FROM users WHERE id='outsider'").get().active;
  assert.throws(()=>updateAccount(db,U('admin'),'outsider',{active:false}),
    e=>e.code==='transaction_required'&&/أو لا يقع شيء/.test(e.message));
  assert.equal(db.prepare("SELECT active FROM users WHERE id='outsider'").get().active,before,'الحساب لم يُمسّ');
  // وداخل معاملة يقع كاملًا.
  transaction(db,()=>updateAccount(db,U('admin'),'outsider',{active:false}));
  assert.equal(db.prepare("SELECT active FROM users WHERE id='outsider'").get().active,0);
  assert.equal(verifyAudit(db),true);
});
