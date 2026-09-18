-- The audit trail is append-only by construction, not by convention.
-- UPDATE and DELETE on `decisions` are rejected at the database, so a logged
-- decision can never be edited after the fact. Migrations that must reshape
-- the table drop the trigger first and recreate it after.
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'decisions is append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER decisions_append_only
  BEFORE UPDATE OR DELETE ON "decisions"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
