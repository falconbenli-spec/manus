// مكتبة لوحة الدرجات: قراءة جدول Markdown، وحساب المتوسط والرقم الحاكم من JSON بالقاعدة المكتوبة فيه.
// تُستورد في tests/scorecard-agreement.test.mjs وفي scripts/scorecard.mjs، فلا تعريفان للقاعدة.
import { readFileSync } from 'node:fs';

export const SCORECARD_JSON = 'docs/readiness/erp-10of10-scorecard.json';
export const SCORECARD_MD = 'docs/readiness/ERP-10OF10-SCORECARD.md';
// السلّم المنصوص عليه في grading_rules: أعداد صحيحة من 0 إلى 10. والفردية (3 و5 و7) معناها
// «استوفى الأدنى وناقصه شرطٌ واحد مسمّى». لا كسر: «6.5» ليست درجة في هذا السلّم.
export const ALLOWED = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
// المحاور الحرجة بالقاعدة المانعة: الأمن والمال والاستعادة والهوية وقبول الأعمال.
export const CRITICAL_KEYS = Object.freeze(['security_privacy', 'finance_accounting', 'operations_availability_recovery', 'identity_access_sod', 'owner_acceptance']);

export const readScorecard = (root = '.') => JSON.parse(readFileSync(`${root}/${SCORECARD_JSON}`, 'utf8'));
export const readScorecardMd = (root = '.') => readFileSync(`${root}/${SCORECARD_MD}`, 'utf8');

// صفوف جدول القسم 2: | # | المحور | **الدرجة** | المانع |
export function mdScoreRows(md) {
  return [...md.matchAll(/^\| (\d+) \| ([^|]+)\| \*\*([\d.]+)\*\* \| ([^\n]*?) \|$/gm)]
    .map(m => ({ n: Number(m[1]), name: m[2].trim(), score: Number(m[3]), blocker: m[4].trim() }));
}

export function arithmeticMean(axes) {
  return Math.round(axes.reduce((sum, a) => sum + a.score, 0) / axes.length * 10) / 10;
}

// «الدرجة الإجمالية لا تتجاوز أدنى درجة في المحاور الحرجة بأكثر من نقطتين» — والمتوسط نفسه سقفٌ لا يُتجاوز.
export function governingScore(axes) {
  const lowestCritical = Math.min(...axes.filter(a => CRITICAL_KEYS.includes(a.key)).map(a => a.score));
  return Math.min(arithmeticMean(axes), lowestCritical + 2);
}
