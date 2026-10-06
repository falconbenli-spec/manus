// أيقونات المنصة (icons.mjs): حراسة قرار المالك (1 أكتوبر 2026) — لغة SF البصرية رسمًا أصليًا،
// وألوان النظام من رموز CSS لا من حرفيات داخل الترميز، والأيقونة زينة لا تُقرأ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { icon,chevron,ICON_NAMES,FAMILY_ICONS,familyIcon,QUICK_ICONS,quickIcon,STATUS_ICONS,statusIcon,CATEGORY_ICONS,categoryIcon } from '../app/static/icons.mjs';

const read=rel=>readFileSync(new URL(rel,import.meta.url),'utf8');

const FAMILIES=['HR','ADM','IT','EXP','FIN','LEG','PRO','ACC','GOV','DAT','PRC','DIG','PMO','CRT','STR','PR','INF','CRM','BRAND','TAL'];
const QUICKS=['leave','letter','payslip','correction','service','policy','expense','custody','overtime','mission','training','case'];
const TONES=['is-decide','is-return','is-do','is-run','is-done','is-reject'];
const CATEGORIES=['my_time','my_documents','my_pay','my_workplace','my_growth','my_projects','purchasing','governance'];

test('كل مفتاح له رسم: العشرون عائلة، والاثنا عشر إجراءً سريعًا، والنبرات الست، والفئات الثماني',()=>{
  for(const f of FAMILIES)assert.ok(FAMILY_ICONS[f]&&ICON_NAMES.includes(FAMILY_ICONS[f]),`عائلة ${f} بلا رسم مسمّى`);
  for(const q of QUICKS)assert.ok(QUICK_ICONS[q]&&ICON_NAMES.includes(QUICK_ICONS[q]),`إجراء ${q} بلا رسم مسمّى`);
  for(const t of TONES)assert.ok(STATUS_ICONS[t]&&ICON_NAMES.includes(STATUS_ICONS[t][0]),`نبرة ${t} بلا رسم مسمّى`);
  for(const c of CATEGORIES)assert.ok(CATEGORY_ICONS[c]&&ICON_NAMES.includes(CATEGORY_ICONS[c]),`فئة ${c} بلا رسم مسمّى`);
});

test('لا عائلتان برسم واحد: عشرون علامة متمايزة، وإلا بطل غرض العلامة',()=>{
  const names=FAMILIES.map(f=>FAMILY_ICONS[f]);
  assert.equal(new Set(names).size,names.length,'رسمٌ تكرّر بين عائلتين: '+names.filter((n,i)=>names.indexOf(n)!==i).join('، '));
});

test('كل SVG سليم البنية: شبكة 24، زينة، currentColor وحده، لا سمة style ولا لون حرفي',()=>{
  for(const name of ICON_NAMES){
    const svg=icon(name);
    assert.match(svg,/^<svg class="glyph/,name);
    assert.ok(svg.includes('viewBox="0 0 24 24"'),`${name}: شبكة 24 موحّدة`);
    assert.ok(svg.includes('aria-hidden="true"')&&svg.includes('focusable="false"'),`${name}: الأيقونة زينة`);
    assert.ok(svg.includes('stroke="currentColor"')&&svg.includes('stroke-linecap="round"')&&svg.includes('stroke-linejoin="round"'),`${name}: خط SF مدوّر بلون السياق`);
    assert.ok(!svg.includes('style='),`${name}: لا سمة style (سياسة CSP)`);
    for(const m of svg.matchAll(/(?:fill|stroke)="([^"]+)"/g))
      assert.ok(['currentColor','none'].includes(m[1]),`${name}: لون حرفي ${m[1]} داخل الترميز`);
    // أقواس الوسوم متوازنة: عدد الفتحات يساوي عدد الإغلاقات والمحتوى مسارات وأشكال فقط.
    const inner=svg.replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'');
    assert.ok(/^(?:<(?:path|circle|rect|ellipse)\b[^<>]*\/>)+$/.test(inner.replace(/\s+/g,' ').trim().replace(/> </g,'><')),`${name}: محتوى غير متوقع — ${inner.slice(0,60)}`);
  }
});

test('المساعدات ترجع رسومًا: العائلة من بادئة الرمز، والمجهول نقطة محايدة لا علامة مخترعة',()=>{
  assert.ok(familyIcon('HR-2026-001').includes('class="glyph is-tinted"'));
  assert.ok(familyIcon('xx-unknown').includes('<circle'),'المجهول نقطة');
  assert.ok(quickIcon('leave').includes('is-tinted'));
  assert.ok(statusIcon('is-done').includes('is-positive'),'المنجَز أخضر النظام');
  assert.ok(statusIcon('is-reject').includes('is-negative'),'المرفوض أحمر النظام');
  assert.ok(statusIcon('is-decide').includes('is-warning'),'ما ينتظر قرارًا برتقالي النظام');
  assert.ok(categoryIcon('my_time').includes('is-tinted'));
  assert.ok(chevron.includes('is-directional'));
});

test('مواضع الاستدعاء: لا حرف أيقونة من الخط بقي يُرسم، والقرص زينة كما كان',()=>{
  const homeUi=read('../app/static/home-ui.mjs');
  assert.ok(!/familyGlyph|quickGlyph|discGlyph/.test(homeUi),'خرائط الأحرف القديمة أزيلت');
  assert.ok(homeUi.includes(`class="hm-disc" aria-hidden="true"`),'القرص يبقى زينة');
  for(const [file,chars] of [['home-ui.mjs','◴▣⌘◍⌹◫◉⚑⌗⌸◎◰✎⟡⌖✧◈✦◷＋≡'],['catalog-home-ui.mjs','◴▤◫⌘↗▧▣§'],['request-picker.mjs','♙⌘⌂◫▣§◉✺◎▶✧◈↗☰▧▥⌬▤'],['service-page.mjs','◴✎▤⇢⚖§◈']]){
    const s=read('../app/static/'+file);
    for(const ch of chars)assert.ok(!s.includes(ch),`${file}: بقي الحرف ${ch}`);
  }
});

test('رموز الألوان معرّفة بوضعيها: أزرق النظام وأخضره وأحمره وبرتقاليه فاتحًا وداكنًا، والأصناف تقرؤها',()=>{
  const css=read('../app/static/signature.css');
  assert.ok(css.includes('--icon-tint:#0A84FF')&&css.includes('--icon-tint:#007AFF'),'أزرق النظام بوضعيه');
  assert.ok(css.includes('--icon-positive:#30D158')&&css.includes('--icon-positive:#34C759'),'أخضر النظام بوضعيه');
  assert.ok(css.includes('--icon-negative:#FF453A')&&css.includes('--icon-negative:#FF3B30'),'أحمر النظام بوضعيه');
  assert.ok(css.includes('--icon-warning:#FF9F0A')&&css.includes('--icon-warning:#FF9500'),'برتقالي النظام بوضعيه');
  assert.equal((css.match(/--icon-tint:#007AFF/g)||[]).length,2,'قيم الفاتح في كتلتي الورق (auto وlight) معًا');
  for(const cls of ['is-tinted','is-neutral','is-positive','is-negative','is-warning'])
    assert.ok(css.includes(`.glyph.${cls}{color:var(--icon-`),`صنف ${cls} يقرأ رمزه`);
});
