import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { login, ACCOUNT_FAILURE_LIMIT } from '../app/auth.mjs';

/* التخمين الموزَّع — العيب الذي أوجب هذا الملف:
 *
 * كان عدّادا الحدّ في `app/auth.mjs` كلاهما **مفتاحه العنوان**:
 *     keys=[[hash(ip+'\n'+username),10],[hash('ip\n'+ip),200]]
 * فمن يدوّر عنوان المصدر — شبكة جوال، مزوّد سحابي، أي وكيل — يجرّب كلمة واحدة من كل عنوان، فلا يبلغ
 * العدّاد الأول لأن مفتاحه يتغيّر معه، ولا الثاني للسبب نفسه. **الحساب المستهدَف لا يُقفل أبدًا**
 * مهما بلغ عدد المحاولات.
 *
 * وثلاثة أمور تضاعف الأثر على هذه المنصة: أدنى كلمة مرور ثمانية محارف بلا شرط تعقيد
 * (`passwordPolicy`)، والتحقق بخطوتين غير مفعَّل لأي حساب في قاعدة التشغيل (قياس 29 سبتمبر 2026)،
 * وتدوير العنوان يصير **أسهل** لا أصعب حين يُفتح النفق المشفَّر للوصول من أي مكان — وهو ما تخطط له
 * المنصة فعلًا.
 *
 * والتعليق القائم في auth.mjs يسمّي التوتر الحقيقي: «العدّادان يبقيان لكل عنوان على حدة، فلا يقفل
 * خطأ موظف بابَ زميله». فعدّاد على الحساب وحده يفتح حجبًا متعمَّدًا (يُقفل حسابُ زميل بمحاولات
 * مفتعلة). ولهذا سقفه **أعلى بكثير** من سقف (عنوان+حساب): ثلاثون محاولة فاشلة في ربع ساعة لا يبلغها
 * موظف يخطئ في كتابة كلمته، ويبلغها المخمِّن في ثوانٍ. والرقم نفسه قرار المالك، ولهذا هو ثابت مسمّى
 * يُقرأ من مكان واحد لا رقم مبثوث في السطر.
 */

const PASSWORD='synthetic-account-lockout';
const code=value=>error=>error.code===value;

function fixture(t){
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  return db;
}
// كما يناديها الخادم في app/server.mjs:395 — **خارج معاملة**. وهذا ليس تفصيلًا: تغليفها بمعاملة
// يُرجع عدّاد الفشل مع الخطأ المرمي، فلا يتراكم شيء ولا يبلغ سقفٌ أبدًا.
const attempt=(db,username,password,address)=>{
  try{return login(db,username,password,address);}catch(error){return error;}
};

test('السقف على الحساب نفسه مُعلَن ومعقول: أعلى من خطأ موظف، وأدنى من صبر مخمِّن',()=>{
  assert.equal(typeof ACCOUNT_FAILURE_LIMIT,'number');
  assert.ok(ACCOUNT_FAILURE_LIMIT>=20&&ACCOUNT_FAILURE_LIMIT<=60,
    `سقف فشل الحساب ${ACCOUNT_FAILURE_LIMIT}: أقل من عشرين يجعل حجب زميلٍ سهلًا، وأكثر من ستين يترك التخمين مفتوحًا.`);
});

test('تدوير العنوان لا يفتح تخمينًا بلا سقف على حساب بعينه',t=>{
  const db=fixture(t);
  // كل محاولة من عنوان جديد: العدّادان القديمان لا يبلغان سقفهما أبدًا بهذا الشكل.
  for(let i=0;i<ACCOUNT_FAILURE_LIMIT;i++){
    const result=attempt(db,'employee','wrong-guess-'+i,`198.51.100.${i+1}`);
    assert.ok(result instanceof Error,'المحاولة الخاطئة ترفض');
  }
  // ثم الكلمة الصحيحة من عنوان لم يُستعمل قط: يجب أن يكون الحساب مقفلًا، لا أن يُفتح.
  const after=attempt(db,'employee',PASSWORD,'203.0.113.77');
  assert.ok(after instanceof Error&&code('rate_limited')(after),
    `بعد ${ACCOUNT_FAILURE_LIMIT} محاولة فاشلة موزَّعة على ${ACCOUNT_FAILURE_LIMIT} عنوانًا، الحساب ما زال مفتوحًا. `
    +'العدّادان مفتاحهما العنوان، فتدويره يُلغي الحدّ كله.');
});

test('ولا يقفل حسابٌ بسبب فشلٍ على حساب آخر',t=>{
  const db=fixture(t);
  for(let i=0;i<ACCOUNT_FAILURE_LIMIT+5;i++)attempt(db,'employee','wrong-'+i,`198.51.100.${i+1}`);
  const other=attempt(db,'manager',PASSWORD,'203.0.113.88');
  assert.ok(!(other instanceof Error),'الحدّ على الحساب المستهدَف وحده، لا على المنصة.');
});
