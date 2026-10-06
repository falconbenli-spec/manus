CREATE TABLE studio_workspaces (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), project_id TEXT NOT NULL,
 title TEXT NOT NULL, owner_id TEXT NOT NULL, reviewer_id TEXT NOT NULL, reviewer_role TEXT NOT NULL,
 reviewer_appointed_by TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('draft','brief_pending','brief_returned','production')),
 version INTEGER NOT NULL CHECK(version>0), current_brief_id TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(owner_id<>reviewer_id),
 FOREIGN KEY(project_id,tenant_id) REFERENCES projects(id,tenant_id),
 FOREIGN KEY(owner_id,tenant_id) REFERENCES users(id,tenant_id),
 FOREIGN KEY(reviewer_id,tenant_id) REFERENCES users(id,tenant_id)
) STRICT;
CREATE TABLE studio_brief_versions (
 id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studio_workspaces(id), revision INTEGER NOT NULL CHECK(revision>0),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), digest TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, UNIQUE(studio_id,revision)
) STRICT;
CREATE TABLE studio_outputs (
 id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studio_workspaces(id),
 created_by TEXT NOT NULL REFERENCES users(id), current_version_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','pending','returned','approved')), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE studio_output_versions (
 id TEXT PRIMARY KEY, output_id TEXT NOT NULL REFERENCES studio_outputs(id), brief_id TEXT NOT NULL REFERENCES studio_brief_versions(id),
 revision INTEGER NOT NULL CHECK(revision>0), snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), digest TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, UNIQUE(output_id,revision)
) STRICT;
CREATE TABLE studio_assets (
 id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studio_workspaces(id), name TEXT NOT NULL,
 internal_reference TEXT NOT NULL, rights_holder TEXT NOT NULL,
 rights_basis TEXT NOT NULL CHECK(rights_basis IN ('owned','licensed','consent')),
 rights_evidence TEXT NOT NULL, valid_from TEXT NOT NULL, valid_until TEXT NOT NULL,
 channels TEXT NOT NULL CHECK(json_valid(channels)), created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 UNIQUE(studio_id,internal_reference)
) STRICT;
CREATE TABLE studio_asset_checks (
 id TEXT PRIMARY KEY, asset_id TEXT NOT NULL UNIQUE REFERENCES studio_assets(id),
 outcome TEXT NOT NULL CHECK(outcome IN ('passed','failed')), evidence TEXT NOT NULL,
 checked_by TEXT NOT NULL REFERENCES users(id), checked_at TEXT NOT NULL
) STRICT;
CREATE TABLE studio_submissions (
 id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studio_workspaces(id),
 kind TEXT NOT NULL CHECK(kind IN ('brief','output')), version_id TEXT NOT NULL,
 submitted_by TEXT NOT NULL REFERENCES users(id), reviewer_id TEXT NOT NULL REFERENCES users(id), submitted_at TEXT NOT NULL,
 CHECK(submitted_by<>reviewer_id), UNIQUE(kind,version_id)
) STRICT;
CREATE TABLE studio_reviews (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL UNIQUE REFERENCES studio_submissions(id),
 decision TEXT NOT NULL CHECK(decision IN ('approved','returned')), note TEXT NOT NULL CHECK(length(trim(note))>=3),
 quality_checks TEXT NOT NULL CHECK(json_valid(quality_checks)), reviewed_by TEXT NOT NULL REFERENCES users(id), reviewed_at TEXT NOT NULL
) STRICT;
CREATE TABLE studio_packages (
 id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studio_workspaces(id), snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 digest TEXT NOT NULL, issued_by TEXT NOT NULL REFERENCES users(id), issued_at TEXT NOT NULL, UNIQUE(studio_id,digest)
) STRICT;
CREATE TABLE studio_acceptances (
 id TEXT PRIMARY KEY, package_id TEXT NOT NULL UNIQUE REFERENCES studio_packages(id), note TEXT NOT NULL,
 evidence TEXT NOT NULL, accepted_by TEXT NOT NULL REFERENCES users(id), accepted_at TEXT NOT NULL
) STRICT;
CREATE INDEX studio_project_scope ON studio_workspaces(tenant_id,project_id);
CREATE INDEX studio_output_scope ON studio_outputs(studio_id,status);
CREATE TRIGGER studio_workspace_identity BEFORE UPDATE ON studio_workspaces
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id OR NEW.owner_id<>OLD.owner_id
 OR NEW.title<>OLD.title OR NEW.reviewer_id<>OLD.reviewer_id OR NEW.reviewer_role<>OLD.reviewer_role
 OR NEW.reviewer_appointed_by<>OLD.reviewer_appointed_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'studio identity is fixed and the next version is required'); END;
CREATE TRIGGER studio_output_identity BEFORE UPDATE ON studio_outputs
WHEN NEW.id<>OLD.id OR NEW.studio_id<>OLD.studio_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
 OR OLD.status='approved'
BEGIN SELECT RAISE(ABORT,'approved outputs and output identity are immutable'); END;
CREATE TRIGGER studio_review_authority BEFORE INSERT ON studio_reviews
WHEN NOT EXISTS(SELECT 1 FROM studio_submissions s WHERE s.id=NEW.submission_id AND s.reviewer_id=NEW.reviewed_by AND s.submitted_by<>NEW.reviewed_by)
BEGIN SELECT RAISE(ABORT,'the assigned independent reviewer must decide'); END;
CREATE TRIGGER studio_asset_check_independent BEFORE INSERT ON studio_asset_checks
WHEN EXISTS(SELECT 1 FROM studio_assets a WHERE a.id=NEW.asset_id AND a.created_by=NEW.checked_by)
BEGIN SELECT RAISE(ABORT,'an asset inspection must be independent'); END;
CREATE TRIGGER studio_acceptance_independent BEFORE INSERT ON studio_acceptances
WHEN EXISTS(SELECT 1 FROM studio_packages p WHERE p.id=NEW.package_id AND p.issued_by=NEW.accepted_by)
BEGIN SELECT RAISE(ABORT,'package acceptance must be independent'); END;
CREATE TRIGGER studio_workspaces_no_delete BEFORE DELETE ON studio_workspaces BEGIN SELECT RAISE(ABORT,'studio history is immutable'); END;
CREATE TRIGGER studio_outputs_no_delete BEFORE DELETE ON studio_outputs BEGIN SELECT RAISE(ABORT,'output history is immutable'); END;
CREATE TRIGGER studio_briefs_no_update BEFORE UPDATE ON studio_brief_versions BEGIN SELECT RAISE(ABORT,'brief versions are immutable'); END;
CREATE TRIGGER studio_briefs_no_delete BEFORE DELETE ON studio_brief_versions BEGIN SELECT RAISE(ABORT,'brief versions are immutable'); END;
CREATE TRIGGER studio_versions_no_update BEFORE UPDATE ON studio_output_versions BEGIN SELECT RAISE(ABORT,'output versions are immutable'); END;
CREATE TRIGGER studio_versions_no_delete BEFORE DELETE ON studio_output_versions BEGIN SELECT RAISE(ABORT,'output versions are immutable'); END;
CREATE TRIGGER studio_assets_no_update BEFORE UPDATE ON studio_assets BEGIN SELECT RAISE(ABORT,'asset rights records are immutable'); END;
CREATE TRIGGER studio_assets_no_delete BEFORE DELETE ON studio_assets BEGIN SELECT RAISE(ABORT,'asset rights records are immutable'); END;
CREATE TRIGGER studio_checks_no_update BEFORE UPDATE ON studio_asset_checks BEGIN SELECT RAISE(ABORT,'asset inspections are immutable'); END;
CREATE TRIGGER studio_checks_no_delete BEFORE DELETE ON studio_asset_checks BEGIN SELECT RAISE(ABORT,'asset inspections are immutable'); END;
CREATE TRIGGER studio_submissions_no_update BEFORE UPDATE ON studio_submissions BEGIN SELECT RAISE(ABORT,'submissions are immutable'); END;
CREATE TRIGGER studio_submissions_no_delete BEFORE DELETE ON studio_submissions BEGIN SELECT RAISE(ABORT,'submissions are immutable'); END;
CREATE TRIGGER studio_reviews_no_update BEFORE UPDATE ON studio_reviews BEGIN SELECT RAISE(ABORT,'review decisions are immutable'); END;
CREATE TRIGGER studio_reviews_no_delete BEFORE DELETE ON studio_reviews BEGIN SELECT RAISE(ABORT,'review decisions are immutable'); END;
CREATE TRIGGER studio_packages_no_update BEFORE UPDATE ON studio_packages BEGIN SELECT RAISE(ABORT,'delivery manifests are immutable'); END;
CREATE TRIGGER studio_packages_no_delete BEFORE DELETE ON studio_packages BEGIN SELECT RAISE(ABORT,'delivery manifests are immutable'); END;
CREATE TRIGGER studio_acceptances_no_update BEFORE UPDATE ON studio_acceptances BEGIN SELECT RAISE(ABORT,'internal acceptance is immutable'); END;
CREATE TRIGGER studio_acceptances_no_delete BEFORE DELETE ON studio_acceptances BEGIN SELECT RAISE(ABORT,'internal acceptance is immutable'); END;
