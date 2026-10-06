-- جودة الطلب: حين يرتد طلب بسبب حقل ناقص أو غامض، يسجّل من أعاده أي حقل كان السبب.
-- تراكم هذه السجلات يكشف الحقول التي تسبب أكثر الارتدادات، فيُحسَّن الكتالوج على دليل لا على انطباع.
-- السجل لا يُعدَّل ولا يُحذف: ما أُثبت سببًا للارتداد يبقى كما سُجل، والتصحيح يكون بتحسين الحقل نفسه.

CREATE TABLE service_field_feedback (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  request_id TEXT NOT NULL REFERENCES requests(id),
  revision INTEGER NOT NULL CHECK(revision>=1),
  service_code TEXT NOT NULL CHECK(length(trim(service_code))>=3),
  service_version INTEGER NOT NULL CHECK(service_version>=1),
  -- مفتاح الحقل كما في نسخة الخدمة؛ فارغ حين يكون السبب حقلًا غير موجود في النموذج أصلًا.
  field_key TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL CHECK(reason IN ('missing_field','unclear_field','wrong_options','insufficient_answer','not_needed')),
  note TEXT NOT NULL CHECK(length(trim(note))>=5 AND length(note)<=1000),
  reported_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK((reason='missing_field')=(field_key='')),
  UNIQUE(request_id,revision,field_key,reason)
) STRICT;
CREATE INDEX service_field_feedback_service ON service_field_feedback(tenant_id,service_code,field_key);

-- فصل المهام: صاحب الطلب لا يسجّل سبب ارتداد طلبه، ولا يسجله إلا من قرر الإعادة في هذه النسخة.
CREATE TRIGGER service_field_feedback_returner_only BEFORE INSERT ON service_field_feedback
WHEN EXISTS(SELECT 1 FROM requests r WHERE r.id=NEW.request_id AND (r.requester_id=NEW.reported_by OR r.tenant_id<>NEW.tenant_id))
  OR NOT EXISTS(SELECT 1 FROM approval_steps s WHERE s.request_id=NEW.request_id AND s.revision=NEW.revision AND s.status='returned' AND s.decided_by=NEW.reported_by)
BEGIN SELECT RAISE(ABORT,'field feedback is recorded by the approver who returned this revision'); END;
CREATE TRIGGER service_field_feedback_no_update BEFORE UPDATE ON service_field_feedback BEGIN SELECT RAISE(ABORT,'field feedback is retained as recorded'); END;
CREATE TRIGGER service_field_feedback_no_delete BEFORE DELETE ON service_field_feedback BEGIN SELECT RAISE(ABORT,'field feedback is retained as recorded'); END;
