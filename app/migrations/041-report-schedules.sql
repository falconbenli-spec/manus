-- جدولة التقارير: لقطة مسودة تُنشأ دوريًا باسم صاحب الجدولة وبصلاحيته وقت التشغيل، وتنتظر اعتماد شخص آخر.
-- لا إرسال خارج المنصة. فقدان صاحب الجدولة صلاحية التقرير يوقفها بسبب مسجل بدل أن تستمر بصلاحية قديمة.
CREATE TABLE report_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  report_key TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK(cadence IN ('weekly','monthly')),
  owner_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  stopped_reason TEXT NOT NULL DEFAULT '',
  next_run TEXT NOT NULL,
  last_run TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE UNIQUE INDEX report_schedules_one_active ON report_schedules(owner_id,report_key,cadence) WHERE active=1;
CREATE TABLE report_schedule_runs (
  schedule_id TEXT NOT NULL REFERENCES report_schedules(id),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  snapshot_id TEXT REFERENCES report_snapshots(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('snapshot','stopped')),
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(schedule_id,period_from,period_to)
) STRICT;
