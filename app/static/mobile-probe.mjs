// TP2.5 — مسبار تخطيط الجوال، بلا تبعيات.
//
// لماذا إطار لا نافذة: الإطار من الأصل نفسه فتُقرأ وثيقته مباشرة، والعرض يُفرض بالبكسل فلا يعتمد
// على جهاز ولا على أداة خارجية. والقياس `scrollWidth − clientWidth` على عنصر الجذر: هو السحب
// الأفقي بعينه الذي يشكو منه القارئ، لا تقديرٌ له.
//
// وحدوده تُقال: يقيس التخطيط لا القراءة. جدولٌ لا يتمدد قد يكون مع ذلك غير مقروء عند 360 بكسل.
const WIDTHS = [360, 390, 414];
const SETTLE_MS = 900;

const stage = document.getElementById('stage');
const body = document.querySelector('#out tbody');
const progress = document.getElementById('progress');

async function screens() {
  const { operationModules } = await import('/operations.mjs');
  // الشاشات المدمجة ليست في السجل، وهي أكثر ما يُفتح.
  const builtin = ['home', 'inbox', 'work', 'requests', 'services', 'notifications', 'my-profile', 'departments', 'org'];
  return [...new Set([...builtin, ...Object.keys(operationModules)])].sort();
}

function measure(view, width) {
  return new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.width = String(width);
    frame.src = '/#' + view;
    let done = false;
    const finish = value => { if (done) return; done = true; frame.remove(); resolve(value); };
    frame.addEventListener('load', () => setTimeout(() => {
      try {
        const root = frame.contentDocument?.documentElement;
        finish(root ? Math.max(0, root.scrollWidth - root.clientWidth) : null);
      } catch { finish(null); }   // أصل مختلف: لا يقع هنا، ويُقال null لا صفرًا
    }, SETTLE_MS));
    setTimeout(() => finish(null), SETTLE_MS + 8000);
    stage.append(frame);
  });
}

document.getElementById('run').addEventListener('click', async event => {
  event.target.disabled = true;
  const views = await screens();
  const result = { at: new Date().toISOString(), widths: WIDTHS, screens: {} };
  document.getElementById('out').hidden = false;
  for (const [index, view] of views.entries()) {
    progress.textContent = `${index + 1} من ${views.length}: ${view}`;
    const row = [];
    for (const width of WIDTHS) row.push(await measure(view, width));
    result.screens[view] = row;
    const cells = row.map(value => value === null ? '<td>—</td>'
      : `<td class="num ${value > 0 ? 'bad' : 'ok'}">${value}</td>`).join('');
    body.insertAdjacentHTML('beforeend', `<tr><td>${view}</td>${cells}</tr>`);
  }
  // السقف: عدد (شاشة، عرض) التي تتمدد. ينزل ولا يصعد.
  result.overflowing = Object.values(result.screens).flat().filter(value => value > 0).length;
  result.unmeasured = Object.values(result.screens).flat().filter(value => value === null).length;
  progress.textContent = `انتهى: ${result.overflowing} حالة تمدد، و${result.unmeasured} لم تُقس.`;
  document.getElementById('jsonHead').hidden = false;
  const out = document.getElementById('json');
  out.hidden = false;
  out.textContent = JSON.stringify(result, null, 1);
  out.scrollIntoView({ behavior: 'smooth' });
});
