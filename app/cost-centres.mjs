// مركز التكلفة: القائمة وحلّها، في وحدة محايدة تستوردها المشتريات والمخصصات معًا — بلا استيراد متبادل بينهما.
//
// لماذا وحدة ثالثة؟ لأن الحلّ يحتاجه الطرفان: المشتريات تكتب مركز الطلب، والمخصصات تكتب مركز المخصص، وكلاهما
// يجب أن يشير إلى **الصفّ نفسه** في finance_cost_centers. وضعُه في إحداهما يصنع دورة استيراد:
// budgets → procurement → budgets. عملت الدورة بالمصادفة وحدها (resolveCostCenter تصريح function مرفوع)،
// لكن procurement تستورد من payables تصريحات `export const` تُقرأ في جسم الوحدة، فأيّ استيراد لاحق في الاتجاه
// المعاكس يُسقط التحميل في TDZ. وهو السبب نفسه المكتوب في رأس app/procurement-guards.mjs بالحرف.
//
// القائمة **مرآة** لا نصّ: خيارها صفٌّ في finance_cost_centers، وهو الجدول الذي بُني عليه الدفتر
// (ledger.activeMappings تضمّه أصلًا). قبل هذا لم يكن بين المشتريات وقائمة المالية أي رابط، فكان مركز التكلفة
// نصًّا يُطابَق بحروفه في budgets.usableBudget: «التسويق» و«تسويق» إما يردّان طلبًا مخصّصه ظاهر على الشاشة،
// وإما يحجزان من مال مركز آخر. العمود النصّي يبقى كما كُتب، ويُسجَّل بجواره معرّف الصفّ حين يُحلّ.
import * as v from './validation.mjs';
import { registerOptionList, registerAdoption, optionsFor, requireOption, adopted } from './options.mjs';

registerOptionList({key:'procurement.cost_center',label:'مركز التكلفة',label_en:'Cost centre',module:'procurement',
  owner:'المالية — من ينشئ مراكز التكلفة في الدفتر',owner_role:'finance',manage_capability:'finance.use',
  governance:'managed',defaults:[],columns:['procurement_purchases.cost_center','procurement_purchases.cost_center_id','project_budgets.cost_center','project_budgets.cost_center_id'],
  mirror:{table:'finance_cost_centers',value:'code',label:'name',creates:'صفّ مركز تكلفة في المالية',screen:'«الدفتر المالي» ← مراكز التكلفة'},
  note:'الخيارات هي مراكز التكلفة المسجّلة في المالية. مركز جديد يُنشأ هناك فيظهر هنا، ولا يُنشأ من قائمة.'});
// إغلاق الحقل على القائمة قرارٌ لا افتراض: اليوم يقبل الحقل نصًّا حرًّا كما كان، ومتى قرّر المالك إغلاقه
// (باعتماد مؤرَّخ يوقّعه شخصان) صار كل مركز خارج قائمة المالية مرفوضًا باسم الحقل ومالكه. لا يُغلق قبل أن
// تُحسم الطلبات التي بقي مركزها بلا معرّف في الترحيل 134، وهي معروضة في حمولة المشتريات.
registerAdoption({key:'procurement.cost_center_closed',label:'إغلاق مركز التكلفة على قائمة المالية',module:'procurement',
  owner:'المالية — من ينشئ مراكز التكلفة في الدفتر',owner_role:'finance',manage_capability:'finance.use',
  governance:'managed',default:false,
  basis:'سلوك اليوم: الحقل نصّ حرّ، ولا يُغلق إلا بقرار مؤرَّخ بعد حسم الطلبات التي بلا مركز مُحال إليه'});

// تطبيع المرجع للمقارنة وحده: التطبيع نفسه الذي تستعمله budgets.center منذ الترحيل 010، فلا تطبيعان يختلفان.
export const centerKey=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/gu,' ').toUpperCase();
// يعيد {text, id}: النصّ كما كتبه صاحبه (فالسجل القديم يُقرأ كما كُتب)، ومعرّف الصفّ إن حُلّ.
export function resolveCostCenter(db,tenantId,value) {
  const text = v.text(value,'مركز التكلفة المحلي',120),key = centerKey(text);
  const match = optionsFor(db,tenantId,'procurement.cost_center').options.find(o=>centerKey(o.value)===key);
  if (match) return {text,id:match.ref_id};
  // الحقل مغلق بقرار معتمد: القيمة خارج القائمة تُرفض برفض يسمّي الحقل بالعربية ومالكه وخطوته التالية.
  if (adopted(db,tenantId,'procurement.cost_center_closed').value===true) requireOption(db,tenantId,'procurement.cost_center',text,{field:'مركز التكلفة'});
  return {text,id:null};
}
