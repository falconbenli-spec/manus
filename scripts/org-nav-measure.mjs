#!/usr/bin/env node
// ت1: قياس القائمة الجانبية لكل حساب نشط كما يرسمها غلاف الواجهة فعلًا، على قاعدة تُفتح للقراءة وحدها.
//
//   node scripts/org-nav-measure.mjs --db <copy.sqlite> [--source worktree|<git-ref>] [--json] [--out <file>] [--inventory <inventory_data.json>]
//
// --db       نسخة من قاعدة (لا القاعدة الحية). تُفتح بـ DatabaseSync {readOnly:true} ولا يُنادى openDb عليها،
//            فلا ترحيل ولا كتابة. تُحسب بصمة sha256 للملف قبل القياس وبعده وتُكتب في المخرج.
// --source   worktree (الافتراضي): app/static كما هو في شجرة العمل. أو مرجع git (مثل 37cef8b): تُستخرج
//            ملفات app/static بذلك المرجع بـ git show إلى مجلد مؤقت، فيُقاس الغلاف القديم بوحداته القديمة.
// me         يُبنى كما يبنيه userView في app/server.mjs لـ /api/me: publicUser + can/scopes من capabilitiesFor
//            + capabilities.finance + delivery_member + admin_level. must_change_password يُسقط: القياس للقائمة
//            التي يصلها الحساب بعد تغيير كلمة المرور، ويُعدّ أصحاب العلم في الملخص.
// الحصاد    يُقرأ app.mjs نصًا، وتُستبدل استيراداته الثابتة بربط أسمائها بالوحدات الحقيقية (import ديناميكي
//            من المجلد نفسه)، ثم يُشغَّل في vm بـ document/localStorage/fetch مصطنعة كما في
//            tests/employee-ux.test.mjs. يعمل للغلاف القديم وللجديد الذي يستورد nav-map.mjs وغيرها.
//            العدد = طول navItems (ما يمر إلى groupedNavigation)، و«أخرى» تُقرأ من HTML الشريط الجانبي المرسوم.
// لا يُخرج أسماء أشخاص: المعرّف والدور والإدارة والمفاتيح فقط.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const TENANT='36t';
const OTHER='أخرى';

const arg=name=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:null;};
const sha256=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

// ── مصدر app/static ──────────────────────────────────────────────────────────
export function staticDir(source){
  if(!source||source==='worktree')return {dir:join(ROOT,'app/static'),cleanup(){}};
  const commit=execFileSync('git',['rev-parse','--verify',`${source}^{commit}`],{cwd:ROOT,encoding:'utf8'}).trim();
  const dir=mkdtempSync(join(tmpdir(),'org-nav-'));
  const files=execFileSync('git',['ls-tree','-r','--name-only',commit,'--','app/static'],{cwd:ROOT,encoding:'utf8'}).split('\n').filter(f=>f.endsWith('.mjs'));
  for(const file of files){
    const target=join(dir,file.slice('app/static/'.length));
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,execFileSync('git',['show',`${commit}:${file}`],{cwd:ROOT,maxBuffer:64<<20}));
  }
  return {dir,commit,cleanup(){rmSync(dir,{recursive:true,force:true});}};
}

// ── استبدال الاستيرادات الثابتة بأسماء مربوطة بالوحدات الحقيقية ──────────────────
const IMPORT=/^import\s+(?:(\*\s+as\s+\w+)|(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
export async function loadShell(dir){
  let source=readFileSync(join(dir,'app.mjs'),'utf8');
  const bindings={},modules=[];
  for(const [,star,def,named,spec] of source.matchAll(IMPORT)){
    const mod=await import(pathToFileURL(resolve(dir,spec)).href);
    modules.push(spec);
    if(star)bindings[star.split(/\s+as\s+/)[1].trim()]=mod;
    if(def)bindings[def]=mod.default;
    for(const part of (named??'').split(',').map(s=>s.trim()).filter(Boolean)){
      const [from,as=from]=part.split(/\s+as\s+/).map(s=>s.trim());
      bindings[as]=mod[from];
    }
  }
  source=source.replace(IMPORT,'');
  if(/^import\s/m.test(source))throw Error('app.mjs has a static import this harness did not bind');
  return {source,bindings,modules};
}

// ── me كما يبنيه /api/me ─────────────────────────────────────────────────────
async function meBuilder(db){
  const access=await import(pathToFileURL(join(ROOT,'app/access.mjs')).href);
  const finance=await import(pathToFileURL(join(ROOT,'app/finance.mjs')).href);
  const { publicUser }=await import(pathToFileURL(join(ROOT,'app/auth.mjs')).href);
  const member=db.prepare('SELECT (EXISTS(SELECT 1 FROM client_members WHERE user_id=?) OR EXISTS(SELECT 1 FROM project_members WHERE user_id=?)) AS m');
  return u=>{
    const grants=access.capabilitiesFor(db,u);
    const {must_change_password,...pub}=publicUser(u);
    return {...pub,name:u.id,view_as:null,admin_level:u.admin_level??null,can:grants.list,scopes:grants.scopes,
      capabilities:{finance:finance.financeCapabilities(db,u).includes('read')},appearance:null,delivery_member:!!member.get(u.id,u.id).m};
  };
}

// ── تشغيل الغلاف لحساب واحد ──────────────────────────────────────────────────
async function navFor(shell,me){
  const nodes=new Map(),recorded={};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',hidden:false,open:false,dataset:{},style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    setAttribute(){},removeAttribute(){},addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},closest(){return null;},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const documentElement={dataset:{},lang:'',dir:''};
  const ok=body=>({ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)});
  const bindings={...shell.bindings};
  if(typeof bindings.groupedNavigation==='function'){
    const real=bindings.groupedNavigation;
    bindings.groupedNavigation=(items,...rest)=>{
      recorded.items=items.map(i=>i[0]);recorded.reachOption=Array.isArray(rest[2]?.reach)&&rest[2].reach.length>0;
      return recorded.html=real(items,...rest);
    };
  }
  const sandbox={console:{log(){},warn(){},error(){},info(){}},URL,URLSearchParams,Intl,Date,Math,JSON,Uint8Array,Promise,Map,Set,WeakMap,
    location:{hash:'#home',pathname:'/',search:''},history:{replaceState(){},pushState(){}},navigator:{},
    localStorage:{getItem(){return null;},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    crypto:{randomUUID},setTimeout(){},clearTimeout(){},requestAnimationFrame(){},matchMedia:()=>({matches:false,addEventListener(){}}),
    document:{querySelector:node,getElementById:id=>node('#'+id),querySelectorAll:()=>[],documentElement,body:node('body'),addEventListener(){},createElement:()=>node(randomUUID())},
    window:{addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})},
    FormData:class{},CustomEvent:class{},
    fetch:async path=>{
      const p=String(path);
      if(p==='/api/me')return ok({user:me,csrf:'measure',environment:'local',timezone:'Asia/Riyadh'});
      if(p.endsWith('/count'))return ok({total:0,unread:0});
      return ok([]);
    },
    ...bindings};
  // الأسماء المستوردة تُعرَّف في نطاق الدالة الخارجية بـ const لا تُكتب، كما هي في الوحدة.
  const script='(async()=>{'+shell.source+'\n;globalThis.__measure={render,nav:()=>{try{return navItems;}catch{return null;}}};})()';
  await runInNewContext(script,sandbox,{filename:'app.mjs'});
  await sandbox.__measure.render();await setImmediate();
  const navItems=sandbox.__measure.nav();
  const keys=Array.isArray(navItems)?navItems.map(i=>i[0]):recorded.items??[];
  const html=node('#app').innerHTML;
  const aside=html.match(/<aside[^>]*class="sidebar"[\s\S]*?<\/aside>/)?.[0]??'';
  const navHtml=recorded.html??aside;
  const otherMatch=navHtml.match(new RegExp(`data-group="${OTHER}"[\\s\\S]*?hr-nav-total">(\\d+)<`));
  const hasOther=!!otherMatch||new RegExp(`data-group="${OTHER}"|>\\s*${OTHER}\\s*<`).test(navHtml);
  // الغلاف الجديد: navItems قائمة الوصول كلها، والظاهر ما يرسمه groupedNavigation خارج كتلة «كل شاشاتك» المخفية
  // (<div class="nav-reach" data-nav-reach hidden> في hr-design.mjs). الغلاف القديم لا يمرر reach: الظاهر = navItems.
  const visible=recorded.reachOption?(stripHidden(navHtml).match(/<a\s+href="#[^"]*"/g)??[]).map(a=>a.slice(a.indexOf('#')+1,-1)):keys;
  return {keys,reach:keys.length,sidebar:visible.length,sidebar_keys:visible,other_group:hasOther,other_entries:otherMatch?Number(otherMatch[1]):(hasOther?null:0),audience:documentElement.dataset.audience??null};
}
// يحذف كل عنصر div يحمل data-nav-reach أو hidden مع ما بداخله، بموازنة وسوم div المتداخلة.
function stripHidden(html){
  let out='',i=0;
  const open=/<div\b[^>]*>/g;
  while(i<html.length){
    open.lastIndex=i;const m=open.exec(html);
    if(!m){out+=html.slice(i);break;}
    if(!/\bdata-nav-reach\b|\shidden(?=[\s>=])/.test(m[0])){out+=html.slice(i,open.lastIndex);i=open.lastIndex;continue;}
    out+=html.slice(i,m.index);
    let depth=1,j=open.lastIndex;const tag=/<div\b[^>]*>|<\/div>/g;
    while(depth&&j<html.length){tag.lastIndex=j;const t=tag.exec(html);if(!t){j=html.length;break;}depth+=t[0][1]==='/'?-1:1;j=tag.lastIndex;}
    i=j;
  }
  return out;
}


// ── القياس ───────────────────────────────────────────────────────────────────
// القائمة المتمايزة = الدور + مجموعة مفاتيح الوصول نفسها (كما جمعها جرد ت0).
const menuSig=a=>`${a.role}::${[...a.keys].sort().join('|')}`;
const range=list=>list.length?(Math.min(...list)===Math.max(...list)?`${list[0]}`:`${Math.min(...list)}–${Math.max(...list)}`):'—';
export async function measure({db:dbPath,source='worktree'}){
  if(!dbPath||!existsSync(dbPath))throw Error('--db <copy.sqlite> is required');
  const before=sha256(dbPath);
  const db=new DatabaseSync(dbPath,{readOnly:true});
  const where=staticDir(source);
  try{
    const shell=await loadShell(where.dir),me=await meBuilder(db);
    const users=db.prepare('SELECT * FROM users WHERE tenant_id=? AND active=1 ORDER BY id').all(TENANT);
    const accounts=[];
    for(const u of users){
      const r=await navFor(shell,me(u));
      accounts.push({id:u.id,role:u.role,department_id:u.department_id,must_change_password:!!u.must_change_password,...r});
    }
    const menus=new Map();
    for(const a of accounts){
      const sig=menuSig(a);
      if(!menus.has(sig))menus.set(sig,{role:a.role,departments:new Set(),accounts:[],reach:a.reach,sidebar:[],other_group:a.other_group,other_entries:a.other_entries,keys:a.keys});
      const m=menus.get(sig);m.departments.add(a.department_id);m.accounts.push(a.id);m.sidebar.push(a.sidebar);
    }
    const distinct=[...menus.values()].map(m=>({role:m.role,departments:[...m.departments],accounts:m.accounts.length,account_ids:m.accounts,reach:m.reach,sidebar:range(m.sidebar),
      other_group:m.other_group,other_entries:m.other_entries,keys:m.keys}))
      .sort((a,b)=>a.role.localeCompare(b.role)||b.accounts-a.accounts||a.reach-b.reach);
    const reach=accounts.map(a=>a.reach),side=accounts.map(a=>a.sidebar);
    return {measured_at:new Date().toISOString(),source:source??'worktree',commit:where.commit??null,shell_modules:shell.modules,
      db:{sha256_before:before,sha256_after:null,opened:'DatabaseSync readOnly; openDb not called'},tenant:TENANT,
      summary:{accounts:accounts.length,distinct_menus:distinct.length,reach:range(reach),sidebar:range(side),
        accounts_with_other:accounts.filter(a=>a.other_group).length,must_change_password_accounts:accounts.filter(a=>a.must_change_password).length},
      accounts,menus:distinct};
  }finally{db.close();where.cleanup();}
}

// مقارنة بجرد ت0 (docs/org/data/inventory_data.json → navigation): الدور + مفاتيح الوصول بالترتيب.
export function compareInventory(result,inventoryPath){
  const inv=JSON.parse(readFileSync(inventoryPath,'utf8')).navigation;
  const invMenus=Object.entries(inv).flatMap(([role,list])=>list.map(m=>({role,accounts:m.accounts,departments:m.departments,keys:m.entries.map(e=>e.key),other:m.entries.filter(e=>e.group===OTHER).length})));
  const bySig=new Map(result.menus.map(m=>[`${m.role}::${m.keys.join('|')}`,m]));
  const rows=invMenus.map(m=>{
    const hit=bySig.get(`${m.role}::${m.keys.join('|')}`);
    return {role:m.role,departments:m.departments,inventory_accounts:m.accounts,inventory_entries:m.keys.length,inventory_other:m.other,
      measured:hit?{accounts:hit.accounts,reach:hit.reach,other_entries:hit.other_entries}:null,match:!!hit&&hit.accounts===m.accounts&&hit.other_entries===m.other};
  });
  const invCounts=invMenus.map(m=>m.keys.length);
  return {inventory:{distinct_menus:invMenus.length,accounts:invMenus.reduce((n,m)=>n+m.accounts,0),entries:range(invCounts)},
    measured:{distinct_menus:result.summary.distinct_menus,accounts:result.summary.accounts,entries:result.summary.reach},
    all_match:rows.every(r=>r.match)&&invMenus.length===result.menus.length,menus:rows};
}

// ── جدول قبل/بعد (docs/org/t1/nav-compare.md) ─────────────────────────────────
const BUDGET={employee:8,hr:8,it:8,pm:8,manager:9,admin:9};
export function compareMarkdown(before,after){
  const byId=new Map(after.accounts.map(a=>[a.id,a]));
  const yn=b=>b?'yes':'no';
  const rows=before.menus.map(m=>{
    const now=m.account_ids.map(id=>byId.get(id)).filter(Boolean);
    const side=now.map(a=>a.sidebar),reachAfter=now.map(a=>a.reach),budget=BUDGET[m.role]??null;
    const lost=[...new Set(now.flatMap(a=>m.keys.filter(k=>!a.keys.includes(k))))];
    return {role:m.role,departments:m.departments,accounts:m.accounts,before:m.reach,after:range(side),budget,
      within:now.length===m.accounts&&budget!==null&&side.every(n=>n<=budget),le12:now.length===m.accounts&&side.every(n=>n<=12),
      reach_before:m.reach,reach_after:range(reachAfter),superset:now.length===m.accounts&&!lost.length,lost};
  });
  const lines=[
    '# ت1 — القائمة الجانبية قبل وبعد',
    '',
    `Before: shell at \`${before.commit?.slice(0,7)??before.source}\`. After: working tree (${after.measured_at.slice(0,10)}). Both measured by \`scripts/org-nav-measure.mjs\` on a read-only copy of the M0 backup (sha256 \`${before.db.sha256_before}\`, unchanged before and after each run).`,
    '',
    'One row per distinct old menu (role + identical entry set, as in the T0 inventory). "Before" is the old sidebar (= reach). "After" is the visible sidebar entries in the new shell, excluding the hidden «كل شاشاتك» block, min–max across the menu\'s accounts. Reach after must contain every key reached before.',
    '',
    '| # | Role | Departments | Accounts | Before | After (sidebar) | Budget | Within budget | ≤12 | Reach before | Reach after | Reach ⊇ before |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r,i)=>`| ${i+1} | ${r.role} | ${r.departments.join(', ')} | ${r.accounts} | ${r.before} | ${r.after} | ${r.budget??'—'} | ${yn(r.within)} | ${yn(r.le12)} | ${r.reach_before} | ${r.reach_after} | ${r.superset?'yes':`no (${r.lost.join(', ')})`} |`),
    '',
    `Accounts: ${before.summary.accounts} before, ${after.summary.accounts} after. Old menus with «أخرى»: ${before.summary.accounts_with_other} accounts before, ${after.summary.accounts_with_other} after. Within budget: ${rows.filter(r=>r.within).length}/${rows.length} menus. ≤12: ${rows.filter(r=>r.le12).length}/${rows.length}. Reach kept: ${rows.filter(r=>r.superset).length}/${rows.length}.`,
    '',
    `Three accounts carry \`must_change_password\`; both runs measure the menu they get after changing it. Account identifiers are role ids; no personal names.`,
    ''];
  return {markdown:lines.join('\n'),rows};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(arg('compare-before')){
    const read=p=>JSON.parse(readFileSync(p,'utf8'));
    const {markdown,rows}=compareMarkdown(read(arg('compare-before')),read(arg('compare-after')));
    if(arg('md'))writeFileSync(arg('md'),markdown);
    if(process.argv.includes('--json'))process.stdout.write(JSON.stringify(rows,null,1)+'\n');else process.stdout.write(markdown);
  }else{
    const dbPath=arg('db');
    const result=await measure({db:dbPath,source:arg('source')??'worktree'});
    result.db.sha256_after=sha256(dbPath);
    if(result.db.sha256_after!==result.db.sha256_before)throw Error('the database copy changed during measurement');
    if(arg('inventory'))result.inventory_comparison=compareInventory(result,arg('inventory'));
    const text=JSON.stringify(result,null,1)+'\n';
    if(arg('out'))writeFileSync(arg('out'),text);
    if(process.argv.includes('--json'))process.stdout.write(text);
    else{
      for(const m of result.menus)console.log(`${m.role}\t${m.departments.join(',')}\taccounts=${m.accounts}\treach=${m.reach}\tsidebar=${m.sidebar}\tother=${m.other_group?m.other_entries:'-'}`);
      console.log(JSON.stringify(result.summary));
      if(result.inventory_comparison){const c=result.inventory_comparison;console.log('inventory',JSON.stringify(c.inventory),'measured',JSON.stringify(c.measured),'all_match',c.all_match);
        for(const r of c.menus.filter(r=>!r.match))console.log('MISMATCH',JSON.stringify(r));}
    }
  }
}
