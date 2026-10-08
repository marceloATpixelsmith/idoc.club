\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF to_regnamespace('idoc_production') IS NULL OR to_regnamespace('idoc_staging') IS NULL THEN
    RAISE EXCEPTION 'Both idoc_production and idoc_staging must exist';
  END IF;
END $$;

CREATE TEMP TABLE schema_isolation_validation (
  check_name text NOT NULL,
  object_name text NOT NULL,
  production_value text,
  staging_value text
) ON COMMIT DROP;

DO $$
DECLARE
  item record;
  production_count bigint;
  staging_count bigint;
  production_value bigint;
  staging_value bigint;
BEGIN
  FOR item IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='idoc_production' AND c.relkind IN ('r','p')
    ORDER BY c.relname
  LOOP
    IF to_regclass(format('%I.%I','idoc_staging',item.relname)) IS NULL THEN
      INSERT INTO schema_isolation_validation VALUES ('missing_table',item.relname,'present','missing');
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %I.%I','idoc_production',item.relname) INTO production_count;
    EXECUTE format('SELECT count(*) FROM %I.%I','idoc_staging',item.relname) INTO staging_count;
    IF production_count <> staging_count THEN
      INSERT INTO schema_isolation_validation VALUES ('row_count',item.relname,production_count::text,staging_count::text);
    END IF;
  END LOOP;

  FOR item IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='idoc_production' AND c.relkind='S'
    ORDER BY c.relname
  LOOP
    IF to_regclass(format('%I.%I','idoc_staging',item.relname)) IS NULL THEN
      INSERT INTO schema_isolation_validation VALUES ('missing_sequence',item.relname,'present','missing');
      CONTINUE;
    END IF;
    EXECUTE format('SELECT last_value FROM %I.%I','idoc_production',item.relname) INTO production_value;
    EXECUTE format('SELECT last_value FROM %I.%I','idoc_staging',item.relname) INTO staging_value;
    IF production_value <> staging_value THEN
      INSERT INTO schema_isolation_validation VALUES ('sequence_last_value',item.relname,production_value::text,staging_value::text);
    END IF;
  END LOOP;
END $$;

WITH production AS (
  SELECT c.conname, c.contype, replace(pg_get_constraintdef(c.oid,true),'idoc_production','<schema>') AS definition
  FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
  WHERE n.nspname='idoc_production'
), staging AS (
  SELECT c.conname, c.contype, replace(pg_get_constraintdef(c.oid,true),'idoc_staging','<schema>') AS definition
  FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
  WHERE n.nspname='idoc_staging'
)
INSERT INTO schema_isolation_validation
SELECT 'constraint',coalesce(p.conname,s.conname),
       CASE WHEN p.conname IS NULL THEN 'missing' ELSE p.contype || ':' || p.definition END,
       CASE WHEN s.conname IS NULL THEN 'missing' ELSE s.contype || ':' || s.definition END
FROM production p FULL JOIN staging s USING (conname)
WHERE p.conname IS NULL OR s.conname IS NULL OR p.contype<>s.contype OR p.definition<>s.definition;

WITH production AS (
  SELECT c.relname AS table_name, i.relname AS index_name,
         replace(pg_get_indexdef(i.oid),'idoc_production','<schema>') AS definition
  FROM pg_index x
  JOIN pg_class c ON c.oid=x.indrelid
  JOIN pg_class i ON i.oid=x.indexrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='idoc_production'
), staging AS (
  SELECT c.relname AS table_name, i.relname AS index_name,
         replace(pg_get_indexdef(i.oid),'idoc_staging','<schema>') AS definition
  FROM pg_index x
  JOIN pg_class c ON c.oid=x.indrelid
  JOIN pg_class i ON i.oid=x.indexrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='idoc_staging'
)
INSERT INTO schema_isolation_validation
SELECT 'index',coalesce(p.table_name,s.table_name)||'.'||coalesce(p.index_name,s.index_name),
       coalesce(p.definition,'missing'),coalesce(s.definition,'missing')
FROM production p FULL JOIN staging s USING (table_name,index_name)
WHERE p.definition IS DISTINCT FROM s.definition;

WITH production AS (
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='idoc_production'
), staging AS (
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='idoc_staging'
)
INSERT INTO schema_isolation_validation
SELECT 'function',coalesce(p.proname,s.proname)||'('||coalesce(p.args,s.args)||')',
       CASE WHEN p.proname IS NULL THEN 'missing' ELSE 'present' END,
       CASE WHEN s.proname IS NULL THEN 'missing' ELSE 'present' END
FROM production p FULL JOIN staging s USING (proname,args)
WHERE p.proname IS NULL OR s.proname IS NULL;

WITH production AS (
  SELECT c.relname AS table_name,t.tgname
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='idoc_production' AND NOT t.tgisinternal
), staging AS (
  SELECT c.relname AS table_name,t.tgname
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='idoc_staging' AND NOT t.tgisinternal
)
INSERT INTO schema_isolation_validation
SELECT 'trigger',coalesce(p.table_name,s.table_name)||'.'||coalesce(p.tgname,s.tgname),
       CASE WHEN p.tgname IS NULL THEN 'missing' ELSE 'present' END,
       CASE WHEN s.tgname IS NULL THEN 'missing' ELSE 'present' END
FROM production p FULL JOIN staging s USING (table_name,tgname)
WHERE p.tgname IS NULL OR s.tgname IS NULL;

INSERT INTO schema_isolation_validation
SELECT 'staging_active_session','auth_sessions','0',count(*)::text
FROM idoc_staging.auth_sessions WHERE revoked_at IS NULL
HAVING count(*)<>0;
INSERT INTO schema_isolation_validation
SELECT 'staging_unconsumed_token','account_tokens','0',count(*)::text
FROM idoc_staging.account_tokens WHERE consumed_at IS NULL
HAVING count(*)<>0;
INSERT INTO schema_isolation_validation
SELECT 'staging_unconsumed_token','email_verification_tokens','0',count(*)::text
FROM idoc_staging.email_verification_tokens WHERE consumed_at IS NULL
HAVING count(*)<>0;
INSERT INTO schema_isolation_validation
SELECT 'staging_unconsumed_token','email_otp_codes','0',count(*)::text
FROM idoc_staging.email_otp_codes WHERE consumed_at IS NULL
HAVING count(*)<>0;
INSERT INTO schema_isolation_validation
SELECT 'staging_pending_outbox','notification_outbox','0',count(*)::text
FROM idoc_staging.notification_outbox WHERE sent_at IS NULL AND dead_lettered_at IS NULL
HAVING count(*)<>0;
INSERT INTO schema_isolation_validation
SELECT 'staging_pending_outbox','account_delivery_outbox','0',count(*)::text
FROM idoc_staging.account_delivery_outbox WHERE sent_at IS NULL AND dead_lettered_at IS NULL
HAVING count(*)<>0;
INSERT INTO schema_isolation_validation
SELECT 'staging_pending_outbox','auth_security_notification_outbox','0',count(*)::text
FROM idoc_staging.auth_security_notification_outbox WHERE sent_at IS NULL AND dead_lettered_at IS NULL
HAVING count(*)<>0;
INSERT INTO schema_isolation_validation
SELECT 'staging_pending_outbox','operational_alert_outbox','0',count(*)::text
FROM idoc_staging.operational_alert_outbox WHERE sent_at IS NULL AND dead_lettered_at IS NULL
HAVING count(*)<>0;
INSERT INTO schema_isolation_validation
SELECT 'staging_open_checkout','membership_checkout_sessions','0',count(*)::text
FROM idoc_staging.membership_checkout_sessions WHERE status IN ('creating','open')
HAVING count(*)<>0;
INSERT INTO schema_isolation_validation
SELECT 'staging_open_checkout','seminar_registrations','0',count(*)::text
FROM idoc_staging.seminar_registrations WHERE checkout_status='open'
HAVING count(*)<>0;

TABLE schema_isolation_validation;

DO $$
DECLARE
  failures integer;
BEGIN
  SELECT count(*) INTO failures FROM schema_isolation_validation;
  IF failures <> 0 THEN
    RAISE EXCEPTION 'Schema isolation validation failed with % mismatches',failures;
  END IF;
END $$;

ROLLBACK;
