import { fail } from './auth.mjs';
import { mailConfig, NOT_CONFIGURED_MESSAGE } from './mailer.mjs';

// حالة كل تكامل بمفردات العقد الأربع (docs/implementation/claude-code-erp-10of10-current-execution-prompt-en-20260930.md، القاعدة 9
// والحزمة 7): «محاكاة» محوّل محلي يعمل ولا يطلع منه شيء لأي جهة، و«جاهز لبيئة اختبار» محوّل مبني ينتظر وصولًا معتمدًا، و«موقوف»
// ينتظر قرارًا أو وصولًا، و«متصل» لا يُعلَن إلا بدليل مستقل على اتصال حي — ولا شيء هنا متصل. لا تُصنع استجابة نجاح.
export const INTEGRATION_STATUS=Object.freeze({
  simulated:'محاكاة محلية — يعمل في المنصة وما يطلع منه شي لأي جهة',
  'sandbox-ready':'جاهز لبيئة اختبار الجهة — ينتظر وصولًا معتمدًا ودليلًا مستقلًا',
  blocked:'موقوف — ينتظر قرارًا أو وصولًا',
  active:'متصل ويعمل بدليل مستقل'
});
const BLOCKERS_SERVICE=['توثيق رسمي لطريقة الربط ونطاق الخدمة المتاح','حساب مفوض وبيئة اختبار لدى الجهة','تنفيذ موصل واختبارات صلاحيات وتكرار وفشل','تحقق مستقل من الاتصال قبل التفعيل'];
const BLOCKERS_MIGRATION=['رابط المصدر وصلاحية الاطلاع','جرد الحقول والخدمات ومعاينة التكرارات','وجهة محمية مستقلة عن حسابات المعاينة','اختبار النقل والاستعادة قبل الاستيراد'];
// [المعرّف، الاسم، الفئة، الغرض، الحالة، أساسها]. البريد وحده حالته من الإعداد وقت القراءة (انظر statusOf).
const candidates = [
  ['qiwa','قوى','government','خدمات العمل والعقود','blocked','ما فيه موصل ولا حساب مفوض لدى الجهة؛ ينتظر قرار المالك ووصولًا معتمدًا'],
  ['gosi','التأمينات الاجتماعية','government','الاشتراكات وسجلات المشتركين','blocked','المنصة تحسب الاستقطاع محليًا ولا تتصل بالجهة؛ الربط ينتظر حسابًا مفوضًا وبيئة اختبار'],
  ['mudad','مدد','government','حماية الأجور','simulated','ملف حماية الأجور يُبنى محليًا من مواصفة المنشأة وأول سطر فيه SIMULATED، والرفع يدوي يسجّله موظف؛ المنصة ما ترفع شيئًا'],
  ['muqeem','مقيم','government','خدمات المقيمين','blocked','ما فيه موصل ولا حساب مفوض لدى الجهة؛ ينتظر قرار المالك ووصولًا معتمدًا'],
  ['zatca','هيئة الزكاة والضريبة والجمارك','government','الفوترة الإلكترونية','simulated','الفاتورة تُصدر وتُرقَّم وتُسلسل وتُؤرشف محليًا وتُطبع بعلامة «داخلية — ما تبلّغت»؛ المزوّد الافتراضي يرفض كل استدعاء ولا يُرسل شيئًا'],
  ['bank','البنك','finance','تنفيذ التحويلات وكشوف الحساب','simulated','تنفيذ الدفع يسجّله موظف يدويًا بمرجعه البنكي ودليله، والكشف يُستورد ملفًا يرفعه المحاسب، وملف تحويل الرواتب أول سطر فيه SIMULATED؛ لا مصرفية مفتوحة ولا تحويل من المنصة'],
  ['identity','الدخول المؤسسي','identity','تسجيل الدخول والتحقق الإضافي','blocked','الدخول بحسابات المنصة المحلية؛ مزوّد الهوية المؤسسي ينتظر اختيار المالك ووصولًا معتمدًا'],
  ['mail','بريد الشركة','productivity','الإشعارات المعتمدة',null,null],
  ['storage','تخزين الشركة','productivity','المرفقات والوثائق','blocked','المرفقات في تخزين المنصة المحلي؛ تخزين الشركة ينتظر قرار المالك ووصولًا معتمدًا'],
  ['accounting','النظام المحاسبي','finance','القيود والفواتير والمطابقة','blocked','قرار المالك: المنصة نفسها هي النظام المحاسبي، فما يُربط نظام محاسبي خارجي إلا بقرار جديد منه'],
  ['manus','منصة رأس المال البشري في مانوس','migration','حصر الخدمات ومعاينة نقل البيانات','blocked','نقل البيانات ينتظر رابط المصدر وصلاحية الاطلاع ووجهة محمية'],
  ['employee-portal','بوابة الموظف المصدر','migration','حصر الخدمات والبيانات المصدرية','blocked','نقل البيانات ينتظر رابط المصدر وصلاحية الاطلاع ووجهة محمية'],
  ['custom','منصة إضافية يحددها المستخدم','custom','تحديد المنصة وعقد الربط','blocked','ما تحددت المنصة ولا عقد الربط بعد']
];
// البريد: مهيأٌ في الإعداد لا يعني اتصالًا مثبتًا، فأقصى ما يُقال «جاهز لبيئة اختبار» حتى يثبت بدليل مستقل.
function statusOf(id,status,basis){
  if(id!=='mail')return {status,basis};
  return mailConfig().enabled?{status:'sandbox-ready',basis:'البريد مهيأ في إعداد الخادم، وما فيه دليل مستقل على تسليم حي؛ يبقى جاهزًا لبيئة اختبار حتى يثبت'}
    :{status:'blocked',basis:'البريد غير مهيأ في إعداد الخادم؛ الإشعارات تبقى داخل المنصة'};
}
// الحالة لجهة بمعرّفها، لمن يحتاجها من وحدة أخرى (الفوترة الإلكترونية، ملف الأجور، ملف التحويل): مصدرٌ واحد للعبارة.
export function integrationStatus(id){
  const c=candidates.find(x=>x[0]===id);
  return c?statusOf(c[0],c[4],c[5]).status:null;
}

export function integrationReadiness(db, actor) {
  const current=db.prepare('SELECT role,tenant_id,active FROM users WHERE id=?').get(actor?.id);
  if(!current?.active || current.tenant_id!==actor.tenant_id || !['admin','manager','pm'].includes(current.role)) fail(403,'forbidden','عرض حالة التكاملات غير متاح لهذا الدور');
  const connections=candidates.map(([id,name,category,purpose,status,basis])=>{
    const s=statusOf(id,status,basis);
    return {id,name,category,purpose,status:s.status,status_name:INTEGRATION_STATUS[s.status],status_basis:s.basis,adapter_implemented:false,last_success:null,
      blockers:category==='migration'?BLOCKERS_MIGRATION:BLOCKERS_SERVICE};
  });
  return {
    mode:'none_active',last_success:null,statuses:INTEGRATION_STATUS,active_count:connections.filter(c=>c.status==='active').length,
    blocked_events:db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE tenant_id=? AND channel='event' AND status='blocked'").get(current.tenant_id).n,
    // البريد قناة مستقلة في الصادر نفسه؛ حالته التفصيلية في شاشة «البريد والإشعارات» لمسؤول المنصة.
    mail:{enabled:mailConfig().enabled,message:mailConfig().enabled?'البريد مفعّل':NOT_CONFIGURED_MESSAGE,
      blocked:db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE tenant_id=? AND channel='email' AND status='blocked'").get(current.tenant_id).n,
      failed:db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE tenant_id=? AND channel='email' AND status='failed'").get(current.tenant_id).n},
    reason:'ما فيه تكامل متصل: كل جهة أدناه محاكاة محلية أو جاهزة لبيئة اختبار أو موقوفة، بحالتها وأساسها. «متصل» لا يُقال إلا بدليل مستقل على اتصال حي.',
    connections
  };
}
