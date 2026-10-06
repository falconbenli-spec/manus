/* /theme-boot.js — classic script, render-blocking, first script in <head>, before the stylesheets. No import, no network, no DOM read beyond <html>. */
/* Mirrors the last effective look on this device (localStorage 36t-design / 36t-theme) onto <html> before the first paint. */
/* Anything missing, blocked or outside the allowed lists falls back to depth + dark. It never throws. */
(function(){
  var D=['depth','classic','void','field','slate','studio','riwaq','yawm','markaz','classicplus'],T=['auto','dark','light'],d='depth',t='dark';
  try{var a=localStorage.getItem('36t-design'),b=localStorage.getItem('36t-theme');if(D.indexOf(a)>-1)d=a;if(T.indexOf(b)>-1)t=b;}catch(e){}
  try{var h=document.documentElement;h.setAttribute('data-design',d);h.setAttribute('data-theme',t);}catch(e){}
})();
