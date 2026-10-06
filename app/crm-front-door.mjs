// باب أمامي واحد (الحزمة 4، P4-CRM-3): طلبات الكتالوج النصية الثلاثة صارت السجل المهيكل نفسه.
//
// كانت «تسجيل فرصة أو منافسة» (CRM-OPPORTUNITY) و«تسجيل خسارة فرصة» (CRM-LOSS) و«تسليم فرصة للتشغيل» (CRM-HANDOVER) طلباتٍ عامة
// بحقول نصية: اسم عميل يُكتب، وفرصة تُكتب، وعقد يُكتب. فالطلب لا يصير عميلًا ولا فرصة ولا صفقة، ويعيش بجوار خط الفرص ونموذج التسليم
// المشتق من الصفقة مسارًا ثانيًا بلا رابط: فرصة تُسجَّل مرتين، وخسارة بلا سبب من القائمة، وتسليم يعيد كتابة ما في الاتفاق.
//
// الآن: بطاقة الدليل تفتح شاشة السجل نفسه (app/module-routes.mjs وخيارات VAR-OPPORTUNITY)، وطلبٌ عام بأحد هذه الرموز لا يُنشأ —
// يُرفض برفض مكتوب يشير إلى السجل: ملف العميل الذي يطابق الاسم المكتوب، والفرصة المفتوحة التي يسمّيها، والصفقة التي يُسلَّم مشروعها،
// ومن يملك كل واحد منها. المرجع في الرفض لا يكشف اسم عميل خارج فريق السائل: رمز ملفه ومالكه فقط (قاعدة agency.clientConflicts).
import { refuse } from './refusal.mjs';
import { can } from './access.mjs';
import { personName } from './people-read.mjs';
import { clientNameKey } from './client-names.mjs';

export const CRM_FRONT_DOOR = Object.freeze({
  'CRM-OPPORTUNITY': { module: 'pipeline', link: '#pipeline', name: 'خط الفرص', record: 'الفرصة على ملف العميل في «خط الفرص»' },
  'CRM-LOSS': { module: 'pipeline', link: '#pipeline', name: 'خط الفرص', record: 'إغلاق الفرصة خاسرة بسبب من القائمة في «خط الفرص»' },
  'CRM-HANDOVER': { module: 'project-handover', link: '#project-handover', name: 'نموذج التسليم', record: 'نموذج التسليم BD-04 المشتق من الصفقة واتفاقها' }
});
const ACCOUNT_OWNER = { owner: 'مسؤول ملفات العملاء — حامل تصريح «ملفات العملاء»', owner_role: 'account_manager' };
const member = (db, u, clientId) => !!db.prepare('SELECT 1 FROM clients c LEFT JOIN client_members m ON m.client_id=c.id AND m.user_id=? AND m.removed_at IS NULL WHERE c.id=? AND (c.owner_id=? OR m.user_id IS NOT NULL)').get(u.id, clientId, u.id);
const text = value => typeof value === 'string' ? value.trim() : '';

// ملفات العملاء التي يطابقها الاسم المكتوب بعد تطبيع المنصة، في الكيان كله: التكرار لا يُكشف بالنظر في فريقي وحده.
function clientsNamed(db, u, name) {
  const key = name ? clientNameKey(name) : '';
  if (!key) return [];
  return db.prepare('SELECT id,code,legal_name,trade_name,owner_id FROM clients WHERE tenant_id=? ORDER BY code').all(u.tenant_id)
    .filter(c => [c.legal_name, c.trade_name].some(n => n && clientNameKey(n) === key))
    .map(c => ({ ...c, visible: member(db, u, c.id) }));
}
const clientItem = (c, why) => c.visible
  ? { document: `ملف العميل ${c.code} «${c.trade_name || c.legal_name}»`, why, owner: 'أنت — من فريق حساب العميل', owner_role: 'account_manager', doc_key: 'client' }
  : { document: `ملف العميل ${c.code}`, why: `${why}، وأنت مو في فريق حسابه`, owner: 'مسؤول حساب العميل', owner_role: 'account_manager', doc_key: 'client' };

function opportunityRoute(db, u, payload) {
  const found = clientsNamed(db, u, text(payload?.client)), route = CRM_FRONT_DOOR['CRM-OPPORTUNITY'];
  const missing = found.length
    ? found.map(c => ({ ...clientItem(c, 'الفرصة تُسجَّل على ملف العميل فتدخل التوقع وتنفتح منها صفقتها'), ...(c.visible ? {} : { owner: personName(db, c.owner_id) ?? 'مسؤول حساب العميل' }) }))
    : [{ document: `ملف عميل للجهة «${text(payload?.client) || 'المذكورة'}»`, why: 'الفرصة تُسجَّل على ملف عميل، والجهة ما لها ملف بالاسم المكتوب', ...ACCOUNT_OWNER, doc_key: 'client' }];
  refuse(409, 'use_structured_record', { what: `تسجيل الفرصة صار ${route.record}، ما يُرسل طلبًا نصيًا`, missing,
    next: found.some(c => c.visible) ? 'افتح «خط الفرص» وسجّل الفرصة على ملف العميل' : 'اطلب من مسؤول حساب العميل يضيفك لفريقه أو يفتح ملفه، ثم سجّل الفرصة من «خط الفرص»',
    link: route.link });
}
function lossRoute(db, u, payload) {
  const name = text(payload?.opportunity), route = CRM_FRONT_DOOR['CRM-LOSS'];
  const open = db.prepare("SELECT o.id,o.name,o.owner_id,o.client_id FROM opportunities o WHERE o.tenant_id=? AND o.status='open' ORDER BY o.created_at").all(u.tenant_id)
    .filter(o => name && clientNameKey(o.name) === clientNameKey(name) && member(db, u, o.client_id));
  const missing = open.length
    ? open.map(o => ({ document: `الفرصة المفتوحة «${o.name}»`, why: 'الخسارة تُغلق الفرصة نفسها بسبب من قائمة أسباب الخسارة وتعليق، وتُغلق صفقتها التي لم يُتعاقد عليها معها',
      owner: o.owner_id === u.id ? 'أنت — صاحب الفرصة' : personName(db, o.owner_id) ?? 'صاحب الفرصة', owner_role: 'account_manager', doc_key: 'opportunity' }))
    : [{ document: `فرصة مفتوحة باسم «${name || 'المذكورة'}» في فريق حساب أنت فيه`, why: 'الخسارة تُسجَّل على الفرصة نفسها لا في طلب منفصل', owner: 'صاحب الفرصة في «خط الفرص»', owner_role: 'account_manager', doc_key: 'opportunity' }];
  refuse(409, 'use_structured_record', { what: `تسجيل الخسارة صار ${route.record}، ما يُرسل طلبًا نصيًا`, missing,
    next: 'افتح الفرصة في «خط الفرص» واختر «إغلاق خاسرة» بسببها. والصفقة اللي تعاقدنا عليها ما تُخسر: إنهاؤها من «سجل العقود»', link: route.link });
}
function handoverRoute(db, u, payload) {
  const found = clientsNamed(db, u, text(payload?.client)).filter(c => c.visible), route = CRM_FRONT_DOOR['CRM-HANDOVER'];
  const deals = found.flatMap(c => db.prepare("SELECT k.id,k.name,k.owner_id,k.project_id FROM commercial_cases k WHERE k.client_id=? AND k.status IN ('contracted','project_active') ORDER BY k.created_at").all(c.id));
  const holder = can(db, u, 'intake.handover');
  const missing = deals.length
    ? deals.map(k => ({ document: k.project_id ? `نموذج التسليم لمشروع صفقة «${k.name}»` : `فتح مشروع صفقة «${k.name}» من اتفاقها`,
      why: k.project_id ? 'نموذج التسليم يُشتق من الصفقة واتفاقها وعرضها المقبول؛ ما يُكتب فيه إلا ما لا مصدر له' : 'التسليم يكون لمشروع مفتوح من الاتفاق',
      owner: k.project_id ? (holder ? 'أنت — حامل تصريح تسليم الأعمال' : 'حامل تصريح «تسليم الأعمال» في المشروع') : 'المدير المباشر لصاحب الصفقة', owner_role: 'business_development', doc_key: 'handover' }))
    : [{ document: `صفقة متعاقد عليها لعميل «${text(payload?.client) || 'المذكور'}» في فريق حساب أنت فيه`, why: 'التسليم للتشغيل يكون من صفقة اتفاقها موثّق ومشروعها مفتوح', owner: 'صاحب الصفقة في «العملاء والعروض»', owner_role: 'account_manager', doc_key: 'deal' }];
  refuse(409, 'use_structured_record', { what: `التسليم للتشغيل صار ${route.record}، ما يُرسل طلبًا نصيًا`, missing,
    next: 'افتح «نموذج التسليم» واختر المشروع؛ العميل والقيمة والمخرجات والدفعات تجيك من الصفقة', link: route.link });
}

// يُنادى من workflow.createRequest قبل كتابة أي طلب، كما يُنادى catalogAttendanceRoute: الرمز غير هذه الثلاثة يمرّ بلا أثر.
export function catalogCrmRoute(db, u, code, payload) {
  if (code === 'CRM-OPPORTUNITY') opportunityRoute(db, u, payload);
  else if (code === 'CRM-LOSS') lossRoute(db, u, payload);
  else if (code === 'CRM-HANDOVER') handoverRoute(db, u, payload);
}

// جاهزية بطاقات الدليل (app/module-routes.mjs): تفتح الشاشة حين تستطيع أن تستقبل السجل من هذا الحساب.
//   client_team       في فريق حساب عميل واحد على الأقل، وفي الكيان مرحلة فرص معتمدة — فتنفتح الفرصة على ملفه.
//   open_opportunity  صاحب فرصة مفتوحة — فتُغلق خاسرة من مكانها.
//   handover          يحمل تصريح تسليم الأعمال، وعضو في مشروع مفتوح من صفقة ولا نموذج تسليم له بعد.
export function crmReadiness(db, u) {
  const ready = [];
  const team = db.prepare('SELECT 1 FROM clients c LEFT JOIN client_members m ON m.client_id=c.id AND m.user_id=? AND m.removed_at IS NULL WHERE c.tenant_id=? AND (c.owner_id=? OR m.user_id IS NOT NULL) LIMIT 1').get(u.id, u.tenant_id, u.id);
  if (team && db.prepare("SELECT 1 FROM pipeline_stages WHERE tenant_id=? AND status='approved' LIMIT 1").get(u.tenant_id)) ready.push('client_team');
  if (db.prepare("SELECT 1 FROM opportunities WHERE tenant_id=? AND owner_id=? AND status='open' LIMIT 1").get(u.tenant_id, u.id)) ready.push('open_opportunity');
  if (can(db, u, 'intake.handover') && db.prepare(`SELECT 1 FROM commercial_project_baselines b JOIN project_members m ON m.project_id=b.project_id JOIN projects p ON p.id=b.project_id
      WHERE m.user_id=? AND p.tenant_id=? AND NOT EXISTS(SELECT 1 FROM project_handovers h WHERE h.project_id=b.project_id) LIMIT 1`).get(u.id, u.tenant_id)) ready.push('handover');
  return ready;
}
