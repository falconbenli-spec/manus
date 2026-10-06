// هوية الكيان: اسمه للعرض، وهل بياناته ما زالت مصطنعة (الترحيل 137)، ونص ذيل المستندات المطبوعة مشتقًّا من هذه الحقيقة.
//
// كان الذيل مكتوبًا بحرفه في أربعة ملفات — app/print-documents.mjs وapp/letters.mjs وapp/production.mjs وapp/client-reports.mjs —
// ولا يقرأ شيئًا: يقول عن كل فاتورة وقسيمة راتب وورقة استدعاء وخطاب وتقرير عميل إنها «بيئة تجريبية ببيانات مصطنعة»، صحّ هذا أم لم يصح.
// والمالك ينقل شركته كلها إلى المنصة، فقسيمة راتب حقيقية تصف نفسها بأنها وثيقة اختبار مشكلة على وشك أن تقع.
//
// فالحقيقة تُقرأ من مكان واحد: العمود tenants.demo_data (1 مصطنعة، 0 أقرّ المالك أنها بيانات الشركة)، كما يقرؤه حارس
// installServiceCatalog في app/service-catalog.mjs. والافتراض في كل باب هنا هو الحالة المصطنعة: نداءٌ نسي أن يمرر الحقيقة
// يطبع التحذير كما كان ولا يُسقطه صامتًا. إسقاط التحذير قرارٌ يتخذه المالك من الباب أدناه، لا أثرٌ جانبي لنداء ناقص.
import { audit } from './db.mjs';
import { fail } from './auth.mjs';
import { isSuperAdmin } from './access.mjs';
import { refuse } from './refusal.mjs';

export const SYNTHETIC=1;              // البيانات ما زالت مصطنعة
export const REAL=0;                   // المالك أقرّ أنها بيانات الشركة
export const PLATFORM_NAME='3,6T';     // اسم المنصة، لا اسم الكيان للعرض: الاسم يتغير والمنصة هي هي
export const BASIS_MIN=10,BASIS_MAX=1000;

// الصفر الصريح عددًا وحده يعني «صارت بيانات الشركة». أي شيء آخر — غياب، فراغ، نص، كيان غير موجود — يُقرأ مصطنعًا ويبقي التحذير.
// لا تُحوَّل القيمة بـNumber عمدًا: ‎Number(null)‎ صفر، فكان غياب القيمة يُسقط التحذير وهو أسوأ ما قد يقع هنا.
export const stillSynthetic=flag=>flag!==REAL;

// نص الذيل لحالة واحدة. في الحالة المصطنعة هو نص اليوم بحرفه؛ وفي الحالة الأخرى يقول ما يعرفه وحده:
// كيف تُحفظ الصفحة PDF، ومن أي منصة خرجت. ولا يقول إن البيانات حقيقية ولا إن المستند موثّق ولا شيئًا لا سبيل له إلى معرفته.
// feminine: «أُنتجت» للفاتورة والقسيمة والورقة والخطاب كما كُتبت، و«أُنتج» لتقرير العميل كما كُتب.
export function documentFooter(demoData=SYNTHETIC,{feminine=true}={}){
  const produced=feminine?'أُنتجت':'أُنتج';
  const save='استخدم «طباعة» من المتصفح ثم «حفظ كـ PDF».';
  return stillSynthetic(demoData)
    ?`${save} ${produced} من منصة ${PLATFORM_NAME} — بيئة تجريبية ببيانات مصطنعة.`
    :`${save} ${produced} من منصة ${PLATFORM_NAME}.`;
}

// الكيان كما هو مسجَّل. كيان لا صف له يُقرأ مصطنعًا: الغياب ليس إقرارًا.
export function tenantIdentity(db,tenantId){
  const row=db.prepare('SELECT id,name,demo_data FROM tenants WHERE id=?').get(tenantId);
  if(!row)return {id:tenantId,name:null,demo_data:SYNTHETIC,synthetic:true,exists:false};
  return {id:row.id,name:row.name,demo_data:row.demo_data,synthetic:stillSynthetic(row.demo_data),exists:true};
}

// ما تمرره مواضع الطباعة إلى نسخها: الحقيقة وحدها رقمًا.
export const tenantDemoFlag=(db,tenantId)=>tenantIdentity(db,tenantId).demo_data;

// آخر إقرار وسنده من سجل التدقيق. لا عمود «آخر تغيير» على tenants ولا يُضاف: السلسلة هي السجل.
function lastDeclaration(db,tenantId){
  const row=db.prepare(`SELECT actor_id,before_json,after_json,reason,created_at FROM audit_events
    WHERE tenant_id=? AND entity_type='tenant' AND action='tenant.demo_data' ORDER BY seq DESC LIMIT 1`).get(tenantId);
  if(!row)return null;
  const name=db.prepare('SELECT name FROM users WHERE id=? AND tenant_id=?').get(row.actor_id,tenantId)?.name??row.actor_id;
  return {by_name:name,at:row.created_at,basis:row.reason,
    from:JSON.parse(row.before_json)?.demo_data??null,to:JSON.parse(row.after_json)?.demo_data??null};
}

// لوحة القرار: للأدمن الأول وحده كما يفعل totp.securityPolicy — من لا يملك القرار لا يرى بابه.
// تعرض الذيل كما يُطبع اليوم والذيل كما سيصير، فالقرار يُتخذ على نصه لا على وصفه.
export function tenantDataView(db,u){
  if(!isSuperAdmin(u))return null;
  const t=tenantIdentity(db,u.tenant_id);
  return {name:t.name,demo_data:t.demo_data,synthetic:t.synthetic,
    footer_now:documentFooter(t.demo_data),footer_next:documentFooter(t.synthetic?REAL:SYNTHETIC),
    documents:['الفواتير الضريبية والإشعارات','قسائم الرواتب','خطابات الموارد البشرية','أوراق الاستدعاء','تقارير العملاء'],
    basis_min:BASIS_MIN,last:lastDeclaration(db,u.tenant_id)};
}

// الباب: إقرار المالك بطبيعة بيانات المنصة. معاملة واحدة، والأدمن الأول وحده، وسند مكتوب، وسطر تدقيق يحمل ما كان وما صار.
// إطفاء الوسم ليس إعدادًا: هو إعلانٌ بأن سجلات المنصة هي سجلات الشركة الحقيقية، ويسقط تحذير «بيانات مصطنعة» من خمسة مستندات.
export function declareTenantData(db,admin,input){
  if(!db.isTransaction)fail(500,'transaction_required','إقرار طبيعة بيانات المنصة يحتاج معاملة قاعدة بيانات');
  if(!isSuperAdmin(admin))refuse(403,'forbidden',{
    what:'ما ينفع يتغيّر إقرار طبيعة بيانات المنصة من حسابك',
    missing:[{document:'قرار مالك المنصة نفسه (الأدمن الأول)',
      why:'إطفاء الوسم إعلان بأن سجلات المنصة صارت سجلات الشركة الحقيقية، ويسقط تحذير «بيانات مصطنعة» من الفواتير والقسائم والخطابات وأوراق الاستدعاء وتقارير العملاء',
      owner:'مالك المنصة',owner_role:'admin'}],
    next:'اطلب من مالك المنصة يفتحها بنفسه من «أمان حسابي» ويكتب سنده'});
  const allowed=['demo_data','basis'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))
    ||![REAL,SYNTHETIC].includes(input.demo_data)||typeof input.basis!=='string')
    fail(400,'invalid_fields','حدد حال البيانات — مصطنعة أو بيانات الشركة — واكتب سند القرار');
  const basis=input.basis.trim();
  if(basis.length<BASIS_MIN||basis.length>BASIS_MAX)fail(400,'invalid_fields',`اكتب سند القرار في ${BASIS_MIN} أحرف على الأقل و${BASIS_MAX} على الأكثر`);
  const before=tenantIdentity(db,admin.tenant_id);
  if(!before.exists)fail(404,'not_found','ما لقينا كيانك في القاعدة، فما فيه شي يُقَر');
  if(before.demo_data===input.demo_data)fail(409,'no_change','الحال اللي اخترتها هي الحال المسجلة اليوم');
  db.prepare('UPDATE tenants SET demo_data=? WHERE id=?').run(input.demo_data,admin.tenant_id);
  audit(db,admin,'tenant',admin.tenant_id,'tenant.demo_data',{demo_data:before.demo_data},{demo_data:input.demo_data},basis);
  return tenantDataView(db,admin);
}
