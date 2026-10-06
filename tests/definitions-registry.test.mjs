import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { grantAccess } from '../app/access.mjs';
import { pricingBoard, quotationAction } from '../app/pricing.mjs';
import { pipelineBoard } from '../app/pipeline-estimates.mjs';
import { clientsBoard } from '../app/agency.mjs';
import { saveDraft, discardDraft, submitDraft, publishDraft, rollbackTo, history, verifyChain, liveDefinition, editorPayload, definitionsIndex, awaitingPublisher,
  snapshotFor, diffSpecs, classifyChange, validateSpec, entityFor, labelOf, entityLabel, statusLabel, glossary, applyTerms, term, specDigest, rowDigest,
  namesIdentityDocument, registerEntity, cachedDefinitions, TONES } from '../app/definitions.mjs';
import { saveValues, exportRows, columnsFor } from '../app/custom-fields.mjs';
import { NO_NATIONAL_ID } from '../app/pii.mjs';
import { BANNED_STATUS_PHRASES } from '../app/static/vocabulary.mjs';
import { fixture, usersOf, grantAll, approvedSheet, code, caught, riyadh, LEAD_SOURCE, GOVERNING_SPEC, MASKED_NOTE, workbookText } from './definitions-fixture.mjs';

// بيانات تجريبية مصطنعة بالكامل. سجل التعريفات (ترحيل 123): طبقة فوق الكود، نسخ إلحاقية، والساري أعلى نسخة.
const ENTITY='client_quotation';
const draftVersion=(db,entity=ENTITY)=>db.prepare("SELECT row_version FROM definition_drafts WHERE tenant_id='36t' AND entity_key=?").get(entity)?.row_version;

test('migration 123: a database built before it upgrades in place — every client, opportunity and quotation survives with empty custom fields, and its triggers still hold',t=>{
  const directory=mkdtempSync(join(tmpdir(),'36t-registry-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'local.sqlite'),read=name=>readFileSync(new URL(`../app/${name}`,import.meta.url),'utf8');
  // القاعدة كما كانت قبل 123: المخطط ثم كل ترحيل دونه، مسجلةً ببصماتها كما يسجّلها openDb.
  const old=new DatabaseSync(path);old.exec('PRAGMA foreign_keys=ON;');
  old.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
  old.exec(read('schema.sql'));old.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(hash(read('schema.sql')));
  for(const file of readdirSync(new URL('../app/migrations/',import.meta.url)).filter(f=>/^\d{3}-.+\.sql$/.test(f)&&Number(f.slice(0,3))<123).sort()){
    old.exec(read(`migrations/${file}`));old.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(Number(file.slice(0,3)),hash(read(`migrations/${file}`)));
  }
  assert.equal(old.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('client_quotations') WHERE name='custom_fields'").get().n,0,'قبل 123 لا عمود');
  seed(old,'synthetic-upgrade');const users=usersOf(old);grantAll(old,users);
  // وحدات العمل تكتب العمود الجديد الآن، فسجلات ما قبل الترحيل تُزرع بـSQL خام كما كانت تُكتب قبله.
  const time='2026-09-01T08:00:00.000Z';
  old.prepare("INSERT INTO clients(id,tenant_id,code,legal_name,trade_name,sector,status,owner_id,notes,created_at,updated_at) VALUES('c-old','36t','C-0001','شركة تجريبية قديمة','','التجزئة','active','employee','',?,?)").run(time,time);
  for(const member of ['manager','outsider'])old.prepare("INSERT INTO client_members(client_id,user_id,role,added_by,added_at) VALUES('c-old',?,'عضو تجريبي','employee',?)").run(member,time);
  old.prepare("INSERT INTO opportunities(id,tenant_id,client_id,name,service_family,value_minor,stage_code,owner_id,status,last_activity_on,created_at,updated_at) VALUES('o-old','36t','c-old','فرصة تجريبية قديمة','campaigns',5000000,'LEAD','employee','open','2026-09-01',?,?)").run(time,time);
  const sheet=approvedSheet(old,users,'c-old');
  old.prepare("INSERT INTO client_quotations(id,tenant_id,client_id,sheet_id,code,status,created_by,created_at,updated_at) VALUES('q-old','36t','c-old',?,'QT-0001','draft','employee',?,?)").run(sheet,time,time);
  const snapshot=db=>JSON.stringify(['clients','opportunities','client_quotations'].map(table=>db.prepare(`SELECT id,tenant_id,version,created_at FROM ${table} ORDER BY id`).all()));
  const before=snapshot(old);old.close();

  const db=openDb(path);t.after(()=>db.close());
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version=123').get(),'openDb طبّق 123');
  assert.equal(snapshot(db),before,'لا صف تغيّر ولا نسخة تقدّمت');
  for(const table of ['clients','opportunities','client_quotations'])assert.deepEqual(db.prepare(`SELECT DISTINCT custom_fields FROM ${table}`).all().map(r=>r.custom_fields),['{}'],`${table}: القيم المخصّصة تبدأ كائنًا فارغًا`);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM definition_versions").get().n,0,'لا بذرة: النسخة 0 افتراضات الكود، ولا قيمة نظامية مزروعة');
  // الزنادان القائمان يحكمان العمود الجديد: لا كتابة بلا تقدّم النسخة، ولا JSON فاسد، ولا مصفوفة مكان الكائن.
  assert.throws(()=>db.prepare("UPDATE client_quotations SET custom_fields='{\"a\":\"b\"}' WHERE id='q-old'").run(),/final|version/i);
  assert.throws(()=>db.prepare("UPDATE opportunities SET custom_fields='{\"a\":\"b\"}' WHERE id='o-old'").run(),/ABORT|final|version|stale/i);
  assert.throws(()=>db.prepare("UPDATE clients SET custom_fields='not json' WHERE id='c-old'").run(),/CHECK/);
  assert.throws(()=>db.prepare("UPDATE clients SET custom_fields='[1]' WHERE id='c-old'").run(),/CHECK/);
  // وسجل قديم يُعدَّل بالتعريف الجديد كأي سجل: حقل يُنشر اليوم يُملأ في عرض أُنشئ قبل الترحيل.
  const tx=f=>transaction(db,f),fresh=usersOf(db);
  const draft=tx(()=>saveDraft(db,fresh.employee,ENTITY,{spec:{fields:[LEAD_SOURCE]}}));
  tx(()=>publishDraft(db,fresh.employee,ENTITY,{row_version:draft.row_version,note:'أول تعريف بعد الترقية'}));
  assert.deepEqual(tx(()=>saveValues(db,fresh.employee,ENTITY,'q-old',{version:1,values:{lead_source:'event'}})).changed,['lead_source']);
  assert.equal(db.prepare("SELECT json_extract(custom_fields,'$.lead_source') AS v,version FROM client_quotations WHERE id='q-old'").get().v,'event');
  // التشغيل الثاني لا يعيد تطبيق شيء.
  const checksums=JSON.stringify(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all());
  const again=openDb(path);assert.equal(JSON.stringify(again.prepare('SELECT * FROM schema_migrations ORDER BY version').all()),checksums);again.close();
});

test('registry: an unpublished draft appears nowhere — not in the payload, the list, the export or a colleague’s snapshot — and the server refuses a value for a field that was never published',t=>{
  const {db,users,tx,quote,quotationRow}=fixture(t);
  const draft=tx(()=>saveDraft(db,users.employee,ENTITY,{spec:GOVERNING_SPEC}));
  assert.equal(draft.base_version,0);assert.equal(draft.change_class,'tightening','إلزام جديد عند انتقال تشديد');
  assert.equal(liveDefinition(db,'36t',ENTITY),null,'المسودة ليست نسخة');
  const q=pricingBoard(db,users.employee).quotations[0];
  assert.deepEqual(q.custom,[]);assert.deepEqual(q.custom_fields,{});
  assert.equal(q.status_name,'مسودة لم تُصدر','عبارة الحالة من الكود ما دام لا تعريف منشور');
  assert.deepEqual(columnsFor(db,users.employee,ENTITY),[]);
  assert.ok(!exportRows(db,users.employee,ENTITY).columns.includes('مصدر الفرصة'));
  // المعاينة لمعدّ المسودة وحده، وبلافتتها؛ زميله يطلب المعاينة فيرى المنشور.
  const mine=snapshotFor(db,users.employee,{preview:true}),theirs=snapshotFor(db,users.manager,{preview:true});
  assert.equal(mine.preview,true);assert.equal(mine.preview_note,'معاينة مسودة — لا يراها غيرك');
  assert.deepEqual(mine.entities[ENTITY].fields.map(f=>f.key),['lead_source']);
  assert.equal(theirs.preview,false);assert.deepEqual(theirs.entities[ENTITY].fields,[]);
  assert.deepEqual(snapshotFor(db,users.employee).entities[ENTITY].fields,[],'بلا preview يرى المعدّ نفسه المنشور');
  // الخادم لا يفرض مسودة على أحد: الإصدار يمر بلا الحقل، وقيمة لحقل غير منشور تُرفض.
  const refused=caught(()=>tx(()=>saveValues(db,users.employee,ENTITY,quote,{version:quotationRow().version,values:{lead_source:'event'}})));
  assert.equal(refused.code,'unknown_custom_field');assert.match(refused.message,/لم يُنشر/);
  tx(()=>quotationAction(db,users.employee,quote,'issue',{version:quotationRow().version,note:''}));
  assert.equal(quotationRow().status,'issued','مسودة تُلزم حقلًا لا توقف إصدارًا');
  // مسودة واحدة لكل صفحة، باسم معدّها؛ والتخلي عنها حدث في سلسلة التدقيق.
  assert.throws(()=>tx(()=>saveDraft(db,users.manager,ENTITY,{spec:{fields:[LEAD_SOURCE]}})),code('draft_owned'));
  assert.throws(()=>tx(()=>saveDraft(db,users.employee,ENTITY,{spec:GOVERNING_SPEC,row_version:99})),code('stale_version'));
  tx(()=>discardDraft(db,users.employee,ENTITY,{note:'تجربة'}));
  assert.equal(draftVersion(db),undefined);
  assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE action='definition.draft_discarded'").get());
  assert.ok(verifyAudit(db));
});

test('registry: a published field appears in the pilot entity’s payload, its list columns and its export, with «غير متاح» and a reason where no value was entered',t=>{
  const {db,users,tx,publish,quote,quotationRow}=fixture(t);
  const result=publish(ENTITY,GOVERNING_SPEC);
  assert.equal(result.version,1);assert.equal(result.origin,'editor');assert.equal(result.change_class,'tightening');
  const q=pricingBoard(db,users.employee).quotations[0],[item]=q.custom;
  assert.equal(item.label,'مصدر الفرصة');assert.equal(item.slot,'header');assert.equal(item.kind,'unavailable');assert.equal(item.text,'غير متاح');
  assert.equal(item.value,null,'الفراغ لا يحمل قيمة ولا صفرًا');assert.equal(item.reason,'لم يُدخل بعد');
  assert.match(item.needed,/معدّ العرض/);assert.match(item.owner,/تسعير المشاريع/);
  assert.equal(q.definition_version,1);
  assert.deepEqual(columnsFor(db,users.employee,ENTITY).map(c=>[c.key,c.label,c.filter,c.options.length]),[['cf:lead_source','مصدر الفرصة',true,3]]);
  tx(()=>saveValues(db,users.employee,ENTITY,quote,{version:quotationRow().version,values:{lead_source:'referral'}}));
  const filled=pricingBoard(db,users.employee).quotations[0].custom[0];
  assert.deepEqual([filled.kind,filled.value,filled.text,filled.tone,filled.source],['recorded','referral','إحالة من عميل',TONES.positive,'تعريف الصفحة، النسخة 1']);
  const file=exportRows(db,users.employee,ENTITY),cells=workbookText(file.content);
  assert.deepEqual(file.columns.slice(-1),['مصدر الفرصة']);assert.ok(cells.includes('إحالة من عميل'));assert.ok(cells.includes('QT-0001'));
  // عبارة الحالة تجاوز منشور فوق عبارة الكود، بلا سطر كود: «صدر للعميل» تصير «مُرسل».
  assert.equal(statusLabel(db,'36t',ENTITY,'issued','صدر للعميل'),'مُرسل');assert.equal(statusLabel(db,'36t',ENTITY,'draft','مسودة لم تُصدر'),'مسودة لم تُصدر');
  // الحدث في سلسلة التدقيق ببصمتي قبل وبعد والفرق.
  const event=db.prepare("SELECT * FROM audit_events WHERE action='definition.published'").get(),after=JSON.parse(event.after_json);
  assert.equal(JSON.parse(event.before_json).version,0);assert.equal(after.version,1);assert.equal(after.digest,result.digest);assert.ok(after.diff.items.some(i=>i.kind==='require_added'));
  assert.ok(verifyAudit(db));assert.ok(verifyChain(db,'36t',ENTITY));
});

test('registry: rollback publishes a new version whose document equals the older one exactly, history stays linear, and version 0 is the code’s own defaults',t=>{
  const {db,users,tx,publish}=fixture(t);
  const v1=publish(ENTITY,{fields:[LEAD_SOURCE],layout:{slots:{header:['lead_source']}}});
  const second={...LEAD_SOURCE,label:{ar:'قناة الفرصة'}};
  const v2=publish(ENTITY,{fields:[second,{key:'campaign_code',label:{ar:'رمز الحملة'},type:'text',required:false,max_length:20}],layout:{slots:{header:['lead_source'],body:['campaign_code']}},views:{list:{columns:['campaign_code']}}});
  assert.notEqual(v1.spec_digest,v2.spec_digest);
  const back=tx(()=>rollbackTo(db,users.employee,ENTITY,{to_version:1,note:'العودة إلى التعريف الأول'}));
  assert.equal(back.published,true);assert.equal(back.version,3);assert.equal(back.origin,'rollback');
  assert.equal(back.spec_digest,v1.spec_digest,'وثيقة النسخة 3 هي وثيقة النسخة 1 بالحرف');
  assert.notEqual(back.digest,v1.digest,'وبصمة الصف غيرها: الحلقة الثالثة في السلسلة');
  const rows=history(db,users.employee,ENTITY);
  assert.deepEqual(rows.map(r=>[r.version,r.state,r.origin,r.origin_ref]),[[3,'published','rollback','v1'],[2,'superseded','editor',null],[1,'superseded','editor',null]]);
  assert.deepEqual(JSON.parse(db.prepare('SELECT spec FROM definition_versions WHERE version=3').get().spec),JSON.parse(db.prepare('SELECT spec FROM definition_versions WHERE version=1').get().spec));
  assert.deepEqual(liveDefinition(db,'36t',ENTITY).spec.fields.map(f=>[f.key,f.label.ar]),[['lead_source','مصدر الفرصة']]);
  assert.ok(back.diff.some(i=>i.kind==='field_removed'&&i.key==='campaign_code'));
  assert.throws(()=>tx(()=>rollbackTo(db,users.employee,ENTITY,{to_version:3,note:'لا شيء يُسترجع'})),code('not_found'));
  assert.throws(()=>tx(()=>rollbackTo(db,users.employee,ENTITY,{to_version:1,note:'النسخة نفسها'})),code('nothing_to_publish'));
  assert.throws(()=>tx(()=>rollbackTo(db,users.employee,ENTITY,{to_version:2,note:'x'})),code('note_required'));
  // الاسترجاع إلى 0: وثيقة فارغة، فتعود الصفحة كما كتبها الكود.
  const zero=tx(()=>rollbackTo(db,users.employee,ENTITY,{to_version:0,note:'العودة إلى افتراضات الكود'}));
  assert.equal(zero.spec_digest,specDigest({}));assert.deepEqual(pricingBoard(db,users.employee).quotations[0].custom,[]);
  assert.ok(verifyChain(db,'36t',ENTITY));assert.ok(verifyAudit(db));
});

test('registry: published definitions are append-only in the database itself — no update, no delete, consecutive versions, an unbroken digest chain',t=>{
  const {db,publish}=fixture(t,{quotation:false});
  publish(ENTITY,{fields:[LEAD_SOURCE]});
  const row=db.prepare('SELECT * FROM definition_versions').get();
  assert.throws(()=>db.prepare("UPDATE definition_versions SET note='أعيدت كتابته' WHERE id=?").run(row.id),/not rewritten/);
  assert.throws(()=>db.prepare('DELETE FROM definition_versions WHERE id=?').run(row.id),/retained/);
  const insert=(version,previous,{prepared='employee',published='employee',change='additive'}={})=>db.prepare(`INSERT INTO definition_versions(id,tenant_id,entity_key,version,spec,digest,previous_digest,change_class,change_summary,origin,prepared_by,published_by,note,created_at)
    VALUES(?,?,?,?,'{}',?,?,?,'{}','editor',?,?,'إدراج مباشر تجريبي','2026-09-21T00:00:00.000Z')`).run(`direct-${version}-${change}`,'36t',ENTITY,version,rowDigest(ENTITY,version,previous,{}),previous,change,prepared,published);
  assert.throws(()=>insert(3,''),/consecutive/,'لا قفز فوق نسخة');
  assert.throws(()=>insert(3,row.digest),/consecutive|chain is broken/);
  assert.throws(()=>insert(1,''),/consecutive|UNIQUE/,'ولا إعادة نسخة قائمة');
  assert.throws(()=>insert(2,'0'.repeat(64)),/chain is broken/,'بصمة سابقة لا تطابق السارية تكسر السلسلة');
  // القيد على الصف نفسه: تخفيف أعدّه ونشره شخص واحد ترفضه القاعدة ولو تجاوز أحدٌ الوحدة.
  assert.throws(()=>insert(2,row.digest,{change:'loosening'}),/CHECK/);
  insert(2,row.digest,{change:'loosening',published:'manager'});
  assert.ok(verifyChain(db,'36t',ENTITY));
  // كيان آخر سلسلته مستقلة وتبدأ من 1.
  publish('client',{fields:[{key:'segment',label:{ar:'شريحة العميل'},type:'text',required:false}]});
  assert.equal(liveDefinition(db,'36t','client').version,1);
});

test('registry: the server classifies every diff — a control is tightened by one person and never loosened by one person',t=>{
  const {db,users,tx,publish}=fixture(t,{quotation:false});
  publish(ENTITY,{fields:[LEAD_SOURCE,MASKED_NOTE],transitions:{issue:{require:['lead_source']}}});
  const live=liveDefinition(db,'36t',ENTITY).spec,classed=spec=>classifyChange(diffSpecs(live,validateSpec(spec,entityFor(ENTITY))));
  const base={fields:[LEAD_SOURCE,MASKED_NOTE],transitions:{issue:{require:['lead_source']}}};
  assert.equal(classed({...base,fields:[{...LEAD_SOURCE,label:{ar:'قناة الفرصة'}},MASKED_NOTE]}),'additive','تسمية');
  assert.equal(classed({...base,layout:{slots:{body:['lead_source']}},views:{list:{columns:['lead_source']}}}),'additive','موضع وعمود');
  assert.equal(classed({...base,transitions:{issue:{require:['lead_source']},accept:{require:['lead_source']}}}),'tightening','إلزام جديد عند انتقال');
  assert.equal(classed({...base,fields:[{...LEAD_SOURCE,required:true},MASKED_NOTE]}),'tightening','إلزام عام');
  assert.equal(classed({...base,fields:[LEAD_SOURCE,{...MASKED_NOTE,visible_to:['profitability.view'],editable_by:['profitability.view']}]}),'tightening','تضييق من يعدّل');
  assert.equal(classed({fields:[LEAD_SOURCE,MASKED_NOTE]}),'loosening','رفع إلزام عند انتقال');
  assert.equal(classed({...base,fields:[LEAD_SOURCE,{...MASKED_NOTE,visible_to:undefined}]}),'loosening','رفع الحجب');
  assert.equal(classed({...base,fields:[LEAD_SOURCE,{...MASKED_NOTE,visible_to:['profitability.view','finance.use']}]}),'loosening','توسيع الحجب');
  assert.equal(classed({...base,fields:[LEAD_SOURCE,{...MASKED_NOTE,tracked:false}]}),'loosening','إيقاف تتبّع التغيّر');

  // تخفيف يُعدّه حامل النشر نفسه: الخادم يرفض أن ينشره، ويسمّي ما خُفّف ومن ينشره.
  const draft=tx(()=>saveDraft(db,users.employee,ENTITY,{spec:{fields:[LEAD_SOURCE,MASKED_NOTE]}}));
  assert.equal(draft.needs_second_publisher,true);
  const refused=caught(()=>tx(()=>publishDraft(db,users.employee,ENTITY,{row_version:draft.row_version,note:'رفع الإلزام وحدي'})));
  assert.equal(refused.code,'second_publisher_required');assert.equal(refused.status,409);
  assert.match(refused.details.refusal.missing[0].document,/رفع الإلزام عند انتقال: مصدر الفرصة/);assert.match(refused.details.refusal.missing[0].owner,/مدير الفريق التجريبي/);
  assert.equal(liveDefinition(db,'36t',ENTITY).version,1,'لم يُنشر شيء');
  // يسلّمها، فتظهر فيما ينتظر قرار الناشر الثاني وحده، فينشرها: شخصان على الصف.
  const submitted=tx(()=>submitDraft(db,users.employee,ENTITY,{row_version:draft.row_version}));
  assert.deepEqual(submitted.publishers,['مدير الفريق التجريبي']);
  assert.deepEqual(awaitingPublisher(db,users.employee),[],'لا ينتظر قرار من أعدّها');
  const [waiting]=awaitingPublisher(db,users.manager);
  assert.equal(waiting.entity_key,ENTITY);assert.equal(waiting.change_class,'loosening');assert.deepEqual(waiting.actions,['publish_definition']);
  const done=tx(()=>publishDraft(db,users.manager,ENTITY,{row_version:waiting.row_version,note:'اعتماد رفع الإلزام بعد مراجعته'}));
  assert.equal(done.change_class,'loosening');
  const [top]=history(db,users.manager,ENTITY);
  assert.deepEqual([top.prepared_by,top.published_by,top.two_person],['employee','manager',true]);
  assert.equal(draftVersion(db),undefined,'النشر يمحو المسودة');
  // واسترجاعٌ يخفّف ضابطًا (يعيد نسخة بلا الإلزام… أو يرفع حجبًا) ينتظر ناشرًا ثانيًا أيضًا: القاعدة نفسها.
  publish(ENTITY,{fields:[LEAD_SOURCE,MASKED_NOTE],transitions:{issue:{require:['lead_source']}}},{by:users.manager});
  const held=tx(()=>rollbackTo(db,users.manager,ENTITY,{to_version:2,note:'استرجاع يرفع الإلزام'}));
  assert.equal(held.published,false);assert.equal(held.awaiting_second_publisher,true);assert.equal(liveDefinition(db,'36t',ENTITY).version,3);
  const [rollback]=awaitingPublisher(db,users.employee);
  const published=tx(()=>publishDraft(db,users.employee,ENTITY,{row_version:rollback.row_version,note:'اعتماد الاسترجاع'}));
  assert.equal(published.origin,'rollback');assert.equal(history(db,users.employee,ENTITY)[0].origin_ref,'v2');
  assert.ok(verifyChain(db,'36t',ENTITY));assert.ok(verifyAudit(db));
});

test('registry: who may configure and who may publish — the capability is named in the refusal, and the first admin does not hold the sensitive one by privilege alone',t=>{
  const {db,users,tx}=fixture(t,{quotation:false});
  // outsider يعمل على عروض الأسعار ولا يحمل تصريح التعريفات: الرفض يسمّي التصريح ومن يمنحه.
  const refused=caught(()=>tx(()=>saveDraft(db,users.outsider,ENTITY,{spec:{fields:[LEAD_SOURCE]}})));
  assert.equal(refused.status,403);assert.equal(refused.code,'not_permitted');
  assert.match(refused.details.refusal.missing[0].document,/definitions\.configure/);assert.match(refused.details.refusal.missing[0].owner,/الأدمن الأول/);
  assert.throws(()=>editorPayload(db,users.outsider,ENTITY),code('not_permitted'));
  assert.throws(()=>definitionsIndex(db,users.outsider),code('not_permitted'));
  // تصريح التعريفات بلا تصريح العمل على الكيان لا يكفي: hr لا تعمل على عروض الأسعار.
  tx(()=>grantAccess(db,users.admin,{user_id:'hr',capability:'definitions.configure',department_id:'',note:'منح تجريبي'}));
  const foreign=caught(()=>tx(()=>saveDraft(db,users.hr,ENTITY,{spec:{fields:[LEAD_SOURCE]}})));
  assert.equal(foreign.code,'not_permitted');assert.match(foreign.details.refusal.missing[0].document,/pricing\.sheets\.use/);
  // الأدمن الأول: يُعدّ (تصريح غير حساس) ولا ينشر بامتيازه وحده — النشر تصريح حساس يلزمه منح صريح مسجَّل.
  const draft=tx(()=>saveDraft(db,users.admin,ENTITY,{spec:{fields:[LEAD_SOURCE]}}));
  const admin=caught(()=>tx(()=>publishDraft(db,users.admin,ENTITY,{row_version:draft.row_version,note:'نشر بامتياز الأدمن'})));
  assert.equal(admin.code,'not_permitted');assert.match(admin.details.refusal.missing[0].document,/definitions\.publish/);
  assert.match(admin.details.refusal.missing[0].why,/تصريح حساس|يحمل تصريح/);
  tx(()=>publishDraft(db,users.manager,ENTITY,{row_version:draft.row_version,note:'نشر الناشر الحامل للتصريح'}));
  const payload=editorPayload(db,users.employee,ENTITY);
  assert.deepEqual(payload.can,{configure:true,publish:true,discard:false});
  // الحقول النظامية معكوسة من واصف الوحدة is_system:true — سجل واحد للحقول النظامية والمخصّصة بلا صف مزروع.
  assert.ok(payload.system_fields.every(f=>f.is_system));
  assert.deepEqual(payload.system_fields.filter(f=>!f.maskable).map(f=>f.key),['code','client_id','sheet_code','status','valid_until','net_pre_tax','grand_total']);
  assert.deepEqual(payload.system_fields.filter(f=>f.maskable).map(f=>f.key),['cost_margin']);
  assert.equal(payload.system_fields.find(f=>f.key==='client_id').inherits_from,'client');
  assert.deepEqual(payload.entity.transitions.map(x=>x.key),['issue','revise','accept','reject']);
  assert.match(payload.limits.layout,/لا تُحرَّك/);assert.match(payload.limits.translation,/الجمل/);
  assert.ok(!Object.keys(payload).includes('print_templates'),'لا شيء يُطبع في هذه المنصة');
  const index=definitionsIndex(db,users.employee);
  assert.deepEqual(index.entities.map(e=>[e.key,e.version]),[['client',0],['client_quotation',1],['opportunity',0],['platform',0]]);
  assert.equal(index.entities[0].state_name,'افتراضات الكود — لا تعريف منشور بعد');
});

test('registry: the platform’s refusal of national and iqama numbers stands inside the registry — a field that names one is refused at definition time',t=>{
  const {db,users,tx}=fixture(t,{quotation:false});
  const field=(label,key='free_text')=>({fields:[{key,label:typeof label==='string'?{ar:label}:label,type:'text',required:false}]});
  for(const label of ['رقم الهوية','رقم الهوية الوطنية','الهوية الوطنية','رقم الإقامة','بطاقة الإقامة','صورة الجواز','جواز السفر','الهوية','إقامة','رَقْم الهُوِيَّة']){
    const refused=caught(()=>tx(()=>saveDraft(db,users.employee,ENTITY,{spec:field(label)})));
    assert.equal(refused.code,'national_id_refused',label);assert.ok(refused.details.refusal.next.includes(NO_NATIONAL_ID),label);
  }
  for(const label of [{ar:'مرجع العميل',en:'National ID'},{ar:'مرجع العميل',en:'Iqama number'},{ar:'مرجع العميل',en:'Passport No'}])
    assert.throws(()=>tx(()=>saveDraft(db,users.employee,ENTITY,{spec:field(label)})),code('national_id_refused'),label.en);
  for(const key of ['national_id','client_iqama','passport_no_2'])assert.throws(()=>tx(()=>saveDraft(db,users.employee,ENTITY,{spec:field('مرجع',key)})),code('national_id_refused'),key);
  assert.throws(()=>tx(()=>saveDraft(db,users.employee,ENTITY,{spec:{fields:[{...LEAD_SOURCE,options:[{value:'a',label:{ar:'رقم الهوية'}}]}]}})),code('national_id_refused'),'اسم خيار');
  assert.throws(()=>tx(()=>saveDraft(db,users.employee,'client',{spec:{entity:{label:{ar:'صاحب رقم الإقامة'}}}})),code('national_id_refused'),'اسم كيان');
  // «الهوية البصرية» و«إقامة الفعالية» كلام يومي في وكالة تسويق: الحارس يرفض ما يسمّي الوثيقة، لا الكلمة داخل عبارة.
  for(const label of ['حالة الهوية البصرية','دليل هوية العلامة','تاريخ إقامة الفعالية','مكان الإقامة في الفعالية'])assert.equal(namesIdentityDocument(label),false,label);
  const ok=tx(()=>saveDraft(db,users.employee,ENTITY,{spec:{fields:[{key:'brand_identity',label:{ar:'حالة الهوية البصرية'},type:'text',required:false,help:'لا تكتب رقم الهوية هنا'}]}}));
  assert.equal(ok.spec.fields[0].help,'لا تكتب رقم الهوية هنا','نص المساعدة إرشاد لا اسم حقل');
});

test('registry: validateSpec refuses what would break a page — mask paradoxes, unknown capabilities, banned or duplicate status phrases, governed fields, and edits that lose recorded data',t=>{
  const {db,users,tx,publish}=fixture(t,{quotation:false});
  const save=spec=>tx(()=>saveDraft(db,users.employee,ENTITY,{spec,row_version:draftVersion(db)}));
  const spec=(what,input)=>{const e=caught(()=>save(input));assert.equal(e.code,'definition_spec',what);assert.ok(e.details.refusal.next,what+': الرفض يقول ما يُفعل');return e;};
  // مفارقات الحجب: إلزامي عند انتقال ولا يراه أو لا يعدّله من ينفّذه؛ مسحوب وما زال إلزاميًا؛ شرط ظهور يُقرأ من حقل محجوب.
  assert.match(spec('hidden',{fields:[MASKED_NOTE],transitions:{issue:{require:['internal_note']}}}).message,/ولا يراه من ينفّذه/);
  assert.match(spec('uneditable',{fields:[{...LEAD_SOURCE,editable_by:['finance.use']}],transitions:{issue:{require:['lead_source']}}}).message,/ولا يعدّله من ينفّذه/);
  save({fields:[{...LEAD_SOURCE,visible_to:['pricing.sheets.use']}],transitions:{issue:{require:['lead_source']}}});
  assert.match(spec('retired',{fields:[{...LEAD_SOURCE,retired:true}],transitions:{issue:{require:['lead_source']}}}).message,/مسحوب وما زال إلزاميًا/);
  assert.match(spec('condition',{fields:[{...LEAD_SOURCE,visible_to:['profitability.view']},{key:'event_name',label:{ar:'اسم الفعالية'},type:'text',required:false,show_when:{field:'lead_source',equals:['event']}}]}).message,/المحجوب/);
  // انتقال ينفّذه صاحب السجل بلا تصريح بعينه (تغيير حالة العميل): الحقل الملزَم عنده لا يُحجب.
  const owner=caught(()=>tx(()=>saveDraft(db,users.employee,'client',{spec:{fields:[{key:'pause_reason',label:{ar:'سبب التوقف'},type:'text',required:false,visible_to:['clients.manage']}],transitions:{set_status:{require:['pause_reason']}}}})));
  assert.match(owner.details.refusal.next,/صاحب السجل بلا تصريح/);
  assert.match(spec('capability',{fields:[{...LEAD_SOURCE,visible_to:['studio.configure']}]}).message,/تصريح غير معروف في هذه البيئة — studio\.configure/);
  assert.match(spec('unmaskable',{system:{status:{visible_to:['finance.use']}}}).message,/قابلة للحجب/);
  // السجل لا يضيف حالة ولا انتقالًا ولا نوع حقل، ولا قالب طباعة: الصيغة لا تعرف إلا أقسامها.
  assert.match(spec('status',{statuses:{archived:{label:{ar:'مؤرشف'}}}}).message,/مفاتيح غير معروفة/);
  assert.match(spec('transition',{transitions:{archive:{require:[]}}}).message,/مفاتيح غير معروفة/);
  assert.match(spec('type',{fields:[{key:'total',label:{ar:'الإجمالي'},type:'formula',required:false}]}).message,/نوع غير مدعوم/);
  assert.match(spec('print',{print_templates:[]}).message,/مفاتيح غير معروفة/);
  assert.match(spec('system key',{fields:[{key:'status',label:{ar:'الحالة الثانية'},type:'text',required:false}]}).message,/محجوز لحقل نظامي/);
  assert.match(spec('tone',{fields:[{...LEAD_SOURCE,options:[{value:'a',label:{ar:'أ'},tone:'#ff0000'}]}]}).message,/لوحة الهوية/);
  // عبارات الحالة: الممنوع في القاموس ممنوع هنا، وحالتان بعبارة واحدة لا تقولان شيئًا.
  assert.match(spec('banned',{statuses:{issued:{label:{ar:BANNED_STATUS_PHRASES[0]}}}}).message,/ممنوعة في القاموس/);
  assert.match(spec('duplicate',{statuses:{issued:{label:{ar:'مقبول'}}}}).message,/بالعبارة نفسها/);
  // قيمة تحكمها لائحة مقفلة في المحرّر: تُعدَّل من سياسات الموارد البشرية باعتماد شخصين، لا من هنا. (كيان تجريبي؛ كيانات الموارد البشرية غير مشاركة في هذه المرحلة.)
  registerEntity({key:'test_regulated',table:'clients',label:{ar:'كيان محكوم تجريبي'},views:['test-regulated'],working_capability:'clients.manage',owner:'مالك تجريبي',statuses:{},
    system_fields:[{key:'annual_leave_days',label:'أيام الإجازة السنوية',governed_by:'policy',governed_note:'تحكمه لائحة العمل 351743 — يُعدَّل من سياسات الموارد البشرية باعتماد شخصين'}],
    maskable:[{key:'cost',label:'التكلفة',paths:['cost'],derivable_from:['margin']},{key:'margin',label:'الهامش',paths:['margin']}],load:()=>null,list:()=>[],readable:()=>true});
  const governed=caught(()=>tx(()=>saveDraft(db,users.employee,'test_regulated',{spec:{system:{annual_leave_days:{label:{ar:'الإجازة'}}}}})));
  assert.match(governed.message,/لائحة العمل 351743/);assert.match(governed.details.refusal.next,/بإعداد شخص واعتماد آخر/);
  assert.equal(editorPayload(db,users.employee,'test_regulated').system_fields[0].locked,true);
  // رقم يُستنتج من غيره: حجبه وحده حجب على الورق.
  assert.match(caught(()=>tx(()=>saveDraft(db,users.employee,'test_regulated',{spec:{system:{cost:{visible_to:['profitability.view']}}}}))).message,/يُستنتج من/);
  tx(()=>saveDraft(db,users.employee,'test_regulated',{spec:{system:{cost:{visible_to:['profitability.view']},margin:{visible_to:['profitability.view']}}}}));
  // ما نُشر لا يُحذف ولا يتبدل نوعه ولا يُحذف خياره: القيم المحفوظة تبقى مقروءة بتعريفها.
  tx(()=>discardDraft(db,users.employee,ENTITY));
  publish(ENTITY,{fields:[LEAD_SOURCE]});
  assert.match(spec('delete',{fields:[]}).message,/لا يُحذف/);
  assert.match(spec('retype',{fields:[{key:'lead_source',label:{ar:'مصدر الفرصة'},type:'text',required:false}]}).message,/لا يتبدل/);
  assert.match(spec('option',{fields:[{...LEAD_SOURCE,options:LEAD_SOURCE.options.slice(0,2)}]}).message,/الخيار المنشور لا يُحذف/);
  save({fields:[{...LEAD_SOURCE,retired:true}]});
  // ومعرّف استُعمل يومًا بنوع لا يعود بنوع آخر بعد استرجاعٍ أسقطه.
  tx(()=>discardDraft(db,users.employee,ENTITY));
  tx(()=>rollbackTo(db,users.employee,ENTITY,{to_version:0,note:'إسقاط الحقل بالاسترجاع'}));
  assert.match(spec('reuse',{fields:[{key:'lead_source',label:{ar:'مصدر الفرصة'},type:'text',required:false}]}).message,/لا يتبدل/);
});

test('registry: a draft built on a version that is no longer live is refused at publish, and re-saving rebases it',t=>{
  const {db,users,tx,publish}=fixture(t,{quotation:false});
  publish(ENTITY,{fields:[LEAD_SOURCE]});
  tx(()=>saveDraft(db,users.employee,'client',{spec:{fields:[{key:'segment',label:{ar:'شريحة العميل'},type:'text',required:false}]}}));
  const mine=tx(()=>saveDraft(db,users.manager,ENTITY,{spec:{fields:[{...LEAD_SOURCE,label:{ar:'قناة الفرصة'}}]}}));
  assert.equal(mine.base_version,1);
  // نسخة جديدة تُنشر من طريق آخر (استرجاع) والمسودة قائمة.
  tx(()=>rollbackTo(db,users.employee,ENTITY,{to_version:0,note:'استرجاع أثناء وجود مسودة'}));
  const stale=caught(()=>tx(()=>publishDraft(db,users.manager,ENTITY,{row_version:mine.row_version,note:'نشر مسودة قديمة الأساس'})));
  assert.equal(stale.code,'stale_draft');assert.match(stale.message,/بُنيت المسودة على النسخة 1 والسارية الآن 2/);
  assert.equal(editorPayload(db,users.manager,ENTITY).draft.stale,true);
  const rebased=tx(()=>saveDraft(db,users.manager,ENTITY,{spec:{fields:[{...LEAD_SOURCE,label:{ar:'قناة الفرصة'}}]},row_version:mine.row_version}));
  assert.equal(rebased.base_version,2);assert.equal(rebased.stale,false);
  assert.equal(tx(()=>publishDraft(db,users.manager,ENTITY,{row_version:rebased.row_version,note:'نشر بعد إعادة البناء'})).version,3);
  assert.throws(()=>tx(()=>publishDraft(db,users.manager,ENTITY,{row_version:1,note:'لا مسودة'})),code('not_found'));
  const same=tx(()=>saveDraft(db,users.manager,ENTITY,{spec:liveDefinition(db,'36t',ENTITY).spec}));
  assert.throws(()=>tx(()=>publishDraft(db,users.manager,ENTITY,{row_version:same.row_version,note:'لا فرق يُنشر'})),code('nothing_to_publish'));
});

test('registry: renaming the client entity «العميل» to «الجهة» reaches every label that inherits from it at once, and one click takes it back',t=>{
  const {db,users,tx,publish}=fixture(t);
  assert.equal(labelOf(db,'36t',ENTITY,'client_id','العميل'),'العميل');
  publish('client',{entity:{label:{ar:'الجهة',en:'Account'}}});
  assert.equal(entityLabel(db,'36t','client'),'الجهة');
  // حقل client_id المرجعي في عرض السعر والفرصة يرث التسمية بلا تجاوز خاص به.
  assert.equal(labelOf(db,'36t',ENTITY,'client_id','العميل'),'الجهة');assert.equal(labelOf(db,'36t','opportunity','client_id','العميل'),'الجهة');
  assert.equal(labelOf(db,'36t','opportunity','client_id','Client','en'),'Account');
  assert.equal(labelOf(db,'36t',ENTITY,'code','رقم العرض'),'رقم العرض','ما لم يُبدَّل يبقى على عبارة الكود');
  assert.deepEqual(glossary(db,'36t','ar'),{global:{'العميل':'الجهة'},views:{}});assert.deepEqual(glossary(db,'36t','en').global,{Client:'Account'});
  assert.equal(exportRows(db,users.employee,ENTITY).columns[1],'الجهة');assert.equal(exportRows(db,users.employee,'opportunity').columns[1],'الجهة');
  // النماذج المعرَّفة بيانات تتبع عند القراءة، بمطابقة التسمية كاملةً. الجمل لا تُمسّ، والتقرير يقول ذلك ولا يدّعي «كل موضع».
  const fields=[{key:'client',label:'العميل',type:'text',required:true},{key:'reason',label:'سبب الفوز كما ذكره العميل',type:'textarea',required:true}];
  assert.deepEqual(applyTerms(db,'36t',fields).map(f=>f.label),['الجهة','سبب الفوز كما ذكره العميل']);
  assert.deepEqual(fields.map(f=>f.label),['العميل','سبب الفوز كما ذكره العميل'],'التعريف المخزَّن نفسه لا يُمسّ');
  // تجاوز تسمية حقل نظامي محصور في شاشات كيانه: «الحالة» في عرض السعر لا تتسرب إلى شاشات أخرى.
  publish(ENTITY,{system:{status:{label:{ar:'حالة العرض'}},client_id:{label:{ar:'الجهة المتعاقدة'}}}});
  assert.deepEqual(glossary(db,'36t','ar').views,{quotations:{'الحالة':'حالة العرض','العميل':'الجهة المتعاقدة'}});
  assert.equal(labelOf(db,'36t',ENTITY,'client_id','العميل'),'الجهة المتعاقدة','التجاوز الخاص يعلو الموروث');
  assert.equal(snapshotFor(db,users.outsider).glossary.ar.global['العميل'],'الجهة','المعجم يصل كل مستخدم: تسميات لا بيانات');
  tx(()=>rollbackTo(db,users.employee,'client',{to_version:0,note:'العودة إلى «العميل»'}));
  assert.equal(labelOf(db,'36t','opportunity','client_id','العميل'),'العميل');assert.deepEqual(applyTerms(db,'36t',fields),fields);
  // مصطلحات المنصة في كيانها المحجوز: تجاوز فوق القاموس المجمَّد، لا نسخة منه.
  assert.equal(term(db,'36t','status.request.pending'),'بانتظار الاعتماد');
  publish('platform',{terms:{'status.request.pending':{ar:'بانتظار القرار',en:'Awaiting decision'},'role.pm':{ar:'مدير حساب'}}});
  assert.equal(term(db,'36t','status.request.pending'),'بانتظار القرار');assert.equal(term(db,'36t','role.pm'),'مدير حساب');assert.equal(term(db,'36t','role.hr'),'الموارد البشرية');
  assert.throws(()=>tx(()=>saveDraft(db,users.employee,'platform',{spec:{terms:{'status.request.pending':{ar:BANNED_STATUS_PHRASES[0]}}}})),code('definition_spec'));
  assert.throws(()=>tx(()=>saveDraft(db,users.employee,'platform',{spec:{terms:{'status.request.pending':{ar:'معتمد'}}}})),code('definition_spec'),'حالتان بعبارة واحدة');
  assert.throws(()=>tx(()=>saveDraft(db,users.employee,'platform',{spec:{fields:[LEAD_SOURCE]}})),code('definition_spec'),'كيان المصطلحات يحمل المصطلحات وحدها');
  assert.throws(()=>tx(()=>saveDraft(db,users.employee,ENTITY,{spec:{terms:{'role.pm':{ar:'مدير حساب'}}}})),code('definition_spec'));
  assert.ok(verifyAudit(db));
});

test('registry: the snapshot a browser receives is masked per user — not even the definition, label or options of a field the reader may not see — and answers «unchanged» to a matching digest',t=>{
  const {db,users,publish}=fixture(t,{quotation:false});
  publish(ENTITY,{fields:[LEAD_SOURCE,MASKED_NOTE],layout:{slots:{header:['internal_note','lead_source']}},views:{list:{columns:['internal_note','lead_source'],sort:{field:'internal_note',direction:'asc'}}},
    system:{cost_margin:{visible_to:['profitability.view']}}});
  const entitled=snapshotFor(db,users.manager).entities[ENTITY],plain=snapshotFor(db,users.outsider),masked=plain.entities[ENTITY];
  assert.deepEqual(entitled.fields.map(f=>f.key),['lead_source','internal_note']);assert.deepEqual(entitled.withheld,[]);assert.equal(entitled.list.sort.field,'internal_note');
  assert.deepEqual(masked.fields.map(f=>f.key),['lead_source']);assert.deepEqual(masked.slots.header,['lead_source']);assert.deepEqual(masked.list.columns,['lead_source']);
  assert.equal(masked.list.sort,null,'ترتيب على حقل محجوب لا يصل حتى مفتاحه');assert.deepEqual(masked.withheld,['cost_margin']);
  assert.ok(!JSON.stringify(plain).includes('internal_note')&&!JSON.stringify(plain).includes('ملاحظة داخلية'),'لا المفتاح ولا التسمية');
  assert.ok(!JSON.stringify(plain).includes('profitability.view'),'ولا قائمة من يرى');
  // hr لا تفتح شاشة عروض الأسعار أصلًا: لا يصلها تعريف أي حقل فيها، وتصلها التسميات.
  const hr=snapshotFor(db,users.hr).entities[ENTITY];assert.equal(hr.readable,false);assert.deepEqual(hr.fields,[]);assert.equal(hr.label.ar,'عرض السعر');
  assert.deepEqual(snapshotFor(db,users.outsider,{have:plain.digest}),{unchanged:true,digest:plain.digest});
  assert.notEqual(snapshotFor(db,users.manager).digest,plain.digest);
  assert.equal(pipelineBoard(db,users.employee).opportunities[0].status_name,'مفتوحة');assert.equal(clientsBoard(db,users.employee).clients[0].status_name,'محتمل');
});

/* ───── نقائص قِيست على هذا الفرع (05e7002) وأُصلحت عند سببها ───── */

// (3) الدرج يعد صاحب المسودة «أي تعديل يبدأ مسودة لا يراها غيرك»، والشريط يعد «معاينة مسودة — لا يراها غيرك». اللقطة كانت
// تحفظ الوعد، وحمولة المحرّر لا: كل حامل تعديل أو نشر (والأدمن الأول) كان يقرأ الوثيقة والفرق كاملين قبل أن تُسلَّم.
test('registry: an unsubmitted draft is not readable by other holders of the capability — the promise the drawer makes is kept by the server',t=>{
  const {db,users,tx}=fixture(t);
  const CANARY_LABEL='كناري المسودة غير المسلَّمة';
  tx(()=>saveDraft(db,users.employee,ENTITY,{spec:{fields:[{...LEAD_SOURCE,label:{ar:CANARY_LABEL}}]}}));
  const raw=db.prepare("SELECT * FROM definition_drafts WHERE tenant_id='36t' AND entity_key=?").get(ENTITY);
  assert.ok(raw&&!raw.submitted_at,'مسودة قائمة لم تُسلَّم');

  // معدّها يقرؤها كاملة.
  const own=editorPayload(db,users.employee,ENTITY);
  assert.equal(own.draft.spec.fields[0].label.ar,CANARY_LABEL);
  assert.equal(own.draft.withheld,false);assert.ok(own.draft.diff.length);

  // وغيره — حامل التعديل والنشر، والأدمن الأول — يرى أن ورقةً مفتوحة وباسم من، ولا يرى وثيقتها ولا فرقها.
  for(const who of ['manager','admin']){
    const payload=editorPayload(db,users[who],ENTITY);
    assert.equal(JSON.stringify(payload).includes(CANARY_LABEL),false,`${who}: لا كناري في الحمولة كلها`);
    assert.equal(payload.draft.spec,null,`${who}: لا وثيقة`);
    assert.deepEqual(payload.draft.diff,[],`${who}: ولا فرق`);
    assert.equal(payload.draft.withheld,true);
    assert.match(payload.draft.withheld_note,/لم تُسلَّم للنشر بعد/);
    assert.equal(payload.draft.prepared_by_name,'الموظفة التجريبية',`${who}: يعرف باسم من، فلا تُفتح مسودة ثانية`);
    assert.equal(payload.live.version,0);
  }
  // فهرس الشاشة يقول إن ورقةً مفتوحة ولا يحمل وثيقتها أصلًا — وهذا ما يحتاجه المنع من مسودتين.
  const index=definitionsIndex(db,users.manager),entry=index.entities.find(e=>e.key===ENTITY);
  assert.deepEqual([entry.draft.prepared_by_name,entry.draft.mine,entry.draft.submitted_at],['الموظفة التجريبية',false,null]);
  assert.equal(JSON.stringify(index).includes(CANARY_LABEL),false);

  // وحين تُسلَّم للنشر يقرؤها الناشر كاملة: هو من يحكم عليها، فلا يُطلب منه أن ينشر ما لا يقرأ.
  tx(()=>submitDraft(db,users.employee,ENTITY,{row_version:draftVersion(db)}));
  const handed=editorPayload(db,users.manager,ENTITY);
  assert.equal(handed.draft.withheld,false);
  assert.equal(handed.draft.spec.fields[0].label.ar,CANARY_LABEL);
  assert.ok(handed.draft.diff.length);
});

// (12) الوثيقة المنشورة كانت تُخزَّن بمفتاح يحمل رقم النسخة، فيتخلّف عن كل نشرٍ مدخلٌ مجمَّد لا يقرؤه أحد ما دامت العملية حية.
// ورأس السلسلة كان يُستعلم عنه مرة لكل تسمية وحالة تقرؤها اللوحة، فثلاثة إلى أربعة استعلامات فوق استعلامات اللوحة نفسها.
test('registry: the published-definition cache holds one entry per entity, not one per version, and a board asks for the chain head once',t=>{
  const {db,users,publish}=fixture(t);
  const counted=fn=>{const original=db.prepare.bind(db);let n=0;db.prepare=sql=>{n++;return original(sql);};try{fn();}finally{db.prepare=original;}return n;};
  for(let version=1;version<=6;version++)publish(ENTITY,{fields:[{...LEAD_SOURCE,help:`نشرة رقم ${version}`}]});
  assert.equal(liveDefinition(db,'36t',ENTITY).version,6);
  assert.equal(cachedDefinitions(db),1,'ست نسخ منشورة، ومدخل واحد محفوظ');
  publish('client',{entity:{label:{ar:'الجهة'}}});
  assert.equal(entityLabel(db,'36t','client'),'الجهة');
  assert.equal(cachedDefinitions(db),2,'مدخل لكل كيان قُرئ، لا لكل نسخة');

  // قراءات التسميات المتكررة لا تُعيد سؤال «ما أعلى نسخة؟»: استعلام رأسٍ واحد لكل كيان بين نشرتين.
  const reads=()=>{entityLabel(db,'36t',ENTITY);statusLabel(db,'36t',ENTITY,'draft','مسودة');labelOf(db,'36t',ENTITY,'code','رمز');entityLabel(db,'36t','client');};
  reads();
  assert.equal(counted(reads),0,'لا استعلام أصلًا بعد أن حُفظ الرأسان');

  // والإبطال بنيوي: نشرٌ جديد يُسقط الرأس المحفوظ، فتُقرأ النسخة الجديدة بلا أن ينظّف أحد ذاكرة.
  publish(ENTITY,{fields:[{...LEAD_SOURCE,help:'بعد الإبطال'}]});
  assert.equal(liveDefinition(db,'36t',ENTITY).version,7);
  assert.equal(liveDefinition(db,'36t',ENTITY).spec.fields[0].help,'بعد الإبطال');
  assert.equal(cachedDefinitions(db),2,'وما زال مدخلًا لكل كيان');
});
