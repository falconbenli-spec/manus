import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ringField, commaField, mountBackdrop, mountCards, prefersReducedMotion } from '../app/static/motion-cards.mjs';

// Field layout: 10 floats per mark — x y hx hy t k c f d ph. f = flags | feather<<8 | moon ordinal<<16.
const MIRROR=1,MOON=2,DRIFTER=4,EDGE=8;
const marks=field=>Array.from({length:field.count},(_,n)=>{const q=field.data.subarray(n*10,n*10+10);return {x:q[0],y:q[1],hx:q[2],hy:q[3],t:q[4],k:q[5],c:q[6],f:q[7],d:q[8],ph:q[9]};});
const near=(a,b,eps=1e-3)=>Math.abs(a-b)<=eps;
const desk={width:1440,height:900,cx:490,cy:378,R:450,pitch:11};

test('RING: the field is a masked orthogonal lattice at 1 : 1.13, never a scatter',()=>{
  const field=ringField(desk),all=marks(field);
  assert.ok(field.data instanceof Float32Array);
  assert.equal(field.data.length,field.count*10);
  assert.ok(field.count>1800&&field.count<2700,`desktop login budget is about 2,200 marks, got ${field.count}`);
  for(const m of all){
    const i=(m.hx-desk.cx)/desk.pitch-.5,j=(m.hy-desk.cy)/(desk.pitch*1.13);
    assert.ok(near(i,Math.round(i),2e-3),'x sits on a lattice column');
    assert.ok(near(j,Math.round(j),2e-3),'y sits on a lattice row');
    assert.equal(m.x,m.hx);assert.equal(m.y,m.hy);
    const r=Math.hypot(m.hx-desk.cx,m.hy-desk.cy);
    assert.ok(r>=desk.R*(1-.28)-1e-3&&r<=desk.R*1.12+1e-3,'inside the band or its halo');
    assert.equal(!!(m.f&EDGE),r>desk.R+1e-3,'halo marks are flagged so the governor can drop them first');
  }
  assert.ok(!all.some(m=>m.f&DRIFTER),'no drifters unless asked for');
});

test('RING: the same input always gives the same field, and an empty request is safe',()=>{
  assert.deepEqual(Array.from(ringField(desk).data),Array.from(ringField(desk).data));
  for(const bad of [undefined,{},{R:0,pitch:8},{R:100,pitch:0},{R:NaN,pitch:5}]){const f=ringField(bad);assert.equal(f.count,0);assert.equal(f.data.length,0);}
  for(const bad of [undefined,{},{w:0,h:10,pitch:5},{w:10,h:10,pitch:0}])assert.equal(commaField(bad).count,0);
});

test('RING: a 300 degree arc from 12 o\'clock, anticlockwise, with a 60 degree gap and the guideline ink law',()=>{
  const all=marks(ringField(desk)),gap=all.filter(m=>m.t<0),arc=all.filter(m=>m.t>=0);
  assert.ok(gap.length>0&&arc.length>0);
  assert.ok(near(gap.length/all.length,60/360,.03),'the gap holds about a sixth of the marks');
  for(const m of gap){assert.equal(m.t,-1);assert.equal(m.k,0,'gap marks are hidden until the ring closes');assert.ok(m.hx>desk.cx,'the gap is clockwise of 12 in RTL');}
  assert.ok(gap.every(m=>m.d>500-.05&&m.d<=600+.05),'gap marks keep their angle in d (500..600 ms), which is what lets the login figure turn as a whole');
  for(const m of arc){
    let a=Math.atan2(desk.cx-m.hx,desk.cy-m.hy);if(a<0)a+=Math.PI*2;
    assert.ok(near(m.t,a/(Math.PI*5/3),1e-4),'t is the normalised anticlockwise angle');
    assert.ok(near(m.k,Math.max(.15,1-1.06*m.t),1e-4),'k = max(0.15, 1 - 1.06 u) at progress 0');
    assert.ok(near(m.d,m.t*500,.05),'flight delay follows the angle: 500 ms across the arc, 600 across the circle');
  }
  const head=arc.filter(m=>m.t<.02),tail=arc.filter(m=>m.t>.95);
  assert.ok(head.every(m=>m.k>.97)&&tail.every(m=>near(m.k,.15,1e-4)),'dense head, ghost tail');
});

test('RING: mirror=true reverses the direction of t and the mirror flag of every node',()=>{
  const rtl=marks(ringField(desk)),ltr=marks(ringField({...desk,mirror:true}));
  assert.equal(rtl.length,ltr.length);
  rtl.forEach((m,n)=>{
    const o=ltr[n];assert.equal(o.hx,m.hx);assert.equal(o.hy,m.hy);
    assert.equal(!!(m.f&MIRROR),m.hx<desk.cx,'left half carries the reversed comma');
    assert.equal(!!(o.f&MIRROR),m.hx>desk.cx,'and the flag flips under dir=ltr');
  });
  const leftRtl=rtl.find(m=>m.hx<desk.cx-300&&near(m.hy,desk.cy,1)),leftLtr=ltr.find(m=>m.hx===leftRtl.hx&&m.hy===leftRtl.hy);
  assert.ok(near(leftRtl.t,.3,.02),'9 o\'clock is 90 of 300 degrees anticlockwise');
  assert.ok(near(leftLtr.t,.9,.02),'and 270 of 300 degrees clockwise');
  assert.ok(ltr.filter(m=>m.t<0).every(m=>m.hx<desk.cx),'the gap moves to the other side');
});

test('RING: the colour mix is 77 / 10 / 10 / 3 by a deterministic hash',()=>{
  const all=marks(ringField(desk)),share=c=>all.filter(m=>m.c===c).length/all.length;
  assert.ok(all.every(m=>[0,1,2,3].includes(m.c)));
  assert.ok(near(share(0),.77,.04),`ring-a ${share(0)}`);
  assert.ok(near(share(1),.10,.03),`ring-b ${share(1)}`);
  assert.ok(near(share(2),.10,.03),`ring-c ${share(2)}`);
  assert.ok(near(share(3),.03,.02),`ring-d ${share(3)}`);
});

test('RING: exclusion rectangles delete marks and feather the ink around them',()=>{
  const rect={x:-20,y:250,w:300,h:260},open=marks(ringField(desk)),cutOut=marks(ringField({...desk,exclude:[rect]}));
  const inside=m=>m.hx>=rect.x&&m.hx<=rect.x+rect.w&&m.hy>=rect.y&&m.hy<=rect.y+rect.h;
  const distance=m=>Math.hypot(Math.max(rect.x-m.hx,0,m.hx-rect.x-rect.w),Math.max(rect.y-m.hy,0,m.hy-rect.y-rect.h));
  assert.ok(open.some(inside),'the rectangle really overlaps the ring');
  assert.ok(!cutOut.some(inside),'no mark survives inside a rectangle');
  const byHome=new Map(open.map(m=>[m.hx+':'+m.hy,m]));let feathered=0;
  for(const m of cutOut){
    const twin=byHome.get(m.hx+':'+m.hy),d=distance(m),factor=(m.f>>8&255)/255;
    assert.ok(twin,'exclusion never invents a node');
    assert.ok(near(factor,Math.min(1,d/48),.005),'the feather factor is linear over 48px');
    assert.ok(near(m.k,twin.k*Math.min(1,d/48),.002));
    if(d<48)feathered++;
  }
  assert.ok(feathered>0);
  const hard=marks(ringField({...desk,exclude:[rect],feather:0}));
  assert.ok(hard.every(m=>(m.f>>8&255)===255),'feather 0 is a hard edge');
  assert.equal(ringField({...desk,exclude:[{x:-10,y:-10,w:2000,h:2000}]}).count,0,'a rectangle over everything leaves nothing');
});

test('RING: marks outside the canvas box are clipped, which is how the phone ring becomes a horizon',()=>{
  const phone={width:375,height:812,cx:187.5,cy:150,R:190,pitch:8.5},all=marks(ringField(phone));
  assert.ok(all.length>300&&all.length<900,`phone budget is about 670 marks, got ${all.length}`);
  assert.ok(all.every(m=>m.hx>=-8.5&&m.hx<=375+8.5&&m.hy>=-8.5*1.13));
  const home=marks(ringField({width:1312,height:380,cx:1080,cy:190,R:148,pitch:7}));
  assert.ok(home.length>400&&home.length<800,`home budget is about 600 marks, got ${home.length}`);
});

test('RING: up to 12 moons are promoted lattice nodes at the head of the arc, in order',()=>{
  const hero={width:1312,height:380,cx:1080,cy:190,R:148,pitch:7};
  const all=marks(ringField(hero)),moons=all.filter(m=>m.f&MOON).sort((a,b)=>(a.f>>16)-(b.f>>16));
  assert.equal(moons.length,12);
  assert.deepEqual(moons.map(m=>m.f>>16),[0,1,2,3,4,5,6,7,8,9,10,11]);
  assert.ok(moons.every(m=>m.t>=0&&m.t<.3),'moons sit at the head, never in the gap');
  assert.ok(moons.every(m=>Math.hypot(m.hx-hero.cx,m.hy-hero.cy)<=hero.R+1e-3),'and inside the ring, so they never leave the a.sig-eye box');
  for(let n=1;n<moons.length;n++)assert.ok(moons[n].t>moons[n-1].t,'ordinals advance along the arc');
  assert.equal(marks(ringField({...hero,moons:0})).filter(m=>m.f&MOON).length,0);
  assert.equal(ringField({...hero,moons:0}).count,ringField(hero).count,'moons are promoted, not added');
  const clipped=marks(ringField(desk)).filter(m=>m.f&MOON);
  assert.ok(clipped.length<12,'a head that is off the canvas simply has fewer moons');
});

test('RING: drifters live on the lattice outside the halo and never carry data',()=>{
  const all=marks(ringField({...desk,drifters:40})),drifters=all.filter(m=>m.f&DRIFTER);
  assert.ok(drifters.length>=15&&drifters.length<=70,`about 40 drifters, got ${drifters.length}`);
  for(const m of drifters){const r=Math.hypot(m.hx-desk.cx,m.hy-desk.cy);assert.ok(r>desk.R*1.12&&r<=desk.R*1.45+1e-3);assert.equal(m.t,-1);assert.ok(!(m.f&MOON));}
  assert.equal(all.length-drifters.length,ringField(desk).count,'asking for drifters does not disturb the ring');
});

test('COMMA: Form A is a full rectangular lattice with a horizontal fade and a mirrored left half',()=>{
  const block=marks(commaField({x:100,y:50,w:240,h:135.6,pitch:12,mask:false}));
  assert.equal(block.length,20*10,'20 columns by 10 rows at 12 x 13.56');
  assert.ok(near(block[1].hx-block[0].hx,12)&&near(block[20].hy-block[0].hy,13.56,2e-3));
  for(const m of block){
    const u=(m.hx-100)/240;
    assert.ok(near(m.t,u,1e-4));assert.ok(near(m.k,Math.max(.15,1-1.06*u),1e-4));
    assert.equal(!!(m.f&MIRROR),u<.5);
  }
  const flipped=marks(commaField({x:100,y:50,w:240,h:135.6,pitch:12,mask:false,mirror:true}));
  assert.ok(flipped.every((m,n)=>near(m.t,1-block[n].t,1e-4)&&!!(m.f&MIRROR)!==!!(block[n].f&MIRROR)),'dir=ltr fades from the other edge');
  const vertical=marks(commaField({x:0,y:0,w:120,h:135.6,pitch:12,mask:false,axis:'y'}));
  assert.ok(vertical.every(m=>near(m.t,m.hy/135.6,1e-4)));
});

test('COMMA: Form D is the logo comma cut out of Form A, about 1,500 marks at 760 x 554',()=>{
  const box={x:40,y:120,w:760,h:554,pitch:12},giant=marks(commaField(box)),block=commaField({...box,mask:false});
  assert.ok(giant.length>1200&&giant.length<1800,`about 1,500 marks, got ${giant.length}`);
  assert.ok(near(giant.length/block.count,.5835,.03),'the comma quadrilateral covers 58% of its box');
  for(const m of giant){
    const u=(m.hx-box.x)/box.w,v=(m.hy-box.y)/box.h;
    assert.ok(u>=.372*(1-v)-.02&&u<=1-.461*v+.02,'inside COMMA=[[.372,0],[1,0],[.539,1],[0,1]]');
  }
  const mirrored=marks(commaField({...box,mirror:true}));
  assert.deepEqual(mirrored.map(m=>[m.hx,m.hy]),giant.map(m=>[m.hx,m.hy]),'the logo shape itself is never flipped');
  const cutOut=commaField({...box,exclude:[{x:400,y:0,w:600,h:900}]});
  assert.ok(cutOut.count<giant.length&&marks(cutOut).every(m=>m.hx<400));
});

// ---- mountBackdrop against a fake canvas and a fake window. No DOM, no real timers.
function harness({reduced=false,context=true,tokens={},motion,paused}={}){
  const calls={fill:0,stroke:0,clearRect:0,setTransform:[],moveTo:0,styles:new Set()};
  const ctx={clearRect:()=>calls.clearRect++,beginPath(){},closePath(){},moveTo:()=>calls.moveTo++,lineTo(){},fill:()=>calls.fill++,stroke:()=>calls.stroke++,setTransform:(...a)=>calls.setTransform.push(a),
    set fillStyle(v){calls.styles.add(v);},set strokeStyle(v){calls.styles.add(v);},globalAlpha:1,lineWidth:1};
  const canvas={width:300,height:150,getContext:kind=>context&&kind==='2d'?ctx:null};
  const frames=[],timers=new Map(),listeners=new Map(),docListeners=new Map(),store=new Map();let now=0,ids=0,resize=null,mutate=null,styleReads=0;
  if(paused)store.set('36t-motion-paused','true');
  const html={dataset:motion?{motion}:{}};
  const view={
    devicePixelRatio:3,performance:{now:()=>now},
    requestAnimationFrame:fn=>{frames.push(fn);return ++ids;},cancelAnimationFrame:()=>{frames.length=0;},
    setTimeout:(fn,ms)=>{timers.set(++ids,{fn,ms});return ids;},clearTimeout:id=>timers.delete(id),
    addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),
    getComputedStyle:()=>{styleReads++;return {getPropertyValue:name=>tokens[name]??` token(${name})`};},
    matchMedia:()=>({matches:reduced}),
    ResizeObserver:class{constructor(fn){resize=fn;}observe(){}disconnect(){resize=null;}},
    MutationObserver:class{constructor(fn){mutate=fn;}observe(){}disconnect(){mutate=null;}},
    sessionStorage:{getItem:k=>store.get('s:'+k)??null,setItem:(k,v)=>store.set('s:'+k,v)},
    localStorage:{getItem:k=>store.get(k)??null},
    document:{documentElement:html,hidden:false,addEventListener:(type,fn)=>docListeners.set(type,fn),removeEventListener:type=>docListeners.delete(type)}
  };
  return {canvas,ctx,view,calls,frames,timers,listeners,docListeners,html,
    size:(w,h)=>resize?.([{contentRect:{width:w,height:h}}]),
    mutate:()=>mutate?.([]),
    styleReads:()=>styleReads,
    run(ms,step=16){for(let t=0;t<ms&&frames.length;t+=step){now+=step;const fn=frames.shift();fn(now);}return now;},
    advance(ms){now+=ms;}};
}
const API=['setScene','setData','setExclusions','dim','pulse','pause','resume','destroy'];

test('BACKDROP: the control object is exact, and a failed getContext leaves eight harmless no-ops',()=>{
  const h=harness(),engine=mountBackdrop(h.canvas,{view:h.view,reduced:false});
  assert.deepEqual(Object.keys(engine).sort(),[...API].sort());
  assert.ok(API.every(name=>typeof engine[name]==='function'));
  for(const broken of [null,undefined,{},{getContext:()=>null},{getContext(){throw new Error('no 2d');}}]){
    const dead=mountBackdrop(broken,{view:h.view});
    assert.deepEqual(Object.keys(dead).sort(),[...API].sort());
    assert.doesNotThrow(()=>{dead.setScene('login',{cx:1,cy:1,R:10});dead.setData({pending:3});dead.setExclusions([{x:0,y:0,w:1,h:1}]);dead.dim(.3);dead.pulse();dead.pause();dead.resume();dead.destroy();});
  }
  assert.doesNotThrow(()=>mountBackdrop({getContext:()=>({})},{view:{}}).setScene('home',{cx:10,cy:10,R:20}),'a bare window without observers or timers is survivable');
});

test('BACKDROP: off the stage the backing store is zero and nothing is scheduled',()=>{
  const h=harness(),engine=mountBackdrop(h.canvas,{view:h.view,reduced:false});
  h.size(1440,900);
  assert.equal(h.frames.length,0,'no scene, no frame');
  engine.setScene('login',{cx:490,cy:378,R:450,mirror:false});
  assert.equal(h.canvas.width,2880,'DPR is capped at 2 on the desktop');assert.equal(h.canvas.height,1800);
  assert.deepEqual(h.calls.setTransform.at(-1),[2,0,0,2,0,0]);
  assert.equal(h.frames.length,1);
  engine.setScene('off');
  assert.equal(h.canvas.width,0);assert.equal(h.canvas.height,0);
  assert.equal(h.frames.length,0,'the pending frame is cancelled');assert.equal(h.timers.size,0);
  assert.ok(!h.listeners.has('pointermove'),'no pointer listener outside the login scene');
  engine.setScene('payroll',{cx:1,cy:1,R:1});
  assert.equal(h.canvas.width,0,'unknown scene names mean off');
  engine.setData({pending:4,late:true,progress:.5});engine.dim(.2);engine.pulse();engine.resume();
  assert.equal(h.frames.length,0,'data never wakes a canvas that is off the stage');
});

test('BACKDROP: the phone caps DPR at 1.5 and freezes after 12 s; the desktop stops after 60 s; resume() restarts',()=>{
  const h=harness(),engine=mountBackdrop(h.canvas,{view:h.view,reduced:false});
  h.view.sessionStorage.setItem('36t-ring-intro','1');
  h.size(375,812);engine.setScene('login',{cx:187.5,cy:150,R:190});
  assert.equal(h.canvas.width,563);assert.ok(!h.listeners.has('pointermove'),'no pointer tracking on touch-sized screens');
  h.run(11000);assert.equal(h.frames.length,1,'still alive at 11 s');
  h.run(3000);assert.equal(h.frames.length,0,'frozen after 12 s of idleness');
  engine.resume();assert.equal(h.frames.length,1,'resume() restarts the loop');
  engine.destroy();

  const d=harness(),desk=mountBackdrop(d.canvas,{view:d.view,reduced:false});
  d.view.sessionStorage.setItem('36t-ring-intro','1');
  d.size(1440,900);desk.setScene('home',{cx:1200,cy:190,R:148});
  d.run(59000);assert.equal(d.frames.length,1);
  d.run(3000);assert.equal(d.frames.length,0,'the desktop loop ends after 60 s');
  desk.setData({pending:2,late:false,progress:.4,closed:false});assert.equal(d.frames.length,1,'a changed value wakes it');
  d.run(64000);assert.equal(d.frames.length,0);
  desk.setData({pending:2,late:false,progress:.4,closed:false});assert.equal(d.frames.length,0,'an unchanged value does not');
});

test('BACKDROP: reduced motion draws one static frame, never calls requestAnimationFrame, and refreshes on a 60 s timer',()=>{
  for(const options of [{reduced:true},{motion:'off'},{paused:true}]){
    const h=harness(options),engine=mountBackdrop(h.canvas,{view:h.view,reduced:!!options.reduced});
    h.size(1440,900);engine.setScene('login',{cx:490,cy:378,R:450});
    assert.equal(h.frames.length,0,'zero rAF');
    assert.equal(h.calls.clearRect,1,'exactly one frame');assert.ok(h.calls.fill>0);
    assert.equal(h.view.sessionStorage.getItem('36t-ring-intro'),null,'the opening is not spent on a still frame');
    assert.ok(!h.listeners.has('pointermove'));
    const timers=[...h.timers.values()];assert.equal(timers.length,1);assert.equal(timers[0].ms,60000);
    timers[0].fn();assert.equal(h.calls.clearRect,2,'the timer redraws once');assert.equal(h.frames.length,0);assert.equal(h.timers.size,1,'and re-arms itself');
    engine.setData({pending:3,late:true,progress:.25,closed:false});assert.equal(h.calls.clearRect,3,'a changed value redraws the still frame');
    engine.setData({pending:3,late:true,progress:.25,closed:false});assert.equal(h.calls.clearRect,3,'an unchanged value does not');
    h.mutate();assert.equal(h.calls.clearRect,4,'a theme or design change redraws it');
    engine.pulse();engine.dim(.35);assert.equal(h.frames.length,0);
    engine.destroy();assert.equal(h.timers.size,0);assert.equal(h.canvas.width,0);
  }
});

test('BACKDROP: pause() holds a static frame and resume() returns to the loop; a hidden document schedules nothing',()=>{
  const h=harness(),engine=mountBackdrop(h.canvas,{view:h.view,reduced:false});
  h.view.sessionStorage.setItem('36t-ring-intro','1');
  h.size(1440,900);engine.setScene('login',{cx:490,cy:378,R:450});
  assert.ok(h.listeners.has('pointermove'),'desktop login tracks the pointer');
  engine.pause();assert.equal(h.frames.length,0);assert.ok(!h.listeners.has('pointermove'));assert.equal(h.timers.size,1);
  engine.resume();assert.equal(h.frames.length,1);assert.equal(h.timers.size,0);assert.ok(h.listeners.has('pointermove'));
  const shown=h.calls.clearRect;h.view.document.hidden=true;h.docListeners.get('visibilitychange')();assert.equal(h.frames.length,0,'hidden cancels the frame');
  assert.equal(h.calls.clearRect,shown+1,'and leaves one settled frame behind');assert.equal(h.timers.size,1);
  engine.setData({pending:1,progress:.1});assert.equal(h.frames.length,0,'and data does not schedule one while hidden');
  h.view.document.hidden=false;h.docListeners.get('visibilitychange')();assert.equal(h.frames.length,1);assert.equal(h.timers.size,0);
  engine.destroy();assert.ok(!h.docListeners.has('visibilitychange'));assert.ok(!h.listeners.has('pointermove'));
});

test('BACKDROP: colours come from the design tokens only, and are read again when the theme or the design changes',()=>{
  const tokens={'--ring-a':' tokenA','--ring-b':'tokenB','--ring-c':'tokenC','--ring-d':'tokenD','--stop':'tokenStop','--ink-1':'tokenInk'};
  const h=harness({reduced:true,tokens}),engine=mountBackdrop(h.canvas,{view:h.view,reduced:true});
  h.size(1440,900);engine.setScene('home',{cx:1200,cy:190,R:148});
  assert.ok(h.calls.styles.has('tokenA')&&h.calls.styles.has('tokenB')&&h.calls.styles.has('tokenC')&&h.calls.styles.has('tokenD'));
  assert.ok([...h.calls.styles].every(v=>/^token/.test(v)),'no literal colour ever reaches the canvas: '+[...h.calls.styles]);
  assert.ok(!h.calls.styles.has('tokenStop'));
  engine.setData({pending:2,late:true,progress:.5,closed:false});
  assert.ok(h.calls.styles.has('tokenStop'),'late swaps the 3% slot and the moons to --stop');
  tokens['--ring-a']='tokenField';const before=h.styleReads();h.mutate();
  assert.ok(h.styleReads()>before);assert.ok(h.calls.styles.has('tokenField'),'a design change repaints with the new tokens');
  const source=readFileSync(new URL('../app/static/motion-cards.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/#[0-9a-fA-F]{3,8}\b|rgba?\(/,'no colour literal in the engine');
  assert.doesNotMatch(source,/getBoundingClientRect\(\)[^;]*;[^\n]*ringField|clientWidth|offsetWidth|offsetHeight|querySelector\(/,'the engine never measures the DOM');
  assert.doesNotMatch(source,/ style=|<style|https?:\/\/|eval\(/);
});

test('BACKDROP: the opening plays once per session at full frame rate and lands every mark on its node',()=>{
  const h=harness(),engine=mountBackdrop(h.canvas,{view:h.view,reduced:false});
  h.size(1440,900);engine.setScene('login',{cx:490,cy:378,R:450});
  assert.equal(h.view.sessionStorage.getItem('36t-ring-intro'),'1');
  const before=h.calls.clearRect;h.run(320);
  assert.ok(h.calls.clearRect-before>=18,'every rAF draws during the opening');
  assert.ok(h.calls.stroke>0,'marks in flight are outlined');
  h.run(2600);const strokesAfterFlight=h.calls.stroke;
  assert.ok(strokesAfterFlight>0);
  engine.setScene('off');engine.setScene('login',{cx:490,cy:378,R:450});
  const again=h.calls.clearRect;h.run(320);
  assert.ok(h.calls.clearRect-again<=12,'second visit: idle cadence, no opening');
  engine.destroy();
});

test('BACKDROP: the governor degrades on dropped frames and ends in a static frame for the session',()=>{
  const h=harness(),engine=mountBackdrop(h.canvas,{view:h.view,reduced:false});
  h.view.sessionStorage.setItem('36t-ring-intro','1');
  h.size(1440,900);engine.setScene('login',{cx:490,cy:378,R:450});
  h.run(60*50*3+500,50);
  assert.equal(h.frames.length,0,'after three strikes the loop is gone');
  assert.equal(h.timers.size,1,'and the 60 s still-frame timer takes over');
  engine.resume();assert.equal(h.frames.length,0,'for the rest of the session');
  engine.destroy();
});

test('BACKDROP: the index scene is drawn once with no animation frame, and the old exports are untouched',()=>{
  const h=harness(),engine=mountBackdrop(h.canvas,{view:h.view,reduced:false});
  // signature.mjs passes the 760 x 554 box as its centre and R = half its height.
  h.size(1440,900);engine.setScene('index',{cx:444,cy:450,R:277});
  assert.equal(h.frames.length,0);assert.equal(h.timers.size,0);assert.equal(h.calls.clearRect,1);
  assert.ok(h.calls.moveTo>1200&&h.calls.moveTo<1800,`about 1,500 commas, got ${h.calls.moveTo}`);
  engine.setExclusions([{x:500,y:0,w:940,h:900}]);
  assert.equal(h.calls.clearRect,2,'new exclusions rebuild and redraw');
  engine.destroy();
  assert.equal(typeof mountCards,'function');assert.equal(typeof prefersReducedMotion,'function');
  assert.equal(typeof mountCards(null),'function');
});

test('BACKDROP: the gap closes only on proof: an explicit zero on home, the submit signal on login; null never closes it',()=>{
  const drawn=(scene,data)=>{
    const h=harness({reduced:true}),engine=mountBackdrop(h.canvas,{view:h.view,reduced:true});
    h.size(1440,900);engine.setScene(scene,{cx:700,cy:400,R:300});
    const before=h.calls.moveTo;engine.setData(data);const marks=h.calls.moveTo-before;engine.destroy();return marks;
  };
  const open=drawn('home',{pending:3,late:false,progress:.5,closed:false});
  assert.equal(drawn('home',{pending:null,late:false,progress:.5,closed:true}),drawn('home',{pending:null,late:false,progress:.5,closed:false}),'an unknown count claims nothing');
  assert.ok(drawn('home',{pending:0,late:false,progress:.5,closed:true})>open*1.1,'a confirmed zero completes the circle');
  assert.ok(drawn('login',{pending:null,late:false,progress:.5,closed:true})>drawn('login',{pending:null,late:false,progress:.5,closed:false})*1.1,'submitting the login form closes the ring');
  const moons=drawn('home',{pending:3,late:false,progress:.5,closed:false})-drawn('home',{pending:null,late:false,progress:.5,closed:false});
  assert.equal(moons,0,'moons are promoted lattice nodes, so the mark count does not change');
});

test('BACKDROP: new exclusions in mid-opening keep the running clock, and the opening block respects them',()=>{
  const h=harness(),engine=mountBackdrop(h.canvas,{view:h.view,reduced:false});
  h.size(1440,900);engine.setScene('login',{cx:490,cy:378,R:450});
  h.run(160);engine.setExclusions([{x:860,y:0,w:580,h:900}]);
  assert.equal(h.frames.length,1,'the loop goes on');
  h.run(1000);const mid=h.calls.stroke;h.run(64);
  assert.ok(h.calls.stroke>mid,'still in flight 1.2 s after the start: the 700 ms re-form did not replace the opening');
  h.run(1200);const fills=h.calls.fill;h.run(200);
  assert.ok(h.calls.fill>fills,'and it settles into filled marks');
  engine.destroy();
});

test('BACKDROP: a minute tick of progress is drawn without restarting the idle ladder, even when resume() follows it',()=>{
  const h=harness(),engine=mountBackdrop(h.canvas,{view:h.view,reduced:false});
  h.view.sessionStorage.setItem('36t-ring-intro','1');
  h.size(1440,900);engine.setScene('home',{cx:1200,cy:190,R:148});engine.setData({pending:2,late:false,progress:.4,closed:false});
  h.run(64000);assert.equal(h.frames.length,0,'idle: stopped');
  const before=h.calls.clearRect;
  engine.setData({pending:2,late:false,progress:.402,closed:false});engine.resume();
  assert.equal(h.frames.length,1);h.run(3000);
  assert.ok(h.calls.clearRect>before,'the new progress is drawn');
  assert.equal(h.frames.length,0,'and the loop is gone again within seconds, not after another 60');
  engine.resume();assert.equal(h.frames.length,1,'a real resume() (pointerdown, visibility) still restarts it');
  engine.destroy();
});

test('BACKDROP: the hero strip leaving the viewport stops the loop, and coming back restarts it',()=>{
  const h=harness();let seen=null;
  h.view.IntersectionObserver=class{constructor(fn){seen=fn;}observe(){}disconnect(){seen=null;}};
  const engine=mountBackdrop(h.canvas,{view:h.view,reduced:false});
  h.view.sessionStorage.setItem('36t-ring-intro','1');
  h.size(1440,900);engine.setScene('home',{cx:1200,cy:190,R:148});
  assert.equal(h.frames.length,1);
  seen([{isIntersecting:false}]);assert.equal(h.frames.length,0);
  engine.setData({pending:1,late:false,progress:.3,closed:false});assert.equal(h.frames.length,0,'data does not wake an off-screen hero');
  seen([{isIntersecting:true}]);assert.equal(h.frames.length,1);
  engine.destroy();assert.equal(seen,null);
});
