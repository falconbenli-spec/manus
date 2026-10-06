// عالم تجريبي مشترك لاختبارات الحزمة 4 (العملاء): عميل واحد بفريق حسابه، ومرحلة فرص معتمدة، وأسباب خسارة، وفرصة مفتوحة.
// كل اسم ورقم هنا مصطنع وموسوم «تجريبي»؛ لا شخص حقيقي ولا جهة حقيقية.
//
// الأدوار في هذا العالم:
//   outsider  مسؤول حساب العميل (يملك ملفه ويحمل clients.manage)
//   employee  تطوير الأعمال: صاحب الفرصة وصاحب الصفقة، ويعدّ نموذج التسليم BD-04 (intake.handover بمنح صريح)
//   manager   مدير الفريق المباشر: يعتمد التأهيل والعرض ويفتح المشروع ويؤكد أمر الشراء
//   pm1       مديرة المشروع المسندة في التسليم
//   external  موظف في الكيان المعزول — لاختبارات العزل
import { randomUUID } from 'node:crypto';
import { openDb, transaction, now } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import * as agency from '../app/agency.mjs';
import * as pipeline from '../app/pipeline-estimates.mjs';
import * as commercial from '../app/commercial.mjs';
import { PASSWORD } from './definitions-fixture.mjs';
// منذ الترحيل 182 تُحفظ نسخة العرض على عرض سعر العميل (FRM-024) الذي تساويه، ويُتعاقد على ما قبله العميل.
import { boundQuote } from './proposal-fixture.mjs';

export const code = value => error => error.code === value;
export const riyadh = (offset = 0) => new Date(Date.now() + 3 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
export const caught = fn => { try { fn(); } catch (error) { return error; } throw new Error('لم يُرفض ما كان يجب رفضه'); };
export const CLIENT = { legal_name: 'شركة الأفق التجريبية للتجزئة', trade_name: 'الأفق التجريبي', sector: 'التجزئة', status: 'prospect', registration_number: '7001700170' };
export const OPPORTUNITY = { name: 'حملة إطلاق تجريبية SYN-7001', service_family: 'campaigns', value: '100000.00', expected_close_on: '2099-11-30',
  decision_maker: 'مدير تسويق تجريبي', budget_note: 'ميزانية تجريبية معلنة في الاجتماع', next_step: '', next_step_on: '' };
export const QUOTE = () => ({ scope: 'حملة إطلاق تجريبية: هوية الحملة وعشرة منشورات', currency: 'SAR', valid_until: '2099-12-01', lines: [
  { description: 'هوية الحملة التجريبية', quantity: '1', unit_price: '40000.00', unit_cost: '15000.00', discount: '0', tax_rate: '15', acceptance: 'اعتماد العميل الكتابي للهوية التجريبية', revisions: 3 },
  { description: 'منشور تجريبي مصمم', quantity: '10', unit_price: '4000.00', unit_cost: '1500.00', discount: '0', tax_rate: '15', acceptance: 'مطابقة الموجز ودليل الهوية', revisions: 2 }] });
export const CONTRACT = { agreement_evidence: 'محضر اتفاق تجريبي موقّع ومحفوظ في أرشيف التجربة', customer_representative: 'ممثل عميل تجريبي' };

// كلمة المرور نفسها التي يدخل بها sessionsFor في tests/definitions-fixture.mjs، فتعمل مسارات الخادم بلا منفذ على هذا العالم.
export function crmWorld(t, password = PASSWORD) {
  const db = openDb(':memory:');
  seed(db, password);
  t.after(() => db.close());
  db.prepare("INSERT INTO users(id,tenant_id,department_id,username,name,password_hash,role,manager_id) VALUES('pm1','36t','creative','pm1','مديرة مشروع تجريبية','unused','pm','manager')").run();
  const users = Object.fromEntries(db.prepare('SELECT * FROM users').all().map(u => [u.id, u]));
  const tx = run => transaction(db, run);
  tx(() => {
    for (const [user, capability, department] of [['employee', 'commercial.use', 'creative'], ['outsider', 'commercial.use', 'creative'], ['manager', 'commercial.use', 'creative'],
      ['outsider', 'clients.manage', ''], ['employee', 'intake.handover', '']])
      grantAccess(db, users.admin, { user_id: user, capability, department_id: department, note: 'منح تجريبي لاختبارات الحزمة 4' });
  });
  // تفويض الدفتر المالي المؤرخ: الإعداد للموظف والاعتماد للمدير، كما في tests/delivery-cycle.test.mjs.
  for (const [who, action] of [['employee', 'read'], ['employee', 'prepare'], ['manager', 'read'], ['manager', 'approve']])
    db.prepare('INSERT INTO finance_grants VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), '36t', who, users[who].role, action, '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 'admin', 'تفويض تجريبي للحزمة 4', null, now());
  const stageId = tx(() => pipeline.prepareStage(db, users.employee, { code: 'LEAD', name: 'فرصة أولية تجريبية', sort_order: 1, win_probability: '20',
    probability_basis: 'متوسط تجربة الشركة التجريبية في آخر سنة', confirmed_on: riyadh(), required_fields: [], idle_days: 14 })).id;
  tx(() => pipeline.stageAction(db, users.manager, stageId, 'approve_stage', { version: 1, note: 'اعتماد تجريبي' }));
  const reasons = {
    price: tx(() => pipeline.addLossReason(db, users.employee, { code: 'PRICE', name: 'السعر أعلى من المنافس' })).id,
    capacity: tx(() => pipeline.addLossReason(db, users.employee, { code: 'CAPACITY', name: 'لا طاقة لدينا في الموعد' })).id
  };
  const client = tx(() => agency.createClient(db, users.outsider, CLIENT)).id;
  for (const member of ['employee', 'manager']) tx(() => agency.clientAction(db, users.outsider, client, 'add_member', { user_id: member, role: 'عضو فريق الحساب التجريبي' }));
  tx(() => agency.clientAction(db, users.outsider, client, 'add_contact', { name: 'ممثلة عميل تجريبية', title: 'مديرة التسويق', email: 'contact@client.invalid', phone: '' }));
  const opportunity = (input = {}, who = 'employee') => tx(() => pipeline.createOpportunity(db, users[who], { client_id: client, stage_code: 'LEAD', ...OPPORTUNITY, ...input })).id;
  const opp = id => db.prepare('SELECT * FROM opportunities WHERE id=?').get(id);
  const kase = id => db.prepare('SELECT * FROM commercial_cases WHERE id=?').get(id);
  const view = (id, who = 'employee') => commercial.listCommercial(db, users[who]).find(c => c.id === id);
  const act = (who, id, action, input = {}) => tx(() => commercial.commercialAction(db, users[who], id, action, { version: kase(id).version, ...input }));
  const oppAct = (who, id, action, input = {}) => tx(() => pipeline.opportunityAction(db, users[who], id, action, { version: opp(id).version, ...input }));
  const openCase = (id, who = 'employee') => tx(() => commercial.createCaseFromOpportunity(db, users[who], id, { version: opp(id).version }));
  // من الصفقة المفتوحة إلى اتفاق موثّق: التأهيل المعبأ من الفرصة يعتمده المدير، ثم العرض، ثم الاتفاق.
  const contract = caseId => {
    act('manager', caseId, 'approve_qualification', { note: 'الاحتياج والميزانية من الفرصة مراجعان' });
    act('employee', caseId, 'save_quote', boundQuote(db, caseId, QUOTE()));
    act('employee', caseId, 'submit_quote');
    act('manager', caseId, 'approve_quote', { note: 'العرض والنطاق والهامش مراجعة' });
    return act('employee', caseId, 'register_contract', CONTRACT);
  };
  return { db, users, tx, client, reasons, opportunity, opp, kase, view, act, oppAct, openCase, contract };
}

// للاختبارات القائمة التي تغلق فرصة رابحة: الفوز صار يشترط صفقة متعاقدًا عليها مفتوحة من الفرصة نفسها.
// يكمل ما ينقص الفرصة وعميلها (رقم السجل، صاحب القرار، تاريخ الإغلاق) بمسارات المنصة، ثم يفتح الصفقة ويوصلها إلى اتفاق موثّق.
// clientOwner: صاحب ملف العميل (يسجّل رقم السجل إن غاب). approver: المدير المباشر لصاحب الفرصة.
export function contractedDealFor(db, users, opportunityId, { owner = 'employee', approver = 'manager', clientOwner = owner, registration = null } = {}) {
  const tx = run => transaction(db, run);
  const opp = () => db.prepare('SELECT * FROM opportunities WHERE id=?').get(opportunityId);
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(opp().client_id);
  if (!client.registration_number) tx(() => agency.clientAction(db, users[clientOwner], client.id, 'set_registration',
    { registration_number: registration ?? `SYN-${client.id.slice(0, 8).toUpperCase()}` }));
  const o = opp();
  if (!o.decision_maker || !o.expected_close_on || o.expected_close_on < riyadh())
    tx(() => pipeline.opportunityAction(db, users[owner], o.id, 'edit', { version: o.version, name: o.name, service_family: o.service_family,
      value: `${Math.floor(o.value_minor / 100)}.${String(o.value_minor % 100).padStart(2, '0')}`, expected_close_on: '2099-11-30',
      decision_maker: o.decision_maker || 'صاحب قرار تجريبي', budget_note: o.budget_note, next_step: o.next_step, next_step_on: o.next_step_on ?? '' }));
  const caseId = tx(() => commercial.createCaseFromOpportunity(db, users[owner], o.id, { version: opp().version })).id;
  const version = () => db.prepare('SELECT version FROM commercial_cases WHERE id=?').get(caseId).version;
  const act = (who, action, input = {}) => tx(() => commercial.commercialAction(db, users[who], caseId, action, { version: version(), ...input }));
  act(approver, 'approve_qualification', { note: 'تأهيل تجريبي معتمد' });
  act(owner, 'save_quote', boundQuote(db, caseId, QUOTE()));
  act(owner, 'submit_quote');
  act(approver, 'approve_quote', { note: 'عرض تجريبي معتمد' });
  act(owner, 'register_contract', CONTRACT);
  return caseId;
}
