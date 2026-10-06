// مساعد اختبار: نسخة مخرج معتمدة في الاستوديو ومسار مراجعة على تلك النسخة، بدوال الوحدات نفسها — لا صفّ يُكتب باليد.
// تستعمله اختبارات الإنتاج (المعالجة التي يصوّرها) والمحتوى والمؤثرين (النسخة التي يُنشر منها) منذ تسليمات الحزمة 4
// (الفرع p4/specialist-handoffs). البيانات مصطنعة كلها.
//   approvedVersion  موجز يعتمده منشئ المشروع، وأصل بحقوقه يفحصه، ومخرج يجتاز الفحوص الخمسة — فيُرجع النسخة المعتمدة وبصمتها.
//   reviewRoute      مسار بمرحلة داخلية واحدة على النسخة؛ يُقرَّر «موافق» ما لم يُطلب غيره (decision:null يتركه جاريًا).
import { transaction } from '../app/db.mjs';
import { can, grantAccess } from '../app/access.mjs';
import { createStudio, studioAction } from '../app/studio.mjs';
import { createRoute, reviewAction, getRoute } from '../app/review-rounds.mjs';

const riyadh = (offset = 0) => new Date(Date.now() + 3 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const creative = () => ({ audience: 'جمهور مصطنع للاختبار', audience_basis: 'افتراض محلي معلن؛ لم يجر بحث ميداني', message: 'رسالة تجريبية معتمدة',
  prohibited_messages: 'لا ادعاءات صحية', measurement_source: 'لوحة تجريبية', scope: 'مخرج واحد بنسخته العربية' });
let counter = 0;

export function approvedVersion(db, users, { project, campaign = '', author = 'employee', channel = 'instagram', title = 'مخرج تجريبي معتمد' }) {
  const tx = run => transaction(db, run), n = ++counter;
  let s = tx(() => createStudio(db, users[author], { project_id: project, title: `مساحة ${title} ${n}`,
    ...(campaign ? { campaign_id: campaign, ...creative() } : { objective: 'هدف تجريبي للمخرج', ...creative(), kpi: 'مؤشر تجريبي', channels: [channel] }) }));
  const reviewer = s.reviewer_id;
  const act = (who, action, input = {}) => (s = tx(() => studioAction(db, users[who], s.id, action, { version: s.version, ...input })));
  act(author, 'submit_brief');
  act(reviewer, 'approve_brief', { note: 'الموجز مراجع ومعتمد للاختبار' });
  act(author, 'add_asset', { name: `أصل تجريبي ${n}`, internal_reference: `ASSET_FIX_${n}`, rights_holder: 'صاحب حق مصطنع', rights_basis: 'owned',
    rights_evidence: 'إفادة ملكية داخلية مصطنعة للاختبار', valid_from: riyadh(), valid_until: riyadh(365), channels: [channel] });
  act(reviewer, 'inspect_asset', { asset_id: s.assets.at(-1).id, outcome: 'passed', evidence: 'طابقت الحقوق والقناة والمدة' });
  act(author, 'create_output', { title, channel, format: 'نص تجريبي', dimensions: 'مواصفات موصوفة', language: 'العربية', brand_reference: 'FIX-DEMO',
    acceptance: 'مطابقة الرسالة والهوية', content: `${title}: نص المخرج التجريبي.`, asset_ids: [s.assets.at(-1).id] });
  const outputId = s.outputs.at(-1).id;
  act(author, 'submit_output', { output_id: outputId });
  act(reviewer, 'approve_output', { output_id: outputId, note: 'اجتازت الفحوص الخمسة',
    quality_checks: { brand: 'passed', language: 'passed', claims: 'passed', accessibility: 'passed', specification: 'passed' } });
  const output = s.outputs.find(o => o.id === outputId);
  return { studio: s.id, output: output.id, version: output.current_version_id, digest: output.current_version.digest, revision: output.current_version.revision, reviewer, title };
}

export function reviewRoute(db, users, { version, opener = 'outsider', owner = 'employee', reviewer = 'manager', decision = 'approved', admin = 'admin' }) {
  const tx = run => transaction(db, run);
  for (const who of [opener, reviewer]) if (!can(db, users[who], 'review.manage'))
    tx(() => grantAccess(db, users[admin], { user_id: who, capability: 'review.manage', department_id: '', note: 'منح تجريبي لمسار مراجعة المعالجة' }));
  const route = tx(() => createRoute(db, users[opener], { output_version_id: version, name: `مراجعة تجريبية ${++counter}`, owner_id: owner, template_id: '',
    stages: [{ position: 1, name: 'مراجعة إبداعية', audience: 'internal', reviewer_ids: [reviewer], due_days: '', reminder_days: '', escalation_days: '' }] })).id;
  if (decision) {
    const view = getRoute(db, users[reviewer], route);
    tx(() => reviewAction(db, users[reviewer], route, 'decide', { version: view.version, stage_id: view.stages[0].id, decision, note: 'قرار تجريبي على النسخة المعروضة' }));
  }
  return route;
}
