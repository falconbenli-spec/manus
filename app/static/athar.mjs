// Adapted from the supplied ATHAR-20260909-01 canvas, with teardown for this router.
export function mountScenes(container) {
  const cleanups=[];
  for(const host of container.querySelectorAll('[data-athar-scene]')) {
    const canvas=host.querySelector('canvas'),ctx=canvas.getContext('2d'),button=host.querySelector('button');
    if(!ctx)continue;
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    let paused=localStorage.getItem('36t-motion-paused')==='true',frame=0,last=0,w=0,h=0,x=0,y=0,tx=0,ty=0,visible=true;
    const draw=()=>{
      ctx.clearRect(0,0,w,h);const size=Math.min(w,h),cx=w*.5+x,cy=h*.48+y;
      ctx.lineWidth=Math.max(.8,size/520);
      for(let i=0;i<17;i++){const t=i/16,r=size*(.15+t*.33);ctx.beginPath();ctx.ellipse(cx,cy,r*1.16,r*.64,-.55+t*.26,0,Math.PI*2);ctx.strokeStyle=`rgba(232,255,244,${.18+t*.2})`;ctx.stroke();}
      [[-.42,.18],[.42,-.2],[.02,-.34]].forEach(([dx,dy],i)=>{ctx.beginPath();ctx.arc(cx+dx*size,cy+dy*size,6-i,0,Math.PI*2);ctx.fillStyle=i===1?'#dcf6aa':'#eafff5';ctx.fill();});
    };
    const stop=()=>{cancelAnimationFrame(frame);frame=0;};
    const canAnimate=()=>!paused&&!media.matches&&visible&&!document.hidden;
    const tick=time=>{frame=0;const dt=Math.min((time-(last||time))/1000,.05);last=time;const a=1-Math.exp(-11*dt);x+=(tx-x)*a;y+=(ty-y)*a;draw();if(Math.abs(tx-x)+Math.abs(ty-y)>.06&&canAnimate())frame=requestAnimationFrame(tick);};
    const wake=()=>{if(!frame&&canAnimate()){last=0;frame=requestAnimationFrame(tick);}};
    const resize=()=>{const box=host.getBoundingClientRect();w=box.width;h=box.height;const dpr=Math.min(devicePixelRatio||1,1.75);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw();};
    const move=ev=>{if(!canAnimate()||ev.pointerType==='touch'||!w||!h)return;const b=host.getBoundingClientRect();tx=((ev.clientX-b.left)/w-.5)*26;ty=((ev.clientY-b.top)/h-.5)*20;wake();};
    const leave=()=>{tx=ty=0;wake();};
    const visibility=()=>{if(document.hidden)stop();else wake();};
    const update=()=>{stop();x=y=tx=ty=0;draw();if(button){button.setAttribute('aria-pressed',String(paused));button.textContent=document.documentElement.lang==='ar'?(paused?'تشغيل الحركة':'إيقاف الحركة'):(paused?'Enable motion':'Pause motion');}};
    const toggle=()=>{paused=!paused;localStorage.setItem('36t-motion-paused',String(paused));update();};
    const resizeObserver=new ResizeObserver(resize),observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(!visible)stop();else wake();});
    resizeObserver.observe(host);observer.observe(host);host.addEventListener('pointermove',move);host.addEventListener('pointerleave',leave);
    document.addEventListener('visibilitychange',visibility);media.addEventListener('change',update);button?.addEventListener('click',toggle);resize();update();
    cleanups.push(()=>{stop();resizeObserver.disconnect();observer.disconnect();host.removeEventListener('pointermove',move);host.removeEventListener('pointerleave',leave);document.removeEventListener('visibilitychange',visibility);media.removeEventListener('change',update);button?.removeEventListener('click',toggle);});
  }
  return ()=>cleanups.forEach(fn=>fn());
}
