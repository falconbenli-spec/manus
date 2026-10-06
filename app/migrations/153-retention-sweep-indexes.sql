-- فهرسا أول قاعدة احتفاظ تُطبَّق فعلًا على المنصة (app/workflow-sweep.mjs: sweepRetention).
-- الكنس اليومي يحذف بـ`expires_at<?` من sessions وبـ`window_start<?` من login_attempts، وبلا فهرس
-- كلٌّ منهما مسحٌ كامل للجدول داخل معاملة المهمة. الجدولان صغيران اليوم — عشرات الصفوف — لكنهما
-- ينموان بعدد مرات الدخول، ولم يكن في المستودع قبل اليوم ما يقلّمهما أبدًا، فنمَوا منذ أول يوم.
-- لا عمود يُضاف ولا صفّ يُمسّ ولا مُطلِق: فهرسان فقط، فالترحيل آمن على قاعدة التشغيل.
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX login_attempts_window ON login_attempts(window_start);
