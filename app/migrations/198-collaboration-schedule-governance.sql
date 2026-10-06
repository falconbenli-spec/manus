-- إكمال عقد الجدول بعد تثبيت محتوى مساحة العمل في 197؛ لا يُعاد كتابة ترحيل مطبّق.
ALTER TABLE workspace_events ADD COLUMN recurrence_rule TEXT NOT NULL DEFAULT 'none'
  CHECK(recurrence_rule IN ('none','daily','weekly','monthly'));
ALTER TABLE workspace_events ADD COLUMN cancelled_by TEXT REFERENCES users(id);
ALTER TABLE workspace_events ADD COLUMN cancelled_at TEXT;
ALTER TABLE workspace_events ADD COLUMN cancellation_reason TEXT NOT NULL DEFAULT '';

CREATE TRIGGER workspace_events_cancel_guard BEFORE UPDATE ON workspace_events
WHEN NEW.status='cancelled' AND OLD.status<>'cancelled' AND
  (NEW.cancelled_by IS NULL OR NEW.cancelled_at IS NULL OR length(trim(NEW.cancellation_reason))<5)
BEGIN SELECT RAISE(ABORT,'event cancellation needs actor, time and reason'); END;

