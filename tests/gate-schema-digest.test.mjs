import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrateFresh } from '../scripts/gate.mjs';

// العيب الذي أوجب هذا الملف — 30 سبتمبر 2026.
//
// الفحص 6 في البوابة يقارن بصمة مخطط قاعدة جديدة مبنية من الترحيلات بقيمة مسجَّلة في
// scripts/gate-baseline.json. وقد سُجّلت في الالتزام e12f101 قيمةٌ (7a654d74…) لا تطابق أي قاعدة
// موجودة: لا القاعدة الجديدة ولا قاعدة التشغيل الحيّة — وكلتاهما تعطيان f69ba1f7… حرفًا بحرف،
// و2992 كائنًا هي نفسها الأعداد المكتوبة في ملاحظة ذلك الالتزام. فالمخطط لم ينحرف، والقيمة
// المسجَّلة هي التي كانت خطأً؛ وبقيت البوابة ساقطةً من ذلك اليوم لأن أحدًا لم يشغّلها بعده.
//
// الثابت المحروس: **خط الأساس يصف المخطط الذي تنتجه الترحيلات فعلًا.** بصمةٌ مسجَّلة لا تطابق
// بناءً جديدًا هي خط أساسٍ لقاعدةٍ أخرى، وقبولها يعني بوابةً تحرس رقمًا لا مخططًا.
//
// ولماذا يُبنى هنا بدل قراءة البوابة: البصمة لا تُعرف إلا ببناء القاعدة، والبناء ثانية ونصف.

const baseline = JSON.parse(readFileSync(new URL('../scripts/gate-baseline.json', import.meta.url), 'utf8'));

test('خط الأساس يطابق المخطط الذي تنتجه الترحيلات، فلا يحرس رقمًا لقاعدة أخرى', async () => {
  const { fingerprint, version } = await migrateFresh();
  assert.equal(fingerprint.digest, baseline.schema_digest,
    'بصمة خط الأساس لا تطابق قاعدةً جديدة مبنية من الترحيلات.\n'
    + `  المقيس:     ${fingerprint.digest}\n`
    + `  خط الأساس:  ${baseline.schema_digest}\n`
    + `  الكائنات:   ${fingerprint.objects} (${Object.entries(fingerprint.counts).map(([k, v]) => `${k} ${v}`).join(' · ')})\n`
    + 'إن كان الفرق مقصودًا فهو ترحيلٌ جديد: اشرحه وحدّث البصمة والترحيل معًا. '
    + 'وإن لم يكن، فخط الأساس يخصّ قاعدةً أخرى ولا يُنسخ فوق فرقٍ غير مفسَّر.');
  assert.equal(version, baseline.migration,
    'رقم الترحيل المسجَّل لا يطابق ما تبلغه قاعدة جديدة.');
});

test('والبصمة حتمية: بناءان متتاليان يعطيان القيمة نفسها', async () => {
  const [a, b] = [await migrateFresh(), await migrateFresh()];
  assert.equal(a.fingerprint.digest, b.fingerprint.digest,
    'بناءان من الترحيلات نفسها أعطيا بصمتين مختلفتين، فالبصمة تحمل شيئًا متقلّبًا '
    + '(اسمًا مولَّدًا أو ترتيبًا غير مثبَّت) ولا تصلح خط أساس.');
});
