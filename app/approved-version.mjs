// نسخة المخرج المعتمدة التي يُنشر منها (الحزمة 4، P4-SPEC-3، الترحيل 189). موضع واحد يقول ما «النسخة المعتمدة»، ويقرؤه بند
// المحتوى في تقويم المحتوى (app/campaigns.mjs) وبند محتوى المؤثر (app/influencers.mjs) وتقرير العميل (app/client-reports.mjs):
//   - نسخةٌ اعتمدها مراجع الاستوديو بالفحوص الخمسة، وهي النسخة الحالية لمخرجها (ما قبلها رُدّ أو استُبدل)؛
//   - لم يردّها مسار مراجعة (changes_required)؛ وما دام مسارها جاريًا فلا نشر قبل قراره؛
//   - من عمل استوديو لعميل البند نفسه، وبند الحملة يأخذ نسخته من عمل مفتوح لحملته نفسها، وقناة النسخة قناة البند حين تكون له قناة.
// البند يحمل معرّف النسخة وبصمتها مقروءين من هنا، ولا يُكتب منهما حرف. لا رقم ولا ملف يُنسخ: النسخة نفسها هي المرجع.
import { refuse } from './refusal.mjs';
import { personName } from './people-read.mjs';
import { ROUTE_STATUS } from './review-rounds.mjs';

const parse = text => { try { return JSON.parse(text); } catch { return {}; } };

function versionRow(db, tenantId, versionId) {
  const row = typeof versionId === 'string' && db.prepare(`SELECT ver.id,ver.revision,ver.digest,ver.snapshot,o.status AS output_status,o.current_version_id,
      w.title AS studio_title,w.project_id,w.client_id,w.campaign_id,w.tenant_id
    FROM studio_output_versions ver JOIN studio_outputs o ON o.id=ver.output_id JOIN studio_workspaces w ON w.id=o.studio_id WHERE ver.id=? AND w.tenant_id=?`).get(versionId, tenantId);
  return row ? { ...row, snapshot: parse(row.snapshot), route: db.prepare('SELECT id,name,status,owner_id FROM review_routes WHERE output_version_id=?').get(row.id) ?? null } : null;
}

// ما يُعرض عن النسخة المربوطة: عنوانها ورقمها وبصمتها وعمل الاستوديو وحال مراجعتها. null للبند القديم بمرجعه النصي.
export function versionLabel(db, tenantId, versionId) {
  const row = versionId ? versionRow(db, tenantId, versionId) : null;
  return row ? { version_id: row.id, title: row.snapshot.title ?? '', channel: row.snapshot.channel ?? '', revision: row.revision, digest: row.digest, studio_title: row.studio_title,
    route_status: row.route?.status ?? null, route_status_name: row.route ? ROUTE_STATUS[row.route.status] : null } : null;
}

// الربط عند التقديم: النسخة تُرى لعضو مشروعها، ومعتمدة، ولم تُردّ، ومن عمل البند نفسه. كل رفض يقول ما الناقص والخطوة التالية.
export function bindableVersion(db, u, versionId, { client = null, campaign = null, channel = null, what = 'البند' } = {}) {
  const row = versionRow(db, u.tenant_id, versionId);
  if (!row || !db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(row.project_id, u.id))
    refuse(404, 'not_found', { what: `ما تقدر تربط ${what} بهالنسخة من حسابك`,
      missing: [{ document: 'عضوية في مشروع عمل الاستوديو', why: 'نسخ المخرجات تنقرأ لأعضاء مشروعها وحدهم', owner: 'منشئ المشروع', owner_role: 'project_owner' }],
      next: 'اطلب العضوية في مشروع العمل، أو اختر نسخة من مشاريعك' });
  const title = row.snapshot.title ?? 'المخرج';
  if (row.output_status !== 'approved' || row.current_version_id !== row.id)
    refuse(409, 'version_not_approved', { what: `النسخة ${row.revision} من «${title}» ما هي النسخة اللي اعتمدها الاستوديو`,
      next: 'قدّم النسخة في «الاستوديو والتسليم» وخلّ المراجع يعتمدها بالفحوص الخمسة، وبعدها اربطها' });
  if (row.route?.status === 'changes_required')
    refuse(409, 'version_rejected', { what: `مسار «${row.route.name}» طلب تعديلات على النسخة ${row.revision} من «${title}»، فما ينشر منها شيء`,
      next: 'النسخة الجديدة من المخرج تُعتمد وتفتح مسارها، وبعدها اربطها' });
  const mismatch = [];
  if (row.client_id && client && row.client_id !== client) mismatch.push('العميل');
  if (campaign && row.campaign_id !== campaign) mismatch.push(row.campaign_id ? 'الحملة' : 'الحملة (النسخة من عمل استوديو بلا حملة)');
  if (channel && row.snapshot.channel !== channel) mismatch.push('القناة');
  if (mismatch.length) refuse(409, 'version_mismatch', { what: `${mismatch.join(' و')}: نسخة «${title}» ما تطابق ${what}`,
    next: 'اختر نسخة من عمل الاستوديو المفتوح لحملة البند وعلى قناته، أو افتح عملًا للحملة من «الاستوديو والتسليم»' });
  return { version_id: row.id, digest: row.digest, revision: row.revision, title };
}

// عند النشر: مسار مراجعة النسخة إن وُجد ما يزال جاريًا أو ردّها — لا يُنشر قبل قراره ولا بعد ردّه.
export function assertPublishable(db, tenantId, versionId) {
  const row = versionId ? versionRow(db, tenantId, versionId) : null;
  if (!row?.route) return;
  const title = row.snapshot.title ?? 'المخرج';
  if (row.route.status === 'running')
    refuse(409, 'review_running', { what: `مسار «${row.route.name}» على النسخة ${row.revision} من «${title}» للحين جارٍ، فما يُنشر قبل قراره`,
      missing: [{ document: `قرار مسار «${row.route.name}»`, why: 'المراجعة جارية على النسخة نفسها', owner: personName(db, row.route.owner_id) ?? 'مالك ملف المراجعة', owner_role: 'review_owner' }],
      next: 'انتظر قرار المسار في «جولات المراجعة»؛ وإذا طلب تعديلات فالنسخة الجديدة تُربط بدلها' });
  if (row.route.status === 'changes_required')
    refuse(409, 'version_rejected', { what: `مسار «${row.route.name}» طلب تعديلات على النسخة ${row.revision} من «${title}»، فما تُنشر`,
      next: 'قدّم البند من جديد على النسخة المعدّلة بعد اعتمادها' });
}

// ما يُعرض للاختيار عند التقديم: النسخ المعتمدة الحالية في مشاريع القارئ، ولم يردّها مسار. الشاشة تصفّيها بعميل البند وحملته وقناته،
// والربط نفسه (bindableVersion) يعيد الفحص كاملًا — القائمة عرض لا إذن.
export function bindableVersions(db, u) {
  return db.prepare(`SELECT ver.id,ver.revision,ver.digest,ver.snapshot,w.title AS studio_title,w.client_id,w.campaign_id FROM studio_output_versions ver
    JOIN studio_outputs o ON o.id=ver.output_id AND o.current_version_id=ver.id AND o.status='approved' JOIN studio_workspaces w ON w.id=o.studio_id
    JOIN project_members m ON m.project_id=w.project_id AND m.user_id=? WHERE w.tenant_id=?
      AND NOT EXISTS(SELECT 1 FROM review_routes r WHERE r.output_version_id=ver.id AND r.status='changes_required') ORDER BY ver.created_at DESC,ver.id LIMIT 200`)
    .all(u.id, u.tenant_id).map(row => { const snapshot = parse(row.snapshot);
      return { id: row.id, title: snapshot.title ?? '', channel: snapshot.channel ?? '', revision: row.revision, digest: row.digest, studio_title: row.studio_title, client_id: row.client_id, campaign_id: row.campaign_id }; });
}
