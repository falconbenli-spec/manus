import test from 'node:test';
import assert from 'node:assert/strict';
import { compareProbe } from '../scripts/mobile-probe.mjs';

// TP2.5 — السقف ينزل ولا يصعد، ويُقارَن لكل شاشة لا بالإجمالي وحده.
const probe=(screens,extra={})=>({at:'t',widths:[360,390,414],screens,
  overflowing:Object.values(screens).flat().filter(v=>v>0).length,
  unmeasured:Object.values(screens).flat().filter(v=>v===null).length,...extra});

test('بلا خط أساس: قياسٌ يُثبَّت، لا حكم',()=>{
  const v=compareProbe(probe({home:[0,0,0]}),null);
  assert.equal(v.ok,true);assert.equal(v.recordable,true);
  assert.match(v.lines.join('\n'),/لا خط أساس/);
});

test('الثبات يمرّ، والنزول يمرّ ويُطلب تثبيته',()=>{
  const base=probe({home:[0,0,0],payroll:[12,8,0]});
  assert.equal(compareProbe(probe({home:[0,0,0],payroll:[12,8,0]}),base).ok,true);
  const better=compareProbe(probe({home:[0,0,0],payroll:[0,0,0]}),base);
  assert.equal(better.ok,true);
  assert.match(better.lines.join('\n'),/نزل 2/);
});

test('الصعود يُردّ، ويُسمّى بالشاشة والعرض',()=>{
  const base=probe({home:[0,0,0],payroll:[12,8,0]});
  const worse=compareProbe(probe({home:[0,0,0],payroll:[12,8,5]}),base);
  assert.equal(worse.ok,false);
  assert.match(worse.lines.join('\n'),/payroll عند 414: 0 → 5/);
});

test('شاشة جديدة تبدأ من صفر، ومجموعٌ ثابت لا يخفي مقايضة',()=>{
  const base=probe({home:[0,0,0]});
  assert.equal(compareProbe(probe({home:[0,0,0],leave:[0,0,0]}),base).ok,true);
  assert.equal(compareProbe(probe({home:[0,0,0],leave:[4,0,0]}),base).ok,false,'الجديد لا يرث مخصصًا');
  // شاشة تحسّنت وأخرى ساءت والمجموع كما هو: يُردّ.
  const swap=compareProbe(probe({home:[3,0,0],payroll:[0,0,0]}),probe({home:[0,0,0],payroll:[3,0,0]}));
  assert.equal(swap.ok,false);
  assert.match(swap.lines.join('\n'),/home عند 360: 0 → 3/);
});

test('قياسٌ ناقص يُقال، ولا يُقرأ نجاحًا',()=>{
  const v=compareProbe(probe({home:[0,null,0]}),probe({home:[0,0,0]}));
  assert.match(v.lines.join('\n'),/لم يتم/,'الإطار الذي لم يُقرأ يُعلن، فلا يُحسب صفرًا');
  // وناتجٌ ليس من المسبار يُرفض بدل أن يُقرأ صفرًا.
  assert.equal(compareProbe({},null).ok,false);
});
