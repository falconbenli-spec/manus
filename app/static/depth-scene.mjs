// «الدماغ» in depth — the constellation hero of the depth design (owner's pick, 19 Sep: Direction A's brain, made stronger and interactive).
// A WebGL2 (WebGL1 fallback) field of 3,6T commas. Each mark is ONE point sprite whose fragment shader measures the exact distance to the
// brand quad: an outlined, anti-aliased comma with a ~1 device-px core, rendered at native DPR (3 on phones, 2 on desktop) under an
// adaptive governor. Marks render additively into a half-float HDR target, then a real bloom chain (1/2 → 1/4 → 1/8 Gaussian), depth of
// field (a per-mark circle of confusion), depth grading and fog, and a key light on each mark's true surface normal.
// Forms: the BRAIN (login, home, «ملخصي»), the GLOBE (index), the GALAXY (work screens, as a very dim slow dust; and every morph passes
// through it). The brain is a procedural signed distance field: six sculpted parts (frontal, parietal, temporal, occipital, cerebellum,
// brainstem), a medial cut that leaves a deep longitudinal fissure, a carved lateral sulcus, and gyri/sulci from the nodal lines of a
// random-wave field (fixed wavenumber: the labyrinth of a Turing pattern). Marks are sampled by rejection from the SDF shell, projected
// onto the surface with Newton steps, displaced by the fold height and oriented by the displaced surface's normal.
// Interactive («عصبي»): pointer/touch parallax and local repulsion; hover/drag lights nearby marks and sends synapse sparks along the
// folds; a tap or click sends a neural pulse wave; device tilt. spark(x,y) and pulse() are in the API, and the engine listens to
// window '36t:brain' CustomEvents ({kind:'spark'|'pulse'|'dim',x?,y?}) so the UI reacts to platform events without naming a design.
// Palette from the brand tokens only: deep teal → turquoise → mint glow → sky → paper. No yellow, violet or occasion colour.
// Zero dependencies. Shaders are string literals (CSP script-src 'self'); no blobs, workers or fetches. Nothing touches document/window
// at module level: the pure builders are imported and tested under Node.
//
// Brand rules kept: the comma is the brand quad COMMA in its 1.373:1 box (DESIGN-SPEC §4.1). It only yaws and pitches (foreshortening),
// never rolls in-plane: its horizontal edges stay horizontal on screen. Under ~5 CSS px wide it is the half comma (triangle).

const TAU=Math.PI*2,DEG=Math.PI/180,ASPECT=1.373;
export const COMMA=Object.freeze([[.372,0],[1,0],[.539,1],[0,1]]);      // brand quad, y down (spec §4.1)
export const HALF_COMMA=Object.freeze([[0,0],[.862,0],[.229,1]]);       // under 5 CSS px wide
export const FORMS=Object.freeze(['brain','globe','galaxy']);
// Colour slots: 0 abyss (deep teal) · 1 turquoise-deep · 2 turquoise · 3 mint glow · 4 sky · 5 paper
export const PALETTE=Object.freeze(['abyss','turquoise-deep','turquoise','mint','sky','paper']);
const FALLBACK=[22/255,160/255,133/255];                                  // #16A085, only when --brand-turquoise is unreadable
const hash=(i,j)=>{let n=Math.imul(i|0,374761393)^Math.imul(j|0,668265263);n=Math.imul(n^n>>>13,1274126177);return ((n^n>>>16)>>>0)/4294967296;};
const clamp01=v=>Math.min(1,Math.max(0,+v||0));
const toward=(a,b,d)=>a+Math.sign(b-a)*Math.min(Math.abs(b-a),d);
const ease=u=>u<.5?4*u*u*u:1-(-2*u+2)**3/2;
const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};

// ---------------------------------------------------------------- colour
export function parseColor(value){
  const s=String(value??'').trim().toLowerCase();if(!s)return null;
  if(s==='white')return [1,1,1];if(s==='black')return [0,0,0];
  let m=s.match(/^#([0-9a-f]+)$/);
  if(m){const h=m[1];
    if(h.length===3||h.length===4)return [0,1,2].map(i=>parseInt(h[i]+h[i],16)/255);
    if(h.length===6||h.length===8)return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255);
    return null;}
  const part=(list,scale)=>{const p=list.split(/[\s,/]+/).filter(Boolean).slice(0,3);if(p.length<3)return null;
    const v=p.map(x=>x.endsWith('%')?parseFloat(x)/100:parseFloat(x)/scale);return v.every(Number.isFinite)?v.map(clamp01):null;};
  if((m=s.match(/^rgba?\(([^)]*)\)$/)))return part(m[1],255);
  if((m=s.match(/^color\(\s*srgb\s+([^)]*)\)$/)))return part(m[1],1);
  return null;
}
// The company profile's «قاعة الضوء», derived from the tokens: abyss = the deep turquoise toward black; mint = a bright tint of the
// turquoise's own hue. Nothing else is read, so no yellow, violet or occasion colour can reach the scene.
export function derivePalette({turquoise,deep,sky,paper}={}){
  const t=turquoise||FALLBACK,d=deep||t.map(v=>v*.8),s=sky||[.87,.9,.93],w=paper||[1,1,1];
  const abyss=d.map(v=>v*.36);
  const mint=[t[0]+(1-t[0])*.42,t[1]+(1-t[1])*.86,t[2]+(1-t[2])*.66];
  return [abyss,d,t,mint,s,w];
}

// ---------------------------------------------------------------- math
export const mat4={
  create:()=>new Float32Array(16),
  perspective(out,fovy,aspect,near,far){const f=1/Math.tan(fovy/2),nf=1/(near-far);out.fill(0);out[0]=f/aspect;out[5]=f;out[10]=(far+near)*nf;out[11]=-1;out[14]=2*far*near*nf;return out;},
  lookAt(out,eye,center,up){
    let zx=eye[0]-center[0],zy=eye[1]-center[1],zz=eye[2]-center[2],l=Math.hypot(zx,zy,zz)||1;zx/=l;zy/=l;zz/=l;
    let xx=up[1]*zz-up[2]*zy,xy=up[2]*zx-up[0]*zz,xz=up[0]*zy-up[1]*zx;l=Math.hypot(xx,xy,xz)||1;xx/=l;xy/=l;xz/=l;
    const yx=zy*xz-zz*xy,yy=zz*xx-zx*xz,yz=zx*xy-zy*xx;
    out[0]=xx;out[1]=yx;out[2]=zx;out[3]=0;out[4]=xy;out[5]=yy;out[6]=zy;out[7]=0;out[8]=xz;out[9]=yz;out[10]=zz;out[11]=0;
    out[12]=-(xx*eye[0]+xy*eye[1]+xz*eye[2]);out[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2]);out[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);out[15]=1;return out;
  }
};
// mat3, column-major
const m3={
  id:()=>[1,0,0,0,1,0,0,0,1],
  mul(a,b){const r=new Array(9);for(let c=0;c<3;c++)for(let row=0;row<3;row++){let v=0;for(let k=0;k<3;k++)v+=a[k*3+row]*b[c*3+k];r[c*3+row]=v;}return r;},
  axis(ax,ang){const l=Math.hypot(...ax)||1,x=ax[0]/l,y=ax[1]/l,z=ax[2]/l,c=Math.cos(ang),s=Math.sin(ang),t=1-c;
    return [t*x*x+c,t*x*y+s*z,t*x*z-s*y, t*x*y-s*z,t*y*y+c,t*y*z+s*x, t*x*z+s*y,t*y*z-s*x,t*z*z+c];},
  ry:a=>m3.axis([0,1,0],a),rx:a=>m3.axis([1,0,0],a)
};

// ---------------------------------------------------------------- noise
const lattice=(x,y,z,s)=>hash(Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791),s);
function vnoise(x,y,z,s){
  const X=Math.floor(x),Y=Math.floor(y),Z=Math.floor(z),fx=x-X,fy=y-Y,fz=z-Z;
  const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),w=fz*fz*(3-2*fz),L=(i,j,k)=>lattice(X+i,Y+j,Z+k,s);
  const a=L(0,0,0)+(L(1,0,0)-L(0,0,0))*u,b=L(0,1,0)+(L(1,1,0)-L(0,1,0))*u,c=L(0,0,1)+(L(1,0,1)-L(0,0,1))*u,d=L(0,1,1)+(L(1,1,1)-L(0,1,1))*u;
  const e=a+(b-a)*v,f=c+(d-c)*v;return e+(f-e)*w;
}
export function fbm(x,y,z,seed=0,oct=4){let a=.5,f=1,sum=0,norm=0;for(let i=0;i<oct;i++){sum+=a*vnoise(x*f,y*f,z*f,seed+i*101);norm+=a;a*=.5;f*=2.03;}return sum/norm;}
const fibDir=(i,n,jit=0)=>{const y=1-2*(i+.5)/n,r=Math.sqrt(Math.max(0,1-y*y)),a=i*2.399963229728653+jit;return [r*Math.cos(a),y,r*Math.sin(a)];};
const randDir=(u,v)=>{const y=u*2-1,r=Math.sqrt(1-y*y),a=v*TAU;return [r*Math.cos(a),y,r*Math.sin(a)];};
const norm3=v=>{const l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])||1;return [v[0]/l,v[1]/l,v[2]/l];};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

// ---------------------------------------------------------------- the brain: a procedural signed distance field
// Model space: x lateral (the hemispheres mirror across x=0), y up, z front (frontal pole +z, occipital pole −z). About 2.1 long,
// 1.55 wide and 1.2 tall without the stem: the proportions of a real cerebrum (width ≈ .74 × length, height ≈ .57 × length).
// Ellipsoid distance is Inigo Quilez's first-order bound; smin/smax are polynomial smooth unions.
const sdE=(x,y,z,c,r)=>{const px=(x-c[0])/r[0],py=(y-c[1])/r[1],pz=(z-c[2])/r[2],qx=px/r[0],qy=py/r[1],qz=pz/r[2],k0=Math.sqrt(px*px+py*py+pz*pz),k1=Math.sqrt(qx*qx+qy*qy+qz*qz);return k1>1e-9?k0*(k0-1)/k1:-.2;};
const smin=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};
const smax=(a,b,k)=>-smin(-a,-b,k);
export const BRAIN_PARTS=Object.freeze(['frontal','parietal','temporal','occipital','cerebellum','brainstem']);
// One hemisphere (mirrored by |x|). The core carries the mass; the four lobes sculpt its silhouette. The temporal lobe joins with a
// small blend so a crease stays above it, which the lateral sulcus then deepens.
export const LOBES=Object.freeze({
  core:{c:[.3,.07,-.02],r:[.47,.54,.9]},
  frontal:{c:[.28,.1,.46],r:[.4,.5,.56]},
  parietal:{c:[.3,.25,-.2],r:[.42,.44,.56]},
  occipital:{c:[.24,.05,-.7],r:[.33,.37,.36]},
  temporal:{c:[.45,-.25,.07],r:[.3,.25,.54]},
  cerebellum:{c:[.2,-.45,-.6],r:[.32,.21,.3]},
  pons:{c:[0,-.52,-.14],r:[.14,.14,.13]}
});
const STEM=[[0,-.34,-.14],[0,-1.2,-.3]];
const GAP=.02;                                                // half-width of the longitudinal fissure (the medial cut)
const SYLVIAN=[.58,-.14,-.36,.07];                            // lateral sulcus: a segment in (z,y) on the lateral face, rising backward
function segDist2(px,py,ax,ay,bx,by){const vx=bx-ax,vy=by-ay,t=Math.min(1,Math.max(0,((px-ax)*vx+(py-ay)*vy)/(vx*vx+vy*vy))),dx=px-ax-vx*t,dy=py-ay-vy*t;return dx*dx+dy*dy;}
function cortexD(x,y,z){
  const ax=Math.abs(x),L=LOBES;
  let d=sdE(ax,y,z,L.core.c,L.core.r);
  d=smin(d,sdE(ax,y,z,L.frontal.c,L.frontal.r),.16);
  d=smin(d,sdE(ax,y,z,L.parietal.c,L.parietal.r),.16);
  d=smin(d,sdE(ax,y,z,L.occipital.c,L.occipital.r),.14);
  d=smin(d,sdE(ax,y,z,L.temporal.c,L.temporal.r),.05);
  d=smax(d,GAP-ax,.05);                                       // the medial faces: a deep, narrow longitudinal fissure
  const s=SYLVIAN;d+=.13*Math.exp(-segDist2(z,y,s[0],s[1],s[2],s[3])/.0024)*smooth(.3,.52,ax);
  return d;
}
const cerebD=(x,y,z)=>sdE(Math.abs(x),y,z,LOBES.cerebellum.c,LOBES.cerebellum.r);
function stemD(x,y,z){
  const [a,b]=STEM,vx=b[0]-a[0],vy=b[1]-a[1],vz=b[2]-a[2],t=Math.min(1,Math.max(0,((x-a[0])*vx+(y-a[1])*vy+(z-a[2])*vz)/(vx*vx+vy*vy+vz*vz)));
  const ex=x-a[0]-vx*t,ey=y-a[1]-vy*t,ez=z-a[2]-vz*t,d=Math.sqrt(ex*ex+ey*ey+ez*ez)-(.1-.028*t);
  return smin(d,sdE(x,y,z,LOBES.pons.c,LOBES.pons.r),.06);
}
// The base field (no folds): the union of the three parts, kept as a hard min so the transverse fissure (cerebrum over cerebellum) creases.
const ZS=1.06;                                                // a touch longer than wide×1.35: the baseline's long side silhouette
export function brainBase(x,y,z){z/=ZS;return Math.min(cortexD(x,y,z),cerebD(x,y,z),stemD(x,y,z));}
function partAt(x,y,z){
  z/=ZS;const c=cortexD(x,y,z),b=cerebD(x,y,z),s=stemD(x,y,z);
  if(c<=b&&c<=s){                                              // which lobe: the nearest lobe ellipsoid in normalised distance
    const ax=Math.abs(x),L=LOBES;let best=0,bd=1e9;
    [L.frontal,L.parietal,L.temporal,L.occipital].forEach((l,i)=>{const k=Math.hypot((ax-l.c[0])/l.r[0],(y-l.c[1])/l.r[1],(z-l.c[2])/l.r[2]);if(k<bd){bd=k;best=i;}});
    return best;
  }
  return b<=s?4:5;
}
function baseGrad(x,y,z,d0=brainBase(x,y,z)){const e=.0012;return [(brainBase(x+e,y,z)-d0)/e,(brainBase(x,y+e,z)-d0)/e,(brainBase(x,y,z+e)-d0)/e];}
// Newton projection onto the zero set of the base field; returns the point and the unit normal there.
function project(p,steps=3){
  let x=p[0],y=p[1],z=p[2],d=brainBase(x,y,z),g=baseGrad(x,y,z,d);
  for(let i=0;i<steps&&Math.abs(d)>2e-5;i++){const g2=g[0]*g[0]+g[1]*g[1]+g[2]*g[2]||1;x-=d*g[0]/g2;y-=d*g[1]/g2;z-=d*g[2]/g2;d=brainBase(x,y,z);g=baseGrad(x,y,z,d);}
  return {b:[x,y,z],n:norm3(g)};
}
// Folds. A random-wave field with ONE wavenumber (Berry's random wave model); its nodal lines form a maze of near-even spacing, the
// labyrinth that Turing-type reaction–diffusion also produces and that cortical folding resembles. Nodal lines are the sulci; each nodal
// domain is a gyrus. The distance to the nearest nodal line along the surface is |u| / |∇u tangent|, so every sulcus has the same width
// whatever the local spacing. Height: rounded crowns, narrow deep V sulci.
export function foldParams(phone=false,seed=36){
  const S=(seed|0)*7919,M=18,dirs=[];
  for(let i=0;i<M;i++){const d=randDir(hash(i,S+201),hash(i,S+202));dirs.push([d[0],d[1],d[2],hash(i,S+203)*TAU]);}
  const lambda=phone?.5:.48;   // sulcus and crown widths scale with the wavelength
  return {dirs,k:TAU/lambda,norm:Math.sqrt(2/M),warp:[hash(1,S+204)*TAU,hash(2,S+204)*TAU,hash(3,S+204)*TAU],ws:.0875*lambda,wc:.1875*lambda,crown:.035,sulcus:.075,lambda};
}
export function foldAt(x,y,z,n,F){
  const w=F.warp,wx=x+.05*Math.sin(2.1*y+1.3*z+w[0]),wy=y+.05*Math.sin(1.7*z+2.3*x+w[1]),wz=z+.05*Math.sin(1.9*x+1.1*y+w[2]);
  let u=0,gx=0,gy=0,gz=0;
  for(const d of F.dirs){const a=F.k*(d[0]*wx+d[1]*wy+d[2]*wz)+d[3],s=-Math.sin(a)*F.k;u+=Math.cos(a);gx+=s*d[0];gy+=s*d[1];gz+=s*d[2];}
  u*=F.norm;gx*=F.norm;gy*=F.norm;gz*=F.norm;
  const gn=gx*n[0]+gy*n[1]+gz*n[2];gx-=gn*n[0];gy-=gn*n[1];gz-=gn*n[2];
  const gl=Math.hypot(gx,gy,gz),dist=Math.abs(u)/Math.max(gl,F.k*.2);
  const sul=Math.exp(-((dist/F.ws)**2)),crown=1-Math.exp(-((dist/F.wc)**2));
  // the fold's direction on the surface: along the nodal line (perpendicular to the tangent gradient), for sparks
  const t=gl>1e-6?norm3(cross(n,[gx/gl,gy/gl,gz/gl])):null;
  return {h:F.crown*crown-F.sulcus*sul,sul,crown,dist,t};
}
// Cerebellum folia: concentric grooves around a point above and in front of each half (thin horizontal striations on screen).
function foliaAt(x,y,z){const r=Math.hypot(Math.abs(x)-.2,y+.28,z/ZS+.42),f=r/.1-Math.floor(r/.1);return {h:-.03*Math.exp(-(((f-.5)/.16)**2)),g:Math.exp(-(((f-.5)/.2)**2))};}
// A point on the folded surface near p: project onto the base, then displace along the base normal by the fold height.
const heightAt=(b,n,part,F)=>{const medial=smooth(.03,.09,Math.abs(b[0]));   // no folds on the medial wall (it sits in the fissure)
  if(part<4){const fold=foldAt(b[0],b[1],b[2],n,F);return {h:fold.h*medial,fold,folia:null,medial};}
  if(part===4){const folia=foliaAt(b[0],b[1],b[2]);return {h:folia.h,fold:null,folia,medial};}
  return {h:0,fold:null,folia:null,medial};};
export function brainSurface(p,F){
  const {b,n}=project(p),part=partAt(b[0],b[1],b[2]),{h,fold,folia,medial}=heightAt(b,n,part,F);
  return {p:[b[0]+n[0]*h,b[1]+n[1]*h,b[2]+n[2]*h],base:b,n,part,fold,folia,medial};
}
// The displaced surface's normal, from two neighbours on the folded surface (the base is locally flat at this offset).
function surfaceNormal(s,F){
  const n=s.n,a=Math.abs(n[1])<.9?[0,1,0]:[1,0,0],t1=norm3(cross(n,a)),t2=cross(n,t1),e=.007;
  const nb=t=>{const b=[s.base[0]+t[0]*e,s.base[1]+t[1]*e,s.base[2]+t[2]*e],h=heightAt(b,n,s.part,F).h;return [b[0]+n[0]*h,b[1]+n[1]*h,b[2]+n[2]*h];};
  const q1=nb(t1),q2=nb(t2);
  let m=norm3(cross([q1[0]-s.p[0],q1[1]-s.p[1],q1[2]-s.p[2]],[q2[0]-s.p[0],q2[1]-s.p[1],q2[2]-s.p[2]]));
  if(m[0]*n[0]+m[1]*n[1]+m[2]*n[2]<0)m=[-m[0],-m[1],-m[2]];
  return m;
}
const BOX=[[-.8,.8],[-1.24,.72],[-1.17,1.15]];
// Sample the brain: rejection from the SDF shell (|d| < band, uniform per unit area) → Newton projection → fold displacement → the
// displaced normal. Quotas per part keep the cerebellum and stem present at every count. The inside of the fissure is rejected (it is
// occluded) and ~82 % of the marks at the bottom of a sulcus are rejected, so the sulci read as dark channels between lit gyri.
function brainPoints(N,phone,S){
  const F=foldParams(phone,S/7919),out=[],parts=[];
  const want=[Math.round(N*.64),Math.round(N*.085),Math.round(N*.022)],have=[0,0,0];
  const inner=N-want[0]-want[1]-want[2];
  const lerp=(r,u)=>r[0]+(r[1]-r[0])*u;
  let i=0;
  for(;i<N*400&&(have[0]<want[0]||have[1]<want[1]||have[2]<want[2]);i++){
    const c=[lerp(BOX[0],hash(i,S+101)),lerp(BOX[1],hash(i,S+102)),lerp(BOX[2],hash(i,S+103))];
    if(Math.abs(brainBase(c[0],c[1],c[2]))>.05)continue;
    const guess=partAt(c[0],c[1],c[2]),gk=guess<4?0:guess===4?1:2;if(have[gk]>=want[gk])continue;   // cheap: skip full parts before projecting
    const s=brainSurface(c,F),kind=s.part<4?0:s.part===4?1:2;
    if(have[kind]>=want[kind])continue;
    if(kind===0){
      if(s.medial<.35&&s.base[1]>-.3)continue;               // inside the longitudinal fissure
      if(s.fold.sul*s.medial>.45&&hash(i,S+104)<.82)continue; // thin the sulcus floors: dark channels
    }
    const n=surfaceNormal(s,F),h=[hash(i,S+105),hash(i,S+106),hash(i,S+107)];
    let slot,size,rim=1,tone;
    if(kind===0){
      const f=s.fold,sul=f.sul*s.medial,crown=1-(1-f.crown)*s.medial,lip=s.medial*Math.exp(-(((f.dist-F.ws*1.55)/(F.ws*.6))**2));
      const reg=fbm(s.p[0]*1.3+5,s.p[1]*1.3+9,s.p[2]*1.3+2,S+40,2);
      if(sul>.5){slot=0;size=.5;rim=.55;tone=0;}
      else if(lip>.55){slot=3;size=.74+.1*h[0];tone=2;}                      // the lip of a sulcus: a mint rim line
      else if(crown>.8){slot=reg<.52?3:reg<.58?4:reg<.61?5:2;size=.82+.2*h[0];tone=3;}   // gyral crowns: brightest
      else{slot=reg<.47?2:reg<.56?1:2;size=.7+.14*h[0];tone=1;}
    }else if(kind===1){const g=s.folia.g;slot=g>.6?0:h[0]<.5?3:g<.15?4:2;size=g>.6?.5:.72+.12*h[0];rim=1;tone=g>.6?0:2;}
    else{slot=h[0]<.45?2:h[0]<.8?3:1;size=.68+.1*h[0];rim=1;tone=1;}
    out.push({p:s.p,n,rim,size,slot,role:0,g:0,tone});parts.push(s.part);have[kind]++;
  }
  // the volume: faint specks inside the brain (no normal, random orientation), the teal body behind the surface marks
  for(let k=0,j=0;k<inner&&j<inner*60;j++){
    const c=[lerp(BOX[0],hash(j,S+111)),lerp(BOX[1],hash(j,S+112)),lerp(BOX[2],hash(j,S+113))];
    const d=brainBase(c[0],c[1],c[2]);if(d>-.04||(Math.abs(c[0])<GAP&&c[1]>-.3))continue;
    out.push({p:c,n:[0,0,0],rim:0,size:.3+.16*hash(j,S+114),slot:hash(j,S+115)<.55?1:hash(j,S+116)<.5?2:0,role:2,g:0,tone:0});parts.push(6);k++;
  }
  while(out.length<N){const k=out.length;out.push({p:[0,0,0],n:[0,0,0],rim:0,size:.3,slot:1,role:2,g:0,tone:0});parts.push(6);}
  out.length=N;parts.length=N;
  return {list:out,parts,candidates:i,F};
}
function brain(N,phone,S){return brainPoints(N,phone,S);}

// ---------------------------------------------------------------- the other forms (Direction A's globe and galaxy)
export const MARK=Object.freeze({desktop:.0215,phone:.03});
const pitchOf=mh=>mh*ASPECT/.6;
// Globe: a latitude lattice (vertical pitch 1.13 × horizontal), continents in turquoise/mint over a deep sea, a thin atmosphere shell.
function globe(N,phone,S){
  const out=[],mh=phone?MARK.phone:MARK.desktop,ph=pitchOf(mh)*1.02,pv=ph*1.13,rows=Math.floor(Math.PI*.94/pv);
  for(let r=0;r<rows;r++){
    const lat=-Math.PI*.47+(r+.5)*pv,cl=Math.cos(lat),cols=Math.max(3,Math.round(TAU*cl/ph));
    for(let c=0;c<cols;c++){
      const lon=(c+.5*(r%2))/cols*TAU,d=[cl*Math.cos(lon),Math.sin(lat),cl*Math.sin(lon)];
      const land=fbm(d[0]*1.6+2,d[1]*1.6+5,d[2]*1.6+1,S+21,4);
      const coast=Math.abs(land-.53)<.018;
      out.push({p:d,n:d,rim:1,size:land>.53?.95:.72,slot:coast?5:land>.6?3:land>.53?2:land>.47?1:0,role:0,g:0});
    }
  }
  const atm=Math.round(N*.16);
  for(let k=0;k<atm;k++){const d=fibDir(k,atm,.4),r=1.09+.05*hash(k,S+22);out.push({p:d.map(c=>c*r),n:d,rim:1,size:.42,slot:hash(k,S+23)<.5?4:1,role:1,g:0});}
  const ring=Math.round(N*.05);                         // an equatorial orbit of marks, the «360» accent
  for(let k=0;k<ring;k++){const a=k/ring*TAU,r=1.32+.04*hash(k,S+24);out.push({p:[Math.cos(a)*r,(hash(k,S+25)-.5)*.02,Math.sin(a)*r],n:[Math.cos(a),0,Math.sin(a)],rim:.8,size:.55,slot:k%9===0?5:3,role:0,g:1});}
  fillSpecks(out,N,S+2,(k,h)=>{const d=randDir(h[0],h[1]);return d.map(c=>c*.95*Math.cbrt(h[2]));});
  return out;
}
// Galaxy: two logarithmic arms, a bulge, a thin disc; groups by radius so the inner disc turns faster (differential rotation).
function galaxy(N,phone,S){
  const out=[];
  for(let k=0;k<N;k++){
    const h=[hash(k,S+31),hash(k,S+32),hash(k,S+33),hash(k,S+34),hash(k,S+35)];
    let p,slot;
    if(h[4]<.16){const d=randDir(h[0],h[1]),r=.34*h[2]**1.6;p=[d[0]*r,d[1]*r*.55,d[2]*r];slot=h[3]<.5?5:3;}
    else{
      const r=.2+2.1*h[0]**1.25,arm=h[1]<.5?0:Math.PI,spread=(h[2]-.5)*(.5+.25*r),a=arm+r*2.3+spread;
      p=[Math.cos(a)*r,(h[3]-.5)*.11*(1.4-r*.4)*(1+Math.abs(spread)),Math.sin(a)*r];
      slot=r<.6?(h[3]<.4?5:3):r<1.3?(Math.abs(spread)<.12?3:h[3]<.5?2:4):(h[3]<.6?1:0);
    }
    const rad=Math.hypot(p[0],p[2]),g=1+Math.min(3,Math.floor(rad/.55));
    out.push({p,n:[0,0,0],rim:0,size:.4+.4*hash(k,S+36)**2,slot,role:2,g});
  }
  return out;
}
function fillSpecks(out,N,S,place){
  for(let k=out.length;k<N;k++){const h=[hash(k,S+51),hash(k,S+52),hash(k,S+53)];
    out.push({p:place(k,h),n:[0,0,0],rim:0,size:.3+.14*hash(k,S+54),slot:hash(k,S+55)<.55?1:hash(k,S+56)<.5?2:0,role:2,g:0});}
  out.length=N;
}

// ---------------------------------------------------------------- particles
// Per form: pos vec4 = x y z (group-local) + pack(role,slot,group); nrm vec4 = normal·rimWeight + size.
// role 0 structural · 1 shell (face nearly invisible, rim lit) · 2 speck (no normal, random orientation)
const pack=(role,slot,group)=>role*64+slot*8+group;
export const unpack=w=>({role:Math.floor(w/64),slot:Math.floor(w/8)%8,group:w%8});
export function countFor({mobile=false}={}){return mobile?8000:16000;}
// Storage order is one hash permutation shared by every form, so drawing the first n of the buffer (the governor's last step, the dust)
// is a uniform subsample of every form.
export function buildParticles({count=16000,phone=false,seed=36}={}){
  const N=Math.max(0,Math.floor(+count||0)),S=(seed|0)*7919,forms={},meta=new Float32Array(N*4);
  const perm=new Uint32Array(N);for(let i=0;i<N;i++)perm[i]=i;
  for(let i=N-1;i>0;i--){const j=Math.floor(hash(i,S+97)*(i+1)),t=perm[i];perm[i]=perm[j];perm[j]=t;}
  let parts=new Uint8Array(N),tones=new Uint8Array(N),fold=null,candidates=0;
  for(const name of FORMS){
    let list;
    if(name==='brain'){const b=N?brain(N,phone,S):{list:[],parts:[],candidates:0,F:null};list=b.list;fold=b.F;candidates=b.candidates;
      for(let k=0;k<N;k++){parts[k]=b.parts[perm[k]];tones[k]=list[perm[k]].tone||0;}}
    else list=name==='globe'?globe(N,phone,S):galaxy(N,phone,S);
    const pos=new Float32Array(N*4),nrm=new Float32Array(N*4);
    for(let k=0;k<N;k++){const e=list[perm[k]];pos[k*4]=e.p[0];pos[k*4+1]=e.p[1];pos[k*4+2]=e.p[2];pos[k*4+3]=pack(e.role,e.slot,e.g);
      nrm[k*4]=e.n[0]*e.rim;nrm[k*4+1]=e.n[1]*e.rim;nrm[k*4+2]=e.n[2]*e.rim;nrm[k*4+3]=e.size;}
    forms[name]={pos,nrm};
  }
  for(let k=0;k<N;k++){meta[k*4]=hash(k,S+61);meta[k*4+1]=hash(k,S+62);meta[k*4+2]=hash(k,S+63);meta[k*4+3]=hash(k,S+64);}
  return {count:N,forms,meta,parts,tones,fold,candidates,phone:!!phone};
}
// Ambient: sparse marks in VIEW space; 1 in 24 is near the camera and becomes a large soft bokeh comma.
export function ambientField({count=140,seed=36}={}){
  const n=Math.max(0,Math.floor(+count||0)),S=(seed|0)*131,d=new Float32Array(n*8);
  for(let k=0;k<n;k++){
    const o=k*8,near=k%24===5;d[o]=hash(k,S+1)*2-1;d[o+1]=hash(k,S+2)*2-1;d[o+2]=near?-(1.1+.6*hash(k,S+3)):-(2.5+9*hash(k,S+3)**2);
    d[o+3]=[1,2,3,4,2,1][k%6];d[o+4]=hash(k,S+4);d[o+5]=hash(k,S+5);d[o+6]=hash(k,S+6);d[o+7]=near?2.4+.8*hash(k,S+7):.7+.8*hash(k,S+8);
  }
  return d;
}
// The brain's slow, majestic turn: a held 3/4 view from above that sways ±20° about a near-side view over ~90 s (front to the left).
export const brainYaw=t=>-1.3+.34*Math.sin(t*.07);
// Group matrices per form at time t (each includes the form's model rotation). 8 × mat3.
export function groupMatrices(form,t,out=new Float32Array(72)){
  let model;
  if(form==='brain')model=m3.mul(m3.rx(.05*Math.sin(t*.05)),m3.ry(brainYaw(t)));
  else if(form==='globe')model=m3.axis([.39,1,0],t*.09);
  else model=m3.mul(m3.rx(.42),m3.ry(t*.05));
  for(let g=0;g<8;g++){
    let G=model;
    if(form==='galaxy'&&g>=1)G=m3.mul(model,m3.ry(t*(.34/g)));
    else if(form==='globe'&&g===1)G=m3.mul(m3.rx(.28),m3.ry(t*.2));
    out.set(G,g*9);
  }
  return out;
}

// ---------------------------------------------------------------- scenes and camera
// form · side/fill: the seat without a box · grow/growP: box.R multiplier (landscape / portrait) · dim · drift · speed: the scene's clock rate · live: interactive
const SCENES={
  login:{form:'brain',side:.28,fill:.37,grow:.78,growP:1.08,dim:1,drift:.006,speed:1,live:1},
  home:{form:'brain',side:.25,fill:.3,grow:1.7,growP:2.05,dim:.95,drift:.006,speed:1,live:1},
  index:{form:'globe',side:.3,fill:.4,grow:1.12,dim:.9,drift:.006,speed:1,live:0},
  off:{form:'galaxy',side:.5,fill:0,grow:1,dim:.1,drift:.012,speed:.25,live:0}
};
const CAMS={brain:{fov:34,elev:24,fit:1.3},globe:{fov:34,elev:10,fit:1.3},galaxy:{fov:40,elev:30,fit:1.9}};
// The brain's drawn extent in units of the seat radius R (lit marks and their glow, over the whole ±20° sway): used to fit it inside
// a stage box. Measured on the rendered frames (work/design-verify/brain-scroll), with the stem's dim tail below the 'down' figure.
export const BRAIN_EXTENT=Object.freeze({x:.96,up:.7,down:.7});
// The largest R (never larger than R) that keeps the brain inside fit = {top,bottom,left,right} (canvas CSS px) around (cx,cy).
export function fitRadius(R,cx,cy,fit){
  if(!fit||typeof fit!=='object')return R;
  const room=[(cy-fit.top)/BRAIN_EXTENT.up,(fit.bottom-cy)/BRAIN_EXTENT.down,(cx-fit.left)/BRAIN_EXTENT.x,(fit.right-cx)/BRAIN_EXTENT.x].filter(Number.isFinite);
  return room.length?Math.min(R,...room.map(v=>Math.max(0,v))):R;
}
export const SCENE_NAMES=Object.freeze(Object.keys(SCENES));
export function sceneTarget(name){const key=Object.hasOwn(SCENES,name)?name:'off';return {...SCENES[key],cam:{...CAMS[SCENES[key].form]},name:key};}

// ---------------------------------------------------------------- shaders
const f=v=>{const s=(+v).toFixed(5);return s.includes('.')?s:s+'.';};
const centred=list=>list.map(([u,v])=>[(u-.5)*ASPECT,.5-v]);
export const COMMA_CORNERS=Object.freeze(centred(COMMA));
export const HALF_CORNERS=Object.freeze(centred(HALF_COMMA));
const V2=([x,y])=>`vec2(${f(x)},${f(y)})`;
const [Q0,Q1,Q2,Q3]=COMMA_CORNERS.map(V2),[T0,T1,T2]=HALF_CORNERS.map(V2);
export const MAX_SPARKS=6,SPARK_TRAIL=3;
const NS=MAX_SPARKS*SPARK_TRAIL;
const VS=`
attribute vec4 aA;attribute vec4 aB;attribute vec4 aNA;attribute vec4 aNB;attribute vec4 aMeta;
uniform mat3 uGA[8];uniform mat3 uGB[8];
uniform mat4 uView;uniform mat4 uProj;uniform vec2 uShift;uniform vec2 uCanvas;
uniform float uTime;uniform float uMorph;uniform float uFly;uniform float uAmbient;uniform vec2 uTan;uniform vec2 uPar;
uniform float uSize;uniform float uPx;uniform float uMaxPt;uniform float uCore;uniform float uDpr;uniform float uDrift;uniform float uHaloR;
uniform float uFocus;uniform float uCoc;uniform float uBand;uniform float uDim;uniform float uWave;
uniform vec3 uCol[6];uniform vec3 uRimA;uniform vec3 uRimB;uniform vec3 uPointer;uniform vec3 uLight;
uniform vec4 uRects[8];uniform float uRectN;uniform float uFeather;uniform float uGlow;uniform vec4 uHole;
uniform vec4 uWaves[2];uniform vec4 uSparks[${NS}];uniform float uSparkN;uniform float uNeural;
varying vec4 vM;varying vec4 vS;varying vec4 vC;
vec3 slotCol(float s){vec3 c=uCol[0];for(int k=1;k<6;k++){if(float(k)==s)c=uCol[k];}return c;}
void main(){
  float ph=aMeta.x,h1=aMeta.z,h2=aMeta.w;
  vec4 vp;vec3 n=vec3(0.);vec3 col;float size,a=1.,role=0.,wave=0.,syn=0.;
  if(uAmbient>.5){
    float z=aA.z,x=mod(aA.x+uTime*(.003+.006*h1)+1.,2.)-1.,y=aA.y+.03*sin(uTime*.11+ph*6.2831853);
    vp=vec4(x*uTan.x*(-z)*1.1+uPar.x*.22,y*uTan.y*(-z)*1.1-uPar.y*.15,z,1.);
    size=aNA.w;col=slotCol(aA.w);a=.18+.3*aMeta.y;role=2.;
  }else{
    float m=clamp(uMorph*1.7-aMeta.y*.7,0.,1.);float e=m*m*m*(m*(m*6.-15.)+10.);
    float gA=mod(aA.w,8.),gB=mod(aB.w,8.),sA=mod(floor(aA.w/8.),8.),sB=mod(floor(aB.w/8.),8.);
    mat3 GA=uGA[int(gA+.5)],GB=uGB[int(gB+.5)];
    vec3 pa=GA*aA.xyz,pb=GB*aB.xyz;
    vec3 fly=vec3(sin(ph*113.1),sin(ph*157.3),sin(ph*197.9));
    vec3 p=mix(pa,pb,e)+fly*uFly*sin(3.14159265*e);
    n=mix(GA*aNA.xyz,GB*aNB.xyz,e);size=mix(aNA.w,aNB.w,e);
    col=mix(slotCol(sA),slotCol(sB),e);role=e<.5?floor(aA.w/64.):floor(aB.w/64.);
    // currents: slow light pulses travelling through the form in its own frame
    vec3 lp=e<.5?aA.xyz:aB.xyz;float g=e<.5?gA:gB;
    wave=pow(.5+.5*sin(dot(lp,vec3(2.1,1.3,2.7))*2.2+atan(lp.z,lp.x)*2.-uTime*1.15+g*1.9),18.)*uWave;
    // synapses: sparks travelling along the folds, in the brain's own frame (head + trail)
    for(int i=0;i<${NS};i++){if(float(i)>=uSparkN)break;vec4 s=uSparks[i];vec3 d=lp-s.xyz;syn+=s.w*exp(-dot(d,d)*uNeural);}
    syn=min(syn,1.6);
    vec3 q=p*2.3;float tt=uTime*.21;
    p=p*(1.+.01*sin(uTime*.5))+uDrift*vec3(sin(q.y+tt+ph*6.2831853),sin(q.z+tt*1.13+ph*4.1),sin(q.x+tt*.91+ph*2.7));
    vp=uView*vec4(p,1.);n=mat3(uView)*n;
  }
  float depth=-vp.z;
  vec4 clip=uProj*vp;if(uAmbient<.5)clip.xy+=uShift*clip.w;
  float w=max(clip.w,1e-4);vec2 ndc=clip.xy/w;
  float asp=uCanvas.x/uCanvas.y,hl=0.,wv=0.;
  if(uAmbient<.5){
    // the pointer: local repulsion and a lit neighbourhood
    if(uPointer.z>.001){
      vec2 dd=(ndc-uPointer.xy)*vec2(asp,1.);float dl=length(dd);
      float push=uPointer.z*.026*pow(max(0.,1.-dl/.22),2.);
      if(dl>1e-4)ndc+=dd/dl*push*vec2(1./asp,1.);
      hl=uPointer.z*smoothstep(.3,0.,dl);
    }
    // neural pulse waves: an expanding ring in screen space (xy origin, z age in s, w amplitude)
    for(int i=0;i<2;i++){vec4 W=uWaves[i];if(W.w<=0.)continue;
      vec2 dd=(ndc-W.xy)*vec2(asp,1.);float dl=length(dd),r=W.z*1.25,k=exp(-pow((dl-r)/.06,2.))*W.w*pow(max(0.,1.-W.z/1.7),1.5);
      wv+=k;if(dl>1e-4)ndc+=dd/dl*k*.012*vec2(1./asp,1.);}
    wv=min(wv,1.5);
  }
  gl_Position=vec4(ndc*w,clip.zw);
  // orientation: the card lies on the surface (normal → yaw, pitch), flipped to face the camera; never rolled
  float nl=length(n),yaw,pit;
  vec3 V=normalize(-vp.xyz);float rim=0.,shade=1.,spec=0.,hide=1.;
  if(nl>.02&&role<1.5){vec3 nn=n/nl;float fv=dot(nn,V);rim=1.-abs(fv);
    // occlusion, approximated: a mark whose surface faces away is behind the form, so it recedes (the silhouette stays lit)
    hide=mix(.36,1.,smoothstep(-.4,.12,fv*min(nl*1.4,1.)));
    // key light on the true normal (half-Lambert + a tight specular): the folds read by their light
    float lam=.5+.5*dot(nn,uLight);shade=mix(1.,mix(.36,1.2,pow(lam,1.35)),min(nl,1.));
    spec=pow(max(dot(nn,normalize(uLight+V)),0.),22.)*min(nl,1.);
    if(nn.z<0.)nn=-nn;
    yaw=clamp(atan(nn.x,nn.z),-.85,.85);pit=clamp(asin(clamp(-nn.y,-1.,1.)),-.75,.75);}
  else{yaw=(h1-.5)*1.1;pit=(h2-.5)*.8;}
  yaw+=.1*sin(uTime*.23+ph*6.2831853);pit+=.07*sin(uTime*.19+ph*9.424778);
  float cy=cos(yaw),sy=sin(yaw),cp=cos(pit),sp=sin(pit);
  mat2 MM=mat2(cy,0.,sy*sp,cp);
  size*=1.+.28*min(syn,1.)+.1*min(wv,1.);
  float h=uSize*size*uPx/max(depth,.05);
  float ext=max(max(length(MM*${Q0}),length(MM*${Q1})),max(length(MM*${Q2}),length(MM*${Q3})));
  // depth of field: circle of confusion in device px, zero inside the focal band
  float coc=min(uCoc*max(0.,abs(depth-uFocus)-uBand)/max(depth,.05),26.*uDpr);
  float mode=h<1.7?2.:(h*${f(ASPECT)}<5.*uDpr?1.:0.);
  float hw=uCore*.5;
  float margin=hw+2.6*(.45+coc)+uHaloR*2.4;
  float half_=h*ext+margin;
  if(2.*half_>uMaxPt){float k2=(uMaxPt*.5-margin)/max(h*ext,1e-3);h*=max(k2,0.);half_=uMaxPt*.5;}
  gl_PointSize=2.*half_;
  // light: depth grades toward the abyss, rims toward mint / sky, energy conserved under blur
  float far=smoothstep(uFocus-.34,uFocus+1.41,depth);
  if(uAmbient<.5){
    col=mix(col,uCol[0]*1.3+uCol[1]*.2,far*.75);
    a*=mix(.8,.16,far);
    a*=shade*hide;col=mix(col,uCol[4],spec*.35);a*=1.+.45*spec;
    float rk=smoothstep(.62,.93,rim)*min(nl,1.);
    col=mix(col,h1<.7?uRimA:uRimB,rk*.9);a*=1.+.4*rk;
    if(role>.5&&role<1.5)a*=mix(.05,.9,rk*rk);
    if(role>1.5)a*=.4;
    col=mix(col,uCol[3],wave*.55);a*=1.+.7*wave;
    a*=exp(-max(depth-uFocus-1.76,0.)*.5);
    // interaction: lit by the pointer, the wave and the synapses (mint to white-hot)
    col=mix(col,uCol[3],hl*.5);a*=1.+1.4*hl;
    col=mix(col,mix(uCol[3],uCol[5],.4),min(wv,1.)*.6);a*=1.+1.7*wv;
    col=mix(col,mix(uCol[3],uCol[5],.5),min(syn,1.)*.85);a*=1.+1.5*syn;
  }
  a*=smoothstep(.15,.6,depth)*clamp(h/1.2,0.,1.);
  a*=(hw+.9)/(hw+.9+coc*1.3);
  a*=uGlow;
  float keep=1.;vec2 pix=(ndc*.5+.5)*uCanvas;
  for(int i=0;i<8;i++){if(float(i)>=uRectN)break;vec4 r=uRects[i];vec2 qq=max(max(r.xy-pix,pix-r.zw),0.);keep=min(keep,clamp(length(qq)/uFeather,0.,1.));}
  // the home count: a soft elliptical window (the brain holds the number; a faint veil stays behind it)
  if(uHole.z>0.)keep=min(keep,mix(.1,1.,smoothstep(.5,1.08,length((pix-uHole.xy)/uHole.zw))));
  a*=keep;
  vC=vec4(col,a*uDim);vM=vec4(cy*h,0.,sy*sp*h,cp*h);vS=vec4(half_,coc,mode,hw);
  if(vC.a<.004)gl_PointSize=0.;
}`;
const FS=`
varying vec4 vM;varying vec4 vS;varying vec4 vC;
uniform float uHaloA;uniform float uHaloR;
float sg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.));}
void main(){
  vec2 p=(gl_PointCoord-.5)*2.*vS.x;p.y=-p.y;
  mat2 M=mat2(vM.xy,vM.zw);float d;
  if(vS.z>1.5)d=max(length(p)-length(M*vec2(.35,.0)),0.);
  else if(vS.z>.5){vec2 a=M*${T0},b=M*${T1},c=M*${T2};d=min(min(sg(p,a,b),sg(p,b,c)),sg(p,c,a));}
  else{vec2 c0=M*${Q0},c1=M*${Q1},c2=M*${Q2},c3=M*${Q3};d=min(min(sg(p,c0,c1),sg(p,c1,c2)),min(sg(p,c2,c3),sg(p,c3,c0)));}
  float sig=.46+vS.y,x=max(d-vS.w,0.);
  float v=exp(-.5*x*x/(sig*sig))+uHaloA*exp(-d/(uHaloR*(1.+vS.y*.25)));
  v*=vC.a;
  if(v<.002)discard;
  FRAG=vec4(vC.rgb*v,v);
}`;
// post: full-screen triangle
const PVS=`attribute vec2 aP;varying vec2 vUv;void main(){vUv=aP*.5+.5;gl_Position=vec4(aP,0.,1.);}`;
const DOWN=`varying vec2 vUv;uniform sampler2D uTex;uniform vec2 uTexel;
void main(){vec2 o=uTexel;vec4 c=TEX(uTex,vUv+vec2(-o.x,-o.y))+TEX(uTex,vUv+vec2(o.x,-o.y))+TEX(uTex,vUv+vec2(-o.x,o.y))+TEX(uTex,vUv+vec2(o.x,o.y));
FRAG=c*.25;}`;
const BLUR=`varying vec2 vUv;uniform sampler2D uTex;uniform vec2 uDir;
void main(){vec2 o1=uDir*1.3846154,o2=uDir*3.2307692;
FRAG=TEX(uTex,vUv)*.2270270+(TEX(uTex,vUv+o1)+TEX(uTex,vUv-o1))*.3162162+(TEX(uTex,vUv+o2)+TEX(uTex,vUv-o2))*.0702703;}`;
// Composite: scene + bloom + a faint teal haze behind the form, soft-shoulder tonemap, dither. On a light canvas the light is re-inked:
// the same luminance drawn in deep teal (whites become the abyss), normal alpha, so the form still reads on paper.
const COMP=`varying vec2 vUv;uniform sampler2D uScene;uniform sampler2D uQ;uniform sampler2D uE;uniform float uBloom;uniform vec3 uFog;uniform vec3 uHaze;uniform vec2 uRes;uniform float uAsp;
uniform float uPaper;uniform vec3 uInkA;uniform vec3 uInkB;
void main(){
  vec3 s=TEX(uScene,vUv).rgb,b=TEX(uQ,vUv).rgb*.85+TEX(uE,vUv).rgb*1.25;
  vec2 d=(vUv-uHaze.xy)*vec2(uAsp,1.);float fog=exp(-dot(d,d)/(uHaze.z*uHaze.z));
  vec3 c=s+uBloom*b+uFog*fog;
  float l=max(c.r,max(c.g,c.b));c+=vec3(max(l-1.,0.)*.22);
  vec3 k=vec3(.72);c=mix(c,k+(1.-k)*(1.-exp(-(c-k)/(1.-k))),step(k,c));
  float n=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);c+=(n-.5)/255.;
  c=clamp(c,0.,1.);
  if(uPaper>.5){float a=clamp(max(c.r,max(c.g,c.b))*.92,0.,1.);vec3 ink=mix(uInkA,uInkB,smoothstep(.5,1.,min(c.r,min(c.g,c.b))));FRAG=vec4(ink*a,a);return;}
  FRAG=vec4(c,max(c.r,max(c.g,c.b)));
}`;
const HEAD={vs2:'#version 300 es\n#define attribute in\n#define varying out\n',
  fs2:'#version 300 es\nprecision highp float;\n#define varying in\nout vec4 fragColor;\n#define FRAG fragColor\n#define TEX texture\n',
  vs1:'',fs1:'#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n#define FRAG gl_FragColor\n#define TEX texture2D\n'};
export const SHADERS=Object.freeze({VS,FS,PVS,DOWN,BLUR,COMP});
const PU=['uGA','uGB','uView','uProj','uShift','uCanvas','uTime','uMorph','uFly','uAmbient','uTan','uPar','uSize','uPx','uMaxPt','uCore','uDpr','uDrift','uHaloR',
  'uFocus','uCoc','uBand','uDim','uWave','uCol','uRimA','uRimB','uPointer','uLight','uRects','uRectN','uFeather','uGlow','uHaloA','uHole','uWaves','uSparks','uSparkN','uNeural'];
const CU=['uScene','uQ','uE','uBloom','uFog','uHaze','uRes','uAsp','uPaper','uInkA','uInkB'];

// ---------------------------------------------------------------- synapses (pure: the engine and the tests share them)
// A spark lives on the folded surface in the brain's own frame and travels along the fold it starts on (the nodal-line direction),
// re-projected onto the surface every step. Its last positions form a short trail.
export const COMET=7;                                          // commas drawn along each spark's path (head first)
export function makeSpark(p,dir=1,{life=1.5,speed=.55,strength=1}={}){return {p:[...p],n:null,dir:dir<0?-1:1,age:0,life,speed,strength,trail:[[...p],[...p]],path:[[...p]],acc:0,pacc:0};}
export function stepSpark(s,dt,F){
  s.age+=dt;if(s.age>=s.life)return false;
  const surf=brainSurface(s.p,F);let t=surf.fold?.t;
  if(!t){const n=surf.n,a=Math.abs(n[1])<.9?[0,1,0]:[1,0,0];t=norm3(cross(n,a));}
  if(s.prev&&t[0]*s.prev[0]+t[1]*s.prev[1]+t[2]*s.prev[2]<0)t=[-t[0],-t[1],-t[2]];   // keep heading: no reversal on the line
  else if(!s.prev&&s.dir<0)t=[-t[0],-t[1],-t[2]];
  s.prev=t;const st=s.speed*dt;
  const next=brainSurface([surf.p[0]+t[0]*st,surf.p[1]+t[1]*st,surf.p[2]+t[2]*st],F).p;
  s.acc+=dt;if(s.acc>=.075){s.acc=0;s.trail.unshift(s.p);s.trail.length=SPARK_TRAIL-1;}
  s.pacc+=dt;if(s.pacc>=.03){s.pacc=0;s.path.unshift(next);if(s.path.length>COMET)s.path.length=COMET;}
  s.p=next;s.n=surf.n;return true;
}
export function sparkLight(s){const u=s.age/s.life;return s.strength*Math.min(1,s.age/.12)*Math.max(0,1-u)**1.2;}

// ---------------------------------------------------------------- the engine
const DPR_STEPS=[1,.85,.72,.6];
export function mountDepth(canvas,{view=globalThis,reduced=false,debug=false}={}){
  const noop=()=>{},dead=()=>({ok:false,setScene:noop,setData:noop,setExclusions:noop,dim:noop,pulse:noop,spark:noop,pause:noop,resume:noop,destroy:noop,enableTilt:()=>Promise.resolve(false),stats:()=>null});
  view=view||{};
  const doc=view.document,html=doc?.documentElement,clock=()=>view.performance?.now?.()??Date.now();
  const media=q=>{try{return !!view.matchMedia?.(q)?.matches;}catch{return false;}};
  const coarse=media('(pointer: coarse)');
  const attrs={alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'high-performance'};
  let gl=null,gl2=false;
  try{gl=canvas?.getContext?.('webgl2',attrs)||null;gl2=!!gl;if(!gl)gl=canvas?.getContext?.('webgl',attrs)||canvas?.getContext?.('experimental-webgl',attrs)||null;}catch{gl=null;}
  if(!gl||typeof gl.createShader!=='function')return dead();

  let G=null;
  const compile=(type,src)=>{const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);if(gl.getShaderParameter(sh,gl.COMPILE_STATUS))return sh;
    if(debug)console.warn(gl.getShaderInfoLog(sh));gl.deleteShader(sh);return null;};
  const program=(vs,fs,names,attr0)=>{
    const v=compile(gl.VERTEX_SHADER,(gl2?HEAD.vs2:HEAD.vs1)+vs),fr=compile(gl.FRAGMENT_SHADER,(gl2?HEAD.fs2:HEAD.fs1)+fs);
    if(!v||!fr){if(v)gl.deleteShader(v);if(fr)gl.deleteShader(fr);return null;}
    const p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,fr);gl.bindAttribLocation(p,0,attr0);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(fr);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){if(debug)console.warn(gl.getProgramInfoLog(p));gl.deleteProgram(p);return null;}
    const u={};for(const nm of names)u[nm]=gl.getUniformLocation(p,nm);return {p,u};
  };
  // Render-target format: half-float where renderable, else RGBA8.
  function targetFormat(){
    if(gl2){if(gl.getExtension('EXT_color_buffer_float')||gl.getExtension('EXT_color_buffer_half_float'))return {internal:gl.RGBA16F,format:gl.RGBA,type:gl.HALF_FLOAT,hdr:true};}
    else{const hf=gl.getExtension('OES_texture_half_float'),lin=gl.getExtension('OES_texture_half_float_linear'),cb=gl.getExtension('EXT_color_buffer_half_float');
      if(hf&&lin&&cb)return {internal:gl.RGBA,format:gl.RGBA,type:hf.HALF_FLOAT_OES,hdr:true};}
    return {internal:gl.RGBA,format:gl.RGBA,type:gl.UNSIGNED_BYTE,hdr:false};
  }
  function makeTarget(w,h,fmt){
    const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,fmt.internal,w,h,0,fmt.format,fmt.type,null);
    const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    const okF=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return okF?{tex,fb,w,h}:(gl.deleteTexture(tex),gl.deleteFramebuffer(fb),null);
  }
  function init(){
    const P=program(VS,FS,PU,'aA');if(!P)return null;
    const down=program(PVS,DOWN,['uTex','uTexel'],'aP'),blur=program(PVS,BLUR,['uTex','uDir'],'aP'),comp=program(PVS,COMP,CU,'aP');
    const a={};for(const nm of ['aA','aB','aNA','aNB','aMeta'])a[nm]=gl.getAttribLocation(P.p,nm);
    const range=gl.getParameter?.(gl.ALIASED_POINT_SIZE_RANGE);
    const bufs={meta:gl.createBuffer(),amb:gl.createBuffer(),tri:gl.createBuffer(),comet:gl.createBuffer()};
    for(const k of FORMS){bufs[k]=gl.createBuffer();bufs['n_'+k]=gl.createBuffer();}
    gl.bindBuffer(gl.ARRAY_BUFFER,bufs.tri);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    return {P,down,blur,comp,a,bufs,maxPt:Math.max(8,Math.min(range?.[1]||64,320)),uploaded:false,fmt:targetFormat(),rt:null,post:!!(down&&blur&&comp)};
  }
  function buildTargets(){
    if(!G||!G.post)return;freeTargets();
    const mk=(w,h)=>{let t=makeTarget(Math.max(1,w),Math.max(1,h),G.fmt);if(!t&&G.fmt.hdr){G.fmt={internal:gl.RGBA,format:gl.RGBA,type:gl.UNSIGNED_BYTE,hdr:false};t=makeTarget(Math.max(1,w),Math.max(1,h),G.fmt);}return t;};
    const s=mk(bw,bh),h2=mk(bw>>1,bh>>1),q=mk(bw>>2,bh>>2),q2=mk(bw>>2,bh>>2),e=mk(bw>>3,bh>>3),e2=mk(bw>>3,bh>>3);
    G.rt={s,h2,q,q2,e,e2};
    if(!(s&&h2&&q&&q2&&e&&e2)){G.post=false;freeTargets();}
  }
  function freeTargets(){if(!G?.rt)return;for(const t of Object.values(G.rt))if(t){gl.deleteTexture(t.tex);gl.deleteFramebuffer(t.fb);}G.rt=null;}
  if(!(G=init()))return dead();

  // ---- state
  let alive=true,lost=false,scene=null,box=null,mirror=1,paused=false,frozen=false,level=0,away=false,raf=0;
  let W=0,H=0,bw=0,bh=0,dpr=1,mobile=coarse,lastDraw=0,idleAt=clock(),pulseAt=-1e9,phase=0;
  let cur=null,from=null,to=null,tweenAt=-1e9,tweenDur=1400,dimUser=1,dimNow=1,prog=0,progGoal=0,closed=0,closedGoal=0,late=false;
  let fromKey='brain',toKey='brain',morphAt=-1e9,morphDur=1400,fly=.2,legs=[],PS=null,AMB=null,builtFor=null,paper=0;
  let rects=[],colors=new Float32Array(18),rimA=[.5,.95,.85],rimB=[.87,.9,.93],fogRGB=[0,.05,.045],inkA=[0,.3,.25],inkB=[0,.1,.08];
  let ptr=[0,0],ptrGoal=0,ptrNow=0,ptrAt=-1e9,tilting=false,beta0=null,drawMs=0,framesDrawn=0,gpuMs=0;const gpuTimes=[];
  let comets=0,sparks=[],waves=[],flinchAt=-1e9,lastSparkAt=-1e9,lastSparkXY=[-1e4,-1e4],dragging=false,pickList=null;
  const par=[0,0],parGoal=[0,0],Vw=mat4.create(),Pm=mat4.create(),eye=[0,0,5],ORIGIN=[0,0,0],UP=[0,1,0],rectBuf=new Float32Array(32),win=new Uint8Array(60),GA=new Float32Array(72),GB=new Float32Array(72);
  const sparkBuf=new Float32Array(NS*4),waveBuf=new Float32Array(8),cometBuf=new Float32Array(MAX_SPARKS*COMET*12);
  let sum=0,slot=0;
  const KEYS=['dist','elev','fov','sx','sy','dim','drift','fit','rpx','speed'];
  try{paused=view.localStorage?.getItem('36t-motion-paused')==='true';}catch{}
  const pref=(()=>{try{return view.matchMedia?.('(prefers-reduced-motion: reduce)')||null;}catch{return null;}})();
  const still=()=>!!reduced||paused||!!pref?.matches||html?.dataset?.motion==='off';
  const req=fn=>view.requestAnimationFrame?view.requestAnimationFrame(fn):0;
  const halt=()=>{if(raf)view.cancelAnimationFrame?.(raf);raf=0;};

  const paint=()=>{
    let s=null;try{s=view.getComputedStyle(html);}catch{}
    const read=n=>s?parseColor(s.getPropertyValue(n)):null;
    const pal=derivePalette({turquoise:read('--brand-turquoise'),deep:read('--brand-turquoise-deep'),sky:read('--brand-sky'),paper:read('--brand-paper')});
    pal.forEach((c,i)=>colors.set(c,i*3));
    rimA=pal[3];rimB=pal[4];fogRGB=pal[1].map(v=>v*.055);inkA=pal[1].map(v=>v*.8);inkB=pal[0];
    const cv=read('--canvas');paper=cv&&.2126*cv[0]+.7152*cv[1]+.0722*cv[2]>.5?1:0;
  };
  const activeForm=()=>SCENES[scene||'off'].form;
  const live=()=>!!scene&&SCENES[scene].live===1&&toKey==='brain';
  const target=()=>{
    const s=SCENES[scene||'off'],form=activeForm(),cam=CAMS[form];
    const t={elev:cam.elev,fov:cam.fov,dim:s.dim,drift:s.drift,speed:s.speed,sx:0,sy:0,dist:4,fit:cam.fit,rpx:0};
    if(!(W>0&&H>0))return t;
    if(scene==='off'){t.dist=2.9;return t;}   // the camera sits in the disc: the dust spreads thin, the bulge falls off-centre
    const tan=Math.tan(cam.fov*DEG/2),portrait=W/H<.9;let cx,cy,R;
    if(box&&box.R>0){cx=+box.cx||0;cy=+box.cy||0;R=box.R*(portrait&&s.growP?s.growP:s.grow);}
    else{cx=portrait?W/2:W*(mirror<0?1-s.side:s.side);cy=portrait?H*.3:H/2;R=portrait?Math.min(W*.45,H*.26):H*s.fill;}
    if(box&&box.fit&&form==='brain')R=fitRadius(R,cx,cy,box.fit);   // the phone's eye stage: whole, with air under the top bar and above the date
    R=Math.max(40,Math.min(R,H*.52,portrait?W*.5:W*.5));
    const col=scene==='login'&&!portrait?rects.filter(r=>r.w<W*.6&&(mirror<0?r.x+r.w/2<W*.6:r.x+r.w/2>W*.4)):[];
    if(col.length){
      const HW=1.2,GAP_=40,EDGE=16,edge=mirror<0?Math.max(...col.map(r=>r.x+r.w)):Math.min(...col.map(r=>r.x));
      const room=mirror<0?W-EDGE-(edge+GAP_):edge-GAP_-EDGE;
      if(room>80){R=Math.min(R,room/(2*HW));cx=mirror<0?Math.max(cx,edge+GAP_+HW*R):Math.min(cx,edge-GAP_-HW*R);}
    }
    t.rpx=R;t.sx=cx/W*2-1;t.sy=1-cy/H*2;t.dist=Math.min(40,Math.max(1.5,H/(2*R*tan)*cam.fit));
    return t;
  };
  const retarget=()=>{if(!scene)return;to=target();if(!cur||clock()-tweenAt>=tweenDur)cur={...to};};
  const tweening=now=>now-tweenAt<tweenDur;
  const morphing=now=>now-morphAt<morphDur||legs.length>0;
  const neural=now=>sparks.length>0||waves.some(w=>now-w.at<1700)||now-flinchAt<1100;
  const busy=now=>tweening(now)||morphing(now)||now-pulseAt<700||neural(now)||Math.abs(dimNow-dimUser)>.001||Math.abs(prog-progGoal)>.001||Math.abs(closed-closedGoal)>.001||
    Math.abs(par[0]-parGoal[0])+Math.abs(par[1]-parGoal[1])>.002||Math.abs(ptrNow-ptrGoal)>.01;

  const load=()=>{const n=countFor({mobile});PS=buildParticles({count:n,phone:mobile});AMB=ambientField({count:Math.round(n*.009)});builtFor=mobile;pickList=null;sparks=[];upload();};
  const upload=()=>{
    if(!G||!PS)return;
    const put=(b,data)=>{gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);};
    for(const k of FORMS){put(G.bufs[k],PS.forms[k].pos);put(G.bufs['n_'+k],PS.forms[k].nrm);}
    put(G.bufs.meta,PS.meta);put(G.bufs.amb,AMB);G.uploaded=true;
  };
  // A form change always passes through the galaxy: dissolve (≈1.1 s) then re-form (≈1.4 s). Requests during a morph queue.
  function morphTo(key,now,{d1=1100,d2=1400}={}){
    if(key===toKey){if(morphing(now))legs=[];return;}
    const plan=key==='galaxy'?[['galaxy',1600,.14]]:[['galaxy',d1,.12],[key,d2,.1]];
    if(morphing(now)){legs=toKey==='galaxy'?[[key,d2,.1]]:plan;return;}
    fromKey=toKey;if(plan[0][0]===toKey)plan.shift();const [k,d,a]=plan.shift();toKey=k;morphAt=now;morphDur=d;fly=a;legs=plan;
  }
  function advance(now){
    if(now-morphAt<morphDur)return;
    if(fromKey!==toKey)fromKey=toKey;
    if(legs.length){const [k,d,a]=legs.shift();if(k!==toKey){toKey=k;morphAt=now;morphDur=d;fly=a;}}
  }

  // ---- the neural layer (CPU side): picking a surface point under the pointer, sparks, waves, the flinch
  const view3=()=>groupMatrices('brain',phase,new Float32Array(72)).subarray(0,9);   // the brain's model matrix, as the frame draws it
  function toNdc(p,G0){
    const x=G0[0]*p[0]+G0[3]*p[1]+G0[6]*p[2],y=G0[1]*p[0]+G0[4]*p[1]+G0[7]*p[2],z=G0[2]*p[0]+G0[5]*p[1]+G0[8]*p[2];
    const vx=Vw[0]*x+Vw[4]*y+Vw[8]*z+Vw[12],vy=Vw[1]*x+Vw[5]*y+Vw[9]*z+Vw[13],vz=Vw[2]*x+Vw[6]*y+Vw[10]*z+Vw[14];
    const cx=Pm[0]*vx,cy=Pm[5]*vy,cw=-vz;if(cw<=1e-4)return null;
    return [cx/cw+(cur?.sx||0),cy/cw+(cur?.sy||0),vz];
  }
  function facing(nv,G0){const x=G0[0]*nv[0]+G0[3]*nv[1]+G0[6]*nv[2],y=G0[1]*nv[0]+G0[4]*nv[1]+G0[7]*nv[2],z=G0[2]*nv[0]+G0[5]*nv[1]+G0[8]*nv[2];return Vw[2]*x+Vw[6]*y+Vw[10]*z;}
  // the surface marks nearest to a canvas point (CSS px), front-facing only
  function pickAt(x,y,max=1){
    if(!PS||!cur||!W)return [];
    if(!pickList){pickList=[];for(let k=0;k<PS.count;k+=3)if(PS.parts[k]<5)pickList.push(k);}
    const G0=view3(),nx=x/W*2-1,ny=1-y/H*2,asp=W/H,P=PS.forms.brain.pos,Nn=PS.forms.brain.nrm,found=[];
    for(const k of pickList){
      const p=[P[k*4],P[k*4+1],P[k*4+2]],q=toNdc(p,G0);if(!q)continue;
      if(facing([Nn[k*4],Nn[k*4+1],Nn[k*4+2]],G0)<.05)continue;
      const d=Math.hypot((q[0]-nx)*asp,q[1]-ny);found.push([d,p]);
    }
    found.sort((a,b)=>a[0]-b[0]);
    return found.slice(0,max*4).filter((_,i)=>i%4===0).slice(0,max);
  }
  function seatNdc(){return [cur?.sx||0,cur?.sy||0];}
  function addWave(x,y,amp,now){   // x,y in NDC
    waves=waves.filter(w=>now-w.at<1700);if(waves.length>=2)waves.shift();waves.push({x,y,at:now,amp});
  }
  function addSparks(points,now,{strength=1,life=1.5}={}){
    if(!PS?.fold)return;
    for(const [,p] of points)for(const dir of [1,-1]){
      if(sparks.length>=MAX_SPARKS)sparks.shift();
      sparks.push(makeSpark(p,dir,{strength,life:life*(.85+.3*Math.random()),speed:.45+.2*Math.random()}));
    }
  }
  // client coordinates → canvas CSS px. The brain's canvas is absolute in its hero and scrolls, so client y is not canvas y.
  const local=(x,y)=>{let r=null;try{r=canvas.getBoundingClientRect?.();}catch{}return [x-(r?.left||0),y-(r?.top||0)];};
  const toClientNdc=(x,y)=>{let r=null;try{r=canvas.getBoundingClientRect?.();}catch{}const cw=r?.width||W||1,ch=r?.height||H||1;return [((x-(r?.left||0))/cw)*2-1,1-((y-(r?.top||0))/ch)*2];};
  function burst(x,y,{sparkCount=3,amp=1,strength=1}={}){
    if(!scene||still())return;const now=clock();
    const has=Number.isFinite(+x)&&Number.isFinite(+y);
    const n=has?toClientNdc(+x,+y):seatNdc();
    if(live()&&PS){
      // spread: each spark starts from the fold nearest a point scattered around the target (a burst, not a blob)
      const [cx0,cy0]=has?local(+x,+y):[(seatNdc()[0]+1)/2*W,(1-seatNdc()[1])/2*H],r=has?46:(cur?.rpx||120)*.55,pts=[];
      for(let i=0;i<sparkCount;i++){const a=i/sparkCount*TAU+Math.random(),q=r*(has&&i===0?0:.45+.55*Math.random());pts.push(...pickAt(cx0+Math.cos(a)*q,cy0+Math.sin(a)*q,1));}
      addSparks(pts,now,{strength,life:1.7});
    }
    addWave(n[0],n[1],amp*(scene==='off'?.55:1),now);
    kick(true);
  }
  function flinch(){if(!scene||still())return;const now=clock();flinchAt=now;waves=waves.filter(w=>now-w.at>150);kick(true);}
  function stepNeural(now,dt){
    if(sparks.length){const F=PS?.fold,s2=[];if(F&&live())for(const s of sparks)if(stepSpark(s,dt/1000,F))s2.push(s);sparks=s2;}
    waves=waves.filter(w=>now-w.at<1700);
  }

  const attr=(loc,size,stride,off)=>{if(loc==null||loc<0)return;gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,stride,off);};
  const off=(...locs)=>{for(const l of locs)if(l!=null&&l>=0)gl.disableVertexAttribArray(l);};

  function drawParticles(now,rest){
    const c=cur,time=rest?0:phase,u=(now-pulseAt)/700,bump=!rest&&u>=0&&u<1?Math.sin(Math.PI*u)**2:0;
    const dist=c.dist*(1-.06*bump),az=(rest?0:Math.sin(time*.05)*.12)+par[0]*.14,el=(c.elev+(rest?0:2.5*Math.sin(time*.043))-par[1]*5)*DEG;
    eye[0]=dist*Math.cos(el)*Math.sin(az);eye[1]=dist*Math.sin(el);eye[2]=dist*Math.cos(el)*Math.cos(az);
    mat4.lookAt(Vw,eye,ORIGIN,UP);mat4.perspective(Pm,c.fov*DEG,bw/bh,.05,100);
    const ft=(now-flinchAt)/1000,flinchK=ft>=0&&ft<1.05?1-.58*(ft<.15?ft/.15:Math.max(0,1-(ft-.15)/.9)):1;
    const dimAll=dimNow*c.dim*(1+.2*bump)*flinchK;if(dimAll<=.002)return;
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
    const U=G.P.u,A=G.a,tan=Math.tan(c.fov*DEG/2);gl.useProgram(G.P.p);
    const m=rest?1:Math.min(1,Math.max(0,(now-morphAt)/morphDur));
    groupMatrices(rest?toKey:fromKey,time,GA);groupMatrices(toKey,time,GB);
    gl.uniformMatrix3fv(U.uGA,false,GA);gl.uniformMatrix3fv(U.uGB,false,GB);
    gl.uniformMatrix4fv(U.uView,false,Vw);gl.uniformMatrix4fv(U.uProj,false,Pm);
    gl.uniform2f(U.uShift,c.sx,c.sy);gl.uniform2f(U.uCanvas,bw,bh);gl.uniform1f(U.uTime,time);
    gl.uniform2f(U.uTan,tan*bw/bh,tan);gl.uniform2f(U.uPar,rest?0:par[0],rest?0:par[1]);
    gl.uniform1f(U.uPx,bh/(2*tan));gl.uniform1f(U.uMaxPt,G.maxPt);gl.uniform1f(U.uDpr,dpr);
    gl.uniform1f(U.uCore,Math.max(.9,.42*dpr));gl.uniform1f(U.uHaloR,.9*dpr);gl.uniform1f(U.uHaloA,.07);
    const band=.66,focus=dist-(toKey==='galaxy'?0:.36);gl.uniform1f(U.uFocus,focus);gl.uniform1f(U.uBand,band);gl.uniform1f(U.uCoc,1.1*dpr*(focus+1)/(1-band));
    // the currents: calmer at inbox zero, quicker when something is late
    gl.uniform1f(U.uDrift,rest?0:c.drift);gl.uniform1f(U.uDim,dimAll);gl.uniform1f(U.uWave,rest?0:(late?1.15:1)*(1-.45*closed));gl.uniform1f(U.uGlow,G.fmt.hdr?1:.85);
    gl.uniform3fv(U.uCol,colors);gl.uniform3fv(U.uRimA,rimA);gl.uniform3fv(U.uRimB,rimB);
    {const L=[-.46,.64,.62],l=Math.hypot(...L);gl.uniform3f(U.uLight,L[0]/l,L[1]/l,L[2]/l);}
    gl.uniform3f(U.uPointer,ptr[0],ptr[1],rest||!live()?0:ptrNow);
    // neural uniforms
    waveBuf.fill(0);if(!rest)waves.slice(-2).forEach((w,i)=>{waveBuf.set([w.x,w.y,(now-w.at)/1000,w.amp],i*4);});
    gl.uniform4fv(U.uWaves,waveBuf);
    sparkBuf.fill(0);let ns=0;
    if(!rest&&live())for(const s of sparks){const I=sparkLight(s),pts=[s.p,...s.trail],fall=[1,.62,.36];for(let j=0;j<SPARK_TRAIL&&ns<NS;j++,ns++)sparkBuf.set([pts[j][0],pts[j][1],pts[j][2],I*fall[j]],ns*4);}
    gl.uniform4fv(U.uSparks,sparkBuf);gl.uniform1f(U.uSparkN,ns);gl.uniform1f(U.uNeural,1/(.065*.065));
    const all=rects;
    if(scene==='home'&&box&&box.R>0)gl.uniform4f(U.uHole,box.cx*dpr,bh-(box.cy+box.R*.08)*dpr,box.R*.8*dpr,box.R*.62*dpr);else gl.uniform4f(U.uHole,0,0,0,0);
    const nr=Math.min(8,all.length);rectBuf.fill(0);
    for(let i=0;i<nr;i++){const r=all[i];rectBuf[i*4]=r.x*dpr;rectBuf[i*4+1]=bh-(r.y+r.h)*dpr;rectBuf[i*4+2]=(r.x+r.w)*dpr;rectBuf[i*4+3]=bh-r.y*dpr;}
    gl.uniform4fv(U.uRects,rectBuf);gl.uniform1f(U.uRectN,nr);gl.uniform1f(U.uFeather,40*dpr);
    // 1 · ambient (view space)
    const na=AMB.length/8;
    if(na>0){
      gl.uniform1f(U.uAmbient,1);gl.uniform1f(U.uSize,(mobile?MARK.phone:MARK.desktop)*.9);gl.uniform1f(U.uMorph,1);gl.uniform1f(U.uFly,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,G.bufs.amb);attr(A.aA,4,32,0);attr(A.aB,4,32,0);attr(A.aNA,4,32,16);attr(A.aNB,4,32,16);attr(A.aMeta,4,32,16);
      gl.drawArrays(gl.POINTS,0,na);
    }
    // 2 · the form: one draw call
    const n=Math.round(PS.count*(level>=DPR_STEPS.length?.6:1)*(scene==='off'?.6:1));
    gl.uniform1f(U.uAmbient,0);gl.uniform1f(U.uSize,(mobile?MARK.phone:MARK.desktop)*(toKey==='brain'&&fromKey==='brain'?.94:1));gl.uniform1f(U.uMorph,m);gl.uniform1f(U.uFly,fly);
    const fk=rest?toKey:fromKey;
    gl.bindBuffer(gl.ARRAY_BUFFER,G.bufs[fk]);attr(A.aA,4,16,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,G.bufs[toKey]);attr(A.aB,4,16,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,G.bufs['n_'+fk]);attr(A.aNA,4,16,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,G.bufs['n_'+toKey]);attr(A.aNB,4,16,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,G.bufs.meta);attr(A.aMeta,4,16,0);
    gl.drawArrays(gl.POINTS,0,n);
    // 3 · the synapses themselves: a short comet of white-hot commas along each spark's path, in the brain's frame
    if(!rest&&live()&&sparks.length&&fromKey==='brain'){
      let v=0;
      for(const s of sparks){const I=sparkLight(s),nn=s.n||[0,0,1];
        s.path.forEach((q,j)=>{const k=1-j/COMET,o=v*12;
          cometBuf.set([q[0],q[1],q[2],pack(0,j<1?5:j<3?4:3,0),nn[0],nn[1],nn[2],(.45+.6*k)*Math.min(1,I*1.2),(j*.137+v*.071)%1,0,.5,.5],o);v++;});}
      if(v){gl.uniform1f(U.uMorph,1);gl.uniform1f(U.uFly,0);gl.uniform1f(U.uDim,dimAll*1.15);gl.uniform1f(U.uSparkN,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,G.bufs.comet);gl.bufferData(gl.ARRAY_BUFFER,cometBuf.subarray(0,v*12),gl.DYNAMIC_DRAW);
        attr(A.aA,4,48,0);attr(A.aB,4,48,0);attr(A.aNA,4,48,16);attr(A.aNB,4,48,16);attr(A.aMeta,4,48,32);
        gl.drawArrays(gl.POINTS,0,v);}
      comets=v;
    }
    off(A.aA,A.aB,A.aNA,A.aNB,A.aMeta);
    return {sx:c.sx,sy:c.sy,rpx:c.rpx};
  }
  function pass(prog,target,bind){
    gl.bindFramebuffer(gl.FRAMEBUFFER,target?target.fb:null);gl.viewport(0,0,target?target.w:bw,target?target.h:bh);
    gl.useProgram(prog.p);bind(prog.u);
    gl.bindBuffer(gl.ARRAY_BUFFER,G.bufs.tri);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  const tex=(unit,t,loc)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t.tex);gl.uniform1i(loc,unit);};
  function draw(now,rest=false){
    if(!G||lost||!cur||!bw||!bh)return;
    if(!PS||builtFor!==mobile)load();else if(!G.uploaded)upload();
    if(G.post&&(!G.rt||G.rt.s.w!==bw||G.rt.s.h!==bh))buildTargets();
    const t0=clock();lastDraw=now;
    if(!rest)advance(now);
    // debug.gpu (measurement only): GPU time per frame from EXT_disjoint_timer_query_webgl2, read back a few frames later
    const tq=debug&&debug.gpu&&gl2?(G.tq??=gl.getExtension('EXT_disjoint_timer_query_webgl2')):null;let q=null;
    if(tq){q=gl.createQuery();gl.beginQuery(tq.TIME_ELAPSED_EXT,q);}
    if(G.post){
      const R=G.rt;gl.bindFramebuffer(gl.FRAMEBUFFER,R.s.fb);gl.viewport(0,0,bw,bh);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      const seat=drawParticles(now,rest);gl.disable(gl.BLEND);
      pass(G.down,R.h2,u=>{tex(0,R.s,u.uTex);gl.uniform2f(u.uTexel,1/R.s.w,1/R.s.h);});
      pass(G.down,R.q,u=>{tex(0,R.h2,u.uTex);gl.uniform2f(u.uTexel,1/R.h2.w,1/R.h2.h);});
      pass(G.blur,R.q2,u=>{tex(0,R.q,u.uTex);gl.uniform2f(u.uDir,1/R.q.w,0);});
      pass(G.blur,R.q,u=>{tex(0,R.q2,u.uTex);gl.uniform2f(u.uDir,0,1/R.q.h);});
      pass(G.down,R.e,u=>{tex(0,R.q,u.uTex);gl.uniform2f(u.uTexel,1/R.q.w,1/R.q.h);});
      pass(G.blur,R.e2,u=>{tex(0,R.e,u.uTex);gl.uniform2f(u.uDir,1.6/R.e.w,0);});
      pass(G.blur,R.e,u=>{tex(0,R.e2,u.uTex);gl.uniform2f(u.uDir,0,1.6/R.e.h);});
      const sx=seat?seat.sx:0,sy=seat?seat.sy:0,rr=seat&&seat.rpx?seat.rpx/H:.35;
      pass(G.comp,null,u=>{tex(0,R.s,u.uScene);tex(1,R.q,u.uQ);tex(2,R.e,u.uE);gl.uniform1f(u.uBloom,(G.fmt.hdr?.42:.32)*(scene==='off'?.45:1));
        gl.uniform3fv(u.uFog,paper?[0,0,0]:fogRGB.map(v=>v*dimNow*(cur?.dim??1)));gl.uniform3f(u.uHaze,sx*.5+.5,sy*.5+.5,rr*1.35);gl.uniform2f(u.uRes,bw,bh);gl.uniform1f(u.uAsp,bw/bh);
        gl.uniform1f(u.uPaper,paper);gl.uniform3fv(u.uInkA,inkA);gl.uniform3fv(u.uInkB,inkB);});
    }else{
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,bw,bh);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);drawParticles(now,rest);
    }
    if(tq){gl.endQuery(tq.TIME_ELAPSED_EXT);(G.queries??=[]).push(q);
      while(G.queries.length&&gl.getQueryParameter(G.queries[0],gl.QUERY_RESULT_AVAILABLE)){const done=G.queries.shift();
        if(!gl.getParameter(tq.GPU_DISJOINT_EXT)){gpuMs=gl.getQueryParameter(done,gl.QUERY_RESULT)/1e6;gpuTimes.push(gpuMs);if(gpuTimes.length>600)gpuTimes.shift();}gl.deleteQuery(done);}}
    if(debug&&debug.sync){const px=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);}
    drawMs=clock()-t0;framesDrawn++;
  }

  const settle=()=>{if(to)cur={...to};tweenAt=-1e9;morphAt=-1e9;legs=[];fromKey=toKey=activeForm();pulseAt=-1e9;dimNow=dimUser;prog=progGoal;closed=closedGoal;sparks=[];waves=[];flinchAt=-1e9;};
  function still_frame(){
    halt();if(!scene)return;const rest=still();settle();
    if(rest){par[0]=par[1]=parGoal[0]=parGoal[1]=0;ptrNow=ptrGoal=0;}
    draw(clock(),rest);
  }
  const idleLimit=()=>scene==='off'?(mobile?8e3:2e4):(mobile?3e4:9e4);
  function step(now,dt){
    if(to&&cur){const e=ease(Math.min(1,(now-tweenAt)/tweenDur));for(const k of KEYS)cur[k]=from&&tweening(now)?from[k]+(to[k]-from[k])*e:to[k];}
    phase+=dt/1000*(cur?.speed??1);
    dimNow=toward(dimNow,dimUser,dt/200);prog=toward(prog,progGoal,dt/700);closed=toward(closed,closedGoal,dt/700);
    const f1=1-Math.exp(-dt/380);par[0]+=(parGoal[0]-par[0])*f1;par[1]+=(parGoal[1]-par[1])*f1;
    if(now-ptrAt>(coarse?700:2500))ptrGoal=0;               // a tap's touch fades fast; a hovering mouse lingers
    ptrNow+=(ptrGoal-ptrNow)*(1-Math.exp(-dt/240));
    stepNeural(now,dt);
  }
  function setDpr(){
    const base=Math.min(view.devicePixelRatio||1,mobile?3:2);dpr=Math.max(1,base*DPR_STEPS[Math.min(level,DPR_STEPS.length-1)]);
    const nbw=Math.max(1,Math.round(W*dpr)),nbh=Math.max(1,Math.round(H*dpr));
    if(nbw!==bw||nbh!==bh){bw=nbw;bh=nbh;if(canvas.width!==bw||canvas.height!==bh){canvas.width=bw;canvas.height=bh;}}
  }
  function tick(now){
    raf=0;if(!alive||lost||!scene||doc?.hidden||away)return;
    if(still()||frozen)return still_frame();
    const quiet=now-idleAt,slowMode=scene==='off'||(quiet>15e3&&!morphing(now)&&!neural(now)),cap=slowMode?28:12;   // 60 fps on 60 and 120 Hz displays (30 when idle or in dust)
    if(lastDraw&&now-lastDraw<cap){raf=req(tick);return;}
    const gap=lastDraw?now-lastDraw:16,dt=Math.min(gap,100);
    // Governor: 50 slow points in the last 60 frames lowers the resolution (1 → .85 → .72 → .6 of native DPR), then the count, then
    // freezes. A frame is slow when it misses ~28 fps, or lands in the 20–30 ms band that marks a 60 Hz display falling behind. A clean
    // 30 Hz cadence (iOS Low Power Mode, throttled compositors) is steady and is not overload, so it does not cost resolution.
    if(lastDraw&&gap<1000){const s=gap>(slowMode?50:36)?2:(!slowMode&&gap>20&&gap<30?1:0);sum+=s-win[slot];win[slot]=s;slot=(slot+1)%60;
      if(sum>=50){win.fill(0);sum=0;level++;if(level>DPR_STEPS.length){frozen=true;return still_frame();}setDpr();}}
    step(now,dt);draw(now);
    if(!busy(now)&&quiet>idleLimit())return;
    raf=req(tick);
  }
  function kick(wake=true){
    if(!alive||lost||!scene)return;
    if(wake)idleAt=clock();
    if(still()||frozen||!view.requestAnimationFrame)return still_frame();
    if(doc?.hidden||away)return;
    win.fill(0);sum=0;slot=0;lastDraw=0;
    if(!raf)raf=req(tick);
  }
  const render=()=>{if(!scene)return;if(still()||frozen)still_frame();else{draw(clock());kick(false);}};
  const size=(w,h)=>{
    w=Math.round(+w||0);h=Math.round(+h||0);if(w===W&&h===H)return;W=w;H=h;mobile=coarse||W<760;
    setDpr();retarget();render();
  };
  const measure=()=>{if(W&&H)return;const w=canvas.clientWidth||view.innerWidth||0,h=canvas.clientHeight||view.innerHeight||0;if(w&&h)size(w,h);};

  // ---- input
  const editable=el=>!!el?.closest?.('input,textarea,select,label,[contenteditable=""],[contenteditable=true]');
  const aim=e=>{
    const vw=view.innerWidth||W||1,vh=view.innerHeight||H||1;
    parGoal[0]=Math.max(-1,Math.min(1,(e.clientX/vw)*2-1));parGoal[1]=Math.max(-1,Math.min(1,(e.clientY/vh)*2-1));
    ptr=toClientNdc(e.clientX,e.clientY);ptrGoal=1;ptrAt=clock();
  };
  // hover and drag: a lit neighbourhood, and a synapse spark from the nearest fold every 160 ms (70 ms while dragging) of travel
  const move=e=>{
    if(still()||!scene)return;
    if(scene==='off')return;                              // work screens: the dust does not follow the pointer (no wake, no cost)
    aim(e);const now=clock();
    if(live()&&now-lastSparkAt>(dragging?70:160)&&Math.hypot(e.clientX-lastSparkXY[0],e.clientY-lastSparkXY[1])>(dragging?10:26)){
      const pts=pickAt(...local(e.clientX,e.clientY),1);
      if(pts.length&&pts[0][0]<.09){lastSparkAt=now;lastSparkXY=[e.clientX,e.clientY];addSparks(pts,now,{strength:dragging?1:.8,life:1.2});}
    }
    idleAt=now;if(!raf)kick(false);
  };
  // a tap or a click sends a neural pulse wave from the point, and a few sparks from the folds under it
  const down=e=>{
    if(e.button>0)return;dragging=true;
    if(still()||!scene)return;
    if(coarse&&scene!=='off')aim(e);
    if(editable(e.target))return;
    const now=clock();
    if(waves.length&&now-waves[waves.length-1].at<250)return;
    if(scene==='off'){const n=toClientNdc(e.clientX,e.clientY);addWave(n[0],n[1],.35,now);kick(true);return;}
    burst(e.clientX,e.clientY,{sparkCount:2,amp:.9});
  };
  const up=()=>{dragging=false;};
  const scrolled=()=>{if(scene==='off')return;idleAt=clock();if(!raf)kick(false);};
  const tilt=e=>{
    if(still()||e.gamma==null||e.beta==null)return;
    const side=Math.abs(view.screen?.orientation?.angle??view.orientation??0)===90;let x=side?e.beta:e.gamma,y=side?-e.gamma:e.beta;
    if(beta0==null)beta0=y;parGoal[0]=Math.max(-1,Math.min(1,x/25));parGoal[1]=Math.max(-1,Math.min(1,(y-beta0)/25));
    if(scene==='off')return;idleAt=clock();if(!raf)kick(false);
  };
  const attachTilt=()=>{if(tilting||!view.addEventListener)return;tilting=true;view.addEventListener('deviceorientation',tilt,{passive:true});};
  // the platform's own signals: window.dispatchEvent(new CustomEvent('36t:brain',{detail:{kind:'spark'|'pulse'|'dim',x?,y?}}))
  const onBrain=e=>{const d=e?.detail||{};if(d.kind==='spark')api.spark(d.x,d.y);else if(d.kind==='pulse')api.pulse();else if(d.kind==='dim')flinch();};
  const lostGL=e=>{e?.preventDefault?.();lost=true;halt();G=null;};
  const restoredGL=()=>{G=init();lost=!G;if(G){upload();buildTargets();paint();render();}};
  const seen=()=>{if(doc?.hidden)halt();else kick(false);};
  const refresh=()=>{paint();render();};
  if(!coarse)view.addEventListener?.('pointermove',move,{passive:true});
  view.addEventListener?.('pointerdown',down,{passive:true});
  view.addEventListener?.('pointerup',up,{passive:true});view.addEventListener?.('pointercancel',up,{passive:true});
  const drag=e=>{if(dragging)move(e);};
  if(coarse)view.addEventListener?.('pointermove',drag,{passive:true});
  view.addEventListener?.('scroll',scrolled,{passive:true});
  view.addEventListener?.('36t:brain',onBrain);
  if(coarse&&view.DeviceOrientationEvent&&typeof view.DeviceOrientationEvent.requestPermission!=='function')attachTilt();
  canvas.addEventListener?.('webglcontextlost',lostGL);canvas.addEventListener?.('webglcontextrestored',restoredGL);
  doc?.addEventListener?.('visibilitychange',seen);
  pref?.addEventListener?.('change',refresh);
  const resizer=view.ResizeObserver?new view.ResizeObserver(list=>{const b=list[list.length-1]?.contentRect;if(b)size(b.width,b.height);}):null;
  const watcher=view.MutationObserver&&html?new view.MutationObserver(refresh):null;
  const eye_=view.IntersectionObserver?new view.IntersectionObserver(list=>{away=!list[list.length-1]?.isIntersecting;away?halt():kick(false);}):null;
  try{resizer?.observe(canvas);eye_?.observe(canvas);watcher?.observe(html,{attributes:true,attributeFilter:['data-theme','data-design','data-motion']});}catch{}
  paint();

  const api={
    ok:true,
    setScene(name,geo){
      if(!alive)return;const next=Object.hasOwn(SCENES,name)?name:'off',same=next===scene,now=clock();
      box=geo&&typeof geo==='object'?geo:null;mirror=box?.mirror?-1:1;measure();
      const prev=scene;scene=next;const form=activeForm();
      if(!prev){to=target();cur={...to};from=null;tweenAt=-1e9;fromKey=toKey=form;morphAt=-1e9;}
      else{from={...cur};to=target();tweenAt=now;tweenDur=same?400:1400;if(!still())morphTo(form,now);else{fromKey=toKey=form;}}
      if(next==='login'&&!same&&!still()){
        let first=false;try{first=!view.sessionStorage?.getItem('36t-depth-intro');view.sessionStorage?.setItem('36t-depth-intro','1');}catch{}
        if(first){fromKey='galaxy';toKey=form;morphAt=now+250;morphDur=2600;fly=.3;legs=[];}
      }
      if(next==='off'){pulseAt=-1e9;sparks=[];ptrGoal=0;}
      if(!raf)draw(now,still());kick(true);
    },
    setData({late:isLate=false,progress=0,closed:isClosed=false}={}){
      const g=clamp01(progress),c=isClosed?1:0,l=!!isLate;if(g===progGoal&&c===closedGoal&&l===late)return;
      progGoal=g;closedGoal=c;late=l;kick(false);
    },
    setExclusions(list){rects=(Array.isArray(list)?list:[]).filter(r=>r&&r.w>0&&r.h>0&&Number.isFinite(+r.x)&&Number.isFinite(+r.y)).slice(0,7);if(scene){retarget();if(!raf)render();}},
    dim(v=1){dimUser=clamp01(v);kick(false);},
    // a neural pulse: the camera breathes in and a wave runs across the form from its centre (repeated calls within 600 ms merge)
    pulse(){
      if(!scene||still())return;const now=clock();
      if(now-pulseAt<600)return;
      if(scene!=='off')pulseAt=now;
      const [x,y]=seatNdc();addWave(x,y,scene==='off'?.5:1,now);kick(true);
    },
    // a bright burst at a point (CSS px, client coordinates) or, without one, across the brain: sparks along the folds and a wave
    spark(x,y){burst(x,y,{sparkCount:3,amp:1.2,strength:1.25});},
    pause(){paused=true;still_frame();},
    resume(){paused=false;kick(true);},
    async enableTilt(){
      if(!alive||still())return false;const DOE=view.DeviceOrientationEvent;if(!DOE)return false;
      try{if(typeof DOE.requestPermission==='function'&&await DOE.requestPermission()!=='granted')return false;}catch{return false;}
      attachTilt();return true;
    },
    stats:()=>({dpr,level,bw,bh,count:PS?.count||0,ambient:AMB?AMB.length/8:0,hdr:!!G?.fmt?.hdr,post:!!G?.post,drawMs,gpuMs,gpuTimes:debug&&debug.gpu?gpuTimes.slice():undefined,frames:framesDrawn,form:toKey,from:fromKey,
      morph:morphing(clock()),scene,sparks:sparks.length,comets,waves:waves.length,live:live(),gl2}),
    destroy(){
      if(!alive)return;alive=false;scene=null;halt();
      view.removeEventListener?.('pointermove',move);view.removeEventListener?.('pointermove',drag);view.removeEventListener?.('pointerdown',down);view.removeEventListener?.('pointerup',up);view.removeEventListener?.('pointercancel',up);
      view.removeEventListener?.('scroll',scrolled);view.removeEventListener?.('36t:brain',onBrain);if(tilting)view.removeEventListener?.('deviceorientation',tilt);
      canvas.removeEventListener?.('webglcontextlost',lostGL);canvas.removeEventListener?.('webglcontextrestored',restoredGL);
      doc?.removeEventListener?.('visibilitychange',seen);pref?.removeEventListener?.('change',refresh);
      resizer?.disconnect();eye_?.disconnect();watcher?.disconnect();
      if(G&&!lost){try{freeTargets();for(const b of Object.values(G.bufs))gl.deleteBuffer(b);for(const p of [G.P,G.down,G.blur,G.comp])if(p)gl.deleteProgram(p.p);}catch{}}
      G=null;PS=null;AMB=null;sparks=[];waves=[];try{canvas.width=canvas.height=0;}catch{}
    }
  };
  return api;
}
