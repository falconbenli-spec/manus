-- حجز المعدات والعهد: القطعة وطقمها وحجزها ومناولتها وصيانتها وجردها.
-- القطعة المرسملة تُربط بسجل الأصل المحاسبي ولا تُكرر بياناته المالية هنا (التكلفة والإهلاك تبقى في fixed_assets).
-- منع الحجز المزدوج مفروض بمحفّز في SQL لا بالكود وحده، ومن يسلّم ليس من يستلم، و«مفقود» تحتاج إقرار مسؤول آخر.
CREATE TABLE equipment_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  category TEXT NOT NULL CHECK(category IN ('camera','lens','lighting','audio','grip','accessory','other')),
  serial_no TEXT NOT NULL DEFAULT '',
  condition_state TEXT NOT NULL CHECK(condition_state IN ('good','minor_damage','damaged','incomplete')),
  condition_note TEXT NOT NULL DEFAULT '',
  home_location TEXT NOT NULL DEFAULT '',
  asset_id TEXT REFERENCES fixed_assets(id),
  status TEXT NOT NULL CHECK(status IN ('available','in_use','maintenance','lost_review','lost','retired')),
  lost_reported_by TEXT REFERENCES users(id),
  lost_note TEXT NOT NULL DEFAULT '',
  lost_confirmed_by TEXT REFERENCES users(id),
  lost_confirmed_at TEXT,
  lost_decision_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  UNIQUE(id,tenant_id),
  CHECK(status NOT IN ('lost_review','lost') OR (lost_reported_by IS NOT NULL AND length(trim(lost_note))>=10)),
  CHECK((status='lost')=(lost_confirmed_by IS NOT NULL)),
  -- الفقد يقره مسؤول غير من بلّغ عنه، بسبب مكتوب.
  CHECK(lost_confirmed_by IS NULL OR (lost_confirmed_by<>lost_reported_by AND length(trim(lost_decision_note))>=10))
) STRICT;
CREATE UNIQUE INDEX equipment_items_serial ON equipment_items(tenant_id,serial_no) WHERE serial_no<>'';
CREATE UNIQUE INDEX equipment_items_asset ON equipment_items(asset_id) WHERE asset_id IS NOT NULL;
CREATE TRIGGER equipment_items_versioned BEFORE UPDATE ON equipment_items
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code OR NEW.created_by<>OLD.created_by OR OLD.status IN ('lost','retired')
BEGIN SELECT RAISE(ABORT,'a lost or retired item is final; its code and tenant never change'); END;
CREATE TRIGGER equipment_items_no_delete BEFORE DELETE ON equipment_items BEGIN SELECT RAISE(ABORT,'items are retired, not deleted'); END;

CREATE TABLE equipment_kits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  created_by TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,code),
  UNIQUE(id,tenant_id)
) STRICT;
CREATE TRIGGER equipment_kits_versioned BEFORE UPDATE ON equipment_kits
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code
BEGIN SELECT RAISE(ABORT,'a kit keeps its code and tenant'); END;
CREATE TRIGGER equipment_kits_no_delete BEFORE DELETE ON equipment_kits BEGIN SELECT RAISE(ABORT,'kits are archived, not deleted'); END;

CREATE TABLE equipment_kit_items (
  kit_id TEXT NOT NULL REFERENCES equipment_kits(id),
  item_id TEXT NOT NULL REFERENCES equipment_items(id),
  added_by TEXT NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY(kit_id,item_id)
) STRICT;
-- القطعة في طقم واحد على الأكثر، فحجز الطقم ككتلة لا يترك القطعة معلقة بين طقمين.
CREATE UNIQUE INDEX equipment_kit_items_one_kit ON equipment_kit_items(item_id);
CREATE TRIGGER equipment_kit_items_no_update BEFORE UPDATE ON equipment_kit_items
BEGIN SELECT RAISE(ABORT,'a kit line is added or removed, not rewritten'); END;

CREATE TABLE equipment_bookings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  item_id TEXT NOT NULL,
  kit_id TEXT REFERENCES equipment_kits(id),
  group_id TEXT NOT NULL,
  project_id TEXT,
  -- ربط الإنتاج نص حر: وحدة الإنتاج يبنيها وكيل آخر، والمنسّق يصل الحقلين لاحقًا.
  production_ref TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL CHECK(length(trim(purpose))>=5),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  custodian_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('reserved','out','returned','cancelled')),
  booked_by TEXT NOT NULL REFERENCES users(id),
  cancel_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(item_id,tenant_id) REFERENCES equipment_items(id,tenant_id),
  FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
  FOREIGN KEY(custodian_id,tenant_id) REFERENCES users(id,tenant_id),
  UNIQUE(id,tenant_id),
  CHECK(end_date>=start_date),
  CHECK(status<>'cancelled' OR length(trim(cancel_note))>=5)
) STRICT;
CREATE INDEX equipment_bookings_item ON equipment_bookings(item_id,status,start_date,end_date);
CREATE INDEX equipment_bookings_group ON equipment_bookings(tenant_id,group_id);
-- منع الحجز المزدوج: أي تقاطع في المدى مع حجز قائم للقطعة نفسها يُرفض في قاعدة البيانات.
CREATE TRIGGER equipment_bookings_no_overlap_insert BEFORE INSERT ON equipment_bookings
WHEN NEW.status IN ('reserved','out') AND EXISTS(
  SELECT 1 FROM equipment_bookings b WHERE b.item_id=NEW.item_id AND b.id<>NEW.id AND b.status IN ('reserved','out')
    AND b.start_date<=NEW.end_date AND b.end_date>=NEW.start_date)
BEGIN SELECT RAISE(ABORT,'this item is already booked over an overlapping date range'); END;
CREATE TRIGGER equipment_bookings_no_overlap_update BEFORE UPDATE ON equipment_bookings
WHEN NEW.status IN ('reserved','out') AND EXISTS(
  SELECT 1 FROM equipment_bookings b WHERE b.item_id=NEW.item_id AND b.id<>NEW.id AND b.status IN ('reserved','out')
    AND b.start_date<=NEW.end_date AND b.end_date>=NEW.start_date)
BEGIN SELECT RAISE(ABORT,'this item is already booked over an overlapping date range'); END;
CREATE TRIGGER equipment_bookings_item_bookable BEFORE INSERT ON equipment_bookings
WHEN (SELECT status FROM equipment_items WHERE id=NEW.item_id) IN ('maintenance','lost_review','lost','retired')
BEGIN SELECT RAISE(ABORT,'an item in maintenance, reported lost or retired is not booked'); END;
CREATE TRIGGER equipment_bookings_versioned BEFORE UPDATE ON equipment_bookings
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.item_id<>OLD.item_id OR NEW.custodian_id<>OLD.custodian_id
  OR NEW.booked_by<>OLD.booked_by OR OLD.status IN ('returned','cancelled')
BEGIN SELECT RAISE(ABORT,'a closed booking is final; custody and item never move to another booking'); END;
CREATE TRIGGER equipment_bookings_no_delete BEFORE DELETE ON equipment_bookings BEGIN SELECT RAISE(ABORT,'bookings are cancelled, not deleted'); END;

-- المناولة: تسليم واستلام بعهدة مُقرّة داخل المنصة باسم المستلم ووقته. إقرار داخلي لا توقيع ذو حجية.
CREATE TABLE equipment_movements (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES equipment_bookings(id),
  kind TEXT NOT NULL CHECK(kind IN ('out','in')),
  moved_on TEXT NOT NULL,
  released_by TEXT NOT NULL REFERENCES users(id),
  received_by TEXT NOT NULL REFERENCES users(id),
  condition_state TEXT NOT NULL CHECK(condition_state IN ('good','minor_damage','damaged','incomplete')),
  condition_note TEXT NOT NULL CHECK(length(trim(condition_note))>=5),
  acknowledgement TEXT NOT NULL CHECK(length(trim(acknowledgement))>=10),
  acknowledged_by TEXT NOT NULL REFERENCES users(id),
  acknowledged_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(released_by<>received_by),
  CHECK(acknowledged_by=received_by)
) STRICT;
CREATE UNIQUE INDEX equipment_movements_once ON equipment_movements(booking_id,kind);
CREATE TRIGGER equipment_movements_custody BEFORE INSERT ON equipment_movements
WHEN (NEW.kind='out' AND NEW.received_by<>(SELECT custodian_id FROM equipment_bookings WHERE id=NEW.booking_id))
  OR (NEW.kind='in' AND NEW.released_by<>(SELECT custodian_id FROM equipment_bookings WHERE id=NEW.booking_id))
BEGIN SELECT RAISE(ABORT,'custody moves between the booking custodian and someone else, never to the same person'); END;
CREATE TRIGGER equipment_movements_out_first BEFORE INSERT ON equipment_movements
WHEN NEW.kind='in' AND NOT EXISTS(SELECT 1 FROM equipment_movements m WHERE m.booking_id=NEW.booking_id AND m.kind='out')
BEGIN SELECT RAISE(ABORT,'an item is received back only after it was handed out'); END;
CREATE TRIGGER equipment_movements_no_update BEFORE UPDATE ON equipment_movements BEGIN SELECT RAISE(ABORT,'a custody record is never rewritten'); END;
CREATE TRIGGER equipment_movements_no_delete BEFORE DELETE ON equipment_movements BEGIN SELECT RAISE(ABORT,'a custody record is never deleted'); END;

CREATE TABLE equipment_photos (
  id TEXT PRIMARY KEY,
  movement_id TEXT NOT NULL REFERENCES equipment_movements(id),
  label TEXT NOT NULL CHECK(length(trim(label))>=3),
  media_type TEXT NOT NULL CHECK(media_type IN ('image/png','image/jpeg')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152),
  digest TEXT NOT NULL,
  content BLOB NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(movement_id,digest)
) STRICT;
CREATE TRIGGER equipment_photos_no_update BEFORE UPDATE ON equipment_photos BEGIN SELECT RAISE(ABORT,'condition photos are evidence: they are added, never changed'); END;
CREATE TRIGGER equipment_photos_no_delete BEFORE DELETE ON equipment_photos BEGIN SELECT RAISE(ABORT,'condition photos are evidence: they are added, never deleted'); END;

CREATE TABLE equipment_maintenance (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('preventive','repair','calibration')),
  description TEXT NOT NULL CHECK(length(trim(description))>=10),
  status TEXT NOT NULL CHECK(status IN ('open','in_progress','done','cancelled')),
  opened_by TEXT NOT NULL REFERENCES users(id),
  opened_on TEXT NOT NULL,
  vendor_note TEXT NOT NULL DEFAULT '',
  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK(cost_minor>=0),
  cost_reference TEXT NOT NULL DEFAULT '',
  closed_by TEXT REFERENCES users(id),
  closed_on TEXT,
  resolution TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(item_id,tenant_id) REFERENCES equipment_items(id,tenant_id),
  UNIQUE(id,tenant_id),
  CHECK(status NOT IN ('done','cancelled') OR (closed_by IS NOT NULL AND closed_on IS NOT NULL AND length(trim(resolution))>=10)),
  CHECK(cost_minor=0 OR length(trim(cost_reference))>=3)
) STRICT;
CREATE INDEX equipment_maintenance_item ON equipment_maintenance(tenant_id,item_id,status);
CREATE TRIGGER equipment_maintenance_versioned BEFORE UPDATE ON equipment_maintenance
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.item_id<>OLD.item_id OR NEW.opened_by<>OLD.opened_by OR OLD.status IN ('done','cancelled')
BEGIN SELECT RAISE(ABORT,'a closed work order is final'); END;
CREATE TRIGGER equipment_maintenance_no_delete BEFORE DELETE ON equipment_maintenance BEGIN SELECT RAISE(ABORT,'work orders are retained'); END;

CREATE TABLE equipment_inventory_checks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL CHECK(length(trim(name))>=3),
  status TEXT NOT NULL CHECK(status IN ('open','closed')),
  started_by TEXT NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL,
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  closing_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,name),
  UNIQUE(id,tenant_id),
  CHECK((status='closed')=(closed_by IS NOT NULL)),
  CHECK(status<>'closed' OR (closed_at IS NOT NULL AND length(trim(closing_note))>=10)),
  -- من بدأ الجرد لا يقفله بنتيجته.
  CHECK(closed_by IS NULL OR closed_by<>started_by)
) STRICT;
CREATE TRIGGER equipment_inventory_checks_versioned BEFORE UPDATE ON equipment_inventory_checks
WHEN NEW.version<>OLD.version+1 OR NEW.tenant_id<>OLD.tenant_id OR NEW.started_by<>OLD.started_by OR OLD.status='closed'
BEGIN SELECT RAISE(ABORT,'a closed inventory check is final'); END;
CREATE TRIGGER equipment_inventory_checks_no_delete BEFORE DELETE ON equipment_inventory_checks BEGIN SELECT RAISE(ABORT,'inventory checks are retained'); END;

CREATE TABLE equipment_inventory_scans (
  check_id TEXT NOT NULL REFERENCES equipment_inventory_checks(id),
  item_id TEXT NOT NULL REFERENCES equipment_items(id),
  condition_state TEXT NOT NULL CHECK(condition_state IN ('good','minor_damage','damaged','incomplete')),
  note TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT NOT NULL REFERENCES users(id),
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY(check_id,item_id)
) STRICT;
CREATE TRIGGER equipment_inventory_scans_open BEFORE INSERT ON equipment_inventory_scans
WHEN (SELECT status FROM equipment_inventory_checks WHERE id=NEW.check_id)='closed'
BEGIN SELECT RAISE(ABORT,'a closed inventory check takes no further scans'); END;
CREATE TRIGGER equipment_inventory_scans_no_update BEFORE UPDATE ON equipment_inventory_scans BEGIN SELECT RAISE(ABORT,'a scan states what was seen and when; it is never rewritten'); END;
CREATE TRIGGER equipment_inventory_scans_no_delete BEFORE DELETE ON equipment_inventory_scans BEGIN SELECT RAISE(ABORT,'scans are retained'); END;
