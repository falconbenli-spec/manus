import { fail } from './auth.mjs';
import * as v from './validation.mjs';
import { can } from './access.mjs';
import { currentUser } from './delegations.mjs';
import { duePeriod } from './report-schedules.mjs';
import { visibleSnapshotIds, runReport } from './reports.mjs';
import { SECTIONS, MEASUREMENT_GAPS, GAP_STATUS, gapsRegister, sectionNotes, decisionRequests, canPrepare, canRead } from './epmo-report.mjs';

// لوحة الإدارة التنفيذية للمشاريع. الترحيل: app/migrations/118-epmo-report.sql
//
// في هذه المرحلة تعرض اللوحة ثلاثة أشياء فقط: ما وُضع أمام التنفيذيين، وسجل الفجوات بخططها،
// وتعليق الإدارة على كل قسم. التقرير المركّب نفسه — الأرقام ومصادرها — مرحلة تالية، ولا تُعرض
// هنا أرقامٌ مؤقتة تسدّ مكانه: رقم بلا مصدره أسوأ من لا رقم.
//
// الفترات تُحسب بـ`duePeriod` من app/report-schedules.mjs ولا تُكتب حسابات فترات ثانية هنا.
// حسابان للأسبوع المنتهي يعنيان أسبوعين مختلفين باسم واحد، ثم يختلف تقريران عن الفترة نفسها.
//
// ولقطات E01 حين تصل (المرحلة التالية) تمرّ بـ`visibleSnapshotIds` من app/reports.mjs وحدها:
// من يرى لقطة مختومة سؤال أجابه مركز التقارير بقواعده، ولا رأي لهذه الشاشة فيه.

const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const CADENCES = [['monthly', 'الشهر المنتهي'], ['weekly', 'الأسبوع المنتهي (الأحد إلى السبت)']];

// الفترات المتاحة: المنتهية والتي قبلها لكل تكرار، بحساب report-schedules.mjs لا بحساب محلي.
function periods(today) {
  const list = [];
  for (const [cadence, name] of CADENCES) {
    let cursor = today;
    for (let back = 0; back < 3; back++) {
      const p = duePeriod(cadence, cursor);
      list.push({ cadence, cadence_name: name, from: p.from, to: p.to, key: `${p.from}..${p.to}` });
      cursor = p.from; // الفترة السابقة تُحسب من أول الحالية، فتبقى الحدود من المصدر نفسه.
    }
  }
  const seen = new Set();
  return list.filter(p => !seen.has(p.key) && seen.add(p.key)).sort((a, b) => b.to.localeCompare(a.to) || a.cadence.localeCompare(b.cadence));
}

export function epmoBoard(db, supplied, query = {}) {
  const u = currentUser(db, supplied);
  if (!u) fail(403, 'forbidden', 'الحساب غير متاح أو موقوف. سجّل الدخول من جديد، أو راجع مسؤول المنصة');
  // من لا يملك أيًّا من التصريحين لا يرى الشاشة أصلًا: لا كتالوج، ولا فجوات، ولا أسئلة مفتوحة.
  if (!canRead(db, u)) fail(403, 'not_permitted', 'تقرير الإدارة التنفيذية للمشاريع لمُعِدّه ولحامل تصريح اللوحة التنفيذية');
  v.object(query, ['period_from', 'period_to']);
  const today = riyadhToday(), available = periods(today);
  const chosen = query.period_from || query.period_to
    ? { from: v.date(query.period_from ?? ''), to: v.date(query.period_to ?? '') }
    : { from: available[0].from, to: available[0].to };
  if (chosen.to < chosen.from) fail(400, 'date_order', 'نهاية الفترة تسبق بدايتها. صحّح التاريخين وأعد تشغيل التقرير');

  const prepare = canPrepare(db, u), gaps = gapsRegister(db, u, prepare);
  const tally = key => gaps.filter(g => g.status === key).length;
  const notes = sectionNotes(db, u, chosen), noted = new Map(notes.map(n => [n.section_key, n]));
  // المعرّفات المرئية تُقرأ من مركز التقارير وحده: من يرى لقطة مختومة سؤال أجابه هناك بقواعده،
  // ولا قاعدة رؤية ثانية في هذه الشاشة. ثم تُقرأ صفوف تلك المعرّفات وحدها للعرض.
  const visible = db.prepare("SELECT id FROM report_snapshots WHERE tenant_id=? AND report_key='E01'").all(u.tenant_id).length
    ? new Set(visibleSnapshotIds(db, u)) : new Set();
  const snapshots = db.prepare("SELECT s.id,s.params,s.status,s.created_at,s.approved_at,s.digest,c.name AS created_by_name,a.name AS approved_by_name FROM report_snapshots s JOIN users c ON c.id=s.created_by LEFT JOIN users a ON a.id=s.approved_by WHERE s.tenant_id=? AND s.report_key='E01' ORDER BY s.created_at DESC LIMIT 50")
    .all(u.tenant_id).filter(s => visible.has(s.id)).map(({ params, ...s }) => ({ ...s, params: JSON.parse(params) }));
  // التقرير نفسه: يُشغَّل من مركز التقارير (المفتاح E01) لا من حساب ثانٍ هنا، فما تراه الشاشة
  // هو ما تختمه اللقطة حرفًا بحرف. ولا اعتماد من هذه الشاشة: الاعتماد بفصل تفويضاته هناك.
  const report = runReport(db, u, 'E01', chosen);

  return {
    today, user_id: u.id,
    can_prepare: prepare,
    report,
    report_actions: prepare ? ['save_snapshot'] : [],
    // تلميح لا حكم: الاعتماد نفسه يبقى في مركز التقارير بفصل تفويضاته (من أعدّ لا يعتمد).
    can_approve_hint: can(db, u, 'executive.view')
      ? 'تصريح اللوحة التنفيذية يغطي قراءة هذا التقرير واعتماد لقطته حين تُعدّ، ما لم تكن أنت من أعدّها.'
      : 'اعتماد لقطة التقرير لحامل تصريح اللوحة التنفيذية من غير مُعِدّها.',
    period: { ...chosen, key: `${chosen.from}..${chosen.to}` },
    available_periods: available,
    sections: SECTIONS.map(s => ({ ...s, note: noted.get(s.key)?.body ?? '', note_version: noted.get(s.key)?.version ?? 0,
      note_written_by: noted.get(s.key)?.written_by_name ?? '', note_updated_at: noted.get(s.key)?.updated_at ?? '',
      actions: prepare ? ['write_note'] : [] })),
    notes,
    gaps,
    gap_status_names: GAP_STATUS,
    gap_summary: { declared_in_catalogue: MEASUREMENT_GAPS.length, declared: tally('declared'), owned: tally('owned'), closed: tally('closed'), refused: tally('refused') },
    decision_requests: decisionRequests(db, u, ['open'], prepare),
    decided_requests: decisionRequests(db, u, ['decided', 'withdrawn'], prepare),
    snapshots,
    snapshot_ids: snapshots.map(s => s.id),
    // لا ادعاء بما لم يُبنَ: الشاشة تقول حدّها بنفسها بدل أن يكتشفه من يفتحها.
    not_built: 'أقسام الخدمات ومستحقات العملاء والربحية والموارد والقوى العاملة تخرج اليوم فجواتٍ معلنة لا أرقامًا؛ وقسما المحفظة وخط الفرص ينتظران دمج فرع النطاق التنفيذي. الاعتماد نفسه يتم في مركز التقارير بفصل تفويضاته، لا من هذه الشاشة.',
    gap_rule: 'كتالوج الفجوات ثابت في الشيفرة ولا يُحرَّر من الشاشة: الفجوة تُغلق بدليل يسمّي ما صار يُقاس، أو يُرفض قياسها بسبب مكتوب. لا تختفي فجوة بحذف صفّها.'
  };
}
