import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../app/db.mjs';
import {seed} from '../scripts/seed.mjs';
import {portal} from '../app/routing.mjs';
import {portalPage} from '../app/static/portal-ui.mjs';
const e=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('بوابة الموظف تستخدم الأيقونات الموحدة وتحتفظ بهوية الطلب والخيارات',t=>{
 const db=openDb(':memory:');seed(db,'synthetic-portal-icons');t.after(()=>db.close());
 const u=db.prepare("SELECT * FROM users WHERE id='employee'").get();
 const data=portal(db,u,{requests:[],projects:[],leave:null});
 data.leave=[{type:'إجازة سنوية مصطنعة',type_code:'annual',icon:'sun',year:2026,remaining:12},{type:'إجازة مرضية مصطنعة',type_code:'sick',icon:'medical',year:2026,remaining:null}];
 const html=portalPage(data,{e,date:String});
 for(const className of ['employee-request-icon','leave-type-icon']){
  const matches=[...html.matchAll(new RegExp('<span class="'+className+'"[^>]*>([\\s\\S]*?)</span>','g'))];
  assert.ok(matches.length>0,className);
  for(const [,markup] of matches){assert.match(markup,/<svg class="glyph/);assert.match(markup,/stroke-width="1.6"/);assert.match(markup,/aria-hidden="true"/);}
 }
 for(const request of data.employee_requests){assert.ok(html.includes('data-employee-request="'+e(request.key)+'"'));assert.ok(html.includes(e(request.label)));for(const choice of request.choices??[])assert.ok(html.includes(e(choice)));}
 assert.doesNotMatch(html,/undefined|<script| style=/);
});
