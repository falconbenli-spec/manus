// سجل المتطلبات للمجالات المتخصصة يقول ما يثبته الكود والاختبارات بالضبط، لا أكثر ولا أقل.
// العيب الذي أوجب هذا الملف: في docs/traceability.json كانت PR-01..10 وINF-01..08 وINF-10 وPRO-01..05 وPRO-07 وCRM-08 وCRM-10
// كلها «لم يبدأ» بلا ملف كود، والوحدات قائمة باختباراتها: app/pr.mjs وapp/influencers.mjs وapp/production.mjs
// وapp/equipment.mjs وapp/review-rounds.mjs وapp/pipeline-estimates.mjs (DECISIONS-NEEDED ز4 لاحظ CRM-08 وCRM-10).
// القاعدة هنا ثوابت لا لقطة: سجلٌّ لمتطلب وحدته قائمة لا يقول «لم يبدأ»، ويسمّي الوحدة واختبارًا مسمّى موجودًا فعلًا،
// ولا يحمل نجاحًا لم يُسجَّل من تشغيل محفوظ؛ والمتطلب الذي لا وحدة له يبقى «لم يبدأ» بفجوته مسمّاة لا بالعبارة العامة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, readJson, namedTests, digest } from '../scripts/trace.mjs';

const register = () => new Map(readJson('docs/traceability.json').requirements.map(r => [r.id, r]));
// المتطلب ← الوحدة التي تنفّذ جزءًا منه اليوم (قُرئت دالةً دالة على هذا الفرع، والاختبار المسمّى يمرّ عليها).
const BUILT = {
  'PR-01': 'app/pr.mjs', 'PR-02': 'app/pr.mjs', 'PR-07': 'app/pr.mjs', 'PR-09': 'app/pr.mjs', 'PR-10': 'app/pr.mjs',
  'INF-01': 'app/influencers.mjs', 'INF-02': 'app/influencers.mjs', 'INF-04': 'app/influencers.mjs', 'INF-05': 'app/influencers.mjs',
  'INF-06': 'app/influencers.mjs', 'INF-07': 'app/influencers.mjs', 'INF-08': 'app/influencers.mjs', 'INF-10': 'app/influencers.mjs',
  'PRO-01': 'app/production.mjs', 'PRO-02': 'app/production.mjs', 'PRO-03': 'app/production.mjs', 'PRO-04': 'app/equipment.mjs',
  'PRO-05': 'app/production.mjs', 'PRO-07': 'app/review-rounds.mjs',
  'CRM-08': 'app/pipeline-estimates.mjs', 'CRM-10': 'app/pipeline-estimates.mjs'
};
// لا وحدة تنفّذ شيئًا من وصفها ولا من معيار قبولها؛ ما في دليل الخدمات لها استقبال طلب لا سجل.
const NOT_BUILT = ['PR-03', 'PR-04', 'PR-05', 'PR-06', 'PR-08', 'INF-03'];
const BOILERPLATE = 'حزمة المجال لم تنفذ';
const RESULTS = ['لم ينفذ ضمن السجل', 'نجح', 'فشل', 'متقادم'];

test('a specialist requirement whose module exists is not recorded as not started: it names the module, real files and a named test that exists', () => {
  const records = register();
  for (const [id, module] of Object.entries(BUILT)) {
    const s = records.get(id)?.implementation;
    assert.ok(s, `${id}: missing from the register`);
    assert.notEqual(s.status, 'لم يبدأ', `${id}: the register says «لم يبدأ» with ${s.code_files.length} code files, but ${module} implements part of it`);
    assert.notEqual(s.coverage, 'لم ينفذ', `${id}: coverage «لم ينفذ» although ${module} implements part of it`);
    assert.ok(s.code_files.includes(module), `${id}: ${module} is not among its code files`);
    for (const file of s.code_files) assert.ok(existsSync(resolve(root, file)), `${id}: code file does not exist: ${file}`);
    assert.ok(s.tests.length > 0, `${id}: no named test`);
    for (const t of s.tests) {
      assert.ok(namedTests(t.file).includes(t.name), `${id}: named test is absent from ${t.file}: ${t.name}`);
      assert.ok(typeof t.coverage === 'string' && t.coverage.length >= 20, `${id}: the test does not say what it proves`);
    }
    if (s.coverage !== 'كامل') assert.ok(s.blockers.length && s.blockers.every(b => !b.includes(BOILERPLATE)), `${id}: partial coverage needs its own named gaps`);
  }
});

test('a linked test carries no pass that was not recorded from a saved run', () => {
  const records = register();
  for (const id of [...Object.keys(BUILT), ...NOT_BUILT]) {
    for (const t of records.get(id).implementation.tests) {
      assert.ok(RESULTS.includes(t.result.status), `${id}: unknown result «${t.result.status}»`);
      if (t.result.status !== 'نجح' && t.result.status !== 'فشل') continue;
      const evidence = resolve(root, t.result.evidence ?? '');
      assert.ok(t.result.evidence && existsSync(evidence), `${id}: «${t.result.status}» without its saved output`);
      const text = readFileSync(evidence, 'utf8');
      assert.equal(digest(text), t.result.evidence_sha256, `${id}: the saved output changed after it was recorded`);
      assert.ok(text.includes(t.name), `${id}: the saved output does not contain the test it is claimed for`);
    }
  }
});

test('a specialist requirement with no implementing module stays not started, with its own gap named instead of the boilerplate', () => {
  const records = register();
  for (const id of NOT_BUILT) {
    const s = records.get(id).implementation;
    if (s.status !== 'لم يبدأ') continue;
    assert.deepEqual(s.code_files, [], `${id}: «لم يبدأ» while naming code`);
    assert.ok(s.blockers.length && s.blockers.every(b => !b.includes(BOILERPLATE)), `${id}: the gap is the generic sentence, not what is missing`);
  }
});
