// تاريخ مزدوج: الميلادي كما هو مخزن، والهجري بتقويم أم القرى المحسوب. الرؤية الرسمية قد تختلف يومًا، فالهجري هنا للعرض لا للاحتساب.
const formatter=new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const riyadhFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'});
export const riyadhDay=iso=>{const v=String(iso??'');return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:v?riyadhFmt.format(new Date(v)):'';};
export function hijri(iso){
  if(typeof iso!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(iso))return '';
  const time=Date.parse(iso.slice(0,10)+'T00:00:00Z');return Number.isNaN(time)?'':formatter.format(new Date(time));
}
export const dual=iso=>{const h=hijri(iso);return h?`${iso.slice(0,10)} · ${h}`:String(iso??'');};
