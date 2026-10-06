import test from 'node:test';
import assert from 'node:assert/strict';
import { answerView, policyAssistantUI } from '../app/static/policy-assistant-ui.mjs';
import { NAV_DEST } from '../app/static/nav-map.mjs';

const e=value=>String(value??'')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#39;');
const button=(action,id,label)=>`<button data-action="operation" data-module="policy-assistant" data-operation="${e(action)}" data-id="${e(id)}">${e(label)}</button>`;

test('the employee view opens with one compact conversation card and keeps history and curator evidence folded',()=>{
  const html=policyAssistantUI.render({
    rules:['يجيب من بياناتك أنت فقط.'],suggested:['كم رصيد إجازاتي؟','كم راتبي؟','كيف أطلب إجازة؟','كم مدة إجازة الزواج؟','سؤال خامس'],
    my_questions:[{id:'q1',question:'كم رصيد إجازاتي؟',kind_name:'بياناتي',answered:true,citations:1,asked_at:'2026-10-05T00:00:00.000Z',helpful:null,actions:['rate_answer']}],
    can_curate:true,retrieval:{name:'بحث محلي',semantic_layer:'محلي',note:'',library:'نصوص المنصة'},gaps:[],
    golden:{passed:1,counted:1,pass_rate_bp:10000,skipped:0,cases:[{id:'G01',question:'سؤال اختبار',expect:'جواب',outcome:'passed',detail:'نجح',needs:'لا شيء'}],note:'دليل جودة'}
  },{e,button});
  assert.match(html,/class="turki-chat-card"/);
  assert.match(html,/ابدأ المحادثة/);
  assert.match(html,/<details class="turki-history"/);
  assert.match(html,/<details class="turki-curation"/);
  assert.doesNotMatch(html,/<details class="turki-(?:history|curation)"[^>]*\sopen(?:\s|>)/);
  assert.ok(html.indexOf('الحزمة الذهبية')>html.indexOf('<details class="turki-curation"'),'quality evidence belongs inside the folded curator area');
});

test('an answer reads like a small chat and keeps the next question one tap away',()=>{
  const html=answerView({status:'completed',output:'رصيدك المتاح 12 يومًا.\nمادة طويلة مكررة.',question_id:'q1',view:{question:'كم رصيد إجازاتي؟',direct:['رصيدك المتاح 12 يومًا.'],citations:[],conflicts:[]}},e);
  assert.match(html,/class="turki-chat-thread"/);
  assert.match(html,/class="turki-bubble is-user"/);
  assert.match(html,/كم رصيد إجازاتي؟/);
  assert.match(html,/class="turki-bubble is-assistant"/);
  assert.match(html,/رصيدك المتاح 12 يومًا/);
  assert.doesNotMatch(html,/مادة طويلة مكررة/,'the bubble uses the direct answer while evidence stays in its folded section');
  assert.match(html,/data-action="turki-followup"/);
  assert.match(html,/اسأل سؤالًا ثانيًا/);
});

test('the page title uses the same Ask Turki name as its entry point',()=>{
  assert.equal(NAV_DEST['policy-assistant'].label,'اسأل تركي');
});

test('a suggested question still uses a clear send label in the composer',()=>{
  const spec=policyAssistantUI.form('ask_policy','0',{suggested:['كم مدة إجازة الزواج؟']});
  assert.equal(spec.submit,'إرسال');
  assert.equal(spec.fields[0].value,'كم مدة إجازة الزواج؟');
});
