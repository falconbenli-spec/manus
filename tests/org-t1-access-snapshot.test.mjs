// ق-ت1-8: حارس الصلاحيات. لا يتغيّر من يطلب ومن يعتمد ومن ينفّذ دون تغيير مقصود ومراجع.
// لكل حساب نشط في المستأجر 36t ثلاثة أعمدة محسوبة من المحرك نفسه لا من الواجهة:
//   requests — رموز الخدمات التي يراها في الدليل ويطلبها (catalog). فارغ لحساب إدارة المنصة لأن createRequest يرفضه.
//   approves — لكل صاحب طلب R ولكل خدمة s (أحدث نسخة): planApprovals بحمولة مولّدة من تعريف الحقول،
//              مقلوبة على المعتمد: "CODE<-R@position". ورفض الخطة يُسجَّل عند صاحب الطلب في refused: "CODE!code".
//   queue    — native: الخدمات التي هو من منفذيها الأصليين (nativeExecutors) في إدارتها المالكة.
//              fallback: "CODE@basis" حين تنتقل السلسلة (executionChain على طلب بلا صاحب) إلى نائب أو سُلَّم التصعيد.
// الأساس يحفظ ت1، ويشمل تصحيح 3 أكتوبر 2026 الذي يمنع احتساب قرار شخص واحد اعتمادين.
// يعاد التوليد بعد تغيير مقصود ومراجع فقط:
//   UPDATE_ACCESS_SNAPSHOT=1 node --test tests/org-t1-access-snapshot.test.mjs
//   git diff tests/org-t1-access-snapshot.baseline.json
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from '../app/db.mjs';
import { seed } from '../scripts/seed.mjs';
import { installServiceCatalog, catalogServices } from '../app/service-catalog.mjs';
import { expandDemo } from '../scripts/expand-demo.mjs';
import { payloadForStored } from '../scripts/qa-catalog-sweep.mjs';
import * as wf from '../app/workflow.mjs';

const BASELINE=fileURLToPath(new URL('./org-t1-access-snapshot.baseline.json',import.meta.url));
const TENANT='36t';
// الوقت مجمّد: حدود الاعتماد تُقرأ بتاريخ اليوم، والحمولة تولّد تواريخ نسبية، وexpandDemo يأخذ السنة من الساعة.
const FROZEN=Date.parse('2026-09-25T09:00:00.000Z');
const sorted=list=>[...list].sort((a,b)=>a<b?-1:a>b?1:0);

export function accessSnapshot(){
  const db=openDb(':memory:');
  try{
    seed(db,'synthetic-access-snapshot-only');installServiceCatalog(db);expandDemo(db);
    const users=db.prepare('SELECT * FROM users WHERE tenant_id=? AND active=1 ORDER BY id').all(TENANT);
    const services=wf.catalog(db,users[0],{includeHidden:true}).sort((a,b)=>a.code<b.code?-1:1);
    const model=code=>catalogServices.find(s=>s.code===code)?.fields??null;
    const rows=Object.fromEntries(users.map(u=>[u.id,{role:u.role,department_id:u.department_id,requests:[],approves:[],refused:[],queue:{native:[],fallback:[]}}]));
    for(const u of users)rows[u.id].requests=u.role==='admin'?[]:sorted(wf.catalog(db,u).map(s=>s.code));
    for(const requester of users){
      if(requester.role==='admin')continue;
      for(const s of services){
        let plan;
        try{plan=wf.planApprovals(db,requester,s,payloadForStored(s.fields,model(s.code)),null).plan;}
        catch(error){rows[requester.id].refused.push(`${s.code}!${error.code??error.message}`);continue;}
        for(const step of plan){
          const row=rows[step.approver_id]??(rows[step.approver_id]={role:null,department_id:null,requests:[],approves:[],refused:[],queue:{native:[],fallback:[]},inactive:true});
          row.approves.push(`${s.code}<-${requester.id}@${step.position}`);
        }
      }
    }
    for(const s of services){
      for(const p of wf.nativeExecutors(db,s,s.department_id,TENANT))rows[p.id]?.queue.native.push(s.code);
      const stub={id:'access-snapshot-stub',tenant_id:TENANT,requester_id:null,revision:1,service_id:s.id,handling_department_id:null};
      const chain=wf.executionChain(db,s,stub,s.department_id);
      if(chain.basis==='deputy'||chain.basis==='escalation')for(const p of chain.people)rows[p.id]?.queue.fallback.push(`${s.code}@${chain.basis}`);
    }
    for(const row of Object.values(rows)){row.approves=sorted(row.approves);row.refused=sorted(row.refused);row.queue.native=sorted(row.queue.native);row.queue.fallback=sorted(row.queue.fallback);}
    const ids=sorted(Object.keys(rows));
    return {tenant:TENANT,frozen_at:new Date(FROZEN).toISOString(),services:services.length,users:Object.fromEntries(ids.map(id=>[id,rows[id]]))};
  }finally{db.close();}
}

const summary=snap=>{
  const u=Object.values(snap.users),sum=f=>u.reduce((n,r)=>n+f(r),0);
  return {users:u.length,services:snap.services,requests:sum(r=>r.requests.length),approves:sum(r=>r.approves.length),refused:sum(r=>r.refused.length),
    native:sum(r=>r.queue.native.length),fallback:sum(r=>r.queue.fallback.length)};
};

test('ق-ت1-8: مرجع من يطلب ومن يعتمد ومن ينفّذ لكل حساب نشط',t=>{
  t.mock.timers.enable({apis:['Date'],now:FROZEN});
  const snap=accessSnapshot();
  assert.deepEqual(accessSnapshot(),snap,'اللقطة حتمية: حسابان متتاليان يتطابقان');
  if(process.env.UPDATE_ACCESS_SNAPSHOT==='1'){
    writeFileSync(BASELINE,JSON.stringify({note:'ق-ت1-8: مرجع صلاحيات ت1 بعد تصحيح 2026-10-03 لمنع احتساب قرار شخص واحد اعتمادين. يُعاد توليده بعد تغيير مقصود ومراجع فقط، ويُراجَع الفرق.',
      summary:summary(snap),...snap},null,1)+'\n');
    t.diagnostic(`baseline written: ${JSON.stringify(summary(snap))}`);
    return;
  }
  assert.ok(existsSync(BASELINE),'لا ملف أساس. ولّده مرة: UPDATE_ACCESS_SNAPSHOT=1 node --test tests/org-t1-access-snapshot.test.mjs');
  const {note,summary:expectedSummary,...expected}=JSON.parse(readFileSync(BASELINE,'utf8'));
  assert.ok(Object.keys(snap.users).length>=26,'اللقطة تغطي كل الحسابات النشطة');
  const drift=[];
  for(const id of new Set([...Object.keys(expected.users),...Object.keys(snap.users)]))
    if(JSON.stringify(expected.users[id])!==JSON.stringify(snap.users[id]))drift.push(id);
  assert.deepEqual(drift,[],`تغيّرت صلاحيات هذه الحسابات: ${drift.join(', ')}`);
  assert.deepEqual(snap,expected);
  assert.deepEqual(summary(snap),expectedSummary);
});
