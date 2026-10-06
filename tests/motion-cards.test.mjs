import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountCards, prefersReducedMotion } from '../app/static/motion-cards.mjs';
import { launcherResults } from '../app/static/request-picker.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function card(extraClass=''){
  const classes=new Set(['rq-card',...extraClass.split(' ').filter(Boolean)]);
  const properties=new Map();
  const node={
    classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),has:c=>classes.has(c)},
    style:{setProperty:(k,value)=>properties.set(k,value)},
    getBoundingClientRect:()=>({left:0,top:0,width:200,height:100}),
    properties,classes
  };
  node.closest=selector=>selector.includes('rq-card')&&!classes.has('is-static')?node:null;
  return node;
}
function root(cards){
  const listeners=new Map();
  return {cards,
    querySelectorAll:()=>cards,
    addEventListener:(type,fn,capture)=>listeners.set(type+String(!!capture),fn),
    removeEventListener:(type,fn,capture)=>listeners.delete(type+String(!!capture)),
    fire:(type,event,capture=false)=>listeners.get(type+String(!!capture))?.(event),
    listeners};
}

test('MOTION: cards enter in sequence and follow the pointer without inline styles in markup',()=>{
  const cards=[card(),card(),card()],container=root(cards);
  const frames=[];
  const stop=mountCards(container,{view:{requestAnimationFrame:fn=>{frames.push(fn);return 7;},cancelAnimationFrame:()=>frames.length=0},reduced:false});
  assert.ok(cards.every(c=>c.classes.has('rq-enter')));
  assert.deepEqual(cards.map(c=>c.properties.get('--rq-delay')),['0ms','34ms','68ms']);
  assert.ok(!cards[0].classes.has('rq-shown'),'the reveal waits for the next frame');
  frames.forEach(fn=>fn());
  assert.ok(cards.every(c=>c.classes.has('rq-shown')));
  container.fire('pointermove',{target:cards[1],clientX:150,clientY:25});
  assert.equal(cards[1].properties.get('--mx'),'75.0%');
  assert.equal(cards[1].properties.get('--my'),'25.0%');
  assert.equal(cards[1].properties.get('--tilt-x'),'1.00deg');
  assert.equal(cards[1].properties.get('--tilt-y'),'1.25deg');
  assert.ok(cards[1].classes.has('is-live'));
  container.fire('pointerleave',{target:cards[1]},true);
  assert.ok(!cards[1].classes.has('is-live'));
  assert.equal(cards[1].properties.get('--tilt-x'),'0deg');
  stop();
  assert.equal(container.listeners.size,0,'cleanup removes every listener');
});

test('MOTION: reduced motion shows cards at once, and unknown or empty roots are safe',()=>{
  const cards=[card(),card()],container=root(cards);
  const stop=mountCards(container,{view:{},reduced:true});
  assert.ok(cards.every(c=>c.classes.has('rq-shown')));
  assert.equal(container.listeners.size,0,'no pointer tracking when motion is reduced');
  stop();
  assert.equal(typeof mountCards(null),'function');
  assert.equal(typeof mountCards(root([])),'function');
  assert.equal(prefersReducedMotion({}),false);
  assert.equal(prefersReducedMotion({matchMedia(){throw new Error('unsupported');}}),false);
  assert.equal(prefersReducedMotion({matchMedia:()=>({matches:true})}),true);
});

test('MOTION: the stylesheet keeps a reduced-motion fallback and the markup stays style-attribute free',()=>{
  const css=readFileSync(new URL('../app/static/hr-design.css',import.meta.url),'utf8');
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/@keyframes rq-beam/);
  assert.match(css,/@keyframes rq-sheen/);
  const html=launcherResults({departments:[{id:'hr',name:'رأس المال البشري'}],services:[{id:'s1',code:'HR-LETTER',name_ar:'طلب خطاب',name_en:'Letter',description:'وصف',section:'الخطابات',department_id:'hr',fields:[{key:'a'}],approval_policy:{steps:['manager'],handler_role:'hr'}}],me:{department_id:'hr'},selected:'hr',e});
  assert.doesNotMatch(html,/ style="/,'inline style attributes would be blocked by the content security policy');
  assert.match(html,/class="rq-row"/,'services render as compact rows');
  assert.match(html,/rq-row-meta/);
  assert.match(html,/aria-label="طلب خطاب — وصف — مسار الاعتماد: مديرك المباشر ← رأس المال البشري"/);
});
