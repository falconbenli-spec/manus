// رابط السجل (الموجة 1 «ما عليّ»): ‎#screen?focus=<id>‎ يفتح الشاشة ثم يقف عند السجل نفسه ويعلّمه.
// معالج واحد عام بدل منطق لكل شاشة: أي عنصر في الشاشة يحمل data-id يساوي المعرّف هو السجل، وأقرب صف يحويه هو ما يُعلَّم.
// وحدة بلا حالة؛ parseFocus نقية تُختبر بلا DOM، وfocusRecord تأخذ الجذر الذي تبحث فيه.
const ROW='li,tr,article,details,.wk-card,.vn-block,.task,.task-row,.panel';
const MAX_ID=200;

// يفصل «screen/segment?focus=id» إلى مسار الشاشة ومعرّف السجل. معرّف فارغ أو أطول من المعقول يُهمل ولا يُرمى خطأ.
export function parseFocus(route){
  const [path='',query='']=String(route??'').replace(/^#/,'').split('?');
  let id=null;
  try{id=new URLSearchParams(query).get('focus');}catch{id=null;}
  return {path,view:path.split('/')[0],focus:id&&id.length<=MAX_ID?id:null};
}

// يقف عند السجل ويعلّمه. يعيد true إن وُجد. السجل داخل <details> مغلق يُفتح ما فوقه أولًا حتى يُرى.
export function focusRecord(root,id){
  if(!root||!id)return false;
  const escape=globalThis.CSS?.escape??(value=>String(value).replace(/["\\]/g,'\\$&'));
  const hit=root.querySelector(`[data-id="${escape(id)}"]`);
  if(!hit)return false;
  for(let node=hit.parentElement;node&&node!==root;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;
  const row=hit.closest(ROW)??hit;
  for(const old of root.querySelectorAll('.is-focused'))old.classList.remove('is-focused');
  row.classList.add('is-focused');
  if(!row.hasAttribute('tabindex'))row.setAttribute('tabindex','-1');
  row.scrollIntoView?.({block:'center'});
  row.focus?.({preventScroll:true});
  return true;
}
