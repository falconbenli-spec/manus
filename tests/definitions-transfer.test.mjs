import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, transaction, verifyAudit, hash } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { exportBundle, checkImport, applyImport, abandonImport, listImports, BUNDLE_FORMAT } from '../app/definitions-transfer.mjs';
import { liveDefinition, history, verifyChain, saveDraft, registeredEntities, specDigest, canonical, diffSpecs } from '../app/definitions.mjs';
import { saveValues } from '../app/custom-fields.mjs';
import { createApp } from '../app/server.mjs';
import { run, guardDatabasePath } from '../scripts/definitions-transfer.mjs';
import { fixture, usersOf, grantAll, code, caught, LEAD_SOURCE, GOVERNING_SPEC, MASKED_NOTE, PASSWORD, sessionsFor } from './definitions-fixture.mjs';

// بيانات تجريبية مصطنعة بالكامل. اختبار القبول 18: التعريفات تُصدَّر من بيئة وتُستورد في أخرى بتقرير فرق يسبق التطبيق.
const QUOTE='client_quotation';
const published=db=>Object.fromEntries(['client','opportunity',QUOTE,'platform'].map(key=>[key,liveDefinition(db,'36t',key)?.spec_digest??null]));
function source(t){
  const a=fixture(t,{quotation:false});
  a.publish(QUOTE,{...GOVERNING_SPEC,fields:[LEAD_SOURCE,MASKED_NOTE],system:{cost_margin:{visible_to:['profitability.view']}}});
  a.publish('client',{entity:{label:{ar:'الجهة',en:'Account'}},fields:[{key:'segment',label:{ar:'شريحة العميل'},type:'text',required:false}]});
  a.publish('opportunity',{fields:[LEAD_SOURCE],transitions:{move:{require:['lead_source']}}});
  a.publish('platform',{terms:{'role.pm':{ar:'مدير حساب'}}});
  return a;
}

test('transfer: export then import into a fresh database yields an identical published state, and the diff report shown before applying is truthful',t=>{
  const a=source(t),b=fixture(t,{quotation:false});
  const bundle=exportBundle(a.db,a.users.employee,{source_label:'بيئة التجربة'});
  assert.equal(bundle.format,BUNDLE_FORMAT);assert.deepEqual(bundle.entities.map(e=>[e.entity_key,e.version]).sort(),[['client',1],['client_quotation',1],['opportunity',1],['platform',1]]);
  // الحزمة تعريفات منشورة وحدها: لا سجلات ولا حسابات ولا منح، وأسماء المُعدّ والناشر نصٌّ لا معرّفات.
  const text=JSON.stringify(bundle);
  assert.ok(!text.includes('شركة تجريبية للتجزئة')&&!text.includes('password')&&!text.includes('"employee"'),'لا سجل ولا حساب في الحزمة');
  assert.equal(bundle.entities[0].published_by_name,'الموظفة التجريبية');
  assert.ok(a.db.prepare("SELECT 1 FROM audit_events WHERE action='definitions.exported'").get());

  const before=published(b.db),report=b.tx(()=>checkImport(b.db,b.users.employee,{bundle,source_label:'بيئة التجربة'}));
  // لم يُطبَّق شيء: الفحص يحفظ التقرير وبصمات الساري ولا يمس تعريفًا.
  assert.deepEqual(published(b.db),before);assert.deepEqual(Object.values(before),[null,null,null,null]);
  assert.equal(report.applicable,true);assert.deepEqual(report.blocking,[]);assert.equal(report.worst_class,'tightening');assert.equal(report.second_person_required,false);
  assert.match(report.note,/لم يُطبَّق شيء بعد/);
  // التقرير هو فرق النشر نفسه: حقول أُضيفت، وتسميات قديم←جديد، وإلزام أُضيف، وحجب ضُيّق — وكلٌّ مصنَّف.
  const of=key=>report.entities.find(e=>e.entity_key===key),kinds=key=>of(key).diff.map(i=>`${i.kind}:${i.key}:${i.class}`);
  assert.deepEqual(kinds(QUOTE),['field_added:lead_source:additive','field_added:internal_note:tightening','system_mask_narrowed:cost_margin:tightening','layout_changed:slots:additive',
    'list_changed:list:additive','status_label:issued:additive','require_added:issue.lead_source:tightening']);
  assert.deepEqual(of('client').diff.find(i=>i.kind==='entity_label'),{section:'entity',kind:'entity_label',key:'entity',label:'الجهة',before:null,after:{ar:'الجهة',en:'Account'},class:'additive'});
  assert.deepEqual(kinds('opportunity'),['field_added:lead_source:additive','require_added:move.lead_source:tightening']);
  assert.deepEqual(kinds('platform'),['term_changed:role.pm:additive']);
  assert.deepEqual(of(QUOTE).counts,{additive:4,tightening:3,loosening:0});

  const applied=b.tx(()=>applyImport(b.db,b.users.employee,report.id,{note:'نقل تعريفات بيئة التجربة إلى هذه البيئة'}));
  assert.deepEqual(applied.published.map(p=>[p.entity_key,p.version,p.origin]).sort(),[['client',1,'import'],['client_quotation',1,'import'],['opportunity',1,'import'],['platform',1,'import']]);
  // الحالة المنشورة متطابقة: وثيقة كل كيان في ب هي وثيقته في أ بالحرف.
  assert.deepEqual(published(b.db),published(a.db));
  for(const key of Object.keys(before))assert.deepEqual(liveDefinition(b.db,'36t',key).spec,liveDefinition(a.db,'36t',key).spec,key);
  const [top]=history(b.db,b.users.employee,QUOTE);assert.deepEqual([top.origin,top.origin_ref,top.state],['import',report.id,'published']);
  assert.ok(verifyChain(b.db,'36t',QUOTE));assert.ok(verifyAudit(b.db));
  // إعادة الفحص بعد التطبيق: مطابق، فلا شيء يُطبَّق ولا فحص يُحفظ. والفحص المطبَّق لا يُطبَّق ثانية.
  const again=b.tx(()=>checkImport(b.db,b.users.employee,{bundle}));
  assert.equal(again.id,null);assert.equal(again.applicable,false);assert.ok(again.entities.every(e=>e.state==='unchanged'));assert.match(again.note,/تطابق/);
  assert.throws(()=>b.tx(()=>applyImport(b.db,b.users.employee,report.id,{note:'تطبيق مرة ثانية'})),code('import_closed'));
  assert.equal(listImports(b.db,b.users.employee)[0].status_name,'طُبِّقت');
  assert.throws(()=>b.db.prepare("UPDATE definition_imports SET status='checked',applied_by=NULL,applied_at=NULL WHERE id=?").run(report.id),/fixed/);
  assert.throws(()=>b.db.prepare('DELETE FROM definition_imports WHERE id=?').run(report.id),/retained/);
});

test('transfer: what was shown is what is applied — a target that changed after the check refuses the apply until it is checked again, and everything lands atomically',t=>{
  const a=source(t),b=fixture(t,{quotation:false}),bundle=exportBundle(a.db,a.users.employee);
  const report=b.tx(()=>checkImport(b.db,b.users.employee,{bundle}));
  b.publish('opportunity',{fields:[{key:'local_note',label:{ar:'ملاحظة محلية'},type:'text',required:false}]});
  const stale=caught(()=>b.tx(()=>applyImport(b.db,b.users.employee,report.id,{note:'تطبيق بعد تغيّر الساري'})));
  assert.equal(stale.status,409);assert.equal(stale.code,'stale_import');assert.match(stale.message,/الفرصة/);assert.match(stale.details.refusal.next,/أعد فحص الحزمة/);
  assert.equal(liveDefinition(b.db,'36t',QUOTE),null,'لم يُطبَّق كيان واحد: الكل أو لا شيء');
  // إعادة الفحص تكشف أن الحزمة تحذف حقلًا نُشر هنا: الحقل المنشور لا تحذفه حزمة، فيُمنع ويُسمّى.
  const blocked=b.tx(()=>checkImport(b.db,b.users.employee,{bundle}));
  assert.equal(blocked.id,null);assert.equal(blocked.applicable,false);
  assert.deepEqual(blocked.blocking.map(x=>[x.entity_key,x.code]),[['opportunity','field_removed']]);assert.match(blocked.blocking[0].text,/ملاحظة محلية/);
  assert.match(blocked.note,/لم يُحفظ فحص ولم يتغير شيء/);
  b.tx(()=>abandonImport(b.db,b.users.employee,report.id));
  assert.throws(()=>b.tx(()=>applyImport(b.db,b.users.employee,report.id,{note:'تطبيق فحص متروك'})),code('import_closed'));
});

test('transfer: a bundle that loosens a control is not applied by the person who checked it, and the target learns how many of its records use an option the bundle retires',t=>{
  const a=source(t),b=fixture(t),first=exportBundle(a.db,a.users.employee);
  const check=b.tx(()=>checkImport(b.db,b.users.employee,{bundle:first}));b.tx(()=>applyImport(b.db,b.users.employee,check.id,{note:'التعريف الأول على البيئة الهدف'}));
  b.tx(()=>saveValues(b.db,b.users.employee,QUOTE,b.quote,{version:b.quotationRow().version,values:{lead_source:'event'}}));
  // في المصدر: يُسحب خيار «فعالية» ويُرفع الإلزام عند الإصدار (تخفيف نشره شخصان هناك).
  const retired={...LEAD_SOURCE,options:LEAD_SOURCE.options.map(o=>o.value==='event'?{...o,retired:true}:o)};
  a.publish(QUOTE,{...GOVERNING_SPEC,fields:[retired,MASKED_NOTE],system:{cost_margin:{visible_to:['profitability.view']}},transitions:{}},{by:a.users.employee,publisher:a.users.manager});
  const report=b.tx(()=>checkImport(b.db,b.users.employee,{bundle:exportBundle(a.db,a.users.employee)}));
  assert.equal(report.worst_class,'loosening');assert.equal(report.second_person_required,true);
  const entity=report.entities.find(e=>e.entity_key===QUOTE);
  assert.ok(entity.diff.some(i=>i.kind==='require_removed'&&i.class==='loosening'));
  assert.deepEqual(entity.options_in_use,[{field_key:'lead_source',option:'event',label:'مصدر الفرصة: فعالية أو معرض',records:1}],'سجل واحد هنا يحمل الخيار الذي تسحبه الحزمة');
  assert.deepEqual(report.entities.filter(e=>e.state==='unchanged').map(e=>e.entity_key).sort(),['client','opportunity','platform']);
  const self=caught(()=>b.tx(()=>applyImport(b.db,b.users.employee,report.id,{note:'تطبيق تخفيف فحصته بنفسي'})));
  assert.equal(self.code,'second_publisher_required');assert.match(self.details.refusal.missing[0].owner,/مدير الفريق التجريبي/);
  assert.equal(listImports(b.db,b.users.employee)[0].can_apply,false);assert.equal(listImports(b.db,b.users.manager)[0].can_apply,true);
  const applied=b.tx(()=>applyImport(b.db,b.users.manager,report.id,{note:'اعتماد تطبيق حزمة تخفّف الإلزام'}));
  assert.deepEqual(applied.published.map(p=>[p.entity_key,p.version,p.change_class]),[[QUOTE,2,'loosening']],'المطابق لا يُنشر له صف');
  const [top]=history(b.db,b.users.manager,QUOTE);assert.deepEqual([top.prepared_by,top.published_by,top.two_person],['employee','manager',true]);
  assert.equal(JSON.parse(b.quotationRow().custom_fields).lead_source,'event','السحب لا يمحو القيمة');
});

test('transfer: a bundle edited by hand, from another format, or naming what this environment does not know is refused or blocked before anything is compared',t=>{
  const a=source(t),b=fixture(t,{quotation:false}),bundle=exportBundle(a.db,a.users.employee),copy=()=>JSON.parse(JSON.stringify(bundle));
  const check=input=>b.tx(()=>checkImport(b.db,b.users.employee,{bundle:input}));
  const tampered=copy();tampered.entities[0].spec.fields[0].label.ar='حقل بُدّل باليد';
  assert.match(caught(()=>check(tampered)).message,/لا تطابق بصمتها/);
  const dropped=copy();dropped.entities.pop();assert.match(caught(()=>check(dropped)).message,/بصمة الحزمة/);
  assert.throws(()=>check({...copy(),format:'other/1'}),code('bundle_invalid'));assert.throws(()=>check({...copy(),spec_format:2}),code('bundle_invalid'));
  assert.throws(()=>b.tx(()=>checkImport(b.db,b.users.employee,{bundle,extra:true})),code('invalid_fields'));
  // كيان أو تصريح لا تعرفه هذه البيئة: يُسمّى ويمنع، ولا يُحفظ فحص.
  const foreign=copy(),spec={fields:[{...LEAD_SOURCE,visible_to:['studio.configure','warehouse.manage']}]};
  foreign.entities=[{entity_key:'warehouse_item',version:1,digest:'x',spec:{},spec_digest:specDigest({})},{entity_key:QUOTE,version:9,digest:'x',spec,spec_digest:specDigest(spec)}];
  foreign.bundle_digest=hash(canonical(foreign.entities.map(e=>({entity_key:e.entity_key,version:e.version,spec_digest:e.spec_digest}))));
  const report=check(foreign);
  assert.equal(report.id,null);assert.deepEqual(report.blocking.map(x=>x.code),['unknown_entity','unknown_capability','unknown_capability']);
  assert.match(report.blocking[0].text,/warehouse_item/);assert.match(report.blocking[2].text,/warehouse\.manage/);
  assert.equal(b.db.prepare('SELECT COUNT(*) AS n FROM definition_imports').get().n,0);
  // الفحص لحامل تعديل التعريفات، والتطبيق لحامل نشرها.
  assert.throws(()=>b.tx(()=>checkImport(b.db,b.users.outsider,{bundle})),code('not_permitted'));assert.throws(()=>exportBundle(a.db,a.users.outsider),code('not_permitted'));
  const ok=check(bundle);assert.throws(()=>b.tx(()=>applyImport(b.db,b.users.outsider,ok.id,{note:'تطبيق بلا تصريح النشر'})),code('not_permitted'));
  assert.throws(()=>b.tx(()=>applyImport(b.db,b.users.employee,ok.id,{note:'x'})),code('note_required'));
});

test('transfer: the routes and the command-line twin run the same functions — export, check, apply between two database files, never the preview database itself',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'36t-transfer-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const pathA=join(directory,'a.sqlite'),pathB=join(directory,'b.sqlite'),file=join(directory,'bundle.json'),lines=[];
  for(const path of [pathA,pathB]){const db=openDb(path);seed(db,PASSWORD);grantAll(db,usersOf(db));db.close();}
  const dbA=openDb(pathA),usersA=usersOf(dbA);
  const draft=transaction(dbA,()=>saveDraft(dbA,usersA.employee,QUOTE,{spec:GOVERNING_SPEC}));
  const {call}=await sessionsFor(createApp(dbA),['employee','outsider']);
  await call('employee',`/definitions/${QUOTE}/publish`,{row_version:draft.row_version,note:'نشر من المسار'},201);
  await call('outsider','/definitions/export',undefined,403);
  const exported=await call('employee','/definitions/export?label='+encodeURIComponent('بيئة أ'),undefined,200);
  assert.match(exported.headers['Content-Disposition'],/^attachment; filename="definitions-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(exported.json().entities.length,1);dbA.close();
  // سطر الأوامر: الدوال نفسها، فالتصاريح تُحكم هنا أيضًا — --as حسابٌ في القاعدة، لا امتياز لسطر الأوامر.
  const log=line=>lines.push(line);
  run('export',{db:pathA,as:'employee',out:file,label:'بيئة أ'},{log});
  assert.equal(JSON.parse(readFileSync(file,'utf8')).source.label,'بيئة أ');
  assert.throws(()=>run('check',{db:pathB,as:'outsider',in:file},{log}),code('not_permitted'));
  const report=run('check',{db:pathB,as:'employee',in:file},{log});
  assert.ok(lines.some(line=>/لم يُطبَّق شيء بعد/.test(line))&&lines.some(line=>/require_added · مصدر الفرصة/.test(line)),'تقرير الفرق يُطبع قبل أي تطبيق');
  const dbB=openDb(pathB);assert.equal(liveDefinition(dbB,'36t',QUOTE),null);dbB.close();
  run('apply',{db:pathB,as:'employee',import:report.id,note:'تطبيق من سطر الأوامر'},{log});
  const after=openDb(pathB);assert.equal(liveDefinition(after,'36t',QUOTE).spec_digest,JSON.parse(readFileSync(file,'utf8')).entities[0].spec_digest);after.close();
  // قاعدة المعاينة الأصلية لا تُفتح: فتحها يطبّق ترحيلات عليها. تُنسخ ويُعمل على النسخة.
  const preview=join(directory,'hr-design-preview-20260914.sqlite');copyFileSync(pathB,preview);
  assert.throws(()=>guardDatabasePath(preview),/لا تُفتح قاعدة المعاينة الأصلية/);assert.throws(()=>run('export',{db:preview,as:'employee',out:file},{log}),/انسخها/);
  assert.throws(()=>guardDatabasePath('/somewhere/3-6t-live/work/local.sqlite'),/مجلد التشغيل الحي/);
  assert.throws(()=>run('apply',{db:pathB,as:'employee'},{log}),/--import/);assert.throws(()=>run('publish',{db:pathB,as:'employee'},{log}),/export أو check أو apply/);
  assert.deepEqual(registeredEntities().map(d=>d.key).sort(),['client','client_quotation','opportunity']);
});

/* ───── نقائص قِيست على هذا الفرع (05e7002) وأُصلحت عند سببها ───── */

// (1) طريق الاستيراد كان بابًا ثانيًا يسقط خيارًا منشورًا، ويقرؤه التقرير «إضافة»، ويطبّقه شخص واحد. والوعد المكتوب في
// التقرير نفسه («السحب لا يمحو القيمة: تبقى مقروءة») كان يكذب: السجل بعدها يعرض مفتاح الخيار الخام لا اسمه.
test('transfer: a bundle that deletes a published option is blocked, not reported as an addition — the records that chose it keep their label',t=>{
  const a=source(t),b=fixture(t),first=exportBundle(a.db,a.users.employee);
  const check=b.tx(()=>checkImport(b.db,b.users.employee,{bundle:first}));b.tx(()=>applyImport(b.db,b.users.employee,check.id,{note:'التعريف الأول على البيئة الهدف'}));
  b.tx(()=>saveValues(b.db,b.users.employee,QUOTE,b.quote,{version:b.quotationRow().version,values:{lead_source:'event'}}));
  // في المصدر يُحذف الخيار من الوثيقة حذفًا (لا يقع من المحرّر، لكنه يقع في حزمة حُرّرت أو جاءت من استرجاع).
  const bundle=exportBundle(a.db,a.users.employee),item=bundle.entities.find(e=>e.entity_key===QUOTE);
  const field=item.spec.fields.find(f=>f.key==='lead_source');
  field.options=field.options.filter(o=>o.value!=='event');
  item.spec_digest=specDigest(item.spec);bundle.bundle_digest=hash(canonical(bundle.entities.map(e=>({entity_key:e.entity_key,version:e.version,spec_digest:e.spec_digest}))));
  const report=b.tx(()=>checkImport(b.db,b.users.employee,{bundle}));
  assert.equal(report.applicable,false,'الحزمة لا تُطبَّق');
  const blocked=report.blocking.find(x=>x.code==='option_removed');
  assert.ok(blocked,`منعٌ باسمه: ${JSON.stringify(report.blocking)}`);
  assert.match(blocked.text,/فعالية أو معرض/);assert.match(blocked.text,/يحمله هنا 1 سجلًا/,'يقول كم سجلًا يفقد اسم قيمته');
  assert.match(blocked.text,/يُسحب في البيئة المصدر ولا يُحذف/);
  assert.equal(report.id,null,'فحصٌ غير قابل للتطبيق لا يُحفظ');
  // ولا يمر من الطريق الخلفي: لا فحص محفوظ يُطبَّق، والقيمة باقية باسمها في الشاشة.
  assert.equal(JSON.parse(b.quotationRow().custom_fields).lead_source,'event');
  assert.equal(liveDefinition(b.db,'36t',QUOTE).spec.fields.find(f=>f.key==='lead_source').options.some(o=>o.value==='event'),true);
  // وحذف خيار منشور تخفيفُ ضابط لا إضافة، أينما صُنِّف.
  const diff=diffSpecs({fields:[LEAD_SOURCE]},{fields:[{...LEAD_SOURCE,options:LEAD_SOURCE.options.filter(o=>o.value!=='event')}]});
  assert.deepEqual(diff.filter(i=>i.kind==='option_removed').map(i=>i.class),['loosening']);
});

// (2) فرقٌ في الترتيب وحده كان يُقرأ «مطابق لما هو منشور هنا» مع اختلاف بصمتَي الوثيقتين، فلا تلحق بيئةٌ بالأخرى أبدًا.
// وترتيب الخيارات هو ما يراه من يختار في القائمة.
test('transfer: two environments whose published documents differ only in order are reported as different, not «identical»',t=>{
  const a=source(t),b=fixture(t,{quotation:false});
  const first=exportBundle(a.db,a.users.employee);
  const check=b.tx(()=>checkImport(b.db,b.users.employee,{bundle:first}));b.tx(()=>applyImport(b.db,b.users.employee,check.id,{note:'التعريف الأول على البيئة الهدف'}));
  // الهدف يعيد نشر الوثيقة نفسها بترتيب خيارات معكوس وترتيب حقول مبدّل: المحتوى هو هو، والوثيقة ليست هي.
  const live=liveDefinition(b.db,'36t',QUOTE).spec;
  const reordered={...live,fields:[{...live.fields[0],options:[...live.fields[0].options].reverse()},...live.fields.slice(1)].reverse()};
  b.publish(QUOTE,reordered,{by:b.users.employee,publisher:b.users.manager});
  assert.notEqual(liveDefinition(b.db,'36t',QUOTE).spec_digest,first.entities.find(e=>e.entity_key===QUOTE).spec_digest,'البصمتان مختلفتان بحق');
  const report=b.tx(()=>checkImport(b.db,b.users.employee,{bundle:exportBundle(a.db,a.users.employee)}));
  const entity=report.entities.find(e=>e.entity_key===QUOTE);
  assert.equal(entity.state,'changed','لا يُقال «مطابق» عن وثيقتين بصمتاهما مختلفتان');
  assert.ok(entity.diff.some(i=>i.kind==='option_order'),`ترتيب الخيارات بندٌ في التقرير: ${JSON.stringify(entity.diff.map(i=>i.kind))}`);
  assert.ok(entity.diff.some(i=>i.kind==='field_order'),'وترتيب الحقول كذلك');
  assert.equal(report.applicable,true,'وتُطبَّق الحزمة فتلتقي البيئتان');
  const applied=b.tx(()=>applyImport(b.db,b.users.manager,report.id,{note:'مواءمة ترتيب الحقول والخيارات بين البيئتين'}));
  assert.ok(applied.published.some(p=>p.entity_key===QUOTE));
  assert.equal(liveDefinition(b.db,'36t',QUOTE).spec_digest,first.entities.find(e=>e.entity_key===QUOTE).spec_digest,'تساوت البصمتان بعد التطبيق');
});
