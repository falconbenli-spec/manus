import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb,transaction } from '../app/db.mjs';
import { passwordHash } from '../app/auth.mjs';
import { createService } from '../app/workflow.mjs';
import { installLevelDefaults } from '../app/department-levels.mjs';

export function seed(db,password) {
  if(db.prepare('SELECT COUNT(*) AS n FROM users').get().n) throw new Error('Database already contains users. Setup will not overwrite them.');
  transaction(db,()=>{
    db.exec("INSERT INTO tenants(id,name) VALUES('36t','3,6T — بيئة تجريبية'),('isolated','كيان اختبار معزول'); INSERT INTO departments(id,tenant_id,name) VALUES('creative','36t','الفريق الإبداعي التجريبي'),('hr','36t','خدمات الموظف التجريبية'),('it','36t','الدعم التقني التجريبي'),('ops','36t','تشغيل المنصة'),('other','isolated','اختبار العزل');");
    const users=[
      ['manager','36t','creative','مدير الفريق التجريبي','manager',null],
      ['employee','36t','creative','الموظفة التجريبية','employee','manager'],
      ['outsider','36t','creative','موظف اختبار آخر','employee','manager'],
      ['hr','36t','hr','معتمدة خدمات الموظف','hr',null],
      ['it','36t','it','منفذ الدعم التقني','it',null],
      ['admin','36t','ops','مسؤولة المنصة','admin',null],
      ['external','isolated','other','موظف الكيان المعزول','employee',null]
    ];
    const digest=passwordHash(password);
    for(const [uid,tid,dept,name,role,manager] of users) db.prepare('INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES(?,?,?,?,?,?,?,?)').run(uid,tid,dept,uid,name,digest,role,manager);
    // مخطط الإصدار الأول لا يحمل العمود؛ الترحيل 020 يضيفه ويعيّن الأدمن الأول.
    try{db.prepare("UPDATE users SET admin_level='super' WHERE id='admin'").run();}catch{}
    // مستويات الإدارة (ترحيل 130): الترحيلات تجري عند فتح قاعدة فارغة، فلا كيان ولا حساب حينها.
    // الكيان الذي يُنشأ بعدها يأخذ البذرة نفسها التي كتبها الترحيل للكيانات القائمة (COMPANY_TEMPLATE).
    // **غياب الجدول وحده يُتجاوَز**، وهو حال قاعدة أُوقفت عند ترحيل أقدم (tests/migrations.test.mjs تبذر
    // عند 002 لتختبر الترقية). وما سواه — قيد يُخالَف، عمود تغيّر اسمه — يُرفع كما هو: كان الصيدُ الصامت
    // يترك قاعدةً بلا قالب وبلا مستويات، وتقرأ المقارنة الظلية عليها «نظيفة» لأنها لا تقارن شيئًا بشيء.
    // والسابقة في المستودع access.levelsEnabled، وهي في هذه الموجة نفسها.
    try{for(const tenant of ['36t','isolated']) installLevelDefaults(db,tenant);}
    catch(error){if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='permission_level_settings'").get())throw error;}
    const admin=db.prepare("SELECT * FROM users WHERE id='admin'").get();
    createService(db,admin,{code:'HR-LETTER',name_ar:'طلب خطاب وظيفي',name_en:'Employment letter request',department_id:'hr',description:'طلب داخلي يمر بالمدير ثم خدمات الموظف. لا يصدر خطابًا رسميًا تلقائيًا.',fields:[{key:'purpose',label:'الغرض من الخطاب',type:'textarea',required:true},{key:'recipient',label:'الجهة الموجه إليها',type:'text',required:true}],approval_policy:{steps:['manager','hr'],handler_role:'hr'}});
    createService(db,admin,{code:'IT-SUPPORT',name_ar:'طلب دعم تقني',name_en:'IT support request',department_id:'it',description:'اعتماد المدير ثم إحالة الطلب إلى منفذ الدعم وتوثيق الحل.',fields:[{key:'issue',label:'وصف المشكلة',type:'textarea',required:true},{key:'impact',label:'أثر المشكلة',type:'select',options:['يمنع العمل','يؤخر العمل','استفسار'],required:true}],approval_policy:{steps:['manager'],handler_role:'it'}});
    createService(db,admin,{code:'CREATIVE-BRIEF',name_ar:'تكليف إبداعي داخلي',name_en:'Internal creative brief',department_id:'creative',description:'تكليف مرتبط بمشروع اختياري، يحتاج هدفًا ومخرجًا وموعدًا قبل الاعتماد.',fields:[{key:'objective',label:'هدف التكليف',type:'textarea',required:true},{key:'deliverable',label:'المخرج المطلوب',type:'text',required:true},{key:'due_date',label:'موعد التسليم',type:'date',required:true}],approval_policy:{steps:['manager'],handler_role:'manager'}});
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.env.NODE_ENV==='production') throw new Error('Demo seed is disabled in production.');
  const db=openDb(resolve('work/local.sqlite')),password=randomBytes(24).toString('base64url');
  try {
    seed(db,password);mkdirSync('outputs',{recursive:true});
    writeFileSync('outputs/local-credentials.txt',`حسابات تجريبية محلية فقط\nالرابط: http://127.0.0.1:3600\n\nالمستخدمون: employee, manager, hr, it, admin, outsider, external\nكلمة المرور المحلية المشتركة: ${password}\n\nأُنشئت عشوائيًا لهذه النسخة. لا تستخدمها لحسابات الشركة.\n`,{mode:0o600,flag:'wx'});
    console.log('Created 7 synthetic accounts and 3 services. Credentials saved to outputs/local-credentials.txt.');
  } finally {db.close();}
}
