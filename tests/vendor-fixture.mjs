import { transaction } from '../app/db.mjs';
import { grantAccess } from '../app/access.mjs';
import { createVendor, getVendor, vendorAction } from '../app/vendors.mjs';

// ملف مورد مصطنع مؤهل، لاختبارات المشتريات. بعد أن صار الكيان الذي بلا ملف ممنوعًا من العرض ومن الترسية
// (app/vendors.mjs — بوابة المورد)، صار كل اختبار يمشي دورة شراء يحتاج موردًا مسجَّلًا فعلًا. والمساعد هنا
// يبنيه بالمسار نفسه الذي يمشيه في التشغيل — يسجّله موظف، ويتحقق من وثائقه ويراجعه ويعتمده **شخص آخر** —
// ولا يكتب صفًّا في vendors بإدخال مباشر، فما يختبره الاختبار هو ما يجري في المنصة لا ما يختصره الاختبار.
// النظير المكتوب في tests/budget-fixture.mjs، وبالحارس نفسه: قاعدة في الذاكرة وبس.
//
// كل البيانات مصطنعة: لا اسم مورد حقيقي ولا سجل تجاري ولا رقم ضريبي يخص منشأة قائمة.
// المعرّفات تُشتقّ من مفتاح المورد نفسه لا من عدد الصفوف: العدّ يتغيّر حين يسبقه seedVendorsDemo أو
// مساعدٌ آخر، فيتصادم السجل التجاري أو الرقم الضريبي مع ملف قائم («معرف المورد مستخدم في ملف آخر»).
function refsFor(supplierKey){
  let h=0; for(const c of String(supplierKey))h=(h*31+c.charCodeAt(0))>>>0;
  const n=String(h%100000000).padStart(8,'0');
  return {entity_ref:'10'+n, vat_number:'3'+n.padStart(13,'0').slice(-13)+'3', suffix:n.slice(-2)};
}

export function approveVendor(db, supplierKey, overrides = {}) {
  if (db.prepare('PRAGMA database_list').all().find(r => r.name === 'main').file !== '') throw Error('يسمح بهذا المساعد في قاعدة اختبار بالذاكرة فقط');
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  // المسجِّل والمراجع شخصان: فصل المهام في مركز الموردين يمنع أن يتحقق المسجِّل من وثيقته أو يراجع ملفه.
  const registrar = users.employee, reviewer = users.outsider, assessor = users.manager;
  // المساعد يمنح ما يحتاجه ثم **يمحو أثره**: اختبارات كثيرة تمنح vendors.manage بنفسها بعد التجهيز،
  // فلو بقي منحُ المساعد لاصطدم منحُها به بـalready_granted. فما أضافه المساعد يُحذف صفُّه بعد الفراغ
  // (لا يُسحب بـrevoke، لأن الصفّ المسحوب يبقى في السجل ويُقرأ في شاشات مراجعة الصلاحيات).
  const borrowed = [];
  for (const user of [registrar, reviewer]) {
    if (!db.prepare("SELECT 1 FROM access_grants WHERE user_id=? AND capability='vendors.manage' AND revoked_at IS NULL").get(user.id)) {
      transaction(db, () => grantAccess(db, users.admin, { user_id: user.id, capability: 'vendors.manage', note: 'تصريح اختبار مصطنع لمركز الموردين' }));
      borrowed.push(user.id);
    }
  }
  const refs = refsFor(supplierKey), suffix = refs.suffix;
  const input = {
    legal_name: `منشأة توريد مصطنعة ${suffix}`, legal_name_en: '', trade_name: `علامة مصطنعة ${suffix}`,
    entity_type: 'company', country: 'SA', entity_ref: refs.entity_ref, vat_number: refs.vat_number,
    categories: ['print_gifts'], regions: 'الرياض', capacity_note: '', payment_terms: 'ثلاثون يومًا بعد المطابقة',
    data_source: 'نموذج تسجيل مصطنع لاختبار داخلي', supplier_key: supplierKey, ...overrides
  };
  const act = (who, vendor, action, values = {}) => transaction(db, () => vendorAction(db, users[who], vendor.id, action, { version: vendor.version, ...values }));
  const read = (vendor, who = 'employee') => getVendor(db, users[who], vendor.id);

  const { id } = transaction(db, () => createVendor(db, registrar, input));
  let x = getVendor(db, registrar, id);
  x = act('employee', x, 'add_contact', { name: `ممثل المورد ${suffix}`, role: 'مدير الحساب', email: `contact-${suffix}@vendor.invalid`, phone: '' });
  for (const kind of ['commercial_registration', 'vat_certificate']) {
    x = act('employee', read(x), 'add_document', { kind, reference: `مرجع وثيقة مصطنع ${kind} ${suffix}`, issued_on: '2026-01-01', expires_on: '2099-01-01' });
  }
  x = act('employee', read(x), 'submit');
  for (const document of read(x).documents.filter(d => d.verification === 'pending')) {
    x = act('outsider', read(x, 'outsider'), 'verify_document', { document_id: document.id, verification: 'verified', note: 'طابقنا الوثيقة مع مصدرها المصطنع' });
  }
  x = act('outsider', read(x, 'outsider'), 'review_duplicate', { decision: 'passed', note: 'ما فيه ملف ثاني بالمعرّفات نفسها' });
  x = act('outsider', read(x, 'outsider'), 'review_procurement', { decision: 'passed', note: 'الوثائق مكتملة والشروط مقبولة' });
  x = act('manager', read(x, 'manager'), 'review_technical', { decision: 'passed', note: 'العينات المصطنعة مطابقة للمواصفات' });
  x = act('outsider', read(x, 'outsider'), 'approve', { outcome: 'approved', reason: 'اجتاز فحص التكرار والتقييم الفني ومراجعة المشتريات' });
  const vendor = read(x);
  for (const id of borrowed) db.prepare("DELETE FROM access_grants WHERE user_id=? AND capability='vendors.manage'").run(id);
  return vendor;
}

// موردون متعددون بمعرّفاتهم، للاختبار الذي يحتاج ثلاثة عروض قبل الترسية.
export const approveVendors = (db, keys) => keys.map(key => approveVendor(db, key));

// ملف مورد **مسجَّل غير مؤهَّل**: يُنشأ ولا يُعتمد.
// البوابتان مفترقتان عمدًا في app/vendors.mjs: وجودُ الملف شرطُ قبول العرض (requireRegisteredVendor)،
// وتأهيلُه شرطُ الترسية (requireVendorGate). فالاختبار الذي يُثبت «لا ترسية على مورد غير مؤهل» يحتاج
// كيانًا موجودًا وغير مؤهل معًا — وهذا ما يبنيه هذا المساعد، ولا يبنيه approveVendor.
export function registerVendor(db, supplierKey, overrides = {}) {
  if (db.prepare('PRAGMA database_list').all().find(r => r.name === 'main').file !== '') throw Error('يسمح بهذا المساعد في قاعدة اختبار بالذاكرة فقط');
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const registrar = users.employee;
  const borrowed = !db.prepare("SELECT 1 FROM access_grants WHERE user_id=? AND capability='vendors.manage' AND revoked_at IS NULL").get(registrar.id);
  if (borrowed) transaction(db, () => grantAccess(db, users.admin, { user_id: registrar.id, capability: 'vendors.manage', note: 'تصريح اختبار مصطنع لمركز الموردين' }));
  const refs = refsFor(supplierKey), suffix = refs.suffix;
  const { id } = transaction(db, () => createVendor(db, registrar, {
    legal_name: `منشأة توريد مصطنعة غير مؤهلة ${suffix}`, entity_type: 'company', country: 'SA',
    entity_ref: refs.entity_ref, categories: ['print_gifts'],
    data_source: 'نموذج تسجيل مصطنع لاختبار داخلي', supplier_key: supplierKey, ...overrides }));
  const vendor = getVendor(db, registrar, id);   // يُقرأ قبل إعادة التصريح المستعار، وإلا سقط بـnot_permitted
  if (borrowed) db.prepare("DELETE FROM access_grants WHERE user_id=? AND capability='vendors.manage'").run(registrar.id);
  return vendor;
}
