// حزم قبول المجالات المتخصصة (docs/readiness/acceptance/): نصٌّ يشغّله مالك الإجراء بيده على نسخة اختبار ويوقّع في آخره.
// ما يحرسه هذا الملف: أن كل حزمة موجودة؛ وأن كل خطوة تسمّي شاشة حقيقية (مفتاح في القائمة app/static/app.mjs أو وحدة في
// operationModules) باسمها كما يراه الموظف، وفعلًا حقيقيًا من أفعال تلك الشاشة باسم زرّه؛ وأن «مين» رموز أدوار معرّفة في
// الحزمة لا أسماء؛ وأن خانة «الناتج» وسجل القبول فارغان: لا يعبّيهما فريق التنفيذ، ولا يوقّع أحد عن مالك الإجراء.
// الحزم كُتبت على شكل docs/acceptance/finance-owner-acceptance-script.md وdocs/acceptance/procurement-owner-acceptance-script.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operationModules } from '../app/static/operations.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const read = path => readFileSync(resolve(root, path), 'utf8');
const PACKS = {
  'campaigns-content': 'الحملات والمحتوى',
  'media-spend': 'الصرف الإعلامي',
  'studio': 'الاستوديو',
  'review-rounds': 'جولات المراجعة',
  'production': 'الإنتاج',
  'equipment': 'المعدات',
  'influencers': 'المؤثرون',
  'events': 'الفعاليات',
  'pr': 'العلاقات العامة',
  'client-reports-approvals': 'تقارير العملاء وموافقاتهم',
  'epmo': 'الإدارة التنفيذية للمشاريع'
};
const packPath = key => `docs/readiness/acceptance/${key}-acceptance.md`;
const STEP_HEADER = ['#', 'مين', 'وين', 'وش يسوّي', 'لازم يطلع', 'الناتج'];
const ROLE = /[ء-ي]\d+/g;
const SCREEN = /«([^»]+)»\s*\(`([a-z][a-z0-9-]*)`\)/g;
const ACTION = /«([^»]+)»\s*\(`([a-z][a-z0-9_]*)`\)/g;

// مفاتيح القائمة وأسماؤها كما في سطور nav.push بـapp/static/app.mjs (وحدة متصفح لا تُستورد في Node).
function navLabels() {
  const source = read('app/static/app.mjs'), labels = new Map();
  for (const call of source.matchAll(/nav\.push\(((?:\[[^\]]*\],?)+)\)/g))
    for (const entry of call[1].matchAll(/\['([a-z][a-z0-9-]*)','[^']*','([^']*)'/g)) labels.set(entry[1], entry[2]);
  return labels;
}
// مصدر كل وحدة شاشة: الملف الذي يصدّر الكائن نفسه المسجّل في operationModules.
async function moduleSources() {
  const files = [...new Set([...read('app/static/operations.mjs').matchAll(/from '\.\/([\w-]+\.mjs)'/g)].map(m => m[1]))];
  const owner = new Map();
  for (const file of files) {
    const exported = await import(`../app/static/${file}`);
    for (const value of Object.values(exported)) if (value && typeof value === 'object') owner.set(value, file);
  }
  return new Map(Object.entries(operationModules).map(([key, ui]) => [key, read(`app/static/${owner.get(ui)}`)]));
}
// أفعال الشاشة وأسماء أزرارها: ما يقارنه form() بـaction، والمصفوفات التي يفحص بها، والخرائط التي يفهرسها بالفعل،
// والأزرار الحرفية في render(). أسماء الأزرار من خرائط *Labels/labels ومن button('فعل',…,'اسم').
function screenActions(ui, source) {
  const form = ui.form?.toString() ?? '', render = ui.render?.toString() ?? '';
  const maps = new Map([...source.matchAll(/const\s+(\w+)\s*=\s*\{([^{}]*)\}/g)].map(m => [m[1], m[2]]));
  const actions = new Set(), labels = new Map();
  const label = (action, text) => { if (!labels.has(action)) labels.set(action, new Set()); labels.get(action).add(text); };
  for (const src of [form, render]) {
    for (const m of src.matchAll(/action\s*===\s*['"]([a-z][a-z0-9_]*)['"]/g)) actions.add(m[1]);
    for (const m of src.matchAll(/\[([^\[\]]*)\]\.includes\(\s*(?:action|a)\s*\)/g)) for (const x of m[1].matchAll(/['"]([a-z][a-z0-9_]*)['"]/g)) actions.add(x[1]);
    for (const m of src.matchAll(/\.includes\(\s*['"]([a-z][a-z0-9_]*)['"]\s*\)/g)) actions.add(m[1]);
    for (const m of src.matchAll(/button\(\s*'([a-z][a-z0-9_]*)'\s*,\s*(?:'[^']*'|`[^`]*`|[\w.]+)\s*,\s*'([^']*)'/g)) { actions.add(m[1]); label(m[1], m[2]); }
    for (const m of src.matchAll(/button\(\s*['"]([a-z][a-z0-9_]*)['"]/g)) actions.add(m[1]);
    for (const m of src.matchAll(/(\w+)\[\s*(?:action|a)\s*\]/g)) {
      const body = maps.get(m[1]);
      if (!body) continue;
      for (const entry of body.matchAll(/(?:^|[,{\s])([a-z][a-z0-9_]*)\s*:\s*'([^']*)'/g)) {
        actions.add(entry[1]);
        if (/labels$/i.test(m[1])) label(entry[1], entry[2]);
      }
    }
  }
  // زر يُرسم في دالة مساعدة خارج render() (مثل بطاقة المسار) يسمّي فعلًا من أفعال الشاشة نفسها: اسمه يُقرأ من الملف كله.
  for (const m of source.matchAll(/button\(\s*'([a-z][a-z0-9_]*)'\s*,\s*(?:'[^']*'|`[^`]*`|[\w.]+)\s*,\s*'([^']*)'/g)) if (actions.has(m[1])) label(m[1], m[2]);
  return { actions, labels };
}
// جداول Markdown بعناوينها: كل جدول صف رأس ثم صف فاصل ثم صفوفه حتى أول سطر لا يبدأ بـ|.
function tables(markdown) {
  const lines = markdown.split('\n'), out = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) heading = lines[i].replace(/^#+\s*/, '');
    if (!lines[i].startsWith('|') || !/^\|\s*-{3}/.test(lines[i + 1] ?? '')) continue;
    const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const table = { heading, header: cells(lines[i]), rows: [] };
    for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) table.rows.push(cells(lines[i]));
    i--;
    out.push(table);
  }
  return out;
}
const section = (markdown, title) => {
  const at = markdown.indexOf(`\n## ${title}`);
  if (at < 0) return null;
  const next = markdown.indexOf('\n## ', at + 4);
  return markdown.slice(at, next < 0 ? undefined : next);
};

test('every specialist domain has its acceptance pack, and every step names a real screen by its name and a real action of that screen by its button', async () => {
  const nav = navLabels(), sources = await moduleSources();
  const screenName = key => nav.get(key) ?? operationModules[key]?.title;
  const register = new Set(JSON.parse(read('docs/traceability.json')).requirements.map(r => r.id));
  for (const [key, domain] of Object.entries(PACKS)) {
    const path = packPath(key);
    assert.ok(existsSync(resolve(root, path)), `${domain}: the acceptance pack is missing — ${path}`);
    const markdown = read(path), all = tables(markdown);
    assert.match(markdown.split('\n')[0], /^# نص قبول/, `${path}: the first line names the script`);
    const card = all.find(t => t.heading === 'بطاقة النص');
    assert.ok(card, `${path}: no «بطاقة النص» table`);
    const field = name => card.rows.find(r => r[0] === name)?.[1] ?? '';
    assert.match(field('يُشغَّل على'), /_{6,}/, `${path}: the release commit is written by the person who runs it, not in advance`);
    const ids = [...field('المتطلبات').matchAll(/`([A-Z]{2,4}-\d{2})`/g)].map(m => m[1]);
    assert.ok(ids.length, `${path}: the card names the requirements the script exercises`);
    for (const id of ids) assert.ok(register.has(id), `${path}: ${id} is not a requirement in the register`);
    const automated = [...field('الدليل الآلي المقابل').matchAll(/`(tests\/[\w./-]+\.test\.mjs)`/g)].map(m => m[1]);
    assert.ok(automated.length, `${path}: the card names its automated counterpart`);
    for (const file of automated) assert.ok(existsSync(resolve(root, file)), `${path}: ${file} does not exist`);
    const roleTable = all.find(t => t.heading.startsWith('0.1'));
    assert.ok(roleTable && roleTable.header[0] === 'الرمز', `${path}: no role table (0.1) whose first column is «الرمز»`);
    const roles = new Set(roleTable.rows.map(r => r[0]));
    for (const code of roles) assert.match(code, /^[ء-ي]\d+$/, `${path}: a role is a code, not a name: «${code}»`);
    const steps = all.filter(t => STEP_HEADER.every((h, i) => t.header[i] === h) && t.header.length === STEP_HEADER.length);
    assert.ok(steps.length >= 2, `${path}: fewer than two step tables`);
    const numbers = new Set();
    for (const table of steps) for (const row of table.rows) {
      const [number, who, where, what, expect, result] = row;
      assert.equal(row.length, 6, `${path} ${number}: a step has six cells`);
      assert.ok(number && !numbers.has(number), `${path}: step number «${number}» missing or repeated`);
      numbers.add(number);
      const people = who.match(ROLE) ?? [];
      assert.ok(people.length || who === '—', `${path} ${number}: «مين» is a role code from 0.1, or «—» for a reading step`);
      for (const code of people) assert.ok(roles.has(code), `${path} ${number}: role ${code} is not defined in 0.1`);
      const screens = [...where.matchAll(SCREEN)];
      assert.ok(screens.length, `${path} ${number}: «وين» names a screen as «name» (\`key\`)`);
      for (const [, name, screen] of screens) {
        assert.ok(nav.has(screen) || operationModules[screen], `${path} ${number}: «${screen}» is neither a nav key nor an operation module`);
        assert.equal(name, screenName(screen), `${path} ${number}: the screen «${screen}» is called «${screenName(screen)}» on the platform, not «${name}»`);
      }
      for (const [, button, action] of what.matchAll(ACTION)) {
        const owners = screens.map(([, , screen]) => screen).filter(screen => operationModules[screen])
          .map(screen => screenActions(operationModules[screen], sources.get(screen)));
        const match = owners.find(o => o.actions.has(action));
        assert.ok(match, `${path} ${number}: «${action}» is not an action of ${screens.map(s => s[2]).join(' / ')}`);
        if (match.labels.has(action)) assert.ok(match.labels.get(action).has(button),
          `${path} ${number}: the button for «${action}» reads «${[...match.labels.get(action)].join('» or «')}», not «${button}»`);
      }
      assert.ok(expect.length >= 3, `${path} ${number}: «لازم يطلع» says what must appear`);
      assert.equal(result, '', `${path} ${number}: «الناتج» is left for the process owner`);
    }
  }
});

test('no pack carries a filled sign-off: the process owner signs electronically, and nobody signs or dates it for them', () => {
  for (const key of Object.keys(PACKS)) {
    const path = packPath(key), markdown = read(path), signoff = section(markdown, 'سجل القبول');
    assert.ok(signoff, `${path}: no «سجل القبول» section`);
    const rows = tables(signoff).flatMap(t => t.rows);
    for (const needed of ['المالك', 'التاريخ', 'النسخة', 'النتيجة', 'التوقيع']) assert.ok(rows.some(r => r[0].includes(needed)), `${path}: the sign-off has no «${needed}» row`);
    for (const row of rows) for (const cell of row.slice(1)) assert.equal(cell, '', `${path}: the sign-off row «${row[0]}» is already filled: «${cell}»`);
    assert.doesNotMatch(signoff, /\b20\d\d-\d\d-\d\d\b/, `${path}: a date is written into the sign-off`);
  }
});
