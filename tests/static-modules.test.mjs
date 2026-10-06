import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';

// وحدة واجهة تُستورد ولا يقدمها الخادم تكسر الصفحة كلها في المتصفح دون أن يفشل أي اختبار خلفي.
test('every module and stylesheet the interface imports is actually served',async t=>{
  const db=openDb(':memory:');seed(db,'synthetic-static');
  const server=createApp(db);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const base=`http://127.0.0.1:${server.address().port}`,dir=new URL('../app/static/',import.meta.url),wanted=new Set();
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.mjs'))){
    const source=readFileSync(new URL(name,dir),'utf8');
    for(const m of source.matchAll(/(?:from|import)\s*\(?['"]\.\/([\w.-]+\.(?:mjs|css))['"]/g))wanted.add(m[1]);
  }
  for(const m of readFileSync(new URL('index.html',dir),'utf8').matchAll(/(?:href|src)="\/?([\w.-]+\.(?:mjs|css))"/g))wanted.add(m[1]);
  assert.ok(wanted.size>20,'the scan found the interface modules');
  const missing=[];
  for(const name of wanted){const response=await fetch(`${base}/${name}`);await response.arrayBuffer();if(response.status!==200)missing.push(`${name}:${response.status}`);}
  assert.deepEqual(missing,[]);
});
