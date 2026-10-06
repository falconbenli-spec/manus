// مسح الخيارات (scripts/options-sweep.mjs): الأثر الوحيد الذي يقرأ منه المالك «كم تحوَّل وما بقي».
//
// المسح لا يصلح شيئًا، ولهذا بالذات يجب أن يُحرَس: رقمٌ مائل فيه يقول للمالك إن حقلًا تحت يده وهو ليس كذلك،
// أو إن قائمةً يقفلها نصّ نظامي هي له. يُشغَّل هنا بصيغته JSON — العملية نفسها التي يشغّلها الإنسان — لأن
// الوحدة تنفّذ عملها عند التحميل، فاختبارُها باستيرادها يختبر شيئًا آخر.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { GOVERNANCE_NAMES } from '../app/options.mjs';

const sweep=(()=>{
  const script=new URL('../scripts/options-sweep.mjs',import.meta.url);
  const run=spawnSync(process.execPath,[script.pathname,'--json'],{encoding:'utf8',maxBuffer:64*1024*1024});
  assert.equal(run.status,0,run.stderr);
  return JSON.parse(run.stdout);
})();

test('المسح يقرأ كل وحدة: وحدةٌ تتعثّر تُسمَّى ولا تُبتلع',()=>{
  assert.deepEqual(sweep.summary.load_failures,[],'وحدة لم تُقرأ تعني عدًّا ناقصًا يصمت عن نفسه');
  assert.ok(sweep.summary.modules_read>100);
  assert.ok(sweep.summary.important_columns>400);
});

// كان الحكم يميّز db_locked وحدها ويعدّ كل ما سواها «يديرها المالك»، فقائمةٌ مثبّتة نظامًا — تقول عنها
// optionsFor نفسها editable:false — كانت تُحسب على سطر «يديرها المالك» وتُطبع تحت «ما تحوَّل».
test('لكل حوكمة سطرها في الملخّص: ما يثبّته النظام ليس «يديرها المالك»',()=>{
  for(const governance of Object.keys(GOVERNANCE_NAMES))
    assert.ok(Object.hasOwn(sweep.summary,governance),`الحوكمة ${governance} بلا عدّاد في الملخّص`);
  // ولا عمود يحمل حوكمةً غير التي أعلنها واصفه.
  for(const f of sweep.findings.filter(f=>f.list))
    assert.ok(Object.hasOwn(GOVERNANCE_NAMES,f.verdict),`${f.column}: الحكم «${f.verdict}» ليس حوكمة معروفة`);
});

// «القائمة مسجَّلة» لا يعني أن مسار كتابة يستدعيها: نداء requireOption على وحدة القياس مشروط بقرار إغلاق
// افتراضه false، فالعمود ما زال نصًّا حرًّا اليوم. عدُّه «تحوَّل» يقول للمالك رقمًا أكبر من الحقيقة.
test('العدّ يفصل المفروض اليوم عن المسجَّل بانتظار قرار إغلاق',()=>{
  const owned=sweep.findings.filter(f=>['managed','bounded'].includes(f.verdict));
  assert.equal(owned.length,sweep.summary.enforced_today+sweep.summary.registered_not_closed);
  const unit=sweep.findings.find(f=>f.column==='procurement_purchases.unit');
  assert.equal(unit.verdict,'managed','القائمة مسجَّلة على العمود');
  assert.equal(unit.enforced,false,'ولا يفرضها مسار كتابة اليوم');
  assert.equal(unit.awaiting_decision,'procurement.unit_closed','والقرار الذي تنتظره مسمًّى');
  // وما هو مفروض فعلًا: نداء requireOption غير مشروط في وحدته.
  for(const f of owned.filter(f=>f.enforced))assert.equal(f.awaiting_decision,null,`${f.column}: مفروض فلا ينتظر قرارًا`);
});

// الكاشف كان يرى ['key', و key: وحدهما، فمصفوفة نصوص مسطّحة تُخرج مفتاحًا واحدًا ويُسقطها حدّ الثلاثة.
test('القواميس المسطّحة مرئية، وما يقفله نصّ نظامي يُقال بمادته لا يُعدّ متبقّيًا',()=>{
  const penalty=sweep.code_dictionaries.find(d=>d.file==='discipline.mjs'&&d.name==='PENALTY_KINDS');
  assert.ok(penalty,'PENALTY_KINDS مصفوفة نصوص مسطّحة: كان الماسح لا يراها أصلًا');
  assert.equal(penalty.entries,5);
  assert.equal(penalty.verdict,'legally_fixed','لا «متبقٍّ يُسلَّم للمالك»: م111 تقفل القائمة');
  assert.match(penalty.article,/م111/);
  assert.ok(penalty.because.length>10,'ومعها سبب يُراجَع لا يُصدَّق');
  // والمتبقّي لا يحتسبها: قائمةٌ يقفلها نصّ ليست تأخّرًا في التحويل.
  assert.equal(sweep.summary.code_dictionaries_unmanaged,
    sweep.code_dictionaries.filter(d=>d.verdict==='free_text').length);
  assert.ok(sweep.summary.code_dictionaries>400,'وعدد القواميس صار يشمل المسطّحة');
});
