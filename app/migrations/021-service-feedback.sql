CREATE TABLE request_feedback (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  completed_version INTEGER NOT NULL CHECK(completed_version>0),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL CHECK(length(comment)<=2000),
  created_at TEXT NOT NULL,
  FOREIGN KEY(request_id,tenant_id) REFERENCES requests(id,tenant_id),
  FOREIGN KEY(requester_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TRIGGER request_feedback_immutable_update BEFORE UPDATE ON request_feedback
BEGIN SELECT RAISE(ABORT,'feedback_immutable'); END;
CREATE TRIGGER request_feedback_immutable_delete BEFORE DELETE ON request_feedback
BEGIN SELECT RAISE(ABORT,'feedback_immutable'); END;
