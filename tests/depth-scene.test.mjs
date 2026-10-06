import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMA, COMMA_CORNERS, HALF_CORNERS, FORMS, PALETTE, BRAIN_PARTS, LOBES, MARK, buildParticles, ambientField, groupMatrices, brainYaw, brainBase,
  brainSurface, foldParams, foldAt, makeSpark, stepSpark, sparkLight, COMET, MAX_SPARKS, sceneTarget, countFor, parseColor, derivePalette, unpack, fbm, mat4,
  mountDepth, SCENE_NAMES, SHADERS, BRAIN_EXTENT, fitRadius } from '../app/static/depth-scene.mjs';
import { readFileSync } from 'node:fs';

const near=(a,b,eps=1e-4)=>Math.abs(a-b)<=eps;
const P16=buildParticles({count:16000});          // desktop set, built once (the real engine's size)
const brainOf=(P,k)=>{const o=k*4,pos=P.forms.brain.pos,nrm=P.forms.brain.nrm;return {p:[pos[o],pos[o+1],pos[o+2]],n:[nrm[o],nrm[o+1],nrm[o+2]],size:nrm[o+3],...unpack(pos[o+3]),part:P.parts[k]};};

test('DEPTH: the mark is the brand comma quad in its 1.373:1 box, with its slant',()=>{
  assert.deepEqual(COMMA.map(p=>[...p]),[[.372,0],[1,0],[.539,1],[0,1]]);
  const xs=COMMA_CORNERS.map(q=>q[0]),ys=COMMA_CORNERS.map(q=>q[1]);
  assert.ok(near(Math.max(...ys)-Math.min(...ys),1,1e-9),'height 1');
  assert.ok(near(Math.max(...xs)-Math.min(...xs),1.373,1e-9),'width 1.373');
  const top=COMMA_CORNERS.filter(q=>q[1]>0),bottom=COMMA_CORNERS.filter(q=>q[1]<0),mid=l=>l.reduce((s,q)=>s+q[0],0)/l.length;
  assert.ok(mid(top)>mid(bottom)+.3,'top sits right of bottom: the original slant');
  assert.equal(HALF_CORNERS.length,3,'under 5 px: the half comma triangle');
  assert.ok(SHADERS.FS.includes(COMMA_CORNERS[1][0].toFixed(5)),'the fragment shader measures the distance to these exact corners');
});

test('DEPTH: the orientation only yaws and pitches (never rolls): horizontal edges stay horizontal',()=>{
  // The shader maps the comma by mat2(cos yaw, 0, sin yaw·sin pitch, cos pitch): x → (cos yaw, 0). Replay it here.
  for(const [yaw,pit] of [[0,0],[.6,0],[-.85,.4],[.3,-.75],[.85,.75]]){
    const M=([x,y])=>[x*Math.cos(yaw)+y*Math.sin(yaw)*Math.sin(pit),y*Math.cos(pit)],q=COMMA_CORNERS.map(M);
    assert.ok(near(q[0][1],q[1][1],1e-12)&&near(q[2][1],q[3][1],1e-12),'top and bottom edges horizontal');
    assert.ok(q[1][0]>q[0][0],'never mirrored');
  }
  assert.ok(/clamp\(atan\(nn\.x,nn\.z\),-\.85,\.85\)/.test(SHADERS.VS)&&/if\(nn\.z<0\.\)nn=-nn;/.test(SHADERS.VS),'yaw is clamped and the card is flipped to face the camera');
});

test('DEPTH: buildParticles is deterministic, exact in count, finite, and shares one storage order across forms',()=>{
  const a=buildParticles({count:3000,seed:36}),b=buildParticles({count:3000,seed:36}),c=buildParticles({count:3000,seed:7});
  assert.deepEqual([...FORMS],['brain','globe','galaxy']);
  assert.equal(a.count,3000);assert.equal(a.meta.length,3000*4);
  for(const f of FORMS){
    assert.equal(a.forms[f].pos.length,3000*4);assert.equal(a.forms[f].nrm.length,3000*4);
    assert.deepEqual(Array.from(a.forms[f].pos),Array.from(b.forms[f].pos));
    assert.ok(a.forms[f].pos.every(Number.isFinite)&&a.forms[f].nrm.every(Number.isFinite),f+' finite');
  }
  assert.notDeepEqual(Array.from(a.forms.brain.pos.subarray(0,400)),Array.from(c.forms.brain.pos.subarray(0,400)),'the seed matters');
  for(const n of [1,17,700])assert.equal(buildParticles({count:n}).count,n);
  for(const bad of [{count:0},{count:-5},{count:NaN}])assert.equal(buildParticles(bad).count,0);
  // the first n of the buffer (the governor's last step, the dust) is a uniform subsample: every part shows up in the first 10 %
  const seen=new Set();for(let k=0;k<1600;k++)seen.add(P16.parts[k]);
  for(let i=0;i<7;i++)assert.ok(seen.has(i),`part ${i} present in the first 10 % of the buffer`);
});

test('DEPTH: the brain has six sculpted parts in anatomical places, in real proportions',()=>{
  assert.deepEqual([...BRAIN_PARTS],['frontal','parietal','temporal','occipital','cerebellum','brainstem']);
  const byPart=Array.from({length:7},()=>[]);
  for(let k=0;k<P16.count;k++){const m=brainOf(P16,k);byPart[m.part].push(m.p);}
  byPart.slice(0,6).forEach((list,i)=>assert.ok(list.length>150,`${BRAIN_PARTS[i]}: ${list.length} marks`));
  const mean=(list,i)=>list.reduce((s,p)=>s+p[i],0)/list.length;
  const [fr,pa,te,oc,cb,st]=byPart;
  assert.ok(mean(fr,2)>.3&&mean(oc,2)<-.45,'frontal at the front (+z), occipital at the back');
  assert.ok(mean(pa,1)>mean(te,1)+.3,'parietal on top, temporal low');
  assert.ok(mean(te.map(p=>[Math.abs(p[0])]),0)>.4&&Math.abs(mean(te,0))<.1,'temporal lobes at both sides');
  assert.ok(mean(cb,1)<-.25&&mean(cb,2)<-.4,'cerebellum under the back');
  assert.ok(Math.min(...st.map(p=>p[1]))<-1&&Math.abs(mean(st,0))<.05,'the stem hangs on the midline, below everything');
  const cortex=byPart.slice(0,4).flat(),ext=i=>Math.max(...cortex.map(p=>p[i]))-Math.min(...cortex.map(p=>p[i]));
  const L=ext(2),Wd=ext(0),Ht=ext(1);
  assert.ok(L>1.9&&L<2.3,`length ${L.toFixed(2)}`);
  assert.ok(Wd/L>.66&&Wd/L<.82,`width/length ${(Wd/L).toFixed(2)} (a real cerebrum ≈ .74-.84)`);
  assert.ok(Ht/L>.5&&Ht/L<.66,`height/length ${(Ht/L).toFixed(2)} (≈ .57)`);
  assert.ok(Object.hasOwn(LOBES,'frontal')&&Object.hasOwn(LOBES,'temporal'));
});

test('DEPTH: a deep longitudinal fissure and a carved lateral sulcus',()=>{
  // no cortex mark sits in the fissure on top; the crowns either side stand above the fissure floor
  let inFissure=0;for(let k=0;k<P16.count;k++){const m=brainOf(P16,k);if(m.part<4&&Math.abs(m.p[0])<.02&&m.p[1]>0)inFissure++;}
  assert.equal(inFissure,0,'the fissure is open (its medial walls are occluded and not drawn)');
  const top=x=>{let y=.9;while(y>-.2&&brainBase(x,y,-.1)>0)y-=.004;return y;};
  assert.ok(top(0)<Math.min(top(.2),top(-.2))-.25,`fissure floor ${top(0).toFixed(2)} vs crowns ${top(.2).toFixed(2)}`);
  // the lateral sulcus: along its line the surface sits deeper than just above and below it
  const depthAt=(y,z)=>{let x=1;while(x>0&&brainBase(x,y,z)>0)x-=.002;return x;};
  const onLine=depthAt(-.05,.1),above=depthAt(.12,.1),below=depthAt(-.22,.1);
  assert.ok(onLine<Math.min(above,below)-.03,`sylvian ${onLine.toFixed(3)} vs ${above.toFixed(3)} / ${below.toFixed(3)}`);
});

test('DEPTH: gyri and sulci have real relief, lit crowns and dark sulci, with normals from the folded surface',()=>{
  const F=foldParams(false);
  assert.ok(F.k>10&&F.ws<F.wc&&F.sulcus>F.crown,'narrow deep sulci, broad rounded crowns');
  // relief: along a line across the lateral cortex the fold height swings by more than the mark height
  let lo=1,hi=-1;for(let t=0;t<=1;t+=.01){const s=brainSurface([.8,.12,-.5+t],F);if(s.fold){lo=Math.min(lo,s.fold.h);hi=Math.max(hi,s.fold.h);}}
  assert.ok(hi-lo>MARK.desktop*3,`relief ${(hi-lo).toFixed(3)} world units`);
  // sulcus width is set by distance to the nodal line, so it does not depend on the local spacing
  const f=foldAt(.5,.2,.1,[1,0,0],F);assert.ok(f.dist>=0&&f.sul>=0&&f.sul<=1&&f.crown>=0&&f.crown<=1&&Array.isArray(f.t)&&near(Math.hypot(...f.t),1,1e-6));
  // tones: the dark sulci are thinned; crowns and lips are the bright share
  const cortex=[];for(let k=0;k<P16.count;k++){const m=brainOf(P16,k);if(m.part<4)cortex.push({...m,tone:P16.tones[k]});}
  const share=t=>cortex.filter(m=>m.tone===t).length/cortex.length;
  assert.ok(share(0)<.12,`sulcus floors thinned to ${share(0).toFixed(2)}`);
  assert.ok(share(3)>.2&&share(2)>.05,`crowns ${share(3).toFixed(2)}, lips ${share(2).toFixed(2)}`);
  const mean=(t,fn)=>{const l=cortex.filter(m=>m.tone===t);return l.reduce((s,m)=>s+fn(m),0)/l.length;};
  assert.ok(mean(3,m=>m.size)>mean(0,m=>m.size)+.25,'crown marks are larger than sulcus marks');
  assert.ok(mean(0,m=>m.slot)<.5&&mean(3,m=>m.slot)>2.5,'sulci deep teal, crowns mint to paper');
  // normals: unit (× rim weight ≤ 1), outward, and tilted by the folds (not the smooth base normal)
  let tilted=0,outward=0;
  for(const m of cortex.slice(0,1500)){const l=Math.hypot(...m.n);assert.ok(l<=1.0001&&l>.5);const base=brainSurface(m.p,F).n,c=(m.n[0]*base[0]+m.n[1]*base[1]+m.n[2]*base[2])/l;if(c<.97)tilted++;if(c>0)outward++;}
  assert.ok(outward>1500*.96,`${outward}/1500 normals face outward`);
  assert.ok(tilted>300,`${tilted}/1500 normals tilted by the fold walls`);
});

test('DEPTH: palette from the brand tokens only — deep teal to paper, no other hue',()=>{
  assert.deepEqual([...PALETTE],['abyss','turquoise-deep','turquoise','mint','sky','paper']);
  const t=parseColor('#16A085'),pal=derivePalette({turquoise:t,deep:parseColor('#12806B'),sky:parseColor('#DDE6ED'),paper:parseColor('#FAF9FF')});
  const hue=([r,g,b])=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;if(d<.02)return null;let h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;return (h*60+360)%360;};
  for(const c of pal.slice(0,4)){const h=hue(c);assert.ok(h>150&&h<180,`teal family hue ${h?.toFixed(0)}`);}
  assert.ok(pal[3][1]>t[1]&&pal[3][0]<pal[3][1],'mint is a lighter tint of the turquoise');
  for(const c of pal)assert.ok(!(c[0]>.6&&c[1]>.5&&c[2]<.3),'no yellow');
  // the engine reads only these four tokens
  const src=mountDepth.toString();
  for(const tok of ['--spark','--occasion','--ring-d','--stop'])assert.ok(!src.includes(tok),`does not read ${tok}`);
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(Object.values(SHADERS).join('')),'no colour literals in shaders');
});

test('DEPTH: tokens parse from hex, rgb() and color(srgb)',()=>{
  assert.deepEqual(parseColor('#16A085').map(v=>Math.round(v*255)),[22,160,133]);
  assert.deepEqual(parseColor(' #fff ').map(v=>Math.round(v*255)),[255,255,255]);
  assert.deepEqual(parseColor('rgb(22, 160, 133)').map(v=>Math.round(v*255)),[22,160,133]);
  assert.deepEqual(parseColor('rgba(22 160 133 / .5)').map(v=>Math.round(v*255)),[22,160,133]);
  assert.deepEqual(parseColor('color(srgb 0.0863 0.6275 0.5216)').map(v=>Math.round(v*255)),[22,160,133]);
  for(const bad of ['','currentColor','var(--x)','#12',null,undefined,'rgb(1,2)'])assert.equal(parseColor(bad),null);
});

test('DEPTH: synapse sparks travel along the folds and stay on the surface',()=>{
  const F=foldParams(false),start=brainSurface([.75,.15,.1],F).p,s=makeSpark(start,1,{life:1.5,speed:.5});
  let prev=start,path=0,maxOff=0;const t0=foldAt(...brainSurface(start,F).base,brainSurface(start,F).n,F).t;
  for(let i=0;i<30&&stepSpark(s,1/60,F);i++){path+=Math.hypot(s.p[0]-prev[0],s.p[1]-prev[1],s.p[2]-prev[2]);prev=s.p;maxOff=Math.max(maxOff,Math.abs(brainBase(...brainSurface(s.p,F).base)));}
  assert.ok(path>.2&&path<.4,`travelled ${path.toFixed(3)} in .5 s at .5/s`);
  assert.ok(maxOff<1e-3,'re-projected onto the surface every step');
  const moved=[s.p[0]-start[0],s.p[1]-start[1],s.p[2]-start[2]],ml=Math.hypot(...moved);
  assert.ok(Math.abs((moved[0]*t0[0]+moved[1]*t0[1]+moved[2]*t0[2])/ml)>.5,'it follows the fold it started on');
  assert.ok(s.path.length>1&&s.path.length<=COMET&&s.trail.length===2,'a comet path and a trail');
  assert.ok(sparkLight(s)>0);while(stepSpark(s,.1,F));assert.equal(sparkLight(s),0,'and it dies out');
  assert.ok(MAX_SPARKS*3<=18,'the spark uniforms fit WebGL1 budgets');
});

test('DEPTH: scenes — the brain on login and home, the globe on the index, a dim slow dust on work screens',()=>{
  assert.deepEqual([...SCENE_NAMES].sort(),['home','index','login','off']);
  const login=sceneTarget('login'),home=sceneTarget('home'),index=sceneTarget('index'),off=sceneTarget('off');
  assert.equal(login.form,'brain');assert.equal(home.form,'brain');assert.equal(index.form,'globe');assert.equal(off.form,'galaxy');
  assert.ok(login.live&&home.live&&!index.live&&!off.live,'only the brain scenes are interactive');
  assert.ok(off.dim<=.25&&off.speed<login.speed/2,'off: very dim and slow');
  assert.ok(login.cam.elev>15&&login.cam.elev<35,'a 3/4 view from above');
  assert.equal(sceneTarget('nonsense').name,'off');
  // a slow majestic turn: a held 3/4 view that sways, never spins round
  const ys=Array.from({length:400},(_,i)=>brainYaw(i*.5));
  assert.ok(Math.max(...ys)-Math.min(...ys)>.5&&Math.max(...ys)<-.6&&Math.min(...ys)>-1.7,'sways within the 3/4 range');
  assert.ok(Math.max(...ys.slice(1).map((y,i)=>Math.abs(y-ys[i])))<.02,'under 2.3°/s');
  const G=groupMatrices('brain',3);for(const c of [0,1,2])assert.ok(near(Math.hypot(G[c*3],G[c*3+1],G[c*3+2]),1,1e-6),'rotation');
  assert.equal(countFor({mobile:false}),16000);assert.equal(countFor({mobile:true}),8000);
});

test('DEPTH: ambient field, fbm and mat4 helpers',()=>{
  const A=ambientField({count:160});assert.equal(A.length,160*8);let big=0;
  for(let k=0;k<160;k++){assert.ok(A[k*8+2]<-1,'ambient sits in front of the camera, in view space');if(A[k*8+7]>2)big++;}
  assert.ok(big>=4&&big<=10,`near bokeh commas are rare: ${big}`);
  assert.ok(fbm(.3,.2,.1)>=0&&fbm(.3,.2,.1)<=1);
  const V=mat4.lookAt(mat4.create(),[0,3,4],[0,0,0],[0,1,0]);
  for(const c of [0,1,2])assert.ok(near(Math.hypot(V[c*4],V[c*4+1],V[c*4+2]),1,1e-6));
  const P=mat4.perspective(mat4.create(),Math.PI/2,2,.1,100);assert.ok(near(P[0],.5)&&near(P[5],1)&&P[11]===-1);
});

test('DEPTH: shaders are plain strings with bloom, depth of field, fog, a key light and the neural uniforms',()=>{
  for(const s of Object.values(SHADERS))assert.equal(typeof s,'string');
  for(const u of ['uMorph','uGA','uGB','uCol','uPointer','uRimA','uRects','uLight','uWaves','uSparks','uCoc','uFocus'])assert.ok(SHADERS.VS.includes(u),u);
  assert.ok(/a\*=keep;/.test(SHADERS.VS),'exclusion rects fade marks to zero');
  assert.ok(SHADERS.BLUR.includes('.2270270')&&SHADERS.COMP.includes('uBloom'),'a separable Gaussian bloom chain');
  assert.ok(/coc=min\(uCoc/.test(SHADERS.VS),'a circle of confusion per mark');
  assert.ok(/exp\(-max\(depth-uFocus/.test(SHADERS.VS),'exponential depth fog');
  assert.ok(/for\(int i=0;i<18;i\+\+\)/.test(SHADERS.VS),'sparks loop has a constant bound (GLSL ES 1.0)');
});

// ---- mountDepth against fakes. No DOM, no GPU.
const API=['setScene','setData','setExclusions','dim','pulse','spark','pause','resume','destroy','enableTilt','stats'];
const ATTRS=['aA','aB','aNA','aNB','aMeta'];
function fakeGL({ext=true}={}){
  const calls=[];let ids=0;
  const special={createShader:()=>({id:++ids}),createProgram:()=>({id:++ids}),createBuffer:()=>({id:++ids}),createTexture:()=>({id:++ids}),createFramebuffer:()=>({id:++ids}),
    getShaderParameter:()=>true,getProgramParameter:()=>true,checkFramebufferStatus:()=>'FRAMEBUFFER_COMPLETE'.length,
    getAttribLocation:(p,n)=>ATTRS.indexOf(n),getUniformLocation:(p,n)=>({n}),getParameter:()=>new Float32Array([1,256]),getExtension:n=>ext&&/color_buffer/.test(n)?{}:null,isContextLost:()=>false};
  const gl=new Proxy({},{get(_,key){
    if(typeof key!=='string')return undefined;
    if(key==='FRAMEBUFFER_COMPLETE')return 'FRAMEBUFFER_COMPLETE'.length;
    if(/^[A-Z_0-9]+$/.test(key))return key.length;
    return (...args)=>{calls.push([key,args]);return special[key]?.(...args);};
  }});
  return {gl,calls,count:name=>calls.filter(c=>c[0]===name).length};
}
function harness({gl=fakeGL(),kind='webgl2',reduced=false,coarse=false,tokens={}}={}){
  const frames=[],listeners=new Map(),docListeners=new Map(),store=new Map();let now=0,ids=0,resize=null,mutate=null;
  const canvasListeners=new Map();
  const canvas={width:300,height:150,clientWidth:0,clientHeight:0,getContext:k=>k===kind?gl.gl:null,addEventListener:(t,fn)=>canvasListeners.set(t,fn),removeEventListener:t=>canvasListeners.delete(t),getBoundingClientRect:()=>({left:0,top:0,width:1440,height:900})};
  const html={dataset:{}};
  const view={
    devicePixelRatio:2,performance:{now:()=>now},innerWidth:1440,innerHeight:900,
    requestAnimationFrame:fn=>{frames.push(fn);return ++ids;},cancelAnimationFrame:()=>{frames.length=0;},
    addEventListener:(t,fn)=>{if(!listeners.has(t))listeners.set(t,new Set());listeners.get(t).add(fn);},removeEventListener:(t,fn)=>listeners.get(t)?.delete(fn),
    getComputedStyle:()=>({getPropertyValue:n=>tokens[n]??''}),
    matchMedia:q=>({matches:q.includes('reduce')?reduced:q.includes('coarse')?coarse:false,addEventListener(){},removeEventListener(){}}),
    ResizeObserver:class{constructor(fn){resize=fn;}observe(){}disconnect(){resize=null;}},
    MutationObserver:class{constructor(fn){mutate=fn;}observe(){}disconnect(){mutate=null;}},
    sessionStorage:{getItem:k=>store.get('s:'+k)??null,setItem:(k,v)=>store.set('s:'+k,v)},
    localStorage:{getItem:k=>store.get(k)??null},
    document:{documentElement:html,hidden:false,addEventListener:(t,fn)=>docListeners.set(t,fn),removeEventListener:t=>docListeners.delete(t)}
  };
  const fire=(t,e)=>{for(const fn of listeners.get(t)||[])fn(e);};
  return {canvas,view,gl,frames,listeners,docListeners,canvasListeners,html,fire,
    size:(w,h)=>resize?.([{contentRect:{width:w,height:h}}]),mutate:()=>mutate?.([]),
    run(ms,step=16){for(let t=0;t<ms&&frames.length;t+=step){now+=step;frames.shift()(now);}return now;},advance(ms){now+=ms;}};
}
const pointDraws=h=>h.gl.calls.filter(c=>c[0]==='drawArrays'&&c[1][0]==='POINTS'.length).map(c=>c[1][2]);
const lastUniform=(h,name)=>h.gl.calls.filter(c=>c[0].startsWith('uniform')&&c[1][0]?.n===name).at(-1)?.[1];

test('DEPTH: no WebGL means ok:false and harmless no-ops for the whole API',()=>{
  const h=harness();
  for(const broken of [null,undefined,{},{getContext:()=>null},{getContext(){throw new Error('no gl');}},{getContext:()=>({})}]){
    const dead=mountDepth(broken,{view:h.view});
    assert.equal(dead.ok,false);
    assert.deepEqual(Object.keys(dead).sort(),[...API,'ok'].sort());
    assert.doesNotThrow(()=>{dead.setScene('login',{cx:1,cy:1,R:10});dead.setData({pending:3,progress:.5});dead.setExclusions([{x:0,y:0,w:1,h:1}]);dead.dim(.3);dead.pulse();dead.spark(1,2);dead.pause();dead.resume();dead.destroy();});
    assert.ok(dead.enableTilt() instanceof Promise);
  }
});

test('DEPTH: a failing shader compile reports ok:false; WebGL1 mounts too',()=>{
  const g=fakeGL(),gl=new Proxy({},{get(_,k){if(k==='getShaderParameter')return ()=>false;return g.gl[k];}});
  const h=harness({gl:{gl}});assert.equal(mountDepth(h.canvas,{view:h.view}).ok,false);
  const w1=harness({kind:'webgl'}),e=mountDepth(w1.canvas,{view:w1.view});assert.equal(e.ok,true);
  w1.size(1440,900);e.setScene('home',{cx:1080,cy:190,R:148});w1.run(100);assert.ok(pointDraws(w1).includes(16000));e.destroy();
});

test('DEPTH: native DPR, HDR bloom chain, one draw of the whole set; morphs through the galaxy; cleans up',()=>{
  const h=harness({tokens:{'--brand-turquoise':'#16A085','--brand-sky':'rgb(221,230,237)','--canvas':'#000'}}),engine=mountDepth(h.canvas,{view:h.view,reduced:false});
  assert.equal(engine.ok,true);
  assert.deepEqual(Object.keys(engine).sort(),[...API,'ok'].sort());
  assert.equal(h.gl.count('createProgram'),4,'marks + downsample + blur + composite');
  assert.equal(h.frames.length,0,'no scene, no frame');
  h.size(1440,900);assert.equal(h.canvas.width,2880,'desktop renders at DPR 2');
  engine.setScene('login',{cx:490,cy:378,R:450,mirror:false});assert.ok(h.frames.length>0,'login animates');
  h.run(3200);                                      // the first login of a session: the galaxy gathers into the brain
  assert.ok(pointDraws(h).includes(16000),'16k marks in one draw');
  assert.ok(h.gl.count('framebufferTexture2D')>=6&&h.gl.calls.some(c=>c[0]==='texImage2D'&&c[1][2]==='RGBA16F'.length),'six half-float targets for the bloom chain');
  assert.equal(engine.stats().form,'brain');
  engine.setScene('index');h.run(300);assert.equal(engine.stats().form,'galaxy','a morph leaves through the galaxy');
  h.run(3000);assert.equal(engine.stats().form,'globe','and arrives at the globe');
  engine.setScene('off');h.run(2500);assert.equal(engine.stats().form,'galaxy');assert.ok(pointDraws(h).at(-1)<16000,"'off' draws a lighter dust");
  h.run(21000,33);assert.equal(h.frames.length,0,"'off' stops after its idle timeout");
  engine.destroy();
  assert.ok(h.gl.count('deleteBuffer')>=8&&h.gl.count('deleteProgram')>=4&&h.gl.count('deleteFramebuffer')>=6,'GL resources freed');
  assert.equal(h.canvas.width,0);
  for(const t of ['pointermove','pointerdown','scroll','36t:brain'])assert.ok(!h.listeners.get(t)?.size,`${t} listener removed`);
  assert.ok(!h.docListeners.has('visibilitychange'));
  assert.doesNotThrow(()=>{engine.setScene('login');engine.pulse();engine.spark();engine.destroy();},'calls after destroy are harmless');
});

test('DEPTH: phones render at DPR 3 with 8k marks; the governor steps the DPR down, then freezes',()=>{
  const v=harness(),e=mountDepth(v.canvas,{view:v.view});v.view.devicePixelRatio=3;v.size(390,844);
  assert.equal(v.canvas.width,1170,'DPR 3 on a phone: 1170 × 2532');
  e.setScene('login');v.run(200);assert.ok(pointDraws(v).includes(8000));
  v.run(4000,45);                                   // 45 ms frames: sustained overload
  assert.ok(e.stats().level>=2&&v.canvas.width<1170,`stepped down to ${v.canvas.width} px wide`);
  v.run(20000,45);assert.equal(v.frames.length,0,'then a frozen still frame');
  const c=harness(),e2=mountDepth(c.canvas,{view:c.view});c.size(1440,900);e2.setScene('login');c.run(3000,33.3);
  assert.equal(e2.stats().level,0,'a steady 30 Hz cadence (low power mode) never costs resolution');
  e.destroy();e2.destroy();
});

test('DEPTH: reduced motion draws one settled frame and never loops; theme changes redraw it',()=>{
  const h=harness({reduced:true}),engine=mountDepth(h.canvas,{view:h.view});
  h.size(1440,900);engine.setScene('login',{cx:490,cy:378,R:450});
  assert.equal(h.frames.length,0,'no rAF under reduced motion');
  const before=h.gl.count('drawArrays');assert.ok(before>=1,'a static frame was drawn');
  h.mutate();assert.ok(h.gl.count('drawArrays')>before,'theme change redraws');
  engine.setScene('index');assert.equal(h.frames.length,0,'scene change under reduced motion: no morph loop');
  engine.pulse();engine.spark(300,300);h.fire('36t:brain',{detail:{kind:'spark'}});assert.equal(h.frames.length,0,'neural events are ignored');
  assert.equal(engine.stats().sparks,0);
  const d=harness(),other=mountDepth(d.canvas,{view:d.view});d.html.dataset.motion='off';d.size(800,600);other.setScene('home');assert.equal(d.frames.length,0,'html[data-motion=off] is honoured');
});

test('DEPTH: idle stops the loop; the pointer wakes it; hidden tabs and context loss stop it',()=>{
  const h=harness(),engine=mountDepth(h.canvas,{view:h.view});
  h.size(1440,900);engine.setScene('home',{cx:1080,cy:190,R:148});
  h.run(91000);assert.equal(h.frames.length,0,'desktop idles out after 90 s');
  h.fire('pointermove',{clientX:100,clientY:100});assert.ok(h.frames.length>0,'the pointer wakes it');
  h.view.document.hidden=true;h.docListeners.get('visibilitychange')();assert.equal(h.frames.length,0,'hidden stops');
  h.view.document.hidden=false;h.docListeners.get('visibilitychange')();assert.ok(h.frames.length>0,'visible resumes');
  const programs=h.gl.count('createProgram');
  h.canvasListeners.get('webglcontextlost')({preventDefault(){}});assert.equal(h.frames.length,0,'context loss stops the loop');
  h.canvasListeners.get('webglcontextrestored')();assert.equal(h.gl.count('createProgram'),programs+4,'restore rebuilds programs, buffers and targets');
  h.fire('pointermove',{clientX:120,clientY:100});assert.ok(h.frames.length>0,'and it runs again');
  engine.setScene('off');h.run(500);h.run(21000,33);assert.equal(h.frames.length,0,'dust idles');
  h.fire('pointermove',{clientX:300,clientY:300});assert.equal(h.frames.length,0,'on work screens the pointer does not wake the dust');
  engine.destroy();
});

test('DEPTH: the neural layer — pointer sparks, a click wave, the API and the 36t:brain events',()=>{
  const h=harness(),engine=mountDepth(h.canvas,{view:h.view});
  h.size(1440,900);engine.setScene('login',{cx:400,cy:450,R:300});h.run(500);
  // hover over the brain: a lit neighbourhood and a synapse spark from the nearest fold
  for(let i=0;i<8;i++){h.fire('pointermove',{clientX:330+i*30,clientY:440});h.run(200);}
  assert.ok(lastUniform(h,'uPointer')[3]>.5,'the pointer lights its neighbourhood');
  assert.ok(engine.stats().sparks>0,'hovering sends sparks along the folds');
  assert.ok(lastUniform(h,'uSparkN')[1]>0,'spark uniforms are fed');
  // a click sends a pulse wave (not from a text field)
  h.run(3000);h.fire('pointerdown',{clientX:400,clientY:450,button:0,target:{closest:()=>null}});h.run(32);
  const W=lastUniform(h,'uWaves')[1];assert.ok(W[3]>0&&W[2]>=0&&W[2]<.2,'a fresh wave');
  h.run(3000);h.fire('pointerdown',{clientX:400,clientY:450,button:0,target:{closest:s=>s.includes('input')?{}:null}});h.run(32);
  assert.equal(lastUniform(h,'uWaves')[1][3],0,'no wave when the tap lands in a field');
  // the API and the window event share one path
  h.run(3000);engine.spark(400,450);assert.ok(engine.stats().sparks>=4&&engine.stats().waves===1,'spark(x,y): a burst of sparks and a wave');
  h.run(3000);h.fire('36t:brain',{detail:{kind:'pulse'}});assert.equal(engine.stats().waves,1,'36t:brain pulse');
  h.fire('36t:brain',{detail:{kind:'pulse'}});assert.equal(engine.stats().waves,1,'pulses within 600 ms merge');
  h.run(200);h.fire('36t:brain',{detail:{kind:'dim'}});h.run(160);
  assert.ok(lastUniform(h,'uDim')[1]<.6,'dim: a brief flinch');
  h.run(1500);assert.ok(lastUniform(h,'uDim')[1]>.9,'and it recovers');
  h.run(3000);h.fire('36t:brain',{detail:{kind:'spark',x:420,y:430}});assert.ok(engine.stats().sparks>0,'36t:brain spark');
  // work screens: no sparks, a soft wave in the dust
  engine.setScene('off');h.run(3000);engine.spark(200,200);assert.equal(engine.stats().sparks,0);assert.equal(engine.stats().waves,1);
  engine.destroy();
});

test('DEPTH: exclusion rects keep text clear; login seats the brain 40 px clear of the text column; the home count sits in a soft window',()=>{
  const h=harness(),engine=mountDepth(h.canvas,{view:h.view});h.size(1440,900);
  engine.setScene('login',{cx:490,cy:378,R:450,mirror:false});
  engine.setExclusions([{x:820,y:90,w:555,h:150},{x:930,y:310,w:445,h:390},null,{w:0}]);h.run(2000);
  assert.equal(lastUniform(h,'uRectN')[1],2,'invalid rects are dropped');
  const sx=lastUniform(h,'uShift')[1],cx=(sx+1)/2*1440;assert.ok(cx<820-40,'the brain sits in the free half');
  engine.setScene('home',{cx:395,cy:461,R:148,mirror:false});h.run(2000);
  const hole=lastUniform(h,'uHole');
  assert.deepEqual([hole[1],Math.round(hole[2])],[395*2,Math.round(1800-(461+148*.08)*2)],'a soft window sits on the count at the centre of the home seat');
  assert.ok(hole[3]>hole[4]&&hole[4]>0,'an ellipse, wider than tall');
  engine.setScene('index');h.run(200);assert.equal(lastUniform(h,'uHole')[3],0,'and only on home');
  engine.destroy();
});

// ---- the brain belongs to its hero (owner's iPhone report, 19 Sep): it scrolls away with the hero and fits its phone stage
test('DEPTH: fitRadius shrinks the brain into its stage box and never grows it',()=>{
  const fit={top:68,bottom:282,left:16,right:374};
  assert.equal(fitRadius(128,195,165,null),128,'no stage, no change');
  assert.equal(fitRadius(128,195,165,fit),128,'a 390 phone: the approved size already fits (97 px above, 117 below)');
  const r=fitRadius(160,195,165,fit);
  assert.ok(near(r,(165-68)/BRAIN_EXTENT.up,1e-9),`a stage too short: R ${r.toFixed(1)} from the room above`);
  assert.ok(165-r*BRAIN_EXTENT.up>=68-1e-9&&165+r*BRAIN_EXTENT.down<=282,'the whole brain lies inside the stage');
  assert.equal(fitRadius(128,195,165,{top:200,bottom:100,left:0,right:0}),0,'an impossible stage clamps to zero (the engine floors R at 40)');
});

test('DEPTH: the engine honours the stage box; picking works on a canvas scrolled with its hero',()=>{
  const dist=fit=>{const h=harness({reduced:true}),e=mountDepth(h.canvas,{view:h.view});h.view.devicePixelRatio=3;h.size(390,844);
    e.setScene('home',{cx:195,cy:165,R:62.5,fit});const V=lastUniform(h,'uView')[2];e.destroy();return Math.abs(V[14]);};
  const free=dist(undefined),same=dist({top:68,bottom:282,left:16,right:374}),tight=dist({top:120,bottom:282,left:16,right:374});
  assert.ok(near(free,same,1e-6),'a stage the brain already fits changes nothing (the approved look)');
  assert.ok(tight>free*1.5,'a short stage moves the camera back: a smaller brain');
  // the canvas is absolute at the top of the document: scrolled 600 px, its box starts at client y −600
  const h=harness(),engine=mountDepth(h.canvas,{view:h.view});h.canvas.getBoundingClientRect=()=>({left:0,top:-600,width:1440,height:900});
  h.size(1440,900);engine.setScene('login',{cx:400,cy:450,R:300});h.run(500);
  for(let i=0;i<8;i++){h.fire('pointermove',{clientX:330+i*30,clientY:440-600});h.run(200);}
  assert.ok(engine.stats().sparks>0,'hover over the scrolled brain still finds its folds (client → canvas coordinates)');
  engine.destroy();
});

test('DEPTH: the brain canvas is absolute in its hero scenes, fixed for the dust; signature hands over the stage; the census number is Latin',()=>{
  const css=readFileSync(new URL('../app/static/depth.css',import.meta.url),'utf8'),sig=readFileSync(new URL('../app/static/signature.mjs',import.meta.url),'utf8');
  assert.match(css,/:root\[data-design=depth\] \.sig-depth\{position:fixed;inset:0;/,'fixed by default (dust, index)');
  assert.match(css,/:root\[data-design=depth\]:is\(\[data-scene=home\],\[data-scene=login\]\) \.sig-depth\{position:absolute;inset:0 0 auto;block-size:100vh;/,'absolute at the top of the document in the brain scenes');
  assert.match(css,/mask-image:linear-gradient\(#000 calc\(100% - 120px\),transparent\)\}/,'its lower edge fades instead of cutting a line when it scrolls into view');
  assert.match(sig,/fit:stageAround\(cx,cy,r\.width\/2,exclude,box\(hero,origin\)\?\.y\?\?0,origin\)/,'home: the stage runs from the hero top to the first text in the eye column');
  assert.match(sig,/fit:geometry\.fit/,'and reaches the engine');
  assert.match(sig,/eyeObserver\.observe\(host\)/,'a hero layout change re-measures the scene and its exclusions');
  assert.doesNotMatch(sig,/addEventListener\('scroll'/,'no scroll listener: the compositor moves the canvas');
  assert.match(sig,/paintCensus\(sentence,census\(signal\)\)/);
  assert.match(sig,/make\('span','sig-census-n',m\[1\]\);n\.setAttribute\('data-num',''\)/,'the count is its own [data-num] run: tabular Latin figures');
});
