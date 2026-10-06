// التفاعل على مستوى المنصة — the depth design's micro-interactions, and the platform's signals to the brain.
// Active ONLY while the computed --scene-3d token is 1 (the design that declares the 3D scene); a no-op in every other design, and fully
// off under prefers-reduced-motion or html[data-motion=off]. While active it sets html[data-ix]; depth.css draws every effect from that
// attribute and from CSS custom properties set here through the CSSOM (no style attribute written as text, no DOM injected).
//   · a soft light spot follows the mouse over rows, cards and tiles (--mx/--my on the element under the pointer)
//   · the filled pill leans a few pixels toward the cursor (--ix-tx/--ix-ty); press feedback is CSS (:active)
//   · big figures that scroll into view count up in a visual overlay (::after with alt text ""), so the DOM text is always the true number
//   · list rows rise in a short stagger after a route change (a CSS animation that ends at the natural state; nothing waits on an observer)
//   · touch devices get a tap ripple instead of hover
//   · the brain hears the platform: route change → pulse, a successful save → a spark burst at the button, an error → a brief dim,
//     through window.dispatchEvent(new CustomEvent('36t:brain',{detail:{kind,x,y}})) — no design name, no engine import.
// Passive listeners, at most one rAF per frame, layout read before any write, rect caches dropped on scroll and resize.
// app.mjs is not edited: success and errors are read from #toast and the inline error slots it already renders.

export const SPOT=':is(tbody tr,.vn-card,.wk-card,.ex-row,.vn-tile,.notification-row,.task-row,.pt-tile,.pt-row,.department-card,.rq-row,.rq-rail-item,.timeline-item,.service-row,.req-card,.project-card,.rq-card)';
// the single filled action (style.css @layer fill), as one selector
export const PILL=':is(.page-actions .btn.primary,.journey-cta .btn.primary,[data-operation="punch_in"],[data-operation="punch_out"],[data-transition=approve],.form-actions .btn:is(.dark,.primary)[type=submit],.login-card .btn.dark,.password-form .btn.primary):not(:disabled,[aria-disabled=true])';
export const FIGURES='.vn-tile strong,.stat-number,.pt-tile strong,.ex-figure strong,.ex-step strong,.acc-stats strong,.hr-focus strong,.figure b';
export const ROWS='#main :is(tbody tr,.notification-row,.task-row,.ex-row,.pt-row,.rq-row,.service-row,.timeline-item,.rq-rail-item,.wk-card,.vn-card)';
export const STAGGER=14,ROW_STEP=28;
const SPOT_IN='#main '+SPOT,RIPPLE=SPOT_IN+',.btn,.sig-tabs a,.sig-siblings a,.nav a';
const OK_TOAST=/^(تم\s|Saved\b|Password changed|Previous operation saved)/i;

// ---- pure helpers (tested under Node)
// A figure is a plain number with an optional prefix/suffix ("SAR 12,400", "87%", "3.5"). Anything else is left alone.
export function parseFigure(text){
  const m=/^(\D*?)(\d[\d,]*(?:\.\d+)?)(\D*)$/.exec(String(text??'').trim());if(!m)return null;
  const [,pre,num,post]=m,n=Number(num.replace(/,/g,''));if(!Number.isFinite(n)||n===0)return null;
  return {pre,post,n,dec:(num.split('.')[1]||'').length,group:num.includes(',')};
}
export function formatFigure(f,v){return f.pre+(f.group?v.toLocaleString('en-US',{minimumFractionDigits:f.dec,maximumFractionDigits:f.dec}):v.toFixed(f.dec))+f.post;}
export const classifyToast=text=>OK_TOAST.test(String(text??'').trim())?'spark':'dim';

export function mountInteract(win=globalThis){
  const doc=win.document,root=doc?.documentElement;
  if(!doc||!root)return {active:()=>false,sync(){},destroy(){}};
  const on=(t,type,fn,opt)=>{t.addEventListener(type,fn,opt);offs.push(()=>t.removeEventListener(type,fn,opt));};
  const offs=[],observers=[];
  let active=false,reduce=null;
  try{reduce=win.matchMedia?.('(prefers-reduced-motion: reduce)')||null;}catch{}
  const computeActive=()=>{
    let scene3d=false;try{scene3d=win.getComputedStyle(root).getPropertyValue('--scene-3d').trim()==='1';}catch{}
    return scene3d&&!reduce?.matches&&root.dataset?.motion!=='off';
  };
  function sync(){
    const next=computeActive();if(next===active)return;active=next;
    if(active)root.setAttribute('data-ix','');else{root.removeAttribute('data-ix');clearLit();clearMagnet();}
  }
  const brain=(kind,x,y)=>{if(!active)return;try{win.dispatchEvent(new win.CustomEvent('36t:brain',{detail:{kind,...(Number.isFinite(x)&&Number.isFinite(y)?{x,y}:{})}}));}catch{}};
  const raf=fn=>win.requestAnimationFrame?win.requestAnimationFrame(fn):setTimeout(()=>fn(Date.now()),16);
  const now=()=>win.performance?.now?.()??Date.now();
  const el=t=>t&&typeof t.closest==='function'?t:null;

  // ---- pointer: the light spot and the magnetic pill (mouse only), rAF-throttled; reads before writes
  let lastMove=null,frame=0,lit=null,litRect=null,magnet=null,magnetRect=null;
  function clearLit(){lit=null;litRect=null;}
  function clearMagnet(){if(magnet){magnet.style.removeProperty('--ix-tx');magnet.style.removeProperty('--ix-ty');}magnet=null;magnetRect=null;}
  function onFrame(){
    frame=0;const e=lastMove;lastMove=null;if(!e||!active)return;
    const t=el(e.target),spot=t?.closest(SPOT_IN)||null,pill=t?.closest(PILL)||null;
    if(spot!==lit){lit=spot;litRect=spot?spot.getBoundingClientRect():null;}
    if(pill!==magnet){clearMagnet();magnet=pill;magnetRect=pill?pill.getBoundingClientRect():null;}   // the rect is cached before the pill moves
    if(lit&&litRect){lit.style.setProperty('--mx',Math.round(e.clientX-litRect.left)+'px');lit.style.setProperty('--my',Math.round(e.clientY-litRect.top)+'px');}
    if(magnet&&magnetRect){
      const dx=Math.max(-1,Math.min(1,(e.clientX-(magnetRect.left+magnetRect.width/2))/(magnetRect.width/2||1)));
      const dy=Math.max(-1,Math.min(1,(e.clientY-(magnetRect.top+magnetRect.height/2))/(magnetRect.height/2||1)));
      magnet.style.setProperty('--ix-tx',(dx*6).toFixed(1)+'px');magnet.style.setProperty('--ix-ty',(dy*3).toFixed(1)+'px');
    }
  }
  on(doc,'pointermove',e=>{if(!active||e.pointerType!=='mouse')return;lastMove=e;if(!frame)frame=raf(onFrame);},{passive:true});
  const dropRects=()=>{clearLit();clearMagnet();};
  on(win,'scroll',dropRects,{passive:true,capture:true});
  on(win,'resize',dropRects,{passive:true});

  // ---- touch: a ripple from the tap point (two alternating animation names restart it without a reflow)
  on(doc,'pointerdown',e=>{
    if(!active||e.pointerType==='mouse')return;
    const target=el(e.target)?.closest(RIPPLE);if(!target)return;
    const r=target.getBoundingClientRect();
    target.style.setProperty('--mx',Math.round(e.clientX-r.left)+'px');target.style.setProperty('--my',Math.round(e.clientY-r.top)+'px');
    target.setAttribute('data-ix-ripple',target.getAttribute('data-ix-ripple')==='a'?'b':'a');
  },{passive:true});

  // ---- figures: count up in a visual overlay when they first scroll into view (figures visible at render are signature.mjs's)
  const seenFig=new WeakSet(),firstSeen=new WeakSet();
  const figs=win.IntersectionObserver?new win.IntersectionObserver(list=>{
    for(const entry of list){
      const f=entry.target,first=!firstSeen.has(f);firstSeen.add(f);
      if(first&&entry.isIntersecting){figs.unobserve(f);continue;}   // already on screen when rendered
      if(!entry.isIntersecting)continue;
      figs.unobserve(f);countUp(f);
    }
  },{threshold:.6}):null;
  if(figs)observers.push(figs);
  function countUp(target){
    if(!active||root.dataset?.tier==='ledger'||target.hasAttribute('data-sig-counting'))return;
    const text=target.textContent.trim(),f=parseFigure(text);if(!f)return;
    target.style.setProperty('--ix-ink',win.getComputedStyle(target).color);
    target.setAttribute('data-ix-shown',formatFigure(f,0));target.setAttribute('data-ix-count','');
    const start=now(),dur=Math.min(900,420+Math.log10(Math.abs(f.n)+1)*120),scale=10**f.dec;
    const finish=()=>{target.removeAttribute('data-ix-count');target.removeAttribute('data-ix-shown');target.style.removeProperty('--ix-ink');};
    const step=t=>{
      if(!target.isConnected)return;
      if(target.textContent.trim()!==text||!active){finish();return;}   // the value changed under us: show the truth
      const k=Math.min(1,(t-start)/dur),e=1-Math.pow(1-k,3);
      target.setAttribute('data-ix-shown',formatFigure(f,k<1?Math.round(f.n*e*scale)/scale:f.n));
      if(k<1)raf(step);else finish();
    };
    raf(step);
  }
  function watchFigures(scope){if(!figs||!active)return;for(const f of scope.querySelectorAll(FIGURES)){if(seenFig.has(f))continue;seenFig.add(f);figs.observe(f);}}

  // ---- rows: a short staggered rise after a route change, applied in the same microtask as the DOM insertion (no flash)
  let revealAt=now(),revealTimer=0;
  function reveal(){
    if(!revealAt)return;
    if(now()-revealAt>2500){revealAt=0;return;}
    const rows=[...doc.querySelectorAll(ROWS)].slice(0,STAGGER);if(!rows.length)return;
    revealAt=0;clearTimeout(revealTimer);
    rows.forEach((row,i)=>row.style.setProperty('--ix-i',String(i)));
    root.setAttribute('data-ix-enter','');
    revealTimer=setTimeout(()=>{root.removeAttribute('data-ix-enter');for(const row of rows)row.style.removeProperty('--ix-i');},STAGGER*ROW_STEP+520);
  }

  // ---- the brain's signals
  let submitted=null;
  on(doc,'submit',e=>{
    const form=e.target;if(!form?.id||form.tagName!=='FORM')return;
    let x,y;const b=e.submitter||form.querySelector?.('[type=submit]');
    if(b){const r=b.getBoundingClientRect();if(r.width){x=Math.round(r.left+r.width/2);y=Math.round(r.top+r.height/2);}}
    submitted={id:form.id,at:now(),x,y};
  },{capture:true,passive:true});
  const recent=()=>submitted&&now()-submitted.at<10000?submitted:null;
  on(win,'hashchange',()=>{revealAt=now();clearLit();clearMagnet();brain('pulse');});
  // #toast: "تم …/Saved" is a success (a spark burst where the button was); any other toast is an error (a brief dim)
  const toast=doc.querySelector('#toast');
  if(toast&&win.MutationObserver){let shown=false,lastText='';const mo=new win.MutationObserver(()=>{
    const showing=toast.classList.contains('show'),text=toast.textContent.trim();
    if(showing&&text&&(!shown||text!==lastText)){
      if(classifyToast(text)==='spark'){const s=recent();brain('spark',s?.x,s?.y);submitted=null;}else brain('dim');
    }
    shown=showing;lastText=text;
  });mo.observe(toast,{attributes:true,attributeFilter:['class'],childList:true,characterData:true,subtree:true});observers.push(mo);}
  // inline form errors (dialog and login) are errors too
  const isError=n=>n?.nodeType===1&&(n.matches?.('.error')||n.querySelector?.('.error'))&&n.closest?.('#dialog-error,#login-error');
  const dialog=doc.querySelector('#dialog');
  if(dialog&&win.MutationObserver){const mo=new win.MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(isError)))brain('dim');});mo.observe(dialog,{childList:true,subtree:true});observers.push(mo);}

  // ---- one observer on #app for everything that follows a render
  const app=doc.querySelector('#app');
  if(app&&win.MutationObserver){const mo=new win.MutationObserver(records=>{
    sync();if(!active)return;
    reveal();watchFigures(app);
    if(records.some(r=>[...r.addedNodes].some(isError)))brain('dim');
    const s=recent();if(s?.id==='login-form'&&!app.querySelector(':scope > .login')){submitted=null;brain('spark');}   // signed in
  });mo.observe(app,{childList:true,subtree:true});observers.push(mo);}

  // ---- the switch: design, theme or motion changes, the reduced-motion preference, a late stylesheet
  if(win.MutationObserver){const mo=new win.MutationObserver(sync);mo.observe(root,{attributes:true,attributeFilter:['data-design','data-theme','data-motion']});observers.push(mo);}
  try{reduce?.addEventListener?.('change',sync);offs.push(()=>reduce.removeEventListener?.('change',sync));}catch{}
  on(win,'load',sync,{once:true});
  sync();if(active&&app)watchFigures(app);

  return {active:()=>active,sync,destroy(){for(const off of offs)off();for(const o of observers)o.disconnect();clearTimeout(revealTimer);root.removeAttribute('data-ix');root.removeAttribute('data-ix-enter');}};
}

if(typeof document!=='undefined'&&typeof window!=='undefined')mountInteract(window);
