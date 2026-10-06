-- search_index مشتق بالكامل؛ يُعاد إنشاؤه لتوسيع أنواع مساحة العمل ثم تُحذف حالته كي يعاد بناؤه عند أول بحث.
DROP TRIGGER search_index_ai;
DROP TRIGGER search_index_ad;
DROP TRIGGER search_index_au;
DROP TABLE search_fts;
DROP TABLE search_trigram;
DROP TABLE search_index;

CREATE TABLE search_index (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('client','vendor','employee','service','request','project','campaign','service_card','policy','report',
    'space_task','workspace_document','workspace_topic','workspace_event','workspace_checkin')),
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  normalized TEXT NOT NULL,
  department_id TEXT,
  client_id TEXT,
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(tenant_id,entity_type,entity_id)
) STRICT;
CREATE INDEX search_index_scope ON search_index(tenant_id,entity_type,updated_at DESC);
CREATE INDEX search_index_client ON search_index(tenant_id,client_id);
CREATE INDEX search_index_normalized ON search_index(tenant_id,normalized);
CREATE VIRTUAL TABLE search_fts USING fts5(normalized, content='search_index', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE search_trigram USING fts5(normalized, content='search_index', content_rowid='rowid', tokenize='trigram');
CREATE TRIGGER search_index_ai AFTER INSERT ON search_index BEGIN
  INSERT INTO search_fts(rowid,normalized) VALUES(new.rowid,new.normalized);
  INSERT INTO search_trigram(rowid,normalized) VALUES(new.rowid,new.normalized);
END;
CREATE TRIGGER search_index_ad AFTER DELETE ON search_index BEGIN
  INSERT INTO search_fts(search_fts,rowid,normalized) VALUES('delete',old.rowid,old.normalized);
  INSERT INTO search_trigram(search_trigram,rowid,normalized) VALUES('delete',old.rowid,old.normalized);
END;
CREATE TRIGGER search_index_au AFTER UPDATE ON search_index BEGIN
  INSERT INTO search_fts(search_fts,rowid,normalized) VALUES('delete',old.rowid,old.normalized);
  INSERT INTO search_trigram(search_trigram,rowid,normalized) VALUES('delete',old.rowid,old.normalized);
  INSERT INTO search_fts(rowid,normalized) VALUES(new.rowid,new.normalized);
  INSERT INTO search_trigram(rowid,normalized) VALUES(new.rowid,new.normalized);
END;
DELETE FROM search_index_state;

