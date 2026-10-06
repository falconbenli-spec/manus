import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFigure, formatFigure, classifyToast, mountInteract, PILL, SPOT } from '../app/static/interact.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('INTERACT: figures parse and re-format with their own grouping, decimals, prefix and suffix',()=>{
  const a=parseFigure(' 12,400 ');assert.deepEqual({...a},{pre:'',post:'',n:12400,dec:0,group:true});
  assert.equal(formatFigure(a,1234),'1,234');assert.equal(formatFigure(a,12400),'12,400');
  const b=parseFigure('SAR 3.50');assert.equal(b.dec,2);assert.equal(formatFigure(b,1.5),'SAR 1.50');
  const c=parseFigure('87%');assert.equal(formatFigure(c,43),'43%');
  for(const bad of ['0','—','','12 / 30','١٢','3 days 4 hours',null])assert.equal(parseFigure(bad),null,String(bad));
});

test('INTERACT: toasts classify as a success spark or an error dim',()=>{
  for(const ok of ['تم حفظ العملية','تم تغيير كلمة المرور','Saved','Password changed','Previous operation saved'])assert.equal(classifyToast(ok),'spark',ok);
  for(const bad of ['الحقل مطلوب','Forbidden','المظهر موحّد من إدارة المنصة.','تمت'])assert.equal(classifyToast(bad),'dim',bad);
});

// ---- a minimal fake DOM: enough for the switch and the brain signals
function fakeWindow({scene3d='1',reduced=false,motion}={}){
  const events=[],listeners=new Map(),docListeners=new Map(),observers=[];
  const attrs=new Map(),dataset={};if(motion)dataset.motion=motion;
  const node=(extra={})=>({nodeType:1,attrs:new Map(),style:{props:new Map(),setProperty(k,v){this.props.set(k,v);},removeProperty(k){this.props.delete(k);}},
    setAttribute(k,v){this.attrs.set(k,String(v));},getAttribute(k){return this.attrs.get(k)??null;},removeAttribute(k){this.attrs.delete(k);},hasAttribute(k){return this.attrs.has(k);},
    closest:()=>null,matches:()=>false,querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({left:100,top:200,width:160,height:48}),...extra});
  const toast=node({textContent:'',classList:{set:new Set(),contains(c){return this.set.has(c);}}});
  const app=node(),dialog=node();
  const html={dataset,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),hasAttribute:k=>attrs.has(k)};
  const document={documentElement:html,querySelector:s=>s==='#toast'?toast:s==='#app'?app:s==='#dialog'?dialog:null,querySelectorAll:()=>[],
    addEventListener:(t,fn)=>docListeners.set(t,fn),removeEventListener:t=>docListeners.delete(t)};
  class MO{constructor(fn){this.fn=fn;observers.push(this);}observe(target,opts){this.target=target;this.opts=opts;}disconnect(){this.off=true;}}
  const win={document,performance:{now:()=>Date.now()},
    getComputedStyle:()=>({getPropertyValue:n=>n==='--scene-3d'?scene3d:'',color:'rgb(255, 255, 255)'}),
    matchMedia:q=>({matches:q.includes('reduce')?reduced:false,addEventListener(){},removeEventListener(){}}),
    addEventListener:(t,fn)=>listeners.set(t,fn),removeEventListener:t=>listeners.delete(t),
    dispatchEvent:e=>{events.push(e);return true;},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},
    MutationObserver:MO,requestAnimationFrame:fn=>setTimeout(()=>fn(Date.now()),0)};
  const kick=target=>{for(const o of observers)if(o.target===target&&!o.off)o.fn([{addedNodes:[]}]);};
  return {win,html,attrs,events,listeners,docListeners,toast,app,node,kick,observers,
    showToast(text){toast.textContent=text;toast.classList.set.add('show');kick(toast);toast.classList.set.delete('show');kick(toast);}};
}

test('INTERACT: a no-op outside the depth design (computed --scene-3d is not 1)',()=>{
  const f=fakeWindow({scene3d:'0'}),ix=mountInteract(f.win);
  assert.equal(ix.active(),false);assert.equal(f.attrs.has('data-ix'),false);
  f.listeners.get('hashchange')();f.showToast('تم حفظ العملية');
  assert.equal(f.events.length,0,'no brain events either');
  ix.destroy();
});

test('INTERACT: fully off under prefers-reduced-motion and html[data-motion=off]',()=>{
  const r=fakeWindow({reduced:true}),a=mountInteract(r.win);assert.equal(a.active(),false);assert.equal(r.attrs.has('data-ix'),false);a.destroy();
  const m=fakeWindow({motion:'off'}),b=mountInteract(m.win);assert.equal(b.active(),false);b.destroy();
  const live=fakeWindow(),c=mountInteract(live.win);assert.equal(c.active(),true);assert.equal(live.attrs.has('data-ix'),true,'html[data-ix] marks the active state for depth.css');
  live.html.dataset.motion='off';c.sync();assert.equal(c.active(),false);assert.equal(live.attrs.has('data-ix'),false,'turning motion off removes it');
  c.destroy();
});

test('INTERACT: the brain hears the platform — navigation pulses, a save sparks at the button, an error dims',()=>{
  const f=fakeWindow(),ix=mountInteract(f.win);
  f.listeners.get('hashchange')();
  assert.deepEqual(f.events.map(e=>[e.type,e.detail.kind]),[['36t:brain','pulse']]);
  const button=f.node(),form=f.node({id:'request-form',tagName:'FORM'});
  f.docListeners.get('submit')({target:form,submitter:button});
  f.showToast('تم حفظ العملية');
  const spark=f.events.at(-1);assert.equal(spark.detail.kind,'spark');assert.deepEqual([spark.detail.x,spark.detail.y],[180,224],'the burst starts at the button that saved');
  f.showToast('الحقل مطلوب');assert.equal(f.events.at(-1).detail.kind,'dim');
  f.showToast('Saved');assert.equal(f.events.at(-1).detail.kind,'spark');assert.equal(f.events.at(-1).detail.x,undefined,'without a recent submit: across the brain');
  ix.destroy();assert.equal(f.attrs.has('data-ix'),false);
});

test('INTERACT: wiring and the CSS contract (CSP-clean, CSSOM only, the effects key on html[data-ix])',()=>{
  const html=read('app/static/index.html'),server=read('app/server.mjs'),css=read('app/static/depth.css'),src=read('app/static/interact.mjs');
  assert.match(html,/<script type="module" src="\/signature\.mjs"><\/script><script type="module" src="\/interact\.mjs"><\/script>/,'loaded after signature.mjs');
  assert.match(server,/\['\/interact\.mjs',\['interact\.mjs','text\/javascript; charset=utf-8'\]\]/,'served by the whitelist');
  assert.ok(!/cssText|setAttribute\(\s*'style'|innerHTML|insertAdjacentHTML|eval\(|new Function/.test(src),'no style text, no markup, no dynamic code');
  assert.ok(!/depth|classic|void|slate/.test(src.replace(/\/\/.*$/gm,'').replace(/'--scene-3d'/g,'')),'no design-name branches');
  assert.ok(css.includes('content:attr(data-ix-shown) / ""'),'the count-up overlay has empty alt text: screen readers read the true number');
  assert.ok(/prefers-reduced-motion:no-preference\)\{\n  @media \(hover:hover\)/.test(css),'hover effects need motion allowed and a hover device');
  for(const hook of ['[data-ix]','[data-ix-enter]','[data-ix-ripple=a]','--mx','--ix-tx','--ix-i'])assert.ok(css.includes(hook),hook);
  assert.ok(PILL.includes('.login-card .btn.dark')&&SPOT.includes('tbody tr'));
});
