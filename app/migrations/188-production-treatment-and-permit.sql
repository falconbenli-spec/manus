-- الإنتاج على معالجته (الحزمة 4، P4-SPEC-2 وPRO-01 وPRO-03). كان الإنتاج يحمل عميلًا وحملة ومشروعًا ولا يعرف المخرج الذي
-- يصوّره ولا قرار مراجعته، وبدء التصوير لا يشترط معالجة معتمدة ولا ميزانية، وورقة الاستدعاء تصدر وتصريح موقعها اللازم قيد الطلب.
--
-- عمودان يُضافان لا جدول يُعاد بناؤه: للإنتاج أبناء (الطاقم والمواهب والمواقع والجدول واللقطات والأوراق وحجوزات المعدات 193)،
-- وADD COLUMN بمرجع قيمته NULL لا يمسّ صفًّا. ولأنه لا يحمل مفتاحًا مركّبًا مع الكيان، فالكيان والاتساق محفّزان.
ALTER TABLE productions ADD COLUMN review_route_id TEXT REFERENCES review_routes(id);
ALTER TABLE productions ADD COLUMN output_version_id TEXT REFERENCES studio_output_versions(id);

-- المسار ونسخته معًا أو لا أحدهما، والنسخة نسخة المسار نفسه، والمسار من كيان الإنتاج.
CREATE TRIGGER productions_treatment_link BEFORE INSERT ON productions
WHEN (NEW.review_route_id IS NULL)<>(NEW.output_version_id IS NULL)
  OR (NEW.review_route_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM review_routes r WHERE r.id=NEW.review_route_id AND r.tenant_id=NEW.tenant_id AND r.output_version_id=NEW.output_version_id))
BEGIN SELECT RAISE(ABORT,'a production links a review route of its own tenant together with that route''s own output version'); END;
-- والمعالجة التي يصوّرها الإنتاج تتغير في التحضير وحده: بدء التصوير قام عليها، فلا تتبدل بعده.
CREATE TRIGGER productions_treatment_fixed BEFORE UPDATE OF review_route_id,output_version_id ON productions
WHEN (NEW.review_route_id IS NULL)<>(NEW.output_version_id IS NULL)
  OR (NEW.review_route_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM review_routes r WHERE r.id=NEW.review_route_id AND r.tenant_id=NEW.tenant_id AND r.output_version_id=NEW.output_version_id))
  OR ((NEW.review_route_id IS NOT OLD.review_route_id OR NEW.output_version_id IS NOT OLD.output_version_id) AND OLD.status<>'planning')
BEGIN SELECT RAISE(ABORT,'the treatment a production shoots is its route and that route''s version, and it changes only while it is still in planning'); END;

-- PRO-01: لا يبدأ تصوير قبل اعتماد المعالجة (مسار مراجعتها موافق، بتعديلات أو بدونها) ومخصصٍ معتمد لمشروعه يغطي مدة التصوير.
-- الوحدة ترفض أولًا برفض يسمّي كل ناقص ومن يملكه؛ هذا حارس الكتابة المباشرة.
CREATE TRIGGER productions_start_ready BEFORE UPDATE OF status ON productions
WHEN NEW.status='in_production' AND OLD.status='planning' AND (
  NOT EXISTS(SELECT 1 FROM review_routes r WHERE r.id=NEW.review_route_id AND r.status IN ('approved','approved_with_changes'))
  OR NOT EXISTS(SELECT 1 FROM project_budgets b WHERE b.project_id=NEW.project_id AND b.tenant_id=NEW.tenant_id AND b.status='active'
    AND b.valid_from<=NEW.shoot_from AND b.valid_until>=NEW.shoot_to))
BEGIN SELECT RAISE(ABORT,'a shoot starts only on an approved treatment and an approved project budget covering its dates'); END;

-- PRO-03: الورقة الصادرة لا تُرسل أحدًا إلى موقع تصريحُه اللازم لم يصدر أو ينتهي قبل يوم التصوير.
CREATE TRIGGER call_sheets_issue_permit BEFORE UPDATE OF status ON call_sheets
WHEN NEW.status='issued' AND OLD.status<>'issued' AND EXISTS(SELECT 1 FROM production_locations l WHERE l.id=NEW.location_id AND l.permit_required=1
  AND (l.permit_status<>'obtained' OR (l.permit_expires_on IS NOT NULL AND l.permit_expires_on<NEW.shoot_date)))
BEGIN SELECT RAISE(ABORT,'a call sheet is issued only when its location''s required permit is obtained and still valid on the shoot day'); END;
CREATE INDEX productions_treatment ON productions(review_route_id) WHERE review_route_id IS NOT NULL;
