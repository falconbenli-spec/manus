-- ترحيل 156 — نصّا خطابين بصيغة الشركة نفسها.
--
-- المشكلة المقيسة: ثمانية أنواع خطابات مفعّلة وصفر قالب منشور، فبطاقة «طلب خطاب» في رئيسية الموظف معطّلة
-- برسالة «لا قالب خطاب معتمد بعد» (app/home.mjs، والجاهزية من routeReadiness في app/module-routes.mjs:
-- قالب منشور واحد لنوع مفعّل يكفي لفتحها). والنصان المبدئيان الموجودان (الترحيل 102 لخطاب الراتب،
-- والترحيل 114 لإشعار الجزاء) صيغة عامة لا تشبه ما تكتبه الشركة في خطاباتها.
--
-- ما يفعله هذا الترحيل: يستبدل النص المبدئي لنوعَي salary وdiscipline_notice بنص الشركة الحرفي
-- كما ورد في «خطاب تعريف شركة ثلاثمائة وستين درجة» و«خطاب الإنذار والخصم». محفّظ letter_template_starters_fixed
-- يمنع UPDATE، فيُسقط هنا ويُعاد إنشاؤه بنصّه كما هو في الترحيل 102 — لا تغيير في الجدول ولا في قيده.
--
-- ولا يُنشر منه قالب: النص يبقى مسودةً مبدئية. يتبناها معدّ القوالب باسمه من «قوالب الخطابات» (adoptStarter)
-- ويعتمدها شخص آخر يحمل hr.letters.issue (approveTemplate)، فيبقى فصل المهام كما هو.
-- وسطر التوقيع يحمل الصفة «مدير رأس المال البشري» لا اسم شخص: هوية من أعدّ ومن أصدر تأتي من سجل الإصدار
-- ويطبعها ذيل المستند (letterPrintable).
--
-- ثلاث خانات في نموذج الشركة لا يقابلها عنصر نائب، ولا تُختلق لها عناصر (الخادم يرفض ما ليس في PLACEHOLDERS):
--   • رقم الهوية — المنصة تمتنع عنه عمدًا لا سهوًا: app/pii.mjs يقول «لا تُسجَّل أرقام الهوية أو الإقامة في المنصة
--     بأي حقل»، وlooksLikeIdentifier يرفض ستة أرقام متتالية فأكثر في مرجع الوثيقة وفي الحقول المخصّصة.
--     إدراجه قرارُ سياسةٍ للمالك، لا توصيل عنصر.
--   • الجنسية — المخزون في employee_demographics فئتان (سعودي/غير سعودي) لغرض نسبة التوطين، خلف تصريح
--     لوحة تركيبة القوى العاملة، وتسجيله اختياري. والفئة ليست الجنسية التي يطلبها البنك.
--   • الرقم الوظيفي والقسم في إشعار الجزاء — المنصة لا تُصدر رقمًا وظيفيًا منفصلًا (app/employee-profile.mjs)،
--     ولا عنصر نائب للقسم.
-- فالخانات الثلاث غائبة من النصين، والقرار في شأنها مرفوع للمالك ومكتوب في status_note ليقرأه معدّ القالب
-- قبل أن يتبناه، لا في نص الخطاب.
--
-- بنود الراتب الأربعة مكتوبة صريحةً ({{salary_basic}} وما بعدها) لأن نموذج الشركة جدولٌ بخمس خانات.
-- وبندٌ لا يحمله العقد الساري يُطبع صفرًا لا فراغًا (app/letters.mjs، componentText)، فالعقد يعرف الجواب:
-- لا بدل سكن يعني صفرًا، لا «بيانًا ناقصًا» يمنع الإصدار.

DROP TRIGGER letter_template_starters_fixed;

-- ————— خطاب تعريف بالراتب —————
-- العنوان والافتتاح والخاتمة وسطر التوقيع بنصّ الشركة. عُدِّل حرفان فقط عن الورقة الأصلية:
--   • «مع اطيب التحيات» ← «مع أطيب التحيات» (همزة القطع؛ الخطاب يخرج لبنوك وسفارات).
--   • «بأن السيد» ← «بأن الموظف الآتي بيانه» — المنصة لا تسجّل جنسًا يُختار به «السيد» أو «السيدة»،
--     و«الموظف» هو اللفظ العام في خاتمة الشركة نفسها («ولا يزال الموظف على رأس العمل»).
UPDATE letter_template_starters SET
body='الموضوع: خطاب تعريف بالراتب

السادة / {{addressee}} المحترمين

السلام عليكم ورحمة الله وبركاته

بهذا نفيد نحن شركة ثلاثمائة وستين درجة بأن الموظف الآتي بيانه:

اسم الموظف: {{employee_name}}
الوظيفة: {{job_title}}
تاريخ التعيين: {{hire_date}}

الراتب الأساسي: {{salary_basic}}
بدل السكن: {{salary_housing}}
بدل النقل: {{salary_transport}}
بدلات أخرى: {{salary_other}}
الراتب الإجمالي: {{salary_total}}

ولا يزال الموظف على رأس العمل حتى تاريخه وقد منح هذا التعريف بناء على طلبه دون أدنى مسؤولية مالية أو خلافه على شركة ثلاثمائة وستين درجة تجاه الغير.

مع أطيب التحيات ،،،،

مدير رأس المال البشري
---- English ----
To: {{addressee}}

Subject: Salary certificate

Dear Sirs,

Three Hundred and Sixty Degrees Company hereby certifies the following about the employee named below:

Employee name: {{employee_name}}
Position: {{job_title}}
Date of appointment: {{hire_date}}

Basic salary: {{salary_basic}}
Housing allowance: {{salary_housing}}
Transport allowance: {{salary_transport}}
Other allowances: {{salary_other}}
Total salary: {{salary_total}}

The employee remains in service as of the date of this letter. This certificate is issued at the employee''s request without any financial or other liability on Three Hundred and Sixty Degrees Company towards third parties.

Best regards,

Human Capital Manager',
status_note='صيغة الشركة نفسها من «خطاب تعريف شركة ثلاثمائة وستين درجة»، مسودة مبدئية ثنائية اللغة تحتاج اعتماد الموارد البشرية قبل أي استخدام: يتبناها معدّ القوالب باسمه ويعتمدها شخص آخر يملك الإصدار. جدولا النموذج مكتوبان سطورًا «بند: قيمة» لأن نص القالب نص لا جدول. وخانتا «رقم الهوية» و«الجنسية» غير مدرجتين: المنصة لا تسجّل أرقام الهوية أو الإقامة في أي حقل، والجنسية عندها فئتان (سعودي/غير سعودي) لنسبة التوطين لا جنسيةً تُكتب في خطاب — إدراجهما قرار للمالك ثم ترحيل يسجّلهما. والاسم والمسمى يُملآن بالعربية في النصين لأن المنصة لا تحفظ لهما صيغة إنجليزية بعد.'
WHERE type_code='salary';

-- ————— إشعار بجزاء تأديبي (م121) —————
-- مضمون «خطاب الإنذار والخصم» بعناصر نوعه النائبة الجاهزة، ولا قيمة ثابتة واحدة: نوع المخالفة من
-- {{violation_ar}} (تملؤه وحدة الانضباط من القضية المحسومة، وخياراته السبعة في جدول المخالفات لا في القالب)،
-- والجزاء الموقع من {{penalty_ar}}، وجزاء التكرار من {{repeat_penalty_ar}}. كتابة «إنذار وخصم» نصًّا ثابتًا
-- تجعل الخطاب يخالف القرار حين يكون الجزاء غير ذلك.
-- ورقم المادة وسند اللائحة يبقيان بنصّ الجهة كما هو.
UPDATE letter_template_starters SET
body='إشعار بجزاء تأديبي (م121 من لائحة تنظيم العمل)

رقم القضية: {{case_reference}}

بيانات الموظف:
الاسم: {{employee_name}}
الوظيفة: {{job_title}}

نفيدكم بأنه لوحظت عليكم المخالفة الآتية:
{{violation_ar}}
تاريخ وقوعها: {{violation_date}}
سندها: {{article}}

وبعد استيفاء إجراءات التحقيق وإتاحة الفرصة لسماع دفاعكم، تقرر توقيع الجزاء الآتي وفقًا للائحة تنظيم العمل وأنظمة العمل المعمول بها: {{penalty_ar}}

وعند تكرار المخالفة نفسها يكون الجزاء المقرر أشد: {{repeat_penalty_ar}}

ولكم التظلم من هذا الجزاء كتابةً خلال {{grievance_days}} يومًا من تاريخ إبلاغكم به، عدا أيام العطل الرسمية. تقديم التظلم لا يضركم (م126).

مدير رأس المال البشري
---- English ----
Notice of a disciplinary penalty (Art. 121 of the work regulations)

Case reference: {{case_reference}}

Employee details:
Name: {{employee_name}}
Position: {{job_title}}

This is to notify you that the following violation was observed:
{{violation_en}}
Date of the act: {{violation_date}}
Basis: {{article}}

After the investigation was completed and you were given the opportunity to present your defence, the following penalty was imposed in accordance with the work regulations and the applicable labour rules: {{penalty_en}}

Should the same violation recur, the scheduled penalty will be more severe: {{repeat_penalty_en}}

You may file a written grievance against this penalty within {{grievance_days}} days of being notified of it, excluding official holidays. Filing a grievance shall not be held against you (Art. 126).

Human Capital Manager',
status_note='مضمون «خطاب الإنذار والخصم» بصيغة الشركة، مسودة مبدئية ثنائية اللغة تحتاج اعتماد الموارد البشرية قبل أي إصدار: يتبناها معدّ القوالب باسمه ويعتمدها شخص آخر يملك إصدار الخطابات. كل عناصره تملؤها وحدة الانضباط من القرار المحسوم، ولا عنصر يكتبه إنسان عند الإصدار. نوع المخالفة والجزاء وجزاء التكرار عناصر نائبة لا نص ثابت، فلا يخالف الخطاب القرار. وخانتا «الرقم الوظيفي» و«القسم» في النموذج الورقي غير مدرجتين: المنصة لا تُصدر رقمًا وظيفيًا منفصلًا ولا عنصر نائب للقسم. والسند ({{article}}) يُملأ بالعربية في النصين لأن اللائحة لا تحمل صيغة إنجليزية لبنودها في المنصة.'
WHERE type_code='discipline_notice';

CREATE TRIGGER letter_template_starters_fixed BEFORE UPDATE ON letter_template_starters BEGIN SELECT RAISE(ABORT,'starter texts are replaced by a new migration'); END;
