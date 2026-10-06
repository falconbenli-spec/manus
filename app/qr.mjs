// مولّد رمز QR بلا مكتبات: وضع البايت، مستوى التصحيح M، الإصدارات 1–25 (حتى 715 بايت تقريبًا)، وفق ISO/IEC 18004.
// يُستخدم لطباعة رمز الفاتورة الضريبية (TLV) داخل المنصة دون خدمة خارجية.
const EXP=new Uint8Array(512),LOG=new Uint8Array(256);
{let x=1;for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&0x100)x^=0x11d;}for(let i=255;i<512;i++)EXP[i]=EXP[i-255];}
const gfMul=(a,b)=>a&&b?EXP[LOG[a]+LOG[b]]:0;
function generator(degree){let poly=[1];for(let i=0;i<degree;i++){const next=new Array(poly.length+1).fill(0);for(let j=0;j<poly.length;j++){next[j]^=poly[j];next[j+1]^=gfMul(poly[j],EXP[i]);}poly=next;}return poly;}
export function reedSolomon(data,degree){
  const gen=generator(degree),rem=new Array(degree).fill(0);
  for(const byte of data){const factor=byte^rem.shift();rem.push(0);for(let i=0;i<degree;i++)rem[i]^=gfMul(gen[i+1],factor);}
  return rem;
}
// المستوى M: [كلمات التصحيح لكل كتلة، عدد كتل المجموعة 1، كلمات بياناتها، عدد كتل المجموعة 2، كلمات بياناتها]
const LEVEL_M=[null,[10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],[16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44],
  [30,1,50,4,51],[22,6,36,2,37],[22,8,37,1,38],[24,4,40,5,41],[24,5,41,5,42],[28,7,45,3,46],[28,10,46,1,47],[26,9,43,4,44],[26,3,44,11,45],[26,3,41,13,42],
  [26,17,42,0,0],[28,17,46,0,0],[28,4,47,14,48],[28,6,45,14,46],[28,8,47,13,48]];
const ALIGNMENT=[null,[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],
  [6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110]];
const capacity=version=>{const [,b1,d1,b2,d2]=LEVEL_M[version];return b1*d1+b2*d2;};
function bch(value,poly,polyBits,shift){let rem=value<<shift;for(let i=value.toString(2).length+shift-1;i>=shift;i--)if(rem>>>i&1)rem^=poly<<(i-shift);return rem;}
export const formatBits=mask=>{const data=(0b00<<3)|mask;let rem=data<<10;for(let i=14;i>=10;i--)if(rem>>>i&1)rem^=0x537<<(i-10);return ((data<<10)|rem)^0x5412;};
export const versionBits=version=>{let rem=version<<12;for(let i=17;i>=12;i--)if(rem>>>i&1)rem^=0x1f25<<(i-12);return (version<<12)|rem;};

function codewords(bytes,version){
  const total=capacity(version),bits=[],push=(value,length)=>{for(let i=length-1;i>=0;i--)bits.push(value>>>i&1);};
  push(0b0100,4);push(bytes.length,version<10?8:16);for(const b of bytes)push(b,8);
  push(0,Math.min(4,total*8-bits.length));while(bits.length%8)bits.push(0);
  const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((n,b)=>n<<1|b,0));
  for(let pad=0xec;data.length<total;pad^=0xec^0x11)data.push(pad);
  const [ec,b1,d1,b2,d2]=LEVEL_M[version],blocks=[];let offset=0;
  for(const [count,size] of [[b1,d1],[b2,d2]])for(let i=0;i<count;i++){const block=data.slice(offset,offset+size);offset+=size;blocks.push({data:block,ec:reedSolomon(block,ec)});}
  const out=[];
  for(let i=0;i<Math.max(d1,d2);i++)for(const b of blocks)if(i<b.data.length)out.push(b.data[i]);
  for(let i=0;i<ec;i++)for(const b of blocks)out.push(b.ec[i]);
  return out;
}
const MASKS=[(r,c)=>(r+c)%2===0,(r)=>r%2===0,(r,c)=>c%3===0,(r,c)=>(r+c)%3===0,(r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,(r,c)=>r*c%2+r*c%3===0,(r,c)=>(r*c%2+r*c%3)%2===0,(r,c)=>((r+c)%2+r*c%3)%2===0];
function blank(version){
  const size=version*4+17,modules=Array.from({length:size},()=>new Array(size).fill(false)),reserved=Array.from({length:size},()=>new Array(size).fill(false));
  const set=(r,c,dark)=>{if(r<0||c<0||r>=size||c>=size)return;modules[r][c]=dark;reserved[r][c]=true;};
  const finder=(row,col)=>{for(let r=-1;r<=7;r++)for(let c=-1;c<=7;c++){const inside=r>=0&&r<=6&&c>=0&&c<=6;set(row+r,col+c,inside&&(r===0||r===6||c===0||c===6||(r>=2&&r<=4&&c>=2&&c<=4)));}};
  finder(0,0);finder(0,size-7);finder(size-7,0);
  const centres=ALIGNMENT[version];
  for(const r of centres)for(const c of centres){if((r===6&&c===6)||(r===6&&c===size-7)||(r===size-7&&c===6))continue;for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++)set(r+dr,c+dc,Math.max(Math.abs(dr),Math.abs(dc))!==1);}
  for(let i=8;i<size-8;i++){if(!reserved[6][i])set(6,i,i%2===0);if(!reserved[i][6])set(i,6,i%2===0);}
  for(let i=0;i<9;i++){if(!reserved[8][i])set(8,i,false);if(!reserved[i][8])set(i,8,false);}
  for(let i=0;i<8;i++){set(8,size-1-i,false);set(size-1-i,8,false);}
  set(size-8,8,true);
  if(version>=7){const bits=versionBits(version);for(let i=0;i<18;i++){const dark=(bits>>>i&1)===1,a=Math.floor(i/3),b=size-11+i%3;set(a,b,dark);set(b,a,dark);}}
  return {size,modules,reserved};
}
function placeFormat(modules,size,mask){
  const bits=formatBits(mask),bit=i=>(bits>>>i&1)===1;
  for(let i=0;i<=5;i++)modules[8][i]=bit(14-i);modules[8][7]=bit(8);modules[8][8]=bit(7);modules[7][8]=bit(6);for(let i=9;i<=14;i++)modules[14-i][8]=bit(14-i);
  for(let i=0;i<=6;i++)modules[size-1-i][8]=bit(14-i);for(let i=7;i<=14;i++)modules[8][size-15+i]=bit(14-i);
  modules[size-8][8]=true;
}
function penalty(m,size){
  let score=0;
  const runs=line=>{let run=1;for(let i=1;i<=size;i++){if(i<size&&line(i)===line(i-1))run++;else{if(run>=5)score+=run-2;run=1;}}};
  for(let r=0;r<size;r++){runs(i=>m[r][i]);runs(i=>m[i][r]);}
  for(let r=0;r<size-1;r++)for(let c=0;c<size-1;c++)if(m[r][c]===m[r][c+1]&&m[r][c]===m[r+1][c]&&m[r][c]===m[r+1][c+1])score+=3;
  const pattern=[true,false,true,true,true,false,true,false,false,false,false],match=(get,start,reverse)=>pattern.every((p,i)=>get(start+(reverse?10-i:i))===p);
  for(let r=0;r<size;r++)for(let c=0;c<=size-11;c++){if(match(i=>m[r][i],c,false)||match(i=>m[r][i],c,true))score+=40;if(match(i=>m[i][r],c,false)||match(i=>m[i][r],c,true))score+=40;}
  let dark=0;for(const row of m)for(const cell of row)if(cell)dark++;
  return score+Math.floor(Math.abs(dark*100/(size*size)-50)/5)*10;
}
// النتيجة مصفوفة منطقية: true = وحدة داكنة. forcedMask للاختبار فقط.
export function qrMatrix(text,forcedMask=null){
  const bytes=[...Buffer.from(String(text),'utf8')];
  let version=1;while(version<=25&&bytes.length>capacity(version)-(version<10?2:3))version++;
  if(version>25)throw new Error('QR payload is too long');
  const stream=codewords(bytes,version),{size,modules,reserved}=blank(version),bits=[];
  for(const word of stream)for(let i=7;i>=0;i--)bits.push(word>>>i&1);
  let index=0,upward=true;
  for(let right=size-1;right>=1;right-=2){
    if(right===6)right=5;
    for(let step=0;step<size;step++){const r=upward?size-1-step:step;for(const c of [right,right-1])if(!reserved[r][c]){modules[r][c]=index<bits.length&&bits[index]===1;index++;}}
    upward=!upward;
  }
  let best=null;
  for(let mask=0;mask<8;mask++){
    if(forcedMask!==null&&mask!==forcedMask)continue;
    const candidate=modules.map((row,r)=>row.map((cell,c)=>reserved[r][c]?cell:cell!==MASKS[mask](r,c)));
    placeFormat(candidate,size,mask);
    const score=penalty(candidate,size);if(!best||score<best.score)best={score,mask,matrix:candidate};
  }
  return {version,size,mask:best.mask,matrix:best.matrix};
}
// SVG بخلفية بيضاء ومنطقة هادئة من أربع وحدات. لا أنماط مضمنة، فيعمل تحت سياسة المحتوى الصارمة.
export function qrSvg(text,{scale=4}={}){
  const {size,matrix}=qrMatrix(text),quiet=4,full=size+quiet*2;let path='';
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(matrix[r][c])path+=`M${c+quiet} ${r+quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full*scale}" height="${full*scale}" shape-rendering="crispEdges" role="img" aria-label="رمز الاستجابة السريعة"><rect width="${full}" height="${full}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
