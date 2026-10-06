// يرسم أيقونات التطبيق القابل للتثبيت (PNG) من شعار brand-logo.mjs نفسه، بلا رسم جديد وبلا حزمة npm.
// يلزمه متصفح Chromium محلي بلا واجهة، يُمرَّر مساره في CHROME_PATH، مثل:
//   CHROME_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell node scripts/make-icons.mjs
// الناتج في app/static/icons ويُحفظ في المستودع؛ لا يُشغَّل السكربت عند الإقلاع.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brandLogo } from '../app/static/brand-logo.mjs';

const chrome=process.env.CHROME_PATH;
if(!chrome)throw new Error('CHROME_PATH is required (a local headless Chromium)');
const out=new URL('../app/static/icons/',import.meta.url).pathname;mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(tmpdir(),'36t-icons-'));
// الخلفية فحمية والشعار بلون الورق (دليل الهوية: #353535 و#FAF9FF، والفيروزي #16A085 للّمسة فقط).
// scale: عرض الشعار نسبة من الأيقونة. القناع (maskable) يُبقي الشعار داخل دائرة الأمان (80%).
const icons=[['icon-192.png',192,.62],['icon-512.png',512,.62],['icon-maskable-512.png',512,.5],['apple-touch-icon.png',180,.6]];
try{
  for(const [name,size,scale] of icons){
    const svg=brandLogo.replace('<svg ',`<svg width="${Math.round(size*scale)}" `);
    const html=`<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px;background:#353535;overflow:hidden}body{display:grid;place-items:center;color:#FAF9FF}.bar{position:absolute;left:${Math.round(size*.2)}px;right:${Math.round(size*.2)}px;bottom:${Math.round(size*.2)}px;height:${Math.max(2,Math.round(size*.02))}px;background:#16A085;border-radius:2px}</style></head><body>${svg}<i class="bar"></i></body></html>`;
    const file=join(work,name+'.html');writeFileSync(file,html);
    execFileSync(chrome,['--headless','--disable-gpu','--hide-scrollbars','--force-device-scale-factor=1',`--window-size=${size},${size}`,`--screenshot=${join(out,name)}`,'file://'+file],{stdio:'ignore'});
    console.log('wrote',name,size);
  }
}finally{rmSync(work,{recursive:true,force:true});}
