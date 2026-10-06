// TP2.5 — سقف تمدد الجوال: يقارن ناتج المسبار بخط أساس مُلتزَم، والعدد ينزل ولا يصعد.
//
//   افتح  http://127.0.0.1:3600/mobile-probe  بجلسة مفتوحة، شغّل القياس، واحفظ الناتج في ملف. ثم:
//     node scripts/mobile-probe.mjs <ناتج.json>              يقارن
//     node scripts/mobile-probe.mjs <ناتج.json> --record      يثبّت خط الأساس (يُكتب سببه في الالتزام)
//
// ولماذا خطوة يدوية: القياس يحتاج متصفحًا حقيقيًا يُخطّط الصفحة، وجلسةً مفتوحة — وبلا الجلسة
// تعرض الإطارات كلها شاشة الدخول فيخرج القياس صفرًا كاذبًا. فالبوابة لا تشغّله، وهذا يُقال لا يُخفى.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'mobile-probe-baseline.json');

export function compareProbe(result, baseline) {
  const lines = [], worse = [];
  if (!result || typeof result.overflowing !== 'number')
    return { ok: false, lines: ['الناتج لا يحمل `overflowing` — هل حُفظ من صفحة المسبار كاملًا؟'] };
  if (result.unmeasured) lines.push(`تنبيه: ${result.unmeasured} قياسًا لم يتم (إطار لم يُقرأ). النتيجة ناقصة بهذا القدر.`);
  if (!baseline) return { ok: true, recordable: true,
    lines: [...lines, `لا خط أساس بعد. القياس: ${result.overflowing} حالة تمدد. ثبّته بـ--record.`] };
  // لكل شاشة على حدة، لا بالإجمالي وحده: مجموعٌ ثابت قد يخفي شاشةً تحسّنت وأخرى ساءت.
  for (const [view, widths] of Object.entries(result.screens ?? {})) {
    const was = baseline.screens?.[view];
    if (!was) { if (widths.some(v => v > 0)) worse.push(`${view}: شاشة جديدة تتمدد (${widths.join('/')}) — الجديد يبدأ من صفر`); continue; }
    widths.forEach((value, index) => {
      const before = was[index];
      if (typeof value === 'number' && typeof before === 'number' && value > before)
        worse.push(`${view} عند ${result.widths?.[index] ?? '?'}: ${before} → ${value}`);
    });
  }
  lines.push(`التمدد: ${result.overflowing} (خط الأساس ${baseline.overflowing}).`);
  for (const line of worse) lines.push('  ✖ ' + line);
  const ok = worse.length === 0 && result.overflowing <= baseline.overflowing;
  if (ok && result.overflowing < baseline.overflowing)
    lines.push(`  نزل ${baseline.overflowing - result.overflowing}. ثبّته بـ--record.`);
  return { ok, lines };
}

export const loadBaseline = () => existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('الاستعمال: node scripts/mobile-probe.mjs <ناتج.json> [--record]'); process.exit(2); }
  const result = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const verdict = compareProbe(result, loadBaseline());
  console.log(verdict.lines.join('\n'));
  if (process.argv.includes('--record')) {
    writeFileSync(BASELINE_PATH, JSON.stringify({ ...result, recorded_at: new Date().toISOString().slice(0, 10) }, null, 1) + '\n');
    console.log('خط الأساس كُتب: ' + BASELINE_PATH);
    process.exit(0);
  }
  process.exit(verdict.ok ? 0 : 1);
}
