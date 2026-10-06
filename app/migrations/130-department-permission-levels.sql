-- ترحيل 130 — مستويات الصلاحية على الإدارة: قالب شركة واحد، واستثناء للإدارة حين يريده المالك.
-- قرار المالك (20 سبتمبر 2026): «ابيك تحط صلاحيات على كل اداره مدير الادارة - موظف - ادمن
-- و اقدر احدد الصلاحيات انا وانا يكون عندي سوبر ادمن».
--
-- المبدأ الذي يحكم كل جدول أدناه: **المستوى يضيف ولا يسحب**. التصريح الفعلي لأي حساب هو
--   افتراضات دوره  ∪  ما يحمله مستواه  ∪  منحه الفردية،
-- ولا شيء في هذا الترحيل ينقص أحدًا تصريحًا كان يحمله. لذلك القالب المزروع أدناه **مرآة**
-- لما تقوله أدوار المنصة اليوم لا غير: مستوى «مدير الإدارة» يحمل تصاريح دور manager الثمانية عشر
-- كما هي، ومستوى «موظف» يُزرع فارغًا لأن دور employee لا يحمل اليوم إلا تصاريح «الجميع» وهي
-- ليست مما يُمنح أصلًا، ومستوى «أدمن الإدارة» يحمل تصريحه الجديد وحده ولا يُسنَد لأحد عند الترحيل.
-- فاتحاد الثلاثة مع الأدوار يساوي الأدوار بالضبط — وهذا ما يثبته المقارن الظلي
-- (scripts/permission-shadow.mjs) على كل حساب نشط وكل تصريح، لا ما يُدّعى هنا.
--
-- والمفتاح في permission_level_settings مطفأ (enabled=0) لكل كيان: حتى حساب الجواب الجديد
-- يبقى حرفيًا هو الجواب القديم حتى يشغّله المالك بنفسه بعد أن يقرأ نتيجة المقارن.
--
-- ما لا يفعله هذا الترحيل: لا يمس access_grants ولا users ولا أي صف قائم، ولا يكتب حدث تدقيق
-- (الحدث يُكتب عند فعل إنسان لا عند ترقية مخطط)، ولا يدّعي أن تصريحًا صار محصورًا بإدارة:
-- الحصر الحقيقي شيفرةٌ تُصفّي صفوفًا، وهو المرحلة (ب) وليس في هذه الموجة.

CREATE TABLE permission_level_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  -- المفتاح: 0 يعني أن capabilitiesFor وcan وholds لا تقرأ المستويات إطلاقًا، فالجواب هو جواب اليوم.
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  enabled_by TEXT REFERENCES users(id),
  enabled_at TEXT,
  -- ختم **أول** تشغيل ناجح، ولا يُمحى بالإطفاء. البوابة «لا يُشغَّل والمقارنة غير نظيفة» بوابةُ الانتقال
  -- الأول من نظام الأدوار إلى نظام المستويات، لا بوابةُ كل تشغيل: بعد أن يسند المالك مستوى واحدًا عن قصد
  -- (وهو غرض الميزة) تصير المقارنة غير نظيفة بالضرورة، فلو بقي الشرط على كل تشغيل لصار الإطفاء بابًا
  -- لا رجعة منه — يُطفئه المالك في حادثة ثم لا يستطيع إعادته إلا بمحو كل ما أسنده.
  first_enabled_at TEXT,
  -- على أي أساس شُغِّل: نتيجة المقارن الظلي كما قرأها من شغّله. لا يُشغَّل بلا سبب مكتوب.
  basis TEXT NOT NULL DEFAULT '',
  -- آخر مقارنة ظلية: نتيجتها كاملة (JSON)، ومن شغّلها ومتى. تُحفظ لأن المقارنة تمرّ على كل حساب × كل
  -- تصريح × كل إدارة، فحسابها عند كل فتح للشاشة يحجب حلقةَ الأحداث في خادم node:http ذي الخيط الواحد.
  -- الشاشة تعرض المحفوظ، والمالك يعيد تشغيلها بزر، وsetSwitch تعيد حسابها لحظةَ التشغيل مهما كان المحفوظ.
  shadow_ran_at TEXT,
  shadow_ran_by TEXT REFERENCES users(id),
  shadow_json TEXT NOT NULL DEFAULT '',
  -- 1 يعني: كُتب في القالب أو الاستثناءات أو مستويات الحسابات بعد آخر مقارنة، فالمحفوظ لم يعد يصف الحال.
  shadow_dirty INTEGER NOT NULL DEFAULT 1 CHECK(shadow_dirty IN (0,1))
) STRICT;
INSERT INTO permission_level_settings(tenant_id) SELECT id FROM tenants WHERE 1 ON CONFLICT(tenant_id) DO NOTHING;

-- قالب الشركة الواحد: ثلاثة مستويات لا سبعة عشر جدولًا. الإدارة التي لا استثناء لها تأخذ هذا القالب حرفيًا.
CREATE TABLE permission_level_template (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  level TEXT NOT NULL CHECK(level IN ('department_manager','employee','department_admin')),
  capability TEXT NOT NULL CHECK(length(trim(capability)) BETWEEN 3 AND 40),
  -- من وضع التصريح في المستوى ومتى: القالب قرار المالك، ويُقرأ من وضعه.
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,level,capability)
) STRICT;

-- الاستثناء على مستوى الإدارة: إضافة تصريح لمستوى في إدارة بعينها، أو حجبه عنها. صف واحد لكل
-- (إدارة، مستوى، تصريح)، فلا يجتمع على التصريح الواحد «أضف» و«احجب» في إدارة واحدة.
CREATE TABLE permission_level_exceptions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  department_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('department_manager','employee','department_admin')),
  capability TEXT NOT NULL CHECK(length(trim(capability)) BETWEEN 3 AND 40),
  -- add: يضاف لهذه الإدارة وحدها · remove: يُحجب عنها وحدها · follow: تراجعٌ معلن إلى قالب الشركة.
  -- «follow» موجودة لأن الصف لا يُحذف: الرجوع عن استثناء قرارٌ يُكتب كما كُتب الاستثناء، لا محوٌ له.
  mode TEXT NOT NULL CHECK(mode IN ('add','remove','follow')),
  -- لماذا هذه الإدارة وحدها: يُقرأ في المصفوفة بجوار الاستثناء، فلا استثناء بلا سبب يُقرأ.
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,department_id,level,capability),
  FOREIGN KEY(department_id,tenant_id) REFERENCES departments(id,tenant_id),
  FOREIGN KEY(decided_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;

-- مستوى كل حساب. صف واحد لكل حساب، والحساب بلا صف بلا مستوى فلا يضيف له المستوى شيئًا.
CREATE TABLE user_permission_levels (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('department_manager','employee','department_admin')),
  -- NULL هنا تعني: اشتُقّ من الدور عند الترحيل 130، لا قرار شخص. أول تعديل يكتب اسم من عدّله.
  assigned_by TEXT,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,user_id),
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id),
  FOREIGN KEY(assigned_by,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX user_permission_levels_level ON user_permission_levels(tenant_id,level);

-- ————— البذرة: مرآة اليوم، لا سياسة جديدة —————
-- ختم ثابت لا ساعة نظام: ساعة SQL تحرّك البصمات الذهبية كل يوم (انظر tests/ui-golden.test.mjs)،
-- وهذه صفوف مشتقة من ترقية مخطط لا حدث وقع في لحظة.

-- (1) مستوى «مدير الإدارة» = تصاريح دور manager الثمانية عشر كما هي في app/access.mjs اليوم.
--     كل من هو manager يحملها أصلًا بدوره، فاتحادها مع دوره لا يضيف له حرفًا.
INSERT INTO permission_level_template(tenant_id,level,capability,decided_by,decided_at)
SELECT t.id,'department_manager',c.capability,NULL,'2026-09-22T00:00:00.000Z' FROM tenants t CROSS JOIN (
  SELECT 'projects.use' AS capability UNION ALL SELECT 'delegations.use' UNION ALL SELECT 'budgets.use'
  UNION ALL SELECT 'vendors.view' UNION ALL SELECT 'vendors.assess' UNION ALL SELECT 'clients.manage'
  UNION ALL SELECT 'offerings.manage' UNION ALL SELECT 'approvals.record' UNION ALL SELECT 'approvals.verify'
  UNION ALL SELECT 'intake.handover' UNION ALL SELECT 'contracts.register.view' UNION ALL SELECT 'resourcing.view'
  UNION ALL SELECT 'resourcing.plan' UNION ALL SELECT 'timesheets.approve' UNION ALL SELECT 'equipment.manage'
  UNION ALL SELECT 'forms.design' UNION ALL SELECT 'knowledge.manage' UNION ALL SELECT 'integrations.view'
) c;

-- (2) مستوى «موظف» فارغ عمدًا: دور employee لا يحمل اليوم إلا تصاريح «الجميع» الستة، وهي ليست
--     مما يُمنح (grantAccess يرفضها)، فوضعها في قالب يوحي بأنها قرار وهي ليست كذلك.

-- (3) مستوى «أدمن الإدارة» يحمل تصريحه الجديد وحده. لا حساب يُسنَد إليه في هذا الترحيل،
--     فلا أحد يكسب شيئًا. التصريح نفسه معرَّف في app/access.mjs بـscoped:true، وحصره **مطبَّق**
--     في app/department-levels.mjs: أدمن الإدارة لا يبلغ حسابًا خارج إدارته.
INSERT INTO permission_level_template(tenant_id,level,capability,decided_by,decided_at)
SELECT id,'department_admin','department.levels.manage',NULL,'2026-09-22T00:00:00.000Z' FROM tenants;

-- (4) مستوى كل حساب قائم، مشتقًا من دوره وحده: manager ← مدير الإدارة، وما عداه ← موظف.
--     حساب الإدارة (role='admin') بلا مستوى: مستوى الإدارة ليس منزلًا لمسؤول المنصة، وامتياز
--     الأدمن الأول يبقى حيث هو (isSuperAdmin في app/access.mjs) بلا مساس.
INSERT INTO user_permission_levels(tenant_id,user_id,level,assigned_by,assigned_at)
SELECT tenant_id,id,CASE WHEN role='manager' THEN 'department_manager' ELSE 'employee' END,NULL,'2026-09-22T00:00:00.000Z'
FROM users WHERE role<>'admin';

-- الحذف من سجل الاستثناءات ممنوع: استثناء وقع يومًا يبقى مقروءًا. التراجع عنه تغييرُ وضعه إلى
-- «follow» بسبب مكتوب، لا محوٌ لصفه. القالب وإسناد المستوى يُعدَّلان (فهما حالة جارية لا سجل قرار)،
-- وأثرهما يُقرأ من audit_events المسلسلة بالبصمات لا من هذه الجداول.
CREATE TRIGGER permission_level_exceptions_no_delete BEFORE DELETE ON permission_level_exceptions
BEGIN SELECT RAISE(ABORT,'a department exception is a recorded decision; write the opposite mode instead of deleting'); END;
