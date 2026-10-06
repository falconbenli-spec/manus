import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { createApp } from '../app/server.mjs';

test('معاينة الجوال: عنوان محدد وجلسة آمنة ومنع الوصول غير المصرح',async t=>{
  const db=openDb(':memory:');seed(db,'synthetic-preview-only');t.after(()=>db.close());
  assert.throws(()=>createApp(db,{previewOrigin:'http://example.com'}));
  assert.throws(()=>createApp(db,{previewOrigin:'https://example.trycloudflare.com/path'}));
  const origin='https://example.trycloudflare.com',server=createApp(db,{previewOrigin:origin});
  async function call(path,{host='example.trycloudflare.com',origin:requestOrigin,method='GET',cookie,csrf,input}={}) {
    const req={url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host,...(requestOrigin?{origin:requestOrigin}:{}),...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),'content-type':'application/json'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(input??{}));}};
    const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};
    await server.listeners('request')[0](req,res);return res;
  }
  assert.equal((await call('/')).status,200);
  assert.equal((await call('/',{host:'attacker.trycloudflare.com'})).status,403);
  assert.equal((await call('/',{host:'localhost'})).status,403);
  assert.equal((await call('/api/login',{method:'POST',origin:'https://attacker.example'})).status,403);
  assert.equal((await call('/api/requests')).status,401);
  assert.equal((await call('/.env')).status,401);
  const response=await call('/api/login',{method:'POST',origin,input:{username:'manager',password:'synthetic-preview-only'}});
  assert.equal(response.status,200);assert.match(response.headers['Set-Cookie'],/; Secure$/);
  const cookie=response.headers['Set-Cookie'].split(';')[0],csrf=JSON.parse(response.body).csrf;
  assert.equal((await call('/api/me',{cookie})).status,200);
  assert.equal((await call('/api/logout',{method:'POST',origin,cookie})).status,403);
  assert.equal((await call('/api/logout',{method:'POST',origin,cookie,csrf})).status,200);
  assert.equal((await call('/api/me',{cookie})).status,401);
});
