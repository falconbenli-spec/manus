import test from 'node:test';
import assert from 'node:assert/strict';
import { compare,describe,measure,totals,loadBaseline,countPrimitives,countStatusLiterals,METRICS, countUnisolated, countDirectPersonReads} from '../scripts/quality-ratchet.mjs';

// المسنّنة (م0 «السور»): العدّ ينزل فقط، والملف الجديد يبدأ من صفر، ويُسمّى الملف الذي تراجع وبكم.
const base={primitives:{'app/static/a-ui.mjs':2,'app/static/b-ui.mjs':1},short_refusals:{'app/a.mjs':10},status_literals:{'app/home.mjs':2}};

test('ratchet: the same counts pass, a lower count passes and is reported as an improvement',()=>{
  assert.deepEqual(compare(base,structuredClone(base)),{regressions:[],improvements:[]});
  const better=structuredClone(base);better.primitives['app/static/a-ui.mjs']=1;delete better.primitives['app/static/b-ui.mjs'];better.short_refusals['app/a.mjs']=4;
  const result=compare(base,better);
  assert.deepEqual(result.regressions,[]);
  assert.deepEqual(result.improvements.map(i=>[i.metric,i.file,i.from,i.to,i.delta]),[['primitives','app/static/a-ui.mjs',2,1,-1],['primitives','app/static/b-ui.mjs',1,0,-1],['short_refusals','app/a.mjs',10,4,-6]]);
});

test('ratchet: a count that rises fails, and the message names the file and by how much',()=>{
  const worse=structuredClone(base);worse.short_refusals['app/a.mjs']=13;
  const {regressions}=compare(base,worse);
  assert.equal(regressions.length,1);
  assert.equal(describe(regressions[0]),'app/a.mjs: رفض قصير 10 → 13 (+3)');
});

test('ratchet: a new file must score zero — it has no allowance to inherit',()=>{
  const added=structuredClone(base);added.primitives['app/static/new-ui.mjs']=1;added.status_literals['app/new.mjs']=1;
  const {regressions}=compare(base,added);
  assert.deepEqual(regressions.map(r=>[r.file,r.from,r.to,r.fresh]),[['app/static/new-ui.mjs',0,1,true],['app/new.mjs',0,1,true]]);
  assert.equal(describe(regressions[0]),'app/static/new-ui.mjs: مكوّن محلي 0 → 1 (+1) — ملف جديد، وأساس الملف الجديد صفر');
  // نقل مكوّن من ملف إلى ملف لا يمرّ لأن المجموع ثابت: العدّ لكل ملف.
  const moved=structuredClone(base);moved.primitives['app/static/a-ui.mjs']=1;moved.primitives['app/static/b-ui.mjs']=2;
  assert.equal(compare(base,moved).regressions.length,1);
});

test('ratchet: the primitive counter sees a renderer or a dictionary by name, not a data variable that happens to be called row',()=>{
  assert.equal(countPrimitives("const tile=(value,label,t='')=>`<div>`;"),1);
  assert.equal(countPrimitives("const tile=(e,value,label)=>`x`,row=r=>`<li>`;function card(c){return ''}"),3);
  assert.equal(countPrimitives("const statusNames={draft:'مسودة'};const roleNames={employee:'موظف'};"),2);
  assert.equal(countPrimitives("const tileOf=e=>(value,label)=>`x`;"),1,'مصنع tile نسخة أخرى منها');
  // ليست مكوّنات: متغير بيانات، وأخذ من العدّة، واستيراد من القاموس.
  assert.equal(countPrimitives("const row=list.find(item=>item.id===id);const {tile,empty}=ui;import { REQUEST_STATUS as statusNames } from './vocabulary.mjs';const table=data.table;"),0);
});

test('ratchet: the status counter sees a banned phrase once and a local map of the eight statuses under any name',()=>{
  assert.equal(countStatusLiterals("const s='قيد بانتظار الاعتماد';"),1,'العبارة الأطول تُعدّ مرة لا مرتين');
  assert.equal(countStatusLiterals("x='قيد الاعتماد';y='معاد إليك';z='معتمد بانتظار التنفيذ';"),3);
  assert.equal(countStatusLiterals("const WORDS={draft:'a',pending:'b',returned:'c',approved:'d',in_progress:'e',completed:'f',rejected:'g',cancelled:'h'};"),1);
  assert.equal(countStatusLiterals("const leaveStatus={pending_manager:'pending',returned:'returned',approved:'approved',rejected:'rejected',cancelled:'cancelled'};"),0,'خريطة وحدة بخمس حالات ليست نسخة من الثماني');
  assert.equal(countStatusLiterals("const label='بانتظار الاعتماد';const x='قيد التنفيذ';"),0,'عبارات القاموس نفسها ليست ممنوعة');
});

test('عدّاد عزل الاتجاه: يُعدّ القيمة اللاتينية في نص عربي، ولا يُعدّ ما عُزل ولا ما في سمة',()=>{
  // «HR-2026-0001» بين نصّين عربيين: حافّتاه محايدات، فترتيبها يتبع الفقرة لا القيمة.
  assert.equal(countUnisolated('`<td>المرجع ${e(r.reference)}</td>`'),1);
  assert.equal(countUnisolated('`<td><bdi>${e(r.reference)}</bdi></td>`'),0,'المعزول لا يُعدّ');
  assert.equal(countUnisolated('`<td dir="ltr">${e(x.vat_number)}</td>`'),0,'dir=ltr عزل أيضًا');
  assert.equal(countUnisolated('`<span class="ltr">${e(r.code)}</span>`'),0);
  // داخل سمة: لا يُعزل بوسم، وإقحامه يكسر الترميز — فلا يُعدّ.
  assert.equal(countUnisolated('`<a href="#x?focus=${e(r.code)}">ا</a>`'),0);
  assert.equal(countUnisolated('`<input value="${e(r.reference)}">`'),0);
  // ما ليس قيمةً لاتينية لا يُعدّ مهما كان موضعه.
  assert.equal(countUnisolated('`<td>${e(r.employee_name)}</td>`'),0);
});

test('سقف D3: يُعدّ القراءة المباشرة لجداول الأشخاص الثلاثة، ولا يُعدّ غيرها',()=>{
  assert.equal(countDirectPersonReads("db.prepare('SELECT * FROM users WHERE id=?')"),1);
  assert.equal(countDirectPersonReads('JOIN employee_profiles p ON p.user_id=u.id'),1);
  assert.equal(countDirectPersonReads('UPDATE employment_contracts SET x=1'),1);
  assert.equal(countDirectPersonReads('INSERT INTO users(id) VALUES(?)'),1);
  // ثلاث قراءات في سطر واحد تُعدّ ثلاثًا.
  assert.equal(countDirectPersonReads('FROM users u JOIN employee_profiles p ON 1 JOIN employment_contracts c ON 1'),3);
  // وما ليس من الثلاثة لا يُعدّ، ولا ما كان الاسم جزءًا منه.
  assert.equal(countDirectPersonReads('SELECT * FROM requests'),0);
  assert.equal(countDirectPersonReads('FROM users_archive'),0,'الحدّ يمنع مطابقة اسم أطول');
  assert.equal(countDirectPersonReads('// نقرأ users هنا'),0,'ذكرُ الاسم ليس قراءة');
});

test('ratchet: live against the committed baseline — nothing rose, every link resolves, and it stays fast',async()=>{
  const started=performance.now(),current=await measure(),elapsed=performance.now()-started;
  const baseline=loadBaseline(),{regressions}=compare(baseline,current);
  assert.deepEqual(regressions.map(describe),[]);
  assert.deepEqual(current.links.unresolved,[]);
  // القائمة مثبَّتة عمدًا: مقياس يُضاف قرارٌ يُكتب، لا أثرٌ جانبي لتعديل. الرابع أُضيف في م1 البند 11
  // (عزل الاتجاه)، والخامس في م2/TP2.7 وهو سقف القراءة المباشرة لبيانات الأشخاص — ينزل مع كل هجرة إلى المساعد.
  // (عزل اتجاه القيم اللاتينية داخل النص العربي)، وخط أساسه صفر — فكل قيمة جديدة بلا عزل تراجع.
  assert.deepEqual(Object.keys(METRICS),['primitives','short_refusals','status_literals','bidi_unisolated','direct_person_reads']);
  assert.deepEqual(baseline.totals,totals(baseline),'مجاميع خط الأساس تطابق ما فيه: الملف لم يُحرَّر باليد');
  assert.ok(elapsed<3000,`المسنّنة أخذت ${Math.round(elapsed)} ms`);
});
