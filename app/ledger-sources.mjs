// سجل أنواع المستندات المصدر للدفتر (الحزمة 3): كل نوع يقول كيف يُبنى قيده من أرقامه، وما الذي ينتظر قيدًا منه،
// وما يدخل منه في الأستاذ المساعد لكل حساب رقابي، وكيف يُقرأ في تتبّع المبلغ. الأنواع القائمة يسجّلها app/ledger.mjs،
// وأي وحدة أخرى تسجّل نوعها من ملفها هي — المدفوعات (مستحق مرتجع، تسوية مستحق)، والبنك (سطر كشف مصنّف)، والإقفال (قسط إطفاء).
//
// لماذا وحدة ثالثة لا جزءًا من ledger.mjs: الدفتر يستورد app/payables.mjs، فلو استوردت المدفوعات الدفترَ لتسجّل نوعها
// صارت دورة استيراد تُسقط التحميل في TDZ — السبب نفسه المكتوب في رأس app/cost-centres.mjs بالحرف. هذه الوحدة لا تستورد
// شيئًا، فيستوردها الجميع بلا دورة. وapp/ledger.mjs يعيد تصدير الدالتين لمن لا يقع في الدورة.
//
// النوع: {key, name, module, build, pending?, controls?, document?, approvals?, bank?}
//   build(db, u, id)        → null (المستند لم يبلغ حالته النهائية) أو {date, reference, description, lines, payable?}.
//                             السطر: [غرض|{account_id}, مدين, دائن, بيان] أو {purpose|account_id, cost_center_id?, debit_minor, credit_minor, memo}
//                             بالهللات أعدادًا صحيحة. ويرمي رفضًا مكتوبًا (refuse) حين يعرف لماذا لا يُبنى.
//   pending(db, tenantId)   → [{source_id, reference, amount_minor, date}] كل مستند نهائي ينتظر قيدًا منه.
//   controls[غرض](db, tenantId) → [{source_id, reference, date, amount_minor}] أثر المستند على الحساب الرقابي بإشارته الطبيعية
//                             (المدين موجب في الأصل، والدائن موجب في الالتزام) — يقرؤه controlReconciliation.
//   document(db, tenantId, id) → {reference, date, amount_minor, status, description} للتتبّع، بأي حالة كان المستند.
//   approvals(db, tenantId, id) → [{role, actor_id, at, note?}] من أعدّ ومن اعتمد ومن نفّذ.
//   bank: 'cash' حين يحرّك المستند مالًا في البنك (قبض، دفعة، ارتداد)، ويُترك لغير النقد. وهل يقبله جدول المطابقة البنكية
//         يقرؤه الدفتر من قائمة app/bank-reconciliation.mjs نفسها (SOURCE_KINDS)، فلا تُكتب القائمة مرتين.
// والرابط: {from, role, module, list(db, tenantId, id) → [{kind, id, reference, date, amount_minor, status}]}
//   role: 'settlement' (ما سوّاه: دفعة لمستحق، قبض لفاتورة)، 'settles' (ما يسوّيه هو)، 'reversal' (عكسٌ أو إشعار دائن).
const KINDS = new Map();
const LINKS = new Map();
const KEY = /^[a-z_]{3,40}$/;
const ROLES = new Set(['settlement', 'settles', 'reversal']);
const text = value => typeof value === 'string' && value.trim().length > 0;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);

// خطأ في التعريف خطأ مبرمج يُرفع TypeError عند أول تحميل، لا رفضًا يصل إلى مستخدم — قاعدة registerOptionList نفسها.
export function registerSourceKind(definition) {
  const d = definition, bad = message => { throw new TypeError(`registerSourceKind(${d?.key ?? '?'}): ${message}`); };
  if (!plain(d)) bad('التعريف كائن');
  // قيد العمود نفسه في finance_source_links منذ الترحيل 031: حروف لاتينية صغيرة وشرطة سفلية، من 3 إلى 40.
  if (!KEY.test(d.key ?? '')) bad('المفتاح حروف لاتينية صغيرة وشرطة سفلية، من 3 إلى 40 (قيد finance_source_links.source_kind)');
  if (KINDS.has(d.key)) bad('النوع مسجّل مرتين؛ النوع يعيش في وحدة واحدة');
  if (!text(d.name)) bad('الاسم العربي مطلوب — به يُقرأ المستند في «بانتظار الترحيل» وفي الرفض');
  if (!text(d.module)) bad('الوحدة المالكة مطلوبة');
  if (typeof d.build !== 'function') bad('build(db,u,id) مطلوبة: نوعٌ بلا قارئ لا يبني قيدًا');
  for (const hook of ['pending', 'document', 'approvals']) if (d[hook] !== undefined && typeof d[hook] !== 'function') bad(`${hook} دالّة`);
  if (d.controls !== undefined && (!plain(d.controls) || !Object.values(d.controls).every(fn => typeof fn === 'function'))) bad('controls كائن {الغرض: دالّة}');
  if (d.bank !== undefined && d.bank !== 'cash') bad("bank إما 'cash' أو يُترك: المطابقة البنكية تُقرأ من قائمة وحدة البنك");
  const frozen = Object.freeze({ pending: null, document: null, approvals: null, bank: null, ...d, controls: Object.freeze({ ...(d.controls ?? {}) }) });
  KINDS.set(frozen.key, frozen);
  return frozen;
}
export function registerSourceLink(definition) {
  const d = definition, bad = message => { throw new TypeError(`registerSourceLink(${d?.from ?? '?'}): ${message}`); };
  if (!plain(d) || !KEY.test(d.from ?? '')) bad('from مفتاح نوع مسجّل أو سيُسجَّل');
  if (!ROLES.has(d.role)) bad(`role إحدى: ${[...ROLES].join('، ')}`);
  if (!text(d.module)) bad('الوحدة المالكة مطلوبة');
  if (typeof d.list !== 'function') bad('list(db,tenantId,id) مطلوبة');
  const frozen = Object.freeze({ ...d });
  LINKS.set(d.from, [...(LINKS.get(d.from) ?? []), frozen]);
  return frozen;
}
export const sourceKind = key => KINDS.get(key) ?? null;
export const sourceKinds = () => [...KINDS.values()];
export const sourceLinks = (from, role) => (LINKS.get(from) ?? []).filter(link => !role || link.role === role);
