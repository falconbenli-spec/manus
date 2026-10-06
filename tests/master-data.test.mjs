// دليل البيانات المرجعية (app/master-data.mjs + الترحيل 157).
//
// ‏**كل صف في هذا الملف مصطنع، ومكتوب في الاختبار وحده، وسلطة مصدره تقول ذلك بالحرف.**
// ما يُختبَر هو **الآلة**: التطبيع، والتفرّد، ومنع الحذف، وغياب الحالة التشغيلية، ومراجعة المصدر — لا محتوى
// قائمة بعينها. ولا صف من صفوف هذا الملف يصلح بذرًا: مصدر البنوك الرسمي (SAMA) ما وصل من هذه البيئة،
// والتفصيل في docs/services/MASTER-DATA-SOURCES.md. ولهذا source_authority في كل فكسچر أدناه تقول
// «مصطنع للاختبار — ليس SAMA»، فلا يقرأ أحدٌ يومًا صفًّا من هنا فيظنه مطابَقًا على جهة رسمية.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, transaction, verifyAudit } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { searchMasterData, recordEntity, addAlias, aliasesFor, attestVerification,
  proposeSourceChange, decideSourceChange, openReviews, reviewThread, revisionsFor,
  directoryState, bank, listBanks, bannedStatusKeys, logoAssetPath, sourceLine,
  loadSourceFile, DIRECTORY_EMPTY, MISSION_ACCREDITATION, OPERATIONAL_STATUS_PHRASES } from '../app/master-data.mjs';

const SYNTHETIC = 'مصطنع للاختبار — ليس SAMA';
const thrown = fn => { try { fn(); } catch (error) { return error; } throw new Error('لم يقع الرفض المتوقع'); };

function fresh() {
  const db = openDb(':memory:');
  seed(db, 'synthetic-master-data-test-only');
  const actor = db.prepare("SELECT * FROM users WHERE id='admin'").get();
  // دولة مصطنعة برمز ISO محفوظ للاستعمال الخاص (ZZ/ZZZ)، فلا يُنسب هذا الصف إلى دولة حقيقية.
  recordEntity(db, actor, 'country', {
    id: 'zz_test', iso2: 'ZZ', iso3: 'ZZZ', name_ar: 'دولة اختبار مصطنعة', name_en: 'Test Country',
    source_authority: SYNTHETIC,
  });
  return { db, actor };
}

// الاسم أدناه مكتوب بصورته المعروفة لأن المطلوب اختباره بالحرف هو أن التطبيع يجد «راجحي» و«الراجحي»
// و«ALRAJHI». الصف مصطنع ومصدره يقول ذلك، وverification تبقى 'unverified' — ما أحد شهد على شي.
function withBank(db, actor, extra = {}) {
  return recordEntity(db, actor, 'bank', {
    id: 'test_rajhi', name_ar: 'مصرف الراجحي', name_en: 'Al Rajhi Bank', short_name: 'الراجحي',
    country_id: 'zz_test', source_authority: SYNTHETIC, ...extra,
  });
}

test('التطبيع يجد «راجحي» و«الراجحي» و«ALRAJHI» — والقيمة المخزَّنة ما تتغير', () => {
  const { db, actor } = fresh();
  withBank(db, actor);

  for (const query of ['راجحي', 'الراجحي', 'ALRAJHI', 'alrajhi', 'الرَّاجِحي', 'الراجحى', 'راجحيـ', '  الراجحي  ']) {
    const hits = searchMasterData(db, query, { kinds: ['bank'] });
    assert.equal(hits.length, 1, `«${query}» ما وجد الصف`);
    assert.equal(hits[0].id, 'test_rajhi', `«${query}» وجد صفًا غير المقصود`);
  }

  // التطبيع نسخةٌ للبحث: الاسم في القاعدة يبقى كما كُتب، بهمزته وألفه ولامه.
  const stored = bank(db, 'test_rajhi');
  assert.equal(stored.name_ar, 'مصرف الراجحي');
  assert.equal(stored.name_en, 'Al Rajhi Bank');
  assert.equal(stored.short_name, 'الراجحي');
  // ولا يرفع التسجيل المطابقة: الصف يخرج «غير مطابَق» ولو أدخله مسؤول المنصة.
  assert.equal(stored.verification, 'unverified');
  assert.equal(stored.verified_by, null);
  assert.match(sourceLine(stored), /ما زال غير مطابَق/);
});

test('البحث ثنائي اللغة: الاسم الإنجليزي والعربي والاختصار ورمز الدولة', () => {
  const { db, actor } = fresh();
  withBank(db, actor, { bic: 'RJHISARI' });

  assert.equal(searchMasterData(db, 'Rajhi', { kinds: ['bank'] })[0]?.id, 'test_rajhi');
  assert.equal(searchMasterData(db, 'مصرف', { kinds: ['bank'] })[0]?.id, 'test_rajhi');
  assert.equal(searchMasterData(db, 'RJHISARI', { kinds: ['bank'] })[0]?.id, 'test_rajhi');
  // الدولة تُوجد برمزها وباسميها، والأرقام الهندية تُطبَّع إلى لاتينية.
  assert.equal(searchMasterData(db, 'ZZ', { kinds: ['country'] })[0]?.id, 'zz_test');
  assert.equal(searchMasterData(db, 'Test Country', { kinds: ['country'] })[0]?.id, 'zz_test');
  // وما يطابق ما ليس فيه: استعلام غريب ما يرجع شيئًا.
  assert.deepEqual(searchMasterData(db, 'قزويقزوي', { kinds: ['bank', 'country'] }), []);
  // كل نتيجة تقول في أي حقل طابقت، فيعرف القارئ لماذا ظهرت له.
  assert.equal(searchMasterData(db, 'Rajhi', { kinds: ['bank'] })[0].matched_on, 'الاسم الإنجليزي');
});

test('الاسم البديل يوصّل المرجع التاريخي إلى الصف القائم بعد تغيّر الاسم', () => {
  const { db, actor } = fresh();
  withBank(db, actor);
  // بنكٌ تغيّر اسمه: الاسم القديم يُحفظ بديلًا، فالعقود المكتوبة به تظل توصل إلى الصف نفسه.
  addAlias(db, actor, 'bank', 'test_rajhi', { alias: 'الاسم المصطنع السابق', alias_kind: 'former_name', source_authority: SYNTHETIC });

  const hits = searchMasterData(db, 'المصطنع السابق', { kinds: ['bank'] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'test_rajhi');
  // ويُقال للقارئ إنه اسم سابق، فلا يظن أن المؤسسة ما زالت تُسمّى به.
  assert.equal(hits[0].matched_on, 'اسم سابق');
  assert.equal(aliasesFor(db, 'bank', 'test_rajhi').length, 1);
  // والبديل ما يُعدَّل وما يُحذف: هو ما كان يقوله مرجع قديم.
  assert.throws(() => db.prepare('DELETE FROM master_data_aliases').run(), /never erased/);
  assert.throws(() => db.prepare("UPDATE master_data_aliases SET alias='x'").run(), /not edited/);
  // وبديلٌ لكيان ما هو موجود ما يُقبل: اسمٌ معلّق ما يوصل منه أحد إلى شي.
  assert.throws(() => db.prepare("INSERT INTO master_data_aliases(entity_kind,entity_id,alias,alias_kind,source_authority,created_at) VALUES('bank','ghost','س','abbreviation','x','2026-09-29')").run(),
    /no such entity/);
});

test('الكيان ما يحمل أي حقل حالة تشغيلية — حارس قيد المالك', () => {
  const { db, actor } = fresh();
  const banned = bannedStatusKeys();

  // (1) القاعدة: أعمدة جداول الكيانات الثلاثة تُقرأ من PRAGMA، وما فيها عمود حالة تشغيلية.
  for (const table of ['countries', 'banks', 'diplomatic_missions']) {
    const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map(row => row.name);
    assert.ok(columns.length > 0, `${table} ما قُرئت أعمدته`);
    for (const column of columns) {
      const flat = column.toLowerCase().replace(/[^a-z؀-ۿ]/g, '');
      assert.ok(!banned.includes(flat),
        `عمود «${column}» في ${table} حالة تشغيلية — المالك منع تخزين هل بدأ البنك نشاطه أو ما بدأ`);
    }
    // ولا فهرس ولا قادح **باسم** حالة تشغيلية على هذه الجداول. والفحص على الأسماء لا على نصّ المخطَّط
    // كله، لأن الكلمة تظهر في نصّه منذ الترحيل 159 في موضع واحد مشروع: داخل حارسٍ يمنعها. ومنعُ ذكرها
    // حتى في المنع كان سيمنع الحارس نفسه — وهذا ما سقط عليه هذا الاختبار أول مرة بعد 159.
    // والقادح المسمّى باسم ما يمنعه مستثنًى وحده: «…_no_operational_status» يقول الكلمة ليرفضها، وهو
    // أوضح اسم يمكن أن يُسمّى به حارس. وما عدا القوادح — عمود أو فهرس — ممنوع عليه ذكرها بأي صورة،
    // لأن العمود لا يمنع شيئًا: العمود يخزّن، والفهرس يرشّح.
    for (const object of db.prepare("SELECT type,name FROM sqlite_master WHERE tbl_name=? AND name IS NOT NULL").all(table)) {
      if (object.type === 'trigger' && object.name.toLowerCase().includes('no_operational_status')) continue;
      const flat = object.name.toLowerCase().replace(/[^a-z؀-ۿ]/g, '');
      for (const word of ['operational', 'startedoperations', 'isactive', 'notstarted'])
        assert.ok(!flat.includes(word), `«${word}» في اسم ${object.type} على ${table}: ${object.name}`);
    }
    // وكل كائنٍ يذكر الحالة التشغيلية في تعريفه كائنُ منع: إما قيدٌ يساوي صفرًا، وإما قادحٌ يرفض.
    // والفحص على الكائن كاملًا لا على السطر، لأن اسم القادح في سطره الأول والرفض في سطرٍ بعده.
    // ولو كُتبت الكلمة يومًا في موضع يخزّنها أو يرشّح بها، سقطت هذي الدعوى: ذاك الكائن ما فيه منع.
    for (const object of db.prepare("SELECT type,name,COALESCE(sql,'') sql FROM sqlite_master WHERE tbl_name=?").all(table)) {
      const lowered = object.sql.toLowerCase();
      if (!['operational', 'بدأ النشاط', 'لم يباشر'].some(word => lowered.includes(word))) continue;
      assert.ok(/\)\s*=\s*0|raise\(abort/i.test(object.sql),
        `${object.type} «${object.name}» على ${table} يذكر الحالة التشغيلية بلا أن يمنعها`);
    }
  }

  // (2) الطبقة: مفتاح حالة تشغيلية في المُدخَل يُرفض رفضًا مسموعًا، ما يُتجاهل بصمت — فلا يظن كاتب
  //     الاستدعاء أنه سجّل حالةً وهي ما سُجِّلت.
  for (const key of ['active', 'operational', 'started_operations', 'isActive', 'الحالة']) {
    const error = thrown(() => recordEntity(db, actor, 'bank', {
      id: 'x_bank', name_ar: 'بنك مصطنع', name_en: 'Synthetic Bank', country_id: 'zz_test',
      source_authority: SYNTHETIC, [key]: 1,
    }));
    assert.equal(error.code, 'master_data_no_operational_status', `المفتاح «${key}» ما رُفض`);
    assert.match(error.message, /حالة تشغيلية/);
  }
  // ويُرفض في المقترح كذلك، فلا يدخل من باب المراجعة ما مُنع من باب التسجيل.
  withBank(db, actor);
  assert.equal(thrown(() => proposeSourceChange(db, actor, {
    kind: 'bank', entity_id: 'test_rajhi', proposed: { active: 0 }, source_authority: SYNTHETIC,
    source_fetched_at: '2026-09-29', reason: 'محاولة تمرير حالة تشغيلية',
  })).code, 'master_data_no_operational_status');

  // (3) وملخص الدليل ما يقول شيئًا عن المؤسسات: يعدّ الصفوف والمطابَق منها وبس.
  const state = directoryState(db, actor.tenant_id);
  assert.deepEqual(Object.keys(state.bank).sort(), ['empty_text', 'rows', 'unverified', 'verified']);
});

test('التفرّد يمنع التكرار: ISO، ورقم الترخيص حين يُورَّد، والبعثة على الدولة+النوع+المدينة', () => {
  const { db, actor } = fresh();

  // رمز ISO فريد للدولة — بشكليه.
  assert.throws(() => recordEntity(db, actor, 'country', { id: 'dup_iso2', iso2: 'ZZ', iso3: 'QQQ', name_ar: 'مكرر', name_en: 'Dup', source_authority: SYNTHETIC }), /UNIQUE|constraint/i);
  assert.throws(() => recordEntity(db, actor, 'country', { id: 'dup_iso3', iso2: 'QQ', iso3: 'ZZZ', name_ar: 'مكرر', name_en: 'Dup', source_authority: SYNTHETIC }), /UNIQUE|constraint/i);

  // رقم الترخيص فريد حين يُورَّد.
  withBank(db, actor, { licence_number: 'TEST-0001', licence_authority: SYNTHETIC });
  assert.throws(() => recordEntity(db, actor, 'bank', {
    id: 'other_bank', name_ar: 'بنك مصطنع ثانٍ', name_en: 'Second Synthetic Bank', country_id: 'zz_test',
    licence_number: 'TEST-0001', licence_authority: SYNTHETIC, source_authority: SYNTHETIC,
  }), /UNIQUE|constraint/i);
  // والفراغ يعني «ما وُرِّد» لا «ما له ترخيص»، فبنكان بلا رقم يُقبلان — الفهرس جزئي.
  recordEntity(db, actor, 'bank', { id: 'nolicence_a', name_ar: 'بنك بلا رقم أ', name_en: 'No Licence A', country_id: 'zz_test', source_authority: SYNTHETIC });
  recordEntity(db, actor, 'bank', { id: 'nolicence_b', name_ar: 'بنك بلا رقم ب', name_en: 'No Licence B', country_id: 'zz_test', source_authority: SYNTHETIC });
  assert.equal(listBanks(db).length, 3);
  // ورقمُ ترخيصٍ بلا جهة قالته ما يُقبل: الرقم بلا سلطته ما يُراجع.
  assert.throws(() => recordEntity(db, actor, 'bank', { id: 'orphan_licence', name_ar: 'بنك', name_en: 'Bank', country_id: 'zz_test', licence_number: 'TEST-9', source_authority: SYNTHETIC }), /constraint/i);

  // البعثة: الدولة + نوع البعثة + المدينة.
  const missionOf = (id, extra = {}) => recordEntity(db, actor, 'mission', {
    id, country_id: 'zz_test', mission_type: 'embassy', city_ar: 'الرياض', city_en: 'Riyadh',
    name_ar: 'سفارة دولة الاختبار المصطنعة', name_en: 'Embassy of Test Country', source_authority: SYNTHETIC, ...extra,
  });
  missionOf('mission_one');
  assert.throws(() => missionOf('mission_two'), /UNIQUE|constraint/i);
  // والمدينة تُقارَن على صورة موحَّدة: «الريّاض» بالشدة و«الرياض» مدينة واحدة، فلا يدخل الصف مرتين.
  assert.throws(() => missionOf('mission_three', { city_ar: 'الريّاض' }), /UNIQUE|constraint/i);
  // ونوعٌ ثانٍ في المدينة نفسها مقبول: قنصلية عامة بجوار سفارة شيء طبيعي.
  missionOf('mission_consulate', { mission_type: 'consulate_general', name_ar: 'قنصلية عامة مصطنعة', name_en: 'Synthetic Consulate General' });
  assert.equal(db.prepare('SELECT count(*) c FROM diplomatic_missions').get().c, 2);
});

test('الحذف ممنوع، والتعديل يحفظ صورة ما كان، والمعرّف ما يُعاد كتابته', () => {
  const { db, actor } = fresh();
  withBank(db, actor, { licence_number: 'TEST-0002', licence_authority: SYNTHETIC });
  // لكل جدول صفٌّ فعليّ قبل محاولة الحذف: «DELETE FROM» على جدول فاضي ما يحذف شيئًا فما يوقظ القادح،
  // فتمرّ الدعوى بلا أن تُثبت شيئًا. (هكذا سقط هذا الاختبار أول مرة، وكان السقوط في الاختبار لا في الحارس.)
  recordEntity(db, actor, 'mission', {
    id: 'mission_delete_probe', country_id: 'zz_test', mission_type: 'embassy', city_ar: 'الرياض', city_en: 'Riyadh',
    name_ar: 'سفارة دولة الاختبار المصطنعة', name_en: 'Embassy of Test Country', source_authority: SYNTHETIC,
  });

  // ما في حذف صامت لصف مرجعي أشارت إليه مسيّرات وعقود — والرسالة تقول البديل.
  for (const table of ['countries', 'banks', 'diplomatic_missions']) {
    assert.ok(db.prepare(`SELECT count(*) c FROM ${table}`).get().c > 0, `${table} فاضي فالدعوى ما تُثبت شيئًا`);
    const error = thrown(() => db.prepare(`DELETE FROM ${table}`).run());
    assert.match(error.message, /never deleted/, `${table} سمح بالحذف`);
  }
  assert.equal(listBanks(db).length, 1);

  // والتعديل يحفظ الصورة السابقة كاملة، فيُقرأ لاحقًا رقم الترخيص الذي كان مسجَّلًا.
  db.prepare("UPDATE banks SET licence_number='TEST-0003' WHERE id='test_rajhi'").run();
  const history = revisionsFor(db, 'bank', 'test_rajhi');
  assert.equal(history.length, 1);
  assert.equal(history[0].before.licence_number, 'TEST-0002');
  assert.equal(bank(db, 'test_rajhi').licence_number, 'TEST-0003');
  // وتاريخ الصف نفسه إلحاقي: ما يُمحى ولا يُعدَّل.
  assert.throws(() => db.prepare('DELETE FROM master_data_revisions').run(), /append only/);
  assert.throws(() => db.prepare("UPDATE master_data_revisions SET entity_id='x'").run(), /append only/);

  // والمعرّف المستقر ما يُعاد كتابته: تغييره يقطع كل إحالة قديمة بلا أثر.
  assert.throws(() => db.prepare("UPDATE banks SET id='renamed' WHERE id='test_rajhi'").run(), /never rewritten/);
});

test('ما يُسجَّل صف بلا سلطة مصدر — الجدول الفاضي أصدق من صف مخترع', () => {
  const { db, actor } = fresh();
  const error = thrown(() => recordEntity(db, actor, 'bank', {
    id: 'sourceless', name_ar: 'بنك بلا مصدر', name_en: 'Sourceless Bank', country_id: 'zz_test',
  }));
  assert.equal(error.code, 'master_data_source_required');
  assert.match(error.message, /سلطة المصدر/);
  assert.equal(listBanks(db).length, 0);

  // والدليل الفاضي يقول ما ينتظره ومن يملكه، لا «لا نتائج».
  const empty = directoryState(openDb(':memory:'));
  assert.equal(empty.empty, true);
  assert.equal(empty.bank.rows, 0);
  // الجملة تقول ما الناقص، ولا تحمل مسار ملف ولا اسم منفّذ: ذاك مكانه وثيقة التسليم لا الشاشة.
  assert.match(empty.waiting_on, /ما وصلتنا/);
  assert.doesNotMatch(empty.waiting_on, /docs\/|\.md/);
});

test('مراجعة المصدر: تُقترح ولا تُكتب فوق الإنتاج، والقبول فعل إنسان باسمه', () => {
  const { db, actor } = fresh();
  withBank(db, actor, { licence_number: 'TEST-0004', licence_authority: SYNTHETIC });

  const opened = proposeSourceChange(db, actor, {
    kind: 'bank', entity_id: 'test_rajhi', proposed: { licence_number: 'TEST-0009' },
    source_authority: SYNTHETIC, source_fetched_at: '2026-09-29', reason: 'المصدر المصطنع يقول رقمًا آخر',
  });
  assert.equal(opened.state, 'proposed');
  // ‏**الإنتاج ما تحرك**: هذا هو القيد كله.
  assert.equal(bank(db, 'test_rajhi').licence_number, 'TEST-0004');
  assert.equal(openReviews(db, actor.tenant_id, 'bank').length, 1);

  // قرارٌ بلا سبب مكتوب ما يُسجَّل.
  assert.equal(thrown(() => decideSourceChange(db, actor, { thread_id: opened.thread_id, accept: true, reason: '' })).code, 'master_data_reason_required');
  assert.equal(bank(db, 'test_rajhi').licence_number, 'TEST-0004');

  // والقبول باسم إنسان يكتب القيمة، والصورة السابقة محفوظة.
  const decided = decideSourceChange(db, actor, { thread_id: opened.thread_id, accept: true, reason: 'طوبِق على المصدر المصطنع' });
  assert.equal(decided.thread.state, 'accepted');
  assert.equal(decided.thread.decided_by, actor.id);
  assert.equal(bank(db, 'test_rajhi').licence_number, 'TEST-0009');
  assert.equal(revisionsFor(db, 'bank', 'test_rajhi')[0].before.licence_number, 'TEST-0004');
  assert.equal(openReviews(db, actor.tenant_id, 'bank').length, 0);

  // وخيطٌ حُسم ما يُحسم ثانية، لا من الطبقة ولا من القاعدة.
  assert.equal(thrown(() => decideSourceChange(db, actor, { thread_id: opened.thread_id, accept: false, reason: 'نقض القرار' })).code, 'master_data_review_decided');
  assert.throws(() => db.prepare("UPDATE master_data_source_reviews SET state='rejected' WHERE seq=1").run(), /append only/);
  assert.throws(() => db.prepare('DELETE FROM master_data_source_reviews').run(), /append only/);
  // وقرارٌ على خيط ما فيه اقتراح ما يُقبل: ما يُقبل ما لم يُقترح.
  assert.throws(() => db.prepare(`INSERT INTO master_data_source_reviews(tenant_id,thread_id,entity_kind,entity_id,state,proposed_json,source_authority,source_fetched_at,reason,actor_id,acted_at)
    VALUES(?, 'ghost_thread','bank','test_rajhi','accepted','{}','x','2026-09-29','بلا اقتراح',?,?)`).run(actor.tenant_id, actor.id, '2026-09-29'),
    /nothing was proposed/);

  // والرفض يترك الإنتاج كما هو، ويبقى مقروءًا بسببه.
  const second = proposeSourceChange(db, actor, {
    kind: 'bank', entity_id: 'test_rajhi', proposed: { licence_number: 'TEST-BAD' },
    source_authority: SYNTHETIC, source_fetched_at: '2026-09-29', reason: 'قيمة مشكوك فيها',
  });
  decideSourceChange(db, actor, { thread_id: second.thread_id, accept: false, reason: 'ما طابقت المصدر' });
  assert.equal(bank(db, 'test_rajhi').licence_number, 'TEST-0009');
  assert.equal(reviewThread(db, second.thread_id).state, 'rejected');
  // والمقترح ما يقدر يعيد كتابة المعرّف.
  assert.equal(thrown(() => proposeSourceChange(db, actor, {
    kind: 'bank', entity_id: 'test_rajhi', proposed: { id: 'hijack' }, source_authority: SYNTHETIC,
    source_fetched_at: '2026-09-29', reason: 'محاولة تغيير المعرّف',
  })).code, 'master_data_unknown_field');

  assert.equal(verifyAudit(db), true);
});

test('المطابقة إقرار إنسان باسمه، لا فعل ترحيل ولا سكربت', () => {
  const { db, actor } = fresh();
  withBank(db, actor);
  assert.equal(bank(db, 'test_rajhi').verification, 'unverified');

  const after = attestVerification(db, actor, 'bank', 'test_rajhi', { source_url: 'https://example.invalid/synthetic' });
  assert.equal(after.verification, 'verified');
  assert.equal(after.verified_by, actor.id);
  assert.ok(after.verified_at);
  assert.match(sourceLine(after), /مطابَق في 20/);

  // ولا إقرار مرتين، ولا «مطابَق» بلا اسم في القاعدة.
  assert.equal(thrown(() => attestVerification(db, actor, 'bank', 'test_rajhi')).code, 'master_data_already_verified');
  assert.throws(() => db.prepare("UPDATE countries SET verification='verified' WHERE id='zz_test'").run(), /constraint/i);
  assert.equal(thrown(() => attestVerification(db, actor, 'bank', 'ghost')).code, 'master_data_not_found');
  assert.equal(verifyAudit(db), true);
});

test('مكان الأصول مُصمَّم وما يُنزَّل منه شي', () => {
  // الشعار علامة تجارية مملوكة لصاحبها، وتنزيلُها قرار المالك. الدليل يعرف أين يجلس الأصل إن وصل وبس.
  assert.equal(logoAssetPath('bank', 'test_rajhi'), 'app/static/master-data/bank/test_rajhi.svg');
  assert.equal(logoAssetPath('bank', '../../etc/passwd'), null);
  assert.equal(logoAssetPath('country', 'zz_test'), 'app/static/master-data/country/zz_test.svg');
});

// ‏**الاختبارات أدناه من جولة 30 سبتمبر 2026**، وكلها على الآلة لا على محتوى قائمة بعينها: النطاق،
// وحارس القيم، والمحمّل. وكل صف فيها مصطنع كما في ما سبق.

test('نطاق البعثات: الدليل للمعتمدة لدى المملكة وحدها، والنطاق في البنية لا في تعليق', () => {
  const { db, actor } = fresh();

  // (1) العمود موجود بقيمة واحدة مسموحة، والصف يخرج موسومًا بنوعه بلا أن يطلب أحدٌ ذلك.
  const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all('diplomatic_missions').map(row => row.name);
  assert.ok(columns.includes('accreditation'), 'عمود النطاق ما هو موجود، فالجدول يقبل النوعين');
  const mission = recordEntity(db, actor, 'mission', {
    id: 'mission_scope_probe', country_id: 'zz_test', mission_type: 'embassy', city_ar: 'الرياض', city_en: 'Riyadh',
    name_ar: 'سفارة دولة الاختبار المصطنعة', name_en: 'Embassy of Test Country', source_authority: SYNTHETIC,
  });
  assert.equal(mission.accreditation, MISSION_ACCREDITATION);
  // وقيمة ثانية ما تُقبل من القاعدة: القيمتان المفتوحتان هما الخليط نفسه.
  assert.throws(() => db.prepare("UPDATE diplomatic_missions SET accreditation='saudi_mission_abroad' WHERE id='mission_scope_probe'").run(), /constraint/i);
  // والطبقة ترفض من يحاول اختيار النوع، وتقول له أيّ دليلٍ يقصد بدل «حقل غير معروف».
  assert.equal(thrown(() => recordEntity(db, actor, 'mission', {
    id: 'mission_pick_kind', country_id: 'zz_test', mission_type: 'embassy', city_ar: 'جدة', city_en: 'Jeddah',
    name_ar: 'قنصلية مصطنعة', name_en: 'Synthetic Consulate', source_authority: SYNTHETIC, accreditation: 'saudi_mission_abroad',
  })).code, 'master_data_mission_scope');

  // (2) دولةٌ مُرسِلةٌ رمزها SA تعني بعثةً للمملكة في الخارج: مرفوضة في الطبقة وفي القاعدة معًا.
  // (الصف أدناه مصطنع، ولا يُقرأ على أنه تسجيلٌ للمملكة في الدليل: سلطته تقول إنه للاختبار.)
  recordEntity(db, actor, 'country', {
    id: 'sa_test_probe', iso2: 'SA', iso3: 'QQQ', name_ar: 'دولة اختبار برمز المملكة',
    name_en: 'Kingdom-coded test country', source_authority: SYNTHETIC,
  });
  const refused = thrown(() => recordEntity(db, actor, 'mission', {
    id: 'mission_outbound', country_id: 'sa_test_probe', mission_type: 'embassy', city_ar: 'طوكيو', city_en: 'Tokyo',
    name_ar: 'سفارة مصطنعة في الخارج', name_en: 'Synthetic outbound embassy', source_authority: SYNTHETIC,
  }));
  assert.equal(refused.code, 'master_data_mission_scope');
  assert.match(refused.message, /المملكة/);
  // والقاعدة أرضية لا واجهة: الإدخال المباشر يُرفض كذلك، فلا يدخل من سكربت ما مُنع من الطبقة.
  assert.throws(() => db.prepare(`INSERT INTO diplomatic_missions(id,country_id,mission_type,city_ar,city_en,name_ar,name_en,source_authority,created_at)
    VALUES('mission_sql','sa_test_probe','embassy','طوكيو','Tokyo','سفارة مصطنعة','Synthetic','x','2026-09-30')`).run(),
    /accredited to the Kingdom/);
  assert.equal(verifyAudit(db), true);
});

test('حارس العبارات: المصدر ينشر الحالة التشغيلية، والدليل ما ينقلها معه', () => {
  const { db, actor } = fresh();

  // العبارة تجي داخل **قيمة** لا في اسم حقل، فحارس المفاتيح ما يمسكها وحده. وهكذا تكتبها ساما فعلًا.
  const refused = thrown(() => recordEntity(db, actor, 'bank', {
    id: 'phrase_probe', name_ar: 'بنك مصطنع', name_en: 'Synthetic Bank (Not yet operational)',
    source_authority: SYNTHETIC,
  }));
  assert.equal(refused.code, 'master_data_no_operational_status');
  assert.match(refused.message, /not yet operational/i);
  assert.equal(listBanks(db).length, 0);
  // وبالعربية كذلك، وفي التصنيف لا في الاسم وحده.
  assert.equal(thrown(() => recordEntity(db, actor, 'bank', {
    id: 'phrase_probe_ar', name_ar: 'بنك مصطنع ثانٍ', name_en: 'Second Synthetic Bank',
    source_category: 'فروع البنوك الأجنبية (لم يبدأ النشاط)', source_authority: SYNTHETIC,
  })).code, 'master_data_no_operational_status');
  // وتُرفض في المقترح كذلك.
  recordEntity(db, actor, 'bank', { id: 'clean_bank', name_ar: 'بنك مصطنع نظيف', name_en: 'Clean Synthetic Bank', source_authority: SYNTHETIC });
  assert.equal(thrown(() => proposeSourceChange(db, actor, {
    kind: 'bank', entity_id: 'clean_bank', proposed: { short_name: 'مصطنع — لم يباشر' },
    source_authority: SYNTHETIC, source_fetched_at: '2026-09-30', reason: 'محاولة تمرير العبارة في قيمة',
  })).code, 'master_data_no_operational_status');

  // والقاعدة أرضية: الإدخال المباشر يسقط على قيد CHECK، فلا تدخل العبارة من سكربت.
  assert.throws(() => db.prepare(`INSERT INTO banks(id,name_ar,name_en,source_authority,created_at)
    VALUES('sql_phrase','بنك','Bank (Not yet operational)','x','2026-09-30')`).run(), /constraint/i);

  // وقائمة العبارات واحدة في الطبقة والقاعدة: حارسان بقائمتين تفترقان أسوأ من حارس واحد.
  const migration = readFileSync(new URL('../app/migrations/159-master-data-scope-and-source-fields.sql', import.meta.url), 'utf8');
  for (const phrase of OPERATIONAL_STATUS_PHRASES) {
    assert.ok(migration.includes(phrase), `العبارة «${phrase}» في الطبقة وما هي في الترحيل 159 — الحارسان افترقا`);
  }
});

test('البنك يُسجَّل بلا دولة، والرقم غير المنشور يبقى فاضيًا ولا يصير شرطة', () => {
  const { db, actor } = fresh();
  // ساما ما تنشر موطن البنك، فالعمود اختياري: الإلزام كان يُجبر المستورد على اختراع دولة.
  const recorded = recordEntity(db, actor, 'bank', {
    id: 'no_country_bank', name_ar: 'بنك مصطنع بلا دولة', name_en: 'Countryless Synthetic Bank',
    unified_number: '7000000001', commercial_registration: '1010000001', source_category: 'تصنيف مصطنع',
    source_authority: SYNTHETIC,
  });
  assert.equal(recorded.country_id, null);
  assert.equal(recorded.unified_number, '7000000001');
  assert.equal(recorded.verification, 'unverified');

  // والرقمان فريدان حين يُورَّدان.
  assert.throws(() => recordEntity(db, actor, 'bank', {
    id: 'dup_unified', name_ar: 'بنك مكرر', name_en: 'Duplicate Bank', unified_number: '7000000001', source_authority: SYNTHETIC,
  }), /UNIQUE|constraint/i);
  assert.throws(() => recordEntity(db, actor, 'bank', {
    id: 'dup_cr', name_ar: 'بنك مكرر ثانٍ', name_en: 'Second Duplicate', commercial_registration: '1010000001', source_authority: SYNTHETIC,
  }), /UNIQUE|constraint/i);

  // ويُبحث بالرقم كما يُبحث بالاسم: الموظف يمسك ورقة من البنك فيها رقم ويكتبه كما هو.
  assert.equal(searchMasterData(db, '7000000001', { kinds: ['bank'] })[0]?.id, 'no_country_bank');
  assert.equal(searchMasterData(db, '1010000001', { kinds: ['bank'] })[0]?.matched_on, 'رقم السجل التجاري');
});

// المحمّل يُختبر على ملف مصطنع يُكتب في مجلد مؤقت: الملف الحقيقي محتواه بيانات مصدر رسمي، وما يُختبر
// هنا هو الآلة — الترويسة والسند والشرطة والجولة الجافة.
function sourceFileAt(directory, body) {
  const path = join(directory, 'synthetic-source.json');
  writeFileSync(path, JSON.stringify(body), 'utf8');
  return path;
}

test('المحمّل: ما يحمّل ملفًا بلا سند، ويكتب الصفوف غير مطابَقة، والجولة الجافة ما تكتب شي', () => {
  const { db, actor } = fresh();
  const directory = mkdtempSync(join(tmpdir(), 'master-data-'));
  const header = { kind: 'bank', authority_ar: SYNTHETIC, page_url: 'https://example.invalid/synthetic-list', read_at: '2026-09-30T12:52:00Z' };
  const rows = [
    { id: 'src_one', source_key: '1', name_ar: 'بنك مصطنع أول', name_en: 'First Synthetic Bank', unified_number: '7000000101', commercial_registration: '1010000101', source_category: 'تصنيف مصطنع' },
    { id: 'src_two', source_key: '2', name_ar: 'بنك مصطنع ثاني', name_en: 'Second Synthetic Bank', unified_number: '-', commercial_registration: '-', source_category: 'تصنيف مصطنع' },
    { id: 'src_three', source_key: '3', name_ar: 'بنك مصطنع ثالث', name_en: 'Third Synthetic Bank', unified_number: '-', commercial_registration: '-', source_category: 'تصنيف مصطنع' },
  ];

  // (1) ترويسة ناقصة: ما يُحمَّل شي، ويُقال ما الناقص بالاسم.
  const headless = thrown(() => loadSourceFile(db, actor, sourceFileAt(directory, { source: { kind: 'bank' }, rows })));
  assert.equal(headless.code, 'master_data_source_file_incomplete');
  assert.match(headless.message, /سند|سلطة المصدر|ما يُحمَّل/);
  assert.equal(listBanks(db).length, 0);

  // (2) صفٌّ ناقص السند: يسقط الملف كله ولا يُكتب نصفه — النصف المكتوب يُقرأ بعدها على أنه القائمة.
  const broken = thrown(() => loadSourceFile(db, actor, sourceFileAt(directory, { source: header, rows: [...rows, { id: 'src_bad', source_key: '4', name_ar: 'بنك بلا اسم إنجليزي' }] })));
  assert.equal(broken.code, 'master_data_source_rows_unsupported');
  assert.equal(listBanks(db).length, 0);

  // (3) الجولة الجافة: تقول كم سيُحمَّل وما تكتب صفًا.
  const path = sourceFileAt(directory, { source: header, rows });
  const dry = loadSourceFile(db, actor, path, { dry: true });
  assert.equal(dry.would_load, 3);
  assert.equal(dry.dry, true);
  assert.equal(listBanks(db).length, 0);

  // (4) التحميل: كل صف يدخل غير مطابَق، وسلطته من ترويسة الملف لا من ظنّ المحمّل.
  const report = loadSourceFile(db, actor, path);
  assert.equal(report.loaded, 3);
  assert.equal(report.authority, SYNTHETIC);
  assert.equal(report.read_at, '2026-09-30T12:52:00Z');
  assert.equal(listBanks(db).length, 3);
  for (const row of listBanks(db)) {
    assert.equal(row.verification, 'unverified', 'ما يصير صف «مطابَقًا» لأن محمّلًا أدخله');
    assert.equal(row.source_authority, SYNTHETIC);
    assert.equal(row.source_url, header.page_url);
  }
  // والشرطة صارت فراغًا: صفّان بلا رقم منشور يدخلان معًا، ولو بقيت شرطةً لاصطدما في الفهرس الفريد.
  assert.equal(bank(db, 'src_two').unified_number, '');
  assert.equal(bank(db, 'src_three').commercial_registration, '');

  // (5) إعادة التحميل ما تكرر ولا تسقط: الموجود يُعدّ موجودًا ويُقال.
  const again = loadSourceFile(db, actor, path);
  assert.equal(again.loaded, 0);
  assert.equal(again.already_present, 3);
  assert.equal(listBanks(db).length, 3);
  assert.equal(verifyAudit(db), true);
});

test('الشاشة الفاضية تقول ما ينقص ومن يملكه، ولكل نوع جملته', () => {
  const db = openDb(':memory:');
  const state = directoryState(db);
  assert.equal(state.bank.empty_text.title, 'ما وصل دليل البنوك بعد');
  assert.match(state.bank.empty_text.authority, /البنك المركزي السعودي/);
  // وجملة السفارات تقول النطاق نفسه الذي حسمه المالك، فلا يظن القارئ أن سفارات المملكة في الخارج ناقصة.
  assert.match(state.mission.empty_text.what, /المعتمدة لدى المملكة/);
  for (const kind of ['bank', 'mission', 'country']) {
    // العنوان سطر قصير بقصد («ما وصل دليل البنوك بعد»)، والشرح هو الذي يقول ما ينقص ومن يملكه.
    assert.ok(state[kind].empty_text.title.length > 12, `${kind}.title أقصر من أن تقول شيئًا`);
    // والجهة اسمٌ لا جملة، فيكفي أن تكون جهةً مسمّاة لا كلمةً واحدة مبهمة.
    assert.ok(state[kind].empty_text.authority.length > 12, `${kind}.authority ما تسمّي جهة`);
    for (const field of ['what', 'next']) {
      assert.ok(state[kind].empty_text[field].length > 25, `${kind}.${field} قصيرة — الجملة القصيرة ما تقول شيئًا`);
    }
    assert.doesNotMatch(JSON.stringify(state[kind].empty_text), /\.md|docs\/|app\//, `${kind}: مسار ملف في نص الشاشة`);
  }
  assert.deepEqual(DIRECTORY_EMPTY.bank, state.bank.empty_text);

  // وحين يمتلئ نوع، يختفي نصّه: القائمة الممتلئة تعرض نفسها ولا تعتذر.
  const { db: filled, actor } = fresh();
  assert.equal(directoryState(filled).country.empty_text, null);
  assert.equal(directoryState(filled).bank.empty_text.title, 'ما وصل دليل البنوك بعد');
  assert.ok(actor.id);
});
