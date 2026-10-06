import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readScorecard, readScorecardMd, mdScoreRows, arithmeticMean, governingScore, ALLOWED, CRITICAL_KEYS } from '../scripts/scorecard-lib.mjs';

// عقد التنفيذ (30 سبتمبر 2026)، الحزمة 1 البند 7: «اجعل بطاقتَي JSON وMarkdown تتفقان على الدرجات السبع عشرة
// والموانع والتواريخ ومعرّفات الالتزام». وُجدتا في 29 سبتمبر مختلفتين في عشرة محاور، وJSON نفسه يحمل التزامين
// (c99b04e كاملًا و63ff911 مختصرًا). هذا الاختبار يجعل ذلك مستحيلًا بلا سقوط.

const root = fileURLToPath(new URL('../', import.meta.url));
const json = readScorecard(root), md = readScorecardMd(root);

test('الالتزام واحد: الكامل يبدأ بالمختصر، وترويسة Markdown تحمل الاثنين نفسيهما، وتاريخ القياس واحد', () => {
  assert.match(json.measured_commit, /^[0-9a-f]{40}$/);
  assert.ok(json.measured_commit.startsWith(json.measured_commit_short), `${json.measured_commit} لا يبدأ بـ${json.measured_commit_short}`);
  assert.ok(md.includes(`\`${json.measured_commit}\` (\`${json.measured_commit_short}\`)`), 'ترويسة Markdown تحمل الالتزام نفسه');
  const [y, m, d] = json.measured_on.split('-').map(Number);
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  assert.ok(md.includes(`**تاريخ القياس:** ${d} ${months[m - 1]} ${y}`), 'تاريخ القياس نفسه في الملفين');
});

test('الدرجات السبع عشرة والموانع متطابقة بين الملفين، والدرجة من السلّم الصحيح',() => {
  assert.equal(json.axes.length, 17);
  const rows = mdScoreRows(md);
  assert.equal(rows.length, 17, 'جدول §2 سبعة عشر صفًّا');
  for (const axis of json.axes) {
    const row = rows.find(r => r.n === axis.n);
    assert.ok(row, `المحور ${axis.n} في جدول Markdown`);
    assert.equal(row.score, axis.score, `${axis.key}: Markdown ${row.score} · JSON ${axis.score}`);
    assert.equal(row.blocker, axis.blocker, `${axis.key}: المانع مختلف بين الملفين`);
    assert.ok(ALLOWED.includes(axis.score), `${axis.key}: ${axis.score} ليست في السلّم الصحيح 0–10`);
    assert.equal(row.name.includes('🔴'), CRITICAL_KEYS.includes(axis.key), `${axis.key}: علامة المحور الحرج`);
  }
});

test('المتوسط والرقم الحاكم محسوبان بالقاعدة المكتوبة لا منقولان، ويتفق عليهما الملفان',() => {
  assert.equal(json.overall.arithmetic_mean, arithmeticMean(json.axes));
  assert.equal(json.overall.governing_score, governingScore(json.axes));
  assert.ok(md.includes(`**المتوسط الحسابي:** ${json.overall.arithmetic_mean} من 10`));
  assert.ok(md.includes(`**الرقم الحاكم: ${json.overall.governing_score} من 10.**`));
  // ولا 10/10 ما دام محورٌ حرج صفرًا: القاعدة المانعة في الحساب نفسه.
  if (json.axes.some(a => CRITICAL_KEYS.includes(a.key) && a.score === 0)) assert.ok(json.overall.governing_score <= 2);
});

test('خط أساس البوابة والبطاقة يقولان الترحيل والبصمة والأرضية نفسها',() => {
  const gate = JSON.parse(readFileSync(new URL('../scripts/gate-baseline.json', import.meta.url), 'utf8'));
  assert.equal(json.baseline.highest_migration_file, gate.migration);
  assert.equal(json.baseline.schema_digest, gate.schema_digest);
  assert.equal(json.baseline.suite.floor, gate.tests_floor);
  assert.equal(json.baseline.suite.skip_ceiling, gate.skipped_ceiling);
  assert.ok(json.baseline.suite.passed >= gate.tests_floor, 'الناجح المقيس لا يقل عن الأرضية');
});
