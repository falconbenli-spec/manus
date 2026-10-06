// أيقونات المنصة — مكتبة واحدة مرسومة بلغة SF Symbols البصرية (قرار المالك 1 أكتوبر 2026:
// «ابي الايقونات تكون نفس تصميم ولون ايقونات apple»). كل علامة هنا مرسومة يدويًا كمسار SVG أصلي
// على شبكة 24×24 بخط 1.6 ورؤوس وزوايا مدوّرة — لا نسخ ولا تتبّع لملفات Apple المرخّصة (SF Symbols
// وSF Pro)؛ «نفس التصميم» يعني اللغة البصرية نفسها لا ملفاتها. الألوان من رموز --icon-* في signature.css
// (أزرق النظام وأخضره وأحمره وبرتقاليه بوضعيه الفاتح والداكن)، والأيقونة زينة دائمًا: aria-hidden
// عليها والنص بجانبها هو الذي يُقرأ. لا سمة style ولا لون حرفي داخل الترميز — currentColor وحده،
// فتبقى سياسة CSP كما هي ولا يتغير أي سلوك.
//
// من كان يرسم حرفًا من الخط (◴ ▣ ⌘ …) صار يرسم من هنا: عشرون عائلة خدمات، واثنا عشر إجراءً سريعًا،
// وست نبرات حالة، وفئات الدليل الثماني، وأقسام محدِّد الطلب، وطيّات صفحة الخدمة — ورموز الصدَفة
// (بحث وإغلاق ومظهر…) التي كانت في app.mjs، ومكتبة hr-design.mjs كلها انتقلت إلى هذا الملف.

const PATHS={
  pause:'<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>',
  density:'<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  // ——— المكتبة العامة (كانت في hr-design.mjs، بالرسم نفسه) ———
  house:'<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>',
  sun:'<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  checklist:'<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="m3.8 6.4 1.5 1.5 2.6-2.8M3.8 11.9l1.5 1.5 2.6-2.8M3.8 17.4l1.5 1.5 2.6-2.8"/>',
  tray:'<path d="M3.5 13.5 6 5h12l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5"/>',
  bell:'<path d="M6 16.5v-5.5a6 6 0 0 1 12 0v5.5l1.7 2H4.3z"/><path d="M10 20.5a2.1 2.1 0 0 0 4 0"/>',
  calendar:'<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  building:'<path d="M4 20.5V5.5l8-2.5v17.5M12 8.5h8v12M2.5 20.5h19"/><path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2"/>',
  doc:'<path d="M14 3H7.5A2 2 0 0 0 5.5 5v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7.5z"/><path d="M14 3v4.5h4.5M9 13h6M9 17h6"/>',
  grid:'<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  cards:'<rect x="3" y="7" width="15" height="13" rx="2.5"/><path d="M7 4h11.5A2.5 2.5 0 0 1 21 6.5V16"/>',
  person:'<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  people:'<circle cx="9" cy="8" r="3.6"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.6a3.6 3.6 0 0 1 0 6.8M18 14a6 6 0 0 1 3.5 6"/>',
  clock:'<circle cx="12" cy="12" r="8.8"/><path d="M12 7v5l3.2 2"/>',
  banknote:'<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v4M18 10v4"/>',
  receipt:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  chart:'<path d="M5 20v-6M10 20V9M15 20v-4M20 20V5M3 20.5h18"/>',
  trend:'<path d="m3 16.5 6-6 4 4 7.5-7.5"/><path d="M15 7h5.5v5.5"/>',
  pie:'<path d="M12 3v9h9"/><path d="M20.5 14.8A9 9 0 1 1 9.2 3.4"/>',
  star:'<path d="m12 3.2 2.7 5.5 6 .9-4.35 4.25 1 6L12 17l-5.35 2.85 1-6L3.3 9.6l6-.9z"/>',
  book:'<path d="M4.5 5.5a2.5 2.5 0 0 1 2.5-2.5h12.5v15H7a2.5 2.5 0 0 0-2.5 2.5z"/><path d="M4.5 20.5V5.5M19.5 18v3H7"/>',
  megaphone:'<path d="M3.5 10v4h3l7.5 4.5v-13L6.5 10z"/><path d="M17 9a3.5 3.5 0 0 1 0 6M6.5 14l1.5 6"/>',
  shield:'<path d="M12 3 19.5 6v5.8c0 4.6-3.2 7.7-7.5 9.2-4.3-1.5-7.5-4.6-7.5-9.2V6z"/><path d="m9 12 2.2 2.2L15.2 10"/>',
  sparkles:'<path d="M11 3.5 12.9 9l5.6 1.9-5.6 1.9L11 18.5l-1.9-5.7-5.6-1.9L9.1 9z"/><path d="M18.5 15.5l.7 1.9 1.8.6-1.8.7-.7 1.8-.6-1.8-1.9-.7 1.9-.6z"/>',
  briefcase:'<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V7M3 12.5h18"/>',
  cart:'<path d="M3 4h2.2l2.3 11h11L21 8H6.3"/><circle cx="9" cy="19.2" r="1.3"/><circle cx="17" cy="19.2" r="1.3"/>',
  box:'<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  check:'<circle cx="12" cy="12" r="8.8"/><path d="m8 12.3 2.7 2.7L16.2 9.5"/>',
  arrows:'<path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5"/>',
  card:'<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6 15h4"/>',
  org:'<rect x="9" y="3" width="6" height="5" rx="1.5"/><rect x="2.5" y="16" width="6" height="5" rx="1.5"/><rect x="15.5" y="16" width="6" height="5" rx="1.5"/><path d="M12 8v4M5.5 16v-4h13v4"/>',
  target:'<circle cx="12" cy="12" r="8.8"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1"/>',
  sliders:'<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16.5 6.5l2 2M14.5 8.5l1.5 1.5"/>',
  flag:'<path d="M5.5 21V4"/><path d="M5.5 4.5h11l-2 4 2 4h-11"/>',
  gear:'<circle cx="12" cy="12" r="6.6"/><circle cx="12" cy="12" r="2.6"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.85 1.85M16.65 16.65l1.85 1.85M5.5 18.5l1.85-1.85M16.65 7.35l1.85-1.85"/>',
  camera:'<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2L9 3.5h6L16.5 6h2A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.6"/>',
  scale:'<path d="M12 4v16.5M7.5 20.5h9M5 7h14"/><path d="M5 7 2.5 13.5a2.8 2.8 0 0 0 5 0zM19 7l-2.5 6.5a2.8 2.8 0 0 0 5 0z"/>',
  bank:'<path d="M3.5 9.5 12 4l8.5 5.5z"/><path d="M5.5 9.5v8M9.8 9.5v8M14.2 9.5v8M18.5 9.5v8M4.5 17.5h15M3.5 20.5h17"/>',
  signed:'<path d="M14 3H7.5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7.5z"/><path d="M14 3v4.5h4.5"/><path d="M8.5 16.5c1.2-2.6 2.2-2.6 2.6-.6s1.4 1.4 2-.2 1.3-.6 2.4.6"/>',
  pulse:'<path d="M2.5 12.5h4l2.2-5.5 3.6 11 2.6-7.5 1.4 2h5.2"/>',
  lockshield:'<path d="M12 3 19.5 6v5.8c0 4.6-3.2 7.7-7.5 9.2-4.3-1.5-7.5-4.6-7.5-9.2V6z"/><rect x="9.2" y="11" width="5.6" height="4.6" rx="1.1"/><path d="M10.4 11V9.8a1.6 1.6 0 0 1 3.2 0V11"/>',
  envelope:'<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.8 7.5 8.2 6 8.2-6"/>',
  bubble:'<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z"/>',
  bubbles:'<path d="M3.5 6A2.5 2.5 0 0 1 6 3.5h8A2.5 2.5 0 0 1 16.5 6v4.5A2.5 2.5 0 0 1 14 13H9l-3 2.5V13a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M19 9a2.5 2.5 0 0 1 1.5 2.3v4.2A2.5 2.5 0 0 1 18 18v2.5L15 18h-3.5"/>',
  note:'<path d="M12.5 4.5h-6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6"/><path d="m9.5 14.5.6-3L18 3.6A1.7 1.7 0 0 1 20.4 6l-7.9 7.9z"/>',
  medal:'<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.5-1.5 7 5-2.5 5 2.5-1.5-7"/>',
  route:'<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  hourglass:'<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5"/>',
  warning:'<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.3h.01"/>',
  gauge:'<path d="M4 17a8.5 8.5 0 1 1 16 0"/><path d="m12 14 4-5.5"/><circle cx="12" cy="14.5" r="1.2"/>',
  bulb:'<path d="M10 20.5h4"/><path d="M8.5 14.5a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2v1h-5v-1c0-.8-.4-1.5-1-2z"/>',
  badge:'<circle cx="10" cy="8" r="4"/><path d="M2.5 20.5a7.5 7.5 0 0 1 12.2-5.8M18 14v6M15 17h6"/>',
  exit:'<path d="M13.5 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6.5"/><path d="M10.5 12H20M16.5 8.5 20 12l-3.5 3.5"/>',
  heart:'<path d="M12 20.5C7 17 3.5 13.9 3.5 9.9a4.4 4.4 0 0 1 8.5-1.6 4.4 4.4 0 0 1 8.5 1.6c0 4-3.5 7.1-8.5 10.6z"/>',
  around:'<circle cx="12" cy="12" r="2.8"/><path d="M4 9a8.5 8.5 0 0 1 15.5-1.5M20 15a8.5 8.5 0 0 1-15.5 1.5"/><path d="M19.8 3.8v3.9h-3.9M4.2 20.2v-3.9h3.9"/>',
  funnel:'<path d="M3.5 5h17L14 13v6.5l-4-2V13z"/>',
  calculator:'<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
  coins:'<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7"/>',
  news:'<path d="M4 5.5h13v13a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M17 9.5h3v9a2 2 0 0 1-1 1.73M7.5 9.5h6M7.5 13h6M7.5 16.5h3.5"/>',
  cycle:'<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1"/><path d="M17.8 3.5v3.6h-3.6M6.2 20.5v-3.6h3.6"/>',
  film:'<path d="M3.5 10h17v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="m3.5 10-.6-3 16.6-3.2.6 3zM7.6 6.1l2.4 3.4M12.6 5.1l2.4 3.4"/>',
  clipboard:'<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5M9 10.5h6M9 14h6M9 17.5h3.5"/>',
  qr:'<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5"/><path d="M14 14h2.5v2.5H14zM20.5 14v2.5M17.5 20.5h3V19M14 19.5v1"/>',
  layers:'<path d="m12 3.5 9 4.5-9 4.5L3 8z"/><path d="m3 12 9 4.5 9-4.5M3 16l9 4.5 9-4.5"/>',
  lock:'<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.5v2"/>',
  percent:'<path d="m6 18 12-12"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  cpu:'<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="10" y="10" width="4" height="4" rx=".8"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/>',
  stack:'<rect x="3.5" y="4" width="17" height="6.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="2"/><path d="M7 7.25h.01M7 16.75h.01M11 7.25h6M11 16.75h6"/>',
  toggle:'<rect x="2.5" y="7" width="19" height="10" rx="5"/><circle cx="16.5" cy="12" r="2.6"/>',
  // ——— رموز الصدَفة (كانت في app.mjs) ———
  close:'<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>',
  theme:'<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  design:'<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
  language:'<circle cx="12" cy="12" r="8.8"/><path d="M3.2 12h17.6M12 3.2c2.4 2.4 3.6 5.3 3.6 8.8s-1.2 6.4-3.6 8.8c-2.4-2.4-3.6-5.3-3.6-8.8s1.2-6.4 3.6-8.8z"/>',
  logout:'<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M9.5 8 5.5 12l4 4M5.5 12H15"/>',
  // ——— مرسومة لهذا العمل: ما كان حرفًا من الخط ولا رسم له ———
  terminal:'<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17"/>',
  plus:'<path d="M12 5.5v13M5.5 12h13"/>',
  tick:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert:'<circle cx="12" cy="12" r="8.8"/><path d="M12 7.5v5M12 16.2h.01"/>',
  undo:'<path d="M19 7.5H8.5a4 4 0 0 0 0 8H12"/><path d="M11.5 4 8 7.5l3.5 3.5"/>',
  question:'<circle cx="12" cy="12" r="8.8"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.9c-.7.4-1 .9-1 1.6v.4M12 16.8h.01"/>',
  plane:'<path d="M21 3.5 3.5 10.5l6.5 2.5 2.5 6.5z"/><path d="M21 3.5 10 13"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  dot:'<circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>'
};
export const ICON_NAMES=Object.freeze(Object.keys(PATHS));
// الراسم الواحد: currentColor وخط 1.6 ورؤوس مدوّرة، لا تعبئة إلا ما قُصد (dot ونصف theme)، ولا سمة style.
export const icon=(name,extra='')=>`<svg class="glyph${extra?' '+extra:''}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]||PATHS.grid}</svg>`;
// سهم الاتجاه: يقلبه CSS في الواجهة العربية (is-directional).
export const chevron=icon('chevron','is-directional');

// عشرون عائلة خدمات، عشرون علامة متمايزة تمثّل مجال العائلة لا شكلًا محايدًا؛ التكرار بين عائلتين يُبطل
// الغرض فتحرسه tests/icons.test.mjs. العائلة من بادئة رمز الخدمة (HR- وADM- وIT-…)، وما لا بادئة
// معروفة له يأخذ النقطة المحايدة فلا تُخترع له علامة تدّعي تصنيفًا.
export const FAMILY_ICONS=Object.freeze({HR:'person',ADM:'building',IT:'terminal',EXP:'receipt',
  FIN:'banknote',LEG:'scale',PRO:'film',ACC:'people',GOV:'flag',DAT:'chart',PRC:'cart',DIG:'target',
  PMO:'clipboard',CRT:'sparkles',STR:'route',PR:'megaphone',INF:'star',CRM:'bubbles',BRAND:'medal',TAL:'badge'});
export const familyIcon=code=>{const name=FAMILY_ICONS[String(code??'').split('-')[0].toUpperCase()];
  return name?icon(name,'is-tinted'):icon('dot');};

// الإجراءات السريعة في الرئيسية: كل مفتاح في quickActions له علامة تقول فعله.
export const QUICK_ICONS=Object.freeze({leave:'calendar',letter:'envelope',payslip:'banknote',
  correction:'clock',service:'plus',policy:'question',expense:'receipt',custody:'box',
  overtime:'hourglass',mission:'plane',training:'book',case:'scale'});
export const quickIcon=key=>{const name=QUICK_ICONS[key];return name?icon(name,'is-tinted'):icon('dot');};

// نبرات قرص الحالة الست: الشكل مع الكلمة دائمًا — اللون لا يحمل المعنى وحده (القرص يبقى شكلًا وكلمة)،
// ولون النظام يُعطى فقط حيث العلامة نفسها دلالية: الأخضر للمنجَز، والأحمر للمرفوض، والبرتقالي لما ينتظر قرارًا.
export const STATUS_ICONS=Object.freeze({'is-decide':['alert','is-warning'],'is-return':['undo',''],
  'is-do':['tick','is-tinted'],'is-run':['cycle','is-tinted'],'is-done':['check','is-positive'],'is-reject':['close','is-negative']});
export const statusIcon=tone=>{const entry=STATUS_ICONS[tone];return entry?icon(entry[0],entry[1]):icon('dot');};

// فئات دليل الخدمات الثماني (catalog-home-ui.mjs).
export const CATEGORY_ICONS=Object.freeze({my_time:'clock',my_documents:'doc',my_pay:'banknote',
  my_workplace:'building',my_growth:'trend',my_projects:'briefcase',purchasing:'cart',governance:'shield'});
export const categoryIcon=key=>icon(CATEGORY_ICONS[key]??'grid','is-tinted');

// نفس نوع الإجازة يحمل الرمز نفسه في بوابة الموظف وشاشة الإجازات.
export const LEAVE_ICONS=Object.freeze({sun:'sun',heart:'heart',baby:'badge',star:'star',rings:'around',book:'book',moon:'theme',clock:'clock',alert:'alert',care:'pulse',pause:'hourglass',medical:'plus',calendar:'calendar'});
