import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';
import { dispatch } from './definitions-fixture.mjs';

const PASSWORD='synthetic-cockpit-integration';

test('served cockpit assets and platform route agree with capabilities',async t=>{
  const db=openDb(':memory:');seed(db,PASSWORD);t.after(()=>db.close());
  const app=createApp(db,{buildAtBoot:{commit:'a'.repeat(40),source_digest:'b'.repeat(64),files:712,computed_at:new Date().toISOString()}});
  const login=async username=>(await dispatch(app,{method:'POST',path:'/api/login',body:{username,password:PASSWORD}})).headers['Set-Cookie'].split(';')[0];
  for(const path of ['/executive-cockpit-ui.mjs','/admin-cockpit-ui.mjs','/cockpit.css']){
    const response=await dispatch(app,{path});
    assert.equal(response.status,200,path);
    assert.ok(response.text.length>100,path);
  }
  assert.equal((await dispatch(app,{path:'/api/platform-health',headers:{cookie:await login('employee')}})).status,403);
  assert.equal((await dispatch(app,{path:'/api/platform-health',headers:{cookie:await login('admin')}})).status,200);
});

test('browser shell routes executive and platform health to their new renderers',()=>{
  const source=readFileSync(new URL('../app/static/app.mjs',import.meta.url),'utf8');
  assert.match(source,/import \{ executiveCockpitUI \} from '\.\/executive-cockpit-ui\.mjs'/);
  assert.match(source,/import \{ adminCockpitUI \} from '\.\/admin-cockpit-ui\.mjs'/);
  assert.match(source,/nav\.push\(\['platform-health'/);
  assert.match(source,/adminCockpitUI\.render/);
  assert.match(source,/executiveCockpitUI\.render/);
  assert.match(source,/api\('\/platform-health'\)/);
});

test('document and offline cache include the cockpit stylesheet and modules',()=>{
  const html=readFileSync(new URL('../app/static/index.html',import.meta.url),'utf8');
  const sw=readFileSync(new URL('../app/static/sw.js',import.meta.url),'utf8');
  assert.match(html,/href="\/cockpit\.css"/);
  for(const path of ['/cockpit.css','/executive-cockpit-ui.mjs','/admin-cockpit-ui.mjs'])assert.ok(sw.includes(`'${path}'`),path);
});
