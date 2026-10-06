ALTER TABLE departments ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
ALTER TABLE departments ADD COLUMN sector TEXT NOT NULL DEFAULT '' CHECK(length(sector)<=80);
CREATE INDEX departments_active ON departments(tenant_id,active);
