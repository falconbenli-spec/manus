// حارس حدّ اليوم بين الرياض وUTC (الحزمة 3، 1 أكتوبر 2026). يعدّ في كل ملف من app وapp/static الأنماط التي تقرأ طابع UTC
// كأنه يوم رياض، ويقارن العدّ بخط أساس مُلتزَم (scripts/riyadh-time-baseline.json). القاعدة قاعدة المسنّنة نفسها: العدّ ينزل فقط،
// والملف الجديد يبدأ من صفر. لا يعيد كتابة القديم؛ يمنع أن يُكتب سطرٌ جديد منه، ويسمّي البديل في app/riyadh-time.mjs.
//   utc_slice            أول أحرف طابع *_at في JS:           x_at.slice(0,10) / String(x_at).slice(0,7)        ← riyadhDateOf(x_at)
//   utc_substr           أول أحرف طابع *_at في SQL:          substr(x_at,1,10)                                  ← date(x_at,'+3 hours') أو مدى لحظات
//   utc_today            «اليوم» أو «السنة» من ساعة UTC:     now().slice(0,10) / new Date().toISOString()…      ← riyadhToday()
//   riyadh_text_bound    طابع *_at يُقارَن بنص يوم أو شهر رياض: created_at>=? مربوطًا بـ today().slice(0,7)+'-01' ← riyadhMonthRange(…)[0]
//   utc_midnight         يوم رياض يُحوَّل إلى منتصف ليل UTC:   `${date}T00:00:00.000Z` / T23:59:59.999Z          ← riyadhDayRange(date)
// الاستعمال:  node scripts/riyadh-time-guard.mjs              يقيس ويقارن (ويستدعيه tests/riyadh-time.test.mjs)
//             node scripts/riyadh-time-guard.mjs --tighten    يُنزل خط الأساس حيث نزل العدّ، ويرفض أن يرفع رقمًا
//             node scripts/riyadh-time-guard.mjs --rebaseline يعيد كتابة خط الأساس كله؛ يرفع أرقامًا، فلا يُستعمل إلا بقرار يُكتب في رسالة الالتزام
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const BASELINE_PATH=join(ROOT,'scripts/riyadh-time-baseline.json');
// مصدر الحقيقة لا يُعدّ على نفسه: تعليقه يصف الأنماط التي يمنعها.
const SOURCE='app/riyadh-time.mjs';
const list=dir=>readdirSync(join(ROOT,dir)).filter(f=>f.endsWith('.mjs')).sort().map(f=>`${dir}/${f}`);

// الوسائط التي تحوّل اليوم إلى لحظة صحيحة لا تُعدّ: مدى الرياض أو إزاحة +03:00 الصريحة.
const SAFE_BOUND=/riyadh(?:Day|Month|Year)Range\(|\+03:00/;
const RIYADH_TEXT=/\b(?:today|riyadhToday|dateToday|todayDate|riyadhDate)\(\)|\.slice\(\s*0\s*,\s*(?:7|10)\s*\)|['"`]-01['"`]|-01`/;
export const PATTERNS=Object.freeze({
  utc_slice:{name:'أول أحرف طابع UTC بدل يوم الرياض',fix:'riyadhDateOf(…) من app/riyadh-time.mjs',
    count:source=>(source.match(/\b\w*_at\)?\??\.slice\(\s*0\s*,\s*(?:4|7|10|13|16)\s*\)/g)??[]).length},
  utc_substr:{name:'substr على طابع UTC في SQL',fix:"date(x_at,'+3 hours') أو مدى لحظات من riyadhDayRange/riyadhMonthRange/riyadhYearRange",
    count:source=>(source.match(/substr\(\s*[\w.]*_at\s*,\s*1\s*,\s*(?:4|7|10)\s*\)/g)??[]).length},
  utc_today:{name:'«اليوم» من ساعة UTC',fix:'riyadhToday() / riyadhMonth() من app/riyadh-time.mjs',
    count:source=>(source.match(/\bnow\(\)\??\.slice\(\s*0\s*,|new Date\((?:Date\.now\(\))?\)\.toISOString\(\)\.slice\(\s*0\s*,|new Date\((?:Date\.now\(\))?\)\.getUTC(?:FullYear|Month|Date|Day)\(\)/g)??[]).length},
  riyadh_text_bound:{name:'طابع UTC يُقارَن بنص يوم أو شهر رياض',fix:'riyadhDayRange(…)[0] / riyadhMonthRange(…)[0] لحظةً بـUTC',
    count:source=>{
      let n=0;
      // ما بعد قوس الاستدعاء إلى نهاية السطر: الوسائط المربوطة وما يُركَّب منها (today().slice(0,7)+'-01').
      for(const m of source.matchAll(/_at\s*(?:>=|>|<=|<|BETWEEN)\s*\?[^;]*?\)\s*\.\s*(?:get|all|run|iterate)\s*\(([^;\n]*)/g))
        if(RIYADH_TEXT.test(m[1])&&!SAFE_BOUND.test(m[1]))n++;
      return n;
    }},
  utc_midnight:{name:'يوم رياض يُحوَّل إلى منتصف ليل UTC',fix:'riyadhDayRange(date) من app/riyadh-time.mjs',
    count:source=>(source.match(/T00:00:00\.000Z|T23:59:59(?:\.999)?Z/g)??[]).length}
});

const read=path=>readFileSync(join(ROOT,path),'utf8');
const keep=counts=>Object.fromEntries(Object.entries(counts).filter(([,n])=>n>0));
export function measureSource(source){return Object.fromEntries(Object.entries(PATTERNS).map(([key,p])=>[key,p.count(source)]));}
export function measure(){
  const files=[...list('app'),...list('app/static')].filter(p=>p!==SOURCE),per=files.map(p=>[p,measureSource(read(p))]);
  return Object.fromEntries(Object.keys(PATTERNS).map(key=>[key,keep(Object.fromEntries(per.map(([p,c])=>[p,c[key]])))]));
}
export const totals=measured=>Object.fromEntries(Object.keys(PATTERNS).map(k=>[k,Object.values(measured[k]??{}).reduce((a,b)=>a+b,0)]));

// نقية: ملف ليس في خط الأساس أساسه صفر.
export function compare(baseline,current){
  const regressions=[],improvements=[];
  for(const key of Object.keys(PATTERNS)){
    const was=baseline[key]??{},now=current[key]??{};
    for(const file of new Set([...Object.keys(was),...Object.keys(now)])){
      const a=was[file]??0,b=now[file]??0;
      if(b>a)regressions.push({pattern:key,file,from:a,to:b,fresh:!(file in was)});
      else if(b<a)improvements.push({pattern:key,file,from:a,to:b});
    }
  }
  return {regressions,improvements};
}
export const describe=r=>`${r.file}: ${PATTERNS[r.pattern].name} ${r.from} → ${r.to}${r.fresh?' (ملف لم يكن في خط الأساس، وأساسه صفر)':''} — البديل: ${PATTERNS[r.pattern].fix}`;
export const loadBaseline=()=>JSON.parse(readFileSync(BASELINE_PATH,'utf8'));
const stamp=measured=>({note:'خط أساس حارس حدّ اليوم بين الرياض وUTC (scripts/riyadh-time-guard.mjs). العدّ ينزل فقط، والملف الجديد يبدأ من صفر. يُنزَل بـ --tighten ولا يُحرَّر باليد.',
  totals:totals(measured),...measured});

export function runGuard({log=console.log}={}){
  if(!existsSync(BASELINE_PATH))return {ok:false,lines:['لا خط أساس: scripts/riyadh-time-baseline.json مفقود'],regressions:[],improvements:[]};
  const current=measure(),{regressions,improvements}=compare(loadBaseline(),current),t=totals(current),lines=[];
  lines.push(`Riyadh/UTC guard: ${Object.entries(t).map(([k,n])=>`${k} ${n}`).join(' · ')}`);
  for(const r of regressions)lines.push('  ✖ '+describe(r));
  if(improvements.length&&!regressions.length)lines.push(`  ${improvements.length} file(s) now count below the baseline. Lock it in: node scripts/riyadh-time-guard.mjs --tighten`);
  for(const line of lines)log(line);
  return {ok:!regressions.length,lines,regressions,improvements};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flag=process.argv[2];
  if(flag==='--rebaseline'){const current=measure();writeFileSync(BASELINE_PATH,JSON.stringify(stamp(current),null,1)+'\n');console.log('Baseline rewritten:',JSON.stringify(totals(current)));}
  else if(flag==='--tighten'){
    const current=measure(),{regressions,improvements}=compare(loadBaseline(),current);
    if(regressions.length){for(const r of regressions)console.error('  ✖ '+describe(r));console.error('Refusing to tighten: counts rose.');process.exit(1);}
    writeFileSync(BASELINE_PATH,JSON.stringify(stamp(current),null,1)+'\n');console.log(`Baseline tightened: ${improvements.length} file(s) lowered.`,JSON.stringify(totals(current)));
  }else if(!runGuard().ok)process.exit(1);
}
