import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

export const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
export const canonicalPath = 'docs/implementation/REQUIREMENTS.json';
export const mirrorPath = 'docs/traceability.json';
export const statuses = ['لم يبدأ', 'قيد التنفيذ', 'منفذ غير متحقق', 'متحقق تقنيًا', 'متعطل بقرار أو وصول', 'مقبول من مالك الإجراء'];
export const digest = text => createHash('sha256').update(text).digest('hex');
export const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
function localFile(path) {
  assert.equal(typeof path, 'string', 'Evidence path must be a string.');
  assert.ok(!isAbsolute(path), 'Use a repository-relative evidence path.');
  const rel = relative(root, resolve(root, path));
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Evidence must stay inside the repository.');
  assert.ok(!/(^|\/)\.env(?:\.|$)/.test(path), 'Do not reference secret files.');
  assert.ok(existsSync(resolve(root, path)), `Missing evidence: ${path}`);
  return resolve(root, path);
}
export function namedTests(file) {
  return [...readFileSync(localFile(file), 'utf8').matchAll(/\btest\(\s*(['"`])([^\n]*?)\1/g)].map(match => match[2]);
}
export function summarize(requirements) {
  return {
    total: requirements.length,
    unique_ids: new Set(requirements.map(r => r.id)).size,
    domains: new Set(requirements.map(r => r.domain)).size,
    status_counts: Object.fromEntries(statuses.map(status => [status, requirements.filter(r => r.implementation.status === status).length])),
    partial: requirements.filter(r => r.implementation.coverage === 'جزئي').length,
    technically_verified_complete: requirements.filter(r => r.implementation.status === 'متحقق تقنيًا' && r.implementation.coverage === 'كامل').length,
    accepted_by_owner: requirements.filter(r => r.implementation.owner_acceptance !== null).length,
  };
}
export function validateTraceability(document = readJson(canonicalPath), { checkMirror = true } = {}) {
  const catalog = readJson('sources/requirements.catalog.json');
  const workbook = readJson('sources/workbook.extracted.json');
  assert.equal(Object.keys(workbook).length, 11, 'Workbook must retain all eleven sheets.');
  assert.equal(catalog.length, 220);
  assert.equal(new Set(catalog.map(r => r.id)).size, 220);
  assert.equal(new Set(catalog.map(r => r.domain)).size, 22);
  assert.equal(document.requirements.length, 220);
  assert.equal(new Set(document.requirements.map(r => r.id)).size, 220);
  const actualById = new Map(document.requirements.map(r => [r.id, r]));
  const sourceColumns = ['id','domain','title','description','owner','priority','phase','source_status','acceptance','dependencies','sensitivity','existing_evidence','reference','reference_url'];
  for (const original of catalog) {
    const record = actualById.get(original.id);
    assert.ok(record, `Missing requirement: ${original.id}`);
    for (const [key, value] of Object.entries(original)) assert.deepEqual(record[key], value, `${original.id}: source field changed: ${key}`);
    const row = workbook[original.source_sheet][original.source_row - 1];
    for (const [index, field] of sourceColumns.entries()) assert.deepEqual(original[field], row[index], `${original.id}: catalog differs from workbook: ${field}`);
    const state = record.implementation;
    assert.ok(statuses.includes(state.status), `${record.id}: invalid implementation status`);
    assert.ok(['لم ينفذ', 'جزئي', 'كامل'].includes(state.coverage));
    assert.ok(Array.isArray(state.code_files) && Array.isArray(state.tests) && Array.isArray(state.evidence) && Array.isArray(state.blockers));
    assert.ok(Array.isArray(state.dependencies) && typeof state.summary === 'string' && state.summary.length > 0);
    assert.ok(state.last_result && typeof state.last_result.status === 'string');
    assert.ok(state.owner_acceptance === null || (state.owner_acceptance.owner && state.owner_acceptance.date && state.owner_acceptance.evidence));
    if (state.coverage !== 'كامل') {
      assert.notEqual(state.status, 'متحقق تقنيًا', `${record.id}: a partial requirement cannot be fully verified`);
      assert.notEqual(state.status, 'مقبول من مالك الإجراء', `${record.id}: partial coverage cannot be accepted`);
      assert.ok(state.blockers.length, `${record.id}: incomplete requirements need named gaps`);
    }
    if (state.status === 'مقبول من مالك الإجراء') assert.ok(state.owner_acceptance, `${record.id}: owner approval is missing`);
    for (const file of state.code_files) localFile(file);
    for (const item of state.evidence) localFile(item.file);
    for (const test of state.tests) {
      assert.ok(test.name && test.coverage, `${record.id}: test needs a readable name and scope`);
      assert.ok(namedTests(test.file).includes(test.name), `${record.id}: named test is absent: ${test.name}`);
      assert.ok(['لم ينفذ ضمن السجل', 'نجح', 'فشل', 'متقادم'].includes(test.result.status));
      if (test.result.status === 'نجح' || test.result.status === 'فشل') {
        const evidence = readFileSync(localFile(test.result.evidence), 'utf8');
        assert.equal(digest(evidence), test.result.evidence_sha256, `${record.id}: saved test output changed`);
        assert.equal(digest(readFileSync(localFile(test.file))), test.result.test_source_sha256, `${record.id}: test changed after recorded run`);
        assert.ok(evidence.includes(test.name), `${record.id}: test name is absent from saved output`);
      }
    }
    if (state.status === 'متحقق تقنيًا') {
      assert.ok(state.code_files.length && state.tests.length && state.evidence.length);
      assert.ok(state.tests.every(test => test.result.status === 'نجح'));
    }
  }
  assert.deepEqual(document.summary, summarize(document.requirements), 'Summary does not match requirement records.');
  if (checkMirror) assert.deepEqual(readJson(mirrorPath), document, 'Traceability mirror differs. Run npm run trace -- --sync after reviewing the canonical file.');
  return document.summary;
}
function writeDocument(document) {
  document.summary = summarize(document.requirements);
  const content = JSON.stringify(document, null, 2) + '\n';
  writeFileSync(resolve(root, canonicalPath), content);
  writeFileSync(resolve(root, mirrorPath), content);
}
function recordResults(document, path) {
  assert.ok(path.startsWith('docs/testing/') || path.startsWith('docs/evidence/'), 'Test output must be saved under docs/testing or docs/evidence.');
  const text = readFileSync(localFile(path), 'utf8');
  const hash = digest(text), date = new Date().toISOString();
  let linked = 0;
  for (const record of document.requirements) {
    const updated = [];
    for (const test of record.implementation.tests) {
      const lines = text.split('\n').filter(line => line.includes(test.name));
      const failed = lines.some(line => /^\s*(?:not ok \d+\s*-?\s*|✖\s+)/.test(line));
      const passed = lines.some(line => /^\s*(?:ok \d+\s*-?\s*|✔\s+)/.test(line));
      if (!passed && !failed) continue;
      test.result = { status: failed ? 'فشل' : 'نجح', recorded_at: date, evidence: path, evidence_sha256: hash, test_source_sha256: digest(readFileSync(localFile(test.file))) };
      updated.push(test); linked++;
    }
    if (updated.length) {
      record.implementation.last_result = { status: updated.some(test => test.result.status === 'فشل') ? 'فشل اختبار جزئي' : 'نجحت الاختبارات المرتبطة للجزء المحلي', recorded_at: date, evidence: path, acceptance_complete: false };
      if (!record.implementation.evidence.some(item => item.file === path)) record.implementation.evidence.push({ file: path, scope: 'نتيجة الاختبارات المسماة؛ لا تثبت اكتمال معيار القبول كله.' });
    }
  }
  assert.ok(linked, 'No named tests matched this output. Nothing was recorded.');
  return linked;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const document = readJson(canonicalPath);
  const args = process.argv.slice(2);
  if (args[0] === '--record-results') {
    assert.equal(args.length, 2, 'Provide the saved test output path.');
    const linked = recordResults(document, args[1]);
    validateTraceability({ ...document, summary: summarize(document.requirements) }, { checkMirror: false });
    writeDocument(document);
    console.log(`Recorded ${linked} named test references. Requirement completion states were not changed.`);
  } else if (args[0] === '--sync') {
    assert.equal(args.length, 1);
    document.summary = summarize(document.requirements);
    validateTraceability(document, { checkMirror: false });
    writeDocument(document);
  } else {
    assert.equal(args.length, 0, 'Use --sync or --record-results <path>.');
  }
  console.log(JSON.stringify(validateTraceability(), null, 2));
}
