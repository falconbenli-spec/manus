import { readdirSync,readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { validateTraceability,digest } from './trace.mjs';
import { migrationPlan } from '../app/db.mjs';
import { runRatchet } from './quality-ratchet.mjs';
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);}
let checked=0;
for(const file of ['app','scripts','tests'].flatMap(files).filter(f=>f.endsWith('.mjs'))){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);checked++;
}
const manifest=JSON.parse(readFileSync('sources/manifest.json','utf8'));
for(const [file,hash] of Object.entries(manifest.files)) assert.equal(digest(readFileSync('sources/'+file)),hash,'Source changed: '+file);
for(const path of ['app','scripts','tests'].flatMap(files).filter(p=>p.endsWith('.mjs')||p.endsWith('.html'))){
  const source=readFileSync(path,'utf8');
  if(path.startsWith('app/')) assert.ok(!source.includes('eval('),'Unexpected dynamic evaluation: '+path);
  assert.ok(!/\b(?:sk_live_|ghp_)[A-Za-z0-9]{20,}/.test(source),'Possible embedded credential: '+path);
}
const html=readFileSync('app/static/index.html','utf8');
assert.ok(html.includes('lang="ar"')&&html.includes('dir="rtl"'));
// الترحيلات: رقمٌ مكرَّر أو اسمٌ لا يُقرأ يُكتشف هنا — قبل الدمج وقبل النشر — لا عند الإقلاع.
// لأن اكتشافه عند الإقلاع يعني قاعدةً مُرحَّلة نصفَ ترحيل وخدمةً لا تفتح (app/db.mjs: migrationPlan).
const migrations=migrationPlan(readdirSync('app/migrations'));
const summary=validateTraceability();
console.log(`Syntax checked: ${checked} JavaScript modules. Source hashes match. Traceability: ${summary.total} requirements / ${summary.domains} domains. Migrations: ${migrations.length} planned, highest ${migrations.at(-1).version}.`);
// المسنّنة (م0 «السور»): المكوّنات المحلية والرفض القصير وعبارات الحالة خارج القاموس مقابل scripts/quality-baseline.json، وسلامة الروابط صفرًا.
// العدّ ينزل فقط والملف الجديد يبدأ من صفر. تطبع أي ملف تراجع وبكم، وتكلف أجزاء من الثانية (scripts/quality-ratchet.mjs).
const ratchet=await runRatchet();
if(!ratchet.ok){
  console.error('Quality ratchet failed: counts may only fall, a new file starts at zero, and every #view/intent link must resolve. See the ✖ lines above.');
  console.error('Use the shared kit (ctx.ui in app/static/kit.mjs), the vocabulary (app/static/vocabulary.mjs) and refuse() (app/refusal.mjs) instead of a new local copy.');
  process.exit(1);
}
console.log('Checks cover syntax, source integrity, traceability and the quality ratchet. No TypeScript compiler or production bundle is configured for this JavaScript build.');
