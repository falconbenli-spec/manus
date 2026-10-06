// Pointer-reactive motion for service and department cards.
// Styles come from the stylesheet; this module only sets custom properties, so the
// page keeps its strict Content-Security-Policy with no inline style attributes in markup.
// ENTER: the cards that also get the staggered entrance (rq-enter / rq-shown). TILT: every card that follows the pointer
// through --mx --my --tilt-x --tilt-y and .is-live; only a stylesheet that reads those variables (depth.css) makes the tilt visible.
const ENTER='.rq-card:not(.is-static),.rq-dept';
const SELECTOR=ENTER+',.vn-tile,.pt-tile,.department-card,.journey-stop';
const STEP=34,MAX_DELAY=16;

export function prefersReducedMotion(view=globalThis){
  try{return !!view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;}catch{return false;}
}

// enter:false tracks the pointer only (no entrance classes): app.mjs uses it for every screen but the catalog.
export function mountCards(root,{view=globalThis,reduced=prefersReducedMotion(view),enter=true}={}){
  const targets=root&&typeof root.querySelectorAll==='function'?[...root.querySelectorAll(SELECTOR)]:[];
  if(!targets.length)return ()=>{};
  const entering=enter?targets.filter(card=>typeof card.matches!=='function'||card.matches(ENTER)):[];
  entering.forEach((card,index)=>{
    card.classList.add('rq-enter');
    card.style?.setProperty?.('--rq-delay',`${Math.min(index,MAX_DELAY)*STEP}ms`);
  });
  const show=()=>entering.forEach(card=>card.classList.add('rq-shown'));
  if(reduced){show();return ()=>{};}
  const frame=view.requestAnimationFrame?view.requestAnimationFrame(show):(show(),0);
  const reset=card=>{
    card.classList.remove('is-live');
    card.style?.setProperty?.('--tilt-x','0deg');
    card.style?.setProperty?.('--tilt-y','0deg');
  };
  const move=event=>{
    const card=event.target?.closest?.(SELECTOR);
    if(!card||!targets.includes(card)||typeof card.getBoundingClientRect!=='function')return;
    const box=card.getBoundingClientRect();
    if(!box.width||!box.height)return;
    const x=(event.clientX-box.left)/box.width,y=(event.clientY-box.top)/box.height;
    card.style?.setProperty?.('--mx',`${(x*100).toFixed(1)}%`);
    card.style?.setProperty?.('--my',`${(y*100).toFixed(1)}%`);
    card.style?.setProperty?.('--tilt-x',`${((0.5-y)*4).toFixed(2)}deg`);
    card.style?.setProperty?.('--tilt-y',`${((x-0.5)*5).toFixed(2)}deg`);
    card.classList.add('is-live');
  };
  const leave=event=>{const card=event.target?.closest?.(SELECTOR);if(card)reset(card);};
  root.addEventListener('pointermove',move);
  root.addEventListener('pointerleave',leave,true);
  root.addEventListener('pointercancel',leave,true);
  return ()=>{
    view.cancelAnimationFrame?.(frame);
    root.removeEventListener('pointermove',move);
    root.removeEventListener('pointerleave',leave,true);
    root.removeEventListener('pointercancel',leave,true);
    targets.forEach(reset);
  };
}

// ---- «الحلقة»: the ring engine (VOID 360 §4, contract 4). Two pure field builders and one canvas backdrop.
// Nothing here touches document/window at module level; geometry arrives through setScene only; colours come from the design tokens.
// A field holds 10 floats per mark: x y hx hy t k c f d ph, with f = flags | feather<<8 | moon ordinal<<16.
const RATIO=1.13,ASPECT=1.373,ARC=Math.PI*5/3,TAU=Math.PI*2,COMMA=[.372,0,1,0,.539,1,0,1],HALF=[0,0,.862,0,.229,1];
const MIRROR=1,MOON=2,DRIFTER=4,EDGE=8,TOKENS=['--ring-a','--ring-b','--ring-c','--ring-d','--stop','--ink-1'];
const hash=(i,j)=>{let n=Math.imul(i,374761393)^Math.imul(j,668265263);n=Math.imul(n^n>>>13,1274126177);return ((n^n>>>16)>>>0)/4294967296;};
const ink=(t,p=0)=>t<0?0:t<=p?1:Math.max(.15,1-1.06*(t-p)/(1-p));
const unit=v=>Math.min(1,Math.max(0,+v||0)),toward=(a,b,d)=>a+Math.sign(b-a)*Math.min(Math.abs(b-a),d);
const cut=(x,y,rects,feather)=>{let m=1;for(const r of rects){const d=Math.hypot(Math.max(r.x-x,0,x-r.x-r.w),Math.max(r.y-y,0,y-r.y-r.h));if(!d)return 0;if(feather>0)m=Math.min(m,d/feather);}return m;};
const node=(x,y,t,k,m,f,i,j,d=t*500)=>{const h=hash(i,j);return [x,y,x,y,t,k*m,h<.77?0:h<.87?1:h<.97?2:3,f|Math.round(m*255)<<8,d,hash(i+31,j-17)*TAU];};
const pack=list=>{const data=new Float32Array(list.length*10);list.forEach((q,n)=>data.set(q,n*10));return {data,count:list.length};};

export function ringField({width=0,height=0,cx=0,cy=0,R=0,band=.28,pitch=0,exclude=[],feather=48,mirror=false,moons=12,drifters=0}={}){
  const list=[];if(!(R>0)||!(pitch>0))return pack(list);
  const py=pitch*RATIO,reach=drifters?1.45:1.12,ni=Math.ceil(R*reach/pitch),nj=Math.ceil(R*reach/py),chance=drifters*pitch*py/(Math.PI*R*R*.848);
  for(let j=-nj;j<=nj;j++)for(let i=-ni-1;i<=ni;i++){
    const x=cx+(i+.5)*pitch,y=cy+j*py,r=Math.hypot(x-cx,y-cy),g=hash(j+911,i);let f=(x<cx)!==mirror?MIRROR:0;
    if(r<R*(1-band)||x<-pitch||y<-py||x>width+pitch||y>height+py)continue;
    if(r>R*1.12){if(r>R*1.45||g>=chance)continue;f|=DRIFTER;}
    else if(r>R){if(g>=1-(r-R)/(R*.12))continue;f|=EDGE;}
    const m=cut(x,y,exclude,feather);if(!m)continue;
    let a=Math.atan2(mirror?x-cx:cx-x,cy-y);if(a<0)a+=TAU;
    const t=f&DRIFTER||a>ARC?-1:a/ARC;list.push(node(x,y,t,f&DRIFTER?.3:ink(t),m,f,i,j,a/ARC*500));
  }
  for(let n=0;n<moons;n++){
    const a=(n+.5)*2.4*pitch/R,tx=cx+(mirror?1:-1)*Math.sin(a)*(R-pitch/2),ty=cy-Math.cos(a)*(R-pitch/2);let best,near=pitch*1.5;
    for(const q of list){const d=Math.hypot(q[2]-tx,q[3]-ty);if(d<near&&!(q[7]&(MOON|DRIFTER))){near=d;best=q;}}
    if(best)best[7]|=MOON|n<<16;
  }
  return pack(list);
}

export function commaField({x=0,y=0,w=0,h=0,pitch=0,axis='x',mask=true,mirror=false,exclude=[],feather=48}={}){
  const list=[];if(!(w>0)||!(h>0)||!(pitch>0))return pack(list);
  const py=pitch*RATIO,cols=Math.floor(w/pitch),rows=Math.floor(h/py);
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
    const u=(i+.5)/cols,v=(j+.5)/rows,px=x+(i+.5)*pitch,qy=y+(j+.5)*py;
    if(mask&&(u<.372*(1-v)||u>1-.461*v))continue;
    const m=cut(px,qy,exclude,feather),t=axis==='y'?v:mirror?1-u:u;
    if(m)list.push(node(px,qy,t,ink(t),m,(u<.5)!==mirror?MIRROR:0,i,j));
  }
  return pack(list);
}

export function mountBackdrop(canvas,{view=globalThis,reduced=prefersReducedMotion(view)}={}){
  const noop=()=>{};let ctx=null;try{ctx=canvas?.getContext?.('2d')||null;}catch{}
  if(!ctx)return {setScene:noop,setData:noop,setExclusions:noop,dim:noop,pulse:noop,pause:noop,resume:noop,destroy:noop};
  const doc=view.document,html=doc?.documentElement,clock=()=>view.performance?.now?.()??Date.now(),later=(fn,ms)=>view.setTimeout?.(fn,ms)||0,never=id=>view.clearTimeout?.(id);
  let scene='off',geo={},rects=[],pending=null,late=false,goal=0,closed=false,p=0,shut=0,dimTo=1,dimNow=1,paused=false,frozen=false,level=0;
  let W=0,H=0,pitch=0,P=null,D,L=0,keys,order,tones=[],drift=false,tracking=false,raf=0,timer=0,wait=0;
  let T0=-1e9,hold=0,span=1,idle=0,lastTick=0,lastDraw=0,frames=0,sum=0,slot=0,mx=0,my=0,moved=-1e9,ghostAt=-1e9,ghost=0,opening=false,stale=true,away=false,minorAt=-1e9;
  const slow=new Uint8Array(60),starts=new Uint16Array(50);
  try{paused=view.localStorage.getItem('36t-motion-paused')==='true';}catch{}
  const still=()=>reduced||paused||frozen||html?.dataset?.motion==='off',live=()=>scene==='login'||scene==='home',shutTo=()=>closed&&(pending===0||scene==='login')?1:0;
  const flying=time=>time<T0+hold+span*1.43,flight=(time,o)=>(time-T0-hold-D[o+8]*span/1400)/span;
  const paint=()=>{try{const s=view.getComputedStyle(html);tones=TOKENS.map(n=>s.getPropertyValue(n).trim()||'currentColor');}catch{tones=TOKENS.map(()=>'currentColor');}};
  const mark=(o,w,x=D[o],y=D[o+1])=>{
    const h=w/ASPECT,s=D[o+7]&MIRROR?-1:1,pts=w<5?HALF:COMMA,sx=w<5?h:w,ox=w<5?.431:.5;
    for(let n=0;n<pts.length;n+=2){const qx=x+s*(pts[n]-ox)*sx,qy=y+(pts[n+1]-.5)*h;n?ctx.lineTo(qx,qy):ctx.moveTo(qx,qy);}
    ctx.closePath();
  };
  // Ink law and breathing; on the login scene the whole figure (arc and gap) turns 1 degree per second over fixed marks. Then a counting sort into (colour x bucket) batches.
  const sort=time=>{
    const calm=still()||!live(),rot=scene==='login'&&!calm?time/3e5%1.2:0;starts.fill(0);
    for(let n=0,o=0;o<L;n++,o+=10){
      const f=D[o+7];let t=D[o+4],c=D[o+6];if(rot&&!(f&DRIFTER)&&(t=(D[o+8]/500-rot+1.2)%1.2)>1)t=-1;
      let k=f&DRIFTER?.3:t<0?.15*shut:ink(t,scene==='home'?p:0);
      if(!calm)k*=1+.1*Math.sin(time/7e3*TAU+D[o+9]);
      D[o+5]=k*=(f>>8&255)/255;if(c===3&&late)c=4;
      const key=keys[n]=k<.03?255:f&MOON&&(f>>16)<pending?254:f&DRIFTER||D[o]!==D[o+2]||D[o+1]!==D[o+3]?253:c*8+Math.max(0,Math.min(7,Math.round(k*8)-1));
      if(key<48)starts[key+2]++;
    }
    for(let k=2;k<50;k++)starts[k]+=starts[k-1];
    for(let n=0;n*10<L;n++)if(keys[n]<48)order[starts[keys[n]+1]++]=n;
  };
  // Settled marks: one path and one fill per batch. Marks in flight, pushed by the pointer, or drifting are outlined: the ink is still wet.
  const draw=time=>{
    const base=pitch*.6,air=flying(time),u=(time-ghostAt)/900;ctx.clearRect(0,0,W,H);
    for(let key=0;key<48;key++)if(starts[key+1]>starts[key]){
      const k=((key&7)+1)/8;ctx.globalAlpha=k*dimNow;ctx.fillStyle=tones[key>>3];ctx.beginPath();
      for(let q=starts[key];q<starts[key+1];q++)mark(order[q]*10,base*(.45+.55*k));
      ctx.fill();
    }
    ctx.lineWidth=1;ctx.globalAlpha=.7*dimNow;
    for(let c=0;c<4;c++){
      ctx.beginPath();
      for(let n=0,o=0;o<L;n++,o+=10)if(keys[n]===253&&D[o+6]===c){
        const e=D[o+7]&DRIFTER?0:air?1-(1-unit(flight(time,o)))**3:0,sway=D[o+7]&DRIFTER?Math.sin(time*15e-5+D[o+9])*2*pitch:0;
        mark(o,base*(.45+.55*Math.max(.3,D[o+5])),D[o]+(D[o+2]-D[o])*e+sway,D[o+1]+(D[o+3]-D[o+1])*e);
      }
      ctx.strokeStyle=tones[c===3&&late?4:c];ctx.stroke();
    }
    ctx.globalAlpha=dimNow;ctx.fillStyle=tones[late?4:5];ctx.beginPath();
    for(let n=0;n*10<L;n++)if(keys[n]===254)mark(n*10,base*1.6);
    ctx.fill();
    if(u<1&&ghost<L)for(let g=1;g<7;g++){ctx.globalAlpha=(1-u)*(1-g/7)*dimNow;ctx.strokeStyle=tones[0];ctx.beginPath();mark(ghost,base*(1.6+u*g*.9),D[ghost+2],D[ghost+3]);ctx.stroke();}
    ctx.globalAlpha=1;lastDraw=time;
  };
  const halt=()=>{if(raf)view.cancelAnimationFrame?.(raf);raf=0;};
  // The static frame: the ring settled on its lattice, reflecting the data; a 60 s timer (no rAF) keeps progress from going stale.
  const fixed=()=>{
    halt();never(timer);timer=0;if(!P)return;
    for(let o=0;o<L;o+=10){D[o]=D[o+2];D[o+1]=D[o+3];}
    T0=-1e9;p=goal;shut=shutTo();dimNow=dimTo;sort(clock());draw(clock());if(live())timer=later(fixed,6e4);
  };
  const tick=time=>{
    raf=0;if(!P||doc?.hidden||away||still())return;
    const phone=W<760,dt=time-lastTick,late_=dt>(phone?40:20)?1:0,step=Math.min(dt,100),quiet=time-idle,air=flying(time),near=time-moved<2500;lastTick=time;
    // Governor, measured on the rAF interval: drifters go first, then 35% of the marks (edge first), then a static frame for the session.
    if(dt<1e3){sum+=late_-slow[slot];slow[slot]=late_;slot=(slot+1)%60;if(sum>=30){slow.fill(0);sum=0;if(++level>2)frozen=true;return build(false);}}
    const busy=air||near||dimNow!==dimTo||p!==goal||shut!==shutTo();
    if(!busy&&quiet>(phone?12e3:6e4))return;
    p=toward(p,goal,step/700);dimNow=toward(dimNow,dimTo,step/200);
    if(shut!==shutTo()&&(shut=toward(shut,shutTo(),step/700))===1)pulse();
    if(busy||time-lastDraw>=(quiet>2e4?80:30)){
      if(air||near)for(let o=0;o<L;o+=10){
        let tx=D[o+2],ty=D[o+3];const dx=tx-mx,dy=ty-my,d=Math.hypot(dx,dy);
        if(air){if(flight(time,o)>=1){D[o]=tx;D[o+1]=ty;}continue;}
        if(time-moved<1500&&d<120&&d>0){tx+=dx*(1-d/120)*14/d;ty+=dy*(1-d/120)*14/d;}
        D[o]+=(tx-D[o])*.2;D[o+1]+=(ty-D[o+1])*.2;
        if(tx===D[o+2]&&ty===D[o+3]&&Math.abs(D[o]-tx)+Math.abs(D[o+1]-ty)<.3){D[o]=tx;D[o+1]=ty;}
      }
      const fresh=busy||frames++%30===0;if(fresh)sort(time);
      if(fresh||drift||time-ghostAt<1e3)draw(time);
    }
    raf=view.requestAnimationFrame(tick);
  };
  const kick=(wake=true)=>{
    if(!P)return;paint();if(scene==='index'||still()||doc?.hidden||!view.requestAnimationFrame)return fixed();
    never(timer);timer=0;lastDraw=frames=0;lastTick=clock();if(wake)idle=lastTick;if(!raf&&!away)raf=view.requestAnimationFrame(tick);
  };
  const move=event=>{mx=event.pageX??event.clientX;my=event.pageY??event.clientY;moved=idle=clock();if(!raf)kick();};
  const track=on=>{on=on&&scene==='login'&&W>=1024&&!still();if(on!==tracking)view[(tracking=on)?'addEventListener':'removeEventListener']?.('pointermove',move,{passive:true});if(!on)moved=-1e9;};
  function build(morph){
    const old=P,before=clock(),air=old?.count>0&&flying(before),t0=T0,{cx,cy,R,mirror=false}=geo;P=null;L=0;T0=-1e9;halt();never(timer);never(wait);timer=wait=0;
    if(scene==='off'||!W||!H||!(R>0)){track(false);if(scene==='off'&&canvas.width)canvas.width=canvas.height=0;return;}
    const dpr=Math.min(view.devicePixelRatio||1,W<1024?1.5:2),bw=Math.round(W*dpr),bh=Math.round(H*dpr);
    if(canvas.width!==bw||canvas.height!==bh){canvas.width=bw;canvas.height=bh;}
    ctx.setTransform(dpr,0,0,dpr,0,0);drift=scene==='login'&&!level;
    P=scene==='index'?commaField({x:cx-R*ASPECT,y:cy-R,w:2*R*ASPECT,h:2*R,pitch:pitch=12,mirror,exclude:rects})
      :ringField({width:W,height:H,cx,cy,R,pitch:pitch=scene==='login'?(W<1024?8.5:11):W<760?5:7,mirror,exclude:rects,drifters:drift?(W<1024?12:40):0});
    D=P.data;let N=P.count;
    if(level>1){let kept=0;for(let o=0;o<N*10;o+=10)if(!(D[o+7]&EDGE)&&D[o+9]>=TAU*.2)D.copyWithin(kept++*10,o,o+10);N=kept;}
    L=N*10;keys=new Uint8Array(N);order=new Uint16Array(N);morph=morph&&old?.count>0;let intro=false;
    if(N&&live()&&!still()){
      // The opening, once per session: 300 ms held on a Form A block, then 1,400 ms of flight. A scene change re-forms the same marks in 700 ms.
      // A rebuild in mid-flight (new exclusions, a resize) keeps the running clock, so the opening is never cut short.
      if(scene==='login'&&!morph){if(air)intro=opening;else try{intro=!view.sessionStorage.getItem('36t-ring-intro');view.sessionStorage.setItem('36t-ring-intro','1');}catch{}}
      const cols=Math.ceil(Math.sqrt(N*RATIO)),rows=Math.ceil(N/cols),S=intro?commaField({x:cx-cols*pitch/2,y:cy-rows*pitch*RATIO/2,w:cols*pitch+.01,h:rows*pitch*RATIO+.01,pitch,mask:false,exclude:rects}):old;
      if(S?.count&&(intro||morph||air)){
        for(let n=0;n<N;n++){const o=(intro?n%S.count:Math.floor(n*S.count/N))*10;D[n*10]=S.data[o];D[n*10+1]=S.data[o+1];}
        if(morph||!air){T0=before;hold=intro?300:0;span=intro?1400:700;}else T0=t0;
      }
    }
    opening=intro;track(true);kick();
  }
  const size=(w,h)=>{if(w===W&&h===H)return;const first=stale||!W||!P||flying(clock());stale=false;W=w;H=h;never(wait);wait=0;if(scene!=='off')first?build(false):wait=later(()=>build(false),120);};
  function pulse(){if(!P||still()||!live())return;let best=2;for(let o=0;o<L;o+=10){const d=Math.abs(D[o+4]-p);if(D[o+4]>=0&&d<best){best=d;ghost=o;}}ghostAt=clock();kick();}
  const refresh=()=>{track(true);kick();},seen=()=>kick();
  const resizer=view.ResizeObserver?new view.ResizeObserver(list=>{const box=list[list.length-1]?.contentRect;if(box)size(Math.round(box.width),Math.round(box.height));}):null;
  const watcher=view.MutationObserver&&html?new view.MutationObserver(refresh):null;
  // The hero strip scrolling out of view stops the loop; coming back restarts it. Nothing is measured.
  const eye=view.IntersectionObserver?new view.IntersectionObserver(list=>{away=!list[list.length-1]?.isIntersecting;away?halt():kick();}):null;
  resizer?.observe(canvas);eye?.observe(canvas);watcher?.observe(html,{attributes:true,attributeFilter:['data-theme','data-design','data-motion']});doc?.addEventListener?.('visibilitychange',seen);
  return {
    setScene(name,box){const next=['login','home','index'].includes(name)?name:'off',morph=next!==scene&&live();if(scene==='off')stale=true;scene=next;geo=box||{};build(morph);},
    setData({pending:count=null,late:isLate=false,progress=0,closed:isClosed=false}={}){
      const n=count==null?null:Math.min(12,Math.max(0,Math.floor(+count)||0)),g=unit(progress);
      if(n===pending&&!!isLate===late&&g===goal&&!!isClosed===closed)return;
      // The clock moves progress a hair every minute: that is drawn, but it does not restart the idle ladder (nor does the resume() F sends with it).
      const minor=n===pending&&!!isLate===late&&!!isClosed===closed&&Math.abs(g-goal)<.01;if(minor)minorAt=clock();
      pending=n;late=!!isLate;goal=g;closed=!!isClosed;kick(!minor);
    },
    setExclusions(list){rects=(Array.isArray(list)?list:[]).filter(r=>r&&r.w>0&&r.h>0);if(scene!=='off')build(false);},
    dim(to=1){dimTo=unit(to);kick();},
    pulse,
    pause(){paused=true;track(false);fixed();},
    resume(){const was=paused;paused=false;if(was||clock()-minorAt>4)refresh();},
    destroy(){scene='off';halt();never(timer);never(wait);track(false);resizer?.disconnect();eye?.disconnect();watcher?.disconnect();doc?.removeEventListener?.('visibilitychange',seen);P=null;L=0;canvas.width=canvas.height=0;}
  };
}
