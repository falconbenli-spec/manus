-- البحث الشامل: فهرس واحد لكل الكيانات، مبني على نص مطبّع (تشكيل وهمزات وتاء مربوطة وأرقام هندية موحّدة).
-- الفهرس مشتق بالكامل من الجداول المصدر ولا يصلح مصدر حقيقة: يُعاد بناؤه من الصفر بـreindex، ولا يُقرأ منه سطر
-- إلا بعد اجتيازه شرط الصلاحية في الاستعلام نفسه. لذلك لا يحمل الفهرس أي حقل حساس (لا رواتب ولا هويات ولا بيانات بنكية).
CREATE TABLE search_index (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('client','vendor','employee','service','request','project','campaign','service_card','policy','report')),
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
-- فهرس العمود المطبّع: يخدم البادئة بـLIKE إن تعذّر FTS5 على نسخة sqlite المشغّلة.
CREATE INDEX search_index_normalized ON search_index(tenant_id,normalized);

-- فهرسان منفصلان على العمود المطبّع وحده. الأول للكلمات (بادئة الكلمة)، والثاني ثلاثيات الحروف للمطابقة الجزئية
-- داخل الكلمة — وهو ما يحتاجه العربي كثيرًا لأن «ال» التعريف تسبق الجذر فتفشل مطابقة البادئة وحدها.
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

-- متى بُني الفهرس آخر مرة وكم سطرًا فيه، لتصريح الشاشة بصدق أنها تقرأ فهرسًا لا الجداول مباشرة.
CREATE TABLE search_index_state (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  rebuilt_at TEXT NOT NULL,
  entries INTEGER NOT NULL CHECK(entries>=0)
) STRICT;
