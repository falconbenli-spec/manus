// من أين جاء الزمن المستهدف، ومن تبنّاه.
//
// المسح الكامل للـ142 خدمة (21 سبتمبر) وجد أن **كل** زمن في الدليل جاء من `defaultTargetDays` بمطابقة بادئة الرمز،
// وأن `service_target_adoptions` فارغ تمامًا: لا مالك إجراء واحد اعتمد زمن خدمته. ومع ذلك كان الرقم يُعرض للموظف
// عاريًا — «المدة 7 أيام عمل» — فيقرؤه وعدًا قطعته إدارةٌ ما. لم تقطعه: «FIN-» بادئة، والبادئة ليست قرارًا.
//
// هذه الوحدة هي المصدر الواحد للجواب. كل موضع يصل فيه الزمن إلى إنسان — بطاقة الخدمة، وتاريخ الاستحقاق في شاشة
// الطلب، و«طلباتي»، والخط الزمني، وصندوق «ما عليّ»، والرئيسية، والتقارير، وقائمة خدمات الإدارة — يأخذ العبارة من
// هنا لا من عنده، فلا يبقى موضع واحد يقول الرقم بلا مصدره.
//
// الألفاظ ليست جديدة: «مسجَّل» و«مشتق» و«غير متاح» هي ألفاظ أولية البنود الصادقة نفسها في app/employee-profile.mjs
// (FIELD_KINDS)، وتمييز العدد من app/static/arabic-count.mjs. لا قاموس ثانٍ.
import { defaultTargetDays, fieldModel } from './service-catalog.mjs';
import { riyadhDate } from './work-calendar.mjs';
import { countNoun } from './static/arabic-count.mjs';

// أربع حالات لا حالتان: «مسجَّل» ليست «مشتق». رقمٌ في الدليل لا يطابق ما تشتقه البادئة كتبه إنسان بيده،
// لكنه ما زال بلا قرار تبنٍّ مكتوب — وهذا وصفٌ ثالث لا يجوز خلطه بالاثنين.
export const TARGET_KINDS=Object.freeze({adopted:'معتمد',derived:'مشتق',recorded:'مسجَّل',unset:'غير متاح'});

// العبارة التي يقرؤها الموظف. القاعدة الوحيدة: ما لم يتبنّه إنسان لا يُقدَّم وعدًا.
export const TARGET_NOTES=Object.freeze({
  adopted:'تبنّاه مالك الإجراء بقرار مكتوب',
  derived:'مشتق من عائلة رمز الخدمة، لم يتبنّه أحد بعد — ليس وعدًا قطعه أحد',
  recorded:'مسجَّل في الدليل بلا قرار تبنٍّ مكتوب — ليس وعدًا قطعه أحد',
  unset:'لا زمن مستهدف مسجَّل لهذه الخدمة'
});
// المقطع الذي تبحث عنه الاختبارات وتقرؤه العين في كل شاشة. تغييره تغييرٌ في عقدٍ مع القارئ، لا تحسين صياغة.
export const DERIVED_MARK='مشتق من عائلة رمز الخدمة';

const HOUR=['ساعة عمل واحدة','ساعتا عمل','ساعات عمل','ساعة عمل'];
// الكمية وحدها، بتمييز عربي صحيح: «يوما عمل» لا «2 يوم عمل». الساعات — حين تُحدَّد — هي المقياس (ترحيل 115).
export const targetAmount=target=>target?.hours?countNoun(target.hours,HOUR):target?.days?countNoun(target.days,'working_day'):'';

// العبارة الكاملة: الكمية ثم مصدرها. المتبنّى يُسمّي من تبنّاه ومتى، فالوعد يُنسب إلى قائله.
export function targetLabel(target){
  if(!target||target.kind==='unset')return TARGET_NOTES.unset;
  const source=target.kind==='adopted'
    ? `${TARGET_NOTES.adopted}${target.adopted_by_name?`: ${target.adopted_by_name}`:''}${target.adopted_on?` — ${target.adopted_on}`:''}`
    : TARGET_NOTES[target.kind];
  return `${targetAmount(target)} — ${source}`;
}

// آخر قرار مسجَّل على زمن هذه الخدمة، أيًّا كان مفتاح مقترحه (مقترحات الساعات الخمسة، أو تبنّي مدير الإدارة لرمز خدمته).
export const targetDecisionOf=(db,tenantId,serviceCode)=>db.prepare(`SELECT a.*,x.name AS decided_by_name FROM service_target_adoptions a
  LEFT JOIN users x ON x.id=a.decided_by WHERE a.tenant_id=? AND a.service_code=? ORDER BY a.decided_at DESC,a.rowid DESC LIMIT 1`).get(tenantId,serviceCode)??null;

// ما تشتقه بادئة الرمز لهذه الخدمة — الرقم الذي وُلدت به كل خدمات المنصة الـ142.
export const derivedDaysFor=serviceCode=>defaultTargetDays({code:serviceCode,fields:fieldModel(serviceCode)??[]});

// الجواب الكامل عن زمن خدمة واحدة. لا يُخزَّن: يُحسب عند العرض من الدليل وسجل التبني، فلا يتأخر عن مصدره.
export function targetProvenance(db,tenantId,serviceCode,row){
  const stored=row??db.prepare('SELECT target_days,target_hours FROM service_directory WHERE tenant_id=? AND service_code=?').get(tenantId,serviceCode)??null;
  const days=stored?.target_days??0,hours=stored?.target_hours??0;
  const decision=targetDecisionOf(db,tenantId,serviceCode);
  // التبني يُصدَّق بمطابقة ما تبنّاه لما هو مسجَّل الآن: قرارٌ قديم رجع عنه صاحبه لا يظل يزيّن رقمًا آخر.
  const adopted=decision?.decision==='adopted'&&(decision.target_days??0)===days&&(decision.target_hours??0)===hours;
  const derivedDays=derivedDaysFor(serviceCode);
  const kind=!days&&!hours?'unset':adopted?'adopted':(!hours&&days===derivedDays?'derived':'recorded');
  const target={
    service_code:serviceCode,days,hours,kind,kind_name:TARGET_KINDS[kind],
    adopted:kind==='adopted',derived_days:derivedDays,
    adopted_by:adopted?decision.decided_by:null,adopted_by_name:adopted?decision.decided_by_name??null:null,
    adopted_on:adopted&&decision.decided_at?riyadhDate(decision.decided_at):null,
    basis:adopted?decision.basis:null,
    // قرار «رفض» مسجَّل يبقى ظاهرًا: مالك الإجراء قال إن هذا الرقم ليس التزامه، وهذه معلومة لا تُطوى.
    declined:decision?.decision==='rejected'?{by:decision.decided_by_name??null,on:decision.decided_at?riyadhDate(decision.decided_at):null,basis:decision.basis}:null,
    note:TARGET_NOTES[kind]};
  return {...target,amount:targetAmount(target),label:targetLabel(target)};
}

// قائمة الخدمات مع أزمنتها في استعلامين لا في استعلامين لكل خدمة: تُستعمل حيث تُعرض عشرات الخدمات معًا (الدليل، شاشة التبني).
export function targetsByCode(db,tenantId){
  const directory=db.prepare('SELECT service_code,target_days,target_hours FROM service_directory WHERE tenant_id=?').all(tenantId);
  return new Map(directory.map(row=>[row.service_code,targetProvenance(db,tenantId,row.service_code,row)]));
}
// يضيف `target` إلى كل خدمة في قائمة الدليل دون أن يمسّ حقلًا قائمًا. `target_days` يبقى كما هو لمن يقرؤه.
export function annotateTargets(db,tenantId,services){
  const targets=targetsByCode(db,tenantId);
  return services.map(s=>({...s,target:targets.get(s.code)??targetProvenance(db,tenantId,s.code,{target_days:s.target_days??0,target_hours:s.target_hours??0})}));
}
