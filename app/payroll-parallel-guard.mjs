// حارس الشهر الموازي (الحزمة 4، P4-HR-5، الترحيل 176). وحدة ورقة بلا تبعيات تقريبًا، تستدعيها مسارات المال المشتركة سطرًا واحدًا
// في كل مسار — دفع المسير (app/payroll-extras.mjs)، وملف حماية الأجور (app/wage-protection.mjs)، وقيد المسير (app/ledger.mjs)،
// والقسيمة (app/payroll.mjs)، والأثر الرجعي (app/payroll-retro.mjs) — فلا تدخل تلك الملفات في دورة استيراد مع وحدة المسير الموازي.
//
// القاعدة (D10، الموصى به): في الشهر المعلن موازيًا النظام السابق هو اللي يدفع وهو سجلّ الشهر، والمنصة تحسب وتقارن بس.
// فدفع المنصة له يصرف الراتب مرتين، وملف حماية أجور منها يسجّل أجرًا ثانيًا لدى الجهة، وقيد من مسيرها يكرر مصروف الشهر في الدفتر،
// وقسيمة منها تخالف ما استلمه الموظف. القوادح في الترحيل 176 تمنع الثلاثة الأولى في القاعدة أيضًا.
import { refuse } from './refusal.mjs';

const PATHS=Object.freeze({payment:'دفع رواتبه من المنصة',wps:'ملف حماية أجور له من المنصة',journal:'قيد لمسيره من المنصة',payslip:'قسيمة له من المنصة'});

export function parallelMonth(db,tenantId,month){
  if(typeof tenantId!=='string'||typeof month!=='string')return null;
  return db.prepare("SELECT id,month,declared_at FROM payroll_parallel_months WHERE tenant_id=? AND month=? AND status='declared'").get(tenantId,month)??null;
}
export const isParallelMonth=(db,tenantId,month)=>!!parallelMonth(db,tenantId,month);

// الرفض المسمّى لكل مسار: الشهر ودافعه، وما الذي يغيّره، ومن يملكه.
export function assertPlatformPays(db,tenantId,month,path){
  if(!isParallelMonth(db,tenantId,month))return;
  refuse(409,'parallel_month',{what:`شهر ${month} شهر موازٍ: النظام السابق هو اللي يدفعه، والمنصة تحسبه وتقارنه بس — فما فيه ${PATHS[path]??'إجراء مال من المنصة'}`,
    missing:[{document:'سحب إعلان الشهر الموازي بيد معتمد ثانٍ، قبل ما تنستورد دفعة النظام السابق له',
      why:'الشهر المعلن موازيًا يدفعه النظام السابق؛ دفعه أو تسجيله من المنصة كمان يصرف الراتب مرتين ويكرر مصروف الشهر',
      owner:'معتمد المسير غير اللي أعلن الشهر',owner_role:'payroll.approve'}],
    next:`دفع ${month} وملف حماية أجوره وقيده وقسائمه كلها من النظام السابق. والمنصة تدفع من أول شهر بعد قرار الانتقال`,link:'#payroll-parallel'});
}

// للوحات التي تعرض موانعها قبل أن يُضغط زر (ملف حماية الأجور): البند نفسه بمفتاح وعنوان وتفصيل.
export function parallelBlocker(db,tenantId,month){
  if(!isParallelMonth(db,tenantId,month))return null;
  return {key:'parallel_month',title:`شهر ${month} موازٍ — النظام السابق يدفعه`,
    detail:'ملف حماية الأجور لهذا الشهر يطلع من النظام السابق اللي دفعه. المنصة تحسب الشهر وتقارنه في «المسير الموازي» ولا تصدّر له ملفًا.'};
}

// يُسقط من قائمةٍ صفوف الشهور الموازية في موضعها (للقسائم والمسيرات القابلة للدفع)، ويعيد القائمة نفسها.
export function dropParallelMonths(db,tenantId,rows){
  const keep=rows.filter(row=>!isParallelMonth(db,tenantId,row.month));
  rows.splice(0,rows.length,...keep);
  return rows;
}
