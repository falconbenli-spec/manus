import test from 'node:test';
// م0 «السور»: الشاشات المرحَّلة إلى العدّة تأخذ tile من ui، فيمررها الاختبار كما تمررها app.mjs في موضعها الواحد.
import { kit } from '../app/static/kit.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { myRequestTimelineUI, serviceInsightUI } from '../app/static/request-transparency-ui.mjs';
import { myTimelineBoard } from '../app/request-timeline.mjs';
import { serviceInsightScreen } from '../app/process-insight.mjs';
import { setExperienceThreshold } from '../app/service-experience.mjs';
import { setReopenWindow } from '../app/request-closure.mjs';
import { fixture } from './request-transparency-fixture.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const button=(action,id,label)=>`<button data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date());

test('transparency screens: render under a strict CSP, escape user text, and offer only actions the backend allows',t=>{
  const f=fixture(t,'transparency-ui');
  const source=readFileSync(new URL('../app/static/request-transparency-ui.mjs',import.meta.url),'utf8');
  assert.equal(/style=|<script|https?:\/\//.test(source),false,'no inline style, script, or external resource');

  const hostile=f.draft('IT-SUPPORT');f.db.prepare("UPDATE requests SET title='<img src=x onerror=alert(1)>' WHERE id=?").run(hostile);
  const closed=f.closed();
  f.tx(()=>setReopenWindow(f.db,f.users.admin,{scope_code:'*',window_days:5,basis:'تجريبي: قرار مالك الإجراء',confirmed_on:today()}));
  const mine=myTimelineBoard(f.db,f.users.employee),html=myRequestTimelineUI.render(mine,{e,button,ui:kit(e)});
  assert.equal(html.includes('<img'),false);assert.ok(html.includes('&lt;img'));
  assert.deepEqual(mine.rows.find(r=>r.id===closed).actions,['view_timeline','reopen','answer']);
  assert.equal(myRequestTimelineUI.form('reopen',closed,mine).endpoint,`/request-closure/${closed}/reopen`);
  assert.throws(()=>myRequestTimelineUI.form('reopen',hostile,mine),/غير متاح/,'a draft offers no reopening');

  const handler=myTimelineBoard(f.db,f.users.it);assert.deepEqual(handler.closable,[]);
  const active=f.inProgress(),ready=myTimelineBoard(f.db,f.users.it);
  assert.deepEqual(ready.closable.map(r=>r.id),[active]);assert.equal(myRequestTimelineUI.form('close_with_evidence',active,ready).endpoint,`/request-closure/${active}/close`);

  const denied=serviceInsightScreen(f.db,f.users.manager);
  assert.equal(denied.insight,null);assert.match(serviceInsightUI.render(denied,{e,button,ui:kit(e)}),/محجوبة/);
  f.grantInsight('manager');f.tx(()=>setExperienceThreshold(f.db,f.users.admin,{min_responses:3,basis:'تجريبي: حماية صاحب الرأي',confirmed_on:today()}));
  const screen=serviceInsightScreen(f.db,f.users.manager),page=serviceInsightUI.render(screen,{e,button,ui:kit(e)});
  assert.match(page,/لا الأشخاص/);assert.match(page,/لا يظهر هنا اسم موظف/);
  // من وضع الإعداد يُسمّى مع سنده (مساءلة الإعداد)؛ أما لوحات القياس فلا اسم فيها.
  const measures=page.slice(0,page.indexOf('إعدادات يضعها مالك الإجراء'));assert.ok(measures.length>100);
  for(const person of Object.values(f.users))assert.equal(measures.includes(e(person.name)),false,`${person.id} named on the insight screen`);
  assert.throws(()=>serviceInsightUI.form('set_window','',screen),/غير متاح/,'a manager without catalog rights sets no window');
  assert.equal(serviceInsightUI.form('set_threshold','',serviceInsightScreen(f.db,f.users.admin)).endpoint,'/service-experience/threshold');
});
