-- سجل المخالفات والجزاءات (P1-01، REF-APP-BACKEND و§3.3–3.4 في REF-APP-WORKFLOWS): اللائحة م111–م126 وجداولها الملحقة.
-- المنصة تقترح الجزاء ولا توقعه: التسجيل ثم التحقيق ثم الثبوت ثم قرار صاحب الصلاحية (غير المسجِّل وغير صاحب الشأن)،
-- ثم الإبلاغ الكتابي، ثم التظلم. الأثر المالي يصل المسير حركة «مقترحة» فقط يعتمدها معتمد الرواتب.

-- 1) جدول الجزاءات. الصف بلا tenant_id مستخرج اللائحة كما تقترحه المنصة (مسودة دائمة لا تُعدَّل، كأنواع الخطابات الأساسية).
-- لا يسري على كيان إلا نسخة للكيان يقبلها حامل hr.policy.accept بتاريخ سريان؛ من أعد النسخة لا يقبلها.
-- كل صف يحمل رقم البند والصفحة، والخانتان غير المؤكدتين موسومتان (uncertain) إلى أن تُطابقا مع ملف PDF الموقع.
CREATE TABLE discipline_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  source_id TEXT REFERENCES discipline_schedules(id),
  title TEXT NOT NULL CHECK(length(trim(title))>=3),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  parameters TEXT NOT NULL CHECK(json_valid(parameters)),
  confirmations TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(confirmations)),
  effective_from TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft','accepted','rejected')),
  prepared_by TEXT REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  -- مقترح المنصة مسودة بلا معد بشري ولا يُقبل في مكانه؛ قبوله نسخة للكيان.
  CHECK(tenant_id IS NOT NULL OR (status='draft' AND prepared_by IS NULL AND source_id IS NULL)),
  CHECK(status='draft' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK(status<>'accepted' OR effective_from IS NOT NULL),
  CHECK(decided_by IS NULL OR prepared_by IS NULL OR decided_by<>prepared_by)
) STRICT;
CREATE INDEX discipline_schedules_active ON discipline_schedules(tenant_id,status,effective_from);
CREATE TRIGGER discipline_schedules_fixed BEFORE UPDATE ON discipline_schedules
WHEN OLD.tenant_id IS NULL OR OLD.status<>'draft' OR NEW.version<>OLD.version+1 OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.prepared_by IS NOT OLD.prepared_by OR NEW.source_id IS NOT OLD.source_id
BEGIN SELECT RAISE(ABORT,'the regulation extract and decided schedules are replaced by a new dated schedule, never edited'); END;
CREATE TRIGGER discipline_schedules_no_delete BEFORE DELETE ON discipline_schedules BEGIN SELECT RAISE(ABORT,'schedules are retained'); END;
INSERT INTO discipline_schedules(id,tenant_id,title,basis,parameters,status,created_at) VALUES(
  'discipline-regulation-v1',NULL,
  'جدول المخالفات والجزاءات — مستخرج اللائحة (مسودة للمطابقة)',
  'لائحة تنظيم العمل المعتمدة (رقم 351743): المواد 111–126 وجداول المخالفات والجزاءات الملحقة (ص 42–51). استُخرج النص من PDF ببعض السطور والأرقام المعكوسة؛ الخانتان U1 وU2 غير مؤكدتين.',
  '{
 "source":"لائحة تنظيم العمل المعتمدة من وزارة الموارد البشرية (رقم 351743)، الصفحات 37–51",
 "repeat_window_days":180,
 "articles":{"repeat_window_days":"م114","fine_cap_days_per_violation":"م116","monthly_fine_cap_days":"م116","minor_max_day_bp":"م117، م126/1","investigation_limit_days":"م119","decision_limit_days":"م120","grievance_filing_days":"م126/2","grievance_answer_days":"م126/2","day_basis_days":"م5، م50/1"},
 "fine_cap_days_per_violation":5,
 "monthly_fine_cap_days":5,
 "minor_max_day_bp":10000,
 "investigation_limit_days":30,
 "decision_limit_days":30,
 "grievance_filing_days":30,
 "grievance_answer_days":15,
 "defence_wait_days":3,
 "day_basis_days":30,
 "wage_components":["basic","housing","transport","other_allowance"],
 "open_values":["defence_wait_days","wage_components"],
 "uncertain":[
  {"id":"U1","rows":["A01","A02","A03","A04","A05"],"ar":"خانة «بالإضافة إلى حسم أجر دقائق التأخر» ظهرت في النص المستخرج بعد البند 6 وحده؛ هل هي خانة مدمجة تغطي البنود 1–6؟","en":"The cell \"plus deduction of the late minutes\" appears in the extracted text after item 6 only. Is it a merged cell covering items 1–6?"},
  {"id":"U2","rows":["A11"],"ar":"لا تظهر خانة «حسم أجر مدة الغياب» بعد البند 11 (غياب يوم) في النص المستخرج؛ هل يشمل البند 11 حسم أجر يوم الغياب؟","en":"No \"deduct the absence period\" cell appears after item 11 (one-day absence). Does item 11 include deducting that day’s wage?"}
 ],
 "rows":[
  {"code":"A01","table":"A","item":1,"page":42,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 1 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 1 (annexed schedule, Art. 112)","ar":"التأخر عن مواعيد الحضور للعمل لغاية 15 دقيقة دون إذن أو عذر مقبول، إذا لم يترتب على ذلك تعطيل عمال آخرين","en":"Late arrival of up to 15 minutes without permission or an acceptable excuse, not disrupting other workers","penalties":["warning","fine:500","fine:1000","fine:2000"],"extra_deduction":"late_time","uncertain":"U1","note_ar":"","note_en":""},
  {"code":"A02","table":"A","item":2,"page":42,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 2 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 2 (annexed schedule, Art. 112)","ar":"التأخر عن مواعيد الحضور للعمل لغاية 15 دقيقة دون إذن أو عذر مقبول، إذا ترتب على ذلك تعطيل عمال آخرين","en":"Late arrival of up to 15 minutes without permission or an acceptable excuse, disrupting other workers","penalties":["warning","fine:1500","fine:2500","fine:5000"],"extra_deduction":"late_time","uncertain":"U1","note_ar":"","note_en":""},
  {"code":"A03","table":"A","item":3,"page":42,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 3 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 3 (annexed schedule, Art. 112)","ar":"التأخر عن مواعيد الحضور للعمل أكثر من 15 دقيقة لغاية 30 دقيقة دون إذن أو عذر مقبول، إذا لم يترتب على ذلك تعطيل عمال آخرين","en":"Late arrival of more than 15 and up to 30 minutes without permission or an acceptable excuse, not disrupting other workers","penalties":["fine:1000","fine:1500","fine:2500","fine:5000"],"extra_deduction":"late_time","uncertain":"U1","note_ar":"","note_en":""},
  {"code":"A04","table":"A","item":4,"page":43,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 4 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 4 (annexed schedule, Art. 112)","ar":"التأخر عن مواعيد الحضور للعمل أكثر من 15 دقيقة لغاية 30 دقيقة دون إذن أو عذر مقبول، إذا ترتب على ذلك تعطيل عمال آخرين","en":"Late arrival of more than 15 and up to 30 minutes without permission or an acceptable excuse, disrupting other workers","penalties":["fine:2500","fine:5000","fine:7500","fine:10000"],"extra_deduction":"late_time","uncertain":"U1","note_ar":"","note_en":""},
  {"code":"A05","table":"A","item":5,"page":43,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 5 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 5 (annexed schedule, Art. 112)","ar":"التأخر عن مواعيد الحضور للعمل أكثر من 30 دقيقة لغاية 60 دقيقة دون إذن أو عذر مقبول، إذا لم يترتب على ذلك تعطيل عمال آخرين","en":"Late arrival of more than 30 and up to 60 minutes without permission or an acceptable excuse, not disrupting other workers","penalties":["fine:2500","fine:5000","fine:7500","fine:10000"],"extra_deduction":"late_time","uncertain":"U1","note_ar":"","note_en":""},
  {"code":"A06","table":"A","item":6,"page":43,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 6 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 6 (annexed schedule, Art. 112)","ar":"التأخر عن مواعيد الحضور للعمل أكثر من 30 دقيقة لغاية 60 دقيقة دون إذن أو عذر مقبول، إذا ترتب على ذلك تعطيل عمال آخرين","en":"Late arrival of more than 30 and up to 60 minutes without permission or an acceptable excuse, disrupting other workers","penalties":["fine:3000","fine:5000","fine:10000","fine:20000"],"extra_deduction":"late_time","uncertain":null,"note_ar":"","note_en":""},
  {"code":"A07","table":"A","item":7,"page":43,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 7 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 7 (annexed schedule, Art. 112)","ar":"التأخر عن مواعيد الحضور للعمل لمدة تزيد على ساعة دون إذن أو عذر مقبول، سواء ترتب على ذلك تعطيل عمال آخرين أو لم يترتب","en":"Late arrival of more than one hour without permission or an acceptable excuse, whether or not other workers are disrupted","penalties":["warning","fine:10000","fine:20000","fine:30000"],"extra_deduction":"late_time","uncertain":null,"note_ar":"","note_en":""},
  {"code":"A08","table":"A","item":8,"page":43,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 8 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 8 (annexed schedule, Art. 112)","ar":"ترك العمل أو الانصراف قبل الميعاد دون إذن أو عذر مقبول بما لا يتجاوز 15 دقيقة","en":"Leaving work before the set time without permission or an acceptable excuse, by no more than 15 minutes","penalties":["warning","fine:1000","fine:2500","fine:10000"],"extra_deduction":"left_time","uncertain":null,"note_ar":"","note_en":""},
  {"code":"A09","table":"A","item":9,"page":44,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 9 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 9 (annexed schedule, Art. 112)","ar":"ترك العمل أو الانصراف قبل الميعاد دون إذن أو عذر مقبول بما يتجاوز 15 دقيقة","en":"Leaving work before the set time without permission or an acceptable excuse, by more than 15 minutes","penalties":["fine:1000","fine:2500","fine:5000","fine:10000"],"extra_deduction":"left_time","uncertain":null,"note_ar":"","note_en":""},
  {"code":"A10","table":"A","item":10,"page":44,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 10 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 10 (annexed schedule, Art. 112)","ar":"البقاء في أماكن العمل أو العودة إليها بعد انتهاء مواعيد العمل دون إذن مسبق","en":"Staying at or returning to the workplace after working hours without prior permission","penalties":["warning","fine:1000","fine:2500","fine:10000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"A11","table":"A","item":11,"page":44,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 11 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 11 (annexed schedule, Art. 112)","ar":"الغياب دون إذن كتابي أو عذر مقبول لمدة يوم خلال السنة العقدية الواحدة","en":"Absence of one day without written permission or an acceptable excuse in one contract year","penalties":["fine:20000","fine:30000","fine:40000","deprivation"],"extra_deduction":"absence_time","uncertain":"U2","note_ar":"","note_en":""},
  {"code":"A12","table":"A","item":12,"page":44,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 12 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 12 (annexed schedule, Art. 112)","ar":"الغياب المتصل دون إذن كتابي أو عذر مقبول من يومين إلى ستة أيام خلال السنة العقدية الواحدة","en":"Continuous absence of two to six days without written permission or an acceptable excuse in one contract year","penalties":["fine:20000","fine:30000","fine:40000","deprivation"],"extra_deduction":"absence_time","uncertain":null,"note_ar":"","note_en":""},
  {"code":"A13","table":"A","item":13,"page":44,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 13 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 13 (annexed schedule, Art. 112)","ar":"الغياب المتصل دون إذن كتابي أو عذر مقبول من سبعة أيام إلى عشرة أيام خلال السنة العقدية الواحدة","en":"Continuous absence of seven to ten days without written permission or an acceptable excuse in one contract year","penalties":["fine:40000","fine:50000","deprivation","dismissal_award"],"extra_deduction":"absence_time","uncertain":null,"note_ar":"العقوبة الرابعة (الفصل مع المكافأة) مشروطة بألا يتجاوز مجموع الغياب 30 يومًا.","note_en":"The fourth penalty (dismissal with award) applies only if total absence does not exceed 30 days."},
  {"code":"A14","table":"A","item":14,"page":45,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 14 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 14 (annexed schedule, Art. 112)","ar":"الغياب المتصل دون إذن كتابي أو عذر مقبول من أحد عشر يومًا إلى أربعة عشر يومًا خلال السنة العقدية الواحدة","en":"Continuous absence of eleven to fourteen days without written permission or an acceptable excuse in one contract year","penalties":["fine:50000","deprivation","dismissal_no_award",null],"extra_deduction":"absence_time","uncertain":null,"note_ar":"العقوبة الثانية يرافقها إنذار بالفصل طبقًا للمادة الثمانين من نظام العمل. لا عقوبة رابعة في الجدول.","note_en":"The second penalty comes with a warning of dismissal under Labour Law Art. 80. The table has no fourth penalty."},
  {"code":"A15","table":"A","item":15,"page":45,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 15 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 15 (annexed schedule, Art. 112)","ar":"الانقطاع عن العمل دون سبب مشروع مدة تزيد على خمسة عشر يومًا متصلة خلال السنة العقدية الواحدة","en":"Absence without legitimate cause for more than fifteen continuous days in one contract year","penalties":["dismissal_no_award"],"extra_deduction":null,"uncertain":null,"note_ar":"يسبقه إنذار كتابي بعد الغياب مدة عشرة أيام، في نطاق حكم المادة الثمانين من نظام العمل.","note_en":"Must be preceded by a written warning after ten days of absence, within Labour Law Art. 80."},
  {"code":"A16","table":"A","item":16,"page":45,"article_ar":"مخالفات تتعلق بمواعيد العمل، البند 16 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Working-time violations, item 16 (annexed schedule, Art. 112)","ar":"الغياب المتقطع دون سبب مشروع مددًا تزيد في مجموعها على ثلاثين يومًا خلال السنة العقدية الواحدة","en":"Intermittent absence without legitimate cause totalling more than thirty days in one contract year","penalties":["dismissal_no_award"],"extra_deduction":null,"uncertain":null,"note_ar":"يسبقه إنذار كتابي بعد الغياب مدة عشرين يومًا، في نطاق حكم المادة الثمانين من نظام العمل.","note_en":"Must be preceded by a written warning after twenty days of absence, within Labour Law Art. 80."},
  {"code":"B01","table":"B","item":1,"page":46,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 1 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 1 (annexed schedule, Art. 112)","ar":"التواجد دون مبرر في غير مكان العمل المخصص للعامل أثناء وقت الدوام","en":"Being away from the assigned place of work during working hours without justification","penalties":["fine:1000","fine:2500","fine:5000","fine:10000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B02","table":"B","item":2,"page":46,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 2 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 2 (annexed schedule, Art. 112)","ar":"استقبال زائرين في غير أمور عمل المنشأة في أماكن العمل دون إذن من الإدارة","en":"Receiving visitors on non-work matters at the workplace without management permission","penalties":["warning","fine:1000","fine:1500","fine:2500"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B03","table":"B","item":3,"page":46,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 3 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 3 (annexed schedule, Art. 112)","ar":"استعمال آلات ومعدات وأدوات المنشأة لأغراض خاصة دون إذن","en":"Using company machines, equipment or tools for private purposes without permission","penalties":["warning","fine:1000","fine:2500","fine:5000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B04","table":"B","item":4,"page":46,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 4 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 4 (annexed schedule, Art. 112)","ar":"تدخل العامل دون وجه حق في أي عمل ليس في اختصاصه أو لم يعهد به إليه","en":"Interfering without right in work outside one’s duties or not assigned to one","penalties":["fine:5000","fine:10000","fine:20000","fine:30000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B05","table":"B","item":5,"page":46,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 5 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 5 (annexed schedule, Art. 112)","ar":"الخروج أو الدخول من غير المكان المخصص لذلك","en":"Leaving or entering by a place other than the one designated","penalties":["warning","fine:1000","fine:1500","fine:2500"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B06","table":"B","item":6,"page":46,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 6 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 6 (annexed schedule, Art. 112)","ar":"الإهمال في تنظيف الآلات وصيانتها أو عدم العناية بها أو عدم التبليغ عما بها من خلل","en":"Neglecting to clean or maintain machines, or failing to report a fault in them","penalties":["fine:5000","fine:10000","fine:20000","fine:30000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B07","table":"B","item":7,"page":47,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 7 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 7 (annexed schedule, Art. 112)","ar":"عدم وضع أدوات الإصلاح والصيانة واللوازم الأخرى في الأماكن المخصصة لها بعد الانتهاء من العمل","en":"Not returning repair and maintenance tools and supplies to their places after work","penalties":["warning","fine:2500","fine:5000","fine:10000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B08","table":"B","item":8,"page":47,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 8 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 8 (annexed schedule, Art. 112)","ar":"تمزيق أو إتلاف إعلانات أو بلاغات إدارة المنشأة","en":"Tearing or damaging company notices or announcements","penalties":["fine:20000","fine:30000","fine:50000","dismissal_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B09","table":"B","item":9,"page":47,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 9 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 9 (annexed schedule, Art. 112)","ar":"الإهمال في العهد التي بحوزته (مثل السيارات والآلات والأجهزة والمعدات والأدوات)","en":"Negligence with custody items in one’s possession (vehicles, machines, devices, equipment, tools)","penalties":["fine:20000","fine:30000","fine:50000","dismissal_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B10","table":"B","item":10,"page":47,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 10 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 10 (annexed schedule, Art. 112)","ar":"الأكل في مكان العمل أو غير المكان المعد له أو في غير أوقات الراحة","en":"Eating at the workplace, outside the place set for it, or outside break times","penalties":["warning","fine:1000","fine:1500","fine:2500"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B11","table":"B","item":11,"page":47,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 11 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 11 (annexed schedule, Art. 112)","ar":"النوم أثناء العمل","en":"Sleeping during work","penalties":["warning","fine:1000","fine:2500","fine:5000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B12","table":"B","item":12,"page":47,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 12 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 12 (annexed schedule, Art. 112)","ar":"النوم في الحالات التي تستدعي يقظة مستمرة","en":"Sleeping where continuous alertness is required","penalties":["fine:5000","fine:10000","fine:20000","fine:30000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B13","table":"B","item":13,"page":47,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 13 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 13 (annexed schedule, Art. 112)","ar":"التسكع أو وجود العامل في غير مكان عمله أثناء ساعات العمل","en":"Loitering, or being away from one’s place of work during working hours","penalties":["fine:1000","fine:2500","fine:5000","fine:10000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B14","table":"B","item":14,"page":48,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 14 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 14 (annexed schedule, Art. 112)","ar":"التلاعب في إثبات الحضور والانصراف","en":"Tampering with attendance records","penalties":["fine:10000","fine:20000","deprivation","dismissal_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B15","table":"B","item":15,"page":48,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 15 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 15 (annexed schedule, Art. 112)","ar":"عدم إطاعة الأوامر العادية الخاصة بالعمل أو عدم تنفيذ التعليمات الخاصة بالعمل المعلقة في مكان ظاهر","en":"Disobeying ordinary work orders, or not following work instructions posted in a visible place","penalties":["fine:2500","fine:5000","fine:10000","fine:20000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B16","table":"B","item":16,"page":48,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 16 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 16 (annexed schedule, Art. 112)","ar":"التحريض على مخالفة الأوامر والتعليمات الخطية الخاصة بالعمل","en":"Inciting others to break written work orders and instructions","penalties":["fine:20000","fine:30000","fine:50000","dismissal_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B17","table":"B","item":17,"page":48,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 17 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 17 (annexed schedule, Art. 112)","ar":"التدخين في الأماكن المحظورة والمعلن عنها للمحافظة على سلامة العمال والمنشأة","en":"Smoking in prohibited, posted places kept safe for workers and the company","penalties":["fine:20000","fine:30000","fine:50000","dismissal_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"B18","table":"B","item":18,"page":48,"article_ar":"مخالفات تتعلق بتنظيم العمل، البند 18 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Work-organisation violations, item 18 (annexed schedule, Art. 112)","ar":"الإهمال أو التهاون في العمل الذي قد ينشأ عنه ضرر في صحة العمال أو سلامتهم أو في المواد أو الأدوات والأجهزة","en":"Negligence at work that may harm workers’ health or safety, or materials, tools and devices","penalties":["fine:20000","fine:30000","fine:50000","dismissal_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C01","table":"C","item":1,"page":49,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 1 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 1 (annexed schedule, Art. 112)","ar":"التشاجر مع الزملاء أو مع الغير أو إحداث مشاغبات في مكان العمل","en":"Quarrelling with colleagues or others, or causing disturbances at the workplace","penalties":["fine:10000","fine:20000","fine:30000","fine:50000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C02","table":"C","item":2,"page":49,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 2 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 2 (annexed schedule, Art. 112)","ar":"التمارض أو ادعاء العامل كذبًا أنه أصيب أثناء العمل أو بسببه","en":"Malingering, or falsely claiming an injury at or because of work","penalties":["fine:10000","fine:20000","fine:30000","fine:50000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C03","table":"C","item":3,"page":49,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 3 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 3 (annexed schedule, Art. 112)","ar":"الامتناع عن إجراء الكشف الطبي عند طلب طبيب المنشأة أو رفض اتباع التعليمات الطبية أثناء العلاج","en":"Refusing a medical examination requested by the company doctor, or refusing medical instructions during treatment","penalties":["fine:10000","fine:20000","fine:30000","fine:50000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C04","table":"C","item":4,"page":49,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 4 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 4 (annexed schedule, Art. 112)","ar":"مخالفة التعليمات الصحية المعلقة بأماكن العمل","en":"Breaking health instructions posted at the workplace","penalties":["fine:5000","fine:10000","fine:20000","fine:50000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C05","table":"C","item":5,"page":49,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 5 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 5 (annexed schedule, Art. 112)","ar":"الكتابة على جدران المنشأة أو لصق إعلانات عليها","en":"Writing on company walls or posting notices on them","penalties":["warning","fine:1000","fine:2500","fine:5000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C06","table":"C","item":6,"page":49,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 6 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 6 (annexed schedule, Art. 112)","ar":"رفض التفتيش الإداري عند الانصراف","en":"Refusing the administrative inspection on leaving","penalties":["fine:2500","fine:5000","fine:10000","fine:20000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C07","table":"C","item":7,"page":50,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 7 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 7 (annexed schedule, Art. 112)","ar":"عدم تسليم النقود المحصلة لحساب المنشأة في المواعيد المحددة دون تبرير مقبول","en":"Not handing over cash collected for the company on time without an acceptable justification","penalties":["fine:20000","fine:30000","fine:50000","dismissal_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C08","table":"C","item":8,"page":50,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 8 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 8 (annexed schedule, Art. 112)","ar":"الامتناع عن ارتداء الملابس والأجهزة المقررة للوقاية وللسلامة","en":"Refusing to wear the protective and safety clothing and equipment required","penalties":["warning","fine:10000","fine:20000","fine:50000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C09","table":"C","item":9,"page":50,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 9 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 9 (annexed schedule, Art. 112)","ar":"تعمد الخلوة مع الجنس الآخر في أماكن العمل","en":"Deliberate seclusion with a member of the opposite sex at the workplace","penalties":["fine:20000","fine:30000","fine:50000","dismissal_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C10","table":"C","item":10,"page":50,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 10 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 10 (annexed schedule, Art. 112)","ar":"الإيحاء للآخرين بما يخدش الحياء قولًا أو فعلًا","en":"Indecent suggestion to others in word or deed","penalties":["fine:20000","fine:30000","fine:50000","dismissal_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C11","table":"C","item":11,"page":50,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 11 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 11 (annexed schedule, Art. 112)","ar":"الاعتداء على زملاء العمل بالقول أو الإشارة أو باستعمال وسائل الاتصال الإلكترونية بالشتم أو التحقير","en":"Abusing colleagues by word, gesture or electronic means, with insults or contempt","penalties":["fine:20000","fine:30000","fine:50000","dismissal_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C12","table":"C","item":12,"page":50,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 12 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 12 (annexed schedule, Art. 112)","ar":"الاعتداء بالإيذاء الجسدي على زملاء العمل أو على غيرهم بطريقة إباحية","en":"Physical assault on colleagues or others in an indecent manner","penalties":["dismissal_no_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C13","table":"C","item":13,"page":51,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 13 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 13 (annexed schedule, Art. 112)","ar":"الاعتداء الجسدي أو القولي أو بأي وسيلة من وسائل الاتصال الإلكترونية على صاحب العمل أو المدير المسؤول أو أحد الرؤساء أثناء العمل أو بسببه","en":"Physical, verbal or electronic assault on the employer, the responsible manager or a superior at or because of work","penalties":["dismissal_no_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C14","table":"C","item":14,"page":51,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 14 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 14 (annexed schedule, Art. 112)","ar":"تقديم بلاغ أو شكوى كيدية","en":"Filing a malicious report or complaint","penalties":["fine:30000","fine:50000","dismissal_award",null],"extra_deduction":null,"uncertain":null,"note_ar":"في الجدول ثلاث عقوبات فقط، وخانة الرابعة فارغة.","note_en":"The table lists three penalties only; the fourth cell is empty."},
  {"code":"C15","table":"C","item":15,"page":51,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 15 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 15 (annexed schedule, Art. 112)","ar":"عدم الامتثال لطلب لجنة التحقيق بالحضور","en":"Not complying with the investigation committee’s summons to attend","penalties":["fine:20000","fine:30000","fine:50000","dismissal_award"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""},
  {"code":"C16","table":"C","item":16,"page":51,"article_ar":"مخالفات تتعلق بسلوك العامل، البند 16 (جداول المخالفات والجزاءات الملحقة باللائحة، م112)","article_en":"Conduct violations, item 16 (annexed schedule, Art. 112)","ar":"عدم التقيد بالزي الرسمي المعتمد بالمنشأة","en":"Not keeping to the company’s approved dress code","penalties":["fine:10000","fine:20000","fine:30000","fine:50000"],"extra_deduction":null,"uncertain":null,"note_ar":"","note_en":""}
 ]
}',
  'draft','2026-09-19T00:00:00.000Z');

-- 2) القضية: فعل واحد لموظف واحد، وقد يخالف أكثر من بند (م115: يُكتفى بالأشد).
-- المواعيد تُحفظ تواريخ لا أعدادًا: discovered_on لمهلة م119، وproven_on لمهلة م120، وnotified_on لمهلة التظلم م126.
CREATE TABLE discipline_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reference TEXT NOT NULL,
  user_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL REFERENCES discipline_schedules(id),
  act_date TEXT NOT NULL,
  discovered_on TEXT NOT NULL,
  description TEXT NOT NULL CHECK(length(trim(description))>=10),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('manager_report','hr_observation','attendance_day','other')),
  source_ref TEXT NOT NULL DEFAULT '',
  source_snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(source_snapshot)),
  recorded_by TEXT NOT NULL,
  proposed_penalty TEXT NOT NULL CHECK(json_valid(proposed_penalty)),
  process TEXT CHECK(process IS NULL OR process IN ('written','oral')),
  charge_text TEXT NOT NULL DEFAULT '',
  charge_delivered_on TEXT,
  investigation_opened_on TEXT,
  investigated_by TEXT,
  hearing_on TEXT,
  hearing_minutes TEXT NOT NULL DEFAULT '',
  hearing_by TEXT,
  defence_text TEXT NOT NULL DEFAULT '',
  defence_at TEXT,
  finding TEXT CHECK(finding IS NULL OR finding IN ('proven','not_proven')),
  finding_note TEXT NOT NULL DEFAULT '',
  proven_on TEXT,
  found_by TEXT,
  decided_penalty TEXT CHECK(decided_penalty IS NULL OR json_valid(decided_penalty)),
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  lighter_reason TEXT NOT NULL DEFAULT '',
  notice_request_id TEXT REFERENCES letter_requests(id),
  delivery_method TEXT CHECK(delivery_method IS NULL OR delivery_method IN ('hand','registered_mail','contract_email')),
  delivery_reference TEXT NOT NULL DEFAULT '',
  delivered_on TEXT,
  refused_to_sign INTEGER NOT NULL DEFAULT 0 CHECK(refused_to_sign IN (0,1)),
  delivery_recorded_by TEXT,
  notified_on TEXT,
  status TEXT NOT NULL CHECK(status IN ('recorded','investigating','proven','decided','notified','not_proven','withdrawn','lapsed')),
  closing_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,reference),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(recorded_by,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(discovered_on>=act_date),
  -- فصل المهام بالهوية: لا يسجل أحد على نفسه، ولا يقرر المسجِّل ولا صاحب الشأن، ولا يحقق أحد مع نفسه.
  CHECK(recorded_by<>user_id),
  CHECK(decided_by IS NULL OR (decided_by<>recorded_by AND decided_by<>user_id)),
  CHECK(investigated_by IS NULL OR investigated_by<>user_id),
  CHECK(hearing_by IS NULL OR hearing_by<>user_id),
  CHECK(found_by IS NULL OR found_by<>user_id),
  CHECK(delivery_recorded_by IS NULL OR delivery_recorded_by<>user_id),
  -- الاتهام الكتابي شرط المسار المكتوب (م117)، والمحضر شرط المسارين (م126/1).
  CHECK(process IS NULL OR (process='written' AND length(trim(charge_text))>=10 AND charge_delivered_on IS NOT NULL) OR (process='oral' AND length(trim(hearing_minutes))>=10)),
  CHECK(status IN ('recorded','withdrawn','lapsed') OR process IS NOT NULL),
  CHECK(status NOT IN ('proven','decided','notified') OR (finding='proven' AND proven_on IS NOT NULL)),
  CHECK(status NOT IN ('decided','notified') OR (decided_penalty IS NOT NULL AND decided_by IS NOT NULL)),
  CHECK(status<>'notified' OR (notified_on IS NOT NULL AND notice_request_id IS NOT NULL))
) STRICT;
CREATE INDEX discipline_cases_subject ON discipline_cases(tenant_id,user_id,status);
CREATE TRIGGER discipline_cases_versioned BEFORE UPDATE ON discipline_cases
WHEN NEW.version<>OLD.version+1 OR NEW.user_id<>OLD.user_id OR NEW.reference<>OLD.reference OR NEW.recorded_by<>OLD.recorded_by
  OR NEW.act_date<>OLD.act_date OR NEW.discovered_on<>OLD.discovered_on OR NEW.proposed_penalty<>OLD.proposed_penalty OR NEW.schedule_id<>OLD.schedule_id
  OR OLD.status IN ('not_proven','withdrawn','lapsed')
  OR (OLD.decided_penalty IS NOT NULL AND NEW.decided_penalty IS NOT OLD.decided_penalty)
BEGIN SELECT RAISE(ABORT,'a discipline case moves forward by version; its facts and decision are never rewritten'); END;
CREATE TRIGGER discipline_cases_no_delete BEFORE DELETE ON discipline_cases BEGIN SELECT RAISE(ABORT,'discipline cases are retained'); END;

-- البنود التي خالفها الفعل، بترتيب تكرارها عند التسجيل. العدّ للتكرار (م114) يُقرأ من هنا مع حالة القضية.
CREATE TABLE discipline_violations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL REFERENCES discipline_cases(id),
  user_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK(code GLOB '[ABC][0-9][0-9]'),
  act_date TEXT NOT NULL,
  occurrence INTEGER NOT NULL CHECK(occurrence>=1),
  penalty TEXT NOT NULL CHECK(json_valid(penalty)),
  UNIQUE(case_id,code),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX discipline_violations_count ON discipline_violations(tenant_id,user_id,code,act_date);
CREATE TRIGGER discipline_violations_fixed BEFORE UPDATE ON discipline_violations BEGIN SELECT RAISE(ABORT,'violations are recorded once'); END;
CREATE TRIGGER discipline_violations_no_delete BEFORE DELETE ON discipline_violations BEGIN SELECT RAISE(ABORT,'violations are retained'); END;

-- سجل الخطوات: يُضاف ولا يُعدَّل. نصوص الخطوات المفصلة في القضية نفسها؛ هنا أثر الخطوة وتاريخها ومن قام بها.
CREATE TABLE discipline_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL REFERENCES discipline_cases(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX discipline_events_case ON discipline_events(case_id,created_at);
CREATE TRIGGER discipline_events_fixed BEFORE UPDATE ON discipline_events BEGIN SELECT RAISE(ABORT,'case events are append-only'); END;
CREATE TRIGGER discipline_events_no_delete BEFORE DELETE ON discipline_events BEGIN SELECT RAISE(ABORT,'case events are retained'); END;

-- التظلم (م126/2): خلال 30 يومًا من الإبلاغ عدا العطل الرسمية، والرد خلال 15 يومًا عدا العطل الرسمية.
-- النتيجة لا تكون أشد من القرار: قبول (إلغاء الجزاء) أو تخفيف أو رفض.
CREATE TABLE discipline_grievances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL UNIQUE REFERENCES discipline_cases(id),
  user_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(trim(body))>=10),
  filed_on TEXT NOT NULL,
  answer_due_on TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('filed','answered')),
  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('upheld','reduced','rejected')),
  answer TEXT NOT NULL DEFAULT '',
  new_penalty TEXT CHECK(new_penalty IS NULL OR json_valid(new_penalty)),
  answered_by TEXT,
  answered_on TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(answered_by,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(answered_by IS NULL OR answered_by<>user_id),
  CHECK((status='answered')=(outcome IS NOT NULL AND answered_by IS NOT NULL)),
  CHECK((outcome='reduced')=(new_penalty IS NOT NULL))
) STRICT;
CREATE TRIGGER discipline_grievances_versioned BEFORE UPDATE ON discipline_grievances
WHEN NEW.version<>OLD.version+1 OR OLD.status='answered' OR NEW.body<>OLD.body OR NEW.filed_on<>OLD.filed_on OR NEW.user_id<>OLD.user_id
BEGIN SELECT RAISE(ABORT,'a grievance is filed once and answered once'); END;
CREATE TRIGGER discipline_grievances_no_delete BEFORE DELETE ON discipline_grievances BEGIN SELECT RAISE(ABORT,'grievances are retained'); END;

-- سجل الغرامات (م123): الغرامة التزام لصندوق منفعة العمال، لا إيراد للشركة. day_bp: 10000 = أجر يوم كامل.
-- التظلم قد يخفضها أو يلغيها ولا يرفعها.
CREATE TABLE discipline_fines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  case_id TEXT NOT NULL UNIQUE REFERENCES discipline_cases(id),
  user_id TEXT NOT NULL,
  day_bp INTEGER NOT NULL CHECK(day_bp BETWEEN 0 AND 50000),
  fund TEXT NOT NULL DEFAULT 'workers_benefit_fund' CHECK(fund='workers_benefit_fund'),
  status TEXT NOT NULL CHECK(status IN ('open','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(status='cancelled' OR day_bp>0)
) STRICT;
CREATE TRIGGER discipline_fines_only_down BEFORE UPDATE ON discipline_fines
WHEN NEW.version<>OLD.version+1 OR NEW.day_bp>OLD.day_bp OR OLD.status='cancelled' OR NEW.user_id<>OLD.user_id OR NEW.case_id<>OLD.case_id
BEGIN SELECT RAISE(ABORT,'a fine can only be reduced or cancelled'); END;
CREATE TRIGGER discipline_fines_no_delete BEFORE DELETE ON discipline_fines BEGIN SELECT RAISE(ABORT,'fines are retained in the register'); END;

-- ما اقتُرح على المسير من كل غرامة. الحركة نفسها في payroll_adjustments «مقترحة» ويعتمدها معتمد الرواتب.
CREATE TABLE discipline_fine_deductions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  fine_id TEXT NOT NULL REFERENCES discipline_fines(id),
  adjustment_id TEXT NOT NULL UNIQUE REFERENCES payroll_adjustments(id),
  user_id TEXT NOT NULL,
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  day_bp INTEGER NOT NULL CHECK(day_bp BETWEEN 1 AND 50000),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  daily_wage_minor INTEGER NOT NULL CHECK(daily_wage_minor>0),
  proposed_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  CHECK(proposed_by<>user_id)
) STRICT;
CREATE INDEX discipline_fine_deductions_month ON discipline_fine_deductions(tenant_id,user_id,month);
CREATE TRIGGER discipline_fine_deductions_fixed BEFORE UPDATE ON discipline_fine_deductions BEGIN SELECT RAISE(ABORT,'deduction proposals are recorded once'); END;
CREATE TRIGGER discipline_fine_deductions_no_delete BEFORE DELETE ON discipline_fine_deductions BEGIN SELECT RAISE(ABORT,'deduction proposals are retained'); END;

-- 3) إشعار الجزاء (م121) خطاب تصدره الموارد البشرية لا يطلبه الموظف. نوع أساسي بلا قالب: يكتب مالك الإجراء القالب ويعتمده غيره.
INSERT INTO letter_types(id,tenant_id,code,name,created_at) VALUES('letter-type-discipline-notice',NULL,'discipline_notice','إشعار بجزاء تأديبي','2026-09-19T00:00:00.000Z');

-- 4) الإشعارات: نوع الموضوع 'discipline_case' لا يحتاج تعديل جدول notifications هنا.
-- ترحيل 099 (قواعد الحضور) يستبدل قائمة 096 المغلقة بشرط شكل (حروف لاتينية صغيرة وشرطة سفلية، 3–40)، والنوع يطابقه.
-- هذا الترحيل لا يعيد بناء notifications ولا يغيرها؛ الوحدة تعتمد على 099 عند الدمج.
