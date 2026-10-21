-- Trigram indexes for the member directory's free-text search (ilike '%term%'), which a btree cannot serve.
-- Additive and expand-only: no existing object changes, so an older build keeps working. pg_trgm is already
-- installed in the shared database; its schema is looked up because the operator class must be qualified
-- when the extension is not on the migration role's search path. If the extension can neither be found nor
-- created (for example a managed database that withholds the privilege), the indexes are skipped with a
-- notice: search still returns the same results, just without the speed-up, and the deploy is not blocked.
DO $$
DECLARE
  ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF ext_schema IS NULL THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
    EXCEPTION WHEN insufficient_privilege OR undefined_file OR invalid_schema_name THEN
      RAISE NOTICE 'pg_trgm is unavailable; skipping member directory trigram indexes';
      RETURN;
    END;
    SELECT n.nspname INTO ext_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm';
  END IF;

  EXECUTE format('CREATE INDEX IF NOT EXISTS "profiles_first_name_trgm_idx" ON "idoc"."profiles" USING gin ("first_name" %I.gin_trgm_ops)', ext_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS "profiles_last_name_trgm_idx" ON "idoc"."profiles" USING gin ("last_name" %I.gin_trgm_ops)', ext_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS "profiles_full_name_trgm_idx" ON "idoc"."profiles" USING gin (("first_name" || '' '' || "last_name") %I.gin_trgm_ops)', ext_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS "users_display_email_trgm_idx" ON "idoc"."users" USING gin (coalesce("email_display", "email") %I.gin_trgm_ops)', ext_schema);
END
$$;
