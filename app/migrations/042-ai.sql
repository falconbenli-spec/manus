-- المساعدون الذكيون: كل تشغيل مسجل بنسخة تعليماته ومصادره وتكلفته ونتيجته ومراجعة صاحبه.
-- الناتج مسودة دائمًا. لا يملك المساعد كتابة في أي سجل آخر، ولا يُمزج عميلان في تشغيل واحد.
CREATE TABLE ai_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  daily_runs_per_user INTEGER NOT NULL DEFAULT 20 CHECK(daily_runs_per_user BETWEEN 1 AND 500),
  monthly_cost_cap_minor INTEGER CHECK(monthly_cost_cap_minor IS NULL OR monthly_cost_cap_minor>0),
  input_price_per_mtok_minor INTEGER CHECK(input_price_per_mtok_minor IS NULL OR input_price_per_mtok_minor>=0),
  output_price_per_mtok_minor INTEGER CHECK(output_price_per_mtok_minor IS NULL OR output_price_per_mtok_minor>=0),
  disabled_assistants TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(disabled_assistants)),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  assistant_key TEXT NOT NULL,
  instructions_version INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id),
  sources TEXT NOT NULL CHECK(json_valid(sources)),
  input_digest TEXT NOT NULL,
  input_chars INTEGER NOT NULL,
  output TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER,
  status TEXT NOT NULL CHECK(status IN ('completed','refused','failed')),
  review TEXT NOT NULL DEFAULT 'pending' CHECK(review IN ('pending','accepted','edited','rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  objection TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE INDEX ai_runs_user ON ai_runs(user_id,created_at);
CREATE TRIGGER ai_runs_fixed BEFORE UPDATE ON ai_runs
WHEN OLD.review<>'pending' OR NEW.output<>OLD.output OR NEW.sources<>OLD.sources OR NEW.assistant_key<>OLD.assistant_key OR NEW.user_id<>OLD.user_id OR NEW.input_digest<>OLD.input_digest OR NEW.cost_minor IS NOT OLD.cost_minor OR NEW.status<>OLD.status
BEGIN SELECT RAISE(ABORT,'an assistant run is reviewed once and never rewritten'); END;
CREATE TRIGGER ai_runs_no_delete BEFORE DELETE ON ai_runs BEGIN SELECT RAISE(ABORT,'assistant runs are retained'); END;
