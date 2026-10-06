import { audit, now } from './db.mjs';
import { fail } from './auth.mjs';
import { isSuperAdmin } from './access.mjs';

// المظهر (DESIGNS-ADDENDUM §هـ): خمسة تصاميم داخل نظام واحد، لكل منها وضع داكن وفاتح. «كوكبة 360» (depth) هو افتراضي المنصة منذ الهجرة 095.
// الحسم على الخادم وحده: اختيار المستخدم الشخصي (إن لم يُقفل) ← افتراضي الشركة ← depth/dark. الواجهة تطبّق ما يصلها ولا تعيد الحساب.
// «auto» (يتبع الجهاز) اختيار صريح في الشاشة، وليس افتراضيًا أبدًا (قرار المالك 4).
export const DESIGNS=['depth','classic','void','field','slate','studio','riwaq','yawm','markaz','classicplus'];
export const THEMES=['auto','dark','light'];
export const FALLBACK=Object.freeze({design:'depth',theme:'dark'});

const DESIGN_LIST=Object.freeze([
  {key:'depth',name:'كوكبة 360',latin:'Constellation 360',description:'كوكبة حية من فواصل النمط تتشكل وتدور في فراغ أسود صافٍ، وطباعة كبيرة بلا ألواح؛ تهدأ إلى غبار خافت في شاشات العمل. هذا هو افتراضي المنصة.'},
  {key:'classicplus',name:'الكلاسيكي المطوّر',latin:'الكلاسيكي المطوّر',description:'روح الكلاسيكي بهوية 3,6T: اختصارات بأيقونات مجسّمة خفيفة، قوائم متابعة واضحة، ومسافات مرتبة على اللابتوب والجوال، مع حفظ الخدمات والبيانات والصلاحيات.'},
  {key:'classic',name:'الكلاسيكي',latin:'Classic',description:'التصميم السابق بطابع أبل: أسطح فاتحة ناعمة وزوايا مستديرة وخط واضح.'},
  {key:'void',name:'الفراغ',latin:'VOID',description:'أرض سوداء خالصة يتقدّمها المحتوى وحده، ويقابلها «الورق» الأبيض في الوضع الفاتح.'},
  {key:'field',name:'الحقل 77',latin:'FIELD 77',description:'فيروزي الهوية يغمر شاشات الدخول والفهرس وواجهة الرئيسية كما في بطاقات الشركة ومطبوعاتها، ويجري العمل على أرض فحمية أو على ورق الهوية.'},
  {key:'studio',name:'مدار 360',latin:'مدار 360',description:'مساحة تشغيل معيارية بهوية فيروزية، تنقل جانبي وأدوات واضحة، تضع الطلبات والقرارات في المقدمة.'},
  {key:'slate',name:'الفحمي',latin:'SLATE',description:'أرض فحمية هادئة أخف من السواد الخالص، ويقابلها الرمادي السماوي في الوضع الفاتح.'},
  {key:'riwaq',name:'الرواق',latin:'RIWAQ',description:'أرض هادئة تعلوها بطاقات تُقرأ أجسامًا بلا ظل، وسؤال واحد كبير يفتح الشاشة، وفيروزي الهوية في الفعل الواحد وحده بينما تحمل الحالات ألوان الدليل.'},
  {key:'yawm',name:'اليوم',latin:'YAWM',description:'بطاقة ترتفع عن ورق الهوية بظل ناعم، وزوايا واسعة، وأفعال دائرية، وأرقام كبيرة مجدولة في بلاطات عليها قرص ملوّن؛ أخو «الرواق» بالبنية ونقيضه بالارتفاع والحركة.'},
  {key:'markaz',name:'مركز الأثر',latin:'IMPACT CENTRE',description:'أرض فحمية عميقة تعلوها أسطح مصمتة يفصلها خيط شعرة لا ظل، وفيروزي الهوية للفعل الواحد ومؤشّر البؤرة وحدهما؛ والحالات تُقال بخيطٍ جانبيّ وحبر لا بخلفية ملوّنة، والزجاج محصور في شريط الجوال والمسحوب، والحركة تُعلّم ولا تُزيّن.'}
]);
const THEME_LIST=Object.freeze([{key:'dark',name:'داكن'},{key:'light',name:'فاتح'},{key:'auto',name:'يتبع الجهاز'}]);

const REASON_MIN=10,REASON_MAX=1000;
const plain=input=>input!==null&&typeof input==='object'&&!Array.isArray(input);
const exactly=(input,keys)=>{const given=Object.keys(input);return given.length===keys.length&&keys.every(k=>Object.hasOwn(input,k));};
const valid=(design,theme)=>DESIGNS.includes(design)&&THEMES.includes(theme);
function writing(db){if(!db.isTransaction)fail(500,'transaction_required','يتطلب حفظ المظهر معاملة قاعدة بيانات');}
const companyRow=(db,tenantId)=>db.prepare('SELECT design,theme,locked,version,updated_by,updated_at FROM appearance_settings WHERE tenant_id=?').get(tenantId)??null;
const personalRow=(db,u)=>db.prepare('SELECT design,theme,version,updated_at FROM user_appearance WHERE user_id=? AND tenant_id=?').get(u.id,u.tenant_id)??null;

// افتراضي الشركة كما هو مخزَّن. غياب الصف = depth/dark غير مقفل، ورقم الإصدار 0.
export function companyAppearance(db,tenantId){
  const row=companyRow(db,tenantId);
  if(!row)return {...FALLBACK,locked:false,version:0,updated_at:null,updated_by_name:null};
  const by=row.updated_by?db.prepare('SELECT name FROM users WHERE id=? AND tenant_id=?').get(row.updated_by,tenantId)?.name??null:null;
  return {design:row.design,theme:row.theme,locked:!!row.locked,version:row.version,updated_at:row.updated_at,updated_by_name:by};
}

// قراءة خالصة تُستدعى مع كل /api/me و/api/login: استعلامان بصف واحد على مفتاحين أساسيين، ولا شيء غيرهما.
export function effectiveAppearance(db,u){
  const company=db.prepare('SELECT design,theme,locked FROM appearance_settings WHERE tenant_id=?').get(u.tenant_id),locked=!!company?.locked;
  if(!locked){
    const own=db.prepare('SELECT design,theme FROM user_appearance WHERE user_id=? AND tenant_id=?').get(u.id,u.tenant_id);
    if(own&&valid(own.design,own.theme))return {design:own.design,theme:own.theme,locked:false,source:'personal'};
  }
  if(company&&valid(company.design,company.theme))return {design:company.design,theme:company.theme,locked,source:'company'};
  return {...FALLBACK,locked:false,source:'default'};
}

export function appearanceView(db,u){
  const manage=isSuperAdmin(u),own=personalRow(db,u),company=companyAppearance(db,u.tenant_id);
  return {
    appearance:effectiveAppearance(db,u),
    personal:own?{design:own.design,theme:own.theme,updated_at:own.updated_at}:null,
    // اسم من غيّر الافتراضي يراه من يديره فقط؛ الموظف يكفيه التصميم والوضع والقفل.
    company:manage?company:{...company,updated_by_name:null},
    can_manage:manage,
    designs:DESIGN_LIST.map(d=>({...d})),
    themes:THEME_LIST.map(t=>({...t}))
  };
}

// الاختيار الشخصي: {design,theme} بالضبط أو {reset:true} بالضبط. آخر كتابة تغلب (زر الوضع في الفهرس يكتب بلا رقم إصدار).
// لا يُسجَّل في سجل التدقيق عمدًا (الملحق §هـ.2): تبديل الوضع بضغطة واحدة كان سيُغرق السلسلة بما لا أثر له على أحد غير صاحبه.
export function setPersonalAppearance(db,u,input){
  writing(db);
  const reset=plain(input)&&exactly(input,['reset'])&&input.reset===true;
  if(!reset&&!(plain(input)&&exactly(input,['design','theme'])&&valid(input.design,input.theme)))fail(400,'invalid_fields','اختر تصميمًا ووضعًا من القائمة');
  if(companyRow(db,u.tenant_id)?.locked)fail(409,'appearance_locked','المظهر موحّد من إدارة المنصة');
  if(reset)db.prepare('DELETE FROM user_appearance WHERE user_id=? AND tenant_id=?').run(u.id,u.tenant_id);
  else db.prepare('INSERT INTO user_appearance(user_id,tenant_id,design,theme,version,updated_at) VALUES(?,?,?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET design=excluded.design,theme=excluded.theme,version=user_appearance.version+1,updated_at=excluded.updated_at WHERE user_appearance.tenant_id=excluded.tenant_id').run(u.id,u.tenant_id,input.design,input.theme,now());
  return {appearance:effectiveAppearance(db,u)};
}

// افتراضي الشركة وقفله: للأدمن الأول وحده، بسبب مكتوب، وبسطر تدقيق يحمل ما كان وما صار.
// version اختياري: إن أُرسل (والشاشة ترسله) رُفض الحفظ حين يكون غيره قد بدّل الافتراضي منذ فتح النموذج.
export function setCompanyAppearance(db,admin,input){
  writing(db);
  if(!isSuperAdmin(admin))fail(403,'forbidden','افتراضي المظهر للأدمن الأول فقط');
  const allowed=['design','theme','locked','reason','version'];
  if(!plain(input)||Object.keys(input).some(k=>!allowed.includes(k))||!valid(input.design,input.theme)||typeof input.locked!=='boolean'||typeof input.reason!=='string'||(Object.hasOwn(input,'version')&&!Number.isInteger(input.version)))fail(400,'invalid_fields','حدد التصميم والوضع وحالة القفل واكتب السبب');
  const reason=input.reason.trim();
  if(reason.length<REASON_MIN||reason.length>REASON_MAX)fail(400,'invalid_fields',`اكتب سبب القرار في ${REASON_MIN} أحرف على الأقل و${REASON_MAX} على الأكثر`);
  const current=companyRow(db,admin.tenant_id);
  if(Object.hasOwn(input,'version')&&input.version!==(current?.version??0))fail(409,'stale_version','تغير افتراضي المظهر منذ فتحه. أعد التحميل');
  const before=current?{design:current.design,theme:current.theme,locked:!!current.locked}:{},after={design:input.design,theme:input.theme,locked:input.locked};
  if(current&&before.design===after.design&&before.theme===after.theme&&before.locked===after.locked)fail(409,'no_change','القيم المختارة هي افتراضي الشركة الحالي');
  const time=now();
  if(current)db.prepare('UPDATE appearance_settings SET design=?,theme=?,locked=?,version=version+1,updated_by=?,updated_at=? WHERE tenant_id=?').run(after.design,after.theme,after.locked?1:0,admin.id,time,admin.tenant_id);
  else db.prepare('INSERT INTO appearance_settings(tenant_id,design,theme,locked,version,updated_by,updated_at) VALUES(?,?,?,?,1,?,?)').run(admin.tenant_id,after.design,after.theme,after.locked?1:0,admin.id,time);
  audit(db,admin,'appearance',admin.tenant_id,'appearance.company_default',before,after,reason);
  // مظهر الأدمن نفسه بعد القرار، فتطبّقه الواجهة فورًا.
  return {appearance:effectiveAppearance(db,admin)};
}
