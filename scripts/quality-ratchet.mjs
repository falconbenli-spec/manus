// المسنّنة (م0 «السور»): أربعة مقاييس تُعدّ في كل ملف وتُقارن بخط أساس مُلتزَم (scripts/quality-baseline.json).
// القاعدة: العدّ ينزل فقط، والملف الجديد يبدأ من صفر. لا تعيد كتابة الـ88 وحدة؛ تمنع أن تزداد، وتجعل العدّة والقاموس
// ومعيار الرفض الطريق الأسهل لأن الطريق القديم يُرفض عند أول سطر جديد منه.
//   (أ) primitives       تعريف محلي لمكوّن في ملف واجهة: tile وrow وcard وempty وtable وpageHead وbadge وstatusBadge وstatusNames وroleNames
//   (ب) short_refusals   رسالة رفض fail(…) نصها 25 حرفًا أو أقل في ملف خادم («الإجراء غير متاح»)
//   (ج) status_literals  عبارة حالة خارج القاموس: العبارات الممنوعة، وأي خريطة محلية تحمل ستًّا من الحالات الثماني
//   (د) links            حرفية «#view/intent» في app/static لا تصل إلى شاشة مسجلة أو نية مسجلة — هذه ليست مسنّنة: يجب أن تكون صفرًا
// الاستعمال:  node scripts/quality-ratchet.mjs            يقيس ويقارن (وهو ما يستدعيه npm run check)
//             node scripts/quality-ratchet.mjs --tighten  يُنزل خط الأساس إلى العدّ الحالي حيث نزل، ويرفض أن يرفع رقمًا
//             node scripts/quality-ratchet.mjs --rebaseline  يعيد كتابة خط الأساس كله. يرفع أرقامًا، فلا يُستعمل إلا بقرار يُكتب في رسالة الالتزام
// سريعة عمدًا: قراءة نصوص وتعابير نمطية، بلا تشغيل عمليات. تُستورد وحدها في الاختبارات (tests/links.test.mjs).
import { readdirSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BANNED_STATUS_PHRASES,REQUEST_STATUSES } from '../app/static/vocabulary.mjs';
import { resolveLink,BUILTIN_VIEWS } from '../app/static/deep-links.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const BASELINE_PATH=join(ROOT,'scripts/quality-baseline.json');
const list=dir=>readdirSync(join(ROOT,dir)).filter(f=>f.endsWith('.mjs')).sort().map(f=>`${dir}/${f}`);
const read=path=>readFileSync(join(ROOT,path),'utf8');

// مصدرا الحقيقة لا يُعدّان على نفسيهما.
const SHARED=new Set(['app/static/kit.mjs','app/static/vocabulary.mjs']);
export const METRICS={primitives:'مكوّن محلي',short_refusals:'رفض قصير',status_literals:'عبارة حالة خارج القاموس',bidi_unisolated:'قيمة لاتينية بلا عزل اتجاه',direct_person_reads:'قراءة مباشرة لبيانات الأشخاص'};

/* ───── (أ) المكوّنات المحلية ───── */
const RENDERERS=['tile','tileOf','row','card','empty','table','pageHead','badge','statusBadge'];
const DICTIONARIES=['statusNames','roleNames'];
// دالة باسم مكوّن: سهمية أو function. «const row=list.find(…)» متغير بيانات لا مكوّن، فلا يطابق.
const RENDERER=new RegExp(`(?:\\b(?:const|let|var)\\s+|,\\s*)(?:${RENDERERS.join('|')})\\s*=\\s*(?:async\\s*)?(?:\\([^()]*\\)|[\\w$]+)\\s*=>|\\bfunction\\s+(?:${RENDERERS.join('|')})\\s*\\(`,'g');
const DICTIONARY=new RegExp(`(?:\\b(?:const|let|var)\\s+|,\\s*)(?:${DICTIONARIES.join('|')})\\s*=\\s*\\{`,'g');
export const countPrimitives=source=>(source.match(RENDERER)?.length??0)+(source.match(DICTIONARY)?.length??0);

/* ───── (ب) الرفض القصير ───── */
// fail(403,'code','نص') بأي علامة اقتباس. النص ذو الاستيفاء (‎${…}‎) يسمّي شيئًا بعينه فلا يُعدّ قصيرًا.
const REFUSAL=/\bfail\(\s*\d{3}\s*,\s*(['"`])[^'"`]*\1\s*,\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g;
export const SHORT_REFUSAL_LIMIT=25;
export function countShortRefusals(source){
  let n=0;
  for(const m of source.matchAll(REFUSAL)){if(m[2]==='`'&&m[3].includes('${'))continue;if([...m[3]].length<=SHORT_REFUSAL_LIMIT)n++;}
  return n;
}

/* ───── (ج) عبارات الحالة خارج القاموس ───── */
// «قيد الاعتماد» هي العبارة القديمة لحالة pending: تبقى حيث كانت عند خط الأساس (نسخ تملكها الموجة الأولى) ولا تُكتب في سطر جديد.
export const STATUS_PHRASES=Object.freeze([...BANNED_STATUS_PHRASES,'قيد الاعتماد']);
const occurrences=(source,phrase)=>source.split(phrase).length-1;
export function countStatusLiterals(source){
  // العبارة الأطول أولًا وتُحذف بعد عدّها، فلا تُعدّ «قيد بانتظار الاعتماد» مرتين.
  let rest=source,n=0;
  for(const phrase of [...STATUS_PHRASES].sort((a,b)=>b.length-a.length)){n+=occurrences(rest,phrase);rest=rest.split(phrase).join('');}
  // خريطة محلية: كائن حرفي يحمل ستًّا على الأقل من الحالات الثماني مفاتيحَ، بأي اسم كان.
  for(const m of source.matchAll(/(?:\b(?:const|let|var)\s+|,\s*)[\w$]+\s*=\s*\{/g)){
    const chunk=source.slice(m.index,m.index+900),end=chunk.indexOf('}'),body=end>0?chunk.slice(0,end+1):chunk;
    if(REQUEST_STATUSES.filter(key=>new RegExp(`[{,\\s]'?${key}'?\\s*:`).test(body)).length>=6)n++;
  }
  return n;
}

/* ───── (هـ) القيم اللاتينية بلا عزل اتجاه ───── */
// رقم مرجع أو رمز خدمة أو اسم ملف أو آيبان داخل جملة عربية: خوارزمية الاتجاه ثنائي الجانب تعيد ترتيب
// ما على حافّتيه من محايدات (- . / : والأرقام)، فيُقرأ «HR-2026-0001» مقلوبًا أو ينقسم. والعلاج عزلٌ
// بـ<bdi> (أو class="ltr"، وكلاهما unicode-bidi:isolate في signature.css) حول القيمة وحدها.
// يُعدّ ما بين وسمين فقط: القيمة داخل سمة (value="${…}") لا تُعزل بوسم، وإقحامه فيها يكسر الترميز.
const LATIN_VALUE=/\b(?:filename|iban|email|username|phone|mobile|url|reference|service_code|code|vat_number|cr_number|account_no)\b/;
// dir="ltr" عزلٌ أيضًا: ورقة المتصفح تعطي كل عنصر يحمل dir قيمة unicode-bidi:isolate.
const ISOLATED=/(?:<bdi\b[^>]*>|class="ltr"[^>]*>|<code\b[^>]*>|dir="ltr"[^>]*>)\s*$/;
// داخل سمة: آخر «>» قبل الموضع يسبقه فتحُ اقتباسٍ لم يُغلق بعدُ في الوسم نفسه.
function inAttribute(source,at){
  const tag=source.lastIndexOf('<',at),close=source.lastIndexOf('>',at);
  if(tag<0||close>tag) return false;
  const head=source.slice(tag,at);
  return /=\s*(['"])(?:(?!\1)[^])*$/.test(head);
}
export function countUnisolated(source){
  let n=0;
  for(const m of source.matchAll(/\$\{e\(([^)]*?)\)\}/g)){
    if(!LATIN_VALUE.test(m[1])) continue;
    if(ISOLATED.test(source.slice(Math.max(0,m.index-90),m.index))) continue;
    if(inAttribute(source,m.index)) continue;
    n++;
  }
  return n;
}

/* ───── (د) سلامة الروابط ───── */
// كل حرفية بين علامتي اقتباس تبدأ بـ«#كلمة» رابطٌ، إلا ما ثبت أنه شيء آخر: محدِّد CSS في نداء querySelector/closest/matches،
// أو معرّف DOM معرَّف بـid="…" في الواجهة، أو لون سداسي، أو توجيه GLSL. القاعدة معكوسة عمدًا: رابط بخطأ إملائي في اسم شاشته
// («#leav/new») لا يشبه شاشة مسجلة، فلو كانت القاعدة «ما يشبه شاشة فهو رابط» لمرّ صامتًا. هنا يُعدّ غير محلول.
const TOKEN=/(['"`])#([a-z][a-z0-9-]*)((?:[\/?][^'"`\s<>)]*)?)/g;
const SELECTOR_CALL=/(?:querySelector(?:All)?|closest|matches)\??\.?\(\s*$/;
const SELECTOR_ATTR=/data-filter=$/;
export function scanLinks(path,source,{screens,domIds}){
  const found=[];
  for(const m of source.matchAll(TOKEN)){
    const [whole,,view,tail]=m,before=source.slice(Math.max(0,m.index-40),m.index),after=source[m.index+whole.length]??'';
    if(SELECTOR_CALL.test(before)||SELECTOR_ATTR.test(before))continue;
    // محدِّد مركّب أو توجيه GLSL: يتبع الاسمَ فراغ أو رمز CSS لا علامة الإغلاق.
    if(!tail&&/[\s.\[>,:+~]/.test(after))continue;
    const known=screens.has(view);
    if(!known&&!tail&&(domIds.has(view)||/^[0-9a-f]{3,8}$/.test(view)))continue;
    // المقطع المتغير يُقطع عند ‎${‎: «#request/${id}» تُفحص «#request/».
    const literal=('#'+view+tail).split('${')[0];
    const verdict=resolveLink(literal,screens);
    found.push({file:path,line:source.slice(0,m.index).split('\n').length,literal:'#'+view+tail,ok:verdict.ok,reason:verdict.reason??null});
  }
  return found;
}
export async function knownScreens(){
  const {operationModules}=await import('../app/static/operations.mjs');
  return new Set([...Object.keys(operationModules),...BUILTIN_VIEWS]);
}
export function domIdentifiers(){
  const ids=new Set(),dir=join(ROOT,'app/static');
  for(const file of readdirSync(dir).filter(f=>/\.(mjs|html|js)$/.test(f)))for(const m of readFileSync(join(dir,file),'utf8').matchAll(/\bid=\\?["']([\w-]+)["']/g))ids.add(m[1]);
  return ids;
}

/* ───── (و) القراءة المباشرة لبيانات الأشخاص — سقف D3 (TP2.7) ───── */
// جداول الأشخاص الثلاثة تُقرأ اليوم من كل مكان مباشرةً. والهدف (D3) أن تمرّ القراءة بمساعدٍ واحد
// يفرض النطاق والحجب في موضع واحد، بدل أن يُعاد الحكم في كل استعلام. ولا يُبنى المساعد بقرار واحد:
// يُبنى ويُهاجَر إليه على دفعات. فالسقف هنا يقيس ما بقي خارجه، وينزل مع كل هجرة ولا يصعد أبدًا —
// فلا تُضاف قراءةٌ مباشرة جديدة وهو يُبنى.
const PERSON_TABLES = ['users', 'employee_profiles', 'employment_contracts'];
// المساعد نفسه يقرأ مباشرةً بحكم عمله، فلا يُعدّ على نفسه حين يوجد.
const PERSON_READER = new Set(['app/people-read.mjs']);
const PERSON_READ = new RegExp(String.raw`\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:${PERSON_TABLES.join('|')})\b`, 'gi');
export const countDirectPersonReads = source => (source.match(PERSON_READ) ?? []).length;

/* ───── القياس والمقارنة ───── */
const keep=counts=>Object.fromEntries(Object.entries(counts).filter(([,n])=>n>0));
export async function measure(){
  const ui=list('app/static').filter(p=>!SHARED.has(p)),server=list('app'),everything=[...server,...ui];
  const screens=await knownScreens(),domIds=domIdentifiers();
  const links=list('app/static').flatMap(path=>scanLinks(path,read(path),{screens,domIds}));
  return {
    primitives:keep(Object.fromEntries(ui.map(p=>[p,countPrimitives(read(p))]))),
    short_refusals:keep(Object.fromEntries(server.map(p=>[p,countShortRefusals(read(p))]))),
    status_literals:keep(Object.fromEntries(everything.map(p=>[p,countStatusLiterals(read(p))]))),
    bidi_unisolated:keep(Object.fromEntries(ui.map(p=>[p,countUnisolated(read(p))]))),
    direct_person_reads:keep(Object.fromEntries(server.filter(p=>!PERSON_READER.has(p)).map(p=>[p,countDirectPersonReads(read(p))]))),
    links:{checked:links.length,unresolved:links.filter(l=>!l.ok)}
  };
}
export const totals=measured=>Object.fromEntries(Object.keys(METRICS).map(k=>[k,Object.values(measured[k]??{}).reduce((a,b)=>a+b,0)]));

// نقية: تأخذ خط أساس وقياسًا وتعيد ما ارتفع وما نزل. ملف ليس في خط الأساس أساسه صفر.
export function compare(baseline,current){
  const regressions=[],improvements=[];
  for(const metric of Object.keys(METRICS)){
    const was=baseline[metric]??{},now=current[metric]??{};
    for(const file of new Set([...Object.keys(was),...Object.keys(now)])){
      const a=was[file]??0,b=now[file]??0;
      if(b>a)regressions.push({metric,file,from:a,to:b,delta:b-a,fresh:!(file in was)});
      else if(b<a)improvements.push({metric,file,from:a,to:b,delta:b-a});
    }
  }
  return {regressions,improvements};
}
export const describe=r=>`${r.file}: ${METRICS[r.metric]} ${r.from} → ${r.to} (${r.delta>0?'+':''}${r.delta})${r.fresh?' — ملف جديد، وأساس الملف الجديد صفر':''}`;

const stamp=measured=>({note:'خط أساس المسنّنة (م0 «السور»). العدّ ينزل فقط، والملف الجديد يبدأ من صفر. يُنزَل بـ node scripts/quality-ratchet.mjs --tighten ولا يُحرَّر باليد.',
  short_refusal_limit:SHORT_REFUSAL_LIMIT,totals:totals(measured),...Object.fromEntries(Object.keys(METRICS).map(k=>[k,measured[k]]))});
export const loadBaseline=()=>JSON.parse(readFileSync(BASELINE_PATH,'utf8'));

// ما يستدعيه scripts/check.mjs: يعيد {ok, lines}. يطبع أي ملف تراجع وبكم.
export async function runRatchet({log=console.log}={}){
  if(!existsSync(BASELINE_PATH))return {ok:false,lines:['لا خط أساس: scripts/quality-baseline.json مفقود. ولّده بـ node scripts/quality-ratchet.mjs --rebaseline']};
  const started=performance.now(),baseline=loadBaseline(),current=await measure(),{regressions,improvements}=compare(baseline,current);
  const t=totals(current),b=baseline.totals??totals(baseline),lines=[];
  lines.push(`Quality ratchet: local primitives ${t.primitives} (baseline ${b.primitives}) · short refusals ${t.short_refusals} (baseline ${b.short_refusals}) · status literals outside the vocabulary ${t.status_literals} (baseline ${b.status_literals}) · Latin values without direction isolation ${t.bidi_unisolated} (baseline ${b.bidi_unisolated}) · direct person-table reads ${t.direct_person_reads} (baseline ${b.direct_person_reads}) · links ${current.links.checked} checked, ${current.links.unresolved.length} unresolved · ${Math.round(performance.now()-started)} ms`);
  for(const r of regressions)lines.push('  ✖ '+describe(r));
  for(const l of current.links.unresolved)lines.push(`  ✖ ${l.file}:${l.line}: الرابط «${l.literal}» لا يصل — ${l.reason}`);
  if(improvements.length&&!regressions.length)lines.push(`  ${improvements.length} file(s) now score below the baseline (${improvements.reduce((n,i)=>n+i.delta,0)}). Lock it in: node scripts/quality-ratchet.mjs --tighten`);
  for(const line of lines)log(line);
  return {ok:!regressions.length&&!current.links.unresolved.length,lines,regressions,improvements,unresolved:current.links.unresolved};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flag=process.argv[2];
  if(flag==='--rebaseline'){
    const current=await measure();writeFileSync(BASELINE_PATH,JSON.stringify(stamp(current),null,1)+'\n');
    console.log('Baseline rewritten:',JSON.stringify(totals(current)),'· unresolved links:',current.links.unresolved.length);
  }else if(flag==='--tighten'){
    const baseline=loadBaseline(),current=await measure(),{regressions,improvements}=compare(baseline,current);
    if(regressions.length){for(const r of regressions)console.error('  ✖ '+describe(r));console.error('Refusing to tighten: counts rose. Fix the regressions first.');process.exit(1);}
    writeFileSync(BASELINE_PATH,JSON.stringify(stamp(current),null,1)+'\n');
    console.log(`Baseline tightened: ${improvements.length} file(s) lowered.`,JSON.stringify(totals(current)));
  }else{
    const result=await runRatchet();if(!result.ok)process.exit(1);
  }
}
