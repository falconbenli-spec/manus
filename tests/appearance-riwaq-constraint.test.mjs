import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, transaction } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { DESIGNS, setPersonalAppearance, effectiveAppearance } from '../app/preferences.mjs';

// العيب الذي كشفه سجل التشغيل الحي: «الرواق» أُضيف إلى قائمة الكود ولم يُضَف إلى قيد الجدول،
// فكان اختياره يسقط بـ CHECK constraint failed. الاختبارات القديمة لم تمسكه لأنها تقرأ القائمة لا القيد.
// فالاختبار هنا يعبر الحدّ: يكتب فعلًا في القاعدة ويقرأ بعد الكتابة.
const setup=t=>{const db=openDb(':memory:');seed(db,'synthetic-riwaq-constraint');t.after(()=>db.close());return db;};
const user=(db,id)=>db.prepare('SELECT * FROM users WHERE id=?').get(id);

test('قيد القاعدة يقبل كل تصميم في DESIGNS — لا تصميمًا في الكود يرفضه الجدول',t=>{
  const db=setup(t),u=user(db,'employee');
  for(const design of DESIGNS){
    transaction(db,()=>setPersonalAppearance(db,u,{design,theme:'dark'}));
    assert.equal(effectiveAppearance(db,u).design,design,`التصميم «${design}» يُحفظ ويُقرأ`);
  }
});

test('«الرواق» يُختار ويُحفظ ويُقرأ بعد إعادة الفتح، ولا يتغير الافتراضي',t=>{
  const db=setup(t),u=user(db,'employee');
  transaction(db,()=>setPersonalAppearance(db,u,{design:'riwaq',theme:'light'}));
  const saved=db.prepare('SELECT design,theme FROM user_appearance WHERE user_id=?').get(u.id);
  assert.deepEqual([saved.design,saved.theme],['riwaq','light'],'الصف مكتوب في الجدول لا في الذاكرة');
  // «إعادة الفتح»: قراءة جديدة من القاعدة بحساب مُعاد جلبه، كما تفعل جلسة تالية.
  assert.equal(effectiveAppearance(db,user(db,'employee')).design,'riwaq');
  // موظف آخر لم يختر شيئًا يبقى على افتراضي المنصة.
  assert.equal(effectiveAppearance(db,user(db,'manager')).design,'depth','الافتراضي لم يتغير');
});

test('تصميم خارج القائمة يُرفض قبل أن يصل القاعدة',t=>{
  const db=setup(t),u=user(db,'employee');
  assert.throws(()=>transaction(db,()=>setPersonalAppearance(db,u,{design:'no-such-design',theme:'dark'})));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_appearance WHERE design=?').get('no-such-design').n,0);
});
