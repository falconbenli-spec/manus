-- ربط البوابة (فجوة تسليم الدمج §5): «خطاب بالمزايا» في «مزاياي» (ترحيل 103) كان يُسجَّل مرجعًا ومرفقًا يدويًا،
-- ولا يصدر منه مستند من وحدة الخطابات، فلا رقم مرجعي متسلسل ولا رمز تحقق QR ولا فصل بين من يعدّ ومن يصدر.
-- هذا الترحيل يضيف وحده ما يلزم لذلك: نوع خطاب أساسي مشترك، ونصًّا مبدئيًا ثنائي اللغة مسودةً كما في الترحيل 102.
-- لا يُعدَّل أي جدول ولا أي صف قائم، ولا يُنشر القالب: يتبناه معد القوالب مسودةً باسمه ويعتمده شخص آخر يملك الإصدار.
INSERT INTO letter_types(id,tenant_id,code,name,created_at) VALUES('letter-type-benefit',NULL,'benefit_letter','خطاب بالمزايا','2026-09-20T00:00:00.000Z');

-- النص العربي أولًا ثم سطر «---- English ----» ثم الإنجليزي. لا عنصر نائب للراتب ولا لفئة التأمين:
-- المنصة سجل وتذكير لا مُصدِر تغطية، وتفاصيل التغطية تصدر من شركة التأمين نفسها.
INSERT INTO letter_template_starters(type_code,body,status_note,created_at) VALUES
('benefit_letter','إلى: {{addressee}}

الموضوع: خطاب بالمزايا

تشهد شركة 3,6T بأن {{employee_name}} يعمل لديها بوظيفة {{job_title}} منذ {{hire_date}}، وأنه مشمول بالمزايا المقررة في لائحة تنظيم العمل لدى الشركة وفي عقده. أُعطي هذا الخطاب بناءً على طلبه دون أدنى مسؤولية على الشركة، ولا يُعد إقرارًا بتغطية تأمينية بعينها؛ تفاصيل التغطية تصدر من شركة التأمين.
---- English ----
To: {{addressee}}

Subject: Benefits letter

This is to certify that {{employee_name}} has been employed by 3,6T as {{job_title}} since {{hire_date}} and is covered by the benefits set out in the company''s work regulations and in their employment contract. This letter is issued at the employee''s request without any liability on the company, and is not a confirmation of any particular insurance cover; cover details are issued by the insurer.',
 'مسودة مبدئية ثنائية اللغة تحتاج اعتماد الموارد البشرية قبل أي استخدام. لا تذكر راتبًا ولا فئة تأمين ولا رقم وثيقة.','2026-09-20T00:00:00.000Z');
