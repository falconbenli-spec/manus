import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { workbook, csv } from '../app/xlsx.mjs';
import { FIGURE_KINDS, TONES, figure, unavailable, unmeasurable, group, section, coverage,
  assertSourced, setGapRegistry, gapRegistryInstalled, compositePrintable, compositeSheets, compositeRows } from '../app/report-figures.mjs';

const code=key=>error=>error.code===key;
const SOURCE='قيود الحملة (3): مرجع العميل CR-114';
const REASON='لا قيد مسجل في هذه الفترة على هذا المصدر';
const NEEDED='إدخال قيود الصرف من كشف المنصة الإعلانية';

// ZIP صغير: كاتب xlsx.mjs يكتب ترويسة محلية بـ30 بايت بلا حقل إضافي وبضغط deflate، فتُقرأ إدخالاته هكذا.
function unzip(buffer){
  const files=new Map();
  for(let i=0;i+4<=buffer.length&&buffer.readUInt32LE(i)===0x04034b50;){
    const packed=buffer.readUInt32LE(i+18),nameLength=buffer.readUInt16LE(i+26),extraLength=buffer.readUInt16LE(i+28);
    const name=buffer.toString('utf8',i+30,i+30+nameLength),start=i+30+nameLength+extraLength;
    files.set(name,inflateRawSync(buffer.subarray(start,start+packed)).toString('utf8'));
    i=start+packed;
  }
  return files;
}
const rowFor=(sheetXml,label)=>(sheetXml.match(/<row [^>]*>.*?<\/row>/g)??[]).find(r=>r.includes(label))??'';

test('figure: a measured number without a source or without a date stops generation, exactly as it does in the client report',()=>{
  const body={sections:[section('spend','الصرف الإعلامي',[group('سناب شات',[
    figure('المصروف في الفترة',125000,'money','خطة',  '2026-09-01')])])]};
  assert.throws(()=>assertSourced(body),code('figure_without_source'),'a source shorter than five characters is no source');
  assert.throws(()=>assertSourced({sections:[section('spend','الصرف الإعلامي',[group('سناب شات',[
    figure('المصروف في الفترة',125000,'money',SOURCE,'سبتمبر 2026')])])]}),code('figure_without_source'),'as_of is an ISO date or it is nothing');
  assert.throws(()=>assertSourced({sections:[section('spend','الصرف الإعلامي',[group('سناب شات',[
    figure('المصروف في الفترة',null,'money',SOURCE,'2026-09-01')])])]}),code('figure_without_source'),'a figure declared measured whose value is absent is a blank in disguise');
  assert.equal(assertSourced({sections:[section('spend','الصرف الإعلامي',[group('سناب شات',[
    figure('المصروف في الفترة',125000,'money',SOURCE,'2026-09-01')])])]}).sections.length,1,'a sourced and dated figure passes');
  assert.throws(()=>figure('بند','قيمة','unknown_type',SOURCE,'2026-09-01'),code('figure_type'));
  assert.throws(()=>figure('بند',5,'number',SOURCE,'2026-09-01',{target:10}),code('figure_direction'),'a target with no declared direction judges nothing');
});

test('figure: a blank that does not say why it is blank stops generation exactly as a sourceless number does',()=>{
  const blankBody=reason=>({sections:[section('spend','الصرف الإعلامي',[group('تيك توك',[
    unavailable('المصروف في الفترة',{reason,needed:NEEDED,gap_key:'media.spend.tiktok'})])])]});
  assert.throws(()=>assertSourced(blankBody('')),code('figure_without_source'),'silence is read as zero by whoever opens the file');
  assert.throws(()=>assertSourced(blankBody('لا قيد')),code('figure_without_source'),'a reason shorter than ten characters explains nothing');
  assert.throws(()=>assertSourced({sections:[section('spend','الصرف الإعلامي',[group('تيك توك',[
    unavailable('المصروف في الفترة',{reason:REASON,needed:'لا شيء'})])])]}),code('figure_without_source'),'a blank must also say what it would take to measure it');
  assert.equal(assertSourced(blankBody(REASON)).sections.length,1);
});

test('figure: unmeasurable without a gap key throws, because an admission with nobody tracking it is an excuse',()=>{
  assert.throws(()=>unmeasurable('رضا العميل عن التسليم',{reason:REASON,needed:NEEDED}),code('gap_key_required'));
  assert.throws(()=>unmeasurable('رضا العميل عن التسليم',{reason:REASON,needed:NEEDED,gap_key:'   '}),code('gap_key_required'));
  const declared=unmeasurable('رضا العميل عن التسليم',{reason:REASON,needed:NEEDED,gap_key:'client.satisfaction'});
  assert.equal(declared.gap_key,'client.satisfaction');
  // لا كتالوج فجوات قبل المرحلة الثالثة: المفتاح يُقبل ويُسجَّل عليه أنه لم يُطابَق بسجل.
  assert.equal(gapRegistryInstalled(),false);
  assert.equal(declared.gap_registered,false);
  try{
    setGapRegistry(['client.satisfaction']);
    assert.equal(gapRegistryInstalled(),true);
    assert.equal(unmeasurable('رضا العميل',{reason:REASON,needed:NEEDED,gap_key:'client.satisfaction'}).gap_registered,true);
    assert.throws(()=>unmeasurable('بند آخر',{reason:REASON,needed:NEEDED,gap_key:'not.in.catalogue'}),code('gap_key_unknown'));
    assert.throws(()=>setGapRegistry([]),code('gap_registry_empty'));
  }finally{setGapRegistry(null);}
  assert.equal(gapRegistryInstalled(),false);
});

test('figure: a genuinely measured zero is a measurement, never a missing value, and it is never called weak for lack of a target',()=>{
  const zero=figure('الشكاوى المسجلة',0,'count','سجل الشكاوى: لا شكوى مسجلة في الفترة','2026-09-18');
  assert.equal(zero.kind,'measured');assert.equal(zero.value,0);assert.equal(zero.tone,TONES.none);
  assert.doesNotThrow(()=>assertSourced({sections:[section('quality','الجودة',[group('الشكاوى',[zero])])]}));
  const c=coverage(section('quality','الجودة',[group('الشكاوى',[zero])]));
  assert.deepEqual([c.declared,c.measured,c.unavailable,c.unmeasurable,c.bp],[1,1,0,0,10000],'a measured zero counts as measured, not as missing');
  assert.deepEqual(c.missing,[]);
  const rows=compositeRows({sections:[section('quality','الجودة',[group('الشكاوى',[zero])])]});
  assert.equal(rows[1][3],0,'the exported cell is the number zero itself');
  assert.notEqual(rows[1][3],FIGURE_KINDS.unavailable);
  // صفر مقيس دون مستهدفه المعلن يُوصف بالضعف؛ وصفر بلا مستهدف لا يُوصف بشيء: غياب المستهدف ليس أداءً حسنًا.
  assert.equal(figure('الالتزام بالموعد',0,'percent','سجل التسليم','2026-09-18',{target:90,better:'up'}).tone,TONES.weak);
  assert.equal(figure('الشكاوى',0,'count','سجل الشكاوى','2026-09-18',{target:0,better:'down'}).tone,TONES.none,'meeting the target is not weakness');
  assert.equal(figure('الشكاوى',3,'count','سجل الشكاوى','2026-09-18',{target:0,better:'down'}).tone,TONES.weak);
  assert.equal(figure('ملاحظة',  'نص حر','text','سجل الملاحظات','2026-09-18').tone,TONES.none,'text is not compared');
});

test('coverage: a section that declares ten and measures three reports 3000 bp and names the other seven',()=>{
  const measured=n=>figure(`بند مقيس ${n}`,n*10,'number',`${SOURCE} ${n}`,'2026-09-18');
  const missingRecord=n=>unavailable(`بند بلا قيد ${n}`,{reason:REASON,needed:NEEDED,gap_key:`period.gap.${n}`});
  const missingSource=n=>unmeasurable(`بند بلا مصدر ${n}`,{reason:'لا مصدر لهذا البند في المنصة أصلًا',needed:NEEDED,gap_key:`platform.gap.${n}`});
  const s=section('mixed','قسم مختلط',[group('المجموعة الأولى',[measured(1),measured(2),measured(3),missingRecord(4),missingRecord(5)]),
    group('المجموعة الثانية',[missingRecord(6),missingRecord(7),missingSource(8),missingSource(9),missingSource(10)])]);
  const c=coverage(s);
  assert.deepEqual([c.declared,c.measured,c.unavailable,c.unmeasurable,c.bp],[10,3,4,3,3000]);
  assert.equal(c.missing.length,7,'the seven are named, not summarised away');
  assert.deepEqual(c.missing.map(m=>m.label),['بند بلا قيد 4','بند بلا قيد 5','بند بلا قيد 6','بند بلا قيد 7','بند بلا مصدر 8','بند بلا مصدر 9','بند بلا مصدر 10']);
  // متابع الفجوة وتاريخه المستهدف يسافران مع الفراغ نفسه (المرحلة الرابعة)، فتخرج ورقة الفجوات المعلنة ومعها من وعد ومتى.
  assert.deepEqual(Object.keys(c.missing[0]),['label','kind','reason','needed','gap_key','owner','target_on']);
  assert.deepEqual([c.missing[0].owner,c.missing[0].target_on],['',''],'فراغ بلا خطة إغلاق لا يخترع لها مالكًا ولا موعدًا');
  assert.ok(c.missing.every(m=>m.reason.length>=10&&m.needed.length>=10&&m.gap_key));
  assert.deepEqual(coverage([s,section('empty','قسم بلا بنود',[])]).bp,3000,'an empty section declares nothing and therefore changes nothing');
  assert.equal(coverage(section('empty','قسم بلا بنود',[])).bp,null,'no declaration is not zero coverage');
});

test('figure: the weak tone and the unmeasured tone are never the same token — a blank is not a bad result',()=>{
  const weak=figure('الالتزام بالموعد',62,'percent','سجل التسليم: 13 من 21','2026-09-18',{target:90,better:'up'});
  const missingRecord=unavailable('الالتزام بالموعد',{reason:REASON,needed:NEEDED,gap_key:'delivery.ontime'});
  const missingSource=unmeasurable('رضا العميل',{reason:'لا مصدر لهذا البند في المنصة',needed:NEEDED,gap_key:'client.satisfaction'});
  assert.equal(weak.tone,TONES.weak);
  assert.equal(missingRecord.tone,TONES.blank);
  assert.equal(missingSource.tone,TONES.blank);
  assert.notEqual(weak.tone,missingRecord.tone);
  assert.notEqual(weak.tone,missingSource.tone);
  assert.notEqual(TONES.weak,TONES.blank);assert.notEqual(TONES.weak,TONES.none);assert.notEqual(TONES.blank,TONES.none);
  assert.equal(new Set([TONES.weak,TONES.blank,TONES.none]).size,3);
  const html=compositePrintable({title:'تقرير الاختبار',sections:[section('d','التسليم',[group('المواعيد',[weak,missingRecord,missingSource])])]});
  assert.ok(html.includes(`class="figure-${TONES.weak}"`)&&html.includes(`class="figure-${TONES.blank}"`),'the two carry different hooks in the print copy');
  assert.ok(html.includes('دون المستهدف المعلن'),'weakness is written in words, not left to a stylesheet');
  assert.ok(html.includes(FIGURE_KINDS.unavailable)&&html.includes(FIGURE_KINDS.unmeasurable));
});

test('printable: right-to-left Arabic, the platform stylesheet only, no inline script and no inline style',()=>{
  const html=compositePrintable({title:'تقرير مركّب',params:{from:'2026-08-01',to:'2026-08-31'},generated_at:'2026-09-01T07:00:00.000Z',
    sections:[section('spend','الصرف الإعلامي',[group('سناب شات',[figure('المصروف',125000,'money',SOURCE,'2026-08-31')])]),
      section('quality','الجودة',[group('الشكاوى',[unmeasurable('رضا العميل',{reason:'لا مصدر لهذا البند في المنصة',needed:NEEDED,gap_key:'client.satisfaction'})])])]});
  assert.ok(html.includes('<html lang="ar" dir="rtl">'));
  assert.ok(html.includes('<link rel="stylesheet" href="/report-print.css">'));
  assert.ok(!/<script/i.test(html),'strict CSP: no inline script');
  assert.ok(!/\sstyle="/i.test(html),'strict CSP: no inline style attribute');
  assert.ok(!/https?:\/\//i.test(html),'no external origin');
  assert.ok(html.includes('1,250.00 ريال'),'money is printed in riyals from halalas');
  assert.ok(html.includes('التغطية المعلنة: قِيس 1 من 2 (5000 نقطة أساس)'));
  assert.ok(html.includes('الفجوات المعلنة')&&html.includes('client.satisfaction'));
  assert.ok(html.includes('2026-08-31 · ')&&html.includes('هـ'),'dates are printed in both calendars through the platform date helper');
});

test('export: an unmeasured figure reaches the CSV and the workbook as the Arabic phrase — never as 0 and never as an empty cell',()=>{
  const missingSource=unmeasurable('رضا العميل عن التسليم',{reason:'لا مصدر لهذا البند في المنصة أصلًا',needed:NEEDED,gap_key:'client.satisfaction'});
  const missingRecord=unavailable('المصروف على تيك توك',{reason:REASON,needed:NEEDED,gap_key:'media.spend.tiktok'});
  const result={title:'تقرير مركّب',sections:[
    section('spend','الصرف الإعلامي',[group('القنوات',[figure('سناب شات',125000,'money',SOURCE,'2026-08-31'),missingRecord])]),
    section('quality','الجودة',[group('الرضا',[missingSource])])]};
  assertSourced(result);

  const rows=compositeRows(result);
  assert.deepEqual(rows[0].slice(0,4),['القسم','المجموعة','البند','القيمة']);
  const csvRow=rows.find(r=>r[2]==='رضا العميل عن التسليم');
  assert.equal(csvRow[3],FIGURE_KINDS.unmeasurable,'the value cell carries the Arabic phrase');
  assert.equal(csvRow[4],FIGURE_KINDS.unmeasurable,'the state column carries it too');
  assert.ok(csvRow.every(cell=>cell!==''&&cell!==null&&cell!==undefined),'not one cell of the row is left blank');
  assert.ok(!csvRow.includes(0),'nowhere in the row is the missing value written as zero');
  assert.equal(rows.find(r=>r[2]==='المصروف على تيك توك')[3],FIGURE_KINDS.unavailable);
  const text=csv(rows);
  assert.ok(text.includes(FIGURE_KINDS.unmeasurable)&&text.includes(FIGURE_KINDS.unavailable));
  assert.ok(text.includes(`رضا العميل عن التسليم,${FIGURE_KINDS.unmeasurable},${FIGURE_KINDS.unmeasurable}`),'label, value and state follow each other with no empty field between them');
  assert.ok(!/,,/.test(text)&&!/,\r\n/.test(text),'no empty field anywhere in the file: an empty cell reads as zero');

  const sheets=compositeSheets(result);
  assert.deepEqual(sheets.map(s=>s.name),['الصرف الإعلامي','الجودة','الفجوات المعلنة']);
  const files=unzip(workbook(sheets));
  const quality=files.get('xl/worksheets/sheet2.xml'),gaps=files.get('xl/worksheets/sheet3.xml');
  assert.ok(quality.includes(FIGURE_KINDS.unmeasurable),'the workbook carries the phrase, not a hole');
  const row=rowFor(quality,'رضا العميل عن التسليم');
  assert.equal((row.match(/<c /g)??[]).length,sheets[1].rows[0].length,'every column of that row produced a cell — xlsx.mjs drops empty cells, and a dropped cell reads as zero');
  assert.ok(!/<v>0<\/v>/.test(row),'no zero was invented for the figure nobody measured');
  assert.ok(gaps.includes('client.satisfaction')&&gaps.includes('media.spend.tiktok'),'both blanks are named in the declared-gaps sheet');
  const spend=files.get('xl/worksheets/sheet1.xml');
  assert.ok(spend.includes('<v>1250</v>'),'a measured amount is written as a number in riyals');
  assert.ok(spend.includes(FIGURE_KINDS.unavailable),'and the unrecorded channel beside it is written in words');
});
