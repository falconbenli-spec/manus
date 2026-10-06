import { fail } from './auth.mjs';
import { capabilitiesFor } from './access.mjs';
import { currentUser } from './delegations.mjs';

// نطاق لوحات القياس، مشترك بين `service-experience.mjs` و`process-insight.mjs` ليُقرأ في مكان واحد.
// المنح المقيَّد بإدارة يُقيّد اللوحة بإداراته: من مُنح تصريحًا لإدارته لا يقرأ أرقام غيرها.
export function insightScope(db,supplied){
  const u=currentUser(db,supplied);
  if(!u)fail(403,'forbidden','الحساب غير متاح');
  const {list,scopes,super:unrestricted}=capabilitiesFor(db,u);
  if(!unrestricted&&!list.includes('executive.view'))
    fail(403,'not_permitted','لوحات المدد ونتائج التجربة تحتاج تصريح اللوحة التنفيذية. اطلبه من مسؤول الصلاحيات');
  // null تعني كل إدارات الكيان؛ وقائمة تعني الإدارات الممنوحة وحدها.
  return {u,departments:unrestricted?null:scopes['executive.view']??null};
}

// سطر يظهر في كل شاشة قياس، وليس تجميلًا:
// القياس الذي يوجّه اللوم يُفسد بياناته، لأن الناس يتجنبون النظام الذي يُستعمل ضدهم — فيغلقون الطلب مبكرًا،
// أو يؤخرون تسجيله، أو يتفقون خارج المنصة. الاختناق عند خطوة أو إدارة، لا عند شخص.
export const NO_BLAME='هذه اللوحة تقيس الخطوات والإدارات لا الأشخاص: لا يظهر فيها اسم موظف منسوبًا إليه بطء ولا رأي. القياس الذي يوجّه اللوم يُفسد البيانات لأن الناس يتجنبون النظام.';
