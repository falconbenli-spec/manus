-- مراقبة انتهاء الوثائق: المنصة تقرأ تواريخ الانتهاء من مصادرها القائمة، ولا تعرف متى ينبغي التذكير.
-- مدة التذكير إعداد يدخله مالك الإجراء بمصدره وتاريخ تأكيده؛ لا قيمة نظامية مفترضة في الكود ولا صف ابتدائي هنا.
-- بلا صفوف عند التركيب: ما لم تُدخل مدته يبقى بلا حالة «يقترب من الانتهاء»، وتُطلب مدته في الشاشة.
CREATE TABLE expiry_watch_settings (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  doc_kind TEXT NOT NULL CHECK(length(trim(doc_kind)) BETWEEN 3 AND 60),
  first_reminder_days INTEGER NOT NULL CHECK(first_reminder_days BETWEEN 1 AND 730),
  second_reminder_days INTEGER NOT NULL CHECK(second_reminder_days BETWEEN 1 AND 730),
  basis TEXT NOT NULL CHECK(length(trim(basis))>=10),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  PRIMARY KEY(tenant_id,doc_kind),
  FOREIGN KEY(updated_by,tenant_id) REFERENCES users(id,tenant_id),
  -- التذكير الأول أبعد من الثاني: الأول تنبيه مبكر والثاني تحذير قرب الموعد.
  CHECK(first_reminder_days>second_reminder_days)
) STRICT;
CREATE TRIGGER expiry_watch_settings_versioned BEFORE UPDATE ON expiry_watch_settings
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.doc_kind<>OLD.doc_kind
BEGIN SELECT RAISE(ABORT,'stale expiry watch setting'); END;
CREATE TRIGGER expiry_watch_settings_no_delete BEFORE DELETE ON expiry_watch_settings
BEGIN SELECT RAISE(ABORT,'expiry watch settings are replaced by a new dated value, not deleted'); END;
